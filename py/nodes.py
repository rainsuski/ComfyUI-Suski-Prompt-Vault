# File: ComfyUI-Suski-Prompt-Vault/py/nodes.py
"""ComfyUI 自定义节点与提示词加权拼接引擎。

定义 PromptVaultSelector 节点类，解析前端传递的磁贴序列并实现加权格式化与清洗。
支持 prompt/text 双字段键兼容，对 Nodes 2.0 序列化通道进行静默隐藏标记，
并提供数据探针元数据自省协议接口。
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple, Union

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
                        "hidden": True,
                        "hideInPanel": True,
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

    @classmethod
    def parse_tiles(
        cls, selected_tiles_data: Union[str, List[Dict[str, Any]]]
    ) -> List[Dict[str, Any]]:
        """解析磁贴数据结构。"""
        if isinstance(selected_tiles_data, list):
            return [t for t in selected_tiles_data if isinstance(t, dict)]
        if not isinstance(selected_tiles_data, str) or not selected_tiles_data.strip():
            return []
        try:
            parsed = json.loads(selected_tiles_data)
            if isinstance(parsed, list):
                return [t for t in parsed if isinstance(t, dict)]
        except (json.JSONDecodeError, TypeError) as err:
            logger.warning("Failed to decode selected_tiles_data: %s", str(err))
        return []

    @classmethod
    def build_prompt(
        cls,
        selected_tiles_data: Union[str, List[Dict[str, Any]]] = "[]",
        prepend_prompt: str = "",
        append_prompt: str = "",
        **kwargs: Any,
    ) -> str:
        """根据磁贴序列及前置/后置文本生成加权清洗后的提示词。

        加权规则：
            - weight == 1.0: 保持原始内容，不添加外层包裹。
            - weight != 1.0: 格式化为 (prompt:weight)。
            - 忽略所有处于静音 (enabled == false) 状态的磁贴。
        """
        tiles = cls.parse_tiles(selected_tiles_data)
        segments: List[str] = []

        # 1. 前置提示词
        if prepend_prompt and str(prepend_prompt).strip():
            segments.append(str(prepend_prompt).strip())

        # 2. 磁贴序列加权处理
        for tile in tiles:
            enabled = tile.get("enabled", True)
            if not enabled:
                continue

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
        if append_prompt and str(append_prompt).strip():
            segments.append(str(append_prompt).strip())

        # 4. 规范化清洗
        raw_combined = ", ".join(segments)
        cleaned_prompt = re.sub(r",\s*,+", ", ", raw_combined)
        cleaned_prompt = re.sub(r"\s+", " ", cleaned_prompt).strip()
        cleaned_prompt = cleaned_prompt.strip(",").strip()
        return cleaned_prompt

    @classmethod
    def get_probe_metadata(
        cls, inputs: Dict[str, Any], runtime_output: Optional[str] = None
    ) -> Dict[str, Any]:
        """供数据探针自动嗅探的协议接口。

        由节点自主向探针上报生成的文本及结构化磁贴元数据。
        """
        final_prompt = (
            runtime_output
            if (runtime_output is not None and str(runtime_output).strip())
            else cls.build_prompt(
                selected_tiles_data=inputs.get("selected_tiles_data", "[]"),
                prepend_prompt=inputs.get("prepend_prompt", ""),
                append_prompt=inputs.get("append_prompt", ""),
            )
        )

        tiles = cls.parse_tiles(inputs.get("selected_tiles_data", "[]"))
        enabled_tiles = [t for t in tiles if t.get("enabled", True)]

        return {
            "prompt": final_prompt,
            "vault_tiles": enabled_tiles,
            "tiles": enabled_tiles,
        }

    def generate_prompt(
        self,
        selected_tiles_data: str = "[]",
        prepend_prompt: str = "",
        append_prompt: str = "",
        **kwargs: Any,
    ) -> Tuple[str]:
        """执行节点生成提示词逻辑。"""
        cleaned_prompt = self.build_prompt(
            selected_tiles_data=selected_tiles_data,
            prepend_prompt=prepend_prompt,
            append_prompt=append_prompt,
            **kwargs,
        )
        return (cleaned_prompt,)
