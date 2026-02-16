from __future__ import annotations

import json

_AZIMUTH_MAP = {
    0: "front view",
    45: "front-right quarter view",
    90: "right side view",
    135: "back-right quarter view",
    180: "back view",
    225: "back-left quarter view",
    270: "left side view",
    315: "front-left quarter view",
}

_ELEVATION_MAP = {
    -30: "low-angle shot",
    0: "eye-level shot",
    30: "elevated shot",
    60: "high-angle shot",
}

_DEFAULT_CAMERA_DATA = {
    "azimuth": 0,
    "elevation": 0,
    "distance": "medium shot",
    "include_trigger": True,
}


def build_vnccs_prompt(azimuth: int, elevation: int, distance: str, include_trigger: bool) -> str:
    azimuth = int(azimuth) % 360
    if azimuth > 337.5:
        closest_azimuth = 0
    else:
        closest_azimuth = min(_AZIMUTH_MAP.keys(), key=lambda value: abs(value - azimuth))
    azimuth_text = _AZIMUTH_MAP[closest_azimuth]

    closest_elevation = min(_ELEVATION_MAP.keys(), key=lambda value: abs(value - elevation))
    elevation_text = _ELEVATION_MAP[closest_elevation]

    parts: list[str] = []
    if include_trigger:
        parts.append("<sks>")
    parts.append(azimuth_text)
    parts.append(elevation_text)
    parts.append(distance)

    return " ".join(parts)


def build_vnccs_prompt_from_json(camera_data: str) -> str:
    try:
        data = json.loads(camera_data)
    except json.JSONDecodeError:
        data = dict(_DEFAULT_CAMERA_DATA)

    return build_vnccs_prompt(
        azimuth=data.get("azimuth", _DEFAULT_CAMERA_DATA["azimuth"]),
        elevation=data.get("elevation", _DEFAULT_CAMERA_DATA["elevation"]),
        distance=data.get("distance", _DEFAULT_CAMERA_DATA["distance"]),
        include_trigger=data.get("include_trigger", _DEFAULT_CAMERA_DATA["include_trigger"]),
    )
