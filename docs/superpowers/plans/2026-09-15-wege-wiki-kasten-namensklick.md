# Wege: ein Kasten „Wiki-Weg“ · Namensklick · Auswahl in Gold — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die markierte Straße bzw. der markierte Abschnitt leuchtet in der Farbe markierter Orte; eine entfernte weitere Zuweisung verschwindet auch bei anderen Editoren; „Ganze Straße“ nennt nur Orte. Im Bearbeiten-Modus markiert ein Klick auf den Namen eines Wiki-Wegs die Straße. Die Wiki-Zuweisung eines Wegs steht in EINEM Kasten „Wiki-Weg“ mit der Liste der weiteren Zuweisungen darin — am Abschnitt, auf der Weg-Ebene und im Kartendialog —, und die Weg-Ebene schreibt Zuweisen/Entfernen auf genau ihre Abschnitte.

**Architecture:** Drei Lieferungen. **A** ändert eine Server-Regel (`[]` statt `unset`), die Farbquelle der Auswahl und die eine Streckenregel `wpGanzeStrecke`. **B** gibt dem Wegnamen-Overlay einen Treffer-Ausgang, der Tastatur ihre Werkzeugfrage und der Wege-Auswahl EINEN Karten-Klick-Zuhörer, der entweder den Linien-Klick des nächsten Abschnitts auslöst oder die Auswahl aufhebt. **C** gibt `assign_to`/`clear_assign` die optionale Angabe `public_ids`, dem geteilten Bauteil `js/ui/wiki-assign.js` eine opt-in-Einhängestelle `anhang`, macht den Kasten „Weitere Wiki-Zuweisungen“ zu einem eingebetteten Teil und montiert beides an allen Stellen neu. Regeln stehen rein und werden ausgeführt getestet; Verdrahtung wird mit Attrappen gefahren.

**Tech Stack:** Vanilla JS ohne Build (klassische Skripte, globale Funktionen, `module.exports`-Wache für Node-Tests), PHP 8 strict types, MariaDB 11.8 live (Tests gegen SQLite), Leaflet 1.9.4.

**Spec:** `docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md` — maßgeblich ist **§9 (Nachtrag 15.09.2026)**, wo er früheren Abschnitten widerspricht. Mockup `docs/wege-mehrfachzuweisung-mockup.html` (Dialoge Z. 180–311). Vorgänger-Bauplan `docs/superpowers/plans/2026-09-14-wege-mehrfachzuweisung.md`.

## Global Constraints

- **Owner-Entscheide (Nachtrag §9.0):** ein Kasten „Wiki-Weg“ mit Liste; die Weg-Ebene bekommt ihren eigenen · Namensklick im Bearbeiten-Modus markiert die Straße · Auswahl in `--color-marker-active`, „Anzeigen“ bleibt `SPOTLIGHT_PATH_HIGHLIGHT_STYLE` (`#ffd72e`, NICHT ändern) · `api/edit/wiki/paths.php` bleibt bei Fähigkeit `review` (kein Code-Umbau) · `MAX_SHARED_WAYPOINTS = 25` und „Weg als Route nur mit Wiki-Artikel“ bleiben.
- **Die Hauptzuweisung bleibt Identität** (E1/E2 des Entwurfs): Name nach R1, Gruppe, Kanon. Eine weitere Zuweisung ändert nie Name, Gruppe oder Art.
- **Nur-Editor-Vorlagen (`<template data-nur-editor>` in `index.html`, frisch gelesen am 15.09.2026, nur Tags am Zeilenanfang, Kommentare entfernt — 60 Dateien):**
  `js/review/review-feature-sources.js`, `js/review/review-list-balance.js`, `js/review/review-path-seasons.js`, `js/review/path-gruppe.js`, `js/review/review-paths.js`, `js/review/review-labels.js`, `js/review/review-panels.js`, `js/review/review-panels-change-log.js`, `js/review/review-region-sync.js`, `js/review/review-region-sync-ecosystem.js`, `js/review/review-path-sync.js`, `js/ui/wiki-assign-registry.js`, `js/ui/wiki-assign-diff.js`, `js/ui/wiki-feld-herkunft.js`, `js/ui/wiki-assign.js`, `js/ui/wiki-assign-weg.js`, `js/ui/wiki-assign-ort.js`, `js/ui/wiki-assign-landschaft.js`, `js/ui/wiki-assign-territorium.js`, `js/review/review-label-wiki.js`, `js/review/review-path-wiki.js`, `js/review/review-path-flow.js`, `js/review/review-subjects.js`, `js/review/review-settlement-wiki.js`, `js/review/review-settlement-list.js`, `js/review/review-powerline-list.js`, `js/review/review-ecosystem-list.js`, `js/review/review-path-editor-list.js`, `js/review/review-capitals-list.js`, `js/review/sync-plan-sheet.js`, `js/review/review-lore-rule.js`, `js/review/review-lore-zugehoerigkeit.js`, `js/review/review-lore-regeln.js`, `js/review/review-wiki-sync.js`, `js/review/review-wiki-sync-lore-list.js`, `js/review/review-link-check.js`, `js/review/review-citymap-autoget.js`, `js/review/review-game-literature-cover-autoget.js`, `js/review/review-wiki-sync-cases.js`, `js/review/review-conflicts.js`, `js/review/review-wiki-sync-resolve.js`, `js/review/review-region-wiki-picker.js`, `js/review/review-region-basics.js`, `js/review/review-region-parent-tree.js`, `js/review/review-region-assignment-state.js`, `js/review/review-region-assignment-ui.js`, `js/review/review-region-tabs-payload.js`, `js/review/review-region-save-flow.js`, `js/review/review-region-dialog-population.js`, `js/review/review-region-submit-flow.js`, `js/review/review-region-events.js`, `js/review/review-dialog-state.js`, `js/review/review-editor-submit.js`, `js/review/review-visitor-analytics.js`, `js/review/review-api-metrics.js`, `js/review/review-mail.js`, `js/review/review-social.js`, `js/review/review-garetien-label-vorschau.js`, `js/review/review-garetien-importer.js`, `js/review/review-garetien-karte.js`.
  Nachprüfen vor dem Bau: `node -e 'const s=require("fs").readFileSync("index.html","utf8").replace(/<!--[\s\S]*?-->/g,"");for(const v of s.matchAll(/<template data-nur-editor>([\s\S]*?)<\/template>/g))for(const t of (v[1].match(/<script src="[^"]+"><\/script>/g)||[]))console.log(t.match(/src="([^"?]+)/)[1])'`
- **Teil C von `js/app/__tests__/nur-editor-skripte.test.js`:** ein NORMAL geladenes Skript (hier: `js/map-features/map-features-weg-auswahl.js`, `js/map-features/weg-auswahl.js`, `js/map-features/map-features-path-label-canvas-overlay.js`, `js/app/keyboard-shortcuts.js`, `js/ui/wiki-weitere-kasten.js`, `js/pages/wege-editor-model.js`) darf einen Namen, der in einer der Vorlagen-Dateien definiert ist, nur mit `typeof`-Schutz in den fünf Zeilen davor nennen und nie als Wert durchreichen. Keine der hier neuen Funktionen in normalen Skripten ruft einen Vorlagen-Namen; Aufrufe von `review-paths.js`/`review-path-wiki.js` in normale Skripte sind erlaubt (umgekehrte Richtung). Dieser Test läuft in jedem Testfeld mit.
- **Keine Farbe, kein Radius, keine Schriftgröße von Hand** (AGENTS.md §12): nur Tokens aus `css/base/tokens.css`. Die Auswahlfarbe kommt aus `getLocationMarkerActiveColor()` (liest `--color-marker-active`); in JS wird kein neuer Hex-Wert geschrieben.
- **Sprache:** Kommentare, Doku und Commit-Nachrichten deutsch; `error.code` bleibt englisch; sichtbare Texte deutsch. PHP-Ausnahmetexte in diesem Endpunkt sind englisch (Hausstil der Datei).
- **Zeilenenden:** Index LF (`attr/text`), Arbeitskopie auf dieser Maschine CRLF (`core.autocrlf=true`), Deploy-Tor (`actions/checkout`) LF. Jeder Quelltext-Test liest mit `.replace(/\r\n/g, "\n")`; kein Rückfall über `||` auf ein `indexOf`-Ergebnis (AGENTS.md §9). Das Edit-Werkzeug mit exakten Zeilen benutzen, keine Mehrzeilen-Suchmuster mit festem `\n` im Shell-Werkzeug.
- **SQLite-Test gegen MariaDB-Produktion:** die Produktionsform wird nie für SQLite verbogen (AGENTS.md §9). `IN (?,?,…)` mit Positionsplatzhaltern läuft auf beiden; kein DDL in einer Transaktion.
- **Assets:** kein `?v=` von Hand (der Deploy stempelt `index.html`, `html/*.html` samt `@import`-Kette). Kein `ASSET_VERSION`-Bump: keine Datei dieses Plans wird von `js/territory/territory-editor-inline-host.js` geladen; `html/wege-editor.html` lädt `js/ui/wiki-weitere-kasten.js` bereits (keine Änderung dort).
- **STRATO:** keine Schleife über schwere Endpunkte; Live-Proben mit EINER Anfrage.
- **Geteilter Baum:** gebaut wird in einem Wegwerf-Worktree (unten). Nie `git add -A`/`.`/`commit -a`; nur eigene Pfade; `git add` und `git commit` in EINEM Zug; Commit-Nachricht per Datei (`git commit -F`), letzte Zeile `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Im geteilten Hauptbaum `C:/GIT/avesmaps` KEIN `checkout`/`switch`/`stash`/`restore`/`reset`/`rebase`/`cherry-pick` — Sub-Agenten ausdrücklich verbieten.

## Arbeitsweise für jede Aufgabe

**Arbeitsort:**

```bash
SCRATCH="<scratchpad>"            # das Scratchpad der Sitzung
git -C C:/GIT/avesmaps fetch -q origin
git -C C:/GIT/avesmaps worktree add --detach "$SCRATCH/bau" origin/master
cd "$SCRATCH/bau"
```

**Einzeltest:** `node <datei>.test.js` bzw. `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll <datei>.php`

**Ganzes Testfeld vor jedem Push** (Muster des Workflows `.github/workflows/deploy-avesmaps-strato.yml`; die Klammer um beide Gruppen ist tragend, die Dateizahl wird gegen den Workflow gehalten):

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 \
  | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > "$SCRATCH/rot-js.txt"
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 \
  | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > "$SCRATCH/rot-php.txt"
cat "$SCRATCH/rot-js.txt" "$SCRATCH/rot-php.txt"
```

Erwartet: Zahlen passen zum Workflow; rot höchstens `api/**/linkcheck/link-url-test.php` (echter DNS-Abruf, vorbestehend). Unerwartete Rote seriell nachfahren. ⚠️ Quelltext-Tests zusätzlich einmal auf einer LF-Kopie fahren (AGENTS.md §9).

**Push:** erst `gh run list --limit 3`; bei `in_progress` **oder** `pending` warten, auch bei fremden Läufen. Dann aus dem Worktree:

```bash
git fetch -q origin && git rebase origin/master      # NUR im Wegwerf-Worktree
if git push origin HEAD:master; then git log --oneline -1 origin/master; fi
```

Danach `gh run list --limit 3` bis `success`. Berührt die Lieferung die Karte: Live-Seite als **Besucher** (ohne `edit=1`) laden und die Konsole lesen.

**Sichtbare Teile gehen einzeln live;** die Grenzen stehen als **🚚 Lieferung** zwischen den Aufgaben.

---

## Dateiübersicht

**Neu:**

| Datei | Verantwortung |
|---|---|
| `js/map-features/__tests__/weg-weitere-leere-liste.test.js` | `[]` überschreibt beim Live-Merge, Leser lesen `[]` als „keine“ |
| `js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js` | „Ganze Straße“ nur mit zwei Orten, Zwillingswörter |
| `js/map-features/__tests__/weg-naechster-abschnitt.test.js` | nächster Abschnitt zum Klickpunkt (rein) |
| `js/map-features/__tests__/weg-namensklick.test.js` | Namensklick, Riegel, ein Zuhörer, Overlay-Ausgang, Hand-Zeiger |
| `api/_internal/wiki/__tests__/wege-gruppe-wiki-public-ids-test.php` | `assign_to`/`clear_assign` mit `public_ids` gegen SQLite |
| `js/ui/__tests__/fixtures/wiki-assign-markup-ohne-anhang.json` | Golden-Master des Bauteil-Markups vor der Einhängestelle |
| `js/ui/__tests__/wiki-assign-anhang.test.js` | Einhängestelle: Markup, Umhängen, Ereignis-Riegel |
| `js/ui/__tests__/wiki-assign-weg-gruppe.test.js` | Rümpfe und Frage für die ganze Straße (rein) |
| `js/pages/__tests__/wege-editor-wiki-kasten.test.js` | Wege-Editor: ein Kasten am Abschnitt und auf der Weg-Ebene (ausgeführt) |
| `js/review/__tests__/weg-dialog-wiki-kasten.test.js` | Kartendialog: Anhang, Gruppen-Zuweisen/-Entfernen, `wiki_uebernommen` (ausgeführt) |

**Geändert:** `api/_internal/wiki/path-weitere.php`, `api/_internal/wiki/paths.php`, `api/edit/wiki/paths.php`, `js/review/review-paths.js`, `js/review/review-path-wiki.js`, `js/review/review-editor-submit.js`, `js/map-features/map-features-weg-auswahl.js`, `js/map-features/weg-auswahl.js`, `js/map-features/map-features-path-label-canvas-overlay.js`, `js/app/keyboard-shortcuts.js`, `js/pages/wege-editor-model.js`, `js/pages/wege-editor.js`, `js/ui/wiki-assign.js`, `js/ui/wiki-assign-weg.js`, `js/ui/wiki-weitere-kasten.js`, `css/components/wiki-weitere-kasten.css`, `css/components/editor-page.css`, `index.html`, `docs/wege-mehrfachzuweisung-mockup.html`, `AGENTS.md`; Tests `api/_internal/wiki/__tests__/path-weitere-test.php`, `api/_internal/wiki/__tests__/path-weitere-schreiben-test.php`, `js/review/__tests__/weg-dialog-gruppe.test.js`, `js/map-features/__tests__/weg-auswahl-karte.test.js`, `js/app/__tests__/keyboard-shortcuts.test.js`, `js/ui/__tests__/wiki-weitere-kasten.test.js`.

---

## Task 1: Eine leer gewordene Liste bleibt `[]` (Befund 6)

Nachtrag §9.2. Heute löscht `avesmapsWikiPathWeitereEntfernen` die leere Liste; der Live-Abgleich anderer Editoren mischt per Spread und behält dadurch den entfernten Artikel.

**Files:**
- Modify: `api/_internal/wiki/path-weitere.php` (`avesmapsWikiPathWeitereEntfernen`, Z. 91–105)
- Modify: `js/review/review-paths.js` (`pathWikiWeitereUebernehmen`, Z. 338–342)
- Modify: `api/_internal/wiki/__tests__/path-weitere-test.php` (Z. 39, 45; neuer Block nach Z. 52)
- Modify: `api/_internal/wiki/__tests__/path-weitere-schreiben-test.php` (Z. 124)
- Modify: `js/review/__tests__/weg-dialog-gruppe.test.js` (Z. 203)
- Create: `js/map-features/__tests__/weg-weitere-leere-liste.test.js`

**Interfaces:**
- Consumes: `applyPathFeatureResponse(path, feature)` (`js/map-features/map-features-path-lifecycle.js`), `wpWeitereNamen`, `wpWegPasstZurSuche` (`js/pages/wege-editor-model.js`), `avesmapsWegTraegtWeiteren` (`js/map-features/weg-auswahl.js`), `avesmapsWikiWeitereZuordnungen` (`js/ui/wiki-weitere-kasten.js`).
- Produces: `avesmapsWikiPathWeitereEntfernen(array $properties, string $wikiKey): array{properties, geaendert, grund}` — bei leerem Rest `properties['wiki_path_weitere'] === []` (vorher: Schlüssel entfernt). `pathWikiWeitereUebernehmen(daten)` setzt `pfad.properties.wiki_path_weitere` immer auf ein Array.

**Risiko:** Ein Leser, der `isset`/`array_key_exists`/Wahrheitswert des Schlüssels als „hat weitere“ liest, hielte `[]` für eine Liste. Die Leser-Tafel im Nachtrag §9.2 ist gegen den Stand vom 15.09.2026 geprüft; vor dem Commit einmal `git grep -n "wiki_path_weitere" -- api js tools ':!**/__tests__/**'` fahren und jede neue Fundstelle gegen die Tafel halten.

- [ ] **Step 1: Test schreiben (JS, ausgeführt)**

`js/map-features/__tests__/weg-weitere-leere-liste.test.js`:

```js
"use strict";
// Eine leer gewordene Liste bleibt `[]` (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.2).
// AUSGEFUEHRT: applyPathFeatureResponse (der Live-Merge) wird aus map-features-path-lifecycle.js geschnitten.
// Aus der Wurzel: node js/map-features/__tests__/weg-weitere-leere-liste.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const schneide = (text, anfang, ende) => {
	const a = text.indexOf(anfang);
	const e = a >= 0 ? text.indexOf(ende, a + anfang.length) : -1;
	assert.ok(a >= 0 && e > a, "Ausschnitt nicht gefunden: " + anfang);
	return text.slice(a, e);
};

// ---- 1. Der Befund: ein FEHLENDER Schluessel ueberlebt den Merge, ein leeres Array nicht --------------------
const kontext = vm.createContext({
	normalizePathSubtype: (wert) => String(wert || "Weg"),
	getPathPublicId: (p) => p.properties.public_id,
	getPathDisplayName: (p) => p.properties.display_name,
	avesmapsWegEinschraenkungNeuRechnen: () => {},
	updatePathLayerGeometry: () => {},
	updatePathLayerStyle: () => {},
	refreshPathLayerPopup: () => {},
	refreshPlannerAfterFeatureChange: () => {},
});
vm.runInContext(schneide(lies("js/map-features/map-features-path-lifecycle.js"),
	"function applyPathFeatureResponse(path, feature) {", "\nfunction removePathFeature"), kontext);
const merge = vm.runInContext("applyPathFeatureResponse", kontext);

const bp = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" };
const lokal = () => ({ id: "rs-7", geometry: { coordinates: [[0, 0], [1, 0]] },
	properties: { public_id: "rs-7", display_name: "Reichsstraße 2", feature_subtype: "Reichsstrasse", wiki_path_weitere: [bp] } });
const delta = (weitere) => {
	const properties = { public_id: "rs-7", display_name: "Reichsstraße 2", feature_subtype: "Reichsstrasse" };
	if (weitere !== undefined) { properties.wiki_path_weitere = weitere; }
	return { id: "rs-7", geometry: { coordinates: [[0, 0], [1, 0]] }, properties };
};

const alt = lokal();
merge(alt, delta(undefined));
assert.strictEqual(alt.properties.wiki_path_weitere.length, 1,
	"Voraussetzung des Befunds: ein fehlender Schluessel ueberschreibt beim Spread-Merge nichts");

const neu = lokal();
merge(neu, delta([]));
assert.ok(Array.isArray(neu.properties.wiki_path_weitere) && neu.properties.wiki_path_weitere.length === 0,
	"ein leeres Array aus dem Delta ueberschreibt die alte Liste -- deshalb schreibt der Server `[]`");

// ---- 2. Jeder JS-Leser liest `[]` als „keine“ ----------------------------------------------------------------
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
assert.deepStrictEqual(M.wpWeitereNamen({ wiki_path_weitere: [] }), []);
assert.strictEqual(M.wpWegPasstZurSuche({ name: "Reichsstraße 2", wiki_path_weitere: [] }, "bären"), false);
const A = require(path.join(WURZEL, "js/map-features/weg-auswahl.js"));
assert.strictEqual(A.avesmapsWegTraegtWeiteren({ wiki_path_weitere: [] }, "b-renpfad"), false);
const K = require(path.join(WURZEL, "js/ui/wiki-weitere-kasten.js"));
assert.deepStrictEqual(K.avesmapsWikiWeitereZuordnungen([{ public_id: "rs-7", label: "A", wiki_path_weitere: [] }], "ganze Straße"), []);

// ---- 3. Der Server schreibt `[]` (die Ausfuehrung prueft path-weitere-test.php; hier die Rueckbau-Probe) -------
const php = lies("api/_internal/wiki/path-weitere.php").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(!/unset\(\$properties\[AVESMAPS_WIKI_PATH_WEITERE_FELD\]\)/.test(php),
	"avesmapsWikiPathWeitereEntfernen loescht die leere Liste wieder -- der Live-Abgleich anderer Editoren behielte den Artikel");

console.log("weg-weitere-leere-liste.test.js: ok");
```

- [ ] **Step 2: PHP-Tests anpassen**

In `api/_internal/wiki/__tests__/path-weitere-test.php` Zeile 39 ersetzen:

```php
assert(($weg['properties']['wiki_path_weitere'] ?? null) === [], 'eine leer gewordene Liste bleibt als [] stehen (Nachtrag §9.2)');
```

Zeile 45 ersetzen:

```php
assert((avesmapsWikiPathWeitereOhneHaupt($umgehaengt)['wiki_path_weitere'] ?? null) === [], 'auch ueber OhneHaupt bleibt [] stehen');
```

Nach Zeile 52 (`assert(avesmapsWikiPathWeitereLesen(['wiki_path_weitere' => 'kein array']) === []);`) einfügen:

```php

// Nachtrag 15.09.2026 §9.2: `[]` gilt ueberall als „keine"
$leer = ['name' => 'Reichsstraße 2', 'wiki_path' => $mitHaupt['wiki_path'], 'wiki_path_weitere' => []];
assert(avesmapsWikiPathWeitereLesen($leer) === []);
assert(avesmapsWikiPathWeitereOhneHaupt($leer) === $leer, 'eine leere Liste bleibt, wie sie ist');
assert(avesmapsWikiPathWeitereEntfernen($leer, 'b-renpfad')['grund'] === 'nicht_da');
assert(avesmapsWikiPathWeitereHinzufuegen($leer, $baerenpfad)['properties']['wiki_path_weitere'][0]['wiki_key'] === 'b-renpfad');
```

In `api/_internal/wiki/__tests__/path-weitere-schreiben-test.php` Zeile 124 ersetzen:

```php
assert(($props('rs-7')['wiki_path_weitere'] ?? null) === [], 'die leer gewordene Liste bleibt als [] stehen (Nachtrag §9.2)');
```

In `js/review/__tests__/weg-dialog-gruppe.test.js` Zeile 203 ersetzen:

```js
assert.deepStrictEqual([...rs6.properties.wiki_path_weitere], [], "eine leere Liste bleibt als [] stehen (Nachtrag §9.2)");
```

- [ ] **Step 3: Tests laufen lassen, sie müssen scheitern**

Run: `node js/map-features/__tests__/weg-weitere-leere-liste.test.js` — Expected: FAIL `avesmapsWikiPathWeitereEntfernen loescht die leere Liste wieder`.
Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/path-weitere-test.php` — Expected: FAIL `eine leer gewordene Liste bleibt als [] stehen`.
Run: `node js/review/__tests__/weg-dialog-gruppe.test.js` — Expected: FAIL (TypeError: `rs6.properties.wiki_path_weitere` is not iterable).

- [ ] **Step 4: Umsetzen**

`api/_internal/wiki/path-weitere.php`, in `avesmapsWikiPathWeitereEntfernen` den Block

```php
    if ($rest === []) {
        unset($properties[AVESMAPS_WIKI_PATH_WEITERE_FELD]);
    } else {
        $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] = $rest;
    }
```

ersetzen durch

```php
    // 🔴 EINE LEER GEWORDENE LISTE BLEIBT ALS `[]` STEHEN, sie wird nicht geloescht (Nachtrag 15.09.2026 §9.2).
    // 💣 Der Live-Abgleich anderer Editoren legt das Delta per Spread ueber den alten Stand
    // (applyPathFeatureResponse, js/map-features/map-features-path-lifecycle.js): ein FEHLENDER Schluessel
    // ueberschreibt dort nichts, und der entfernte Artikel stuende bis zum Neuladen weiter am Abschnitt.
    // Welche Leser `[]` als „keine" lesen, steht in der Tafel des Nachtrags.
    $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] = $rest;
```

`js/review/review-paths.js`, in `pathWikiWeitereUebernehmen` den Block

```js
		if (Array.isArray(eintrag.wiki_path_weitere) && eintrag.wiki_path_weitere.length) {
			pfad.properties.wiki_path_weitere = eintrag.wiki_path_weitere;
		} else {
			delete pfad.properties.wiki_path_weitere;
		}
```

ersetzen durch

```js
		// 🔴 `[]` STATT LOESCHEN, wie der Server (Nachtrag 15.09.2026 §9.2): der eigene und der fremde Browser halten
		// denselben Stand -- beim fremden kommt die leere Liste ueber den Live-Abgleich, und nur ein `[]` ueberschreibt dort.
		pfad.properties.wiki_path_weitere = Array.isArray(eintrag.wiki_path_weitere) ? eintrag.wiki_path_weitere : [];
```

- [ ] **Step 5: Tests laufen lassen, sie müssen bestehen**

Run: `node js/map-features/__tests__/weg-weitere-leere-liste.test.js`, `node js/review/__tests__/weg-dialog-gruppe.test.js`, beide PHP-Tests aus Step 2 sowie `php … api/_internal/wiki/__tests__/path-weitere-erhalten-test.php` und `php … api/_internal/wiki/__tests__/path-weitere-verlauf-test.php`.
Expected: jeweils `ok`.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "fix(wege): eine entfernte weitere Wiki-Zuweisung verschwindet auch bei anderen Editoren -- leere Liste bleibt []" "" "Der Live-Abgleich mischt per Spread; ein geloeschter Schluessel ueberlebte dort." "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.2." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/_internal/wiki/path-weitere.php js/review/review-paths.js api/_internal/wiki/__tests__/path-weitere-test.php api/_internal/wiki/__tests__/path-weitere-schreiben-test.php js/review/__tests__/weg-dialog-gruppe.test.js js/map-features/__tests__/weg-weitere-leere-liste.test.js && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 2: Die Auswahl in der Farbe markierter Orte

Nachtrag §9.1.

**Files:**
- Modify: `js/map-features/map-features-weg-auswahl.js` (`avesmapsWegAuswahlFarbe` Z. 15–20, `avesmapsWegAuswahlStilNachziehen` Z. 22–39)
- Modify: `js/map-features/__tests__/weg-auswahl-karte.test.js` (Globale Z. 21–36, Farb-Zusicherungen Z. 77, 87, 93, 95, 102; neuer Abschnitt vor `console.log`)
- Modify: `docs/wege-mehrfachzuweisung-mockup.html` (Z. 27–33)

**Interfaces:**
- Consumes: `getLocationMarkerActiveColor(): string` (`js/map-features/map-features-location-canvas-layer.js:43`, normales Skript, lädt in `index.html` Z. 4035 vor `map-features-weg-auswahl.js` Z. 4057).
- Produces: `avesmapsWegAuswahlFarbe(): string|null` liest `getLocationMarkerActiveColor()`; `avesmapsWegAuswahlStilNachziehen(path)` liest die Farbe nur für markierte oder tragende Abschnitte.

**Risiko:** `updatePathLayerStyle` läuft bei jedem Zoomschritt für rund 6.000 Wege; wer die Farbe vor der Mitgliedsprobe liest, baut 6.000 `getComputedStyle` je Zoomschritt ein. Der Test zählt die Lesungen.

- [ ] **Step 1: Test anpassen**

In `js/map-features/__tests__/weg-auswahl-karte.test.js`:

1. Nach Zeile 19 (`};` des `schneide`-Helfers) einfügen:

```js
// Nachtrag 15.09.2026 §9.1: die Auswahl traegt die Farbe markierter Orte (--color-marker-active), nicht das Gelb der Suche.
const GOLD = "#f0b429";
```

2. Im `Object.assign(global, {…})` direkt nach der Zeile `SPOTLIGHT_PATH_HIGHLIGHT_STYLE: { color: "#ffd72e" },` einfügen:

```js
	getLocationMarkerActiveColor: () => GOLD,
```

3. In den Zeilen 77, 87, 93, 95 und 102 jedes `"#ffd72e"` durch `GOLD` ersetzen (Zeile 77: `["#ffd72e", "#ffd72e", "#ffd72e"]` → `[GOLD, GOLD, GOLD]`; Zeile 87: `["#mitte", "#ffd72e", "#mitte"]` → `["#mitte", GOLD, "#mitte"]`; Zeilen 93, 95, 102: `"#ffd72e"` → `GOLD`).

4. Vor `console.log("weg-auswahl-karte.test.js: ok");` einfügen:

```js
// 11. Nachtrag 15.09.2026 §9.1: Gold statt Gelb -- und ohne Markierung KEIN getComputedStyle
let farbLesungen = 0;
global.getLocationMarkerActiveColor = () => { farbLesungen += 1; return GOLD; };
K.avesmapsWegAuswahlAufheben();
farbLesungen = 0;
global.pathData.forEach((p) => updatePathLayerStyle(p));
assert.strictEqual(farbLesungen, 0, "ohne Markierung liest das Neufaerben keine Farbe -- syncPathRendering faehrt alle ~6.000 Wege je Zoomschritt");
K.avesmapsWegAuswahlKlick(rs7);
assert.strictEqual(farbe(rs7), GOLD);
assert.ok(farbLesungen > 0 && farbLesungen <= 4, "gelesen wird nur fuer markierte Abschnitte: " + farbLesungen);
assert.notStrictEqual(farbe(rs7), global.SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color, "die Auswahl ist nicht mehr das Gelb von „Anzeigen“");
const auswahlQuelle = lies("js/map-features/map-features-weg-auswahl.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
assert.ok(!auswahlQuelle.includes("SPOTLIGHT_PATH_HIGHLIGHT_STYLE"), "die Auswahl liest die Suchfarbe nicht mehr");
assert.ok(/color:\s*"#ffd72e"/.test(lies("js/ui/spotlight-search.js")), "„Anzeigen“ bleibt gelb (Owner 15.09.2026)");
K.avesmapsWegAuswahlAufheben();
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/map-features/__tests__/weg-auswahl-karte.test.js`
Expected: FAIL in Abschnitt 1 (`actual ['#ffd72e', …] expected ['#f0b429', …]`).

- [ ] **Step 3: Umsetzen**

In `js/map-features/map-features-weg-auswahl.js` die Zeilen 15–39 (von `// 💣 Gelesen, nie abgeschrieben:` bis zur schließenden `}` von `avesmapsWegAuswahlStilNachziehen`) ersetzen durch:

```js
// 🔴 DIE FARBE MARKIERTER ORTE (Owner 15.09.2026, Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.1):
// `--color-marker-active`, gelesen ueber getLocationMarkerActiveColor (map-features-location-canvas-layer.js, normales
// Skript, laedt davor). „Anzeigen" aus der Suche bleibt gelb (SPOTLIGHT_PATH_HIGHLIGHT_STYLE) -- die zwei sollen sich
// unterscheiden. ⚠️ Kein Farbwert hier; der Rueckfall in jener Funktion ist die Notbremse ohne Token.
function avesmapsWegAuswahlFarbe() {
	return typeof getLocationMarkerActiveColor === "function" ? (getLocationMarkerActiveColor() || null) : null;
}

/**
 * Die Mittellinie nach dem Zustand faerben. Gerufen am ENDE von updatePathLayerStyle -- damit ueberlebt die
 * Markierung jedes Neufaerben, ohne dass ein Neufaerber sie kennen muss.
 * 💣 updatePathLayerStyle setzt `dashArray` nie zurueck: der Strich eines ehemaligen Traegers wird HIER entfernt.
 * 💣 ERST DIE MITGLIEDSCHAFT, DANN DIE FARBE: syncPathRendering ruft das bei jedem Zoomschritt fuer alle rund 6.000
 * Wege, und die Farbe kostet ein getComputedStyle. Ohne Markierung wird sie gar nicht gelesen.
 */
function avesmapsWegAuswahlStilNachziehen(path) {
	const mitte = path && Array.isArray(path._pathLines) ? path._pathLines[1] : null;
	if (!mitte || typeof mitte.setStyle !== "function") { return; }
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	const markiert = avesmapsWegAuswahlMarkiert.has(id);
	const traeger = !markiert && avesmapsWegAuswahlTraeger.has(id);
	const farbe = markiert || traeger ? avesmapsWegAuswahlFarbe() : null;
	if (farbe && markiert) {
		mitte.setStyle({ color: farbe, dashArray: null });
	} else if (farbe && traeger) {
		mitte.setStyle({ color: farbe, dashArray: AVESMAPS_WEG_AUSWAHL_STRICH });
	} else if (mitte.options && mitte.options.dashArray) {
		mitte.setStyle({ dashArray: null });
	}
}
```

In `docs/wege-mehrfachzuweisung-mockup.html` die Zeilen 27–33 ersetzen durch:

```css
/* Kein hartkodierter Farbwert, kein Radius, keine Schrift unter 11px (AGENTS.md §12). */
:root {
	/* 🔴 Seit dem Nachtrag 15.09.2026 (§9.1 des Entwurfs) die Farbe markierter Orte -- „Anzeigen" aus der Suche
	   bleibt das Gelb von SPOTLIGHT_PATH_HIGHLIGHT_STYLE und ist damit von der Auswahl zu unterscheiden. */
	--proto-markierung: var(--color-marker-active);
}
```

- [ ] **Step 4: Test laufen lassen, er muss bestehen**

Run: `node js/map-features/__tests__/weg-auswahl-karte.test.js` — Expected: `weg-auswahl-karte.test.js: ok`. Danach `node js/map-features/__tests__/weg-auswahl.test.js` und `node js/app/__tests__/nur-editor-skripte.test.js` — beide `ok`.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "ui(wege): markierte Strasse und markierter Abschnitt leuchten in der Farbe markierter Orte -- Anzeigen bleibt gelb" "" "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.1." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/map-features/map-features-weg-auswahl.js js/map-features/__tests__/weg-auswahl-karte.test.js docs/wege-mehrfachzuweisung-mockup.html && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 3: „Ganze Straße“ nennt Enden nur, wenn beide Orte sind (Befund 7)

Nachtrag §9.3: „fehlt dort EIN Ortsname“ → nur „Ganze Straße“.

**Files:**
- Modify: `js/pages/wege-editor-model.js` (`wpGanzeStrecke` Z. 763–778, `module.exports` Z. 849)
- Create: `js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js`

**Interfaces:**
- Consumes: `AVESMAPS_WEG_ENDE_KREUZUNG`, `AVESMAPS_WEG_ENDE_OFFEN` (`js/map-features/weg-abschnitte.js`, PHP-Zwilling `api/_internal/map/weg-abschnitt-ende.php`).
- Produces: `WP_ENDE_KREUZUNG = "Kreuzung"`, `WP_ENDE_OFFEN = "Wegende"` (exportiert); `wpGanzeStrecke(segmente): string` liefert `""`, sobald ein äußeres Ende „Kreuzung“ oder „Wegende“ heißt.

**Risiko:** Die Regel wirkt an vier Stellen zugleich (Infobox-Zeile, Dialog-Zeile, „ganze Straße · …“ im Weitere-Kasten, Gruppenkopf der Wege-Editor-Liste). Gewollt — aber nach dem Deploy an einer Straße mit offenem Ende einmal alle vier ansehen.

- [ ] **Step 1: Test schreiben**

`js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js`:

```js
"use strict";
// „Ganze Straße" nennt Enden nur, wenn BEIDE Orte sind (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.3,
// Auslegung von §4: „fehlt dort ein Ortsname, steht nur ‚Ganze Straße'").
// Aus der Wurzel: node js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
const W = require(path.join(WURZEL, "js/map-features/weg-abschnitte.js"));
const A = require(path.join(WURZEL, "js/map-features/weg-auswahl.js"));

// Zwei Abschnitte hintereinander; `mitte` ist das gemeinsame innere Ende.
const kette = (von, mitte, bis) => [
	{ public_id: "a", ends: { from: [0, 0], to: [1, 0] }, enden: { von: von, bis: mitte } },
	{ public_id: "b", ends: { from: [1, 0], to: [2, 0] }, enden: { von: mitte, bis: bis } },
];

assert.ok(["Perz – Helmdahl", "Helmdahl – Perz"].includes(M.wpGanzeStrecke(kette("Perz", "Kreuzung", "Helmdahl"))),
	"beide aeusseren Enden Orte: die Strecke steht da, eine Kreuzung in der MITTE stoert nicht");
assert.strictEqual(M.wpGanzeStrecke(kette("Kreuzung", "Wieha", "Wegende")), "", "kein aeusseres Ende ist ein Ort");
assert.strictEqual(M.wpGanzeStrecke(kette("Perz", "Wieha", "Kreuzung")), "", "EIN fehlender Ortsname genuegt");
assert.strictEqual(M.wpGanzeStrecke(kette("Wegende", "Wieha", "Helmdahl")), "", "auch am anderen Ende");
assert.strictEqual(M.wpGanzeStrecke([]), "");

// Die Zeile, die daraus entsteht
assert.strictEqual(A.avesmapsWegMarkierungszeile({ gruppe: "g", publicId: null }, M.wpGanzeStrecke(kette("Kreuzung", "Wieha", "Wegende"))),
	"Ganze Straße", "die Markierungszeile sagt dann nur „Ganze Straße“");

// Ein ABSCHNITT darf weiter an einer Kreuzung oder einem Wegende enden (§4)
assert.strictEqual(M.wpAbschnittLabel({ enden: { von: "Perz", bis: "Kreuzung" } }, 3), "Abschnitt 3: Perz – Kreuzung");

// Die Woerter sind DIESELBEN wie im JS/PHP-Zwilling
assert.strictEqual(M.WP_ENDE_KREUZUNG, W.AVESMAPS_WEG_ENDE_KREUZUNG);
assert.strictEqual(M.WP_ENDE_OFFEN, W.AVESMAPS_WEG_ENDE_OFFEN);
const php = fs.readFileSync(path.join(WURZEL, "api/_internal/map/weg-abschnitt-ende.php"), "utf8");
assert.ok(php.includes("const AVESMAPS_WEG_ENDE_KREUZUNG = '" + M.WP_ENDE_KREUZUNG + "';"), "PHP-Zwilling: Kreuzung");
assert.ok(php.includes("const AVESMAPS_WEG_ENDE_OFFEN = '" + M.WP_ENDE_OFFEN + "';"), "PHP-Zwilling: Wegende");

console.log("wege-ganze-strecke-nur-orte.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js`
Expected: FAIL `kein aeusseres Ende ist ein Ort` (actual `'Kreuzung – Wegende'`).

- [ ] **Step 3: Umsetzen**

In `js/pages/wege-editor-model.js` den Block von `/**\n * REIN: „Von – Bis" der ganzen Strasse` bis zur schließenden `}` von `wpGanzeStrecke` ersetzen durch:

```js
/**
 * Die Woerter, mit denen der Namensbauer ein Ende OHNE Ort benennt -- dieselben Zeichenketten wie
 * AVESMAPS_WEG_ENDE_KREUZUNG/_OFFEN im JS/PHP-Zwilling (js/map-features/weg-abschnitte.js,
 * api/_internal/map/weg-abschnitt-ende.php). ⚠️ Eigene Konstanten, weil dieses Modell im Editorfenster ohne jene Datei
 * laeuft; js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js haelt sie gegen beide Zwillinge.
 */
var WP_ENDE_KREUZUNG = "Kreuzung";
var WP_ENDE_OFFEN = "Wegende";

/**
 * REIN: „Von – Bis" der ganzen Strasse -- die aeusseren Enden der LAENGSTEN Kette (wpChainSegments).
 * "" wenn es keine Kette oder keine Enden gibt. ⚠️ `gedreht` heisst: das Stueck wird vom `to` zum `from`
 * durchlaufen (siehe laufe() in wpChainSegments).
 * 🔴 NUR, WENN BEIDE ENDEN ORTE SIND (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.3, Auslegung von §4:
 * „fehlt dort ein Ortsname, steht nur ‚Ganze Straße'"). Ein einziges „Kreuzung" oder „Wegende" aussen genuegt fuer "".
 * Die Regel gilt damit zugleich fuer Infobox-Zeile, Dialog-Zeile, „ganze Straße · …" und den Gruppenkopf der Liste.
 */
function wpGanzeStrecke(segmente) {
	var ketten = wpChainSegments(segmente);
	if (!ketten.length) { return ""; }
	var kette = ketten[0];
	var erstes = segmente[kette[0].index];
	var letztes = segmente[kette[kette.length - 1].index];
	if (!erstes || !letztes || !erstes.enden || !letztes.enden) { return ""; }
	var von = String(kette[0].gedreht ? erstes.enden.bis : erstes.enden.von);
	var bis = String(kette[kette.length - 1].gedreht ? letztes.enden.von : letztes.enden.bis);
	var keinOrt = function (ende) { return ende === "" || ende === WP_ENDE_KREUZUNG || ende === WP_ENDE_OFFEN; };
	if (keinOrt(von) || keinOrt(bis)) { return ""; }
	return von + " – " + bis;
}
```

Im `module.exports` die Zeile `wpGanzeStrecke: wpGanzeStrecke` ersetzen durch:

```js
		wpGanzeStrecke: wpGanzeStrecke,
		WP_ENDE_KREUZUNG: WP_ENDE_KREUZUNG,
		WP_ENDE_OFFEN: WP_ENDE_OFFEN
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js`, `node js/map-features/__tests__/weg-abschnitte.test.js`, `node js/map-features/__tests__/weg-auswahl-karte.test.js`, `node js/pages/__tests__/wege-editor-abschnittsnamen.test.js`, `node js/pages/__tests__/wege-editor-model.test.js`.
Expected: alle `ok`.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "ui(wege): \"Ganze Strasse\" nennt Anfang und Ende nur noch, wenn beide Orte sind" "" "Auslegung von Entwurf §4, Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.3." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/pages/wege-editor-model.js js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js && git commit -F "$SCRATCH/msg.txt"
```

**🚚 Lieferung A „Markierung“:** Tasks 1–3 zusammen. Vorher `usability-konsistenz` (Nachtrag §9.1–§9.3 gegen den Diff), vor dem Push `usability-design` gegen das Mockup in hell **und** dunkel. Nach dem Push: Live-Seite als Besucher laden, Konsole lesen; im Bearbeiten-Modus eine Reichsstraße zweimal anklicken (Gold, dann Abschnitt), eine Straße mit offenem Ende anklicken (Zeile nur „Ganze Straße“). Owner schaut.

---

## Task 4: Der nächste Abschnitt zum Klickpunkt — reine Regel

Nachtrag §9.4: das Namensregister trägt keine `public_id`; der Klick gilt dem Abschnitt der Gruppe, der dem Klickpunkt am nächsten liegt.

**Files:**
- Modify: `js/map-features/weg-auswahl.js` (neue Funktionen vor `if (typeof module …)`, Export erweitern)
- Create: `js/map-features/__tests__/weg-naechster-abschnitt.test.js`

**Interfaces:**
- Produces:
  - `avesmapsWegAbstandZurLinie(punkt: [x, y], koordinaten: Array<[x, y]>): number` — kleinster Abstand zu den Strecken der Linie in Karteneinheiten; `Infinity` ohne Linie oder bei ungültigem Punkt.
  - `avesmapsWegNaechsterAbschnitt(abschnitte: Array<{public_id, koordinaten}>, punkt: [x, y]): string|null` — bei Gleichstand der erste.

**Risiko:** GeoJSON-Koordinaten sind `[x, y]`, Leaflet liefert `latlng` = `[y, x]`. Der Aufrufer (Task 6) dreht; die Regel selbst kennt nur `[x, y]`.

- [ ] **Step 1: Test schreiben**

`js/map-features/__tests__/weg-naechster-abschnitt.test.js`:

```js
"use strict";
// Welcher Abschnitt eines Namens liegt dem Klickpunkt am naechsten (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.4)?
// Aus der Wurzel: node js/map-features/__tests__/weg-naechster-abschnitt.test.js
const assert = require("assert");
const path = require("path");
const A = require(path.join(path.resolve(__dirname, "..", "..", ".."), "js/map-features/weg-auswahl.js"));

// Abstand zur STRECKE, nicht zum naechsten Stuetzpunkt
assert.strictEqual(A.avesmapsWegAbstandZurLinie([5, 3], [[0, 0], [10, 0]]), 3, "senkrecht auf die Strecke");
assert.strictEqual(A.avesmapsWegAbstandZurLinie([-4, 3], [[0, 0], [10, 0]]), 5, "hinter dem Anfang zaehlt der Endpunkt");
assert.strictEqual(A.avesmapsWegAbstandZurLinie([2, 2], [[2, 2]]), 0, "eine Linie aus einem Punkt");
assert.strictEqual(A.avesmapsWegAbstandZurLinie([1, 1], []), Infinity);
assert.strictEqual(A.avesmapsWegAbstandZurLinie([NaN, 1], [[0, 0], [1, 0]]), Infinity);

const abschnitte = [
	{ public_id: "rs-6", koordinaten: [[0, 0], [10, 0]] },
	{ public_id: "rs-7", koordinaten: [[10, 0], [20, 0], [20, 10]] },
	{ public_id: "rs-8", koordinaten: [[20, 10], [30, 10]] },
];
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt(abschnitte, [19, 6]), "rs-7", "die Mitte einer Strecke von rs-7 liegt naeher als jeder Stuetzpunkt");
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt(abschnitte, [28, 12]), "rs-8");
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt(abschnitte, [10, 1]), "rs-6", "Gleichstand am gemeinsamen Ende: der erste in der Nummernfolge");
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt([], [1, 1]), null);
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt([{ public_id: "", koordinaten: [[0, 0]] }, null], [0, 0]), null, "ohne Kennung kein Ziel");

console.log("weg-naechster-abschnitt.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/map-features/__tests__/weg-naechster-abschnitt.test.js`
Expected: FAIL `TypeError: A.avesmapsWegAbstandZurLinie is not a function`.

- [ ] **Step 3: Umsetzen**

In `js/map-features/weg-auswahl.js` direkt vor `if (typeof module !== "undefined" && module.exports) {` einfügen:

```js
/** REIN: kleinster Abstand des Punkts [x, y] zu einer Linie aus [x, y]-Punkten, in Karteneinheiten. Infinity ohne Linie. */
function avesmapsWegAbstandZurLinie(punkt, koordinaten) {
	const px = Number(punkt && punkt[0]);
	const py = Number(punkt && punkt[1]);
	const liste = Array.isArray(koordinaten) ? koordinaten : [];
	if (!Number.isFinite(px) || !Number.isFinite(py) || liste.length === 0) { return Infinity; }
	let bester = Infinity;
	for (let i = 0; i < liste.length; i++) {
		const a = liste[i];
		const b = liste[Math.min(i + 1, liste.length - 1)];
		const ax = Number(a[0]); const ay = Number(a[1]);
		const dx = Number(b[0]) - ax; const dy = Number(b[1]) - ay;
		const laenge2 = dx * dx + dy * dy;
		const t = laenge2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / laenge2)) : 0;
		const abstand = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
		if (abstand < bester) { bester = abstand; }
	}
	return bester;
}

/**
 * REIN: welcher Abschnitt eines Namens liegt dem Klickpunkt am naechsten (Nachtrag 2026-09-14-wege-mehrfachzuweisung-
 * design.md §9.4)? Das Namensregister des Overlays kennt nur den Wiki-Schluessel, keine `public_id`.
 * @param {Array<{public_id: string, koordinaten: Array}>} abschnitte  in der Nummernfolge des Wege-Editors
 * @param {Array<number>} punkt  [x, y] -- ⚠️ GeoJSON-Ordnung, der Aufrufer dreht Leaflets latlng
 * @return {string|null}  bei Gleichstand der erste
 */
function avesmapsWegNaechsterAbschnitt(abschnitte, punkt) {
	let bester = null;
	let besterAbstand = Infinity;
	(Array.isArray(abschnitte) ? abschnitte : []).forEach((abschnitt) => {
		if (!abschnitt || !abschnitt.public_id) { return; }
		const abstand = avesmapsWegAbstandZurLinie(punkt, abschnitt.koordinaten);
		if (abstand < besterAbstand) {
			bester = String(abschnitt.public_id);
			besterAbstand = abstand;
		}
	});
	return bester;
}
```

Im `module.exports` von `js/map-features/weg-auswahl.js` die Zeile `avesmapsWegMarkierungszeileMarkup, avesmapsWegVerlaufKachelErlaubt, avesmapsWegTraegtWeiteren,` ersetzen durch:

```js
		avesmapsWegMarkierungszeileMarkup, avesmapsWegVerlaufKachelErlaubt, avesmapsWegTraegtWeiteren,
		avesmapsWegAbstandZurLinie, avesmapsWegNaechsterAbschnitt,
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node js/map-features/__tests__/weg-naechster-abschnitt.test.js`, `node js/map-features/__tests__/weg-auswahl.test.js`, `node js/app/__tests__/nur-editor-skripte.test.js` — Expected: alle `ok`.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(wege): Regel fuer den naechsten Abschnitt zum Klickpunkt (fuer den Namensklick)" "" "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/map-features/weg-auswahl.js js/map-features/__tests__/weg-naechster-abschnitt.test.js && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 5: Die Tastatur verrät, ob ein Werkzeug läuft

Nachtrag §9.4: keine zweite Werkzeugliste — `TOOL_CLASSES` samt `PICKING_SELECTOR` steht in `js/app/keyboard-shortcuts.js`, dort wird die Frage nach außen gegeben.

**Files:**
- Modify: `js/app/keyboard-shortcuts.js` (`window.avesmapsKeyboardShortcuts`, Z. 467–476)
- Modify: `js/app/__tests__/keyboard-shortcuts.test.js` (neuer `check` vor `if (failures > 0) {`)

**Interfaces:**
- Consumes: `toolActive()` (IIFE-intern, Z. 202).
- Produces: `window.avesmapsKeyboardShortcuts.toolActive(): boolean`.

**Risiko:** keins im Verhalten — nur ein weiterer Schlüssel am vorhandenen Objekt.

- [ ] **Step 1: Test schreiben**

In `js/app/__tests__/keyboard-shortcuts.test.js` direkt vor der Zeile `if (failures > 0) {` einfügen:

```js
check("toolActive ist die Werkzeugfrage fuer andere Module -- der Namensklick der Wege (Nachtrag 15.09.2026 §9.4)", () => {
	const ohne = loadModule();
	assert.strictEqual(typeof ohne.api.toolActive, "function", "die Frage ist nach aussen gegeben");
	assert.strictEqual(ohne.api.toolActive(), false, "ohne Werkzeug: nein");
	ohne.api.toolClasses.forEach((klasse) => {
		const t = loadModule({ mapContainerClasses: [klasse] });
		assert.strictEqual(t.api.toolActive(), true, klasse + " muss als laufendes Werkzeug gelten");
	});
	const pick = loadModule({ picking: makeElement([]) });
	assert.strictEqual(pick.api.toolActive(), true, "auch ein Anklick-Modus an den Panes");
});
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/app/__tests__/keyboard-shortcuts.test.js`
Expected: FAIL `die Frage ist nach aussen gegeben`.

- [ ] **Step 3: Umsetzen**

In `js/app/keyboard-shortcuts.js` im Objekt `window.avesmapsKeyboardShortcuts` die Zeile `toolClasses: TOOL_CLASSES` ersetzen durch:

```js
		toolClasses: TOOL_CLASSES,
		// 🔴 Die EINE Werkzeugfrage, auch fuer andere Module: der Namensklick der Wege darf nicht wirken, solange ein
		// Werkzeug laeuft (Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.4). Eine
		// zweite Klassenliste dort liefe beim naechsten Werkzeug auseinander.
		toolActive: toolActive
```

- [ ] **Step 4: Test laufen lassen**

Run: `node js/app/__tests__/keyboard-shortcuts.test.js` — Expected: `keyboard-shortcuts.test: OK (…)`.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "refactor(tastatur): die Werkzeugfrage toolActive nach aussen geben -- fuer den Namensklick der Wege" "" "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/app/keyboard-shortcuts.js js/app/__tests__/keyboard-shortcuts.test.js && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 6: Namensklick und Hand-Zeiger im Bearbeiten-Modus

Nachtrag §9.4.

**Files:**
- Modify: `js/map-features/map-features-path-label-canvas-overlay.js` (Zuhörer `map.on("mousemove", …)` Z. 1370–1411; neuer Ausgang nach `window.AvesmapsPathLabelCanvasOverlay = { redraw, paneName: PANE };` Z. 1501)
- Modify: `js/map-features/map-features-weg-auswahl.js` (neue Funktionen nach `avesmapsWegAuswahlAufheben`; `avesmapsWegAuswahlVerdrahten`; Export)
- Create: `js/map-features/__tests__/weg-namensklick.test.js`

**Interfaces:**
- Consumes: `wayLabelHitTest(register, point)` (`js/map-features/map-features-way-labels.js:415`); `avesmapsWegGruppenAufKarte().nachKey` (`js/map-features/weg-abschnitte.js`); `findPathByPublicId`; `avesmapsWegNaechsterAbschnitt` (Task 4); `window.avesmapsKeyboardShortcuts.toolActive` (Task 5); `window.__pathAssignPending`; `activePathGeometryEdit` (`js/app/runtime-state.js`); `#map-context-menu`.
- Produces:
  - `window.avesmapsWegNamenTreffer(containerPoint): {wikiKey, name, wikiUrl, subtype, …}|null` (Overlay; `null` während der CSS-Zoom-Animation oder mit `?waylabels=0`).
  - `avesmapsWegWerkzeugLaeuft(): boolean` — fällt ohne Tastatur-Modul auf `true` (geschlossen).
  - `avesmapsWegNamenKlickZiel(event): path|null`.
  - `avesmapsWegKartenKlick(event): void` — der EINE Karten-Klick-Zuhörer der Wege-Auswahl.
  - `avesmapsWegAuswahlVerdrahten()` meldet `avesmapsWegKartenKlick` an (statt `avesmapsWegAuswahlAufheben`).

**Risiko:** Zwei Karten-Klick-Zuhörer (Markieren und Aufheben) hingen an ihrer Registrierungsreihenfolge — deshalb EIN Zuhörer. Der Hand-Zeiger ist ein Inline-Stil und schlüge die Cursor-Klasse eines Werkzeugs, wenn er stehen bliebe.

- [ ] **Step 1: Test schreiben**

`js/map-features/__tests__/weg-namensklick.test.js`:

```js
"use strict";
// Namensklick im Bearbeiten-Modus (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.4). AUSGEFUEHRT: der Karten-Klick
// der Wege-Auswahl mit Attrappen, der Treffer-Ausgang und der Zeiger-Zuhoerer des Overlays aus dem Quelltext geschnitten.
// Aus der Wurzel: node js/map-features/__tests__/weg-namensklick.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const schneide = (text, anfang, ende) => {
	const a = text.indexOf(anfang);
	const e = a >= 0 ? text.indexOf(ende, a + anfang.length) : -1;
	assert.ok(a >= 0 && e > a, "Ausschnitt nicht gefunden: " + anfang);
	return text.slice(a, e + ende.length);
};

// ---- Aufbau wie weg-auswahl-karte.test.js --------------------------------------------------------------------
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
const menue = { hidden: true };
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: () => false,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: true,
	activePathGeometryEdit: null,
	locationData: [],
	document: { getElementById: (id) => (id === "map-context-menu" ? menue : null) },
	window: {},
});
global.findPathByPublicId = (id) => global.pathData.find((p) => p.properties.public_id === id) || null;
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-auswahl.js")));
const K = require(path.join(WURZEL, "js/map-features/map-features-weg-auswahl.js"));
Object.assign(global, K);

const gefeuert = [];
const RS = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" };
const weg = (id, koordinaten) => {
	const pfad = {
		properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "Reichsstrasse-" + id, display_name: RS.name, wiki_path: RS },
		geometry: { coordinates: koordinaten },
	};
	// Die Mittellinie: `fire("click")` faehrt denselben Zuhoerer wie ein Linien-Klick (createPathLayer) -- hier sein Kern.
	pfad._pathLines = [{}, { fire: (typ, ereignis) => { gefeuert.push([id, typ, ereignis]); K.avesmapsWegAuswahlKlick(pfad); } }];
	return pfad;
};
global.pathData = [weg("rs-6", [[0, 0], [10, 0]]), weg("rs-7", [[10, 0], [20, 0]]), weg("rs-8", [[20, 0], [30, 0]])];
const [rs6, rs7, rs8] = global.pathData;

let treffer = { wikiKey: "reichsstrasse-2", name: "Reichsstraße 2" };
let werkzeug = false;
global.window.avesmapsWegNamenTreffer = () => treffer;
global.window.avesmapsKeyboardShortcuts = { toolActive: () => werkzeug };
const klick = (x, y) => ({ latlng: { lat: y, lng: x }, containerPoint: { x: 1, y: 1 }, layerPoint: { x: 1, y: 1 }, originalEvent: {} });

// ---- 1. Treffer: der NAECHSTE Abschnitt bekommt den Linien-Klick, mit dem Ereignis ---------------------------
K.avesmapsWegKartenKlick(klick(27, 2));
assert.strictEqual(gefeuert.length, 1);
assert.strictEqual(gefeuert[0][0], "rs-8", "der Abschnitt, der dem Klickpunkt am naechsten liegt -- latlng wird zu [x, y] gedreht");
assert.strictEqual(gefeuert[0][1], "click");
assert.deepStrictEqual(gefeuert[0][2].latlng, { lat: 2, lng: 27 });
assert.deepStrictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), { gruppe: "wiki:reichsstrasse-2", publicId: null }, "erster Klick: ganze Strasse");

// ---- 2. EIN Zuhoerer: der zweite Namensklick markiert den Abschnitt, derselbe Klick hebt nichts auf --------------
K.avesmapsWegKartenKlick(klick(27, 2));
assert.deepStrictEqual(K.avesmapsWegAuswahlFuerPfad(rs8), { gruppe: "wiki:reichsstrasse-2", publicId: "rs-8" },
	"zweiter Klick: der Abschnitt -- mit zwei getrennten Zuhoerern haette das Aufheben ihn wieder auf „ganze Strasse“ geworfen");

// ---- 3. Kein Treffer: der Klick hebt auf -----------------------------------------------------------------------
treffer = null;
K.avesmapsWegKartenKlick(klick(27, 2));
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs8), null, "daneben geklickt: Markierung weg");
treffer = { wikiKey: "reichsstrasse-2" };

// ---- 4. Die Riegel ----------------------------------------------------------------------------------------------
const ohneFeuer = (grund, vorbereiten, aufraeumen) => {
	gefeuert.length = 0;
	vorbereiten();
	K.avesmapsWegKartenKlick(klick(5, 1));
	aufraeumen();
	assert.strictEqual(gefeuert.length, 0, grund + ": kein Namensklick");
};
ohneFeuer("ein Werkzeug laeuft", () => { werkzeug = true; }, () => { werkzeug = false; });
ohneFeuer("der Wiki-Ziel-Pick laeuft", () => { global.window.__pathAssignPending = { wikiKey: "x" }; }, () => { global.window.__pathAssignPending = null; });
ohneFeuer("der Verlauf-Editor laeuft", () => { global.activePathGeometryEdit = { path: rs6 }; }, () => { global.activePathGeometryEdit = null; });
ohneFeuer("das Kontextmenue ist offen", () => { menue.hidden = false; }, () => { menue.hidden = true; });
const tastatur = global.window.avesmapsKeyboardShortcuts;
ohneFeuer("ohne Tastatur-Modul GESCHLOSSEN", () => { delete global.window.avesmapsKeyboardShortcuts; }, () => { global.window.avesmapsKeyboardShortcuts = tastatur; });
ohneFeuer("Besucher", () => { global.IS_EDIT_MODE = false; }, () => { global.IS_EDIT_MODE = true; });
ohneFeuer("Treffer ohne Wiki-Schluessel", () => { treffer = { name: "x" }; }, () => { treffer = { wikiKey: "reichsstrasse-2" }; });
gefeuert.length = 0;
K.avesmapsWegKartenKlick(klick(5, 1));
assert.strictEqual(gefeuert[0][0], "rs-6", "Gegenprobe: ohne Riegel wirkt der Namensklick");
K.avesmapsWegKartenKlick(undefined);
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), null, "ohne Ereignis (Aufruf ohne Argument) wird nur aufgehoben");

// ---- 5. Verdrahtung: EIN Zuhoerer an der Karte -------------------------------------------------------------------
const anmeldungen = [];
global.map = { on: (typ, fn) => { anmeldungen.push([typ, fn]); } };
K.avesmapsWegAuswahlVerdrahten();
assert.deepStrictEqual(anmeldungen.map((a) => a[0]), ["click"]);
assert.strictEqual(anmeldungen[0][1], K.avesmapsWegKartenKlick, "der Karten-Klick-Zuhoerer ist avesmapsWegKartenKlick");

// ---- 6. Der Treffer-Ausgang des Overlays -------------------------------------------------------------------------
const overlay = lies("js/map-features/map-features-path-label-canvas-overlay.js");
const wegLabels = lies("js/map-features/map-features-way-labels.js");
const eintrag = { left: 0, top: 0, right: 100, bottom: 20, wikiKey: "reichsstrasse-2" };
const kurve = { left: 200, top: 0, right: 300, bottom: 20, label: {} };
const ov = vm.createContext({ window: {}, cssZoomActive: false, wayLabelsEnabled: true, wayLabelClickRegister: [eintrag] });
vm.runInContext(schneide(wegLabels, "function wayLabelHitTest(register, point) {", "\n}\n"), ov);
vm.runInContext(schneide(overlay, "window.avesmapsWegNamenTreffer = function (containerPoint) {", "\n\t};"), ov);
assert.strictEqual(ov.window.avesmapsWegNamenTreffer({ x: 50, y: 10 }), eintrag);
assert.strictEqual(ov.window.avesmapsWegNamenTreffer({ x: 250, y: 10 }), null);
ov.cssZoomActive = true;
assert.strictEqual(ov.window.avesmapsWegNamenTreffer({ x: 50, y: 10 }), null, "waehrend der CSS-Zoom-Animation ist das Register veraltet");
ov.cssZoomActive = false;
ov.wayLabelsEnabled = false;
assert.strictEqual(ov.window.avesmapsWegNamenTreffer({ x: 50, y: 10 }), null, "?waylabels=0");

// ---- 7. Der Hand-Zeiger ------------------------------------------------------------------------------------------
const behaelter = { style: { cursor: "" } };
let zeigerZuhoerer = null;
let werkzeugZeiger = false;
const zc = vm.createContext({
	IS_EDIT_MODE: true, cssZoomActive: false, labelCursorActive: false, labelCursorLastCheck: 0,
	wayLabelsEnabled: true, wayLabelClickRegister: [eintrag], kurvenlabelClickRegister: [kurve],
	avesmapsWegWerkzeugLaeuft: () => werkzeugZeiger, Date, Boolean,
	map: { on: (typ, fn) => { if (typ === "mousemove") { zeigerZuhoerer = fn; } }, getContainer: () => behaelter },
});
vm.runInContext(schneide(wegLabels, "function wayLabelHitTest(register, point) {", "\n}\n"), zc);
vm.runInContext(schneide(overlay, "\tmap.on(\"mousemove\", (event) => {", "\n\t});"), zc);
const bewege = (x) => { zc.labelCursorLastCheck = 0; zeigerZuhoerer({ containerPoint: { x: x, y: 10 } }); };
bewege(50);
assert.strictEqual(behaelter.style.cursor, "pointer", "Editor ueber einem Wegnamen: Hand");
bewege(250);
assert.strictEqual(behaelter.style.cursor, "", "Editor ueber einem Kurvenlabel: keine Hand -- die bleiben im Editor stumm");
bewege(50);
werkzeugZeiger = true;
bewege(50);
assert.strictEqual(behaelter.style.cursor, "", "ein Werkzeug startet: die stehengebliebene Hand wird zurueckgenommen");
assert.strictEqual(zc.labelCursorActive, false);
werkzeugZeiger = false;
zc.IS_EDIT_MODE = false;
bewege(250);
assert.strictEqual(behaelter.style.cursor, "pointer", "Besucher ueber einem Kurvenlabel: Hand wie bisher");

console.log("weg-namensklick.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/map-features/__tests__/weg-namensklick.test.js`
Expected: FAIL `TypeError: K.avesmapsWegKartenKlick is not a function`.

- [ ] **Step 3: Overlay — Treffer-Ausgang**

In `js/map-features/map-features-path-label-canvas-overlay.js` direkt nach der Zeile `	window.AvesmapsPathLabelCanvasOverlay = { redraw, paneName: PANE };` einfügen:

```js
	// Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.4: der Namenstreffer fuer den
	// Karten-Klick der Wege-Auswahl (js/map-features/map-features-weg-auswahl.js). NUR der Registertreffer -- welche
	// Regel gilt (Bearbeiten-Modus, Werkzeug, Pick), entscheidet die Wege-Auswahl, nicht dieses Overlay.
	// Waehrend der CSS-Zoom-Animation haelt das Register veraltete Pixel, mit ?waylabels=0 ist es leer.
	window.avesmapsWegNamenTreffer = function (containerPoint) {
		if (cssZoomActive || !wayLabelsEnabled) {
			return null;
		}
		return wayLabelHitTest(wayLabelClickRegister, containerPoint);
	};
```

- [ ] **Step 4: Overlay — Hand-Zeiger**

Im selben File den ganzen Zuhörer ab der Zeile `	map.on("mousemove", (event) => {` bis einschließlich der schließenden Zeile `	});` direkt vor `	// Zoom-Animation wie beim Grenzen-Overlay` ersetzen durch:

```js
	map.on("mousemove", (event) => {
		// 🔴 IM KARTEN-EDITOR NUR DIE WEGNAMEN (Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md
		// §9.4): ein Klick auf den Namen eines Wiki-Wegs markiert dort die Strasse (map-features-weg-auswahl.js), also
		// bekommt er die Hand. Die Kurvenlabels bleiben im Editor stumm -- der click-Handler oben tritt dort zurueck.
		const editor = typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE;
		const werkzeug = editor && (typeof avesmapsWegWerkzeugLaeuft !== "function" || avesmapsWegWerkzeugLaeuft());
		if (cssZoomActive || werkzeug) {
			// 💣 Eine stehengebliebene Inline-Hand schluege die Cursor-Klasse des Werkzeugs (path-creation-cursor,
			// leaflet-crosshair) -- beim Werkzeugstart wird sie zurueckgenommen.
			if (werkzeug && labelCursorActive) {
				labelCursorActive = false;
				if (map.getContainer().style.cursor === "pointer") {
					map.getContainer().style.cursor = "";
				}
			}
			return; // waehrend der CSS-Zoom-Animation haelt das Register veraltete Vor-Zoom-Container-px (redraw pausiert)
		}
		// ⚠️ Ein anklickbarer Name, der aussieht wie unbeweglicher Text, ist eine halbe Reparatur -- das Kurvenlabel
		// bekommt fuer Besucher dieselbe Hand wie die Wegnamen. `?waylabels=0` schaltet nur die Wegnamen ab.
		const wegRegister = wayLabelsEnabled ? wayLabelClickRegister : [];
		const kurvenRegister = editor ? [] : kurvenlabelClickRegister;
		if (!wegRegister.length && !kurvenRegister.length) {
			// Leere Register: eine noch aktive Hand SOFORT zuruecksetzen, sonst klebt sie bis zum naechsten Treffer-Test.
			if (labelCursorActive) {
				labelCursorActive = false;
				if (map.getContainer().style.cursor === "pointer") {
					map.getContainer().style.cursor = "";
				}
			}
			return;
		}
		const now = Date.now();
		if (now - labelCursorLastCheck < 100) {
			return;
		}
		labelCursorLastCheck = now;
		const over = Boolean(wayLabelHitTest(wegRegister, event.containerPoint)
			|| wayLabelHitTest(kurvenRegister, event.containerPoint));
		if (over === labelCursorActive) {
			return;
		}
		labelCursorActive = over;
		// Nur setzen/zuruecksetzen, wenn NICHTS anderes gerade den Cursor beansprucht (z. B. Leaflets grab/grabbing).
		if (over) {
			map.getContainer().style.cursor = "pointer";
		} else if (map.getContainer().style.cursor === "pointer") {
			map.getContainer().style.cursor = "";
		}
	});
```

- [ ] **Step 5: Wege-Auswahl — Riegel, Ziel, ein Zuhörer**

In `js/map-features/map-features-weg-auswahl.js` direkt nach der schließenden `}` von `avesmapsWegAuswahlAufheben` einfügen:

```js
/**
 * Laeuft gerade etwas, das einen Karten-Klick fuer sich braucht (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.4)?
 * 🔴 KEINE ZWEITE KLASSENLISTE: die Werkzeuge stehen in TOOL_CLASSES (js/app/keyboard-shortcuts.js, `toolActive`),
 * dazu die drei Zustaende, die keine Klasse an den Kartencontainer haengen.
 * ⚠️ Fehlt das Tastatur-Modul, faellt der Riegel GESCHLOSSEN aus: ein stummer Name ist der alte Zustand, ein
 * Namensklick mitten in einem Werkzeug waere ein neuer Fehler.
 */
function avesmapsWegWerkzeugLaeuft() {
	const tastatur = typeof window !== "undefined" ? window.avesmapsKeyboardShortcuts : null;
	if (!tastatur || typeof tastatur.toolActive !== "function") { return true; }
	if (tastatur.toolActive()) { return true; }
	if (typeof window !== "undefined" && window.__pathAssignPending) { return true; }
	if (typeof activePathGeometryEdit !== "undefined" && activePathGeometryEdit) { return true; }
	const menue = typeof document !== "undefined" && typeof document.getElementById === "function"
		? document.getElementById("map-context-menu")
		: null;
	return Boolean(menue && menue.hidden === false);
}

/** Welcher Abschnitt wird mit diesem Karten-Klick ueber seinen NAMEN angeklickt? Sonst null. */
function avesmapsWegNamenKlickZiel(event) {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE || !event || !event.containerPoint || !event.latlng) { return null; }
	if (typeof window === "undefined" || typeof window.avesmapsWegNamenTreffer !== "function") { return null; }
	if (avesmapsWegWerkzeugLaeuft()) { return null; }
	const treffer = window.avesmapsWegNamenTreffer(event.containerPoint);
	const wikiKey = treffer && treffer.wikiKey ? String(treffer.wikiKey) : "";
	if (!wikiKey || typeof avesmapsWegGruppenAufKarte !== "function" || typeof findPathByPublicId !== "function") { return null; }
	const gruppe = avesmapsWegGruppenAufKarte().nachKey.get("wiki:" + wikiKey);
	if (!gruppe) { return null; }
	const abschnitte = gruppe.segments.map((way) => {
		const pfad = findPathByPublicId(way.public_id);
		return { public_id: way.public_id, koordinaten: pfad && pfad.geometry ? pfad.geometry.coordinates : [] };
	});
	// ⚠️ GeoJSON-Ordnung: Leaflets latlng ist [y, x].
	const id = avesmapsWegNaechsterAbschnitt(abschnitte, [event.latlng.lng, event.latlng.lat]);
	return id ? findPathByPublicId(id) : null;
}

/**
 * 💣 DER EINE KARTEN-KLICK-ZUHOERER DER WEGE-AUSWAHL (Nachtrag §9.4). Ein Namenstreffer loest den Linien-Klick aus, sonst
 * hebt der Klick die Markierung auf. Zwei getrennte Zuhoerer hingen an ihrer Registrierungsreihenfolge: die Markierung
 * verschwaende im selben Klick wieder, oder der zweite Klick fiele immer auf „ganze Strasse" zurueck.
 * ⭐ Kein zweiter Code-Pfad: `fire("click")` an der Mittellinie faehrt denselben Zuhoerer wie ein Klick auf die Linie
 * (createPathLayer) -- Wiki-Ziel-Pick, Schiedsrichter, Auswahl, Infopanel.
 */
function avesmapsWegKartenKlick(event) {
	const pfad = avesmapsWegNamenKlickZiel(event);
	const mitte = pfad && Array.isArray(pfad._pathLines) ? pfad._pathLines[1] : null;
	if (mitte && typeof mitte.fire === "function") {
		mitte.fire("click", {
			latlng: event.latlng,
			layerPoint: event.layerPoint,
			containerPoint: event.containerPoint,
			originalEvent: event.originalEvent,
		});
		return;
	}
	avesmapsWegAuswahlAufheben();
}
```

In `avesmapsWegAuswahlVerdrahten` die zwei Zeilen

```js
	// Ein Klick daneben hebt die Markierung auf (§3.1). Ein Klick AUF einen Weg erreicht die Karte nicht:
	// beide Linien tragen `bubblingMouseEvents: false` (createPathLayer).
	map.on("click", avesmapsWegAuswahlAufheben);
```

ersetzen durch

```js
	// Ein Klick daneben hebt die Markierung auf (§3.1), ein Klick auf den NAMEN eines Wiki-Wegs markiert (Nachtrag §9.4) --
	// beides in EINEM Zuhoerer. Ein Klick AUF eine Linie erreicht die Karte nicht: beide Linien tragen
	// `bubblingMouseEvents: false` (createPathLayer).
	map.on("click", avesmapsWegKartenKlick);
```

Im `module.exports` die Zeile `avesmapsWegAuswahlGruppenPfade, avesmapsWegAuswahlStilNachziehen, avesmapsWegAuswahlVerdrahten,` ersetzen durch:

```js
		avesmapsWegAuswahlGruppenPfade, avesmapsWegAuswahlStilNachziehen, avesmapsWegAuswahlVerdrahten,
		avesmapsWegWerkzeugLaeuft, avesmapsWegNamenKlickZiel, avesmapsWegKartenKlick,
```

- [ ] **Step 6: Tests laufen lassen**

Run: `node js/map-features/__tests__/weg-namensklick.test.js`, `node js/map-features/__tests__/weg-auswahl-karte.test.js` (Abschnitt 5 ruft den angemeldeten Zuhörer ohne Argument — muss weiter aufheben), `node js/app/__tests__/nur-editor-skripte.test.js`, `node tools/paths/test-way-labels.mjs`.
Expected: alle `ok`.

- [ ] **Step 7: Ablauf im Browser (vor dem Commit)**

Lokale Karte mit echten Kartendaten im Bearbeiten-Modus: (1) Name einer Reichsstraße neben der Linie anklicken → ganze Straße gold, Infobox; (2) nochmal → der nächste Abschnitt; (3) daneben → aufgehoben; (4) „Weg zeichnen“ starten, über den Namen fahren → keine Hand, Klick setzt einen Punkt; (5) Wiki-Ziel-Pick aus dem WikiSync starten, Name anklicken → nichts markiert; (6) Kurvenlabel im Bearbeiten-Modus → keine Hand, kein Klick; (7) als Besucher Kurvenlabel und Wegname → wie bisher.

- [ ] **Step 8: Commit**

```bash
printf '%s\n' "ui(wege): im Bearbeiten-Modus markiert ein Klick auf den Namen eines Wiki-Wegs die Strasse, wie ein Klick auf die Linie" "" "Ein Karten-Klick-Zuhoerer fuer Markieren und Aufheben; Riegel ueber toolActive, Pick, Verlauf-Editor, Kontextmenue." "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/map-features/map-features-path-label-canvas-overlay.js js/map-features/map-features-weg-auswahl.js js/map-features/__tests__/weg-namensklick.test.js && git commit -F "$SCRATCH/msg.txt"
```

**🚚 Lieferung B „Namensklick“:** Tasks 4–6 zusammen. Vorher `usability-konsistenz` gegen Nachtrag §9.4, vor dem Push `usability-design` (Hand-Zeiger, Gold, hell **und** dunkel). Nach dem Push: Besucher-Konsole lesen und als Besucher einen Kurvenlabel-Namen sowie einen Wegnamen anklicken (Infobox wie vorher); im Bearbeiten-Modus die Handgriffe aus Task 6 Step 7. Owner schaut.

---

## Task 7: `assign_to` und `clear_assign` mit `public_ids`

Nachtrag §9.6. Die Weg-Ebene und der Gruppendialog schreiben Zuweisen/Entfernen auf GENAU ihre Abschnitte statt auf die Namens-Menge des Servers.

**Files:**
- Modify: `api/_internal/wiki/path-weitere.php` (neue Funktion nach `avesmapsWikiPathWeitereIds`)
- Modify: `api/_internal/wiki/paths.php` (`avesmapsWikiPathAssignTo` Z. 1000–1116, `avesmapsWikiPathClearAssign` Z. 1187–1272)
- Modify: `api/edit/wiki/paths.php` (Arme `clear_assign` Z. 65–71, `assign_to` Z. 78–86)
- Create: `api/_internal/wiki/__tests__/wege-gruppe-wiki-public-ids-test.php`

**Interfaces:**
- Consumes: `avesmapsWikiPathWeitereIds(mixed $roh, int $deckel): list<string>`, `AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE` (250).
- Produces:
  - `avesmapsWikiPathGruppenIdsAusRumpf(array $payload): ?list<string>` — `null` ohne Schlüssel `public_ids`, sonst normalisiert; wirft `RuntimeException`.
  - `avesmapsWikiPathAssignTo(PDO $pdo, string $wikiKey, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false, array $assignMeta = [], ?array $publicIds = null): array` — Antwortform unverändert.
  - `avesmapsWikiPathClearAssign(PDO $pdo, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false, ?array $publicIds = null): array` — Antwortform unverändert.
  - Endpunkt: `POST {action:"assign_to"|"clear_assign", public_id, public_ids?: string[], …}`.

**Risiko:** Ein Aufrufer, der positionsweise mehr Argumente übergibt als heute. Gezählt am 15.09.2026: Endpunkt (2 Arme) und `path-verlauf-faelle.php` (`assign_to` mit `single_segment` und Meta) — der neue Parameter steht hinten. Vor dem Commit `git grep -n "avesmapsWikiPathAssignTo(\|avesmapsWikiPathClearAssign(" -- api tools` erneut zählen.

- [ ] **Step 1: Test schreiben**

`api/_internal/wiki/__tests__/wege-gruppe-wiki-public-ids-test.php`:

```php
<?php

declare(strict_types=1);

// `assign_to` und `clear_assign` mit `public_ids`: die Weg-Ebene schreibt auf GENAU ihre Abschnitte
// (Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.6).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/wege-gruppe-wiki-public-ids-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require_once __DIR__ . '/../paths.php';

// Dieselbe Uebersetzung MySQL -> SQLite wie path-weitere-erhalten-test.php: die Ensure-DDL wird verschluckt, die
// information_schema-Probe antwortet mit einer Zeile. Die Produktionsabfragen bleiben unveraendert (AGENTS.md §9).
final class AvesmapsGruppeIdsTestPdo extends PDO {
    public function prepare(string $query, array $options = []): PDOStatement|false {
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        if (stripos($query, 'information_schema') !== false) {
            return parent::prepare('SELECT 1');
        }
        return parent::prepare($query, $options);
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false {
        if (stripos($query, 'information_schema') !== false) {
            return parent::query('SELECT 1');
        }
        return $fetchMode === null ? parent::query($query) : parent::query($query, $fetchMode, ...$fetchModeArgs);
    }
    public function exec(string $statement): int|false {
        if (stripos($statement, 'CREATE TABLE IF NOT EXISTS') !== false || stripos($statement, 'ALTER TABLE') !== false) {
            return 0;
        }
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }
        return parent::exec($statement);
    }
}

$pdo = new AvesmapsGruppeIdsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT NULL)');
$pdo->exec('CREATE TABLE wiki_path_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, kind TEXT, art TEXT,
    continent TEXT, lage TEXT, lage_raw TEXT, laenge TEXT, verlauf TEXT, description TEXT, synonyms_json TEXT,
    image_url TEXT, image_license_status TEXT, wiki_url TEXT, synced_at TEXT)');
$pdo->exec("INSERT INTO wiki_path_staging (wiki_key, name, kind, art, wiki_url, verlauf)
            VALUES ('alte-strasse', 'Alte Straße', 'strasse', 'Straße', 'https://de.wiki-aventurica.de/wiki/Alte_Stra%C3%9Fe', '')");

$weg = static function (string $publicId, string $name, string $subtype, array $properties) use ($pdo): void {
    $st = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
                         VALUES (:id, :name, 'path', :sub, 'LineString', '{}', :p)");
    $st->execute(['id' => $publicId, 'name' => $name, 'sub' => $subtype, 'p' => json_encode($properties, JSON_UNESCAPED_UNICODE)]);
};
$props = static function (string $publicId) use ($pdo): array {
    $st = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :id');
    $st->execute(['id' => $publicId]);
    return json_decode((string) $st->fetchColumn(), true);
};

$weg('g-1', 'Alte Straße', 'Strasse', ['name' => 'Alte Straße']);
$weg('g-2', 'Alte Straße', 'Strasse', ['name' => 'Alte Straße',
    'wiki_path_weitere' => [['wiki_key' => 'alte-strasse', 'name' => 'Alte Straße', 'wiki_url' => '', 'art' => '', 'kind' => 'strasse']]]);
$weg('fremd', 'Alte Straße', 'Strasse', ['name' => 'Alte Straße']);
$weg('f-1', 'Grauer Fluss', 'Flussweg', ['name' => 'Grauer Fluss']);

// 1. Ohne public_ids unveraendert: der Namens-Match erfasst auch den gleichnamigen FREMDEN Weg (Trockenlauf)
$trocken = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', true, 1);
assert($trocken['segments'] === 3, 'Voraussetzung: ohne public_ids zaehlen g-1, g-2 UND fremd: ' . json_encode($trocken));

// 2. Mit public_ids: GENAU diese Abschnitte
$echt = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', false, 1, false, [], ['g-1', 'g-2']);
assert($echt['type_ok'] === true && $echt['applied'] === 2, json_encode($echt));
$geschrieben = array_column($echt['segments_updated'], 'public_id');
sort($geschrieben);
assert($geschrieben === ['g-1', 'g-2'], json_encode($geschrieben));
assert(($props('g-1')['wiki_path']['wiki_key'] ?? '') === 'alte-strasse');
assert(!array_key_exists('wiki_path', $props('fremd')), 'der gleichnamige fremde Weg bleibt unberuehrt');
assert(($props('g-2')['wiki_path_weitere'] ?? null) === [], 'der Riegel OhneHaupt gilt auch mit public_ids -- und laesst [] stehen (§9.2)');

// 3. Loesen mit public_ids: nur diese, jeder mit eigenem generischem Namen (R2); der fremde Weg behaelt seine Zuweisung
$pdo->exec("UPDATE map_features SET properties_json = '" . json_encode(
    ['name' => 'Alte Straße', 'wiki_path' => ['wiki_key' => 'alte-strasse', 'name' => 'Alte Straße']], JSON_UNESCAPED_UNICODE
) . "' WHERE public_id = 'fremd'");
$geloest = avesmapsWikiPathClearAssign($pdo, 'g-1', false, 1, false, ['g-1', 'g-2']);
assert($geloest['segments'] === 2 && $geloest['applied'] === 2, json_encode($geloest));
assert(!array_key_exists('wiki_path', $props('g-1')) && !array_key_exists('wiki_path', $props('g-2')));
assert(($props('fremd')['wiki_path']['wiki_key'] ?? '') === 'alte-strasse',
    'ohne public_ids haette Namens-Key UNION wiki_key den fremden Weg mitgeloest');
$namen = array_column($geloest['segments_updated'], 'name');
assert(count(array_unique($namen)) === 2 && !in_array('Alte Straße', $namen, true),
    'R2: jeder Abschnitt bekommt einen EIGENEN generischen Namen: ' . json_encode($namen, JSON_UNESCAPED_UNICODE));

// 4. Typriegel ueber JEDEN Zielweg: ein Flussweg in der Liste -> nichts geschrieben
$vorher = $props('g-1');
$typ = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', false, 1, false, [], ['g-1', 'f-1']);
assert($typ['type_ok'] === false && $typ['applied'] === 0, json_encode($typ));
assert($props('g-1') === $vorher, 'passt ein Abschnitt nicht, bleibt auch der passende unberuehrt');

// 5. Ablehnungen
foreach ([
    'assign: single_segment und public_ids' => static fn() => avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'g-1', true, 1, true, [], ['g-1', 'g-2']),
    'assign: Anker nicht in public_ids' => static fn() => avesmapsWikiPathAssignTo($pdo, 'alte-strasse', 'fremd', true, 1, false, [], ['g-1', 'g-2']),
    'clear: single_segment und public_ids' => static fn() => avesmapsWikiPathClearAssign($pdo, 'g-1', true, 1, true, ['g-1']),
    'clear: Anker nicht in public_ids' => static fn() => avesmapsWikiPathClearAssign($pdo, 'fremd', true, 1, false, ['g-1']),
] as $fall => $aufruf) {
    $geworfen = false;
    try {
        $aufruf();
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen, $fall . ' muss abgelehnt werden');
}

// 6. Der Rumpf-Leser des Endpunkts
assert(avesmapsWikiPathGruppenIdsAusRumpf(['public_id' => 'g-1']) === null, 'ohne public_ids: bisheriges Verhalten');
assert(avesmapsWikiPathGruppenIdsAusRumpf(['public_ids' => ['g-1', ' g-1 ', 'g-2']]) === ['g-1', 'g-2']);
foreach ([[], 'g-1', null, array_map(static fn(int $i): string => 'id' . $i, range(1, 251))] as $falsch) {
    $geworfen = false;
    try {
        avesmapsWikiPathGruppenIdsAusRumpf(['public_ids' => $falsch]);
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen, 'ungueltige public_ids muessen abgelehnt werden');
}

// 7. Der Endpunkt reicht die Angabe an BEIDE Aktionen durch, die Rechte bleiben `review` (Nachtrag §9.7)
$endpunkt = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../../../edit/wiki/paths.php')) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $endpunkt .= is_array($token) ? $token[1] : $token;
}
$arm = static function (string $von, string $bis) use ($endpunkt): string {
    $a = strpos($endpunkt, $von);
    $b = $a === false ? false : strpos($endpunkt, $bis, $a);
    assert($a !== false && $b !== false, "Arm $von nicht gefunden");
    return substr($endpunkt, $a, $b - $a);
};
assert(str_contains($arm("'clear_assign' =>", "'assign_all' =>"), 'avesmapsWikiPathGruppenIdsAusRumpf($payload)'), 'clear_assign bekommt public_ids');
assert(str_contains($arm("'assign_to' =>", "'backfill_verlauf_source' =>"), 'avesmapsWikiPathGruppenIdsAusRumpf($payload)'), 'assign_to bekommt public_ids');
assert(str_contains($endpunkt, "avesmapsRequireUserWithCapability('review')"), 'die Fähigkeit bleibt review (E12)');

echo "wege-gruppe-wiki-public-ids-test.php: ok\n";
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/wege-gruppe-wiki-public-ids-test.php`
Expected: FAIL in Abschnitt 2 (`applied` 3 statt 2 — die Angabe wird noch ignoriert) oder `ArgumentCountError`-freier Lauf mit falscher Zahl.

- [ ] **Step 3: Rumpf-Leser**

In `api/_internal/wiki/path-weitere.php` direkt nach der schließenden `}` von `avesmapsWikiPathWeitereIds` einfügen:

```php

/**
 * Die Abschnitte der ganzen Strasse aus dem Rumpf von `assign_to`/`clear_assign` (Nachtrag 15.09.2026 §9.6).
 * `null`, wenn der Rumpf keine nennt -- dann gilt das bisherige Verhalten (Namens-Match). Sonst dieselbe
 * Normalisierung und derselbe Deckel wie bei den weiteren Zuweisungen; ungueltig wirft RuntimeException (-> 400).
 */
function avesmapsWikiPathGruppenIdsAusRumpf(array $payload): ?array {
    if (!array_key_exists('public_ids', $payload)) {
        return null;
    }
    return avesmapsWikiPathWeitereIds($payload['public_ids'], AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE);
}
```

- [ ] **Step 4: `avesmapsWikiPathAssignTo`**

In `api/_internal/wiki/paths.php`:

1. Signatur ersetzen — `function avesmapsWikiPathAssignTo(PDO $pdo, string $wikiKey, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false, array $assignMeta = []): array {` wird zu:

```php
function avesmapsWikiPathAssignTo(PDO $pdo, string $wikiKey, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false, array $assignMeta = [], ?array $publicIds = null): array {
```

2. Direkt nach dem Block

```php
    if ($wikiKey === '' || $publicId === '') {
        throw new RuntimeException('wiki_key/public_id fehlt.');
    }
```

einfügen:

```php
    // Nachtrag 15.09.2026 §9.6: mit `public_ids` sind die Ziele GENAU diese Abschnitte (Weg-Ebene, Gruppendialog) --
    // nicht die Namens-Menge. Der Client nennt sie, der Server bildet keine Gruppe nach.
    if ($publicIds !== null) {
        if ($singleSegment) {
            throw new RuntimeException('single_segment and public_ids exclude each other.');
        }
        if (!in_array($publicId, $publicIds, true)) {
            throw new RuntimeException('public_id must be one of public_ids.');
        }
    }
```

3. Den Block

```php
    if ($singleSegment) {
        $single = $pdo->prepare("SELECT id, public_id, name, properties_json FROM map_features WHERE public_id = :p AND is_active = 1 AND feature_type = 'path' AND name <> '' LIMIT 1");
        $single->execute(['p' => $publicId]);
        $paths = $single->fetchAll(PDO::FETCH_ASSOC);
    } else {
```

ersetzen durch

```php
    if ($publicIds !== null) {
        $platzhalter = implode(',', array_fill(0, count($publicIds), '?'));
        $gruppe = $pdo->prepare("SELECT id, public_id, name, feature_subtype, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> '' AND public_id IN ($platzhalter)");
        $gruppe->execute($publicIds);
        $paths = $gruppe->fetchAll(PDO::FETCH_ASSOC);
        // 💣 JEDER Zielweg durch den Typriegel, nicht nur der Anker: eine Gruppe darf keinen Strassen-Artikel an einem
        // Flussstueck bekommen, nur weil der angeklickte Abschnitt eine Strasse ist. Passt einer nicht, wird nichts geschrieben.
        foreach ($paths as $p) {
            $subtype = strtolower((string) ($p['feature_subtype'] ?? ''));
            if (($subtype === 'flussweg' || $subtype === 'seeweg') !== $wikiIsRiver) {
                return [
                    'ok' => true,
                    'type_ok' => false,
                    'message' => '„' . (string) $row['name'] . '" passt nicht zu jedem Abschnitt: „' . (string) $p['name'] . '" ist '
                        . ($wikiIsRiver ? 'kein Fluss' : 'ein Fluss') . '.',
                    'dry_run' => $dryRun,
                    'applied' => 0,
                    'segments_updated' => [],
                ];
            }
        }
    } elseif ($singleSegment) {
        $single = $pdo->prepare("SELECT id, public_id, name, properties_json FROM map_features WHERE public_id = :p AND is_active = 1 AND feature_type = 'path' AND name <> '' LIMIT 1");
        $single->execute(['p' => $publicId]);
        $paths = $single->fetchAll(PDO::FETCH_ASSOC);
    } else {
```

4. In der Schleife die Zeile `        if (avesmapsWikiSyncCreateMatchKey((string) $p['name']) !== $targetKey) {` ersetzen durch:

```php
        // Mit public_ids entscheidet die Liste, nicht der Name (die Abfrage oben hat schon gefiltert).
        if ($publicIds === null && avesmapsWikiSyncCreateMatchKey((string) $p['name']) !== $targetKey) {
```

- [ ] **Step 5: `avesmapsWikiPathClearAssign`**

1. Signatur `function avesmapsWikiPathClearAssign(PDO $pdo, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false): array {` ersetzen durch:

```php
function avesmapsWikiPathClearAssign(PDO $pdo, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false, ?array $publicIds = null): array {
```

2. Direkt nach

```php
    if ($publicId === '') {
        throw new RuntimeException('public_id fehlt.');
    }
```

einfügen:

```php
    // Nachtrag 15.09.2026 §9.6: mit `public_ids` werden GENAU diese Abschnitte geloest -- nicht Namens-Key UNION wiki_key.
    if ($publicIds !== null) {
        if ($singleSegment) {
            throw new RuntimeException('single_segment and public_ids exclude each other.');
        }
        if (!in_array($publicId, $publicIds, true)) {
            throw new RuntimeException('public_id must be one of public_ids.');
        }
    }
```

3. Den Block, der mit `    if ($singleSegment) {` und `        $single = $pdo->prepare("SELECT id, public_id, name, feature_subtype, properties_json FROM map_features WHERE public_id = :p` beginnt, so erweitern, dass davor ein eigener Zweig steht — die Zeile `    if ($singleSegment) {` (die erste in dieser Funktion) ersetzen durch:

```php
    if ($publicIds !== null) {
        $platzhalter = implode(',', array_fill(0, count($publicIds), '?'));
        $gruppe = $pdo->prepare("SELECT id, public_id, name, feature_subtype, properties_json FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> '' AND public_id IN ($platzhalter)");
        $gruppe->execute($publicIds);
        $paths = $gruppe->fetchAll(PDO::FETCH_ASSOC);
        // Der Namenspool braucht ALLE Wegnamen, sonst kollidiert ein generischer Name (wie im single_segment-Zweig).
        $namePool = array_map(static fn(array $r): string => (string) $r['name'], $pdo->query("SELECT name FROM map_features WHERE is_active = 1 AND feature_type = 'path' AND name <> ''")->fetchAll(PDO::FETCH_ASSOC));
    } elseif ($singleSegment) {
```

4. In der Schleife die Zeile `        if (!avesmapsWikiPathRowMatchesWay((string) $p['name'], $p['properties_json'] ?? null, $targetKey, $targetWikiKey)) {` ersetzen durch:

```php
        if ($publicIds === null && !avesmapsWikiPathRowMatchesWay((string) $p['name'], $p['properties_json'] ?? null, $targetKey, $targetWikiKey)) {
```

⚠️ In dieser Funktion gibt es zwei Zeilen `if ($singleSegment …`: die Zweigwahl vor der Abfrage (wird zum `elseif`) und die Überspring-Zeile in der Schleife (`if ($singleSegment && (string) $p['public_id'] !== $publicId) {`, bleibt). Nur die erste ändern.

- [ ] **Step 6: Endpunkt**

In `api/edit/wiki/paths.php` im Arm `'clear_assign' => avesmapsWikiPathClearAssign(` die Zeile `                ($payload['single_segment'] ?? false) === true` (die letzte Argumentzeile dieses Arms) ersetzen durch:

```php
                ($payload['single_segment'] ?? false) === true,
                // Nachtrag 15.09.2026 §9.6: die Abschnitte der ganzen Strasse (Weg-Ebene, Gruppendialog), sonst null.
                avesmapsWikiPathGruppenIdsAusRumpf($payload)
```

Im Arm `'assign_to' => avesmapsWikiPathAssignTo(` die letzte Argumentzeile `                $assignMeta` ersetzen durch:

```php
                $assignMeta,
                avesmapsWikiPathGruppenIdsAusRumpf($payload)
```

⚠️ `$assignMeta` steht auch als letzte Zeile der Arme `assign` und `assign_all` — nur den Arm `assign_to` ändern (Edit mit dem ganzen Arm als Kontext).

- [ ] **Step 7: Tests laufen lassen**

Run: der neue Test aus Step 1, dann `path-weitere-erhalten-test.php`, `path-weitere-schreiben-test.php`, `path-weitere-verlauf-test.php`, und `find api -path '*__tests__*' -name '*verlauf*'` einzeln.
Expected: alle `ok`.

- [ ] **Step 8: Commit**

```bash
printf '%s\n' "feat(wege): assign_to und clear_assign nehmen public_ids -- die ganze Strasse schreibt auf genau ihre Abschnitte" "" "Ohne public_ids unveraendert; mit public_ids Typriegel ueber jeden Zielweg, single_segment ausgeschlossen." "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.6." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/_internal/wiki/path-weitere.php api/_internal/wiki/paths.php api/edit/wiki/paths.php api/_internal/wiki/__tests__/wege-gruppe-wiki-public-ids-test.php && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 8: Die Einhängestelle im Wiki-Zuweisungs-Bauteil

Nachtrag §9.5. Opt-in: ohne `anhang` bleibt das Markup aller acht Objektarten Zeichen für Zeichen gleich.

**Files:**
- Create: `js/ui/__tests__/fixtures/wiki-assign-markup-ohne-anhang.json` (erzeugt VOR der Änderung)
- Create: `js/ui/__tests__/wiki-assign-anhang.test.js`
- Modify: `js/ui/wiki-assign.js` (Schnittstellen-Kommentar Z. 16–26; `avesmapsWikiAssignModell` nach dem `else`-Zweig Z. 586–593; `avesmapsWikiAssignMarkup` vor dem Schreibzeilen-Block Z. 831; im Mount `modellJetzt` Z. 1087–1090, `zeichne` Z. 1119–1129, die fünf Zuhörer Z. 1512, 1568, 1581, 1592, 1608; Export)

**Interfaces:**
- Produces:
  - Option `anhang: HTMLElement` an `avesmapsWikiAssignMount(behaelter, optionen)`.
  - `avesmapsWikiAssignModell(erklaerung, daten, ui)` setzt `modell.anhang = ui.anhang === true` nur in „offen“/„zugewiesen“.
  - `avesmapsWikiAssignMarkup` erzeugt `<div data-wa-anhang></div>` direkt vor der Schreibzeile, wenn `modell.anhang === true`.
  - `avesmapsWikiAssignAusAnhang(ziel): boolean` (rein, exportiert).

**Risiko:** Das Bauteil bedient acht Objektarten in elf Oberflächen. Jede unbeabsichtigte Markup-Änderung verschiebt dort Layout; der Golden-Master fängt sie. Zweites Risiko: die Ereignis-Riegel über `contains` statt `closest` würden in den Attrappen der bestehenden Tests (`contains()` antwortet immer `true`) jeden Klick schlucken.

- [ ] **Step 1: Golden-Master VOR der Änderung erzeugen**

```bash
cat > "$SCRATCH/golden.js" <<'EOF'
const fs = require("fs");
const path = require("path");
const WURZEL = process.cwd();
const R = require(path.join(WURZEL, "js/ui/wiki-assign-registry.js"));
const A = require(path.join(WURZEL, "js/ui/wiki-assign.js"));
const faelle = {};
for (const subject of Object.keys(R.AVESMAPS_WIKI_ASSIGN_REGISTRY)) {
	const e = R.avesmapsWikiAssignSubject(subject);
	const werte = {};
	(e.felder || []).forEach((f) => { if (f && f.wiki) { werte[f.wiki] = "W-" + f.wiki; } });
	const artikel = { name: "Artikel", wiki_url: "https://de.wiki-aventurica.de/wiki/Artikel", wiki_key: "artikel", werte };
	const zustaende = {
		offen: [{ artikel: null }, { modus: "offen", listenId: "probe" }],
		zugewiesen: [{ artikel }, { modus: "zugewiesen", listenId: "probe" }],
		zugewiesenUngespeichert: [{ artikel }, { modus: "zugewiesen", listenId: "probe", ungespeichert: true }],
		suche: [{ artikel }, { modus: "suche", listenId: "probe", suchtext: "Art", treffer: [{ name: "Treffer", wiki_url: "", wiki_key: "t", werte }] }],
		sync: [{ artikel }, { modus: "sync", listenId: "probe", syncZeilen: [] }],
	};
	for (const skin of ["dt", "label-wiki"]) {
		for (const [name, [daten, ui]] of Object.entries(zustaende)) {
			faelle[subject + "|" + skin + "|" + name] = A.avesmapsWikiAssignMarkup(A.avesmapsWikiAssignModell(e, daten, ui), A.avesmapsWikiAssignSkin(skin));
		}
	}
}
fs.mkdirSync(path.join(WURZEL, "js/ui/__tests__/fixtures"), { recursive: true });
fs.writeFileSync(path.join(WURZEL, "js/ui/__tests__/fixtures/wiki-assign-markup-ohne-anhang.json"), JSON.stringify(faelle, null, 1) + "\n");
console.log(Object.keys(faelle).length + " Faelle");
EOF
node "$SCRATCH/golden.js"
git diff --quiet -- js/ui/wiki-assign.js && echo "wiki-assign.js unveraendert -- Golden-Master gilt"
```

Expected: `80 Faelle` und `wiki-assign.js unveraendert -- Golden-Master gilt`.

- [ ] **Step 2: Test schreiben**

`js/ui/__tests__/wiki-assign-anhang.test.js`:

```js
"use strict";
// Die Einhaengestelle `anhang` des Wiki-Zuweisungs-Bauteils (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5).
// 🔴 Der Golden-Master (fixtures/wiki-assign-markup-ohne-anhang.json) ist VOR der Aenderung erzeugt: ohne `anhang` muss das
// Markup aller acht Objektarten in beiden Huellen und fuenf Zustaenden Zeichen fuer Zeichen gleich bleiben.
// Aus der Wurzel: node js/ui/__tests__/wiki-assign-anhang.test.js
const assert = require("assert");
const path = require("path");

const R = require("../wiki-assign-registry.js");
const A = require("../wiki-assign.js");
const golden = require("./fixtures/wiki-assign-markup-ohne-anhang.json");
global.avesmapsWikiAssignSubject = R.avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = require("../wiki-assign-diff.js").avesmapsWikiAssignDiff;

const warten = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

function faelle(mitAnhang) {
	const aus = {};
	for (const subject of Object.keys(R.AVESMAPS_WIKI_ASSIGN_REGISTRY)) {
		const e = R.avesmapsWikiAssignSubject(subject);
		const werte = {};
		(e.felder || []).forEach((f) => { if (f && f.wiki) { werte[f.wiki] = "W-" + f.wiki; } });
		const artikel = { name: "Artikel", wiki_url: "https://de.wiki-aventurica.de/wiki/Artikel", wiki_key: "artikel", werte };
		const zustaende = {
			offen: [{ artikel: null }, { modus: "offen", listenId: "probe" }],
			zugewiesen: [{ artikel }, { modus: "zugewiesen", listenId: "probe" }],
			zugewiesenUngespeichert: [{ artikel }, { modus: "zugewiesen", listenId: "probe", ungespeichert: true }],
			suche: [{ artikel }, { modus: "suche", listenId: "probe", suchtext: "Art", treffer: [{ name: "Treffer", wiki_url: "", wiki_key: "t", werte }] }],
			sync: [{ artikel }, { modus: "sync", listenId: "probe", syncZeilen: [] }],
		};
		for (const skin of ["dt", "label-wiki"]) {
			for (const [name, [daten, ui]] of Object.entries(zustaende)) {
				const uiMit = mitAnhang === undefined ? ui : Object.assign({}, ui, { anhang: mitAnhang });
				aus[subject + "|" + skin + "|" + name] = A.avesmapsWikiAssignMarkup(A.avesmapsWikiAssignModell(e, daten, uiMit), A.avesmapsWikiAssignSkin(skin));
			}
		}
	}
	return aus;
}

(async () => {
	// ---- 1. Golden-Master: ohne Anhang (und mit anhang:false) Zeichen fuer Zeichen gleich ----------------------
	const ohne = faelle(undefined);
	assert.strictEqual(Object.keys(golden).length, 80, "der Golden-Master deckt 8 Objektarten × 2 Huellen × 5 Zustaende");
	assert.deepStrictEqual(Object.keys(ohne).sort(), Object.keys(golden).sort(), "eine Objektart kam dazu oder fiel weg -- Fixture neu erzeugen, BEVOR das Bauteil geaendert wird");
	for (const [schluessel, markup] of Object.entries(golden)) {
		assert.strictEqual(ohne[schluessel], markup, "ohne anhang hat sich das Markup geaendert: " + schluessel);
	}
	const aus = faelle(false);
	for (const [schluessel, markup] of Object.entries(golden)) {
		assert.strictEqual(aus[schluessel], markup, "anhang:false aendert das Markup: " + schluessel);
	}

	// ---- 2. Mit Anhang: genau ein Platz in den Ruhezustaenden, direkt VOR der Schreibzeile; in Suche/Sync keiner ----
	const mit = faelle(true);
	for (const [schluessel, markup] of Object.entries(mit)) {
		const zustand = schluessel.split("|")[2];
		const plaetze = markup.split("<div data-wa-anhang></div>").length - 1;
		if (zustand === "suche" || zustand === "sync") {
			assert.strictEqual(plaetze, 0, "kein Anhang in Suche/Sync-Vorschau: " + schluessel);
			assert.strictEqual(markup, golden[schluessel], "Suche/Sync bleiben auch mit anhang unveraendert: " + schluessel);
			continue;
		}
		assert.strictEqual(plaetze, 1, "genau ein Platz: " + schluessel);
		const platz = markup.indexOf("<div data-wa-anhang></div>");
		const schreibzeile = markup.indexOf("data-wa-schreibzeile");
		assert.ok(schreibzeile > platz, "der Platz steht UEBER der Schreibzeile („wirkt sofort“ gilt dem ganzen Kasten): " + schluessel);
		assert.strictEqual(markup.replace("<div data-wa-anhang></div>", ""), golden[schluessel], "sonst aendert sich nichts: " + schluessel);
	}

	// ---- 3. Der reine Ereignis-Riegel: `closest`, nicht `contains` -------------------------------------------------
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({ closest: (s) => (s === "[data-wa-anhang]" ? {} : null) }), true);
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({ closest: () => null, contains: () => true }), false, "`contains` zaehlt nicht");
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang(null), false);
	assert.strictEqual(A.avesmapsWikiAssignAusAnhang({}), false);

	// ---- 4. Der Mount: Umhaengen nach jedem Neuzeichnen, Ereignisse aus dem Anhang gehoeren dem Wirt ----------------
	let fetches = 0;
	global.fetch = async () => { fetches += 1; return { ok: true, json: async () => ({ rows: [] }) }; };
	const platz = { kinder: [], appendChild(kind) { this.kinder.push(kind); return kind; } };
	const behaelter = {
		innerHTML: "", textContent: "", zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete this.zuhoerer[typ]; },
		contains() { return true; },
		querySelector(sel) { return sel === "[data-wa-anhang]" && this.innerHTML.includes("data-wa-anhang") ? platz : null; },
	};
	const anhang = { name: "anhang-des-wirts" };
	let geloest = 0;
	const st = A.avesmapsWikiAssignMount(behaelter, {
		subject: "weg", skin: "dt", anhang,
		laden: () => ({ artikel: { name: "Reichsstraße 2", wiki_url: "https://x/R", wiki_key: "reichsstrasse-2", werte: {} }, kartenwerte: { feature_subtype: "Reichsstrasse" } }),
		zuweisen: () => {}, loesen: () => { geloest += 1; }, syncUebernehmen: () => {},
	});
	await warten(0);
	assert.strictEqual(st.bereit, true);
	assert.deepStrictEqual(platz.kinder, [anhang], "nach dem ersten Zeichnen haengt das Element des Wirts im Platz");

	const aktion = (name, ausAnhang) => ({
		target: { closest: (sel) => (sel === "[data-wa-anhang]" ? (ausAnhang ? {} : null) : (sel === "[data-wa-aktion]" ? { getAttribute: () => name } : null)) },
		preventDefault() {},
	});
	behaelter.zuhoerer.click(aktion("aendern", false));
	await warten(0);
	assert.ok(!behaelter.innerHTML.includes("data-wa-anhang"), "in der Suche steht kein Platz");
	assert.strictEqual(platz.kinder.length, 1, "in der Suche wird nichts eingehaengt");
	behaelter.zuhoerer.click(aktion("abbrechen", false));
	await warten(0);
	assert.strictEqual(platz.kinder.length, 2, "zurueck im Ruhezustand wird DASSELBE Element wieder eingehaengt");
	assert.strictEqual(platz.kinder[1], anhang);

	behaelter.zuhoerer.click(aktion("entfernen", true));
	await warten(0);
	assert.strictEqual(geloest, 0, "ein Klick aus dem Anhang loest keine Aktion des Bauteils aus");

	const fetchesVorher = fetches;
	behaelter.zuhoerer.input({ target: { closest: (s) => (s === "[data-wa-anhang]" ? {} : null), hasAttribute: () => true, value: "bär" } });
	await warten(250);
	assert.strictEqual(fetches, fetchesVorher, "Tippen im Suchfeld des Anhangs startet keine Suche des Bauteils");

	const kinderVorher = platz.kinder.length;
	behaelter.zuhoerer.keydown({ key: "Escape", preventDefault() {}, target: { closest: (s) => (s === "[data-wa-anhang]" ? {} : null), hasAttribute: () => true } });
	assert.strictEqual(platz.kinder.length, kinderVorher, "Escape im Anhang zeichnet das Bauteil nicht neu");

	let gewaehlt = 0;
	behaelter.zuhoerer.mousedown({ button: 0, preventDefault() { gewaehlt += 1; }, target: { closest: (s) => (s === "[data-wa-anhang]" ? {} : (s === "[data-wa-treffer]" ? { getAttribute: () => "0" } : null)) } });
	assert.strictEqual(gewaehlt, 0, "ein Druck im Anhang wird nicht als Trefferwahl verbraucht");

	behaelter.zuhoerer.change({ target: { closest: (s) => (s === "[data-wa-anhang]" ? {} : null), hasAttribute: () => true, getAttribute: () => "0", checked: true } });
	assert.strictEqual(platz.kinder.length, kinderVorher, "ein change im Anhang zeichnet das Bauteil nicht neu");

	st.zerstoeren();
	console.log("wiki-assign-anhang.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Step 3: Test laufen lassen, er muss scheitern**

Run: `node js/ui/__tests__/wiki-assign-anhang.test.js`
Expected: FAIL in Abschnitt 2 (`genau ein Platz: kraftlinie|dt|offen`).

- [ ] **Step 4: Umsetzen**

In `js/ui/wiki-assign.js`:

1. Im Schnittstellen-Kommentar nach der Zeile `//       schreibt:        "sofort"|"speichern", // OPTIONAL — siehe die 🪤 in \`mount\`; EIN Aufrufer` einfügen:

```js
//       anhang:          element,            // OPTIONAL — ein Element des WIRTS, das im Kasten ueber der Schreibzeile
//                                            // haengt (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5)
```

2. In `avesmapsWikiAssignModell` direkt VOR der Kommentarzeile, die mit `	// 🔴 HIER STAND DER DRITTE ZUSTAND` beginnt (nach dem `else`-Zweig mit `AVESMAPS_WIKI_ASSIGN_TEXTE.keine`), einfügen:

```js
	// 🔴 DIE EINHAENGESTELLE (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5): nur in den Ruhezustaenden und nur,
	// wenn der Wirt etwas einhaengt. Suche und Sync-Vorschau sind oben schon zurueckgekehrt -- ein zweites Suchfeld unter
	// einer Trefferliste laese sich wie ein Teil davon.
	// 💣 Ohne `ui.anhang` bleibt das Markup Zeichen fuer Zeichen wie vorher; js/ui/__tests__/wiki-assign-anhang.test.js haelt
	// das per Golden-Master ueber alle acht Erklaerungen fest.
	modell.anhang = z.anhang === true;

```

3. In `avesmapsWikiAssignMarkup` direkt VOR der Kommentarzeile `	// 🔴 GANZ UNTEN, direkt ueber dem Rand des Kastens: die Zeile beantwortet` einfügen:

```js
	// Der Platz fuer den Anhang des Wirts -- UEBER der Schreibzeile, damit „wirkt sofort“ fuer den ganzen Kasten gilt.
	// ⚠️ Ohne Klasse: eine neue Huellenrolle braeuchte in BEIDEN Huellen einen Namen und in beiden Blaettern eine Regel.
	if (modell.anhang === true) {
		teile.push("<div data-wa-anhang></div>");
	}
```

4. Direkt vor dem Kommentarblock (`/**`), der über `function avesmapsWikiAssignBlindgaenger() {` steht, einfügen:

```js
/**
 * REIN: kommt ein Ereignis aus dem Anhang des Wirts? Dann gehoert es nicht dem Bauteil (Nachtrag §9.5).
 * 💣 Ueber `closest`, NICHT ueber `contains`: die Attrappen der bestehenden Tests antworten auf `contains` immer mit ja und
 * liessen damit jeden Klick verschwinden.
 */
function avesmapsWikiAssignAusAnhang(ziel) {
	return Boolean(ziel && typeof ziel.closest === "function" && ziel.closest("[data-wa-anhang]"));
}

```

5. In `modellJetzt` die Zeile `			Object.assign({}, ui, { ungespeichert: ungespeichert }));` ersetzen durch:

```js
			Object.assign({}, ui, { ungespeichert: ungespeichert, anhang: Boolean(opt.anhang) }));
```

6. Direkt vor `	function zeichne() {` einfügen:

```js
	// 🔴 Nach JEDEM vollen Zeichnen: `innerHTML` hat den Platz neu gebaut, das Element des Wirts haengt sonst in der Luft.
	// Es ist dasselbe Element -- seine Eingaben und seine Zuhoerer ueberleben das Umhaengen.
	function anhangEinhaengen() {
		if (!opt.anhang) {
			return;
		}
		const platz = behaelter.querySelector("[data-wa-anhang]");
		if (platz && typeof platz.appendChild === "function") {
			platz.appendChild(opt.anhang);
		}
	}

```

und in `zeichne` die Zeile `		behaelter.innerHTML = avesmapsWikiAssignMarkup(modell, skin);` ersetzen durch:

```js
		behaelter.innerHTML = avesmapsWikiAssignMarkup(modell, skin);
		anhangEinhaengen();
```

7. In den fünf Zuhörern `aufKlick`, `aufDruck`, `aufEingabe`, `aufAenderung`, `aufTaste` jeweils direkt nach `		const ziel = ereignis.target;` einfügen:

```js
		// Nachtrag §9.5: Ereignisse aus dem Anhang des Wirts blubbern hierher, gehoeren aber ihm.
		if (avesmapsWikiAssignAusAnhang(ziel)) {
			return;
		}
```

(Vorher `grep -n "const ziel = ereignis.target;" js/ui/wiki-assign.js` — nur die Treffer in diesen fünf Funktionen ändern.)

8. Im `module.exports` nach `avesmapsWikiAssignMarkup: avesmapsWikiAssignMarkup,` einfügen:

```js
		avesmapsWikiAssignAusAnhang: avesmapsWikiAssignAusAnhang,
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node js/ui/__tests__/wiki-assign-anhang.test.js` und alle Tests des Bauteils: `for t in js/ui/__tests__/wiki-assign*.test.js js/review/__tests__/wiki-assign*.test.js; do node "$t" >/dev/null || echo "ROT: $t"; done`
Expected: `wiki-assign-anhang.test.js: ok`, keine `ROT`-Zeile.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "refactor(wiki-zuweisung): optionale Einhaengestelle anhang im Bauteil -- Markup der uebrigen Objektarten unveraendert" "" "Golden-Master ueber 8 Erklaerungen x 2 Huellen x 5 Zustaende, erzeugt vor der Aenderung." "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.5." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/ui/wiki-assign.js js/ui/__tests__/wiki-assign-anhang.test.js js/ui/__tests__/fixtures/wiki-assign-markup-ohne-anhang.json && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 9: Der Kasten „Weitere Wiki-Zuweisungen“ nur noch eingebettet

Nachtrag §9.5: keine eigene Überschrift, keine Zeile „Hauptzuweisung“, Zeilen auch ohne Hauptzuweisung, „wirken sofort“ sagt die Schreibzeile des Bauteils.

**Files:**
- Modify: `js/ui/wiki-weitere-kasten.js` (`avesmapsWikiWeitereSkin` Z. 112–116, `avesmapsWikiWeitereMarkup` Z. 118–144, `modell()` im Mount Z. 177–190)
- Modify: `css/components/wiki-weitere-kasten.css` (neue Regel `.wiki-weitere-kasten`; Regel `.wiki-weitere__haupt .wiki-weitere__art` Z. 25 entfällt)
- Modify: `css/components/editor-page.css` (Selektorliste Z. 684–685 und Kommentar Z. 676–683)
- Modify: `js/ui/__tests__/wiki-weitere-kasten.test.js` (Abschnitt 3 Z. 73–91, Abschnitt 11 Z. 235–244)

**Interfaces:**
- Produces: `avesmapsWikiWeitereMarkup(modell: {hauptKey, umfang, zuordnungen}, skin): string`; `avesmapsWikiWeitereSkin(name): object` (die Klassen der Wiki-Zuweisungs-Hülle). `opts.haupt` wird nicht mehr gelesen.

**Risiko:** Zwischen Task 9 und Task 11/12 hängt der Kasten noch in seinen alten, eigenen Hosts — ohne Überschrift. Deshalb gehen Tasks 7–12 als EINE Lieferung live.

- [ ] **Step 1: Test anpassen**

In `js/ui/__tests__/wiki-weitere-kasten.test.js`:

1. In Abschnitt 3 nach der Zusicherung `"ohne Hauptzuweisung kein Suchfeld (§2.2 Nr. 1)");` einfügen:

```js
	// Nachtrag 15.09.2026 §9.5: die weiteren Zuweisungen stehen auch OHNE Hauptzuweisung da -- §2.2 Nr. 5 laesst sie stehen,
	// und ohne Zeile waeren sie nicht mehr zu entfernen.
	const ohneHauptMitListe = K.avesmapsWikiWeitereMarkup({ hauptKey: "", umfang: "x", zuordnungen: teil }, SKIN);
	assert.ok(ohneHauptMitListe.includes('data-weitere-weg="b-renpfad"') && !ohneHauptMitListe.includes("data-weitere-suche"),
		"ohne Hauptzuweisung: Zeilen mit ✕, aber kein Suchfeld");
	assert.ok(ohneHauptMitListe.includes("data-weitere-status"), "und eine Statuszeile fuer das Entfernen");
```

2. Nach der Zeile `assert.ok(mit.includes("data-weitere-suche") && mit.includes("ändert den Wegnamen nie"));` einfügen:

```js
	assert.ok(!mit.includes("wirken sofort"), "„wirken sofort“ sagt die Schreibzeile des Kastens „Wiki-Weg“ einmal fuer alles (§9.5)");
	assert.ok(!mit.includes(">Weitere Wiki-Zuweisungen</div>"), "keine eigene Ueberschrift -- der Kasten haengt im Kasten „Wiki-Weg“");
```

3. Den Block von `	// Entwurf §3.5: die Liste nennt die Hauptzuweisung zuerst (ohne ✕)` bis einschließlich `	assert.ok(!mit.includes("Hauptzuweisung"), "ohne \`haupt\` keine Hauptzeile");` ersetzen durch:

```js
	// Nachtrag 15.09.2026 §9.5: KEINE Zeile „Hauptzuweisung“ mehr -- die zeigt der Kasten „Wiki-Weg“ darueber, auch wenn ein
	// alter Wirt `haupt` noch mitgibt.
	const mitHaupt = K.avesmapsWikiWeitereMarkup({ hauptKey: "reichsstrasse-2", umfang: "die ganze Straße", zuordnungen: teil,
		haupt: { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://x/R" }, hauptWo: "ganze Straße" }, SKIN);
	assert.ok(!mitHaupt.includes("Hauptzuweisung"), "keine Hauptzeile im eingebetteten Kasten");
	assert.ok(/weitere\s*<button[^>]*data-weitere-weg="b-renpfad"/.test(mitHaupt), "eine weitere Zuweisung heisst „weitere");
	assert.ok(!/data-weitere-weg="reichsstrasse-2"/.test(mitHaupt));
```

4. Den Block ab `	// Quelltext-Gegenprobe: dieselbe Trennlinien-Regel traegt jetzt BEIDE Huellen` bis zur schließenden `	}` dieses Blocks ersetzen durch:

```js
	// Nachtrag 15.09.2026 §9.5: die eigene Ueberschrift ist gefallen, mit ihr der zweite Selektor. Die Trennlinie zur
	// Hauptzuweisung traegt die Huelle selbst -- mit der Linie der Tabellenzeilen, ohne feste Farbe.
	{
		const wurzel = path.join(__dirname, "..", "..", "..");
		const lesen = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
		assert.ok(!/\.wiki-weitere-kasten\s*>\s*\.dt-grp/.test(lesen("css/components/editor-page.css")),
			"der zweite Selektor fuer die eigene Ueberschrift ist mit ihr gefallen");
		assert.ok(/\.avm-wiki-assign\s*>\s*\.dt-grp:first-child\s*\{/.test(lesen("css/components/editor-page.css")),
			"die Regel des Zuweisungsblocks selbst bleibt");
		const regel = /\.wiki-weitere-kasten\s*\{([^}]*)\}/.exec(lesen("css/components/wiki-weitere-kasten.css"));
		assert.ok(regel && /border-top:\s*1px solid var\(--color-divider\)/.test(regel[1]) && !/#[0-9a-f]{3,8}\b/i.test(regel[1]),
			"der eingehaengte Kasten trennt sich mit --color-divider ab, ohne feste Farbe");
		assert.ok(!/\.wiki-weitere__haupt/.test(lesen("css/components/wiki-weitere-kasten.css")), "die Regel der Hauptzeile ist tot und gefallen");
	}
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/ui/__tests__/wiki-weitere-kasten.test.js`
Expected: FAIL `ohne Hauptzuweisung: Zeilen mit ✕, aber kein Suchfeld`.

- [ ] **Step 3: Umsetzen (JS)**

In `js/ui/wiki-weitere-kasten.js` die Kopfzeilen 1–3 ersetzen durch:

```js
// Der Kasten „Weitere Wiki-Zuweisungen" -- EIN Bauteil fuer den Wege-Editor (Huelle „dt") und den
// Kartendialog „Weg bearbeiten" (Huelle „label-wiki").
// Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.3, §3.5 und Nachtrag §9.5.
// 🔴 SEIT DEM NACHTRAG 15.09.2026 NUR NOCH EINGEBETTET: der Kasten haengt in der Einhaengestelle `anhang` des Kastens
// „Wiki-Weg" (js/ui/wiki-assign.js). Keine eigene Ueberschrift, keine Zeile „Hauptzuweisung".
```

`avesmapsWikiWeitereSkin` und `avesmapsWikiWeitereMarkup` (Z. 112–144) ersetzen durch:

```js
/** Die Klassen der Huelle: dieselben wie die der Wiki-Zuweisung, in deren Kasten dieser haengt. */
function avesmapsWikiWeitereSkin(name) {
	return typeof avesmapsWikiAssignSkin === "function" ? (avesmapsWikiAssignSkin(name) || {}) : {};
}

/**
 * REIN: der Kasten als HTML. modell = {hauptKey, umfang, zuordnungen}.
 * 🔴 NUR DIE EINGEBETTETE FORM (Nachtrag 15.09.2026 §9.5). Keine eigene Ueberschrift, keine Zeile „Hauptzuweisung" -- die
 * zeigt das Bauteil darueber samt Sync-Feldliste. „Zuweisen und Entfernen wirken sofort" sagt dessen Schreibzeile darunter.
 * 🔴 Die Zeilen stehen AUCH ohne Hauptzuweisung da: §2.2 Nr. 5 laesst die weiteren stehen, wenn die Hauptzuweisung geht --
 * ohne Zeile waeren sie nicht mehr zu entfernen. Nur das Suchfeld braucht die Hauptzuweisung (§2.2 Nr. 1).
 */
function avesmapsWikiWeitereMarkup(modell, skin) {
	const esc = avesmapsWikiWeitereEsc;
	const artikel = (z) => (z.wiki_url
		? '<a class="' + esc(skin.link) + '" href="' + esc(z.wiki_url) + '" target="_blank" rel="noopener">' + esc(z.name) + " ↗</a>"
		: esc(z.name))
		+ ' <span class="wiki-weitere__schluessel">' + esc(z.wiki_key) + "</span>";
	const zeilen = modell.zuordnungen.map((z) => '<tr><td class="wiki-weitere__wo">' + esc(z.wo) + "</td><td>" + artikel(z) + "</td>"
		+ '<td class="wiki-weitere__art">weitere <button type="button" class="wiki-weitere__weg" data-weitere-weg="' + esc(z.wiki_key)
		+ '" aria-label="Weitere Zuweisung ' + esc(z.name) + ' entfernen">✕</button></td></tr>').join("");
	const liste = zeilen ? '<table class="wiki-weitere">' + zeilen + "</table>" : "";
	const status = '<div class="' + esc(skin.hinweis) + '" data-weitere-status role="status" aria-live="polite"></div>';
	if (!modell.hauptKey) {
		return liste
			+ '<div class="' + esc(skin.hinweis) + '">Erst eine Wiki-Zuweisung setzen — danach lassen sich weitere hinzufügen.</div>'
			+ status;
	}
	return liste
		+ '<div class="wiki-weitere__titel">Weitere Wiki-Zuweisung für ' + esc(modell.umfang) + "</div>"
		+ '<input type="search" class="wiki-weitere__suche" data-weitere-suche placeholder="Wiki-Artikel suchen …" autocomplete="off">'
		+ '<div class="' + esc(skin.trefferListe) + '" data-weitere-treffer role="listbox" hidden></div>'
		+ '<div class="' + esc(skin.hinweis) + '">Eine weitere Zuweisung ändert den Wegnamen nie.</div>'
		+ status;
}
```

Im Mount `modell()` ersetzen durch:

```js
	function modell() {
		const abschnitte = (opts.abschnitte && opts.abschnitte()) || [];
		const gesamt = opts.gesamtText ? opts.gesamtText() : "ganze Straße";
		return {
			hauptKey: String((opts.hauptKey && opts.hauptKey()) || ""),
			umfang: String((opts.umfangText && opts.umfangText()) || ""),
			zuordnungen: avesmapsWikiWeitereZuordnungen(abschnitte, gesamt),
			abschnitte,
		};
	}
```

Den Kommentar über `host.classList.add("wiki-weitere-kasten")` (die zwei Zeilen, die mit `	// Fund-Item 4: die Huelle braucht eine Klasse, damit die Trennlinie ueber dem Kasten dieselbe` beginnen und mit `(editor-page.css, \`.avm-wiki-assign > .dt-grp:first-child\`).` enden) ersetzen durch:

```js
	// Die Huelle traegt ihre Klasse: an ihr haengt die Trennlinie zur Hauptzuweisung darueber
	// (css/components/wiki-weitere-kasten.css, Nachtrag §9.5).
```

- [ ] **Step 4: Umsetzen (CSS)**

In `css/components/wiki-weitere-kasten.css` nach dem Kopfkommentar (Z. 1–3) einfügen:

```css
/* 🔴 Der Kasten haengt seit dem Nachtrag 15.09.2026 (§9.5) IM Kasten „Wiki-Weg" (Einhaengestelle des Bauteils).
   Die Linie trennt ihn von der Hauptzuweisung darueber -- dieselbe Linie wie zwischen den Tabellenzeilen darunter. */
.wiki-weitere-kasten {
	margin-top: var(--space-6);
	padding-top: var(--space-4);
	border-top: 1px solid var(--color-divider);
}
```

und die Zeile `.wiki-weitere__haupt .wiki-weitere__art { color: var(--color-text); }` löschen.

In `css/components/editor-page.css` den Kommentar- und Selektorblock

```css
   genau dort, wo sie hingehoert. Derselbe Fall gilt dem Kasten „Weitere Wiki-Zuweisungen"
   (js/ui/wiki-weitere-kasten.js): er folgt im Wege-Editor ebenfalls immer einem anderen Abschnitt
   und traegt seine eigene Klasse an genau demselben Behaelter -- eine zweite Regel mit
   abgeschriebenen Werten waere die Divergenz, die dieser Abschnitt sonst schon zweimal bezahlt hat. */
.avm-wiki-assign > .dt-grp:first-child,
.wiki-weitere-kasten > .dt-grp:first-child {
```

ersetzen durch

```css
   genau dort, wo sie hingehoert. (Der Kasten „Weitere Wiki-Zuweisungen" hatte hier bis zum Nachtrag
   15.09.2026 einen zweiten Selektor; seit er im Kasten „Wiki-Weg" haengt, traegt er keine eigene
   Ueberschrift mehr -- seine Trennlinie steht in css/components/wiki-weitere-kasten.css.) */
.avm-wiki-assign > .dt-grp:first-child {
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node js/ui/__tests__/wiki-weitere-kasten.test.js`, `node js/review/__tests__/weg-dialog-gruppe.test.js`, `node js/ui/__tests__/wiki-assign-weg.test.js` (prüft, dass jede Hüllenrolle eine CSS-Regel hat).
Expected: alle `ok`.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "ui(wege): Kasten \"Weitere Wiki-Zuweisungen\" ohne eigene Ueberschrift und ohne Hauptzeile -- vorbereitet fuer den einen Kasten Wiki-Weg" "" "Weitere Zuweisungen bleiben auch ohne Hauptzuweisung sichtbar und entfernbar." "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.5." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/ui/wiki-weitere-kasten.js css/components/wiki-weitere-kasten.css css/components/editor-page.css js/ui/__tests__/wiki-weitere-kasten.test.js && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 10: Der Datenweg des Wegs für die ganze Straße

Nachtrag §9.5/§9.6: dieselben reinen Bauer für Wege-Editor (Weg-Ebene) und Kartendialog (Gruppendialog) — zwei Dokumente, eine Fassung.

**Files:**
- Modify: `js/ui/wiki-assign-weg.js` (`avesmapsWikiAssignWegZuweisungsKoerper` Z. 246–256; neue Funktionen danach; Export)
- Create: `js/ui/__tests__/wiki-assign-weg-gruppe.test.js`

**Interfaces:**
- Produces:
  - `avesmapsWikiAssignWegGruppenIds(publicId, publicIds): string[]|null` — Anker vorn, getrimmt, ohne Dubletten; `null` bei höchstens einem Abschnitt oder ohne Liste.
  - `avesmapsWikiAssignWegZuweisungsKoerper(wikiKey, publicId, publicIds?)` — mit mehr als einem Abschnitt zusätzlich `public_ids`; ohne dritten Parameter zeichengleich wie heute.
  - `avesmapsWikiAssignWegLoesenKoerper(publicId, publicIds): {action:"clear_assign", public_id, public_ids, dry_run:false, confirm:"apply"}`.
  - `avesmapsWikiAssignWegGruppeLoesenFrage(name, anzahl): string`.

**Risiko:** `js/ui/__tests__/wiki-assign-weg.test.js` (12a, 12e) prüft den Rumpf am Abschnitt — ohne dritten Parameter darf kein `public_ids` erscheinen.

- [ ] **Step 1: Test schreiben**

`js/ui/__tests__/wiki-assign-weg-gruppe.test.js`:

```js
"use strict";
// Die Rumpf- und Textbauer fuer die GANZE Strasse (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5, §9.6).
// Aus der Wurzel: node js/ui/__tests__/wiki-assign-weg-gruppe.test.js
const assert = require("assert");
const W = require("../wiki-assign-weg.js");

// Ohne Liste: der Rumpf wie bisher, zeichengleich
assert.deepStrictEqual(W.avesmapsWikiAssignWegZuweisungsKoerper("reichsstrasse-2", "rs-7"),
	{ action: "assign_to", wiki_key: "reichsstrasse-2", public_id: "rs-7", dry_run: false, confirm: "apply" });
assert.ok(!("public_ids" in W.avesmapsWikiAssignWegZuweisungsKoerper("reichsstrasse-2", "rs-7", ["rs-7"])),
	"ein einzelner Abschnitt bekommt keine public_ids -- er ist kein Gruppenschreiben");

// Mit Liste: der Anker vorn, keine Dubletten
assert.deepStrictEqual(W.avesmapsWikiAssignWegZuweisungsKoerper(" reichsstrasse-2 ", "rs-7", ["rs-6", "rs-7", " rs-8 ", "rs-6", ""]),
	{ action: "assign_to", wiki_key: "reichsstrasse-2", public_id: "rs-7", dry_run: false, confirm: "apply", public_ids: ["rs-7", "rs-6", "rs-8"] });
assert.deepStrictEqual(W.avesmapsWikiAssignWegGruppenIds("rs-7", ["rs-6", "rs-7"]), ["rs-7", "rs-6"]);
assert.strictEqual(W.avesmapsWikiAssignWegGruppenIds("rs-7", null), null);
assert.strictEqual(W.avesmapsWikiAssignWegGruppenIds("rs-7", ["rs-7", " rs-7 "]), null);

// Loesen der ganzen Strasse: public_ids, ohne Trockenlauf-Rueckfrage
assert.deepStrictEqual(W.avesmapsWikiAssignWegLoesenKoerper("rs-7", ["rs-6", "rs-7", "rs-8"]),
	{ action: "clear_assign", public_id: "rs-7", public_ids: ["rs-7", "rs-6", "rs-8"], dry_run: false, confirm: "apply" });
assert.deepStrictEqual(W.avesmapsWikiAssignWegLoesenKoerper("rs-7", []).public_ids, ["rs-7"], "zur Not genau der Anker");
assert.ok(!("single_segment" in W.avesmapsWikiAssignWegLoesenKoerper("rs-7", ["rs-6", "rs-7"])), "single_segment und public_ids schliessen sich aus (§9.6)");

// Die EINE Frage nennt Name, Zahl und Folge
const frage = W.avesmapsWikiAssignWegGruppeLoesenFrage("Reichsstraße 2", 10);
assert.ok(frage.includes("„Reichsstraße 2“") && frage.includes("allen 10 Abschnitten") && frage.includes("zerfällt"), frage);

console.log("wiki-assign-weg-gruppe.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/ui/__tests__/wiki-assign-weg-gruppe.test.js`
Expected: FAIL (`public_ids` fehlt im zweiten Rumpf).

- [ ] **Step 3: Umsetzen**

In `js/ui/wiki-assign-weg.js` die Funktion `avesmapsWikiAssignWegZuweisungsKoerper` samt ihrem Kommentar (Z. 246–256) ersetzen durch:

```js
/**
 * REIN: der Rumpf der Zuweisung. Beide Oberflaechen schicken denselben -- mit `dry_run:false` UND `confirm:"apply"`,
 * weil der Endpunkt sonst nur probeweise rechnet (api/edit/wiki/paths.php).
 * 🔴 MIT `publicIds` (mehr als ein Abschnitt) gilt die Zuweisung GENAU diesen Abschnitten -- Weg-Ebene und Gruppendialog
 * (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.6). Ohne bleibt es beim Namens-Match des Servers.
 */
function avesmapsWikiAssignWegZuweisungsKoerper(wikiKey, publicId, publicIds) {
	const koerper = {
		action: "assign_to",
		wiki_key: avesmapsWikiAssignWegText(wikiKey),
		public_id: avesmapsWikiAssignWegText(publicId),
		dry_run: false,
		confirm: "apply",
	};
	const ids = avesmapsWikiAssignWegGruppenIds(publicId, publicIds);
	if (ids) {
		koerper.public_ids = ids;
	}
	return koerper;
}

/** REIN: die Kennungen fuer `public_ids` -- der Anker vorn, getrimmt, ohne Dubletten; `null` bei hoechstens einem Abschnitt. */
function avesmapsWikiAssignWegGruppenIds(publicId, publicIds) {
	if (!Array.isArray(publicIds)) {
		return null;
	}
	const ids = [];
	[publicId].concat(publicIds).forEach((id) => {
		const text = avesmapsWikiAssignWegText(id);
		if (text !== "" && ids.indexOf(text) === -1) {
			ids.push(text);
		}
	});
	return ids.length > 1 ? ids : null;
}

/**
 * REIN: der Rumpf, der die Zuweisung von GENAU diesen Abschnitten loest (Nachtrag §9.6). Keine Rueckfrage „nur dieser
 * Abschnitt?" -- markiert ist die ganze Strasse. ⚠️ Nie zusammen mit `single_segment`: der Server lehnt beides zugleich ab.
 */
function avesmapsWikiAssignWegLoesenKoerper(publicId, publicIds) {
	return {
		action: "clear_assign",
		public_id: avesmapsWikiAssignWegText(publicId),
		public_ids: avesmapsWikiAssignWegGruppenIds(publicId, publicIds) || [avesmapsWikiAssignWegText(publicId)],
		dry_run: false,
		confirm: "apply",
	};
}

/**
 * REIN: die EINE Bestaetigung vor dem Loesen einer ganzen Strasse. Sie nennt die Folge (R2: jeder Abschnitt einen eigenen
 * generischen Namen) -- die Owner-Regel vom 05.07.2026 („nie ungefragt den ganzen Weg") bleibt damit erfuellt.
 */
function avesmapsWikiAssignWegGruppeLoesenFrage(name, anzahl) {
	return "Die Wiki-Zuordnung „" + avesmapsWikiAssignWegText(name) + "“ von allen " + (Number(anzahl) || 0)
		+ " Abschnitten dieser Straße lösen?\n\nJeder Abschnitt bekommt einen eigenen generischen Namen — die Straße zerfällt in einzelne Wege.";
}
```

Im `module.exports` nach `avesmapsWikiAssignWegZuweisungsKoerper: avesmapsWikiAssignWegZuweisungsKoerper,` einfügen:

```js
		avesmapsWikiAssignWegGruppenIds: avesmapsWikiAssignWegGruppenIds,
		avesmapsWikiAssignWegLoesenKoerper: avesmapsWikiAssignWegLoesenKoerper,
		avesmapsWikiAssignWegGruppeLoesenFrage: avesmapsWikiAssignWegGruppeLoesenFrage,
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node js/ui/__tests__/wiki-assign-weg-gruppe.test.js`, `node js/ui/__tests__/wiki-assign-weg.test.js`
Expected: beide `ok`.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(wege): Rumpf- und Textbauer fuer Zuweisen und Entfernen an der ganzen Strasse" "" "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.5, §9.6." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/ui/wiki-assign-weg.js js/ui/__tests__/wiki-assign-weg-gruppe.test.js && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 11: Wege-Editor — ein Kasten am Abschnitt und auf der Weg-Ebene

Nachtrag §9.5/§9.6.

**Files:**
- Modify: `js/pages/wege-editor.js` — `renderDetail` (Z. 491–492), `wireDetail` (Z. 664–670), `mountWikiWeitere` (Z. 926–961), `mountWikiAssign` (Z. 963–978), neue Funktionen nach `wikiAssignSyncUebernehmen` (Z. 880–900), `selectGroup` (Z. 1183–1192), `renderGroupDetail` (Z. 1340), `wireGroupDetail` (Z. 1419–1424), `saveGroupDraft` (Z. 1457–1458)
- Create: `js/pages/__tests__/wege-editor-wiki-kasten.test.js`

**Interfaces:**
- Consumes: `avesmapsWikiAssignMount(behaelter, {…, anhang})` (Task 8), `avesmapsWikiWeitereKastenMount(host, opts)` (Task 9), `avesmapsWikiAssignWegZuweisungsKoerper(wikiKey, publicId, publicIds)`, `avesmapsWikiAssignWegLoesenKoerper`, `avesmapsWikiAssignWegGruppeLoesenFrage` (Task 10), Server `public_ids` (Task 7).
- Produces: `mountWikiAssign(hostId, datenweg, anhang)`, `mountWikiWeitere(host, ways, umfang, nachSchreiben)`; neue IIFE-interne `wikiAssignGruppeZustand`, `wikiAssignGruppeZuweisen`, `wikiAssignGruppeLoesen`, `wikiAssignGruppeSyncUebernehmen`; das Sammel-Speichern schickt `wiki_uebernommen`.

**Risiko:** Nach „Entfernen“ auf der Weg-Ebene zerfällt die Gruppe (R2) — ein `selectGroup` mit dem alten Schlüssel fände nichts; gewählt wird der Ankerabschnitt. Nach „Zuweisen“ heißt der Schlüssel `wiki:<key>`. Ungespeicherte Weg-Ebene-Eingaben gingen beim Neuwählen verloren — gefragt wird vorher.

- [ ] **Step 1: Test schreiben**

`js/pages/__tests__/wege-editor-wiki-kasten.test.js`:

```js
"use strict";
// Wege-Editor: EIN Kasten „Wiki-Weg" am Abschnitt und auf der Weg-Ebene (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md
// §9.5, §9.6). AUSGEFUEHRT: die echte Seite in einem Sandkasten (dieselbe Bauform wie js/ui/__tests__/wiki-assign-weg.test.js).
// Aus der Wurzel: node js/pages/__tests__/wege-editor-wiki-kasten.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const ruhe = () => new Promise((fertig) => setTimeout(fertig, 20));

function attrappe(name) {
	return {
		id: name, tagName: "DIV", value: "", checked: false, disabled: false, hidden: false,
		textContent: "", innerHTML: "", className: "", dataset: {}, style: {}, options: [],
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener() {},
		appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
		hasAttribute() { return false; },
		closest() { return null; },
		querySelector() { return attrappe("q"); },
		querySelectorAll() { return []; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
		focus() {}, dispatchEvent() { return true; }, contains() { return true; },
	};
}

const WEGE = [
	{ public_id: "p-1", name: "Alte Straße", feature_subtype: "Strasse", show_label: true, allowed_transports: ["caravan"],
		transport_seasons: {}, wiki_path: { wiki_key: "alte-strasse", name: "Alte Straße", wiki_url: "https://x/Alte" },
		wiki_path_weitere: [], flow_direction: "", has_profile: true, bbox: [0, 0, 1, 0] },
	{ public_id: "p-2", name: "Alte Straße", feature_subtype: "Strasse", show_label: true, allowed_transports: ["caravan"],
		transport_seasons: {}, wiki_path: { wiki_key: "alte-strasse", name: "Alte Straße", wiki_url: "https://x/Alte" },
		wiki_path_weitere: [], flow_direction: "", has_profile: true, bbox: [1, 0, 2, 0] },
];

function sandkasten() {
	const elemente = {};
	const gesendet = [];
	const fragen = [];
	const dokument = {
		readyState: "complete",
		getElementById(id) { if (!elemente[id]) { elemente[id] = attrappe(id); } return elemente[id]; },
		querySelector() { return attrappe("q"); },
		querySelectorAll() { return []; },
		createElement(t) { return attrappe(t); },
		addEventListener() {},
		body: attrappe("body"), documentElement: attrappe("html"),
	};
	const kasten = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
		String, Array, Object, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, Set, Map,
		encodeURIComponent, decodeURIComponent, Promise, Event: function () {},
		document: dokument,
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		confirm: (text) => { fragen.push(String(text)); return true; },
		fetch(url, opt) {
			const rumpf = opt && opt.body ? JSON.parse(opt.body) : null;
			gesendet.push({ url: String(url), rumpf });
			let antwort = { ok: true };
			if (String(url).indexOf("action=list") !== -1) { antwort = { ok: true, ways: WEGE, summary: { total: 2 }, calibration: null }; }
			else if (String(url).indexOf("action=detail") !== -1) { antwort = { ok: true, length_units: 10, terrain: null, landscapes: [] }; }
			else if (rumpf && rumpf.action === "assign_to") { antwort = { ok: true, type_ok: true, applied: 2, wiki_name: "Alte Straße", segments_updated: [] }; }
			else if (rumpf && rumpf.action === "clear_assign") { antwort = { ok: true, applied: 2, segments: 2, segments_updated: [] }; }
			else if (rumpf && rumpf.action === "update_path_group_details") { antwort = { ok: true, written: 2 }; }
			return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(antwort) });
		},
		gemounted: [],
		weitereMounts: [],
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	["js/ui/filter-menu.js", "js/routing/travel-calendar.js", "js/pages/wege-editor-model.js", "js/ui/listen-statuskreis.js",
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js", "js/ui/wiki-assign-weg.js",
		"js/ui/wiki-weitere-kasten.js"].forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), kasten, { filename: datei });
	});
	vm.runInContext("var echterMount = avesmapsWikiAssignMount;"
		+ "avesmapsWikiAssignMount = function (b, o) { gemounted.push({ host: b, opts: o }); return echterMount(b, o); };"
		+ "var echterWeitere = avesmapsWikiWeitereKastenMount;"
		+ "avesmapsWikiWeitereKastenMount = function (h, o) { weitereMounts.push({ host: h, opts: o }); return echterWeitere(h, o); };", kasten);
	vm.runInContext(fs.readFileSync(path.join(WURZEL, "js/pages/wege-editor.js"), "utf8"), kasten, { filename: "wege-editor.js" });
	return { kasten, elemente, gesendet, fragen };
}

const zeile = (attribute) => {
	const ziel = attrappe("row");
	ziel.closest = (sel) => (sel === ".avm-row" ? ziel : null);
	ziel.getAttribute = (n) => (Object.prototype.hasOwnProperty.call(attribute, n) ? attribute[n] : null);
	return ziel;
};

(async () => {
	const s = sandkasten();
	await ruhe();

	// ---- 1. Abschnitt: EIN Kasten, die weiteren Zuweisungen in seinem Anhang -------------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-id": "p-1" }), preventDefault() {} });
	await ruhe();
	assert.ok(!s.elemente.wpDetail.innerHTML.includes('id="wpWikiWeitere"'), "der zweite Kasten am Abschnitt ist gefallen");
	const abschnitt = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	assert.strictEqual(abschnitt.host, s.elemente.wpWikiAssign);
	assert.ok(abschnitt.opts.anhang, "der Kasten „Wiki-Weg“ bekommt einen Anhang");
	const weitereAbschnitt = s.kasten.weitereMounts[s.kasten.weitereMounts.length - 1];
	assert.strictEqual(weitereAbschnitt.host, abschnitt.opts.anhang, "die weiteren Zuweisungen haengen GENAU in diesem Anhang");
	assert.ok(!("haupt" in weitereAbschnitt.opts), "keine Hauptzeile");
	assert.ok(!("wpWikiWeitere" in s.elemente), "niemand fragt mehr nach #wpWikiWeitere");

	// ---- 2. Weg-Ebene: ein EIGENER Kasten „Wiki-Weg“ mit Anhang ---------------------------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "wiki:alte-strasse" }), preventDefault() {} });
	await ruhe();
	assert.ok(s.elemente.wpDetail.innerHTML.includes('id="wpGroupWikiAssign"'), "die Weg-Ebene traegt den Kasten „Wiki-Weg“");
	assert.ok(!s.elemente.wpDetail.innerHTML.includes('id="wpGroupWikiWeitere"'), "der alte Einzelkasten ist gefallen");
	const gruppe = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	assert.strictEqual(gruppe.host, s.elemente.wpGroupWikiAssign);
	assert.strictEqual(gruppe.opts.subject, "weg");
	const weitereGruppe = s.kasten.weitereMounts[s.kasten.weitereMounts.length - 1];
	assert.strictEqual(weitereGruppe.host, gruppe.opts.anhang);
	assert.strictEqual(weitereGruppe.opts.umfangText(), "die ganze Straße");
	assert.deepStrictEqual([...weitereGruppe.opts.abschnitte().map((a) => a.public_id)], ["p-1", "p-2"]);
	const zustand = gruppe.opts.laden();
	assert.strictEqual(zustand.artikel.wiki_key, "alte-strasse", "der Stand der Gruppe");

	// ---- 3. Zuweisen auf der Weg-Ebene: genau ihre Abschnitte -------------------------------------------------------
	s.gesendet.length = 0;
	await gruppe.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} });
	await ruhe();
	const zuweisung = s.gesendet.find((g) => g.rumpf && g.rumpf.action === "assign_to");
	assert.ok(zuweisung, JSON.stringify(s.gesendet.map((g) => g.url)));
	assert.deepStrictEqual([...zuweisung.rumpf.public_ids], ["p-1", "p-2"], "Zuweisen gilt GENAU den Abschnitten der Gruppe (§9.6)");
	assert.strictEqual(zuweisung.rumpf.public_id, "p-1");

	// ---- 4. Entfernen auf der Weg-Ebene: EINE Frage, dann public_ids, dann der Ankerabschnitt ----------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "wiki:alte-strasse" }), preventDefault() {} });
	await ruhe();
	const gruppe2 = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	s.gesendet.length = 0;
	s.fragen.length = 0;
	await gruppe2.opts.loesen();
	await ruhe();
	assert.strictEqual(s.fragen.length, 1, "genau eine Rueckfrage");
	assert.ok(s.fragen[0].includes("allen 2 Abschnitten") && s.fragen[0].includes("zerfällt"), s.fragen[0]);
	const loesen = s.gesendet.filter((g) => g.rumpf && g.rumpf.action === "clear_assign");
	assert.strictEqual(loesen.length, 1, "kein Trockenlauf mit „nur dieser Abschnitt?“ auf der Weg-Ebene");
	assert.deepStrictEqual([...loesen[0].rumpf.public_ids], ["p-1", "p-2"]);
	assert.ok(s.gesendet.some((g) => g.url.indexOf("action=detail") !== -1), "danach ist der Ankerabschnitt gewaehlt -- die Gruppe ist zerfallen");

	// ---- 5. Sync auf der Weg-Ebene: das Sammel-Speichern schickt wiki_uebernommen ---------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "wiki:alte-strasse" }), preventDefault() {} });
	await ruhe();
	const gruppe3 = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	gruppe3.opts.syncUebernehmen([{ karte: "feature_subtype", neu: "Reichsstrasse" }]);
	s.gesendet.length = 0;
	s.elemente.wpGroupSave.zuhoerer.click({ target: s.elemente.wpGroupSave, preventDefault() {} });
	await ruhe();
	const sammel = s.gesendet.find((g) => g.rumpf && g.rumpf.action === "update_path_group_details");
	assert.ok(sammel, JSON.stringify(s.gesendet.map((g) => g.rumpf)));
	assert.deepStrictEqual([...sammel.rumpf.fields], ["feature_subtype"]);
	assert.deepStrictEqual([...(sammel.rumpf.wiki_uebernommen || [])], ["feature_subtype"],
		"ohne wiki_uebernommen stempelte der Server die Uebernahme als „von uns“ (§9.5)");

	// ---- 6. Ungespeicherte Weg-Ebene-Eingaben werden benannt, nicht still verworfen ------------------------------------
	s.elemente.wpList.zuhoerer.click({ target: zeile({ "data-group": "wiki:alte-strasse" }), preventDefault() {} });
	await ruhe();
	const gruppe4 = s.kasten.gemounted[s.kasten.gemounted.length - 1];
	gruppe4.opts.syncUebernehmen([{ karte: "feature_subtype", neu: "Reichsstrasse" }]);
	s.kasten.confirm = (text) => { s.fragen.push(String(text)); return false; };
	s.fragen.length = 0;
	s.gesendet.length = 0;
	let abgelehnt = false;
	await gruppe4.opts.zuweisen({ wiki_key: "alte-strasse", name: "Alte Straße", werte: {} }).catch(() => { abgelehnt = true; });
	assert.ok(abgelehnt && s.fragen.length === 1 && s.fragen[0].includes("ungespeicherte"), "gefragt und abgelehnt: " + JSON.stringify(s.fragen));
	assert.ok(!s.gesendet.some((g) => g.rumpf && g.rumpf.action === "assign_to"), "abgelehnt heisst: nichts geschickt");

	console.log("wege-editor-wiki-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/pages/__tests__/wege-editor-wiki-kasten.test.js`
Expected: FAIL `der zweite Kasten am Abschnitt ist gefallen`.

- [ ] **Step 3: Abschnitt**

In `renderDetail` die Zeile `		html += '<div id="wpWikiWeitere"></div>';` löschen.

In `wireDetail` den Block

```js
		mountWikiAssign();
		var eigenerWeg = null;
		state.ways.forEach(function (w) { if (w.public_id === state.selected) { eigenerWeg = w; } });
		if (eigenerWeg) {
			var umfangAbschnitt = weitereAbschnitte([eigenerWeg])[0].label;
			mountWikiWeitere("wpWikiWeitere", [eigenerWeg], umfangAbschnitt, function () { return selectWay(state.selected, true); });
		}
```

ersetzen durch

```js
		// 🔴 Nachtrag 15.09.2026 §9.5: EIN Kasten „Wiki-Weg" -- die weiteren Zuweisungen haengen in seiner Einhaengestelle.
		// Das Element entsteht je Aufbau neu: renderDetail() baut die ganze Spalte, und mit ihr beide Bauteile.
		var anhang = document.createElement("div");
		var eigenerWeg = null;
		state.ways.forEach(function (w) { if (w.public_id === state.selected) { eigenerWeg = w; } });
		if (eigenerWeg) {
			var umfangAbschnitt = weitereAbschnitte([eigenerWeg])[0].label;
			mountWikiWeitere(anhang, [eigenerWeg], umfangAbschnitt, function () { return selectWay(state.selected, true); });
		}
		mountWikiAssign("wpWikiAssign", {
			laden: wikiAssignZustand,
			zuweisen: wikiAssignZuweisen,
			loesen: wikiAssignLoesen,
			syncUebernehmen: wikiAssignSyncUebernehmen
		}, anhang);
```

- [ ] **Step 4: Die zwei Mount-Helfer**

`mountWikiWeitere` samt dem Kommentarblock davor (ab `	// 🔴 \`mitHaupt\` gilt NUR der Weg-Ebene` bis zur schließenden `	}` der Funktion) ersetzen durch:

```js
	// 🔴 Nachtrag 15.09.2026 §9.5: der Kasten haengt in der Einhaengestelle des Kastens „Wiki-Weg" -- `host` ist das Element,
	// das der Wirt dort einhaengt. Keine Zeile „Hauptzuweisung": die zeigt der Kasten darueber, am Abschnitt wie auf der Weg-Ebene.
	function mountWikiWeitere(host, ways, umfang, nachSchreiben) {
		if (wpWikiWeitere) { wpWikiWeitere.zerstoeren(); wpWikiWeitere = null; }
		if (!host || typeof avesmapsWikiWeitereKastenMount !== "function") { return; }
		wpWikiWeitere = avesmapsWikiWeitereKastenMount(host, {
			skin: "dt",
			hauptKey: function () { return ways[0] && ways[0].wiki_path ? String(ways[0].wiki_path.wiki_key || "") : ""; },
			abschnitte: function () { return weitereAbschnitte(ways); },
			umfangText: function () { return umfang; },
			// 🔴 Fund-Item 1 der ersten Pruefrunde: „gespeichert" hiess bisher IMMER Erfolg, auch wenn der Server alle
			// Abschnitte uebersprungen hat (applied === 0). EIN Satzbauer, zwei Anzeigeorte.
			geschrieben: function (antwort) {
				var applied = antwort && typeof antwort.applied === "number" ? antwort.applied : 0;
				var text = typeof avesmapsWikiWeitereErgebnisText === "function"
					? avesmapsWikiWeitereErgebnisText(
						antwort && antwort.action === "remove_weitere" ? "remove" : "add",
						antwort,
						weitereAbschnitte(ways)
					)
					: "Weitere Wiki-Zuweisung gespeichert.";
				setStatus(text, applied > 0 ? "ok" : "bad");
				return loadList().then(nachSchreiben);
			}
		});
	}
```

`mountWikiAssign` (ganze Funktion) ersetzen durch:

```js
	// Der Kasten „Wiki-Weg" -- am Abschnitt und auf der Weg-Ebene (Nachtrag §9.5). `datenweg` traegt laden/zuweisen/loesen/
	// syncUebernehmen der jeweiligen Ebene, `anhang` das Element mit den weiteren Zuweisungen.
	function mountWikiAssign(hostId, datenweg, anhang) {
		var host = $(hostId);
		if (!host) { return; }
		if (wpWikiAssign) { wpWikiAssign.zerstoeren(); wpWikiAssign = null; }
		wpWikiAssign = avesmapsWikiAssignMount(host, {
			subject: "weg",
			skin: "dt",
			laden: datenweg.laden,
			// Die Suche antwortet mit FLACHEN Zeilen; erst hier entsteht daraus ein Treffer samt der
			// Abbildung Wiki-Art -> Wegtyp-Schluessel (js/ui/wiki-assign-weg.js).
			trefferAufbereiten: avesmapsWikiAssignWegTreffer,
			zuweisen: datenweg.zuweisen,
			loesen: datenweg.loesen,
			syncUebernehmen: datenweg.syncUebernehmen,
			anhang: anhang || null
		});
	}
```

- [ ] **Step 5: Der Datenweg der Weg-Ebene**

Direkt nach der schließenden `	}` von `wikiAssignSyncUebernehmen` einfügen:

```js

	// ── Wiki-Weg auf der Weg-Ebene (Nachtrag 15.09.2026 §9.5, §9.6) ─────────────────────────────────────────────────
	// 🔴 Welche Felder die Weg-Ebene seit dem Oeffnen aus dem Wiki uebernommen hat. Das Sammel-Speichern schickt sie als
	// `wiki_uebernommen` -- avesmapsUpdatePathGroupDetails liest das seit jeher, wpGroupRumpf hat es nie geschickt.
	var wpGruppeWikiUebernommen = new Set();

	function wikiAssignGruppe() {
		var gruppe = findGroup(state.selectedGroup);
		if (!gruppe || !state.groupDraft) { throw new Error("Kein Weg gewählt."); }
		return gruppe;
	}

	/** 🔴 WIRFT ohne Gruppe -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js. */
	function wikiAssignGruppeZustand() {
		var gruppe = wikiAssignGruppe();
		return avesmapsWikiAssignWegZustand({
			wiki_path: gruppe.wiki_path,
			// Eine LESEFUNKTION: „— gemischt lassen —" ist `null` und liest sich als "" -- die Vorschau bietet dann den Wegtyp an.
			feature_subtype: function () { return state.groupDraft && state.groupDraft.feature_subtype ? state.groupDraft.feature_subtype : ""; },
			// ⚠️ Keine Feldherkunft: sie steht je Abschnitt und kann in einer Gruppe verschieden sein.
			field_origins: null
		});
	}

	/** 💣 Ungespeicherte Eingaben der Weg-Ebene gingen beim Neuwaehlen verloren -- das wird GEFRAGT, nicht still getan. */
	function wikiAssignGruppeEntwurfFreigeben() {
		if (!state.groupDraft || !state.groupDraft.dirty) { return true; }
		return window.confirm("Die Weg-Ebene hat ungespeicherte Änderungen. Sie gehen beim Zuweisen oder Entfernen verloren.\n\nTrotzdem fortfahren?");
	}

	function wikiAssignGruppeZuweisen(treffer) {
		var gruppe;
		try { gruppe = wikiAssignGruppe(); } catch (fehler) { return Promise.reject(fehler); }
		if (!wikiAssignGruppeEntwurfFreigeben()) {
			setStatus("Zuweisen abgebrochen.", "");
			return Promise.reject(new Error("Abgebrochen."));
		}
		var ids = gruppe.segments.map(function (s) { return s.public_id; });
		return postJson("/api/edit/wiki/paths.php", avesmapsWikiAssignWegZuweisungsKoerper(treffer.wiki_key, ids[0], ids))
			.then(function (antwort) {
				// 🔴 Wirft bei jedem Nein -- auch bei `type_ok:false` (ein Abschnitt passt nicht, §9.6).
				avesmapsWikiAssignWegAntwortPruefen(antwort);
				setStatus("„" + (antwort.wiki_name || "") + "“ an " + (antwort.applied || 0) + " Abschnitten verknüpft.", "ok");
				// R1 benennt alle Abschnitte um -- der Gruppenschluessel heisst jetzt wiki:<key>.
				return loadList().then(function () { return selectGroup("wiki:" + treffer.wiki_key, true); });
			})
			.catch(function (fehler) {
				setStatus("Zuweisen fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler), "bad");
				// 💣 Weiterwerfen, NICHT schlucken: das Bauteil malte sonst eine Zuweisung, die es auf dem Server nicht gibt.
				throw fehler;
			});
	}

	function wikiAssignGruppeLoesen() {
		var gruppe;
		try { gruppe = wikiAssignGruppe(); } catch (fehler) { return Promise.reject(fehler); }
		var ids = gruppe.segments.map(function (s) { return s.public_id; });
		// 🔴 EINE Frage statt „nur dieser Abschnitt?" -- markiert ist die ganze Strasse; die Frage nennt die Folge.
		if (!window.confirm(avesmapsWikiAssignWegGruppeLoesenFrage(gruppe.wiki_path ? gruppe.wiki_path.name : "", ids.length))
			|| !wikiAssignGruppeEntwurfFreigeben()) {
			setStatus("Entfernen abgebrochen.", "");
			// 🔴 ABGEBROCHEN IST ABGELEHNT -- das Bauteil laesst die Zuweisung stehen.
			return Promise.reject(new Error("Abgebrochen."));
		}
		return postJson("/api/edit/wiki/paths.php", avesmapsWikiAssignWegLoesenKoerper(ids[0], ids))
			.then(function (antwort) {
				avesmapsWikiAssignWegAntwortPruefen(antwort);
				setStatus("Wiki-Zuordnung von " + (antwort.segments || ids.length) + " Abschnitten entfernt.", "ok");
				// 💣 R2: jeder Abschnitt hat jetzt einen EIGENEN Namen, die Gruppe gibt es nicht mehr -- also der Ankerabschnitt.
				return loadList().then(function () { return selectWay(ids[0], true); });
			})
			.catch(function (fehler) {
				setStatus("Entfernen fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler), "bad");
				throw fehler;
			});
	}

	/** ⚠️ ÜBERNEHMEN FÜLLT NUR DEN ENTWURF -- gespeichert wird mit „Speichern für N Abschnitte". */
	function wikiAssignGruppeSyncUebernehmen(zeilen) {
		var wegtyp = avesmapsWikiAssignWegSyncWegtyp(zeilen);
		if (wegtyp === null || !state.groupDraft) { throw new Error("Keine übernehmbare Angabe angehakt."); }
		state.groupDraft.feature_subtype = wegtyp;
		wpGruppeWikiUebernommen.add("feature_subtype");
		markGroupDirty();
		renderDetail();
		var message = $("wpSaveMsg");
		if (message) {
			message.textContent = "Aus dem Wiki übernommen — noch nicht gespeichert.";
			message.className = "avm-savebar__msg";
		}
	}
```

- [ ] **Step 6: Weg-Ebene verdrahten**

In `selectGroup` direkt nach `		state.selectedGroup = key;` einfügen:

```js
		// Eine frisch gewaehlte (oder nach dem Speichern neu gewaehlte) Gruppe hat nichts aus dem Wiki uebernommen.
		wpGruppeWikiUebernommen = new Set();
```

In `renderGroupDetail` die Zeile `		html += '<div id="wpGroupWikiWeitere"></div>';` ersetzen durch:

```js
		// 🔴 Nachtrag 15.09.2026 §9.5: der EIGENE Kasten „Wiki-Weg" der Weg-Ebene, mit den weiteren Zuweisungen darin.
		html += '<div id="wpGroupWikiAssign"></div>';
```

In `wireGroupDetail` den Block

```js
		var gruppeWeitere = findGroup(state.selectedGroup);
		if (gruppeWeitere) {
			mountWikiWeitere("wpGroupWikiWeitere", gruppeWeitere.segments, "die ganze Straße", function () {
				return selectGroup(gruppeWeitere.key, true);
			}, true);
		}
```

ersetzen durch

```js
		// 🔴 Nachtrag 15.09.2026 §9.5/§9.6: Zuweisen und Entfernen gelten GENAU den Abschnitten dieser Gruppe (`public_ids`).
		var gruppeWiki = findGroup(state.selectedGroup);
		if (gruppeWiki) {
			var gruppenAnhang = document.createElement("div");
			mountWikiWeitere(gruppenAnhang, gruppeWiki.segments, "die ganze Straße", function () {
				return selectGroup(gruppeWiki.key, true);
			});
			mountWikiAssign("wpGroupWikiAssign", {
				laden: wikiAssignGruppeZustand,
				zuweisen: wikiAssignGruppeZuweisen,
				loesen: wikiAssignGruppeLoesen,
				syncUebernehmen: wikiAssignGruppeSyncUebernehmen
			}, gruppenAnhang);
		}
```

In `saveGroupDraft` direkt nach der Zeile `		var rumpf = wpGroupRumpf(state.groupStand, state.groupDraft, gruppe.segments.map(function (s) { return s.public_id; }));` einfügen:

```js
		// Nachtrag 15.09.2026 §9.5: was die Weg-Ebene aus dem Wiki uebernommen hat, reist mit -- sonst stempelt der Server den
		// Wegtyp als „von uns" (avesmapsFieldOriginsAusWikiLesen in avesmapsUpdatePathGroupDetails).
		if (rumpf && wpGruppeWikiUebernommen.size > 0) {
			rumpf.wiki_uebernommen = Array.from(wpGruppeWikiUebernommen);
		}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `node js/pages/__tests__/wege-editor-wiki-kasten.test.js`, `node js/ui/__tests__/wiki-assign-weg.test.js`, `node js/pages/__tests__/quellen-im-wege-editor.test.js`, `node js/pages/__tests__/editor-abschnittsreihenfolge.test.js`, `node js/pages/__tests__/wege-gruppe-ablauf.test.js`, `node js/review/__tests__/weg-dialog-gruppe.test.js`.
Expected: alle `ok`.

- [ ] **Step 8: Ablauf im Browser (vor dem Commit)**

Wege-Editor mit echten Daten, angemeldet: (1) Abschnitt einer Reichsstraße wählen → EIN Kasten „Wiki-Weg“, darunter die Liste der weiteren Zuweisungen und das Suchfeld; (2) weitere Zuweisung hinzufügen und mit ✕ entfernen; (3) Gruppenkopf wählen → Kasten „Wiki-Weg“ zwischen Transportmitteln und Quellen; (4) „Sync“ → Wegtyp übernehmen → „Speichern für N Abschnitte“; (5) auf einer Testgruppe „Ändern“ auf einen anderen Artikel → nur ihre Abschnitte umbenannt, ein gleichnamiger fremder Weg nicht; (6) „Entfernen“ → eine Frage, danach der Ankerabschnitt gewählt.

- [ ] **Step 9: Commit**

```bash
printf '%s\n' "ui(wege-editor): ein Kasten Wiki-Weg mit den weiteren Zuweisungen darin -- am Abschnitt und neu auf der Weg-Ebene" "" "Weg-Ebene: Zuweisen/Entfernen auf genau ihre Abschnitte (public_ids), Sync schickt wiki_uebernommen mit." "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.5, §9.6." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/pages/wege-editor.js js/pages/__tests__/wege-editor-wiki-kasten.test.js && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 12: Kartendialog — ein Kasten, drei Befüller, Gruppendialog

Nachtrag §9.5/§9.6.

**Files:**
- Modify: `index.html` (Z. 1847: `<div class="label-edit-section" id="path-wiki-weitere-host"></div>` entfällt)
- Modify: `js/review/review-paths.js` (Kopfblock der ganzen Straße Z. 101–104; `mountPathWikiWeitere` Z. 286–328; neue `pathWikiWeitereAnhang`, `pathEditGruppeNachWikiSchreiben`; Kommentar in `populatePathEditFormFromLastSettings` Z. 415–417)
- Modify: `js/review/review-path-wiki.js` (`pathWikiZuweisen` Z. 250–277, `pathWikiLoesen` Z. 279–327, `renderPathWikiReference` Z. 366–391; neue `pathWikiGruppenIds`, `pathWikiNachGruppenSchreiben`)
- Modify: `js/review/review-editor-submit.js` (`handlePathGroupEditSubmit` Z. 182–188)
- Modify: `js/review/__tests__/weg-dialog-gruppe.test.js` (Z. 101, 146–148, 246, 317; neuer Abschnitt 5b)
- Create: `js/review/__tests__/weg-dialog-wiki-kasten.test.js`

**Interfaces:**
- Consumes: Tasks 7–10.
- Produces: `pathWikiWeitereAnhang(): HTMLElement` (EIN Element für die Lebenszeit der Seite); `pathEditGruppeNachWikiSchreiben(): void`; `pathWikiGruppenIds(publicId): string[]|null`; `pathWikiNachGruppenSchreiben(): void`; `renderPathWikiReference` montiert mit `anhang`; `handlePathGroupEditSubmit` schickt `wiki_uebernommen`.

**Risiko:** `renderPathWikiReference` läuft in `populatePathEditForm` VOR `mountPathWikiWeitere`, und `populatePathEditFormGruppe` ruft erst `populatePathEditForm(path)` und montiert dann für die Gruppe neu. Das eine, dauerhafte Anhang-Element trägt beide Reihenfolgen: der Kasten darin wird neu montiert, das Bauteil hängt dasselbe Element ein. Nach „Entfernen“ im Gruppendialog muss der Vergleichsstand neu gerechnet werden, sonst schreibt das nächste Sammel-Speichern einen Namen auf alle.

- [ ] **Step 1: Test schreiben**

`js/review/__tests__/weg-dialog-wiki-kasten.test.js`:

```js
"use strict";
// Kartendialog „Weg bearbeiten": EIN Kasten „Wiki-Weg" mit Anhang, Zuweisen/Entfernen fuer die ganze Strasse, wiki_uebernommen
// im Sammel-Speichern (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5, §9.6). AUSGEFUEHRT gegen Attrappen.
// Aus der Wurzel: node js/review/__tests__/weg-dialog-wiki-kasten.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const funktion = (text, name) => {
	let a = text.indexOf("\nasync function " + name + "(");
	if (a < 0) { a = text.indexOf("\nfunction " + name + "("); }
	assert.ok(a >= 0, "Funktion fehlt: " + name);
	const e = text.indexOf("\n}\n", a);
	return text.slice(a, e + 3);
};
const W = require(path.join(WURZEL, "js/ui/wiki-assign-weg.js"));
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));

const pfad = (id) => ({ properties: { public_id: id, wiki_path: { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" } } });
const rs6 = pfad("rs-6");
const rs7 = pfad("rs-7");
const rs8 = pfad("rs-8");

function kontextBauen() {
	const log = { post: [], fragen: [], nachGruppe: 0, poll: 0, mounts: [], angewendet: [] };
	const anhang = { name: "anhang" };
	const kontext = vm.createContext({
		console, window: {}, Promise, JSON, Array, String, Number,
		pathEditFeature: rs7, pathEditGruppe: null, pathWikiAssign: null,
		pathWikiPost: async (rumpf) => {
			log.post.push(rumpf);
			if (rumpf.action === "clear_assign" && rumpf.dry_run === true) { return { ok: true, segments: 1, name: "Reichsstraße 2" }; }
			return { ok: true, type_ok: true, applied: 3, segments: 3, wiki_name: "Reichsstraße 2", segments_updated: [] };
		},
		pathWikiElement: () => ({ id: "path-wiki-assign-host" }),
		pathWikiCurrentFeaturePublicId: () => "rs-7",
		pathWikiCurrentAssignment: () => ({ wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" }),
		pathWikiSyncNachbarn: () => {}, pathWikiZustand: () => ({}), pathWikiSyncUebernehmen: () => {}, pathWikiZeichneAbweichungen: () => {},
		renderPathFlowSection: () => {}, showFeedbackToast: () => {}, apiErrorMessage: (d, f) => f,
		applyWikiPathSegmentsUpdate: (liste) => { log.angewendet.push(liste); },
		getPathPublicId: (p) => p.properties.public_id,
		avesmapsWikiAssignMount: (host, opts) => { log.mounts.push({ host, opts }); return { zerstoeren() {} }; },
		avesmapsWikiAssignWegTreffer: W.avesmapsWikiAssignWegTreffer,
		avesmapsWikiAssignWegZuweisungsKoerper: W.avesmapsWikiAssignWegZuweisungsKoerper,
		avesmapsWikiAssignWegAntwortPruefen: W.avesmapsWikiAssignWegAntwortPruefen,
		avesmapsWikiAssignWegGruppenIds: W.avesmapsWikiAssignWegGruppenIds,
		avesmapsWikiAssignWegLoesenKoerper: W.avesmapsWikiAssignWegLoesenKoerper,
		avesmapsWikiAssignWegGruppeLoesenFrage: W.avesmapsWikiAssignWegGruppeLoesenFrage,
		pathWikiWeitereAnhang: () => anhang,
		pathEditGruppeNachWikiSchreiben: () => { log.nachGruppe += 1; },
		pollLiveMapUpdates: () => { log.poll += 1; return Promise.resolve(); },
	});
	kontext.window.confirm = (text) => { log.fragen.push(String(text)); return log.antwort !== false; };
	kontext.confirm = kontext.window.confirm;
	const quelle = lies("js/review/review-path-wiki.js");
	vm.runInContext(["renderPathWikiReference", "pathWikiGruppenIds", "pathWikiNachGruppenSchreiben", "pathWikiZuweisen", "pathWikiLoesen"]
		.map((name) => funktion(quelle, name)).join("\n"), kontext);
	return { kontext, log, anhang, rufe: (name) => vm.runInContext(name, kontext) };
}

(async () => {
	// ---- 1. Der Kasten „Wiki-Weg“ bekommt den Anhang --------------------------------------------------------------
	{
		const k = kontextBauen();
		k.rufe("renderPathWikiReference")();
		assert.strictEqual(k.log.mounts.length, 1);
		assert.strictEqual(k.log.mounts[0].opts.anhang, k.anhang, "die weiteren Zuweisungen haengen im Kasten „Wiki-Weg“");
	}

	// ---- 2. Abschnitt: wie bisher, ohne public_ids ------------------------------------------------------------------
	{
		const k = kontextBauen();
		await k.rufe("pathWikiZuweisen")({ wiki_key: "reichsstrasse-2" });
		assert.ok(!("public_ids" in k.log.post[0]), "am Abschnitt keine public_ids");
		assert.strictEqual(k.log.nachGruppe, 0);
		await k.rufe("pathWikiLoesen")();
		assert.strictEqual(k.log.post[1].dry_run, true, "am Abschnitt misst das Entfernen weiter zuerst seine Reichweite");
	}

	// ---- 3. Gruppendialog: Zuweisen auf genau die Abschnitte, danach Stand neu und Live-Abgleich ----------------------
	{
		const k = kontextBauen();
		k.kontext.pathEditGruppe = { pfade: [rs6, rs7, rs8], stand: {} };
		await k.rufe("pathWikiZuweisen")({ wiki_key: "reichsstrasse-2" });
		assert.deepStrictEqual([...k.log.post[0].public_ids], ["rs-7", "rs-6", "rs-8"], "der geklickte Abschnitt vorn");
		assert.strictEqual(k.log.nachGruppe, 1, "der Vergleichsstand wird neu gerechnet");
		assert.strictEqual(k.log.poll, 1, "Gruppen und Traeger-Index haengen an der Kartenrevision");
	}

	// ---- 4. Gruppendialog: Entfernen mit EINER Frage, ohne Trockenlauf, abbrechbar ------------------------------------
	{
		const k = kontextBauen();
		k.kontext.pathEditGruppe = { pfade: [rs6, rs7, rs8], stand: {} };
		await k.rufe("pathWikiLoesen")();
		assert.strictEqual(k.log.fragen.length, 1);
		assert.ok(k.log.fragen[0].includes("allen 3 Abschnitten"), k.log.fragen[0]);
		assert.strictEqual(k.log.post.length, 1, "kein Trockenlauf mit „nur dieses Segment?“");
		assert.strictEqual(k.log.post[0].action, "clear_assign");
		assert.deepStrictEqual([...k.log.post[0].public_ids], ["rs-7", "rs-6", "rs-8"]);
		assert.strictEqual(k.log.nachGruppe, 1);

		const k2 = kontextBauen();
		k2.kontext.pathEditGruppe = { pfade: [rs6, rs7, rs8], stand: {} };
		k2.log.antwort = false;
		let abgelehnt = null;
		await k2.rufe("pathWikiLoesen")().catch((fehler) => { abgelehnt = fehler; });
		assert.ok(abgelehnt && abgelehnt.message === "Abgebrochen.", "abgebrochen ist abgelehnt -- das Bauteil laesst die Zuweisung stehen");
		assert.strictEqual(k2.log.post.length, 0);
	}

	// ---- 5. Das Sammel-Speichern schickt wiki_uebernommen -----------------------------------------------------------
	{
		const gesendet = [];
		const stand = M.wpGroupFieldStates([
			{ public_id: "rs-6", name: "Reichsstraße 2", show_label: true, feature_subtype: "Strasse", allowed_transports: ["caravan"] },
			{ public_id: "rs-7", name: "Reichsstraße 2", show_label: true, feature_subtype: "Strasse", allowed_transports: ["caravan"] },
		], ["caravan"]);
		const s = vm.createContext({
			console, Promise, Number,
			pathEditGruppe: { pfade: [rs6, rs7], stand },
			wpGroupRumpf: M.wpGroupRumpf,
			readPathGruppeEntwurf: () => ({ name: "Reichsstraße 2", show_label: null, feature_subtype: "Reichsstrasse", transports: { caravan: "an" } }),
			getPathPublicId: (p) => p.properties.public_id,
			getPathWikiUebernommenPayload: () => ["feature_subtype"],
			setPathEditStatus: () => {}, setPathEditSubmitPending: () => {}, loadChangeLog: () => {}, setPathEditDialogOpen: () => {},
			showFeedbackToast: () => {},
			submitMapFeatureEdit: async (rumpf) => { gesendet.push(rumpf); return { ok: true, written: 2 }; },
			pollLiveMapUpdates: async () => {},
		});
		vm.runInContext(funktion(lies("js/review/review-editor-submit.js"), "handlePathGroupEditSubmit"), s);
		await vm.runInContext("handlePathGroupEditSubmit", s)();
		assert.strictEqual(gesendet.length, 1);
		assert.deepStrictEqual([...gesendet[0].fields], ["feature_subtype"]);
		assert.deepStrictEqual([...gesendet[0].wiki_uebernommen], ["feature_subtype"], "ohne das stempelte der Server die Uebernahme als „von uns“");
	}

	// ---- 6. index.html: der zweite Kasten ist gefallen ---------------------------------------------------------------
	const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
	assert.ok(!seite.includes('id="path-wiki-weitere-host"'), "kein zweiter Kasten mehr im Dialog");
	assert.ok(seite.includes('<div id="path-wiki-assign-host"></div>'), "der Kasten „Wiki-Weg“ bleibt");

	console.log("weg-dialog-wiki-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Step 2: Bestehenden Test anpassen**

In `js/review/__tests__/weg-dialog-gruppe.test.js`:

1. Zeile 101 `formular.appendChild(mit(new El("div", { id: "path-wiki-weitere-host" })));` löschen.
2. In `NAMEN` (Z. 146–148) nach `"mountPathWikiWeitere",` einfügen: `"pathWikiWeitereAnhang", "pathEditGruppeNachWikiSchreiben",`.
3. Nach Abschnitt 5 (nach `assert.strictEqual(aufrufe.panel, 1, "das Infopanel zieht nach");`) einfügen:

```js

// ---- 5b. Nachtrag 15.09.2026 §9.6: nach Zuweisen/Entfernen im Gruppendialog rechnet der Vergleichsstand neu ------------
// R2 hat jedem Abschnitt einen eigenen generischen Namen gegeben. Ohne Neurechnen stuende der alte gemeinsame Name als Stand
// da, und das naechste „Speichern fuer N Abschnitte“ schriebe einen Namen auf alle.
kontext.pathEditFeature = rs7;
rs6.properties.display_name = "Strasse-11";
rs7.properties.display_name = "Strasse-12";
rs8.properties.display_name = "Strasse-13";
rufe("pathEditGruppeNachWikiSchreiben")();
assert.strictEqual(rufe("pathEditGruppe").stand.name.gleich, false, "die Namen sind jetzt uneins");
assert.strictEqual(nameFeld.value, "", "das Namensfeld zeigt „gemischt“ statt des alten Namens");
const nachLoesen = M.wpGroupRumpf(rufe("pathEditGruppe").stand, rufe("readPathGruppeEntwurf")(), ["rs-6", "rs-7", "rs-8"]);
assert.ok(!nachLoesen || !nachLoesen.fields.includes("name"), "das Sammel-Speichern schreibt keinen Namen auf alle");
assert.strictEqual(umfang.innerHTML, "<b>Ganze Straße:</b> Perz – Helmdahl", "die Zeile oben bleibt die der ganzen Strasse");
```

4. Zeile 246 (`assert.ok(i('id="path-wiki-weitere-host"') > i('id="path-wiki-assign-host"') && …`) ersetzen durch:

```js
assert.ok(i('id="path-wiki-weitere-host"') < 0, "der zweite Kasten ist gefallen -- die weiteren Zuweisungen haengen im Kasten „Wiki-Weg“ (Nachtrag §9.5)");
assert.ok(i('id="path-wiki-assign-host"') > 0 && i('id="path-wiki-assign-host"') < i('id="path-edit-feature-sources"'), "der Kasten „Wiki-Weg“ steht ueber den Quellen");
```

5. In Abschnitt 8 die Zeile `	const host = holen("path-wiki-weitere-host");` ersetzen durch:

```js
	const host = vm.runInContext("pathWikiWeitereAnhang()", kontext);
```

- [ ] **Step 3: Tests laufen lassen, sie müssen scheitern**

Run: `node js/review/__tests__/weg-dialog-wiki-kasten.test.js` — Expected: FAIL `Funktion fehlt: pathWikiGruppenIds`.
Run: `node js/review/__tests__/weg-dialog-gruppe.test.js` — Expected: FAIL `Funktion fehlt: pathWikiWeitereAnhang`.

- [ ] **Step 4: `index.html`**

In Zeile 1847 `<div id="path-wiki-assign-host"></div><div class="label-edit-section" id="path-wiki-weitere-host"></div>` ersetzen durch `<div id="path-wiki-assign-host"></div>`.

- [ ] **Step 5: `review-paths.js`**

1. Im Kopfblock nach `let pathWikiWeitereKasten = null;   // der Kasten „Weitere Wiki-Zuweisungen" im Dialog` einfügen:

```js
// 🔴 Nachtrag 15.09.2026 §9.5: EIN Element fuer die Lebenszeit der Seite, eingehaengt in den Kasten „Wiki-Weg"
// (renderPathWikiReference, review-path-wiki.js). Der Kasten darin wird bei jedem Oeffnen neu montiert; das Bauteil haengt
// dasselbe Element nach jedem Neuzeichnen wieder ein -- deshalb traegt es beide Reihenfolgen der drei Befueller.
let pathWikiWeitereAnhangElement = null;
```

2. `mountPathWikiWeitere` (ganze Funktion samt Kopfkommentar) ersetzen durch:

```js
/** Das Element mit den weiteren Zuweisungen im Kasten „Wiki-Weg" (Nachtrag §9.5). Einmal gebaut, dann immer dasselbe. */
function pathWikiWeitereAnhang() {
	if (!pathWikiWeitereAnhangElement && typeof document !== "undefined" && typeof document.createElement === "function") {
		pathWikiWeitereAnhangElement = document.createElement("div");
	}
	return pathWikiWeitereAnhangElement;
}

/** Der Kasten „Weitere Wiki-Zuweisungen" im Dialog -- fuer den Abschnitt oder fuer die ganze Strasse (§3.5, Nachtrag §9.5). */
function mountPathWikiWeitere(path, pfade, ganz) {
	if (pathWikiWeitereKasten) {
		pathWikiWeitereKasten.zerstoeren();
		pathWikiWeitereKasten = null;
	}
	const host = pathWikiWeitereAnhang();
	if (!host || typeof avesmapsWikiWeitereKastenMount !== "function") {
		return;
	}
	const label = (pfad) => (typeof avesmapsWegAbschnittLabelAufKarte === "function" ? avesmapsWegAbschnittLabelAufKarte(pfad) : "");
	pathWikiWeitereKasten = avesmapsWikiWeitereKastenMount(host, {
		skin: "label-wiki",
		hauptKey: () => String(path.properties?.wiki_path?.wiki_key || ""),
		// Keine Zeile „Hauptzuweisung": der Kasten „Wiki-Weg", in dem dieser haengt, zeigt sie schon.
		// Bei JEDER Aktion frisch gelesen: nach einem Schreiben stehen die neuen Listen schon in den Kartendaten.
		abschnitte: () => pfade.map((pfad) => ({
			public_id: getPathPublicId(pfad),
			label: label(pfad),
			wiki_path_weitere: Array.isArray(pfad.properties?.wiki_path_weitere) ? pfad.properties.wiki_path_weitere : [],
		})),
		umfangText: () => (ganz ? "die ganze Straße" : (label(path) || "diesen Abschnitt")),
		gesamtText: () => {
			const strecke = typeof avesmapsWegGanzeStreckeAufKarte === "function" ? avesmapsWegGanzeStreckeAufKarte(path) : "";
			return strecke ? "ganze Straße · " + strecke : "ganze Straße";
		},
		geschrieben: (daten) => {
			pathWikiWeitereUebernehmen(daten);
			// Der Server hat die Kartenrevision gehoben: der Live-Abgleich holt die Abschnitte und leert damit die
			// Zwischenspeicher, die an der Revision haengen (Gruppen, Traeger-Index).
			if (typeof pollLiveMapUpdates === "function") {
				void pollLiveMapUpdates();
			}
			if (pathWikiWeitereKasten) {
				pathWikiWeitereKasten.neuZeichnen();
			}
		},
	});
}

/**
 * Nach Zuweisen/Entfernen im Gruppendialog (Nachtrag 15.09.2026 §9.6): R1 bzw. R2 haben die Namen der Abschnitte geaendert,
 * der Vergleichsstand vom Oeffnen stimmt nicht mehr.
 * 💣 Ohne Neurechnen stuende nach „Entfernen" der alte gemeinsame Name als Stand da, das Namensfeld zeigte ihn weiter -- und
 * das naechste „Speichern fuer N Abschnitte" schriebe einen Namen auf alle, die gerade eigene bekommen haben.
 */
function pathEditGruppeNachWikiSchreiben() {
	if (!pathEditGruppe) {
		return;
	}
	pathEditGruppe.stand = wpGroupFieldStates(avesmapsPathGruppeZeilen(pathEditGruppe.pfade, {
		name: getPathDisplayName,
		zeigeName: shouldPathNameBeDisplayed,
		transporte: getPathAllowedTransports,
	}), pathEditTransportSchluessel());
	const name = document.getElementById("path-edit-name");
	if (name) {
		name.value = pathEditGruppe.stand.name.gleich ? (pathEditGruppe.stand.name.wert || "") : "";
	}
	syncPathAutoNameControls();
	if (typeof pathEditFeature !== "undefined" && pathEditFeature) {
		pathEditUmfangZeigen(pathEditFeature, true);
	}
	if (pathWikiWeitereKasten) {
		pathWikiWeitereKasten.neuZeichnen();
	}
}
```

3. In `populatePathEditFormFromLastSettings` die Kommentarzeilen

```js
	// Fix-Runde 1, Punkt 1: dieselben zwei Aufrufe wie in populatePathEditForm -- sonst bleibt der Kasten
	// „Weitere Wiki-Zuweisungen" fuer jeden frisch gezeichneten Weg eine leere, aber gerahmte Karte
	// (#path-wiki-weitere-host traegt `class="label-edit-section"` unabhaengig vom Inhalt).
```

ersetzen durch

```js
	// Fix-Runde 1, Punkt 1: dieselben zwei Aufrufe wie in populatePathEditForm -- sonst traegt der Anhang des Kastens
	// „Wiki-Weg" den Kasten des zuletzt geoeffneten Wegs weiter (Nachtrag §9.5: alle drei Befueller montieren).
```

- [ ] **Step 6: `review-path-wiki.js`**

1. Direkt vor `async function pathWikiZuweisen(treffer) {` einfügen:

```js
/** Die Abschnitte der ganzen Strasse, wenn der Dialog im Gruppenmodus steht (Nachtrag §9.6) -- sonst null. Der Anker vorn. */
function pathWikiGruppenIds(publicId) {
	if (typeof pathEditGruppe === "undefined" || !pathEditGruppe || !Array.isArray(pathEditGruppe.pfade) || pathEditGruppe.pfade.length < 2) {
		return null;
	}
	return avesmapsWikiAssignWegGruppenIds(publicId, pathEditGruppe.pfade.map((pfad) => getPathPublicId(pfad)));
}

/** Nach einem Gruppenschreiben: Vergleichsstand neu (review-paths.js), dann der Live-Abgleich (Gruppen haengen an der Revision). */
function pathWikiNachGruppenSchreiben() {
	if (typeof pathEditGruppeNachWikiSchreiben === "function") {
		pathEditGruppeNachWikiSchreiben();
	}
	if (typeof pollLiveMapUpdates === "function") {
		void pollLiveMapUpdates();
	}
}

```

2. In `pathWikiZuweisen`:
   - Die Zeile `		result = await pathWikiPost(avesmapsWikiAssignWegZuweisungsKoerper(treffer.wiki_key, publicId));` ersetzen durch:

```js
		// Nachtrag §9.6: im Gruppendialog GENAU die Abschnitte der ganzen Strasse, am Abschnitt der Namens-Match wie bisher.
		result = await pathWikiPost(avesmapsWikiAssignWegZuweisungsKoerper(treffer.wiki_key, publicId, pathWikiGruppenIds(publicId)));
```

   - Die Zeile `	showFeedbackToast?.(\`„${result.wiki_name}" verknüpft (${result.applied} Abschnitte).\`, "success");` unverändert lassen und direkt DAVOR einfügen:

```js
	if (pathWikiGruppenIds(publicId)) {
		pathWikiNachGruppenSchreiben();
	}
```

3. In `pathWikiLoesen` direkt nach

```js
	if (!publicId) {
		throw new Error("Kein Weg ausgewählt.");
	}
```

einfügen:

```js
	// 🔴 Nachtrag §9.6: im Gruppendialog EINE Frage, dann GENAU die Abschnitte -- „nur dieses Segment?" gibt es dort nicht,
	// markiert ist die ganze Strasse. Die Owner-Regel vom 05.07.2026 („nie ungefragt den ganzen Weg") bleibt erfuellt.
	const gruppenIds = pathWikiGruppenIds(publicId);
	if (gruppenIds) {
		const wiki = pathWikiCurrentAssignment();
		if (!window.confirm(avesmapsWikiAssignWegGruppeLoesenFrage(wiki ? wiki.name : "", gruppenIds.length))) {
			// 🔴 ABGEBROCHEN IST ABGELEHNT -- das Bauteil laesst die Zuweisung stehen.
			throw new Error("Abgebrochen.");
		}
		let gruppenErgebnis;
		try {
			gruppenErgebnis = await pathWikiPost(avesmapsWikiAssignWegLoesenKoerper(publicId, gruppenIds));
			avesmapsWikiAssignWegAntwortPruefen(gruppenErgebnis);
		} catch (error) {
			showFeedbackToast?.("Fehler: " + (error.message || error), "error");
			throw error;
		}
		applyWikiPathSegmentsUpdate(gruppenErgebnis.segments_updated);
		pathWikiSyncNachbarn();
		pathWikiNachGruppenSchreiben();
		showFeedbackToast?.(`Wiki-Zuordnung von ${gruppenErgebnis.segments} Abschnitten entfernt — jeder heißt jetzt einzeln.`, "info");
		return;
	}
```

4. In `renderPathWikiReference` die Zeile `		syncUebernehmen: pathWikiSyncUebernehmen,` ersetzen durch:

```js
		syncUebernehmen: pathWikiSyncUebernehmen,
		// Nachtrag §9.5: EIN Kasten -- die weiteren Zuweisungen haengen darin (review-paths.js, pathWikiWeitereAnhang).
		anhang: typeof pathWikiWeitereAnhang === "function" ? pathWikiWeitereAnhang() : null,
```

- [ ] **Step 7: `review-editor-submit.js`**

In `handlePathGroupEditSubmit` direkt nach

```js
	if (!rumpf) {
		setPathEditStatus("Nichts geändert.");
		return;
	}
```

einfügen:

```js
	// Nachtrag 15.09.2026 §9.5: was der Kasten „Wiki-Weg" per Sync ins Formular geholt hat, reist mit -- der Server liest
	// `wiki_uebernommen` im Sammel-Speichern seit jeher (avesmapsUpdatePathGroupDetails), wpGroupRumpf schickte es nie.
	const uebernommen = typeof getPathWikiUebernommenPayload === "function" ? getPathWikiUebernommenPayload() : [];
	if (uebernommen.length) {
		rumpf.wiki_uebernommen = uebernommen;
	}
```

- [ ] **Step 8: Tests laufen lassen**

Run: `node js/review/__tests__/weg-dialog-wiki-kasten.test.js`, `node js/review/__tests__/weg-dialog-gruppe.test.js`, `node js/ui/__tests__/wiki-assign-weg.test.js`, `node js/review/__tests__/wiki-assign-kein-doppelrahmen.test.js`, `node js/review/__tests__/stroemung-zwei-spalten.test.js`, `node js/review/__tests__/quellen-im-wegedialog.test.js`, `node js/app/__tests__/nur-editor-skripte.test.js`.
Expected: alle `ok`.

- [ ] **Step 9: Ablauf im Browser (vor dem Commit)**

Karte im Bearbeiten-Modus: (1) Abschnitt markieren → „Bearbeiten“ → EIN Kasten „Wiki-Weg“, darin die weiteren Zuweisungen; (2) ganze Straße markieren → „Bearbeiten“ → „Speichern für N Abschnitte“, Kasten mit „Weitere Wiki-Zuweisung für die ganze Straße“; (3) „Weg zeichnen“ → Dialog des frischen Wegs → Kasten ohne fremde Zuweisungen; (4) Gruppendialog „Sync“ → Wegtyp übernehmen → speichern → Feldherkunft „wiki“ im Wege-Editor sichtbar (keine braune Beschriftung); (5) Gruppendialog „Entfernen“ auf einer Teststraße → eine Frage, Namensfeld leer, „Speichern für N Abschnitte“ schreibt keinen Namen. In einem ZWEITEN Editor-Tab prüfen, dass die entfernte weitere Zuweisung nach dem nächsten Live-Abgleich verschwindet (Task 1).

- [ ] **Step 10: Commit**

```bash
printf '%s\n' "ui(wege): Dialog \"Weg bearbeiten\" zeigt EINEN Kasten Wiki-Weg mit den weiteren Zuweisungen darin -- ganze Strasse schreibt auf genau ihre Abschnitte" "" "Alle drei Befueller montieren in denselben Anhang; Gruppendialog rechnet nach Zuweisen/Entfernen den Stand neu, schickt wiki_uebernommen." "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9.5, §9.6." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add index.html js/review/review-paths.js js/review/review-path-wiki.js js/review/review-editor-submit.js js/review/__tests__/weg-dialog-gruppe.test.js js/review/__tests__/weg-dialog-wiki-kasten.test.js && git commit -F "$SCRATCH/msg.txt"
```

**🚚 Lieferung C „Ein Kasten Wiki-Weg“:** Tasks 7–12 zusammen (Task 9 allein ließe den Kasten in den alten Hosts ohne Überschrift stehen). Vorher `usability-konsistenz` gegen Nachtrag §9.5/§9.6, vor dem Push `usability-design` gegen die Dialoge des Mockups (Z. 180–311) in hell **und** dunkel — mit der benannten Abweichung „Hauptzuweisung als Feldliste statt Tabellenzeile“. Nach dem Push: Besucher-Konsole lesen; im Bearbeiten-Modus die Handgriffe aus Task 11 Step 8 und Task 12 Step 9. Owner schaut.

---

## Task 13: AGENTS.md §11 nachziehen

**Files:**
- Modify: `AGENTS.md` §11, Absatz `- **Weitere Wiki-Zuweisungen an Wegen · Klick auf Straße oder Abschnitt · „Weg als Route"**`

**Interfaces:** keine.

**Risiko:** Der Absatz wird von Nachbarsitzungen mitgepflegt. Vor dem Ersetzen den Absatz frisch lesen; stimmt ein Suchtext unten nicht mehr zeichengenau, wird die Stelle gleichen Inhalts von Hand angepasst — nicht übersprungen.

- [ ] **Step 1: Suchen und ersetzen**

1. Suchtext:

```markdown
💣 **Die Farbe der gelben Linie wird GELESEN, nie abgeschrieben** (`avesmapsWegAuswahlFarbe`): dieselbe `SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color` wie die Hervorhebung der Suche. 🔧 **Offen:** beide Markierungen auf verschiedenen Wegen gleichzeitig sind farblich nicht zu unterscheiden.
```

Ersatz:

```markdown
🔴 **Die Auswahl trägt die Farbe markierter Orte** (Owner 15.09.2026, Nachtrag §9.1): `--color-marker-active`, gelesen über `getLocationMarkerActiveColor`; „Anzeigen" aus der Suche bleibt `SPOTLIGHT_PATH_HIGHLIGHT_STYLE` (`#ffd72e`). Gemessener Abstand der beiden 38,4 (RGB) — auf verschiedenen Wegen zu trennen. 💣 **Erst die Mitgliedschaft, dann die Farbe** (`avesmapsWegAuswahlStilNachziehen`): `syncPathRendering` färbt je Zoomschritt alle rund 6.000 Wege neu, ein `getComputedStyle` je Weg wäre ein Zoom-Hänger.
```

2. Suchtext:

```markdown
🔴 **Im Bearbeiten-Modus tritt der Klick-Arbiter der Wegnamen ABSICHTLICH zurück** — Weg-/Fluss-Labels sind dort nicht klickbar, damit ein Klick auf den Namen denselben Stützpunkt-/Auswahl-Pfad trifft wie ein Klick auf die Linie darunter; ein Klick, der nur die freistehende Schrift NEBEN der Linie trifft, tut nichts (bestehend, gewollt). 🔧 **Offen:** ob ein reiner Namensklick im Bearbeiten-Modus die Straße markieren soll.
```

Ersatz:

```markdown
🔴 **Im Bearbeiten-Modus markiert ein Klick auf den Namen eines Wiki-Wegs die Straße** (Owner 15.09.2026, Nachtrag §9.4) — derselbe Linien-Zuhörer läuft (`_pathLines[1].fire("click")` am Abschnitt, der dem Klickpunkt am nächsten liegt, `avesmapsWegNaechsterAbschnitt`); der Klick-Schiedsrichter des Overlays bleibt im Bearbeiten-Modus stumm, Kurvenlabels bleiben dort nicht klickbar. 💣 **EIN Karten-Klick-Zuhörer** (`avesmapsWegKartenKlick`) entscheidet Markieren ODER Aufheben — zwei Zuhörer hingen an ihrer Registrierungsreihenfolge. 🔴 Riegel: `window.avesmapsKeyboardShortcuts.toolActive()` (dieselbe `TOOL_CLASSES`-Liste), Wiki-Ziel-Pick, Verlauf-Editor, offenes Kontextmenü; ohne Tastatur-Modul geschlossen. Der Name zeigt dort die Hand, nie während eines Werkzeugs.
```

3. Suchtext:

```markdown
💣 **Die Zeile „Hauptzuweisung" im Kasten „Weitere Wiki-Zuweisungen" erscheint NUR, wo kein Kasten „Wiki-Weg" die Hauptzuweisung schon zeigt** — im Wege-Editor also nur auf der Weg-Ebene, im Kartendialog NIE (Abschnitt wie Gruppe zeigen dort beide den Kasten „Wiki-Weg" darüber). 🔧 **Owner offen:** das Mockup zeigt EINEN Kasten „Wiki-Weg" mit der Liste darin; gebaut sind zwei gestapelte Kästen (Zusammenlegen bräuchte eine Änderung am geteilten Wiki-Zuweisungs-Bauteil für alle acht Objektarten). 💣 **Der Kasten braucht seinen Trenner**: `.dt-grp:first-child` nimmt einer Überschrift als erstem Kind ihres Wirts Rand und Linie — die bestehende Ausnahme bekam einen zweiten Selektor `.wiki-weitere-kasten > .dt-grp:first-child` statt eigener Werte.
```

Ersatz:

```markdown
🔴 **EIN Kasten „Wiki-Weg" mit den weiteren Zuweisungen darin** (Owner 15.09.2026, Nachtrag §9.5) — am Abschnitt, auf der Weg-Ebene (neu `#wpGroupWikiAssign`) und im Kartendialog (`#path-wiki-weitere-host` gefallen). Das geteilte Bauteil `js/ui/wiki-assign.js` hat dafür die opt-in-Einhängestelle `anhang`: ohne sie bleibt das Markup der übrigen sieben Objektarten Zeichen für Zeichen gleich (Golden-Master `js/ui/__tests__/fixtures/wiki-assign-markup-ohne-anhang.json`); die fünf Zuhörer steigen für Ereignisse aus `[data-wa-anhang]` aus — über `closest`, nie `contains`. Der Kasten „Weitere Wiki-Zuweisungen" hat nur noch die eingebettete Form: keine Überschrift, **keine Zeile „Hauptzuweisung"** (bewusste Abweichung vom Mockup — die Hauptzuweisung steht als Feldliste darüber), Zeilen auch ohne Hauptzuweisung; die Trennlinie trägt `.wiki-weitere-kasten` (`--color-divider`).
```

4. Suchtext:

```markdown
🔴 **Ein Rumpf-Bauer für das Sammel-Speichern** (`wpGroupRumpf`), gerufen vom Wege-Editor und vom Kartendialog — DREI Befüller im Kartendialog rufen denselben Kasten „Weitere Wiki-Zuweisungen" (`mountPathWikiWeitere`, aus `populatePathEditForm`, `populatePathEditFormGruppe` und `populatePathEditFormFromLastSettings` für den frisch gezeichneten Weg; der dritte fehlte beim ersten Bau und zeigte einen leeren Rahmenkasten).
```

Ersatz:

```markdown
🔴 **Ein Rumpf-Bauer für das Sammel-Speichern** (`wpGroupRumpf`), gerufen vom Wege-Editor und vom Kartendialog; beide hängen `wiki_uebernommen` an, wenn „Sync" etwas ins Formular geholt hat (der Server las es dort seit jeher, geschickt wurde es nie). DREI Befüller im Kartendialog montieren den Kasten der weiteren Zuweisungen (`mountPathWikiWeitere`, aus `populatePathEditForm`, `populatePathEditFormGruppe` und `populatePathEditFormFromLastSettings`) — in EIN dauerhaftes Anhang-Element (`pathWikiWeitereAnhang`). 🔴 **„Ganze Straße" schreibt auf genau ihre Abschnitte:** `assign_to`/`clear_assign` nehmen `public_ids` (Anker darunter, Deckel 250, `single_segment` ausgeschlossen, Typriegel über jeden Zielweg; ohne die Angabe unverändert der Namens-Match). Entfernen lässt die Straße nach R2 zerfallen — der Gruppendialog rechnet danach seinen Vergleichsstand neu, sonst schriebe das nächste Sammel-Speichern einen Namen auf alle.
```

5. Suchtext:

```markdown
💣 **Jeder Zuweiser erhält die Liste**, und wer eine Hauptzuweisung setzt, nimmt denselben Artikel aus ihr heraus (`avesmapsWikiPathWeitereOhneHaupt`).
```

Ersatz:

```markdown
💣 **Jeder Zuweiser erhält die Liste**, und wer eine Hauptzuweisung setzt, nimmt denselben Artikel aus ihr heraus (`avesmapsWikiPathWeitereOhneHaupt`). 💣 **Eine leer gewordene Liste bleibt `[]`, sie wird nie gelöscht** (Nachtrag §9.2): der Live-Abgleich anderer Editoren mischt per Spread (`applyPathFeatureResponse`), ein fehlender Schlüssel überschrieb dort nichts, und der entfernte Artikel blieb bis zum Neuladen stehen. Jeder Leser liest `[]` als „keine" (Tafel im Nachtrag). ⚠️ Offen: ein „Rückgängig" der ersten weiteren Zuweisung stellt einen Schnappschuss OHNE Schlüssel her — derselbe Spread-Fall.
```

6. Suchtext:

```markdown
🔴 **Ein Abschnitt heißt „Abschnitt N: Ort – Ort"**:
```

Ersatz:

```markdown
🔴 **„Ganze Straße: A – B" nur, wenn BEIDE äußeren Enden Orte sind**, sonst nur „Ganze Straße" (Auslegung von §4, Nachtrag §9.3, eine Regel in `wpGanzeStrecke` für Infobox, Dialog, Weitere-Kasten und Gruppenkopf). 🔴 **Ein Abschnitt heißt „Abschnitt N: Ort – Ort"**:
```

7. Im selben Absatz nach „live 14./15.09.2026“ ergänzen: `, Nachtrag §9 vom 15.09.2026 mit Bauplan \`docs/superpowers/plans/2026-09-15-wege-wiki-kasten-namensklick.md\``, und hinter „Mockup `docs/wege-mehrfachzuweisung-mockup.html`“ nichts ändern. Außerdem den Satz über die Rechte ergänzen (direkt nach dem Satz aus Ersatz 5): `🔴 Der Endpunkt \`api/edit/wiki/paths.php\` verlangt für alle Aktionen \`review\` (Entwurf §2.3 sagte \`edit\`, korrigiert im Nachtrag §9.7).`

8. Die Testliste am Ende des Absatzes ersetzen — Suchtext ab `Tests: \`api/_internal/wiki/__tests__/path-weitere{,-schreiben,-erhalten,-verlauf}-test.php\`` bis zum Absatzende — durch:

```markdown
Tests: `api/_internal/wiki/__tests__/{path-weitere,path-weitere-schreiben,path-weitere-erhalten,path-weitere-verlauf,wege-gruppe-wiki-public-ids}-test.php`, `api/_internal/map/__tests__/{weg-abschnitt-ende,wege-liste-enden-geometrietyp}-test.php`, `api/app/__tests__/wege-suche-weitere-test.php`, `js/map-features/__tests__/{weg-gruppenschluessel-echter-name,weg-abschnitte,weg-weitere-anzeige,weg-auswahl,weg-auswahl-karte,weg-weitere-leere-liste,weg-naechster-abschnitt,weg-namensklick}.test.js`, `js/pages/__tests__/{wege-weitere-liste,wege-editor-abschnittsnamen,wege-ganze-strecke-nur-orte,wege-editor-wiki-kasten}.test.js`, `js/ui/__tests__/{wiki-weitere-kasten,wege-suche-weitere,wiki-assign-anhang,wiki-assign-weg-gruppe}.test.js`, `js/app/__tests__/{deeplink-weitere,keyboard-shortcuts}.test.js`, `js/review/__tests__/{weg-dialog-gruppe,weg-dialog-wiki-kasten}.test.js`, `js/routing/__tests__/{route-buendel,weg-als-route}.test.js`.
```

- [ ] **Step 2: Den Eintrag gegen den Baum prüfen**

```bash
for f in api/_internal/wiki/__tests__/{path-weitere,path-weitere-schreiben,path-weitere-erhalten,path-weitere-verlauf,wege-gruppe-wiki-public-ids}-test.php \
  api/_internal/map/__tests__/{weg-abschnitt-ende,wege-liste-enden-geometrietyp}-test.php api/app/__tests__/wege-suche-weitere-test.php \
  js/map-features/__tests__/{weg-gruppenschluessel-echter-name,weg-abschnitte,weg-weitere-anzeige,weg-auswahl,weg-auswahl-karte,weg-weitere-leere-liste,weg-naechster-abschnitt,weg-namensklick}.test.js \
  js/pages/__tests__/{wege-weitere-liste,wege-editor-abschnittsnamen,wege-ganze-strecke-nur-orte,wege-editor-wiki-kasten}.test.js \
  js/ui/__tests__/{wiki-weitere-kasten,wege-suche-weitere,wiki-assign-anhang,wiki-assign-weg-gruppe}.test.js \
  js/app/__tests__/{deeplink-weitere,keyboard-shortcuts}.test.js js/review/__tests__/{weg-dialog-gruppe,weg-dialog-wiki-kasten}.test.js \
  js/routing/__tests__/{route-buendel,weg-als-route}.test.js; do ls "$f" >/dev/null || echo "FEHLT: $f"; done
grep -c "🔧 \*\*Owner offen:\*\* das Mockup zeigt EINEN Kasten" AGENTS.md; grep -c "ob ein reiner Namensklick im Bearbeiten-Modus" AGENTS.md
```

Expected: keine `FEHLT:`-Zeile; beide `grep -c` liefern `0` (die zwei 🔧-Zeilen sind aufgelöst). Fehlt eine Datei, wird der Eintrag korrigiert, nicht der Test umbenannt.

- [ ] **Step 3: Commit**

```bash
printf '%s\n' "docs(agents): ein Kasten Wiki-Weg, Namensklick, Auswahl in Gold, public_ids und [] in §11" "" "Nachtrag docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §9." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add AGENTS.md && git commit -F "$SCRATCH/msg.txt"
```

---

## Vor „fertig“: die Abnahmeliste (AGENTS.md §9)

- [ ] Jede Zeile mit 💣 / ⚠️ / 🔴 in **Nachtrag §9** des Entwurfs und in diesem Plan einzeln abhaken: erfüllt, oder ausdrücklich verworfen mit Begründung.
- [ ] Vor jedem Commit einer sichtbaren Lieferung (A: Task 2 und 3 · B: Task 6 · C: Task 9, 11, 12) den Sub-Agenten `usability-konsistenz` mit Nachtrag und Diff fahren — ausdrücklich prüfen: Farbe aus dem Token, keine zweite Werkzeugliste, Golden-Master unverändert, Trennlinie mit `--color-divider`.
- [ ] Vor jedem Push einer Lieferung den Sub-Agenten `usability-design` gegen `docs/wege-mehrfachzuweisung-mockup.html` (Dialoge Z. 180–311) fahren, in hell **und** dunkel; die benannte Abweichung (Hauptzuweisung als Feldliste statt erster Tabellenzeile) mitgeben.
- [ ] Sub-Agenten ausdrücklich verbieten: `checkout`, `switch`, `stash`, `restore`, `reset`, `rebase`, `cherry-pick` im geteilten Hauptbaum.
- [ ] Vor jedem Push: ganzes Testfeld nach dem Muster des Workflows, Dateizahlen gegen den Workflow gehalten; Quelltext-Tests einmal auf einer LF-Kopie.
- [ ] Nach jedem Push: `gh run list --limit 3` bis `success`, Remote-SHA gegen den eigenen Commit, Live-Seite als **Besucher** (ohne `edit=1`) laden und die Konsole lesen; die benannten Handgriffe der Lieferung ausführen, nicht nur messen.
- [ ] Was ein Emulator nicht beantwortet (echtes Touch-Verhalten auf dem Namen, Bildschirmtastatur im Suchfeld des Anhangs), als offene Frage melden.
- [ ] Offene Punkte aus Nachtrag §9.9 dem Owner nennen: „Rückgängig“ und die leere Liste; „Anzeigen“ und Auswahl farblich nah (38,4); ein Ort namens „Kreuzung“/„Wegende“.
