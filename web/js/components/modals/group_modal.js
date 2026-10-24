/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/group_modal.js */

/**
 * 存为提示词组 / 编辑提示词组（SaveGroupModalManager）弹窗管理器。
 * 遵循归一化模型：组合仅维护 entryIds 关联清单。
 * 支持新建组合（带未入库临时条目自动持久化检测、组员即时删除与纯图标“仅用于组合”专享切换）
 * 与既有组合元数据（名称、分类）在线编辑。
 */

import { upsertEntry, upsertGroup } from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";
import { buildCategoryHierarchyOptions } from "./category_helper.js";

function getVectorIcon(name, size = 12) {
  if (name === "layers") {
    return renderIcon("layers", size) || `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`;
  }
  if (name === "x") {
    return renderIcon("x", size) || `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  }
  if (name === "check") {
    return renderIcon("check", size) || `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  }
  return renderIcon(name, size);
}

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

  /**
   * 打开新建组合弹窗（由中栏多选选定磁贴打包）
   * @param {any[]} selectedTiles
   * @param {import("../../state.js").VaultNodeState|null} state
   */
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

    // 初始化待打包动态组员列表模型，初始读取词条的 groupOnly 属性
    const workingMembers = selectedTiles.map((tile) => {
      const matchedEntry = tile.ref_preset_id
        ? existingEntries.find((e) => e.id === tile.ref_preset_id)
        : null;
      return {
        tile,
        groupOnly: Boolean(matchedEntry ? matchedEntry.groupOnly : false),
      };
    });

    const candidateGroupTitles = Array.from(
      new Set(
        selectedTiles.flatMap((tile) =>
          (Array.isArray(tile.groups) ? tile.groups : [])
            .map((membership) => membership.title)
            .filter(Boolean)
        )
      )
    );

    let initialDefaultTitle = "";
    if (candidateGroupTitles.length === 1) {
      initialDefaultTitle = candidateGroupTitles[0];
    }

    this.overlay = document.createElement("div");
    this.overlay.className = "prompt-vault-modal-overlay";
    isolateCanvasEvents(this.overlay);

    this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-medium" style="max-width: 560px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">存为提示词组</div>
          <button type="button" class="prompt-vault-modal-close" title="关闭">${getVectorIcon("x", 16)}</button>
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
            <label class="prompt-vault-form-label" id="pv-group-members-count-label">
              包含组员序列 (共 ${workingMembers.length} 项，将按此顺序打包)
            </label>
            <div class="prompt-vault-group-preview-list" id="pv-group-members-container" style="max-height: 190px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid var(--pv-border-subtle); border-radius: var(--pv-radius-sm); padding: 6px 10px; display: flex; flex-direction: column; gap: 4px;">
            </div>
          </div>

          <div class="pv-info-callout" style="font-size: 11px; line-height: 1.4;">
            组合为纯净关系实体，所有词条将保存在词库中统一维护。若包含未入库的临时条目，将在此过程中自动录入词库。点击图层图标可设为“仅用于组合（在词库视图中隐藏）”。
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-group-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-group-submit">
            ${getVectorIcon("check", 12)} <span>确认并入库</span>
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
    const membersContainer = this.overlay.querySelector("#pv-group-members-container");
    const countLabel = this.overlay.querySelector("#pv-group-members-count-label");

    // 组员列表响应式渲染函数
    const renderMembersList = () => {
      if (!membersContainer || !countLabel) return;

      countLabel.textContent = `包含组员序列 (共 ${workingMembers.length} 项，将按此顺序打包)`;
      membersContainer.innerHTML = "";

      if (workingMembers.length === 0) {
        membersContainer.innerHTML = `
                    <div style="font-size: 11px; color: var(--pv-text-muted); text-align: center; padding: 16px 0;">
                        组员列表已清空，请至少保留 2 个词条
                    </div>
                `;
        return;
      }

      workingMembers.forEach((item, idx) => {
        const row = document.createElement("div");
        row.className = "pv-group-member-item";

        const cleanPrompt = (item.tile.prompt || "").replace(/[\r\n]+/g, " ");

        row.innerHTML = `
                    <span class="pv-group-member-index">#${idx + 1}</span>
                    <span class="pv-group-member-title" title="${item.tile.title || "未命名词条"}">${item.tile.title || "未命名词条"}</span>
                    <span class="pv-group-member-preview" title="${cleanPrompt}">${cleanPrompt}</span>
                    <div class="pv-group-member-actions">
                        <button type="button" class="pv-group-member-action-btn pv-toggle-grouponly-btn ${item.groupOnly ? "is-active" : ""}" title="${item.groupOnly ? "当前为仅组合专享（点击恢复为普通词条）" : "设为仅组合专享（从词库视图隐藏）"}">
                            ${getVectorIcon("layers", 13)}
                        </button>
                        <button type="button" class="pv-group-member-action-btn is-danger pv-delete-member-btn" title="从待打包组合中移除">
                            ${getVectorIcon("x", 12)}
                        </button>
                    </div>
                `;

        // 切换 groupOnly
        const toggleBtn = row.querySelector(".pv-toggle-grouponly-btn");
        if (toggleBtn) {
          toggleBtn.addEventListener("click", () => {
            item.groupOnly = !item.groupOnly;
            renderMembersList();
          });
        }

        // 移除当前组员
        const deleteBtn = row.querySelector(".pv-delete-member-btn");
        if (deleteBtn) {
          deleteBtn.addEventListener("click", () => {
            const targetIndex = workingMembers.indexOf(item);
            if (targetIndex !== -1) {
              workingMembers.splice(targetIndex, 1);
              renderMembersList();
            }
          });
        }

        membersContainer.appendChild(row);
      });
    };

    renderMembersList();

    const handleClose = () => this.close();
    if (closeBtn) closeBtn.addEventListener("click", handleClose);
    cancelBtn.addEventListener("click", handleClose);
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) handleClose();
    });

    submitBtn.addEventListener("click", async () => {
      if (workingMembers.length < 2) {
        alert("组合至少需包含 2 个词条，请勿过度删除！");
        return;
      }

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

      // 检查剩余临时未入库磁贴重名冲突
      const draftMembers = workingMembers.filter((m) => !m.tile.ref_preset_id);
      for (const draft of draftMembers) {
        const draftCleanTitle = (draft.tile.title || "").trim().toLowerCase();
        const collided = existingEntries.find(
          (e) => (e.title || "").trim().toLowerCase() === draftCleanTitle
        );
        if (collided) {
          alert(`所选包含的未入库词条 [${draft.tile.title}] 与词库已有词条重名！\n请在中栏重命名该词条后再打包组合。`);
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "保存中...";

      try {
        // 1. 自动持久化所有未入库的临时词条（携带 groupOnly 设定）
        for (const draft of draftMembers) {
          const entryRes = await upsertEntry({
            title: draft.tile.title || "未命名词条",
            text: draft.tile.prompt || "",
            categoryId: draft.tile.category_id || categoryId,
            note: "打包组合时自动创建入库",
            groupOnly: draft.groupOnly,
          });
          if (entryRes && entryRes.success && entryRes.data) {
            draft.tile.ref_preset_id = entryRes.data.id;
            draft.tile.is_dirty = false;
          } else {
            throw new Error(`自动创建词条 [${draft.tile.title}] 失败`);
          }
        }

        // 2. 检查既有词条的 groupOnly 是否发生修改，如有变更同步更新
        const boundMembers = workingMembers.filter((m) => Boolean(m.tile.ref_preset_id));
        for (const member of boundMembers) {
          const originalEntry = existingEntries.find((e) => e.id === member.tile.ref_preset_id);
          if (originalEntry && Boolean(originalEntry.groupOnly) !== Boolean(member.groupOnly)) {
            await upsertEntry({
              ...originalEntry,
              groupOnly: member.groupOnly,
            });
          }
        }

        // 3. 收集纯净 entryIds 序列（按保留顺序打包）
        const entryIds = workingMembers.map((m) => m.tile.ref_preset_id).filter(Boolean);

        // 4. 持久化组合关系实体
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
              workingMembers.map((m) => m.tile.instance_id),
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

  /**
   * 打开编辑组合弹窗（由左栏组合视图触发，编辑组合名称与所属分类）
   * @param {any} group
   */
  openEdit(group) {
    this.close();

    if (!group || !group.id) {
      return;
    }

    const rawLib = typeof this.getLibrary === "function" ? this.getLibrary() : {};
    const lib = Array.isArray(rawLib) ? { categories: rawLib, entries: [], groups: [] } : (rawLib || {});
    const categories = lib.categories || [];
    const existingEntries = lib.entries || [];
    const existingGroups = lib.groups || [];
    const categoryOptions = buildCategoryHierarchyOptions(categories);

    const memberEntryIds = Array.isArray(group.entryIds) ? group.entryIds : [];
    const memberEntries = memberEntryIds
      .map((id) => existingEntries.find((e) => e.id === id))
      .filter(Boolean);

    this.overlay = document.createElement("div");
    this.overlay.className = "prompt-vault-modal-overlay";
    isolateCanvasEvents(this.overlay);

    this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-medium" style="max-width: 560px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">编辑提示词组</div>
          <button type="button" class="prompt-vault-modal-close" title="关闭">${getVectorIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div class="prompt-vault-form-row">
            <div class="prompt-vault-form-col">
              <label class="prompt-vault-form-label">组合名称 *</label>
              <input
                type="text"
                class="prompt-vault-form-input"
                id="pv-edit-group-title"
                value="${group.title || ""}"
                placeholder="输入组合名称..."
                autofocus
                autocomplete="off"
              />
            </div>
            <div class="prompt-vault-form-col">
              <label class="prompt-vault-form-label">所属分类</label>
              <select class="prompt-vault-form-select" id="pv-edit-group-category">
                ${categoryOptions.map((opt) => `<option value="${opt.id}" ${opt.id === group.categoryId ? "selected" : ""}>${opt.label}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="prompt-vault-form-col">
            <label class="prompt-vault-form-label">包含组员序列 (共 ${memberEntries.length} 项)</label>
            <div class="prompt-vault-group-preview-list" style="max-height: 190px; overflow-y: auto; background: rgba(0,0,0,0.25); border: 1px solid var(--pv-border-subtle); border-radius: var(--pv-radius-sm); padding: 6px 10px; display: flex; flex-direction: column; gap: 4px;">
              ${memberEntries.length === 0
        ? `<div style="font-size: 11px; color: var(--pv-text-muted); text-align: center; padding: 12px 0;">该组合暂无成员词条</div>`
        : memberEntries.map((entry, idx) => `
                <div class="pv-group-member-item">
                  <span class="pv-group-member-index">#${idx + 1}</span>
                  <span class="pv-group-member-title" title="${entry.title || "未命名词条"}">${entry.title || "未命名词条"}</span>
                  <span class="pv-group-member-preview" title="${(entry.text || entry.prompt || "").replace(/[\r\n]+/g, " ")}">${(entry.text || entry.prompt || "").replace(/[\r\n]+/g, " ")}</span>
                  <div class="pv-group-member-actions">
                    ${entry.groupOnly ? `<span class="pv-group-member-action-btn is-active" title="仅组合专享条目">${getVectorIcon("layers", 13)}</span>` : ""}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-edit-group-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-edit-group-submit">
            ${getVectorIcon("check", 12)} <span>保存修改</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
    const cancelBtn = this.overlay.querySelector("#pv-edit-group-cancel");
    const submitBtn = this.overlay.querySelector("#pv-edit-group-submit");
    const titleInput = this.overlay.querySelector("#pv-edit-group-title");
    const categorySelect = this.overlay.querySelector("#pv-edit-group-category");

    const handleClose = () => this.close();
    if (closeBtn) closeBtn.addEventListener("click", handleClose);
    cancelBtn.addEventListener("click", handleClose);
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) handleClose();
    });

    submitBtn.addEventListener("click", async () => {
      const newTitle = (titleInput.value || "").trim();
      const categoryId = categorySelect.value || null;

      if (!newTitle) {
        alert("组合名称不能为空！");
        titleInput.focus();
        return;
      }

      const cleanTargetTitle = newTitle.toLowerCase();
      const duplicateGroup = existingGroups.find(
        (g) => g.id !== group.id && (g.title || "").trim().toLowerCase() === cleanTargetTitle
      );
      if (duplicateGroup) {
        alert(`词库中已存在同名组合 [${duplicateGroup.title}]，请更换名称！`);
        titleInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "保存中...";

      try {
        const groupPayload = {
          id: group.id,
          title: newTitle,
          categoryId: categoryId === "ALL" ? null : categoryId,
          entryIds: memberEntryIds,
          note: group.note || "",
        };

        const res = await upsertGroup(groupPayload);
        if (res && res.success) {
          if (typeof this.onSaved === "function") {
            await this.onSaved();
          }
          this.close();
        } else {
          alert(`更新组合失败: ${res?.error || "服务未响应"}`);
        }
      } catch (err) {
        console.error("[PromptVault] Error updating group:", err);
        alert(`更新组合异常: ${String(err)}`);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "保存修改";
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