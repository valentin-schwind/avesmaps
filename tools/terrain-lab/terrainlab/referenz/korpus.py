"""Lesender Zugriff auf den Referenzkorpus für die übrigen Teile des Labs (Deskriptoren, Vergleich, Optimierer, Bericht).

    from terrainlab.referenz.korpus import ausschnitte, lade_raster

    for eintrag in ausschnitte(typ="karst", rolle="validierung"):
        raster = lade_raster(eintrag["id"], "187_5m")   # terrainlab.raster.Hoehenraster, Meter, NaN = NoData

Das Laden prüft die SHA-256 des Rasters (und gegen das Manifest, wenn `pruefen` gesetzt ist), nie die Rohdaten. Fehlt ein Raster lokal, steht
in der Fehlermeldung der Befehl, der es erzeugt.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from terrainlab.raster import Hoehenraster, lies

from . import manifest as mf


def lade_manifest(manifest: Path | str | None = None) -> dict[str, Any]:
    return mf.lade(mf.Pfade.standard(manifest).manifest)


def ausschnitte(
    typ: str | None = None,
    rolle: str | None = None,
    manifest: Path | str | None = None,
) -> list[dict[str, Any]]:
    """Einträge des Manifests, gefiltert nach Gebirgstyp (Haupttyp) und Rolle."""
    liste = lade_manifest(manifest)["ausschnitte"]
    return [e for e in liste if (typ is None or e["typ"] == typ) and (rolle is None or e["rolle"] == rolle)]


def lade_raster(
    ausschnitt_id: str,
    stufe: str,
    manifest: Path | str | None = None,
    daten: Path | str | None = None,
    pruefen: bool = True,
) -> Hoehenraster:
    """Lädt eine Stufe (`30m`, `187_5m`, `375m`, `750m`) eines Ausschnitts als `Hoehenraster` (Meter, NaN = NoData)."""
    pfade = mf.Pfade.standard(manifest, daten)
    eintrag = mf.finde(mf.lade(pfade.manifest), ausschnitt_id)
    soll = (eintrag.get("raster") or {}).get(stufe)
    if soll is None:
        raise KeyError(f"{ausschnitt_id}: Stufe {stufe} ist im Manifest nicht aufbereitet")
    json_pfad = pfade.absolut(soll["pfad"]).with_suffix(".json")
    if not json_pfad.is_file():
        raise FileNotFoundError(
            f"{json_pfad} fehlt; erzeugen mit: python -m terrainlab referenz aufbereiten {ausschnitt_id} "
            f"(Rohdaten vorher mit: referenz holen {ausschnitt_id})"
        )
    raster = lies(json_pfad, pruefen=True)
    if pruefen and (raster.hoehen.shape[1], raster.hoehen.shape[0]) != (soll["breite"], soll["hoehe"]):
        raise ValueError(f"{ausschnitt_id}/{stufe}: Rastermaße weichen vom Manifest ab")
    return raster
