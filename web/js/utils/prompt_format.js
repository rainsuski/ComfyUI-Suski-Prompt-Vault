/* File: ComfyUI-Suski-Prompt-Vault/web/js/utils/prompt_format.js */

/**
 * 提示词加权语法解析、清洗、精度格式化与交互式加减权快捷键工具模块。
 * 支持 Ctrl/Alt/Cmd + ArrowUp/ArrowDown 键盘调权，
 * 以及 Ctrl/Alt/Cmd + 鼠标滚轮调权（内置 40px 阈值累加器防惯性抖动），
 * 严格执行焦点守卫与全局缩放防御（未聚焦坚决静默且不缩放网页），
 * 未按修饰键时确保长文本具备顺畅的原生滚轮纵向滚动体验。
 */

/**
 * 对权重数值进行 0.1 步长安全舍入，约束在有效区间内并消除浮点数累加误差。
 * @param {number} weight - 输入权重数值
 * @param {number} [min=0.1] - 最小安全权重
 * @param {number} [max=3.0] - 最大安全权重
 * @returns {number} 格式化后的精确数值
 */
export function clampAndRoundWeight(weight, min = 0.1, max = 3.0) {
    const rounded = Math.round(weight * 10) / 10;
    return Math.min(max, Math.max(min, rounded));
}

/**
 * 将数值格式化为整洁的权重展示文本。
 * 例如：1.0 转换为 "1", 1.2 转换为 "1.2"。
 * @param {number} weight - 权重浮点数
 * @returns {string} 徽章展示文本
 */
export function formatWeightBadgeText(weight) {
    const safeWeight = clampAndRoundWeight(weight);
    if (Math.abs(safeWeight - 1.0) < 0.001) {
        return "1";
    }
    return Number.isInteger(safeWeight) ? safeWeight.toString() : safeWeight.toFixed(1);
}

/**
 * 将单个词条文本与权重转换为标准 ComfyUI 加权语法字符串。
 * @param {string} prompt - 原始内容
 * @param {number} weight - 权重数值
 * @returns {string} 加权字符串
 */
export function formatPromptSegment(prompt, weight) {
    const trimmed = (prompt || "").trim();
    if (!trimmed) {
        return "";
    }
    const safeWeight = clampAndRoundWeight(weight);
    if (Math.abs(safeWeight - 1.0) < 0.001) {
        return trimmed;
    }
    const weightText = formatWeightBadgeText(safeWeight);
    return `(${trimmed}:${weightText})`;
}

/**
 * 规范化提示词字符串：消除多余连续逗号、清理首尾标点与冗余空白。
 * @param {string} rawPrompt - 原始拼接字符串
 * @returns {string} 清洗后的标准提示词
 */
export function cleanPromptString(rawPrompt) {
    if (!rawPrompt) return "";
    return rawPrompt
        .replace(/,\s*,+/g, ", ")
        .replace(/\s+/g, " ")
        .replace(/^[\s,]+|[\s,]+$/g, "")
        .trim();
}

/**
 * 对文本输入框中光标所在位置或选中的单个 Tag 进行智能加减权处理。
 * 支持标准 ComfyUI 语法：(tag:1.1) 加权增加、降到 1.0 时自动脱去括号还原为纯文本 tag。
 * @param {HTMLTextAreaElement|HTMLInputElement} targetInput - 目标文本域输入框
 * @param {number} delta - 权重增减量（如 +0.1 或 -0.1）
 * @param {number} [min=0.1] - 最小权重
 * @param {number} [max=3.0] - 最大权重
 */
export function adjustPromptWeightAtCursor(targetInput, delta, min = 0.1, max = 3.0) {
    if (!targetInput) return;

    const text = targetInput.value || "";
    let start = targetInput.selectionStart ?? 0;
    let end = targetInput.selectionEnd ?? 0;

    // 1. 若用户未选中文本，则自动向前后扩展嗅探出光标所在的单个 Tag 边界
    if (start === end) {
        while (start > 0 && text[start - 1] !== "," && text[start - 1] !== "\n") {
            start--;
        }
        while (end < text.length && text[end] !== "," && text[end] !== "\n") {
            end++;
        }
    }

    // 修剪前后的空白字符
    while (start < end && /\s/.test(text[start])) {
        start++;
    }
    while (end > start && /\s/.test(text[end - 1])) {
        end--;
    }

    if (start >= end) {
        return;
    }

    const rawTag = text.substring(start, end).trim();
    if (!rawTag) return;

    // 2. 解析当前 Tag 的权重结构
    let tagContent = rawTag;
    let currentWeight = 1.0;

    const weightedMatch = rawTag.match(/^\(([\s\S]+):([0-9.]+)\)$/);
    if (weightedMatch) {
        tagContent = weightedMatch[1].trim();
        currentWeight = parseFloat(weightedMatch[2]);
        if (Number.isNaN(currentWeight)) {
            currentWeight = 1.0;
        }
    } else {
        const parenMatch = rawTag.match(/^\(([\s\S]+)\)$/);
        if (parenMatch) {
            tagContent = parenMatch[1].trim();
            currentWeight = 1.1;
        }
    }

    // 3. 计算新权重
    const targetWeight = clampAndRoundWeight(currentWeight + delta, min, max);

    // 4. 根据新权重构造新文本
    let replacement = "";
    if (Math.abs(targetWeight - 1.0) < 0.001) {
        replacement = tagContent;
    } else {
        replacement = `(${tagContent}:${formatWeightBadgeText(targetWeight)})`;
    }

    // 5. 将替换文本写回输入框，并以低调选区选中该 Tag 方便连续调节
    targetInput.setRangeText(replacement, start, end, "select");
    targetInput.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * 为文本域绑定快捷键与手势：
 * 1. 严格焦点守卫：未聚焦激活时不执行调权，并阻断浏览器网页缩放；
 * 2. Ctrl/Alt/Cmd + ArrowUp/ArrowDown 触发 Tag 增减权；
 * 3. Ctrl/Alt/Cmd + 鼠标滚轮 触发 Tag 增减权（拦截页面缩放与文本滚动，带 40px 惯性阈值保护）；
 * 4. 未按 Ctrl 时的普通滚轮：放行长文本原生顺畅纵向滚动，到达极值边缘时切断画布穿透。
 * @param {HTMLTextAreaElement|HTMLInputElement} targetInput
 * @param {() => void} [onModified] - 权重变更后的额外回调
 */
export function bindPromptWeightShortcuts(targetInput, onModified) {
    if (!targetInput) return;

    // 键盘快捷键监听
    targetInput.addEventListener("keydown", (event) => {
        const isModifier = event.ctrlKey || event.altKey || event.metaKey;
        if (!isModifier) return;

        // 焦点守卫：未聚焦激活时不执行任何快捷修改
        if (document.activeElement !== targetInput) return;

        if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            adjustPromptWeightAtCursor(targetInput, 0.1);
            if (typeof onModified === "function") {
                onModified();
            }
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            adjustPromptWeightAtCursor(targetInput, -0.1);
            if (typeof onModified === "function") {
                onModified();
            }
        }
    });

    // 滚轮监听与调权分流
    let wheelAccumulator = 0;
    let lastWheelTime = 0;

    targetInput.addEventListener(
        "wheel",
        (event) => {
            // 切断向外冒泡，防止触发 LiteGraph 底层画布平移/缩放
            event.stopPropagation();

            const isModifier = event.ctrlKey || event.altKey || event.metaKey;

            if (isModifier) {
                // 核心防御：只要按住修饰键，无论是否获得焦点，首先彻底拦截浏览器页面全局缩放与文本滚动
                event.preventDefault();

                // 严格焦点守卫：若文本框尚未获得焦点，直接静默退出（不调权、不改字、不放大网页）
                if (document.activeElement !== targetInput) {
                    return;
                }

                const now = performance.now();
                if (now - lastWheelTime > 260) {
                    wheelAccumulator = 0;
                }
                lastWheelTime = now;

                wheelAccumulator += event.deltaY;

                // 40px 阈值累加器过滤，防止无极滚轮或惯性触控板导致步长飞涨
                const THRESHOLD = 40;
                if (Math.abs(wheelAccumulator) >= THRESHOLD) {
                    const delta = wheelAccumulator < 0 ? 0.1 : -0.1;
                    wheelAccumulator = 0;
                    adjustPromptWeightAtCursor(targetInput, delta);
                    if (typeof onModified === "function") {
                        onModified();
                    }
                }
                return;
            }

            // 普通浏览模式：放行长文本原生顺畅纵向滚动
            const { scrollTop, scrollHeight, clientHeight } = targetInput;
            const isScrollable = scrollHeight > clientHeight;

            if (isScrollable) {
                // 当滚动到达最顶或最底时阻止继续穿透
                const isAtTop = scrollTop <= 0 && event.deltaY < 0;
                const isAtBottom = scrollTop + clientHeight >= scrollHeight && event.deltaY > 0;
                if (isAtTop || isAtBottom) {
                    event.preventDefault();
                }
            } else {
                // 无滚动需求时阻止默认行为，防止滚轮穿透至画布导致画布缩放
                event.preventDefault();
            }
        },
        { passive: false }
    );
}