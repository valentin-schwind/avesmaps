"""Nur EIN schwerer Lauf gleichzeitig (WI-0250 Phase B): eine Sperrdatei unter ``laeufe/`` und Vorprüfungen für Speicher und Platz.

Die Sperre wartet nicht: Wer sie nicht bekommt, bricht mit der Angabe ab, wer sie hält (Messläufe auf einem geteilten Rechner verfälschen
sich gegenseitig, und ein wartender Agent kostet). Eine Sperre eines toten Prozesses räumt der nächste Lauf ab.
"""

from __future__ import annotations

import ctypes
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from .umgebung import arbeitsspeicher_mib, freier_platz_gib

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
STILL_ACTIVE = 259


class Gesperrt(RuntimeError):
    """Ein anderer Lauf hält die Sperre."""


class Vorpruefung(RuntimeError):
    """Zu wenig freier Arbeitsspeicher oder Platz."""


def prozess_lebt(pid: int) -> bool:
    """Lebt der Prozess? Auf Windows über die Win32-Schnittstelle (``os.kill`` beendet dort Prozesse), sonst ``kill -0``."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        kernel = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == STILL_ACTIVE
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class Sperre:
    """``with Sperre(pfad, "perf schnell"):`` hält die Sperre für den Block."""

    def __init__(self, pfad: Path, was: str) -> None:
        self.pfad = Path(pfad)
        self.was = was

    def __enter__(self) -> "Sperre":
        self.pfad.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.pfad, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                halter = self._halter()
                if halter is not None and prozess_lebt(int(halter.get("pid", 0))):
                    raise Gesperrt(
                        f"Ein anderer Lauf hält die Sperre ({self.pfad}): {halter.get('was')} (Prozess {halter.get('pid')}, seit {halter.get('seit')}). "
                        "Nur ein schwerer Lauf gleichzeitig."
                    ) from None
                self.pfad.unlink(missing_ok=True)  # Rest eines toten Laufs
                continue
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"pid": os.getpid(), "was": self.was, "seit": time.strftime("%Y-%m-%d %H:%M:%S")}, f)
            return self
        raise Gesperrt(f"Sperre {self.pfad} nicht zu erhalten")

    def _halter(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.pfad.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def __exit__(self, *_: object) -> None:
        halter = self._halter()
        if halter is not None and halter.get("pid") == os.getpid():
            self.pfad.unlink(missing_ok=True)


def pruefe_ressourcen(daten_ordner: Path, mindest_ram_mib: float, mindest_platz_gib: float = 5.0) -> dict[str, float]:
    """Wirft ``Vorpruefung``, wenn weniger Arbeitsspeicher oder Platz frei ist als verlangt; gibt die gemessenen Werte zurück."""
    frei, gesamt = arbeitsspeicher_mib()
    platz = freier_platz_gib(daten_ordner)
    if frei < mindest_ram_mib:
        raise Vorpruefung(
            f"Nur {frei:.0f} MiB Arbeitsspeicher frei (von {gesamt:.0f}), gebraucht werden mindestens {mindest_ram_mib:.0f} MiB. "
            "Andere Läufe beenden lassen; ``--ohne-pruefung`` übergeht das bewusst."
        )
    if platz < mindest_platz_gib:
        raise Vorpruefung(f"Nur {platz:.1f} GiB Platz frei auf {daten_ordner}, gebraucht werden mindestens {mindest_platz_gib:.1f} GiB.")
    return {"ram_frei_mib": round(frei), "ram_gesamt_mib": round(gesamt), "platz_frei_gib": round(platz, 1)}
