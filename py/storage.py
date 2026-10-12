# File: ComfyUI-Suski-Prompt-Vault/py/storage.py
"""数据持久化与安全读写存储模块。

基于 aaalice-prompt-library v2 标准数据模型实现统一单文件管理，
提供线程安全的原子写入、分类树与子级级联/提升、标签映射及词条 CRUD 操作。
"""

import json
import logging
import os
import shutil
import tempfile
import threading
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

from .config import DEFAULT_LIBRARY, LIBRARY_FILE, THUMBNAILS_DIR

logger = logging.getLogger("ComfyUI-Suski-Prompt-Vault")


class StorageManager:
    """单文件标准化词库持久化管理器。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def _read_library(self) -> Dict[str, Any]:
        """从磁盘安全读取完整词库 JSON 对象，若结构缺失则安全初始化。"""
        if not LIBRARY_FILE.exists():
            default_copy = json.loads(json.dumps(DEFAULT_LIBRARY))
            self._write_atomic(default_copy)
            return default_copy
        try:
            with open(LIBRARY_FILE, "r", encoding="utf-8-sig") as file:
                data = json.load(file)
                if isinstance(data, dict):
                    data.setdefault("format", "aaalice-prompt-library")
                    data.setdefault("version", 2)
                    data.setdefault("categories", [])
                    data.setdefault("collections", [])
                    data.setdefault("tags", [])
                    data.setdefault("entries", [])
                    data.setdefault("selection", {"entryIds": []})
                    return data
                default_copy = json.loads(json.dumps(DEFAULT_LIBRARY))
                self._write_atomic(default_copy)
                return default_copy
        except (json.JSONDecodeError, OSError) as err:
            logger.error("Failed to read library.json: %s", str(err))
            default_copy = json.loads(json.dumps(DEFAULT_LIBRARY))
            self._write_atomic(default_copy)
            return default_copy

    def _write_atomic(self, data: Dict[str, Any]) -> bool:
        """采用原子重命名方式安全写入 library.json。"""
        temp_file_path: Optional[str] = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=LIBRARY_FILE.parent,
                delete=False,
            ) as temp_file:
                temp_file_path = temp_file.name
                json.dump(data, temp_file, ensure_ascii=False, indent=2)
                temp_file.flush()
                os.fsync(temp_file.fileno())

            shutil.move(temp_file_path, str(LIBRARY_FILE))
            return True
        except Exception as err:
            logger.error("Failed to write library.json atomically: %s", str(err))
            if temp_file_path and os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            return False

    def get_full_library(self) -> Dict[str, Any]:
        """获取当前完整词库数据。"""
        with self._lock:
            return self._read_library()

    def upsert_entry(
        self, entry_payload: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any]]:
        """新增或更新提示词条目。"""
        with self._lock:
            lib = self._read_library()
            entries: List[Dict[str, Any]] = lib.setdefault("entries", [])
            tags_list: List[Dict[str, Any]] = lib.setdefault("tags", [])
            tags_map = {t["name"]: t["id"] for t in tags_list if "name" in t}

            target_id = entry_payload.get("id") or str(uuid.uuid4())
            now_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

            raw_tags = entry_payload.get("tags") or []
            tag_ids = list(entry_payload.get("tagIds") or [])
            if isinstance(raw_tags, list):
                for tag_name in raw_tags:
                    clean_name = str(tag_name).strip()
                    if not clean_name:
                        continue
                    if clean_name not in tags_map:
                        new_tag_id = str(uuid.uuid4())
                        tags_list.append({"id": new_tag_id, "name": clean_name})
                        tags_map[clean_name] = new_tag_id
                    if tags_map[clean_name] not in tag_ids:
                        tag_ids.append(tags_map[clean_name])

            entry_item = {
                "id": target_id,
                "title": entry_payload.get("title") or "未命名词条",
                "text": entry_payload.get("text") or entry_payload.get("prompt") or "",
                "note": entry_payload.get("note") or "",
                "position": entry_payload.get("position", len(entries)),
                "categoryId": entry_payload.get("categoryId")
                or entry_payload.get("category_id")
                or None,
                "previewHash": entry_payload.get("previewHash")
                or entry_payload.get("thumbnail")
                or None,
                "updatedAt": now_str,
                "tagIds": tag_ids,
                "collections": entry_payload.get("collections") or [],
            }

            found = False
            for idx, existing in enumerate(entries):
                if existing.get("id") == target_id:
                    entries[idx] = {**existing, **entry_item}
                    found = True
                    break

            if not found:
                entries.insert(0, entry_item)

            success = self._write_atomic(lib)
            return success, entry_item

    def delete_entry(self, entry_id: str) -> bool:
        """删除指定词条。"""
        with self._lock:
            lib = self._read_library()
            entries = lib.get("entries", [])
            target = next((e for e in entries if e.get("id") == entry_id), None)
            if not target:
                return False

            preview_hash = target.get("previewHash")
            if preview_hash:
                self.delete_thumbnail_file(preview_hash)

            lib["entries"] = [e for e in entries if e.get("id") != entry_id]
            return self._write_atomic(lib)

    def upsert_category(
        self, cat_payload: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any]]:
        """新增或更新层级分类。"""
        with self._lock:
            lib = self._read_library()
            categories: List[Dict[str, Any]] = lib.setdefault("categories", [])
            target_id = cat_payload.get("id") or str(uuid.uuid4())

            cat_item = {
                "id": target_id,
                "name": cat_payload.get("name") or "新建分类",
                "position": cat_payload.get("position", len(categories)),
                "color": cat_payload.get("color") or "#3b82f6",
                "parentId": cat_payload.get("parentId")
                or cat_payload.get("parent_id")
                or None,
            }

            found = False
            for idx, existing in enumerate(categories):
                if existing.get("id") == target_id:
                    categories[idx] = {**existing, **cat_item}
                    found = True
                    break

            if not found:
                categories.append(cat_item)

            success = self._write_atomic(lib)
            return success, cat_item

    def delete_category(self, cat_id: str, delete_branch: bool = False) -> bool:
        """删除指定分类。"""
        with self._lock:
            lib = self._read_library()
            categories: List[Dict[str, Any]] = lib.get("categories", [])
            target = next((c for c in categories if c.get("id") == cat_id), None)
            if not target:
                return False

            entries: List[Dict[str, Any]] = lib.get("entries", [])

            if delete_branch:
                ids_to_del = {cat_id}
                changed = True
                while changed:
                    changed = False
                    for c in categories:
                        if (
                            c.get("parentId") in ids_to_del
                            and c.get("id") not in ids_to_del
                        ):
                            ids_to_del.add(c.get("id"))
                            changed = True

                lib["categories"] = [
                    c for c in categories if c.get("id") not in ids_to_del
                ]
                for e in entries:
                    if e.get("categoryId") in ids_to_del:
                        e["categoryId"] = None
            else:
                p_id = target.get("parentId")
                for c in categories:
                    if c.get("parentId") == cat_id:
                        c["parentId"] = p_id

                lib["categories"] = [c for c in categories if c.get("id") != cat_id]
                for e in entries:
                    if e.get("categoryId") == cat_id:
                        e["categoryId"] = None

            return self._write_atomic(lib)

    def upsert_collection(
        self, col_payload: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any]]:
        """新增或更新收藏夹。"""
        with self._lock:
            lib = self._read_library()
            collections: List[Dict[str, Any]] = lib.setdefault("collections", [])
            target_id = col_payload.get("id") or str(uuid.uuid4())

            col_item = {
                "id": target_id,
                "name": col_payload.get("name") or "新建收藏夹",
            }

            found = False
            for idx, existing in enumerate(collections):
                if existing.get("id") == target_id:
                    collections[idx] = {**existing, **col_item}
                    found = True
                    break

            if not found:
                collections.append(col_item)

            success = self._write_atomic(lib)
            return success, col_item

    def delete_collection(self, col_id: str) -> bool:
        """删除指定收藏夹。"""
        with self._lock:
            lib = self._read_library()
            collections = lib.get("collections", [])
            lib["collections"] = [c for c in collections if c.get("id") != col_id]

            for e in lib.get("entries", []):
                if col_id in e.get("collections", []):
                    e["collections"].remove(col_id)

            return self._write_atomic(lib)

    def import_library(
        self, imported_data: Dict[str, Any], mode: str = "overwrite"
    ) -> Tuple[bool, int]:
        """导入外部词库标准包。"""
        with self._lock:
            if not isinstance(imported_data, dict):
                return False, 0

            imported_data["format"] = "aaalice-prompt-library"
            imported_data.setdefault("version", 2)
            imported_data.setdefault("categories", [])
            imported_data.setdefault("collections", [])
            imported_data.setdefault("tags", [])
            imported_data.setdefault("entries", [])
            imported_data.setdefault("selection", {"entryIds": []})

            if mode == "overwrite":
                success = self._write_atomic(imported_data)
                return success, len(imported_data["entries"])

            cur = self._read_library()

            cat_map = {c["id"]: c for c in cur.get("categories", [])}
            for c in imported_data.get("categories", []):
                cat_map[c["id"]] = c
            cur["categories"] = list(cat_map.values())

            col_map = {c["id"]: c for c in cur.get("collections", [])}
            for c in imported_data.get("collections", []):
                col_map[c["id"]] = c
            cur["collections"] = list(col_map.values())

            tag_map = {t["id"]: t for t in cur.get("tags", [])}
            for t in imported_data.get("tags", []):
                tag_map[t["id"]] = t
            cur["tags"] = list(tag_map.values())

            ent_map = {e["id"]: e for e in cur.get("entries", [])}
            for e in imported_data.get("entries", []):
                ent_map[e["id"]] = e
            cur["entries"] = list(ent_map.values())

            success = self._write_atomic(cur)
            return success, len(cur["entries"])

    def save_thumbnail_bytes(self, image_bytes: bytes, extension: str) -> Optional[str]:
        """保存图片并返回哈希文件名。"""
        clean_ext = extension.lstrip(".").lower()
        if clean_ext not in ["png", "jpg", "jpeg", "webp", "gif"]:
            clean_ext = "webp"

        filename = f"{uuid.uuid4().hex}.{clean_ext}"
        dest = THUMBNAILS_DIR / filename
        try:
            with open(dest, "wb") as f:
                f.write(image_bytes)
            return filename
        except OSError as err:
            logger.error("Failed to save thumbnail: %s", str(err))
            return None

    def delete_thumbnail_file(self, filename: str) -> None:
        """删除物理缩略图。"""
        if not filename:
            return
        target = THUMBNAILS_DIR / os.path.basename(filename)
        if target.exists() and target.is_file():
            try:
                target.unlink()
            except OSError as err:
                logger.warning("Failed to delete thumbnail %s: %s", filename, str(err))


storage_manager = StorageManager()
