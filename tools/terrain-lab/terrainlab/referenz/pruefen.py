"""Prüfung des Referenzkorpus (`referenz pruefen`): Manifest gegen Rezepte, lokale Dateien und Prüfsummen.

Zwei Ebenen:
- ohne Datenzugriff (`nur_manifest`): Schema, Rezeptbezug (Prüfsumme, Fenster, Stufen, Schritte), erwartete Rasterformate.
- mit lokalen Daten: Rohdateien (Größe, SHA-256), aufbereitete Raster (SHA-256, Maße, Zellgröße, Höhen in Metern, NoData-Anteil, Höhenbereich).
  Mit `tief` zusätzlich die Rohrasterköpfe über GDAL (CRS, Zellgröße, Ausdehnung, NoData); mit `ohne_roh` werden die Rohdateien übergangen
  (für Rechner, die nur die aufbereiteten Raster brauchen).
Jede Abweichung ist ein Fehler (Exit-Code ≠ 0); fehlende Validierungsausschnitte eines Typs sind nur ein Hinweis.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from terrainlab.raster import lies

from . import manifest as mf
from . import rezept as rz
from .pruefsumme import sha256_bytes, sha256_datei

FEHLER = "FEHLER"
WARNUNG = "WARNUNG"
HINWEIS = "HINWEIS"


@dataclass(frozen=True)
class Befund:
    stufe: str
    ausschnitt: str
    text: str

    def __str__(self) -> str:
        return f"{self.stufe:8} {self.ausschnitt}: {self.text}"


def _ungefaehr(a: float | None, b: float | None, toleranz: float) -> bool:
    if a is None or b is None:
        return a is b
    return math.isclose(a, b, rel_tol=0.0, abs_tol=toleranz)


def pruefe_rezeptbezug(eintrag: dict[str, Any], manifest: dict[str, Any], pfade: mf.Pfade) -> tuple[list[Befund], rz.Rezept | None]:
    """Manifest und Rezept eines Ausschnitts gegeneinander (ohne Daten)."""
    kennung = eintrag["id"]
    befunde: list[Befund] = []
    datei = pfade.rezept_datei(kennung)
    if not datei.is_file():
        return [Befund(FEHLER, kennung, f"Rezept fehlt: {datei}")], None
    try:
        daten, roh = rz.lade_text(datei)
        rezept = rz.parse(daten)
    except (rz.RezeptFehler, json.JSONDecodeError) as fehler:
        return [Befund(FEHLER, kennung, f"Rezept ungültig: {fehler}")], None
    if rezept.id != kennung:
        befunde.append(Befund(FEHLER, kennung, f"Rezept trägt eine andere Kennung: {rezept.id}"))
    if eintrag.get("aufbereitung", {}).get("rezept") != f"rezepte/{kennung}.json":
        befunde.append(Befund(FEHLER, kennung, "aufbereitung.rezept zeigt nicht auf rezepte/<id>.json"))
    soll_sha = eintrag.get("aufbereitung", {}).get("rezept_sha256")
    if soll_sha != sha256_bytes(roh):
        befunde.append(Befund(FEHLER, kennung, "Rezept wurde seit dem Eintrag im Manifest verändert (rezept_sha256)"))
    standard = [(s["name"], float(s["zellgroesse_m"])) for s in manifest.get("stufen", [])]
    if [(s.name, s.zellgroesse_m) for s in rezept.stufen] != standard:
        befunde.append(Befund(FEHLER, kennung, "Stufen des Rezepts weichen vom Standard des Korpus ab"))
    fenster = eintrag.get("herkunft", {}).get("fenster_ziel", {})
    erwartet = dict(zip(("xmin", "ymin", "xmax", "ymax"), rezept.fenster))
    if fenster.get("crs") != rezept.ziel_crs or any(not _ungefaehr(fenster.get(k), v, 1e-6) for k, v in erwartet.items()):
        befunde.append(Befund(FEHLER, kennung, "herkunft.fenster_ziel weicht vom Zielfenster des Rezepts ab"))
    if eintrag.get("aufbereitung", {}).get("schritte") != rz.schritte(rezept):
        befunde.append(Befund(FEHLER, kennung, "aufbereitung.schritte passen nicht zum Rezept (Manifest neu erzeugen)"))
    breite_km = (rezept.fenster[2] - rezept.fenster[0]) / 1000.0
    hoehe_km = (rezept.fenster[3] - rezept.fenster[1]) / 1000.0
    masse = eintrag.get("abmessungen", {})
    if not (
        _ungefaehr(masse.get("breite_km"), breite_km, 1e-6)
        and _ungefaehr(masse.get("hoehe_km"), hoehe_km, 1e-6)
        and _ungefaehr(masse.get("flaeche_km2"), breite_km * hoehe_km, 1e-6)
    ):
        befunde.append(Befund(FEHLER, kennung, "abmessungen passen nicht zum Zielfenster"))
    raster = eintrag.get("raster") or {}
    for stufe in rezept.stufen:
        eintrag_stufe = raster.get(stufe.name)
        if eintrag_stufe is None:
            befunde.append(Befund(FEHLER, kennung, f"Raster {stufe.name} fehlt im Manifest (noch nicht aufbereitet)"))
            continue
        breite, hoehe = rezept.zellen(stufe)
        if (eintrag_stufe.get("breite"), eintrag_stufe.get("hoehe")) != (breite, hoehe):
            befunde.append(Befund(FEHLER, kennung, f"Raster {stufe.name}: Maße {eintrag_stufe.get('breite')}×{eintrag_stufe.get('hoehe')} statt {breite}×{hoehe}"))
        if not _ungefaehr(eintrag_stufe.get("zellgroesse_m"), stufe.zellgroesse_m, 1e-9):
            befunde.append(Befund(FEHLER, kennung, f"Raster {stufe.name}: Zellgröße weicht vom Rezept ab"))
    if not (eintrag.get("quelle", {}).get("dateien")):
        befunde.append(Befund(FEHLER, kennung, "quelle.dateien fehlt im Manifest (noch nicht bezogen)"))
    return befunde, rezept


def pruefe_rohdateien(eintrag: dict[str, Any], pfade: mf.Pfade, tief: bool) -> list[Befund]:
    kennung = eintrag["id"]
    befunde: list[Befund] = []
    dateien = eintrag.get("quelle", {}).get("dateien", [])
    for datei in dateien:
        pfad = pfade.absolut(datei["pfad"])
        if not pfad.is_file():
            befunde.append(Befund(FEHLER, kennung, f"Rohdatei fehlt: {datei['pfad']} (referenz holen {kennung})"))
            continue
        if datei.get("bytes") is not None and pfad.stat().st_size != datei["bytes"]:
            befunde.append(Befund(FEHLER, kennung, f"Rohdatei hat andere Größe: {datei['pfad']}"))
        if sha256_datei(pfad) != datei["sha256"]:
            befunde.append(Befund(FEHLER, kennung, f"Rohdatei: Prüfsumme stimmt nicht: {datei['pfad']}"))
    if tief and dateien and not any(b.stufe == FEHLER for b in befunde):
        befunde.extend(_pruefe_rohkoepfe(eintrag, pfade))
    return befunde


def _pruefe_rohkoepfe(eintrag: dict[str, Any], pfade: mf.Pfade) -> list[Befund]:
    """Rohrasterköpfe gegen `quelle.raster_info` (braucht GDAL)."""
    from .gdal_umgebung import gdal_osr
    from .quellen import oeffne, rasterinfo

    kennung = eintrag["id"]
    try:
        _, osr = gdal_osr()
    except RuntimeError as fehler:
        return [Befund(WARNUNG, kennung, f"Rohrasterköpfe nicht geprüft: {fehler}")]
    soll = eintrag.get("quelle", {}).get("raster_info")
    if not soll:
        return [Befund(FEHLER, kennung, "quelle.raster_info fehlt im Manifest")]
    ist = rasterinfo(osr, oeffne([str(pfade.absolut(d["pfad"])) for d in eintrag["quelle"]["dateien"]]))
    befunde: list[Befund] = []
    for feld in ("crs", "einheit", "breite", "hoehe", "datentyp"):
        if ist[feld] != soll.get(feld):
            befunde.append(Befund(FEHLER, kennung, f"Rohraster {feld}: {ist[feld]} statt {soll.get(feld)}"))
    for feld in ("pixel_x", "pixel_y"):
        if not _ungefaehr(ist[feld], soll.get(feld), 1e-12):
            befunde.append(Befund(FEHLER, kennung, f"Rohraster {feld}: {ist[feld]} statt {soll.get(feld)}"))
    for feld, wert in ist["bbox"].items():
        if not _ungefaehr(wert, soll.get("bbox", {}).get(feld), 1e-6):
            befunde.append(Befund(FEHLER, kennung, f"Rohraster Ausdehnung {feld}: {wert} statt {soll.get('bbox', {}).get(feld)}"))
    if not _ungefaehr(ist["nodata"], soll.get("nodata"), 0.0):
        befunde.append(Befund(FEHLER, kennung, f"Rohraster NoData-Wert: {ist['nodata']} statt {soll.get('nodata')}"))
    erwartete_einheit = eintrag["quelle"]["horizontal"]["einheit"]
    if ist["einheit"] != erwartete_einheit:
        befunde.append(Befund(FEHLER, kennung, f"Rohraster horizontale Einheit {ist['einheit']} statt {erwartete_einheit}"))
    return befunde


def pruefe_raster(eintrag: dict[str, Any], pfade: mf.Pfade, max_nodata: float) -> list[Befund]:
    """Aufbereitete Raster gegen das Manifest: Prüfsumme, Maße, Zellgröße, Einheit Meter, NoData-Anteil, Höhenbereich."""
    kennung = eintrag["id"]
    befunde: list[Befund] = []
    for name, soll in (eintrag.get("raster") or {}).items():
        f32 = pfade.absolut(soll["pfad"])
        if not f32.is_file() or not f32.with_suffix(".json").is_file():
            befunde.append(Befund(FEHLER, kennung, f"Raster {name} fehlt: {soll['pfad']} (referenz aufbereiten {kennung})"))
            continue
        try:
            raster = lies(f32.with_suffix(".json"), pruefen=True)
            kopf = json.loads(f32.with_suffix(".json").read_text(encoding="utf-8"))
        except (ValueError, OSError) as fehler:
            befunde.append(Befund(FEHLER, kennung, f"Raster {name} nicht lesbar: {fehler}"))
            continue
        if kopf.get("sha256") != soll["sha256"]:
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: Prüfsumme weicht vom Manifest ab"))
        if (raster.form[1], raster.form[0]) != (soll["breite"], soll["hoehe"]):
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: Maße {raster.form[1]}×{raster.form[0]} statt {soll['breite']}×{soll['hoehe']}"))
        if not _ungefaehr(raster.zellgroesse_m, soll["zellgroesse_m"], 1e-9):
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: Zellgröße {raster.zellgroesse_m} statt {soll['zellgroesse_m']}"))
        if kopf.get("hoehe_einheit") != "m":
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: Höheneinheit {kopf.get('hoehe_einheit')} statt m"))
        anteil = float(np.isnan(raster.hoehen).mean())
        if anteil > max_nodata:
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: NoData-Anteil {anteil:.4%} über dem Grenzwert {max_nodata:.4%}"))
        if not _ungefaehr(anteil, soll.get("nodata_anteil"), 1e-6):
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: NoData-Anteil {anteil:.6f} statt {soll.get('nodata_anteil')}"))
        gueltig = raster.hoehen[~np.isnan(raster.hoehen)]
        if gueltig.size == 0:
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: keine gültigen Zellen"))
            continue
        minimum, maximum = float(gueltig.min()), float(gueltig.max())
        if minimum < mf.HOEHE_MIN_PLAUSIBEL or maximum > mf.HOEHE_MAX_PLAUSIBEL:
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: Höhen {minimum:.1f}..{maximum:.1f} m außerhalb des plausiblen Bereichs (Einheit?)"))
        if not (_ungefaehr(minimum, soll.get("hoehe_min"), 1e-3) and _ungefaehr(maximum, soll.get("hoehe_max"), 1e-3)):
            befunde.append(Befund(FEHLER, kennung, f"Raster {name}: Höhenbereich weicht vom Manifest ab"))
    return befunde


def abdeckung_hinweise(manifest: dict[str, Any]) -> list[Befund]:
    befunde: list[Befund] = []
    for typ, zaehler in sorted(mf.abdeckung(manifest).items()):
        fehlend = [rolle for rolle in ("optimierung", "validierung") if zaehler.get(rolle, 0) == 0]
        if fehlend:
            befunde.append(Befund(HINWEIS, typ, f"kein Ausschnitt mit Rolle {' und '.join(fehlend)}"))
    ids = {e["id"]: e for e in manifest.get("ausschnitte", [])}
    for eintrag in ids.values():
        partner = ids.get(eintrag.get("paarung") or "")
        if partner is not None and (partner["typ"] != eintrag["typ"] or partner["rolle"] == eintrag["rolle"]):
            befunde.append(Befund(WARNUNG, eintrag["id"], f"paarung mit {partner['id']}: gleicher Typ und verschiedene Rolle erwartet"))
    return befunde


def pruefe(
    manifest: dict[str, Any],
    pfade: mf.Pfade,
    ausschnitt_ids: list[str] | None = None,
    nur_manifest: bool = False,
    tief: bool = False,
    ohne_roh: bool = False,
) -> list[Befund]:
    """Prüft das Manifest (alle oder die genannten Ausschnitte) und gibt alle Befunde zurück."""
    befunde = [Befund(FEHLER, "manifest", text) for text in mf.pruefe_schema(manifest)]
    if befunde:
        return befunde
    max_nodata = float(manifest["max_nodata_anteil"])
    gewaehlt = ausschnitt_ids or [e["id"] for e in manifest["ausschnitte"]]
    for kennung in gewaehlt:
        try:
            eintrag = mf.finde(manifest, kennung)
        except KeyError as fehler:
            befunde.append(Befund(FEHLER, kennung, str(fehler)))
            continue
        gefunden, _ = pruefe_rezeptbezug(eintrag, manifest, pfade)
        befunde.extend(gefunden)
        if not nur_manifest:
            if not ohne_roh:
                befunde.extend(pruefe_rohdateien(eintrag, pfade, tief))
            befunde.extend(pruefe_raster(eintrag, pfade, max_nodata))
    if ausschnitt_ids is None:
        befunde.extend(abdeckung_hinweise(manifest))
    return befunde
