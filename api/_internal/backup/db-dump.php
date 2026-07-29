<?php

declare(strict_types=1);

/**
 * Full-database backup -- a chunked, resumable, gzip-packed .sql dump.
 * ---------------------------------------------------------------------------
 * Produces ONE ordinary .sql.gz that can be restored with nothing but a MySQL
 * client:
 *
 *     gunzip -c avesmaps-<db>-<stamp>.sql.gz | mysql -u <user> -p <database>
 *
 * or by uploading the same file into phpMyAdmin's import tab. It carries every
 * base table's `DROP TABLE IF EXISTS` + `CREATE TABLE` + its rows, then views,
 * triggers and routines -- schema as well as data, so an empty database is a valid
 * restore target. It deliberately contains no `CREATE DATABASE` / `USE`, so it
 * restores into whichever database the client has selected (that is what makes the
 * phpMyAdmin route work).
 *
 * WHY THIS EXISTS (and why not mysqldump): STRATO shared hosting gives us no
 * shell, so `mysqldump` is unreachable -- the dump has to be produced from PHP
 * over the same PDO connection the app uses.
 *
 * WHY IT IS CHUNKED: a full dump is far more work than one PHP request may spend
 * (the same reason every WikiSync pass here is a bounded step loop -- see
 * AVESMAPS_WIKI_DUMP_STEP_SECONDS in api/_internal/wiki/dump-reader.php). So a
 * backup is a RUN: a row in `db_backup_run` holds the phase, the object cursor and
 * the row cursor, advanced by avesmapsDbBackupStep() which the client calls in a
 * loop until `done`. Each step is bounded by a wall-clock deadline AND by an
 * output-size budget.
 *
 * 💣 HOW A RESUMABLE WRITER STILL PRODUCES A SINGLE-MEMBER GZIP (the crux -- read
 * before touching the output layer). A deflate stream cannot be resumed by a later
 * PHP process, so the naive chunked writer appends one COMPLETE gzip member per
 * flush. That file is valid per the gzip spec and `gunzip`, `zcat`, zlib and
 * PHP's `gzopen` all read it whole -- but PHP's own `gzdecode()` and 7-Zip's GUI
 * read only the FIRST member and silently hand back a truncated dump. For a
 * backup, "silently truncated" is the worst failure there is, so this writer uses
 * the pigz construction instead and emits ONE member:
 *
 *   1. the fixed 10-byte gzip header, once, before the first fragment;
 *   2. per flush: a FRESH raw-deflate context, `deflate_add($sql, ZLIB_SYNC_FLUSH)`.
 *      Sync-flush ends the fragment on a byte boundary, and because the context is
 *      fresh the fragment never back-references bytes outside its own chunk -- so
 *      the concatenation of fragments is one valid raw deflate stream;
 *   3. at the end: a final empty deflate block (`\x03\x00`) to set BFINAL, then the
 *      gzip trailer -- CRC32 of the whole plain text and its length, little-endian.
 *
 * The CRC32 is carried across steps in the run row and extended per fragment with
 * avesmapsDbBackupCrc32Combine() (zlib's crc32_combine, GF(2) matrix form), so the
 * trailer is correct without ever re-reading the payload. The cost of per-chunk
 * contexts is under a percent at this chunk size; the benefit is a file every tool
 * on every platform reads as one stream. `gunzip -t` on the result validates the
 * CRC, and so does the run's own verify phase.
 *
 * 💣 CRASH RECONCILIATION (why gz_bytes is authoritative): a step first APPENDS its
 * fragment, then PERSISTS the advanced cursors + byte counts + CRC. If the process
 * dies in between, the file holds bytes the run row does not know about, and
 * replaying the step would emit those INSERTs twice -- a restore would then die on
 * duplicate keys. So every step STARTS by reconciling: a file longer than the
 * persisted gz_bytes is truncated back to it. That is exact precisely because
 * fragments are byte-aligned and self-contained, so the truncated file is still a
 * valid prefix that the next fragment continues. Never reorder append-then-persist,
 * and never drop the reconcile.
 *
 * ⚠️ CONSISTENCY CAVEAT, stated plainly because it cannot be engineered away here:
 * this is a HOT backup. Each step runs on its own request and therefore its own
 * MySQL connection, so no transaction (and no `LOCK TABLES`) spans the run -- a row
 * written by an editor mid-run may land in the dump or not, depending on when its
 * table was read. Within one table the read is stable (it paginates over the
 * primary key), but two tables are not guaranteed to be from the same instant. For
 * a fan-project map that is a fine trade; the file header records it so whoever
 * restores it knows.
 *
 * VERIFICATION is part of the run, not an afterthought: the last phase inflates the
 * finished file end-to-end and requires that it decodes cleanly, that the
 * decompressed length equals the bytes compressed, that its CRC32 matches the
 * accumulated one, and that the last line is the `-- AVESMAPS BACKUP END` marker.
 * A run reaches `completed` only when all four hold, so "completed" means "this
 * file restores", not "the loop stopped".
 *
 * SENSITIVITY: a full dump contains `users.password_hash`, every share link and
 * every report -- the most sensitive artifact this project can produce. It is
 * written to an HTTP-denied directory (uploads/db-backups, deny-all .htaccess
 * self-healed here at run time) and reachable ONLY through the `admin`-gated
 * download action in api/edit/admin/database-backup.php. It must never enter the
 * repository (docs/repository-data-policy.md; .gitignore covers the folder).
 *
 * PURITY CONTRACT: side-effect-free on include (only `const` + `function`
 * definitions -- no top-level code, no DB connect, no headers), so
 * api/_internal/backup/__tests__/db-dump-test.php can `require` this file with no
 * MySQL. Every DB touch takes a PDO explicitly, and the offline-decidable logic
 * (identifier quoting, value literalization, DEFINER stripping, the gzip
 * construction, CRC combining, cursor-strategy choice, transient classification,
 * filename safety, progress arithmetic) lives in PURE functions the test exercises
 * directly.
 */

// ===========================================================================
// Constants.
// ===========================================================================

/** Self-healing run-state table (schema-in-code convention). */
const AVESMAPS_DB_BACKUP_RUN_TABLE = 'db_backup_run';

/**
 * Storage directory RELATIVE to the webroot. Lives under uploads/ (the repo's
 * runtime-writable area) but is DENIED to HTTP clients by a .htaccess written at
 * run time -- the deploy allowlist does not carry uploads/, so the protection
 * cannot come from the repo alone. Mirrors uploads/dumps (dump-fetch.php).
 */
const AVESMAPS_DB_BACKUP_STORAGE_SUBDIR = 'uploads/db-backups';

/**
 * Wall-clock budget for ONE step, in seconds. Just under the WikiSync step budget
 * (28s): a backup step is pure DB reads plus deflate and should never be the
 * request that trips STRATO's own ceiling. set_time_limit() gets headroom on top.
 */
const AVESMAPS_DB_BACKUP_STEP_SECONDS = 24;

/**
 * Uncompressed SQL bytes buffered before a step flushes a deflate fragment, and
 * the per-step output ceiling. 4 MiB keeps peak memory small while keeping the
 * per-fragment compression loss negligible.
 */
const AVESMAPS_DB_BACKUP_FRAGMENT_BYTES = 4194304;

/**
 * Maximum size of a single generated `INSERT`. Kept well under the smallest
 * max_allowed_packet a restore target is likely to have (1 MiB): a statement
 * larger than the TARGET's packet limit makes the dump unrestorable there, and
 * that only shows up at restore time.
 */
const AVESMAPS_DB_BACKUP_STATEMENT_BYTES = 196608; // 192 KiB

/**
 * Upper and lower bound on the rows fetched per SELECT while dumping a table. The
 * actual figure is derived per table from its average row size
 * (avesmapsDbBackupRowsPerRead) so a table of 50 KB wikitext rows does not put
 * 25 MB of them in memory at once -- with the fetched rows, the rendered SQL and
 * PDO's own buffer that is three copies, and STRATO's memory_limit is not generous.
 */
const AVESMAPS_DB_BACKUP_ROWS_PER_READ = 500;
const AVESMAPS_DB_BACKUP_ROWS_PER_READ_MIN = 25;

/** Target uncompressed size of one row batch, which sets the adaptive row count. */
const AVESMAPS_DB_BACKUP_ROW_BATCH_BUDGET_BYTES = 4194304;

/** Deflate level for the fragments (6 = zlib default; good ratio per CPU). */
const AVESMAPS_DB_BACKUP_GZ_LEVEL = 6;

/**
 * The fixed gzip member header: magic \x1f\x8b, method 8 (deflate), no flags, no
 * mtime (a backup's time is in its name and its own header comment), XFL 0, OS
 * 0xff (unknown). Written once, before the first fragment.
 */
const AVESMAPS_DB_BACKUP_GZIP_HEADER = "\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\xff";

/** CRC-32 polynomial in reflected form -- the seed of the combine matrix. */
const AVESMAPS_DB_BACKUP_CRC32_POLYNOMIAL = 0xedb88320;

/**
 * How many COMPLETED backup files are kept. A finished run prunes older ones so
 * the shared webspace (which also carries the tiles and the wiki dump) cannot be
 * filled by backups nobody deletes.
 */
const AVESMAPS_DB_BACKUP_KEEP_FILES = 3;

/**
 * A `running` run whose heartbeat is older than this is considered abandoned, so a
 * new backup may start (and the abandoned one is marked failed). Same reasoning as
 * the WikiDump lock's threshold: comfortably above one step's deadline plus HTTP
 * slack.
 */
const AVESMAPS_DB_BACKUP_STALE_SECONDS = 180;

/**
 * The verify phase inflates the whole file in one step and simply restarts if its
 * deadline is hit (pure CPU, idempotent). After this many restarts the run
 * completes with a recorded warning instead of looping forever -- the file exists
 * either way, and a warning the admin can see beats a run that never ends.
 */
const AVESMAPS_DB_BACKUP_VERIFY_MAX_ATTEMPTS = 3;

/** Read granularity of the verify pass. */
const AVESMAPS_DB_BACKUP_VERIFY_CHUNK_BYTES = 1048576;

/** The trailer's last line. The verify pass requires the file to end with it. */
const AVESMAPS_DB_BACKUP_END_MARKER = '-- AVESMAPS BACKUP END';

/**
 * Tables whose CONTENT is a rebuildable cache rather than data (the optional
 * "skip transient tables" mode dumps their structure only). Deliberately a SHORT,
 * conservative, explicit list plus one suffix rule: every entry is something a
 * "Dump holen" run recreates from the Wiki Aventurica export. Anything not named
 * here is dumped in full -- mislabelling a table transient means silent data loss
 * in a backup, so the bar for adding one is "a documented importer rebuilds it
 * from scratch".
 *
 * NOTE the near-misses deliberately NOT here: `political_territory_wiki` carries
 * manual overrides, `map_audit_log` and the `*_audit_log` tables are history
 * nothing can recompute, and `wiki_sync_cases` holds editor decisions.
 */
const AVESMAPS_DB_BACKUP_TRANSIENT_TABLES = [
    'wiki_dump_hybrid_state',
    'wiki_dump_title_alias',
    'wiki_sync_pages',
];

/** `wiki_*` tables ending in this suffix are transient too (WikiSync staging). */
const AVESMAPS_DB_BACKUP_TRANSIENT_SUFFIX = '_staging';

// ===========================================================================
// Exception raised when a second backup is attempted.
// ===========================================================================

/**
 * Thrown by avesmapsDbBackupStartRun() when a backup with a live heartbeat is
 * already running. The endpoint maps it to
 * {ok:false, error:{code:'backup_running'}} with HTTP 409 so the page can say so
 * and stop, rather than starting a second run that would compete for the same
 * webspace for no benefit. Its own class (not a message match) because that is the
 * only way an endpoint can tell this expected refusal from a real failure --
 * mirrors WikiDumpLockBusyException in api/_internal/wiki/dump-lock.php.
 */
final class DbBackupBusyException extends RuntimeException
{
    public function __construct(public readonly string $holderUsername = '')
    {
        parent::__construct('Es laeuft bereits ein Backup.');
    }
}

// ===========================================================================
// PURE: identifier quoting, literalization, DDL rewriting.
// ===========================================================================

/**
 * Quote a MySQL identifier for the dump. Backticks, with any embedded backtick
 * doubled -- the standard MySQL escape. Identifiers here always come from our own
 * `SHOW`/information_schema output rather than user input, but a dump is a file
 * other tools parse, so it is quoted properly regardless.
 */
function avesmapsDbBackupQuoteIdentifier(string $name): string
{
    return '`' . str_replace('`', '``', $name) . '`';
}

/** True for column types whose values may be emitted as bare numeric literals. */
function avesmapsDbBackupIsNumericColumnType(string $type): bool
{
    return (bool) preg_match(
        '/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|dec|numeric|fixed|float|double|real)\b/',
        strtolower(trim($type))
    );
}

/**
 * True for column types whose values are BYTES, not text. Those are emitted as
 * `0x...` hex literals: escaping raw bytes into a `SET NAMES utf8mb4` file would
 * make the file itself invalid UTF-8, which is how a dump ends up rejected by the
 * very importer it was made for.
 */
function avesmapsDbBackupIsBinaryColumnType(string $type): bool
{
    $base = strtolower(trim($type));

    if (preg_match('/^(tinyblob|blob|mediumblob|longblob|binary|varbinary|bit)\b/', $base) === 1) {
        return true;
    }

    // Spatial types also come back as bytes (WKB) from a plain SELECT.
    return preg_match(
        '/^(geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection|geomcollection)\b/',
        $base
    ) === 1;
}

/**
 * True for a generated (virtual/stored) column, read from `SHOW COLUMNS`' Extra.
 * Generated columns MUST be left out of the INSERT column list -- MySQL rejects an
 * explicit value for them, so including one makes the whole dump unrestorable.
 */
function avesmapsDbBackupIsGeneratedColumn(string $extra): bool
{
    return stripos($extra, 'GENERATED') !== false;
}

/**
 * Emit a float as the shortest decimal literal that round-trips. json_encode
 * honours serialize_precision=-1 (PHP's default), which is exactly the
 * shortest-round-trip representation.
 */
function avesmapsDbBackupFormatFloat(float $value): string
{
    if (!is_finite($value)) {
        // MySQL cannot store INF/NAN, so this is unreachable from a real column;
        // NULL is the only honest fallback if a driver ever hands us one.
        return 'NULL';
    }

    $encoded = json_encode($value);

    return is_string($encoded) && $encoded !== '' ? $encoded : sprintf('%.17G', $value);
}

/**
 * PURE: turn one fetched column value into an SQL literal.
 *
 * The quoter is injected (in production `fn($s) => $pdo->quote($s)`) so the whole
 * decision table -- NULL, int, float, hex for byte columns, bare literal for
 * numeric columns, quoted string otherwise -- is testable without a database.
 *
 * @param array{type:string} $column the column's `SHOW COLUMNS` shape
 * @param callable(string):string $quoter connection-aware string quoter
 */
function avesmapsDbBackupFormatValue(mixed $value, array $column, callable $quoter): string
{
    if ($value === null) {
        return 'NULL';
    }

    if (is_bool($value)) {
        return $value ? '1' : '0';
    }

    if (is_int($value)) {
        return (string) $value;
    }

    if (is_float($value)) {
        return avesmapsDbBackupFormatFloat($value);
    }

    $text = (string) $value;
    $type = (string) ($column['type'] ?? '');

    if (avesmapsDbBackupIsBinaryColumnType($type)) {
        // `0x` with no digits is not valid SQL, so an empty byte string stays ''.
        return $text === '' ? "''" : '0x' . bin2hex($text);
    }

    if (avesmapsDbBackupIsNumericColumnType($type)
        && preg_match('/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/', $text) === 1
    ) {
        // DECIMAL arrives as a string from MySQL; emitting it bare keeps it exact.
        return $text;
    }

    return $quoter($text);
}

/**
 * PURE: strip the `DEFINER=`user`@`host`` clause (and downgrade
 * `SQL SECURITY DEFINER` to INVOKER) from a `SHOW CREATE
 * {VIEW,TRIGGER,PROCEDURE,FUNCTION}` body.
 *
 * WHY: the definer names an account that exists on THIS server. Restoring such a
 * statement as a different user -- which is the whole point of a backup -- fails
 * with "access denied; you need SUPER privileges", and on shared hosting the
 * restoring account never has them. mysqldump papers over this with version
 * guards; stripping is the equivalent that survives a phpMyAdmin import too.
 */
function avesmapsDbBackupStripDefiner(string $ddl): string
{
    $identifier = '(?:`(?:[^`]|``)*`|\'(?:[^\']|\'\')*\'|"(?:[^"]|"")*"|[^\s@]+)';
    $stripped = preg_replace(
        '/\sDEFINER\s*=\s*' . $identifier . '@' . $identifier . '/i',
        '',
        $ddl,
        1
    );
    if (!is_string($stripped)) {
        $stripped = $ddl;
    }

    $secured = preg_replace('/\sSQL\s+SECURITY\s+DEFINER/i', ' SQL SECURITY INVOKER', $stripped, 1);

    return is_string($secured) ? $secured : $stripped;
}

/**
 * PURE: is this table's CONTENT a rebuildable cache? See
 * AVESMAPS_DB_BACKUP_TRANSIENT_TABLES for why the list is deliberately tiny.
 */
function avesmapsDbBackupIsTransientTable(string $table): bool
{
    $name = strtolower(trim($table));
    if ($name === '') {
        return false;
    }

    if (in_array($name, AVESMAPS_DB_BACKUP_TRANSIENT_TABLES, true)) {
        return true;
    }

    return str_starts_with($name, 'wiki_') && str_ends_with($name, AVESMAPS_DB_BACKUP_TRANSIENT_SUFFIX);
}

/**
 * PURE: the backup's file name. Only `[a-z0-9-]` survives from the database name,
 * so the name can never carry a path separator no matter what the database is
 * called.
 */
function avesmapsDbBackupBuildFileName(string $databaseName, string $stamp): string
{
    $slug = trim(strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', $databaseName)), '-');
    if ($slug === '') {
        $slug = 'database';
    }

    $safeStamp = (string) preg_replace('/[^0-9A-Za-z-]+/', '', $stamp);

    return 'avesmaps-' . $slug . '-' . $safeStamp . '.sql.gz';
}

/**
 * PURE: whitelist a stored file name before it is joined to the storage directory.
 * Anything with a separator, a `..` or an unexpected character is rejected -- the
 * download and delete actions resolve their path through this, so a tampered run
 * row cannot become a path traversal.
 */
function avesmapsDbBackupIsSafeFileName(string $fileName): bool
{
    if ($fileName === '' || strlen($fileName) > 190) {
        return false;
    }

    if (preg_match('/^avesmaps-[A-Za-z0-9._-]+\.sql\.gz$/', $fileName) !== 1) {
        return false;
    }

    return !str_contains($fileName, '..');
}

/**
 * PURE: pick how a table's rows are paginated across steps.
 *
 * `keyset` (a single-column, non-binary PRIMARY KEY) is the only mode that is both
 * stable and cheap: `WHERE pk > :cursor ORDER BY pk LIMIT n` walks the index once
 * over the whole table. `offset` is the fallback for a composite key -- still
 * stable thanks to the ORDER BY, but quadratic, so it is used only where keyset
 * cannot apply. `scan` is for a table with no primary key at all: LIMIT/OFFSET
 * with no total order, which MySQL does not promise to be stable; the run records
 * a warning naming the table rather than pretending otherwise.
 *
 * @param list<string> $primaryKeyColumns ordered PRIMARY KEY column names
 * @param array<string, array{type:string}> $columns column meta keyed by name
 * @return array{mode:'keyset'|'offset'|'scan', column:?string, order:list<string>}
 */
function avesmapsDbBackupChooseCursorStrategy(array $primaryKeyColumns, array $columns): array
{
    if ($primaryKeyColumns === []) {
        return ['mode' => 'scan', 'column' => null, 'order' => []];
    }

    if (count($primaryKeyColumns) === 1) {
        $column = $primaryKeyColumns[0];
        // A byte-typed key cannot be round-tripped through the run row's text
        // cursor, so such a table paginates by offset instead.
        if (!avesmapsDbBackupIsBinaryColumnType((string) ($columns[$column]['type'] ?? ''))) {
            return ['mode' => 'keyset', 'column' => $column, 'order' => [$column]];
        }
    }

    return ['mode' => 'offset', 'column' => null, 'order' => $primaryKeyColumns];
}

/**
 * PURE: build the row-reading SELECT for one batch.
 *
 * @param array{mode:string, column:?string, order:list<string>} $strategy
 * @return array{sql:string, params:array<string, mixed>}
 */
function avesmapsDbBackupBuildRowSelect(
    string $table,
    array $columns,
    array $strategy,
    ?string $cursor,
    int $limit
): array {
    $columnList = implode(', ', array_map('avesmapsDbBackupQuoteIdentifier', array_keys($columns)));
    $quotedTable = avesmapsDbBackupQuoteIdentifier($table);
    $limit = max(1, $limit);

    if (($strategy['mode'] ?? '') === 'keyset') {
        $keyColumn = avesmapsDbBackupQuoteIdentifier((string) $strategy['column']);
        $where = $cursor === null ? '' : " WHERE {$keyColumn} > :cursor";

        return [
            'sql' => "SELECT {$columnList} FROM {$quotedTable}{$where} ORDER BY {$keyColumn} ASC LIMIT {$limit}",
            'params' => $cursor === null ? [] : ['cursor' => $cursor],
        ];
    }

    $offset = max(0, (int) ($cursor ?? '0'));
    $orderBy = '';
    if (($strategy['order'] ?? []) !== []) {
        $orderBy = ' ORDER BY '
            . implode(' ASC, ', array_map('avesmapsDbBackupQuoteIdentifier', $strategy['order']))
            . ' ASC';
    }

    return [
        'sql' => "SELECT {$columnList} FROM {$quotedTable}{$orderBy} LIMIT {$limit} OFFSET {$offset}",
        'params' => [],
    ];
}

/**
 * PURE: how many rows to fetch per batch for a table of this size.
 *
 * Derived from the average row size (data length / row count, both
 * information_schema estimates) against a fixed byte budget, then clamped. A table
 * of tiny rows keeps the full 500 -- fewer round-trips -- while a table of fat
 * wikitext or GeoJSON rows drops to a batch that still fits comfortably in memory.
 * Both inputs are estimates, so this is a heuristic and the clamps are what make it
 * safe: it can never ask for 0 rows (the run would loop forever) nor for more than
 * the fixed maximum.
 */
function avesmapsDbBackupRowsPerRead(int $dataBytes, int $tableRows): int
{
    if ($tableRows <= 0 || $dataBytes <= 0) {
        return AVESMAPS_DB_BACKUP_ROWS_PER_READ;
    }

    $averageRowBytes = (int) ceil($dataBytes / $tableRows);
    if ($averageRowBytes <= 0) {
        return AVESMAPS_DB_BACKUP_ROWS_PER_READ;
    }

    $rows = (int) floor(AVESMAPS_DB_BACKUP_ROW_BATCH_BUDGET_BYTES / $averageRowBytes);

    return max(
        AVESMAPS_DB_BACKUP_ROWS_PER_READ_MIN,
        min(AVESMAPS_DB_BACKUP_ROWS_PER_READ, $rows)
    );
}

/**
 * PURE: from one batch's result, decide the table's next row cursor and whether the
 * table is drained.
 *
 * 💣 This is the decision a wrong backup hides behind, so it is a pure function
 * with its own test rather than three lines inside the step. Two rules carry it:
 *   - a SHORT batch (fewer rows than asked for) means the table is drained, which
 *     is what spares every table one extra empty read;
 *   - a keyset cursor advances to the LAST row's key, and the next SELECT is
 *     strictly `>` that -- off by one either way and the dump silently skips or
 *     duplicates a row, visible only on a table big enough to span two steps.
 *
 * @param array{mode:string, column:?string} $strategy
 * @param list<array<string, mixed>> $rows the batch just fetched, in order
 * @return array{cursor:?string, drained:bool}
 */
function avesmapsDbBackupAdvanceRowCursor(array $strategy, ?string $cursor, array $rows, int $limit): array
{
    if ($rows === []) {
        return ['cursor' => $cursor, 'drained' => true];
    }

    $drained = count($rows) < max(1, $limit);

    if (($strategy['mode'] ?? '') === 'keyset') {
        $lastValue = $rows[count($rows) - 1][(string) ($strategy['column'] ?? '')] ?? null;
        if ($lastValue === null) {
            // A NULL in a PRIMARY KEY column is impossible in MySQL; if a driver ever
            // hands us one, finish the table rather than loop on the same cursor
            // forever.
            return ['cursor' => $cursor, 'drained' => true];
        }

        return [
            'cursor' => is_float($lastValue)
                ? avesmapsDbBackupFormatFloat($lastValue)
                : (string) $lastValue,
            'drained' => $drained,
        ];
    }

    return [
        'cursor' => (string) (max(0, (int) ($cursor ?? '0')) + count($rows)),
        'drained' => $drained,
    ];
}

/** PURE: the shared `INSERT INTO t (cols) VALUES` prefix for a batch. */
function avesmapsDbBackupBuildInsertPrefix(string $table, array $columns): string
{
    $columnList = implode(', ', array_map('avesmapsDbBackupQuoteIdentifier', array_keys($columns)));

    return 'INSERT INTO ' . avesmapsDbBackupQuoteIdentifier($table) . " ({$columnList}) VALUES\n";
}

/**
 * PURE: render one or more `INSERT` statements for a fetched batch, splitting
 * whenever the statement would exceed AVESMAPS_DB_BACKUP_STATEMENT_BYTES. A single
 * row larger than the cap still becomes its own statement -- the map's GeoJSON
 * geometry rows make that a real case.
 */
function avesmapsDbBackupRenderInsertBatch(
    string $table,
    array $columns,
    array $rows,
    callable $quoter
): string {
    $prefix = avesmapsDbBackupBuildInsertPrefix($table, $columns);
    $output = '';
    $statement = '';

    foreach ($rows as $row) {
        $literals = [];
        foreach ($columns as $columnName => $column) {
            $literals[] = avesmapsDbBackupFormatValue($row[$columnName] ?? null, $column, $quoter);
        }
        $tuple = '(' . implode(',', $literals) . ')';

        if ($statement === '') {
            $statement = $prefix . $tuple;
            continue;
        }

        if (strlen($statement) + strlen($tuple) + 2 > AVESMAPS_DB_BACKUP_STATEMENT_BYTES) {
            $output .= $statement . ";\n";
            $statement = $prefix . $tuple;
            continue;
        }

        $statement .= ",\n" . $tuple;
    }

    if ($statement !== '') {
        $output .= $statement . ";\n";
    }

    return $output;
}

/**
 * PURE: the dump's preamble. Mirrors mysqldump's version-guarded SET block so the
 * file behaves the same in the mysql CLI, in phpMyAdmin and in Workbench.
 * FOREIGN_KEY_CHECKS=0 is what lets tables be created and filled in an arbitrary
 * order; the trailer restores every value the header changed.
 *
 * @param array{database:string, generated_at:string, run_id:string, server_version:string, tables:int, include_transient:bool} $meta
 */
function avesmapsDbBackupFileHeader(array $meta): string
{
    $scope = ($meta['include_transient'] ?? true)
        ? 'complete (every table with its rows)'
        : 'without transient tables (WikiSync caches are structure-only)';

    $lines = [
        '-- Avesmaps database backup',
        '-- ---------------------------------------------------------------',
        '-- Source database : ' . (string) ($meta['database'] ?? ''),
        '-- Server version  : ' . (string) ($meta['server_version'] ?? ''),
        '-- Generated at    : ' . (string) ($meta['generated_at'] ?? '') . ' (UTC)',
        '-- Backup run      : ' . (string) ($meta['run_id'] ?? ''),
        '-- Base tables     : ' . (int) ($meta['tables'] ?? 0),
        '-- Scope           : ' . $scope,
        '--',
        '-- Restore into a database of your choice (the dump drops and recreates',
        '-- every object it contains and carries no CREATE DATABASE / USE, so it',
        '-- lands in whichever database the client has selected):',
        '--',
        '--   gunzip -c <this file> | mysql -u <user> -p <database>',
        '--',
        '-- Hot backup: the dump was read table by table across several requests,',
        '-- so it is stable within each table but is not a single point-in-time',
        '-- snapshot of the whole database.',
        '-- ---------------------------------------------------------------',
        '',
        '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
        '/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;',
        '/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;',
        '/*!40101 SET NAMES utf8mb4 */;',
        '/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;',
        "/*!40103 SET TIME_ZONE='+00:00' */;",
        '/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;',
        '/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;',
        "/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;",
        '/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;',
        'SET autocommit=0;',
        '',
    ];

    return implode("\n", $lines);
}

/**
 * PURE: the dump's trailer. Restores every session value the header changed,
 * commits the batched inserts, and ends with the marker the verify pass looks for
 * -- the marker is what distinguishes "the whole dump is here" from "the writer
 * died halfway".
 *
 * @param array{run_id:string, tables:int, rows:int} $meta
 */
function avesmapsDbBackupFileTrailer(array $meta): string
{
    $lines = [
        '',
        'COMMIT;',
        'SET autocommit=1;',
        '/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;',
        '/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;',
        '/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;',
        '/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;',
        '/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;',
        '/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;',
        '/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;',
        '/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;',
        '',
        sprintf(
            '%s run=%s tables=%d rows=%d',
            AVESMAPS_DB_BACKUP_END_MARKER,
            (string) ($meta['run_id'] ?? ''),
            (int) ($meta['tables'] ?? 0),
            (int) ($meta['rows'] ?? 0)
        ),
        '',
    ];

    return implode("\n", $lines);
}

/**
 * PURE: 0..100 progress for the UI. Rows dominate the work, so the bar is driven
 * by rows written against the planned row estimate, with the tail phases sharing
 * the last few percent. The estimate comes from information_schema and can be off,
 * so the value is clamped and never reports 100 before the run is complete.
 */
function avesmapsDbBackupProgressPercent(array $run): int
{
    if ((string) ($run['status'] ?? '') === 'completed') {
        return 100;
    }

    $phase = (string) ($run['phase'] ?? '');
    if (in_array($phase, ['views', 'triggers', 'routines', 'trailer'], true)) {
        return 96;
    }
    if ($phase === 'verify' || $phase === 'done') {
        return 98;
    }

    $total = max(1, (int) ($run['rows_total'] ?? 0));
    $written = max(0, (int) ($run['rows_written'] ?? 0));

    return max(0, min(95, (int) floor(($written / $total) * 95)));
}

// ===========================================================================
// PURE: the single-member gzip construction (see the file header, point 💣 1-3).
// ===========================================================================

/**
 * PURE: multiply the GF(2) matrix $matrix by the vector $vector -- the primitive
 * of zlib's crc32_combine. Each matrix row is a 32-bit word.
 */
function avesmapsDbBackupGf2MatrixTimes(array $matrix, int $vector): int
{
    $sum = 0;
    $index = 0;
    while ($vector !== 0 && $index < 32) {
        if (($vector & 1) === 1) {
            $sum ^= (int) ($matrix[$index] ?? 0);
        }
        // Logical shift: PHP's >> is arithmetic, so mask the sign bit away.
        $vector = ($vector >> 1) & 0x7fffffff;
        $index++;
    }

    return $sum & 0xffffffff;
}

/** PURE: square a GF(2) matrix (operator composition = doubling the length). */
function avesmapsDbBackupGf2MatrixSquare(array $matrix): array
{
    $square = array_fill(0, 32, 0);
    for ($n = 0; $n < 32; $n++) {
        $square[$n] = avesmapsDbBackupGf2MatrixTimes($matrix, (int) ($matrix[$n] ?? 0));
    }

    return $square;
}

/**
 * PURE: zlib's crc32_combine -- the CRC-32 of A.B from crc(A), crc(B) and
 * strlen(B), in O(log strlen(B)).
 *
 * This is what lets the gzip trailer be correct without ever re-reading the
 * payload: each step combines its fragment's own CRC onto the running one carried
 * in the run row. Verified against `hash('crc32b', $whole)` in the unit test, and
 * end-to-end by `gunzip -t`, which recomputes it.
 */
function avesmapsDbBackupCrc32Combine(int $crc1, int $crc2, int $length2): int
{
    if ($length2 <= 0) {
        return $crc1 & 0xffffffff;
    }

    // Operator for "one zero bit appended", then squared up to one byte and beyond.
    $odd = array_fill(0, 32, 0);
    $odd[0] = AVESMAPS_DB_BACKUP_CRC32_POLYNOMIAL;
    $row = 1;
    for ($n = 1; $n < 32; $n++) {
        $odd[$n] = $row;
        $row = ($row << 1) & 0xffffffff;
    }

    $even = avesmapsDbBackupGf2MatrixSquare($odd);   // 2 zero bits
    $odd = avesmapsDbBackupGf2MatrixSquare($even);   // 4 zero bits

    $crc1 &= 0xffffffff;
    while (true) {
        $even = avesmapsDbBackupGf2MatrixSquare($odd);
        if (($length2 & 1) === 1) {
            $crc1 = avesmapsDbBackupGf2MatrixTimes($even, $crc1);
        }
        $length2 >>= 1;
        if ($length2 === 0) {
            break;
        }

        $odd = avesmapsDbBackupGf2MatrixSquare($even);
        if (($length2 & 1) === 1) {
            $crc1 = avesmapsDbBackupGf2MatrixTimes($odd, $crc1);
        }
        $length2 >>= 1;
        if ($length2 === 0) {
            break;
        }
    }

    return ($crc1 ^ ($crc2 & 0xffffffff)) & 0xffffffff;
}

/** PURE: CRC-32 (gzip flavour) of a string, as an unsigned 32-bit int. */
function avesmapsDbBackupCrc32(string $data): int
{
    return (int) hexdec(hash('crc32b', $data)) & 0xffffffff;
}

/**
 * PURE: compress one chunk into a raw-deflate fragment that may be concatenated
 * with the fragments around it. A FRESH context plus ZLIB_SYNC_FLUSH is what makes
 * that legal -- see the file header. Never reuse a context here; the point is that
 * a fragment never references bytes outside its own chunk.
 */
function avesmapsDbBackupDeflateFragment(string $chunk): string
{
    $context = deflate_init(ZLIB_ENCODING_RAW, ['level' => AVESMAPS_DB_BACKUP_GZ_LEVEL]);
    if ($context === false) {
        throw new RuntimeException('Der Backup-Block konnte nicht komprimiert werden.');
    }

    $fragment = deflate_add($context, $chunk, ZLIB_SYNC_FLUSH);
    if (!is_string($fragment)) {
        throw new RuntimeException('Der Backup-Block konnte nicht komprimiert werden.');
    }

    return $fragment;
}

/**
 * PURE: the bytes that close the single gzip member -- a final empty deflate block
 * (BFINAL set, which the sync-flushed fragments never carry) followed by the gzip
 * trailer: CRC-32 and the uncompressed length mod 2^32, both little-endian.
 */
function avesmapsDbBackupGzipTerminator(int $crc, int $plainBytes): string
{
    $context = deflate_init(ZLIB_ENCODING_RAW, ['level' => AVESMAPS_DB_BACKUP_GZ_LEVEL]);
    if ($context === false) {
        throw new RuntimeException('Der Backup-Abschluss konnte nicht erzeugt werden.');
    }

    $finalBlock = deflate_add($context, '', ZLIB_FINISH);
    if (!is_string($finalBlock)) {
        throw new RuntimeException('Der Backup-Abschluss konnte nicht erzeugt werden.');
    }

    return $finalBlock
        . pack('V', $crc & 0xffffffff)
        . pack('V', $plainBytes % 4294967296);
}

// ===========================================================================
// Storage paths (pure string logic + the directory's self-healing protection).
// ===========================================================================

/**
 * Resolve the webroot (the directory containing api/). Prefers DOCUMENT_ROOT like
 * the rest of the codebase and falls back to three levels up from this file
 * (api/_internal/backup/db-dump.php -> webroot).
 */
function avesmapsDbBackupWebroot(): string
{
    $documentRoot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
    if ($documentRoot !== '' && is_dir($documentRoot)) {
        return $documentRoot;
    }

    return dirname(__DIR__, 3);
}

/** Absolute path of the backup storage directory. */
function avesmapsDbBackupStorageDir(): string
{
    return avesmapsDbBackupWebroot() . '/' . AVESMAPS_DB_BACKUP_STORAGE_SUBDIR;
}

/**
 * Absolute path of one backup file, or null if the stored name fails the
 * whitelist. Every filesystem action goes through here, so an unexpected name is a
 * refusal rather than a traversal.
 */
function avesmapsDbBackupFilePath(string $fileName): ?string
{
    if (!avesmapsDbBackupIsSafeFileName($fileName)) {
        return null;
    }

    return avesmapsDbBackupStorageDir() . '/' . $fileName;
}

/**
 * Create the storage directory and (re)write its deny-all .htaccess. The deploy
 * allowlist does not carry uploads/, so this protection is self-healed at run time
 * -- exactly as uploads/dumps does it.
 */
function avesmapsDbBackupEnsureStorageDir(): string
{
    $dir = avesmapsDbBackupStorageDir();
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException('Das Backup-Verzeichnis konnte nicht angelegt werden.');
    }

    $htaccessPath = $dir . '/.htaccess';
    $expected = "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n\n"
        . "<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n";

    if (!is_file($htaccessPath) || @file_get_contents($htaccessPath) !== $expected) {
        @file_put_contents($htaccessPath, $expected);
    }

    return $dir;
}

// ===========================================================================
// Self-healing run-state table.
// ===========================================================================

/**
 * Idempotently create the run table (schema-in-code convention). One row per
 * backup run: the phase/object/row cursors that make a step resumable, the byte
 * counters and CRC the gzip trailer and the crash reconcile need, and the frozen
 * plan.
 */
function avesmapsDbBackupEnsureTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ' . AVESMAPS_DB_BACKUP_RUN_TABLE . ' (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            public_id CHAR(36) NOT NULL,
            status VARCHAR(12) NOT NULL DEFAULT \'running\',
            phase VARCHAR(16) NOT NULL DEFAULT \'header\',
            file_name VARCHAR(190) NOT NULL DEFAULT \'\',
            include_transient TINYINT(1) NOT NULL DEFAULT 1,
            object_index INT UNSIGNED NOT NULL DEFAULT 0,
            object_name VARCHAR(190) NOT NULL DEFAULT \'\',
            object_stage VARCHAR(12) NOT NULL DEFAULT \'ddl\',
            row_cursor VARCHAR(255) NULL DEFAULT NULL,
            rows_written BIGINT UNSIGNED NOT NULL DEFAULT 0,
            rows_total BIGINT UNSIGNED NOT NULL DEFAULT 0,
            tables_total INT UNSIGNED NOT NULL DEFAULT 0,
            tables_done INT UNSIGNED NOT NULL DEFAULT 0,
            plain_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
            gz_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
            plain_crc32 BIGINT UNSIGNED NOT NULL DEFAULT 0,
            fragment_count INT UNSIGNED NOT NULL DEFAULT 0,
            steps_done INT UNSIGNED NOT NULL DEFAULT 0,
            verify_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
            plan MEDIUMTEXT NULL,
            warnings TEXT NULL,
            error VARCHAR(500) NOT NULL DEFAULT \'\',
            created_by BIGINT UNSIGNED NULL DEFAULT NULL,
            created_by_name VARCHAR(190) NOT NULL DEFAULT \'\',
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            heartbeat_at DATETIME(3) NULL DEFAULT NULL,
            finished_at DATETIME(3) NULL DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_db_backup_run_public_id (public_id),
            KEY idx_db_backup_run_status (status, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

// ===========================================================================
// Schema discovery (the frozen plan).
// ===========================================================================

/** The connected database's name -- the plan's scope and the file name's stem. */
function avesmapsDbBackupDatabaseName(PDO $pdo): string
{
    $name = $pdo->query('SELECT DATABASE()')->fetchColumn();

    return is_string($name) ? $name : '';
}

/**
 * Base tables with an information_schema row estimate and data size. Both are
 * ESTIMATES for InnoDB -- they feed the progress bar and the adaptive batch size,
 * never a correctness decision, because an exact `SELECT COUNT(*)` per table would
 * scan the whole database before the dump even starts.
 *
 * @return list<array{name:string, rows:int, data_bytes:int}>
 */
function avesmapsDbBackupListBaseTables(PDO $pdo, string $databaseName): array
{
    $statement = $pdo->prepare(
        'SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = :db AND TABLE_TYPE = \'BASE TABLE\'
         ORDER BY TABLE_NAME ASC'
    );
    $statement->execute(['db' => $databaseName]);

    $tables = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $tables[] = [
            'name' => (string) $row['TABLE_NAME'],
            'rows' => (int) ($row['TABLE_ROWS'] ?? 0),
            // DATA_LENGTH only (no index length): this is the divisor for the average
            // ROW size, and indexes are not rows.
            'data_bytes' => (int) ($row['DATA_LENGTH'] ?? 0),
        ];
    }

    return $tables;
}

/** @return list<string> view names, dumped after every base table exists. */
function avesmapsDbBackupListViews(PDO $pdo, string $databaseName): array
{
    $statement = $pdo->prepare(
        'SELECT TABLE_NAME FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA = :db ORDER BY TABLE_NAME ASC'
    );
    $statement->execute(['db' => $databaseName]);

    return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
}

/** @return list<string> trigger names. */
function avesmapsDbBackupListTriggers(PDO $pdo, string $databaseName): array
{
    $statement = $pdo->prepare(
        'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = :db ORDER BY TRIGGER_NAME ASC'
    );
    $statement->execute(['db' => $databaseName]);

    return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
}

/** @return list<array{name:string, type:string}> stored procedures and functions. */
function avesmapsDbBackupListRoutines(PDO $pdo, string $databaseName): array
{
    $statement = $pdo->prepare(
        'SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = :db ORDER BY ROUTINE_TYPE ASC, ROUTINE_NAME ASC'
    );
    $statement->execute(['db' => $databaseName]);

    $routines = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $routines[] = [
            'name' => (string) $row['ROUTINE_NAME'],
            'type' => strtoupper((string) $row['ROUTINE_TYPE']) === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE',
        ];
    }

    return $routines;
}

/**
 * Columns of one table, keyed by name in ordinal order, with generated columns
 * REMOVED -- the returned map is exactly the INSERT column list.
 *
 * @return array<string, array{type:string, extra:string}>
 */
function avesmapsDbBackupTableColumns(PDO $pdo, string $table): array
{
    $statement = $pdo->query('SHOW COLUMNS FROM ' . avesmapsDbBackupQuoteIdentifier($table));

    $columns = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $extra = (string) ($row['Extra'] ?? '');
        if (avesmapsDbBackupIsGeneratedColumn($extra)) {
            continue;
        }

        $columns[(string) $row['Field']] = [
            'type' => (string) ($row['Type'] ?? ''),
            'extra' => $extra,
        ];
    }

    return $columns;
}

/** @return list<string> the table's PRIMARY KEY columns in key order. */
function avesmapsDbBackupTablePrimaryKey(PDO $pdo, string $table): array
{
    $statement = $pdo->query('SHOW KEYS FROM ' . avesmapsDbBackupQuoteIdentifier($table));

    $keyColumns = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        if ((string) ($row['Key_name'] ?? '') !== 'PRIMARY') {
            continue;
        }
        $keyColumns[(int) ($row['Seq_in_index'] ?? 0)] = (string) ($row['Column_name'] ?? '');
    }

    ksort($keyColumns);

    return array_values(array_filter($keyColumns, static fn(string $name): bool => $name !== ''));
}

// ===========================================================================
// Run lifecycle.
// ===========================================================================

/** Read one run row by public id, or null. */
function avesmapsDbBackupReadRun(PDO $pdo, string $publicId): ?array
{
    avesmapsDbBackupEnsureTable($pdo);

    $statement = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_DB_BACKUP_RUN_TABLE . ' WHERE public_id = :pid LIMIT 1'
    );
    $statement->execute(['pid' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return is_array($row) ? $row : null;
}

/**
 * The newest `running` run with a live heartbeat, or null. Used both to reject a
 * second concurrent backup and to let the page reattach to a run in progress after
 * a reload.
 */
function avesmapsDbBackupFindLiveRun(PDO $pdo): ?array
{
    avesmapsDbBackupEnsureTable($pdo);

    $statement = $pdo->prepare(
        'SELECT * FROM ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
         WHERE status = \'running\'
           AND heartbeat_at IS NOT NULL
           AND heartbeat_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :stale SECOND)
         ORDER BY id DESC LIMIT 1'
    );
    $statement->execute(['stale' => AVESMAPS_DB_BACKUP_STALE_SECONDS]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return is_array($row) ? $row : null;
}

/**
 * Mark every `running` run whose heartbeat went stale as failed. A backup run has
 * no natural end if the driving browser tab is closed mid-loop, so without this one
 * abandoned run would block every future backup forever.
 */
function avesmapsDbBackupReapStaleRuns(PDO $pdo): int
{
    avesmapsDbBackupEnsureTable($pdo);

    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
         SET status = \'failed\',
             error = \'Der Lauf wurde abgebrochen (kein Fortschritt mehr).\',
             finished_at = CURRENT_TIMESTAMP(3)
         WHERE status = \'running\'
           AND (heartbeat_at IS NULL
                OR heartbeat_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :stale SECOND))'
    );
    $statement->execute(['stale' => AVESMAPS_DB_BACKUP_STALE_SECONDS]);

    return $statement->rowCount();
}

/** RFC-4122-shaped run id (the shape the other run tables in this repo use). */
function avesmapsDbBackupGenerateUuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

/**
 * Start a run: freeze the plan (tables + views + triggers + routines) and create
 * the empty output file. The gzip header and the SQL preamble are the first
 * step's work, so `start` stays cheap and the loop that follows is uniform.
 *
 * @param array{id?:int, username?:string} $user
 * @throws DbBackupBusyException if another backup is already running
 */
function avesmapsDbBackupStartRun(PDO $pdo, array $user, bool $includeTransient): array
{
    avesmapsDbBackupEnsureTable($pdo);
    avesmapsDbBackupReapStaleRuns($pdo);

    $liveRun = avesmapsDbBackupFindLiveRun($pdo);
    if ($liveRun !== null) {
        throw new DbBackupBusyException((string) ($liveRun['created_by_name'] ?? ''));
    }

    avesmapsDbBackupEnsureStorageDir();

    $databaseName = avesmapsDbBackupDatabaseName($pdo);
    if ($databaseName === '') {
        throw new RuntimeException('Die Datenbank konnte nicht bestimmt werden.');
    }

    $tables = [];
    $rowsTotal = 0;
    foreach (avesmapsDbBackupListBaseTables($pdo, $databaseName) as $table) {
        $structureOnly = !$includeTransient && avesmapsDbBackupIsTransientTable($table['name']);
        $tables[] = [
            'name' => $table['name'],
            'rows' => $table['rows'],
            'data_bytes' => $table['data_bytes'],
            'structure_only' => $structureOnly,
        ];
        if (!$structureOnly) {
            $rowsTotal += $table['rows'];
        }
    }

    if ($tables === []) {
        throw new RuntimeException('Die Datenbank enthaelt keine Tabellen.');
    }

    // Optional objects: a shared-hosting account may lack the privileges to list
    // them. That must not sink the backup, so each lookup is best-effort and its
    // failure becomes a warning recorded on the run (and shown in the UI).
    $warnings = [];
    $views = [];
    $triggers = [];
    $routines = [];
    try {
        $views = avesmapsDbBackupListViews($pdo, $databaseName);
    } catch (Throwable $exception) {
        $warnings[] = 'Views konnten nicht gelistet werden (fehlende Rechte?).';
    }
    try {
        $triggers = avesmapsDbBackupListTriggers($pdo, $databaseName);
    } catch (Throwable $exception) {
        $warnings[] = 'Trigger konnten nicht gelistet werden (fehlende Rechte?).';
    }
    try {
        $routines = avesmapsDbBackupListRoutines($pdo, $databaseName);
    } catch (Throwable $exception) {
        $warnings[] = 'Prozeduren/Funktionen konnten nicht gelistet werden (fehlende Rechte?).';
    }

    $publicId = avesmapsDbBackupGenerateUuid();
    $fileName = avesmapsDbBackupBuildFileName($databaseName, gmdate('Ymd-His'));
    $filePath = avesmapsDbBackupFilePath($fileName);
    if ($filePath === null) {
        throw new RuntimeException('Der Backup-Dateiname ist ungueltig.');
    }

    // Truncate/create so a re-used name can never inherit a previous body.
    if (@file_put_contents($filePath, '') === false) {
        throw new RuntimeException('Die Backup-Datei konnte nicht angelegt werden.');
    }

    $serverVersion = '';
    try {
        $serverVersion = (string) $pdo->getAttribute(PDO::ATTR_SERVER_VERSION);
    } catch (Throwable $exception) {
        $serverVersion = '';
    }

    // Scalars and short name lists only. The 99 MiB wiki_sync_runs accident (see
    // dump-report.php) is what this note is here to prevent: a plan JSON is a
    // manifest, never a scratchpad for records.
    $plan = [
        'database' => $databaseName,
        'server_version' => $serverVersion,
        'generated_at' => gmdate('Y-m-d H:i:s'),
        'include_transient' => $includeTransient,
        'tables' => $tables,
        'views' => $views,
        'triggers' => $triggers,
        'routines' => $routines,
    ];

    $statement = $pdo->prepare(
        'INSERT INTO ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
            (public_id, status, phase, file_name, include_transient, rows_total, tables_total,
             plan, warnings, created_by, created_by_name, created_at, heartbeat_at)
         VALUES
            (:pid, \'running\', \'header\', :file_name, :include_transient, :rows_total, :tables_total,
             :plan, :warnings, :created_by, :created_by_name, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))'
    );
    $statement->execute([
        'pid' => $publicId,
        'file_name' => $fileName,
        'include_transient' => $includeTransient ? 1 : 0,
        'rows_total' => $rowsTotal,
        'tables_total' => count($tables),
        'plan' => json_encode($plan, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'warnings' => json_encode($warnings, JSON_UNESCAPED_UNICODE),
        'created_by' => (int) ($user['id'] ?? 0) ?: null,
        'created_by_name' => (string) ($user['username'] ?? ''),
    ]);

    $run = avesmapsDbBackupReadRun($pdo, $publicId);
    if ($run === null) {
        throw new RuntimeException('Der Backup-Lauf konnte nicht angelegt werden.');
    }

    return $run;
}

/** Decode the frozen plan of a run row. */
function avesmapsDbBackupDecodePlan(array $run): array
{
    $plan = json_decode((string) ($run['plan'] ?? ''), true);

    return is_array($plan) ? $plan : [];
}

/** Decode the recorded warnings of a run row. */
function avesmapsDbBackupDecodeWarnings(array $run): array
{
    $warnings = json_decode((string) ($run['warnings'] ?? ''), true);

    return is_array($warnings) ? array_values(array_map('strval', $warnings)) : [];
}

// ===========================================================================
// Output: appended deflate fragments inside ONE gzip member.
// ===========================================================================

/**
 * Append one deflate fragment (plus the gzip header, if this is the first write)
 * and return how many compressed bytes were added. The caller persists the
 * returned size together with the new CRC -- see the file header's CRASH
 * RECONCILIATION note for why that order matters.
 */
function avesmapsDbBackupAppendFragment(string $filePath, string $sql, bool $isFirstWrite): int
{
    $bytes = ($isFirstWrite ? AVESMAPS_DB_BACKUP_GZIP_HEADER : '')
        . avesmapsDbBackupDeflateFragment($sql);

    if (@file_put_contents($filePath, $bytes, FILE_APPEND | LOCK_EX) === false) {
        throw new RuntimeException('Der Backup-Block konnte nicht geschrieben werden.');
    }

    return strlen($bytes);
}

/** Append the final block + gzip trailer, closing the member. */
function avesmapsDbBackupAppendTerminator(string $filePath, int $crc, int $plainBytes): int
{
    $bytes = avesmapsDbBackupGzipTerminator($crc, $plainBytes);

    if (@file_put_contents($filePath, $bytes, FILE_APPEND | LOCK_EX) === false) {
        throw new RuntimeException('Der Backup-Abschluss konnte nicht geschrieben werden.');
    }

    return strlen($bytes);
}

/**
 * Reconcile the file against the run row's gz_bytes before a step writes anything:
 * a file longer than gz_bytes means a previous step appended but died before
 * persisting, so those bytes must go or the replay would emit their INSERTs twice.
 * See the file header's CRASH RECONCILIATION note -- truncating at a fragment
 * boundary is exact.
 *
 * @return int the number of orphaned bytes dropped
 */
function avesmapsDbBackupReconcileFile(string $filePath, int $persistedBytes): int
{
    clearstatcache(true, $filePath);
    $actual = is_file($filePath) ? (int) filesize($filePath) : 0;
    if ($actual <= $persistedBytes) {
        return 0;
    }

    $handle = @fopen($filePath, 'r+b');
    if ($handle === false) {
        throw new RuntimeException('Die Backup-Datei konnte nicht bereinigt werden.');
    }

    $truncated = @ftruncate($handle, $persistedBytes);
    @fclose($handle);
    clearstatcache(true, $filePath);

    if ($truncated !== true) {
        throw new RuntimeException('Die Backup-Datei konnte nicht bereinigt werden.');
    }

    return $actual - $persistedBytes;
}

// ===========================================================================
// The step engine.
// ===========================================================================

/**
 * Run ONE bounded step of a backup and return the progress the client loops on.
 *
 * The phase order is header -> tables -> views -> triggers -> routines -> trailer
 * -> verify -> (status completed). Within `tables`, each table walks three stages:
 * `ddl` (DROP + CREATE + DISABLE KEYS), `rows` (INSERT batches, one paginated
 * SELECT at a time), `post` (ENABLE KEYS). Every cursor lives in the run row, so
 * the next request continues exactly where this one stopped.
 *
 * @return array{run:array, done:bool, progress:array}
 */
function avesmapsDbBackupStep(PDO $pdo, string $publicId): array
{
    $run = avesmapsDbBackupReadRun($pdo, $publicId);
    if ($run === null) {
        throw new InvalidArgumentException('Der Backup-Lauf ist unbekannt.');
    }
    if ((string) $run['status'] !== 'running') {
        return avesmapsDbBackupProgressPayload($run);
    }

    $filePath = avesmapsDbBackupFilePath((string) $run['file_name']);
    if ($filePath === null) {
        throw new RuntimeException('Der Backup-Dateiname ist ungueltig.');
    }

    $plan = avesmapsDbBackupDecodePlan($run);
    $warnings = avesmapsDbBackupDecodeWarnings($run);

    avesmapsDbBackupReconcileFile($filePath, (int) $run['gz_bytes']);
    avesmapsDbBackupHeartbeat($pdo, $publicId);

    @set_time_limit(AVESMAPS_DB_BACKUP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_DB_BACKUP_STEP_SECONDS - 3);

    // The verify phase reads the finished file instead of appending to it, so it is
    // handled before the writer loop -- and always as a whole step.
    if ((string) $run['phase'] === 'verify') {
        return avesmapsDbBackupRunVerify($pdo, $run, $filePath, $warnings, $deadline);
    }

    $buffer = '';
    $quoter = static fn(string $value): string => $pdo->quote($value);
    $closeMember = false;

    // Flush the buffer as a deflate fragment. A step may flush SEVERAL times so it
    // can use its whole time budget instead of ending at the first 4 MiB -- which
    // cuts the number of HTTP round-trips a large dump needs by an order of
    // magnitude. Safe because nothing is PERSISTED until the step ends: if the
    // process dies after three flushes, the next step's reconcile truncates all
    // three away and replays from the last persisted cursor.
    $flush = static function () use (&$buffer, &$run, $filePath): void {
        if ($buffer === '') {
            return;
        }

        $isFirstWrite = (int) $run['gz_bytes'] === 0;
        $run['gz_bytes'] = (int) $run['gz_bytes']
            + avesmapsDbBackupAppendFragment($filePath, $buffer, $isFirstWrite);
        $run['plain_crc32'] = avesmapsDbBackupCrc32Combine(
            (int) $run['plain_crc32'],
            avesmapsDbBackupCrc32($buffer),
            strlen($buffer)
        );
        $run['plain_bytes'] = (int) $run['plain_bytes'] + strlen($buffer);
        $run['fragment_count'] = (int) $run['fragment_count'] + 1;
        $buffer = '';
    };

    while ((string) $run['phase'] !== 'verify' && microtime(true) < $deadline) {
        switch ((string) $run['phase']) {
            case 'header':
                $buffer .= avesmapsDbBackupFileHeader([
                    'database' => (string) ($plan['database'] ?? ''),
                    'server_version' => (string) ($plan['server_version'] ?? ''),
                    'generated_at' => (string) ($plan['generated_at'] ?? ''),
                    'run_id' => (string) $run['public_id'],
                    'tables' => (int) $run['tables_total'],
                    'include_transient' => (bool) (int) $run['include_transient'],
                ]);
                $run['phase'] = 'tables';
                $run['object_index'] = 0;
                $run['object_stage'] = 'ddl';
                break;

            case 'tables':
                avesmapsDbBackupStepTables($pdo, $run, $plan, $warnings, $buffer, $quoter);
                break;

            case 'views':
                avesmapsDbBackupStepViews($pdo, $run, $plan, $warnings, $buffer);
                break;

            case 'triggers':
                avesmapsDbBackupStepTriggers($pdo, $run, $plan, $warnings, $buffer);
                break;

            case 'routines':
                avesmapsDbBackupStepRoutines($pdo, $run, $plan, $warnings, $buffer);
                break;

            case 'trailer':
                $buffer .= avesmapsDbBackupFileTrailer([
                    'run_id' => (string) $run['public_id'],
                    'tables' => (int) $run['tables_done'],
                    'rows' => (int) $run['rows_written'],
                ]);
                // The trailer is the last SQL in the file, so this step also closes
                // the gzip member and hands the run to the verify phase.
                $run['phase'] = 'verify';
                $closeMember = true;
                break;

            default:
                throw new RuntimeException('Unbekannte Backup-Phase.');
        }

        if (strlen($buffer) >= AVESMAPS_DB_BACKUP_FRAGMENT_BYTES) {
            $flush();
        }
    }

    $flush();

    if ($closeMember) {
        $run['gz_bytes'] = (int) $run['gz_bytes'] + avesmapsDbBackupAppendTerminator(
            $filePath,
            (int) $run['plain_crc32'],
            (int) $run['plain_bytes']
        );
    }

    $run['steps_done'] = (int) $run['steps_done'] + 1;
    avesmapsDbBackupPersistRun($pdo, $run, $warnings);

    return avesmapsDbBackupProgressPayload($run, $warnings);
}

/**
 * One unit of work in the `tables` phase: either a table's DDL, or one batch of its
 * rows, or its closing statement. Mutates $run (cursors) and appends to $buffer.
 */
function avesmapsDbBackupStepTables(
    PDO $pdo,
    array &$run,
    array $plan,
    array &$warnings,
    string &$buffer,
    callable $quoter
): void {
    $tables = is_array($plan['tables'] ?? null) ? array_values($plan['tables']) : [];
    $index = (int) $run['object_index'];

    if ($index >= count($tables)) {
        $run['phase'] = 'views';
        $run['object_index'] = 0;
        $run['object_stage'] = 'ddl';
        $run['object_name'] = '';
        $run['row_cursor'] = null;
        return;
    }

    $table = is_array($tables[$index]) ? $tables[$index] : [];
    $tableName = (string) ($table['name'] ?? '');
    $structureOnly = (bool) ($table['structure_only'] ?? false);
    $run['object_name'] = $tableName;
    $quotedTable = avesmapsDbBackupQuoteIdentifier($tableName);

    if ((string) $run['object_stage'] === 'ddl') {
        $createRow = $pdo->query('SHOW CREATE TABLE ' . $quotedTable)->fetch(PDO::FETCH_ASSOC);
        $createSql = is_array($createRow) ? (string) ($createRow['Create Table'] ?? '') : '';
        if ($createSql === '') {
            throw new RuntimeException('CREATE TABLE fehlt fuer ' . $tableName . '.');
        }

        $buffer .= "\n-- ---------------------------------------------------------------\n"
            . '-- Table: ' . $tableName . ($structureOnly ? '  (structure only)' : '') . "\n"
            . "-- ---------------------------------------------------------------\n"
            . 'DROP TABLE IF EXISTS ' . $quotedTable . ";\n"
            . $createSql . ";\n";

        if ($structureOnly) {
            $buffer .= '-- Rows skipped: rebuildable WikiSync cache.' . "\n";
            $run['object_stage'] = 'post';
            return;
        }

        // Harmless on InnoDB, a large win on MyISAM -- the pair mysqldump wraps its
        // inserts in.
        $buffer .= '/*!40000 ALTER TABLE ' . $quotedTable . ' DISABLE KEYS */;' . "\n";
        $run['object_stage'] = 'rows';
        $run['row_cursor'] = null;
        return;
    }

    if ((string) $run['object_stage'] === 'rows') {
        $columns = avesmapsDbBackupTableColumns($pdo, $tableName);
        if ($columns === []) {
            // Every column is generated (or there are none): nothing is insertable,
            // so the CREATE alone restores the table faithfully.
            $run['object_stage'] = 'post';
            return;
        }

        $strategy = avesmapsDbBackupChooseCursorStrategy(
            avesmapsDbBackupTablePrimaryKey($pdo, $tableName),
            $columns
        );
        if ($strategy['mode'] === 'scan') {
            $warning = 'Tabelle ' . $tableName
                . ' hat keinen Primaerschluessel; die Zeilenreihenfolge ist nicht garantiert.';
            if (!in_array($warning, $warnings, true)) {
                $warnings[] = $warning;
            }
        }

        $rowsPerRead = avesmapsDbBackupRowsPerRead(
            (int) ($table['data_bytes'] ?? 0),
            (int) ($table['rows'] ?? 0)
        );
        $cursor = $run['row_cursor'] === null ? null : (string) $run['row_cursor'];
        $select = avesmapsDbBackupBuildRowSelect(
            $tableName,
            $columns,
            $strategy,
            $cursor,
            $rowsPerRead
        );

        $statement = $pdo->prepare($select['sql']);
        $statement->execute($select['params']);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        if ($rows === []) {
            $run['object_stage'] = 'post';
            return;
        }

        $buffer .= avesmapsDbBackupRenderInsertBatch($tableName, $columns, $rows, $quoter);
        $run['rows_written'] = (int) $run['rows_written'] + count($rows);

        $advanced = avesmapsDbBackupAdvanceRowCursor($strategy, $cursor, $rows, $rowsPerRead);
        $run['row_cursor'] = $advanced['cursor'];
        if ($advanced['drained']) {
            $run['object_stage'] = 'post';
        }

        return;
    }

    // object_stage === 'post'
    if (!$structureOnly) {
        $buffer .= '/*!40000 ALTER TABLE ' . $quotedTable . ' ENABLE KEYS */;' . "\n";
    }
    $run['tables_done'] = (int) $run['tables_done'] + 1;
    $run['object_index'] = $index + 1;
    $run['object_stage'] = 'ddl';
    $run['row_cursor'] = null;

    if ((int) $run['object_index'] >= count($tables)) {
        $run['phase'] = 'views';
        $run['object_index'] = 0;
        $run['object_name'] = '';
    }
}

/**
 * One view per call. Views are emitted after every base table so their referenced
 * tables already exist. A view built on ANOTHER view still depends on plan order,
 * which is alphabetical -- recorded here as a known limit rather than silently
 * assumed, because this database has no views today and the day it gets two
 * dependent ones is the day that assumption matters.
 */
function avesmapsDbBackupStepViews(PDO $pdo, array &$run, array $plan, array &$warnings, string &$buffer): void
{
    $views = is_array($plan['views'] ?? null) ? array_values($plan['views']) : [];
    $index = (int) $run['object_index'];

    if ($index >= count($views)) {
        $run['phase'] = 'triggers';
        $run['object_index'] = 0;
        $run['object_name'] = '';
        return;
    }

    $view = (string) $views[$index];
    $run['object_name'] = $view;
    $quotedView = avesmapsDbBackupQuoteIdentifier($view);

    try {
        $row = $pdo->query('SHOW CREATE VIEW ' . $quotedView)->fetch(PDO::FETCH_ASSOC);
        $createSql = is_array($row) ? (string) ($row['Create View'] ?? '') : '';
        if ($createSql === '') {
            throw new RuntimeException('empty');
        }

        $buffer .= "\n-- View: " . $view . "\n"
            . 'DROP VIEW IF EXISTS ' . $quotedView . ";\n"
            . avesmapsDbBackupStripDefiner($createSql) . ";\n";
    } catch (Throwable $exception) {
        $warnings[] = 'View ' . $view . ' konnte nicht gesichert werden.';
    }

    $run['object_index'] = $index + 1;
    if ((int) $run['object_index'] >= count($views)) {
        $run['phase'] = 'triggers';
        $run['object_index'] = 0;
        $run['object_name'] = '';
    }
}

/**
 * One trigger per call. Trigger bodies contain `;`, so each is wrapped in a
 * `DELIMITER` block -- the client-side directive the mysql CLI and phpMyAdmin both
 * understand. Without it the restore breaks apart mid-body.
 */
function avesmapsDbBackupStepTriggers(PDO $pdo, array &$run, array $plan, array &$warnings, string &$buffer): void
{
    $triggers = is_array($plan['triggers'] ?? null) ? array_values($plan['triggers']) : [];
    $index = (int) $run['object_index'];

    if ($index >= count($triggers)) {
        $run['phase'] = 'routines';
        $run['object_index'] = 0;
        $run['object_name'] = '';
        return;
    }

    $trigger = (string) $triggers[$index];
    $run['object_name'] = $trigger;
    $quotedTrigger = avesmapsDbBackupQuoteIdentifier($trigger);

    try {
        $row = $pdo->query('SHOW CREATE TRIGGER ' . $quotedTrigger)->fetch(PDO::FETCH_ASSOC);
        $createSql = is_array($row) ? (string) ($row['SQL Original Statement'] ?? '') : '';
        if ($createSql === '') {
            throw new RuntimeException('empty');
        }

        $buffer .= "\n-- Trigger: " . $trigger . "\n"
            . 'DROP TRIGGER IF EXISTS ' . $quotedTrigger . ";\n"
            . "DELIMITER ;;\n"
            . avesmapsDbBackupStripDefiner($createSql) . ";;\n"
            . "DELIMITER ;\n";
    } catch (Throwable $exception) {
        $warnings[] = 'Trigger ' . $trigger . ' konnte nicht gesichert werden.';
    }

    $run['object_index'] = $index + 1;
    if ((int) $run['object_index'] >= count($triggers)) {
        $run['phase'] = 'routines';
        $run['object_index'] = 0;
        $run['object_name'] = '';
    }
}

/** One stored routine per call, in the same DELIMITER wrapping as triggers. */
function avesmapsDbBackupStepRoutines(PDO $pdo, array &$run, array $plan, array &$warnings, string &$buffer): void
{
    $routines = is_array($plan['routines'] ?? null) ? array_values($plan['routines']) : [];
    $index = (int) $run['object_index'];

    if ($index >= count($routines)) {
        $run['phase'] = 'trailer';
        $run['object_index'] = 0;
        $run['object_name'] = '';
        return;
    }

    $routine = is_array($routines[$index]) ? $routines[$index] : [];
    $name = (string) ($routine['name'] ?? '');
    $type = strtoupper((string) ($routine['type'] ?? 'PROCEDURE')) === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
    $run['object_name'] = $name;
    $quotedName = avesmapsDbBackupQuoteIdentifier($name);

    try {
        $row = $pdo->query('SHOW CREATE ' . $type . ' ' . $quotedName)->fetch(PDO::FETCH_ASSOC);
        $createSql = is_array($row)
            ? (string) ($row[$type === 'FUNCTION' ? 'Create Function' : 'Create Procedure'] ?? '')
            : '';
        if ($createSql === '') {
            throw new RuntimeException('empty');
        }

        $buffer .= "\n-- " . $type . ': ' . $name . "\n"
            . 'DROP ' . $type . ' IF EXISTS ' . $quotedName . ";\n"
            . "DELIMITER ;;\n"
            . avesmapsDbBackupStripDefiner($createSql) . ";;\n"
            . "DELIMITER ;\n";
    } catch (Throwable $exception) {
        $warnings[] = $type . ' ' . $name . ' konnte nicht gesichert werden.';
    }

    $run['object_index'] = $index + 1;
    if ((int) $run['object_index'] >= count($routines)) {
        $run['phase'] = 'trailer';
        $run['object_index'] = 0;
        $run['object_name'] = '';
    }
}

/**
 * The verify phase: inflate the finished file end-to-end and require that it
 * decodes cleanly, that the decompressed length equals the bytes compressed, that
 * its CRC-32 matches the accumulated one, and that the last line is the END
 * marker. Only then does the run become `completed`.
 *
 * This is what turns "the loop stopped" into "this file restores". Inflation cannot
 * be resumed mid-stream, so a step that runs out of time simply restarts the pass
 * (pure CPU, idempotent); after AVESMAPS_DB_BACKUP_VERIFY_MAX_ATTEMPTS restarts the
 * run completes with a warning instead of looping forever.
 */
function avesmapsDbBackupRunVerify(
    PDO $pdo,
    array $run,
    string $filePath,
    array $warnings,
    float $deadline
): array {
    $attempts = (int) $run['verify_attempts'] + 1;
    $run['verify_attempts'] = $attempts;

    $handle = @gzopen($filePath, 'rb');
    if ($handle === false) {
        throw new RuntimeException('Die Backup-Datei konnte nicht zur Pruefung geoeffnet werden.');
    }

    $crcContext = hash_init('crc32b');
    $decompressed = 0;
    $tail = '';
    $timedOut = false;

    while (!gzeof($handle)) {
        $chunk = gzread($handle, AVESMAPS_DB_BACKUP_VERIFY_CHUNK_BYTES);
        if ($chunk === false) {
            gzclose($handle);
            throw new RuntimeException('Die Backup-Datei ist nicht lesbar (gzip-Fehler).');
        }
        if ($chunk === '') {
            break;
        }

        hash_update($crcContext, $chunk);
        $decompressed += strlen($chunk);
        // Keep just enough tail to hold the marker line.
        $tail = substr($tail . $chunk, -512);

        if (microtime(true) >= $deadline) {
            $timedOut = true;
            break;
        }
    }
    gzclose($handle);

    if ($timedOut) {
        if ($attempts >= AVESMAPS_DB_BACKUP_VERIFY_MAX_ATTEMPTS) {
            $warnings[] = 'Die Pruefung konnte nicht abgeschlossen werden; '
                . 'die Datei wurde nicht vollstaendig gegengelesen.';
            $run['phase'] = 'done';
            $run['status'] = 'completed';
            avesmapsDbBackupPersistRun($pdo, $run, $warnings, true);
            avesmapsDbBackupPruneOldRuns($pdo);

            return avesmapsDbBackupProgressPayload($run, $warnings);
        }

        avesmapsDbBackupPersistRun($pdo, $run, $warnings);

        return avesmapsDbBackupProgressPayload($run, $warnings);
    }

    $expectedBytes = (int) $run['plain_bytes'];
    if ($decompressed !== $expectedBytes) {
        throw new RuntimeException(sprintf(
            'Die Pruefung schlug fehl: %d Bytes entpackt, %d erwartet.',
            $decompressed,
            $expectedBytes
        ));
    }

    $actualCrc = (int) hexdec(hash_final($crcContext)) & 0xffffffff;
    if ($actualCrc !== ((int) $run['plain_crc32'] & 0xffffffff)) {
        throw new RuntimeException('Die Pruefung schlug fehl: die Pruefsumme stimmt nicht.');
    }

    if (!str_contains($tail, AVESMAPS_DB_BACKUP_END_MARKER)) {
        throw new RuntimeException('Die Pruefung schlug fehl: die Endmarkierung fehlt.');
    }

    $run['phase'] = 'done';
    $run['status'] = 'completed';
    avesmapsDbBackupPersistRun($pdo, $run, $warnings, true);
    avesmapsDbBackupPruneOldRuns($pdo);

    return avesmapsDbBackupProgressPayload($run, $warnings);
}

// ===========================================================================
// Persistence, heartbeat, failure, cleanup.
// ===========================================================================

/** Write the mutated cursors/counters of a run row back. */
function avesmapsDbBackupPersistRun(PDO $pdo, array $run, array $warnings, bool $finished = false): void
{
    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
         SET status = :status,
             phase = :phase,
             object_index = :object_index,
             object_name = :object_name,
             object_stage = :object_stage,
             row_cursor = :row_cursor,
             rows_written = :rows_written,
             tables_done = :tables_done,
             plain_bytes = :plain_bytes,
             gz_bytes = :gz_bytes,
             plain_crc32 = :plain_crc32,
             fragment_count = :fragment_count,
             steps_done = :steps_done,
             verify_attempts = :verify_attempts,
             warnings = :warnings,
             heartbeat_at = CURRENT_TIMESTAMP(3),
             finished_at = IF(:finished = 1, CURRENT_TIMESTAMP(3), finished_at)
         WHERE public_id = :pid'
    );
    $statement->execute([
        'status' => (string) $run['status'],
        'phase' => (string) $run['phase'],
        'object_index' => (int) $run['object_index'],
        'object_name' => mb_substr((string) $run['object_name'], 0, 190),
        'object_stage' => (string) $run['object_stage'],
        'row_cursor' => $run['row_cursor'] === null ? null : mb_substr((string) $run['row_cursor'], 0, 255),
        'rows_written' => (int) $run['rows_written'],
        'tables_done' => (int) $run['tables_done'],
        'plain_bytes' => (int) $run['plain_bytes'],
        'gz_bytes' => (int) $run['gz_bytes'],
        'plain_crc32' => (int) $run['plain_crc32'],
        'fragment_count' => (int) $run['fragment_count'],
        'steps_done' => (int) $run['steps_done'],
        'verify_attempts' => (int) $run['verify_attempts'],
        'warnings' => json_encode(array_values($warnings), JSON_UNESCAPED_UNICODE),
        'finished' => $finished ? 1 : 0,
        'pid' => (string) $run['public_id'],
    ]);
}

/** Refresh a run's heartbeat so a long backup is never reaped as abandoned. */
function avesmapsDbBackupHeartbeat(PDO $pdo, string $publicId): void
{
    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
         SET heartbeat_at = CURRENT_TIMESTAMP(3)
         WHERE public_id = :pid AND status = \'running\''
    );
    $statement->execute(['pid' => $publicId]);
}

/**
 * Mark a run failed and record why. The reason is stored for the admin-only status
 * view (a backup tool that hides its failure reason is useless); the HTTP envelope
 * the endpoint returns stays a generic code + message.
 */
function avesmapsDbBackupMarkFailed(PDO $pdo, string $publicId, string $reason): void
{
    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
         SET status = \'failed\',
             error = :error,
             finished_at = CURRENT_TIMESTAMP(3)
         WHERE public_id = :pid AND status = \'running\''
    );
    $statement->execute([
        'error' => mb_substr($reason, 0, 500),
        'pid' => $publicId,
    ]);
}

/** Cancel a running backup and drop its partial file. */
function avesmapsDbBackupCancelRun(PDO $pdo, string $publicId): bool
{
    $run = avesmapsDbBackupReadRun($pdo, $publicId);
    if ($run === null) {
        return false;
    }

    $statement = $pdo->prepare(
        'UPDATE ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
         SET status = \'canceled\', finished_at = CURRENT_TIMESTAMP(3)
         WHERE public_id = :pid AND status = \'running\''
    );
    $statement->execute(['pid' => $publicId]);

    avesmapsDbBackupDeleteFile((string) $run['file_name']);

    return true;
}

/** Delete a run's file (best effort) and its row. */
function avesmapsDbBackupDeleteRun(PDO $pdo, string $publicId): bool
{
    $run = avesmapsDbBackupReadRun($pdo, $publicId);
    if ($run === null) {
        return false;
    }

    avesmapsDbBackupDeleteFile((string) $run['file_name']);

    $statement = $pdo->prepare('DELETE FROM ' . AVESMAPS_DB_BACKUP_RUN_TABLE . ' WHERE public_id = :pid');
    $statement->execute(['pid' => $publicId]);

    return true;
}

/** Remove one backup file if its name passes the whitelist. */
function avesmapsDbBackupDeleteFile(string $fileName): void
{
    $path = avesmapsDbBackupFilePath($fileName);
    if ($path !== null && is_file($path)) {
        @unlink($path);
    }
}

/**
 * Keep only the newest AVESMAPS_DB_BACKUP_KEEP_FILES completed backups: older
 * files are deleted and their rows marked `pruned`. The webspace is shared with
 * the tiles and the wiki dump, so backups nobody deletes must not be able to fill
 * it.
 */
function avesmapsDbBackupPruneOldRuns(PDO $pdo): int
{
    $statement = $pdo->query(
        'SELECT public_id, file_name FROM ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
         WHERE status = \'completed\'
         ORDER BY id DESC'
    );
    $runs = $statement->fetchAll(PDO::FETCH_ASSOC);

    $pruned = 0;
    $update = $pdo->prepare(
        'UPDATE ' . AVESMAPS_DB_BACKUP_RUN_TABLE . ' SET status = \'pruned\' WHERE public_id = :pid'
    );
    foreach (array_slice($runs, AVESMAPS_DB_BACKUP_KEEP_FILES) as $run) {
        avesmapsDbBackupDeleteFile((string) $run['file_name']);
        $update->execute(['pid' => (string) $run['public_id']]);
        $pruned++;
    }

    // Rows whose files are long gone are not interesting history; keeping the table
    // small keeps the status read a single cheap query.
    $pdo->exec(
        'DELETE FROM ' . AVESMAPS_DB_BACKUP_RUN_TABLE . '
         WHERE status IN (\'pruned\', \'canceled\', \'failed\')
           AND created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)'
    );

    return $pruned;
}

// ===========================================================================
// Read models for the endpoint.
// ===========================================================================

/**
 * The per-step response: the run's public state plus a progress block the UI
 * renders directly.
 *
 * @return array{run:array, done:bool, progress:array}
 */
function avesmapsDbBackupProgressPayload(array $run, ?array $warnings = null): array
{
    $resolvedWarnings = $warnings ?? avesmapsDbBackupDecodeWarnings($run);

    return [
        'run' => avesmapsDbBackupPublicRun($run, $resolvedWarnings),
        'done' => (string) $run['status'] !== 'running',
        'progress' => [
            'percent' => avesmapsDbBackupProgressPercent($run),
            'phase' => (string) $run['phase'],
            'object' => (string) $run['object_name'],
            'tables_done' => (int) $run['tables_done'],
            'tables_total' => (int) $run['tables_total'],
            'rows_written' => (int) $run['rows_written'],
            'rows_total' => (int) $run['rows_total'],
            'plain_bytes' => (int) $run['plain_bytes'],
            'gz_bytes' => (int) $run['gz_bytes'],
        ],
    ];
}

/** The client-visible shape of a run row. */
function avesmapsDbBackupPublicRun(array $run, ?array $warnings = null): array
{
    $fileName = (string) $run['file_name'];
    $path = avesmapsDbBackupFilePath($fileName);

    return [
        'id' => (string) $run['public_id'],
        'status' => (string) $run['status'],
        'phase' => (string) $run['phase'],
        'file_name' => $fileName,
        'file_present' => $path !== null && is_file($path),
        'include_transient' => (bool) (int) $run['include_transient'],
        'tables_done' => (int) $run['tables_done'],
        'tables_total' => (int) $run['tables_total'],
        'rows_written' => (int) $run['rows_written'],
        'rows_total' => (int) $run['rows_total'],
        'plain_bytes' => (int) $run['plain_bytes'],
        'gz_bytes' => (int) $run['gz_bytes'],
        'fragment_count' => (int) $run['fragment_count'],
        'created_by' => (string) $run['created_by_name'],
        'created_at' => (string) $run['created_at'],
        'finished_at' => $run['finished_at'] === null ? null : (string) $run['finished_at'],
        'error' => (string) $run['error'],
        'warnings' => $warnings ?? avesmapsDbBackupDecodeWarnings($run),
    ];
}

/**
 * The status read backing the page: the live run (if any) plus the recent runs
 * with their files.
 *
 * @return array{live:?array, runs:list<array>}
 */
function avesmapsDbBackupStatus(PDO $pdo, int $limit = 10): array
{
    avesmapsDbBackupEnsureTable($pdo);
    avesmapsDbBackupReapStaleRuns($pdo);

    $live = avesmapsDbBackupFindLiveRun($pdo);

    $statement = $pdo->query(
        'SELECT * FROM ' . AVESMAPS_DB_BACKUP_RUN_TABLE
        . ' ORDER BY id DESC LIMIT ' . max(1, min(50, $limit))
    );

    $runs = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $runs[] = avesmapsDbBackupPublicRun($row);
    }

    return [
        'live' => $live === null ? null : avesmapsDbBackupPublicRun($live),
        'runs' => $runs,
    ];
}
