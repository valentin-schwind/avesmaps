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
// The reconcile stamps a "last synced" timestamp into app_setting so the panel's overview rail can
// show a date for Kraftlinien. Require it explicitly rather than trust a function_exists coincidence:
// the dump endpoint loads app-setting only transitively (via adventures/citymaps), and a guard
// without a require would silently swallow the stamp -- the exact trap lore-sync.php documents.
require_once __DIR__ . '/../app/app-setting.php';
// Der Artikelschluessel-Normierer des Konfliktzentrums wird WIEDERVERWENDET, nicht nachgebaut:
// er ist rein, ohne Datenbank, und loest genau die Falle, die dort schon gestellt war --
// `Feste_Hohenstein` und `Feste%20Hohenstein` sind dieselbe Seite.
require_once __DIR__ . '/../conflicts/core.php';

/** app_setting key: when "Kraftlinien syncen" (avesmapsWikiPowerlineReconcile) last ran. */
const AVESMAPS_POWERLINE_LAST_SYNCED_SETTING = 'powerline_last_synced';

/**
 * When the powerline reconcile last ran, or null. Reads the same app_setting row the reconcile
 * writes, guarded so a context without the app-setting lib (or table) just returns null. Mirrors
 * avesmapsLoreLastSynced -- powerlines are not a task-facing dump sync_kind, so the panel's
 * "Zuletzt gesynct" rail fills the 'powerline' slot from here (avesmapsWikiDumpSyncKindLastSynced).
 */
function avesmapsWikiPowerlineLastSynced(PDO $pdo): ?string
{
    if (!function_exists('avesmapsAppSettingGet')) {
        return null;
    }
    try {
        $value = trim(avesmapsAppSettingGet($pdo, AVESMAPS_POWERLINE_LAST_SYNCED_SETTING, ''));
    } catch (Throwable) {
        return null;
    }

    return $value === '' ? null : $value;
}

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
 * REIN: Welcher Wiki-Artikel gehoert zu diesem Segment, und was ist dabei zu melden?
 *
 * Die Rangfolge (Entwurf §4):
 *   1. Zuweisung -- properties.wiki_url zeigt auf einen gestagten Artikel: DIE gilt, egal wie die
 *      Linie heisst. Nur so ist "ein Artikel, zwei Linien" ueberhaupt erreichbar
 *      (Satinavs Ketten gegen "Kette I"/"Kette II").
 *   2. Name -- avesmapsWikiSyncCreateMatchKey trifft einen gestagten Artikel (der bisherige Weg).
 *   3. nichts.
 *
 * 💣 Eine Adresse, die auf nichts zeigt, ist KEIN Fehler und KEINE Zuweisung -- sie kann ein
 * brandneuer Artikel sein, den der letzte Dump nicht kannte. Sie faellt auf Stufe 2 zurueck und
 * bleibt unangetastet stehen. Aber sie MUSS gemeldet werden: fuer das Konfliktzentrum gilt die
 * Linie als zugewiesen, sobald das Feld gefuellt ist -- ein Tippfehler nimmt sie also aus der
 * Beobachtungsliste, waehrend der Abgleich nichts holt. Sie saehe erledigt aus und waere es nicht.
 *
 * 💣 `clear_no_article` macht den Merker nur AUF, es weist nichts zu. Nach einem Namen zu raten und
 * daraus echte Daten zu machen ist die Fehlerklasse aus Discord #38.
 *
 * @param array<string, array{name:string, nest:array}> $stagedByMatchKey
 * @param array<string, array{name:string, nest:array}> $stagedByArticleKey
 * @return array{entry: ?array, source: string, claim_unresolved: bool, clear_no_article: bool}
 */
function avesmapsWikiPowerlineResolveSegment(
    string $name,
    array $properties,
    array $stagedByMatchKey,
    array $stagedByArticleKey
): array {
    $claimUnresolved = false;
    $claim = trim((string) ($properties['wiki_url'] ?? ''));
    if ($claim !== '') {
        $articleKey = avesmapsConflictArticleKey($claim);
        if ($articleKey !== '' && isset($stagedByArticleKey[$articleKey])) {
            return [
                'entry' => $stagedByArticleKey[$articleKey],
                'source' => 'claim',
                'claim_unresolved' => false,
                // Zuweisung und Merker schliessen einander aus (der Schreibweg lehnt es ab);
                // faende sich doch beides, gewinnt die Zuweisung und der Merker faellt.
                'clear_no_article' => !empty($properties['wiki_no_article']),
            ];
        }
        $claimUnresolved = true;
    }

    $matchKey = avesmapsWikiSyncCreateMatchKey($name);
    $entry = ($matchKey !== '' && isset($stagedByMatchKey[$matchKey])) ? $stagedByMatchKey[$matchKey] : null;

    return [
        'entry' => $entry,
        'source' => $entry === null ? 'none' : 'name',
        'claim_unresolved' => $claimUnresolved,
        'clear_no_article' => $entry !== null && !empty($properties['wiki_no_article']),
    ];
}

/**
 * REIN: Was ist mit diesen Segmenten zu tun? Kein PDO, kein Schreiben -- nur die Entscheidung.
 *
 * Genau der Teil von avesmapsWikiPowerlineReconcile, der bisher nur in der datenbankgebundenen
 * Schleife lebte und deshalb von keinem Test erreicht wurde -- exakt die zwei vom Aufgabenblatt
 * als 💣 markierten Stellen (Artikel- statt Linienschluessel in matched_keys; die eigene
 * Schreibbedingung fuer den reinen Merker-Fall) sassen darin ungeschuetzt. Hausform wie
 * api/_internal/conflicts/core.php: reiner Kern, duenne Datenbankschale.
 *
 * @param list<array{id:int, name:string, properties:array}> $segmentRows
 * @param array<string, array{name:string, nest:array}> $stagedByMatchKey
 * @param array<string, array{name:string, nest:array}> $stagedByArticleKey
 * @return array{
 *     writes: list<array{id:int, properties:array, action:string}>,
 *     counts: array{linked:int, updated:int, cleared:int, unchanged:int},
 *     matched_keys: array<string, bool>,
 *     claims_unresolved: int,
 *     claims_orphaned: list<array{name:string, wiki_url:string}>,
 *     no_article_reopened: string[]
 * }
 */
function avesmapsWikiPowerlineDecideSegments(array $segmentRows, array $stagedByMatchKey, array $stagedByArticleKey): array
{
    $counts = ['linked' => 0, 'updated' => 0, 'cleared' => 0, 'unchanged' => 0];
    $matchedKeys = [];
    // 💣 Die drei Meldungen zaehlen je LINIE, nicht je Segment -- alles andere ist der Fehler aus
    // Discord #71 (erste Haelfte, "zaehlte je Segment statt je Linie") an neuer Stelle. Gemessen an
    // zwei Linien mit 6 und 2 Segmenten stand hier 8 statt 2, und dieselbe Linie sechsmal in der
    // Liste. Entdoppelt ueber den Namen -- er IST die Linie (Entwurf §2.1: der Name ist das Band,
    // das die Segmente zusammenhaelt).
    //
    // ⚠️ Ein Segment OHNE Namen ist keine Linie und darf nicht mit den anderen namenlosen
    // verschmelzen (live gibt es 6 davon), deshalb tritt fuer sie die id als Schluessel ein.
    // GESCHRIEBEN wird weiter je Segment: der Merker sitzt in jedem einzelnen properties-Nest.
    $claimsUnresolvedLines = [];
    $claimsOrphanedByLine = [];
    $noArticleReopenedByLine = [];
    $writes = [];

    foreach ($segmentRows as $row) {
        $name = (string) ($row['name'] ?? '');
        $properties = is_array($row['properties'] ?? null) ? $row['properties'] : [];
        // Der Schluessel der LINIE, ueber den die drei Meldungen entdoppeln.
        $lineKey = $name !== '' ? $name : ('#' . (int) ($row['id'] ?? 0));

        // Rangfolge Zuweisung -> Name -> nichts (Aufgabe 1), statt des blossen Namensabgleichs.
        $resolved = avesmapsWikiPowerlineResolveSegment($name, $properties, $stagedByMatchKey, $stagedByArticleKey);
        $entry = $resolved['entry'];
        if ($resolved['source'] === 'name' || $resolved['source'] === 'claim') {
            // Der Schluessel ist der des GEFUNDENEN ARTIKELS, nicht der der Linie: bei einer
            // Zuweisung heisst die Linie ja gerade anders als der Artikel -- naehme man ihren
            // eigenen Namen, bliebe der Artikel als Waise in unmatched_names stehen.
            $matchedKeys[avesmapsWikiSyncCreateMatchKey((string) $entry['name'])] = true;
        }

        if ($resolved['claim_unresolved']) {
            $claimsUnresolvedLines[$lineKey] = true;
            if (isset($properties['wiki_powerline']) && !isset($claimsOrphanedByLine[$lineKey])) {
                // Die Adresse zeigt ins Leere, UND die Linie trug schon ein Nest -- der
                // zugewiesene Artikel ist verschwunden (umbenannt/geloescht im Wiki), Entwurf §4.
                $claimsOrphanedByLine[$lineKey] = [
                    'name' => $name,
                    'wiki_url' => trim((string) ($properties['wiki_url'] ?? '')),
                ];
            }
        }

        $forceWrite = false;
        if ($resolved['clear_no_article']) {
            unset($properties['wiki_no_article']);
            // Gemeldet je Linie, geschrieben je Segment: $forceWrite steht bewusst ausserhalb der
            // Entdopplung, sonst bliebe der Merker auf fuenf von sechs Segmenten stehen.
            $noArticleReopenedByLine[$lineKey] = $name;
            $forceWrite = true;
        }

        $merged = avesmapsWikiPowerlineMergeProperties(
            $properties,
            $entry === null ? null : $entry['nest']
        );
        if (!$merged['changed'] && !$forceWrite) {
            $counts['unchanged']++;
            continue;
        }
        // $merged['changed'] kann false sein, obwohl geschrieben werden muss: fiel nur der
        // wiki_no_article-Merker, blieb das Nest gleich -- ohne diese eigene Schreibbedingung
        // bliebe der Merker fuer immer stehen (Falle 2 aus dem Aufgabenblatt).
        if ($merged['changed']) {
            $counts[$merged['action']]++;
        }
        $writes[] = [
            'id' => (int) ($row['id'] ?? 0),
            'properties' => $merged['properties'],
            'action' => $merged['action'],
        ];
    }

    return [
        'writes' => $writes,
        'counts' => $counts,
        'matched_keys' => $matchedKeys,
        'claims_unresolved' => count($claimsUnresolvedLines),
        'claims_orphaned' => array_values($claimsOrphanedByLine),
        'no_article_reopened' => array_values($noArticleReopenedByLine),
    ];
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
 * @return array{linked:int, updated:int, cleared:int, unchanged:int, staged:int, matched_names:int, unmatched_names:string[], claims_unresolved:int, claims_orphaned:list<array{name:string,wiki_url:string}>, no_article_reopened:string[]}
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
    // Zweitindex ueber die Artikeladresse (avesmapsConflictArticleKey) -- die Zuweisung
    // (properties.wiki_url) sucht darueber, nicht ueber den Namen. Aus demselben $staged
    // gebaut, damit beide Register immer dieselben Artikel kennen; leere Adressen werden
    // uebersprungen (kein gemeldeter Artikel ohne URL).
    $stagedByArticleKey = [];
    foreach ($staged as $entry) {
        $url = trim((string) ($entry['nest']['wiki_url'] ?? ''));
        if ($url !== '') {
            $stagedByArticleKey[avesmapsConflictArticleKey($url)] = $entry;
        }
    }

    $segments = $pdo->query(
        "SELECT id, public_id, name, properties_json FROM map_features
          WHERE feature_type = 'powerline' AND is_active = 1"
    );
    $rows = $segments !== false ? $segments->fetchAll(PDO::FETCH_ASSOC) : [];

    // Name und dekodierte properties, dazu die id, damit der Aufrufer weiss, wohin er schreibt --
    // mehr braucht die reine Entscheidung nicht.
    $segmentRows = array_map(static function (array $row): array {
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);

        return [
            'id' => (int) ($row['id'] ?? 0),
            'name' => (string) ($row['name'] ?? ''),
            'properties' => is_array($properties) ? $properties : [],
        ];
    }, $rows);

    $decision = avesmapsWikiPowerlineDecideSegments($segmentRows, $staged, $stagedByArticleKey);
    $counts = $decision['counts'];
    $matchedKeys = $decision['matched_keys'];
    $claimsUnresolved = $decision['claims_unresolved'];
    $claimsOrphaned = $decision['claims_orphaned'];
    $noArticleReopened = $decision['no_article_reopened'];

    $update = $pdo->prepare(
        'UPDATE map_features SET properties_json = :props, revision = :revision, updated_by = :user WHERE id = :id'
    );
    foreach ($decision['writes'] as $write) {
        $update->execute([
            'props' => avesmapsEncodeJson($write['properties']),
            'revision' => avesmapsNextMapRevision($pdo),
            'user' => $userId,
            'id' => $write['id'],
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

    // The newest dump_read run of ANY status. A run that CRASHED mid-scan is never marked
    // 'error' (the status is only ever 'running' or 'completed'), so it sits stuck at 'running'
    // with the phase it died in -- and the resolver above then falls back to an older COMPLETED
    // run. Surfacing status+phase+updated_at here tells us WHERE "Dump holen" is dying, which a
    // completed-run-only view hides entirely.
    $latest = ['status' => '', 'phase' => '', 'message' => '', 'updated_at' => ''];
    try {
        $stmt = $pdo->prepare(
            "SELECT status, phase, message, updated_at
               FROM wiki_sync_runs
              WHERE sync_type = :t
              ORDER BY id DESC LIMIT 1"
        );
        $stmt->execute(['t' => AVESMAPS_WIKI_DUMP_SYNC_TYPE]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            $latest = [
                'status' => (string) ($row['status'] ?? ''),
                'phase' => (string) ($row['phase'] ?? ''),
                'message' => (string) ($row['message'] ?? ''),
                'updated_at' => (string) ($row['updated_at'] ?? ''),
            ];
        }
    } catch (Throwable) {
        // Diagnostics are best-effort -- never let them break the reconcile response.
    }

    // Stamp "last synced" so the panel's overview rail can show a date for Kraftlinien (mirrors the
    // adventure/citymap/lore reconciles). Guarded + best-effort: a missing app_setting table must not
    // break the reconcile. gmdate matches the UTC the rail's date parser expects.
    if (function_exists('avesmapsAppSettingSet')) {
        try {
            avesmapsAppSettingSet($pdo, AVESMAPS_POWERLINE_LAST_SYNCED_SETTING, gmdate('Y-m-d H:i:s'));
        } catch (Throwable) {
            // No timestamp, but the sync itself succeeded -- carry on.
        }
    }

    return $counts + [
        'staged' => count($staged),
        'matched_names' => count($matchedKeys),
        'unmatched_names' => $unmatched,
        'claims_unresolved' => $claimsUnresolved,
        'claims_orphaned' => $claimsOrphaned,
        'no_article_reopened' => $noArticleReopened,
        'sandbox_rows' => count($sandboxRows),
        'run_id' => $runId,
        'run_completed_at' => (string) ($runRow['completed_at'] ?? ''),
        'latest_run_status' => $latest['status'],
        'latest_run_phase' => $latest['phase'],
        'latest_run_message' => $latest['message'],
        'latest_run_updated_at' => $latest['updated_at'],
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
