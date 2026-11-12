"""Statischer HTML-Bericht des Terrain-Labs (WI-0250 Phase A5). Dokumentation: ``docs/bericht.md``.

``python -m terrainlab bericht <lauf|vergleich|messung>`` schreibt **eine** Datei: Bilder eingebettet, kein Server, kein Framework, kein JavaScript.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Sequence

from terrainlab import __version__, daten_wurzel
from terrainlab.lauf.umgebung import rechnerangaben

from .abschnitte import Bericht, nachmessung_html, perf_html, vergleich_html
from .daten import BerichtFehler, erkenne, lade_json, lade_optimierung
from .seite import hinweis, seite, tabelle, z

__all__ = ["BerichtFehler", "erzeuge_bericht"]


def berichte_wurzel(labor: Path | None = None) -> Path:
    return (labor or daten_wurzel()) / "berichte"


def _qualitaet_html(q: dict[str, Any]) -> str:
    zeilen = [[f["name"], f["stufe"], z(f["raster"]["zellen"]), z(len(f["metriken"])), "Zwischenspeicher" if f["raster_aus_cache"] else "gerechnet",
               z(f["metriken"].get("hang_neigung_mittel"), 2), z(f["metriken"].get("hoehe_hypsometrisches_integral"), 3)] for f in q["faelle"]]
    return (f"<h3>Qualitätsmessung „{q['konfig']['name']}“ am Commit {q['commit'][:12]}</h3>"
            + tabelle(["Fall", "Stufe", "Zellen", "Kennzahlen", "Raster", "Mittlere Hangneigung (°)", "Hypsometrisches Integral"], zeilen, rechts=(2, 3, 5, 6), titel="Fälle (Metrikvektor je Fall in metriken/)"))


def erzeuge_bericht(
    eingaben: Sequence[Path | str], ausgabe: Path | str | None = None, *, titel: str | None = None, cache: Path | str | None = None, labor: Path | None = None,
    perf: Sequence[Path | str] = (), vergleich: Sequence[Path | str] = (), nachmessung: Sequence[Path | str] = (),
) -> Path:
    """Schreibt den Bericht zu den ``eingaben`` (Laufordner der Optimierung, Nachmessungen, Messungen, Vergleiche) und gibt den Pfad der Datei zurück."""
    optimierungen: list[Path] = []
    vergleiche: list[dict[str, Any]] = []
    qualitaeten: list[dict[str, Any]] = []
    perf_daten: list[dict[str, Any]] = []
    nachmessungen: list[dict[str, Any]] = []
    for p in list(eingaben) + [("perf", q) for q in perf] + [("vergleich", q) for q in vergleich] + [("nachmessung", q) for q in nachmessung]:
        art_vorgabe = None
        if isinstance(p, tuple):
            art_vorgabe, p = p
        p = Path(p)
        art = art_vorgabe or erkenne(p)
        if art == "optimierung":
            optimierungen.append(p)
        elif art == "perf":
            perf_daten.append(lade_json(p, "ergebnis.json"))
        elif art == "vergleich":
            vergleiche.append(lade_json(p, "vergleich.json"))
        elif art == "nachmessung":
            nachmessungen.append(lade_json(p, "nachmessung.json"))
        else:
            qualitaeten.append(lade_json(p, "ergebnis.json"))
    if not (optimierungen or perf_daten or vergleiche or qualitaeten or nachmessungen):
        raise BerichtFehler("Nichts zu berichten: keine Eingabe")
    abschnitte: list[tuple[str, str, str]] = []
    untertitel = "Terrain Calibration & Benchmark Lab (WI-0250) · erzeugt " + time.strftime("%Y-%m-%d %H:%M")
    name = "bericht"
    if optimierungen:
        d = lade_optimierung(optimierungen[0], cache, labor)
        b = Bericht(d, labor)
        name = d.ordner.name
        titel = titel or f"Terrain-Lab: Optimierung {d.profil.name} am Commit {d.commit[:12]}"
        abschnitte += [
            ("zusammenfassung", "Zusammenfassung", b.zusammenfassung()),
            ("qualitaet", "Qualität je Typ: drei Dimensionen", b.qualitaet()),
            ("formerhalt", "Formerhalt im Einzelnen", b.formerhalt()),
            ("referenz", "Referenzmetriken", b.referenzmetriken()),
            ("performance", "Performance", b.performance(perf_daten)),
            ("regression", "Auffällige Regressionen zwischen zwei Commits", b.regressionen(vergleiche)),
            ("bilder", "Bildvergleich: real, Vorschau, Endgelände", b.bilder()),
            ("profile", "Profile: Kamm, Querschnitt, Prominenzen", b.profile()),
            ("parameter", "Parameteranalyse", b.parameteranalyse()),
            ("anhang", "Anhang", b.anhang()),
        ]
        for q in qualitaeten:
            abschnitte.insert(5, ("messung", "Qualitätsmessung", _qualitaet_html(q)))
            break
        if nachmessungen:
            abschnitte.insert(len(abschnitte) - 1, ("nachmessung", "Nachmessung am neuen Generator-Stand", "".join(nachmessung_html(n) for n in nachmessungen)))
    else:
        titel = titel or "Terrain-Lab: Messbericht"
        if perf_daten:
            abschnitte.append(("performance", "Performance", "".join(perf_html(p) for p in perf_daten)))
        if vergleiche:
            abschnitte.append(("regression", "Auffällige Regressionen zwischen zwei Commits", "".join(vergleich_html(v) for v in vergleiche)))
        if qualitaeten:
            abschnitte.append(("messung", "Qualitätsmessung", "".join(_qualitaet_html(q) for q in qualitaeten)))
        if nachmessungen:
            abschnitte.append(("nachmessung", "Nachmessung am neuen Generator-Stand", "".join(nachmessung_html(n) for n in nachmessungen)))
    r = rechnerangaben()
    fuss = (f"terrainlab {__version__} · Python {r['python']}, NumPy {r['numpy']}, SciPy {r['scipy']} · {r['plattform']} · "
            "Alle Bilder und Zahlen stammen aus den Höhenrastern und Messdateien dieses Laufs; es gibt keine erzeugten Bilder und keine Netzzugriffe.")
    ziel = Path(ausgabe) if ausgabe else berichte_wurzel(labor) / f"{name}.html"
    ziel.parent.mkdir(parents=True, exist_ok=True)
    ziel.write_text(seite(titel, untertitel, abschnitte, fuss), encoding="utf-8")
    return ziel
