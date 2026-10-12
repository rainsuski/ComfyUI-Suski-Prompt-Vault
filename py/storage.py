# File: ComfyUI-Suski-Prompt-Vault/py/storage.py
"""数据持久化与文件安全读写模块。

提供线程安全的 JSON 文件原子写入操作、词库 CRUD 封装、缩略图管理以及
多级嵌套分类与收藏夹的配置树持久化服务。
"""

import json
import logging
import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import PRESETS_FILE, TAXONOMIES_FILE, THUMBNAILS_DIR

logger = logging.getLogger("ComfyUI-Suski-Prompt-Vault")


class StorageManager:
    """词库数据与分类结构持久化管理器。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def _read_json_file(self, target_path: Path, default_value: Any) -> Any:
        """从指定文件路径安全读取 JSON 数据。"""
        if not target_path.exists():
            return default_value
        try:
            with open(target_path, "r", encoding="utf-8") as file:
                return json.load(file)
        except (json.JSONDecodeError, OSError) as err:
            logger.error("Failed to read %s: %s", target_path.name, str(err))
            return default_value

    def _write_atomic(self, target_path: Path, data: Any) -> bool:
        """采用原子重命名方式写入 JSON 文件，保障持久化安全性。"""
        temp_file_path: Optional[str] = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=target_path.parent,
                delete=False,
            ) as temp_file:
                temp_file_path = temp_file.name
                json.dump(data, temp_file, ensure_ascii=False, indent=2)
                temp_file.flush()
                os.fsync(temp_file.fileno())

            shutil.move(temp_file_path, str(target_path))
            return True
        except Exception as err:
            logger.error(
                "Failed to write %s atomically: %s", target_path.name, str(err)
            )
            if temp_file_path and os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            return False

    def get_all_presets(self) -> Tuple[List[Dict[str, Any]], List[str]]:
        """获取所有词库预设条目并提取全部不重复的分类。"""
        with self._lock:
            items: List[Dict[str, Any]] = self._read_json_file(PRESETS_FILE, [])
            categories_set = set()
            for item in items:
                category = item.get("category", "").strip()
                if category:
                    categories_set.add(category)
            categories = sorted(list(categories_set))
            return items, categories

    def upsert_preset(self, preset_data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        """新增或更新词库条目。"""
        with self._lock:
            items: List[Dict[str, Any]] = self._read_json_file(PRESETS_FILE, [])
            target_id = preset_data.get("id")
            current_timestamp = int(time.time() * 1000)

            if not target_id:
                target_id = str(uuid.uuid4())
                preset_data["id"] = target_id
                preset_data["created_at"] = current_timestamp

            preset_data["updated_at"] = current_timestamp
            preset_data.setdefault("title", "未命名词条")
            preset_data.setdefault("prompt", "")
            preset_data.setdefault("category", "默认")
            preset_data.setdefault("tags", [])
            preset_data.setdefault("favorite", False)
            preset_data.setdefault("folder", "")
            preset_data.setdefault("note", "")
            preset_data.setdefault("thumbnail", "")

            found = False
            for idx, existing in enumerate(items):
                if existing.get("id") == target_id:
                    preset_data.setdefault(
                        "created_at", existing.get("created_at", current_timestamp)
                    )
                    items[idx] = preset_data
                    found = True
                    break

            if not found:
                items.insert(0, preset_data)

            success = self._write_atomic(PRESETS_FILE, items)
            return success, preset_data

    def delete_preset(self, preset_id: str) -> bool:
        """删除指定词条并同步清理其关联的缩略图文件。"""
        with self._lock:
            items: List[Dict[str, Any]] = self._read_json_file(PRESETS_FILE, [])
            target_item: Optional[Dict[str, Any]] = None
            filtered_items: List[Dict[str, Any]] = []

            for item in items:
                if item.get("id") == preset_id:
                    target_item = item
                else:
                    filtered_items.append(item)

            if target_item is None:
                return False

            thumbnail_path = target_item.get("thumbnail")
            if thumbnail_path:
                self.delete_thumbnail_file(thumbnail_path)

            return self._write_atomic(PRESETS_FILE, filtered_items)

    def save_thumbnail_bytes(self, image_bytes: bytes, extension: str) -> Optional[str]:
        """将上传的缩略图字节数据安全写入缩略图目录。"""
        clean_ext = extension.lstrip(".").lower()
        if clean_ext not in ["png", "jpg", "jpeg", "webp", "gif"]:
            clean_ext = "webp"

        filename = f"{uuid.uuid4().hex}.{clean_ext}"
        destination = THUMBNAILS_DIR / filename

        try:
            with open(destination, "wb") as file:
                file.write(image_bytes)
            return filename
        except OSError as err:
            logger.error("Failed to write thumbnail: %s", str(err))
            return None

    def delete_thumbnail_file(self, filename: str) -> None:
        """删除缩略图物理文件。"""
        if not filename:
            return
        safe_name = os.path.basename(filename)
        target = THUMBNAILS_DIR / safe_name
        if target.exists() and target.is_file():
            try:
                target.unlink()
            except OSError as err:
                logger.warning(
                    "Failed to delete thumbnail file %s: %s", safe_name, str(err)
                )

    def import_presets(
        self, imported_items: List[Dict[str, Any]], mode: str = "merge"
    ) -> Tuple[bool, int]:
        """导入预设列表。"""
        with self._lock:
            valid_items: List[Dict[str, Any]] = []
            for raw in imported_items:
                if not isinstance(raw, dict) or "prompt" not in raw:
                    continue
                item = dict(raw)
                if not item.get("id"):
                    item["id"] = str(uuid.uuid4())
                item.setdefault("title", "导入词条")
                item.setdefault("category", "默认")
                item.setdefault("tags", [])
                item.setdefault("favorite", False)
                item.setdefault("folder", "")
                item.setdefault("note", "")
                item.setdefault("thumbnail", "")
                item.setdefault("created_at", int(time.time() * 1000))
                item.setdefault("updated_at", int(time.time() * 1000))
                valid_items.append(item)

            if mode == "overwrite":
                success = self._write_atomic(PRESETS_FILE, valid_items)
                return success, len(valid_items)

            existing_items: List[Dict[str, Any]] = self._read_json_file(
                PRESETS_FILE, []
            )
            existing_map = {it["id"]: it for it in existing_items if "id" in it}

            for item in valid_items:
                existing_map[item["id"]] = item

            merged_list = list(existing_map.values())
            success = self._write_atomic(PRESETS_FILE, merged_list)
            return success, len(merged_list)

    def get_taxonomies(self) -> Dict[str, Any]:
        """获取全量层级分类与收藏夹配置，附带词条关联数量统计。"""
        with self._lock:
            taxonomies: Dict[str, Any] = self._read_json_file(
                TAXONOMIES_FILE, {"categories": [], "folders": []}
            )
            presets: List[Dict[str, Any]] = self._read_json_file(PRESETS_FILE, [])

            category_counts: Dict[str, int] = {}
            folder_counts: Dict[str, int] = {}

            for item in presets:
                cat = item.get("category", "")
                if cat:
                    category_counts[cat] = category_counts.get(cat, 0) + 1

                if item.get("favorite") and item.get("folder"):
                    fld = item.get("folder")
                    folder_counts[fld] = folder_counts.get(fld, 0) + 1

            categories = taxonomies.get("categories", [])
            for c in categories:
                c["count"] = category_counts.get(c.get("name", ""), 0)

            folders = taxonomies.get("folders", [])
            for f in folders:
                f["count"] = folder_counts.get(f.get("name", ""), 0)

            return {
                "categories": categories,
                "folders": folders,
            }

    def upsert_taxonomy_item(
        self, item_type: str, item_data: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any]]:
        """新增或更新单个分类或收藏夹节点。"""
        with self._lock:
            taxonomies: Dict[str, Any] = self._read_json_file(
                TAXONOMIES_FILE, {"categories": [], "folders": []}
            )
            key = "categories" if item_type == "category" else "folders"
            items: List[Dict[str, Any]] = taxonomies.get(key, [])

            target_id = item_data.get("id")
            if not target_id:
                target_id = f"{item_type}_{uuid.uuid4().hex[:8]}"
                item_data["id"] = target_id

            item_data.setdefault("name", "新建项")
            item_data.setdefault("parent_id", None)
            item_data.setdefault("order", len(items))

            if item_type == "category":
                item_data.setdefault("color", "#3b82f6")

            found = False
            for idx, existing in enumerate(items):
                if existing.get("id") == target_id:
                    items[idx] = {**existing, **item_data}
                    found = True
                    break

            if not found:
                items.append(item_data)

            taxonomies[key] = items
            success = self._write_atomic(TAXONOMIES_FILE, taxonomies)
            return success, item_data

    def delete_taxonomy_item(self, item_type: str, item_id: str) -> bool:
        """删除指定分类或收藏夹节点，并递归清理其子节点。"""
        with self._lock:
            taxonomies: Dict[str, Any] = self._read_json_file(
                TAXONOMIES_FILE, {"categories": [], "folders": []}
            )
            key = "categories" if item_type == "category" else "folders"
            items: List[Dict[str, Any]] = taxonomies.get(key, [])

            ids_to_delete = {item_id}
            changed = True
            while changed:
                changed = False
                for it in items:
                    if (
                        it.get("parent_id") in ids_to_delete
                        and it.get("id") not in ids_to_delete
                    ):
                        ids_to_delete.add(it.get("id"))
                        changed = True

            filtered = [it for it in items if it.get("id") not in ids_to_delete]
            taxonomies[key] = filtered
            return self._write_atomic(TAXONOMIES_FILE, taxonomies)


storage_manager = StorageManager()
