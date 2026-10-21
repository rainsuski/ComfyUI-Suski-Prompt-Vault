/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/middle_selected.js */

/**
 * 中栏：已选提示词列表（Selected Prompts）组件。
 * 展示当前节点已选装配的磁贴序列、计算活跃聚焦组几何连线区间、
 * 呈现单行防塌陷多选批量操作条、集成悬停延时防抖避免缝隙闪烁。
 *
 * 渲染策略（按通道分流，避免无关重建）：
 * - structure → 重建行结构（保留滚动位置），重建后统一由 updateSelectionVisuals 填充轨道；
 * - selection → 只切换 class 与轨道，不触碰 DOM 结构；
 * - content   → 只对目标行调用 applyTileState，不重建、不移动节点；
 * - library   → 就地刷新全部行的字段（分类改名等），同样不重建。
 */

import { CHANNEL, findMembership } from "../state.js";
import { isolateCanvasEvents, isolateWheelScroll } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";
import { SaveGroupModalManager } from "./modal.js";
import { applyTileState, closePopoverFor, createTileElement } from "./tile.js";

export class MiddleSelectedComponent {
    /**
     * @param {HTMLElement} container - 中栏宿主 DOM 容器
     * @param {import("../state.js").VaultNodeState} state - 状态机实例
     * @param {() => { categories: any[], entries?: any[], groups?: any[] } | any[]} getLibraryCallback
     * @param {(tileDraft: any) => void} onSaveToVaultCallback
     * @param {() => Promise<void>} [onLibraryRefreshCallback]
     */
    constructor(
        container,
        state,
        getLibraryCallback,
        onSaveToVaultCallback,
        onLibraryRefreshCallback
    ) {
        this.container = container;
        this.state = state;
        this.getLibrary = getLibraryCallback;
        this.onSaveToVault = onSaveToVaultCallback;
        this.onLibraryRefresh = onLibraryRefreshCallback;
        this.searchKeyword = "";

        this.groupModalManager = new SaveGroupModalManager(
            this.getLibrary,
            async () => {
                if (typeof this.onLibraryRefresh === "function") {
                    await this.onLibraryRefresh();
                }
            }
        );

        this.initDOM();

        this.state.on(CHANNEL.STRUCTURE, () => this.renderList());
        this.state.on(CHANNEL.SELECTION, () => this.updateSelectionVisuals());
        this.state.on(CHANNEL.CONTENT, (detail) => this.patchTile(detail && detail.instanceId));
        this.state.on(CHANNEL.LIBRARY, () => this.refreshAllRows());

        this.state.subscribeFocus(() => {
            this.updateHoverTrackVisuals();
        });
    }

    getCategoriesConfig() {
        const lib = typeof this.getLibrary === "function" ? this.getLibrary() : {};
        if (Array.isArray(lib)) return lib;
        return lib.categories || [];
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
        title.innerHTML = `${renderIcon("grid", 14)} <span>已选提示词</span>`;
        titleBar.appendChild(title);

        const addEmptyBtn = document.createElement("button");
        addEmptyBtn.type = "button";
        addEmptyBtn.className = "prompt-vault-btn prompt-vault-btn-default";
        addEmptyBtn.innerHTML = `${renderIcon("plus", 12)} <span>添加空词条</span>`;
        addEmptyBtn.title = "在已选列表中插入一个临时空白草稿词条";
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
        searchInput.placeholder = "过滤已选词条关键词...";
        searchInput.addEventListener("input", () => {
            this.searchKeyword = searchInput.value.trim().toLowerCase();
            this.renderList();
        });
        filterRow.appendChild(searchInput);

        header.appendChild(filterRow);
        this.container.appendChild(header);

        // 2. 批量操作挂载容器
        this.batchBarContainer = document.createElement("div");
        this.container.appendChild(this.batchBarContainer);

        // 3. 磁贴列表滚动视口
        this.listViewport = document.createElement("div");
        this.listViewport.className = "prompt-vault-list-viewport";
        isolateWheelScroll(this.listViewport);
        isolateCanvasEvents(this.listViewport);
        this.container.appendChild(this.listViewport);

        // 4. 底部信息与清空操作条
        this.footer = document.createElement("div");
        this.footer.className = "prompt-vault-col-footer";

        this.statusText = document.createElement("span");
        this.footer.appendChild(this.statusText);

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "prompt-vault-btn prompt-vault-btn-danger";
        clearBtn.style.height = "24px";
        clearBtn.style.padding = "0 8px";
        clearBtn.innerHTML = `${renderIcon("trash", 12)} <span>清空已选</span>`;
        clearBtn.title = "立即清空全部已选词条";
        clearBtn.addEventListener("click", () => {
            this.state.clearAllTiles();
        });
        this.footer.appendChild(clearBtn);

        this.container.appendChild(this.footer);

        this.renderList();
    }

    renderBatchBar() {
        const multiCount = this.state.multiSelectedIds.size;
        const currentBatchBar = this.batchBarContainer.querySelector(".prompt-vault-batch-bar");

        if (multiCount < 2) {
            this.batchBarContainer.innerHTML = "";
            return;
        }

        if (currentBatchBar) {
            const countLabel = currentBatchBar.querySelector(".prompt-vault-batch-bar-left span");
            if (countLabel) {
                countLabel.textContent = `已选 ${multiCount} 项`;
            }
            return;
        }

        const batchBar = document.createElement("div");
        batchBar.className = "prompt-vault-batch-bar";

        const leftSide = document.createElement("div");
        leftSide.className = "prompt-vault-batch-bar-left";
        leftSide.innerHTML = `${renderIcon("grid", 13)} <span>已选 ${multiCount} 项</span>`;
        batchBar.appendChild(leftSide);

        const rightSide = document.createElement("div");
        rightSide.className = "prompt-vault-batch-bar-right";

        const saveGroupBtn = document.createElement("button");
        saveGroupBtn.type = "button";
        saveGroupBtn.className = "prompt-vault-btn prompt-vault-btn-primary";
        saveGroupBtn.style.height = "24px";
        saveGroupBtn.style.padding = "0 8px";
        saveGroupBtn.style.fontSize = "11px";
        saveGroupBtn.innerHTML = `${renderIcon("folder", 11)} <span>存为提示词组</span>`;
        saveGroupBtn.title = "将当前选中的词条序列就地打包存为组合模板";
        saveGroupBtn.addEventListener("click", () => {
            const selectedTiles = this.state.getMultiSelectedTiles();
            this.groupModalManager.open(selectedTiles, this.state);
        });
        rightSide.appendChild(saveGroupBtn);

        const batchDelBtn = document.createElement("button");
        batchDelBtn.type = "button";
        batchDelBtn.className = "prompt-vault-btn prompt-vault-btn-danger";
        batchDelBtn.style.height = "24px";
        batchDelBtn.style.padding = "0 6px";
        batchDelBtn.style.fontSize = "11px";
        batchDelBtn.innerHTML = `${renderIcon("trash", 11)} <span>删除所选</span>`;
        batchDelBtn.title = "批量移除选中的词条";
        batchDelBtn.addEventListener("click", () => {
            this.state.removeMultiSelectedTiles();
        });
        rightSide.appendChild(batchDelBtn);

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "prompt-vault-btn prompt-vault-btn-default";
        cancelBtn.style.height = "24px";
        cancelBtn.style.padding = "0 6px";
        cancelBtn.style.fontSize = "11px";
        cancelBtn.innerHTML = renderIcon("x", 11);
        cancelBtn.title = "取消多选";
        cancelBtn.addEventListener("click", () => {
            this.state.clearMultiSelect();
        });
        rightSide.appendChild(cancelBtn);

        batchBar.appendChild(rightSide);
        this.batchBarContainer.appendChild(batchBar);
    }

    /**
     * 按当前聚焦组重算每行的轨道角色与高亮。
     * 这是轨道渲染的唯一实现：重建后、选中变化、聚焦变化都走这里，避免多套逻辑漂移。
     */
    updateHoverTrackVisuals() {
        const tiles = this.state.selectedTiles;
        const displayGroupId = this.state.getRenderableFocusGroupId();

        let groupMinIdx = -1;
        let groupMaxIdx = -1;
        let focusedGroupColor = null;

        if (displayGroupId) {
            const memberIndices = [];
            tiles.forEach((t, idx) => {
                const membership = findMembership(t, displayGroupId);
                if (!membership) return;
                memberIndices.push(idx);
                if (!focusedGroupColor && membership.color) {
                    focusedGroupColor = membership.color;
                }
            });

            if (memberIndices.length > 0) {
                groupMinIdx = Math.min(...memberIndices);
                groupMaxIdx = Math.max(...memberIndices);
            }
        }

        const rows = this.listViewport.querySelectorAll(".prompt-vault-tile-row");
        rows.forEach((row) => {
            const instanceId = row.dataset.instanceId;
            const tile = tiles.find((t) => t.instance_id === instanceId);
            if (!tile) return;

            const actualIndex = tiles.indexOf(tile);
            const membership = displayGroupId ? findMembership(tile, displayGroupId) : null;
            const isMemberOfFocusedGroup = Boolean(membership);

            let trackRole = "none";
            if (displayGroupId && groupMinIdx !== -1 && groupMaxIdx !== -1) {
                if (actualIndex >= groupMinIdx && actualIndex <= groupMaxIdx) {
                    if (actualIndex === groupMinIdx) {
                        trackRole = "first";
                    } else if (actualIndex === groupMaxIdx) {
                        trackRole = "last";
                    } else if (isMemberOfFocusedGroup) {
                        trackRole = "branch";
                    } else {
                        trackRole = "pass";
                    }
                }
            }

            const card = row.querySelector(".prompt-vault-tile");
            if (card) {
                card.classList.toggle("is-group-active-member", isMemberOfFocusedGroup);
            }

            const finalColor = focusedGroupColor || (membership ? membership.color : null);
            if (finalColor) {
                row.style.setProperty("--pv-group-color", finalColor);
                row.style.setProperty("--pv-group-glow", `${finalColor}44`);
            }

            const track = row.querySelector(".prompt-vault-tile-track");
            if (track) {
                track.innerHTML = "";
                track.className = "prompt-vault-tile-track";

                if (trackRole === "first") {
                    track.appendChild(this.buildTrackPart("prompt-vault-track-v-bottom"));
                    track.appendChild(this.buildTrackPart("prompt-vault-track-h-branch"));
                    track.appendChild(this.buildTrackPart("prompt-vault-track-dot-anchor"));
                } else if (trackRole === "branch") {
                    track.appendChild(this.buildTrackPart("prompt-vault-track-v-full"));
                    track.appendChild(this.buildTrackPart("prompt-vault-track-h-branch"));
                    track.appendChild(this.buildTrackPart("prompt-vault-track-dot-anchor"));
                } else if (trackRole === "last") {
                    track.appendChild(this.buildTrackPart("prompt-vault-track-v-top"));
                    track.appendChild(this.buildTrackPart("prompt-vault-track-h-branch"));
                    track.appendChild(this.buildTrackPart("prompt-vault-track-dot-anchor"));
                } else if (trackRole === "pass") {
                    track.classList.add("prompt-vault-track-pass");
                    track.appendChild(this.buildTrackPart("prompt-vault-track-v-full"));
                }
            }
        });
    }

    buildTrackPart(className) {
        const el = document.createElement("div");
        el.className = className;
        return el;
    }

    /**
     * 选择集或激活项变化时的轻量刷新：只切 class、重算轨道、更新批量条与状态栏。
     */
    updateSelectionVisuals() {
        this.renderBatchBar();

        const activeId = this.state.activeInstanceId;
        this.listViewport.querySelectorAll(".prompt-vault-tile-row").forEach((row) => {
            const card = row.querySelector(".prompt-vault-tile");
            if (!card) return;
            const instanceId = row.dataset.instanceId;
            card.classList.toggle("is-active", instanceId === activeId);
            card.classList.toggle("is-multi-selected", this.state.isMultiSelected(instanceId));
        });

        this.updateHoverTrackVisuals();
        this.updateStatusText();
    }

    /**
     * 单条内容变更：只刷新目标行，不重建列表。
     * @param {string|null} instanceId
     */
    patchTile(instanceId) {
        if (!instanceId) return;

        closePopoverFor(instanceId);

        const row = this.listViewport.querySelector(
            `[data-instance-id="${CSS.escape(instanceId)}"]`
        );
        const tile = this.state.selectedTiles.find((t) => t.instance_id === instanceId);
        if (row && tile) {
            const card = row.querySelector(".prompt-vault-tile");
            if (card) applyTileState(card, tile, { categories: this.getCategoriesConfig() });
        }

        this.updateStatusText();
    }

    /**
     * 词库侧数据变化（分类改名、缩略图更新等）：就地刷新全部行字段，不重建。
     */
    refreshAllRows() {
        const categories = this.getCategoriesConfig();
        this.listViewport.querySelectorAll(".prompt-vault-tile-row").forEach((row) => {
            const tile = this.state.selectedTiles.find((t) => t.instance_id === row.dataset.instanceId);
            const card = row.querySelector(".prompt-vault-tile");
            if (tile && card) applyTileState(card, tile, { categories });
        });
    }

    updateStatusText() {
        const tiles = this.state.selectedTiles;
        const enabledCount = tiles.filter((t) => t.enabled !== false).length;
        const multiCount = this.state.multiSelectedIds.size;
        const multiSuffix = multiCount > 0 ? ` (已多选 ${multiCount} 项)` : "";
        this.statusText.textContent = `${enabledCount} 项启用 / 共 ${tiles.length} 项${multiSuffix}`;
    }

    renderList() {
        const prevScrollTop = this.listViewport.scrollTop;

        const tiles = this.state.selectedTiles;
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
          <div style="font-size:11px; opacity:0.7;">从左侧词库点击词条即可加入，或点击上方添加空词条</div>
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
                const tileRowElement = createTileElement({
                    data: tile,
                    mode: "selected",
                    state: this.state,
                    categories: categoriesConfig,
                    tagsDict: [],
                    belongingGroups: [],
                    onToggleFavorite: null,
                    onDeleteEntry: null,
                    onJumpToGroup: null,
                });
                this.listViewport.appendChild(tileRowElement);
            });
        }

        this.listViewport.scrollTop = prevScrollTop;
        this.updateSelectionVisuals();
    }
}
