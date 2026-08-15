# Versteckte Orte — Bauplan

> **Für agentische Ausführung:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Schritte tragen `- [ ]` zum Abhaken.

**Entwurf:** `docs/superpowers/specs/2026-08-15-versteckte-orte-design.md` — er ist die Abnahmeliste.
Jede Zeile mit 💣 / ⚠️ / 🔴 dort wird vor „fertig" einzeln abgehakt (AGENTS.md §9).

**Ziel:** Ein Ort bekommt das Merkmal *versteckt*: die Karte zeichnet ihn nicht, die Routenfindung
wählt ihn nicht als Kandidat, gefunden wird er über seinen Namen.

**Bauform:** Ein Bool im `properties_json` der `map_features`-Zeile (keine Spalte, keine Migration).
Der versteckte Ort bleibt **vollständig im Routengraphen** — er verliert nur seinen Platz auf der
Kandidatenliste, die der Graphbau einmal rechnet und herausgibt. Auf der Karte greifen zwei
Zeichenfunktionen, im Spotlight der vorhandene Hinweis-Platz.

**Technik:** PHP 8 (strict types) ohne Framework · Vanilla JS ohne Bundler · Tests sind nackte
`node`- bzw. `php`-Skripte mit `assert`.

---

## Globale Zusicherungen

Gelten für **jede** Aufgabe, ohne dass sie dort wiederholt werden:

- **Feldname überall gleich:** Speicher/API `is_hidden` · JS-Objekt `isHidden` · Schalter
  `#toggleHidden` / `#toggleHiddenControl`.
- **Keine DDL.** `is_nodix`/`is_ruined` liegen im JSON-Blob (`api/_internal/map/features.php:3006`),
  nicht als Spalte. Kein `ALTER TABLE`, kein `$addColumn`, keine Migration.
- **Der Wert wird immer geschrieben, auch `false`** — wie seine beiden Nachbarn.
- **Standard ist `false`.** Kein Einmal-Lauf, der irgendetwas auf versteckt setzt (Owner 15.08.2026).
- **Deutsch bleibt Deutsch** (AGENTS.md §8): sichtbare Zeichenketten kommen über `tr("schlüssel",
  "deutsche Vorgabe")`, nie inline übersetzt. Kommentare und Commit-Betreffe auf Englisch **oder**
  Deutsch nach Umgebung der Datei — die Routing-Bibliothek kommentiert deutsch, `spotlight-search.js`
  englisch.
- **Keine hartkodierte Farbe / Rundung / Trennlinie** (AGENTS.md §12) — Token aus
  `css/base/tokens.css`, notfalls Token zuerst anlegen.
- **Nie `git add -A`.** Geteilter Arbeitsbaum; `git status` zuerst, nur eigene Pfade nach Namen
  stagen. Fremde geänderte Dateien in Ruhe lassen.
- **Vor jedem Push das GANZE Testfeld**, JS und PHP, mit den Erweiterungen:
  ```bash
  for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
  ```
  ```bash
  for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
  ```
  ⚠️ Ohne `mbstring`/`pdo_sqlite`/`gd` melden 45 Tests fälschlich rot. **Ausgangslage gemessen am
  15.08.2026: 286 Tests, genau 1 rot** — `api/_internal/linkcheck/__tests__/link-url-test.php`
  (echter DNS-Abruf, vorbestehend, kein Regressionssignal). Alles darüber hinaus ist selbst gemacht.
- **Nach jedem Push die Remote-SHA prüfen.** Bei Ablehnung `fetch` + `rebase origin/master`, nie
  Force-Push.
- **Commit-Betreff mit Heredoc**, nicht mit PowerShell-Here-String — im Bash-Werkzeug hängt `@'…'@`
  ein `@` vor den Betreff (passiert am 15.08.2026 bei `dead684a`).

### Die Reihenfolge und ihr Grund

💣 **Sichtbare Änderungen gehen EINZELN live, und der Owner sieht jede** (AGENTS.md §9). Nach den
Aufgaben 1, 2, 3, 4 und 6 steht ein **Push + Blick**; Aufgabe 5 ist unsichtbar und reist mit 6.

🔴 **Die Auffindbarkeit kommt VOR dem Verstecken** — Aufgabe 2 (Spotlight-Zeile) steht vor Aufgabe 3
(Karte zeichnet nicht). Entwurf §10 hatte es andersherum und musste deshalb warnen, zwischen den
Schritten nichts zu verstecken. In dieser Reihenfolge existiert das Fenster nicht: wenn das
Verstecken zu wirken beginnt, ist der Weg zurück schon gebaut. Der Entwurf ist am 15.08.2026
nachgezogen worden.

### Dateiplan

| Datei | Rolle | Aufgabe |
|---|---|---|
| `api/_internal/map/features.php` | Lese-/Schreibpfad des Merkmals | 1 |
| `api/_internal/routing/network-data.php` | Feldliste, mit der der Router seine Orte baut | 1 |
| `html/wiki-sync-settlement-editor.html` | der Haken, den ein Editor anklickt | 1 |
| `js/map-features/map-features-location-editing.js` | Merkmal am Kartenmarker | 1 |
| `js/routing/routing.js` | Merkmal in `locationData` | 1 |
| `js/ui/spotlight-search.js` | dritte Trefferzeile | 2 |
| `css/components/spotlight-search.css` | Breite + Schriftgrad der Hinweiszeile | 2 |
| `js/app/runtime-state.js` | die Aufdeckungsmenge | 3 |
| `js/map-features/map-features-location-marker-rendering.js` | Riegel Markierung | 3 |
| `js/map-features/map-features-location-name-labels.js` | Riegel Namensschild | 3 |
| `index.html`, `js/app/bootstrap.js`, `js/config.js`, `js/map-features/map-features-layer-state.js`, `js/map-features/map-features.js` | der Haken „Versteckte Orte" | 3 |
| `js/map-features/map-features-waypoints.js` | Kennzeichnung in der Wegpunktsuche | 4 |
| `api/_internal/routing/client-graph.php` | die Kandidatenliste | 5 |
| `api/_internal/routing/response.php` | der Aufrufer, der heute die rohe Liste holt | 5 |
| `js/routing/route-plan.js` | still vorbei | 6 |

---

## Aufgabe 1: Das Feld

**Dateien:**
- Ändern: `api/_internal/map/features.php` (5 Stellen)
- Ändern: `api/_internal/routing/network-data.php:232-244`
- Ändern: `html/wiki-sync-settlement-editor.html:1277`, `:1393-1395`, `:1646-1647`
- Ändern: `js/map-features/map-features-location-editing.js:274`, `:379`, `:~412`
- Ändern: `js/routing/routing.js:109-110`
- Anlegen: `api/_internal/routing/__tests__/versteckte-orte-test.php`

**Schnittstellen:**
- Liefert: `is_hidden` (bool) in jeder Punkt-Feature-Antwort · `is_hidden` in jedem Element von
  `avesmapsBuildRouteNetworkData(...)['locations']` · `location.isHidden` (bool) im Browser.
- Nutzt: nichts aus früheren Aufgaben.

🔴 **Die Zeile, die man beim Abschreiben übersieht:** `avesmapsBuildRouteLocationData` baut die
Ortsobjekte des Routers aus einer **ausgeschriebenen** Feldliste. `is_nodix` und `is_ruined` stehen
dort **nicht**. Ohne `is_hidden` kommt das Merkmal im Graphbau nie an, und Aufgabe 5 ist gebaut und
wirkungslos. Deshalb ist genau das der Test dieser Aufgabe.

- [ ] **Schritt 1: Den Fehlschlagtest schreiben**

Anlegen: `api/_internal/routing/__tests__/versteckte-orte-test.php`

```php
<?php
// api/_internal/routing/__tests__/versteckte-orte-test.php
declare(strict_types=1);

/**
 * Das Merkmal „versteckt" auf dem Weg zum Routengraphen.
 *
 * 🔴 avesmapsBuildRouteLocationData baut seine Ortsobjekte aus einer AUSGESCHRIEBENEN Feldliste --
 * is_nodix und is_ruined stehen dort bis heute nicht, weil der Router sie nie brauchte. is_hidden
 * muss hinein, sonst erreicht das Merkmal den Graphbau nie und die Kandidatenliste in
 * client-graph.php filtert gegen ein Feld, das es nicht gibt. Genau diese Zeile bewacht dieser Test.
 *
 * Lauf:  php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/versteckte-orte-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n");
    exit(2);
}

require_once __DIR__ . '/../network-data.php';

$feature = static fn(string $name, bool $hidden): array => [
    'type' => 'Feature',
    'id' => 'loc-' . $name,
    'geometry' => ['type' => 'Point', 'coordinates' => [10.0, 20.0]],
    'properties' => [
        'public_id' => 'loc-' . $name,
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => 'dorf',
        'is_hidden' => $hidden,
    ],
];

// ---- das Merkmal ueberlebt die Feldliste --------------------------------------------------------
$versteckt = avesmapsBuildRouteLocationData($feature('Feenplatz', true));
assert(($versteckt['is_hidden'] ?? null) === true, 'ein versteckter Ort traegt is_hidden = true');

$offen = avesmapsBuildRouteLocationData($feature('Gareth', false));
assert(($offen['is_hidden'] ?? null) === false, 'ein gewoehnlicher Ort traegt is_hidden = false');

// ⚠️ Ein Ort, dessen Zeile das Feld gar nicht hat (jeder Bestandsort vor dieser Aenderung), ist NICHT
// versteckt. Kein Null, kein Fehlen -- ein harter Bool, damit die Filterregel in client-graph.php
// nicht drei Zustaende unterscheiden muss.
$alt = avesmapsBuildRouteLocationData([
    'type' => 'Feature', 'id' => 'loc-Alt',
    'geometry' => ['type' => 'Point', 'coordinates' => [1.0, 2.0]],
    'properties' => ['public_id' => 'loc-Alt', 'name' => 'Alt', 'feature_type' => 'location'],
]);
assert(($alt['is_hidden'] ?? null) === false, 'ein Ort ohne das Feld gilt als nicht versteckt');

// ---- der ganze Weg durch avesmapsBuildRouteNetworkData ------------------------------------------
$netz = avesmapsBuildRouteNetworkData(['features' => [$feature('Feenplatz', true), $feature('Gareth', false)]]);
$nachName = [];
foreach ($netz['locations'] as $ort) { $nachName[$ort['name']] = $ort; }
assert(($nachName['Feenplatz']['is_hidden'] ?? null) === true, 'die Netzdaten reichen das Merkmal durch');
assert(($nachName['Gareth']['is_hidden'] ?? null) === false, 'und lassen den offenen Ort offen');

echo "versteckte-orte-test: all asserts passed\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/versteckte-orte-test.php
```

Erwartet: `AssertionError: ein versteckter Ort traegt is_hidden = true`

- [ ] **Schritt 3: Die Feldliste des Routers erweitern**

In `api/_internal/routing/network-data.php`, im `return`-Array von `avesmapsBuildRouteLocationData`
(bei `:236`, direkt nach `'subtype'`):

```php
		'subtype' => (string) ($properties['feature_subtype'] ?? ''),
		// 🔴 DIESE FELDLISTE IST AUSGESCHRIEBEN, nicht durchgereicht -- is_nodix und is_ruined stehen
		// bewusst NICHT darin, weil der Router sie nie gebraucht hat. is_hidden schon: der Graphbau
		// baut daraus seine Kandidatenliste (client-graph.php). Faellt diese Zeile weg, filtert er
		// gegen ein Feld, das nie ankommt -- und der Riegel ist gebaut und wirkungslos.
		'is_hidden' => !empty($properties['is_hidden']),
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/versteckte-orte-test.php
```

Erwartet: `versteckte-orte-test: all asserts passed`

- [ ] **Schritt 5: Den Server-Schreibpfad erweitern (5 Stellen in `features.php`)**

Jeweils **direkt unter** der `is_ruined`-Zeile, gleiches Muster:

`:1274` (`avesmapsUpdatePointFeatureDetails`, Eigenschaften bauen):
```php
        $properties['is_ruined'] = avesmapsReadBoolean($payload['is_ruined'] ?? false);
        $properties['is_hidden'] = avesmapsReadBoolean($payload['is_hidden'] ?? false);
```

`:1330` (Protokollzeile `update_point` — 💣 das ist der **Audit-Log**, keine Spalte; die gehobenen
Schlüssel liegen neben `properties_json`, damit ein Protokolleintrag ohne JSON-Zerlegung lesbar ist):
```php
            'is_ruined' => $properties['is_ruined'],
            'is_hidden' => $properties['is_hidden'],
```

`:1361` (`avesmapsCreatePointFeature`, Eigenschaften beim Anlegen):
```php
        'is_ruined' => avesmapsReadBoolean($payload['is_ruined'] ?? false),
        'is_hidden' => avesmapsReadBoolean($payload['is_hidden'] ?? false),
```

`:2456` (Teilaktualisierung — ⚠️ **hier `array_key_exists`, nicht `??`**: diese Funktion schreibt nur,
was der Aufrufer wirklich mitschickt; ein `?? false` würde ein gesetztes Versteckt bei jedem
unbeteiligten Speichern still zurücknehmen):
```php
        if (array_key_exists('is_hidden', $payload)) {
            $properties['is_hidden'] = avesmapsReadBoolean($payload['is_hidden']);
        }
```

`:3007` (`avesmapsBuildPointFeatureResponse`, Antwort an den Editor):
```php
        'is_ruined' => !empty($properties['is_ruined']),
        'is_hidden' => !empty($properties['is_hidden']),
```

- [ ] **Schritt 6: Prüfen, dass alle fünf sitzen**

```bash
grep -n "is_hidden" api/_internal/map/features.php
```

Erwartet: **5** Treffer, in den Zeilenbereichen 1274, 1330, 1361, 2456, 3007.

- [ ] **Schritt 7: Den Haken in den Siedlungseditor bauen**

`html/wiki-sync-settlement-editor.html:1395`, direkt nach `ruinedRow`:
```javascript
	const hiddenRow =
		`<div class="k"></div><div><label class="dt-edit-checkrow"><input type="checkbox" id="dtEditIsHidden"${props.is_hidden ? " checked" : ""}> Versteckt</label></div>`;
```

Dieselbe Datei, die Zeilenkette bei `:1404` — `hiddenRow` **nach** `ruinedRow`:
```javascript
		`<div class="dt-grid dt-edit-grid">${nameRow}${typeRow}${descRow}${wikiUrlRow}${otherSourceRow}${nodixRow}${ruinedRow}${hiddenRow}${wikiRowsHtml}${actionsHtml}</div>`
```

Speichernutzlast bei `:1647`:
```javascript
		is_ruined: Boolean($("dtEditIsRuined")?.checked),
		is_hidden: Boolean($("dtEditIsHidden")?.checked),
```

Die Nur-Lese-Ansicht für Wiki-Orte ohne Kartenpunkt bei `:1277`:
```javascript
	rows.push(buildDetailFieldRow("Ruine", item.is_ruined ? "Ja" : "Nein"));
	rows.push(buildDetailFieldRow("Versteckt", item.is_hidden ? "Ja" : "Nein"));
```

- [ ] **Schritt 8: Das Merkmal im Browser ankommen lassen**

`js/map-features/map-features-location-editing.js` — an **allen drei** Stellen unter der
`isRuined`- bzw. `is_ruined`-Zeile (`:275`, `:380` und in `applyLiveLocationFeature` bei `~:412`):
```javascript
		isRuined: Boolean(feature.is_ruined),
		isHidden: Boolean(feature.is_hidden),
```
und in der Nutzlast von `applyLiveLocationFeature` (dort heißen die Schlüssel wie auf dem Draht):
```javascript
		is_ruined: Boolean(properties.is_ruined),
		is_hidden: Boolean(properties.is_hidden),
```

`js/routing/routing.js:110`:
```javascript
				isRuined: Boolean(feature.properties.is_ruined),
				isHidden: Boolean(feature.properties.is_hidden),
```

- [ ] **Schritt 9: Prüfen, dass nichts vergessen wurde**

```bash
grep -rn "isHidden\|is_hidden" js/ html/ api/ --include=*.js --include=*.html --include=*.php | grep -v __tests__
```

Erwartet: 5 × `features.php`, 1 × `network-data.php`, 4 × `wiki-sync-settlement-editor.html`,
4 × `map-features-location-editing.js`, 1 × `routing.js`. **15 Zeilen.** Fehlt eine, ist sie eine
der oben aufgezählten.

- [ ] **Schritt 10: Ganzes Testfeld**

Beide Läufe aus „Globale Zusicherungen". Erwartet: 287 Tests, 1 rot (`link-url-test.php`).

- [ ] **Schritt 11: Commit + Push + Blick**

```bash
git status --short
```
Nur eigene Pfade stagen, dann:
```bash
git add api/_internal/map/features.php api/_internal/routing/network-data.php api/_internal/routing/__tests__/versteckte-orte-test.php html/wiki-sync-settlement-editor.html js/map-features/map-features-location-editing.js js/routing/routing.js
git commit -F- <<'EOF'
feat(versteckte-orte): der Haken "Versteckt" im Siedlungseditor -- das Feld reist, wirkt aber noch nicht

Ein Ort bekommt neben Nodix und Ruine ein drittes Merkmal. Diese Runde legt nur
den Weg: Editor-Haken, Server-Lese- und Schreibpfad, Kartenmarker, locationData.
Die Karte zeichnet noch alles, die Routenfindung waehlt noch alles -- wer den
Haken setzt, sieht heute keinen Unterschied.

Keine DDL: is_nodix und is_ruined liegen im properties_json, nicht als Spalte,
und is_hidden liegt daneben.

Die Zeile, die man beim Abschreiben uebersieht, ist avesmapsBuildRouteLocationData
(network-data.php). Sie baut die Ortsobjekte des Routers aus einer
AUSGESCHRIEBENEN Feldliste, in der weder is_nodix noch is_ruined steht. Ohne
is_hidden darin kaeme das Merkmal im Graphbau nie an. Bewacht von
versteckte-orte-test.php.

Entwurf: docs/superpowers/specs/2026-08-15-versteckte-orte-design.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin master
git rev-parse --short HEAD origin/master
```

🔧 **DU (Owner):** im Siedlungseditor einen Ort öffnen — unter „Ruine / zerstört" steht „Versteckt".
Anhaken, speichern, Fenster neu öffnen: der Haken ist noch da. Auf der Karte ändert sich nichts, und
das ist richtig.

---

## Aufgabe 2: Die dritte Zeile im Spotlight

**Dateien:**
- Ändern: `js/ui/spotlight-search.js:851-873` (`spotlightResultMarkup`), `:1036-1046`
  (`buildSpotlightLocationEntries`)
- Ändern: `css/components/spotlight-search.css:101`, `:109`
- Anlegen: `js/ui/__tests__/spotlight-versteckt-zeile.test.js`

**Schnittstellen:**
- Nutzt: `location.isHidden` aus Aufgabe 1.
- Liefert: `entry.stateHint` (String, ggf. leer) an `spotlightResultMarkup` ·
  CSS-Klasse `spotlight-search__result--two-line`.

⭐ Der Hinweis-Platz existiert schon (`.spotlight-search__result-hint`, `display:block` innerhalb der
Typangabe) — er wurde für die Innerorts-Treffer gebaut und von Ortstreffern nie belegt. Hier wird er
belegt, nicht neu erfunden.

- [ ] **Schritt 1: Den Fehlschlagtest schreiben**

Anlegen: `js/ui/__tests__/spotlight-versteckt-zeile.test.js`

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die dritte Trefferzeile: „Ruine", „Versteckt", und beides zusammen.
//
// Wie spotlight-scoring.test.js werden die Funktionen per Namen aus der AUSGELIEFERTEN Datei
// gezogen und einzeln ausgewertet -- der Test prueft die Quelle, keine Kopie davon.
// Anker: die Deklarationen stehen auf Spalte 0, eine schliessende Klammer auf Spalte 0 beendet sie.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/ui/__tests__/spotlight-versteckt-zeile.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8");

const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht in js/ui/spotlight-search.js gefunden -- umbenannt?`);
	return match[0];
};

const context = {
	String, Boolean, Array, Object,
	// tr() gibt die deutsche Vorgabe zurueck -- die i18n-Tabelle ist nicht Gegenstand dieses Tests.
	tr: (key, fallback) => fallback,
	escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	SPOTLIGHT_SECTION_KINDS: new Set(["territory", "path", "region"]),
};
vm.runInNewContext(extract("spotlightLocationStateHint") + extract("spotlightResultMarkup"), context);
const { spotlightLocationStateHint, spotlightResultMarkup } = context;

// --- der Hinweistext ----------------------------------------------------------------------------
assert.strictEqual(spotlightLocationStateHint({}), "", "ein gewoehnlicher Ort traegt keine dritte Zeile");
assert.strictEqual(spotlightLocationStateHint({ isRuined: true }), "Ruine");
assert.strictEqual(spotlightLocationStateHint({ isHidden: true }), "Versteckt");

// 💣 Beides zugleich ist EIN Hinweis mit Trenner, nicht zwei Zeilen: der Hinweis ist `nowrap` und
// haette sonst still abgeschnitten. Die Reihenfolge ist fest -- Ruine beschreibt den Ort, Versteckt
// beschreibt, wie die Karte mit ihm umgeht.
assert.strictEqual(spotlightLocationStateHint({ isRuined: true, isHidden: true }), "Ruine · Versteckt");

// --- das Markup ---------------------------------------------------------------------------------
const zhamorrah = spotlightResultMarkup(
	{ kind: "location", name: "Zhamorrah", typeLabel: "Besonderes Bauwerk / Stätte", stateHint: "Ruine" }, 0,
);
assert.ok(zhamorrah.includes(`class="spotlight-search__result-hint">Ruine<`), "der Hinweis steht im Markup");
assert.ok(zhamorrah.includes("spotlight-search__result--two-line"), "und die Zeile meldet sich als zweizeilig");

const gareth = spotlightResultMarkup({ kind: "location", name: "Gareth", typeLabel: "Metropole" }, 1);
assert.ok(!gareth.includes("spotlight-search__result-hint"), "ohne Hinweis kein Hinweis-Element");
assert.ok(!gareth.includes("--two-line"), "und keine Zweizeilen-Klasse");

// 🔴 --two-line und --not-on-map sind ZWEI Fragen. Ein Innerorts-Treffer ist beides; ein versteckter
// Ort ist nur zweizeilig, und genau daran scheiterte die alte Kopplung: die Verbreiterung auf 240px
// hing an --not-on-map, also haette die Ellipse bei einem versteckten Ort das Wort „Versteckt"
// gefressen -- die Zeile, die es zu lesen gibt.
const innerorts = spotlightResultMarkup(
	{ kind: "citymap", name: "Greifax-Palast", typeLabel: "Grundriss · Xorlosch", notOnMap: true }, 2,
);
assert.ok(innerorts.includes("spotlight-search__result--not-on-map"), "der Innerorts-Treffer behaelt seine Klasse");
assert.ok(innerorts.includes("spotlight-search__result--two-line"), "und ist ausserdem zweizeilig");

const versteckt = spotlightResultMarkup(
	{ kind: "location", name: "Feenplatz", typeLabel: "Besonderes Bauwerk / Stätte", stateHint: "Versteckt" }, 3,
);
assert.ok(!versteckt.includes("--not-on-map"), "ein versteckter Ort IST auf der Karte -- nur ungezeichnet");

// --- CSS: die Verbreiterung haengt an der Zweizeiligkeit, nicht am Woanders-Hinspringen ----------
const css = fs.readFileSync(path.join(__dirname, "..", "..", "..", "css", "components", "spotlight-search.css"), "utf8");
assert.ok(
	/\.spotlight-search__result--two-line\s+\.spotlight-search__result-type\s*\{[^}]*max-width:\s*240px/.test(css),
	"die 240px haengen an --two-line",
);
assert.ok(
	!/\.spotlight-search__result--not-on-map\s+\.spotlight-search__result-type\s*\{[^}]*max-width/.test(css),
	"und NICHT mehr an --not-on-map",
);

// 💣 11px ist die Untergrenze aus AGENTS.md §12. Der Hinweis stand auf 10px -- derselbe Wanderfehler,
// den §11 fuer .se-row-type/.se-row-l2 festhaelt.
const hint = css.match(/\.spotlight-search__result-hint\s*\{[^}]*\}/);
assert.ok(hint, ".spotlight-search__result-hint nicht gefunden");
const groesse = hint[0].match(/font-size:\s*(\d+)px/);
assert.ok(groesse && Number(groesse[1]) >= 11, `der Hinweis steht auf ${groesse ? groesse[1] : "?"}px, Untergrenze ist 11px`);

console.log("spotlight-versteckt-zeile: all asserts passed");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/ui/__tests__/spotlight-versteckt-zeile.test.js
```

Erwartet: `AssertionError: spotlightLocationStateHint() nicht in js/ui/spotlight-search.js gefunden -- umbenannt?`

- [ ] **Schritt 3: Den Hinweistext bauen**

In `js/ui/spotlight-search.js`, **unmittelbar vor** `function spotlightResultMarkup` (Spalte 0, damit
der Namens-Auszug im Test greift):

```javascript
// The third line under a place's type: what the map does with it, in the reader's words.
// „Ruine" describes the place; „Versteckt" describes how the map treats it. A place can be both --
// then it is ONE hint with a separator, never two lines: the hint is `nowrap` (see
// css/components/spotlight-search.css) and a second line would be silently clipped.
function spotlightLocationStateHint(location) {
	const parts = [];
	if (location && location.isRuined) {
		parts.push(tr("spotlight.ruined", "Ruine"));
	}
	if (location && location.isHidden) {
		parts.push(tr("spotlight.hidden", "Versteckt"));
	}
	return parts.join(" · ");
}
```

- [ ] **Schritt 4: Das Markup den Hinweis tragen lassen**

In `spotlightResultMarkup` (`:862-871`) — `entry.stateHint` als **dritte** Quelle des Hinweistexts,
und die neue Klasse:

```javascript
	const hintText = entry.unreachable
		? tr("spotlight.noPlaceOnMap", "kein Ort auf der Karte")
		: (String(entry.placeHint || "")
			|| String(entry.stateHint || "")
			|| (entry.notOnMap && !SPOTLIGHT_SECTION_KINDS.has(entry.kind) ? tr("spotlight.inSettlement", "Innerorts") : ""));
	const notOnMap = hintText
		? `<span class="spotlight-search__result-hint">${escapeHtml(hintText)}</span>`
		: "";
	// 💣 ZWEI FRAGEN, ZWEI KLASSEN. --not-on-map heisst „der Treffer springt woanders hin" und faerbt;
	// --two-line heisst „diese Zeile traegt einen Hinweis" und verbreitert. Bis zum 15.08.2026 tat
	// --not-on-map beides, und ein versteckter Ort -- der auf der Karte IST -- haette die Breite nicht
	// bekommen: die Ellipse bei 150px frisst dann genau das Wort „Versteckt".
	const resultClass = "spotlight-search__result"
		+ (entry.notOnMap ? " spotlight-search__result--not-on-map" : "")
		+ (hintText ? " spotlight-search__result--two-line" : "");
```

- [ ] **Schritt 5: Den Hinweis an den Ortstreffern anhängen**

In `buildSpotlightLocationEntries` (`:1036`), im zurückgegebenen Objekt nach `typeLabel`:

```javascript
			stateHint: spotlightLocationStateHint(entry.location),
```

- [ ] **Schritt 6: Das CSS umhängen**

`css/components/spotlight-search.css:101` — Selektor tauschen, Kommentar mitziehen:

```css
/* Zweizeilige Treffer tragen ZWEI Angaben untereinander: Typ (samt Stadt) und darunter den Hinweis
   -- „Innerorts" bei einem Objekt ohne eigenen Punkt, „Ruine"/„Versteckt" bei einem Ort, den die
   Karte anders behandelt. Beide brauchen mehr als die 150px der einzeiligen Typangabe, sonst frisst
   die Ellipse genau den Hinweis, der die Zeile rechtfertigt.

   💣 DIE BEDINGUNG IST „HAT ZWEI ZEILEN", NICHT „LIEGT WOANDERS". Bis zum 15.08.2026 hing die
   Verbreiterung an `--not-on-map`; ein versteckter Ort ist aber auf der Karte und haette sie nicht
   bekommen. `--not-on-map` behaelt seine eigene Aufgabe (der gedaempfte Ton) und verliert nur die
   Breite.

   💣 `white-space` bleibt `nowrap`. Die Trefferzeile ist ein Grid (minmax(0,1fr) auto), und mit
   `normal` faellt die auto-Spalte auf ihre MINIMALbreite: gemessen 69px statt 120px, wodurch beide
   Angaben zweizeilig umbrachen und die Zeile 54px statt 27px hoch war -- sie sah gequetscht aus,
   obwohl der Treffer 548px breit ist. Die zwei Zeilen entstehen durch `display:block` am Hinweis,
   nicht durch Umbruch; jede fuer sich bleibt einzeilig. */
.spotlight-search__result--two-line .spotlight-search__result-type {
	max-width: 240px;
	text-align: right;
}
```

Und `:109-118` — den Schriftgrad auf 11 px:

```css
/* Der Hinweis steht unter der Typangabe und ist bewusst leiser als sie: er beschreibt eine
   Einschraenkung, keine Kategorie. Die Farbe erbt er von der Typzeile -- so bleibt der
   Kontrast in jedem Theme richtig, ohne einen zweiten Farbwert einzufuehren.
   💣 11px ist die Untergrenze (AGENTS.md §12). Hier standen 10px; derselbe Wanderfehler, den §11
   fuer .se-row-type/.se-row-l2 festhaelt. */
.spotlight-search__result-hint {
	display: block;
	overflow: hidden;
	opacity: 0.72;
	font-size: 11px;
	font-style: italic;
	text-overflow: ellipsis;
	text-transform: none;
	white-space: nowrap;
}
```

- [ ] **Schritt 7: Test laufen lassen, grün bestätigen**

```bash
node js/ui/__tests__/spotlight-versteckt-zeile.test.js
```

Erwartet: `spotlight-versteckt-zeile: all asserts passed`

- [ ] **Schritt 8: Ganzes Testfeld**

Beide Läufe. ⚠️ Besonders `js/ui/__tests__/spotlight-scoring.test.js` und
`spotlight-highlight-pan.test.js` — sie ziehen Funktionen per Regex aus derselben Datei; eine neue
Deklaration davor darf ihre Anker nicht verschieben.

- [ ] **Schritt 9: Commit + Push + Blick**

```bash
git status --short
git add js/ui/spotlight-search.js css/components/spotlight-search.css js/ui/__tests__/spotlight-versteckt-zeile.test.js
git commit -F- <<'EOF'
ui(versteckte-orte): Ruine und Versteckt als dritte Zeile im Spotlight

Ein Treffer sagt jetzt nicht nur, was ein Ort IST, sondern auch, wie die Karte mit
ihm umgeht: "Ruine", "Versteckt", bei beidem "Ruine · Versteckt" auf einer Zeile.
Der Hinweis-Platz dafuer gab es schon -- er wurde fuer die Innerorts-Treffer
gebaut und von Ortstreffern nie belegt.

Zwei gemessene Fallen dabei geradegezogen. Die Verbreiterung der Trefferspalte auf
240px hing an --not-on-map, also an "der Treffer springt woanders hin". Die
richtige Frage ist "hat diese Zeile zwei Zeilen": ein versteckter Ort IST auf der
Karte, haette die Breite nicht bekommen, und die Ellipse bei 150px frisst dann
genau das Wort, um das es geht. Dafuer gibt es jetzt --two-line; --not-on-map
behaelt den gedaempften Ton und verliert nur die Breite.

Und der Hinweis stand auf 10px, unter der 11px-Untergrenze aus AGENTS.md 12 --
derselbe Wanderfehler, den 11 fuer .se-row-type festhaelt.

Sichtbar ab sofort bei Ruinen. "Versteckt" hat noch niemanden zu zeigen.

Entwurf: docs/superpowers/specs/2026-08-15-versteckte-orte-design.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin master
git rev-parse --short HEAD origin/master
```

🔧 **DU (Owner):** Spotlight öffnen, „Zhamorrah" tippen — unter „Besonderes Bauwerk / Stätte" steht
jetzt „Ruine". In hell und dunkel ansehen.

---

## Aufgabe 3: Die Karte zeichnet ihn nicht

**Dateien:**
- Ändern: `js/app/runtime-state.js:115`
- Ändern: `js/map-features/map-features-location-marker-rendering.js:173-190` (Kontext), `:226`
- Ändern: `js/map-features/map-features-location-name-labels.js:38`
- Ändern: `index.html:2509` (nach `toggleNodixControl`), `js/app/bootstrap.js:384`,
  `js/config.js:684`, `js/map-features/map-features-layer-state.js:111` + `:290`,
  `js/map-features/map-features.js:145`
- Ändern: `js/map-features/map-features-location-lookup.js:364-370` (der Aufdeckungs-Trichter)
- Anlegen: `js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js`

**Schnittstellen:**
- Nutzt: `location.isHidden` (Aufgabe 1).
- Liefert: `avesmapsRevealedHiddenLocationIds` (`Set<string>`, global) ·
  `avesmapsRevealHiddenLocation(publicId)` · `isHiddenLocation(location)` ·
  `visibilityContext.hiddenToggleChecked`.

**Ab dieser Aufgabe wirkt das Merkmal.** Der Rückweg (Spotlight) steht seit Aufgabe 2.

- [ ] **Schritt 1: Den Fehlschlagtest schreiben**

Anlegen: `js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js`

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Ein versteckter Ort wird nicht gezeichnet -- ausser der Editor hakt ihn an, oder er ist in dieser
// Sitzung aufgedeckt worden, oder ein Pruefhaken hat ihn gefunden.
//
// Harness wie pruefhaken-sichtbarkeit.test.js: runInThisContext statt vm-Sandbox, damit die Globals
// der Dateien gegen die echten Funktionen aufloesen statt gegen Stubs.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js

const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

global.window = {};
global.IS_EDIT_MODE = true;
global.CROSSING_LOCATION_TYPE = "crossing";
global.activeMapStyle = "stylized";
global.VISUAL_MAX_ZOOM_LEVEL = 5;
global.LOCATION_NAME_LABEL_CONFIG = { dorf: { minZoom: 2 }, gebaeude: { minZoom: 3 } };

let checkedToggles = new Set();
let visibleTypes = new Set();
let unconnectedIds = new Set();
let sparseCrossingIds = new Set();

global.$ = (selector) => ({ is: () => checkedToggles.has(selector) });
global.isLocationTypeVisible = (locationType) => visibleTypes.has(locationType);
global.getUnconnectedLocationPublicIds = () => unconnectedIds;
global.getSparseCrossingPublicIds = () => sparseCrossingIds;
global.getSelectedMapLayerMode = () => "default";
global.isNodixLocation = (location) => Boolean(location?.isNodix);
global.isCrossingLocation = (location) => Boolean(location?.isCrossing);
global.avesmapsRevealedHiddenLocationIds = new Set();

loadBrowserScript(path.join(__dirname, "../map-features-location-marker-rendering.js"));
loadBrowserScript(path.join(__dirname, "../map-features-location-name-labels.js"));
global.isMarkerEntryInRenderBounds = () => true;

const RENDER_BOUNDS = {};
const showMarker = (entry, zoomLevel) => shouldShowLocationMarker(entry, zoomLevel, RENDER_BOUNDS, createLocationVisibilityContext());
const showLabel = (entry, zoomLevel) => shouldShowLocationNameLabel(entry, zoomLevel, createLocationVisibilityContext());

const versteckt = { locationType: "dorf", name: "Feenplatz", publicId: "loc-fee", location: { publicId: "loc-fee", isHidden: true } };
const offen = { locationType: "dorf", name: "Gareth", publicId: "loc-gar", location: { publicId: "loc-gar" } };

const reset = () => {
	checkedToggles = new Set();
	visibleTypes = new Set(["dorf"]);   // die Ortsgroesse ist AN -- sonst prueft der Test nichts
	unconnectedIds = new Set();
	sparseCrossingIds = new Set();
	global.avesmapsRevealedHiddenLocationIds = new Set();
};

// --- 1. versteckt heisst weg, obwohl die Ortsgroesse eingeschaltet ist ---------------------------
reset();
assert.strictEqual(showMarker(offen, 5), true, "Vorbedingung: der gewoehnliche Ort wird gezeichnet");
assert.strictEqual(showMarker(versteckt, 5), false, "ein versteckter Ort wird nicht gezeichnet");
assert.strictEqual(showLabel(versteckt, 5), false, "und sein Name auch nicht");

// --- 2. kein Zoom deckt ihn auf ------------------------------------------------------------------
reset();
[0, 1, 2, 3, 4, 5].forEach((zoom) => {
	assert.strictEqual(showMarker(versteckt, zoom), false, `auch auf Zoomstufe ${zoom} bleibt er weg`);
});

// --- 3. der Editor-Haken holt ihn zurueck ---------------------------------------------------------
reset();
checkedToggles.add("#toggleHidden");
assert.strictEqual(showMarker(versteckt, 5), true, "„Versteckte Orte" zeigt ihn");
assert.strictEqual(showLabel(versteckt, 5), true, "... samt Namen, sonst steht dort ein anonymer Punkt");

// --- 4. aufgedeckt heisst sichtbar ----------------------------------------------------------------
reset();
global.avesmapsRevealedHiddenLocationIds = new Set(["loc-fee"]);
assert.strictEqual(showMarker(versteckt, 5), true, "wer ihn gefunden hat, sieht ihn");
assert.strictEqual(showLabel(versteckt, 5), true, "samt Namen");

// --- 5. 💣 EIN PRUEFHAKEN ZEIGT SEINE FUNDE, auch versteckte --------------------------------------
// Owner 2026-08-14. Ein versteckter Ort ohne Weganbindung IST eine Anbindungsluecke; stuende der
// Versteckt-Riegel ueber dem Pruefhaken, waere „verstecken" ein Weg, den Pruefhaken stillzulegen --
// und der Editor saehe die Luecke nie wieder.
reset();
visibleTypes = new Set();          // Ortsgroesse AUS -- der Fund muss trotzdem durch
checkedToggles.add("#toggleUnconnected");
unconnectedIds.add("loc-fee");
assert.strictEqual(showMarker(versteckt, 5), true, "der Pruefhaken schlaegt den Versteckt-Riegel");
assert.strictEqual(resolveLocationCheckFinding(versteckt, createLocationVisibilityContext()), "unconnected");

// --- 6. im Kraftlinien-Modus schlaegt „versteckt" den Nodix-Zweig ---------------------------------
// Ein versteckter Nodix ist versteckt. Wer beides will, hakt „Versteckte Orte" an.
reset();
global.getSelectedMapLayerMode = () => "powerlines";
const versteckterNodix = { locationType: "dorf", name: "Feenplatz", publicId: "loc-fee", location: { publicId: "loc-fee", isHidden: true, isNodix: true } };
const offenerNodix = { locationType: "dorf", name: "Nodix", publicId: "loc-nod", location: { publicId: "loc-nod", isNodix: true } };
assert.strictEqual(showMarker(offenerNodix, 5), true, "Vorbedingung: der offene Nodix leuchtet");
assert.strictEqual(showMarker(versteckterNodix, 5), false, "der versteckte nicht");
global.getSelectedMapLayerMode = () => "default";

// --- 7. ein gewoehnlicher Ort bleibt vom Haken unberuehrt -----------------------------------------
reset();
checkedToggles.add("#toggleHidden");
assert.strictEqual(showMarker(offen, 5), true, "der Haken blendet nichts aus");

console.log("versteckter-ort-sichtbarkeit: all asserts passed");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js
```

Erwartet: `AssertionError: ein versteckter Ort wird nicht gezeichnet`

- [ ] **Schritt 3: Die Aufdeckungsmenge anlegen**

`js/app/runtime-state.js`, in der `let`-Kette bei `:115` nach `nearestLookupPinnedMarkerEntry`:

```javascript
	nearestLookupPinnedMarkerEntry = null,
	// Wer einen versteckten Ort ueber seinen Namen gefunden hat, sieht ihn -- fuer diesen Besuch
	// (Owner 15.08.2026). Laufzeit, nicht gespeichert: kein localStorage, kein URL-Parameter, kein
	// Serverzustand; ein Neuladen versteckt ihn wieder.
	// ⚠️ ADDITIV, nie geleert. Einen entfernten Wegpunkt wieder zu verstecken saehe wie ein Fehler
	// aus -- gefunden ist gefunden.
	avesmapsRevealedHiddenLocationIds = new Set(),
```

Und, in derselben Datei am Ende (oder wo die Datei ihre Hilfsfunktionen hält), der einzige Schreiber:

```javascript
// Der EINZIGE Schreiber der Aufdeckungsmenge. Drei Aufrufer, alle „jemand hat den Namen
// ausdruecklich eingegeben": der Spotlight-Treffer, der gesetzte Wegpunkt, der geteilte Pin-Link.
function avesmapsRevealHiddenLocation(publicId) {
	const id = String(publicId || "");
	if (!id) {
		return;
	}
	avesmapsRevealedHiddenLocationIds.add(id);
	if (typeof syncLocationMarkerVisibility === "function") {
		syncLocationMarkerVisibility();
	}
}
```

- [ ] **Schritt 4: Das Prädikat und den Kontext bauen**

`js/map-features/map-features-location-marker-rendering.js`, **vor**
`createLocationVisibilityContext` (bei `:172`):

```javascript
// Versteckt (Owner 15.08.2026): die Karte zeichnet ihn nicht, bis jemand seinen Namen eingibt.
// Zwilling von isNodixLocation -- ein Praedikat, damit Markierung und Namensschild dieselbe Frage
// stellen und nicht zwei Bedingungen auseinanderlaufen koennen.
function isHiddenLocation(location) {
	if (!location || !location.isHidden) {
		return false;
	}
	const publicId = String(location.publicId || "");
	return !(publicId
		&& typeof avesmapsRevealedHiddenLocationIds !== "undefined"
		&& avesmapsRevealedHiddenLocationIds.has(publicId));
}
```

In `createLocationVisibilityContext` (`:177`), neben den anderen Haken:

```javascript
		nodixToggleChecked: IS_EDIT_MODE && $("#toggleNodix").is(":checked"),
		hiddenToggleChecked: IS_EDIT_MODE && $("#toggleHidden").is(":checked"),
```

- [ ] **Schritt 5: Den Riegel in `shouldShowLocationMarker` setzen**

In `js/map-features/map-features-location-marker-rendering.js`, **direkt nach** dem
`resolveLocationCheckFinding`-Block und **vor** der Kreuzungsweiche:

```javascript
	// 💣 HIER, UND NUR HIER: nach den Pruefhaken, vor allem anderen. Ein versteckter Ort OHNE
	// Weganbindung ist weiterhin eine Anbindungsluecke und muss seinen pinken Ring bekommen -- „ein
	// Pruefhaken ZEIGT seine Funde" (Owner 2026-08-14). Stuende dieser Riegel darueber, waere
	// „verstecken" ein Weg, den Pruefhaken stillzulegen. Darunter, also unter der Kreuzungs- und der
	// Kraftlinienweiche, wuerde ein versteckter Nodix im Kraftlinien-Modus doch leuchten.
	if (isHiddenLocation(entry.location)) {
		const hiddenToggleChecked = visibilityContext
			? visibilityContext.hiddenToggleChecked
			: IS_EDIT_MODE && $("#toggleHidden").is(":checked");
		return hiddenToggleChecked && isMarkerEntryInRenderBounds(entry, renderBounds);
	}
```

- [ ] **Schritt 6: Denselben Riegel in `shouldShowLocationNameLabel`**

In `js/map-features/map-features-location-name-labels.js`, direkt nach dem
`resolveLocationCheckFinding`-Block (bei `:60-62`):

```javascript
	// Zwilling des Riegels in shouldShowLocationMarker -- dieselbe Stelle in derselben Rangfolge.
	// Ein Punkt ohne Namen waere so gut wie ein Name ohne Punkt: beides halb versteckt.
	if (isHiddenLocation(entry.location)) {
		return visibilityContext
			? visibilityContext.hiddenToggleChecked
			: IS_EDIT_MODE && $("#toggleHidden").is(":checked");
	}
```

- [ ] **Schritt 7: Test laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js
```

Erwartet: `versteckter-ort-sichtbarkeit: all asserts passed`

- [ ] **Schritt 8: Den Haken ins Auge-Menü bauen**

`index.html`, direkt **nach** dem `toggleNodixControl`-Label (endet bei `:2515`), in derselben
`#editorChecks`-Gruppe. Glyph ist die Lupe wie bei „Nodices" — dieser Haken erzeugt keinen eigenen
Ring, also wäre ein farbiges Zeichen eine Legende für nichts:

```html
						<label class="map-display-menu__row" id="toggleHiddenControl" hidden>
							<span class="map-display-menu__glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M16 16l5 5"></path></svg></span>
							<span class="map-display-menu__name">Versteckte Orte</span>
							<input type="checkbox" id="toggleHidden" class="map-display-menu__state" />
							<span class="map-display-menu__eye" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="2.8"></circle><path class="map-display-menu__eye-slash" d="M3.5 3.5l17 17"></path></svg></span>
						</label>
```

`js/app/bootstrap.js:384`, nach den beiden Nodix-Zeilen:
```javascript
    document.getElementById("toggleHiddenControl")?.removeAttribute("hidden");
    document.getElementById("toggleHidden")?.removeAttribute("disabled");
```

`js/config.js:684`, nach `toggleNodix`:
```javascript
	toggleNodix: false,
	toggleHidden: false,
```

`js/map-features/map-features-layer-state.js:111`, nach der Nodix-Zeile:
```javascript
	$("#toggleHidden").prop("checked", parseBooleanQueryParam(searchParams.get("toggleHidden"), DEFAULT_PLANNER_STATE.toggleHidden));
```
und bei `:290`, nach dem Nodix-Block:
```javascript
	if (IS_EDIT_MODE && $("#toggleHidden").is(":checked") !== DEFAULT_PLANNER_STATE.toggleHidden) {
		searchParams.set("toggleHidden", $("#toggleHidden").is(":checked") ? "1" : "0");
	}
```

`js/map-features/map-features.js:145`, nach dem Nodix-Handler:
```javascript
$("#toggleHidden").change(() => {
	syncLocationMarkerVisibility();
	syncPlannerStateToUrl();
});
```

- [ ] **Schritt 9: Den EINEN Trichter aufdecken lassen**

⭐ **Nicht im Spotlight, sondern eine Ebene tiefer.** `openLocationPopupForMarkerEntry`
(`js/map-features/map-features-location-lookup.js:364`) ist der gemeinsame Trichter: dort münden
`openLocationPopupByName` und `openLocationPopupByPublicId`, und der Spotlight-Ortstreffer läuft
über `focusSpotlightLocation` (`js/ui/spotlight-search-focus.js:102`) ebenfalls hinein. Damit deckt
**eine** Zeile den Spotlight-Treffer, den Wiki-Deep-Link nach Seitenname, den Ortslink im Reiseplan
und „Nächsten Ort finden" ab.

⚠️ Und die Semantik stimmt von selbst: einen Marker, der nicht gezeichnet ist, kann niemand
anklicken. Jeder Aufruf für einen versteckten Ort ist deshalb **zwangsläufig** eine Adressierung über
Name oder Kennung von woanders her — genau das, was aufdecken soll.

In `openLocationPopupForMarkerEntry`, direkt nach `clearNearestLookupPinnedMarker()` (`:370`):

```javascript
	// Gefunden ist gefunden: ein versteckter Ort, den jemand ueber seinen Namen adressiert hat, wird
	// fuer diesen Besuch sichtbar (Owner 15.08.2026). Ohne diese Zeile spraenge die Karte auf leeres
	// Pergament -- die Infobox waere da, der Ort nicht.
	// 🔴 HIER, weil hier ALLE Wege zusammenlaufen: openLocationPopupByName, openLocationPopupByPublicId,
	// der Spotlight-Treffer, der Ortslink im Reiseplan. Ein Marker, der nicht gezeichnet ist, laesst
	// sich nicht anklicken -- jeder Aufruf fuer einen versteckten Ort ist also eine Adressierung von
	// woanders, und keine Zufallsberuehrung.
	if (markerEntry.publicId && typeof avesmapsRevealHiddenLocation === "function") {
		avesmapsRevealHiddenLocation(markerEntry.publicId);
	}
```

- [ ] **Schritt 10: Prüfen, dass der Haken vollständig verdrahtet ist**

```bash
grep -rn "toggleHidden" index.html js/ --include=*.html --include=*.js | grep -v __tests__
```

Erwartet: **7** Zeilen — `index.html` (2 ×: Label-Id und Input-Id), `bootstrap.js` (2 ×),
`config.js` (1 ×), `map-features-layer-state.js` (2 ×), `map-features.js` (1 ×).
Der Kontext-Eintrag in `map-features-location-marker-rendering.js` und die beiden Riegel kommen dazu.

- [ ] **Schritt 11: Ganzes Testfeld**

⚠️ Besonders `js/app/__tests__/map-display-menu.test.js:354` — es führt eine Liste der Haken und
könnte den neuen erwarten oder verbieten. Und `js/map-features/__tests__/pruefringe-css.test.js`
paart Haken mit Ring-Token; „Versteckte Orte" hat **keinen** Ring und darf dort nicht auftauchen.

- [ ] **Schritt 12: Commit + Push + Blick**

```bash
git status --short
git add js/app/runtime-state.js js/map-features/map-features-location-marker-rendering.js js/map-features/map-features-location-name-labels.js js/map-features/map-features-location-lookup.js js/map-features/map-features-layer-state.js js/map-features/map-features.js js/app/bootstrap.js js/config.js index.html js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js
git commit -F- <<'EOF'
feat(versteckte-orte): die Karte zeichnet sie nicht mehr -- Haken "Versteckte Orte" fuer Editoren

Ab hier wirkt das Merkmal: Markierung und Namensschild bleiben weg, auf jeder
Zoomstufe. Zurueck kommt ein Ort auf drei Wegen -- der Editor hakt "Versteckte
Orte" im Auge-Menue an, jemand findet ihn im Spotlight (dann bleibt er fuer
diesen Besuch sichtbar), oder ein Pruefhaken hat ihn gefunden.

Der Riegel steht NACH den Pruefhaken und VOR allem anderen, und das ist keine
Geschmacksfrage. Ein versteckter Ort ohne Weganbindung ist weiterhin eine
Anbindungsluecke; stuende der Riegel darueber, waere "verstecken" ein Weg, den
Pruefhaken stillzulegen. Darunter wuerde ein versteckter Nodix im
Kraftlinien-Modus doch leuchten.

Die Aufdeckung ist Laufzeit und additiv: kein localStorage, kein URL-Parameter,
kein Serverzustand, und ein entfernter Wegpunkt nimmt sie nicht zurueck --
gefunden ist gefunden.

Die Routenfindung waehlt versteckte Orte noch als Kandidaten; das ist die
naechste Runde.

Entwurf: docs/superpowers/specs/2026-08-15-versteckte-orte-design.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin master
git rev-parse --short HEAD origin/master
```

🔧 **DU (Owner):** einen Ort verstecken, Karte neu laden → er ist weg. Namen ins Spotlight tippen →
er erscheint. Neu laden → wieder weg. Als Editor „Versteckte Orte" anhaken → er ist da.

---

## Aufgabe 4: Die Wegpunktsuche

**Dateien:**
- Ändern: `js/map-features/map-features-waypoints.js:185-220`, `:332-339`
- Anlegen: `js/map-features/__tests__/wegpunkt-versteckt-label.test.js`

**Schnittstellen:**
- Nutzt: `location.isHidden` (Aufgabe 1) · `avesmapsRevealHiddenLocation` (Aufgabe 3).
- Liefert: `{label, value}`-Paare, bei denen ein versteckter Ort `"<Name> (versteckt)"` als Label und
  den blanken Namen als Wert trägt.

- [ ] **Schritt 1: Den Fehlschlagtest schreiben**

Anlegen: `js/map-features/__tests__/wegpunkt-versteckt-label.test.js`

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Wegpunktsuche bietet versteckte Orte an -- gekennzeichnet. Sie ist eine SUCHE, kein Scrollen
// ueber die Karte; waere sie strenger als das Spotlight, waeren die beiden Wege ungleich streng.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/map-features/__tests__/wegpunkt-versteckt-label.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-waypoints.js"), "utf8");
const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht in map-features-waypoints.js gefunden -- umbenannt?`);
	return match[0];
};

const context = { String, Boolean, Array, Object, tr: (key, fallback) => fallback };
vm.runInNewContext(extract("waypointSuggestionLabel"), context);
const { waypointSuggestionLabel } = context;

assert.strictEqual(waypointSuggestionLabel("Gareth", {}), "Gareth", "ein gewoehnlicher Ort steht blank da");
assert.strictEqual(waypointSuggestionLabel("Feenplatz", { isHidden: true }), "Feenplatz (versteckt)");

// ⚠️ Die Klammer ist die Form, die diese Liste schon kennt: das Innerorts-Objekt zeigt
// „Schänke Schnapsfass (Imdal)". Ein zweites Muster daneben waere eine zweite Rezeptur.
assert.strictEqual(
	waypointSuggestionLabel("Schänke Schnapsfass (Imdal)", { isHidden: true }),
	"Schänke Schnapsfass (Imdal) (versteckt)",
	"die Kennzeichnung haengt hinten an, sie ersetzt die Stadtklammer nicht",
);

// --- der Eintrag muss das Merkmal ueberhaupt TRAGEN ----------------------------------------------
// 💣 getWaypointAutocompleteEntries baute bis zum 15.08.2026 {name, normalizedName} -- das
// location-Objekt fiel schon im ersten .map() weg. Ohne diese Zeile hiesse `entry.isHidden` immer
// `undefined`, der Test oben bliebe gruen und die Liste kennzeichnete nie etwas.
assert.ok(
	/isHidden:\s*Boolean\(loc\?\.isHidden\)/.test(source),
	"getWaypointAutocompleteEntries muss isHidden mitfuehren",
);
assert.ok(
	/label:\s*waypointSuggestionLabel\(match\.entry\.name,\s*match\.entry\)/.test(source),
	"die Vorschlagsliste muss waypointSuggestionLabel mit dem EINTRAG aufrufen",
);

// ⚠️ Die Regel „niemals einen blanken String" (jQuery UI normalisiert die Liste am ERSTEN Eintrag)
// haengt an js/map-features/__tests__/waypoint-autocomplete-items.test.js -- sie wird hier nicht
// zweitgeprueft, nur nicht gebrochen: beide Zweige geben weiterhin {label, value} zurueck.

console.log("wegpunkt-versteckt-label: all asserts passed");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/wegpunkt-versteckt-label.test.js
```

Erwartet: `AssertionError: waypointSuggestionLabel() nicht in map-features-waypoints.js gefunden -- umbenannt?`

- [ ] **Schritt 3: Den Label-Bauer schreiben**

In `js/map-features/map-features-waypoints.js`, **vor** `getWaypointAutocompleteSource` (`:185`),
auf Spalte 0:

```javascript
// Ein versteckter Ort steht in der Vorschlagsliste, aber er sagt, dass er versteckt ist -- sonst
// wundert sich der Reisende, warum sein Ziel auf der Karte fehlt.
// ⚠️ Die Klammer ist die Form, die diese Liste schon fuehrt („Schänke Schnapsfass (Imdal)"), und die
// Kennzeichnung haengt HINTEN an: sie ersetzt die Stadtklammer nicht, sie kommt dazu.
function waypointSuggestionLabel(label, entry) {
	if (!entry || !entry.isHidden) {
		return label;
	}
	return `${label} (${tr("waypoint.hidden", "versteckt")})`;
}
```

- [ ] **Schritt 4: Den Eintrag das Merkmal tragen lassen**

💣 **Ohne diesen Schritt ist Schritt 3 wirkungslos.** `getWaypointAutocompleteEntries` (`:131-138`)
wirft das `location`-Objekt schon im ersten `.map()` weg und behält nur den Namen — `entry.isHidden`
wäre immer `undefined`, und die Liste kennzeichnete nie etwas. Der Block bei `:131` wird zu:

```javascript
	const ownEntries = locationData
		// 🔴 Das location-Objekt fiel hier bis zum 15.08.2026 sofort weg. isHidden muss mitreisen,
		// sonst kann die Vorschlagsliste einen versteckten Ort nicht kennzeichnen.
		.map((loc) => ({ name: String(loc?.name || "").trim(), isHidden: Boolean(loc?.isHidden) }))
		.filter((entry) => entry.name && !isCrossingName(entry.name))
		.map((entry) => ({
			name: entry.name,
			isHidden: entry.isHidden,
			normalizedName: normalizeLocationSearchName(entry.name),
		}))
		.filter((entry) => entry.normalizedName);
```

⚠️ **Der Cache merkt eine Änderung nicht.** `waypointAutocompleteSourceCache` wird an der ANZAHL der
Orte gemessen (`:126-129`); versteckt ein Editor einen Ort, ändert sich die Anzahl nicht, und die
Vorschlagsliste kennzeichnet ihn erst nach einem Neuladen. Das gilt heute schon für Umbenennungen und
bleibt so — die Alternative wäre, den Cache bei jedem Speichern zu verwerfen, für einen Hinweis in
einer Liste, die derselbe Editor gerade selbst gefüllt hat.

- [ ] **Schritt 4b: Den Bauer in die Vorschlagsliste hängen**

Am Ende von `getWaypointAutocompleteSource` (`:221-223`) — nur der **eigene** Zweig bekommt die
Kennzeichnung; der `value` bleibt in beiden Zweigen unangetastet, er ist das Routenziel:

```javascript
		.map((match) => (match.entry.settlement
			? { label: waypointInSettlementLabel(match.entry.name, match.entry.settlement), value: match.entry.settlement }
			: { label: waypointSuggestionLabel(match.entry.name, match.entry), value: match.entry.name }));
```

⚠️ Ein **Innerorts**-Objekt bleibt ungekennzeichnet, auch wenn die Stadt dahinter versteckt wäre: sein
`value` ist die Stadt, und die Klammer trägt dort schon deren Namen. Ein zweiter Zusatz („Villa Mada
(Mengbilla) (versteckt)") wäre mehr Klammer als Auskunft. Bewusst so; kommt es je vor, ist es eine
eigene Entscheidung.

- [ ] **Schritt 5: Das Setzen eines Wegpunkts deckt auf**

In `initializeWaypointAutocomplete`, im `select`-Handler (`:332-339`), vor dem `updateMapView`:

```javascript
		select(event, ui) {
			$(event.target).val(ui.item.value);
			// Wer den Namen eingegeben hat, sieht den Ort -- fuer diesen Besuch. Ohne das plante man
			// eine Route zu einem Punkt, den die Karte nicht zeigt.
			if (typeof avesmapsRevealHiddenLocationByName === "function") {
				avesmapsRevealHiddenLocationByName(ui.item.value);
			}
			window.setTimeout(() => updateMapView(), 0);
		},
```

Und der Namens-Aufschlag daneben (die Vorschlagsliste kennt nur Namen, die Aufdeckungsmenge nur
`publicId`s) — in `js/app/runtime-state.js` neben `avesmapsRevealHiddenLocation`:

```javascript
// Der Wegpunkt kennt nur einen NAMEN (er wird auch von Hand getippt und aus geteilten Links
// gelesen), die Aufdeckungsmenge kennt nur publicIds. Diese Zeile ist die Bruecke.
function avesmapsRevealHiddenLocationByName(name) {
	if (typeof findLocationMarkerByName !== "function") {
		return;
	}
	const entry = findLocationMarkerByName(String(name || "").trim());
	if (entry && entry.publicId) {
		avesmapsRevealHiddenLocation(entry.publicId);
	}
}
```

- [ ] **Schritt 6: Auch der getippte und der geteilte Wegpunkt decken auf**

In `js/routing/routing.js`, in `collectAndValidateSelectedLocations` (`:1471-1495`), im
Erfolgszweig nach `selectedLocations.push`:

```javascript
		if (loc) {
			selectedLocations.push({
				...loc,
				waypointId: String($waypoint.data("waypointId") || ""),
			});
			// 🔴 DIE DRITTE TUER, und die wichtigste: hier laufen ALLE Wege zusammen -- die
			// Vorschlagsliste, der von Hand getippte Name und der geteilte Link, der die Felder
			// vorbefuellt. Ohne sie waere ein geteilter Link auf einen versteckten Ort eine Route
			// zu einem unsichtbaren Punkt.
			if (typeof avesmapsRevealHiddenLocationByName === "function") {
				avesmapsRevealHiddenLocationByName(inputVal);
			}
		} else {
```

- [ ] **Schritt 7: Test laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/wegpunkt-versteckt-label.test.js
```

Erwartet: `wegpunkt-versteckt-label: all asserts passed`

- [ ] **Schritt 8: Ganzes Testfeld, dann Commit + Push + Blick**

```bash
git status --short
git add js/map-features/map-features-waypoints.js js/app/runtime-state.js js/routing/routing.js js/map-features/__tests__/wegpunkt-versteckt-label.test.js
git commit -F- <<'EOF'
feat(versteckte-orte): die Wegpunktsuche bietet sie an, gekennzeichnet -- und das Setzen deckt auf

"Feenplatz (versteckt)" in der Vorschlagsliste, "Feenplatz" ins Feld. Die
Wegpunktsuche ist eine SUCHE, kein Scrollen ueber die Karte -- waere sie strenger
als das Spotlight, waeren die beiden Wege ungleich streng.

Die Aufdeckung haengt an collectAndValidateSelectedLocations, nicht nur am
Auswahl-Handler: dort laufen alle drei Wege zusammen -- die Vorschlagsliste, der
von Hand getippte Name und der geteilte Link, der die Felder vorbefuellt. Sonst
waere ein geteilter Link auf einen versteckten Ort eine Route zu einem
unsichtbaren Punkt.

Die Klammerform ist die, die diese Liste schon fuehrt ("Schänke Schnapsfass
(Imdal)"), und die Kennzeichnung haengt hinten an statt sie zu ersetzen.

Entwurf: docs/superpowers/specs/2026-08-15-versteckte-orte-design.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin master
git rev-parse --short HEAD origin/master
```

🔧 **DU (Owner):** einen versteckten Ort als Wegpunkt tippen — er steht mit „(versteckt)" in der
Liste, und sobald er im Feld steht, erscheint er auf der Karte.

---

## Aufgabe 5: Die Kandidatenliste des Routers

**Dateien:**
- Ändern: `api/_internal/routing/client-graph.php:111-170`
- Ändern: `api/_internal/routing/response.php:239-241`
- Ändern: `api/_internal/routing/__tests__/versteckte-orte-test.php` (aus Aufgabe 1 erweitern)

**Schnittstellen:**
- Nutzt: `is_hidden` in `$networkData['locations']` (Aufgabe 1).
- Liefert: `avesmapsBuildClientCompatibleRouteGraph(...)['candidate_locations']` (array) ·
  `avesmapsCollectRouteRequestWaypointNames(array $request): array` (Namen → `true`).

💣 **Der Befund, der die Bauform festlegt:** `client-graph.php:180` verwirft **jeden Weg**, dessen
Endpunkt auf keinem bekannten Ort liegt. Wer den versteckten Ort aus `$locations` nimmt, löscht damit
jede Straße, die an ihm endet. Der Ort bleibt also **vollständig im Graphen**; gefiltert wird eine
**zweite** Liste, und nur sie geht an die Kandidaten-Erzeuger.

- [ ] **Schritt 1: Den Fehlschlagtest schreiben**

An `api/_internal/routing/__tests__/versteckte-orte-test.php` **anhängen** (vor der `echo`-Zeile):

```php
// ================================================================ die Kandidatenliste des Graphbaus

require_once __DIR__ . '/../client-graph.php';

// Eine Welt: A -- H -- C auf y = 10, H ist versteckt und liegt MITTEN auf der Strasse.
$ort = static fn(string $name, float $x, float $y, bool $hidden = false): array => [
    'type' => 'Feature', 'id' => 'loc-' . $name,
    'geometry' => ['type' => 'Point', 'coordinates' => [$x, $y]],
    'properties' => ['public_id' => 'loc-' . $name, 'name' => $name,
        'feature_type' => 'location', 'feature_subtype' => 'dorf', 'is_hidden' => $hidden],
];
$weg = static fn(string $name, array $von, array $bis): array => [
    'type' => 'Feature', 'id' => 'path-' . $name,
    'geometry' => ['type' => 'LineString', 'coordinates' => [$von, $bis]],
    'properties' => ['public_id' => 'path-' . $name, 'name' => $name,
        'feature_type' => 'path', 'feature_subtype' => 'strasse'],
];

$welt = avesmapsBuildRouteNetworkData(['features' => [
    $ort('A', 5.0, 10.0), $ort('H', 25.0, 10.0, true), $ort('C', 45.0, 10.0),
    $weg('AH', [5.0, 10.0], [25.0, 10.0]),
    $weg('HC', [25.0, 10.0], [45.0, 10.0]),
]]);
$anfrage = ['optimize' => 'fastest', 'transports' => ['land' => 'groupFoot', 'synthetic' => 'groupFoot'],
    'enabled_transports' => ['land' => true, 'river' => true, 'sea' => true]];

$gebaut = avesmapsBuildClientCompatibleRouteGraph($welt, $anfrage);

// ---- 💣 DER VERSTECKTE ORT BLEIBT IM GRAPHEN, und beide Strassen mit ihm -------------------------
// client-graph.php:180 verwirft jeden Weg, dessen Endpunkt auf keinem Ort liegt. Wer H aus der
// Ortsliste streicht, loescht AH und HC -- aus „ein Ort wird nicht angefahren" wuerde „die Gegend
// ist nicht mehr erreichbar". Das ist der Befund, an dem die ganze Bauform haengt.
assert(isset($gebaut['graph']['H']), 'der versteckte Ort bleibt ein Knoten');
assert($gebaut['graph']['A'] !== [], 'die Strasse A--H existiert weiter');
assert($gebaut['graph']['C'] !== [], 'die Strasse H--C existiert weiter');
assert(isset($gebaut['graph']['H']['A']) || isset($gebaut['graph']['A']['H']), 'A und H bleiben verbunden');

// ---- die Kandidatenliste kennt ihn nicht ---------------------------------------------------------
$namen = static function (array $orte): array {
    $liste = [];
    foreach ($orte as $o) { $liste[] = (string) ($o['name'] ?? ''); }
    sort($liste);
    return $liste;
};
assert(isset($gebaut['candidate_locations']), 'der Graphbau gibt seine Kandidatenliste heraus');
assert($namen($gebaut['candidate_locations']) === ['A', 'C'], 'H steht nicht auf der Kandidatenliste');

// ---- ausser er ist das ausdrueckliche Ziel dieser Anfrage ----------------------------------------
// 🔴 Ohne diese Ausnahme fiele ein versteckter Wegpunkt ohne Weganbindung in
// avesmapsConnectClientRouteWaypointsToNearestLandPath aus dem Lookup -- und waere als ZIEL
// unerreichbar. Genau der Fall, den das Merkmal ausdruecklich erhalten soll.
$mitZiel = avesmapsBuildClientCompatibleRouteGraph($welt, $anfrage + ['from' => 'A', 'to' => 'H']);
assert($namen($mitZiel['candidate_locations']) === ['A', 'C', 'H'], 'das ausdrueckliche Ziel steht drin');

$ueberVia = avesmapsBuildClientCompatibleRouteGraph($welt, $anfrage + ['from' => 'A', 'to' => 'C', 'via' => ['H']]);
assert($namen($ueberVia['candidate_locations']) === ['A', 'C', 'H'], 'auch ein Zwischenziel steht drin');

// ---- die Namensernte selbst ----------------------------------------------------------------------
$wegpunkte = avesmapsCollectRouteRequestWaypointNames(['from' => 'A', 'to' => ' H ', 'via' => ['C', '']]);
assert(isset($wegpunkte['A'], $wegpunkte['H'], $wegpunkte['C']), 'from, to und via zaehlen alle');
assert(count($wegpunkte) === 3, 'und ein leerer Eintrag zaehlt nicht');
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/versteckte-orte-test.php
```

Erwartet: `AssertionError: der Graphbau gibt seine Kandidatenliste heraus`

- [ ] **Schritt 3: Die Namensernte schreiben**

In `api/_internal/routing/client-graph.php`, **vor** `avesmapsBuildClientCompatibleRouteGraph`
(`:111`):

```php
/**
 * Die Orte, die diese Anfrage AUSDRUECKLICH nennt -- Start, Ziel und Zwischenziele, als Menge
 * name => true.
 *
 * 🔴 Sie sind die Ausnahme vom Versteckt-Riegel: wer einen Namen eingegeben hat, hat ihn gefunden.
 * Ohne sie fiele ein versteckter Wegpunkt in avesmapsConnectClientRouteWaypointsToNearestLandPath
 * aus dem Lookup und waere als Ziel unerreichbar.
 *
 * ⚠️ Dieselben drei Schluessel liest jene Funktion selbst (:781-790). Sie sind hier nicht
 * abgeschrieben, sondern hierher gezogen -- wer einen vierten Wegpunkt-Schluessel einfuehrt, aendert
 * eine Stelle.
 */
function avesmapsCollectRouteRequestWaypointNames(array $request): array {
    $names = [];
    $raw = array_merge(
        [(string) ($request['from'] ?? ''), (string) ($request['to'] ?? '')],
        is_array($request['via'] ?? null) ? array_map('strval', $request['via']) : []
    );
    foreach ($raw as $rawName) {
        $name = trim($rawName);
        if ($name !== '') {
            $names[$name] = true;
        }
    }

    return $names;
}
```

- [ ] **Schritt 4: Die Kandidatenliste im Graphbau rechnen**

In `avesmapsBuildClientCompatibleRouteGraph`, die Sammelschleife bei `:113-128` erweitern:

```php
    $graph = [];
    $locations = [];
    // 💣 ZWEI LISTEN, UND DAS IST DER GANZE RIEGEL. $locations traegt ALLE Orte -- ein versteckter Ort
    // muss ein Knoten bleiben, sonst verwirft :180 jeden Weg, der an ihm endet, und aus „wird nicht
    // angefahren" wird „ist nicht mehr erreichbar". $candidateLocations ist die Liste, aus der
    // synthetische Kanten ihre Ziele waehlen: Querfeldein-Ausstiege, Notbruecken, Sehnen.
    //
    // 🔴 UND DIE ROHE LISTE VERLAESST DIESE FUNKTION NICHT. Wer einen neuen Erzeuger baut, greift
    // nach dem, was der Graphbau herausgibt, und bekommt die gefilterte -- ohne davon zu wissen.
    // Genau daran ist der 14.08.2026 gescheitert: die Verkehrsmittel-Sperre stand in zwei von vier
    // Erzeugern, und die ZAHL im Kommentar las sich wie eine vollstaendige Liste. Hier steht keine.
    $candidateLocations = [];
    $waypointNames = avesmapsCollectRouteRequestWaypointNames($request);
    foreach (is_array($networkData['locations'] ?? null) ? $networkData['locations'] : [] as $location) {
        if (!is_array($location)) continue;
        $name = trim((string) ($location['name'] ?? ''));
        if ($name === '') continue;
        $coords = $location['geometry']['coordinates'] ?? null;
        if (!is_array($coords) || count($coords) < 2) continue;
        $x = filter_var($coords[0], FILTER_VALIDATE_FLOAT);
        $y = filter_var($coords[1], FILTER_VALIDATE_FLOAT);
        if ($x === false || $y === false) continue;
        $location['route_x'] = (float) $x;
        $location['route_y'] = (float) $y;
        $locations[] = $location;
        if (empty($location['is_hidden']) || isset($waypointNames[$name])) {
            $candidateLocations[] = $location;
        }
        $graph[$name] ??= [];
    }
```

- [ ] **Schritt 5: Die drei Erzeuger auf die gefilterte Liste umhängen**

Weiter unten in derselben Funktion (`:155-160`) — `$locations` durch `$candidateLocations` ersetzen,
**nur** bei den beiden synthetischen Erzeugern. `avesmapsAddClientCompatiblePathConnection` und
`avesmapsCollectClientSeaBoundLocationNames` behalten die volle Liste:

```php
    $syntheticConnectionCount = avesmapsConnectClientCompatibleDetachedGraphComponents($graph, $candidateLocations, $request, $seaBoundLocationNames, $water);
    avesmapsConnectClientRouteWaypointsToNearestLandPath($graph, $candidateLocations, $request, $seaBoundLocationNames, $water);
```

Und das `return`-Array (`:162-170`):

```php
    return [
        'graph' => $graph,
        // 🔴 Die Liste, aus der synthetische Kanten ihre Ziele waehlen duerfen -- versteckte Orte
        // fehlen darin, ausser diese Anfrage nennt sie ausdruecklich. Wer eine Ortsliste fuer einen
        // neuen Erzeuger braucht, nimmt DIESE.
        'candidate_locations' => $candidateLocations,
        'statistics' => [
            'node_count' => count($graph),
            'path_feature_count' => $pathIndex,
            'synthetic_connection_count' => $syntheticConnectionCount,
        ],
    ];
```

- [ ] **Schritt 6: Das Leck in `response.php` schließen**

`api/_internal/routing/response.php:239-241` — die rohe Liste durch die gefilterte ersetzen:

```php
		$report = avesmapsAttachOffroadPointToGraph(
			$clientGraph,
			// 🔴 DIE GEFILTERTE LISTE, nicht $routeNetworkData['locations']. Hier stand bis zum
			// 15.08.2026 die rohe -- ein versteckter Ort waere damit weiter als
			// Querfeldein-Ausstieg angeboten worden, und die Reise stiege an einem Ort aus, den es
			// auf der Karte nicht gibt. Der Riegel im Graphbau haette danebengegriffen.
			is_array($clientGraph['candidate_locations'] ?? null) ? $clientGraph['candidate_locations'] : [],
			$request,
```

- [ ] **Schritt 7: Prüfen, dass die rohe Liste nirgends mehr an einen Erzeuger geht**

```bash
grep -rn "routeNetworkData\['locations'\]" api/ --include=*.php
```

Erwartet: **keine** Zeile mehr, die sie an `avesmapsAttachOffroadPointToGraph` reicht.

```bash
grep -n "candidate_locations" api/_internal/routing/*.php
```

Erwartet: 2 × `client-graph.php` (Kommentar + `return`), 1 × `response.php`.

- [ ] **Schritt 8: Test laufen lassen, grün bestätigen**

```bash
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/versteckte-orte-test.php
```

Erwartet: `versteckte-orte-test: all asserts passed`

- [ ] **Schritt 9: Ganzes Testfeld**

⚠️ Besonders `abgangspunkt-test.php`, `offroad-leg-test.php`, `carriage-offroad-test.php` und
`offroad-multi-goal-test.php` — sie rufen `avesmapsAttachOffroadPointToGraph` mit einer eigenen
Ortsliste auf. Diese Fixtures haben kein `is_hidden` und müssen unverändert grün bleiben; wären sie
es nicht, filtert die neue Regel mehr als sie soll.

- [ ] **Schritt 10: Commit (noch kein Push — Aufgabe 6 reist mit)**

```bash
git status --short
git add api/_internal/routing/client-graph.php api/_internal/routing/response.php api/_internal/routing/__tests__/versteckte-orte-test.php
git commit -F- <<'EOF'
feat(versteckte-orte): der Router waehlt sie nicht mehr als Kandidat

Ein versteckter Ort bleibt VOLLSTAENDIG im Graphen -- an den Verbindungen aendert
sich nichts. client-graph.php:180 verwirft jeden Weg, dessen Endpunkt auf keinem
bekannten Ort liegt; wer den versteckten Ort aus der Ortsliste streicht, loescht
damit jede Strasse, die an ihm endet, und bei zwei Strassen zerfaellt der Graph in
zwei Inseln, ueber die dann eine x25-Notkante gelegt wird. Aus "wird nicht
angefahren" wuerde "ist nicht mehr erreichbar".

Was er verliert, ist seine Rolle als KANDIDAT: die Liste, aus der
Querfeldein-Ausstiege, Notbruecken und Sehnen ihre Ziele waehlen. Sie wird einmal
im Graphbau gerechnet und von dort herausgegeben, und die rohe Liste verlaesst ihn
nicht mehr -- response.php:239 holte sie sich bisher direkt und waere am Riegel
vorbeigelaufen. Ein kuenftiger Erzeuger greift nach dem, was der Graphbau
herausgibt, und bekommt die gefilterte, ohne davon zu wissen.

Das ist die Falle vom 14.08. (vier Erzeuger, Sperre in zweien) samt ihrer Lehre:
die ZAHL im Kommentar war das eigentliche Problem, denn sie las sich wie eine
vollstaendige Liste. Hier steht keine.

Ausnahme sind die Orte, die die Anfrage ausdruecklich nennt -- from, to, via.
Ohne sie fiele ein versteckter Wegpunkt ohne Weganbindung aus dem Lookup und waere
als Ziel unerreichbar.

Entwurf: docs/superpowers/specs/2026-08-15-versteckte-orte-design.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aufgabe 6: Still vorbei

**Dateien:**
- Ändern: `js/routing/route-plan.js:547-549`
- Anlegen: `js/routing/__tests__/versteckte-etappe.test.js`

**Schnittstellen:**
- Nutzt: `isHiddenLocation` (Aufgabe 3) über `findLocationMarkerByName`.
- Liefert: erweitertes `isRoutePlanMarkerName`.

Liegt ein versteckter Ort an einer Straße, ist er ein Knoten der Route — die Straße ist an ihm
geteilt. Der Reiniger, der schon „Kreuzung" und „Markierung" aus der Etappenliste nimmt, nimmt ihn
mit.

- [ ] **Schritt 1: Den Fehlschlagtest schreiben**

Anlegen: `js/routing/__tests__/versteckte-etappe.test.js`

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// „Still vorbei" (Owner 15.08.2026): liegt ein versteckter Ort an einer Strasse, faehrt die Reise
// hindurch -- sein Name faellt aus der Etappenliste. Die Strasse bleibt ganz, die Route bleibt
// gleich lang; es verschwindet nur der Name.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/routing/__tests__/versteckte-etappe.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "route-plan.js"), "utf8");
const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() nicht in route-plan.js gefunden -- umbenannt?`);
	return match[0];
};

let marker = {};
const context = {
	String, Boolean, Object,
	normalizeNodeName: (name) => (String(name || "").startsWith("Kreuzung") ? "Kreuzung" : String(name || "")),
	findLocationMarkerByName: (name) => marker[name] || null,
	isHiddenLocation: (location) => Boolean(location && location.isHidden),
};
vm.runInNewContext(extract("isRoutePlanMarkerName"), context);
const { isRoutePlanMarkerName } = context;

marker = {
	Luring: { publicId: "loc-lur", location: { publicId: "loc-lur" } },
	Feenplatz: { publicId: "loc-fee", location: { publicId: "loc-fee", isHidden: true } },
};

// --- der Bestand bleibt, wie er ist ---------------------------------------------------------------
assert.strictEqual(isRoutePlanMarkerName("Kreuzung-7"), true, "eine Kreuzung ist weiterhin Laerm");
assert.strictEqual(isRoutePlanMarkerName("Markierung"), true, "eine Markierung auch");
assert.strictEqual(isRoutePlanMarkerName("Luring"), false, "ein gewoehnlicher Ort nicht");

// --- der versteckte Durchgangsort faellt heraus ----------------------------------------------------
assert.strictEqual(isRoutePlanMarkerName("Feenplatz"), true, "ein versteckter Ort ist Laerm");

// --- 🔴 der AUFGEDECKTE nicht ---------------------------------------------------------------------
// Wer ihn ausdruecklich als Wegpunkt gesetzt hat, hat ihn aufgedeckt -- und das eigene Reiseziel darf
// nicht aus dem Reiseplan verschwinden. isHiddenLocation beantwortet genau diese Frage schon (es
// prueft die Aufdeckungsmenge mit), deshalb steht hier keine zweite Menge.
marker.Feenplatz.location.isHidden = false;   // stellvertretend fuer „aufgedeckt"
assert.strictEqual(isRoutePlanMarkerName("Feenplatz"), false, "der aufgedeckte Ort bleibt in der Liste");

// --- ein unbekannter Name faellt NICHT heraus -------------------------------------------------------
// ⚠️ Ein Name ohne Marker ist kein versteckter Ort, sondern ein Knoten, den der Client (noch) nicht
// kennt. Ihn zu schlucken hiesse, eine Etappe stillschweigend zu verlieren.
assert.strictEqual(isRoutePlanMarkerName("Unbekannt"), false, "ein unbekannter Name bleibt stehen");

console.log("versteckte-etappe: all asserts passed");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/routing/__tests__/versteckte-etappe.test.js
```

Erwartet: `AssertionError: ein versteckter Ort ist Laerm`

- [ ] **Schritt 3: Das Prädikat erweitern**

`js/routing/route-plan.js:547-549`:

```javascript
// 💣 DIESES PRAEDIKAT ENTSCHEIDET, OB EINE ETAPPE SCHLIESST (cleanRoutePlanNoiseEntries) -- es ist
// keine reine Anzeigefrage. „Luring -> Feenplatz -> Spinnried" wird zu „Luring -> Spinnried".
//
// 🔴 Der AUFGEDECKTE versteckte Ort bleibt stehen: wer ihn als Wegpunkt gesetzt hat, darf sein
// eigenes Reiseziel nicht aus dem Reiseplan verlieren. isHiddenLocation beantwortet genau diese
// Frage mit (es prueft die Aufdeckungsmenge), deshalb steht hier keine zweite Menge.
//
// ⚠️ Ein Name OHNE Marker faellt nicht heraus. Das ist kein versteckter Ort, sondern ein Knoten, den
// der Client nicht kennt -- ihn zu schlucken hiesse, eine Etappe stillschweigend zu verlieren.
function isRoutePlanMarkerName(name) {
	if (normalizeNodeName(name) === "Kreuzung" || String(name || "") === "Markierung") {
		return true;
	}
	if (typeof findLocationMarkerByName !== "function" || typeof isHiddenLocation !== "function") {
		return false;
	}
	const entry = findLocationMarkerByName(String(name || ""));
	return Boolean(entry) && isHiddenLocation(entry.location);
}
```

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
node js/routing/__tests__/versteckte-etappe.test.js
```

Erwartet: `versteckte-etappe: all asserts passed`

- [ ] **Schritt 5: Ganzes Testfeld**

⚠️ Besonders `js/routing/__tests__/abgangspunkt-label.test.js` — `nameRoutePlanTransferPoints` läuft
**nach** `cleanRoutePlanNoiseEntries` und entscheidet an demselben Prädikat, ob eine Etappe schließt.
Die Reihenfolge darf sich nicht verschieben.

- [ ] **Schritt 6: Commit + Push + Blick**

```bash
git status --short
git add js/routing/route-plan.js js/routing/__tests__/versteckte-etappe.test.js
git commit -F- <<'EOF'
feat(versteckte-orte): still vorbei -- der versteckte Durchgangsort faellt aus der Etappenliste

Liegt ein versteckter Ort an einer Strasse, ist er ein Knoten der Route: die
Strasse ist an ihm geteilt, und ohne diese Aenderung nennte die Etappenliste ihn.
"Luring -> Feenplatz -> Spinnried" wird zu "Luring -> Spinnried". Die Reise
bleibt gleich lang; es verschwindet nur der Name -- die Etappenliste waere sonst
ein Verzeichnis aller versteckten Orte.

Getragen von dem Reiniger, der Kreuzungen und Markierungen schon herausnimmt.
Der AUFGEDECKTE Ort bleibt stehen: wer ihn als Wegpunkt gesetzt hat, darf sein
eigenes Reiseziel nicht verlieren -- isHiddenLocation beantwortet diese Frage mit,
also braucht es keine zweite Menge. Ein Name ohne Marker faellt nicht heraus; das
ist kein versteckter Ort, sondern ein Knoten, den der Client nicht kennt, und ihn
zu schlucken hiesse, eine Etappe stillschweigend zu verlieren.

Entwurf: docs/superpowers/specs/2026-08-15-versteckte-orte-design.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin master
git rev-parse --short HEAD origin/master
```

---

## Abnahme am lebenden Objekt

💣 **Ablauf, nicht Maß** (AGENTS.md §9). Nach Aufgabe 6, auf `https://avesmaps.de`, in dieser
Reihenfolge — jeder Handgriff wird ausgeführt und benannt, nicht gemessen:

- [ ] Einen Ort **mit** Weganbindung verstecken, speichern.
- [ ] Karte neu laden → **Markierung und Name sind weg**, an der Stelle ist Pergament.
- [ ] Über die Stelle scrollen und hineinzoomen → er bleibt weg.
- [ ] Namen ins **Spotlight** tippen → er erscheint, die dritte Zeile **„Versteckt"** ist vollständig
      lesbar (nicht abgeschnitten).
- [ ] Treffer wählen → Karte springt hin, **Markierung ist da**.
- [ ] Ihn als **Wegpunkt** setzen (Vorschlag zeigt „(versteckt)"), Route dorthin planen → die Route
      kommt an, der Reiseplan nennt ihn.
- [ ] Einen **zweiten** versteckten Ort anlegen, der **an einer Straße** liegt; eine Route quer
      darüber planen → er steht **nicht** in der Etappenliste, die Route ist unverändert lang.
- [ ] Seite neu laden → beide sind wieder versteckt.
- [ ] Als Editor **„Versteckte Orte"** anhaken → beide erscheinen; Haken weg → beide weg.
- [ ] Eine **Ruine** im Spotlight suchen → dritte Zeile „Ruine".
- [ ] Einen Ort, der **beides** ist, suchen → „Ruine · Versteckt" auf einer Zeile.
- [ ] Alles in **hell und dunkel** (AGENTS.md §12).

⚠️ Was ein Emulator nicht beantworten kann (echtes Touch-Verhalten am Telefon, Bildschirmtastatur),
wird als **offene Frage** gemeldet, nicht als bestanden.

### Vor dem letzten Push

- [ ] **`usability-konsistenz`** — Entwurf gegen Diff, gekoppelte Werte, gewinnt die Regel überhaupt?
- [ ] **`usability-design`** — Mockup gegen gebauten Zustand, Designsprache, Rangfolge in hell UND
      dunkel.
- [ ] **Jede 💣 / ⚠️ / 🔴-Zeile des Entwurfs einzeln abgehakt** — erfüllt, oder ausdrücklich verworfen
      mit Begründung. Zwei der vier Regressionen vom 10.08.2026 standen wörtlich als Warnung im
      eigenen Entwurf und wurden nicht gebaut; es fehlte kein Wissen, sondern das Abhaken.

### Was offen bleibt

🔧 **Owner-Frage für später:** Die Infobox hängt „(Ruine)" aus dem **Wiki**-Feld an
(`locationTypeLabelForDisplay`), die neue Spotlight-Zeile liest das **eigene** Feld des Kartenpunkts.
Die beiden können auseinanderlaufen. Bewusst nicht nebenbei geheilt (Entwurf §5.3). Soll die Infobox
auf das eigene Feld umgestellt werden?
