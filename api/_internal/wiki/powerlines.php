<?php

declare(strict_types=1);

/**
 * Powerlines (Kraftlinien) from Wiki Aventurica -- the PURE page parser.
 *
 * Measured 2026-07-22: 23 articles embed {{Infobox Kraftlinie}} (list=embeddedin on
 * Vorlage:Infobox Kraftlinie, ns 0). All of them sit in the main namespace, so they ride
 * the normal dump. They never reached us because avesmapsWikiDumpClassifyEntityKind had no
 * branch for "kraftlinie" and returned '' -- the same silent dump-time gate that swallowed
 * ~430 adventures.
 *
 * Real infobox fields (verified against the Basiliuslinie wikitext, not guessed):
 *   Name, Bild={{Boximage|...}}, Stärke, Affinität, Länge, Regionen, Verlauf
 * The field keys arrive normalized by avesmapsWikiSyncMonitorFieldKey (ä->a, ö->o, ü->u,
 * ß->ss, non-alphanumerics stripped), hence 'starke' / 'affinitat' / 'lange' below.
 *
 * Verlauf is an ORDERED station chain of {{Nexus|..}}, {{Nodix|..}}, {{Kraftlinie|..}} rows,
 * e.g. {{Nodix|[[Sala Mandra]]| |Zwei=j}}. That is the same shape a road's Verlauf has, so
 * this file REUSES avesmapsWikiPathExtractVerlaufStations verbatim (house rule: reuse the
 * real parser, add zero field logic of your own) rather than writing a second extractor.
 *
 * This file is DB-free and writes nothing. Staging/reconcile live elsewhere.
 *
 * Like paths.php, this expects the including endpoint to have loaded first:
 * sync.php, sync-monitor.php, sync-monitor-parsing.php, territories-parsing.php and
 * political/territory.php. Only paths.php is required here, because two of its functions
 * are reused directly.
 */

require_once __DIR__ . '/paths.php';

/**
 * PURE: the wiki nest a staging row should produce on a matching map segment.
 * Everything the wiki knows lives under properties.wiki_powerline -- never in the
 * editor's own fields.
 */
function avesmapsWikiPowerlineDesiredNest(array $stagingRow): array
{
    return [
        'wiki_key' => trim((string) ($stagingRow['wiki_key'] ?? '')),
        'wiki_url' => trim((string) ($stagingRow['wiki_url'] ?? '')),
        'name' => trim((string) ($stagingRow['name'] ?? '')),
        'staerke' => trim((string) ($stagingRow['staerke'] ?? '')),
        'affinitaet' => trim((string) ($stagingRow['affinitaet'] ?? '')),
        'laenge' => trim((string) ($stagingRow['laenge'] ?? '')),
        'regionen' => trim((string) ($stagingRow['regionen'] ?? '')),
        'verlauf' => trim((string) ($stagingRow['verlauf'] ?? '')),
        'description' => trim((string) ($stagingRow['description'] ?? '')),
    ];
}

/**
 * PURE + THE OVERRIDE GUARANTEE: merge a desired wiki nest into a segment's properties.
 *
 * 💣 Touches ONLY properties.wiki_powerline. The editor's own properties.wiki_url and
 * properties.description are never read and never written here -- a hand-set wiki link must
 * survive every sync, exactly as manual/suppressed rows survive the source reconcile
 * (AGENTS.md §5, "writes/deletes ONLY origin='wiki'").
 *
 * $desired === null means "the wiki no longer knows a line by this name" -> retire the nest.
 *
 * @return array{properties:array, changed:bool, action:string} action: linked|updated|cleared|none
 */
function avesmapsWikiPowerlineMergeProperties(array $properties, ?array $desired): array
{
    $current = is_array($properties['wiki_powerline'] ?? null) ? $properties['wiki_powerline'] : null;

    if ($desired === null) {
        if ($current === null) {
            return ['properties' => $properties, 'changed' => false, 'action' => 'none'];
        }
        unset($properties['wiki_powerline']);

        return ['properties' => $properties, 'changed' => true, 'action' => 'cleared'];
    }

    if ($current !== null && $current == $desired) {
        return ['properties' => $properties, 'changed' => false, 'action' => 'none'];
    }

    $properties['wiki_powerline'] = $desired;

    return ['properties' => $properties, 'changed' => true, 'action' => $current === null ? 'linked' : 'updated'];
}

/**
 * PURE: turn sandbox rows (each carrying a page's raw wikitext) into a match_key -> {name, nest}
 * map. This is the step that had NO end-to-end coverage and hid the "staging leer" bug: "Dump
 * holen" stages powerline pages in wiki_dump_hybrid_state with their wikitext, and this parses
 * them into the nest the reconcile writes. Keyed by match_key so a map segment finds its article
 * by name. Non-powerline pages and empty rows are skipped, never fatal.
 *
 * @param list<array<string,mixed>> $sandboxRows rows of {normalized_title, wikitext}
 * @return array<string, array{name:string, nest:array}>
 */
function avesmapsWikiPowerlineDesiredNestsByMatchKey(array $sandboxRows): array
{
    $byKey = [];
    foreach ($sandboxRows as $row) {
        $title = (string) ($row['normalized_title'] ?? '');
        $wikitext = (string) ($row['wikitext'] ?? '');
        if ($title === '' || $wikitext === '') {
            continue;
        }
        $parsed = avesmapsWikiPowerlineParsePage($title, $wikitext, $title, 'dump', '');
        if (empty($parsed['is_powerline']) || !is_array($parsed['record'] ?? null)) {
            continue;
        }
        $record = $parsed['record'];
        $matchKey = trim((string) ($record['match_key'] ?? ''));
        if ($matchKey === '') {
            continue;
        }
        $byKey[$matchKey] = [
            'name' => (string) ($record['name'] ?? ''),
            'nest' => avesmapsWikiPowerlineDesiredNest($record),
        ];
    }

    return $byKey;
}

/**
 * OWNER-TRIGGERED production reconcile: the powerline pages "Dump holen" left in the sandbox
 * (wiki_dump_hybrid_state, entity_kind='powerline', with wikitext) -> map_features.properties.
 * One shot, no cursor: 23 articles against 162 segments fit in a single request.
 *
 * 💣 Reads the SANDBOX, not a per-kind staging table. There is no powerline staging table to fill:
 * "Dump holen" only ever populates the sandbox, exactly as the per-kind "Syncen" reads it
 * (avesmapsWikiDumpSyncKindFetchRows). An earlier design read wiki_powerline_staging, which nothing
 * filled -- hence "Keine Kraftlinien im Zwischenspeicher" after a successful dump.
 *
 * The join is the NAME (avesmapsWikiSyncCreateMatchKey), because a powerline is many segments
 * sharing one lore name -- the same 1-to-N shape roads have.
 *
 * @return array{linked:int, updated:int, cleared:int, unchanged:int, staged:int, matched_names:int, unmatched_names:string[]}
 */
function avesmapsWikiPowerlineReconcile(PDO $pdo, int $userId): array
{
    // Newest completed dump_read run = the sandbox "Dump holen" left behind. Throws with a clear
    // message if none has ever completed (the endpoint surfaces it), which is the honest signal
    // rather than a silent empty result.
    $runId = avesmapsWikiDumpSyncKindResolveDumpRunId($pdo);
    // 5000 is a safe ceiling: there are ~23 powerline pages, far under one request's reach.
    $sandboxRows = avesmapsWikiDumpSyncKindFetchRows($pdo, $runId, [AVESMAPS_WIKI_DUMP_ENTITY_POWERLINE], 0, 5000);
    $staged = avesmapsWikiPowerlineDesiredNestsByMatchKey($sandboxRows);

    $segments = $pdo->query(
        "SELECT id, public_id, name, properties_json FROM map_features
          WHERE feature_type = 'powerline' AND is_active = 1"
    );
    $rows = $segments !== false ? $segments->fetchAll(PDO::FETCH_ASSOC) : [];

    $counts = ['linked' => 0, 'updated' => 0, 'cleared' => 0, 'unchanged' => 0];
    $matchedKeys = [];
    $update = $pdo->prepare(
        'UPDATE map_features SET properties_json = :props, revision = :revision, updated_by = :user WHERE id = :id'
    );

    foreach ($rows as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        $matchKey = avesmapsWikiSyncCreateMatchKey((string) ($row['name'] ?? ''));
        $entry = ($matchKey !== '' && isset($staged[$matchKey])) ? $staged[$matchKey] : null;
        if ($entry !== null) {
            $matchedKeys[$matchKey] = true;
        }

        $merged = avesmapsWikiPowerlineMergeProperties(
            $properties,
            $entry === null ? null : $entry['nest']
        );
        if (!$merged['changed']) {
            $counts['unchanged']++;
            continue;
        }
        $counts[$merged['action']]++;
        $update->execute([
            'props' => avesmapsEncodeJson($merged['properties']),
            'revision' => avesmapsNextMapRevision($pdo),
            'user' => $userId,
            'id' => (int) $row['id'],
        ]);
    }

    // Wiki lines with no segment on our map -- reported, not an error: the article may describe a
    // line nobody has drawn yet, or our name differs slightly ("Bruecke nach/von Akrabaal").
    $unmatched = [];
    foreach ($staged as $key => $entry) {
        if (!isset($matchedKeys[$key])) {
            $unmatched[] = $entry['name'] !== '' ? $entry['name'] : $key;
        }
    }
    sort($unmatched);

    // Diagnostics so a single click pinpoints the failing layer when nothing links:
    //   sandbox_rows = 0  -> "Dump holen" staged no powerline pages (its run predates the
    //                        classifier fix, or the collect phase never saw them).
    //   sandbox_rows > 0 but staged = 0 -> the parser dropped every page (encoding / infobox).
    //   staged > 0 but matched_names = 0 -> names on the map differ from the wiki titles.
    // run_completed_at tells whether the dump that filled the sandbox is recent enough.
    $runRow = avesmapsWikiDumpSyncKindFetchRunById($pdo, $runId);

    return $counts + [
        'staged' => count($staged),
        'matched_names' => count($matchedKeys),
        'unmatched_names' => $unmatched,
        'sandbox_rows' => count($sandboxRows),
        'run_id' => $runId,
        'run_completed_at' => (string) ($runRow['completed_at'] ?? ''),
    ];
}

/**
 * Parse ONE wiki page into a powerline staging record.
 *
 * @return array{is_powerline:bool, reason:string, record:?array}
 */
function avesmapsWikiPowerlineParsePage(
    string $title,
    string $wikitext,
    string $canonicalTitle = '',
    string $source = '',
    string $categories = ''
): array {
    $title = avesmapsWikiSyncMonitorNormalizeTitle($title);
    $canonical = $canonicalTitle !== '' ? avesmapsWikiSyncMonitorNormalizeTitle($canonicalTitle) : $title;
    $infoboxName = avesmapsWikiSyncMonitorInfoboxName($wikitext);
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey($infoboxName);

    // Exact-enough gate: only {{Infobox Kraftlinie}}. No other infobox name in the wiki
    // contains "kraftlinie", and nothing this claims is claimed by another handler.
    if (!str_contains($infoboxKey, 'kraftlinie')) {
        return [
            'is_powerline' => false,
            'reason' => $infoboxName === '' ? 'kein Infobox' : ('Infobox ' . $infoboxName),
            'record' => null,
        ];
    }

    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    $norm = avesmapsWikiSyncMonitorNormFields(avesmapsWikiSyncMonitorParseTemplateParams($block));
    $field = static fn(array $aliases): string => avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(
        avesmapsWikiSyncMonitorField($norm, $aliases)
    );

    // "(unbenannte Kraftlinie)" is a REAL infobox value in the wiki (see the article
    // "Kraftlinie zwischen Himmelsturm und Heiligtum der alten Götter"). Treat it as absent
    // so the page title carries the name instead of a parenthetical placeholder.
    $name = $field(['name']);
    if ($name === '' || preg_match('/^\(.*unbenannt.*\)$/iu', $name) === 1) {
        $name = $canonical;
    }

    $staerke = $field(['starke', 'starken']);
    $affinitaet = $field(['affinitat', 'affinitaet']);
    $laenge = $field(['lange', 'langen', 'lenge']);
    $regionen = $field(['regionen', 'region', 'lage']);

    // Ordered stations of the Verlauf chain -- reused verbatim from the path parser.
    $verlaufRaw = avesmapsWikiSyncMonitorField($norm, ['verlauf']);
    $stations = avesmapsWikiPathExtractVerlaufStations($verlaufRaw);
    $verlauf = mb_substr(implode(' → ', array_slice($stations, 0, 60)), 0, 4000, 'UTF-8');

    $navHints = '';
    if (preg_match_all('/\{\{\s*(Nav\s+[^}|]+|Aventurien|Myranor|G[üu]ldenland|Gueldenland|Rakshazar|Riesland|Tharun|Uthuria|Lahmaria)\b/iu', $wikitext, $navMatches) >= 1) {
        $navHints = implode(' ', $navMatches[1]);
    }
    $continent = avesmapsWikiSyncMonitorDetectContinent($title . ' ' . $regionen . ' ' . $navHints . ' ' . $categories);

    $synonyms = [];
    if ($canonical !== '' && $canonical !== $name) {
        $synonyms[] = $canonical;
    }
    if ($title !== '' && $title !== $name && $title !== $canonical) {
        $synonyms[] = $title;
    }
    $synonyms = array_values(array_unique(array_filter($synonyms)));

    $record = [
        'wiki_key' => avesmapsPoliticalSlug($canonical),
        'title' => mb_substr($title, 0, 255, 'UTF-8'),
        'name' => mb_substr($name, 0, 255, 'UTF-8'),
        // The join to our map: our 162 powerline rows carry real lore names (Basiliuslinie,
        // Hexenband, Yaquirlinie ...), so the match is by name, exactly as for roads.
        'match_key' => avesmapsWikiSyncCreateMatchKey($name),
        'staerke' => mb_substr($staerke, 0, 120, 'UTF-8'),
        'affinitaet' => mb_substr($affinitaet, 0, 120, 'UTF-8'),
        'laenge' => mb_substr($laenge, 0, 120, 'UTF-8'),
        'regionen' => mb_substr($regionen, 0, 500, 'UTF-8'),
        'continent' => mb_substr($continent, 0, 120, 'UTF-8'),
        'verlauf' => $verlauf,
        'description' => avesmapsWikiPathExtractDescription($wikitext, $block),
        'synonyms_json' => $synonyms,
        'source_categories_json' => $source !== '' ? [$source] : [],
        'image_url' => avesmapsWikiSyncMonitorCoatOfArmsUrl(avesmapsWikiSyncMonitorField($norm, ['bild', 'bilddatei'])),
        'wiki_url' => avesmapsWikiSyncMonitorPageUrl($canonical),
        'raw_json' => ['source' => 'wiki-powerline-sync', 'infobox' => $infoboxName],
    ];

    if (trim((string) $record['wiki_key']) === '' || trim((string) $record['name']) === '') {
        return ['is_powerline' => false, 'reason' => 'leerer Name/Key', 'record' => null];
    }

    return ['is_powerline' => true, 'reason' => '', 'record' => $record];
}
