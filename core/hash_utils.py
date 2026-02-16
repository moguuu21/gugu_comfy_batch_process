from __future__ import annotations

import hashlib
import os
from typing import Hashable


def new_sha256() -> "hashlib._Hash":
    return hashlib.sha256()


def update_hash_with_value(hasher: "hashlib._Hash", value: Hashable) -> None:
    hasher.update(str(value).encode("utf-8"))


def update_hash_with_file_content(hasher: "hashlib._Hash", file_path: str) -> None:
    if not os.path.isfile(file_path):
        return
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)


def update_hash_with_file_stat(hasher: "hashlib._Hash", file_path: str) -> None:
    if not os.path.isfile(file_path):
        return
    stat = os.stat(file_path)
    update_hash_with_value(hasher, stat.st_size)
    update_hash_with_value(hasher, stat.st_mtime_ns)
