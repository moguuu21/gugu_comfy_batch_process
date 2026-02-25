from __future__ import annotations

import os

import torch

import folder_paths

from ..core import (
    apply_limit,
    new_sha256,
    parse_multiline_list,
    select_from_multiline,
    update_hash_with_file_content,
    update_hash_with_value,
)
from ..services import load_image_tensor


class GuguBatchLoadImages:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_list": ("STRING", {"multiline": True, "default": ""}),
                "max_images": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
                "mode": (["batch", "single"], {"default": "batch"}),
                "index": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1}),
            }
        }

    CATEGORY = "gugu/utools/IO"
    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("images", "filenames", "failed_filenames")
    FUNCTION = "load_images"

    def load_images(self, image_list: str, max_images: int, mode: str, index: int):
        names = select_from_multiline(image_list, max_images, mode, index)
        if not names:
            raise ValueError("image_list is empty")

        output_images: list[torch.Tensor] = []
        output_names: list[str] = []
        failed_names: list[str] = []

        for name in names:
            if not folder_paths.exists_annotated_filepath(name):
                failed_names.append(name)
                continue

            image_path = folder_paths.get_annotated_filepath(name)
            tensor = load_image_tensor(image_path)
            if tensor is None:
                failed_names.append(name)
                continue

            output_images.append(tensor)
            output_names.append(name)

        if not output_images:
            raise ValueError("No valid images found")

        output_tensor = torch.cat(output_images, dim=0)
        return (output_tensor, "\n".join(output_names), "\n".join(failed_names))

    @classmethod
    def IS_CHANGED(cls, image_list: str, max_images: int, mode: str, index: int):
        hasher = new_sha256()
        names = select_from_multiline(image_list, max_images, mode, index)

        update_hash_with_value(hasher, mode)
        update_hash_with_value(hasher, index)
        update_hash_with_value(hasher, max_images)

        for name in names:
            update_hash_with_value(hasher, name)
            if not folder_paths.exists_annotated_filepath(name):
                continue
            image_path = folder_paths.get_annotated_filepath(name)
            if os.path.isfile(image_path):
                update_hash_with_file_content(hasher, image_path)

        return hasher.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, image_list: str, max_images: int, mode: str, index: int):
        names = apply_limit(parse_multiline_list(image_list), max_images)

        if mode == "single":
            if not names:
                return "image_list is empty"
            if index < 0:
                return "index must be >= 0"
            if index >= len(names):
                return f"index out of range (0..{len(names) - 1})"

        if not names:
            return "image_list is empty"

        if not any(folder_paths.exists_annotated_filepath(name) for name in names):
            return "No valid images in image_list"

        return True
