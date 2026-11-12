"""`python -m terrainlab <befehl> …` — ein Einstieg für alle Werkzeuge des Labs.

Jedes Teilpaket mit einer Datei `cli.py`, die `registriere(unterbefehle)` anbietet, erscheint hier als Befehl. So bleibt dieser Einstieg
unverändert, wenn ein neues Teilpaket dazukommt.
"""

from __future__ import annotations

import argparse
import importlib
import pkgutil
import sys

import terrainlab


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m terrainlab", description="Terrain Calibration & Benchmark Lab (WI-0250)")
    unterbefehle = parser.add_subparsers(dest="befehl", required=True)
    for modul in sorted(m.name for m in pkgutil.iter_modules(terrainlab.__path__) if m.ispkg):
        try:
            cli = importlib.import_module(f"terrainlab.{modul}.cli")
        except ModuleNotFoundError:
            continue
        cli.registriere(unterbefehle)
    args = parser.parse_args(argv)
    return int(args.ausfuehren(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
