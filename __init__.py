from .batch_load_images import (
    BatchLoadImages,
    GuguBatchLoadVideos,
    VNCCS_PositionControl,
    VNCCS_VisualPositionControl,
)

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {
    "BatchLoadImages": BatchLoadImages,
    "gugu_BatchLoadImages": BatchLoadImages,
    "ComfyUI-IAI666-BatchLoadImages": BatchLoadImages,
    "gugu_BatchLoadVideos": GuguBatchLoadVideos,
    "VNCCS_PositionControl": VNCCS_PositionControl,
    "VNCCS_VisualPositionControl": VNCCS_VisualPositionControl,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "BatchLoadImages": "gugu Batch Load Images",
    "gugu_BatchLoadImages": "gugu Batch Load Images (Compat)",
    "ComfyUI-IAI666-BatchLoadImages": "ComfyUI-IAI666-BatchLoadImages (Compat)",
    "gugu_BatchLoadVideos": "gugu Batch Load Videos",
    "VNCCS_PositionControl": "VNCCS Position Control (Prompt)",
    "VNCCS_VisualPositionControl": "VNCCS Visual Position Control (Prompt)",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
