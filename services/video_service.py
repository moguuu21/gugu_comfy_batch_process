from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch


@dataclass
class VideoDecodeResult:
    frames: list[torch.Tensor]
    fps: float
    expected_hw: tuple[int, int] | None


def decode_video_frames(
    video_path: str,
    skip_frames: int,
    frame_load_cap: int,
    select_every_nth: int,
    expected_hw: tuple[int, int] | None = None,
) -> VideoDecodeResult:
    try:
        import av
    except ImportError as exc:
        raise ImportError("PyAV is required for gugu_BatchLoadVideos. Install with: pip install av") from exc

    frames: list[torch.Tensor] = []
    fps_value = 0.0
    decoded_index = 0
    loaded_count = 0
    resolved_hw = expected_hw

    with av.open(video_path) as container:
        video_stream = next((stream for stream in container.streams if stream.type == "video"), None)
        if video_stream is None:
            return VideoDecodeResult([], 0.0, expected_hw)

        if video_stream.average_rate is not None:
            fps_value = float(video_stream.average_rate)
        elif video_stream.base_rate is not None:
            fps_value = float(video_stream.base_rate)

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

            if resolved_hw is None:
                resolved_hw = (h, w)
            if (h, w) != resolved_hw:
                continue

            arr = rgb.astype(np.float32) / 255.0
            frames.append(torch.from_numpy(arr)[None,])
            loaded_count += 1

            if frame_load_cap > 0 and loaded_count >= frame_load_cap:
                break

    return VideoDecodeResult(frames=frames, fps=fps_value, expected_hw=resolved_hw)
