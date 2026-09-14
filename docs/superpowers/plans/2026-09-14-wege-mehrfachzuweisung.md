# Wege: weitere Wiki-Zuweisungen · Klick auf Straße oder Abschnitt · „Weg als Route" — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Wegabschnitt trägt neben seiner Hauptzuweisung weitere Wiki-Artikel. Editoren markieren auf der Karte erst die ganze Straße, dann den Abschnitt, und bearbeiten genau das. Abschnitte heißen „Abschnitt N: Ort – Ort". Jeder Weg lässt sich als Route in den Routenplaner setzen.

**Architecture:** `properties.wiki_path` bleibt die Identität. Eine zweite Liste `properties.wiki_path_weitere` kommt dazu, geschrieben über zwei neue Aktionen des Wege-Sync-Endpunkts. Die Leser lernen die Liste einzeln: Wege-Editor, Suche, Deeplink, Infobox, Verlauf-Abgleich. Reine Module tragen die Regeln (Benennung, Klickfolge, Bündelung, Reihenfolge) und werden ausgeführt getestet. Die Benennung der Abschnittsenden existiert als JS/PHP-Zwilling mit gemeinsamer Fixture.

**Tech Stack:** Vanilla JS ohne Build (klassische Skripte, globale Funktionen, `module.exports`-Wache für Node-Tests), PHP 8 strict types, MySQL 8 (Tests gegen SQLite), Leaflet 1.9.4.

**Spec:** `docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md` · Mockup `docs/wege-mehrfachzuweisung-mockup.html` (Anker `#rs`, `#rs7`, `#bp`, `#bp-route`; lokal über `php -S 127.0.0.1:8765 -t <repo>`).

## Global Constraints

- **E1/E2:** Die Hauptzuweisung (`wiki_path`) bleibt Identität, Name (R1), Gruppe, Kanon. Eine weitere Zuweisung ändert **nie** Wegname, Gruppe oder Art.
- **„Ganze Straße"** = die Gruppe des Wege-Editors (`wpGroupKeyOf`: `wiki:<Hauptschlüssel>`, sonst `name:<Wegart>:<echter Name>`), auch über Lücken.
- **Abschnittsname:** Langform `Abschnitt N: <Ende> – <Ende>` (ohne `Abschnitt N: ` bei einteiligem Weg), Kurzform `Abschnitt: <Ende> – <Ende>` / `Ganze Straße: <Ende> – <Ende>`. Ende = Ort mit Abstand **< 0,01**, sonst `Kreuzung` (ohne Nummer), sonst `Wegende`. Ein verborgener Ort heißt wie der Ort.
- **Markierung:** die Linie selbst in `SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color`, keine Umrandung. Fremde Träger des Artikels gestrichelt, nur Anzeige.
- **Markierungszeile:** ohne Kasten, direkt unter der Wegart.
- **Bündelung:** höchstens `AVESMAPS_ROUTE_MAX_VIA` = **10** Zwischenhalte je Anfrage. Ein Kartenpunkt ist immer Bündelgrenze.
- **Sprache:** Kommentare, Doku, Commit-Nachrichten deutsch. `error.code` englisch. Sichtbare Texte deutsch.
- **Design:** keine hartkodierte Farbe, kein Radius, keine Schrift unter 11px (Tokens aus `css/base/tokens.css`). Einzige Ausnahme: die Markierungsfarbe, gelesen aus `SPOTLIGHT_PATH_HIGHLIGHT_STYLE`.
- **Assets:** nie `?v=` von Hand schreiben, der Deploy stempelt `index.html`, `html/*.html` und die `@import`-Kette.
- **Ladeverfahren:** Alle neuen JS-Dateien laden als **normale** Skripte, **nicht** in `<template data-nur-editor>`. `js/app/__tests__/nur-editor-skripte.test.js` Teil C prüft seit `240afdfc4` jeden Namen aus einer Vorlage gegen **alle** Skripte außerhalb der Vorlagen, `js/review/` eingeschlossen: nennt ein normal geladenes Skript einen Vorlagen-Namen, fällt der Test. In den Vorlagen stehen heute nur `js/review/review-{link-check,citymap-autoget,game-literature-cover-autoget,mail,social,garetien-label-vorschau,garetien-importer,garetien-karte}.js`; keine davon fasst dieser Plan an.
- **MySQL/SQLite:** kein DDL in einer Transaktion; keine Produktionsform verbiegen, damit ein SQLite-Test läuft (AGENTS.md §9).
- **STRATO:** keine Schleife über schwere Endpunkte; Live-Messung mit **einer** Anfrage.
- **Geteilter Baum:** nie `git add -A`/`.`; nur eigene Pfade; `git add` und `git commit` in **einem** Zug; Commit-Nachricht per Datei (`git commit -F`).

## Arbeitsweise für jede Aufgabe

**Arbeitsort:** ein Wegwerf-Worktree auf `origin/master`, nie der geteilte Hauptbaum.

```bash
SCRATCH="<scratchpad>"            # das Scratchpad der Sitzung
git -C C:/GIT/avesmaps fetch -q origin
git -C C:/GIT/avesmaps worktree add --detach "$SCRATCH/bau" origin/master
cd "$SCRATCH/bau"
```

**Einzeltest:** `node <datei>.test.js` bzw. `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll <datei>.php`

**Ganzes Testfeld vor jedem Push** (Muster des Workflows, parallel; die Klammer um beide Gruppen ist tragend):

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 \
  | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > "$SCRATCH/rot-js.txt"
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 \
  | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > "$SCRATCH/rot-php.txt"
cat "$SCRATCH/rot-js.txt" "$SCRATCH/rot-php.txt"
```

Erwartet: Die Dateizahlen passen zum Workflow (`.github/workflows/deploy-avesmaps-strato.yml`). Rot darf höchstens `api/**/linkcheck/link-url-test.php` sein (echter DNS-Abruf, vorbestehend). Einen unerwarteten Roten seriell nachfahren, bevor man ihn glaubt.

**Push:** erst `gh run list --limit 3`; bei `in_progress` **oder** `pending` warten, auch bei fremden Läufen. Dann aus dem Worktree:

```bash
git fetch -q origin && git rebase origin/master      # im Wegwerf-Worktree, nie im Hauptbaum
if git push origin HEAD:master; then git log --oneline -1 origin/master; fi
```

Nach dem Push SHA gegen `origin/master` prüfen. Danach `gh run list --limit 3` bis `success`. Berührt der Commit die Karte: Live-Seite als **Besucher** (ohne `edit=1`) laden und die Konsole lesen.

**Sichtbare Teile gehen einzeln live;** der Owner sieht jeden, bevor der nächste folgt (AGENTS.md §9). Die Liefergrenzen stehen als **🚚 Lieferung** zwischen den Aufgaben.

---

## Dateiübersicht

**Neu:**

| Datei | Verantwortung |
|---|---|
| `api/_internal/wiki/path-weitere.php` | Liste lesen/ändern (rein) + Schreibweg `avesmapsWikiPathWeitereSchreiben` |
| `api/_internal/map/weg-abschnitt-ende.php` | PHP-Zwilling der Endenbenennung (Wege-Editor-Liste) |
| `tools/paths/fixtures/weg-abschnitt-enden.json` | gemeinsame Fälle für JS- und PHP-Zwilling |
| `js/map-features/weg-abschnitte.js` | Endenbenennung, Abschnittslabel, Karten-Adapter Pfad → Editorzeile (rein + dünne Kartenleser) |
| `js/map-features/weg-auswahl.js` | Klickfolge, Markierungszeile (rein) |
| `js/map-features/map-features-weg-auswahl.js` | Klickfolge auf der Karte: Zustand, gelbe Linie, Aufheben |
| `js/map-features/weg-weitere-anzeige.js` | Infobox-Zeilen „Auch Teil von" / „Verläuft auch über" |
| `js/review/path-gruppe.js` | Dialog für die ganze Straße: Kartenpfade → Zeilen, Knopf- und „teils"-Texte (rein) |
| `js/ui/wiki-weitere-kasten.js` | der Kasten „Weitere Wiki-Zuweisungen" (Wege-Editor und Kartendialog) |
| `css/components/wiki-weitere-kasten.css` | seine Regeln |
| `js/routing/route-buendel.js` | Wegpunkte zu `via`-Anfragen bündeln (rein) |
| `js/routing/weg-als-route.js` | Orte eines Wegs in Reihenfolge (rein) + Kartenleser |

**Geändert (Auswahl):** `js/map-features/path-einschraenkung.js`, `api/edit/wiki/paths.php`, `api/_internal/wiki/paths.php`, `api/_internal/wiki/path-verlauf.php`, `api/edit/map/paths-editor.php`, `js/pages/wege-editor-model.js`, `js/pages/wege-editor.js`, `html/wege-editor.html`, `js/ui/spotlight-search.js`, `api/app/map-search.php`, `js/app/wiki-deeplink.js`, `js/map-features/map-features-path-rendering.js`, `js/map-features/map-features-infopanel.js`, `js/routing/routing.js`, `js/review/review-paths.js`, `js/review/review-editor-submit.js`, `js/review/review-dialog-state.js`, `js/review/review-pending.js`, `js/routing/route-engine.js`, `index.html`, `css/styles.css`, `css/components/editor-page.css`, `css/features/location-popups-markers.css`, `css/features/route-planner.css`, `css/features/path-editor.css`, `css/pages/wege-editor.css`, `js/app/i18n-en.js`, `js/pages/__tests__/wege-gruppe-felder.test.js`, `js/routing/__tests__/sperrzeiten-anfrage.test.js`, `AGENTS.md`.

## Task 1: Die Karte gruppiert unzugewiesene Wege nach ihrem echten Namen

Bestehender Fehler, beim Vermessen gefunden. `avesmapsWegGruppenSchluessel` liest bei Wegen ohne Wiki-Schlüssel `properties.name`. Im Browser steht dort nach `normalizeRoutePathFeature` der Maschinenname `<Wegart>-<n>`. Jeder unzugewiesene Abschnitt bildet dadurch seine eigene Gruppe. Das trifft heute die kursive Schrift eingeschränkter Wege und „alle N Abschnitte" im Quellenkasten des Kartendialogs. Die Klickfolge (Task 13) baut auf diesem Schlüssel auf.

**Files:**
- Modify: `js/map-features/path-einschraenkung.js:77-86`
- Create: `js/map-features/__tests__/weg-gruppenschluessel-echter-name.test.js`

**Interfaces:**
- Produces: `avesmapsWegGruppenSchluessel(pfad) -> string`. Liefert `"wiki:<key>"`, sonst `"name:<feature_subtype>:<display_name || original_name || name>"`. Gleich `wpGroupKeyOf(zeile)` für die Editorzeile desselben Abschnitts.

- [ ] **Step 1: Test schreiben**

```js
"use strict";
// Der Gruppenschluessel der Karte bildet denselben Weg wie der Wege-Editor (Entwurf 2026-09-14 §3.2).
// Aus der Wurzel: node js/map-features/__tests__/weg-gruppenschluessel-echter-name.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8").replace(/\r\n/g, "\n");

function schneide(quelle, name) {
	const start = quelle.indexOf("\nfunction " + name + "(");
	assert.ok(start >= 0, name + " nicht gefunden -- umbenannt?");
	const ende = quelle.indexOf("\n}\n", start);
	return quelle.slice(start, ende + 3);
}

// Die Voraussetzung, auf der der Fehler beruht: im Browser ist properties.name der Maschinenname.
assert.ok(/name:\s*`\$\{routeType\}-\$\{pathId\}`/.test(lies("js", "map-features", "map-features-path-prepare.js")),
	"Voraussetzung: normalizeRoutePathFeature schreibt `<Wegart>-<n>` nach properties.name");

const ctx = {};
vm.createContext(ctx);
vm.runInContext(schneide(lies("js", "map-features", "path-einschraenkung.js"), "avesmapsWegGruppenSchluessel"), ctx);
const schluessel = (p) => vm.runInContext("avesmapsWegGruppenSchluessel", ctx)(p);
const model = require(path.join(WURZEL, "js", "pages", "wege-editor-model.js"));

const normalisiert = (maschine) => ({ properties: {
	feature_subtype: "Strasse", name: maschine, display_name: "Alte Straße", original_name: "Alte Straße" } });
const k1 = schluessel(normalisiert("Strasse-17"));
const k2 = schluessel(normalisiert("Strasse-18"));
assert.strictEqual(k1, k2, "zwei Abschnitte derselben unzugewiesenen Strasse bilden EINE Gruppe: " + k1 + " / " + k2);
assert.strictEqual(k1, model.wpGroupKeyOf({ feature_subtype: "Strasse", name: "Alte Straße" }),
	"und dieselbe Gruppe wie im Wege-Editor (paths-editor.php schickt display_name als name)");

assert.strictEqual(schluessel({ properties: { feature_subtype: "Reichsstrasse", name: "Reichsstrasse-3",
	display_name: "Reichsstraße 2", wiki_path: { wiki_key: "reichsstrasse-2" } } }), "wiki:reichsstrasse-2");
assert.strictEqual(schluessel({ properties: { feature_subtype: "Pfad", name: "Goblinpfad" } }), "name:Pfad:Goblinpfad",
	"eine rohe Nutzlast ohne display_name faellt auf name zurueck");

console.log("weg-gruppenschluessel-echter-name.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/map-features/__tests__/weg-gruppenschluessel-echter-name.test.js`
Expected: FAIL mit `zwei Abschnitte derselben unzugewiesenen Strasse bilden EINE Gruppe: name:Strasse:Strasse-17 / name:Strasse:Strasse-18`

- [ ] **Step 3: Umsetzen**

In `js/map-features/path-einschraenkung.js` die Funktion ersetzen:

```js
/** Welche Abschnitte sind DERSELBE Weg? Dieselbe Bauform wie wpGroupWays (wege-editor-model.js). */
function avesmapsWegGruppenSchluessel(pfad) {
	const p = (pfad && pfad.properties) || {};
	const wikiKey = p.wiki_path && p.wiki_path.wiki_key ? String(p.wiki_path.wiki_key).trim() : "";
	if (wikiKey !== "") {
		return "wiki:" + wikiKey;
	}
	// 🔴 Der Name ist kein Schlüssel -- er ist hier nur der Rückfall, exakt wie im Wege-Editor.
	// 💣 UND ES MUSS DER ECHTE NAME SEIN. `properties.name` ist im Browser der MASCHINENNAME:
	// normalizeRoutePathFeature (map-features-path-prepare.js) schreibt `<Wegart>-<n>` hinein und legt
	// den echten nach display_name/original_name. Mit `name` bildete hier jeder unzugewiesene Abschnitt
	// seine eigene Gruppe -- kursive Schrift und „alle N Abschnitte" im Quellenkasten des Kartendialogs
	// griffen nie (gefunden 14.09.2026). paths-editor.php schickt display_name als `name`.
	const echterName = p.display_name || p.original_name || p.name || "";
	return "name:" + String(p.feature_subtype || "") + ":" + String(echterName);
}
```

- [ ] **Step 4: Test laufen lassen, er muss bestehen**

Run: `node js/map-features/__tests__/weg-gruppenschluessel-echter-name.test.js`
Expected: `weg-gruppenschluessel-echter-name.test.js: ok`. Danach `node js/map-features/__tests__/wege-einschraenkung.test.js` und `node js/map-features/__tests__/wege-einschraenkung-anzeige.test.js`; beide müssen weiter grün sein.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "fix(wege): die Karte gruppiert unzugewiesene Wege wieder nach ihrem echten Namen -- kursive Schrift und \"alle N Abschnitte\" im Quellenkasten greifen" "" "avesmapsWegGruppenSchluessel las properties.name, im Browser der Maschinenname." "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §3.2." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/map-features/path-einschraenkung.js js/map-features/__tests__/weg-gruppenschluessel-echter-name.test.js && git commit -F "$SCRATCH/msg.txt"
```

**🚚 Lieferung 1:** Task 1 einzeln live (sichtbar: kursive Namen, Quellenkasten). Owner schaut.

---

## Task 2: Die Liste der weiteren Zuweisungen — reine Helfer (PHP)

**Files:**
- Create: `api/_internal/wiki/path-weitere.php`
- Create: `api/_internal/wiki/__tests__/path-weitere-test.php`

**Interfaces:**
- Produces:
  - `const AVESMAPS_WIKI_PATH_WEITERE_FELD = 'wiki_path_weitere'`
  - `const AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE = 250`
  - `avesmapsWikiPathWeitereLesen(array $properties): list<array{wiki_key:string,name:string,wiki_url:string,art:string,kind:string}>`
  - `avesmapsWikiPathWeitereEintragAusStaging(array $stagingRow): array` (dieselbe Form)
  - `avesmapsWikiPathWeitereHinzufuegen(array $properties, array $eintrag): array{properties:array, geaendert:bool, grund:string}`. `grund` ∈ `''`, `ohne_schluessel`, `ohne_hauptzuweisung`, `ist_hauptzuweisung`, `schon_da`.
  - `avesmapsWikiPathWeitereEntfernen(array $properties, string $wikiKey): array{properties, geaendert, grund}`. `grund` ∈ `''`, `nicht_da`.
  - `avesmapsWikiPathWeitereOhneHaupt(array $properties): array`. Entfernt den Hauptschlüssel aus der Liste.
  - `avesmapsWikiPathWeitereIds(mixed $roh, int $deckel): list<string>`. Wirft `RuntimeException`.

- [ ] **Step 1: Test schreiben**

```php
<?php

declare(strict_types=1);

// Reine Listen-Helfer der weiteren Wiki-Zuweisungen (Entwurf 2026-09-14 §2.1-§2.2).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/path-weitere-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig, sonst prueft assert() nichts\n");
    exit(2);
}

require __DIR__ . '/../path-weitere.php';

$baerenpfad = [
    'wiki_key' => 'b-renpfad',
    'name' => 'Bärenpfad',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad',
    'art' => 'Pilgerweg',
    'kind' => 'strasse',
];
$mitHaupt = ['name' => 'Reichsstraße 2', 'wiki_path' => ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2']];

// Hinzufuegen
$r = avesmapsWikiPathWeitereHinzufuegen($mitHaupt, $baerenpfad);
assert($r['geaendert'] === true && $r['grund'] === '');
assert($r['properties']['wiki_path'] === $mitHaupt['wiki_path'], 'die Hauptzuweisung bleibt unberuehrt');
assert($r['properties']['name'] === 'Reichsstraße 2', 'der Name bleibt unberuehrt (E2)');
assert(avesmapsWikiPathWeitereLesen($r['properties']) === [$baerenpfad]);

assert(avesmapsWikiPathWeitereHinzufuegen($r['properties'], $baerenpfad)['grund'] === 'schon_da');
assert(avesmapsWikiPathWeitereHinzufuegen(['name' => 'Pfad-1'], $baerenpfad)['grund'] === 'ohne_hauptzuweisung');
assert(avesmapsWikiPathWeitereHinzufuegen($mitHaupt, ['wiki_key' => 'reichsstrasse-2'] + $baerenpfad)['grund'] === 'ist_hauptzuweisung');
assert(avesmapsWikiPathWeitereHinzufuegen($mitHaupt, ['wiki_key' => '  '] + $baerenpfad)['grund'] === 'ohne_schluessel');

// Entfernen
$weg = avesmapsWikiPathWeitereEntfernen($r['properties'], 'b-renpfad');
assert($weg['geaendert'] === true);
assert(!array_key_exists('wiki_path_weitere', $weg['properties']), 'eine leere Liste verschwindet ganz');
assert(avesmapsWikiPathWeitereEntfernen($mitHaupt, 'b-renpfad')['grund'] === 'nicht_da');

// Neue Hauptzuweisung, die schon als weitere dastand: sie verschwindet aus der Liste
$umgehaengt = $r['properties'];
$umgehaengt['wiki_path'] = ['wiki_key' => 'b-renpfad', 'name' => 'Bärenpfad'];
assert(!array_key_exists('wiki_path_weitere', avesmapsWikiPathWeitereOhneHaupt($umgehaengt)));
assert(avesmapsWikiPathWeitereOhneHaupt($r['properties']) === $r['properties'], 'ohne Ueberschneidung unveraendert');

// Lesen raeumt kaputte Eintraege und Dubletten weg
$kaputt = ['wiki_path_weitere' => ['x', ['wiki_key' => ''], ['wiki_key' => 'a', 'name' => 'A'], ['wiki_key' => 'a', 'name' => 'zweimal']]];
$gelesen = avesmapsWikiPathWeitereLesen($kaputt);
assert(count($gelesen) === 1 && $gelesen[0]['name'] === 'A');
assert(avesmapsWikiPathWeitereLesen(['wiki_path_weitere' => 'kein array']) === []);

// Kennungen
assert(avesmapsWikiPathWeitereIds(['a', ' a ', 'b', ''], 250) === ['a', 'b']);
$zuViele = array_map(static fn(int $i): string => 'id' . $i, range(1, 251));
foreach ([null, [], 'a', $zuViele] as $falsch) {
    $geworfen = false;
    try {
        avesmapsWikiPathWeitereIds($falsch, 250);
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen, 'ungueltige public_ids muessen abgelehnt werden: ' . json_encode($falsch === $zuViele ? 'zu viele' : $falsch));
}

// Der Deckel ist derselbe wie der der Weg-Ebene
$features = (string) file_get_contents(__DIR__ . '/../../map/features.php');
assert(preg_match('/const AVESMAPS_PATH_GROUP_MAX_SEGMENTS = (\d+);/', $features, $treffer) === 1);
assert((int) $treffer[1] === AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE, 'Deckel weicht von AVESMAPS_PATH_GROUP_MAX_SEGMENTS ab');

echo "path-weitere-test.php: ok\n";
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/path-weitere-test.php`
Expected: FAIL, `Failed opening required '.../path-weitere.php'`

- [ ] **Step 3: Umsetzen**

`api/_internal/wiki/path-weitere.php`:

```php
<?php

declare(strict_types=1);

// Weitere Wiki-Zuweisungen eines Wegabschnitts.
// Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.
//
// 🔴 `properties.wiki_path` BLEIBT DIE IDENTITAET (Name R1, Gruppe, Verlauf-Abgleich, Kanon).
// `properties.wiki_path_weitere` traegt zusaetzliche Artikel -- ein Pilgerweg ueber eine
// Reichsstrasse, eine Karawanenroute auf dem Stamm einer anderen. Eine weitere Zuweisung aendert
// nie Name, Gruppe oder Art (Owner 14.09.2026: „der wegname bleibt").
// 💣 WARUM KEIN ARRAY AUS wiki_path SELBST: rund 45 Leser greifen auf wiki_path.wiki_key/.name/
// .wiki_url zu; ein Array liesse jeden still `undefined` lesen, und die Wege saehen unzugewiesen aus.
//
// Die Helfer oben sind rein (kein PDO); der Schreibweg unten nutzt Helfer aus sync.php,
// locations-helpers.php und paths.php NUR im Funktionsrumpf -- der Endpunkt laedt sie vorher.

const AVESMAPS_WIKI_PATH_WEITERE_FELD = 'wiki_path_weitere';
// Gleich AVESMAPS_PATH_GROUP_MAX_SEGMENTS (api/_internal/map/features.php) -- der Test haelt beide gleich.
const AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE = 250;

/** Die Liste, bereinigt: nur Eintraege mit Schluessel, jeder Schluessel einmal, feste Felder. */
function avesmapsWikiPathWeitereLesen(array $properties): array {
    $roh = $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] ?? null;
    if (!is_array($roh)) {
        return [];
    }
    $liste = [];
    $gesehen = [];
    foreach ($roh as $eintrag) {
        if (!is_array($eintrag)) {
            continue;
        }
        $key = trim((string) ($eintrag['wiki_key'] ?? ''));
        if ($key === '' || isset($gesehen[$key])) {
            continue;
        }
        $gesehen[$key] = true;
        $liste[] = [
            'wiki_key' => $key,
            'name' => (string) ($eintrag['name'] ?? ''),
            'wiki_url' => (string) ($eintrag['wiki_url'] ?? ''),
            'art' => (string) ($eintrag['art'] ?? ''),
            'kind' => (string) ($eintrag['kind'] ?? ''),
        ];
    }
    return $liste;
}

/** Ein Eintrag aus einer Zeile von wiki_path_staging. Bewusst schlank: kein Verlauf, keine Beschreibung. */
function avesmapsWikiPathWeitereEintragAusStaging(array $stagingRow): array {
    return [
        'wiki_key' => trim((string) ($stagingRow['wiki_key'] ?? '')),
        'name' => trim((string) ($stagingRow['name'] ?? '')),
        'wiki_url' => trim((string) ($stagingRow['wiki_url'] ?? '')),
        'art' => trim((string) ($stagingRow['art'] ?? '')),
        'kind' => trim((string) ($stagingRow['kind'] ?? '')),
    ];
}

function avesmapsWikiPathWeitereHauptKey(array $properties): string {
    return is_array($properties['wiki_path'] ?? null) ? trim((string) ($properties['wiki_path']['wiki_key'] ?? '')) : '';
}

/** @return array{properties: array, geaendert: bool, grund: string} */
function avesmapsWikiPathWeitereHinzufuegen(array $properties, array $eintrag): array {
    $unveraendert = static fn(string $grund): array => ['properties' => $properties, 'geaendert' => false, 'grund' => $grund];
    $key = trim((string) ($eintrag['wiki_key'] ?? ''));
    if ($key === '') {
        return $unveraendert('ohne_schluessel');
    }
    // Entwurf §2.2 Nr. 1: eine weitere Zuweisung setzt eine Hauptzuweisung voraus.
    $hauptKey = avesmapsWikiPathWeitereHauptKey($properties);
    if ($hauptKey === '') {
        return $unveraendert('ohne_hauptzuweisung');
    }
    if ($key === $hauptKey) {
        return $unveraendert('ist_hauptzuweisung');
    }
    $liste = avesmapsWikiPathWeitereLesen($properties);
    foreach ($liste as $vorhanden) {
        if ($vorhanden['wiki_key'] === $key) {
            return $unveraendert('schon_da');
        }
    }
    $liste[] = avesmapsWikiPathWeitereLesen([AVESMAPS_WIKI_PATH_WEITERE_FELD => [$eintrag]])[0];
    $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] = $liste;
    return ['properties' => $properties, 'geaendert' => true, 'grund' => ''];
}

/** @return array{properties: array, geaendert: bool, grund: string} */
function avesmapsWikiPathWeitereEntfernen(array $properties, string $wikiKey): array {
    $key = trim($wikiKey);
    $liste = avesmapsWikiPathWeitereLesen($properties);
    $rest = array_values(array_filter($liste, static fn(array $e): bool => $e['wiki_key'] !== $key));
    if (count($rest) === count($liste)) {
        return ['properties' => $properties, 'geaendert' => false, 'grund' => 'nicht_da'];
    }
    if ($rest === []) {
        unset($properties[AVESMAPS_WIKI_PATH_WEITERE_FELD]);
    } else {
        $properties[AVESMAPS_WIKI_PATH_WEITERE_FELD] = $rest;
    }
    return ['properties' => $properties, 'geaendert' => true, 'grund' => ''];
}

/**
 * Wird ein Artikel zur HAUPTzuweisung, der schon als weitere dastand, faellt er aus der Liste --
 * sonst trueg der Abschnitt denselben Artikel in zwei Rollen. Gerufen von den assign-Schreibern.
 */
function avesmapsWikiPathWeitereOhneHaupt(array $properties): array {
    $hauptKey = avesmapsWikiPathWeitereHauptKey($properties);
    if ($hauptKey === '' || !array_key_exists(AVESMAPS_WIKI_PATH_WEITERE_FELD, $properties)) {
        return $properties;
    }
    $liste = avesmapsWikiPathWeitereLesen($properties);
    if (!in_array($hauptKey, array_column($liste, 'wiki_key'), true)) {
        return $properties;
    }
    return avesmapsWikiPathWeitereEntfernen($properties, $hauptKey)['properties'];
}

/** Die Kennungen aus dem Rumpf: Liste, getrimmt, ohne Dubletten, nicht leer, hoechstens $deckel. */
function avesmapsWikiPathWeitereIds(mixed $roh, int $deckel): array {
    if (!is_array($roh)) {
        throw new RuntimeException('public_ids must be a list.');
    }
    $ids = [];
    foreach ($roh as $wert) {
        $id = is_scalar($wert) ? trim((string) $wert) : '';
        if ($id !== '' && !in_array($id, $ids, true)) {
            $ids[] = $id;
        }
    }
    if ($ids === []) {
        throw new RuntimeException('public_ids is empty.');
    }
    if (count($ids) > $deckel) {
        throw new RuntimeException('At most ' . $deckel . ' segments per request.');
    }
    return $ids;
}
```

- [ ] **Step 4: Test laufen lassen, er muss bestehen**

Run: `php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/path-weitere-test.php`
Expected: `path-weitere-test.php: ok`

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(wege): Listen-Helfer fuer weitere Wiki-Zuweisungen eines Abschnitts (noch ohne Schreibweg)" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/_internal/wiki/path-weitere.php api/_internal/wiki/__tests__/path-weitere-test.php && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 3: Schreibweg `add_weitere` / `remove_weitere`

**Files:**
- Modify: `api/_internal/wiki/path-weitere.php` (Funktion anhängen)
- Modify: `api/edit/wiki/paths.php:14-17` (require), `:48-187` (match-Arm), `:190` (Revisionsliste)
- Create: `api/_internal/wiki/__tests__/path-weitere-schreiben-test.php`

**Interfaces:**
- Consumes: Task 2; `AVESMAPS_WIKI_PATH_STAGING_TABLE` (`api/_internal/wiki/paths.php:22`); `avesmapsWikiSyncDecodeJson`, `avesmapsWikiSyncEncodeJson` (sync.php); `avesmapsWikiSyncNextMapRevision(PDO): int`, `avesmapsWikiSyncFetchAuditRow(PDO, int): array`, `avesmapsWikiSyncAuditFeaturePropsChange(PDO, array $before, array $newProps, int $revision, int $userId, ?string $newName = null): void` (locations-helpers.php)
- Produces: `avesmapsWikiPathWeitereSchreiben(PDO $pdo, string $modus, string $wikiKey, mixed $publicIdsRoh, bool $dryRun, int $userId): array`, `$modus` ∈ `add`, `remove`. Antwort: `{ok:true, dry_run:bool, action:'add_weitere'|'remove_weitere', wiki_key, applied:int, skipped:list<{public_id, grund}>, segments_updated:list<{public_id, wiki_path_weitere}>}`. HTTP: `POST /api/edit/wiki/paths.php` mit `{action, wiki_key, public_ids, dry_run:false, confirm:"apply"}`, Fähigkeit `review` (wie der ganze Endpunkt).

- [ ] **Step 1: Test schreiben**

```php
<?php

declare(strict_types=1);

// Der Schreibweg der weiteren Wiki-Zuweisungen gegen SQLite (Entwurf 2026-09-14 §2.3).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/path-weitere-schreiben-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require_once __DIR__ . '/../paths.php';
require_once __DIR__ . '/../path-weitere.php';

// Dieselbe Uebersetzung MySQL -> SQLite wie api/_internal/wiki/__tests__/wikisync-fall-no-article-test.php.
final class AvesmapsWeitereTestPdo extends PDO {
    public function prepare(string $query, array $options = []): PDOStatement|false {
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);
        return parent::prepare($query, $options);
    }
    public function exec(string $statement): int|false {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }
        return parent::exec($statement);
    }
}

$pdo = new AvesmapsWeitereTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT NULL)');
$pdo->exec('CREATE TABLE wiki_path_staging (id INTEGER PRIMARY KEY AUTOINCREMENT, wiki_key TEXT, name TEXT, kind TEXT, art TEXT, wiki_url TEXT)');
$pdo->exec("INSERT INTO wiki_path_staging (wiki_key, name, kind, art, wiki_url)
            VALUES ('b-renpfad', 'Bärenpfad', 'strasse', 'Pilgerweg', 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad')");

$weg = static function (string $publicId, array $properties) use ($pdo): void {
    $st = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
                         VALUES (:id, :name, 'path', 'Reichsstrasse', 'LineString', '{}', :p)");
    $st->execute(['id' => $publicId, 'name' => (string) ($properties['name'] ?? ''), 'p' => json_encode($properties, JSON_UNESCAPED_UNICODE)]);
};
$props = static function (string $publicId) use ($pdo): array {
    $st = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :id');
    $st->execute(['id' => $publicId]);
    return json_decode((string) $st->fetchColumn(), true);
};
$audits = static fn(): int => (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn();

$haupt = ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2'];
$weg('rs-6', ['name' => 'Reichsstraße 2', 'wiki_path' => $haupt]);
$weg('rs-7', ['name' => 'Reichsstraße 2', 'wiki_path' => $haupt]);
$weg('ohne', ['name' => 'Strasse-9']);
$weg('bp-1', ['name' => 'Bärenpfad', 'wiki_path' => ['wiki_key' => 'b-renpfad', 'name' => 'Bärenpfad']]);

// 1. Trockenlauf schreibt nichts
$trocken = avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'b-renpfad', ['rs-7'], true, 1);
assert($trocken['dry_run'] === true && $trocken['applied'] === 1);
assert(!array_key_exists('wiki_path_weitere', $props('rs-7')), 'ein Trockenlauf schreibt nichts');
assert($audits() === 0);

// 2. Scharf: rs-6 und rs-7 bekommen ihn; ohne Hauptzuweisung und der Artikel selbst werden uebersprungen
$echt = avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'b-renpfad', ['rs-6', 'rs-7', 'ohne', 'bp-1', 'gibt-es-nicht'], false, 1);
assert($echt['ok'] === true && $echt['dry_run'] === false && $echt['action'] === 'add_weitere');
assert($echt['applied'] === 2, 'zwei Abschnitte geschrieben: ' . json_encode($echt));
$gruende = array_column($echt['skipped'], 'grund', 'public_id');
assert($gruende === ['ohne' => 'ohne_hauptzuweisung', 'bp-1' => 'ist_hauptzuweisung', 'gibt-es-nicht' => 'nicht_gefunden']);
assert($props('rs-7')['wiki_path'] === $haupt, 'die Hauptzuweisung bleibt');
assert($props('rs-7')['name'] === 'Reichsstraße 2', 'der Name bleibt');
assert($props('rs-7')['wiki_path_weitere'][0]['name'] === 'Bärenpfad');
assert($audits() === 2, 'ein Protokolleintrag je geschriebenem Abschnitt');
assert(array_column($echt['segments_updated'], 'public_id') === ['rs-6', 'rs-7']);

// 3. Wiederholt: nichts mehr zu tun, kein weiterer Protokolleintrag
$nochmal = avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'b-renpfad', ['rs-6', 'rs-7'], false, 1);
assert($nochmal['applied'] === 0 && $audits() === 2);

// 4. Entfernen von einem Abschnitt
$entfernt = avesmapsWikiPathWeitereSchreiben($pdo, 'remove', 'b-renpfad', ['rs-7'], false, 1);
assert($entfernt['applied'] === 1 && $entfernt['action'] === 'remove_weitere');
assert(!array_key_exists('wiki_path_weitere', $props('rs-7')));
assert(count($props('rs-6')['wiki_path_weitere']) === 1, 'rs-6 behaelt ihn');

// 5. Ungueltiges
foreach ([
    static fn() => avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'gibt-es-nicht', ['rs-6'], false, 1),
    static fn() => avesmapsWikiPathWeitereSchreiben($pdo, 'add', '', ['rs-6'], false, 1),
    static fn() => avesmapsWikiPathWeitereSchreiben($pdo, 'add', 'b-renpfad', [], false, 1),
] as $aufruf) {
    $geworfen = false;
    try {
        $aufruf();
    } catch (RuntimeException) {
        $geworfen = true;
    }
    assert($geworfen);
}

// 6. Verdrahtung des Endpunkts (Kommentare per Tokenizer entfernt, nicht per Regex)
$quelle = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../../../edit/wiki/paths.php')) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $quelle .= is_array($token) ? $token[1] : $token;
}
assert(str_contains($quelle, "require_once __DIR__ . '/../../_internal/wiki/path-weitere.php';"));
assert(preg_match("/'add_weitere',\s*'remove_weitere'\s*=>\s*avesmapsWikiPathWeitereSchreiben\(/", $quelle) === 1);
assert(preg_match("/in_array\(\\\$action, \[[^\]]*'add_weitere'[^\]]*'remove_weitere'/", $quelle) === 1,
    'beide Aktionen stehen in der Liste, die map_revision hebt');

echo "path-weitere-schreiben-test.php: ok\n";
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/path-weitere-schreiben-test.php`
Expected: FAIL, `Call to undefined function avesmapsWikiPathWeitereSchreiben()`. Scheitert der Test vorher schon am `require` von `paths.php` oder `locations.php` wegen eines fehlenden Helfers, dann das Muster aus `wikisync-fall-no-article-test.php` Zeile 45-50 übernehmen (dort steht zusätzlich `require __DIR__ . '/../../map/features.php';`).

- [ ] **Step 3: Umsetzen, Schreibfunktion**

An `api/_internal/wiki/path-weitere.php` anhängen:

```php
/**
 * Weitere Zuweisung an Abschnitte haengen oder von ihnen nehmen (Entwurf §2.3).
 *
 * 🔴 DIE ABSCHNITTE NENNT DER CLIENT; hier wird keine Gruppe nachgebildet (dieselbe Regel wie
 * update_path_group_details -- eine zweite Fassung liefe beim ersten geaenderten Namen auseinander).
 * Geschrieben wird nur an Abschnitten, deren Liste sich wirklich aendert; je Abschnitt EIN Eintrag
 * im Aenderungsprotokoll (das Rueckgaengig arbeitet je Feature).
 * 💣 KEIN DDL HIER: die Funktion laeuft in einer Transaktion, und DDL committet in MySQL implizit.
 */
function avesmapsWikiPathWeitereSchreiben(PDO $pdo, string $modus, string $wikiKey, mixed $publicIdsRoh, bool $dryRun, int $userId): array {
    if ($modus !== 'add' && $modus !== 'remove') {
        throw new RuntimeException('Unknown mode.');
    }
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        throw new RuntimeException('wiki_key is required.');
    }
    $ids = avesmapsWikiPathWeitereIds($publicIdsRoh, AVESMAPS_WIKI_PATH_WEITERE_MAX_SEGMENTE);

    $eintrag = null;
    if ($modus === 'add') {
        // Nur Artikel aus dem Wege-Katalog (§2.2 Nr. 3): wiki_path_staging haelt ausschliesslich Wege.
        $statement = $pdo->prepare('SELECT * FROM ' . AVESMAPS_WIKI_PATH_STAGING_TABLE . ' WHERE wiki_key = :k LIMIT 1');
        $statement->execute(['k' => $wikiKey]);
        $stagingRow = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$stagingRow) {
            throw new RuntimeException('Wiki-Weg nicht im Staging: ' . $wikiKey);
        }
        $eintrag = avesmapsWikiPathWeitereEintragAusStaging($stagingRow);
    }

    $platzhalter = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT id, public_id, name, properties_json FROM map_features
          WHERE feature_type = 'path' AND is_active = 1 AND public_id IN ($platzhalter)"
    );
    $statement->execute($ids);
    $zeilen = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $zeilen[(string) $zeile['public_id']] = $zeile;
    }

    $skipped = [];
    $plan = [];
    foreach ($ids as $publicId) {
        if (!isset($zeilen[$publicId])) {
            $skipped[] = ['public_id' => $publicId, 'grund' => 'nicht_gefunden'];
            continue;
        }
        $properties = avesmapsWikiSyncDecodeJson($zeilen[$publicId]['properties_json'] ?? null);
        $ergebnis = $modus === 'add'
            ? avesmapsWikiPathWeitereHinzufuegen($properties, $eintrag)
            : avesmapsWikiPathWeitereEntfernen($properties, $wikiKey);
        if (!$ergebnis['geaendert']) {
            $skipped[] = ['public_id' => $publicId, 'grund' => $ergebnis['grund']];
            continue;
        }
        $plan[] = ['zeile' => $zeilen[$publicId], 'properties' => $ergebnis['properties']];
    }

    $antwort = [
        'ok' => true,
        'dry_run' => $dryRun,
        'action' => $modus === 'add' ? 'add_weitere' : 'remove_weitere',
        'wiki_key' => $wikiKey,
        'applied' => count($plan),
        'skipped' => $skipped,
        'segments_updated' => [],
    ];
    if ($dryRun || $plan === []) {
        return $antwort;
    }

    $revision = avesmapsWikiSyncNextMapRevision($pdo);
    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare('UPDATE map_features SET properties_json = :pj, revision = :rev WHERE id = :id');
        foreach ($plan as $schritt) {
            $featureId = (int) $schritt['zeile']['id'];
            $vorher = avesmapsWikiSyncFetchAuditRow($pdo, $featureId);
            $update->execute([
                'pj' => avesmapsWikiSyncEncodeJson($schritt['properties']),
                'rev' => $revision,
                'id' => $featureId,
            ]);
            avesmapsWikiSyncAuditFeaturePropsChange($pdo, $vorher, $schritt['properties'], $revision, $userId);
            $antwort['segments_updated'][] = [
                'public_id' => (string) $schritt['zeile']['public_id'],
                'wiki_path_weitere' => avesmapsWikiPathWeitereLesen($schritt['properties']),
            ];
        }
        $pdo->commit();
    } catch (Throwable $fehler) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $fehler;
    }

    return $antwort;
}
```

- [ ] **Step 4: Umsetzen, Endpunkt**

In `api/edit/wiki/paths.php`:

1. Nach `require_once __DIR__ . '/../../_internal/wiki/path-outliers.php';` einfügen:

```php
require_once __DIR__ . '/../../_internal/wiki/path-weitere.php';
```

2. Im POST-`match ($action)` direkt vor `default => null,` einfügen:

```php
            // Weitere Wiki-Zuweisungen (Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.3):
            // die Hauptzuweisung bleibt unberuehrt, der Name auch. Die Abschnitte nennt der Client.
            'add_weitere', 'remove_weitere' => avesmapsWikiPathWeitereSchreiben(
                $pdo,
                $action === 'add_weitere' ? 'add' : 'remove',
                (string) ($payload['wiki_key'] ?? ''),
                $payload['public_ids'] ?? null,
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                (int) ($user['id'] ?? 0)
            ),
```

3. In der Revisionsliste (`if (in_array($action, ['assign', 'clear_assign', …`) `'add_weitere', 'remove_weitere'` hinter `'set_flow'` ergänzen.

- [ ] **Step 5: Test laufen lassen, er muss bestehen**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/path-weitere-schreiben-test.php` und `php -l api/edit/wiki/paths.php`
Expected: `path-weitere-schreiben-test.php: ok` und `No syntax errors detected`.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "feat(wege): Schreibweg add_weitere/remove_weitere -- ein Abschnitt kann weitere Wiki-Artikel tragen, Name und Hauptzuweisung bleiben" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.3." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/_internal/wiki/path-weitere.php api/_internal/wiki/__tests__/path-weitere-schreiben-test.php api/edit/wiki/paths.php && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 4: Die bestehenden Zuweiser erhalten die Liste

Alle Schreiber von `wiki_path` dekodieren, ändern und kodieren; die Liste überlebt sie also schon. Zwei Dinge fehlen noch:
- Eine neue Hauptzuweisung, die schon als weitere dastand, muss aus der Liste fallen.
- Ein Test muss das Erhalten festhalten, damit ein künftiger Umbau, der `properties` neu zusammensetzt, auffällt.

Entwurf §2.2 Nr. 5 und 6.

**Files:**
- Modify: `api/_internal/wiki/paths.php:16-20` (require), nach `:949`, `:1063`, `:1148` (je eine Zeile)
- Create: `api/_internal/wiki/__tests__/path-weitere-erhalten-test.php`

**Interfaces:**
- Consumes: `avesmapsWikiPathWeitereOhneHaupt` (Task 2); `avesmapsWikiPathAssignTo(PDO, string $wikiKey, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false, array $assignMeta = [])`, `avesmapsWikiPathClearAssign(PDO, string $publicId, bool $dryRun, int $userId = 0, bool $singleSegment = false)`
- Produces: nichts Neues; Verhalten: Zuweisen und Lösen erhalten `wiki_path_weitere`, Zuweisen entfernt den neuen Hauptschlüssel daraus.

- [ ] **Step 1: Test schreiben**

```php
<?php

declare(strict_types=1);

// Die bestehenden Zuweiser erhalten die weiteren Zuweisungen (Entwurf 2026-09-14 §2.2 Nr. 5, 6).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/path-weitere-erhalten-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require_once __DIR__ . '/../paths.php';

// MySQL -> SQLite. Zusaetzlich zum Muster aus wikisync-fall-no-article-test.php:
// avesmapsWikiPathEnsureTables fuehrt MySQL-DDL und zwei information_schema-Proben aus. Die Tabellen
// legt dieser Test selbst an; die DDL wird verschluckt, die Probe antwortet mit einer Zeile
// (dann laeuft kein ALTER).
final class AvesmapsWeitereErhaltenPdo extends PDO {
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

$pdo = new AvesmapsWeitereErhaltenPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
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
            VALUES ('b-renpfad', 'Bärenpfad', 'strasse', 'Pilgerweg', 'https://de.wiki-aventurica.de/wiki/B%C3%A4renpfad', '')");

$pdo->exec("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json)
            VALUES ('rs-7', 'Reichsstraße 2', 'path', 'Reichsstrasse', 'LineString', '{}',
            '" . json_encode([
                'name' => 'Reichsstraße 2',
                'wiki_path' => ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2'],
                'wiki_path_weitere' => [
                    ['wiki_key' => 'b-renpfad', 'name' => 'Bärenpfad', 'wiki_url' => '', 'art' => 'Pilgerweg', 'kind' => 'strasse'],
                    ['wiki_key' => 'geronsgang', 'name' => 'Geronsgang', 'wiki_url' => '', 'art' => 'Pilgerweg', 'kind' => 'strasse'],
                ],
            ], JSON_UNESCAPED_UNICODE) . "')");
$props = static function () use ($pdo): array {
    return json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id = 'rs-7'")->fetchColumn(), true);
};

// 1. Loesen: die Hauptzuweisung geht, die weiteren bleiben (§2.2 Nr. 5)
avesmapsWikiPathClearAssign($pdo, 'rs-7', false, 1, true);
assert(!array_key_exists('wiki_path', $props()), 'die Hauptzuweisung ist geloest');
assert(array_column($props()['wiki_path_weitere'], 'wiki_key') === ['b-renpfad', 'geronsgang'], 'die weiteren bleiben stehen');

// 2. Zuweisen eines Artikels, der schon als weitere dastand: er faellt aus der Liste, der Rest bleibt
avesmapsWikiPathAssignTo($pdo, 'b-renpfad', 'rs-7', false, 1, true);
assert(($props()['wiki_path']['wiki_key'] ?? '') === 'b-renpfad');
assert(array_column($props()['wiki_path_weitere'], 'wiki_key') === ['geronsgang'],
    'der neue Hauptartikel steht nicht zugleich als weitere da: ' . json_encode($props()['wiki_path_weitere'] ?? null));

// 3. Jeder Zuweiser in paths.php ruft den Riegel (Tokenizer, Kommentare zaehlen nicht)
$quelle = '';
foreach (token_get_all((string) file_get_contents(__DIR__ . '/../paths.php')) as $token) {
    if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
        continue;
    }
    $quelle .= is_array($token) ? $token[1] : $token;
}
$zuweiser = preg_match_all("/\\\$props\['wiki_path'\]\s*=\s*[^;]+;/", $quelle);
$riegel = substr_count($quelle, '$props = avesmapsWikiPathWeitereOhneHaupt($props);');
assert($zuweiser >= 3, 'die Zaehlung findet die Zuweiser nicht mehr');
assert($riegel === $zuweiser, "jeder Zuweiser braucht den Riegel: $zuweiser Zuweiser, $riegel Riegel");
assert(str_contains($quelle, "require_once __DIR__ . '/path-weitere.php';"));

echo "path-weitere-erhalten-test.php: ok\n";
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/path-weitere-erhalten-test.php`
Expected: FAIL bei Zusicherung 2 (`der neue Hauptartikel steht nicht zugleich als weitere da`).
⚠️ Scheitert der Test schon bei 1 an einer SQL-Form, die SQLite nicht kennt, wird **nur** die Test-PDO ergänzt (eine weitere `str_replace`-Zeile mit Kommentar, welche MySQL-Form sie übersetzt), **nie** die Produktions-SQL.

- [ ] **Step 3: Umsetzen**

In `api/_internal/wiki/paths.php`:

1. Nach `require_once __DIR__ . '/watercourse-landform.php';` einfügen:

```php
// Weitere Wiki-Zuweisungen (Entwurf 2026-09-14): jeder Zuweiser raeumt den neuen Hauptartikel aus der Liste.
require_once __DIR__ . '/path-weitere.php';
```

2. Direkt nach jeder der drei Zeilen `$props['wiki_path'] = $assignObject;` (in `avesmapsWikiPathAssign` und `avesmapsWikiPathAssignTo`) und `$props['wiki_path'] = $byKey[$key];` (in `avesmapsWikiPathAssignAll`) einfügen:

```php
            // Entwurf 2026-09-14 §2.2: stand der neue Hauptartikel schon als WEITERE Zuweisung da,
            // faellt er dort heraus -- sonst traege der Abschnitt denselben Artikel in zwei Rollen.
            $props = avesmapsWikiPathWeitereOhneHaupt($props);
```

- [ ] **Step 4: Tests laufen lassen**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll -d extension=php_mbstring.dll api/_internal/wiki/__tests__/path-weitere-erhalten-test.php`, danach `php tools/paths/test-path-wiki-grouping.php` und `php tools/paths/test-path-wiki-naming.php`
Expected: `path-weitere-erhalten-test.php: ok`; die beiden Werkzeugtests grün.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "fix(wege): Zuweisen und Loesen erhalten die weiteren Wiki-Zuweisungen, ein neuer Hauptartikel faellt aus der Liste" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.2." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/_internal/wiki/paths.php api/_internal/wiki/__tests__/path-weitere-erhalten-test.php && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 5: Der Verlauf-Abgleich meldet eine weitere Zuweisung nicht als fremd

Heute markiert der Abgleich einen Abschnitt, der einem anderen Artikel gehört, als Konflikt `foreign`. Trägt der Abschnitt den abgeglichenen Artikel als **weitere** Zuweisung, gehört er dazu. Er wird aber weder hinzugefügt (das nähme der Straße die Identität) noch in `keeps` geführt. `avesmapsWikiPathVerlaufRestampKeeps` schreibt nämlich den `wiki_path` des Falls auf jeden `keep` und würde die Hauptzuweisung überschreiben.

**Files:**
- Modify: `api/_internal/wiki/path-verlauf.php:481-524` (`avesmapsWikiPathVerlaufReadAssignments`), `:641-655` (`$flags`), `:825` (vor der Fremdprüfung)
- Modify: `tools/paths/test-path-verlauf-engine.php` (nach dem Block `// foreign add => conflict + gap`)
- Create: `api/_internal/wiki/__tests__/path-weitere-verlauf-test.php`

**Interfaces:**
- Produces: `byPublicId[public_id]` trägt zusätzlich `'weitere' => list<string>` (Schlüssel). Der Fall trägt `flags.weitere: list<string>` (public_ids, reine Info, zählt nicht für `clean`).

- [ ] **Step 1: Tests schreiben**

In `tools/paths/test-path-verlauf-engine.php` direkt nach der Zeile `check('foreign not added', …);` einfügen:

```php
// weitere Zuweisung: der Abschnitt traegt w1 zusaetzlich -- kein Fremdkonflikt, nicht hinzugefuegt,
// NICHT in keeps (RestampKeeps schriebe sonst w1 als Hauptzuweisung darauf). Entwurf 2026-09-14 §2.4.
$assignmentsW = $assignments;
$assignmentsW['byPublicId']['s2'] = ['wiki_key' => 'OTHER', 'name' => 'Fremdweg', 'source' => 'editor', 'weitere' => ['w1']];
$case = avesmapsWikiPathVerlaufComputeCase($staging, $assignmentsW, $lookup, $router);
check('weitere: kein foreign-Konflikt', array_column($case['flags']['conflicts'], 'public_id'), []);
check('weitere: nicht hinzugefuegt', in_array('s2', array_column($case['adds'], 'public_id'), true), false);
check('weitere: nicht in keeps', in_array('s2', array_column($case['keeps'], 'public_id'), true), false);
check('weitere: als Info vermerkt', $case['flags']['weitere'], ['s2']);
check('weitere: der Fall bleibt sauber', $case['clean'], true);
```

`api/_internal/wiki/__tests__/path-weitere-verlauf-test.php`:

```php
<?php

declare(strict_types=1);

// avesmapsWikiPathVerlaufReadAssignments liest die weiteren Zuweisungen mit (Entwurf 2026-09-14 §2.4).
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/path-weitere-verlauf-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../path-verlauf.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, name TEXT, feature_type TEXT,
    feature_subtype TEXT, properties_json TEXT, is_active INTEGER DEFAULT 1)');
$st = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, properties_json) VALUES (:id, :n, 'path', 'Reichsstrasse', :p)");
$st->execute(['id' => 'rs-7', 'n' => 'Reichsstraße 2', 'p' => json_encode([
    'wiki_path' => ['wiki_key' => 'reichsstrasse-2'],
    'wiki_path_weitere' => [['wiki_key' => 'b-renpfad'], ['wiki_key' => ''], 'kaputt'],
])]);
$st->execute(['id' => 'rs-6', 'n' => 'Reichsstraße 2', 'p' => json_encode(['wiki_path' => ['wiki_key' => 'reichsstrasse-2']])]);

$gelesen = avesmapsWikiPathVerlaufReadAssignments($pdo);
assert($gelesen['byPublicId']['rs-7']['weitere'] === ['b-renpfad'], json_encode($gelesen['byPublicId']['rs-7']));
assert($gelesen['byPublicId']['rs-6']['weitere'] === [], 'ohne Liste eine leere Liste');
assert(count($gelesen['byWikiKey']['reichsstrasse-2']) === 2, 'die Hauptzuordnung ist unveraendert');
assert(!isset($gelesen['byWikiKey']['b-renpfad']), 'eine weitere Zuweisung macht den Abschnitt NICHT zum Mitglied des Artikels');

echo "path-weitere-verlauf-test.php: ok\n";
```

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `php tools/paths/test-path-verlauf-engine.php` und `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/wiki/__tests__/path-weitere-verlauf-test.php`
Expected:
- Der erste Lauf meldet `FAIL weitere: kein foreign-Konflikt`.
- Der zweite scheitert an `Undefined array key "weitere"`.

- [ ] **Step 3: Umsetzen**

1. In `avesmapsWikiPathVerlaufReadAssignments` den Block `$byPublicId[$publicId] = [ … ];` ersetzen durch:

```php
        // Entwurf 2026-09-14 §2.4: die WEITEREN Zuweisungen reisen mit. Bewusst inline statt ueber
        // path-weitere.php -- diese Datei muss ohne Top-Level-require ladbar bleiben (Engine-Test).
        $weitere = [];
        foreach ((is_array($props['wiki_path_weitere'] ?? null) ? $props['wiki_path_weitere'] : []) as $eintrag) {
            $weitererKey = is_array($eintrag) ? trim((string) ($eintrag['wiki_key'] ?? '')) : '';
            if ($weitererKey !== '' && !in_array($weitererKey, $weitere, true)) {
                $weitere[] = $weitererKey;
            }
        }
        $byPublicId[$publicId] = [
            'wiki_key' => $wikiKey,
            'name' => $name,
            'source' => $source,
            'weitere' => $weitere,
        ];
```

2. Im Array `$flags = [` in `avesmapsWikiPathVerlaufComputeCase` nach `'passage_towns' => [],` ergänzen:

```php
        // Info only (Entwurf 2026-09-14 §2.4): Soll-Abschnitte, die den Artikel als WEITERE Zuweisung
        // tragen. Weder hinzugefuegt noch gehalten; never affects clean.
        'weitere' => [],
```

3. In der Soll-Schleife direkt vor `$foreign = $byPublicId[$publicId] ?? null;` einfügen:

```php
        if (in_array($wikiKey, (array) (($byPublicId[$publicId] ?? [])['weitere'] ?? []), true)) {
            // 🔴 Er gehoert dazu -- aber NICHT in adds (das naehme der Strasse ihre Identitaet) und NICHT
            // in keeps (avesmapsWikiPathVerlaufRestampKeeps schriebe diesen Artikel als wiki_path darauf).
            $flags['weitere'][] = (string) $publicId;
            continue;
        }
```

- [ ] **Step 4: Tests laufen lassen, sie müssen bestehen**

Run: beide Befehle aus Step 2, dazu `php tools/paths/test-path-verlauf-source.php`
Expected:
- keine `FAIL`-Zeile im Engine-Test,
- `path-weitere-verlauf-test.php: ok`,
- der Quelltest grün.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "fix(wege): der Verlauf-Abgleich meldet einen Abschnitt mit weiterer Zuweisung nicht mehr als fremd" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/_internal/wiki/path-verlauf.php tools/paths/test-path-verlauf-engine.php api/_internal/wiki/__tests__/path-weitere-verlauf-test.php && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 6: Wege-Editor-Liste: weitere Zuweisungen sehen und finden, stabile Nummerierung

**Files:**
- Modify: `api/edit/map/paths-editor.php:10` (require), Zeilenarray in `avesmapsPathEditorList` (nach `'wiki_path' => …`)
- Modify: `js/pages/wege-editor-model.js` (`wpGroupWays` Sortierung; neue Funktionen; Exporte)
- Modify: `js/pages/wege-editor.js` (`matchesFilters`, `segmentRow`)
- Modify: `css/pages/wege-editor.css` (eine Regel)
- Create: `js/pages/__tests__/wege-weitere-liste.test.js`

**Interfaces:**
- Consumes: `avesmapsWikiPathWeitereLesen` (Task 2)
- Produces:
  - Listenzeile `way.wiki_path_weitere: Array<{wiki_key, wiki_url, name, art}>`
  - `wpWeitereNamen(way) -> string[]`
  - `wpWegPasstZurSuche(way, query) -> boolean`
  - `wpGroupWays` sortiert nach auf zwei Nachkommastellen gerundetem `bbox[0]`, dann `bbox[1]`, dann `public_id`

Die Sortierung kommt aus der Messung im Entwurf §4: 4 von 477 Straßen kippen sonst durch Rundungsrauschen.

- [ ] **Step 1: Test schreiben**

```js
"use strict";
// Wege-Editor-Liste: weitere Zuweisungen und stabile Nummerierung (Entwurf 2026-09-14 §2.4, §4).
// Aus der Wurzel: node js/pages/__tests__/wege-weitere-liste.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../wege-editor-model.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");

// 1. Sortierung: Rundungsrauschen kippt keinen Gleichstand, die Kennung entscheidet.
const zeile = (id, x, y) => ({ public_id: id, name: "Reichsstraße 2", feature_subtype: "Reichsstrasse", bbox: [x, y, 0, 0] });
const reihenfolge = (ways) => M.wpGroupWays(ways)[0].segments.map((s) => s.public_id);
assert.deepStrictEqual(reihenfolge([zeile("b", 10.0004, 5), zeile("a", 10.0001, 5)]), ["a", "b"]);
assert.deepStrictEqual(reihenfolge([zeile("b", 10.0001, 5), zeile("a", 10.0004, 5)]), ["a", "b"],
	"dieselbe Reihenfolge, egal welcher der beiden Werte minimal groesser ist -- Spalten und Geometrie weichen um <= 0,001 ab");
assert.deepStrictEqual(reihenfolge([zeile("a", 11, 5), zeile("z", 9, 5)]), ["z", "a"], "echte Unterschiede sortieren weiter");
assert.deepStrictEqual(reihenfolge([zeile("a", 9, 7), zeile("z", 9, 5)]), ["z", "a"], "bei gleichem x entscheidet y");

// 2. Weitere Namen und Suche
const way = { name: "Reichsstraße 2", wiki_path_weitere: [{ wiki_key: "b-renpfad", name: "Bärenpfad" }, { wiki_key: "x", name: "" }, null] };
assert.deepStrictEqual(M.wpWeitereNamen(way), ["Bärenpfad", "x"], "ohne Namen der Schluessel, kaputte Eintraege fallen weg");
assert.deepStrictEqual(M.wpWeitereNamen({ name: "Pfad" }), []);
assert.strictEqual(M.wpWegPasstZurSuche(way, "bären"), true, "die Suche findet den Abschnitt ueber den weiteren Namen");
assert.strictEqual(M.wpWegPasstZurSuche(way, "reichs"), true);
assert.strictEqual(M.wpWegPasstZurSuche(way, "geron"), false);
assert.strictEqual(M.wpWegPasstZurSuche(way, ""), true);

// 3. Verdrahtung (Kommentare entfernt, sonst trifft die Suche die Warnung statt des Codes)
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const editor = ohneKommentare(lies("js/pages/wege-editor.js"));
const rumpf = (quelle, kopf) => {
	const start = quelle.indexOf(kopf);
	assert.ok(start >= 0, kopf + " nicht gefunden");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i++) {
		if (quelle[i] === "{") tiefe++;
		if (quelle[i] === "}" && --tiefe === 0) return quelle.slice(start, i + 1);
	}
	throw new Error("Rumpf nicht geschlossen: " + kopf);
};
assert.ok(rumpf(editor, "function matchesFilters(way)").includes("wpWegPasstZurSuche(way, state.query)"), "die Suche nutzt wpWegPasstZurSuche");
assert.ok(rumpf(editor, "function segmentRow(way, index, group)").includes("wpWeitereNamen(way)"), "die Abschnittszeile nennt die weiteren Namen");
const php = lies("api/edit/map/paths-editor.php");
assert.ok(php.includes("require_once __DIR__ . '/../../_internal/wiki/path-weitere.php';"));
assert.ok(/'wiki_path_weitere'\s*=>\s*array_map\(/.test(php), "die Liste schickt wiki_path_weitere mit");

console.log("wege-weitere-liste.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/pages/__tests__/wege-weitere-liste.test.js`
Expected: FAIL beim zweiten Sortierfall (`["b","a"]`) oder mit `M.wpWeitereNamen is not a function`.

- [ ] **Step 3: Umsetzen, Modell**

In `js/pages/wege-editor-model.js` den `groups.forEach(function (group) { group.segments.sort(…) })`-Block in `wpGroupWays` ersetzen durch:

```js
	groups.forEach(function (group) {
		// 🔴 GERUNDET, DANN DIE KENNUNG. Die Karte rechnet die Huellbox aus der Geometrie, der Wege-Editor
		// liest die gespeicherten Spalten; beide stimmen auf 0,001 ueberein (Dump 08.09.2026, alle 6.065
		// Wege), aber 4 von 477 Strassen sortierten trotzdem verschieden, weil Rauschen einen Gleichstand
		// kippt. Entwurf 2026-09-14 §4: dieselbe Nummer muss auf Karte und im Editor denselben Abschnitt meinen.
		group.segments.sort(function (a, b) {
			var ax = wpSortWert(a.bbox ? a.bbox[0] : 0);
			var bx = wpSortWert(b.bbox ? b.bbox[0] : 0);
			if (ax !== bx) { return ax - bx; }
			var ay = wpSortWert(a.bbox ? a.bbox[1] : 0);
			var by = wpSortWert(b.bbox ? b.bbox[1] : 0);
			if (ay !== by) { return ay - by; }
			var pa = String(a.public_id || "");
			var pb = String(b.public_id || "");
			return pa < pb ? -1 : (pa > pb ? 1 : 0);
		});
	});
```

Direkt vor `function wpGroupWays(ways)` einfügen:

```js
/** Sortierwert einer Huellbox-Koordinate: auf zwei Nachkommastellen gerundet (siehe wpGroupWays). */
function wpSortWert(wert) {
	return Math.round((Number(wert) || 0) * 100) / 100;
}

/** Die Namen der weiteren Wiki-Zuweisungen eines Abschnitts (Entwurf 2026-09-14 §2.4). */
function wpWeitereNamen(way) {
	var liste = way && Array.isArray(way.wiki_path_weitere) ? way.wiki_path_weitere : [];
	return liste
		.map(function (eintrag) { return eintrag ? String(eintrag.name || eintrag.wiki_key || "").trim() : ""; })
		.filter(function (name) { return name !== ""; });
}

/** Trifft die Suche des Wege-Editors diesen Abschnitt? Wegname ODER ein weiterer Name. */
function wpWegPasstZurSuche(way, query) {
	var suche = String(query || "").trim().toLowerCase();
	if (suche === "") { return true; }
	if (String((way && way.name) || "").toLowerCase().indexOf(suche) !== -1) { return true; }
	return wpWeitereNamen(way).some(function (name) { return name.toLowerCase().indexOf(suche) !== -1; });
}
```

In `module.exports` ergänzen: `wpSortWert: wpSortWert, wpWeitereNamen: wpWeitereNamen, wpWegPasstZurSuche: wpWegPasstZurSuche,`.

- [ ] **Step 4: Umsetzen, Editor und Liste**

In `js/pages/wege-editor.js`, `matchesFilters(way)`: die Zeile

```js
			if (String(way.name || "").toLowerCase().indexOf(state.query) === -1) { return false; }
```

ersetzen durch

```js
			// Entwurf 2026-09-14 §2.4: auch ueber die Namen der weiteren Wiki-Zuweisungen auffindbar.
			if (!wpWegPasstZurSuche(way, state.query)) { return false; }
```

In `segmentRow(way, index, group)` vor dem `return` einfügen:

```js
		// Entwurf 2026-09-14 §2.4: die weiteren Wiki-Zuweisungen stehen in einer eigenen Zeile. Einsortiert
		// bleibt der Abschnitt unter seiner Hauptzuweisung.
		var weitere = wpWeitereNamen(way);
		var weitereZeile = weitere.length
			? '<div class="avm-row__l2 wp-weitere">Weitere Zuweisungen: <b>' + escapeHtml(weitere.join(", ")) + "</b></div>"
			: "";
```

Im `return` direkt hinter `+ '<div class="avm-row__l2' + tone + '">' + escapeHtml(parts.join(" · ")) + "</div>"` die Zeile `+ weitereZeile` einfügen.

In `css/pages/wege-editor.css` anhängen:

```css
/* Die Zeile „Weitere Zuweisungen" unter einem Abschnitt (Entwurf 2026-09-14 §2.4). Der Name steht in
   Textfarbe, das Etikett bleibt gedaempft wie der Rest von .avm-row__l2. */
.wp-weitere b { font-weight: var(--font-weight-regular); color: var(--color-text); }
```

In `api/edit/map/paths-editor.php`:
- Nach `require_once __DIR__ . '/../../_internal/app/path-landscapes.php';` einfügen: `require_once __DIR__ . '/../../_internal/wiki/path-weitere.php';`
- Im Zeilenarray direkt nach dem `'wiki_path' => $wikiPath === null ? null : [ … ],`-Eintrag einfügen:

```php
            // Entwurf 2026-09-14 §2.4: die weiteren Wiki-Zuweisungen -- dieselbe weisse Liste wie wiki_path.
            'wiki_path_weitere' => array_map(static fn(array $eintrag): array => [
                'wiki_key' => $eintrag['wiki_key'],
                'wiki_url' => $eintrag['wiki_url'],
                'name' => $eintrag['name'],
                'art' => $eintrag['art'],
            ], avesmapsWikiPathWeitereLesen($properties)),
```

- [ ] **Step 5: Tests laufen lassen**

Run:
- `node js/pages/__tests__/wege-weitere-liste.test.js`
- `node js/pages/__tests__/wege-editor-model.test.js`
- `node js/pages/__tests__/wege-gruppe-felder.test.js`
- `node js/pages/__tests__/wege-gruppe-kette.test.js`
- `php -l api/edit/map/paths-editor.php`

Expected: alles grün, `No syntax errors detected`.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "feat(wege-editor): die Abschnittszeile nennt ihre weiteren Wiki-Zuweisungen, die Suche findet sie, die Nummerierung kippt nicht mehr" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.4, §4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/edit/map/paths-editor.php js/pages/wege-editor-model.js js/pages/wege-editor.js css/pages/wege-editor.css js/pages/__tests__/wege-weitere-liste.test.js && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 7: Der Kasten „Weitere Wiki-Zuweisungen" und sein Einbau in den Wege-Editor

**Files:**
- Create: `js/ui/wiki-weitere-kasten.js`
- Create: `css/components/wiki-weitere-kasten.css`
- Create: `js/ui/__tests__/wiki-weitere-kasten.test.js`
- Modify: `css/styles.css:52` (Import), `css/components/editor-page.css:55` (Import)
- Modify: `html/wege-editor.html` (Skript-Tag nach `/js/ui/wiki-assign-weg.js`)
- Modify: `js/pages/wege-editor.js` (`renderDetail` Host nach `wpWikiAssign`, `wireDetail` Mount nach `mountWikiAssign()`, `renderGroupDetail` Host vor dem Quellen-Block, `wireGroupDetail` Mount nach dem Quellen-Mount)

**Interfaces:**
- Consumes: HTTP aus Task 3; `GET /api/edit/wiki/paths.php?action=search&q=…&limit=40` → `{ok, rows:[{wiki_key, name, art, wiki_url, …}]}`; `avesmapsWikiAssignSkin(name)` (`js/ui/wiki-assign.js:345`, im Browser global) mit den Schlüsseln `hinweis`, `link`, `trefferListe`, `treffer`, `trefferName`, `trefferMeta`
- Produces (global und `module.exports`):
  - `avesmapsWikiWeitereZuordnungen(abschnitte, gesamtText) -> Array<{wiki_key, name, wiki_url, publicIds:string[], wo:string}>`
  - `avesmapsWikiWeitereKoerper(modus:"add"|"remove", wikiKey, publicIds) -> Object`
  - `avesmapsWikiWeitereTrefferFiltern(zeilen, hauptKey, vorhandeneKeys) -> Array`
  - `avesmapsWikiWeitereSkin(name) -> Object`
  - `avesmapsWikiWeitereMarkup(modell, skin) -> string`
  - `avesmapsWikiWeitereTrefferMarkup(treffer, skin) -> string`
  - `avesmapsWikiWeitereKastenMount(host, opts) -> {neuZeichnen(), zerstoeren()}`

  `opts` hat die Form `{skin:"dt"|"label-wiki"|Object, hauptKey:()=>string, haupt?:()=>({wiki_key, name, wiki_url})|null, abschnitte:()=>Array<{public_id, label, wiki_path_weitere}>, umfangText:()=>string, gesamtText?:()=>string, geschrieben?:(antwort)=>any, fetchImpl?:fetch}`. Mit `haupt` nennt die Liste die Hauptzuweisung als erste Zeile, ohne ✕ (Entwurf §3.5: rechts „Hauptzuweisung" bzw. „weitere").

- [ ] **Step 1: Test schreiben**

```js
"use strict";
// Der Kasten „Weitere Wiki-Zuweisungen" (Entwurf 2026-09-14 §2.3, §3.5). Die reinen Teile und der
// Schreibablauf werden AUSGEFUEHRT, nicht gelesen.
// Aus der Wurzel: node js/ui/__tests__/wiki-weitere-kasten.test.js
const assert = require("assert");
const K = require("../wiki-weitere-kasten.js");

const SKIN = { titel: "t", hinweis: "h", link: "l", trefferListe: "tl", treffer: "tr", trefferName: "tn", trefferMeta: "tm" };
const bp = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" };
const abschnitte = [
	{ public_id: "rs-6", label: "Abschnitt 6: Ginsterfeld – Silkwiesen", wiki_path_weitere: [] },
	{ public_id: "rs-7", label: "Abschnitt 7: Silkwiesen – Wieha", wiki_path_weitere: [bp] },
];

(async () => {
	// 1. Zuordnungen: eine Teilmenge nennt ihre Abschnitte, alle Abschnitte heissen „ganze Straße"
	const teil = K.avesmapsWikiWeitereZuordnungen(abschnitte, "ganze Straße");
	assert.deepStrictEqual(teil.map((z) => [z.wiki_key, z.wo, z.publicIds]), [["b-renpfad", "Abschnitt 7: Silkwiesen – Wieha", ["rs-7"]]]);
	const alle = K.avesmapsWikiWeitereZuordnungen(abschnitte.map((a) => ({ ...a, wiki_path_weitere: [bp] })), "ganze Straße");
	assert.strictEqual(alle[0].wo, "ganze Straße");
	assert.strictEqual(K.avesmapsWikiWeitereZuordnungen([abschnitte[1]], "ganze Straße")[0].wo, "Abschnitt 7: Silkwiesen – Wieha",
		"ein einzelner Abschnitt heisst nie „ganze Straße"");

	// 2. Rumpf und Filter
	assert.deepStrictEqual(K.avesmapsWikiWeitereKoerper("add", "b-renpfad", ["rs-6"]),
		{ action: "add_weitere", wiki_key: "b-renpfad", public_ids: ["rs-6"], dry_run: false, confirm: "apply" });
	assert.strictEqual(K.avesmapsWikiWeitereKoerper("remove", "b-renpfad", ["rs-7"]).action, "remove_weitere");
	assert.deepStrictEqual(K.avesmapsWikiWeitereTrefferFiltern(
		[{ wiki_key: "reichsstrasse-2" }, { wiki_key: "b-renpfad" }, { wiki_key: "geronsgang" }, null], "reichsstrasse-2", ["b-renpfad"]
	).map((z) => z.wiki_key), ["geronsgang"], "weder die Hauptzuweisung noch vorhandene Artikel werden angeboten");

	// 3. Markup
	const ohneHaupt = K.avesmapsWikiWeitereMarkup({ hauptKey: "", umfang: "diesen Abschnitt", zuordnungen: [] }, SKIN);
	assert.ok(ohneHaupt.includes("Erst eine Wiki-Zuweisung setzen") && !ohneHaupt.includes("data-weitere-suche"),
		"ohne Hauptzuweisung kein Suchfeld (§2.2 Nr. 1)");
	const mit = K.avesmapsWikiWeitereMarkup({ hauptKey: "reichsstrasse-2", umfang: "Abschnitt 7: <b>", zuordnungen: teil }, SKIN);
	assert.ok(mit.includes('data-weitere-weg="b-renpfad"'), "jede Zuordnung hat ihr ✕");
	assert.ok(mit.includes("Weitere Wiki-Zuweisung für Abschnitt 7: &lt;b&gt;"), "der Umfang wird maskiert");
	assert.ok(mit.includes("data-weitere-suche") && mit.includes("ändert den Wegnamen nie"));
	// Entwurf §3.5: die Liste nennt die Hauptzuweisung zuerst (ohne ✕), dann jede weitere mit „weitere" und ✕
	const mitHaupt = K.avesmapsWikiWeitereMarkup({ hauptKey: "reichsstrasse-2", umfang: "die ganze Straße", zuordnungen: teil,
		haupt: { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://x/R" }, hauptWo: "ganze Straße · Perz – Helmdahl" }, SKIN);
	const hauptStelle = mitHaupt.indexOf("Hauptzuweisung");
	assert.ok(hauptStelle > 0 && hauptStelle < mitHaupt.indexOf('data-weitere-weg="b-renpfad"'), "die Hauptzuweisung steht vor den weiteren");
	assert.ok(mitHaupt.includes("ganze Straße · Perz – Helmdahl") && mitHaupt.includes("reichsstrasse-2"));
	assert.ok(!/data-weitere-weg="reichsstrasse-2"/.test(mitHaupt), "die Hauptzuweisung hat kein ✕ -- geloest wird sie im Kasten „Wiki-Weg"");
	assert.ok(/weitere\s*<button[^>]*data-weitere-weg="b-renpfad"/.test(mitHaupt), "eine weitere Zuweisung heisst „weitere"");
	assert.ok(!mit.includes("Hauptzuweisung"), "ohne `haupt` keine Hauptzeile");
	assert.ok(K.avesmapsWikiWeitereTrefferMarkup([{ wiki_key: "geronsgang", name: "Geronsgang", art: "Pilgerweg" }], SKIN)
		.includes('data-weitere-hinzu="geronsgang"'));

	// 4. Ablauf: ✕ nimmt den Artikel von genau den Abschnitten, die ihn tragen; danach meldet der Kasten dem Wirt
	const gesendet = [];
	let geschrieben = null;
	const stuecke = new Map();
	const host = {
		innerHTML: "",
		zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete this.zuhoerer[typ]; },
		querySelector(sel) { if (!stuecke.has(sel)) stuecke.set(sel, { textContent: "", innerHTML: "", hidden: true }); return stuecke.get(sel); },
	};
	const kasten = K.avesmapsWikiWeitereKastenMount(host, {
		skin: SKIN,
		hauptKey: () => "reichsstrasse-2",
		abschnitte: () => abschnitte,
		umfangText: () => "die ganze Straße",
		geschrieben: (antwort) => { geschrieben = antwort; },
		fetchImpl: async (url, init) => { gesendet.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true, applied: 1 }) }; },
	});
	assert.ok(host.innerHTML.includes('data-weitere-weg="b-renpfad"'), "der Kasten zeichnet sich beim Einbau");
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-weg]" ? { dataset: { weitereWeg: "b-renpfad" } } : null) } });
	await new Promise((fertig) => setTimeout(fertig, 0));
	assert.strictEqual(gesendet.length, 1);
	assert.deepStrictEqual(JSON.parse(gesendet[0].init.body),
		{ action: "remove_weitere", wiki_key: "b-renpfad", public_ids: ["rs-7"], dry_run: false, confirm: "apply" });
	assert.deepStrictEqual(geschrieben, { ok: true, applied: 1 }, "der Wirt erfaehrt vom Schreiben");

	// 5. Hinzufuegen gilt ALLEN Abschnitten des Kastens
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-hinzu]" ? { dataset: { weitereHinzu: "geronsgang" } } : null) } });
	await new Promise((fertig) => setTimeout(fertig, 0));
	assert.deepStrictEqual(JSON.parse(gesendet[1].init.body).public_ids, ["rs-6", "rs-7"]);

	// 6. Ein abgelehnter Schreibvorgang steht im Status und ruft den Wirt NICHT
	geschrieben = null;
	const k2 = K.avesmapsWikiWeitereKastenMount(host, {
		skin: SKIN, hauptKey: () => "reichsstrasse-2", abschnitte: () => abschnitte, umfangText: () => "x",
		geschrieben: (antwort) => { geschrieben = antwort; },
		fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: { code: "invalid_request", message: "Wiki-Weg nicht im Staging: x" } }) }),
	});
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-hinzu]" ? { dataset: { weitereHinzu: "x" } } : null) } });
	await new Promise((fertig) => setTimeout(fertig, 0));
	assert.strictEqual(geschrieben, null);
	assert.ok(host.querySelector("[data-weitere-status]").textContent.includes("Wiki-Weg nicht im Staging"));
	kasten.zerstoeren();
	k2.zerstoeren();

	console.log("wiki-weitere-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/ui/__tests__/wiki-weitere-kasten.test.js`
Expected: FAIL, `Cannot find module '../wiki-weitere-kasten.js'`

- [ ] **Step 3: Umsetzen, Bauteil**

`js/ui/wiki-weitere-kasten.js`:

```js
// Der Kasten „Weitere Wiki-Zuweisungen" -- EIN Bauteil fuer den Wege-Editor (Huelle „dt") und den
// Kartendialog „Weg bearbeiten" (Huelle „label-wiki").
// Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.3, §3.5.
//
// 🔴 Eine weitere Zuweisung benennt nie um und aendert keine Gruppe; der Server prueft das
// (api/_internal/wiki/path-weitere.php). Der Kasten schreibt sofort, ohne „Speichern".
// 🔴 Die Abschnitte liefert der WIRT (opts.abschnitte), bei jeder Aktion frisch gelesen. Der Kasten
// bildet keine Gruppe nach.
// ⚠️ Normales Skript, NICHT in <template data-nur-editor>: js/app/__tests__/nur-editor-skripte.test.js
// prueft Vorlagen-Namen gegen alle Skripte ausserhalb der Vorlagen.

const AVESMAPS_WIKI_WEITERE_URL = "/api/edit/wiki/paths.php";
const AVESMAPS_WIKI_WEITERE_TREFFER_LIMIT = 40;
const AVESMAPS_WIKI_WEITERE_TIPP_PAUSE_MS = 180;

function avesmapsWikiWeitereEsc(wert) {
	return String(wert == null ? "" : wert)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** REIN: welche weiteren Artikel an welchen Abschnitten haengen. */
function avesmapsWikiWeitereZuordnungen(abschnitte, gesamtText) {
	const liste = Array.isArray(abschnitte) ? abschnitte : [];
	const nachKey = new Map();
	liste.forEach((abschnitt) => {
		(Array.isArray(abschnitt && abschnitt.wiki_path_weitere) ? abschnitt.wiki_path_weitere : []).forEach((eintrag) => {
			const key = String((eintrag && eintrag.wiki_key) || "").trim();
			if (!key) { return; }
			if (!nachKey.has(key)) {
				nachKey.set(key, { wiki_key: key, name: String(eintrag.name || key), wiki_url: String(eintrag.wiki_url || ""), publicIds: [], labels: [] });
			}
			const zuordnung = nachKey.get(key);
			zuordnung.publicIds.push(abschnitt.public_id);
			zuordnung.labels.push(String(abschnitt.label || ""));
		});
	});
	return Array.from(nachKey.values()).map((z) => ({
		wiki_key: z.wiki_key,
		name: z.name,
		wiki_url: z.wiki_url,
		publicIds: z.publicIds,
		// Tragen ALLE Abschnitte eines mehrteiligen Kastens den Artikel, heisst die Stelle „ganze Straße".
		wo: liste.length > 1 && z.publicIds.length === liste.length ? String(gesamtText || "") : z.labels.join(", "),
	}));
}

/** REIN: der Rumpf fuer add_weitere/remove_weitere (Task 3). */
function avesmapsWikiWeitereKoerper(modus, wikiKey, publicIds) {
	return {
		action: modus === "add" ? "add_weitere" : "remove_weitere",
		wiki_key: String(wikiKey),
		public_ids: (Array.isArray(publicIds) ? publicIds : []).slice(),
		dry_run: false,
		confirm: "apply",
	};
}

/** REIN: angeboten wird weder die Hauptzuweisung noch ein schon vorhandener Artikel. */
function avesmapsWikiWeitereTrefferFiltern(zeilen, hauptKey, vorhandeneKeys) {
	const aus = new Set([String(hauptKey || "")].concat(Array.isArray(vorhandeneKeys) ? vorhandeneKeys : []));
	return (Array.isArray(zeilen) ? zeilen : []).filter((zeile) => zeile && zeile.wiki_key && !aus.has(String(zeile.wiki_key)));
}

/** Die Klassen der Huelle: die der Wiki-Zuweisung plus eine Ueberschrift im Stil des Wirts. */
function avesmapsWikiWeitereSkin(name) {
	const basis = typeof avesmapsWikiAssignSkin === "function" ? (avesmapsWikiAssignSkin(name) || {}) : {};
	return { ...basis, titel: name === "dt" ? "dt-grp" : "label-edit-section-title" };
}

/** REIN: der Kasten als HTML. modell = {hauptKey, umfang, zuordnungen, haupt?, hauptWo?}. */
function avesmapsWikiWeitereMarkup(modell, skin) {
	const esc = avesmapsWikiWeitereEsc;
	const kopf = '<div class="' + esc(skin.titel) + '">Weitere Wiki-Zuweisungen</div>';
	if (!modell.hauptKey) {
		return kopf + '<div class="' + esc(skin.hinweis) + '">Erst eine Wiki-Zuweisung setzen — danach lassen sich weitere hinzufügen.</div>';
	}
	const artikel = (z) => (z.wiki_url
		? '<a class="' + esc(skin.link) + '" href="' + esc(z.wiki_url) + '" target="_blank" rel="noopener">' + esc(z.name) + " ↗</a>"
		: esc(z.name))
		+ ' <span class="wiki-weitere__schluessel">' + esc(z.wiki_key) + "</span>";
	// Entwurf §3.5: zuerst die Hauptzuweisung -- ohne ✕, geloest wird sie im Kasten „Wiki-Weg" darueber.
	const haupt = modell.haupt && modell.haupt.wiki_key
		? '<tr class="wiki-weitere__haupt"><td class="wiki-weitere__wo">' + esc(modell.hauptWo || "") + "</td><td>" + artikel(modell.haupt)
			+ '</td><td class="wiki-weitere__art">Hauptzuweisung</td></tr>'
		: "";
	const zeilen = haupt + modell.zuordnungen.map((z) => '<tr><td class="wiki-weitere__wo">' + esc(z.wo) + "</td><td>" + artikel(z) + "</td>"
		+ '<td class="wiki-weitere__art">weitere <button type="button" class="wiki-weitere__weg" data-weitere-weg="' + esc(z.wiki_key)
		+ '" aria-label="Weitere Zuweisung ' + esc(z.name) + ' entfernen">✕</button></td></tr>').join("");
	return kopf
		+ (zeilen ? '<table class="wiki-weitere">' + zeilen + "</table>" : "")
		+ '<div class="wiki-weitere__titel">Weitere Wiki-Zuweisung für ' + esc(modell.umfang) + "</div>"
		+ '<input type="search" class="wiki-weitere__suche" data-weitere-suche placeholder="Wiki-Artikel suchen …" autocomplete="off">'
		+ '<div class="' + esc(skin.trefferListe) + '" data-weitere-treffer hidden></div>'
		+ '<div class="' + esc(skin.hinweis) + '">Zuweisen und Entfernen wirken sofort — ohne „Speichern“. Eine weitere Zuweisung ändert den Wegnamen nie.</div>'
		+ '<div class="' + esc(skin.hinweis) + '" data-weitere-status role="status" aria-live="polite"></div>';
}

/** REIN: die Suchtreffer als Knoepfe. */
function avesmapsWikiWeitereTrefferMarkup(treffer, skin) {
	const esc = avesmapsWikiWeitereEsc;
	if (!treffer.length) {
		return '<div class="' + esc(skin.hinweis) + '">Kein passender Wiki-Weg.</div>';
	}
	return treffer.map((t) => '<button type="button" class="' + esc(skin.treffer) + '" data-weitere-hinzu="' + esc(t.wiki_key) + '">'
		+ '<span class="' + esc(skin.trefferName) + '">' + esc(t.name || t.wiki_key) + "</span>"
		+ '<span class="' + esc(skin.trefferMeta) + '">' + esc([t.art, t.wiki_key].filter(Boolean).join(" · ")) + "</span></button>").join("");
}

function avesmapsWikiWeitereKastenMount(host, opts) {
	const skin = typeof opts.skin === "object" && opts.skin !== null ? opts.skin : avesmapsWikiWeitereSkin(opts.skin);
	const holen = opts.fetchImpl || ((url, init) => fetch(url, init));
	let tippTimer = null;

	function modell() {
		const abschnitte = (opts.abschnitte && opts.abschnitte()) || [];
		const gesamt = opts.gesamtText ? opts.gesamtText() : "ganze Straße";
		const umfang = String((opts.umfangText && opts.umfangText()) || "");
		return {
			hauptKey: String((opts.hauptKey && opts.hauptKey()) || ""),
			haupt: opts.haupt ? opts.haupt() : null,
			// Wo die Hauptzuweisung gilt: bei mehreren Abschnitten die ganze Strasse, sonst dieser eine Abschnitt.
			hauptWo: abschnitte.length > 1 ? gesamt : String((abschnitte[0] && abschnitte[0].label) || umfang),
			umfang,
			zuordnungen: avesmapsWikiWeitereZuordnungen(abschnitte, gesamt),
			abschnitte,
		};
	}
	function status(text) {
		const zeile = host.querySelector("[data-weitere-status]");
		if (zeile) { zeile.textContent = text; }
	}
	function zeichnen() {
		host.innerHTML = avesmapsWikiWeitereMarkup(modell(), skin);
	}
	function schreiben(modus, wikiKey, publicIds) {
		status(modus === "add" ? "Wird zugewiesen …" : "Wird entfernt …");
		return holen(AVESMAPS_WIKI_WEITERE_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(avesmapsWikiWeitereKoerper(modus, wikiKey, publicIds)),
		})
			.then((antwort) => antwort.json().then((daten) => {
				if (!antwort.ok || !daten || daten.ok !== true) {
					const meldung = daten && daten.error ? (daten.error.message || daten.error) : "HTTP " + antwort.status;
					throw new Error(String(meldung));
				}
				return daten;
			}))
			.then((daten) => Promise.resolve(opts.geschrieben ? opts.geschrieben(daten) : null).then(() => daten))
			.catch((fehler) => {
				status("Fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler));
			});
	}
	function suchen(text) {
		const liste = host.querySelector("[data-weitere-treffer]");
		if (!liste) { return; }
		const suchtext = String(text || "").trim();
		if (suchtext === "") { liste.hidden = true; liste.innerHTML = ""; return; }
		const url = AVESMAPS_WIKI_WEITERE_URL + "?action=search&q=" + encodeURIComponent(suchtext) + "&limit=" + AVESMAPS_WIKI_WEITERE_TREFFER_LIMIT;
		holen(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
			.then((antwort) => antwort.json())
			.then((daten) => {
				const m = modell();
				const treffer = avesmapsWikiWeitereTrefferFiltern(daten && daten.rows, m.hauptKey, m.zuordnungen.map((z) => z.wiki_key));
				liste.innerHTML = avesmapsWikiWeitereTrefferMarkup(treffer, skin);
				liste.hidden = false;
			})
			.catch((fehler) => { status("Suche fehlgeschlagen: " + (fehler && fehler.message ? fehler.message : fehler)); });
	}
	function klick(ereignis) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.closest !== "function") { return; }
		const weg = ziel.closest("[data-weitere-weg]");
		if (weg) {
			const zuordnung = modell().zuordnungen.find((z) => z.wiki_key === weg.dataset.weitereWeg);
			if (zuordnung) { schreiben("remove", zuordnung.wiki_key, zuordnung.publicIds); }
			return;
		}
		const hinzu = ziel.closest("[data-weitere-hinzu]");
		if (hinzu) {
			schreiben("add", hinzu.dataset.weitereHinzu, modell().abschnitte.map((a) => a.public_id));
		}
	}
	function tippen(ereignis) {
		const ziel = ereignis && ereignis.target;
		if (!ziel || typeof ziel.matches !== "function" || !ziel.matches("[data-weitere-suche]")) { return; }
		clearTimeout(tippTimer);
		const text = ziel.value;
		tippTimer = setTimeout(() => suchen(text), AVESMAPS_WIKI_WEITERE_TIPP_PAUSE_MS);
	}

	host.addEventListener("click", klick);
	host.addEventListener("input", tippen);
	zeichnen();
	return {
		neuZeichnen: zeichnen,
		zerstoeren() {
			clearTimeout(tippTimer);
			host.removeEventListener("click", klick);
			host.removeEventListener("input", tippen);
			host.innerHTML = "";
		},
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWikiWeitereZuordnungen,
		avesmapsWikiWeitereKoerper,
		avesmapsWikiWeitereTrefferFiltern,
		avesmapsWikiWeitereSkin,
		avesmapsWikiWeitereMarkup,
		avesmapsWikiWeitereTrefferMarkup,
		avesmapsWikiWeitereKastenMount,
	};
}
```

`css/components/wiki-weitere-kasten.css`:

```css
/* Der Kasten „Weitere Wiki-Zuweisungen" (js/ui/wiki-weitere-kasten.js).
   Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §3.5,
   Mockup docs/wege-mehrfachzuweisung-mockup.html. Nur Tokens (AGENTS.md §12). */
.wiki-weitere {
	width: 100%;
	border-collapse: collapse;
	margin: var(--space-4) 0 var(--space-6);
	font-size: var(--font-size-small);
}
.wiki-weitere td {
	padding: var(--space-4);
	border-top: 1px solid var(--color-divider);
	vertical-align: baseline;
}
.wiki-weitere tr:first-child td { border-top: 0; }
.wiki-weitere__wo { width: 34%; color: var(--color-text-muted); }
.wiki-weitere__schluessel { color: var(--color-text-muted); font-size: var(--font-size-caption); }
.wiki-weitere__art {
	width: 1%;
	text-align: right;
	white-space: nowrap;
	color: var(--color-text-muted);
	font-size: var(--font-size-caption);
}
.wiki-weitere__haupt .wiki-weitere__art { color: var(--color-text); }
.wiki-weitere__weg {
	border: 0;
	background: none;
	color: var(--color-text-muted);
	font: inherit;
	cursor: pointer;
	padding: 0 var(--space-2);
}
.wiki-weitere__weg:hover { color: var(--color-text); }
.wiki-weitere__titel {
	margin: var(--space-8) 0 var(--space-2);
	font-size: var(--font-size-caption);
	font-weight: var(--font-weight-bold);
	letter-spacing: var(--letter-spacing-caps);
	text-transform: uppercase;
	color: var(--color-text-muted);
}
.wiki-weitere__suche { width: 100%; box-sizing: border-box; }
```

Imports: In `css/styles.css` nach `@import url("components/wiki-override.css");` die Zeile `@import url("components/wiki-weitere-kasten.css");`. In `css/components/editor-page.css` nach `@import url("wiki-override.css");` die Zeile `@import url("wiki-weitere-kasten.css");`.

`html/wege-editor.html`: nach `<script src="/js/ui/wiki-assign-weg.js"></script>` einfügen `<script src="/js/ui/wiki-weitere-kasten.js"></script>`.

- [ ] **Step 4: Umsetzen, Einbau in den Wege-Editor**

In `js/pages/wege-editor.js` neben `var wpWikiAssign …` (Modulvariable) ergänzen:

```js
	var wpWikiWeitere = null;
```

Neue Hilfsfunktion direkt vor `function mountWikiAssign()`:

```js
	// Entwurf 2026-09-14 §2.3: die Abschnitte fuer den Kasten „Weitere Wiki-Zuweisungen". Die Nummer ist die
	// im Weg -- gerechnet ueber ALLE Wege (state.ways), nicht ueber die gefilterte Liste (ein Filter darf
	// die Nummer nicht verschieben).
	function weitereAbschnitte(ways) {
		var gruppen = {};
		wpGroupWays(state.ways).forEach(function (gruppe) { gruppen[gruppe.key] = gruppe; });
		return ways.map(function (way) {
			var gruppe = gruppen[wpGroupKeyOf(way)];
			var nummer = gruppe && gruppe.segments.length > 1 ? gruppe.segments.indexOf(way) + 1 : null;
			return {
				public_id: way.public_id,
				label: nummer ? "Abschnitt " + nummer : "dieser Abschnitt",
				wiki_path_weitere: way.wiki_path_weitere || []
			};
		});
	}

	function mountWikiWeitere(hostId, ways, umfang, nachSchreiben) {
		var host = $(hostId);
		if (wpWikiWeitere) { wpWikiWeitere.zerstoeren(); wpWikiWeitere = null; }
		if (!host || typeof avesmapsWikiWeitereKastenMount !== "function") { return; }
		wpWikiWeitere = avesmapsWikiWeitereKastenMount(host, {
			skin: "dt",
			hauptKey: function () { return ways[0] && ways[0].wiki_path ? String(ways[0].wiki_path.wiki_key || "") : ""; },
			haupt: function () { return ways[0] && ways[0].wiki_path ? ways[0].wiki_path : null; },
			abschnitte: function () { return weitereAbschnitte(ways); },
			umfangText: function () { return umfang; },
			geschrieben: function () {
				setStatus("Weitere Wiki-Zuweisung gespeichert.", "ok");
				return loadList().then(nachSchreiben);
			}
		});
	}
```

In `renderDetail` direkt nach `html += '<div id="wpWikiAssign"></div>';` einfügen:

```js
		html += '<div id="wpWikiWeitere"></div>';
```

In `wireDetail` direkt nach dem Aufruf `mountWikiAssign();` einfügen:

```js
		var eigenerWeg = null;
		state.ways.forEach(function (w) { if (w.public_id === state.selected) { eigenerWeg = w; } });
		if (eigenerWeg) {
			mountWikiWeitere("wpWikiWeitere", [eigenerWeg], "diesen Abschnitt", function () { return selectWay(state.selected, true); });
		}
```

In `renderGroupDetail` direkt vor dem Kommentar `// 🔴 QUELLEN ALS LETZTER BLOCK, auch auf der Weg-Ebene.` einfügen:

```js
		html += '<div id="wpGroupWikiWeitere"></div>';
```

In `wireGroupDetail` direkt nach dem Block `if (gruppeQuellen && typeof mountFeatureSourceEditor === "function" …) { … }` einfügen:

```js
		var gruppeWeitere = findGroup(state.selectedGroup);
		if (gruppeWeitere) {
			mountWikiWeitere("wpGroupWikiWeitere", gruppeWeitere.segments, "die ganze Straße", function () {
				return selectGroup(gruppeWeitere.key, true);
			});
		}
```

`setStatus(text, tone)` ist der Statusschreiber des Editors (`js/pages/wege-editor.js:106`).

- [ ] **Step 5: Tests laufen lassen**

Run:
- `node js/ui/__tests__/wiki-weitere-kasten.test.js`
- `node js/ui/__tests__/wiki-assign-weg.test.js` (fährt `wege-editor.js` wirklich)
- `node js/app/__tests__/nur-editor-skripte.test.js`
- `node tools/__tests__/scope-editor-css.test.js`

Expected: alle grün. Fällt `wiki-assign-weg.test.js`, weil sein Sandkasten `avesmapsWikiWeitereKastenMount` nicht kennt, ist das die `typeof`-Wache in `mountWikiWeitere`, die ihn schützt. Bleibt er rot, die fehlende Attrappe **im Test** ergänzen, nicht die Wache entfernen.

- [ ] **Step 6: Im Browser abnehmen (Handgriffe, nicht Maße)**

Lokalen Server starten (`.claude/launch.json` → `php -S 127.0.0.1:8765 -t <worktree>`). Die Editorseite braucht eine Sitzung, deshalb die Abnahme **nach dem Push** auf `https://avesmaps.de/edit/` als Owner:
1. Wege-Editor öffnen und „Reichsstraße" suchen.
2. Einen Abschnitt wählen. Im Kasten „Weitere Wiki-Zuweisungen" „Bärenpfad" suchen und wählen.
3. Die Zeile „Weitere Zuweisungen: Bärenpfad" erscheint unter dem Abschnitt, und die Suche „bären" findet ihn.
4. ✕ nimmt ihn wieder weg.

Gegenprobe: Der Wegname bleibt unverändert.

- [ ] **Step 7: Commit**

```bash
printf '%s\n' "feat(wege-editor): neuer Kasten \"Weitere Wiki-Zuweisungen\" am Abschnitt und auf der Weg-Ebene" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.3, §3.5." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/ui/wiki-weitere-kasten.js css/components/wiki-weitere-kasten.css js/ui/__tests__/wiki-weitere-kasten.test.js css/styles.css css/components/editor-page.css html/wege-editor.html js/pages/wege-editor.js && git commit -F "$SCRATCH/msg.txt"
```

**🚚 Lieferung 2:** Tasks 2 bis 7 zusammen live (Datenmodell plus Editor-Oberfläche; für Besucher unsichtbar). Owner nimmt im Wege-Editor ab.

---

## Task 8: Wie ein Abschnitt heißt — Regel, JS/PHP-Zwilling, Kartenleser

**Files:**
- Modify: `js/pages/wege-editor-model.js` (zwei Funktionen, Exporte)
- Create: `js/map-features/weg-abschnitte.js`
- Create: `api/_internal/map/weg-abschnitt-ende.php`
- Create: `tools/paths/fixtures/weg-abschnitt-enden.json`
- Create: `js/map-features/__tests__/weg-abschnitte.test.js`
- Create: `api/_internal/map/__tests__/weg-abschnitt-ende-test.php`
- Modify: `index.html` (Skript-Tag direkt nach `<script src="js/map-features/path-einschraenkung.js"></script>`)

**Interfaces:**
- Consumes: `wpGroupWays`, `wpGroupKeyOf`, `wpChainSegments` (Modell); im Browser `locationData` (Einträge `{name, coordinates:[lat,lng], …}`), `isCrossingLocation(ort)`, `LOCATION_ENDPOINT_EXACT_HIT`, `pathData`, `getPathPublicId(path)`, `mapDataSourceStatus.revision`
- Produces:
  - Modell:
    - `wpAbschnittLabel(way, nummer) -> string`
    - `wpGanzeStrecke(segmente) -> string` (Segmente mit `ends:{from,to}` und `enden:{von,bis}`)
  - JS rein:
    - `AVESMAPS_WEG_ENDE_KREUZUNG = "Kreuzung"`, `AVESMAPS_WEG_ENDE_OFFEN = "Wegende"`
    - `avesmapsWegOrtIndex(orte) -> Map`, mit `orte: Array<{name, x, y, kreuzung:boolean}>`
    - `avesmapsWegEndeName(punkt:[x,y], index, toleranz) -> string`
  - JS Karte:
    - `avesmapsWegAlsWay(path) -> {public_id, name, feature_subtype, wiki_path, wiki_path_weitere, bbox, ends, enden}`
    - `avesmapsWegAbschnittAufKarte(path) -> {way, gruppe, nummer}|null`
    - `avesmapsWegAbschnittLabelAufKarte(path) -> string`
    - `avesmapsWegStreckeAufKarte(path) -> string` (Kurzform ohne Nummer)
    - `avesmapsWegGanzeStreckeAufKarte(path) -> string`
    - `avesmapsWegGruppeAufKarte(path) -> Array<way>`
  - PHP:
    - `AVESMAPS_WEG_ENDE_KREUZUNG`, `AVESMAPS_WEG_ENDE_OFFEN`, `AVESMAPS_WEG_ENDE_ZELLE = 0.5`, `AVESMAPS_WEG_ENDE_TOLERANZ = 0.01`
    - `avesmapsWegOrtIndex(array $orte): array`
    - `avesmapsWegEndeName(mixed $punkt, array $index, float $toleranz = AVESMAPS_WEG_ENDE_TOLERANZ): string`
    - `avesmapsWegOrteLesen(PDO $pdo): array`

- [ ] **Step 1: Fixture anlegen**

`tools/paths/fixtures/weg-abschnitt-enden.json`:

```json
{
  "_zweck": "Gemeinsame Faelle fuer avesmapsWegEndeName in js/map-features/weg-abschnitte.js und api/_internal/map/weg-abschnitt-ende.php (Entwurf 2026-09-14 §4). Wer einen Fall aendert, aendert ihn fuer beide Seiten.",
  "toleranz": 0.01,
  "orte": [
    { "name": "Silkwiesen", "x": 100.0, "y": 50.0, "kreuzung": false },
    { "name": "Wieha", "x": 101.0, "y": 51.0, "kreuzung": false },
    { "name": "Kreuzung-7", "x": 102.0, "y": 52.0, "kreuzung": true },
    { "name": "Dorf am Kreuz", "x": 103.0, "y": 53.0, "kreuzung": false },
    { "name": "Kreuzung-8", "x": 103.004, "y": 53.0, "kreuzung": true },
    { "name": "Burg", "x": 104.3, "y": 54.0, "kreuzung": false },
    { "name": "Verborgenes Kloster", "x": 105.0, "y": 55.0, "kreuzung": false },
    { "name": "Grenzort", "x": 106.5, "y": 60.0, "kreuzung": false },
    { "name": "Nah", "x": 107.004, "y": 61.0, "kreuzung": false },
    { "name": "Naeher", "x": 107.002, "y": 61.0, "kreuzung": false }
  ],
  "faelle": [
    { "punkt": [100.0, 50.0], "erwartet": "Silkwiesen", "warum": "exakt auf dem Ort" },
    { "punkt": [101.009, 51.0], "erwartet": "Wieha", "warum": "knapp innerhalb der Toleranz" },
    { "punkt": [101.02, 51.0], "erwartet": "Wegende", "warum": "0,02 daneben ist kein Treffer" },
    { "punkt": [102.0, 52.0], "erwartet": "Kreuzung", "warum": "Kreuzung ohne Nummer" },
    { "punkt": [103.002, 53.0], "erwartet": "Dorf am Kreuz", "warum": "ein Ort schlaegt eine Kreuzung" },
    { "punkt": [104.0, 54.0], "erwartet": "Wegende", "warum": "kein Kastentreffer wie getLocationAtPathEndpoint: 0,3 daneben zaehlt nicht" },
    { "punkt": [105.0, 55.0], "erwartet": "Verborgenes Kloster", "warum": "ein verborgener Ort heisst wie der Ort (Owner 14.09.2026)" },
    { "punkt": [106.495, 60.0], "erwartet": "Grenzort", "warum": "der Ort liegt in der Nachbarzelle" },
    { "punkt": [107.0, 61.0], "erwartet": "Naeher", "warum": "der naechste Ort gewinnt" },
    { "punkt": ["x", 1], "erwartet": "Wegende", "warum": "kaputter Punkt" }
  ]
}
```

- [ ] **Step 2: JS-Test schreiben**

`js/map-features/__tests__/weg-abschnitte.test.js`:

```js
"use strict";
// Abschnittsnamen: Regel (Zwilling mit PHP), Modell-Label, Kartenleser. Entwurf 2026-09-14 §4.
// Aus der Wurzel: node js/map-features/__tests__/weg-abschnitte.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8");
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
// Die Kartenleser rufen die Modellfunktionen global, wie im Browser.
Object.assign(global, { wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke });
const W = require(path.join(WURZEL, "js/map-features/weg-abschnitte.js"));

// 1. Die gemeinsamen Faelle
const fixture = JSON.parse(lies("tools/paths/fixtures/weg-abschnitt-enden.json"));
const index = W.avesmapsWegOrtIndex(fixture.orte);
fixture.faelle.forEach((fall) => {
	assert.strictEqual(W.avesmapsWegEndeName(fall.punkt, index, fixture.toleranz), fall.erwartet, fall.warum);
});
const config = lies("js/config.js");
assert.ok(new RegExp("const LOCATION_ENDPOINT_EXACT_HIT = " + String(fixture.toleranz).replace(".", "\\.") + ";").test(config),
	"die Fixture-Toleranz ist die des Routers (js/config.js)");

// 2. Modell: Label und ganze Strecke (samt gedrehtem Abschnitt)
assert.strictEqual(M.wpAbschnittLabel({ enden: { von: "Silkwiesen", bis: "Wieha" } }, 7), "Abschnitt 7: Silkwiesen – Wieha");
assert.strictEqual(M.wpAbschnittLabel({ enden: { von: "Perz", bis: "Helmdahl" } }, null), "Perz – Helmdahl", "einteilig ohne Nummer");
assert.strictEqual(M.wpAbschnittLabel({}, 3), "Abschnitt 3", "ohne Enden nur die Nummer");
const kette = [
	{ public_id: "a", ends: { from: [0, 0], to: [1, 0] }, enden: { von: "Perz", bis: "Kreuzung" } },
	// b liegt ANDERSHERUM gespeichert: von Wieha nach Kreuzung
	{ public_id: "b", ends: { from: [2, 0], to: [1, 0] }, enden: { von: "Wieha", bis: "Kreuzung" } },
];
assert.ok(["Perz – Wieha", "Wieha – Perz"].includes(M.wpGanzeStrecke(kette)), "die aeusseren Enden, nicht die Kreuzung: " + M.wpGanzeStrecke(kette));
assert.strictEqual(M.wpGanzeStrecke([]), "");

// 3. Kartenleser gegen eine kleine Karte
global.LOCATION_ENDPOINT_EXACT_HIT = 0.01;
global.isCrossingLocation = (ort) => /^Kreuzung/.test(ort.name);
global.getPathPublicId = (p) => p.properties.public_id;
global.mapDataSourceStatus = { revision: 1 };
global.locationData = [
	{ name: "Perz", coordinates: [0, 0] },
	{ name: "Kreuzung-1", coordinates: [0, 1] },
	{ name: "Wieha", coordinates: [0, 2] },
];
const pfad = (id, von, bis, extra = {}) => ({ properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "Reichsstrasse-" + id,
	display_name: "Reichsstraße 2", wiki_path: { wiki_key: "reichsstrasse-2" }, ...extra }, geometry: { coordinates: [von, bis] } });
global.pathData = [pfad("b", [2, 0], [1, 0]), pfad("a", [0, 0], [1, 0])];

assert.deepStrictEqual(W.avesmapsWegAlsWay(global.pathData[1]).enden, { von: "Perz", bis: "Kreuzung" });
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[1]), "Abschnitt 1: Perz – Kreuzung", "a liegt westlich und ist Abschnitt 1");
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[0]), "Abschnitt 2: Wieha – Kreuzung");
assert.strictEqual(W.avesmapsWegStreckeAufKarte(global.pathData[0]), "Wieha – Kreuzung", "Kurzform ohne Nummer");
assert.ok(["Perz – Wieha", "Wieha – Perz"].includes(W.avesmapsWegGanzeStreckeAufKarte(global.pathData[0])));
assert.strictEqual(W.avesmapsWegGruppeAufKarte(global.pathData[0]).length, 2);

// Der Zwischenspeicher folgt der Revision: ein umbenannter Ort erscheint nach dem naechsten Revisionssprung
global.locationData[0].name = "Perz am See";
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[1]), "Abschnitt 1: Perz – Kreuzung", "gleiche Revision: gespeichert");
global.mapDataSourceStatus.revision = 2;
assert.strictEqual(W.avesmapsWegAbschnittLabelAufKarte(global.pathData[1]), "Abschnitt 1: Perz am See – Kreuzung", "neue Revision: neu gerechnet");

console.log("weg-abschnitte.test.js: ok");
```

- [ ] **Step 3: PHP-Test schreiben**

`api/_internal/map/__tests__/weg-abschnitt-ende-test.php`:

```php
<?php

declare(strict_types=1);

// PHP-Zwilling der Endenbenennung (Entwurf 2026-09-14 §4). Liest dieselbe Fixture wie der JS-Test.
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/map/__tests__/weg-abschnitt-ende-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

require __DIR__ . '/../weg-abschnitt-ende.php';

$wurzel = dirname(__DIR__, 4);
$fixture = json_decode((string) file_get_contents($wurzel . '/tools/paths/fixtures/weg-abschnitt-enden.json'), true);
$index = avesmapsWegOrtIndex($fixture['orte']);
foreach ($fixture['faelle'] as $fall) {
    $ist = avesmapsWegEndeName($fall['punkt'], $index, (float) $fixture['toleranz']);
    assert($ist === $fall['erwartet'], $fall['warum'] . ': ' . $ist);
}

// Drei Stellen derselben Zahl
assert(AVESMAPS_WEG_ENDE_TOLERANZ === (float) $fixture['toleranz']);
$clientGraph = (string) file_get_contents($wurzel . '/api/_internal/routing/client-graph.php');
assert(preg_match('/const AVESMAPS_ROUTE_CLIENT_ENDPOINT_EXACT_HIT = ([0-9.]+);/', $clientGraph, $treffer) === 1);
assert((float) $treffer[1] === AVESMAPS_WEG_ENDE_TOLERANZ, 'Toleranz weicht vom Router ab');

// Orte lesen: Orte und beide Kreuzungsarten, aktiv
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_json TEXT, is_active INTEGER DEFAULT 1)');
$st = $pdo->prepare('INSERT INTO map_features (name, feature_type, feature_subtype, geometry_json, is_active) VALUES (?, ?, ?, ?, ?)');
$st->execute(['Silkwiesen', 'location', 'dorf', '{"type":"Point","coordinates":[100,50]}', 1]);
$st->execute(['Kreuzung', 'crossing', 'crossing', '{"type":"Point","coordinates":[102,52]}', 1]);
$st->execute(['', 'junction', 'crossing', '{"type":"Point","coordinates":[103,53]}', 1]);
$st->execute(['Alt', 'location', 'dorf', '{"type":"Point","coordinates":[1,1]}', 0]);
$st->execute(['Reichsstraße 2', 'path', 'Reichsstrasse', '{"type":"LineString","coordinates":[[0,0],[1,1]]}', 1]);
$orte = avesmapsWegOrteLesen($pdo);
assert(count($orte) === 3, json_encode($orte));
assert($orte[0] === ['name' => 'Silkwiesen', 'x' => 100.0, 'y' => 50.0, 'kreuzung' => false]);
assert($orte[1]['kreuzung'] === true && $orte[2]['kreuzung'] === true);

echo "weg-abschnitt-ende-test.php: ok\n";
```

- [ ] **Step 4: Tests laufen lassen, sie müssen scheitern**

Run: `node js/map-features/__tests__/weg-abschnitte.test.js` und `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/map/__tests__/weg-abschnitt-ende-test.php`
Expected: Beide Läufe scheitern an der fehlenden Datei.

- [ ] **Step 5: Umsetzen, Modell**

In `js/pages/wege-editor-model.js` vor `function wpChainCurve` einfügen:

```js
/**
 * REIN: der Name eines Abschnitts (Entwurf 2026-09-14 §4). Langform „Abschnitt N: Von – Bis"; ein Weg aus
 * nur einem Abschnitt traegt keine Nummer; ohne bekannte Enden bleibt nur „Abschnitt N".
 */
function wpAbschnittLabel(way, nummer) {
	var enden = way && way.enden;
	var strecke = enden ? String(enden.von) + " – " + String(enden.bis) : "";
	if (!nummer) { return strecke; }
	return "Abschnitt " + nummer + (strecke ? ": " + strecke : "");
}

/**
 * REIN: „Von – Bis" der ganzen Strasse -- die aeusseren Enden der LAENGSTEN Kette (wpChainSegments).
 * "" wenn es keine Kette oder keine Enden gibt. ⚠️ `gedreht` heisst: das Stueck wird vom `to` zum `from`
 * durchlaufen (siehe laufe() in wpChainSegments).
 */
function wpGanzeStrecke(segmente) {
	var ketten = wpChainSegments(segmente);
	if (!ketten.length) { return ""; }
	var kette = ketten[0];
	var erstes = segmente[kette[0].index];
	var letztes = segmente[kette[kette.length - 1].index];
	if (!erstes || !letztes || !erstes.enden || !letztes.enden) { return ""; }
	var von = kette[0].gedreht ? erstes.enden.bis : erstes.enden.von;
	var bis = kette[kette.length - 1].gedreht ? letztes.enden.von : letztes.enden.bis;
	return String(von) + " – " + String(bis);
}
```

In `module.exports` ergänzen: `wpAbschnittLabel: wpAbschnittLabel, wpGanzeStrecke: wpGanzeStrecke,`.

- [ ] **Step 6: Umsetzen, JS-Modul**

`js/map-features/weg-abschnitte.js`:

```js
// Wie ein Wegabschnitt heisst: „Abschnitt N: <Ende> – <Ende>" (Entwurf 2026-09-14 §4, Owner: „es geht nur
// darum, dass der besucher den kontext versteht").
//
// 🔴 ZWILLING: api/_internal/map/weg-abschnitt-ende.php (fuer die Wege-Editor-Liste, die keine Orte kennt).
// Beide Tests lesen tools/paths/fixtures/weg-abschnitt-enden.json -- wer die Regel aendert, aendert beide.
// ⚠️ Normales Skript (siehe js/app/nur-editor.js): auch Besucher brauchen die Namen (Infobox, Route).

const AVESMAPS_WEG_ENDE_KREUZUNG = "Kreuzung";
const AVESMAPS_WEG_ENDE_OFFEN = "Wegende";
// Zellbreite des Ortsindex; groesser als jede Toleranz, damit 3x3 Zellen reichen.
const AVESMAPS_WEG_ENDE_ZELLE = 0.5;

/** REIN: Zellenindex ueber Orte {name, x, y, kreuzung}. */
function avesmapsWegOrtIndex(orte) {
	const index = new Map();
	(Array.isArray(orte) ? orte : []).forEach((ort) => {
		const x = Number(ort && ort.x);
		const y = Number(ort && ort.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) { return; }
		const zelle = Math.floor(x / AVESMAPS_WEG_ENDE_ZELLE) + ":" + Math.floor(y / AVESMAPS_WEG_ENDE_ZELLE);
		if (!index.has(zelle)) { index.set(zelle, []); }
		index.get(zelle).push({ name: String(ort.name), x, y, kreuzung: ort.kreuzung === true });
	});
	return index;
}

/**
 * REIN: Name des Endes am Punkt [x, y]. Naechster Ort (keine Kreuzung) mit Abstand < toleranz; sonst
 * „Kreuzung", wenn eine Kreuzung < toleranz liegt; sonst „Wegende". Kein Kastentreffer im 0,5-Umkreis
 * wie getLocationAtPathEndpoint -- ein Name, der nicht wirklich am Ende liegt, fuehrte in die Irre.
 * Gleichstand: kleineres x, dann kleineres y (nie der Name: JS und PHP sortieren Umlaute verschieden).
 */
function avesmapsWegEndeName(punkt, index, toleranz) {
	const x = Number(Array.isArray(punkt) ? punkt[0] : NaN);
	const y = Number(Array.isArray(punkt) ? punkt[1] : NaN);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !(index instanceof Map)) { return AVESMAPS_WEG_ENDE_OFFEN; }
	const zx = Math.floor(x / AVESMAPS_WEG_ENDE_ZELLE);
	const zy = Math.floor(y / AVESMAPS_WEG_ENDE_ZELLE);
	let bester = null;
	let besterAbstand = Infinity;
	let kreuzung = false;
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			(index.get((zx + dx) + ":" + (zy + dy)) || []).forEach((kandidat) => {
				const abstand = Math.hypot(kandidat.x - x, kandidat.y - y);
				if (!(abstand < toleranz)) { return; }
				if (kandidat.kreuzung) { kreuzung = true; return; }
				const naeher = abstand < besterAbstand
					|| (abstand === besterAbstand && (kandidat.x < bester.x || (kandidat.x === bester.x && kandidat.y < bester.y)));
				if (naeher) { bester = kandidat; besterAbstand = abstand; }
			});
		}
	}
	if (bester) { return bester.name; }
	return kreuzung ? AVESMAPS_WEG_ENDE_KREUZUNG : AVESMAPS_WEG_ENDE_OFFEN;
}

// ── Kartenleser (Browser) ────────────────────────────────────────────────────────────────────────────
// Beide Zwischenspeicher haengen an der Kartenrevision: ein Live-Abgleich oder ein eigenes Speichern hebt
// sie, und dann wird neu gerechnet. Ohne Revision (Besucher ohne Live-Abgleich) an der Datenlaenge.

let avesmapsWegOrtIndexStand = { schluessel: null, index: null };
let avesmapsWegGruppenStand = { schluessel: null, nachId: null, nachKey: null };

function avesmapsWegKartenStand(daten) {
	const revision = typeof mapDataSourceStatus !== "undefined" && mapDataSourceStatus ? mapDataSourceStatus.revision : null;
	return String(revision) + "|" + (Array.isArray(daten) ? daten.length : 0);
}

function avesmapsWegOrtIndexAusKarte() {
	const daten = typeof locationData !== "undefined" && Array.isArray(locationData) ? locationData : [];
	const schluessel = avesmapsWegKartenStand(daten);
	if (avesmapsWegOrtIndexStand.schluessel !== schluessel) {
		avesmapsWegOrtIndexStand = {
			schluessel,
			index: avesmapsWegOrtIndex(daten.map((ort) => ({
				name: ort.name,
				x: Number(ort.coordinates && ort.coordinates[1]),
				y: Number(ort.coordinates && ort.coordinates[0]),
				kreuzung: typeof isCrossingLocation === "function" ? isCrossingLocation(ort) === true : false,
			}))),
		};
	}
	return avesmapsWegOrtIndexStand.index;
}

/** Ein Kartenweg in der Form einer Wege-Editor-Zeile (dieselben Felder, die das Modell liest). */
function avesmapsWegAlsWay(path) {
	const p = (path && path.properties) || {};
	const koordinaten = path && path.geometry && Array.isArray(path.geometry.coordinates) ? path.geometry.coordinates : [];
	let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
	koordinaten.forEach((punkt) => {
		minX = Math.min(minX, punkt[0]); minY = Math.min(minY, punkt[1]);
		maxX = Math.max(maxX, punkt[0]); maxY = Math.max(maxY, punkt[1]);
	});
	const toleranz = typeof LOCATION_ENDPOINT_EXACT_HIT !== "undefined" ? LOCATION_ENDPOINT_EXACT_HIT : 0.01;
	const index = avesmapsWegOrtIndexAusKarte();
	return {
		public_id: typeof getPathPublicId === "function" ? getPathPublicId(path) : String(p.public_id || ""),
		// 💣 Der ECHTE Name (siehe avesmapsWegGruppenSchluessel): properties.name ist der Maschinenname.
		name: String(p.display_name || p.original_name || p.name || ""),
		feature_subtype: String(p.feature_subtype || ""),
		wiki_path: p.wiki_path || null,
		wiki_path_weitere: Array.isArray(p.wiki_path_weitere) ? p.wiki_path_weitere : [],
		bbox: koordinaten.length ? [minX, minY, maxX, maxY] : null,
		ends: koordinaten.length >= 2 ? { from: koordinaten[0], to: koordinaten[koordinaten.length - 1] } : null,
		enden: koordinaten.length >= 2
			? { von: avesmapsWegEndeName(koordinaten[0], index, toleranz), bis: avesmapsWegEndeName(koordinaten[koordinaten.length - 1], index, toleranz) }
			: null,
	};
}

function avesmapsWegGruppenAufKarte() {
	const daten = typeof pathData !== "undefined" && Array.isArray(pathData) ? pathData : [];
	const schluessel = avesmapsWegKartenStand(daten);
	if (avesmapsWegGruppenStand.schluessel !== schluessel) {
		const nachId = new Map();
		const nachKey = new Map();
		wpGroupWays(daten.map(avesmapsWegAlsWay)).forEach((gruppe) => {
			nachKey.set(gruppe.key, gruppe);
			gruppe.segments.forEach((way, i) => {
				nachId.set(way.public_id, { way, gruppe, nummer: gruppe.segments.length > 1 ? i + 1 : null });
			});
		});
		avesmapsWegGruppenStand = { schluessel, nachId, nachKey };
	}
	return avesmapsWegGruppenStand;
}

function avesmapsWegAbschnittAufKarte(path) {
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	return avesmapsWegGruppenAufKarte().nachId.get(id) || null;
}

function avesmapsWegAbschnittLabelAufKarte(path) {
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	return abschnitt ? wpAbschnittLabel(abschnitt.way, abschnitt.nummer) : "";
}

function avesmapsWegStreckeAufKarte(path) {
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	return abschnitt ? wpAbschnittLabel(abschnitt.way, null) : "";
}

function avesmapsWegGanzeStreckeAufKarte(path) {
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	return abschnitt ? wpGanzeStrecke(abschnitt.gruppe.segments) : "";
}

function avesmapsWegGruppeAufKarte(path) {
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	return abschnitt ? abschnitt.gruppe.segments : [];
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WEG_ENDE_KREUZUNG, AVESMAPS_WEG_ENDE_OFFEN,
		avesmapsWegOrtIndex, avesmapsWegEndeName, avesmapsWegAlsWay, avesmapsWegKartenStand, avesmapsWegGruppenAufKarte,
		avesmapsWegAbschnittAufKarte, avesmapsWegAbschnittLabelAufKarte, avesmapsWegStreckeAufKarte,
		avesmapsWegGanzeStreckeAufKarte, avesmapsWegGruppeAufKarte,
	};
}
```

In `index.html` direkt nach `<script src="js/map-features/path-einschraenkung.js"></script>` einfügen:

```html
		<script src="js/map-features/weg-abschnitte.js"></script>
```

- [ ] **Step 7: Umsetzen, PHP-Zwilling**

`api/_internal/map/weg-abschnitt-ende.php`:

```php
<?php

declare(strict_types=1);

// Wie das Ende eines Wegabschnitts heisst (Entwurf 2026-09-14 §4). ZWILLING von avesmapsWegEndeName in
// js/map-features/weg-abschnitte.js: der Wege-Editor ist eine eigene Seite ohne Orte, also nennt der
// SERVER dort die Enden. Beide Tests lesen tools/paths/fixtures/weg-abschnitt-enden.json.

const AVESMAPS_WEG_ENDE_KREUZUNG = 'Kreuzung';
const AVESMAPS_WEG_ENDE_OFFEN = 'Wegende';
const AVESMAPS_WEG_ENDE_ZELLE = 0.5;
// 💣 Dieselbe Zahl steht als LOCATION_ENDPOINT_EXACT_HIT (js/config.js) und
// AVESMAPS_ROUTE_CLIENT_ENDPOINT_EXACT_HIT (api/_internal/routing/client-graph.php). Die Tests halten alle drei gleich.
const AVESMAPS_WEG_ENDE_TOLERANZ = 0.01;

/** @param list<array{name:string,x:float,y:float,kreuzung:bool}> $orte */
function avesmapsWegOrtIndex(array $orte): array {
    $index = [];
    foreach ($orte as $ort) {
        $x = filter_var($ort['x'] ?? null, FILTER_VALIDATE_FLOAT);
        $y = filter_var($ort['y'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($x === false || $y === false) {
            continue;
        }
        $zelle = (int) floor($x / AVESMAPS_WEG_ENDE_ZELLE) . ':' . (int) floor($y / AVESMAPS_WEG_ENDE_ZELLE);
        $index[$zelle][] = ['name' => (string) ($ort['name'] ?? ''), 'x' => (float) $x, 'y' => (float) $y, 'kreuzung' => ($ort['kreuzung'] ?? false) === true];
    }
    return $index;
}

function avesmapsWegEndeName(mixed $punkt, array $index, float $toleranz = AVESMAPS_WEG_ENDE_TOLERANZ): string {
    $x = is_array($punkt) ? filter_var($punkt[0] ?? null, FILTER_VALIDATE_FLOAT) : false;
    $y = is_array($punkt) ? filter_var($punkt[1] ?? null, FILTER_VALIDATE_FLOAT) : false;
    if ($x === false || $y === false) {
        return AVESMAPS_WEG_ENDE_OFFEN;
    }
    $zx = (int) floor($x / AVESMAPS_WEG_ENDE_ZELLE);
    $zy = (int) floor($y / AVESMAPS_WEG_ENDE_ZELLE);
    $bester = null;
    $besterAbstand = INF;
    $kreuzung = false;
    for ($dx = -1; $dx <= 1; $dx++) {
        for ($dy = -1; $dy <= 1; $dy++) {
            foreach ($index[($zx + $dx) . ':' . ($zy + $dy)] ?? [] as $kandidat) {
                $abstand = hypot($kandidat['x'] - $x, $kandidat['y'] - $y);
                if (!($abstand < $toleranz)) {
                    continue;
                }
                if ($kandidat['kreuzung']) {
                    $kreuzung = true;
                    continue;
                }
                $naeher = $abstand < $besterAbstand
                    || ($abstand === $besterAbstand && ($kandidat['x'] < $bester['x'] || ($kandidat['x'] === $bester['x'] && $kandidat['y'] < $bester['y'])));
                if ($naeher) {
                    $bester = $kandidat;
                    $besterAbstand = $abstand;
                }
            }
        }
    }
    if ($bester !== null) {
        return $bester['name'];
    }
    return $kreuzung ? AVESMAPS_WEG_ENDE_KREUZUNG : AVESMAPS_WEG_ENDE_OFFEN;
}

/** Aktive Orte und Kreuzungen als {name, x, y, kreuzung}. Eine Abfrage, nur Punkte. */
function avesmapsWegOrteLesen(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT name, feature_type, feature_subtype, geometry_json FROM map_features
          WHERE is_active = 1 AND feature_type IN ('location', 'crossing', 'junction')
          ORDER BY id"
    );
    $orte = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $geometrie = json_decode((string) ($zeile['geometry_json'] ?? ''), true);
        $punkt = is_array($geometrie) ? ($geometrie['coordinates'] ?? null) : null;
        if (!is_array($punkt) || !is_numeric($punkt[0] ?? null) || !is_numeric($punkt[1] ?? null)) {
            continue;
        }
        $name = (string) ($zeile['name'] ?? '');
        // Dieselbe Erkennung wie resolveLocationTypeFromFeature/isCrossingName (map-features-location-lookup.js).
        $kreuzung = in_array((string) $zeile['feature_type'], ['crossing', 'junction'], true)
            || (string) $zeile['feature_subtype'] === 'crossing'
            || preg_match('/^Kreuzung(?:-\d+)?$/i', $name) === 1;
        $orte[] = ['name' => $name, 'x' => (float) $punkt[0], 'y' => (float) $punkt[1], 'kreuzung' => $kreuzung];
    }
    return $orte;
}
```

- [ ] **Step 8: Tests laufen lassen, sie müssen bestehen**

Run: die beiden Befehle aus Step 4, dazu `node js/pages/__tests__/wege-editor-model.test.js` und `node js/app/__tests__/nur-editor-skripte.test.js`
Expected: `weg-abschnitte.test.js: ok`, `weg-abschnitt-ende-test.php: ok`, Modell- und Ladetest grün.

- [ ] **Step 9: Commit**

```bash
printf '%s\n' "feat(wege): Abschnittsnamen \"Abschnitt N: Ort – Ort\" als Regel in JS und PHP mit gemeinsamer Fixture (noch nicht angezeigt)" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/pages/wege-editor-model.js js/map-features/weg-abschnitte.js api/_internal/map/weg-abschnitt-ende.php tools/paths/fixtures/weg-abschnitt-enden.json js/map-features/__tests__/weg-abschnitte.test.js api/_internal/map/__tests__/weg-abschnitt-ende-test.php index.html && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 9: Abschnittsnamen im Wege-Editor

**Files:**
- Modify: `api/edit/map/paths-editor.php` (require; Listen-SQL; Zeilenarray)
- Modify: `js/pages/wege-editor.js` (`renderList` Gruppenkopf, `segmentRow` Titel, `renderGroupDetail` „Die Abschnitte", `weitereAbschnitte`/`wireDetail` Umfangstext)
- Create: `js/pages/__tests__/wege-editor-abschnittsnamen.test.js`

**Interfaces:**
- Consumes: Task 8 (`avesmapsWegOrtIndex`, `avesmapsWegEndeName`, `avesmapsWegOrteLesen`, `wpAbschnittLabel`, `wpGanzeStrecke`)
- Produces: Listenzeile trägt `ends: {from:[x,y], to:[x,y]}|null` (gleiche Form wie `detail`) und `enden: {von, bis}|null`.

⚠️ **Die Liste bleibt geometriefrei** (Kopfkommentar von `paths-editor.php`). Die Endpunkte kommen per `JSON_EXTRACT(geometry_json, '$.coordinates[0]')` und `'$.coordinates[last]'` aus MySQL 8, also zwei kurze Werte je Zeile statt der ganzen Linie.

- [ ] **Step 1: Test schreiben**

```js
"use strict";
// Wege-Editor: Abschnitte heissen „Abschnitt N: Ort – Ort" (Entwurf 2026-09-14 §4).
// Aus der Wurzel: node js/pages/__tests__/wege-editor-abschnittsnamen.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const rumpf = (quelle, kopf) => {
	const start = quelle.indexOf(kopf);
	assert.ok(start >= 0, kopf + " nicht gefunden");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i++) {
		if (quelle[i] === "{") tiefe++;
		if (quelle[i] === "}" && --tiefe === 0) return quelle.slice(start, i + 1);
	}
	throw new Error("offen: " + kopf);
};

const editor = ohneKommentare(lies("js/pages/wege-editor.js"));
assert.ok(rumpf(editor, "function segmentRow(way, index, group)").includes("wpAbschnittLabel(way, index)"), "die Abschnittszeile heisst nach der Regel");
assert.ok(rumpf(editor, "function renderGroupDetail(host)").includes("wpAbschnittLabel(segment, index + 1)"), "„Die Abschnitte" auf der Weg-Ebene ebenso");
assert.ok(rumpf(editor, "function renderList()").includes("wpGanzeStrecke(group.segments)"), "der Gruppenkopf nennt die ganze Strecke");
assert.ok(rumpf(editor, "function weitereAbschnitte(ways)").includes("wpAbschnittLabel(way, nummer)"), "der Weitere-Kasten nennt die Abschnitte gleich");

const php = lies("api/edit/map/paths-editor.php");
assert.ok(php.includes("require_once __DIR__ . '/../../_internal/map/weg-abschnitt-ende.php';"));
assert.ok(php.includes("JSON_EXTRACT(geometry_json, '$.coordinates[0]') AS ende_von"), "Endpunkte per JSON_EXTRACT, nicht die ganze Geometrie");
assert.ok(php.includes("JSON_EXTRACT(geometry_json, '$.coordinates[last]') AS ende_bis"));
assert.ok(/'enden'\s*=>/.test(php) && /'ends'\s*=>/.test(php), "die Zeile traegt ends und enden");
assert.ok(!/SELECT[^;]*\bgeometry_json\b\s*,[^;]*FROM map_features\s+WHERE feature_type = 'path'/.test(php), "die Liste liest die Geometrie nicht ganz");

console.log("wege-editor-abschnittsnamen.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/pages/__tests__/wege-editor-abschnittsnamen.test.js`
Expected: FAIL `die Abschnittszeile heisst nach der Regel`

- [ ] **Step 3: Umsetzen, Server**

In `api/edit/map/paths-editor.php`:

1. Nach der `path-weitere.php`-Zeile (Task 6) einfügen: `require_once __DIR__ . '/../../_internal/map/weg-abschnitt-ende.php';`
2. Die Listen-Abfrage in `avesmapsPathEditorList` ersetzen durch:

```php
    // 💣 DIE ENDPUNKTE, NICHT DIE GEOMETRIE (Entwurf 2026-09-14 §4). Die Liste bleibt geometriefrei
    // (Kopfkommentar dieser Datei); zwei JSON_EXTRACT liefern je Zeile nur Anfangs- und Endpunkt.
    // `[last]` gibt es seit MySQL 8.0.2.
    $statement = $pdo->query(
        "SELECT id, public_id, name, feature_subtype, properties_json, revision,
                min_x, min_y, max_x, max_y,
                JSON_EXTRACT(geometry_json, '$.coordinates[0]') AS ende_von,
                JSON_EXTRACT(geometry_json, '$.coordinates[last]') AS ende_bis
           FROM map_features
          WHERE feature_type = 'path' AND is_active = 1
          ORDER BY name"
    );
    // Ein Ortsindex fuer alle Zeilen: Orte und Kreuzungen, eine Abfrage (avesmapsWegOrteLesen).
    $ortIndex = avesmapsWegOrtIndex(avesmapsWegOrteLesen($pdo));
```

3. Im Zeilenarray nach `'bbox' => [ … ],` einfügen:

```php
            // Entwurf 2026-09-14 §4: dieselbe Form wie `detail` (ends) und die Namen der Enden (enden).
            'ends' => (static function () use ($row): ?array {
                $von = json_decode((string) ($row['ende_von'] ?? 'null'), true);
                $bis = json_decode((string) ($row['ende_bis'] ?? 'null'), true);
                return is_array($von) && is_array($bis) ? ['from' => $von, 'to' => $bis] : null;
            })(),
            'enden' => ($row['ende_von'] ?? null) === null ? null : [
                'von' => avesmapsWegEndeName(json_decode((string) $row['ende_von'], true), $ortIndex),
                'bis' => avesmapsWegEndeName(json_decode((string) $row['ende_bis'], true), $ortIndex),
            ],
```

- [ ] **Step 4: Umsetzen, Editor**

In `js/pages/wege-editor.js`:

1. `segmentRow`: `: '<span class="avm-row__name">Abschnitt ' + index + "</span>";` ersetzen durch

```js
			: '<span class="avm-row__name">' + escapeHtml(wpAbschnittLabel(way, index)) + "</span>";
```

2. `renderList`, Gruppenkopf: `var second = '<div class="avm-row__l2">' + group.segments.length + " Abschnitte · "` ersetzen durch

```js
			var strecke = wpGanzeStrecke(group.segments);
			var second = '<div class="avm-row__l2">' + group.segments.length + " Abschnitte · "
				+ (strecke ? escapeHtml(strecke) + " · " : "")
```

(die Fortsetzung `+ (withProfile === …` bleibt).

3. `renderGroupDetail`, Liste „Die Abschnitte": `'<span class="wp-share__name">Abschnitt ' + (index + 1) + "</span>"` ersetzen durch

```js
				+ '<span class="wp-share__name">' + escapeHtml(wpAbschnittLabel(segment, index + 1)) + "</span>"
```

4. `weitereAbschnitte` (Task 7): `label: nummer ? "Abschnitt " + nummer : "dieser Abschnitt",` ersetzen durch

```js
				label: wpAbschnittLabel(way, nummer) || "dieser Abschnitt",
```

5. `wireDetail` (Task 7): Den Umfangstext `"diesen Abschnitt"` durch den Namen ersetzen:

```js
			var umfangAbschnitt = weitereAbschnitte([eigenerWeg])[0].label;
			mountWikiWeitere("wpWikiWeitere", [eigenerWeg], umfangAbschnitt, function () { return selectWay(state.selected, true); });
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node js/pages/__tests__/wege-editor-abschnittsnamen.test.js`, `node js/ui/__tests__/wiki-assign-weg.test.js`, `node js/pages/__tests__/wege-weitere-liste.test.js`, `php -l api/edit/map/paths-editor.php`
Expected: grün, `No syntax errors detected`.

- [ ] **Step 6: Nach dem Push messen (eine Anfrage, Owner-Sitzung)**

Im Wege-Editor die Netzwerkzeile `paths-editor.php?action=list` ansehen:
- Die Antwortzeit darf gegenüber vorher nicht sprunghaft steigen. Vorher und nachher je einmal ablesen und beide Zahlen im Commit der Lieferung nennen.
- Stichprobe: Die Reichsstraße 2 zeigt „Abschnitt N: Ort – Ort" und im Kopf „Perz – Helmdahl"-artige Enden.
- Endet ein Abschnitt als „Wegende", obwohl auf der Karte ein Ort daran liegt, liegt der Ort weiter als 0,01 vom Linienende. Das ist ein Datenbefund und kein Anzeigefehler; melden, nicht überbrücken.

- [ ] **Step 7: Commit**

```bash
printf '%s\n' "feat(wege-editor): Abschnitte heissen \"Abschnitt N: Ort – Ort\", der Weg nennt seine Enden" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/edit/map/paths-editor.php js/pages/wege-editor.js js/pages/__tests__/wege-editor-abschnittsnamen.test.js && git commit -F "$SCRATCH/msg.txt"
```

**🚚 Lieferung 3:** Tasks 8 und 9 live (sichtbar im Wege-Editor). Owner schaut.

---

## Task 10: Suche und „Anzeigen" finden Abschnitte auch über weitere Zuweisungen

**Files:**
- Modify: `api/app/map-search.php`: `avesmapsBuildSearchResult` (optionale Felder), Pfad-Treffer (`'wiki_key'`), neue Funktionen `avesmapsBuildSearchWeitereEntries` und `avesmapsSearchMergePathEntry`, Zeilenschleife (Z. 251-278)
- Modify: `js/ui/spotlight-search.js`: `buildSpotlightPathEntries` (zweiter Durchgang), `getSpotlightSearchLookup` (`byPathWikiKey`), `resolveBackendSpotlightEntries`
- Modify: `js/app/wiki-deeplink.js`: `spotlightEntryWikiKeys`, `pathMatchesDeeplinkTarget`, `focusWholeWikiDeeplinkPath`, neue Funktion `deeplinkWeitererTreffer`
- Create: `api/app/__tests__/wege-suche-weitere-test.php`
- Create: `js/ui/__tests__/wege-suche-weitere.test.js`
- Create: `js/app/__tests__/deeplink-weitere.test.js`

**Interfaces:**
- Produces:
  - Server-Pfadtreffer tragen `wiki_key` (Haupt- oder weiterer Artikel). Treffer aus weiteren Zuweisungen gruppieren unter `group_key = "weitere:<key>"`.
  - Browser-Eintrag `path:wiki:<key>` sammelt Haupt- **und** Träger-Abschnitte. Träger stehen in `paths`, **nicht** in `publicIds`.
  - `deeplinkWeitererTreffer(targetKey) -> {path, eintrag}|null`.

💣 **Warum die Träger nicht in `publicIds` stehen:** `getSpotlightSearchLookup` registriert Kennungen nach „first writer wins". Ein Reichsstraßen-Abschnitt, der zuerst beim Bärenpfad-Eintrag registriert wird, ließe den Servertreffer „Reichsstraße 2" den Bärenpfad öffnen. Servertreffer mit `wiki_key` werden deshalb **zuerst** über `byPathWikiKey` aufgelöst.

- [ ] **Step 1: PHP-Test schreiben**

`api/app/__tests__/wege-suche-weitere-test.php`:

```php
<?php

declare(strict_types=1);

// Kartensuche: Treffer aus weiteren Wiki-Zuweisungen (Entwurf 2026-09-14 §2.4). map-search.php ist ein
// Endpunkt und laesst sich nicht einbinden -- die Funktionen werden per Tokenizer herausgeschnitten.
// Aus der Wurzel: php -d zend.assertions=1 -d assert.exception=1 api/app/__tests__/wege-suche-weitere-test.php

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "zend.assertions=1 noetig\n");
    exit(2);
}

$quelle = (string) file_get_contents(__DIR__ . '/../map-search.php');

function schneideFunktion(string $quelle, string $name): string {
    $start = strpos($quelle, "\nfunction $name(");
    assert($start !== false, "$name nicht gefunden");
    $tiefe = 0;
    $offen = false;
    for ($i = strpos($quelle, '{', $start); $i < strlen($quelle); $i++) {
        if ($quelle[$i] === '{') { $tiefe++; $offen = true; }
        if ($quelle[$i] === '}' && --$tiefe === 0 && $offen) {
            return substr($quelle, $start, $i - $start + 1);
        }
    }
    throw new RuntimeException("$name nicht geschlossen");
}

function avesmapsDecodeJsonColumnForSearch(mixed $wert): array { return is_string($wert) ? (json_decode($wert, true) ?: []) : []; }
function avesmapsNormalizeSingleLine(string $wert, int $laenge): string { return mb_substr(trim($wert), 0, $laenge); }
function avesmapsPathSearchTypeLabel(string $subtype): string { return $subtype; }

foreach (['avesmapsBuildSearchResult', 'avesmapsExtendSearchResultBounds', 'avesmapsBuildSearchWeitereEntries', 'avesmapsSearchMergePathEntry'] as $name) {
    eval(schneideFunktion($quelle, $name));
}

$zeile = [
    'public_id' => 'rs-7', 'feature_type' => 'path', 'feature_subtype' => 'Reichsstrasse',
    'min_x' => 1, 'min_y' => 2, 'max_x' => 3, 'max_y' => 4,
    'properties_json' => json_encode([
        'wiki_path' => ['wiki_key' => 'reichsstrasse-2', 'name' => 'Reichsstraße 2'],
        'wiki_path_weitere' => [['wiki_key' => 'b-renpfad', 'name' => 'Bärenpfad'], ['wiki_key' => '', 'name' => 'leer'], 'kaputt'],
    ]),
];

$weitere = avesmapsBuildSearchWeitereEntries($zeile);
assert(count($weitere) === 1);
assert($weitere[0]['name'] === 'Bärenpfad' && $weitere[0]['wiki_key'] === 'b-renpfad', json_encode($weitere[0]));
assert($weitere[0]['group_key'] === 'weitere:b-renpfad' && $weitere[0]['kind'] === 'path' && $weitere[0]['public_ids'] === ['rs-7']);
assert(avesmapsBuildSearchWeitereEntries(['feature_type' => 'location', 'properties_json' => $zeile['properties_json']]) === []);
assert(avesmapsBuildSearchWeitereEntries(['feature_type' => 'path', 'properties_json' => '{"wiki_path":{}}']) === [], 'ohne Liste nichts');

$gruppen = [];
avesmapsSearchMergePathEntry($gruppen, $weitere[0], 30);
$zweiter = $weitere[0];
$zweiter['public_id'] = 'rs-8';
$zweiter['min_x'] = -5;
avesmapsSearchMergePathEntry($gruppen, $zweiter, 10);
assert(count($gruppen) === 1 && $gruppen['weitere:b-renpfad']['public_ids'] === ['rs-7', 'rs-8']);
assert($gruppen['weitere:b-renpfad']['score'] === 10 && $gruppen['weitere:b-renpfad']['min_x'] === -5.0);

// Der Haupttreffer traegt seinen Schluessel; die Zeilenschleife nutzt beide Wege.
$hauptZweig = schneideFunktion($quelle, 'avesmapsBuildSearchEntry');
assert(preg_match("/'wiki_key'\s*=>\s*\(string\)\s*\(\\\$wikiPath\['wiki_key'\] \?\? ''\)/", $hauptZweig) === 1, 'der Haupttreffer traegt wiki_key');
assert(str_contains($quelle, 'foreach (avesmapsBuildSearchWeitereEntries($row) as $weiterer)'));
assert(substr_count($quelle, 'avesmapsSearchMergePathEntry($pathGroups') === 2, 'Haupt- und weiterer Treffer laufen durch denselben Zusammenfuehrer');

echo "wege-suche-weitere-test.php: ok\n";
```

- [ ] **Step 2: PHP umsetzen**

In `api/app/map-search.php`:

1. `avesmapsBuildSearchResult`: `foreach (['min_zoom', 'max_zoom', 'show_label', 'group_key'] as $optionalField)` wird zu `foreach (['min_zoom', 'max_zoom', 'show_label', 'group_key', 'wiki_key'] as $optionalField)`.
2. Im Pfadzweig von `avesmapsBuildSearchEntry` nach `'group_key' => avesmapsNormalizePathSearchGroupKey($displayName, $featureSubtype),` einfügen:

```php
            // Entwurf 2026-09-14 §2.4: der Browser loest Wegtreffer zuerst ueber den Artikel auf.
            'wiki_key' => (string) ($wikiPath['wiki_key'] ?? ''),
```

3. Nach `avesmapsBuildSearchEntry` die zwei Funktionen einfügen:

```php
/**
 * Treffer aus den WEITEREN Wiki-Zuweisungen eines Wegabschnitts (Entwurf 2026-09-14 §2.4): ein Abschnitt der
 * Reichsstrasse, der auch zum Baerenpfad gehoert, wird unter „Bärenpfad" gefunden.
 * ⚠️ Eigener Gruppenschluessel `weitere:<key>`: der Haupttreffer gruppiert nach Wegtyp+Name, und der Abschnitt
 * traegt den Wegtyp der Reichsstrasse. Der Browser fuehrt beide ueber `wiki_key` zu EINEM Eintrag zusammen.
 * @return list<array>
 */
function avesmapsBuildSearchWeitereEntries(array $row): array {
    if ((string) ($row['feature_type'] ?? '') !== 'path' || !str_contains((string) ($row['properties_json'] ?? ''), 'wiki_path_weitere')) {
        return [];
    }
    $properties = avesmapsDecodeJsonColumnForSearch($row['properties_json'] ?? null);
    $featureSubtype = (string) ($row['feature_subtype'] ?? '');
    $treffer = [];
    foreach ((is_array($properties['wiki_path_weitere'] ?? null) ? $properties['wiki_path_weitere'] : []) as $eintrag) {
        $key = is_array($eintrag) ? trim((string) ($eintrag['wiki_key'] ?? '')) : '';
        $name = is_array($eintrag) ? avesmapsNormalizeSingleLine((string) ($eintrag['name'] ?? ''), 160) : '';
        if ($key === '' || $name === '') {
            continue;
        }
        $treffer[] = avesmapsBuildSearchResult($row, [
            'kind' => 'path',
            'name' => $name,
            'type_label' => avesmapsPathSearchTypeLabel($featureSubtype),
            'feature_subtype' => $featureSubtype,
            'public_ids' => [(string) ($row['public_id'] ?? '')],
            'group_key' => 'weitere:' . $key,
            'wiki_key' => $key,
            'search_texts' => [$name, $featureSubtype],
            'show_label' => true,
        ]);
    }
    return $treffer;
}

/** Wegtreffer derselben Gruppe zusammenfuehren: Kennungen sammeln, bester Score, Huellbox erweitern. */
function avesmapsSearchMergePathEntry(array &$pathGroups, array $entry, int $score): void {
    $pathKey = (string) ($entry['group_key'] ?? '');
    if (!isset($pathGroups[$pathKey])) {
        $entry['score'] = $score;
        $pathGroups[$pathKey] = $entry;
        return;
    }
    $pathGroups[$pathKey]['public_ids'][] = (string) $entry['public_id'];
    $pathGroups[$pathKey]['score'] = min((int) $pathGroups[$pathKey]['score'], $score);
    $pathGroups[$pathKey] = avesmapsExtendSearchResultBounds($pathGroups[$pathKey], $entry);
}
```

4. In der Zeilenschleife direkt nach `foreach ($rows as $row) {` einfügen:

```php
        // Entwurf 2026-09-14 §2.4: auch unter jedem Artikel seiner weiteren Wiki-Zuweisungen auffindbar.
        foreach (avesmapsBuildSearchWeitereEntries($row) as $weiterer) {
            $weitererScore = avesmapsCalculateSearchScore($weiterer, $normalizedQuery);
            if ($weitererScore !== null) {
                avesmapsSearchMergePathEntry($pathGroups, $weiterer, $weitererScore);
            }
        }
```

und den bisherigen Block `if ($entry['kind'] === 'path') { … }` (Z. 262-278) ersetzen durch:

```php
        if ($entry['kind'] === 'path') {
            if ((string) ($entry['group_key'] ?? '') !== '') {
                avesmapsSearchMergePathEntry($pathGroups, $entry, $score);
            }
            continue;
        }
```

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/app/__tests__/wege-suche-weitere-test.php`, `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/app/__tests__/wege-suche-manueller-name-test.php`, `php -l api/app/map-search.php`
Expected: grün.

- [ ] **Step 3: JS-Tests schreiben**

`js/ui/__tests__/wege-suche-weitere.test.js`:

```js
"use strict";
// Spotlight: ein Abschnitt gehoert auch zum Eintrag seiner weiteren Wiki-Zuweisungen (Entwurf 2026-09-14 §2.4).
// Aus der Wurzel: node js/ui/__tests__/wege-suche-weitere.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8").replace(/\r\n/g, "\n");
const schneide = (name) => {
	const treffer = quelle.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(treffer, name + " nicht gefunden");
	return treffer[0] + "\n";
};

const kontext = {
	Map, String, Array,
	normalizePathSubtype: (wert) => String(wert || "Weg"),
	getPathTitleName: (p) => (p.properties.wiki_path && p.properties.wiki_path.name) || p.properties.display_name || "",
	getPathDisplayName: (p) => p.properties.display_name || "",
	getSpotlightPathTypeLabel: (p, subtype) => subtype,
	normalizeSpotlightSearchText: (wert) => String(wert || "").toLowerCase(),
	extendSpotlightBounds: () => null,
	getSpotlightPathBounds: () => null,
	getPathPublicId: (p) => p.properties.public_id,
	pathData: [],
};
vm.createContext(kontext);
vm.runInContext(schneide("getSpotlightPathGroupKey") + schneide("getSpotlightPathGroupKeyForPath") + schneide("buildSpotlightPathEntries"), kontext);

const weg = (id, subtype, haupt, weitere) => ({ properties: { public_id: id, feature_subtype: subtype, display_name: haupt.name,
	wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: "https://x/" + haupt.key }, wiki_path_weitere: weitere } });
const rs = { key: "reichsstrasse-2", name: "Reichsstraße 2" };
const bpEintrag = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/b-renpfad" };
kontext.pathData = [
	weg("rs-7", "Reichsstrasse", rs, [bpEintrag]),      // traegt den Baerenpfad zusaetzlich, steht ZUERST
	weg("bp-1", "Pfad", { key: "b-renpfad", name: "Bärenpfad" }, []),
	weg("rs-6", "Reichsstrasse", rs, [{ wiki_key: "geronsgang", name: "Geronsgang", wiki_url: "https://x/geronsgang" }]),
];
const eintraege = Array.from(vm.runInContext("buildSpotlightPathEntries()", kontext));
const nach = (id) => eintraege.find((e) => e.id === id);

assert.deepStrictEqual(nach("path:wiki:reichsstrasse-2").publicIds, ["rs-7", "rs-6"]);
const bp = nach("path:wiki:b-renpfad");
assert.deepStrictEqual(bp.paths.map((p) => p.properties.public_id), ["bp-1", "rs-7"], "der Baerenpfad umfasst seinen Traeger");
assert.deepStrictEqual(bp.publicIds, ["bp-1"], "Traeger stehen NICHT in publicIds (first writer wins)");
assert.strictEqual(bp.subtype, "Pfad", "der Wegtyp kommt von den eigenen Abschnitten, nicht vom zuerst gelesenen Traeger");
const geron = nach("path:wiki:geronsgang");
assert.ok(geron && geron.name === "Geronsgang" && geron.subtype === "Reichsstrasse", "ein Artikel NUR aus weiteren Zuweisungen bekommt einen Eintrag");
assert.deepStrictEqual(geron.publicIds, []);

// Die Aufloesung von Servertreffern: wiki_key zuerst
const ohne = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const aufloesen = ohne(schneide("resolveBackendSpotlightEntries"));
const lookup = ohne(schneide("getSpotlightSearchLookup"));
assert.ok(/byPathWikiKey\.set\(/.test(lookup) && lookup.includes('"path:wiki:"'), "der Index kennt Wegeintraege nach Artikel");
assert.ok(aufloesen.indexOf("byPathWikiKey.get(") >= 0 && aufloesen.indexOf("byPathWikiKey.get(") < aufloesen.indexOf("byPublicId.get("),
	"ein Wegtreffer mit wiki_key wird VOR der Kennungssuche ueber den Artikel aufgeloest");

console.log("wege-suche-weitere.test.js: ok");
```

`js/app/__tests__/deeplink-weitere.test.js`:

```js
"use strict";
// „Anzeigen" und ?strasse=: auch die Abschnitte mit dem Artikel als weitere Zuweisung (Entwurf 2026-09-14 §2.4).
// Aus der Wurzel: node js/app/__tests__/deeplink-weitere.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "..", "wiki-deeplink.js"), "utf8").replace(/\r\n/g, "\n");
const schneide = (name) => {
	const start = quelle.indexOf("\nfunction " + name + "(");
	assert.ok(start >= 0, name + " nicht gefunden");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i++) {
		if (quelle[i] === "{") tiefe++;
		if (quelle[i] === "}" && --tiefe === 0) return quelle.slice(start, i + 1) + "\n";
	}
	throw new Error("offen: " + name);
};

const gezeigt = [];
const kontext = {
	normalizePathSubtype: (wert) => String(wert || "Weg"),
	focusSpotlightPath: (eintrag) => gezeigt.push(eintrag),
	suppressPlannerUrlSyncForWikiDeeplink: () => {},
	getSpotlightPathGroupKeyForPath: (p) => "wiki:" + p.properties.wiki_path.wiki_key,
	pathData: [],
};
vm.createContext(kontext);
vm.runInContext(["normalizeWikiDeeplinkKey", "wikiUrlToDeeplinkKey", "spotlightEntryWikiKeys", "subtypeOfPath", "exactPathNameKey",
	"pathMatchesDeeplinkTarget", "deeplinkWeitererTreffer", "focusWholeWikiDeeplinkPath"].map(schneide).join(""), kontext);

const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
// wiki_key ausdruecklich, wie der Server ihn bildet (avesmapsPoliticalSlug faltet Umlaute zu „-": b-renpfad)
const weg = (id, subtype, hauptSeite, hauptKey, weitere = []) => ({ properties: { public_id: id, feature_subtype: subtype, display_name: hauptSeite,
	wiki_path: { wiki_key: hauptKey, wiki_url: url(hauptSeite) }, wiki_path_weitere: weitere } });
kontext.pathData = [
	weg("rs-7", "Reichsstrasse", "Reichsstraße_2", "reichsstrasse-2",
		[{ wiki_key: "b-renpfad", wiki_url: url("Bärenpfad") }, { wiki_key: "geronsgang", wiki_url: url("Geronsgang") }]),
	weg("rs-6", "Reichsstrasse", "Reichsstraße_2", "reichsstrasse-2"),
	weg("bp-1", "Pfad", "Bärenpfad", "b-renpfad"),
];
const schluessel = (seite) => vm.runInContext("wikiUrlToDeeplinkKey", kontext)(url(seite));
const zeige = (seite) => { gezeigt.length = 0; assert.ok(vm.runInContext("focusWholeWikiDeeplinkPath", kontext)(schluessel(seite))); return gezeigt[0]; };

assert.deepStrictEqual(zeige("Bärenpfad").paths.map((p) => p.properties.public_id).sort(), ["bp-1", "rs-7"], "Baerenpfad samt Traeger");
assert.deepStrictEqual(zeige("Reichsstraße_2").paths.map((p) => p.properties.public_id).sort(), ["rs-6", "rs-7"], "die Reichsstrasse ohne den Baerenpfad");
const geron = zeige("Geronsgang");
assert.deepStrictEqual(geron.paths.map((p) => p.properties.public_id), ["rs-7"], "ein Artikel nur aus weiteren Zuweisungen");
assert.strictEqual(geron.id, "path:wiki:geronsgang", "und seine Auswahl heisst nach dem Artikel, nicht nach der Reichsstrasse");

// spotlightEntryWikiKeys: ein Wegeintrag nennt nur SEINEN Artikel -- ein ?strasse=Reichsstraße_2 darf nicht den Baerenpfad treffen
const keys = vm.runInContext("spotlightEntryWikiKeys", kontext)({ kind: "path", id: "path:wiki:b-renpfad", paths: [kontext.pathData[2], kontext.pathData[0]] });
assert.deepStrictEqual(keys, [schluessel("Bärenpfad"), schluessel("Bärenpfad")]);

console.log("deeplink-weitere.test.js: ok");
```

- [ ] **Step 4: JS-Tests laufen lassen, sie müssen scheitern**

Run: `node js/ui/__tests__/wege-suche-weitere.test.js` und `node js/app/__tests__/deeplink-weitere.test.js`
Expected: FAIL `der Baerenpfad umfasst seinen Traeger` bzw. `deeplinkWeitererTreffer nicht gefunden`

- [ ] **Step 5: JS umsetzen**

In `js/ui/spotlight-search.js`, `buildSpotlightPathEntries`: direkt vor `return Array.from(pathGroups.values());` einfügen:

```js
	// Entwurf 2026-09-14 §2.4: ein Abschnitt gehoert AUCH zu jedem Artikel seiner weiteren Wiki-Zuweisungen.
	// ZWEITER Durchgang, damit eine Gruppe mit eigenen Abschnitten Name und Wegtyp von DENEN bekommt.
	// 💣 Die Traeger landen in `paths`, NICHT in `publicIds`: getSpotlightSearchLookup registriert Kennungen
	// nach „first writer wins", und ein Reichsstrassen-Abschnitt beim Baerenpfad-Eintrag liesse den
	// Servertreffer „Reichsstraße 2" den Baerenpfad oeffnen.
	pathData.forEach((path) => {
		const weitere = Array.isArray(path?.properties?.wiki_path_weitere) ? path.properties.wiki_path_weitere : [];
		if (!weitere.length) {
			return;
		}
		const subtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
		weitere.forEach((eintrag) => {
			const key = String(eintrag?.wiki_key || "").trim();
			const name = String(eintrag?.name || "").trim();
			if (!key || !name) {
				return;
			}
			const groupKey = `wiki:${key}`;
			if (!pathGroups.has(groupKey)) {
				pathGroups.set(groupKey, {
					id: `path:${groupKey}`,
					kind: "path",
					name,
					typeLabel: getSpotlightPathTypeLabel(path, subtype),
					subtype,
					publicIds: [],
					paths: [],
					bounds: null,
					aliases: [subtype, eintrag.wiki_url],
				});
			}
			const group = pathGroups.get(groupKey);
			group.paths.push(path);
			group.bounds = extendSpotlightBounds(group.bounds, getSpotlightPathBounds(path));
		});
	});
```

In `getSpotlightSearchLookup`: neben `const byPathGroup = new Map();` die Zeile `const byPathWikiKey = new Map();`. Im Block `if (entry.kind === "path") { byPathGroup.set(…); }` ergänzen:

```js
			// Entwurf 2026-09-14 §2.4: Servertreffer tragen wiki_key und finden ihren Eintrag daran.
			if (String(entry.id || "").startsWith("path:wiki:")) {
				byPathWikiKey.set(String(entry.id).slice("path:wiki:".length), entry);
			}
```

`spotlightSearchLookupCache = { byPublicId, byPathGroup, byLorePlace };` wird zu `spotlightSearchLookupCache = { byPublicId, byPathGroup, byPathWikiKey, byLorePlace };`.

In `resolveBackendSpotlightEntries`: `const { byPublicId, byPathGroup } = getSpotlightSearchLookup();` wird zu `const { byPublicId, byPathGroup, byPathWikiKey } = getSpotlightSearchLookup();`. Die Kennungsschleife `for (const publicId of publicIds) { … }` ersetzen durch:

```js
		// Entwurf 2026-09-14 §2.4: ein Wegtreffer nennt seinen Artikel -- das ist eindeutiger als eine Kennung,
		// denn ein Abschnitt kann zu mehreren Artikeln gehoeren.
		if (kind === "path" && result.wiki_key && byPathWikiKey) {
			entry = byPathWikiKey.get(String(result.wiki_key)) || null;
		}
		if (!entry) {
			for (const publicId of publicIds) {
				entry = byPublicId.get(`${kind}:${publicId}`);
				if (entry) {
					break;
				}
			}
		}
```

In `js/app/wiki-deeplink.js`:

1. `spotlightEntryWikiKeys`, Zweig `entry.kind === "path"` ersetzen durch:

```js
	} else if (entry.kind === "path") {
		// Entwurf 2026-09-14 §2.4: ein Wegeintrag nennt nur SEINEN Artikel. Ein Traeger-Abschnitt steht mit
		// seiner Hauptzuweisung (einem ANDEREN Artikel) in entry.paths -- dessen Adresse zu nennen liesse
		// ?strasse=Reichsstraße_2 den Baerenpfad-Eintrag treffen.
		const eigenerKey = String(entry.id || "").startsWith("path:wiki:") ? String(entry.id).slice("path:wiki:".length) : "";
		(entry.paths || []).forEach((path) => {
			if (!eigenerKey || path?.properties?.wiki_path?.wiki_key === eigenerKey) {
				pushKey(path?.properties?.wiki_path?.wiki_url);
				return;
			}
			const weiterer = (Array.isArray(path?.properties?.wiki_path_weitere) ? path.properties.wiki_path_weitere : [])
				.find((eintrag) => eintrag?.wiki_key === eigenerKey);
			if (weiterer) {
				pushKey(weiterer.wiki_url);
			}
		});
```

2. `pathMatchesDeeplinkTarget`: nach dem ersten `if (…wiki_path?.wiki_url) === targetKey) { return true; }` einfügen:

```js
	// Entwurf 2026-09-14 §2.4: eine WEITERE Zuweisung ist ebenfalls Weg-Identitaet des Artikels.
	if ((Array.isArray(path?.properties?.wiki_path_weitere) ? path.properties.wiki_path_weitere : [])
		.some((eintrag) => wikiUrlToDeeplinkKey(eintrag?.wiki_url) === targetKey)) {
		return true;
	}
```

3. Vor `function focusWholeWikiDeeplinkPath` einfügen:

```js
// Der erste Abschnitt, der den Artikel als WEITERE Zuweisung traegt (Entwurf 2026-09-14 §2.4) -- fuer Artikel,
// die nur so auf der Karte liegen (ein Pilgerweg ganz ueber fremden Strassen).
function deeplinkWeitererTreffer(targetKey) {
	for (const path of pathData) {
		const eintrag = (Array.isArray(path?.properties?.wiki_path_weitere) ? path.properties.wiki_path_weitere : [])
			.find((kandidat) => wikiUrlToDeeplinkKey(kandidat?.wiki_url) === targetKey);
		if (eintrag) {
			return { path, eintrag };
		}
	}
	return null;
}
```

4. In `focusWholeWikiDeeplinkPath` den Anker-Block ersetzen:

```js
	// Anchor: prefer a wiki_url hit (most reliable), then a WEITERE assignment (Entwurf 2026-09-14 §2.4),
	// else the first exact-name hit -- all number-sensitive.
	const hauptAnker = pathData.find((path) => wikiUrlToDeeplinkKey(path?.properties?.wiki_path?.wiki_url) === targetKey) || null;
	const weitererTreffer = hauptAnker ? null : deeplinkWeitererTreffer(targetKey);
	const anchor = hauptAnker
		|| (weitererTreffer && weitererTreffer.path)
		|| pathData.find((path) => exactPathNameKey(path) === targetKey)
		|| null;
```

und die Zeile `const groupKey = typeof getSpotlightPathGroupKeyForPath === "function"` samt Fortsetzung ersetzen durch:

```js
	// Ein Artikel NUR aus weiteren Zuweisungen heisst nach sich selbst, nicht nach der Strasse, die ihn traegt.
	const groupKey = weitererTreffer
		? `wiki:${weitererTreffer.eintrag.wiki_key}`
		: (typeof getSpotlightPathGroupKeyForPath === "function" ? getSpotlightPathGroupKeyForPath(anchor, matchedSubtype) : "");
```

- [ ] **Step 6: Tests laufen lassen**

Run:
- `node js/ui/__tests__/wege-suche-weitere.test.js`
- `node js/app/__tests__/deeplink-weitere.test.js`
- `node js/ui/__tests__/wege-suche-manueller-name.test.js`
- `node tools/paths/test-wiki-deeplink-url-preserve.mjs`
- `node js/app/__tests__/deeplink-oeffnet-infobox.test.js`
- `node js/app/__tests__/nur-editor-skripte.test.js`

Expected: alle grün.

- [ ] **Step 7: Commit**

```bash
printf '%s\n' "feat(suche): Wege sind auch unter den Artikeln ihrer weiteren Wiki-Zuweisungen auffindbar, \"Anzeigen\" hebt diese Abschnitte mit hervor" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add api/app/map-search.php js/ui/spotlight-search.js js/app/wiki-deeplink.js api/app/__tests__/wege-suche-weitere-test.php js/ui/__tests__/wege-suche-weitere.test.js js/app/__tests__/deeplink-weitere.test.js && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 11: Infobox-Zeilen „Auch Teil von" und „Verläuft auch über"

**Files:**
- Create: `js/map-features/weg-weitere-anzeige.js`
- Create: `js/map-features/__tests__/weg-weitere-anzeige.test.js`
- Modify: `js/map-features/map-features-path-rendering.js:70` (Platzhalter nach der Lage-Zeile)
- Modify: `js/map-features/map-features-infopanel.js:725-735` (`avesmapsShowPathInInfopanel` füllt ihn)
- Modify: `css/features/route-planner.css` (nach `.avesmaps-path-landscapes`)
- Modify: `index.html` (Skript-Tag direkt nach `js/map-features/weg-abschnitte.js`)

**Interfaces:**
- Consumes: Task 8 (`avesmapsWegKartenStand`, `avesmapsWegGruppenAufKarte`, `avesmapsWegAbschnittAufKarte`); `wpAbschnittLabel`; `pathItemStationLinkMarkup(text, {kind, ref})` (`map-features-path-item-links.js:177`, Klick → `focusPathItemStation("path", ref)` → `focusWholeWikiDeeplinkPath`); `wikiUrlToDeeplinkKey`; `getPathPublicId`; `escapeHtml`
- Produces:
  - `avesmapsWegWeiterePlatzhalter(publicId) -> string`
  - `avesmapsWegWeitereZeilen({auchTeil, verlaeuftUeber}, linkMarkup) -> string` (rein; Einträge `{name, ref, zusatz}`)
  - `avesmapsWegWeitereZeilenMarkup(path, auswahl) -> string`
  - `avesmapsWegWeitereFuellen(markup, path) -> string`

⚠️ **Platzhalter statt fertiger Zeilen:** Das Popup-Markup entsteht für alle Wege beim Kartenaufbau und wird zwischengespeichert (`path._popupMarkup`). Die Zeilen hängen an der ganzen Wegeliste (wer trägt diesen Artikel?) und an der Auswahl (Task 13). Deshalb füllt sie erst das Öffnen der Infobox, dieselbe Bauart wie „Führt durch".

- [ ] **Step 1: Test schreiben**

```js
"use strict";
// Infobox: „Auch Teil von" / „Verläuft auch über" (Entwurf 2026-09-14 §2.4, §3.4).
// Aus der Wurzel: node js/map-features/__tests__/weg-weitere-anzeige.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	escapeHtml: (w) => String(w).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	pathItemStationLinkMarkup: (text, treffer) => `<button data-station-kind="${treffer.kind}" data-station-ref="${treffer.ref}">${text}</button>`,
	wikiUrlToDeeplinkKey: (url) => String(url || "").split("/wiki/")[1] || "",
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: () => false,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: false,
});
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
const A = require(path.join(WURZEL, "js/map-features/weg-weitere-anzeige.js"));

// 1. Rein
const zeilen = A.avesmapsWegWeitereZeilen({
	auchTeil: [{ name: "Bärenpfad", ref: "Baerenpfad", zusatz: "" }],
	verlaeuftUeber: [{ name: "Reichsstraße 2", ref: "", zusatz: "Abschnitt 2: Silkwiesen – Wieha" }],
}, global.pathItemStationLinkMarkup);
assert.ok(zeilen.includes("<dt>Auch Teil von</dt>") && zeilen.includes('data-station-ref="Baerenpfad"'));
assert.ok(zeilen.includes("<dt>Verläuft auch über</dt><dd>Reichsstraße 2 (Abschnitt 2: Silkwiesen – Wieha)</dd>"), "ohne Adresse reiner Text: " + zeilen);
assert.strictEqual(A.avesmapsWegWeitereZeilen({ auchTeil: [], verlaeuftUeber: [] }, global.pathItemStationLinkMarkup), "");

// 2. Gegen eine kleine Karte
global.locationData = [{ name: "Perz", coordinates: [0, 0] }, { name: "Silkwiesen", coordinates: [0, 1] }, { name: "Wieha", coordinates: [0, 2] }];
const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
const weg = (id, von, bis, haupt, weitere = []) => ({ properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "X-" + id,
	display_name: haupt.name, wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: url(haupt.seite) }, wiki_path_weitere: weitere },
	geometry: { coordinates: [von, bis] } });
const rs = { key: "reichsstrasse-2", name: "Reichsstraße 2", seite: "Reichsstrasse_2" };
const bp = { key: "b-renpfad", name: "Bärenpfad", seite: "Baerenpfad" };
global.pathData = [
	weg("rs-6", [0, 0], [1, 0], rs),
	weg("rs-7", [1, 0], [2, 0], rs, [{ wiki_key: bp.key, name: bp.name, wiki_url: url(bp.seite) }]),
	weg("bp-1", [5, 5], [6, 6], bp),
];
const [rs6, rs7, bp1] = global.pathData;

assert.ok(A.avesmapsWegWeitereZeilenMarkup(rs7, null).includes('data-station-ref="Baerenpfad">Bärenpfad</button>'), "der Abschnitt nennt seine weitere Zuweisung");
assert.strictEqual(A.avesmapsWegWeitereZeilenMarkup(rs6, null), "", "ohne weitere Zuweisung und ohne Traeger keine Zeile");
const vomBaerenpfad = A.avesmapsWegWeitereZeilenMarkup(bp1, null);
assert.ok(vomBaerenpfad.includes("<dt>Verläuft auch über</dt>"), vomBaerenpfad);
assert.ok(vomBaerenpfad.includes('data-station-ref="Reichsstrasse_2">Reichsstraße 2</button> (Abschnitt 2: Silkwiesen – Wieha)'), vomBaerenpfad);
const ganz = A.avesmapsWegWeitereZeilenMarkup(rs6, { gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.ok(ganz.includes("Bärenpfad</button> (Abschnitt 2: Silkwiesen – Wieha)"), "ganze Strasse: mit dem Abschnitt, der ihn traegt: " + ganz);

// 3. Fuellen ersetzt genau den Platzhalter
const markup = "<dl>" + A.avesmapsWegWeiterePlatzhalter("rs-7") + "</dl>";
const gefuellt = A.avesmapsWegWeitereFuellen(markup, rs7);
assert.ok(gefuellt.includes('<div class="avesmaps-path-weitere" data-path-weitere="rs-7"><div class="region-info-box__row"><dt>Auch Teil von</dt>'), gefuellt);
assert.strictEqual(A.avesmapsWegWeitereFuellen("<dl></dl>", rs7), "<dl></dl>", "ohne Platzhalter unveraendert");

// 4. Verdrahtung
const rendering = lies("js/map-features/map-features-path-rendering.js");
const lage = rendering.indexOf('rows += lageHtml ? rowHtml("Lage", lageHtml) : row("Lage", wiki.lage);');
assert.ok(lage > 0 && rendering.indexOf("avesmapsWegWeiterePlatzhalter(getPathPublicId(path))", lage) > lage
	&& rendering.indexOf("avesmapsWegWeiterePlatzhalter(getPathPublicId(path))", lage) < rendering.indexOf('row("Länge"', lage),
	"der Platzhalter steht direkt nach der Lage-Zeile");
const panel = lies("js/map-features/map-features-infopanel.js");
const zeige = panel.slice(panel.indexOf("window.avesmapsShowPathInInfopanel = function"), panel.indexOf("window.avesmapsShowInfopanel(markup);", panel.indexOf("window.avesmapsShowPathInInfopanel = function")));
assert.ok(zeige.includes("avesmapsWegWeitereFuellen(markup, path)"), "das Infopanel fuellt den Platzhalter vor dem Anzeigen");

console.log("weg-weitere-anzeige.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/map-features/__tests__/weg-weitere-anzeige.test.js`
Expected: FAIL `Cannot find module '…/weg-weitere-anzeige.js'`

- [ ] **Step 3: Umsetzen, Modul**

`js/map-features/weg-weitere-anzeige.js`:

```js
// Die Infobox-Zeilen der weiteren Wiki-Zuweisungen (Entwurf 2026-09-14 §2.4, §3.4):
//   „Auch Teil von"      -- die weiteren Artikel DIESES Abschnitts (bei markierter ganzer Strasse: aller ihrer Abschnitte)
//   „Verläuft auch über" -- fremde Abschnitte, die den Hauptartikel dieses Wegs als WEITERE Zuweisung tragen
// Ein Klick hebt den ganzen Weg hervor: die Links sind Stations-Links (focusPathItemStation -> focusWholeWikiDeeplinkPath).
// ⚠️ Normales Skript: auch Besucher sehen die Zeilen.

function avesmapsWegWeiterePlatzhalter(publicId) {
	return '<div class="avesmaps-path-weitere" data-path-weitere="' + escapeHtml(String(publicId || "")) + '"></div>';
}

/** REIN: zwei Zeilen als dl-Inhalt. Eintraege {name, ref, zusatz}; ohne ref reiner Text. */
function avesmapsWegWeitereZeilen(daten, linkMarkup) {
	const eintrag = (e) => (e.ref ? linkMarkup(e.name, { kind: "path", ref: e.ref }) : escapeHtml(e.name))
		+ (e.zusatz ? " (" + escapeHtml(e.zusatz) + ")" : "");
	const zeile = (titel, eintraege) => (eintraege.length
		? '<div class="region-info-box__row"><dt>' + escapeHtml(titel) + "</dt><dd>" + eintraege.map(eintrag).join("<br>") + "</dd></div>"
		: "");
	return zeile("Auch Teil von", daten.auchTeil || []) + zeile("Verläuft auch über", daten.verlaeuftUeber || []);
}

let avesmapsWegTraegerStand = { schluessel: null, nachKey: null };

/** Welche Abschnitte tragen welchen Artikel als WEITERE Zuweisung? Einmal je Kartenstand gerechnet. */
function avesmapsWegTraegerIndex() {
	const daten = typeof pathData !== "undefined" && Array.isArray(pathData) ? pathData : [];
	const schluessel = avesmapsWegKartenStand(daten);
	if (avesmapsWegTraegerStand.schluessel !== schluessel) {
		const nachKey = new Map();
		daten.forEach((path) => {
			(Array.isArray(path?.properties?.wiki_path_weitere) ? path.properties.wiki_path_weitere : []).forEach((eintrag) => {
				const key = String(eintrag?.wiki_key || "").trim();
				if (!key) { return; }
				if (!nachKey.has(key)) { nachKey.set(key, []); }
				nachKey.get(key).push(path);
			});
		});
		avesmapsWegTraegerStand = { schluessel, nachKey };
	}
	return avesmapsWegTraegerStand.nachKey;
}

function avesmapsWegWeitereLabel(way) {
	const abschnitt = avesmapsWegGruppenAufKarte().nachId.get(way.public_id);
	return abschnitt ? wpAbschnittLabel(abschnitt.way, abschnitt.nummer) : "";
}

function avesmapsWegWeitereZeilenMarkup(path, auswahl) {
	const ganz = Boolean(auswahl && auswahl.publicId === null);
	const eigene = ganz ? avesmapsWegGruppeAufKarte(path) : [avesmapsWegAlsWay(path)];

	// „Auch Teil von": je Artikel einmal; bei der ganzen Strasse mit den Abschnitten, die ihn tragen (alle = ohne Zusatz).
	const auchTeil = new Map();
	eigene.forEach((way) => {
		(way.wiki_path_weitere || []).forEach((eintrag) => {
			const key = String(eintrag?.wiki_key || "").trim();
			if (!key) { return; }
			if (!auchTeil.has(key)) {
				auchTeil.set(key, { name: String(eintrag.name || key), ref: wikiUrlToDeeplinkKey(eintrag.wiki_url), labels: [] });
			}
			auchTeil.get(key).labels.push(avesmapsWegWeitereLabel(way));
		});
	});

	// „Verläuft auch über": fremde Traeger des eigenen Hauptartikels, je fremdem Weg einmal.
	const hauptKey = String(path?.properties?.wiki_path?.wiki_key || "").trim();
	const eigeneIds = new Set(avesmapsWegGruppeAufKarte(path).map((way) => way.public_id));
	const ueber = new Map();
	(hauptKey ? (avesmapsWegTraegerIndex().get(hauptKey) || []) : []).forEach((traeger) => {
		const way = avesmapsWegAlsWay(traeger);
		if (eigeneIds.has(way.public_id)) { return; }
		const fremderKey = String(way.wiki_path?.wiki_key || way.name);
		if (!ueber.has(fremderKey)) {
			ueber.set(fremderKey, { name: String(way.wiki_path?.name || way.name), ref: wikiUrlToDeeplinkKey(way.wiki_path?.wiki_url), labels: [] });
		}
		ueber.get(fremderKey).labels.push(avesmapsWegWeitereLabel(way));
	});

	const alsEintraege = (karte, gesamt) => Array.from(karte.values()).map((e) => ({
		name: e.name,
		ref: e.ref,
		zusatz: gesamt && e.labels.length === gesamt ? "" : e.labels.filter(Boolean).join(", "),
	}));
	return avesmapsWegWeitereZeilen({
		auchTeil: alsEintraege(auchTeil, ganz ? eigene.length : 0),
		verlaeuftUeber: alsEintraege(ueber, 0),
	}, pathItemStationLinkMarkup);
}

/** Ersetzt den Platzhalter im fertigen Markup durch die Zeilen (Aufruf beim Oeffnen der Infobox). */
function avesmapsWegWeitereFuellen(markup, path) {
	const platzhalter = avesmapsWegWeiterePlatzhalter(getPathPublicId(path));
	if (typeof markup !== "string" || markup.indexOf(platzhalter) === -1) { return markup; }
	const auswahl = typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE && typeof avesmapsWegAuswahlFuerPfad === "function"
		? avesmapsWegAuswahlFuerPfad(path) : null;
	const inhalt = avesmapsWegWeitereZeilenMarkup(path, auswahl);
	// 💣 Ersetzt per FUNKTION: in einer Ersatz-Zeichenkette waere ein „$" im Namen eines Artikels ein Muster.
	return markup.replace(platzhalter, () => platzhalter.replace("></div>", () => ">" + inhalt + "</div>"));
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsWegWeiterePlatzhalter, avesmapsWegWeitereZeilen, avesmapsWegWeitereZeilenMarkup, avesmapsWegWeitereFuellen, avesmapsWegTraegerIndex };
}
```

- [ ] **Step 4: Umsetzen, Verdrahtung**

1. In `js/map-features/map-features-path-rendering.js` direkt nach `rows += lageHtml ? rowHtml("Lage", lageHtml) : row("Lage", wiki.lage);` einfügen:

```js
	// Entwurf 2026-09-14 §2.4: „Auch Teil von" / „Verläuft auch über". Ein LEERER, markierter Platzhalter --
	// dieses Markup entsteht fuer alle Wege beim Kartenaufbau und wird zwischengespeichert, die Zeilen haengen
	// an der ganzen Wegeliste und an der Auswahl. avesmapsShowPathInInfopanel fuellt ihn beim Oeffnen.
	if (typeof avesmapsWegWeiterePlatzhalter === "function") {
		rows += avesmapsWegWeiterePlatzhalter(getPathPublicId(path));
	}
```

2. In `js/map-features/map-features-infopanel.js`, `window.avesmapsShowPathInInfopanel` (Zeile 725), direkt nach dem dreizeiligen Block `if (!markup) {` / `return false;` / `}` einfügen (`markup` ist dort ein `var`, also neu zuweisbar):

```js
		// Entwurf 2026-09-14 §2.4: die Zeilen der weiteren Wiki-Zuweisungen erst beim Oeffnen.
		if (typeof avesmapsWegWeitereFuellen === "function") { markup = avesmapsWegWeitereFuellen(markup, path); }
```

3. In `css/features/route-planner.css` nach der Regel `.avesmaps-path-landscapes { display: contents; }` anhängen:

```css
/* Die Zeilen der weiteren Wiki-Zuweisungen (weg-weitere-anzeige.js): wie der V10-Container ohne eigene Huelle. */
.avesmaps-path-weitere {
	display: contents;
}
```

4. In `index.html` direkt nach `<script src="js/map-features/weg-abschnitte.js"></script>` einfügen `<script src="js/map-features/weg-weitere-anzeige.js"></script>`.

- [ ] **Step 5: Tests laufen lassen**

Run: `node js/map-features/__tests__/weg-weitere-anzeige.test.js`, `node js/map-features/__tests__/wege-einschraenkung-anzeige.test.js`, `node js/app/__tests__/nur-editor-skripte.test.js`
Expected: grün. Scheitert `wege-einschraenkung-anzeige.test.js`, weil sein Sandkasten `avesmapsWegWeiterePlatzhalter` nicht kennt: Die `typeof`-Wache schützt ihn, der Test bleibt grün. Scheitert er trotzdem, ist die Wache falsch geschrieben.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "feat(infobox): Wege nennen \"Auch Teil von\" und \"Verläuft auch über\" -- ein Klick hebt den anderen Weg hervor" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §2.4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/map-features/weg-weitere-anzeige.js js/map-features/__tests__/weg-weitere-anzeige.test.js js/map-features/map-features-path-rendering.js js/map-features/map-features-infopanel.js css/features/route-planner.css index.html && git commit -F "$SCRATCH/msg.txt"
```

**🚚 Lieferung 4:** Tasks 10 und 11 live (sichtbar für Besucher: Suche, „Anzeigen", Infobox-Zeilen). Nach dem Push die Live-Seite als Besucher laden, die Konsole lesen, „Reichsstraße" suchen und eine Infobox öffnen. Owner schaut.

---

## Task 12: Die Klickfolge als reine Regel

**Files:**
- Create: `js/map-features/weg-auswahl.js`
- Create: `js/map-features/__tests__/weg-auswahl.test.js`
- Modify: `index.html` (Skript-Tag direkt nach `js/map-features/weg-weitere-anzeige.js`)

**Interfaces:**
- Consumes: nichts (rein).
- Produces:
  - `avesmapsWegAuswahlNachKlick(vorher, gruppe, publicId) -> {gruppe: string, publicId: string|null} | null`
  - `avesmapsWegAuswahlIds(auswahl, gruppenIds: string[]) -> string[]`
  - `avesmapsWegMarkierungszeile(auswahl, strecke: string) -> string` (Klartext, z. B. `Ganze Straße: Perz – Helmdahl`)
  - `avesmapsWegMarkierungszeileMarkup(auswahl, strecke: string) -> string` (`<b>Ganze Straße:</b> Perz – Helmdahl`, wie das Mockup)
  - `avesmapsWegVerlaufKachelErlaubt(auswahl) -> boolean`
  - `avesmapsWegTraegtWeiteren(way, wikiKey: string) -> boolean`

- [ ] **Step 1: Test schreiben**

```js
"use strict";
// Die Klickfolge auf der Karte (Entwurf 2026-09-14 §3.1) -- AUSGEFUEHRT, Zeile fuer Zeile der Tabelle.
// Aus der Wurzel: node js/map-features/__tests__/weg-auswahl.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const A = require(path.join(__dirname, "..", "weg-auswahl.js"));

const RS = "wiki:reichsstrasse-2";
const BP = "wiki:b-renpfad";
const klick = A.avesmapsWegAuswahlNachKlick;

// §3.1
let s = klick(null, RS, "rs-7");
assert.deepStrictEqual(s, { gruppe: RS, publicId: null }, "nichts markiert: ganze Strasse");
s = klick(s, RS, "rs-7");
assert.deepStrictEqual(s, { gruppe: RS, publicId: "rs-7" }, "Klick auf die markierte ganze Strasse: der Abschnitt");
s = klick(s, RS, "rs-6");
assert.deepStrictEqual(s, { gruppe: RS, publicId: "rs-6" }, "anderer Abschnitt derselben Strasse: dieser Abschnitt");
s = klick(s, RS, "rs-6");
assert.deepStrictEqual(s, { gruppe: RS, publicId: null }, "markierter Abschnitt: wieder die ganze Strasse");
s = klick(s, BP, "bp-1");
assert.deepStrictEqual(s, { gruppe: BP, publicId: null }, "andere Strasse: deren ganze Strasse");
// Ein Doppelklick feuert vorher zwei Klicks: die Markierung darf wechseln (der Verlauf-Editor bekommt den Pfad selbst).
assert.deepStrictEqual(klick(klick(null, RS, "rs-3"), RS, "rs-3"), { gruppe: RS, publicId: "rs-3" });
// `vorher` bleibt unangetastet
const eingefroren = Object.freeze({ gruppe: RS, publicId: null });
assert.deepStrictEqual(klick(eingefroren, RS, "rs-1"), { gruppe: RS, publicId: "rs-1" });
assert.deepStrictEqual(eingefroren, { gruppe: RS, publicId: null });
// Ohne Gruppe oder Abschnitt kein Zustand
assert.strictEqual(klick(s, "", "x"), null);
assert.strictEqual(klick(s, RS, ""), null);

// Was markiert ist
assert.deepStrictEqual(A.avesmapsWegAuswahlIds({ gruppe: RS, publicId: null }, ["rs-1", "rs-2"]), ["rs-1", "rs-2"]);
assert.deepStrictEqual(A.avesmapsWegAuswahlIds({ gruppe: RS, publicId: "rs-2" }, ["rs-1", "rs-2"]), ["rs-2"]);
assert.deepStrictEqual(A.avesmapsWegAuswahlIds(null, ["rs-1"]), []);

// Die Markierungszeile (Kurzform §4)
assert.strictEqual(A.avesmapsWegMarkierungszeile({ gruppe: RS, publicId: null }, "Perz – Helmdahl"), "Ganze Straße: Perz – Helmdahl");
assert.strictEqual(A.avesmapsWegMarkierungszeile({ gruppe: RS, publicId: "rs-7" }, "Silkwiesen – Wieha"), "Abschnitt: Silkwiesen – Wieha");
assert.strictEqual(A.avesmapsWegMarkierungszeile({ gruppe: RS, publicId: null }, ""), "Ganze Straße", "ohne Enden nur das Wort (§4)");
assert.strictEqual(A.avesmapsWegMarkierungszeile(null, "Perz – Helmdahl"), "");
assert.strictEqual(A.avesmapsWegMarkierungszeileMarkup({ gruppe: RS, publicId: null }, "Perz – Helmdahl"), "<b>Ganze Straße:</b> Perz – Helmdahl");
assert.strictEqual(A.avesmapsWegMarkierungszeileMarkup({ gruppe: RS, publicId: null }, ""), "<b>Ganze Straße</b>");
assert.strictEqual(A.avesmapsWegMarkierungszeileMarkup({ gruppe: RS, publicId: "x" }, "A<b> – B"), "<b>Abschnitt:</b> A&lt;b&gt; – B");
assert.strictEqual(A.avesmapsWegMarkierungszeileMarkup(null, "A – B"), "");

// „Verlauf bearbeiten" nur am Abschnitt (§3.4); ohne Markierung (Suche, Deeplink) wie bisher
assert.strictEqual(A.avesmapsWegVerlaufKachelErlaubt({ gruppe: RS, publicId: null }), false);
assert.strictEqual(A.avesmapsWegVerlaufKachelErlaubt({ gruppe: RS, publicId: "rs-7" }), true);
assert.strictEqual(A.avesmapsWegVerlaufKachelErlaubt(null), true);

// Traegt ein Abschnitt den Artikel als weitere Zuweisung?
const rs7 = { wiki_path_weitere: [{ wiki_key: "b-renpfad" }] };
assert.strictEqual(A.avesmapsWegTraegtWeiteren(rs7, "b-renpfad"), true);
assert.strictEqual(A.avesmapsWegTraegtWeiteren(rs7, "reichsstrasse-2"), false);
assert.strictEqual(A.avesmapsWegTraegtWeiteren({}, "b-renpfad"), false);
assert.strictEqual(A.avesmapsWegTraegtWeiteren(rs7, ""), false);

const seite = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const tag = seite.indexOf('<script src="js/map-features/weg-auswahl.js"></script>');
assert.ok(tag > seite.indexOf('<script src="js/map-features/weg-weitere-anzeige.js"></script>') && tag > 0, "index.html laedt die Regel nach weg-weitere-anzeige.js");

console.log("weg-auswahl.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/map-features/__tests__/weg-auswahl.test.js`
Expected: FAIL `Cannot find module '…/weg-auswahl.js'`

- [ ] **Step 3: Umsetzen**

`js/map-features/weg-auswahl.js`:

```js
// Die Klickfolge „erst die ganze Strasse, dann der Abschnitt" (Entwurf 2026-09-14 §3.1) als REINE Regel:
// kein DOM, kein Leaflet, kein Modulzustand. Zustand und Linienfarbe leben in map-features-weg-auswahl.js.
// ⚠️ Normales Skript, NICHT in <template data-nur-editor> (nur-editor-skripte.test.js, Teil C).

/**
 * REIN: der Zustand nach einem Klick auf den Abschnitt `publicId` der Strasse `gruppe`.
 * @param {{gruppe: string, publicId: (string|null)}|null} vorher
 */
function avesmapsWegAuswahlNachKlick(vorher, gruppe, publicId) {
	const key = String(gruppe || "");
	const id = String(publicId || "");
	if (!key || !id) { return null; }
	if (!vorher || vorher.gruppe !== key) { return { gruppe: key, publicId: null }; }
	if (vorher.publicId === id) { return { gruppe: key, publicId: null }; }
	return { gruppe: key, publicId: id };
}

/** REIN: die public_ids, die gelb werden. */
function avesmapsWegAuswahlIds(auswahl, gruppenIds) {
	if (!auswahl) { return []; }
	if (auswahl.publicId !== null && auswahl.publicId !== undefined) { return [String(auswahl.publicId)]; }
	return (Array.isArray(gruppenIds) ? gruppenIds : []).map(String);
}

/** REIN: „Ganze Straße: A – B" bzw. „Abschnitt: A – B"; ohne Enden nur das Wort (Entwurf §4). */
function avesmapsWegMarkierungszeile(auswahl, strecke) {
	if (!auswahl) { return ""; }
	const wort = auswahl.publicId === null || auswahl.publicId === undefined ? "Ganze Straße" : "Abschnitt";
	const text = String(strecke || "").trim();
	return text ? wort + ": " + text : wort;
}

function avesmapsWegAuswahlEsc(wert) {
	return String(wert == null ? "" : wert)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** REIN: dieselbe Zeile als HTML, das Wort fett (wie im Mockup). */
function avesmapsWegMarkierungszeileMarkup(auswahl, strecke) {
	const text = avesmapsWegMarkierungszeile(auswahl, strecke);
	if (!text) { return ""; }
	const trenner = text.indexOf(": ");
	return trenner === -1
		? "<b>" + avesmapsWegAuswahlEsc(text) + "</b>"
		: "<b>" + avesmapsWegAuswahlEsc(text.slice(0, trenner + 1)) + "</b> " + avesmapsWegAuswahlEsc(text.slice(trenner + 2));
}

/** REIN: „Verlauf bearbeiten" gibt es nur am Abschnitt -- eine Linienaenderung ueber eine ganze Strasse nicht (§3.4). */
function avesmapsWegVerlaufKachelErlaubt(auswahl) {
	return !auswahl || (auswahl.publicId !== null && auswahl.publicId !== undefined);
}

/** REIN: traegt dieser Abschnitt den Artikel als WEITERE Zuweisung? */
function avesmapsWegTraegtWeiteren(way, wikiKey) {
	const key = String(wikiKey || "");
	return Boolean(key) && (Array.isArray(way && way.wiki_path_weitere) ? way.wiki_path_weitere : [])
		.some((eintrag) => String((eintrag && eintrag.wiki_key) || "") === key);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWegAuswahlNachKlick, avesmapsWegAuswahlIds, avesmapsWegMarkierungszeile,
		avesmapsWegMarkierungszeileMarkup, avesmapsWegVerlaufKachelErlaubt, avesmapsWegTraegtWeiteren,
	};
}
```

In `index.html` direkt nach `<script src="js/map-features/weg-weitere-anzeige.js"></script>` einfügen `<script src="js/map-features/weg-auswahl.js"></script>`.

- [ ] **Step 4: Tests laufen lassen**

Run: `node js/map-features/__tests__/weg-auswahl.test.js`, `node js/app/__tests__/nur-editor-skripte.test.js`
Expected: grün.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' "feat(wege): die Klickfolge ganze Strasse -> Abschnitt als reine Regel" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §3.1. Noch ohne Aufrufer." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/map-features/weg-auswahl.js js/map-features/__tests__/weg-auswahl.test.js index.html && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 13: Klick auf der Karte — gelbe Linie, gestrichelte Träger, Markierungszeile

**Files:**
- Create: `js/map-features/map-features-weg-auswahl.js`
- Create: `js/map-features/__tests__/weg-auswahl-karte.test.js`
- Modify: `js/map-features/map-features-path-rendering.js` (`createPathPopupMarkup` Zeilen 209–213 und 271–291; `updatePathLayerStyle` Zeilen 346–355; Klick-Zuhörer in `createPathLayer` Zeilen 486–497)
- Modify: `js/routing/routing.js:609` (Verdrahtung beim Start)
- Modify: `css/features/location-popups-markers.css` (nach `.info-header__subtitle`, Zeile 175–180)
- Modify: `index.html` (Skript-Tag direkt nach `js/map-features/weg-auswahl.js`)

**Interfaces:**
- Consumes: Task 8 (`avesmapsWegAbschnittAufKarte` → `{way, gruppe: {key, segments}, nummer}`, `avesmapsWegGruppeAufKarte`, `avesmapsWegStreckeAufKarte`, `avesmapsWegGanzeStreckeAufKarte`); Task 11 (`avesmapsWegTraegerIndex() -> Map<wiki_key, path[]>`); Task 12; `findPathByPublicId` (`map-features-path-lifecycle.js:35`); `updatePathLayerStyle`; `refreshPathLayerPopup` (baut `path._popupMarkup` neu); `SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color` (`js/ui/spotlight-search.js:33`); `window.avesmapsRefreshInfopanel` (`map-features-infopanel.js:684`); `map`; `IS_EDIT_MODE`.
- Produces:
  - `avesmapsWegAuswahlKlick(path) -> {gruppe, publicId}|null`
  - `avesmapsWegAuswahlAufheben() -> void`
  - `avesmapsWegAuswahlFuerPfad(path) -> {gruppe, publicId}|null` (`null`, wenn dieser Pfad nicht markiert ist)
  - `avesmapsWegAuswahlGruppenPfade(path) -> path[]` (die Pfade der ganzen Straße, in Nummernfolge)
  - `avesmapsWegAuswahlStilNachziehen(path) -> void`
  - `avesmapsWegAuswahlVerdrahten() -> void`
  - Popup-Attribut `data-weg-umfang="strasse"|"abschnitt"` am Knopf „Bearbeiten"

⚠️ **Die Farbe gehört an EINE Stelle:** `updatePathLayerStyle` färbt jede Linie neu (Live-Abgleich, Prüfhaken, Wegtyp). Die Markierung zieht deshalb an seinem Ende nach, statt dass jeder Neufärber sie kennen muss. Dasselbe gilt für das Zurücknehmen: `updatePathLayerStyle` setzt `dashArray` nie zurück, also nimmt `avesmapsWegAuswahlStilNachziehen` den Strich selbst weg.

- [ ] **Step 1: Test schreiben**

```js
"use strict";
// Die Klickfolge auf der Karte (Entwurf 2026-09-14 §3): Zustand, gelbe Linie, gestrichelte Traeger, Aufheben,
// Markierungszeile und Editorband. AUSGEFUEHRT: updatePathLayerStyle und createPathPopupMarkup werden aus
// map-features-path-rendering.js geschnitten und mit Attrappen gefahren.
// Aus der Wurzel: node js/map-features/__tests__/weg-auswahl-karte.test.js
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

const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	escapeHtml: (w) => String(w).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
	pathItemStationLinkMarkup: (text) => text,
	wikiUrlToDeeplinkKey: (url) => String(url || "").split("/wiki/")[1] || "",
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: () => false,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: true,
	SPOTLIGHT_PATH_HIGHLIGHT_STYLE: { color: "#ffd72e" },
	getPathStyleColors: () => ({ outline: "#rand", outlineWeight: 4, outlineOpacity: 1, center: "#mitte", centerWeight: 2 }),
	refreshPathLayerText: () => {},
	window: {},
});
const neuGebaut = [];
global.refreshPathLayerPopup = (p) => { neuGebaut.push(p.properties.public_id); p._popupMarkup = "neu"; };
global.findPathByPublicId = (id) => global.pathData.find((p) => p.properties.public_id === id) || null;
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-weitere-anzeige.js")));
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-auswahl.js")));
const K = require(path.join(WURZEL, "js/map-features/map-features-weg-auswahl.js"));
Object.assign(global, K);

const rendering = lies("js/map-features/map-features-path-rendering.js");
vm.runInThisContext(schneide(rendering, "function updatePathLayerStyle(path) {", "\nfunction getPathVisualLatLngCoordinates"));

global.locationData = [
	{ name: "Perz", coordinates: [0, 0] }, { name: "Silkwiesen", coordinates: [0, 1] },
	{ name: "Wieha", coordinates: [0, 2] }, { name: "Helmdahl", coordinates: [0, 3] },
];
const linie = () => ({ options: {}, setStyle(o) { Object.assign(this.options, o); } });
const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
const RS = { key: "reichsstrasse-2", name: "Reichsstraße 2", seite: "Reichsstrasse_2" };
const BP = { key: "b-renpfad", name: "Bärenpfad", seite: "Baerenpfad" };
const weg = (id, von, bis, haupt, weitere = []) => ({
	properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "Reichsstrasse-" + id, display_name: haupt.name,
		wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: url(haupt.seite) }, wiki_path_weitere: weitere },
	geometry: { coordinates: [von, bis] },
	_pathLines: [linie(), linie()],
});
global.pathData = [
	weg("rs-6", [0, 0], [1, 0], RS),
	weg("rs-7", [1, 0], [2, 0], RS, [{ wiki_key: BP.key, name: BP.name, wiki_url: url(BP.seite) }]),
	weg("rs-8", [2, 0], [3, 0], RS),
	weg("bp-1", [5, 5], [6, 6], BP),
];
const [rs6, rs7, rs8, bp1] = global.pathData;
const farbe = (p) => p._pathLines[1].options.color;
const strich = (p) => p._pathLines[1].options.dashArray || null;
global.pathData.forEach((p) => updatePathLayerStyle(p));
assert.strictEqual(farbe(rs7), "#mitte");

// 1. Erster Klick: die ganze Strasse gelb, der fremde Weg nicht, die Aussenlinie unveraendert
assert.deepStrictEqual(K.avesmapsWegAuswahlKlick(rs7), { gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.deepStrictEqual([rs6, rs7, rs8].map(farbe), ["#ffd72e", "#ffd72e", "#ffd72e"]);
assert.strictEqual(farbe(bp1), "#mitte");
assert.strictEqual(rs7._pathLines[0].options.color, "#rand", "keine Umrandung: die Aussenlinie bleibt");
assert.deepStrictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), { gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(bp1), null);
assert.ok(neuGebaut.includes("rs-7"), "das Markup des geklickten Wegs wird neu gebaut");

// 2. Zweiter Klick: nur der Abschnitt
neuGebaut.length = 0;
assert.deepStrictEqual(K.avesmapsWegAuswahlKlick(rs7), { gruppe: "wiki:reichsstrasse-2", publicId: "rs-7" });
assert.deepStrictEqual([rs6, rs7, rs8].map(farbe), ["#mitte", "#ffd72e", "#mitte"]);
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs6), null, "ein abgewaehlter Abschnitt meldet keine Auswahl");
assert.ok(neuGebaut.includes("rs-6") && neuGebaut.includes("rs-8"), "die abgewaehlten Abschnitte bekommen ihr Markup zurueck");

// 3. Der Baerenpfad: seine ganze Strasse gelb, der Reichsstrassen-Abschnitt mit ihm als weiterer Zuweisung gestrichelt
K.avesmapsWegAuswahlKlick(bp1);
assert.strictEqual(farbe(bp1), "#ffd72e");
assert.strictEqual(strich(bp1), null);
assert.strictEqual(farbe(rs7), "#ffd72e");
assert.strictEqual(strich(rs7), "8 8", "fremder Traeger: gestrichelt");
assert.strictEqual(K.avesmapsWegAuswahlFuerPfad(rs7), null, "ein Traeger ist angezeigt, nicht markiert");

// 4. Neufaerben (Live-Abgleich, Pruefhaken) laesst die Markierung stehen
updatePathLayerStyle(bp1);
updatePathLayerStyle(rs7);
assert.strictEqual(farbe(bp1), "#ffd72e");
assert.strictEqual(strich(rs7), "8 8");

// 5. Ein Klick daneben hebt alles auf -- auch den Strich; einmal verdrahtet
const anmeldungen = [];
global.map = { on: (ereignis, fn) => { anmeldungen.push([ereignis, fn]); } };
let aufgefrischt = 0;
global.window.avesmapsRefreshInfopanel = () => { aufgefrischt += 1; };
K.avesmapsWegAuswahlVerdrahten();
K.avesmapsWegAuswahlVerdrahten();
assert.strictEqual(anmeldungen.length, 1, "genau ein Zuhoerer");
assert.strictEqual(anmeldungen[0][0], "click");
anmeldungen[0][1]();
assert.deepStrictEqual([rs6, rs7, rs8, bp1].map(farbe), ["#mitte", "#mitte", "#mitte", "#mitte"]);
assert.strictEqual(strich(rs7), null, "der Strich geht mit");
assert.strictEqual(aufgefrischt, 1, "das Infopanel zieht die Zeile nach");
anmeldungen[0][1]();
assert.strictEqual(aufgefrischt, 1, "ohne Markierung tut der Klick nichts");

// 6. Die ganze Strasse als Pfade (fuer den Dialog)
assert.deepStrictEqual(K.avesmapsWegAuswahlGruppenPfade(rs8).map((p) => p.properties.public_id), ["rs-6", "rs-7", "rs-8"]);

// 7. Besucher: kein Zustand, keine Farbe
global.IS_EDIT_MODE = false;
assert.strictEqual(K.avesmapsWegAuswahlKlick(rs7), null);
assert.strictEqual(farbe(rs7), "#mitte");
global.IS_EDIT_MODE = true;

// 8. Markierungszeile und Editorband -- createPathPopupMarkup mit Attrappen gefahren
Object.assign(global, {
	normalizePathSubtype: (v) => String(v || "Weg"),
	pathIstBach: () => false,
	getPathTitleName: (p) => p.properties.display_name,
	getPathTypeLabel: (t) => t,
	getUnnamedPathTitle: (t) => "Unbenannt " + t,
	renderFeatureKanonBadge: () => "",
	pathHeaderImageBasename: () => "strasse",
	pathHeaderIconMarkup: () => "",
	infoHeaderImageMarkup: (bild, titel, untertitel, wappen, bilder, zusatz, kanon) => "KOPF[" + kanon + "]",
	locationPopupMarkup: (o) => o.headerImageMarkup + "|" + o.actionsMarkup,
	pathShowActionButtonMarkup: () => "",
	pathShareButtonMarkup: () => "",
	popupActionButtonMarkup: (spec) => "<" + spec.label + " " + JSON.stringify(spec.attributes || {}) + ">",
	popupActionGlyphMarkup: () => "",
	locationPopupActionsMarkup: (knoepfe) => knoepfe.join(""),
	locationPopupEditorBandMarkup: (knoepfe) => "BAND[" + knoepfe.join("") + "]",
	pathWikiInfoboxMarkup: () => "",
});
vm.runInThisContext(schneide(rendering, "function createPathPopupMarkup(path) {", "\n// Zeichen-Reihenfolge der Wege"));

const ohne = createPathPopupMarkup(rs7);
assert.ok(ohne.startsWith("KOPF[]"), "ohne Markierung keine Zeile: " + ohne);
assert.ok(ohne.includes('"data-weg-umfang":"abschnitt"') && ohne.includes("<Verlauf bearbeiten"), ohne);

K.avesmapsWegAuswahlKlick(rs7);
const ganz = createPathPopupMarkup(rs7);
assert.ok(ganz.startsWith('KOPF[<div class="info-header__markierung"><b>Ganze Straße:</b> Perz – Helmdahl</div>]'), ganz);
assert.ok(ganz.includes('"data-weg-umfang":"strasse"'), "Bearbeiten bearbeitet die ganze Strasse");
assert.ok(!ganz.includes("<Verlauf bearbeiten"), "Verlauf bearbeiten nur am Abschnitt");

K.avesmapsWegAuswahlKlick(rs7);
const teil = createPathPopupMarkup(rs7);
assert.ok(teil.startsWith('KOPF[<div class="info-header__markierung"><b>Abschnitt:</b> Silkwiesen – Wieha</div>]'), teil);
assert.ok(teil.includes('"data-weg-umfang":"abschnitt"') && teil.includes("<Verlauf bearbeiten"), teil);

global.IS_EDIT_MODE = false;
assert.ok(createPathPopupMarkup(rs7).startsWith("KOPF[]"), "Besucher sehen keine Zeile");
global.IS_EDIT_MODE = true;

// 9. Verdrahtung: Reihenfolge im Klick-Zuhoerer, Aufheben beim Start
const layer = schneide(rendering, "function createPathLayer(path) {", "\nfunction updatePathLayerGeometry");
const schiedsrichter = layer.indexOf("avesmapsTryOpenLocationAtContainerPoint(event.containerPoint)");
const auswahl = layer.indexOf("avesmapsWegAuswahlKlick(path)");
const panel = layer.indexOf("avesmapsShowPathInInfopanel(path)");
assert.ok(schiedsrichter > 0 && auswahl > schiedsrichter && panel > auswahl, "Klick: erst der Schiedsrichter, dann die Auswahl, dann die Infobox");
assert.ok(/avesmapsWegAuswahlVerdrahten\(\);/.test(lies("js/routing/routing.js")), "der Start verdrahtet das Aufheben");

// 10. CSS mit Tokens, Ladereihenfolge
const regel = schneide(lies("css/features/location-popups-markers.css"), ".info-header__markierung {", "}");
assert.ok(regel.includes("var(--font-size-small)") && regel.includes("var(--color-text)"), regel);
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(regel), "keine feste Farbe: " + regel);
const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
const regelTag = seite.indexOf('<script src="js/map-features/weg-auswahl.js"></script>');
const karteTag = seite.indexOf('<script src="js/map-features/map-features-weg-auswahl.js"></script>');
assert.ok(regelTag > 0 && karteTag > regelTag, "index.html laedt erst die Regel, dann den Kartenteil");

console.log("weg-auswahl-karte.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/map-features/__tests__/weg-auswahl-karte.test.js`
Expected: FAIL `Cannot find module '…/map-features-weg-auswahl.js'`

- [ ] **Step 3: Umsetzen, Modul**

`js/map-features/map-features-weg-auswahl.js`:

```js
// Die Klickfolge auf der KARTE (Entwurf 2026-09-14 §3): der erste Klick markiert die ganze Strasse, der zweite
// den Abschnitt. Die Regel steht rein in weg-auswahl.js; hier nur Zustand, Linienfarbe und Aufheben.
// 🔴 NUR IM BEARBEITEN-MODUS. Besucher klicken wie bisher (E4 gilt dem Bearbeiten).
// ⚠️ Normales Skript, NICHT in <template data-nur-editor>: der Klick-Zuhoerer in
// map-features-path-rendering.js nennt diese Namen, und der laedt fuer jeden (nur-editor-skripte.test.js).

// Der Strich fremder Traeger: angezeigt, nicht mitbearbeitet (§3.3). Kein Farbwert, daher kein Token.
const AVESMAPS_WEG_AUSWAHL_STRICH = "8 8";

let avesmapsWegAuswahlStand = null;           // {gruppe, publicId|null} oder null
let avesmapsWegAuswahlMarkiert = new Set();   // public_ids mit gelber Linie
let avesmapsWegAuswahlTraeger = new Set();    // fremde Abschnitte mit dem Artikel als weiterer Zuweisung
let avesmapsWegAuswahlVerdrahtet = false;

// 💣 Gelesen, nie abgeschrieben: dieselbe Farbe wie die Hervorhebung der Suche (Entwurf §3.3).
function avesmapsWegAuswahlFarbe() {
	return typeof SPOTLIGHT_PATH_HIGHLIGHT_STYLE !== "undefined" && SPOTLIGHT_PATH_HIGHLIGHT_STYLE
		? SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color || null
		: null;
}

/**
 * Die Mittellinie nach dem Zustand faerben. Gerufen am ENDE von updatePathLayerStyle -- damit ueberlebt die
 * Markierung jedes Neufaerben, ohne dass ein Neufaerber sie kennen muss.
 * 💣 updatePathLayerStyle setzt `dashArray` nie zurueck: der Strich eines ehemaligen Traegers wird HIER entfernt.
 */
function avesmapsWegAuswahlStilNachziehen(path) {
	const mitte = path && Array.isArray(path._pathLines) ? path._pathLines[1] : null;
	if (!mitte || typeof mitte.setStyle !== "function") { return; }
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	const farbe = avesmapsWegAuswahlFarbe();
	if (farbe && avesmapsWegAuswahlMarkiert.has(id)) {
		mitte.setStyle({ color: farbe, dashArray: null });
	} else if (farbe && avesmapsWegAuswahlTraeger.has(id)) {
		mitte.setStyle({ color: farbe, dashArray: AVESMAPS_WEG_AUSWAHL_STRICH });
	} else if (mitte.options && mitte.options.dashArray) {
		mitte.setStyle({ dashArray: null });
	}
}

function avesmapsWegAuswahlNeuZeichnen(ids) {
	ids.forEach((id) => {
		const pfad = typeof findPathByPublicId === "function" ? findPathByPublicId(id) : null;
		if (!pfad) { return; }
		if (typeof updatePathLayerStyle === "function") { updatePathLayerStyle(pfad); }
		// Markierungszeile und Editorband stehen im zwischengespeicherten Markup (path._popupMarkup).
		if (typeof refreshPathLayerPopup === "function") { refreshPathLayerPopup(pfad); }
	});
}

function avesmapsWegAuswahlSetzen(stand, abschnitt) {
	const vorher = new Set([...avesmapsWegAuswahlMarkiert, ...avesmapsWegAuswahlTraeger]);
	avesmapsWegAuswahlStand = stand;
	avesmapsWegAuswahlMarkiert = new Set();
	avesmapsWegAuswahlTraeger = new Set();
	if (stand && abschnitt) {
		const gruppenIds = abschnitt.gruppe.segments.map((way) => way.public_id);
		avesmapsWegAuswahlMarkiert = new Set(avesmapsWegAuswahlIds(stand, gruppenIds));
		// Fremde Traeger nur bei der GANZEN Strasse eines ARTIKELS -- eine Namensgruppe hat keinen Schluessel.
		const key = stand.publicId === null && stand.gruppe.indexOf("wiki:") === 0 ? stand.gruppe.slice(5) : "";
		if (key && typeof avesmapsWegTraegerIndex === "function") {
			(avesmapsWegTraegerIndex().get(key) || []).forEach((traeger) => {
				const id = getPathPublicId(traeger);
				if (!avesmapsWegAuswahlMarkiert.has(id)) { avesmapsWegAuswahlTraeger.add(id); }
			});
		}
	}
	avesmapsWegAuswahlNeuZeichnen(new Set([...vorher, ...avesmapsWegAuswahlMarkiert, ...avesmapsWegAuswahlTraeger]));
}

function avesmapsWegAuswahlKlick(path) {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) { return null; }
	const abschnitt = typeof avesmapsWegAbschnittAufKarte === "function" ? avesmapsWegAbschnittAufKarte(path) : null;
	if (!abschnitt) { return null; }
	const stand = avesmapsWegAuswahlNachKlick(avesmapsWegAuswahlStand, abschnitt.gruppe.key, abschnitt.way.public_id);
	avesmapsWegAuswahlSetzen(stand, stand ? abschnitt : null);
	return stand;
}

function avesmapsWegAuswahlAufheben() {
	if (!avesmapsWegAuswahlStand) { return; }
	avesmapsWegAuswahlSetzen(null, null);
	if (typeof window !== "undefined" && typeof window.avesmapsRefreshInfopanel === "function") {
		window.avesmapsRefreshInfopanel();
	}
}

/** Die Auswahl, wenn DIESER Pfad markiert ist (als Abschnitt oder als Teil der ganzen Strasse); sonst null. */
function avesmapsWegAuswahlFuerPfad(path) {
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	return avesmapsWegAuswahlStand && avesmapsWegAuswahlMarkiert.has(id) ? { ...avesmapsWegAuswahlStand } : null;
}

/** Die Pfade der ganzen Strasse dieses Pfads, in der Nummernfolge des Wege-Editors. */
function avesmapsWegAuswahlGruppenPfade(path) {
	const ways = typeof avesmapsWegGruppeAufKarte === "function" ? avesmapsWegGruppeAufKarte(path) : [];
	return ways
		.map((way) => (typeof findPathByPublicId === "function" ? findPathByPublicId(way.public_id) : null))
		.filter(Boolean);
}

function avesmapsWegAuswahlVerdrahten() {
	if (avesmapsWegAuswahlVerdrahtet || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) { return; }
	if (typeof map === "undefined" || !map || typeof map.on !== "function") { return; }
	avesmapsWegAuswahlVerdrahtet = true;
	// Ein Klick daneben hebt die Markierung auf (§3.1). Ein Klick AUF einen Weg erreicht die Karte nicht:
	// beide Linien tragen `bubblingMouseEvents: false` (createPathLayer).
	map.on("click", avesmapsWegAuswahlAufheben);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWegAuswahlKlick, avesmapsWegAuswahlAufheben, avesmapsWegAuswahlFuerPfad,
		avesmapsWegAuswahlGruppenPfade, avesmapsWegAuswahlStilNachziehen, avesmapsWegAuswahlVerdrahten,
	};
}
```

In `index.html` direkt nach `<script src="js/map-features/weg-auswahl.js"></script>` einfügen `<script src="js/map-features/map-features-weg-auswahl.js"></script>`.

- [ ] **Step 4: Umsetzen, Verdrahtung**

1. `js/map-features/map-features-path-rendering.js`, `updatePathLayerStyle`: zwischen `path._pathLines[1]?.setStyle({ color: colors.center, weight: colors.centerWeight });` und `refreshPathLayerText(path);` einfügen:

```js
	// Entwurf 2026-09-14 §3.3: eine Markierung ueberlebt jedes Neufaerben (Live-Abgleich, Pruefhaken, Wegtyp).
	if (typeof avesmapsWegAuswahlStilNachziehen === "function") {
		avesmapsWegAuswahlStilNachziehen(path);
	}
```

2. `createPathPopupMarkup`: direkt nach der Zuweisung `const pathKanon = …;` (endet mit `: "";`) einfügen:

```js
	// Entwurf 2026-09-14 §3.4: im Bearbeiten-Modus sagt eine Zeile unter der Wegart, WAS markiert ist -- ohne
	// Kasten, im Titelblock. Ohne Markierung (Besucher, Suche, Deeplink) keine Zeile.
	const wegAuswahl = IS_EDIT_MODE && typeof avesmapsWegAuswahlFuerPfad === "function" ? avesmapsWegAuswahlFuerPfad(path) : null;
	const markierungZeile = wegAuswahl && typeof avesmapsWegMarkierungszeileMarkup === "function"
		? avesmapsWegMarkierungszeileMarkup(wegAuswahl, wegAuswahl.publicId === null
			? avesmapsWegGanzeStreckeAufKarte(path)
			: avesmapsWegStreckeAufKarte(path))
		: "";
	const markierungMarkup = markierungZeile ? `<div class="info-header__markierung">${markierungZeile}</div>` : "";
```

und im Aufruf `infoHeaderImageMarkup(pathHeaderImageBasename(pathType), pathName, subtitle, "", [], "", pathKanon)` das letzte Argument `pathKanon` durch `markierungMarkup + pathKanon` ersetzen. ⚠️ `kanonMarkup: pathKanon` im Aufruf von `locationPopupMarkup` bleibt **unverändert**: `locationPopupMarkup` setzt `kanonMarkup` noch einmal hinter den Kopf, wenn der Kopf kein Etikett trägt (`js/ui/popups.js:1238`). Die Zeile stünde dann zweimal.

3. Im Editorband die beiden Aufrufe „Bearbeiten" und „Verlauf bearbeiten" (heute Zeilen 271–291, vom ersten `editorButtons.push(popupActionButtonMarkup({` mit `label: "Bearbeiten"` bis zum `}));` nach `"data-popup-action": "edit-path-geometry"`) vollständig ersetzen durch:

```js
				editorButtons.push(popupActionButtonMarkup({
					label: "Bearbeiten",
					// Dasselbe Zahnrad wie am Ort: dieselbe Geste an einem anderen Gegenstand.
					iconMarkup: popupActionGlyphMarkup("bearbeiten"),
					attributes: {
						"data-popup-action": "edit-path-details",
						"data-public-id": getPathPublicId(path),
						// Entwurf 2026-09-14 §3.5: „Bearbeiten" bearbeitet das Markierte (routing.js liest es).
						"data-weg-umfang": wegAuswahl && wegAuswahl.publicId === null ? "strasse" : "abschnitt",
					},
				}));
				// „Verlauf bearbeiten" nur am Abschnitt -- eine Linienaenderung ueber eine ganze Strasse gibt es nicht
				// (Entwurf 2026-09-14 §3.4). Ohne Markierung (Suche, Deeplink) steht die Kachel wie bisher.
				const verlaufErlaubt = typeof avesmapsWegVerlaufKachelErlaubt !== "function" || avesmapsWegVerlaufKachelErlaubt(wegAuswahl);
				if (verlaufErlaubt) {
					editorButtons.push(popupActionButtonMarkup({
						label: "Verlauf bearbeiten",
						// Der Stift, nicht das Zahnrad: hier werden keine Eigenschaften geaendert, sondern
						// die LINIE angefasst -- genau die Trennung, die das Kontextmenue zwischen
						// „Grenzen bearbeiten" (✎) und „Territoriumseditor oeffnen" (⚙) macht. Die beiden
						// Kacheln stehen nebeneinander und muessen sich auf einen Blick unterscheiden.
						iconMarkup: popupActionGlyphMarkup("verlauf"),
						attributes: {
							"data-popup-action": "edit-path-geometry",
							"data-public-id": getPathPublicId(path),
						},
					}));
				}
```

4. Klick-Zuhörer in `createPathLayer`: direkt nach dem Block

```js
			if (typeof window.avesmapsTryOpenLocationAtContainerPoint === "function"
					&& window.avesmapsTryOpenLocationAtContainerPoint(event.containerPoint)) {
				L.DomEvent.stop(event);
				return;
			}
```

einfügen:

```js
			// Entwurf 2026-09-14 §3.1: im Bearbeiten-Modus markiert der Klick erst die ganze Strasse, dann den
			// Abschnitt. NACH dem Schiedsrichter (ein Ort auf dem Weg gewinnt weiter) und VOR dem Anzeigen: die
			// Infobox liest die Markierung aus dem Markup, das dieser Aufruf neu baut.
			if (IS_EDIT_MODE && typeof avesmapsWegAuswahlKlick === "function") {
				avesmapsWegAuswahlKlick(path);
			}
```

5. `js/routing/routing.js:609`: direkt unter der Zeile `startLiveMapUpdates(); applyPlaceFocusFromUrl(); applyWikiDeeplinkFromUrl(); map.on("zoomend", notifyEditorZoomLevel);` einfügen:

```js
		// Entwurf 2026-09-14 §3.1: ein Klick daneben hebt die Wege-Markierung auf (nur Bearbeiten-Modus).
		if (typeof avesmapsWegAuswahlVerdrahten === "function") { avesmapsWegAuswahlVerdrahten(); }
```

6. `css/features/location-popups-markers.css`, direkt nach der Regel `.info-header__subtitle { … }`:

```css
/* Entwurf 2026-09-14 §3.4: was im Bearbeiten-Modus markiert ist -- ohne Kasten, direkt unter der Wegart.
   Werte aus dem Mockup docs/wege-mehrfachzuweisung-mockup.html (.proto-markiert). */
.info-header__markierung {
	margin-top: 2px;
	color: var(--color-text);
	font-size: var(--font-size-small);
	line-height: var(--leading-snug);
}
```

- [ ] **Step 5: Tests laufen lassen**

Run:
- `node js/map-features/__tests__/weg-auswahl-karte.test.js`
- `node js/map-features/__tests__/weg-auswahl.test.js`
- `node js/map-features/__tests__/weg-weitere-anzeige.test.js`
- `node js/map-features/__tests__/flusskontur-landschaften.test.js` (liest `_pathLines`)
- `node js/app/__tests__/nur-editor-skripte.test.js`

Expected: grün.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "feat(karte): im Bearbeiten-Modus markiert ein Klick erst die ganze Strasse, der zweite den Abschnitt -- gelbe Linie, Zeile unter der Wegart, \"Verlauf bearbeiten\" nur am Abschnitt" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §3.1-3.4." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/map-features/map-features-weg-auswahl.js js/map-features/__tests__/weg-auswahl-karte.test.js js/map-features/map-features-path-rendering.js js/routing/routing.js css/features/location-popups-markers.css index.html && git commit -F "$SCRATCH/msg.txt"
```

---

## Task 14: Der Dialog „Weg bearbeiten" für die ganze Straße

**Files:**
- Create: `js/review/path-gruppe.js`
- Create: `js/review/__tests__/weg-dialog-gruppe.test.js`
- Modify: `js/pages/wege-editor-model.js` (neues `wpGroupRumpf` nach `wpGroupTransportDecisions`, Zeile 498; Export Zeile 758)
- Modify: `js/pages/wege-editor.js:1376-1386` (`saveGroupDraft` baut den Rumpf mit `wpGroupRumpf`)
- Modify: `js/pages/__tests__/wege-gruppe-felder.test.js:194-197`
- Modify: `js/review/review-paths.js` (`populatePathEditForm` Zeile 38, `mountPathEditFeatureSources` Zeilen 54–86, neuer Block danach, `openPathEditDialog` Zeilen 136–144, `syncPathTransportOptions` Zeile 279)
- Modify: `js/review/review-editor-submit.js:147-174` (Abzweig und `handlePathGroupEditSubmit`)
- Modify: `js/review/review-dialog-state.js:1-13` (`resetPathEditForm`)
- Modify: `js/review/review-pending.js:109`
- Modify: `js/routing/routing.js:1261-1270` (Zweig `edit-path-details`)
- Modify: `index.html` (Zeile 1775 Zeile oben im Dialog; Host nach `#path-wiki-assign-host`; zwei Skript-Tags)
- Modify: `css/features/path-editor.css` (am Ende)

**Interfaces:**
- Consumes:
  - Task 3: Antwort `segments_updated: list<{public_id, wiki_path_weitere}>`.
  - Task 7: `avesmapsWikiWeitereKastenMount(host, {skin, hauptKey, haupt, abschnitte, umfangText, gesamtText, geschrieben}) -> {neuZeichnen, zerstoeren}`.
  - Task 8: `avesmapsWegStreckeAufKarte`, `avesmapsWegGanzeStreckeAufKarte`, `avesmapsWegAbschnittLabelAufKarte`.
  - Task 12: `avesmapsWegMarkierungszeileMarkup`.
  - Task 13: `avesmapsWegAuswahlGruppenPfade`, Attribut `data-weg-umfang`.
  - Modell: `wpGroupFieldStates`, `wpGroupChangedFields`, `wpGroupTransportDecisions`.
  - Server: `update_path_group_details` mit `{public_ids, fields, name?, show_label?, feature_subtype?, transport_decisions?}`; die Antwort ist `{ok, written, skipped, revision}` **ohne Features** (`features.php:2929`).
- Produces:
  - `wpGroupRumpf(stand, entwurf, publicIds) -> object|null` (EIN Rumpf-Bauer für Wege-Editor und Kartendialog)
  - `avesmapsPathGruppeZeilen(pfade, {name, zeigeName, transporte}) -> rows`
  - `avesmapsPathGruppeKnopfText(n) -> string`
  - `avesmapsPathGruppeTeilsText({an, gesamt}) -> string`
  - `openPathEditDialog(path, {inheritLastSettings, gruppe: path[]|null})`
  - `pathEditGruppe` (`let`, `{pfade, stand}|null`), `pathEditSpeicherText()`, `pathEditGruppenModusBeenden()`
  - `mountPathEditFeatureSources(path, festeIds = null)`
  - `handlePathGroupEditSubmit()`

⚠️ **Zwei Fallen aus dem Bestand:**
- `setPathEditSubmitPending(false)` schreibt „Speichern" fest in den Knopf (`review-pending.js:109`). Ohne Anpassung verlöre ein fehlgeschlagenes Speichern die Zahl.
- Der Zuhörer am Wegtyp (`bootstrap.js:939`) ruft `syncPathTransportOptions({ resetToDefault: true })`. Ohne frühe Rückkehr im Gruppenmodus machte ein Wegtyp-Wechsel jeden halben Haken zur Vorgabe des Typs, und gespeichert würde das als Entscheidung.

- [ ] **Step 1: Test schreiben**

`js/review/__tests__/weg-dialog-gruppe.test.js`:

```js
"use strict";
// Der Dialog „Weg bearbeiten" fuer die GANZE Strasse (Entwurf 2026-09-14 §3.5). AUSGEFUEHRT: die neuen Funktionen
// aus review-paths.js laufen gegen eine Dokument-Attrappe, der Rumpf kommt aus dem Modell des Wege-Editors.
// Aus der Wurzel: node js/review/__tests__/weg-dialog-gruppe.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const funktion = (text, name) => {
	const a = text.indexOf("function " + name + "(");
	assert.ok(a >= 0, "Funktion fehlt: " + name);
	const e = text.indexOf("\n}\n", a);
	return text.slice(a, e + 3);
};

const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
const G = require(path.join(WURZEL, "js/review/path-gruppe.js"));
const A = require(path.join(WURZEL, "js/map-features/weg-auswahl.js"));

// ---- 1. Rein: Zeilen, Rumpf, Texte ----------------------------------------------------------------------------
const pfad = (id, typ, zeige, transporte) => ({ properties: { public_id: id, name: "Reichsstrasse-" + id, display_name: "Reichsstraße 2",
	feature_subtype: typ, show_label: zeige, allowed_transports: transporte, wiki_path: { wiki_key: "reichsstrasse-2" } } });
const rs6 = pfad("rs-6", "Reichsstrasse", true, ["caravan", "groupFoot", "horseCarriage"]);
const rs7 = pfad("rs-7", "Reichsstrasse", true, ["caravan", "groupFoot"]);
const rs8 = pfad("rs-8", "Strasse", false, ["caravan", "groupFoot"]);
const lesen = { name: (p) => p.properties.display_name, zeigeName: (p) => p.properties.show_label === true, transporte: (p) => p.properties.allowed_transports };
const zeilen = G.avesmapsPathGruppeZeilen([rs6, rs7, rs8], lesen);
assert.deepStrictEqual(zeilen[2], { public_id: "rs-8", name: "Reichsstraße 2", show_label: false, feature_subtype: "Strasse", allowed_transports: ["caravan", "groupFoot"] });
assert.strictEqual(G.avesmapsPathGruppeZeilen([rs7])[0].name, "Reichsstraße 2", "ohne Leser der ECHTE Name, nie der Maschinenname");
const SCHLUESSEL = ["caravan", "groupFoot", "horseCarriage"];
const stand = M.wpGroupFieldStates(zeilen, SCHLUESSEL);
const unberuehrt = { name: "Reichsstraße 2", show_label: null, feature_subtype: null, transports: { caravan: "an", groupFoot: "an", horseCarriage: "teils" } };
assert.strictEqual(M.wpGroupRumpf(stand, unberuehrt, ["rs-6", "rs-7", "rs-8"]), null, "nichts angefasst: kein Rumpf");
const angefasst = { ...unberuehrt, name: "Reichsstraße II", transports: { ...unberuehrt.transports, horseCarriage: "an" } };
assert.deepStrictEqual(M.wpGroupRumpf(stand, angefasst, ["rs-6", "rs-7", "rs-8"]), {
	action: "update_path_group_details", public_ids: ["rs-6", "rs-7", "rs-8"], fields: ["name", "allowed_transports"],
	name: "Reichsstraße II", transport_decisions: { horseCarriage: true },
});
assert.strictEqual(G.avesmapsPathGruppeKnopfText(10), "Speichern für 10 Abschnitte");
assert.strictEqual(G.avesmapsPathGruppeKnopfText(1), "Speichern");
assert.strictEqual(G.avesmapsPathGruppeTeilsText({ zustand: "teils", an: 7, gesamt: 10 }), "teils · 7 von 10");

// ---- 2. Die Dokument-Attrappe ---------------------------------------------------------------------------------
class Klassen {
	constructor() { this.menge = new Set(); }
	add(n) { this.menge.add(n); }
	remove(n) { this.menge.delete(n); }
	contains(n) { return this.menge.has(n); }
	toggle(n, an) { if (an === undefined ? !this.menge.has(n) : an) { this.menge.add(n); } else { this.menge.delete(n); } }
}
class El {
	constructor(tag, attr = {}) {
		this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.zuhoerer = [];
		this.hidden = false; this.dataset = {}; this.classList = new Klassen();
		this.value = ""; this.checked = false; this.indeterminate = false; this.disabled = false;
		this.required = false; this.readOnly = false; this.placeholder = ""; this.textContent = ""; this.innerHTML = "";
		Object.assign(this, attr);
	}
	set className(text) { this.classList = new Klassen(); String(text).split(/\s+/).filter(Boolean).forEach((n) => this.classList.add(n)); }
	get firstChild() { return this.children[0] || null; }
	addEventListener(typ, fn) { this.zuhoerer.push([typ, fn]); }
	appendChild(kind) { kind.parentElement = this; this.children.push(kind); return kind; }
	insertBefore(kind, vor) { kind.parentElement = this; const i = this.children.indexOf(vor); this.children.splice(i < 0 ? 0 : i, 0, kind); return kind; }
	remove() { if (this.parentElement) { const c = this.parentElement.children; c.splice(c.indexOf(this), 1); this.parentElement = null; } }
	passt(sel) {
		if (sel === "label") { return this.tagName === "LABEL"; }
		if (sel.startsWith(".")) { return this.classList.contains(sel.slice(1)); }
		if (sel === 'input[name="allowed_transport"]') { return this.tagName === "INPUT" && this.name === "allowed_transport"; }
		if (sel === "option[data-gemischt]") { return this.tagName === "OPTION" && Boolean(this.dataset.gemischt); }
		throw new Error("Selektor unbekannt: " + sel);
	}
	alle(sel, aus = []) { this.children.forEach((k) => { if (k.passt(sel)) { aus.push(k); } k.alle(sel, aus); }); return aus; }
	querySelector(sel) { return this.alle(sel)[0] || null; }
	querySelectorAll(sel) { return this.alle(sel); }
	closest(sel) { let el = this; while (el) { if (el.passt(sel)) { return el; } el = el.parentElement; } return null; }
}
const elemente = {};
const mit = (el) => { if (el.id) { elemente[el.id] = el; } return el; };
const formular = mit(new El("form", { id: "path-edit-form" }));
const nameFeld = formular.appendChild(mit(new El("input", { id: "path-edit-name", required: true })));
const autoLabel = formular.appendChild(new El("label"));
autoLabel.appendChild(mit(new El("input", { id: "path-edit-autoname", checked: true })));
const zeigeLabel = formular.appendChild(new El("label"));
const zeige = zeigeLabel.appendChild(mit(new El("input", { id: "path-edit-show-label" })));
const typ = formular.appendChild(mit(new El("select", { id: "path-edit-type", required: true, value: "Weg" })));
["Reichsstrasse", "Strasse", "Weg"].forEach((wert) => typ.appendChild(new El("option", { value: wert })));
const bach = formular.appendChild(mit(new El("div", { id: "path-edit-is-bach-row" })));
const stroemung = formular.appendChild(mit(new El("div", { id: "path-flow-section" })));
const transportKasten = formular.appendChild(mit(new El("div", { id: "path-edit-transport-options" })));
const haken = {};
SCHLUESSEL.forEach((k) => {
	const zeile = transportKasten.appendChild(new El("div", { className: "path-transport-row" }));
	const label = zeile.appendChild(new El("label"));
	haken[k] = label.appendChild(new El("input", { name: "allowed_transport", value: k }));
});
const umfang = formular.appendChild(mit(new El("p", { id: "path-edit-umfang", hidden: true })));
formular.appendChild(mit(new El("div", { id: "path-wiki-weitere-host" })));
const knopf = formular.appendChild(mit(new El("button", { id: "path-edit-submit", textContent: "Speichern" })));
const dokument = {
	getElementById: (id) => elemente[id] || null,
	createElement: (tag) => new El(tag),
	querySelectorAll: (sel) => {
		const vorsatz = "#path-edit-transport-options ";
		assert.ok(sel.startsWith(vorsatz), "unerwarteter Dokument-Selektor: " + sel);
		return transportKasten.querySelectorAll(sel.slice(vorsatz.length));
	},
};

const aufrufe = { einzel: 0, quellen: [], kasten: [], zerstoert: 0, popups: [], suche: 0, panel: 0 };
const kontext = vm.createContext({
	document: dokument, window: {}, console,
	wpGroupFieldStates: M.wpGroupFieldStates,
	avesmapsPathGruppeZeilen: G.avesmapsPathGruppeZeilen,
	avesmapsPathGruppeKnopfText: G.avesmapsPathGruppeKnopfText,
	avesmapsPathGruppeTeilsText: G.avesmapsPathGruppeTeilsText,
	avesmapsWegMarkierungszeileMarkup: A.avesmapsWegMarkierungszeileMarkup,
	avesmapsWegGanzeStreckeAufKarte: () => "Perz – Helmdahl",
	avesmapsWegStreckeAufKarte: () => "Silkwiesen – Wieha",
	avesmapsWegAbschnittLabelAufKarte: (p) => "Abschnitt " + p.properties.public_id.slice(3) + ": X – Y",
	getPathPublicId: (p) => p.properties.public_id,
	getPathDisplayName: lesen.name,
	shouldPathNameBeDisplayed: lesen.zeigeName,
	getPathAllowedTransports: lesen.transporte,
	getTransportOptionsForPathSubtype: () => SCHLUESSEL.slice(),
	normalizePathSubtype: (wert) => String(wert || "Weg"),
	getPathEditFormElement: () => formular,
	populatePathEditForm: () => { aufrufe.einzel += 1; },
	mountPathEditFeatureSources: (p, ids) => { aufrufe.quellen.push([p.properties.public_id, ids]); },
	syncPathAutoNameControls: () => {},
	avesmapsWikiWeitereKastenMount: (host, opts) => { aufrufe.kasten.push(opts); return { neuZeichnen() {}, zerstoeren() { aufrufe.zerstoert += 1; } }; },
	findPathByPublicId: (id) => [rs6, rs7, rs8].find((p) => p.properties.public_id === id) || null,
	refreshPathLayerPopup: (p) => { aufrufe.popups.push(p.properties.public_id); },
	invalidateSpotlightSearchEntryCache: () => { aufrufe.suche += 1; },
	pollLiveMapUpdates: () => Promise.resolve(),
});
kontext.window.avesmapsRefreshInfopanel = () => { aufrufe.panel += 1; };

const pfadeQuelle = lies("js/review/review-paths.js");
const kopfAnfang = pfadeQuelle.indexOf("// ── Der Dialog fuer die GANZE Strasse");
assert.ok(kopfAnfang >= 0, "der Block fuer die ganze Strasse fehlt in review-paths.js");
const kopf = pfadeQuelle.slice(kopfAnfang, pfadeQuelle.indexOf("function pathEditTransportSchluessel("));
const NAMEN = ["pathEditTransportSchluessel", "pathEditSpeicherText", "pathEditUmfangZeigen", "pathEditGruppenModus",
	"populatePathEditFormGruppe", "pathGruppeHakenGeaendert", "readPathGruppeEntwurf", "mountPathWikiWeitere",
	"pathWikiWeitereUebernehmen", "pathEditGruppenModusBeenden"];
vm.runInContext(kopf + NAMEN.map((name) => funktion(pfadeQuelle, name)).join("\n"), kontext);
const rufe = (name) => vm.runInContext(name, kontext);

// ---- 3. Oeffnen fuer die ganze Strasse ------------------------------------------------------------------------
rufe("populatePathEditFormGruppe")(rs7, [rs6, rs7, rs8]);
assert.strictEqual(aufrufe.einzel, 1, "erst der Grundstand des Abschnitts (Sperre, Wiki-Kasten)");
assert.ok(formular.classList.contains("is-gruppe"));
assert.strictEqual(autoLabel.hidden, true, "Auto-Name gibt es fuer die ganze Strasse nicht");
assert.strictEqual(bach.hidden, true, "Bach bleibt am Abschnitt");
assert.strictEqual(stroemung.hidden, true, "Stroemung bleibt am Abschnitt");
assert.strictEqual(nameFeld.value, "Reichsstraße 2");
assert.strictEqual(nameFeld.required, false);
assert.strictEqual(zeige.indeterminate, true, "uneinig: halber Haken");
assert.strictEqual(typ.value, "", "uneinig: gemischt lassen");
assert.strictEqual(typ.required, false);
assert.strictEqual(typ.firstChild.textContent, "— gemischt lassen —");
assert.strictEqual(haken.caravan.checked, true);
assert.strictEqual(haken.caravan.indeterminate, false);
assert.strictEqual(haken.horseCarriage.indeterminate, true);
assert.strictEqual(haken.horseCarriage.parentElement.querySelector(".path-transport-teils").textContent, "teils · 1 von 3");
assert.strictEqual(umfang.hidden, false);
assert.strictEqual(umfang.innerHTML, "<b>Ganze Straße:</b> Perz – Helmdahl");
assert.strictEqual(knopf.textContent, "Speichern für 3 Abschnitte");
const quellen = aufrufe.quellen[aufrufe.quellen.length - 1];
assert.deepStrictEqual([quellen[0], [...quellen[1]]], ["rs-7", ["rs-7", "rs-6", "rs-8"]], "Quellen fest an allen Abschnitten, der geklickte vorn");
const kastenOpts = aufrufe.kasten[aufrufe.kasten.length - 1];
assert.strictEqual(kastenOpts.skin, "label-wiki");
assert.strictEqual(kastenOpts.umfangText(), "die ganze Straße");
assert.strictEqual(kastenOpts.hauptKey(), "reichsstrasse-2");
assert.strictEqual(kastenOpts.haupt().wiki_key, "reichsstrasse-2", "die Liste nennt die Hauptzuweisung zuerst (§3.5)");
assert.deepStrictEqual([...kastenOpts.abschnitte().map((a) => a.public_id)], ["rs-6", "rs-7", "rs-8"]);
assert.strictEqual(transportKasten.zuhoerer.length, 1, "der Haken-Zuhoerer haengt einmal");

// ---- 4. Lesen: unberuehrt -> kein Rumpf; angefasst -> nur das Angefasste ------------------------------------
const gruppe = rufe("pathEditGruppe");
assert.strictEqual(M.wpGroupRumpf(gruppe.stand, rufe("readPathGruppeEntwurf")(), ["rs-6", "rs-7", "rs-8"]), null, "nur geoeffnet: nichts wird geschrieben");
haken.horseCarriage.indeterminate = false;   // ein Klick nimmt den halben Haken ...
haken.horseCarriage.checked = true;
rufe("pathGruppeHakenGeaendert")({ target: haken.horseCarriage });
assert.strictEqual(haken.horseCarriage.parentElement.querySelector(".path-transport-teils"), null, "... und sein „teils"-Hinweis geht");
const rumpf = M.wpGroupRumpf(gruppe.stand, rufe("readPathGruppeEntwurf")(), ["rs-6", "rs-7", "rs-8"]);
assert.deepStrictEqual([...rumpf.fields], ["allowed_transports"]);
assert.deepStrictEqual({ ...rumpf.transport_decisions }, { horseCarriage: true });

// ---- 5. Die Antwort einer weiteren Zuweisung landet sofort in den Kartendaten --------------------------------
rs6.properties.wiki_path_weitere = [{ wiki_key: "alt" }];
rufe("pathWikiWeitereUebernehmen")({ segments_updated: [
	{ public_id: "rs-7", wiki_path_weitere: [{ wiki_key: "b-renpfad", name: "Bärenpfad" }] },
	{ public_id: "rs-6", wiki_path_weitere: [] },
] });
assert.strictEqual(rs7.properties.wiki_path_weitere[0].wiki_key, "b-renpfad");
assert.ok(!("wiki_path_weitere" in rs6.properties), "eine leere Liste nimmt das Feld weg");
assert.deepStrictEqual(aufrufe.popups, ["rs-7", "rs-6"]);
assert.strictEqual(aufrufe.suche, 1, "die Suche vergisst ihren Zwischenspeicher");
assert.strictEqual(aufrufe.panel, 1, "das Infopanel zieht nach");

// ---- 6. Schliessen beendet den Gruppenmodus; der Abschnitt zeigt seine eigene Zeile ---------------------------
rufe("pathEditGruppenModusBeenden")();
assert.strictEqual(rufe("pathEditGruppe"), null);
assert.ok(!formular.classList.contains("is-gruppe"));
assert.strictEqual(nameFeld.required, true);
assert.strictEqual(typ.required, true);
assert.strictEqual(typ.querySelector("option[data-gemischt]"), null);
assert.strictEqual(transportKasten.querySelectorAll(".path-transport-teils").length, 0);
assert.strictEqual(zeige.indeterminate, false);
assert.strictEqual(knopf.textContent, "Speichern");
assert.strictEqual(umfang.hidden, true);
assert.strictEqual(autoLabel.hidden, false);
assert.strictEqual(aufrufe.zerstoert, 1, "der Kasten wird abgebaut");
rufe("pathEditUmfangZeigen")(rs7, false);
assert.strictEqual(umfang.innerHTML, "<b>Abschnitt:</b> Silkwiesen – Wieha");

// ---- 7. Verdrahtung ---------------------------------------------------------------------------------------------
const routing = lies("js/routing/routing.js");
const zweig = routing.slice(routing.indexOf('if (action === "edit-path-details") {'), routing.indexOf('if (action === "edit-path-geometry") {'));
assert.ok(zweig.includes('this.dataset.wegUmfang === "strasse"') && zweig.includes("openPathEditDialog(path, { gruppe })"), zweig);
const submit = lies("js/review/review-editor-submit.js");
const handler = funktion(submit, "handlePathEditFormSubmit");
const abzweig = handler.indexOf("handlePathGroupEditSubmit()");
assert.ok(abzweig > 0 && abzweig < handler.indexOf("buildPathEditPayload(formElement)"), "die ganze Strasse zweigt VOR dem Abschnitts-Rumpf ab");
const gruppenSpeichern = funktion(submit, "handlePathGroupEditSubmit");
assert.ok(gruppenSpeichern.includes("wpGroupRumpf(") && gruppenSpeichern.includes("await pollLiveMapUpdates()"), gruppenSpeichern);
assert.ok(!gruppenSpeichern.includes("updateRevisionFromEditResponse"), "die Antwort traegt keine Features -- ein Revisionssprung liesse den Live-Abgleich nichts finden");
assert.ok(funktion(lies("js/review/review-pending.js"), "setPathEditSubmitPending").includes("pathEditSpeicherText()"));
assert.ok(funktion(lies("js/review/review-dialog-state.js"), "resetPathEditForm").includes("pathEditGruppenModusBeenden()"));
assert.ok(/if \(pathEditGruppe\) \{\s*return;/.test(funktion(pfadeQuelle, "syncPathTransportOptions")), "im Gruppenmodus setzt der Wegtyp-Wechsel die halben Haken nicht zurueck");
assert.ok(funktion(pfadeQuelle, "openPathEditDialog").includes("populatePathEditFormGruppe(path, gruppe)"));
const einzel = funktion(pfadeQuelle, "populatePathEditForm");
assert.ok(einzel.includes("pathEditUmfangZeigen(path, false)") && einzel.includes("mountPathWikiWeitere(path, [path], false)"), "auch der Abschnitt zeigt Zeile und Kasten");
assert.ok(lies("js/pages/wege-editor.js").includes("wpGroupRumpf(state.groupStand, state.groupDraft,"), "der Wege-Editor baut mit demselben Bauer");

const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
const i = (text) => seite.indexOf(text);
assert.ok(i('id="path-edit-umfang"') > i('id="path-edit-public-id"') && i('id="path-edit-umfang"') < i('id="path-edit-name"'), "die Zeile steht oben im Dialog");
assert.ok(i('id="path-wiki-weitere-host"') > i('id="path-wiki-assign-host"') && i('id="path-wiki-weitere-host"') < i('id="path-edit-feature-sources"'), "der Kasten steht unter der Wiki-Zuweisung und ueber den Quellen");
assert.ok(i('<script src="js/ui/wiki-weitere-kasten.js"></script>') > i('<script src="js/ui/wiki-assign-weg.js"></script>'));
assert.ok(i('<script src="js/review/path-gruppe.js"></script>') > 0 && i('<script src="js/review/path-gruppe.js"></script>') < i('<script src="js/review/review-paths.js"></script>'));
assert.ok(/#path-edit-form\.is-gruppe \.path-season \{\s*display: none;/.test(lies("css/features/path-editor.css")), "Zeitfenster gibt es im Gruppenmodus nicht");

console.log("weg-dialog-gruppe.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/review/__tests__/weg-dialog-gruppe.test.js`
Expected: FAIL `Cannot find module '…/path-gruppe.js'`

- [ ] **Step 3: Umsetzen, der eine Rumpf-Bauer**

1. `js/pages/wege-editor-model.js`: direkt nach dem Ende von `function wpGroupTransportDecisions(vorher, entwurf) { … }` einfügen:

```js
/**
 * REIN: der Rumpf fuer `update_path_group_details` -- oder null, wenn nichts angefasst wurde.
 *
 * 🔴 EIN Bauer fuer den Wege-Editor UND den Kartendialog „Weg bearbeiten" (Entwurf 2026-09-14 §3.5). Zwei
 * Fassungen liefen beim naechsten Feld auseinander -- und der Fehler waere still: ein Feld, das nur einer
 * mitschickt, wird beim anderen nie geschrieben.
 */
function wpGroupRumpf(stand, entwurf, publicIds) {
	var felder = wpGroupChangedFields(stand, entwurf);
	if (felder.length === 0) { return null; }
	var rumpf = {
		action: "update_path_group_details",
		public_ids: (Array.isArray(publicIds) ? publicIds : []).slice(),
		fields: felder
	};
	if (felder.indexOf("name") !== -1) { rumpf.name = entwurf.name; }
	if (felder.indexOf("show_label") !== -1) { rumpf.show_label = entwurf.show_label === true; }
	if (felder.indexOf("feature_subtype") !== -1) { rumpf.feature_subtype = entwurf.feature_subtype; }
	if (felder.indexOf("allowed_transports") !== -1) {
		rumpf.transport_decisions = wpGroupTransportDecisions(stand, entwurf);
	}
	return rumpf;
}
```

und im `module.exports` nach `wpGroupTransportDecisions: wpGroupTransportDecisions,` die Zeile `wpGroupRumpf: wpGroupRumpf,` ergänzen.

2. `js/pages/wege-editor.js`, `saveGroupDraft`. Alt:

```js
		var rumpf = {
			action: "update_path_group_details",
			public_ids: gruppe.segments.map(function (s) { return s.public_id; }),
			fields: felder
		};
		if (felder.indexOf("name") !== -1) { rumpf.name = state.groupDraft.name; }
		if (felder.indexOf("show_label") !== -1) { rumpf.show_label = state.groupDraft.show_label === true; }
		if (felder.indexOf("feature_subtype") !== -1) { rumpf.feature_subtype = state.groupDraft.feature_subtype; }
		if (felder.indexOf("allowed_transports") !== -1) {
			rumpf.transport_decisions = wpGroupTransportDecisions(state.groupStand, state.groupDraft);
		}
```

Neu:

```js
		// Entwurf 2026-09-14 §3.5: EIN Rumpf-Bauer fuer Wege-Editor und Kartendialog (wpGroupRumpf im Modell).
		var rumpf = wpGroupRumpf(state.groupStand, state.groupDraft, gruppe.segments.map(function (s) { return s.public_id; }));
```

3. `js/pages/__tests__/wege-gruppe-felder.test.js`. Alt:

```js
	assert.ok(editor.includes("wpGroupTransportDecisions(state.groupStand, state.groupDraft)"),
		"die Fahrtypen reisen nicht als Entscheidungen -- ein halber Haken waere dann ein „aus“");
	assert.ok(editor.includes("action: \"update_path_group_details\""),
		"der Sammel-Schreibweg wird nicht gerufen");
```

Neu:

```js
	// Entwurf 2026-09-14 §3.5: der Rumpf entsteht im Modell (wpGroupRumpf), damit Wege-Editor und Kartendialog
	// denselben schicken. Die Zusicherungen gelten deshalb dem Aufruf hier und dem Bauer dort.
	assert.ok(editor.includes("wpGroupRumpf(state.groupStand, state.groupDraft,"),
		"der Editor baut seinen Rumpf nicht mit dem geteilten Bauer");
	const modellQuelle = lies("js", "pages", "wege-editor-model.js");
	assert.ok(modellQuelle.includes("wpGroupTransportDecisions(stand, entwurf)"),
		"die Fahrtypen reisen nicht als Entscheidungen -- ein halber Haken waere dann ein „aus“");
	assert.ok(modellQuelle.includes("action: \"update_path_group_details\""),
		"der Sammel-Schreibweg wird nicht gerufen");
```

- [ ] **Step 4: Umsetzen, reines Modul**

`js/review/path-gruppe.js`:

```js
// Der Dialog „Weg bearbeiten" fuer die GANZE Strasse (Entwurf 2026-09-14 §3.5) -- die reinen Teile. Die Regeln selbst
// (was uneinig ist, was angefasst wurde, welcher Rumpf) stehen im Modell des Wege-Editors (wpGroupFieldStates,
// wpGroupRumpf in js/pages/wege-editor-model.js); hier nur der Weg von den Kartenpfaden dorthin.
// ⚠️ Normales Skript, NICHT in <template data-nur-editor> (nur-editor-skripte.test.js, Teil C).

/**
 * REIN: Kartenpfade als Zeilen fuer wpGroupFieldStates.
 * @param {{name?: Function, zeigeName?: Function, transporte?: Function}} lesen  die Leser der Karte
 */
function avesmapsPathGruppeZeilen(pfade, lesen) {
	const l = lesen || {};
	return (Array.isArray(pfade) ? pfade : []).map((pfad) => {
		const p = (pfad && pfad.properties) || {};
		return {
			public_id: String(p.public_id || ""),
			// 💣 Ohne Leser der ECHTE Name: properties.name traegt im Browser den Maschinennamen <Wegart>-<n>.
			name: typeof l.name === "function" ? String(l.name(pfad) || "") : String(p.display_name || p.original_name || p.name || ""),
			show_label: typeof l.zeigeName === "function" ? l.zeigeName(pfad) === true : p.show_label === true,
			feature_subtype: String(p.feature_subtype || ""),
			allowed_transports: typeof l.transporte === "function" ? (l.transporte(pfad) || []).slice() : [],
		};
	});
}

/** REIN: „Speichern für 10 Abschnitte" -- ein Abschnitt heisst nur „Speichern". */
function avesmapsPathGruppeKnopfText(anzahl) {
	const n = Number(anzahl) || 0;
	return n > 1 ? "Speichern für " + n + " Abschnitte" : "Speichern";
}

/** REIN: der Hinweis an einem halben Haken, „teils · 7 von 10". */
function avesmapsPathGruppeTeilsText(zustand) {
	return "teils · " + Number((zustand && zustand.an) || 0) + " von " + Number((zustand && zustand.gesamt) || 0);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsPathGruppeZeilen, avesmapsPathGruppeKnopfText, avesmapsPathGruppeTeilsText };
}
```

- [ ] **Step 5: Umsetzen, Dialog (`js/review/review-paths.js`)**

1. In `populatePathEditForm` die letzten Zeilen

```js
	if (typeof renderPathFlowSection === "function") {
		renderPathFlowSection();
	}
	mountPathEditFeatureSources(path);
}

/**
 * Der Quellenkasten des Wegedialogs
```

ersetzen durch:

```js
	if (typeof renderPathFlowSection === "function") {
		renderPathFlowSection();
	}
	mountPathEditFeatureSources(path);
	// Entwurf 2026-09-14 §3.5: oben die Zeile „Abschnitt: A – B", unter der Wiki-Zuweisung die weiteren Zuweisungen.
	pathEditUmfangZeigen(path, false);
	mountPathWikiWeitere(path, [path], false);
}

/**
 * Der Quellenkasten des Wegedialogs
```

2. Die ganze Funktion `mountPathEditFeatureSources` (Zeilen 54–86, der Kommentar darüber bleibt) ersetzen durch:

```js
function mountPathEditFeatureSources(path, festeIds = null) {
	const host = document.getElementById("path-edit-feature-sources");
	if (!host || typeof mountFeatureSourceEditor !== "function") {
		return;
	}
	if (typeof host.__fsDetachAutocomplete === "function") {
		host.__fsDetachAutocomplete();
	}
	const frisch = host.cloneNode(false);
	host.replaceWith(frisch);
	const kennung = () => String(document.getElementById("path-edit-public-id")?.value || "").trim();
	const schluesselVon = (p) => (typeof avesmapsWegGruppenSchluessel === "function" ? avesmapsWegGruppenSchluessel(p) : "");
	const eigenerSchluessel = schluesselVon(path);
	const amAbschnitt = {
		publicIds: () => {
			const eigene = kennung();
			const ids = eigene ? [eigene] : [];
			if (!eigenerSchluessel || !Array.isArray(typeof pathData !== "undefined" ? pathData : null)) {
				return ids;
			}
			for (const anderer of pathData) {
				const id = String(anderer?.properties?.public_id || "").trim();
				if (id && !ids.includes(id) && schluesselVon(anderer) === eigenerSchluessel) {
					ids.push(id);
				}
			}
			return ids;
		},
		fest: false,
	};
	mountFeatureSourceEditor(frisch, "path", kennung, {
		// Entwurf 2026-09-14 §3.5: fuer die GANZE Strasse fest („An allen N Abschnitten"), wie die Weg-Ebene des
		// Wege-Editors; der geklickte Abschnitt steht vorn und ist der Anker.
		gruppe: Array.isArray(festeIds) && festeIds.length > 1
			? { publicIds: () => festeIds.slice(), fest: true }
			: amAbschnitt,
	});
}

// ── Der Dialog fuer die GANZE Strasse (Entwurf 2026-09-14 §3.5) ─────────────────────────────────────────────────
// Die Felder der Weg-Ebene des Wege-Editors ueber `update_path_group_details`: Wegname, „Weg anzeigen", Wegtyp,
// Transportmittel. 💣 Geschrieben wird nur, was angefasst wurde (wpGroupRumpf); ein uneiniges Feld zeigt
// „— gemischt lassen —" bzw. einen halben Haken. Bach und Stroemung bleiben am Abschnitt; Zeitfenster wirken ueber
// den Hauptschluessel ohnehin fuer alle Abschnitte.
let pathEditGruppe = null;          // { pfade: path[], stand } oder null (= Abschnitt, der Dialog wie bisher)
let pathWikiWeitereKasten = null;   // der Kasten „Weitere Wiki-Zuweisungen" im Dialog
let pathGruppeVerdrahtet = false;
const PATH_GRUPPE_GEMISCHT = "— gemischt lassen —";

function pathEditTransportSchluessel() {
	return Array.from(document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]')).map((input) => input.value);
}

function pathEditSpeicherText() {
	return pathEditGruppe ? avesmapsPathGruppeKnopfText(pathEditGruppe.pfade.length) : "Speichern";
}

/** Die kurze Zeile oben im Dialog -- dieselbe wie in der Infobox (§3.5). */
function pathEditUmfangZeigen(path, ganz) {
	const zeile = document.getElementById("path-edit-umfang");
	if (!zeile) {
		return;
	}
	const strecke = ganz
		? (typeof avesmapsWegGanzeStreckeAufKarte === "function" ? avesmapsWegGanzeStreckeAufKarte(path) : "")
		: (typeof avesmapsWegStreckeAufKarte === "function" ? avesmapsWegStreckeAufKarte(path) : "");
	const markup = typeof avesmapsWegMarkierungszeileMarkup === "function"
		? avesmapsWegMarkierungszeileMarkup({ gruppe: "", publicId: ganz ? null : getPathPublicId(path) }, strecke)
		: "";
	zeile.innerHTML = markup;
	zeile.hidden = markup === "";
}

/** Schaltet ab, was es fuer die ganze Strasse nicht gibt -- und beim Verlassen wieder an. */
function pathEditGruppenModus(an) {
	const form = getPathEditFormElement();
	if (form) {
		form.classList.toggle("is-gruppe", Boolean(an));
	}
	const autoname = document.getElementById("path-edit-autoname");
	const autonameZeile = autoname ? autoname.closest("label") : null;
	if (autonameZeile) {
		autonameZeile.hidden = Boolean(an);
	}
	if (an) {
		// Bach und Stroemung bleiben am Abschnitt. Beim Verlassen stellt populatePathEditForm beide selbst her.
		const bach = document.getElementById("path-edit-is-bach-row");
		if (bach) { bach.hidden = true; }
		const stroemung = document.getElementById("path-flow-section");
		if (stroemung) { stroemung.hidden = true; }
	}
	const name = document.getElementById("path-edit-name");
	if (name) {
		name.required = !an;
		name.placeholder = an ? PATH_GRUPPE_GEMISCHT : "";
	}
	const typ = document.getElementById("path-edit-type");
	if (typ) {
		typ.required = !an;
		const gemischt = typ.querySelector("option[data-gemischt]");
		if (gemischt) { gemischt.remove(); }
	}
	const zeige = document.getElementById("path-edit-show-label");
	if (zeige) {
		zeige.indeterminate = false;
	}
	document.querySelectorAll("#path-edit-transport-options .path-transport-teils").forEach((hinweis) => hinweis.remove());
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		input.indeterminate = false;
	});
	const knopf = document.getElementById("path-edit-submit");
	if (knopf) {
		knopf.textContent = pathEditSpeicherText();
	}
}

function populatePathEditFormGruppe(path, pfade) {
	// Erst der Grundstand des geklickten Abschnitts: Sperre, Wiki-Zuweisung, Abweichungszeile. Dann ueberschreibt die
	// ganze Strasse, was sie anders zeigt.
	populatePathEditForm(path);
	const stand = wpGroupFieldStates(avesmapsPathGruppeZeilen(pfade, {
		name: getPathDisplayName,
		zeigeName: shouldPathNameBeDisplayed,
		transporte: getPathAllowedTransports,
	}), pathEditTransportSchluessel());
	pathEditGruppe = { pfade: pfade.slice(), stand };
	pathEditGruppenModus(true);

	const autoname = document.getElementById("path-edit-autoname");
	if (autoname) {
		autoname.checked = false;
	}
	const name = document.getElementById("path-edit-name");
	if (name) {
		name.value = stand.name.gleich ? stand.name.wert : "";
	}
	// R1: ein zugewiesener Wiki-Weg besitzt den Namen -- dieselbe Sperre wie am Abschnitt.
	syncPathAutoNameControls();

	const zeige = document.getElementById("path-edit-show-label");
	if (zeige) {
		zeige.checked = stand.show_label.gleich && stand.show_label.wert === true;
		zeige.indeterminate = !stand.show_label.gleich;
	}

	const typ = document.getElementById("path-edit-type");
	if (typ) {
		if (stand.feature_subtype.gleich && stand.feature_subtype.wert) {
			typ.value = stand.feature_subtype.wert;
		} else {
			const gemischt = document.createElement("option");
			gemischt.value = "";
			gemischt.textContent = PATH_GRUPPE_GEMISCHT;
			gemischt.dataset.gemischt = "1";
			typ.insertBefore(gemischt, typ.firstChild);
			typ.value = "";
		}
	}

	// Angeboten wird, was IRGENDEIN Wegtyp der Strasse anbietet; der Server filtert je Abschnitt gegen seinen Typ.
	const angeboten = new Set();
	stand.feature_subtype.verteilung.forEach((eintrag) => {
		getTransportOptionsForPathSubtype(normalizePathSubtype(eintrag.wert)).forEach((schluessel) => angeboten.add(schluessel));
	});
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		const zustand = stand.transports[input.value] || { zustand: "aus", an: 0, gesamt: pfade.length };
		const zeile = input.closest(".path-transport-row");
		if (zeile) {
			zeile.hidden = !angeboten.has(input.value);
		}
		input.disabled = !angeboten.has(input.value);
		input.checked = zustand.zustand === "an";
		// 💣 Ein halber Haken ist ein EIGENER Wert, kein „aus" -- er wird nur geschrieben, wenn ihn jemand anklickt.
		input.indeterminate = zustand.zustand === "teils";
		if (zustand.zustand === "teils" && input.parentElement) {
			const hinweis = document.createElement("span");
			hinweis.className = "path-transport-teils";
			hinweis.textContent = avesmapsPathGruppeTeilsText(zustand);
			input.parentElement.appendChild(hinweis);
		}
	});
	// ⚠️ EINMAL verdrahtet, nicht bei jedem Oeffnen: der Kasten steht fest in index.html.
	if (!pathGruppeVerdrahtet) {
		const kasten = document.getElementById("path-edit-transport-options");
		if (kasten && typeof kasten.addEventListener === "function") {
			kasten.addEventListener("change", pathGruppeHakenGeaendert);
			pathGruppeVerdrahtet = true;
		}
	}

	pathEditUmfangZeigen(path, true);
	mountPathWikiWeitere(path, pfade, true);
	const eigene = getPathPublicId(path);
	mountPathEditFeatureSources(path, [eigene].concat(pfade.map((anderer) => getPathPublicId(anderer)).filter((id) => id !== eigene)));
}

// Ein Klick nimmt einem halben Haken seinen Zwischenzustand -- dann gilt „teils · 7 von 10" nicht mehr.
function pathGruppeHakenGeaendert(ereignis) {
	const input = ereignis && ereignis.target;
	if (!input || input.name !== "allowed_transport" || input.indeterminate || !input.parentElement) {
		return;
	}
	const hinweis = input.parentElement.querySelector(".path-transport-teils");
	if (hinweis) {
		hinweis.remove();
	}
}

/** Was in der Maske steht, in der Form von wpGroupChangedFields: `null` heisst „gemischt lassen". */
function readPathGruppeEntwurf() {
	const name = document.getElementById("path-edit-name");
	const zeige = document.getElementById("path-edit-show-label");
	const typ = document.getElementById("path-edit-type");
	const transports = {};
	document.querySelectorAll('#path-edit-transport-options input[name="allowed_transport"]').forEach((input) => {
		if (input.disabled) {
			return;
		}
		transports[input.value] = input.indeterminate ? "teils" : (input.checked ? "an" : "aus");
	});
	const nameWert = name ? String(name.value || "").trim() : "";
	return {
		name: nameWert === "" ? null : nameWert,
		show_label: zeige && !zeige.indeterminate ? zeige.checked === true : null,
		feature_subtype: typ && typ.value !== "" ? typ.value : null,
		transports,
	};
}

/** Der Kasten „Weitere Wiki-Zuweisungen" im Dialog -- fuer den Abschnitt oder fuer die ganze Strasse (§3.5). */
function mountPathWikiWeitere(path, pfade, ganz) {
	if (pathWikiWeitereKasten) {
		pathWikiWeitereKasten.zerstoeren();
		pathWikiWeitereKasten = null;
	}
	const host = document.getElementById("path-wiki-weitere-host");
	if (!host || typeof avesmapsWikiWeitereKastenMount !== "function") {
		return;
	}
	const label = (pfad) => (typeof avesmapsWegAbschnittLabelAufKarte === "function" ? avesmapsWegAbschnittLabelAufKarte(pfad) : "");
	pathWikiWeitereKasten = avesmapsWikiWeitereKastenMount(host, {
		skin: "label-wiki",
		hauptKey: () => String(path.properties?.wiki_path?.wiki_key || ""),
		// Entwurf §3.5: die Liste nennt die Hauptzuweisung als erste Zeile (ohne ✕).
		haupt: () => path.properties?.wiki_path || null,
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

// Die Antwort von add_weitere/remove_weitere traegt je Abschnitt die neue Liste (Task 3). Sie wird sofort in die
// Kartendaten gelegt -- Kasten, Infobox und Suche lesen dort --, und der naechste Live-Abgleich bestaetigt sie.
function pathWikiWeitereUebernehmen(daten) {
	(Array.isArray(daten && daten.segments_updated) ? daten.segments_updated : []).forEach((eintrag) => {
		const pfad = typeof findPathByPublicId === "function" ? findPathByPublicId(eintrag.public_id) : null;
		if (!pfad || !pfad.properties) {
			return;
		}
		if (Array.isArray(eintrag.wiki_path_weitere) && eintrag.wiki_path_weitere.length) {
			pfad.properties.wiki_path_weitere = eintrag.wiki_path_weitere;
		} else {
			delete pfad.properties.wiki_path_weitere;
		}
		if (typeof refreshPathLayerPopup === "function") {
			refreshPathLayerPopup(pfad);
		}
	});
	if (typeof invalidateSpotlightSearchEntryCache === "function") {
		invalidateSpotlightSearchEntryCache();
	}
	if (typeof window !== "undefined" && typeof window.avesmapsRefreshInfopanel === "function") {
		window.avesmapsRefreshInfopanel();
	}
}

function pathEditGruppenModusBeenden() {
	pathEditGruppe = null;
	pathEditGruppenModus(false);
	const zeile = document.getElementById("path-edit-umfang");
	if (zeile) {
		zeile.hidden = true;
		zeile.innerHTML = "";
	}
	if (pathWikiWeitereKasten) {
		pathWikiWeitereKasten.zerstoeren();
		pathWikiWeitereKasten = null;
	}
}
```

3. `openPathEditDialog` (Zeilen 136–144) ersetzen durch:

```js
function openPathEditDialog(path, { inheritLastSettings = false, gruppe = null } = {}) {
	resetPathEditForm();
	// Entwurf 2026-09-14 §3.5: ganze Strasse markiert -> alle Abschnitte. Ein einteiliger Weg behaelt die Abschnittsmaske.
	if (Array.isArray(gruppe) && gruppe.length > 1) {
		populatePathEditFormGruppe(path, gruppe);
	} else if (inheritLastSettings && lastPathEditSettings) {
		populatePathEditFormFromLastSettings(path);
	} else {
		populatePathEditForm(path);
	}
	setPathEditDialogOpen(true);
}
```

4. In `syncPathTransportOptions` als erste Zeilen des Rumpfs einfügen:

```js
	// Entwurf 2026-09-14 §3.5: im Gruppenmodus gehoeren die Haken der ganzen Strasse. Ein Wegtyp-Wechsel
	// (bootstrap.js ruft hier mit resetToDefault) darf die halben Haken nicht auf die Vorgabe eines Typs setzen --
	// sie wuerden sonst als Entscheidung gespeichert. Der Server filtert je Abschnitt gegen seinen Typ.
	if (pathEditGruppe) {
		return;
	}
```

- [ ] **Step 6: Umsetzen, Speichern, Zurücksetzen, Klickzweig**

1. `js/review/review-editor-submit.js`, `handlePathEditFormSubmit`: direkt nach dem Block

```js
	if (!formElement || !formElement.reportValidity() || !pathEditFeature) {
		return;
	}
```

einfügen:

```js

	// Entwurf 2026-09-14 §3.5: die ganze Strasse speichert ueber die Weg-Ebene, nicht ueber den Abschnitt.
	if (typeof pathEditGruppe !== "undefined" && pathEditGruppe) {
		await handlePathGroupEditSubmit();
		return;
	}
```

und direkt vor `async function handlePowerlineEditFormSubmit(event) {` einfügen:

```js
async function handlePathGroupEditSubmit() {
	const gruppe = pathEditGruppe;
	const rumpf = wpGroupRumpf(gruppe.stand, readPathGruppeEntwurf(), gruppe.pfade.map((pfad) => getPathPublicId(pfad)));
	if (!rumpf) {
		setPathEditStatus("Nichts geändert.");
		return;
	}
	setPathEditStatus(`Wird für ${gruppe.pfade.length} Abschnitte gespeichert …`, "pending");
	setPathEditSubmitPending(true);
	try {
		const result = await submitMapFeatureEdit(rumpf);
		// 💣 KEIN updateRevisionFromEditResponse: die Antwort traegt keine Features. Hoebe sie den lokalen Stand an,
		// faende der Live-Abgleich danach „nichts Neues", und die Karte zeigte die alten Abschnitte.
		// ⚠️ Laeuft gerade ein Abgleich, kehrt dieser Aufruf sofort zurueck; der naechste Takt (15 s) holt es nach.
		await pollLiveMapUpdates();
		void loadChangeLog();
		setPathEditSubmitPending(false);
		setPathEditDialogOpen(false, { resetForm: true });
		showFeedbackToast(Number(result.written) === 0
			? "Nichts zu ändern — die Abschnitte standen schon so."
			: `${result.written} von ${gruppe.pfade.length} Abschnitten gespeichert.`, "success");
	} catch (error) {
		console.error("Weg konnte nicht gespeichert werden:", error);
		setPathEditStatus(error.message || "Weg konnte nicht gespeichert werden.", "error");
	} finally {
		setPathEditSubmitPending(false);
	}
}

```

2. `js/review/review-pending.js:109`: `submitButtonElement.textContent = isPending ? "Speichert..." : "Speichern";` ersetzen durch:

```js
		// Entwurf 2026-09-14 §3.5: fuer die ganze Strasse traegt der Knopf die Zahl der Abschnitte.
		submitButtonElement.textContent = isPending ? "Speichert..." : (typeof pathEditSpeicherText === "function" ? pathEditSpeicherText() : "Speichern");
```

3. `js/review/review-dialog-state.js`, `resetPathEditForm`: direkt nach `setPathEditStatus();` (vor der schließenden `}`) einfügen:

```js
	// Entwurf 2026-09-14 §3.5: der Gruppenmodus endet mit jedem Zuruecksetzen -- sonst oeffnete der naechste
	// Abschnitt mit den Haken der vorigen Strasse.
	if (typeof pathEditGruppenModusBeenden === "function") {
		pathEditGruppenModusBeenden();
	}
```

4. `js/routing/routing.js`, Zweig `edit-path-details`: `openPathEditDialog(path);` ersetzen durch:

```js
		// Entwurf 2026-09-14 §3.5: war die ganze Strasse markiert (Task 13), bearbeitet der Dialog alle ihre Abschnitte.
		const gruppe = this.dataset.wegUmfang === "strasse" && typeof avesmapsWegAuswahlGruppenPfade === "function"
			? avesmapsWegAuswahlGruppenPfade(path)
			: null;
		openPathEditDialog(path, { gruppe });
```

- [ ] **Step 7: Umsetzen, Markup und CSS**

1. `index.html` Zeile 1775: `<input id="path-edit-public-id" name="public_id" type="hidden" /><div class="label-edit-section">` ersetzen durch `<input id="path-edit-public-id" name="public_id" type="hidden" /><p id="path-edit-umfang" class="path-edit-umfang" hidden></p><div class="label-edit-section">`.
2. `index.html` Zeile 1847: `<div id="path-wiki-assign-host"></div>` ersetzen durch `<div id="path-wiki-assign-host"></div><div class="label-edit-section" id="path-wiki-weitere-host"></div>`. Der äußere Kasten hat hier eine Aufgabe: der Kasten zeichnet seine Überschrift als `.label-edit-section-title` hinein (Skin `label-wiki`, Task 7). `wiki-assign-kein-doppelrahmen.test.js` sucht nur `…-wiki-assign-host`.
3. `index.html`: nach `<script src="js/ui/wiki-assign-weg.js"></script>` einfügen `<script src="js/ui/wiki-weitere-kasten.js"></script>`; direkt vor `<script src="js/review/review-paths.js"></script>` einfügen `<script src="js/review/path-gruppe.js"></script>`.
4. `css/features/path-editor.css` am Ende anhängen:

```css

/* Entwurf 2026-09-14 §3.5: der Dialog fuer die GANZE Strasse. Zeitfenster wirken ueber den Hauptschluessel ohnehin
   fuer alle Abschnitte -- im Gruppenmodus gibt es sie hier nicht (review-paths.js, pathEditGruppenModus). */
#path-edit-form.is-gruppe .path-season {
	display: none;
}

/* „teils · 7 von 10": ein halber Haken ist ein eigener Wert, kein „aus" (Weg-Ebene des Wege-Editors). */
.path-transport-teils {
	color: var(--color-text-muted);
	font-size: var(--font-size-caption);
}

/* Die Zeile oben im Dialog -- dieselbe wie in der Infobox (.info-header__markierung). */
.path-edit-umfang {
	margin: 0 0 var(--space-6);
	color: var(--color-text);
	font-size: var(--font-size-small);
	line-height: var(--leading-snug);
}
```

- [ ] **Step 8: Tests laufen lassen**

Run:
- `node js/review/__tests__/weg-dialog-gruppe.test.js`
- `node js/pages/__tests__/wege-gruppe-felder.test.js`
- `node js/pages/__tests__/wege-gruppe-ablauf.test.js` (lädt `wege-editor-model.js` ganz, `wpGroupRumpf` ist darin)
- `node js/review/__tests__/quellen-im-wegedialog.test.js` (`fest === false` am Abschnitt bleibt)
- `node js/review/__tests__/wiki-assign-kein-doppelrahmen.test.js`
- `node js/review/__tests__/stroemung-zwei-spalten.test.js`
- `node js/ui/__tests__/wiki-assign-weg.test.js`
- `node js/app/__tests__/nur-editor-skripte.test.js`

Expected: grün.

- [ ] **Step 9: Commit**

```bash
printf '%s\n' "feat(karte): \"Weg bearbeiten\" bearbeitet das Markierte -- fuer die ganze Strasse die Felder der Weg-Ebene mit \"Speichern fuer N Abschnitte\", dazu weitere Wiki-Zuweisungen im Dialog" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §3.5. EIN Rumpf-Bauer (wpGroupRumpf) fuer Wege-Editor und Kartendialog." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/review/path-gruppe.js js/review/__tests__/weg-dialog-gruppe.test.js js/pages/wege-editor-model.js js/pages/wege-editor.js js/pages/__tests__/wege-gruppe-felder.test.js js/review/review-paths.js js/review/review-editor-submit.js js/review/review-dialog-state.js js/review/review-pending.js js/routing/routing.js index.html css/features/path-editor.css && git commit -F "$SCRATCH/msg.txt"
```

- [ ] **Step 10: Abnahme im Browser (Handgriffe, nicht Maße)**

Nach dem Push von Task 12–14, auf https://avesmaps.de/?edit=1 als Owner:
1. Auf „Reichsstraße 2" klicken. Die ganze Straße ist gelb, unter „Reichsstraße" steht „**Ganze Straße:** A – B", im Editorband fehlt „Verlauf bearbeiten".
2. „Bearbeiten". Oben steht dieselbe Zeile, der Knopf heißt „Speichern für N Abschnitte", uneinige Felder zeigen „— gemischt lassen —" bzw. „teils · x von N". Bach, Strömung, Auto-Name und Zeitfelder sind weg, die Quellen sagen „An allen N Abschnitten".
3. Nur „Weg anzeigen" umlegen, speichern. Die Meldung sagt „N von N Abschnitten gespeichert.", und im Wege-Editor steht das Häkchen an allen Abschnitten. Danach zurücklegen.
4. Noch einmal auf dieselbe Straße klicken: nur der Abschnitt ist gelb, die Zeile sagt „**Abschnitt:** A – B", „Verlauf bearbeiten" ist wieder da, und der Dialog ist der bisherige.
5. Im Dialog unter „Weitere Wiki-Zuweisungen" einen Artikel hinzufügen und wieder entfernen. Der Wegname bleibt.
6. Daneben auf die Karte klicken: die Markierung ist weg.
7. Als Besucher (ohne `edit=1`) die Seite laden: ein Weg-Klick öffnet die Infobox wie bisher, nichts wird gelb, die Konsole bleibt ohne Fehler.

**🚚 Lieferung 5:** Tasks 12 bis 14 zusammen live (Klickfolge, Markierung, Dialog; nur im Bearbeiten-Modus sichtbar). Owner nimmt ab.

---

## Task 15: Mehrere Wegpunkte gehen gebündelt als `via`

**Files:**
- Create: `js/routing/route-buendel.js`
- Create: `js/routing/__tests__/route-buendel.test.js`
- Modify: `js/routing/route-engine.js:473-498` (Schleife in `buildRouteResultFromSelectedLocationsServer`)
- Modify: `js/routing/__tests__/sperrzeiten-anfrage.test.js` (Zeile 57, Zeilen 80 und 144, neuer Abschnitt 7)
- Modify: `index.html` (Skript-Tag direkt vor `<script src="js/routing/route-engine.js"></script>`)

**Interfaces:**
- Consumes: `AVESMAPS_ROUTE_MAX_VIA` (PHP, `api/_internal/routing/request.php:40`) als Zwilling; der Server fährt `via` Etappe für Etappe auf einem Graphen (`avesmapsFindClientCompatibleRouteLegs`, `client-graph.php:2055`), naht Knoten ohne Dopplung, und `closures[].leg_index` zählt die Etappe **innerhalb der Anfrage** (`closures.php:78`). Ein Wegpunkt aus „Hierher reisen" trägt `isMapPoint: true` (`route-travel-here.js:65`).
- Produces:
  - `const AVESMAPS_ROUTE_MAX_VIA = 10` (Browser)
  - `avesmapsRouteBuendel(stationen, maxVia) -> Array<{von: number, bis: number}>` (Indexbereiche einschließlich; `bis` eines Bündels = `von` des nächsten)

💣 **Unsichtbar, aber es trifft jede Route mit mehr als zwei Wegpunkten.** Deshalb eine eigene Lieferung mit Messung vorher und nachher, bevor die Kachel aus Task 16 viele Wegpunkte erzeugt.

- [ ] **Step 1: Test schreiben**

`js/routing/__tests__/route-buendel.test.js`:

```js
"use strict";
// Wegpunkte zu `via`-Anfragen buendeln (Entwurf 2026-09-14 §5.3): die Regel AUSGEFUEHRT, dazu der echte
// buildRouteResultFromSelectedLocationsServer gegen eine Server-Attrappe -- gebuendelt und paarweise gleich.
// Aus der Wurzel: node js/routing/__tests__/route-buendel.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const B = require(path.join(WURZEL, "js/routing/route-buendel.js"));
const orte = (n, kartenpunkte = []) => Array.from({ length: n }, (_, i) => ({ name: "Ort" + i, ...(kartenpunkte.includes(i) ? { isMapPoint: true } : {}) }));

// 1. Die Regel
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(2), 10), [{ von: 0, bis: 1 }]);
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(40), 10),
	[{ von: 0, bis: 11 }, { von: 11, bis: 22 }, { von: 22, bis: 33 }, { von: 33, bis: 39 }], "40 Wegpunkte -> 4 Anfragen (§6 D)");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(12), 10), [{ von: 0, bis: 11 }], "12 Orte = 10 Zwischenhalte = eine Anfrage");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(13), 10), [{ von: 0, bis: 11 }, { von: 11, bis: 12 }]);
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(8, [5]), 10), [{ von: 0, bis: 5 }, { von: 5, bis: 7 }], "ein Kartenpunkt ist Buendelgrenze");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(8, [0, 7]), 10), [{ von: 0, bis: 7 }], "am Anfang und am Ende darf er stehen");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(6, [3, 4]), 10), [{ von: 0, bis: 3 }, { von: 3, bis: 4 }, { von: 4, bis: 5 }]);
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(4), 0), [{ von: 0, bis: 1 }, { von: 1, bis: 2 }, { von: 2, bis: 3 }], "Deckel 0: Paare");
assert.deepStrictEqual(B.avesmapsRouteBuendel(orte(1), 10), []);
assert.deepStrictEqual(B.avesmapsRouteBuendel([], 10), []);
for (const n of [2, 3, 11, 12, 13, 24, 25, 39, 40, 41]) {
	const buendel = B.avesmapsRouteBuendel(orte(n, [7, 19]), 10);
	assert.strictEqual(buendel[0].von, 0);
	assert.strictEqual(buendel[buendel.length - 1].bis, n - 1, "das letzte Buendel endet am Ziel");
	buendel.forEach((b, i) => {
		assert.ok(b.bis - b.von - 1 <= 10, "hoechstens 10 Zwischenhalte: " + JSON.stringify(b));
		if (i > 0) { assert.strictEqual(b.von, buendel[i - 1].bis, "lueckenlos"); }
		for (let k = b.von + 1; k < b.bis; k += 1) { assert.ok(![7, 19].includes(k), "kein Kartenpunkt in via: " + n); }
	});
}

// 2. Der Zwilling des Server-Deckels
const php = lies("api/_internal/routing/request.php").match(/const AVESMAPS_ROUTE_MAX_VIA = (\d+);/);
assert.ok(php, "AVESMAPS_ROUTE_MAX_VIA in request.php nicht gefunden");
assert.strictEqual(B.AVESMAPS_ROUTE_MAX_VIA, Number(php[1]), "Client- und Server-Deckel sind EIN Wert");

// 3. Gebuendelt und paarweise dasselbe -- der echte Aufrufer gegen eine Server-Attrappe
global.window = { location: { search: "" }, setTimeout: () => 0 };
global.tr = (key, fallback, vars) => String(fallback).replace(/\{(\w+)\}/g, (_, n) => (vars && vars[n] !== undefined ? vars[n] : ""));
global.showRouteNotice = () => {};
global.$ = () => ({ is: () => false, val: () => "fastest", text: () => {} });
global.buildRouteOptionsFromPlannerControls = () => ({ allowLand: true, allowRiver: true, allowSea: true, landOption: "groupFoot" });
global.getPlannerRestHoursPerDay = () => 16;
global.normalizePathSubtype = (v) => String(v || "Weg");
global.findPathByPublicId = () => null;
global.pathData = [];
global.syntheticPathSegments = new Map();
global.getTransportOptionForRouteType = () => "groupFoot";
global.routePlanDepartureFromPanel = () => null;
vm.runInThisContext(lies("js/routing/route-engine.js"), { filename: "route-engine.js" });

const etappe = (von, nach) => ({ edge_id: von + ">" + nach, from_node: von, to_node: nach, subtype: "Strasse",
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] } });
let anfragen = [];
global.calculateRouteServer = async (anfrage) => {
	anfragen.push(JSON.parse(JSON.stringify(anfrage)));
	const stationen = [anfrage.from, ...anfrage.via, anfrage.to];
	const segmente = stationen.slice(1).map((nach, i) => etappe(stationen[i], nach));
	return { source: "server", ok: true, found: true, segments: segmente,
		route: { found: true, segments: segmente, duration: { travel_days: segmente.length }, closures: [] } };
};
global.selectedLocations = orte(25, [13]);
global.avesmapsRouteBuendel = B.avesmapsRouteBuendel;
global.AVESMAPS_ROUTE_MAX_VIA = B.AVESMAPS_ROUTE_MAX_VIA;

(async () => {
	const gebuendelt = await buildRouteResultFromSelectedLocationsServer(false);
	const gebuendeltAnfragen = anfragen;
	anfragen = [];
	delete global.avesmapsRouteBuendel;
	const paarweise = await buildRouteResultFromSelectedLocationsServer(false);

	assert.strictEqual(gebuendeltAnfragen.length, 3, "25 Orte mit Kartenpunkt bei 13: [0..11] [11..13] [13..24]");
	assert.deepStrictEqual([gebuendeltAnfragen[0].from, gebuendeltAnfragen[0].via.length, gebuendeltAnfragen[0].to], ["Ort0", 10, "Ort11"]);
	assert.deepStrictEqual(gebuendeltAnfragen[1].via, ["Ort12"]);
	assert.strictEqual(anfragen.length, 24, "ohne route-buendel.js je Paar eine Anfrage (Rueckfall)");
	assert.deepStrictEqual(gebuendelt.routeNodeNames, paarweise.routeNodeNames, "dieselben Knotennamen");
	assert.deepStrictEqual(gebuendelt.segments, paarweise.segments, "dieselben Etappen");
	assert.strictEqual(gebuendelt.segments.length, 24);

	// 4. Ladereihenfolge
	const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
	const buendelTag = seite.indexOf('<script src="js/routing/route-buendel.js"></script>');
	assert.ok(buendelTag > 0 && buendelTag < seite.indexOf('<script src="js/routing/route-engine.js"></script>'), "route-buendel.js laedt vor route-engine.js");

	console.log("route-buendel.test.js: ok");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
```

`js/routing/__tests__/sperrzeiten-anfrage.test.js` anpassen:

1. Zeile 57 `load("../route-engine.js");` ersetzen durch:

```js
load("../route-buendel.js");
load("../route-engine.js");
```

2. Beide Zeilen `	global.selectedLocations = [{ name: "Yrramis" }, { name: "Mühlingen" }, { name: "Greifenfurt" }];` (Zeile 80 und 144, zeichengleich, also `replace_all`) ersetzen durch:

```js
	// Muehlingen als Kartenpunkt: Buendelgrenze -- die Abschnitte 1 bis 6 pruefen weiter ZWEI Anfragen je Reise.
	global.selectedLocations = [{ name: "Yrramis" }, { name: "Mühlingen", isMapPoint: true }, { name: "Greifenfurt" }];
```

3. Direkt vor `	console.log("sperrzeiten-anfrage.test.js: all assertions passed");` einfügen:

```js
	// ---- 7. Buendel (Entwurf 2026-09-14 §5.3): drei Orte ohne Kartenpunkt sind EINE Anfrage mit `via` -----
	global.routePlanDepartureFromPanel = () => null;
	global.selectedLocations = [{ name: "Yrramis" }, { name: "Mühlingen" }, { name: "Greifenfurt" }];
	anfragen = [];
	antworten = [{ found: true, segments: [etappe("e1", "Yrramis", "Mühlingen"), etappe("e2", "Mühlingen", "Greifenfurt")],
		duration: { travel_days: 3 }, closures: [bericht("e2", { leg_index: 1 })] }];
	const gebuendelt = await buildRouteResultFromSelectedLocationsServer(false);
	assert.strictEqual(anfragen.length, 1, "eine Anfrage: " + JSON.stringify(anfragen.map((a) => [a.from, a.via, a.to])));
	assert.deepStrictEqual([anfragen[0].from, anfragen[0].via, anfragen[0].to], ["Yrramis", ["Mühlingen"], "Greifenfurt"]);
	assert.strictEqual(gebuendelt.segments.length, 2);
	assert.strictEqual(gebuendelt.closures[0].segmentOffset, 0, "der Versatz gilt dem Buendel");
	assert.strictEqual(gebuendelt.closures[0].segmentCount, 2, "und die Zahl seiner Segmente");
	// Die Absage nennt die ETAPPE aus leg_index, nicht das Buendel
	antworten = [{ found: false, segments: [], duration: {}, closures: [bericht("", { leg_index: 1, blocked: true, actual: null })] }];
	const buendelAbsage = await buildRouteResultFromSelectedLocationsServer(false);
	assert.deepStrictEqual([buendelAbsage.refusal.start, buendelAbsage.refusal.end], ["Mühlingen", "Greifenfurt"]);
	// Eine Absage ohne Sperrbericht nennt Anfang und Ende des Buendels
	alerts.length = 0;
	antworten = [{ found: false, segments: [], duration: {}, closures: [] }];
	assert.strictEqual(await buildRouteResultFromSelectedLocationsServer(false), null);
	assert.ok(alerts[0].includes("Yrramis") && alerts[0].includes("Greifenfurt"), alerts[0]);

```

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `node js/routing/__tests__/route-buendel.test.js`, `node js/routing/__tests__/sperrzeiten-anfrage.test.js`
Expected: FAIL, `Cannot find module '…/route-buendel.js'` bzw. `ENOENT … route-buendel.js`.

- [ ] **Step 3: Umsetzen, Modul**

`js/routing/route-buendel.js`:

```js
// Wegpunkte zu Anfragen mit `via` buendeln (Entwurf 2026-09-14 §5.3).
// 💣 LAST AUF STRATO: je Wegpunktpaar eine Anfrage hiesse bei „Weg als Route" auf der Reichsstrasse 2 neununddreissig
// schwere Anfragen am Stueck. Der Server faehrt `via` Etappe fuer Etappe auf EINEM Graphen
// (avesmapsFindClientCompatibleRouteLegs, api/_internal/routing/client-graph.php).
// ⚠️ ZWILLING: AVESMAPS_ROUTE_MAX_VIA in api/_internal/routing/request.php -- mehr Zwischenhalte lehnt der Server ab.
// route-buendel.test.js haelt beide Werte gegeneinander.
const AVESMAPS_ROUTE_MAX_VIA = 10;

/**
 * REIN: die Buendel als Indexbereiche {von, bis}, beide einschliesslich; das Ende eines Buendels ist der Anfang des
 * naechsten. 🔴 Ein Kartenpunkt („Hierher reisen") steht nie in `via` -- der Server nimmt ihn nur als from_point/to_point.
 */
function avesmapsRouteBuendel(stationen, maxVia) {
	const liste = Array.isArray(stationen) ? stationen : [];
	const roh = Number(maxVia);
	const deckel = Math.max(0, Math.floor(Number.isFinite(roh) ? roh : AVESMAPS_ROUTE_MAX_VIA));
	const buendel = [];
	let von = 0;
	while (von < liste.length - 1) {
		let bis = von + 1;
		while (bis < liste.length - 1 && bis - von < deckel + 1 && !(liste[bis] && liste[bis].isMapPoint)) {
			bis += 1;
		}
		buendel.push({ von, bis });
		von = bis;
	}
	return buendel;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { AVESMAPS_ROUTE_MAX_VIA, avesmapsRouteBuendel };
}
```

In `index.html` direkt vor `<script src="js/routing/route-engine.js"></script>` einfügen `<script src="js/routing/route-buendel.js"></script>`.

- [ ] **Step 4: Umsetzen, Schleife**

In `js/routing/route-engine.js`, `buildRouteResultFromSelectedLocationsServer`, den Kopf der Schleife bis einschließlich des Absagezweigs ersetzen. Alt (Zeilen 473–498):

```js
	for (let index = 0; index < selectedLocations.length - 1; index += 1) {
		const start = selectedLocations[index].name;
		const end = selectedLocations[index + 1].name;
		const clientRoute = shouldProbeServerRouting() ? calculateRouteClientLegacy(start, end, useShortest) : [];
		const pairDeparture = departure ? { monthKey: departure.monthKey, day: departure.day, elapsedHours } : null;
		const serverRouteRequest = buildServerRouteProbeRequest(start, end, useShortest, clientRoute, pairDeparture);
		// „Hierher reisen": ist einer der beiden Enden ein angeklickter Kartenpunkt, reist seine
		// KOORDINATE mit. `from`/`to` bleiben die Beschriftung -- der Server kennt keinen Ort dieses
		// Namens und wuerde sonst `location_not_found` antworten.
		if (typeof applyMapPointRouteEndpoints === "function") {
			applyMapPointRouteEndpoints(serverRouteRequest, selectedLocations[index], selectedLocations[index + 1]);
		}
		const serverRouteResult = await calculateRouteServer(serverRouteRequest);
		logServerRouteProbeResult(start, end, clientRoute, serverRouteRequest, serverRouteResult);
		const pairClosures = Array.isArray(serverRouteResult?.route?.closures) ? serverRouteResult.route.closures : [];

		if (!serverRouteResult.found) {
			// 🔴 NUR WEGEN EINER SPERRE KEINE ROUTE: die Absage steht mit Grund im Panel, nicht im Popup
			// (Owner 14.09.2026). Jede andere Absage bleibt, wie sie ist.
			const blocked = pairClosures.find((report) => report && report.blocked === true);
			if (blocked) {
				return { refusal: { start, end, report: blocked } };
			}
			showRouteNotice(tr("routing.alert.noRouteFound", "Keine Route zwischen {start} und {end} gefunden.", { start, end }));
			return null;
		}
```

Neu:

```js
	// Entwurf 2026-09-14 §5.3: aufeinanderfolgende Wegpunkte reisen GEBUENDELT als `via` -- eine Anfrage je Buendel
	// statt je Paar. 💣 Ohne das waere „Weg als Route" auf der Reichsstrasse 2 eine Serie von 39 schweren Anfragen.
	// ⚠️ Fehlt route-buendel.js (mehrere Tests laden nur diese Datei), faellt es auf Paare zurueck: die alte, richtige,
	// nur teurere Form. index.html laedt es davor (route-buendel.test.js).
	const buendel = typeof avesmapsRouteBuendel === "function"
		? avesmapsRouteBuendel(selectedLocations, AVESMAPS_ROUTE_MAX_VIA)
		: selectedLocations.slice(1).map((_, index) => ({ von: index, bis: index + 1 }));

	for (const { von, bis } of buendel) {
		const start = selectedLocations[von].name;
		const end = selectedLocations[bis].name;
		const via = selectedLocations.slice(von + 1, bis).map((location) => location.name);
		// Die Client-Probe vergleicht EIN Paar -- mit Zwischenhalten gibt es nichts Vergleichbares.
		const clientRoute = shouldProbeServerRouting() && via.length === 0 ? calculateRouteClientLegacy(start, end, useShortest) : [];
		const pairDeparture = departure ? { monthKey: departure.monthKey, day: departure.day, elapsedHours } : null;
		const serverRouteRequest = buildServerRouteProbeRequest(start, end, useShortest, clientRoute, pairDeparture);
		serverRouteRequest.via = via;
		// „Hierher reisen": ist einer der beiden Enden ein angeklickter Kartenpunkt, reist seine
		// KOORDINATE mit. `from`/`to` bleiben die Beschriftung -- der Server kennt keinen Ort dieses
		// Namens und wuerde sonst `location_not_found` antworten. Im Inneren eines Buendels steht nie einer.
		if (typeof applyMapPointRouteEndpoints === "function") {
			applyMapPointRouteEndpoints(serverRouteRequest, selectedLocations[von], selectedLocations[bis]);
		}
		const serverRouteResult = await calculateRouteServer(serverRouteRequest);
		logServerRouteProbeResult(start, end, clientRoute, serverRouteRequest, serverRouteResult);
		const pairClosures = Array.isArray(serverRouteResult?.route?.closures) ? serverRouteResult.route.closures : [];

		if (!serverRouteResult.found) {
			// 🔴 NUR WEGEN EINER SPERRE KEINE ROUTE: die Absage steht mit Grund im Panel, nicht im Popup
			// (Owner 14.09.2026). Jede andere Absage bleibt, wie sie ist.
			const blocked = pairClosures.find((report) => report && report.blocked === true);
			if (blocked) {
				// `leg_index` zaehlt die Etappe INNERHALB dieser Anfrage (closures.php) -- die Absage nennt die Etappe.
				const etappe = Math.min(Math.max(0, Number(blocked.leg_index) || 0), bis - von - 1);
				return { refusal: { start: selectedLocations[von + etappe].name, end: selectedLocations[von + etappe + 1].name, report: blocked } };
			}
			// ⚠️ Ohne Sperrbericht nennt der Server die gescheiterte Etappe nicht: die Meldung nennt das Buendel.
			showRouteNotice(tr("routing.alert.noRouteFound", "Keine Route zwischen {start} und {end} gefunden.", { start, end }));
			return null;
		}
```

Der Rest der Schleife (Anzeige, `segmentOffset`, `seasonal_ways`, `elapsedHours`) bleibt unverändert. Er gilt jetzt je Bündel: der Versatz der Sperrberichte ist der Anfang des Bündels, und `route-closures.js` sucht die Abzweigkante im Ausschnitt des Bündels.

- [ ] **Step 5: Tests laufen lassen**

Run:
- `node js/routing/__tests__/route-buendel.test.js`
- `node js/routing/__tests__/sperrzeiten-anfrage.test.js`
- `node js/routing/__tests__/alte-route-bleibt-stehen.test.js`
- `node js/routing/__tests__/routenmeldung-toast.test.js`
- `node js/routing/__tests__/reiseplan-kasten-erst-mit-route.test.js`
- `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/routing/__tests__/via-etappen-test.php`

Expected: grün. Die drei fremden Routing-Tests laden `route-buendel.js` nicht und fahren den Paar-Rückfall mit zwei Wegpunkten.

- [ ] **Step 6: Messen, vorher**

Vor dem Push auf https://avesmaps.de **als Besucher** (ohne `edit=1`) im Routenplaner die Wegpunkte `Gareth`, `Hartsteen`, `Rommilys`, `Perricum` eintragen (gibt es einen der Orte nicht, einen Nachbarort derselben Straße nehmen und notieren). Die Etappenliste, die Gesamtzeit und die Zahl der `POST /api/route/` im Netzwerk-Protokoll festhalten (Bildschirmfoto). Erwartet heute: **3** Anfragen.

- [ ] **Step 7: Commit, Push, Messen nachher**

```bash
printf '%s\n' "perf(routing): mehrere Wegpunkte gehen gebuendelt als via -- eine Serveranfrage fuer bis zu 12 Orte statt einer je Paar" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §5.3. Ein Kartenpunkt bleibt Buendelgrenze; die Sperr-Absage nennt die Etappe aus leg_index." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/routing/route-buendel.js js/routing/__tests__/route-buendel.test.js js/routing/route-engine.js js/routing/__tests__/sperrzeiten-anfrage.test.js index.html && git commit -F "$SCRATCH/msg.txt"
```

Nach dem Deploy dieselbe Route wie in Step 6, wieder als Besucher: **eine** Anfrage `POST /api/route/`, dieselbe Etappenliste, dieselbe Gesamtzeit, die Konsole ohne Fehler. **Weicht etwas ab: nicht weiterbauen**, Vorher- und Nachher-Bild dem Owner zeigen.

**🚚 Lieferung 6:** Task 15 allein (für Besucher unsichtbar, mit der Messung aus Step 6 und 7).

---

## Task 16: Die Kachel „Weg als Route"

**Files:**
- Create: `js/routing/weg-als-route.js`
- Create: `js/routing/__tests__/weg-als-route.test.js`
- Modify: `js/map-features/map-features-path-rendering.js` (`pathShowActionButtonMarkup` Zeilen 142–166; `createPathPopupMarkup` nach dem Block `buildSuggestChangeButtonSpec`)
- Modify: `js/routing/routing.js` (neuer Zweig nach `if (action === "show-whole-path")`, Zeile 1029–1039)
- Modify: `js/app/i18n-en.js` (nach Zeile 611 und Zeile 645)
- Modify: `index.html` (Skript-Tag direkt nach `js/map-features/map-features-weg-auswahl.js`)

**Interfaces:**
- Consumes: Task 8 (`avesmapsWegAbschnittAufKarte`, `avesmapsWegAlsWay`, `AVESMAPS_WEG_ENDE_KREUZUNG`, `AVESMAPS_WEG_ENDE_OFFEN`), Task 11 (`avesmapsWegTraegerIndex`), Task 13 (`avesmapsWegAuswahlFuerPfad`); `wpChainSegments` (Ketten, längste zuerst, Glied `{index, gedreht}`); `locationData` (`isHidden`); `isCrossingLocation`; `resetWaypointInputs(namen)` (`map-features-waypoints.js:342`); `updateMapView`; `showFeedbackToast`.
- Produces:
  - `avesmapsWegAlsRouteOrte(ways, istAuslassen) -> string[]` (rein; `ways` in Editorzeilen-Form mit `ends` und `enden`)
  - `avesmapsWegAlsRouteAuslassen(name) -> boolean`
  - `avesmapsWegAlsRouteFuerPfad(path) -> string[]`
  - `pathWegAktionErlaubt(path) -> boolean`, `pathAlsRouteKachelMarkup(path) -> string`
  - Popup-Aktion `data-popup-action="path-as-route"`

- [ ] **Step 1: Test schreiben**

`js/routing/__tests__/weg-als-route.test.js`:

```js
"use strict";
// „Weg als Route" (Entwurf 2026-09-14 §5): welche Orte in welcher Reihenfolge -- AUSGEFUEHRT, rein und gegen eine
// kleine Karte; dazu die Kachel und der Klickzweig.
// Aus der Wurzel: node js/routing/__tests__/weg-als-route.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const schneide = (text, anfang, ende) => {
	const a = text.indexOf(anfang);
	const e = a >= 0 ? text.indexOf(ende, a + anfang.length) : -1;
	assert.ok(a >= 0 && e > a, "Ausschnitt fehlt: " + anfang);
	return text.slice(a, e);
};

const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke,
	escapeHtml: (w) => String(w),
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: (ort) => ort.kreuzung === true,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: false,
});
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-weitere-anzeige.js")));
const R = require(path.join(WURZEL, "js/routing/weg-als-route.js"));

// 1. Rein
const w = (von, bis, a, b) => ({ ends: { from: von, to: bis }, enden: { von: a, bis: b } });
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Silkwiesen"), w([2, 0], [1, 0], "Wieha", "Silkwiesen"), w([2, 0], [3, 0], "Wieha", "Helmdahl"),
]), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"], "ein gedrehter Abschnitt laeuft rueckwaerts mit");
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Silkwiesen"), w([1, 0], [2, 0], "Silkwiesen", "Wieha"), w([10, 0], [3, 0], "Ferne", "Helmdahl"),
]), ["Perz", "Silkwiesen", "Wieha", "Helmdahl", "Ferne"], "ueber die Luecke zum naechsten Ende, das Stueck dafuer umgedreht");
const auslassen = (name) => name === "Kreuzung" || name === "Wegende" || name === "Versteck";
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Kreuzung"), w([1, 0], [2, 0], "Kreuzung", "Versteck"),
	w([2, 0], [3, 0], "Versteck", "Perz"), w([3, 0], [4, 0], "Perz", "Wegende"),
], auslassen), ["Perz"], "Kreuzung, Wegende, Verborgenes fallen weg, und Dopplungen hintereinander auch");
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([]), []);
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([{ public_id: "ohne" }]), [], "ohne Enden nichts");

// 2. Gegen eine kleine Karte: der Baerenpfad laeuft ueber den Reichsstrassen-Abschnitt, der ihn als weitere Zuweisung traegt
global.locationData = [
	{ name: "Perz", coordinates: [0, 0] }, { name: "Silkwiesen", coordinates: [0, 1] }, { name: "Wieha", coordinates: [0, 2] },
	{ name: "Helmdahl", coordinates: [0, 3] }, { name: "Rudein", coordinates: [5, 0] }, { name: "Espen", coordinates: [5, 3] },
];
const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
const RS = { key: "reichsstrasse-2", name: "Reichsstraße 2", seite: "Reichsstrasse_2" };
const BP = { key: "b-renpfad", name: "Bärenpfad", seite: "Baerenpfad" };
const weg = (id, von, bis, haupt, weitere = []) => ({
	properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "M-" + id, display_name: haupt.name,
		wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: url(haupt.seite) }, wiki_path_weitere: weitere },
	geometry: { coordinates: [von, bis] },
});
global.pathData = [
	weg("rs-6", [0, 0], [1, 0], RS),
	weg("rs-7", [1, 0], [2, 0], RS, [{ wiki_key: BP.key, name: BP.name, wiki_url: url(BP.seite) }]),
	weg("rs-8", [2, 0], [3, 0], RS),
	weg("bp-1", [0, 5], [1, 0], BP),
	weg("bp-2", [2, 0], [3, 5], BP),
	weg("x-1", [8, 8], [9, 9], { key: "x", name: "X", seite: "X" }),
];
const [rs6, rs7, rs8, bp1] = global.pathData;
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"]);
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(bp1), ["Rudein", "Silkwiesen", "Wieha", "Espen"], "der Baerenpfad-Fall (§6 D)");

// 3. Editoren: das Markierte -- am Abschnitt nur er
global.IS_EDIT_MODE = true;
global.avesmapsWegAuswahlFuerPfad = (p) => (p === rs7 ? { gruppe: "wiki:reichsstrasse-2", publicId: "rs-7" } : null);
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs7), ["Silkwiesen", "Wieha"]);
global.avesmapsWegAuswahlFuerPfad = () => ({ gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs8), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"], "ganze Strasse markiert: die ganze Strasse");
global.IS_EDIT_MODE = false;

// 4. Verborgene Orte und Kreuzungen werden uebersprungen
global.locationData.find((o) => o.name === "Wieha").isHidden = true;
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Silkwiesen", "Helmdahl"], "ein verborgener Ort heisst wie der Ort -- und wird uebersprungen");
global.locationData.find((o) => o.name === "Silkwiesen").kreuzung = true;
global.mapDataSourceStatus = { revision: 2 };   // neuer Kartenstand: der Ortsindex rechnet neu
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Helmdahl"], "eine Kreuzung heisst „Kreuzung" und faellt weg");

// 5. Die Kachel: dieselbe Bedingung wie „Anzeigen"
const rendering = lies("js/map-features/map-features-path-rendering.js");
const kachelKontext = vm.createContext({
	popupActionButtonMarkup: (spec) => JSON.stringify(spec),
	pathSupportsItemLinks: (p) => p.properties.feature_subtype !== "Seeweg",
	getPathPublicId: (p) => p.properties.public_id,
	tr: (key, fallback) => fallback,
});
vm.runInContext(schneide(rendering, "function pathWegAktionErlaubt(path) {", "\n// Kopf-Icon fuer den Weg-Kopf"), kachelKontext);
const kachelBauen = vm.runInContext("pathAlsRouteKachelMarkup", kachelKontext);
const kachel = JSON.parse(kachelBauen(rs6));
assert.strictEqual(kachel.label, "Weg als Route");
assert.ok(kachel.iconMarkup.includes('src="img/menu/waypoint-end.webp"'), kachel.iconMarkup);
assert.deepStrictEqual(kachel.attributes, { "data-popup-action": "path-as-route", "data-public-id": "rs-6" });
assert.strictEqual(kachelBauen({ properties: { public_id: "s", feature_subtype: "Seeweg", wiki_path: { wiki_url: url("Meer") } } }), "", "kein Seeweg");
assert.strictEqual(kachelBauen({ properties: { public_id: "o", feature_subtype: "Weg" } }), "", "ohne Wiki-Artikel keine Kachel (§8)");
const popup = schneide(rendering, "function createPathPopupMarkup(path) {", "\n// Zeichen-Reihenfolge der Wege");
assert.ok(popup.indexOf("pathAlsRouteKachelMarkup(path)") > popup.indexOf("buildSuggestChangeButtonSpec"), "die Kachel steht nach „Änderungen vorschlagen" (§5.1)");

// 6. Der Klickzweig: die Orte ERSETZEN die Wegpunkte (§5.2), ausgefuehrt
const routing = lies("js/routing/routing.js");
const zweig = schneide(routing, 'if (action === "path-as-route") {', "\n\t}\n");
const lauf = [];
const zweigKontext = vm.createContext({
	findPathByPublicId: (id) => global.pathData.find((p) => p.properties.public_id === id) || null,
	avesmapsWegAlsRouteFuerPfad: R.avesmapsWegAlsRouteFuerPfad,
	resetWaypointInputs: (namen) => { lauf.push(["ersetzen", [...namen]]); },
	updateMapView: () => { lauf.push(["rechnen"]); },
	showFeedbackToast: (text) => { lauf.push(["meldung", text]); },
	tr: (key, fallback) => fallback,
});
const klicke = vm.runInContext("(function (action) {\n\t" + zweig + "\n\t}\n})", zweigKontext);
klicke.call({ dataset: { publicId: "rs-6" } }, "path-as-route");
assert.deepStrictEqual(lauf, [["ersetzen", ["Perz", "Helmdahl"]], ["rechnen"]]);
lauf.length = 0;
klicke.call({ dataset: { publicId: "x-1" } }, "path-as-route");
assert.deepStrictEqual(lauf, [["meldung", "Dieser Weg verbindet keine zwei Orte."]], "unter zwei Orten wird nichts ersetzt");

// 7. Englisch und Ladereihenfolge
const en = lies("js/app/i18n-en.js");
assert.ok(en.includes('"popup.pathAsRoute": "Way as route",'), "i18n popup.pathAsRoute");
assert.ok(en.includes('"toast.path.asRouteTooShort": "This way does not connect two places.",'), "i18n toast.path.asRouteTooShort");
const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
const tag = seite.indexOf('<script src="js/routing/weg-als-route.js"></script>');
assert.ok(tag > 0 && tag > seite.indexOf('<script src="js/map-features/map-features-weg-auswahl.js"></script>'), "index.html laedt weg-als-route.js nach dem Kartenteil der Auswahl");

console.log("weg-als-route.test.js: ok");
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `node js/routing/__tests__/weg-als-route.test.js`
Expected: FAIL `Cannot find module '…/weg-als-route.js'`

- [ ] **Step 3: Umsetzen, Modul**

`js/routing/weg-als-route.js`:

```js
// „Weg als Route" (Entwurf 2026-09-14 §5): die Orte eines Wegs der Reihe nach -- sie ERSETZEN die Wegpunkte des
// Routenplaners. Besucher bekommen immer die ganze Strasse, Editoren das Markierte.
// ⚠️ Normales Skript, NICHT in <template data-nur-editor> (nur-editor-skripte.test.js, Teil C).

/**
 * REIN: die Ortsnamen in Reihenfolge.
 * Reihenfolge = die Ketten aus wpChainSegments; mehrere Stuecke (Luecken) haengen vom Ende der laengsten Kette aus am
 * jeweils NAECHSTEN Ende an, das Stueck dafuer notfalls umgedreht (§5.2). Danach fallen `istAuslassen`-Namen weg und
 * aufeinanderfolgende Dopplungen.
 * @param {Array} ways  Editorzeilen mit `ends: {from, to}` und `enden: {von, bis}`
 */
function avesmapsWegAlsRouteOrte(ways, istAuslassen) {
	const liste = (Array.isArray(ways) ? ways : []).filter((way) => way && way.ends && way.enden);
	const ketten = wpChainSegments(liste);
	if (!ketten.length) { return []; }
	const stationenVon = (kette) => {
		const stationen = [];
		kette.forEach((glied, i) => {
			const way = liste[glied.index];
			const anfang = glied.gedreht ? { name: way.enden.bis, punkt: way.ends.to } : { name: way.enden.von, punkt: way.ends.from };
			const ende = glied.gedreht ? { name: way.enden.von, punkt: way.ends.from } : { name: way.enden.bis, punkt: way.ends.to };
			if (i === 0) { stationen.push(anfang); }
			stationen.push(ende);
		});
		return stationen;
	};
	const abstand = (a, b) => Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));

	let folge = stationenVon(ketten[0]);
	const rest = ketten.slice(1).map(stationenVon);
	while (rest.length) {
		const hier = folge[folge.length - 1].punkt;
		let bester = 0;
		let umdrehen = false;
		let kuerzester = Infinity;
		rest.forEach((stationen, i) => {
			const vorn = abstand(hier, stationen[0].punkt);
			const hinten = abstand(hier, stationen[stationen.length - 1].punkt);
			if (vorn < kuerzester) { kuerzester = vorn; bester = i; umdrehen = false; }
			if (hinten < kuerzester) { kuerzester = hinten; bester = i; umdrehen = true; }
		});
		const naechste = rest.splice(bester, 1)[0];
		folge = folge.concat(umdrehen ? naechste.slice().reverse() : naechste);
	}

	const orte = [];
	folge.forEach((station) => {
		const name = String(station.name || "");
		if (!name || (typeof istAuslassen === "function" && istAuslassen(name))) { return; }
		if (orte[orte.length - 1] !== name) { orte.push(name); }
	});
	return orte;
}

/** Kreuzungen, offene Wegenden und verborgene Orte fahren nicht mit (§5.2). */
function avesmapsWegAlsRouteAuslassen(name) {
	if (name === AVESMAPS_WEG_ENDE_KREUZUNG || name === AVESMAPS_WEG_ENDE_OFFEN) { return true; }
	const orte = typeof locationData !== "undefined" && Array.isArray(locationData) ? locationData : [];
	const ort = orte.find((kandidat) => kandidat && kandidat.name === name);
	// 🔴 Am gespeicherten Merkmal, nicht an der Aufdeckung dieses Besuchs (isHiddenLocation kennt beides): eine Route
	// aus derselben Strasse soll fuer jeden dieselben Orte haben.
	return Boolean(ort && (ort.isHidden === true || (typeof isCrossingLocation === "function" && isCrossingLocation(ort))));
}

function avesmapsWegAlsRouteFuerPfad(path) {
	const abschnitt = typeof avesmapsWegAbschnittAufKarte === "function" ? avesmapsWegAbschnittAufKarte(path) : null;
	if (!abschnitt) { return []; }
	const auswahl = typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE && typeof avesmapsWegAuswahlFuerPfad === "function"
		? avesmapsWegAuswahlFuerPfad(path)
		: null;
	// Editoren mit markiertem Abschnitt: nur er.
	if (auswahl && auswahl.publicId !== null && auswahl.publicId !== undefined) {
		const way = abschnitt.gruppe.segments.find((kandidat) => kandidat.public_id === auswahl.publicId) || abschnitt.way;
		return avesmapsWegAlsRouteOrte([way], avesmapsWegAlsRouteAuslassen);
	}
	// Sonst die ganze Strasse -- plus jeder fremde Abschnitt, der den Artikel als WEITERE Zuweisung traegt (§5.2).
	const ways = abschnitt.gruppe.segments.slice();
	const key = String((path && path.properties && path.properties.wiki_path && path.properties.wiki_path.wiki_key) || "");
	if (key && typeof avesmapsWegTraegerIndex === "function") {
		const ids = new Set(ways.map((way) => way.public_id));
		(avesmapsWegTraegerIndex().get(key) || []).forEach((traeger) => {
			const way = avesmapsWegAlsWay(traeger);
			if (!ids.has(way.public_id)) {
				ids.add(way.public_id);
				ways.push(way);
			}
		});
	}
	return avesmapsWegAlsRouteOrte(ways, avesmapsWegAlsRouteAuslassen);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsWegAlsRouteOrte, avesmapsWegAlsRouteAuslassen, avesmapsWegAlsRouteFuerPfad };
}
```

In `index.html` direkt nach `<script src="js/map-features/map-features-weg-auswahl.js"></script>` einfügen `<script src="js/routing/weg-als-route.js"></script>`.

- [ ] **Step 4: Umsetzen, Kachel und Klickzweig**

1. `js/map-features/map-features-path-rendering.js`: direkt **vor** der Kommentarzeile `// "Anzeigen" (Owner 2026-07-17): highlights the WHOLE way and zooms to its full extent -- the same thing the` einfügen:

```js
// Wann ein Weg die Kacheln „Anzeigen" und „Weg als Route" traegt: verlinkter Wiki-Artikel, kein Seeweg.
// 🔴 EINE Bedingung fuer beide (Entwurf 2026-09-14 §5.1) -- zwei Abschriften liefen beim ersten Sonderfall auseinander.
function pathWegAktionErlaubt(path) {
	const wiki = (path.properties && path.properties.wiki_path) || {};
	const supported = typeof pathSupportsItemLinks === "function" && pathSupportsItemLinks(path);
	return Boolean(wiki.wiki_url) && supported;
}

```

2. In `pathShowActionButtonMarkup` die ersten Zeilen des Rumpfs

```js
	const wiki = (path.properties && path.properties.wiki_path) || {};
	const supported = typeof pathSupportsItemLinks === "function" && pathSupportsItemLinks(path);
	if (!wiki.wiki_url || !supported) {
		return "";
	}
```

ersetzen durch:

```js
	if (!pathWegAktionErlaubt(path)) {
		return "";
	}
```

3. Direkt nach der schließenden `}` von `pathShowActionButtonMarkup` (vor `// Kopf-Icon fuer den Weg-Kopf`) einfügen:

```js

// „Weg als Route" (Entwurf 2026-09-14 §5.1): setzt die Orte des Wegs der Reihe nach in den Routenplaner. Die
// Ziel-Nadel des Routenplaners als Symbol; sichtbar, wo „Anzeigen" sichtbar ist.
function pathAlsRouteKachelMarkup(path) {
	if (!pathWegAktionErlaubt(path)) {
		return "";
	}
	return popupActionButtonMarkup({
		label: (typeof tr === "function" ? tr("popup.pathAsRoute", "Weg als Route") : "Weg als Route"),
		iconMarkup: '<img class="location-popup__action-img" src="img/menu/waypoint-end.webp" alt="" width="20" height="20" />',
		attributes: {
			"data-popup-action": "path-as-route",
			"data-public-id": getPathPublicId(path),
		},
	});
}
```

4. In `createPathPopupMarkup` direkt nach dem Block

```js
			if (suggestSpec) {
				buttons.push(popupActionButtonMarkup(suggestSpec));
			}
```

einfügen:

```js
			// „Weg als Route" nach „Änderungen vorschlagen" (Entwurf 2026-09-14 §5.1).
			const alsRoute = typeof pathAlsRouteKachelMarkup === "function" ? pathAlsRouteKachelMarkup(path) : "";
			if (alsRoute) { buttons.push(alsRoute); }
```

⚠️ Die `typeof`-Wache ist nötig, obwohl die Funktion in derselben Datei steht: `weg-auswahl-karte.test.js` (Task 13) schneidet `createPathPopupMarkup` allein aus.

5. `js/routing/routing.js`: direkt nach dem Zweig `if (action === "show-whole-path") { … return; }` (endet mit `\t}` in Zeile 1039) einfügen:

```js

	// „Weg als Route" (Entwurf 2026-09-14 §5): die Orte des Wegs ERSETZEN die Wegpunkte, dann wird gerechnet.
	// Mehrere Wegpunkte gehen gebuendelt als `via` (route-buendel.js) -- ohne das waere das eine Anfrage je Etappe.
	if (action === "path-as-route") {
		const path = typeof findPathByPublicId === "function" ? findPathByPublicId(this.dataset.publicId) : null;
		const orte = path && typeof avesmapsWegAlsRouteFuerPfad === "function" ? avesmapsWegAlsRouteFuerPfad(path) : [];
		if (orte.length < 2) {
			showFeedbackToast(tr("toast.path.asRouteTooShort", "Dieser Weg verbindet keine zwei Orte."), "warning");
			return;
		}
		resetWaypointInputs(orte);
		updateMapView();
		return;
	}
```

6. `js/app/i18n-en.js`: nach `	"popup.showWholePath": "Show",` die Zeile `	"popup.pathAsRoute": "Way as route",` einfügen; nach `	"toast.path.notFound": "The way could not be found.",` die Zeile `	"toast.path.asRouteTooShort": "This way does not connect two places.",` einfügen.

- [ ] **Step 5: Tests laufen lassen**

Run:
- `node js/routing/__tests__/weg-als-route.test.js`
- `node js/map-features/__tests__/weg-auswahl-karte.test.js`
- `for t in $(grep -rl "pathShowActionButtonMarkup\|show-whole-path" js/*/__tests__); do node "$t" || echo "ROT: $t"; done`
- `node js/app/__tests__/nur-editor-skripte.test.js`

Expected: grün, keine Zeile `ROT:`.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' "feat(infobox): neue Kachel \"Weg als Route\" -- setzt die Orte eines Wegs der Reihe nach in den Routenplaner" "" "Entwurf docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md §5. Besucher: die ganze Strasse samt Abschnitten mit dem Artikel als weiterer Zuweisung; Editoren: das Markierte. Kreuzungen und verborgene Orte fahren nicht mit." "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add js/routing/weg-als-route.js js/routing/__tests__/weg-als-route.test.js js/map-features/map-features-path-rendering.js js/routing/routing.js js/app/i18n-en.js index.html && git commit -F "$SCRATCH/msg.txt"
```

- [ ] **Step 7: Abnahme als Besucher (Handgriffe)**

Nach dem Deploy auf https://avesmaps.de ohne `edit=1`:
1. „Reichsstraße 2" suchen und die Infobox öffnen. Die Kachel „Weg als Route" steht nach „Änderungen vorschlagen" und trägt die Ziel-Nadel.
2. Anklicken. Die Wegpunkte des Routenplaners sind durch die Orte der Straße ersetzt (keine „Kreuzung", keine Dopplung), die Route wird gerechnet.
3. Im Netzwerk-Protokoll so viele `POST /api/route/` wie Bündel: bei n Orten ⌈(n−1)/11⌉.
4. Den „Bärenpfad" öffnen, falls er eine weitere Zuweisung auf der Reichsstraße trägt: die Route läuft über deren Orte.
5. Konsole ohne Fehler. Ein Seeweg zeigt die Kachel nicht.

**🚚 Lieferung 7:** Task 16 allein (sichtbar für Besucher). Owner schaut.

---

## Task 17: AGENTS.md und Gedächtnis

**Files:**
- Modify: `AGENTS.md` §11 (neuer Eintrag direkt nach dem Eintrag „**Die WEG-EBENE des Wege-Editors**")
- Create (außerhalb des Repos): `C:\Users\mail\.claude\projects\C--GIT-avesmaps\memory\wege-mehrfachzuweisung-stand.md`
- Modify (außerhalb des Repos): `…\memory\MEMORY.md`

- [ ] **Step 1: AGENTS.md-Eintrag**

In `AGENTS.md` §11 direkt nach dem Absatz, der mit `- **Die WEG-EBENE des Wege-Editors**` beginnt, einen Absatz einfügen (`<DATUM>` = Tag der Lieferung 7; die Testnamen so, wie sie am Ende im Baum stehen):

```markdown
- **Weitere Wiki-Zuweisungen an Wegen · Klick auf Straße oder Abschnitt · „Weg als Route"** — ein Abschnitt trägt neben seiner Hauptzuweisung (`properties.wiki_path`) weitere Artikel in `properties.wiki_path_weitere`; im Bearbeiten-Modus markiert der erste Klick die ganze Straße, der zweite den Abschnitt; die Kachel „Weg als Route" setzt die Orte eines Wegs in den Routenplaner. Entwurf **`docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md`**, Bauplan `docs/superpowers/plans/2026-09-14-wege-mehrfachzuweisung.md`, Mockup `docs/wege-mehrfachzuweisung-mockup.html`, live <DATUM>. 🔴 **Die Hauptzuweisung bleibt Identität** — Name (R1), Gruppe, Kanon, Verlauf-Abgleich; eine weitere Zuweisung ändert nie den Wegnamen (Owner 14.09.2026: „die editoren bestimmen über 'Wegname' weiterhin"). 💣 **Eine zweite Liste, kein Umbau von `wiki_path` zur Liste** — rund 45 Leser lesen `wiki_path` als Objekt, eine Liste hätte jeden still gebrochen; welche Leser die Liste kennen müssen, steht im Entwurf §2.4. 💣 **Jeder Zuweiser erhält die Liste**, und wer eine Hauptzuweisung setzt, nimmt denselben Artikel aus ihr heraus (`avesmapsWikiPathWeitereOhneHaupt`). 💣 **Der Verlauf-Abgleich meldet einen Abschnitt mit dem Artikel als weiterer Zuweisung weder als fremd noch als „behalten"** — `RestampKeeps` schriebe ihm sonst die Hauptzuweisung über. 🔴 **„Ganze Straße" ist die Gruppe des Wege-Editors** (`wpGroupKeyOf`), auch über Lücken. 💣 **Im Browser trägt `properties.name` den Maschinennamen** `<Wegart>-<n>` — Gruppenschlüssel und Abschnittsname lesen `display_name || original_name`. 🔴 **Ein Abschnitt heißt „Abschnitt N: Ort – Ort"**: ein Ende ist der Ort unter 0,01 (`LOCATION_ENDPOINT_EXACT_HIT`), sonst „Kreuzung" ohne Nummer, sonst „Wegende"; ein verborgener Ort heißt wie der Ort. Die Nummer kommt aus EINER Sortierung (`wpGroupWays`: Hüllbox auf zwei Stellen gerundet, dann `public_id`) — ohne Rundung sortierten 4 von 477 Straßen auf Karte und im Wege-Editor verschieden. Die Enden benennt ein JS/PHP-Zwilling mit gemeinsamer Fixture (`tools/paths/fixtures/weg-abschnitt-enden.json`). 💣 **Die Markierung zieht am Ende von `updatePathLayerStyle` nach**, sonst löscht jedes Neufärben sie; und sie nimmt den Strich fremder Träger selbst zurück, weil `updatePathLayerStyle` `dashArray` nie setzt. 🔴 **Ein Rumpf-Bauer für das Sammel-Speichern** (`wpGroupRumpf`), gerufen vom Wege-Editor und vom Kartendialog. 💣 **Das Sammel-Speichern im Kartendialog hebt die lokale Revision NICHT** (die Antwort trägt keine Features) — sonst fände der Live-Abgleich danach nichts, und die Karte zeigte die alten Abschnitte. 🔴 **Mehrere Wegpunkte reisen gebündelt als `via`** (`js/routing/route-buendel.js`, höchstens `AVESMAPS_ROUTE_MAX_VIA` = 10 Zwischenhalte, JS/PHP-Zwilling per Test): „Weg als Route" auf der Reichsstraße 2 wären sonst 39 schwere Anfragen am Stück. Ein Kartenpunkt ist immer Bündelgrenze; ⚠️ scheitert eine Etappe ohne Sperrbericht, nennt die Meldung Anfang und Ende des Bündels. 🔧 **Offen:** der geteilte Link kappt bei 25 Wegpunkten (`MAX_SHARED_WAYPOINTS`); „Weg als Route" gibt es nur für Wege mit Wiki-Artikel. Tests: `api/_internal/wiki/__tests__/path-weitere{,-schreiben,-erhalten,-verlauf}-test.php`, `api/_internal/map/__tests__/weg-abschnitt-ende-test.php`, `api/app/__tests__/wege-suche-weitere-test.php`, `js/map-features/__tests__/{weg-gruppenschluessel-echter-name,weg-abschnitte,weg-weitere-anzeige,weg-auswahl,weg-auswahl-karte}.test.js`, `js/pages/__tests__/{wege-weitere-liste,wege-editor-abschnittsnamen}.test.js`, `js/ui/__tests__/{wiki-weitere-kasten,wege-suche-weitere}.test.js`, `js/app/__tests__/deeplink-weitere.test.js`, `js/review/__tests__/weg-dialog-gruppe.test.js`, `js/routing/__tests__/{route-buendel,weg-als-route}.test.js`.
```

- [ ] **Step 2: Den Eintrag gegen den Baum prüfen**

Run:

```bash
ls api/_internal/wiki/__tests__/path-weitere-test.php api/_internal/wiki/__tests__/path-weitere-schreiben-test.php \
  api/_internal/wiki/__tests__/path-weitere-erhalten-test.php api/_internal/wiki/__tests__/path-weitere-verlauf-test.php \
  api/_internal/map/__tests__/weg-abschnitt-ende-test.php api/app/__tests__/wege-suche-weitere-test.php \
  js/map-features/__tests__/weg-gruppenschluessel-echter-name.test.js js/map-features/__tests__/weg-abschnitte.test.js \
  js/map-features/__tests__/weg-weitere-anzeige.test.js js/map-features/__tests__/weg-auswahl.test.js \
  js/map-features/__tests__/weg-auswahl-karte.test.js js/pages/__tests__/wege-weitere-liste.test.js \
  js/pages/__tests__/wege-editor-abschnittsnamen.test.js js/ui/__tests__/wiki-weitere-kasten.test.js \
  js/ui/__tests__/wege-suche-weitere.test.js js/app/__tests__/deeplink-weitere.test.js \
  js/review/__tests__/weg-dialog-gruppe.test.js js/routing/__tests__/route-buendel.test.js js/routing/__tests__/weg-als-route.test.js
```

Expected: keine Zeile `No such file or directory`. Fehlt eine Datei, wird der Eintrag korrigiert, nicht der Test umbenannt.

- [ ] **Step 3: Commit**

```bash
printf '%s\n' "docs(agents): weitere Wiki-Zuweisungen an Wegen, Klick ganze Strasse/Abschnitt und \"Weg als Route\" in §11" "" "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" > "$SCRATCH/msg.txt"
git add AGENTS.md && git commit -F "$SCRATCH/msg.txt"
```

- [ ] **Step 4: Gedächtnis**

`C:\Users\mail\.claude\projects\C--GIT-avesmaps\memory\wege-mehrfachzuweisung-stand.md` anlegen (mit dem Write-Werkzeug):

```markdown
---
name: wege-mehrfachzuweisung-stand
description: Idee #116 — weitere Wiki-Zuweisungen an Wegabschnitten, Klick ganze Strasse/Abschnitt, "Weg als Route", via-Buendelung; Stand und Fallen
metadata:
  type: project
---

Idee #116 (Discord-Fall 116, HEX der Dunkle), vom Owner am 14.09.2026 umgedeutet: ein Wegabschnitt traegt weitere
Wiki-Artikel (`properties.wiki_path_weitere`), die Hauptzuweisung bleibt Identitaet und Name. Entwurf, Bauplan und
Mockup: `docs/superpowers/{specs,plans}/2026-09-14-wege-mehrfachzuweisung*`, `docs/wege-mehrfachzuweisung-mockup.html`.

Liefergrenzen 1–7 stehen im Bauplan; live seit <DATUM der Lieferung 7>.

**Why:** Pilgerwege und Karawanenrouten liegen auf fremden Strassen; Editoren kamen sich bei der Zuweisung „ins Gehege".

**How to apply:**
- Eine weitere Zuweisung aendert NIE den Wegnamen oder die Gruppe — wer das „vereinfacht", bricht R1.
- `properties.name` ist im Browser der Maschinenname; Gruppen und Abschnittsnamen lesen `display_name || original_name`.
- Die Markierung haengt am Ende von `updatePathLayerStyle`; wer dort umbaut, prueft `weg-auswahl-karte.test.js`.
- Mehrere Wegpunkte gehen als `via` (`route-buendel.js`); der Deckel ist ein JS/PHP-Zwilling.
- Offen: `MAX_SHARED_WAYPOINTS = 25`, „Weg als Route" nur mit Wiki-Artikel.

Verwandt: [[quellen-am-abschnitt-nie-am-gruppenschluessel]], [[sperrzeiten-routing-stand]].
```

In `MEMORY.md` unter `## Wege, Regionen, Routing` eine Zeile ergänzen:

```markdown
- 🔧 [Weitere Wiki-Zuweisungen an Wegen (#116)](wege-mehrfachzuweisung-stand.md) Hauptzuweisung bleibt Identität · Klick ganze Straße → Abschnitt · „Weg als Route" + via-Bündelung · 💣 `properties.name` = Maschinenname
```

---

## Vor „fertig": die Abnahmeliste (AGENTS.md §9)

- [ ] Jede Zeile mit 💣 / ⚠️ / 🔴 im Entwurf `docs/superpowers/specs/2026-09-14-wege-mehrfachzuweisung-design.md` **und** in diesem Plan einzeln abhaken: erfüllt, oder ausdrücklich verworfen mit Begründung.
- [ ] Vor jedem Commit einer sichtbaren Lieferung (1, 4, 5, 7) den Sub-Agenten `usability-konsistenz` mit Entwurf und Diff fahren.
- [ ] Vor jedem Push einer sichtbaren Lieferung den Sub-Agenten `usability-design` gegen `docs/wege-mehrfachzuweisung-mockup.html` fahren, in hell **und** dunkel.
- [ ] Nach jedem Push, der die Karte berührt: Live-Seite als Besucher laden (ohne `edit=1`) und die Konsole lesen.
- [ ] Offene Punkte aus Entwurf §8 dem Owner nennen, nicht still übergehen: `MAX_SHARED_WAYPOINTS = 25` kappt geteilte Routen langer Straßen; „Weg als Route" gibt es nur für Wege mit Wiki-Artikel.
