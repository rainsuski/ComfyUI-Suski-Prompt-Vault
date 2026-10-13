/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/simple_modals.js */

/**
 * 轻量交互型弹窗模块：
 * 包含词条永久删除二次确认弹窗（TileDeleteConfirmModal）与收藏夹即时联动弹窗（FavoriteModalManager）。
 */

import { deleteEntry, upsertCollection, upsertEntry } from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";

/* =========================================================================
   1. 词条删除二次确认紧凑型弹窗
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
   2. 收藏夹联动弹窗管理器
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