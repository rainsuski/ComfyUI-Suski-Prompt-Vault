# File: ComfyUI-Suski-Prompt-Vault/py/routes.py
"""ComfyUI aiohttp Web 服务端路由控制模块。

提供词库条目与分类/收藏夹树状体系的 RESTful 接口支持。
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


def register_routes() -> None:
    """向 ComfyUI 主路由表注册 RESTful API 路由。"""
    routes = PromptServer.instance.routes

    @routes.get("/prompt_vault/api/presets")
    async def get_presets_endpoint(request: web.Request) -> web.Response:
        """获取全量词库条目与基础分类。"""
        try:
            presets, categories = storage_manager.get_all_presets()
            return web.json_response(
                {
                    "success": True,
                    "data": presets,
                    "categories": categories,
                }
            )
        except Exception as err:
            logger.error("Error in get_presets_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    @routes.post("/prompt_vault/api/presets")
    async def upsert_preset_endpoint(request: web.Request) -> web.Response:
        """创建或更新词库条目。"""
        try:
            content_type = request.content_type or ""
            preset_data: Dict[str, Any] = {}
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
                        preset_data = json.loads(raw_json.decode("utf-8"))
                    elif field.name == "thumbnail":
                        filename = field.filename or "preview.webp"
                        _, ext = os.path.splitext(filename)
                        if ext:
                            thumbnail_ext = ext
                        thumbnail_bytes = await field.read()
            else:
                preset_data = await request.json()

            if thumbnail_bytes:
                saved_thumbnail = storage_manager.save_thumbnail_bytes(
                    thumbnail_bytes, thumbnail_ext
                )
                if saved_thumbnail:
                    preset_data["thumbnail"] = saved_thumbnail

            success, saved_item = storage_manager.upsert_preset(preset_data)
            if success:
                return web.json_response({"success": True, "data": saved_item})
            return web.json_response(
                {"success": False, "error": "Failed to persist preset."}, status=500
            )
        except Exception as err:
            logger.error("Error in upsert_preset_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=400)

    @routes.delete("/prompt_vault/api/presets/{id}")
    async def delete_preset_endpoint(request: web.Request) -> web.Response:
        """删除指定 ID 词条。"""
        try:
            preset_id = request.match_info.get("id", "")
            if not preset_id:
                return web.json_response(
                    {"success": False, "error": "Missing preset ID"}, status=400
                )

            success = storage_manager.delete_preset(preset_id)
            return web.json_response({"success": success})
        except Exception as err:
            logger.error("Error in delete_preset_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    @routes.post("/prompt_vault/api/import")
    async def import_presets_endpoint(request: web.Request) -> web.Response:
        """导入 JSON 格式词库。"""
        try:
            reader = await request.multipart()
            mode = "merge"
            file_data: bytes = b""

            while True:
                field = await reader.next()
                if field is None:
                    break
                if field.name == "mode":
                    mode_raw = await field.read()
                    mode = mode_raw.decode("utf-8").strip()
                elif field.name == "file":
                    file_data = await field.read()

            if not file_data:
                return web.json_response(
                    {"success": False, "error": "No file uploaded"}, status=400
                )

            imported_json = json.loads(file_data.decode("utf-8"))
            if not isinstance(imported_json, list):
                return web.json_response(
                    {"success": False, "error": "Imported data must be an array"},
                    status=400,
                )

            success, count = storage_manager.import_presets(imported_json, mode=mode)
            return web.json_response({"success": success, "count": count})
        except Exception as err:
            logger.error("Error in import_presets_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=400)

    @routes.get("/prompt_vault/api/export")
    async def export_presets_endpoint(request: web.Request) -> web.Response:
        """导出全量词库并下载。"""
        try:
            presets, _ = storage_manager.get_all_presets()
            payload = json.dumps(presets, ensure_ascii=False, indent=2)
            headers = {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": 'attachment; filename="prompt_vault_export.json"',
            }
            return web.Response(text=payload, headers=headers)
        except Exception as err:
            logger.error("Error in export_presets_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    @routes.get("/prompt_vault/api/thumbnails/{name}")
    async def get_thumbnail_endpoint(request: web.Request) -> web.Response:
        """获取缩略图文件。"""
        try:
            raw_filename = request.match_info.get("name", "")
            safe_filename = os.path.basename(raw_filename)
            file_path = THUMBNAILS_DIR / safe_filename

            if not file_path.exists() or not file_path.is_file():
                return web.Response(status=404, text="Thumbnail not found")

            mime_type, _ = mimetypes.guess_type(str(file_path))
            if not mime_type:
                mime_type = "image/webp"

            with open(file_path, "rb") as file:
                image_data = file.read()

            return web.Response(body=image_data, content_type=mime_type)
        except Exception as err:
            logger.error("Error in get_thumbnail_endpoint: %s", str(err))
            return web.Response(status=500, text=str(err))

    @routes.get("/prompt_vault/api/taxonomies")
    async def get_taxonomies_endpoint(request: web.Request) -> web.Response:
        """获取全部分类树与收藏夹体系。"""
        try:
            taxonomies = storage_manager.get_taxonomies()
            return web.json_response({"success": True, "data": taxonomies})
        except Exception as err:
            logger.error("Error in get_taxonomies_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)

    @routes.post("/prompt_vault/api/taxonomies")
    async def upsert_taxonomy_endpoint(request: web.Request) -> web.Response:
        """新增或更新分类或收藏夹节点。"""
        try:
            payload = await request.json()
            item_type = payload.get("type", "category")
            item_data = payload.get("data", {})
            success, saved = storage_manager.upsert_taxonomy_item(item_type, item_data)
            return web.json_response({"success": success, "data": saved})
        except Exception as err:
            logger.error("Error in upsert_taxonomy_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=400)

    @routes.delete("/prompt_vault/api/taxonomies/{type}/{id}")
    async def delete_taxonomy_endpoint(request: web.Request) -> web.Response:
        """删除分类或收藏夹节点。"""
        try:
            item_type = request.match_info.get("type", "category")
            item_id = request.match_info.get("id", "")
            success = storage_manager.delete_taxonomy_item(item_type, item_id)
            return web.json_response({"success": success})
        except Exception as err:
            logger.error("Error in delete_taxonomy_endpoint: %s", str(err))
            return web.json_response({"success": False, "error": str(err)}, status=500)
