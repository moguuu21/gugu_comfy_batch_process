from __future__ import annotations

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import node_helpers

_EXCLUDED_MULTI_FRAME_FORMATS = {"MPO"}


def load_image_tensor(image_path: str) -> torch.Tensor | None:
    img = node_helpers.pillow(Image.open, image_path)

    frames: list[torch.Tensor] = []
    expected_size: tuple[int, int] | None = None

    for frame in ImageSequence.Iterator(img):
        frame = node_helpers.pillow(ImageOps.exif_transpose, frame)

        if frame.mode == "I":
            frame = frame.point(lambda pixel: pixel * (1 / 255))
        pil_image = frame.convert("RGB")

        if expected_size is None:
            expected_size = pil_image.size
        if pil_image.size != expected_size:
            continue

        arr = np.array(pil_image).astype(np.float32) / 255.0
        frames.append(torch.from_numpy(arr)[None,])

    if not frames:
        return None

    if len(frames) > 1 and img.format not in _EXCLUDED_MULTI_FRAME_FORMATS:
        return torch.cat(frames, dim=0)
    return frames[0]
