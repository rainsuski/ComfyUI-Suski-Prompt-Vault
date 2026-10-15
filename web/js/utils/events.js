/* File: ComfyUI-Suski-Prompt-Vault/web/js/utils/events.js */

/**
 * LiteGraph 画布事件隔离与拦截模块。
 * 阻止 DOM 元素内部的用户操作（点击、拖拽、键盘输入、滚轮）穿透冒泡至 ComfyUI 底层画布，
 * 全面静默整个组件区域内的浏览器 Ctrl+滚轮全局网页缩放，
 * 同时接管鼠标中键拖拽行为，驱动底层 LiteGraph 画布顺畅平移。
 */

/**
 * 获取当前全局绑定的 LiteGraph 画布实例。
 * @returns {any|null}
 */
function getGraphCanvas() {
    return (
        window.app?.canvas ||
        document.querySelector("canvas.graph-canvas")?.lgraphcanvas ||
        document.querySelector("canvas#graph-canvas")?.lgraphcanvas ||
        document.querySelector("canvas")?.lgraphcanvas ||
        null
    );
}

/**
 * 启动鼠标中键拖动画布平移监听。
 * @param {PointerEvent|MouseEvent} startEvent
 */
function startCanvasMiddleDrag(startEvent) {
    const graphCanvas = getGraphCanvas();
    if (!graphCanvas || !graphCanvas.ds) return;

    let lastX = startEvent.clientX;
    let lastY = startEvent.clientY;

    const onPointerMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - lastX;
        const deltaY = moveEvent.clientY - lastY;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;

        const scale = graphCanvas.ds.scale || 1;
        graphCanvas.ds.offset[0] += deltaX / scale;
        graphCanvas.ds.offset[1] += deltaY / scale;

        graphCanvas.dirty_canvas = true;
        graphCanvas.dirty_bgcanvas = true;
        if (typeof graphCanvas.setDirty === "function") {
            graphCanvas.setDirty(true, true);
        }
    };

    const onPointerUp = (upEvent) => {
        if (upEvent.button === 1) {
            window.removeEventListener("pointermove", onPointerMove, true);
            window.removeEventListener("pointerup", onPointerUp, true);
        }
    };

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
}

/**
 * 为目标元素绑定输入与交互拦截，切断向底层 LiteGraph 拖动画布及键盘快捷键的传递。
 * 当用户在元素内按下鼠标中键（button === 1）时，接管并平移底层画布。
 * 全面拦截该容器范围内的 Ctrl+滚轮 浏览器全局缩放。
 * @param {HTMLElement} element - 需要隔离事件的 DOM 容器
 */
export function isolateCanvasEvents(element) {
    if (!element) return;

    const onPointerDown = (event) => {
        if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            startCanvasMiddleDrag(event);
            return;
        }
        event.stopPropagation();
    };

    const onMouseDown = (event) => {
        if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.stopPropagation();
    };

    const stopHandler = (event) => {
        if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.stopPropagation();
    };

    element.addEventListener("pointerdown", onPointerDown, { passive: false });
    element.addEventListener("mousedown", onMouseDown, { passive: false });
    element.addEventListener("touchstart", stopHandler, { passive: false });
    element.addEventListener("contextmenu", stopHandler, { passive: false });

    // 拦截键盘事件，防止输入内容时误触发 ComfyUI 全局快捷键（如空格拖动画布、删除节点等）
    element.addEventListener("keydown", stopHandler, { passive: false });
    element.addEventListener("keyup", stopHandler, { passive: false });

    // 容器级阻断：在整个组件内彻底静默 Ctrl+滚轮 导致的浏览器全局缩放
    element.addEventListener(
        "wheel",
        (event) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
            }
        },
        { passive: false }
    );
}

/**
 * 绑定滚动区域的滚轮事件隔离，确保列表内部滚动时不触发画布放大与缩小。
 * 1. 智能放行具备独立滚动能力的子元素（如 textarea）；
 * 2. 按住 Ctrl/Meta 时全面阻断浏览器全局网页缩放，平滑降级为普通纵向滚动列表，彻底消除顶底与中间的行为撕裂；
 * 3. 普通滚动时切断边缘穿透，防止误缩放底层 ComfyUI 画布。
 * @param {HTMLElement} scrollContainer - 具备 overflow-y 的滚动容器
 */
export function isolateWheelScroll(scrollContainer) {
    if (!scrollContainer) return;

    scrollContainer.addEventListener(
        "wheel",
        (event) => {
            // 阻断滚轮向 LiteGraph 画布冒泡导致画布缩放
            event.stopPropagation();

            // 若事件源是内部具备独立滚动能力的子元素（如 textarea），交由子元素自身处理
            const target = /** @type {HTMLElement|null} */ (event.target);
            if (target && target !== scrollContainer) {
                const targetIsScrollable = target.scrollHeight > target.clientHeight;
                if (targetIsScrollable) {
                    return;
                }
            }

            const isCtrl = event.ctrlKey || event.metaKey;

            // 无论处于列表顶部、中部还是底部，只要按住 Ctrl，坚决阻止浏览器全局缩放网页
            if (isCtrl) {
                event.preventDefault();
                // 降级为平滑纵向滚动当前列表本身
                scrollContainer.scrollTop += event.deltaY;
                return;
            }

            const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
            const isScrollable = scrollHeight > clientHeight;

            if (!isScrollable) {
                event.preventDefault();
                return;
            }

            // 到达顶部或底部时阻止默认滚动穿透至 ComfyUI 画布
            const isAtTop = scrollTop <= 0 && event.deltaY < 0;
            const isAtBottom = scrollTop + clientHeight >= scrollHeight && event.deltaY > 0;

            if (isAtTop || isAtBottom) {
                event.preventDefault();
            }
        },
        { passive: false }
    );
}

/**
 * 为拖拽把手及磁贴切断 dragstart 导致的 LiteGraph 节点整体移动。
 * @param {HTMLElement} element - 磁贴或拖拽把手 DOM
 */
export function isolateDragEvents(element) {
    if (!element) return;

    element.addEventListener("dragstart", (event) => {
        event.stopPropagation();
    });
}