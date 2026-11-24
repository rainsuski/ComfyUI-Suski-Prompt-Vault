/* File: ComfyUI-Suski-Prompt-Vault/web/js/utils/events.js */

/**
 * 画布事件隔离与交互适配模块。
 * 阻止 DOM 元素内部的点击、拖拽、键盘输入与滚轮操作误触发底层画布，
 * 遵循 Nodes 2.0 焦点式滚轮捕获协议（data-capture-wheel + 焦点建立）保留局部滚动与调权能力，
 * 并按宿主渲染模式适配鼠标中键拖动画布平移。
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
 * 判断元素是否挂载在 Nodes 2.0 Vue 节点容器内。
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function isVueNodesContext(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(".lg-node-widgets, [data-node-id], .lg-node"));
}

/**
 * 判断元素是否为文本输入控件（用于避免在用户持续输入时抢走打字焦点）。
 * 下拉框（SELECT）与按钮不属于持续键入控件，不在此拦截范围内。
 * @param {Element|null} el
 * @returns {boolean}
 */
export function isTextInputControl(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
        const type = (/** @type {HTMLInputElement} */ (el)).type?.toLowerCase() || "text";
        return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file"].includes(type);
    }
    return false;
}

/**
 * 判断当前聚焦元素与目标滚动容器是否同属一个 PromptVault 节点实例。
 * @param {Element|null} activeEl
 * @param {HTMLElement} containerEl
 * @returns {boolean}
 */
function isInSameVaultContainer(activeEl, containerEl) {
    if (!(activeEl instanceof Element)) return false;
    const vaultRoot = containerEl.closest(".prompt-vault-container");
    return Boolean(vaultRoot && vaultRoot.contains(activeEl));
}

/**
 * 启动 Classic 模式下的鼠标中键拖动画布平移监听。
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
 * 为目标元素绑定输入与交互拦截，切断向底层画布拖动画布及快捷键的传递。
 * 按住鼠标中键时：Nodes 2.0 下放行至 TransformPane 原生平移，Classic 下由 ds.offset 驱动平移。
 * @param {HTMLElement} element - 需要隔离事件的 DOM 容器
 */
export function isolateCanvasEvents(element) {
    if (!element) return;

    const onPointerDown = (event) => {
        if (event.button === 1) {
            if (isVueNodesContext(element)) {
                return;
            }
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
            if (isVueNodesContext(element)) {
                return;
            }
            event.stopPropagation();
            return;
        }
        event.stopPropagation();
    };

    const stopHandler = (event) => {
        if (event.button === 1) {
            event.preventDefault();
            if (isVueNodesContext(element)) {
                return;
            }
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

    // 容器级阻断：静默 Ctrl/Meta+滚轮 导致的浏览器全局网页缩放
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
 * 1. 声明 data-capture-wheel="true" 与可聚焦属性（tabIndex = -1），
 *    在 pointerenter / pointermove / pointerdown 时维持容器焦点，满足 Nodes 2.0 捕获阶段焦点校验；
 * 2. 保护外部节点及弹窗的文本输入焦点，同时允许从同节点其它控件切入滚动区时建立滚动焦点；
 * 3. 指针离开时仅释放容器自身焦点，不影响画布快捷键与内部正在编辑的表单控件；
 * 4. 按住 Ctrl/Meta 时阻断浏览器全局网页缩放，普通滚动时切断边缘穿透。
 * @param {HTMLElement} scrollContainer - 具备 overflow-y 的滚动容器
 */
export function isolateWheelScroll(scrollContainer) {
    if (!scrollContainer) return;

    scrollContainer.setAttribute("data-capture-wheel", "true");
    if (!scrollContainer.hasAttribute("tabindex")) {
        scrollContainer.tabIndex = -1;
    }
    scrollContainer.style.outline = "none";

    scrollContainer.addEventListener("pointerenter", () => {
        const active = document.activeElement;
        if (scrollContainer.contains(active)) return;
        // 保护外部节点或弹窗中的文本输入焦点；同节点内从搜索框/编辑器切入列表时允许建立滚动焦点
        if (isTextInputControl(active) && !isInSameVaultContainer(active, scrollContainer)) {
            return;
        }
        scrollContainer.focus({ preventScroll: true });
    });

    scrollContainer.addEventListener("pointermove", () => {
        const active = document.activeElement;
        if (scrollContainer.contains(active)) return;
        // 列表重绘、按钮销毁或初次创建时节点恰好位于指针下方时，仅在非文本输入状态下补全焦点
        if (isTextInputControl(active)) return;
        scrollContainer.focus({ preventScroll: true });
    });

    scrollContainer.addEventListener("pointerdown", (event) => {
        const target = /** @type {Element|null} */ (event.target);
        if (isTextInputControl(target) || target?.tagName === "SELECT") return;
        if (!scrollContainer.contains(document.activeElement)) {
            scrollContainer.focus({ preventScroll: true });
        }
    });

    scrollContainer.addEventListener("pointerleave", () => {
        if (document.activeElement === scrollContainer) {
            scrollContainer.blur();
        }
    });

    scrollContainer.addEventListener(
        "wheel",
        (event) => {
            event.stopPropagation();

            const target = /** @type {HTMLElement|null} */ (event.target);
            const targetIsScrollable = Boolean(
                target &&
                target !== scrollContainer &&
                target.scrollHeight > target.clientHeight
            );
            const isCtrl = event.ctrlKey || event.metaKey;

            // 无论处于列表顶部、中部还是底部，按住 Ctrl 时阻断浏览器缩放并降级为纵向滚动
            if (isCtrl) {
                event.preventDefault();
                if (targetIsScrollable && target) {
                    target.scrollTop += event.deltaY;
                } else {
                    scrollContainer.scrollTop += event.deltaY;
                }
                return;
            }

            if (targetIsScrollable) {
                return;
            }

            const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
            const isScrollable = scrollHeight > clientHeight;

            if (!isScrollable) {
                event.preventDefault();
                return;
            }

            // 到达顶部或底部时阻止默认滚动穿透至画布
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
 * 为拖拽把手及磁贴切断 dragstart 导致的节点整体移动。
 * @param {HTMLElement} element - 磁贴或拖拽把手 DOM
 */
export function isolateDragEvents(element) {
    if (!element) return;

    element.addEventListener("dragstart", (event) => {
        event.stopPropagation();
    });
}