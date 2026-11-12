"""Hilfsmittel der Lauf-Tests: eine Attrappe des Adapters, die schreibt, was ``rechne.ts`` schriebe, ohne Node und ohne Generator."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from terrainlab.deskriptoren.synthetisch import fbm
from terrainlab.lauf.adapter import AuftragsInfo
from terrainlab.lauf.cache import kanonisch
from terrainlab.raster import schreibe

COMMIT_A = "a" * 40
COMMIT_B = "b" * 40


class Attrappe:
    def __init__(self, commit: str = COMMIT_A, sauber: bool = True, zeiten_ms: tuple[float, ...] = (1000.0, 1100.0, 1050.0), relief_m: float = 1500.0,
                 fremdlast: float = 0.5) -> None:
        self.fremdlast = fremdlast
        self.commit = commit
        self.sauber = sauber
        self.zeiten_ms = zeiten_ms
        self.relief_m = relief_m
        self.rechnungen = 0
        self.aufrufe: list[dict[str, Any]] = []
        self.fingerprints = 0

    def _fp(self, auftrag: dict[str, Any]) -> str:
        rest = {k: v for k, v in auftrag.items() if k != "name"}
        return hashlib.sha256(kanonisch(rest).encode()).hexdigest()

    def fingerprint(self, auftrag: dict[str, Any], commit: str | None = None, timeout: float | None = None) -> AuftragsInfo:
        self.fingerprints += 1
        return AuftragsInfo(self._fp(auftrag), commit or self.commit, self.sauber, () if self.sauber else ("packages/shared/src/x.ts",), auftrag.get("name", "a"), auftrag["stufe"])

    def rechne(self, auftrag: dict[str, Any], ausgabe: Path, *, commit: str | None = None, warm: int = 0, phasen: bool = False,
               phasen_wiederholungen: int = 3, arbeiter: int | None = None, ohne_raster: bool = False, schmutzig_erlauben: bool = False,
               timeout: float | None = None) -> dict[str, Any]:
        ausgabe = Path(ausgabe)
        ausgabe.mkdir(parents=True, exist_ok=True)
        self.aufrufe.append({"auftrag": auftrag, "commit": commit, "warm": warm, "phasen": phasen, "arbeiter": arbeiter, "ohne_raster": ohne_raster})
        i = self.rechnungen
        self.rechnungen += 1
        seed = int(self._fp(auftrag)[:6], 16)
        raster = fbm((48, 56), 750.0, relief_m=self.relief_m, seed=seed)
        datei = {"name": "vorschau-1x", "datei": "vorschau-1x.json", "sha256": "0" * 64, "breite": 56, "hoehe": 48, "zellgroesse_m": 750.0}
        if not ohne_raster:
            pfad = schreibe(raster, ausgabe / "vorschau-1x")
            datei["sha256"] = json.loads(pfad.read_text(encoding="utf-8"))["sha256"]
        zeiten = [self.zeiten_ms[(i + k) % len(self.zeiten_ms)] for k in range(1 + warm)]
        laeufe = [
            {"art": "kalt" if k == 0 else "warm", "wall_ms": z * (1.0 if k == 0 else 0.9), "cpu_ms": z * 1.2, "rss_spitze_mib": 200.0 + k, "rss_ende_mib": 150.0,
             "fremdlast_kerne": self.fremdlast, "maschine_prozent": 10.0}
            for k, z in enumerate(zeiten)
        ]
        meta: dict[str, Any] = {
            "format": "avesmaps-terrainlab-lauf",
            "version": 1,
            "stufe": auftrag["stufe"],
            "auftrag": auftrag,
            "stand": {"art": "stand", "commit": commit or self.commit, "baum_sauber": True, "reproduzierbar": True},
            "rezept": {"fassung": 19, "fingerprint": "r" * 64},
            "raster": {"breite": 56, "hoehe": 48, "zellgroesse_m": 750.0, "zellen": 56 * 48, "eigene_zellen": 1000,
                       "ergebnis_fingerprint": hashlib.sha256(raster.hoehen.tobytes()).hexdigest(), "dateien": [datei]},
            "umgebung": {"node": "24.0.0", "node_optionen": ["--expose-gc"], "abhaengigkeiten": {}, "kerne": 24},
            "laeufe": laeufe,
            "deterministisch": True,
            "phasen_ms": None,
            "gruppen_ms": None,
            "phasenproben": None,
            "zwischenstaende": None,
            "zusatz": {"talboden": 0.4},
        }
        if phasen:
            meta["phasenproben"] = {"methode": "differenz", "wiederholungen": phasen_wiederholungen, "proben_ms": {},
                                    "phasen_ms": {"netz_hebung": 100.0 + i, "landschaft": 900.0 - i}, "ergebnis_gleich": True, "hinweise": []}
        if auftrag["stufe"] == "endgelaende-lokal":
            meta["gruppen_ms"] = {"saat": 10.0, "grob": 500.0, "fein": 80.0, "schluss": 20.0}
            meta["phasen_ms"] = {"saat": 10.0, "grob:seed": 500.0, "fein": 80.0, "schluss": 20.0}
            meta["zusatz"].update(erosion={"iterationen": 20, "arbeiter": arbeiter}, fein_kacheln_gerechnet=4)
        (ausgabe / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
        return meta


def auftrag(name: str = "a", stufe: str = "vorschau", **extra: Any) -> dict[str, Any]:
    return {"name": name, "gebirge": {"fixture": "blutzinnen"}, "stufe": stufe, **extra}
