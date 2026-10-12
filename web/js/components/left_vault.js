/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/left_vault.js */

/**
 * 左栏：预设提示词库（Preset Vault）组件。
 * 提供分类与收藏夹双下拉联动筛选、关键词即时检索、
 * 分类与收藏夹全功能管理入口、词条二次确认删除及单击即选/反选交互。
 */

import { triggerExportPresets } from "../api.js";
import { isolateCanvasEvents, isolateWheelScroll } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";
import { createTileElement } from "./tile.js";

/**
 * 递归构建分类扁平层级下拉选项。
 * @param {any[]} categories
 * @returns {{ name: string, label: string }[]}
 */
function buildCategoryHierarchyOptions(categories) {
    const result = [{ name: "ALL", label: "全部分类" }];
    const map = new Map();
    const roots = [];

    categories.forEach((c) => {
        map.set(c.id, { ...c, children: [] });
    });

    categories.forEach((c) => {
        if (c.parent_id && map.has(c.parent_id)) {
            map.get(c.parent_id).children.push(map.get(c.id));
        } else {
            roots.push(map.get(c.id));
        }
    });

    function traverse(node, depth) {
        const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}└─ `;
        result.push({
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
     * @param {() => any[]} getPresetsCallback - 获取词库条目列表回调
     * @param {() => { categories: any[], folders: any[] }} getTaxonomiesCallback - 获取分类与收藏夹配置回调
     * @param {(preset: any) => void} onOpenPresetModalCallback - 打开词条录入弹窗回调
     * @param {(preset: any) => void} onOpenFavoriteModalCallback - 打开收藏联动弹窗回调
     * @param {() => void} onOpenTaxonomyManagerCallback - 打开分类与收藏夹管理中心回调
     * @param {(preset: any) => void} onDeletePresetCallback - 打开词条删除二次确认弹窗回调
     * @param {() => void} onImportTriggerCallback - 唤起导入文件选择回调
     */
    constructor(
        container,
        state,
        getPresetsCallback,
        getTaxonomiesCallback,
        onOpenPresetModalCallback,
        onOpenFavoriteModalCallback,
        onOpenTaxonomyManagerCallback,
        onDeletePresetCallback,
        onImportTriggerCallback
    ) {
        this.container = container;
        this.state = state;
        this.getPresets = getPresetsCallback;
        this.getTaxonomies = getTaxonomiesCallback;
        this.onOpenPresetModal = onOpenPresetModalCallback;
        this.onOpenFavoriteModal = onOpenFavoriteModalCallback;
        this.onOpenTaxonomyManager = onOpenTaxonomyManagerCallback;
        this.onDeletePreset = onDeletePresetCallback;
        this.onImportTrigger = onImportTriggerCallback;

        this.filterCategory = "ALL";
        this.filterFolder = "ALL";
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

        const newBtn = document.createElement("button");
        newBtn.type = "button";
        newBtn.className = "prompt-vault-btn prompt-vault-btn-primary";
        newBtn.innerHTML = `${renderIcon("plus", 12)} <span>新建</span>`;
        newBtn.title = "录入新词条到本地预设库";
        newBtn.addEventListener("click", () => {
            if (typeof this.onOpenPresetModal === "function") {
                this.onOpenPresetModal(null);
            }
        });
        btnGroup.appendChild(newBtn);

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
        importBtn.innerHTML = renderIcon("upload", 13);
        importBtn.title = "导入词库 JSON 包";
        importBtn.addEventListener("click", () => {
            if (typeof this.onImportTrigger === "function") {
                this.onImportTrigger();
            }
        });
        btnGroup.appendChild(importBtn);

        const exportBtn = document.createElement("button");
        exportBtn.type = "button";
        exportBtn.className = "prompt-vault-btn prompt-vault-btn-default prompt-vault-btn-icon";
        exportBtn.innerHTML = renderIcon("download", 13);
        exportBtn.title = "导出全量词库为 JSON 备份文件";
        exportBtn.addEventListener("click", () => {
            triggerExportPresets();
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

        this.folderSelect = document.createElement("select");
        this.folderSelect.className = "prompt-vault-select";
        this.folderSelect.style.flex = "1 1 0";
        this.folderSelect.addEventListener("change", () => {
            this.filterFolder = this.folderSelect.value;
            this.renderList();
        });
        filterRow.appendChild(this.folderSelect);

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
        const { categories, folders } = this.getTaxonomies();

        const catOptions = buildCategoryHierarchyOptions(categories);
        const curCat = this.filterCategory;
        this.categorySelect.innerHTML = "";
        catOptions.forEach((opt) => {
            const el = document.createElement("option");
            el.value = opt.name;
            el.textContent = opt.label;
            this.categorySelect.appendChild(el);
        });
        if (curCat && catOptions.some((o) => o.name === curCat)) {
            this.categorySelect.value = curCat;
        } else {
            this.categorySelect.value = "ALL";
            this.filterCategory = "ALL";
        }

        const curFld = this.filterFolder;
        this.folderSelect.innerHTML = `
      <option value="ALL">全部收藏夹</option>
      <option value="__UNFAVORITED__">未收藏</option>
    `;
        folders.forEach((fld) => {
            const el = document.createElement("option");
            el.value = fld.name;
            el.textContent = fld.name;
            this.folderSelect.appendChild(el);
        });
        if (curFld) {
            this.folderSelect.value = curFld;
        } else {
            this.folderSelect.value = "ALL";
            this.filterFolder = "ALL";
        }
    }

    renderList() {
        this.refreshDropdownOptions();
        const presets = this.getPresets();
        const { categories } = this.getTaxonomies();
        const selectedPresetIds = new Set(
            this.state.selectedTiles.map((t) => t.ref_preset_id).filter(Boolean)
        );

        const filtered = presets.filter((item) => {
            if (this.filterCategory !== "ALL" && item.category !== this.filterCategory) {
                return false;
            }

            if (this.filterFolder === "__UNFAVORITED__") {
                if (item.favorite) return false;
            } else if (this.filterFolder !== "ALL") {
                if (!item.favorite || item.folder !== this.filterFolder) return false;
            }

            if (this.searchKeyword) {
                const titleMatch = (item.title || "").toLowerCase().includes(this.searchKeyword);
                const promptMatch = (item.prompt || "").toLowerCase().includes(this.searchKeyword);
                const tagMatch = (item.tags || []).some((t) => t.toLowerCase().includes(this.searchKeyword));
                if (!titleMatch && !promptMatch && !tagMatch) return false;
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
            filtered.forEach((preset) => {
                const isAlreadyAdded = selectedPresetIds.has(preset.id);
                const tileElement = createTileElement({
                    data: preset,
                    mode: "vault",
                    state: this.state,
                    isActive: false,
                    isAlreadyAdded: isAlreadyAdded,
                    categoriesConfig: categories,
                    onToggleFavorite: (targetPreset) => {
                        if (typeof this.onOpenFavoriteModal === "function") {
                            this.onOpenFavoriteModal(targetPreset);
                        }
                    },
                    onDeletePreset: (targetPreset) => {
                        if (typeof this.onDeletePreset === "function") {
                            this.onDeletePreset(targetPreset);
                        }
                    },
                });
                this.listViewport.appendChild(tileElement);
            });
        }

        this.footer.textContent = `词库共 ${presets.length} 条 (展示 ${filtered.length} 条)`;
    }
}