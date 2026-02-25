from __future__ import annotations

from .batch_load_images import GuguBatchLoadImages
from .batch_load_videos import GuguBatchLoadVideos

NODE_CLASS_MAPPINGS = {
    "GuguBatchLoadImages": GuguBatchLoadImages,
    "gugu_BatchLoadVideos": GuguBatchLoadVideos,
}

__all__ = ["NODE_CLASS_MAPPINGS"]
