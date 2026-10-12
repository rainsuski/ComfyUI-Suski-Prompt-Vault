/* File: ComfyUI-Suski-Prompt-Vault/web/js/state.js */

/**
 * 节点内部响应式状态机与脏状态追踪模块。
 * 管理当前节点已选磁贴实例、草稿暂存、跨平台换行符规范化脏标记比对、
 * 与持久化标准条目实体绑定同步以及隐藏 Widget 序列化双向绑定。
 */

import { clampAndRoundWeight } from "./utils/prompt_format.js";

/**
 * 规范化文本内容，消除换行符 (CRLF 与 LF) 及首尾多余空白引起的比较偏差。
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
 * @property {string|null} ref_preset_id - 关联的预设 ID (对应 entry.id)
 * @property {string} title - 磁贴名称
 * @property {string} prompt - 提示词内容 (对应 entry.text)
 * @property {string|null} category_id - 分类 ID (对应 entry.categoryId)
 * @property {string} category - 分类名称 (用于界面展示)
 * @property {number} weight - 当前权重 (默认 1.0)
 * @property {boolean} enabled - 是否参与拼接 (静音控制)
 * @property {boolean} is_dirty - 是否相对于关联预设发生了草稿修改
 * @property {string} thumbnail - 缩略图路径 (对应 entry.previewHash)
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
        if (this.activeInstanceId !== instanceId) {
            this.activeInstanceId = instanceId;
            this.notify();
        }
    }

    /**
     * 从标准 entry 实体生成已选磁贴实例。
     * @param {any} entry
     * @param {any[]} [categories=[]]
     * @returns {SelectedTileInstance}
     */
    addTileFromEntry(entry, categories = []) {
        const matchedCat = categories.find((c) => c.id === entry.categoryId);
        const catName = matchedCat ? matchedCat.name : "未分类";

        const newInstance = {
            instance_id: `tile_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            ref_preset_id: entry.id || null,
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
        this.notify();
        return newInstance;
    }

    addEmptyTile() {
        const emptyInstance = {
            instance_id: `tile_draft_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            ref_preset_id: null,
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
        this.notify();
        return emptyInstance;
    }

    removeTile(instanceId) {
        const index = this.selectedTiles.findIndex((t) => t.instance_id === instanceId);
        if (index === -1) return;

        this.selectedTiles.splice(index, 1);
        if (this.activeInstanceId === instanceId) {
            this.activeInstanceId = this.selectedTiles[0] ? this.selectedTiles[0].instance_id : null;
        }
        this.notify();
    }

    clearAllTiles() {
        this.selectedTiles = [];
        this.activeInstanceId = null;
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

    /**
     * 临时修改当前磁贴内容并做规范化脏标记比对。
     * @param {string} instanceId
     * @param {{ title?: string, prompt?: string, category_id?: string|null, category?: string }} updates
     * @param {any[]} [allEntries=[]]
     */
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

    /**
     * 将磁贴与新保存的持久化条目实体绑定并清除草稿脏标记。
     * @param {string} instanceId
     * @param {any} savedEntry
     * @param {any[]} [categories=[]]
     */
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

    /**
     * 重置磁贴内容回引用的预设初始值。
     * @param {string} instanceId
     * @param {any[]} allEntries
     * @param {any[]} [categories=[]]
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
        this.notify();
    }
}