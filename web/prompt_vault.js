/* File: ComfyUI-Suski-Prompt-Vault/web/prompt_vault.js */

/**
 * ComfyUI-Suski-Prompt-Vault 前端主扩展注册入口。
 * 负责装配三栏布局、管理全局分类与收藏夹状态树、
 * 绑定生命周期持久化与全套弹窗交互。
 */

import { app } from "../../../scripts/app.js";
import { fetchPresets, fetchTaxonomies, importPresets, upsertPreset } from "./js/api.js";
import { LeftVaultComponent } from "./js/components/left_vault.js";
import { MiddleSelectedComponent } from "./js/components/middle_selected.js";
import {
    FavoriteModalManager,
    PresetModalManager,
    TaxonomyModalManager,
} from "./js/components/modal.js";
import { RightEditorComponent } from "./js/components/right_editor.js";
import { VaultNodeState } from "./js/state.js";
import { isolateCanvasEvents } from "./js/utils/events.js";

/** 目标节点名称标识 */
const TARGET_NODE_TYPE = "PromptVaultSelector";

/** 全局预设、分类与收藏夹数据共享缓存池 */
let globalPresets = [];
let globalTaxonomies = { categories: [], folders: [] };

/**
 * 动态注入样式表链接。
 * @param {string} href
 */
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

// 预加载样式表
injectStyleSheet(new URL("./css/prompt_vault.css", import.meta.url).href);
injectStyleSheet(new URL("./css/tile.css", import.meta.url).href);
injectStyleSheet(new URL("./css/modal.css", import.meta.url).href);

/**
 * 全量刷新全局词库与层级分类数据。
 * @returns {Promise<void>}
 */
async function refreshGlobalData() {
    const [presetsRes, taxonomiesRes] = await Promise.all([
        fetchPresets(),
        fetchTaxonomies(),
    ]);

    if (presetsRes.success) {
        globalPresets = presetsRes.presets;
    }
    if (taxonomiesRes.success) {
        globalTaxonomies = taxonomiesRes.data;
    }
}

app.registerExtension({
    name: "ComfyUI.Suski.PromptVault",

    async setup() {
        await refreshGlobalData();
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

            // 1. 节点规格与防折叠
            node.flags = node.flags || {};
            node.flags.no_collapse = true;
            node.size = [1120, 620];

            // 2. 状态机
            const state = new VaultNodeState(node);
            node._vaultState = state;

            // 3. 内部序列化专用数据插槽隐藏与自动捕获
            let dataWidget = node.widgets?.find((w) => w.name === "selected_tiles_data");
            if (!dataWidget) {
                dataWidget = node.addWidget("text", "selected_tiles_data", "[]", () => { });
            }
            dataWidget.computeSize = () => [0, -4];
            dataWidget.draw = () => { };
            dataWidget.serializeValue = () => JSON.stringify(state.selectedTiles);

            // 4. 三栏 DOM 容器构造
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

            // 5. 隐藏 JSON 导入专用文件域
            const importInput = document.createElement("input");
            importInput.type = "file";
            importInput.accept = ".json";
            importInput.style.display = "none";
            importInput.addEventListener("change", async (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) {
                    const res = await importPresets(file, "merge");
                    if (res.success) {
                        await refreshGlobalData();
                        state.notify();
                    } else {
                        alert(`导入失败: ${res.error || "数据格式错误"}`);
                    }
                    importInput.value = "";
                }
            });
            container.appendChild(importInput);

            // 6. 实例化全套弹窗管理器
            const notifyRefresh = async () => {
                await refreshGlobalData();
                state.notify();
            };

            const presetModalManager = new PresetModalManager(
                () => globalTaxonomies,
                notifyRefresh
            );

            const favoriteModalManager = new FavoriteModalManager(
                () => globalTaxonomies.folders,
                notifyRefresh
            );

            const taxonomyModalManager = new TaxonomyModalManager(
                () => globalTaxonomies,
                notifyRefresh
            );

            // 7. 挂载左栏词库组件
            new LeftVaultComponent(
                colLeft,
                state,
                () => globalPresets,
                () => globalTaxonomies,
                (preset) => presetModalManager.open(preset),
                (preset) => favoriteModalManager.handleToggleFavorite(preset),
                () => taxonomyModalManager.open(),
                () => importInput.click()
            );

            // 8. 挂载中栏已选组件
            new MiddleSelectedComponent(
                colMiddle,
                state,
                () => globalTaxonomies.categories,
                (tileDraft) => {
                    presetModalManager.open({
                        title: tileDraft.title,
                        prompt: tileDraft.prompt,
                        category: tileDraft.category,
                        thumbnail: tileDraft.thumbnail,
                    });
                }
            );

            // 9. 挂载右栏编辑器组件
            new RightEditorComponent(
                colRight,
                state,
                () => globalPresets,
                () => globalTaxonomies.categories,
                (tileDraft) => {
                    presetModalManager.open({
                        id: tileDraft.ref_preset_id || undefined,
                        title: tileDraft.title,
                        prompt: tileDraft.prompt,
                        category: tileDraft.category,
                        thumbnail: tileDraft.thumbnail,
                    });
                }
            );

            // 10. 挂载 DOM Widget
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

        // 工作流加载生命周期钩子
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

        // 尺寸限制约束
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