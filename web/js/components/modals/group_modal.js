/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/group_modal.js */

/**
 * 存为提示词组（SaveGroupModalManager）弹窗管理器。
 * 提供支持自输入与历史匹配的可输入下拉框（Combo Input），
 * 杜绝管理端擅自拼接全文（text 保持为空），仅维护纯净组合结构与成员，
 * 严格执行词库全项（词条名与组名）唯一重名校验（除覆盖自身绑定的原组外禁止重名）。
 */

import { upsertEntry } from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";
import { buildCategoryHierarchyOptions } from "./category_helper.js";

export class SaveGroupModalManager {
    /**
     * @param {() => { categories: any[], entries?: any[] } | any} getLibraryCallback
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

        const rawLib = typeof this.getLibrary === "function" ? this.getLibrary() : {};
        const lib = Array.isArray(rawLib) ? { categories: rawLib, entries: [] } : (rawLib || {});
        const categories = lib.categories || [];
        const existingEntries = lib.entries || [];
        const categoryOptions = buildCategoryHierarchyOptions(categories);

        // 提取所选磁贴中包含的已有组名并去重
        const candidateGroupTitles = Array.from(
            new Set(selectedTiles.map((t) => t.group_title).filter(Boolean))
        );

        // 提取所选磁贴中关联的既有组合条目 ID 集合
        const associatedPresetIds = new Set(
            selectedTiles.map((t) => t.ref_preset_id).filter(Boolean)
        );

        // 智能默认值：恰好只有 1 个候选组名时自动预填，否则保持留空
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
              <label class="prompt-vault-form-label">组合名称 * (可输入新名称或下拉选择已有)</label>
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
            提示词库中所有项（词条与词组）名称均保持全库唯一。保存后所选磁贴将原地绑定组合并点亮连线。
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

            // 全库唯一重名检测：同时检索全库所有词条名与组名
            const cleanTargetTitle = groupTitle.toLowerCase();
            const duplicateEntry = existingEntries.find((e) => {
                const existingTitle = (e.title || "").trim().toLowerCase();
                return existingTitle === cleanTargetTitle;
            });

            if (duplicateEntry) {
                // 仅当同名项正是当前所选磁贴绑定的同一个原组时，允许覆盖保存，其余一律拒绝重名
                const isOverwritingSelf = associatedPresetIds.has(duplicateEntry.id);
                if (!isOverwritingSelf) {
                    alert(`词库中已存在名为 [${duplicateEntry.title}] 的条目（提示词或组合），提示词库中所有项名称均不可重名，请更换名称！`);
                    titleInput.focus();
                    return;
                }
            }

            submitBtn.disabled = true;
            submitBtn.textContent = "保存中...";

            try {
                const groupMembers = selectedTiles.map((t) => ({
                    title: t.title || "组员",
                    text: t.prompt || "",
                }));

                const targetOverwriteEntry = duplicateEntry && associatedPresetIds.has(duplicateEntry.id)
                    ? duplicateEntry
                    : null;

                const payload = {
                    id: targetOverwriteEntry ? targetOverwriteEntry.id : undefined,
                    title: groupTitle,
                    text: "",
                    categoryId: categoryId || (targetOverwriteEntry ? targetOverwriteEntry.categoryId : null),
                    groupMembers: groupMembers,
                    tags: targetOverwriteEntry ? targetOverwriteEntry.tags || [] : [],
                    collections: targetOverwriteEntry ? targetOverwriteEntry.collections || [] : [],
                    note: targetOverwriteEntry ? targetOverwriteEntry.note || "" : "由中栏已选词条序列打包生成",
                    previewHash: targetOverwriteEntry ? targetOverwriteEntry.previewHash || targetOverwriteEntry.thumbnail || null : null,
                };

                const result = await upsertEntry(payload);
                if (result && result.success) {
                    const savedEntryId = result.data?.id || (targetOverwriteEntry ? targetOverwriteEntry.id : null);
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