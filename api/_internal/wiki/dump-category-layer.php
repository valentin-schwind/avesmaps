<?php

declare(strict_types=1);

// Die Gottheiten-Tabelle fuer avesmapsWikiDumpCategoryAssembleDeityMap (unten). Rein: keine
// Datenbank, kein DDL, keine weitere Abhaengigkeit -- dieselbe Bauart wie place-kinds.php, aus
// dessen Konstante diese Datei ohnehin liest. Der Aufrufer laedt sie sonst zufaellig mit; ein
// require_once hier macht die Abhaengigkeit sichtbar und kostet nichts.
require_once __DIR__ . '/deities.php';

/**
 * Hybrid WikiDump migration -- Task H1: the ONLINE CATEGORY LAYER.
 * ---------------------------------------------------------------------------
 * The offline dump reader (dump-reader.php / dump-entity-scan.php) already
 * reproduces every Infobox WIKITEXT field, redirects and the territory
 * hierarchy from the static MediaWiki XML dump. But three signals are
 * INVISIBLE in raw dump wikitext because MediaWiki injects them via template
 * expansion, never as literal text in the page source (invariant I6, proven
 * on real pages Abilacht/Arathax):
 *
 *   - settlement_class  (which of Dorf/Kleinstadt/Mittelgroße Stadt/
 *                        Großstadt/Metropole a settlement belongs to)
 *   - building_type     (which "Bauwerk nach Art" subcategory a building
 *                        belongs to)
 *   - continent         (Aventurien vs. Myranor/Uthuria/Rakshazar/Tharun/
 *                        Lahmaria, via [[Kategorie:...]] links MediaWiki
 *                        renders from a template but never writes literally)
 *   - the settlement/building ENUMERATION BREADTH itself (dump-only
 *     infobox-presence classification can't discover a title's class without
 *     wikitext to inspect first)
 *
 * This module builds the "override map" for exactly those three signals by
 * REUSING the never-deleted online category crawler's own fetchers
 * (invariant I8) -- it does NOT re-derive category names, class mappings or
 * the continent detector; it only assembles their OUTPUT into lookup maps
 * keyed by avesmapsWikiSyncMonitorNormalizeTitle (sync-monitor.php:319) so H2
 * can match dump <title>s against these keys.
 *
 * SCOPE: this module does NOT touch the dump stream (H2), does NOT override
 * the dump parsers (H3), and does NOT orchestrate/chunk the whole hybrid read
 * across steps (H4) -- it only produces the three maps.
 *
 * READ-ONLY / SIDE-EFFECT-FREE ON INCLUDE: this file performs NO staging,
 * sandbox or map writes, and defines only consts + functions (safe to
 * `require` from a context with no DB connection at all -- proven by
 * tools/wikidump/test-dump-category-layer.php, which never opens a PDO).
 * The continent builder's whole point is to avoid the wiki_sync_pages upsert
 * side effect that avesmapsWikiSyncFetchPagesByRequestedTitle normally
 * performs (locations-helpers.php:249-313, upsert at line 306) -- see
 * avesmapsWikiDumpCategoryFetchPageCategoriesReadOnly() below for how.
 *
 * PURE-ASSEMBLER / OUTER-FETCH SPLIT (per the H1 brief): every builder is
 * split into
 *   (1) a PURE assembler that takes ALREADY-FETCHED data shapes
 *       (categorymembers arrays / prop=categories page arrays) and returns
 *       the map -- zero HTTP, fully unit-testable with mocks -- and
 *   (2) a thin OUTER fetch function that calls the real reused crawler
 *       fetchers (or an injected fake fetcher, for the resumable-cursor and
 *       real-category-name-wiring tests) and feeds the assembler.
 * This mirrors how tools/wikidump/test-dump-category-layer.php verifies
 * behaviour without ever calling avesmapsWikiSyncApiRequest (the real API is
 * not reachable from this environment; the live-API path is owner-verified
 * in a later task).
 *
 * INVARIANTS (non-negotiable, verified in
 * tools/wikidump/test-dump-category-layer.php):
 *
 *   I1  Never re-derive keys/classes/continents differently than the online
 *       crawler -- every value in these maps comes from calling the SAME
 *       reused functions the crawler itself uses (AVESMAPS_WIKI_CATEGORY_TO_CLASS,
 *       avesmapsWikiSyncMonitorDetectContinent, the legacy building-type list),
 *       so the values are byte-identical to what would populate wiki_sync_pages
 *       today.
 *
 *   I8  Reuse the never-deleted crawler fetchers (avesmapsWikiSyncFetchCategoryMemberTitles,
 *       avesmapsWikiSettlementFetchSubcategories, avesmapsWikiSyncFetchPagesByRequestedTitle)
 *       -- only the map-assembly logic and the read-only per-title category
 *       fetch below are NEW code.
 *
 * ===========================================================================
 * THE $persist=false DECISION (continent map's per-title category fetch)
 * ===========================================================================
 * avesmapsWikiSyncFetchPagesByRequestedTitle(PDO $pdo, array $titles, bool
 * $includeCategories, bool $includeContent): array (locations-helpers.php:249)
 * is the mechanism this layer would naturally reuse for the batched
 * prop=categories lookup -- but it ALWAYS calls avesmapsWikiSyncUpsertPageCache
 * (line 306), an unconditional write to wiki_sync_pages. The H1 brief requires
 * this layer to stay READ-ONLY until the real read_step (owner rule: nothing
 * sharp before the compare-test is green), so that write must not happen here.
 *
 * The brief's own function signature for the outer continent fetch --
 * avesmapsWikiDumpCategoryFetchContinentMap(array $titles, int $cursor = 0,
 * ?int $callBudget = null): array -- takes NO PDO parameter at all. Since a
 * PDO is exactly the DB-write capability this whole layer wants to avoid
 * needing, threading a `bool $persist = true` flag into the EXISTING
 * avesmapsWikiSyncFetchPagesByRequestedTitle would still force this module to
 * accept/thread a PDO everywhere just to pass `null`-ish plumbing through an
 * unused write path -- which fights the brief's own signature and the
 * PDO-free pure test.
 *
 * So this module adds a SLIM SIBLING, avesmapsWikiDumpCategoryFetchPageCategoriesReadOnly()
 * below, instead of a new parameter on the existing function. It intentionally
 * mirrors ONLY the request-building + normalized/redirect-resolution shape of
 * locations-helpers.php:255-304 (batch of AVESMAPS_WIKI_TITLE_BATCH_SIZE=20,
 * same action=query&titles=...&redirects=1&prop=categories&cllimit=max request
 * shape) and OMITS the avesmapsWikiSyncUpsertPageCache call entirely -- there is
 * no PDO in scope to call it with. This is the smaller, safer change: it does
 * not touch the widely-called existing function (5 call sites across
 * settlements.php/locations.php/locations-helpers.php/regions.php/paths.php,
 * all still working exactly as before, unmodified) and does not risk any
 * accidental write from a code path the H1 brief explicitly requires to be
 * inert. The two copies are small (a HTTP request + response-shape parse, no
 * business logic) and are kept in sync by both ultimately depending on the
 * SAME avesmapsWikiSyncApiRequest primitive and the SAME
 * AVESMAPS_WIKI_TITLE_BATCH_SIZE constant -- so there is exactly one place
 * (sync.php) that governs batching/throttling for both.
 *
 * H4 (owner-verified later) is expected to call the read-only sibling during
 * the hybrid's category-layer step, and only the REAL read_step (also H4/
 * later) is expected to opt into persistence via the existing
 * avesmapsWikiSyncFetchPagesByRequestedTitle when the compare-test is green.
 *
 * ===========================================================================
 * THE RESUMABLE-CURSOR CONTRACT (alle drei Sammler)
 * ===========================================================================
 * 🔴 SEIT 24.08.2026 HAT JEDER DER DREI SAMMLER EINEN CURSOR -- der Absatz darunter galt bis
 * dahin nur der Kontinent-Karte, und sein letzter Satz ("die Klassen-/Bauwerks-Karte sind je
 * eine Handvoll Aufrufe und brauchen keinen Cursor") war der Satz, an dem "Dump holen"
 * gestorben ist: er stimmte bei 0,6 s Drossel und wurde falsch, als die Wiki-robots.txt
 * AvesmapsWikiSync einen Crawl-delay von 20 Sekunden gab. Aus "eine Handvoll" wurden ~250 s
 * (Klassen, ~12 Abfragen) und ~500 s (Bauwerke, ~25 Abfragen) in EINEM Schritt -- der
 * Webserver gab vorher mit HTTP 502 auf, ausserhalb von PHP und damit ohne jede Meldung.
 * ⚠️ Die Lehre ist groesser als die Zahl: "das sind nur ein paar Aufrufe" ist eine Aussage
 * ueber die DROSSEL, nicht ueber den Code -- und die Drossel gehoert nicht uns.
 *
 * DIE ZWEI CURSORFORMEN, und sie sind verschieden:
 *   - Kontinent-Karte: eine ZAHL. Sie bekommt ihre Titelliste fertig herein und zaehlt nur,
 *     wie viele davon abgearbeitet sind (Absatz unten).
 *   - Klassen- und Bauwerks-Karte: ZWEI Teile -- welche Kategorie (Index) UND wo innerhalb
 *     von ihr (das cmcontinue der API). Denn eine Kategorie-Abfrage paginiert selbst. Wer
 *     nur den Index fuehrt, faengt eine grosse Kategorie im naechsten Schritt von vorn an
 *     oder verliert ihren Rest -- und an einer kleinen Fixture faellt das nie auf, weil
 *     kleine Kategorien nicht paginieren. Siehe
 *     avesmapsWikiDumpCategoryFetchCategoryMembersStep() weiter unten.
 *
 * Das Aufrufbudget je Schritt kommt in allen drei Faellen aus derselben gerechneten Funktion
 * (avesmapsWikiDumpOnlineStepCallBudget(), dump-hybrid-driver.php) -- nie aus einer festen
 * Zahl im Quelltext: genau eine solche 20 war das alte Budget der Kontinent-Phase.
 *
 * avesmapsWikiDumpCategoryFetchContinentMap() processes the given title list
 * in batches of AVESMAPS_WIKI_TITLE_BATCH_SIZE (=20, sync.php:8), spending
 * exactly one API call per batch, and stops once it has spent $callBudget API
 * calls (default: process everything in one call if $callBudget is null --
 * only used by tests/small inputs; production call sites MUST pass an
 * explicit budget). It returns { map, nextCursor, done } so a caller (H4) can
 * loop: pass nextCursor back in as $cursor on the next call, and stop once
 * done=true. This mirrors avesmapsWikiDumpRunPassBStep's cursor/pageBudget
 * pattern (dump-entity-scan.php:1348) applied to API-call budget instead of
 * page count. Es ist der Sammler mit den MEISTEN Aufrufen (rund 450 gedrosselte ueber rund
 * 9k Titel, recon section 3/4.4) -- aber laengst nicht mehr der einzige mit einem Cursor.
 *
 * NOTE (H1 report -- flagged, not silently special-cased): the H1 brief's own
 * test example states "a 45-title list with callBudget=1 (batch 20) returns
 * nextCursor=40" -- but "stop after $callBudget API calls" with batch=20 and
 * callBudget=1 can only consume ONE batch (20 titles), i.e. nextCursor=20, not
 * 40 (40 would require TWO API calls under a budget of 1, self-contradictory).
 * This module implements the internally consistent behaviour (budget=1 -> 1
 * batch -> nextCursor=20) and documents the discrepancy in the H1 report
 * rather than hacking the loop to match an arithmetically inconsistent
 * example. The brief's OTHER cursor claim -- "a second call from 40 returns
 * done=true" -- holds regardless (see the test file, assertions d9/d10):
 * resuming from cursor=40 on a 45-title list always finishes within one more
 * batch.
 */

// ===========================================================================
// (0) DER GEMEINSAME SCHRITTSAMMLER BEIDER KATEGORIE-PHASEN.
// ===========================================================================

/**
 * Standard-Seitenholer fuer ARTIKEL einer Kategorie (ns 0) -- der Bauwerks-/Klassen-Fall.
 * Duenn ueber avesmapsWikiSyncFetchCategoryMemberPage (locations.php), damit die Anfrage nur
 * an einer Stelle im Haus gebaut wird.
 *
 * @return array{titles: list<string>, continue: ?string}
 */
function avesmapsWikiDumpCategoryFetchCategoryMemberPage(string $categoryName, ?string $continueToken = null): array {
    return avesmapsWikiSyncFetchCategoryMemberPage($categoryName, $continueToken, ['cmnamespace' => 0]);
}

/**
 * Standard-Seitenholer fuer UNTERKATEGORIEN -- der Aufloeser der Bauwerksarten.
 * ⚠️ Liefert die Titel roh, mitsamt `Kategorie:`-Praefix; abgestreift wird in
 * avesmapsWikiDumpCategoryFetchBuildingTypes().
 *
 * @return array{titles: list<string>, continue: ?string}
 */
function avesmapsWikiDumpCategoryFetchSubcategoryPage(string $categoryName, ?string $continueToken = null): array {
    return avesmapsWikiSyncFetchCategoryMemberPage($categoryName, $continueToken, ['cmtype' => 'subcat']);
}

/**
 * Laeuft eine LISTE von Kategorien Seite fuer Seite ab und gibt zurueck, was in dieses
 * Aufrufbudget gepasst hat -- der gemeinsame Motor der Klassen- und der Bauwerks-Phase.
 *
 * 💣 DER CURSOR TRAEGT ZWEI DINGE, UND DAS IST DER GANZE PUNKT. Die Kontinent-Phase zaehlt
 * nur Titel und kommt mit einer Zahl aus; eine Kategorie-Abfrage paginiert dagegen SELBST
 * (cmcontinue). Wer sich nur merkt, WELCHE Kategorie dran war, faengt eine grosse Kategorie
 * beim naechsten Schritt von vorne an -- oder ueberspringt ihren Rest. Beides faellt an einer
 * kleinen Fixture nie auf, weil kleine Kategorien nicht paginieren. Deshalb stehen beide
 * Teile in der SIGNATUR: man kann sie nicht vergessen.
 *   $index         -- welche Kategorie der Liste (0-basiert)
 *   $continueToken -- wo INNERHALB dieser Kategorie (das cmcontinue der naechsten Seite)
 *
 * Eine Seite = eine API-Abfrage = eine Einheit des Budgets. $callBudget === null heisst
 * "alles in einem Zug" -- das ist die Fassung, die am 24.08.2026 am Gateway starb, und sie
 * ist NUR fuer Tests und winzige Listen gedacht; ein Aufrufer in der Produktion uebergibt
 * immer ein gerechnetes Budget (avesmapsWikiDumpOnlineStepCallBudget()).
 *
 * ⚠️ Der Rueckgabewert deckt NUR diesen Schritt ab. Ueber eine Schrittgrenze hinweg kann
 * dieser Sammler "erster Treffer gewinnt" nicht halten -- er sieht die fruehere Kategorie gar
 * nicht mehr. Das haelt die Datenbank (avesmapsWikiDumpHybridUpsertRows schreibt je Spalte
 * nur, was noch leer ist).
 *
 * @param list<string>  $categoryNames  die abzulaufenden Kategorienamen, in fester Reihenfolge
 * @param callable|null $memberPageFetcher (string $kategorie, ?string $weiter): array{titles, continue}
 * @return array{categoryToTitles: array<string, list<string>>, nextIndex: int, nextContinue: ?string, done: bool, calls: int}
 */
function avesmapsWikiDumpCategoryFetchCategoryMembersStep(
    array $categoryNames,
    int $index = 0,
    ?string $continueToken = null,
    ?int $callBudget = null,
    ?callable $memberPageFetcher = null
): array {
    $memberPageFetcher ??= 'avesmapsWikiDumpCategoryFetchCategoryMemberPage';

    $categoryNames = array_values($categoryNames);
    $total = count($categoryNames);
    $index = max(0, min($index, $total));
    // Hinter der letzten Kategorie kann es keine Fortsetzung mehr geben. Ohne diese Zeile
    // haelt ein mitgeschleppter Token den Lauf fuer immer unfertig.
    if ($index >= $total) {
        $continueToken = null;
    }

    $categoryToTitles = [];
    $calls = 0;

    while ($index < $total) {
        if ($callBudget !== null && $calls >= $callBudget) {
            break;
        }

        $categoryName = (string) $categoryNames[$index];
        $seite = $memberPageFetcher($categoryName, $continueToken);
        $calls++;
        if (!is_array($seite)) {
            $seite = [];
        }

        $titles = is_array($seite['titles'] ?? null) ? $seite['titles'] : [];
        foreach ($titles as $title) {
            $title = trim((string) $title);
            if ($title !== '') {
                // Nach KATEGORIE geschluesselt, nicht nach Index: genau diese Form erwarten
                // die beiden reinen Assembler weiter unten.
                $categoryToTitles[$categoryName][] = $title;
            }
        }

        $weiter = $seite['continue'] ?? null;
        $continueToken = ($weiter === null || $weiter === '') ? null : (string) $weiter;
        if ($continueToken === null) {
            $index++;
        }
    }

    return [
        'categoryToTitles' => $categoryToTitles,
        'nextIndex' => $index,
        'nextContinue' => $continueToken,
        'done' => $index >= $total && $continueToken === null,
        'calls' => $calls,
    ];
}

// ===========================================================================
// (1) SETTLEMENT CLASS MAP (resumable)
// ===========================================================================

/**
 * PURE assembler: {categoryName => titles[]} -> {map: {normTitle => class}, titles: [...]}.
 *
 * $categoryToTitles MUST be keyed by the exact category names in
 * AVESMAPS_WIKI_CATEGORY_TO_CLASS (locations.php:36-44) -- the category a
 * title came from IS its class (I6 ground truth, no wikitext inspection
 * needed). Titles are normalized via avesmapsWikiSyncMonitorNormalizeTitle at
 * this boundary (avesmapsWikiSyncFetchCategoryMemberTitles itself only trims,
 * per recon section 4.2) so the returned keys match dump <title>s after the
 * same normalization is applied dump-side.
 *
 * First category a title is seen under wins (mirrors
 * avesmapsWikiSyncSettlementClassFromPage's "first match wins" semantics,
 * locations-helpers.php:361-370), though in practice a settlement should only
 * ever appear in exactly one of the 5 class categories.
 */
function avesmapsWikiDumpCategoryAssembleClassMap(array $categoryToTitles): array {
    $map = [];
    foreach (AVESMAPS_WIKI_CATEGORY_TO_CLASS as $categoryName => $class) {
        $titles = $categoryToTitles[$categoryName] ?? [];
        if (!is_array($titles)) {
            continue;
        }
        foreach ($titles as $rawTitle) {
            $normTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) $rawTitle);
            if ($normTitle === '' || isset($map[$normTitle])) {
                continue;
            }
            $map[$normTitle] = (string) $class;
        }
    }

    return [
        'map' => $map,
        'titles' => array_keys($map),
    ];
}

/**
 * OUTER fetch (FORTSETZBAR seit 24.08.2026): laeuft die 5 echten Klassen-Kategorien
 * (AVESMAPS_WIKI_CATEGORY_TO_CLASS, ueber avesmapsWikiSyncFetchSiedlungenIndexCategories)
 * Seite fuer Seite ab und fuettert den Assembler oben mit dem, was in dieses Budget passte.
 *
 * 🔴 Bis dahin war das ein Einschritt-Sammler: 5 Kategorien, jede intern durchpaginiert, in
 * EINEM Aufruf. Bei 0,6 s Drossel waren das ~7 Sekunden; seit dem Crawl-delay 20 der
 * Wiki-robots.txt sind es rund 250 -- und der Webserver antwortet vorher mit HTTP 502.
 * Cursor und Budget liegen deshalb jetzt wie bei der Kontinent-Phase in der Signatur; die
 * Falle mit dem ZWEITEILIGEN Cursor steht bei
 * avesmapsWikiDumpCategoryFetchCategoryMembersStep().
 *
 * ⚠️ EIN UNTERSCHIED ZUM EINSCHRITT-SAMMLER, und er ist folgenlos: die Titel kommen jetzt in
 * API-Reihenfolge statt natcase-sortiert (avesmapsWikiSyncFetchCategoryMemberTitles sortiert am
 * Ende einer ganzen Kategorie -- ueber Schritte hinweg gibt es dieses Ende nicht mehr). Die
 * Reihenfolge bestimmt nur, in welcher Folge die Zeilen in die Zustandstabelle wandern, und
 * damit hoechstens, welcher Titel in welchem Stapel der Kontinent-Phase landet -- am Ergebnis
 * aendert sich nichts. Die Reihenfolge der KATEGORIEN dagegen ist tragend (erster Treffer
 * gewinnt) und bleibt die von AVESMAPS_WIKI_CATEGORY_TO_CLASS.
 *
 * @param callable|null $memberPageFetcher Testnaht: (string $kategorie, ?string $weiter): array{titles, continue}
 * @return array{map: array<string,string>, titles: list<string>, nextIndex: int, nextContinue: ?string, done: bool, calls: int}
 */
function avesmapsWikiDumpCategoryFetchSettlementClassMap(
    int $index = 0,
    ?string $continueToken = null,
    ?int $callBudget = null,
    ?callable $memberPageFetcher = null
): array {
    $schritt = avesmapsWikiDumpCategoryFetchCategoryMembersStep(
        avesmapsWikiSyncFetchSiedlungenIndexCategories(),
        $index,
        $continueToken,
        $callBudget,
        $memberPageFetcher
    );

    $karte = avesmapsWikiDumpCategoryAssembleClassMap($schritt['categoryToTitles']);

    return [
        'map' => $karte['map'],
        'titles' => $karte['titles'],
        'nextIndex' => $schritt['nextIndex'],
        'nextContinue' => $schritt['nextContinue'],
        'done' => $schritt['done'],
        'calls' => $schritt['calls'],
    ];
}

// ===========================================================================
// (2) BUILDING TYPE MAP
// ===========================================================================

/**
 * PURE assembler: {buildingType => titles[]} -> {map: {normTitle => building_type}, titles: [...]}.
 *
 * $typeToTitles is keyed by building_type (= the crawled subcategory name
 * itself, recon section 2.2 -- NOT a derived label). First type a title is
 * seen under wins, mirroring avesmapsWikiSettlementCrawlBuildings's
 * "$typeByTitle[$title] ??=" semantics (settlements.php:943-953: "erster Typ
 * gewinnt").
 */
function avesmapsWikiDumpCategoryAssembleBuildingMap(array $typeToTitles): array {
    $map = [];
    foreach ($typeToTitles as $buildingType => $titles) {
        if (!is_array($titles)) {
            continue;
        }
        foreach ($titles as $rawTitle) {
            $normTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) $rawTitle);
            if ($normTitle === '' || isset($map[$normTitle])) {
                continue;
            }
            $map[$normTitle] = (string) $buildingType;
        }
    }

    return [
        'map' => $map,
        'titles' => array_keys($map),
    ];
}

/**
 * STUFE 1 der Bauwerks-Phase (FORTSETZBAR): die LISTE der Bauwerksarten aufloesen.
 *
 * Mirrors avesmapsWikiSettlementCrawlBuildings (settlements.php:929-962) Schritt 1-3:
 *   1. Die lebenden Unterkategorien von "Bauwerk nach Art" holen.
 *   2. Jede AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES anhaengen, die nicht schon
 *      dabei ist (der Online-Katalog ist eine Obermenge der statischen Liste, Recon 2.2).
 *   3. Die lineare Infrastruktur herausfiltern (avesmapsWikiSettlementIsExcludedBuildingType)
 *      -- Strasse/Reichsstrasse/... gehoeren dem Wege-WikiSync, nicht dieser Breite.
 *
 * 💣 SCHRITT 2 UND 3 LAUFEN ERST, WENN DIE PAGINIERUNG DURCH IST. Anhaengen und Filtern auf
 * einem halben Zwischenstand wuerde die REIHENFOLGE der Liste aendern -- und die Reihenfolge
 * ist bei avesmapsWikiDumpCategoryAssembleBuildingMap die Entscheidung, welcher Typ gewinnt.
 * Solange `done` false ist, ist `types` deshalb der ROHE Zwischenstand, den der Aufrufer
 * beim naechsten Schritt unveraendert wieder hereinreicht.
 *
 * ⚠️ Heute hat "Bauwerk nach Art" gut zwei Dutzend Unterkategorien, passt also in eine
 * Abfrage. Das ist ein Bestandswert, keine Zusicherung: bei 500 je Seite und 20 s Drossel
 * waere die zweite Seite schon der zweite Schritt -- deshalb ist auch diese Stufe fortsetzbar.
 *
 * @param list<string>  $collected der rohe Zwischenstand des vorigen Schritts ([] beim ersten)
 * @param callable|null $subcategoryPageFetcher Testnaht: (string $kategorie, ?string $weiter): array{titles, continue}
 * @return array{types: list<string>, nextContinue: ?string, done: bool, calls: int}
 */
function avesmapsWikiDumpCategoryFetchBuildingTypes(
    array $collected = [],
    ?string $continueToken = null,
    ?int $callBudget = null,
    ?callable $subcategoryPageFetcher = null
): array {
    $subcategoryPageFetcher ??= 'avesmapsWikiDumpCategoryFetchSubcategoryPage';

    $types = [];
    foreach ($collected as $vorhanden) {
        $vorhanden = trim((string) $vorhanden);
        if ($vorhanden !== '' && !in_array($vorhanden, $types, true)) {
            $types[] = $vorhanden;
        }
    }

    $calls = 0;
    $done = false;

    while ($callBudget === null || $calls < $callBudget) {
        $seite = $subcategoryPageFetcher('Bauwerk nach Art', $continueToken);
        $calls++;
        if (!is_array($seite)) {
            $seite = [];
        }

        foreach ((is_array($seite['titles'] ?? null) ? $seite['titles'] : []) as $roh) {
            $art = trim(avesmapsWikiSyncStripCategoryPrefix(trim((string) $roh)));
            if ($art !== '' && !in_array($art, $types, true)) {
                $types[] = $art;
            }
        }

        $weiter = $seite['continue'] ?? null;
        $continueToken = ($weiter === null || $weiter === '') ? null : (string) $weiter;
        if ($continueToken === null) {
            $done = true;
            break;
        }
    }

    if (!$done) {
        return ['types' => $types, 'nextContinue' => $continueToken, 'done' => false, 'calls' => $calls];
    }

    foreach (AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES as $legacy) {
        if (!in_array($legacy, $types, true)) {
            $types[] = $legacy;
        }
    }
    $types = array_values(array_filter(
        $types,
        static fn(string $t): bool => !avesmapsWikiSettlementIsExcludedBuildingType($t)
    ));

    return ['types' => $types, 'nextContinue' => null, 'done' => true, 'calls' => $calls];
}

/**
 * STUFE 2 der Bauwerks-Phase (FORTSETZBAR): die Mitglieder der aufgeloesten Arten holen.
 *
 * Mirrors avesmapsWikiSettlementCrawlBuildings Schritt 4 (depth-0, nur direkte Mitglieder) bis
 * VOR dessen PDO-Schwanz -- dieser Sammler gibt nur die Karte zurueck; geschrieben wird eine
 * Ebene hoeher (avesmapsWikiDumpHybridFillBuildingMapStep).
 *
 * 🔴 Bis 24.08.2026 lag hier ein Einschritt-Sammler: die Artenliste UND je Art eine Abfrage,
 * zusammen rund 25 Stueck. Bei 20 s Drossel sind das ~500 Sekunden, also HTTP 502. Die
 * Artenliste kommt seither aus avesmapsWikiDumpCategoryFetchBuildingTypes() und wird
 * hereingereicht, statt hier ein zweites Mal geholt zu werden -- sonst verschoebe sich der
 * Index gegen eine Liste, die sich zwischen zwei Schritten geaendert haben kann.
 *
 * @param list<string>  $types die FERTIGE Artenliste aus Stufe 1
 * @param callable|null $memberPageFetcher Testnaht: (string $kategorie, ?string $weiter): array{titles, continue}
 * @return array{map: array<string,string>, titles: list<string>, nextIndex: int, nextContinue: ?string, done: bool, calls: int}
 */
function avesmapsWikiDumpCategoryFetchBuildingTypeMap(
    array $types,
    int $index = 0,
    ?string $continueToken = null,
    ?int $callBudget = null,
    ?callable $memberPageFetcher = null
): array {
    $schritt = avesmapsWikiDumpCategoryFetchCategoryMembersStep(
        $types,
        $index,
        $continueToken,
        $callBudget,
        $memberPageFetcher
    );

    $karte = avesmapsWikiDumpCategoryAssembleBuildingMap($schritt['categoryToTitles']);

    return [
        'map' => $karte['map'],
        'titles' => $karte['titles'],
        'nextIndex' => $schritt['nextIndex'],
        'nextContinue' => $schritt['nextContinue'],
        'done' => $schritt['done'],
        'calls' => $schritt['calls'],
    ];
}

// ===========================================================================
// (3) CONTINENT MAP (resumable)
// ===========================================================================

/**
 * PURE assembler: {requestedTitle => prop=categories page} -> {normTitle => continent}.
 *
 * $pagesByRequestedTitle is shaped exactly like
 * avesmapsWikiSyncFetchPagesByRequestedTitle's return value (or this module's
 * own read-only sibling below): requested title => MediaWiki API page object
 * with a ['categories'][]['title'] array. For each page, builds the SAME
 * context string shape the online crawlers feed
 * avesmapsWikiSyncMonitorDetectContinent (title + categories -- recon section
 * 5.2 explicitly scopes THIS builder to title+categories only; region/staat/
 * nav-hint fields need wikitext, which is NOT available here and is folded in
 * later by H4/H3 when territory/region titles are enriched with dump
 * wikitext) via the reused avesmapsWikiSyncGetCategoryNames
 * (locations-helpers.php:372-382) + avesmapsWikiSyncMonitorDetectContinent
 * (sync-monitor-parsing.php:161-203) -- BOTH reused verbatim, never
 * re-implemented (I1).
 */
function avesmapsWikiDumpCategoryAssembleContinentMap(array $pagesByRequestedTitle): array {
    $map = [];
    foreach ($pagesByRequestedTitle as $requestedTitle => $page) {
        if (!is_array($page)) {
            continue;
        }
        $normTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) $requestedTitle);
        if ($normTitle === '') {
            continue;
        }
        $categories = avesmapsWikiDumpCategoryStripNonContinentCategories(
            avesmapsWikiSyncGetCategoryNames($page)
        );
        $context = $normTitle . ' ' . implode(' ', $categories);
        $map[$normTitle] = avesmapsWikiSyncMonitorDetectContinent($context);
    }

    return $map;
}

/**
 * PURE assembler: {requestedTitle => prop=categories page} -> {normTitle => list<Gottheit>}.
 *
 * ⭐ SIE KOSTET KEINE EINZIGE ZUSAETZLICHE ABFRAGE. Die Kontinent-Phase holt fuer jeden Titel
 * ohnehin `prop=categories` und wirft danach alles weg, was nicht Kontinent ist -- die
 * Goetter-Kategorie liegt in genau derselben Antwort. Der urspruengliche Plan sah 45 eigene
 * categorymembers-Abfragen vor; gemessen am 15.08.2026 waeren das bei 600 ms Drosselung
 * (AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS) rund 37 s zusaetzlich in der NICHT fortsetzbaren
 * Phase online_building_map, die heute schon bei etwa 83 s liegt. Hier haengt es an einer
 * fortsetzbaren Phase und kostet nichts.
 *
 * 💣 Die Gottheit steht NICHT im Wikitext: „Drachentempel" ist laut API in
 * Kategorie:Rondra-Tempel, sein Quelltext enthaelt keinen solchen Link -- die Kategorie kommt
 * ueber eine Vorlage. Genau deshalb ist die Kategorie-SCHICHT der einzige Weg.
 *
 * 💣 MEHRWERTIG: der Feuersturm-Tempel steht in „Ingerimm-Tempel" UND „Rondra-Tempel". Anders
 * als avesmapsWikiDumpCategoryAssembleBuildingMap, die den ERSTEN Treffer behaelt (spezifisch
 * vor Sammelkategorie), werden hier ALLE gesammelt -- zwei Weihungen sind kein Konflikt,
 * sondern die Wahrheit.
 *
 * Titel ohne Gottheit erscheinen NICHT in der Map (kein leerer Eintrag): der Aufrufer schreibt
 * nur, was er findet, und ein Bauwerk ohne Weihung soll seine Zeile nicht mit '' ueberschreiben.
 *
 * @return array<string, list<string>>
 */
function avesmapsWikiDumpCategoryAssembleDeityMap(array $pagesByRequestedTitle): array {
    $map = [];
    foreach ($pagesByRequestedTitle as $requestedTitle => $page) {
        if (!is_array($page)) {
            continue;
        }
        $normTitle = avesmapsWikiSyncMonitorNormalizeTitle((string) $requestedTitle);
        if ($normTitle === '') {
            continue;
        }
        $deities = avesmapsDeitiesFromCategories(avesmapsWikiSyncGetCategoryNames($page));
        if ($deities !== []) {
            $map[$normTitle] = $deities;
        }
    }

    return $map;
}

/**
 * Drop name-/cross-wiki DERIVATION categories from the continent-detection
 * context BEFORE it is keyed.
 *
 * These categories reference a DERIVED-FROM or sister-wiki entity by NAME and
 * never denote continent placement, yet their name can carry a foreign-continent
 * token (e.g. "Abgeleitet von Horas (Myranor)") that the substring needle-loop in
 * avesmapsWikiSyncMonitorDetectContinent (sync-monitor-parsing.php:186-200) then
 * mis-matches ('myranor' is tested before 'aventurien', array-order first-match
 * wins). Concrete bug: "Wiedererstandenes Reich des Horas" carries
 * "Abgeleitet von Horas (Myranor)" AND "Aventurien-Artikel" -> was wrongly keyed
 * Myranor, and the whole Horas subtree then inherited it via the REBUILD
 * continent-inheritance step (sync-monitor-tree.php:209-233).
 *
 * Genuine Myranor placement is signalled by "... in Myranor" /
 * "Nav Staaten Myranor" / "Staat (Myranor)" -- none of which is an
 * "Abgeleitet von ..." derivation category -- so stripping this family is safe.
 * Categories arrive here already "Kategorie:"-stripped (avesmapsWikiSyncGetCategoryNames).
 */
function avesmapsWikiDumpCategoryStripNonContinentCategories(array $categories): array {
    return array_values(array_filter(
        $categories,
        static fn(string $category): bool => preg_match('/^\s*abgeleitet von\b/iu', $category) !== 1
    ));
}

/**
 * READ-ONLY sibling of avesmapsWikiSyncFetchPagesByRequestedTitle
 * (locations-helpers.php:249-313) -- see the "$persist=false DECISION"
 * docblock above for why this exists as a separate function instead of a
 * parameter on the existing one. Mirrors ONLY its request-building +
 * normalized/redirect-resolution logic (lines 255-304); intentionally OMITS
 * the avesmapsWikiSyncUpsertPageCache call (line 306) -- there is no PDO in
 * scope here, by design.
 *
 * Always fetches categories only (includeContent is never needed by this
 * layer -- continent detection here uses title+categories only, per the
 * assembler's docblock above). Batches AVESMAPS_WIKI_TITLE_BATCH_SIZE (=20,
 * sync.php:8) titles per call, same as the reused function.
 */
function avesmapsWikiDumpCategoryFetchPageCategoriesReadOnly(array $titles): array {
    $pagesByRequestedTitle = [];
    if ($titles === []) {
        return $pagesByRequestedTitle;
    }

    foreach (array_chunk($titles, avesmapsWikiSyncTitleBatchSize()) as $batch) {
        $params = [
            'action' => 'query',
            'titles' => implode('|', $batch),
            'redirects' => '1',
            'prop' => 'categories',
            'cllimit' => 'max',
        ];

        $data = avesmapsWikiSyncApiRequest($params);
        $query = $data['query'] ?? [];
        $normalizedTitles = [];
        foreach (($query['normalized'] ?? []) as $item) {
            if (!empty($item['from']) && !empty($item['to'])) {
                $normalizedTitles[(string) $item['from']] = (string) $item['to'];
            }
        }
        $redirectTitles = [];
        foreach (($query['redirects'] ?? []) as $item) {
            if (!empty($item['from']) && !empty($item['to'])) {
                $redirectTitles[(string) $item['from']] = (string) $item['to'];
            }
        }
        $pagesByTitle = [];
        foreach (($query['pages'] ?? []) as $page) {
            if (!empty($page['title']) && empty($page['missing'])) {
                $pagesByTitle[(string) $page['title']] = $page;
            }
        }

        foreach ($batch as $requestedTitle) {
            $normalizedTitle = $normalizedTitles[$requestedTitle] ?? $requestedTitle;
            $resolvedTitle = $redirectTitles[$normalizedTitle] ?? $redirectTitles[$requestedTitle] ?? $normalizedTitle;
            $page = $pagesByTitle[$resolvedTitle] ?? null;
            if (is_array($page)) {
                // Deliberately NO avesmapsWikiSyncUpsertPageCache call here -- see the
                // "$persist=false DECISION" docblock at the top of this file.
                $pagesByRequestedTitle[$requestedTitle] = $page;
            }
        }
    }

    return $pagesByRequestedTitle;
}

/**
 * OUTER resumable fetch: batches the given title list AVESMAPS_WIKI_TITLE_BATCH_SIZE
 * (=20) at a time, spends at most $callBudget API calls (one per batch), and
 * returns { map, nextCursor, done } so H4 can loop this across steps. See the
 * "RESUMABLE-CURSOR CONTRACT" docblock at the top of this file for the full
 * contract (including the documented discrepancy vs. the brief's literal
 * "nextCursor=40" example).
 *
 * $callBudget = null means "no limit -- process the whole list in this call"
 * (only safe for small inputs/tests; H4's real orchestration MUST pass an
 * explicit budget so a single step never exceeds STRATO's runtime ceiling,
 * consistent with how avesmapsWikiDumpRunPassBStep bounds itself by page
 * budget, dump-entity-scan.php:1348-1352).
 *
 * $batchPageFetcher defaults to this module's own read-only sibling
 * (avesmapsWikiDumpCategoryFetchPageCategoriesReadOnly) so production callers
 * get the READ-ONLY behaviour automatically; a caller (this module's own
 * test) may inject a fake `(array $batchTitles): array` callable to avoid
 * live HTTP entirely.
 */
function avesmapsWikiDumpCategoryFetchContinentMap(
    array $titles,
    int $cursor = 0,
    ?int $callBudget = null,
    ?callable $batchPageFetcher = null
): array {
    $batchPageFetcher ??= 'avesmapsWikiDumpCategoryFetchPageCategoriesReadOnly';

    $total = count($titles);
    $cursor = max(0, min($cursor, $total));
    $map = [];
    $deities = [];
    $callsMade = 0;
    // 💣 EINMAL fragen, nicht je Runde: die Stapelgroesse haengt an der Anmeldung, und ein
    // Wechsel mitten im Lauf verschoebe den Cursor gegen die bereits gezaehlten Aufrufe.
    $stapel = avesmapsWikiSyncTitleBatchSize();

    while ($cursor < $total) {
        if ($callBudget !== null && $callsMade >= $callBudget) {
            break;
        }

        $batch = array_slice($titles, $cursor, $stapel);
        if ($batch === []) {
            break;
        }

        $pagesByRequestedTitle = $batchPageFetcher($batch);
        if (!is_array($pagesByRequestedTitle)) {
            $pagesByRequestedTitle = [];
        }
        $batchMap = avesmapsWikiDumpCategoryAssembleContinentMap($pagesByRequestedTitle);
        $map += $batchMap;
        // ⭐ Dieselbe Antwort, zweite Auswertung: die Goetter-Kategorie steht in genau diesen
        // Seiten und wurde bisher mit allem anderen verworfen. Additiv -- wer nur 'map' liest,
        // merkt davon nichts, und es kostet keine einzige zusaetzliche Abfrage.
        $deities += avesmapsWikiDumpCategoryAssembleDeityMap($pagesByRequestedTitle);

        $cursor += count($batch);
        $callsMade++;
    }

    return [
        'map' => $map,
        'deities' => $deities,
        'nextCursor' => $cursor,
        'done' => $cursor >= $total,
    ];
}
