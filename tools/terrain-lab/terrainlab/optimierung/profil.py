"""Profile der Optimierung (WI-0250 Phase A4): was gesucht wird und wie viel es kosten darf. JSON unter ``tools/terrain-lab/konfig/``.

Aufbau (alle Schlüssel außer ``name``, ``commit`` und ``typen`` haben eine Vorgabe)::

    {
      "name": "durchstich",
      "beschreibung": "…",
      "commit": "f1586257d",             // Generator-Stand, an dem ALLES gerechnet wird (Pflicht; nie ein halb veränderter Arbeitsbaum)
      "fassung": 19,                      // Fassung des Rezepts (die Presets stehen erst in der offenen 19)
      "typen": [ { "typ": "kettengebirge", "gebirge": "blutzinnen" } ],   // je Typ eine Fixture (Gebirgsdatei) als Geometrie
      "saaten": [null, 4711, 9173],       // feste Saaten; null = die der Fixture
      "vorschau": { "kante": 640, "talboden": "typ" },
      "bewertung": { "plausibilitaet": { … }, "tor_faktor": 0.8 },
      "ausschluss": [],                   // Parameter, die nie verstellt werden (Muster mit *)
      "sensitivitaet": { "trajektorien": 3, "ebenen": 4, "schwelle": 0.05, "max_aktiv": 12 },
      "suche": { "kandidaten": 32, "eta": 3, "saaten": 3, "verfeinerung": { "runden": 2, "nachkommen": 6, "schritt": 0.15 }, "seed": 20261023 },
      "validierung": { "beste": 3, "aufloesungen": [2, 4], "vier_x_fuer": 1, "saaten": 2, "gewinn_min": 0.02 },
      "strategien": { "aktiv": true, "kandidaten": 8, "erreichbar_faktor": 2.0 },
      "endgelaende": { "aktiv": false, "beste": 0, "schnappschuss": null },
      "grenzen": { "zeit_s": 3000, "versuche": 600, "cpu_s": null, "ram_min_mib": 600, "ram_warten_s": 120 }
    }

(Die Kommentare dienen der Erklärung; JSON kennt keine.) Nicht genannte Teile erhalten die Vorgaben dieser Datei.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from terrainlab.bewertung.plausibilitaet import Einstellungen

PROFIL_ORDNER = Path(__file__).resolve().parents[2] / "konfig"
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
GEBIRGSNAME = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class ProfilFehler(ValueError):
    """Das Profil ist nicht zulässig; die Meldung nennt die Stelle."""


VORGABEN: dict[str, Any] = {
    "fassung": 19,
    "saaten": [None, 4711, 9173],
    "vorschau": {"kante": 640, "talboden": "typ"},
    "bewertung": {"plausibilitaet": {}, "tor_faktor": 0.8},
    "ausschluss": [],
    "sensitivitaet": {"trajektorien": 3, "ebenen": 4, "schwelle": 0.05, "max_aktiv": 12, "seed": 1},
    "suche": {"kandidaten": 32, "eta": 3, "saaten": 3, "verfeinerung": {"runden": 2, "nachkommen": 6, "schritt": 0.15}, "seed": 20261023},
    "validierung": {"beste": 3, "aufloesungen": [2, 4], "vier_x_fuer": 1, "saaten": 2, "gewinn_min": 0.02},
    "strategien": {"aktiv": True, "kandidaten": 8, "erreichbar_faktor": 2.0},
    "endgelaende": {"aktiv": False, "beste": 0, "schnappschuss": None},
    "grenzen": {"zeit_s": 3000, "versuche": 600, "cpu_s": None, "ram_min_mib": 600, "ram_warten_s": 120},
}


def _mischen(ziel: dict[str, Any], quelle: dict[str, Any], pfad: str = "") -> dict[str, Any]:
    for k, v in quelle.items():
        if k not in ziel:
            raise ProfilFehler(f"{pfad}{k}: unbekannter Schlüssel")
        if isinstance(v, dict) and isinstance(ziel[k], dict) and ziel[k]:
            _mischen(ziel[k], v, f"{pfad}{k}.")
        else:
            ziel[k] = copy.deepcopy(v)
    return ziel


@dataclass
class TypFall:
    typ: str
    gebirge: str


@dataclass
class Profil:
    name: str
    beschreibung: str
    commit: str
    typen: list[TypFall]
    fassung: int
    saaten: list[int | None]
    vorschau: dict[str, Any]
    plausibilitaet: Einstellungen
    tor_faktor: float
    ausschluss: list[str]
    sensitivitaet: dict[str, Any]
    suche: dict[str, Any]
    validierung: dict[str, Any]
    strategien: dict[str, Any]
    endgelaende: dict[str, Any]
    grenzen: dict[str, Any]
    roh: dict[str, Any] = field(default_factory=dict)

    def saat_name(self, saat: int | None) -> str:
        return "fixture" if saat is None else str(saat)


def _ganz(wert: Any, pfad: str, lo: int, hi: int) -> int:
    if not isinstance(wert, int) or isinstance(wert, bool) or not lo <= wert <= hi:
        raise ProfilFehler(f"{pfad}: ganze Zahl von {lo} bis {hi} erwartet")
    return wert


def parse_profil(roh: dict[str, Any]) -> Profil:
    """Prüft ein Profil aus JSON und mischt die Vorgaben ein; wirft ``ProfilFehler`` mit dem Pfad der Stelle."""
    if not isinstance(roh, dict):
        raise ProfilFehler("Profil: Objekt erwartet")
    bekannt = {"name", "beschreibung", "commit", "typen", *VORGABEN}
    unbekannt = set(roh) - bekannt
    if unbekannt:
        raise ProfilFehler(f"Unbekannte Schlüssel: {sorted(unbekannt)}")
    if not isinstance(roh.get("name"), str) or not NAME.match(roh["name"]):
        raise ProfilFehler("name: Name aus Buchstaben, Ziffern, Punkt, Unter- und Bindestrich erwartet")
    if not isinstance(roh.get("commit"), str) or not roh["commit"].strip():
        raise ProfilFehler("commit: der Generator-Stand, an dem gerechnet wird, ist Pflicht (Hash oder Name, zum Beispiel origin/master)")
    if roh["commit"].startswith("-"):
        raise ProfilFehler("commit: ungültig")
    typen_roh = roh.get("typen")
    if not isinstance(typen_roh, list) or not typen_roh:
        raise ProfilFehler("typen: nicht leere Liste aus { typ, gebirge } erwartet")
    typen = []
    for i, t in enumerate(typen_roh):
        if not isinstance(t, dict) or set(t) != {"typ", "gebirge"}:
            raise ProfilFehler(f"typen[{i}]: genau typ und gebirge erwartet")
        if not isinstance(t["typ"], str) or not isinstance(t["gebirge"], str) or not GEBIRGSNAME.match(t["gebirge"]):
            raise ProfilFehler(f"typen[{i}]: typ und gebirge (Kleinbuchstaben, Ziffern, Bindestrich) erwartet")
        typen.append(TypFall(t["typ"], t["gebirge"]))
    if len({t.typ for t in typen}) != len(typen):
        raise ProfilFehler("typen: ein Typ höchstens einmal")
    werte = copy.deepcopy(VORGABEN)
    for k in VORGABEN:
        if k in roh:
            if isinstance(VORGABEN[k], dict):
                if not isinstance(roh[k], dict):
                    raise ProfilFehler(f"{k}: Objekt erwartet")
                _mischen(werte[k], roh[k], f"{k}.")
            else:
                werte[k] = copy.deepcopy(roh[k])
    saaten = werte["saaten"]
    if not isinstance(saaten, list) or not saaten or any(s is not None and (not isinstance(s, int) or isinstance(s, bool)) for s in saaten):
        raise ProfilFehler("saaten: nicht leere Liste ganzer Zahlen (null = Saat der Fixture)")
    if len(set(saaten)) != len(saaten):
        raise ProfilFehler("saaten: doppelte Saat")
    _ganz(werte["fassung"], "fassung", 1, 10_000)
    s, su, va = werte["sensitivitaet"], werte["suche"], werte["validierung"]
    _ganz(s["trajektorien"], "sensitivitaet.trajektorien", 1, 100)
    _ganz(s["ebenen"], "sensitivitaet.ebenen", 2, 10)
    if s["ebenen"] % 2:
        raise ProfilFehler("sensitivitaet.ebenen: gerade Zahl erwartet")
    _ganz(s["max_aktiv"], "sensitivitaet.max_aktiv", 1, 100)
    _ganz(su["kandidaten"], "suche.kandidaten", 1, 4096)
    _ganz(su["eta"], "suche.eta", 2, 10)
    _ganz(su["saaten"], "suche.saaten", 1, len(saaten))
    _ganz(va["beste"], "validierung.beste", 0, 20)
    _ganz(va["saaten"], "validierung.saaten", 1, len(saaten))
    if any(a not in (2, 4) for a in va["aufloesungen"]):
        raise ProfilFehler("validierung.aufloesungen: nur 2 und 4 (1 ist die Suche)")
    if not 0 < float(werte["bewertung"]["tor_faktor"]) <= 1:
        raise ProfilFehler("bewertung.tor_faktor: Zahl über 0 bis 1")
    if werte["vorschau"]["talboden"] not in ("typ", "ableiten"):
        raise ProfilFehler('vorschau.talboden: "typ" oder "ableiten"')
    try:
        einst = Einstellungen.aus_dict(werte["bewertung"]["plausibilitaet"])
    except (ValueError, TypeError) as fehler:
        raise ProfilFehler(f"bewertung.plausibilitaet: {fehler}") from fehler
    return Profil(
        name=roh["name"], beschreibung=str(roh.get("beschreibung", "")), commit=roh["commit"].strip(), typen=typen, fassung=werte["fassung"], saaten=list(saaten),
        vorschau=werte["vorschau"], plausibilitaet=einst, tor_faktor=float(werte["bewertung"]["tor_faktor"]), ausschluss=list(werte["ausschluss"]),
        sensitivitaet=s, suche=su, validierung=va, strategien=werte["strategien"], endgelaende=werte["endgelaende"], grenzen=werte["grenzen"], roh=roh,
    )


def lade_profil(angabe: str | Path) -> Profil:
    """Eine Datei oder der Name eines Profils unter ``tools/terrain-lab/konfig/``."""
    pfad = Path(angabe)
    if not pfad.exists():
        eingebaut = PROFIL_ORDNER / f"{angabe}.json"
        if not eingebaut.exists():
            namen = sorted(p.stem for p in PROFIL_ORDNER.glob("*.json"))
            raise ProfilFehler(f"Profil {angabe} gibt es nicht (Datei oder eines von {namen})")
        pfad = eingebaut
    try:
        return parse_profil(json.loads(pfad.read_text(encoding="utf-8")))
    except json.JSONDecodeError as fehler:
        raise ProfilFehler(f"{pfad}: kein gültiges JSON ({fehler})") from fehler
