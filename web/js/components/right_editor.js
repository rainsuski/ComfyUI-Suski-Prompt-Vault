/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/right_editor.js */

/**
 * 右侧详情与实时编辑器组件。
 * 保持持久 DOM 引用以杜绝打字过程中的焦点丢失，
 * 直接与标准分类实体 (categoryId) 双向绑定，
 * 多重监听 input/change/blur 捕获外部三方格式化插件，
 * 点击入库时实时读取最新 DOM 内容并杜绝未格式化旧文本流出。
 */

import { isolateCanvasEvents, isolateWheelScroll } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";

/**
 * 递归扁平化分类树为带缩进的前缀下拉选项。
 * @param {any[]} categories
 * @returns {{ id: string, name: string, label: string }[]}
 */
function buildCategoryHierarchyOptions(categories) {
    const result = [{ id: "", name: "未分类", label: "未分类" }];
    const map = new Map();
    const roots = [];

    categories.forEach((c) => {
        map.set(c.id, { ...c, children: [] });
    });

    categories.forEach((c) => {
        if (c.parentId && map.has(c.parentId)) {
            map.get(c.parentId).children.push(map.get(c.id));
        } else {
            roots.push(map.get(c.id));
        }
    });

    function traverse(node, depth) {
        const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}└─ `;
        result.push({
            id: node.id,
            name: node.name,
            label: `${prefix}${node.name}`,
        });
        if (node.children) {
            node.children.forEach((child) => traverse(child, depth + 1));
        }
    }

    roots.forEach((root) => traverse(root, 0));
    return result;
}

export class RightEditorComponent {
    /**
     * @param {HTMLElement} container - 右栏宿主 DOM 容器
     * @param {import("../state.js").VaultNodeState} state - 状态机实例
     * @param {() => any[]} getEntriesCallback - 获取全量 entries 回调
     * @param {() => any[]} getCategoriesCallback - 获取全量 categories 回调
     * @param {(tileDraft: any) => void} onSaveToVaultCallback - 保存到词库回调
     */
    constructor(
        container,
        state,
        getEntriesCallback,
        getCategoriesCallback,
        onSaveToVaultCallback
    ) {
        this.container = container;
        this.state = state;
        this.getEntries = getEntriesCallback;
        this.getCategories = getCategoriesCallback;
        this.onSaveToVault = onSaveToVaultCallback;

        /** @type {string|null} 当前已渲染绑定的磁贴实例 ID */
        this.renderedInstanceId = null;

        this.initDOM();
        this.state.subscribe(() => this.updateView());
    }

    initDOM() {
        this.container.innerHTML = "";

        // 头部区域
        const header = document.createElement("div");
        header.className = "prompt-vault-col-header";
        header.innerHTML = `
      <div class="prompt-vault-header-title-bar">
        <span class="prompt-vault-col-title">词条详情与实时编辑</span>
        <span class="prompt-vault-editor-status" style="font-size:11px; color:var(--pv-text-muted);"></span>
      </div>
    `;
        this.statusLabel = header.querySelector(".prompt-vault-editor-status");
        this.container.appendChild(header);

        // 主体表单滚动容器
        this.body = document.createElement("div");
        this.body.className = "prompt-vault-editor-body";
        isolateWheelScroll(this.body);
        isolateCanvasEvents(this.body);

        // 空白占位状态
        this.emptyState = document.createElement("div");
        this.emptyState.className = "prompt-vault-empty-state";
        this.emptyState.innerHTML = `
      <div class="prompt-vault-empty-icon">${renderIcon("messageSquare", 28)}</div>
      <div>未选择磁贴</div>
      <div style="font-size:11px; opacity:0.7;">从左侧词库点击磁贴或点击中栏磁贴即可在此编辑</div>
    `;
        this.body.appendChild(this.emptyState);

        // 表单容器
        this.formContainer = document.createElement("div");
        this.formContainer.style.display = "none";
        this.formContainer.style.flexDirection = "column";
        this.formContainer.style.gap = "10px";
        this.formContainer.style.height = "100%";

        // 1. 词条名称编辑项
        const titleGroup = document.createElement("div");
        titleGroup.className = "prompt-vault-editor-group";
        titleGroup.innerHTML = `<label class="prompt-vault-editor-label">词条名称</label>`;
        this.titleInput = document.createElement("input");
        this.titleInput.type = "text";
        this.titleInput.className = "prompt-vault-input";
        this.titleInput.placeholder = "";

        const syncTitle = () => {
            const activeTile = this.state.getActiveTile();
            if (activeTile) {
                this.state.updateTileContent(
                    activeTile.instance_id,
                    { title: this.titleInput.value },
                    this.getEntries()
                );
            }
        };
        this.titleInput.addEventListener("input", syncTitle);
        this.titleInput.addEventListener("change", syncTitle);
        titleGroup.appendChild(this.titleInput);
        this.formContainer.appendChild(titleGroup);

        // 2. 分类编辑项：层级下拉框绑定 categoryId
        const catGroup = document.createElement("div");
        catGroup.className = "prompt-vault-editor-group";
        catGroup.innerHTML = `<label class="prompt-vault-editor-label">所属分类</label>`;
        this.catSelect = document.createElement("select");
        this.catSelect.className = "prompt-vault-select";
        this.catSelect.addEventListener("change", () => {
            const activeTile = this.state.getActiveTile();
            if (activeTile) {
                const catId = this.catSelect.value || null;
                const matched = this.getCategories().find((c) => c.id === catId);
                this.state.updateTileContent(
                    activeTile.instance_id,
                    {
                        category_id: catId,
                        category: matched ? matched.name : "未分类",
                    },
                    this.getEntries()
                );
            }
        });
        catGroup.appendChild(this.catSelect);
        this.formContainer.appendChild(catGroup);

        // 3. 提示词主体多行通用文本域
        const promptGroup = document.createElement("div");
        promptGroup.className = "prompt-vault-editor-group";
        promptGroup.style.flex = "1 1 0";
        promptGroup.style.display = "flex";
        promptGroup.style.flexDirection = "column";
        promptGroup.innerHTML = `<label class="prompt-vault-editor-label">提示词</label>`;

        this.textarea = document.createElement("textarea");
        this.textarea.className = "prompt-vault-editor-textarea comfy-multiline-input";
        this.textarea.placeholder = "";
        this.textarea.spellcheck = false;

        const syncPrompt = () => {
            const activeTile = this.state.getActiveTile();
            if (activeTile) {
                this.state.updateTileContent(
                    activeTile.instance_id,
                    { prompt: this.textarea.value },
                    this.getEntries()
                );
            }
        };
        this.textarea.addEventListener("input", syncPrompt);
        this.textarea.addEventListener("change", syncPrompt);
        this.textarea.addEventListener("blur", syncPrompt);

        promptGroup.appendChild(this.textarea);
        this.formContainer.appendChild(promptGroup);

        // 4. 底部动作控制条
        const actionsRow = document.createElement("div");
        actionsRow.className = "prompt-vault-editor-actions";

        this.revertBtn = document.createElement("button");
        this.revertBtn.type = "button";
        this.revertBtn.className = "prompt-vault-btn prompt-vault-btn-default";
        this.revertBtn.innerHTML = `<span>恢复原预设</span>`;
        this.revertBtn.title = "放弃临时修改，还原为引用的词库预设内容";
        this.revertBtn.addEventListener("click", () => {
            const activeTile = this.state.getActiveTile();
            if (activeTile) {
                this.state.revertTileToPreset(
                    activeTile.instance_id,
                    this.getEntries(),
                    this.getCategories()
                );
                this.titleInput.value = activeTile.title || "";
                this.catSelect.value = activeTile.category_id || "";
                this.textarea.value = activeTile.prompt || "";
            }
        });
        actionsRow.appendChild(this.revertBtn);

        this.saveToVaultBtn = document.createElement("button");
        this.saveToVaultBtn.type = "button";
        this.saveToVaultBtn.className = "prompt-vault-btn prompt-vault-btn-primary";
        this.saveToVaultBtn.innerHTML = `<span>保存至预设库</span>`;
        this.saveToVaultBtn.title = "将此词条正式收录或更新至本地持久化词库";
        this.saveToVaultBtn.addEventListener("click", () => {
            const activeTile = this.state.getActiveTile();
            if (activeTile) {
                const catId = this.catSelect.value || null;
                const matched = this.getCategories().find((c) => c.id === catId);

                this.state.updateTileContent(
                    activeTile.instance_id,
                    {
                        title: this.titleInput.value.trim(),
                        category_id: catId,
                        category: matched ? matched.name : "未分类",
                        prompt: this.textarea.value,
                    },
                    this.getEntries()
                );

                if (typeof this.onSaveToVault === "function") {
                    this.onSaveToVault(this.state.getActiveTile());
                }
            }
        });
        actionsRow.appendChild(this.saveToVaultBtn);

        this.formContainer.appendChild(actionsRow);
        this.body.appendChild(this.formContainer);
        this.container.appendChild(this.body);

        this.updateView();
    }

    refreshCategoryOptions() {
        const categories = this.getCategories();
        const options = buildCategoryHierarchyOptions(categories);
        const curVal = this.catSelect.value;

        this.catSelect.innerHTML = "";
        options.forEach((opt) => {
            const el = document.createElement("option");
            el.value = opt.id;
            el.textContent = opt.label;
            this.catSelect.appendChild(el);
        });

        if (curVal !== undefined) {
            this.catSelect.value = curVal;
        }
    }

    updateView() {
        this.refreshCategoryOptions();
        const activeTile = this.state.getActiveTile();

        if (!activeTile) {
            this.renderedInstanceId = null;
            if (this.statusLabel) this.statusLabel.textContent = "";
            this.emptyState.style.display = "flex";
            this.formContainer.style.display = "none";
            return;
        }

        this.emptyState.style.display = "none";
        this.formContainer.style.display = "flex";

        if (this.renderedInstanceId !== activeTile.instance_id) {
            this.renderedInstanceId = activeTile.instance_id;
            this.titleInput.value = activeTile.title || "";
            this.catSelect.value = activeTile.category_id || "";
            this.textarea.value = activeTile.prompt || "";
        } else if (!activeTile.is_dirty) {
            this.titleInput.value = activeTile.title || "";
            this.catSelect.value = activeTile.category_id || "";
            this.textarea.value = activeTile.prompt || "";
        }

        if (this.statusLabel) {
            this.statusLabel.textContent = activeTile.is_dirty ? "草稿未入库" : "已与预设同步";
            this.statusLabel.style.color = activeTile.is_dirty ? "var(--pv-accent-warning)" : "var(--pv-accent-success)";
        }
        this.revertBtn.disabled = !activeTile.is_dirty || !activeTile.ref_preset_id;
    }
}