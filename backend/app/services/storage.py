"""文件存储抽象：首版本地卷，后续可切换对象存储。存储 key 由服务端随机生成，不含用户文件名。"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Protocol

_KEY_RE = re.compile(r"^[0-9a-f-]{36}/[0-9a-f]{32}$")


class Storage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


class LocalStorage:
    def __init__(self, base_dir: str) -> None:
        self.base = Path(base_dir).resolve()

    def _path(self, key: str) -> Path:
        if not _KEY_RE.match(key):
            raise ValueError("非法的存储 key")
        path = (self.base / key).resolve()
        if self.base not in path.parents:
            raise ValueError("非法的存储路径")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class MemoryStorage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def put(self, key: str, data: bytes) -> None:
        self.files[key] = data

    def get(self, key: str) -> bytes:
        return self.files[key]

    def delete(self, key: str) -> None:
        self.files.pop(key, None)
