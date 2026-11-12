"""Befehl ``python -m terrainlab bericht <lauf|vergleich|messung> [...]`` (WI-0250 Phase A5)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


from . import BerichtFehler, erzeuge_bericht


def registriere(unterbefehle: "argparse._SubParsersAction") -> None:
    p = unterbefehle.add_parser(
        "bericht",
        help="statischen HTML-Bericht zu einem Optimierungslauf, einer Messung oder einem Commit-Vergleich schreiben",
        description=(
            "Schreibt EINE statische HTML-Datei (Bilder eingebettet, kein Server, kein Framework): Qualität je Typ in drei getrennten Dimensionen, Formerhalt, Referenzmetriken, "
            "Performance, Regressionen zwischen zwei Commits, Bildvergleich real/Vorschau/Endgelände (Schummerung aus den echten Höhen), Profile und Parameteranalyse. "
            "Eingaben: Laufordner der Optimierung (lauf.sqlite), Messungen (ergebnis.json von `lauf perf` und `lauf qualitaet`), Vergleiche (vergleich.json von `lauf vergleiche`)."
        ),
    )
    p.add_argument("eingaben", nargs="+", metavar="LAUF", help="Laufordner oder Ergebnisdatei(en); Art wird erkannt")
    p.add_argument("--ausgabe", metavar="DATEI", help="Zieldatei (Vorgabe <Labor>/berichte/<lauf>.html)")
    p.add_argument("--perf", action="append", default=[], metavar="ORDNER", help="zusätzlich eine Performance-Messung (lauf perf), mehrfach möglich")
    p.add_argument("--vergleich", action="append", default=[], metavar="ORDNER", help="zusätzlich einen Commit-Vergleich (lauf vergleiche), mehrfach möglich")
    p.add_argument("--nachmessung", action="append", default=[], metavar="ORDNER", help="zusätzlich eine Nachmessung (optimierung nachmessen), mehrfach möglich")
    p.add_argument("--cache", metavar="ORDNER", help="Zwischenspeicher der Läufe mit den Rastern (Vorgabe <Labor>/cache)")
    p.add_argument("--titel", help="Titel der Seite")
    p.set_defaults(ausfuehren=ausfuehren)


def ausfuehren(args: argparse.Namespace) -> int:
    for strom in (sys.stdout, sys.stderr):
        if hasattr(strom, "reconfigure"):
            strom.reconfigure(encoding="utf-8", errors="replace")
    try:
        ziel = erzeuge_bericht(args.eingaben, args.ausgabe, titel=args.titel, cache=args.cache, perf=args.perf, vergleich=args.vergleich, nachmessung=args.nachmessung)
    except (BerichtFehler, FileNotFoundError) as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 2
    print(f"Bericht: {ziel}  ({Path(ziel).stat().st_size / 1024:.0f} KiB)")
    return 0
