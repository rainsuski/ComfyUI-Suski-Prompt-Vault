# File: ComfyUI-Suski-Prompt-Vault/py/nodes.py
"""ComfyUI 自定义节点与提示词加权拼接引擎。

定义 PromptVaultSelector 节点类，解析前端传递的磁贴序列并实现差异化拼接：
- Tag 片段执行空白/逗号规范化清洗及 (prompt:weight) 加权；
- 自然语言 (NL) 片段保留原始文本（含首尾空格、换行与标点），不做权重包裹；
- NL 与 NL 相邻时不插入分隔符（由用户自行控制），Tag 与任何类型相邻均以 ", " 拼接；
- 对 Nodes 2.0 序列化通道进行静默隐藏标记，并提供数据探针元数据自省协议接口。
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
    def _clean_tag_text(cls, raw_text: str) -> str:
        """规范化 Tag 文本：消除多余连续逗号、折叠冗余空白并清理首尾逗号。"""
        cleaned = re.sub(r",\s*,+", ", ", raw_text or "")
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned.strip(",").strip()

    @classmethod
    def _clean_boundary_prompt(cls, raw_text: str) -> str:
        """清理外置前后置提示词的首尾逗号与空白，同时保留内部换行。"""
        if not raw_text:
            return ""
        cleaned = re.sub(r",\s*,+", ", ", str(raw_text))
        return cleaned.strip().strip(",").strip()

    @classmethod
    def build_prompt(
        cls,
        selected_tiles_data: Union[str, List[Dict[str, Any]]] = "[]",
        prepend_prompt: str = "",
        append_prompt: str = "",
        **kwargs: Any,
    ) -> str:
        """根据磁贴序列及前置/后置文本生成最终拼接提示词。

        输出规则：
            - use_nl == true: 原样保留 nl 文本（仅跳过纯空白项），不做权重包裹与空白裁剪。
            - use_nl == false: 清洗 text/prompt；weight == 1.0 时保持原貌，否则格式化为 (prompt:weight)。
            - prepend_prompt / append_prompt 按 Tag 规则与相邻片段衔接。
            - 忽略所有处于静音 (enabled == false) 状态的磁贴。
            - 拼接分隔符：NL 与 NL 之间无分隔符；Tag 与任何类型之间使用 ", "。
        """
        tiles = cls.parse_tiles(selected_tiles_data)
        segments: List[Tuple[str, str]] = []

        # 1. 前置提示词（按 Tag 类型衔接）
        if prepend_prompt and str(prepend_prompt).strip():
            cleaned_prepend = cls._clean_boundary_prompt(str(prepend_prompt))
            if cleaned_prepend:
                segments.append(("tag", cleaned_prepend))

        # 2. 磁贴序列提取与按类型格式化
        for tile in tiles:
            enabled = tile.get("enabled", True)
            if not enabled:
                continue

            use_nl = bool(tile.get("use_nl", False))
            if use_nl:
                nl_raw = tile.get("nl") or ""
                if not isinstance(nl_raw, str):
                    nl_raw = str(nl_raw)
                # 仅以空白校验过滤空条目，保留非空自然语言的首尾空格、换行与标点
                if not nl_raw.strip():
                    continue
                segments.append(("nl", nl_raw))
                continue

            raw_tag = tile.get("text") or tile.get("prompt") or ""
            if not isinstance(raw_tag, str):
                raw_tag = str(raw_tag)
            prompt_content = cls._clean_tag_text(raw_tag)
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

            segments.append(("tag", formatted_segment))

        # 3. 后置提示词（按 Tag 类型衔接）
        if append_prompt and str(append_prompt).strip():
            cleaned_append = cls._clean_boundary_prompt(str(append_prompt))
            if cleaned_append:
                segments.append(("tag", cleaned_append))

        if not segments:
            return ""

        # 4. 按相邻片段类型差异化拼接，不在全局做空白或逗号清洗以保护 NL 格式
        parts: List[str] = [segments[0][1]]
        for idx in range(1, len(segments)):
            prev_type, _ = segments[idx - 1]
            curr_type, curr_text = segments[idx]
            if prev_type == "nl" and curr_type == "nl":
                parts.append(curr_text)
            else:
                parts.append(", ")
                parts.append(curr_text)

        return "".join(parts)

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
