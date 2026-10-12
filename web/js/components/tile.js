/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/tile.js */

/**
 * 磁贴卡片（Tile）核心渲染组件。
 * 对齐 aaalice-prompt-library v2 数据标准（text、categoryId、previewHash、tagIds），
 * 提供词库单击即选/反选与高亮包裹框、悬浮删除确认弹窗、只读滚轮权重微调（0.1步长）、
 * 分类色彩动态徽章及鼠标延时悬浮详情预览弹窗。
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

/**
 * 渲染悬浮详情预览气泡。
 * @param {HTMLElement} targetTile
 * @param {any} data
 * @param {any[]} categories
 * @param {any[]} tagsDict
 */
function showPopover(targetTile, data, categories, tagsDict) {
    removeActivePopover();

    const popover = document.createElement("div");
    popover.className = "prompt-vault-popover";

    // 1. 头部行（标题 + 分类标签）
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

    // 2. 预览图展示
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

    // 3. 提示词完整内容 (text 或 prompt)
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

    // 4. 标签列表解析 (根据 tagIds 查字典或直接读取 tags)
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

/**
 * 创建磁贴卡片 DOM 节点。
 * @param {Object} options
 * @param {any} options.data - 磁贴数据对象（标准 entry 实体或已选实例）
 * @param {"vault"|"selected"} options.mode - 展示模式
 * @param {import("../state.js").VaultNodeState} options.state - 节点状态机
 * @param {boolean} [options.isActive=false] - 是否激活编辑
 * @param {boolean} [options.isAlreadyAdded=false] - 是否已选
 * @param {any[]} [options.categories=[]] - 分类元数据树
 * @param {any[]} [options.tagsDict=[]] - 标签字典
 * @param {(entry: any) => void} [options.onToggleFavorite] - 收藏回调
 * @param {(entry: any) => void} [options.onDeleteEntry] - 词条删除二次确认回调
 * @returns {HTMLElement} 磁贴卡片元素
 */
export function createTileElement({
    data,
    mode,
    state,
    isActive = false,
    isAlreadyAdded = false,
    categories = [],
    tagsDict = [],
    onToggleFavorite,
    onDeleteEntry,
}) {
    const isSelectedMode = mode === "selected";
    const instanceId = isSelectedMode ? data.instance_id : null;
    const isMuted = isSelectedMode && data.enabled === false;
    const isDirty = isSelectedMode && Boolean(data.is_dirty);

    // 1. 卡片外层容器
    const tile = document.createElement("div");
    tile.className = "prompt-vault-tile";
    if (isActive) tile.classList.add("is-active");
    if (isMuted) tile.classList.add("is-muted");
    if (!isSelectedMode && isAlreadyAdded) tile.classList.add("is-vault-selected");

    tile.dataset.mode = mode;
    if (instanceId) tile.dataset.instanceId = instanceId;

    isolateCanvasEvents(tile);

    // 悬停延迟展示预览气泡
    tile.addEventListener("mouseenter", () => {
        if (activePopoverTimer) clearTimeout(activePopoverTimer);
        activePopoverTimer = setTimeout(() => {
            showPopover(tile, data, categories, tagsDict);
        }, 450);
    });

    tile.addEventListener("mouseleave", () => {
        removeActivePopover();
    });

    // 点击卡片交互
    tile.addEventListener("click", (event) => {
        removeActivePopover();
        if (event.target.closest(".prompt-vault-tile-actions")) return;

        if (isSelectedMode) {
            state.setActiveTile(instanceId);
        } else {
            const existing = state.selectedTiles.find((t) => t.ref_preset_id === data.id);
            if (existing) {
                state.removeTile(existing.instance_id);
            } else {
                state.addTileFromEntry(data, categories);
            }
        }
    });

    // 2. 缩略图区域
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

    // 3. 信息区域
    const infoBox = document.createElement("div");
    infoBox.className = "prompt-vault-tile-info";

    const titleRow = document.createElement("div");
    titleRow.className = "prompt-vault-tile-title-row";

    const titleText = document.createElement("span");
    titleText.className = "prompt-vault-tile-title";
    titleText.textContent = data.title || "未命名词条";
    titleText.title = data.title || "";
    titleRow.appendChild(titleText);

    // 解析并渲染分类胶囊 Badge 与色彩
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

    if (isDirty) {
        const dirtyBadge = document.createElement("span");
        dirtyBadge.className = "prompt-vault-tile-dirty-badge";
        dirtyBadge.textContent = "已修改";
        titleRow.appendChild(dirtyBadge);
    }
    infoBox.appendChild(titleRow);

    const snippet = document.createElement("div");
    snippet.className = "prompt-vault-tile-snippet";
    const promptText = data.text || data.prompt || "";
    snippet.textContent = promptText.replace(/[\r\n]+/g, " ");
    infoBox.appendChild(snippet);
    tile.appendChild(infoBox);

    // 4. 右侧 Hover 操作栏
    const actionsBar = document.createElement("div");
    actionsBar.className = "prompt-vault-tile-actions";

    // 4.1 权重微调器（已选列表）
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

    // 4.2 收藏按钮（词库模式）
    if (!isSelectedMode) {
        const isFavorited = (Array.isArray(data.collections) && data.collections.length > 0) || Boolean(data.favorite);
        const starBtn = document.createElement("button");
        starBtn.type = "button";
        starBtn.className = "prompt-vault-tile-btn";
        if (isFavorited) starBtn.classList.add("is-starred");
        starBtn.title = isFavorited ? "已收藏 (点击取消或移动)" : "加入收藏夹";
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

    // 4.3 复制 Prompt
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "prompt-vault-tile-btn";
    copyBtn.title = "复制完整 Prompt 到剪贴板";
    copyBtn.innerHTML = renderIcon("copy", 13);
    copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(promptText);
            copyBtn.innerHTML = renderIcon("check", 13);
            setTimeout(() => {
                copyBtn.innerHTML = renderIcon("copy", 13);
            }, 1000);
        } catch (err) {
            console.error("[PromptVault] Failed to copy to clipboard:", err);
        }
    });
    actionsBar.appendChild(copyBtn);

    // 4.4 词库模式专属：从库中删除词条
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

    // 4.5 中栏模式专属：移出已选
    if (isSelectedMode) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "prompt-vault-tile-btn is-danger";
        removeBtn.title = "移出已选列表";
        removeBtn.innerHTML = renderIcon("x", 13);
        removeBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            removeActivePopover();
            state.removeTile(instanceId);
        });
        actionsBar.appendChild(removeBtn);
    }

    tile.appendChild(actionsBar);

    // 5. HTML5 拖拽排序逻辑
    if (isSelectedMode) {
        tile.setAttribute("draggable", "true");
        isolateDragEvents(tile);

        tile.addEventListener("dragstart", (event) => {
            removeActivePopover();
            tile.classList.add("is-dragging");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", instanceId);
            }
        });

        tile.addEventListener("dragend", () => {
            tile.classList.remove("is-dragging");
        });

        tile.addEventListener("dragover", (event) => {
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
            const rect = tile.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (event.clientY < midY) {
                tile.classList.add("drag-over-top");
                tile.classList.remove("drag-over-bottom");
            } else {
                tile.classList.add("drag-over-bottom");
                tile.classList.remove("drag-over-top");
            }
        });

        tile.addEventListener("dragleave", () => {
            tile.classList.remove("drag-over-top", "drag-over-bottom");
        });

        tile.addEventListener("drop", (event) => {
            event.preventDefault();
            tile.classList.remove("drag-over-top", "drag-over-bottom");
            if (!event.dataTransfer) return;

            const sourceId = event.dataTransfer.getData("text/plain");
            if (!sourceId || sourceId === instanceId) return;

            const fromIndex = state.selectedTiles.findIndex((t) => t.instance_id === sourceId);
            const toIndex = state.selectedTiles.findIndex((t) => t.instance_id === instanceId);
            if (fromIndex !== -1 && toIndex !== -1) {
                state.reorderTiles(fromIndex, toIndex);
            }
        });
    }

    return tile;
}