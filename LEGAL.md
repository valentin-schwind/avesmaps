# What the MIT license covers — and what it does not

This repository mixes two very different things: **software written for this
project**, and **content** whose rights belong to other people (Ulisses Spiele,
Wiki Aventurica authors, font and library authors).

Only the software is open source.

- [`LICENSE`](LICENSE) — the MIT license for the source code.
- [`NOTICE.md`](NOTICE.md) — sources, fan-guideline notes, trademarks.

**Rule of thumb: if it is not listed under "Covered" below, it is not licensed
under MIT.** There is no implied license for anything else in this repository.

## Covered by the MIT license

The original source code of Avesmaps, written for this project:

| Path | Content |
|---|---|
| `js/` (except `js/third-party/`) | frontend application code |
| `api/`, `edit/`, `admin/` | PHP backend, editor and admin code |
| `css/` | stylesheets |
| `index.html`, `html/` | markup and page templates (the code, not the German editorial texts they carry) |
| `tools/`, `scripts/`, `tests/`, `.github/` | build-free tooling, test runners, deploy workflow |
| `sql/`, `config/api.config.example.php` | schema definitions and example configuration |
| `docs/` | the project's own technical documentation |

Contributions to these parts are accepted under the same MIT license.

## Not covered by the MIT license

| Item | Status |
|---|---|
| `tiles/` — the map tiles | derived from official DSA map material; **not MIT** |
| map, place, path, region and territory geometry (GeoJSON, database contents, generated data dumps) | derived from DSA map material and community data; **not MIT** |
| Aventurien names, descriptions, lore and other DSA-related text content | rights held by Ulisses Spiele / the respective authors; **not MIT** |
| coats of arms and other images fetched from Wiki Aventurica | each file carries its own license on the wiki; **not MIT** |
| `img/dsa-fanprojekt-logo.png` / `.webp` and any DSA artwork or cover images | usable only under the Ulisses fan guidelines, revocable; **not MIT** |
| screenshots and example images that show the map (e.g. `img/example.png`) | contain the map material; **not MIT** |
| trademarks and logos (see "Trademarks") | no license granted |

Rendering DSA content through MIT-licensed code does not place that content
under MIT. Reusing the code is fine; reusing the Aventurien data with it is not
something this repository can grant.

## Third-party components with their own licenses

| Component | License |
|---|---|
| Leaflet 1.9.4 (`js/third-party/leaflet.js`) | BSD-2-Clause |
| jQuery 3.6.0, jQuery UI 1.13.2 (`js/third-party/`) | MIT |
| polygon-clipping (`js/third-party/polygon-clipping.umd.min.js`) | MIT |
| polylabel 1.1.0, vendored incl. tinyqueue (`js/third-party/polylabel.js`) | ISC |
| Faculty Glyphic (`fonts/`) | SIL Open Font License 1.1 — `fonts/OFL-FacultyGlyphic.txt` |
| DB-IP IP-to-location database (server side, not in this repository) | CC BY 4.0 |

## Wiki Aventurica content

Text taken from [Wiki Aventurica](https://de.wiki-aventurica.de/) is licensed
by its authors under **CC BY-SA 3.0** and stays under that license, including
in edited form. It requires attribution to the source article, a license
reference, and share-alike for derivative text. It is therefore neither MIT nor
freely relicensable here.

Files on the wiki (coats of arms, maps, images) do **not** share that license —
each file carries its own. Avesmaps only displays files whose individual file
license permits it.

The CC BY-SA license covers the wiki authors' own contribution. Copyrights and
trademarks of Ulisses Spiele apply on top of it and are not affected by it.

## Trademarks

DAS SCHWARZE AUGE, AVENTURIEN, DERE, MYRANOR, THARUN, UTHURIA, RIESLAND and THE
DARK EYE are trademarks of their respective owners (see [`NOTICE.md`](NOTICE.md)).
The MIT license grants **no** trademark rights. A fork of the code must not
suggest that it is an official DSA product or endorsed by Ulisses Spiele.

## No warranty about the content

The MIT license disclaims warranty for the software. It says nothing about the
rights situation of the content described above — anyone reusing parts of this
repository is responsible for clearing those rights themselves.

---

## Kurzfassung auf Deutsch

Nur der **selbst geschriebene Programmcode** (JavaScript, PHP, CSS, HTML-Gerüst,
Werkzeuge) steht unter der MIT-Lizenz — siehe [`LICENSE`](LICENSE).

**Nicht** unter MIT stehen: die Kartenkacheln, sämtliche Karten-, Orts-, Wege-
und Gebietsdaten, DSA-bezogene Texte, Wappen und Bilder sowie alle Marken. Für
diese Teile gelten die Rechte der Originalquellen und die Ulisses-Fanrichtlinien
([`NOTICE.md`](NOTICE.md)).

Texte aus Wiki Aventurica stehen unter **CC BY-SA 3.0** und bleiben es auch in
bearbeiteter Form; Dateien dort haben je eigene Lizenzen.

Was oben nicht ausdrücklich als „Covered" aufgeführt ist, ist **nicht**
MIT-lizenziert.
