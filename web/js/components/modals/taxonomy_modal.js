/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/taxonomy_modal.js */

/**
 * 分类与收藏夹多级管理中心（TaxonomyModalManager）。
 * 支持无限层级子分类树形渲染、动态取色、直属与分支级联删除预检统计、
 * 收藏夹重命名与安全删除。
 */

import {
    deleteCategory,
    deleteCollection,
    upsertCategory,
    upsertCollection,
} from "../../api.js";
import { isolateCanvasEvents } from "../../utils/events.js";
import { renderIcon } from "../../utils/icons.js";

export class TaxonomyModalManager {
    /**
     * @param {() => { categories: any[], collections: any[], entries: any[] }} getLibraryCallback
     * @param {() => Promise<void>} onUpdatedCallback
     */
    constructor(getLibraryCallback, onUpdatedCallback) {
        this.getLibrary = getLibraryCallback;
        this.onUpdated = onUpdatedCallback;
        this.activeTab = "categories";
        this.searchKeyword = "";
        this.expandedNodeIds = new Set();
        this.inlineAddParentId = null;
        this.overlay = null;
    }

    open() {
        this.close();
        this.inlineAddParentId = null;
        this.overlay = document.createElement("div");
        this.overlay.className = "prompt-vault-modal-overlay";
        isolateCanvasEvents(this.overlay);

        this.overlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-large">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">分类与收藏夹管理</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div class="prompt-vault-tab-switch">
            <button type="button" class="prompt-vault-tab-btn is-active" id="pv-tab-cat">
              ${renderIcon("grid", 13)} <span>分类</span>
            </button>
            <button type="button" class="prompt-vault-tab-btn" id="pv-tab-fld">
              ${renderIcon("star", 13)} <span>收藏夹</span>
            </button>
          </div>

          <div class="prompt-vault-taxonomy-toolbar">
            <input type="text" class="prompt-vault-input" id="pv-tax-search" placeholder="搜索分类..." style="flex: 1 1 0; min-width: 0;" />
            <div style="display: flex; gap: 8px; flex-shrink: 0;">
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-tax-expand-all" style="height: 26px; font-size: 11px;">全部展开</button>
              <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-tax-collapse-all" style="height: 26px; font-size: 11px;">全部折叠</button>
            </div>
          </div>

          <div class="prompt-vault-taxonomy-list" id="pv-tax-list"></div>

          <div class="prompt-vault-taxonomy-bottom-row">
            <input type="text" class="prompt-vault-input" id="pv-tax-new-root" placeholder="新建根分类..." style="flex: 1 1 0; min-width: 0;" />
            <button type="button" class="prompt-vault-btn prompt-vault-btn-primary" id="pv-tax-add-root">
              ${renderIcon("plus", 12)} <span>添加</span>
            </button>
            <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-tax-finish">完成</button>
          </div>
        </div>
      </div>
    `;

        document.body.appendChild(this.overlay);
        this.bindEvents();
        this.renderContent();
    }

    bindEvents() {
        const closeBtn = this.overlay.querySelector(".prompt-vault-modal-close");
        const finishBtn = this.overlay.querySelector("#pv-tax-finish");
        const tabCat = this.overlay.querySelector("#pv-tab-cat");
        const tabFld = this.overlay.querySelector("#pv-tab-fld");
        const searchInput = this.overlay.querySelector("#pv-tax-search");
        const expandAllBtn = this.overlay.querySelector("#pv-tax-expand-all");
        const collapseAllBtn = this.overlay.querySelector("#pv-tax-collapse-all");
        const addRootBtn = this.overlay.querySelector("#pv-tax-add-root");
        const newRootInput = this.overlay.querySelector("#pv-tax-new-root");

        const handleClose = () => this.close();
        closeBtn.addEventListener("click", handleClose);
        finishBtn.addEventListener("click", handleClose);
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) handleClose();
        });

        tabCat.addEventListener("click", () => {
            this.activeTab = "categories";
            this.inlineAddParentId = null;
            tabCat.classList.add("is-active");
            tabFld.classList.remove("is-active");
            searchInput.placeholder = "搜索分类...";
            newRootInput.placeholder = "新建根分类...";
            this.renderContent();
        });

        tabFld.addEventListener("click", () => {
            this.activeTab = "collections";
            this.inlineAddParentId = null;
            tabFld.classList.add("is-active");
            tabCat.classList.remove("is-active");
            searchInput.placeholder = "搜索收藏夹...";
            newRootInput.placeholder = "新建收藏夹...";
            this.renderContent();
        });

        searchInput.addEventListener("input", () => {
            this.searchKeyword = searchInput.value.trim().toLowerCase();
            this.renderContent();
        });

        expandAllBtn.addEventListener("click", () => {
            const { categories } = this.getLibrary();
            (categories || []).forEach((it) => this.expandedNodeIds.add(it.id));
            this.renderContent();
        });

        collapseAllBtn.addEventListener("click", () => {
            this.expandedNodeIds.clear();
            this.renderContent();
        });

        addRootBtn.addEventListener("click", async () => {
            const name = (newRootInput.value || "").trim();
            if (!name) return;
            let res;
            if (this.activeTab === "categories") {
                res = await upsertCategory({
                    name,
                    parentId: null,
                    color: "#3b82f6",
                });
            } else {
                res = await upsertCollection({
                    name,
                });
            }
            if (res && res.success) {
                newRootInput.value = "";
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.renderContent();
            } else {
                alert(`添加失败: ${res?.error || "服务未响应"}`);
            }
        });
    }

    renderContent() {
        const listContainer = this.overlay.querySelector("#pv-tax-list");
        listContainer.innerHTML = "";

        const lib = this.getLibrary();
        const categories = lib.categories || [];
        const collections = lib.collections || [];
        const entries = lib.entries || [];

        if (this.activeTab === "categories") {
            this.renderCategoriesTree(listContainer, categories, entries);
        } else {
            this.renderCollectionsList(listContainer, collections, entries);
        }
    }

    renderCategoriesTree(listContainer, categories, entries) {
        if (!categories || categories.length === 0) {
            listContainer.innerHTML = `
        <div class="prompt-vault-empty-state" style="height: 100%; min-height: 220px;">
          <div class="prompt-vault-empty-icon">${renderIcon("folder", 28)}</div>
          <div>暂无分类</div>
          <div style="font-size:11px; opacity:0.7;">请在下方输入名称并点击 [+ 添加] 创建根分类</div>
        </div>
      `;
            return;
        }

        const map = new Map();
        const roots = [];
        categories.forEach((c) => map.set(c.id, { ...c, children: [] }));
        categories.forEach((c) => {
            if (c.parentId && map.has(c.parentId)) {
                map.get(c.parentId).children.push(map.get(c.id));
            } else {
                roots.push(map.get(c.id));
            }
        });

        const renderNode = (node, depth = 0) => {
            if (this.searchKeyword && !node.name.toLowerCase().includes(this.searchKeyword)) {
                const hasMatchingChild = (node.children || []).some((c) =>
                    c.name.toLowerCase().includes(this.searchKeyword)
                );
                if (!hasMatchingChild) return;
            }

            const itemRow = document.createElement("div");
            itemRow.className = "prompt-vault-tree-item";
            itemRow.style.marginLeft = `${depth * 20}px`;

            const leftBox = document.createElement("div");
            leftBox.className = "prompt-vault-tree-left";

            const hasChildren = node.children && node.children.length > 0;
            const expandIcon = document.createElement("span");
            expandIcon.style.cursor = "pointer";
            expandIcon.style.width = "14px";
            expandIcon.innerHTML = hasChildren
                ? renderIcon(this.expandedNodeIds.has(node.id) ? "chevronDown" : "chevronRight", 13)
                : "";
            expandIcon.addEventListener("click", () => {
                if (this.expandedNodeIds.has(node.id)) {
                    this.expandedNodeIds.delete(node.id);
                } else {
                    this.expandedNodeIds.add(node.id);
                }
                this.renderContent();
            });
            leftBox.appendChild(expandIcon);

            const colorPill = document.createElement("div");
            colorPill.className = "prompt-vault-color-pill";
            colorPill.style.backgroundColor = node.color || "#3b82f6";
            leftBox.appendChild(colorPill);

            const nameLabel = document.createElement("span");
            nameLabel.className = "prompt-vault-tree-name";
            nameLabel.textContent = node.name;
            leftBox.appendChild(nameLabel);
            itemRow.appendChild(leftBox);

            const rightBox = document.createElement("div");
            rightBox.className = "prompt-vault-tree-right";

            const count = entries.filter((e) => e.categoryId === node.id).length;
            const countBadge = document.createElement("span");
            countBadge.className = "prompt-vault-count-badge";
            countBadge.textContent = count;
            rightBox.appendChild(countBadge);

            const addChildBtn = document.createElement("button");
            addChildBtn.type = "button";
            addChildBtn.className = "prompt-vault-tile-btn";
            addChildBtn.title = "添加子级";
            addChildBtn.innerHTML = renderIcon("plus", 12);
            addChildBtn.addEventListener("click", () => {
                this.inlineAddParentId = node.id;
                this.expandedNodeIds.add(node.id);
                this.renderContent();
            });
            rightBox.appendChild(addChildBtn);

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "prompt-vault-tile-btn";
            editBtn.title = "修改名称与颜色";
            editBtn.innerHTML = renderIcon("settings", 12);
            editBtn.addEventListener("click", () => {
                this.openEditCategoryDialog(node);
            });
            rightBox.appendChild(editBtn);

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "prompt-vault-tile-btn";
            deleteBtn.title = "删除";
            deleteBtn.innerHTML = renderIcon("trash", 12);
            deleteBtn.addEventListener("click", () => {
                this.openDeleteCategoryModal(node, categories, entries);
            });
            rightBox.appendChild(deleteBtn);

            itemRow.appendChild(rightBox);
            listContainer.appendChild(itemRow);

            if (this.inlineAddParentId === node.id) {
                const inlineRow = document.createElement("div");
                inlineRow.className = "prompt-vault-inline-add-row";
                inlineRow.style.marginLeft = `${(depth + 1) * 20}px`;

                const inlineInput = document.createElement("input");
                inlineInput.type = "text";
                inlineInput.className = "prompt-vault-inline-add-input";
                inlineInput.placeholder = "";

                const inlineSaveBtn = document.createElement("button");
                inlineSaveBtn.type = "button";
                inlineSaveBtn.className = "prompt-vault-btn prompt-vault-btn-primary";
                inlineSaveBtn.style.height = "26px";
                inlineSaveBtn.style.padding = "0 8px";
                inlineSaveBtn.style.fontSize = "11px";
                inlineSaveBtn.innerHTML = `<span>✓ 保存</span>`;

                const inlineCancelBtn = document.createElement("button");
                inlineCancelBtn.type = "button";
                inlineCancelBtn.className = "prompt-vault-btn prompt-vault-btn-default";
                inlineCancelBtn.style.height = "26px";
                inlineCancelBtn.style.padding = "0 6px";
                inlineCancelBtn.style.fontSize = "11px";
                inlineCancelBtn.innerHTML = `<span>✕</span>`;

                const doSaveChild = async () => {
                    const childName = inlineInput.value.trim();
                    if (!childName) return;
                    const res = await upsertCategory({
                        name: childName,
                        parentId: node.id,
                        color: node.color || "#3b82f6",
                    });
                    if (res && res.success) {
                        this.inlineAddParentId = null;
                        if (typeof this.onUpdated === "function") await this.onUpdated();
                        this.renderContent();
                    } else {
                        alert(`添加子分类失败: ${res?.error || "服务未响应"}`);
                    }
                };

                inlineSaveBtn.addEventListener("click", doSaveChild);
                inlineInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") doSaveChild();
                    if (e.key === "Escape") {
                        this.inlineAddParentId = null;
                        this.renderContent();
                    }
                });

                inlineCancelBtn.addEventListener("click", () => {
                    this.inlineAddParentId = null;
                    this.renderContent();
                });

                inlineRow.appendChild(inlineInput);
                inlineRow.appendChild(inlineSaveBtn);
                inlineRow.appendChild(inlineCancelBtn);
                listContainer.appendChild(inlineRow);

                setTimeout(() => inlineInput.focus(), 50);
            }

            if (hasChildren && (this.expandedNodeIds.has(node.id) || this.searchKeyword)) {
                node.children.forEach((child) => renderNode(child, depth + 1));
            }
        };

        roots.forEach((root) => renderNode(root, 0));
    }

    renderCollectionsList(listContainer, collections, entries) {
        if (!collections || collections.length === 0) {
            listContainer.innerHTML = `
        <div class="prompt-vault-empty-state" style="height: 100%; min-height: 220px;">
          <div class="prompt-vault-empty-icon">${renderIcon("star", 28)}</div>
          <div>暂无收藏夹</div>
          <div style="font-size:11px; opacity:0.7;">请在下方输入名称并点击 [+ 添加] 创建收藏夹</div>
        </div>
      `;
            return;
        }

        collections.forEach((col) => {
            if (this.searchKeyword && !col.name.toLowerCase().includes(this.searchKeyword)) {
                return;
            }

            const itemRow = document.createElement("div");
            itemRow.className = "prompt-vault-tree-item";

            const leftBox = document.createElement("div");
            leftBox.className = "prompt-vault-tree-left";

            const iconSpan = document.createElement("span");
            iconSpan.innerHTML = renderIcon("star", 13);
            leftBox.appendChild(iconSpan);

            const nameLabel = document.createElement("span");
            nameLabel.className = "prompt-vault-tree-name";
            nameLabel.textContent = col.name;
            leftBox.appendChild(nameLabel);
            itemRow.appendChild(leftBox);

            const rightBox = document.createElement("div");
            rightBox.className = "prompt-vault-tree-right";

            const count = entries.filter(
                (e) => Array.isArray(e.collections) && e.collections.includes(col.name)
            ).length;
            const countBadge = document.createElement("span");
            countBadge.className = "prompt-vault-count-badge";
            countBadge.textContent = count;
            rightBox.appendChild(countBadge);

            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "prompt-vault-tile-btn";
            editBtn.title = "重命名";
            editBtn.innerHTML = renderIcon("settings", 12);
            editBtn.addEventListener("click", async () => {
                const newName = prompt("重命名收藏夹:", col.name);
                if (!newName || newName.trim() === col.name) return;
                await upsertCollection({ id: col.id, name: newName.trim() });
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.renderContent();
            });
            rightBox.appendChild(editBtn);

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "prompt-vault-tile-btn";
            deleteBtn.title = "删除";
            deleteBtn.innerHTML = renderIcon("trash", 12);
            deleteBtn.addEventListener("click", async () => {
                if (!confirm(`确定要删除收藏夹 [${col.name}] 吗？`)) return;
                await deleteCollection(col.id);
                if (typeof this.onUpdated === "function") await this.onUpdated();
                this.renderContent();
            });
            rightBox.appendChild(deleteBtn);

            itemRow.appendChild(rightBox);
            listContainer.appendChild(itemRow);
        });
    }

    openEditCategoryDialog(node) {
        const newName = prompt("修改分类名称:", node.name);
        if (newName === null) return;
        const finalName = newName.trim() || node.name;

        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = node.color || "#3b82f6";
        colorInput.style.position = "fixed";
        colorInput.style.opacity = "0";
        document.body.appendChild(colorInput);

        colorInput.addEventListener("change", async () => {
            await upsertCategory({
                id: node.id,
                name: finalName,
                parentId: node.parentId,
                color: colorInput.value,
            });
            document.body.removeChild(colorInput);
            if (typeof this.onUpdated === "function") await this.onUpdated();
            this.renderContent();
        });
        colorInput.click();
    }

    openDeleteCategoryModal(node, categories, entries) {
        const getPath = (n) => {
            const parts = [n.name];
            let cur = n;
            while (cur.parentId) {
                const parent = categories.find((p) => p.id === cur.parentId);
                if (parent) {
                    parts.unshift(parent.name);
                    cur = parent;
                } else {
                    break;
                }
            }
            return parts.join(" / ");
        };
        const fullPath = getPath(node);

        const descendantNodes = [];
        const collectDescendants = (pid) => {
            categories.forEach((it) => {
                if (it.parentId === pid) {
                    descendantNodes.push(it);
                    collectDescendants(it.id);
                }
            });
        };
        collectDescendants(node.id);

        const directPresetsCount = entries.filter((e) => e.categoryId === node.id).length;
        const directChildrenCount = categories.filter((c) => c.parentId === node.id).length;
        const branchChildrenCount = descendantNodes.length;
        const descendantIds = new Set(descendantNodes.map((d) => d.id));
        const branchPresetsCount = entries.filter((e) => descendantIds.has(e.categoryId)).length;

        const confirmOverlay = document.createElement("div");
        confirmOverlay.className = "prompt-vault-modal-overlay";
        confirmOverlay.style.zIndex = "10002";
        isolateCanvasEvents(confirmOverlay);

        confirmOverlay.innerHTML = `
      <div class="prompt-vault-modal pv-modal-compact" style="max-width: 480px;">
        <div class="prompt-vault-modal-header">
          <div class="prompt-vault-modal-title">删除分类 · ${fullPath}</div>
          <button type="button" class="prompt-vault-modal-close">${renderIcon("x", 16)}</button>
        </div>
        <div class="prompt-vault-modal-body">
          <div class="pv-stat-grid">
            <div class="pv-stat-card">
              <span class="pv-stat-number">${directPresetsCount}</span>
              <span class="pv-stat-label">直属词条</span>
            </div>
            <div class="pv-stat-card">
              <span class="pv-stat-number">${directChildrenCount}</span>
              <span class="pv-stat-label">直属子分类</span>
            </div>
            <div class="pv-stat-card">
              <span class="pv-stat-number">${branchChildrenCount}</span>
              <span class="pv-stat-label">分支分类</span>
            </div>
            <div class="pv-stat-card">
              <span class="pv-stat-number">${branchPresetsCount}</span>
              <span class="pv-stat-label">分支词条</span>
            </div>
          </div>

          <label class="pv-checkbox-row">
            <input type="checkbox" id="pv-chk-delete-branch" />
            <span>删除整个分类分支</span>
          </label>

          <div class="pv-info-callout">
            默认只删除当前分类：子分类提升一级，直属词条变为未分类，不会删除任何提示词条。
          </div>
        </div>
        <div class="prompt-vault-modal-footer">
          <button type="button" class="prompt-vault-btn prompt-vault-btn-default" id="pv-del-cat-cancel">取消</button>
          <button type="button" class="prompt-vault-btn prompt-vault-btn-danger-solid" id="pv-del-cat-confirm">
            ${renderIcon("trash", 12)} <span>删除</span>
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(confirmOverlay);

        const closeBtn = confirmOverlay.querySelector(".prompt-vault-modal-close");
        const cancelBtn = confirmOverlay.querySelector("#pv-del-cat-cancel");
        const confirmBtn = confirmOverlay.querySelector("#pv-del-cat-confirm");
        const branchChk = confirmOverlay.querySelector("#pv-chk-delete-branch");

        const doClose = () => {
            if (confirmOverlay.parentNode) {
                confirmOverlay.parentNode.removeChild(confirmOverlay);
            }
        };

        closeBtn.addEventListener("click", doClose);
        cancelBtn.addEventListener("click", doClose);
        confirmOverlay.addEventListener("click", (e) => {
            if (e.target === confirmOverlay) doClose();
        });

        confirmBtn.addEventListener("click", async () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "删除中...";
            const deleteBranch = branchChk.checked;
            await deleteCategory(node.id, deleteBranch);
            doClose();
            if (typeof this.onUpdated === "function") await this.onUpdated();
            this.renderContent();
        });
    }

    close() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.inlineAddParentId = null;
    }
}