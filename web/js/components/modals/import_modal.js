/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/import_modal.js */

/**
 * 导入中心（ImportModalManager）。
 * 支持：
 * 1. 批量分享代码一键导入：兼容 V3（含 nl 字段）/ V2 极简超紧凑格式与 V1 全量格式、分类与收藏夹自主决策、完整还原标签与提示词组拓扑；
 * 2. 本地备份 JSON 文件导入：五维冲突预检（含 title/text/nl 比对，其中 nl 保留首尾空白差异）与差异合并。
 */

import { importLibrary } from "../../api.js";
import { isolateCanvasEvents, isolateWheelScroll } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";
import { decodeSharePayload } from "../../utils/share_codec.js";

function resolveUniqueTitle(rawTitle, existingTitlesSet) {
  const trimmed = (rawTitle || "").trim() || "未命名条目";
  if (!existingTitlesSet.has(trimmed)) {
    existingTitlesSet.add(trimmed);
    return trimmed;
  }

  const baseMatch = trimmed.match(/^(.*?)(?:\s*\((\d+)\))?$/);
  const baseName = (baseMatch && baseMatch[1] ? baseMatch[1].trim() : trimmed) || "未命名条目";

  let count = 1;
  let candidate = `${baseName} (${count})`;
  while (existingTitlesSet.has(candidate)) {
    count += 1;
    candidate = `${baseName} (${count})`;
  }

  existingTitlesSet.add(candidate);
  return candidate;
}

export class ImportModalManager {
  /**
   * @param {() => any} getLibraryCallback
   * @param {() => Promise<void>} onUpdatedCallback
   */
  constructor(getLibraryCallback, onUpdatedCallback) {
    this.getLibrary = getLibraryCallback;
    this.onUpdated = onUpdatedCallback;
    this.overlay = null;

    this.currentTab = "code";
    this.parsedShareData = null;

    this.catStrategy = "keep_source";
    this.targetCatId = "";

    this.colStrategy = "keep_source";
    this.targetColName = "";

    this.fileImportContext = null;
  }

  open(importedData = null, fileName = "manifest.json", fileSize = 0) {
    this.close();
    this.parsedShareData = null;
    this.catStrategy = "keep_source";
    this.colStrategy = "keep_source";

    if (importedData) {
      this.currentTab = "file";
      this.fileImportContext = { importedData, fileName, fileSize };
    } else {
      this.currentTab = "code";
      this.fileImportContext = null;
    }

    this.overlay = document.createElement("div");
    this.overlay.className = "prompt-vault-modal-overlay";
    isolateCanvasEvents(this.overlay);

    this.renderModal();
    document.body.appendChild(this.overlay);
  }

  renderModal() {
    const localLib = this.getLibrary() || {};
    const localCategories = localLib.categories || [];
    const localCollections = localLib.collections || [];

    this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-large" style="max-width: 760px; min-height: 560px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">导入词库</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>

        <div class="pv-modal-tabs">
          <button type="button" class="pv-modal-tab-btn ${this.currentTab === "code" ? "is-active" : ""}" id="pv-tab-import-code">
            ${renderIcon("share", 13)} <span>粘贴分享代码导入</span>
          </button>
          <button type="button" class="pv-modal-tab-btn ${this.currentTab === "file" ? "is-active" : ""}" id="pv-tab-import-file">
            ${renderIcon("download", 13)} <span>本地备份文件导入</span>
          </button>
        </div>

        <div class="prompt-vault-modal-body" style="padding-top: 14px;" id="pv-import-modal-body">
          ${this.currentTab === "code" ? this.renderCodeTabHTML(localCategories, localCollections) : this.renderFileTabHTML()}
        </div>

        <div class="prompt-vault-modal-footer" id="pv-import-modal-footer">
          ${this.renderFooterHTML()}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderCodeTabHTML(localCategories, localCollections) {
    return `
      <div class="pv-import-code-container">
        <!-- 粘贴输入区 -->
        <div class="pv-import-input-section">
          <div class="pv-import-input-label">
            <span>请粘贴批量分享代码 (以 <code>SUSKI-SHARE-v1:</code> 开头)：</span>
            <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-btn-paste-clipboard" style="padding: 3px 10px; font-size: 11px;">
              ${renderIcon("edit", 11)} <span>从剪贴板读取</span>
            </button>
          </div>
          <textarea class="pv-import-code-textarea" id="pv-import-code-input" placeholder="在此粘贴收到的分享代码..."></textarea>
          <div id="pv-import-parse-status" class="pv-import-status-text"></div>
        </div>

        <!-- 解析结果与策略决策区 (解析成功后显示) -->
        <div id="pv-import-details-area" style="display: ${this.parsedShareData ? "block" : "none"};">
          ${this.renderParsedDetailsHTML(localCategories, localCollections)}
        </div>
      </div>
    `;
  }

  renderParsedDetailsHTML(localCategories, localCollections) {
    if (!this.parsedShareData) return "";

    const entries = this.parsedShareData.entries || [];
    const groups = this.parsedShareData.groups || [];
    const tags = this.parsedShareData.tags || [];
    const srcCategories = this.parsedShareData.categories || [];
    const srcCollections = this.parsedShareData.collections || [];

    return `
      <!-- 包内微型仪表盘 (Metric Grid) -->
      <div class="pv-import-preview-card">
        <div class="pv-import-preview-header">
          <span style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); color: #10b981;">
            ${renderIcon("check", 13)}
          </span>
          <span style="font-weight: 700; color: #f3f4f6; font-size: 13px;">分享代码校验通过</span>
          <span style="margin-left: auto; font-size: 11px; color: var(--pv-text-muted);">离线解码校验完成</span>
        </div>
        <div class="pv-metric-grid">
          <div class="pv-metric-card">
            <span class="pv-metric-num" style="color: #60a5fa;">${entries.length}</span>
            <span class="pv-metric-label">词条总数</span>
          </div>
          <div class="pv-metric-card">
            <span class="pv-metric-num" style="color: #c084fc;">${groups.length}</span>
            <span class="pv-metric-label">提示词组</span>
          </div>
          <div class="pv-metric-card">
            <span class="pv-metric-num" style="color: #34d399;">${tags.length}</span>
            <span class="pv-metric-label">包含标签</span>
          </div>
          <div class="pv-metric-card">
            <span class="pv-metric-num" style="color: #fbbf24;">${srcCategories.length}</span>
            <span class="pv-metric-label">来源分类</span>
          </div>
          <div class="pv-metric-card">
            <span class="pv-metric-num" style="color: #f472b6;">${srcCollections.length}</span>
            <span class="pv-metric-label">来源收藏夹</span>
          </div>
        </div>
      </div>

      <!-- 决策卡片网格 (Radio Cards) -->
      <div class="pv-import-decision-grid" style="margin-top: 12px;">
        <!-- 分类归属决策 -->
        <div class="pv-import-decision-box">
          <div class="pv-import-decision-title">
            ${renderIcon("folder", 13)} <span>分类归属策略</span>
          </div>
          <div class="pv-import-radio-group">
            <label class="pv-radio-card ${this.catStrategy === "keep_source" ? "is-active" : ""}">
              <input type="radio" name="cat_policy" value="keep_source" ${this.catStrategy === "keep_source" ? "checked" : ""}>
              <span>保留来源分类 (本地缺失自动新建)</span>
            </label>
            <label class="pv-radio-card ${this.catStrategy === "target" ? "is-active" : ""}">
              <input type="radio" name="cat_policy" value="target" ${this.catStrategy === "target" ? "checked" : ""}>
              <span>统一归入本地指定分类</span>
            </label>
            <div class="pv-sub-select-wrap" id="pv-cat-select-wrap" style="display: ${this.catStrategy === "target" ? "block" : "none"};">
              <select class="prompt-vault-form-select" id="pv-select-target-cat">
                <option value="">-- 请选择目标分类 --</option>
                ${localCategories.map((c) => `<option value="${c.id}" ${this.targetCatId === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
              </select>
            </div>
            <label class="pv-radio-card ${this.catStrategy === "none" ? "is-active" : ""}">
              <input type="radio" name="cat_policy" value="none" ${this.catStrategy === "none" ? "checked" : ""}>
              <span>不设分类 (放入未分类)</span>
            </label>
          </div>
        </div>

        <!-- 收藏夹归属决策 -->
        <div class="pv-import-decision-box">
          <div class="pv-import-decision-title">
            ${renderIcon("clock", 13)} <span>收藏夹归属策略</span>
          </div>
          <div class="pv-import-radio-group">
            <label class="pv-radio-card ${this.colStrategy === "keep_source" ? "is-active" : ""}">
              <input type="radio" name="col_policy" value="keep_source" ${this.colStrategy === "keep_source" ? "checked" : ""}>
              <span>保留来源收藏夹 (自动关联/新建)</span>
            </label>
            <label class="pv-radio-card ${this.colStrategy === "target" ? "is-active" : ""}">
              <input type="radio" name="col_policy" value="target" ${this.colStrategy === "target" ? "checked" : ""}>
              <span>统一放入本地指定收藏夹</span>
            </label>
            <div class="pv-sub-select-wrap" id="pv-col-select-wrap" style="display: ${this.colStrategy === "target" ? "block" : "none"};">
              <select class="prompt-vault-form-select" id="pv-select-target-col">
                <option value="">-- 请选择目标收藏夹 --</option>
                ${localCollections.map((c) => `<option value="${c.name}" ${this.targetColName === c.name ? "selected" : ""}>${c.name}</option>`).join("")}
              </select>
            </div>
            <label class="pv-radio-card ${this.colStrategy === "none" ? "is-active" : ""}">
              <input type="radio" name="col_policy" value="none" ${this.colStrategy === "none" ? "checked" : ""}>
              <span>不加入收藏夹</span>
            </label>
          </div>
        </div>
      </div>

      <!-- 待入库条目即时预览列表 -->
      <div class="pv-import-preview-list-box" style="margin-top: 12px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--pv-text-secondary); display: flex; align-items: center; justify-content: space-between;">
          <span>待入库词条预览 (${entries.length})</span>
          <span style="font-size: 10px; color: var(--pv-text-muted);">重名条目自动编号保护，不冲掉本地内容</span>
        </div>
        <div class="pv-import-preview-list" id="pv-import-items-viewport">
          ${entries.map((e) => `
            <div class="pv-import-item-tile">
              <span class="pv-import-item-title">${this.escapeHtml(e.title || "未命名")}</span>
              <span class="pv-import-item-text">${this.escapeHtml((e.text || e.prompt || e.nl || "").replace(/[\r\n]+/g, " "))}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  renderFileTabHTML() {
    if (!this.fileImportContext) {
      return `
        <div class="prompt-vault-empty-state" style="padding: 40px 20px;">
          <div class="prompt-vault-empty-icon">${renderIcon("download", 32)}</div>
          <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">请选择本地词库 JSON 文件</div>
          <div style="font-size: 12px; opacity: 0.7; margin-bottom: 16px;">支持由本插件导出的单文件备份包</div>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-select-file-trigger">
            ${renderIcon("folder", 13)} <span>选择文件...</span>
          </button>
        </div>
      `;
    }

    const { importedData, fileName, fileSize } = this.fileImportContext;
    const localLib = this.getLibrary() || {};
    const localEntries = localLib.entries || [];
    const rawEntries = Array.isArray(importedData) ? importedData : (importedData?.entries || []);

    const normalizeNl = (val) => String(val || "").replace(/\r\n/g, "\n");
    const localIdMap = new Map(localEntries.map((e) => [e.id, e]));
    const localContentSet = new Set(
      localEntries.map(
        (e) => `${(e.title || "").trim()}:::${(e.text || e.prompt || "").trim()}:::${normalizeNl(e.nl)}`
      )
    );

    this.fileConflictEntries = [];
    this.fileNewEntries = [];
    this.fileExistingEntries = [];
    this.fileDuplicateEntries = [];
    this.fileInvalidEntries = [];
    const seenImportIds = new Set();

    rawEntries.forEach((item) => {
      const itemTitle = (item.title || "").trim();
      const itemText = (item.text || item.prompt || "").trim();
      const itemNlRaw = normalizeNl(item.nl);

      if (!itemTitle && !itemText && !itemNlRaw.trim()) {
        this.fileInvalidEntries.push({ item, reason: "缺少标题与提示词内容" });
        return;
      }

      if (item.id && seenImportIds.has(item.id)) {
        this.fileDuplicateEntries.push({ item, reason: "导入包中存在重复 ID" });
        return;
      }
      if (item.id) seenImportIds.add(item.id);

      const localExact = item.id ? localIdMap.get(item.id) : null;
      if (localExact) {
        const localText = (localExact.text || localExact.prompt || "").trim();
        const localTitle = (localExact.title || "").trim();
        const localNlRaw = normalizeNl(localExact.nl);
        if (localText === itemText && localTitle === itemTitle && localNlRaw === itemNlRaw) {
          this.fileExistingEntries.push(item);
        } else {
          this.fileConflictEntries.push({
            item,
            local: localExact,
            reason: "相同词条 ID 的内容已发生变化",
            strategy: "keep_local",
          });
        }
      } else {
        const contentKey = `${itemTitle}:::${itemText}:::${itemNlRaw}`;
        if (localContentSet.has(contentKey)) {
          this.fileConflictEntries.push({
            item,
            local: null,
            reason: "本地已存在相同标题与提示词内容",
            strategy: "keep_local",
          });
        } else {
          this.fileNewEntries.push(item);
        }
      }
    });

    const hasConflicts = this.fileConflictEntries.length > 0;
    const sizeKbText = fileSize ? `${(fileSize / 1024).toFixed(1)} KB` : "标准包";

    return `
      <div class="pv-import-banner ${!hasConflicts ? "is-ok" : ""}">
        <div class="pv-import-banner-left">
          <span class="pv-import-banner-icon">${renderIcon(hasConflicts ? "clock" : "check", 22)}</span>
          <div>
            <div class="pv-import-banner-title">
              ${hasConflicts ? "这个备份需要处理冲突" : "备份准备就绪"}
            </div>
            <div class="pv-import-banner-desc">
              ${hasConflicts ? "源备份存在冲突词条，请选择解决策略后合并入库。" : "词库结构校验通过，可安全合并入库。"}
            </div>
          </div>
        </div>
        <div class="pv-import-banner-right">
          <div style="font-weight: 600; color: #f3f4f6;">${fileName}</div>
          <div>${sizeKbText} · 标准备份</div>
        </div>
      </div>

      <div class="pv-import-stats-grid">
        <div class="pv-import-stat-card"><span class="pv-import-stat-num pv-stat-new">${this.fileNewEntries.length}</span><span class="pv-import-stat-label">新增</span></div>
        <div class="pv-import-stat-card"><span class="pv-import-stat-num pv-stat-exist">${this.fileExistingEntries.length}</span><span class="pv-import-stat-label">已有</span></div>
        <div class="pv-import-stat-card"><span class="pv-import-stat-num pv-stat-conflict">${this.fileConflictEntries.length}</span><span class="pv-import-stat-label">冲突</span></div>
        <div class="pv-import-stat-card"><span class="pv-import-stat-num pv-stat-dup">${this.fileDuplicateEntries.length}</span><span class="pv-import-stat-label">重复</span></div>
        <div class="pv-import-stat-card"><span class="pv-import-stat-num pv-stat-invalid">${this.fileInvalidEntries.length}</span><span class="pv-import-stat-label">无效</span></div>
      </div>
    `;
  }

  renderFooterHTML() {
    if (this.currentTab === "code") {
      return `
        <div style="margin-right: auto; font-size: 11px; color: var(--pv-text-muted);">
          标签与提示词组将自动合并恢复，同名条目将自动安全编号保护
        </div>
        <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-import-cancel">取消</button>
        <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-import-code-submit" ${!this.parsedShareData ? "disabled" : ""}>
          ${renderIcon("download", 12)} <span>确认入库</span>
        </button>
      `;
    }
    return `
      <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-import-cancel">取消</button>
      <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-import-file-submit" ${!this.fileImportContext ? "disabled" : ""}>
        ${renderIcon("download", 12)} <span>执行导入</span>
      </button>
    `;
  }

  bindEvents() {
    const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
    const cancelBtn = this.overlay.querySelector("#pv-import-cancel");
    const tabCode = this.overlay.querySelector("#pv-tab-import-code");
    const tabFile = this.overlay.querySelector("#pv-tab-import-file");

    const handleClose = () => this.close();
    if (closeBtn) closeBtn.addEventListener("click", handleClose);
    if (cancelBtn) cancelBtn.addEventListener("click", handleClose);
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) handleClose();
    });

    if (tabCode) {
      tabCode.addEventListener("click", () => {
        if (this.currentTab !== "code") {
          this.currentTab = "code";
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

    if (this.currentTab === "code") {
      this.bindCodeTabEvents();
    } else {
      this.bindFileTabEvents();
    }
  }

  /**
   * 将解密出来的原始载荷规范化为标准模型：
   * 兼容 V3（含 nl）/ V2 极简超紧凑格式与 V1 全量格式。
   */
  normalizeSharePackage(raw) {
    if (!raw) return null;

    // V3 / V2 极简超紧凑协议格式
    if (raw.v === 3 || raw.v === 2 || (Array.isArray(raw.e) && Array.isArray(raw.c))) {
      const catDict = Array.isArray(raw.c) ? raw.c : []; // [[name, color], ...]
      const compactEntries = Array.isArray(raw.e) ? raw.e : [];
      const compactGroups = Array.isArray(raw.g) ? raw.g : [];

      const srcCategories = catDict.map((item, idx) => ({
        id: `v2_cat_${idx}`,
        name: item[0] || "未命名分类",
        color: item[1] || "#3b82f6",
      }));

      const allTagsSet = new Set();
      const allColsSet = new Set();

      const normalizedEntries = compactEntries.map((row, idx) => {
        const title = row[0] || "";
        const text = row[1] || "";
        const catIdx = typeof row[2] === "number" ? row[2] : -1;
        const tagNames = Array.isArray(row[3]) ? row[3] : [];
        const colNames = Array.isArray(row[4]) ? row[4] : [];
        const isGroupOnly = Boolean(row[5]);
        const nl = typeof row[6] === "string" ? row[6] : "";

        tagNames.forEach((t) => allTagsSet.add(t));
        colNames.forEach((c) => allColsSet.add(c));

        return {
          id: `v2_entry_${idx}`,
          index: idx,
          title,
          text,
          nl,
          categoryId: catIdx >= 0 && srcCategories[catIdx] ? srcCategories[catIdx].id : null,
          categoryName: catIdx >= 0 && srcCategories[catIdx] ? srcCategories[catIdx].name : "",
          tagNames,
          collections: colNames,
          groupOnly: isGroupOnly,
        };
      });

      const normalizedGroups = compactGroups.map((row, gIdx) => {
        const title = row[0] || "";
        const memberIndices = Array.isArray(row[1]) ? row[1] : [];
        const catIdx = typeof row[2] === "number" ? row[2] : -1;
        const note = row[3] || "";

        // 将整数下标映射为对应词条的 ID
        const entryIds = memberIndices
          .map((idx) => normalizedEntries[idx]?.id)
          .filter(Boolean);

        return {
          id: `v2_group_${gIdx}`,
          title,
          entryIds,
          categoryId: catIdx >= 0 && srcCategories[catIdx] ? srcCategories[catIdx].id : null,
          note,
        };
      });

      return {
        entries: normalizedEntries,
        groups: normalizedGroups,
        categories: srcCategories,
        tags: Array.from(allTagsSet).map((tname, tidx) => ({ id: `v2_tag_${tidx}`, name: tname })),
        collections: Array.from(allColsSet).map((cname, cidx) => ({ id: `v2_col_${cidx}`, name: cname })),
      };
    }

    // V1 向下兼容全量格式
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    const groups = Array.isArray(raw.groups) ? raw.groups : [];
    const categories = Array.isArray(raw.categories) ? raw.categories : [];
    const collections = Array.isArray(raw.collections) ? raw.collections : [];
    const tags = Array.isArray(raw.tags) ? raw.tags : [];

    const tagMap = new Map(tags.map((t) => [t.id, t.name]));

    const normalizedEntries = entries.map((e, idx) => ({
      ...e,
      id: e.id || `v1_entry_${idx}`,
      index: idx,
      nl: e.nl || "",
      tagNames: (e.tagIds || []).map((tid) => tagMap.get(tid)).filter(Boolean),
    }));

    return {
      entries: normalizedEntries,
      groups,
      categories,
      collections,
      tags,
    };
  }

  bindCodeTabEvents() {
    const inputArea = this.overlay.querySelector("#pv-import-code-input");
    const pasteBtn = this.overlay.querySelector("#pv-btn-paste-clipboard");
    const submitBtn = this.overlay.querySelector("#pv-import-code-submit");
    const statusEl = this.overlay.querySelector("#pv-import-parse-status");
    const detailsArea = this.overlay.querySelector("#pv-import-details-area");

    const tryParseCode = async (rawCode) => {
      if (!rawCode || !rawCode.trim()) {
        this.parsedShareData = null;
        if (statusEl) statusEl.textContent = "";
        if (detailsArea) detailsArea.style.display = "none";
        if (submitBtn) submitBtn.disabled = true;
        return;
      }

      try {
        if (statusEl) {
          statusEl.innerHTML = `<span style="color: var(--pv-text-muted);">正在解压并校验分享数据...</span>`;
        }
        const rawData = await decodeSharePayload(rawCode);
        const normalized = this.normalizeSharePackage(rawData);

        if (!normalized || !Array.isArray(normalized.entries) || normalized.entries.length === 0) {
          throw new Error("分享代码格式不符合规范或未包含有效词条");
        }

        this.parsedShareData = normalized;

        if (statusEl) {
          statusEl.innerHTML = `<span style="color: #10b981; font-weight: 600;">✓ 分享代码解码成功！请在下方确认分类与收藏夹策略后入库。</span>`;
        }

        const localLib = this.getLibrary() || {};
        if (detailsArea) {
          detailsArea.innerHTML = this.renderParsedDetailsHTML(localLib.categories || [], localLib.collections || []);
          detailsArea.style.display = "block";
          const viewport = detailsArea.querySelector("#pv-import-items-viewport");
          if (viewport) isolateWheelScroll(viewport);
          this.bindDecisionEvents();
        }
        if (submitBtn) submitBtn.disabled = false;
      } catch (err) {
        this.parsedShareData = null;
        if (statusEl) {
          statusEl.innerHTML = `<span style="color: #ef4444; font-weight: 500;">✗ 解析失败: ${err.message}</span>`;
        }
        if (detailsArea) detailsArea.style.display = "none";
        if (submitBtn) submitBtn.disabled = true;
      }
    };

    if (inputArea) {
      inputArea.addEventListener("input", () => tryParseCode(inputArea.value));
    }

    if (pasteBtn && inputArea) {
      pasteBtn.addEventListener("click", async () => {
        try {
          const text = await navigator.clipboard.readText();
          inputArea.value = text;
          tryParseCode(text);
        } catch (err) {
          alert("无法直接读取剪贴板，请在输入框内手动按 Ctrl+V 粘贴。");
        }
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener("click", () => this.executeShareCodeImport(submitBtn));
    }
  }

  bindDecisionEvents() {
    const detailsArea = this.overlay.querySelector("#pv-import-details-area");
    if (!detailsArea) return;

    const targetCatSelect = detailsArea.querySelector("#pv-select-target-cat");
    const targetColSelect = detailsArea.querySelector("#pv-select-target-col");
    const catSelectWrap = detailsArea.querySelector("#pv-cat-select-wrap");
    const colSelectWrap = detailsArea.querySelector("#pv-col-select-wrap");

    detailsArea.querySelectorAll("input[name='cat_policy']").forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.catStrategy = e.target.value;
        if (catSelectWrap) {
          catSelectWrap.style.display = this.catStrategy === "target" ? "block" : "none";
        }
        detailsArea.querySelectorAll("input[name='cat_policy']").forEach((r) => {
          r.closest(".pv-radio-card")?.classList.toggle("is-active", r.checked);
        });
      });
    });

    detailsArea.querySelectorAll("input[name='col_policy']").forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.colStrategy = e.target.value;
        if (colSelectWrap) {
          colSelectWrap.style.display = this.colStrategy === "target" ? "block" : "none";
        }
        detailsArea.querySelectorAll("input[name='col_policy']").forEach((r) => {
          r.closest(".pv-radio-card")?.classList.toggle("is-active", r.checked);
        });
      });
    });

    if (targetCatSelect) {
      targetCatSelect.addEventListener("change", () => {
        this.targetCatId = targetCatSelect.value;
      });
    }

    if (targetColSelect) {
      targetColSelect.addEventListener("change", () => {
        this.targetColName = targetColSelect.value;
      });
    }
  }

  async executeShareCodeImport(submitBtn) {
    if (!this.parsedShareData) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "正在入库...";

    try {
      const localLib = this.getLibrary() || {};
      const localCategories = [...(localLib.categories || [])];
      const localCollections = [...(localLib.collections || [])];
      const localTags = [...(localLib.tags || [])];
      const localEntries = [...(localLib.entries || [])];
      const localGroups = [...(localLib.groups || [])];

      const srcEntries = this.parsedShareData.entries || [];
      const srcGroups = this.parsedShareData.groups || [];
      const srcCategories = this.parsedShareData.categories || [];
      const srcCollections = this.parsedShareData.collections || [];

      // 1. 处理分类
      const catIdMap = new Map();
      if (this.catStrategy === "keep_source") {
        const localCatMap = new Map(localCategories.map((c) => [c.name, c]));
        srcCategories.forEach((sc) => {
          if (localCatMap.has(sc.name)) {
            catIdMap.set(sc.id, localCatMap.get(sc.name).id);
          } else {
            const newCatId = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const newCat = {
              id: newCatId,
              name: sc.name,
              color: sc.color || "#3b82f6",
              parentId: null,
              position: localCategories.length,
            };
            localCategories.push(newCat);
            localCatMap.set(newCat.name, newCat);
            catIdMap.set(sc.id, newCatId);
          }
        });
      }

      // 2. 处理收藏夹
      const colNameMap = new Map();
      if (this.colStrategy === "keep_source") {
        const localColNames = new Set(localCollections.map((c) => c.name));
        srcCollections.forEach((sc) => {
          if (!localColNames.has(sc.name)) {
            localCollections.push({
              id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: sc.name,
            });
            localColNames.add(sc.name);
          }
          colNameMap.set(sc.name, sc.name);
        });
      }

      // 3. 处理标签合并 (以名称对齐)
      const tagMapByName = new Map(localTags.map((t) => [t.name, t.id]));
      const getOrCreateTagId = (tagName) => {
        const clean = String(tagName).trim();
        if (!clean) return null;
        if (tagMapByName.has(clean)) return tagMapByName.get(clean);
        const newTid = `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        localTags.push({ id: newTid, name: clean });
        tagMapByName.set(clean, newTid);
        return newTid;
      };

      // 4. 处理词条入库 (防重名编号、分类与收藏夹映射、重新映射 tagIds)
      const existingEntryTitles = new Set(localEntries.map((e) => (e.title || "").trim()));
      const srcEntryIdToNewId = new Map();

      srcEntries.forEach((se) => {
        const cleanTitle = resolveUniqueTitle(se.title, existingEntryTitles);
        const newEntryId = `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        srcEntryIdToNewId.set(se.id, newEntryId);

        let finalCatId = null;
        if (this.catStrategy === "keep_source") {
          finalCatId = se.categoryId ? catIdMap.get(se.categoryId) || null : null;
        } else if (this.catStrategy === "target") {
          finalCatId = this.targetCatId || null;
        }

        let finalCollections = [];
        if (this.colStrategy === "keep_source") {
          finalCollections = (se.collections || []).map((cn) => colNameMap.get(cn) || cn).filter(Boolean);
        } else if (this.colStrategy === "target" && this.targetColName) {
          finalCollections = [this.targetColName];
        }

        const finalTagIds = (se.tagNames || []).map(getOrCreateTagId).filter(Boolean);

        const newEntry = {
          id: newEntryId,
          title: cleanTitle,
          text: se.text || se.prompt || "",
          nl: se.nl || "",
          note: se.note || "",
          categoryId: finalCatId,
          collections: finalCollections,
          tagIds: finalTagIds,
          groupOnly: Boolean(se.groupOnly),
          position: localEntries.length,
          updatedAt: new Date().toLocaleString(),
        };
        localEntries.push(newEntry);
      });

      // 5. 处理提示词组完整重建入库 (精确映射条目拓扑关系)
      const existingGroupTitles = new Set(localGroups.map((g) => (g.title || "").trim()));
      srcGroups.forEach((sg) => {
        const cleanGroupTitle = resolveUniqueTitle(sg.title, existingGroupTitles);
        const mappedEntryIds = (sg.entryIds || [])
          .map((eid) => srcEntryIdToNewId.get(eid))
          .filter(Boolean);

        let finalGroupCatId = null;
        if (this.catStrategy === "keep_source") {
          finalGroupCatId = sg.categoryId ? catIdMap.get(sg.categoryId) || null : null;
        } else if (this.catStrategy === "target") {
          finalGroupCatId = this.targetCatId || null;
        }

        localGroups.push({
          id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: cleanGroupTitle,
          categoryId: finalGroupCatId,
          entryIds: mappedEntryIds,
          note: sg.note || "",
          position: localGroups.length,
          updatedAt: new Date().toLocaleString(),
        });
      });

      // 6. 统一组装成标准包并存盘
      const finalLibrary = {
        format: "suski-prompt-library",
        version: 1,
        categories: localCategories,
        collections: localCollections,
        tags: localTags,
        entries: localEntries,
        groups: localGroups,
        selection: localLib.selection || { entryIds: [] },
      };

      const virtualFile = new File(
        [new Blob([JSON.stringify(finalLibrary, null, 2)], { type: "application/json" })],
        "share_import.json",
        { type: "application/json" }
      );

      const res = await importLibrary(virtualFile, "overwrite");
      if (res && res.success) {
        if (typeof this.onUpdated === "function") await this.onUpdated();
        this.close();
      } else {
        throw new Error(res?.error || "服务未响应");
      }
    } catch (err) {
      alert(`入库失败: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.textContent = "确认入库";
    }
  }

  bindFileTabEvents() {
    const fileTrigger = this.overlay.querySelector("#pv-select-file-trigger");
    const submitBtn = this.overlay.querySelector("#pv-import-file-submit");

    if (fileTrigger) {
      fileTrigger.addEventListener("click", () => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json";
        fileInput.addEventListener("change", (e) => {
          const target = /** @type {HTMLInputElement} */ (e.target);
          const file = target.files && target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
              try {
                const text = String(event.target?.result || "").replace(/^\ufeff/, "");
                const parsed = JSON.parse(text);
                this.open(parsed, file.name, file.size);
              } catch (err) {
                alert(`读取 JSON 文件失败: ${String(err)}`);
              }
            };
            reader.readAsText(file);
          }
        });
        fileInput.click();
      });
    }

    if (submitBtn && this.fileImportContext) {
      submitBtn.addEventListener("click", async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = "导入中...";

        const localLib = this.getLibrary() || {};
        const localCategories = localLib.categories || [];
        const localCollections = localLib.collections || [];
        const localGroups = localLib.groups || [];
        const { importedData, fileName } = this.fileImportContext;

        const rawCategories = Array.isArray(importedData?.categories) ? importedData.categories : [];
        const rawCollections = Array.isArray(importedData?.collections) ? importedData.collections : [];
        const rawTags = Array.isArray(importedData?.tags) ? importedData.tags : [];
        const rawGroups = Array.isArray(importedData?.groups) ? importedData.groups : [];

        const mergedCategories = [...localCategories];
        const localCatIds = new Set(localCategories.map((c) => c.id));
        rawCategories.forEach((rc) => {
          if (rc && rc.id && !localCatIds.has(rc.id)) mergedCategories.push(rc);
        });

        const mergedCollections = [...localCollections];
        const localColNames = new Set(localCollections.map((c) => c.name));
        rawCollections.forEach((rcol) => {
          if (rcol && rcol.name && !localColNames.has(rcol.name)) mergedCollections.push(rcol);
        });

        const mergedTags = [...(localLib.tags || [])];
        const localTagNames = new Set(mergedTags.map((t) => t.name));
        rawTags.forEach((rt) => {
          if (rt && rt.name && !localTagNames.has(rt.name)) mergedTags.push(rt);
        });

        const finalEntries = [];
        const usedEntryTitles = new Set();
        const overwriteMap = new Map();

        (this.fileConflictEntries || []).forEach((c) => {
          if (c.strategy === "overwrite" && c.item?.id) {
            overwriteMap.set(c.item.id, c.item);
          }
        });

        (localLib.entries || []).forEach((localEntry) => {
          if (!overwriteMap.has(localEntry.id)) {
            const cleanTitle = (localEntry.title || "").trim() || "未命名词条";
            usedEntryTitles.add(cleanTitle);
            finalEntries.push({ ...localEntry, title: cleanTitle });
          }
        });

        overwriteMap.forEach((item) => {
          const uniqueTitle = resolveUniqueTitle(item.title, usedEntryTitles);
          finalEntries.push({ ...item, title: uniqueTitle });
        });

        (this.fileNewEntries || []).forEach((ne) => {
          const uniqueTitle = resolveUniqueTitle(ne.title, usedEntryTitles);
          finalEntries.push({ ...ne, title: uniqueTitle });
        });

        const mergedGroups = [];
        const usedGroupTitles = new Set();
        const localGroupIds = new Set(localGroups.map((g) => g.id));

        localGroups.forEach((lg) => {
          const cleanGroupTitle = (lg.title || "").trim() || "未命名组合";
          usedGroupTitles.add(cleanGroupTitle);
          mergedGroups.push({ ...lg, title: cleanGroupTitle });
        });

        rawGroups.forEach((rg) => {
          if (rg && rg.id && !localGroupIds.has(rg.id)) {
            const uniqueGroupTitle = resolveUniqueTitle(rg.title, usedGroupTitles);
            mergedGroups.push({ ...rg, title: uniqueGroupTitle });
          }
        });

        const resolvedLibrary = {
          format: "suski-prompt-library",
          version: 1,
          categories: mergedCategories,
          collections: mergedCollections,
          tags: mergedTags,
          entries: finalEntries,
          groups: mergedGroups,
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