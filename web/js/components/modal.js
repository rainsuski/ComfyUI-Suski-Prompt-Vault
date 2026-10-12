/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modal.js */

/**
 * 全量弹窗模块管理器。
 * 显式绑定三级弹窗尺寸 Class (pv-modal-compact / pv-modal-medium / pv-modal-large)，
 * 支持导入差异预检与冲突处理（完全折叠展开、滚动顺畅）、
 * 导出预览统计卡片以及紧凑型无滚动条删除弹窗。
 */

import {
    deleteCategory,
    deleteCollection,
    deleteEntry,
    getThumbnailUrl,
    importLibrary,
    triggerExportLibrary,
    upsertCategory,
    upsertCollection,
    upsertEntry,
} from "../api.js";
import { isolateCanvasEvents } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";

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

/* =========================================================================
   1. 词条录入与编辑弹窗管理器
   ========================================================================= */

export class PresetModalManager {
    /**
     * @param {() => { categories: any[], collections: any[], tags: any[] }} getLibraryCallback
     * @param {(savedData?: any) => Promise<void>} onSavedCallback
     */
    constructor(getLibraryCallback, onSavedCallback) {
        this.getLibrary = getLibraryCallback;
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
        const lib = this.getLibrary();
        const categories = lib.categories || [];
        const collections = lib.collections || [];
        const categoryOptions = buildCategoryHierarchyOptions(categories);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-medium">
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
                ${categoryOptions.map((opt) => `<option value="${opt.id}">${opt.label}</option>`).join("")}
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
                ${collections.map((c) => `<option value="${c.name}">${c.name}</option>`).join("")}
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
            if (categorySelect) categorySelect.value = data.categoryId || data.category_id || "";
            if (promptInput) promptInput.value = data.text || data.prompt || "";
            if (noteInput) noteInput.value = data.note || "";

            const lib = this.getLibrary();
            const tagsDict = lib.tags || [];
            const tagNames = [];
            if (Array.isArray(data.tagIds)) {
                data.tagIds.forEach((tid) => {
                    const tObj = tagsDict.find((t) => t.id === tid);
                    if (tObj) tagNames.push(tObj.name);
                });
            }
            if (Array.isArray(data.tags)) {
                data.tags.forEach((t) => {
                    if (typeof t === "string" && !tagNames.includes(t)) tagNames.push(t);
                });
            }
            if (tagsInput) tagsInput.value = tagNames.join(", ");

            if (folderSelect) {
                if (Array.isArray(data.collections) && data.collections.length > 0) {
                    folderSelect.value = data.collections[0];
                } else if (data.folder) {
                    folderSelect.value = data.folder;
                } else {
                    folderSelect.value = "";
                }
            }

            const thumb = data.previewHash || data.thumbnail;
            if (thumb && previewBox) {
                previewBox.innerHTML = `<img src="${getThumbnailUrl(thumb)}" alt="thumb" />`;
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
        const categoryId = this.overlay.querySelector("#pv-form-category")?.value || null;
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
            text: prompt,
            categoryId: categoryId || null,
            tags: tags,
            collections: folder ? [folder] : [],
            note,
            previewHash: this.targetData ? this.targetData.previewHash || this.targetData.thumbnail || null : null,
        };

        const saveBtn = this.overlay.querySelector("#pv-modal-save");
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = "保存中...";
        }

        const result = await upsertEntry(payload, this.pendingImageFile);
        if (result && result.success) {
            if (typeof this.onSaved === "function") {
                await this.onSaved(result.data);
            }
            this.close();
        } else {
            alert(`保存失败: ${result?.error || "服务未响应，请检查 ComfyUI 是否已重启"}`);
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

/* =========================================================================
   2. 词条删除二次确认紧凑型弹窗 (紧凑型，自适应无滚动条)
   ========================================================================= */

export class TileDeleteConfirmModal {
    /**
     * @param {() => Promise<void>} onDeletedCallback
     */
    constructor(onDeletedCallback) {
        this.onDeleted = onDeletedCallback;
        this.overlay = null;
    }

    open(entry) {
        this.close();
        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-compact">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">删除提示词</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div style="font-size: 13px; color: var(--pv-text-primary); line-height: 1.5;">
            确定要删除词条 <strong>[${entry.title || "未命名"}]</strong> 吗？
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
            const success = await deleteEntry(entry.id);
            if (success) {
                if (typeof this.onDeleted === "function") await this.onDeleted();
                this.close();
            } else {
                alert("删除失败，请检查服务状态。");
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

/* =========================================================================
   3. 收藏夹联动弹窗管理器 (紧凑型)
   ========================================================================= */

export class FavoriteModalManager {
    /**
     * @param {() => any[]} getCollectionsCallback
     * @param {() => Promise<void>} onUpdatedCallback
     */
    constructor(getCollectionsCallback, onUpdatedCallback) {
        this.getCollections = getCollectionsCallback;
        this.onUpdated = onUpdatedCallback;
        this.overlay = null;
    }

    async handleToggleFavorite(entry) {
        const isFavorited = Array.isArray(entry.collections) && entry.collections.length > 0;
        if (isFavorited) {
            entry.collections = [];
            await upsertEntry(entry);
            if (typeof this.onUpdated === "function") await this.onUpdated();
            return;
        }
        this.openModal(entry);
    }

    openModal(entry) {
        this.close();
        const collections = this.getCollections();

        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-compact">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">收藏词条 · ${entry.title || "未命名"}</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div style="font-size: 13px; color: var(--pv-text-secondary);">选择要加入的收藏夹。</div>
          <div class="prompt-vault-form-col">
            <label class="prompt-vault-form-label">收藏夹</label>
            <select class="prompt-vault-form-select" id="pv-fav-select">
              ${collections.map((c) => `<option value="${c.name}">${c.name}</option>`).join("")}
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
            let chosenCollection = select.value;
            if (chosenCollection === "__NEW__") {
                chosenCollection = (newNameInput.value || "").trim();
                if (!chosenCollection) {
                    alert("请输入新收藏夹名称！");
                    return;
                }
                await upsertCollection({ name: chosenCollection });
            }

            entry.collections = [chosenCollection];
            await upsertEntry(entry);
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

/* =========================================================================
   4. 分类与收藏夹多级管理中心 (大型工作台型)
   ========================================================================= */

export class TaxonomyModalManager {
    /**
     * @param {() => { categories: any[], collections: any[], entries: any[] }} getLibraryCallback
     * @param {() => Promise<void>} onUpdatedCallback
     */
    constructor(getLibraryCallback, onUpdatedCallback) {
        this.getLibrary = getLibraryCallback;
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
      <div class="prompt-vault-modal pv-modal-large">
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
            <input type="text" class="prompt-vault-input" id="pv-tax-search" placeholder="搜索分类..." style="flex: 1 1 0; min-width: 0;" />
            <div style="display: flex; gap: 8px; flex-shrink: 0;">
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-tax-expand-all" style="height: 26px; font-size: 11px;">全部展开</button>
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-tax-collapse-all" style="height: 26px; font-size: 11px;">全部折叠</button>
            </div>
          </div>

          <div class="prompt-vault-taxonomy-list" id="pv-tax-list"></div>

          <div class="prompt-vault-taxonomy-bottom-row">
            <input type="text" class="prompt-vault-input" id="pv-tax-new-root" placeholder="新建根分类..." style="flex: 1 1 0; min-width: 0;" />
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
        this.renderContent();
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
            this.renderContent();
        });

        tabFld.addEventListener("click", () => {
            this.activeTab = "collections";
            this.inlineAddParentId = null;
            tabFld.classList.add("is-active");
            tabCat.classList.remove("is-active");
            searchInput.placeholder = "搜索收藏夹...";
            newRootInput.placeholder = "新建收藏夹...";
            this.renderContent();
        });

        searchInput.addEventListener("input", () => {
            this.searchKeyword = searchInput.value.trim().toLowerCase();
            this.renderContent();
        });

        expandAllBtn.addEventListener("click", () => {
            const { categories } = this.getLibrary();
            (categories || []).forEach((it) => this.expandedNodeIds.add(it.id));
            this.renderContent();
        });

        collapseAllBtn.addEventListener("click", () => {
            this.expandedNodeIds.clear();
            this.renderContent();
        });

        addRootBtn.addEventListener("click", async () => {
            const name = (newRootInput.value || "").trim();
            if (!name) return;
            let res;
            if (this.activeTab === "categories") {
                res = await upsertCategory({
                    name,
                    parentId: null,
                    color: "#3b82f6",
                });
            } else {
                res = await upsertCollection({
                    name,
                });
            }
            if (res && res.success) {
                newRootInput.value = "";
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.renderContent();
            } else {
                alert(`添加失败: ${res?.error || "服务未响应，请检查 ComfyUI 是否已重启"}`);
            }
        });
    }

    renderContent() {
        const listContainer = this.overlay.querySelector("#pv-tax-list");
        listContainer.innerHTML = "";

        const lib = this.getLibrary();
        const categories = lib.categories || [];
        const collections = lib.collections || [];
        const entries = lib.entries || [];

        if (this.activeTab === "categories") {
            this.renderCategoriesTree(listContainer, categories, entries);
        } else {
            this.renderCollectionsList(listContainer, collections, entries);
        }
    }

    renderCategoriesTree(listContainer, categories, entries) {
        if (!categories || categories.length === 0) {
            listContainer.innerHTML = `
        <div class="prompt-vault-empty-state" style="height: 100%; min-height: 220px;">
          <div class="prompt-vault-empty-icon">${renderIcon("folder", 28)}</div>
          <div>暂无分类</div>
          <div style="font-size:11px; opacity:0.7;">请在下方输入名称并点击 [+ 添加] 创建根分类</div>
        </div>
      `;
            return;
        }

        const map = new Map();
        const roots = [];
        categories.forEach((c) => map.set(c.id, { ...c, children: [] }));
        categories.forEach((c) => {
            if (c.parentId && map.has(c.parentId)) {
                map.get(c.parentId).children.push(map.get(c.id));
            } else {
                roots.push(map.get(c.id));
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
                this.renderContent();
            });
            leftBox.appendChild(expandIcon);

            const colorPill = document.createElement("div");
            colorPill.className = "prompt-vault-color-pill";
            colorPill.style.backgroundColor = node.color || "#3b82f6";
            leftBox.appendChild(colorPill);

            const nameLabel = document.createElement("span");
            nameLabel.className = "prompt-vault-tree-name";
            nameLabel.textContent = node.name;
            leftBox.appendChild(nameLabel);
            itemRow.appendChild(leftBox);

            const rightBox = document.createElement("div");
            rightBox.className = "prompt-vault-tree-right";

            const count = entries.filter((e) => e.categoryId === node.id).length;
            const countBadge = document.createElement("span");
            countBadge.className = "prompt-vault-count-badge";
            countBadge.textContent = count;
            rightBox.appendChild(countBadge);

            const addChildBtn = document.createElement("button");
            addChildBtn.type = "button";
            addChildBtn.className = "prompt-vault-tile-btn";
            addChildBtn.title = "添加子级";
            addChildBtn.innerHTML = renderIcon("plus", 12);
            addChildBtn.addEventListener("click", () => {
                this.inlineAddParentId = node.id;
                this.expandedNodeIds.add(node.id);
                this.renderContent();
            });
            rightBox.appendChild(addChildBtn);

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "prompt-vault-tile-btn";
            editBtn.title = "修改名称与颜色";
            editBtn.innerHTML = renderIcon("settings", 12);
            editBtn.addEventListener("click", () => {
                this.openEditCategoryDialog(node);
            });
            rightBox.appendChild(editBtn);

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "prompt-vault-tile-btn";
            deleteBtn.title = "删除";
            deleteBtn.innerHTML = renderIcon("trash", 12);
            deleteBtn.addEventListener("click", () => {
                this.openDeleteCategoryModal(node, categories, entries);
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
                    const res = await upsertCategory({
                        name: childName,
                        parentId: node.id,
                        color: node.color || "#3b82f6",
                    });
                    if (res && res.success) {
                        this.inlineAddParentId = null;
                        if (typeof this.onUpdated === "function") await this.onUpdated();
                        this.renderContent();
                    } else {
                        alert(`添加子分类失败: ${res?.error || "服务未响应"}`);
                    }
                };

                inlineSaveBtn.addEventListener("click", doSaveChild);
                inlineInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") doSaveChild();
                    if (e.key === "Escape") {
                        this.inlineAddParentId = null;
                        this.renderContent();
                    }
                });

                inlineCancelBtn.addEventListener("click", () => {
                    this.inlineAddParentId = null;
                    this.renderContent();
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

    renderCollectionsList(listContainer, collections, entries) {
        if (!collections || collections.length === 0) {
            listContainer.innerHTML = `
        <div class="prompt-vault-empty-state" style="height: 100%; min-height: 220px;">
          <div class="prompt-vault-empty-icon">${renderIcon("star", 28)}</div>
          <div>暂无收藏夹</div>
          <div style="font-size:11px; opacity:0.7;">请在下方输入名称并点击 [+ 添加] 创建收藏夹</div>
        </div>
      `;
            return;
        }

        collections.forEach((col) => {
            if (this.searchKeyword && !col.name.toLowerCase().includes(this.searchKeyword)) {
                return;
            }

            const itemRow = document.createElement("div");
            itemRow.className = "prompt-vault-tree-item";

            const leftBox = document.createElement("div");
            leftBox.className = "prompt-vault-tree-left";

            const iconSpan = document.createElement("span");
            iconSpan.innerHTML = renderIcon("star", 13);
            leftBox.appendChild(iconSpan);

            const nameLabel = document.createElement("span");
            nameLabel.className = "prompt-vault-tree-name";
            nameLabel.textContent = col.name;
            leftBox.appendChild(nameLabel);
            itemRow.appendChild(leftBox);

            const rightBox = document.createElement("div");
            rightBox.className = "prompt-vault-tree-right";

            const count = entries.filter(
                (e) => Array.isArray(e.collections) && e.collections.includes(col.name)
            ).length;
            const countBadge = document.createElement("span");
            countBadge.className = "prompt-vault-count-badge";
            countBadge.textContent = count;
            rightBox.appendChild(countBadge);

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "prompt-vault-tile-btn";
            editBtn.title = "重命名";
            editBtn.innerHTML = renderIcon("settings", 12);
            editBtn.addEventListener("click", async () => {
                const newName = prompt("重命名收藏夹:", col.name);
                if (!newName || newName.trim() === col.name) return;
                await upsertCollection({ id: col.id, name: newName.trim() });
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.renderContent();
            });
            rightBox.appendChild(editBtn);

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "prompt-vault-tile-btn";
            deleteBtn.title = "删除";
            deleteBtn.innerHTML = renderIcon("trash", 12);
            deleteBtn.addEventListener("click", async () => {
                if (!confirm(`确定要删除收藏夹 [${col.name}] 吗？`)) return;
                await deleteCollection(col.id);
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.renderContent();
            });
            rightBox.appendChild(deleteBtn);

            itemRow.appendChild(rightBox);
            listContainer.appendChild(itemRow);
        });
    }

    openEditCategoryDialog(node) {
        const newName = prompt("修改分类名称:", node.name);
        if (newName === null) return;
        const finalName = newName.trim() || node.name;

        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = node.color || "#3b82f6";
        colorInput.style.position = "fixed";
        colorInput.style.opacity = "0";
        document.body.appendChild(colorInput);

        colorInput.addEventListener("change", async () => {
            await upsertCategory({
                id: node.id,
                name: finalName,
                parentId: node.parentId,
                color: colorInput.value,
            });
            document.body.removeChild(colorInput);
            if (typeof this.onUpdated === "function") await this.onUpdated();
            this.renderContent();
        });
        colorInput.click();
    }

    openDeleteCategoryModal(node, categories, entries) {
        const getPath = (n) => {
            const parts = [n.name];
            let cur = n;
            while (cur.parentId) {
                const parent = categories.find((p) => p.id === cur.parentId);
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
            categories.forEach((it) => {
                if (it.parentId === pid) {
                    descendantNodes.push(it);
                    collectDescendants(it.id);
                }
            });
        };
        collectDescendants(node.id);

        const directPresetsCount = entries.filter((e) => e.categoryId === node.id).length;
        const directChildrenCount = categories.filter((c) => c.parentId === node.id).length;
        const branchChildrenCount = descendantNodes.length;
        const descendantIds = new Set(descendantNodes.map((d) => d.id));
        const branchPresetsCount = entries.filter((e) => descendantIds.has(e.categoryId)).length;

        const confirmOverlay = document.createElement("div");
        confirmOverlay.className = "prompt-vault-modal-overlay";
        confirmOverlay.style.zIndex = "10002";
        isolateCanvasEvents(confirmOverlay);

        confirmOverlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-compact" style="max-width: 480px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">删除分类 · ${fullPath}</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
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
            await deleteCategory(node.id, deleteBranch);
            doClose();
            if (typeof this.onUpdated === "function") await this.onUpdated();
            this.renderContent();
        });
    }

    close() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.inlineAddParentId = null;
    }
}

/* =========================================================================
   5. 导入词库差异预检与冲突处理中心 (大型工作台型，主体支持自由滚动与全项折叠展开)
   ========================================================================= */

export class ImportModalManager {
    /**
     * @param {() => any} getLibraryCallback
     * @param {() => Promise<void>} onUpdatedCallback
     */
    constructor(getLibraryCallback, onUpdatedCallback) {
        this.getLibrary = getLibraryCallback;
        this.onUpdated = onUpdatedCallback;
        this.overlay = null;
    }

    open(importedData, fileName = "manifest.json", fileSize = 0) {
        this.close();

        const localLib = this.getLibrary();
        const localEntries = localLib.entries || [];
        const localCategories = localLib.categories || [];
        const localCollections = localLib.collections || [];

        let rawEntries = [];
        let rawCategories = [];
        let rawCollections = [];
        let rawTags = [];

        if (Array.isArray(importedData)) {
            rawEntries = importedData;
        } else if (importedData && typeof importedData === "object") {
            rawEntries = importedData.entries || [];
            rawCategories = importedData.categories || [];
            rawCollections = importedData.collections || [];
            rawTags = importedData.tags || [];
        }

        const localIdMap = new Map(localEntries.map((e) => [e.id, e]));
        const localContentSet = new Set(
            localEntries.map((e) => `${(e.title || "").trim()}:::${(e.text || e.prompt || "").trim()}`)
        );

        const newEntries = [];
        const existingEntries = [];
        const conflictEntries = [];
        const duplicateEntries = [];
        const invalidEntries = [];
        const seenImportIds = new Set();

        rawEntries.forEach((item) => {
            const itemTitle = (item.title || "").trim();
            const itemText = (item.text || item.prompt || "").trim();

            if (!itemTitle && !itemText) {
                invalidEntries.push({ item, reason: "缺少标题与提示词内容" });
                return;
            }

            if (item.id && seenImportIds.has(item.id)) {
                duplicateEntries.push({ item, reason: "导入包中存在重复 ID" });
                return;
            }
            if (item.id) seenImportIds.add(item.id);

            const localExact = item.id ? localIdMap.get(item.id) : null;
            if (localExact) {
                const localText = (localExact.text || localExact.prompt || "").trim();
                const localTitle = (localExact.title || "").trim();
                if (localText === itemText && localTitle === itemTitle) {
                    existingEntries.push(item);
                } else {
                    conflictEntries.push({
                        item,
                        local: localExact,
                        reason: "相同词条 ID 的内容已发生变化",
                        strategy: "keep_local",
                    });
                }
            } else {
                const contentKey = `${itemTitle}:::${itemText}`;
                if (localContentSet.has(contentKey)) {
                    conflictEntries.push({
                        item,
                        local: null,
                        reason: "本地已存在相同标题与提示词内容",
                        strategy: "keep_local",
                    });
                } else {
                    newEntries.push(item);
                }
            }
        });

        const hasConflicts = conflictEntries.length > 0;
        const hasDuplicates = duplicateEntries.length > 0;
        const hasInvalid = invalidEntries.length > 0;
        const sizeKbText = fileSize ? `${(fileSize / 1024).toFixed(1)} KB` : "标准包";

        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-large">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">导入词库</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div class="pv-import-banner ${!hasConflicts && !hasInvalid ? "is-ok" : ""}">
            <div class="pv-import-banner-left">
              <span class="pv-import-banner-icon">${renderIcon(hasConflicts || hasInvalid ? "clock" : "check", 22)}</span>
              <div>
                <div class="pv-import-banner-title">
                  ${hasConflicts ? "这个备份需要处理" : hasInvalid ? "备份存在无效词条" : "备份准备就绪"}
                </div>
                <div class="pv-import-banner-desc">
                  ${hasConflicts ? "源备份存在冲突词条，请选择冲突解决策略后安全导入。" : "词库结构校验通过，可安全合并入库。"}
                </div>
              </div>
            </div>
            <div class="pv-import-banner-right">
              <div style="font-weight: 600; color: #f3f4f6;">${fileName}</div>
              <div>${sizeKbText} · 标准备份</div>
            </div>
          </div>

          <div class="pv-import-stats-grid">
            <div class="pv-import-stat-card">
              <span class="pv-import-stat-num pv-stat-new">${newEntries.length}</span>
              <span class="pv-import-stat-label">新增</span>
            </div>
            <div class="pv-import-stat-card">
              <span class="pv-import-stat-num pv-stat-exist">${existingEntries.length}</span>
              <span class="pv-import-stat-label">已有</span>
            </div>
            <div class="pv-import-stat-card">
              <span class="pv-import-stat-num pv-stat-conflict">${conflictEntries.length}</span>
              <span class="pv-import-stat-label">冲突</span>
            </div>
            <div class="pv-import-stat-card">
              <span class="pv-import-stat-num pv-stat-dup">${duplicateEntries.length}</span>
              <span class="pv-import-stat-label">重复</span>
            </div>
            <div class="pv-import-stat-card">
              <span class="pv-import-stat-num pv-stat-invalid">${invalidEntries.length}</span>
              <span class="pv-import-stat-label">无效</span>
            </div>
          </div>

          <!-- 1. 冲突处理折叠区 (默认展开) -->
          ${hasConflicts
                ? `
          <div class="pv-accordion-section is-open" id="pv-sec-conflict">
            <div class="pv-accordion-header">
              <div class="pv-accordion-title-group">
                <span class="pv-accordion-title">冲突处理</span>
                <span class="pv-accordion-subtitle">可以逐项处理，也可以为全部冲突应用同一策略。</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="prompt-vault-count-badge">${conflictEntries.length}</span>
                <select class="pv-conflict-select" id="pv-batch-strategy" style="width: 130px;" onclick="event.stopPropagation()">
                  <option value="">应用到全部...</option>
                  <option value="keep_local">保留本地</option>
                  <option value="overwrite">使用导入内容</option>
                  <option value="copy">创建副本</option>
                </select>
                <span class="pv-acc-chevron">${renderIcon("chevronDown", 14)}</span>
              </div>
            </div>
            <div class="pv-accordion-body">
              ${conflictEntries
                    .map(
                        (c, idx) => `
                <div class="pv-conflict-row" data-idx="${idx}">
                  <div class="pv-conflict-info">
                    <span class="pv-conflict-name">${c.item.title || "未命名"}</span>
                    <span class="pv-conflict-reason">${c.reason}</span>
                  </div>
                  <select class="pv-conflict-select pv-item-strategy" data-idx="${idx}">
                    <option value="keep_local" ${c.strategy === "keep_local" ? "selected" : ""}>保留本地</option>
                    <option value="overwrite" ${c.strategy === "overwrite" ? "selected" : ""}>使用导入内容</option>
                    <option value="copy" ${c.strategy === "copy" ? "selected" : ""}>创建副本</option>
                  </select>
                </div>
              `
                    )
                    .join("")}
            </div>
          </div>
          `
                : ""
            }

          <!-- 2. 重复词条折叠区 -->
          ${hasDuplicates
                ? `
          <div class="pv-accordion-section" id="pv-sec-duplicate">
            <div class="pv-accordion-header">
              <div class="pv-accordion-title-group">
                <span class="pv-accordion-title">重复词条</span>
                <span class="pv-accordion-subtitle">导入文件中存在重复 ID，将自动安全去重。</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="prompt-vault-count-badge" style="color: #eab308;">${duplicateEntries.length}</span>
                <span class="pv-acc-chevron">${renderIcon("chevronDown", 14)}</span>
              </div>
            </div>
            <div class="pv-accordion-body">
              ${duplicateEntries
                    .map(
                        (d) => `
                <div class="pv-entry-item-row">
                  <span class="pv-entry-item-title">${d.item.title || "未命名"}</span>
                  <span style="font-size: 11px; color: #eab308;">${d.reason}</span>
                </div>
              `
                    )
                    .join("")}
            </div>
          </div>
          `
                : ""
            }

          <!-- 3. 无效词条折叠区 -->
          ${hasInvalid
                ? `
          <div class="pv-accordion-section" id="pv-sec-invalid">
            <div class="pv-accordion-header">
              <div class="pv-accordion-title-group">
                <span class="pv-accordion-title">无效词条</span>
                <span class="pv-accordion-subtitle">这些词条格式异常，导入时将自动安全忽略。</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="prompt-vault-count-badge" style="color: #ef4444;">${invalidEntries.length}</span>
                <span class="pv-acc-chevron">${renderIcon("chevronDown", 14)}</span>
              </div>
            </div>
            <div class="pv-accordion-body">
              ${invalidEntries
                    .map(
                        (inv) => `
                <div class="pv-entry-item-row">
                  <span class="pv-entry-item-title">${inv.item.title || "未命名"}</span>
                  <span style="font-size: 11px; color: #ef4444;">${inv.reason}</span>
                </div>
              `
                    )
                    .join("")}
            </div>
          </div>
          `
                : ""
            }

          <!-- 4. 已有词条折叠区 (点击可完整查看与本地一致的列表) -->
          <div class="pv-accordion-section" id="pv-sec-existing">
            <div class="pv-accordion-header">
              <div class="pv-accordion-title-group">
                <span class="pv-accordion-title">已有词条</span>
                <span class="pv-accordion-subtitle">这些词条已与本地内容一致，无需额外处理。</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="prompt-vault-count-badge">${existingEntries.length}</span>
                <span class="pv-acc-chevron">${renderIcon("chevronDown", 14)}</span>
              </div>
            </div>
            <div class="pv-accordion-body">
              ${existingEntries.length === 0
                ? `<div style="font-size: 11px; color: var(--pv-text-muted); text-align: center; padding: 10px;">无完全一致的历史条目</div>`
                : existingEntries
                    .map(
                        (e) => `
                <div class="pv-entry-item-row">
                  <span class="pv-entry-item-title">${e.title || "未命名"}</span>
                  <span class="pv-entry-item-desc">${(e.text || e.prompt || "").replace(/[\r\n]+/g, " ")}</span>
                </div>
              `
                    )
                    .join("")
            }
            </div>
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <div style="margin-right: auto; font-size: 11px; color: var(--pv-text-muted);">
            安全事务合并，未冲突与已有词条保持完整不变
          </div>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-import-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-import-submit">
            ${renderIcon("download", 12)} <span>执行导入</span>
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);

        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = this.overlay.querySelector("#pv-import-cancel");
        const submitBtn = this.overlay.querySelector("#pv-import-submit");
        const batchSelect = this.overlay.querySelector("#pv-batch-strategy");

        const handleClose = () => this.close();
        closeBtn.addEventListener("click", handleClose);
        cancelBtn.addEventListener("click", handleClose);
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) handleClose();
        });

        // 绑定所有可折叠分栏的点击切换
        const accordionSections = this.overlay.querySelectorAll(".pv-accordion-section");
        accordionSections.forEach((sec) => {
            const header = sec.querySelector(".pv-accordion-header");
            if (header) {
                header.addEventListener("click", (e) => {
                    if (e.target.closest("select")) return;
                    sec.classList.toggle("is-open");
                });
            }
        });

        // 批量策略切换
        if (batchSelect) {
            batchSelect.addEventListener("change", () => {
                const val = batchSelect.value;
                if (!val) return;
                conflictEntries.forEach((c) => {
                    c.strategy = val;
                });
                const selects = this.overlay.querySelectorAll(".pv-item-strategy");
                selects.forEach((s) => {
                    s.value = val;
                });
            });
        }

        // 单项策略切换
        const itemSelects = this.overlay.querySelectorAll(".pv-item-strategy");
        itemSelects.forEach((sel) => {
            sel.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.idx, 10);
                if (conflictEntries[idx]) {
                    conflictEntries[idx].strategy = e.target.value;
                }
            });
        });

        // 执行安全事务合并
        submitBtn.addEventListener("click", async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = "导入中...";

            const mergedCategories = [...localCategories];
            const localCatIds = new Set(localCategories.map((c) => c.id));
            rawCategories.forEach((rc) => {
                if (!localCatIds.has(rc.id)) {
                    mergedCategories.push(rc);
                }
            });

            const mergedCollections = [...localCollections];
            const localColNames = new Set(localCollections.map((c) => c.name));
            rawCollections.forEach((rcol) => {
                if (!localColNames.has(rcol.name)) {
                    mergedCollections.push(rcol);
                }
            });

            const mergedTags = [...(localLib.tags || [])];
            const localTagNames = new Set(mergedTags.map((t) => t.name));
            rawTags.forEach((rt) => {
                if (!localTagNames.has(rt.name)) {
                    mergedTags.push(rt);
                }
            });

            const finalEntries = [...localEntries];

            newEntries.forEach((ne) => {
                finalEntries.push(ne);
            });

            conflictEntries.forEach((c) => {
                if (c.strategy === "overwrite") {
                    const idx = finalEntries.findIndex((e) => e.id === c.item.id);
                    if (idx !== -1) {
                        finalEntries[idx] = c.item;
                    } else {
                        finalEntries.push(c.item);
                    }
                } else if (c.strategy === "copy") {
                    const copyItem = {
                        ...c.item,
                        id: `entry_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        title: `${c.item.title || "词条"} (副本)`,
                    };
                    finalEntries.push(copyItem);
                }
            });

            const resolvedLibrary = {
                format: "aaalice-prompt-library",
                version: 2,
                categories: mergedCategories,
                collections: mergedCollections,
                tags: mergedTags,
                entries: finalEntries,
                selection: localLib.selection || { entryIds: [] },
            };

            const resolvedFile = new File(
                [new Blob([JSON.stringify(resolvedLibrary, null, 2)], { type: "application/json" })],
                fileName,
                { type: "application/json" }
            );

            const res = await importLibrary(resolvedFile, "overwrite");
            if (res && res.success) {
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.close();
            } else {
                alert(`导入失败: ${res?.error || "服务未响应"}`);
                submitBtn.disabled = false;
                submitBtn.textContent = "执行导入";
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

/* =========================================================================
   6. 导出数据统计与预览中心
   ========================================================================= */

export class ExportModalManager {
    /**
     * @param {() => any} getLibraryCallback
     */
    constructor(getLibraryCallback) {
        this.getLibrary = getLibraryCallback;
        this.overlay = null;
    }

    open() {
        this.close();
        const lib = this.getLibrary();
        const entries = lib.entries || [];
        const categories = lib.categories || [];
        const collections = lib.collections || [];

        const thumbnailsCount = entries.filter((e) => Boolean(e.previewHash || e.thumbnail)).length;

        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-medium" style="max-width: 660px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">导出</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div class="pv-export-card">
            <div class="pv-export-card-left">
              <span style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 8px; background: rgba(168, 85, 247, 0.15); color: #c084fc;">
                ${renderIcon("upload", 20)}
              </span>
              <div>
                <span class="pv-export-badge">便携备份</span>
                <div class="pv-export-title">导出提示词库</div>
                <div class="pv-export-subtitle">相关分类、收藏夹、标签和预览图引用会自动打包。</div>
              </div>
            </div>
            <div class="pv-export-card-right">
              <div class="pv-export-filename">prompt_library_export.json</div>
              <div class="pv-export-format">JSON 标准格式</div>
            </div>
          </div>

          <div class="pv-export-stats-grid">
            <div class="pv-export-stat-box">
              <span class="pv-export-stat-num">${entries.length}</span>
              <span class="pv-export-stat-label">词条</span>
            </div>
            <div class="pv-export-stat-box">
              <span class="pv-export-stat-num">${categories.length}</span>
              <span class="pv-export-stat-label">分类</span>
            </div>
            <div class="pv-export-stat-box">
              <span class="pv-export-stat-num">${collections.length}</span>
              <span class="pv-export-stat-label">收藏夹</span>
            </div>
            <div class="pv-export-stat-box">
              <span class="pv-export-stat-num">${thumbnailsCount}</span>
              <span class="pv-export-stat-label">预览图</span>
            </div>
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-export-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-export-confirm">
            ${renderIcon("upload", 12)} <span>导出</span>
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);

        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = this.overlay.querySelector("#pv-export-cancel");
        const confirmBtn = this.overlay.querySelector("#pv-export-confirm");

        const handleClose = () => this.close();
        closeBtn.addEventListener("click", handleClose);
        cancelBtn.addEventListener("click", handleClose);
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) handleClose();
        });

        confirmBtn.addEventListener("click", () => {
            triggerExportLibrary();
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