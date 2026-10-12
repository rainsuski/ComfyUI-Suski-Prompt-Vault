# File: ComfyUI-Suski-Prompt-Vault/py/nodes.py
"""ComfyUI 自定义节点与提示词加权拼接引擎。

定义 PromptVaultSelector 节点类，解析前端传递的磁贴序列并实现加权格式化与清洗。
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
        """定义输入插槽规格。

        selected_tiles_data 作为 required 输入接收前端序列化的磁贴数组，
        配合前端隐藏 Widget 实现安全持久化与参数传递。
        """
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

        Args:
            selected_tiles_data: 序列化已选磁贴列表 JSON 字符串。
            prepend_prompt: 前置可选提示词。
            append_prompt: 后置可选提示词。
            **kwargs: 扩展兼容参数。

        Returns:
            Tuple[str]: 输出拼接后的最终提示词。
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

        # 1. 前置提示词处理
        if prepend_prompt and prepend_prompt.strip():
            segments.append(prepend_prompt.strip())

        # 2. 已选磁贴加权拼接处理
        for tile in tiles:
            if not isinstance(tile, dict):
                continue

            enabled = tile.get("enabled", True)
            if not enabled:
                continue

            prompt_content = tile.get("prompt", "").strip()
            if not prompt_content:
                continue

            try:
                weight = float(tile.get("weight", 1.0))
            except (ValueError, TypeError):
                weight = 1.0

            # 权重接近 1.0 时直接输出，否则使用标准权重包裹语法
            if abs(weight - 1.0) < 0.001:
                formatted_segment = prompt_content
            else:
                formatted_weight = f"{weight:.2f}".rstrip("0").rstrip(".")
                formatted_segment = f"({prompt_content}:{formatted_weight})"

            segments.append(formatted_segment)

        # 3. 后置提示词处理
        if append_prompt and append_prompt.strip():
            segments.append(append_prompt.strip())

        # 4. 连接与规范化逗号清洗
        raw_combined = ", ".join(segments)

        # 清除多重连续逗号与冗余空格
        cleaned_prompt = re.sub(r",\s*,+", ", ", raw_combined)
        cleaned_prompt = re.sub(r"\s+", " ", cleaned_prompt).strip()
        cleaned_prompt = cleaned_prompt.strip(",").strip()

        return (cleaned_prompt,)
