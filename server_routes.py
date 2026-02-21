from __future__ import annotations

import os

from aiohttp import web
from server import PromptServer

import folder_paths

from .core import list_videos_from_server_dir, resolve_video_path


def _parse_non_negative_int(value: object, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else 0


@PromptServer.instance.routes.post("/mogu_batch_process/scan_video_dir")
async def scan_video_dir(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    server_video_dir = str(payload.get("server_video_dir") or "").strip()
    if not server_video_dir:
        return web.json_response(
            {"ok": False, "error": "server_video_dir is required", "items": []},
            status=400,
        )

    max_videos = _parse_non_negative_int(payload.get("max_videos", 0))

    all_items = list_videos_from_server_dir(server_video_dir)
    items = all_items[:max_videos] if max_videos > 0 else all_items

    return web.json_response(
        {
            "ok": True,
            "items": items,
            "count": len(items),
            "total": len(all_items),
        }
    )


@PromptServer.instance.routes.post("/mogu_batch_process/get_media_metadata")
async def get_media_metadata(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    filenames = payload.get("filenames", [])
    if not isinstance(filenames, list):
        filenames = []

    metadata = {}
    input_dir = folder_paths.get_input_directory()

    for name in filenames:
        if not isinstance(name, str) or not name:
            continue

        filepath = None
        # Try as image first
        if folder_paths.exists_annotated_filepath(name):
            filepath = folder_paths.get_annotated_filepath(name)
        else:
            # Try as video
            filepath = resolve_video_path(name)

        if filepath and os.path.isfile(filepath):
            try:
                stat = os.stat(filepath)
                metadata[name] = {"mtime": stat.st_mtime, "size": stat.st_size}
            except OSError:
                pass

    return web.json_response({"ok": True, "metadata": metadata})
