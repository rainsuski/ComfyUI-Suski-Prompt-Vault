/* File: ComfyUI-Suski-Prompt-Vault/web/js/utils/prompt_format.js */

/**
 * 提示词加权语法解析、清洗与精度格式化工具模块。
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