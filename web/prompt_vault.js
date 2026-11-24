/* File: ComfyUI-Suski-Prompt-Vault/web/prompt_vault.js */

/**
 * ComfyUI-Suski-Prompt-Vault 前端主扩展注册入口。
 * 遵循归一化模型：entries 存放纯净词条，groups 存放关系组合。
 * 各节点保持独立工作流（适配分步采样），通过全局 WebSocket 广播与防抖同步词库。
 * 同时兼容 Classic Canvas 与 Nodes 2.0 Vue 渲染管线，屏蔽属性面板宽度污染。
 */

import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { fetchLibrary } from "./js/api.js";
import { LeftVaultComponent } from "./js/components/left_vault.js";
import { MiddleSelectedComponent } from "./js/components/middle_selected.js";
import {
    ExportModalManager,
    FavoriteModalManager,
    ImportModalManager,
    PresetModalManager,
    SaveGroupModalManager,
    TaxonomyModalManager,
    TileDeleteConfirmModal,
} from "./js/components/modal.js";
import { RightEditorComponent } from "./js/components/right_editor.js";
import { CHANNEL, VaultNodeState } from "./js/state.js";
import { isolateCanvasEvents } from "./js/utils/events.js";

/** 目标节点名称标识 */
const TARGET_NODE_TYPE = "PromptVaultSelector";

/** 节点默认与最小几何尺寸 */
const DEFAULT_NODE_WIDTH = 1120;
const DEFAULT_NODE_HEIGHT = 620;
const MIN_NODE_WIDTH = 960;
const MIN_NODE_HEIGHT = 520;
const MIN_DOM_WIDGET_HEIGHT = 460;

/** 运行时自增序号：保证撤销/重做同 ID 重建节点时不复用旧 DOM 包装器 */
let domWidgetTypeSeq = 0;

/** 全局标准库缓存数据 (对齐 suski-prompt-library v1 规范) */
let globalLibrary = {
    format: "suski-prompt-library",
    version: 1,
    categories: [],
    collections: [],
    tags: [],
    entries: [],
    groups: [],
    selection: { entryIds: [] },
};

/** 当前画布上所有活跃节点的状态实例集合 */
const activeNodeStates = new Set();

function injectStyleSheet(href) {
    const existing = document.querySelector(`link[href="${href}"]`);
    if (!existing) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = href;
        document.head.appendChild(link);
    }
}

injectStyleSheet(new URL("./css/prompt_vault.css", import.meta.url).href);
injectStyleSheet(new URL("./css/tile.css", import.meta.url).href);
injectStyleSheet(new URL("./css/modal.css", import.meta.url).href);

/**
 * 从后端获取最新词库并更新全局缓存。
 */
async function refreshGlobalData() {
    const res = await fetchLibrary();
    if (res && res.success && res.data) {
        globalLibrary = res.data;
    }
}

/**
 * 刷新全局词库缓存并通知所有活跃节点感知词库变动。
 * 保证 Promise 在数据拉取和状态分发完毕后再完成，杜绝弹窗重绘读到旧数据。
 */
async function notifyAllNodesRefresh() {
    await refreshGlobalData();
    for (const state of activeNodeStates) {
        state.notify(CHANNEL.LIBRARY);
    }
}

/**
 * 彻底隐藏序列化 Widget（同时屏蔽 Classic Canvas、Nodes 2.0 节点视图与属性侧栏）。
 * @param {any} widget 待隐藏的 widget 实例
 */
function makeWidgetInvisible(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.options = widget.options || {};
    widget.options.hidden = true;
    widget.options.hideInPanel = true;
    widget.options.surfaces = {
        canvas: "never",
        vueNode: "never",
        panel: "never",
    };
    widget.computeSize = () => [0, -4];
    widget.draw = () => { };

    if (widget.element) {
        widget.element.style.display = "none";
        widget.element.hidden = true;
    }
    if (widget.inputEl) {
        widget.inputEl.style.display = "none";
        widget.inputEl.hidden = true;
    }
}

/**
 * 配置主界面 DOM Widget 的展示面：在画布与 Vue 节点中渲染，在右侧属性面板中屏蔽。
 * @param {any} domWidget
 */
function applyDomWidgetSurfaceOptions(domWidget) {
    if (!domWidget) return;
    domWidget.options = domWidget.options || {};
    delete domWidget.options.canvasOnly;
    domWidget.options.hideInPanel = true;
    domWidget.options.hideOnZoom = true;
    domWidget.options.surfaces = {
        canvas: "shown",
        vueNode: "shown",
        panel: "never",
    };
}

app.registerExtension({
    name: "ComfyUI.Suski.PromptVault",

    async setup() {
        await refreshGlobalData();

        api.addEventListener("prompt_vault:library_updated", async () => {
            await notifyAllNodesRefresh();
        });
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET_NODE_TYPE) {
            return;
        }

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (typeof origOnNodeCreated === "function") {
                origOnNodeCreated.apply(this, arguments);
            }

            const node = this;

            node.flags = node.flags || {};
            node.flags.no_collapse = true;
            node.size = [DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT];

            const state = new VaultNodeState(node);
            node._vaultState = state;
            activeNodeStates.add(state);

            const origOnRemoved = node.onRemoved;
            node.onRemoved = function () {
                activeNodeStates.delete(state);
                if (typeof origOnRemoved === "function") {
                    origOnRemoved.apply(this, arguments);
                }
            };

            let dataWidget = node.widgets?.find((w) => w.name === "selected_tiles_data");
            if (!dataWidget) {
                dataWidget = node.addWidget("text", "selected_tiles_data", "[]", () => { });
            }

            makeWidgetInvisible(dataWidget);

            // 数据双向序列化锁定
            dataWidget.serializeValue = () => {
                const serialized = JSON.stringify(state.selectedTiles);
                dataWidget.value = serialized;
                return serialized;
            };

            const container = document.createElement("div");
            container.className = "prompt-vault-container";
            isolateCanvasEvents(container);

            const grid = document.createElement("div");
            grid.className = "prompt-vault-grid";

            const colLeft = document.createElement("div");
            colLeft.className = "prompt-vault-col prompt-vault-col-left";
            grid.appendChild(colLeft);

            const colMiddle = document.createElement("div");
            colMiddle.className = "prompt-vault-col prompt-vault-col-middle";
            grid.appendChild(colMiddle);

            const colRight = document.createElement("div");
            colRight.className = "prompt-vault-col prompt-vault-col-right";
            grid.appendChild(colRight);

            container.appendChild(grid);

            const notifyRefresh = async () => {
                await notifyAllNodesRefresh();
            };

            const presetModalManager = new PresetModalManager(
                () => globalLibrary,
                notifyRefresh
            );

            const tileDeleteConfirmModal = new TileDeleteConfirmModal(
                notifyRefresh
            );

            const favoriteModalManager = new FavoriteModalManager(
                () => globalLibrary.collections || [],
                notifyRefresh
            );

            const taxonomyModalManager = new TaxonomyModalManager(
                () => globalLibrary,
                notifyRefresh
            );

            const importModalManager = new ImportModalManager(
                () => globalLibrary,
                notifyRefresh
            );

            const exportModalManager = new ExportModalManager(
                () => globalLibrary
            );

            const saveGroupModalManager = new SaveGroupModalManager(
                () => globalLibrary,
                notifyRefresh
            );

            /**
             * 把中栏磁贴转换为预设弹窗入参。
             * @param {any} tileDraft
             */
            const buildTileEditorArgs = (tileDraft) => {
                const memberships = Array.isArray(tileDraft.groups) ? tileDraft.groups : [];
                const primary = memberships[0] || null;
                return {
                    data: {
                        id: tileDraft.ref_preset_id || undefined,
                        ref_preset_id: tileDraft.ref_preset_id || undefined,
                        group_id: primary ? primary.runtimeId : undefined,
                        group_preset_id: primary ? primary.presetId : undefined,
                        instance_id: tileDraft.instance_id,
                        title: tileDraft.title,
                        text: tileDraft.prompt,
                        nl: tileDraft.nl || "",
                        categoryId: tileDraft.category_id,
                        previewHash: tileDraft.thumbnail,
                    },
                    context: {
                        isGroupMember: Boolean(primary),
                        groupPresetId: primary ? primary.presetId : null,
                        instanceId: tileDraft.instance_id,
                        state,
                    },
                };
            };

            // 挂载左栏组件
            new LeftVaultComponent(
                colLeft,
                state,
                () => globalLibrary,
                (entry) => presetModalManager.open(entry),
                (entry) => favoriteModalManager.handleToggleFavorite(entry),
                () => taxonomyModalManager.open(),
                (entry) => tileDeleteConfirmModal.open(entry),
                () => importModalManager.open(),
                () => exportModalManager.open(state),
                (group) => saveGroupModalManager.openEdit(group)
            );

            // 挂载中栏组件
            new MiddleSelectedComponent(
                colMiddle,
                state,
                () => globalLibrary,
                (tileDraft) => {
                    if (!tileDraft) return;
                    const { data, context } = buildTileEditorArgs(tileDraft);
                    presetModalManager.open(data, context);
                },
                notifyRefresh
            );

            // 挂载右栏组件
            new RightEditorComponent(
                colRight,
                state,
                () => globalLibrary.entries || [],
                () => globalLibrary.categories || [],
                (tileDraft) => {
                    if (!tileDraft) return;
                    const { data, context } = buildTileEditorArgs(tileDraft);
                    presetModalManager.open(data, {
                        ...context,
                        onSaved: async (savedEntry) => {
                            await refreshGlobalData();
                            if (savedEntry) {
                                state.markTileAsSavedToPreset(
                                    tileDraft.instance_id,
                                    savedEntry,
                                    globalLibrary.categories || []
                                );
                            }
                            await notifyAllNodesRefresh();
                        },
                    });
                }
            );

            const runtimeWidgetType = `prompt_vault_ui_${++domWidgetTypeSeq}`;
            const domWidget = node.addDOMWidget("prompt_vault_ui", runtimeWidgetType, container, {
                serialize: false,
                hideInPanel: true,
                hideOnZoom: true,
                surfaces: {
                    canvas: "shown",
                    vueNode: "shown",
                    panel: "never",
                },
                getValue() {
                    return JSON.stringify(state.selectedTiles);
                },
                setValue(value) {
                    if (typeof value !== "string") return;
                    if (value === JSON.stringify(state.selectedTiles)) return;
                    state.loadFromSerialized(value);
                },
                getMinHeight() {
                    return MIN_DOM_WIDGET_HEIGHT;
                },
            });

            if (domWidget) {
                applyDomWidgetSurfaceOptions(domWidget);

                // 防止侧栏渲染器回写覆盖 widget.width 引起画布布局塌陷
                try {
                    const desc = Object.getOwnPropertyDescriptor(domWidget, "width");
                    if (!desc || desc.configurable) {
                        Object.defineProperty(domWidget, "width", {
                            get() {
                                return undefined;
                            },
                            set(_) { },
                            configurable: true,
                            enumerable: true,
                        });
                    }
                } catch (err) {
                    console.warn("[PromptVault] Failed to define width guard on domWidget", err);
                }
            }
        };

        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            if (typeof origOnConfigure === "function") {
                origOnConfigure.apply(this, arguments);
            }

            const node = this;
            if (Array.isArray(node.size)) {
                const targetW = Math.max(node.size[0] || 0, MIN_NODE_WIDTH);
                const targetH = Math.max(node.size[1] || 0, MIN_NODE_HEIGHT);
                if (targetW !== node.size[0] || targetH !== node.size[1]) {
                    if (typeof node.setSize === "function") {
                        node.setSize([targetW, targetH]);
                    } else {
                        node.size[0] = targetW;
                        node.size[1] = targetH;
                    }
                }
            }

            if (node._vaultState) {
                const dataWidget = node.widgets?.find((w) => w.name === "selected_tiles_data");
                if (dataWidget) {
                    makeWidgetInvisible(dataWidget);
                }
                const serializedValue = dataWidget ? dataWidget.value : "[]";
                node._vaultState.loadFromSerialized(serializedValue);

                const domWidget = node.widgets?.find((w) => w.name === "prompt_vault_ui");
                applyDomWidgetSurfaceOptions(domWidget);
            }
        };

        const origOnResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            if (typeof origOnResize === "function") {
                origOnResize.apply(this, arguments);
            }
            if (size[0] < MIN_NODE_WIDTH) size[0] = MIN_NODE_WIDTH;
            if (size[1] < MIN_NODE_HEIGHT) size[1] = MIN_NODE_HEIGHT;
        };
    },
});