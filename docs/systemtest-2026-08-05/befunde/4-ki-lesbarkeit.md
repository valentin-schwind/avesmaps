# Agent 4 — Lesbarkeit des Codes durch KI-Agenten

## Kern

1. **13 globale Namen definieren auf `index.html` zwei Dateien** (24 im ganzen `js/`); neun tragen einen
   Warnhinweis, **vier nicht**. Beim Schlimmsten ist der GEWINNER kommentarlos und der VERLIERER trägt
   einen Kommentar, der einen dritten, falschen Gewinner nennt — wer ihm folgt, pflegt toten Code. **(B2, B11)**
2. **`js/routing/route-priority-queue.js`** ist ein 63-zeiliger Dijkstra-Min-Heap und injiziert in den letzten
   14 Zeilen einen **Regionen-Polygon-Editor**, der 6 `map-features`-Globals überschreibt. **(B4)**
3. **AGENTS.md selbst hat 5 falsche Zahlen**: 117→**229** Tags, ~50→**103** Module, ~14→**47** Inline-DDL-
   Tabellen, 6→**8** `entity_type`, plus eine längst behobene Perf-Falle. Faktor 2–3 daneben. **(B20)**
4. **Das prominenteste 💣 („Quellen leben an EINER Stelle") steht in keiner der beiden Dateien, die es
   betrifft** (0 Marker) — es schützt den nicht, der per Grep dort landet. **(B19)**
5. **205 Testdateien, 0 laufen beim Deploy** (reiner SFTP-Upload); ein PHP-Test ist auf `master` **rot**. **(B24)**
6. **`js/territory/` ist zu 92 % (9.231 Z.) von keinem Test erwähnt.** `territory-editor-embedded.js`:
   3.106 Zeilen, 112 Funktionen, 48 DOM-Ids, **ein** Abschnittsbanner. **(B1, B25)**
7. **Querverweise altern schlecht:** 51/51 `docs/`-Links stimmen, aber **22 `datei:zeile`-Verweise zeigen
   falsch** (bis 344 Z. daneben), und einer verspricht einen Test, den es nicht gibt. **(B14, B17)**

**26 Befunde — 4 AKUT (B2, B11, B19, B24), 22 KANN, 0 ZUKUNFT · 23 BELEGT, 3 PLAUSIBEL · a)1 b)5 c)4 d)8 e)2 f)3 g)3**

---

## a) Dateigrößen und Verantwortlichkeiten

**Gesamtbild** (`work/bigfiles.js`, ohne `js/third-party/`, `__tests__`, `.claude/worktrees`):

| | Dateien | Zeilen | Median | ≥1000 Z | ≥500 Z | Top-10 |
|---|---|---|---|---|---|---|
| `js/` | 234 | 90.863 | 251 | 17 | 59 | 19,2 % |
| `api/` | 229 | 92.581 | 207 | 24 | 56 | 23,0 % |

Der Median ist gesund. Das Problem sitzt am Rand.

**Was ein Agent tatsächlich laden muss** (Zeichen ÷ 4):

| Datei | Zeilen | ≈ Token |
|---|---|---|
| `index.html` | 2.542 | **55.300** |
| `api/_internal/app/ecosystem.php` | 3.645 | **47.700** |
| `js/review/review-wiki-sync.js` | 3.544 | **42.100** |
| `api/_internal/map/features.php` | 3.042 | 34.000 |
| `js/territory/territory-editor-embedded.js` | 3.106 | 27.100 |

`index.html` ist laut AGENTS.md §3 „ein Vertrag" — ihn zu prüfen kostet 55k Token.

### B1 Die zehn größten Dateien tragen 5–16 unabhängige Verantwortlichkeiten
- **Kategorie:** KANN
- **Fundstelle:** `js/review/review-wiki-sync.js` (3.544 Z), `js/territory/territory-editor-embedded.js` (3.106 Z), `api/_internal/app/ecosystem.php` (3.645 Z)
- **Beobachtung:**
  `review-wiki-sync.js` — 98 Funktionen auf oberster Ebene, **44 verschiedene DOM-Ids**, und darin
  mindestens **16 abgeschlossene Themen**: Resolve-Dialog · Konflikt-Dialog · Subjekt-Leiste/Reiter ·
  Territorien-Baum + 4 Filter · „Dump holen"-Schleife · **ein eigenes Selbsttest-Overlay samt
  CSS-Injektion** (`avesmapsDumpReportInjectStyles`, Z. 1064) · Kind-Sync · Publikationen-Sync ·
  Kraftlinien-Sync · Abenteuer-Sync · Kartensammlung-Sync · Lore-Sync · **Lore-Liste mit
  Infinite-Scroll** · **Lore-Detail-Editor (eigenes CRUD)** · Zugangsdaten-Prompt · Sync-Overlay.
  `territory-editor-embedded.js` — 112 Funktionen, 48 DOM-Ids, 4 API-Endpunkte, und **genau ein
  Abschnittsbanner in 3.106 Zeilen** (Z. 1752).
  `api/_internal/app/ecosystem.php` — 67 Funktionen, **14 echte Tabellen**
  (`ecosystem_area`, `_area_heightmap`, `_assignment_stamp`, `_climate_divider`,
  `_geometry_audit_log`, `_region`, `_region_overlap`, `_region_territory`, `_region_type`,
  `_revision`, `map_features`, `path_ecosystem`, `path_terrain`, `path_terrain_stamp`),
  6 Schreib-Aktionen.
- **Erwartet:** Eine Datei, die ein Agent nicht am Stück im Kontext halten kann, sollte an ihren
  Themengrenzen geteilt sein — mindestens aber Abschnittsbanner tragen, damit gezieltes Lesen möglich ist.
- **Beleg:** `node work/bigfiles.js js 10`, `node work/resp.js`;
  `grep -c "^function" js/review/review-wiki-sync.js` → 98;
  `grep -nE "^\s*//\s*[-=]{3,}" js/territory/territory-editor-embedded.js` → **1 Treffer**;
  Tabellen: `grep -ohE "\b(FROM|INTO|UPDATE|JOIN|TABLE IF NOT EXISTS)\s+\`?([a-z]+_[a-z_]+)" api/_internal/app/ecosystem.php | sort -u`
- **Sicherheit:** BELEGT
- **Aufwand:** groß

---

## b) Globale Namen und Schatten — der gefährlichste Punkt

Methode: `work/globals2.js` liest die 214 `<script src>` aus `index.html` in Ladereihenfolge, sammelt
je Datei die Deklarationen in **Spalte 0** plus alle `window.X =` und meldet Namen, die zweimal fallen.
**3.224 globale Namen** insgesamt.

| Umfang | Kollisionen |
|---|---|
| nur von `index.html` geladen | **13** |
| ganzes `js/` (inkl. dynamisch injizierter Dateien) | **24** |

### B2 Vier der 13 Kollisionen sind an der Definitionsstelle nicht markiert
- **Kategorie:** AKUT
- **Fundstelle:** `js/map-features/map-features-feature-dispatcher.js:9`, `js/map-features/map-features-region-tooltip-lifecycle.js:171`, `js/map-features/map-features-political-region-visibility.js:1`, `js/review/review-wiki-sync.js:3420`
- **Beobachtung:** Neun Kollisionen tragen einen ordentlichen Hinweis (`setMapStyle`, `updateMapView`,
  die fünf Drag-Fassaden, `startWikiSyncTerritoryRun`-Quelle, `syncRegionVisibility`-Loader). Vier nicht:
  - **`applyPoliticalTerritoryDerivedBoundaryVisibility`** existiert **dreimal**:
    `political-territory-loader.js:229` (Pos 163) → `feature-dispatcher.js:9` (Pos 172) →
    `derived-boundary-runtime-fix.js:47` (dynamisch injiziert). Die **gewinnende statische** Fassung
    in `feature-dispatcher.js` hat **keinen Kommentar und keinen Dateikopf**.
  - **`pointInRing`** — zwei Fassungen, **beide** dokumentieren ihre eigene Koordinatenkonvention, als
    wären sie allein: `region-tooltip-lifecycle.js:171` sagt „pt und ring in Leaflet-[y,x]",
    `point-in-polygon.js:4` sagt „Coordinates are GeoJSON [lng, lat]". Letztere gewinnt.
  - **`syncRegionVisibility`** — der Hinweis steht in `political-region-visibility.js` auf **Zeile 47**,
    mitten im Funktionsrumpf. Zeile 1 ist `function syncRegionVisibility() {` — ohne jede Warnung.
  - **`startWikiSyncTerritoryRun`** in `review-wiki-sync.js:3420` — kommentarlos.
- **Erwartet:** Jede überschriebene oder überschreibende Definition trägt den Hinweis **direkt darüber**,
  auf beiden Seiten. Ein Agent, der per Grep in einer Datei landet, liest keine Zeile 47.
- **Beleg:** `node work/globals2.js` (13 bzw. 24 Kollisionen, mit Pos + Zeile);
  `sed -n '1,6p' js/map-features/map-features-political-region-visibility.js` → keine Kommentarzeile;
  `sed -n '1,10p' js/map-features/map-features-feature-dispatcher.js` → keine Kommentarzeile.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 `pointInRing`: die defensive Fassung ist tot, die scharfe gewinnt
- **Kategorie:** KANN
- **Fundstelle:** `js/map-features/map-features-region-tooltip-lifecycle.js:171` (Ladeposition 150) vs. `js/map-features/map-features-point-in-polygon.js:4` (Position 164)
- **Beobachtung:** Geometrisch sind beide gleichwertig (ich habe es nachgerechnet: Punkt-in-Polygon ist
  invariant gegen das Vertauschen von x/y, solange Punkt UND Ring gleich vertauscht sind — 0 Abweichungen
  über 4 Testfälle). **Robustheit ist es nicht:** die Verliererin fängt `null`, Nicht-Arrays und
  Ringe < 3 Punkte ab und liefert `false`; die Gewinnerin wirft dort `TypeError`.
  `region-tooltip-lifecycle.js` ruft `pointInRing` an zwei Stellen (Z. 112, Z. 209) im Vertrauen auf
  Wächter, die zur Laufzeit nicht existieren.
- **Erwartet:** Eine Implementierung. Wer die Datei bearbeitet, in der `pointInRing` steht, muss sehen,
  dass seine Änderung folgenlos ist.
- **Beleg:** `node work/pir.js` — Ausgabe: „Geometrische Abweichungen bei gueltiger Eingabe: 0";
  `A(null, quadrat) = false | B = WIRFT: TypeError`.
  Aufrufer: `grep -rn "pointInRing(" js/` → `region-tooltip-lifecycle.js:112`, `:209`.
- **Sicherheit:** BELEGT (Semantik nachgerechnet; ein realer Absturz ist nicht nachgewiesen — die
  Aufrufer prüfen selbst vor)
- **Aufwand:** klein

### B4 Ein Dijkstra-Min-Heap injiziert den Regionen-Polygon-Editor
- **Kategorie:** KANN
- **Fundstelle:** `js/routing/route-priority-queue.js:65–77`
- **Beobachtung:** Die Datei ist 77 Zeilen: Zeile 1–63 `class PriorityQueue` (Min-Heap für Dijkstra),
  Zeile 65–77 eine IIFE `loadRegionVertexDetachEditHelper()`, die per `setTimeout(…, 0)` ein
  `<script src="js/map-features/map-features-region-vertex-detach-edit.js">` in den `<head>` hängt.
  Diese injizierte Datei überschreibt danach **sechs** `map-features`-Globals:
  `createRegionHandleIcon`, `refreshRegionEditHandles`, `clearRegionGeometryEdit`,
  `handleRegionEditClick`, `handleRegionEditKeyUp`, `handleRegionEditMouseMove`, `handleRegionEditMouseOut`.
- **Erwartet:** Der Lader gehört zu `map-features`, nicht ins Routing. Ein Agent, der „wo wird
  `clearRegionGeometryEdit` überschrieben?" sucht, sucht nicht in `js/routing/`.
- **Beleg:** `sed -n '65,77p' js/routing/route-priority-queue.js`;
  `grep -rn "region-vertex-detach-edit" js/` → einziger Lader ist `route-priority-queue.js:73`;
  `node work/globals2.js all` listet die 6 überschriebenen Namen.
  Immerhin: die überschriebenen Stellen tragen Warnkommentare (`region-edit-handles.js:2`,
  `region-geometry-edit-lifecycle.js:6`, `region-edit-edge-controls.js:2`) — sie nennen die
  Injektionsquelle korrekt.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B5 Fünf dynamisch injizierte Skripte stehen in keiner Ladereihenfolge
- **Kategorie:** KANN
- **Fundstelle:** `js/map-features/map-features-political-territory-repository.js:89–118`, `js/routing/route-priority-queue.js:73`, `js/review/review-visitor-analytics.js:207`
- **Beobachtung:** Fünf JS-Dateien werden zur Laufzeit nachgeladen und stehen daher **nicht** in
  `index.html`: `territory-derived-geometry-editor.js` (steht dort zusätzlich, Z. 2294 —
  Doppellade-Wächter per `querySelector('script[src*=…]')` greift),
  `map-features-derived-boundary-context-action.js`, `map-features-derived-boundary-runtime-fix.js`,
  `map-features-region-vertex-detach-edit.js`, `map-features/de-bundeslaender-geo.js`.
  Wer die Ladereihenfolge aus `index.html` liest — was AGENTS.md §3 als *den* Weg nennt —, sieht
  keine davon, obwohl sie **nach allen anderen** laufen und daher jede Kollision gewinnen.
- **Erwartet:** Ein Hinweis in `index.html` an der Stelle, wo diese Dateien stehen müssten, oder eine
  Liste in AGENTS.md §3.
- **Beleg:** `grep -rn 'script\.src\s*=\s*"' js/ --include=*.js | grep -v third-party` → 5 Treffer;
  `node work/globals2.js` (13) gegen `node work/globals2.js all` (24) — die Differenz von 11
  Kollisionen entsteht ausschließlich durch diese Dateien.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 82 % der Skript-Tags haben keine Erklärung ihrer Position
- **Kategorie:** KANN
- **Fundstelle:** `index.html`
- **Beobachtung:** 215 `<script src>`-Tags. **39** haben einen HTML-Kommentar in Reichweite
  (gleiche Zeile oder 3 Zeilen davor), davon **27** mit echter Reihenfolge-Begründung
  („MUSS vor …", „LOAD-BEARING ORDER", „Reihenfolge innerhalb der Gruppe ist tragend").
  **176 Tags (82 %) sind unkommentiert.** Die vorhandenen 27 sind allerdings vorbildlich — sie nennen
  Grund und Folge (z. B. Z. 2320: „Sie stand bis 2026-07-23 unter beiden; das Listenmodul waere beim
  ersten Laden mit einem ReferenceError komplett ausgefallen").
- **Erwartet:** Nicht jeder Tag braucht einen Kommentar — aber jeder, dessen Position tragend ist.
  Heute kann ein Agent nicht unterscheiden, ob eine Position frei wählbar oder Vertrag ist.
- **Beleg:** Zählskript in `work/` (inline `node -e`), Ausgabe:
  `script-Tags: 215 / mit Kommentar: 39 / davon Reihenfolge: 27 / ohne: 176 = 82%`
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

---

## c) Namensgebung

### B7 `kind` trägt mindestens fünf unabhängige Wertebereiche
- **Kategorie:** KANN
- **Fundstelle:** `api/_internal/app/ecosystem.php:72`, `api/_internal/app/lore.php:28`, `api/app/feature-sources.php:36`
- **Beobachtung:**
  - Landschaften-**Ebene**: `AVESMAPS_ECOSYSTEM_KINDS = ['derographisch','vegetation','topographie','klima']`
  - Lore-**Kategorie**: `AVESMAPS_LORE_KINDS = ['flora','fauna','spezies','ware']`
  - Element-**Gattung**: `settlement|region|path|territory|citymap|…` (dort `entity_type` genannt,
    aber im Payload teils als `kind` transportiert)
  - Treffergüte im WikiSync: `exact|unresolved`
  - Griff-Art im Regionen-Editor: `vertex|single|range|all`

  Zählung über `api/` + `js/`: 12 verschiedene Feldnamen für „was für ein Ding ist das":
  `type(211) kind(68) subtype(54) feature_type(53) category(49) art(27) entity_type(13) type_key(11)
  region_type(6) place_kind(3) source_type(3) location_type(2)`.
- **Erwartet:** `kind` ohne Präfix ist für einen Agenten nicht auflösbar. Die Domänen wären an sich
  unterscheidbar (`ecosystem_kind`, `lore_kind`) — die Spaltennamen sind aber Datenvertrag und nicht
  einfach umbenennbar. Ein Glossarabschnitt in AGENTS.md §2 kostet nichts und schließt die Lücke.
- **Beleg:** `node work/naming.js`; `sed -n '72p' api/_internal/app/ecosystem.php`;
  `sed -n '28p' api/_internal/app/lore.php`
- **Sicherheit:** BELEGT
- **Aufwand:** klein (Glossar) / groß (Umbenennung — nicht empfohlen)

### B8 `type` bedeutet in EINER Datei fünf verschiedene Dinge
- **Kategorie:** KANN
- **Fundstelle:** `api/app/map-features.php` — Z. 193/430/499, 563, 633, 817/834/849, 881/998
- **Beobachtung:** Derselbe JSON-Schlüssel `type` transportiert im Kartenpayload:
  | Zeile | Bedeutung | Wertebeispiel |
  |---|---|---|
  | 193, 430, 499 | GeoJSON-Struktur | `FeatureCollection`, `Feature` |
  | 563 | Bauwerksart | `$row['building_type']` |
  | 633 | Territoriumsart | `wiki_type` ?: `territory_type` |
  | 817, 834, 849 | Kettenknoten-Art (Hierarchie) | `$chainNode['type']` |
  | 881, 998 | Quellenart | `source_type`, `'sonstiges'` |
  Danebenstehen `feature_type` und `feature_subtype` (Z. 453/454) als *dritte* Konvention.
- **Erwartet:** Ein Agent, der `properties.type` liest, muss aus dem Namen ableiten können, welcher
  Wertebereich gilt. Heute muss er die Aufbaustelle finden.
- **Beleg:** `grep -n "'type'\s*=>" api/app/map-features.php` und Sichtprüfung der genannten Zeilen
  (`sed -n '191,194p;561,565p;631,635p;815,819p;879,883p' api/app/map-features.php`)
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B9 `art` ist das Label, `art_key` der Schlüssel — vorbildlich markiert, aber nur an 2 von 120 Stellen
- **Kategorie:** KANN
- **Fundstelle:** `js/routing/route-season-ground.js:54`, `api/app/path-landscapes.php:12–13`
- **Beobachtung:** Der aus dem Projektwissen bekannte Fehlgriff ist **gut** abgesichert: 💣-Kommentar
  an der Verbrauchsstelle plus ein Test, der den Server-Ausgang festnagelt
  (`js/routing/__tests__/route-season-ground-apply.test.js:77`). **Das ist die Ausnahme.**
  Im Verhältnis: `'art'` kommt in `api/` **92×** vor, `'art_key'` **1×**; in `js/` `.art` 50×, `.art_key` 1×.
  Dasselbe Muster ohne jede Markierung: `name`(291×) / `name_key`(1×), `type`(211×) / `type_key`(11×).
- **Erwartet:** Wo eine `X`/`X_key`-Paarung existiert, gehört der Hinweis an die Stelle, wo `X` gesetzt
  wird — nicht nur dorthin, wo er einmal wehgetan hat.
- **Beleg:** `node work/naming.js` Abschnitt A; `grep -rn "art_key" api/ js/` → 4 Produktivstellen
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B10 `derographisch` — ein erfundenes Wort als Schlüssel in drei Domänen, ohne Glossareintrag
- **Kategorie:** KANN
- **Fundstelle:** `api/_internal/app/ecosystem.php:72`, `api/_internal/app/citymaps.php:97`, `api/_internal/app/lore.php:546`
- **Beobachtung:** `derographisch` ist kein deutsches Wort (weder „geographisch" noch „chorographisch"
  noch „pedologisch"). Es ist stabiler Datenschlüssel in **drei unverwandten** Vokabularen:
  Landschaften-Ebene (`AVESMAPS_ECOSYSTEM_KINDS`), Kartenart (`AVESMAPS_CITYMAP_ARTS`) und als
  Bezeichnung eines Regionsbezugs in `lore.php`. In AGENTS.md §2 („Domain glossary") steht es **nicht**.
- **Erwartet:** Ein erfundener Begriff, der als Join-Schlüssel dient, gehört ins Glossar — umbenennen
  wäre eine Datenmigration und ist ausdrücklich **nicht** gemeint.
- **Beleg:** `grep -rn "derographisch" api/ js/ css/ index.html html/` → 20 Treffer, 3 Domänen;
  `grep -n "derographisch" AGENTS.md` → 0 Treffer
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## d) Kommentare, die lügen

### B11 Der Kommentar über der Fallback-Kopie nennt den falschen Gewinner
- **Kategorie:** AKUT
- **Fundstelle:** `js/map-features/map-features-political-territory-loader.js:224–228`
- **Beobachtung:** Der Kommentar lautet sinngemäß: die kanonische Laufzeitfassung stehe in
  `map-features-derived-boundary-runtime-fix.js` und gewinne per dynamischer Injektion; **diese**
  statische Kopie sei „only the fallback for the brief async-injection gap" und müsse deshalb dasselbe
  Ergebnis liefern.
  Tatsächlich existiert eine **dritte** statische Fassung in
  `js/map-features/map-features-feature-dispatcher.js:9`, die in `index.html` an **Position 172** steht —
  neun Positionen **nach** dem Loader (163). Sie überschreibt die kommentierte Kopie sofort beim Laden.
  Der beschriebene „Fallback" ist damit **nie aktiv**: in der Injektionslücke gilt die
  Dispatcher-Fassung, danach die injizierte. Wer den Kommentar befolgt und die Loader-Kopie
  synchron hält, pflegt toten Code — und wer sie als „der Fallback" bearbeitet, ändert nichts.
- **Erwartet:** Entweder die Loader-Kopie entfernen, oder der Kommentar nennt den echten Gewinner
  (`feature-dispatcher.js:9`) und die tatsächliche Rangfolge.
- **Beleg:** `sed -n '222,229p' js/map-features/map-features-political-territory-loader.js` (Wortlaut);
  `node work/globals2.js all` →
  `Pos -1 window runtime-fix.js:47 | Pos 163 function loader.js:229 | Pos 172 function feature-dispatcher.js:9 <== gewinnt`;
  `grep -n "map-features-feature-dispatcher.js" index.html` bestätigt die Position.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B12 „Die sieben Klimazonen" — es sind acht
- **Kategorie:** KANN
- **Fundstelle:** `js/routing/routing.js:425`
- **Beobachtung:** Kommentar: „Die sieben Klimazonen-Namen (Nord nach Süd) aus dem Payload."
  Die Saat in `api/_internal/app/ecosystem.php:186–207` enthält **acht** `['klima', …]`-Zeilen
  (`polar, subpolar, boreal, gemaessigt, subtropen_winterfeucht, trockene_subtropen, subtropisch,
  tropisch`). AGENTS.md §11 sagt ebenfalls „heute acht". Die achte (`trockene_subtropen`,
  `sort_order 55`) wurde nachträglich eingeschoben — genau der Fall, den AGENTS.md als
  „die Zahl ist **Daten**, nicht Code" beschreibt. Der Code ist korrekt (er reicht das Array durch);
  nur der Kommentar hat die Zahl festgeschrieben.
- **Erwartet:** „Die Klimazonen-Namen (Nord nach Süd)" — ohne Zahl. Eine Zahl im Kommentar an einer
  Stelle, die ausdrücklich zahlfrei sein soll, ist eine Zeitbombe mit Datum.
- **Beleg:** `sed -n '425p' js/routing/routing.js`;
  `grep -c "\['klima'," api/_internal/app/ecosystem.php` → **8**
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B13 Der Kopfkommentar von `feature-sources.php` listet 4 `entity_type`, die Prüfung 8
- **Kategorie:** KANN
- **Fundstelle:** `api/app/feature-sources.php:9` gegen `:36`
- **Beobachtung:** Zeile 9: `// GET ?entity_type=<settlement|territory|region|path>&entity_public_id=…`
  Zeile 36: `$allowedTypes = ['settlement','territory','region','path','citymap','lore','powerline','ecosystem'];`
  Vier fehlen im Kopfkommentar — genau der Teil, den ein Agent zuerst liest.
  (Positiv: Zeile 33–34 trägt einen 🔴-Hinweis, dass die Liste mit dem Schreibpfad im Gleichschritt
  bleiben muss. Der ist korrekt und nützlich.)
- **Erwartet:** Kopfkommentar und Prüfung nennen dieselbe Liste — oder der Kopf verweist auf die Prüfung.
- **Beleg:** `sed -n '1,45p' api/app/feature-sources.php`
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B14 Ein Kommentar verspricht einen Test, den es nicht gibt
- **Kategorie:** KANN
- **Fundstelle:** `api/_internal/app/ecosystem.php:1284`
- **Beobachtung:** „Pure so the fallbacks are testable
  (`api/_internal/app/__tests__/ecosystem-area-decoration-test.php`)."
  Der Ordner enthält acht `ecosystem-*`-Tests — **keinen** `ecosystem-area-decoration-test.php`.
  Das ist die teuerste Sorte Falschaussage: ein Agent, der prüft „ist diese Stelle abgesichert?",
  liest den Kommentar, glaubt ja, und ändert die Fallbacks ungebremst.
- **Erwartet:** Test schreiben oder Verweis entfernen.
- **Beleg:** `sed -n '1282,1288p' api/_internal/app/ecosystem.php`;
  `ls api/_internal/app/__tests__/ | grep -i ecosystem` → 8 Dateien, keine mit `decoration`
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B15 Die Verbraucherliste einer Zugriffs-Globalen nennt Verbraucher, die es nicht gibt
- **Kategorie:** KANN
- **Fundstelle:** `js/config.js:309–312`
- **Beobachtung:** Direkt unter einem 💣-Absatz über Riegel und URL-Parameter steht:
  „Die Verbraucher lesen die Globale zum AUFRUFZEITPUNKT (**map-features-display-mode.js:173**,
  …-ecosystem-layer-switch.js:53, …-ecosystem-context-action.js:245/266,
  …-ecosystem-territory-import.js:629/894)".
  `grep -c "IS_ECOSYSTEM_ENABLED" js/map-features/map-features-display-mode.js` → **0**.
  Der erste genannte Verbraucher liest die Globale überhaupt nicht mehr.
  Eine Zugriffsliste an einer Rechte-Stelle, die frei erfundene Verbraucher nennt, ist
  besonders teuer: wer den Riegel prüft, prüft eine Datei, die nichts damit zu tun hat.
- **Erwartet:** Liste nachziehen oder durch einen `grep`-Hinweis ersetzen
  („Verbraucher findest du mit `grep -rn IS_ECOSYSTEM_ENABLED js/`") — eine Liste, die nicht
  gepflegt werden kann, sollte gar nicht erst behauptet werden.
- **Beleg:** `sed -n '305,315p' js/config.js`;
  `grep -c "IS_ECOSYSTEM_ENABLED" js/map-features/map-features-display-mode.js` → 0
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B16 Ein Kommentar nennt einen Standardwert, den die Konstante zwei Zeilen darunter widerlegt
- **Kategorie:** KANN
- **Fundstelle:** `js/map-features/map-features-labels.js:91–93`
- **Beobachtung:** „Stärke des Halos hinter den Regionen-/Landschafts-Titeln (.map-label).
  **Default 0 = kein Halo (bisheriges Verhalten).**"
  Zeile 93: `let REGION_LABEL_HALO_STRENGTH = 1.5;`
  Wer „bisheriges Verhalten" wiederherstellen will, setzt nach diesem Kommentar den falschen Wert.
- **Erwartet:** Zahl aus dem Kommentar streichen (der Wert steht ja daneben) oder nachziehen.
- **Beleg:** `sed -n '88,95p' js/map-features/map-features-labels.js`
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B17 22 Kommentare zeigen auf die falsche Zeile — bis zu 344 Zeilen daneben
- **Kategorie:** KANN
- **Fundstelle:** u. a. `api/_internal/app/ecosystem.php:925`, `api/app/ecosystem-areas.php:14/122/136`, `js/review/review-wiki-sync.js:2759`, `tools/ecosystem/ecosystem_shapes.py:16`, `api/_internal/app/citymaps.php:1896`
- **Beobachtung:** Der `datei.php:zeile`-Querverweis ist im Projekt das Standard-Navigationsmittel
  (Hunderte Vorkommen). **Keine** Referenz zeigt hinter das Dateiende — die Dateien stimmen also —,
  aber **22 zeigen auf eine falsche Zeile**, weil die Zieldatei gewachsen ist. Die vier härtesten:
  - `ecosystem.php:925` verlangt Wort-für-Wort-Gleichlauf mit `avesmapsNextMapRevision`
    (`features.php:2531`) — dort steht `avesmapsRollbackAndRethrow(...)`; die Funktion beginnt
    auf **2875** (Δ 344). Ein Kommentar über zwei Revisionszähler zeigt auf fremden Code.
  - `api/app/ecosystem-areas.php` verweist **dreimal** (Z. 14, 122, 136) auf
    `map-features.php:225-231` für `avesmapsMapFeaturesETag`/`avesmapsETagMatches` — real 333 und
    344. Drei Kommentare an einer Cache-Korrektheitsstelle, alle auf denselben falschen Block.
  - `review-wiki-sync.js:2759` nennt `AVESMAPS_LORE_KINDS` in `lore.php:142` — real **28** (Δ 114).
  - `ecosystem_shapes.py:16` begründet `MIN_RING_POSITIONS = 3` mit `ecosystem.php:414` — dort steht
    ein `SELECT type_key … WHERE kind='klima'`; die echte Prüfung `count($ring) < 3` liegt auf **1113**.
  Zehn weitere Dateiköpfe in `js/map-features/` nennen als Herkunft `js/map-features.js` — die Datei
  wurde in `980c2779` nach `js/map-features/map-features.js` verschoben.
- **Erwartet:** Zeilennummern in Querverweisen sind in einem Repo ohne Build-Schritt nicht haltbar.
  Der Funktionsname allein (`siehe avesmapsNextMapRevision in features.php`) ist grep-bar und altert nicht.
- **Beleg:** Systematische Prüfung aller `datei:zeile`-Referenzen in `js/`, `api/`, `tools/`, `edit/`
  gegen die tatsächliche Definitionszeile; Stichproben selbst nachgestellt
  (`sed -n '1282,1288p' api/_internal/app/ecosystem.php`, `sed -n '305,315p' js/config.js`,
  `sed -n '88,95p' js/map-features/map-features-labels.js`).
- **Sicherheit:** BELEGT für die selbst nachgestellten Fälle (B14–B16 und die vier oben);
  PLAUSIBEL für die Gesamtzahl 22 (automatisch ermittelt, nicht jede einzeln von mir nachgesehen)
- **Aufwand:** mittel

### B18 Zwei tote Pfade im ausführbaren Code — der Smoke-Test kann nicht mehr grün werden
- **Kategorie:** KANN
- **Fundstelle:** `tools/smoke_test.py:29`, `:123`, `:128`; `js/review/review-region-wiki-picker.js:20`
- **Beobachtung:** Nicht Kommentare, sondern laufender Code:
  `smoke_test.py:29` holt `js/map-features.js` per HTTP (seit `980c2779` verschoben → 404),
  `:123` prüft, ob `js/config.js` den String `api/map-features.php` enthält — dort steht
  `api/app/map-features.php`, `grep -c` liefert 0. Der Smoke-Test ist damit dauerhaft rot.
  `review-region-wiki-picker.js:20` verweist auf `api/wiki-sync.php` — laut AGENTS.md §10 auf dem
  Server noch vorhanden („frontend fallback"), im Repo aber seit `177e723b` weg.
- **Erwartet:** `tools/smoke_test.py` an die Reorganisation nachziehen oder als überholt kennzeichnen.
- **Beleg:** `git show --name-status 980c2779` → `R100 js/map-features.js js/map-features/map-features.js`;
  `grep -c "api/map-features.php" js/config.js` → 0
- **Sicherheit:** PLAUSIBEL (Pfade und Rename selbst geprüft; den Smoke-Test habe ich **nicht**
  ausgeführt — er würde Live-Anfragen stellen, die hier verboten sind)
- **Aufwand:** klein

**Gegenprobe — was NICHT lügt:** Alle 51 `docs/`-Verweise existieren. **TODO/FIXME/HACK/XXX: 0**
im gesamten Produktivcode (meine 10 Rohtreffer sind eine lokale Python-Variable `todo` und ein
`?key=wiki:xxx`-Beispiel). Die fünf `cleanup-audit-2026-06-27`-Kommentare über Laufzeit-Overrides
stimmen — bis auf den einen aus B11.

---

## e) Fallen, die nur in AGENTS.md stehen

Methode: `work/traps.sh` — für jede 💣-Falle aus AGENTS.md die genannte Datei öffnen und prüfen,
ob dort ein Warnhinweis steht.

**Gut abgesichert** (Falle steht im Code, oft ausführlicher als in AGENTS.md):
`offroad-grid.php` (17 Marker), `land-areas.php` (7), `ecosystem.php` (41), `db-dump.php` (5),
`climate-membership.php` (4), `keyboard-shortcuts.js` (4), `ecosystem-layer.css` (9),
`map-features.php` (3, mit ausdrücklichem „💣 $climateStamp IS NOT DECORATION"),
`ascii-fold.php` (1), `changelog-dialog.css` (1). Insgesamt tragen **99 Dateien** in `js/`+`api/`
mindestens ein 💣/⚠️.

### B19 Das prominenteste 💣 aus AGENTS.md steht in keiner der beiden Dateien, die es betrifft
- **Kategorie:** AKUT
- **Fundstelle:** `api/edit/map/feature-sources.php`, `api/app/feature-sources.php`
- **Beobachtung:** AGENTS.md §5 widmet der Regel „**Sources live in ONE place. Never build a second
  source system.**" 19 Zeilen mit ausgezählten Kosten des einmaligen Verstoßes (Lore, 2026-07-21/22).
  Sie nennt ausdrücklich die beiden Dateien, in denen die `entity_type`-Whitelist steht.
  In **beiden** Dateien: `grep -c "💣\|⚠️"` → **0**. Kein Hinweis, dass diese Liste die
  Erweiterungsstelle *ist*. Ein Agent, der per Grep nach `CREATE TABLE` oder nach seinem Feature
  sucht und in einer dieser Dateien landet, erfährt nichts.
  (Die kleinere Schwester-Regel — Lese- und Schreibliste im Gleichschritt halten — **ist** im Code
  markiert, `api/app/feature-sources.php:33`. Das zeigt: die Stelle ist bekannt, nur die große Regel
  fehlt dort.)
- **Erwartet:** Zwei Kommentarzeilen über `$allowedTypes` in beiden Dateien: „Eine neue Gattung ist
  EIN Eintrag hier — nie eine eigene `<feature>_source`-Tabelle (AGENTS.md §5)."
- **Beleg:** `bash work/traps.sh` → beide Dateien „Datei enthaelt 💣/⚠️: 0";
  `head -32 api/edit/map/feature-sources.php` (keine Warnung);
  `sed -n '1,45p' api/app/feature-sources.php` (🔴 nur zur Gleichschritt-Regel)
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B20 AGENTS.md hat fünf messbar falsche Zahlen
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md` §1 Z. 16, §3 Z. 63, §5 Z. 122/136, §10 Z. 254, §10 Z. 259
- **Beobachtung:**
  | AGENTS.md sagt | tatsächlich | Beleg |
  |---|---|---|
  | „~117 `<script>`/`<link>` tags" | **229** (214 script + 15 link) | `grep -c "<script[^>]*src=" index.html` = 214; `grep -c "<link[^>]*href=" index.html` = 15 |
  | `js/map-features/` „~50 modules" | **103** | `ls js/map-features/*.js \| wc -l` |
  | `entity_type` ∈ 6 Werten (2× genannt) | **8** (+`powerline`, +`ecosystem`) | `api/app/feature-sources.php:36` |
  | „~14 tables exist only as inline PHP DDL" | **47** | `comm -23` über die `CREATE TABLE`-Namen aus `api/` gegen `sql/`; Stichprobe `conflict_decision`, `ecosystem_area`, `wiki_publication_catalog` je nur in PHP |
  | `territories-endpoint.php` „runs DDL + metadata probes **before its cache read** on every political-layer request" | Es gibt seither einen Fast-Path **vor** dem PDO | `api/_internal/political/territories-endpoint.php:41–60`: „Serve the prebuilt JSON straight from cache before opening the PDO" — DDL nur noch bei Cache-Miss |
  Korrekt geprüft und **richtig**: Leaflet 1.9.4, `map_feature_relations`/`map_proposals` nur in `sql/`
  (totes Schema), Koordinatenkonvention.
  Zusatz: §10 nennt den Pfad als `territories-endpoint.php`, die Datei liegt unter
  `api/_internal/political/` — mit dem Namen allein findet man sie, mit einer Pfadannahme nicht.
- **Erwartet:** Das Onboarding-Dokument ist das Erste, was jeder Agent liest. Eine Zahl, die um
  Faktor 2–3 danebenliegt, kalibriert jede Folgeschätzung falsch — und die als offen beschriebene
  Perf-Falle lädt zu einer zweiten Reparatur derselben Stelle ein.
- **Beleg:** siehe Tabelle; alle Befehle selbst ausgeführt
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## f) Sprachmischung

AGENTS.md §8: UI-Strings bleiben **deutsch**; Kommentare, Doku und **interne API-Fehler-`message`s**
werden **englisch** („going forward"); Domänenbegriffe (§2) bleiben deutsch.

**Kommentarzeilen, 463 Produktionsdateien, 33.280 Kommentarzeilen** (22 % fallen in keine der beiden
Wortlisten und sind nicht zugeordnet):

| Bereich | DE | EN | DE-Anteil |
|---|---:|---:|---:|
| **`js/` gesamt** | 8.775 | 4.202 | **68 %** |
| `js/map-features` | 5.343 | 1.820 | 65 % |
| `js/routing` | 1.005 | 310 | 62 % |
| `js/territory` | 425 | 130 | 61 % |
| `js/review` | 1.242 | 1.076 | 45 % |
| `js/app` / `js/ui` | 556 | 793 | 36 % / 32 % |
| **`api/` gesamt** | 2.646 | 9.733 | **21 %** |
| `api/_internal` | 2.223 | 8.316 | 14 % |
| `api/edit` | 161 | 996 | 11 % |
| **Summe** | **11.459** | **14.015** | **34 %** |

### B21 Die Sprachgrenze läuft zwischen Frontend und Backend, nicht zwischen alt und neu
- **Kategorie:** KANN
- **Fundstelle:** `js/map-features/` (65 % DE) gegen `api/_internal/` (14 % DE)
- **Beobachtung:** §8 formuliert die Regel als Zeitachse („going forward"). Gemessen ist sie eine
  **Ortsachse**: das Backend hat sie übernommen, das Frontend nicht. `js/map-features/` ist mit 103
  Dateien und 8.272 Kommentarzeilen der größte Block im Projekt — und zu 65 % deutsch kommentiert.
  Die deutschsprachigsten Einzeldateien sind zugleich die jüngsten Baustellen
  (`ecosystem-height-field.js` 391 DE-Zeilen, `review-wiki-sync.js` 371, `ecosystem.php` 397) —
  „going forward" hat dort also **nicht** gegriffen.
- **Erwartet:** Für einen Agenten ist das nicht per se schlecht (er liest beide Sprachen), aber es
  macht die Regel unbrauchbar als Entscheidungshilfe: wer einen neuen Kommentar in
  `map-features-ecosystem-*.js` schreibt, hat 65 % deutsche Nachbarn und eine Regel, die Englisch sagt.
  Entweder die Regel auf „`api/` englisch, `js/` deutsch" konkretisieren oder das Frontend nachziehen.
  Beides ist besser als eine Regel, die zu zwei Dritteln nicht befolgt wird.
- **Beleg:** Zustandsautomat über alle Kommentarzeilen (String-Literale, Heredocs, `<?php`-Grenzen
  korrekt übersprungen), `js/third-party/` und `.claude/worktrees/` ausgeschlossen; Wortlisten-Heuristik
  wie im Auftrag vorgegeben.
- **Sicherheit:** PLAUSIBEL (Heuristik, nicht Sprachidentifikation; 22 % unzugeordnet — die
  Größenordnung ist belastbar, die Nachkommastelle nicht)
- **Aufwand:** groß (Nachziehen) / klein (Regel schärfen)

### B22 §8 widerspricht sich bei den Fehlermeldungen — 654 von 916 sind deutsch, und das ist richtig so
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:198–199` gegen `js/app/api-client.js:5–11`
- **Beobachtung:** §8 verlangt „internal API error *messages*" auf Englisch. Gemessen: **916**
  Message-Strings in `api/`, davon **654 deutsch (71 %)**, 197 englisch.
  Der Grund ist kein Schlendrian: `apiErrorMessage()` in `js/app/api-client.js:5` liest genau dieses
  Feld und gibt es an die Oberfläche weiter — der Kommentar darüber sagt es selbst
  („so the backend shape-flip never surfaces ,[object Object]' **to users**"). Die Aufrufer bestätigen
  es, ihre Fallbacks sind ebenfalls deutsch: `apiErrorMessage(data, "Fehler")`,
  `apiErrorMessage(responsePayload, "Die Meldung konnte nicht gespeichert werden.")`.
  **`error.message` ist deutscher UI-Text, kein internes Protokoll.** Ein Agent, der §8 wörtlich
  befolgt und diese Meldungen übersetzt, verschlechtert die Oberfläche — und verstößt dabei gegen
  den ersten Halbsatz derselben §8.
  Sauber getrennt ist es dort, wo es zählt: `avesmapsServerErrorResponse` (`bootstrap.php:326–329`)
  loggt den echten Ausnahmetext und antwortet nach außen mit `'Internal server error.'`.
  Die Verzeichnisse ohne UI-Bezug sind auch tatsächlich englisch: `api/_internal/routing` 0 % DE,
  `api/discord` 0 %, `api/edit/mail` 0 %.
- **Erwartet:** §8 trennt zwei Dinge, die heute einen Namen haben: `error.message` **ist** UI und
  bleibt deutsch; englisch gehören Log-/Exception-Texte, die den Client nie erreichen.
  So gelesen ist die Praxis richtig und nur die Regel falsch formuliert.
- **Beleg:** `sed -n '1,20p' js/app/api-client.js`; `sed -n '320,332p' api/_internal/bootstrap.php`;
  `grep -rn "apiErrorMessage(" js/` → Aufrufer mit deutschen Fallbacks
  (`review-locations.js:798`, `api-client.js:65/72/115/183`);
  916 Messages ausgezählt über `avesmapsErrorResponse` (414), `throw new …Exception` (403),
  `'message' =>` (32), flaches `'error' =>` (67)
- **Sicherheit:** BELEGT für die Kette Server → `apiErrorMessage` → Oberfläche;
  PLAUSIBEL für die 71 %/±2 % (zwei Läufe mit leicht abweichenden Wortlisten: 642 vs. 654)
- **Aufwand:** klein (§8 präzisieren)

### B23 Bezeichner sind fast sauber — 5 gemischte, 0 Umlaute, aber 32 rein deutsche Nicht-Domänen-Namen
- **Kategorie:** KANN
- **Fundstelle:** `js/map-features/map-features-labels.js:480`, `js/map-features/map-features-ecosystem-properties.js:768`, `js/review/review-labels.js:294–312`, `api/_internal/app/ecosystem.php:3306`
- **Beobachtung:** Das befürchtete Bild tritt **nicht** ein. Deutsch/englisch **gemischte** Bezeichner
  gibt es im Produktionscode nur **fünf**, alle um denselben Domänenbegriff „Flächenland"
  (`wikiSyncTerritoryFlaechState`, `getWikiSyncTerritoryFlaechenlandOnly`, `flaechenlaenderOnly`,
  `treeFlaechState`, `isFlaechenlandRow`). **Umlaute in Bezeichnern: 0** — das Projekt transliteriert
  konsequent. UPPER_SNAKE-Konstanten mit deutschem Nicht-Domänenwort: 0 im Produktivcode.
  Was es gibt: **32 distinkte rein deutsche lokale Bezeichner** ohne Domänenbezug, konzentriert in
  `js/map-features/map-features-ecosystem-*` und `js/review/review-labels.js` —
  `ergebnis` (18×), `vorhanden` (13×), `laenge` (6×), `merkmale` (6×), `gespeichert` (5×),
  `schluessel` (4×), sowie `hebtFlaecheHervor`, `quellRegionZeile`, `eigenerZeiger`, `istGipfel`.
  Für einen Agenten ist das lesbar, aber es macht `grep`-Suchen zweisprachig: wer nach `result`
  sucht, findet `ergebnis` nicht.
- **Erwartet:** Kein Handlungsdruck. Falls doch angefasst: lokale Variablen sind risikoarm umzubenennen
  (kein Datenvertrag) — im Gegensatz zu `laenge` in `review-path-wiki.js:229`, das eine
  Wiki-Staging-Spalte spiegelt und bleiben muss.
- **Beleg:** Bezeichner-Extraktion nur aus Code (Strings/Kommentare/Heredocs entfernt),
  camelCase/snake_case zerlegt, §2-Domänenbegriffe plus `Schritt`/`heller` als Allowlist
- **Sicherheit:** PLAUSIBEL (die Einordnung „Domänenbegriff ja/nein" bei `Flächenland`, `Merkmale`,
  `laenge` ist ein Urteil — §2 listet diese Begriffe nicht; werden sie als Domäne geführt, sinkt die
  Zahl gemischter Bezeichner von 5 auf 0)
- **Aufwand:** klein

---

## g) Testbarkeit

**Bestand:** 205 Testdateien (126 PHP, 79 JS). Alle **79 JS-Tests laufen grün** (selbst ausgeführt:
`for f in js/*/__tests__/*.test.js; do node "$f"; done` → 79 grün, 0 rot).

### B24 Kein einziger Test läuft beim Deploy — und einer ist auf `master` rot
- **Kategorie:** AKUT
- **Fundstelle:** `.github/workflows/deploy-avesmaps-strato.yml`; `api/_internal/routing/__tests__/terrain-text-claims-test.php:147`
- **Beobachtung:** Der einzige Workflow im Repo hat 7 Schritte: Checkout · Secrets prüfen ·
  Paket bauen · Asset-Versionen stempeln · SFTP installieren · hochladen · Waisen zurückziehen.
  `grep -niE "node |php |pytest|npm|assert" .github/workflows/deploy-avesmaps-strato.yml` → **0 Treffer**.
  205 Testdateien, **keine** wird beim Push ausgeführt. Push auf `master` = Deploy in die Produktion,
  ohne Riegel.
  Dass das keine theoretische Sorge ist, zeigt der aktuelle Stand: `terrain-text-claims-test.php`
  schlägt auf dem **eingecheckten, unveränderten** Arbeitsbaum fehl
  (`git status --porcelain js/routing/transport-speed-info.js` → leer).
- **Erwartet:** Mindestens ein CI-Job, der die 79 JS-Tests fährt (das ist ein `node`-Aufruf je Datei,
  keine Datenbank nötig) und die PHP-Tests, die ohne DB laufen. Ein roter Test darf nicht
  monatelang unbemerkt bleiben.
- **Beleg:** `grep -nE "^\s*(- )?(name|run|uses):" .github/workflows/deploy-avesmaps-strato.yml`
  (7 Schritte, keiner testet); `php -d zend.assertions=1 -d assert.exception=1
  api/_internal/routing/__tests__/terrain-text-claims-test.php` → `AssertionError … claims „DIN 33466"`
- **Sicherheit:** BELEGT
- **Aufwand:** klein (JS-Job) / mittel (PHP-Job mit den nötigen Erweiterungen)

### B25 Die größte Lücke zwischen „wichtig" und „geprüft" ist `js/territory/` (92 %)
- **Kategorie:** KANN
- **Fundstelle:** `js/territory/` (27 Dateien, 10.041 Zeilen)
- **Beobachtung:** Ich habe gemessen, welche Quelldateien von irgendeinem Test **namentlich erwähnt**
  werden (schwacher Proxy — die echte Abdeckung liegt darunter, nie darüber):

  | Verzeichnis | Zeilen ohne Test-Erwähnung | Anteil |
  |---|---|---|
  | **`js/territory`** | 9.231 / 10.041 | **92 %** |
  | `js/pages` | 1.230 / 1.507 | 82 % |
  | `js/review` | 11.946 / 20.864 | 57 % |
  | `api/edit` | 4.917 / 9.010 | 55 % |
  | `js/map-features` | 18.302 / 38.808 | 47 % |
  | `js/app` / `js/ui` | je 39 % | |
  | `api/app` | 1.397 / 5.189 | 27 % |
  | `api/_internal` | 13.407 / 77.268 | 17 % |
  | `js/routing` | 1.256 / 7.900 | **16 %** |

  Gesamt: 66.587 von 183.444 Zeilen (36 %) werden von keinem Test auch nur genannt.
  Die drei größten ungetesteten Einzeldateien: `territory-editor-embedded.js` (3.106),
  `territories-geometry.php` (1.496), `review-path-sync.js` (1.456).
  `js/routing/` ist mit 16 % der bestgeprüfte Bereich — die Routing-Arbeit hat hier klar gewirkt.
- **Erwartet:** Der Territorien-Editor ist laut AGENTS.md §10 der Ort mit der bekannten
  Vererbungs-Anomalie (Albenhus/Zwerch) und trägt vier der 13 Namenskollisionen. Genau dort gibt es
  keinen einzigen ausführenden Test.
- **Beleg:** `node work/coverage.js`
- **Sicherheit:** BELEGT (Metrik ist Namensnennung, nicht Zeilenabdeckung — als solche gekennzeichnet)
- **Aufwand:** groß

### B26 Jeder JS-Test baut seine Welt von Hand; einige schneiden Funktionen per Textsuche aus
- **Kategorie:** KANN
- **Fundstelle:** `js/routing/__tests__/route-terrain-summary.test.js:28–41`, `js/routing/__tests__/route-plan-leg-date.test.js`
- **Beobachtung:** Ohne Modulsystem muss jeder Test die Globals selbst stellen: 234 `global.X = …`-Zeilen
  über 79 Testdateien, Spitzenreiter `route-plan-leg-date.test.js` mit 30 Stubs auf 245 Zeilen.
  Vier Tests laden Quelle per `vm.runInThisContext`. Zwei schneiden eine einzelne Funktion **per
  Textsuche** aus einer fremden Datei heraus:
  `utilsSource.indexOf("function formatDecimalNumber(")` … `indexOf("\n}", start)`.
  Das ist ausdrücklich begründet (ein Stub würde genau den Formatierungsfehler verbergen, den der Test
  fangen soll — gute Absicht), aber es koppelt den Test an die *Textform* von `js/app/utils.js`:
  eine Umbenennung oder eine schließende Klammer in Spalte 0 innerhalb der Funktion bricht ihn.
  Kein `package.json`, kein `npm test`, kein Sammelrunner — jeder Test wird einzeln von Hand gestartet.
- **Erwartet:** Ein Runner-Skript (`tools/run-tests.sh` o. ä.), das alle Tests fährt und einen
  Exit-Code liefert. Das ist die Voraussetzung für B16 und kostet wenig.
- **Beleg:** `grep -rcE "^\s*(global\|globalThis)\." js/*/__tests__/*.test.js | awk -F: '{s+=$2}END{print s}'` → 234;
  `sed -n '28,41p' js/routing/__tests__/route-terrain-summary.test.js`;
  `ls package.json` → nicht vorhanden
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## Was gut ist (damit es nicht wegoptimiert wird)

- Die **27 Reihenfolge-Kommentare** in `index.html` sind die beste Dokumentation im Projekt: sie nennen
  Grund, Folge und Datum („waere beim ersten Laden mit einem ReferenceError komplett ausgefallen").
- **99 Dateien** in `js/`+`api/` tragen 💣/⚠️-Marker. `offroad-grid.php` (17), `ecosystem.php` (41)
  und `map-features.php` erklären ihre Fallen im Code besser als AGENTS.md sie erklärt.
- Der `art`/`art_key`-Fall ist **mit Test** abgesichert — das Muster, das für die anderen Paare fehlt.
- Die überschriebenen Regionen-Editor-Funktionen (B4) nennen ihre Injektionsquelle korrekt — der
  einzige Kollisionsfall, der von der *überschriebenen* Seite aus auffindbar ist.
- `js/routing/` ist mit 16 % ungeprüften Zeilen der bestgetestete Bereich.
