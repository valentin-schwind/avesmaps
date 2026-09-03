# Flusstäler im Höhenfeld — Bauplan

> **Für agentische Ausführung:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Die Schritte tragen Checkboxen (`- [ ]`).

**Entwurf:** `docs/superpowers/specs/2026-09-03-flusstaeler-hoehenfeld-design.md` ·
**Mockup:** `docs/flusstaeler-hoehenfeld-mockup.html` (fährt den echten Feldbau; der Prototyp des
Talmoduls steht zwischen den Marken `PROTOTYP-MODUL` … `PROTOTYP-MODUL ENDE`) · **Fall:** #109

**Ziel:** Jeder `Flussweg`, der eine Gebirgsfläche berührt, senkt ihr Höhenfeld zu einem Tal —
automatisch, monoton fallend, linear zwischen den Knoten, ohne einen Gipfel oder den Flächenrand
anzutasten. Die Graustufen-Ansicht zeichnet die Flussläufe auf das Raster. Das Tal reist im
Höhenraster und damit nach dem nächsten Lauf in die Wegprofile.

**Architektur:** EIN neues reines Modul (`map-features-ecosystem-river-valley.js`), eingehängt als
letzter Schritt der EINEN Höhenabfrage `sampleEcosystemHeightField`; gebaut im Stapel
(`buildEcosystemHeightStack(areas, peaks, rivers)`) NACH allen Feldern. Karte liest die Flüsse aus
`pathData`, der Landschaften-Editor aus einem neuen kleinen Endpunkt; der Raster-Stempel kennt die
Flüsse. Kein DDL, keine neue Tabelle, kein neuer Regler.

**Technik:** Vanilla JS ohne Bauschritt (Ladereihenfolge in `index.html` und
`html/landschaften-editor.html` ist Vertrag), PHP 8 strict types + PDO. Tests: `node` mit `assert`
und `vm.runInContext` (Muster `ecosystem-heightmap-raster.test.js`), PHP mit `assert()` und
`-d zend.assertions=1`.

## Globale Zusicherungen

Gelten für **jede** Aufgabe:

- **Kommentare und Commit-Meldungen auf DEUTSCH** (AGENTS.md §8); `error.code`-Werte englisch.
- **Nur eigene Pfade stagen**, `git add <pfade> && git commit` in EINEM Zug (AGENTS.md §9 und §11,
  Prüfhaken-Falle). Nie `git add -A`/`.`/`-a`. Der Baum ist geteilt; `git status` zuerst.
- **Kein `?v=` von Hand**, kein `ASSET_VERSION`-Bump (die geänderten Dateien laufen über den Stempel
  von `index.html`/`html/*.html`).
- **Nichts hartkodieren, was ein Token hat** (§12): die zwei Flussfarben kommen aus
  `--color-path-flussweg` / `--color-path-bach`, gelesen wie `RAMP_TOKENS`.
- **Die Zahlen sind die des Mockups**, Zeichen für Zeichen: Talbreite `1.5` Einheiten, Bach-Anteil
  `0.5`, Gipfelanteil `0.5`, Abtastschritt `0.5`, Verkettungs-Toleranz `0.05`, Tiefe `1`. Ändert der
  Owner am Mockup eine Zahl, wird sie DORT geändert und hierher übernommen — nicht umgekehrt.
- 💣 **Ohne Flüsse bleibt das Feld bit-identisch.** Aufgabe 2 hält es mit einem Test fest, und jede
  spätere Aufgabe fährt ihn mit. Ein Stapel ohne dritten Parameter ist der Stand von heute.
- 💣 **Ausführen, nicht lesen.** Ein Quelltext-Test ist nur erlaubt, wo Laden nachweislich nicht geht
  (Begründung im Test) oder wo ein Namensvertrag zwischen zwei Dateien geprüft wird (Ladereihenfolge).
  Popups, Bauer, Abfragen werden aufgerufen.
- **Vor dem Push das GANZE Testfeld** mit dem Muster des Workflows (AGENTS.md §9, mit der Klammer um
  beide Gruppen und der Dateizahl-Gegenprobe), parallel. Ein roter fremder Test ist ein Befund, kein
  Rauschen.
- **Erst nach der letzten Aufgabe pushen.** Aufgabe 7 ist das Tor.

---

## Dateiübersicht

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `js/map-features/map-features-ecosystem-river-valley.js` | **neu** — das reine Talmodul | 1 |
| `js/map-features/__tests__/ecosystem-river-valley.test.js` | **neu** — Regeln des Moduls | 1 |
| `js/map-features/map-features-ecosystem-height-field.js` | ändern — `carve` als letzter Schritt der Abfrage | 2 |
| `js/map-features/map-features-ecosystem-height-combine.js` | ändern — dritter Parameter `rivers`, Talbau nach `compact()` | 2 |
| `js/map-features/__tests__/hoehenfeld-taeler-im-stapel.test.js` | **neu** — Stapel, Raster, Bit-Identität ohne Flüsse | 2 |
| `js/map-features/__tests__/ecosystem-heightmap-raster.test.js` | ändern — Ladeliste um das Modul ergänzen | 2 |
| `js/map-features/map-features-ecosystem-height-render.js` | ändern — `riverList()`, Überlagerung, Statuszeile, Ungültigkeits-Hilfe | 3 |
| `js/map-features/map-features-path-lifecycle.js` | ändern — vier Stellen rufen die Hilfe | 3 |
| `js/map-features/map-features-ecosystem-properties.js` | ändern — Statuszeile „Täler: …" | 3 |
| `index.html` | ändern — `<script>` vor `-height-combine.js` | 3 |
| `js/map-features/__tests__/hoehenfeld-fluesse-verdrahtung.test.js` | **neu** — Verdrahtung Karte | 3 |
| `api/edit/map/rivers-geometry.php` | **neu** — Flussstücke für den Rasterlauf | 4 |
| `api/_internal/app/rivers-geometry.php` | **neu** — die reine Zeilenformung + bbox-Berührung (vom Endpunkt und vom Stempel benutzt) | 4 |
| `api/_internal/app/__tests__/rivers-geometry-test.php` | **neu** | 4 |
| `html/landschaften-editor.html` | ändern — Flüsse laden, in den Stapel geben, Kachel zählt | 4 |
| `api/_internal/app/terrain-store.php` | ändern — Stempel kennt die Flüsse; Status zählt sie | 5 |
| `api/_internal/app/__tests__/terrain-store-test.php` | ändern — Fingerabdruck reagiert auf Flüsse | 5 |
| `AGENTS.md`, `docs/refactoring-map.md` (falls Ladereihenfolge dort steht) | ändern — Eintrag §11 | 6 |

---

## Aufgabe 1 — Das Talmodul (rein)

**Ziel:** `js/map-features/map-features-ecosystem-river-valley.js` mit genau der Rechnung des
Prototyps im Mockup, plus Test.

- [ ] Prototyp aus `docs/flusstaeler-hoehenfeld-mockup.html` (zwischen den Marken) in die neue Datei
      heben. Modulkopf im Stil der Nachbarmodule: was das Tal IST (Nachschritt der Abfrage), die
      sieben Regeln aus Entwurf §4 mit ihren Fallen (💣 außerhalb = keine Aussage; 💣 sortiert nach
      `public_id`; 💣 Gipfeldeckel gegen die ANGRENZENDEN Segmente; 💣 nie anheben). Exportnamen:
      `ECOSYSTEM_VALLEY_WIDTH`, `ECOSYSTEM_VALLEY_BACH_SHARE`, `ECOSYSTEM_VALLEY_PEAK_SHARE`,
      `ECOSYSTEM_VALLEY_SAMPLE_STEP`, `ECOSYSTEM_VALLEY_JOIN_TOLERANCE`, `ECOSYSTEM_VALLEY_DEPTH_SHARE`
      (= 1), `ecosystemValleyResample`, `ecosystemValleyPointSegmentDistance`,
      `buildEcosystemRiverCourses`, `buildEcosystemValleyIndex`, `carveEcosystemValley`, dazu
      `ecosystemValleyIsRiver`/`ecosystemValleyFlowDir`. Am Ende der `module.exports`-Block wie in den
      Nachbarn (`typeof module !== "undefined"`).
- [ ] `pointInGeometry` bleibt ein BARE GLOBAL (wie in `-height-field.js`), kein `require` — die Datei
      wird als `<script>` geladen. Im Kommentar sagen.
- [ ] Test `js/map-features/__tests__/ecosystem-river-valley.test.js` (Muster
      `ecosystem-height-field.test.js`: die ECHTEN Geometrie-Helfer als Globals hereinreichen). Fälle:
  - [ ] Abtastung: ein 3-Einheiten-Segment bei Schritt 0,5 gibt 7 Punkte, gespeicherte Stützpunkte
        bleiben exakt erhalten, `s` wächst monoton.
  - [ ] Orientierung: `reverse` dreht; ohne `dir` wird das höhere Ende (aus einem gegebenen
        `sampleUncarved`) zur Quelle und `dirGuessed === true`; Gleichstand behält die Reihenfolge.
  - [ ] Verkettung + Baum: Hauptfluss mit Gelände 1000→800→900→700 (Punkte in einem Quadrat) und
        Zufluss, der mit End-Talboden 300 am dritten Punkt mündet → Hauptfluss-Talboden ab dort ≤ 300;
        ohne Zufluss 1000, 800, 800, 700.
  - [ ] Linearer Deckel: Quelle 1000, Mündung 0, Gelände dazwischen 1000 → Talboden fällt linear
        (Mittelpunkt 500 ± Abtastschritt); mit `linear: false` bleibt 1000 bis zur Mündung.
  - [ ] Außerhalb = keine Aussage: ein Stück, dessen erste Hälfte außerhalb der Fläche liegt (dort
        `sampleUncarved` = 0), startet seinen Talboden mit der Höhe des ersten INNENpunkts, nicht mit 0.
  - [ ] Nie angehoben: `carveEcosystemValley(valley, x, y, 0) === 0` an jedem Punkt; `carve(h) <= h`
        über ein Raster.
  - [ ] Gipfelschutz: Gipfel 0,3 Einheiten neben einem Fluss, `w` an den Nachbarpunkten ≤ 0,15;
        `carve` am Gipfelpunkt gibt den Eingabewert zurück.
  - [ ] Stetigkeit: entlang einer Linie quer über eine Index-Zellgrenze ist die größte Änderung
        zwischen zwei Abtastpunkten (Schritt 0,01) kleiner als 1 % der Taltiefe.
  - [ ] Determinismus: Eingabeliste umgekehrt → `segments` inhaltlich identisch (Sortierung nach
        `public_id`).
  - [ ] Kreis: A mündet in B, B in A → beide bekommen einen Talboden, keine Endlosschleife, kein Wurf.
  - [ ] `depthShare: 0.5` lässt am Fluss `max(bed, 0.5 · h)` stehen.
- [ ] Lauf: `node js/map-features/__tests__/ecosystem-river-valley.test.js` grün. Mutationsprobe: drei
      Zeilen einzeln kippen (`max(0, …)` weg · `peakShare` auf 5 · `inside`-Weiche weg) — jede muss den
      Test rot machen.
- [ ] Commit: `feat(landschaften): Talmodul fuer Flusslaeufe im Hoehenfeld (rein, noch nicht
      eingehaengt) -- Fall #109`

## Aufgabe 2 — Einhängen in Abfrage und Stapel

**Ziel:** Karte, Raster und Stapelsumme lesen das Tal über die EINE Abfrage; ohne Flüsse ändert sich
nichts.

- [ ] `map-features-ecosystem-height-field.js`: den Rumpf von `sampleEcosystemHeightField` in
      `sampleEcosystemHeightFieldShaped` umbenennen (Warp/Slope unverändert), neue
      `sampleEcosystemHeightField(field, x, y, noiseWindow)` = `carveEcosystemValley(field.valley, x,
      y, shaped)`. Kommentar: 💣 die Messschleife (`loudest`/Mittelwert) ruft die Abfrage VOR dem
      Talbau, `field.valley` ist dort noch `null` — gewollt (Entwurf §5.1). `field.valley = null` im
      Feldobjekt anlegen (neben `noiseScale`), damit die Form vollständig ist.
- [ ] `map-features-ecosystem-height-combine.js`: `buildEcosystemHeightStack(areas, peaks, rivers)`.
      Nach `peakWindow.compact()`: je Feld `courses = buildEcosystemRiverCourses(field, rivers, (x, y)
      => sampleEcosystemHeightField(field, x, y, peakWindow.sample(x, y)), peakWindow.points)`,
      `field.valley = buildEcosystemValleyIndex(courses.segments)`, `field.valleyCourses = courses.pieces`
      (für Überlagerung und Statuszeile). `rivers` fehlt/leer → kein Talbau, `valley` bleibt `null`.
      💣 Kommentar: der Talbau steht NACH `compact()`, weil der Talboden das Fenster liest und dessen
      Radien erst nach dem Bau aller Felder feststehen (Entwurf §5.2).
- [ ] Test `js/map-features/__tests__/hoehenfeld-taeler-im-stapel.test.js` (Ladeliste wie
      `ecosystem-heightmap-raster.test.js`, PLUS das neue Modul VOR `-height-combine.js`):
  - [ ] Quadrat 0..100 mit Gipfel (50,50,3000) und Fluss von (20,80) nach (80,20) mit
        `flow.dir = "forward"` (läuft am Gipfel vorbei, nicht durch ihn) → am Fluss ist
        `sampleEcosystemHeightStack` ≤ dem Wert ohne Flüsse und ≥ 0; 3 Einheiten neben dem Fluss
        (jenseits `w`) identisch.
  - [ ] **Bit-Identität:** Stapel ohne dritten Parameter und Stapel mit `[]` liefern über ein 40×40-
        Raster exakt dieselben Zahlen wie ein direkt gebautes Feld ohne Talmodul-Wirkung
        (`field.valley === null`).
  - [ ] Raster: `rasterizeEcosystemHeightField(field, peakWindow, grid)` an einer Flusszelle ==
        `Math.round(sampleEcosystemHeightStack(...))` derselben Stelle (das Raster erbt, nichts
        Zweites wird gerechnet).
  - [ ] Zwei überlappende Quadrate, ein Fluss durch beide: die Summe entlang des Flusses fällt
        monoton (Talboden je Feld fällt, Summe fällt).
  - [ ] Gipfel im Stapel liest nach dem Talbau exakt seine Höhe (mit Fluss 0,4 daneben).
- [ ] `ecosystem-heightmap-raster.test.js`: Ladeliste um `map-features-ecosystem-river-valley.js`
      ergänzen (vor `-height-combine.js`), sonst ist `carveEcosystemValley` dort nicht definiert.
      Ebenso `ecosystem-height-combine.test.js` und jeder Test, der `-height-field.js` lädt — mit
      `grep -l "height-field.js" js/map-features/__tests__/*.js` die Liste ziehen und JEDEN fahren.
- [ ] Alle Höhen-Tests grün: `for t in js/map-features/__tests__/ecosystem-height*.test.js
      js/map-features/__tests__/hoehen*.test.js js/map-features/__tests__/gipfel*.test.js; do node "$t"
      || echo ROT $t; done`.
- [ ] Commit: `feat(landschaften): Fluesse senken das Hoehenfeld -- Talbau im Stapel, Tal in der
      einen Abfrage, Raster erbt (Fall #109)`

## Aufgabe 3 — Die Karte: Flüsse aus `pathData`, Überlagerung, Ungültig-werden

**Ziel:** Der Topographie-Dialog zeigt Täler und Flussläufe; ein geänderter Fluss zieht das Feld nach.

- [ ] `index.html`: `<script src="js/map-features/map-features-ecosystem-river-valley.js">` direkt VOR
      `map-features-ecosystem-height-combine.js` (Zeile ~3775), mit Kommentar (kein Dateipfad im
      Kommentar — Ladereihenfolge-Tests messen mit `indexOf`, AGENTS.md §11 Hintergrundklick).
- [ ] `map-features-ecosystem-height-render.js`:
  - [ ] `riverList()`: `pathData` (global, wie `labelData`) → nur `feature_subtype === "Flussweg"`,
        unverändert durchreichen (das Modul liest `properties.flow.dir`, `properties.is_bach`,
        `geometry.coordinates`). `pathData` undefiniert → `[]`.
  - [ ] `ensureStack()`: `buildEcosystemHeightStack(topographyAreas(), peakList(), riverList())`.
  - [ ] Überlagerung in `redraw()` NACH `putImageData`, nur `solidMode`: je Feld
        `field.valleyCourses` → Linien in CSS-Pixeln (`dpr`-Transform steht), Fluss 1,5 px
        `--color-path-flussweg`, Bach 1 px `--color-path-bach`, `setLineDash([4, 3])` bei
        `dirGuessed`. Token wie `rampColors()` lesen und cachen; im Dunkelmodus kommt der andere Wert
        von selbst (Token). Projektion mit derselben affinen Regel wie die Malschleife
        (`originLatLng`/`deltaX`/`deltaY`), nicht `latLngToContainerPoint` je Punkt.
  - [ ] `window.avesmapsHoehenfeldFlussGeaendert(path)`: wenn `path.properties.feature_subtype ===
        "Flussweg"` (oder der alte Subtyp es war) → `invalidateEcosystemHeightField(); redraw();`.
        Gemeldet in `window.AvesmapsEcosystemHeightRender` als `riverChanged`.
  - [ ] Zahl für die Statuszeile: `AvesmapsEcosystemHeightRender.valleySummary(areaPublicId)` →
        `{ pieces, baeche, geraten }` aus `field.valleyCourses` der Fläche.
- [ ] `map-features-path-lifecycle.js`: in `addCreatedPathFeature`, `applyLivePathFeature` (neuer
      Weg), `applyPathFeatureResponse`, `removePathFeature` direkt nach
      `avesmapsWegEinschraenkungNeuRechnen()`: `window.AvesmapsEcosystemHeightRender?.riverChanged?.(path)`.
      💣 In `applyPathFeatureResponse` den Subtyp VOR dem Überschreiben merken — ein Fluss, der zum
      Weg umgetypt wird, ist ebenfalls eine Änderung.
- [ ] `map-features-ecosystem-properties.js` (`renderTerrainControls`): Statuszeile
      `ecosystem-properties-terrain-status` sichtbar setzen mit „Täler: N Flussstücke senken diese
      Fläche (M Bäche, K ohne Fließrichtung)." — 0 Stücke: „Täler: kein Fluss berührt diese Fläche."
      Zahlen aus `valleySummary`. Beim Neuzeichnen der Regler aktualisieren (die Zeile wird bereits
      für Fehler benutzt — Fehler gewinnt).
- [ ] Test `js/map-features/__tests__/hoehenfeld-fluesse-verdrahtung.test.js`:
  - [ ] Ladereihenfolge in `index.html`: Talmodul vor `-height-combine.js`, HTML-Kommentare vorher
        strippen (die acht Tests seit `efd669eab` machen es so).
  - [ ] `riverList()` als Funktion aus dem Render-Modul ausschneiden und mit `pathData` = [Flussweg,
        Strasse, Flussweg] ausführen → 2 Einträge, unverändert.
  - [ ] Die vier Lebenszyklus-Funktionen aus `path-lifecycle.js` per `vm` mit Attrappen (`pathData`,
        `createPathLayer`, `$`, `map`, …) AUSFÜHREN und zählen, dass `riverChanged` je einmal mit dem
        Weg gerufen wird — auch beim Umtypen Fluss → Weg.
  - [ ] Überlagerung: die zwei Token-Namen stehen im Render-Modul (Namensvertrag zu `tokens.css`,
        beide Token existieren dort in hell UND dunkel — Quelltext-Test, begründet: `tokens.css` ist
        kein JS).
- [ ] **Browser-Abnahme** (Ablauf, nicht Maß — AGENTS.md §9): Preview `quellen-formular-mockup`
      (statischer `php -S` über die Repo-Wurzel) mit `?edit=1` … die Karte braucht Login für den
      Dialog; ohne Login: im Mockup gegenprüfen, dass die gemalte Rinne der Karte entspricht, und die
      Live-Abnahme in Aufgabe 7 dem Owner überlassen. Mindestens: `index.html` lädt ohne
      Konsolenfehler als Besucher (Talmodul wird geladen, `pathData` da, Stapel baut nicht — kein
      Dialog).
- [ ] Commit: `feat(landschaften): Flusslaeufe liegen auf dem Hoehenprofil, das Feld folgt einem
      verschobenen Fluss sofort (Fall #109)`

## Aufgabe 4 — Der Landschaften-Editor: Flüsse für den Rasterlauf

**Ziel:** Der Rasterlauf rechnet dieselben Täler wie die Karte.

- [ ] `api/_internal/app/rivers-geometry.php` **neu**, rein (nur `function`, kein PDO am Kopf):
  - [ ] `avesmapsRiverRowsTouchingBounds(array $rows, array $bounds): array` — bbox-Berührung
        (`min_x/max_x/min_y/max_y` der Zeile gegen eine Liste von Flächen-bboxes, plus Talbreite als
        Rand: `AVESMAPS_RIVER_VALLEY_PAD = 1.5`, 💣 mit Kommentar, dass die Zahl
        `ECOSYSTEM_VALLEY_WIDTH` im JS spiegelt — PHP kann die JS-Konstante nicht lesen, dieselbe
        Notiz wie bei `AVESMAPS_PEAK_LABEL_SUBTYPES`).
  - [ ] `avesmapsRiverRowToFeature(array $row): ?array` — aus `public_id, geometry_json,
        properties_json, revision` die Form von `pathData`: `{ properties: { public_id,
        feature_subtype: "Flussweg", is_bach, flow: { dir } | null, revision }, geometry }`. Kein
        `LineString` → `null`.
  - [ ] `avesmapsRiverStampInputs(PDO $pdo): array` — die Zeilen (`public_id`, `revision`) aller
        `Flussweg`-Stücke, deren bbox eine Gebirgsfläche berührt: `SELECT public_id, revision, min_x,
        …` über `map_features WHERE feature_type = 'path' AND feature_subtype = 'Flussweg' AND is_active
        = 1`, Flächen-bboxes aus `ecosystem_area` (gebirge, aktiv) — Filter in PHP mit der reinen
        Funktion. Aufgabe 5 benutzt sie.
- [ ] `api/edit/map/rivers-geometry.php` **neu**, Zwilling von `peaks-geometry.php` (GET, `edit`,
      kein DDL, kein `getMessage()` zum Client): antwortet `{ ok, map_revision, rivers: [Feature…],
      skipped }`, gefiltert mit `avesmapsRiverRowsTouchingBounds`.
- [ ] Test `api/_internal/app/__tests__/rivers-geometry-test.php`: Zeilenformung (`flow.dir` aus
      `properties_json`, `is_bach` strikt `=== true`, kein LineString → null), bbox-Berührung inklusive
      Rand, ein Stück knapp außerhalb aller Flächen fällt heraus.
- [ ] `html/landschaften-editor.html`:
  - [ ] `<script src="/js/map-features/map-features-ecosystem-river-valley.js">` vor
        `-height-combine.js` (Zeile ~215).
  - [ ] `RIVERS_API = "/api/edit/map/rivers-geometry.php"`, `loadRivers()` wie `loadPeaks()`,
        `allRivers` (null = nie geholt), geholt im Rasterlauf neben `allPeaks`.
  - [ ] `buildEcosystemHeightStack(gebirge, peaks…, allRivers)`.
  - [ ] Kachel „Höhenraster": `heightmapStatus.rivers_total` (Aufgabe 5) → „· 231 Flussstücke".
- [ ] Test (Text, begründet: eingebettetes Skript einer HTML-Seite, Namensvertrag): Ladereihenfolge in
      `landschaften-editor.html`; `buildEcosystemHeightStack(` bekommt dort drei Argumente;
      `RIVERS_API` zeigt auf den Endpunkt-Pfad.
- [ ] Commit: `feat(landschaften): der Rasterlauf des Landschaften-Editors rechnet die Flusstaeler
      mit -- neuer Editor-Endpunkt fuer Flussstuecke (Fall #109)`

## Aufgabe 5 — Der Stempel kennt die Flüsse

**Ziel:** Ein geänderter Fluss macht die Raster „veraltet"; die Kachel zählt die Flüsse.

- [ ] `terrain-store.php`: `avesmapsTerrainReadStampInputs` liefert zusätzlich `rivers` (aus
      `avesmapsRiverStampInputs`); `avesmapsTerrainPeaksFingerprint(array $peaks, array $heightAreas,
      array $rivers = [])` hängt `'#' . implode('|', sortierte "public_id:revision")` an. Docblock:
      🔴 der Name `peaks_fingerprint` trägt seit heute Gipfel UND Flüsse (Entwurf §5.4, dieselbe
      Namensgeschichte wie `terrain_avg_height`). `heightmap_put` und `heightmap_status` reichen die
      Flüsse durch; `avesmapsTerrainHeightmapStatus` gibt `rivers_total` mit.
- [ ] `require_once __DIR__ . '/rivers-geometry.php'` am Kopf von `terrain-store.php` — die Datei ist
      rein, das ist erlaubt (wie `terrain-factor.php`).
- [ ] `terrain-store-test.php` erweitern: Fingerabdruck ändert sich, wenn `revision` eines Flusses
      steigt; ändert sich NICHT, wenn ein Fluss außerhalb jeder Gebirgs-bbox hinzukommt (der wird
      vorher gefiltert — das prüft die reine Funktion aus Aufgabe 4); Reihenfolge der Flüsse
      egal (sortiert).
- [ ] `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d
      extension=php_pdo_sqlite.dll api/_internal/app/__tests__/terrain-store-test.php` grün, ebenso
      `heightmap-read-test.php`.
- [ ] Commit: `feat(landschaften): ein geaenderter Fluss macht die Hoehenraster veraltet -- der Stempel
      traegt die Flussstuecke, die Kachel zaehlt sie (Fall #109)`

## Aufgabe 6 — Dokumentation

- [ ] `AGENTS.md` §11: EIN Eintrag „**Flusstäler im Höhenfeld** — jeder Flussweg senkt die
      Gebirgsfläche, die er berührt" mit den tragenden Fallen (💣 außerhalb = keine Aussage · 💣 Talbau
      NACH `compact()` · 💣 Stempel-Name · 💣 die zwei Flussquellen müssen dieselbe Form ergeben) und
      dem Verweis auf Entwurf und Mockup. Keine Zahl als „vollständige Liste".
- [ ] `AGENTS.md` §10 (Perf-Zeile zum Höhenfeld, falls vorhanden) um die gemessenen +20 % ergänzen.
- [ ] `docs/oekosystem-instruction.md` §4.3: eine Zeile, dass Flüsse seit diesem Datum Randbedingung
      sind (Pässe/Wege weiterhin nicht).
- [ ] Commit: `docs(landschaften): Flusstaeler im Hoehenfeld -- Eintrag in AGENTS.md, Verweis in der
      Bauanleitung`

## Aufgabe 7 — Das Tor

- [ ] Ganzes Testfeld, beide Workflow-Muster, parallel (AGENTS.md §9), Dateizahl gegen
      `.github/workflows/deploy-avesmaps-strato.yml` gegengeprüft. Null rot (außer
      `linkcheck/link-url-test.php`).
- [ ] `usability-konsistenz` gegen Entwurf §4.7 und §11 fahren; `mockup-treue` gegen
      `docs/flusstaeler-hoehenfeld-mockup.html` (Konstanten Zeichen für Zeichen, Farben aus Token).
- [ ] `git fetch`, `gh run list --status in_progress` (kein fremder Deploy läuft), Rebase, Push,
      Remote-SHA prüfen. 1–2 min warten.
- [ ] **Live als Besucher** (kein `edit=1`): Konsole leer, Karte lädt Beschriftungen (die Regression
      vom 03.09. war genau hier).
- [ ] 🔧 **DU (Owner):** Rote Sichel im Topographie-Dialog ansehen (Entwurf §11, Schritte 1–4); dann
      Landschaften-Editor → Rechnen ▾ → **Höhenraster** (alle 69 veraltet), danach **Wegprofile**.
      Vorher/nachher „Auf und ab" einer Talroute notieren.
- [ ] Discord: Fall #109 mit einer Zeile beantworten (Pfad zur Live-Ansicht, was sich ändert, dass die
      Fließrichtung fehlender Stücke die Annahme „Quelle liegt höher" ablöst).
