# File: ComfyUI-Suski-Prompt-Vault/py/config.py
"""全局路径配置与环境初始化模块。

负责定位当前插件根目录，确保运行时所需的数据目录、缩略图目录、
预设词库主数据文件以及分类与收藏夹层级配置数据文件初始化就绪。
"""

import json
from pathlib import Path
from typing import Any, Dict

# 获取插件根目录绝对路径
ROOT_DIR: Path = Path(__file__).resolve().parent.parent

# 用户数据持久化目录
DATA_DIR: Path = ROOT_DIR / "data"

# 缩略图专用存储目录
THUMBNAILS_DIR: Path = DATA_DIR / "thumbnails"

# 预设词库主数据文件路径
PRESETS_FILE: Path = DATA_DIR / "presets.json"

# 分类与收藏夹层级管理数据文件路径
TAXONOMIES_FILE: Path = DATA_DIR / "taxonomies.json"

# 初始分类与收藏夹种子数据
DEFAULT_TAXONOMIES: Dict[str, Any] = {
    "categories": [
        {
            "id": "cat_role",
            "name": "角色",
            "parent_id": None,
            "color": "#a855f7",
            "order": 0,
        },
        {
            "id": "cat_clothing",
            "name": "服装",
            "parent_id": None,
            "color": "#3b82f6",
            "order": 1,
        },
        {
            "id": "cat_quality",
            "name": "质量词",
            "parent_id": None,
            "color": "#06b6d4",
            "order": 2,
        },
    ],
    "folders": [
        {"id": "fld_default", "name": "默认收藏夹", "parent_id": None, "order": 0},
    ],
}


def ensure_storage_environment() -> None:
    """初始化并确保数据目录、缩略图目录及持久化数据文件存在。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

    gitkeep_file = THUMBNAILS_DIR / ".gitkeep"
    if not gitkeep_file.exists():
        gitkeep_file.touch()

    if not PRESETS_FILE.exists():
        with open(PRESETS_FILE, "w", encoding="utf-8") as file:
            file.write("[]")

    if not TAXONOMIES_FILE.exists():
        with open(TAXONOMIES_FILE, "w", encoding="utf-8") as file:
            json.dump(DEFAULT_TAXONOMIES, file, ensure_ascii=False, indent=2)


# 模块加载时执行环境自检与初始化
ensure_storage_environment()
