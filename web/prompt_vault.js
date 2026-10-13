/* File: ComfyUI-Suski-Prompt-Vault/web/prompt_vault.js */

/**
 * ComfyUI-Suski-Prompt-Vault 前端主扩展注册入口。
 * 全面对齐 aaalice-prompt-library v2 标准数据模型，
 * 装配三栏布局、管理全局标准库状态树、生命周期持久化、
 * 接入导入预检冲突处理中心及导出预览统计中心。
 * 通过 WebSocket 监听词库变更广播，实现多节点多端视图实时响应与同步。
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
    TaxonomyModalManager,
    TileDeleteConfirmModal,
} from "./js/components/modal.js";
import { RightEditorComponent } from "./js/components/right_editor.js";
import { VaultNodeState } from "./js/state.js";
import { isolateCanvasEvents } from "./js/utils/events.js";

/** 目标节点名称标识 */
const TARGET_NODE_TYPE = "PromptVaultSelector";

/** 全局标准库缓存数据 (直接对齐 library.json 结构) */
let globalLibrary = {
    format: "aaalice-prompt-library",
    version: 2,
    categories: [],
    collections: [],
    tags: [],
    entries: [],
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
 * 刷新全局词库缓存并通知所有活跃节点重新渲染。
 */
async function notifyAllNodesRefresh() {
    await refreshGlobalData();
    for (const state of activeNodeStates) {
        state.notify();
    }
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
            node.size = [1120, 620];

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
            dataWidget.computeSize = () => [0, -4];
            dataWidget.draw = () => { };
            dataWidget.serializeValue = () => JSON.stringify(state.selectedTiles);

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

            const importInput = document.createElement("input");
            importInput.type = "file";
            importInput.accept = ".json";
            importInput.style.display = "none";
            importInput.addEventListener("change", (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        try {
                            const text = String(event.target.result || "").replace(/^\ufeff/, "");
                            const parsed = JSON.parse(text);
                            importModalManager.open(parsed, file.name, file.size);
                        } catch (err) {
                            alert(`读取 JSON 文件失败: ${String(err)}`);
                        }
                    };
                    reader.readAsText(file);
                    importInput.value = "";
                }
            });
            container.appendChild(importInput);

            // 挂载左栏组件
            new LeftVaultComponent(
                colLeft,
                state,
                () => globalLibrary,
                (entry) => presetModalManager.open(entry),
                (entry) => favoriteModalManager.handleToggleFavorite(entry),
                () => taxonomyModalManager.open(),
                (entry) => tileDeleteConfirmModal.open(entry),
                () => importInput.click(),
                () => exportModalManager.open()
            );

            // 挂载中栏组件：向中栏透传全量 globalLibrary 回调，确保组合弹窗具备全库 entries 检索能力
            new MiddleSelectedComponent(
                colMiddle,
                state,
                () => globalLibrary,
                (tileDraft) => {
                    if (!tileDraft) return;
                    presetModalManager.open(
                        {
                            title: tileDraft.title,
                            text: tileDraft.prompt,
                            categoryId: tileDraft.category_id,
                            previewHash: tileDraft.thumbnail,
                        },
                        {
                            isGroupMember: false,
                            instanceId: tileDraft.instance_id,
                            state: state,
                        }
                    );
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
                    const isGroupMember = Boolean(tileDraft.group_id);
                    presetModalManager.open(
                        {
                            id: isGroupMember ? undefined : (tileDraft.ref_preset_id || undefined),
                            ref_preset_id: tileDraft.ref_preset_id || undefined,
                            group_id: tileDraft.group_id || undefined,
                            instance_id: tileDraft.instance_id,
                            title: tileDraft.title,
                            text: tileDraft.prompt,
                            categoryId: tileDraft.category_id,
                            previewHash: tileDraft.thumbnail,
                        },
                        {
                            isGroupMember: isGroupMember,
                            instanceId: tileDraft.instance_id,
                            parentPresetId: tileDraft.ref_preset_id,
                            state: state,
                        }
                    );
                    presetModalManager.onSaved = async (savedEntry) => {
                        await refreshGlobalData();
                        if (savedEntry && !isGroupMember) {
                            state.markTileAsSavedToPreset(
                                tileDraft.instance_id,
                                savedEntry,
                                globalLibrary.categories || []
                            );
                        }
                        await notifyAllNodesRefresh();
                    };
                }
            );

            node.addDOMWidget("prompt_vault_ui", "custom", container, {
                serialize: false,
                getValue() {
                    return JSON.stringify(state.selectedTiles);
                },
                setValue(value) {
                    state.loadFromSerialized(value);
                },
                getMinHeight() {
                    return 520;
                },
            });
        };

        const origOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            if (typeof origOnConfigure === "function") {
                origOnConfigure.apply(this, arguments);
            }

            const node = this;
            if (node._vaultState) {
                let dataWidget = node.widgets?.find((w) => w.name === "selected_tiles_data");
                const serializedValue = dataWidget ? dataWidget.value : "[]";
                node._vaultState.loadFromSerialized(serializedValue);
            }
        };

        const origOnResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            if (typeof origOnResize === "function") {
                origOnResize.apply(this, arguments);
            }
            if (size[0] < 960) size[0] = 960;
            if (size[1] < 520) size[1] = 520;
        };
    },
});