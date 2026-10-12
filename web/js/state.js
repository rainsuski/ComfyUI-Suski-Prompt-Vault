/* File: ComfyUI-Suski-Prompt-Vault/web/js/state.js */

/**
 * 节点内部响应式状态机与脏状态追踪模块。
 * 管理当前节点已选磁贴实例、草稿暂存、跨平台换行符规范化脏标记比对、
 * 与持久化预设绑定同步以及隐藏 Widget 序列化双向绑定。
 */

import { clampAndRoundWeight } from "./utils/prompt_format.js";

/**
 * 已选磁贴运行态实例类型定义
 * @typedef {Object} SelectedTileInstance
 * @property {string} instance_id - 运行时唯一标识
 * @property {string|null} ref_preset_id - 关联的预设 ID
 * @property {string} title - 磁贴名称
 * @property {string} prompt - 提示词内容
 * @property {string} category - 分类名称
 * @property {number} weight - 当前权重 (默认 1.0)
 * @property {boolean} enabled - 是否参与拼接 (静音控制)
 * @property {boolean} is_dirty - 是否相对于关联预设发生了草稿修改
 * @property {string} thumbnail - 缩略图路径
 */

/**
 * 规范化文本内容，消除换行符 (CRLF 与 LF) 及首尾多余空白引起的比较偏差。
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
    if (!text) return "";
    return text.replace(/\r\n/g, "\n").trim();
}

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
        /** @type {Set<Function>} 状态变更订阅者回调集合 */
        this.subscribers = new Set();
    }

    /**
     * 注册视图更新监听器。
     * @param {Function} callback
     * @returns {() => void} 注销订阅函数
     */
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /**
     * 触发全部订阅者更新并同步序列化至节点数据 Widget。
     */
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

    /**
     * 从 JSON 序列化字符串恢复已选磁贴列表。
     * @param {string} jsonString
     */
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
        this.notify();
    }

    /**
     * 将当前磁贴数组同步至 LiteGraph 节点的数据 Widget。
     */
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

    /**
     * 获取当前处于激活编辑态的磁贴实例。
     * @returns {SelectedTileInstance|null}
     */
    getActiveTile() {
        if (!this.activeInstanceId) return null;
        return this.selectedTiles.find((t) => t.instance_id === this.activeInstanceId) || null;
    }

    /**
     * 设定当前激活编辑的磁贴。
     * @param {string|null} instanceId
     */
    setActiveTile(instanceId) {
        if (this.activeInstanceId !== instanceId) {
            this.activeInstanceId = instanceId;
            this.notify();
        }
    }

    /**
     * 向已选列表新增磁贴。
     * @param {any} preset
     * @returns {SelectedTileInstance}
     */
    addTileFromPreset(preset) {
        const newInstance = {
            instance_id: `tile_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            ref_preset_id: preset.id || null,
            title: preset.title || "未命名词条",
            prompt: preset.prompt || "",
            category: preset.category || "未分类",
            weight: 1.0,
            enabled: true,
            is_dirty: false,
            thumbnail: preset.thumbnail || "",
        };

        this.selectedTiles.push(newInstance);
        this.activeInstanceId = newInstance.instance_id;
        this.notify();
        return newInstance;
    }

    /**
     * 插入空白临时磁贴。
     * @returns {SelectedTileInstance}
     */
    addEmptyTile() {
        const emptyInstance = {
            instance_id: `tile_draft_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            ref_preset_id: null,
            title: "临时空白词条",
            prompt: "",
            category: "未分类",
            weight: 1.0,
            enabled: true,
            is_dirty: true,
            thumbnail: "",
        };

        this.selectedTiles.push(emptyInstance);
        this.activeInstanceId = emptyInstance.instance_id;
        this.notify();
        return emptyInstance;
    }

    /**
     * 移除指定磁贴。
     * @param {string} instanceId
     */
    removeTile(instanceId) {
        const index = this.selectedTiles.findIndex((t) => t.instance_id === instanceId);
        if (index === -1) return;

        this.selectedTiles.splice(index, 1);
        if (this.activeInstanceId === instanceId) {
            this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
        }
        this.notify();
    }

    /**
     * 清空全部已选磁贴。
     */
    clearAllTiles() {
        this.selectedTiles = [];
        this.activeInstanceId = null;
        this.notify();
    }

    /**
     * 移动磁贴位置（拖拽排序响应）。
     * @param {number} fromIndex
     * @param {number} toIndex
     */
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

    /**
     * 滚轮微调磁贴权重（步长 0.1）。
     * @param {string} instanceId
     * @param {number} delta
     */
    adjustTileWeight(instanceId, delta) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        const current = typeof tile.weight === "number" ? tile.weight : 1.0;
        tile.weight = clampAndRoundWeight(current + delta);
        this.notify();
    }

    /**
     * 切换磁贴启用/静音状态。
     * @param {string} instanceId
     */
    toggleTileEnabled(instanceId) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        tile.enabled = !tile.enabled;
        this.notify();
    }

    /**
     * 临时修改当前磁贴内容并更新脏标记（对齐换行符与空格）。
     * @param {string} instanceId
     * @param {{ title?: string, prompt?: string, category?: string }} updates
     * @param {any[]} [allPresets=[]]
     */
    updateTileContent(instanceId, updates, allPresets = []) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile) return;

        if (updates.title !== undefined) tile.title = updates.title;
        if (updates.prompt !== undefined) tile.prompt = updates.prompt;
        if (updates.category !== undefined) tile.category = updates.category;

        if (!tile.ref_preset_id) {
            tile.is_dirty = true;
        } else {
            const original = allPresets.find((p) => p.id === tile.ref_preset_id);
            if (original) {
                const titleChanged = normalizeText(original.title) !== normalizeText(tile.title);
                const promptChanged = normalizeText(original.prompt) !== normalizeText(tile.prompt);
                const categoryChanged = (original.category || "未分类") !== (tile.category || "未分类");
                tile.is_dirty = titleChanged || promptChanged || categoryChanged;
            } else {
                tile.is_dirty = true;
            }
        }

        this.notify();
    }

    /**
     * 将磁贴与新保存的持久化预设项绑定并清除草稿脏标记。
     * @param {string} instanceId
     * @param {any} savedPreset
     */
    markTileAsSavedToPreset(instanceId, savedPreset) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile || !savedPreset) return;

        tile.ref_preset_id = savedPreset.id;
        tile.title = savedPreset.title || tile.title;
        tile.prompt = savedPreset.prompt || tile.prompt;
        tile.category = savedPreset.category || tile.category;
        tile.thumbnail = savedPreset.thumbnail || tile.thumbnail;
        tile.is_dirty = false;
        this.notify();
    }

    /**
     * 重置磁贴内容回引用的预设初始值。
     * @param {string} instanceId
     * @param {any[]} allPresets
     */
    revertTileToPreset(instanceId, allPresets) {
        const tile = this.selectedTiles.find((t) => t.instance_id === instanceId);
        if (!tile || !tile.ref_preset_id) return;

        const original = allPresets.find((p) => p.id === tile.ref_preset_id);
        if (!original) return;

        tile.title = original.title;
        tile.prompt = original.prompt;
        tile.category = original.category || "未分类";
        tile.thumbnail = original.thumbnail || "";
        tile.is_dirty = false;
        this.notify();
    }
}