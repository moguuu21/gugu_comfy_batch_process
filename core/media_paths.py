from __future__ import annotations

import os
from dataclasses import dataclass

import folder_paths

from .list_utils import apply_limit, parse_multiline_list, pick_mode_items

VIDEO_EXTENSIONS = {".mp4", ".webm", ".avi", ".mov", ".mkv", ".flv", ".m4v"}


@dataclass(frozen=True)
class InputViewParams:
    filename: str
    subfolder: str = ""


@dataclass(frozen=True)
class ScannedVideoEntry:
    path: str
    preview: InputViewParams | None


def normalize_posix_path(path: str) -> str:
    return path.replace("\\", "/")


def _is_abs_like(path: str) -> bool:
    normalized = normalize_posix_path(path)
    return normalized.startswith("/") or (len(normalized) >= 2 and normalized[1] == ":")


def _is_within_dir(path: str, base_dir: str) -> bool:
    abs_path = os.path.abspath(path)
    abs_base = os.path.abspath(base_dir)
    try:
        return os.path.commonpath((abs_path, abs_base)) == abs_base
    except ValueError:
        # Different drive letters on Windows.
        return False


def to_input_relative_or_abs(abs_path: str, input_dir: str) -> str:
    abs_path = os.path.abspath(abs_path)
    input_dir = os.path.abspath(input_dir)
    if _is_within_dir(abs_path, input_dir):
        rel_path = os.path.relpath(abs_path, input_dir)
        return normalize_posix_path(rel_path)
    return normalize_posix_path(abs_path)


def build_input_view_params(path: str, input_dir: str | None = None) -> InputViewParams | None:
    clean_path = (path or "").strip()
    if not clean_path:
        return None

    normalized = normalize_posix_path(clean_path)
    if normalized.startswith("..") or "/.." in normalized:
        return None

    input_dir = os.path.abspath(input_dir or folder_paths.get_input_directory())
    if _is_abs_like(normalized):
        abs_path = os.path.abspath(clean_path)
        if not _is_within_dir(abs_path, input_dir):
            return None
        normalized = normalize_posix_path(os.path.relpath(abs_path, input_dir))

    parts = [segment for segment in normalized.split("/") if segment]
    if not parts:
        return None

    filename = parts[-1]
    subfolder = "/".join(parts[:-1])
    return InputViewParams(filename=filename, subfolder=subfolder)


def is_previewable_path(path: str) -> bool:
    return build_input_view_params(path) is not None


def list_videos_from_server_dir(server_video_dir: str) -> list[ScannedVideoEntry]:
    server_video_dir = (server_video_dir or "").strip()
    if not server_video_dir:
        return []

    input_dir = folder_paths.get_input_directory()
    base_dir = server_video_dir if os.path.isabs(server_video_dir) else os.path.join(input_dir, server_video_dir)
    if not os.path.isdir(base_dir):
        return []

    results: list[ScannedVideoEntry] = []
    for root, _, files in os.walk(base_dir):
        for file_name in files:
            ext = os.path.splitext(file_name)[1].lower()
            if ext not in VIDEO_EXTENSIONS:
                continue
            abs_path = os.path.join(root, file_name)
            resolved_path = to_input_relative_or_abs(abs_path, input_dir)
            preview = build_input_view_params(resolved_path, input_dir=input_dir)
            results.append(ScannedVideoEntry(path=resolved_path, preview=preview))

    results.sort(key=lambda entry: entry.path)
    return results


def list_video_candidates(video_list: str, max_videos: int, server_video_dir: str) -> list[str]:
    # Task creation/execution must come from explicit video_list entries.
    # server_video_dir is reserved for scan helpers that populate video_list.
    names = parse_multiline_list(video_list)
    return apply_limit(names, max_videos)


def select_video_names(
    video_list: str,
    max_videos: int,
    mode: str,
    index: int,
    server_video_dir: str,
) -> list[str]:
    names = list_video_candidates(video_list, max_videos, server_video_dir)
    return pick_mode_items(names, mode, index)


def resolve_video_path(name: str) -> str | None:
    if not name:
        return None

    clean_name = name.strip()
    if not clean_name:
        return None

    if folder_paths.exists_annotated_filepath(clean_name):
        return folder_paths.get_annotated_filepath(clean_name)

    if os.path.isfile(clean_name):
        return clean_name

    candidate = os.path.join(folder_paths.get_input_directory(), clean_name)
    if os.path.isfile(candidate):
        return candidate

    return None
