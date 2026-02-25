from __future__ import annotations

from ..core import (
    InputViewParams,
    ScannedImageEntry,
    ScannedVideoEntry,
    list_images_from_server_dir,
    list_videos_from_server_dir,
    resolve_image_path,
    resolve_video_path,
)
from .preview_proxy_service import register_preview_file


def _serialize_preview(preview: InputViewParams) -> dict[str, str]:
    payload = {"filename": preview.filename}
    if preview.subfolder:
        payload["subfolder"] = preview.subfolder
    return payload


def _build_scan_payload(
    all_entries: list[ScannedImageEntry] | list[ScannedVideoEntry],
    max_items: int,
    resolve_path,
) -> dict:
    limited_entries = all_entries[:max_items] if max_items > 0 else all_entries

    items: list[str] = []
    previews: dict[str, dict[str, str]] = {}
    for entry in limited_entries:
        items.append(entry.path)
        resolved = resolve_path(entry.path)
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


def build_image_scan_payload(server_image_dir: str, max_images: int) -> dict:
    all_entries = list_images_from_server_dir(server_image_dir)
    return _build_scan_payload(all_entries, max_images, resolve_image_path)


def build_video_scan_payload(server_video_dir: str, max_videos: int) -> dict:
    all_entries = list_videos_from_server_dir(server_video_dir)
    return _build_scan_payload(all_entries, max_videos, resolve_video_path)
