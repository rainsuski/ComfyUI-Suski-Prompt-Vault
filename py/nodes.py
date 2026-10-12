# File: ComfyUI-Suski-Prompt-Vault/py/nodes.py
"""ComfyUI 自定义节点与提示词加权拼接引擎。

定义 PromptVaultSelector 节点类，解析前端传递的磁贴序列并实现加权格式化与清洗。
支持 prompt/text 双字段键兼容。
"""

import json
import logging
import re
from typing import Any, Dict, List, Tuple

logger = logging.getLogger("ComfyUI-Suski-Prompt-Vault")


class PromptVaultSelector:
    """提示词词库选择器核心节点类。"""

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        """定义输入插槽规格。"""
        return {
            "required": {
                "selected_tiles_data": (
                    "STRING",
                    {
                        "default": "[]",
                        "multiline": False,
                    },
                ),
            },
            "optional": {
                "prepend_prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "forceInput": True,
                        "default": "",
                    },
                ),
                "append_prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "forceInput": True,
                        "default": "",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "generate_prompt"
    CATEGORY = "Prompt / Conditioning"

    def generate_prompt(
        self,
        selected_tiles_data: str = "[]",
        prepend_prompt: str = "",
        append_prompt: str = "",
        **kwargs: Any,
    ) -> Tuple[str]:
        """解析已选磁贴并结合前置/后置输入拼接成最终字符串。

        加权规则：
            - weight == 1.0: 保持原始内容，不添加外层包裹。
            - weight != 1.0: 格式化为 (prompt:weight)。
            - 忽略所有处于静音 (enabled == false) 状态的磁贴。
        """
        tiles: List[Dict[str, Any]] = []
        try:
            parsed = json.loads(selected_tiles_data)
            if isinstance(parsed, list):
                tiles = parsed
        except (json.JSONDecodeError, TypeError) as err:
            logger.warning("Failed to decode selected_tiles_data: %s", str(err))
            tiles = []

        segments: List[str] = []

        # 1. 前置提示词
        if prepend_prompt and prepend_prompt.strip():
            segments.append(prepend_prompt.strip())

        # 2. 磁贴序列加权处理
        for tile in tiles:
            if not isinstance(tile, dict):
                continue

            enabled = tile.get("enabled", True)
            if not enabled:
                continue

            # 支持 text (标准字段) 与 prompt 字段
            prompt_content = (tile.get("text") or tile.get("prompt") or "").strip()
            if not prompt_content:
                continue

            try:
                weight = float(tile.get("weight", 1.0))
            except (ValueError, TypeError):
                weight = 1.0

            if abs(weight - 1.0) < 0.001:
                formatted_segment = prompt_content
            else:
                formatted_weight = f"{weight:.2f}".rstrip("0").rstrip(".")
                formatted_segment = f"({prompt_content}:{formatted_weight})"

            segments.append(formatted_segment)

        # 3. 后置提示词
        if append_prompt and append_prompt.strip():
            segments.append(append_prompt.strip())

        # 4. 规范化逗号清洗
        raw_combined = ", ".join(segments)
        cleaned_prompt = re.sub(r",\s*,+", ", ", raw_combined)
        cleaned_prompt = re.sub(r"\s+", " ", cleaned_prompt).strip()
        cleaned_prompt = cleaned_prompt.strip(",").strip()

        return (cleaned_prompt,)
