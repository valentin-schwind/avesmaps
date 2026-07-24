# Landschaften — Implementierungsplan

> **Für agentische Arbeiter:** Dieser Plan ist in **fünf eigenständige Vorhaben**
> geschnitten. Jedes ist für sich nützlich und wird **einzeln beauftragt**. Ein Agent
> bearbeitet **eine Aufgabe je Sitzung**; nach jeder Abnahme beginnt eine neue Sitzung.
> Sub-Skill: `superpowers:subagent-driven-development`.

**Grundlage:** `docs/superpowers/specs/2026-07-24-landschaften-machbarkeitsanalyse.md`
(inkl. §8, der Revision nach adversarialer Prüfung). Vorarbeit: `docs/oekosystem-*.md`,
Demo `html/landschaften-modell.html`.

**Ziel:** Eine Kartenebene „Landschaften" im Edit-Modus, in der Editoren
Vegetations-, Topographie- und Regionsflächen zeichnen — als Grundlage für
Reisezeit-Wirkung, Fundort-Anzeige und Suche.

**Architektur:** Eigene Tabellen, eigener Endpunkt, eigener Revisionszähler, eigene
Leaflet-Pane, eigene Zeichenschicht. Die politische Ebene wird **gelesen und
abgeschrieben**, nie aufgerufen und nie verändert.

**Technik:** Vanilla JS ohne Build, Leaflet 1.9.4 (`L.CRS.Simple`), PHP 8 + MySQL/PDO
auf STRATO Shared Hosting, `polygon-clipping` (bereits im Haus).

---

## Globale Regeln

Diese gelten in **jeder** Aufgabe, ohne dass sie dort wiederholt werden.

1. 🔴 **Politische Dateien werden nicht bearbeitet und nicht zur Laufzeit aufgerufen.**
   Nicht `js/map-features/map-features-region-*`, nicht `js/territory/*`, nicht
   `api/_internal/political/*`. Erlaubt ist ausschließlich **lesen und abschreiben**.
   Auch die „reine Mathematik" nicht — ein Aufruf koppelt in die Gegenrichtung.
   Prüfung: `git status` zeigt keine politische Datei.
2. 🔴 **Quellen laufen über `sources` + `feature_sources`.**
   `CREATE TABLE ecosystem_source` ist verboten (AGENTS.md §5). Der Anschluss ist je
   eine Zeile in `api/edit/map/feature-sources.php` und `api/app/feature-sources.php`.
3. 🔴 **Ein Flächen-Save fasst `map_revision` niemals an.** Eigener Zähler
   `ecosystem_revision`, eigener ETag, eigener Endpunkt. Begründung: 2.000
   Speichervorgänge × 14 MB Payload-Invalidierung für alle Besucher.
4. 🔴 **Der Totmannschalter greift an vier Stellen** — Modus-Eintrag, öffentlicher
   Lesepfad (serverseitig, Zeilen verlassen die Box nicht), Routing-Wirkung, Payload.
   `?landschaften=1` ist ein **Client**-Flag und sichert nichts; die Sicherung ist
   `app_setting`.
5. **Geteilter Arbeitsbaum:** nie `git add -A`. Nur eigene Pfade einzeln stagen.
   Eigener Worktree empfohlen — `git status` zeigt derzeit fremde offene Arbeit,
   darunter `js/review/review-wiki-sync.js`.
6. **Jeder neue Top-Level-Name wird vor dem Commit gegen `grep` über `js/` geprüft.**
   164 klassische `<script>`-Tags teilen einen globalen Scope; ein doppelter `const`
   killt eine Datei still, und Node-Tests sehen das prinzipiell nie.
7. **Abnahme im Browser, nie „Tests grün".** Konsole auf `SyntaxError` prüfen und
   `typeof window.<neuerGlobal>` abfragen. Es gibt **keine lokale Datenbank**
   (`api/config.local.php` fehlt) — jeder DB-Pfad ist nur live prüfbar.
8. **Deutsch in der Oberfläche, Englisch in Code, Kommentaren und Commits.** Neue
   UI-Strings gehören zusätzlich in `js/app/i18n-en.js`.
9. **Kein `?v=` von Hand.** Ausnahme: `edit/index.php` (der Stamper erreicht keine
   `.php`-Seite) und `ASSET_VERSION` in `js/territory/territory-editor-inline-host.js`.

---

## Der Schnitt

| | Vorhaben | Ergebnis | Umfang |
|---|---|---|---|
| **V0** | Routing entlasten | schneller, **auch ohne Landschaften** | ~200 Z. |
| **V1** | Die Ebene existiert | Modus umschaltbar, leer, Flag wirkt | ~250 Z. |
| **V2** | Daten und API | Fläche per API anlegen/lesen/ändern/löschen | ~800 Z. |
| **V3** | Zeichnen | Fläche entsteht mit Klicks und überlebt Reload | ~1.400 Z. |
| **V4** | Abnahme + Messung | **20 Flächen, Zeit gestoppt** | kein Code |

> **V0–V4 sind das ganze erste Vorhaben.** Alles Weitere — Editor, Topographie,
> Vorberechnung, Routing-Wirkung, Suche — wird **neu beauftragt**, wenn echte Flächen
> auf der Karte liegen und sich das Zeichnen gut anfühlt. Skizze am Ende.

---

# V0 — Routing entlasten

**Warum zuerst:** Der Routing-Pfad trägt heute einen 983-ms-Posten je Anfrage. Terrain
würde ihn multiplizieren. Und dieses Vorhaben ist **auch dann richtig, wenn die
Landschaften nie kommen** — es hat mit ihnen nichts zu tun.

### Aufgabe V0.1 — Gitter-Hash für die Endpunktsuche

**Dateien:**
- Ändern: `api/_internal/routing/client-graph.php:620–633` (`avesmapsFindClientLocationAtPathEndpoint`)
- Ändern: `api/_internal/routing/client-graph.php:98–110` (Aufrufstelle, Index einmal bauen)
- Test: `tools/routing/test-client-graph-endpoint-index.php` (neu)

**Schnittstellen:**
- Erzeugt: `avesmapsBuildClientLocationCoordinateIndex(array $locations): array` —
  Schlüssel `"{round(x*2)}:{round(y*2)}"`, Wert = Liste von Ortsindizes.
- `avesmapsFindClientLocationAtPathEndpoint` behält Signatur und Rückgabe **exakt**;
  nur die Suche innen wird ersetzt. Der Toleranzwert `THRESHOLD = 0.5` (`js/config.js:2`)
  bleibt maßgeblich, das Raster ist deshalb `0.5` und es werden **9 Zellen** geprüft.

- [ ] **Schritt 1: Test schreiben, der die alte und neue Suche gegeneinander stellt**

```php
// tools/routing/test-client-graph-endpoint-index.php
// Deckungsgleichheit ist die einzige Anforderung: fuer JEDEN Punkt muss die
// indizierte Suche denselben Ort liefern wie die lineare -- auch bei Fehlschlag.
$locations = [];
for ($i = 0; $i < 4000; $i++) {
    $locations[] = ['name' => "Ort$i", 'coordinates' => [($i * 7) % 1024 + 0.13, ($i * 13) % 1024 + 0.37]];
}
$index = avesmapsBuildClientLocationCoordinateIndex($locations);
$mismatches = 0;
foreach ($locations as $loc) {
    $probe = [$loc['coordinates'][0] + 0.2, $loc['coordinates'][1] - 0.2];   // innerhalb THRESHOLD
    $linear = avesmapsFindClientLocationLinearForTest($locations, $probe);
    $hashed = avesmapsFindClientLocationAtPathEndpoint($locations, $index, $probe);
    if (($linear['name'] ?? null) !== ($hashed['name'] ?? null)) { $mismatches++; }
}
// Zusaetzlich 1000 Punkte, die GARANTIERT daneben liegen (Fehlschlag muss auch stimmen)
assert($mismatches === 0, "Indizierte Suche weicht ab: $mismatches Faelle");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 tools/routing/test-client-graph-endpoint-index.php
```
Erwartet: `Fatal error: Uncaught Error: Call to undefined function avesmapsBuildClientLocationCoordinateIndex`

⚠️ **Ohne `-d zend.assertions=1` prüft `assert()` gar nichts** und der Test meldet grün.

- [ ] **Schritt 3: Index bauen und Suche ersetzen**

```php
// Raster = THRESHOLD (0.5). Ein Treffer kann in der eigenen oder einer der acht
// Nachbarzellen liegen, nie weiter -- deshalb genuegen 9 Zellen statt 3.949 Orten.
function avesmapsBuildClientLocationCoordinateIndex(array $locations): array {
    $index = [];
    foreach ($locations as $i => $location) {
        $c = $location['coordinates'] ?? null;
        if (!is_array($c) || count($c) < 2) { continue; }
        $key = ((int) round($c[0] * 2)) . ':' . ((int) round($c[1] * 2));
        $index[$key][] = $i;
    }
    return $index;
}
```
Die Suche iteriert `for ($dx = -1; $dx <= 1; $dx++) for ($dy = -1; $dy <= 1; $dy++)`
über die Kandidaten und behält den **bisherigen** Abstandsvergleich unverändert.

- [ ] **Schritt 4: Test laufen lassen, Erfolg bestätigen**

```bash
php -d zend.assertions=1 tools/routing/test-client-graph-endpoint-index.php
```
Erwartet: `OK` und eine ausgegebene Zeitmessung beider Varianten.

- [ ] **Schritt 5: Bestehende Routing-Tests laufen lassen**

```bash
php -d zend.assertions=1 tools/routing/test-client-graph-flow.php
```
Erwartet: unverändert grün. Der Flow-Test ist das Schutzgeländer.

- [ ] **Schritt 6: Commit**

```bash
git add api/_internal/routing/client-graph.php tools/routing/test-client-graph-endpoint-index.php
git commit -m "perf(routing): grid-hash the endpoint lookup instead of scanning all locations"
```

- [ ] **Schritt 7: 🔧 DU (Owner): Live-Abnahme**

Eine bekannte Route planen (z. B. Gareth → Tuzak) und mit einer vor dem Umbau
gespeicherten Antwort vergleichen. **Identisch**, nur schneller. Ein einzelner
Aufruf — nicht in einer Schleife.

### Aufgabe V0.2 — Dijkstra: Abbruch am Ziel und Settled-Set

**Dateien:** Ändern `api/_internal/routing/client-graph.php:743–763`

- [ ] **Schritt 1: Test — dieselbe Route, identisches Ergebnis, weniger Iterationen**
- [ ] **Schritt 2: `break`, sobald `$currentNode === $endName` extrahiert wurde**
      (Vorlage: `api/_internal/routing/graph.php:522` hat es bereits)
- [ ] **Schritt 3: `$settled[$node] = true` beim Extrahieren; veraltete Heap-Einträge überspringen**
      (Der Client hat diesen Guard bereits: `route-graph-core.js:110`)
- [ ] **Schritt 4: Flow-Tests laufen lassen — unverändert grün**
- [ ] **Schritt 5: Commit** — `perf(routing): stop dijkstra at the target and skip settled nodes`

### Aufgabe V0.3 — Typfilter in der Ladequery

**Dateien:** Ändern `api/_internal/routing/map-data.php:41`

- [ ] **Schritt 1:** `AND feature_type <> 'powerline'` ergänzen. Verhaltensgleich —
      `network-data.php:76/:92` wirft diese Zeilen ohnehin weg — spart Transfer und
      `json_decode`.
- [ ] **Schritt 2:** Flow-Tests grün.
- [ ] **Schritt 3: Commit** — `perf(routing): stop loading powerline rows the graph discards`

### Aufgabe V0.4 — Zeitlimit im Routing-Endpunkt

**Dateien:** Ändern `api/route/index.php` (vor dem POST-Zweig, Zeile ~312)

- [ ] **Schritt 1:** `@set_time_limit(30);` ergänzen. `api/route/` ist der **einzige**
      schwere Pfad ohne — 12 andere Batch-Endpunkte haben es.
- [ ] **Schritt 2: Commit** — `fix(routing): give the route endpoint an explicit time limit`

### Aufgabe V0.5 — Die teuren Diagnosen absichern

**Dateien:** Ändern `api/route/index.php:24–310`

**Warum:** `?diagnostic=graph-data` baut acht Graphen und ruft viermal eine offene
Doppelschleife über alle Knoten — gemessen **11,3 s bei 10.000 Knoten**,
unauthentifiziert, ohne Rate-Limit. `?diagnostic=route-name-data` fährt einen vollen
Routenlauf per GET, also von Crawlern indexierbar.

- [ ] **Schritt 1:** Die teuren Zweige (`graph-data`, `route-name-data`, `dijkstra-data`)
      hinter `avesmapsRequireUserWithCapability($pdo, 'edit')` legen. Die leichten
      (`map-data`, `network-data`) bleiben offen.
- [ ] **Schritt 2: 🔧 DU (Owner):** Ohne Session `curl` auf `?diagnostic=graph-data` →
      **401**, nicht 200 nach 11 Sekunden.
- [ ] **Schritt 3: Commit** — `fix(routing): gate the expensive route diagnostics behind edit capability`

---

# V1 — Die Ebene existiert

**Fertig, wenn:** Umschalten auf „Landschaften (Erprobung)" zeigt die Karte
vollständig, die eigene Pane existiert und ist leer, hin- und zurückschalten
beschädigt die politische Ebene nicht, und **ohne** `?landschaften=1` ist alles wie
heute.

### Aufgabe V1.1 — Flag und Modus

**Dateien:**
- Ändern: `js/config.js:198` (neben `IS_EDIT_MODE`)
- Ändern: `index.html:1425–1431` (`<option>`)
- Ändern: `js/map-features/map-features-display-mode.js:155` (Whitelist)
- Ändern: `js/config.js:509–516` (Icon)
- Ändern: `js/app/i18n-en.js:79–86` (Übersetzung)
- Ändern: `js/map-features/map-features.js:31` (Option entfernen, wenn Flag fehlt)

> 🔴 **Fünf Stellen müssen übereinstimmen.** Fehlt eine, fällt der Modus **stumm** auf
> `deregraphic` zurück — kein Fehler, keine Meldung. `js/config.js:483`
> (Standardmodus) wird **nicht** angefasst.

- [ ] **Schritt 1: Flag lesen**

```js
// js/config.js, direkt unter IS_EDIT_MODE
// Totmannschalter. Client-seitig ist das reine Sichtbarkeit -- die Absicherung des
// Lesepfads sitzt serverseitig in app_setting (siehe V2.2).
const IS_LANDSCHAFTEN_ENABLED = INITIAL_SEARCH_PARAMS.get("landschaften") === "1";
```

- [ ] **Schritt 2: `<option>` einfügen** (`index.html`, nach `powerlines`)

```html
<option value="landschaften" data-i18n="view.mode.landschaften">Landschaften (Erprobung)</option>
```

- [ ] **Schritt 3: Whitelist erweitern**

```js
const normalizedMode = ["none", "political", "deregraphic", "powerlines", "original", "landschaften"]
    .includes(mode) ? mode : DEFAULT_PLANNER_STATE.mapLayerMode;
```

- [ ] **Schritt 4: Icon und Übersetzung ergänzen** (`config.js:509`, `i18n-en.js:79`)

- [ ] **Schritt 5: Option entfernen, wenn das Flag fehlt**

```js
// js/map-features/map-features.js, VOR initializeTransportIconSelects()
// Muss vor dem Aufbau der Combobox laufen -- sie baut sich aus den <option>-Elementen.
if (!IS_EDIT_MODE || !IS_LANDSCHAFTEN_ENABLED) {
    $("#mapLayerModeSelect option[value='landschaften']").remove();
}
```

- [ ] **Schritt 6: 🔧 DU (Owner): Browser-Abnahme, nicht Codelesen**

Mit `?edit=1&landschaften=1`: Eintrag da, umschalten funktioniert, Konsole leer.
Ohne `landschaften=1`: Eintrag weg. In der Konsole `getSelectedMapLayerMode()` —
muss `"landschaften"` liefern, nicht `"deregraphic"`.

- [ ] **Schritt 7: Commit** — `feat(landschaften): add the map mode behind ?landschaften=1`

### Aufgabe V1.2 — Anzeige-Häkchen für Labels und Grenzen

**Dateien:**
- Ändern: `index.html:1461–1467` (zwei `<label>` in die Häkchenreihe)
- Ändern: `js/map-features/map-features.js:47–53` (sichtbar schalten)
- Ändern: `js/map-features/map-features-labels.js:494–505` (`shouldShowLabelMarker`)
- Ändern: `js/map-features/map-features-boundary-canvas-overlay.js` (Sichtbarkeitsprüfung)

**Warum eigenständig nützlich:** Beim Zeichnen stehen Labels und Territoriengrenzen
im Weg — beim Landschaften-Zeichnen *und* beim Territorien-Zeichnen. Dieser Baustein
bleibt auch dann nützlich, wenn die Landschaften nie fertig werden.

> **Die Haken übersteuern den Modus, sie ergänzen ihn nicht.** Beim Zeichnen von
> Maraskan will man die Territoriengrenzen **sehen** (als Vorlage für den späteren
> Grenzimport), obwohl sie im Landschaften-Modus nach Modusregel unsichtbar wären.

- [ ] **Schritt 1: Häkchen einfügen**

```html
<label id="toggleMapLabelsControl" hidden><input type="checkbox" id="toggleMapLabels" checked /> Labels</label>
<label id="toggleTerritoryBordersControl" hidden><input type="checkbox" id="toggleTerritoryBorders" checked /> Grenzen</label>
```

- [ ] **Schritt 2: Nur im Edit-Modus sichtbar schalten** (neben `#togglePathsControl`)

- [ ] **Schritt 3: Sichtbarkeit übersteuern — additiv, ohne Frontend-Wirkung**

```js
// js/map-features/map-features-labels.js, in shouldShowLabelMarker()
// Der Haken uebersteuert den Kartenmodus in BEIDE Richtungen -- aber nur im Edit-Modus.
// Im Frontend ist IS_EDIT_MODE false, die Pruefung faellt weg, das Verhalten bleibt exakt wie heute.
if (IS_EDIT_MODE) {
    const box = document.getElementById("toggleMapLabels");
    if (box && !box.checked) { return false; }
    if (box && box.checked) { return true; }
}
```

- [ ] **Schritt 4: 🔧 DU (Owner):** Haken aus → Labels weg, im politischen *und* im
      Standard-Modus. Ohne `?edit=1` sind beide Haken nicht da und nichts ändert sich.
- [ ] **Schritt 5: Commit** — `feat(edit): toggle map labels and territory borders independently of the mode`

### Aufgabe V1.3 — Eigene Pane und eigene Registry

**Dateien:**
- Ändern: `js/app/bootstrap.js:16–44` (Pane anlegen)
- Ändern: `js/app/runtime-state.js` (eigene Registry)
- Erstellen: `js/map-features/map-features-landschaften-visibility.js`

> 🔴 **Drei Fallen, alle verifiziert:**
> 1. `regionPolygons` **nicht** mitbenutzen — `clearRenderedRegionLayers()`
>    (`map-features-region-rendering.js:150`) leert es bei **jedem** `moveend`.
> 2. `syncRegionVisibility` **nicht** erweitern — es ist zweimal definiert, der Loader
>    (`map-features-political-territory-loader.js:473`) gewinnt und überschreibt
>    dreimal zeitverzögert.
> 3. Eigene Funktionsnamen — `map-features-region-vertex-detach-edit.js` überschreibt
>    sieben Handler zur Laufzeit; ein gleichnamiger Name killt **die politische Ebene**.

- [ ] **Schritt 1:** Pane `landschaftenPane`, z-index **250** (frei ist 201–299;
      `regionsPane` liegt bei 200, die nächste Belegung bei 300).
- [ ] **Schritt 2:** `landschaftenLayers = []` in `runtime-state.js` — eigene Registry.
- [ ] **Schritt 3:** `syncLandschaftenVisibility()` schreiben und in
      `setSelectedMapLayerMode()` (`map-features-display-mode.js:184–189`) einhängen.
- [ ] **Schritt 4: Namensprüfung**

```bash
grep -rn "landschaftenLayers\|syncLandschaftenVisibility" js/ --include=*.js | grep -v "landschaften-"
```
Erwartet: keine Treffer außerhalb der eigenen Dateien.

- [ ] **Schritt 5: 🔧 DU (Owner):** Umschalten hin und zurück, dann eine politische
      Territoriumsecke ziehen — sie muss sich noch bewegen. Und die Karte
      **schwenken** (nicht zoomen), denn `clearRenderedRegionLayers` hängt an `moveend`.
- [ ] **Schritt 6: Commit** — `feat(landschaften): own pane, own registry, own visibility sync`

---

# V2 — Daten und API

**Fertig, wenn:** Eine Fläche lässt sich per API anlegen, lesen, ändern und weich
löschen — **ohne Karte**, mit `curl` verifizierbar.

### Aufgabe V2.1 — Tabellen

**Dateien:** Erstellen `api/_internal/app/ecosystem.php` (Inline-DDL, selbstheilend)

```sql
CREATE TABLE IF NOT EXISTS ecosystem_region (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL DEFAULT '',
  kind VARCHAR(16) NOT NULL,               -- derographisch | vegetation | topographie
  region_type VARCHAR(40) NULL,
  origin VARCHAR(8) NOT NULL DEFAULT 'own',
  wiki_region_key VARCHAR(190) NULL,
  wiki_url VARCHAR(500) NULL,
  properties_json LONGTEXT NULL,
  is_trial TINYINT(1) NOT NULL DEFAULT 1,  -- Erprobungsphase, siehe V4
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ecosystem_region_public_id (public_id),
  KEY idx_ecosystem_region_kind_active (kind, is_active),
  KEY idx_ecosystem_region_wiki (wiki_region_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecosystem_area (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL,
  region_id INT UNSIGNED NOT NULL,
  geometry_geojson LONGTEXT NOT NULL,
  min_x DECIMAL(10,4) NOT NULL, min_y DECIMAL(10,4) NOT NULL,
  max_x DECIMAL(10,4) NOT NULL, max_y DECIMAL(10,4) NOT NULL,
  geometry_revision INT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(190) NULL, updated_by VARCHAR(190) NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ecosystem_area_public_id (public_id),
  KEY idx_ecosystem_area_region (region_id, is_active),
  KEY idx_ecosystem_area_bbox (min_x, min_y, max_x, max_y)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ecosystem_region_type (
  kind VARCHAR(16) NOT NULL,
  type_key VARCHAR(40) NOT NULL,
  label VARCHAR(190) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (kind, type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Keine Spalten für:** `min_zoom`/`max_zoom`, `parent_id`, `valid_from_bf`/`valid_to_bf`,
kein `relief`-Feld. Wer sie aus dem politischen Schema mitkopiert, baut den Apparat
wieder auf, den wir gerade weglassen.

**Vokabular als Seed** (drei getrennte Listen, keine gefilterte Gemeinsamkeitsliste):
- `derographisch`: region, insel, kontinent, sonstiges
- `topographie`: gebirge, see, meer, kueste, huegelland
- `vegetation`: wald, suempfe_moore, steppe, tundra, auenlandschaft, wueste, graslandschaft

> `ebene` ist **nicht** dabei — sie verdient ihren Platz erst, wenn ein Faktor sie von
> „normal" unterscheidet. Alles Ungezeichnete gilt als normal.

- [ ] **Schritt 1:** DDL schreiben, Seed einspielen (idempotent).
- [ ] **Schritt 2: 🔧 DU (Owner):** Endpunkt einmal aufrufen, in phpMyAdmin prüfen,
      dass alle drei Tabellen existieren und `ecosystem_region_type` 16 Zeilen hat.
- [ ] **Schritt 3: Commit** — `feat(landschaften): schema for regions, areas and the type vocabulary`

### Aufgabe V2.2 — Öffentlicher Lesepfad mit eigenem ETag

**Dateien:** Erstellen `api/app/ecosystem-areas.php` (Vorlage: `api/app/citymaps.php`)

> 🔴 Der Kill-Switch wird **vor** dem Read geprüft — die Zeilen dürfen die Box nicht
> verlassen. Muster wörtlich aus `api/app/citymaps.php:41–45`.

```php
// Eigener Revisionszaehler. NIEMALS avesmapsNextMapRevision() -- das invalidiert die
// ~14-MB-Payload fuer jeden Besucher, und der Zeichenfeldzug sind ~2.000 Speichervorgaenge.
// Begruendung wortgleich in api/app/citymaps.php:13-14.
const AVESMAPS_ECOSYSTEM_SETTING = 'ecosystem_enabled';
if (avesmapsAppSettingGet($pdo, AVESMAPS_ECOSYSTEM_SETTING, '0') === '0') {
    avesmapsJsonResponse(200, ['ok' => true, 'areas' => [], 'ecosystem_enabled' => false]);
}
```

⚠️ **Der Default ist `'0'`, nicht `'1'`.** `avesmapsAppSettingGet` nimmt den Default als
Argument — die Polarität ist ein Zeichen, keine Umbaustelle.

- [ ] **Schritt 1:** Endpunkt mit bbox-Filter und ETag aus `ecosystem_revision`.
- [ ] **Schritt 2: 🔧 DU (Owner):** Ohne Session und ohne gesetztes Flag `curl` →
      `{"ok":true,"areas":[],"ecosystem_enabled":false}`.
- [ ] **Schritt 3: Commit** — `feat(landschaften): public read endpoint with its own revision and kill switch`

### Aufgabe V2.3 — Schreibender Endpunkt

**Dateien:** Erstellen `api/edit/map/ecosystem.php` (Vorlage: `api/edit/map/citymaps.php`,
145 Zeilen, POST-only, `match($action)`, **ohne** DDL-Präambel)

Aktionen: `create_region`, `update_region`, `delete_region`, `create_area`,
`update_area_geometry`, `delete_area`, `promote_trial` (V4).

**Nicht** vom politischen Endpunkt übernehmen: `PATCH` für alles, DDL bei jedem
Aufruf, `getMessage()`-Lecks.

- [ ] **Schritt 1–5:** Aktionen einzeln, je mit `curl`-Abnahme.
- [ ] **Schritt 6: Commit** — `feat(landschaften): write endpoint for regions and areas`

### Aufgabe V2.4 — Quellen anschließen

**Dateien:** Ändern `api/edit/map/feature-sources.php`, `api/app/feature-sources.php`

- [ ] **Schritt 1:** `'landschaft'` in beide `entity_type`-Whitelists. **Zwei Zeilen.**
- [ ] **Schritt 2: Commit** — `feat(landschaften): join the shared source system as a new entity_type`

---

# V3 — Zeichnen

**Fertig, wenn:** Eine mit Klicks gezeichnete Fläche wird gespeichert, überlebt Reload
und Kartenschwenk — und `git status` zeigt **keine** politische Datei.

### Aufgabe V3.1 — Geometriehelfer, ringfähig von Anfang an

**Dateien:** Erstellen `js/map-features/map-features-landschaften-geometry.js`
(Vorlage lesen: `map-features-region-geometry-helpers.js`, 405 Z. → ~180 Z.)

> 💣 **Multipolygone und Löcher von Anfang an.** Der Prototyp
> (`landschaften-modell.html`) arbeitet mit **einem** Ring; das reicht für eine
> Vorführung, nicht für den Farindel. Nachrüsten wäre teurer:
>
> | Funktion | muss | sonst |
> |---|---|---|
> | `inPoly` | über alle Ringe, Außen/Loch nach GeoJSON | eine Lichtung zählt als Wald |
> | `distEdge` | Minimum über **alle** Ringe, auch Lochränder | ein Buckel ragt ins Loch → Höhe am Lochrand ≠ 0, es entsteht eine Klippe |

**Nicht mitkopieren:** `applySharedBoundaryVertexMove` — Landschaften erben nichts,
und ein Waldrand ist keine geteilte Grenze. Überlappung und Lücken sind **erlaubt und
normal** (Schneckenkamm liegt in den Windhagbergen).

- [ ] **Schritt 1: Test für Ringfähigkeit** — Punkt in Lichtung ist **draußen**;
      `distEdge` eines Punkts nahe dem Lochrand ist klein, nicht groß.
- [ ] **Schritt 2–4:** Implementieren, Test grün, Namensprüfung per `grep`.
- [ ] **Schritt 5: Commit** — `feat(landschaften): ring-aware geometry helpers (holes and multipolygons)`

### Aufgabe V3.2 — Klick-für-Klick-Zeichenwerkzeug

**Dateien:** Erstellen `js/map-features/map-features-landschaften-draw.js`
(Vorlage lesen: `js/map-features/map-features-path-creation.js:58–104`)

> 🔴 **Das ist die teuerste Einzelentscheidung des Vorhabens.** Es gibt heute **kein**
> Zeichenwerkzeug: `createRegionAt()` (`map-features-region-crud.js:158`) legt ein
> **Sechseck mit Radius 10** an und speichert sofort. Wer den Farindel damit umfährt,
> verbiegt sechs Ecken und teilt Kanten — das sind 3–5 Minuten je Fläche und damit
> 42 Stunden für 500. Klick-für-Klick sind 1–2 Minuten und damit 17.

**Verhalten:** Klick setzt einen Punkt, Vorschaulinie läuft mit, **Doppelklick oder
Enter** schließt ab, **Escape** bricht ab. Gespeichert wird **erst beim Abschluss** —
damit entstehen keine „Sechseck-Leichen".

- [ ] **Schritt 1–6:** Analog `startPathCreationAt`, aber ohne Graph-Knoten-Bindung
      und mit Polygon-Abschluss.
- [ ] **Schritt 7: 🔧 DU (Owner):** Eine Fläche zeichnen, abbrechen mit Escape —
      es darf **nichts** im Bestand liegen.
- [ ] **Schritt 8: Commit** — `feat(landschaften): click-to-draw polygons instead of nudging a hexagon`

### Aufgabe V3.3 — Vertex-Editor mit gebündeltem Speichern und Undo

**Dateien:** Erstellen `js/map-features/map-features-landschaften-edit.js`

Zwei Abweichungen von der Vorlage, beide gemessen begründet:

- **Gebündeltes Speichern.** Heute ist jede gezogene Ecke ein eigener POST plus ein
  Toast (2,2 s Standzeit, ein Platz) — ein Waldrand mit 40 Ecken sind 40
  Schreibvorgänge auf STRATO und 40 Blinker. Hier: **800 ms nach dem letzten
  Loslassen**, ein Schreibvorgang, Zustand in einer ruhigen Statuszeile statt im Toast.
- **Strg+Klick auf eine Kante setzt EINE Ecke.** Die Vorlage setzt **vier**
  (`subdivideRegionEditHoveredEdge(4)`) — falsche Körnung für eine Küstenlinie.
- **Undo-Stapel**, 20 Schritte, im Speicher, Strg+Z. Es gibt **nirgends im Projekt**
  ein Undo, und ein Doppelklick löscht heute eine Ecke *und speichert*.

- [ ] **Schritt 1–8:** Handler, Bündelung, Undo, je mit Test.
- [ ] **Schritt 9: Commit** — `feat(landschaften): vertex editing with batched saves and an undo stack`

### Aufgabe V3.4 — Kontextmenü

**Dateien:** Erstellen `js/map-features/map-features-landschaften-context-action.js`
(Vorlage lesen: `map-features-settlement-context-action.js`)

> **Ohne `index.html` und ohne `REGION_CONTEXT_ACTIONS` anzufassen.** Eine
> eigenständige IIFE injiziert ihre Einträge und fängt Klicks in der **Capture-Phase
> mit `stopImmediatePropagation()`** ab, bevor die jQuery-Delegation greift.

Drei Einträge: „Neue Derographische Region", „Neue Vegetation", „Neue Topographie" —
jeder **schaltet die Ebene mit**. Und: „Neues Herrschaftsgebiet" wird ausgeblendet,
außer der Modus ist `political`.

- [ ] **Schritt 1–4:** Injektion, Handler, Ebenen-Umschaltung, Ausblendung.
- [ ] **Schritt 5: 🔧 DU (Owner):** Im politischen Modus ist „Neues Herrschaftsgebiet"
      da, im Landschaften-Modus nicht.
- [ ] **Schritt 6: Commit** — `feat(landschaften): three context entries that switch the layer with them`

### Aufgabe V3.5 — Erprobungs-Hinweis

**Dateien:** Erstellen `js/map-features/map-features-landschaften-intro.js`

> **Eine Warnung ohne Konsequenz wird weggeklickt.** Deshalb dreiteilig: der
> Moduseintrag heißt dauerhaft „Landschaften (Erprobung)"; der erste Dialog nennt
> **drei konkrete Schritte** statt einer Bitte um Vorsicht; und jede in dieser Phase
> entstandene Fläche trägt `is_trial=1`, sodass am Ende **eine** Entscheidung reicht.

```
Zeichne eine einzige Fläche. Verschiebe die Karte. Lade neu. Ist sie noch da?
Erst wenn das sitzt, die zweite. Bitte noch keine Serie — das Werkzeug ist neu,
und was jetzt entsteht, kann sich noch als falsch erweisen.
```

- [ ] **Schritt 1–3:** Dialog (einmalig, `localStorage`), Statuszeile, `is_trial`-Weitergabe.
- [ ] **Schritt 4: Commit** — `feat(landschaften): trial-phase notice with three concrete steps`

---

# V4 — Abnahme und Messung

**Kein Code.** Diese Stufe entscheidet, ob alles Weitere gebaut wird.

- [ ] **🔧 DU (Owner): Zwanzig Flächen in einer Sitzung zeichnen — Zeit stoppen.**

> Das ist die einzige Zahl, die darüber entscheidet, ob das Feature je fertig wird.
> Bei **5 Minuten** je Fläche sind es 42 Stunden für 500 — es wird nicht fertig.
> Bei **2 Minuten** sind es 17 — es wird.
>
> Drei Flächen fühlen sich mit jedem Werkzeug gut an. Zwanzig nicht.

- [ ] **Messungen, die vor der nächsten Stufe feststehen müssen:**

| Frage | Verfahren |
|---|---|
| Knoten- und Kantenzahl des Graphen | **Nicht** `?diagnostic=graph-data` (11,3 s, ungeschützt). Eine `SELECT COUNT(*)` oder der in V0.5 geschützte Zweig. |
| Weicht die Route zwischen den Engines heute schon ab? | Eine Route über einen Weg **mit innerem Knoten**, mit und ohne `?clientrouting=1`. Entscheidet, ob die Paritätsforderung gestrichen wird. |
| Payload-Delta | `curl -s https://avesmaps.de/api/app/map-features.php \| wc -c` vor/nach |
| Wie viele Querfeldein-Strecken entstehen real? | Entscheidet, ob A\* vorberechenbar ist |

- [ ] **Entscheidung über die Erprobungsflächen:** alle übernehmen (`is_trial=0`) oder
      alle wegräumen. Ein Knopf, kein Aufräumen von Hand.

---

# Danach — Skizze, noch nicht beauftragt

Jedes dieser Vorhaben bekommt einen **eigenen Plan**, geschrieben erst wenn V4
abgenommen ist.

| | Vorhaben | Bemerkung |
|---|---|---|
| **V5** | Kachel-Ableitung Land/Wasser | Einmaliges Skript, keine Oberfläche. Nimmt **147 Flächen** ganz aus der Handarbeit, macht aus 35 Schneidearbeit, gibt 60 Gebirgen einen Startumriss. Werkzeugkette liegt im Nachbarrepo (`27_polygonize_town_tiles.py`). ⚠️ `dsa5-atlas/` nicht anfassen — Ulisses-Material. |
| **V6** | Landschaftseditor (3 Spalten) | Realistisch **1.800–2.600 Z.**, nicht 900. Vorlage nur `html/wiki-sync-powerline-editor.html:60` — der „Vorbild"-Siedlungseditor verstößt selbst gegen `display:grid`. Zwei Sitzungen. |
| **V7** | „Senden an …" und Grenzimport | Geometrie in die beiden anderen Ebenen kopieren; Territoriengrenzen per Hierarchiebaum übernehmen (Kopie, nie Verknüpfung), nach dem Import **vereinfachen** (Douglas-Peucker) — sonst schleppt eine Landschaftsgrenze politische Vertex-Dichte mit. |
| **V8** | Topographie / Höhenfeld | Buckelsumme aus dem Prototyp portieren (`cellHash`, `level`, `peakWindow`, `rawArea`, `buildArea`, `hAt`). 💣 **`sampleRoute()` nicht übernehmen** — feste Schrittweite, keine Klemmen. 💣 **Enthaltensein-Fensterung** statt `max` oder Summe: der Schneckenkamm ersetzt die Windhagberge lokal, statt sich zu addieren. Eigene Stufe: Gipfel-Sichtbarkeitsregel (öffentliche Bestandsänderung!). |
| **V9** | Vorberechnung Wege × Flächen | `path_ecosystem` (PK `(path_id, area_id, seq)`, `BIGINT` nicht `VARCHAR(36)`), `path_ecosystem_state` für den Fortschritt. bbox-Vorfilter als **SQL-Join**. Sperre, Budget (4 s, **nicht** 28), `set_time_limit`, serverseitiger Cursor ohne `OFFSET`, Idempotenz. 💣 Leasing-Falle. Gemessen **30–45 s** auf STRATO für den Volllauf. |
| **V10** | „Führt durch" + Flora am Segment | `buildRouteLegPopupHtml` (`route-plan.js:196`), `buildLoreMarkup` existiert. ⚠️ Nur über den DOM-Observer laden, nie beim Markup-Bau — der Pool-Vorfall vom 2026-07-21. |
| **V11** | Terrain auf Kantengewichte | Die gefährlichste Stufe. **Drei** Slice-Stellen, nicht zwei. Einheitenfalle (×3 → ×23). Klemme `[0,5…4,0]`, **nicht** die Flussgrenze erben. `from`/`to` bleiben in gespeicherter Orientierung (Verlauf-Sync!). Nachweis ist ein **Netzlauf**, kein Fixture-Test. Zwei Sitzungen. |
| **V12** | Geschwindigkeitsvektoren | Muster existiert: `map-features-river-flow-arrows.js`, edit-only. Versatz **senkrecht** zur Segmentrichtung. |
| **V13** | Querfeldein: Wasser meiden | ~50 Zeilen, liefert 90 % des A\*-Nutzens: eine Querfeldein-Kante, die ein `meer`/`see`-Polygon schneidet, entsteht gar nicht erst. |
| **V14** | A\* für Querfeldein | Nur clientseitig, on demand. Erst nach der Messung aus V4. |
| **V15** | Spotlight-Schnittmenge | **Vertagt.** Braucht gezeichnete Vegetationsflächen und `relation='vorkommen'` in `lore_place`. |

---

## Selbstprüfung

**Abdeckung:** Die Analyse nennt zehn Bausteine (A–J) plus die Ergänzungen aus §8.
A → V1. B → V3. C → V6. D → V8. E → V9. F → V11. G → V12. H → V10. I → V15. J → V13/V14.
Anzeige-Häkchen → V1.2. „Senden an …" und Grenzimport → V7. Kachel-Ableitung → V5.
Erprobungsphase → V3.5. Routing-Entlastung → V0. **Keine Lücke.**

**Typkonsistenz:** `kind` heißt durchgehend `kind` mit den Werten
`derographisch|vegetation|topographie`. `is_trial` erscheint in V2.1 (Schema),
V3.5 (Weitergabe), V4 (Entscheidung). `ecosystem_revision` in V2.2 und der globalen
Regel 3. `AVESMAPS_ECOSYSTEM_SETTING` in V2.2.

**Offen und bewusst offen:** die konkreten Tempo-Faktoren je Typ (gehören den
Editoren, nicht diesem Plan), die Buckelzahl des Gebirgskörpers (wird in V8 festgelegt
und dokumentiert — wegen der Jensen-Steuer kein Schönheitsregler), und die
Entscheidung über die Paritätsforderung (fällt nach der Messung in V4).
