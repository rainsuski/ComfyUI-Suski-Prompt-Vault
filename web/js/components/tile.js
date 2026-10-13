/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/tile.js */

/**
 * 磁贴卡片（Tile）核心渲染组件。
 * 对齐 aaalice-prompt-library v2 数据标准，
 * 支持单轨几何树状连线、微光锚点转角、Shift 多选防焦点切换、
 * 批量拖拽打包、组员常态呼吸圆点、词库组合模板徽章、词库点击整组反选与延时悬浮详情预览。
 */

import { getThumbnailUrl } from "../api.js";
import { isolateCanvasEvents, isolateDragEvents } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";
import { formatWeightBadgeText } from "../utils/prompt_format.js";

let activePopoverElement = null;
let activePopoverTimer = null;

function removeActivePopover() {
    if (activePopoverTimer) {
        clearTimeout(activePopoverTimer);
        activePopoverTimer = null;
    }
    if (activePopoverElement && activePopoverElement.parentNode) {
        activePopoverElement.parentNode.removeChild(activePopoverElement);
    }
    activePopoverElement = null;
}

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

    const isGroup = (Array.isArray(data.groupMembers) && data.groupMembers.length > 0) ||
        (Array.isArray(data.members) && data.members.length > 0);

    if (isGroup) {
        const groupBadge = document.createElement("span");
        groupBadge.className = "prompt-vault-tile-group-badge";
        const memberCount = (data.groupMembers || data.members).length;
        groupBadge.textContent = `组合模板 (${memberCount} 项)`;
        header.appendChild(groupBadge);
    } else {
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

    if (isGroup) {
        const memberLabel = document.createElement("div");
        memberLabel.className = "prompt-vault-popover-section-label";
        memberLabel.textContent = "包含组员定义";
        popover.appendChild(memberLabel);

        const listContainer = document.createElement("div");
        listContainer.className = "prompt-vault-popover-prompt";
        const members = data.groupMembers || data.members;
        listContainer.textContent = members.map((m, i) => `${i + 1}. [${m.title}] ${m.text || m.prompt}`).join("\n");
        popover.appendChild(listContainer);
    } else {
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

function createTrackElement(trackRole) {
    const track = document.createElement("div");
    track.className = "prompt-vault-tile-track";

    if (trackRole === "none") {
        return track;
    }

    if (trackRole === "first") {
        const vBottom = document.createElement("div");
        vBottom.className = "prompt-vault-track-v-bottom";
        const hBranch = document.createElement("div");
        hBranch.className = "prompt-vault-track-h-branch";
        const anchor = document.createElement("div");
        anchor.className = "prompt-vault-track-dot-anchor";

        track.appendChild(vBottom);
        track.appendChild(hBranch);
        track.appendChild(anchor);
    } else if (trackRole === "branch") {
        const vFull = document.createElement("div");
        vFull.className = "prompt-vault-track-v-full";
        const hBranch = document.createElement("div");
        hBranch.className = "prompt-vault-track-h-branch";
        const anchor = document.createElement("div");
        anchor.className = "prompt-vault-track-dot-anchor";

        track.appendChild(vFull);
        track.appendChild(hBranch);
        track.appendChild(anchor);
    } else if (trackRole === "last") {
        const vTop = document.createElement("div");
        vTop.className = "prompt-vault-track-v-top";
        const hBranch = document.createElement("div");
        hBranch.className = "prompt-vault-track-h-branch";
        const anchor = document.createElement("div");
        anchor.className = "prompt-vault-track-dot-anchor";

        track.appendChild(vTop);
        track.appendChild(hBranch);
        track.appendChild(anchor);
    } else if (trackRole === "pass") {
        track.classList.add("prompt-vault-track-pass");
        const vFull = document.createElement("div");
        vFull.className = "prompt-vault-track-v-full";
        track.appendChild(vFull);
    }

    return track;
}

export function createTileElement({
    data,
    mode,
    state,
    isActive = false,
    isAlreadyAdded = false,
    isMultiSelected = false,
    categories = [],
    tagsDict = [],
    onToggleFavorite,
    onDeleteEntry,
    trackRole = "none",
    groupColor = null,
    isGroupActiveMember = false,
}) {
    const isSelectedMode = mode === "selected";
    const instanceId = isSelectedMode ? data.instance_id : null;
    const isMuted = isSelectedMode && data.enabled === false;
    const isDirty = isSelectedMode && Boolean(data.is_dirty);
    const hasGroup = Boolean(data.group_id);

    const isVaultGroupTemplate = !isSelectedMode && (
        (Array.isArray(data.groupMembers) && data.groupMembers.length > 0) ||
        (Array.isArray(data.members) && data.members.length > 0)
    );

    const tile = document.createElement("div");
    tile.className = "prompt-vault-tile";
    if (isActive) tile.classList.add("is-active");
    if (isMultiSelected) tile.classList.add("is-multi-selected");
    if (isMuted) tile.classList.add("is-muted");
    if (!isSelectedMode && isAlreadyAdded) tile.classList.add("is-vault-selected");
    if (isGroupActiveMember) tile.classList.add("is-group-active-member");

    tile.dataset.mode = mode;
    if (instanceId) tile.dataset.instanceId = instanceId;

    isolateCanvasEvents(tile);

    tile.addEventListener("mouseenter", () => {
        if (isSelectedMode && data.group_id) {
            state.setHoveredGroupId(data.group_id);
        }
        if (activePopoverTimer) clearTimeout(activePopoverTimer);
        activePopoverTimer = setTimeout(() => {
            showPopover(tile, data, categories, tagsDict);
        }, 450);
    });

    tile.addEventListener("mouseleave", () => {
        if (isSelectedMode && data.group_id) {
            state.setHoveredGroupId(null);
        }
        removeActivePopover();
    });

    tile.addEventListener("click", (event) => {
        removeActivePopover();
        if (event.target.closest(".prompt-vault-tile-actions")) return;

        if (isSelectedMode) {
            if (event.shiftKey) {
                state.toggleMultiSelect(instanceId);
            } else {
                state.setActiveTile(instanceId);
            }
        } else {
            if (isVaultGroupTemplate) {
                const existingGroupMember = state.selectedTiles.find(
                    (t) => t.ref_preset_id === data.id
                );
                if (existingGroupMember) {
                    state.removeGroupByPresetId(data.id);
                } else {
                    state.addGroupFromEntry(data, categories);
                }
            } else {
                const existing = state.selectedTiles.find((t) => t.ref_preset_id === data.id);
                if (existing) {
                    state.removeTile(existing.instance_id);
                } else {
                    state.addTileFromEntry(data, categories);
                }
            }
        }
    });

    const thumbBox = document.createElement("div");
    thumbBox.className = "prompt-vault-tile-thumb";
    const thumbPath = data.previewHash || data.thumbnail;
    if (thumbPath) {
        const img = document.createElement("img");
        img.src = getThumbnailUrl(thumbPath);
        img.alt = data.title || "thumbnail";
        img.loading = "lazy";
        img.onerror = () => {
            thumbBox.innerHTML = renderIcon("messageSquare", 16);
        };
        thumbBox.appendChild(img);
    } else {
        thumbBox.innerHTML = renderIcon("messageSquare", 16);
    }
    tile.appendChild(thumbBox);

    const infoBox = document.createElement("div");
    infoBox.className = "prompt-vault-tile-info";

    const titleRow = document.createElement("div");
    titleRow.className = "prompt-vault-tile-title-row";

    if (isSelectedMode && hasGroup && data.group_color) {
        const dot = document.createElement("span");
        dot.className = "prompt-vault-tile-group-dot";
        dot.style.color = data.group_color;
        dot.style.backgroundColor = data.group_color;
        dot.title = data.group_title ? `所属组合：${data.group_title}` : "组合成员";
        titleRow.appendChild(dot);
    }

    const titleText = document.createElement("span");
    titleText.className = "prompt-vault-tile-title";
    titleText.textContent = data.title || "未命名词条";
    titleText.title = data.title || "";
    titleRow.appendChild(titleText);

    if (isVaultGroupTemplate) {
        const groupBadge = document.createElement("span");
        groupBadge.className = "prompt-vault-tile-group-badge";
        const count = (data.groupMembers || data.members).length;
        groupBadge.textContent = `组合 (${count})`;
        titleRow.appendChild(groupBadge);
    } else {
        const matchedCat = categories.find(
            (c) => c.id === data.categoryId || c.id === data.category_id || c.name === data.category
        );
        if (matchedCat) {
            const catBadge = document.createElement("span");
            catBadge.className = "prompt-vault-tile-badge";
            catBadge.textContent = matchedCat.name;
            if (matchedCat.color) {
                catBadge.style.backgroundColor = `${matchedCat.color}22`;
                catBadge.style.color = matchedCat.color;
                catBadge.style.borderColor = `${matchedCat.color}44`;
            }
            titleRow.appendChild(catBadge);
        }
    }

    if (isDirty) {
        const dirtyBadge = document.createElement("span");
        dirtyBadge.className = "prompt-vault-tile-dirty-badge";
        dirtyBadge.textContent = "已修改";
        titleRow.appendChild(dirtyBadge);
    }
    infoBox.appendChild(titleRow);

    const snippet = document.createElement("div");
    snippet.className = "prompt-vault-tile-snippet";
    let promptSnippetText = "";
    if (isVaultGroupTemplate) {
        const members = data.groupMembers || data.members;
        promptSnippetText = members.map((m) => m.title).join(" / ");
    } else {
        promptSnippetText = (data.text || data.prompt || "").replace(/[\r\n]+/g, " ");
    }
    snippet.textContent = promptSnippetText;
    infoBox.appendChild(snippet);
    tile.appendChild(infoBox);

    const actionsBar = document.createElement("div");
    actionsBar.className = "prompt-vault-tile-actions";

    if (isSelectedMode) {
        const weightBadge = document.createElement("div");
        weightBadge.className = "prompt-vault-tile-weight";
        weightBadge.title = "滚轮上下滚动调节权重 (步长 0.1)";
        weightBadge.textContent = `× ${formatWeightBadgeText(data.weight || 1.0)}`;

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
        muteBtn.className = "prompt-vault-tile-btn";
        muteBtn.title = isMuted ? "启用该词条" : "静音该词条 (不参与拼接)";
        muteBtn.innerHTML = renderIcon(isMuted ? "eyeOff" : "eye", 13);
        muteBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            state.toggleTileEnabled(instanceId);
        });
        actionsBar.appendChild(muteBtn);
    }

    if (!isSelectedMode) {
        const isFavorited = (Array.isArray(data.collections) && data.collections.length > 0) || Boolean(data.favorite);
        const starBtn = document.createElement("button");
        starBtn.type = "button";
        starBtn.className = "prompt-vault-tile-btn";
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
            const copyContent = isVaultGroupTemplate
                ? (data.groupMembers || data.members).map((m) => m.text || m.prompt || "").join(", ")
                : (data.text || data.prompt || "");
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
        removeBtn.title = hasGroup ? "移除该组合 (原子整组移除)" : "移出已选列表";
        removeBtn.innerHTML = renderIcon("x", 13);
        removeBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            removeActivePopover();
            state.removeTile(instanceId);
        });
        actionsBar.appendChild(removeBtn);
    }

    tile.appendChild(actionsBar);

    if (!isSelectedMode) {
        return tile;
    }

    const row = document.createElement("div");
    row.className = "prompt-vault-tile-row";
    row.dataset.instanceId = instanceId;

    if (groupColor) {
        row.style.setProperty("--pv-group-color", groupColor);
        row.style.setProperty("--pv-group-glow", `${groupColor}44`);
    }

    const trackElement = createTrackElement(trackRole);
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