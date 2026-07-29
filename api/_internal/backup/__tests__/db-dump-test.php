<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE core of api/_internal/backup/db-dump.php. No DB, no HTTP
 * -- hand-built column/row arrays plus a temp file for the gzip writer. Run
 * (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/backup/__tests__/db-dump-test.php
 * Exit 0 = all asserts passed.
 *
 * The centrepiece is the WRITER round-trip at the bottom: it builds a file exactly
 * the way a real run does (gzip header, one deflate fragment per step, terminator)
 * and then requires `gzdecode()` -- which reads only the FIRST gzip member -- to
 * return the whole payload. That single assert is what proves the file is a
 * single-member gzip and not the multi-member kind that 7-Zip and gzdecode()
 * silently truncate. If it ever fails, backups have started lying about their size.
 */

// Environment guard: assert() is compiled to a silent no-op unless zend.assertions=1
// is set at PHP startup -- it CANNOT be flipped at runtime via ini_set(). Without
// this guard a broken implementation would print every "... ok" line and exit 0: a
// false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . 'Re-run with: php -d zend.assertions=1 -d assert.exception=1 ' . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../db-dump.php';

/** A stand-in for PDO::quote (MySQL-style single quotes + backslash escapes). */
$quoter = static function (string $value): string {
    return "'" . str_replace(['\\', "'"], ['\\\\', "\\'"], $value) . "'";
};

// ------------------------------------------------------------ IDENTIFIERS ---
assert(avesmapsDbBackupQuoteIdentifier('map_features') === '`map_features`');
assert(avesmapsDbBackupQuoteIdentifier('we`ird') === '`we``ird`', 'embedded backtick is doubled');
echo "quote-identifier ok\n";

// ----------------------------------------------------------- COLUMN TYPES ---
assert(avesmapsDbBackupIsNumericColumnType('bigint unsigned'));
assert(avesmapsDbBackupIsNumericColumnType('decimal(10,3)'));
assert(avesmapsDbBackupIsNumericColumnType('double'));
assert(!avesmapsDbBackupIsNumericColumnType('varchar(190)'));
// 💣 The trap: "int" must not match inside another type name.
assert(!avesmapsDbBackupIsNumericColumnType('interval'), '"int" is not a prefix match of anything');
assert(!avesmapsDbBackupIsNumericColumnType('json'));

assert(avesmapsDbBackupIsBinaryColumnType('longblob'));
assert(avesmapsDbBackupIsBinaryColumnType('varbinary(64)'));
assert(avesmapsDbBackupIsBinaryColumnType('bit(1)'));
assert(avesmapsDbBackupIsBinaryColumnType('geometry'));
assert(!avesmapsDbBackupIsBinaryColumnType('text'));
assert(!avesmapsDbBackupIsBinaryColumnType('varchar(20)'));

assert(avesmapsDbBackupIsGeneratedColumn('VIRTUAL GENERATED'));
assert(avesmapsDbBackupIsGeneratedColumn('STORED GENERATED'));
assert(!avesmapsDbBackupIsGeneratedColumn('auto_increment'));
assert(!avesmapsDbBackupIsGeneratedColumn(''));
echo "column-types ok\n";

// ------------------------------------------------------------- LITERALIZE ---
$text = ['type' => 'varchar(190)'];
$number = ['type' => 'bigint'];
$decimal = ['type' => 'decimal(12,4)'];
$blob = ['type' => 'longblob'];

assert(avesmapsDbBackupFormatValue(null, $text, $quoter) === 'NULL');
assert(avesmapsDbBackupFormatValue(42, $number, $quoter) === '42', 'native int stays bare');
assert(avesmapsDbBackupFormatValue('42', $number, $quoter) === '42', 'stringified int stays bare');
assert(avesmapsDbBackupFormatValue('-17.5000', $decimal, $quoter) === '-17.5000', 'DECIMAL keeps its exact text');
assert(avesmapsDbBackupFormatValue('Gareth', $text, $quoter) === "'Gareth'");
assert(avesmapsDbBackupFormatValue("O'Brien", $text, $quoter) === "'O\\'Brien'", 'quotes are escaped');
// 💣 A numeric COLUMN holding a non-numeric string must still be quoted, or the
// dump emits a bare word and the restore dies on a syntax error.
assert(avesmapsDbBackupFormatValue('not-a-number', $number, $quoter) === "'not-a-number'");
// Byte columns go out as hex: escaping raw bytes into a utf8mb4 file would make the
// FILE invalid UTF-8 and importers reject it.
assert(avesmapsDbBackupFormatValue("\x00\xff\x10", $blob, $quoter) === '0x00ff10');
assert(avesmapsDbBackupFormatValue('', $blob, $quoter) === "''", '0x with no digits is not valid SQL');
assert(avesmapsDbBackupFormatValue(true, $number, $quoter) === '1');
echo "format-value ok\n";

// A float must round-trip through its literal.
foreach ([0.1, -273.15, 1.0, 1.0e-9, 410.574, 6.02214076e23] as $float) {
    $literal = avesmapsDbBackupFormatFloat($float);
    assert((float) $literal === $float, 'float literal round-trips: ' . $literal);
}
assert(avesmapsDbBackupFormatValue(0.1, ['type' => 'double'], $quoter) === '0.1');
echo "format-float ok\n";

// -------------------------------------------------------------- DDL FIXUP ---
// 💣 A kept DEFINER makes the restore fail with "you need SUPER privileges" on any
// host but this one -- which is every host a backup is ever restored on.
$viewDdl = "CREATE ALGORITHM=UNDEFINED DEFINER=`dbu123`@`localhost` SQL SECURITY DEFINER VIEW `v` AS select 1";
$fixed = avesmapsDbBackupStripDefiner($viewDdl);
assert(!str_contains($fixed, 'DEFINER=`dbu123`'), 'definer is gone');
assert(str_contains($fixed, 'SQL SECURITY INVOKER'), 'security is downgraded to INVOKER');
assert(str_contains($fixed, 'VIEW `v` AS select 1'), 'the body survives untouched');

$triggerDdl = "CREATE DEFINER=`root`@`%` TRIGGER `t` BEFORE INSERT ON `x` FOR EACH ROW SET @a = 1";
$fixedTrigger = avesmapsDbBackupStripDefiner($triggerDdl);
assert($fixedTrigger === "CREATE TRIGGER `t` BEFORE INSERT ON `x` FOR EACH ROW SET @a = 1", $fixedTrigger);

// Nothing to strip must change nothing.
assert(avesmapsDbBackupStripDefiner('CREATE VIEW `v` AS select 1') === 'CREATE VIEW `v` AS select 1');
echo "strip-definer ok\n";

// ---------------------------------------------------------- TRANSIENT SET ---
assert(avesmapsDbBackupIsTransientTable('wiki_dump_hybrid_state'));
assert(avesmapsDbBackupIsTransientTable('wiki_path_staging'));
assert(avesmapsDbBackupIsTransientTable('WIKI_SYNC_PAGES'), 'classification is case-insensitive');
// 💣 The near-misses. Marking any of these transient would mean silent data loss in
// a backup: overrides, history and editor decisions cannot be recomputed.
assert(!avesmapsDbBackupIsTransientTable('political_territory_wiki'));
assert(!avesmapsDbBackupIsTransientTable('wiki_sync_cases'));
assert(!avesmapsDbBackupIsTransientTable('map_audit_log'));
assert(!avesmapsDbBackupIsTransientTable('map_features'));
assert(!avesmapsDbBackupIsTransientTable('adventure_staging'), 'the suffix rule only covers wiki_* tables');
assert(!avesmapsDbBackupIsTransientTable(''));
echo "transient-tables ok\n";

// ------------------------------------------------------------- FILE NAMES ---
assert(avesmapsDbBackupBuildFileName('dbs14061312', '20260729-101500') === 'avesmaps-dbs14061312-20260729-101500.sql.gz');
assert(avesmapsDbBackupBuildFileName('DB_Aves.Maps', '20260729-101500') === 'avesmaps-db-aves-maps-20260729-101500.sql.gz');
assert(avesmapsDbBackupBuildFileName('', '20260729-101500') === 'avesmaps-database-20260729-101500.sql.gz');
// 💣 A database name is not user input today, but the file name is what the download
// action joins to a directory -- so it must be incapable of carrying a separator.
$hostile = avesmapsDbBackupBuildFileName('../../etc/passwd', '20260729-101500');
assert(!str_contains($hostile, '/') && !str_contains($hostile, '..'), $hostile);
assert(avesmapsDbBackupIsSafeFileName($hostile));

assert(avesmapsDbBackupIsSafeFileName('avesmaps-db-20260729-101500.sql.gz'));
assert(!avesmapsDbBackupIsSafeFileName('../avesmaps-db-20260729.sql.gz'));
assert(!avesmapsDbBackupIsSafeFileName('avesmaps-../x.sql.gz'));
assert(!avesmapsDbBackupIsSafeFileName('config.local.php'));
assert(!avesmapsDbBackupIsSafeFileName('avesmaps-db.sql'), 'only .sql.gz is a backup');
assert(!avesmapsDbBackupIsSafeFileName(''));
assert(avesmapsDbBackupFilePath('../../api/config.local.php') === null, 'a rejected name yields no path at all');
echo "file-names ok\n";

// ------------------------------------------------------- CURSOR STRATEGIES ---
$columns = [
    'id' => ['type' => 'bigint unsigned'],
    'public_id' => ['type' => 'char(36)'],
    'payload' => ['type' => 'longblob'],
];
$keyset = avesmapsDbBackupChooseCursorStrategy(['id'], $columns);
assert($keyset['mode'] === 'keyset' && $keyset['column'] === 'id');

$stringKey = avesmapsDbBackupChooseCursorStrategy(['public_id'], $columns);
assert($stringKey['mode'] === 'keyset', 'a char primary key paginates by keyset too');

// A byte-typed key cannot round-trip through the run row's text cursor.
$binaryKey = avesmapsDbBackupChooseCursorStrategy(['payload'], $columns);
assert($binaryKey['mode'] === 'offset', 'a binary key falls back to offset');

$composite = avesmapsDbBackupChooseCursorStrategy(['id', 'public_id'], $columns);
assert($composite['mode'] === 'offset' && $composite['order'] === ['id', 'public_id']);

$noKey = avesmapsDbBackupChooseCursorStrategy([], $columns);
assert($noKey['mode'] === 'scan' && $noKey['order'] === []);
echo "cursor-strategy ok\n";

// --------------------------------------------------------------- SELECTS ---
$first = avesmapsDbBackupBuildRowSelect('map_features', $columns, $keyset, null, 500);
assert($first['sql'] === 'SELECT `id`, `public_id`, `payload` FROM `map_features` ORDER BY `id` ASC LIMIT 500', $first['sql']);
assert($first['params'] === []);

$next = avesmapsDbBackupBuildRowSelect('map_features', $columns, $keyset, '4711', 500);
assert(str_contains($next['sql'], 'WHERE `id` > :cursor'), $next['sql']);
assert($next['params'] === ['cursor' => '4711']);
// 💣 The keyset WHERE and the ORDER BY must name the SAME column, or pagination
// skips rows -- silently, and only for tables large enough to span two steps.
preg_match('/WHERE (`[^`]+`) > :cursor ORDER BY (`[^`]+`) ASC/', $next['sql'], $keyMatch);
assert(($keyMatch[1] ?? 'a') === ($keyMatch[2] ?? 'b'), 'WHERE and ORDER BY page by the same column');
assert(($keyMatch[1] ?? '') === '`id`', 'and that column is the primary key');

$offsetSelect = avesmapsDbBackupBuildRowSelect('t', $columns, $composite, '1000', 500);
assert(str_contains($offsetSelect['sql'], 'ORDER BY `id` ASC, `public_id` ASC'), $offsetSelect['sql']);
assert(str_contains($offsetSelect['sql'], 'LIMIT 500 OFFSET 1000'), $offsetSelect['sql']);

$scanSelect = avesmapsDbBackupBuildRowSelect('t', $columns, $noKey, null, 500);
assert(!str_contains($scanSelect['sql'], 'ORDER BY'), 'no primary key means no order to page by');
assert(str_contains($scanSelect['sql'], 'LIMIT 500 OFFSET 0'));
echo "row-select ok\n";

// ------------------------------------------------------------ BATCH SIZE ---
// 💣 The clamps are the safety here: 0 rows per batch would make the run loop
// forever, and an unbounded batch is how a table of fat wikitext rows exhausts
// PHP's memory limit mid-backup.
assert(avesmapsDbBackupRowsPerRead(0, 0) === AVESMAPS_DB_BACKUP_ROWS_PER_READ, 'no estimate -> the default');
assert(avesmapsDbBackupRowsPerRead(0, 1000) === AVESMAPS_DB_BACKUP_ROWS_PER_READ, 'an empty table -> the default');
// Small rows (~200 B): the budget would allow far more, so the maximum caps it.
assert(avesmapsDbBackupRowsPerRead(200 * 40000, 40000) === AVESMAPS_DB_BACKUP_ROWS_PER_READ);
// Fat rows (~50 KB, the wiki sandbox): well below the maximum, well above the floor.
$fatBatch = avesmapsDbBackupRowsPerRead(50000 * 20000, 20000);
assert($fatBatch < AVESMAPS_DB_BACKUP_ROWS_PER_READ && $fatBatch > AVESMAPS_DB_BACKUP_ROWS_PER_READ_MIN, (string) $fatBatch);
assert($fatBatch * 50000 <= AVESMAPS_DB_BACKUP_ROW_BATCH_BUDGET_BYTES, 'a batch stays inside the byte budget');
// Absurd rows (8 MB each): the floor wins, never 0.
assert(avesmapsDbBackupRowsPerRead(8 * 1024 * 1024 * 10, 10) === AVESMAPS_DB_BACKUP_ROWS_PER_READ_MIN);
assert(avesmapsDbBackupRowsPerRead(PHP_INT_MAX >> 4, 1) === AVESMAPS_DB_BACKUP_ROWS_PER_READ_MIN, 'never 0 rows');
echo "batch-size ok\n";

// ----------------------------------------------------------- ROW ADVANCE ---
// 💣 The two rules a silently-wrong backup would hide behind: a short batch drains
// the table, and a keyset cursor lands exactly on the last row's key.
$keysetRows = [];
for ($i = 1; $i <= 500; $i++) {
    $keysetRows[] = ['id' => $i, 'public_id' => 'p' . $i];
}
$full = avesmapsDbBackupAdvanceRowCursor($keyset, null, $keysetRows, 500);
assert($full === ['cursor' => '500', 'drained' => false], 'a full batch continues from the last key');

$short = avesmapsDbBackupAdvanceRowCursor($keyset, '500', array_slice($keysetRows, 0, 12), 500);
assert($short === ['cursor' => '12', 'drained' => true], 'a short batch drains the table');

$empty = avesmapsDbBackupAdvanceRowCursor($keyset, '500', [], 500);
assert($empty === ['cursor' => '500', 'drained' => true], 'an empty batch drains without moving the cursor');

// A string primary key carries its own last value, not a count.
$stringAdvance = avesmapsDbBackupAdvanceRowCursor(
    ['mode' => 'keyset', 'column' => 'public_id'],
    null,
    [['public_id' => 'aa'], ['public_id' => 'zz']],
    2
);
assert($stringAdvance === ['cursor' => 'zz', 'drained' => false]);

// Offset mode counts rows instead, and must ADD to the incoming offset.
$offsetAdvance = avesmapsDbBackupAdvanceRowCursor($composite, '1000', array_fill(0, 500, ['id' => 1]), 500);
assert($offsetAdvance === ['cursor' => '1500', 'drained' => false], 'offsets accumulate');
assert(avesmapsDbBackupAdvanceRowCursor($noKey, null, array_fill(0, 7, ['id' => 1]), 500)
    === ['cursor' => '7', 'drained' => true]);

// A NULL key would otherwise re-issue the same cursor forever.
$nullKey = avesmapsDbBackupAdvanceRowCursor($keyset, '7', [['id' => null]], 500);
assert($nullKey['drained'] === true && $nullKey['cursor'] === '7', 'a NULL key ends the table, it does not loop');
echo "row-advance ok\n";

// -------------------------------------------------------- INSERT BATCHING ---
$batchColumns = ['id' => ['type' => 'int'], 'name' => ['type' => 'varchar(80)']];
$batch = avesmapsDbBackupRenderInsertBatch('places', $batchColumns, [
    ['id' => 1, 'name' => 'Gareth'],
    ['id' => 2, 'name' => "Al'Anfa"],
    ['id' => 3, 'name' => null],
], $quoter);
assert(substr_count($batch, 'INSERT INTO `places`') === 1, 'a small batch is one statement');
assert(str_contains($batch, "(1,'Gareth')"));
assert(str_contains($batch, "(2,'Al\\'Anfa')"));
assert(str_contains($batch, '(3,NULL)'));
assert(substr_count($batch, ';') === 1 && str_ends_with($batch, ";\n"));

// 💣 Statements must split below the smallest max_allowed_packet a restore target
// might have; a single oversized statement is only detectable at restore time.
$fatRows = [];
for ($i = 0; $i < 40; $i++) {
    $fatRows[] = ['id' => $i, 'name' => str_repeat('x', 20000)];
}
$fatBatch = avesmapsDbBackupRenderInsertBatch('places', $batchColumns, $fatRows, $quoter);
assert(substr_count($fatBatch, 'INSERT INTO `places`') > 1, 'a fat batch splits');
foreach (explode(";\n", trim($fatBatch)) as $statement) {
    assert(strlen($statement) <= AVESMAPS_DB_BACKUP_STATEMENT_BYTES + 32000, 'no statement runs away');
}

// One row bigger than the cap still has to go out -- as its own statement.
$hugeBatch = avesmapsDbBackupRenderInsertBatch('places', $batchColumns, [
    ['id' => 1, 'name' => str_repeat('y', AVESMAPS_DB_BACKUP_STATEMENT_BYTES + 5000)],
], $quoter);
assert(substr_count($hugeBatch, 'INSERT INTO `places`') === 1);
assert(str_ends_with($hugeBatch, ");\n"));
echo "insert-batching ok\n";

// -------------------------------------------------------- HEADER / TRAILER ---
$header = avesmapsDbBackupFileHeader([
    'database' => 'dbs123',
    'server_version' => '8.0.36',
    'generated_at' => '2026-07-29 10:15:00',
    'run_id' => 'run-1',
    'tables' => 61,
    'include_transient' => true,
]);
// The SET block is what makes the file restorable in any order and in any client.
assert(str_contains($header, 'SET NAMES utf8mb4'));
assert(str_contains($header, 'FOREIGN_KEY_CHECKS=0'));
assert(str_contains($header, "SQL_MODE='NO_AUTO_VALUE_ON_ZERO'"));
// 💣 No CREATE DATABASE / USE statement: the dump must land in whichever database
// the client selected, which is what makes the phpMyAdmin import route work at all.
// Checked against the STATEMENTS only -- the header's own comment block names both
// keywords while explaining their absence.
$headerStatements = implode("\n", array_filter(
    explode("\n", $header),
    static fn(string $line): bool => !str_starts_with(trim($line), '--')
));
assert(!str_contains($headerStatements, 'CREATE DATABASE'), $headerStatements);
assert(!preg_match('/^\s*USE\b/mi', $headerStatements));
assert(str_contains($header, 'complete (every table with its rows)'));
assert(str_contains(
    avesmapsDbBackupFileHeader(['include_transient' => false]),
    'without transient tables'
));

$trailer = avesmapsDbBackupFileTrailer(['run_id' => 'run-1', 'tables' => 61, 'rows' => 123456]);
assert(str_contains($trailer, 'SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS'), 'the trailer restores what the header changed');
assert(str_contains($trailer, 'COMMIT;'));
assert(str_contains($trailer, AVESMAPS_DB_BACKUP_END_MARKER . ' run=run-1 tables=61 rows=123456'));
assert(str_contains(trim($trailer), AVESMAPS_DB_BACKUP_END_MARKER), 'the marker is the last line');
assert(str_ends_with(trim(explode("\n", trim($trailer))[count(explode("\n", trim($trailer))) - 1]), 'rows=123456'));
echo "header-trailer ok\n";

// --------------------------------------------------------------- PROGRESS ---
assert(avesmapsDbBackupProgressPercent(['status' => 'completed']) === 100);
assert(avesmapsDbBackupProgressPercent(['status' => 'running', 'phase' => 'tables', 'rows_total' => 1000, 'rows_written' => 0]) === 0);
assert(avesmapsDbBackupProgressPercent(['status' => 'running', 'phase' => 'tables', 'rows_total' => 1000, 'rows_written' => 500]) === 47);
assert(avesmapsDbBackupProgressPercent(['status' => 'running', 'phase' => 'verify', 'rows_total' => 1, 'rows_written' => 1]) === 98);
// 💣 TABLE_ROWS is an information_schema ESTIMATE, so rows_written can exceed it.
// The bar must never claim 100 while the run is still going.
assert(avesmapsDbBackupProgressPercent(['status' => 'running', 'phase' => 'tables', 'rows_total' => 10, 'rows_written' => 9999]) === 95);
echo "progress ok\n";

// ------------------------------------------------------------ CRC COMBINE ---
// The gzip trailer's CRC is accumulated fragment by fragment and never recomputed
// over the payload, so combine() has to agree with a one-shot CRC exactly.
$chunkA = "-- part A\nINSERT INTO t VALUES (1);\n";
$chunkB = str_repeat("INSERT INTO t VALUES (2);\n", 500);
$chunkC = "-- tail\n";
$combined = avesmapsDbBackupCrc32Combine(0, avesmapsDbBackupCrc32($chunkA), strlen($chunkA));
$combined = avesmapsDbBackupCrc32Combine($combined, avesmapsDbBackupCrc32($chunkB), strlen($chunkB));
$combined = avesmapsDbBackupCrc32Combine($combined, avesmapsDbBackupCrc32($chunkC), strlen($chunkC));
assert($combined === avesmapsDbBackupCrc32($chunkA . $chunkB . $chunkC), 'combine == one-shot CRC');
assert(avesmapsDbBackupCrc32Combine(0x12345678, 0, 0) === 0x12345678, 'combining nothing changes nothing');
// A high-bit CRC must survive the logical shifts (PHP's >> is arithmetic).
$high = avesmapsDbBackupCrc32("\xff\xff\xff\xff\xff\xff\xff\xff");
assert(avesmapsDbBackupCrc32Combine($high, avesmapsDbBackupCrc32($chunkA), strlen($chunkA))
    === avesmapsDbBackupCrc32("\xff\xff\xff\xff\xff\xff\xff\xff" . $chunkA), 'high-bit CRCs combine correctly');
echo "crc32-combine ok\n";

// ----------------------------------------------------- THE WRITER ROUNDTRIP ---
// Build a file exactly the way a run does: gzip header once, one deflate fragment
// per step, then the terminator. Then require the strictest reader to see all of it.
$tempFile = tempnam(sys_get_temp_dir(), 'avesmaps-backup-test-') ?: '';
assert($tempFile !== '');
file_put_contents($tempFile, '');

$steps = [
    avesmapsDbBackupFileHeader([
        'database' => 'testdb',
        'server_version' => '8.0.36',
        'generated_at' => '2026-07-29 10:15:00',
        'run_id' => 'run-writer',
        'tables' => 2,
        'include_transient' => true,
    ]),
    "\nDROP TABLE IF EXISTS `a`;\nCREATE TABLE `a` (`id` int);\n"
        . avesmapsDbBackupRenderInsertBatch('a', ['id' => ['type' => 'int']], [['id' => 1], ['id' => 2]], $quoter),
    str_repeat("INSERT INTO `a` (`id`) VALUES (3);\n", 5000),
    // Multi-byte + quote-heavy content, since the payload is German map data.
    "INSERT INTO `b` (`name`) VALUES ('Fürstentum Kosch'),('Al'Anfa'),('Zwerch');\n",
    avesmapsDbBackupFileTrailer(['run_id' => 'run-writer', 'tables' => 2, 'rows' => 5003]),
];

$plain = '';
$gzBytes = 0;
$crc = 0;
foreach ($steps as $step) {
    $gzBytes += avesmapsDbBackupAppendFragment($tempFile, $step, $gzBytes === 0);
    $crc = avesmapsDbBackupCrc32Combine($crc, avesmapsDbBackupCrc32($step), strlen($step));
    $plain .= $step;
}
$gzBytes += avesmapsDbBackupAppendTerminator($tempFile, $crc, strlen($plain));

clearstatcache(true, $tempFile);
assert((int) filesize($tempFile) === $gzBytes, 'the run row byte count matches the file exactly');

// 💣 THE decisive assert: gzdecode() reads only the FIRST gzip member. Getting the
// whole payload back therefore proves the file is ONE member -- the property that
// keeps 7-Zip, gzdecode() and every other single-member reader from silently
// handing back a truncated dump. A multi-member writer fails right here.
$decoded = gzdecode((string) file_get_contents($tempFile));
assert($decoded === $plain, 'gzdecode() returns the COMPLETE payload (single-member gzip)');

// The streaming reader the verify phase uses must agree, byte for byte.
$handle = gzopen($tempFile, 'rb');
$streamed = '';
while (!gzeof($handle)) {
    $chunk = gzread($handle, 65536);
    if ($chunk === false || $chunk === '') {
        break;
    }
    $streamed .= $chunk;
}
gzclose($handle);
assert($streamed === $plain, 'gzopen/gzread streams the same bytes');
assert(avesmapsDbBackupCrc32($streamed) === $crc, 'the accumulated CRC matches the payload');
assert(str_contains(substr($streamed, -512), AVESMAPS_DB_BACKUP_END_MARKER), 'the end marker closes the dump');
echo "writer-roundtrip ok (plain " . strlen($plain) . " B -> gz " . $gzBytes . " B)\n";

// The crash reconcile: orphaned bytes past the persisted count are truncated away,
// and what remains is still a valid prefix the next fragment can continue.
$persisted = $gzBytes;
file_put_contents($tempFile, 'GARBAGE-FROM-A-DEAD-STEP', FILE_APPEND);
$dropped = avesmapsDbBackupReconcileFile($tempFile, $persisted);
assert($dropped === 24, 'exactly the orphaned bytes are dropped, got ' . $dropped);
clearstatcache(true, $tempFile);
assert((int) filesize($tempFile) === $persisted);
assert(gzdecode((string) file_get_contents($tempFile)) === $plain, 'the reconciled file still decodes whole');
assert(avesmapsDbBackupReconcileFile($tempFile, $persisted) === 0, 'reconciling a clean file is a no-op');
echo "reconcile ok\n";

@unlink($tempFile);

echo "\nall db-dump tests passed\n";
