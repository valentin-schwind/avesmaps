# Editor-Navigation 4→2 Ebenen — Implementierungs-Instruction

> **Für die umsetzende Session (Agent oder Mensch).** Diese Datei ist die Arbeitsanweisung; die
> **Begründungen/Entscheidungen** stehen in
> **[docs/superpowers/specs/2026-07-22-editor-navigation-design.md](superpowers/specs/2026-07-22-editor-navigation-design.md)**
> (die Spec) — bei Zweifeln immer dort nachlesen. Muster mit gemessenen Maßen:
> `verify-editor-nav.html` im Wurzelverzeichnis (untracked).
> Sprache: Prosa DE, Code/Bezeichner/Commits EN.

**Ziel:** Das WikiSync-Panel verliert zwei Reiterebenen. Acht Subjekte stehen in einer
zweispaltigen Auswahl, darunter ihre Verben, eine Suchzeile mit Filter und **genau eine**
Reiterzeile, die der Liste gehört.

**Architektur:** Eine neue Datei `js/review/review-subjects.js` hält die Subjekte als **Daten**
(Schlüssel, Label, Editor-Knopf, Ansichten, Facetten) und liefert reine Ableitungsfunktionen.
Alles Übrige liest nur noch daraus. Kein neues Backend, keine Schemaänderung, keine neuen
Endpunkte — die Zähler und Sync-Daten liefern die bestehenden Aufrufe
(`avesmapsWikiDumpSyncKindLastSynced`, die `load*WikiSync`-Funktionen).

**Tech-Stack:** Vanilla JS ohne Build, jQuery 3.6 (nur wo schon vorhanden), CSS-Tokens aus
`css/base/tokens.css`. Tests: Node ohne Runner.

---

## Global Constraints (gelten für JEDE Aufgabe)

- **Kein Build.** `index.html` bindet ~117 Dateien von Hand ein; **die Reihenfolge ist ein
  Vertrag**. Eine neue Datei muss VOR ihren Konsumenten stehen.
- 💣 **Geteilter Arbeitsbaum — niemals `git add -A`, `git add .` oder `git commit -a`.** Andere
  Sessions haben unfertige Arbeit im selben Checkout. Immer erst `git status`, dann
  `git commit --only -F - -- <pfad> …` mit **ausdrücklichen Pfaden**.
- **Editor-sichtbare Änderung ⇒ `html/editor-handbuch.html` im SELBEN Commit**, plus `Stand:`-Datum
  in der Kopfzeile (AGENTS.md §9). Betrifft hier die Aufgaben 4, 5 und 7.
- **Niemals ein `?v=` von Hand schreiben.** Der Deploy stempelt alles, was von `index.html` aus
  erreichbar ist (AGENTS.md §7).
- **Nur Tokens, keine festen Farben/Radien/Trenner** (AGENTS.md §12). Fehlt ein Wert, erst das
  Token anlegen.
- **Deutsche UI-Strings bleiben deutsch.** Code, Kommentare und Commits auf Englisch.
- 💣 **Keine Werteliste für Reiterschlüssel.** Gültig ist, was als Knopf im DOM steht. Genau diese
  Whitelist ist der Fehler, den Aufgabe 2 beseitigt — nicht an anderer Stelle neu einbauen.
- 💣 **Globale Namenskollision:** ein zweites top-level `const` desselben Namens killt beide
  Skripte still. `WIKI_SYNC_SUBJECTS` vorher per `grep -rn "WIKI_SYNC_SUBJECTS" js/` prüfen.
- **Zeilenenden:** vor dem Editieren `git ls-files --eol <datei>` lesen (Spalte `w/`), gemischte
  Dateien nur einzeilig anfassen.
- **Keine lokale DB.** Alles DB-Gebundene ist lokal nicht prüfbar → 🔧 Owner auf der Live-Seite.

**Testkommandos, aus dem Repo-Wurzelverzeichnis:**

```
node tools/paths/test-review-subjects.mjs
node tools/paths/test-review-tab-cascade.mjs
node tools/paths/test-wiki-sync-panel-tab.mjs
```

---

## Dateiübersicht

| Datei | Rolle |
|---|---|
| `js/review/review-subjects.js` | **neu** — die Subjekte als Daten + reine Ableitungen. Einzige Quelle. |
| `tools/paths/test-review-subjects.mjs` | **neu** — Test dazu |
| `tools/paths/test-wiki-sync-panel-tab.mjs` | **neu** — Test für das Umschalten |
| `index.html` | Auswahl-Raster, Verbzeile, Reiterzeile, Sektionen `citymaps`/`lore` hochziehen |
| `js/review/review-wiki-sync.js` | `setWikiSyncPanelTab` datengetrieben; Lore-Reiter umhängen |
| `js/ui/ui-controls.js` | `REVIEW_TAB_FAMILIES` ohne `data-material-subtab` |
| `css/features/review-panel.css` | Raster, Verbzeile, Reiterzeile |
| `html/editor-handbuch.html` | Aufgaben 4, 5, 7 |

---

## Aufgabe 1: Subjekt-Registry

Reine Daten plus Ableitungen, ohne DOM. Alles Weitere liest hieraus — damit ein neues Feature
später wirklich „eine Zeile mehr" kostet.

**Dateien:**
- Anlegen: `js/review/review-subjects.js`
- Anlegen: `tools/paths/test-review-subjects.mjs`
- Ändern: `index.html` (eine `<script>`-Zeile, **vor** `js/review/review-wiki-sync.js`)

**Schnittstellen:**
- Liefert: `WIKI_SYNC_SUBJECTS` (Array), `wikiSyncSubjectByKey(key) → object|null`,
  `wikiSyncIsKnownSubject(key) → boolean`, `wikiSyncSubjectVerbs(key) → Array<{id,label,primary}>`,
  `wikiSyncSubjectViewTabs(key) → Array<{key,label}>`

- [ ] **Schritt 1: Test schreiben (schlägt fehl)**

`tools/paths/test-review-subjects.mjs`:

```js
// Unit test (Node, no build) for the WikiSync subject registry in js/review/review-subjects.js.
// The registry is the single source for which subjects exist, what they can do and how their
// list divides. Loaded as a browser script into a vm context, same pattern as the sibling tests.
//
// Run: node tools/paths/test-review-subjects.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const context = vm.createContext({});
vm.runInContext(readFileSync(path.join(repoRoot, "js", "review", "review-subjects.js"), "utf8"), context);

const subjects = vm.runInContext("WIKI_SYNC_SUBJECTS", context);
const byKey = (k) => vm.runInContext(`wikiSyncSubjectByKey(${JSON.stringify(k)})`, context);
const known = (k) => vm.runInContext(`wikiSyncIsKnownSubject(${JSON.stringify(k)})`, context);
const verbs = (k) => vm.runInContext(`wikiSyncSubjectVerbs(${JSON.stringify(k)})`, context);
const views = (k) => vm.runInContext(`wikiSyncSubjectViewTabs(${JSON.stringify(k)})`, context);

// --- the eight subjects, in display order -----------------------------------------------
assert.deepEqual(
	subjects.map((s) => s.key),
	["locations", "territories", "regions", "paths", "powerlines", "adventures", "citymaps", "lore"],
	"subject order drives the two-column grid and must stay stable",
);

// --- keys the old hardcoded whitelist did not know --------------------------------------
// These three were sub-tabs or had no tab at all. If any of them is not "known", clicking it
// silently falls back to Siedlungen -- exactly the class of bug this registry removes.
["powerlines", "citymaps", "lore"].forEach((key) => {
	assert.equal(known(key), true, `${key} must be a known subject`);
});
assert.equal(known("adventures"), true);
assert.equal(known("materials"), false, "the junk-drawer key must not come back");
assert.equal(known(""), false);
assert.equal(known(null), false);

// --- verbs: four subjects have no list editor -------------------------------------------
// Owner-confirmed 2026-07-22 (spec §5). No dead second button -- Syncen carries the row alone.
["territories", "regions", "paths", "powerlines"].forEach((key) => {
	assert.deepEqual(verbs(key).map((v) => v.label), ["Syncen"], `${key} has no list editor`);
});
["locations", "adventures", "citymaps", "lore"].forEach((key) => {
	assert.deepEqual(verbs(key).map((v) => v.label), ["Syncen", "Bearbeiten"], `${key} has an editor`);
});
assert.equal(verbs("locations")[0].primary, true, "Syncen is the filled button");
assert.equal(verbs("locations")[1].id, "settlement-editor-open", "verb must name the real button id");
assert.equal(verbs("paths").length, 1);

// --- view tabs: from the real renderers, see spec §5 ------------------------------------
assert.deepEqual(views("paths").map((v) => v.label),
	["Alle", "Platziert", "Fehlt", "Konflikte", "Flussrichtung unbekannt"]);
assert.deepEqual(views("locations").map((v) => v.label), ["Alle", "Platziert", "Fehlt"]);
assert.deepEqual(views("lore").map((v) => v.label), ["Alle", "Fauna", "Flora", "Waren", "Spezies"]);
assert.deepEqual(views("lore").map((v) => v.key), ["all", "fauna", "flora", "ware", "spezies"]);
assert.deepEqual(views("adventures"), [], "no invented empty 'Alle' where there are no views");
assert.deepEqual(views("powerlines"), []);
assert.deepEqual(views("nonsense"), [], "unknown key must not throw");

// --- Spezies is off in public, but stays editable ---------------------------------------
const spezies = views("lore").find((v) => v.key === "spezies");
assert.equal(spezies.off, true, "greyed out, not removed");
assert.ok(spezies.reason && spezies.reason.length > 20, "a greyed tab must say why");

console.log("review-subjects: OK");
```

- [ ] **Schritt 2: Test laufen lassen, Rot sehen**

Ausführen: `node tools/paths/test-review-subjects.mjs`
Erwartet: `ENOENT … review-subjects.js`

- [ ] **Schritt 3: Registry anlegen**

`js/review/review-subjects.js`:

```js
// The WikiSync panel's subjects, as DATA. Everything else -- the selection grid, the verb row,
// the list's tab strip, the filter menu -- reads from here, so a new feature costs one entry
// instead of a new nesting level. Spec: docs/superpowers/specs/2026-07-22-editor-navigation-design.md
//
// Loaded before review-wiki-sync.js in index.html; plain globals, no build.

// Shared view-tab sets. "Alle | Platziert | Fehlt" is what the four map-object lists already
// render (review-settlement-list.js:203, review-wiki-sync.js:314, review-region-sync.js:211).
const WIKI_SYNC_MAP_VIEWS = [
	{ key: "all", label: "Alle" },
	{ key: "placed", label: "Platziert" },
	{ key: "missing", label: "Fehlt" },
];

// Wege carry two more (review-path-sync.js:252). The "Konflikte" here are the Verlauf legacy
// cases, which DO belong to one path -- not the conflict centre's computed rules, which belong
// to no single object (api/_internal/conflicts/store.php:12). Both may coexist.
const WIKI_SYNC_PATH_VIEWS = WIKI_SYNC_MAP_VIEWS.concat([
	{ key: "cases", label: "Konflikte" },
	{ key: "flow", label: "Flussrichtung unbekannt" },
]);

// Vorkommen divides by lore_entry.kind. This is a tab strip and not a filter facet because the
// kinds do NOT share a field set: "Gegenstandstyp" is rendered only for kind==='ware'
// (review-wiki-sync.js:2168), so that facet cannot exist in a mixed list. Spec §5.2.
const WIKI_SYNC_LORE_VIEWS = [
	{ key: "all", label: "Alle" },
	{ key: "fauna", label: "Fauna" },
	{ key: "flora", label: "Flora" },
	{ key: "ware", label: "Waren" },
	{
		key: "spezies",
		label: "Spezies",
		// Public display is off (owner 2026-07-21) but the data is complete and stays editable,
		// so the tab is greyed -- never removed. Reason verbatim from index.html:819: a greyed
		// surface without a reason gets flipped back by someone "tidying up".
		off: true,
		reason: "Das Wiki-Feld „Regionen“ der Infobox Spezies ist zu schlecht gepflegt. "
			+ "Die Daten liegen vollständig vor und kommen beim Einschalten sofort zurück.",
	},
];

// editorButtonId: null means there is no LIST editor. Owner-confirmed 2026-07-22 for
// territories/regions/paths/powerlines -- "Weg bearbeiten" in a map popup edits ONE object and
// is a different thing. Where it is null the verb row shows Syncen at full width; no dead button.
const WIKI_SYNC_SUBJECTS = [
	{ key: "locations",   label: "Siedlungen",  syncButtonId: "wiki-sync-sync-settlement",  editorButtonId: "settlement-editor-open", views: WIKI_SYNC_MAP_VIEWS },
	{ key: "territories", label: "Territorien", syncButtonId: "wiki-sync-territories",      editorButtonId: null,                     views: WIKI_SYNC_MAP_VIEWS },
	{ key: "regions",     label: "Regionen",    syncButtonId: "wiki-sync-sync-region",      editorButtonId: null,                     views: WIKI_SYNC_MAP_VIEWS },
	{ key: "paths",       label: "Wege",        syncButtonId: "wiki-sync-sync-path",        editorButtonId: null,                     views: WIKI_SYNC_PATH_VIEWS },
	{ key: "powerlines",  label: "Kraftlinien", syncButtonId: "wiki-sync-powerlines-sync",  editorButtonId: null,                     views: [] },
	{ key: "adventures",  label: "Abenteuer",   syncButtonId: "wiki-sync-sync-adventure",   editorButtonId: "adventure-editor-open",  views: [] },
	{ key: "citymaps",    label: "Karten",      syncButtonId: "wiki-sync-sync-citymap",     editorButtonId: "citymaps-editor-open",   views: [] },
	// Label "Vorkommen", key stays `lore`: renaming the key buys nothing but a chance to miss
	// one place (same reasoning as index.html:383). Here label and key even agree.
	{ key: "lore",        label: "Vorkommen",   syncButtonId: "wiki-sync-sync-lore",        editorButtonId: "wiki-sync-lore-open",    views: WIKI_SYNC_LORE_VIEWS },
];

function wikiSyncSubjectByKey(key) {
	return WIKI_SYNC_SUBJECTS.find((subject) => subject.key === key) || null;
}

function wikiSyncIsKnownSubject(key) {
	return wikiSyncSubjectByKey(key) !== null;
}

function wikiSyncSubjectVerbs(key) {
	const subject = wikiSyncSubjectByKey(key);
	if (!subject) return [];
	const verbs = [{ id: subject.syncButtonId, label: "Syncen", primary: true }];
	if (subject.editorButtonId) {
		verbs.push({ id: subject.editorButtonId, label: "Bearbeiten", primary: false });
	}
	return verbs;
}

function wikiSyncSubjectViewTabs(key) {
	const subject = wikiSyncSubjectByKey(key);
	return subject ? subject.views : [];
}
```

- [ ] **Schritt 4: Test laufen lassen, Grün sehen**

Ausführen: `node tools/paths/test-review-subjects.mjs`
Erwartet: `review-subjects: OK`

- [ ] **Schritt 5: Skript einbinden**

In `index.html` die Zeile **unmittelbar vor** `js/review/review-wiki-sync.js` einfügen (Reihenfolge
ist Vertrag). Kein `?v=` von Hand:

```html
<script src="js/review/review-subjects.js"></script>
```

- [ ] **Schritt 6: Namenskollision ausschließen**

Ausführen: `grep -rn "WIKI_SYNC_SUBJECTS\|wikiSyncSubjectByKey" js/ --include=*.js`
Erwartet: nur Treffer in `js/review/review-subjects.js`.

- [ ] **Schritt 7: Commit**

```bash
git status
git commit --only -F - -- js/review/review-subjects.js tools/paths/test-review-subjects.mjs index.html <<'MSG'
feat(editor): add the WikiSync subject registry

Single data source for which subjects exist, which verbs they carry and
how their list divides. Nothing consumes it yet.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 2: `setWikiSyncPanelTab` datengetrieben

Heute steht in `js/review/review-wiki-sync.js:235` eine harte Whitelist:

```js
activeWikiSyncPanelTab = ["territories", "regions", "paths", "adventures"].includes(tabName) ? tabName : "locations";
```

Kommt ein Schlüssel nicht darin vor, fällt das Panel **still** auf „Siedlungen" zurück. Genau so
ging die Reiter-Kaskade schon einmal kaputt. `powerlines`, `citymaps` und `lore` werden gleich
Subjekte — ohne diesen Schritt wären sie unerreichbar.

**Dateien:**
- Ändern: `js/review/review-wiki-sync.js:234-270`
- Anlegen: `tools/paths/test-wiki-sync-panel-tab.mjs`

**Schnittstellen:**
- Nutzt: `wikiSyncIsKnownSubject` aus Aufgabe 1
- Liefert: `setWikiSyncPanelTab(key)` akzeptiert alle acht Schlüssel; unbekannte fallen auf
  `locations`

- [ ] **Schritt 1: Test schreiben (schlägt fehl)**

`tools/paths/test-wiki-sync-panel-tab.mjs`:

```js
// Unit test (Node, no build) for setWikiSyncPanelTab in js/review/review-wiki-sync.js.
//
// The function is sliced out of the file and run in a vm context against a fake DOM, the same
// approach as tools/paths/test-review-tab-cascade.mjs. Slicing the REAL function matters: the
// regression this guards against was a hardcoded value list, and a test that restated the list
// would have passed happily.
//
// Run: node tools/paths/test-wiki-sync-panel-tab.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = readFileSync(path.join(repoRoot, "js", "review", "review-wiki-sync.js"), "utf8");

function sliceFunction(name) {
	const start = source.indexOf(`function ${name}(`);
	assert.ok(start >= 0, `function ${name} not found`);
	let depth = 0;
	for (let i = source.indexOf("{", start); i < source.length; i += 1) {
		if (source[i] === "{") depth += 1;
		else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
	}
	throw new Error(`unbalanced braces in ${name}`);
}

const fakeNode = (dataset) => ({
	dataset,
	classList: { toggle(name, on) { this[name] = Boolean(on); } },
	setAttribute() {},
});
const tabNodes = ["locations", "territories", "regions", "paths", "powerlines", "adventures", "citymaps", "lore"]
	.map((key) => fakeNode({ wikiSyncPanelTab: key }));

const context = vm.createContext({
	document: {
		querySelectorAll: (selector) => (selector.includes("panel-tab") ? tabNodes : []),
	},
	console,
});
vm.runInContext(readFileSync(path.join(repoRoot, "js", "review", "review-subjects.js"), "utf8"), context);
vm.runInContext("let activeWikiSyncPanelTab = 'locations';", context);
// The lazy loaders are optional in the real file (typeof … === "function"); leaving them
// undefined here is the honest case and must not throw.
vm.runInContext(sliceFunction("setWikiSyncPanelTab"), context);

const active = () => vm.runInContext("activeWikiSyncPanelTab", context);
const set = (key) => vm.runInContext(`setWikiSyncPanelTab(${JSON.stringify(key)})`, context);

// Every registry key must survive the round trip. These three are the new ones: powerlines had
// no tab at all, citymaps and lore were sub-tabs under "Materialien".
["locations", "territories", "regions", "paths", "powerlines", "adventures", "citymaps", "lore"]
	.forEach((key) => {
		set(key);
		assert.equal(active(), key, `${key} must not fall back silently`);
	});

// Unknown keys still fall back, and never throw.
["materials", "", "nope", null, undefined].forEach((key) => {
	set(key);
	assert.equal(active(), "locations", `unknown key ${String(key)} falls back to locations`);
});

// The active class really lands on the matching tab node and nowhere else.
set("lore");
assert.equal(tabNodes.find((n) => n.dataset.wikiSyncPanelTab === "lore").classList["is-active"], true);
assert.equal(tabNodes.find((n) => n.dataset.wikiSyncPanelTab === "paths").classList["is-active"], false);

console.log("wiki-sync-panel-tab: OK");
```

- [ ] **Schritt 2: Test laufen lassen, Rot sehen**

Ausführen: `node tools/paths/test-wiki-sync-panel-tab.mjs`
Erwartet: `AssertionError: powerlines must not fall back silently`

- [ ] **Schritt 3: Whitelist ersetzen**

In `js/review/review-wiki-sync.js` Zeile 235 ersetzen durch:

```js
	// Valid = "the registry knows it" (js/review/review-subjects.js). Never a literal list here:
	// a key missing from such a list makes its tab silently fall back to Siedlungen, which is how
	// the tab cascade broke once already (spec 2026-07-17-editor-reiter-kaskade-design.md).
	activeWikiSyncPanelTab = wikiSyncIsKnownSubject(tabName) ? tabName : "locations";
```

- [ ] **Schritt 4: Lazy-Load-Kette auf eine Tabelle ziehen**

Die `if/else if`-Kette ab Zeile 247 ersetzen. Die drei neuen Subjekte laden dieselben Listen wie
bisher, nur von oberster Ebene aus:

```js
	// Which list to (lazily) load for which subject. Loaders stay optional -- some are defined in
	// files that only load in edit mode, so a missing one must be skipped, not crash.
	const loaders = {
		territories: () => renderWikiSyncTerritoryTree(),
		regions: () => (typeof loadRegionWikiSync === "function") && loadRegionWikiSync(),
		paths: () => (typeof loadPathWikiSync === "function") && loadPathWikiSync(),
		adventures: () => (typeof loadWikiSyncAdventureList === "function") && loadWikiSyncAdventureList(),
		citymaps: () => (typeof loadWikiSyncCitymapList === "function") && loadWikiSyncCitymapList(),
		lore: () => (typeof loadWikiSyncLoreList === "function") && loadWikiSyncLoreList(),
	};
	if (loaders[activeWikiSyncPanelTab]) {
		void loaders[activeWikiSyncPanelTab]();
	}
```

> ⚠️ Die alte `adventures`-Zweig lud die Kartenliste **mit**, damit beide Pillen sofort ihre Zahl
> zeigten. Das entfällt bewusst: Karten ist jetzt ein eigenes Subjekt mit eigener Zeile und lädt
> beim eigenen Klick. Falls die Zahl in der Auswahlzeile sofort stehen soll, kommt sie aus dem
> Zähler-Endpunkt, nicht aus einem Mitladen.

- [ ] **Schritt 5: Beide Tests laufen lassen**

```
node tools/paths/test-wiki-sync-panel-tab.mjs
node tools/paths/test-review-tab-cascade.mjs
```
Erwartet: `wiki-sync-panel-tab: OK` und der Kaskadentest weiter grün.

- [ ] **Schritt 6: Commit**

```bash
git status
git commit --only -F - -- js/review/review-wiki-sync.js tools/paths/test-wiki-sync-panel-tab.mjs <<'MSG'
fix(editor): derive valid panel tabs from the registry, not a literal list

powerlines, citymaps and lore are about to become top-level subjects. The
hardcoded whitelist would have made all three fall back to Siedlungen
without a word -- the same failure the tab cascade had.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 3: Zweispaltige Auswahl

Ersetzt die waagerechte Reiterzeile (Ebene 2). „Materialien" verschwindet; `citymaps` und `lore`
werden aus der Abenteuer-Sektion herausgezogen und eigene Sektionen.

**Dateien:**
- Ändern: `index.html:378-388` (die `<nav>`), `index.html:402-470` (Sektionen umhängen)
- Ändern: `css/features/review-panel.css`
- Ändern: `js/review/review-wiki-sync.js` (Auswahl rendern)

**Schnittstellen:**
- Nutzt: `WIKI_SYNC_SUBJECTS`, `wikiSyncSubjectByKey`
- Liefert: `renderWikiSyncSubjectRail()`; Container `#wiki-sync-subject-rail`

- [ ] **Schritt 1: Markup ersetzen**

`index.html:378-388` — die `<nav class="wiki-sync-panel__tabs">` mitsamt ihren fünf Knöpfen
ersetzen durch den leeren Container (die Zeilen baut JS aus der Registry):

```html
					<nav class="wiki-sync-rail" id="wiki-sync-subject-rail" aria-label="WikiSync-Subjekte"></nav>
```

- [ ] **Schritt 2: Sektionen hochziehen**

Die beiden `div[data-material-subtab-section="citymaps"]` und `="lore"` aus der
`data-wiki-sync-panel-section="adventures"`-Sektion herausnehmen und zu Geschwistern machen.
**Der Inhalt beider Blöcke wandert unverändert mit** — nur das öffnende Tag ändert sich, alle
inneren IDs bleiben, damit die bestehenden Renderer sie weiter finden:

```html
<!-- vorher -->
<div class="wiki-sync-panel__tab-panel" data-material-subtab-section="citymaps">
<!-- nachher -->
<div class="wiki-sync-panel__tab-panel" data-wiki-sync-panel-section="citymaps">
```

Dasselbe für `lore`.

Die Pillenzeile `div.wiki-sync-panel__tabs` mit den drei `data-material-subtab`-Knöpfen
(`index.html:406-409`) **ersatzlos löschen** — dafür ist die Auswahl jetzt da.
Eine neue leere Sektion `data-wiki-sync-panel-section="powerlines"` anlegen (Inhalt: die
Kraftlinien-Kachel aus `index.html:364-366`, die dort oben nicht mehr hingehört).

- [ ] **Schritt 3: CSS**

An `css/features/review-panel.css` anhängen:

```css
/* Two-column subject selection. Eight subjects in four rows instead of eight: measured 126px
   instead of 249px, which is roughly half a panel height handed back to the list. */
.wiki-sync-rail {
	display: grid;
	grid-template-columns: 1fr 1fr;
	margin: 8px 10px 0;
	border-top: 1px solid var(--color-divider);
}
.wiki-sync-rail__row {
	display: grid;
	grid-template-columns: 1fr auto auto;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 7px 8px 7px 10px;
	border: 0;
	border-left: 3px solid transparent;
	border-bottom: 1px solid var(--color-divider);
	background: none;
	color: var(--color-text-muted);
	font: inherit;
	font-size: 13px;
	text-align: left;
	cursor: pointer;
}
.wiki-sync-rail__row:hover {
	background: var(--color-panel-muted);
	color: var(--color-text-strong);
}
.wiki-sync-rail__row.is-active {
	border-left-color: var(--color-accent);
	background: var(--color-panel-muted);
	color: var(--color-text-strong);
	font-weight: 700;
}
/* Column separator as an inset shadow, NOT border-left: border-left is already the active
   marker on this row and would be overwritten. */
.wiki-sync-rail > .wiki-sync-rail__row:nth-child(2n) {
	box-shadow: inset 1px 0 0 var(--color-divider);
}
.wiki-sync-rail__count { font-variant-numeric: tabular-nums; font-weight: 400; }
.wiki-sync-rail__date {
	min-width: 46px;
	text-align: right;
	font-variant-numeric: tabular-nums;
	font-weight: 400;
	font-size: 11px;
	color: var(--color-text-muted);
}
```

- [ ] **Schritt 4: Auswahl rendern**

In `js/review/review-wiki-sync.js` ergänzen und aus `setWikiSyncPanelTab` am Ende aufrufen:

```js
// Renders the subject selection from the registry. Count and last-synced come from the callers
// that already fetch them (renderWikiSyncKindProgress, refreshWikiSyncKindSyncedStatus); a
// missing value shows as an em dash rather than inventing a zero.
function renderWikiSyncSubjectRail(counts, syncedDates) {
	const host = document.getElementById("wiki-sync-subject-rail");
	if (!host) return;
	host.innerHTML = "";
	WIKI_SYNC_SUBJECTS.forEach((subject) => {
		const count = counts && counts[subject.key];
		const date = syncedDates && syncedDates[subject.key];
		const row = document.createElement("button");
		row.type = "button";
		row.className = "wiki-sync-rail__row" + (subject.key === activeWikiSyncPanelTab ? " is-active" : "");
		row.setAttribute("data-wiki-sync-panel-tab", subject.key);
		row.innerHTML =
			'<span>' + escapeHtml(subject.label) + '</span>'
			+ '<span class="wiki-sync-rail__count">'
			+ (typeof count === "number" ? count.toLocaleString("de-DE") : "—") + '</span>'
			+ '<span class="wiki-sync-rail__date">' + escapeHtml(date || "") + '</span>';
		row.addEventListener("click", () => setWikiSyncPanelTab(subject.key));
		host.appendChild(row);
	});
}
```

> ⚠️ `data-wiki-sync-panel-tab` MUSS am Knopf stehen — die Reiter-Kaskade erkennt Reiter genau
> daran (`js/ui/ui-controls.js:542`), und `setWikiSyncPanelTab` markiert darüber den aktiven.

- [ ] **Schritt 5: Zahlen und Datum anschließen**

`renderWikiSyncSubjectRail` bekommt seine Werte nicht von selbst. Beide Schreiber, die es heute
schon gibt, müssen die Auswahl neu zeichnen — sonst steht dauerhaft „—" in jeder Zeile:

- `refreshWikiSyncKindSyncedStatus` (beim Laden) — liefert die Sync-Daten aus
  `avesmapsWikiDumpSyncKindLastSynced`
- `renderWikiSyncKindProgress` (nach einem Lauf)

In beiden am Ende ergänzen:

```js
	renderWikiSyncSubjectRail(wikiSyncSubjectCounts, wikiSyncSubjectSyncedDates);
```

Dazu die beiden Sammelobjekte oben in der Datei anlegen und dort füllen, wo die Werte heute schon
ankommen:

```js
// Filled by the two writers below; the rail reads them. A key that never arrives stays absent
// and renders as an em dash -- never as a zero, which would claim "we know: none".
var wikiSyncSubjectCounts = {};
var wikiSyncSubjectSyncedDates = {};
```

> ⚠️ Zwei Leer-Fälle nicht vermengen: **kein Schlüssel** heißt „dazu kam keine Antwort" (→ „—"),
> **`null` vom Server** heißt „nachweislich nie gesynct" (→ „Noch nie gesynct"). Dieselbe
> Sorgfalt wie beim heutigen Sync-Datum-Feld.

- [ ] **Schritt 6: Prüfen (ohne Login)**

Lokalen Server starten, `?edit=1` öffnen, dann in der Konsole:

```js
document.querySelectorAll('.wiki-sync-rail__row').length          // 8
getComputedStyle(document.getElementById('wiki-sync-subject-rail')).gridTemplateColumns  // zwei Spalten
document.getElementById('wiki-sync-subject-rail').getBoundingClientRect().height          // ~126
```

- [ ] **Schritt 7: Commit**

```bash
git status
git commit --only -F - -- index.html css/features/review-panel.css js/review/review-wiki-sync.js <<'MSG'
feat(editor): replace the level-2 tab strip with a two-column subject rail

"Materialien" existed because a sixth horizontal tab needed 81px and only
22px were left. A vertical rail has no width budget, so Abenteuer, Karten
and Vorkommen become siblings and Kraftlinien finally gets its own row.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 4: Verbzeile — und der Knopf, der lügt

**Dateien:**
- Ändern: `index.html` (Verbzeilen-Container), `js/review/review-wiki-sync.js`
- Ändern: `css/features/review-panel.css`
- Ändern: `html/editor-handbuch.html` (**Pflicht**, editor-sichtbar)

**Schnittstellen:**
- Nutzt: `wikiSyncSubjectVerbs(key)` aus Aufgabe 1

- [ ] **Schritt 1: Container + CSS**

Nach dem Rail-Container in `index.html`:

```html
					<div class="wiki-sync-verbs" id="wiki-sync-verbs"></div>
```

CSS anhängen:

```css
/* Verb row: fixed order Syncen, then Bearbeiten. Four of the eight subjects have no list
   editor, and there Syncen carries the row alone -- deliberately no greyed placeholder, a dead
   button explains nothing and invites a click. */
.wiki-sync-verbs {
	display: grid;
	grid-auto-flow: column;
	grid-auto-columns: minmax(0, 1fr);
	gap: 6px;
	margin: 10px;
}
.wiki-sync-verbs__btn {
	padding: 7px 6px;
	font: inherit;
	font-size: 12.5px;
	text-align: center;
	white-space: nowrap;
	cursor: pointer;
	border-radius: var(--radius-md);
	background: var(--color-button-soft);
	color: var(--color-button-soft-text);
	border: 1px solid var(--color-button-soft-border);
}
.wiki-sync-verbs__btn:hover { background: var(--color-button-soft-hover); }
.wiki-sync-verbs__btn--primary {
	background: var(--color-button);
	color: var(--color-button-text);
	border-color: var(--color-button-border);
	font-weight: var(--font-weight-bold);
}
```

- [ ] **Schritt 2: Verbzeile rendern**

```js
// The verbs of the selected subject. They delegate to the buttons that already exist and are
// still in the markup (hidden), so all wiring, busy labels and progress handling stay untouched.
function renderWikiSyncVerbs() {
	const host = document.getElementById("wiki-sync-verbs");
	if (!host) return;
	host.innerHTML = "";
	wikiSyncSubjectVerbs(activeWikiSyncPanelTab).forEach((verb) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "wiki-sync-verbs__btn" + (verb.primary ? " wiki-sync-verbs__btn--primary" : "");
		button.textContent = verb.label;
		button.addEventListener("click", () => {
			const target = document.getElementById(verb.id);
			if (target) target.click();
		});
		host.appendChild(button);
	});
}
```

- [ ] **Schritt 3: Den lügenden Knopf umbeschriften**

`index.html:524` trägt „Territorien bearbeiten", startet aber laut `js/app/bootstrap.js:275`
einen Sync. Beschriftung geradeziehen:

```html
						<button id="wiki-sync-territories" class="wiki-sync-panel__start" type="button" title="Übernimmt die Territorien aus dem zuletzt geholten Dump in die Staging-Tabellen. Öffnet KEINEN Editor — für Territorien gibt es keinen Listeneditor."><span class="t1">Syncen</span><span id="wiki-sync-territory-synced" class="wiki-sync-panel__summary" hidden></span></button>
```

- [ ] **Schritt 4: Handbuch nachziehen (Pflicht, gleicher Commit)**

In `html/editor-handbuch.html` jede Stelle korrigieren, die „Territorien bearbeiten" nennt, und
den Satz ergänzen, dass Territorien, Regionen, Wege und Kraftlinien **nur gesynct** werden.
`Stand:`-Datum in der Kopfzeile auf das heutige setzen.

Finden mit: `grep -n "Territorien bearbeiten\|Stand:" html/editor-handbuch.html`

- [ ] **Schritt 5: Prüfen**

`?edit=1`, Konsole:

```js
['locations','territories','regions','paths','powerlines','adventures','citymaps','lore']
  .map(k => { setWikiSyncPanelTab(k); return k + ': ' +
    [...document.querySelectorAll('.wiki-sync-verbs__btn')].map(b => b.textContent).join('|'); })
// erwartet: vier mit "Syncen", vier mit "Syncen|Bearbeiten"
```

- [ ] **Schritt 6: Commit**

```bash
git status
git commit --only -F - -- index.html css/features/review-panel.css js/review/review-wiki-sync.js html/editor-handbuch.html <<'MSG'
feat(editor): add the verb row and stop the territory button from lying

"Territorien bearbeiten" started a sync run (bootstrap.js:275) and opened
no editor. Four of eight subjects have no list editor at all, so there the
row carries Syncen alone rather than a dead second button.

Handbook updated in the same commit (AGENTS.md §9).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 5: Eine Reiterzeile für die Liste

Die vier bestehenden `#*-sync-tabs`-Hosts und die Lore-Reiter ziehen in **einen** Container. Die
Panel-Kopie von `data-lore-kind` verschwindet; **die Dialog-Reiter `data-lore-dlg-kind` bleiben.**

**Dateien:**
- Ändern: `index.html` (ein Container statt vier Hosts; `index.html:438-443` löschen)
- Ändern: `js/review/review-wiki-sync.js`, `review-path-sync.js`, `review-region-sync.js`,
  `review-settlement-list.js` (in den gemeinsamen Container rendern)
- Ändern: `html/editor-handbuch.html`

- [ ] **Schritt 1: Gemeinsamen Container anlegen**

Direkt über der Liste, unter der Suchzeile:

```html
					<div class="wiki-sync-panel__tabs wiki-sync-views" id="wiki-sync-view-tabs"></div>
```

- [ ] **Schritt 2: Die vier Renderer umhängen**

Beschriftungen und Zähler bleiben unverändert — sie stimmen und sind getestet. Nur der
Zielcontainer wechselt. Exakt vier Stellen:

| Datei:Zeile | heute | neu |
|---|---|---|
| `review-path-sync.js:249` | `pathSyncElement("path-sync-tabs")` | `document.getElementById("wiki-sync-view-tabs")` |
| `review-region-sync.js:208` | `regionSyncElement("region-sync-tabs")` | `document.getElementById("wiki-sync-view-tabs")` |
| `review-settlement-list.js:200` | `document.getElementById("settlement-list-tabs")` | `document.getElementById("wiki-sync-view-tabs")` |
| `review-wiki-sync.js:309` | `document.getElementById("wiki-sync-territory-tabs")` | `document.getElementById("wiki-sync-view-tabs")` |

> ⚠️ Die ersten beiden gehen heute über die Helfer `pathSyncElement` / `regionSyncElement`. Die
> suchen innerhalb ihrer eigenen Sektion — der gemeinsame Container liegt außerhalb, also hier
> bewusst `document.getElementById` verwenden und nicht den Helfer erweitern.

Die vier alten leeren Container (`#path-sync-tabs`, `#region-sync-tabs`, `#settlement-list-tabs`,
`#wiki-sync-territory-tabs`) danach aus `index.html` entfernen.

- [ ] **Schritt 3: Lore-Reiter aus dem Panel entfernen**

`index.html:438-443` (die `div.wiki-sync-panel__tabs` mit `data-lore-kind`) **ersatzlos löschen**.
Stattdessen rendert Lore in denselben Container.

> 💣 **Hier wird eine bestehende Entscheidung bewusst umgekehrt — und ihr Kommentar muss mit.**
> `js/review/review-wiki-sync.js:1854` sagt heute: *„Nur das Fenster kennt ‚spezies': der
> Menüband-Schalter steuert die öffentliche Anzeige, nicht die Bearbeitbarkeit. Im Reiter bleiben
> die drei sichtbaren Arten."* Der Panel-Reiter zeigt also absichtlich **drei** Arten. Der Owner
> hat 2026-07-22 entschieden, Spezies auch im Panel zu zeigen — **ausgegraut**. Wer nur das
> Rendering ändert und den Kommentar stehen lässt, produziert die nächste Sitzung, die es
> „aufräumend" zurückbaut. Kommentar im selben Commit auf den neuen Stand bringen.

Der Zustand liegt in `avesmapsLoreListKind` — einem Objekt **je Ansicht** (`{ panel, dialog }`),
weil Panel und Fenster dieselbe Logik über `AVESMAPS_LORE_VIEWS` teilen und sich nur in den
Element-IDs unterscheiden. Diese Trennung nicht auflösen:

```js
// Vorkommen renders its kinds into the SAME strip every other subject uses. Spezies is greyed
// rather than absent: public display is off (owner 2026-07-21) but the data is complete and
// stays editable. The reason lives in the tooltip -- a greyed surface without one gets flipped
// back by someone tidying up.
function renderWikiSyncLoreViewTabs(countsByKind) {
	const host = document.getElementById("wiki-sync-view-tabs");
	if (!host) return;
	const activeKind = avesmapsLoreListKind.panel;
	host.innerHTML = wikiSyncSubjectViewTabs("lore").map((view) => {
		const count = view.key === "all"
			? Object.values(countsByKind || {}).reduce((sum, n) => sum + n, 0)
			: (countsByKind || {})[view.key];
		return '<button type="button" data-lore-kind="' + view.key + '"'
			+ ' class="wiki-sync-panel__tab' + (view.off ? " is-off" : "")
			+ (activeKind === view.key ? " is-active" : "") + '"'
			+ (view.off ? ' title="' + escapeHtml(view.reason) + '"' : "")
			+ '>' + escapeHtml(view.label)
			+ ' <span class="wiki-sync-panel__tab-count">('
			+ (typeof count === "number" ? count.toLocaleString("de-DE") : "?") + ')</span></button>';
	}).join("");
}
```

> ⚠️ Der Streifen kennt jetzt den Schlüssel `all`, den `avesmapsLoreListKind` bisher nie hatte
> (Default war `"fauna"`). Der Listenabruf muss `all` als „keine Art-Einschränkung" behandeln —
> sonst filtert er auf eine Art namens `all` und die Liste ist leer.

CSS anhängen:

```css
/* Greyed = not shown publicly (today only Spezies). Still editable, hence greyed and not gone. */
.wiki-sync-views .wiki-sync-panel__tab.is-off { opacity: 0.5; }
```

- [ ] **Schritt 4: Handbuch nachziehen**

Der Abschnitt zu Natur & Waren beschreibt heute Reiter im Panel. Auf „die Arten stehen als Reiter
über der Liste" umschreiben, `Stand:` setzen.

- [ ] **Schritt 5: Prüfen**

`?edit=1`, Konsole:

```js
setWikiSyncPanelTab('paths');
[...document.querySelectorAll('#wiki-sync-view-tabs button')].map(b => b.textContent.trim())
// erwartet fünf: Alle | Platziert | Fehlt | Konflikte | Flussrichtung unbekannt
setWikiSyncPanelTab('adventures');
document.getElementById('wiki-sync-view-tabs').children.length   // 0 -- keine erfundene "Alle"
document.querySelectorAll('[data-lore-kind]').length              // nur die im Reiterstreifen
document.querySelectorAll('[data-lore-dlg-kind]').length          // 4 -- Dialog UNBERÜHRT
```

- [ ] **Schritt 6: Commit**

```bash
git status
git commit --only -F - -- index.html js/review/review-wiki-sync.js js/review/review-path-sync.js js/review/review-region-sync.js js/review/review-settlement-list.js css/features/review-panel.css html/editor-handbuch.html <<'MSG'
refactor(editor): collapse four tab hosts and the lore kinds into one strip

There is now exactly one tab strip, and it belongs to the list rather than
to navigation. The panel's copy of the lore kinds is gone; the dialog's
own tabs (data-lore-dlg-kind) are untouched -- that duplication was the
point of the exercise.

Handbook updated in the same commit (AGENTS.md §9).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 6: Filter nachrüsten

Abenteuer, Karten, Vorkommen und Kraftlinien haben heute nur eine Suche. Die Komponente
`.type-filter` (`css/features/review-panel.css:930`) existiert — **anhängen, nicht nachbauen**.

> ⚠️ Die Facetten dieser vier sind in der Spec §10 als **nicht owner-abgestimmt** markiert. Vor
> dem Bau kurz bestätigen lassen; im Muster tragen sie die Marke `NEU`.

**Dateien:**
- Ändern: `js/review/review-subjects.js` (Feld `facets` je Subjekt)
- Ändern: `index.html` (Filterknopf in die vier Suchzeilen)
- Ändern: `tools/paths/test-review-subjects.mjs` (Facetten mit abdecken)

- [ ] **Schritt 1: Test erweitern**

Ans Ende von `test-review-subjects.mjs`, vor die Erfolgsmeldung:

```js
// --- filter facets ----------------------------------------------------------------------
const facets = (k) => vm.runInContext(`wikiSyncSubjectFacets(${JSON.stringify(k)})`, context);

assert.deepEqual(facets("locations").map((f) => f.title), ["Typ", "Kontinent", "Quelle"]);
assert.deepEqual(facets("lore").map((f) => f.title), ["Art", "Quelle"]);
assert.deepEqual(facets("citymaps").map((f) => f.title), ["Zugang", "Vorschau", "Herkunft"]);
assert.deepEqual(facets("nonsense"), []);

// The "Art" facet only exists on the mixed list. Once a kind is preselected it is spent, and
// the kind-specific facet takes over -- "Gegenstandstyp" cannot exist in a mixed list because
// its field is rendered only for kind==='ware' (review-wiki-sync.js:2168).
const wareFacets = vm.runInContext(`wikiSyncSubjectFacets("lore", "ware")`, context);
assert.deepEqual(wareFacets.map((f) => f.title), ["Gegenstandstyp", "Quelle"]);
assert.ok(!wareFacets.some((f) => f.title === "Art"), "Art is spent once a kind is chosen");
```

- [ ] **Schritt 2: Rot sehen**

Ausführen: `node tools/paths/test-review-subjects.mjs`
Erwartet: `ReferenceError: wikiSyncSubjectFacets is not defined`

- [ ] **Schritt 3: Facetten ergänzen**

In `js/review/review-subjects.js`:

```js
const WIKI_SYNC_CONTINENT_FACET = { title: "Kontinent", values: ["Aventurien", "Myranor", "Uthuria"] };
const WIKI_SYNC_SOURCE_FACET = { title: "Quelle", values: ["Wiki", "von Hand", "Community"] };

// Facets per subject; for `lore` also per preselected kind, because the kinds do not share a
// field set. Second argument is the active view key ("all" or a lore kind).
function wikiSyncSubjectFacets(key, viewKey) {
	const subject = wikiSyncSubjectByKey(key);
	if (!subject) return [];
	if (key === "lore" && viewKey && viewKey !== "all") {
		const perKind = {
			fauna: [{ title: "Lebensraum", values: ["Wald", "Gebirge", "Gewässer", "Steppe"] }],
			flora: [{ title: "Lebensraum", values: ["Wald", "Gebirge", "Sumpf", "Wüste"] }],
			ware: [{ title: "Gegenstandstyp", values: ["Rohstoff", "Handwerk", "Nahrung", "Luxus"] }],
			spezies: [],
		};
		return (perKind[viewKey] || []).concat([WIKI_SYNC_SOURCE_FACET]);
	}
	return subject.facets || [];
}
```

Und je Subjekt ein `facets`-Feld ergänzen, z. B.:

```js
	{ key: "locations", …, facets: [{ title: "Typ", values: ["Metropole", "Großstadt", "Stadt", "Kleinstadt", "Dorf", "Gebäude"] }, WIKI_SYNC_CONTINENT_FACET, WIKI_SYNC_SOURCE_FACET] },
	{ key: "citymaps",  …, facets: [{ title: "Zugang", values: ["frei", "kostenpflichtig", "unbekannt"] }, { title: "Vorschau", values: ["vorhanden", "fehlt"] }, { title: "Herkunft", values: ["Wiki", "von Hand", "unterdrückt"] }] },
	{ key: "lore",      …, facets: [{ title: "Art", values: ["Fauna", "Flora", "Waren", "Spezies"] }, WIKI_SYNC_SOURCE_FACET] },
```

- [ ] **Schritt 4: Grün sehen**

Ausführen: `node tools/paths/test-review-subjects.mjs`
Erwartet: `review-subjects: OK`

- [ ] **Schritt 5: Filterknopf anhängen**

In die vier Suchzeilen ohne Filter (Abenteuer, Karten, Vorkommen, Kraftlinien) je diesen Block —
`<subject>` durch den Subjektschlüssel ersetzen. Die Abschnitte baut JS aus
`wikiSyncSubjectFacets`, das Markup liefert nur die Hülle:

```html
								<div class="type-filter">
									<button type="button" id="<subject>-filter-toggle" class="type-filter__toggle" aria-label="Filter">Filter ▾</button>
									<div id="<subject>-filter-menu" class="type-filter__menu" hidden></div>
								</div>
```

Die Zahl aktiver Filter gehört **in den Knopf** („Filter (2) ▾", Rand `--color-accent`), kein
Chip-Band darunter — das schöbe die Liste bei jedem Filter nach unten. Das Menü ist
`position: absolute` und liegt bereits über der Liste; das darf nicht auf `static` geändert werden.

- [ ] **Schritt 6: Commit**

```bash
git status
git commit --only -F - -- js/review/review-subjects.js tools/paths/test-review-subjects.mjs index.html <<'MSG'
feat(editor): give the four remaining lists a filter

Abenteuer, Karten, Vorkommen and Kraftlinien had a search box and nothing
else; the .type-filter component already existed and is reused, not
rebuilt. Facets are data per subject, and for Vorkommen per kind.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG
```

---

## Aufgabe 7: Umbenennungen und Kaskade aufräumen

**Dateien:**
- Ändern: `js/review/review-wiki-sync.js:2167` (Feldlabel), `js/ui/ui-controls.js:541-548`
- Ändern: `html/editor-handbuch.html:876` und alle „Natur & Waren"-Stellen
- Ändern: `tools/paths/test-review-tab-cascade.mjs`

- [ ] **Schritt 1: Namenskollision auflösen**

`review-wiki-sync.js:2167` beschriftet die Spalte `gruppe` als „Art" — und die neue Facette heißt
auch „Art". Das **Feld** wird umbenannt, weil es seiner eigenen Spalte widerspricht:

```js
		+ loreFieldRow(entry, "gruppe", "Gruppe")
```

- [ ] **Schritt 2: Kaskade aufräumen**

In `js/ui/ui-controls.js` den Eintrag `data-material-subtab` streichen (die Ebene existiert nicht
mehr) und den gespeicherten Wert vergessen lassen — `restoreReviewTabFamily` tut das bereits von
selbst, wenn kein Knopf den Wert trägt. **Keine Werteliste ergänzen.**

- [ ] **Schritt 3: Kaskadentest anpassen**

In `tools/paths/test-review-tab-cascade.mjs` den Pfad
`["data-editor-panel-tab=wiki-sync", "data-wiki-sync-panel-tab=adventures", "data-material-subtab=citymaps"]`
ersetzen durch den jetzt zweistufigen:

```js
		["data-editor-panel-tab=wiki-sync", "data-wiki-sync-panel-tab=citymaps"],
```

- [ ] **Schritt 4: Handbuch**

Alle „Natur & Waren" → „Vorkommen", `editor-handbuch.html:876` „Art" → „Gruppe",
`Stand:`-Datum setzen. Finden mit:
`grep -n "Natur & Waren\|Natur &amp; Waren\|Materialien" html/editor-handbuch.html`

- [ ] **Schritt 5: Alle Tests**

```
node tools/paths/test-review-subjects.mjs
node tools/paths/test-wiki-sync-panel-tab.mjs
node tools/paths/test-review-tab-cascade.mjs
```
Erwartet: dreimal `OK`.

- [ ] **Schritt 6: Commit**

```bash
git status
git commit --only -F - -- js/review/review-wiki-sync.js js/ui/ui-controls.js tools/paths/test-review-tab-cascade.mjs html/editor-handbuch.html <<'MSG'
refactor(editor): rename to Vorkommen and drop the dead material sub-tab

The lore field labelled "Art" showed column `gruppe` and collided with the
new filter facet of the same name; the field is the one that was wrong, so
it becomes "Gruppe". The material sub-tab family is gone from the cascade
-- no value list added, the DOM stays the authority.

Handbook updated in the same commit (AGENTS.md §9).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
MSG
```

---

## Abschluss

- [ ] `grep -rn "data-material-subtab\|Materialien\|data-lore-kind" index.html js/ css/` — es dürfen
      nur noch die Lore-Reiter im gemeinsamen Streifen und **kein** `data-material-subtab` übrig sein.
- [ ] Push, danach `git rev-parse --short origin/master` gegen HEAD prüfen (~1–2 min Deploy).
- [ ] 🔧 **Owner:** ein Durchgang je Subjekt auf der Live-Seite — Syncen auslösen, Editor öffnen,
      Reiter und Filter umschalten. Die Sync-Läufe brauchen einen angemeldeten Editor und einen
      frischen Dump; lokal ist davon nichts prüfbar (keine DB).
- [ ] 🔧 **Owner:** Facetten aus Aufgabe 6 gegenlesen (Spec §10).
