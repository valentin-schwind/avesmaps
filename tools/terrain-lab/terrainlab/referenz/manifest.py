"""Manifest des Referenzkorpus: Pfade, Laden, Speichern und Schemaprüfung.

`referenz/manifest.json` beschreibt jeden Ausschnitt (Herkunft, Quelle, Lizenz, Typ, Rolle, Aufbereitung) und trägt die SHA-256-Prüfsummen
der Quelldateien und der aufbereiteten Raster. Das Rezept je Ausschnitt (`referenz/rezepte/<id>.json`) sagt maschinenlesbar, wie aus den
Rohdaten die Zielraster entstehen. Dateipfade im Manifest sind relativ zu `daten_wurzel()` und mit `/` geschrieben.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from terrainlab import daten_wurzel

from .jsonschreiber import zu_text

FORMAT = "avesmaps-referenzkorpus"
VERSION = 1

# Die elf Gebirgstypen von Avesmaps (packages/shared/src/gebirge/regler.ts, `GEBIRGSTYPEN`); ein Test hält beide Listen gleich.
GEBIRGSTYPEN = (
    "kammgebirge",
    "gratgebirge",
    "kettengebirge",
    "kuppengebirge",
    "massengebirge",
    "plateaugebirge",
    "rumpfgebirge",
    "schild",
    "inselberg",
    "karst",
    "bergland",
)
ROLLEN = ("optimierung", "validierung", "kontrolle")
KENNUNG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")

# Höhenbereich, in dem reale Geländehöhen der Erde in Metern plausibel sind (Totes Meer −430 m bis Mount Everest 8849 m).
HOEHE_MIN_PLAUSIBEL = -500.0
HOEHE_MAX_PLAUSIBEL = 9000.0

# Standardmaßstäbe des Korpus (Karteneinheit 1 E = 3000 m; Vorschau 1× 750 m, 2× 375 m, 4× 187,5 m; feine Arbeitsstufe 30 m).
STUFEN_STANDARD = (
    {"name": "30m", "zellgroesse_m": 30.0, "zweck": "Arbeitsstufe für Feinmetriken (Kämme, Täler, Hydrologie)"},
    {"name": "187_5m", "zellgroesse_m": 187.5, "zweck": "Vorschau 4× und feines Gelände"},
    {"name": "375m", "zellgroesse_m": 375.0, "zweck": "Vorschau 2× und feines Gelände"},
    {"name": "750m", "zellgroesse_m": 750.0, "zweck": "Vorschau 1×, Gebirgssaat und grobes Gelände"},
)


@dataclass(frozen=True)
class Pfade:
    manifest: Path
    rezepte: Path
    daten: Path

    @classmethod
    def standard(cls, manifest: Path | str | None = None, daten: Path | str | None = None) -> "Pfade":
        manifest_pfad = (
            Path(manifest) if manifest else Path(__file__).resolve().parents[2] / "referenz" / "manifest.json"
        )
        return cls(
            manifest=manifest_pfad,
            rezepte=manifest_pfad.parent / "rezepte",
            daten=Path(daten) if daten else daten_wurzel(),
        )

    def rezept_datei(self, ausschnitt_id: str) -> Path:
        return self.rezepte / f"{ausschnitt_id}.json"

    def roh_ordner(self, ausschnitt_id: str) -> Path:
        return self.daten / "referenz-roh" / ausschnitt_id

    def ref_ordner(self, ausschnitt_id: str) -> Path:
        return self.daten / "referenz" / ausschnitt_id

    def relativ(self, pfad: Path) -> str:
        return pfad.relative_to(self.daten).as_posix()

    def absolut(self, relativ: str) -> Path:
        return self.daten / relativ


def lade(pfad: Path | str) -> dict[str, Any]:
    return json.loads(Path(pfad).read_text(encoding="utf-8"))


def speichere(pfad: Path | str, manifest: dict[str, Any]) -> None:
    Path(pfad).write_text(zu_text(manifest), encoding="utf-8", newline="\n")


def finde(manifest: dict[str, Any], ausschnitt_id: str) -> dict[str, Any]:
    for eintrag in manifest.get("ausschnitte", []):
        if eintrag.get("id") == ausschnitt_id:
            return eintrag
    raise KeyError(f"Ausschnitt nicht im Manifest: {ausschnitt_id}")


def _pflicht(eintrag: dict[str, Any], pfad: str, art: type | tuple[type, ...], probleme: list[str], kennung: str) -> None:
    """Liest `a.b.c` aus `eintrag` und meldet Fehlendes, Leeres und falsche Typen."""
    wert: Any = eintrag
    for teil in pfad.split("."):
        if not isinstance(wert, dict) or teil not in wert:
            probleme.append(f"{kennung}: Pflichtfeld fehlt: {pfad}")
            return
        wert = wert[teil]
    if wert is None or (isinstance(wert, (str, list, dict)) and len(wert) == 0):
        probleme.append(f"{kennung}: Pflichtfeld ist leer: {pfad}")
    elif isinstance(wert, bool) or not isinstance(wert, art):
        probleme.append(f"{kennung}: Pflichtfeld hat falschen Typ: {pfad}")


PFLICHTFELDER: tuple[tuple[str, type | tuple[type, ...]], ...] = (
    ("bezeichnung", str),
    ("typ", str),
    ("geomorphologie", str),
    ("rolle", str),
    ("herkunft.region", str),
    ("herkunft.land", str),
    ("quelle.name", str),
    ("quelle.anbieter", str),
    ("quelle.produkt_url", str),
    ("quelle.lizenz.name", str),
    ("quelle.lizenz.url", str),
    ("quelle.lizenz.quellenangabe", str),
    ("quelle.modell", str),
    ("quelle.modell_begruendung", str),
    ("quelle.aufloesung_m", (int, float)),
    ("quelle.horizontal.crs", str),
    ("quelle.horizontal.einheit", str),
    ("quelle.vertikal.einheit", str),
    ("quelle.vertikal.bezugssystem", str),
    ("aufbereitung.rezept", str),
)


def pruefe_schema(manifest: dict[str, Any]) -> list[str]:
    """Prüft Pflichtfelder, Wertebereiche und Querbezüge des Manifests ohne Datenzugriff. Gibt Fehlertexte zurück (leer = in Ordnung)."""
    probleme: list[str] = []
    if manifest.get("format") != FORMAT or manifest.get("version") != VERSION:
        return [f"Manifest: unbekanntes Format {manifest.get('format')} v{manifest.get('version')}"]
    anteil = manifest.get("max_nodata_anteil")
    if not isinstance(anteil, (int, float)) or isinstance(anteil, bool) or not 0 <= anteil <= 1:
        probleme.append("Manifest: max_nodata_anteil fehlt oder liegt nicht in 0..1")
    stufen = manifest.get("stufen")
    if not isinstance(stufen, list) or not stufen:
        probleme.append("Manifest: stufen fehlt")
        stufen = []
    stufen_namen = [s.get("name") for s in stufen if isinstance(s, dict)]
    ausschnitte = manifest.get("ausschnitte")
    if not isinstance(ausschnitte, list) or not ausschnitte:
        probleme.append("Manifest: ausschnitte fehlt oder ist leer")
        return probleme
    gesehen: set[str] = set()
    for eintrag in ausschnitte:
        kennung = str(eintrag.get("id")) if isinstance(eintrag, dict) else "?"
        if not isinstance(eintrag, dict) or not KENNUNG.match(kennung):
            probleme.append(f"Manifest: Ausschnitt ohne gültige Kennung: {kennung}")
            continue
        if kennung in gesehen:
            probleme.append(f"{kennung}: Kennung doppelt")
        gesehen.add(kennung)
        for pfad, art in PFLICHTFELDER:
            _pflicht(eintrag, pfad, art, probleme, kennung)
        if eintrag.get("typ") not in GEBIRGSTYPEN:
            probleme.append(f"{kennung}: typ ist keiner der elf Gebirgstypen: {eintrag.get('typ')}")
        for weiterer in eintrag.get("typ_weitere", []):
            if weiterer not in GEBIRGSTYPEN:
                probleme.append(f"{kennung}: typ_weitere enthält keinen Gebirgstyp: {weiterer}")
        if eintrag.get("rolle") not in ROLLEN:
            probleme.append(f"{kennung}: rolle muss {' | '.join(ROLLEN)} sein, nicht {eintrag.get('rolle')}")
        quelle = eintrag.get("quelle", {})
        if quelle.get("modell") != "DTM":
            probleme.append(
                f"{kennung}: quelle.modell muss DTM sein (kein DSM als DTM ausgeben), nicht {quelle.get('modell')}"
            )
        if quelle.get("vertikal", {}).get("einheit") != "m":
            probleme.append(f"{kennung}: vertikale Einheit muss m sein")
        for datei in quelle.get("dateien", []) or []:
            if not SHA256.match(str(datei.get("sha256", ""))):
                probleme.append(f"{kennung}: Quelldatei ohne gültige SHA-256: {datei.get('pfad')}")
        for name, raster in (eintrag.get("raster") or {}).items():
            if name not in stufen_namen:
                probleme.append(f"{kennung}: Raster {name} ist keine Stufe des Korpus")
            if not SHA256.match(str(raster.get("sha256", ""))):
                probleme.append(f"{kennung}: Raster {name} ohne gültige SHA-256")
    ids = {e.get("id") for e in ausschnitte if isinstance(e, dict)}
    for eintrag in ausschnitte:
        partner = eintrag.get("paarung") if isinstance(eintrag, dict) else None
        if partner is not None and partner not in ids:
            probleme.append(f"{eintrag.get('id')}: paarung verweist auf unbekannten Ausschnitt {partner}")
    return probleme


def abdeckung(manifest: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Je Gebirgstyp die Zahl der Ausschnitte nach Rolle (nur Typen, die vorkommen)."""
    ergebnis: dict[str, dict[str, int]] = {}
    for eintrag in manifest.get("ausschnitte", []):
        zeile = ergebnis.setdefault(eintrag["typ"], {rolle: 0 for rolle in ROLLEN})
        zeile[eintrag["rolle"]] = zeile.get(eintrag["rolle"], 0) + 1
    return ergebnis
