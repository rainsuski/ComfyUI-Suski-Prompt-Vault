/* File: ComfyUI-Suski-Prompt-Vault/web/js/api.js */

/**
 * 后端 RESTful API 交互服务模块。
 * 负责词库条目 CRUD、多级嵌套分类与收藏夹管理、JSON 备份导入导出及缩略图访问。
 */

/**
 * 获取全量词库条目与层级分类/收藏夹配置。
 * @returns {Promise<{ success: boolean, presets: any[], categories: string[], taxonomies: { categories: any[], folders: any[] } }>}
 */
export async function fetchPresets() {
    try {
        const response = await fetch("/prompt_vault/api/presets", {
            method: "GET",
            headers: { "Accept": "application/json" },
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return {
            success: Boolean(result.success),
            presets: Array.isArray(result.data) ? result.data : [],
            categories: Array.isArray(result.categories) ? result.categories : [],
            taxonomies: result.taxonomies || { categories: [], folders: [] },
        };
    } catch (error) {
        console.error("[PromptVault] Failed to fetch presets:", error);
        return {
            success: false,
            presets: [],
            categories: [],
            taxonomies: { categories: [], folders: [] },
        };
    }
}

/**
 * 新增或更新词库条目（支持附带图片文件）。
 * @param {any} presetData - 词库条目属性
 * @param {File|Blob|null} [thumbnailFile=null] - 缩略图二进制文件
 * @returns {Promise<{ success: boolean, data?: any, error?: string }>}
 */
export async function upsertPreset(presetData, thumbnailFile = null) {
    try {
        let response;
        if (thumbnailFile) {
            const formData = new FormData();
            formData.append("data", JSON.stringify(presetData));
            formData.append("thumbnail", thumbnailFile, "preview.webp");
            response = await fetch("/prompt_vault/api/presets", {
                method: "POST",
                body: formData,
            });
        } else {
            response = await fetch("/prompt_vault/api/presets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(presetData),
            });
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("[PromptVault] Failed to upsert preset:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * 根据 ID 删除指定预设。
 * @param {string} presetId - 待删除预设 ID
 * @returns {Promise<boolean>}
 */
export async function deletePreset(presetId) {
    try {
        const response = await fetch(`/prompt_vault/api/presets/${encodeURIComponent(presetId)}`, {
            method: "DELETE",
        });
        if (!response.ok) return false;
        const result = await response.json();
        return Boolean(result.success);
    } catch (error) {
        console.error("[PromptVault] Failed to delete preset:", error);
        return false;
    }
}

/**
 * 获取全量分类与收藏夹配置树。
 * @returns {Promise<{ success: boolean, data: { categories: any[], folders: any[] } }>}
 */
export async function fetchTaxonomies() {
    try {
        const response = await fetch("/prompt_vault/api/taxonomies", {
            method: "GET",
            headers: { "Accept": "application/json" },
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("[PromptVault] Failed to fetch taxonomies:", error);
        return { success: false, data: { categories: [], folders: [] } };
    }
}

/**
 * 新增或更新分类或收藏夹项。
 * @param {"category"|"folder"} type - 节点类型
 * @param {any} payload - 节点数据
 * @returns {Promise<{ success: boolean, data?: any }>}
 */
export async function upsertTaxonomyItem(type, payload) {
    try {
        const response = await fetch(`/prompt_vault/api/taxonomies/${encodeURIComponent(type)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("[PromptVault] Failed to upsert taxonomy item:", error);
        return { success: false };
    }
}

/**
 * 删除分类或收藏夹项（支持级联删除整个分支）。
 * @param {"category"|"folder"} type - 节点类型
 * @param {string} id - 节点 ID
 * @param {boolean} [deleteBranch=false] - 是否删除整个分类分支
 * @returns {Promise<boolean>}
 */
export async function deleteTaxonomyItem(type, id, deleteBranch = false) {
    try {
        const query = deleteBranch ? "?branch=true" : "?branch=false";
        const response = await fetch(
            `/prompt_vault/api/taxonomies/${encodeURIComponent(type)}/${encodeURIComponent(id)}${query}`,
            { method: "DELETE" }
        );
        if (!response.ok) return false;
        const result = await response.json();
        return Boolean(result.success);
    } catch (error) {
        console.error("[PromptVault] Failed to delete taxonomy item:", error);
        return false;
    }
}

/**
 * 导入外部 JSON 词库包。
 * @param {File} file - JSON 文件对象
 * @param {"merge"|"overwrite"} [mode="merge"] - 导入模式
 * @returns {Promise<{ success: boolean, count?: number, error?: string }>}
 */
export async function importPresets(file, mode = "merge") {
    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("mode", mode);

        const response = await fetch("/prompt_vault/api/import", {
            method: "POST",
            body: formData,
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("[PromptVault] Failed to import presets:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * 触发词库备份文件下载。
 */
export function triggerExportPresets() {
    window.open("/prompt_vault/api/export", "_blank");
}

/**
 * 解析缩略图静态服务访问 URL。
 * @param {string} filename - 缩略图文件名
 * @returns {string} 绝对访问 URL
 */
export function getThumbnailUrl(filename) {
    if (!filename) return "";
    return `/prompt_vault/api/thumbnails/${encodeURIComponent(filename)}`;
}