/* File: ComfyUI-Suski-Prompt-Vault/web/js/components/modals/category_helper.js */

/**
 * 分类层级树选项构建辅助模块。
 * 递归扁平化无限极树形分类为带制表前缀的下拉选择项列表。
 */

/**
 * 递归扁平化分类树为带缩进的前缀下拉选项。
 * @param {any[]} categories - 原始分类实体数组
 * @returns {{ id: string, name: string, label: string }[]}
 */
export function buildCategoryHierarchyOptions(categories) {
    const result = [{ id: "", name: "未分类", label: "未分类" }];
    const map = new Map();
    const roots = [];

    (categories || []).forEach((c) => {
        map.set(c.id, { ...c, children: [] });
    });

    (categories || []).forEach((c) => {
        if (c.parentId && map.has(c.parentId)) {
            map.get(c.parentId).children.push(map.get(c.id));
        } else {
            roots.push(map.get(c.id));
        }
    });

    function traverse(node, depth) {
        const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}└─ `;
        result.push({
            id: node.id,
            name: node.name,
            label: `${prefix}${node.name}`,
        });
        if (node.children) {
            node.children.forEach((child) => traverse(child, depth + 1));
        }
    }

    roots.forEach((root) => traverse(root, 0));
    return result;
}