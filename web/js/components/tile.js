/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/tile.js */

/**
 * 磁贴卡片（Tile）核心渲染组件。
 * 遵循归一化模型：普通词条与组员使用相同的数据渲染标准。
 *
 * 渲染契约：
 * - createTileElement() 只负责"建骨架 + 挂事件"，建完立即调用一次 applyTileState()；
 * - applyTileState() 是唯一把数据映射到视觉的函数，内容变更时重复调用即可，
 *   不销毁节点、不移动 DOM、不影响滚动位置与悬停状态。
 * 轨道连线由中栏的 updateSelectionVisuals() 统一填充，本模块只建空轨道容器。
 */

import { getThumbnailUrl } from "../api.js";
import { isolateCanvasEvents, isolateDragEvents } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";
import { formatWeightBadgeText } from "../utils/prompt_format.js";

let activePopoverElement = null;
let activePopoverTimer = null;
let activeJumpMenuElement = null;
/** 当前浮层（含待弹出）锚定的实例 ID，用于内容变更时精准关闭 */
let popoverTargetInstanceId = null;

function removeActivePopover() {
    if (activePopoverTimer) {
        clearTimeout(activePopoverTimer);
        activePopoverTimer = null;
    }
    if (activePopoverElement && activePopoverElement.parentNode) {
        activePopoverElement.parentNode.removeChild(activePopoverElement);
    }
    activePopoverElement = null;
    popoverTargetInstanceId = null;
}

/**
 * 若浮层正锚定在该实例上，则立即关闭。
 * 供内容局部更新前调用，避免浮层指向已变更的数据。
 * @param {string|null} instanceId
 */
export function closePopoverFor(instanceId) {
    if (instanceId && popoverTargetInstanceId === instanceId) {
        removeActivePopover();
    }
}

function removeActiveJumpMenu() {
    if (activeJumpMenuElement && activeJumpMenuElement.parentNode) {
        activeJumpMenuElement.parentNode.removeChild(activeJumpMenuElement);
    }
    activeJumpMenuElement = null;
}

document.addEventListener("click", (e) => {
    if (activeJumpMenuElement && !activeJumpMenuElement.contains(e.target)) {
        removeActiveJumpMenu();
    }
});

function showPopover(targetTile, data, categories, tagsDict) {
    removeActivePopover();

    const popover = document.createElement("div");
    popover.className = "prompt-vault-popover";

    const header = document.createElement("div");
    header.className = "prompt-vault-popover-header";

    const title = document.createElement("div");
    title.className = "prompt-vault-popover-title";
    title.textContent = data.title || "未命名词条";
    header.appendChild(title);

    const matchedCat = categories.find(
        (c) => c.id === data.categoryId || c.id === data.category_id || c.name === data.category
    );
    if (matchedCat) {
        const badge = document.createElement("span");
        badge.className = "prompt-vault-tile-badge";
        badge.textContent = matchedCat.name;
        if (matchedCat.color) {
            badge.style.backgroundColor = `${matchedCat.color}22`;
            badge.style.color = matchedCat.color;
            badge.style.borderColor = `${matchedCat.color}44`;
        }
        header.appendChild(badge);
    }
    popover.appendChild(header);

    const thumbPath = data.previewHash || data.thumbnail;
    if (thumbPath) {
        const previewBox = document.createElement("div");
        previewBox.className = "prompt-vault-popover-preview";
        const img = document.createElement("img");
        img.src = getThumbnailUrl(thumbPath);
        img.alt = "preview";
        previewBox.appendChild(img);
        popover.appendChild(previewBox);
    }

    const promptContent = data.text || data.prompt || "";
    if (promptContent) {
        const promptLabel = document.createElement("div");
        promptLabel.className = "prompt-vault-popover-section-label";
        promptLabel.textContent = "提示词";
        popover.appendChild(promptLabel);

        const promptText = document.createElement("div");
        promptText.className = "prompt-vault-popover-prompt";
        promptText.textContent = promptContent;
        popover.appendChild(promptText);
    }

    const tagIds = Array.isArray(data.tagIds) ? data.tagIds : [];
    const directTags = Array.isArray(data.tags) ? data.tags : [];
    const tagNames = [];

    tagIds.forEach((tid) => {
        const found = tagsDict.find((t) => t.id === tid);
        if (found) tagNames.push(found.name);
    });
    directTags.forEach((t) => {
        if (typeof t === "string" && !tagNames.includes(t)) tagNames.push(t);
    });

    if (tagNames.length > 0) {
        const tagLabel = document.createElement("div");
        tagLabel.className = "prompt-vault-popover-section-label";
        tagLabel.textContent = "标签";
        popover.appendChild(tagLabel);

        const tagContainer = document.createElement("div");
        tagContainer.className = "prompt-vault-popover-tags";
        tagNames.forEach((t) => {
            const tb = document.createElement("span");
            tb.className = "prompt-vault-popover-tag-badge";
            tb.textContent = t;
            tagContainer.appendChild(tb);
        });
        popover.appendChild(tagContainer);
    }

    document.body.appendChild(popover);
    activePopoverElement = popover;

    const rect = targetTile.getBoundingClientRect();
    const popoverWidth = 320;
    let left = rect.right + 10;
    let top = rect.top;

    if (left + popoverWidth > window.innerWidth - 10) {
        left = Math.max(10, rect.left - popoverWidth - 10);
    }
    if (top + popover.offsetHeight > window.innerHeight - 10) {
        top = Math.max(10, window.innerHeight - popover.offsetHeight - 10);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

function showJumpMenu(triggerEl, groups, onJumpToGroup) {
    removeActiveJumpMenu();

    const menu = document.createElement("div");
    menu.className = "prompt-vault-jump-menu";
    isolateCanvasEvents(menu);

    const header = document.createElement("div");
    header.className = "prompt-vault-jump-menu-title";
    header.textContent = "跳转至所属提示词组";
    menu.appendChild(header);

    groups.forEach((g) => {
        const item = document.createElement("div");
        item.className = "prompt-vault-jump-menu-item";
        item.innerHTML = `
          ${renderIcon("folder", 12)}
          <span class="pv-jump-name">${g.title || "未命名组合"}</span>
        `;
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            removeActiveJumpMenu();
            if (typeof onJumpToGroup === "function") {
                onJumpToGroup(g.id);
            }
        });
        menu.appendChild(item);
    });

    document.body.appendChild(menu);
    activeJumpMenuElement = menu;

    const rect = triggerEl.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
}

/* =========================================================================
   数据 → 视觉 的唯一映射
   ========================================================================= */

function applyThumbnail(thumbBox, data) {
    const path = data.previewHash || data.thumbnail || "";
    const url = path ? getThumbnailUrl(path) : "";
    const currentImg = thumbBox.querySelector("img");
    const placeholder = thumbBox.querySelector(".pv-thumb-placeholder");

    if (!url) {
        if (currentImg) currentImg.remove();
        if (!placeholder) {
            const ph = document.createElement("span");
            ph.className = "pv-thumb-placeholder";
            ph.innerHTML = renderIcon("messageSquare", 16);
            thumbBox.appendChild(ph);
        }
        return;
    }

    if (placeholder) placeholder.remove();
    if (currentImg) {
        if (currentImg.getAttribute("src") !== url) {
            currentImg.setAttribute("src", url);
            currentImg.alt = data.title || "thumbnail";
        }
        return;
    }

    const img = document.createElement("img");
    img.src = url;
    img.alt = data.title || "thumbnail";
    img.loading = "lazy";
    img.onerror = () => {
        thumbBox.innerHTML = renderIcon("messageSquare", 16);
    };
    thumbBox.appendChild(img);
}

function applyCategoryBadge(cardEl, data, categories) {
    const badge = cardEl.querySelector(".prompt-vault-tile-badge");
    if (!badge) return;

    const matched = (categories || []).find(
        (c) => c.id === data.categoryId || c.id === data.category_id || c.name === data.category
    );
    if (!matched) {
        badge.hidden = true;
        badge.textContent = "";
        return;
    }

    badge.hidden = false;
    badge.textContent = matched.name;
    if (matched.color) {
        badge.style.backgroundColor = `${matched.color}22`;
        badge.style.color = matched.color;
        badge.style.borderColor = `${matched.color}44`;
    } else {
        badge.style.backgroundColor = "";
        badge.style.color = "";
        badge.style.borderColor = "";
    }
}

/**
 * 将磁贴数据映射到已存在的 DOM 节点上。
 * 不创建/删除结构性节点（缩略图除外），因此不打断滚动、悬停与拖拽。
 * 词库模式（entry）与已选模式（tile instance）共用同一套字段回退规则。
 * @param {HTMLElement} cardEl - `.prompt-vault-tile` 元素
 * @param {any} data - 词条实体或已选磁贴实例
 * @param {{ categories?: any[] }} [ctx]
 */
export function applyTileState(cardEl, data, { categories = [] } = {}) {
    if (!cardEl || !data) return;

    const titleEl = cardEl.querySelector(".prompt-vault-tile-title");
    if (titleEl) {
        const nextTitle = data.title || "未命名词条";
        if (titleEl.textContent !== nextTitle) titleEl.textContent = nextTitle;
        titleEl.title = data.title || "";
    }

    const snippetEl = cardEl.querySelector(".prompt-vault-tile-snippet");
    if (snippetEl) {
        const nextSnippet = (data.text || data.prompt || "").replace(/[\r\n]+/g, " ");
        if (snippetEl.textContent !== nextSnippet) snippetEl.textContent = nextSnippet;
    }

    const thumbBox = cardEl.querySelector(".prompt-vault-tile-thumb");
    if (thumbBox) applyThumbnail(thumbBox, data);

    applyCategoryBadge(cardEl, data, categories);

    const dirtyBadge = cardEl.querySelector(".prompt-vault-tile-dirty-badge");
    if (dirtyBadge) dirtyBadge.hidden = !data.is_dirty;

    const weightBadge = cardEl.querySelector(".prompt-vault-tile-weight");
    if (weightBadge) {
        weightBadge.textContent = `× ${formatWeightBadgeText(data.weight == null ? 1.0 : data.weight)}`;
    }

    const isMuted = data.enabled === false;
    cardEl.classList.toggle("is-muted", isMuted);

    const muteBtn = cardEl.querySelector(".prompt-vault-tile-mute");
    if (muteBtn) {
        muteBtn.innerHTML = renderIcon(isMuted ? "eyeOff" : "eye", 13);
        muteBtn.title = isMuted ? "启用该词条" : "静音该词条 (不参与拼接)";
    }
}

/* =========================================================================
   磁贴骨架构建
   ========================================================================= */

export function createTileElement({
    data,
    mode,
    state,
    isActive = false,
    isAlreadyAdded = false,
    isMultiSelected = false,
    categories = [],
    tagsDict = [],
    belongingGroups = [],
    onToggleFavorite,
    onDeleteEntry,
    onJumpToGroup,
}) {
    const isSelectedMode = mode === "selected";
    const instanceId = isSelectedMode ? data.instance_id : null;
    const memberships = isSelectedMode && Array.isArray(data.groups) ? data.groups : [];
    const hasGroup = memberships.length > 0;

    const tile = document.createElement("div");
    tile.className = "prompt-vault-tile";
    tile.dataset.mode = mode;
    if (instanceId) tile.dataset.instanceId = instanceId;
    if (!isSelectedMode && data.id) tile.dataset.entryId = data.id;
    if (isActive) tile.classList.add("is-active");
    if (isMultiSelected) tile.classList.add("is-multi-selected");
    if (!isSelectedMode && isAlreadyAdded) tile.classList.add("is-vault-selected");

    isolateCanvasEvents(tile);

    // 鼠标移入：建立临时预览（仍含上一次聚焦组则保持，否则切到本磁贴的首个归属组并记住）
    tile.addEventListener("mouseenter", () => {
        if (isSelectedMode) {
            state.beginHoverPreview(data);
        }
        if (activePopoverTimer) clearTimeout(activePopoverTimer);
        popoverTargetInstanceId = instanceId;
        activePopoverTimer = setTimeout(() => {
            showPopover(tile, data, categories, tagsDict);
        }, 450);
    });

    // 鼠标移出：结束预览（回落到上一次聚焦），并关闭浮层
    tile.addEventListener("mouseleave", () => {
        if (isSelectedMode) {
            state.endHoverPreview();
        }
        removeActivePopover();
    });

    tile.addEventListener("click", (event) => {
        removeActivePopover();
        if (event.target.closest(".prompt-vault-tile-actions")) return;
        if (event.target.closest(".prompt-vault-group-indicator")) return;

        if (isSelectedMode) {
            if (event.shiftKey) {
                state.toggleMultiSelect(instanceId);
            } else {
                state.setActiveTile(instanceId);
            }
        } else {
            // 词库模式：纯粹点击添加，再次点击取消添加
            const existing = state.selectedTiles.find((t) => t.ref_preset_id === data.id);
            if (existing) {
                state.removeTile(existing.instance_id);
            } else {
                state.addTileFromEntry(data, categories);
            }
        }
    });

    const thumbBox = document.createElement("div");
    thumbBox.className = "prompt-vault-tile-thumb";
    tile.appendChild(thumbBox);

    const infoBox = document.createElement("div");
    infoBox.className = "prompt-vault-tile-info";

    const titleRow = document.createElement("div");
    titleRow.className = "prompt-vault-tile-title-row";

    if (isSelectedMode && memberships.length > 0) {
        memberships.slice(0, 3).forEach((membership) => {
            const dot = document.createElement("span");
            dot.className = "prompt-vault-tile-group-dot";
            dot.style.color = membership.color;
            dot.style.backgroundColor = membership.color;
            dot.title = membership.title ? `所属组合：${membership.title}` : "组合成员";
            titleRow.appendChild(dot);
        });
    }

    const titleText = document.createElement("span");
    titleText.className = "prompt-vault-tile-title";
    titleRow.appendChild(titleText);

    // 词条视图：极简微型跳转标记
    if (!isSelectedMode && Array.isArray(belongingGroups) && belongingGroups.length > 0) {
        const indicator = document.createElement("span");
        indicator.className = "prompt-vault-group-indicator";
        indicator.innerHTML = renderIcon("link", 11);
        indicator.title = belongingGroups.length === 1
            ? `所属组合：${belongingGroups[0].title} (点击跳转)`
            : `属于 ${belongingGroups.length} 个组合 (点击选择跳转)`;

        indicator.addEventListener("click", (e) => {
            e.stopPropagation();
            removeActivePopover();
            if (belongingGroups.length === 1) {
                if (typeof onJumpToGroup === "function") {
                    onJumpToGroup(belongingGroups[0].id);
                }
            } else {
                showJumpMenu(indicator, belongingGroups, onJumpToGroup);
            }
        });
        titleRow.appendChild(indicator);
    }

    const catBadge = document.createElement("span");
    catBadge.className = "prompt-vault-tile-badge";
    catBadge.hidden = true;
    titleRow.appendChild(catBadge);

    const dirtyBadge = document.createElement("span");
    dirtyBadge.className = "prompt-vault-tile-dirty-badge";
    dirtyBadge.textContent = "已修改";
    dirtyBadge.hidden = true;
    titleRow.appendChild(dirtyBadge);

    infoBox.appendChild(titleRow);

    const snippet = document.createElement("div");
    snippet.className = "prompt-vault-tile-snippet";
    infoBox.appendChild(snippet);
    tile.appendChild(infoBox);

    // 悬浮胶囊动作条：悬停时呈现半透明圆角药丸浮层
    const actionsBar = document.createElement("div");
    actionsBar.className = "prompt-vault-tile-actions";

    if (isSelectedMode) {
        const weightBadge = document.createElement("div");
        weightBadge.className = "prompt-vault-tile-weight";
        weightBadge.title = "滚轮上下滚动调节权重 (步长 0.1)";

        weightBadge.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                event.stopPropagation();
                const delta = event.deltaY < 0 ? 0.1 : -0.1;
                state.adjustTileWeight(instanceId, delta);
            },
            { passive: false }
        );
        actionsBar.appendChild(weightBadge);

        const muteBtn = document.createElement("button");
        muteBtn.type = "button";
        muteBtn.className = "prompt-vault-tile-btn prompt-vault-tile-mute";
        muteBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            state.toggleTileEnabled(instanceId);
        });
        actionsBar.appendChild(muteBtn);
    }

    if (!isSelectedMode) {
        const starBtn = document.createElement("button");
        starBtn.type = "button";
        starBtn.className = "prompt-vault-tile-btn";
        const isFavorited = (Array.isArray(data.collections) && data.collections.length > 0) || Boolean(data.favorite);
        if (isFavorited) starBtn.classList.add("is-starred");
        starBtn.title = isFavorited ? "已收藏" : "加入收藏夹";
        starBtn.innerHTML = renderIcon(isFavorited ? "starFilled" : "star", 13);
        starBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            removeActivePopover();
            if (typeof onToggleFavorite === "function") {
                onToggleFavorite(data);
            }
        });
        actionsBar.appendChild(starBtn);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "prompt-vault-tile-btn";
    copyBtn.title = "复制完整 Prompt 到剪贴板";
    copyBtn.innerHTML = renderIcon("copy", 13);
    copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
            const copyContent = data.text || data.prompt || "";
            await navigator.clipboard.writeText(copyContent);
            copyBtn.innerHTML = renderIcon("check", 13);
            setTimeout(() => {
                copyBtn.innerHTML = renderIcon("copy", 13);
            }, 1000);
        } catch (err) {
            console.error("[PromptVault] Failed to copy to clipboard:", err);
        }
    });
    actionsBar.appendChild(copyBtn);

    if (!isSelectedMode) {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "prompt-vault-tile-btn is-danger";
        deleteBtn.title = "从词库中删除此词条";
        deleteBtn.innerHTML = renderIcon("trash", 13);
        deleteBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            removeActivePopover();
            if (typeof onDeleteEntry === "function") {
                onDeleteEntry(data);
            }
        });
        actionsBar.appendChild(deleteBtn);
    }

    if (isSelectedMode) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "prompt-vault-tile-btn is-danger";
        removeBtn.title = hasGroup
            ? "移出该词条 (不影响同组其它词条)"
            : "移出已选列表";
        removeBtn.innerHTML = renderIcon("x", 13);
        removeBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            removeActivePopover();
            state.removeTile(instanceId);
        });
        actionsBar.appendChild(removeBtn);
    }

    tile.appendChild(actionsBar);

    // 骨架建完后统一填充一次，之后内容变更只需重复调用 applyTileState
    applyTileState(tile, data, { categories });

    if (!isSelectedMode) {
        return tile;
    }

    const row = document.createElement("div");
    row.className = "prompt-vault-tile-row";
    row.dataset.instanceId = instanceId;

    // 轨道容器留空，由中栏 updateSelectionVisuals() 统一渲染角色
    const trackElement = document.createElement("div");
    trackElement.className = "prompt-vault-tile-track";

    row.appendChild(trackElement);
    row.appendChild(tile);

    row.setAttribute("draggable", "true");
    isolateDragEvents(row);

    row.addEventListener("dragstart", (event) => {
        removeActivePopover();
        row.classList.add("is-dragging");
        tile.classList.add("is-dragging");

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";

            if (state.isMultiSelected(instanceId) && state.multiSelectedIds.size > 1) {
                const batchPayload = JSON.stringify({
                    type: "batch_move",
                    ids: Array.from(state.multiSelectedIds),
                });
                event.dataTransfer.setData("application/json", batchPayload);
                event.dataTransfer.setData("text/plain", instanceId);
            } else {
                event.dataTransfer.setData("text/plain", instanceId);
            }
        }
    });

    row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        tile.classList.remove("is-dragging");
    });

    row.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (event.clientY < midY) {
            row.classList.add("drag-over-top");
            row.classList.remove("drag-over-bottom");
        } else {
            row.classList.add("drag-over-bottom");
            row.classList.remove("drag-over-top");
        }
    });

    row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over-top", "drag-over-bottom");
    });

    row.addEventListener("drop", (event) => {
        event.preventDefault();
        row.classList.remove("drag-over-top", "drag-over-bottom");
        if (!event.dataTransfer) return;

        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const position = event.clientY < midY ? "before" : "after";

        let batchData = null;
        try {
            const rawJson = event.dataTransfer.getData("application/json");
            if (rawJson) batchData = JSON.parse(rawJson);
        } catch (err) {
            batchData = null;
        }

        if (batchData && batchData.type === "batch_move" && Array.isArray(batchData.ids)) {
            state.reorderTilesBatch(batchData.ids, instanceId, position);
        } else {
            const sourceId = event.dataTransfer.getData("text/plain");
            if (!sourceId || sourceId === instanceId) return;

            if (state.isMultiSelected(sourceId) && state.multiSelectedIds.size > 1) {
                state.reorderTilesBatch(Array.from(state.multiSelectedIds), instanceId, position);
            } else {
                const fromIndex = state.selectedTiles.findIndex((t) => t.instance_id === sourceId);
                const toIndex = state.selectedTiles.findIndex((t) => t.instance_id === instanceId);
                if (fromIndex !== -1 && toIndex !== -1) {
                    state.reorderTiles(fromIndex, toIndex);
                }
            }
        }
    });

    return row;
}
