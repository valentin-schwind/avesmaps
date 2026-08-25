<?php

declare(strict_types=1);

/**
 * PURE-logic unit test for the Hybrid WikiDump read_step DRIVER (Task H4c-b):
 * api/_internal/wiki/dump-hybrid-driver.php -- the dump_read phase state machine, the
 * two actions' shared advance engine, and the title->title alias persistence.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS (and deliberately does NOT)
 * ---------------------------------------------------------------------------
 * Per the H4c-b brief ("unit-test the phase-transition + alias-persist logic
 * with injected fake step fns -- no DB/dump, like H4a/H4b did"), this test is
 * HTTP-free and uses NO live MySQL:
 *
 *   (A) avesmapsWikiDumpHybridComputeNextState -- the PURE transition function.
 *       For each phase, given a fake step result {done, nextCursor}: a
 *       non-resumable phase always advances; a resumable phase STAYS in its phase
 *       (persisting its cursor) until done, then advances; the last work phase's
 *       done -> phase `completed` + status `completed`. Covers every phase edge.
 *   (B) alias-persist ROUND-TRIP (pure): the extractor map ->
 *       avesmapsWikiDumpHybridComputeTitleAliasRows rows -> reload shape
 *       (via a fake PDO that echoes the persisted rows back through
 *       avesmapsWikiDumpHybridLoadTitleAliases).
 *   (C) THE GATE, via avesmapsWikiDumpHybridAdvanceReadStep with a fake PDO +
 *       INJECTED fake step fns: a read_step advance (dryRun=true) that reaches
 *       the parse_and_upsert phase passes dryRun=TRUE to the phase 6 step fn
 *       (never the sharp path); an apply advance (dryRun=false) passes
 *       dryRun=FALSE. Also: a resumable phase that reports done=false stays in
 *       the same phase across advances; the completed run echoes terminally.
 *
 * The real H1/H4a/H4b step fns, the dump reader, and the DDL/upsert accessors
 * are NOT exercised here -- they are injected/faked, exactly as H4a/H4b kept
 * their DB/dump halves owner-live-verified.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring/XMLReader caveat as the sibling
 * tools/wikidump tests -- the reused derivation functions call mb_*):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-hybrid-read-driver.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 0. Preconditions.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivation functions require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the include chain needs XMLReader.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: the SAME chain test-dump-hybrid-read.php uses, plus the
//    driver under test. All side-effect-free on include.
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/bootstrap.php';
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/territories.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/regions.php';
require $repoRoot . '/api/_internal/wiki/locations.php';
require $repoRoot . '/api/_internal/wiki/settlements.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-category-layer.php';
require $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';
require $repoRoot . '/api/_internal/wiki/dump-hybrid-state.php';
require $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-hybrid-driver.php';
$includeOutput = (string) ob_get_clean();

$requiredFunctions = [
    'avesmapsWikiDumpHybridPhaseOrder',
    'avesmapsWikiDumpHybridResumableCursorKeys',
    'avesmapsWikiDumpHybridComputeNextState',
    'avesmapsWikiDumpHybridPhaseMessage',
    'avesmapsWikiDumpHybridEnsureTitleAliasTable',
    'avesmapsWikiDumpHybridComputeTitleAliasRows',
    'avesmapsWikiDumpHybridPersistTitleAliases',
    'avesmapsWikiDumpHybridLoadTitleAliases',
    'avesmapsWikiDumpHybridRedirectAliasStep',
    'avesmapsWikiDumpHybridStartRun',
    'avesmapsWikiDumpHybridFetchWantedTitles',
    'avesmapsWikiDumpHybridPublicRun',
    'avesmapsWikiDumpHybridAdvanceReadStep',
    'avesmapsWikiDumpHybridDispatchPhaseStep',
    'avesmapsWikiDumpHybridProgressEnvelope',
];
foreach ($requiredFunctions as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by dump-hybrid-driver.php.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (mirrors the sibling tools/wikidump tests).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-70s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-70s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

// ---------------------------------------------------------------------------
// 2b. A fake PDO/PDOStatement for the advance-engine + alias round-trip tests.
//     It records UpdateRun writes, serves a canned wiki_sync_runs row for the
//     FetchRunByPublicId SELECT, and echoes persisted alias rows back for the
//     alias-load SELECT. It recognises only the handful of SQL shapes the driver
//     issues -- a wiring guard.
// ---------------------------------------------------------------------------
final class FakeDriverStmt extends PDOStatement
{
    /** @var array<string,mixed> */
    public array $bound = [];

    public function __construct(
        private string $sql,
        private object $log,
        /** @var list<array<string,mixed>> */
        private array $cannedRows = []
    ) {
    }

    #[\ReturnTypeWillChange]
    public function bindValue($param, $value, $type = PDO::PARAM_STR): bool
    {
        $this->bound[(string) $param] = $value;
        return true;
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $effective = $params ?? $this->bound;
        // Record run-row UPDATEs (status/phase/progress persistence).
        if (stripos($this->sql, 'UPDATE wiki_sync_runs') !== false && stripos($this->sql, 'SET status') !== false) {
            $this->log->runUpdates[] = $effective;
            // Reflect the update into the canned run row so a re-fetch sees it.
            $this->log->runRow['status'] = $effective['status'] ?? ($this->log->runRow['status'] ?? 'running');
            $this->log->runRow['phase'] = $effective['phase'] ?? ($this->log->runRow['phase'] ?? '');
            $this->log->runRow['progress_current'] = $effective['progress_current'] ?? ($this->log->runRow['progress_current'] ?? 0);
            $this->log->runRow['stats_json'] = $effective['stats_json'] ?? ($this->log->runRow['stats_json'] ?? '[]');
        }
        // Record title-alias INSERTs and reflect them into the alias store.
        if (stripos($this->sql, 'INSERT INTO wiki_dump_title_alias') !== false) {
            $this->log->aliasRows[(string) ($effective['alias_title'] ?? '')] = [
                'alias_title' => (string) ($effective['alias_title'] ?? ''),
                'canonical_title' => (string) ($effective['canonical_title'] ?? ''),
            ];
        }
        // Record slug-keyed alias INSERTs (the reused Pass A upsert).
        if (stripos($this->sql, 'alias_slug') !== false && stripos($this->sql, 'INSERT') !== false) {
            $this->log->slugAliasWrites[] = $effective;
        }
        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        // FetchRunByPublicId does $stmt->fetch() -> the canned run row.
        return $this->log->runRow;
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        return false; // wanted-titles SELECT: none needed for the injected-fn tests
    }

    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args): array
    {
        // Alias-load SELECT -> the persisted alias rows.
        if (stripos($this->sql, 'FROM wiki_dump_title_alias') !== false) {
            return array_values($this->log->aliasRows);
        }
        return $this->cannedRows;
    }
}

final class FakeDriverPdo extends PDO
{
    /** @var array<string,mixed> the canned wiki_sync_runs row (mutated by UPDATEs) */
    public array $runRow;
    /** @var list<array<string,mixed>> recorded run-row UPDATE param sets */
    public array $runUpdates = [];
    /** @var array<string,array<string,mixed>> persisted alias rows, keyed by alias_title */
    public array $aliasRows = [];
    /** @var list<array<string,mixed>> recorded slug-keyed alias INSERT param sets */
    public array $slugAliasWrites = [];
    /** @var list<string> */
    public array $execs = [];

    public function __construct(array $runRow)
    {
        $this->runRow = $runRow;
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        $this->execs[] = (string) $statement;
        return 0;
    }

    #[\ReturnTypeWillChange]
    public function query($query, $fetchMode = null, ...$fetchModeArgs)
    {
        $this->execs[] = (string) $query;
        return new FakeDriverStmt((string) $query, $this, []);
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new FakeDriverStmt((string) $query, $this, []);
    }
}

/** Build a canned dump_read run row at a given phase/stats. */
$makeRunRow = static function (string $phase, array $stats = [], string $status = 'running'): array {
    return [
        'id' => 7,
        'public_id' => '11111111-1111-4111-8111-111111111111',
        'sync_type' => 'dump_read',
        'status' => $status,
        'phase' => $phase,
        'progress_current' => 0,
        'progress_total' => 8,
        'message' => '',
        'stats_json' => json_encode($stats),
        'created_at' => '2026-07-02 00:00:00.000',
        'updated_at' => '2026-07-02 00:00:00.000',
        'completed_at' => null,
    ];
};

echo "================================================================\n";
echo " dump-hybrid-driver PURE-logic test (Hybrid WikiDump migration, H4c-b)\n";
echo "================================================================\n";

$check('(0) include produced no output', '', $includeOutput, 'the driver is side-effect-free on include (defs only, no DB connect)');

// ===========================================================================
// (A) PURE phase-transition function.
// ===========================================================================
echo "\n-- (A) avesmapsWikiDumpHybridComputeNextState (the pure state machine) --\n";

$order = avesmapsWikiDumpHybridPhaseOrder();
$check(
    '(A0) phase order runs online_continent_map AFTER wikitext_collect (CONTINENT-FIX #1); publication_sources + adventures + citymaps right after redirect_aliases (Task 4 / Abenteuer P4 / Kartensammlung 1+2)',
    ['online_class_map', 'online_building_map', 'wikitext_collect', 'redirect_aliases', 'publication_sources', 'adventures', 'citymaps', 'lore', 'organisations', 'online_continent_map', 'parse_and_upsert'],
    $order,
    'the continent map sources its titles from the fully-populated state table (via FetchWantedTitles), so it MUST run after the whole-dump wikitext_collect scan enumerated all kinds -- otherwise it only covers the H1 settlement/building rows'
);

// 🔴 Seit 24.08.2026 sind auch die zwei Online-Kategorie-Phasen fortsetzbar: bei 20 s
// Drossel (Crawl-delay der Wiki-robots.txt) brauchten sie ~250 s bzw. ~500 s in EINEM
// Schritt und starben am Gateway (HTTP 502). Sie verhalten sich jetzt wie jede andere
// fortsetzbare Phase: bleiben stehen, solange ihr Schritt nicht done meldet.
$s1a = avesmapsWikiDumpHybridComputeNextState('online_class_map', ['class_cursor' => 0], ['done' => false, 'nextCursor' => 2]);
$check(
    '(A1a) online_class_map NICHT fertig -> bleibt stehen und merkt sich die Kategorie',
    ['online_class_map', false, 2, false],
    [$s1a['phase'], $s1a['phase_advanced'], $s1a['stats']['class_cursor'], $s1a['done']],
    'ohne diese Zeile faellt die Phase nach EINEM Schritt weiter und laesst vier Kategorien ungelesen'
);
$s1 = avesmapsWikiDumpHybridComputeNextState('online_class_map', ['class_cursor' => 4], ['done' => true, 'nextCursor' => 5]);
$check(
    '(A1) online_class_map fertig -> online_building_map',
    ['online_building_map', 'running', 1, false],
    [$s1['phase'], $s1['status'], $s1['progress_current'], $s1['done']],
    'erst wenn der Schritt done meldet, geht es weiter -- und die Fortschrittsanzeige rueckt auf Index 1'
);
$s2a = avesmapsWikiDumpHybridComputeNextState('online_building_map', ['building_cursor' => 0], ['done' => false, 'nextCursor' => 1]);
$check(
    '(A2a) online_building_map NICHT fertig -> bleibt stehen und merkt sich die Bauwerksart',
    ['online_building_map', false, 1],
    [$s2a['phase'], $s2a['phase_advanced'], $s2a['stats']['building_cursor']],
    'rund 25 Abfragen a 20 s -- die Phase, die am 24.08.2026 am laengsten war'
);
$s2 = avesmapsWikiDumpHybridComputeNextState('online_building_map', ['building_cursor' => 24], ['done' => true, 'nextCursor' => 25]);
$check(
    '(A2) online_building_map fertig -> wikitext_collect (CONTINENT-FIX: the scan now runs before the continent map)',
    ['wikitext_collect', 2],
    [$s2['phase'], $s2['progress_current']],
    'second phase advances into the whole-dump wikitext_collect scan (which enumerates all 5 kinds and populates the state table the continent map later reads)'
);

// wikitext_collect (resumable): NOT done -> stay put, persist the wikitext cursor.
$s3a = avesmapsWikiDumpHybridComputeNextState('wikitext_collect', ['wikitext_cursor' => 0], ['done' => false, 'nextCursor' => 5000]);
$check(
    '(A3) wikitext_collect NOT done -> stays in phase, persists nextCursor',
    ['wikitext_collect', false, 5000, false],
    [$s3a['phase'], $s3a['phase_advanced'], $s3a['stats']['wikitext_cursor'], $s3a['done']],
    'the whole-dump scan stays put across advances, advancing only its own page cursor until its done flips'
);
// wikitext_collect done -> advance to redirect_aliases, cursor still persisted.
$s3b = avesmapsWikiDumpHybridComputeNextState('wikitext_collect', ['wikitext_cursor' => 5000], ['done' => true, 'nextCursor' => 223583]);
$check(
    '(A4) wikitext_collect done -> advances to redirect_aliases, final cursor persisted',
    ['redirect_aliases', true, 223583, 3],
    [$s3b['phase'], $s3b['phase_advanced'], $s3b['stats']['wikitext_cursor'], $s3b['progress_current']],
    'once the scan reports done (stream exhausted), the phase name advances and the wikitext cursor is retained'
);

// redirect_aliases uses the dump_cursor key.
$s4 = avesmapsWikiDumpHybridComputeNextState('redirect_aliases', ['dump_cursor' => 100], ['done' => false, 'nextCursor' => 2100]);
$check(
    '(A5) redirect_aliases persists its cursor under stats["dump_cursor"] (the Pass-A field name)',
    ['redirect_aliases', 2100],
    [$s4['phase'], $s4['stats']['dump_cursor']],
    'the redirect phase reuses the existing dump_cursor stats field'
);

// redirect_aliases done -> publication_sources (Task 4: the new phase runs right after aliases).
$s4b = avesmapsWikiDumpHybridComputeNextState('redirect_aliases', ['dump_cursor' => 2100], ['done' => true, 'nextCursor' => 223583]);
$check(
    '(A5b) redirect_aliases done -> publication_sources (index 4)',
    ['publication_sources', true, 4, false],
    [$s4b['phase'], $s4b['phase_advanced'], $s4b['progress_current'], $s4b['done']],
    'the wiki-publication-sources phase runs after the alias map is built (it resolves publication link titles via wiki_redirect_alias)'
);
// publication_sources (resumable): NOT done -> stay put, persist publication_cursor.
$s4c = avesmapsWikiDumpHybridComputeNextState('publication_sources', ['publication_cursor' => 0], ['done' => false, 'nextCursor' => 2000]);
$check(
    '(A5c) publication_sources NOT done -> stays in phase, persists publication_cursor',
    ['publication_sources', false, 2000, false],
    [$s4c['phase'], $s4c['phase_advanced'], $s4c['stats']['publication_cursor'], $s4c['done']],
    'the catalog/refs/reconcile sub-stages loop within the one phase on the publication_cursor until the step reports done'
);
// publication_sources done -> adventures (index 5); parse_and_upsert stays terminal.
$s4d = avesmapsWikiDumpHybridComputeNextState('publication_sources', ['publication_cursor' => 2000], ['done' => true, 'nextCursor' => 4000]);
$check(
    '(A5d) publication_sources done -> adventures (the sibling {{Infobox Produkt}} staging phase)',
    ['adventures', true, 5],
    [$s4d['phase'], $s4d['phase_advanced'], $s4d['progress_current']],
    'once the publication phase completes it hands off to the adventure staging phase (same infobox scan, different payload)'
);
// adventures (resumable): NOT done -> stay put, persist adventure_cursor.
$s4e = avesmapsWikiDumpHybridComputeNextState('adventures', ['adventure_cursor' => 0], ['done' => false, 'nextCursor' => 3000]);
$check(
    '(A5e) adventures NOT done -> stays in phase, persists adventure_cursor',
    ['adventures', false, 3000, false],
    [$s4e['phase'], $s4e['phase_advanced'], $s4e['stats']['adventure_cursor'], $s4e['done']],
    'the adventure catalog/place staging build loops on its own dump page cursor until the step reports done'
);
// adventures done -> citymaps (index 6); parse_and_upsert stays terminal.
$s4f = avesmapsWikiDumpHybridComputeNextState('adventures', ['adventure_cursor' => 3000], ['done' => true, 'nextCursor' => 6000]);
$check(
    '(A5f) adventures done -> citymaps (the sibling staging phase; parse_and_upsert stays the terminal sharp phase)',
    ['citymaps', true, 6],
    [$s4f['phase'], $s4f['phase_advanced'], $s4f['progress_current']],
    'the adventure staging phase hands off to the citymap staging phase; parse_and_upsert remains the LAST phase'
);
// citymaps (resumable): NOT done -> stay put, persist citymap_cursor.
$s4g = avesmapsWikiDumpHybridComputeNextState('citymaps', ['citymap_cursor' => 0], ['done' => false, 'nextCursor' => 3500]);
$check(
    '(A5g) citymaps NOT done -> stays in phase, persists citymap_cursor',
    ['citymaps', false, 3500, false],
    [$s4g['phase'], $s4g['phase_advanced'], $s4g['stats']['citymap_cursor'], $s4g['done']],
    'the citymap catalog build loops on its own dump page cursor until the step reports done -- it is scanning the whole dump for two index PAGES'
);
// citymaps done -> lore (index 7); parse_and_upsert stays terminal.
$s4h = avesmapsWikiDumpHybridComputeNextState('citymaps', ['citymap_cursor' => 3500], ['done' => true, 'nextCursor' => 6500]);
$check(
    '(A5h) citymaps done -> lore (Natur & Waren staging; parse_and_upsert stays the terminal sharp phase)',
    ['lore', true, 7],
    [$s4h['phase'], $s4h['phase_advanced'], $s4h['progress_current']],
    'the citymap staging phase hands off to the lore staging phase; parse_and_upsert remains the LAST phase'
);

// lore (resumable): NOT done -> stay put, persist lore_cursor.
$s4i = avesmapsWikiDumpHybridComputeNextState('lore', ['lore_cursor' => 0], ['done' => false, 'nextCursor' => 4200]);
$check(
    '(A5i) lore NOT done -> stays in phase, persists lore_cursor',
    ['lore', false, 4200, false],
    [$s4i['phase'], $s4i['phase_advanced'], $s4i['stats']['lore_cursor'], $s4i['done']],
    'the Natur-&-Waren lore staging build loops on its own dump page cursor until the step reports done'
);
// lore done -> online_continent_map (index 8); parse_and_upsert stays terminal.
$s4j = avesmapsWikiDumpHybridComputeNextState('lore', ['lore_cursor' => 4200], ['done' => true, 'nextCursor' => 6800]);
$check(
    '(A5j) lore done -> organisations (Handelshaeuser-Sitze), dann erst die Kontinent-Map',
    ['organisations', true, 8],
    [$s4j['phase'], $s4j['phase_advanced'], $s4j['progress_current']],
    'die lore-Phase reicht an die Handelshaeuser-Sitze weiter (Discord-Handelslisten, 16.08.2026)'
);
// Handelshaeuser-Sitze: resumable auf organisation_cursor, danach die Kontinent-Map.
$sOrgA = avesmapsWikiDumpHybridComputeNextState('organisations', ['organisation_cursor' => 0], ['done' => false, 'nextCursor' => 400]);
$check(
    '(A5k) organisations NICHT fertig -> bleibt in der Phase, merkt sich organisation_cursor',
    ['organisations', false, 400],
    [$sOrgA['phase'], $sOrgA['phase_advanced'], $sOrgA['stats']['organisation_cursor']],
    'derselbe Dump-Seitenzeiger-Vertrag wie adventures/citymaps/lore'
);
$sOrgB = avesmapsWikiDumpHybridComputeNextState('organisations', ['organisation_cursor' => 400], ['done' => true, 'nextCursor' => 9000]);
$check(
    '(A5l) organisations fertig -> online_continent_map',
    ['online_continent_map', true, 9],
    [$sOrgB['phase'], $sOrgB['phase_advanced'], $sOrgB['progress_current']],
    'die Sitze sind STAGING ONLY und reichen an die Kontinent-Map weiter'
);

// online_continent_map now runs AFTER the scan; resumable on continent_cursor; done -> parse_and_upsert.
$s5a = avesmapsWikiDumpHybridComputeNextState('online_continent_map', ['continent_cursor' => 0], ['done' => false, 'nextCursor' => 500]);
$check(
    '(A6a) online_continent_map NOT done -> stays in phase, persists continent_cursor (now over the FULL enumerated title set)',
    ['online_continent_map', false, 500, false],
    [$s5a['phase'], $s5a['phase_advanced'], $s5a['stats']['continent_cursor'], $s5a['done']],
    'after the reorder the continent map walks the full ~7000-title set from FetchWantedTitles; it takes more steps but still resumes on its own continent_cursor until done'
);
$s5b = avesmapsWikiDumpHybridComputeNextState('online_continent_map', ['continent_cursor' => 500], ['done' => true, 'nextCursor' => 9000]);
$check(
    '(A6b) online_continent_map done -> parse_and_upsert, continent_cursor persisted, progress index 10',
    ['parse_and_upsert', true, 9000, 10],
    [$s5b['phase'], $s5b['phase_advanced'], $s5b['stats']['continent_cursor'], $s5b['progress_current']],
    'the continent map (now the LAST dump/online-walking phase before parse) hands off to the parse phase once its cursor drains the full title set'
);

// parse_and_upsert NOT done -> stay put (parse_cursor advances).
$s6a = avesmapsWikiDumpHybridComputeNextState('parse_and_upsert', ['parse_cursor' => 0], ['done' => false, 'nextCursor' => 2000]);
$check(
    '(A7) parse_and_upsert NOT done -> stays in phase, parse_cursor advances',
    ['parse_and_upsert', false, 2000],
    [$s6a['phase'], $s6a['phase_advanced'], $s6a['stats']['parse_cursor']],
    'the parse phase loops on its id high-water-mark cursor until drained'
);
// parse_and_upsert done -> completed + status completed (THE terminal transition).
$s6b = avesmapsWikiDumpHybridComputeNextState('parse_and_upsert', ['parse_cursor' => 2000], ['done' => true, 'nextCursor' => 2345]);
$check(
    '(A8) parse_and_upsert done -> phase "completed" + status "completed" + full progress',
    ['completed', 'completed', 11, 11, true],
    [$s6b['phase'], $s6b['status'], $s6b['progress_current'], $s6b['progress_total'], $s6b['done']],
    'advancing off the last work phase completes the whole run (progress_current == progress_total)'
);

// A resumable phase falling back to result['cursor'] when nextCursor is absent.
$s7 = avesmapsWikiDumpHybridComputeNextState('online_continent_map', ['continent_cursor' => 10], ['done' => false, 'cursor' => 42]);
$check(
    '(A9) resumable cursor falls back to result["cursor"] when nextCursor absent',
    42,
    $s7['stats']['continent_cursor'],
    'tolerates both the {nextCursor} shape (continent/collect steps) and a {cursor} shape'
);

// ===========================================================================
// (B) alias-persist ROUND-TRIP (pure rows + fake-PDO reload).
// ===========================================================================
echo "\n-- (B) title->title alias persistence round-trip --\n";

$aliasMap = [
    'Altes Ferdok' => 'Ferdok',
    'Koenigreich Kosch' => 'Kosch',
    '' => 'ShouldSkip',        // empty alias side -> dropped
    'DanglingAlias' => '',     // empty canonical side -> dropped
];
$aliasRows = avesmapsWikiDumpHybridComputeTitleAliasRows($aliasMap);
$check(
    '(B1) ComputeTitleAliasRows drops empty-sided pairs, keeps the real ones',
    [
        ['alias_title' => 'Altes Ferdok', 'canonical_title' => 'Ferdok'],
        ['alias_title' => 'Koenigreich Kosch', 'canonical_title' => 'Kosch'],
    ],
    $aliasRows,
    'a redirect page title -> canonical title row per valid pair; degenerate empties contribute nothing'
);

// Persist through a fake PDO, then reload -> the map round-trips.
$aliasPdo = new FakeDriverPdo($makeRunRow('redirect_aliases'));
$written = avesmapsWikiDumpHybridPersistTitleAliases($aliasPdo, 7, $aliasMap);
$check(
    '(B2) PersistTitleAliases writes exactly the non-empty rows',
    2,
    $written,
    'both valid alias rows are upserted (the two empty-sided pairs are skipped)'
);
$reloaded = avesmapsWikiDumpHybridLoadTitleAliases($aliasPdo, 7);
$check(
    '(B3) LoadTitleAliases reloads the SAME map shape H4b consumes as $titleAliasMap',
    ['Altes Ferdok' => 'Ferdok', 'Koenigreich Kosch' => 'Kosch'],
    $reloaded,
    'the persisted rows reload into normalized-alias => normalized-canonical, ready for wikitext_collect'
);

// ===========================================================================
// (B2) redirect_aliases STEP: the resumable page-walk building BOTH maps.
// ===========================================================================
echo "\n-- (B2) avesmapsWikiDumpHybridRedirectAliasStep (page-walk, fake source) --\n";

// Fake dump window: 4 pages, two of them <redirect> pages. The extractor + the
// slug upsert must both fire for the redirect pages ONLY.
$redirectFixturePages = [
    ['title' => 'Ferdok', 'ns' => 0, 'redirect' => null, 'wikitext' => 'body'],
    ['title' => 'Altes Ferdok', 'ns' => 0, 'redirect' => 'Ferdok', 'wikitext' => ''],
    ['title' => 'Irrelevant', 'ns' => 0, 'redirect' => null, 'wikitext' => 'body'],
    ['title' => 'Kosch (historisch)', 'ns' => 0, 'redirect' => 'Kosch', 'wikitext' => ''],
];
$redirectSource = static function (string $path, int $skip) use ($redirectFixturePages): iterable {
    $i = 0;
    foreach ($redirectFixturePages as $page) {
        if ($i++ < $skip) {
            continue;
        }
        yield $page;
    }
};

$redirectPdo = new FakeDriverPdo($makeRunRow('redirect_aliases'));
$redirectStep = avesmapsWikiDumpHybridRedirectAliasStep($redirectPdo, '/unused/dump.xml', 7, 0, $redirectSource);

$check(
    '(B2a) the step scans the whole window and reports done (stream exhausted)',
    ['done' => true, 'pages_scanned' => 4],
    ['done' => $redirectStep['done'], 'pages_scanned' => $redirectStep['pages_scanned']],
    'a window smaller than the page budget that runs to the end reports the phase done'
);
$check(
    '(B2b) title->title aliases persisted for BOTH redirect pages (not the plain pages)',
    2,
    $redirectStep['title_aliases_written'],
    'only the two <redirect> pages become title->title rows; plain articles contribute nothing'
);
$check(
    '(B2c) the persisted title-alias map has the expected canonical targets',
    ['Altes Ferdok' => 'Ferdok', 'Kosch (historisch)' => 'Kosch'],
    avesmapsWikiDumpHybridLoadTitleAliases($redirectPdo, 7),
    'each redirect page title maps to its normalized canonical target -- exactly what wikitext_collect consumes'
);
$check(
    '(B2d) the slug-keyed Pass A alias upsert ALSO fired for each redirect (verbatim reuse)',
    2,
    count($redirectPdo->slugAliasWrites),
    'the existing wiki_redirect_alias output is preserved: one alias_slug->wiki_key upsert per redirect page'
);
$check(
    '(B2e) nextCursor = cursor + pages_scanned (resume contract, like Pass A)',
    4,
    $redirectStep['nextCursor'],
    'the next redirect step resumes past exactly the pages this step consumed'
);

// A partial window (budget/deadline not reached but the source ends) still done;
// a fresh cursor is honoured (skip).
$redirectPdo2 = new FakeDriverPdo($makeRunRow('redirect_aliases', ['dump_cursor' => 2]));
$redirectStep2 = avesmapsWikiDumpHybridRedirectAliasStep($redirectPdo2, '/unused/dump.xml', 7, 2, $redirectSource);
$check(
    '(B2f) a non-zero cursor skips already-seen pages (only the tail is scanned)',
    ['pages_scanned' => 2, 'title_aliases_written' => 1, 'nextCursor' => 4],
    ['pages_scanned' => $redirectStep2['pages_scanned'], 'title_aliases_written' => $redirectStep2['title_aliases_written'], 'nextCursor' => $redirectStep2['nextCursor']],
    'skipping the first 2 pages leaves only "Irrelevant" + "Kosch (historisch)" -> one redirect found'
);

// ===========================================================================
// (C) THE GATE via the advance engine + injected fake step fns.
// ===========================================================================
echo "\n-- (C) avesmapsWikiDumpHybridAdvanceReadStep + THE GATE (dryRun) --\n";

/**
 * Build an injected step-fn set that records the dryRun the parse_and_upsert
 * phase is called with, and reports the phase as done so the transition advances.
 */
$captured = new stdClass();
$captured->parseDryRun = null;
$captured->parseCalled = false;
$makeStepFns = static function () use ($captured): array {
    return [
        'parse_and_upsert' => static function (PDO $pdo, array $ctx) use ($captured): array {
            $captured->parseCalled = true;
            $captured->parseDryRun = (bool) ($ctx['dryRun'] ?? null);
            return ['done' => true, 'nextCursor' => 123, 'processed_this_step' => 5, 'kept' => 3, 'dry_run' => (bool) ($ctx['dryRun'] ?? null)];
        },
    ];
};

// read_step (dryRun=true) reaching phase 6 -> the phase-6 fn gets dryRun=TRUE.
$captured->parseDryRun = null;
$captured->parseCalled = false;
$readPdo = new FakeDriverPdo($makeRunRow('parse_and_upsert', ['parse_cursor' => 0]));
$readAdvance = avesmapsWikiDumpHybridAdvanceReadStep($readPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', true, $makeStepFns());
$check(
    '(C1) read_step passes dryRun=TRUE to the parse_and_upsert phase (SANDBOX, no sharp write)',
    [true, true],
    [$captured->parseCalled, $captured->parseDryRun],
    'the read_step advance is structurally incapable of a sharp write: phase 6 always runs dryRun=true'
);
$check(
    '(C2) read_step advance returns the {phase,cursor,done,progress} envelope',
    ['completed', true, true],
    [
        $readAdvance['phase'],
        $readAdvance['done'],
        is_array($readAdvance['progress']) && ($readAdvance['progress']['dry_run'] ?? null) === true,
    ],
    'phase 6 done -> the run completes; progress echoes the dry_run flag from the step'
);

// apply (dryRun=false) reaching phase 6 -> the phase-6 fn gets dryRun=FALSE.
$captured->parseDryRun = null;
$captured->parseCalled = false;
$applyPdo = new FakeDriverPdo($makeRunRow('parse_and_upsert', ['parse_cursor' => 0]));
$applyAdvance = avesmapsWikiDumpHybridAdvanceReadStep($applyPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', false, $makeStepFns());
$check(
    '(C3) apply passes dryRun=FALSE to the parse_and_upsert phase (THE sharp path)',
    [true, false],
    [$captured->parseCalled, $captured->parseDryRun],
    'the SEPARATE apply action is the ONLY path that runs phase 6 with dryRun=false (the real *_staging write)'
);

// A resumable phase reporting done=false stays in the SAME phase across an advance.
$stayPdo = new FakeDriverPdo($makeRunRow('online_continent_map', ['continent_cursor' => 0]));
$staySteps = [
    'online_continent_map' => static function (PDO $pdo, array $ctx): array {
        return ['done' => false, 'nextCursor' => 400, 'written' => 400];
    },
];
$stayAdvance = avesmapsWikiDumpHybridAdvanceReadStep($stayPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', true, $staySteps);
$check(
    '(C4) a resumable phase with done=false stays in the same phase (cursor persisted)',
    ['online_continent_map', false, 400],
    [$stayAdvance['phase'], $stayAdvance['done'], $stayAdvance['cursor']],
    'the run does not advance the phase name until the resumable step reports done -- one bounded step per request'
);
// And the persisted run UPDATE recorded the same still-in-flight phase + cursor.
$lastUpdate = end($stayPdo->runUpdates) ?: [];
$persistedStats = json_decode((string) ($lastUpdate['stats_json'] ?? '{}'), true) ?: [];
$check(
    '(C5) the run-row UPDATE persisted phase=online_continent_map + continent_cursor=400',
    ['online_continent_map', 'running', 400],
    [(string) ($lastUpdate['phase'] ?? ''), (string) ($lastUpdate['status'] ?? ''), (int) ($persistedStats['continent_cursor'] ?? -1)],
    'avesmapsWikiSyncUpdateRun is called with the pure transition exact next state'
);

// Meldet der Schritt done, rueckt die Phase weiter -- auch die fortsetzbare.
$classPdo = new FakeDriverPdo($makeRunRow('online_class_map', []));
$classSteps = [
    'online_class_map' => static function (PDO $pdo, array $ctx): array {
        return ['done' => true, 'nextCursor' => 5, 'written' => 1234, 'title_count' => 1234];
    },
];
$classAdvance = avesmapsWikiDumpHybridAdvanceReadStep($classPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', true, $classSteps);
$check(
    '(C6) eine fertig gemeldete Kategorie-Phase gibt an die naechste ab (class -> building)',
    ['online_building_map', false],
    [$classAdvance['phase'], $classAdvance['done']],
    'online_class_map meldet done und uebergibt an online_building_map'
);

// A completed run echoes terminally without dispatching any step.
$doneCaptured = false;
$donePdo = new FakeDriverPdo($makeRunRow('completed', ['parse_cursor' => 9], 'completed'));
$doneSteps = [
    'parse_and_upsert' => static function () use (&$doneCaptured): array { $doneCaptured = true; return ['done' => true]; },
];
$doneAdvance = avesmapsWikiDumpHybridAdvanceReadStep($donePdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', false, $doneSteps);
$check(
    '(C7) a completed run echoes terminally and dispatches NO step',
    ['completed', true, false],
    [$doneAdvance['phase'], $doneAdvance['done'], $doneCaptured],
    'an already-completed run is idempotent -- no phase fn runs, so a stray apply on a done run writes nothing'
);

// ===========================================================================
// (C-continent) PERF FIX: the real online_continent_map dispatch case is
// bounded by an explicit per-step call budget, not the unbounded
// "process everything in one call" default (callBudget=null).
// ---------------------------------------------------------------------------
// Before this fix, avesmapsWikiDumpHybridDispatchPhaseStep()'s real (non-faked)
// online_continent_map case called avesmapsWikiDumpHybridFillContinentMapStep()
// with NO $callBudget, so a single step walked the ENTIRE title list -- for the
// real ~9k-title/~450-batch set, roughly 4.5 minutes of throttled HTTP with no
// lock heartbeat (dump-lock.php). avesmapsWikiDumpCategoryFetchContinentMap()
// (dump-category-layer.php:429) already implements a full resumable
// cursor/callBudget/done contract; the bug was that the driver never drove it
// with a bound. These checks are HTTP/DB-free (same "no live MySQL" contract
// as the rest of this file): (c-continent-1) is a STRUCTURAL check (mirrors
// test-dump-hybrid-state.php's own source-inspection pattern) proving the real
// dispatch case now passes avesmapsWikiDumpOnlineStepCallBudget(),
// not null; (c-continent-2..4) prove BEHAVIORALLY, via a fake batch fetcher (no
// PDO/HTTP) and a ~350-title list sized like the bug report's real scenario,
// that this budget forces MULTIPLE bounded steps -- never one call that
// attempts all ~350 titles -- and that the phase still resumes via its cursor
// to completion (done=true) across those steps.
// ===========================================================================
echo "\n-- (C-continent) online_continent_map dispatch is call-budget-bounded (PERF FIX) --\n";

$hybridDriverSource = str_replace(chr(13), '', (string) file_get_contents($repoRoot . '/api/_internal/wiki/dump-hybrid-driver.php'));
$dispatchSource = '';
if (preg_match(
    '/function avesmapsWikiDumpHybridDispatchPhaseStep\([^)]*\)[^{]*\{(.*)\n\}\n/s',
    $hybridDriverSource,
    $m
) === 1) {
    $dispatchSource = $m[1];
}
$check(
    '(c-continent-1) the real dispatch case passes the named call-budget constant, not null',
    true,
    str_contains(
        $dispatchSource,
        'avesmapsWikiDumpHybridFillContinentMapStep($pdo, $runId, $titles, $cursor, avesmapsWikiDumpOnlineStepCallBudget())'
    ),
    'structural check: the perf bug was $callBudget defaulting to null (unbounded) -- this proves the fix is a real explicit bound, not just a docblock claim'
);
// 💣 DIE ZUSICHERUNG, DIE AM 24.08.2026 GEFEHLT HAT: das Budget muss ins SCHRITT-FENSTER passen.
// Mit der Drossel auf 2 s haetten die alten 20 Aufrufe ueber 50 Sekunden gebraucht -- doppelt so
// lang wie AVESMAPS_WIKI_DUMP_STEP_SECONDS erlaubt. Eine Obergrenze von 40 haette das durchgewinkt.
$sekundenJeAufruf = (AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS + 125000) / 1000000 + AVESMAPS_WIKI_DUMP_ONLINE_ASSUMED_RESPONSE_SECONDS;
$check(
    '(c-continent-2a) ein voll ausgeschoepfter Schritt bleibt im Zeitfenster',
    true,
    avesmapsWikiDumpOnlineStepCallBudget() * $sekundenJeAufruf < AVESMAPS_WIKI_DUMP_STEP_SECONDS,
    'Budget x Dauer je Aufruf muss unter AVESMAPS_WIKI_DUMP_STEP_SECONDS bleiben -- sonst verhungert der Schritt und nimmt den Sperr-Heartbeat mit'
);
$check(
    '(c-continent-2) the call-budget constant is a small bounded number, not null/unbounded',
    true,
    is_int(avesmapsWikiDumpOnlineStepCallBudget()) && avesmapsWikiDumpOnlineStepCallBudget() > 0 && avesmapsWikiDumpOnlineStepCallBudget() <= 40,
    'sanity bound: at ~0.6-0.85s/throttled call (sync.php AVESMAPS_WIKI_REQUEST_DELAY_MICROSECONDS), a step must stay well under the 28s AVESMAPS_WIKI_DUMP_STEP_SECONDS ceiling'
);

// Behavioral proof at H1's own (already fully mockable) layer, using the SAME
// constant + a title count on the order of the bug report's "~350-450 batches"
// scenario (350 batches x 20 titles/batch = 7000 titles) to show the bound
// forces a multi-step resume rather than a single unbounded call.
// 🪤 GEPINNT, NICHT GEERBT (25.08.2026). Hier stand avesmapsWikiSyncTitleBatchSize() -- und die
// liefert 50 OHNE und 500 MIT Bot-Anmeldung. Lokal und im CI (keine Konfiguration, also anonym)
// stimmten die erwarteten 140 Stapel; auf dem SERVER mit stehender Anmeldung waren es 14, und
// die Zusicherung fiel um. Der Test hing an der Umgebung, nicht am Code. Ausserdem loest der
// Aufruf die Anmeldung aus -- ein Unittest, der sich beim Wiki anmeldet, ist keiner mehr.
$stapelFuerTest = 50;
$manyTitles = array_map(static fn(int $i): string => "Titel {$i}", range(1, 7000));
$erwarteteStapel = (int) ceil(count($manyTitles) / $stapelFuerTest);
$callsMadeTotal = 0;
$countingBatchFetcher = static function (array $batchTitles) use (&$callsMadeTotal): array {
    $callsMadeTotal++;
    $pages = [];
    foreach ($batchTitles as $title) {
        $pages[$title] = ['title' => $title, 'categories' => [['title' => 'Kategorie:Aventurien']]];
    }
    return $pages;
};

$continentCursor = 0;
$continentSteps = 0;
$continentDone = false;
// Die Obergrenze DIESER Schleife folgt dem Budget, statt eine Zahl festzuschreiben: seit die
// Drossel auf den Crawl-delay 20 der Wiki-robots.txt steht, traegt ein Schritt nur noch EINEN
// Aufruf, und die alte feste 50 liess den Test scheitern, obwohl die Produktion voellig in
// Ordnung war. Der Test soll den unbegrenzten Schritt fangen, nicht die Schrittgroesse.
$maxStepsGuard = (int) ceil($erwarteteStapel / avesmapsWikiDumpOnlineStepCallBudget()) + 5;
while (!$continentDone && $continentSteps < $maxStepsGuard) {
    $stepResult = avesmapsWikiDumpCategoryFetchContinentMap(
        $manyTitles,
        $continentCursor,
        avesmapsWikiDumpOnlineStepCallBudget(),
        $countingBatchFetcher,
        $stapelFuerTest
    );
    $continentCursor = (int) $stepResult['nextCursor'];
    $continentDone = (bool) $stepResult['done'];
    $continentSteps++;

    // The core regression check: NO SINGLE STEP may exceed the configured
    // call budget -- this is exactly what "attempts all ~350 in one call" would
    // violate (one step making ~350 calls instead of at most
    // avesmapsWikiDumpOnlineStepCallBudget()).
    $callsThisStepMax = avesmapsWikiDumpOnlineStepCallBudget();
    if ($callsMadeTotal > $continentSteps * $callsThisStepMax) {
        break; // fail fast; the assertion below will report the violation
    }
}

$check(
    '(c-continent-3) a 7000-title list (350 batches) resumes across MULTIPLE steps, never all-in-one-call',
    true,
    $continentSteps > 1 && $continentDone,
    "took {$continentSteps} bounded steps (budget=" . avesmapsWikiDumpOnlineStepCallBudget() . " calls/step) to finish {$erwarteteStapel} batches -- the pre-fix code (callBudget=null) would have done this in exactly 1 step / 1 call to this fetcher"
);
$check(
    '(c-continent-4) every step stayed within its call budget (no step attempted all batches at once)',
    true,
    $callsMadeTotal <= $continentSteps * avesmapsWikiDumpOnlineStepCallBudget() && $callsMadeTotal === $erwarteteStapel,
    "{$callsMadeTotal} total fetcher calls across {$continentSteps} steps for {$erwarteteStapel} batches -- confirms the budget bounds EVERY step, not just the first"
);


// ===========================================================================
// (C-online) DIE ZWEI KATEGORIE-PHASEN FAHREN AM SELBEN GERECHNETEN BUDGET
// ---------------------------------------------------------------------------
// Am 24.08.2026 brach "Dump holen" mit HTTP 502 ab: das Wiki gibt AvesmapsWikiSync in
// seiner robots.txt einen Crawl-delay von 20 Sekunden, und zwei der Phasen erledigten
// ihre Kategorie-Abfragen in EINEM Schritt (~12 bzw. ~25 Abfragen, also ~250 s / ~500 s).
// Der 502 kommt vom Webserver, nicht aus PHP -- deshalb schwieg auch der Abbruch-Melder.
//
// 💣 DIE ZAHL DARF NICHT FESTSTEHEN. Genau daran ist es zerbrochen: das alte Budget war
// eine 20 im Quelltext, und als die Drossel von 0,6 s auf 20 s ging, waren daraus ueber
// 400 Sekunden je Schritt geworden, ohne dass sich eine Zeile Code geaendert haette.
// ===========================================================================
echo "\n-- (C-online) Klassen-/Bauwerks-Phase: gerechnetes Budget, kein fester Wert --\n";

$check(
    '(c-online-1) alle DREI Online-Phasen fahren dieselbe gerechnete Budgetfunktion',
    [true, true, true, 3],
    [
        str_contains($dispatchSource, 'avesmapsWikiDumpHybridFillClassMapStep('),
        str_contains($dispatchSource, 'avesmapsWikiDumpHybridBuildingMapPhaseStep('),
        str_contains($dispatchSource, 'avesmapsWikiDumpHybridFillContinentMapStep($pdo, $runId, $titles, $cursor, avesmapsWikiDumpOnlineStepCallBudget())'),
        // Und die Zahl ist die eigentliche Zusicherung: DREI Zweige, DREI Budgets. Wer eine
        // vierte Online-Phase anbaut und das Budget vergisst, faellt hier auf.
        substr_count($dispatchSource, 'avesmapsWikiDumpOnlineStepCallBudget()'),
    ],
    'eine Regel, die einen von drei Erzeugern bindet, ist keine Regel -- dieselbe Lehre wie bei der Verkehrsmittel-Sperre (AGENTS.md)'
);
$check(
    '(c-online-2) im Quelltext des Treibers steht KEINE feste Aufrufzahl mehr',
    false,
    str_contains($hybridDriverSource, 'AVESMAPS_WIKI_DUMP_CONTINENT_MAP_STEP_CALL_BUDGET'),
    'die abgeschaffte Konstante war die 20, an der die Phase zerbrochen ist -- sie darf auch nicht als toter Wert herumliegen, den jemand "wiederherstellt"'
);

// Die zwei Phasen brauchen mehr Zustand als eine Zahl: welche Kategorie UND wo darin.
// Der zweite Teil reist -- wie bei publication_sources -- im additiven 'stats_patch'.
$klassenPdo = new FakeDriverPdo($makeRunRow('online_class_map', ['class_cursor' => 1, 'class_continue' => 'Dorf|1']));
$gesehen = [];
$klassenSchritte = [
    'online_class_map' => static function (PDO $pdo, array $ctx) use (&$gesehen): array {
        $gesehen = ['cursor' => $ctx['cursor'], 'continue' => $ctx['stats']['class_continue'] ?? null];
        return ['done' => false, 'nextCursor' => 1, 'stats_patch' => ['class_continue' => 'Dorf|2']];
    },
];
$klassenLauf = avesmapsWikiDumpHybridAdvanceReadStep($klassenPdo, '11111111-1111-4111-8111-111111111111', '/unused/dump.xml', true, $klassenSchritte);
$klassenStats = json_decode((string) ($klassenPdo->runUpdates[count($klassenPdo->runUpdates) - 1]['stats_json'] ?? '{}'), true);
$check(
    '(c-online-3) 💣 der Schritt bekommt BEIDE Cursorteile und beide werden persistiert',
    [1, 'Dorf|1', 'online_class_map', 1, 'Dorf|2'],
    [
        $gesehen['cursor'],
        $gesehen['continue'],
        $klassenLauf['phase'],
        (int) ($klassenStats['class_cursor'] ?? -1),
        (string) ($klassenStats['class_continue'] ?? ''),
    ],
    'der Index reist im eigenen Cursor-Schluessel, die Fortsetzung im stats_patch -- genau wie publication_sources seine Unterstufe fuehrt'
);

// Und der ganze Weg der Bauwerks-Phase: erst die Artenliste aufloesen, dann Art fuer Art.
$bauPdo = new FakeDriverPdo($makeRunRow('online_building_map', []));
$bauSchritt = avesmapsWikiDumpHybridDispatchPhaseStep(
    $bauPdo,
    'online_building_map',
    7,
    [],
    '/unused/dump.xml',
    true,
    ['online_building_map' => static function (PDO $pdo, array $ctx): array {
        return ['done' => false, 'nextCursor' => 0, 'stats_patch' => ['building_stage' => 'members']];
    }]
);
$check(
    '(c-online-4) die Testnaht der Bauwerks-Phase greift wie bei jeder anderen Phase',
    ['members', false],
    [$bauSchritt['stats_patch']['building_stage'] ?? '', $bauSchritt['done']],
    'die Phase hat zwei Unterstufen (Artenliste, dann Mitglieder) und muss trotzdem einspeisbar bleiben'
);

// Behavioural: mit dem echten Budget faehrt eine paginierte Kategorie ueber MEHRERE Schritte
// und verliert dabei nichts -- am Sammler gemessen, ohne PDO und ohne HTTP.
$seitenJeKategorie = [
    'Dorf' => [
        ['titles' => ['A'], 'continue' => 'Dorf|1'],
        ['titles' => ['B'], 'continue' => 'Dorf|2'],
        ['titles' => ['C'], 'continue' => null],
    ],
];
$holer = static function (string $kategorie, ?string $weiter) use ($seitenJeKategorie): array {
    $seiten = $seitenJeKategorie[$kategorie] ?? [['titles' => [], 'continue' => null]];
    $nummer = $weiter === null ? 0 : (int) (explode('|', $weiter)[1] ?? 0);
    return $seiten[$nummer] ?? ['titles' => [], 'continue' => null];
};
$index = 0;
$weiter = null;
$fertig = false;
$schritte = 0;
$titel = [];
$deckel = (int) ceil(7 / max(1, avesmapsWikiDumpOnlineStepCallBudget())) + 5;
while (!$fertig && $schritte < $deckel) {
    $s = avesmapsWikiDumpCategoryFetchSettlementClassMap($index, $weiter, avesmapsWikiDumpOnlineStepCallBudget(), $holer);
    $titel = array_merge($titel, array_keys($s['map']));
    $index = $s['nextIndex'];
    $weiter = $s['nextContinue'];
    $fertig = $s['done'];
    $schritte++;
}
sort($titel);
$check(
    '(c-online-5) mit dem ECHTEN Budget laeuft die paginierte Kategorie vollstaendig durch',
    [true, ['A', 'B', 'C']],
    [$fertig, $titel],
    'bei Budget 1 (Drossel 20 s) sind das drei Schritte fuer die drei Seiten -- vorher waren es 60 Sekunden in einem'
);
$check(
    '(c-online-6) ein voll ausgeschoepfter Schritt bleibt im Zeitfenster',
    true,
    avesmapsWikiDumpOnlineStepCallBudget() * $sekundenJeAufruf < AVESMAPS_WIKI_DUMP_STEP_SECONDS,
    'dieselbe Zusicherung wie fuer die Kontinent-Phase, jetzt fuer alle drei -- sie ist der Grund, warum das Budget gerechnet wird'
);

// ---------------------------------------------------------------------------
// Die Unterstufen-Weiche der Bauwerks-Phase -- die einzige Phase mit zwei Stufen.
// ---------------------------------------------------------------------------
$check(
    '(c-online-7) frischer Lauf -> erst die Artenliste aufloesen',
    'types',
    avesmapsWikiDumpHybridBuildingStage([], []),
    'ohne Liste gibt es nichts, worueber Stufe 2 laufen koennte'
);
$check(
    '(c-online-8) Marker "members" mit Liste -> die Mitglieder holen',
    'members',
    avesmapsWikiDumpHybridBuildingStage(['building_stage' => 'members'], ['Burg', 'Tempel']),
    'die normale zweite Haelfte der Phase'
);
$check(
    '(c-online-9) 💣 Marker "members", aber LEERE Liste -> zurueck zu Stufe 1',
    'types',
    avesmapsWikiDumpHybridBuildingStage(['building_stage' => 'members'], []),
    'sonst meldet Stufe 2 mit null Arten sofort done und ueberspringt saemtliche Bauwerke -- lautlos, mit gruenem Lauf'
);

// Und die Verdrahtung im Ganzen: was Stufe 1 in den stats_patch legt, muss die Weiche beim
// naechsten Schritt wieder finden. Ein Tippfehler im Schluessel liesse die Phase ewig kreisen
// und faellt an den Einzelpruefungen oben NICHT auf.
$stufe1 = [
    'done' => false,
    'nextCursor' => 0,
    'stage' => 'members',
    'stats_patch' => [
        'building_types' => ['Burg', 'Tempel'],
        'building_continue' => null,
        'building_stage' => 'members',
    ],
];
$statsNachStufe1 = [];
foreach ($stufe1['stats_patch'] as $k => $v) {
    $statsNachStufe1[$k] = $v;
}
$nachStufe1 = avesmapsWikiDumpHybridComputeNextState('online_building_map', $statsNachStufe1, $stufe1);
$check(
    '(c-online-10) der Zustand aus Stufe 1 fuehrt beim naechsten Schritt in Stufe 2',
    ['online_building_map', 'members'],
    [
        $nachStufe1['phase'],
        avesmapsWikiDumpHybridBuildingStage(
            $nachStufe1['stats'],
            is_array($nachStufe1['stats']['building_types'] ?? null) ? $nachStufe1['stats']['building_types'] : []
        ),
    ],
    'geschriebener und gelesener Schluessel sind derselbe -- sonst kreist die Phase bis zur Notbremse des Browsers'
);

// ---------------------------------------------------------------------------
// Und der ganze WEG der zweistufigen Bauwerks-Phase, mit den echten Bauteilen:
// avesmapsWikiDumpHybridBuildingMapPhaseStep() ist genau der Rumpf, den der Dispatch
// fuer diese Phase fahren wuerde -- nur mit eingespeisten Seitenholern statt HTTP und
// der Attrappen-PDO von oben statt MySQL. Die Frage, die sonst NIEMAND beantwortet:
// 💣 kommt die Phase ueberhaupt zum Ende? Eine Unterstufe, die nie umlegt, kreist bis zur
// Notbremse des Browsers (MAX_STEPS = 2000 in review-wiki-sync.js) -- und das sind bei
// 20 s Drossel mehr als elf Stunden, bevor irgendjemand etwas merkt.
// ---------------------------------------------------------------------------
$bauSeiten = [
    // Die Unterkategorien kommen ueber ZWEI Seiten -- der Fall, den die Fixture sonst nie hat.
    'Bauwerk nach Art' => [
        ['titles' => ['Kategorie:Steinkreis'], 'continue' => 'sub|1'],
        ['titles' => ['Kategorie:Leuchtturm'], 'continue' => null],
    ],
    // Und eine der Arten paginiert ebenfalls.
    'Steinkreis' => [
        ['titles' => ['Erster Stein'], 'continue' => 'st|1'],
        ['titles' => ['Zweiter Stein'], 'continue' => null],
    ],
    'Leuchtturm' => [['titles' => ['Turm von Havena'], 'continue' => null]],
];
$bauHoler = static function (string $kategorie, ?string $weiter) use ($bauSeiten): array {
    $seiten = $bauSeiten[$kategorie] ?? [['titles' => [], 'continue' => null]];
    $nummer = $weiter === null ? 0 : (int) (explode('|', $weiter)[1] ?? 0);
    return $seiten[$nummer] ?? ['titles' => [], 'continue' => null];
};

$bauPdo2 = new FakeDriverPdo($makeRunRow('online_building_map', []));
$bauStats = [];
$bauFertig = false;
$bauSchritte = 0;
$bauStufen = [];
$bauGeschrieben = 0;
// 🪤 Die erwartete Schrittzahl wird ABGELEITET, nicht hingeschrieben. Der erste Anlauf stand auf
// einer festen 6 -- und lag falsch, weil die aufgeloeste Artenliste die GANZE Legacy-Liste
// mittraegt (AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES), nicht nur die zwei Unterkategorien
// der Fixture. Eine feste Zahl haette bei der naechsten Aenderung dieser Liste rot gemeldet,
// ohne dass am Code etwas falsch waere.
$bauArten = avesmapsWikiDumpCategoryFetchBuildingTypes([], null, null, $bauHoler)['types'];
// 2 Schritte fuer die zwei Seiten der Unterkategorien, dann je Art eine Seite -- und
// "Steinkreis" hat als einzige eine zweite.
$bauErwarteteSchritte = 2 + count($bauArten) + 1;
// Der Deckel liegt bewusst darueber und ist trotzdem endlich: er faengt das Kreisen.
while (!$bauFertig && $bauSchritte < $bauErwarteteSchritte + 20) {
    $bauStufen[] = avesmapsWikiDumpHybridBuildingStage(
        $bauStats,
        is_array($bauStats['building_types'] ?? null) ? $bauStats['building_types'] : []
    );
    $ergebnis = avesmapsWikiDumpHybridBuildingMapPhaseStep(
        $bauPdo2,
        7,
        $bauStats,
        (int) ($bauStats['building_cursor'] ?? 0),
        1,
        $bauHoler,
        $bauHoler
    );
    $bauGeschrieben += (int) ($ergebnis['written'] ?? 0);
    // Der Dispatch mischt den stats_patch VOR der Transition ein -- hier genauso.
    foreach (($ergebnis['stats_patch'] ?? []) as $k => $v) {
        $bauStats[$k] = $v;
    }
    $naechster = avesmapsWikiDumpHybridComputeNextState('online_building_map', $bauStats, $ergebnis);
    $bauStats = $naechster['stats'];
    $bauFertig = (bool) ($ergebnis['done'] ?? false);
    $bauSchritte++;
}

$check(
    '(c-online-11) 💣 die zweistufige Phase kommt zum ENDE, und zwar nach genau einer Abfrage je Seite',
    [true, $bauErwarteteSchritte],
    [$bauFertig, $bauSchritte],
    '2 Seiten Unterkategorien + je eine Seite pro aufgeloester Art + die zweite Seite von "Steinkreis"'
);
$check(
    '(c-online-12) die Unterstufe legt genau EINMAL um: erst types, dann members',
    array_merge(['types', 'types'], array_fill(0, $bauErwarteteSchritte - 2, 'members')),
    $bauStufen,
    'zwei Schritte fuer die zwei Seiten der Artenliste, danach nie wieder zurueck -- ein Zurueckfallen waere das Kreisen'
);
$check(
    '(c-online-13) alle drei Bauwerke wurden geschrieben, keines verloren',
    3,
    $bauGeschrieben,
    'ueber vier Schritte hinweg und ueber eine Seitengrenze innerhalb von "Steinkreis"'
);
// 🪤 Geprueft wird "keine Liste mehr", nicht "Schluessel weg": der Schritt setzt ihn auf
// null, und der Null-Verschmelzungsoperator kann null von abwesend nicht unterscheiden --
// die erste Fassung dieser Zusicherung verglich deshalb gegen ihren eigenen Rueckfallwert
// und war blind.
$check(
    '(c-online-14) am Ende liegt die Artenliste nicht mehr in stats_json',
    false,
    is_array($bauStats['building_types'] ?? null),
    'was nur WAEHREND einer Phase gebraucht wird, geht danach raus -- wiki_sync_runs ist genau daran schon einmal auf 99 MiB gewachsen'
);

// ===========================================================================
// (D) progress envelope shape.
// ===========================================================================
echo "\n-- (D) avesmapsWikiDumpHybridProgressEnvelope --\n";

$public = avesmapsWikiDumpHybridPublicRun($makeRunRow('wikitext_collect', ['wikitext_cursor' => 4200]));
$env = avesmapsWikiDumpHybridProgressEnvelope($public, ['pages_scanned' => 2000, 'found_this_step' => 17, 'done' => false]);
$check(
    '(D1) progress envelope carries phase + per-step counters',
    ['wikitext_collect', 2000, 17],
    [$env['phase'], $env['pages_scanned'] ?? -1, $env['found_this_step'] ?? -1],
    'the frontend renders phase + live per-step numbers (pages_scanned/found) from this envelope'
);
$check(
    '(D2) public run projection exposes the phase cursor + all four named cursors',
    [4200, 4200],
    [$public['cursor'], $public['cursors']['wikitext_cursor']],
    'the dump_read projection surfaces the active phase cursor (not the online-crawl stats keys)'
);

// ===========================================================================
// summary
// ===========================================================================
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
