"""
Kodiert eine verlustfreie Kachelpyramide als WebP (ADR-0008).

Aufruf (aus scripts/dev/build-map-tiles.ps1):

    python scripts/dev/encode-tile-pyramid.py --source <pyramide-png> --target <neues-verzeichnis> [--quality 80]

Liest <source>/<z>/<x>/<y>.png und schreibt <target>/<z>/<x>/<y>.webp, jede Kachel genau einmal, sonst
nichts. Das Ziel darf noch nicht existieren: ein halb gefülltes Verzeichnis wäre eine Revision, die
niemand gebaut hat.

🪤 WARUM NICHT `gdal2tiles --tiledriver=WEBP`: gdal2tiles setzt jede Übersichtsstufe aus den Kacheln
zusammen, die es gerade selbst geschrieben hat. Mit WebP wären das schon verlustbehaftete Kinder, und
jede der sechs Stufen verlöre erneut. Aus der verlustfreien Zwischenstufe wird jede Kachel genau
einmal kodiert.

🔴 REPRODUZIERBAR: gleiche PNG, gleiche Qualität und gleiche libwebp ergeben bytegleiche WebP. Keine
Zeitstempel, keine Metadaten. Die Revision der Pyramide ist ein Hash über genau diese Bytes - ein
einziges wechselndes Byte gäbe jedem Lauf eine neue Revision, und jeder Browser lüde alles neu.
"""

from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image, features

# Gemessen in WI-0006: bei q80 ist die eingebrannte Schrift von `old` kaum von PNG zu unterscheiden.
DEFAULT_QUALITY = 80
# Pillows Vorgabe und der übliche Mittelweg aus Kodierzeit und Größe - genau so wurde gemessen.
WEBP_METHOD = 4


def encode(job: tuple[str, str, int]) -> int:
    """Kodiert eine Kachel. Rückgabe: Bytes der WebP-Datei."""
    source, target, quality = job
    with Image.open(source) as tile:
        # gdal2tiles schreibt RGBA. Eine deckende Kachel kostet in WebP dafür keine Bytes; ein
        # Alphakanal wird aber auch nicht erfunden, wo die Quelle keinen hat.
        tile = tile.convert("RGBA") if tile.mode in ("P", "LA", "RGBA") else tile.convert("RGB")
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        tile.save(target, "WEBP", quality=quality, method=WEBP_METHOD)
    return os.path.getsize(target)


def main() -> int:
    parser = argparse.ArgumentParser(description="Kodiert eine verlustfreie Kachelpyramide als WebP.")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--quality", type=int, default=DEFAULT_QUALITY)
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    args = parser.parse_args()

    if args.target.exists():
        print(f"Ziel existiert bereits: {args.target}", file=sys.stderr)
        return 2
    # Nur <z>/<x>/<y>.png mit ganzen Zahlen: was gdal2tiles sonst ablegt, gehört nicht zur Pyramide.
    tiles = [
        path
        for path in sorted(args.source.glob("*/*/*.png"))
        if path.stem.isdigit() and path.parent.name.isdigit() and path.parent.parent.name.isdigit()
    ]
    if not tiles:
        print(f"keine Kacheln unter {args.source}", file=sys.stderr)
        return 2

    jobs = [
        (str(tile), str(args.target / tile.relative_to(args.source).with_suffix(".webp")), args.quality)
        for tile in tiles
    ]
    print(f"libwebp      {features.version('webp')}")
    print(f"Kacheln      {len(jobs)}, Qualität {args.quality}, Methode {WEBP_METHOD}, {args.workers} Prozesse")
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        total = sum(pool.map(encode, jobs, chunksize=64))

    written = sum(1 for _ in args.target.rglob("*.webp"))
    if written != len(jobs):
        print(f"geschrieben {written} statt {len(jobs)} Kacheln", file=sys.stderr)
        return 1
    print(f"kodiert      {written} Kacheln, {total / 1_000_000:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
