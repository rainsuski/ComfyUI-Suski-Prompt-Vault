/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/left_vault.js */

/**
 * 左栏：预设提示词库（Preset Vault）组件。
 * 提供单体视图与组合视图切换、精简单行搜索展开、
 * 组视图手风琴二级折叠展开、跨视图平滑滚动定位与微光闪烁、
 * 全面采用纯净矢量 SVG 图标（零 Emoji）。
 */

import { deleteGroup } from "../api.js";
import { isolateCanvasEvents, isolateWheelScroll } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";
import { createTileElement } from "./tile.js";

function getVectorIcon(name, size = 13) {
    if (name === "search") {
        return renderIcon("search", size) || `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    }
    return renderIcon(name, size);
}

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
     * @param {() => { categories: any[], collections: any[], tags: any[], entries: any[], groups: any[] }} getLibraryCallback
     * @param {(entry: any) => void} onOpenEntryModalCallback
     * @param {(entry: any) => void} onOpenFavoriteModalCallback
     * @param {() => void} onOpenTaxonomyManagerCallback
     * @param {(entry: any) => void} onDeleteEntryCallback
     * @param {() => void} onOpenImportModalCallback
     * @param {() => void} onOpenExportModalCallback
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

        this.viewMode = "single";
        this.isSearchActive = false;
        this.expandedGroupIds = new Set();

        this.filterCategory = "ALL";
        this.filterCollection = "ALL";
        this.searchKeyword = "";

        this.initDOM();
        this.state.subscribe(() => this.renderList());
    }

    initDOM() {
        this.container.innerHTML = "";

        // 1. 头部标题栏
        const header = document.createElement("div");
        header.className = "prompt-vault-col-header";

        const titleBar = document.createElement("div");
        titleBar.className = "prompt-vault-header-title-bar";

        const title = document.createElement("span");
        title.className = "prompt-vault-col-title";
        title.innerHTML = `${getVectorIcon("folder", 14)} <span>提示词库</span>`;
        titleBar.appendChild(title);

        const btnGroup = document.createElement("div");
        btnGroup.style.display = "flex";
        btnGroup.style.gap = "4px";

        const manageTaxonomyBtn = document.createElement("button");
        manageTaxonomyBtn.type = "button";
        manageTaxonomyBtn.className = "prompt-vault-btn prompt-vault-btn-default";
        manageTaxonomyBtn.innerHTML = `${getVectorIcon("settings", 12)} <span>管理分类/收藏夹</span>`;
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
        importBtn.innerHTML = getVectorIcon("download", 13);
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
        exportBtn.innerHTML = getVectorIcon("upload", 13);
        exportBtn.title = "导出词库";
        exportBtn.addEventListener("click", () => {
            if (typeof this.onOpenExportModal === "function") {
                this.onOpenExportModal();
            }
        });
        btnGroup.appendChild(exportBtn);

        titleBar.appendChild(btnGroup);
        header.appendChild(titleBar);

        // 2. 筛选与轻量折叠搜索挂载区
        this.filterRowContainer = document.createElement("div");
        header.appendChild(this.filterRowContainer);

        // 3. 视图切换栏（紧接在分类下拉筛选行下方）
        const viewToggleRow = document.createElement("div");
        viewToggleRow.className = "prompt-vault-view-toggle-bar";

        const viewToggle = document.createElement("div");
        viewToggle.className = "prompt-vault-view-toggle";

        this.singleViewBtn = document.createElement("button");
        this.singleViewBtn.type = "button";
        this.singleViewBtn.className = "prompt-vault-toggle-btn is-active";
        this.singleViewBtn.innerHTML = `${getVectorIcon("messageSquare", 12)} <span>单体视图</span>`;
        this.singleViewBtn.addEventListener("click", () => {
            if (this.viewMode !== "single") {
                this.viewMode = "single";
                this.updateViewToggleUI();
                this.renderList();
            }
        });
        viewToggle.appendChild(this.singleViewBtn);

        this.groupViewBtn = document.createElement("button");
        this.groupViewBtn.type = "button";
        this.groupViewBtn.className = "prompt-vault-toggle-btn";
        this.groupViewBtn.innerHTML = `${getVectorIcon("layers", 12)} <span>组合视图</span>`;
        this.groupViewBtn.addEventListener("click", () => {
            if (this.viewMode !== "group") {
                this.viewMode = "group";
                this.updateViewToggleUI();
                this.renderList();
            }
        });
        viewToggle.appendChild(this.groupViewBtn);

        viewToggleRow.appendChild(viewToggle);
        header.appendChild(viewToggleRow);

        this.container.appendChild(header);

        // 4. 磁贴列表视口
        this.listViewport = document.createElement("div");
        this.listViewport.className = "prompt-vault-list-viewport";
        isolateWheelScroll(this.listViewport);
        isolateCanvasEvents(this.listViewport);
        this.container.appendChild(this.listViewport);

        // 5. 底部统计底栏
        this.footer = document.createElement("div");
        this.footer.className = "prompt-vault-col-footer";
        this.container.appendChild(this.footer);

        this.renderFilterRow();
        this.renderList();
    }

    renderFilterRow() {
        this.filterRowContainer.innerHTML = "";

        if (this.isSearchActive) {
            // 搜索展开状态：输入框取代整行，右侧带有退出按钮
            const searchRow = document.createElement("div");
            searchRow.className = "prompt-vault-toolbar-row";

            const searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.className = "prompt-vault-input prompt-vault-search-box";
            searchInput.placeholder = "搜索标题/提示词内容...";
            searchInput.value = this.searchKeyword;
            searchInput.addEventListener("input", () => {
                this.searchKeyword = searchInput.value.trim().toLowerCase();
                this.renderList();
            });
            searchRow.appendChild(searchInput);

            const closeSearchBtn = document.createElement("button");
            closeSearchBtn.type = "button";
            closeSearchBtn.className = "prompt-vault-btn prompt-vault-btn-default prompt-vault-btn-icon";
            closeSearchBtn.innerHTML = getVectorIcon("x", 12);
            closeSearchBtn.title = "退出搜索";
            closeSearchBtn.addEventListener("click", () => {
                this.isSearchActive = false;
                this.searchKeyword = "";
                this.renderFilterRow();
                this.renderList();
            });
            searchRow.appendChild(closeSearchBtn);

            this.filterRowContainer.appendChild(searchRow);
            requestAnimationFrame(() => searchInput.focus());
        } else {
            // 常态：分类下拉 + 收藏夹下拉 + 搜索图标按钮
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
            this.collectionSelect.style.display = this.viewMode === "group" ? "none" : "block";
            this.collectionSelect.addEventListener("change", () => {
                this.filterCollection = this.collectionSelect.value;
                this.renderList();
            });
            filterRow.appendChild(this.collectionSelect);

            const searchToggleBtn = document.createElement("button");
            searchToggleBtn.type = "button";
            searchToggleBtn.className = "prompt-vault-btn prompt-vault-btn-default prompt-vault-btn-icon";
            searchToggleBtn.innerHTML = getVectorIcon("search", 13);
            searchToggleBtn.title = "展开搜索";
            searchToggleBtn.addEventListener("click", () => {
                this.isSearchActive = true;
                this.renderFilterRow();
            });
            filterRow.appendChild(searchToggleBtn);

            this.filterRowContainer.appendChild(filterRow);
            this.refreshDropdownOptions();
        }
    }

    updateViewToggleUI() {
        if (this.viewMode === "single") {
            this.singleViewBtn.classList.add("is-active");
            this.groupViewBtn.classList.remove("is-active");
            if (this.collectionSelect) this.collectionSelect.style.display = "block";
        } else {
            this.singleViewBtn.classList.remove("is-active");
            this.groupViewBtn.classList.add("is-active");
            if (this.collectionSelect) this.collectionSelect.style.display = "none";
        }
    }

    jumpToGroup(groupId) {
        this.viewMode = "group";
        this.expandedGroupIds.add(groupId);
        this.updateViewToggleUI();
        this.renderList();

        requestAnimationFrame(() => {
            const cardEl = this.listViewport.querySelector(`.prompt-vault-group-card[data-group-id="${groupId}"]`);
            if (cardEl) {
                cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
                cardEl.classList.add("is-target-glow");
                setTimeout(() => {
                    cardEl.classList.remove("is-target-glow");
                }, 1500);
            }
        });
    }

    refreshDropdownOptions() {
        if (!this.categorySelect || !this.collectionSelect) return;

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
        if (!this.isSearchActive) {
            this.refreshDropdownOptions();
        }
        const library = this.getLibrary();
        const entries = library.entries || [];
        const groups = library.groups || [];
        const categories = library.categories || [];
        const tagsDict = library.tags || [];

        this.listViewport.innerHTML = "";

        if (this.viewMode === "single") {
            this.renderSingleView(entries, groups, categories, tagsDict);
        } else {
            this.renderGroupView(groups, entries, categories, tagsDict);
        }
    }

    renderSingleView(entries, groups, categories, tagsDict) {
        const entryToGroupsMap = new Map();
        groups.forEach((g) => {
            const eids = Array.isArray(g.entryIds) ? g.entryIds : [];
            eids.forEach((eid) => {
                if (!entryToGroupsMap.has(eid)) {
                    entryToGroupsMap.set(eid, []);
                }
                entryToGroupsMap.get(eid).push(g);
            });
        });

        const selectedEntryIds = new Set(
            this.state.selectedTiles.map((t) => t.ref_preset_id).filter(Boolean)
        );

        const filtered = entries.filter((item) => {
            if (this.filterCategory !== "ALL") {
                if (item.categoryId !== this.filterCategory) return false;
            }

            const hasCollection = Array.isArray(item.collections) && item.collections.length > 0;
            if (this.filterCollection === "__UNFAVORITED__") {
                if (hasCollection) return false;
            } else if (this.filterCollection !== "ALL") {
                if (!hasCollection || !item.collections.includes(this.filterCollection)) return false;
            }

            if (this.searchKeyword) {
                const titleMatch = (item.title || "").toLowerCase().includes(this.searchKeyword);
                const textMatch = (item.text || item.prompt || "").toLowerCase().includes(this.searchKeyword);
                const itemTagIds = Array.isArray(item.tagIds) ? item.tagIds : [];
                const tagMatch = itemTagIds.some((tid) => {
                    const tObj = tagsDict.find((t) => t.id === tid);
                    return tObj && tObj.name.toLowerCase().includes(this.searchKeyword);
                });
                if (!titleMatch && !textMatch && !tagMatch) return false;
            }

            return true;
        });

        if (filtered.length === 0) {
            this.listViewport.innerHTML = `
        <div class="prompt-vault-empty-state">
          <div class="prompt-vault-empty-icon">${getVectorIcon("messageSquare", 28)}</div>
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
                    belongingGroups: entryToGroupsMap.get(entry.id) || [],
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
                    onJumpToGroup: (targetGroupId) => this.jumpToGroup(targetGroupId),
                });
                this.listViewport.appendChild(tileElement);
            });
        }

        this.footer.textContent = `单体词条共 ${entries.length} 条 (展示 ${filtered.length} 条)`;
    }

    renderGroupView(groups, entries, categories, tagsDict) {
        const entryMap = new Map(entries.map((e) => [e.id, e]));

        const filtered = groups.filter((group) => {
            if (this.filterCategory !== "ALL") {
                if (group.categoryId !== this.filterCategory) return false;
            }

            if (this.searchKeyword) {
                const titleMatch = (group.title || "").toLowerCase().includes(this.searchKeyword);
                if (titleMatch) return true;

                const eids = Array.isArray(group.entryIds) ? group.entryIds : [];
                const memberMatch = eids.some((eid) => {
                    const ent = entryMap.get(eid);
                    if (!ent) return false;
                    return (
                        (ent.title || "").toLowerCase().includes(this.searchKeyword) ||
                        (ent.text || ent.prompt || "").toLowerCase().includes(this.searchKeyword)
                    );
                });
                if (!memberMatch) return false;
            }

            return true;
        });

        if (filtered.length === 0) {
            this.listViewport.innerHTML = `
        <div class="prompt-vault-empty-state">
          <div class="prompt-vault-empty-icon">${getVectorIcon("layers", 28)}</div>
          <div>未找到匹配提示词组</div>
          <div style="font-size:11px; opacity:0.7;">可在中栏多选词条后点击“存为提示词组”进行创建</div>
        </div>
      `;
        } else {
            filtered.forEach((group) => {
                const isExpanded = this.expandedGroupIds.has(group.id);
                const memberIds = Array.isArray(group.entryIds) ? group.entryIds : [];

                const card = document.createElement("div");
                card.className = "prompt-vault-group-card";
                card.dataset.groupId = group.id;

                const headerRow = document.createElement("div");
                headerRow.className = "prompt-vault-group-header";

                const expandIcon = document.createElement("span");
                expandIcon.className = "prompt-vault-group-chevron";
                expandIcon.innerHTML = getVectorIcon(isExpanded ? "chevronDown" : "chevronRight", 13);
                headerRow.appendChild(expandIcon);

                const titleBox = document.createElement("div");
                titleBox.className = "prompt-vault-group-title-box";

                const groupTitle = document.createElement("span");
                groupTitle.className = "prompt-vault-group-title";
                groupTitle.textContent = group.title || "未命名组合";
                titleBox.appendChild(groupTitle);

                const matchedCat = categories.find((c) => c.id === group.categoryId);
                if (matchedCat) {
                    const catBadge = document.createElement("span");
                    catBadge.className = "prompt-vault-tile-badge";
                    catBadge.textContent = matchedCat.name;
                    if (matchedCat.color) {
                        catBadge.style.backgroundColor = `${matchedCat.color}22`;
                        catBadge.style.color = matchedCat.color;
                        catBadge.style.borderColor = `${matchedCat.color}44`;
                    }
                    titleBox.appendChild(catBadge);
                }
                headerRow.appendChild(titleBox);

                const countBadge = document.createElement("span");
                countBadge.className = "prompt-vault-group-count";
                countBadge.textContent = `${memberIds.length} 项`;
                headerRow.appendChild(countBadge);

                const actionsBar = document.createElement("div");
                actionsBar.className = "prompt-vault-group-actions";

                const isWholeGroupAdded = Boolean(
                    group.id && this.state.selectedTiles.some((t) => t.group_preset_id === group.id)
                );

                const toggleAddBtn = document.createElement("button");
                toggleAddBtn.type = "button";
                toggleAddBtn.className = `prompt-vault-tile-btn ${isWholeGroupAdded ? "is-starred" : ""}`;
                toggleAddBtn.title = isWholeGroupAdded ? "从中栏移出该组合" : "整组添加进中栏";
                toggleAddBtn.innerHTML = getVectorIcon(isWholeGroupAdded ? "check" : "plus", 13);
                toggleAddBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (isWholeGroupAdded) {
                        this.state.removeGroupByPresetId(group.id);
                    } else {
                        this.state.addGroup(group, entries, categories);
                    }
                });
                actionsBar.appendChild(toggleAddBtn);

                const delGroupBtn = document.createElement("button");
                delGroupBtn.type = "button";
                delGroupBtn.className = "prompt-vault-tile-btn is-danger";
                delGroupBtn.title = "解散此组合 (不删除词条)";
                delGroupBtn.innerHTML = getVectorIcon("trash", 13);
                delGroupBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (confirm(`确定要解散提示词组 [${group.title}] 吗？\n（此操作仅解散组合关系，内部词条仍保留在词库中）`)) {
                        await deleteGroup(group.id);
                    }
                });
                actionsBar.appendChild(delGroupBtn);

                headerRow.appendChild(actionsBar);

                headerRow.addEventListener("click", () => {
                    if (this.expandedGroupIds.has(group.id)) {
                        this.expandedGroupIds.delete(group.id);
                    } else {
                        this.expandedGroupIds.add(group.id);
                    }
                    this.renderList();
                });

                card.appendChild(headerRow);

                if (isExpanded) {
                    const accordionBody = document.createElement("div");
                    accordionBody.className = "prompt-vault-group-body";

                    if (memberIds.length === 0) {
                        accordionBody.innerHTML = `
              <div style="font-size:11px; color:var(--pv-text-muted); padding:6px 10px;">该组合暂无成员</div>
            `;
                    } else {
                        memberIds.forEach((eid) => {
                            const memberEntry = entryMap.get(eid);
                            if (!memberEntry) return;

                            const isMemberAdded = this.state.selectedTiles.some((t) => t.ref_preset_id === memberEntry.id);
                            const memberTileEl = createTileElement({
                                data: memberEntry,
                                mode: "vault",
                                state: this.state,
                                isActive: false,
                                isAlreadyAdded: isMemberAdded,
                                categories: categories,
                                tagsDict: tagsDict,
                                belongingGroups: [],
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
                                onJumpToGroup: null,
                            });
                            accordionBody.appendChild(memberTileEl);
                        });
                    }

                    card.appendChild(accordionBody);
                }

                this.listViewport.appendChild(card);
            });
        }

        this.footer.textContent = `提示词组共 ${groups.length} 组 (展示 ${filtered.length} 组)`;
    }
}