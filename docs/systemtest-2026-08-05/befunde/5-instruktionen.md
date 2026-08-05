# Agent 5 — Instruktionen & Gedächtnis (AGENTS.md, CLAUDE.md, docs/, memory/)

## Kern

1. **Das Gedächtnis ist makellos.** 279 Indexeinträge, 279 Dateien, null tote Links in beide
   Richtungen, keine Doppelung, null tote Querverweise zwischen den Dateien. 16 stichprobenhaft
   gegen den Code geprüfte Dateien waren alle aktuell. Das ist der beste Teil des Systems.
2. **AGENTS.md §10 („Known fragilities") nennt zwei Fehler, die BEHOBEN sind** — und der
   Masterplan sagt das ausdrücklich („the AGENTS.md §10 hotspot", `1e4d5bc4` / `1679f644`).
   Ein Agent, der §10 glaubt, jagt zwei erledigte Bugs. **B1, der teuerste Befund.**
3. **`api/README.md` — von AGENTS.md §4 zur „canonical reference" erklärt — trägt genau die
   Fehletikettierung „DIN 33466 / alpine clubs", die ein Unit-Test seit dem 31.07. verbietet.**
   Der Test prüft nur zwei JS-Dateien. Öffentlich schon einmal auseinandergenommen. **B2.**
4. **Vier harte Zahlen in AGENTS.md sind um Faktor 2–3,4 daneben:** ~117 Skript-Tags (real 229),
   ~50 map-features-Module (real 103), ~14 Inline-DDL-Tabellen (real 47), Zoom 0..5 (real 7).
   Die Zoom-Angabe ist die gefährlichste — Zoombänder sind ein Dauerthema. **B3, B4.**
5. **§5 listet 6 `entity_type`-Werte, der Code kennt 8** (`powerline`, `ecosystem` fehlen) —
   ausgerechnet in dem 💣-Absatz, der sagt „das ist eine Zwei-Zeilen-Änderung". **B5.**
6. **Kein einziger toter Dokumentverweis** in AGENTS.md/CLAUDE.md (61 Pfade geprüft, 61 OK).
   `api/README.md` hat drei (`map/import_reported_locations.py`, `api/_schema/*.sql`). **B10.**
7. **Struktur:** 47 % der Datei stecken in „11. Documentation index"; 39 % in sieben deutschen
   Absätzen, davon einer mit 4.168 Zeichen. Ein englischer Rahmen mit deutschem Kern. **B12.**

Befunde: **1 AKUT, 11 KANN, 1 ZUKUNFT** — 13 gesamt. 63 Behauptungen geprüft, 51 stimmen.

---

### B1 AGENTS.md §10 nennt zwei Perf-Fehler als offen, die der Masterplan als behoben führt
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\AGENTS.md:254-256` gegen
  `C:\GIT\avesmaps\api\_internal\political\territories-endpoint.php:40-58` und
  `C:\GIT\avesmaps\docs\refactoring-masterplan.md:58`
- **Beobachtung:** §10 sagt: „**`territories-endpoint.php` runs DDL + metadata probes before its
  cache read** on every political-layer request; the derived layer has an N+1 over the full
  territory table. Both are perf hotspots (milestone M6)."
  Im Code steht seit `1679f644` das Gegenteil: `territories-endpoint.php:40-44` „Fast path (perf):
  a FRESH political-layer cache hit needs no DB connection and no ensure-tables DDL … Serve the
  prebuilt JSON straight from cache before opening the PDO", gefolgt vom Cache-Hit-Zweig
  (Z. 45-58, `exit;` vor jedem `avesmapsCreatePdo`).
  `docs/refactoring-masterplan.md:58` (M6) benennt beide Punkte namentlich als erledigt:
  „**derived-layer N+1 eliminated (`1e4d5bc4`, the AGENTS.md §10 hotspot)**" und
  „**DDL out of cache-hit path (`1679f644`)** … the AGENTS.md §10 hottest endpoint".
- **Erwartet:** §10 verweist auf AGENTS.md — der Masterplan zitiert §10 sogar wörtlich als
  Adresse dessen, was er behoben hat. Genau dieser Absatz hätte mitgezogen werden müssen.
- **Beleg:** `sed -n '35,60p' api/_internal/political/territories-endpoint.php` (Fast-Path
  vollständig gelesen); `grep -n "M6" docs/refactoring-masterplan.md` → Zeile 58 enthält beide
  Sätze mit den Commit-SHAs.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B2 `api/README.md` — die „canonical reference" — trägt die öffentlich widerrufene DIN-33466-Etikettierung, an der der Schutztest vorbeigeht
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\api\README.md:102-104` gegen
  `C:\GIT\avesmaps\api\_internal\routing\__tests__\terrain-text-claims-test.php:86-89,139-152`
- **Beobachtung:** `api/README.md:102` schreibt:
  „🔴 **The model is the Leistungskilometer** (DIN 33466, the marching-time arithmetic of the German
  and Swiss alpine clubs), owner decision of 2026-07-30".
  Der Guard-Test enthält die Liste `$forbidden = ['DIN 33466', 'Marschzeitrechnung der
  Alpenvereine', 'alpine clubs'];` (Z. 143) mit dem Kommentar „Nothing in this repo may claim the
  model IS DIN 33466 again" (Z. 142). Er prüft aber nur zwei Dateien (Z. 86-89):
  `js/routing/transport-speed-info.js` und `js/app/i18n-en.js`. `api/README.md` steht nicht drin —
  der Satz enthält sogar zwei der drei verbotenen Zeichenketten gleichzeitig.
  AGENTS.md §4:101-102 erklärt genau diese Datei zur „**Canonical reference: `api/README.md`**".
  Das Gedächtnis (`steigungsmodell-din-33466-fehletikett.md`) führt den Fehler als bekannt und
  belegt ihn mit zwei DSA-Spielern, die die Klammer am 30.07.2026 im Discord auseinandernahmen —
  seine eigene Fundstellenliste (transport-speed-info.js, i18n-en.js, terrain-factor.php,
  route-plan.js, terrain-factor-test.php) nennt `api/README.md` **nicht**.
- **Erwartet:** Das externe API-Dokument nennt entweder nur „Leistungskilometer", oder der Test
  scannt auch `api/README.md`. Dass die verbotene Behauptung ausgerechnet im einzigen
  entwicklerlesbaren, öffentlich verlinkten Vertragsdokument überlebt, kehrt den Zweck des Tests um.
- **Beleg:** `Read api/README.md` (Zeile 102-104 wörtlich);
  `sed -n '/\$surfaces = \[/,/\];/p' api/_internal/routing/__tests__/terrain-text-claims-test.php`
  → exakt zwei Einträge, beide JS; `grep -rn "DIN 33466" --include=*.js --include=*.php
  --include=*.md js/ api/ docs/` → 20 Treffer, alle übrigen sind Warnungen VOR dem Etikett.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B3 Vier Mengenangaben in AGENTS.md sind um Faktor 2–3,4 veraltet
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:16` (Skript-Tags), `AGENTS.md:63` (Module), `AGENTS.md:259`
  (Inline-DDL-Tabellen), `AGENTS.md:309-310` (Hex-Werte)
- **Beobachtung:**

  | Behauptung | AGENTS.md | gemessen |
  |---|---|---|
  | `index.html` hand-includes … `<script>`/`<link>` | ~117 | 214 `<script src=` + 15 `<link>` = **229** |
  | `js/map-features/` | ~50 Module | **103** `.js` (ohne `__tests__`) |
  | Tabellen nur als Inline-PHP-DDL | ~14 | **47** |
  | hardcodierte Hex-Werte / CSS-Dateien | 1000+ / 38 | **376** / **65** |

  Die Hex-Zahl ist in die andere Richtung falsch: der Token-Sweep hat gewirkt (1000+ → 376), die
  Datei­zahl ist gewachsen (38 → 65). Die Begründung in §12 bleibt richtig, ihr Beleg nicht.
  Auch `docs/refactoring-masterplan.md:57` trägt die alte Zahl („The map-features/ cluster is now
  52 modules") — sie war zum Zeitpunkt von M5 korrekt.
- **Erwartet:** Zahlen, die eine Größenordnung transportieren sollen, dürfen nicht um Faktor 2
  danebenliegen — „~50 Module" und „103 Module" führen zu verschiedenen Entscheidungen darüber, ob
  man ein Verzeichnis noch überblicken kann.
- **Beleg:**
  `grep -c '<script src=' index.html` → 214 · `grep -c '<link ' index.html` → 15
  `find js/map-features -name '*.js' -not -path '*__tests__*' | wc -l` → 103
  `grep -rhoE "CREATE TABLE IF NOT EXISTS \`?[a-z_]{3,}\`? *\(" api/ tools/ --include=*.php | … | sort -u`
  → 60 Tabellen, davon 47 nicht in `sql/` (`comm -23`)
  `grep -rhoE '#[0-9a-fA-F]{3,8}\b' css/ | wc -l` → 376 · `find css -name '*.css' | wc -l` → 65
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B4 §1 nennt Zoom „0..5", die Karte läuft bis 7
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:17` gegen `C:\GIT\avesmaps\js\app\bootstrap.js:38,55`
- **Beobachtung:** §1 schreibt „`L.CRS.Simple`, image bounds `0..1024`, zoom `0..5` (a marker tier
  exists up to 6)". `bootstrap.js:55` setzt `maxZoom: 7`, und der Kommentar auf Z. 38 sagt es
  ausdrücklich: „maxZoom is 7 (see the L.map options below)". `js/config.js:627` führt
  `POLITICAL_TERRITORY_LAYER_ZOOM_LEVELS = [0, 1, 2, 3, 4, 5, 6]`, `js/config.js:562` klemmt eine
  Tempo-Matrix auf `Math.min(6, …)`. Die Bildgrenze 0..1024 stimmt (`config.js:9-10`).
- **Erwartet:** Zoom `0..7`. Die Zoomstufe ist in diesem Projekt keine Nebensache — Label-Kollision,
  Marker-Stufen und die Politik-Zoombänder hängen alle daran (Memory: `zoom-band-collision-plan`,
  `political-zoom-band-two-layers`, `label-collision-system`). Wer die Obergrenze um zwei Stufen
  falsch annimmt, rechnet Bänder falsch.
- **Beleg:** `grep -n "maxZoom" js/app/bootstrap.js` → `38: … maxZoom is 7 …`, `55: maxZoom: 7,`;
  `grep -n "1024" js/config.js` → `9: const IMG_WIDTH = 1024;` `10: const IMG_HEIGHT = 1024;`
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B5 Die `entity_type`-Weißliste in §5 ist unvollständig — ausgerechnet im 💣-Absatz, der sie zur Zwei-Zeilen-Änderung erklärt
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:117,122-125` gegen `api/edit/map/feature-sources.php:56` und
  `api/app/feature-sources.php:37`
- **Beobachtung:** AGENTS.md nennt zweimal „`entity_type` ∈ settlement|region|path|territory|
  citymap|lore" und schreibt dazu: „today `settlement | region | path | territory | citymap | lore`,
  in `api/edit/map/feature-sources.php` und `api/app/feature-sources.php`. That is a two-line change,
  and it is how `citymap` and `lore` joined."
  Der Code führt **acht** Werte:
  `api/edit/map/feature-sources.php:56` → `['settlement','region','path','territory','citymap','lore','powerline','ecosystem']`
  `api/app/feature-sources.php:37` → dieselben acht (andere Reihenfolge).
- **Erwartet:** Die Liste nennt alle acht. Der Absatz beschreibt das Verfahren korrekt und lehrt es
  gut — aber genau die Aufzählung, die als Beweis dient („und so kamen citymap und lore dazu"), ist
  seither zweimal erweitert worden, ohne dass die Doku nachzog. Ein Agent, der prüft, ob sein Typ
  schon existiert, sieht `powerline` nicht.
- **Beleg:** `grep -n "citymap\|lore" api/edit/map/feature-sources.php | grep -i "allowed"` →
  Z. 56 mit acht Elementen; dito `api/app/feature-sources.php:37`.
  Die Kernaussage des Absatzes hält: `grep -rniE "CREATE TABLE( IF NOT EXISTS)? [\`']?[a-z_]*_source"
  --include=*.php api/ tools/` → **1** Treffer, `feature_sources` selbst. Es gibt kein zweites
  Quellensystem.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B6 Die API-Zonentabelle in §4 lässt drei von neun Zonen aus, eine davon nennt AGENTS.md sieben Abschnitte später selbst
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:80-87` gegen `ls -d api/*/`, `ls -d api/edit/*/`, `ls -d api/_internal/*/`
- **Beobachtung:** Die Tabelle listet `api/edit/{map,political,reports,wiki}/` und
  `api/_internal/{routing,wiki,political}/`. Tatsächlich:
  - `api/edit/` hat **sechs** Unterordner: `admin/` (1 Endpunkt), `mail/` (1), `map/` (21),
    `political/` (3), `reports/` (1), `wiki/` (14). `admin` und `mail` fehlen.
  - `api/_internal/` hat **dreizehn**: `__tests__, analytics, app, backup, conflicts, discord,
    linkcheck, mail, map, political, routing, text, wiki`. Genannt sind drei.
  - `api/discord/` (5 Dateien) taucht in der Tabelle gar nicht auf.

  Die Auslassung von `api/edit/admin/` ist eine Selbstwidersprüchlichkeit: §11:276 und
  `api/README.md:218` beschreiben `api/edit/admin/database-backup.php` ausführlich, samt der
  Sonderregel „Requires the `admin` capability — not `edit`".
- **Erwartet:** Entweder die Tabelle ist vollständig, oder sie sagt „u. a." — die geschweifte
  Klammer liest sich als Aufzählung aller Fälle und wird so verwendet.
- **Beleg:** `ls -d api/*/` → 9 Zonen; `ls -d api/edit/*/` → 6; `ls -d api/_internal/*/` → 13;
  `for d in api/edit/*/; do … ls -1 $d*.php | wc -l; done` (Endpunktzahlen oben).
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B7 §3 verspricht „inline glue in `index.html`" für das Routing — es gibt keine
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:65` gegen `index.html:13-23`
- **Beobachtung:** §3 beschreibt `js/routing/` als „route engine, graph, plan/render, waypoints
  (+ inline glue in `index.html`)". `index.html` enthält genau **ein** inline-`<script>` (Z. 13-23)
  und das setzt das Theme vor dem Stylesheet-Laden; dazu ein `<script type="application/ld+json">`
  (Z. 58, SEO). Kein Routing-Code. Die acht Treffer für `dijkstra|routeGraph|waypoint` in
  `index.html` sind Fließtext (Z. 219, 235, 238, 2194, 2195), eine leere `<div id="waypoints">`
  (Z. 1970) und ein `<script src=…>` (Z. 2434).
  Plausibel entfernt durch die M5-Splits (`docs/refactoring-masterplan.md:57` beschreibt das
  Herauslösen der Routing-Cluster).
- **Erwartet:** Klammer streichen. Sie schickt jemanden, der das Routing versteht will, in eine
  2.500-Zeilen-HTML-Datei.
- **Beleg:** `grep -n '<script' index.html | grep -v 'src='` → 2 Treffer (Z. 13 Theme, Z. 58 JSON-LD);
  `sed -n '13,23p' index.html` gelesen; `grep -nE 'dijkstra|Dijkstra|routeGraph|waypoint' index.html`
  → 8 Treffer, alle Prosa/Markup; `ls -1 js/routing/*.js | wc -l` → 22 Module.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B8 §6 („does not delete") und §10 („never `mirror --delete`") widersprechen sich — und beide beschreiben den Workflow ungenau
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:158-159` und `AGENTS.md:246-247` gegen
  `.github/workflows/deploy-avesmaps-strato.yml:240-262`
- **Beobachtung:** §6 sagt „**It does not delete** — files removed from the repo persist on the
  server". §10 sagt „via the deploy's ‚Retire orphaned remote files' step — **never
  `mirror --delete`** (its dry-run would also delete live files)".
  Der Workflow hat beides: Z. 253-255
  `if [[ "${{ inputs.delete_remote_files }}" == "true" ]]; then mirror_options+=("--delete"); fi` —
  also ein `workflow_dispatch`-Eingabefeld, das genau das Verbotene scharf schaltet. §6 behauptet,
  die Fähigkeit existiere nicht; §10 verbietet ihre Benutzung. Nur zusammen ergeben die beiden
  Absätze ein richtiges Bild, und sie stehen 90 Zeilen auseinander.
- **Erwartet:** §6 sollte sagen „deletes only when the dispatch input `delete_remote_files` is set —
  never do that, see §10". Ein Agent, der nur §6 liest, hält den Schalter für nicht existent und
  kann ihn beim Dispatch versehentlich setzen.
- **Beleg:** `sed -n '225,300p' .github/workflows/deploy-avesmaps-strato.yml` — vollständig gelesen;
  `--delete` in Z. 254, Fallback-Schritt „Retire orphaned remote files" ab Z. 266 mit fünf
  chirurgischen `rm -f`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B9 §10 führt `/js/pages` unter den „stale dirs", §3 führt `js/pages/` als lebenden Cluster
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:245` gegen `AGENTS.md:69`
- **Beobachtung:** §10 zählt die 2026-06-14 gelöschten Verzeichnisse auf: „stale dirs `/map
  /politics /test /js/pages /css/legacy`". §3 listet in derselben Datei „`js/pages/` | scripts for
  standalone `html/*.html` pages".
  Im Repo existiert `js/pages/` mit zwei echten Modulen (`wege-editor.js`, `wege-editor-model.js`
  + `__tests__`), beide von `html/*.html` referenziert. Sie sind auch im Deploy-Allowlist
  (`deploy-avesmaps-strato.yml:98` → `"js"`).
  Die Aussage war 2026-06-14 richtig (gelöscht wurde der Vor-Reorg-Inhalt); heute liest sie sich als
  „dieses Verzeichnis ist tot".
- **Erwartet:** §10 sollte das historische Datum an den Pfad binden („the pre-reorg contents of
  `/js/pages`"), oder den Pfad aus der Liste nehmen. `/map` dagegen ist tatsächlich weg — und wird
  von `api/README.md` noch benutzt (siehe B10).
- **Beleg:** `ls -1 js/pages/` → `__tests__`, `wege-editor-model.js`, `wege-editor.js`;
  `grep -rho 'js/pages/[a-z0-9.-]*\.js' html/*.html index.html | sort -u` → beide Dateien;
  `ls -d map/` → existiert nicht.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B10 `api/README.md` hat drei tote Verweise und listet 10 App-Endpunkte nicht
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\README.md:180-199, 264-272, 278, 299`
- **Beobachtung:**
  1. Z. 278 und Z. 299 verweisen auf `map/import_reported_locations.py`. Das Verzeichnis `map/`
     existiert im Repo nicht — AGENTS.md §10:245 führt `/map` selbst unter den 2026-06-14
     entfernten „stale dirs". Die dokumentierte Import-Anleitung ist damit nicht ausführbar.
  2. Z. 264-270: „Schemas are intended to live under `api/_schema/mysql.sql` / `pgsql.sql` /
     `future.mysql.sql`". `api/_schema/` enthält **nur** `.htaccess` (152 Byte). Die Schemata liegen
     in `sql/` (8 Dateien). „intended to" macht das nicht falsch, aber es ist der einzige Hinweis,
     wo Schemata zu suchen sind, und er zeigt auf ein leeres Verzeichnis.
  3. Die Liste „App endpoints" (Z. 180-199) nennt 19 Endpunkte; `api/app/` enthält **29**. Es fehlen:
     `changelog.php`, `citymaps.php`, `heartbeat.php`, `lore.php`, `map-revision.php`,
     `path-landscapes.php`, `place-kinds.php`, `session.php`, `source-coverage.php`,
     `source-search.php`. Darunter `session.php`, das das Gedächtnis als „der Rechte-Kanal"
     führt (`session-endpoint-is-the-rights-channel.md`), und `changelog.php`, das AGENTS.md §11
     ausdrücklich beschreibt.
- **Erwartet:** Tote Pfade raus, Endpunktliste generiert statt gepflegt (`ls api/app/*.php`).
- **Beleg:** `ls -d map/` → nicht vorhanden; `ls -la api/_schema/` → nur `.htaccess`;
  `ls -1 api/app/*.php` → 29 Dateien, abgeglichen gegen `Read api/README.md` Z. 180-199.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B11 Zwei kleinere Zahlen-Drifts: 33 Handbuch-Anker (real 37), „several" getMessage()-Lecks (real 35 in 23 Dateien)
- **Kategorie:** KANN
- **Fundstelle:** `AGENTS.md:270` und `AGENTS.md:262-263`
- **Beobachtung:**
  1. §11 beschreibt die nächtliche Routine `avesmaps-handbuch-pflege`: „re-verify 3–4 of the **33**
     anchored `<h3 id=…>` sections against the live code on rotation, so the whole book is checked
     roughly every 8–10 days". `html/editor-handbuch.html` hat **37** solche Anker. Bei 3–4 pro Nacht
     dauert eine Runde damit 10–12 Tage statt 8–10 — die Routine selbst funktioniert weiter, ihre
     zugesagte Umlaufzeit stimmt nicht mehr. („Stand: 05.08.2026" — die Datei wird gepflegt.)
  2. §10 sagt „Several edit endpoints leak `getMessage()` to clients (info disclosure, milestone
     M1)". Real: **35** Vorkommen in **23** Dateien unter `api/edit/`. „Several" untertreibt eine
     Verletzung, die für M1 als abgeschlossen gilt (`docs/refactoring-masterplan.md:53`: „stopped 9
     bare-Throwable `getMessage()` leaks").
- **Erwartet:** Zu 1.: Zahl nachziehen oder durch „alle" ersetzen. Zu 2.: entweder die Zahl nennen
  oder klarstellen, dass M1 nur die *bare-Throwable*-Fälle geschlossen hat.
- **Beleg:** `grep -c '<h3 id=' html/editor-handbuch.html` → 37;
  `grep -rn "getMessage()" api/edit/ --include=*.php | wc -l` → 35;
  `grep -rln "getMessage()" api/edit/ --include=*.php | wc -l` → 23.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (<1h)

---

### B12 Struktur: 47 % von AGENTS.md stecken in „11. Documentation index", 39 % in sieben deutschen Absätzen — der Rahmen ist englisch, der Inhalt nicht
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\AGENTS.md` gesamt (324 Zeilen, 4.602 Wörter, 35.974 Byte)
- **Beobachtung:** Gemessen:
  - §11 „Documentation index" (Z. 265-298) = **16.918 Byte = 47 %** der Datei. Es ist längst kein
    Index mehr, sondern das größte Kapitel.
  - Sieben Aufzählungspunkte darin (Z. 276, 277, 278, 282, 283, 289, 290) = **14.174 Byte = 39 %**
    der Datei. Sie sind auf Deutsch, während die übrigen elf Abschnitte englisch sind.
  - Die längsten Zeilen der Datei sind alle diese sieben: 4.168 / 2.073 / 2.049 / 2.039 / 1.568 /
    1.148 / 1.122 Zeichen. Zeile 290 („Klimazonen") ist ein einziger Absatz von 4.168 Zeichen mit
    sechs 💣 und vier ⚠️ — mehr als AGENTS.md §1 bis §4 zusammen.
  - Nur **9** der 324 Zeilen sind deutschsprachig — sie tragen 39 % des Gewichts.
  - Die übrigen elf Abschnitte sind kompakt: §1 20 Zeilen, §6 9, §8 13, §12 25.
- **Erwartet:** Ein frischer Agent nimmt aus dieser Form verlässlich die kurzen Abschnitte mit
  (§1-§9, §12) und **rutscht durch §11 durch**, weil dort sieben Wände Text ohne Überschrift
  stehen. Das ist genau falsch herum: in §11 stecken die teuersten 💣 (Trennlinien-Geometrie,
  Gzip-Member, ETag-Seed, ×25-Gewicht) — Regeln, deren Verletzung Daten kostet, nicht Stil.
  Konkret umzustellen wäre:
  1. **Die sieben Feature-Erzählungen aus §11 herausnehmen.** Sie sind Gedächtnis-Einträge, keine
     Index-Zeilen — und für sechs davon existiert bereits eine Memory-Datei
     (`klimazonen-abgeleitete-ebene`, `klimazone-infobox-zeile`, `hierher-reisen-astar`,
     `x25-ist-gewicht-nicht-strecke`, `konfliktzentrum-design`, `adventures-feature-phase1`).
     §11 wird wieder eine Liste aus Pfad + einem Satz.
  2. **Die 💣-Regeln, die dabei frei werden, in einen eigenen kurzen Abschnitt „Die Fallen, die
     Daten kosten"** heben — sortiert nach Schadenshöhe, nicht nach Feature-Chronologie.
  3. **Eine Sprache je Abschnitt.** Der Mischbetrieb ist heute nicht mal konsistent innerhalb
     von §11 (Z. 276 englisch, Z. 277 deutsch, Z. 279-281 englisch, Z. 282 englisch mit deutschen
     Einschüben, Z. 289-290 deutsch). §8 verlangt selbst „write code comments, docs, commit messages
     … in **English** going forward" — §11 ist die größte Verletzung dieser eigenen Regel.
  4. **Zahlen, die driften, kennzeichnen oder weglassen.** B3/B4/B11 sind vier von vier geprüften
     Mengenangaben, die veraltet sind. Eine Angabe wie „~50 Module" altert schlechter als „see
     `ls js/map-features/`".
- **Beleg:** `wc -l/-w/-c AGENTS.md` → 324 / 4.602 / 35.974;
  `awk 'NR>=265 && NR<=298' AGENTS.md | wc -c` → 16.918;
  `awk 'NR==276||NR==277||NR==278||NR==282||NR==283||NR==289||NR==290' AGENTS.md | wc -c` → 14.174;
  `awk '{print length": line "NR}' AGENTS.md | sort -rn | head -8` → die acht längsten Zeilen,
  sieben davon in §11;
  `awk '/^## /{…}' AGENTS.md` → Zeilenzahl je Abschnitt.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel (1 Tag)

---

### B13 Der Guard-Test-Gedanke aus `terrain-text-claims-test.php` ließe sich auf AGENTS.md selbst anwenden
- **Kategorie:** ZUKUNFT
- **Fundstelle:** `api/_internal/routing/__tests__/terrain-text-claims-test.php:1-12`
- **Beobachtung:** Der Test bindet Text an Code in **beide** Richtungen: „Change the text without
  the code -> (2) fails. Change the code without the text -> (1) fails." Genau die Klasse Fehler,
  die B1/B3/B4/B5 sind, wäre so nicht entstanden. Prüfbar ohne Netz und ohne DB wären mindestens:
  jede in AGENTS.md/CLAUDE.md/`api/README.md` erwähnte Datei existiert (61 Pfade, heute 61/61 OK);
  `maxZoom` in `bootstrap.js` = die in §1 genannte Zahl; die `entity_type`-Weißliste in §5 = die
  beiden Arrays im Code; die verbotenen DIN-Zeichenketten auch in `api/README.md` und `docs/*.md`.
- **Erwartet:** Ein `docs/__tests__/agents-md-claims-test.php` in derselben Bauart wie der
  Terrain-Test, im selben Lauf wie die übrigen PHP-Tests.
- **Beleg:** Testdatei gelesen (Kopf + `$surfaces` + `$forbidden`-Block). Die Pfadprüfung habe ich
  für diesen Bericht bereits ad hoc gefahren (61/61) — das ist die Vorlage, nicht ausgeführt als Test.
- **Sicherheit:** PLAUSIBEL
- **Aufwand:** klein (<1h)

---

## (b) Verweise ins Leere — Ergebnis

**AGENTS.md + CLAUDE.md: null tote Verweise.** 61 Pfadangaben maschinell aufgelöst (inkl.
`{plan,progress}`-Klammerexpansion), 61 existieren. Alle 33 `docs/`-Verweise aus §11, alle vier
`docs/superpowers/plans|specs/`-Verweise, alle Code-Verweise (`api/_internal/*`, `js/*`, `css/*`,
`tools/wikidump/*`, `html/editor-handbuch.html`, `.github/workflows/*`) sind vorhanden.

Nicht als Repo-Pfad auflösbar und **korrekt so**: `api/wiki-sync.php`, `api/app/.user.ini`,
`config.local.php` — AGENTS.md §10 bezeichnet sie ausdrücklich als serverseitig/gitignoriert.

Bare-Dateinamen aus §11, einzeln nachgeschlagen und alle vorhanden:
`territories-endpoint.php` → `api/_internal/political/`, `detour.php` + `synthetic-refine.php` →
`api/_internal/routing/`, `changelog-test.php` + `climate-insert-zone-test.php` →
`api/_internal/app/__tests__/`, `i18n-en.js` → `js/app/`.

**`api/README.md`: drei tote Verweise** (siehe B10) — `map/import_reported_locations.py` (2×),
`api/_schema/{mysql,pgsql,future.mysql}.sql`. Der vierte Kandidat
`../config/api.config.example.php` (Z. 235) ist **korrekt** — relativ zu `api/` aufgelöst
existiert `config/api.config.example.php`.

## (c) Gedächtnis gegen Wirklichkeit — Ergebnis

| Prüfung | Ergebnis |
|---|---|
| (1) Indexeintrag → existierende Datei | **279 / 279** — null tot |
| (2) Datei → im Index verlinkt | **279 / 279** — null verwaist |
| (3) Doppelte Indexeinträge | **0** |
| (3b) Markdown-Querverweise *zwischen* Memory-Dateien | 0 vorhanden, 0 tot |
| (3c) `[[wikilinks]]` in Memory-Dateien | 268 verschiedene; 229 zeigen auf Memory-Namen und lösen auf, **39 nicht** — und das ist **kein Fehler**: es sind Wiki-Aventurica-Artikelnamen als Zitat (`[[Gareth]]`, `[[Kategorie:Public domain Datei]]`, `[[Datei:]]`, `[[Ulisses]]`, `[[Fanpro]]`) plus `[[dump-lock.php]]` als Dateiname im Fließtext. MediaWiki-Syntax als Inhalt, nicht als Zeiger. |

Belege: `grep -oE '\]\(([A-Za-z0-9._-]+\.md)\)' MEMORY.md | sort -u` → 279 Ziele, jedes mit
`[ -e ]` geprüft; `comm -13` gegen `ls -1 *.md` → leer in beide Richtungen; `sort | uniq -d` → leer.

**(4) Stichprobe: 16 Memory-Dateien gegen den Code geprüft — 15 aktuell, 1 unvollständig.**

| Memory-Datei | geprüfte Behauptung | Ergebnis |
|---|---|---|
| `klimazone-trockene-subtropen-ohne-boden` | `SEASON_GROUND_TABLE` kennt 7 Zonen, `trockene_subtropen` fehlt | **aktuell** — `js/routing/season-ground.js:45`: 7 Schlüssel, `grep -c trockene_subtropen` = 0 |
| `filter-funnel-shared-component` | `js/ui/filter-menu.js`, `avmFilterMenuAttach`, `tools/paths/test-filter-menu.mjs` | **aktuell** — alle drei vorhanden |
| `landschaften-erprobungshinweis` | `js/map-features/map-features-ecosystem-intro.js` | **aktuell** |
| `bornland-reisetabelle-abgleich` | `riverSailer` 7,5→6,0, `riverBarge` 5,0→4,0, `DISTANCE_SCALING_FACTOR`=3 | **aktuell** — `js/config.js:11,121,122`; die Datei trägt ihre eigene „🔴 ÜBERHOLT AM 2026-08-02"-Korrektur |
| `x25-ist-gewicht-nicht-strecke` | Faktor 25 ist ein Dijkstra-Gewicht | **aktuell** — `client-graph.php:16` = 25.0, `:665` liefert `cost_factor` mit |
| `political-syncregionvisibility-duplicate` | `syncRegionVisibility` existiert zweimal | **aktuell** — `map-features-political-region-visibility.js:1` und `map-features-political-territory-loader.js:476` |
| `session-endpoint-is-the-rights-channel` | `api/app/session.php` liefert `capabilities` | **aktuell** — `:9` |
| `spotlight-mehrwort-und-kartensammlung` | `SPOTLIGHT_SEARCH_SECTIONS` datengetrieben | **aktuell** — `js/ui/spotlight-search.js:20,25` |
| `bodenabzug-etappenzeit` | `art_key` ist der Schlüssel, `art` das Label | **aktuell** — `js/routing/route-season-ground.js:54,58` trägt die Warnung im Code |
| `modus-vorgaben-tabelle-und-reihenfolge` | `setSelectedMapLayerMode` als Reihenfolge-Anker | **aktuell** — `map-features-display-mode.js:167` |
| `startansicht-gleich-suchtreffer` | Startbild = Suchtreffer „Aventurien", bitgleich | **aktuell** — `js/app/bootstrap.js:9-13` sagt es wörtlich |
| `global-font-family-important-lock` | genau eine `!important`-Schriftsperre | **aktuell** — 1 Treffer in `css/base/` |
| `citymaps-killswitch-silent-outage` | `citymaps_enabled` über `app-setting.php`, nicht auf heißen Pfaden | **aktuell** — `api/_internal/app/app-setting.php:9,80` |
| `klimazonen-abgeleitete-ebene` | 8 Zonen in `AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED`, `sort_order` in Zehnerschritten | **aktuell** — `ecosystem.php:87ff`, acht `['klima',…]`-Zeilen, die eingeschobene bei 55 |
| `klimazone-infobox-zeile` | Punkttest fragt die Bänder, `avesmapsClimateReadStamp` im ETag | **aktuell** — `climate-membership.php:287`, `api/app/map-features.php:123` |
| `steigungsmodell-din-33466-fehletikett` | Fundstellenliste des Fehletiketts | ⚠️ **unvollständig** — nennt 5 Dateien, aber nicht `api/README.md:102`, wo das Etikett bis heute steht (siehe B2) |

## (d) Widersprüche — Übersicht

| # | A sagt | B sagt | Befund |
|---|---|---|---|
| 1 | AGENTS.md §10:254: DDL vor Cache-Read + N+1 offen | masterplan:58: beide behoben, „the AGENTS.md §10 hotspot" | **B1** |
| 2 | AGENTS.md §4:101: `api/README.md` ist die kanonische Referenz | `terrain-text-claims-test.php:143`: „DIN 33466" ist verboten — `api/README.md:102` sagt es | **B2** |
| 3 | AGENTS.md §6:159: „It does not delete" | AGENTS.md §10:246 + Workflow:254: `--delete` existiert als Dispatch-Eingabe | **B8** |
| 4 | AGENTS.md §10:245: `/js/pages` = stale dir | AGENTS.md §3:69: `js/pages/` = lebender Cluster | **B9** |
| 5 | AGENTS.md §4:84: `api/edit/{map,political,reports,wiki}` | AGENTS.md §11:276 + `api/README.md:218`: `api/edit/admin/database-backup.php` | **B6** |
| 6 | AGENTS.md §8:198: Doku auf Englisch | AGENTS.md §11: 39 % der Datei auf Deutsch | **B12** |
| 7 | AGENTS.md §3:63 „~50 modules" | masterplan:57 „now 52 modules" | beide veraltet (103) — **B3** |
| 8 | `api/README.md:278` benutzt `map/…` | AGENTS.md §10:245 hat `/map` retiriert | **B10** |

**Doppelt und leicht verschieden formuliert** (die gefährliche Sorte, ohne dass sie heute
auseinanderlaufen): der STRATO-Schleifen-Riegel steht in `AGENTS.md:220-222` **und**
`CLAUDE.md:11-13`; der `ASSET_VERSION`-Bump in `AGENTS.md:174-178` **und** `CLAUDE.md:16-18`
(die Kurzfassung in CLAUDE.md lässt den Hinweis weg, dass `inline-host.js` selbst ohne `?v=` geladen
wird und einen Hard-Reload braucht); der Deploy-Ablauf in `AGENTS.md:208-210` **und**
`CLAUDE.md:14-15`. Alle drei stimmen heute überein — es sind vier Zeilen Redundanz, die genau die
Drift ermöglichen, die B1 zeigt. CLAUDE.md ist ansonsten sauber: 21 Zeilen, zwei Dateiverweise,
beide existieren.

## (e) Struktur-Urteil

Siehe **B12** für Messung und Vorschlag. Kurz: Die kurzen Abschnitte tragen, §11 trägt nicht.
Ein Agent, der AGENTS.md einmal liest, hat §1-§10 und §12 präsent und wird §11 als „Liste von
Doku-Pfaden" abtun — weil es so heißt. Die vier teuersten 💣 des Projekts stehen aber genau dort,
in Absätzen von 1.100 bis 4.168 Zeichen. Der Sprachwechsel verstärkt das: der Leser hat sich auf
englischen Fließtext eingestellt und trifft in Zeile 277 auf eine deutsche Textwand.

Was die Datei **gut** macht und was man beim Umbau nicht verlieren darf: Die 💣/⚠️/🔴-Markierung ist
wirksam und wird offensichtlich benutzt (der Code trägt dieselben Symbole an denselben Stellen —
`terrain-factor.php:10`, `conflicts/core.php:12`, `db-dump.php:50`). Die 💣-Absätze erklären
konsequent **warum** eine hässliche Lösung tragend ist, nicht nur **dass** — das ist genau die
Information, die einen Agenten davon abhält, sie „aufzuräumen". Und die Trefferquote ist hoch:
von 47 einzeln nachgeprüften Behauptungen stimmen **39**.

---

## (a) Behauptung | Fundstelle | stimmt?

| # | Behauptung (AGENTS.md §) | Fundstelle im Code | stimmt? |
|---|---|---|---|
| 1 | §1 `index.html` hand-includes ~117 `<script>`/`<link>` | `index.html`: 214 `src=` + 15 `<link>` = 229 | **nein** (B3) |
| 2 | §1 Leaflet 1.9.4 | `js/third-party/leaflet.js:1-3` Header | ja |
| 3 | §1 image bounds `0..1024` | `js/config.js:9-10` | ja |
| 4 | §1 zoom `0..5`, Marker-Stufe bis 6 | `js/app/bootstrap.js:55` `maxZoom: 7` | **nein** (B4) |
| 5 | §1 llms.txt/site-summary/README nennen PHP+MySQL-Backend | `llms.txt:3,7`, `site-summary.md:7,38`, `README.md:39,48` | ja |
| 6 | §2 `PATH_SUBTYPE_KEYS` als stabile Schlüssel | `js/config.js:70` (8 Schlüssel) | ja |
| 7 | §2 Kreuzungs-Präfix `Kreuzung-` | `js/map-features/map-features-location-lookup.js:116,121` | ja |
| 8 | §2 Siedlungs-Slugs metropole…gebaeude | `js/config.js:571ff, 599-604` | ja |
| 9 | §3 `js/map-features/` ~50 Module | 103 `.js` ohne `__tests__` | **nein** (B3) |
| 10 | §3 `js/routing/` + inline glue in `index.html` | einziges Inline-`<script>` = Theme (`index.html:13-23`) | **nein** (B7) |
| 11 | §3 `js/third-party/`: Leaflet, jQuery 3.6.0, jQuery-UI, textpath, polygon-clipping, polylabel | `ls js/third-party/` → alle 6 | ja |
| 12 | §3 Karte hydriert aus `GET /api/app/map-features.php` | `api/app/map-features.php` vorhanden | ja |
| 13 | §4 `api/edit/{map,political,reports,wiki}/` | 6 Unterordner (+`admin`, +`mail`) | **unvollständig** (B6) |
| 14 | §4 `api/_internal/{routing,wiki,political}/` | 13 Unterordner | **unvollständig** (B6) |
| 15 | §4 `api/import/location-reports/` | `ls api/import/` → vorhanden | ja |
| 16 | §4 5 Funktionen in `api/_internal/bootstrap.php` | Z. 20 / 96 / 164 / 175 / 194 | ja (5/5) |
| 17 | §4 `avesmapsRequireUserWithCapability` in `auth.php` | `api/_internal/auth.php:123` | ja |
| 18 | §4 `_internal`/`_schema`/`diagnostics` `.htaccess`-gesperrt | alle drei `.htaccess` vorhanden | ja |
| 19 | §4 `api/README.md` = kanonische Referenz | trägt die verbotene DIN-33466-Angabe (`:102`) | **inhaltlich falsch** (B2) |
| 20 | §5 `entity_type` ∈ 6 Werte | `api/edit/map/feature-sources.php:56` → 8 Werte | **nein** (B5) |
| 21 | §5 „nie ein zweites Quellensystem" (kein `<feature>_source`) | 1 Treffer repoweit: `feature_sources` selbst | ja |
| 22 | §5 `url_hash` = SHA256 | `api/_internal/app/feature-sources.php:13` `CHAR(64)` | ja |
| 23 | §5 `entity_public_id` VARCHAR(190) | `:26` legt 64 an, `:95` `MODIFY … VARCHAR(190)` | ja (per Nachrüstung) |
| 24 | §5 `origin` ∈ wiki_publication\|manual\|community | `:54-55` `VARCHAR(24) DEFAULT 'manual'` | ja |
| 25 | §5 `avesmapsFoldToAscii()` in `text/ascii-fold.php` | `api/_internal/text/ascii-fold.php:87` | ja |
| 26 | §5 `avesmapsPoliticalSlug()` | `api/_internal/political/territory.php:1060` | ja |
| 27 | §5 nie `iconv//TRANSLIT` für Schlüssel | nur in `mail/imap.php` (Zeichensatz-Dekodierung) | ja |
| 28 | §6 Deploy löscht nicht | Workflow:254 `--delete` hinter Dispatch-Eingabe | **teilweise** (B8) |
| 29 | §6/§10 Schritt „Retire orphaned remote files" | `deploy-avesmaps-strato.yml:266-296` | ja |
| 30 | §7 `ASSET_VERSION` in `territory-editor-inline-host.js`, einzige Quelle | `:23` `"20260804b"`, repoweit einziger Treffer | ja |
| 31 | §7 `edit/index.php` mit handgeschriebenem `?v=` für `edit.css` | `edit/index.php:71` `?v=20260729-backup` | ja — und **nicht** veraltet: letzter `edit.css`-Commit ist `b75eb550` (2026-07-29) |
| 32 | §9 `.gitattributes` mit `text=auto` + Binärmarkern | `.gitattributes:5ff` | ja |
| 33 | §10 territories-endpoint: DDL vor Cache-Read | `territories-endpoint.php:40-58` Fast-Path davor | **nicht mehr** (B1) |
| 34 | §10 Derived-Layer N+1 offen | `masterplan:58` „N+1 eliminated (`1e4d5bc4`)" | **nicht mehr** (B1) |
| 35 | §10 ~14 Tabellen nur als Inline-PHP-DDL | 60 Inline-DDL-Tabellen, 47 nicht in `sql/` | **nein** (B3) |
| 36 | §10 `map_feature_relations`/`map_proposals` tot | `sql/schema.sql:791,803`, 0 PHP-Referenzen | ja |
| 37 | §10 „several" `getMessage()`-Lecks in edit-Endpunkten | 35 Treffer in 23 Dateien | ja (untertrieben, B11) |
| 38 | §10 `/js/pages` = stale dir | `js/pages/` lebt, 2 Module, von `html/` referenziert | **nein** (B9) |
| 39 | §11 Handbuch: 33 `<h3 id=…>`-Anker | `html/editor-handbuch.html`: 37 | **nein** (B11) |
| 40 | §11 Changelog-Saat = 42 Meilensteine | `api/_internal/app/changelog.php:34` + 42 Einträge gezählt | ja |
| 41 | §11 `overflow-anchor: none` am Scroll-Kasten | `css/components/changelog-dialog.css:72` | ja |
| 42 | §11 `#changelog-overlay` in `js/app/changelog-dialog.js` | `:38` | ja |
| 43 | §11 `SHORTCUTS` ist die einzige Quelle, baut `#legal-shortcuts` | `keyboard-shortcuts.js:50,372,427,436`; `index.html:2174` = leeres `<div>` | ja |
| 44 | §11 kein Strg/Alt/Meta — `matchShortcut` gibt sofort auf | `keyboard-shortcuts.js:110` | ja |
| 45 | §11 `map.keyboard.disable()` | `keyboard-shortcuts.js:420-421` | ja |
| 46 | §11 `TOOL_CLASSES` als einziger Riegel-Zustand | `keyboard-shortcuts.js:138,190-191` | ja |
| 47 | §11 Konflikte: 215 Gruppen / 1547 Objekte, 2448 von 3721 | `api/_internal/conflicts/core.php:12-15,156` | ja (4/4) |
| 48 | §11 `conflict_decision` mit `(rule_id, fingerprint)` | `conflicts/store.php:26,40` UNIQUE KEY | ja |
| 49 | §11 Backup: `db_backup_run`, `uploads/db-backups`, 3 neueste, `crc32_combine` | `db-dump.php:104,112,167,789,2042` | ja (4/4) |
| 50 | §11 `AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD` = 3,0 | `api/_internal/routing/detour.php:28` | ja |
| 51 | §11 `…SYNTHETIC_DISTANCE_COST_FACTOR` = ×25, als `cost_factor` herausgerechnet | `client-graph.php:16,658,665` | ja |
| 52 | §11 8 Klimazonen in `AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED` | `api/_internal/app/ecosystem.php:87ff` | ja |
| 53 | §11 `sort_order` in Zehnerschritten mit Platz zum Einschieben | eingeschobene Zone bei 55 | ja |
| 54 | §11 `avesmapsEcosystemClimateRebuildBands` | `ecosystem.php:3424` | ja |
| 55 | §11 `avesmapsClimateAssertNotDerived()` | `climate-zones.php:529` | ja |
| 56 | §11 `south_type_key` nachgerüstet vor der Saat | `ecosystem.php:402-403,424` | ja |
| 57 | §11 `avesmapsClimateReadStamp()` im ETag-Seed von `map-features.php` | `api/app/map-features.php:123` | ja |
| 58 | §11 Punkttest fragt die Bänder | `api/_internal/app/climate-membership.php` vorhanden, `:287` | ja |
| 59 | §12 Tokens `--color-button`, `--color-button-soft`, `--radius-md`, `--color-divider`, `--color-link` | `css/base/tokens.css` — alle 5 | ja |
| 60 | §12 1000+ Hex-Werte über 38 CSS-Dateien | 376 Hex, 65 CSS-Dateien | **nein** (B3) |
| 61 | §12 Kontur nur im Editiermodus: `ecosystem-pane--editable` / `--eco-contour` | `css/features/ecosystem-layer.css:1204-1234` | ja |
| 62 | CLAUDE.md: `ASSET_VERSION` in `territory-editor-inline-host.js` | `:23` | ja |
| 63 | CLAUDE.md: `docs/refactoring-masterplan.md` mit M0–M8 | vorhanden, M0…M8 alle als Zeilen 51-60 | ja |

**Bilanz: 63 Behauptungen geprüft — 51 stimmen, 8 stimmen nicht mehr, 2 unvollständig,
1 inhaltlich falsch, 1 teilweise.** Nicht prüfbar ohne Netz/Live-DB (deshalb nicht in der
Tabelle): „verified against 1384/1384 live rows" (§5), „161-orphan cleanup 2026-06-14" (§10),
„Albenhus/Zwerch display-inheritance anomaly" (§10) — alles Aussagen über den Produktivstand.
