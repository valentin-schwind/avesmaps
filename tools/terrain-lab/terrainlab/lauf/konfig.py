"""Konfigurationen der Läufe (WI-0250 Phase B): Fälle, Wiederholungen, Messoptionen. JSON, eingebaute Profile unter ``profile/``.

Aufbau::

    {
      "name": "perf-schnell",
      "beschreibung": "…",
      "vorgabe": { "rezept": { "fassung": 19 } },      // Auftragsfelder, die in JEDEN Fall tief eingemischt werden
      "wiederholungen": 3,                              // frische Prozesse je Fall (jeder rechnet kalt)
      "warm": 1,                                        // warme Läufe nach dem kalten, im selben Prozess
      "phasen": "erster",                               // "aus" | "erster" (Phasenproben im ersten Prozess) | "alle"
      "phasen_wiederholungen": 3,
      "arbeiter": null,                                 // TERRAIN_EROSION_WORKERS (nur Endgelände relevant)
      "faelle": [ { "name": "x", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau", … } ],
      "matrix": [ { "fixtures": ["blutzinnen"], "stufe": "vorschau", "aufloesungen": [1, 2, 4] } ],
      "qualitaet": { "gruppen": null, "ohne_teuer": false, "parameter": {} },   // Deskriptoren (Qualitätslauf)
      "ziele": { "hang_neigung_mittel": { "richtung": "hoeher" } }               // Bewertung beim Commit-Vergleich
    }

(Die Kommentare dienen nur der Erklärung; JSON kennt keine.)

Ein Fall trägt die Felder des Auftrags (``scripts/dev/terrain-lab/auftrag.ts``) und darf die Messoptionen ``wiederholungen``, ``warm``,
``phasen``, ``phasen_wiederholungen`` und ``referenz`` (Pfad eines Referenzrasters für die Bewertung) überschreiben.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PROFIL_ORDNER = Path(__file__).resolve().parent / "profile"
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
FALL_OPTIONEN = ("wiederholungen", "warm", "phasen", "phasen_wiederholungen", "referenz")
PHASEN_WAHL = ("aus", "erster", "alle")


class KonfigFehler(ValueError):
    """Die Konfiguration ist nicht zulässig; die Meldung nennt die Stelle."""


@dataclass(frozen=True)
class Fall:
    name: str
    auftrag: dict[str, Any]
    wiederholungen: int = 3
    warm: int = 1
    phasen: str = "aus"
    phasen_wiederholungen: int = 3
    referenz: str | None = None

    @property
    def stufe(self) -> str:
        return str(self.auftrag["stufe"])


@dataclass
class Konfig:
    name: str
    beschreibung: str = ""
    faelle: list[Fall] = field(default_factory=list)
    arbeiter: int | None = None
    qualitaet: dict[str, Any] = field(default_factory=dict)
    ziele: dict[str, dict[str, Any]] = field(default_factory=dict)
    mindest_frei_ram_mib: int | None = None
    roh: dict[str, Any] = field(default_factory=dict)

    def waehle(self, namen: list[str] | None) -> "Konfig":
        """Nur die genannten Fälle (Teilzeichenfolge des Namens genügt); eine Auswahl ohne Treffer ist ein Fehler."""
        if not namen:
            return self
        auswahl = [f for f in self.faelle if any(n in f.name for n in namen)]
        if not auswahl:
            raise KonfigFehler(f"Keiner der Fälle passt zu {namen}; vorhanden: {[f.name for f in self.faelle]}")
        kopie = copy.copy(self)
        kopie.faelle = auswahl
        return kopie


def _tief_mischen(ziel: dict[str, Any], quelle: dict[str, Any]) -> dict[str, Any]:
    for k, v in quelle.items():
        if isinstance(v, dict) and isinstance(ziel.get(k), dict):
            _tief_mischen(ziel[k], v)
        else:
            ziel[k] = copy.deepcopy(v)
    return ziel


def _ganz(wert: Any, pfad: str, minimum: int, maximum: int) -> int:
    if not isinstance(wert, int) or isinstance(wert, bool) or not minimum <= wert <= maximum:
        raise KonfigFehler(f"{pfad}: ganze Zahl von {minimum} bis {maximum} erwartet")
    return wert


def _fall(roh: dict[str, Any], vorgabe: dict[str, Any], kopf: dict[str, Any], pfad: str) -> Fall:
    if not isinstance(roh.get("name"), str) or not NAME.match(roh["name"]):
        raise KonfigFehler(f"{pfad}.name: Name aus Buchstaben, Ziffern, Punkt, Unter- und Bindestrich erwartet")
    optionen = {k: roh[k] for k in FALL_OPTIONEN if k in roh}
    auftrag = _tief_mischen(copy.deepcopy(vorgabe), {k: v for k, v in roh.items() if k not in FALL_OPTIONEN})
    if "stufe" not in auftrag or "gebirge" not in auftrag:
        raise KonfigFehler(f"{pfad}: Auftrag braucht gebirge und stufe")
    phasen = optionen.get("phasen", kopf.get("phasen", "aus"))
    if phasen is True:
        phasen = "erster"
    if phasen is False:
        phasen = "aus"
    if phasen not in PHASEN_WAHL:
        raise KonfigFehler(f"{pfad}.phasen: eines von {PHASEN_WAHL}")
    return Fall(
        name=roh["name"],
        auftrag=auftrag,
        wiederholungen=_ganz(optionen.get("wiederholungen", kopf.get("wiederholungen", 3)), f"{pfad}.wiederholungen", 1, 50),
        warm=_ganz(optionen.get("warm", kopf.get("warm", 1)), f"{pfad}.warm", 0, 20),
        phasen=phasen,
        phasen_wiederholungen=_ganz(optionen.get("phasen_wiederholungen", kopf.get("phasen_wiederholungen", 3)), f"{pfad}.phasen_wiederholungen", 1, 20),
        referenz=optionen.get("referenz"),
    )


def _matrix_faelle(eintrag: dict[str, Any], pfad: str) -> list[dict[str, Any]]:
    fixtures = eintrag.get("fixtures")
    if not isinstance(fixtures, list) or not fixtures:
        raise KonfigFehler(f"{pfad}.fixtures: nicht leere Liste erwartet")
    stufe = eintrag.get("stufe")
    if stufe not in ("vorschau", "saat", "endgelaende-lokal"):
        raise KonfigFehler(f"{pfad}.stufe: vorschau, saat oder endgelaende-lokal")
    aufloesungen = eintrag.get("aufloesungen", [1]) if stufe == "vorschau" else [None]
    rest = {k: v for k, v in eintrag.items() if k not in ("fixtures", "aufloesungen", "namen")}
    kurz = {"vorschau": "vorschau", "saat": "saat", "endgelaende-lokal": "endgelaende"}[stufe]
    faelle = []
    for fixture in fixtures:
        for a in aufloesungen:
            fall = copy.deepcopy(rest)
            fall["gebirge"] = {"fixture": fixture}
            name = f"{fixture}-{kurz}" + (f"-{a}x" if a is not None else "")
            if a is not None:
                _tief_mischen(fall, {"vorschau": {"aufloesung": a}})
            fall["name"] = str(eintrag.get("namen", "{name}")).format(name=name, fixture=fixture, aufloesung=a)
            faelle.append(fall)
    return faelle


def parse_konfig(roh: dict[str, Any]) -> Konfig:
    """Prüft eine Konfiguration aus JSON, erweitert die Matrix und mischt die Vorgabe in jeden Fall."""
    if not isinstance(roh, dict) or not isinstance(roh.get("name"), str) or not NAME.match(roh["name"]):
        raise KonfigFehler("name: Name aus Buchstaben, Ziffern, Punkt, Unter- und Bindestrich erwartet")
    bekannt = {"format", "version", "name", "beschreibung", "vorgabe", "wiederholungen", "warm", "phasen", "phasen_wiederholungen",
               "arbeiter", "faelle", "matrix", "qualitaet", "ziele", "mindest_frei_ram_mib"}
    unbekannt = set(roh) - bekannt
    if unbekannt:
        raise KonfigFehler(f"Unbekannte Schlüssel: {sorted(unbekannt)}")
    vorgabe = roh.get("vorgabe", {})
    if not isinstance(vorgabe, dict):
        raise KonfigFehler("vorgabe: Objekt erwartet")
    rohe = [(f"faelle[{i}]", f) for i, f in enumerate(roh.get("faelle", []))]
    for i, eintrag in enumerate(roh.get("matrix", [])):
        rohe += [(f"matrix[{i}]", f) for f in _matrix_faelle(eintrag, f"matrix[{i}]")]
    faelle = [_fall(f, vorgabe, roh, pfad) for pfad, f in rohe]
    if not faelle:
        raise KonfigFehler("Keine Fälle (faelle oder matrix)")
    doppelt = sorted({f.name for f in faelle if sum(1 for g in faelle if g.name == f.name) > 1})
    if doppelt:
        raise KonfigFehler(f"Fallnamen doppelt: {doppelt}")
    arbeiter = roh.get("arbeiter")
    if arbeiter is not None:
        _ganz(arbeiter, "arbeiter", 0, 8)
    return Konfig(
        name=roh["name"],
        beschreibung=str(roh.get("beschreibung", "")),
        faelle=faelle,
        arbeiter=arbeiter,
        qualitaet=dict(roh.get("qualitaet", {})),
        ziele=dict(roh.get("ziele", {})),
        mindest_frei_ram_mib=roh.get("mindest_frei_ram_mib"),
        roh=roh,
    )


def lade_konfig(angabe: str | Path) -> Konfig:
    """Eine Datei oder der Name eines eingebauten Profils (``schnell``, ``voll``, … siehe ``profile/``)."""
    pfad = Path(angabe)
    if not pfad.exists():
        eingebaut = PROFIL_ORDNER / f"{angabe}.json"
        if not eingebaut.exists():
            namen = sorted(p.stem for p in PROFIL_ORDNER.glob("*.json"))
            raise KonfigFehler(f"Konfiguration {angabe} gibt es nicht (Datei oder eingebautes Profil: {namen})")
        pfad = eingebaut
    try:
        return parse_konfig(json.loads(pfad.read_text(encoding="utf-8")))
    except json.JSONDecodeError as fehler:
        raise KonfigFehler(f"{pfad}: kein gültiges JSON ({fehler})") from fehler


SCHNAPPSCHUSS_DATEIEN = ("inputs.json", "gebirge.json", "master.json", "seeds.u16", "master.u16")


def pruefe_schnappschuesse(konfig: Konfig, labor: Path) -> None:
    """Früh prüfen, nicht nach einer halben Stunde: Jeder Endgelände-Fall braucht einen vollständigen Schnappschuss."""
    for fall in konfig.faelle:
        if fall.stufe != "endgelaende-lokal":
            continue
        angabe = (fall.auftrag.get("endgelaende") or {}).get("schnappschuss")
        ordner = Path(angabe) if angabe else labor / "schnappschuss" / "aktuell"
        fehlend = [d for d in SCHNAPPSCHUSS_DATEIEN if not (ordner / d).exists()]
        if fehlend:
            raise KonfigFehler(
                f"Fall {fall.name}: Schnappschuss {ordner} unvollständig, es fehlt {', '.join(fehlend)}. "
                "Mit --schnappschuss ORDNER einen vorhandenen nennen (Muster: project-control/discovery/wi-0249-formerhalt/snapshot.mjs, nur lesend) "
                "oder den Fall mit --nur auslassen."
            )
