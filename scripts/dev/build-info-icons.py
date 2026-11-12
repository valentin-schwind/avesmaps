"""Bringt die Bilder des Infopanels in ihr Format (WI-0063 P6).

Die Bilder werden nicht erzeugt, nur verkleinert - aus dem Asset-Repository des Betreibers
(`avesmaps-map-processing/icons`, nur gelesen):

* **Kopfgrafiken** (`info_header_graphics/*.png` und `info_header_graphics/strassen/*.png`): die 16:9-Bildfläche im Kopf des
  Panels. Wie Legacys `icons/header/*.webp` 800 x 450, mit Wirkung von `object-fit: cover` mittig auf 16:9 beschnitten
  (`Region.png` ist 3:2), verlustbehaftetes WebP. Ziel `apps/web/public/icons/header/<name>.webp`, der Name ist der Schlüssel
  in `apps/web/src/info-panel/header-graphic.ts`.
* **Menüsymbole** (`menu/*.png`): das Symbol einer Aktionskachel. Wie die Routenbilder (`build-route-icons.py`) 80 x 80,
  Seitenverhältnis erhalten, mittig auf transparentem Grund, verlustfreies WebP. Ziel `apps/web/public/icons/menu/<name>.webp`.

    py scripts/dev/build-info-icons.py           # alles, was das Panel braucht
    py scripts/dev/build-info-icons.py header Dorf Metropole
    py scripts/dev/build-info-icons.py menu linkteilen sextant

Ohne Namen entsteht die ganze Liste unten. Ein neuer Name kommt mit seinem Panel in `HEADER` oder `MENU` dazu.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

DEFAULT_SOURCE = Path("C:/GIT/avesmaps-map-processing/icons")
ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "apps" / "web" / "public" / "icons"

HEADER_SIZE = (800, 450)
HEADER_QUALITY = 80
MENU_SIZE = (80, 80)

# Quellen, die hochkant gespeichert sind, obwohl das Bild quer gemeint ist (kein Drehvermerk in EXIF oder XMP): Grad gegen den
# Uhrzeigersinn, VOR dem Beschnitt. Bis 2026-11-08 nachmittags stand hier `mahlstrom: 90` für das hochkant gespeicherte `Mahlstrom.png`
# (Betreiber: „warum ist das headerbild des wirbels um 90° gedreht“); seit der Mahlstrom `Studel.png` nimmt, ist die Tafel leer.
HEADER_DREHUNG: dict[str, int] = {}

# Ziel (ohne Endung) -> Quelle unter `info_header_graphics` (ohne Endung). Die Namen sind die Legacys, wo es sie gibt;
# `kraftlinien` heißt in Legacy `powerline`. Der Gebirgspass kommt aus `strassen/gebirgspfad` (Legacy hat ihn beim Import
# nach dem Subtyp umbenannt).
HEADER: dict[str, str] = {
    "auenlandschaft": "Auenlandschaft",
    "berggipfel": "Berggipfel",
    "dorf": "Dorf",
    "dschungel": "Dschungel",
    "ebene": "Ebene",
    "fluss": "Fluss",
    "gebaeude": "Gebaeude",
    "gebirge": "Gebirge",
    "graslandschaft": "Graslandschaft",
    "grossstadt": "Grossstadt",
    "huegel": "Huegel",
    "insel": "Insel",
    "kleinstadt": "KleineStadt",
    "kraftlinien": "Kraftlinien",
    "kueste": "Kueste",
    "kulturlandschaft": "Kulturlandschaft",
    "meer": "Meer",
    "metropole": "Metropole",
    "region": "Region",
    "see": "See",
    "stadt": "Stadt",
    "steppe": "Steppe",
    "sumpfmoor": "SumpfMoor",
    "tundra": "Tundra",
    "urwald": "Urwald",
    "wadi": "Wadi",
    "wald": "Wald",
    "wueste": "Wueste",
    "wuestenoase": "Wuestenoase",
    "reichsstrasse": "strassen/reichsstrasse",
    "strasse": "strassen/strasse",
    "weg": "strassen/weg",
    "pfad": "strassen/pfad",
    "gebirgspass": "strassen/gebirgspfad",
    "wuestenpfad": "strassen/wuestenpfad",
    "flussweg": "strassen/flussweg",
    "seeweg": "strassen/seeweg",
    # Die Infobox eines Vorkommens (WI-0260): je Kategorie ein Typbild.
    "flora": "Flora",
    "fauna": "Fauna",
    "ware": "Waren",
    "spezies": "Spezies",
    # Der Sammelscreen „Ausgewählte Vorkommen“ (WI-0257 S5): mehrere Vorkommen zugleich, also das allgemeine Bild.
    "vorkommen": "Vorkommen",
    # Die Infobox einer Sprache (WI-0261 S5b; Betreiber 2026-10-30: `Sprachen.png`).
    "sprachen": "Sprachen",
    # Die Landmarken (WI-0271 L6; Valis Bilder vom 2026-10-31). Geysir und Klippe haben keins (Rückfall Quelle bzw. Küste,
    # `header-graphics.ts`); `Studel.png` ist der Strudel. Der Hügel hat sein Bild schon (`huegel`).
    "vulkan": "Vulkan",
    "hoehle": "Höhle",
    "grotte": "Grotte",
    "krater": "Krater",
    "schlucht": "Schlucht",
    "wasserfall": "Wasserfall",
    "quelle": "Quelle",
    "strudel": "Studel",
    "fels": "Fels",
    "riff": "Riff",
    "furt": "Furt",
    # Die Infobox eines Wetter-Icons mit Wiki-Verweis (WI-0288; Valis Bilder vom 2026-11-08): Wind, Wirbel, Meeresströmung und der
    # Mahlstrom (eigene Icon-Art, auch ein Wirbel mit Mahlstrom-Artikel). Der Mahlstrom nimmt dasselbe Bild wie die Landmarke Strudel
    # (Betreiber 2026-11-08: „Ein Mahlstrom Header-Typbild findest du unter …\info_header_graphics\Studel.png“); `Mahlstrom.png` ist
    # damit nicht mehr in Gebrauch.
    "wind": "Wind",
    "wirbelsturm": "Wirbelsturm",
    "meeresstroemung": "Meerestroemung",
    "mahlstrom": "Studel",
}

# Ziel (ohne Endung) -> Quelle unter `menu` (ohne Endung).
MENU: dict[str, str] = {
    "linkteilen": "linkteilen",
    "sextant": "sextant",
    "vorschlag": "Vorschlag",
    "papierkorb": "Papierkorb",
    # „Weg als Route“ (P7): Legacy nimmt `img/menu/waypoint-end.webp`, die Ziel-Nadel des Planers. Das Asset-Repository führt sie als `pin`.
    "waypoint-end": "pin",
    # Die Knöpfe unter den Streifen der Kartensammlung und der Literatur (WI-0118; Legacy `img/menu/kartensammlung.webp`,
    # `img/menu/literatur.webp`, `icons/feder.webp`): „Kartensammlung anzeigen“, „Literatur anzeigen“ und „Karte vorschlagen“.
    "kartensammlung": "kartensammlung",
    "literatur": "literatur",
    "feder": "feder",
}


def header(source: Path, target: Path) -> None:
    """16:9 mittig beschneiden (wie `object-fit: cover`), auf 800 x 450, verlustbehaftetes WebP."""
    with Image.open(source) as image:
        image = image.convert("RGB")
        drehung = HEADER_DREHUNG.get(target.stem, 0)
        if drehung:
            image = image.rotate(drehung, expand=True)
        wide = HEADER_SIZE[0] / HEADER_SIZE[1]
        width, height = image.size
        if width / height > wide:
            cropped = round(height * wide)
            left = (width - cropped) // 2
            image = image.crop((left, 0, left + cropped, height))
        elif width / height < wide:
            cropped = round(width / wide)
            top = (height - cropped) // 2
            image = image.crop((0, top, width, top + cropped))
        image = image.resize(HEADER_SIZE, Image.LANCZOS)
        image.save(target, "WEBP", quality=HEADER_QUALITY, method=6)


def menu(source: Path, target: Path) -> None:
    """Verkleinern, Seitenverhältnis erhalten, mittig auf transparentem Grund, verlustfrei (Rezept der Routenbilder)."""
    with Image.open(source) as image:
        image = image.convert("RGBA")
        image.thumbnail(MENU_SIZE, Image.LANCZOS)
        canvas = Image.new("RGBA", MENU_SIZE, (0, 0, 0, 0))
        canvas.paste(image, ((MENU_SIZE[0] - image.width) // 2, (MENU_SIZE[1] - image.height) // 2), image)
        canvas.save(target, "WEBP", quality=100, method=6, lossless=True)


def run(kind: str, names: list[str], source_root: Path) -> None:
    table = HEADER if kind == "header" else MENU
    folder = "info_header_graphics" if kind == "header" else "menu"
    out = PUBLIC / kind
    out.mkdir(parents=True, exist_ok=True)
    convert = header if kind == "header" else menu
    for name in names or list(table):
        if name not in table:
            raise SystemExit(f"{kind}: unbekannter Name {name!r}; bekannt sind {', '.join(table)}")
        source = source_root / folder / f"{table[name]}.png"
        target = out / f"{name}.webp"
        convert(source, target)
        print(f"{kind}/{table[name]}.png -> {target.relative_to(ROOT)} ({target.stat().st_size // 1024} KB)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", nargs="?", choices=["header", "menu"], help="ohne Angabe: beides, ganze Liste")
    parser.add_argument("names", nargs="*", help="Zielnamen ohne Endung; ohne Angabe die ganze Liste")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Wurzel des Asset-Repositorys (icons)")
    args = parser.parse_args()
    for kind in [args.kind] if args.kind else ["header", "menu"]:
        run(kind, args.names if args.kind else [], args.source)


if __name__ == "__main__":
    main()
