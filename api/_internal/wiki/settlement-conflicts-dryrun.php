<?php

declare(strict_types=1);

/**
 * WikiDump migration -- SETTLEMENT-CONFLICT DRY-RUN library (READ-ONLY, no API).
 * ===========================================================================
 * This is the include-safe logic layer behind
 * scripts/wikidump-settlement-conflicts-dryrun.php. It answers ONE question for
 * the owner, from REAL data, BEFORE the sharp settlement-Syncen is built: are the
 * 8 existing settlement conflict case types (AVESMAPS_WIKI_CASE_LABELS,
 * locations.php:7-16) enough to describe what a settlement crawl finds, or is a
 * 9th category needed?
 *
 * It does that by REPRODUCING, byte-faithfully, the live decision tree the online
 * WikiSync uses to turn (wiki settlement pages x map places) into cases --
 * avesmapsWikiSyncMatchMapPlaces (locations.php:266-351) +
 * avesmapsWikiSyncBuildAndStoreCases (locations.php:470-556) -- but sourcing the
 * wiki side from the DUMP sandbox instead of a live MediaWiki fetch, and NEVER
 * persisting a single row. It then additionally counts, per exact match, the
 * things NONE of the 8 case types compares (the "9th-category candidates"), so
 * the owner can see whether real data actually contains conflicts the current 8
 * types would silently drop.
 *
 * WHY MIRROR, NOT CALL, the live functions
 * ---------------------------------------------------------------------------
 * avesmapsWikiSyncMatchMapPlaces() internally calls
 * avesmapsWikiSyncFetchPagesByTitle() -> avesmapsWikiSyncApiRequest() (a LIVE
 * MediaWiki API round-trip, locations-helpers.php:239-313), and
 * avesmapsWikiSyncBuildAndStoreCases() calls avesmapsWikiSyncUpsertCase() (which
 * WRITES wiki_sync_cases). Neither is acceptable here: this tool must hit no API
 * and write nothing. So the two API/DB-coupled functions are mirrored as
 * NON-FETCHING, NON-PERSISTING variants below
 * (avesmapsWikiDumpDryRunMatchMapPlaces / avesmapsWikiDumpDryRunBuildCases), each
 * documented against the exact live source lines a reviewer must diff them
 * against. The PURE, read-only helpers the live tree uses
 * (avesmapsWikiSyncFindProbableWikiMatches, avesmapsWikiSyncFindDuplicateMapPlaceNames,
 * avesmapsWikiSyncBuildCase, avesmapsWikiSyncCoordinatesToMapLocation,
 * avesmapsWikiSyncBuildPublicWikiPlace, ...) are REUSED VERBATIM -- only the two
 * coupled functions are forked, and only in their data source, never their
 * decision logic.
 *
 * IT WRITES NOTHING AND CALLS NO API. There is no INSERT / UPDATE / DELETE /
 * CREATE / ALTER / TRUNCATE anywhere in this file, and no
 * avesmapsWikiSyncApiRequest / avesmapsWikiSyncFetchPagesByTitle /
 * avesmapsWikiSyncUpsertCase call is reachable from any function here. The one DB
 * touch is avesmapsWikiSyncReadMapPlaces($pdo) (a pure SELECT on map_features,
 * locations.php:217-264), reused verbatim, invoked by the CLI and passed in --
 * this library never opens the DB itself.
 *
 * PURITY CONTRACT: side-effect-free on include (only const + function
 * definitions -- no top-level code, no DB connect, no headers), so
 * tools/wikidump/test-settlement-conflicts-dryrun.php can `require` it with no
 * MySQL and drive every function with synthetic arrays.
 *
 * DEPENDENCIES (the caller loads these before invoking anything here -- the same
 * chain scripts/wikidump-compare.php loads):
 *   _internal/bootstrap.php, wiki/sync.php, wiki/locations.php (+ its
 *   locations-helpers.php), wiki/settlements.php. This file requires nothing on
 *   include.
 */

// ---------------------------------------------------------------------------
// coordinate_drift threshold -- image-space units (the 0..1024 L.CRS.Simple map
// space, AGENTS.md §1). A named constant so the owner can tune it from one place.
//
// REASONING: a correctly-assigned settlement marker should sit within a few
// image units of the position its wiki coordinates convert to. The conversion
// itself is lossy: positionskarte coordinates are explicitly flagged "gröber als
// DereGlobus" (coarser -- locations-helpers.php:425), and both sides round to 3
// decimals. 5.0 units is ~0.49% of the 1024-unit axis span -- loose enough to
// absorb that rounding + positionskarte coarseness without crying wolf, yet tight
// enough that a marker dragged to the wrong place (tens/hundreds of units away)
// is flagged. It is deliberately a EUCLIDEAN distance in the shared [x,y] image
// space (both sides converted into it first), not raw wiki units, so the number
// is comparable across the two coordinate sources.
// ---------------------------------------------------------------------------
const AVESMAPS_WIKIDUMP_DRYRUN_COORD_DRIFT_UNITS = 5.0;

// How many example titles to carry per candidate/section in the report.
const AVESMAPS_WIKIDUMP_DRYRUN_SAMPLE_LIMIT = 8;

// ===========================================================================
// 1. Build the wiki-side "places" from DUMP settlement records.
//    MIRRORS avesmapsWikiSyncMatchMapPlaces's wiki-place assembly loop
//    (locations.php:269-284) -- EXCEPT the data source: instead of
//    avesmapsWikiSyncFetchPagesByTitle() (a LIVE API fetch) + per-page
//    avesmapsWikiSyncInferSettlementClassFromPage() (which reads live-fetched
//    category objects), the title / normalized_key / settlement_class / url are
//    taken DIRECTLY off the dump record, which already carries them
//    (avesmapsWikiDumpParseSettlementPage, dump-entity-scan.php:583-600, resolves
//    settlement_class from the online-category override or the dump categories).
//    This is exactly the substitution the dryrun-analysis plan specifies: "source
//    $wikiPlaces from DUMP settlement records: title->title, normalized_key
//    direct, settlement_class direct -- do NOT call InferSettlementClassFromPage".
//    The resulting per-place shape is IDENTICAL to what the live loop builds
//    (title, normalized_key, settlement_class, url, page), so every downstream
//    decision is byte-faithful.
// ===========================================================================

/**
 * @param list<array<string,mixed>> $settlementRecords dump settlement records
 *        (avesmapsWikiDumpParseSettlementPage shape), gebaeude ALREADY filtered out
 *        by the caller (they are buildings, not settlements -- dryrun-analysis plan).
 * @return list<array{title:string, normalized_key:string, settlement_class:string, url:string, record:array<string,mixed>}>
 */
function avesmapsWikiDumpDryRunWikiPlacesFromRecords(array $settlementRecords): array
{
    $wikiPlaces = [];
    foreach ($settlementRecords as $record) {
        if (!is_array($record)) {
            continue;
        }
        $title = trim((string) ($record['title'] ?? ''));
        if ($title === '') {
            continue;
        }

        // normalized_key: prefer the record's own (avesmapsWikiSyncCreateMatchKey
        // of the name, set by the parser as 'normalized_key'); fall back to
        // re-deriving from the title via the SAME key function the live loop uses
        // (locations.php:279) so a record missing the field still keys identically.
        $normalizedKey = trim((string) ($record['normalized_key'] ?? ''));
        if ($normalizedKey === '') {
            $normalizedKey = avesmapsWikiSyncCreateMatchKey($title);
        }

        $wikiPlaces[] = [
            'title' => $title,
            'normalized_key' => $normalizedKey,
            // settlement_class taken DIRECTLY off the dump record (already resolved).
            'settlement_class' => (string) ($record['settlement_class'] ?? ''),
            // url: the live loop uses avesmapsWikiSyncPageUrl($title); the record
            // already carries wiki_url from the same derivation -- prefer it, else
            // rebuild identically.
            'url' => (string) ($record['wiki_url'] ?? '') !== ''
                ? (string) ($record['wiki_url'] ?? '')
                : avesmapsWikiSyncPageUrl($title),
            'record' => $record, // kept for the 9th-category candidate checks (not in the live shape)
        ];
    }

    return $wikiPlaces;
}

// ===========================================================================
// 2. Match map places against the DUMP wiki places.
//    NON-FETCHING MIRROR of avesmapsWikiSyncMatchMapPlaces (locations.php:266-351).
//    The ONLY difference from the live function is lines 267-284: the live
//    function fetches pages from the API and infers class per page; this variant
//    receives the already-built wiki-place list (from
//    avesmapsWikiDumpDryRunWikiPlacesFromRecords above). From the grouping onward
//    (the wikiByKey index + the exact/duplicate/fuzzy decision, locations.php:286-344)
//    this is a LINE-FOR-LINE copy so the match/unresolved partition is identical
//    to a live crawl's. It REUSES avesmapsWikiSyncBuildPublicWikiPlace and
//    avesmapsWikiSyncFindProbableWikiMatches verbatim (the same pure helpers the
//    live function calls).
// ===========================================================================

/**
 * @param list<array<string,mixed>> $mapPlaces  avesmapsWikiSyncReadMapPlaces() output
 * @param list<array<string,mixed>> $wikiPlaces avesmapsWikiDumpDryRunWikiPlacesFromRecords() output
 * @return array{matches:list<array<string,mixed>>, unresolved:list<array<string,mixed>>, matched_titles:list<string>}
 */
function avesmapsWikiDumpDryRunMatchMapPlaces(array $mapPlaces, array $wikiPlaces): array
{
    // --- locations.php:286-292 (verbatim): group wiki places by normalized_key ---
    $wikiByKey = [];
    foreach ($wikiPlaces as $wikiPlace) {
        $key = (string) ($wikiPlace['normalized_key'] ?? '');
        if ($key !== '') {
            $wikiByKey[$key][] = $wikiPlace;
        }
    }

    $matchedWikiTitles = [];
    $matches = [];
    $unresolved = [];

    // --- locations.php:298-344 (verbatim decision tree) ---
    foreach ($mapPlaces as $mapPlace) {
        $mapKey = (string) ($mapPlace['normalized_key'] ?? '');
        $candidates = $mapKey !== '' ? ($wikiByKey[$mapKey] ?? []) : [];

        if (count($candidates) === 1) {
            $wikiPlace = $candidates[0];
            $matchedWikiTitles[(string) $wikiPlace['title']] = true;
            $matches[] = [
                'match_kind' => 'exact',
                'score' => 1.0,
                'map' => $mapPlace,
                'wiki' => avesmapsWikiSyncBuildPublicWikiPlace($wikiPlace),
                // dryrun-only: keep the full wiki place so the candidate checks can
                // reach the dump record's continent/is_ruined/coat/coordinates. NOT
                // part of the live 'matches' shape and NOT read by any of the 8 types.
                'wiki_record' => is_array($wikiPlace['record'] ?? null) ? $wikiPlace['record'] : [],
            ];
            continue;
        }

        if (count($candidates) > 1) {
            $candidatePayloads = array_map(
                static fn(array $candidate): array => [
                    'match_kind' => 'exact',
                    'score' => 1.0,
                    'wiki' => avesmapsWikiSyncBuildPublicWikiPlace($candidate),
                ],
                $candidates
            );

            foreach ($candidates as $candidate) {
                $matchedWikiTitles[(string) $candidate['title']] = true;
            }

            $unresolved[] = [
                'map' => $mapPlace,
                'candidates' => $candidatePayloads,
            ];
            continue;
        }

        // 0 exact candidates -> fuzzy probable matches (REUSED verbatim).
        $probableCandidates = avesmapsWikiSyncFindProbableWikiMatches($mapPlace, $wikiPlaces);
        foreach ($probableCandidates as $candidate) {
            $matchedWikiTitles[(string) ($candidate['wiki']['title'] ?? '')] = true;
        }

        $unresolved[] = [
            'map' => $mapPlace,
            'candidates' => $probableCandidates,
        ];
    }

    return [
        'matches' => $matches,
        'unresolved' => $unresolved,
        'matched_titles' => array_keys($matchedWikiTitles),
    ];
}

// ===========================================================================
// 3. Build the "missing wiki" set (wiki settlements never matched to a map place).
//    NON-FETCHING MIRROR of avesmapsWikiSyncFetchMissingWikiPlaces
//    (locations.php:427-468). The live function re-fetches each missing title's
//    CONTENT from the API and extracts coordinates from it
//    (avesmapsWikiSyncExtractCoordinatesFromContent); this variant reads the
//    coordinates DIRECTLY off the dump record's coordinates_json, which is the
//    SAME value produced by the SAME extractor over the SAME wikitext
//    (avesmapsWikiDumpParseSettlementPage line 559 calls the identical
//    avesmapsWikiSyncExtractCoordinatesFromContent), so the {source,x,y} triple --
//    and therefore the with/without-coordinates split -- is byte-identical to a
//    live crawl's. Shapes each missing place like the live function does (a 'wiki'
//    envelope carrying the coordinates), so avesmapsWikiDumpDryRunBuildCases below
//    can call avesmapsWikiSyncCoordinatesToMapLocation on it verbatim.
// ===========================================================================

/**
 * @param list<array{title:string, normalized_key:string, settlement_class:string, url:string, record:array<string,mixed>}> $wikiPlaces
 * @param list<string> $matchedTitles titles that DID match a map place (the live "matched" set)
 * @return list<array{wiki:array<string,mixed>}>
 */
function avesmapsWikiDumpDryRunMissingWikiPlaces(array $wikiPlaces, array $matchedTitles): array
{
    // --- locations.php:428-434 (verbatim): titles present but never matched ---
    $matchedTitleSet = array_fill_keys($matchedTitles, true);

    $missingPlaces = [];
    foreach ($wikiPlaces as $wikiPlace) {
        $title = (string) ($wikiPlace['title'] ?? '');
        if ($title === '' || isset($matchedTitleSet[$title])) {
            continue;
        }

        $record = is_array($wikiPlace['record'] ?? null) ? $wikiPlace['record'] : [];
        // coordinates_json off the dump record == the SAME extractor's output the
        // live path re-fetches (locations.php:445-446). Normalise to the {source,x,y}
        // shape avesmapsWikiSyncCoordinatesToMapLocation expects.
        $coordinates = is_array($record['coordinates_json'] ?? null)
            ? $record['coordinates_json']
            : ['source' => 'none', 'x' => null, 'y' => null];

        $missingPlaces[] = [
            'wiki' => [
                'title' => $title,
                'url' => (string) ($wikiPlace['url'] ?? ''),
                'settlement_class' => (string) ($wikiPlace['settlement_class'] ?? ''),
                'coordinates' => $coordinates,
            ],
        ];
    }

    // --- locations.php:453-465 (verbatim sort): dereglobus < positionskarte < none, then title ---
    usort(
        $missingPlaces,
        static function (array $left, array $right): int {
            $sourceComparison = avesmapsWikiSyncCoordinateSortValue((string) ($left['wiki']['coordinates']['source'] ?? 'none'))
                <=> avesmapsWikiSyncCoordinateSortValue((string) ($right['wiki']['coordinates']['source'] ?? 'none'));

            if ($sourceComparison !== 0) {
                return $sourceComparison;
            }

            return strcasecmp((string) $left['wiki']['title'], (string) $right['wiki']['title']);
        }
    );

    return $missingPlaces;
}

// ===========================================================================
// 4. Classify into the 8 case types -- NON-PERSISTING MIRROR of
//    avesmapsWikiSyncBuildAndStoreCases (locations.php:470-556). Byte-faithful to
//    the live case-emission tree EXCEPT it collects the cases into an array and
//    RETURNS them (grouped by type) instead of calling avesmapsWikiSyncUpsertCase.
//    Every condition is a line-for-line copy of the live source; the
//    avesmapsWikiSyncBuildCase / avesmapsWikiSyncFindDuplicateMapPlaceNames helpers
//    are REUSED verbatim (they are pure). The count this returns per type is
//    therefore exactly the count of cases a live crawl of the SAME data would
//    UPSERT (before status/dedup collapsing, which the dry-run intentionally does
//    not model -- it reports raw emission, the honest "how many the tree produces").
// ===========================================================================

/**
 * @param array{matches:list<array<string,mixed>>, unresolved:list<array<string,mixed>>} $matchResult
 * @param list<array<string,mixed>> $mapPlaces
 * @param list<array{wiki:array<string,mixed>}> $missingPlaces
 * @return array<string, list<array<string,mixed>>> case_type => list of built cases (in AVESMAPS_WIKI_CASE_LABELS key order)
 */
function avesmapsWikiDumpDryRunBuildCases(array $matchResult, array $mapPlaces, array $missingPlaces): array
{
    // Pre-seed every known type so the report always shows all 8 (0 where none fired).
    $byType = [];
    foreach (array_keys(AVESMAPS_WIKI_CASE_LABELS) as $caseType) {
        $byType[$caseType] = [];
    }

    $matches = $matchResult['matches'] ?? [];
    $unresolved = $matchResult['unresolved'] ?? [];

    // --- locations.php:478-486 (verbatim): duplicate_avesmaps_name ---
    // >=2 active map rows sharing a trimmed literal name (REUSED helper).
    foreach (avesmapsWikiSyncFindDuplicateMapPlaceNames($mapPlaces) as $duplicateGroup) {
        $byType['duplicate_avesmaps_name'][] = avesmapsWikiSyncBuildCase('duplicate_avesmaps_name', $duplicateGroup);
    }

    // --- locations.php:488-497 (verbatim): per match, canonical_name_difference + type_conflict ---
    foreach ($matches as $match) {
        if (($match['match_kind'] ?? '') !== 'exact') {
            // Never fires today: the match loop only ever appends 'exact'. Kept for
            // fidelity (will be 0) -- exactly as the live tree keeps it.
            $byType['canonical_name_difference'][] = avesmapsWikiSyncBuildCase('canonical_name_difference', $match);
        }
        $wikiClass = (string) ($match['wiki']['settlement_class'] ?? '');
        $mapClass = (string) ($match['map']['settlement_class'] ?? '');
        if ($wikiClass !== '' && $mapClass !== '' && $wikiClass !== $mapClass) {
            $byType['type_conflict'][] = avesmapsWikiSyncBuildCase('type_conflict', $match);
        }
    }

    // --- locations.php:499-502 (verbatim): per unresolved, probable_match | unresolved_without_candidate ---
    foreach ($unresolved as $result) {
        $caseType = !empty($result['candidates']) ? 'probable_match' : 'unresolved_without_candidate';
        $byType[$caseType][] = avesmapsWikiSyncBuildCase($caseType, $result);
    }

    // --- locations.php:504-523 (verbatim): duplicate_wiki_title ---
    // >1 distinct map.name sharing one wiki.title.
    $matchesByTitle = [];
    foreach ($matches as $match) {
        $title = (string) ($match['wiki']['title'] ?? '');
        if ($title === '') {
            continue;
        }
        $matchesByTitle[$title][] = $match;
    }
    foreach ($matchesByTitle as $title => $titleMatches) {
        $mapNames = [];
        foreach ($titleMatches as $match) {
            $mapNames[(string) ($match['map']['name'] ?? '')] = true;
        }
        if (count($mapNames) > 1) {
            $byType['duplicate_wiki_title'][] = avesmapsWikiSyncBuildCase('duplicate_wiki_title', [
                'wiki' => $titleMatches[0]['wiki'],
                'matches' => $titleMatches,
            ]);
        }
    }

    // --- locations.php:525-534 (verbatim): missing_wiki_with/without_coordinates ---
    foreach ($missingPlaces as $missingPlace) {
        $source = (string) ($missingPlace['wiki']['coordinates']['source'] ?? 'none');
        $payload = $missingPlace;
        $proposedLocation = $source === 'none'
            ? null
            : avesmapsWikiSyncCoordinatesToMapLocation($missingPlace['wiki']['coordinates']);
        $caseType = $proposedLocation === null ? 'missing_wiki_without_coordinates' : 'missing_wiki_with_coordinates';
        if ($proposedLocation !== null) {
            $payload['proposed_location'] = $proposedLocation;
        }
        $byType[$caseType][] = avesmapsWikiSyncBuildCase($caseType, $payload);
    }

    return $byType;
}

// ===========================================================================
// 5. 9th-category candidate detection -- the POINT of the dry-run.
//    For each EXACT match, check the things NONE of the 8 case types compares.
//    This is honest accounting: it only counts a candidate when the underlying
//    fields genuinely diverge, and it reports which fields are structurally
//    UNAVAILABLE on the map side (so a 0 is never mistaken for "checked and clean").
// ===========================================================================

/**
 * Euclidean drift, in image-space units, between a dump settlement's converted
 * wiki coordinates and its matched map feature's geometry. Returns null when
 * either side has no usable coordinate (so it is not counted as a drift). The
 * dump side is converted into the SAME [x,y] image space the map geometry lives
 * in via avesmapsWikiSyncCoordinatesToMapLocation (REUSED verbatim -- the same
 * transform the live "missing with coordinates" proposal uses), so both sides are
 * comparable.
 *
 * @param array<string,mixed> $mapPlace   avesmapsWikiSyncReadMapPlaces() entry (carries 'geometry')
 * @param array<string,mixed> $wikiRecord the dump settlement record (carries 'coordinates_json')
 */
function avesmapsWikiDumpDryRunCoordinateDrift(array $mapPlace, array $wikiRecord): ?float
{
    $coordinates = is_array($wikiRecord['coordinates_json'] ?? null)
        ? $wikiRecord['coordinates_json']
        : null;
    if ($coordinates === null || (string) ($coordinates['source'] ?? 'none') === 'none') {
        return null;
    }
    $proposed = avesmapsWikiSyncCoordinatesToMapLocation($coordinates); // -> {lat, lng} in image space, or null
    if (!is_array($proposed)) {
        return null;
    }

    $geometry = is_array($mapPlace['geometry'] ?? null) ? $mapPlace['geometry'] : null;
    $mapCoords = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : null;
    if ($mapCoords === null || count($mapCoords) < 2
        || !is_numeric($mapCoords[0]) || !is_numeric($mapCoords[1])) {
        return null;
    }

    // GeoJSON stores [x, y] = [lng, lat] (AGENTS.md §5). The proposed location is
    // {lat, lng}. Compare in [x=lng, y=lat] consistently.
    $mapLng = (float) $mapCoords[0];
    $mapLat = (float) $mapCoords[1];
    $wikiLng = (float) ($proposed['lng'] ?? 0.0);
    $wikiLat = (float) ($proposed['lat'] ?? 0.0);

    return sqrt((($mapLng - $wikiLng) ** 2) + (($mapLat - $wikiLat) ** 2));
}

/**
 * Read the map feature's current wiki snapshot fields relevant to the candidate
 * checks. The map side carries these under properties: a wiki_settlement infobox
 * snapshot (avesmapsWikiSettlementParseInfobox shape -- has wiki_url + wappen_url
 * but NO is_ruined / continent), plus top-level properties.is_ruined /
 * properties.wiki_url written by avesmapsWikiSyncBuildLocationProperties
 * (locations.php:865-894). Returns a normalised view + presence flags so the
 * caller can distinguish "differs" from "not comparable".
 *
 * @param array<string,mixed> $mapPlace
 * @return array{wiki_url:string, is_ruined:?bool, coat_present:bool, has_snapshot:bool}
 */
function avesmapsWikiDumpDryRunMapSnapshot(array $mapPlace): array
{
    $properties = is_array($mapPlace['properties'] ?? null) ? $mapPlace['properties'] : [];
    $snapshot = is_array($properties['wiki_settlement'] ?? null) ? $properties['wiki_settlement'] : [];
    $hasSnapshot = $snapshot !== [];

    // wiki_url: prefer the top-level property (what ReadMapPlaces already surfaces),
    // else the snapshot's.
    $wikiUrl = (string) ($mapPlace['wiki_url'] ?? '');
    if ($wikiUrl === '' && $hasSnapshot) {
        $wikiUrl = (string) ($snapshot['wiki_url'] ?? '');
    }

    // is_ruined: only the top-level property carries it (the infobox snapshot does
    // not). Absent -> null ("map side does not assert a ruin state").
    $isRuined = array_key_exists('is_ruined', $properties)
        ? (bool) $properties['is_ruined']
        : null;

    // coat presence: the snapshot's wappen_url is the map side's coat.
    $coatPresent = $hasSnapshot && trim((string) ($snapshot['wappen_url'] ?? '')) !== '';

    return [
        'wiki_url' => $wikiUrl,
        'is_ruined' => $isRuined,
        'coat_present' => $coatPresent,
        'has_snapshot' => $hasSnapshot,
    ];
}

/**
 * Scan every EXACT match for the 9th-category candidates and tally them. Pure:
 * consumes the match list (each carrying 'map' + dryrun-only 'wiki_record') and
 * returns per-candidate counts + a few example titles each. Honest by
 * construction: a candidate is counted ONLY when the compared fields genuinely
 * diverge, and continent is reported as structurally-not-comparable (the map
 * location feature has no continent column -- only territories do), so its count
 * is an informational "dump asserts a non-default continent" tally, never a
 * fabricated mismatch against a field that does not exist.
 *
 * @param list<array<string,mixed>> $matches   avesmapsWikiDumpDryRunMatchMapPlaces()['matches']
 * @param int $sampleLimit examples to keep per candidate
 * @return array<string, array{count:int, samples:list<string>, note?:string}>
 */
function avesmapsWikiDumpDryRunCandidateScan(array $matches, int $sampleLimit = AVESMAPS_WIKIDUMP_DRYRUN_SAMPLE_LIMIT): array
{
    $out = [
        'coordinate_drift' => ['count' => 0, 'samples' => [], 'max_drift' => 0.0],
        'continent_dump_nondefault' => ['count' => 0, 'samples' => [], 'note' =>
            'The map LOCATION feature has no continent field (only political_territory '
            . 'does), so this is NOT a map-vs-dump mismatch -- it counts exact matches '
            . 'whose DUMP continent is a non-default (non-"' . AVESMAPS_POLITICAL_DEFAULT_CONTINENT
            . '") value, i.e. the settlements a continent-aware 9th category could gate on.'],
        'is_ruined_or_url_change' => ['count' => 0, 'samples' => [], 'ruined_diff' => 0, 'url_diff' => 0],
        'coat_presence_diff' => ['count' => 0, 'samples' => [], 'dump_only' => 0, 'map_only' => 0],
        'matched_no_case_but_candidate' => ['count' => 0, 'samples' => []],
    ];

    $addSample = static function (array &$bucket, string $title) use ($sampleLimit): void {
        if (count($bucket['samples']) < $sampleLimit && $title !== '') {
            $bucket['samples'][] = $title;
        }
    };

    foreach ($matches as $match) {
        $mapPlace = is_array($match['map'] ?? null) ? $match['map'] : [];
        $wikiRecord = is_array($match['wiki_record'] ?? null) ? $match['wiki_record'] : [];
        $title = (string) ($match['wiki']['title'] ?? ($mapPlace['name'] ?? ''));
        $snapshot = avesmapsWikiDumpDryRunMapSnapshot($mapPlace);
        $flaggedThisMatch = false;

        // --- coordinate_drift ---
        $drift = avesmapsWikiDumpDryRunCoordinateDrift($mapPlace, $wikiRecord);
        if ($drift !== null && $drift > AVESMAPS_WIKIDUMP_DRYRUN_COORD_DRIFT_UNITS) {
            $out['coordinate_drift']['count']++;
            $out['coordinate_drift']['max_drift'] = max($out['coordinate_drift']['max_drift'], round($drift, 2));
            $addSample($out['coordinate_drift'], $title . ' (' . round($drift, 1) . 'u)');
            $flaggedThisMatch = true;
        }

        // --- continent (dump non-default; informational, see note) ---
        $dumpContinent = trim((string) ($wikiRecord['continent'] ?? ''));
        if ($dumpContinent !== '' && $dumpContinent !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT) {
            $out['continent_dump_nondefault']['count']++;
            $addSample($out['continent_dump_nondefault'], $title . ' [' . $dumpContinent . ']');
            $flaggedThisMatch = true;
        }

        // --- is_ruined_or_url_change ---
        $ruinDiff = false;
        $dumpRuined = (bool) ($wikiRecord['is_ruined'] ?? false);
        if ($snapshot['is_ruined'] !== null && $snapshot['is_ruined'] !== $dumpRuined) {
            $ruinDiff = true;
        }
        $urlDiff = false;
        $dumpUrl = trim((string) ($wikiRecord['wiki_url'] ?? ''));
        if ($dumpUrl !== '' && $snapshot['wiki_url'] !== '' && $dumpUrl !== $snapshot['wiki_url']) {
            $urlDiff = true;
        }
        if ($ruinDiff || $urlDiff) {
            $out['is_ruined_or_url_change']['count']++;
            $out['is_ruined_or_url_change']['ruined_diff'] += $ruinDiff ? 1 : 0;
            $out['is_ruined_or_url_change']['url_diff'] += $urlDiff ? 1 : 0;
            $addSample($out['is_ruined_or_url_change'], $title);
            $flaggedThisMatch = true;
        }

        // --- coat_presence_diff ---
        $dumpCoat = trim((string) ($wikiRecord['coat_url'] ?? '')) !== '';
        $mapCoat = (bool) $snapshot['coat_present'];
        if ($dumpCoat !== $mapCoat) {
            $out['coat_presence_diff']['count']++;
            $out['coat_presence_diff']['dump_only'] += ($dumpCoat && !$mapCoat) ? 1 : 0;
            $out['coat_presence_diff']['map_only'] += (!$dumpCoat && $mapCoat) ? 1 : 0;
            $addSample($out['coat_presence_diff'], $title);
            $flaggedThisMatch = true;
        }

        if ($flaggedThisMatch) {
            $out['matched_no_case_but_candidate']['count']++;
            $addSample($out['matched_no_case_but_candidate'], $title);
        }
    }

    return $out;
}

// ===========================================================================
// 6. Top-level orchestration -- ties the mirrored pieces together and returns a
//    fully-structured report the CLI prints. PURE apart from the injected
//    $mapPlaces / $settlementRecords (the CLI reads those read-only). No DB, no
//    API here.
// ===========================================================================

/**
 * @param list<array<string,mixed>> $mapPlaces          avesmapsWikiSyncReadMapPlaces() output (read-only SELECT)
 * @param list<array<string,mixed>> $settlementRecordsAll dump settlement records (INCLUDING gebaeude)
 * @param int $sampleLimit examples per section
 * @return array<string, mixed>
 */
function avesmapsWikiDumpDryRunClassifySettlements(
    array $mapPlaces,
    array $settlementRecordsAll,
    int $sampleLimit = AVESMAPS_WIKIDUMP_DRYRUN_SAMPLE_LIMIT
): array {
    // FILTER OUT gebaeude (buildings, not settlements) so they never inflate
    // type_conflict / unresolved -- dryrun-analysis plan + wikidump-compare.php:557.
    $settlementRecords = [];
    $gebaeudeFiltered = 0;
    $dualParsePromotions = 0;
    foreach ($settlementRecordsAll as $record) {
        if (!is_array($record)) {
            continue;
        }
        if ((string) ($record['settlement_class'] ?? '') === 'gebaeude') {
            $gebaeudeFiltered++;
            continue;
        }
        $settlementRecords[] = $record;

        // Dual-parse promotion note (dump-hybrid-read.php:274-292): a settlement that
        // ALSO promotes to a territory has no analogue among the 8 settlement case
        // types. We can only observe it here if the record carries the marker the
        // parser leaves; count it honestly when present (0 if the field is absent --
        // the dry-run does not re-run the territory handler, it only reports what the
        // settlement record already tells it).
        if (!empty($record['promoted_to_territory']) || !empty($record['territory_record'])) {
            $dualParsePromotions++;
        }
    }

    $wikiPlaces = avesmapsWikiDumpDryRunWikiPlacesFromRecords($settlementRecords);
    $matchResult = avesmapsWikiDumpDryRunMatchMapPlaces($mapPlaces, $wikiPlaces);
    $missingPlaces = avesmapsWikiDumpDryRunMissingWikiPlaces($wikiPlaces, $matchResult['matched_titles']);
    $casesByType = avesmapsWikiDumpDryRunBuildCases($matchResult, $mapPlaces, $missingPlaces);
    $candidates = avesmapsWikiDumpDryRunCandidateScan($matchResult['matches'], $sampleLimit);

    // Section A: count per the 8 types (+ a few example titles each), in the
    // canonical AVESMAPS_WIKI_CASE_LABELS order.
    $caseTypeReport = [];
    $caseTotal = 0;
    foreach (AVESMAPS_WIKI_CASE_LABELS as $caseType => $label) {
        $cases = $casesByType[$caseType] ?? [];
        $caseTotal += count($cases);
        $samples = [];
        foreach ($cases as $case) {
            if (count($samples) >= $sampleLimit) {
                break;
            }
            $samples[] = avesmapsWikiDumpDryRunCaseSampleTitle($case);
        }
        $caseTypeReport[$caseType] = [
            'label' => $label,
            'count' => count($cases),
            'samples' => $samples,
        ];
    }

    // Section C totals.
    $exactMatchCount = count($matchResult['matches']);
    $wouldNeedNinth = (int) ($candidates['matched_no_case_but_candidate']['count'] ?? 0);
    $cleanMatches = max(0, $exactMatchCount - $wouldNeedNinth);

    return [
        'header' => [
            'dump_settlements_excl_gebaeude' => count($settlementRecords),
            'gebaeude_filtered_out' => $gebaeudeFiltered,
            'map_places' => count($mapPlaces),
            'coord_drift_threshold_units' => AVESMAPS_WIKIDUMP_DRYRUN_COORD_DRIFT_UNITS,
        ],
        'section_a_case_types' => [
            'by_type' => $caseTypeReport,
            'total_cases' => $caseTotal,
        ],
        'section_b_candidates' => $candidates,
        'section_c_totals' => [
            'exact_matches' => $exactMatchCount,
            'unresolved' => count($matchResult['unresolved']),
            'missing_wiki' => count($missingPlaces),
            'clean_exact_matches' => $cleanMatches,
            'exact_matches_needing_9th' => $wouldNeedNinth,
            'dual_parse_promotions' => $dualParsePromotions,
        ],
    ];
}

/**
 * Best-effort human title for a built case (for the Section A examples). Reads the
 * standard case fields avesmapsWikiSyncBuildCase populates (wiki_title /
 * map_public_id) plus the payload's map name where present.
 *
 * @param array<string,mixed> $case
 */
function avesmapsWikiDumpDryRunCaseSampleTitle(array $case): string
{
    $wikiTitle = (string) ($case['wiki_title'] ?? '');
    if ($wikiTitle !== '') {
        return $wikiTitle;
    }
    $payload = is_array($case['payload'] ?? null) ? $case['payload'] : [];
    $mapName = (string) ($payload['map']['name'] ?? ($payload['name'] ?? ''));
    if ($mapName !== '') {
        return $mapName;
    }
    return (string) ($case['map_public_id'] ?? '(unnamed)');
}
