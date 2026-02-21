from __future__ import annotations

import os

import torch

from ..core import (
    list_video_candidates,
    new_sha256,
    resolve_video_path,
    select_video_names,
    update_hash_with_file_stat,
    update_hash_with_value,
)
from ..services import decode_video_frames


class GuguBatchLoadVideos:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_list": ("STRING", {"multiline": True, "default": ""}),
                "max_videos": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
                "mode": (["batch", "single"], {"default": "single"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
                "skip_frames": ("INT", {"default": 0, "min": 0, "max": 1000000, "step": 1}),
                "frame_load_cap": ("INT", {"default": 0, "min": 0, "max": 1000000, "step": 1}),
                "select_every_nth": ("INT", {"default": 1, "min": 1, "max": 1000, "step": 1}),
                "server_video_dir": ("STRING", {"default": ""}),
            }
        }

    CATEGORY = "gugu/utools/IO"
    RETURN_TYPES = ("IMAGE", "FLOAT", "STRING", "STRING")
    RETURN_NAMES = ("images", "fps", "filenames", "failed_filenames")
    FUNCTION = "load_videos"

    def load_videos(
        self,
        video_list: str,
        max_videos: int,
        mode: str,
        index: int,
        skip_frames: int,
        frame_load_cap: int,
        select_every_nth: int,
        server_video_dir: str = "",
    ):
        names = select_video_names(video_list, max_videos, mode, index, server_video_dir)
        if not names:
            raise ValueError("video_list is empty")

        output_frames: list[torch.Tensor] = []
        output_names: list[str] = []
        failed_names: list[str] = []
        fps_values: list[float] = []
        expected_hw: tuple[int, int] | None = None

        for name in names:
            video_path = resolve_video_path(name)
            if not video_path:
                failed_names.append(name)
                continue

            try:
                decode_result = decode_video_frames(
                    video_path=video_path,
                    skip_frames=skip_frames,
                    frame_load_cap=frame_load_cap,
                    select_every_nth=select_every_nth,
                    expected_hw=expected_hw,
                )
            except ImportError:
                raise
            except Exception:
                failed_names.append(name)
                continue

            expected_hw = decode_result.expected_hw
            if decode_result.fps > 0:
                fps_values.append(decode_result.fps)
            if not decode_result.frames:
                failed_names.append(name)
                continue

            output_frames.extend(decode_result.frames)
            output_names.append(name)

        if not output_frames:
            raise ValueError("No valid video frames found")

        output_tensor = torch.cat(output_frames, dim=0)
        avg_fps = float(sum(fps_values) / len(fps_values)) if fps_values else 0.0
        return (output_tensor, avg_fps, "\n".join(output_names), "\n".join(failed_names))

    @classmethod
    def IS_CHANGED(
        cls,
        video_list: str,
        max_videos: int,
        mode: str,
        index: int,
        skip_frames: int,
        frame_load_cap: int,
        select_every_nth: int,
        server_video_dir: str = "",
    ):
        hasher = new_sha256()
        names = select_video_names(video_list, max_videos, mode, index, server_video_dir)

        update_hash_with_value(hasher, mode)
        update_hash_with_value(hasher, index)
        update_hash_with_value(hasher, max_videos)
        update_hash_with_value(hasher, skip_frames)
        update_hash_with_value(hasher, frame_load_cap)
        update_hash_with_value(hasher, select_every_nth)
        update_hash_with_value(hasher, server_video_dir or "")

        for name in names:
            update_hash_with_value(hasher, name)
            video_path = resolve_video_path(name)
            if video_path and os.path.isfile(video_path):
                update_hash_with_file_stat(hasher, video_path)

        return hasher.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(
        cls,
        video_list: str,
        max_videos: int,
        mode: str,
        index: int,
        skip_frames: int,
        frame_load_cap: int,
        select_every_nth: int,
        server_video_dir: str = "",
    ):
        base_names = list_video_candidates(video_list, max_videos, server_video_dir)
        if not base_names:
            return "video_list is empty"

        if mode == "single":
            if index < 0:
                return "index must be >= 0"
            if index >= len(base_names):
                return f"index out of range (0..{len(base_names) - 1})"
            names = [base_names[index]]
        else:
            names = base_names

        if select_every_nth <= 0:
            return "select_every_nth must be >= 1"
        if skip_frames < 0:
            return "skip_frames must be >= 0"
        if frame_load_cap < 0:
            return "frame_load_cap must be >= 0"

        if not any(resolve_video_path(name) for name in names):
            return "No valid videos in video_list"

        return True
