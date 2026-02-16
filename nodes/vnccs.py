from __future__ import annotations

from ..services import build_vnccs_prompt, build_vnccs_prompt_from_json


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
        return (build_vnccs_prompt(azimuth, elevation, distance, include_trigger),)


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
        return (build_vnccs_prompt_from_json(camera_data),)
