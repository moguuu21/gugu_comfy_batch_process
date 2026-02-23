from __future__ import annotations

from ..core import InputViewParams, list_videos_from_server_dir, resolve_video_path
from .preview_proxy_service import register_preview_file


def _serialize_preview(preview: InputViewParams) -> dict[str, str]:
    payload = {"filename": preview.filename}
    if preview.subfolder:
        payload["subfolder"] = preview.subfolder
    return payload


def build_video_scan_payload(server_video_dir: str, max_videos: int) -> dict:
    all_entries = list_videos_from_server_dir(server_video_dir)
    limited_entries = all_entries[:max_videos] if max_videos > 0 else all_entries

    items: list[str] = []
    previews: dict[str, dict[str, str]] = {}
    for entry in limited_entries:
        items.append(entry.path)
        resolved = resolve_video_path(entry.path)
        proxy_id = register_preview_file(resolved) if resolved else None
        if proxy_id:
            previews[entry.path] = {"proxy_id": proxy_id}
        elif entry.preview is not None:
            previews[entry.path] = _serialize_preview(entry.preview)

    return {
        "ok": True,
        "items": items,
        "previews": previews,
        "count": len(items),
        "total": len(all_entries),
    }
