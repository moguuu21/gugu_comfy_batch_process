from __future__ import annotations

from typing import Sequence


def parse_multiline_list(raw_text: str) -> list[str]:
    return [line.strip() for line in (raw_text or "").splitlines() if line.strip()]


def apply_limit(items: Sequence[str], max_items: int) -> list[str]:
    values = list(items)
    if max_items and max_items > 0:
        return values[:max_items]
    return values


def clamp_single_index(index: int, size: int) -> int:
    if size <= 0:
        return 0
    if index < 0:
        return 0
    if index >= size:
        return size - 1
    return index


def pick_mode_items(items: Sequence[str], mode: str, index: int) -> list[str]:
    values = list(items)
    if mode == "single" and values:
        return [values[clamp_single_index(index, len(values))]]
    return values


def select_from_multiline(raw_text: str, max_items: int, mode: str, index: int) -> list[str]:
    values = apply_limit(parse_multiline_list(raw_text), max_items)
    return pick_mode_items(values, mode, index)
