<?php

declare(strict_types=1);

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
 * THE RESUMABLE-CURSOR CONTRACT (continent map)
 * ===========================================================================
 * avesmapsWikiDumpCategoryFetchContinentMap() processes the given title list
 * in batches of AVESMAPS_WIKI_TITLE_BATCH_SIZE (=20, sync.php:8), spending
 * exactly one API call per batch, and stops once it has spent $callBudget API
 * calls (default: process everything in one call if $callBudget is null --
 * only used by tests/small inputs; production call sites MUST pass an
 * explicit budget). It returns { map, nextCursor, done } so a caller (H4) can
 * loop: pass nextCursor back in as $cursor on the next call, and stop once
 * done=true. This mirrors avesmapsWikiDumpRunPassBStep's cursor/pageBudget
 * pattern (dump-entity-scan.php:1348) applied to API-call budget instead of
 * page count, since this is the ONLY one of the three builders that makes
 * many live HTTP calls (approx 450 throttled calls over approx 9k titles,
 * recon section 3/4.4) -- the class/building maps are each a handful of
 * category-crawl calls and need no cursor.
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
// (1) SETTLEMENT CLASS MAP
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
 * OUTER fetch: walks the 5 real class categories via the reused
 * avesmapsWikiSyncFetchCategoryMemberTitles($categoryName) (locations.php:52-88)
 * and feeds the assembler above. $categoryMemberFetcher defaults to the real
 * fetcher; a caller (this module's own test) may inject a fake to avoid live
 * HTTP -- the injected callable has the exact same
 * `(string $categoryName): array` shape as avesmapsWikiSyncFetchCategoryMemberTitles.
 *
 * This is a single-step builder (5 category-crawl calls total, each already
 * internally paginated by the reused fetcher) -- no cursor/budget needed,
 * unlike the continent map.
 */
function avesmapsWikiDumpCategoryFetchSettlementClassMap(?callable $categoryMemberFetcher = null): array {
    $categoryMemberFetcher ??= 'avesmapsWikiSyncFetchCategoryMemberTitles';

    $categoryToTitles = [];
    foreach (avesmapsWikiSyncFetchSiedlungenIndexCategories() as $categoryName) {
        $categoryToTitles[$categoryName] = $categoryMemberFetcher($categoryName);
    }

    return avesmapsWikiDumpCategoryAssembleClassMap($categoryToTitles);
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
 * OUTER fetch: mirrors avesmapsWikiSettlementCrawlBuildings (settlements.php:
 * 929-962) up to (but NOT including) its PDO-writing tail -- this builder
 * returns the map only; persistence happens later in H4 via the existing
 * avesmapsWikiSettlementUpsertBuildingRow.
 *
 * Steps (identical to the reused crawler):
 *   1. List live subcats of "Bauwerk nach Art" via the reused
 *      avesmapsWikiSettlementFetchSubcategories (settlements.php:887-905).
 *   2. Append any AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES
 *      (settlements.php:67-69) not already present (same online catalog is a
 *      superset of the static legacy list, recon 2.2).
 *   3. Filter excluded linear-infrastructure types via the reused
 *      avesmapsWikiSettlementIsExcludedBuildingType (settlements.php:988-992)
 *      -- mirrors avesmapsWikiSettlementBuildingTypes's filter
 *      (settlements.php:969-984), which avesmapsWikiSettlementCrawlBuildings
 *      itself does NOT apply; H1's breadth set should not include
 *      Straße/Reichsstraße/etc., which belong to the separate Wege-WikiSync.
 *   4. For each surviving type, call the reused
 *      avesmapsWikiSyncFetchCategoryMemberTitles($categoryName)
 *      (locations.php:52-88) directly (depth-0 direct members only, same as
 *      avesmapsWikiSettlementCrawlBuildings's depth=0 pass) and feed the
 *      assembler above.
 *
 * $subcategoryFetcher / $categoryMemberFetcher default to the real reused
 * fetchers; a caller may inject fakes (this module's own test does, to prove
 * the real root category "Bauwerk nach Art" + the real legacy type list are
 * used, without live HTTP).
 */
function avesmapsWikiDumpCategoryFetchBuildingTypeMap(
    ?callable $subcategoryFetcher = null,
    ?callable $categoryMemberFetcher = null
): array {
    $subcategoryFetcher ??= 'avesmapsWikiSettlementFetchSubcategories';
    $categoryMemberFetcher ??= 'avesmapsWikiSyncFetchCategoryMemberTitles';

    $types = $subcategoryFetcher('Bauwerk nach Art');
    if (!is_array($types)) {
        $types = [];
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

    $typeToTitles = [];
    foreach ($types as $type) {
        $typeToTitles[$type] = $categoryMemberFetcher($type);
    }

    return avesmapsWikiDumpCategoryAssembleBuildingMap($typeToTitles);
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

    foreach (array_chunk($titles, AVESMAPS_WIKI_TITLE_BATCH_SIZE) as $batch) {
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
    $callsMade = 0;

    while ($cursor < $total) {
        if ($callBudget !== null && $callsMade >= $callBudget) {
            break;
        }

        $batch = array_slice($titles, $cursor, AVESMAPS_WIKI_TITLE_BATCH_SIZE);
        if ($batch === []) {
            break;
        }

        $pagesByRequestedTitle = $batchPageFetcher($batch);
        if (!is_array($pagesByRequestedTitle)) {
            $pagesByRequestedTitle = [];
        }
        $batchMap = avesmapsWikiDumpCategoryAssembleContinentMap($pagesByRequestedTitle);
        $map += $batchMap;

        $cursor += count($batch);
        $callsMade++;
    }

    return [
        'map' => $map,
        'nextCursor' => $cursor,
        'done' => $cursor >= $total,
    ];
}
