"""Erzeugt die WOFF2-Hausschrift der Oberflaeche aus der TTF-Vorlage.

Die Karte bekommt ihre Schrift als SDF-Glyphen (scripts/dev/build-glyphs.mjs); die OBERFLAECHE
braucht sie als gewoehnlichen Webfont. Beide stammen aus derselben Datei
(assets/fonts/FacultyGlyphic-Regular.ttf), damit Panel und Kartenname nicht in zwei verschiedenen
Schriften stehen - genau das trennt heute Avesmaps3D von Legacy, wo eine !important-Regel die
Hausschrift auf ALLES legt.

🔴 NUR woff2, kein Rueckfallformat. Legacys Begruendung, gemessen statt vermutet: Chrome holt die
ersten ZWEI Quellen einer src-Liste, nie die dritte - eine Rueckfallkette kostet also bei jedem
Kaltbesuch eine zweite Datei, ohne je gebraucht zu werden. woff2 kann jeder Browser seit 2015.

💣 Das Ergebnis ist EINGECHECKT. Der Produktionsbau muss bytegleich reproduzierbar bleiben
(RWI-0001, ADR-0004 U33a) und darf nicht von einer Python-Umgebung abhaengen; dieses Skript laeuft
nur, wenn die Schrift gewechselt wird. Aus demselben Grund wird der Zeitstempel im Kopf der Schrift
NICHT neu gesetzt: fontTools uebernimmt ihn aus der Vorlage, zwei Laeufe liefern dieselben Bytes.

Voraussetzung: fontTools mit brotli (`py -m pip install fonttools brotli`).

Aufruf: py scripts/dev/build-web-font.py
"""

from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "fonts" / "FacultyGlyphic-Regular.ttf"
TARGET = ROOT / "apps" / "web" / "public" / "fonts" / "FacultyGlyphic-Regular.woff2"


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    font = TTFont(SOURCE)
    font.flavor = "woff2"
    font.save(TARGET)
    print(f"{SOURCE.name} -> {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size} Bytes)")


if __name__ == "__main__":
    main()
