"""Bringt fertige Transportbilder in das Format der Planerbilder (WI-0050).

Die Bilder werden nicht erzeugt, nur verkleinert: aus den großen PNG in
`avesmaps-map-processing/icons/large` auf 80 x 80 px, Seitenverhältnis erhalten, mittig auf
transparentem Grund, verlustfreies WebP. Das ist das Rezept von
`avesmaps-map-processing/scripts/28_icons_resizing.py`, mit dem die bestehenden Bilder unter
`apps/web/public/icons/route/` entstanden sind - Kutsche, Galeere und Rast kommen damit bytegleich heraus.

    py scripts/dev/build-route-icons.py Hexenflug Greif
    py scripts/dev/build-route-icons.py Reisen/Flussweg=Flusswege
    py scripts/dev/build-route-icons.py --source D:/andere/large Hexenflug

Ein Name darf einen Ordner unter `large` tragen (`Reisen/Flussweg`) und mit `=Ziel` einen anderen
Zielnamen nennen. 💣 Der Zielname wird nur dann anders geschrieben als die Quelle, wenn er sich nicht
nur in der Gross- und Kleinschreibung unterscheidet: Windows kennt `landweg.webp` und `Landweg.webp`
als dieselbe Datei, Git nicht - ein solches Paar legte zwei Namen fuer einen Inhalt an.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

SIZE = (80, 80)
DEFAULT_SOURCE = Path("C:/GIT/avesmaps-map-processing/icons/large")
TARGET = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "icons" / "route"


def convert(source: Path, target: Path) -> None:
    with Image.open(source) as image:
        image = image.convert("RGBA")
        image.thumbnail(SIZE, Image.LANCZOS)
        canvas = Image.new("RGBA", SIZE, (0, 0, 0, 0))
        canvas.paste(image, ((SIZE[0] - image.width) // 2, (SIZE[1] - image.height) // 2), image)
        canvas.save(target, "WEBP", quality=100, method=6, lossless=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("names", nargs="+", help="Dateinamen ohne Endung, etwa Hexenflug oder Reisen/Flussweg=Flusswege")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Ordner mit den großen PNG")
    args = parser.parse_args()
    for name in args.names:
        source_name, _, target_name = name.partition("=")
        stem = Path(source_name).name
        source = args.source / f"{source_name}.png"
        target = TARGET / f"{(target_name or stem)}.webp"
        convert(source, target)
        print(f"{source.name} -> {target.relative_to(TARGET.parents[4])}")


if __name__ == "__main__":
    main()
