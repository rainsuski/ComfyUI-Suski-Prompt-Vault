/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/middle_selected.js */

/**
 * 中栏：已选提示词列表（Selected Prompts）组件。
 * 展示当前节点已选装配的磁贴序列、支持 HTML5 拖拽排序、
 * 快捷新增空词条、一键免确认清空与全量矢量图标呈现。
 */

import { isolateCanvasEvents, isolateWheelScroll } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";
import { createTileElement } from "./tile.js";

export class MiddleSelectedComponent {
    /**
     * @param {HTMLElement} container - 中栏宿主 DOM 容器
     * @param {import("../state.js").VaultNodeState} state - 状态机实例
     * @param {() => any[]} getCategoriesConfigCallback - 获取分类元数据回调
     * @param {(tileDraft: any) => void} onSaveToVaultCallback - 保存到词库回调
     */
    constructor(container, state, getCategoriesConfigCallback, onSaveToVaultCallback) {
        this.container = container;
        this.state = state;
        this.getCategoriesConfig = getCategoriesConfigCallback;
        this.onSaveToVault = onSaveToVaultCallback;
        this.searchKeyword = "";

        this.initDOM();
        this.state.subscribe(() => this.renderList());
    }

    /**
     * 初始化中栏外层结构与头部工具栏。
     */
    initDOM() {
        this.container.innerHTML = "";

        // 1. 头部区域
        const header = document.createElement("div");
        header.className = "prompt-vault-col-header";

        // 标题行与新建空词条
        const titleBar = document.createElement("div");
        titleBar.className = "prompt-vault-header-title-bar";

        const title = document.createElement("span");
        title.className = "prompt-vault-col-title";
        title.innerHTML = `${renderIcon("grid", 14)} <span>已选提示词</span>`;
        titleBar.appendChild(title);

        const addEmptyBtn = document.createElement("button");
        addEmptyBtn.type = "button";
        addEmptyBtn.className = "prompt-vault-btn prompt-vault-btn-default";
        addEmptyBtn.innerHTML = `${renderIcon("plus", 12)} <span>添加空词条</span>`;
        addEmptyBtn.title = "在已选列表中插入一个临时空白草稿磁贴";
        addEmptyBtn.addEventListener("click", () => {
            this.state.addEmptyTile();
        });
        titleBar.appendChild(addEmptyBtn);

        header.appendChild(titleBar);

        // 搜索过滤控制行
        const filterRow = document.createElement("div");
        filterRow.className = "prompt-vault-toolbar-row";

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "prompt-vault-input prompt-vault-search-box";
        searchInput.placeholder = "过滤已选磁贴关键词...";
        searchInput.addEventListener("input", () => {
            this.searchKeyword = searchInput.value.trim().toLowerCase();
            this.renderList();
        });
        filterRow.appendChild(searchInput);

        header.appendChild(filterRow);
        this.container.appendChild(header);

        // 2. 磁贴列表滚动视口
        this.listViewport = document.createElement("div");
        this.listViewport.className = "prompt-vault-list-viewport";
        isolateWheelScroll(this.listViewport);
        isolateCanvasEvents(this.listViewport);
        this.container.appendChild(this.listViewport);

        // 3. 底部信息与即时清空操作条（免二次确认）
        this.footer = document.createElement("div");
        this.footer.className = "prompt-vault-col-footer";

        this.statusText = document.createElement("span");
        this.footer.appendChild(this.statusText);

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "prompt-vault-btn prompt-vault-btn-danger";
        clearBtn.style.height = "22px";
        clearBtn.style.padding = "0 8px";
        clearBtn.innerHTML = `${renderIcon("trash", 12)} <span>清空已选</span>`;
        clearBtn.title = "立即清空全部已选磁贴";
        clearBtn.addEventListener("click", () => {
            // 立即清空，无需二次确认弹窗
            this.state.clearAllTiles();
        });
        this.footer.appendChild(clearBtn);

        this.container.appendChild(this.footer);

        this.renderList();
    }

    /**
     * 重新渲染已选磁贴列表。
     */
    renderList() {
        const tiles = this.state.selectedTiles;
        const activeTileId = this.state.activeInstanceId;
        const categoriesConfig = this.getCategoriesConfig();

        const filtered = tiles.filter((tile) => {
            if (!this.searchKeyword) return true;
            const titleMatch = (tile.title || "").toLowerCase().includes(this.searchKeyword);
            const promptMatch = (tile.prompt || "").toLowerCase().includes(this.searchKeyword);
            return titleMatch || promptMatch;
        });

        this.listViewport.innerHTML = "";

        if (tiles.length === 0) {
            this.listViewport.innerHTML = `
        <div class="prompt-vault-empty-state">
          <div class="prompt-vault-empty-icon">${renderIcon("messageSquare", 28)}</div>
          <div>未选择提示词</div>
          <div style="font-size:11px; opacity:0.7;">从左侧词库点击磁贴即可加入，或点击上方添加空词条</div>
        </div>
      `;
        } else if (filtered.length === 0) {
            this.listViewport.innerHTML = `
        <div class="prompt-vault-empty-state">
          <div>未找到匹配项</div>
        </div>
      `;
        } else {
            filtered.forEach((tile) => {
                const isActive = tile.instance_id === activeTileId;
                const tileElement = createTileElement({
                    data: tile,
                    mode: "selected",
                    state: this.state,
                    isActive: isActive,
                    isAlreadyAdded: false,
                    categoriesConfig: categoriesConfig,
                    onToggleFavorite: null,
                });
                this.listViewport.appendChild(tileElement);
            });
        }

        // 更新底部统计
        const enabledCount = tiles.filter((t) => t.enabled !== false).length;
        this.statusText.textContent = `${enabledCount} 项启用 / 共 ${tiles.length} 项`;
    }
}