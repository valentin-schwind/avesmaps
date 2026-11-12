"""
Leitet aus einer 512-PNG-Rasterpyramide Formatvarianten ab und misst ihre Größe (WI-0006, Teil 2).

Die Pyramiden sind Derived Data (Kapitel 9.63); dieses Skript fasst weder die Quellbilder noch die
ausgelieferte Pyramide an. Es LIEST die verlustfreie Zwischenstufe des Pyramidenbaus unter
C:\\avesmaps3d-data\\work\\<domain>\\<serie>\\pyramid-png\\ (seit ADR-0008 liefert die Karte WebP aus)
und schreibt die Varianten nach C:\\avesmaps3d-data\\work\\tile-formats\\<serie>\\<variante>\\.

Varianten:

  png512        die ausgelieferte Baseline — wird nur gezählt, nicht neu geschrieben
  webp512-q80   gleiche Kachelgeometrie, verlustbehaftetes WebP (Qualität 80)
  webp512-ll    gleiche Kachelgeometrie, verlustfreies WebP
  webp256-q80   Legacys Wahl: 256er-Kacheln, verlustbehaftetes WebP. Legacy liefert genau das
                (VP8, 256x256, gemessen an avesmaps.de am 2026-09-23)

🪤 DIE 256er-PYRAMIDE ENTSTEHT OHNE NEUE PIXEL. Eine 256er-Kachel auf Stufe z+1 deckt genau ein
Viertel einer 512er-Kachel auf Stufe z ab — sie wird ausgeschnitten, nicht neu gerechnet. Nur die
eine Kachel auf Stufe 0 muss verkleinert werden. So vergleicht die Messung Formate, nicht zwei
verschiedene Resamplings.

Aufruf:  py -3 scripts/dev/measure-tile-formats.py --series original [--only-zoom 6] [--workers 20]
"""

from __future__ import annotations

import argparse
import json
import os
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

DATA_ROOT = Path(r"C:\avesmaps3d-data")
VARIANTS = ("webp512-q80", "webp512-ll", "webp256-q80")
LOSSY_QUALITY = 80
# Methode 4 ist Pillows Vorgabe und der übliche Mittelweg aus Kodierzeit und Größe; 6 wäre
# kleiner, aber eine Pyramide braucht dann ein Vielfaches an Zeit. Gemessen wird das Format, nicht
# die letzte Kompressionsstufe.
WEBP_METHOD = 4


def encode_tile(job: tuple[str, str, int, int, int]) -> tuple[str, int, int]:
    """Kodiert eine 512er-Kachel in alle Varianten. Rückgabe: Variante, Zoom der Ausgabe, Bytes."""
    source, out_root, z, x, y = job
    ergebnisse: list[tuple[str, int, int]] = []
    with Image.open(source) as bild:
        bild = bild.convert("RGBA") if bild.mode in ("P", "LA", "RGBA") else bild.convert("RGB")
        ziel512 = Path(out_root) / "webp512-q80" / str(z) / str(x)
        ziel512.mkdir(parents=True, exist_ok=True)
        pfad = ziel512 / f"{y}.webp"
        bild.save(pfad, "WEBP", quality=LOSSY_QUALITY, method=WEBP_METHOD)
        ergebnisse.append(("webp512-q80", z, pfad.stat().st_size))

        ziel_ll = Path(out_root) / "webp512-ll" / str(z) / str(x)
        ziel_ll.mkdir(parents=True, exist_ok=True)
        pfad = ziel_ll / f"{y}.webp"
        bild.save(pfad, "WEBP", lossless=True, method=WEBP_METHOD)
        ergebnisse.append(("webp512-ll", z, pfad.stat().st_size))

        # Die vier Viertel sind die 256er-Kacheln der nächsten Stufe.
        for dx in (0, 1):
            for dy in (0, 1):
                viertel = bild.crop((dx * 256, dy * 256, dx * 256 + 256, dy * 256 + 256))
                ziel = Path(out_root) / "webp256-q80" / str(z + 1) / str(2 * x + dx)
                ziel.mkdir(parents=True, exist_ok=True)
                pfad = ziel / f"{2 * y + dy}.webp"
                viertel.save(pfad, "WEBP", quality=LOSSY_QUALITY, method=WEBP_METHOD)
                ergebnisse.append(("webp256-q80", z + 1, pfad.stat().st_size))
        if z == 0:
            # Stufe 0 der 256er-Pyramide: die einzige Kachel, die verkleinert werden muss.
            ziel = Path(out_root) / "webp256-q80" / "0" / "0"
            ziel.mkdir(parents=True, exist_ok=True)
            pfad = ziel / "0.webp"
            bild.resize((256, 256), Image.Resampling.LANCZOS).save(
                pfad, "WEBP", quality=LOSSY_QUALITY, method=WEBP_METHOD
            )
            ergebnisse.append(("webp256-q80", 0, pfad.stat().st_size))
    return ergebnisse  # type: ignore[return-value]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--series", required=True)
    parser.add_argument("--domain", default="aventuria")
    parser.add_argument("--only-zoom", type=int, default=None)
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    args = parser.parse_args()

    quelle = DATA_ROOT / "work" / args.domain / args.series / "pyramid-png"
    ziel = DATA_ROOT / "work" / "tile-formats" / args.series
    if not quelle.is_dir():
        raise SystemExit(f"keine Pyramide unter {quelle}")

    jobs: list[tuple[str, str, int, int, int]] = []
    groessen: dict[str, dict[int, list[int]]] = {"png512": {}}
    for z_dir in sorted(quelle.iterdir(), key=lambda p: int(p.name) if p.name.isdigit() else -1):
        if not z_dir.name.isdigit():
            continue
        z = int(z_dir.name)
        if args.only_zoom is not None and z != args.only_zoom:
            continue
        for x_dir in z_dir.iterdir():
            for tile in x_dir.glob("*.png"):
                groessen["png512"].setdefault(z, []).append(tile.stat().st_size)
                jobs.append((str(tile), str(ziel), z, int(x_dir.name), int(tile.stem)))

    start = time.perf_counter()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for ergebnisse in pool.map(encode_tile, jobs, chunksize=16):
            for variante, z, groesse in ergebnisse:
                groessen.setdefault(variante, {}).setdefault(z, []).append(groesse)
    dauer = time.perf_counter() - start

    zusammenfassung = {
        "series": args.series,
        "source": str(quelle),
        "lossyQuality": LOSSY_QUALITY,
        "webpMethod": WEBP_METHOD,
        "encodeSeconds": round(dauer, 1),
        "variants": {
            variante: {
                "tiles": sum(len(v) for v in je_zoom.values()),
                "bytes": sum(sum(v) for v in je_zoom.values()),
                "perZoom": {
                    str(z): {"tiles": len(v), "bytes": sum(v), "meanBytes": round(sum(v) / len(v))}
                    for z, v in sorted(je_zoom.items())
                },
            }
            for variante, je_zoom in groessen.items()
        },
    }
    ziel.mkdir(parents=True, exist_ok=True)
    (ziel / "summary.json").write_text(json.dumps(zusammenfassung, indent=2), encoding="utf-8")
    for variante, daten in zusammenfassung["variants"].items():
        print(f"{variante:12} {daten['tiles']:6} Kacheln  {daten['bytes'] / 1e6:9.1f} MB")
    print(f"kodiert in {dauer:.0f} s")


if __name__ == "__main__":
    main()
