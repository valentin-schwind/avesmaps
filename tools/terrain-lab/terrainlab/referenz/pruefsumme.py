"""SHA-256 für Dateien und Byteblöcke (gestreamt, damit große Rohraster nicht ganz in den Speicher müssen)."""

from __future__ import annotations

import hashlib
from pathlib import Path

BLOCK = 4 * 1024 * 1024


def sha256_datei(pfad: Path | str) -> str:
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        while True:
            block = f.read(BLOCK)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def sha256_bytes(daten: bytes) -> str:
    return hashlib.sha256(daten).hexdigest()
