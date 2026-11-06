/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/export_modal.js */

/**
 * 导出与批量分享中心（ExportModalManager）。
 * 支持：
 * 1. 批量分享代码生成：采用 V2 极简元组列式压缩，彻底剔除 UUID/图片哈希等冗余，体积缩减 75% 以上，单条 QQ 轻松发送；
 * 2. 整库 JSON 备份导出：维持原有的单文件全量下载。
 */

import { triggerExportLibrary } from "../../api.js";
import { isolateCanvasEvents, isolateWheelScroll } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";
import { encodeSharePayload } from "../../utils/share_codec.js";

function getSafeIcon(name, size = 13) {
  if (name === "share") {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`;
  }
  const icon = renderIcon(name, size);
  return icon || "";
}

export class ExportModalManager {
  /**
   * @param {() => any} getLibraryCallback
   */
  constructor(getLibraryCallback) {
    this.getLibrary = getLibraryCallback;
    this.overlay = null;
    this.currentTab = "share"; // "share" | "file"
    this.stateContext = null;

    // 筛选与选择状态
    this.selectedEntryIds = new Set();
    this.searchKeyword = "";
    this.filterCategory = "ALL";
    this.viewSubMode = "entries"; // "entries" | "groups"
  }

  /**
   * 打开导出/分享弹窗
   * @param {import("../../state.js").VaultNodeState} [stateContext] 当前节点状态（用于一键选择当前中栏词条）
   */
  open(stateContext = null) {
    this.close();
    this.stateContext = stateContext;
    this.currentTab = "share";
    this.selectedEntryIds.clear();
    this.searchKeyword = "";
    this.filterCategory = "ALL";
    this.viewSubMode = "entries";

    // 默认将中栏已有的词条自动勾选
    if (this.stateContext && Array.isArray(this.stateContext.selectedTiles)) {
      this.stateContext.selectedTiles.forEach((t) => {
        if (t.ref_preset_id) {
          this.selectedEntryIds.add(t.ref_preset_id);
        }
      });
    }

    this.overlay = document.createElement("div");
    this.overlay.className = "prompt-vault-modal-overlay";
    isolateCanvasEvents(this.overlay);

    this.renderModal();
    document.body.appendChild(this.overlay);
  }

  renderModal() {
    const lib = this.getLibrary() || {};
    const entries = lib.entries || [];
    const groups = lib.groups || [];
    const categories = lib.categories || [];
    const collections = lib.collections || [];
    const thumbnailsCount = entries.filter((e) => Boolean(e.previewHash || e.thumbnail)).length;

    this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-large" style="max-width: 780px; min-height: 580px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">导出与分享</div>
          <button type="button" class="prompt-vault-modal-close">${getSafeIcon("x", 16)}</button>
        </div>

        <div class="pv-modal-tabs">
          <button type="button" class="pv-modal-tab-btn ${this.currentTab === "share" ? "is-active" : ""}" id="pv-tab-share">
            ${getSafeIcon("share", 13)} <span>批量分享代码</span>
          </button>
          <button type="button" class="pv-modal-tab-btn ${this.currentTab === "file" ? "is-active" : ""}" id="pv-tab-file">
            ${getSafeIcon("download", 13)} <span>整库文件备份</span>
          </button>
        </div>

        <div class="prompt-vault-modal-body" style="padding-top: 14px;" id="pv-export-modal-body">
          ${this.currentTab === "share" ? this.renderShareTabHTML(entries, groups, categories) : this.renderFileTabHTML(entries, groups, categories, collections, thumbnailsCount)}
        </div>

        <div class="prompt-vault-modal-footer" id="pv-export-modal-footer">
          ${this.renderFooterHTML()}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderShareTabHTML(entries, groups, categories) {
    return `
      <div class="pv-share-container">
        <!-- 顶部过滤与快捷操作栏 -->
        <div class="pv-share-filter-bar">
          <div class="pv-share-filter-inputs">
            <div class="pv-share-search-box">
              <span class="pv-share-search-icon">${getSafeIcon("search", 13)}</span>
              <input type="text" class="pv-share-search-input" id="pv-share-search-input" placeholder="搜索词条标题或提示词正文..." value="${this.escapeHtml(this.searchKeyword)}">
            </div>
            <select class="prompt-vault-form-select pv-share-cat-dropdown" id="pv-share-cat-select">
              <option value="ALL">全部分类</option>
              ${categories.map((c) => `<option value="${c.id}" ${this.filterCategory === c.id ? "selected" : ""}>${this.escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
          <div class="pv-share-action-group">
            <button type="button" class="pv-share-btn-accent" id="pv-share-quick-workspace" title="一键选定当前中栏工作区的所有词条">
              ${getSafeIcon("layers", 12)} <span>选定工作区词条</span>
            </button>
            <button type="button" class="pv-share-btn-subtle" id="pv-share-select-all">全选</button>
            <button type="button" class="pv-share-btn-subtle" id="pv-share-clear-all">清空</button>
          </div>
        </div>

        <!-- 模式切换与已选计数栏 -->
        <div class="pv-share-subnav-row">
          <div class="pv-share-pill-toggle">
            <button type="button" class="pv-share-pill-btn ${this.viewSubMode === "entries" ? "is-active" : ""}" id="pv-submode-entries">
              词条列表 (${entries.length})
            </button>
            <button type="button" class="pv-share-pill-btn ${this.viewSubMode === "groups" ? "is-active" : ""}" id="pv-submode-groups">
              提示词组 (${groups.length})
            </button>
          </div>
          <div class="pv-share-selected-badge">
            已勾选 <strong id="pv-share-count-text">${this.selectedEntryIds.size}</strong> 项条目
          </div>
        </div>

        <!-- 列表视口 -->
        <div class="pv-share-viewport-wrap" id="pv-share-viewport">
          ${this.renderShareItemsListHTML(entries, groups, categories)}
        </div>

        <!-- 生成后的高质感代码卡片 (初始隐藏) -->
        <div class="pv-share-result-panel" id="pv-share-code-box" style="display: none;">
          <div class="pv-share-result-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(59, 130, 246, 0.2); color: #60a5fa;">
                ${getSafeIcon("share", 12)}
              </span>
              <span style="font-weight: 700; color: #f3f4f6; font-size: 13px;">分享代码已生成 (极速超轻量)</span>
            </div>
            <span class="pv-share-stat-pill" id="pv-share-code-stat"></span>
          </div>
          <textarea class="pv-share-result-textarea" id="pv-share-code-output" readonly></textarea>
        </div>
      </div>
    `;
  }

  renderShareItemsListHTML(entries, groups, categories) {
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const kw = (this.searchKeyword || "").toLowerCase();

    if (this.viewSubMode === "entries") {
      const filteredEntries = entries.filter((e) => {
        if (this.filterCategory !== "ALL" && e.categoryId !== this.filterCategory) return false;
        if (kw) {
          const matchTitle = (e.title || "").toLowerCase().includes(kw);
          const matchText = (e.text || e.prompt || "").toLowerCase().includes(kw);
          return matchTitle || matchText;
        }
        return true;
      });

      if (filteredEntries.length === 0) {
        return `
          <div class="pv-share-empty-box">
            <div style="font-size: 20px; opacity: 0.5; margin-bottom: 4px;">🔍</div>
            <div>未找到匹配的词条条目</div>
          </div>
        `;
      }

      return filteredEntries.map((entry) => {
        const isChecked = this.selectedEntryIds.has(entry.id);
        const cat = catMap.get(entry.categoryId);
        return `
          <label class="pv-share-card-item ${isChecked ? "is-selected" : ""}">
            <div class="pv-share-card-checkbox-wrap">
              <input type="checkbox" class="pv-share-checkbox" data-entry-id="${entry.id}" ${isChecked ? "checked" : ""}>
            </div>
            <div class="pv-share-card-content">
              <div class="pv-share-card-top">
                <span class="pv-share-card-title">${this.escapeHtml(entry.title || "未命名词条")}</span>
                ${cat ? `<span class="pv-share-cat-tag" style="background:${cat.color}18; color:${cat.color}; border: 1px solid ${cat.color}35;">${this.escapeHtml(cat.name)}</span>` : ""}
              </div>
              <div class="pv-share-card-snippet">
                ${this.escapeHtml((entry.text || entry.prompt || "").replace(/[\r\n]+/g, " ")) || "<span style='opacity:0.4;'>（无提示词正文）</span>"}
              </div>
            </div>
          </label>
        `;
      }).join("");
    } else {
      const filteredGroups = groups.filter((g) => {
        if (this.filterCategory !== "ALL" && g.categoryId !== this.filterCategory) return false;
        if (kw) {
          return (g.title || "").toLowerCase().includes(kw);
        }
        return true;
      });

      if (filteredGroups.length === 0) {
        return `
          <div class="pv-share-empty-box">
            <div style="font-size: 20px; opacity: 0.5; margin-bottom: 4px;">📂</div>
            <div>未找到匹配的提示词组</div>
          </div>
        `;
      }

      return filteredGroups.map((group) => {
        const memberIds = Array.isArray(group.entryIds) ? group.entryIds : [];
        const allSelected = memberIds.length > 0 && memberIds.every((id) => this.selectedEntryIds.has(id));
        const partialSelected = !allSelected && memberIds.some((id) => this.selectedEntryIds.has(id));
        const cat = catMap.get(group.categoryId);

        return `
          <label class="pv-share-card-item ${allSelected ? "is-selected" : ""}">
            <div class="pv-share-card-checkbox-wrap">
              <input type="checkbox" class="pv-share-group-checkbox" data-group-id="${group.id}" ${allSelected ? "checked" : ""} data-indeterminate="${partialSelected}">
            </div>
            <div class="pv-share-card-content">
              <div class="pv-share-card-top">
                <span class="pv-share-card-title">${this.escapeHtml(group.title || "未命名组合")}</span>
                <span class="pv-share-count-tag">${memberIds.length} 项成员</span>
                ${cat ? `<span class="pv-share-cat-tag" style="background:${cat.color}18; color:${cat.color}; border: 1px solid ${cat.color}35;">${this.escapeHtml(cat.name)}</span>` : ""}
              </div>
              <div class="pv-share-card-snippet">
                ${this.escapeHtml(group.note || `关联 ${memberIds.length} 个独立词条组合结构`)}
              </div>
            </div>
          </label>
        `;
      }).join("");
    }
  }

  renderFileTabHTML(entries, groups, categories, collections, thumbnailsCount) {
    return `
      <div class="pv-export-card">
        <div class="pv-export-card-left">
          <span style="display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 8px; background: rgba(168, 85, 247, 0.18); color: #c084fc;">
            ${getSafeIcon("upload", 20)}
          </span>
          <div>
            <span class="pv-export-badge">全量单文件备份</span>
            <div class="pv-export-title">导出提示词库全量备份</div>
            <div class="pv-export-subtitle">词条、提示词组、分类、收藏夹、标签及预览图哈希将完整封装为标准 JSON 文件。</div>
          </div>
        </div>
        <div class="pv-export-card-right">
          <div class="pv-export-filename">prompt_library_export.json</div>
          <div class="pv-export-format">JSON 标准格式</div>
        </div>
      </div>

      <div class="pv-export-stats-grid" style="margin-top: 14px;">
        <div class="pv-export-stat-box">
          <span class="pv-export-stat-num">${entries.length}</span>
          <span class="pv-export-stat-label">词条总数</span>
        </div>
        <div class="pv-export-stat-box">
          <span class="pv-export-stat-num">${groups.length}</span>
          <span class="pv-export-stat-label">提示词组</span>
        </div>
        <div class="pv-export-stat-box">
          <span class="pv-export-stat-num">${categories.length}</span>
          <span class="pv-export-stat-label">层级分类</span>
        </div>
        <div class="pv-export-stat-box">
          <span class="pv-export-stat-num">${collections.length}</span>
          <span class="pv-export-stat-label">收藏夹</span>
        </div>
        <div class="pv-export-stat-box">
          <span class="pv-export-stat-num">${thumbnailsCount}</span>
          <span class="pv-export-stat-label">预览缩略图</span>
        </div>
      </div>
    `;
  }

  renderFooterHTML() {
    if (this.currentTab === "share") {
      return `
        <div style="margin-right: auto; font-size: 11px; color: var(--pv-text-muted); display: flex; align-items: center; gap: 6px;">
          <span>• 默认包含中栏已选中词条，如不需要请点击清空</span>
          <span>• 导入方可自主归属分类与收藏夹</span>
        </div>
        <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-export-cancel">关闭</button>
        <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-share-copy-btn" style="display: none; border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;">
          ${getSafeIcon("check", 12)} <span>复制分享代码</span>
        </button>
        <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-share-generate-btn">
          ${getSafeIcon("share", 12)} <span>生成分享代码</span>
        </button>
      `;
    }
    return `
      <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-export-cancel">取消</button>
      <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-file-download-btn">
        ${getSafeIcon("upload", 12)} <span>下载完整库备份</span>
      </button>
    `;
  }

  bindEvents() {
    const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
    const cancelBtn = this.overlay.querySelector("#pv-export-cancel");
    const tabShare = this.overlay.querySelector("#pv-tab-share");
    const tabFile = this.overlay.querySelector("#pv-tab-file");

    const handleClose = () => this.close();
    if (closeBtn) closeBtn.addEventListener("click", handleClose);
    if (cancelBtn) cancelBtn.addEventListener("click", handleClose);
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) handleClose();
    });

    if (tabShare) {
      tabShare.addEventListener("click", () => {
        if (this.currentTab !== "share") {
          this.currentTab = "share";
          this.renderModal();
        }
      });
    }
    if (tabFile) {
      tabFile.addEventListener("click", () => {
        if (this.currentTab !== "file") {
          this.currentTab = "file";
          this.renderModal();
        }
      });
    }

    if (this.currentTab === "file") {
      const dlBtn = this.overlay.querySelector("#pv-file-download-btn");
      if (dlBtn) {
        dlBtn.addEventListener("click", () => {
          triggerExportLibrary();
          this.close();
        });
      }
      return;
    }

    const viewport = this.overlay.querySelector("#pv-share-viewport");
    if (viewport) isolateWheelScroll(viewport);

    const searchInput = this.overlay.querySelector("#pv-share-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this.searchKeyword = searchInput.value.trim();
        this.refreshItemsViewport();
      });
    }

    const catSelect = this.overlay.querySelector("#pv-share-cat-select");
    if (catSelect) {
      catSelect.addEventListener("change", () => {
        this.filterCategory = catSelect.value;
        this.refreshItemsViewport();
      });
    }

    const subModeEntries = this.overlay.querySelector("#pv-submode-entries");
    const subModeGroups = this.overlay.querySelector("#pv-submode-groups");
    if (subModeEntries) {
      subModeEntries.addEventListener("click", () => {
        this.viewSubMode = "entries";
        subModeEntries.classList.add("is-active");
        if (subModeGroups) subModeGroups.classList.remove("is-active");
        this.refreshItemsViewport();
      });
    }
    if (subModeGroups) {
      subModeGroups.addEventListener("click", () => {
        this.viewSubMode = "groups";
        subModeGroups.classList.add("is-active");
        if (subModeEntries) subModeEntries.classList.remove("is-active");
        this.refreshItemsViewport();
      });
    }

    const quickWorkspaceBtn = this.overlay.querySelector("#pv-share-quick-workspace");
    if (quickWorkspaceBtn) {
      quickWorkspaceBtn.addEventListener("click", () => {
        if (this.stateContext && Array.isArray(this.stateContext.selectedTiles)) {
          this.stateContext.selectedTiles.forEach((t) => {
            if (t.ref_preset_id) this.selectedEntryIds.add(t.ref_preset_id);
          });
        }
        this.refreshItemsViewport();
        this.updateCountText();
      });
    }

    const selectAllBtn = this.overlay.querySelector("#pv-share-select-all");
    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => {
        const lib = this.getLibrary() || {};
        (lib.entries || []).forEach((e) => this.selectedEntryIds.add(e.id));
        this.refreshItemsViewport();
        this.updateCountText();
      });
    }

    const clearAllBtn = this.overlay.querySelector("#pv-share-clear-all");
    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        this.selectedEntryIds.clear();
        this.refreshItemsViewport();
        this.updateCountText();
      });
    }

    this.bindViewportCheckboxEvents();

    const generateBtn = this.overlay.querySelector("#pv-share-generate-btn");
    const copyBtn = this.overlay.querySelector("#pv-share-copy-btn");
    const codeBox = this.overlay.querySelector("#pv-share-code-box");
    const codeOutput = this.overlay.querySelector("#pv-share-code-output");
    const codeStat = this.overlay.querySelector("#pv-share-code-stat");

    if (generateBtn) {
      generateBtn.addEventListener("click", async () => {
        if (this.selectedEntryIds.size === 0) {
          alert("请至少勾选一个需要分享的提示词条目！");
          return;
        }

        generateBtn.disabled = true;
        generateBtn.textContent = "正在紧凑压缩...";

        try {
          const sharePackage = this.buildCompactSharePackage();
          const shareCode = await encodeSharePayload(sharePackage);

          if (codeBox && codeOutput) {
            codeBox.style.display = "flex";
            codeOutput.value = shareCode;
            if (codeStat) {
              const compLen = shareCode.length;
              const isQqSafe = compLen <= 3500;
              codeStat.innerHTML = `长度: <strong>${compLen}</strong> 字符 · ${isQqSafe ? "<span style='color:#34d399;'>去分享吧喵~</span>" : "<span style='color:#f59e0b;'>建议分段发送</span>"}`;
            }
          }

          if (copyBtn) {
            copyBtn.style.display = "inline-flex";
          }

          await navigator.clipboard.writeText(shareCode);
          generateBtn.textContent = "已生成并复制！";
          setTimeout(() => {
            generateBtn.disabled = false;
            generateBtn.innerHTML = `${getSafeIcon("share", 12)} <span>重新生成</span>`;
          }, 2000);
        } catch (err) {
          alert(`生成分享代码失败: ${err.message}`);
          generateBtn.disabled = false;
          generateBtn.innerHTML = `${getSafeIcon("share", 12)} <span>生成分享代码</span>`;
        }
      });
    }

    if (copyBtn && codeOutput) {
      copyBtn.addEventListener("click", async () => {
        if (!codeOutput.value) return;
        await navigator.clipboard.writeText(codeOutput.value);
        const originalHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = `${getSafeIcon("check", 12)} <span>复制成功！</span>`;
        setTimeout(() => {
          copyBtn.innerHTML = originalHtml;
        }, 1500);
      });
    }
  }

  refreshItemsViewport() {
    const viewport = this.overlay.querySelector("#pv-share-viewport");
    if (!viewport) return;
    const lib = this.getLibrary() || {};
    viewport.innerHTML = this.renderShareItemsListHTML(lib.entries || [], lib.groups || [], lib.categories || []);
    this.bindViewportCheckboxEvents();
  }

  bindViewportCheckboxEvents() {
    const viewport = this.overlay.querySelector("#pv-share-viewport");
    if (!viewport) return;

    const lib = this.getLibrary() || {};
    const groupMap = new Map((lib.groups || []).map((g) => [g.id, g]));

    viewport.querySelectorAll(".pv-share-checkbox").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const target = /** @type {HTMLInputElement} */ (e.target);
        const eid = target.dataset.entryId;
        if (!eid) return;
        if (target.checked) {
          this.selectedEntryIds.add(eid);
        } else {
          this.selectedEntryIds.delete(eid);
        }
        const card = target.closest(".pv-share-card-item");
        if (card) card.classList.toggle("is-selected", target.checked);
        this.updateCountText();
      });
    });

    viewport.querySelectorAll(".pv-share-group-checkbox").forEach((cb) => {
      const groupCb = /** @type {HTMLInputElement} */ (cb);
      if (groupCb.dataset.indeterminate === "true") {
        groupCb.indeterminate = true;
      }
      groupCb.addEventListener("change", () => {
        const gid = groupCb.dataset.groupId;
        const group = groupMap.get(gid);
        if (!group) return;
        const memberIds = Array.isArray(group.entryIds) ? group.entryIds : [];
        if (groupCb.checked) {
          memberIds.forEach((id) => this.selectedEntryIds.add(id));
        } else {
          memberIds.forEach((id) => this.selectedEntryIds.delete(id));
        }
        this.refreshItemsViewport();
        this.updateCountText();
      });
    });
  }

  updateCountText() {
    const countText = this.overlay.querySelector("#pv-share-count-text");
    if (countText) {
      countText.textContent = String(this.selectedEntryIds.size);
    }
  }

  /**
   * V2 超紧凑协议打包器：
   * 1. 彻底剔除所有 36 位长 UUID，组关联改用精简的整数数组下标 [0, 1, 2]；
   * 2. 彻底剔除无效的 previewHash (接收端不存在此文件) 与本地时间戳 updatedAt；
   * 3. 采用紧凑列式元组存储，消除重复键名，体积缩减 75% 以上。
   */
  buildCompactSharePackage() {
    const lib = this.getLibrary() || {};
    const allEntries = lib.entries || [];
    const allGroups = lib.groups || [];
    const allCategories = lib.categories || [];
    const allTags = lib.tags || [];

    const tagIdToNameMap = new Map(allTags.map((t) => [t.id, t.name]));

    // 1. 提取所选词条
    const sharedRawEntries = allEntries.filter((e) => this.selectedEntryIds.has(e.id));

    // 建立原始 entryId 到有序数组索引的映射
    const entryIdToIndexMap = new Map();
    sharedRawEntries.forEach((e, idx) => {
      entryIdToIndexMap.set(e.id, idx);
    });

    // 2. 收集涉及的分类（建立分类名和颜色字典）
    const categoryDict = []; // [name, color]
    const catIdToDictIdxMap = new Map();

    const getCategoryDictIndex = (catId) => {
      if (!catId) return -1;
      if (catIdToDictIdxMap.has(catId)) return catIdToDictIdxMap.get(catId);
      const cat = allCategories.find((c) => c.id === catId);
      if (!cat) return -1;
      const idx = categoryDict.length;
      categoryDict.push([cat.name, cat.color || "#3b82f6"]);
      catIdToDictIdxMap.set(catId, idx);
      return idx;
    };

    // 3. 构造极简 entries 元组：[title, text, catIdx, [tagNames], [colNames], isGroupOnly]
    const compactEntries = sharedRawEntries.map((e) => {
      const catIdx = getCategoryDictIndex(e.categoryId);
      const tagNames = (e.tagIds || []).map((tid) => tagIdToNameMap.get(tid)).filter(Boolean);
      const colNames = Array.isArray(e.collections) ? e.collections : [];
      const isGroupOnly = e.groupOnly ? 1 : 0;
      return [
        e.title || "",
        e.text || e.prompt || "",
        catIdx,
        tagNames,
        colNames,
        isGroupOnly
      ];
    });

    // 4. 构造极简 groups 元组：[title, [memberIndices], catIdx, note]
    const compactGroups = [];
    allGroups.forEach((g) => {
      const eids = Array.isArray(g.entryIds) ? g.entryIds : [];
      // 将组内属于分享集的词条映射为紧凑的整数下标
      const memberIndices = eids
        .filter((eid) => entryIdToIndexMap.has(eid))
        .map((eid) => entryIdToIndexMap.get(eid));

      if (memberIndices.length > 0) {
        const catIdx = getCategoryDictIndex(g.categoryId);
        compactGroups.push([
          g.title || "",
          memberIndices,
          catIdx,
          g.note || ""
        ]);
      }
    });

    return {
      v: 2, // V2 极简协议标识
      c: categoryDict,    // 分类元组字典 [[name, color], ...]
      e: compactEntries,  // 紧凑词条元组列表
      g: compactGroups    // 紧凑提示词组列表
    };
  }

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  close() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
  }
}