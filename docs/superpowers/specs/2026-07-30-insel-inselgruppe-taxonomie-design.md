# Insel und Inselgruppe — zwei Dinge, zwei Ebenen

**Stand:** 2026-07-30 · **Status:** Entwurf, vom Owner freigegeben. **Nichts gebaut.**
**Prüfstand:** `origin/master` `275e204f`.
**Messung:** ein einzelner `GET /api/app/ecosystem-areas.php`, Revision **5795**, 679 Flächen,
im Scratchpad ausgewertet.

---

## 1. Die Frage und die Entscheidung

Die Landschaften-Ebene kennt die Art `insel`, und sie liegt auf der **Derographie**. Der Owner
war unsicher, ob daraus nicht eher `inselgruppe` werden müsste und `insel` eine topographische
Fläche.

**Entscheidung (Owner, 2026-07-30):** beides, aber nicht als Umbenennung.

1. **`insel` zieht auf die Topographie.** 251 Flächen, ein Umzug — keine Kopie.
2. **`insel` auf der Derographie wird abgeschaltet.** Danach ohnehin leer.
3. **`inselgruppe` kommt neu auf die Derographie und startet leer.**

Ausdrücklich **kein** Zwang, jetzt Bestand umzuwidmen. Bilku-Archipel und die Kaiserlichen
Inseln bleiben zunächst Inseln in der Topographie; wer sie umwidmen will, nimmt „Senden an",
wann es passt.

---

## 2. Warum die Derographie der falsche Ort ist

Das Haus hat die Regel dreimal selbst hingeschrieben — bei `wadi`, `schlucht` und `flussdelta`,
jeweils mit derselben Begründung (`api/_internal/app/ecosystem.php:88–117`): **Topographie ist die
FORM, Vegetation die DECKE, Derographie der benannte BEHÄLTER.** Wörtlich zum Delta: „was ein Delta
ausmacht, ist die FORM … Was darauf wächst, ist Folge, nicht Kennzeichen."

Eine Insel ist Land, das von Wasser umschlossen ist. Das ist eine Form, kein Name.

Eine *Inselgruppe* dagegen ist genau ein Behälter: ein Name über mehreren Stücken Land, wie
`region` einer ist.

### Der Beweis steht im Bestand

| | |
|---|---|
| `derographisch/insel`-Flächen | **251** (zweitgrößte Art nach `topographie/see` mit 278) |
| davon automatisch benannt (`Insel-001 … Insel-167`) | **164** |
| mit echtem Namen | 87 |
| davon mit Gruppen-Signal im Namen | **8** |
| tatsächliche Gruppen (Bilku-Archipel, Kaiserliche Inseln, Efferdstränen, Austernsteine, Alkenfelsen) | **~5** |
| Regionen mit mehr als einer Fläche | **0** |
| mit Wiki-Verknüpfung | **0** |

🔴 **`Bilku` (41 Ecken) und `Bilku-Archipel` (27 Ecken) liegen heute als zwei Regionen derselben
Art auf der Karte.** Das eine ist ein Stück Land, das andere ein Name für mehrere — im selben Fach.
Das ist der eigentliche Befund, und er trägt die Entscheidung.

⚠️ Umbenennen wäre falsch gewesen: „Inselgruppe" trifft 5 von 251. Die anderen 246 sind einzelne
Inseln, 164 davon namenlose Umrisse.

Nebenbefund, gegen einen naheliegenden Irrtum: `Hjalland`, `Kaiser-Raul-Land` und `Yeti-Land`
tragen ein Gruppenwort im Namen, sind aber einzelne Landmassen. `Maraskan` ist ein Multipolygon
aus 5 Teilen, `Talania` aus 3 — als *Form* völlig in Ordnung, keine Gruppen. Ein Namensmuster
darf hier also nichts entscheiden.

---

## 3. Das Vokabular

Drei Zeilen in `AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED` (`api/_internal/app/ecosystem.php:75–130`):

| | Ebene | Schlüssel | Anzeige | `sort_order` |
|---|---|---|---|---|
| **neu** | `topographie` | `insel` | Insel | 120 |
| **neu** | `derographisch` | `inselgruppe` | Inselgruppe | 20 |
| **weg** | `derographisch` | `insel` | — | — |

`derographisch/insel` fliegt **aus dem Seed** *und* bekommt `is_active = 0`. Nur eines von beidem
reicht nicht:

- Nur die Zeile deaktivieren → das Seed läuft per `INSERT IGNORE` vor jedem Schreibvorgang; bei
  einer Neuinstallation entstünde sie wieder, diesmal aktiv.
- Nur aus dem Seed nehmen → `INSERT IGNORE` überschreibt nichts, die vorhandene Zeile bliebe aktiv
  und die Art weiter wählbar.

`inselgruppe` erbt `sort_order = 20`, also den Platz, den `insel` auf der Derographie hatte.

Damit: Derographie bleibt bei vier Arten (Region · **Inselgruppe** · Kontinent · Sonstiges),
Topographie wächst von 11 auf 12.

### Farbe

`ecosystemAreaColor()` (`js/map-features/map-features-ecosystem-rendering.js:80`) leitet den Ton
**nach Regel** aus dem Schlüssel ab — `--color-ecosystem-<ebene>-<art>`, sonst der Grundton der
Ebene. Es gibt keine Typenliste im Code, die veralten könnte.

- 🔴 **`--color-ecosystem-topographie-insel: #b2a273` ist Pflicht.** Ohne Token fallen alle 251
  Inseln auf `--color-ecosystem-topographie` (`#7a6c5e`) zurück — genau den Gebirgston. Eine Insel,
  die aussieht wie ein Gebirge, wäre schlechter als der heutige Zustand.
  Der Ton ist ein sandiges Beige-Oliv: liest sich als *Land* gegen `see` (`#4a86b8`) und `meer`
  (`#2d5f8a`) und ist von `gebirge` (`#7a6c5e`) und `hochebene` (`#9a9b82`) unterscheidbar.
- `inselgruppe` bekommt **keinen** Token. Der Rückfall ist das derographische Grau (`#575757`),
  und für einen Behälter ist das richtig — die Derographie „draws administrative CONTAINERS (grey,
  and unfilled while it rests)" (`css/base/tokens.css:163–169`).

### Reisezeiten

`offroad_factor` bleibt für beide bei `1.00`, also **kein** Eintrag in der V11-Liste
(`ecosystem.php:690–704`). Auf einer Insel zu stehen kostet keine Reisezeit; was sie kostet, ist
das Wasser drumherum, und das ist V13s Sache.

`affects_paths` bleibt `1`. Die Ausnahmeliste nennt `meer`, `kontinent`, `kueste`
(`ecosystem.php:478–480`) und filtert über `type_key`, ohne `kind` — der Ebenenwechsel berührt
sie nicht.

---

## 4. Der Umzug der 251 Flächen

### Reihenfolge, und warum sie tragend ist

1. Typzeile `(topographie, insel)` säen.
2. `UPDATE ecosystem_region SET kind = 'topographie' WHERE kind = 'derographisch' AND region_type = 'insel'`
3. `(derographisch, insel)` auf `is_active = 0`.

Umgekehrt fällt jeder Speichervorgang an einer Insel auf 400: `avesmapsEcosystemAssertRegionType`
(`ecosystem.php:1200`) prüft das Paar `(kind, region_type)` gegen eine **aktive** Zeile, und ohne
Schritt 1 gibt es die Zielzeile nicht.

Es entsteht **keine Kopie**. Dieselben Zeilen wechseln die Ebene — Umrisse, `public_id`,
`geometry_revision` und die verbundenen Beschriftungen (`label_public_id`) bleiben unangetastet.

### Wo der Umzug läuft

In `avesmapsEcosystemEnsureTables()` (`ecosystem.php:166`), als **eigener Schritt mit eigenem
Wächter**. Das ist das Muster, mit dem `affects_paths` und `offroad_factor` nachgerüstet wurden,
und die Begründung steht dort zweimal wörtlich: ein geteiltes „war etwas neu?"-Flag würde das
Terrain-Seed erneut fahren und **jeden Wert zurücksetzen, den der Owner seither angepasst hat**.

- 💣 **Kein DDL in diesem Schritt.** Ein `ALTER` committet die umgebende Transaktion still
  (siehe `ecosystem.php:1118` und `docs/`-Notiz zur DDL-in-Transaktion-Falle). Der Umzug ist reines
  DML und braucht keine Schemaänderung.
- Der Wächter ist **kein Flag**, sondern die Frage selbst: ein `SELECT 1 … WHERE kind='derographisch'
  AND region_type='insel' LIMIT 1`. Ist nichts da, passiert nichts. Damit ist der Schritt von sich
  aus wiederholbar und schaltet sich nach dem ersten Lauf selbst ab, ohne dass eine zweite Wahrheit
  über „lief schon" entsteht.
- Eine *neue* `derographisch/insel`-Region kann danach niemand mehr anlegen: die abgeschaltete Art
  wird von `avesmapsEcosystemAssertRegionType` abgelehnt (`is_active = 1` ist Teil der Bedingung).
  Der Umzug ist also einbahnig und kann nicht „nachwachsen".

⚠️ `api/app/ecosystem-areas.php` — der öffentliche Lesepfad — ruft `EnsureTables` **nicht** auf.
Der Umzug läuft folglich bei der ersten **Editor**-Handlung nach dem Deploy, nie durch einen
Kartenbesucher. Das ist gewollt und bleibt so.

### Danach

**🔧 Owner:** einmal „Zugehörigkeit rechnen" drücken. Die Weg×Fläche-Zuordnung ist ein abgeleiteter
Cache und kennt die Ebene (`ecosystem.php:466 ff.`).

---

## 5. Der eigentliche Gewinn: die Wiki-Unterscheidung

Heute fällt im Wiki **`Art=Insel` und `Art=Inselgruppe` beides auf `insel`**
(`api/_internal/wiki/regions.php:95`). Die Unterscheidung, die das Wiki macht, wirft Avesmaps weg.

Künftig:

```php
'Insel' => 'insel', 'Inselgruppe' => 'inselgruppe',
```

Der JS-Spiegel zieht mit (`js/review/review-label-wiki.js:17`, `LABEL_WIKI_ART_TO_SUBTYPE`) —
Server und Client dürfen sich hier nicht widersprechen, sonst tut die ↻-Taste „Kategorie aus der
Wiki-Landschaft übernehmen" bei genau diesen Labels nichts.

⭐ **Schöne Nebenwirkung, und sie ersetzt jedes Namensraten:** die Typ-Konflikt-Liste im Editor
zeigt danach von selbst, welche Labels das Wiki „Inselgruppe" nennt. `avesmapsWikiRegionTypeConflict`
(`regions.php:85`) vergleicht gespeicherten Subtyp gegen erwarteten — ein Label mit
`Art=Inselgruppe` und Subtyp `insel` wird damit sichtbar und wandert über die normale
Editor-Übernahme. Genau so wurden die Vulkan- und Tal-Fälle abgearbeitet.

⚠️ **Erwartete Folge: eine Handvoll neue Typ-Konflikte nach dem Deploy. Das ist gewollt, kein
Fehler.** Die Zahl ist **nicht gemessen** — `wiki_region_staging` ist nicht öffentlich lesbar. Wer
sie vorab wissen will, zählt im Editor `Art = Inselgruppe`.

`INFO_HEADER_IMAGE_BY_ART` (`js/ui/popups.js:223`) bleibt unverändert: `insel: "insel",
inselgruppe: "insel"` ist dort eine Zuordnung **Wiki-Art → Kopfgrafik**, kein Subtyp-Mapping. Eine
Inselgruppe soll weiter das Insel-Kopfbild bekommen.

---

## 6. `inselgruppe` als Beschriftungs-Kategorie

Erzwungen, nicht optional: `ecosystem-geometry-test.php:225` prüft für **jede** Seed-Zeile
`avesmapsReadLabelSubtype($typeKey) === $typeKey`. Eine neue Art ohne Label-Subtyp lässt den Test
scheitern — richtig so, denn Label-Subtyp und Art sind **ein** Vokabular ohne Übersetzungstabelle
(`js/map-features/map-features-ecosystem-label-writeback.js:50–53`: „Der Subtyp des Labels IST der
Art-Schlüssel der Region … Keine Übersetzungstabelle — die wäre die zweite Wahrheit").

Schablone ist `vulkan` (2026-07-27), der jüngste neue Subtyp **mit** Wiki-Art:

| Datei | Was |
|---|---|
| `api/_internal/map/features.php:820` | `inselgruppe` in `$allowedSubtypes` |
| `api/_internal/wiki/regions.php:95` | `'Inselgruppe' => 'inselgruppe'` |
| `api/app/map-search.php:487` | Anzeigename |
| `api/app/report-location.php` | `'inselgruppe' => ['type' => 'label', 'subtype' => 'inselgruppe']` |
| `index.html` (2×) | Meldeformular **und** Label-Editor-Auswahlliste |
| `js/app/i18n-en.js` | `report.typeOption.inselgruppe` + `spotlight.labelType.inselgruppe` |
| `js/review/review-label-wiki.js:17` | JS-Spiegel der Wiki-Art-Tabelle |
| `js/review/review-panels.js:648` | Anzeigename |
| `js/ui/spotlight-search.js:728` | Anzeigename |
| `css/features/map-labels.css` | Label-Stil |
| `js/map-features/map-features-ecosystem-draw.js:396` | `ECOSYSTEM_LABEL_STYLE_BY_TYPE` |

Label-Stil für `inselgruppe`: **wie `insel`** — `{ size: 20, minZoom: 2 }`. Eine Gruppe ist
mindestens so groß wie ihre größte Insel, und die Tabelle folgt ausdrücklich der Größe des Dings.

🪤 **Anders als bei `tal` (Fall #51) ist KEINE Umschlüsselung von Altlabels nötig.** `inselgruppe`
ist neu; kein bestehendes Label trägt ihn. Die vorhandenen `insel`-Labels bleiben `insel` — der
Schlüssel wandert mit der Art in die Topographie, er ändert sich nicht.

---

## 7. Was NICHT angefasst wird — jeweils mit Beleg

| | Warum sicher |
|---|---|
| **Die 251 Beschriftungen** | `ECOSYSTEM_LABEL_STYLE_BY_TYPE` hängt am `type_key`, nicht am `kind`. `insel: { size: 20, minZoom: 2 }` gilt unverändert weiter. |
| **Der Routenplaner / V13 Wasser** | `AVESMAPS_ROUTE_WATER_REGION_TYPES = ['meer', 'see']` (`api/_internal/routing/water-areas.php:55`), und die Query filtert auf `region_type` **ohne** `kind`. Der Kommentar nennt `insel` ausdrücklich als Nicht-Wasser. |
| **Reisezeiten** | kein `offroad_factor`, kein `affects_paths`-Wechsel (§3). |
| **`INFO_HEADER_IMAGE_BY_ART`** | Wiki-Art → Kopfgrafik, nicht Subtyp (§5). |
| **Der öffentliche Lesepfad** | ruft `EnsureTables` nicht auf (§4). |

### 🔴 Der Umzug muss `ecosystem_revision` selbst heben

**Geprüft:** `avesmapsNextEcosystemRevision()` (`ecosystem.php:735`) wird ausschließlich von den
Schreib-Aktionen gerufen (11 Stellen, alle in Aktions-Handlern). **`EnsureTables` hebt die Revision
nie.** Ein `UPDATE` von dort aus ändert also die Daten, ohne den Zähler zu bewegen.

Der ETag von `api/app/ecosystem-areas.php` ist aus `ecosystem_revision × bbox × Payload-Version`
gesät. Ohne Bump bekäme jeder warme Client eine 304 und **malt die Inseln weiter grau in der
derographischen Ebene** — bis irgendwann eine unverwandte Bearbeitung den Zähler hebt. Genau der
Fehler, den der Kommentar zu Payload-Version 4 beschreibt („Measured right after the deploy: the
plain request answered `false` while a cache-busted one answered `true`").

**Also: der Umzugsschritt endet mit einem `avesmapsNextEcosystemRevision($pdo)`.** Eine Zeile, und
sie läuft innerhalb des Wächters, also genau einmal.

Ein **Payload-Versionsschritt** (`AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION`, derzeit 5) ist damit **nicht**
nötig: die Form der Antwort bleibt gleich, und der Revisionszähler ist für eine Wertänderung das
richtige Werkzeug. Der Versionsschritt war 2026-07-28 nur deshalb der Ausweg, weil man den Zähler
dort nicht heben konnte.

---

## 8. Verworfen, mit Begründung

| Verworfen | Warum |
|---|---|
| **`insel` in `inselgruppe` umbenennen** | trifft 5 von 251; würde 246 einzelne Inseln falsch beschriften (§2). |
| **Ebenen-Auswahlfeld im Regionsdialog** | Es gibt „Senden an" (V3.6) schon, und es wurde genau dafür gebaut: Zielebene wählbar, Art-Auswahl aus dem Vokabular der **Ziel**ebene, startet leer. Für ~5 Flächen ist ein neues Bedienelement nicht zu rechtfertigen. |
| **Umzug an einen Knopf hängen** | Wäre nötig gewesen, um den Bestand *vor* dem Umzug umzuwidmen. Entfällt, weil `inselgruppe` leer startet (§1). |
| **Zusätzliche derographische Zwillinge für große Inseln** (Maraskan, Hjalland, …) | Owner: der Geländesatz reicht. „Die Route führt durch Maraskan" darf ein Geländesatz sein. |
| **Kandidaten per Namensmuster bestimmen** | `Hjalland`/`Kaiser-Raul-Land`/`Yeti-Land` wären Fehltreffer, `Bilku-Archipel` bräuchte kein Muster. Das Wiki liefert die Wahrheit über die Konflikt-Liste (§5). |
| **`Senden an` in Masse für die 251** | Es **kopiert**. 251 Kopien wären 502 Flächen, die alten lägen weiter auf der Derographie. Und der Code sagt ausdrücklich: kein `copy_area`, kein `copy_regions`. |

---

## 9. Prüfung

`api/_internal/app/__tests__/ecosystem-geometry-test.php` nagelt die Zahlen absichtlich fest
(„The number is meant to MOVE when a type is deliberately added") und wird mitgezogen:

| | vorher | nachher |
|---|---|---|
| Seed-Zeilen | 25 | **26** |
| `derographisch` | 4 | 4 |
| `topographie` | 11 | **12** |
| `vegetation` | 10 | 10 |

`api/_internal/wiki/__tests__/region-art-parsing-test.php` bekommt die Gegenstücke zu den
Vulkan-Zeilen:

```php
assert(avesmapsWikiRegionArtToSubtype('Insel') === 'insel');
assert(avesmapsWikiRegionArtToSubtype('Inselgruppe') === 'inselgruppe');
assert(avesmapsWikiRegionTypeConflict('insel', 'Inselgruppe') === true);   // der neue Konflikt
assert(avesmapsReadLabelSubtype('inselgruppe') === 'inselgruppe');
```

```bash
php -d zend.assertions=1 api/_internal/app/__tests__/ecosystem-geometry-test.php
```

```bash
php -d zend.assertions=1 api/_internal/wiki/__tests__/region-art-parsing-test.php
```

💣 **Ohne `-d zend.assertions=1` prüft `assert()` NICHTS** und der Test ist grün, egal was drinsteht.

Der Umzug selbst ist mit `pdo_sqlite` testbar, weil er reines DML ist:
`php -d extension=php_pdo_sqlite.dll` gegen `sqlite::memory:` — Zeilen mit beiden Ebenen anlegen,
den Schritt fahren, prüfen dass genau die `derographisch/insel`-Zeilen gewandert sind und ein
zweiter Lauf nichts mehr tut.

### Sichtprüfung nach dem Deploy

1. `GET /api/app/ecosystem-areas.php?cb=<random>` — **eine** Anfrage, nicht in der Schleife
   (STRATO-Worker). Erwartet: `topographie|insel = 251`, `derographisch|insel = 0`.
2. Im Editor: Reiter „Topographie" listet die Inseln, „Derographische Region" nicht mehr.
   Die Art-Auswahl einer derographischen Region bietet „Inselgruppe" an und „Insel" nicht mehr.
3. Auf der Karte: Inseln in `#b2a273`, nicht im Gebirgston.

---

## 10. Owner-Handgriffe

| | |
|---|---|
| **🔧 nach dem Deploy** | einmal „Zugehörigkeit rechnen" |
| **🔧 laufend, ohne Eile** | die Typ-Konflikte „Inselgruppe" abarbeiten; wer eine Fläche wirklich umwidmen will: „Senden an → Derographische Region", Art „Inselgruppe", danach die Topographie-Insel löschen |
| **🔧 optional** | Farbton `#b2a273` auf der Karte beurteilen — ein Wert in einer Zeile |

---

## 11. Verwandtes

- `docs/oekosystem-feature-design.md`, `docs/superpowers/plans/2026-07-24-landschaften.md` — die Ebene selbst
- `docs/oekosystem-editor-verhalten.md` §7d — Auto-Name zieht mit der Art
- Fall #51 („Tal") — der Vergleichsfall **mit** Umschlüsselung; hier bewusst keine
- `AGENTS.md` §2 (Domänenvokabular bleibt deutsch), §5 (Datenmodell), §12 (Designsprache)
