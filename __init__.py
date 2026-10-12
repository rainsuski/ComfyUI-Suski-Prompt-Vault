# File: ComfyUI-Suski-Prompt-Vault/__init__.py
"""ComfyUI-Suski-Prompt-Vault 主扩展注册入口。

注册节点映射、Web 前端目录以及 RESTful 路由服务。
"""

import logging
from .py.nodes import PromptVaultSelector
from .py.routes import register_routes

logger = logging.getLogger("ComfyUI-Suski-Prompt-Vault")

# 注册自定义节点类映射
NODE_CLASS_MAPPINGS = {
    "PromptVaultSelector": PromptVaultSelector,
}

# 注册画布节点展示名称
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptVaultSelector": "Prompt Vault Selector (提示词库选择器)",
}

# 注册前端 Web 静态资源目录
WEB_DIRECTORY = "./web"

# 注册 aiohttp API 服务端路由
try:
    register_routes()
    logger.info("ComfyUI-Suski-Prompt-Vault routes registered successfully.")
except Exception as err:
    logger.error("Failed to register ComfyUI-Suski-Prompt-Vault routes: %s", str(err))

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
