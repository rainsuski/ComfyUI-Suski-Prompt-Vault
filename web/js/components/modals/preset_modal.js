/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/preset_modal.js */

/**
 * 单个词条录入与编辑弹窗（PresetModalManager）。
 * 支持已有词条【保存】、新词条【新建】与组合成员【另存为】【保存至组】场景化按钮，
 * 严格执行全库项（词条名与组名）唯一重名校验（除自己外不可重名），
 * 组成员保存至组时精准更新组合内部对应成员，彻底杜绝全文拼接与组合元数据篡改。
 */

import { getThumbnailUrl, upsertEntry } from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";
import { buildCategoryHierarchyOptions } from "./category_helper.js";

export class PresetModalManager {
    /**
     * @param {() => { categories: any[], collections: any[], tags: any[], entries?: any[] }} getLibraryCallback
     * @param {(savedData?: any) => Promise<void>} onSavedCallback
     */
    constructor(getLibraryCallback, onSavedCallback) {
        this.getLibrary = getLibraryCallback;
        this.onSaved = onSavedCallback;
        this.pendingImageFile = null;
        this.targetData = null;
        this.modalContext = null;
        this.onPasteHandler = this.handleGlobalPaste.bind(this);
    }

    /**
     * 打开预设条目录入/编辑弹窗。
     * @param {any} initialData - 初始条目或磁贴数据
     * @param {{ isGroupMember?: boolean, instanceId?: string, parentPresetId?: string, state?: any }} [context=null] - 上下文环境
     */
    open(initialData = null, context = null) {
        this.close();
        this.targetData = initialData;
        this.modalContext = context;
        this.pendingImageFile = null;

        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        const isGroupMember = Boolean(context?.isGroupMember || initialData?.group_id);
        const isExistingEntry = Boolean(!isGroupMember && initialData && initialData.id);
        const isNewEntry = Boolean(!isGroupMember && (!initialData || !initialData.id));

        const lib = this.getLibrary();
        const categories = lib.categories || [];
        const collections = lib.collections || [];
        const categoryOptions = buildCategoryHierarchyOptions(categories);

        let modalTitleText = "新建预设条目";
        if (isGroupMember) {
            modalTitleText = "编辑组合成员";
        } else if (isExistingEntry) {
            modalTitleText = "编辑预设条目";
        }

        let footerButtonsHtml = "";
        if (isGroupMember) {
            footerButtonsHtml = `
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-modal-cancel">取消</button>
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-modal-save-as-new" title="脱离组合，作为独立普通词条收录进词库">另存为</button>
              <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-modal-save-to-group" title="更新所属组合内的该成员定义">保存至组</button>
            `;
        } else if (isExistingEntry) {
            footerButtonsHtml = `
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-modal-cancel">取消</button>
              <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-modal-save">保存</button>
            `;
        } else {
            footerButtonsHtml = `
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-modal-cancel">取消</button>
              <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-modal-save">新建</button>
            `;
        }

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-medium">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">${modalTitleText}</div>
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
          ${footerButtonsHtml}
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);
        this.fillFormData(initialData);
        this.bindEvents(isGroupMember);
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

    bindEvents(isGroupMember) {
        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = this.overlay.querySelector("#pv-modal-cancel");
        const saveBtn = this.overlay.querySelector("#pv-modal-save");
        const saveAsNewBtn = this.overlay.querySelector("#pv-modal-save-as-new");
        const saveToGroupBtn = this.overlay.querySelector("#pv-modal-save-to-group");
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

        if (saveBtn) {
            saveBtn.addEventListener("click", () => this.submitStandardForm());
        }

        if (saveAsNewBtn) {
            saveAsNewBtn.addEventListener("click", () => this.submitSaveAsNew());
        }

        if (saveToGroupBtn) {
            saveToGroupBtn.addEventListener("click", () => this.submitSaveToGroup());
        }
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

    /**
     * 校验当前输入标题在词库全项（词条名与组名）中是否唯一。
     * @param {string} title
     * @param {string|null} [selfId=null] - 允许同名的自身条目 ID
     * @returns {boolean}
     */
    checkTitleUniqueness(title, selfId = null) {
        const lib = this.getLibrary();
        const entries = lib.entries || [];
        const cleanTarget = title.trim().toLowerCase();

        return !entries.some((e) => {
            if (selfId && e.id === selfId) return false;
            return (e.title || "").trim().toLowerCase() === cleanTarget;
        });
    }

    /**
     * 提交普通词条的新建或修改（已有词条覆盖 / 新词条新建）。
     */
    async submitStandardForm() {
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

        const selfId = this.targetData && this.targetData.id ? this.targetData.id : null;
        if (!this.checkTitleUniqueness(title, selfId)) {
            alert(`词库中已存在名为 [${title}] 的条目（提示词或组合），提示词库中所有项名称均不可重名！`);
            return;
        }

        const tags = tagsRaw.split(/[,，]+/).map((t) => t.trim()).filter(Boolean);

        const payload = {
            id: selfId || undefined,
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

        try {
            const result = await upsertEntry(payload, this.pendingImageFile);
            if (result && result.success) {
                if (typeof this.onSaved === "function") {
                    await this.onSaved(result.data);
                }
                this.close();
            } else {
                alert(`保存失败: ${result?.error || "服务未响应"}`);
            }
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = selfId ? "保存" : "新建";
            }
        }
    }

    /**
     * 组成员另存为独立普通词条（脱离组合，全库新建）。
     */
    async submitSaveAsNew() {
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

        if (!this.checkTitleUniqueness(title, null)) {
            alert(`词库中已存在名为 [${title}] 的条目（提示词或组合），提示词库中所有项名称均不可重名！`);
            return;
        }

        const tags = tagsRaw.split(/[,，]+/).map((t) => t.trim()).filter(Boolean);

        const payload = {
            title,
            text: prompt,
            categoryId: categoryId || null,
            tags: tags,
            collections: folder ? [folder] : [],
            note,
            previewHash: null,
        };

        const saveAsNewBtn = this.overlay.querySelector("#pv-modal-save-as-new");
        if (saveAsNewBtn) {
            saveAsNewBtn.disabled = true;
            saveAsNewBtn.textContent = "保存中...";
        }

        try {
            const result = await upsertEntry(payload, this.pendingImageFile);
            if (result && result.success) {
                if (typeof this.onSaved === "function") {
                    await this.onSaved(result.data);
                }
                this.close();
            } else {
                alert(`另存为失败: ${result?.error || "服务未响应"}`);
            }
        } finally {
            if (saveAsNewBtn) {
                saveAsNewBtn.disabled = false;
                saveAsNewBtn.textContent = "另存为";
            }
        }
    }

    /**
     * 将编辑内容精准同步至所属组合模板（更新组合内部对应成员，绝不触碰组合元数据与拼接文本）。
     */
    async submitSaveToGroup() {
        const title = (this.overlay.querySelector("#pv-form-title")?.value || "").trim();
        const prompt = (this.overlay.querySelector("#pv-form-prompt")?.value || "").trim();

        if (!title) {
            alert("请输入成员标题！");
            return;
        }
        if (!prompt) {
            alert("请输入提示词内容！");
            return;
        }

        const parentPresetId = this.modalContext?.parentPresetId || this.targetData?.ref_preset_id;
        if (!parentPresetId) {
            alert("未找到该组员所属的组合预设 ID，无法同步至组！");
            return;
        }

        const lib = this.getLibrary();
        const entries = lib.entries || [];
        const parentGroup = entries.find((e) => e.id === parentPresetId);

        if (!parentGroup) {
            alert("词库中未找到所属的组合模板条目，可能已被删除！");
            return;
        }

        const rawMembers = parentGroup.groupMembers || parentGroup.members || [];
        if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
            alert("该条目并非有效的组合模板！");
            return;
        }

        const saveToGroupBtn = this.overlay.querySelector("#pv-modal-save-to-group");
        if (saveToGroupBtn) {
            saveToGroupBtn.disabled = true;
            saveToGroupBtn.textContent = "保存中...";
        }

        try {
            const originalTitle = this.targetData?.title || "";
            const originalPrompt = this.targetData?.text || this.targetData?.prompt || "";

            let matchedMemberIdx = rawMembers.findIndex(
                (m) => m.title === originalTitle && (m.text === originalPrompt || m.prompt === originalPrompt)
            );

            if (matchedMemberIdx === -1) {
                matchedMemberIdx = rawMembers.findIndex((m) => m.title === originalTitle);
            }

            if (matchedMemberIdx === -1) {
                matchedMemberIdx = 0;
            }

            const updatedMembers = [...rawMembers];
            updatedMembers[matchedMemberIdx] = {
                title: title,
                text: prompt,
            };

            const payload = {
                id: parentGroup.id,
                title: parentGroup.title,
                text: "",
                categoryId: parentGroup.categoryId || null,
                groupMembers: updatedMembers,
                tags: parentGroup.tags || [],
                collections: parentGroup.collections || [],
                note: parentGroup.note || "",
                previewHash: parentGroup.previewHash || parentGroup.thumbnail || null,
            };

            const result = await upsertEntry(payload);
            if (result && result.success) {
                const state = this.modalContext?.state;
                const instanceId = this.modalContext?.instanceId || this.targetData?.instance_id;
                if (state && instanceId) {
                    state.markGroupMemberAsSaved(instanceId, {
                        title: title,
                        prompt: prompt,
                    });
                }
                if (typeof this.onSaved === "function") {
                    await this.onSaved(result.data);
                }
                this.close();
            } else {
                alert(`更新至组失败: ${result?.error || "服务未响应"}`);
            }
        } finally {
            if (saveToGroupBtn) {
                saveToGroupBtn.disabled = false;
                saveToGroupBtn.textContent = "保存至组";
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
        this.modalContext = null;
    }
}