# Spotlight: Abenteuer und Vorkommen — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Spotlight-Suche findet Abenteuer (über ihren spoilerfreien Beginn-Ort) und Vorkommen aus Flora/Fauna/Waren (und hebt alle ihre Orte auf der Karte hervor) — als fünfte und sechste Quelle neben Kartenobjekten, Territorien, Innerorts-Objekten und der Kartensammlung.

**Architecture:** Beide Quellen bekommen je eine **reine, ohne DB testbare** PHP-Bibliothek, die der Endpunkt `map-search.php` einhängt und auf 5 Treffer deckelt. Client-seitig wird die vorhandene, für die Kartensammlung gebaute Abschnitts-Mechanik **verallgemeinert** statt kopiert: eine Liste `SPOTLIGHT_SEARCH_SECTIONS`, ein Eintragsbauer für alle ortsgebundenen Treffer, ein Focus-Helfer. Vorkommen sind der Sonderfall — sie haben **mehrere** Ziele und **kein** gespeichertes Ziel, also löst der Client sie über Wiki-Schlüssel und Namen auf und hebt alle gefundenen hervor.

**Tech Stack:** PHP 8 (strict types, PDO) · Vanilla JS, kein Build, Leaflet 1.9.4 · `assert()`-Tests ohne Framework

**Entwurf:** `docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md`

## Global Constraints

- **Arbeitsverzeichnis ist der Worktree** `C:/GIT/avesmaps/.claude/worktrees/spotlight-abenteuer-vorkommen` (Branch `worktree-spotlight-abenteuer-vorkommen`, von `origin/master`). Nie im geteilten Hauptbaum arbeiten.
- **Kein `git add -A`, kein `git add .`, kein `git commit -a`.** Nur die eigenen Dateien per Pfad stagen. Im Worktree liegt eine fremde Änderung an `api/_internal/routing/__tests__/water-trial-test.php` — **die bleibt unangetastet.**
- **Kein Build-Schritt.** Es entsteht keine neue JS-Datei; nichts muss in `index.html` eingehängt werden.
- **Nie ein `?v=` von Hand schreiben** (AGENTS.md §7).
- **Deutsche UI-Strings bleiben deutsch**, Code-Kommentare und Commit-Nachrichten auf Englisch (AGENTS.md §8). Jeder neue sichtbare String läuft durch `tr(key, fallback)` und bekommt in Task 7 seinen englischen Gegenpart.
- **Keine Farb-/Radius-Literale in neuem Code.** Die Hervorhebung erbt `SPOTLIGHT_PATH_HIGHLIGHT_STYLE` (AGENTS.md §12).
- **PHP-Tests:** `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <datei>` — ohne `zend.assertions=1` prüft `assert()` **nichts**.
- **JS-Tests:** `node <datei>` — kein Runner, keine `package.json`.
- **Es gibt keine lokale DB.** Alles DB-Gebundene wird erst live geprüft (Task 8); reine Funktionen sind das einzige lokal Beweisbare.
- **STRATO:** Live-Proben immer einzeln, nie in Schleife. Umlaute explizit UTF-8-kodiert senden, sonst melden sie falsche Nullen.
- 💣 **Kein `avesmapsAppSettingGet` und keine DDL auf diesem Pfad.** `map-search.php` läuft bei jedem Tastenanschlag; jede `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE`-Prüfung dort ist die Last, die AGENTS.md §10 dem PHP-Pool-Vorfall vom 2026-07-17 zuschreibt.

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `api/_internal/app/adventure-search.php` | **neu** — lädt Abenteuer samt Beginn-Ort, baut Sucheinträge (rein) |
| `api/_internal/app/lore-search.php` | **neu** — liest die freigeschalteten Arten, lädt Vorkommen samt Orten, baut Sucheinträge (rein) |
| `api/_internal/app/__tests__/adventure-search-test.php` | **neu** |
| `api/_internal/app/__tests__/lore-search-test.php` | **neu** |
| `api/app/map-search.php` | Endpunkt: Sektions-Sammler, zwei neue Quellen, zwei Not-Aus-Schalter |
| `js/ui/spotlight-search.js` | Abschnitts-Liste, Eintragsbauer, Vorkommens-Auflösung, Lookup-Index |
| `js/ui/spotlight-search-focus.js` | Focus-Helfer für ortsgebundene Treffer und für Vorkommen, Punkt-/Polygon-Hervorhebung |
| `js/ui/__tests__/spotlight-scoring.test.js` | Umbenennung + neue Fälle |
| `js/app/i18n-en.js` | englische Gegenparts der neuen (und drei fehlender alter) Strings |

---

### Task 0: Antwortzeit vorher messen

Ohne diese Zahl ist die Aussage „die Suche wurde nicht langsamer" in Task 8 eine Behauptung. Sie muss **vor** dem ersten Push erhoben werden, weil der Push deployt.

**Files:** keine

- [ ] **Step 1: Drei Eingaben je einmal messen, Ergebnis notieren**

```bash
python -c "
import json,urllib.parse,urllib.request,time
for q in ['gareth','stadtabenteuer gareth','alraune']:
    u='https://avesmaps.de/api/app/map-search.php?q='+urllib.parse.quote(q.encode('utf-8'))
    t=time.time(); r=json.load(urllib.request.urlopen(u,timeout=60)); ms=(time.time()-t)*1000
    print(f'{q:24s} {ms:7.0f} ms  {len(r.get(\"results\",[])):3d} Treffer')
"
```

Die drei Zahlen in die Antwort an den Owner übernehmen (Task 8 vergleicht gegen sie). **Nichts committen.**

---

### Task 1: Abenteuer als Suchquelle (Bibliothek)

**Files:**
- Create: `api/_internal/app/adventure-search.php`
- Create: `api/_internal/app/__tests__/adventure-search-test.php`

**Interfaces:**
- Consumes: `avesmapsCalculateSearchScore(array $entry, string $normalizedQuery): ?int` und `avesmapsNormalizeSearchText(string): string` aus `api/_internal/app/map-search-scoring.php`
- Produces:
  - `AVESMAPS_ADVENTURE_SEARCH_TYPE_LABELS` — Konstante `product_type => deutsche Beschriftung`
  - `avesmapsFetchAdventureSearchRows(PDO $pdo): array`
  - `avesmapsBuildAdventureSearchEntries(array $rows, array $typeLabels): array` — **rein**
  - `avesmapsAdventureSearchEditionSortKey(string $edition): float`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`api/_internal/app/__tests__/adventure-search-test.php`:

```php
<?php

declare(strict_types=1);

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';
require_once __DIR__ . '/../adventure-search.php';

$labels = AVESMAPS_ADVENTURE_SEARCH_TYPE_LABELS;

// Modelled on real rows (live 2026-08-02), not invented. Row 2 is the spoiler case: its start place
// never resolved, so the fetch hands over the empty place -- the play place is not even selected.
$rows = [
    [
        'public_id' => 'adv-1',
        'title' => 'Die Verschwoerung von Gareth',
        'product_type' => 'gruppenabenteuer',
        'edition' => 'DSA5',
        'genre' => 'Stadtabenteuer, Intrigenszenario',
        'series' => '',
        'contained_in' => '',
        'place_name' => 'Gareth',
        'place_kind' => 'settlement',
        'place_public_id' => 'loc-gareth',
    ],
    [
        'public_id' => 'adv-2',
        'title' => 'Die Phileasson-Saga',
        'product_type' => 'kampagnenband',
        'edition' => 'DSA4.1',
        'genre' => '',
        'series' => 'Die Phileasson-Saga (1999)',
        'contained_in' => '',
        'place_name' => '',
        'place_kind' => 'unresolved',
        'place_public_id' => null,
    ],
    [
        'public_id' => 'adv-3',
        'title' => 'Der unerwuenschte Gast',
        'product_type' => 'szenario',
        'edition' => 'DSA3',
        'genre' => 'Stadtabenteuer',
        'series' => '',
        'contained_in' => 'Abenteuer in Gareth',
        'place_name' => 'Koenigreich Garetien',
        'place_kind' => 'territory',
        'place_public_id' => 'terr-garetien',
    ],
];

$entries = avesmapsBuildAdventureSearchEntries($rows, $labels);
assert(count($entries) === 3);

$byId = [];
foreach ($entries as $entry) {
    $byId[$entry['public_id']] = $entry;
}

// Kind and jump target. The place travels with its KIND -- only the client can turn that into a
// lookup key, because only it knows what is currently on the map.
assert($byId['adv-1']['kind'] === 'adventure');
assert($byId['adv-1']['place_public_id'] === 'loc-gareth');
assert($byId['adv-1']['place_kind'] === 'settlement');
assert($byId['adv-1']['place_name'] === 'Gareth');
assert($byId['adv-1']['not_on_map'] === true);
assert($byId['adv-1']['unresolved'] === false);

// A territory start place must NOT be mistaken for unresolved -- 134 of 976 resolved start places
// hang on a territory, 311 on a region.
assert($byId['adv-3']['place_kind'] === 'territory');
assert($byId['adv-3']['unresolved'] === false);

// No start place at all: findable, but carries no target.
assert($byId['adv-2']['place_public_id'] === '');
assert($byId['adv-2']['unresolved'] === true);

// The type line carries product type AND edition. The edition is not decoration: 29 titles are
// handed out twice or more ("Silvanas Befreiung" 3x), and two identical rows are indistinguishable.
assert($byId['adv-1']['type_label'] === 'Gruppenabenteuer · DSA5');
assert($byId['adv-2']['type_label'] === 'Kampagnenband · DSA4.1');

// Product types match by KEY and by LABEL. kampagnenband/metaband are live (27 + 5) but MISSING from
// the client table js/map-features/map-features-adventures.js, where they fall back to the raw key.
assert(avesmapsCalculateSearchScore($byId['adv-2'], avesmapsNormalizeSearchText('kampagnenband')) !== null);
assert(avesmapsCalculateSearchScore($byId['adv-2'], avesmapsNormalizeSearchText('Kampagnenband')) !== null);
assert(isset($labels['metaband']));

// THE MULTI-WORD CASE this feature exists for: the genre says "Stadtabenteuer", the start place says
// "Gareth", and no single search text contains both.
assert(avesmapsCalculateSearchScore($byId['adv-3'], avesmapsNormalizeSearchText('stadtabenteuer garetien')) !== null);

// Series and containing product are searchable.
assert(avesmapsCalculateSearchScore($byId['adv-2'], avesmapsNormalizeSearchText('phileasson')) !== null);
assert(avesmapsCalculateSearchScore($byId['adv-3'], avesmapsNormalizeSearchText('abenteuer in gareth')) !== null);

// 💣 THE SPOILER RULE. adv-1 plays in Havena (role='play'), and that must appear NOWHERE: not in the
// search texts, not in the place, not in the type line. The fetch never selects a play row, so the
// builder never sees one -- this asserts the builder does not invent one either.
$haystack = implode(' | ', $byId['adv-1']['search_texts']);
assert(!str_contains(mb_strtolower($haystack), 'havena'));
assert(str_contains($haystack, 'Gareth'));
assert(str_contains($haystack, 'Die Verschwoerung von Gareth'));

// Edition sort key: DSA5 before DSA4.1 before DSA4 before DSA1, then non-DSA, then empty. Mirrors
// avesmapsAdventureEditionSortKey in js/map-features/map-features-adventures.js.
assert(avesmapsAdventureSearchEditionSortKey('DSA5') < avesmapsAdventureSearchEditionSortKey('DSA4.1'));
assert(avesmapsAdventureSearchEditionSortKey('DSA4.1') < avesmapsAdventureSearchEditionSortKey('DSA4'));
assert(avesmapsAdventureSearchEditionSortKey('DSA4 Basis') === avesmapsAdventureSearchEditionSortKey('DSA4'));
assert(avesmapsAdventureSearchEditionSortKey('DSA1-Ausbau') === -1.0);
assert(avesmapsAdventureSearchEditionSortKey('Aventuria 2.0') === 1000.0);
assert(avesmapsAdventureSearchEditionSortKey('') === 1001.0);

// An empty title is not an adventure.
assert(avesmapsBuildAdventureSearchEntries([['public_id' => 'x', 'title' => '   ']], $labels) === []);

echo "adventure-search: OK\n";
```

- [ ] **Step 2: Test laufen lassen — er muss FEHLSCHLAGEN**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/adventure-search-test.php
```

Erwartung: `Failed opening required '.../adventure-search.php'`

- [ ] **Step 3: Die Bibliothek schreiben**

`api/_internal/app/adventure-search.php`:

```php
<?php

declare(strict_types=1);

// Adventures as a search source. An adventure has NO geometry of its own -- it inherits its position
// from the place it BEGINS at, exactly like a Kartensammlung map inherits the place it is assigned to.
// Design: docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md
//
// 💣 ONLY role='start' places are read here, and that is the SPOILER RULE, not an optimisation.
// "beginnt hier" is spoiler-free, "spielt hier" is the spoiler -- the infopanel already enforces that
// with a veil (avesmapsSpoilerVeilMarkup). A search row has no veil: it appears unasked while somebody
// types something else. The only version that cannot leak is the one that never learns the play
// location. Measured cost, live 2026-08-02: 4 adventures have ONLY play places and 80 more have a
// resolved play place but no resolved start place -- 84 of 1352 lose their jump target, none loses its
// findability.
//
// The building function is PURE (rows in, entries out) so it is testable without a database.

// Mirrors avesmapsAdventureProductTypeLabel in js/map-features/map-features-adventures.js, PLUS
// kampagnenband (27 live) and metaband (5 live), which are missing there and fall back to the raw key.
// Both key and label are searchable: the payload carries 'gruppenabenteuer', a human types
// "Gruppenabenteuer" -- matching only the key fails silently on every capitalised or umlaut-bearing
// label (same trap the Kartensammlung hit with 'uebersicht' / "Übersicht").
const AVESMAPS_ADVENTURE_SEARCH_TYPE_LABELS = [
    'gruppenabenteuer' => 'Gruppenabenteuer',
    'soloabenteuer' => 'Soloabenteuer',
    'kurzabenteuer' => 'Kurzabenteuer',
    'szenario' => 'Szenario',
    'anthologie' => 'Anthologie',
    'kampagne' => 'Kampagne',
    'kampagnenband' => 'Kampagnenband',
    'metaband' => 'Metaband',
];

/**
 * One row per approved adventure, with its FIRST approved role='start' place.
 *
 * The correlated subquery picks exactly one place per adventure, so no GROUP BY and no N+1 -- this
 * runs on a public, per-keystroke path.
 *
 * 💣 The join condition carries `role = 'start'`. Dropping it would silently turn every play location
 * into a searchable, jumpable, printable fact.
 *
 * contained_in is a self-healing column added by adventures.php; if a deployment ever lacks it the
 * query throws and this returns [] -- the adventure section disappears, the search does not 500.
 */
function avesmapsFetchAdventureSearchRows(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT a.public_id,
                    a.title,
                    a.product_type,
                    COALESCE(a.edition, '') AS edition,
                    COALESCE(a.genre, '') AS genre,
                    COALESCE(a.series, '') AS series,
                    COALESCE(a.contained_in, '') AS contained_in,
                    COALESCE(p.raw_name, '') AS place_name,
                    COALESCE(p.target_kind, 'unresolved') AS place_kind,
                    p.target_public_id AS place_public_id
             FROM adventure a
             LEFT JOIN adventure_place p ON p.id = (
                 SELECT p2.id FROM adventure_place p2
                 WHERE p2.adventure_id = a.id AND p2.status = 'approved' AND p2.role = 'start'
                 ORDER BY p2.sort_order ASC, p2.id ASC LIMIT 1
             )
             WHERE a.status = 'approved'"
        );
    } catch (Throwable) {
        return []; // table missing (never synced) -> no adventures in the search, not a 500
    }

    return $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
}

/**
 * PURE. Builds search entries from rows.
 *
 * The place travels with its KIND and is NOT resolved here -- adventures hang on the same four kinds
 * of place as maps (settlement|territory|region|path) and the client looks them up with ITS own
 * vocabulary (location|region|label|path), a mapping only it knows and only it can check against what
 * is loaded right now. All this function can honestly say is whether the database resolved the start
 * place at all.
 *
 * @param array<string, string> $typeLabels product_type => German label
 * @return list<array<string, mixed>>
 */
function avesmapsBuildAdventureSearchEntries(array $rows, array $typeLabels): array {
    $entries = [];
    foreach ($rows as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }

        $productType = (string) ($row['product_type'] ?? '');
        $typeLabel = $typeLabels[$productType] ?? $productType;
        $edition = trim((string) ($row['edition'] ?? ''));
        $placeName = trim((string) ($row['place_name'] ?? ''));
        $placeKind = (string) ($row['place_kind'] ?? 'unresolved');
        $placePublicId = (string) ($row['place_public_id'] ?? '');
        $unresolved = $placePublicId === '' || $placeKind === 'unresolved';

        // The type line carries product type AND edition. 29 titles are handed out more than once
        // ("Silvanas Befreiung" 3x, "Zukunft im Sand" 3x) -- without the edition two hits read as one
        // duplicated row. The PLACE is deliberately not in here: it goes into the client's hint line
        // as "beginnt in <Ort>", where the wording carries the spoiler-free role.
        $typeLabelParts = array_values(array_filter([$typeLabel, $edition]));

        $entries[] = [
            'kind' => 'adventure',
            'public_id' => (string) ($row['public_id'] ?? ''),
            'public_ids' => [(string) ($row['public_id'] ?? '')],
            'name' => $title,
            'type_label' => implode(' · ', $typeLabelParts),
            'feature_subtype' => 'adventure',
            'edition_sort_key' => avesmapsAdventureSearchEditionSortKey($edition),
            'place_public_id' => $unresolved ? '' : $placePublicId,
            'place_kind' => $placeKind,
            'place_name' => $placeName,
            'not_on_map' => true,
            'unresolved' => $unresolved,
            'min_x' => 0.0,
            'min_y' => 0.0,
            'max_x' => 0.0,
            'max_y' => 0.0,
            // bf_year/bf_label/isbn stay out: filled on 6 and 0 of 1352 rows respectively, because
            // {{Infobox Produkt}} carries neither. complexity_*/fshop_code/link_* are not words anyone
            // types into a map search.
            'search_texts' => array_values(array_filter([
                $title,
                (string) ($row['series'] ?? ''),
                (string) ($row['contained_in'] ?? ''),
                $productType,
                $typeLabel,
                (string) ($row['genre'] ?? ''),
                $edition,
                $placeName,
            ])),
        ];
    }

    return $entries;
}

/**
 * Sort key for the DSA edition so "newest first" runs DSA5 > DSA4.1 > DSA4 > ... > DSA1, then non-DSA
 * rulesets, then no edition. Ascending sort of this key yields that order.
 *
 * Mirrors avesmapsAdventureEditionSortKey in js/map-features/map-features-adventures.js on purpose:
 * the search and the adventure dialog must order the same catalogue the same way. bf_year is NOT an
 * alternative -- it is filled on 6 of 1352 rows.
 */
function avesmapsAdventureSearchEditionSortKey(string $edition): float {
    $edition = trim($edition);
    if ($edition === '') {
        return 1001.0;
    }
    if (preg_match('/DSA\s*(\d+(?:\.\d+)?)/i', $edition, $matches) === 1) {
        return -1.0 * (float) $matches[1];
    }

    return 1000.0;
}
```

- [ ] **Step 4: Test laufen lassen — jetzt GRÜN**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/adventure-search-test.php
```

Erwartung: `adventure-search: OK`

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/adventure-search.php api/_internal/app/__tests__/adventure-search-test.php
git commit -m "feat(search): adventures become a search source that only ever knows where they begin"
```

---

### Task 2: Vorkommen als Suchquelle (Bibliothek)

**Files:**
- Create: `api/_internal/app/lore-search.php`
- Create: `api/_internal/app/__tests__/lore-search-test.php`

**Interfaces:**
- Consumes: `avesmapsCalculateSearchScore`, `avesmapsNormalizeSearchText` aus `map-search-scoring.php`
- Produces:
  - `AVESMAPS_LORE_SEARCH_KINDS` — `['flora', 'fauna', 'spezies', 'ware']`
  - `AVESMAPS_LORE_SEARCH_KIND_LABELS` — `kind => deutsche Beschriftung`
  - `avesmapsLoreSearchEnabledKinds(PDO $pdo): array` — DDL-frei
  - `avesmapsFetchLoreSearchRows(PDO $pdo, array $enabledKinds): array` — `['entries' => …, 'places_by_entry' => …]`
  - `avesmapsBuildLoreSearchEntries(array $entryRows, array $placesByEntry, array $kindLabels): array` — **rein**
  - `avesmapsLoreSearchStripWikiMarkup(string $value): string`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`api/_internal/app/__tests__/lore-search-test.php`:

```php
<?php

declare(strict_types=1);

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../map-search-scoring.php';
require_once __DIR__ . '/../lore-search.php';

$labels = AVESMAPS_LORE_SEARCH_KIND_LABELS;

// Wiki markup in gruppe/typ is real: live values are "[[Fisch]]", "[[Parfüm]]", "profan".
assert(avesmapsLoreSearchStripWikiMarkup('[[Fisch]]') === 'Fisch');
assert(avesmapsLoreSearchStripWikiMarkup('[[Seite|Anzeige]]') === 'Anzeige');
assert(avesmapsLoreSearchStripWikiMarkup('profan') === 'profan');
assert(avesmapsLoreSearchStripWikiMarkup('') === '');

// Modelled on real rows (live 2026-08-02), not invented.
$entryRows = [
    ['wiki_key' => 'alraune', 'kind' => 'flora', 'name' => 'Alraune', 'gruppe' => '', 'typ' => ''],
    ['wiki_key' => 'aal', 'kind' => 'fauna', 'name' => 'Aal', 'gruppe' => '[[Fisch]]', 'typ' => ''],
    ['wiki_key' => '1001-rausch-parfum', 'kind' => 'ware', 'name' => '1001 Rausch', 'gruppe' => 'profan', 'typ' => '[[Parfuem]]'],
    ['wiki_key' => 'kein-ort', 'kind' => 'ware', 'name' => 'Ortlose Ware', 'gruppe' => 'profan', 'typ' => ''],
];
$placesByEntry = [
    'alraune' => [
        ['title' => 'Aventurien', 'wiki_key' => 'aventurien'],
        ['title' => 'Khôm', 'wiki_key' => 'kh-m'],
        ['title' => 'Nebelmoor', 'wiki_key' => 'nebelmoor'],
        ['title' => 'Myranor', 'wiki_key' => 'myranor'],
    ],
    'aal' => [
        ['title' => 'Meer der Sieben Winde', 'wiki_key' => 'meer-der-sieben-winde'],
    ],
    '1001-rausch-parfum' => [
        ['title' => 'Belhanka', 'wiki_key' => 'belhanka'],
    ],
];

$entries = avesmapsBuildLoreSearchEntries($entryRows, $placesByEntry, $labels);
assert(count($entries) === 4);

$byId = [];
foreach ($entries as $entry) {
    $byId[$entry['public_id']] = $entry;
}

// A lore entry has no public id of its own -- its wiki_key IS its identity (AGENTS.md §5).
assert($byId['alraune']['kind'] === 'lore');
assert($byId['alraune']['type_label'] === 'Flora');
assert($byId['aal']['type_label'] === 'Fauna');
assert($byId['1001-rausch-parfum']['type_label'] === 'Ware');

// The places travel UNRESOLVED, title and wiki key both: lore_place stores no target_kind and no
// target_public_id at all (design §1.6), so the client is the only side that can resolve them.
assert($byId['alraune']['place_count'] === 4);
assert($byId['alraune']['lore_places'][1]['title'] === 'Khôm');
assert($byId['alraune']['lore_places'][1]['wiki_key'] === 'kh-m');
assert($byId['kein-ort']['place_count'] === 0);
assert($byId['kein-ort']['lore_places'] === []);

// Place titles are search texts -- that is the whole point of the reverse direction: "wo gibt es das?"
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('nebelmoor')) !== null);
assert(avesmapsCalculateSearchScore($byId['aal'], avesmapsNormalizeSearchText('meer winde')) !== null);

// Name, kind label and kind key all match.
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('alraune')) !== null);
assert(avesmapsCalculateSearchScore($byId['alraune'], avesmapsNormalizeSearchText('flora')) !== null);

// 💣 The wiki brackets must be GONE from the search texts. With them, "[[fisch]]" is a search text in
// its own right and a reader who typed "fisch" gets a row whose connection is invisible.
$haystack = implode(' | ', $byId['aal']['search_texts']);
assert(str_contains($haystack, 'Fisch'));
assert(!str_contains($haystack, '[['));
assert(avesmapsCalculateSearchScore($byId['aal'], avesmapsNormalizeSearchText('fisch')) !== null);
assert(avesmapsCalculateSearchScore($byId['1001-rausch-parfum'], avesmapsNormalizeSearchText('parfuem')) !== null);

// The raw wiki_key is NOT a search text: it is a join key, and "1001-rausch-parfum" is not a word
// anyone types. lebensraum and continent stay out too (78 of 500 / thin).
assert(!in_array('1001-rausch-parfum', $byId['1001-rausch-parfum']['search_texts'], true));
assert(!in_array('', $byId['alraune']['search_texts'], true));

// A row without a name or without a key is not an entry.
assert(avesmapsBuildLoreSearchEntries([['wiki_key' => 'x', 'kind' => 'flora', 'name' => '  ']], [], $labels) === []);
assert(avesmapsBuildLoreSearchEntries([['wiki_key' => '', 'kind' => 'flora', 'name' => 'X']], [], $labels) === []);

// 💣 The kind switch is PER KIND and its default differs: spezies is OFF unless switched on, the other
// three are ON unless switched off (avesmapsLoreKindDefaultEnabled).
assert(AVESMAPS_LORE_SEARCH_KINDS === ['flora', 'fauna', 'spezies', 'ware']);
assert(avesmapsLoreSearchKindDefaultEnabled('flora') === true);
assert(avesmapsLoreSearchKindDefaultEnabled('ware') === true);
assert(avesmapsLoreSearchKindDefaultEnabled('spezies') === false);
assert(avesmapsLoreSearchSettingKey('fauna') === 'lore_kind_fauna_enabled');

// Reading a stored value: '' means "never written" -> default, '0' means off, anything else on.
assert(avesmapsLoreSearchKindIsEnabled('spezies', '') === false);
assert(avesmapsLoreSearchKindIsEnabled('spezies', '1') === true);
assert(avesmapsLoreSearchKindIsEnabled('flora', '') === true);
assert(avesmapsLoreSearchKindIsEnabled('flora', '0') === false);

echo "lore-search: OK\n";
```

- [ ] **Step 2: Test laufen lassen — er muss FEHLSCHLAGEN**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/lore-search-test.php
```

Erwartung: `Failed opening required '.../lore-search.php'`

- [ ] **Step 3: Die Bibliothek schreiben**

`api/_internal/app/lore-search.php`:

```php
<?php

declare(strict_types=1);

// Vorkommen (Flora/Fauna/Spezies/Waren) as a search source. Design:
// docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md
//
// 💣 A lore place has NO resolved target. Unlike citymap_place and adventure_place, lore_place stores
// only place_wiki_key + place_title (design §1.6) -- the join to a map object happens at READ time via
// the object's wiki key. So this file ships both strings unresolved and the CLIENT resolves them: it
// holds every loaded object together with its wiki key, and it is the only side that knows what is on
// the map right now.
//
// 💣 This file deliberately does NOT require api/_internal/app/lore.php. avesmapsLoreReadCatalog opens
// with avesmapsLoreEnsureContinentColumn (an ALTER TABLE probe) and avesmapsLoreKindEnabled reads
// through avesmapsAppSettingGet (a CREATE TABLE IF NOT EXISTS per call, four calls per request). On a
// keystroke-debounced public path that is precisely the DDL load AGENTS.md §10 blames for the
// 2026-07-17 PHP-worker-pool exhaustion. The tables and the switch semantics are mirrored here instead
// -- the same choice citymap-search.php made with the citymap type table.
//
// The building function is PURE (rows in, entries out) so it is testable without a database.

// Mirrors AVESMAPS_LORE_KINDS in api/_internal/app/lore.php.
const AVESMAPS_LORE_SEARCH_KINDS = ['flora', 'fauna', 'spezies', 'ware'];

// Mirrors AVESMAPS_LORE_DIALOG_LABELS in js/map-features/map-features-lore.js. Singular here, because
// a search row names ONE occurrence -- the dialog headings are plural for a list.
const AVESMAPS_LORE_SEARCH_KIND_LABELS = [
    'flora' => 'Flora',
    'fauna' => 'Fauna',
    'spezies' => 'Spezies',
    'ware' => 'Ware',
];

/** Mirrors avesmapsLoreKindSettingKey in api/_internal/app/lore.php. */
function avesmapsLoreSearchSettingKey(string $kind): string {
    return 'lore_kind_' . $kind . '_enabled';
}

/** Mirrors avesmapsLoreKindDefaultEnabled: everything is on by default EXCEPT spezies. */
function avesmapsLoreSearchKindDefaultEnabled(string $kind): bool {
    return $kind !== 'spezies';
}

/** '' = never written -> the kind's own default; '0' = off; anything else = on. */
function avesmapsLoreSearchKindIsEnabled(string $kind, string $storedValue): bool {
    $storedValue = trim($storedValue);

    return $storedValue === '' ? avesmapsLoreSearchKindDefaultEnabled($kind) : $storedValue !== '0';
}

/**
 * The kinds the search may show, read WITHOUT the self-healing DDL and in ONE query.
 *
 * 💣 Not avesmapsLoreEnabledKinds(): it calls avesmapsLoreKindEnabled four times, each of which runs
 * `CREATE TABLE IF NOT EXISTS app_setting` through avesmapsAppSettingGet. Four DDL statements per
 * keystroke. A missing app_setting table means nobody ever switched anything -> all defaults.
 *
 * @return list<string>
 */
function avesmapsLoreSearchEnabledKinds(PDO $pdo): array {
    $settingKeys = [];
    foreach (AVESMAPS_LORE_SEARCH_KINDS as $kind) {
        $settingKeys[avesmapsLoreSearchSettingKey($kind)] = $kind;
    }

    $stored = [];
    try {
        $placeholders = implode(',', array_fill(0, count($settingKeys), '?'));
        $statement = $pdo->prepare(
            'SELECT setting_key, setting_value FROM app_setting WHERE setting_key IN (' . $placeholders . ')'
        );
        $statement->execute(array_keys($settingKeys));
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $stored[(string) $row['setting_key']] = (string) $row['setting_value'];
        }
    } catch (PDOException) {
        $stored = [];
    }

    $enabled = [];
    foreach ($settingKeys as $settingKey => $kind) {
        if (avesmapsLoreSearchKindIsEnabled($kind, $stored[$settingKey] ?? '')) {
            $enabled[] = $kind;
        }
    }

    return $enabled;
}

/**
 * Entries of the enabled kinds plus their places, in TWO queries -- never one per entry.
 *
 * The place query is deliberately unjoined: lore_place carries the entry key, so grouping in PHP costs
 * one pass and avoids a cross-table collation comparison (the trap feature_sources hit, see the note in
 * avesmapsLoreReadCatalog). Places of a disabled kind are fetched and then simply never attached.
 *
 * @param list<string> $enabledKinds
 * @return array{entries: list<array<string, mixed>>, places_by_entry: array<string, list<array{title: string, wiki_key: string}>>}
 */
function avesmapsFetchLoreSearchRows(PDO $pdo, array $enabledKinds): array {
    $empty = ['entries' => [], 'places_by_entry' => []];
    $enabledKinds = array_values(array_filter($enabledKinds, static fn (string $k): bool => $k !== ''));
    if ($enabledKinds === []) {
        return $empty;
    }

    try {
        $placeholders = implode(',', array_fill(0, count($enabledKinds), '?'));
        $statement = $pdo->prepare(
            "SELECT wiki_key, kind, name, COALESCE(gruppe, '') AS gruppe, COALESCE(typ, '') AS typ
             FROM lore_entry
             WHERE status = 'active' AND kind IN (" . $placeholders . ')'
        );
        $statement->execute($enabledKinds);
        $entries = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $placeStatement = $pdo->query(
            "SELECT entry_wiki_key, place_wiki_key, place_title
             FROM lore_place
             WHERE status = 'active'
             ORDER BY entry_wiki_key ASC, sort_order ASC"
        );
        $placeRows = $placeStatement !== false ? $placeStatement->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable) {
        return $empty; // tables missing (never synced) -> no occurrences in the search, not a 500
    }

    $placesByEntry = [];
    foreach ($placeRows as $row) {
        $placesByEntry[(string) $row['entry_wiki_key']][] = [
            'title' => (string) $row['place_title'],
            'wiki_key' => (string) $row['place_wiki_key'],
        ];
    }

    return ['entries' => $entries, 'places_by_entry' => $placesByEntry];
}

/**
 * "[[Fisch]]" -> "Fisch", "[[Seite|Anzeige]]" -> "Anzeige".
 *
 * gruppe and typ carry raw wiki links. Left in, the brackets become part of a search text nobody can
 * see in the UI, and a hit on "parfuem" looks unexplained.
 */
function avesmapsLoreSearchStripWikiMarkup(string $value): string {
    $stripped = preg_replace('/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/u', '$1', $value);

    return trim(str_replace(['[', ']'], '', $stripped ?? $value));
}

/**
 * PURE. Builds search entries from entry rows plus their places.
 *
 * @param array<string, list<array{title: string, wiki_key: string}>> $placesByEntry
 * @param array<string, string> $kindLabels
 * @return list<array<string, mixed>>
 */
function avesmapsBuildLoreSearchEntries(array $entryRows, array $placesByEntry, array $kindLabels): array {
    $entries = [];
    foreach ($entryRows as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
        if ($name === '' || $wikiKey === '') {
            continue;
        }

        $kind = (string) ($row['kind'] ?? '');
        $kindLabel = $kindLabels[$kind] ?? $kind;
        $places = $placesByEntry[$wikiKey] ?? [];
        $placeTitles = [];
        foreach ($places as $place) {
            $title = trim((string) ($place['title'] ?? ''));
            if ($title !== '') {
                $placeTitles[] = $title;
            }
        }

        $entries[] = [
            'kind' => 'lore',
            // A lore entry has no public id -- its wiki_key IS its identity (AGENTS.md §5).
            'public_id' => $wikiKey,
            'public_ids' => [$wikiKey],
            'name' => $name,
            'type_label' => $kindLabel,
            'feature_subtype' => $kind,
            // Unresolved on purpose: title AND wiki key travel, the client picks the map object.
            'lore_places' => $places,
            'place_count' => count($places),
            'not_on_map' => true,
            'min_x' => 0.0,
            'min_y' => 0.0,
            'max_x' => 0.0,
            'max_y' => 0.0,
            // lebensraum (78 of 500) and continent stay out: too thin to pay for the noise against
            // name, kind, group and the place list.
            'search_texts' => array_values(array_filter(array_merge(
                [
                    $name,
                    $kindLabel,
                    $kind,
                    avesmapsLoreSearchStripWikiMarkup((string) ($row['gruppe'] ?? '')),
                    avesmapsLoreSearchStripWikiMarkup((string) ($row['typ'] ?? '')),
                ],
                $placeTitles
            ))),
        ];
    }

    return $entries;
}
```

- [ ] **Step 4: Test laufen lassen — jetzt GRÜN**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/lore-search-test.php
```

Erwartung: `lore-search: OK`

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/lore-search.php api/_internal/app/__tests__/lore-search-test.php
git commit -m "feat(search): occurrences become a search source that ships its places unresolved"
```

---

### Task 3: Beide Quellen in den Endpunkt einhängen

Der Endpunkt bekommt einen **gemeinsamen** Sektions-Sammler, damit die Deckelung genau einmal existiert statt dreimal.

**Files:**
- Modify: `api/app/map-search.php`

**Interfaces:**
- Consumes: alles aus Task 1 und Task 2
- Produces: Treffer mit `kind: "adventure"` (`adventure_total`) und `kind: "lore"` (`lore_total`, `lore_places`, `place_count`) im `results`-Array, je auf 5 gedeckelt

- [ ] **Step 1: Die neuen Bibliotheken requiren und die Deckel definieren**

In `api/app/map-search.php` nach `require_once __DIR__ . '/../_internal/app/citymap-search.php';` ergänzen:

```php
require_once __DIR__ . '/../_internal/app/adventure-search.php';
require_once __DIR__ . '/../_internal/app/lore-search.php';
```

Und neben `AVESMAPS_CITYMAP_SEARCH_LIMIT`:

```php
// Same cap, same reason: "abenteuer" is inside 1040 of 1352 adventure entries and would fill the whole
// list on its own. Occurrences get the same treatment for symmetry -- and because 5104 entries dwarf
// everything else in the payload.
const AVESMAPS_ADVENTURE_SEARCH_LIMIT = 5;
const AVESMAPS_LORE_SEARCH_LIMIT = 5;
```

- [ ] **Step 2: Die Quellen laden, beide Not-Aus DDL-frei**

Nach der Zeile `$citymapRows = $citymapsEnabled ? avesmapsFetchCitymapSearchRows($pdo) : [];` ergänzen:

```php
    // Fifth source: adventures. Same DDL-free read of the kill switch as the Kartensammlung above --
    // avesmapsAdventuresEnabled() would run CREATE TABLE IF NOT EXISTS app_setting per keystroke.
    $adventuresEnabled = avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_ADVENTURES_SETTING, '1') !== '0';
    $adventureRows = $adventuresEnabled ? avesmapsFetchAdventureSearchRows($pdo) : [];
    // Sixth source: occurrences. 💣 The switch here is PER KIND, not global -- 'spezies' is off by
    // default and off live (187 entries the search must not show).
    $loreRows = avesmapsFetchLoreSearchRows($pdo, avesmapsLoreSearchEnabledKinds($pdo));
```

`AVESMAPS_ADVENTURES_SETTING` lebt in `api/_internal/app/adventures.php`. Diese Datei **nicht** requiren (sie zieht die halbe Abenteuer-Bibliothek mit); stattdessen den Schlüssel im Endpunkt neben den Deckeln definieren:

```php
// Mirrors AVESMAPS_ADVENTURES_SETTING in api/_internal/app/adventures.php. Duplicated rather than
// required: that file carries the whole adventure catalogue, cover engine and DDL, and this endpoint
// needs one string.
const AVESMAPS_ADVENTURE_SEARCH_SETTING = 'adventures_enabled';
```

und in der Zeile darüber `AVESMAPS_ADVENTURES_SETTING` durch `AVESMAPS_ADVENTURE_SEARCH_SETTING` ersetzen.

- [ ] **Step 3: Den Aufruf erweitern**

```php
    $results = avesmapsBuildMapSearchResults($rows, $politicalRows, $query, $limit, $inSettlementRows, $pdo, $citymapRows, $adventureRows, $loreRows);
```

und die Signatur:

```php
function avesmapsBuildMapSearchResults(
    array $rows,
    array $politicalRows,
    string $query,
    int $limit,
    array $inSettlementRows = [],
    ?PDO $pdo = null,
    array $citymapRows = [],
    array $adventureRows = [],
    array $loreRows = ['entries' => [], 'places_by_entry' => []]
): array {
```

- [ ] **Step 4: Den gemeinsamen Sektions-Sammler einführen**

Den Block von `$citymapResults = [];` bis einschließlich `$citymapResults = array_slice($citymapResults, 0, AVESMAPS_CITYMAP_SEARCH_LIMIT);` **ersetzen** durch:

```php
    // Section sources are collected SEPARATELY from the map objects and capped, then appended. A single
    // generic word would otherwise fill all 20 slots and push out the actual map objects: "stadtplan"
    // is in 331 of 455 map titles, "abenteuer" in 1040 of 1352 adventures. The cap is what makes these
    // sources safe to ship at all.
    [$citymapResults, $citymapTotal] = avesmapsCollectSearchSection(
        avesmapsBuildCitymapSearchEntries($citymapRows, AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS),
        $normalizedQuery,
        static function (array $left, array $right): int {
            // Maps with a resolved place first: a hit that does nothing when clicked belongs at the bottom.
            $resolvedDiff = ((int) $left['unresolved']) <=> ((int) $right['unresolved']);
            if ($resolvedDiff !== 0) {
                return $resolvedDiff;
            }
            $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
            return $scoreDiff !== 0 ? $scoreDiff : strnatcasecmp((string) $left['name'], (string) $right['name']);
        },
        AVESMAPS_CITYMAP_SEARCH_LIMIT
    );

    [$adventureResults, $adventureTotal] = avesmapsCollectSearchSection(
        avesmapsBuildAdventureSearchEntries($adventureRows, AVESMAPS_ADVENTURE_SEARCH_TYPE_LABELS),
        $normalizedQuery,
        static function (array $left, array $right): int {
            $resolvedDiff = ((int) $left['unresolved']) <=> ((int) $right['unresolved']);
            if ($resolvedDiff !== 0) {
                return $resolvedDiff;
            }
            $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
            if ($scoreDiff !== 0) {
                return $scoreDiff;
            }
            // Newest edition first -- the same order the adventure dialog uses. With 1040 equally
            // scored hits behind a word like "abenteuer", this tie-break alone decides which five a
            // reader ever sees; without it they would be five arbitrary rows.
            $editionDiff = ((float) $left['edition_sort_key']) <=> ((float) $right['edition_sort_key']);
            return $editionDiff !== 0 ? $editionDiff : strnatcasecmp((string) $left['name'], (string) $right['name']);
        },
        AVESMAPS_ADVENTURE_SEARCH_LIMIT
    );

    [$loreResults, $loreTotal] = avesmapsCollectSearchSection(
        avesmapsBuildLoreSearchEntries(
            $loreRows['entries'] ?? [],
            $loreRows['places_by_entry'] ?? [],
            AVESMAPS_LORE_SEARCH_KIND_LABELS
        ),
        $normalizedQuery,
        static function (array $left, array $right): int {
            // 31 % of occurrences carry no place at all (design §1.4). They stay findable -- being told
            // the thing exists beats hiding it -- but they never take a slot from one that can be shown.
            $placedDiff = ((int) (((int) $left['place_count']) === 0)) <=> ((int) (((int) $right['place_count']) === 0));
            if ($placedDiff !== 0) {
                return $placedDiff;
            }
            $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
            return $scoreDiff !== 0 ? $scoreDiff : strnatcasecmp((string) $left['name'], (string) $right['name']);
        },
        AVESMAPS_LORE_SEARCH_LIMIT
    );
```

- [ ] **Step 5: Den Sammler als Funktion ergänzen**

Direkt vor `function avesmapsBuildSearchEntry(array $row): ?array {` einfügen:

```php
/**
 * Score, sort and cap ONE section source.
 *
 * Exists so the cap lives in exactly one place: three copies of "score, usort, count, array_slice" is
 * three chances to forget the cap on the source that needs it most.
 *
 * @param list<array<string, mixed>> $entries already-built search entries
 * @param callable(array<string, mixed>, array<string, mixed>): int $tieBreak full comparator, score included
 * @return array{0: list<array<string, mixed>>, 1: int} the capped list and the total BEFORE capping
 */
function avesmapsCollectSearchSection(array $entries, string $normalizedQuery, callable $tieBreak, int $limit): array {
    $matches = [];
    foreach ($entries as $entry) {
        $score = avesmapsCalculateSearchScore($entry, $normalizedQuery);
        if ($score === null) {
            continue;
        }
        $entry['score'] = $score;
        $matches[] = $entry;
    }

    usort($matches, $tieBreak);

    return [array_slice($matches, 0, $limit), count($matches)];
}
```

- [ ] **Step 6: Die drei Sektionen anhängen**

Den Block

```php
    foreach ($citymapResults as $entry) {
        unset($entry['score'], $entry['search_texts']);
        $entry['citymap_total'] = $citymapTotal;
        $mapped[] = $entry;
    }
```

ersetzen durch:

```php
    // Order here IS the order of the sections in the result list; the client renders them in the same
    // sequence (SPOTLIGHT_SEARCH_SECTIONS in js/ui/spotlight-search.js).
    $sections = [
        [$citymapResults, 'citymap_total', $citymapTotal],
        [$adventureResults, 'adventure_total', $adventureTotal],
        [$loreResults, 'lore_total', $loreTotal],
    ];
    foreach ($sections as [$sectionResults, $totalField, $sectionTotal]) {
        foreach ($sectionResults as $entry) {
            // edition_sort_key is a sorting aid, not payload -- it would be dead weight on every row.
            unset($entry['score'], $entry['search_texts'], $entry['edition_sort_key']);
            $entry[$totalField] = $sectionTotal;
            $mapped[] = $entry;
        }
    }
```

- [ ] **Step 7: Syntax prüfen und beide reinen Tests erneut laufen lassen**

```bash
php -l api/app/map-search.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/map-search-scoring-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-search-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/adventure-search-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/lore-search-test.php
```

Erwartung: `No syntax errors detected` und viermal `OK`. Der Endpunkt selbst braucht eine DB und wird erst in Task 8 geprüft.

- [ ] **Step 8: Commit**

```bash
git add api/app/map-search.php
git commit -m "feat(search): adventures and occurrences join as capped fifth and sixth sources"
```

---

### Task 4: Client — die Abschnitts-Mechanik verallgemeinern

Reiner Umbau, **kein neues Verhalten**. Er existiert, damit Task 5 und 6 nicht dieselbe if-Kette ein zweites und drittes Mal schreiben — und die dritte Kopie ist die, bei der eine Stelle vergessen wird (Entwurf §6, Falle 4).

**Files:**
- Modify: `js/ui/spotlight-search.js`
- Modify: `js/ui/spotlight-search-focus.js`
- Modify: `js/ui/__tests__/spotlight-scoring.test.js`

**Interfaces:**
- Produces: `SPOTLIGHT_SEARCH_SECTIONS` · `SPOTLIGHT_SECTION_KINDS` · `spotlightPlaceLookupKeys(placeKind, publicId): string[]` · `buildPlaceBoundSpotlightEntry(result, kind): object|null` · `focusSpotlightPlaceEntry(entry): void`

- [ ] **Step 1: Die Abschnitts-Liste anlegen**

In `js/ui/spotlight-search.js` den Block `SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER` (Zeile 4-12) ersetzen durch:

```javascript
const SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER = {
	location: 0,
	label: 1,
	region: 2,
	path: 3,
	powerline: 4,
	// None of these are map objects -- each is a pointer to one. Last, like the in-settlement objects.
	citymap: 6,
	adventure: 7,
	lore: 8,
};
// Sources that live NEXT to the map rather than on it. Each gets its own heading with a total, its own
// cap of 5 (enforced server-side) and sits OUTSIDE the 20-result limit -- counting them against the
// shared limit would let them displace exactly the map objects the cap exists to protect.
// The order of this array IS the order of the sections in the result list, and it matches the order
// api/app/map-search.php appends them in.
const SPOTLIGHT_SEARCH_SECTIONS = [
	{ kind: "citymap", totalField: "citymapTotal", labelKey: "spotlight.citymaps", label: "Kartensammlung", moreKey: "spotlight.citymapsMore", more: "… und {n} weitere Karten" },
	{ kind: "adventure", totalField: "adventureTotal", labelKey: "spotlight.adventures", label: "Abenteuer", moreKey: "spotlight.adventuresMore", more: "… und {n} weitere Abenteuer" },
	{ kind: "lore", totalField: "loreTotal", labelKey: "spotlight.lore", label: "Vorkommen", moreKey: "spotlight.loreMore", more: "… und {n} weitere Vorkommen" },
];
const SPOTLIGHT_SECTION_KINDS = new Set(SPOTLIGHT_SEARCH_SECTIONS.map((section) => section.kind));
```

- [ ] **Step 2: Die Ortsart-Übersetzung und den Eintragsbauer entkoppeln**

`spotlightCitymapPlaceLookupKeys` (Zeile 358-370) umbenennen — Kommentar anpassen, Logik unverändert:

```javascript
// The place kinds these sources store (settlement|territory|region|path) are NOT the kinds this file
// looks entries up by (location|region|label|path). Territories and landscape regions can both arrive
// as "region", and a landscape is a label here -- so each kind gets its candidate keys and the first
// one that exists wins. Getting this wrong would mark all 59 regional maps and all 311 region-starting
// adventures "not on the map".
function spotlightPlaceLookupKeys(placeKind, publicId) {
	const prefixes = {
		settlement: ["location"],
		territory: ["region"],
		region: ["region", "label"],
		path: ["path"],
	}[String(placeKind || "")] || [];
	return prefixes.map((prefix) => `${prefix}:${publicId}`);
}
```

`buildCitymapSpotlightEntry` (Zeile 372-424) ersetzen durch:

```javascript
// A hit that has NO position of its own and rides on a place: a map from the Kartensammlung, an
// adventure at the place it begins. Modelled on buildInSettlementSpotlightEntry for the shared notOnMap
// presentation, but NOT for `kind`: that function deliberately KEEPS the inherited kind ("location") so
// the plain kind-dispatch in selectSpotlightSearchEntry just works. This entry OVERWRITES kind, because
// the result list needs it to read as its own thing in its own section. That overwrite is exactly why
// selection/focus DOES need a case here: placeEntryKind preserves the placeEntry's original kind
// (location/region/label/path) so focusSpotlightPlaceEntry knows which existing focus helper to
// delegate to -- the spread (`...base`) already carried that helper's expected fields
// (locationEntry/labelEntry/regionEntry+polygons+bounds/paths+bounds) along with it.
//
// A hit with nothing to jump to is still LISTED -- being told the thing exists is worth more than
// hiding it -- but it says so. Two independent reasons: the database never resolved the place (the
// server says so via `unresolved`; live 85 of 469 map places, 376 of 1352 adventures), or the object is
// simply not loaded right now. Either way placeEntry stays null, unreachable is true, placeEntryKind is
// "" -- focusSpotlightPlaceEntry reads unreachable and no-ops rather than guessing a target.
function buildPlaceBoundSpotlightEntry(result, kind) {
	const name = String(result.name || "");
	if (!name) {
		return null;
	}

	const publicId = String(result.place_public_id || "");
	const { byPublicId } = getSpotlightSearchLookup();
	let placeEntry = null;
	if (publicId && !result.unresolved) {
		for (const key of spotlightPlaceLookupKeys(result.place_kind, publicId)) {
			placeEntry = byPublicId.get(key);
			if (placeEntry) {
				break;
			}
		}
	}

	const base = placeEntry || { bounds: null, publicIds: [], polygons: [] };
	return {
		...base,
		id: `${kind}:${String(result.public_id || name)}`,
		kind,
		// The placeEntry's own kind, saved off before the `kind` override above shadows it.
		// "" when placeEntry is null (unreachable) -- no place was resolved to have a kind at all.
		placeEntryKind: base.kind || "",
		name,
		typeLabel: String(result.type_label || ""),
		aliases: [],
		inSettlementName: String(result.place_name || ""),
		notOnMap: true,
		unreachable: !placeEntry,
		citymapTotal: Number(result.citymap_total) || 0,
		adventureTotal: Number(result.adventure_total) || 0,
	};
}
```

- [ ] **Step 3: Den Aufruf und den 20er-Schnitt umstellen**

In `resolveBackendSpotlightEntries` die Zeilen

```javascript
		if (!entry && kind === "citymap") {
			entry = buildCitymapSpotlightEntry(result);
		}
```

ersetzen durch:

```javascript
		if (!entry && kind === "citymap") {
			entry = buildPlaceBoundSpotlightEntry(result, kind);
		}
```

und den Rückgabeblock

```javascript
	if (resolvedEntries.length) {
		const mapObjects = resolvedEntries.filter((entry) => entry.kind !== "citymap");
		const citymaps = resolvedEntries.filter((entry) => entry.kind === "citymap");
		return [...mapObjects.slice(0, SPOTLIGHT_SEARCH_MAX_RESULTS), ...citymaps];
	}
```

durch:

```javascript
	if (resolvedEntries.length) {
		// Section hits sit outside the 20-result limit on purpose: the server already capped each
		// section at 5, and counting them against the shared limit would let them displace exactly the
		// map objects the cap exists to protect.
		const sectionOrder = SPOTLIGHT_SEARCH_SECTIONS.map((section) => section.kind);
		const mapObjects = resolvedEntries.filter((entry) => !SPOTLIGHT_SECTION_KINDS.has(entry.kind));
		// Array.prototype.sort is stable, so within one section the server's own ranking survives.
		const sectionEntries = resolvedEntries
			.filter((entry) => SPOTLIGHT_SECTION_KINDS.has(entry.kind))
			.sort((left, right) => sectionOrder.indexOf(left.kind) - sectionOrder.indexOf(right.kind));
		return [...mapObjects.slice(0, SPOTLIGHT_SEARCH_MAX_RESULTS), ...sectionEntries];
	}
```

- [ ] **Step 4: Die Abschnittsköpfe datengetrieben rendern**

`renderSpotlightSearchResults` (ab Zeile 570) ersetzen durch:

```javascript
function renderSpotlightSearchResults(entries) {
	const { input, results, status } = getSpotlightSearchElements();
	if (!results || !status) {
		return;
	}

	spotlightRenderedEntries = entries;

	// Each section is set apart with a heading rather than folded into the flat list: without it a hit
	// whose title does not contain the search word reads like a bug, and the count is the only place the
	// user learns that more exist than the cap shows.
	//
	// ⚠️ Heading and overflow line carry NO data-spotlight-result-index -- otherwise the arrow-key
	// navigation counts them as hits.
	const headingAt = new Map();
	const overflowAt = new Map();
	SPOTLIGHT_SEARCH_SECTIONS.forEach((section) => {
		const indices = [];
		entries.forEach((entry, index) => {
			if (entry.kind === section.kind) {
				indices.push(index);
			}
		});
		if (!indices.length) {
			return;
		}

		const total = Number(entries[indices[0]][section.totalField]) || 0;
		headingAt.set(indices[0], `<div class="spotlight-search__section" role="presentation">
				<span>${escapeHtml(tr(section.labelKey, section.label))}</span>
				<span>${total}</span>
			</div>`);
		if (total > indices.length) {
			overflowAt.set(indices[indices.length - 1], `<div class="spotlight-search__section-more" role="presentation">${escapeHtml(
				tr(section.moreKey, section.more).replace("{n}", String(total - indices.length))
			)}</div>`);
		}
	});

	results.innerHTML = entries
		.map((entry, index) => (headingAt.get(index) || "") + spotlightResultMarkup(entry, index) + (overflowAt.get(index) || ""))
		.join("");

	results.hidden = entries.length === 0;
	status.textContent = "";
	status.hidden = true;
	setSpotlightActiveResultIndex(entries.length ? 0 : -1);

	if (input) {
		input.setAttribute("aria-expanded", entries.length ? "true" : "false");
	}
}
```

- [ ] **Step 5: Die Hinweiszeile verallgemeinern**

In `spotlightResultMarkup` den `hintText`-Block ersetzen durch:

```javascript
	// A hit that points somewhere else needs a line saying so. Three cases, three wordings:
	//   in-settlement object   -> "Innerorts" (it sits inside the town the hit jumps to)
	//   unreachable pointer    -> "kein Ort auf der Karte" (map, adventure or occurrence with no target)
	//   reachable adventure /
	//   occurrence             -> its own hint (where it begins / where it occurs), set by its builder
	// A REACHABLE map deliberately gets NO hint: its typeLabel already names type and place
	// ("Grundriss · Gareth"). "Innerorts" must never appear under a section hit -- a territory or a way
	// is not a settlement, and in this project that is domain vocabulary, not a nuance.
	const hintText = entry.unreachable
		? tr("spotlight.noPlaceOnMap", "kein Ort auf der Karte")
		: (String(entry.placeHint || "")
			|| (entry.notOnMap && !SPOTLIGHT_SECTION_KINDS.has(entry.kind) ? tr("spotlight.inSettlement", "Innerorts") : ""));
```

- [ ] **Step 6: Den Focus-Helfer umbenennen**

In `js/ui/spotlight-search-focus.js` `focusSpotlightCitymapPlace` in `focusSpotlightPlaceEntry` umbenennen (Funktionskopf **und** der Aufruf in `selectSpotlightSearchEntry`), und den Kopfkommentar auf beide Quellen erweitern — die erste Zeile

```javascript
// A citymap entry (buildCitymapSpotlightEntry in spotlight-search.js) has no geometry of its own --
```

ersetzen durch:

```javascript
// A place-bound entry (buildPlaceBoundSpotlightEntry in spotlight-search.js) has no geometry of its own --
```

und in `selectSpotlightSearchEntry`:

```javascript
	if (entry.kind === "citymap") {
		focusSpotlightPlaceEntry(entry);
		return;
	}
```

- [ ] **Step 7: Den vorhandenen Test mitziehen**

In `js/ui/__tests__/spotlight-scoring.test.js` beide Vorkommen von `spotlightCitymapPlaceLookupKeys` durch `spotlightPlaceLookupKeys` ersetzen (Zeile 24 in der `vm.runInNewContext`-Zeile und Zeile 67 in der `keys`-Hilfsfunktion). **Die Zusicherungen bleiben unverändert** — der Test wird umbenannt, nicht geschwächt.

- [ ] **Step 8: Syntax prüfen und den Test laufen lassen**

```bash
node --check js/ui/spotlight-search.js
node --check js/ui/spotlight-search-focus.js
node js/ui/__tests__/spotlight-scoring.test.js
```

Erwartung: kein Syntaxfehler, `spotlight-scoring: OK`.

⚠️ Ein Syntaxfehler in diesen Dateien ist im Browser **stumm** — die Suche tut dann einfach nichts. `node --check` ist die einzige billige Absicherung.

- [ ] **Step 9: Commit**

```bash
git add js/ui/spotlight-search.js js/ui/spotlight-search-focus.js js/ui/__tests__/spotlight-scoring.test.js
git commit -m "refactor(search): the map section becomes a list of sections, ready for two more"
```

---

### Task 5: Client — Abenteuer-Treffer annehmen

**Files:**
- Modify: `js/ui/spotlight-search.js`
- Modify: `js/ui/spotlight-search-focus.js`

**Interfaces:**
- Consumes: `buildPlaceBoundSpotlightEntry(result, kind)` und `focusSpotlightPlaceEntry(entry)` aus Task 4; Backend-Treffer mit `kind: "adventure"`, `place_public_id`, `place_kind`, `place_name`, `unresolved`, `adventure_total`

- [ ] **Step 1: Den Hinweis „beginnt in …" setzen**

In `buildPlaceBoundSpotlightEntry` (Task 4, Step 2) die Zeile `inSettlementName: String(result.place_name || ""),` ergänzen um:

```javascript
		// "beginnt in Gareth" -- the wording carries the spoiler-free role. It is composed HERE, not on
		// the server: every other visible German string in the result list lives in this file, and the
		// server has no business owning one. Only shown when the place is actually reachable.
		placeHint: placeEntry && kind === "adventure" && result.place_name
			? tr("spotlight.adventureStartsIn", "beginnt in {place}").replace("{place}", String(result.place_name))
			: "",
```

- [ ] **Step 2: Den Treffer annehmen**

In `resolveBackendSpotlightEntries` den `citymap`-Zweig erweitern:

```javascript
		if (!entry && (kind === "citymap" || kind === "adventure")) {
			entry = buildPlaceBoundSpotlightEntry(result, kind);
		}
```

- [ ] **Step 3: Den Klick verdrahten**

💣 In `selectSpotlightSearchEntry` (`js/ui/spotlight-search-focus.js`) — die if-Kette hat **kein** `default`, ein unbekannter `kind` fällt lautlos durch und der Klick tut nichts. Den Zweig aus Task 4, Step 6 erweitern:

```javascript
	if (entry.kind === "citymap" || entry.kind === "adventure") {
		focusSpotlightPlaceEntry(entry);
		return;
	}
```

- [ ] **Step 4: Syntax prüfen und den Test laufen lassen**

```bash
node --check js/ui/spotlight-search.js
node --check js/ui/spotlight-search-focus.js
node js/ui/__tests__/spotlight-scoring.test.js
```

Erwartung: kein Syntaxfehler, `spotlight-scoring: OK`.

- [ ] **Step 5: Commit**

```bash
git add js/ui/spotlight-search.js js/ui/spotlight-search-focus.js
git commit -m "feat(search): an adventure hit jumps to the place it begins at and opens its infobox"
```

---

### Task 6: Client — Vorkommen-Treffer, Ortsauflösung und Hervorhebung

**Files:**
- Modify: `js/ui/spotlight-search.js`
- Modify: `js/ui/spotlight-search-focus.js`
- Modify: `js/ui/__tests__/spotlight-scoring.test.js`

**Interfaces:**
- Consumes: Backend-Treffer mit `kind: "lore"`, `lore_places: [{title, wiki_key}]`, `place_count`, `lore_total`
- Produces: `getSpotlightEntryWikiKey(entry): string` · `resolveSpotlightLorePlace(byLorePlace, place): object|null` · `buildLoreSpotlightEntry(result): object|null` · `focusSpotlightLorePlaces(entry): void` · `highlightSpotlightPlaces(places): void` · `getSpotlightPlaceBounds(place): object|null`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `js/ui/__tests__/spotlight-scoring.test.js` **vor** der `console.log`-Zeile anhängen — und in der `vm.runInNewContext`-Zeile `+ extract("getSpotlightEntryWikiKey") + extract("resolveSpotlightLorePlace")` ergänzen:

```javascript
// ---- occurrence places resolve by wiki key, by title, and by title without qualifier -------------
// lore_place stores NO resolved target (design §1.6), only a wiki key and a title -- so this three-step
// fallback is the entire join between an occurrence and the map. "Bornland (Region)" is the case that
// makes step 3 necessary: live, that is exactly how the wiki writes it and "Bornland" is what the map
// calls it.
const wikiKey = context.getSpotlightEntryWikiKey;
const labelEntry = { kind: "label", name: "Khôm", labelEntry: { label: { wikiRegion: { wiki_key: "kh-m" } } } };
const bornland = { kind: "label", name: "Bornland", labelEntry: { label: { wikiRegion: { wiki_key: "bornland" } } } };
const village = { kind: "location", name: "Belhanka", locationEntry: { location: { wikiSettlement: { wiki_key: "belhanka" } } } };

assert.strictEqual(wikiKey(labelEntry), "kh-m");
assert.strictEqual(wikiKey(village), "belhanka");
assert.strictEqual(wikiKey({ kind: "path", name: "x" }), "");
assert.strictEqual(wikiKey({ kind: "label", name: "x" }), "");

const byLorePlace = new Map([
	["wk:kh m", labelEntry],
	["nm:khom", labelEntry],
	["nm:bornland", bornland],
	["nm:belhanka", village],
]);
const place = (title, key) => context.resolveSpotlightLorePlace(byLorePlace, { title, wiki_key: key });

assert.strictEqual(place("Khôm", "kh-m"), labelEntry);
assert.strictEqual(place("Khôm", ""), labelEntry);
assert.strictEqual(place("Belhanka", ""), village);
assert.strictEqual(place("Bornland (Region)", ""), bornland);
assert.strictEqual(place("Myranor", ""), null);
assert.strictEqual(place("", ""), null);

// An empty wiki key must never become a wildcard: without the guard, "wk:" would be a real key that
// every place without a key looks up -- and the first entry inserted would answer for all of them.
assert.strictEqual(context.resolveSpotlightLorePlace(new Map([["wk:", labelEntry]]), { title: "Myranor", wiki_key: "" }), null);
```

- [ ] **Step 2: Test laufen lassen — er muss FEHLSCHLAGEN**

```bash
node js/ui/__tests__/spotlight-scoring.test.js
```

Erwartung: `AssertionError: getSpotlightEntryWikiKey() not found in js/ui/spotlight-search.js -- renamed?`

- [ ] **Step 3: Den Lookup-Index um Vorkommens-Orte erweitern**

`getSpotlightSearchLookup` (Zeile 692-711) ersetzen durch:

```javascript
function getSpotlightSearchLookup() {
	getSpotlightSearchEntries();
	if (spotlightSearchLookupCache) {
		return spotlightSearchLookupCache;
	}

	const byPublicId = new Map();
	const byPathGroup = new Map();
	getSpotlightSearchEntries().forEach((entry) => {
		(entry.publicIds || []).forEach((publicId) => {
			byPublicId.set(`${entry.kind}:${publicId}`, entry);
		});
		if (entry.kind === "path") {
			byPathGroup.set(getSpotlightPathGroupKey(entry.name, entry.subtype), entry);
		}
	});

	// Occurrence places arrive as a wiki key plus a title and NEVER as a resolved target (design §1.6),
	// so they need a key/name index rather than the public-id one.
	// Insert order IS the precedence -- label before region before location, first writer wins. 403 of
	// 465 resolvable occurrence places are labels, so a name that is both a landscape and a village
	// means the landscape: "Thorwal" the region, not the hamlet.
	const byLorePlace = new Map();
	const addLorePlaceKey = (key, entry) => {
		if (key && !byLorePlace.has(key)) {
			byLorePlace.set(key, entry);
		}
	};
	["label", "region", "location"].forEach((placeKind) => {
		getSpotlightSearchEntries().forEach((entry) => {
			if (entry.kind !== placeKind) {
				return;
			}
			const wikiKey = normalizeSpotlightSearchText(getSpotlightEntryWikiKey(entry));
			if (wikiKey) {
				addLorePlaceKey(`wk:${wikiKey}`, entry);
			}
			const nameKey = normalizeSpotlightSearchText(entry.name);
			if (nameKey) {
				addLorePlaceKey(`nm:${nameKey}`, entry);
			}
		});
	});

	spotlightSearchLookupCache = { byPublicId, byPathGroup, byLorePlace };
	return spotlightSearchLookupCache;
}

// The wiki key a spotlight entry carries -- the join key lore_place stores on its side. Every kind
// keeps it somewhere else: a label under label.wikiRegion, a settlement under location.wikiSettlement,
// a territory on the region entry (same chain avesmapsLorePlaceRefFromRegion walks in
// js/map-features/map-features-lore.js). "" when the object has no wiki page.
function getSpotlightEntryWikiKey(entry) {
	if (entry.kind === "label") {
		return String(entry.labelEntry?.label?.wikiRegion?.wiki_key || "");
	}
	if (entry.kind === "location") {
		return String(entry.locationEntry?.location?.wikiSettlement?.wiki_key || "");
	}
	if (entry.kind === "region") {
		const regionEntry = entry.regionEntry || {};
		return String(regionEntry.detail?.wiki_key || regionEntry.wikiRegion?.wiki_key || regionEntry.wikiKey || regionEntry.wiki_key || "");
	}

	return "";
}
```

- [ ] **Step 4: Auflöser und Eintragsbauer schreiben**

Direkt nach `buildPlaceBoundSpotlightEntry` einfügen:

```javascript
// Three tries, in this order (design §4.3): the stored wiki key, the title, the title without its
// parenthetical qualifier. The third exists because the wiki writes "Bornland (Region)" and the map
// says "Bornland" -- live, that single rule is what turns a miss into a hit.
//
// 💣 An empty wiki key is skipped, never looked up: "wk:" would otherwise be a real key that every
// keyless place matches, and whichever entry got inserted first would answer for all of them.
function resolveSpotlightLorePlace(byLorePlace, place) {
	const wikiKey = normalizeSpotlightSearchText(String((place && place.wiki_key) || ""));
	const title = String((place && place.title) || "");
	const titleKey = normalizeSpotlightSearchText(title);
	const bareKey = normalizeSpotlightSearchText(title.replace(/\s*\([^)]*\)\s*$/, ""));

	const candidates = [wikiKey ? `wk:${wikiKey}` : "", titleKey ? `nm:${titleKey}` : "", bareKey ? `nm:${bareKey}` : ""];
	for (const candidate of candidates) {
		const hit = candidate ? byLorePlace.get(candidate) : null;
		if (hit) {
			return hit;
		}
	}

	return null;
}

// An occurrence (Flora/Fauna/Ware) points at MANY places, not one -- so it cannot ride
// buildPlaceBoundSpotlightEntry, which inherits exactly one place's entry. And unlike a map or an
// adventure it has no resolved target at all: the server ships title + wiki key, this side does the
// join, because only this side knows what is loaded right now.
//
// The resolved place NAMES go into the row, up to three. They are the answer to the question the user
// actually asked -- "wo gibt es das?" -- and putting them there means the reader often need not click.
function buildLoreSpotlightEntry(result) {
	const name = String(result.name || "");
	if (!name) {
		return null;
	}

	const { byLorePlace } = getSpotlightSearchLookup();
	const places = Array.isArray(result.lore_places) ? result.lore_places : [];
	const resolved = [];
	const seen = new Set();
	places.forEach((place) => {
		const placeEntry = resolveSpotlightLorePlace(byLorePlace, place);
		if (placeEntry && !seen.has(placeEntry.id)) {
			seen.add(placeEntry.id);
			resolved.push(placeEntry);
		}
	});

	const shown = resolved.slice(0, 3).map((placeEntry) => placeEntry.name);
	const rest = resolved.length - shown.length;
	return {
		id: `lore:${String(result.public_id || name)}`,
		kind: "lore",
		name,
		typeLabel: String(result.type_label || ""),
		aliases: [],
		publicIds: [],
		bounds: null,
		lorePlaceEntries: resolved,
		placeHint: shown.join(" · ") + (rest > 0 ? ` +${rest}` : ""),
		notOnMap: true,
		// 31 % of occurrences carry no place at all and another 15 % name places the map does not have
		// (design §1.4). They stay listed, hindmost and labelled -- "it exists, whereabouts unknown"
		// beats no answer -- but a click must not pretend to go somewhere.
		unreachable: resolved.length === 0,
		loreTotal: Number(result.lore_total) || 0,
	};
}
```

- [ ] **Step 5: Den Treffer annehmen**

In `resolveBackendSpotlightEntries` nach dem `citymap`/`adventure`-Zweig einfügen:

```javascript
		if (!entry && kind === "lore") {
			entry = buildLoreSpotlightEntry(result);
		}
```

- [ ] **Step 6: Hervorhebung und Flug schreiben**

In `js/ui/spotlight-search-focus.js` direkt nach `focusSpotlightPlaceEntry` einfügen:

```javascript
// An occurrence has MANY targets, not one (design §4.3) -- so it does not fly to "the" place, it flies
// to the extent of ALL of them and marks each one. The mechanism is not new: a way hit already
// highlights every one of its segments (highlightSpotlightPaths). Only the geometry kind is -- points
// and polygons instead of lines.
//
// unreachable (no place resolved) means there is nothing to show: no-op, exactly like an unreachable
// map. selectSpotlightSearchEntry already closed the search and cleared the selection, so the map stays
// where the user was instead of half-moving somewhere.
function focusSpotlightLorePlaces(entry) {
	const places = entry.lorePlaceEntries || [];
	if (!places.length) {
		return;
	}

	// The layer follows the FIRST place, exactly as each single-kind focus helper does for itself: a
	// landscape label is only drawn in "deregraphic", a territory only in "political". Without this the
	// highlight would sit on top of an empty map.
	if (places[0].kind === "region") {
		setSelectedMapLayerMode("political");
	} else if (places[0].kind === "label") {
		setSelectedMapLayerMode("deregraphic");
		syncLabelVisibility();
	}

	highlightSpotlightPlaces(places);

	let bounds = null;
	places.forEach((place) => {
		bounds = extendSpotlightBounds(bounds, getSpotlightPlaceBounds(place));
	});
	if (bounds?.isValid?.()) {
		// Capped low on purpose: this view answers "where does it occur?", which needs the whole spread
		// in frame, not a close-up of the first hit.
		focusSpotlightBounds(bounds, Math.min(4, map.getMaxZoom()));
	}
}

// The bbox of a place entry, whatever shape it has: a territory brings its own bounds, a label or a
// location is a single marker -- a point bbox, which flyToBounds reads as "centre here".
function getSpotlightPlaceBounds(place) {
	if (place.bounds?.isValid?.()) {
		return place.bounds;
	}

	const marker = place.labelEntry?.marker || place.locationEntry?.marker || null;
	return marker ? L.latLngBounds(marker.getLatLng(), marker.getLatLng()) : null;
}

// Marks each place of an occurrence in the same gold as a highlighted way, in the same pane. The style
// constant is REUSED deliberately: a second colour literal is exactly what AGENTS.md §12 bans, and the
// two highlights mean the same thing to the reader.
//
// The polygons are COPIES, not the rendered ones -- so a layer reload (which clears and rebuilds
// regionPolygons) cannot take the highlight with it.
function highlightSpotlightPlaces(places) {
	// Drop the previous highlight BEFORE reassigning: the assignment overwrites the only handle on it,
	// and an orphaned layer group hangs on the map until a reload. Same reason as in highlightSpotlightPaths.
	if (spotlightHighlightLayer) {
		map.removeLayer(spotlightHighlightLayer);
	}

	spotlightHighlightLayer = L.layerGroup();
	places.forEach((place) => {
		const polygons = place.polygons || [];
		if (polygons.length) {
			polygons.forEach((polygon) => {
				L.polygon(polygon.getLatLngs(), {
					...SPOTLIGHT_PATH_HIGHLIGHT_STYLE,
					weight: 5,
					fill: false,
				}).addTo(spotlightHighlightLayer);
			});
			return;
		}

		const marker = place.labelEntry?.marker || place.locationEntry?.marker || null;
		if (marker) {
			L.circleMarker(marker.getLatLng(), {
				...SPOTLIGHT_PATH_HIGHLIGHT_STYLE,
				radius: 13,
				weight: 4,
				fill: false,
			}).addTo(spotlightHighlightLayer);
		}
	});

	if (spotlightHighlightLayer.getLayers().length) {
		spotlightHighlightLayer.addTo(map);
		spotlightHighlightLayer.eachLayer((layer) => layer.bringToFront?.());
	}
}
```

- [ ] **Step 7: Den Klick verdrahten**

💣 In `selectSpotlightSearchEntry` nach dem `citymap`/`adventure`-Zweig einfügen — ohne diesen Zweig fällt der Treffer lautlos durch und der Klick tut nichts:

```javascript
	if (entry.kind === "lore") {
		focusSpotlightLorePlaces(entry);
		return;
	}
```

- [ ] **Step 8: Syntax prüfen und die Tests laufen lassen**

```bash
node --check js/ui/spotlight-search.js
node --check js/ui/spotlight-search-focus.js
node js/ui/__tests__/spotlight-scoring.test.js
```

Erwartung: kein Syntaxfehler, `spotlight-scoring: OK`.

- [ ] **Step 9: Commit**

```bash
git add js/ui/spotlight-search.js js/ui/spotlight-search-focus.js js/ui/__tests__/spotlight-scoring.test.js
git commit -m "feat(search): an occurrence hit highlights every place it was recorded in"
```

---

### Task 7: Englische Gegenparts der neuen Strings

Die drei Kartensammlungs-Strings fehlen in der englischen Tabelle seit dem 2026-08-02 — sie kommen hier mit, weil `spotlight.citymapNoTarget` durch den geteilten Schlüssel `spotlight.noPlaceOnMap` ersetzt wird und ein halb gepflegter Block schlimmer ist als ein leerer.

**Files:**
- Modify: `js/app/i18n-en.js`

- [ ] **Step 1: Die Strings eintragen**

Nach `"spotlight.inSettlement": "In town",` einfügen:

```javascript
	"spotlight.noPlaceOnMap": "no place on the map",
	"spotlight.citymaps": "Map collection",
	"spotlight.citymapsMore": "… and {n} more maps",
	"spotlight.adventures": "Adventures",
	"spotlight.adventuresMore": "… and {n} more adventures",
	"spotlight.adventureStartsIn": "starts in {place}",
	"spotlight.lore": "Occurrences",
	"spotlight.loreMore": "… and {n} more occurrences",
```

- [ ] **Step 2: Prüfen, dass kein Schlüssel verwaist ist**

```bash
grep -n "spotlight.citymapNoTarget" js/ css/ index.html
```

Erwartung: **keine Treffer** — der alte Schlüssel wurde in Task 4 durch `spotlight.noPlaceOnMap` ersetzt. Findet sich noch einer, ist Task 4 Step 5 unvollständig.

- [ ] **Step 3: Syntax prüfen**

```bash
node --check js/app/i18n-en.js
```

Erwartung: kein Fehler.

- [ ] **Step 4: Commit**

```bash
git add js/app/i18n-en.js
git commit -m "i18n(search): the section headings and place hints get their English counterparts"
```

---

### Task 8: Live prüfen

Alles DB-Gebundene ist lokal nicht beweisbar — dieser Task ist die eigentliche Abnahme. **Nach dem Push 1–2 Minuten Deploy abwarten**, PHP zusätzlich 2–4 Minuten OPcache.

**Files:** keine

- [ ] **Step 1: Pushen**

```bash
git push origin HEAD:master
```

Bei Reject **nicht** rebasen (geteiltes `.git` mit fremder Arbeit) — Wegwerf-Worktree:

```bash
git worktree add --detach "$SCRATCH/pushwt" origin/master && git -C "$SCRATCH/pushwt" cherry-pick <sha-von>..<sha-bis> && git -C "$SCRATCH/pushwt" push origin HEAD:master && git worktree remove "$SCRATCH/pushwt" && git worktree prune
```

Danach die Remote-SHA prüfen:

```bash
git fetch origin --quiet && git rev-parse origin/master
```

- [ ] **Step 2: Die drei Fälle prüfen, die den Auftrag ausgelöst haben**

Umlaute **explizit UTF-8-kodiert** senden — eine Shell, die sie als CP1252 schickt, erzeugt falsche Leermeldungen:

```bash
python -c "
import json,urllib.parse,urllib.request
for q in ['gareth','stadtabenteuer gareth','alraune','chonchinis']:
    u='https://avesmaps.de/api/app/map-search.php?q='+urllib.parse.quote(q.encode('utf-8'))
    r=json.load(urllib.request.urlopen(u,timeout=60)).get('results',[])
    by={}
    for x in r: by[x.get('kind')]=by.get(x.get('kind'),0)+1
    print(f'{q:24s} {len(r):3d} Treffer  {by}')
    for x in r:
        if x.get('kind') in ('adventure','lore'):
            print('   ',x['kind'],'|',x['name'][:44],'|',x.get('type_label',''),'|',x.get('place_name') or x.get('place_count'))
"
```

Erwartung: `stadtabenteuer gareth` liefert Abenteuer, deren Genre „Stadtabenteuer" und deren Beginn Gareth/Garetien ist · `alraune` liefert ein `lore`-Ergebnis mit `lore_places` · je Abschnitt **höchstens 5** · `adventure_total`/`lore_total` nennen die echte Gesamtzahl.

- [ ] **Step 3: Der Spoiler-Riegel und der Arten-Riegel**

```bash
python -c "
import json,urllib.parse,urllib.request
# 'Havena' ist bei vielen Abenteuern SPIELort, nicht Beginn -- kein Treffer darf ihn als place_name nennen.
u='https://avesmaps.de/api/app/map-search.php?q='+urllib.parse.quote('havena'.encode('utf-8'))
r=json.load(urllib.request.urlopen(u,timeout=60)).get('results',[])
adv=[x for x in r if x.get('kind')=='adventure']
print('Abenteuer-Treffer zu havena:', len(adv))
for x in adv: print('   ',x['name'][:44],'| Beginn:',x.get('place_name'))
"
```

Erwartung: jeder gelistete Beginn-Ort ist ein echter Beginn-Ort. Ein Abenteuer, das laut Wiki nur *in* Havena spielt, darf hier nicht mit `place_name: Havena` stehen.

```bash
python -c "
import json,urllib.parse,urllib.request
# spezies ist live ABGESCHALTET -> kein einziger lore-Treffer darf feature_subtype 'spezies' tragen.
for q in ['achaz','affenmensch','ork']:
    u='https://avesmaps.de/api/app/map-search.php?q='+urllib.parse.quote(q.encode('utf-8'))
    r=json.load(urllib.request.urlopen(u,timeout=60)).get('results',[])
    bad=[x for x in r if x.get('kind')=='lore' and x.get('feature_subtype')=='spezies']
    print(f'{q:16s} lore-Treffer: {len([x for x in r if x.get(\"kind\")==\"lore\"])}, davon spezies: {len(bad)}')
"
```

Erwartung: `davon spezies: 0` in allen drei Zeilen.

- [ ] **Step 4: Regression an Einwort-Suchen**

```bash
python -c "
import json,urllib.parse,urllib.request
for q in ['Gareth','Havena','Khôm','Echsensümpfe','Herzogtum Nordmarken']:
    u='https://avesmaps.de/api/app/map-search.php?q='+urllib.parse.quote(q.encode('utf-8'))
    r=json.load(urllib.request.urlopen(u,timeout=60)).get('results',[])
    m=[x for x in r if x.get('kind') not in ('citymap','adventure','lore')]
    print(f'{q:22s} {len(m):3d} Kartenobjekte  erster: {m[0][\"name\"] if m else \"KEIN TREFFER\"}')
"
```

Erwartung: dieselben ersten Kartenobjekt-Treffer wie vor dem Umbau. Das ist die eigentliche Regressionsprüfung — die Kartenobjekte dürfen sich **nicht** verändert haben.

- [ ] **Step 5: Antwortzeit gegen die Baseline aus Task 0**

```bash
python -c "
import json,urllib.parse,urllib.request,time
for q in ['gareth','stadtabenteuer gareth','alraune']:
    u='https://avesmaps.de/api/app/map-search.php?q='+urllib.parse.quote(q.encode('utf-8'))
    t=time.time(); r=json.load(urllib.request.urlopen(u,timeout=60)); ms=(time.time()-t)*1000
    print(f'{q:24s} {ms:7.0f} ms  {len(r.get(\"results\",[])):3d} Treffer')
"
```

Erwartung: in derselben Größenordnung wie Task 0. Beide Zahlenreihen in die Antwort an den Owner. Eine deutliche Verschlechterung ist **kein** Grund nachzubessern, sondern zu berichten (Entwurf §8).

- [ ] **Step 6: Im Browser gegenprüfen**

`https://avesmaps.de` öffnen, **Strg+Shift+R** (Spotlight-JS lädt ohne `?v=`), Suche öffnen.

- „gareth" tippen → Kartenobjekte oben, darunter die Abschnitte „Kartensammlung", „Abenteuer" mit Zahl, je höchstens 5, darunter die Ausklappzeile.
- Ein Abenteuer anklicken → fliegt auf den Beginn-Ort und öffnet dessen Infobox.
- „alraune" tippen → Abschnitt „Vorkommen"; ein Klick hebt alle gefundenen Orte hervor und fliegt auf ihre gemeinsame Ausdehnung.
- Escape bzw. ein Klick auf die Karte löscht die Hervorhebung.
- Pfeiltasten überspringen Überschriften und Ausklappzeilen.

- [ ] **Step 7: Ergebnis festhalten**

Gemessene Zahlen in die Antwort an den Owner, **nicht** in eine neue Datei. Weicht etwas ab, hier stoppen und berichten statt nachzubessern.

---

## Was dieser Plan bewusst NICHT tut

- **Die Wort-UND-Bewertung bleibt unangetastet.** Sie ist live und getestet; dieser Plan hängt Quellen ein, er ändert keine Bewertung. Die beiden vorhandenen Scoring-Tests laufen unverändert mit.
- **Die Normalisierungs-Divergenz** (Server `ue`, Client `u`) bleibt bestehen — Begründung im Karten-Entwurf, §7.
- **Kein `role='play'`** wird gelesen, gespeichert, angezeigt oder angesprungen (Entwurf §4.1).
- **Die Vorkommens-Ortsangaben werden nicht bereinigt.** „Alchimist" und „Angrosch-Kirche" stehen im Ortsfeld, lösen auf nichts auf und bleiben so.
- **Kein SQL-Vorfilter.** Er ist in §8 des Entwurfs vorgedacht, aber erst gerechtfertigt, wenn Task 8 Step 5 eine Verschlechterung zeigt.
- **Kein Eingriff ins Editor-Handbuch** — das gehört der nächtlichen Routine (AGENTS.md §9). Die Commit-Betreffs benennen die sichtbare Wirkung.
