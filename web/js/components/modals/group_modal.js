/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/group_modal.js */

/**
 * 存为提示词组（SaveGroupModalManager）弹窗管理器。
 * 遵循归一化模型：组合仅维护 entryIds 关联清单。
 * 针对中栏未入库的临时磁贴，严格执行全库重名检测阻止，并自动持久化生成 entry 后绑定组合。
 */

import { upsertEntry, upsertGroup } from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";
import { buildCategoryHierarchyOptions } from "./category_helper.js";

export class SaveGroupModalManager {
    /**
     * @param {() => { categories: any[], entries?: any[], groups?: any[] } | any} getLibraryCallback
     * @param {() => Promise<void>} onSavedCallback
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

        const rawLib = typeof this.getLibrary === "function" ? this.getLibrary() : {};
        const lib = Array.isArray(rawLib) ? { categories: rawLib, entries: [], groups: [] } : (rawLib || {});
        const categories = lib.categories || [];
        const existingEntries = lib.entries || [];
        const existingGroups = lib.groups || [];
        const categoryOptions = buildCategoryHierarchyOptions(categories);

        const candidateGroupTitles = Array.from(
            new Set(selectedTiles.map((t) => t.group_title).filter(Boolean))
        );

        let initialDefaultTitle = "";
        if (candidateGroupTitles.length === 1) {
            initialDefaultTitle = candidateGroupTitles[0];
        }

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
              <label class="prompt-vault-form-label">组合名称 * (可输入新名称或选择已有)</label>
              <input
                type="text"
                list="pv-group-datalist"
                class="prompt-vault-form-input"
                id="pv-group-title"
                value="${initialDefaultTitle}"
                placeholder="输入新组合名称，或从下拉菜单中选择..."
                autofocus
                autocomplete="off"
              />
              <datalist id="pv-group-datalist">
                ${candidateGroupTitles.map((title) => `<option value="${title}"></option>`).join("")}
              </datalist>
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
            组合为纯净关系实体，所有词条将保存在词库中统一维护。若包含未入库的临时条目，将在此过程中自动录入词库。
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

        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-modal-close") || this.overlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = this.overlay.querySelector("#pv-group-cancel");
        const submitBtn = this.overlay.querySelector("#pv-group-submit");
        const titleInput = this.overlay.querySelector("#pv-group-title");
        const categorySelect = this.overlay.querySelector("#pv-group-category");

        const handleClose = () => this.close();
        if (closeBtn) closeBtn.addEventListener("click", handleClose);
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

            // 组合防重名检测
            const cleanTargetTitle = groupTitle.toLowerCase();
            const duplicateGroup = existingGroups.find(
                (g) => (g.title || "").trim().toLowerCase() === cleanTargetTitle
            );

            // 检查临时未入库磁贴重名冲突
            const draftTiles = selectedTiles.filter((t) => !t.ref_preset_id);
            for (const draft of draftTiles) {
                const draftCleanTitle = (draft.title || "").trim().toLowerCase();
                const collided = existingEntries.find(
                    (e) => (e.title || "").trim().toLowerCase() === draftCleanTitle
                );
                if (collided) {
                    alert(`所选包含的未入库词条 [${draft.title}] 与词库已有词条重名！\n请在中栏重命名该词条后再打包组合。`);
                    return;
                }
            }

            submitBtn.disabled = true;
            submitBtn.textContent = "保存中...";

            try {
                // 1. 自动持久化所有未入库的临时词条
                for (const draft of draftTiles) {
                    const entryRes = await upsertEntry({
                        title: draft.title || "未命名词条",
                        text: draft.prompt || "",
                        categoryId: draft.category_id || categoryId,
                        note: "打包组合时自动创建入库",
                    });
                    if (entryRes && entryRes.success && entryRes.data) {
                        draft.ref_preset_id = entryRes.data.id;
                        draft.is_dirty = false;
                    } else {
                        throw new Error(`自动创建词条 [${draft.title}] 失败`);
                    }
                }

                // 2. 收集纯净 entryIds 序列
                const entryIds = selectedTiles.map((t) => t.ref_preset_id).filter(Boolean);

                // 3. 持久化组合关系实体
                const groupPayload = {
                    id: duplicateGroup ? duplicateGroup.id : undefined,
                    title: groupTitle,
                    categoryId: categoryId || (duplicateGroup ? duplicateGroup.categoryId : null),
                    entryIds: entryIds,
                    note: duplicateGroup ? duplicateGroup.note : "由中栏选定磁贴序列打包生成",
                };

                const groupRes = await upsertGroup(groupPayload);
                if (groupRes && groupRes.success) {
                    const savedGroupId = groupRes.data?.id || (duplicateGroup ? duplicateGroup.id : null);
                    if (state) {
                        const newRuntimeGroupId = `grp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                        state.bindTilesToGroup(
                            selectedTiles.map((t) => t.instance_id),
                            newRuntimeGroupId,
                            groupTitle,
                            null,
                            savedGroupId
                        );
                    }

                    if (typeof this.onSaved === "function") {
                        await this.onSaved();
                    }
                    this.close();
                } else {
                    alert(`保存组合失败: ${groupRes?.error || "服务未响应"}`);
                }
            } catch (err) {
                console.error("[PromptVault] Error saving group:", err);
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