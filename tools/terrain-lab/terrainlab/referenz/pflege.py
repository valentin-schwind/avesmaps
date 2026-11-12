"""Manifest nach `holen` und `aufbereiten` fortschreiben (nur mit `--manifest-aktualisieren`).

Das Manifest bleibt von Hand beschriebene Stammdaten (Region, Quelle, Lizenz, Typ, Rolle) plus werkzeugerzeugte Teile (Fenster, Prüfsummen,
Raster, Schritte). Dieses Modul schreibt nur die werkzeugerzeugten Teile.
"""

from __future__ import annotations

from typing import Any

from .gdal_umgebung import versionen
from .pruefsumme import sha256_bytes
from .rezept import Rezept, schritte


def synchronisiere_rezept(eintrag: dict[str, Any], rezept: Rezept, rezept_bytes: bytes) -> None:
    """Fenster, Abmessungen, Rezept-Prüfsumme und Schrittliste aus dem Rezept übernehmen."""
    x0, y0, x1, y1 = rezept.fenster
    eintrag.setdefault("herkunft", {})["fenster_ziel"] = {
        "crs": rezept.ziel_crs,
        "xmin": x0,
        "ymin": y0,
        "xmax": x1,
        "ymax": y1,
    }
    breite_km, hoehe_km = (x1 - x0) / 1000.0, (y1 - y0) / 1000.0
    eintrag["abmessungen"] = {"breite_km": breite_km, "hoehe_km": hoehe_km, "flaeche_km2": breite_km * hoehe_km}
    aufbereitung = eintrag.setdefault("aufbereitung", {})
    aufbereitung["rezept"] = f"rezepte/{rezept.id}.json"
    aufbereitung["rezept_sha256"] = sha256_bytes(rezept_bytes)
    aufbereitung["schritte"] = schritte(rezept)


def nach_holen(eintrag: dict[str, Any], rezept: Rezept, rezept_bytes: bytes, ergebnis: dict[str, Any]) -> None:
    """Quelldateien, Rasterinfo, Bezugsdatum und Remote-Köpfe eintragen; Aufbereitungsergebnisse gelten damit als veraltet."""
    quelle = eintrag.setdefault("quelle", {})
    quelle["dateien"] = ergebnis["dateien"]
    quelle["raster_info"] = ergebnis["raster_info"]
    quelle["abgerufen_am"] = ergebnis["abgerufen_am"]
    quelle["remote"] = ergebnis["remote"]
    if rezept.metadaten:
        quelle["metadaten"] = rezept.metadaten
    info = ergebnis["raster_info"]
    eintrag.setdefault("herkunft", {})["bbox"] = {"crs": info["crs"], **info["bbox"]}
    synchronisiere_rezept(eintrag, rezept, rezept_bytes)
    eintrag.pop("raster", None)


def nach_aufbereiten(eintrag: dict[str, Any], rezept: Rezept, rezept_bytes: bytes, raster: dict[str, Any]) -> None:
    synchronisiere_rezept(eintrag, rezept, rezept_bytes)
    eintrag["aufbereitung"]["werkzeug"] = versionen()
    eintrag["raster"] = raster
