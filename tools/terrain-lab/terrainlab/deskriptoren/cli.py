"""Befehl ``python -m terrainlab deskriptoren <raster.json> [--json ausgabe]``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from terrainlab.raster import lies

from . import GRUPPEN, berechne, vergleiche


def registriere(unterbefehle: "argparse._SubParsersAction") -> None:
    p = unterbefehle.add_parser(
        "deskriptoren",
        help="Gelände-Deskriptoren (Qualitätsmetriken) eines Höhenrasters berechnen",
        description=(
            "Berechnet den Metrikvektor eines Höhenrasters (Höhenverteilung, Hang/Relief, Gipfel/Kämme, Hydrologie, Frequenz). "
            "Mit --vergleich wird ein zweites Raster gleicher Zellgröße verglichen (Wasserstein-Abstand je Verteilung)."
        ),
    )
    p.add_argument("raster", nargs="?", help="Höhenraster: .json, .f32 oder Name ohne Endung (Format aus terrainlab/raster.py)")
    p.add_argument("--json", metavar="AUSGABE", help="Metrikvektor als JSON-Datei schreiben")
    p.add_argument("--gruppen", help=f"Kommagetrennte Auswahl aus: {', '.join(GRUPPEN)} (Standard: alle)")
    p.add_argument("--ohne-teuer", action="store_true", help="Metriken der Kostenklasse „hoch“ weglassen (Distanztransformationen, Querprofile)")
    p.add_argument("--vergleich", metavar="RASTER2", help="zweites Raster; verglichen wird RASTER2 gegen das erste (Referenz)")
    p.add_argument("--json-vergleich", metavar="AUSGABE", help="Vergleich als JSON-Datei schreiben (mit --vergleich)")
    p.add_argument("--zeiten", action="store_true", help="Laufzeit der Teilberechnungen ausgeben")
    p.add_argument("--ruhig", action="store_true", help="keine Tabelle auf der Standardausgabe")
    p.add_argument("--katalog", action="store_true", help="Katalog aller Metrikfamilien als Markdown ausgeben (ohne Raster)")
    p.set_defaults(ausfuehren=ausfuehren)


def ausfuehren(args: argparse.Namespace) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    gruppen = tuple(g.strip() for g in args.gruppen.split(",")) if args.gruppen else None
    if args.katalog:
        from .katalog import katalog_markdown
        from .synthetisch import fbm

        print(katalog_markdown(berechne(fbm((192, 192), 30.0, seed=3))))
        return 0
    if not args.raster:
        print("Bitte ein Raster angeben (oder --katalog).", file=sys.stderr)
        return 2
    raster = lies(args.raster)
    vektor = berechne(raster, gruppen=gruppen, teuer=not args.ohne_teuer)
    if args.json:
        pfad = vektor.schreibe(args.json)
        print(f"Metrikvektor geschrieben: {pfad}", file=sys.stderr)
    if not args.ruhig:
        print(vektor.tabelle())
    if vektor.kopf.get("hinweise") and not args.ruhig:
        print("\nHinweise:")
        for h in vektor.kopf["hinweise"]:
            print(f"  - {h}")
    if args.zeiten:
        print(f"\nLaufzeit gesamt {vektor.kopf['laufzeit_gesamt_s']:.2f} s")
        for k, v in sorted(vektor.kopf["laufzeit_s"].items(), key=lambda t: -t[1]):
            print(f"  {k:<28} {v:8.3f} s")
    if args.vergleich:
        zweiter = berechne(lies(args.vergleich), gruppen=gruppen, teuer=not args.ohne_teuer)
        ergebnis = vergleiche(vektor, zweiter)
        if not args.ruhig:
            print("\n" + ergebnis.tabelle())
        if args.json_vergleich:
            pfad = Path(args.json_vergleich)
            pfad.parent.mkdir(parents=True, exist_ok=True)
            pfad.write_text(json.dumps(ergebnis.als_dict(), ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"Vergleich geschrieben: {pfad}", file=sys.stderr)
    return 0
