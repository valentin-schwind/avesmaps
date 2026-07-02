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
 * SCOPE OF THIS FILE (Tasks 4a-4d): the generic Pass-B dispatch scaffold + five
 * entity handlers -- PATHS (Fluss / Straße, Task 4a), REGIONS (Infobox Region /
 * Landschaft, Task 4b), SETTLEMENTS (Infobox Siedlung, Task 4c), BUILDINGS
 * (Infobox Bauwerk / Festung / Burg, Task 4c2) and TERRITORIES (Infobox Staat /
 * Herrschaftsgebiet / Reich, Task 4d). The territory handler was the last clean
 * extension point: it adds a handler WITHOUT rewriting the dispatch loop (see
 * avesmapsWikiDumpClassifyEntityKind + the dispatch in
 * avesmapsWikiDumpCollectEntities / avesmapsWikiDumpRunPassBStep).
 *
 * The TERRITORY handler (Task 4d) is the highest-risk entity (hierarchy + wiki_key)
 * but a pure reuse: it CALLS the online sync-monitor crawler's OWN offline parser
 * avesmapsWikiSyncMonitorParsePage (sync-monitor-parsing.php:429), which itself
 * derives wiki_key via avesmapsPoliticalBuildWikiKey (the Task-1 territory scheme),
 * maps every field via avesmapsPoliticalNormalizeWikiRecord, parses |Staat=->
 * affiliation via avesmapsWikiSyncMonitorParseAffiliation, and resolves BF years via
 * avesmapsWikiSyncBuildPoliticalTemporalPayload. PERSIST writes the record to the
 * EXISTING sandbox political_territory_wiki_test (avesmapsWikiSyncMonitorUpsertTestRecord,
 * sync-monitor-licenses.php:273) and registers the title-slug->wiki_key alias
 * (avesmapsWikiSyncMonitorStoreAlias, sync-monitor-model.php:35) so REBUILD's parent
 * resolution (ResolveParentKey) can resolve a child's |Staat= parent (I7). The
 * REBUILD -> DIFF -> TEST -> APPLY editor flow + wiki_territory_model stay 1:1 --
 * this file NEVER writes wiki_territory_model, political_territory (production) or
 * political_territory_geometry (I3), and the derived hierarchy (parent_id) + editor
 * overrides (parent_locked, I4) are computed later by REBUILD from the sandbox's
 * affiliation fields. See avesmapsWikiDumpParseTerritoryPage.
 *
 * The BUILDING handler (Task 4c2) is the simplest entity: the online building
 * crawler never parses the building infobox, it only records title +
 * settlement_class='gebaeude' + settlement_label + building_type (the crawled
 * category name) + is_ruined. Pass B reproduces that from the dump, REUSING the
 * online crawler's own legacy building-type list + Art-based ruin detection + the
 * gebaeude label + its title-keyed row upsert (avesmapsWikiSettlementMatchBuildingType
 * / avesmapsWikiSettlementBuildEnrichment / avesmapsWikiSettlementClassLabel /
 * avesmapsWikiSettlementUpsertBuildingRow, settlements.php). building_type diverges
 * only in derivation (dump = literal [[Kategorie:]] + Art; online = category
 * enumeration, which the dump lacks, I6) -- see avesmapsWikiDumpParseBuildingPage.
 *
 * The REGION handler (Task 4b) is a tight analogue of the PATH handler: it CALLS
 * the real region crawler's parse+upsert (avesmapsWikiRegionParsePage /
 * avesmapsWikiRegionUpsertRecord, regions.php:440/579) and, like every handler,
 * keeps all continents (keep-all). It writes ONLY to wiki_region_staging (via the
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
 *   Continent = KEEP-ALL (owner decision): the real DetectContinent() still labels
 *   every entity with its true continent (e.g. a Myranor river as "Myranor /
 *   Güldenland"), and that VALUE is carried on the record, but the continent is no
 *   longer a keep/drop gate -- EVERY continent is staged, so the dump mirrors the
 *   online-crawler DB (which never filtered by continent).
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
 *   _internal/bootstrap.php (avesmapsNormalizeSingleLine, needed by the territory
 *   handler's reused avesmapsPoliticalNormalizeWikiRecord -- side-effect-free on
 *   include), political/territory.php, wiki/sync.php, wiki/sync-monitor.php (which
 *   require_once's -parsing = avesmapsWikiSyncMonitorParsePage, -licenses =
 *   avesmapsWikiSyncMonitorUpsertTestRecord, -model = avesmapsWikiSyncMonitorStoreAlias),
 *   wiki/territories.php (avesmapsWikiSyncBuildPoliticalTemporalPayload),
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
const AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT = 'settlement'; // 4c (handled)
const AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY = 'territory';   // 4d (handled)
const AVESMAPS_WIKI_DUMP_ENTITY_BUILDING = 'building';     // 4c2 (handled)

/**
 * The set of entity kinds this task actually processes. A dispatcher can test
 * membership to decide whether a page is routed to a handler or merely counted
 * as "recognised". Later tasks extend this set as their handlers land.
 *
 * Handled: PATH (Task 4a), REGION (Task 4b), SETTLEMENT (Task 4c), BUILDING
 * (Task 4c2) and TERRITORY (Task 4d) -- every recognised kind now has a handler.
 *
 * @return array<int, string>
 */
function avesmapsWikiDumpHandledEntityKinds(): array
{
    return [
        AVESMAPS_WIKI_DUMP_ENTITY_PATH,
        AVESMAPS_WIKI_DUMP_ENTITY_REGION,
        AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT,
        AVESMAPS_WIKI_DUMP_ENTITY_BUILDING,
        AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY,
    ];
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
 *   Staat / Herrschaftsgebiet / Reich -> 'territory'   (handled, 4d)
 *   Bauwerk / Festung / Burg -> 'building'    (handled, 4c2)
 *   Siedlung / Stadt / Ort   -> 'settlement'  (handled, 4c)
 *   (none of the above)      -> ''            (skip)
 *
 * NB: 'building' is tested before 'settlement' because a Bauwerk infobox never
 * carries a settlement needle, but keeping the explicit ordering documents the
 * intent (a "Burg"/"Festung" must not be swallowed by a broad settlement needle).
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

    // TERRITORIES (4d) -- Staat / Herrschaftsgebiet / Reich.
    if (str_contains($key, 'staat') || str_contains($key, 'herrschaftsgebiet') || str_contains($key, 'reich')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY;
    }

    // BUILDINGS (4c2) -- Bauwerk / Festung / Burg. Checked before settlement so a
    // "Burg"/"Festung" is not swallowed by a broad settlement needle.
    if (str_contains($key, 'bauwerk') || str_contains($key, 'festung') || str_contains($key, 'burg')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_BUILDING;
    }

    // SETTLEMENTS (4c, handled) -- Siedlung / Stadt / Ort.
    if (str_contains($key, 'siedlung') || str_contains($key, 'stadt') || str_contains($key, 'ort')) {
        return AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT;
    }

    // REGIONS (4b) -- Region / Landschaft.
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
 * real avesmapsWikiPathParsePage() (no field mapping duplicated). The detected
 * continent is carried on the record but is NOT a keep/drop gate (keep-all).
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
 *   kept=true for any genuine path record (keep-all across continents). reason
 *   explains a skip ('not a path infobox' / parser reason). record is the exact
 *   record avesmapsWikiPathParsePage() produced (null only when not a path).
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

    // Keep-all: every continent is staged (owner decision -- the dump mirrors the
    // online-crawler DB, which never filtered by continent). The detected continent
    // VALUE is still carried on the record; only the keep/drop decision is keep-all.
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
 * H3 (hybrid override, additive): optional $override['continent'] -- when set to a
 * non-empty string, REPLACES the dump-derived $record['continent'] (from the reused
 * avesmapsWikiRegionParsePage()'s internal DetectContinent) with the online
 * category-enumeration's ground-truth value (H1) so the record carries the trusted
 * continent (kept regardless -- keep-all, no filter). $override = [] (the default)
 * reproduces current behaviour bit-for-bit -- no field is substituted. This never
 * re-derives or transforms the override value (I1); it only substitutes it.
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 * @param array{continent?: ?string} $override H3 hybrid override (optional, default none).
 * @return array{
 *   kept: bool,
 *   reason: string,
 *   record: array<string, mixed>|null,
 *   continent: string
 * }
 *   kept=true for any genuine region record (keep-all across continents). reason
 *   explains a skip ('not a region infobox' / parser reason). record is the exact
 *   record avesmapsWikiRegionParsePage() produced (null only when not a region).
 */
function avesmapsWikiDumpParseRegionPage(array $page, array $override = []): array
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

    // H3 hybrid override: a non-empty $override['continent'] wins over the
    // dump-only derivation above (I1 -- substitute only, never re-derive). Absent
    // override -> $continent stays the reused parser's own DetectContinent verdict.
    if (isset($override['continent']) && is_string($override['continent']) && $override['continent'] !== '') {
        $continent = $override['continent'];
        $record['continent'] = mb_substr($continent, 0, 120, 'UTF-8');
    }

    // Keep-all: every continent is staged (owner decision -- the dump mirrors the
    // online-crawler DB, which never filtered by continent). The detected/overridden
    // continent VALUE is still carried on the record; only keep/drop is keep-all.
    return ['kept' => true, 'reason' => '', 'record' => $record, 'continent' => $continent];
}

// ===========================================================================
// 3c. SETTLEMENT handler -- PURE (parse + enrich + keep/skip, DB-free). Task 4c.
// ===========================================================================

/**
 * Reconstruct a MediaWiki-API-shaped `$page` array from a dump page row, so the
 * reused settlement functions -- which were written against the online crawler's
 * API response -- run UNCHANGED on dump input. This is the settlement analogue of
 * avesmapsWikiDumpExtractCategoryNames(): it is continent/enrichment PLUMBING, not
 * field mapping (I1 is about field/key mapping, which stays inside the reused
 * parse/enrich). Two API shapes are reproduced from the dump:
 *
 *   - categories: [{title:'Kategorie:<Name>'}, ...] rebuilt from the page's
 *     literal [[Kategorie:...]] links. This is the SAME list the reused
 *     avesmapsWikiSyncGetCategoryNames()/avesmapsWikiSyncSettlementClassFromPage()
 *     read online (there via the API's prop=categories). NB the dump only carries
 *     LITERAL category links (I6): template-injected categories the online API
 *     also returned are absent here -- see the settlement-class watch-item in the
 *     handler doc below.
 *   - revisions[0].slots.main.content: the wikitext, exactly where
 *     avesmapsWikiSyncReadPageContent() (locations.php) looks for it -- so
 *     avesmapsWikiSettlementBuildEnrichment() reads the dump body verbatim.
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 * @return array{title:string, categories:array<int,array{title:string}>, revisions:array<int,array>}
 */
function avesmapsWikiDumpBuildApiPageFromDump(array $page): array
{
    $title = (string) ($page['title'] ?? '');
    $wikitext = (string) ($page['wikitext'] ?? '');

    $categories = [];
    if (preg_match_all('/\[\[\s*(?:Kategorie|Category)\s*:\s*([^\]|#]+)/iu', $wikitext, $matches) >= 1) {
        foreach ($matches[1] as $raw) {
            $name = trim((string) $raw);
            if ($name !== '') {
                $categories[] = ['title' => 'Kategorie:' . $name];
            }
        }
    }

    return [
        'title' => $title,
        'categories' => $categories,
        // Mirror the online API's revisions/slots/main/content shape so the reused
        // avesmapsWikiSyncReadPageContent() finds the dump wikitext unchanged.
        'revisions' => [['slots' => ['main' => ['content' => $wikitext]]]],
    ];
}

/**
 * PURE settlement handler for ONE dump page -- the settlement analogue of
 * avesmapsWikiDumpParseRegionPage(). It assembles the wiki_sync_pages registry
 * record by REUSING the real settlement functions verbatim (I1) -- NO field
 * mapping, key derivation, class inference, coordinate parsing or coat extraction
 * is duplicated here:
 *   - settlement_class/label = avesmapsWikiSyncSettlementClassFromPage($apiPage)
 *       (locations-helpers.php:361) -> AVESMAPS_WIKI_CATEGORY_TO_CLASS, the SAME
 *       category-driven derivation the online crawl used AND that the reused base
 *       upsert (avesmapsWikiSyncUpsertPageCache) re-applies. Null (no class
 *       category) falls back to 'dorf' via avesmapsWikiSettlementParseInfobox.
 *   - infobox fields        = avesmapsWikiSettlementParseInfobox($title,$wikitext,$class)
 *       (settlements.php:451) -> name, art (from ['siedlungsart','art','typ']),
 *       wiki_key = avesmapsPoliticalSlug($title), match_key =
 *       avesmapsWikiSyncCreateMatchKey($name), wiki_url, description, wappen_url ...
 *   - enrichment            = avesmapsWikiSettlementBuildEnrichment($apiPage)
 *       (settlements.php:96) -> continent (real DetectContinent), is_ruined
 *       (Siedlungsart ruine/zerstört), coat_url.
 *   - coordinates           = avesmapsWikiSyncExtractCoordinatesFromContent($wikitext)
 *       (locations.php:558) -> {source,x,y} from {{DereGlobus-Link|Länge(x)=..|
 *       Breite(y)=..}} (or Positionskarte).
 * The record carries the real DetectContinent verdict but is KEPT regardless of
 * continent (keep-all), exactly like the path/region handlers.
 *
 * SETTLEMENT-CLASS DIVERGENCE (A4/A1 watch-item -- do NOT paper over it): phase 2
 * of the ONLINE settlement case flow (avesmapsWikiSyncInferSettlementClassFromPage,
 * locations.php:410) re-infers the class FRESH from categories_json, and the online
 * API's category list included TEMPLATE-INJECTED categories. The dump exposes only
 * LITERAL [[Kategorie:]] links (I6). So for a settlement whose class category is
 * template-set (not a literal link), the dump-derived settlement_class/categories_json
 * can differ from the online run's, and the later phase-2 re-inference may diverge.
 * This handler fills HONESTLY from the dump's literal categories and does NOT
 * synthesise categories to force parity; the §9 compare-test is the safety net that
 * surfaces the difference. (The brief's "infer class from the Art field" is
 * reconciled here to the reused CATEGORY-driven deriver: writing an Art-string->class
 * map would be exactly the field mapping I1 forbids, and it would disagree with the
 * reused base upsert. The Art string is still captured -- as the record's `art` via
 * ParseInfobox and as is_ruined via BuildEnrichment.)
 *
 * I2: builds a wiki_sync_pages record ONLY -- never map_features / geometry /
 * feature_subtype / a location name or coords. Attaching a settlement to a map
 * location (the 4-phase case flow: match/build_cases/ResolveCase/AssignTo) is a
 * SEPARATE step this neither calls nor changes.
 *
 * I5 (coat license): the dump carries no file-license metadata, so
 * coat_license_status/coat_author/coat_attribution/coat_license_url are set to NULL.
 * The coat FILENAME/URL (from |Wappen=) is still stored in coat_url. No license
 * value is invented.
 *
 * H3 (hybrid override, additive): optional $override['class'] / $override['continent']
 * -- when set to a non-empty string, each REPLACES the corresponding dump-derived
 * value above ($resolvedClass from avesmapsWikiSyncSettlementClassFromPage() /
 * $continent from avesmapsWikiSettlementBuildEnrichment()'s DetectContinent) with
 * the online category-enumeration's ground-truth value (H1), resolving the
 * SETTLEMENT-CLASS DIVERGENCE noted above. $override = [] (the default) reproduces
 * current behaviour bit-for-bit. This never re-derives or transforms the override
 * value (I1); it only substitutes it, and only after the internal derivation ran
 * (so infobox parsing / coordinate extraction stay byte-identical).
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 * @param array{class?: ?string, continent?: ?string} $override H3 hybrid override (optional, default none).
 * @return array{
 *   kept: bool,
 *   reason: string,
 *   record: array<string, mixed>|null,
 *   continent: string
 * }
 *   kept=true for any settlement (keep-all across continents). record is the
 *   wiki_sync_pages registry row (null only when the page carries no settlement
 *   infobox at all). The detected continent VALUE is still carried on the record.
 */
function avesmapsWikiDumpParseSettlementPage(array $page, array $override = []): array
{
    $title = (string) ($page['title'] ?? '');
    $wikitext = (string) ($page['wikitext'] ?? '');

    // Gate on the settlement infobox exactly as the classifier does (O4) so a
    // non-settlement page fed here yields no record (mirrors the region gate).
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey(avesmapsWikiSyncMonitorInfoboxName($wikitext));
    $isSettlement = $infoboxKey !== '' && (
        str_contains($infoboxKey, 'siedlung')
        || str_contains($infoboxKey, 'stadt')
        || str_contains($infoboxKey, 'ort')
    );
    if (!$isSettlement) {
        return [
            'kept' => false,
            'reason' => $infoboxKey === '' ? 'kein Infobox' : ('Infobox ' . avesmapsWikiSyncMonitorInfoboxName($wikitext)),
            'record' => null,
            'continent' => '',
        ];
    }

    // API-shaped page for the reused category/content readers (plumbing, not I1).
    $apiPage = avesmapsWikiDumpBuildApiPageFromDump($page);

    // Class + label from the reused CATEGORY-driven deriver (same as online + the
    // reused base upsert). Null -> ParseInfobox applies the 'dorf' fallback.
    [$settlementClass, $settlementLabel] = avesmapsWikiSyncSettlementClassFromPage($apiPage);
    $classForInfobox = is_string($settlementClass) ? $settlementClass : '';

    // Infobox fields (name, art, wiki_key, match_key, wiki_url, wappen_url, ...) via
    // the reused real parser -- verbatim, no duplicated mapping/keys.
    $infobox = avesmapsWikiSettlementParseInfobox($title, $wikitext, $classForInfobox);

    // Enrichment (continent, is_ruined, coat_url) + coordinates via the reused fns.
    $enrichment = avesmapsWikiSettlementBuildEnrichment($apiPage);
    $coordinates = avesmapsWikiSyncExtractCoordinatesFromContent($wikitext);

    $continent = (string) ($enrichment['continent'] ?? '');
    $resolvedClass = (string) ($infobox['settlement_class'] ?? ($classForInfobox !== '' ? $classForInfobox : 'dorf'));
    $resolvedLabel = is_string($settlementLabel) && $settlementLabel !== ''
        ? $settlementLabel
        : (string) ($infobox['settlement_label'] ?? '');

    // H3 hybrid override: a non-empty $override['class'] wins over the dump-only
    // category-derived class above (I1 -- substitute only, never re-derive); its
    // label follows via the reused avesmapsWikiSettlementClassLabel() so the label
    // stays consistent with the overridden class instead of the dump-derived one.
    if (isset($override['class']) && is_string($override['class']) && $override['class'] !== '') {
        $resolvedClass = $override['class'];
        $resolvedLabel = avesmapsWikiSettlementClassLabel($resolvedClass);
    }
    // H3 hybrid override: a non-empty $override['continent'] wins over the
    // dump-only DetectContinent verdict above (I1 -- substitute only).
    if (isset($override['continent']) && is_string($override['continent']) && $override['continent'] !== '') {
        $continent = $override['continent'];
    }

    // Assemble the wiki_sync_pages record. Keys/fields come from the reused parse;
    // categories_json from the dump's literal categories; coat_license_* = NULL (I5).
    $record = [
        'title' => (string) ($infobox['title'] ?? $title),
        'normalized_key' => (string) ($infobox['match_key'] ?? ''),
        'wiki_key' => (string) ($infobox['wiki_key'] ?? ''),
        'wiki_url' => (string) ($infobox['wiki_url'] ?? ''),
        'settlement_class' => $resolvedClass,
        'settlement_label' => $resolvedLabel,
        'categories_json' => avesmapsWikiSyncGetCategoryNames($apiPage),
        'coordinates_json' => $coordinates,
        'continent' => mb_substr($continent, 0, 120, 'UTF-8'),
        'is_ruined' => (bool) ($enrichment['is_ruined'] ?? false),
        'coat_url' => (string) ($enrichment['coat_url'] ?? ''),
        // I5: dump has no license metadata -> NULL, never invented.
        'coat_license_status' => null,
        'coat_author' => null,
        'coat_attribution' => null,
        'coat_license_url' => null,
    ];

    // Keep-all: every continent is staged (owner decision -- the dump mirrors the
    // online-crawler DB, which never filtered by continent). The detected/overridden
    // continent VALUE is still carried on the record; only keep/drop is keep-all.
    return ['kept' => true, 'reason' => '', 'record' => $record, 'continent' => $continent];
}

// ===========================================================================
// 3d. BUILDING handler -- PURE (parse + enrich + keep/skip, DB-free). Task 4c2.
// ===========================================================================

/**
 * PURE building handler for ONE dump page -- the SIMPLEST entity, and the
 * settlement analogue trimmed to what the ONLINE building crawler actually
 * records. The online crawler never parses the building infobox: it walks the
 * "Bauwerk nach Art" category tree and records, per page, only
 * title + settlement_class='gebaeude' + settlement_label + building_type
 * (= the crawled CATEGORY name) + is_ruined (avesmapsWikiSettlementCrawlBuildings,
 * settlements.php:929). Pass B reproduces exactly that shape from the dump, reusing
 * the online crawler's own derivations -- NO new mapping table is invented:
 *   - settlement_class = 'gebaeude', settlement_label = the reused
 *       avesmapsWikiSettlementClassLabel('gebaeude') ('Besondere Bauwerke/Stätten').
 *   - building_type    = avesmapsWikiSettlementMatchBuildingType($literalCategories)
 *       (settlements.php) -- the FIRST of the page's literal [[Kategorie:]] links
 *       that matches the REUSED legacy building-type list
 *       (AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES, the same list both online
 *       crawl call sites use). If no category matches, it falls back to the infobox
 *       Art field (avesmapsWikiSettlementParseInfobox's `art`), then ''.
 *   - is_ruined        = the reused avesmapsWikiSettlementBuildEnrichment()
 *       Art-based detection (Art contains 'ruine'/'zerstör', settlements.php:114)
 *       OR the derived building_type contains 'ruine' (the online crawler's own
 *       ruin rule for Ruine/Festungsruine types, settlements.php).
 *   - normalized_key   = avesmapsWikiSyncCreateMatchKey($title),
 *     wiki_key         = avesmapsPoliticalSlug($title),
 *     wiki_url         = avesmapsWikiSyncMonitorPageUrl($title)
 *       -- all keyed off the TITLE, exactly like the online building crawler
 *       (settlements.php), reused verbatim (I1).
 *   - continent        = the reused avesmapsWikiSettlementBuildEnrichment() real
 *       DetectContinent verdict; carried on the record but KEPT regardless of
 *       continent (keep-all) like every other handler.
 *
 * building_type DIVERGENCE (A4 watch-item -- do NOT paper over it): ONLINE,
 * building_type is the crawled category NAME under "Bauwerk nach Art" (an
 * enumeration only the live API exposes). The dump carries only LITERAL
 * [[Kategorie:]] links (I6) and no category enumeration, so Pass B derives
 * building_type from those literal categories (matched against the reused legacy
 * type list) with the infobox Art as fallback. For a page whose type category is a
 * literal link matching the list (e.g. [[Kategorie:Festung]]) the value is
 * identical to online; for a page whose category is not in the list (e.g.
 * [[Kategorie:Burg]] -- "Burg" is not a legacy type) the Art fallback supplies the
 * value ('Burg'), which may differ from the online crawl's category-derived type.
 * The §9 compare-test is the safety net that surfaces the difference.
 *
 * I2: builds a wiki_sync_pages record ONLY -- never map_features / geometry /
 * feature_subtype / a location. It NEVER runs the settlement case flow or
 * avesmapsWikiSettlementBulkConnect/assign.
 *
 * I5 (coat license): the dump carries no file-license metadata, so
 * coat_license_status/coat_author/coat_attribution/coat_license_url are NULL. (The
 * online building crawler stores no coat at all; buildings usually have none.)
 *
 * H3 (hybrid override, additive): optional $override['building_type'] /
 * $override['continent'] -- when set to a non-empty string, each REPLACES the
 * corresponding dump-derived value above ($buildingType from the literal-category
 * match+Art fallback / $continent from DetectContinent) with the online
 * category-enumeration's ground-truth value (H1), resolving the building_type
 * DIVERGENCE noted above. $override = [] (the default) reproduces current
 * behaviour bit-for-bit. This never re-derives or transforms the override value
 * (I1); it only substitutes it, after the internal derivation ran.
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 * @param array{building_type?: ?string, continent?: ?string} $override H3 hybrid override (optional, default none).
 * @return array{
 *   kept: bool,
 *   reason: string,
 *   record: array<string, mixed>|null,
 *   continent: string
 * }
 *   kept=true for any building (keep-all across continents). record is the
 *   wiki_sync_pages registry row (null only when the page carries no building
 *   infobox at all). The detected continent VALUE is still carried on the record.
 */
function avesmapsWikiDumpParseBuildingPage(array $page, array $override = []): array
{
    $title = (string) ($page['title'] ?? '');
    $wikitext = (string) ($page['wikitext'] ?? '');

    // Gate on the building infobox exactly as the classifier does (O4) so a
    // non-building page fed here yields no record (mirrors the settlement gate).
    $infoboxName = avesmapsWikiSyncMonitorInfoboxName($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey($infoboxName);
    $isBuilding = $infoboxKey !== '' && (
        str_contains($infoboxKey, 'bauwerk')
        || str_contains($infoboxKey, 'festung')
        || str_contains($infoboxKey, 'burg')
    );
    if (!$isBuilding) {
        return [
            'kept' => false,
            'reason' => $infoboxKey === '' ? 'kein Infobox' : ('Infobox ' . $infoboxName),
            'record' => null,
            'continent' => '',
        ];
    }

    // API-shaped page for the reused category/content readers (plumbing, not I1).
    $apiPage = avesmapsWikiDumpBuildApiPageFromDump($page);
    $categoryNames = avesmapsWikiSyncGetCategoryNames($apiPage);

    // building_type from the reused legacy type list matched against literal
    // categories; Art fallback via the reused settlement infobox parser (its `art`
    // reads ['siedlungsart','art','typ']). No new mapping invented (I1).
    $buildingType = avesmapsWikiSettlementMatchBuildingType($categoryNames);
    if ($buildingType === '') {
        $infobox = avesmapsWikiSettlementParseInfobox($title, $wikitext, 'gebaeude');
        $art = (string) ($infobox['art'] ?? '');
        // ParseInfobox falls back an empty Art to the class label; suppress that so
        // an unknown building_type stays '' rather than becoming the gebaeude label.
        $buildingType = $art !== '' && $art !== avesmapsWikiSettlementClassLabel('gebaeude') ? $art : '';
    }

    // Enrichment (continent + Art-based is_ruined) via the reused settlement fn.
    $enrichment = avesmapsWikiSettlementBuildEnrichment($apiPage);
    $continent = (string) ($enrichment['continent'] ?? '');

    // H3 hybrid override: a non-empty $override['building_type'] wins over the
    // dump-only literal-category+Art derivation above (I1 -- substitute only,
    // never re-derive); applied BEFORE is_ruined below so an overridden type still
    // feeds the same type-based ruin rule the dump-only value would have.
    if (isset($override['building_type']) && is_string($override['building_type']) && $override['building_type'] !== '') {
        $buildingType = $override['building_type'];
    }
    // H3 hybrid override: a non-empty $override['continent'] wins over the
    // dump-only DetectContinent verdict above (I1 -- substitute only).
    if (isset($override['continent']) && is_string($override['continent']) && $override['continent'] !== '') {
        $continent = $override['continent'];
    }

    // is_ruined ORs in the online crawler's type-based ruin rule (Ruine/Festungsruine).
    $isRuined = (bool) ($enrichment['is_ruined'] ?? false)
        || ($buildingType !== '' && mb_stripos($buildingType, 'ruine') !== false);

    // Assemble the wiki_sync_pages record. Keys/URL are the reused title-derived
    // ones (same as the online building crawler); coat_license_* = NULL (I5).
    $record = [
        'title' => mb_substr($title, 0, 255, 'UTF-8'),
        'normalized_key' => avesmapsWikiSyncCreateMatchKey($title),
        'wiki_key' => avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($title)),
        'wiki_url' => avesmapsWikiSyncMonitorPageUrl($title),
        'settlement_class' => 'gebaeude',
        'settlement_label' => avesmapsWikiSettlementClassLabel('gebaeude'),
        'building_type' => mb_substr($buildingType, 0, 120, 'UTF-8'),
        'categories_json' => $categoryNames,
        'continent' => mb_substr($continent, 0, 120, 'UTF-8'),
        'is_ruined' => $isRuined,
        // I5: dump has no license metadata -> NULL, never invented. Buildings carry
        // no coat in the online crawl either.
        'coat_license_status' => null,
        'coat_author' => null,
        'coat_attribution' => null,
        'coat_license_url' => null,
    ];

    // Keep-all: every continent is staged (owner decision -- the dump mirrors the
    // online-crawler DB, which never filtered by continent). The detected/overridden
    // continent VALUE is still carried on the record; only keep/drop is keep-all.
    return ['kept' => true, 'reason' => '', 'record' => $record, 'continent' => $continent];
}

// ===========================================================================
// 3e. TERRITORY handler -- PURE (parse + keep/skip decision, DB-free). Task 4d.
// ===========================================================================

/**
 * PURE territory handler for ONE dump page -- the highest-risk entity (hierarchy +
 * wiki_key), but a clean reuse of the online sync-monitor crawler's OWN offline
 * parser. It builds the political_territory_wiki_test SANDBOX record by REUSING the
 * real avesmapsWikiSyncMonitorParsePage() (sync-monitor-parsing.php:429) verbatim --
 * NO field mapping, key derivation or |Staat=->affiliation parse is duplicated here
 * (I1). Inside that reused parse:
 *   - wiki_key             = avesmapsPoliticalBuildWikiKey(wiki_url, name) -> 'wiki:'.slug
 *       (territory.php:929; wiki_url = avesmapsWikiSyncMonitorPageUrl($canonical))
 *   - type                 <- Art field (avesmapsPoliticalNormalizeWikiRecord)
 *   - affiliation_root / affiliation_path_json <- avesmapsWikiSyncMonitorParseAffiliation
 *       (sync-monitor-parsing.php:309) over |Staat= (simple [[X]], colon-path
 *       [[X]]: [[Y]], or conflict '(beansprucht von: ...)' -> empty path + conflicts +
 *       independent). raw_json.affiliation keeps links/conflicts/independent.
 *   - founded_*_bf / dissolved_*_bf <- avesmapsWikiSyncBuildPoliticalTemporalPayload
 *       (territories.php:314) over {{BF|...}}/{{Datum|...}}.
 * The record carries the real DetectContinent verdict but is KEPT regardless of
 * continent (keep-all), exactly like the path/region/settlement/building handlers.
 *
 * The dump page's <title> IS its canonical title (the dump stores pages under their
 * canonical title; redirects are separate pages handled in Pass A / Task 3), so we
 * pass (title, wikitext, title) -- canonicalTitle = title.
 *
 * NB (settlement-as-territory branch): avesmapsWikiSyncMonitorParsePage also promotes
 * some Siedlung infoboxes to territories (Reichsstadt / Freie Stadt / independent
 * Stadtstaat). The PLAIN-mode dispatch never reaches that branch here (the classifier
 * routes a Siedlung page to 'settlement'), but the HYBRID seam does: to mirror the
 * online crawler's dual nature (a promoted Siedlung became a territory row WITHOUT
 * ceasing to be a settlement), avesmapsWikiDumpHybridParseRow() calls THIS handler a
 * SECOND time on a settlement-classified page and keeps the territory record too when
 * the promotion fires. We still gate on is_territory so a plain Siedlung (or a mis-fed
 * page) yields no record (mirrors the other gates), and the wiki_key is derived by the
 * reused parser exactly as the online crawler did (I1: 'wiki:'.slug).
 *
 * I3 (geometry untouched): the handler reads/writes NO geometry -- it only produces
 * the sandbox record. I4/I7: PERSIST (avesmapsWikiDumpPersistTerritoryRecords) writes
 * ONLY political_territory_wiki_test + the wiki_redirect_alias title->key alias; it
 * NEVER writes wiki_territory_model or political_territory (production). The derived
 * hierarchy (parent_id) + editor overrides (parent_locked) are computed later by
 * REBUILD from the affiliation fields -- untouched here.
 *
 * H3 (hybrid override, additive): optional $override['continent'] -- when set to a
 * non-empty string, REPLACES the dump-derived $record['continent'] (from the reused
 * avesmapsWikiSyncMonitorParsePage()'s internal DetectContinent) with the online
 * category-enumeration's ground-truth value (H1) so the record carries the trusted
 * continent (kept regardless -- keep-all, no filter). $override = [] (the default)
 * reproduces current behaviour bit-for-bit. This never re-derives or transforms the
 * override value (I1); it only substitutes it, and does not touch wiki_key /
 * affiliation / temporal fields (I1/I3/I4/I7 all stay untouched).
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 * @param array{continent?: ?string} $override H3 hybrid override (optional, default none).
 * @return array{
 *   kept: bool,
 *   reason: string,
 *   record: array<string, mixed>|null,
 *   continent: string,
 *   parent_titles: array<int, string>,
 *   source_origin: string
 * }
 *   kept=true for any territory (keep-all across continents). record is the
 *   political_territory_wiki_test sandbox row (null only when the page carries no
 *   territory infobox / is rejected as a pure settlement). The detected continent
 *   VALUE is still carried on the record. parent_titles / source_origin are surfaced
 *   from the reused parse (the parent-candidate [[links]] feed REBUILD's parent
 *   resolution; not persisted here).
 */
function avesmapsWikiDumpParseTerritoryPage(array $page, array $override = []): array
{
    $title = (string) ($page['title'] ?? '');
    $wikitext = (string) ($page['wikitext'] ?? '');

    // Reuse the REAL territory parser verbatim (I1). canonicalTitle = title (dump
    // pages are canonical). It derives wiki_key/type/affiliation/temporal internally.
    $parsed = avesmapsWikiSyncMonitorParsePage($title, $wikitext, $title);

    if (empty($parsed['is_territory']) || !is_array($parsed['record'] ?? null)) {
        return [
            'kept' => false,
            'reason' => (string) ($parsed['reason'] ?? 'kein Herrschaftsgebiet'),
            'record' => null,
            'continent' => '',
            'parent_titles' => [],
            'source_origin' => (string) ($parsed['source_origin'] ?? ''),
        ];
    }

    $record = $parsed['record'];
    $continent = (string) ($record['continent'] ?? '');
    $parentTitles = is_array($parsed['parent_titles'] ?? null) ? $parsed['parent_titles'] : [];
    $sourceOrigin = (string) ($parsed['source_origin'] ?? '');

    // H3 hybrid override: a non-empty $override['continent'] wins over the
    // dump-only derivation above (I1 -- substitute only, never re-derive). Absent
    // override -> $continent stays the reused parser's own DetectContinent verdict.
    if (isset($override['continent']) && is_string($override['continent']) && $override['continent'] !== '') {
        $continent = $override['continent'];
        $record['continent'] = mb_substr($continent, 0, 120, 'UTF-8');
    }

    // Keep-all: every continent is staged (owner decision -- the dump mirrors the
    // online-crawler DB, which never filtered by continent). The detected/overridden
    // continent VALUE is still carried on the record; only keep/drop is keep-all.
    return [
        'kept' => true,
        'reason' => '',
        'record' => $record,
        'continent' => $continent,
        'parent_titles' => $parentTitles,
        'source_origin' => $sourceOrigin,
    ];
}

// ===========================================================================
// 4. Collect / dry-run (DB-free) -- drives dispatch over a page stream.
// ===========================================================================

/**
 * PURE (DB-free) Pass-B collect over a page stream: classify every page and, for
 * a HANDLED kind (PATH / REGION / SETTLEMENT / BUILDING), run the matching pure
 * handler. Returns everything the fixture test needs to assert enumeration +
 * staging WITHOUT any DB.
 *
 * This is the generic dispatch loop; a remaining kind (territory) extends it by
 * adding its kind to the match below (routing to its own pure handler) -- the
 * enumeration and the per-kind tally require no change.
 *
 * `records` mixes kept staging records of every handled kind (each carries its own
 * fields; a caller that needs one kind uses avesmapsWikiDumpCollectPathRecords /
 * avesmapsWikiDumpCollectRegionRecords / avesmapsWikiDumpCollectSettlementRecords /
 * avesmapsWikiDumpCollectBuildingRecords, which filter by classification). The
 * `filtered` bucket is retained in the return shape but is now ALWAYS EMPTY (keep-all:
 * no entity is dropped by continent any more); it stays only so callers/tests that
 * read the key don't break.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array{
 *   records: array<int, array<string, mixed>>,     // kept staging records (every continent, every handled kind)
 *   filtered: array<int, array{title:string, kind:string, continent:string, reason:string}>, // ALWAYS EMPTY under keep-all (retained for shape compatibility)
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
        // Each handled kind runs its pure handler; a kept record is collected.
        // Under keep-all no handler drops by continent, so the `filtered` bucket
        // below stays empty (the branch is retained only for shape/future safety).
        // Recognised-but-unhandled kinds fall through to default and are counted.
        $result = null;
        switch ($kind) {
            case AVESMAPS_WIKI_DUMP_ENTITY_PATH:
                $result = avesmapsWikiDumpParsePathPage($page);
                break;

            case AVESMAPS_WIKI_DUMP_ENTITY_REGION:
                $result = avesmapsWikiDumpParseRegionPage($page);
                break;

            case AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT:
                $result = avesmapsWikiDumpParseSettlementPage($page);
                break;

            case AVESMAPS_WIKI_DUMP_ENTITY_BUILDING:
                $result = avesmapsWikiDumpParseBuildingPage($page);
                break;

            case AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY:
                $result = avesmapsWikiDumpParseTerritoryPage($page);
                break;

            default:
                // Recognised but unhandled: counted above, no record. (All recognised
                // kinds now have a handler, so this branch is effectively unreachable.)
                break;
        }

        if ($result === null) {
            continue;
        }
        if ($result['kept'] && is_array($result['record'])) {
            $records[] = $result['record'];
        } elseif ($result['record'] !== null) {
            // Keep-all: no handler returns kept=false with a record any more, so this
            // is effectively unreachable; retained for shape/future-handler safety.
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

/**
 * Convenience DB-free collector that returns ONLY the kept SETTLEMENT registry
 * records for a page stream (the wiki_sync_pages rows Pass B would upsert). The
 * settlement analogue of avesmapsWikiDumpCollectRegionRecords: classifies each
 * page and runs the pure settlement handler; path/region/other kinds are ignored.
 * Settlements of every continent are kept (keep-all); a {{Infobox Bauwerk}} page
 * classifies as BUILDING (not settlement)
 * so it is not collected here either.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<int, array<string, mixed>>
 */
function avesmapsWikiDumpCollectSettlementRecords(iterable $pages): array
{
    $records = [];
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT) {
            continue;
        }
        $result = avesmapsWikiDumpParseSettlementPage($page);
        if ($result['kept'] && is_array($result['record'])) {
            $records[] = $result['record'];
        }
    }

    return $records;
}

/**
 * Convenience DB-free collector that returns ONLY the kept BUILDING registry
 * records for a page stream (the wiki_sync_pages gebaeude rows Pass B would
 * upsert). The building analogue of avesmapsWikiDumpCollectSettlementRecords:
 * classifies each page and runs the pure building handler; path/region/settlement/
 * other kinds are ignored. Buildings of every continent are kept (keep-all);
 * a {{Infobox Siedlung}} page classifies as
 * SETTLEMENT (not building) so it is not collected here either.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<int, array<string, mixed>>
 */
function avesmapsWikiDumpCollectBuildingRecords(iterable $pages): array
{
    $records = [];
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_BUILDING) {
            continue;
        }
        $result = avesmapsWikiDumpParseBuildingPage($page);
        if ($result['kept'] && is_array($result['record'])) {
            $records[] = $result['record'];
        }
    }

    return $records;
}

/**
 * Convenience DB-free collector that returns ONLY the kept TERRITORY sandbox records
 * for a page stream (the political_territory_wiki_test rows Pass B would upsert). The
 * territory analogue of avesmapsWikiDumpCollectBuildingRecords: classifies each page
 * and runs the pure territory handler; path/region/settlement/building kinds are
 * ignored. Territories of every continent are kept (keep-all); a page rejected by
 * the real parser as a pure settlement yields no
 * record either.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<int, array<string, mixed>>
 */
function avesmapsWikiDumpCollectTerritoryRecords(iterable $pages): array
{
    $records = [];
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY) {
            continue;
        }
        $result = avesmapsWikiDumpParseTerritoryPage($page);
        if ($result['kept'] && is_array($result['record'])) {
            $records[] = $result['record'];
        }
    }

    return $records;
}

// ===========================================================================
// 4x. Hybrid migration (Task H2) -- title-set-gated wikitext collector.
// ---------------------------------------------------------------------------
// H1 (online category layer, commit f0b9dc46) enumerates the WANTED title set
// (breadth) + a class/building_type/continent override map from the live wiki
// API. H2 (this section) is the DUMP side: given that wanted title set, pull
// ONLY those pages' wikitext from the dump stream in one pass, instead of
// classifying all ~223k pages by infobox presence (the O4 approach the
// avesmapsWikiDumpCollect*Records functions above still use). H3 will feed the
// H1 overrides into the existing parse handlers; H4 owns the resumable
// step/cursor orchestration around the one-pass filter below (reopen reader,
// skip N, budget, accumulate found-map across web-request steps) -- NEITHER is
// built here. Both functions in this section are pure (iterable/array in,
// array out), READ-ONLY (no DB / staging / sandbox / map writes) and
// side-effect-free, so they are unit-tested without a real dump
// (tools/wikidump/test-dump-collect-wikitext.php).
// ===========================================================================

/**
 * One streaming pass over a page source, returning ONLY the pages whose
 * NORMALIZED title is a member of $wantedTitleSet -- an O(1) membership test
 * per page (isset()), with an early exit once every wanted title has been
 * found. This is the title-set analogue of the avesmapsWikiDumpCollect*Records
 * functions above: instead of gating on "does this page's infobox classify as
 * KIND", it gates on "is this page's title one we were told to fetch" (the
 * kind/class/continent decision itself is H1's online enumeration, not this
 * function's job).
 *
 * CONTRACT -- $wantedTitleSet keys MUST already be normalized the same way this
 * function normalizes each dump page's title, i.e. via
 * avesmapsWikiSyncMonitorNormalizeTitle() (sync-monitor.php:319:
 * str_replace('_',' ',trim($title)), then strip a trailing #fragment, then
 * trim again) -- the SAME normalizer avesmapsWikiRegionFetchCategory /
 * avesmapsWikiPathFetchCategory / avesmapsWikiSyncMonitorFetchCategoryMembers
 * already apply to online-crawled member titles (regions.php:280, paths.php:179,
 * sync-monitor.php:462). H1/H4 are expected to pass already-normalized keys;
 * this function does NOT re-normalize the wanted-set keys themselves (only the
 * dump page titles it compares against them) -- see the recon report's §4.2 for
 * the full title-keying analysis.
 *
 * A dump page whose title normalizes to '' is never collected, even if ''
 * happens to be a (degenerate) key of $wantedTitleSet.
 *
 * On a duplicate title in the stream (the SAME normalized title appearing
 * twice -- e.g. a stale dump artifact), the FIRST occurrence found is kept:
 * $found[$key] is set once and never overwritten by a later hit of the same
 * key, matching the recon §4.3 sketch verbatim.
 *
 * Redirect resolution is NOT this function's job -- a wanted title that is
 * itself a wiki redirect will never appear as a dump <title> (the dump stores
 * the article under its canonical title, and a redirect page's OWN title is a
 * different string). Callers must resolve the wanted set through
 * avesmapsWikiDumpResolveWantedTitlesThroughAliases() BEFORE calling this
 * function if the wanted set may contain redirect-alias titles (see that
 * function's docblock for why this could not be built as a simple pre-pass
 * inside this same function).
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @param array<string, mixed> $wantedTitleSet normalized-title => truthy (value ignored; membership only)
 * @return array<string, array{title:string, ns:int, redirect:?string, wikitext:string}> normalized-title => the whole matched page row
 */
function avesmapsWikiDumpCollectWikitextForTitles(iterable $pages, array $wantedTitleSet): array
{
    $found = [];
    $wantedCount = count($wantedTitleSet);
    if ($wantedCount === 0) {
        return $found; // nothing asked for -> nothing to do, don't even start pulling the stream
    }

    foreach ($pages as $page) {
        $key = avesmapsWikiSyncMonitorNormalizeTitle((string) ($page['title'] ?? ''));
        if ($key === '' || !isset($wantedTitleSet[$key]) || isset($found[$key])) {
            continue; // no title, not wanted, or already found (first occurrence wins)
        }

        $found[$key] = $page; // {title, ns, redirect, wikitext} -- the whole page row

        if (count($found) === $wantedCount) {
            break; // early exit: every wanted title has been found, stop pulling the stream
        }
    }

    return $found;
}

/**
 * Resolve a wanted-title set through the Pass-A redirect-alias map so that a
 * wanted title which is actually a wiki REDIRECT gets replaced by its dump-side
 * CANONICAL identity before the wikitext pass -- the dump stores an article
 * under its canonical title, never under a redirect's title, so an unresolved
 * alias in $wantedTitleSet would simply never be found by
 * avesmapsWikiDumpCollectWikitextForTitles().
 *
 * IMPORTANT SHAPE NOTE (divergence from a naive "alias title => canonical
 * title" assumption -- see the H2 report for the full analysis): $aliasMap is
 * expected in the REAL shape avesmapsWikiDumpCollectRedirectAliases()
 * (dump-reader.php:379) actually produces and avesmapsWikiSyncMonitorStoreAlias()
 * (sync-monitor-model.php:35) actually persists to wiki_redirect_alias --
 * i.e. `alias_slug => canonical_wiki_key`:
 *   - keys   = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($title))
 *              -- a SLUG (lowercase, ASCII-transliterated, hyphenated), NOT the
 *              plain normalized-title-with-spaces form avesmapsWikiSyncMonitorNormalizeTitle()
 *              alone produces.
 *   - values = a 'wiki:'- or 'name:'-prefixed slug (avesmapsPoliticalBuildWikiKey()),
 *              i.e. a `wiki_key` identity string, NOT a plain canonical page
 *              TITLE. There is no function that recovers a literal dump
 *              <title> string from a wiki_key (the slug transform is lossy),
 *              so this function's "resolved" side is keyed by CANONICAL
 *              WIKI_KEY, not by canonical title.
 *
 * This function therefore builds the wanted title's own alias_slug (via the
 * SAME composition, avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle(...)))
 * to probe $aliasMap, and -- on a hit -- replaces that wanted title's entry
 * with a key of the resulting canonical_wiki_key (not a title). A caller
 * wiring this in front of avesmapsWikiDumpCollectWikitextForTitles() (which
 * matches on NORMALIZED TITLE, not wiki_key) MUST separately resolve a
 * canonical_wiki_key back to a canonical dump title through some other channel
 * (e.g. the territory handler's own wiki_key derivation on each dump page) --
 * this function alone cannot bridge wiki_key back to title, because no such
 * reverse function exists anywhere in the codebase today. This is flagged
 * explicitly in the H2 report as a real gap for H4 to close, not invented away
 * here.
 *
 * Returns BOTH the resolved set and a reverse map so a caller (H4) can trace a
 * found canonical key back to the title that was originally requested:
 *   - 'resolved': the wanted set with every aliased entry's key replaced by its
 *     canonical_wiki_key (non-aliased entries pass through with their original
 *     normalized-title key and value untouched).
 *   - 'requestedByResolvedKey': canonical_wiki_key => the ORIGINAL wanted title
 *     that resolved to it (only present for entries that WERE aliased; a
 *     pass-through entry has no reverse-mapping row because its key never
 *     changed).
 *
 * On a wanted-title key whose alias_slug is '' (e.g. an already-empty title),
 * the entry is left untouched (pass-through) rather than dropped or guessed at.
 *
 * @param array<string, mixed> $wantedTitleSet normalized-title (or already-resolved key) => truthy
 * @param array<string, string> $aliasMap alias_slug => canonical_wiki_key, EXACTLY the shape avesmapsWikiDumpCollectRedirectAliases() returns
 * @return array{resolved: array<string, mixed>, requestedByResolvedKey: array<string, string>}
 */
function avesmapsWikiDumpResolveWantedTitlesThroughAliases(array $wantedTitleSet, array $aliasMap): array
{
    $resolved = [];
    $requestedByResolvedKey = [];

    foreach ($wantedTitleSet as $wantedTitle => $value) {
        $wantedTitleString = (string) $wantedTitle;
        $aliasSlug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($wantedTitleString));

        if ($aliasSlug === '' || !isset($aliasMap[$aliasSlug])) {
            $resolved[$wantedTitleString] = $value; // not an alias (or empty slug) -> pass through unchanged
            continue;
        }

        $canonicalWikiKey = $aliasMap[$aliasSlug];
        $resolved[$canonicalWikiKey] = $value; // key REPLACED by the canonical wiki_key
        $requestedByResolvedKey[$canonicalWikiKey] = $wantedTitleString;
    }

    return [
        'resolved' => $resolved,
        'requestedByResolvedKey' => $requestedByResolvedKey,
    ];
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
 * @return int number of path records upserted (all continents)
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
 * @return int number of region records upserted (all continents)
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
 * THIN persistence for the SETTLEMENT handler -- the analogue of
 * avesmapsWikiDumpPersistRegionRecords(). For each kept settlement page it writes
 * the wiki_sync_pages registry row in TWO reused steps, inventing no new upsert:
 *
 *   1. BASE columns via the REUSED avesmapsWikiSyncUpsertPageCache()
 *      (locations-helpers.php:306). Fed the API-shaped page from the dump, it
 *      derives + writes normalized_key, wiki_url, settlement_class/label
 *      (category-driven, same as online), categories_json, coordinates_json and
 *      content_hash -- ALL the base field/key/coordinate mapping, reused verbatim.
 *   2. ENRICHMENT columns via the same UPDATE shape avesmapsWikiSettlementEnrichDetails()
 *      uses (settlements.php) -- continent, is_ruined, coat_url + enriched_at. Per
 *      I5 the coat license columns are set to NULL (the dump has no file-license
 *      metadata; we do NOT fetch or invent one). avesmapsWikiSettlementEnsureSchema()
 *      guarantees those columns exist.
 *
 * This writes ONLY to wiki_sync_pages (I2) -- never map_features/geometry/a location.
 * It NEVER runs the settlement case flow (match/build_cases/ResolveCase/AssignTo)
 * -- that integration is deferred to the controlled rollout after the compare-test.
 *
 * DB-backed -> NOT covered by the fixture test; live-verified in the controlled
 * rollout / compare-test. Nothing calls it automatically yet.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return int number of settlement registry rows written (all continents)
 */
function avesmapsWikiDumpPersistSettlementRecords(PDO $pdo, iterable $pages): int
{
    avesmapsWikiSettlementEnsureSchema($pdo); // guard: enrichment columns exist

    // Reuse the settlement enrich UPDATE shape (license columns NULL per I5).
    $enrichUpdate = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' SET
            continent = :continent, is_ruined = :is_ruined, coat_url = :coat_url,
            coat_license_status = NULL, coat_author = NULL,
            coat_attribution = NULL, coat_license_url = NULL,
            enriched_at = CURRENT_TIMESTAMP()
         WHERE title = :title'
    );

    $written = 0;
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT) {
            continue;
        }
        $result = avesmapsWikiDumpParseSettlementPage($page);
        if (!$result['kept'] || !is_array($result['record'])) {
            continue;
        }
        $record = $result['record'];

        // 1) Base columns via the reused real upsert (API-shaped dump page).
        $apiPage = avesmapsWikiDumpBuildApiPageFromDump($page);
        avesmapsWikiSyncUpsertPageCache($pdo, $apiPage, true); // includeContent=true -> coords + hash

        // 2) Enrichment columns via the reused UPDATE shape (license NULL, I5).
        $coatUrl = (string) ($record['coat_url'] ?? '');
        $enrichUpdate->execute([
            'continent' => $record['continent'] !== '' ? $record['continent'] : AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
            'is_ruined' => !empty($record['is_ruined']) ? 1 : 0,
            'coat_url' => $coatUrl !== '' ? $coatUrl : null,
            'title' => (string) $record['title'],
        ]);
        $written++;
    }

    return $written;
}

/**
 * THIN persistence for the BUILDING handler -- the SIMPLEST persist, and the
 * faithful reuse of the ONLINE building crawler's own row upsert. For each kept
 * building page it writes the wiki_sync_pages gebaeude row via the REUSED
 * avesmapsWikiSettlementUpsertBuildingRow() (settlements.php) -- the exact
 * INSERT ... ON DUPLICATE KEY UPDATE both online crawl call sites
 * (avesmapsWikiSettlementCrawlBuildings / -CrawlBuildingType) use. That upsert
 * derives normalized_key/wiki_url from the title, writes settlement_class='gebaeude',
 * the reused label, building_type and is_ruined, and -- crucially -- does NOT
 * clobber an existing (settlement) class/label/type (IF(... IS NULL OR '')). No new
 * upsert is invented.
 *
 * NB the settlement base upsert avesmapsWikiSyncUpsertPageCache is deliberately NOT
 * reused here: it re-derives settlement_class from the page categories (for a
 * building that is NULL, wiping 'gebaeude') and writes neither building_type nor
 * is_ruined. The building-row upsert is the correct single source of truth for a
 * gebaeude row (the escalation the brief flagged: UpsertPageCache conflicts with a
 * gebaeude row -- so the online building INSERT is reused instead, and hoisted to a
 * shared helper so online + dump share one definition).
 *
 * This writes ONLY to wiki_sync_pages (I2) -- never map_features/geometry/a location.
 * It NEVER runs the settlement case flow or avesmapsWikiSettlementBulkConnect/assign.
 *
 * DB-backed -> NOT covered by the fixture test; live-verified in the controlled
 * rollout / compare-test. Nothing calls it automatically yet.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return int number of building rows written (all continents)
 */
function avesmapsWikiDumpPersistBuildingRecords(PDO $pdo, iterable $pages): int
{
    avesmapsWikiSettlementEnsureSchema($pdo); // guard: building_type / is_ruined columns exist

    $written = 0;
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_BUILDING) {
            continue;
        }
        $result = avesmapsWikiDumpParseBuildingPage($page);
        if (!$result['kept'] || !is_array($result['record'])) {
            continue;
        }
        $record = $result['record'];
        // Reused online building-row upsert (gebaeude class/label/type + is_ruined).
        avesmapsWikiSettlementUpsertBuildingRow(
            $pdo,
            (string) ($record['title'] ?? ''),
            (string) ($record['building_type'] ?? ''),
            !empty($record['is_ruined'])
        );
        $written++;
    }

    return $written;
}

/**
 * THIN persistence for the TERRITORY handler -- the analogue of
 * avesmapsWikiDumpPersistBuildingRecords(). For each kept territory page it writes the
 * sandbox row + the title->key alias in TWO reused steps, inventing no new upsert:
 *
 *   1. SANDBOX row via the REUSED avesmapsWikiSyncMonitorUpsertTestRecord()
 *      (sync-monitor-licenses.php:273) -- the dynamic column-aware INSERT ... ON
 *      DUPLICATE KEY UPDATE (by wiki_key) into political_territory_wiki_test. It writes
 *      ONLY the sandbox; political_territory (production) is a SEPARATE promotion step
 *      it never touches.
 *   2. ALIAS via the REUSED avesmapsWikiSyncMonitorStoreAlias($pdo, [$title, $title],
 *      $record['wiki_key']) (sync-monitor-model.php:35) -- registers the canonical
 *      title-slug -> wiki_key in wiki_redirect_alias so REBUILD's ResolveParentKey can
 *      resolve a child's |Staat= parent NAME to the parent's canonical wiki_key (I7).
 *      title = canonical here (the dump page IS canonical; redirect->target aliases are
 *      already registered by Pass A / Task 3), so both slots are the page title.
 *
 * This writes ONLY political_territory_wiki_test + wiki_redirect_alias (Phase-0
 * non-destructive staging). It NEVER writes wiki_territory_model, political_territory
 * (production) or political_territory_geometry (I3), and NEVER runs REBUILD / DIFF /
 * APPLY -- the derived hierarchy (parent_id) + editor overrides (parent_locked, I4) are
 * computed later by that untouched editor flow from the sandbox affiliation fields.
 *
 * DB-backed -> NOT covered by the fixture test; live-verified in the controlled
 * rollout / compare-test. Nothing calls it automatically yet.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return int number of territory sandbox rows written (all continents)
 */
function avesmapsWikiDumpPersistTerritoryRecords(PDO $pdo, iterable $pages): int
{
    $written = 0;
    foreach ($pages as $page) {
        if (avesmapsWikiDumpClassifyPage($page) !== AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY) {
            continue;
        }
        $result = avesmapsWikiDumpParseTerritoryPage($page);
        if (!$result['kept'] || !is_array($result['record'])) {
            continue;
        }
        $record = $result['record'];

        // 1) Sandbox row via the reused test-record upsert (political_territory_wiki_test).
        avesmapsWikiSyncMonitorUpsertTestRecord($pdo, $record);

        // 2) Canonical title -> wiki_key alias via the reused alias store (I7). title is
        //    canonical for a dump page, so both alias slots are the page title.
        $title = (string) ($page['title'] ?? '');
        avesmapsWikiSyncMonitorStoreAlias($pdo, [$title, $title], (string) ($record['wiki_key'] ?? ''));

        $written++;
    }

    return $written;
}

/**
 * Process ONE bounded Pass-B step over the dump, resuming from a page-counter
 * cursor and persisting the recognised entities of this batch. Mirrors the
 * Pass-A step discipline in dump-reader.php (reopen-from-start + skip N + bounded
 * batch + set_time_limit) and reuses the reused entity handlers above.
 *
 * Tasks 4a-4d persist ALL five handled kinds -- PATH, REGION, SETTLEMENT, BUILDING
 * and TERRITORY; each routes to its own reused parse+upsert (settlement = reused
 * base UpsertPageCache + the enrich UPDATE, license NULL per I5; building = the
 * reused online building-row upsert; territory = the reused sandbox UpsertTestRecord
 * + the title->key StoreAlias, writing ONLY political_territory_wiki_test +
 * wiki_redirect_alias -- NEVER wiki_territory_model / political_territory / geometry,
 * I3/I4/I7). This NEVER runs the settlement case flow or REBUILD/DIFF/APPLY.
 *
 * DB- AND dump-backed -> NOT exercised by the local fixture test. Its live
 * verification is DEFERRED to the controlled rollout / compare-test; nothing
 * calls it automatically yet. Kept intentionally thin (structure, not behaviour
 * under test) per the Task-4a/4b briefs.
 *
 * @return array{ok:bool, done:bool, cursor:int, processed_this_step:int, paths_written:int, regions_written:int, settlements_written:int, buildings_written:int, territories_written:int}
 */
function avesmapsWikiDumpRunPassBStep(PDO $pdo, string $dumpPath, int $cursor = 0, ?int $pageBudget = null): array
{
    $pageBudget = $pageBudget ?? AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET;
    @set_time_limit(AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + AVESMAPS_WIKI_DUMP_STEP_SECONDS;

    avesmapsWikiSettlementEnsureSchema($pdo); // guard: settlement enrichment columns exist
    $settlementEnrich = $pdo->prepare(
        'UPDATE ' . AVESMAPS_WIKI_SETTLEMENT_PAGES_TABLE . ' SET
            continent = :continent, is_ruined = :is_ruined, coat_url = :coat_url,
            coat_license_status = NULL, coat_author = NULL,
            coat_attribution = NULL, coat_license_url = NULL,
            enriched_at = CURRENT_TIMESTAMP()
         WHERE title = :title'
    );

    $reader = avesmapsWikiDumpOpenReader($dumpPath);

    $processedThisStep = 0;
    $pathsWritten = 0;
    $regionsWritten = 0;
    $settlementsWritten = 0;
    $buildingsWritten = 0;
    $territoriesWritten = 0;
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

                case AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT:
                    $result = avesmapsWikiDumpParseSettlementPage($page);
                    if ($result['kept'] && is_array($result['record'])) {
                        // Base cols via the reused upsert; enrich cols via the reused
                        // UPDATE (license NULL, I5). Registry only -- no case flow.
                        avesmapsWikiSyncUpsertPageCache($pdo, avesmapsWikiDumpBuildApiPageFromDump($page), true);
                        $settlementCoat = (string) ($result['record']['coat_url'] ?? '');
                        $settlementEnrich->execute([
                            'continent' => $result['record']['continent'] !== '' ? $result['record']['continent'] : AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
                            'is_ruined' => !empty($result['record']['is_ruined']) ? 1 : 0,
                            'coat_url' => $settlementCoat !== '' ? $settlementCoat : null,
                            'title' => (string) $result['record']['title'],
                        ]);
                        $settlementsWritten++;
                    }
                    break;

                case AVESMAPS_WIKI_DUMP_ENTITY_BUILDING:
                    $result = avesmapsWikiDumpParseBuildingPage($page);
                    if ($result['kept'] && is_array($result['record'])) {
                        // Reused online building-row upsert (gebaeude class/label/type +
                        // is_ruined). Registry only -- no case flow (I2).
                        avesmapsWikiSettlementUpsertBuildingRow(
                            $pdo,
                            (string) ($result['record']['title'] ?? ''),
                            (string) ($result['record']['building_type'] ?? ''),
                            !empty($result['record']['is_ruined'])
                        );
                        $buildingsWritten++;
                    }
                    break;

                case AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY:
                    $result = avesmapsWikiDumpParseTerritoryPage($page);
                    if ($result['kept'] && is_array($result['record'])) {
                        // Reused sandbox upsert + title->key alias (I7). Writes ONLY
                        // political_territory_wiki_test + wiki_redirect_alias -- never
                        // wiki_territory_model / political_territory / geometry (I3/I4).
                        avesmapsWikiSyncMonitorUpsertTestRecord($pdo, $result['record']);
                        $territoryTitle = (string) ($page['title'] ?? '');
                        avesmapsWikiSyncMonitorStoreAlias($pdo, [$territoryTitle, $territoryTitle], (string) ($result['record']['wiki_key'] ?? ''));
                        $territoriesWritten++;
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
        'settlements_written' => $settlementsWritten,
        'buildings_written' => $buildingsWritten,
        'territories_written' => $territoriesWritten,
    ];
}
