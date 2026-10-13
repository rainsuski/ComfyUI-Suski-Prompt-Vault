/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/group_modal.js */

/**
 * 存为提示词组（SaveGroupModalManager）弹窗管理器。
 * 将中栏多选的提示词序列就地打包为包含 groupMembers 的持久化模板条目，
 * 完成本地词库持久化入库，回填条目 ID，联动状态机就地绑定高亮连线与异常安全防护。
 */

import { upsertEntry } from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";
import { buildCategoryHierarchyOptions } from "./category_helper.js";

export class SaveGroupModalManager {
    /**
     * @param {() => { categories: any[] }} getLibraryCallback
     * @param {(savedEntry: any) => Promise<void>} onSavedCallback
     */
    constructor(getLibraryCallback, onSavedCallback) {
        this.getLibrary = getLibraryCallback;
        this.onSaved = onSavedCallback;
        this.overlay = null;
    }

    open(selectedTiles = [], state = null) {
        this.close();

        if (!selectedTiles || selectedTiles.length < 2) {
            alert("请至少多选 2 个提示词词条以打包为组合！");
            return;
        }

        const lib = this.getLibrary();
        const categories = lib.categories || [];
        const categoryOptions = buildCategoryHierarchyOptions(categories);

        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-medium" style="max-width: 540px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">存为提示词组</div>
          <button type="button" class="prompt-vault-modal-close" title="关闭">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div class="prompt-vault-form-row">
            <div class="prompt-vault-form-col">
              <label class="prompt-vault-form-label">组合名称 *</label>
              <input type="text" class="prompt-vault-form-input" id="pv-group-title" placeholder="例如：做饭场景框架" autofocus />
            </div>
            <div class="prompt-vault-form-col">
              <label class="prompt-vault-form-label">所属分类</label>
              <select class="prompt-vault-form-select" id="pv-group-category">
                ${categoryOptions.map((opt) => `<option value="${opt.id}">${opt.label}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="prompt-vault-form-col">
            <label class="prompt-vault-form-label">包含组员序列 (共 ${selectedTiles.length} 项，将按此顺序打包)</label>
            <div class="prompt-vault-group-preview-list" style="max-height: 180px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid var(--pv-border-subtle); border-radius: var(--pv-radius-sm); padding: 8px 12px; display: flex; flex-direction: column; gap: 6px;">
              ${selectedTiles.map((tile, idx) => `
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; gap: 8px;">
                  <span style="color: var(--pv-text-secondary); font-family: var(--pv-font-mono); font-size: 11px;">#${idx + 1}</span>
                  <span style="color: var(--pv-text-primary); font-weight: 500; flex: 1 1 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tile.title || "未命名词条"}</span>
                  <span style="color: var(--pv-text-muted); font-size: 11px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${(tile.prompt || "").replace(/[\r\n]+/g, " ")}</span>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="pv-info-callout" style="font-size: 11px; line-height: 1.4;">
            保存后，该组合将收录入左侧词库；中栏当前所选的这 ${selectedTiles.length} 项将就地绑定为组合关联状态并生成连线。
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-group-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-group-submit">
            ${renderIcon("check", 12)} <span>确认并入库</span>
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);

        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = this.overlay.querySelector("#pv-group-cancel");
        const submitBtn = this.overlay.querySelector("#pv-group-submit");
        const titleInput = this.overlay.querySelector("#pv-group-title");
        const categorySelect = this.overlay.querySelector("#pv-group-category");

        const handleClose = () => this.close();
        closeBtn.addEventListener("click", handleClose);
        cancelBtn.addEventListener("click", handleClose);
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) handleClose();
        });

        submitBtn.addEventListener("click", async () => {
            const groupTitle = (titleInput.value || "").trim();
            const categoryId = categorySelect.value || null;

            if (!groupTitle) {
                alert("请输入组合名称！");
                titleInput.focus();
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = "保存中...";

            try {
                const groupMembers = selectedTiles.map((t) => ({
                    title: t.title || "组员",
                    text: t.prompt || "",
                }));

                const payload = {
                    title: groupTitle,
                    text: groupMembers.map((m) => m.text).join(", "),
                    categoryId: categoryId,
                    groupMembers: groupMembers,
                    tags: [],
                    collections: [],
                    note: "由中栏已选词条序列打包生成",
                    previewHash: null,
                };

                const result = await upsertEntry(payload);
                if (result && result.success) {
                    const savedEntryId = result.data?.id || null;
                    if (state) {
                        const newGroupId = `grp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                        state.bindTilesToGroup(
                            selectedTiles.map((t) => t.instance_id),
                            newGroupId,
                            groupTitle,
                            null,
                            savedEntryId
                        );
                    }
                    if (typeof this.onSaved === "function") {
                        await this.onSaved(result.data);
                    }
                    this.close();
                } else {
                    alert(`保存组合失败: ${result?.error || "服务未响应"}`);
                }
            } catch (err) {
                console.error("[PromptVault] Error saving group template:", err);
                alert(`保存组合异常: ${String(err)}`);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "确认并入库";
                }
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