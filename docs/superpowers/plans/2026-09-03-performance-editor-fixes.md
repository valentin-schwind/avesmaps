# Performance-Fixes Editor und Takt-Endpunkte — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die neun am 03.09.2026 gemessenen Dauerlasten des Editors und der Takt-Endpunkte abbauen, ohne eine sichtbare Funktion zu ändern.

**Architecture:** Jede Aufgabe ist ein eigener Riegel an genau einer Stelle: eine Liste wird erst beim Öffnen gebaut, ein Delta trägt keine globalen Blöcke, ein Pan holt die Ebene nicht neu, ein Sperr-Timer entsteht nur für eine Sperre, die es noch gibt, ein DDL läuft je Stunde statt je Aufruf. Kein Umbau, keine neue Tabelle, keine sichtbare Änderung.

**Tech Stack:** Vanilla JS (kein Build), PHP 8 strict_types, MySQL auf STRATO; Tests als `node`-Skripte in `__tests__/` und `php -d zend.assertions=1`.

**Spec:** Dieser Plan, Abschnitt „Befunde“. Es gibt keinen eigenen Entwurf; die Messungen stehen hier, damit jede Aufgabe gegen ihre Zahl geprüft werden kann.

## Befunde (Live gemessen 03.09.2026, Besucher im Browser-Pane, Editor im eingeloggten Chrome)

| Befund | Zahl | Aufgabe |
|---|---|---|
| Editor-DOM beim Start 71.322 Knoten, davon 62.607 in `#wiki-sync-conflicts-overlay` (hidden): 4.220 `.wiki-sync-case`, 13.642 Knöpfe | Besucher: 5.461 Knoten | 1 |
| `map-features.php?since_revision=<aktuell>&edit_mode=1` liefert 0 Features, aber 6,47 MB in 1,13 s (Katalog, ~13k Verweise, Kanon, Innerorts-Objekte) | alle 15 s nach fremder Speicherung | 2 |
| Politische Ansicht im Editor: EIN Pan = 8 Anfragen, ~6,5 MB (Ebene 917 KB + 6 Nachbarzooms je ~900 KB / 1–3 s + `list` 297 KB); Standardansicht: 0 Anfragen | je moveend | 3 |
| `acquireFeatureSoftLock` + sofortiges `releaseFeatureSoftLock` lässt den 45-s-Timer für immer stehen (bestätigt) | je Objekt | 4 |
| Meldungsliste: je 45 s `CREATE TABLE` + 5× `SHOW COLUMNS` + `SHOW TABLES`; `acquire_lock`: 2× `CREATE TABLE IF NOT EXISTS`; audit-log: `SHOW COLUMNS`; politischer Endpunkt: 13 DDL-Statements je Nicht-Cache-Treffer | je Takt | 5 |
| `api_metric`: zwei Upserts je Request, alle Besucher auf derselben „aufraeumen“-Zeile | je Request | 6 |
| Meldungs-Poll läuft in versteckten Tabs weiter (11 Abrufe in 10 min ohne Betrachter) | je 45 s | 7 |
| `POLITICAL_LAYER_CACHE` (api-client) hat keinen Verfall; im Editor je Zoom eine Ebene mit 4–5 MB JSON, nur nach Speicherung geleert | je Zoom × Jahr | 8 |
| Grenz-Canvas pollt alle 200 ms über alle `regionData`, auch für Besucher und versteckte Tabs | 5×/s | 9 |

Nicht belegt und deshalb NICHT im Plan: ein Speicherleck im Besucherpfad (drei Simulationen mit 120 Interaktionen, DOM/Layer/Listener konstant).

## Nachher (live gemessen 03.09.2026 abends, nach allen neun Aufgaben)

| Messung | Vorher | Nachher |
|---|---|---|
| DOM-Knoten im Editor beim Start | 71.322 (62.607 im `hidden`-Overlay) | **10.091** (0 Faelle im Overlay; Daten weiterhin 4.185) |
| Delta-Abruf `?since_revision=<aktuell>&edit_mode=1`, 0 Features | 6.474.261 Bytes / 1,13 s | **1.626 Bytes / 0,19 s** |
| Anfragen je Pan, politische Ansicht im Editor | 8 Anfragen / ~6,5 MB | **0 Anfragen / 0 Bytes** |

Gegenproben, damit die Zahlen nicht durch Weglassen entstanden sind:

- Ein Delta MIT Aenderungen liefert weiterhin vollstaendige Objekte (371 Features, 460 KB, `geometry` + `properties` + `public_id` vorhanden).
- Der Vollabruf ist unveraendert: 12.216 Features, 1.438 Katalogzeilen, 6.387 Verweise, 9 Korpora, 3.561 Innerorts-Objekte, 654 Kanon-Abweichungen.
- Zoomwechsel in der politischen Ansicht: weiterhin genau EINE Ebenenanfrage; ein Jahr aus der Zeitleiste: eine plus Fan-out-Buendel (7).
- Besucher-Tab, fuenf Zoomschritte 3↔4: 0 zusaetzliche Ebenenanfragen (der geparste Speicher des Loaders traegt die Ansicht).
- Sperre: acquire + sofort release laesst 60 s lang KEINE weitere Anfrage stehen; der Normalfall zeigt Timer-Kennung und ein `release_lock`.
- Meldungs-Poll: 100 s im versteckten Tab (2+ Takte) = 0 Abrufe.
- `POLITICAL_LAYER_CACHE` nach drei Zoomstufen im Abstand von 10 s: 1 Zusage statt 3.
- Grenz-Canvas: eine Aenderung an `regionData` zieht binnen 1,6 s nach, Ruhe zeichnet nicht, versteckter Tab pollt gar nicht.
- Alle vier DDL-gebundenen Oberflaechen antworten HTTP 200 (Meldungsliste, Aenderungsverlauf, politische Ebene, Sperr-Pfad).

🪤 **Aufgabe 1 ging zweimal live.** Beim ersten Mal fror der Editor-Tab nach dem Klick auf „⚖️ Konflikte" ein; der Commit wurde sofort zurueckgerollt (Regel: eine gescheiterte Live-Gegenprobe wird revertiert, nicht diskutiert). Vier Gegenmessungen danach — Rendern in ein SICHTBARES Overlay 123/130/132 ms, Oeffnen auf der alten Fassung 28 ms, dieselbe Kombination inklusive erstmaligem `loadConflicts()` ohne Hänger — haben den Hänger nicht reproduziert; die Aufgabe wurde wieder eingespielt und misst seither 179 ms beim Oeffnen. **Ein einzelnes Einfrieren ist noch kein Befund; die Zahl daneben ist einer.**

## Global Constraints

- Kommentare, Commit-Betreff und Doku auf Deutsch; `error.code`-Werte bleiben Englisch (AGENTS.md §8).
- Conventional-Commit-Präfix `perf:` oder `fix:`, ein Scope-Wort je Feature.
- **Nie `git add -A`, nie `git commit -a`** — nur die in der Aufgabe genannten Pfade stagen, `git add` und `git commit` in EINEM Zug (AGENTS.md §9). Vorher `git status`, fremde Dateien bleiben liegen.
- **Vor jedem Push das GANZE Testfeld**, beide Workflow-Muster, parallel (AGENTS.md §9):
  ```bash
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste-js
  find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste-php
  cat roteliste-js roteliste-php
  ```
  Erwartet: nur `tools/linkcheck/link-url-test.php` rot (echter DNS-Abruf). Gegenprobe der Dateizahl: `… -print0 | tr -dc '\0' | wc -c` muss mindestens 312 (JS) und 310 (PHP) ergeben.
- Ein Commit je Aufgabe, dann Push, dann **den Deploy abwarten** (`git ls-remote origin master` gegen `git rev-parse HEAD`, ~2 min), dann die Live-Gegenprobe der Aufgabe. Kein zweiter Push, solange der Lauf des ersten läuft (AGENTS.md §9, abgebrochener Lauf lädt nichts hoch).
- Kein `?v=` von Hand; `ASSET_VERSION` bleibt unberührt (kein Editor-Asset des Inline-Hosts wird angefasst).
- Quelltext-Tests lesen zeilenendenneutral (`.split("\r\n").join("\n")`), die Arbeitskopie trägt CRLF, das Deploy-Tor LF.
- PHP: kein DDL innerhalb einer Transaktion (MySQL committet implizit); bei Konflikt SQLite/MySQL gilt MySQL.
- STRATO: Live-Gegenproben mit EINZELNEN Anfragen, nie in einer Schleife.

---

### Task 1: WikiSync-Fälle erst beim Öffnen des Konfliktfensters rendern

**Files:**
- Modify: `js/review/review-wiki-sync-cases.js` (Kopf von `renderWikiSyncCases`, neue Helfer davor)
- Modify: `js/review/review-wiki-sync.js` (`setWikiSyncConflictsDialogOpen`, direkt nach dem Einblenden)
- Test: `js/review/__tests__/wikisync-faelle-erst-beim-oeffnen.test.js`

**Interfaces:**
- Consumes: `renderWikiSyncCases(latestRun = null)` (bestehend), `setWikiSyncConflictsDialogOpen(isOpen)` (bestehend), das Overlay `#wiki-sync-conflicts-overlay` mit `hidden`.
- Produces: `wikiSyncCaseListVerborgen(): boolean`, `renderWikiSyncCasesWennAusstehend(): void`, Modulzustand `wikiSyncLatestRun`, `wikiSyncCasesRenderAusstehend`.

Hintergrund: `bootstrap.js:666` ruft `loadWikiSyncCases()` beim Editor-Start; die Daten (`wikiSyncCases`) braucht das Konfliktzentrum (`review-conflicts.js`, `getLegacyConflicts`) und bleiben. Nur das BAUEN der 4.220 Zeilen in `#wiki-sync-case-list` wird verschoben, bis das Overlay sichtbar ist. Die Liste liegt in `index.html` (Zeile 1665) innerhalb des Overlays (Zeile 1636). Außerhalb des Renderers liest nur `review-settlement-list.js:589` das Element, und das setzt lediglich `dataset.activeStatus`.

- [ ] **Step 1: Test schreiben**

```js
// js/review/__tests__/wikisync-faelle-erst-beim-oeffnen.test.js
// Die 4.220 WikiSync-Faelle werden erst gebaut, wenn das Konfliktfenster sichtbar ist.
//
// 💣 Gemessen 03.09.2026 im eingeloggten Editor: 62.607 DOM-Knoten in einem `hidden`-Overlay beim
// Start, 82 % des gesamten Editor-DOMs -- und jeder Selektorlauf der Karte ging seither ueber sie.
// Der Test FAEHRT den Renderer mit einer Dokument-Attrappe, statt seinen Quelltext zu lesen.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/wikisync-faelle-erst-beim-oeffnen.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const cases = lies("js/review/review-wiki-sync-cases.js");
const sync = lies("js/review/review-wiki-sync.js");

// --- Umgebung -----------------------------------------------------------------------------------
let overlayHidden = true;
const listKinder = [];
const overlay = { get hidden() { return overlayHidden; } };
const listElement = { innerHTML: "", querySelectorAll: () => [], appendChild: (k) => { listKinder.push(k); } };
global.document = {
	getElementById: (id) => (id === "wiki-sync-conflicts-overlay" ? overlay : (id === "wiki-sync-case-list" ? listElement : null)),
	querySelectorAll: () => [],
};
global.window = { requestAnimationFrame: (fn) => fn() };
global.wikiSyncCases = [{ status: "open", name: "A" }];
global.wikiSyncFilterQuery = "";
global.wikiSyncFilterCollapseRequested = false;
global.isWikiSyncAccordionRestoring = false;
let kopfzeilen = 0;
global.syncWikiSyncPanelHeaderState = () => { kopfzeilen += 1; };
global.syncWikiSyncFilterControls = () => {};
global.setWikiSyncStatus = () => {};
global.buildWikiSyncStatusMessage = (m) => m;
global.getWikiSyncFilterQuery = () => "";
global.getWikiSyncFilteredCases = (c) => c;
global.getWikiSyncOpenGroupKeys = () => [];
global.restoreWikiSyncAccordionState = () => {};
let sektionen = 0;
global.renderWikiSyncCaseSection = (list, title, key, faelle) => {
	if (faelle.length < 1) { return null; }
	sektionen += 1;
	const el = { key };
	list.appendChild(el);
	return el;
};

// --- Die ECHTEN Bauteile ------------------------------------------------------------------------
vm.runInThisContext(schnitt(cases, "let wikiSyncLatestRun", ""));
vm.runInThisContext(schnitt(cases, "let wikiSyncCasesRenderAusstehend", ""));
vm.runInThisContext(schnitt(cases, "function wikiSyncCaseListVerborgen", "}"));
vm.runInThisContext(schnitt(cases, "function renderWikiSyncCases(", "}"));
vm.runInThisContext(schnitt(cases, "function renderWikiSyncCasesWennAusstehend", "}"));

// 1) Versteckt: nichts gebaut, aber die Kopfzeile des Panels laeuft, und der Bedarf ist gemerkt.
renderWikiSyncCases({ public_id: "lauf-1" });
assert.strictEqual(sektionen, 0, "verstecktes Overlay -> keine Sektion gebaut");
assert.strictEqual(listKinder.length, 0, "verstecktes Overlay -> kein Kind in der Liste");
assert.strictEqual(kopfzeilen, 1, "die Panel-Kopfzeile wird trotzdem nachgezogen");
assert.strictEqual(wikiSyncCasesRenderAusstehend, true, "der Bedarf ist gemerkt");
assert.deepStrictEqual(wikiSyncLatestRun, { public_id: "lauf-1" }, "der Lauf ist gemerkt");

// 2) Beim Oeffnen wird EINMAL gebaut, mit dem gemerkten Lauf.
overlayHidden = false;
renderWikiSyncCasesWennAusstehend();
assert.strictEqual(sektionen, 1, "nach dem Oeffnen genau eine Sektion");
assert.strictEqual(wikiSyncCasesRenderAusstehend, false, "der Bedarf ist erledigt");

// 3) Ohne Bedarf baut der Nachzug nichts.
renderWikiSyncCasesWennAusstehend();
assert.strictEqual(sektionen, 1, "kein zweiter Bau ohne Bedarf");

// 4) Sichtbar: der normale Aufruf baut sofort.
renderWikiSyncCases();
assert.strictEqual(sektionen, 2, "sichtbares Overlay -> sofort gebaut");

// 5) Der Oeffner ruft den Nachzug NACH dem Einblenden -- vorher waere das Overlay noch hidden.
const reihenfolge = [];
global.$ = () => ({ prop: (name, wert) => { reihenfolge.push(name + "=" + wert); } });
global.syncModalDialogBodyState = () => {};
global.renderWikiSyncCasesWennAusstehend = () => { reihenfolge.push("render"); };
global.document.getElementById = (id) => (id === "wiki-sync-conflicts-dialog" ? { focus() {} } : (id === "wiki-sync-conflicts-overlay" ? overlay : listElement));
vm.runInThisContext(schnitt(sync, "function setWikiSyncConflictsDialogOpen", "}"));
setWikiSyncConflictsDialogOpen(true);
assert.deepStrictEqual(reihenfolge, ["hidden=false", "render"], "erst einblenden, dann bauen");

console.log("OK wikisync-faelle-erst-beim-oeffnen (5 Abschnitte)");
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `node js/review/__tests__/wikisync-faelle-erst-beim-oeffnen.test.js`
Expected: FAIL mit `let wikiSyncLatestRun nicht gefunden`.

- [ ] **Step 3: Renderer umbauen**

In `js/review/review-wiki-sync-cases.js` direkt VOR `function renderWikiSyncCases(latestRun = null) {` einfügen:

```js
// Der zuletzt gemeldete Lauf -- gemerkt, damit ein NACHGEHOLTES Rendern dieselbe Kopfzeile
// („Noch kein WikiSync-Lauf …") trifft wie ein sofortiges.
let wikiSyncLatestRun = null;
// 🔴 DIE LISTE WIRD ERST GEBAUT, WENN JEMAND SIE SIEHT. Live gemessen 03.09.2026 im Editor:
// 4.220 Faelle mit 13.642 Knoepfen = 62.607 DOM-Knoten in einem `hidden`-Overlay, beim Start --
// 82 % des gesamten Editor-DOMs, und jeder Selektorlauf der Karte ging seither ueber sie hinweg.
// Die DATEN (`wikiSyncCases`) braucht das Konfliktzentrum weiterhin sofort; nur das Bauen wartet.
let wikiSyncCasesRenderAusstehend = false;

function wikiSyncCaseListVerborgen() {
	const overlay = document.getElementById("wiki-sync-conflicts-overlay");
	return Boolean(overlay && overlay.hidden);
}

// Der Nachzug -- gerufen von setWikiSyncConflictsDialogOpen(true), NACH dem Einblenden.
function renderWikiSyncCasesWennAusstehend() {
	if (!wikiSyncCasesRenderAusstehend) {
		return;
	}
	renderWikiSyncCases(wikiSyncLatestRun);
}
```

Dann den Kopf von `renderWikiSyncCases` ändern. Vorher:

```js
function renderWikiSyncCases(latestRun = null) {
	const listElement = document.getElementById("wiki-sync-case-list");
	if (!listElement) {
		return;
	}
	syncWikiSyncPanelHeaderState();

	const previousOpenGroupKeys = getWikiSyncOpenGroupKeys();
```

Nachher:

```js
function renderWikiSyncCases(latestRun = null) {
	if (latestRun !== null) {
		wikiSyncLatestRun = latestRun;
	}
	const listElement = document.getElementById("wiki-sync-case-list");
	if (!listElement) {
		return;
	}
	syncWikiSyncPanelHeaderState();
	// Verstecktes Fenster: nur merken, dass etwas zu bauen ist (siehe wikiSyncCasesRenderAusstehend).
	if (wikiSyncCaseListVerborgen()) {
		wikiSyncCasesRenderAusstehend = true;
		return;
	}
	wikiSyncCasesRenderAusstehend = false;

	const previousOpenGroupKeys = getWikiSyncOpenGroupKeys();
```

Der Rest der Funktion bleibt zeichengleich.

- [ ] **Step 4: Öffner verdrahten**

In `js/review/review-wiki-sync.js`, `setWikiSyncConflictsDialogOpen(isOpen)`: direkt nach `syncModalDialogBodyState();` und innerhalb von `if (isOpen) {` als ERSTE Zeile einfügen:

```js
		// Die Fallliste wurde beim Start nur gemerkt, nicht gebaut (review-wiki-sync-cases.js) --
		// jetzt ist das Overlay sichtbar, jetzt wird gebaut. VOR dem Fokus, damit er etwas trifft.
		if (typeof renderWikiSyncCasesWennAusstehend === "function") {
			renderWikiSyncCasesWennAusstehend();
		}
```

- [ ] **Step 5: Test laufen lassen, er muss bestehen**

Run: `node js/review/__tests__/wikisync-faelle-erst-beim-oeffnen.test.js`
Expected: `OK wikisync-faelle-erst-beim-oeffnen (5 Abschnitte)`.

- [ ] **Step 6: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add js/review/review-wiki-sync-cases.js js/review/review-wiki-sync.js js/review/__tests__/wikisync-faelle-erst-beim-oeffnen.test.js && git commit -m "perf(editor): WikiSync-Faelle erst beim Oeffnen des Konfliktfensters rendern -- 62.607 versteckte DOM-Knoten beim Editor-Start entfallen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 7: Live-Gegenprobe im Editor**

Im eingeloggten Chrome auf `https://avesmaps.de/index.html?debugMap=1&edit=1` nach dem Laden in der Konsole:

```js
document.getElementsByTagName("*").length            // erwartet: unter 12.000 (vorher 71.322)
document.querySelectorAll("#wiki-sync-conflicts-overlay .wiki-sync-case").length   // erwartet: 0
```

Dann WikiSync → „⚖️ Konflikte" öffnen und erneut zählen: `.wiki-sync-case` muss jetzt 4.000+ sein, die Fälle stehen im Fenster, Filter und Status-Reiter funktionieren.

---

### Task 2: Delta-Abruf ohne globale Blöcke

**Files:**
- Modify: `api/_internal/app/map-features-cache.php` (neuer Helfer neben `avesmapsMapFeaturesCacheEligible`)
- Modify: `api/app/map-features.php` (fünf Loader-Zeilen und ein Nutzlast-Schlüssel)
- Test: `api/_internal/app/__tests__/map-features-delta-schlank-test.php`

**Interfaces:**
- Produces: `avesmapsMapFeaturesIstDeltaAbruf(array $queryParams): bool`.

Hintergrund: Der Live-Abgleich (`pollLiveMapUpdates`, `js/routing/routing.js`) liest aus der Delta-Antwort NUR `features` und `revision`. `source_catalog`, `feature_sources`, `source_corpora`, `feature_kanon` und `in_settlement_places` werden ausschließlich im Vollabruf gelesen (`routing.js` Zeilen 604–631, im `.then` der `routeDataRequest`). Trotzdem lud der Delta-Pfad sie jedes Mal: 6,47 MB und 1,13 s für null geänderte Features.

- [ ] **Step 1: Test schreiben**

```php
<?php
// api/_internal/app/__tests__/map-features-delta-schlank-test.php
// Ein Delta-Abruf (since_revision) traegt keine globalen Bloecke.
//
// 💣 Gemessen 03.09.2026: `?since_revision=<aktuell>&edit_mode=1` lieferte 0 Features, aber 6,47 MB in
// 1,13 s -- Quellenkatalog, ~13.000 Verweise, Kanon ueber 11.500 Objekte, Innerorts-Objekte. Der
// Live-Abgleich liest davon NICHTS (js/routing/routing.js, pollLiveMapUpdates: nur features + revision).
//
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/map-features-delta-schlank-test.php
declare(strict_types=1);

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 4);
require_once $WURZEL . '/api/_internal/app/map-features-cache.php';

// ---- 1. Die Weiche ------------------------------------------------------------------------------
assert(avesmapsMapFeaturesIstDeltaAbruf(['since_revision' => '5']) === true, 'since_revision gesetzt -> Delta');
assert(avesmapsMapFeaturesIstDeltaAbruf(['since_revision' => '5', 'edit_mode' => '1']) === true, 'auch im Editor');
assert(avesmapsMapFeaturesIstDeltaAbruf([]) === false, 'ohne since_revision -> Vollabruf');
assert(avesmapsMapFeaturesIstDeltaAbruf(['since_revision' => '']) === false, 'leer heisst nicht gesetzt');
assert(avesmapsMapFeaturesIstDeltaAbruf(['since_revision' => ' ']) === false, 'Leerzeichen ebenso');
assert(avesmapsMapFeaturesIstDeltaAbruf(['bbox' => '1,2,3,4']) === false, 'bbox ist kein Delta');

// ---- 2. Der Endpunkt hängt die fünf Bloecke an die Weiche ---------------------------------------
// 🪤 Kommentare raus, sonst schlaegt der Test an der Warnung an, die vor der Falle warnt.
$quelle = (string) file_get_contents($WURZEL . '/api/app/map-features.php');
$quelle = (string) preg_replace('#/\*.*?\*/#s', '', $quelle);
$quelle = (string) preg_replace('#^\s*//.*$#m', '', $quelle);

assert(substr_count($quelle, 'avesmapsMapFeaturesIstDeltaAbruf($_GET)') === 1, 'die Weiche wird genau einmal gelesen');
foreach ([
    '$sourceCorpora = $mapFeaturesIstDelta ? [] : avesmapsLoadSourceCorporaForPayload($pdo);',
    '$sourceCatalog = $mapFeaturesIstDelta ? [] : avesmapsLoadFeatureSourceCatalog($pdo);',
    '$featureSourceRefs = $mapFeaturesIstDelta ? [] : avesmapsLoadFeatureSourceRefs($pdo);',
    '$featureKanon = $mapFeaturesIstDelta ? [] : avesmapsFeatureSourcesDeriveKanon(',
    "'in_settlement_places' => \$mapFeaturesIstDelta ? [] : avesmapsMapFeaturesInSettlementPlaces(\$pdo),",
] as $zeile) {
    assert(str_contains($quelle, $zeile), 'fehlt im Endpunkt: ' . $zeile);
}
// Kein Block darf an der Weiche vorbei geladen werden.
foreach ([
    'avesmapsLoadSourceCorporaForPayload($pdo)',
    'avesmapsLoadFeatureSourceCatalog($pdo)',
    'avesmapsLoadFeatureSourceRefs($pdo)',
    'avesmapsMapFeaturesInSettlementPlaces($pdo)',
] as $aufruf) {
    assert(substr_count($quelle, $aufruf) === 1, 'genau ein Aufruf, und der haengt an der Weiche: ' . $aufruf);
}

fwrite(STDOUT, "OK map-features-delta-schlank-test\n");
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/map-features-delta-schlank-test.php`
Expected: FAIL mit `Call to undefined function avesmapsMapFeaturesIstDeltaAbruf()`.

- [ ] **Step 3: Helfer schreiben**

In `api/_internal/app/map-features-cache.php` direkt vor `function avesmapsMapFeaturesCacheEligible(array $queryParams): bool {` einfügen:

```php
// 🔴 EIN DELTA TRAEGT KEINE GLOBALEN BLOECKE. Der Live-Abgleich des Editors (pollLiveMapUpdates,
// js/routing/routing.js) liest aus einer since_revision-Antwort NUR `features` und `revision`;
// Quellenkatalog, Verweise, Korpora, Kanon und Innerorts-Objekte kommen ausschliesslich im Vollabruf
// an (routing.js, das `.then` der routeDataRequest). Gemessen 03.09.2026: 6,47 MB und 1,13 s fuer
// null geaenderte Features, alle 15 s nach jeder fremden Speicherung.
// ⚠️ Nur `since_revision` entscheidet -- eine bbox-Anfrage ist ein gekuerzter VOLLabruf und behaelt
// alles, was ihre Popups brauchen.
function avesmapsMapFeaturesIstDeltaAbruf(array $queryParams): bool {
    return trim((string) ($queryParams['since_revision'] ?? '')) !== '';
}
```

- [ ] **Step 4: Endpunkt an die Weiche hängen**

In `api/app/map-features.php`:

Vorher (drei Zeilen, direkt vor `$query = avesmapsBuildMapFeaturesQuery($_GET);`):

```php
    $sourceCorpora = avesmapsLoadSourceCorporaForPayload($pdo);
    $sourceCatalog = avesmapsLoadFeatureSourceCatalog($pdo);
    $featureSourceRefs = avesmapsLoadFeatureSourceRefs($pdo);
```

Nachher:

```php
    // 🔴 Delta-Abrufe (since_revision) tragen keine globalen Bloecke -- siehe
    // avesmapsMapFeaturesIstDeltaAbruf in api/_internal/app/map-features-cache.php.
    $mapFeaturesIstDelta = avesmapsMapFeaturesIstDeltaAbruf($_GET);
    $sourceCorpora = $mapFeaturesIstDelta ? [] : avesmapsLoadSourceCorporaForPayload($pdo);
    $sourceCatalog = $mapFeaturesIstDelta ? [] : avesmapsLoadFeatureSourceCatalog($pdo);
    $featureSourceRefs = $mapFeaturesIstDelta ? [] : avesmapsLoadFeatureSourceRefs($pdo);
```

Vorher (der Kanon-Block):

```php
    $featureKanon = avesmapsFeatureSourcesDeriveKanon(
        $sourceCatalog,
        $featureSourceRefs,
        avesmapsMapFeaturesWikiNamespaces($features)
            + avesmapsPoliticalTerritoryWikiNamespaces($pdo)
    );
```

Nachher:

```php
    $featureKanon = $mapFeaturesIstDelta ? [] : avesmapsFeatureSourcesDeriveKanon(
        $sourceCatalog,
        $featureSourceRefs,
        avesmapsMapFeaturesWikiNamespaces($features)
            + avesmapsPoliticalTerritoryWikiNamespaces($pdo)
    );
```

Vorher (in der Nutzlast):

```php
        'in_settlement_places' => avesmapsMapFeaturesInSettlementPlaces($pdo),
```

Nachher:

```php
        'in_settlement_places' => $mapFeaturesIstDelta ? [] : avesmapsMapFeaturesInSettlementPlaces($pdo),
```

Die Nutzlast-Schlüssel bleiben alle stehen (leer statt fehlend), damit ein alter Client, der einen Schlüssel liest, ein leeres Objekt sieht und nicht `undefined`.

- [ ] **Step 5: Tests laufen lassen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/map-features-delta-schlank-test.php`
Expected: `OK map-features-delta-schlank-test`.

Run zusätzlich die Nachbartests derselben Datei, weil sie den Quelltext lesen:
`for t in api/_internal/app/__tests__/map-features-variablen-scope-test.php api/_internal/app/__tests__/tempowerte-nutzlast-test.php api/_internal/app/__tests__/quellen-landschaft-nutzlast-test.php api/_internal/app/__tests__/map-features-cache-test.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll "$t" || echo "ROT: $t"; done`
Expected: keine ROT-Zeile.

- [ ] **Step 6: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add api/_internal/app/map-features-cache.php api/app/map-features.php api/_internal/app/__tests__/map-features-delta-schlank-test.php && git commit -m "perf(map-features): Delta-Abruf ohne Quellenkatalog, Verweise, Kanon und Innerorts-Objekte -- 6,5 MB und 1,1 s je Live-Abgleich fuer null Features entfallen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 7: Live-Gegenprobe (eine Anfrage)**

```bash
REV=$(curl -s https://avesmaps.de/api/app/map-revision.php | php -r 'echo json_decode(stream_get_contents(STDIN))->revision;')
curl -s -o /dev/null -w 'bytes=%{size_download} ttfb=%{time_starttransfer}\n' "https://avesmaps.de/api/app/map-features.php?since_revision=${REV}&edit_mode=1"
```

Expected: `bytes` unter 20.000 (vorher 6.474.261), `ttfb` unter 0,4 (vorher 1,13). Danach im Editor ein fremdes Objekt speichern lassen oder abwarten und prüfen, dass die Änderung nach spätestens 15 s auf der Karte erscheint (Toast „1 Kartenänderung(en) aktualisiert.").

---

### Task 3: Politische Ansicht im Editor — Pan-Guard für alle Ansichten, längere Fristen für Fan-out und Stilliste

**Files:**
- Modify: `js/map-features/map-features-political-territory-loader.js` (Zustand `politicalTerritoryLayerLoadedZoom`, Guard in `schedulePoliticalTerritoryLayerReload`, Setzen in `loadPoliticalTerritoryLayer`, Konstante `POLITICAL_TERRITORY_STYLE_CACHE_TTL_MS`)
- Modify: `js/config.js:806` (`POLITICAL_TERRITORY_LAYER_FETCH_CACHE_TTL_MS`)
- Test: `js/map-features/__tests__/ebenen-pan-guard.test.js`

**Interfaces:**
- Produces: `avesmapsPoliticalLayerAktuellerSchluessel(): string` (derselbe Schlüssel wie `buildPoliticalTerritoryLayerParsedCacheKey`), Modulzustand `politicalTerritoryLayerLoadedKey`.

Hintergrund: Die Ebene hängt an Zoom, Jahr und Bearbeiten-Modus, nie an einer bbox (`fetchPoliticalTerritories({action, year_bf, zoom, edit_mode})`). Der bestehende Guard schloss „political" aus („bleibt das bisherige Lade-auf-jedes-moveend"). Alle Schreibwege rufen `schedulePoliticalTerritoryLayerReload({ immediate: true })` (23 Aufrufer, `grep -rn "immediate: true" js`), die Zeitleiste ändert das Jahr und damit den Schlüssel. Nichts hängt am Neuladen bei gleichem Schlüssel.

- [ ] **Step 1: Test schreiben**

```js
// js/map-features/__tests__/ebenen-pan-guard.test.js
// Ein Pan bei gleichem Zoom, Jahr und Bearbeiten-Modus holt die politische Ebene NICHT neu -- in
// ALLEN Ansichten, auch in "political".
//
// 💣 Gemessen 03.09.2026 im Editor, politische Ansicht: EIN Pan = 8 Anfragen, ~6,5 MB (Ebene, sechs
// Nachbarzooms, Stilliste). In der Standardansicht derselbe Pan: 0 Anfragen. Der Unterschied war
// eine einzige Bedingung (`mapLayerMode !== "political"`) im Guard.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ebenen-pan-guard.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const loader = lies("js/map-features/map-features-political-territory-loader.js");
const config = lies("js/config.js");

// --- Umgebung -----------------------------------------------------------------------------------
let zoom = 4;
let modus = "political";
let geladen = 0;
global.window = { setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {} };
global.map = { getZoom: () => zoom };
global.POLITICAL_TERRITORIES_API_URL = "api/app/political-territories.php";
global.politicalTerritoryApiUnavailable = false;
global.politicalTimelineYear = 1049;
global.IS_EDIT_MODE = true;
global.getSelectedMapLayerMode = () => modus;
global.TERRITORY_BOUNDARY_MODES = ["political", "deregraphic", "ecosystem"];
global.isPoliticalTerritoryLayerLoading = false;
global.politicalTerritoryLayerReloadPending = null;
global.politicalTerritoryLayerReloadTimerId = null;
global.activeRegionGeometryEdit = null;
global.pendingRegionOperation = null;
global.pendingRegionMoveState = null;
global.regionData = [{ properties: {} }];
global.hasLoadedDerivedRegionData = () => true;
global.invalidatePoliticalTerritoryLayerFetchCache = () => {};
global.invalidatePoliticalLayerCache = () => {};
global.loadPoliticalTerritoryLayer = async () => { geladen += 1; };

// --- Die ECHTEN Bauteile ------------------------------------------------------------------------
vm.runInThisContext(schnitt(loader, "let politicalTerritoryLayerLoadedZoom", ""));
vm.runInThisContext(schnitt(loader, "let politicalTerritoryLayerLoadedKey", ""));
vm.runInThisContext(schnitt(loader, "function buildPoliticalTerritoryLayerParsedCacheKey", "}"));
vm.runInThisContext(schnitt(loader, "function avesmapsPoliticalLayerAktuellerSchluessel", "}"));
vm.runInThisContext(schnitt(loader, "function schedulePoliticalTerritoryLayerReload", "}"));

// 1) Noch nie geladen -> laden.
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 1, "erster Aufruf laedt");

// 2) Als geladen markieren (so wie loadPoliticalTerritoryLayer es tut) -> ein Pan laedt NICHT.
politicalTerritoryLayerLoadedZoom = 4;
politicalTerritoryLayerLoadedKey = buildPoliticalTerritoryLayerParsedCacheKey(4, 1049, 1);
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 1, "political, gleicher Schluessel, Daten da -> kein Reload beim Pan");

// 3) Zoomwechsel laedt.
zoom = 5;
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 2, "anderer Zoom -> Reload");
zoom = 4;

// 4) Jahreswechsel (Zeitleiste) laedt.
global.politicalTimelineYear = 1000;
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 3, "anderes Jahr -> Reload");
global.politicalTimelineYear = 1049;

// 5) immediate (Speichern) laedt IMMER.
schedulePoliticalTerritoryLayerReload({ immediate: true });
assert.strictEqual(geladen, 4, "immediate -> Reload");

// 6) Ohne Daten (z. B. nach clearRenderedRegionLayers) laedt der Pan wieder.
global.regionData = [];
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 5, "political ohne regionData -> Reload");
global.regionData = [{ properties: {} }];

// 7) Standardansicht: derselbe Guard, ueber die Derived-Daten.
modus = "deregraphic";
global.hasLoadedDerivedRegionData = () => false;
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 6, "deregraphic ohne Derived-Daten -> Reload");
global.hasLoadedDerivedRegionData = () => true;
schedulePoliticalTerritoryLayerReload();
assert.strictEqual(geladen, 6, "deregraphic mit Derived-Daten, gleicher Schluessel -> kein Reload");

// 8) Die Fristen: Fan-out 300 s, Stilliste 30 s -- beide standen auf 60 s bzw. 1 s.
assert.ok(/const POLITICAL_TERRITORY_LAYER_FETCH_CACHE_TTL_MS = 300000;/.test(config),
	"Fan-out-Frist 300 s (js/config.js) -- 60 s hiess sechs Volltransfers je Minute in der politischen Ansicht");
assert.ok(/const POLITICAL_TERRITORY_STYLE_CACHE_TTL_MS = 30000;/.test(loader),
	"Stilliste 30 s -- 1 s hiess ein Fuenf-Tabellen-Join je Pan");

// 9) loadPoliticalTerritoryLayer setzt den Schluessel neben dem Zoom.
const laden = schnitt(loader, "async function loadPoliticalTerritoryLayer", "}");
assert.ok(laden.includes("politicalTerritoryLayerLoadedZoom = requestedZoom;"), "Zoom wird gesetzt");
assert.ok(laden.includes("politicalTerritoryLayerLoadedKey = parsedCacheKey;"), "und der Schluessel direkt daneben");

console.log("OK ebenen-pan-guard (9 Abschnitte)");
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `node js/map-features/__tests__/ebenen-pan-guard.test.js`
Expected: FAIL mit `let politicalTerritoryLayerLoadedKey nicht gefunden`.

- [ ] **Step 3: Zustand und Schlüssel-Helfer ergänzen**

In `js/map-features/map-features-political-territory-loader.js` nach der Zeile `let politicalTerritoryLayerLoadedZoom = null;` einfügen:

```js
// Derselbe Schluessel wie beim geparsten Zwischenspeicher (Zoom, Jahr, Bearbeiten-Modus), fuer
// den Pan-Guard in schedulePoliticalTerritoryLayerReload: die Ebene haengt an genau diesen dreien
// und an keiner bbox. Gesetzt NEBEN politicalTerritoryLayerLoadedZoom, geleert wo jener geleert wird.
let politicalTerritoryLayerLoadedKey = null;

function avesmapsPoliticalLayerAktuellerSchluessel() {
	return buildPoliticalTerritoryLayerParsedCacheKey(
		Math.round(Number(map.getZoom())),
		politicalTimelineYear,
		IS_EDIT_MODE ? 1 : 0
	);
}
```

Dann `grep -n "politicalTerritoryLayerLoadedZoom = " js/map-features/*.js js/review/*.js js/territory/*.js` laufen lassen. An JEDER Stelle, die `politicalTerritoryLayerLoadedZoom = null` setzt, direkt darunter `politicalTerritoryLayerLoadedKey = null;` ergänzen. In `loadPoliticalTerritoryLayer` nach `politicalTerritoryLayerLoadedZoom = requestedZoom;` die Zeile `politicalTerritoryLayerLoadedKey = parsedCacheKey;` einfügen (`parsedCacheKey` ist dort schon berechnet).

- [ ] **Step 4: Guard umbauen**

In `schedulePoliticalTerritoryLayerReload`. Vorher:

```js
	// Pan-sicher in den reinen Grenzen-Modi (deregraphic/powerlines): bei unveraendertem Zoom (= reines
	// Pannen) und bereits geladenen Derived-Daten NICHT neu laden -> kein 1.22MB-Fetch pro Pan im Default-
	// Modus. Im political-Modus (Fuellung/Edit/Timeline) bleibt das bisherige Lade-auf-jedes-moveend.
	if (!immediate && mapLayerMode !== "political"
		&& politicalTerritoryLayerLoadedZoom === Math.round(map.getZoom())
		&& hasLoadedDerivedRegionData()) {
		return;
	}
```

Nachher:

```js
	// Pan-sicher in ALLEN Ansichten: derselbe Schluessel (Zoom, Jahr, Bearbeiten-Modus) wie beim
	// letzten Laden und Daten vorhanden -> nichts holen. Die Ebene haengt an keiner bbox.
	// 🔴 Bis 03.09.2026 galt das nur ausserhalb von "political" -- dort holte JEDER moveend die Ebene
	// neu, im Editor ohne jeden Client-Cache: gemessen 8 Anfragen und ~6,5 MB je Pan. Jahr und
	// Bearbeiten-Modus stecken im Schluessel, die Zeitleiste kommt also weiterhin durch; jeder
	// Speichervorgang ruft mit `immediate` und geht an diesem Guard vorbei.
	if (!immediate
		&& politicalTerritoryLayerLoadedKey !== null
		&& politicalTerritoryLayerLoadedKey === avesmapsPoliticalLayerAktuellerSchluessel()
		&& (mapLayerMode === "political"
			? (Array.isArray(regionData) && regionData.length > 0)
			: hasLoadedDerivedRegionData())) {
		return;
	}
```

- [ ] **Step 5: Fristen anheben**

`js/config.js:806`: `const POLITICAL_TERRITORY_LAYER_FETCH_CACHE_TTL_MS = 60000;` → `300000;` und im Kommentar darüber den Satz ergänzen: `// 300 s seit 03.09.2026: 60 s hiess in der politischen Ansicht sechs Volltransfers je Minute; jeder Speichervorgang leert den Speicher ohnehin (schedulePoliticalTerritoryLayerReload mit immediate).`

`js/map-features/map-features-political-territory-loader.js`: `const POLITICAL_TERRITORY_STYLE_CACHE_TTL_MS = 1000;` → `30000;` mit dem Kommentar: `// 30 s seit 03.09.2026: die Stilliste ist ein Fuenf-Tabellen-Join ueber alle Gebiete (action=list, 297 KB) und lief mit 1 s bei JEDEM Pan mit. Eigene Aenderungen kommen sofort ueber den Pending-Style-Override, fremde nach hoechstens 30 s.`

- [ ] **Step 6: Tests laufen lassen**

Run: `node js/map-features/__tests__/ebenen-pan-guard.test.js && node js/map-features/__tests__/ebenen-zwischenspeicher.test.js`
Expected: beide OK.

- [ ] **Step 7: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add js/map-features/map-features-political-territory-loader.js js/config.js js/map-features/__tests__/ebenen-pan-guard.test.js && git commit -m "perf(politik): Pan-Guard der Ebene gilt auch in der politischen Ansicht, Fan-out 300 s, Stilliste 30 s -- im Editor entfallen 8 Anfragen und 6,5 MB je Pan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 8: Live-Gegenprobe im Editor**

Im eingeloggten Chrome, Editor, politische Ansicht bei Zoom 4. Netzprotokoll leeren, EIN Pan mit der Maus, 5 s warten: `political-territories.php` darf **0** neue Anfragen zeigen. Dann Zoom 5: genau EINE Ebenenanfrage plus höchstens ein Fan-out-Bündel. Dann ein Jahr in der Zeitleiste wählen: genau eine Ebenenanfrage. Dann ein Gebiet speichern (oder Farbe ändern): die Ebene lädt sofort neu, die Änderung ist sichtbar.

---

### Task 4: Sperr-Timer entstehen nur für Sperren, die es noch gibt

**Files:**
- Modify: `js/map-features/map-features-feature-state.js` (`acquireFeatureSoftLock`, `releaseFeatureSoftLock`, neuer Helfer)
- Test: `js/map-features/__tests__/sperr-timer-race.test.js`

**Interfaces:**
- Produces: `avesmapsFeatureLockIstVerloren(error): boolean`; `activeFeatureLocks` hält während der laufenden Anfrage den Platzhalter `null`, danach die Timer-Kennung.

Hintergrund: `acquireFeatureSoftLock` trug den Timer erst NACH dem `await` ein. Ein `releaseFeatureSoftLock` während der Anfrage fand nichts, gab auf, und der Timer lief danach für immer (live bestätigt 03.09.2026). Direkte Aufrufer ohne Dialog: `setLabelMoveActive`, Geometriebearbeitung von Weg und Region, und `clearRegionGeometryEdit`, das jeder Kartenklick im Editor ruft. Dazu der Fall vom 26.08.2026: ein Timer auf ein gelöschtes Objekt schlägt endlos fehl.

- [ ] **Step 1: Test schreiben**

```js
// js/map-features/__tests__/sperr-timer-race.test.js
// Ein Sperr-Timer entsteht nur fuer eine Sperre, die es beim Eintreffen der Antwort noch gibt --
// und er stoppt, wenn das Objekt weg ist oder jemand anders es haelt.
//
// 💣 Bestaetigt 03.09.2026 im Editor: acquireFeatureSoftLock(id) + sofort releaseFeatureSoftLock(id)
// liess den 45-s-Wecker fuer immer stehen (der Eintrag in activeFeatureLocks kam erst NACH dem await).
// Jeder Tick war ein POST mit zwei CREATE TABLE IF NOT EXISTS. Der Test FAEHRT beide Funktionen.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/sperr-timer-race.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};
const tick = () => new Promise((r) => setImmediate(r));

const quelle = lies("js/map-features/map-features-feature-state.js");

// --- Umgebung -----------------------------------------------------------------------------------
global.IS_EDIT_MODE = true;
global.isSqlMapFeatureId = () => true;
global.activeFeatureLocks = new Map();
global.showFeedbackToast = () => {};
const warnungen = [];
global.console = { warn: (m) => warnungen.push(String(m)), log: console.log, error: console.error };
const timer = [];
const geloescht = [];
global.window = {
	setInterval: (fn, ms) => { timer.push({ fn, ms }); return timer.length; },
	clearInterval: (id) => { geloescht.push(id); },
};
const anfragen = [];
global.submitMapFeatureEdit = (payload) => new Promise((res, rej) => { anfragen.push({ payload, res, rej }); });
const letzte = () => anfragen[anfragen.length - 1];

vm.runInThisContext(schnitt(quelle, "function avesmapsFeatureLockIstVerloren", "}"));
vm.runInThisContext(schnitt(quelle, "async function acquireFeatureSoftLock", "}"));
vm.runInThisContext(schnitt(quelle, "async function releaseFeatureSoftLock", "}"));

(async () => {
	// 1) Die Race: freigeben, waehrend die Anfrage laeuft.
	void acquireFeatureSoftLock("a");
	assert.strictEqual(activeFeatureLocks.has("a"), true, "der Platzhalter steht VOR dem await");
	assert.strictEqual(activeFeatureLocks.get("a"), null, "und er ist ein Platzhalter, kein Timer");
	void releaseFeatureSoftLock("a");
	assert.strictEqual(activeFeatureLocks.has("a"), false, "das Freigeben nimmt den Platzhalter");
	assert.strictEqual(anfragen.length, 1, "das Freigeben schickt waehrend der Anfrage NICHTS -- acquire loest selbst");
	letzte().res({ ok: true });
	await tick(); await tick();
	assert.strictEqual(timer.length, 0, "kein Wecker fuer eine schon freigegebene Sperre");
	assert.strictEqual(anfragen.length, 2, "die Serversperre wird nach der Antwort geloest");
	assert.strictEqual(letzte().payload.action, "release_lock");
	letzte().res({ ok: true });
	await tick();

	// 2) Der Normalfall: Wecker kommt, Freigeben loescht ihn und loest die Serversperre.
	void acquireFeatureSoftLock("b");
	letzte().res({ ok: true });
	await tick(); await tick();
	assert.strictEqual(timer.length, 1, "ein Wecker");
	assert.strictEqual(timer[0].ms, 45000, "alle 45 s");
	assert.strictEqual(activeFeatureLocks.get("b"), 1, "die Kennung steht in der Liste");
	void releaseFeatureSoftLock("b");
	assert.deepStrictEqual(geloescht, [1], "clearInterval mit der Kennung");
	assert.strictEqual(letzte().payload.action, "release_lock");
	assert.strictEqual(letzte().payload.public_id, "b");
	letzte().res({ ok: true });
	await tick();

	// 3) Ein fehlgeschlagenes Anfordern raeumt den Platzhalter und wirft weiter.
	let geworfen = null;
	const p = acquireFeatureSoftLock("c").catch((e) => { geworfen = e; });
	letzte().rej(new Error("Dieses Objekt ist gerade gesperrt."));
	await p;
	assert.ok(geworfen, "der Fehler kommt beim Aufrufer an");
	assert.strictEqual(activeFeatureLocks.has("c"), false, "kein Platzhalter nach dem Fehlschlag");

	// 4) Der Wecker stoppt, wenn das Objekt weg ist ...
	void acquireFeatureSoftLock("d");
	letzte().res({ ok: true });
	await tick(); await tick();
	const weckerD = timer[timer.length - 1];
	const kennungD = activeFeatureLocks.get("d");
	weckerD.fn();
	letzte().rej(new Error("Das Kartenobjekt wurde nicht gefunden."));
	await tick(); await tick();
	assert.ok(geloescht.includes(kennungD), "Wecker geloescht: das Objekt gibt es nicht mehr");
	assert.strictEqual(activeFeatureLocks.has("d"), false, "und aus der Liste genommen");

	// 5) ... und wenn jemand anders sie haelt ...
	void acquireFeatureSoftLock("e");
	letzte().res({ ok: true });
	await tick(); await tick();
	const kennungE = activeFeatureLocks.get("e");
	timer[timer.length - 1].fn();
	letzte().rej(new Error("Dieses Kartenobjekt wird gerade von Nottel bearbeitet."));
	await tick(); await tick();
	assert.ok(geloescht.includes(kennungE), "Wecker geloescht: die Sperre gehoert jemand anderem");

	// 6) ... aber NICHT bei einem Netzfehler (der naechste Tick darf es wieder versuchen).
	void acquireFeatureSoftLock("f");
	letzte().res({ ok: true });
	await tick(); await tick();
	const kennungF = activeFeatureLocks.get("f");
	timer[timer.length - 1].fn();
	letzte().rej(new Error("Failed to fetch"));
	await tick(); await tick();
	assert.ok(!geloescht.includes(kennungF), "Netzfehler -> Wecker bleibt");
	assert.strictEqual(activeFeatureLocks.get("f"), kennungF, "und die Sperre bleibt gemerkt");

	// 7) Der reine Helfer.
	assert.strictEqual(avesmapsFeatureLockIstVerloren(new Error("Das Kartenobjekt wurde nicht gefunden.")), true);
	assert.strictEqual(avesmapsFeatureLockIstVerloren(new Error("Dieses Kartenobjekt wird gerade von X bearbeitet.")), true);
	assert.strictEqual(avesmapsFeatureLockIstVerloren(new Error("Failed to fetch")), false);
	assert.strictEqual(avesmapsFeatureLockIstVerloren(null), false);

	console.log("OK sperr-timer-race (7 Abschnitte)");
})().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `node js/map-features/__tests__/sperr-timer-race.test.js`
Expected: FAIL mit `function avesmapsFeatureLockIstVerloren nicht gefunden`.

- [ ] **Step 3: Funktionen umbauen**

In `js/map-features/map-features-feature-state.js` beide Funktionen ersetzen. Vorher: die bestehenden `acquireFeatureSoftLock` und `releaseFeatureSoftLock`. Nachher:

```js
// Heisst der Fehler „diese Sperre gibt es fuer uns nicht mehr"? Dann darf der Wecker nicht weiter
// schlagen: das Objekt ist geloescht (400, „nicht gefunden") oder jemand anders haelt es (409).
// ⚠️ Ein Netzfehler ist KEIN Verlust -- der naechste Tick darf es wieder versuchen.
function avesmapsFeatureLockIstVerloren(error) {
	const text = String((error && error.message) || "");
	return /nicht gefunden|wird gerade von/i.test(text);
}

async function acquireFeatureSoftLock(publicId) {
	if (!IS_EDIT_MODE || !isSqlMapFeatureId(publicId) || activeFeatureLocks.has(publicId)) {
		return;
	}

	// 🔴 DER PLATZHALTER STEHT VOR DEM AWAIT. Bis 03.09.2026 kam der Eintrag erst nach der Antwort;
	// ein releaseFeatureSoftLock waehrend der Anfrage fand nichts, gab auf, und der 45-s-Wecker
	// lief danach fuer immer -- jeder Tick ein POST mit zwei CREATE TABLE IF NOT EXISTS. Live
	// bestaetigt; der Owner sah den Effekt am 26.08.2026 an einem geloeschten Label.
	activeFeatureLocks.set(publicId, null);
	try {
		await submitMapFeatureEdit({ action: "acquire_lock", public_id: publicId });
	} catch (error) {
		activeFeatureLocks.delete(publicId);
		showFeedbackToast(error.message || "Dieses Objekt ist gerade gesperrt.", "warning");
		throw error;
	}
	// Waehrend der Anfrage freigegeben: kein Wecker, aber die Serversperre wieder loesen --
	// die Antwort hat sie gerade angelegt.
	if (!activeFeatureLocks.has(publicId)) {
		void submitMapFeatureEdit({ action: "release_lock", public_id: publicId }).catch(() => {});
		return;
	}
	const refreshTimerId = window.setInterval(() => {
		void submitMapFeatureEdit({ action: "acquire_lock", public_id: publicId }).catch((error) => {
			console.warn("Feature-Lock konnte nicht erneuert werden:", error);
			if (avesmapsFeatureLockIstVerloren(error)) {
				window.clearInterval(refreshTimerId);
				activeFeatureLocks.delete(publicId);
			}
		});
	}, 45000);
	activeFeatureLocks.set(publicId, refreshTimerId);
}

async function releaseFeatureSoftLock(publicId) {
	if (!isSqlMapFeatureId(publicId) || !activeFeatureLocks.has(publicId)) {
		return;
	}

	const timerId = activeFeatureLocks.get(publicId);
	activeFeatureLocks.delete(publicId);
	// Platzhalter: die Anfrage laeuft noch, acquireFeatureSoftLock loest die Serversperre selbst.
	if (timerId === null) {
		return;
	}
	window.clearInterval(timerId);
	try {
		await submitMapFeatureEdit({ action: "release_lock", public_id: publicId });
	} catch (error) {
		console.warn("Feature-Lock konnte nicht freigegeben werden:", error);
	}
}
```

- [ ] **Step 4: Test laufen lassen, er muss bestehen**

Run: `node js/map-features/__tests__/sperr-timer-race.test.js`
Expected: `OK sperr-timer-race (7 Abschnitte)`.

- [ ] **Step 5: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add js/map-features/map-features-feature-state.js js/map-features/__tests__/sperr-timer-race.test.js && git commit -m "fix(editor): Sperr-Timer traegt sich VOR dem await ein und stoppt bei verlorener Sperre -- kein endloser acquire_lock-Wecker mehr nach schnellem Schliessen oder Loeschen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 6: Live-Gegenprobe im Editor**

In der Konsole des Editors:

```js
const e = locationMarkers.find((x) => x.publicId && x.locationType !== "kreuzung");
void acquireFeatureSoftLock(e.publicId); void releaseFeatureSoftLock(e.publicId);
setTimeout(() => console.log("Sperren:", [...activeFeatureLocks.keys()]), 2000);   // erwartet: []
```

Dann einen Ort per Dialog öffnen, 2 s warten, schließen: `activeFeatureLocks.size` muss 0 sein und das Netzprotokoll ein `release_lock` zeigen.

---

### Task 5: DDL läuft je Stunde, nicht je Aufruf

**Files:**
- Create: `api/_internal/schema-ensure-once.php`
- Modify: `api/_internal/bootstrap.php` (ein `require_once` neben dem der api-metrics)
- Modify: `api/_internal/map/features.php` (Wrapper neben `avesmapsEnsureMapFeatureLocksTable` und `avesmapsEnsureMapAuditUndoColumns`; die zwei Aufrufe in `avesmapsAcquireMapFeatureLock` / `avesmapsReleaseMapFeatureLock`)
- Modify: `api/edit/map/features.php:42`, `api/edit/reports/locations.php:91` und `:501` (Wrapper), `api/edit/map/audit-log.php:38`
- Modify: `api/_internal/political/territory.php` (Wrapper neben `avesmapsPoliticalEnsureTables`), `api/_internal/political/territories-derived-geometry.php` (Wrapper neben `avesmapsPoliticalEnsureDerivedGeometryTables`), `api/_internal/political/territories-endpoint.php:71-72`
- Test: `api/_internal/__tests__/schema-ensure-once-test.php`

**Interfaces:**
- Produces: `avesmapsSchemaEnsureOnce(string $name, string $definierendeDatei, callable $ensure, int $frist = 3600): bool` (true = Ensure lief), `avesmapsSchemaEnsureMarkerFile(string $name, string $definierendeDatei): string`; die Wrapper `avesmapsEnsureMapFeatureLocksTableEinmal`, `avesmapsEnsureMapAuditUndoColumnsEinmal`, `avesmapsEnsureMapReportsTableForReviewEinmal`, `avesmapsPoliticalEnsureTablesEinmal`, `avesmapsPoliticalEnsureDerivedGeometryTablesEinmal`, alle `(PDO $pdo): void`.

Hintergrund: Der Riegel ist eine Marker-Datei je Ensure im Temp-Verzeichnis, wie der Dateicache der politischen Ebene (`sys_get_temp_dir()`, `territories-derived-layer.php`). Der Schlüssel trägt die mtime der DEFINIERENDEN Datei: ein Deploy, der eine Spalte ergänzt, ändert die Datei, damit den Schlüssel, und der Ensure läuft sofort wieder. Ohne das stünde ein neuer `ALTER TABLE` bis zu eine Stunde aus. `presence.php` bleibt unberührt, es rüstet schon heute nur bei Fehler nach.

- [ ] **Step 1: Test schreiben**

```php
<?php
// api/_internal/__tests__/schema-ensure-once-test.php
// Der DDL-Riegel: ein Ensure laeuft je definierender Datei hoechstens einmal je Frist -- und sofort
// wieder, wenn die Datei sich aendert (Deploy mit neuer Spalte).
//
// 💣 Gemessen 03.09.2026: die Meldungsliste fuhr je 45 s CREATE TABLE + 5x SHOW COLUMNS + SHOW TABLES,
// jeder Sperr-Wecker 2x CREATE TABLE IF NOT EXISTS, der politische Endpunkt 13 DDL-Statements je
// Nicht-Cache-Treffer. Alles idempotent, alles auf dem heissen Pfad.
//
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/schema-ensure-once-test.php
declare(strict_types=1);

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 3);
require_once $WURZEL . '/api/_internal/schema-ensure-once.php';

// ---- 1. Einmal je Frist ------------------------------------------------------------------------
$datei = (string) tempnam(sys_get_temp_dir(), 'avesmaps-ensure-');
file_put_contents($datei, "a");
$name = 'test-' . bin2hex(random_bytes(6));
@unlink(avesmapsSchemaEnsureMarkerFile($name, $datei));
$laeufe = 0;
$ensure = static function () use (&$laeufe): void { $laeufe++; };

assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure) === true, 'der erste Aufruf laeuft');
assert($laeufe === 1);
assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure) === false, 'der zweite innerhalb der Frist nicht');
assert($laeufe === 1);

// ---- 2. Die Frist ------------------------------------------------------------------------------
assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure, 0) === true, 'Frist 0 -> laeuft wieder');
assert($laeufe === 2);

// ---- 3. Eine geaenderte Datei (Deploy) bricht den Riegel sofort ---------------------------------
touch($datei, time() + 10);
clearstatcache(true, $datei);
assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure) === true, 'andere mtime -> anderer Schluessel -> laeuft');
assert($laeufe === 3);
assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure) === false, 'und danach wieder gesperrt');

// ---- 4. Ein werfender Ensure setzt keine Marke --------------------------------------------------
$name2 = 'test-' . bin2hex(random_bytes(6));
$geworfen = false;
try {
    avesmapsSchemaEnsureOnce($name2, $datei, static function (): void { throw new RuntimeException('DDL kaputt'); });
} catch (RuntimeException) {
    $geworfen = true;
}
assert($geworfen, 'der Fehler kommt beim Aufrufer an');
assert(!is_file(avesmapsSchemaEnsureMarkerFile($name2, $datei)), 'keine Marke nach einem Fehlschlag');

@unlink(avesmapsSchemaEnsureMarkerFile($name, $datei));
@unlink($datei);

// ---- 5. Die Takt-Endpunkte gehen durch die Wrapper, nie am Riegel vorbei -----------------------
$ohneKommentare = static function (string $pfad) use ($WURZEL): string {
    $q = (string) file_get_contents($WURZEL . '/' . $pfad);
    $q = (string) preg_replace('#/\*.*?\*/#s', '', $q);
    return (string) preg_replace('#^\s*//.*$#m', '', $q);
};
$editFeatures = $ohneKommentare('api/edit/map/features.php');
assert(str_contains($editFeatures, 'avesmapsEnsureMapFeatureLocksTableEinmal($pdo);'), 'edit/map/features.php: Praeambel ueber den Riegel');
assert(!str_contains($editFeatures, "\n    avesmapsEnsureMapFeatureLocksTable(\$pdo);"), 'edit/map/features.php: kein blanker Ensure mehr');

$libFeatures = $ohneKommentare('api/_internal/map/features.php');
assert(substr_count($libFeatures, 'avesmapsEnsureMapFeatureLocksTableEinmal($pdo);') >= 2, 'acquire und release gehen durch den Riegel');
assert(str_contains($libFeatures, "function avesmapsEnsureMapFeatureLocksTableEinmal(PDO \$pdo): void"), 'der Wrapper steht bei der Definition');
assert(str_contains($libFeatures, "function avesmapsEnsureMapAuditUndoColumnsEinmal(PDO \$pdo): void"), 'ebenso fuer die Undo-Spalten');

$auditLog = $ohneKommentare('api/edit/map/audit-log.php');
assert(str_contains($auditLog, 'avesmapsEnsureMapAuditUndoColumnsEinmal($pdo);'), 'audit-log.php ueber den Riegel');
assert(!str_contains($auditLog, "\n    avesmapsEnsureMapAuditUndoColumns(\$pdo);"), 'audit-log.php: kein blanker Ensure');

$reports = $ohneKommentare('api/edit/reports/locations.php');
assert(str_contains($reports, "function avesmapsEnsureMapReportsTableForReviewEinmal(PDO \$pdo): void"), 'Wrapper fuer map_reports');
assert(substr_count($reports, 'avesmapsEnsureMapReportsTableForReviewEinmal($pdo);') >= 1, 'die Liste (45-s-Takt) geht durch den Riegel');

$endpunkt = $ohneKommentare('api/_internal/political/territories-endpoint.php');
assert(str_contains($endpunkt, 'avesmapsPoliticalEnsureTablesEinmal($pdo);'), 'politischer Endpunkt: Tabellen ueber den Riegel');
assert(str_contains($endpunkt, 'avesmapsPoliticalEnsureDerivedGeometryTablesEinmal($pdo);'), 'politischer Endpunkt: Derived-Tabellen ueber den Riegel');
assert(!str_contains($endpunkt, "\n    avesmapsPoliticalEnsureTables(\$pdo);"), 'kein blanker Ensure im Endpunkt');

$bootstrap = $ohneKommentare('api/_internal/bootstrap.php');
assert(str_contains($bootstrap, "require_once __DIR__ . '/schema-ensure-once.php';"), 'bootstrap.php laedt den Riegel fuer alle Endpunkte');
// Die Bibliotheken laden ihn SELBST -- ein Test laedt sie ohne bootstrap.php.
assert(str_contains($libFeatures, "require_once __DIR__ . '/../schema-ensure-once.php';"), 'map/features.php laedt den Riegel selbst');
assert(str_contains($ohneKommentare('api/_internal/political/territory.php'), "require_once __DIR__ . '/../schema-ensure-once.php';"), 'territory.php laedt den Riegel selbst');
assert(str_contains($ohneKommentare('api/_internal/political/territories-derived-geometry.php'), "require_once __DIR__ . '/../schema-ensure-once.php';"), 'territories-derived-geometry.php laedt den Riegel selbst');
assert(str_contains($reports, "require_once __DIR__ . '/../../_internal/schema-ensure-once.php';"), 'reports/locations.php laedt den Riegel selbst');

fwrite(STDOUT, "OK schema-ensure-once-test\n");
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/schema-ensure-once-test.php`
Expected: FAIL, `Failed opening required '.../schema-ensure-once.php'`.

- [ ] **Step 3: Riegel schreiben**

```php
<?php
// api/_internal/schema-ensure-once.php

declare(strict_types=1);

// DER DDL-RIEGEL. Ein `CREATE TABLE IF NOT EXISTS` (oder SHOW COLUMNS + ALTER) laeuft je definierender
// Datei und Namen hoechstens einmal je Frist -- nicht bei jedem Aufruf eines Takt-Endpunkts.
//
// 💣 Gemessen 03.09.2026: die Meldungsliste fuhr je 45 s CREATE TABLE + 5x SHOW COLUMNS + SHOW TABLES,
// jeder Sperr-Wecker 2x CREATE TABLE IF NOT EXISTS, der politische Endpunkt 13 DDL-Statements je
// Nicht-Cache-Treffer. Alles idempotent -- und alles Metadaten-Arbeit auf dem heissen Pfad, die
// AGENTS.md §10 seit Monaten als Perf-Hotspot fuehrt.
//
// 🔴 DER SCHLUESSEL TRAEGT DIE MTIME DER DEFINIERENDEN DATEI. Ein Deploy, der eine Spalte ergaenzt,
// aendert die Datei, damit den Schluessel, und der Ensure laeuft sofort wieder. Ohne das stuende ein
// neuer ALTER TABLE bis zu eine Stunde aus, und jede Anfrage liefe in „Unknown column".
// ⚠️ Faellt OFFEN aus: ist das Temp-Verzeichnis nicht schreibbar, gibt es keine Marke, und der
// Ensure laeuft wie bisher jedes Mal -- langsamer, nie kaputt.
// ⚠️ Der Ensure selbst wirft weiter; nach einem Fehlschlag entsteht KEINE Marke.
// 💣 Nie innerhalb einer Transaktion rufen: DDL committet in MySQL implizit (AGENTS.md §11).

const AVESMAPS_SCHEMA_ENSURE_FRIST_SEKUNDEN = 3600;

function avesmapsSchemaEnsureMarkerDir(): string {
    $dir = sys_get_temp_dir() . '/avesmaps_schema_ensured';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return $dir;
}

function avesmapsSchemaEnsureMarkerFile(string $name, string $definierendeDatei): string {
    clearstatcache(true, $definierendeDatei);
    $mtime = (string) @filemtime($definierendeDatei);
    return avesmapsSchemaEnsureMarkerDir() . '/' . sha1($name . '|' . $definierendeDatei . '|' . $mtime) . '.marker';
}

/**
 * @return bool true, wenn der Ensure in diesem Aufruf wirklich lief
 */
function avesmapsSchemaEnsureOnce(string $name, string $definierendeDatei, callable $ensure, int $frist = AVESMAPS_SCHEMA_ENSURE_FRIST_SEKUNDEN): bool {
    $marke = avesmapsSchemaEnsureMarkerFile($name, $definierendeDatei);
    clearstatcache(true, $marke);
    if ($frist > 0 && is_file($marke) && (time() - (int) @filemtime($marke)) < $frist) {
        return false;
    }
    $ensure();
    if (!@touch($marke)) {
        @file_put_contents($marke, '');
    }
    return true;
}
```

In `api/_internal/bootstrap.php` direkt nach `require_once __DIR__ . '/analytics/api-metrics.php';` einfügen:

```php
require_once __DIR__ . '/schema-ensure-once.php';
```

- [ ] **Step 4: Wrapper und Aufrufer**

Die vier Dateien, die einen Wrapper bekommen, laden den Riegel selbst -- eine Bibliothek darf sich nicht darauf verlassen, dass ein Endpunkt bootstrap.php vor ihr geladen hat (ein Test lädt sie allein):

- `api/_internal/map/features.php`: nach `require_once __DIR__ . '/../audit-prune.php';` die Zeile `require_once __DIR__ . '/../schema-ensure-once.php';`
- `api/_internal/political/territory.php`: nach `require_once __DIR__ . '/../text/ascii-fold.php';` die Zeile `require_once __DIR__ . '/../schema-ensure-once.php';`
- `api/_internal/political/territories-derived-geometry.php`: nach `require_once __DIR__ . '/territories-derived-geometry-plan.php';` die Zeile `require_once __DIR__ . '/../schema-ensure-once.php';`
- `api/edit/reports/locations.php`: nach `require_once __DIR__ . '/../../_internal/map/report-review-list.php';` die Zeile `require_once __DIR__ . '/../../_internal/schema-ensure-once.php';`

`api/_internal/map/features.php`, direkt NACH `function avesmapsEnsureMapFeatureLocksTable(PDO $pdo): void { … }`:

```php
// Der Riegel fuer den heissen Pfad (jeder Sperr-Wecker, jede Bearbeitung): siehe
// api/_internal/schema-ensure-once.php. Der Roh-Ensure darueber bleibt fuer Importe und Tests.
function avesmapsEnsureMapFeatureLocksTableEinmal(PDO $pdo): void {
    avesmapsSchemaEnsureOnce('map_feature_locks', __FILE__, static function () use ($pdo): void {
        avesmapsEnsureMapFeatureLocksTable($pdo);
    });
}
```

Direkt NACH `function avesmapsEnsureMapAuditUndoColumns(PDO $pdo): void { … }`:

```php
function avesmapsEnsureMapAuditUndoColumnsEinmal(PDO $pdo): void {
    avesmapsSchemaEnsureOnce('map_audit_log_undo', __FILE__, static function () use ($pdo): void {
        avesmapsEnsureMapAuditUndoColumns($pdo);
    });
}
```

In derselben Datei in `avesmapsAcquireMapFeatureLock` und `avesmapsReleaseMapFeatureLock` die Zeile `avesmapsEnsureMapFeatureLocksTable($pdo);` durch `avesmapsEnsureMapFeatureLocksTableEinmal($pdo);` ersetzen (zwei Stellen). `api/_internal/import/garetien-uebernahme.php:2052` bleibt unberührt.

`api/edit/map/features.php:42`: `avesmapsEnsureMapFeatureLocksTable($pdo);` → `avesmapsEnsureMapFeatureLocksTableEinmal($pdo);`

`api/edit/map/audit-log.php:38`: `avesmapsEnsureMapAuditUndoColumns($pdo);` → `avesmapsEnsureMapAuditUndoColumnsEinmal($pdo);`

`api/edit/reports/locations.php`: direkt NACH der Definition `function avesmapsEnsureMapReportsTableForReview(PDO $pdo): void { … }` (endet nach dem `foreach` mit den `ALTER TABLE`):

```php
// Der Riegel fuer den 45-s-Takt der Liste. Die Schreibwege weiter oben rufen den Roh-Ensure
// weiter direkt -- sie laufen je Handlung, nicht je Takt.
function avesmapsEnsureMapReportsTableForReviewEinmal(PDO $pdo): void {
    avesmapsSchemaEnsureOnce('map_reports_review', __FILE__, static function () use ($pdo): void {
        avesmapsEnsureMapReportsTableForReview($pdo);
    });
}
```

und in der Liste (Zeile 91) `avesmapsEnsureMapReportsTableForReview($pdo);` → `avesmapsEnsureMapReportsTableForReviewEinmal($pdo);`.

`api/_internal/political/territory.php`, direkt NACH `function avesmapsPoliticalEnsureTables(PDO $pdo): void { … }`:

```php
function avesmapsPoliticalEnsureTablesEinmal(PDO $pdo): void {
    avesmapsSchemaEnsureOnce('political_tables', __FILE__, static function () use ($pdo): void {
        avesmapsPoliticalEnsureTables($pdo);
    });
}
```

`api/_internal/political/territories-derived-geometry.php`, direkt NACH `function avesmapsPoliticalEnsureDerivedGeometryTables(PDO $pdo): void { … }`:

```php
function avesmapsPoliticalEnsureDerivedGeometryTablesEinmal(PDO $pdo): void {
    avesmapsSchemaEnsureOnce('political_derived_geometry_tables', __FILE__, static function () use ($pdo): void {
        avesmapsPoliticalEnsureDerivedGeometryTables($pdo);
    });
}
```

`api/_internal/political/territories-endpoint.php:71-72`:

```php
    avesmapsPoliticalEnsureTablesEinmal($pdo);
    avesmapsPoliticalEnsureDerivedGeometryTablesEinmal($pdo);
```

Die übrigen Aufrufer von `avesmapsPoliticalEnsureTables` (Wiki-Endpunkte, Display-Sync, Zoom-Sync) bleiben unverändert, sie laufen je Handlung.

- [ ] **Step 5: Tests laufen lassen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/schema-ensure-once-test.php`
Expected: `OK schema-ensure-once-test`.

Run zusätzlich alle Tests, die die berührten Dateien lesen: `for t in $(grep -rl "territories-endpoint.php\|edit/map/features.php\|audit-log.php\|reports/locations.php" api/_internal --include=*-test.php); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done`
Expected: keine ROT-Zeile.

- [ ] **Step 6: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add api/_internal/schema-ensure-once.php api/_internal/bootstrap.php api/_internal/map/features.php api/edit/map/features.php api/edit/reports/locations.php api/edit/map/audit-log.php api/_internal/political/territory.php api/_internal/political/territories-derived-geometry.php api/_internal/political/territories-endpoint.php api/_internal/__tests__/schema-ensure-once-test.php && git commit -m "perf(api): DDL-Riegel -- CREATE TABLE IF NOT EXISTS und SHOW COLUMNS laufen je Stunde statt je Takt (Sperr-Wecker, Meldungsliste, Aenderungsverlauf, politischer Endpunkt)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 7: Live-Gegenprobe**

Im Editor: Meldungsliste lädt, Änderungsverlauf lädt, ein Ort lässt sich öffnen und speichern (Sperre), die politische Ebene lädt nach einem Zoom, der Territoriumseditor öffnet. Alle vier Antworten HTTP 200. Bei einem 500 sofort `git revert` des Commits pushen.

---

### Task 6: Metrik-Aufräumen nur bei jedem hundertsten Request

**Files:**
- Modify: `api/_internal/analytics/api-metrics.php` (Konstante, Helfer, Kopf von `avesmapsApiMetricsAufraeumen`)
- Test: `api/_internal/analytics/__tests__/api-metrics-aufraeumen-takt-test.php`

**Interfaces:**
- Produces: `AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT = 100`, `avesmapsApiMetricsAufraeumenFaellig(int $wurf): bool`.

- [ ] **Step 1: Test schreiben**

```php
<?php
// api/_internal/analytics/__tests__/api-metrics-aufraeumen-takt-test.php
// Das Aufraeumen fragt nur bei jedem hundertsten Request nach -- die Marke ist ein Upsert auf EINE
// Zeile, die alle Anfragen aller Besucher teilen (gemessen 03.09.2026: zwei Schreibvorgaenge je Request).
//
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-aufraeumen-takt-test.php
declare(strict_types=1);

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 4);
require_once $WURZEL . '/api/_internal/analytics/api-metrics.php';

assert(AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT === 100, 'jeder hundertste');
assert(avesmapsApiMetricsAufraeumenFaellig(1) === true, 'Wurf 1 -> faellig');
for ($w = 2; $w <= 100; $w++) {
    assert(avesmapsApiMetricsAufraeumenFaellig($w) === false, 'Wurf ' . $w . ' -> nicht faellig');
}

// Der Kopf von avesmapsApiMetricsAufraeumen wirft den Wuerfel VOR der ersten Anweisung.
$quelle = (string) file_get_contents($WURZEL . '/api/_internal/analytics/api-metrics.php');
$quelle = (string) preg_replace('#/\*.*?\*/#s', '', $quelle);
$quelle = (string) preg_replace('#^\s*//.*$#m', '', $quelle);
$start = strpos($quelle, 'function avesmapsApiMetricsAufraeumen(PDO $pdo): void');
assert($start !== false);
$rumpf = substr($quelle, $start, 400);
$wurf = strpos($rumpf, 'avesmapsApiMetricsAufraeumenFaellig(random_int(1, AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT))');
$prepare = strpos($rumpf, '$pdo->prepare(');
assert($wurf !== false && $prepare !== false && $wurf < $prepare, 'der Wuerfel steht vor dem ersten prepare');

fwrite(STDOUT, "OK api-metrics-aufraeumen-takt-test\n");
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-aufraeumen-takt-test.php`
Expected: FAIL, `Undefined constant "AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT"`.

- [ ] **Step 3: Takt einbauen**

In `api/_internal/analytics/api-metrics.php` nach `const AVESMAPS_API_METRICS_AUFBEWAHRUNG_TAGE = 400;`:

```php
// ⚠️ NUR JEDER HUNDERTSTE REQUEST fragt nach dem Aufraeumen. Die Marke ist ein Upsert auf EINE Zeile,
// die alle Anfragen aller Besucher teilen -- gemessen 03.09.2026 zwei Schreibvorgaenge je Request,
// serialisiert an einer Zeilensperre. Das taegliche DELETE bleibt: die erste faellige Anfrage des
// Tages gewinnt die Marke wie bisher.
const AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT = 100;

function avesmapsApiMetricsAufraeumenFaellig(int $wurf): bool {
    return $wurf === 1;
}
```

Und den Kopf von `avesmapsApiMetricsAufraeumen` ändern. Vorher:

```php
function avesmapsApiMetricsAufraeumen(PDO $pdo): void {
    try {
        $marke = $pdo->prepare(
```

Nachher:

```php
function avesmapsApiMetricsAufraeumen(PDO $pdo): void {
    if (!avesmapsApiMetricsAufraeumenFaellig(random_int(1, AVESMAPS_API_METRICS_AUFRAEUMEN_TAKT))) {
        return;
    }
    try {
        $marke = $pdo->prepare(
```

- [ ] **Step 4: Tests laufen lassen**

Run: `for t in api/_internal/analytics/__tests__/api-metrics-*.php; do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll "$t" >/dev/null || echo "ROT: $t"; done`
Expected: keine ROT-Zeile.

- [ ] **Step 5: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add api/_internal/analytics/api-metrics.php api/_internal/analytics/__tests__/api-metrics-aufraeumen-takt-test.php && git commit -m "perf(api): Metrik-Aufraeumen wuerfelt je hundertsten Request statt bei jedem -- ein Schreibvorgang weniger je API-Aufruf

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 6: Live-Gegenprobe**

`curl -s https://avesmaps.de/api/app/map-revision.php` → `{"ok":true,...}`. Am nächsten Tag im Status-Panel unter „API" prüfen, dass die Tagesreihe weiterläuft (das DELETE braucht einen der hundert Würfe, am Tag kommen Tausende).

---

### Task 7: Meldungs-Poll pausiert in versteckten Tabs

**Files:**
- Modify: `js/review/review-panels.js` (`pollReviewReportsForNew`, Kopf)
- Test: `js/review/__tests__/meldungen-poll-versteckt.test.js`

- [ ] **Step 1: Test schreiben**

```js
// js/review/__tests__/meldungen-poll-versteckt.test.js
// Der 45-s-Poll der Meldungsliste schweigt in versteckten Tabs -- derselbe Riegel wie beim
// Live-Abgleich (pollLiveMapUpdates). Gemessen 03.09.2026: 11 Abrufe in 10 min aus einem Tab, den
// niemand ansah, jeder mit CREATE TABLE + 5x SHOW COLUMNS.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/meldungen-poll-versteckt.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const panels = lies("js/review/review-panels.js");

global.IS_EDIT_MODE = true;
global.reviewReportListUrl = () => "api/edit/reports/locations.php?status=neu";
let abrufe = 0;
// Der Abruf wirft nach dem Zaehlen: so bleibt der Rest der Funktion (Rendern) ausser Betracht.
global.fetch = async () => { abrufe += 1; throw new Error("Testabbruch"); };
global.console = { warn: () => {}, log: console.log, error: console.error };
global.document = { hidden: true };

vm.runInThisContext(schnitt(panels, "async function pollReviewReportsForNew", "}"));

(async () => {
	await pollReviewReportsForNew();
	assert.strictEqual(abrufe, 0, "versteckter Tab -> kein Abruf");
	global.document.hidden = false;
	await pollReviewReportsForNew();
	assert.strictEqual(abrufe, 1, "sichtbarer Tab -> Abruf");
	console.log("OK meldungen-poll-versteckt");
})().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `node js/review/__tests__/meldungen-poll-versteckt.test.js`
Expected: FAIL, `versteckter Tab -> kein Abruf` (abrufe ist 1).

- [ ] **Step 3: Riegel einbauen**

In `js/review/review-panels.js`, `pollReviewReportsForNew`, direkt nach dem `IS_EDIT_MODE`-Riegel:

```js
	// Versteckter Tab: niemand sieht die Liste -- derselbe Riegel wie beim Live-Abgleich
	// (pollLiveMapUpdates, js/routing/routing.js). Gemessen 03.09.2026: 11 Abrufe in 10 min aus
	// einem Tab, den niemand ansah. Beim Zurueckkehren holt der naechste Tick nach.
	// ⚠️ Der Anwesenheits-Takt (sendEditorPresenceHeartbeat) bekommt diesen Riegel NICHT: an ihm
	// haengt der Territorien-Anspruch, und ein Editor im Nachbartab hat ihn nicht aufgegeben.
	if (typeof document !== "undefined" && document.hidden) {
		return;
	}
```

- [ ] **Step 4: Test laufen lassen, er muss bestehen**

Run: `node js/review/__tests__/meldungen-poll-versteckt.test.js`
Expected: `OK meldungen-poll-versteckt`.

- [ ] **Step 5: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add js/review/review-panels.js js/review/__tests__/meldungen-poll-versteckt.test.js && git commit -m "perf(editor): Meldungs-Poll schweigt in versteckten Tabs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 6: Live-Gegenprobe**

Editor öffnen, in einen anderen Tab wechseln, 2 min warten, zurück: im Netzprotokoll keine `reports/locations.php`-Anfrage aus der versteckten Zeit, danach eine binnen 45 s.

---

### Task 8: Der Zusagencache der politischen Ebene verfällt

**Files:**
- Modify: `js/app/api-client.js` (`fetchPoliticalTerritories`, vor dem `set`)
- Test: `js/app/__tests__/ebenen-zusagen-verfall.test.js`

- [ ] **Step 1: Test schreiben**

```js
// js/app/__tests__/ebenen-zusagen-verfall.test.js
// POLITICAL_LAYER_CACHE haelt keine abgelaufenen Zusagen mehr. Bis 03.09.2026 wurde nie ein Eintrag
// geloescht, nur nach einer Speicherung alles geleert -- im Editor je Zoom x Jahr eine geparste Ebene
// mit 4-5 MB JSON, mit der Zeitleiste ohne Grenze.
//
// Aus der Wurzel des Repos:  node js/app/__tests__/ebenen-zusagen-verfall.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const apiClient = lies("js/app/api-client.js");

global.window = { location: { href: "https://avesmaps.de/" } };
global.IS_EDIT_MODE = true;
global.POLITICAL_TERRITORIES_API_URL = "api/app/political-territories.php";
global.fetchWithRetry = async () => ({ ok: true, status: 200 });
global.readJsonResponse = async () => ({ ok: true, features: [] });
global.apiErrorMessage = (d, f) => f;
let jetzt = 0;
const echtesNow = Date.now;
Date.now = () => jetzt;

vm.runInThisContext(schnitt(apiClient, "const POLITICAL_LAYER_CACHE", ""));
vm.runInThisContext(schnitt(apiClient, "const POLITICAL_LAYER_CACHE_TTL_MS", ""));
vm.runInThisContext(schnitt(apiClient, "function buildPoliticalTerritoriesParamKey", "}"));
vm.runInThisContext(schnitt(apiClient, "function avesmapsPoliticalLayerBrowserCacheable", "}"));
vm.runInThisContext(schnitt(apiClient, "async function fetchPoliticalTerritories", "}"));

(async () => {
	await fetchPoliticalTerritories({ action: "layer", zoom: 3, year_bf: 1049, edit_mode: 1 });
	assert.strictEqual(POLITICAL_LAYER_CACHE.size, 1, "erste Zusage liegt");

	jetzt = 1000;
	await fetchPoliticalTerritories({ action: "layer", zoom: 4, year_bf: 1049, edit_mode: 1 });
	assert.strictEqual(POLITICAL_LAYER_CACHE.size, 2, "innerhalb der Frist bleibt die erste liegen");

	jetzt = 7000;
	await fetchPoliticalTerritories({ action: "layer", zoom: 5, year_bf: 1049, edit_mode: 1 });
	assert.strictEqual(POLITICAL_LAYER_CACHE.size, 1, "beim Setzen fliegen alle abgelaufenen (>5 s) hinaus");
	assert.ok([...POLITICAL_LAYER_CACHE.keys()][0].includes("zoom=5"), "nur die frische bleibt");

	// Die Zeitleiste: zehn Jahre nacheinander -> hoechstens die Eintraege der letzten 5 s.
	for (let jahr = 1000; jahr < 1010; jahr += 1) {
		jetzt += 6000;
		await fetchPoliticalTerritories({ action: "layer", zoom: 5, year_bf: jahr, edit_mode: 1 });
	}
	assert.strictEqual(POLITICAL_LAYER_CACHE.size, 1, "zehn Jahre spaeter liegt genau eine Zusage");

	Date.now = echtesNow;
	console.log("OK ebenen-zusagen-verfall");
})().catch((error) => { Date.now = echtesNow; console.error(error); process.exit(1); });
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `node js/app/__tests__/ebenen-zusagen-verfall.test.js`
Expected: FAIL, `beim Setzen fliegen alle abgelaufenen (>5 s) hinaus` (size ist 3).

- [ ] **Step 3: Verfall einbauen**

In `js/app/api-client.js`, `fetchPoliticalTerritories`. Vorher:

```js
	if (cacheable) {
		POLITICAL_LAYER_CACHE.set(cacheKey, { ts: Date.now(), promise: requestPromise });
```

Nachher:

```js
	if (cacheable) {
		// 🔴 ABGELAUFENE ZUSAGEN FLIEGEN BEIM SETZEN HINAUS. Bis 03.09.2026 wurde hier nie etwas
		// geloescht, nur nach einer Speicherung alles geleert -- jede Zusage haelt aber die geparste
		// Ebene (im Editor 4-5 MB JSON je Zoom x Jahr), und die Zeitleiste kennt 1050 Jahre. Der
		// geparste Speicher des Loaders (300 s) bleibt der einzige Halter der Ansichts-Ebene.
		const jetzt = Date.now();
		for (const [key, eintrag] of POLITICAL_LAYER_CACHE) {
			if (jetzt - eintrag.ts >= POLITICAL_LAYER_CACHE_TTL_MS) {
				POLITICAL_LAYER_CACHE.delete(key);
			}
		}
		POLITICAL_LAYER_CACHE.set(cacheKey, { ts: jetzt, promise: requestPromise });
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node js/app/__tests__/ebenen-zusagen-verfall.test.js && node js/map-features/__tests__/ebenen-zwischenspeicher.test.js`
Expected: beide OK.

- [ ] **Step 5: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add js/app/api-client.js js/app/__tests__/ebenen-zusagen-verfall.test.js && git commit -m "perf(politik): abgelaufene Zusagen der Ebene fliegen beim Setzen aus dem api-client-Cache -- kein unbegrenztes Wachstum je Zoom und Jahr mehr

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 6: Live-Gegenprobe**

Editor, politische Ansicht, drei Zoomstufen mit je 10 s Abstand, dann in der Konsole `POLITICAL_LAYER_CACHE.size` → 1. Besucher-Tab: fünf Zoomschritte 3↔4, Netzprotokoll zeigt weiterhin genau zwei `political-territories`-Abrufe (der Loader-Speicher trägt die Ansicht, nicht dieser).

---

### Task 9: Grenz-Canvas-Signaturpoll auf 1 s und still in versteckten Tabs

**Files:**
- Modify: `js/map-features/map-features-boundary-canvas-overlay.js` (der `setInterval` am Dateiende, Zeilen 1138–1146)
- Test: `js/map-features/__tests__/grenz-canvas-signaturpoll.test.js`

- [ ] **Step 1: Test schreiben**

```js
// js/map-features/__tests__/grenz-canvas-signaturpoll.test.js
// Der Signaturpoll des Grenz-Canvas laeuft je Sekunde, nicht fuenfmal, und schweigt in versteckten
// Tabs. Er baut je Tick einen String ueber alle regionData -- fuer JEDEN Besucher, in jeder Ansicht.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/grenz-canvas-signaturpoll.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-boundary-canvas-overlay.js"), "utf8").split("\r\n").join("\n");

const start = quelle.indexOf("let lastDerivedSignature = null;");
assert.notStrictEqual(start, -1, "der Signaturpoll steht noch in der Datei");
const block = quelle.slice(start, quelle.indexOf("}, 1000);", start) + 9);
assert.ok(block.includes("window.setInterval(function () {"), "der Poll ist ein setInterval");
assert.ok(block.endsWith("}, 1000);"), "und laeuft je Sekunde (war 200 ms)");
assert.ok(block.includes("if (document.hidden) { return; }"), "und schweigt in versteckten Tabs");
assert.ok(!/\}, 200\);/.test(quelle.slice(start, start + 1200)), "die 200 ms sind weg");

console.log("OK grenz-canvas-signaturpoll");
```

- [ ] **Step 2: Test laufen lassen, er muss fallen**

Run: `node js/map-features/__tests__/grenz-canvas-signaturpoll.test.js`
Expected: FAIL, `und laeuft je Sekunde (war 200 ms)`.

- [ ] **Step 3: Poll umbauen**

Vorher:

```js
	let lastDerivedSignature = null;
	window.setInterval(function () {
		const rd = Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
```

Nachher:

```js
	// ⚠️ 1 s, nicht 200 ms (bis 03.09.2026): fuenfmal je Sekunde ueber alle regionData, fuer jeden
	// Besucher in jeder Ansicht, auch in versteckten Tabs. Der Loader ruft redraw() nach jedem Laden
	// ohnehin selbst; der Poll ist nur das Sicherheitsnetz fuer Wege, die daran vorbeigehen.
	let lastDerivedSignature = null;
	window.setInterval(function () {
		if (document.hidden) { return; }
		const rd = Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
```

und das Ende des Blocks `}, 200);` → `}, 1000);`.

- [ ] **Step 4: Test laufen lassen, er muss bestehen**

Run: `node js/map-features/__tests__/grenz-canvas-signaturpoll.test.js`
Expected: `OK grenz-canvas-signaturpoll`.

- [ ] **Step 5: Ganzes Testfeld, Commit, Push, Deploy abwarten**

```bash
git add js/map-features/map-features-boundary-canvas-overlay.js js/map-features/__tests__/grenz-canvas-signaturpoll.test.js && git commit -m "perf(grenzen): Signaturpoll des Grenz-Canvas je Sekunde statt 200 ms und still in versteckten Tabs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

- [ ] **Step 6: Live-Gegenprobe**

Besucher-Tab, Standardansicht: nach „Grenzen berechnen" im Editor (oder einem Zoomwechsel) erscheinen die Grenzen binnen 1 s. Politische Ansicht ein- und ausschalten: Grenzen kommen und gehen wie vorher.

---

## Nach allen neun Aufgaben

- AGENTS.md §10: den Absatz zu `territories-endpoint.php` („runs DDL + metadata probes before its cache read") um den Riegel ergänzen, und §11 um einen Eintrag „Performance-Fixes Editor 03.09.2026" mit den Zahlen aus der Befund-Tabelle (vorher/nachher). Ein eigener `docs:`-Commit.
- Die Messung wiederholen: `document.getElementsByTagName("*").length` im Editor, ein Pan in der politischen Ansicht im Netzprotokoll, ein Delta-Abruf per `curl`. Die drei Zahlen neben die Befund-Tabelle schreiben.
