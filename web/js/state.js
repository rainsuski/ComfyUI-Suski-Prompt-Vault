/* File: ComfyUI-Suski-Prompt-Vault/web/js/state.js */

/**
 * 节点内部响应式状态机与脏状态追踪模块。
 *
 * 中栏磁贴 v2 数据模型：
 * - 一个词条在中栏最多存在一个实例（按 ref_preset_id 去重），从根本上消除副本；
 * - 组合归属不再用单值 group_id，而是 groups: [{ runtimeId, presetId, title, color }][0..n]，
 *   因此同一磁贴可以同时服务于多个组合，后者只是在磁贴上追加归属；
 * - pinned 记录"是否由用户直接加入"，卸载组合时采用引用计数：
 *   先摘除归属，归属清空且非手动加入的磁贴才被回收。
 *
 * 聚焦采用懒变更策略：沿用上一次聚焦的组合；仅当它不存在时才回退到磁贴的 groups[0]。
 *
 * 通知按 library / structure / selection / content 四条通道分发，组件各取所需。
 */

import { clampAndRoundWeight } from "./utils/prompt_format.js";

/** 词条最近使用记录在浏览器本地存储中的键名 */
const RECENT_USAGE_STORAGE_KEY = "pv_recent_usage_timestamps";

/**
 * 记录词条或词组的最近使用时间（毫秒时间戳）到本地浏览器缓存。
 * @param {string} id - 词条 entry.id 或组合 group.id
 */
export function recordRecentUsage(id) {
    if (!id) return;
    try {
        const raw = localStorage.getItem(RECENT_USAGE_STORAGE_KEY);
        const map = raw ? JSON.parse(raw) : {};
        map[id] = Date.now();
        localStorage.setItem(RECENT_USAGE_STORAGE_KEY, JSON.stringify(map));
    } catch (err) {
        console.warn("[PromptVault] Failed to save recent usage to localStorage:", err);
    }
}

/**
 * 获取本地浏览器缓存的所有词条/词组最近使用时间映射字典。
 * @returns {Record<string, number>} key 为 id，value 为毫秒时间戳
 */
export function getRecentUsageMap() {
    try {
        const raw = localStorage.getItem(RECENT_USAGE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        return {};
    }
}

/**
 * 预设高对比度暗黑科技主题色板，循环分配给不同的动态组合。
 */
const GROUP_PALETTE = ["#10b981", "#a855f7", "#06b6d4", "#f59e0b", "#ec4899"];

/**
 * 指针离开磁贴后的预览宽限期（毫秒）。
 * 磁贴之间存在行间距，mouseleave 会先于下一行的 mouseenter 触发；
 * 若立即回落就会出现"预览 → lastFocus → 新预览"的闪烁。
 * 宽限期内进入下一个组磁贴会直接接管预览，不再经过 lastFocus。
 */
const HOVER_PREVIEW_GRACE_MS = 150;

/**
 * 规范化文本内容，消除换行符及首尾多余空白引起的比较偏差。
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
    if (!text) return "";
    return text.replace(/\r\n/g, "\n").trim();
}

/* =========================================================================
   v2 磁贴模型辅助
   ========================================================================= */

/** 运行时实例 ID 自增序号，保证同一页面会话内不会重复 */
let instanceSequence = 0;

/**
 * 生成唯一运行时 ID。
 * @param {string} prefix
 * @returns {string}
 */
function nextInstanceId(prefix) {
    instanceSequence += 1;
    const salt = Math.random().toString(36).slice(2, 6);
    return `${prefix}_${Date.now().toString(36)}_${instanceSequence}_${salt}`;
}

/**
 * 规范化一个组合归属项。
 * @param {{ runtimeId?: string, presetId?: string|null, title?: string, color?: string }} raw
 */
function createMembership(raw = {}) {
    return {
        runtimeId: raw.runtimeId,
        presetId: raw.presetId || null,
        title: raw.title || "组合模板",
        color: raw.color || GROUP_PALETTE[0],
    };
}

/**
 * 取磁贴在指定运行时组合中的归属项。
 * @param {any} tile
 * @param {string|null} runtimeId
 * @returns {{ runtimeId: string, presetId: string|null, title: string, color: string }|null}
 */
export function findMembership(tile, runtimeId) {
    if (!tile || !runtimeId || !Array.isArray(tile.groups)) return null;
    return tile.groups.find((g) => g.runtimeId === runtimeId) || null;
}

/**
 * 把历史 v1 磁贴（单 group_id）升级为 v2（groups + pinned），并兜底修复残缺字段。
 * @param {any} raw
 * @returns {any}
 */
export function normalizeTileInstance(raw) {
    const tile = { ...raw };

    if (!Array.isArray(tile.groups)) {
        if (tile.group_id) {
            tile.groups = [
                createMembership({
                    runtimeId: tile.group_id,
                    presetId: tile.group_preset_id,
                    title: tile.group_title,
                    color: tile.group_color,
                }),
            ];
            // v1 无法区分"手动加入"与"由组合创建"，有归属的一律按组合创建处理
            tile.pinned = false;
        } else {
            tile.groups = [];
            tile.pinned = true;
        }
    } else {
        tile.groups = tile.groups.filter((g) => g && g.runtimeId).map((g) => createMembership(g));
        if (typeof tile.pinned !== "boolean") {
            tile.pinned = tile.groups.length === 0;
        }
    }

    if (typeof tile.pinned !== "boolean") {
        tile.pinned = tile.groups.length === 0;
    }
    if (!tile.instance_id) {
        tile.instance_id = nextInstanceId("tile");
    }

    // 清理 v1 遗留字段，避免它们随工作流继续序列化
    delete tile.group_id;
    delete tile.group_preset_id;
    delete tile.group_title;
    delete tile.group_color;

    return tile;
}

/**
 * 按 ref_preset_id 去重，保留首个出现项；空白草稿（ref 为空）不受限制。
 * @param {any[]} tiles
 * @returns {any[]}
 */
export function dedupeTilesByRef(tiles) {
    const seen = new Set();
    let dropped = 0;
    const result = tiles.filter((tile) => {
        const refId = tile && tile.ref_preset_id;
        if (!refId) return true;
        if (seen.has(refId)) {
            dropped += 1;
            return false;
        }
        seen.add(refId);
        return true;
    });
    if (dropped > 0) {
        console.info(`[PromptVault] 已丢弃 ${dropped} 个重复磁贴：同一词条在中栏只保留一个实例`);
    }
    return result;
}

/**
 * 状态变更通道。各组件只订阅自己关心的通道，避免无关重渲染。
 * - LIBRARY:   词库数据被外部改变（CRUD / 导入 / 其它节点广播）
 * - STRUCTURE: 磁贴集合、顺序、组归属发生变化
 * - SELECTION: 激活磁贴或中栏多选集发生变化
 * - CONTENT:   单个磁贴自身字段变化（标题/正文/分类/权重/静音/脏标记/缩略图）
 */
export const CHANNEL = {
    LIBRARY: "library",
    STRUCTURE: "structure",
    SELECTION: "selection",
    CONTENT: "content",
};

/**
 * 已选磁贴运行态实例类型定义（v2）
 * @typedef {Object} SelectedTileInstance
 * @property {string} instance_id - 运行时唯一标识
 * @property {string|null} ref_preset_id - 关联的纯净词条 entry.id
 * @property {{ runtimeId: string, presetId: string|null, title: string, color: string }[]} groups - 组合归属（0..n）
 * @property {boolean} pinned - 是否由用户直接加入（卸载组合时保留为独立磁贴）
 * @property {string} title - 磁贴名称
 * @property {string} prompt - 提示词内容
 * @property {string|null} category_id - 分类 ID
 * @property {string} category - 分类名称
 * @property {number} weight - 当前权重
 * @property {boolean} enabled - 是否参与拼接
 * @property {boolean} is_dirty - 是否相对于关联预设 entry 发生了草稿修改
 * @property {string} thumbnail - 缩略图路径
 */

export class VaultNodeState {
    /**
     * @param {any} node - LiteGraph 宿主节点实例
     */
    constructor(node) {
        this.node = node;
        /** @type {SelectedTileInstance[]} */
        this.selectedTiles = [];
        /** @type {string|null} 当前在右侧编辑器中激活编辑的 instance_id */
        this.activeInstanceId = null;
        /** @type {Set<string>} 中栏多选磁贴实例 ID 集合 */
        this.multiSelectedIds = new Set();
        /** @type {string|null} 上一次聚焦的运行时组合 ID（持久保留，不因移出悬停而清空） */
        this.lastFocusGroupId = null;
        /** @type {boolean} 指针当前是否停在中栏磁贴上（悬停预览是否生效） */
        this.hoverPreviewActive = false;
        /** @type {string|null} 悬停预览的组合 ID；null 表示指针所在磁贴没有可展示的组合 */
        this.hoverPreviewGroupId = null;
        /** @type {ReturnType<typeof setTimeout>|null} 预览消散的宽限定时器 */
        this._hoverEndTimer = null;
        /** @type {Map<string, Set<Function>>} 按通道分组的订阅者回调集合 */
        this.subscribers = new Map();
        /** @type {Set<Function>} 聚焦变化专用订阅者回调集合（仅用于轻量重绘轨道） */
        this.focusSubscribers = new Set();
    }

    /**
     * 订阅指定通道。
     * @param {string} channel - CHANNEL 之一
     * @param {(detail?: any) => void} callback
     * @returns {() => void} 取消订阅
     */
    on(channel, callback) {
        let bucket = this.subscribers.get(channel);
        if (!bucket) {
            bucket = new Set();
            this.subscribers.set(channel, bucket);
        }
        bucket.add(callback);
        return () => bucket.delete(callback);
    }

    /**
     * 订阅聚焦变化。轨道重绘只依赖这一个信号，避免整表重渲染。
     * @param {(displayGroupId: string|null) => void} callback
     * @returns {() => void} 取消订阅
     */
    subscribeFocus(callback) {
        this.focusSubscribers.add(callback);
        return () => this.focusSubscribers.delete(callback);
    }

    _notifyFocus() {
        const displayId = this.getDisplayFocusGroupId();
        this.focusSubscribers.forEach((cb) => {
            try {
                cb(displayId);
            } catch (err) {
                console.error("[PromptVault] Error in focus subscriber callback:", err);
            }
        });
    }

    /**
     * 当前应当展示连线的组合：悬停预览优先；指针离开后回落到上一次聚焦。
     * @returns {string|null}
     */
    getDisplayFocusGroupId() {
        return this.hoverPreviewActive ? this.hoverPreviewGroupId : this.lastFocusGroupId;
    }

    /**
     * 可作为"连线带"绘制出来的聚焦组。
     * 连线是两点之间的连接，成员数不足 2 时画不出完整的带，
     * 强行绘制只会留下悬空的残缺线段，因此返回 null（等同于不展示）。
     * @returns {string|null}
     */
    getRenderableFocusGroupId() {
        const displayId = this.getDisplayFocusGroupId();
        if (!displayId) return null;

        let memberCount = 0;
        this.selectedTiles.forEach((tile) => {
            if (findMembership(tile, displayId)) {
                memberCount += 1;
            }
        });

        return memberCount >= 2 ? displayId : null;
    }

    /**
     * 向指定通道广播状态变更。
     * @param {string} [channel=CHANNEL.STRUCTURE] - CHANNEL 之一
     * @param {any} [detail=null] - 附加信息（如 { instanceId }）
     */
    notify(channel = CHANNEL.STRUCTURE, detail = null) {
        // 仅结构性变化才需要回写隐藏 widget 并刷新画布，避免每次输入都全量序列化
        if (channel === CHANNEL.STRUCTURE) {
            this.syncToNodeWidget();
            // 结构变化会重建行，旧的悬停预览与待消散的定时器一并作废
            this._cancelHoverEnd();
            this.hoverPreviewActive = false;
            this.hoverPreviewGroupId = null;
        }
        const bucket = this.subscribers.get(channel);
        if (!bucket) return;
        bucket.forEach((cb) => {
            try {
                cb(detail);
            } catch (err) {
                console.error(`[PromptVault] Error in "${channel}" subscriber:`, err);
            }
        });
    }

    loadFromSerialized(jsonString) {
        try {
            if (!jsonString || jsonString.trim() === "") {
                this.selectedTiles = [];
            } else {
                const parsed = JSON.parse(jsonString);
                const rawTiles = Array.isArray(parsed) ? parsed : [];
                // 先迁移 v1 形状，再按词条去重，最后定位激活项
                this.selectedTiles = dedupeTilesByRef(rawTiles.map(normalizeTileInstance));
            }
        } catch (err) {
            console.warn("[PromptVault] Failed to parse serialized tiles:", err);
            this.selectedTiles = [];
        }

        if (this.selectedTiles.length > 0 && !this.activeInstanceId) {
            this.activeInstanceId = this.selectedTiles[0].instance_id;
        }
        this.multiSelectedIds.clear();
        this.lastFocusGroupId = null;
        this.hoverPreviewActive = false;
        this.hoverPreviewGroupId = null;
        this._ensureFocus();
        this.notify(CHANNEL.STRUCTURE);
    }

    syncToNodeWidget() {
        if (!this.node || !this.node.widgets) return;
        const targetWidget = this.node.widgets.find(
            (w) => w.name === "selected_tiles_data"
        );
        if (targetWidget) {
            targetWidget.value = JSON.stringify(this.selectedTiles);
        }
        if (window.app && window.app.graph) {
            window.app.graph.setDirtyCanvas(true, true);
        }
    }

    getActiveTile() {
        if (!this.activeInstanceId) return null;
        return this.selectedTiles.find((t) => t.instance_id === this.activeInstanceId) || null;
    }

    setActiveTile(instanceId) {
        this.multiSelectedIds.clear();
        if (this.activeInstanceId !== instanceId) {
            this.activeInstanceId = instanceId;
        }
        // 懒聚焦：上一次聚焦的组仍然有效就不改动，仅在缺失时回退到 groups[0]
        this._ensureFocus();
        this.notify(CHANNEL.SELECTION);
    }

    /**
     * 懒变更聚焦规则（悬停切换与选中共用）：
     * 新磁贴仍包含"上一次聚焦"的组 → 保持；不包含 → 取该磁贴的首个归属组（无归属则无聚焦）。
     * @param {any} tile
     * @returns {string|null}
     */
    _resolveFocusFor(tile) {
        const memberships = tile && Array.isArray(tile.groups) ? tile.groups : [];
        if (this.lastFocusGroupId && memberships.some((g) => g.runtimeId === this.lastFocusGroupId)) {
            return this.lastFocusGroupId;
        }
        return memberships.length > 0 ? memberships[0].runtimeId : null;
    }

    /**
     * 判断某个运行时组合是否属于"当前选中磁贴"。
     * 持久聚焦只能落在这个集合内，否则会指向与选中项无关的组。
     * @param {string|null} runtimeId
     * @returns {boolean}
     */
    _isInActiveTile(runtimeId) {
        if (!runtimeId) return false;
        const activeTile = this.getActiveTile();
        return Boolean(
            activeTile &&
                Array.isArray(activeTile.groups) &&
                activeTile.groups.some((g) => g.runtimeId === runtimeId)
        );
    }

    /**
     * 指针进入磁贴：建立临时预览。
     * 预览本身沿用懒变更规则；但写入持久聚焦有额外约束 ——
     * 只有落在当前选中磁贴归属集合内的组才会被记住。
     * 因此选中 A 时悬停其它组只预览；选中 AB 时悬停 A/B 组可切换并停留，
     * 悬停 C 组只预览，移开后回落到 A/B。
     * 悬停无归属磁贴（白板）时不改变任何状态，展示维持原样。
     * @param {any} tile
     */
    beginHoverPreview(tile) {
        const memberships = tile && Array.isArray(tile.groups) ? tile.groups : [];
        if (memberships.length === 0) return;

        // 从上一行直接进入本行时，取消待消散的预览，避免中间插一帧 lastFocus
        this._cancelHoverEnd();

        const previousDisplay = this.getDisplayFocusGroupId();
        const previewId = this._resolveFocusFor(tile);

        this.hoverPreviewActive = true;
        this.hoverPreviewGroupId = previewId;

        if (this._isInActiveTile(previewId)) {
            this.lastFocusGroupId = previewId;
        }

        if (this.getDisplayFocusGroupId() !== previousDisplay) {
            this._notifyFocus();
        }
    }

    /**
     * 指针离开磁贴：进入宽限期，延迟回落；期间进入其它组磁贴则被取消。
     */
    endHoverPreview() {
        if (!this.hoverPreviewActive || this._hoverEndTimer) return;
        this._hoverEndTimer = setTimeout(() => {
            this._hoverEndTimer = null;
            this._finishHoverPreview();
        }, HOVER_PREVIEW_GRACE_MS);
    }

    /**
     * 宽限期结束后真正结束预览，回落到上一次聚焦。
     */
    _finishHoverPreview() {
        if (!this.hoverPreviewActive) return;
        const previousDisplay = this.getDisplayFocusGroupId();
        this.hoverPreviewActive = false;
        this.hoverPreviewGroupId = null;
        if (this.getDisplayFocusGroupId() !== previousDisplay) {
            this._notifyFocus();
        }
    }

    _cancelHoverEnd() {
        if (this._hoverEndTimer) {
            clearTimeout(this._hoverEndTimer);
            this._hoverEndTimer = null;
        }
    }

    /**
     * 选中变化后收敛聚焦（选中通道随后会触发轨道重绘，故此处不发通知）。
     */
    _ensureFocus() {
        this.lastFocusGroupId = this._resolveFocusFor(this.getActiveTile());
    }

    /**
     * 判断某个词库组合是否已安装到中栏（存在任意一个归属即可）。
     * @param {string} groupPresetId
     * @returns {boolean}
     */
    isGroupInstalled(groupPresetId) {
        if (!groupPresetId) return false;
        return this.selectedTiles.some(
            (tile) => Array.isArray(tile.groups) && tile.groups.some((g) => g.presetId === groupPresetId)
        );
    }

    toggleMultiSelect(instanceId) {
        if (this.multiSelectedIds.size === 0) {
            if (this.activeInstanceId) {
                this.multiSelectedIds.add(this.activeInstanceId);
            }
            this.multiSelectedIds.add(instanceId);
        } else {
            if (this.multiSelectedIds.has(instanceId)) {
                this.multiSelectedIds.delete(instanceId);
            } else {
                this.multiSelectedIds.add(instanceId);
            }
        }
        this.notify(CHANNEL.SELECTION);
    }

    clearMultiSelect() {
        if (this.multiSelectedIds.size > 0) {
            this.multiSelectedIds.clear();
            this.notify(CHANNEL.SELECTION);
        }
    }

    isMultiSelected(instanceId) {
        return this.multiSelectedIds.has(instanceId);
    }

    getMultiSelectedTiles() {
        return this.selectedTiles.filter((t) => this.multiSelectedIds.has(t.instance_id));
    }

    /**
     * 以词条为模板创建中栏磁贴实例。
     * @param {any} entry
     * @param {any[]} categories
     * @param {Partial<SelectedTileInstance>} [overrides]
     * @returns {SelectedTileInstance}
     */
    _createTileInstance(entry, categories = [], overrides = {}) {
        const matchedCat = (categories || []).find((c) => c.id === entry.categoryId);
        return {
            instance_id: nextInstanceId("tile"),
            ref_preset_id: entry.id || null,
            groups: [],
            pinned: false,
            title: entry.title || "未命名词条",
            prompt: entry.text || entry.prompt || "",
            category_id: entry.categoryId || null,
            category: matchedCat ? matchedCat.name : "未分类",
            weight: 1.0,
            enabled: true,
            is_dirty: false,
            thumbnail: entry.previewHash || entry.thumbnail || "",
            ...overrides,
        };
    }

    /**
     * 为新的运行时组合分配一个调色板颜色。
     * @returns {string}
     */
    _nextGroupColor() {
        const used = new Set();
        this.selectedTiles.forEach((tile) => {
            (tile.groups || []).forEach((g) => used.add(g.runtimeId));
        });
        return GROUP_PALETTE[used.size % GROUP_PALETTE.length];
    }

    /**
     * 从词库单条 entry 实例化并加入已选列表。
     * 同一词条只允许一个实例，已存在时直接复用。
     * @param {any} entry
     * @param {any[]} categories
     * @returns {SelectedTileInstance}
     */
    addTileFromEntry(entry, categories = []) {
        if (!entry) return null;

        if (entry.id) {
            const existing = this.selectedTiles.find((t) => t.ref_preset_id === entry.id);
            if (existing) {
                this.activeInstanceId = existing.instance_id;
                this._ensureFocus();
                this.notify(CHANNEL.SELECTION);
                return existing;
            }
            recordRecentUsage(entry.id);
        }

        const newInstance = this._createTileInstance(entry, categories, { pinned: true });

        this.selectedTiles.push(newInstance);
        this.activeInstanceId = newInstance.instance_id;
        this.multiSelectedIds.clear();
        this.lastFocusGroupId = null;
        this._ensureFocus();
        this.notify(CHANNEL.STRUCTURE);
        return newInstance;
    }

    /**
     * 以"补齐"方式安装一个组合：只创建缺失的词条，已存在的磁贴仅追加组合归属。
     * 组合是关系实体，安装只是在磁贴上登记归属；卸载时按引用计数回收。
     * @param {any} group - 组合关系对象 (包含 entryIds)
     * @param {any[]} allEntries - 全量词库 entries 数组
     * @param {any[]} categories - 全量分类数组
     * @returns {{ added: number, adopted: number, skipped: number }}
     */
    addGroup(group, allEntries = [], categories = []) {
        const entryIds = Array.isArray(group.entryIds) ? group.entryIds.filter(Boolean) : [];
        if (entryIds.length === 0) return { added: 0, adopted: 0, skipped: 0 };

        if (group && group.id) {
            recordRecentUsage(group.id);
        }

        const membership = createMembership({
            runtimeId: nextInstanceId("grp"),
            presetId: group.id || null,
            title: group.title,
            color: this._nextGroupColor(),
        });

        const created = [];
        let adopted = 0;
        let skipped = 0;

        entryIds.forEach((entryId) => {
            recordRecentUsage(entryId);

            const existing = this.selectedTiles.find((t) => t.ref_preset_id === entryId);
            if (existing) {
                if (!existing.groups.some((g) => g.runtimeId === membership.runtimeId)) {
                    existing.groups.push({ ...membership });
                    adopted += 1;
                }
                return;
            }

            const entry = allEntries.find((e) => e.id === entryId);
            if (!entry) {
                skipped += 1;
                return;
            }

            created.push(
                this._createTileInstance(entry, categories, {
                    groups: [{ ...membership }],
                    pinned: false,
                })
            );
        });

        if (created.length > 0) {
            this.selectedTiles.push(...created);
            this.activeInstanceId = created[0].instance_id;
        }
        if (created.length > 0 || adopted > 0) {
            this.multiSelectedIds.clear();
            // 优先聚焦刚安装的组；若选中磁贴并不属于它，则回退到选中磁贴自己的归属
            this.lastFocusGroupId = membership.runtimeId;
            this._ensureFocus();
            this.notify(CHANNEL.STRUCTURE);
        }

        if (skipped > 0) {
            console.warn(
                `[PromptVault] 组合「${group.title || "未命名组合"}」有 ${skipped} 个词条在词库中不存在，已跳过`
            );
        }

        return { added: created.length, adopted, skipped };
    }

    /**
     * 插入一个临时空白草稿磁贴。
     * @returns {SelectedTileInstance}
     */
    addEmptyTile() {
        const emptyInstance = this._createTileInstance(
            { id: null, title: "临时空白词条", text: "", categoryId: null },
            [],
            { pinned: true, is_dirty: true }
        );

        this.selectedTiles.push(emptyInstance);
        this.activeInstanceId = emptyInstance.instance_id;
        this.multiSelectedIds.clear();
        this.lastFocusGroupId = null;
        this.notify(CHANNEL.STRUCTURE);
        return emptyInstance;
    }

    /**
     * 将中栏已有的一组磁贴就地登记为动态组合（追加归属，不覆盖已有归属）。
     * 不篡改每个磁贴自身的 ref_preset_id 与内容。
     * @param {string[]} instanceIds
     * @param {string} groupId - 运行时组合 ID
     * @param {string} groupTitle
     * @param {string|null} [assignedColor=null]
     * @param {string|null} [groupPresetId=null]
     */
    bindTilesToGroup(instanceIds, groupId, groupTitle, assignedColor = null, groupPresetId = null) {
        if (!instanceIds || instanceIds.length === 0) return;

        const membership = createMembership({
            runtimeId: groupId,
            presetId: groupPresetId,
            title: groupTitle,
            color: assignedColor || this._nextGroupColor(),
        });

        const idSet = new Set(instanceIds);
        this.selectedTiles.forEach((tile) => {
            if (!idSet.has(tile.instance_id)) return;
            if (!Array.isArray(tile.groups)) tile.groups = [];
            if (tile.groups.some((g) => g.runtimeId === membership.runtimeId)) return;
            tile.groups.push({ ...membership });
        });

        this.lastFocusGroupId = membership.runtimeId;
        this._ensureFocus();
        this.multiSelectedIds.clear();
        this.notify(CHANNEL.STRUCTURE);
    }

    /**
     * 移除单个磁贴。
     * 不再连带移除其所属组合：其余组员保留，该组合在中栏退化为"部分已加入"状态。
     * 整组卸载请使用 removeGroupById / removeGroupByPresetId（左栏组合卡片入口）。
     * @param {string} instanceId
     */
    removeTile(instanceId) {
        const index = this.selectedTiles.findIndex((t) => t.instance_id === instanceId);
        if (index === -1) return;

        this.selectedTiles.splice(index, 1);
        this.multiSelectedIds.delete(instanceId);

        if (this.activeInstanceId === instanceId) {
            this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
        }
        this._ensureFocus();
        this.notify(CHANNEL.STRUCTURE);
    }

    /**
     * 卸载一个运行时组合（按 runtimeId）。
     * @param {string} runtimeId
     * @returns {boolean} 是否发生了变更
     */
    removeGroupById(runtimeId) {
        if (!runtimeId) return false;
        return this._uninstallGroups((membership) => membership.runtimeId === runtimeId);
    }

    /**
     * 卸载某个词库组合在中栏的全部安装实例（按 group.id）。
     * @param {string} groupPresetId
     * @returns {boolean}
     */
    removeGroupByPresetId(groupPresetId) {
        if (!groupPresetId) return false;
        return this._uninstallGroups((membership) => membership.presetId === groupPresetId);
    }

    /**
     * 按谓词摘除组合归属，并按引用计数回收磁贴：
     * 归属清空后，pinned（用户手动加入）的磁贴保留为独立词条，其余一并移除。
     * @param {(membership: any) => boolean} shouldRemove
     * @returns {boolean}
     */
    _uninstallGroups(shouldRemove) {
        const removedInstanceIds = new Set();
        let changed = false;

        this.selectedTiles = this.selectedTiles.filter((tile) => {
            if (!Array.isArray(tile.groups) || tile.groups.length === 0) return true;

            const kept = [];
            tile.groups.forEach((membership) => {
                if (shouldRemove(membership)) {
                    changed = true;
                } else {
                    kept.push(membership);
                }
            });
            if (kept.length === tile.groups.length) return true;

            tile.groups = kept;
            if (kept.length === 0 && !tile.pinned) {
                removedInstanceIds.add(tile.instance_id);
                return false;
            }
            return true;
        });

        if (!changed) return false;

        removedInstanceIds.forEach((id) => this.multiSelectedIds.delete(id));

        if (
            removedInstanceIds.has(this.activeInstanceId) ||
            !this.selectedTiles.some((t) => t.instance_id === this.activeInstanceId)
        ) {
            this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
        }

        this._ensureFocus();
        this.notify(CHANNEL.STRUCTURE);
        return true;
    }

    removeMultiSelectedTiles() {
        if (this.multiSelectedIds.size === 0) return;

        const selectedIds = new Set(this.multiSelectedIds);
        this.selectedTiles = this.selectedTiles.filter((t) => !selectedIds.has(t.instance_id));

        if (
            selectedIds.has(this.activeInstanceId) ||
            !this.selectedTiles.some((t) => t.instance_id === this.activeInstanceId)
        ) {
            this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
        }

        this.multiSelectedIds.clear();
        this._ensureFocus();
        this.notify(CHANNEL.STRUCTURE);
    }

    clearAllTiles() {
        this.selectedTiles = [];
        this.activeInstanceId = null;
        this.multiSelectedIds.clear();
        this.lastFocusGroupId = null;
        this.hoverPreviewActive = false;
        this.hoverPreviewGroupId = null;
        this.notify(CHANNEL.STRUCTURE);
    }

    reorderTiles(fromIndex, toIndex) {
        if (
            fromIndex < 0 ||
            fromIndex >= this.selectedTiles.length ||
            toIndex < 0 ||
            toIndex >= this.selectedTiles.length ||
            fromIndex === toIndex
        ) {
            return;
        }

        const [movedItem] = this.selectedTiles.splice(fromIndex, 1);
        this.selectedTiles.splice(toIndex, 0, movedItem);
        this.notify(CHANNEL.STRUCTURE);
    }

    reorderTilesBatch(movingIds, targetInstanceId, position = "before") {
        if (!movingIds || movingIds.length === 0 || !targetInstanceId) return;

        const movingSet = new Set(movingIds);
        if (movingSet.has(targetInstanceId)) return;

        const movingItems = this.selectedTiles.filter((t) => movingSet.has(t.instance_id));
        const remainingTiles = this.selectedTiles.filter((t) => !movingSet.has(t.instance_id));

        const targetIndex = remainingTiles.findIndex((t) => t.instance_id === targetInstanceId);
        if (targetIndex === -1) return;

        const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
        remainingTiles.splice(insertIndex, 0, ...movingItems);

        this.selectedTiles = remainingTiles;
        this.notify(CHANNEL.STRUCTURE);
    }

    adjustTileWeight(instanceId, delta) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        const current = typeof tile.weight === "number" ? tile.weight : 1.0;
        tile.weight = clampAndRoundWeight(current + delta);
        this.notify(CHANNEL.CONTENT, { instanceId });
    }

    toggleTileEnabled(instanceId) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        tile.enabled = !tile.enabled;
        this.notify(CHANNEL.CONTENT, { instanceId });
    }

    /**
     * 更新磁贴内容并与真实词条进行纯净去脏对比。
     * 加入 Diff 防护：若属性无实际变更且脏标记未变，直接返回，切断无效 notify 与 DOM 销毁。
     * @param {string} instanceId
     * @param {{ title?: string, prompt?: string, category_id?: string|null, category?: string }} updates
     * @param {any[]} allEntries
     */
    updateTileContent(instanceId, updates, allEntries = []) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        let hasActualChanges = false;

        if (updates.title !== undefined && tile.title !== updates.title) {
            tile.title = updates.title;
            hasActualChanges = true;
        }
        if (updates.prompt !== undefined && tile.prompt !== updates.prompt) {
            tile.prompt = updates.prompt;
            hasActualChanges = true;
        }
        if (updates.category_id !== undefined && tile.category_id !== updates.category_id) {
            tile.category_id = updates.category_id;
            hasActualChanges = true;
        }
        if (updates.category !== undefined && tile.category !== updates.category) {
            tile.category = updates.category;
            hasActualChanges = true;
        }

        const prevDirty = tile.is_dirty;
        if (!tile.ref_preset_id) {
            tile.is_dirty = true;
        } else {
            const original = allEntries.find((e) => e.id === tile.ref_preset_id);
            if (original) {
                const titleChanged = normalizeText(original.title) !== normalizeText(tile.title);
                const promptChanged = normalizeText(original.text || original.prompt) !== normalizeText(tile.prompt);
                const categoryChanged = (original.categoryId || null) !== (tile.category_id || null);
                tile.is_dirty = titleChanged || promptChanged || categoryChanged;
            } else {
                tile.is_dirty = true;
            }
        }

        if (prevDirty !== tile.is_dirty) {
            hasActualChanges = true;
        }

        // 若内容和状态均无任何变动，直接返回，彻底杜绝打断用户点击
        if (!hasActualChanges) {
            return;
        }

        this.notify(CHANNEL.CONTENT, { instanceId });
    }

    markTileAsSavedToPreset(instanceId, savedEntry, categories = []) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile || !savedEntry) return;

        const matchedCat = categories.find((c) => c.id === savedEntry.categoryId);
        const catName = matchedCat ? matchedCat.name : "未分类";

        tile.ref_preset_id = savedEntry.id;
        tile.title = savedEntry.title || tile.title;
        tile.prompt = savedEntry.text || savedEntry.prompt || tile.prompt;
        tile.category_id = savedEntry.categoryId || null;
        tile.category = catName;
        tile.thumbnail = savedEntry.previewHash || tile.thumbnail;
        tile.is_dirty = false;
        this.notify(CHANNEL.CONTENT, { instanceId });
    }

    /**
     * 标记组合内部特定成员已成功入库同步。
     * @param {string} instanceId
     * @param {{ title?: string, prompt?: string, ref_preset_id?: string }} data
     */
    markGroupMemberAsSaved(instanceId, data) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;
        if (data.title !== undefined) tile.title = data.title;
        if (data.prompt !== undefined) tile.prompt = data.prompt;
        if (data.ref_preset_id !== undefined) tile.ref_preset_id = data.ref_preset_id;
        tile.is_dirty = false;
        this.notify(CHANNEL.CONTENT, { instanceId });
    }

    /**
     * 恢复磁贴为对应词库预设 entry 的原始内容。
     * 绝不会发生被词组名称或空文本覆盖的现象。
     * @param {string} instanceId
     * @param {any[]} allEntries
     * @param {any[]} categories
     */
    revertTileToPreset(instanceId, allEntries, categories = []) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile || !tile.ref_preset_id) return;

        const original = allEntries.find((e) => e.id === tile.ref_preset_id);
        if (!original) return;

        const matchedCat = categories.find((c) => c.id === original.categoryId);

        tile.title = original.title;
        tile.prompt = original.text || original.prompt || "";
        tile.category_id = original.categoryId || null;
        tile.category = matchedCat ? matchedCat.name : "未分类";
        tile.thumbnail = original.previewHash || "";
        tile.is_dirty = false;
        this.notify(CHANNEL.CONTENT, { instanceId });
    }
}
