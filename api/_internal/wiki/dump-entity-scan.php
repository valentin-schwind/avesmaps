<?php

declare(strict_types=1);

/**
 * WikiDump migration -- Pass B: entity enumeration + entity handlers.
 * ---------------------------------------------------------------------------
 * Pass A (dump-reader.php) extracts redirect aliases. Pass B walks the SAME
 * page stream (avesmapsWikiDumpIteratePages) and, for each Main-namespace
 * (ns 0) page, detects WHICH infobox it carries and routes the page to the
 * matching entity handler -- exactly the work the online crawlers did today,
 * just fed from the dump instead of the MediaWiki API.
 *
 * SCOPE OF THIS FILE (Tasks 4a + 4b): the generic Pass-B dispatch scaffold + two
 * entity handlers -- PATHS (Fluss / Straße, Task 4a) and REGIONS (Infobox Region /
 * Landschaft, Task 4b). Territory / Settlement / Building are recognised by the
 * classifier but deliberately left UNHANDLED here -- they are clean extension
 * points for tasks 4c-4d, which add a handler WITHOUT rewriting the dispatch loop
 * (see avesmapsWikiDumpClassifyEntityKind + the dispatch in
 * avesmapsWikiDumpCollectEntities / avesmapsWikiDumpRunPassBStep).
 *
 * The REGION handler (Task 4b) is a tight analogue of the PATH handler: it CALLS
 * the real region crawler's parse+upsert (avesmapsWikiRegionParsePage /
 * avesmapsWikiRegionUpsertRecord, regions.php:440/579) and applies the same
 * Aventurien-only continent filter. It writes ONLY to wiki_region_staging (via the
 * reused upsert); attaching a staged region to a map label
 * (avesmapsWikiRegionAssign) is a SEPARATE step it neither calls nor changes (I2).
 * NB the classifier routes {{Infobox Landschaft}} to the region kind, but the real
 * region parser accepts only an Infobox *Region* -- a Landschaft page is therefore
 * CLASSIFIED region yet produces no record. The handler faithfully reports that
 * (kept=false, record=null) rather than re-implementing/loosening the parser gate.
 *
 * INVARIANTS (non-negotiable, verified in tools/wikidump/test-dump-entities.php):
 *
 *   O4  Enumeration is by INFOBOX PRESENCE only -- the infobox template name in
 *       the wikitext (avesmapsWikiSyncMonitorInfoboxName). No category scan is
 *       used to *decide* the entity kind. (Category links ARE read, but only to
 *       feed the continent detector below -- the same signal the online crawler
 *       fetched via the API. They never gate classification.)
 *
 *   I1  Field mapping + key derivation are NEVER re-implemented here. The path
 *       handler CALLS the real avesmapsWikiPathParsePage() (paths.php:333),
 *       which itself derives:
 *         - match_key = avesmapsWikiSyncCreateMatchKey($name)   (paths.php:401)
 *         - wiki_key  = avesmapsPoliticalSlug($canonicalTitle)  (paths.php:398)
 *         - continent = avesmapsWikiSyncMonitorDetectContinent(...) (paths.php:376)
 *       and PERSIST calls the real avesmapsWikiPathUpsertRecord() (paths.php:462).
 *       This file adds ZERO field-mapping or key logic of its own.
 *
 *   I2  Pass B writes ONLY to wiki_path_staging (via the reused upsert). It never
 *       touches map_features -- no geometry_json, no feature_subtype, no
 *       location name/coords. Assigning staging -> map_features is a SEPARATE
 *       step (avesmapsWikiPathAssign*), which this file does not call or change.
 *
 *   Continent filter = Aventurien only, via the real DetectContinent(); a path
 *   whose detected continent is not Aventurien (e.g. a Myranor river) is dropped
 *   from the produced records (and from persistence).
 *
 * PURITY / DB-FREE CORE: side-effect-free on include (only const + function
 * definitions -- no top-level code, no DB connect, no headers). The CORE
 * (classify + parse + keep/skip decision + collect) is entirely DB-free and is
 * unit-tested against a fixture with no MySQL. Every DB touch lives in a
 * separate function that takes a PDO (avesmapsWikiDumpPersistPathRecords /
 * avesmapsWikiDumpRunPassBStep); those are NOT exercised by the fixture test and
 * their live verification is deferred to the controlled rollout / compare-test.
 *
 * DEPENDENCIES (the caller loads these before invoking Pass B -- same contract as
 * dump-reader.php; the reused derivation functions call mb_*):
 *   political/territory.php, wiki/sync.php, wiki/sync-monitor.php (-> -parsing),
 *   wiki/territories-tree.php + wiki/territories-parsing.php (Clean* helper),
 *   wiki/paths.php (path ParsePage / UpsertRecord), wiki/regions.php (region
 *   ParsePage / UpsertRecord), plus wiki/dump-reader.php for the page stream. This
 *   file requires nothing on include.
 */

// ===========================================================================
// 1. Entity enumeration + dispatch table (extension point for 4b-4d).
// ===========================================================================

/**
 * Entity kinds Pass B recognises from an infobox name. 'path' is the only kind
 * HANDLED in Task 4a; the rest are recognised-but-unhandled placeholders so the
 * classifier already maps them and later tasks only add a handler (they do not
 * touch the classifier or the loop). '' = no/unknown infobox -> the page is
 * skipped.
 */
const AVESMAPS_WIKI_DUMP_ENTITY_PATH = 'path';             // 4a (handled)
const AVESMAPS_WIKI_DUMP_ENTITY_REGION = 'region';         // 4b (handled)
const AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY = 'territory';   // 4c (unhandled here)
const AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT = 'settlement'; // 4c (unhandled here)
const AVESMAPS_WIKI_DUMP_ENTITY_BUILDING = 'building';     // 4d (unhandled here)

/**
 * The set of entity kinds this task actually processes. A dispatcher can test
 * membership to decide whether a page is routed to a handler or merely counted
 * as "recognised". Later tasks extend this set as their handlers land.
 *
 * Handled so far: PATH (Task 4a) and REGION (Task 4b). Territory / Settlement /
 * Building stay recognised-but-unhandled until 4c/4d add their handlers.
 *
 * @return array<int, string>
 */
function avesmapsWikiDumpHandledEntityKinds(): array
{
    return [AVESMAPS_WIKI_DUMP_ENTITY_PATH, AVESMAPS_WIKI_DUMP_ENTITY_REGION];
}

/**
 * Classify a page's ENTITY KIND purely from its infobox template name (O4:
 * infobox-presence enumeration, no category scan). Mirrors the substring tests
 * the online parsers use on the normalised infobox key
 * (avesmapsWikiSyncMonitorFieldKey), so classification is consistent with
 * avesmapsWikiPathParsePage()'s own fluss/strasse detection (paths.php:339-340)
 * and avesmapsWikiSyncMonitorParsePage()'s staat/siedlung detection
 * (sync-monitor-parsing.php:444-453).
 *
 * Order matters only where names overlap; the concrete infoboxes here are
 * disjoint on these needles:
 *   Fluss / Straße           -> 'path'        (handled, 4a)
 *   Region / Landschaft      -> 'region'      (handled, 4b)
 *   Staat / Herrschaftsgebiet / Reich -> 'territory'   (unhandled here)
 *   Bauwerk / Festung / Burg -> 'building'             (unhandled here)
 *   Siedlung / Stadt / Ort   -> 'settlement'           (unhandled here)
 *   (none of the above)      -> ''                     (skip)
 *
 * NB: 'building' is tested before 'settlement' because a Bauwerk infobox never
 * carries a settlement needle, but keeping the explicit ordering documents the
 * intent for the 4c/4d authors.
 */
function avesmapsWikiDumpClassifyEntityKind(string $infoboxName): string
{
    $key = avesmapsWikiSyncMonitorFieldKey($infoboxName);
    if ($key === '') {
        return '';
    }

    // PATHS (handled in 4a).
    if (str_contains($key, 'fluss') || str_contains($key, 'strasse')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_PATH;
    }

    // TERRITORIES (4b) -- Staat / Herrschaftsgebiet / Reich.
    if (str_contains($key, 'staat') || str_contains($key, 'herrschaftsgebiet') || str_contains($key, 'reich')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY;
    }

    // BUILDINGS (4d) -- Bauwerk / Festung / Burg. Checked before settlement so a
    // "Burg"/"Festung" is not swallowed by a broad settlement needle.
    if (str_contains($key, 'bauwerk') || str_contains($key, 'festung') || str_contains($key, 'burg')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_BUILDING;
    }

    // SETTLEMENTS (4c) -- Siedlung / Stadt / Ort.
    if (str_contains($key, 'siedlung') || str_contains($key, 'stadt') || str_contains($key, 'ort')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT;
    }

    // REGIONS (4d) -- Region / Landschaft.
    if (str_contains($key, 'region') || str_contains($key, 'landschaft')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_REGION;
    }

    return '';
}

/**
 * Classify a single page row (as produced by avesmapsWikiDumpIteratePages).
 * Non-Main-namespace pages (ns != 0) and redirect pages are never entities, so
 * they short-circuit to '' regardless of any stray infobox in their wikitext.
 * Otherwise the entity kind is read from the infobox name (O4).
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 */
function avesmapsWikiDumpClassifyPage(array $page): string
{
    if ((int) ($page['ns'] ?? 0) !== 0) {
        return ''; // only Main namespace carries article entities
    }
    $redirect = $page['redirect'] ?? null;
    if (is_string($redirect) && $redirect !== '') {
        return ''; // a redirect page is an alias (Pass A), never an entity
    }

    return avesmapsWikiDumpClassifyEntityKind(avesmapsWikiSyncMonitorInfoboxName((string) ($page['wikitext'] ?? '')));
}

// ===========================================================================
// 2. Continent-context assembly from dump wikitext (feeds DetectContinent).
// ===========================================================================

/**
 * Extract the `[[Kategorie:Name]]` / `[[Category:Name]]` names present in dump
 * wikitext, joined into one space-separated string. This is the dump-native
 * equivalent of the category list the ONLINE crawler fetched separately via the
 * API (avesmapsWikiSyncGetCategoryNames, paths.php:279) and passed into
 * avesmapsWikiPathParsePage() as its $categories argument.
 *
 * This is NOT field mapping or key derivation (I1 is about those): it only
 * assembles the SAME continent-detection signal from the dump, so the reused
 * DetectContinent() sees e.g. "Fluss (Myranor)" and classifies a Myranor river
 * as non-Aventurien exactly as it did online. Category links are always present
 * in dump wikitext, so no guessing is involved.
 */
function avesmapsWikiDumpExtractCategoryNames(string $wikitext): string
{
    if (preg_match_all('/\[\[\s*(?:Kategorie|Category)\s*:\s*([^\]|#]+)/iu', $wikitext, $matches) < 1) {
        return '';
    }

    $names = [];
    foreach ($matches[1] as $raw) {
        $name = trim((string) $raw);
        if ($name !== '') {
            $names[] = $name;
        }
    }

    return implode(' ', $names);
}

// ===========================================================================
// 3. PATH handler -- PURE (parse + keep/skip decision, DB-free).
// ===========================================================================

/**
 * PURE path handler for ONE dump page: build the staging record by REUSING the
 * real avesmapsWikiPathParsePage() (no field mapping duplicated), then apply the
 * Aventurien continent filter.
 *
 * The canonical title in a dump is the page's own <title> (the dump already
 * stores pages under their canonical title; redirects are separate pages handled
 * in Pass A), so title and canonicalTitle are the same here. Categories are
 * assembled from the wikitext (avesmapsWikiDumpExtractCategoryNames) so the
 * reused parser's continent detection behaves identically to the online path.
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 * @return array{
 *   kept: bool,
 *   reason: string,
 *   record: array<string, mixed>|null,
 *   continent: string
 * }
 *   kept=true only for a genuine path record whose continent is Aventurien.
 *   reason explains a skip ('not a path infobox' / parser reason / filtered
 *   continent). record is the exact record avesmapsWikiPathParsePage() produced
 *   (null when not a path or filtered).
 */
function avesmapsWikiDumpParsePathPage(array $page): array
{
    $title = (string) ($page['title'] ?? '');
    $wikitext = (string) ($page['wikitext'] ?? '');
    $categories = avesmapsWikiDumpExtractCategoryNames($wikitext);

    // Reuse the REAL parser verbatim (I1). canonicalTitle = title (dump pages are
    // canonical); source label mirrors the online 'seed'-style provenance.
    $parsed = avesmapsWikiPathParsePage($title, $wikitext, $title, 'dump', $categories);

    if (empty($parsed['is_path']) || !is_array($parsed['record'] ?? null)) {
        return [
            'kept' => false,
            'reason' => (string) ($parsed['reason'] ?? 'kein Weg'),
            'record' => null,
            'continent' => '',
        ];
    }

    $record = $parsed['record'];
    $continent = (string) ($record['continent'] ?? '');

    // Continent filter: Aventurien only. A path detected on another continent
    // (e.g. a Myranor river) is dropped -- never staged.
    if ($continent !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT) {
        return [
            'kept' => false,
            'reason' => 'Kontinent ' . ($continent !== '' ? $continent : '(unbekannt)') . ' != ' . AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
            'record' => $record,
            'continent' => $continent,
        ];
    }

    return ['kept' => true, 'reason' => '', 'record' => $record, 'continent' => $continent];
}

// ===========================================================================
// 3b. REGION handler -- PURE (parse + keep/skip decision, DB-free). Task 4b.
// ===========================================================================

/**
 * PURE region handler for ONE dump page -- the tight analogue of
 * avesmapsWikiDumpParsePathPage(). It builds the staging record by REUSING the
 * real avesmapsWikiRegionParsePage() (regions.php:440) verbatim -- no field
 * mapping or key derivation is duplicated here (I1). Inside that reused parse:
 *   - wiki_key   = avesmapsPoliticalSlug($canonical)          (regions.php:507)
 *   - match_key  = avesmapsWikiSyncCreateMatchKey($name)      (regions.php:510)
 *   - continent  = avesmapsWikiSyncMonitorDetectContinent(...) (regions.php:472)
 *   - art -> label_subtype mapping stays in avesmapsWikiRegionArtToSubtype()
 * and PERSIST (avesmapsWikiDumpPersistRegionRecords) calls the real
 * avesmapsWikiRegionUpsertRecord() (regions.php:579). This file adds ZERO
 * field/key/subtype logic of its own, and NEVER writes map_features /
 * geometry_json / feature_subtype / a label name/coords (I2/I3) -- staging only.
 *
 * As with the path handler, the dump page's <title> IS its canonical title, and
 * categories are assembled from the wikitext (avesmapsWikiDumpExtractCategoryNames)
 * so the reused parser's DetectContinent behaves identically to the online path.
 *
 * NB (Landschaft): the classifier routes {{Infobox Landschaft}} to the region
 * kind, but the real region parser accepts only an Infobox *Region* (its gate is
 * str_contains($infoboxKey, 'region'), regions.php:447). A Landschaft page is
 * therefore CLASSIFIED region yet parsed as is_region=false -> kept=false,
 * record=null. That is faithful to the real crawler (which only ever fed
 * {{Infobox Region}} pages); we do NOT loosen the gate to force a record.
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 * @return array{
 *   kept: bool,
 *   reason: string,
 *   record: array<string, mixed>|null,
 *   continent: string
 * }
 *   kept=true only for a genuine region record whose continent is Aventurien.
 *   reason explains a skip ('not a region infobox' / parser reason / filtered
 *   continent). record is the exact record avesmapsWikiRegionParsePage() produced
 *   (null when not a region or filtered).
 */
function avesmapsWikiDumpParseRegionPage(array $page): array
{
    $title = (string) ($page['title'] ?? '');
    $wikitext = (string) ($page['wikitext'] ?? '');
    $categories = avesmapsWikiDumpExtractCategoryNames($wikitext);

    // Reuse the REAL region parser verbatim (I1). canonicalTitle = title (dump
    // pages are canonical); source label mirrors the online provenance.
    $parsed = avesmapsWikiRegionParsePage($title, $wikitext, $title, 'dump', $categories);

    if (empty($parsed['is_region']) || !is_array($parsed['record'] ?? null)) {
        return [
            'kept' => false,
            'reason' => (string) ($parsed['reason'] ?? 'keine Region'),
            'record' => null,
            'continent' => '',
        ];
    }

    $record = $parsed['record'];
    $continent = (string) ($record['continent'] ?? '');

    // Continent filter: Aventurien only. A region detected on another continent
    // (e.g. a Myranor Gebirge) is dropped -- never staged.
    if ($continent !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT) {
        return [
            'kept' => false,
            'reason' => 'Kontinent ' . ($continent !== '' ? $continent : '(unbekannt)') . ' != ' . AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
            'record' => $record,
            'continent' => $continent,
        ];
    }

    return ['kept' => true, 'reason' => '', 'record' => $record, 'continent' => $continent];
}

// ===========================================================================
// 4. Collect / dry-run (DB-free) -- drives dispatch over a page stream.
// ===========================================================================

/**
 * PURE (DB-free) Pass-B collect over a page stream: classify every page and, for
 * a HANDLED kind (PATH or REGION), run the matching pure handler. Returns
 * everything the fixture test needs to assert enumeration + staging + the
 * continent filter WITHOUT any DB.
 *
 * This is the generic dispatch loop; 4c-4d extend it by adding their kind to the
 * match below (routing to their own pure handler) -- the enumeration and the
 * per-kind tally require no change.
 *
 * `records` mixes kept PATH and REGION staging records (each carries its own
 * fields; a caller that needs one kind uses avesmapsWikiDumpCollectPathRecords /
 * avesmapsWikiDumpCollectRegionRecords, which filter by classification). Every
 * `filtered` entry is tagged with its `kind` so a continent-drop can be attributed
 * to the right handler.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array{
 *   records: array<int, array<string, mixed>>,     // kept path+region staging records
 *   filtered: array<int, array{title:string, kind:string, continent:string, reason:string}>, // pages dropped by the continent filter
 *   classified: array<int, array{title:string, kind:string}>, // ns0 non-redirect pages that carried a recognised infobox
 *   counts: array<string, int>                     // entity-kind -> count of recognised pages (handled + unhandled)
 * }
 */
function avesmapsWikiDumpCollectEntities(iterable $pages): array
{
    $records = [];
    $filtered = [];
    $classified = [];
    $counts = [];

    foreach ($pages as $page) {
        $kind = avesmapsWikiDumpClassifyPage($page);
        if ($kind === '') {
            continue; // non-entity: wrong ns, a redirect, or no recognised infobox
        }

        $counts[$kind] = ($counts[$kind] ?? 0) + 1;
        $classified[] = ['title' => (string) ($page['title'] ?? ''), 'kind' => $kind];

        // ---- dispatch (extension point for 4c-4d) --------------------------
        // Each handled kind runs its pure handler; a kept record is collected, and
        // a genuine record dropped only by the continent filter is reported in
        // `filtered` (tagged with $kind). Recognised-but-unhandled kinds fall
        // through to default and are merely counted.
        $result = null;
        switch ($kind) {
            case AVESMAPS_WIKI_DUMP_ENTITY_PATH:
                $result = avesmapsWikiDumpParsePathPage($page);
                break;

            case AVESMAPS_WIKI_DUMP_ENTITY_REGION:
                $result = avesmapsWikiDumpParseRegionPage($page);
                break;

            // case AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY:   // 4c: add handler here
            // case AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT:  // 4c: add handler here
            // case AVESMAPS_WIKI_DUMP_ENTITY_BUILDING:    // 4d: add handler here
            default:
                // Recognised but unhandled in this task: counted above, no record.
                break;
        }

        if ($result === null) {
            continue;
        }
        if ($result['kept'] && is_array($result['record'])) {
            $records[] = $result['record'];
        } elseif ($result['record'] !== null) {
            // A real record dropped by the continent filter (not a parse miss).
            $filtered[] = [
                'title' => (string) ($page['title'] ?? ''),
                'kind' => $kind,
                'continent' => (string) $result['continent'],
                'reason' => (string) $result['reason'],
            ];
        }
    }

    return [
        'records' => $records,
        'filtered' => $filtered,
        'classified' => $classified,
        'counts' => $counts,
    ];
}

/**
 * Convenience DB-free collector that returns ONLY the kept PATH staging records
 * for a page stream (the records Pass B would upsert). Classifies each page and
 * runs the pure path handler; region/other kinds are ignored -- so this never
 * returns a region record even though avesmapsWikiDumpCollectEntities['records']
 * mixes both kinds.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<int, array<string, mixed>>
 */
function avesmapsWikiDumpCollectPathRecords(iterable $pages): array
{
    $records = [];
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_PATH) {
            continue;
        }
        $result = avesmapsWikiDumpParsePathPage($page);
        if ($result['kept'] && is_array($result['record'])) {
            $records[] = $result['record'];
        }
    }

    return $records;
}

/**
 * Convenience DB-free collector that returns ONLY the kept REGION staging records
 * for a page stream (the records Pass B would upsert). The region analogue of
 * avesmapsWikiDumpCollectPathRecords: classifies each page and runs the pure
 * region handler; path/other kinds are ignored. A {{Infobox Landschaft}} page
 * classifies as region but is rejected by the real parser, so it never appears
 * here (kept=false).
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<int, array<string, mixed>>
 */
function avesmapsWikiDumpCollectRegionRecords(iterable $pages): array
{
    $records = [];
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_REGION) {
            continue;
        }
        $result = avesmapsWikiDumpParseRegionPage($page);
        if ($result['kept'] && is_array($result['record'])) {
            $records[] = $result['record'];
        }
    }

    return $records;
}

// ===========================================================================
// 5. PERSIST (DB-backed, deferred) + read_step scaffold.
// ===========================================================================

/**
 * THIN persistence for the PATH handler: for each page in the stream, run the
 * pure handler and, for kept records, upsert into wiki_path_staging by REUSING
 * the real avesmapsWikiPathUpsertRecord() (paths.php:462). No new upsert here;
 * no map_features write (I2).
 *
 * DB-backed -> NOT covered by the fixture test; live-verified in the controlled
 * rollout / compare-test. Nothing calls it automatically yet.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return int number of path records upserted (Aventurien only)
 */
function avesmapsWikiDumpPersistPathRecords(PDO $pdo, iterable $pages): int
{
    $written = 0;
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_PATH) {
            continue;
        }
        $result = avesmapsWikiDumpParsePathPage($page);
        if ($result['kept'] && is_array($result['record'])) {
            avesmapsWikiPathUpsertRecord($pdo, $result['record']); // reused real upsert
            $written++;
        }
    }

    return $written;
}

/**
 * THIN persistence for the REGION handler -- the analogue of
 * avesmapsWikiDumpPersistPathRecords(). For each page in the stream, run the pure
 * region handler and, for kept records, upsert into wiki_region_staging by REUSING
 * the real avesmapsWikiRegionUpsertRecord() (regions.php:579). No new upsert here;
 * no map_features write (I2/I3 -- staging only; attaching a region to a label via
 * avesmapsWikiRegionAssign is a separate step this never calls).
 *
 * DB-backed -> NOT covered by the fixture test; live-verified in the controlled
 * rollout / compare-test. Nothing calls it automatically yet.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return int number of region records upserted (Aventurien only)
 */
function avesmapsWikiDumpPersistRegionRecords(PDO $pdo, iterable $pages): int
{
    $written = 0;
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_REGION) {
            continue;
        }
        $result = avesmapsWikiDumpParseRegionPage($page);
        if ($result['kept'] && is_array($result['record'])) {
            avesmapsWikiRegionUpsertRecord($pdo, $result['record']); // reused real upsert
            $written++;
        }
    }

    return $written;
}

/**
 * Process ONE bounded Pass-B step over the dump, resuming from a page-counter
 * cursor and persisting the recognised entities of this batch. Mirrors the
 * Pass-A step discipline in dump-reader.php (reopen-from-start + skip N + bounded
 * batch + set_time_limit) and reuses the reused entity handlers above.
 *
 * Tasks 4a + 4b persist the PATH and REGION entities (the handled kinds); each
 * routes to its own reused parse+upsert. Recognised-but-unhandled kinds are
 * tallied for progress but not written until 4c-4d land.
 *
 * DB- AND dump-backed -> NOT exercised by the local fixture test. Its live
 * verification is DEFERRED to the controlled rollout / compare-test; nothing
 * calls it automatically yet. Kept intentionally thin (structure, not behaviour
 * under test) per the Task-4a/4b briefs.
 *
 * @return array{ok:bool, done:bool, cursor:int, processed_this_step:int, paths_written:int, regions_written:int}
 */
function avesmapsWikiDumpRunPassBStep(PDO $pdo, string $dumpPath, int $cursor = 0, ?int $pageBudget = null): array
{
    $pageBudget = $pageBudget ?? AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET;
    @set_time_limit(AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + AVESMAPS_WIKI_DUMP_STEP_SECONDS;

    $reader = avesmapsWikiDumpOpenReader($dumpPath);

    $processedThisStep = 0;
    $pathsWritten = 0;
    $regionsWritten = 0;
    $done = false;

    try {
        foreach (avesmapsWikiDumpIteratePages($reader, max(0, $cursor)) as $page) {
            $processedThisStep++;

            switch (avesmapsWikiDumpClassifyPage($page)) {
                case AVESMAPS_WIKI_DUMP_ENTITY_PATH:
                    $result = avesmapsWikiDumpParsePathPage($page);
                    if ($result['kept'] && is_array($result['record'])) {
                        avesmapsWikiPathUpsertRecord($pdo, $result['record']);
                        $pathsWritten++;
                    }
                    break;

                case AVESMAPS_WIKI_DUMP_ENTITY_REGION:
                    $result = avesmapsWikiDumpParseRegionPage($page);
                    if ($result['kept'] && is_array($result['record'])) {
                        avesmapsWikiRegionUpsertRecord($pdo, $result['record']);
                        $regionsWritten++;
                    }
                    break;
            }

            if ($processedThisStep >= $pageBudget || microtime(true) >= $deadline) {
                break;
            }
        }
        if ($processedThisStep < $pageBudget && microtime(true) < $deadline) {
            $done = true; // stream exhausted before hitting the budget
        }
    } finally {
        $reader->close();
    }

    return [
        'ok' => true,
        'done' => $done,
        'cursor' => max(0, $cursor) + $processedThisStep,
        'processed_this_step' => $processedThisStep,
        'paths_written' => $pathsWritten,
        'regions_written' => $regionsWritten,
    ];
}
