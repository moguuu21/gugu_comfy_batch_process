from __future__ import annotations

import os

import folder_paths

from .list_utils import apply_limit, parse_multiline_list, pick_mode_items

VIDEO_EXTENSIONS = {".mp4", ".webm", ".avi", ".mov", ".mkv", ".flv", ".m4v"}


def normalize_posix_path(path: str) -> str:
    return path.replace("\\", "/")


def to_input_relative_or_abs(abs_path: str, input_dir: str) -> str:
    try:
        return normalize_posix_path(os.path.relpath(abs_path, input_dir))
    except ValueError:
        # Different drive letters on Windows cannot be relativized.
        return normalize_posix_path(os.path.abspath(abs_path))


def list_videos_from_server_dir(server_video_dir: str) -> list[str]:
    server_video_dir = (server_video_dir or "").strip()
    if not server_video_dir:
        return []

    input_dir = folder_paths.get_input_directory()
    base_dir = server_video_dir if os.path.isabs(server_video_dir) else os.path.join(input_dir, server_video_dir)
    if not os.path.isdir(base_dir):
        return []

    results: list[str] = []
    for root, _, files in os.walk(base_dir):
        for file_name in files:
            ext = os.path.splitext(file_name)[1].lower()
            if ext not in VIDEO_EXTENSIONS:
                continue
            abs_path = os.path.join(root, file_name)
            results.append(to_input_relative_or_abs(abs_path, input_dir))

    results.sort()
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
