/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/export_modal.js */

/**
 * 导出数据统计与预览中心（ExportModalManager）。
 * 提供词条/分类/收藏夹/缩略图引用四维可视化统计卡片，一键触发标准 JSON 导出。
 */

import { triggerExportLibrary } from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";

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