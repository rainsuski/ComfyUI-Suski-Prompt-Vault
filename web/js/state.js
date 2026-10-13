/* File: ComfyUI-Suski-Prompt-Vault/web/js/state.js */

/**
 * 节点内部响应式状态机与脏状态追踪模块。
 * 管理当前节点已选磁贴实例、组合模板导入、组合原子性删除（删任意组员整组移除）、
 * 词库组反选移除、Shift 多选保护（不切换焦点）、批量拖拽排序、批量删除、就地成组绑定、
 * 悬浮预览焦点通知、草稿暂存、跨平台换行符规范化脏标记比对与 Widget 序列化双向绑定。
 */

import { clampAndRoundWeight } from "./utils/prompt_format.js";

/**
 * 预设高对比度暗黑科技主题色板，循环分配给不同的动态组合。
 */
const GROUP_PALETTE = ["#10b981", "#a855f7", "#06b6d4", "#f59e0b", "#ec4899"];

/**
 * 规范化文本内容，消除换行符及首尾多余空白引起的比较偏差。
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
    if (!text) return "";
    return text.replace(/\r\n/g, "\n").trim();
}

/**
 * 已选磁贴运行态实例类型定义
 * @typedef {Object} SelectedTileInstance
 * @property {string} instance_id - 运行时唯一标识
 * @property {string|null} ref_preset_id - 关联的预设条目 ID
 * @property {string|null} group_id - 所属动态组合的运行时唯一标识 (普通磁贴为 null)
 * @property {string|null} group_title - 所属动态组合的名称
 * @property {string|null} group_color - 所属组合分配的主题微光颜色
 * @property {string} title - 磁贴名称
 * @property {string} prompt - 提示词内容
 * @property {string|null} category_id - 分类 ID
 * @property {string} category - 分类名称
 * @property {number} weight - 当前权重
 * @property {boolean} enabled - 是否参与拼接
 * @property {boolean} is_dirty - 是否相对于关联预设发生了草稿修改
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
        /** @type {string|null} 鼠标悬停临时预览连线的组合 ID */
        this.hoveredGroupId = null;
        /** @type {Set<Function>} 状态变更订阅者回调集合 */
        this.subscribers = new Set();
    }

    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    notify() {
        this.syncToNodeWidget();
        this.subscribers.forEach((cb) => {
            try {
                cb(this);
            } catch (err) {
                console.error("[PromptVault] Error in subscriber callback:", err);
            }
        });
    }

    loadFromSerialized(jsonString) {
        try {
            if (!jsonString || jsonString.trim() === "") {
                this.selectedTiles = [];
            } else {
                const parsed = JSON.parse(jsonString);
                this.selectedTiles = Array.isArray(parsed) ? parsed : [];
            }
        } catch (err) {
            console.warn("[PromptVault] Failed to parse serialized tiles:", err);
            this.selectedTiles = [];
        }

        if (this.selectedTiles.length > 0 && !this.activeInstanceId) {
            this.activeInstanceId = this.selectedTiles[0].instance_id;
        }
        this.multiSelectedIds.clear();
        this.notify();
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
        this.notify();
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
        this.notify();
    }

    clearMultiSelect() {
        if (this.multiSelectedIds.size > 0) {
            this.multiSelectedIds.clear();
            this.notify();
        }
    }

    isMultiSelected(instanceId) {
        return this.multiSelectedIds.has(instanceId);
    }

    getMultiSelectedTiles() {
        return this.selectedTiles.filter((t) => this.multiSelectedIds.has(t.instance_id));
    }

    setHoveredGroupId(groupId) {
        if (this.hoveredGroupId !== groupId) {
            this.hoveredGroupId = groupId;
            this.subscribers.forEach((cb) => {
                try {
                    cb(this);
                } catch (err) {
                    console.error("[PromptVault] Error in subscriber callback:", err);
                }
            });
        }
    }

    addTileFromEntry(entry, categories = []) {
        const matchedCat = categories.find((c) => c.id === entry.categoryId);
        const catName = matchedCat ? matchedCat.name : "未分类";

        const newInstance = {
            instance_id: `tile_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            ref_preset_id: entry.id || null,
            group_id: null,
            group_title: null,
            group_color: null,
            title: entry.title || "未命名词条",
            prompt: entry.text || entry.prompt || "",
            category_id: entry.categoryId || null,
            category: catName,
            weight: 1.0,
            enabled: true,
            is_dirty: false,
            thumbnail: entry.previewHash || entry.thumbnail || "",
        };

        this.selectedTiles.push(newInstance);
        this.activeInstanceId = newInstance.instance_id;
        this.multiSelectedIds.clear();
        this.notify();
        return newInstance;
    }

    addGroupFromEntry(entry, categories = []) {
        const matchedCat = categories.find((c) => c.id === entry.categoryId);
        const catName = matchedCat ? matchedCat.name : "未分类";

        const members = Array.isArray(entry.groupMembers)
            ? entry.groupMembers
            : Array.isArray(entry.members)
                ? entry.members
                : [];

        if (members.length === 0) {
            return [this.addTileFromEntry(entry, categories)];
        }

        const newGroupId = `grp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const existingGroupIds = new Set(this.selectedTiles.map((t) => t.group_id).filter(Boolean));
        const colorIndex = existingGroupIds.size % GROUP_PALETTE.length;
        const assignedColor = GROUP_PALETTE[colorIndex];

        const createdInstances = members.map((member, idx) => {
            return {
                instance_id: `tile_grp_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 6)}`,
                ref_preset_id: entry.id || null,
                group_id: newGroupId,
                group_title: entry.title || "组合模板",
                group_color: assignedColor,
                title: member.title || `${entry.title || "组员"} #${idx + 1}`,
                prompt: member.text || member.prompt || "",
                category_id: entry.categoryId || null,
                category: catName,
                weight: 1.0,
                enabled: true,
                is_dirty: false,
                thumbnail: entry.previewHash || entry.thumbnail || "",
            };
        });

        this.selectedTiles.push(...createdInstances);
        if (createdInstances.length > 0) {
            this.activeInstanceId = createdInstances[0].instance_id;
        }
        this.multiSelectedIds.clear();
        this.notify();
        return createdInstances;
    }

    addEmptyTile() {
        const emptyInstance = {
            instance_id: `tile_draft_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            ref_preset_id: null,
            group_id: null,
            group_title: null,
            group_color: null,
            title: "临时空白词条",
            prompt: "",
            category_id: null,
            category: "未分类",
            weight: 1.0,
            enabled: true,
            is_dirty: true,
            thumbnail: "",
        };

        this.selectedTiles.push(emptyInstance);
        this.activeInstanceId = emptyInstance.instance_id;
        this.multiSelectedIds.clear();
        this.notify();
        return emptyInstance;
    }

    bindTilesToGroup(instanceIds, groupId, groupTitle, assignedColor = null, refPresetId = null) {
        if (!instanceIds || instanceIds.length === 0) return;

        let finalColor = assignedColor;
        if (!finalColor) {
            const existingGroupIds = new Set(this.selectedTiles.map((t) => t.group_id).filter(Boolean));
            const colorIndex = existingGroupIds.size % GROUP_PALETTE.length;
            finalColor = GROUP_PALETTE[colorIndex];
        }

        const idSet = new Set(instanceIds);
        this.selectedTiles.forEach((tile) => {
            if (idSet.has(tile.instance_id)) {
                tile.group_id = groupId;
                tile.group_title = groupTitle;
                tile.group_color = finalColor;
                if (refPresetId) {
                    tile.ref_preset_id = refPresetId;
                }
            }
        });

        this.multiSelectedIds.clear();
        this.notify();
    }

    /**
     * 删除指定磁贴。若该磁贴属于某个组合，则触发原子性删除，整组组员一并移除。
     * @param {string} instanceId
     */
    removeTile(instanceId) {
        const target = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!target) return;

        if (target.group_id) {
            this.removeGroupById(target.group_id);
            return;
        }

        const index = this.selectedTiles.indexOf(target);
        this.selectedTiles.splice(index, 1);
        this.multiSelectedIds.delete(instanceId);

        if (this.activeInstanceId === instanceId) {
            this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
        }
        this.notify();
    }

    /**
     * 根据运行时组 ID 原子性整组移除。
     * @param {string} groupId
     */
    removeGroupById(groupId) {
        if (!groupId) return;

        const removingIds = new Set(
            this.selectedTiles.filter((t) => t.group_id === groupId).map((t) => t.instance_id)
        );

        this.selectedTiles = this.selectedTiles.filter((t) => t.group_id !== groupId);

        removingIds.forEach((id) => this.multiSelectedIds.delete(id));

        if (removingIds.has(this.activeInstanceId)) {
            this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
        }
        this.notify();
    }

    /**
     * 根据来源词库预设 ID 原子性整组移除已选列表中的对应成员。
     * @param {string} presetId
     */
    removeGroupByPresetId(presetId) {
        if (!presetId) return;

        const matchingTiles = this.selectedTiles.filter((t) => t.ref_preset_id === presetId);
        if (matchingTiles.length === 0) return;

        const groupIds = new Set(matchingTiles.map((t) => t.group_id).filter(Boolean));
        if (groupIds.size > 0) {
            groupIds.forEach((gid) => this.removeGroupById(gid));
        } else {
            const removingIds = new Set(matchingTiles.map((t) => t.instance_id));
            this.selectedTiles = this.selectedTiles.filter((t) => t.ref_preset_id !== presetId);
            removingIds.forEach((id) => this.multiSelectedIds.delete(id));
            if (removingIds.has(this.activeInstanceId)) {
                this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
            }
            this.notify();
        }
    }

    removeMultiSelectedTiles() {
        if (this.multiSelectedIds.size === 0) return;

        const removedGroupIds = new Set();
        this.selectedTiles.forEach((t) => {
            if (this.multiSelectedIds.has(t.instance_id) && t.group_id) {
                removedGroupIds.add(t.group_id);
            }
        });

        this.selectedTiles = this.selectedTiles.filter((t) => {
            if (t.group_id && removedGroupIds.has(t.group_id)) {
                return false;
            }
            return !this.multiSelectedIds.has(t.instance_id);
        });

        if (this.multiSelectedIds.has(this.activeInstanceId) || !this.selectedTiles.some((t) => t.instance_id === this.activeInstanceId)) {
            this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
        }

        this.multiSelectedIds.clear();
        this.notify();
    }

    clearAllTiles() {
        this.selectedTiles = [];
        this.activeInstanceId = null;
        this.multiSelectedIds.clear();
        this.hoveredGroupId = null;
        this.notify();
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
        this.notify();
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
        this.notify();
    }

    adjustTileWeight(instanceId, delta) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        const current = typeof tile.weight === "number" ? tile.weight : 1.0;
        tile.weight = clampAndRoundWeight(current + delta);
        this.notify();
    }

    toggleTileEnabled(instanceId) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        tile.enabled = !tile.enabled;
        this.notify();
    }

    updateTileContent(instanceId, updates, allEntries = []) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        if (updates.title !== undefined) tile.title = updates.title;
        if (updates.prompt !== undefined) tile.prompt = updates.prompt;
        if (updates.category_id !== undefined) tile.category_id = updates.category_id;
        if (updates.category !== undefined) tile.category = updates.category;

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

        this.notify();
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
        this.notify();
    }

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
        this.notify();
    }
}