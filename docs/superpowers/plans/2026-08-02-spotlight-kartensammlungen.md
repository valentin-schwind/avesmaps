# Spotlight: Wort-UND-Suche + Kartensammlungen — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Spotlight-Suche versteht mehrere Wörter („stadtplan gareth") und findet Karten aus der Kartensammlung, ohne dass diese die Trefferliste fluten.

**Architecture:** Die reine Suchlogik wandert aus dem Endpunkt in eine eigene, ohne DB testbare Bibliothek. Darauf setzt die Wort-UND-Regel auf — server- **und** client-seitig, denn die Suche läuft doppelt. Karten kommen als vierte Quelle in `map-search.php` (neben `map_features`, `political_territory`, Innerorts-Objekten), erben ihr Sprungziel vom zugeordneten Ort und werden im Client als gedeckelte Sektion gerendert.

**Tech Stack:** PHP 8 (strict types, PDO) · Vanilla JS, kein Build · `assert()`-Tests ohne Framework

**Entwurf:** `docs/superpowers/specs/2026-08-02-spotlight-kartensammlungen-design.md`

## Global Constraints

- **Kein Build-Schritt.** Neue JS-Dateien müssen in `index.html` von Hand eingehängt werden; die Ladereihenfolge ist ein Vertrag.
- **Nie ein `?v=` von Hand schreiben** — der Deploy stempelt alles, was von `index.html` aus erreichbar ist (AGENTS.md §7).
- **Kein `git add -A`.** Geteilter Checkout mit parallelen Sitzungen: nur eigene Dateien per Pfad stagen.
- **Deutsche UI-Strings bleiben deutsch**, Code-Kommentare und Commit-Nachrichten auf Englisch (AGENTS.md §8). Neue sichtbare Strings laufen durch `tr(key, fallback)`.
- **Keine Farb-/Radius-Literale in neuem CSS** — die neue Sektion erbt von vorhandenen Klassen (AGENTS.md §12).
- **PHP-Tests:** `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <datei>` — ohne `zend.assertions=1` prüft `assert()` **nichts**.
- **JS-Tests:** `node <datei>` — kein Runner, keine `package.json`.
- **Es gibt keine lokale DB.** Alles DB-Gebundene wird erst live geprüft (Task 8), reine Funktionen sind das einzige lokal Beweisbare.
- **STRATO:** Live-Proben immer einzeln, nie in Schleife.

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `api/_internal/app/map-search-scoring.php` | **neu** — Normalisierung + Bewertung, rein, ohne DB |
| `api/_internal/app/citymap-search.php` | **neu** — lädt Karten als Suchzeilen, baut Sucheinträge |
| `api/_internal/app/__tests__/map-search-scoring-test.php` | **neu** |
| `api/_internal/app/__tests__/citymap-search-test.php` | **neu** |
| `js/ui/__tests__/spotlight-scoring.test.js` | **neu** |
| `api/app/map-search.php` | Endpunkt: requiret die Libs, hängt Karten als 4. Quelle ein |
| `js/ui/spotlight-search.js` | Client-Bewertung, Karten-Eintrag, Kontingent, Sektions-Markup |
| `css/components/spotlight-search.css` | Sektionsüberschrift + Ausklappzeile |

---

### Task 1: Suchlogik in eine testbare Bibliothek heben

Reiner Umzug, **kein Verhaltenswechsel**. Er existiert, damit Task 2 überhaupt einen Test schreiben kann: heute liegen die Funktionen in einer Endpunktdatei, die beim `require` sofort einen Request verarbeitet.

**Files:**
- Create: `api/_internal/app/map-search-scoring.php`
- Create: `api/_internal/app/__tests__/map-search-scoring-test.php`
- Modify: `api/app/map-search.php` (Funktionen entfernen, Lib requiren)

**Interfaces:**
- Produces: `avesmapsNormalizeSearchText(string): string` · `avesmapsCalculateSearchScore(array $entry, string $normalizedQuery): ?int` · `avesmapsAnySearchWordStartsWith(string, string): bool` — Namen und Signaturen **unverändert**, damit kein Aufrufer bricht.

- [ ] **Step 1: Prüfen, wer die Funktionen sonst noch benutzt**

```bash
grep -rn "avesmapsNormalizeSearchText\|avesmapsCalculateSearchScore\|avesmapsAnySearchWordStartsWith" api/ js/
```

Erwartung: Treffer nur in `api/app/map-search.php` und ggf. `api/_internal/app/in-settlement-search.php`. Findet sich ein weiterer Aufrufer, muss er die neue Lib ebenfalls requiren — sonst „undefined function" zur Laufzeit.

- [ ] **Step 2: Die Bibliothek anlegen**

`api/_internal/app/map-search-scoring.php` — die drei Funktionen **wortgleich** aus `api/app/map-search.php:379-430` übernehmen, mit diesem Kopf:

```php
<?php

declare(strict_types=1);

// Pure scoring core of the map search. Extracted from api/app/map-search.php so it can be tested
// without a database: that file is an ENDPOINT -- requiring it runs a request. Nothing here touches
// PDO, $_GET or the network; arguments in, verdict out.
//
// Guarded against double declaration because the endpoint and in-settlement-search.php may both
// require it depending on load order.

require_once __DIR__ . '/../text/ascii-fold.php';
```

Jede Funktion in `if (!function_exists('name')) { ... }` zu wickeln ist **nicht** nötig — `require_once` genügt. Prüfen, dass die Datei mit `require_once` (nicht `require`) eingebunden wird.

- [ ] **Step 3: Charakterisierungstest schreiben — er nagelt das HEUTIGE Verhalten fest**

`api/_internal/app/__tests__/map-search-scoring-test.php`:

```php
<?php

declare(strict_types=1);

// Characterisation test: locks in the behaviour as it is BEFORE the multi-word change, so Task 2 can
// prove it changed only what it meant to.

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';

$gareth = ['search_texts' => ['Stadtplan von Gareth', 'Gareth', 'Stadtplan']];

// The four scoring tiers, unchanged.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth')) === 0);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('stadtplan von')) === 1);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('von')) === 2);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('areth')) === 3);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('bornland')) === null);

// The umlaut rule the SERVER uses: ue, not u. (The client folds differently -- see the spec, §1.5.)
assert(avesmapsNormalizeSearchText('Echsensümpfe') === 'echsensuempfe');
assert(avesmapsNormalizeSearchText('Khôm') === 'khom');
assert(avesmapsNormalizeSearchText('Weiße Straße') === 'weisse strasse');

echo "map-search-scoring: OK\n";
```

- [ ] **Step 4: Test laufen lassen — er muss GRÜN sein**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/map-search-scoring-test.php
```

Erwartung: `map-search-scoring: OK`. Rot heißt: beim Umzug wurde etwas verändert — zurück zu Step 2, byteweise vergleichen.

- [ ] **Step 5: Endpunkt umstellen**

In `api/app/map-search.php` die drei Funktionsdefinitionen löschen und oben ergänzen:

```php
require_once __DIR__ . '/../_internal/app/map-search-scoring.php';
```

- [ ] **Step 6: Beweisen, dass der Endpunkt noch lädt**

```bash
php -l api/app/map-search.php
```

Erwartung: `No syntax errors detected`. Zusätzlich prüfen, dass keine Funktion doppelt deklariert ist:

```bash
grep -c "function avesmapsCalculateSearchScore" api/app/map-search.php api/_internal/app/map-search-scoring.php
```

Erwartung: `0` in der ersten, `1` in der zweiten Datei.

- [ ] **Step 7: Commit**

```bash
git add api/_internal/app/map-search-scoring.php api/_internal/app/__tests__/map-search-scoring-test.php api/app/map-search.php
git commit -m "refactor(search): the scoring core moves into a library that a test can require"
```

---

### Task 2: Wort-UND-Suche server-seitig

**Files:**
- Modify: `api/_internal/app/map-search-scoring.php`
- Modify: `api/_internal/app/__tests__/map-search-scoring-test.php`

**Interfaces:**
- Consumes: `avesmapsCalculateSearchScore` aus Task 1
- Produces: unveränderte Signatur; `$normalizedQuery` darf jetzt mehrere Wörter tragen

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Ans Ende von `map-search-scoring-test.php` anhängen:

```php
// ---- multi-word: every word must hit, and they may sit in DIFFERENT texts -------------------------
// This is the whole point: "stadtplan" is the type, "gareth" is the place -- no single search_text
// contains both, which is why the old one-string comparison returned null here.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('stadtplan gareth')) !== null);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth stadtplan')) !== null);

// A word that hits nothing kills the entry, however good the others are.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('stadtplan bornland')) === null);

// The entry is only as good as its WEAKEST word: 'gareth' is exact (0), 'tadtplan' is contained (3).
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth tadtplan')) === 3);

// Single-word queries must behave EXACTLY as before -- this is the regression guard for the change.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('gareth')) === 0);
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('bornland')) === null);

// Repeated whitespace must not produce an empty word that matches everything.
assert(avesmapsCalculateSearchScore($gareth, avesmapsNormalizeSearchText('  stadtplan   gareth ')) !== null);

$winde = ['search_texts' => ['Meer der Sieben Winde']];
assert(avesmapsCalculateSearchScore($winde, avesmapsNormalizeSearchText('meer winde')) !== null);
```

- [ ] **Step 2: Test laufen lassen — er muss FEHLSCHLAGEN**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/map-search-scoring-test.php
```

Erwartung: `AssertionError` auf der ersten neuen Zeile (`stadtplan gareth`).

- [ ] **Step 3: Die Regel umsetzen**

`avesmapsCalculateSearchScore` in `map-search-scoring.php` ersetzen durch:

```php
/**
 * Score an entry against a normalised query. NULL = no match.
 *
 * The query is split into WORDS, and every word must hit at least one of the entry's search texts --
 * but they may hit DIFFERENT ones. That is the whole difference to the previous version, which
 * compared the query as one string against each text on its own and therefore could not match
 * "stadtplan gareth" (type in one text, place in another).
 *
 * The entry scores as badly as its WEAKEST word: a query is only satisfied to the degree its worst
 * part is. A single-word query walks the identical path as before -- one word, its own score -- which
 * is what keeps the common case bit-for-bit unchanged.
 */
function avesmapsCalculateSearchScore(array $entry, string $normalizedQuery): ?int {
    $words = array_values(array_filter(preg_split('/\s+/', $normalizedQuery) ?: [], static fn (string $w): bool => $w !== ''));
    if ($words === []) {
        return null;
    }

    $candidates = [];
    foreach ($entry['search_texts'] ?? [] as $searchText) {
        $candidate = avesmapsNormalizeSearchText((string) $searchText);
        if ($candidate !== '') {
            $candidates[] = $candidate;
        }
    }
    if ($candidates === []) {
        return null;
    }

    $worstWordScore = 0;
    foreach ($words as $word) {
        $bestForWord = null;
        foreach ($candidates as $candidate) {
            $score = avesmapsScoreSearchWord($candidate, $word);
            if ($score !== null) {
                $bestForWord = $bestForWord === null ? $score : min($bestForWord, $score);
            }
        }

        if ($bestForWord === null) {
            return null; // one unmatched word is enough to reject the entry
        }
        $worstWordScore = max($worstWordScore, $bestForWord);
    }

    return $worstWordScore;
}

/**
 * The four tiers, unchanged from the original: equal / prefix / word-prefix / contained.
 */
function avesmapsScoreSearchWord(string $candidate, string $word): ?int {
    if ($candidate === $word) {
        return 0;
    }
    if (str_starts_with($candidate, $word)) {
        return 1;
    }
    if (avesmapsAnySearchWordStartsWith($candidate, $word)) {
        return 2;
    }
    if (str_contains($candidate, $word)) {
        return 3;
    }

    return null;
}
```

- [ ] **Step 4: Test laufen lassen — jetzt GRÜN**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/map-search-scoring-test.php
```

Erwartung: `map-search-scoring: OK` — inklusive der alten Zeilen aus Task 1, die weiterhin gelten müssen.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/map-search-scoring.php api/_internal/app/__tests__/map-search-scoring-test.php
git commit -m "feat(search): every word of a query must hit, and they may hit different fields"
```

---

### Task 3: Wort-UND-Suche client-seitig

Die Suche läuft doppelt (Entwurf §1.5). Ohne diesen Task verhält sich die lokale Trefferliste anders als die vom Server.

**Files:**
- Modify: `js/ui/spotlight-search.js:442-467`
- Create: `js/ui/__tests__/spotlight-scoring.test.js`

**Interfaces:**
- Consumes: `normalizeSpotlightSearchText(value): string` (unverändert)
- Produces: `getSpotlightSearchScore(entry, normalizedQuery): number` — `Infinity` heißt weiterhin „kein Treffer"

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`js/ui/__tests__/spotlight-scoring.test.js`:

```javascript
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// spotlight-search.js is a browser script with no module system, so the two pure functions are pulled
// out by name and evaluated on their own -- the test exercises the shipped source, not a copy.
// Anchor: these declarations sit at column 0, so a closing brace at column 0 ends them.
//
// Run (from repo root):  node js/ui/__tests__/spotlight-scoring.test.js

const source = fs.readFileSync(path.join(__dirname, "..", "spotlight-search.js"), "utf8");

const extract = (name) => {
	const match = source.match(new RegExp("\\nfunction " + name + "\\([\\s\\S]*?\\n\\}"));
	assert.ok(match, `${name}() not found in js/ui/spotlight-search.js -- renamed?`);
	return match[0];
};

// scoreSpotlightWord comes along because getSpotlightSearchScore calls it -- extracting only the
// caller would blow up with "scoreSpotlightWord is not defined" inside the sandbox.
const context = { Infinity, Math, String, Number, Boolean, Array };
vm.runInNewContext(
	extract("normalizeSpotlightSearchText") + extract("scoreSpotlightWord") + extract("getSpotlightSearchScore"),
	context
);
const { getSpotlightSearchScore, normalizeSpotlightSearchText } = context;

const score = (entry, query) => getSpotlightSearchScore(entry, normalizeSpotlightSearchText(query));
const gareth = { normalizedSearchTexts: ["stadtplan von gareth", "gareth", "stadtplan"] };

// ---- unchanged single-word behaviour (the regression guard) -------------------------------------
assert.strictEqual(score(gareth, "gareth"), 0);
assert.strictEqual(score(gareth, "stadtplan von"), 1);
assert.strictEqual(score(gareth, "areth"), 3);
assert.strictEqual(score(gareth, "bornland"), Infinity);

// ---- THE POINT: words may sit in different texts -------------------------------------------------
assert.ok(Number.isFinite(score(gareth, "stadtplan gareth")));
assert.ok(Number.isFinite(score(gareth, "gareth stadtplan")));
assert.strictEqual(score(gareth, "stadtplan bornland"), Infinity);

// ---- the entry is as good as its weakest word ----------------------------------------------------
assert.strictEqual(score(gareth, "gareth tadtplan"), 3);

// ---- whitespace must not create an empty word that matches everything ----------------------------
assert.ok(Number.isFinite(score(gareth, "  stadtplan   gareth ")));
assert.strictEqual(score(gareth, "   "), Infinity);

console.log("spotlight-scoring: OK");
```

- [ ] **Step 2: Test laufen lassen — er muss FEHLSCHLAGEN**

```bash
node js/ui/__tests__/spotlight-scoring.test.js
```

Erwartung: `AssertionError` bei `score(gareth, "stadtplan gareth")`.

- [ ] **Step 3: Die Regel umsetzen**

`getSpotlightSearchScore` in `js/ui/spotlight-search.js` ersetzen durch:

```javascript
// Mirrors avesmapsCalculateSearchScore in api/_internal/app/map-search-scoring.php: every word of the
// query must hit at least one search text, the words may hit DIFFERENT ones, and the entry scores as
// badly as its weakest word. Both sides must agree -- a result list that mixes local and backend hits
// would otherwise rank the same object twice over by two different rules.
//
// NOTE: the two sides still NORMALISE differently (ue vs u for umlauts). That divergence is older than
// this function and is deliberately not touched here -- see the design doc, §7.
function getSpotlightSearchScore(entry, normalizedQuery) {
	const candidates = entry.normalizedSearchTexts || [entry.name, entry.typeLabel, ...(entry.aliases || [])]
		.map(normalizeSpotlightSearchText)
		.filter(Boolean);
	const words = String(normalizedQuery || "").split(" ").filter(Boolean);
	if (!words.length || !candidates.length) {
		return Infinity;
	}

	let worstWordScore = 0;
	for (const word of words) {
		let bestForWord = Infinity;
		candidates.forEach((candidate) => {
			bestForWord = Math.min(bestForWord, scoreSpotlightWord(candidate, word));
		});
		if (!Number.isFinite(bestForWord)) {
			return Infinity;
		}
		worstWordScore = Math.max(worstWordScore, bestForWord);
	}

	return worstWordScore;
}

// The four tiers, unchanged: equal / prefix / word-prefix / contained.
function scoreSpotlightWord(candidate, word) {
	if (candidate === word) {
		return 0;
	}
	if (candidate.startsWith(word)) {
		return 1;
	}
	if (candidate.split(" ").some((part) => part.startsWith(word))) {
		return 2;
	}
	if (candidate.includes(word)) {
		return 3;
	}

	return Infinity;
}
```

⚠️ `scoreSpotlightWord` muss auf **Spaltenposition 0** stehen (kein Einrücken) — der Test schneidet an diesem Anker.

- [ ] **Step 4: Test laufen lassen — jetzt GRÜN**

```bash
node js/ui/__tests__/spotlight-scoring.test.js
```

Erwartung: `spotlight-scoring: OK`

- [ ] **Step 5: Commit**

```bash
git add js/ui/spotlight-search.js js/ui/__tests__/spotlight-scoring.test.js
git commit -m "feat(search): the client scores multi-word queries the same way the server does"
```

---

### Task 4: Karten als Suchquelle (Bibliothek)

**Files:**
- Create: `api/_internal/app/citymap-search.php`
- Create: `api/_internal/app/__tests__/citymap-search-test.php`

**Interfaces:**
- Produces:
  - `avesmapsFetchCitymapSearchRows(PDO $pdo): array` — je Karte eine Zeile mit `public_id`, `title`, `types` (kommagetrennt), `publisher`, `place_name`, `place_kind`, `place_public_id`
  - `avesmapsBuildCitymapSearchEntries(array $rows, array $typeLabels): array` — **rein**, liefert Sucheinträge im Format von `avesmapsBuildSearchResult`
  - `AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS` — Konstante `type_key => deutsche Beschriftung`

> **Wer entscheidet, ob ein Treffer anspringbar ist — und warum nicht der Server.**
> Karten hängen an vier Ortsarten (`settlement | territory | region | path`), der Client schlägt sie
> aber unter `` `${kind}:${publicId}` `` nach — mit *seinen* Bezeichnungen (`location`, `region`, …).
> Diese Zuordnung kennt nur der Client, und er allein weiß, was gerade geladen ist.
> **Aufteilung:** der Server meldet nur, was in der Datenbank steht (`place_kind === 'unresolved'`
> = niemand hat den Ort je aufgelöst, live 85 von 469); der Client prüft zusätzlich, ob das Objekt
> jetzt auf der Karte liegt. Ein Server, der einen `settlement`-Index über `map_features` bastelt,
> würde die 59 Regionalkarten fälschlich als unauffindbar melden.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`api/_internal/app/__tests__/citymap-search-test.php`:

```php
<?php

declare(strict_types=1);

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';
require_once __DIR__ . '/../citymap-search.php';

$labels = AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS;

// Modelled on real rows (live 2026-08-02), not invented.
$rows = [
    [
        'public_id' => 'cm-1',
        'title' => 'Plan des alten Schlosses',
        'types' => 'grundriss',
        'publisher' => 'Ulisses Spiele',
        'place_name' => 'Gareth',
        'place_kind' => 'settlement',
        'place_public_id' => 'loc-gareth',
    ],
    [
        'public_id' => 'cm-2',
        'title' => 'Stadtplan von Gareth (Herz des Reiches)',
        'types' => 'stadtplan',
        'publisher' => 'Ulisses Spiele',
        'place_name' => 'Gareth',
        'place_kind' => 'settlement',
        'place_public_id' => 'loc-gareth',
    ],
    [
        'public_id' => 'cm-3',
        'title' => 'Karte von Bosparan',
        'types' => 'uebersicht',
        'publisher' => '',
        'place_name' => 'Bosparan',
        'place_kind' => 'unresolved',
        'place_public_id' => null,
    ],
];

$entries = avesmapsBuildCitymapSearchEntries($rows, $labels);
assert(count($entries) === 3);

$byId = [];
foreach ($entries as $entry) {
    $byId[$entry['public_id']] = $entry;
}

// Kind and jump target. The place travels with its KIND -- only the client can turn that into a
// lookup key, because only it knows what is currently on the map.
assert($byId['cm-1']['kind'] === 'citymap');
assert($byId['cm-1']['place_public_id'] === 'loc-gareth');
assert($byId['cm-1']['place_kind'] === 'settlement');
assert($byId['cm-1']['not_on_map'] === true);

// THE CASE THIS EXISTS FOR: the title never says "Gareth", the assigned place does.
$score = avesmapsCalculateSearchScore($byId['cm-1'], avesmapsNormalizeSearchText('gareth'));
assert($score !== null);

// Types match by KEY and by LABEL -- the payload carries 'uebersicht', a human types 'Übersicht'.
assert(avesmapsCalculateSearchScore($byId['cm-3'], avesmapsNormalizeSearchText('uebersicht')) !== null);
assert(avesmapsCalculateSearchScore($byId['cm-3'], avesmapsNormalizeSearchText('Übersicht')) !== null);

// The multi-word case from the design doc.
assert(avesmapsCalculateSearchScore($byId['cm-2'], avesmapsNormalizeSearchText('stadtplan gareth')) !== null);

// A map whose place never resolved stays FINDABLE but carries no target.
assert($byId['cm-3']['place_public_id'] === '');
assert($byId['cm-3']['unresolved'] === true);
assert($byId['cm-1']['unresolved'] === false);

// A REGIONAL map must NOT be mistaken for unresolved -- 59 of 455 hang on a region, not a settlement.
$regional = avesmapsBuildCitymapSearchEntries([[
    'public_id' => 'cm-4',
    'title' => 'Politische Karte der Flusslande',
    'types' => 'region',
    'publisher' => '',
    'place_name' => 'Flusslande',
    'place_kind' => 'region',
    'place_public_id' => 'reg-flusslande',
]], $labels)[0];
assert($regional['place_kind'] === 'region');
assert($regional['unresolved'] === false);

// The type line carries type AND place -- "Plan des alten Schlosses" alone reads like a stray row.
assert($byId['cm-1']['type_label'] === 'Grundriss · Gareth');
assert($byId['cm-3']['type_label'] === 'Übersicht · Bosparan');

// The publisher is searchable; note/author are deliberately NOT among the search texts (freetext with
// wiki leftovers / filled on 64 of 455 -- both are noise against title, place and type).
$haystack = implode(' | ', $byId['cm-2']['search_texts']);
assert(str_contains($haystack, 'Ulisses'));
assert(str_contains($haystack, 'Stadtplan von Gareth (Herz des Reiches)'));

echo "citymap-search: OK\n";
```

- [ ] **Step 2: Test laufen lassen — er muss FEHLSCHLAGEN**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-search-test.php
```

Erwartung: `Failed opening required '.../citymap-search.php'`

- [ ] **Step 3: Die Bibliothek schreiben**

`api/_internal/app/citymap-search.php`:

```php
<?php

declare(strict_types=1);

// Kartensammlung as a search source. A map has NO geometry of its own -- it inherits its position from
// the place it is assigned to, exactly like the in-settlement objects do. Design:
// docs/superpowers/specs/2026-08-02-spotlight-kartensammlungen-design.md
//
// The building function is PURE (rows in, entries out) so it is testable without a database.

// Mirrors html/citymap-editor.html TYPE_KEYS. Both key and label are searchable: the payload carries
// 'uebersicht', a human types 'Übersicht' -- matching only the key fails silently on every umlaut type.
const AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS = [
    'ortsplan' => 'Ortsplan',
    'stadtplan' => 'Stadtplan',
    'bezirk' => 'Bezirk',
    'viertel' => 'Viertel',
    'lageplan' => 'Lageplan',
    'uebersicht' => 'Übersicht',
    'schauplatz' => 'Schauplatz',
    'grundriss' => 'Grundriss',
    'befestigungen' => 'Befestigungen',
    'dungeon' => 'Dungeon',
    'hoehlen' => 'Höhlen',
    'krypten' => 'Krypten',
    'katakomben' => 'Katakomben',
    'schatzkarte' => 'Schatzkarte',
    'region' => 'Region',
    'sonstige' => 'Sonstige',
];

/**
 * One row per map, with its FIRST assigned place (sort_order) and its types folded into one column.
 * GROUP_CONCAT avoids a second query and an N+1 -- this runs on a public, per-keystroke path.
 *
 * Only approved maps, and only when the collection is switched on (the caller checks that).
 */
function avesmapsFetchCitymapSearchRows(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT c.public_id,
                    c.title,
                    COALESCE(GROUP_CONCAT(DISTINCT t.type_key ORDER BY t.type_key SEPARATOR ','), '') AS types,
                    COALESCE(c.publisher, '') AS publisher,
                    COALESCE(p.raw_name, '') AS place_name,
                    COALESCE(p.target_kind, 'unresolved') AS place_kind,
                    p.target_public_id AS place_public_id
             FROM citymap c
             LEFT JOIN citymap_type t ON t.citymap_id = c.id
             LEFT JOIN citymap_place p ON p.id = (
                 SELECT p2.id FROM citymap_place p2
                 WHERE p2.citymap_id = c.id AND p2.status = 'approved'
                 ORDER BY p2.sort_order ASC, p2.id ASC LIMIT 1
             )
             WHERE c.status = 'approved'
             GROUP BY c.id, c.public_id, c.title, c.publisher, p.raw_name, p.target_kind, p.target_public_id"
        );
    } catch (Throwable) {
        return []; // table missing (never synced) -> no maps in the search, not a 500
    }

    return $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
}

/**
 * PURE. Builds search entries from rows.
 *
 * The place travels with its KIND and is NOT resolved here. Maps hang on four kinds of place
 * (settlement|territory|region|path) and the client looks them up as `${kind}:${publicId}` using ITS
 * own vocabulary -- a mapping only the client knows, and only it knows what is loaded right now.
 * All this function can honestly say is whether the database ever resolved the place at all.
 *
 * @param array<string, string> $typeLabels key => German label
 * @return list<array<string, mixed>>
 */
function avesmapsBuildCitymapSearchEntries(array $rows, array $typeLabels): array {
    $entries = [];
    foreach ($rows as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }

        $typeKeys = array_values(array_filter(explode(',', (string) ($row['types'] ?? ''))));
        $labels = [];
        foreach ($typeKeys as $typeKey) {
            $labels[] = $typeLabels[$typeKey] ?? $typeKey;
        }

        $placeName = trim((string) ($row['place_name'] ?? ''));
        $placeKind = (string) ($row['place_kind'] ?? 'unresolved');
        $placePublicId = (string) ($row['place_public_id'] ?? '');
        // 85 of 469 assignments were never resolved (measured live 2026-08-02). Those maps stay
        // findable -- being told the map exists beats hiding it -- but they carry no target, so they
        // are marked and ranked last. This is the ONLY reachability claim the server can make.
        $unresolved = $placePublicId === '' || $placeKind === 'unresolved';

        // The type line carries type AND place: for a map named after a building ("Plan des alten
        // Schlosses") the place is the only reason it shows up at all.
        $typeLabelParts = array_filter([$labels === [] ? '' : implode(', ', $labels), $placeName]);

        $entries[] = [
            'kind' => 'citymap',
            'public_id' => (string) ($row['public_id'] ?? ''),
            'public_ids' => [(string) ($row['public_id'] ?? '')],
            'name' => $title,
            'type_label' => implode(' · ', $typeLabelParts),
            'feature_subtype' => 'citymap',
            'place_public_id' => $unresolved ? '' : $placePublicId,
            'place_kind' => $placeKind,
            'place_name' => $placeName,
            'not_on_map' => true,
            'unresolved' => $unresolved,
            'min_x' => 0.0,
            'min_y' => 0.0,
            'max_x' => 0.0,
            'max_y' => 0.0,
            // note/author stay out: note is freetext with wiki leftovers ("Mit Nummern", "Veraltet UDW,
            // Seite 14"), author is filled on 64 of 455 -- both are noise against title/place/type.
            'search_texts' => array_values(array_filter(array_merge(
                [$title, $placeName, (string) ($row['publisher'] ?? '')],
                $typeKeys,
                $labels
            ))),
        ];
    }

    return $entries;
}
```

- [ ] **Step 4: Test laufen lassen — jetzt GRÜN**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-search-test.php
```

Erwartung: `citymap-search: OK`

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/citymap-search.php api/_internal/app/__tests__/citymap-search-test.php
git commit -m "feat(search): maps become a search source that inherits its position from its place"
```

---

### Task 5: Karten in den Endpunkt einhängen

**Files:**
- Modify: `api/app/map-search.php`

**Interfaces:**
- Consumes: `avesmapsFetchCitymapSearchRows`, `avesmapsBuildCitymapSearchEntries`, `AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS` (Task 4)
- Produces: Treffer mit `kind: "citymap"` im `results`-Array, gedeckelt auf 5

- [ ] **Step 1: Quelle und Not-Aus einhängen**

In `api/app/map-search.php` oben ergänzen — `avesmapsCitymapsEnabled` lebt in `citymaps.php` und liest über `avesmapsAppSettingGet`, beide müssen geladen sein:

```php
require_once __DIR__ . '/../_internal/app/citymaps.php';
require_once __DIR__ . '/../_internal/app/app-setting.php';
require_once __DIR__ . '/../_internal/app/citymap-search.php';
```

Nach `$inSettlementRows = avesmapsFetchInSettlementSearchRows($pdo);` ergänzen:

```php
// Fourth source: the Kartensammlung. The kill switch counts here too -- a collection switched off must
// not become visible again through the search. Default is ON; only a stored '0' disables.
$citymapRows = avesmapsCitymapsEnabled($pdo) ? avesmapsFetchCitymapSearchRows($pdo) : [];
```

- [ ] **Step 2: Das Kontingent einbauen**

`avesmapsBuildMapSearchResults` um einen Parameter erweitern und die Karten **getrennt** sammeln:

```php
function avesmapsBuildMapSearchResults(
    array $rows,
    array $politicalRows,
    string $query,
    int $limit,
    array $inSettlementRows = [],
    ?PDO $pdo = null,
    array $citymapRows = []
): array {
```

Vor dem `usort` einfügen:

```php
// Maps are collected SEPARATELY and capped, then appended. 331 of 455 titles start with "Stadtplan
// von" -- inside the shared limit a single generic word like "stadtplan" would fill all 20 slots and
// push out the actual map objects. The cap is what makes the feature safe to ship.
$citymapResults = [];
foreach (avesmapsBuildCitymapSearchEntries($citymapRows, AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS) as $entry) {
    $score = avesmapsCalculateSearchScore($entry, $normalizedQuery);
    if ($score === null) {
        continue;
    }
    $entry['score'] = $score;
    $citymapResults[] = $entry;
}

usort($citymapResults, static function (array $left, array $right): int {
    // Maps with a resolved place first: a hit that does nothing when clicked belongs at the bottom.
    $resolvedDiff = ((int) $left['unresolved']) <=> ((int) $right['unresolved']);
    if ($resolvedDiff !== 0) {
        return $resolvedDiff;
    }
    $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
    return $scoreDiff !== 0 ? $scoreDiff : strnatcasecmp((string) $left['name'], (string) $right['name']);
});
$citymapTotal = count($citymapResults);
$citymapResults = array_slice($citymapResults, 0, AVESMAPS_CITYMAP_SEARCH_LIMIT);
```

Ganz oben in der Datei neben `AVESMAPS_MAP_SEARCH_MAX_LIMIT`:

```php
// The map section is capped independently of the 20-result limit, so maps never displace map objects.
const AVESMAPS_CITYMAP_SEARCH_LIMIT = 5;
```

Am Ende der Funktion, **nach** dem `array_slice` der übrigen Treffer, die Karten anhängen und die Gesamtzahl mitgeben:

```php
    $mapped = array_map(
        static function (array $entry): array {
            unset($entry['score'], $entry['search_texts'], $entry['group_key']);
            $entry['public_ids'] = array_values(array_unique($entry['public_ids'] ?? []));
            return $entry;
        },
        array_slice($results, 0, $limit)
    );

    foreach ($citymapResults as $entry) {
        unset($entry['score'], $entry['search_texts']);
        $entry['citymap_total'] = $citymapTotal;
        $mapped[] = $entry;
    }

    return $mapped;
}
```

Und den Aufruf ergänzen:

```php
$results = avesmapsBuildMapSearchResults($rows, $politicalRows, $query, $limit, $inSettlementRows, $pdo, $citymapRows);
```

- [ ] **Step 3: Syntax prüfen**

```bash
php -l api/app/map-search.php
```

Erwartung: `No syntax errors detected`

- [ ] **Step 4: Die reinen Tests erneut laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/map-search-scoring-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-search-test.php
```

Erwartung: beide `OK`. (Der Endpunkt selbst braucht eine DB und wird erst in Task 8 geprüft.)

- [ ] **Step 5: Commit**

```bash
git add api/app/map-search.php
git commit -m "feat(search): the Kartensammlung joins the search as a capped fourth source"
```

---

### Task 6: Karten-Treffer im Client annehmen

Ohne diesen Task verwirft der Client jeden Karten-Treffer stillschweigend: `resolveBackendSpotlightEntries` zeigt Backend-Treffer nur, wenn ein lokaler Eintrag dazu existiert.

**Files:**
- Modify: `js/ui/spotlight-search.js:332-411`

**Interfaces:**
- Consumes: Backend-Treffer mit `kind: "citymap"`, `place_public_id`, `place_kind`, `place_name`, `unresolved`, `citymap_total` (Task 5)
- Produces: `buildCitymapSpotlightEntry(result): object|null` · `spotlightCitymapPlaceLookupKeys(placeKind, publicId): string[]`

- [ ] **Step 1: Den Eintragsbauer schreiben**

Direkt nach `buildInSettlementSpotlightEntry` (Zeile 354) einfügen:

```javascript
// The place kinds the Kartensammlung stores (settlement|territory|region|path) are NOT the kinds this
// file looks entries up by (location|region|label|path). Territories and landscape regions can both
// arrive as "region", and a landscape is a label here -- so each kind gets its candidate keys and the
// first one that exists wins. Getting this wrong would mark all 59 regional maps "not on the map".
function spotlightCitymapPlaceLookupKeys(placeKind, publicId) {
	const prefixes = {
		settlement: ["location"],
		territory: ["region"],
		region: ["region", "label"],
		path: ["path"],
	}[String(placeKind || "")] || [];
	return prefixes.map((prefix) => `${prefix}:${publicId}`);
}

// A map from the Kartensammlung. It has no position of its own -- it rides on the place it is assigned
// to, exactly like an in-settlement object. Modelled on buildInSettlementSpotlightEntry deliberately:
// same shape, same notOnMap flag, so selection and focus need no special case.
//
// A map with nothing to jump to is still LISTED -- being told the map exists is worth more than hiding
// it -- but it says so. Two independent reasons: the database never resolved the place (the server
// says so via `unresolved`, live 85 of 469), or the object is simply not loaded right now.
function buildCitymapSpotlightEntry(result) {
	const name = String(result.name || "");
	if (!name) {
		return null;
	}

	const publicId = String(result.place_public_id || "");
	const { byPublicId } = getSpotlightSearchLookup();
	let placeEntry = null;
	if (publicId && !result.unresolved) {
		for (const key of spotlightCitymapPlaceLookupKeys(result.place_kind, publicId)) {
			placeEntry = byPublicId.get(key);
			if (placeEntry) {
				break;
			}
		}
	}

	const base = placeEntry || { bounds: null, publicIds: [], polygons: [] };
	return {
		...base,
		id: `citymap:${String(result.public_id || name)}`,
		kind: "citymap",
		name,
		typeLabel: String(result.type_label || ""),
		aliases: [],
		inSettlementName: String(result.place_name || ""),
		notOnMap: true,
		unreachable: !placeEntry,
		citymapTotal: Number(result.citymap_total) || 0,
	};
}
```

- [ ] **Step 2: Den Bauer einhängen**

In `resolveBackendSpotlightEntries` nach dem `in_settlement`-Zweig (Zeile 391) einfügen:

```javascript
		if (!entry && kind === "citymap") {
			entry = buildCitymapSpotlightEntry(result);
		}
```

- [ ] **Step 3: Das Kontingent gegen den 20er-Schnitt schützen**

`resolveBackendSpotlightEntries` schneidet am Ende auf `SPOTLIGHT_SEARCH_MAX_RESULTS`. Karten müssen **außerhalb** dieses Schnitts liegen, sonst frisst die Kappung sie wieder auf. Zeile 406-408 ersetzen durch:

```javascript
	if (resolvedEntries.length) {
		// Maps sit outside the 20-result limit on purpose: the server already capped them at 5, and
		// counting them against the shared limit would let them displace exactly the map objects the
		// cap exists to protect.
		const mapObjects = resolvedEntries.filter((entry) => entry.kind !== "citymap");
		const citymaps = resolvedEntries.filter((entry) => entry.kind === "citymap");
		return [...mapObjects.slice(0, SPOTLIGHT_SEARCH_MAX_RESULTS), ...citymaps];
	}

	return localEntries;
```

- [ ] **Step 4: Die Sortierordnung ergänzen**

`SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER` (Zeile 4) um einen Eintrag erweitern:

```javascript
const SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER = {
	location: 0,
	label: 1,
	region: 2,
	path: 3,
	powerline: 4,
	// Maps are not map objects -- they are a pointer to one. Last, like the in-settlement objects.
	citymap: 6,
};
```

- [ ] **Step 5: Die Ortsart-Zuordnung testen**

An `js/ui/__tests__/spotlight-scoring.test.js` anhängen (vor der `console.log`-Zeile) — und oben in der
`vm.runInNewContext`-Zeile `extract("spotlightCitymapPlaceLookupKeys")` ergänzen:

```javascript
// ---- place kinds map onto the lookup keys this file actually uses --------------------------------
// A settlement is looked up as "location", a territory as "region". Getting this wrong would mark all
// 59 regional maps as "not on the map" while looking perfectly correct in review.
const keys = context.spotlightCitymapPlaceLookupKeys;
assert.deepStrictEqual(keys("settlement", "abc"), ["location:abc"]);
assert.deepStrictEqual(keys("territory", "abc"), ["region:abc"]);
assert.deepStrictEqual(keys("region", "abc"), ["region:abc", "label:abc"]);
assert.deepStrictEqual(keys("path", "abc"), ["path:abc"]);
assert.deepStrictEqual(keys("unresolved", "abc"), []);
assert.deepStrictEqual(keys("", "abc"), []);
```

- [ ] **Step 6: Syntax prüfen und die Tests laufen lassen**

```bash
node --check js/ui/spotlight-search.js
node js/ui/__tests__/spotlight-scoring.test.js
```

Erwartung: kein Syntaxfehler, `spotlight-scoring: OK`.

⚠️ Ein Syntaxfehler in dieser Datei ist im Browser **stumm** — die Suche tut dann einfach nichts. `node --check` ist die einzige billige Absicherung.

- [ ] **Step 7: Commit**

```bash
git add js/ui/spotlight-search.js
git commit -m "feat(search): the client accepts map hits and keeps them out of the 20-result cap"
```

---

### Task 7: Die Sektion sichtbar machen

**Files:**
- Modify: `js/ui/spotlight-search.js:469-502`
- Modify: `css/components/spotlight-search.css`

**Interfaces:**
- Consumes: Einträge mit `kind === "citymap"`, `citymapTotal`, `unreachable` (Task 6)

- [ ] **Step 1: Überschrift und Ausklappzeile rendern**

`renderSpotlightSearchResults` (Zeile 469) ersetzen durch:

```javascript
function renderSpotlightSearchResults(entries) {
	const { input, results, status } = getSpotlightSearchElements();
	if (!results || !status) {
		return;
	}

	spotlightRenderedEntries = entries;

	// The map section is set apart with a heading rather than folded into the flat list: without it a
	// hit whose title does not contain the search word reads like a bug, and the count is the only
	// place the user learns that more maps exist than the cap shows.
	const firstCitymapIndex = entries.findIndex((entry) => entry.kind === "citymap");
	const citymapTotal = firstCitymapIndex >= 0 ? Number(entries[firstCitymapIndex].citymapTotal) || 0 : 0;
	const shownCitymaps = entries.filter((entry) => entry.kind === "citymap").length;

	results.innerHTML = entries
		.map((entry, index) => {
			const heading = index === firstCitymapIndex
				? `<div class="spotlight-search__section" role="presentation">
					<span>${escapeHtml(tr("spotlight.citymaps", "Kartensammlung"))}</span>
					<span>${citymapTotal}</span>
				</div>`
				: "";
			return heading + spotlightResultMarkup(entry, index);
		})
		.join("")
		+ (citymapTotal > shownCitymaps
			? `<div class="spotlight-search__section-more" role="presentation">${escapeHtml(
				tr("spotlight.citymapsMore", "… und {n} weitere Karten").replace("{n}", String(citymapTotal - shownCitymaps))
			)}</div>`
			: "");

	results.hidden = entries.length === 0;
	status.textContent = "";
	status.hidden = true;
	setSpotlightActiveResultIndex(entries.length ? 0 : -1);

	if (input) {
		input.setAttribute("aria-expanded", entries.length ? "true" : "false");
	}
}
```

⚠️ Überschrift und Ausklappzeile tragen **kein** `data-spotlight-result-index` — sonst zählt die Pfeiltasten-Navigation sie als Treffer mit.

- [ ] **Step 2: Den nicht anspringbaren Treffer kennzeichnen**

In `spotlightResultMarkup` (Zeile 487) den `notOnMap`-Hinweis erweitern:

```javascript
	const hintText = entry.unreachable
		? tr("spotlight.citymapNoTarget", "kein Ort auf der Karte")
		: tr("spotlight.inSettlement", "Innerorts");
	const notOnMap = entry.notOnMap
		? `<span class="spotlight-search__result-hint">${escapeHtml(hintText)}</span>`
		: "";
```

- [ ] **Step 3: Styling ergänzen**

Ans Ende von `css/components/spotlight-search.css`:

```css
/* Abschnittskopf der Kartensammlung. Farben werden bewusst NICHT neu gesetzt: die Zeile erbt die
   Typzeilen-Farbe dieser Datei, damit kein weiteres Literal entsteht (AGENTS.md §12). */
.spotlight-search__section {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 10px;
	padding: 8px 12px 4px;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: inherit;
	opacity: 0.68;
}

.spotlight-search__section-more {
	padding: 4px 12px 8px;
	font-size: 11px;
	opacity: 0.68;
}
```

- [ ] **Step 4: Syntax prüfen**

```bash
node --check js/ui/spotlight-search.js
```

Erwartung: kein Fehler.

- [ ] **Step 5: Commit**

```bash
git add js/ui/spotlight-search.js css/components/spotlight-search.css
git commit -m "ui(search): map hits get their own section with a count and an overflow line"
```

---

### Task 8: Live prüfen

Alles DB-Gebundene ist lokal nicht beweisbar — dieser Task ist die eigentliche Abnahme. **Nach dem Push 1–2 Minuten Deploy abwarten**, PHP zusätzlich 2–4 Minuten OPcache.

**Files:** keine

- [ ] **Step 1: Pushen**

```bash
git push origin HEAD:master
```

Bei Reject **nicht** rebasen (geteilter Checkout mit fremder Arbeit) — Wegwerf-Worktree:

```bash
git worktree add --detach "$SCRATCH/pushwt" origin/master && git -C "$SCRATCH/pushwt" cherry-pick <sha> && git -C "$SCRATCH/pushwt" push origin HEAD:master && git worktree remove "$SCRATCH/pushwt" && git worktree prune
```

- [ ] **Step 2: Die beiden Fälle prüfen, die den Auftrag ausgelöst haben**

Umlaute **explizit UTF-8-kodiert** senden — eine Shell, die sie als CP1252 schickt, erzeugt falsche Leermeldungen (an genau dieser Stelle passiert, 2026-08-02):

```bash
python -c "
import json,urllib.parse,urllib.request
for q in ['stadtplan gareth','meer winde','gareth','stadtplan']:
    u='https://avesmaps.de/api/app/map-search.php?q='+urllib.parse.quote(q.encode('utf-8'))
    r=json.load(urllib.request.urlopen(u,timeout=30)).get('results',[])
    cm=[x for x in r if x.get('kind')=='citymap']
    print(f'{q:20s} {len(r):3d} Treffer, davon {len(cm)} Karten')
    for x in r[:3]: print('   ',x['kind'],'|',x['name'][:52],'|',x.get('type_label',''))
"
```

Erwartung: `stadtplan gareth` findet die Gareth-Stadtpläne (vorher 0) · `meer winde` findet „Meer der Sieben Winde" (vorher 0) · `stadtplan` liefert höchstens **5** Karten und die Kartenobjekte stehen weiter oben.

- [ ] **Step 3: Regression an Einwort-Suchen**

```bash
python -c "
import json,urllib.parse,urllib.request
for q in ['Gareth','Havena','Khôm','Echsensümpfe','Herzogtum Nordmarken']:
    u='https://avesmaps.de/api/app/map-search.php?q='+urllib.parse.quote(q.encode('utf-8'))
    r=json.load(urllib.request.urlopen(u,timeout=30)).get('results',[])
    print(f'{q:22s} {len(r):3d}  {r[0][\"name\"] if r else \"KEIN TREFFER\"}')
"
```

Erwartung: dieselben ersten Treffer wie vor dem Umbau. Das ist die eigentliche Regressionsprüfung — Einwort-Suchen sind der Normalfall und dürfen sich **nicht** verändert haben.

- [ ] **Step 4: Im Browser gegenprüfen**

`https://avesmaps.de` öffnen, **Strg+Shift+R** (Spotlight-JS lädt ohne `?v=`), Suche öffnen, „stadtplan gareth" tippen.

Erwartung: Abschnitt „Kartensammlung" mit Zahl, höchstens 5 Karten, darunter die Zeile „… und N weitere Karten"; ein Klick auf eine Karte springt auf Gareth und öffnet die Infobox; die Pfeiltasten überspringen Überschrift und Ausklappzeile.

- [ ] **Step 5: Ergebnis festhalten**

Gemessene Zahlen in die Antwort an den Owner, **nicht** in eine neue Datei. Weicht etwas ab, hier stoppen und berichten statt nachzubessern.

---

## Was dieser Plan bewusst NICHT tut

- **Die Normalisierungs-Divergenz** (Server `ue`, Client `u`) bleibt bestehen. `normalizeSpotlightSearchText` speist auch den Weg-Gruppen-Identitätsschlüssel; das anzufassen ist ein Eingriff in die Weg-Identität und gehört gemessen und separat entschieden (Entwurf §7).
- **Die Karten-Typisierung** bleibt Handarbeit. Der Wiki-Sync setzt den Typ als Spalten-Konstante, es gibt dort nichts nachzuziehen (Entwurf §5). Sobald jemand typisiert, wirkt es ohne weiteren Bau.
- **Vorkommen** (Flora/Fauna/Waren) sind eine eigene Runde (Entwurf §6).
- **Kein Rechtsklick-Menüpunkt.** Der ursprüngliche Wortlaut von #57 verlangte einen eigenen Dialog; der Owner hat den Ausbau der vorhandenen Suche vorgezogen.
