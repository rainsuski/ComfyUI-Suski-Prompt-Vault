/* File: ComfyUI-Suski-Prompt-Vault/web/js/utils/events.js */

/**
 * LiteGraph 画布事件隔离与拦截模块。
 * 阻止 DOM 元素内部的用户操作（点击、拖拽、键盘输入、滚轮）穿透冒泡至 ComfyUI 底层画布。
 */

/**
 * 为目标元素绑定输入与交互拦截，切断向底层 LiteGraph 拖动画布及键盘快捷键的传递。
 * @param {HTMLElement} element - 需要隔离事件的 DOM 容器
 */
export function isolateCanvasEvents(element) {
    if (!element) return;

    const stopHandler = (event) => {
        event.stopPropagation();
    };

    element.addEventListener("mousedown", stopHandler, { passive: false });
    element.addEventListener("pointerdown", stopHandler, { passive: false });
    element.addEventListener("touchstart", stopHandler, { passive: false });
    element.addEventListener("contextmenu", stopHandler, { passive: false });

    // 拦截键盘事件，防止输入内容时误触发 ComfyUI 全局快捷键（如空格拖动画布、删除节点等）
    element.addEventListener("keydown", stopHandler, { passive: false });
    element.addEventListener("keyup", stopHandler, { passive: false });
}

/**
 * 绑定滚动区域的滚轮事件隔离，确保列表内部滚动时不触发画布放大与缩小。
 * @param {HTMLElement} scrollContainer - 具备 overflow-y 的滚动容器
 */
export function isolateWheelScroll(scrollContainer) {
    if (!scrollContainer) return;

    scrollContainer.addEventListener(
        "wheel",
        (event) => {
            // 彻底阻断滚轮向 LiteGraph 画布冒泡导致画布缩放
            event.stopPropagation();

            const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
            const isScrollable = scrollHeight > clientHeight;

            if (!isScrollable) {
                event.preventDefault();
                return;
            }

            // 到达顶部或底部时阻止默认滚动穿透
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