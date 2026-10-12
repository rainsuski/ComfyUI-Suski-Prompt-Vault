# File: ComfyUI-Suski-Prompt-Vault/py/config.py
"""全局路径配置与环境初始化模块。

负责定位当前插件根目录，确保运行时所需的数据目录、缩略图目录
及标准库核心文件 library.json 初始化就绪。
完全对齐 aaalice-prompt-library v2 数据标准。
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

# 统一词库持久化数据文件路径 (对齐 aaalice-prompt-library 标准)
LIBRARY_FILE: Path = DATA_DIR / "library.json"

# 初始种子库骨架数据
DEFAULT_LIBRARY: Dict[str, Any] = {
    "format": "aaalice-prompt-library",
    "version": 2,
    "categories": [
        {
            "id": "50a0ed4b-59f3-4226-b79d-416023562d99",
            "name": "角色",
            "position": 0,
            "color": "#7C3AED",
            "parentId": None,
        },
        {
            "id": "9072903f-b76a-4611-a4c2-d127d8b25ea5",
            "name": "服装",
            "position": 1,
            "color": "#2563EB",
            "parentId": None,
        },
        {
            "id": "8dbee550-deaf-4645-a454-60086ac7d6b7",
            "name": "质量词",
            "position": 2,
            "color": "#0891B2",
            "parentId": None,
        },
    ],
    "collections": [],
    "tags": [],
    "entries": [],
    "selection": {"entryIds": []},
}


def ensure_storage_environment() -> None:
    """初始化并确保数据目录、缩略图目录及标准 library.json 存在。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

    gitkeep_file = THUMBNAILS_DIR / ".gitkeep"
    if not gitkeep_file.exists():
        gitkeep_file.touch()

    if not LIBRARY_FILE.exists():
        with open(LIBRARY_FILE, "w", encoding="utf-8") as file:
            json.dump(DEFAULT_LIBRARY, file, ensure_ascii=False, indent=2)


# 模块加载时执行环境自检与初始化
ensure_storage_environment()
