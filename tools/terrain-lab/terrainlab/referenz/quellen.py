"""Bezug der Rohdaten (`referenz holen`): ein Fenster aus Cloud-Optimized-GeoTIFFs herausschneiden und ablegen.

Der Bezug ist ein einmaliger, dokumentierter Schritt mit Netz. Er liest über GDAL (`/vsicurl/`) nur das Pixelfenster, das das Zielfenster des
Rezepts samt Rand abdeckt, schreibt es unverändert (keine Neuberechnung der Werte) als `quelle.tif` und erfasst Prüfsummen und Köpfe. Danach
läuft alles offline. Das Fenster wird aus dem Zielfenster (metrisches Ziel-CRS) in das CRS der Quelle übertragen, damit ein Rezept nur eine
Geometrie kennt.
"""

from __future__ import annotations

import math
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from .gdal_umgebung import gdal_osr
from .manifest import Pfade
from .pruefsumme import sha256_datei
from .rezept import Rezept

ERZEUGUNGSOPTIONEN = ["COMPRESS=DEFLATE", "PREDICTOR=3", "TILED=YES", "BLOCKXSIZE=256", "BLOCKYSIZE=256"]
BENUTZERKENNUNG = "avesmaps3d-terrain-lab/0.1 (WI-0250; einmaliger Bezug von Referenz-Geländemodellen)"


def vsi_name(quelle: str) -> str:
    """URL → `/vsicurl/…`; lokale Pfade bleiben unverändert (Tests und lokal abgelegte Quellen)."""
    return "/vsicurl/" + quelle if quelle.startswith(("http://", "https://")) else quelle


def oeffne(quellen: list[str]) -> Any:
    """Öffnet eine Quelle oder baut aus mehreren Kacheln ein virtuelles Mosaik (gleiches CRS und gleiche Zellgröße nötig)."""
    gdal, _ = gdal_osr()
    namen = [vsi_name(q) for q in quellen]
    if len(namen) == 1:
        return gdal.Open(namen[0])
    return gdal.BuildVRT("", namen)


def srs_des(osr: Any, dataset: Any) -> Any:
    srs = osr.SpatialReference()
    srs.ImportFromWkt(dataset.GetProjection())
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def srs_aus(osr: Any, beschreibung: str) -> Any:
    srs = osr.SpatialReference()
    srs.SetFromUserInput(beschreibung)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


def umrandung_transformiert(
    osr: Any, von: Any, nach: Any, fenster: tuple[float, float, float, float], punkte_je_kante: int = 41
) -> tuple[float, float, float, float]:
    """Rechteck von einem CRS in ein anderes übertragen; die Kanten werden verdichtet, weil sie im anderen CRS krumm sind."""
    x0, y0, x1, y1 = fenster
    ts = np.linspace(0.0, 1.0, punkte_je_kante)
    punkte = (
        [(x0 + t * (x1 - x0), y0) for t in ts]
        + [(x0 + t * (x1 - x0), y1) for t in ts]
        + [(x0, y0 + t * (y1 - y0)) for t in ts]
        + [(x1, y0 + t * (y1 - y0)) for t in ts]
    )
    umgerechnet = osr.CoordinateTransformation(von, nach).TransformPoints(punkte)
    xs = [p[0] for p in umgerechnet]
    ys = [p[1] for p in umgerechnet]
    return min(xs), min(ys), max(xs), max(ys)


def crs_kennung(osr: Any, srs: Any) -> str:
    try:
        srs.AutoIdentifyEPSG()
    except RuntimeError:  # kein EPSG-Treffer: der Name des CRS bleibt als Kennung
        pass
    code = srs.GetAuthorityCode(None)
    name = srs.GetAuthorityName(None)
    return f"{name}:{code}" if code else srs.GetName()


def rasterinfo(osr: Any, dataset: Any) -> dict[str, Any]:
    """Was das Manifest über ein Rohraster festhält: CRS, Einheit, Zellgröße, Ausdehnung, NoData, Datentyp."""
    gdal, _ = gdal_osr()
    srs = srs_des(osr, dataset)
    gt = dataset.GetGeoTransform()
    band = dataset.GetRasterBand(1)
    breite, hoehe = dataset.RasterXSize, dataset.RasterYSize
    return {
        "crs": crs_kennung(osr, srs),
        "einheit": "grad" if srs.IsGeographic() else str(srs.GetLinearUnitsName()).replace("metre", "m"),
        "breite": breite,
        "hoehe": hoehe,
        "pixel_x": abs(gt[1]),
        "pixel_y": abs(gt[5]),
        "nodata": band.GetNoDataValue(),
        "datentyp": gdal.GetDataTypeName(band.DataType),
        "bbox": {
            "xmin": gt[0],
            "ymin": gt[3] + gt[5] * hoehe,
            "xmax": gt[0] + gt[1] * breite,
            "ymax": gt[3],
        },
    }


def inhalts_hash(dataset: Any, zeilen_je_block: int = 256) -> str:
    """SHA-256 über die Float32-Werte (little-endian, zeilenweise) und die Rastermaße: unabhängig davon, wie die Datei komprimiert ist."""
    import hashlib

    band = dataset.GetRasterBand(1)
    breite, hoehe = dataset.RasterXSize, dataset.RasterYSize
    h = hashlib.sha256(f"{breite}x{hoehe}:float32le:".encode("ascii"))
    for y in range(0, hoehe, zeilen_je_block):
        zeilen = min(zeilen_je_block, hoehe - y)
        h.update(np.ascontiguousarray(band.ReadAsArray(0, y, breite, zeilen), dtype="<f4").tobytes())
    return h.hexdigest()


def kopfdaten(url: str) -> dict[str, Any]:
    """HTTP-Kopf der Quelldatei (Stand der Quelle zum Zeitpunkt des Bezugs); bei lokalen Pfaden oder Fehlern leer."""
    if not url.startswith(("http://", "https://")):
        return {}
    try:
        anfrage = urllib.request.Request(url, method="HEAD", headers={"User-Agent": BENUTZERKENNUNG})
        with urllib.request.urlopen(anfrage, timeout=30) as antwort:
            kopf = antwort.headers
            ergebnis = {
                "url": url,
                "last_modified": kopf.get("Last-Modified"),
                "etag": (kopf.get("ETag") or "").strip('"') or None,
                "bytes": int(kopf["Content-Length"]) if kopf.get("Content-Length") else None,
            }
            return {k: v for k, v in ergebnis.items() if v is not None}
    except OSError:
        return {"url": url}


def pixelfenster(
    gt: tuple[float, ...], groesse: tuple[int, int], bbox: tuple[float, float, float, float], rand: int
) -> list[int]:
    """Pixelfenster `[xoff, yoff, breite, hoehe]` der Quelle für eine Ausdehnung im CRS der Quelle plus Rand; meldet, wenn sie überragt."""
    if gt[2] != 0 or gt[4] != 0 or gt[5] >= 0:
        raise ValueError("Quellraster ist nicht nach Norden ausgerichtet (Rotation oder Spiegelung)")
    x0, y0, x1, y1 = bbox
    px0 = math.floor((x0 - gt[0]) / gt[1]) - rand
    px1 = math.ceil((x1 - gt[0]) / gt[1]) + rand
    py0 = math.floor((y1 - gt[3]) / gt[5]) - rand
    py1 = math.ceil((y0 - gt[3]) / gt[5]) + rand
    if px0 < 0 or py0 < 0 or px1 > groesse[0] or py1 > groesse[1]:
        raise ValueError("Zielfenster liegt nicht vollständig im Quellraster (Quelle deckt es nicht ab)")
    return [px0, py0, px1 - px0, py1 - py0]


def erfasse(rezept: Rezept, pfade: Pfade, dateien: list[Path], quelle: Any, remote: list[dict[str, Any]]) -> dict[str, Any]:
    """Prüfsummen und Rasterinfo für das Manifest."""
    _, osr = gdal_osr()
    eintraege = []
    for datei in dateien:
        eintrag: dict[str, Any] = {"pfad": pfade.relativ(datei), "sha256": sha256_datei(datei), "bytes": datei.stat().st_size}
        if len(dateien) == 1:
            eintrag["sha256_inhalt"] = inhalts_hash(quelle)
        eintraege.append(eintrag)
    return {
        "dateien": eintraege,
        "raster_info": rasterinfo(osr, quelle),
        "abgerufen_am": datetime.now(timezone.utc).date().isoformat(),
        "remote": remote,
    }


def holen(rezept: Rezept, pfade: Pfade) -> dict[str, Any]:
    """Legt `quelle.tif` an (Art `cog-fenster`) oder erfasst die lokal abgelegten Dateien (Art `lokal`). Gibt die Manifestangaben zurück."""
    gdal, osr = gdal_osr()
    ordner = pfade.roh_ordner(rezept.id)
    ordner.mkdir(parents=True, exist_ok=True)
    if rezept.art == "lokal":
        dateien = [ordner / name for name in rezept.dateien]
        fehlend = [d.name for d in dateien if not d.is_file()]
        if fehlend:
            raise FileNotFoundError(f"lokale Quelldateien fehlen in {ordner}: {', '.join(fehlend)}")
        quelle = oeffne([str(d) for d in dateien])
        return erfasse(rezept, pfade, dateien, quelle, [])
    quelle = oeffne(list(rezept.urls))
    quell_srs = srs_des(osr, quelle)
    ziel_srs = srs_aus(osr, rezept.ziel_crs)
    bbox = umrandung_transformiert(osr, ziel_srs, quell_srs, rezept.fenster)
    fenster = pixelfenster(quelle.GetGeoTransform(), (quelle.RasterXSize, quelle.RasterYSize), bbox, rezept.rand_zellen)
    ziel = ordner / "quelle.tif"
    teil = ordner / "quelle.tif.part"
    gdal.Translate(str(teil), quelle, format="GTiff", srcWin=fenster, creationOptions=ERZEUGUNGSOPTIONEN)
    teil.replace(ziel)
    remote = [k for k in (kopfdaten(u) for u in rezept.urls) if k]
    ergebnis_ds = gdal.Open(str(ziel))
    return erfasse(rezept, pfade, [ziel], ergebnis_ds, remote)


def utm_crs(laenge: float, breite: float, datum: str = "nad83") -> str:
    """EPSG-Kennung der UTM-Zone für einen Punkt (NAD83: 269zz für Nordamerika, sonst WGS84: 326zz/327zz)."""
    zone = int((laenge + 180.0) // 6.0) + 1
    if datum == "nad83":
        return f"EPSG:269{zone:02d}"
    return f"EPSG:{(32600 if breite >= 0 else 32700) + zone}"


def fenster_um_mitte(
    crs: str, laenge: float, breite: float, breite_m: float, hoehe_m: float, raster_m: float = 750.0
) -> list[float]:
    """Zielfenster `[xmin, ymin, xmax, ymax]` im metrischen `crs` um einen Mittelpunkt (WGS84-Länge/Breite; für NAD83 gleich genau genug).

    Die Kanten liegen auf Vielfachen von `raster_m` im Ziel-CRS, die Maße sind ganze Vielfache davon. So stimmen alle Stufen (187,5 / 375 /
    750 m) auf dieselben Zellgrenzen und zwei Läufe liefern dasselbe Fenster.
    """
    _, osr = gdal_osr()
    wgs = srs_aus(osr, "EPSG:4326")
    ziel = srs_aus(osr, crs)
    x, y, _ = osr.CoordinateTransformation(wgs, ziel).TransformPoint(laenge, breite)
    for name, laenge_m in (("breite_m", breite_m), ("hoehe_m", hoehe_m)):
        if abs(laenge_m / raster_m - round(laenge_m / raster_m)) > 1e-9:
            raise ValueError(f"{name} muss ein Vielfaches von {raster_m} m sein")
    xmin = math.floor((x - breite_m / 2) / raster_m) * raster_m
    ymin = math.floor((y - hoehe_m / 2) / raster_m) * raster_m
    return [xmin, ymin, xmin + breite_m, ymin + hoehe_m]
