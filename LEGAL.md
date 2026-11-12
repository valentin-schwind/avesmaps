# What the MIT license covers — and what it does not

This branch mixes two very different things: **software written for Avesmaps3D**, and **content** whose rights belong to other people
(Ulisses Spiele, Wiki Aventurica authors, font and library authors) or stay with the project.

Only the software is open source.

- [`LICENSE`](LICENSE) — the MIT license for the source code.
- [`NOTICE.md`](NOTICE.md) — sources, fan-guideline notes, trademarks.

**Rule of thumb: if it is not listed under "Covered" below, it is not licensed under MIT.** There is no implied license for anything else in
this branch.

## Covered by the MIT license

The original source code of Avesmaps3D, written for this project:

| Path | Content |
|---|---|
| `apps/server/src/`, `apps/server/migrations/` | server, jobs and database schema (the code, not the data some migrations carry) |
| `apps/web/src/` | web application (the code, not the texts and translations it carries) |
| `packages/` | shared contracts and libraries |
| `apps/*/test/`, `apps/*/e2e/` | tests (the code, not the fixtures listed below) |
| `scripts/`, `tools/` | build, test and data tooling |
| `docs/schnittstellen/` | the project's own technical documentation |
| root configuration (`package.json`, `tsconfig*.json`, `eslint.config.mjs`, `vitest*.ts`, …) | build and test configuration |

Contributions to these parts are accepted under the same MIT license (see [`CONTRIBUTING.md`](CONTRIBUTING.md)).

## Not covered by the MIT license

| Item | Status |
|---|---|
| map, place, path, region, territory, terrain and language geometry wherever it appears (database contents, GeoJSON, fixtures, control points, generated data) | derived from DSA map material and community data; **not MIT** |
| Aventurien names, descriptions, lore and other DSA-related text content, also where it appears inside source files, translations (`apps/web/src/i18n/`), migrations or `config/` | rights held by Ulisses Spiele / the respective authors; **not MIT** |
| texts taken from Wiki Aventurica, including test fixtures built from wiki pages (`apps/server/test/fixtures/wiki-*`) | CC BY-SA 3.0 (see below); **not MIT** |
| `apps/web/public/img/dsa-fanprojekt-logo.webp` and any DSA artwork or cover images | usable only under the Ulisses fan guidelines, revocable; **not MIT** |
| images that show the map (e.g. `apps/web/public/img/reise-pdf/`) | contain the map material; **not MIT** |
| the project's own images and icons (`apps/web/public/icons/`, `apps/web/public/img/`, `apps/web/public/favicon.ico`, images under `apps/web/src/`, `config/photobox/`), partly made with generative AI | all rights reserved by the project; **not MIT** |
| editorial texts of the project: legal notices (`config/legal/`), news (`config/news/`), release notes (`config/releases/`), help texts | all rights reserved by the project; **not MIT** |
| `apps/web/public/icons/discord/` | Discord brand assets, used under Discord's brand guidelines; **not MIT** |
| trademarks and logos (see "Trademarks") | no license granted |

Rendering DSA content through MIT-licensed code does not place that content under MIT. Reusing the code is fine; reusing the Aventurien data
with it is not something this branch can grant.

The map data itself (the database, tiles and terrain) is **not** part of this branch. A local build of Avesmaps3D starts with an empty map.

## Third-party components with their own licenses

| Component | License |
|---|---|
| Faculty Glyphic (`assets/fonts/`, `apps/web/public/fonts/`, glyph ranges derived from it in `apps/web/public/glyphs/`) | SIL Open Font License 1.1 — `assets/fonts/OFL-FacultyGlyphic.txt` |
| npm packages (installed from `package-lock.json`, not part of this branch) | each under its own license; the main ones are listed in the "Hinweise" window of the map under "Software und Lizenzen" |
| DB-IP IP-to-location database (server side, not in this branch) | CC BY 4.0 |

## Wiki Aventurica content

Text taken from [Wiki Aventurica](https://de.wiki-aventurica.de/) is licensed by its authors under **CC BY-SA 3.0** and stays under that
license, including in edited form. It requires attribution to the source article, a license reference, and share-alike for derivative text.
Content taken from the regional wikis of Garetien and Kosch is under **CC BY-NC-SA 3.0**. Neither is MIT, and neither can be relicensed here.

Files on the wiki (coats of arms, maps, images) do **not** share that license — each file carries its own. Avesmaps only displays files whose
individual file license permits it.

The CC licenses cover the wiki authors' own contribution. Copyrights and trademarks of Ulisses Spiele apply on top of them and are not affected.

## Trademarks

DAS SCHWARZE AUGE, AVENTURIEN, DERE, MYRANOR, THARUN, UTHURIA, RIESLAND and THE DARK EYE are trademarks of their respective owners (see
[`NOTICE.md`](NOTICE.md)). The MIT license grants **no** trademark rights. A fork of the code must not suggest that it is an official DSA
product, endorsed by Ulisses Spiele, or Avesmaps itself.

## No warranty about the content

The MIT license disclaims warranty for the software. It says nothing about the rights situation of the content described above — anyone
reusing parts of this branch is responsible for clearing those rights themselves.

---

## Kurzfassung auf Deutsch

Nur der **selbst geschriebene Programmcode** von Avesmaps3D (TypeScript, Vue, SQL-Schema, Werkzeuge und Tests) steht unter der MIT-Lizenz —
siehe [`LICENSE`](LICENSE).

**Nicht** unter MIT stehen: sämtliche Karten-, Orts-, Wege-, Gebiets- und Geländedaten, DSA-bezogene Namen und Texte (auch in Quelltexten,
Übersetzungen und Migrationen), Wappen, Bilder und Symbole, die redaktionellen Texte des Projekts sowie alle Marken. Für diese Teile gelten die
Rechte der Originalquellen und die Ulisses-Fanrichtlinien ([`NOTICE.md`](NOTICE.md)); die eigenen Bilder und Texte behält das Projekt.

Texte aus Wiki Aventurica stehen unter **CC BY-SA 3.0**, Inhalte aus Garetien und dem Kosch unter **CC BY-NC-SA 3.0**; Dateien dort haben je
eigene Lizenzen. Die Kartendaten selbst liegen nicht in diesem Zweig.

Was oben nicht ausdrücklich als „Covered" aufgeführt ist, ist **nicht** MIT-lizenziert.
