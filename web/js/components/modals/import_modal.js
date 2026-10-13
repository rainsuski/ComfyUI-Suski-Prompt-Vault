/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/import_modal.js */

/**
 * 导入词库差异预检与冲突处理中心（ImportModalManager）。
 * 支持文件完整性校验、五维统计（新增/已有/冲突/重复/无效）、
 * 可折叠差异审查与覆盖/保留/创建副本批量冲突消解策略。
 */

import { importLibrary } from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";

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

          ${hasConflicts ? `
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
              ${conflictEntries.map((c, idx) => `
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
              `).join("")}
            </div>
          </div>
          ` : ""}

          ${hasDuplicates ? `
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
              ${duplicateEntries.map((d) => `
                <div class="pv-entry-item-row">
                  <span class="pv-entry-item-title">${d.item.title || "未命名"}</span>
                  <span style="font-size: 11px; color: #eab308;">${d.reason}</span>
                </div>
              `).join("")}
            </div>
          </div>
          ` : ""}

          ${hasInvalid ? `
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
              ${invalidEntries.map((inv) => `
                <div class="pv-entry-item-row">
                  <span class="pv-entry-item-title">${inv.item.title || "未命名"}</span>
                  <span style="font-size: 11px; color: #ef4444;">${inv.reason}</span>
                </div>
              `).join("")}
            </div>
          </div>
          ` : ""}

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
                : existingEntries.map((e) => `
                <div class="pv-entry-item-row">
                  <span class="pv-entry-item-title">${e.title || "未命名"}</span>
                  <span class="pv-entry-item-desc">${(e.text || e.prompt || "").replace(/[\r\n]+/g, " ")}</span>
                </div>
              `).join("")}
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

        const itemSelects = this.overlay.querySelectorAll(".pv-item-strategy");
        itemSelects.forEach((sel) => {
            sel.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.idx, 10);
                if (conflictEntries[idx]) {
                    conflictEntries[idx].strategy = e.target.value;
                }
            });
        });

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