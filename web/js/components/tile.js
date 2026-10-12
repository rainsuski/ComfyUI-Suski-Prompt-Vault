/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/tile.js */

/**
 * 磁贴卡片（Tile）核心渲染组件。
 * 提供词库单击即选/反选与选中高亮外框、只读滚轮权重调节（0.1步长）、
 * 纯内联 SVG 矢量图标展示与基于分类色彩的动态标签渲染。
 */

import { getThumbnailUrl } from "../api.js";
import { isolateCanvasEvents, isolateDragEvents } from "../utils/events.js";
import { renderIcon } from "../utils/icons.js";
import { formatWeightBadgeText } from "../utils/prompt_format.js";

/**
 * 创建磁贴卡片 DOM 节点。
 * @param {Object} options
 * @param {any} options.data - 磁贴数据对象（预设项或已选实例）
 * @param {"vault"|"selected"} options.mode - 展示模式：'vault' (左侧词库) 或 'selected' (中间已选)
 * @param {import("../state.js").VaultNodeState} options.state - 节点状态机实例
 * @param {boolean} [options.isActive=false] - 是否处于激活选中编辑态
 * @param {boolean} [options.isAlreadyAdded=false] - 左侧模式下是否已被加入已选列表
 * @param {any[]} [options.categoriesConfig=[]] - 分类元数据列表（用于获取自定义颜色）
 * @param {(preset: any) => void} [options.onToggleFavorite] - 触发收藏联动弹窗回调
 * @returns {HTMLElement} 磁贴卡片元素
 */
export function createTileElement({
    data,
    mode,
    state,
    isActive = false,
    isAlreadyAdded = false,
    categoriesConfig = [],
    onToggleFavorite,
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

    // 拦截交互事件，杜绝穿透触发画布拖拽
    isolateCanvasEvents(tile);

    // 点击卡片主体交互逻辑
    tile.addEventListener("click", (event) => {
        // 忽略来自 Hover 按钮组的冒泡
        if (event.target.closest(".prompt-vault-tile-actions")) return;

        if (isSelectedMode) {
            // 中栏模式：点击卡片即聚焦并在右侧面板编辑
            state.setActiveTile(instanceId);
        } else {
            // 左栏模式：单击直接选择，再次点击取消选择
            const existing = state.selectedTiles.find((t) => t.ref_preset_id === data.id);
            if (existing) {
                state.removeTile(existing.instance_id);
            } else {
                state.addTileFromPreset(data);
            }
        }
    });

    // 2. 缩略图区域（无图片时使用统一 messageSquare 矢量图标）
    const thumbBox = document.createElement("div");
    thumbBox.className = "prompt-vault-tile-thumb";
    if (data.thumbnail) {
        const img = document.createElement("img");
        img.src = getThumbnailUrl(data.thumbnail);
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

    // 标题行与胶囊
    const titleRow = document.createElement("div");
    titleRow.className = "prompt-vault-tile-title-row";

    const titleText = document.createElement("span");
    titleText.className = "prompt-vault-tile-title";
    titleText.textContent = data.title || "未命名词条";
    titleText.title = data.title || "";
    titleRow.appendChild(titleText);

    // 分类胶囊 Badge：根据后台自定义色彩动态注入样式
    if (data.category) {
        const catBadge = document.createElement("span");
        catBadge.className = "prompt-vault-tile-badge";
        catBadge.textContent = data.category;

        const matchedCat = categoriesConfig.find((c) => c.name === data.category);
        if (matchedCat && matchedCat.color) {
            const c = matchedCat.color;
            catBadge.style.backgroundColor = `${c}22`;
            catBadge.style.color = c;
            catBadge.style.borderColor = `${c}44`;
        }
        titleRow.appendChild(catBadge);
    }

    // 草稿修改指示器
    if (isDirty) {
        const dirtyBadge = document.createElement("span");
        dirtyBadge.className = "prompt-vault-tile-dirty-badge";
        dirtyBadge.textContent = "已修改";
        titleRow.appendChild(dirtyBadge);
    }
    infoBox.appendChild(titleRow);

    // 提示词单行预览截断
    const snippet = document.createElement("div");
    snippet.className = "prompt-vault-tile-snippet";
    snippet.textContent = (data.prompt || "").replace(/[\r\n]+/g, " ");
    infoBox.appendChild(snippet);
    tile.appendChild(infoBox);

    // 4. 右侧 Hover 浮动操作栏
    const actionsBar = document.createElement("div");
    actionsBar.className = "prompt-vault-tile-actions";

    // 4.1 权重微调器（仅在已选列表模式下：只读胶囊徽章，仅支持滚轮事件调节，步长 0.1）
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

        // 静音/启用切换按钮（矢量图标）
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

    // 4.2 收藏星标按钮（仅词库模式展示）
    if (!isSelectedMode) {
        const starBtn = document.createElement("button");
        starBtn.type = "button";
        starBtn.className = "prompt-vault-tile-btn";
        if (data.favorite) starBtn.classList.add("is-starred");
        starBtn.title = data.favorite ? "已收藏 (点击取消或移动)" : "加入收藏夹";
        starBtn.innerHTML = renderIcon(data.favorite ? "starFilled" : "star", 13);
        starBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (typeof onToggleFavorite === "function") {
                onToggleFavorite(data);
            }
        });
        actionsBar.appendChild(starBtn);
    }

    // 4.3 一键复制完整提示词到系统剪贴板（矢量图标）
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "prompt-vault-tile-btn";
    copyBtn.title = "复制完整 Prompt 到剪贴板";
    copyBtn.innerHTML = renderIcon("copy", 13);
    copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(data.prompt || "");
            copyBtn.innerHTML = renderIcon("check", 13);
            setTimeout(() => {
                copyBtn.innerHTML = renderIcon("copy", 13);
            }, 1000);
        } catch (err) {
            console.error("[PromptVault] Failed to copy to clipboard:", err);
        }
    });
    actionsBar.appendChild(copyBtn);

    // 4.4 移除按钮（仅中栏已选模式展示，矢量叉号）
    if (isSelectedMode) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "prompt-vault-tile-btn";
        removeBtn.title = "移出已选列表";
        removeBtn.innerHTML = renderIcon("x", 13);
        removeBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            state.removeTile(instanceId);
        });
        actionsBar.appendChild(removeBtn);
    }

    tile.appendChild(actionsBar);

    // 5. HTML5 拖拽排序逻辑（仅对中间已选列表生效）
    if (isSelectedMode) {
        tile.setAttribute("draggable", "true");
        isolateDragEvents(tile);

        tile.addEventListener("dragstart", (event) => {
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