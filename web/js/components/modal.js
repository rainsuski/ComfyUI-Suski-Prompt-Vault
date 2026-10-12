/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modal.js */

/**
 * 全量弹窗模块管理器。
 * 包含：
 * 1. PresetModalManager: 词条录入/编辑弹窗（保存成功直接传递服务端返回的最新预设实体）；
 * 2. TileDeleteConfirmModal: 词条删除专属二次确认弹窗；
 * 3. FavoriteModalManager: 词条轻量收藏联动弹窗；
 * 4. TaxonomyModalManager: 分类与收藏夹多级管理中心。
 */

import {
    deletePreset,
    deleteTaxonomyItem,
    getThumbnailUrl,
    upsertPreset,
    upsertTaxonomyItem,
} from "../api.js";
import { isolateCanvasEvents } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";

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

export class PresetModalManager {
    /**
     * @param {() => { categories: any[], folders: any[] }} getTaxonomiesCallback
     * @param {(savedData?: any) => Promise<void>} onSavedCallback
     */
    constructor(getTaxonomiesCallback, onSavedCallback) {
        this.getTaxonomies = getTaxonomiesCallback;
        this.onSaved = onSavedCallback;
        this.pendingImageFile = null;
        this.targetData = null;
        this.onPasteHandler = this.handleGlobalPaste.bind(this);
    }

    open(initialData = null) {
        this.close();
        this.targetData = initialData;
        this.pendingImageFile = null;

        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        const isEditMode = Boolean(initialData && initialData.id);
        const { categories, folders } = this.getTaxonomies();
        const categoryOptions = buildCategoryHierarchyOptions(categories);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">${isEditMode ? "编辑预设条目" : "新建预设条目"}</div>
          <button type="button" class="prompt-vault-modal-close" title="关闭">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div class="prompt-vault-form-row">
            <div class="prompt-vault-form-col">
              <label class="prompt-vault-form-label">标题 *</label>
              <input type="text" class="prompt-vault-form-input" id="pv-form-title" placeholder="" />
            </div>
            <div class="prompt-vault-form-col">
              <label class="prompt-vault-form-label">所属分类</label>
              <select class="prompt-vault-form-select" id="pv-form-category">
                ${categoryOptions.map((opt) => `<option value="${opt.name}">${opt.label}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="prompt-vault-form-col">
            <label class="prompt-vault-form-label">提示词 Prompt 内容 *</label>
            <textarea class="prompt-vault-form-textarea" id="pv-form-prompt" placeholder=""></textarea>
          </div>

          <div class="prompt-vault-form-row">
            <div class="prompt-vault-form-col">
              <label class="prompt-vault-form-label">标签 Tags (逗号分隔)</label>
              <input type="text" class="prompt-vault-form-input" id="pv-form-tags" placeholder="" />
            </div>
            <div class="prompt-vault-form-col">
              <label class="prompt-vault-form-label">加入收藏夹</label>
              <select class="prompt-vault-form-select" id="pv-form-folder">
                <option value="">不加入收藏 (默认)</option>
                ${folders.map((f) => `<option value="${f.name}">${f.name}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="prompt-vault-form-col">
            <label class="prompt-vault-form-label">备注与使用说明</label>
            <input type="text" class="prompt-vault-form-input" id="pv-form-note" placeholder="" />
          </div>

          <div class="prompt-vault-form-col">
            <label class="prompt-vault-form-label">预览缩略图</label>
            <div class="prompt-vault-thumb-uploader">
              <div class="prompt-vault-thumb-preview" id="pv-form-thumb-preview">
                ${renderIcon("messageSquare", 24)}
              </div>
              <div class="prompt-vault-thumb-dropzone" id="pv-form-thumb-dropzone">
                <div style="font-weight: 500;">点击或拖拽上传预览图</div>
                <div class="prompt-vault-dropzone-hint">
                  支持直接截图后 <kbd class="prompt-vault-dropzone-kbd">Ctrl + V</kbd> 粘贴
                </div>
                <input type="file" class="prompt-vault-hidden-file" id="pv-form-file-input" accept="image/*" />
              </div>
            </div>
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-modal-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-modal-save">保存</button>
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);
        this.fillFormData(initialData);
        this.bindEvents();
        window.addEventListener("paste", this.onPasteHandler, true);
    }

    fillFormData(data) {
        const titleInput = this.overlay.querySelector("#pv-form-title");
        const categorySelect = this.overlay.querySelector("#pv-form-category");
        const promptInput = this.overlay.querySelector("#pv-form-prompt");
        const tagsInput = this.overlay.querySelector("#pv-form-tags");
        const folderSelect = this.overlay.querySelector("#pv-form-folder");
        const noteInput = this.overlay.querySelector("#pv-form-note");
        const previewBox = this.overlay.querySelector("#pv-form-thumb-preview");

        if (data) {
            if (titleInput) titleInput.value = data.title || "";
            if (categorySelect && data.category) categorySelect.value = data.category;
            if (promptInput) promptInput.value = data.prompt || "";
            if (tagsInput) tagsInput.value = Array.isArray(data.tags) ? data.tags.join(", ") : "";
            if (folderSelect) folderSelect.value = data.favorite && data.folder ? data.folder : "";
            if (noteInput) noteInput.value = data.note || "";
            if (data.thumbnail && previewBox) {
                previewBox.innerHTML = `<img src="${getThumbnailUrl(data.thumbnail)}" alt="thumb" />`;
            }
        } else {
            if (folderSelect) folderSelect.value = "";
        }
    }

    bindEvents() {
        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = this.overlay.querySelector("#pv-modal-cancel");
        const saveBtn = this.overlay.querySelector("#pv-modal-save");
        const dropzone = this.overlay.querySelector("#pv-form-thumb-dropzone");
        const fileInput = this.overlay.querySelector("#pv-form-file-input");

        const handleClose = () => this.close();
        if (closeBtn) closeBtn.addEventListener("click", handleClose);
        if (cancelBtn) cancelBtn.addEventListener("click", handleClose);

        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) handleClose();
        });

        if (dropzone && fileInput) {
            dropzone.addEventListener("click", () => fileInput.click());
            fileInput.addEventListener("change", (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) this.setPendingImage(file);
            });
            dropzone.addEventListener("dragover", (e) => {
                e.preventDefault();
                dropzone.classList.add("is-dragover");
            });
            dropzone.addEventListener("dragleave", () => {
                dropzone.classList.remove("is-dragover");
            });
            dropzone.addEventListener("drop", (e) => {
                e.preventDefault();
                dropzone.classList.remove("is-dragover");
                const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (file && file.type.startsWith("image/")) {
                    this.setPendingImage(file);
                }
            });
        }

        if (saveBtn) saveBtn.addEventListener("click", () => this.submitForm());
    }

    handleGlobalPaste(event) {
        if (!this.overlay) return;
        const items = event.clipboardData && event.clipboardData.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) {
                    event.preventDefault();
                    this.setPendingImage(file);
                    break;
                }
            }
        }
    }

    setPendingImage(file) {
        this.pendingImageFile = file;
        const previewBox = this.overlay.querySelector("#pv-form-thumb-preview");
        if (!previewBox) return;
        previewBox.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="preview" />`;
    }

    async submitForm() {
        const title = (this.overlay.querySelector("#pv-form-title")?.value || "").trim();
        const prompt = (this.overlay.querySelector("#pv-form-prompt")?.value || "").trim();
        const category = (this.overlay.querySelector("#pv-form-category")?.value || "").trim() || "未分类";
        const tagsRaw = this.overlay.querySelector("#pv-form-tags")?.value || "";
        const folder = (this.overlay.querySelector("#pv-form-folder")?.value || "").trim();
        const note = (this.overlay.querySelector("#pv-form-note")?.value || "").trim();

        if (!title) {
            alert("请输入词条标题！");
            return;
        }
        if (!prompt) {
            alert("请输入提示词内容！");
            return;
        }

        const tags = tagsRaw.split(/[,，]+/).map((t) => t.trim()).filter(Boolean);
        const payload = {
            id: this.targetData && this.targetData.id ? this.targetData.id : undefined,
            title,
            prompt,
            category,
            tags,
            folder: folder || "",
            favorite: Boolean(folder),
            note,
            thumbnail: this.targetData ? this.targetData.thumbnail || "" : "",
        };

        const saveBtn = this.overlay.querySelector("#pv-modal-save");
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = "保存中...";
        }

        const result = await upsertPreset(payload, this.pendingImageFile);
        if (result.success) {
            // 直接将服务端返回的有效实体数据传入回调函数，杜绝客户端模糊比对失效
            if (typeof this.onSaved === "function") {
                await this.onSaved(result.data);
            }
            this.close();
        } else {
            alert(`保存失败: ${result.error || "未知异常"}`);
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = "保存";
            }
        }
    }

    close() {
        window.removeEventListener("paste", this.onPasteHandler, true);
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.pendingImageFile = null;
        this.targetData = null;
    }
}

export class TileDeleteConfirmModal {
    /**
     * @param {() => Promise<void>} onDeletedCallback
     */
    constructor(onDeletedCallback) {
        this.onDeleted = onDeletedCallback;
        this.overlay = null;
    }

    open(preset) {
        this.close();
        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal" style="max-width: 420px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">删除提示词</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body" style="gap: 12px;">
          <div style="font-size: 13px; color: var(--pv-text-primary);">
            确定要删除词条 <strong>[${preset.title || "未命名"}]</strong> 吗？
          </div>
          <div class="pv-info-callout" style="color: var(--pv-accent-danger);">
            此操作不可逆，将永久移除本地预设库中的该条目及其关联缩略图。
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-del-tile-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-danger-solid" id="pv-del-tile-confirm">
            ${renderIcon("trash", 12)} <span>删除</span>
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);

        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = this.overlay.querySelector("#pv-del-tile-cancel");
        const confirmBtn = this.overlay.querySelector("#pv-del-tile-confirm");

        const handleClose = () => this.close();
        closeBtn.addEventListener("click", handleClose);
        cancelBtn.addEventListener("click", handleClose);
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) handleClose();
        });

        confirmBtn.addEventListener("click", async () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "删除中...";
            const success = await deletePreset(preset.id);
            if (success) {
                if (typeof this.onDeleted === "function") await this.onDeleted();
                this.close();
            } else {
                alert("删除失败，请查看服务端日志。");
                confirmBtn.disabled = false;
                confirmBtn.textContent = "删除";
            }
        });
    }

    close() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
    }
}

export class FavoriteModalManager {
    /**
     * @param {() => any[]} getFoldersCallback
     * @param {() => Promise<void>} onUpdatedCallback
     */
    constructor(getFoldersCallback, onUpdatedCallback) {
        this.getFolders = getFoldersCallback;
        this.onUpdated = onUpdatedCallback;
        this.overlay = null;
    }

    async handleToggleFavorite(preset) {
        if (preset.favorite) {
            preset.favorite = false;
            preset.folder = "";
            await upsertPreset(preset);
            if (typeof this.onUpdated === "function") await this.onUpdated();
            return;
        }
        this.openModal(preset);
    }

    openModal(preset) {
        this.close();
        const folders = this.getFolders();

        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal" style="max-width: 440px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">收藏词条 · ${preset.title || "未命名"}</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body" style="gap: 12px;">
          <div style="font-size: 13px; color: var(--pv-text-secondary);">选择要加入的收藏夹。</div>
          <div class="prompt-vault-form-col">
            <label class="prompt-vault-form-label">收藏夹</label>
            <select class="prompt-vault-form-select" id="pv-fav-select">
              ${folders.map((f) => `<option value="${f.name}">${f.name}</option>`).join("")}
              <option value="__NEW__">+ 新建收藏夹...</option>
            </select>
          </div>
          <div class="prompt-vault-form-col" id="pv-fav-new-row" style="display: none;">
            <label class="prompt-vault-form-label">新收藏夹名称</label>
            <input type="text" class="prompt-vault-form-input" id="pv-fav-new-name" placeholder="" />
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-fav-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-fav-submit">
            ${renderIcon("star", 12)} <span>收藏</span>
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);

        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = this.overlay.querySelector("#pv-fav-cancel");
        const submitBtn = this.overlay.querySelector("#pv-fav-submit");
        const select = this.overlay.querySelector("#pv-fav-select");
        const newRow = this.overlay.querySelector("#pv-fav-new-row");
        const newNameInput = this.overlay.querySelector("#pv-fav-new-name");

        const handleClose = () => this.close();
        closeBtn.addEventListener("click", handleClose);
        cancelBtn.addEventListener("click", handleClose);
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) handleClose();
        });

        select.addEventListener("change", () => {
            newRow.style.display = select.value === "__NEW__" ? "flex" : "none";
        });

        submitBtn.addEventListener("click", async () => {
            let chosenFolder = select.value;
            if (chosenFolder === "__NEW__") {
                chosenFolder = (newNameInput.value || "").trim();
                if (!chosenFolder) {
                    alert("请输入新收藏夹名称！");
                    return;
                }
                await upsertTaxonomyItem("folder", { name: chosenFolder });
            }

            preset.favorite = true;
            preset.folder = chosenFolder;
            await upsertPreset(preset);
            if (typeof this.onUpdated === "function") await this.onUpdated();
            this.close();
        });
    }

    close() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
    }
}

export class TaxonomyModalManager {
    /**
     * @param {() => { categories: any[], folders: any[] }} getTaxonomiesCallback
     * @param {() => any[]} getPresetsCallback
     * @param {() => Promise<void>} onUpdatedCallback
     */
    constructor(getTaxonomiesCallback, getPresetsCallback, onUpdatedCallback) {
        this.getTaxonomies = getTaxonomiesCallback;
        this.getPresets = getPresetsCallback;
        this.onUpdated = onUpdatedCallback;
        this.activeTab = "categories";
        this.searchKeyword = "";
        this.expandedNodeIds = new Set();
        this.inlineAddParentId = null;
        this.overlay = null;
    }

    open() {
        this.close();
        this.inlineAddParentId = null;
        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal" style="max-width: 680px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">分类与收藏夹管理</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div class="prompt-vault-tab-switch">
            <button type="button" class="prompt-vault-tab-btn is-active" id="pv-tab-cat">
              ${renderIcon("grid", 13)} <span>分类</span>
            </button>
            <button type="button" class="prompt-vault-tab-btn" id="pv-tab-fld">
              ${renderIcon("star", 13)} <span>收藏夹</span>
            </button>
          </div>

          <div class="prompt-vault-taxonomy-toolbar">
            <input type="text" class="prompt-vault-input" id="pv-tax-search" placeholder="搜索分类..." style="flex: 1 1 0;" />
            <div style="display: flex; gap: 8px;">
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-tax-expand-all" style="height: 26px; font-size: 11px;">全部展开</button>
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-tax-collapse-all" style="height: 26px; font-size: 11px;">全部折叠</button>
            </div>
          </div>

          <div class="prompt-vault-taxonomy-list" id="pv-tax-list"></div>

          <div class="prompt-vault-taxonomy-bottom-row">
            <input type="text" class="prompt-vault-input" id="pv-tax-new-root" placeholder="新建根分类..." style="flex: 1 1 0;" />
            <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-tax-add-root">
              ${renderIcon("plus", 12)} <span>添加</span>
            </button>
            <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-tax-finish">完成</button>
          </div>
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);
        this.bindEvents();
        this.renderTree();
    }

    bindEvents() {
        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const finishBtn = this.overlay.querySelector("#pv-tax-finish");
        const tabCat = this.overlay.querySelector("#pv-tab-cat");
        const tabFld = this.overlay.querySelector("#pv-tab-fld");
        const searchInput = this.overlay.querySelector("#pv-tax-search");
        const expandAllBtn = this.overlay.querySelector("#pv-tax-expand-all");
        const collapseAllBtn = this.overlay.querySelector("#pv-tax-collapse-all");
        const addRootBtn = this.overlay.querySelector("#pv-tax-add-root");
        const newRootInput = this.overlay.querySelector("#pv-tax-new-root");

        const handleClose = () => this.close();
        closeBtn.addEventListener("click", handleClose);
        finishBtn.addEventListener("click", handleClose);
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) handleClose();
        });

        tabCat.addEventListener("click", () => {
            this.activeTab = "categories";
            this.inlineAddParentId = null;
            tabCat.classList.add("is-active");
            tabFld.classList.remove("is-active");
            searchInput.placeholder = "搜索分类...";
            newRootInput.placeholder = "新建根分类...";
            this.renderTree();
        });

        tabFld.addEventListener("click", () => {
            this.activeTab = "folders";
            this.inlineAddParentId = null;
            tabFld.classList.add("is-active");
            tabCat.classList.remove("is-active");
            searchInput.placeholder = "搜索收藏夹...";
            newRootInput.placeholder = "新建根收藏夹...";
            this.renderTree();
        });

        searchInput.addEventListener("input", () => {
            this.searchKeyword = searchInput.value.trim().toLowerCase();
            this.renderTree();
        });

        expandAllBtn.addEventListener("click", () => {
            const items = this.getTaxonomies()[this.activeTab];
            items.forEach((it) => this.expandedNodeIds.add(it.id));
            this.renderTree();
        });

        collapseAllBtn.addEventListener("click", () => {
            this.expandedNodeIds.clear();
            this.renderTree();
        });

        addRootBtn.addEventListener("click", async () => {
            const name = (newRootInput.value || "").trim();
            if (!name) return;
            const type = this.activeTab === "categories" ? "category" : "folder";
            await upsertTaxonomyItem(type, {
                name,
                parent_id: null,
                color: type === "category" ? "#3b82f6" : undefined,
            });
            newRootInput.value = "";
            if (typeof this.onUpdated === "function") await this.onUpdated();
            this.renderTree();
        });
    }

    renderTree() {
        const listContainer = this.overlay.querySelector("#pv-tax-list");
        listContainer.innerHTML = "";

        const { categories, folders } = this.getTaxonomies();
        const items = this.activeTab === "categories" ? categories : folders;
        const isCategory = this.activeTab === "categories";

        const map = new Map();
        const roots = [];
        items.forEach((it) => map.set(it.id, { ...it, children: [] }));
        items.forEach((it) => {
            if (it.parent_id && map.has(it.parent_id)) {
                map.get(it.parent_id).children.push(map.get(it.id));
            } else {
                roots.push(map.get(it.id));
            }
        });

        const renderNode = (node, depth = 0) => {
            if (this.searchKeyword && !node.name.toLowerCase().includes(this.searchKeyword)) {
                const hasMatchingChild = (node.children || []).some((c) =>
                    c.name.toLowerCase().includes(this.searchKeyword)
                );
                if (!hasMatchingChild) return;
            }

            const itemRow = document.createElement("div");
            itemRow.className = "prompt-vault-tree-item";
            itemRow.style.marginLeft = `${depth * 20}px`;

            const leftBox = document.createElement("div");
            leftBox.className = "prompt-vault-tree-left";

            const hasChildren = node.children && node.children.length > 0;
            const expandIcon = document.createElement("span");
            expandIcon.style.cursor = "pointer";
            expandIcon.style.width = "14px";
            expandIcon.innerHTML = hasChildren
                ? renderIcon(this.expandedNodeIds.has(node.id) ? "chevronDown" : "chevronRight", 13)
                : "";
            expandIcon.addEventListener("click", () => {
                if (this.expandedNodeIds.has(node.id)) {
                    this.expandedNodeIds.delete(node.id);
                } else {
                    this.expandedNodeIds.add(node.id);
                }
                this.renderTree();
            });
            leftBox.appendChild(expandIcon);

            if (isCategory) {
                const colorPill = document.createElement("div");
                colorPill.className = "prompt-vault-color-pill";
                colorPill.style.backgroundColor = node.color || "#3b82f6";
                leftBox.appendChild(colorPill);
            }

            const nameLabel = document.createElement("span");
            nameLabel.className = "prompt-vault-tree-name";
            nameLabel.textContent = node.name;
            leftBox.appendChild(nameLabel);
            itemRow.appendChild(leftBox);

            const rightBox = document.createElement("div");
            rightBox.className = "prompt-vault-tree-right";

            const countBadge = document.createElement("span");
            countBadge.className = "prompt-vault-count-badge";
            countBadge.textContent = node.count || 0;
            rightBox.appendChild(countBadge);

            const addChildBtn = document.createElement("button");
            addChildBtn.type = "button";
            addChildBtn.className = "prompt-vault-tile-btn";
            addChildBtn.title = "添加子级";
            addChildBtn.innerHTML = renderIcon("plus", 12);
            addChildBtn.addEventListener("click", () => {
                this.inlineAddParentId = node.id;
                this.expandedNodeIds.add(node.id);
                this.renderTree();
            });
            rightBox.appendChild(addChildBtn);

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "prompt-vault-tile-btn";
            editBtn.title = isCategory ? "修改名称与颜色" : "重命名";
            editBtn.innerHTML = renderIcon("settings", 12);
            editBtn.addEventListener("click", () => {
                this.openEditNodeDialog(node, isCategory);
            });
            rightBox.appendChild(editBtn);

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "prompt-vault-tile-btn";
            deleteBtn.title = "删除";
            deleteBtn.innerHTML = renderIcon("trash", 12);
            deleteBtn.addEventListener("click", () => {
                this.openDeleteCategoryModal(node, isCategory);
            });
            rightBox.appendChild(deleteBtn);

            itemRow.appendChild(rightBox);
            listContainer.appendChild(itemRow);

            if (this.inlineAddParentId === node.id) {
                const inlineRow = document.createElement("div");
                inlineRow.className = "prompt-vault-inline-add-row";
                inlineRow.style.marginLeft = `${(depth + 1) * 20}px`;

                const inlineInput = document.createElement("input");
                inlineInput.type = "text";
                inlineInput.className = "prompt-vault-inline-add-input";
                inlineInput.placeholder = "";

                const inlineSaveBtn = document.createElement("button");
                inlineSaveBtn.type = "button";
                inlineSaveBtn.className = "prompt-vault-btn prompt-vault-btn-primary";
                inlineSaveBtn.style.height = "26px";
                inlineSaveBtn.style.padding = "0 8px";
                inlineSaveBtn.style.fontSize = "11px";
                inlineSaveBtn.innerHTML = `<span>✓ 保存</span>`;

                const inlineCancelBtn = document.createElement("button");
                inlineCancelBtn.type = "button";
                inlineCancelBtn.className = "prompt-vault-btn prompt-vault-btn-default";
                inlineCancelBtn.style.height = "26px";
                inlineCancelBtn.style.padding = "0 6px";
                inlineCancelBtn.style.fontSize = "11px";
                inlineCancelBtn.innerHTML = `<span>✕</span>`;

                const doSaveChild = async () => {
                    const childName = inlineInput.value.trim();
                    if (!childName) return;
                    const type = isCategory ? "category" : "folder";
                    await upsertTaxonomyItem(type, {
                        name: childName,
                        parent_id: node.id,
                        color: node.color || "#3b82f6",
                    });
                    this.inlineAddParentId = null;
                    if (typeof this.onUpdated === "function") await this.onUpdated();
                    this.renderTree();
                };

                inlineSaveBtn.addEventListener("click", doSaveChild);
                inlineInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") doSaveChild();
                    if (e.key === "Escape") {
                        this.inlineAddParentId = null;
                        this.renderTree();
                    }
                });

                inlineCancelBtn.addEventListener("click", () => {
                    this.inlineAddParentId = null;
                    this.renderTree();
                });

                inlineRow.appendChild(inlineInput);
                inlineRow.appendChild(inlineSaveBtn);
                inlineRow.appendChild(inlineCancelBtn);
                listContainer.appendChild(inlineRow);

                setTimeout(() => inlineInput.focus(), 50);
            }

            if (hasChildren && (this.expandedNodeIds.has(node.id) || this.searchKeyword)) {
                node.children.forEach((child) => renderNode(child, depth + 1));
            }
        };

        roots.forEach((root) => renderNode(root, 0));
    }

    openDeleteCategoryModal(node, isCategory) {
        const { categories, folders } = this.getTaxonomies();
        const items = isCategory ? categories : folders;
        const presets = typeof this.getPresets === "function" ? this.getPresets() : [];

        const getPath = (n) => {
            const parts = [n.name];
            let cur = n;
            while (cur.parent_id) {
                const parent = items.find((p) => p.id === cur.parent_id);
                if (parent) {
                    parts.unshift(parent.name);
                    cur = parent;
                } else {
                    break;
                }
            }
            return parts.join(" / ");
        };
        const fullPath = getPath(node);

        const descendantNodes = [];
        const collectDescendants = (pid) => {
            items.forEach((it) => {
                if (it.parent_id === pid) {
                    descendantNodes.push(it);
                    collectDescendants(it.id);
                }
            });
        };
        collectDescendants(node.id);

        const directPresetsCount = presets.filter((p) => p.category === node.name).length;
        const directChildrenCount = items.filter((it) => it.parent_id === node.id).length;
        const branchChildrenCount = descendantNodes.length;
        const descendantNames = new Set(descendantNodes.map((d) => d.name));
        const branchPresetsCount = presets.filter((p) => descendantNames.has(p.category)).length;

        const confirmOverlay = document.createElement("div");
        confirmOverlay.className = "prompt-vault-modal-overlay";
        confirmOverlay.style.zIndex = "10002";
        isolateCanvasEvents(confirmOverlay);

        confirmOverlay.innerHTML = `
      <div class="prompt-vault-modal" style="max-width: 480px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">删除分类 · ${fullPath}</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body" style="gap: 12px;">
          <div class="pv-stat-grid">
            <div class="pv-stat-card">
              <span class="pv-stat-number">${directPresetsCount}</span>
              <span class="pv-stat-label">直属词条</span>
            </div>
            <div class="pv-stat-card">
              <span class="pv-stat-number">${directChildrenCount}</span>
              <span class="pv-stat-label">直属子分类</span>
            </div>
            <div class="pv-stat-card">
              <span class="pv-stat-number">${branchChildrenCount}</span>
              <span class="pv-stat-label">分支分类</span>
            </div>
            <div class="pv-stat-card">
              <span class="pv-stat-number">${branchPresetsCount}</span>
              <span class="pv-stat-label">分支词条</span>
            </div>
          </div>

          <label class="pv-checkbox-row">
            <input type="checkbox" id="pv-chk-delete-branch" />
            <span>删除整个分类分支</span>
          </label>

          <div class="pv-info-callout">
            默认只删除当前分类：子分类提升一级，直属词条变为未分类，不会删除任何提示词条。
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-del-cat-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-danger-solid" id="pv-del-cat-confirm">
            ${renderIcon("trash", 12)} <span>删除</span>
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(confirmOverlay);

        const closeBtn = confirmOverlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = confirmOverlay.querySelector("#pv-del-cat-cancel");
        const confirmBtn = confirmOverlay.querySelector("#pv-del-cat-confirm");
        const branchChk = confirmOverlay.querySelector("#pv-chk-delete-branch");

        const doClose = () => {
            if (confirmOverlay.parentNode) {
                confirmOverlay.parentNode.removeChild(confirmOverlay);
            }
        };

        closeBtn.addEventListener("click", doClose);
        cancelBtn.addEventListener("click", doClose);
        confirmOverlay.addEventListener("click", (e) => {
            if (e.target === confirmOverlay) doClose();
        });

        confirmBtn.addEventListener("click", async () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "删除中...";
            const deleteBranch = branchChk.checked;
            const type = isCategory ? "category" : "folder";

            await deleteTaxonomyItem(type, node.id, deleteBranch);
            doClose();
            if (typeof this.onUpdated === "function") await this.onUpdated();
            this.renderTree();
        });
    }

    openEditNodeDialog(node, isCategory) {
        const newName = prompt("修改名称:", node.name);
        if (newName === null) return;
        const finalName = newName.trim() || node.name;

        if (isCategory) {
            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.value = node.color || "#3b82f6";
            colorInput.style.position = "fixed";
            colorInput.style.opacity = "0";
            document.body.appendChild(colorInput);

            colorInput.addEventListener("change", async () => {
                const type = "category";
                await upsertTaxonomyItem(type, {
                    id: node.id,
                    name: finalName,
                    parent_id: node.parent_id,
                    color: colorInput.value,
                });
                document.body.removeChild(colorInput);
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.renderTree();
            });
            colorInput.click();
        } else {
            (async () => {
                await upsertTaxonomyItem("folder", {
                    id: node.id,
                    name: finalName,
                    parent_id: node.parent_id,
                });
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.renderTree();
            })();
        }
    }

    close() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.inlineAddParentId = null;
    }
}