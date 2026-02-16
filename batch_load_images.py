import os
import hashlib
import json

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths
import node_helpers

VIDEO_EXTENSIONS = {".mp4", ".webm", ".avi", ".mov", ".mkv", ".flv", ".m4v"}


def _parse_multiline_list(raw_text: str):
    return [x.strip() for x in (raw_text or "").splitlines() if x.strip()]


def _normalize_posix_path(path: str):
    return path.replace("\\", "/")


def _to_input_relative_or_abs(abs_path: str, input_dir: str):
    try:
        return _normalize_posix_path(os.path.relpath(abs_path, input_dir))
    except ValueError:
        # On Windows different drives cannot be relativized; keep absolute path.
        return _normalize_posix_path(os.path.abspath(abs_path))


def _list_videos_from_server_dir(server_video_dir: str):
    server_video_dir = (server_video_dir or "").strip()
    if not server_video_dir:
        return []

    input_dir = folder_paths.get_input_directory()
    if os.path.isabs(server_video_dir):
        base_dir = server_video_dir
    else:
        base_dir = os.path.join(input_dir, server_video_dir)

    if not os.path.isdir(base_dir):
        return []

    results = []
    for root, _, files in os.walk(base_dir):
        for file_name in files:
            ext = os.path.splitext(file_name)[1].lower()
            if ext in VIDEO_EXTENSIONS:
                abs_path = os.path.join(root, file_name)
                results.append(_to_input_relative_or_abs(abs_path, input_dir))
    results.sort()
    return results


def _resolve_video_path(name: str):
    if not name:
        return None

    name = name.strip()
    if not name:
        return None

    if folder_paths.exists_annotated_filepath(name):
        return folder_paths.get_annotated_filepath(name)

    if os.path.isfile(name):
        return name

    candidate = os.path.join(folder_paths.get_input_directory(), name)
    if os.path.isfile(candidate):
        return candidate

    return None


def _select_videos(video_list: str, max_videos: int, mode: str, index: int, server_video_dir: str):
    names = _parse_multiline_list(video_list)

    if server_video_dir and server_video_dir.strip():
        names = _list_videos_from_server_dir(server_video_dir)

    if max_videos and max_videos > 0:
        names = names[:max_videos]

    if mode == "single" and names:
        index = max(0, min(index, len(names) - 1))
        names = [names[index]]

    return names


class BatchLoadImages:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image_list": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                    },
                ),
                "max_images": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
                "mode": (["batch", "single"], {"default": "batch"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
            }
        }

    CATEGORY = "gugu/utools/IO"

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "filenames")
    FUNCTION = "load_images"

    def load_images(self, image_list: str, max_images: int, mode: str, index: int):
        names = [x.strip() for x in (image_list or "").splitlines()]
        names = [x for x in names if x]

        if max_images and max_images > 0:
            names = names[:max_images]

        if mode == "single":
            if index < 0:
                index = 0
            if index >= len(names):
                index = len(names) - 1
            names = [names[index]]

        if len(names) == 0:
            raise ValueError("image_list is empty")

        output_images = []
        output_names = []

        excluded_formats = ["MPO"]

        for name in names:
            if not folder_paths.exists_annotated_filepath(name):
                continue

            image_path = folder_paths.get_annotated_filepath(name)
            img = node_helpers.pillow(Image.open, image_path)

            w, h = None, None
            frames = []

            for i in ImageSequence.Iterator(img):
                i = node_helpers.pillow(ImageOps.exif_transpose, i)

                if i.mode == "I":
                    i = i.point(lambda p: p * (1 / 255))
                pil_image = i.convert("RGB")

                if len(frames) == 0:
                    w = pil_image.size[0]
                    h = pil_image.size[1]

                if pil_image.size[0] != w or pil_image.size[1] != h:
                    continue

                arr = np.array(pil_image).astype(np.float32) / 255.0
                tensor = torch.from_numpy(arr)[None,]
                frames.append(tensor)

            if len(frames) == 0:
                continue

            if len(frames) > 1 and img.format not in excluded_formats:
                image_tensor = torch.cat(frames, dim=0)
            else:
                image_tensor = frames[0]

            output_images.append(image_tensor)
            output_names.append(name)

        if len(output_images) == 0:
            raise ValueError("No valid images found")

        output_image = torch.cat(output_images, dim=0)
        return (output_image, "\n".join(output_names))

    @classmethod
    def IS_CHANGED(s, image_list: str, max_images: int, mode: str, index: int):
        m = hashlib.sha256()
        names = [x.strip() for x in (image_list or "").splitlines()]
        names = [x for x in names if x]
        if max_images and max_images > 0:
            names = names[:max_images]

        if mode == "single":
            if index < 0:
                index = 0
            if index >= len(names):
                index = len(names) - 1
            names = names[:1] if len(names) == 0 else [names[index]]

        m.update(str(mode).encode("utf-8"))
        m.update(str(index).encode("utf-8"))
        m.update(str(max_images).encode("utf-8"))
        for name in names:
            m.update(name.encode("utf-8"))
            if folder_paths.exists_annotated_filepath(name):
                image_path = folder_paths.get_annotated_filepath(name)
                if os.path.isfile(image_path):
                    with open(image_path, "rb") as f:
                        m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(s, image_list: str, max_images: int, mode: str, index: int):
        names = [x.strip() for x in (image_list or "").splitlines()]
        names = [x for x in names if x]
        if max_images and max_images > 0:
            names = names[:max_images]

        if mode == "single":
            if len(names) == 0:
                return "image_list is empty"
            if index < 0:
                return "index must be >= 0"
            if index >= len(names):
                return f"index out of range (0..{len(names)-1})"

        if len(names) == 0:
            return "image_list is empty"

        valid = False
        for name in names:
            if folder_paths.exists_annotated_filepath(name):
                valid = True
                break

        if not valid:
            return "No valid images in image_list"

        return True


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
    RETURN_TYPES = ("IMAGE", "FLOAT", "STRING")
    RETURN_NAMES = ("images", "fps", "filenames")
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
        try:
            import av
        except ImportError as e:
            raise ImportError("PyAV is required for gugu_BatchLoadVideos. Install with: pip install av") from e

        names = _select_videos(video_list, max_videos, mode, index, server_video_dir)
        if not names:
            raise ValueError("video_list is empty")

        output_frames = []
        output_names = []
        fps_values = []
        expected_hw = None

        for name in names:
            video_path = _resolve_video_path(name)
            if not video_path:
                continue

            try:
                with av.open(video_path) as container:
                    video_stream = next((s for s in container.streams if s.type == "video"), None)
                    if video_stream is None:
                        continue

                    fps_value = 0.0
                    if video_stream.average_rate is not None:
                        fps_value = float(video_stream.average_rate)
                    elif video_stream.base_rate is not None:
                        fps_value = float(video_stream.base_rate)
                    if fps_value > 0:
                        fps_values.append(fps_value)

                    decoded_index = 0
                    loaded_count = 0

                    for frame in container.decode(video_stream):
                        if decoded_index < skip_frames:
                            decoded_index += 1
                            continue

                        post_skip_index = decoded_index - skip_frames
                        decoded_index += 1

                        if select_every_nth > 1 and (post_skip_index % select_every_nth) != 0:
                            continue

                        rgb = frame.to_ndarray(format="rgb24")
                        h, w = rgb.shape[0], rgb.shape[1]
                        if expected_hw is None:
                            expected_hw = (h, w)
                        if (h, w) != expected_hw:
                            continue

                        arr = rgb.astype(np.float32) / 255.0
                        output_frames.append(torch.from_numpy(arr)[None,])
                        loaded_count += 1

                        if frame_load_cap > 0 and loaded_count >= frame_load_cap:
                            break

                    if loaded_count > 0:
                        output_names.append(name)
            except Exception:
                continue

        if not output_frames:
            raise ValueError("No valid video frames found")

        output_tensor = torch.cat(output_frames, dim=0)
        avg_fps = float(sum(fps_values) / len(fps_values)) if fps_values else 0.0
        return (output_tensor, avg_fps, "\n".join(output_names))

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
        m = hashlib.sha256()
        names = _select_videos(video_list, max_videos, mode, index, server_video_dir)

        m.update(str(mode).encode("utf-8"))
        m.update(str(index).encode("utf-8"))
        m.update(str(max_videos).encode("utf-8"))
        m.update(str(skip_frames).encode("utf-8"))
        m.update(str(frame_load_cap).encode("utf-8"))
        m.update(str(select_every_nth).encode("utf-8"))
        m.update((server_video_dir or "").encode("utf-8"))

        for name in names:
            m.update(name.encode("utf-8"))
            video_path = _resolve_video_path(name)
            if video_path and os.path.isfile(video_path):
                stat = os.stat(video_path)
                m.update(str(stat.st_size).encode("utf-8"))
                m.update(str(stat.st_mtime_ns).encode("utf-8"))
        return m.digest().hex()

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
        base_names = _select_videos(video_list, max_videos, "batch", 0, server_video_dir)
        if not base_names:
            return "video_list is empty"

        if mode == "single":
            if index < 0:
                return "index must be >= 0"
            if index >= len(base_names):
                return f"index out of range (0..{len(base_names)-1})"
            names = [base_names[index]]
        else:
            names = base_names

        if select_every_nth <= 0:
            return "select_every_nth must be >= 1"
        if skip_frames < 0:
            return "skip_frames must be >= 0"
        if frame_load_cap < 0:
            return "frame_load_cap must be >= 0"

        valid = any(_resolve_video_path(name) for name in names)
        if not valid:
            return "No valid videos in video_list"
        return True


class VNCCS_PositionControl:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "azimuth": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 360,
                        "step": 45,
                        "display": "slider",
                        "tooltip": "Angle of the camera around the subject (0=Front, 90=Right, 180=Back)",
                    },
                ),
                "elevation": (
                    "INT",
                    {
                        "default": 0,
                        "min": -30,
                        "max": 60,
                        "step": 30,
                        "display": "slider",
                        "tooltip": "Vertical angle of the camera (-30=Low, 0=Eye Level, 60=High)",
                    },
                ),
                "distance": (["close-up", "medium shot", "wide shot"], {"default": "medium shot"}),
                "include_trigger": ("BOOLEAN", {"default": True, "tooltip": "Include <sks> trigger word"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    CATEGORY = "VNCCS"
    FUNCTION = "generate_prompt"

    def generate_prompt(self, azimuth, elevation, distance, include_trigger):
        azimuth = int(azimuth) % 360

        azimuth_map = {
            0: "front view",
            45: "front-right quarter view",
            90: "right side view",
            135: "back-right quarter view",
            180: "back view",
            225: "back-left quarter view",
            270: "left side view",
            315: "front-left quarter view",
        }

        if azimuth > 337.5:
            closest_azimuth = 0
        else:
            closest_azimuth = min(azimuth_map.keys(), key=lambda x: abs(x - azimuth))
        az_str = azimuth_map[closest_azimuth]

        elevation_map = {
            -30: "low-angle shot",
            0: "eye-level shot",
            30: "elevated shot",
            60: "high-angle shot",
        }
        closest_elevation = min(elevation_map.keys(), key=lambda x: abs(x - elevation))
        el_str = elevation_map[closest_elevation]

        parts = []
        if include_trigger:
            parts.append("<sks>")
        parts.append(az_str)
        parts.append(el_str)
        parts.append(distance)

        return (" ".join(parts),)


class VNCCS_VisualPositionControl(VNCCS_PositionControl):
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "camera_data": ("STRING", {"default": "{}", "hidden": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    CATEGORY = "VNCCS"
    FUNCTION = "generate_prompt_from_json"

    def generate_prompt_from_json(self, camera_data):
        try:
            data = json.loads(camera_data)
        except json.JSONDecodeError:
            data = {"azimuth": 0, "elevation": 0, "distance": "medium shot", "include_trigger": True}

        return self.generate_prompt(
            data.get("azimuth", 0),
            data.get("elevation", 0),
            data.get("distance", "medium shot"),
            data.get("include_trigger", True),
        )
