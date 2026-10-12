/* File: ComfyUI-Suski-Prompt-Vault/web/js/api.js */

/**
 * 后端 RESTful API 交互服务模块。
 * 针对 aaalice-prompt-library v2 标准数据结构量身定制，
 * 提供全量库读取、条目/分类/收藏夹 CRUD、单文件备份直接导入导出与缩略图加载。
 */

/**
 * 获取全量标准词库数据 (library.json)。
 * @returns {Promise<{ success: boolean, data: { format: string, version: number, categories: any[], collections: any[], tags: any[], entries: any[], selection: any } }>}
 */
export async function fetchLibrary() {
    try {
        const response = await fetch("/prompt_vault/api/library", {
            method: "GET",
            headers: { "Accept": "application/json" },
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("[PromptVault] Failed to fetch library:", error);
        return {
            success: false,
            data: {
                format: "aaalice-prompt-library",
                version: 2,
                categories: [],
                collections: [],
                tags: [],
                entries: [],
                selection: { entryIds: [] },
            },
        };
    }
}

/**
 * 新增或更新词条（支持上传图片）。
 * @param {any} entryPayload - 词条属性字典
 * @param {File|Blob|null} [thumbnailFile=null] - 缩略图文件
 * @returns {Promise<{ success: boolean, data?: any, error?: string }>}
 */
export async function upsertEntry(entryPayload, thumbnailFile = null) {
    try {
        let response;
        if (thumbnailFile) {
            const formData = new FormData();
            formData.append("data", JSON.stringify(entryPayload));
            formData.append("thumbnail", thumbnailFile, "preview.webp");
            response = await fetch("/prompt_vault/api/entries", {
                method: "POST",
                body: formData,
            });
        } else {
            response = await fetch("/prompt_vault/api/entries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entryPayload),
            });
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("[PromptVault] Failed to upsert entry:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * 删除指定词条。
 * @param {string} entryId
 * @returns {Promise<boolean>}
 */
export async function deleteEntry(entryId) {
    try {
        const response = await fetch(`/prompt_vault/api/entries/${encodeURIComponent(entryId)}`, {
            method: "DELETE",
        });
        if (!response.ok) return false;
        const result = await response.json();
        return Boolean(result.success);
    } catch (error) {
        console.error("[PromptVault] Failed to delete entry:", error);
        return false;
    }
}

/**
 * 新增或更新分类。
 * @param {any} catPayload
 * @returns {Promise<{ success: boolean, data?: any }>}
 */
export async function upsertCategory(catPayload) {
    try {
        const response = await fetch("/prompt_vault/api/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(catPayload),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("[PromptVault] Failed to upsert category:", error);
        return { success: false };
    }
}

/**
 * 删除指定分类（支持级联分支删除）。
 * @param {string} catId
 * @param {boolean} [deleteBranch=false]
 * @returns {Promise<boolean>}
 */
export async function deleteCategory(catId, deleteBranch = false) {
    try {
        const query = deleteBranch ? "?branch=true" : "?branch=false";
        const response = await fetch(
            `/prompt_vault/api/categories/${encodeURIComponent(catId)}${query}`,
            { method: "DELETE" }
        );
        if (!response.ok) return false;
        const result = await response.json();
        return Boolean(result.success);
    } catch (error) {
        console.error("[PromptVault] Failed to delete category:", error);
        return false;
    }
}

/**
 * 新增或更新收藏夹。
 * @param {any} colPayload
 * @returns {Promise<{ success: boolean, data?: any }>}
 */
export async function upsertCollection(colPayload) {
    try {
        const response = await fetch("/prompt_vault/api/collections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(colPayload),
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("[PromptVault] Failed to upsert collection:", error);
        return { success: false };
    }
}

/**
 * 删除指定收藏夹。
 * @param {string} colId
 * @returns {Promise<boolean>}
 */
export async function deleteCollection(colId) {
    try {
        const response = await fetch(
            `/prompt_vault/api/collections/${encodeURIComponent(colId)}`,
            { method: "DELETE" }
        );
        if (!response.ok) return false;
        const result = await response.json();
        return Boolean(result.success);
    } catch (error) {
        console.error("[PromptVault] Failed to delete collection:", error);
        return false;
    }
}

/**
 * 直接导入外部标准格式 JSON 文件。
 * @param {File} file
 * @param {"overwrite"|"merge"} [mode="overwrite"]
 * @returns {Promise<{ success: boolean, count?: number, error?: string }>}
 */
export async function importLibrary(file, mode = "overwrite") {
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
        console.error("[PromptVault] Failed to import library:", error);
        return { success: false, error: String(error) };
    }
}

/**
 * 直接触发标准库文件下载。
 */
export function triggerExportLibrary() {
    window.open("/prompt_vault/api/export", "_blank");
}

/**
 * 解析缩略图绝对访问路径。
 * @param {string} filename
 * @returns {string}
 */
export function getThumbnailUrl(filename) {
    if (!filename) return "";
    return `/prompt_vault/api/thumbnails/${encodeURIComponent(filename)}`;
}