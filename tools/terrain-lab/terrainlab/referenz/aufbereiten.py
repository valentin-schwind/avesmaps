"""Aufbereitung (`referenz aufbereiten`): aus den lokalen Rohdaten die Zielraster im Format `terrainlab.raster` erzeugen.

Ablauf je Stufe nach Rezept:
- `warp-mittel`: GDAL-Warp aus dem Rohraster in das metrische Ziel-CRS auf das Zielfenster, Flächenmittel (`average`, Bruchteile von
  Quellzellen gewichtet), NoData der Quelle wird NaN.
- `block-mittel`: exaktes n×n-Blockmittel einer schon berechneten Stufe (187,5 → 375 → 750 m bleiben so deckungsgleich); ein Block ist NaN,
  wenn weniger als der Mindestanteil seiner Zellen gültig ist.
Alles läuft offline aus den Rohdateien; das Ergebnis hängt nur von Rohdaten, Rezept und Werkzeugversionen ab.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

from terrainlab.raster import Hoehenraster, lies, schreibe

from .gdal_umgebung import gdal_osr, versionen
from .manifest import Pfade
from .quellen import oeffne
from .rezept import Rezept, Stufe


def blockmittel(werte: np.ndarray, faktor: int, mindestanteil: float) -> np.ndarray:
    """n×n-Blockmittel über die gültigen (nicht-NaN) Zellen; Blöcke unter `mindestanteil` gültiger Zellen werden NaN."""
    hoehe, breite = werte.shape
    if hoehe % faktor or breite % faktor:
        raise ValueError(f"Raster {breite}×{hoehe} ist nicht durch {faktor} teilbar")
    bloecke = werte.astype(np.float64).reshape(hoehe // faktor, faktor, breite // faktor, faktor)
    gueltig = ~np.isnan(bloecke)
    anzahl = gueltig.sum(axis=(1, 3))
    summe = np.where(gueltig, bloecke, 0.0).sum(axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        mittel = np.where(anzahl >= mindestanteil * faktor * faktor, summe / np.maximum(anzahl, 1), np.nan)
    return mittel.astype(np.float32)


def warp_stufe(rezept: Rezept, quelle: Any, stufe: Stufe, nodata_quelle: float | None) -> np.ndarray:
    """Eine Stufe per GDAL-Warp (Flächenmittel) auf das Zielfenster; NoData wird NaN."""
    gdal, _ = gdal_osr()
    x0, y0, x1, y1 = rezept.fenster
    breite, hoehe = rezept.zellen(stufe)
    optionen: dict[str, Any] = {
        "format": "MEM",
        "dstSRS": rezept.ziel_crs,
        "outputBounds": (x0, y0, x1, y1),
        "width": breite,
        "height": hoehe,
        "resampleAlg": "average",
        "dstNodata": float("nan"),
        "outputType": gdal.GDT_Float32,
        "multithread": True,
    }
    if nodata_quelle is not None:
        optionen["srcNodata"] = nodata_quelle
    ergebnis = gdal.Warp("", quelle, **optionen)
    werte = ergebnis.GetRasterBand(1).ReadAsArray().astype(np.float32)
    if werte.shape != (hoehe, breite):
        raise RuntimeError(f"Stufe {stufe.name}: Warp lieferte {werte.shape}, erwartet {(hoehe, breite)}")
    return werte


def kennwerte(werte: np.ndarray) -> dict[str, Any]:
    """Höhenstatistik und NoData-Anteil einer Stufe für das Manifest."""
    gueltig = werte[~np.isnan(werte)]
    return {
        "nodata_anteil": round(float(np.isnan(werte).mean()), 6),
        "hoehe_min": round(float(gueltig.min()), 3) if gueltig.size else None,
        "hoehe_max": round(float(gueltig.max()), 3) if gueltig.size else None,
        "hoehe_mittel": round(float(gueltig.mean(dtype=np.float64)), 3) if gueltig.size else None,
    }


def aufbereiten(rezept: Rezept, pfade: Pfade, roh_dateien: list[Path], roh_sha256: list[str]) -> dict[str, Any]:
    """Erzeugt alle Stufen des Rezepts unter `referenz/<id>/` und gibt die Manifestangaben je Stufe zurück."""
    quelle = oeffne([str(d) for d in roh_dateien])
    nodata = rezept.nodata_quelle
    if nodata is None:
        nodata = quelle.GetRasterBand(1).GetNoDataValue()
    ordner = pfade.ref_ordner(rezept.id)
    ordner.mkdir(parents=True, exist_ok=True)
    werkzeuge = versionen()
    ergebnisse: dict[str, np.ndarray] = {}
    manifest_raster: dict[str, Any] = {}
    for stufe in rezept.stufen:
        if stufe.verfahren == "warp-mittel":
            werte = warp_stufe(rezept, quelle, stufe, nodata)
        else:
            assert stufe.aus is not None and stufe.faktor is not None
            werte = blockmittel(ergebnisse[stufe.aus], stufe.faktor, rezept.mindestanteil_gueltig)
        ergebnisse[stufe.name] = werte
        herkunft = {
            "ausschnitt": rezept.id,
            "stufe": stufe.name,
            "verfahren": stufe.verfahren if stufe.verfahren == "warp-mittel" else f"{stufe.faktor}x{stufe.faktor}-blockmittel aus {stufe.aus}",
            "ziel_crs": rezept.ziel_crs,
            "fenster": list(rezept.fenster),
            "quelle_sha256": roh_sha256,
            "werkzeuge": {k: v for k, v in werkzeuge.items() if k in ("gdal", "numpy")},
            "hinweis": "reale Koordinaten nur in der Referenz, nie in den aventurischen Kartenraum übertragen",
        }
        json_pfad = Path(schreibe(Hoehenraster(werte, stufe.zellgroesse_m, herkunft), ordner / stufe.name))
        raster = lies(json_pfad)  # liest zurück und prüft die Prüfsumme
        kopf = json.loads(json_pfad.read_text(encoding="utf-8"))
        eintrag = {
            "pfad": pfade.relativ(json_pfad.with_suffix(".f32")),
            "zellgroesse_m": stufe.zellgroesse_m,
            "breite": raster.form[1],
            "hoehe": raster.form[0],
            "sha256": kopf["sha256"],
            **kennwerte(raster.hoehen),
        }
        manifest_raster[stufe.name] = eintrag
        print(f"  {stufe.name}: {eintrag['breite']}×{eintrag['hoehe']} Zellen, NoData {eintrag['nodata_anteil']:.4%}", file=sys.stderr)
    return manifest_raster
