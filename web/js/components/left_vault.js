/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/left_vault.js */

/**
 * 左栏：预设提示词库（Preset Vault）组件。
 * 提供分类与收藏夹双下拉联动筛选、组合模板与普通词条自动识别装配、
 * 多维度即时检索、分类管理中心与导入导出中心弹窗唤起。
 */

import { isolateCanvasEvents, isolateWheelScroll } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";
import { createTileElement } from "./tile.js";

function buildCategoryHierarchyOptions(categories) {
    const result = [{ id: "ALL", name: "全部分类", label: "全部分类" }];
    const map = new Map();
    const roots = [];

    categories.forEach((c) => {
        map.set(c.id, { ...c, children: [] });
    });

    categories.forEach((c) => {
        if (c.parentId && map.has(c.parentId)) {
            map.get(c.parentId).children.push(map.get(c.id));
        } else {
            roots.push(map.get(c.id));
        }
    });

    function traverse(node, depth) {
        const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}└─ `;
        result.push({
            id: node.id,
            name: node.name,
            label: `${prefix}${node.name}`,
        });
        if (node.children) {
            node.children.forEach((child) => traverse(child, depth + 1));
        }
    }

    roots.forEach((root) => traverse(root, 0));
    return result;
}

export class LeftVaultComponent {
    /**
     * @param {HTMLElement} container - 左栏宿主 DOM 容器
     * @param {import("../state.js").VaultNodeState} state - 状态机实例
     * @param {() => { categories: any[], collections: any[], tags: any[], entries: any[] }} getLibraryCallback - 获取全量库回调
     * @param {(entry: any) => void} onOpenEntryModalCallback - 打开词条录入弹窗回调
     * @param {(entry: any) => void} onOpenFavoriteModalCallback - 打开收藏联动弹窗回调
     * @param {() => void} onOpenTaxonomyManagerCallback - 打开分类与收藏夹管理中心回调
     * @param {(entry: any) => void} onDeleteEntryCallback - 打开词条删除确认弹窗回调
     * @param {() => void} onOpenImportModalCallback - 唤起导入冲突预检处理弹窗回调
     * @param {() => void} onOpenExportModalCallback - 唤起导出预览弹窗回调
     */
    constructor(
        container,
        state,
        getLibraryCallback,
        onOpenEntryModalCallback,
        onOpenFavoriteModalCallback,
        onOpenTaxonomyManagerCallback,
        onDeleteEntryCallback,
        onOpenImportModalCallback,
        onOpenExportModalCallback
    ) {
        this.container = container;
        this.state = state;
        this.getLibrary = getLibraryCallback;
        this.onOpenEntryModal = onOpenEntryModalCallback;
        this.onOpenFavoriteModal = onOpenFavoriteModalCallback;
        this.onOpenTaxonomyManager = onOpenTaxonomyManagerCallback;
        this.onDeleteEntry = onDeleteEntryCallback;
        this.onOpenImportModal = onOpenImportModalCallback;
        this.onOpenExportModal = onOpenExportModalCallback;

        this.filterCategory = "ALL";
        this.filterCollection = "ALL";
        this.searchKeyword = "";

        this.initDOM();
        this.state.subscribe(() => this.renderList());
    }

    initDOM() {
        this.container.innerHTML = "";

        // 1. 头部区域
        const header = document.createElement("div");
        header.className = "prompt-vault-col-header";

        const titleBar = document.createElement("div");
        titleBar.className = "prompt-vault-header-title-bar";

        const title = document.createElement("span");
        title.className = "prompt-vault-col-title";
        title.innerHTML = `${renderIcon("folder", 14)} <span>提示词库</span>`;
        titleBar.appendChild(title);

        const btnGroup = document.createElement("div");
        btnGroup.style.display = "flex";
        btnGroup.style.gap = "4px";

        const manageTaxonomyBtn = document.createElement("button");
        manageTaxonomyBtn.type = "button";
        manageTaxonomyBtn.className = "prompt-vault-btn prompt-vault-btn-default";
        manageTaxonomyBtn.innerHTML = `${renderIcon("settings", 12)} <span>管理分类/收藏夹</span>`;
        manageTaxonomyBtn.title = "管理嵌套子分类色彩与收藏夹";
        manageTaxonomyBtn.addEventListener("click", () => {
            if (typeof this.onOpenTaxonomyManager === "function") {
                this.onOpenTaxonomyManager();
            }
        });
        btnGroup.appendChild(manageTaxonomyBtn);

        const importBtn = document.createElement("button");
        importBtn.type = "button";
        importBtn.className = "prompt-vault-btn prompt-vault-btn-default prompt-vault-btn-icon";
        importBtn.innerHTML = renderIcon("download", 13);
        importBtn.title = "导入词库";
        importBtn.addEventListener("click", () => {
            if (typeof this.onOpenImportModal === "function") {
                this.onOpenImportModal();
            }
        });
        btnGroup.appendChild(importBtn);

        const exportBtn = document.createElement("button");
        exportBtn.type = "button";
        exportBtn.className = "prompt-vault-btn prompt-vault-btn-default prompt-vault-btn-icon";
        exportBtn.innerHTML = renderIcon("upload", 13);
        exportBtn.title = "导出词库";
        exportBtn.addEventListener("click", () => {
            if (typeof this.onOpenExportModal === "function") {
                this.onOpenExportModal();
            }
        });
        btnGroup.appendChild(exportBtn);

        titleBar.appendChild(btnGroup);
        header.appendChild(titleBar);

        // 2. 双下拉联动筛选与搜索行
        const filterRow = document.createElement("div");
        filterRow.className = "prompt-vault-toolbar-row";

        this.categorySelect = document.createElement("select");
        this.categorySelect.className = "prompt-vault-select";
        this.categorySelect.style.flex = "1 1 0";
        this.categorySelect.addEventListener("change", () => {
            this.filterCategory = this.categorySelect.value;
            this.renderList();
        });
        filterRow.appendChild(this.categorySelect);

        this.collectionSelect = document.createElement("select");
        this.collectionSelect.className = "prompt-vault-select";
        this.collectionSelect.style.flex = "1 1 0";
        this.collectionSelect.addEventListener("change", () => {
            this.filterCollection = this.collectionSelect.value;
            this.renderList();
        });
        filterRow.appendChild(this.collectionSelect);

        header.appendChild(filterRow);

        const searchRow = document.createElement("div");
        searchRow.className = "prompt-vault-toolbar-row";

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "prompt-vault-input prompt-vault-search-box";
        searchInput.placeholder = "搜索标题/提示词内容...";
        searchInput.addEventListener("input", () => {
            this.searchKeyword = searchInput.value.trim().toLowerCase();
            this.renderList();
        });
        searchRow.appendChild(searchInput);
        header.appendChild(searchRow);

        this.container.appendChild(header);

        // 3. 磁贴列表视口
        this.listViewport = document.createElement("div");
        this.listViewport.className = "prompt-vault-list-viewport";
        isolateWheelScroll(this.listViewport);
        isolateCanvasEvents(this.listViewport);
        this.container.appendChild(this.listViewport);

        // 4. 底部统计底栏
        this.footer = document.createElement("div");
        this.footer.className = "prompt-vault-col-footer";
        this.container.appendChild(this.footer);

        this.refreshDropdownOptions();
        this.renderList();
    }

    refreshDropdownOptions() {
        const library = this.getLibrary();
        const categories = library.categories || [];
        const collections = library.collections || [];

        const catOptions = buildCategoryHierarchyOptions(categories);
        const curCat = this.filterCategory;
        this.categorySelect.innerHTML = "";
        catOptions.forEach((opt) => {
            const el = document.createElement("option");
            el.value = opt.id;
            el.textContent = opt.label;
            this.categorySelect.appendChild(el);
        });
        if (curCat && catOptions.some((o) => o.id === curCat)) {
            this.categorySelect.value = curCat;
        } else {
            this.categorySelect.value = "ALL";
            this.filterCategory = "ALL";
        }

        const curCol = this.filterCollection;
        this.collectionSelect.innerHTML = `
      <option value="ALL">全部收藏夹</option>
      <option value="__UNFAVORITED__">未收藏</option>
    `;
        collections.forEach((col) => {
            const el = document.createElement("option");
            el.value = col.name;
            el.textContent = col.name;
            this.collectionSelect.appendChild(el);
        });
        if (curCol) {
            this.collectionSelect.value = curCol;
        } else {
            this.collectionSelect.value = "ALL";
            this.filterCollection = "ALL";
        }
    }

    renderList() {
        this.refreshDropdownOptions();
        const library = this.getLibrary();
        const entries = library.entries || [];
        const categories = library.categories || [];
        const tagsDict = library.tags || [];

        const selectedEntryIds = new Set(
            this.state.selectedTiles.map((t) => t.ref_preset_id).filter(Boolean)
        );

        const filtered = entries.filter((item) => {
            if (this.filterCategory !== "ALL") {
                if (item.categoryId !== this.filterCategory) {
                    return false;
                }
            }

            const hasCollection = Array.isArray(item.collections) && item.collections.length > 0;
            if (this.filterCollection === "__UNFAVORITED__") {
                if (hasCollection) return false;
            } else if (this.filterCollection !== "ALL") {
                if (!hasCollection || !item.collections.includes(this.filterCollection)) {
                    return false;
                }
            }

            if (this.searchKeyword) {
                const titleMatch = (item.title || "").toLowerCase().includes(this.searchKeyword);
                let textMatch = (item.text || item.prompt || "").toLowerCase().includes(this.searchKeyword);

                if (!textMatch && (Array.isArray(item.groupMembers) || Array.isArray(item.members))) {
                    const members = item.groupMembers || item.members;
                    textMatch = members.some((m) =>
                        (m.title || "").toLowerCase().includes(this.searchKeyword) ||
                        (m.text || m.prompt || "").toLowerCase().includes(this.searchKeyword)
                    );
                }

                const itemTagIds = Array.isArray(item.tagIds) ? item.tagIds : [];
                const tagMatch = itemTagIds.some((tid) => {
                    const tObj = tagsDict.find((t) => t.id === tid);
                    return tObj && tObj.name.toLowerCase().includes(this.searchKeyword);
                });

                if (!titleMatch && !textMatch && !tagMatch) return false;
            }

            return true;
        });

        this.listViewport.innerHTML = "";

        if (filtered.length === 0) {
            this.listViewport.innerHTML = `
        <div class="prompt-vault-empty-state">
          <div class="prompt-vault-empty-icon">${renderIcon("folder", 28)}</div>
          <div>未找到匹配词条</div>
          <div style="font-size:11px; opacity:0.7;">尝试切换分类、收藏夹或重置搜索词</div>
        </div>
      `;
        } else {
            filtered.forEach((entry) => {
                const isAlreadyAdded = selectedEntryIds.has(entry.id);
                const tileElement = createTileElement({
                    data: entry,
                    mode: "vault",
                    state: this.state,
                    isActive: false,
                    isAlreadyAdded: isAlreadyAdded,
                    categories: categories,
                    tagsDict: tagsDict,
                    onToggleFavorite: (targetEntry) => {
                        if (typeof this.onOpenFavoriteModal === "function") {
                            this.onOpenFavoriteModal(targetEntry);
                        }
                    },
                    onDeleteEntry: (targetEntry) => {
                        if (typeof this.onDeleteEntry === "function") {
                            this.onDeleteEntry(targetEntry);
                        }
                    },
                });
                this.listViewport.appendChild(tileElement);
            });
        }

        this.footer.textContent = `词库共 ${entries.length} 条 (展示 ${filtered.length} 条)`;
    }
}