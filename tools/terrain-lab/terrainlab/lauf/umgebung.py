"""Orte und Rechnerangaben der Läufe (WI-0250 Phase B): Repository, Node, freier Speicher und Platz, Git, Hash."""

from __future__ import annotations

import ctypes
import hashlib
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from terrainlab import daten_wurzel


def repo_wurzel() -> Path:
    """Wurzel des Checkouts, in dem dieses Paket liegt (``tools/terrain-lab/terrainlab/lauf`` vier Ebenen höher)."""
    return Path(__file__).resolve().parents[4]


def adapter_skript() -> Path:
    return repo_wurzel() / "scripts" / "dev" / "terrain-lab" / "rechne.ts"


def grenzen_skript() -> Path:
    """Der Adapterbefehl, der die Parametergrenzen des Generators als JSON ausgibt (WI-0250 Phase A4)."""
    return repo_wurzel() / "scripts" / "dev" / "terrain-lab" / "grenzen.ts"


def node_pfad() -> str:
    """``AVESMAPS_NODE``, sonst ``node`` aus dem Suchpfad."""
    pfad = os.environ.get("AVESMAPS_NODE") or shutil.which("node")
    if not pfad:
        raise FileNotFoundError("Node.js nicht gefunden (Suchpfad oder AVESMAPS_NODE)")
    return pfad


def laeufe_wurzel() -> Path:
    return daten_wurzel() / "laeufe"


def cache_wurzel() -> Path:
    return daten_wurzel() / "cache"


class _Speicherstand(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def arbeitsspeicher_mib() -> tuple[float, float]:
    """(frei, gesamt) in MiB; auf Windows über ``GlobalMemoryStatusEx``, sonst ``/proc/meminfo``."""
    if sys.platform == "win32":
        s = _Speicherstand()
        s.dwLength = ctypes.sizeof(_Speicherstand)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s))  # type: ignore[attr-defined]
        return s.ullAvailPhys / 2**20, s.ullTotalPhys / 2**20
    werte: dict[str, float] = {}
    for zeile in Path("/proc/meminfo").read_text().splitlines():
        name, _, rest = zeile.partition(":")
        werte[name] = float(rest.split()[0]) / 1024
    return werte.get("MemAvailable", 0.0), werte.get("MemTotal", 0.0)


def freier_platz_gib(pfad: Path) -> float:
    pfad = pfad if pfad.exists() else next(p for p in pfad.parents if p.exists())
    return shutil.disk_usage(pfad).free / 2**30


def git(args: list[str], cwd: Path | None = None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd or repo_wurzel(), capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout.strip()


def loese_commit(angabe: str) -> str:
    """Voller Commit-Hash zu einer Angabe (Hash, Kurzhash, Name); wirft bei unbekanntem Commit."""
    if angabe.startswith("-"):
        raise ValueError(f"Ungültige Commit-Angabe: {angabe}")
    try:
        return git(["rev-parse", "--verify", f"{angabe}^{{commit}}"])
    except RuntimeError as fehler:
        raise ValueError(f"Commit {angabe} nicht gefunden (lokal vorhanden? git fetch origin)") from fehler


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_datei(pfad: Path) -> str:
    h = hashlib.sha256()
    with pfad.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def rechnerangaben() -> dict[str, Any]:
    """Was zu einer Messung gehört: Rechner, Python- und Bibliotheksfassungen, Node (Fassung, wie ``node --version``)."""
    import numpy
    import scipy

    frei, gesamt = arbeitsspeicher_mib()
    try:
        node = subprocess.run([node_pfad(), "--version"], capture_output=True, text=True).stdout.strip()
    except (FileNotFoundError, OSError):
        node = None
    return {
        "plattform": platform.platform(),
        "prozessor": platform.processor(),
        "kerne": os.cpu_count(),
        "arbeitsspeicher_gib": round(gesamt / 1024, 1),
        "arbeitsspeicher_frei_mib": round(frei),
        "python": platform.python_version(),
        "numpy": numpy.__version__,
        "scipy": scipy.__version__,
        "node": node,
        "erosion_arbeiter_umgebung": os.environ.get("TERRAIN_EROSION_WORKERS"),
    }
