"""Einzelmessungen der Optimierung (WI-0250 Phase A4): Kandidat → Auftrag → Raster (Zwischenspeicher oder Adapter) → drei Dimensionen → Datenbank.

``Budget`` hält die Grenzen eines Aufrufs (Zeit, Versuche, CPU, Arbeitsspeicher) und die Datei ``STOP`` im Laufordner; es wird **vor jeder neuen
Rechnung** geprüft und bricht mit ``Gestoppt`` ab, ohne etwas zu verlieren: Was gemessen ist, steht in der Datenbank, ``fortsetzen`` macht weiter.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from terrainlab.bewertung import Bewerter, Kontext
from terrainlab.lauf.adapter import Adapter, AdapterFehler, Unsauber
from terrainlab.lauf.cache import Zwischenspeicher
from terrainlab.lauf.konfig import Fall
from terrainlab.lauf.qualitaet import sichere_raster
from terrainlab.lauf.umgebung import arbeitsspeicher_mib

from .profil import Profil
from .raum import Raum
from .speicher import Speicher

ROLLEN = ("optimierung", "validierung")
VARIANTEN = ("gezeichnet", "ohne-kamm")
#: Mindestens so viel Arbeitsspeicher muss frei sein, bevor eine Rechnung dieser Auflösung beginnt (Python-Deskriptoren: rund 0,6 KB je Zelle).
RAM_JE_AUFLOESUNG = {0: 6000, 1: 0, 2: 0, 4: 1200}  # 0 = lokales Endgelände


class Gestoppt(Exception):
    """Der Lauf hält an (``STOP``-Datei, Zeit-, Versuchs-, CPU- oder Speichergrenze); er ist fortsetzbar."""

    def __init__(self, grund: str, art: str) -> None:
        super().__init__(grund)
        self.grund = grund
        self.art = art


class Budget:
    def __init__(self, ordner: Path, grenzen: dict[str, Any], melde: Callable[[str], None] = lambda t: None) -> None:
        self.ordner = Path(ordner)
        self.grenzen = grenzen
        self.melde = melde
        self.start = time.monotonic()
        self.cpu_start = time.process_time()
        self.versuche = 0
        self.adapter_cpu_s = 0.0

    @property
    def stop_datei(self) -> Path:
        return self.ordner / "STOP"

    def verbraucht(self) -> dict[str, float]:
        return {"zeit_s": round(time.monotonic() - self.start, 1), "versuche": self.versuche,
                "cpu_s": round(time.process_time() - self.cpu_start + self.adapter_cpu_s, 1)}

    def pruefe(self, aufloesung: int = 1) -> None:
        """Vor einer neuen Rechnung: wirft ``Gestoppt``, wenn eine Grenze erreicht ist; wartet bei knappem Arbeitsspeicher bis zu ``ram_warten_s``."""
        if self.stop_datei.exists():
            raise Gestoppt("STOP-Datei im Laufordner", "stop")
        g = self.grenzen
        if g.get("zeit_s") is not None and time.monotonic() - self.start >= g["zeit_s"]:
            raise Gestoppt(f"Zeitgrenze {g['zeit_s']} s erreicht", "zeit")
        if g.get("versuche") is not None and self.versuche >= g["versuche"]:
            raise Gestoppt(f"Versuchsgrenze {g['versuche']} erreicht", "versuche")
        if g.get("cpu_s") is not None and self.verbraucht()["cpu_s"] >= g["cpu_s"]:
            raise Gestoppt(f"CPU-Grenze {g['cpu_s']} s erreicht", "cpu")
        mindest = max(float(g.get("ram_min_mib") or 0), float(RAM_JE_AUFLOESUNG.get(aufloesung, 0)))
        if mindest > 0:
            ende = time.monotonic() + float(g.get("ram_warten_s") or 0)
            while True:
                frei, _ = arbeitsspeicher_mib()
                if frei >= mindest:
                    break
                if time.monotonic() >= ende:
                    raise Gestoppt(f"Nur {frei:.0f} MiB Arbeitsspeicher frei, verlangt sind {mindest:.0f} MiB", "ram")
                if self.stop_datei.exists():
                    raise Gestoppt("STOP-Datei im Laufordner", "stop")
                time.sleep(min(5.0, max(0.0, ende - time.monotonic())))

    def verbuche(self, meta: dict[str, Any]) -> None:
        self.versuche += 1
        self.adapter_cpu_s += float(meta["laeufe"][0].get("cpu_ms", 0.0)) / 1000.0


class Auswerter:
    """Misst Kandidaten und merkt sich jede Messung (Datenbank). Rechnet nichts, was schon gemessen ist."""

    def __init__(
        self,
        profil: Profil,
        commit: str,
        adapter: Adapter,
        cache: Zwischenspeicher,
        speicher: Speicher,
        bewerter: Bewerter,
        raeume: dict[str, Raum],
        kontexte: dict[str, Kontext],
        gebirge_dateien: dict[tuple[str, str], str],
        budget: Budget,
        arbeitsordner: Path,
        melde: Callable[[str], None] = lambda t: None,
    ) -> None:
        self.profil, self.commit, self.adapter, self.cache, self.db, self.bewerter = profil, commit, adapter, cache, speicher, bewerter
        self.raeume, self.kontexte, self.budget, self.arbeit, self.melde = raeume, kontexte, budget, Path(arbeitsordner), melde
        self.gebirge_dateien = gebirge_dateien
        self.rechnungen = 0
        self.treffer = 0

    # --- Auftrag --------------------------------------------------------------------------------------------------------
    def gebirge_quelle(self, typ: str, variante: str) -> dict[str, str]:
        gebirge = next(t.gebirge for t in self.profil.typen if t.typ == typ)
        if variante == "gezeichnet":
            return {"fixture": gebirge}
        return {"datei": self.gebirge_dateien[(typ, variante)]}

    def auftrag(self, typ: str, variante: str, kandidat: dict[str, Any], aufloesung: int, saat: int | None, name: str | None = None) -> dict[str, Any]:
        """Der Auftrag an den Adapter. Auflösung 1, 2, 4: Vorschau; Auflösung 0: lokales Endgelände (nur mit Schnappschuss, ausdrücklich im Profil)."""
        ueberlagerung = self.raeume[typ].ueberlagerung(kandidat)
        rezept: dict[str, Any] = {"fassung": self.profil.fassung}
        if ueberlagerung is not None:
            rezept["ueberlagerung"] = ueberlagerung
        auftrag: dict[str, Any] = {
            "name": name or f"{typ}-{Raum.schluessel(kandidat, variante)[:8]}-{aufloesung}x-s{self.profil.saat_name(saat)}",
            "gebirge": self.gebirge_quelle(typ, variante),
            "typ": typ,
            "reglerQuelle": "preset",
            "regler": {},
            "modell": {},
            "saat": saat,
            "rezept": rezept,
        }
        if aufloesung == 0:
            auftrag["stufe"] = "endgelaende-lokal"
            auftrag["endgelaende"] = {"rand": 6, "zwischenstaende": False, "schnappschuss": self.profil.endgelaende.get("schnappschuss"), "gebirgeId": None}
        else:
            auftrag["stufe"] = "vorschau"
            auftrag["vorschau"] = {"aufloesung": aufloesung, "kante": int(self.profil.vorschau["kante"]), "talboden": self.profil.vorschau["talboden"]}
        return auftrag

    # --- Messung --------------------------------------------------------------------------------------------------------
    def kandidat_id(self, typ: str, variante: str, kandidat: dict[str, Any], herkunft: str) -> int:
        return self.db.kandidat(typ, variante, Raum.schluessel(kandidat, variante), kandidat, herkunft)

    def messe(
        self, typ: str, kandidat: dict[str, Any], aufloesung: int, saat: int | None, *, rolle: str = "optimierung", variante: str = "gezeichnet", herkunft: str = "",
    ) -> dict[str, Any] | None:
        """Die Messwerte (drei Dimensionen) eines Kandidaten in einer Auflösung und Saat; ``None``, wenn die Rechnung scheiterte. Gespeichertes wird nicht neu gerechnet."""
        if rolle not in ROLLEN:
            raise ValueError(f"Rolle {rolle}")
        kid = self.kandidat_id(typ, variante, kandidat, herkunft)
        saat_name = self.profil.saat_name(saat)
        alt = self.db.messung(kid, aufloesung, saat_name, rolle)
        if alt is not None and alt["status"] == "ok":
            return alt["werte"]
        if alt is not None and alt["status"] == "fehler":
            return None
        auftrag = self.auftrag(typ, variante, kandidat, aufloesung, saat)
        t0 = time.monotonic()
        # Das Raster liegt vielleicht schon im Zwischenspeicher (dieselbe Rechnung unter anderer Rolle oder aus einem früheren Lauf): dann kostet es nichts.
        info = self.adapter.fingerprint(auftrag, self.commit)
        schon = self.cache.hole_raster(info.commit, info.auftrag_fingerprint) is not None
        if not schon:
            self.budget.pruefe(aufloesung)
        fall = Fall(name=auftrag["name"], auftrag=auftrag)
        try:
            meta, ordner, aus_cache = sichere_raster(
                self.adapter, self.cache, fall, info, commit=self.commit, cache_neu=False, schmutzig_erlauben=False, arbeitsordner=self.arbeit / "roh" / auftrag["name"],
                timeout=1800,
            )
        except Unsauber:
            raise
        except AdapterFehler as fehler:
            if fehler.code in (3, 4):
                raise
            self.db.speichere_messung(kid, aufloesung, saat_name, rolle, "fehler", commit=self.commit, fingerprint=info.auftrag_fingerprint, auftrag=auftrag,
                                      fehler=str(fehler)[:1500], dauer_s=time.monotonic() - t0)
            self.melde(f"  Fehler im Generator ({typ} {Raum.schluessel(kandidat, variante)[:8]} {aufloesung}x): {str(fehler)[-200:]}")
            return None
        if not aus_cache:
            self.budget.verbuche(meta)
            self.rechnungen += 1
        else:
            self.treffer += 1
        werte = self.bewerter.bewerte(self.kontexte[typ], rolle, meta, ordner)
        werte["kandidat"] = kandidat
        werte["herkunft_stand"] = {"commit": info.commit, "fingerprint": info.auftrag_fingerprint}
        self.db.speichere_messung(kid, aufloesung, saat_name, rolle, "ok", commit=info.commit, fingerprint=info.auftrag_fingerprint, auftrag=auftrag, werte=werte,
                                  aus_cache=aus_cache, dauer_s=time.monotonic() - t0)
        zeile = {"typ": typ, "variante": variante, "kandidat": kandidat, "aufloesung": aufloesung, "saat": saat_name, "rolle": rolle, "d1": (werte.get("d1") or {}).get("leitwert"),
                 "form": (werte.get("d2") or {}).get("leitwert"), "wall_ms": werte["d3"]["wall_ms"], "aus_cache": aus_cache}
        with (self.arbeit / "protokoll.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(zeile, ensure_ascii=False) + "\n")
        return werte
