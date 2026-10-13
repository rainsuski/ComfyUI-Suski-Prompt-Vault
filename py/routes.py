# File: ComfyUI-Suski-Prompt-Vault/py/routes.py
"""ComfyUI aiohttp Web 服务端路由控制模块。

提供符合 suski-prompt-library v1 标准的词库全量读写、条目/组关系/分类/收藏夹 CRUD、
向下兼容旧格式智能容错导入、单文件直接导出以及旧路由全量别名映射。
支持在数据变更时向所有连接的客户端推送 WebSocket 广播通知。
"""

import json
import logging
import mimetypes
import os
from typing import Any, Dict

from aiohttp import web

from server import PromptServer

from .config import THUMBNAILS_DIR
from .storage import storage_manager

logger = logging.getLogger("ComfyUI-Suski-Prompt-Vault")


def broadcast_library_changed(detail: str = "") -> None:
    """向所有连接的前端客户端广播词库数据变更通知。"""
    try:
        PromptServer.instance.send_sync(
            "prompt_vault:library_updated",
            {"detail": detail},
        )
    except Exception as err:
        logger.error("Failed to broadcast library update: %s", str(err))


def register_routes() -> None:
    """向 ComfyUI 主路由表注册标准 RESTful API 及向下兼容别名。"""
    routes = PromptServer.instance.routes

    # 1. 词库全量获取接口 (新旧双路由支持)
    @routes.get("/prompt_vault/api/library")
    @routes.get("/prompt_vault/api/presets")
    async def get_library_endpoint(request: web.Request) -> web.Response:
        """获取全量标准库对象。"""
        try:
            data = storage_manager.get_full_library()
            return web.json_response(
                {
                    "success": True,
                    "data": data,
                    "presets": data.get("entries", []),
                    "groups": data.get("groups", []),
                    "categories": [c.get("name") for c in data.get("categories", [])],
                }
            )
        except Exception as err:
            logger.error("Error in get_library_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    # 2. 词条增改接口 (新旧双路由支持)
    @routes.post("/prompt_vault/api/entries")
    @routes.post("/prompt_vault/api/presets")
    async def upsert_entry_endpoint(request: web.Request) -> web.Response:
        """创建或更新词条（支持上传图片）。"""
        try:
            content_type = request.content_type or ""
            entry_data: Dict[str, Any] = {}
            thumbnail_bytes: bytes = b""
            thumbnail_ext: str = "webp"

            if "multipart/form-data" in content_type:
                reader = await request.multipart()
                while True:
                    field = await reader.next()
                    if field is None:
                        break
                    if field.name == "data":
                        raw_json = await field.read()
                        entry_data = json.loads(
                            raw_json.decode("utf-8-sig", errors="replace")
                        )
                    elif field.name == "thumbnail":
                        filename = field.filename or "preview.webp"
                        _, ext = os.path.splitext(filename)
                        if ext:
                            thumbnail_ext = ext
                        thumbnail_bytes = await field.read()
            else:
                entry_data = await request.json()

            if thumbnail_bytes:
                saved_thumb = storage_manager.save_thumbnail_bytes(
                    thumbnail_bytes, thumbnail_ext
                )
                if saved_thumb:
                    entry_data["previewHash"] = saved_thumb

            success, saved_item = storage_manager.upsert_entry(entry_data)
            if success:
                broadcast_library_changed("upsert_entry")
                return web.json_response({"success": True, "data": saved_item})
            return web.json_response(
                {"success": False, "error": "Failed to persist entry."}, status=500
            )
        except Exception as err:
            logger.error("Error in upsert_entry_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=400)

    @routes.delete("/prompt_vault/api/entries/{id}")
    @routes.delete("/prompt_vault/api/presets/{id}")
    async def delete_entry_endpoint(request: web.Request) -> web.Response:
        """删除指定词条。"""
        try:
            entry_id = request.match_info.get("id", "")
            success = storage_manager.delete_entry(entry_id)
            if success:
                broadcast_library_changed("delete_entry")
            return web.json_response({"success": success})
        except Exception as err:
            logger.error("Error in delete_entry_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    # 3. 提示词组关系管理接口
    @routes.post("/prompt_vault/api/groups")
    async def upsert_group_endpoint(request: web.Request) -> web.Response:
        """创建或更新提示词组关系实体。"""
        try:
            group_data = await request.json()
            success, saved_item = storage_manager.upsert_group(group_data)
            if success:
                broadcast_library_changed("upsert_group")
                return web.json_response({"success": True, "data": saved_item})
            return web.json_response(
                {"success": False, "error": "Failed to persist group."}, status=500
            )
        except Exception as err:
            logger.error("Error in upsert_group_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=400)

    @routes.delete("/prompt_vault/api/groups/{id}")
    async def delete_group_endpoint(request: web.Request) -> web.Response:
        """删除指定提示词组关系实体。"""
        try:
            group_id = request.match_info.get("id", "")
            success = storage_manager.delete_group(group_id)
            if success:
                broadcast_library_changed("delete_group")
            return web.json_response({"success": success})
        except Exception as err:
            logger.error("Error in delete_group_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    # 4. 分类管理接口 (新旧双路由支持)
    @routes.post("/prompt_vault/api/categories")
    @routes.post("/prompt_vault/api/taxonomies/category")
    async def upsert_category_endpoint(request: web.Request) -> web.Response:
        """新增或更新分类。"""
        try:
            cat_data = await request.json()
            success, item = storage_manager.upsert_category(cat_data)
            if success:
                broadcast_library_changed("upsert_category")
            return web.json_response({"success": success, "data": item})
        except Exception as err:
            logger.error("Error in upsert_category_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=400)

    @routes.delete("/prompt_vault/api/categories/{id}")
    @routes.delete("/prompt_vault/api/taxonomies/category/{id}")
    async def delete_category_endpoint(request: web.Request) -> web.Response:
        """删除分类。"""
        try:
            cat_id = request.match_info.get("id", "")
            delete_branch = request.query.get("branch", "false").lower() == "true"
            success = storage_manager.delete_category(
                cat_id, delete_branch=delete_branch
            )
            if success:
                broadcast_library_changed("delete_category")
            return web.json_response({"success": success})
        except Exception as err:
            logger.error("Error in delete_category_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    # 5. 收藏夹管理接口 (新旧双路由支持)
    @routes.post("/prompt_vault/api/collections")
    @routes.post("/prompt_vault/api/taxonomies/folder")
    async def upsert_collection_endpoint(request: web.Request) -> web.Response:
        """新增或更新收藏夹。"""
        try:
            col_data = await request.json()
            success, item = storage_manager.upsert_collection(col_data)
            if success:
                broadcast_library_changed("upsert_collection")
            return web.json_response({"success": success, "data": item})
        except Exception as err:
            logger.error("Error in upsert_collection_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=400)

    @routes.delete("/prompt_vault/api/collections/{id}")
    @routes.delete("/prompt_vault/api/taxonomies/folder/{id}")
    async def delete_collection_endpoint(request: web.Request) -> web.Response:
        """删除收藏夹。"""
        try:
            col_id = request.match_info.get("id", "")
            success = storage_manager.delete_collection(col_id)
            if success:
                broadcast_library_changed("delete_collection")
            return web.json_response({"success": success})
        except Exception as err:
            logger.error("Error in delete_collection_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    # 6. 智能容错导入接口
    @routes.post("/prompt_vault/api/import")
    async def import_library_endpoint(request: web.Request) -> web.Response:
        """导入 JSON 词库包。自动兼容 UTF-8 BOM、旧版 aaalice 标准包及纯数组包。"""
        try:
            content_type = request.content_type or ""
            file_data: bytes = b""
            mode = "overwrite"

            if "multipart/form-data" in content_type:
                reader = await request.multipart()
                while True:
                    field = await reader.next()
                    if field is None:
                        break
                    if field.name == "mode":
                        mode_raw = await field.read()
                        mode = mode_raw.decode("utf-8", errors="ignore").strip()
                    elif field.name == "file":
                        file_data = await field.read()
            else:
                file_data = await request.read()

            if not file_data:
                return web.json_response(
                    {"success": False, "error": "未接收到有效文件内容"}, status=400
                )

            decoded_text = file_data.decode("utf-8-sig", errors="replace").strip()
            imported_json = json.loads(decoded_text)

            if isinstance(imported_json, list):
                imported_json = {
                    "format": "suski-prompt-library",
                    "version": 1,
                    "categories": [],
                    "collections": [],
                    "tags": [],
                    "entries": imported_json,
                    "groups": [],
                }

            success, count = storage_manager.import_library(imported_json, mode=mode)
            if success:
                broadcast_library_changed("import_library")
            return web.json_response({"success": success, "count": count})
        except Exception as err:
            logger.error("Error in import_library_endpoint: %s", str(err))
            return web.json_response(
                {"success": False, "error": f"解析失败: {str(err)}"}, status=400
            )

    # 7. 单文件直接导出
    @routes.get("/prompt_vault/api/export")
    async def export_library_endpoint(request: web.Request) -> web.Response:
        """直接将标准 library.json 输出为下载文件。"""
        try:
            data = storage_manager.get_full_library()
            payload = json.dumps(data, ensure_ascii=False, indent=2)
            headers = {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": 'attachment; filename="prompt_library_export.json"',
            }
            return web.Response(text=payload, headers=headers)
        except Exception as err:
            logger.error("Error in export_library_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    # 8. 缩略图服务
    @routes.get("/prompt_vault/api/thumbnails/{name}")
    async def get_thumbnail_endpoint(request: web.Request) -> web.Response:
        """获取缩略图文件资源。"""
        try:
            raw_filename = request.match_info.get("name", "")
            safe_filename = os.path.basename(raw_filename)
            file_path = THUMBNAILS_DIR / safe_filename

            if not file_path.exists() or not file_path.is_file():
                return web.Response(status=404, text="Thumbnail not found")

            mime_type, _ = mimetypes.guess_type(str(file_path)) or "image/webp"
            with open(file_path, "rb") as file:
                image_data = file.read()

            return web.Response(body=image_data, content_type=mime_type)
        except Exception as err:
            logger.error("Error in get_thumbnail_endpoint: %s", str(err))
            return web.Response(status=500, text=str(err))
