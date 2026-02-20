from __future__ import annotations

from aiohttp import web
from server import PromptServer

from .core import list_videos_from_server_dir


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
