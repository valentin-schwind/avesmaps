# Wiki-Orte ohne Kartenpunkt überschreiben — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Ort aus dem Reiter „Fehlt" des Orts-Editors wird bearbeitbar (Name, Typ, Ruine, Verborgen), Innerorts und „Gehört zu" werden sichtbar und überschreibbar, und das ↺ leert ein von uns gesetztes Feld, wenn das Wiki dort nichts hat.

**Architecture:** Eine Override-Zeile je Wiki-Seite (`settlement_wiki_override`, JSON), eine reine Funktion, die aus Wiki-Stand + Override den wirksamen Stand macht, und alle Leser des Innerorts-Urteils rufen sie. Name/Typ/Ruine/Verborgen wandern beim Platzieren in die Kartenzeile; Innerorts/„Gehört zu" bleiben an der Wiki-Seite.

**Tech Stack:** PHP 8 (strict types, PDO MySQL/MariaDB, Tests gegen SQLite), Vanilla-JS ohne Build, Node-Tests mit `assert` + `vm`.

**Spec:** `docs/superpowers/specs/2026-09-15-wiki-ort-override-design.md` (Mockup `docs/wiki-ort-override-mockup.html`).

## Global Constraints

- Kommentare, Doku, Commit-Nachrichten **deutsch** (AGENTS.md §8). `error.code` bleibt englisch.
- **Nie** `git add -A` / `git add .` / `commit -a`. Arbeiten in einem Wegwerf-Worktree auf `origin/master`; stagen nur eigene Pfade; Commit-Nachricht per `-F <datei>`; vor dem Push `gh run list --limit 3` (kein `in_progress`/`pending`), nach dem Push SHA gegen `origin/master` prüfen (AGENTS.md §9, Gedächtnis `push-workflow`).
- **Sichtbare Schritte gehen einzeln live** und warten auf den Blick des Owners (Tasks 1, 2, 5, 6). Unsichtbare dürfen gebündelt werden.
- Vor jedem Push das **ganze Testfeld** nach dem Muster des Workflows (`.github/workflows/deploy-avesmaps-strato.yml:130-133`), lokal mit `AVESMAPS_TEST_PHP_ARGS="-d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll"`, parallel, Dateizahl gegenzählen.
- **DDL nie in einer Transaktion**, `Ensure…` nur im Schreibweg. Leser fallen bei fehlender Tabelle still auf „keine Overrides" zurück.
- **Kein `ON DUPLICATE KEY` / `ON CONFLICT`** in neuem Code — lesen, dann `UPDATE` oder `INSERT` (Vorbild `avesmapsSettlementPlaceAdd`).
- Validierungsfehler im Endpunkt sind **`RuntimeException`** (→ 400); `InvalidArgumentException` landet als 500.
- Neue Aktionen verlangen Fähigkeit **`edit`** (`avesmapsRequireUserWithCapability('edit')`), der Endpunkt selbst prüft nur `review`.
- Zeile 587 von `api/app/map-features.php` (`'in_settlement_places' => … avesmapsMapFeaturesInSettlementPlaces($pdo),`) bleibt **wörtlich** (gepinnt von `map-features-delta-schlank-test.php`); die ETag-Zeile 323 bleibt **eine** Zeile.
- `avesmapsWikiSettlementEditorList` enthält `'coat_url' =>` genau **zweimal** (`editor-wappen-nur-lokal-test.php`).
- `html/editor-handbuch.html` wird **nicht** angefasst; der Commit-Betreff nennt die sichtbare Wirkung (AGENTS.md §9).
- Keine `?v=` von Hand. Die Editorseite `html/wiki-sync-settlement-editor.html` wird vom Deploy gestempelt.
- Tests **führen** Code aus (vm/eval/Funktionsaufruf); ein Regex auf den Quelltext ist nur für Verdrahtung erlaubt und dann kommentarfrei.
- Nach jedem Task eine Mutationsprobe gegen die tragende Zeile (Zeile ändern → Test rot → zurück, Byte-Gegenprobe mit `git diff --stat`).

## Korrekturen am Entwurf (aus der Recherche; im Entwurf nachgetragen am 15.09.2026)

1. **§5 Platzieren:** Der Anlegedialog übernimmt aus `?action=preview` heute weder Name noch Typ, Ruine oder Verborgen (`selectSettlementWikiResultWhileCreating`, `js/review/review-settlement-wiki.js:116-153`). Es gibt deshalb **keine** Vorbelegung aus der Vorschau. Der häufige Platzier-Weg ist das Ziehen aus der Panel-Liste (`createAndAssignDraggedSettlement`, `js/review/review-settlement-list.js:640-695`): `create_point` mit Wiki-Titel und Registerklasse, danach `assign_to`. Die Übernahme sitzt allein im Server-Helfer.
2. **§5 Name:** `assign_to` schreibt heute nur `properties_json`. Die Übernahme schreibt zusätzlich die Spalten `name`/`feature_subtype` samt ihrer Kopien in `properties`, prüft den Namen mit `avesmapsAssertUniqueLocationName` (bei Doppel: Name wird **nicht** übernommen und in der Antwort gemeldet) und schreibt ins Protokoll den **neuen** Namen (Undo-Riegel, `locations-helpers.php:181-182`).
3. **§5 Ziehen:** Die Panel-Liste nimmt `item.name` als Wiki-Titel (`review-settlement-list.js:409`). Mit einem Namens-Override wäre das falsch → das Ziehen liest künftig `item.wiki_title`.
4. **§6 Kasten „Wiki-Ort":** Das Bauteil zeigt Rohwerte (`js/ui/wiki-assign.js:578-587`) und kennt keine Übersetzung. Die Beschriftung der Ortsgröße ist **nicht** Teil dieses Plans, sondern ein eigener Folgeauftrag.
5. **§6 ↺:** `leerbar: false` tragen: Ort `name`, `feature_subtype` · Weg `feature_subtype` · Landschaft `name`, `region_type` · Beschriftung `text`, `feature_subtype` · Literatur `title`, `product_type`, `edition`. Damit bekommen **nur Ort und Literatur** neue ↺ (Einwohner, Lage, Herrscher · Serie, Genre, Komplexität SL/Spieler, Autoren, F-Shop-Code, ISBN).

## Dateien

| Datei | Verantwortung |
|---|---|
| **neu** `api/_internal/wiki/settlement-wiki-override.php` | Tabelle, Lesen, Stempel, Setzen, Zurücknehmen; reine Funktionen `…Effektiv`, `…Bereinigen`, `…UebernahmePlan`. Abhängig nur von `../ortsklassen.php` — **kein** `sync.php` (die Suche lädt es nicht). |
| **neu** `api/_internal/wiki/__tests__/settlement-wiki-override-test.php` | reine Funktionen + SQLite-Ablage |
| `api/_internal/wiki/settlements.php` | beide Listen, `AssignTo`, `BulkConnect` |
| `api/_internal/app/in-settlement-search.php` | Zeilenquelle markieren, beide Bauer mit Override-Nachschlag |
| `api/_internal/app/offmap-search.php` | Bauer mit Override-Nachschlag |
| `api/app/map-search.php`, `api/app/map-features.php` | Nachschlag verdrahten, Stempel, verborgene platzierte Bauwerke |
| `api/edit/wiki/settlements.php` | `set_field_override`, `clear_field_override` |
| `js/ui/wiki-feld-herkunft.js`, `js/ui/wiki-assign-registry.js` | ↺ bei leerem Wiki |
| `html/wiki-sync-settlement-editor.html` | Listenzeile, Formular nicht platziert, „Lage & Zugehörigkeit" |
| `js/review/review-settlement-list.js` | Ziehen über `wiki_title` |

---

### Task 1: Liste — Innerorts-Urteil für „Fehlt"-Zeilen und die zweite Zeile (sichtbar)

**Files:**
- Modify: `api/_internal/wiki/settlements.php` (`avesmapsWikiSettlementEditorList`, on-map-Eintrag ~1843-1880, wiki-only-Eintrag ~1914-1943)
- Modify: `html/wiki-sync-settlement-editor.html` (`rowSelectionKey` ~1545, `renderSettlementRowElement` ~1550-1640)
- Test: `api/_internal/wiki/__tests__/editor-liste-innerorts-test.php` (neu), `js/pages/__tests__/ortsliste-innerorts-zeile.test.js` (neu)

**Interfaces:**
- Produces: jeder Listeneintrag trägt `wiki_title` (string, bei nicht zugewiesenen platzierten Orten `''`); wiki-only-Einträge tragen `place_scope`, `place_scope_label`, `place_settlement`. JS: `settlementRowZweiteZeile(item) → {klasse: string, text: string}`.

- [ ] **Step 1: Failing PHP-Verdrahtungstest schreiben** — `api/_internal/wiki/__tests__/editor-liste-innerorts-test.php`

```php
<?php
declare(strict_types=1);
// Der wiki-only-Eintrag der Orts-Editor-Liste gibt das Innerorts-Urteil heraus, das er rechnet.
// ⚠️ Die Funktion faehrt DDL gegen information_schema und laesst sich nicht gegen SQLite ausfuehren;
// dieser Test prueft deshalb die VERDRAHTUNG (kommentarfrei geschnitten). Die Wirkung prueft Task 3c.
if (ini_get('zend.assertions') !== '1') { fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'\n"); exit(2); }

$quelle = (string) file_get_contents(__DIR__ . '/../settlements.php');
$ohneKommentare = '';
foreach (token_get_all($quelle) as $t) {
    if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) { continue; }
    $ohneKommentare .= is_array($t) ? $t[1] : $t;
}
$start = strpos($ohneKommentare, 'function avesmapsWikiSettlementEditorList(');
assert($start !== false, 'avesmapsWikiSettlementEditorList nicht gefunden');
$ende = strpos($ohneKommentare, "\nfunction ", $start + 10);
$rumpf = substr($ohneKommentare, $start, $ende - $start);

$wikiOnly = substr($rumpf, (int) strpos($rumpf, '$regScope = avesmapsPlaceScopeClassifyWithIndex('));
$wikiOnly = substr($wikiOnly, 0, (int) strpos($wikiOnly, 'usort('));
foreach (["'place_scope' => \$regScope['scope']", "'place_scope_label' => avesmapsPlaceScopeLabel(\$regScope['scope'])",
          "'place_settlement' => \$regScope['settlement']", "'wiki_title' => \$title"] as $pflicht) {
    assert(str_contains($wikiOnly, $pflicht), 'wiki-only-Eintrag ohne: ' . $pflicht);
}
assert(substr_count($rumpf, "'wiki_title' =>") === 2, 'beide Eintraege (platziert und wiki-only) tragen wiki_title');
assert(substr_count($rumpf, "'coat_url' =>") === 2, 'coat_url darf nicht dazukommen (editor-wappen-nur-lokal-test)');
echo "editor-liste-innerorts: alle Zusicherungen erfuellt\n";
```

- [ ] **Step 2: Laufen lassen, muss rot sein**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/editor-liste-innerorts-test.php`
Expected: FAIL `wiki-only-Eintrag ohne: 'place_scope' => $regScope['scope']`

- [ ] **Step 3: Server ändern.** Im wiki-only-Eintrag nach `'building_type' => (string) ($r['building_type'] ?? ''),` einfügen:

```php
            // 💣 Das Urteil stand hier seit jeher gerechnet und nie herausgegeben -- alle Fehlt-Zeilen
            // galten im Browser als „außerorts", und der Filter „Lage" griff dort nicht (15.09.2026).
            'wiki_title' => $title,
            'place_scope' => $regScope['scope'],
            'place_scope_label' => avesmapsPlaceScopeLabel($regScope['scope']),
            'place_settlement' => $regScope['settlement'],
```

Im on-map-Eintrag nach `'place_settlement' => $mapScope['settlement'],` einfügen:

```php
            // Der Titel des zugewiesenen Artikels -- der Schluessel, unter dem Overrides und Innerorts
            // an der Wiki-Seite haengen. Leer, wenn der Ort keinen Artikel hat.
            'wiki_title' => is_array($ws) && !empty($ws['title']) ? (string) $ws['title'] : '',
```

- [ ] **Step 4: PHP-Test grün**

Run: wie Step 2. Expected: `editor-liste-innerorts: alle Zusicherungen erfuellt`

- [ ] **Step 5: Failing JS-Test schreiben** — `js/pages/__tests__/ortsliste-innerorts-zeile.test.js`

```js
"use strict";
// Die zweite Zeile einer Listenzeile im Orts-Editor sagt bei einem nicht platzierten Bauwerk,
// ob es innerorts liegt und wo. Ausgefuehrt, nicht gelesen.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const EDITOR_HTML = "html/wiki-sync-settlement-editor.html";
const quelle = fs.readFileSync(path.join(wurzel, EDITOR_HTML), "utf8");
const bloecke = (quelle.match(/<script>([\s\S]*?)<\/script>/g) || [])
	.map((b) => b.replace(/^<script>/, "").replace(/<\/script>$/, ""))
	.sort((a, b) => b.length - a.length);
assert.ok(bloecke[0] && bloecke[0].includes("function settlementRowZweiteZeile"),
	"settlementRowZweiteZeile fehlt im Oberflaechenblock");

const schein = () => ({ value: "", checked: false, dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
	addEventListener() {}, appendChild() {}, setAttribute() {}, getAttribute() { return null; }, closest() { return null; },
	querySelector() { return null; }, querySelectorAll() { return []; }, textContent: "", innerHTML: "" });
const kasten = { console, JSON, Math, Date, Number, String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
	setTimeout, clearTimeout, setInterval, clearInterval, isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
	document: { readyState: "complete", getElementById: () => schein(), querySelector: () => null, querySelectorAll: () => [],
		createElement: () => schein(), addEventListener() {}, body: schein(), documentElement: schein() },
	location: { href: "http://pruefstand.local/", search: "", origin: "http://pruefstand.local" },
	addEventListener() {}, removeEventListener() {}, parent: null,
	fetch() { return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); } };
kasten.window = kasten; kasten.globalThis = kasten; kasten.self = kasten;
vm.createContext(kasten);
["js/ui/ortsklassen.js", "js/ui/ribbon-menu.js", "js/ui/filter-menu.js", "js/ui/listen-statuskreis.js", "js/ui/dialog-hintergrund-schliessen.js",
	"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-feld-herkunft.js", "js/ui/wiki-assign.js", "js/ui/wiki-assign-ort.js"]
	.forEach((datei) => vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei }));
vm.runInContext(bloecke[0], kasten, { filename: EDITOR_HTML });
const zeile = (item) => JSON.parse(JSON.stringify(vm.runInContext("settlementRowZweiteZeile", kasten)(item)));

assert.deepStrictEqual(zeile({ on_map: false, settlement_class: "gebaeude", place_scope_label: "innerorts", place_settlement: "Gareth" }),
	{ klasse: "avm-row__l2 se-line2 mut", text: "○ nur Wiki · innerorts in Gareth" });
assert.deepStrictEqual(zeile({ on_map: false, settlement_class: "stadtviertel", place_scope_label: "außerorts", place_settlement: "" }),
	{ klasse: "avm-row__l2 se-line2 mut", text: "○ nur Wiki · außerorts" });
assert.deepStrictEqual(zeile({ on_map: false, settlement_class: "gebaeude", place_scope_label: "unklar", place_settlement: "Angbar" }),
	{ klasse: "avm-row__l2 se-line2 mut", text: "○ nur Wiki · unklar (Angbar)" });
// Ohne Urteil (alte Server-Antwort) bleibt der bisherige Satz -- nichts wird geraten.
assert.deepStrictEqual(zeile({ on_map: false, settlement_class: "gebaeude" }),
	{ klasse: "avm-row__l2 se-line2 mut", text: "○ nur Wiki (nicht platziert)" });
// Eine Siedlung liegt nicht in einer Siedlung.
assert.deepStrictEqual(zeile({ on_map: false, settlement_class: "dorf", place_scope_label: "innerorts", place_settlement: "Gareth" }),
	{ klasse: "avm-row__l2 se-line2 mut", text: "○ nur Wiki (nicht platziert)" });
// Platzierte Zeilen unveraendert.
assert.strictEqual(zeile({ on_map: true, territory_wiki_key: null }).text, "⚠ nicht zugeordnet");

// Der Auswahlschluessel einer Fehlt-Zeile haengt am Wiki-Titel, nicht am (kuenftig ueberschreibbaren) Namen.
const schluessel = vm.runInContext("rowSelectionKey", kasten);
assert.strictEqual(schluessel({ public_id: "", name: "Anderer Name", wiki_title: "Echter Titel" }), "wiki:Echter Titel");
assert.strictEqual(schluessel({ public_id: "", name: "Nur Name" }), "wiki:Nur Name");
console.log("ortsliste-innerorts-zeile: alle Zusicherungen erfuellt");
```

- [ ] **Step 6: Laufen lassen, muss rot sein**

Run: `node js/pages/__tests__/ortsliste-innerorts-zeile.test.js`
Expected: FAIL `settlementRowZweiteZeile fehlt im Oberflaechenblock`

- [ ] **Step 7: Editor ändern.** `rowSelectionKey` ersetzen durch:

```js
function rowSelectionKey(item) {
	if (item && item.public_id) return item.public_id;
	// 🔴 Der WIKI-TITEL, nicht der Name: der Name einer Fehlt-Zeile wird ueberschreibbar
	// (Entwurf 2026-09-15 §0.7), der Titel ist ihr Schluessel.
	return "wiki:" + String((item && (item.wiki_title || item.name)) || "");
}
```

Direkt vor `function renderSettlementRowElement(item) {` einfügen:

```js
// Die zweite Zeile einer Listenzeile -- REIN, damit sie ohne DOM pruefbar ist.
// 🔴 Innerorts steht nur bei BAUWERKEN (eine Siedlung liegt nicht in einer Siedlung) und nur, wenn
// der Server ein Urteil geschickt hat; ohne Urteil bleibt der alte Satz, nichts wird geraten.
function settlementRowZweiteZeile(item) {
	const it = item || {};
	if (it.on_map !== true) {
		const urteil = String(it.place_scope_label || "").trim();
		if (urteil !== "" && avesmapsIstBauwerksklasse(it.settlement_class)) {
			const stadt = String(it.place_settlement || "").trim();
			let text = "○ nur Wiki · " + urteil;
			if (urteil === "innerorts" && stadt !== "") text += " in " + stadt;
			if (urteil === "unklar" && stadt !== "") text += " (" + stadt + ")";
			return { klasse: "avm-row__l2 se-line2 mut", text };
		}
		return { klasse: "avm-row__l2 se-line2 mut", text: "○ nur Wiki (nicht platziert)" };
	}
	if (it.territory_wiki_key) {
		return { klasse: "avm-row__l2 se-line2 ok", text: "✓ " + territoryDisplayName(it.territory_wiki_key) };
	}
	return { klasse: "avm-row__l2 se-line2 warn", text: "⚠ nicht zugeordnet" };
}
```

In `renderSettlementRowElement` den Block

```js
	if (item.on_map !== true) {
		// Wiki-only ("Fehlt"): not placed on the map yet, so there is no territory to assign.
		line2.className = "avm-row__l2 se-line2 mut";
		terr.textContent = "○ nur Wiki (nicht platziert)";
	} else if (item.territory_wiki_key) {
		line2.className = "avm-row__l2 se-line2 ok";
		terr.textContent = "✓ " + territoryDisplayName(item.territory_wiki_key);
	} else {
		line2.className = "avm-row__l2 se-line2 warn";
		terr.textContent = "⚠ nicht zugeordnet";
	}
```

ersetzen durch:

```js
	const zweite = settlementRowZweiteZeile(item);
	line2.className = zweite.klasse;
	terr.textContent = zweite.text;
```

- [ ] **Step 8: Tests grün, Nachbarn grün**

Run: `node js/pages/__tests__/ortsliste-innerorts-zeile.test.js && node js/pages/__tests__/ortsliste-auswahl-wandert.test.js && node js/pages/__tests__/editor-abschnittsreihenfolge.test.js && php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/editor-wappen-nur-lokal-test.php`
Expected: alle vier grün.

- [ ] **Step 9: Mutationsprobe** — in `settlementRowZweiteZeile` `avesmapsIstBauwerksklasse(it.settlement_class)` durch `true` ersetzen → Test rot (Fall „dorf") → zurück. `'place_settlement' => $regScope['settlement'],` löschen → PHP-Test rot → zurück. `git diff --stat` muss danach nur die beabsichtigten Zeilen zeigen.

- [ ] **Step 10: Ganzes Testfeld, Commit, Push, Owner-Blick**

Commit-Betreff (Datei `-F`): `ui(orte): Fehlt-Zeilen sagen „innerorts in <Stadt>" -- und der Filter „Lage" greift dort endlich`

---

### Task 2: ↺ bei leerem Wiki — überall, ausser Pflicht- und Auswahlfeldern (sichtbar)

**Files:**
- Modify: `js/ui/wiki-feld-herkunft.js:71-104`
- Modify: `js/ui/wiki-assign-registry.js` (Zeilen 96, 182, 184, 263, 265, 333, 335, 536, 538, 539)
- Modify: `js/ui/__tests__/wiki-feld-herkunft.test.js:69-77`, `js/ui/__tests__/wiki-assign-literatur.test.js` (Abschnitt I)
- Test: `js/ui/__tests__/wiki-feld-leerbar.test.js` (neu)

**Interfaces:**
- Produces: Feldregister-Zeilen dürfen `leerbar: false` tragen. `avesmapsWikiFeldStand` meldet zusätzlich `abweicht: true`, wenn `wikiWert === ""`, Kartenwert nicht leer, Herkunft `"manual"` und das Feld nicht `leerbar: false` ist; `wikiAnzeige` ist dann `"(leer)"`. Konstante `AVESMAPS_WIKI_FELD_LEER = "(leer)"`.

- [ ] **Step 1: Bestehenden Test auf die neue Regel umschreiben.** In `js/ui/__tests__/wiki-feld-herkunft.test.js` den Block von `// ⚠️ UND DIE ANDERE RICHTUNG IST KEINE ABWEICHUNG` bis einschliesslich der `wikiSchweigt`-Zusicherung (Zeilen 69-77) ersetzen durch:

```js
// 🔴 SAGT DAS WIKI NICHTS UND HABEN WIR ETWAS GESETZT, IST DAS EINE ABWEICHUNG (Owner 15.09.2026,
// Entwurf 2026-09-15-wiki-ort-override §0.3/§0.8): das ↺ holt den Wiki-Stand, und der ist „leer".
const wikiSchweigt = avesmapsWikiFeldStand(
	[{ wiki: "oberhaupt", karte: "oberhaupt" }],
	{ oberhaupt: "Growin" }, { oberhaupt: "" }, { oberhaupt: "manual" }
);
assert.strictEqual(wikiSchweigt.oberhaupt.abweicht, true, "von uns gesetzt + Wiki leer muss ein ↺ bekommen");
assert.strictEqual(wikiSchweigt.oberhaupt.wikiWert, "", "das ↺ muss LEEREN, nicht etwas erfinden");
assert.strictEqual(wikiSchweigt.oberhaupt.wikiAnzeige, "(leer)");

// ⚠️ HERKUNFT UNBEKANNT bleibt still: Werte von vor dem 17.08.2026 tragen keine Herkunft, und ein ↺
// dort leerte fremde Handarbeit mit einem Klick.
const unbekannt = avesmapsWikiFeldStand(
	[{ wiki: "oberhaupt", karte: "oberhaupt" }],
	{ oberhaupt: "Growin" }, { oberhaupt: "" }, {}
);
assert.strictEqual(unbekannt.oberhaupt.abweicht, false, "ohne gespeicherte Herkunft darf kein Leeren angeboten werden");

// 🔴 PFLICHT- UND AUSWAHLFELDER NIE: ein leerer Name laesst sich nicht speichern, ein leerer
// Schluessel ist kein gueltiger Auswahlwert.
const nichtLeerbar = avesmapsWikiFeldStand(
	[{ wiki: "name", karte: "name", leerbar: false }],
	{ name: "Ferdok" }, { name: "" }, { name: "manual" }
);
assert.strictEqual(nichtLeerbar.name.abweicht, false, "leerbar: false wurde uebergangen");
```

- [ ] **Step 2: Neuen Registertest schreiben** — `js/ui/__tests__/wiki-feld-leerbar.test.js`

```js
"use strict";
// Welche Felder das ↺ nie leeren darf -- gegen die OBERFLAECHEN gehalten, nicht gegen eine Liste.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const wurzel = path.resolve(__dirname, "..", "..", "..");
const registry = require("../wiki-assign-registry.js");
const subjekt = (art) => registry.avesmapsWikiAssignSubject(art);
const nichtLeerbar = (art) => (subjekt(art).felder || []).filter((f) => f.karte && f.leerbar === false).map((f) => f.karte).sort();

// Gemessen am 15.09.2026 (Bauplan, Korrektur 5). Aendert sich eine Oberflaeche, faellt die Probe darunter um.
assert.deepStrictEqual(nichtLeerbar("ort"), ["feature_subtype", "name"]);
assert.deepStrictEqual(nichtLeerbar("weg"), ["feature_subtype"]);
assert.deepStrictEqual(nichtLeerbar("landschaft"), ["name", "region_type"]);
assert.deepStrictEqual(nichtLeerbar("landschaftslabel"), ["feature_subtype", "text"]);
assert.deepStrictEqual(nichtLeerbar("literatur"), ["edition", "product_type", "title"]);

// Die Literatur baut ihre Felder ueber aeField(label, feld, wert, o, opts): jedes Auswahlfeld
// (groups/select) und jedes Pflichtfeld (Beschriftung mit „*") muss leerbar: false tragen.
const literatur = fs.readFileSync(path.join(wurzel, "html/game-literature-editor.html"), "utf8");
const kartenfelder = new Set((subjekt("literatur").felder || []).filter((f) => f.karte).map((f) => f.karte));
const aufrufe = [...literatur.matchAll(/aeField\("([^"]*)",\s*"([a-z_]+)",[^\n]*/g)];
assert.ok(aufrufe.length >= 10, "die aeField-Aufrufe wurden nicht gefunden -- die Probe waere leer");
aufrufe.forEach(([zeile, label, feld]) => {
	if (!kartenfelder.has(feld)) return;
	const muss = /\{\s*(groups|select)\s*:/.test(zeile) || /\*\s*$/.test(label);
	if (muss) assert.ok(nichtLeerbar("literatur").includes(feld), "Literaturfeld " + feld + " ist Auswahl/Pflicht, aber leerbar");
});

// Die Ortsgroesse ist in beiden Ort-Oberflaechen ein <select>.
const ortsEditor = fs.readFileSync(path.join(wurzel, "html/wiki-sync-settlement-editor.html"), "utf8");
assert.ok(/<select id="dtEditType"/.test(ortsEditor), "Ortseditor: Typ ist kein <select> mehr -- Probe pruefen");
const index = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
assert.ok(/<select[^>]*id="location-edit-type"/.test(index), "Kartendialog: Typ ist kein <select> mehr");
assert.ok(/<select[^>]*id="path-edit-type"/.test(index), "Wegdialog: Typ ist kein <select> mehr");
assert.ok(/<select[^>]*id="label-edit-type"/.test(index), "Beschriftungsdialog: Art ist kein <select> mehr");
console.log("wiki-feld-leerbar: alle Zusicherungen erfuellt");
```

- [ ] **Step 3: Beide Tests laufen lassen, müssen rot sein**

Run: `node js/ui/__tests__/wiki-feld-herkunft.test.js; node js/ui/__tests__/wiki-feld-leerbar.test.js`
Expected: FAIL `von uns gesetzt + Wiki leer muss ein ↺ bekommen` bzw. `deepStrictEqual` bei `nichtLeerbar("ort")` (leeres Array).

- [ ] **Step 4: Rechner ändern.** In `js/ui/wiki-feld-herkunft.js` über `function avesmapsWikiFeldStand` einfügen:

```js
/** Was der durchgestrichene Wiki-Stand zeigt, wenn das Wiki dort nichts hat. */
const AVESMAPS_WIKI_FELD_LEER = "(leer)";
```

Im Schleifenrumpf die Zuweisung `stand[ziel] = { … };` ersetzen durch:

```js
		// 🔴 „WIKI LEER, VON UNS GESETZT" IST SEIT DEM 15.09.2026 EINE ABWEICHUNG (Entwurf
		// 2026-09-15-wiki-ort-override §0.3/§0.8) -- das ↺ leert dann das Feld. Zwei Riegel:
		//   · nur bei Herkunft "manual": ohne gespeicherte Herkunft leerte ein Klick fremde Handarbeit;
		//   · nie bei `leerbar: false` (Pflicht- und Auswahlfelder, Feldregister).
		const leerbar = !(feld && feld.leerbar === false);
		const wikiLeerVonUns = neu === "" && alt !== "" && woher === "manual" && leerbar;
		stand[ziel] = {
			wikiWert: neu,
			// Was der Editor LIEST -- bei der Ortsgroesse „Dorf" statt „dorf", bei leerem Wiki „(leer)".
			wikiAnzeige: neu === "" ? AVESMAPS_WIKI_FELD_LEER : avesmapsWikiFeldAnzeige(neu, ziel, beschriftungen),
			abweicht: (neu !== "" && alt !== neu) || wikiLeerVonUns,
			herkunft: woher,
		};
```

Den alten Kommentar `// ⚠️ Ein LEEREN Wiki-Wert ist keine Abweichung …` (drei Zeilen über `abweicht`) löschen. In `module.exports` `AVESMAPS_WIKI_FELD_LEER: AVESMAPS_WIKI_FELD_LEER,` ergänzen.

- [ ] **Step 5: Register ändern.** In `js/ui/wiki-assign-registry.js` diese zehn Zeilen um `, leerbar: false` vor der schliessenden Klammer ergänzen:

```js
			{ wiki: "wegtyp", karte: "feature_subtype", label: "Wegtyp", leerbar: false },
			{ wiki: "name", karte: "name", label: "Name", leerbar: false },                    // ort
			{ wiki: "ortsgroesse", karte: "feature_subtype", label: "Ortsgröße", leerbar: false },
			{ wiki: "name", karte: "name", label: "Name", leerbar: false },                    // landschaft
			{ wiki: "landschaftsart", karte: "region_type", label: "Landschaftsart", leerbar: false },
			{ wiki: "name", karte: "text", label: "Name", leerbar: false },                    // landschaftslabel
			{ wiki: "landschaftsart", karte: "feature_subtype", label: "Kategorie", leerbar: false },
			{ wiki: "title", karte: "title", label: "Titel", leerbar: false },
			{ wiki: "product_type", karte: "product_type", label: "Produkttyp", leerbar: false },
			{ wiki: "edition", karte: "edition", label: "Regelsystem", leerbar: false },
```

⚠️ Die `name`-Zeile des **Territoriums** (Zeile 419) bleibt ohne `leerbar` — das Territorium rechnet nicht über `avesmapsWikiFeldStand`. Die Kommentare `// ort` usw. oben stehen nur im Plan, nicht in der Datei.

- [ ] **Step 6: Beide Tests grün**

Run: `node js/ui/__tests__/wiki-feld-herkunft.test.js && node js/ui/__tests__/wiki-feld-leerbar.test.js && node js/ui/__tests__/wiki-assign-registry.test.js`
Expected: drei grüne Zeilen.

- [ ] **Step 7: Rücksetzer im Ortseditor AUSGEFÜHRT prüfen.** In `js/pages/__tests__/ort-wiki-override-form.test.js` vor der letzten `console.log`-Zeile anhängen:

```js
// ── 🔴 DAS ↺ LEERT, WENN DAS WIKI NICHTS HAT (Entwurf 2026-09-15 §0.3) ────────────────────────────
vm.runInContext("buildSettlementTypeSelectHtml = () => '<select id=\"dtEditType\"></select>';", kasten);
const LEER_DETAIL = { public_id: "L-1", name: "Leerdorf", feature_subtype: "dorf",
	properties: { oberhaupt: "Baronin X", field_origins: { oberhaupt: "manual" },
		wiki_settlement: { title: "Leerdorf", name: "Leerdorf", settlement_class: "dorf", settlement_class_guessed: false, oberhaupt: "" } } };
const leerHtml = vm.runInContext("buildSettlementEditFormHtml", kasten)(LEER_DETAIL).identity;
assert.ok(/data-wiki-reset="oberhaupt"/.test(leerHtml), "Herrscher (von uns, Wiki leer) hat kein ↺");
assert.ok(leerHtml.includes("(leer)"), "der durchgestrichene Wiki-Stand sagt nicht „(leer)“");
assert.ok(!/data-wiki-reset="name"/.test(leerHtml), "der Name bekam ein ↺, obwohl er gleich ist");
vm.runInContext("settlementDetailCache = { publicId: 'L-1', detail: " + JSON.stringify(LEER_DETAIL) + " }; settlementWikiUebernommenLeeren();", kasten);
kasten.document.getElementById("dtEditOberhaupt").value = "Baronin X";
vm.runInContext("settlementWikiFeldZuruecksetzen('oberhaupt')", kasten);
assert.strictEqual(kasten.document.getElementById("dtEditOberhaupt").value, "", "das ↺ hat das Feld nicht geleert");
assert.ok(vm.runInContext("settlementWikiUebernommen.has('oberhaupt')", kasten), "das ↺ hat die Übernahme nicht gemerkt");
```

Run: `node js/pages/__tests__/ort-wiki-override-form.test.js` — Expected: grün.

- [ ] **Step 8: Literatur-Rücksetzer AUSGEFÜHRT prüfen.** In `js/ui/__tests__/wiki-assign-literatur.test.js`, Abschnitt I, **nach** der Zusicherung `html/game-literature-editor.html bindet js/ui/wiki-feld-herkunft.js nicht` (und ihrem `zaehl();`) einfügen:

```js
	// 🔴 DAS ↺ LEERT AUCH HIER (Entwurf 2026-09-15 §0.8): der Rechner wird mit einem leeren Wiki-Stand
	// gefahren, der Ruecksetzer schreibt ihn wirklich ins Feld. Steht HINTER der Nutzlastprobe, weil
	// die die Merkliste auf ["genre"] festnagelt.
	const leerStand = vm.runInContext(
		"avesmapsWikiFeldStand((avesmapsWikiAssignSubject('literatur') || {}).felder, { isbn: '978-3' }, { isbn: '' }, { isbn: 'manual' })",
		kasten2.kasten);
	assert.strictEqual(leerStand.isbn.abweicht, true, "ISBN (von uns, Wiki leer) bekommt kein ↺");
	vm.runInContext("aeWikiStandCache.isbn = { wikiWert: '', wikiAnzeige: '(leer)', abweicht: true, herkunft: 'manual' }; aeWikiFeldZuruecksetzen('isbn')", kasten2.kasten);
	assert.strictEqual(kasten2.felder.isbn.value, "", "der Literatur-Ruecksetzer hat nicht geleert");
	zaehl(); zaehl();
```

⚠️ `aeWikiStandCache` ist in `html/game-literature-editor.html` (~958) ein Objekt auf oberster Ebene des Inline-Skripts; ist es dort `const` und wird ersetzt statt befüllt, statt der Zuweisung `aeWikiZeichneAbweichungen()` nach einem Setzen von `kasten2.felder.isbn.value = "978-3"` rufen und den Katalog-ISBN-Stand aus `KATALOG_KELCH` lesen. Die Zusicherung `felder.isbn.value === ""` bleibt.

Run: `node js/ui/__tests__/wiki-assign-literatur.test.js` — Expected: grün.

- [ ] **Step 9: Nachbarn fahren** — alle Tests, die die Override-Anzeige berühren:

Run: `for t in js/ui/__tests__/wiki-feld-herkunft-geladen.test.js js/pages/__tests__/landschaft-wiki-override-zeichner.test.js js/review/__tests__/label-wiki-override-kette.test.js js/ui/__tests__/wiki-uebernommen-alle-oberflaechen.test.js js/pages/__tests__/wiki-override-eine-quelle.test.js js/ui/__tests__/wiki-assign-ort.test.js js/ui/__tests__/wiki-assign-weg.test.js; do node "$t" >/dev/null || echo "ROT: $t"; done`
Expected: keine Ausgabe.

- [ ] **Step 10: Mutationsprobe** — `&& woher === "manual"` löschen → `wiki-feld-herkunft.test.js` rot („ohne gespeicherte Herkunft …") → zurück. `leerbar: false` an `ortsgroesse` entfernen → `wiki-feld-leerbar.test.js` rot → zurück.

- [ ] **Step 11: Ganzes Testfeld, Commit, Push, Owner-Blick**

Commit-Betreff: `ui(wiki-override): das ↺ leert ein von uns gesetztes Feld, wenn das Wiki dort nichts hat -- Ort und Literatur`

---

### Task 3a: Die Ablage und die reinen Funktionen (unsichtbar)

**Files:**
- Create: `api/_internal/wiki/settlement-wiki-override.php`
- Test: `api/_internal/wiki/__tests__/settlement-wiki-override-test.php`

**Interfaces:**
- Produces (alle in `settlement-wiki-override.php`, einzige Abhängigkeit `../ortsklassen.php`):
  - `avesmapsSettlementWikiOverrideEnsureSchema(PDO $pdo): void`
  - `avesmapsSettlementWikiOverrideAlle(PDO $pdo): array` → `[normalized_key => overrides-array]`, bei Fehler `[]`
  - `avesmapsSettlementWikiOverrideReadStamp(PDO $pdo): string` → `''` bei Fehler **oder leerer Tabelle**, sonst `"<n>|<max updated_at>"`
  - `avesmapsSettlementWikiOverrideSchreiben(PDO $pdo, string $key, string $title, array $overrides, int $userId): void` (leeres Array löscht die Zeile)
  - `avesmapsSettlementWikiOverrideBereinigen(array $alt, array $eingabe, array $wiki, array $siedlungen): array` (rein, wirft `RuntimeException`)
  - `avesmapsSettlementWikiOverrideZuruecknehmen(array $alt, array $felder): array` (rein)
  - `avesmapsSettlementWikiEffektiv(array $wiki, ?array $override, array $siedlungen): array` (rein)
  - `avesmapsSettlementWikiOverrideUebernahmePlan(array $override, array $karte, array $wiki): array{setzen: array, entfernen: list<string>}` (rein)
  - `avesmapsSettlementWikiOverrideSiedlungNamen(array $mapRows): array` → `[public_id => name]` (rein), `avesmapsSettlementWikiOverrideSiedlungNamenLaden(PDO $pdo): array`
  - `avesmapsSettlementWikiOverrideNachschlag(array $alle, callable $schluessel): callable` → `fn(string $titel): ?array`
- Form von `$wiki`: `['name' => string, 'settlement_class' => string, 'is_ruined' => bool, 'is_hidden' => bool, 'place_scope' => 'inside'|'outside'|'ambiguous', 'place_settlement' => string]`.
- Rückgabe von `…Effektiv`: `name, settlement_class, is_ruined, is_hidden, place_scope, place_settlement, place_settlement_public_id, innerorts_gilt (bool), place_settlement_verwaist (bool), override_felder (list<string>), wiki (= $wiki)`.

- [ ] **Step 1: Failing Test schreiben** — `api/_internal/wiki/__tests__/settlement-wiki-override-test.php`

```php
<?php
declare(strict_types=1);
// Die Override-Zeile je Wiki-Seite (Entwurf 2026-09-15-wiki-ort-override §2, §3, §5).
if (ini_get('zend.assertions') !== '1') { fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'\n"); exit(2); }
require __DIR__ . '/../settlement-wiki-override.php';

$wiki = ['name' => 'Ordenshaus bei Angbar', 'settlement_class' => 'gebaeude', 'is_ruined' => false, 'is_hidden' => false,
    'place_scope' => 'ambiguous', 'place_settlement' => 'Angbar'];
$siedlungen = ['P-ANGBAR' => 'Angbar', 'P-GARETH' => 'Gareth'];

// ── Effektiv: ohne Override gilt das Wiki ─────────────────────────────────────────────────────
$e = avesmapsSettlementWikiEffektiv($wiki, null, $siedlungen);
assert($e['name'] === 'Ordenshaus bei Angbar' && $e['place_scope'] === 'ambiguous' && $e['override_felder'] === []);
assert($e['innerorts_gilt'] === false, 'unklar ist nie innerorts');

// Override "outside": Stadt faellt weg.
$e = avesmapsSettlementWikiEffektiv($wiki, ['place_scope' => 'outside', 'name' => 'Ordenshaus'], $siedlungen);
assert($e['place_scope'] === 'outside' && $e['place_settlement'] === '' && $e['name'] === 'Ordenshaus');
assert($e['override_felder'] === ['name', 'place_scope']);

// Override "inside" mit public_id: der Name der Stadt kommt aus der KARTE, nicht aus dem Override.
$e = avesmapsSettlementWikiEffektiv($wiki, ['place_scope' => 'inside', 'place_settlement_public_id' => 'P-GARETH'], $siedlungen);
assert($e['place_scope'] === 'inside' && $e['place_settlement'] === 'Gareth' && $e['place_settlement_public_id'] === 'P-GARETH');
assert($e['innerorts_gilt'] === true);

// Verwaiste public_id: das Wiki-Urteil gilt GANZ, und die Liste erfaehrt es.
$e = avesmapsSettlementWikiEffektiv($wiki, ['place_scope' => 'inside', 'place_settlement_public_id' => 'P-WEG'], $siedlungen);
assert($e['place_scope'] === 'ambiguous' && $e['place_settlement'] === 'Angbar' && $e['place_settlement_verwaist'] === true);

// Wirksame Klasse ist keine Bauwerksklasse: innerorts gilt nicht.
$e = avesmapsSettlementWikiEffektiv($wiki, ['settlement_class' => 'dorf', 'place_scope' => 'inside', 'place_settlement_public_id' => 'P-GARETH'], $siedlungen);
assert($e['innerorts_gilt'] === false, 'ein Dorf liegt nicht in einer Stadt');

// ── Bereinigen: Wert gleich Wiki faellt weg, Ungueltiges wirft ────────────────────────────────
$o = avesmapsSettlementWikiOverrideBereinigen([], ['name' => '  Ordenshaus bei Angbar ', 'is_ruined' => true], $wiki, $siedlungen);
assert($o === ['is_ruined' => true], 'der Name gleich Wiki darf nicht stehen bleiben: ' . json_encode($o));
$o = avesmapsSettlementWikiOverrideBereinigen(['place_scope' => 'inside', 'place_settlement_public_id' => 'P-GARETH'], ['place_scope' => 'outside'], $wiki, $siedlungen);
assert($o === ['place_scope' => 'outside'], 'bei outside faellt die public_id weg');
$wikiInnen = ['place_scope' => 'inside', 'place_settlement' => 'Gareth'] + $wiki;
$o = avesmapsSettlementWikiOverrideBereinigen([], ['place_scope' => 'inside', 'place_settlement_public_id' => 'P-GARETH'], $wikiInnen, $siedlungen);
assert($o === [], 'inside + dieselbe Stadt wie das Wiki ist kein Override');
foreach ([['name' => '   '], ['settlement_class' => 'burg'], ['place_scope' => 'ambiguous'],
          ['place_scope' => 'inside'], ['place_scope' => 'inside', 'place_settlement_public_id' => 'P-WEG'], ['unbekannt' => 1]] as $falsch) {
    $geworfen = false;
    try { avesmapsSettlementWikiOverrideBereinigen([], $falsch, $wiki, $siedlungen); } catch (RuntimeException) { $geworfen = true; }
    assert($geworfen, 'muss werfen: ' . json_encode($falsch));
}
assert(avesmapsSettlementWikiOverrideZuruecknehmen(['place_scope' => 'inside', 'place_settlement_public_id' => 'P-GARETH', 'name' => 'X'], ['place_scope']) === ['name' => 'X'],
    'place_scope nimmt die public_id mit');

// ── Uebernahme beim Platzieren ────────────────────────────────────────────────────────────────
$plan = avesmapsSettlementWikiOverrideUebernahmePlan(
    ['name' => 'Ordenshaus', 'settlement_class' => 'stadtviertel', 'is_hidden' => true, 'place_scope' => 'outside'],
    ['name' => 'Ordenshaus bei Angbar', 'settlement_class' => 'gebaeude', 'is_ruined' => false, 'is_hidden' => false],
    $wiki);
assert($plan['setzen'] === ['name' => 'Ordenshaus', 'settlement_class' => 'stadtviertel', 'is_hidden' => true]);
assert($plan['entfernen'] === ['name', 'settlement_class', 'is_hidden'], 'place_scope bleibt an der Wiki-Seite');
$plan = avesmapsSettlementWikiOverrideUebernahmePlan(['name' => 'Ordenshaus'], ['name' => 'Von Hand', 'settlement_class' => 'gebaeude', 'is_ruined' => false, 'is_hidden' => false], $wiki);
assert($plan['setzen'] === [] && $plan['entfernen'] === ['name'], 'ein eigener Kartenwert gewinnt');

// ── Siedlungsnamen und Nachschlag ─────────────────────────────────────────────────────────────
$namen = avesmapsSettlementWikiOverrideSiedlungNamen([
    ['public_id' => 'P-1', 'feature_type' => 'location', 'feature_subtype' => 'stadt', 'name' => 'Gareth'],
    ['public_id' => 'P-2', 'feature_type' => 'location', 'feature_subtype' => 'gebaeude', 'name' => 'Burg'],
    ['public_id' => 'P-3', 'feature_type' => 'path', 'feature_subtype' => 'stadt', 'name' => 'Weg'],
]);
assert($namen === ['P-1' => 'Gareth'], 'nur Siedlungen, keine Bauwerke, keine Wege');
$nach = avesmapsSettlementWikiOverrideNachschlag(['akey' => ['name' => 'A']], static fn(string $t): string => strtolower(str_replace(' ', '', $t)));
assert($nach('A Key') === ['name' => 'A'] && $nach('Anderes') === null);

// ── Ablage gegen SQLite ───────────────────────────────────────────────────────────────────────
if (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    assert(avesmapsSettlementWikiOverrideAlle($pdo) === [] && avesmapsSettlementWikiOverrideReadStamp($pdo) === '', 'ohne Tabelle: leer und leerer Stempel');
    $pdo->exec('CREATE TABLE settlement_wiki_override (id INTEGER PRIMARY KEY AUTOINCREMENT, normalized_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL, overrides_json TEXT NOT NULL, updated_by INTEGER NULL, updated_at TEXT NOT NULL)');
    assert(avesmapsSettlementWikiOverrideReadStamp($pdo) === '', 'leere Tabelle: leerer Stempel (kein Neuladen fuer alle)');
    avesmapsSettlementWikiOverrideSchreiben($pdo, 'k1', 'Titel 1', ['name' => 'X'], 7);
    avesmapsSettlementWikiOverrideSchreiben($pdo, 'k1', 'Titel 1', ['name' => 'Y', 'is_hidden' => true], 7);
    assert(avesmapsSettlementWikiOverrideAlle($pdo) === ['k1' => ['name' => 'Y', 'is_hidden' => true]], 'zweites Schreiben ersetzt, verdoppelt nicht');
    assert(str_starts_with(avesmapsSettlementWikiOverrideReadStamp($pdo), '1|'));
    avesmapsSettlementWikiOverrideSchreiben($pdo, 'k1', 'Titel 1', [], 7);
    assert(avesmapsSettlementWikiOverrideAlle($pdo) === [], 'leeres Objekt loescht die Zeile');
    echo "ablage ok\n";
} else {
    echo "ablage UEBERSPRUNGEN (kein pdo_sqlite)\n";
}
echo "settlement-wiki-override: alle Zusicherungen erfuellt\n";
```

- [ ] **Step 2: Laufen lassen, muss rot sein**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/settlement-wiki-override-test.php`
Expected: FAIL (`require` findet die Datei nicht).

- [ ] **Step 3: Datei anlegen** — `api/_internal/wiki/settlement-wiki-override.php`

```php
<?php

declare(strict_types=1);

/**
 * Eigene Angaben zu einer Wiki-Seite, die (noch) keine Kartenzeile hat -- und das Innerorts-Urteil.
 * ===========================================================================
 * Entwurf: docs/superpowers/specs/2026-09-15-wiki-ort-override-design.md
 *
 * 🔴 EINE ZEILE JE WIKI-SEITE, Schluessel `normalized_key` = avesmapsWikiSyncCreateMatchKey(title).
 * Dasselbe Muster wie `metadata_overrides_json` beim Territorium. Wert gleich Wiki -> der Schluessel
 * faellt weg; leeres Objekt -> die Zeile faellt weg.
 *
 * 💣 KEIN require auf sync.php: die Kartensuche (in-settlement-search.php) laedt es nicht, und ein
 * Test stubbt avesmapsWikiSyncCreateMatchKey. Den Schluessel reichen die Aufrufer als callable herein.
 * 💣 KEIN ON DUPLICATE KEY: lesen, dann UPDATE/INSERT/DELETE -- laeuft auf MySQL und SQLite gleich.
 * ⚠️ DDL nur im Schreibweg (avesmapsSettlementWikiOverrideEnsureSchema), nie in einer Transaktion.
 */

require_once __DIR__ . '/../ortsklassen.php';

const AVESMAPS_SETTLEMENT_WIKI_OVERRIDE_FELDER = ['name', 'settlement_class', 'is_ruined', 'is_hidden', 'place_scope', 'place_settlement_public_id'];

/** Die Felder, die beim Platzieren in die Kartenzeile wandern (Entwurf §5). */
const AVESMAPS_SETTLEMENT_WIKI_OVERRIDE_WANDERT = ['name', 'settlement_class', 'is_ruined', 'is_hidden'];

function avesmapsSettlementWikiOverrideEnsureSchema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS settlement_wiki_override (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            normalized_key VARCHAR(255) NOT NULL,
            title VARCHAR(255) NOT NULL,
            overrides_json TEXT NOT NULL,
            updated_by INT NULL,
            updated_at DATETIME(3) NOT NULL,
            UNIQUE KEY uq_settlement_wiki_override (normalized_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

/** @return array<string, array<string, mixed>> */
function avesmapsSettlementWikiOverrideAlle(PDO $pdo): array
{
    try {
        $rows = $pdo->query('SELECT normalized_key, overrides_json FROM settlement_wiki_override')->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return []; // Ohne Tabelle gibt es keine Overrides -- die Karte darf daran nie ausfallen.
    }
    $alle = [];
    foreach ((array) $rows as $row) {
        $werte = json_decode((string) ($row['overrides_json'] ?? ''), true);
        if (is_array($werte) && $werte !== []) {
            $alle[(string) $row['normalized_key']] = $werte;
        }
    }
    return $alle;
}

/**
 * 💣 OHNE IHN SIEHT NIEMAND EINEN OVERRIDE in der Staetten-Zeile -- er bewegt kein Kartenobjekt.
 * ⚠️ LEER bei leerer Tabelle, nicht „0|": sonst laede nach dem Deploy jeder Besucher die Karte neu.
 */
function avesmapsSettlementWikiOverrideReadStamp(PDO $pdo): string
{
    try {
        $row = $pdo->query('SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM settlement_wiki_override')->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return '';
    }
    if (!is_array($row) || (int) ($row['n'] ?? 0) === 0) {
        return '';
    }
    return (string) $row['n'] . '|' . (string) ($row['t'] ?? '');
}

function avesmapsSettlementWikiOverrideSchreiben(PDO $pdo, string $key, string $title, array $overrides, int $userId): void
{
    $key = trim($key);
    if ($key === '') {
        throw new RuntimeException('Die Wiki-Seite hat keinen Schluessel.');
    }
    $vorhanden = $pdo->prepare('SELECT id FROM settlement_wiki_override WHERE normalized_key = :k');
    $vorhanden->execute(['k' => $key]);
    $id = $vorhanden->fetchColumn();
    if ($overrides === []) {
        if ($id !== false) {
            $pdo->prepare('DELETE FROM settlement_wiki_override WHERE id = :id')->execute(['id' => (int) $id]);
        }
        return;
    }
    $werte = [
        'json' => json_encode($overrides, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        'user' => $userId > 0 ? $userId : null,
        'zeit' => (new DateTimeImmutable())->format('Y-m-d H:i:s.v'),
    ];
    if ($id !== false) {
        $pdo->prepare('UPDATE settlement_wiki_override SET overrides_json = :json, updated_by = :user, updated_at = :zeit, title = :title WHERE id = :id')
            ->execute($werte + ['title' => mb_substr($title, 0, 255), 'id' => (int) $id]);
        return;
    }
    $pdo->prepare('INSERT INTO settlement_wiki_override (normalized_key, title, overrides_json, updated_by, updated_at) VALUES (:k, :title, :json, :user, :zeit)')
        ->execute($werte + ['k' => $key, 'title' => mb_substr($title, 0, 255)]);
}

/**
 * REIN: Eingabe in den bestehenden Override einarbeiten. Wert gleich Wiki -> Schluessel faellt weg.
 * @param array<string,string> $siedlungen [public_id => Name] der platzierten Siedlungen
 */
function avesmapsSettlementWikiOverrideBereinigen(array $alt, array $eingabe, array $wiki, array $siedlungen): array
{
    $neu = $alt;
    foreach ($eingabe as $feld => $wert) {
        $feld = (string) $feld;
        if (!in_array($feld, AVESMAPS_SETTLEMENT_WIKI_OVERRIDE_FELDER, true)) {
            throw new RuntimeException('Feld „' . $feld . '" ist nicht ueberschreibbar.');
        }
        switch ($feld) {
            case 'name':
                $wert = trim((string) $wert);
                if ($wert === '' || mb_strlen($wert) > 160) {
                    throw new RuntimeException('Der Name darf nicht leer und hoechstens 160 Zeichen lang sein.');
                }
                break;
            case 'settlement_class':
                $wert = trim((string) $wert);
                if (!in_array($wert, AVESMAPS_ORTSKLASSEN, true)) {
                    throw new RuntimeException('Unbekannter Typ: ' . $wert);
                }
                break;
            case 'is_ruined':
            case 'is_hidden':
                $wert = (bool) $wert;
                break;
            case 'place_scope':
                $wert = (string) $wert;
                if (!in_array($wert, ['inside', 'outside'], true)) {
                    throw new RuntimeException('Innerorts kennt nur „innerorts" oder „außerorts".');
                }
                break;
            case 'place_settlement_public_id':
                $wert = trim((string) $wert);
                break;
        }
        $neu[$feld] = $wert;
    }

    // Stadt nur bei innerorts, und dann Pflicht und auf der Karte.
    if (($neu['place_scope'] ?? '') !== 'inside') {
        unset($neu['place_settlement_public_id']);
    } elseif (!isset($siedlungen[(string) ($neu['place_settlement_public_id'] ?? '')])) {
        throw new RuntimeException('„Gehört zu" braucht eine Siedlung, die auf der Karte liegt.');
    }

    // Wert gleich Wiki faellt weg.
    foreach (['name', 'settlement_class', 'is_ruined', 'is_hidden'] as $feld) {
        if (array_key_exists($feld, $neu) && $neu[$feld] === ($wiki[$feld] ?? ($feld === 'is_hidden' || $feld === 'is_ruined' ? false : ''))) {
            unset($neu[$feld]);
        }
    }
    if (isset($neu['place_scope'])) {
        $gleicheStadt = $neu['place_scope'] === 'inside'
            && ($wiki['place_scope'] ?? '') === 'inside'
            && mb_strtolower($siedlungen[$neu['place_settlement_public_id']] ?? '') === mb_strtolower((string) ($wiki['place_settlement'] ?? ''));
        if ($gleicheStadt || ($neu['place_scope'] === 'outside' && ($wiki['place_scope'] ?? '') === 'outside')) {
            unset($neu['place_scope'], $neu['place_settlement_public_id']);
        }
    }
    ksort($neu);
    return $neu;
}

/** REIN: Felder zuruecknehmen. `place_scope` nimmt seine Stadt immer mit. */
function avesmapsSettlementWikiOverrideZuruecknehmen(array $alt, array $felder): array
{
    foreach ($felder as $feld) {
        unset($alt[(string) $feld]);
        if ($feld === 'place_scope') {
            unset($alt['place_settlement_public_id']);
        }
    }
    return $alt;
}

/**
 * REIN: der wirksame Stand einer Wiki-Seite -- der EINE Eingang aller Leser (Entwurf §3).
 * @param array<string,string> $siedlungen [public_id => Name] der platzierten Siedlungen
 */
function avesmapsSettlementWikiEffektiv(array $wiki, ?array $override, array $siedlungen): array
{
    $o = $override ?? [];
    $felder = array_values(array_intersect(array_keys($o), AVESMAPS_SETTLEMENT_WIKI_OVERRIDE_FELDER));
    sort($felder);
    $e = [
        'name' => (string) ($o['name'] ?? ($wiki['name'] ?? '')),
        'settlement_class' => (string) ($o['settlement_class'] ?? ($wiki['settlement_class'] ?? '')),
        'is_ruined' => (bool) ($o['is_ruined'] ?? ($wiki['is_ruined'] ?? false)),
        'is_hidden' => (bool) ($o['is_hidden'] ?? ($wiki['is_hidden'] ?? false)),
        'place_scope' => (string) ($wiki['place_scope'] ?? 'outside'),
        'place_settlement' => (string) ($wiki['place_settlement'] ?? ''),
        'place_settlement_public_id' => '',
        'place_settlement_verwaist' => false,
        'override_felder' => $felder,
        'wiki' => $wiki,
    ];
    if (($o['place_scope'] ?? '') === 'outside') {
        $e['place_scope'] = 'outside';
        $e['place_settlement'] = '';
    } elseif (($o['place_scope'] ?? '') === 'inside') {
        $pid = (string) ($o['place_settlement_public_id'] ?? '');
        if (isset($siedlungen[$pid])) {
            $e['place_scope'] = 'inside';
            $e['place_settlement'] = $siedlungen[$pid];
            $e['place_settlement_public_id'] = $pid;
        } else {
            // 🔴 Die Stadt gibt es nicht mehr: das Wiki-Urteil gilt GANZ, und die Liste meldet es.
            $e['place_settlement_verwaist'] = true;
        }
    }
    $e['innerorts_gilt'] = $e['place_scope'] === 'inside' && $e['place_settlement'] !== ''
        && avesmapsIstBauwerksklasse($e['settlement_class']);
    return $e;
}

/**
 * REIN: was beim Platzieren in die Kartenzeile wandert (Entwurf §5).
 * Text: nur wenn die Kartenzeile noch den Wiki-Wert (oder nichts) traegt. Haken: nur wenn sie `false` traegt.
 * `entfernen` nennt jedes der vier Felder, das im Override stand -- uebernommen oder nicht.
 */
function avesmapsSettlementWikiOverrideUebernahmePlan(array $override, array $karte, array $wiki): array
{
    $setzen = [];
    $entfernen = [];
    foreach (AVESMAPS_SETTLEMENT_WIKI_OVERRIDE_WANDERT as $feld) {
        if (!array_key_exists($feld, $override)) {
            continue;
        }
        $entfernen[] = $feld;
        if ($feld === 'is_ruined' || $feld === 'is_hidden') {
            if (($karte[$feld] ?? false) === false) {
                $setzen[$feld] = (bool) $override[$feld];
            }
            continue;
        }
        $kartenwert = trim((string) ($karte[$feld] ?? ''));
        if ($kartenwert === '' || $kartenwert === trim((string) ($wiki[$feld] ?? ''))) {
            $setzen[$feld] = (string) $override[$feld];
        }
    }
    return ['setzen' => $setzen, 'entfernen' => $entfernen];
}

/** REIN: [public_id => Name] der platzierten SIEDLUNGEN (keine Bauwerke, keine Wege). */
function avesmapsSettlementWikiOverrideSiedlungNamen(array $mapRows): array
{
    $namen = [];
    foreach ($mapRows as $row) {
        $sub = (string) ($row['feature_subtype'] ?? '');
        if ((string) ($row['feature_type'] ?? '') !== 'location' || !in_array($sub, AVESMAPS_ORTSKLASSEN, true) || avesmapsIstBauwerksklasse($sub)) {
            continue;
        }
        $pid = (string) ($row['public_id'] ?? '');
        if ($pid !== '') {
            $namen[$pid] = (string) ($row['name'] ?? '');
        }
    }
    return $namen;
}

function avesmapsSettlementWikiOverrideSiedlungNamenLaden(PDO $pdo): array
{
    try {
        $rows = $pdo->query("SELECT public_id, feature_type, feature_subtype, name FROM map_features WHERE feature_type = 'location' AND is_active = 1")
            ->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException) {
        return [];
    }
    return avesmapsSettlementWikiOverrideSiedlungNamen((array) $rows);
}

/** REIN: Nachschlag je Titel -- der Schluessel kommt vom Aufrufer (kein sync.php hier). */
function avesmapsSettlementWikiOverrideNachschlag(array $alle, callable $schluessel): callable
{
    return static function (string $titel) use ($alle, $schluessel): ?array {
        $key = (string) $schluessel($titel);
        return $key !== '' && isset($alle[$key]) ? $alle[$key] : null;
    };
}
```

- [ ] **Step 4: Test grün**

Run: wie Step 2. Expected: `ablage ok` und `settlement-wiki-override: alle Zusicherungen erfuellt`

- [ ] **Step 5: Mutationsprobe** — in `…Effektiv` den `else`-Zweig (verwaist) so ändern, dass `$e['place_scope'] = 'inside';` gesetzt wird → Test rot → zurück. In `…Bereinigen` `unset($neu[$feld]);` im „Wert gleich Wiki"-Block auskommentieren → rot → zurück.

- [ ] **Step 6: Commit (noch kein Push — unsichtbar, geht mit Task 3b/3c)**

Commit-Betreff: `feat(orte): Override-Ablage je Wiki-Seite -- und der eine Eingang fuer das Innerorts-Urteil`

---

### Task 3b: Suche, Stätten-Zeile, „nicht auf der Karte" und der Karten-Stempel (unsichtbar)

**Files:**
- Modify: `api/_internal/wiki/settlement-wiki-override.php` (Loader für verborgene platzierte Bauwerke)
- Modify: `api/_internal/app/in-settlement-search.php` (require; `quelle` an Bauwerkszeilen; zwei Bauer)
- Modify: `api/_internal/app/offmap-search.php` (`avesmapsBuildOffmapSearchEntries`)
- Modify: `api/app/map-search.php` (~381-454), `api/app/map-features.php` (`avesmapsMapFeaturesInSettlementPlaces` ~206-238, ETag-Zeile ~323)
- Test: `api/_internal/app/__tests__/innerorts-override-leser-test.php` (neu)

**Interfaces:**
- Consumes: Task 3a (`avesmapsSettlementWikiEffektiv`, `…Nachschlag`, `…SiedlungNamen`, `…SiedlungNamenLaden`, `…Alle`, `…ReadStamp`).
- Produces:
  - Bauwerkszeilen aus `avesmapsFetchInSettlementSearchRows` tragen `'quelle' => 'bauwerk'`; die übrigen Quellen tragen keinen Schlüssel.
  - `avesmapsBuildInSettlementPlaceList(array $registryRows, array $scopeIndex, array $storedPlaces = [], ?callable $overrideFuer = null, array $siedlungen = [], array $verborgeneTitel = []): array`
  - `avesmapsBuildInSettlementSearchEntries(array $registryRows, array $settlementIndex, array $scopeIndex, ?callable $overrideFuer = null, array $siedlungen = []): array`
  - `avesmapsBuildOffmapSearchEntries(array $rows, array $targetIndex, array $scopeIndex, array $presenceIndex, ?callable $overrideFuer = null, array $siedlungen = []): array`
  - `avesmapsSettlementWikiVerborgeneTitelLaden(PDO $pdo): array` → `[Artikeltitel => true]`

- [ ] **Step 1: Failing Test schreiben** — `api/_internal/app/__tests__/innerorts-override-leser-test.php`

```php
<?php
declare(strict_types=1);
// Jeder Leser des Innerorts-Urteils folgt dem Override -- AUSGEFUEHRT (Entwurf 2026-09-15 §3).
if (ini_get('zend.assertions') !== '1') { fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'\n"); exit(2); }
require __DIR__ . '/../in-settlement-search.php';
require __DIR__ . '/../offmap-search.php';

$scopeIndex = ['settlements' => avesmapsPlaceScopeBuildNameSet(['Gareth', 'Angbar']), 'regions' => avesmapsPlaceScopeBuildNameSet([])];
$registry = [
    ['title' => 'Akademie Schwert und Stab', 'raw' => '[[Gareth]]', 'type_label' => 'Magierakademie', 'deity' => '', 'wiki_url' => '', 'quelle' => 'bauwerk'],
    ['title' => 'Ordenshaus', 'raw' => '[[Angbar]]', 'type_label' => 'Tempel', 'deity' => '', 'wiki_url' => '', 'quelle' => 'bauwerk'],
    ['title' => 'Handelshaus Stoerrebrandt', 'raw' => '[[Gareth]]', 'type_label' => 'Handelshaus', 'deity' => '', 'wiki_url' => ''],
];
$schluessel = static fn(string $t): string => strtolower((string) preg_replace('/[^a-z]/i', '', $t));
$siedlungen = ['P-G' => 'Gareth', 'P-A' => 'Angbar'];
$namen = static fn(array $liste): array => array_map(static fn(array $p): string => $p['name'] . '@' . $p['settlement'], $liste);

// ── Staetten-Zeile ────────────────────────────────────────────────────────────────────────────
$ohne = $namen(avesmapsBuildInSettlementPlaceList($registry, $scopeIndex));
assert($ohne === ['Akademie Schwert und Stab@Gareth', 'Ordenshaus@Angbar', 'Handelshaus Stoerrebrandt@Gareth'], 'ohne Override: ' . json_encode($ohne));

$overrides = [
    'akademieschwertundstab' => ['name' => 'Akademie S&S', 'is_hidden' => true],
    'ordenshaus' => ['place_scope' => 'outside'],
    'handelshausstoerrebrandt' => ['place_scope' => 'outside'],   // gehoert keiner Wiki-Seite: wird ignoriert
];
$nach = avesmapsSettlementWikiOverrideNachschlag($overrides, $schluessel);
$mit = $namen(avesmapsBuildInSettlementPlaceList($registry, $scopeIndex, [], $nach, $siedlungen));
assert($mit === ['Handelshaus Stoerrebrandt@Gareth'], 'verborgen fehlt, outside fehlt, fremde Quelle bleibt: ' . json_encode($mit));

$umzug = avesmapsSettlementWikiOverrideNachschlag(['ordenshaus' => ['place_scope' => 'inside', 'place_settlement_public_id' => 'P-G', 'name' => 'Ordenshaus Rohal']], $schluessel);
$um = $namen(avesmapsBuildInSettlementPlaceList($registry, $scopeIndex, [], $umzug, $siedlungen));
assert(in_array('Ordenshaus Rohal@Gareth', $um, true), 'Gehört zu + Name wirken: ' . json_encode($um));

$verborgen = $namen(avesmapsBuildInSettlementPlaceList($registry, $scopeIndex, [], null, [], ['Ordenshaus' => true]));
assert(!in_array('Ordenshaus@Angbar', $verborgen, true), 'ein verborgenes PLATZIERTES Bauwerk fehlt (Entscheid 9)');

// ── Kartensuche „X in Stadt" ──────────────────────────────────────────────────────────────────
$mapRows = [
    ['public_id' => 'P-G', 'feature_type' => 'location', 'feature_subtype' => 'stadt', 'name' => 'Gareth', 'min_x' => 1.0, 'min_y' => 1.0, 'max_x' => 2.0, 'max_y' => 2.0],
    ['public_id' => 'P-A', 'feature_type' => 'location', 'feature_subtype' => 'stadt', 'name' => 'Angbar', 'min_x' => 3.0, 'min_y' => 3.0, 'max_x' => 4.0, 'max_y' => 4.0],
];
$index = avesmapsBuildSettlementLocationIndex($mapRows);
$treffer = avesmapsBuildInSettlementSearchEntries($registry, $index, $scopeIndex, $nach, $siedlungen);
$titel = array_column($treffer, 'name');
assert(in_array('Akademie S&S', $titel, true), 'verborgen bleibt in der Suche (Entscheid 4): ' . json_encode($titel));
assert(!in_array('Ordenshaus', $titel, true), 'außerorts ist kein Innerorts-Treffer');
$akademie = $treffer[array_search('Akademie S&S', $titel, true)];
assert(in_array('Akademie Schwert und Stab', $akademie['search_texts'], true), 'der Wiki-Titel bleibt suchbar');
$umTreffer = avesmapsBuildInSettlementSearchEntries($registry, $index, $scopeIndex, $umzug, $siedlungen);
$rohal = array_values(array_filter($umTreffer, static fn(array $t): bool => $t['name'] === 'Ordenshaus Rohal'));
assert(count($rohal) === 1 && $rohal[0]['settlement_public_id'] === 'P-G' && str_ends_with($rohal[0]['type_label'], ' in Gareth'), 'springt nach Gareth');

// ── Suche „nicht auf der Karte" ───────────────────────────────────────────────────────────────
$offmapRows = [
    ['title' => 'Ordenshaus', 'type_label' => 'Tempel', 'place_raw' => '[[Angbar]]', 'wiki_url' => '', 'kind' => 'building'],
    ['title' => 'Akademie Schwert und Stab', 'type_label' => 'Magierakademie', 'place_raw' => '[[Gareth]]', 'wiki_url' => '', 'kind' => 'building'],
];
assert(avesmapsBuildOffmapSearchEntries($offmapRows, [], $scopeIndex, []) === [], 'ohne Override: beide innerorts, beide raus');
$off = array_column(avesmapsBuildOffmapSearchEntries($offmapRows, [], $scopeIndex, [], $nach, $siedlungen), 'name');
assert($off === ['Ordenshaus'], 'außerorts gesetzt -> erscheint hier: ' . json_encode($off));

// ── Verborgene platzierte Bauwerke aus der Datenbank ─────────────────────────────────────────
if (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    assert(avesmapsSettlementWikiVerborgeneTitelLaden($pdo) === [], 'ohne Tabelle: leer');
    $pdo->exec('CREATE TABLE map_features (public_id TEXT, feature_type TEXT, is_active INTEGER, properties_json TEXT)');
    $pdo->exec("INSERT INTO map_features VALUES ('a','location',1,'{\"is_hidden\":true,\"wiki_settlement\":{\"title\":\"Ordenshaus\"}}')");
    $pdo->exec("INSERT INTO map_features VALUES ('b','location',1,'{\"is_hidden\":false,\"wiki_settlement\":{\"title\":\"Akademie\"}}')");
    $pdo->exec("INSERT INTO map_features VALUES ('c','location',0,'{\"is_hidden\":true,\"wiki_settlement\":{\"title\":\"Geloescht\"}}')");
    assert(avesmapsSettlementWikiVerborgeneTitelLaden($pdo) === ['Ordenshaus' => true]);
    echo "verborgene ok\n";
}
echo "innerorts-override-leser: alle Zusicherungen erfuellt\n";
```

- [ ] **Step 2: Laufen lassen, muss rot sein**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/innerorts-override-leser-test.php`
Expected: FAIL (`Call to undefined function avesmapsSettlementWikiOverrideNachschlag`)

- [ ] **Step 3: Loader für verborgene platzierte Bauwerke** — ans Ende von `api/_internal/wiki/settlement-wiki-override.php`:

```php
/**
 * Titel der zugewiesenen Artikel aller VERBORGENEN platzierten Orte (Entscheid 9).
 * 💣 Eine eigene schmale Abfrage, nicht die Zeilen der Kartennutzlast: eine Anfrage mit `bbox` laedt
 * dort nur einen Ausschnitt. `"is_hidden":true` steht so im JSON, weil beide Schreiber
 * (avesmapsEncodeJson, avesmapsWikiSyncEncodeJson) ohne Leerzeichen kodieren; die Zeile wird danach
 * trotzdem dekodiert und geprueft.
 * @return array<string, true>
 */
function avesmapsSettlementWikiVerborgeneTitelLaden(PDO $pdo): array
{
    try {
        $statement = $pdo->query(
            "SELECT properties_json FROM map_features
              WHERE feature_type = 'location' AND is_active = 1 AND properties_json LIKE '%\"is_hidden\":true%'"
        );
        $rows = $statement !== false ? $statement->fetchAll(PDO::FETCH_COLUMN) : [];
    } catch (PDOException) {
        return [];
    }
    $titel = [];
    foreach ((array) $rows as $json) {
        $props = json_decode((string) $json, true);
        $t = is_array($props) && ($props['is_hidden'] ?? false) === true ? trim((string) ($props['wiki_settlement']['title'] ?? '')) : '';
        if ($t !== '') {
            $titel[$t] = true;
        }
    }
    return $titel;
}
```

- [ ] **Step 4: `in-settlement-search.php` ändern.**

(a) Unter `require_once __DIR__ . '/../wiki/stadtteil-weiterleitung.php';` ergänzen:

```php
// Die Override-Zeile je Wiki-Seite und der eine Eingang fuer das Innerorts-Urteil (Entwurf 2026-09-15 §3).
require_once __DIR__ . '/../wiki/settlement-wiki-override.php';
```

(b) In der Bauwerks-Schleife von `avesmapsFetchInSettlementSearchRows` an das Zeilen-Array `'wiki_url' => (string) ($row['wiki_url'] ?? ''),` anhängen:

```php
                // 🔴 Nur diese Quelle ist eine Wiki-SEITE mit Override-Zeile. Wege, Sitze und
                // Stadtteilweiterleitungen tragen den Schluessel nicht und bleiben unberuehrt.
                'quelle' => 'bauwerk',
```

(c) `avesmapsBuildInSettlementPlaceList` ersetzen durch:

```php
function avesmapsBuildInSettlementPlaceList(array $registryRows, array $scopeIndex, array $storedPlaces = [],
    ?callable $overrideFuer = null, array $siedlungen = [], array $verborgeneTitel = []): array
{
    $places = [];
    $seen = [];

    foreach ($storedPlaces as $storedPlace) {
        $name = trim((string) ($storedPlace['name'] ?? ''));
        $settlement = trim((string) ($storedPlace['settlement'] ?? ''));
        if ($name === '' || $settlement === '' || isset($seen[$name])) {
            continue;
        }
        $seen[$name] = true;
        $places[] = ['name' => $name, 'settlement' => $settlement,
            'type' => (string) ($storedPlace['type'] ?? ''), 'wiki_url' => (string) ($storedPlace['wiki_url'] ?? '')];
    }

    foreach ($registryRows as $registryRow) {
        $title = trim((string) ($registryRow['title'] ?? ''));
        // 🔴 $seen bleibt am TITEL: ein Name-Override ist nur Anzeige (Entwurf §3, Regel 4).
        if ($title === '' || isset($seen[$title]) || isset($verborgeneTitel[$title])) {
            continue;
        }
        $wirksam = avesmapsInSettlementWirksam($registryRow, $title, $scopeIndex, $overrideFuer, $siedlungen);
        if ($wirksam === null || $wirksam['is_hidden']) {
            continue; // 🔴 Entscheid 4: eine verborgene Staette fehlt in der Zeile „Staetten".
        }
        $seen[$title] = true;
        $places[] = ['name' => $wirksam['name'], 'settlement' => $wirksam['place_settlement'],
            'type' => (string) ($registryRow['type_label'] ?? ''), 'wiki_url' => (string) ($registryRow['wiki_url'] ?? '')];
    }

    return $places;
}

/**
 * REIN: Innerorts-Stand einer Registerzeile -- Wiki-Urteil, bei Bauwerken mit Override durch den EINEN
 * Eingang. `null` heisst: liegt nicht (eindeutig) in einer Stadt.
 */
function avesmapsInSettlementWirksam(array $registryRow, string $title, array $scopeIndex, ?callable $overrideFuer, array $siedlungen): ?array
{
    $scope = avesmapsPlaceScopeClassifyWithIndex((string) ($registryRow['raw'] ?? ''), $scopeIndex);
    $override = ($overrideFuer !== null && ($registryRow['quelle'] ?? '') === 'bauwerk') ? $overrideFuer($title) : null;
    $wirksam = avesmapsSettlementWikiEffektiv(
        ['name' => $title, 'settlement_class' => 'gebaeude', 'is_ruined' => false, 'is_hidden' => false,
            'place_scope' => $scope['scope'], 'place_settlement' => $scope['settlement']],
        $override,
        $siedlungen
    );
    return $wirksam['innerorts_gilt'] ? $wirksam : null;
}
```

⚠️ `'settlement_class' => 'gebaeude'` ist hier der Wiki-Stand jeder Zeile dieser Quelle — die SQL-Abfrage liefert ausschliesslich Bauwerksklassen (`avesmapsBauwerksklassenSql`), und für `innerorts_gilt` sind `gebaeude` und `stadtviertel` gleichwertig. Ein Typ-Override auf eine Siedlungsklasse nimmt die Zeile heraus.

(d) In `avesmapsBuildInSettlementSearchEntries` die Signatur um `?callable $overrideFuer = null, array $siedlungen = []` erweitern und die Zeilen

```php
        $scope = avesmapsPlaceScopeClassifyWithIndex((string) ($registryRow['raw'] ?? ''), $scopeIndex);
        if ($scope['scope'] !== AVESMAPS_PLACE_SCOPE_INSIDE || $scope['settlement'] === '') {
            continue;
        }

        $settlement = $settlementIndex[avesmapsPlaceScopeFoldName($scope['settlement'])] ?? null;
```

ersetzen durch:

```php
        $wirksam = avesmapsInSettlementWirksam($registryRow, $title, $scopeIndex, $overrideFuer, $siedlungen);
        if ($wirksam === null) {
            continue;
        }
        // 🔴 Verborgen bleibt in der SUCHE (Entscheid 4) -- wer den Namen kennt, findet ihn.
        $scope = ['settlement' => $wirksam['place_settlement']];

        $settlement = $settlementIndex[avesmapsPlaceScopeFoldName($scope['settlement'])] ?? null;
```

Im `$entries[] = [ … ]` `'name' => $title,` ersetzen durch `'name' => $wirksam['name'],` und `'search_texts' => array_merge([$title], $deities),` durch `'search_texts' => array_values(array_unique(array_merge([$wirksam['name'], $title], $deities))),`.

- [ ] **Step 5: `offmap-search.php` ändern.** Signatur um `?callable $overrideFuer = null, array $siedlungen = []` erweitern. Den Block

```php
        if ($scopeIndex !== []
            && avesmapsPlaceScopeClassifyWithIndex($placeRaw, $scopeIndex)['scope'] === AVESMAPS_PLACE_SCOPE_INSIDE
        ) {
            continue;
        }
```

ersetzen durch:

```php
        $anzeigeName = $title;
        $override = ($overrideFuer !== null && (string) ($row['kind'] ?? '') === 'building') ? $overrideFuer($title) : null;
        if ($override !== null && $scopeIndex !== []) {
            $scope = avesmapsPlaceScopeClassifyWithIndex($placeRaw, $scopeIndex);
            $wirksam = avesmapsSettlementWikiEffektiv(['name' => $title, 'settlement_class' => 'gebaeude', 'is_ruined' => false,
                'is_hidden' => false, 'place_scope' => $scope['scope'], 'place_settlement' => $scope['settlement']], $override, $siedlungen);
            if ($wirksam['innerorts_gilt']) {
                continue; // gehoert der Innerorts-Quelle
            }
            $anzeigeName = $wirksam['name'];
        } elseif ($scopeIndex !== []
            && avesmapsPlaceScopeClassifyWithIndex($placeRaw, $scopeIndex)['scope'] === AVESMAPS_PLACE_SCOPE_INSIDE
        ) {
            continue;
        }
```

Im `$entries[] = [ … ]` `'name' => $title,` → `'name' => $anzeigeName,` und `'search_texts' => array_values(array_filter([$title, $placeName, $typeLabel])),` → `'search_texts' => array_values(array_unique(array_filter([$anzeigeName, $title, $placeName, $typeLabel]))),`. `offmap-search.php` lädt `settlement-wiki-override.php` per `require_once __DIR__ . '/../wiki/settlement-wiki-override.php';` unter seinen bestehenden `require_once`.

- [ ] **Step 6: `map-search.php` verdrahten.** In `avesmapsBuildMapSearchResults` direkt nach `$scopeIndex = $pdo !== null ? avesmapsPlaceScopeLoadIndex($pdo, $rows) : [];` einfügen:

```php
    // Die Overrides der Wiki-Seiten (Entwurf 2026-09-15 §3). EINE Abfrage, nie je Zeile; ohne Zeilen
    // bleibt alles beim Wiki-Urteil und die Siedlungsnamen werden gar nicht erst gebaut.
    $overrideFuer = null;
    $overrideSiedlungen = [];
    if ($pdo !== null) {
        $alleOverrides = avesmapsSettlementWikiOverrideAlle($pdo);
        if ($alleOverrides !== []) {
            $overrideFuer = avesmapsSettlementWikiOverrideNachschlag($alleOverrides, 'avesmapsWikiSyncCreateMatchKey');
            $overrideSiedlungen = avesmapsSettlementWikiOverrideSiedlungNamen($rows);
        }
    }
```

Die zwei Aufrufe ergänzen: `avesmapsBuildInSettlementSearchEntries($inSettlementRows, $settlementIndex, $scopeIndex, $overrideFuer, $overrideSiedlungen)` und `avesmapsBuildOffmapSearchEntries($offmapRows, avesmapsBuildOffmapTargetIndex($rows, $politicalRows), $scopeIndex, avesmapsBuildMapPresenceIndex($rows), $overrideFuer, $overrideSiedlungen)`.

- [ ] **Step 7: `map-features.php` verdrahten.** In `avesmapsMapFeaturesInSettlementPlaces` die Zeile `return avesmapsBuildInSettlementPlaceList($registryRows, $scopeIndex, $storedPlaces);` ersetzen durch:

```php
        $alleOverrides = avesmapsSettlementWikiOverrideAlle($pdo);
        $overrideFuer = $alleOverrides === [] ? null : avesmapsSettlementWikiOverrideNachschlag($alleOverrides, 'avesmapsWikiSyncCreateMatchKey');
        $overrideSiedlungen = $alleOverrides === [] ? [] : avesmapsSettlementWikiOverrideSiedlungNamenLaden($pdo);

        return avesmapsBuildInSettlementPlaceList($registryRows, $scopeIndex, $storedPlaces, $overrideFuer,
            $overrideSiedlungen, avesmapsSettlementWikiVerborgeneTitelLaden($pdo));
```

Die ETag-Zeile (~323) — **eine Zeile bleiben** — wird:

```php
$etag = avesmapsMapFeaturesETag($revision, $_GET, avesmapsClimateReadStamp($pdo), $travelValues['stamp'], avesmapsSettlementPlaceReadStamp($pdo) . avesmapsSettlementWikiOverrideReadStamp($pdo));
```

Über der Funktion `avesmapsMapFeaturesETag` im Kommentarblock zu `$placesStamp` einen Absatz ergänzen:

```php
// 💣 UND DER OVERRIDE-STEMPEL HAENGT DORT MIT DRAN (15.09.2026): ein Override (Name, Innerorts,
// Verborgen) aendert die Staetten-Zeile, bewegt aber kein Kartenobjekt. Leer bei leerer Tabelle --
// der Keim bleibt dann zeichengleich (avesmapsSettlementWikiOverrideReadStamp).
```

- [ ] **Step 8: Neuer Test grün, Nachbarn grün**

Run:
```bash
for t in api/_internal/app/__tests__/innerorts-override-leser-test.php api/_internal/wiki/__tests__/in-settlement-search-test.php api/_internal/wiki/__tests__/stadtteil-kategorie-test.php api/_internal/app/__tests__/offmap-search-test.php api/app/__tests__/map-search-verdrahtung-test.php api/app/__tests__/wege-suche-manueller-name-test.php api/_internal/app/__tests__/settlement-places-test.php api/_internal/app/__tests__/tempowerte-nutzlast-test.php api/_internal/app/__tests__/map-features-delta-schlank-test.php api/_internal/app/__tests__/map-features-variablen-scope-test.php api/_internal/app/__tests__/coat-schalter-revision-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
```
Expected: keine Ausgabe. ⚠️ Vergleicht `in-settlement-search-test.php` oder `stadtteil-kategorie-test.php` eine Bauwerkszeile als ganzes Array, fehlt dort `'quelle' => 'bauwerk'` in der Erwartung — **die Erwartung** ergänzen, nicht den Schlüssel entfernen.

- [ ] **Step 9: Mutationsprobe** — in `avesmapsInSettlementWirksam` `=== 'bauwerk'` durch `!== 'x'` ersetzen → Neuer Test rot (Handelshaus fällt raus) → zurück. In `avesmapsBuildInSettlementPlaceList` `|| $wirksam['is_hidden']` löschen → rot → zurück.

- [ ] **Step 10: Commit (Push zusammen mit Task 3c)**

Commit-Betreff: `feat(orte): Suche, Staetten-Zeile und "nicht auf der Karte" folgen dem Override einer Wiki-Seite`

---

### Task 3c: Beide Listen tragen den wirksamen Stand — und das Ziehen den Wiki-Titel (unsichtbar)

**Files:**
- Modify: `api/_internal/wiki/settlements.php` (Kopf-`require`, neue reine Funktion, `avesmapsWikiSettlementListLocations` ~1466-1611, `avesmapsWikiSettlementEditorList` ~1733-1963)
- Modify: `js/review/review-settlement-list.js:409`
- Test: `api/_internal/wiki/__tests__/editor-liste-override-test.php` (neu), `js/review/__tests__/fehlt-ziehen-titel.test.js` (neu)

**Interfaces:**
- Consumes: Task 3a.
- Produces: `avesmapsWikiSettlementListenWirksam(array $eintrag, array $wirksam, bool $platziert): array`. Jeder Listeneintrag mit Artikel trägt zusätzlich `place_scope_wiki`, `place_scope_label_wiki`, `place_settlement_wiki`, `place_settlement_public_id`, `place_settlement_verwaist`, `is_ruined_wiki`, `override_felder`; nicht platzierte zusätzlich `name_wiki`, `settlement_class_wiki`, `is_hidden`, und `name`/`settlement_class`/`settlement_label`/`is_ruined`/`is_hidden` sind **wirksam**. Bei platzierten Einträgen enthält `override_felder` nur `place_scope`/`place_settlement_public_id`.

- [ ] **Step 1: Failing Tests schreiben**

`api/_internal/wiki/__tests__/editor-liste-override-test.php`:

```php
<?php
declare(strict_types=1);
// Beide Ortslisten geben den WIRKSAMEN Stand heraus (Entwurf 2026-09-15 §3) -- die Merge-Regel
// ausgefuehrt, die Verdrahtung in beiden Listen kommentarfrei geprueft.
if (ini_get('zend.assertions') !== '1') { fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'\n"); exit(2); }
$repoRoot = dirname(__DIR__, 4);
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';

$wiki = ['name' => 'Ordenshaus bei Angbar', 'settlement_class' => 'gebaeude', 'is_ruined' => true, 'is_hidden' => false,
    'place_scope' => 'ambiguous', 'place_settlement' => 'Angbar'];
$wirksam = avesmapsSettlementWikiEffektiv($wiki, ['name' => 'Ordenshaus', 'is_ruined' => false, 'place_scope' => 'outside'], ['P-A' => 'Angbar']);

$fehlt = avesmapsWikiSettlementListenWirksam(['public_id' => '', 'name' => 'Ordenshaus bei Angbar', 'wiki_title' => 'Ordenshaus bei Angbar'], $wirksam, false);
assert($fehlt['name'] === 'Ordenshaus' && $fehlt['name_wiki'] === 'Ordenshaus bei Angbar', 'Name wirksam, Wiki-Name daneben');
assert($fehlt['wiki_title'] === 'Ordenshaus bei Angbar', 'der Titel bleibt der Schluessel');
assert($fehlt['is_ruined'] === false && $fehlt['is_ruined_wiki'] === true);
assert($fehlt['place_scope'] === 'outside' && $fehlt['place_scope_label'] === 'außerorts');
assert($fehlt['place_scope_wiki'] === 'ambiguous' && $fehlt['place_scope_label_wiki'] === 'unklar' && $fehlt['place_settlement_wiki'] === 'Angbar');
assert($fehlt['settlement_label'] === avesmapsWikiSettlementClassLabel('gebaeude'));
assert($fehlt['override_felder'] === ['is_ruined', 'name', 'place_scope']);

$platziert = avesmapsWikiSettlementListenWirksam(['public_id' => 'P-1', 'name' => 'Kartenname', 'is_ruined' => false], $wirksam, true);
assert($platziert['name'] === 'Kartenname', 'bei platzierten Orten gilt die Kartenzeile');
assert($platziert['is_ruined'] === false && $platziert['is_ruined_wiki'] === true);
assert($platziert['override_felder'] === ['place_scope'], 'platziert: nur die Innerorts-Felder');

// Verdrahtung: beide Listen rufen den Eingang -- fuer platzierte UND fehlende Eintraege.
$ohneKommentare = '';
foreach (token_get_all((string) file_get_contents($repoRoot . '/api/_internal/wiki/settlements.php')) as $t) {
    if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) { continue; }
    $ohneKommentare .= is_array($t) ? $t[1] : $t;
}
foreach (['avesmapsWikiSettlementListLocations', 'avesmapsWikiSettlementEditorList'] as $liste) {
    $start = strpos($ohneKommentare, 'function ' . $liste . '(');
    $rumpf = substr($ohneKommentare, $start, strpos($ohneKommentare, "\nfunction ", $start + 10) - $start);
    assert(substr_count($rumpf, 'avesmapsWikiSettlementListenWirksam(') === 2, $liste . ': nicht beide Eintragsarten gehen durch den Eingang');
    assert(substr_count($rumpf, 'avesmapsSettlementWikiOverrideAlle($pdo)') === 1, $liste . ': Overrides nicht genau einmal geladen');
}
echo "editor-liste-override: alle Zusicherungen erfuellt\n";
```

`js/review/__tests__/fehlt-ziehen-titel.test.js`:

```js
"use strict";
// Das Ziehen einer Fehlt-Zeile auf die Karte benutzt den WIKI-TITEL als Titel fuer assign_to und die
// Wiki-Klasse als Typ -- ein Namens- oder Typ-Override darf die Zuweisung nicht ins Leere schicken.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const quelle = fs.readFileSync(path.join(__dirname, "..", "review-settlement-list.js"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((z) => !z.trim().startsWith("//")).join("\n");
assert.ok(quelle.includes('data-settlement-title="${settlementListEscape(item.wiki_title || item.name)}"'),
	"das Ziehen nimmt nicht den Wiki-Titel");
assert.ok(quelle.includes('data-settlement-class="${settlementListEscape(item.settlement_class_wiki || item.settlement_class)}"'),
	"das Ziehen nimmt nicht die Wiki-Klasse");
console.log("fehlt-ziehen-titel: alle Zusicherungen erfuellt");
```

- [ ] **Step 2: Beide laufen lassen, müssen rot sein**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/editor-liste-override-test.php; node js/review/__tests__/fehlt-ziehen-titel.test.js`
Expected: beide FAIL (`undefined function avesmapsWikiSettlementListenWirksam` bzw. „nimmt nicht den Wiki-Titel").

- [ ] **Step 3: Kopf und reine Funktion.** In `api/_internal/wiki/settlements.php` unter `require_once __DIR__ . '/../ortsklassen.php';` ergänzen:

```php
// Die Override-Zeile je Wiki-Seite (Entwurf 2026-09-15-wiki-ort-override §2/§3).
require_once __DIR__ . '/settlement-wiki-override.php';
```

Direkt vor `function avesmapsWikiSettlementListLocations(` einfügen:

```php
/**
 * REIN: einen Listeneintrag mit dem wirksamen Stand fuellen (Entwurf 2026-09-15 §3).
 * 🔴 Bei PLATZIERTEN Orten gilt die Kartenzeile fuer Name, Typ, Ruine, Verborgen -- dort wirken nur
 * Innerorts und „Gehoert zu". Der Wiki-Stand reist in `*_wiki` mit, damit der Editor ihn
 * durchgestrichen zeigen kann, ohne zweimal zu fragen.
 */
function avesmapsWikiSettlementListenWirksam(array $eintrag, array $wirksam, bool $platziert): array
{
    $wiki = $wirksam['wiki'];
    $eintrag['place_scope'] = $wirksam['place_scope'];
    $eintrag['place_scope_label'] = avesmapsPlaceScopeLabel($wirksam['place_scope']);
    $eintrag['place_settlement'] = $wirksam['place_settlement'];
    $eintrag['place_settlement_public_id'] = $wirksam['place_settlement_public_id'];
    $eintrag['place_settlement_verwaist'] = $wirksam['place_settlement_verwaist'];
    $eintrag['place_scope_wiki'] = (string) ($wiki['place_scope'] ?? '');
    $eintrag['place_scope_label_wiki'] = avesmapsPlaceScopeLabel((string) ($wiki['place_scope'] ?? ''));
    $eintrag['place_settlement_wiki'] = (string) ($wiki['place_settlement'] ?? '');
    $eintrag['is_ruined_wiki'] = (bool) ($wiki['is_ruined'] ?? false);
    $felder = $wirksam['override_felder'];
    if ($platziert) {
        $felder = array_values(array_intersect($felder, ['place_scope', 'place_settlement_public_id']));
    } else {
        $eintrag['name'] = $wirksam['name'];
        $eintrag['name_wiki'] = (string) ($wiki['name'] ?? '');
        $eintrag['settlement_class'] = $wirksam['settlement_class'];
        $eintrag['settlement_label'] = avesmapsWikiSettlementClassLabel($wirksam['settlement_class']);
        $eintrag['settlement_class_wiki'] = (string) ($wiki['settlement_class'] ?? '');
        $eintrag['is_ruined'] = $wirksam['is_ruined'];
        $eintrag['is_hidden'] = $wirksam['is_hidden'];
    }
    $eintrag['override_felder'] = $felder;
    return $eintrag;
}
```

- [ ] **Step 4: Beide Listen verdrahten — je Funktion dieselben drei Eingriffe.**

(a) Die zwei Zeilen `$settlementClasses = ['dorf', …];` und `$regRows = $pdo->query('SELECT title, settlement_class, wiki_url, continent, is_ruined, building_type, coat_url, standort FROM ' …)->fetchAll(PDO::FETCH_ASSOC);` **ausschneiden** und direkt unter `$mapKeys = avesmapsBuildMapPresenceIndex($rows);` einsetzen; darunter anfügen:

```php
    // Registerzeilen nach Schluessel, die Overrides und die Siedlungsnamen -- je EINMAL je Anfrage.
    $regNachKey = [];
    foreach ($regRows as $regZeile) {
        $regKey = avesmapsWikiSyncCreateMatchKey((string) ($regZeile['title'] ?? ''));
        if ($regKey !== '' && !isset($regNachKey[$regKey])) {
            $regNachKey[$regKey] = $regZeile;
        }
    }
    $alleOverrides = avesmapsSettlementWikiOverrideAlle($pdo);
    $siedlungNamen = avesmapsSettlementWikiOverrideSiedlungNamen(
        array_map(static fn(array $z): array => $z + ['feature_type' => 'location'], $rows)
    );
```

(b) Platzierter Eintrag: `$items[] = [` (der mit `'public_id' => (string) $row['public_id'],` bzw. in `ListLocations` `(string) $r['public_id'],`) wird `$eintrag = [`; hinter seinem schliessenden `];` einfügen (in `ListLocations` statt `$row`/`$props['is_hidden']` dieselben Namen dort: `$r`, `$props`, `$ws`, `$name`, `$sub`, `$mapScope`):

```php
        $artikelTitel = is_array($ws) && !empty($ws['title']) ? (string) $ws['title'] : '';
        if ($artikelTitel !== '') {
            $artikelKey = avesmapsWikiSyncCreateMatchKey($artikelTitel);
            $platzOverride = array_intersect_key($alleOverrides[$artikelKey] ?? [], array_flip(['place_scope', 'place_settlement_public_id']));
            $eintrag = avesmapsWikiSettlementListenWirksam($eintrag, avesmapsSettlementWikiEffektiv(
                ['name' => $name, 'settlement_class' => $sub, 'is_ruined' => !empty($regNachKey[$artikelKey]['is_ruined']),
                    'is_hidden' => !empty($props['is_hidden']), 'place_scope' => $mapScope['scope'], 'place_settlement' => $mapScope['settlement']],
                $platzOverride === [] ? null : $platzOverride,
                $siedlungNamen
            ), true);
        }
        $items[] = $eintrag;
```

(c) Fehlender Eintrag: `$items[] = [` (der mit `'public_id' => '',`) wird `$eintrag = [`; hinter seinem `];` einfügen:

```php
        $items[] = avesmapsWikiSettlementListenWirksam($eintrag, avesmapsSettlementWikiEffektiv(
            ['name' => $title, 'settlement_class' => $cls, 'is_ruined' => !empty($r['is_ruined']), 'is_hidden' => false,
                'place_scope' => $regScope['scope'], 'place_settlement' => $regScope['settlement']],
            $alleOverrides[$bk] ?? null,
            $siedlungNamen
        ), false);
```

⚠️ `ListLocations` benutzt im platzierten Zweig `$r` als Schleifenvariable; die Registerschleife in (a) heisst deshalb `$regZeile`, nicht `$r`.

- [ ] **Step 5: Ziehen umstellen.** `js/review/review-settlement-list.js:409`:

```js
		? ` draggable="true" data-settlement-title="${settlementListEscape(item.wiki_title || item.name)}" data-settlement-class="${settlementListEscape(item.settlement_class_wiki || item.settlement_class)}"`
```

Darüber eine Kommentarzeile: `// 🔴 Wiki-TITEL und Wiki-KLASSE: der Name ist ueberschreibbar, und assign_to braucht den Titel; die Uebernahme (Entwurf 2026-09-15 §5) stempelt den Override selbst.`

- [ ] **Step 6: Tests grün, Nachbarn grün**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/editor-liste-override-test.php && node js/review/__tests__/fehlt-ziehen-titel.test.js && php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/editor-liste-innerorts-test.php && php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/editor-wappen-nur-lokal-test.php`
Expected: vier grüne Zeilen.

- [ ] **Step 7: Mutationsprobe** — (1) in `avesmapsWikiSettlementListenWirksam` die Zeile `$felder = array_values(array_intersect(…));` im `if ($platziert)`-Zweig löschen → Test rot (`platziert: nur die Innerorts-Felder`) → zurück. (2) In `avesmapsWikiSettlementEditorList` den Aufruf im Fehlt-Zweig durch `$items[] = $eintrag;` ersetzen → Verdrahtungszusicherung rot → zurück. `git diff --stat` danach prüfen.

- [ ] **Step 8: Ganzes Testfeld, Commits 3a–3c pushen (unsichtbar, gebündelt erlaubt)**

Commit-Betreff 3c: `feat(orte): beide Ortslisten tragen den wirksamen Stand einer Wiki-Seite -- und das Ziehen den Wiki-Titel`

Nach dem Deploy EINE Probe gegen die Live-Seite (Editor-Sitzung): `settlement_editor_list` enthält für eine Fehlt-Bauwerkszeile `place_scope_label` und `override_felder: []`.

---

### Task 4: Die zwei Schreibaktionen (unsichtbar)

**Files:**
- Modify: `api/_internal/wiki/settlements.php` (zwei Bibliotheksfunktionen, ans Ende von `avesmapsWikiSettlementListenWirksam` anschliessend)
- Modify: `api/edit/wiki/settlements.php` (zwei `match`-Arme im POST-Zweig)
- Test: `api/_internal/wiki/__tests__/settlement-wiki-override-aktion-test.php` (neu)

**Interfaces:**
- Consumes: Task 3a.
- Produces:
  - `avesmapsWikiSettlementOverrideWikiStand(PDO $pdo, string $title): array` → Form `$wiki` (Task 3a), wirft `RuntimeException`, wenn die Seite nicht im Register steht.
  - `avesmapsWikiSettlementOverrideSetzen(PDO $pdo, string $title, array $felder, int $userId): array` → `['ok' => true, 'title' => string, 'overrides' => array, 'wirksam' => array]`
  - `avesmapsWikiSettlementOverrideAufheben(PDO $pdo, string $title, array $felder, int $userId): array` → dieselbe Form
  - POST `set_field_override` `{title: string, fields: object}` und `clear_field_override` `{title: string, fields: string[]}`; beide verlangen `edit`.

- [ ] **Step 1: Failing Test schreiben** — `api/_internal/wiki/__tests__/settlement-wiki-override-aktion-test.php`

```php
<?php
declare(strict_types=1);
// Die zwei Schreibaktionen gegen SQLite -- und dass der Endpunkt sie hinter `edit` stellt.
if (ini_get('zend.assertions') !== '1') { fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'\n"); exit(2); }
$repoRoot = dirname(__DIR__, 4);
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { echo "UEBERSPRUNGEN (kein pdo_sqlite)\n"; exit(0); }

// MySQL-DDL wird uebersprungen, die Tabellen legt der Test selbst an (Vorbild settlement-places-test.php).
final class AvesmapsOverrideAktionTestPdo extends PDO
{
    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'AUTO_INCREMENT') || str_contains($statement, 'ENGINE=InnoDB')) { return 0; }
        return parent::exec($statement);
    }
}
$pdo = new AvesmapsOverrideAktionTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE wiki_sync_pages (title TEXT, settlement_class TEXT, is_ruined INTEGER, standort TEXT)');
$pdo->exec('CREATE TABLE map_features (public_id TEXT, feature_type TEXT, feature_subtype TEXT, name TEXT, is_active INTEGER, properties_json TEXT)');
$pdo->exec('CREATE TABLE settlement_wiki_override (id INTEGER PRIMARY KEY AUTOINCREMENT, normalized_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, overrides_json TEXT NOT NULL, updated_by INTEGER NULL, updated_at TEXT NOT NULL)');
$pdo->exec("INSERT INTO wiki_sync_pages VALUES ('Ordenshaus bei Angbar', 'gebaeude', 0, 'bei [[Angbar]]')");
$pdo->exec("INSERT INTO wiki_sync_pages VALUES ('Akademie Schwert und Stab', 'gebaeude', 0, '[[Gareth]]')");
$pdo->exec("INSERT INTO map_features VALUES ('P-G', 'location', 'metropole', 'Gareth', 1, '{}')");
$pdo->exec("INSERT INTO map_features VALUES ('P-A', 'location', 'stadt', 'Angbar', 1, '{}')");

$stand = avesmapsWikiSettlementOverrideWikiStand($pdo, 'Akademie Schwert und Stab');
assert($stand['place_scope'] === 'inside' && $stand['place_settlement'] === 'Gareth' && $stand['settlement_class'] === 'gebaeude');

$r = avesmapsWikiSettlementOverrideSetzen($pdo, 'Akademie Schwert und Stab',
    ['name' => 'Akademie S&S', 'settlement_class' => 'gebaeude', 'is_ruined' => false, 'is_hidden' => true], 5);
assert($r['overrides'] === ['is_hidden' => true, 'name' => 'Akademie S&S'], 'gleich Wiki faellt weg: ' . json_encode($r['overrides']));
assert($r['wirksam']['name'] === 'Akademie S&S' && $r['wirksam']['is_hidden'] === true);

$r = avesmapsWikiSettlementOverrideSetzen($pdo, 'Akademie Schwert und Stab', ['place_scope' => 'inside', 'place_settlement_public_id' => 'P-A'], 5);
assert($r['wirksam']['place_settlement'] === 'Angbar', 'Gehört zu wirkt sofort');

$r = avesmapsWikiSettlementOverrideAufheben($pdo, 'Akademie Schwert und Stab', ['place_scope', 'name'], 5);
assert($r['overrides'] === ['is_hidden' => true], 'place_scope nimmt die Stadt mit, name faellt: ' . json_encode($r['overrides']));
$r = avesmapsWikiSettlementOverrideAufheben($pdo, 'Akademie Schwert und Stab', ['is_hidden'], 5);
assert($r['overrides'] === [] && avesmapsSettlementWikiOverrideAlle($pdo) === [], 'leer -> Zeile weg');

foreach ([['Unbekannte Seite', ['name' => 'X']], ['Akademie Schwert und Stab', ['place_scope' => 'inside', 'place_settlement_public_id' => 'P-WEG']]] as [$titel, $felder]) {
    $geworfen = false;
    try { avesmapsWikiSettlementOverrideSetzen($pdo, $titel, $felder, 5); } catch (RuntimeException) { $geworfen = true; }
    assert($geworfen, 'muss als RuntimeException (400) werfen: ' . $titel);
}

// Endpunkt: beide Arme stehen da, und beide verlangen `edit` (der Endpunkt selbst prueft nur `review`).
$endpunkt = '';
foreach (token_get_all((string) file_get_contents($repoRoot . '/api/edit/wiki/settlements.php')) as $t) {
    if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) { continue; }
    $endpunkt .= is_array($t) ? $t[1] : $t;
}
foreach (['set_field_override' => 'avesmapsWikiSettlementOverrideSetzen(', 'clear_field_override' => 'avesmapsWikiSettlementOverrideAufheben('] as $aktion => $aufruf) {
    $ab = strpos($endpunkt, "'" . $aktion . "' =>");
    assert($ab !== false, 'Aktion fehlt: ' . $aktion);
    $arm = substr($endpunkt, $ab, (int) strpos($endpunkt, '})(),', $ab) - $ab);
    assert(str_contains($arm, "avesmapsRequireUserWithCapability('edit')") && str_contains($arm, $aufruf), $aktion . ': ohne edit-Riegel oder ohne Aufruf');
}
echo "settlement-wiki-override-aktion: alle Zusicherungen erfuellt\n";
```

- [ ] **Step 2: Laufen lassen, muss rot sein**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/settlement-wiki-override-aktion-test.php`
Expected: FAIL `Call to undefined function avesmapsWikiSettlementOverrideWikiStand`

- [ ] **Step 3: Bibliothek** — in `api/_internal/wiki/settlements.php` hinter `avesmapsWikiSettlementListenWirksam` einfügen:

```php
/**
 * Der Wiki-Stand einer Seite in der Form, die avesmapsSettlementWikiEffektiv erwartet.
 * ⚠️ Laedt den Scope-Index -- ein Editor-Klick, keine Schleife (AGENTS.md §9).
 */
function avesmapsWikiSettlementOverrideWikiStand(PDO $pdo, string $title): array
{
    $title = trim($title);
    $statement = $pdo->prepare('SELECT title, settlement_class, is_ruined, standort FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' WHERE title = :t LIMIT 1');
    $statement->execute(['t' => $title]);
    $zeile = $statement->fetch(PDO::FETCH_ASSOC);
    if ($title === '' || !is_array($zeile)) {
        throw new RuntimeException('Diese Wiki-Seite steht nicht im Register: ' . $title);
    }
    $scope = avesmapsPlaceScopeClassifyWithIndex((string) ($zeile['standort'] ?? ''), avesmapsPlaceScopeLoadIndex($pdo));
    return ['name' => (string) $zeile['title'], 'settlement_class' => (string) ($zeile['settlement_class'] ?? ''),
        'is_ruined' => !empty($zeile['is_ruined']), 'is_hidden' => false,
        'place_scope' => $scope['scope'], 'place_settlement' => $scope['settlement']];
}

/** Override-Felder einer Wiki-Seite setzen (Entwurf 2026-09-15 §4). Wert gleich Wiki faellt weg. */
function avesmapsWikiSettlementOverrideSetzen(PDO $pdo, string $title, array $felder, int $userId): array
{
    return avesmapsWikiSettlementOverrideAendern($pdo, $title, $userId,
        static fn(array $alt, array $wiki, array $siedlungen): array => avesmapsSettlementWikiOverrideBereinigen($alt, $felder, $wiki, $siedlungen));
}

/** Override-Felder zuruecknehmen; `place_scope` nimmt seine Stadt mit. */
function avesmapsWikiSettlementOverrideAufheben(PDO $pdo, string $title, array $felder, int $userId): array
{
    return avesmapsWikiSettlementOverrideAendern($pdo, $title, $userId,
        static fn(array $alt): array => avesmapsSettlementWikiOverrideZuruecknehmen($alt, array_map('strval', $felder)));
}

/** Gemeinsamer Ablauf beider Aktionen -- EIN Weg, damit Setzen und Zuruecknehmen nicht auseinanderlaufen. */
function avesmapsWikiSettlementOverrideAendern(PDO $pdo, string $title, int $userId, callable $rechnen): array
{
    $wiki = avesmapsWikiSettlementOverrideWikiStand($pdo, $title);
    $key = avesmapsWikiSyncCreateMatchKey($wiki['name']);
    // 💣 DDL VOR jedem Schreiben, nie in einer Transaktion (AGENTS.md §10).
    avesmapsSettlementWikiOverrideEnsureSchema($pdo);
    $siedlungen = avesmapsSettlementWikiOverrideSiedlungNamenLaden($pdo);
    $alt = avesmapsSettlementWikiOverrideAlle($pdo)[$key] ?? [];
    $neu = $rechnen($alt, $wiki, $siedlungen);
    avesmapsSettlementWikiOverrideSchreiben($pdo, $key, $wiki['name'], $neu, $userId);
    return ['ok' => true, 'title' => $wiki['name'], 'overrides' => $neu,
        'wirksam' => avesmapsSettlementWikiEffektiv($wiki, $neu === [] ? null : $neu, $siedlungen)];
}
```

- [ ] **Step 4: Endpunkt** — in `api/edit/wiki/settlements.php` im POST-`match` vor `default => null,` einfügen:

```php
        // Eigene Angaben zu einer Wiki-Seite (Entwurf 2026-09-15-wiki-ort-override §4).
        // 🔴 `edit`, nicht das `review` dieses Endpunkts -- dieselbe Verschaerfung wie in sync-monitor.php.
        // ⚠️ Kein Revisionssprung: die Listen lesen live, die Kartennutzlast hat ihren eigenen Stempel.
        'set_field_override' => (static function () use ($pdo, $payload, $user): array {
            avesmapsRequireUserWithCapability('edit');
            return avesmapsWikiSettlementOverrideSetzen($pdo, (string) ($payload['title'] ?? ''),
                is_array($payload['fields'] ?? null) ? $payload['fields'] : [], (int) ($user['id'] ?? 0));
        })(),
        'clear_field_override' => (static function () use ($pdo, $payload, $user): array {
            avesmapsRequireUserWithCapability('edit');
            return avesmapsWikiSettlementOverrideAufheben($pdo, (string) ($payload['title'] ?? ''),
                is_array($payload['fields'] ?? null) ? $payload['fields'] : [], (int) ($user['id'] ?? 0));
        })(),
```

- [ ] **Step 5: Test grün, Nachbarn grün**

Run: `for t in api/_internal/wiki/__tests__/settlement-wiki-override-aktion-test.php api/_internal/wiki/__tests__/wiki-interaktiv-drossel-test.php api/_internal/wiki/__tests__/wappen-aufraeumen-test.php api/_internal/app/__tests__/coat-schalter-revision-test.php api/_internal/app/__tests__/coat-zwei-schalter-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null 2>&1 || echo "ROT: $t"; done`
Expected: keine Ausgabe.

- [ ] **Step 6: Mutationsprobe** — im Arm `set_field_override` die Zeile `avesmapsRequireUserWithCapability('edit');` löschen → rot → zurück.

- [ ] **Step 7: Commit (Push zusammen mit Task 5 — ohne Oberfläche ist die Aktion nicht erreichbar)**

Commit-Betreff: `feat(orte): set_field_override und clear_field_override fuer Wiki-Seiten -- nur mit edit`

---

### Task 5: Der nicht platzierte Ort wird bearbeitbar (sichtbar)

**Files:**
- Modify: `html/wiki-sync-settlement-editor.html` — `settlementSearchMatch` (~1376-1380), `buildWikiOnlySettlementDetailHtml` (~1802-1824), `renderWikiOnlySettlementDetail` (~1828-1835), `renderSettlementDetail` (~1738), `settlementWikiResetZuhoererBinden` (~2616-2627), delegierter Klick-Zuhörer (~3025-3031)
- Test: `js/pages/__tests__/ort-fehlt-formular.test.js` (neu)

**Interfaces:**
- Consumes: Task 3c (Listeneintrag: `wiki_title`, `name`, `name_wiki`, `settlement_class`, `settlement_class_wiki`, `is_ruined`, `is_ruined_wiki`, `is_hidden`, `override_felder`), Task 4 (`set_field_override`).
- Produces (global im Inline-Skript): `let selectedWikiOnlyItem`, `settlementFehltStand(item) → Ergebnis von avesmapsWikiFeldStand`, `buildWikiOnlyOverrideFields() → {name, settlement_class, is_ruined, is_hidden}`, `settlementOverrideFeldZuruecksetzen(feld)`, `async saveWikiOnlySettlementForm()`. Element-IDs `dtWoName`, `dtWoType`, `dtWoIsRuined`, `dtWoIsHidden`, `dtWoSave`; Meldungen weiter über `#dtEditMsg`.

- [ ] **Step 1: Failing Test schreiben** — `js/pages/__tests__/ort-fehlt-formular.test.js`

```js
"use strict";
// Eine Fehlt-Zeile ist bearbeitbar: Formular, ↺ und Speichern AUSGEFUEHRT (Entwurf 2026-09-15 §0.1, §6).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const EDITOR_HTML = "html/wiki-sync-settlement-editor.html";
const block = (fs.readFileSync(path.join(wurzel, EDITOR_HTML), "utf8").match(/<script>([\s\S]*?)<\/script>/g) || [])
	.map((b) => b.replace(/^<script>/, "").replace(/<\/script>$/, "")).sort((a, b) => b.length - a.length)[0];

const elemente = {};
const schein = () => ({ value: "", checked: false, disabled: false, dataset: {}, style: {}, innerHTML: "", textContent: "", className: "",
	classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, appendChild() {},
	setAttribute() {}, getAttribute() { return null; }, closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } });
const gesendet = [];
const kasten = { console, JSON, Math, Date, Number, String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
	setTimeout, clearTimeout, setInterval, clearInterval, isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
	document: { readyState: "complete", getElementById(id) { return (elemente[id] = elemente[id] || schein()); },
		querySelector: () => null, querySelectorAll: () => [], createElement: () => schein(), addEventListener() {}, body: schein(), documentElement: schein() },
	location: { href: "http://pruefstand.local/", search: "", origin: "http://pruefstand.local" }, addEventListener() {}, removeEventListener() {}, parent: null,
	fetch(url, optionen) {
		if (optionen && optionen.body) gesendet.push(JSON.parse(optionen.body));
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) });
	} };
kasten.window = kasten; kasten.globalThis = kasten; kasten.self = kasten;
vm.createContext(kasten);
["js/ui/ortsklassen.js", "js/ui/ribbon-menu.js", "js/ui/filter-menu.js", "js/ui/listen-statuskreis.js", "js/ui/dialog-hintergrund-schliessen.js",
	"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-feld-herkunft.js", "js/ui/wiki-assign.js", "js/ui/wiki-assign-ort.js"]
	.forEach((datei) => vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei }));
vm.runInContext(block, kasten, { filename: EDITOR_HTML });

const ITEM = { public_id: "", on_map: false, wiki_title: "Ordenshaus bei Angbar", name: "Ordenshaus", name_wiki: "Ordenshaus bei Angbar",
	settlement_class: "gebaeude", settlement_class_wiki: "gebaeude", settlement_label: "Besondere Bauwerke/Stätten",
	is_ruined: true, is_ruined_wiki: false, is_hidden: false, override_felder: ["is_ruined", "name"], continent: "Aventurien",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Ordenshaus", place_scope: "outside", place_scope_label: "außerorts" };

const html = vm.runInContext("buildWikiOnlySettlementDetailHtml", kasten)(ITEM);
assert.ok(!html.includes("Zum Bearbeiten zuerst"), "der alte Sperrsatz steht noch da");
assert.ok(/id="dtWoName"[^>]*value="Ordenshaus"/.test(html), "Name ist keine Eingabe mit dem wirksamen Wert");
assert.ok(/<div class="k ovr">Name/.test(html) && /data-override-reset="name"/.test(html), "Name: braun + ↺ fehlt");
assert.ok(html.includes("Ordenshaus bei Angbar"), "der durchgestrichene Wiki-Name fehlt");
assert.ok(/<div class="k ovr">Ruine/.test(html) && /data-override-reset="is_ruined"/.test(html), "Ruine: braun + ↺ fehlt");
assert.ok(!/data-override-reset="is_hidden"/.test(html), "Verborgen hat keinen Wiki-Stand und darf kein ↺ tragen");
assert.ok(/<select id="dtWoType"/.test(html) && /id="dtWoIsRuined"[^>]*checked/.test(html) && /id="dtWoSave"/.test(html));
assert.ok(html.indexOf('"dt-grp">Identität<') < html.indexOf('"dt-grp">Eigenschaften<'), "Identität vor Eigenschaften");

// 🪤 Die Attrappe legt ein Element erst beim ersten getElementById an -- vorher gibt es `elemente.X` nicht.
const el = (id) => kasten.document.getElementById(id);
vm.runInContext("selectedWikiOnlyItem = " + JSON.stringify(ITEM) + ";", kasten);
el("dtWoName").value = "Ordenshaus";
vm.runInContext("settlementOverrideFeldZuruecksetzen('name')", kasten);
assert.strictEqual(el("dtWoName").value, "Ordenshaus bei Angbar", "↺ am Namen holt den Wiki-Titel nicht");
el("dtWoIsRuined").checked = true;
vm.runInContext("settlementOverrideFeldZuruecksetzen('is_ruined')", kasten);
assert.strictEqual(el("dtWoIsRuined").checked, false, "↺ an Ruine holt den Wiki-Stand nicht");

el("dtWoType").value = "stadtviertel";
el("dtWoIsHidden").checked = true;
assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext("buildWikiOnlyOverrideFields()", kasten))),
	{ name: "Ordenshaus bei Angbar", settlement_class: "stadtviertel", is_ruined: false, is_hidden: true });

vm.runInContext("loadSettlementItems = async () => {};", kasten);
(async () => {
	await vm.runInContext("saveWikiOnlySettlementForm()", kasten);
	const post = gesendet.find((g) => g.action === "set_field_override");
	assert.ok(post, "Speichern schickt kein set_field_override");
	assert.strictEqual(post.title, "Ordenshaus bei Angbar", "Speichern adressiert nicht den Wiki-TITEL");

	// Die Suche findet eine umbenannte Fehlt-Zeile auch unter ihrem Wiki-Titel.
	vm.runInContext("settlementSearchState.value = 'bei angbar';", kasten);
	assert.strictEqual(vm.runInContext("settlementSearchMatch", kasten)(ITEM), true, "Suche kennt den Wiki-Titel nicht");

	// Der ↺-Zuhoerer kennt beide Arten.
	assert.ok(block.includes('closest("[data-override-reset]")'), "der Zuhoerer bedient data-override-reset nicht");
	console.log("ort-fehlt-formular: alle Zusicherungen erfuellt");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Step 2: Laufen lassen, muss rot sein**

Run: `node js/pages/__tests__/ort-fehlt-formular.test.js`
Expected: FAIL `der alte Sperrsatz steht noch da`

- [ ] **Step 3: Suche** — `settlementSearchMatch` Rückgabezeile ersetzen durch:

```js
	// Name UND Wiki-Titel: eine umbenannte Fehlt-Zeile muss unter beiden auffindbar bleiben.
	return (String(item.name || "") + "\n" + String(item.wiki_title || "")).toLowerCase().includes(query);
```

- [ ] **Step 4: Formular** — `buildWikiOnlySettlementDetailHtml` (samt dem Kommentarblock direkt darüber, der „Es ist ein ANDERER Weg … kein Formular" sagt) ersetzen durch:

```js
// ---- Wiki-only ("Fehlt"): seit 15.09.2026 BEARBEITBAR (Entwurf 2026-09-15-wiki-ort-override §0.1).
// 🔴 Geschrieben wird NICHT update_point (es gibt keine Kartenzeile), sondern die Override-Zeile der
// Wiki-Seite (set_field_override). Die Werte kommen aus dem LISTENEINTRAG: der Server hat dort den
// wirksamen Stand und den Wiki-Stand (`*_wiki`) schon nebeneinandergelegt -- kein zweiter Abruf.
// ⚠️ Kein Wappen, keine Bilder, keine Quellen, kein Kasten „Wiki-Ort" (Entscheid 6): die Zeile IST
// der Artikel, und alles andere haengt an einer Kartenzeile.
let selectedWikiOnlyItem = null;

// REIN: dieselbe Rechnung wie jede andere Override-Zeile (js/ui/wiki-feld-herkunft.js).
// Haken als "ja"/"nein", damit „nein" ein Wert ist und nicht als leer gilt.
function settlementFehltStand(item) {
	const it = item || {};
	const herkunft = {};
	(it.override_felder || []).forEach((feld) => { herkunft[feld] = "manual"; });
	return avesmapsWikiFeldStand(
		[
			{ wiki: "name", karte: "name", leerbar: false },
			{ wiki: "settlement_class", karte: "settlement_class", leerbar: false },
			{ wiki: "is_ruined", karte: "is_ruined" },
		],
		{ name: it.name || "", settlement_class: it.settlement_class || "", is_ruined: it.is_ruined ? "ja" : "nein" },
		{ name: it.name_wiki || it.name || "", settlement_class: it.settlement_class_wiki || it.settlement_class || "", is_ruined: it.is_ruined_wiki ? "ja" : "nein" },
		herkunft,
		{ settlement_class: Object.fromEntries(SETTLEMENT_EDIT_TYPE_OPTIONS.map((o) => [o.value, o.label])) }
	);
}

function buildWikiOnlySettlementDetailHtml(item) {
	const it = item || {};
	const stand = settlementFehltStand(it);
	const kZelle = (feld, text) => {
		const s = stand[feld];
		const alt = s && s.abweicht
			? `<span class="wiki-alt"><span class="dt-old" title="${settlementEscape("Wiki-Stand: " + s.wikiAnzeige)}">${settlementEscape(s.wikiAnzeige)}</span>`
				+ `<button type="button" class="dt-reset" data-override-reset="${settlementEscape(feld)}" title="Auf Wiki-Stand zurücksetzen">↺</button></span>`
			: "";
		return `<div class="k${s && s.herkunft === "manual" ? " ovr" : ""}">${text}${alt}</div>`;
	};
	const typOptionen = SETTLEMENT_EDIT_TYPE_OPTIONS.map((o) =>
		`<option value="${settlementEscape(o.value)}"${o.value === it.settlement_class ? " selected" : ""}>${settlementEscape(o.label)}</option>`).join("");
	const wikiLink = it.wiki_url
		? `<a class="dt-link" href="${settlementEscape(it.wiki_url)}" target="_blank" rel="noopener">${settlementEscape(it.wiki_title || it.name || "Wiki-Seite")} ↗</a>`
		: `<span class="dt-sub">nicht verknüpft</span>`;
	return (
		`<div class="dt-grp">Identität</div>` +
		`<div class="dt-grid dt-grid--wiki dt-edit-grid">` +
		kZelle("name", "Name") + `<div><input type="text" id="dtWoName" maxlength="160" value="${settlementEscape(it.name || "")}"></div>` +
		kZelle("settlement_class", "Typ") + `<div><select id="dtWoType">${typOptionen}</select></div>` +
		`<div class="k">Kontinent</div><div>${settlementEscape(settlementItemContinent(it))}</div>` +
		`<div class="k">Wiki-Link</div><div>${wikiLink}</div>` +
		`</div>` +
		`<div class="dt-grp">Eigenschaften</div>` +
		`<div class="dt-grid dt-grid--wiki dt-edit-grid">` +
		kZelle("is_ruined", "Ruine") + `<div><label class="dt-edit-checkrow"><input type="checkbox" id="dtWoIsRuined"${it.is_ruined ? " checked" : ""}> ja</label></div>` +
		`<div class="k">Verborgen</div><div><label class="dt-edit-checkrow"><input type="checkbox" id="dtWoIsHidden"${it.is_hidden ? " checked" : ""}> ja</label></div>` +
		`</div>` +
		`<div class="avm-savebar"><span class="avm-savebar__msg" id="dtEditMsg">Keine ungespeicherten Änderungen.</span>` +
		`<button type="button" class="is-primary" id="dtWoSave">Speichern</button></div>` +
		`<div class="dt-sub" style="margin-top:10px">Nur im Wiki — noch nicht auf der Karte. Was du hier änderst, gilt für Liste, Suche und die Stätten der Stadt und wandert beim Platzieren mit.</div>`
	);
}
```

- [ ] **Step 5: Rendern, ↺, Speichern** — `renderWikiOnlySettlementDetail` ersetzen durch:

```js
function renderWikiOnlySettlementDetail(item) {
	const body = $("seDetailBody");
	if (!body) return;
	settlementDetailCache = null;
	selectedWikiOnlyItem = item || null;
	territoryPickerOpen = false;
	territoryPickerQuery = "";
	body.innerHTML = buildWikiOnlySettlementDetailHtml(item || {});
	// Derselbe EINE Zuhoerer wie beim platzierten Ort -- er wird genau einmal gebunden.
	settlementWikiResetZuhoererBinden(body);
}

// Die Formularwerte einer Fehlt-Zeile. Alle vier reisen mit; was dem Wiki gleicht, wirft der Server weg.
function buildWikiOnlyOverrideFields() {
	return {
		name: String(($("dtWoName") && $("dtWoName").value) || "").trim(),
		settlement_class: String(($("dtWoType") && $("dtWoType").value) || "").trim(),
		is_ruined: Boolean($("dtWoIsRuined") && $("dtWoIsRuined").checked),
		is_hidden: Boolean($("dtWoIsHidden") && $("dtWoIsHidden").checked),
	};
}

// ↺ an einer Fehlt-Zeile: holt den Wiki-Stand ins Formular. Geschrieben wird mit „Speichern".
function settlementOverrideFeldZuruecksetzen(feld) {
	const it = selectedWikiOnlyItem;
	if (!it) return;
	if (feld === "name" && $("dtWoName")) $("dtWoName").value = it.name_wiki || it.wiki_title || it.name || "";
	if (feld === "settlement_class" && $("dtWoType")) $("dtWoType").value = it.settlement_class_wiki || it.settlement_class || "";
	if (feld === "is_ruined" && $("dtWoIsRuined")) $("dtWoIsRuined").checked = it.is_ruined_wiki === true;
	setSettlementEditMsg("Auf Wiki-Stand gesetzt — noch nicht gespeichert.", "");
}

async function saveWikiOnlySettlementForm() {
	const it = selectedWikiOnlyItem;
	if (!it) return;
	// 🔴 Adressiert wird der WIKI-TITEL, nie der (ueberschreibbare) Name.
	const titel = it.wiki_title || it.name || "";
	const knopf = $("dtWoSave");
	if (knopf) knopf.disabled = true;
	setSettlementEditMsg("Speichert…", "");
	try {
		await settlementDetailPost({ action: "set_field_override", title: titel, fields: buildWikiOnlyOverrideFields() });
		await loadSettlementItems();
		const frisch = settlementItems.find((i) => !i.public_id && (i.wiki_title || i.name) === titel);
		if (frisch) selectSettlementRow(frisch, rowSelectionKey(frisch));
	} catch (error) {
		setSettlementEditMsg(error && error.message ? error.message : String(error), "bad");
		if (knopf) knopf.disabled = false;
	}
}
```

In `renderSettlementDetail` direkt nach `const token = ++settlementDetailLoadToken;` ergänzen: `selectedWikiOnlyItem = null;`

In `settlementWikiResetZuhoererBinden` den Rumpf des `click`-Zuhörers ersetzen durch:

```js
		const fehlt = ereignis.target && ereignis.target.closest ? ereignis.target.closest("[data-override-reset]") : null;
		if (fehlt) {
			ereignis.preventDefault();
			settlementOverrideFeldZuruecksetzen(fehlt.getAttribute("data-override-reset") || "");
			return;
		}
		const knopf = ereignis.target && ereignis.target.closest
			? ereignis.target.closest("[data-wiki-reset]")
			: null;
		if (!knopf) { return; }
		ereignis.preventDefault();
		settlementWikiFeldZuruecksetzen(knopf.getAttribute("data-wiki-reset") || "");
```

Im delegierten Dokument-Klick direkt unter dem Zweig für `#dtEditSave`:

```js
	if (event.target.closest && event.target.closest("#dtWoSave")) {
		void saveWikiOnlySettlementForm();
		return;
	}
```

- [ ] **Step 6: Test grün, Nachbarn grün**

Run: `for t in js/pages/__tests__/ort-fehlt-formular.test.js js/pages/__tests__/editor-abschnittsreihenfolge.test.js js/pages/__tests__/ortsliste-auswahl-wandert.test.js js/pages/__tests__/ort-wiki-override-form.test.js js/review/__tests__/verborgen-editorformen.test.js js/pages/__tests__/editor-row-single-source.test.js; do node "$t" >/dev/null || echo "ROT: $t"; done`
Expected: keine Ausgabe. ⚠️ `verborgen-editorformen.test.js` sucht `/> Verborgen<\/label>/` — das platzierte Formular trägt es weiter; rot heisst hier, dass Task 6 zu früh gebaut wurde.

- [ ] **Step 7: Mutationsprobe** — in `saveWikiOnlySettlementForm` `it.wiki_title || it.name` durch `it.name` ersetzen → Test rot („adressiert nicht den Wiki-TITEL") → zurück.

- [ ] **Step 8: Browser-Abnahme (Ablauf, nicht Maß)** — lokal gegen eine Probeseite oder live nach dem Deploy, in der Editor-Sitzung: Fehlt-Zeile anklicken → Name ändern → Speichern → Liste zeigt den neuen Namen, Zeile bleibt gewählt → ↺ am Namen → Speichern → Wiki-Name zurück, keine braune Beschriftung mehr. Dark-Mode einmal ansehen.

- [ ] **Step 9: Ganzes Testfeld, Commit Task 4 + 5, Push, Owner-Blick**

Commit-Betreff: `ui(orte): Orte aus "Fehlt" lassen sich bearbeiten -- Name, Typ, Ruine, Verborgen mit ↺`

---

### Task 6: „Lage & Zugehörigkeit" — Innerorts, Gehört zu, und das ↺ an Ruine (sichtbar)

**Files:**
- Modify: `html/wiki-sync-settlement-editor.html` — Inline-`<style>` (~287), `buildSettlementEditFormHtml` (Eigenschaften, ~2017-2049), `buildLocationGroupHtml` (~2121), `buildWikiOnlySettlementDetailHtml` (aus Task 5), `renderSettlementDetail`/`renderWikiOnlySettlementDetail` (Picker-Rücksetzen), Dokument-Zuhörer `click` (~3025), `input` (~3110), neuer `change`-Zuhörer
- Modify: `js/review/__tests__/verborgen-editorformen.test.js:59`
- Test: `js/pages/__tests__/ort-innerorts-zeilen.test.js` (neu)

**Interfaces:**
- Consumes: Task 3c (Listeneintrag: `wiki_title`, `settlement_class`, `place_scope`, `place_scope_label`, `place_settlement`, `place_settlement_public_id`, `place_settlement_verwaist`, `place_scope_wiki`, `place_scope_label_wiki`, `place_settlement_wiki`, `is_ruined_wiki`, `override_felder`), Task 4, Task 5 (`selectedWikiOnlyItem`).
- Produces (global im Inline-Skript): `let ortPickerOpen`, `let ortPickerQuery`, `settlementInnerortsTitel(item) → string`, `buildInnerortsFieldsHtml(item) → string`, `buildInnerortsGroupHtml(item) → string` (`''` wenn nicht zuständig), `settlementOrtPickerTreffer() → item[]`, `async applyInnerortsWahl(wert)`, `async applyOrtPick(publicId)`, `async applyInnerortsZuruecksetzen()`. IDs `dtInnerorts`, `dtInnerortsGrid`, `seOrtPickerSearch`; Attribute `data-innerorts-reset`, `data-ort-change`, `data-ort-pick`, `data-ort-results`, `data-ruine-reset`.

- [ ] **Step 1: Failing Test schreiben** — `js/pages/__tests__/ort-innerorts-zeilen.test.js`

```js
"use strict";
// „Innerorts" und „Gehört zu" im Orts-Editor -- Zeilen, Picker und Schreibwege AUSGEFUEHRT
// (Entwurf 2026-09-15 §0.2, §0.5, §6).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const EDITOR_HTML = "html/wiki-sync-settlement-editor.html";
const block = (fs.readFileSync(path.join(wurzel, EDITOR_HTML), "utf8").match(/<script>([\s\S]*?)<\/script>/g) || [])
	.map((b) => b.replace(/^<script>/, "").replace(/<\/script>$/, "")).sort((a, b) => b.length - a.length)[0];
const elemente = {};
const schein = () => ({ value: "", checked: false, disabled: false, dataset: {}, style: {}, innerHTML: "", textContent: "", className: "",
	classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, addEventListener() {}, appendChild() {},
	insertAdjacentHTML() {}, setAttribute() {}, getAttribute() { return null; }, closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } });
const gesendet = [];
const kasten = { console, JSON, Math, Date, Number, String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
	setTimeout, clearTimeout, setInterval, clearInterval, isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
	document: { readyState: "complete", getElementById(id) { return (elemente[id] = elemente[id] || schein()); },
		querySelector: () => null, querySelectorAll: () => [], createElement: () => schein(), addEventListener() {}, body: schein(), documentElement: schein() },
	location: { href: "http://pruefstand.local/", search: "", origin: "http://pruefstand.local" }, addEventListener() {}, removeEventListener() {}, parent: null,
	fetch(url, optionen) {
		if (optionen && optionen.body) gesendet.push(JSON.parse(optionen.body));
		return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) });
	} };
kasten.window = kasten; kasten.globalThis = kasten; kasten.self = kasten;
vm.createContext(kasten);
["js/ui/ortsklassen.js", "js/ui/ribbon-menu.js", "js/ui/filter-menu.js", "js/ui/listen-statuskreis.js", "js/ui/dialog-hintergrund-schliessen.js",
	"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-feld-herkunft.js", "js/ui/wiki-assign.js", "js/ui/wiki-assign-ort.js"]
	.forEach((datei) => vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei }));
vm.runInContext(block, kasten, { filename: EDITOR_HTML });

const GUT = { public_id: "P-1", on_map: true, name: "Gut Menzheim", wiki_title: "Gut Menzheim", settlement_class: "gebaeude",
	place_scope: "outside", place_scope_label: "außerorts", place_settlement: "", place_settlement_public_id: "", place_settlement_verwaist: false,
	place_scope_wiki: "inside", place_scope_label_wiki: "innerorts", place_settlement_wiki: "Menzheim", is_ruined_wiki: true, override_felder: ["place_scope"] };
const MENZHEIM = { public_id: "P-M", on_map: true, name: "Menzheim", settlement_class: "dorf" };
const BURG = { public_id: "P-B", on_map: true, name: "Menzheimer Burg", settlement_class: "gebaeude" };
vm.runInContext("settlementItems = " + JSON.stringify([GUT, MENZHEIM, BURG]) + "; selectedPublicId = 'P-1';", kasten);

// ── Zeilen am platzierten Bauwerk ─────────────────────────────────────────────────────────────
const gruppe = vm.runInContext("buildLocationGroupHtml", kasten)({ public_id: "P-1", on_map: true, properties: {} });
assert.ok(gruppe.includes("Speichert sofort"), "der Hinweis „Speichert sofort“ fehlt");
assert.ok(/<div class="k ovr">Innerorts/.test(gruppe), "Innerorts ist nicht als von uns gesetzt markiert");
assert.ok(gruppe.includes("innerorts (Menzheim)") && /data-innerorts-reset/.test(gruppe), "Wiki-Stand + ↺ fehlen");
assert.ok(/<option value="outside" selected>/.test(gruppe), "die Auswahl zeigt nicht den wirksamen Wert");
assert.ok(gruppe.includes("— nur bei innerorts —"), "Gehört zu ist bei außerorts nicht gesperrt");
assert.ok(/id="dtInnerortsGrid"/.test(gruppe), "das Raster hat keine Kennung zum Nachzeichnen");

// Eine Siedlung bekommt die Zeilen nicht.
assert.strictEqual(vm.runInContext("buildInnerortsGroupHtml", kasten)(MENZHEIM), "", "eine Siedlung liegt nicht in einer Siedlung");

// ── Picker: nur platzierte Siedlungen ─────────────────────────────────────────────────────────
vm.runInContext("ortPickerOpen = true; ortPickerQuery = 'menz';", kasten);
const picker = vm.runInContext("buildInnerortsFieldsHtml", kasten)(Object.assign({}, GUT, { place_scope: "inside", place_settlement: "Menzheim" }));
assert.ok(/data-ort-pick="P-M"/.test(picker), "die Siedlung fehlt im Picker");
assert.ok(!/data-ort-pick="P-B"/.test(picker), "ein Bauwerk steht im Picker");
vm.runInContext("ortPickerOpen = false; ortPickerQuery = '';", kasten);

// ── Ruine am platzierten Ort: ↺, wenn das Wiki anders sagt ────────────────────────────────────
vm.runInContext("buildSettlementTypeSelectHtml = () => '<select id=\"dtEditType\"></select>';", kasten);
const eigenschaften = vm.runInContext("buildSettlementEditFormHtml", kasten)({ public_id: "P-1", name: "Gut Menzheim", feature_subtype: "gebaeude",
	properties: { is_ruined: false, wiki_settlement: { title: "Gut Menzheim", name: "Gut Menzheim", settlement_class: "gebaeude", settlement_class_guessed: false } } }).properties;
assert.ok(/data-ruine-reset/.test(eigenschaften) && eigenschaften.includes(">ja<"), "Ruine (Wiki: ja, Karte: nein) hat kein ↺");
assert.ok(/<div class="k">Verborgen<\/div>/.test(eigenschaften) && /dt-grid--wiki/.test(eigenschaften), "Beschriftung links / 50|50 fehlt");

// ── Schreibwege ───────────────────────────────────────────────────────────────────────────────
vm.runInContext("loadSettlementItems = async () => {}; reloadSettlementDetail = async () => {};", kasten);
(async () => {
	await vm.runInContext("applyInnerortsWahl('outside')", kasten);
	await vm.runInContext("applyInnerortsWahl('inside')", kasten);
	await vm.runInContext("applyOrtPick('P-M')", kasten);
	await vm.runInContext("applyInnerortsZuruecksetzen()", kasten);
	const posts = gesendet.map((g) => [g.action, g.title, g.fields]);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(posts)), [
		["set_field_override", "Gut Menzheim", { place_scope: "outside" }],
		["set_field_override", "Gut Menzheim", { place_scope: "inside", place_settlement_public_id: "P-M" }],
		["set_field_override", "Gut Menzheim", { place_scope: "inside", place_settlement_public_id: "P-M" }],
		["clear_field_override", "Gut Menzheim", ["place_scope"]],
	], "Schreibwege: " + JSON.stringify(posts));

	for (const zeile of ['closest("[data-ort-pick]")', 'closest("[data-ort-change]")', 'closest("[data-innerorts-reset]")',
		'closest("[data-ruine-reset]")', 'event.target.id === "seOrtPickerSearch"', 'event.target.id === "dtInnerorts"']) {
		assert.ok(block.includes(zeile), "Zuhoerer fehlt: " + zeile);
	}
	console.log("ort-innerorts-zeilen: alle Zusicherungen erfuellt");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Step 2: Laufen lassen, muss rot sein**

Run: `node js/pages/__tests__/ort-innerorts-zeilen.test.js`
Expected: FAIL `der Hinweis „Speichert sofort“ fehlt`

- [ ] **Step 3: Stil** — im Inline-`<style>` der Seite unter `.dt-edit-checkrow { … }` ergänzen:

```css
/* „Speichert sofort" rechts im Abschnittskopf (Owner 15.09.2026: der Hinweis reicht). */
.dt-grp__hint { margin-left: auto; font-weight: normal; color: var(--color-text-muted); }
```

- [ ] **Step 4: Eigenschaften am platzierten Ort** — in `buildSettlementEditFormHtml` die drei Konstanten `nodixRow`, `ruinedRow`, `hiddenRow` ersetzen durch:

```js
	// 🔴 Beschriftung LINKS, wie jede andere Zeile (Owner-Regel „50 % | 50 %"): der durchgestrichene
	// Wiki-Stand steht in der linken Haelfte. Ruine hat einen Wiki-Stand (wiki_sync_pages.is_ruined,
	// von der Liste mitgeliefert), Nodix und Verborgen nicht -- sie bekommen nie ein ↺.
	const listenEintrag = settlementItems.find((i) => i.public_id === detail.public_id) || {};
	const ruineStand = avesmapsWikiFeldStand([{ wiki: "is_ruined", karte: "is_ruined" }],
		{ is_ruined: props.is_ruined ? "ja" : "nein" },
		{ is_ruined: listenEintrag.wiki_title ? (listenEintrag.is_ruined_wiki ? "ja" : "nein") : "" }, {}).is_ruined;
	const ruineAlt = ruineStand && ruineStand.abweicht
		? `<span class="wiki-alt"><span class="dt-old" title="${settlementEscape("Weicht vom Wiki ab. Wiki-Stand: " + ruineStand.wikiAnzeige)}">${settlementEscape(ruineStand.wikiAnzeige)}</span>`
			+ `<button type="button" class="dt-reset" data-ruine-reset="1" title="Auf Wiki-Stand zurücksetzen">↺</button></span>`
		: "";
	const nodixRow =
		`<div class="k">Nodix</div><div><label class="dt-edit-checkrow"><input type="checkbox" id="dtEditIsNodix"${props.is_nodix ? " checked" : ""}> ja</label></div>`;
	const ruinedRow =
		`<div class="k">Ruine${ruineAlt}</div><div><label class="dt-edit-checkrow"><input type="checkbox" id="dtEditIsRuined"${props.is_ruined ? " checked" : ""}> ja</label></div>`;
	const hiddenRow =
		`<div class="k">Verborgen</div><div><label class="dt-edit-checkrow"><input type="checkbox" id="dtEditIsHidden"${props.is_hidden ? " checked" : ""}> ja</label></div>`;
```

und in `propertiesHtml` `<div class="dt-grid dt-edit-grid">` → `<div class="dt-grid dt-grid--wiki dt-edit-grid">`.

In `js/review/__tests__/verborgen-editorformen.test.js:59` die Zusicherung ersetzen durch:

```js
assert.ok(/> Verborgen<\/label>|<div class="k">Verborgen<\/div>/.test(siedlungseditor), "dem Siedlungseditor fehlt die Beschriftung „Verborgen“");
```

- [ ] **Step 5: Innerorts-Zeilen** — direkt vor `function buildLocationGroupHtml(detail) {` einfügen:

```js
// ---- Innerorts und „Gehört zu" (Entwurf 2026-09-15-wiki-ort-override §0.2, §0.5) -------------
// 🔴 Die Werte kommen aus dem LISTENEINTRAG (wirksam + `*_wiki`); geschrieben wird SOFORT in die
// Override-Zeile der Wiki-Seite, wie das Territorium daneben. Nur BAUWERKE, und nur mit Wiki-Seite.
let ortPickerOpen = false;
let ortPickerQuery = "";

function settlementInnerortsTitel(item) {
	return String((item && (item.wiki_title || (item.public_id ? "" : item.name))) || "");
}

function settlementOrtPickerTreffer() {
	const q = ortPickerQuery.trim().toLowerCase();
	return settlementItems
		.filter((i) => i.on_map === true && i.public_id && !avesmapsIstBauwerksklasse(i.settlement_class)
			&& (!q || String(i.name || "").toLowerCase().includes(q)))
		.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"))
		.slice(0, 40);
}

function buildOrtPickerErgebnisseHtml() {
	const treffer = settlementOrtPickerTreffer();
	return treffer.length
		? treffer.map((i) => `<div data-ort-pick="${settlementEscape(i.public_id)}">${settlementEscape(i.name)}</div>`).join("")
		: `<div class="dt-empty">Keine Treffer.</div>`;
}

function buildInnerortsFieldsHtml(item) {
	const it = item || {};
	if (!settlementInnerortsTitel(it) || !avesmapsIstBauwerksklasse(it.settlement_class)) return "";
	const eigen = (it.override_felder || []).includes("place_scope");
	const stadtKlammer = (stadt) => (stadt ? " (" + stadt + ")" : "");
	const wikiText = (it.place_scope_label_wiki || "außerorts") + stadtKlammer(it.place_settlement_wiki);
	const wirksamText = (it.place_scope_label || "außerorts") + stadtKlammer(it.place_settlement);
	const alt = eigen && wikiText !== wirksamText
		? `<span class="wiki-alt"><span class="dt-old" title="${settlementEscape("Von uns gesetzt. Wiki-Stand: " + wikiText)}">${settlementEscape(wikiText)}</span>`
			+ `<button type="button" class="dt-reset" data-innerorts-reset="1" title="Auf Wiki-Stand zurücksetzen — nimmt auch „Gehört zu“ zurück">↺</button></span>`
		: "";
	const scope = it.place_scope || "outside";
	const auswahl = `<select id="dtInnerorts">`
		+ (scope === "ambiguous" ? `<option value="ambiguous" selected disabled>unklar</option>` : "")
		+ `<option value="inside"${scope === "inside" ? " selected" : ""}>innerorts</option>`
		+ `<option value="outside"${scope === "outside" ? " selected" : ""}>außerorts</option></select>`;
	const stadt = scope === "inside"
		? `<div class="dt-territory-row"><span>${settlementEscape(it.place_settlement || "—")}</span><span class="dt-link" data-ort-change="1" style="cursor:pointer">ändern</span></div>`
		: `<span class="dt-sub">— nur bei innerorts —</span>`;
	const verwaist = it.place_settlement_verwaist
		? `<div class="dt-sub">Die gewählte Stadt liegt nicht mehr auf der Karte — es gilt das Wiki.</div>`
		: "";
	const picker = ortPickerOpen
		? `<div class="dt-territory-picker"><input type="search" id="seOrtPickerSearch" placeholder="Siedlung suchen…" value="${settlementEscape(ortPickerQuery)}">`
			+ `<div class="dt-territory-results" data-ort-results="1">${buildOrtPickerErgebnisseHtml()}</div></div>`
		: "";
	return `<div class="k${eigen ? " ovr" : ""}">Innerorts${alt}</div><div>${auswahl}</div>`
		+ `<div class="k">Gehört zu</div><div>${stadt}${verwaist}${picker}</div>`;
}

function buildInnerortsGroupHtml(item) {
	const felder = buildInnerortsFieldsHtml(item);
	return felder ? `<div class="dt-grid dt-grid--wiki" id="dtInnerortsGrid">${felder}</div>` : "";
}

function settlementInnerortsEintrag() {
	return selectedWikiOnlyItem || settlementItems.find((i) => i.public_id === selectedPublicId) || null;
}

// Nur das Raster neu zeichnen -- Quellen-Editor und Wiki-Kasten bleiben montiert.
function settlementInnerortsNeuZeichnen() {
	const alt = $("dtInnerortsGrid");
	if (alt) alt.outerHTML = buildInnerortsGroupHtml(settlementInnerortsEintrag());
}

async function settlementInnerortsSchreiben(aktion, felder) {
	const titel = settlementInnerortsTitel(settlementInnerortsEintrag());
	if (!titel) return;
	try {
		await settlementDetailPost({ action: aktion, title: titel, fields: felder });
		ortPickerOpen = false;
		ortPickerQuery = "";
		await loadSettlementItems();
		if (selectedPublicId) {
			await reloadSettlementDetail();
		} else {
			const frisch = settlementItems.find((i) => !i.public_id && (i.wiki_title || i.name) === titel);
			if (frisch) selectSettlementRow(frisch, rowSelectionKey(frisch));
		}
	} catch (error) {
		const body = $("seDetailBody");
		if (body) body.insertAdjacentHTML("afterbegin", settlementDetailErrorHtml(error && error.message ? error.message : String(error)));
	}
}

// „innerorts" gewaehlt: nennt das Wiki eine Stadt, die auf der Karte liegt, wird sie genommen; sonst
// oeffnet sich der Picker, und geschrieben wird erst bei der Wahl.
async function applyInnerortsWahl(wert) {
	if (wert === "outside") return settlementInnerortsSchreiben("set_field_override", { place_scope: "outside" });
	const wikiStadt = String((settlementInnerortsEintrag() || {}).place_settlement_wiki || "").toLowerCase();
	const treffer = wikiStadt
		? settlementItems.find((i) => i.on_map === true && i.public_id && !avesmapsIstBauwerksklasse(i.settlement_class)
			&& String(i.name || "").toLowerCase() === wikiStadt)
		: null;
	if (treffer) return settlementInnerortsSchreiben("set_field_override", { place_scope: "inside", place_settlement_public_id: treffer.public_id });
	ortPickerOpen = true;
	ortPickerQuery = "";
	settlementInnerortsNeuZeichnen();
}

function applyOrtPick(publicId) {
	return settlementInnerortsSchreiben("set_field_override", { place_scope: "inside", place_settlement_public_id: publicId });
}

function applyInnerortsZuruecksetzen() {
	return settlementInnerortsSchreiben("clear_field_override", ["place_scope"]);
}
```

`buildLocationGroupHtml` ersetzen durch:

```js
function buildLocationGroupHtml(detail) {
	const eintrag = settlementItems.find((i) => i.public_id === detail.public_id) || null;
	return `<div class="dt-grp">Lage &amp; Zugehörigkeit<span class="dt-grp__hint">Speichert sofort</span></div>`
		+ `<div class="dt-grid">${buildTerritoryFieldHtml(detail)}</div>`
		+ buildInnerortsGroupHtml(eintrag);
}
```

In `buildWikiOnlySettlementDetailHtml` (Task 5) vor dem Satz `Nur im Wiki — noch nicht auf der Karte …` einfügen:

```js
		(buildInnerortsGroupHtml(it)
			? `<div class="dt-grp">Lage &amp; Zugehörigkeit<span class="dt-grp__hint">Speichert sofort</span></div>${buildInnerortsGroupHtml(it)}`
			: "") +
```

In `renderSettlementDetail` und `renderWikiOnlySettlementDetail` jeweils neben `territoryPickerQuery = "";` ergänzen: `ortPickerOpen = false; ortPickerQuery = "";`

- [ ] **Step 6: Zuhörer** — im Dokument-`click` unter dem `#dtWoSave`-Zweig (Task 5):

```js
	if (event.target.closest && event.target.closest("[data-ort-change]")) {
		ortPickerOpen = !ortPickerOpen;
		ortPickerQuery = "";
		settlementInnerortsNeuZeichnen();
		return;
	}
	const ortPick = event.target.closest ? event.target.closest("[data-ort-pick]") : null;
	if (ortPick) {
		void applyOrtPick(ortPick.getAttribute("data-ort-pick") || "");
		return;
	}
	if (event.target.closest && event.target.closest("[data-innerorts-reset]")) {
		event.preventDefault();
		void applyInnerortsZuruecksetzen();
		return;
	}
	if (event.target.closest && event.target.closest("[data-ruine-reset]")) {
		event.preventDefault();
		const eintrag = settlementItems.find((i) => i.public_id === selectedPublicId);
		if ($("dtEditIsRuined") && eintrag) $("dtEditIsRuined").checked = eintrag.is_ruined_wiki === true;
		setSettlementEditMsg("Aus dem Wiki übernommen — noch nicht gespeichert.", "");
		return;
	}
```

Im Dokument-`input`-Zuhörer vor dessen schliessender `});` ergänzen:

```js
	if (event.target.id === "seOrtPickerSearch") {
		ortPickerQuery = event.target.value || "";
		const host = $("seDetailBody")?.querySelector("[data-ort-results]");
		// Nur die Trefferliste neu -- das Suchfeld behaelt Fokus und Schreibmarke.
		if (host) host.innerHTML = buildOrtPickerErgebnisseHtml();
	}
```

Unter dem Wappen-`change`-Zuhörer (~3022) einen neuen anfügen:

```js
// Innerorts-Auswahl: speichert sofort (Entwurf 2026-09-15 §0.5).
document.addEventListener("change", (event) => {
	if (event.target && event.target.id === "dtInnerorts") void applyInnerortsWahl(event.target.value);
});
```

- [ ] **Step 7: Tests grün, Nachbarn grün**

Run: `for t in js/pages/__tests__/ort-innerorts-zeilen.test.js js/pages/__tests__/ort-fehlt-formular.test.js js/review/__tests__/verborgen-editorformen.test.js js/pages/__tests__/editor-abschnittsreihenfolge.test.js js/pages/__tests__/ort-wiki-override-form.test.js js/ui/__tests__/wiki-assign-ort.test.js js/pages/__tests__/ortsliste-auswahl-wandert.test.js; do node "$t" >/dev/null || echo "ROT: $t"; done`
Expected: keine Ausgabe.

- [ ] **Step 8: Mutationsprobe** — in `buildInnerortsFieldsHtml` `!avesmapsIstBauwerksklasse(it.settlement_class)` löschen → rot („eine Siedlung liegt nicht in einer Siedlung") → zurück. In `applyInnerortsZuruecksetzen` `["place_scope"]` → `["place_settlement_public_id"]` → rot → zurück.

- [ ] **Step 9: Design-Prüfung** — Agent `usability-design` gegen `docs/wiki-ort-override-mockup.html` §1/§2 (hell **und** dunkel), Agent `usability-konsistenz` gegen den Entwurf; Befunde abarbeiten.

- [ ] **Step 10: Browser-Abnahme (Ablauf)** — platziertes Bauwerk mit Innerorts-Urteil öffnen („Gut Menzheim") → auf „außerorts" → Liste und Stadt-Infobox „Menzheim" ohne die Stätte (nach dem Karten-Neuladen) → ↺ → wieder innerorts. Fehlt-Bauwerk → „Gehört zu" ändern → andere Stadt → Kartensuche springt dorthin. Ruine an einem platzierten Ort mit Wiki-Ruine → ↺ → speichern.

- [ ] **Step 11: Ganzes Testfeld, Commit, Push, Owner-Blick**

Commit-Betreff: `ui(orte): "Innerorts" und "Gehoert zu" sind sichtbar und ueberschreibbar -- und Ruine hat ein ↺`

---

### Task 7: Platzieren — die Overrides wandern in die Kartenzeile (unsichtbar bis zum Platzieren)

**Files:**
- Modify: `api/_internal/wiki/settlements.php` — neuer Helfer; `avesmapsWikiSettlementAuditAssignment` (~244-263); `avesmapsWikiSettlementCollectConnectTargets` (~1266-1294, Rückgabe); `avesmapsWikiSettlementAssignTo` (~1103-1181); `avesmapsWikiSettlementBulkConnect` (~1622-1675)
- Modify: `js/review/review-settlement-list.js` (`createAndAssignDraggedSettlement`, ~672-681)
- Test: `api/_internal/wiki/__tests__/settlement-wiki-override-uebernahme-test.php` (neu), `js/review/__tests__/fehlt-ziehen-titel.test.js` (erweitern)

**Interfaces:**
- Consumes: Task 3a (`…UebernahmePlan`, `…Alle`, `…Schreiben`).
- Produces: `avesmapsWikiSettlementOverrideUebernahme(PDO $pdo, string $title, array $target, array $props): array{name: string, feature_subtype: string, props: array, uebernommen: list<string>, abgelehnt: list<string>, key: string, rest: ?array}` (`$target` braucht `public_id`, `name`, `feature_subtype`; `rest === null` heisst „es gab keinen Override"). Die Antwort von `assign_to` trägt zusätzlich `uebernommen`, `abgelehnt`, `name`, `feature_subtype`.

- [ ] **Step 1: Failing Test schreiben** — `api/_internal/wiki/__tests__/settlement-wiki-override-uebernahme-test.php`

```php
<?php
declare(strict_types=1);
// Beim Platzieren wandern Name, Typ, Ruine und Verborgen in die Kartenzeile (Entwurf 2026-09-15 §5).
// 🔴 Der Test laedt settlements.php UND map/features.php zusammen -- genau das tut der Helfer zur
// Laufzeit; eine Namenskollision der beiden Bibliotheken faellt hier auf, nicht live.
if (ini_get('zend.assertions') !== '1') { fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'\n"); exit(2); }
$repoRoot = dirname(__DIR__, 4);
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';
require_once $repoRoot . '/api/_internal/map/features.php';

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { echo "UEBERSPRUNGEN (kein pdo_sqlite)\n"; exit(0); }
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    properties_json TEXT, is_active INTEGER DEFAULT 1)');
$pdo->exec('CREATE TABLE wiki_sync_pages (title TEXT, settlement_class TEXT, is_ruined INTEGER, standort TEXT)');
$pdo->exec('CREATE TABLE settlement_wiki_override (id INTEGER PRIMARY KEY AUTOINCREMENT, normalized_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, overrides_json TEXT NOT NULL, updated_by INTEGER NULL, updated_at TEXT NOT NULL)');
$pdo->exec("INSERT INTO wiki_sync_pages VALUES ('Ordenshaus bei Angbar', 'gebaeude', 0, 'bei [[Angbar]]')");
$titel = 'Ordenshaus bei Angbar';
$key = avesmapsWikiSyncCreateMatchKey($titel);
$ziel = ['public_id' => 'NEU-1', 'name' => $titel, 'feature_subtype' => 'gebaeude'];

// Ohne Override: nichts passiert, `rest` ist null.
$leer = avesmapsWikiSettlementOverrideUebernahme($pdo, $titel, $ziel, ['is_ruined' => false]);
assert($leer['rest'] === null && $leer['uebernommen'] === [] && $leer['name'] === $titel);

avesmapsSettlementWikiOverrideSchreiben($pdo, $key, $titel, ['name' => 'Ordenshaus', 'settlement_class' => 'stadtviertel', 'is_hidden' => true, 'place_scope' => 'outside'], 1);
$u = avesmapsWikiSettlementOverrideUebernahme($pdo, $titel, $ziel, ['is_ruined' => false, 'is_hidden' => false]);
assert($u['name'] === 'Ordenshaus' && $u['feature_subtype'] === 'stadtviertel');
assert($u['props']['is_hidden'] === true && $u['props']['settlement_class'] === 'stadtviertel' && $u['props']['name'] === 'Ordenshaus');
assert(($u['props']['field_origins']['name'] ?? '') === 'manual' && ($u['props']['field_origins']['feature_subtype'] ?? '') === 'manual', 'Herkunft „von uns" fehlt');
assert($u['rest'] === ['place_scope' => 'outside'], 'Innerorts bleibt an der Wiki-Seite: ' . json_encode($u['rest']));
assert($u['abgelehnt'] === []);

// Doppelter Name: nicht uebernommen, gemeldet, der Kartenname bleibt.
$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, properties_json, is_active) VALUES ('ALT', 'Ordenshaus', 'location', 'dorf', '{}', 1)");
$d = avesmapsWikiSettlementOverrideUebernahme($pdo, $titel, $ziel, ['is_ruined' => false, 'is_hidden' => false]);
assert($d['name'] === $titel && $d['abgelehnt'] === ['name'] && !in_array('name', $d['uebernommen'], true), 'Namensdoppel: ' . json_encode($d));

// Verdrahtung: BEIDE Schreiber des Nests rufen den Helfer und schreiben Name und Typ mit.
$ohneKommentare = '';
foreach (token_get_all((string) file_get_contents($repoRoot . '/api/_internal/wiki/settlements.php')) as $t) {
    if (is_array($t) && in_array($t[0], [T_COMMENT, T_DOC_COMMENT], true)) { continue; }
    $ohneKommentare .= is_array($t) ? $t[1] : $t;
}
foreach (['avesmapsWikiSettlementAssignTo', 'avesmapsWikiSettlementBulkConnect'] as $schreiber) {
    $start = strpos($ohneKommentare, 'function ' . $schreiber . '(');
    $rumpf = substr($ohneKommentare, $start, strpos($ohneKommentare, "\nfunction ", $start + 10) - $start);
    assert(str_contains($rumpf, 'avesmapsWikiSettlementOverrideUebernahme('), $schreiber . ' ruft den Helfer nicht');
    assert(str_contains($rumpf, 'avesmapsSettlementWikiOverrideSchreiben('), $schreiber . ' raeumt die Override-Zeile nicht auf');
    assert(str_contains($rumpf, 'SET name = :name, feature_subtype = :sub, properties_json = :pj'), $schreiber . ' schreibt Name/Typ nicht in die Spalten');
}
echo "settlement-wiki-override-uebernahme: alle Zusicherungen erfuellt\n";
```

- [ ] **Step 2: Laufen lassen, muss rot sein**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/settlement-wiki-override-uebernahme-test.php`
Expected: FAIL `Call to undefined function avesmapsWikiSettlementOverrideUebernahme`

- [ ] **Step 3: Helfer** — in `api/_internal/wiki/settlements.php` direkt vor `function avesmapsWikiSettlementAssignTo(` einfügen:

```php
/**
 * Die Overrides einer Wiki-Seite beim PLATZIEREN in die Kartenzeile holen (Entwurf 2026-09-15 §5).
 * 💣 EIN Helfer fuer BEIDE Schreiber des Nests (assign_to, bulk_connect) -- eine Regel, die einen von
 * zwei Schreibern bindet, ist keine Regel.
 * 🔴 Name nur, wenn er auf der Karte noch frei ist (avesmapsAssertUniqueLocationName); sonst bleibt
 * der Kartenname und die Antwort nennt `abgelehnt`. Innerorts und „Gehoert zu" bleiben an der Seite.
 * ⚠️ map/features.php wird HIER geladen, nicht am Dateikopf: diese Bibliothek haengt an vielen
 * Dump-Laeufen, die die Kartenbibliothek nie brauchen.
 */
function avesmapsWikiSettlementOverrideUebernahme(PDO $pdo, string $title, array $target, array $props): array
{
    require_once __DIR__ . '/../map/features.php';
    $key = avesmapsWikiSyncCreateMatchKey($title);
    $override = avesmapsSettlementWikiOverrideAlle($pdo)[$key] ?? [];
    $ergebnis = ['name' => (string) ($target['name'] ?? ''), 'feature_subtype' => (string) ($target['feature_subtype'] ?? ''),
        'props' => $props, 'uebernommen' => [], 'abgelehnt' => [], 'key' => $key, 'rest' => null];
    if ($override === []) {
        return $ergebnis;
    }
    $register = $pdo->prepare('SELECT settlement_class, is_ruined FROM ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' WHERE title = :t LIMIT 1');
    $register->execute(['t' => $title]);
    $zeile = $register->fetch(PDO::FETCH_ASSOC) ?: [];
    $wiki = ['name' => $title, 'settlement_class' => (string) ($zeile['settlement_class'] ?? ''), 'is_ruined' => !empty($zeile['is_ruined']), 'is_hidden' => false];
    $karte = ['name' => $ergebnis['name'], 'settlement_class' => $ergebnis['feature_subtype'],
        'is_ruined' => !empty($props['is_ruined']), 'is_hidden' => !empty($props['is_hidden'])];
    $plan = avesmapsSettlementWikiOverrideUebernahmePlan($override, $karte, $wiki);

    $vorher = ['name' => $karte['name'], 'feature_subtype' => $karte['settlement_class']];
    $nachher = $vorher;
    foreach ($plan['setzen'] as $feld => $wert) {
        if ($feld === 'name') {
            try {
                avesmapsAssertUniqueLocationName($pdo, (string) $wert, (string) ($target['public_id'] ?? ''));
            } catch (Throwable) {
                $ergebnis['abgelehnt'][] = 'name';
                continue;
            }
            $ergebnis['name'] = (string) $wert;
            $props['name'] = (string) $wert;
            $nachher['name'] = (string) $wert;
        } elseif ($feld === 'settlement_class') {
            $ergebnis['feature_subtype'] = (string) $wert;
            $props['feature_subtype'] = (string) $wert;
            $props['settlement_class'] = (string) $wert;
            $props['settlement_class_label'] = avesmapsLocationSubtypeLabel((string) $wert);
            $nachher['feature_subtype'] = (string) $wert;
        } else {
            $props[$feld] = (bool) $wert;
        }
        $ergebnis['uebernommen'][] = $feld;
    }
    $herkunft = avesmapsFieldOriginsStempeln(is_array($props['field_origins'] ?? null) ? $props['field_origins'] : [], $vorher, $nachher, []);
    if ($herkunft !== []) {
        $props['field_origins'] = $herkunft;
    }
    $ergebnis['props'] = $props;
    $ergebnis['rest'] = array_diff_key($override, array_flip($plan['entfernen']));
    return $ergebnis;
}
```

- [ ] **Step 4: Protokoll kennt den neuen Namen** — Signatur von `avesmapsWikiSettlementAuditAssignment` um zwei optionale Parameter erweitern und `after_json` daraus bauen:

```php
function avesmapsWikiSettlementAuditAssignment(PDO $pdo, array $beforeRow, array $newProps, int $revision, int $userId, ?string $neuerName = null, ?string $neuerTyp = null): void {
```

Im `avesmapsWikiSyncEncodeJson([...])` von `after_json`:

```php
            // 🔴 Bei einer Uebernahme (Entwurf 2026-09-15 §5) der NEUE Name -- sonst verweigert der
            // Undo-Riegel die Ruecknahme (locations-helpers.php, Kommentar am Zwilling).
            'name' => $neuerName ?? (string) ($beforeRow['name'] ?? ''),
            'feature_subtype' => $neuerTyp ?? (string) ($beforeRow['feature_subtype'] ?? ''),
```

- [ ] **Step 5: `assign_to`** — in `avesmapsWikiSettlementAssignTo`:

(a) `"SELECT id, name, properties_json FROM map_features` → `"SELECT id, public_id, name, feature_subtype, properties_json FROM map_features`.

(b) Die zwei Zeilen

```php
    $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
    $update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $target['id']]);
    avesmapsWikiSettlementAuditAssignment($pdo, $auditBefore, $props, $revision, $userId);
```

ersetzen durch:

```php
    // 🔴 Die Overrides der Wiki-Seite wandern mit (Entwurf 2026-09-15-wiki-ort-override §5).
    $uebernahme = avesmapsWikiSettlementOverrideUebernahme($pdo, (string) $settlement['title'], $target, $props);
    $props = $uebernahme['props'];
    $update = $pdo->prepare('UPDATE map_features SET name = :name, feature_subtype = :sub, properties_json = :pj, revision = :rev WHERE id = :id');
    $update->execute(['name' => $uebernahme['name'], 'sub' => $uebernahme['feature_subtype'],
        'pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => (int) $target['id']]);
    avesmapsWikiSettlementAuditAssignment($pdo, $auditBefore, $props, $revision, $userId, $uebernahme['name'], $uebernahme['feature_subtype']);
    if ($uebernahme['rest'] !== null) {
        avesmapsSettlementWikiOverrideSchreiben($pdo, $uebernahme['key'], (string) $settlement['title'], $uebernahme['rest'], $userId);
    }
```

(c) Im Rückgabe-Array des Nicht-Trockenlaufs nach `'revision' => $revision,` ergänzen:

```php
        'name' => $uebernahme['name'],
        'feature_subtype' => $uebernahme['feature_subtype'],
        'uebernommen' => $uebernahme['uebernommen'],
        'abgelehnt' => $uebernahme['abgelehnt'],
```

- [ ] **Step 6: `bulk_connect`** — in `avesmapsWikiSettlementCollectConnectTargets` das Ziel um `'feature_subtype' => (string) ($r['feature_subtype'] ?? ''),` ergänzen. In `avesmapsWikiSettlementBulkConnect`:

```php
    $update = $pdo->prepare('UPDATE map_features SET name = :name, feature_subtype = :sub, properties_json = :pj, revision = :rev WHERE id = :id');
```

und im Schleifenrumpf die Zeile `$update->execute(['pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $t['id']]);` ersetzen durch:

```php
        $uebernahme = avesmapsWikiSettlementOverrideUebernahme($pdo, (string) $settlement['title'],
            ['public_id' => $t['public_id'], 'name' => $t['name'], 'feature_subtype' => $t['feature_subtype']], $props);
        $props = $uebernahme['props'];
        $update->execute(['name' => $uebernahme['name'], 'sub' => $uebernahme['feature_subtype'],
            'pj' => avesmapsWikiSyncEncodeJson($props), 'rev' => $revision, 'id' => $t['id']]);
        if ($uebernahme['rest'] !== null) {
            avesmapsSettlementWikiOverrideSchreiben($pdo, $uebernahme['key'], (string) $settlement['title'], $uebernahme['rest'], 0);
        }
```

- [ ] **Step 7: Ziehen meldet einen abgelehnten Namen** — in `createAndAssignDraggedSettlement` nach `if (assignResult && assignResult.ok === true) {` einfügen:

```js
			// Der eigene Name der Fehlt-Zeile wurde nicht uebernommen, weil ein Ort so schon heisst
			// (Entwurf 2026-09-15 §5). Sagen, nicht still weglassen.
			if (Array.isArray(assignResult.abgelehnt) && assignResult.abgelehnt.includes("name")) {
				showFeedbackToast?.("Der eigene Name wurde nicht übernommen — einen Ort mit diesem Namen gibt es schon.", "warning");
			}
```

In `js/review/__tests__/fehlt-ziehen-titel.test.js` vor der `console.log`-Zeile:

```js
assert.ok(quelle.includes('assignResult.abgelehnt.includes("name")'), "ein abgelehnter Name wird beim Ziehen nicht gemeldet");
```

- [ ] **Step 8: Tests grün, Nachbarn grün**

Run: `for t in api/_internal/wiki/__tests__/settlement-wiki-override-uebernahme-test.php api/_internal/map/__tests__/ort-wiki-no-article-test.php api/_internal/wiki/__tests__/wiki-interaktiv-drossel-test.php api/_internal/map/__tests__/audit-redo-test.php api/_internal/map/__tests__/undo-stellt-feature-type-zurueck-test.php api/_internal/map/__tests__/field-origins-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null 2>&1 || echo "ROT: $t"; done; node js/review/__tests__/fehlt-ziehen-titel.test.js && node js/review/__tests__/settlement-wiki-pending-assign.test.js`
Expected: keine `ROT`-Zeile, zwei grüne Node-Läufe.

- [ ] **Step 9: Mutationsprobe** — in `avesmapsWikiSettlementBulkConnect` den Helfer-Aufruf entfernen (`$uebernahme = […]` durch `$uebernahme = ['name' => $t['name'], 'feature_subtype' => $t['feature_subtype'], 'props' => $props, 'rest' => null];` ersetzen) → Verdrahtung rot → zurück. Im Helfer `catch (Throwable)`-Zweig `continue;` löschen → Namensdoppel-Zusicherung rot → zurück.

- [ ] **Step 10: Ablauf-Abnahme** — eine Fehlt-Zeile (Task 5) umbenennen, dann aus der Panel-Liste auf die Karte ziehen → der Ort heisst wie der Override, Typ stimmt, Innerorts steht weiter in „Lage & Zugehörigkeit", die Override-Zeile trägt nur noch `place_scope`. ↺-Protokoll: „Änderungen" zeigt den neuen Namen.

- [ ] **Step 11: Ganzes Testfeld, Commit, Push**

Commit-Betreff: `feat(orte): beim Platzieren wandern Name, Typ, Ruine und Verborgen einer Fehlt-Zeile mit`

---

### Task 8: AGENTS.md, Abschlussprüfung, Owner-Abnahme

**Files:**
- Modify: `AGENTS.md` §11 — neuer Eintrag direkt **nach** dem Eintrag, der mit `- **Der Wiki-Override — was gesynct ist und was von uns.**` beginnt
- Modify: `docs/superpowers/specs/2026-09-15-wiki-ort-override-design.md` (Kopf: „gebaut am …, Commits …")

- [ ] **Step 1: AGENTS.md-Eintrag** (eine Zeile, wie die Nachbarn):

```markdown
- **Wiki-Orte ohne Kartenpunkt überschreiben — Innerorts, „Gehört zu" und das ↺ bei leerem Wiki.** Entwurf **`docs/superpowers/specs/2026-09-15-wiki-ort-override-design.md`**, Bauplan `docs/superpowers/plans/2026-09-15-wiki-ort-override.md`, Mockup `docs/wiki-ort-override-mockup.html`. Eine Fehlt-Zeile des Orts-Editors ist bearbeitbar (Name, Typ, Ruine, Verborgen), Innerorts und „Gehört zu" sind für platzierte und nicht platzierte Bauwerke sichtbar und überschreibbar. 🔴 **Eine Override-Zeile je Wiki-Seite** (`settlement_wiki_override`, Schlüssel `normalized_key` = `avesmapsWikiSyncCreateMatchKey(title)`, Bibliothek `api/_internal/wiki/settlement-wiki-override.php`); Wert gleich Wiki → Schlüssel fällt weg, leeres Objekt → Zeile fällt weg. ⚠️ Nicht `settlement_place`: die kann nur „liegt in X", nie „liegt nirgends". 💣 **EIN Eingang für alle Leser** (`avesmapsSettlementWikiEffektiv`): beide Ortslisten, Kartensuche „X in Stadt", Zeile „Stätten", Suche „nicht auf der Karte" — ein Override, der nur einen Teil erreicht, ist schlimmer als keiner. Wege bleiben aussen vor. 💣 **Der Name ist nur Anzeige**: `$seen`, „liegt schon auf der Karte?" und der Override-Schlüssel rechnen mit dem Wiki-Titel — deshalb zieht die Panel-Liste mit `wiki_title`, nie mit `name`. 🔴 **„Gehört zu" bindet die `public_id`**, nie den Namen; eine verschwundene Stadt lässt das Wiki-Urteil ganz gelten (`place_settlement_verwaist`). 🔴 **Innerorts/„Gehört zu" bleiben an der Wiki-Seite**, Name/Typ/Ruine/Verborgen wandern beim Platzieren in die Kartenzeile — über EINEN Helfer in beiden Nest-Schreibern (`assign_to`, `bulk_connect`); ein doppelter Name wird nicht übernommen und als `abgelehnt` gemeldet. 💣 **Stempel**: `avesmapsSettlementWikiOverrideReadStamp` hängt am `$placesStamp` der Kartennutzlast und ist bei leerer Tabelle LEER. 💣 **Verborgene platzierte Bauwerke** fehlen in „Stätten" über eine eigene schmale Abfrage, nie aus den geladenen Kartenzeilen (bbox-Ausschnitt). ⚠️ Schreibaktionen `set_field_override`/`clear_field_override` verlangen `edit` (der Endpunkt selbst nur `review`), Fehler als `RuntimeException`. 🔴 **Das ↺ bei leerem Wiki** (Owner 15.09.2026, „wär schön, wenn das immer gelten würde"): `avesmapsWikiFeldStand` meldet „von uns gesetzt, Wiki leer" als Abweichung, das ↺ leert; nie bei unbekannter Herkunft, nie bei `leerbar: false` im Feldregister (Pflicht- und Auswahlfelder) — wer ein Feld als Auswahl baut, markiert es dort (`wiki-feld-leerbar.test.js`). Tests: `settlement-wiki-override-test.php`, `…-aktion-test.php`, `…-uebernahme-test.php`, `innerorts-override-leser-test.php`, `editor-liste-override-test.php`, `ort-fehlt-formular.test.js`, `ort-innerorts-zeilen.test.js`, `wiki-feld-leerbar.test.js`. 🔧 **Offen:** Kasten „Wiki-Ort" zeigt die Ortsgröße als Schlüssel (eigener Folgeauftrag); Waisenbericht für Override-Zeilen umbenannter Wiki-Seiten; Protokoll im Fenster „Änderungen"; die Kartensuche liest `settlement_place` nicht.
```

- [ ] **Step 2: Entwurf abschliessen** — unter die Überschrift des Entwurfs eine Zeile: `**Gebaut** am <Datum>, Commits <SHA-Liste>. Abweichungen vom Entwurf: siehe „Korrekturen am Entwurf" im Bauplan.`

- [ ] **Step 3: Ganzes Testfeld nach dem Muster des Workflows, Dateizahl gegenzählen**

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
```

Beide Zahlen müssen um die neuen Tests gewachsen sein (+5 JS: `ortsliste-innerorts-zeile`, `wiki-feld-leerbar`, `fehlt-ziehen-titel`, `ort-fehlt-formular`, `ort-innerorts-zeilen`; +6 PHP: `editor-liste-innerorts`, `settlement-wiki-override`, `innerorts-override-leser`, `editor-liste-override`, `settlement-wiki-override-aktion`, `settlement-wiki-override-uebernahme`). Dann parallel fahren (AGENTS.md §9), `ROT`-Liste leer, einzig vorbestehend rot `linkcheck/link-url-test.php`.

- [ ] **Step 4: Owner-Abnahme als Ablauf** (in der Editor-Sitzung, nach dem letzten Deploy, Konsole der Karte als Besucher gelesen):
  1. Fehlt-Zeile „Ordenshaus der Rohalswächter bei Angbar" → Liste sagt „○ nur Wiki · unklar (Angbar)".
  2. Innerorts auf „außerorts" → Liste „außerorts", Suche findet es unter „nicht auf der Karte".
  3. Name ändern → speichern → Liste zeigt den Namen, Suche findet beide Namen → ↺ → speichern → zurück.
  4. Eine innerorts-Stätte auf „Verborgen" → Stadt-Infobox ohne sie, Suche per Name mit ihr.
  5. „Gehört zu" auf eine andere Stadt → Suchtreffer springt dorthin.
  6. Die umbenannte Fehlt-Zeile aufs Kartenbild ziehen → Name und Typ kommen mit, Innerorts bleibt.
  7. Platzierter Ort: Herrscher selbst setzen, Wiki leer → ↺ erscheint und leert; im Literatur-Editor dasselbe an „Serie / Reihe"; im Wege-Editor am Wegtyp **kein** solches ↺.
  8. Platziertes Bauwerk auf „Verborgen" → Stadt-Infobox ohne die Stätte.

- [ ] **Step 5: Commit, Push** — Betreff: `docs(agents): Wiki-Orte ohne Kartenpunkt -- ein Eingang fuer Innerorts, die Uebernahme beim Platzieren, das ↺ bei leerem Wiki`

---

## Selbstprüfung gegen den Entwurf

| Entwurf | Task |
|---|---|
| §0.1 Fehlt-Zeile: Name, Typ, Ruine, Verborgen mit ↺ | 3c, 4, 5 |
| §0.2 Innerorts/„Gehört zu" sichtbar und überschreibbar, beide Ortsarten | 3a–3c, 4, 6 |
| §0.3/§0.8 ↺ bei „von uns, Wiki leer", überall | 2 |
| §0.4 verborgene nicht platzierte Stätte fehlt in „Stätten", bleibt in der Suche | 3b |
| §0.5 sofort speichern, Hinweis „Speichert sofort" | 6 |
| §0.6 Kasten „Wiki-Ort" nur platziert | 5 (kein Kasten im Fehlt-Formular) |
| §0.7 Name = Anzeige-Override, Titel = Schlüssel | 1 (Auswahlschlüssel), 3b, 3c, 5 |
| §0.9 verborgene platzierte Bauwerke fehlen in „Stätten" | 3b |
| §1 Nebenbefund Liste ohne Innerorts-Urteil | 1 |
| §2 Ablage, Wert gleich Wiki fällt weg, public_id, DDL nur im Schreibweg | 3a, 4 |
| §3 ein Eingang, alle Leser, ETag-Stempel | 3a–3c |
| §4 Schreibaktionen, `edit` | 4 |
| §5 Übernahme beim Platzieren, beide Schreiber | 7 |
| §6 Oberfläche, Liste, Kasten-Beschriftung | 1, 5, 6; Beschriftung → Folgeauftrag |
| §8 Prüfung/Abnahme | alle Tasks, 8 |
| §9 Offen | 8 (AGENTS-Eintrag) |
