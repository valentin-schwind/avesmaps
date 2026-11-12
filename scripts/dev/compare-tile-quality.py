"""
Vergleicht die Bildqualität der Formatvarianten gegen die verlustfreie 512-PNG-Pyramide (WI-0006).

🔴 `old` ZÄHLT BESONDERS: diese Serie trägt ihre Ortsnamen IM BILD (labelsInImage). Verlustbehaftete
Kompression zeigt sich zuerst an Schriftkanten — ein Urteil über `original` sagt über `old` nichts.
Deshalb misst dieses Skript zweierlei:

  PSNR gesamt     wie stark das ganze Bild abweicht
  PSNR Kanten     nur die Pixel mit starkem Helligkeitssprung — dort liegen Schrift und Linien

und legt dazu Ausschnitte der schriftreichsten Kacheln dreifach vergrößert nebeneinander, damit das
Urteil ein Blick ist, keine Zahl.

Aufruf:  py -3 scripts/dev/compare-tile-quality.py --series old [--sample 300]
Ergebnis: review/tile-formats/<serie>-quality.json und <serie>-quality.png
"""

from __future__ import annotations

import argparse
import io
import json
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

DATA_ROOT = Path(r"C:\avesmaps3d-data")
REPO = Path(__file__).resolve().parents[2]
NATIVE_ZOOM = 6
QUALITIES = (70, 80, 90)


def webp_bytes(bild: Image.Image, quality: int) -> bytes:
    puffer = io.BytesIO()
    bild.save(puffer, "WEBP", quality=quality, method=4)
    return puffer.getvalue()


def as_array(bild: Image.Image) -> np.ndarray:
    return np.asarray(bild.convert("RGB"), dtype=np.float64)


def psnr(a: np.ndarray, b: np.ndarray, maske: np.ndarray | None = None) -> float:
    diff = (a - b) ** 2
    if maske is not None:
        diff = diff[maske]
    mse = float(diff.mean()) if diff.size else 0.0
    return float("inf") if mse == 0 else 10 * np.log10(255.0**2 / mse)


def kantenmaske(a: np.ndarray) -> np.ndarray:
    """Pixel mit starkem Helligkeitssprung zum Nachbarn — Schrift, Linien, Küsten."""
    grau = a.mean(axis=2)
    gx = np.abs(np.diff(grau, axis=1, append=grau[:, -1:]))
    gy = np.abs(np.diff(grau, axis=0, append=grau[-1:, :]))
    return (gx + gy) > 60


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--series", required=True)
    parser.add_argument("--sample", type=int, default=1000)
    parser.add_argument("--worst", type=int, default=150)
    args = parser.parse_args()

    # Die verlustfreie Zwischenstufe des Pyramidenbaus (ADR-0008), nicht die ausgelieferte WebP-Pyramide.
    quelle = DATA_ROOT / "work" / "aventuria" / args.series / "pyramid-png" / str(NATIVE_ZOOM)
    kacheln = sorted(quelle.glob("*/*.png"))
    random.Random(20260923).shuffle(kacheln)
    # 🪤 DER UNGÜNSTIGSTE FALL, NICHT DER DURCHSCHNITT. Die Schrift von `old` ist über 4096 Kacheln
    # dünn verteilt; eine Zufallsstichprobe trifft vor allem Meer und Fläche und misst dort, was
    # jedes Format kann. Gemessen werden deshalb die kantenreichsten Kacheln einer großen Stichprobe.
    def kantenanteil(pfad: Path) -> float:
        with Image.open(pfad) as roh:
            return float(kantenmaske(as_array(roh.convert("RGB"))).mean())

    bewertet = sorted(((kantenanteil(p), p) for p in kacheln[: args.sample]), reverse=True)
    stichprobe = [p for _, p in bewertet[: args.worst]]

    werte: dict[int, dict[str, list[float]]] = {q: {"psnr": [], "kanten": [], "kb": []} for q in QUALITIES}
    kandidaten: list[tuple[float, Path]] = []
    for pfad in stichprobe:
        with Image.open(pfad) as roh:
            bild = roh.convert("RGB")
        a = as_array(bild)
        maske = kantenmaske(a)
        kandidaten.append((float(maske.mean()), pfad))
        for q in QUALITIES:
            daten = webp_bytes(bild, q)
            b = as_array(Image.open(io.BytesIO(daten)))
            werte[q]["psnr"].append(psnr(a, b))
            if maske.any():
                werte[q]["kanten"].append(psnr(a, b, maske))
            werte[q]["kb"].append(len(daten) / 1024)

    zusammenfassung = {
        "series": args.series,
        "zoom": NATIVE_ZOOM,
        "sample": args.sample,
        "worstTiles": len(stichprobe),
        "qualities": {
            str(q): {
                "psnrMedian": round(float(np.median(v["psnr"])), 2),
                "kantenPsnrMedian": round(float(np.median(v["kanten"])), 2),
                "kantenPsnrSchlechteste5Prozent": round(float(np.percentile(v["kanten"], 5)), 2),
                "kbMittel": round(float(np.mean(v["kb"])), 1),
            }
            for q, v in werte.items()
        },
    }

    # Die drei schriftreichsten Kacheln, je ein Ausschnitt mit der dichtesten Kante, dreifach
    # vergrößert (nächster Nachbar — keine Glättung, die die Artefakte verstecken würde).
    kandidaten.sort(reverse=True)
    zeilen = []
    for _, pfad in kandidaten[:3]:
        with Image.open(pfad) as roh:
            bild = roh.convert("RGB")
        maske = kantenmaske(as_array(bild))
        breite, hoehe = 170, 100
        best, box = -1.0, (0, 0)
        for y in range(0, 512 - hoehe, 20):
            for x in range(0, 512 - breite, 20):
                dichte = float(maske[y : y + hoehe, x : x + breite].mean())
                if dichte > best:
                    best, box = dichte, (x, y)
        x, y = box
        ausschnitt = (x, y, x + breite, y + hoehe)
        spalten = [("PNG (heute)", bild.crop(ausschnitt))]
        for q in QUALITIES:
            dekodiert = Image.open(io.BytesIO(webp_bytes(bild, q))).convert("RGB")
            spalten.append((f"WebP q{q}", dekodiert.crop(ausschnitt)))
        zeilen.append(spalten)

    faktor = 3
    zelle_b, zelle_h = 170 * faktor, 100 * faktor
    tafel = Image.new("RGB", (len(zeilen[0]) * (zelle_b + 6), len(zeilen) * (zelle_h + 26)), (34, 34, 34))
    zeichnen = ImageDraw.Draw(tafel)
    for r, spalten in enumerate(zeilen):
        for c, (titel, bild) in enumerate(spalten):
            ox, oy = c * (zelle_b + 6), r * (zelle_h + 26)
            zeichnen.text((ox + 4, oy + 4), titel, fill=(255, 255, 255))
            tafel.paste(bild.resize((zelle_b, zelle_h), Image.Resampling.NEAREST), (ox, oy + 22))

    ziel = REPO / "review" / "tile-formats"
    ziel.mkdir(parents=True, exist_ok=True)
    (ziel / f"{args.series}-quality.json").write_text(json.dumps(zusammenfassung, indent=2), encoding="utf-8")
    tafel.save(ziel / f"{args.series}-quality.png")
    for q, daten in zusammenfassung["qualities"].items():
        print(
            f"q{q}: PSNR {daten['psnrMedian']} dB, Kanten {daten['kantenPsnrMedian']} dB "
            f"(schlechteste 5 %: {daten['kantenPsnrSchlechteste5Prozent']} dB), {daten['kbMittel']} KB je Kachel"
        )


if __name__ == "__main__":
    main()
