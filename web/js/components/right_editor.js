/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/right_editor.js */

/**
 * 右侧详情与实时编辑器组件。
 * 保持持久 DOM 引用以杜绝输入过程中的焦点丢失，
 * 所属分类全面升级为多级树状下拉选择器，完美兼容 Autocomplete Plus 联想补全。
 */

import { isolateCanvasEvents, isolateWheelScroll } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";

/**
 * 将平铺分类树展开为带缩进前缀的扁平下拉选项列表。
 * @param {any[]} categories
 * @returns {{ name: string, label: string }[]}
 */
function buildCategoryHierarchyOptions(categories) {
    const result = [{ name: "未分类", label: "未分类" }];
    const map = new Map();
    const roots = [];

    categories.forEach((c) => {
        map.set(c.id, { ...c, children: [] });
    });

    categories.forEach((c) => {
        if (c.parent_id && map.has(c.parent_id)) {
            map.get(c.parent_id).children.push(map.get(c.id));
        } else {
            roots.push(map.get(c.id));
        }
    });

    function traverse(node, depth) {
        const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}└─ `;
        result.push({
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
     * @param {() => any[]} getPresetsCallback - 获取全量预设列表回调
     * @param {() => any[]} getCategoriesCallback - 获取全量分类树回调
     * @param {(tileDraft: any) => void} onSaveToVaultCallback - 保存到词库回调
     */
    constructor(
        container,
        state,
        getPresetsCallback,
        getCategoriesCallback,
        onSaveToVaultCallback
    ) {
        this.container = container;
        this.state = state;
        this.getPresets = getPresetsCallback;
        this.getCategories = getCategoriesCallback;
        this.onSaveToVault = onSaveToVaultCallback;

        /** @type {string|null} 当前已渲染绑定的磁贴实例 ID */
        this.renderedInstanceId = null;

        this.initDOM();
        this.state.subscribe(() => this.updateView());
    }

    /**
     * 初始化一次性持久化 DOM 结构，避免重复销毁重建引起打字焦点丢失。
     */
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
        this.titleInput.placeholder = "输入磁贴名称...";
        this.titleInput.addEventListener("input", () => {
            const activeTile = this.state.getActiveTile();
            if (activeTile) {
                this.state.updateTileContent(
                    activeTile.instance_id,
                    { title: this.titleInput.value },
                    this.getPresets()
                );
            }
        });
        titleGroup.appendChild(this.titleInput);
        this.formContainer.appendChild(titleGroup);

        // 2. 分类编辑项：升级为层级下拉框
        const catGroup = document.createElement("div");
        catGroup.className = "prompt-vault-editor-group";
        catGroup.innerHTML = `<label class="prompt-vault-editor-label">所属分类</label>`;
        this.catSelect = document.createElement("select");
        this.catSelect.className = "prompt-vault-select";
        this.catSelect.addEventListener("change", () => {
            const activeTile = this.state.getActiveTile();
            if (activeTile) {
                this.state.updateTileContent(
                    activeTile.instance_id,
                    { category: this.catSelect.value },
                    this.getPresets()
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
        promptGroup.innerHTML = `<label class="prompt-vault-editor-label">提示词 Prompt 内容 (原生文本框)</label>`;

        this.textarea = document.createElement("textarea");
        this.textarea.className = "prompt-vault-editor-textarea comfy-multiline-input";
        this.textarea.placeholder = "输入提示词，支持逗号分隔与原生加权语法...";
        this.textarea.spellcheck = false;
        this.textarea.addEventListener("input", () => {
            const activeTile = this.state.getActiveTile();
            if (activeTile) {
                this.state.updateTileContent(
                    activeTile.instance_id,
                    { prompt: this.textarea.value },
                    this.getPresets()
                );
            }
        });
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
                this.state.revertTileToPreset(activeTile.instance_id, this.getPresets());
                this.titleInput.value = activeTile.title || "";
                this.catSelect.value = activeTile.category || "未分类";
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
            if (activeTile && typeof this.onSaveToVault === "function") {
                this.onSaveToVault(activeTile);
            }
        });
        actionsRow.appendChild(this.saveToVaultBtn);

        this.formContainer.appendChild(actionsRow);
        this.body.appendChild(this.formContainer);
        this.container.appendChild(this.body);

        this.updateView();
    }

    /**
     * 刷新分类下拉框选项。
     */
    refreshCategoryOptions() {
        const categories = this.getCategories();
        const options = buildCategoryHierarchyOptions(categories);
        const curVal = this.catSelect.value;

        this.catSelect.innerHTML = "";
        options.forEach((opt) => {
            const el = document.createElement("option");
            el.value = opt.name;
            el.textContent = opt.label;
            this.catSelect.appendChild(el);
        });

        if (curVal) {
            this.catSelect.value = curVal;
        }
    }

    /**
     * 响应状态更新，更新控件数据且不打断当前正在输入的焦点。
     */
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

        // 仅在切换到不同磁贴时同步更新输入控件的值
        if (this.renderedInstanceId !== activeTile.instance_id) {
            this.renderedInstanceId = activeTile.instance_id;
            this.titleInput.value = activeTile.title || "";
            this.catSelect.value = activeTile.category || "未分类";
            this.textarea.value = activeTile.prompt || "";
        }

        if (this.statusLabel) {
            this.statusLabel.textContent = activeTile.is_dirty ? "草稿未入库" : "已与预设同步";
            this.statusLabel.style.color = activeTile.is_dirty ? "var(--pv-accent-warning)" : "var(--pv-accent-success)";
        }
        this.revertBtn.disabled = !activeTile.is_dirty || !activeTile.ref_preset_id;
    }
}