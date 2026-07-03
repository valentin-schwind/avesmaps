<?php

declare(strict_types=1);

/**
 * Unit test for the DUMP-ONLY coat guard in the territory branch of
 * avesmapsWikiDumpHybridUpsertParsedRow() (api/_internal/wiki/dump-hybrid-read.php).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS GUARD EXISTS
 * ---------------------------------------------------------------------------
 * The offline dump has NO file-license metadata (I5 -- coat license comes from
 * the SEPARATE online enrich pass). The normalized territory record produced by
 * avesmapsPoliticalNormalizeWikiRecord ALWAYS carries a coat_of_arms_url key,
 * even when the dump wikitext has no |Wappen= (then it is the empty string).
 * The reused sandbox writer avesmapsWikiSyncMonitorUpsertTestRecord() maps
 * ''->NULL and issues `ON DUPLICATE KEY UPDATE col = VALUES(col)` for every
 * record key that is a real column -- so an EMPTY coat value in a dump record
 * would NULL a precious staged coat link (owner rule: "gibt es ein wappen, gibt
 * es einen wappenlink") or, if a license key ever leaked in empty, the owner's
 * license classification. The guard drops any empty/whitespace coat key from the
 * record BEFORE the upsert so the staged value is left untouched. A NON-empty
 * coat link still flows through and updates.
 *
 * This mirrors the settlement coat guard (`coat_url = COALESCE(:coat_url,
 * coat_url)`) a few branches up in the same function.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST COVERS
 * ---------------------------------------------------------------------------
 *   (NEG) A staged row with coat_of_arms_url='https://.../Wappen.svg' AND
 *         coat_of_arms_license_status='public_domain' KEEPS BOTH after a
 *         territory dump-sync whose parsed record has an EMPTY coat. (No coat
 *         column appears in the emitted INSERT/UPDATE at all -> the ON DUPLICATE
 *         KEY UPDATE cannot overwrite them.)
 *   (POS) A dump record WITH a non-empty coat link DOES include coat_of_arms_url
 *         in the write, so the staged link is updated to the new value.
 *   (GUARD) The guard only strips EMPTY coat keys; non-coat fields (name, type)
 *         always flow through unchanged.
 *
 * The test drives the REAL avesmapsWikiDumpHybridUpsertParsedRow() with
 * kind=territory and NO upsert override, so the REAL guard and the REAL
 * avesmapsWikiSyncMonitorUpsertTestRecord() run against a FAKE PDO that models
 * exactly the two things the writer touches:
 *   - SHOW COLUMNS FROM political_territory_wiki_test  (for StagingColumns)
 *   - the INSERT ... ON DUPLICATE KEY UPDATE (applied to an in-memory staged row,
 *     honouring the ''->NULL mapping and VALUES() semantics)
 * plus the harmless title->key alias write (StoreAlias) which we let no-op.
 * No live DB / sandbox / MediaWiki API is needed.
 *
 * HOW TO RUN (the include chain pulls in mb_*-using derivations + XMLReader):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-territory-coat-guard.php
 *
 * Exit code 0 iff every assertion passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 0. Preconditions.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the include chain's derivations require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the include chain needs XMLReader.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: the SAME chain test-dump-hybrid-read-driver.php uses (it is
//    the sibling that exercises this exact file). sync-monitor.php defines
//    AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE and pulls in sync-monitor-model.php
//    (StagingColumns/StoreAlias) + sync-monitor-licenses.php (UpsertTestRecord).
//    All side-effect-free on include (defs only).
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

ob_start();
require $repoRoot . '/api/_internal/wiki/dump-hybrid-read.php';
$includeOutput = (string) ob_get_clean();

foreach ([
    'avesmapsWikiDumpHybridUpsertParsedRow',
    'avesmapsWikiSyncMonitorUpsertTestRecord',
    'avesmapsWikiSyncMonitorStagingColumns',
] as $fn) {
    if (!function_exists($fn)) {
        fwrite(STDERR, "FATAL: expected function {$fn}() was not defined by the include chain.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (mirrors every sibling tools/wikidump test).
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

echo "================================================================\n";
echo " dump territory coat-guard test (WikiDump)\n";
echo "================================================================\n";

$check('include produced no output', '', $includeOutput,
    'the library is side-effect-free on include (defs only) -- same PURITY CONTRACT as every sibling');

// ---------------------------------------------------------------------------
// 3. Fake staging PDO. Models the political_territory_wiki_test staging table as
//    a single in-memory row keyed by wiki_key. It answers:
//      (a) SHOW COLUMNS FROM <staging>  -> the column set StagingColumns caches
//          (must INCLUDE the 5 license columns + coat_of_arms_url so the guard is
//          actually exercised: without the guard those keys WOULD be written).
//      (b) SHOW TABLES / other DDL      -> harmless no-ops.
//      (c) INSERT ... ON DUPLICATE KEY UPDATE  -> upsert into $this->rows,
//          applying VALUES()-on-conflict and the ''->NULL the writer already did
//          in its param binding (so we store exactly what the writer bound).
//    It also captures the columns named in the most recent INSERT so a test can
//    assert a coat column was/ wasn't part of the write.
// ---------------------------------------------------------------------------

/** The staging columns the real table has (superset that matters here). */
$STAGING_COLUMNS = [
    'id', 'wiki_key', 'name', 'type', 'continent',
    'coat_of_arms_url',
    'coat_of_arms_license', 'coat_of_arms_author', 'coat_of_arms_attribution',
    'coat_of_arms_license_status', 'coat_of_arms_license_url',
    'synced_at',
];

final class FakeStagingStmt extends PDOStatement
{
    private array $bound = [];
    private array $fetchAllRows = [];

    public function __construct(private string $sql, private FakeStagingPdo $pdo)
    {
    }

    #[\ReturnTypeWillChange]
    public function execute($params = null): bool
    {
        $this->bound = (array) ($params ?? []);
        $sql = $this->sql;
        $this->pdo->executedSql[] = $sql;
        $this->fetchAllRows = [];

        // SHOW COLUMNS FROM <staging>: feed StagingColumns.
        if (stripos($sql, 'SHOW COLUMNS FROM') !== false) {
            foreach ($this->pdo->columns as $col) {
                $this->fetchAllRows[] = ['Field' => $col];
            }
            return true;
        }

        // INSERT INTO political_territory_wiki_test (...) VALUES (...) ON DUPLICATE
        // KEY UPDATE ...: the writer's real STAGING upsert. Scope strictly to the
        // staging table -- the subsequent StoreAlias write is ALSO an
        // "INSERT ... ON DUPLICATE KEY UPDATE" (into the alias table) and must NOT
        // clobber our captured staging columns / staged row. Parse the leading
        // column list, remember it, and apply the bound params as the new row
        // (INSERT or ON-DUP UPDATE both converge to "the staged row becomes these
        // bound values": VALUES(col) on conflict copies the would-be INSERT value,
        // which IS the bound param).
        if (stripos($sql, 'INSERT INTO ' . AVESMAPS_WIKI_SYNC_MONITOR_STAGING_TABLE) !== false
            && stripos($sql, 'ON DUPLICATE KEY UPDATE') !== false) {
            $cols = [];
            if (preg_match('/INSERT INTO\s+\S+\s*\(([^)]*)\)/i', $sql, $m) === 1) {
                foreach (explode(',', $m[1]) as $raw) {
                    $name = trim($raw);
                    if ($name !== '') {
                        $cols[] = $name;
                    }
                }
            }
            $this->pdo->lastInsertColumns = $cols;

            $wikiKey = (string) ($this->bound['wiki_key'] ?? '');
            $existing = $this->pdo->rows[$wikiKey] ?? [];
            foreach ($this->bound as $key => $value) {
                // synced_at is a SQL literal (CURRENT_TIMESTAMP), not a bound param.
                $existing[$key] = $value;
            }
            $this->pdo->rows[$wikiKey] = $existing;
            return true;
        }

        // StoreAlias (alias-table upsert) + any DDL / SHOW TABLES: harmless no-op.
        return true;
    }

    #[\ReturnTypeWillChange]
    public function fetchAll($mode = PDO::FETCH_DEFAULT, ...$args): array
    {
        return $this->fetchAllRows;
    }

    #[\ReturnTypeWillChange]
    public function fetch($mode = PDO::FETCH_DEFAULT, $cursorOrientation = PDO::FETCH_ORI_NEXT, $cursorOffset = 0)
    {
        return false;
    }

    #[\ReturnTypeWillChange]
    public function fetchColumn($column = 0)
    {
        return false;
    }
}

final class FakeStagingPdo extends PDO
{
    /** @var array<string, array<string,mixed>> wiki_key => staged row */
    public array $rows = [];
    /** @var list<string> columns named in the most recent INSERT */
    public array $lastInsertColumns = [];
    /** @var list<string> every executed statement's SQL */
    public array $executedSql = [];
    /** @var list<string> the staging column set SHOW COLUMNS returns */
    public array $columns;

    public function __construct(array $columns)
    {
        // Deliberately do NOT call parent::__construct (no real driver).
        $this->columns = $columns;
    }

    #[\ReturnTypeWillChange]
    public function prepare($query, $options = [])
    {
        return new FakeStagingStmt((string) $query, $this);
    }

    #[\ReturnTypeWillChange]
    public function query($statement, $mode = PDO::ATTR_DEFAULT_FETCH_MODE, ...$fetchModeArgs)
    {
        $sql = (string) $statement;
        $this->executedSql[] = $sql;
        // StagingColumns does `foreach ($pdo->query('SHOW COLUMNS ...') ?: [] as $row)`
        // -- iterate the RESULT directly. A fake PDOStatement built without the real
        // driver is not iterable ("object is uninitialized"), so return a plain array
        // of {Field: <col>} rows, which foreach consumes identically.
        if (stripos($sql, 'SHOW COLUMNS FROM') !== false) {
            return array_map(static fn(string $col): array => ['Field' => $col], $this->columns);
        }
        // Any other query() (e.g. a SHOW TABLES probe): a no-op empty array.
        return [];
    }

    #[\ReturnTypeWillChange]
    public function exec($statement)
    {
        $this->executedSql[] = (string) $statement;
        return 0;
    }
}

/**
 * Build a normalized territory record exactly as the dump path would: run the
 * REAL avesmapsPoliticalNormalizeWikiRecord over a German infobox map (so the
 * full fixed key set -- including coat_of_arms_url -- is present), with the coat
 * link supplied via 'Wappen-Link'. This proves the record genuinely CARRIES
 * coat_of_arms_url (empty or not), which is the whole reason the guard is needed.
 */
$makeTerritoryRecord = static function (string $name, string $type, string $coatLink): array {
    $record = avesmapsPoliticalNormalizeWikiRecord([
        'Name' => $name,
        'Typ' => $type,
        'Kontinent' => 'Aventurien',
        'Wiki-Link' => 'https://de.wiki-aventurica.de/wiki/' . rawurlencode($name),
        'Wappen-Link' => $coatLink,
    ]);
    // The dump path also stamps title (used for the alias) -- mirror that.
    $record['title'] = $name;
    return $record;
};

// ---------------------------------------------------------------------------
// 4a. SANITY: the normalized record carries coat_of_arms_url but NOT the license
//     keys (I5). This is the precondition that makes the guard meaningful.
// ---------------------------------------------------------------------------
echo "\n-- (0) record shape sanity: coat key present, license keys absent (I5) --\n";

$emptyRec = $makeTerritoryRecord('Guardheim', 'Baronie', '');
$check('(0.1) normalized record CARRIES coat_of_arms_url', true,
    array_key_exists('coat_of_arms_url', $emptyRec),
    'avesmapsPoliticalNormalizeWikiRecord always keys coat_of_arms_url -> an empty dump would null a staged link');
$check('(0.2) an absent |Wappen= yields an EMPTY coat_of_arms_url', '',
    (string) $emptyRec['coat_of_arms_url'],
    'no coat link in the dump wikitext -> the record carries the empty string, which the writer maps to NULL');
$licenseKeysPresent = array_values(array_filter([
    'coat_of_arms_license', 'coat_of_arms_license_status', 'coat_of_arms_author',
    'coat_of_arms_attribution', 'coat_of_arms_license_url',
], static fn(string $k): bool => array_key_exists($k, $emptyRec)));
$check('(0.3) the normalized record carries NONE of the 5 license keys (I5)', [],
    $licenseKeysPresent,
    'license classification comes from the separate ONLINE enrich pass -- the dump record must not carry it');

// ---------------------------------------------------------------------------
// 4b. NEGATIVE: empty dump coat must NOT null a staged coat link OR license.
// ---------------------------------------------------------------------------
echo "\n-- (NEG) empty dump coat keeps the staged coat link + license --\n";

$pdoNeg = new FakeStagingPdo($STAGING_COLUMNS);
$recordNeg = $makeTerritoryRecord('Guardheim', 'Baronie', ''); // EMPTY coat
$wikiKeyNeg = (string) $recordNeg['wiki_key']; // the REAL derived key ('wiki:guardheim')
// Pre-stage a precious row UNDER THE REAL wiki_key (so the upsert's ON DUPLICATE
// KEY UPDATE genuinely targets THIS row): real coat link + owner public_domain.
$pdoNeg->rows[$wikiKeyNeg] = [
    'wiki_key' => $wikiKeyNeg,
    'name' => 'Guardheim',
    'type' => 'Baronie',
    'coat_of_arms_url' => 'https://de.wiki-aventurica.de/images/Wappen.svg',
    'coat_of_arms_license_status' => 'public_domain',
    'coat_of_arms_author' => 'Some Artist',
];

$parsedNeg = [
    'kind' => AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY,
    'title' => 'Guardheim',
    'record' => $recordNeg,
];
// REAL guard + REAL UpsertTestRecord (no override).
avesmapsWikiDumpHybridUpsertParsedRow($pdoNeg, $parsedNeg);

$stagedNeg = $pdoNeg->rows[$wikiKeyNeg] ?? [];
$check('(NEG.1) staged coat_of_arms_url is PRESERVED', 'https://de.wiki-aventurica.de/images/Wappen.svg',
    $stagedNeg['coat_of_arms_url'] ?? '__missing__',
    'the empty dump coat was stripped before the upsert -> the ON DUPLICATE KEY UPDATE never touched the link');
$check('(NEG.2) staged coat_of_arms_license_status is PRESERVED', 'public_domain',
    $stagedNeg['coat_of_arms_license_status'] ?? '__missing__',
    'the dump has no license (I5); the owner classification survives untouched');
$check('(NEG.3) staged coat_of_arms_author is PRESERVED', 'Some Artist',
    $stagedNeg['coat_of_arms_author'] ?? '__missing__',
    'no license/author field in the dump record -> nothing overwrites the staged author');
$check('(NEG.4) NO coat column appeared in the emitted INSERT/UPDATE at all', [],
    array_values(array_filter($pdoNeg->lastInsertColumns, static fn(string $c): bool => strpos($c, 'coat_of_arms') === 0)),
    'the guard removed every empty coat key, so no coat_of_arms_* column is in the write column list');
// The non-coat fields still flowed (proving the sync itself ran, not a no-op).
$check('(NEG.5) a non-coat field (type) DID flow through', true,
    in_array('type', $pdoNeg->lastInsertColumns, true),
    'the guard is surgical: only empty coat keys are stripped; ordinary fields still upsert');

// ---------------------------------------------------------------------------
// 4c. POSITIVE: a non-empty dump coat link DOES update the staged coat.
// ---------------------------------------------------------------------------
echo "\n-- (POS) non-empty dump coat updates the staged coat link --\n";

$pdoPos = new FakeStagingPdo($STAGING_COLUMNS);
$newCoat = 'https://de.wiki-aventurica.de/index.php?title=Spezial:Dateipfad/NewWappen.svg';
$recordPos = $makeTerritoryRecord('Guardheim', 'Baronie', $newCoat); // NON-empty coat
$wikiKeyPos = (string) $recordPos['wiki_key'];
$pdoPos->rows[$wikiKeyPos] = [
    'wiki_key' => $wikiKeyPos,
    'name' => 'Guardheim',
    'type' => 'Baronie',
    'coat_of_arms_url' => 'https://de.wiki-aventurica.de/images/OldWappen.svg',
    'coat_of_arms_license_status' => 'public_domain',
];

$parsedPos = [
    'kind' => AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY,
    'title' => 'Guardheim',
    'record' => $recordPos,
];
avesmapsWikiDumpHybridUpsertParsedRow($pdoPos, $parsedPos);

$stagedPos = $pdoPos->rows[$wikiKeyPos] ?? [];
$check('(POS.1) a coat_of_arms_url column WAS part of the write', true,
    in_array('coat_of_arms_url', $pdoPos->lastInsertColumns, true),
    'a non-empty coat link is NOT stripped -> it flows into the upsert column list');
$check('(POS.2) the staged coat_of_arms_url was UPDATED to the new link',
    $newCoat, $stagedPos['coat_of_arms_url'] ?? '__missing__',
    'the guard only protects EMPTY coats; a real coat link updates the staged value as normal');
$check('(POS.3) the pre-existing license_status is untouched by a coat-only update', 'public_domain',
    $stagedPos['coat_of_arms_license_status'] ?? '__missing__',
    'the dump record carries no license key, so a coat update never disturbs the staged classification');

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d passed, %d failed\n", $passCount, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
