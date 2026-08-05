<?php

declare(strict_types=1);

/**
 * The conditional answer comes before the DDL (finding A19). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/ecosystem-conditional-before-ddl-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../ecosystem.php';

// ===== THE RULE UNDER TEST =====
// avesmapsEcosystemEnsureTables runs 64 statements -- 13 CREATE TABLE, 16 information_schema probes,
// 34 INSERT IGNORE -- and stood BEFORE the 304 check. A client holding a valid ETag paid all of them
// to be handed an empty answer.

// --- The defensive read: it must survive a table that is not there yet ----------------------------
//
// 💣 avesmapsReadEcosystemRevision itself does NOT. PDO runs with ERRMODE_EXCEPTION, so a SELECT
// against a missing table is an exception, not a `false`. Without the twin, moving the DDL later would
// turn a fresh installation's first request into a 500.
$fresh = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$threw = false;
try {
    avesmapsReadEcosystemRevision($fresh);
} catch (Throwable) {
    $threw = true;
}
assert($threw, 'the plain reader throws on a missing table -- which is why the twin exists');
assert(
    avesmapsEcosystemReadRevisionIfPresent($fresh) === null,
    'the defensive reader answers null instead, so the caller can fall through to the DDL'
);

// With the table present it is the plain reader, value for value.
$ready = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$ready->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$ready->exec('INSERT INTO ecosystem_revision (id, revision) VALUES (1, 4711)');
assert(avesmapsEcosystemReadRevisionIfPresent($ready) === 4711, 'a present revision is read straight through');
assert(
    avesmapsEcosystemReadRevisionIfPresent($ready) === avesmapsReadEcosystemRevision($ready),
    'and the twin never disagrees with the reader it wraps'
);

// An empty table is the documented "1", not null -- null must mean "no schema", nothing else, or the
// caller would run the DDL on every request of an installation that simply has no revision row yet.
$empty = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$empty->exec('CREATE TABLE ecosystem_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
assert($empty !== null && avesmapsEcosystemReadRevisionIfPresent($empty) === 1, 'an empty table reads as revision 1, not as "no schema"');

// --- The endpoint order ---------------------------------------------------------------------------

$endpointSource = file_get_contents(__DIR__ . '/../../../app/ecosystem-areas.php');
assert(is_string($endpointSource) && $endpointSource !== '', 'the endpoint source is readable');

$conditionalAt = strpos($endpointSource, 'avesmapsEcosystemReadRevisionIfPresent($pdo)');
$exitAt = strpos($endpointSource, 'http_response_code(304);');
$ddlAt = strpos($endpointSource, 'avesmapsEcosystemEnsureTables($pdo);');
assert(is_int($conditionalAt) && is_int($exitAt) && is_int($ddlAt), 'all three steps are present');
assert($conditionalAt < $exitAt, 'the revision is read before the conditional answer');
assert(
    $exitAt < $ddlAt,
    'and the 304 exits BEFORE the DDL -- that is the whole finding; with the order back the other way '
        . 'a warm client pays 64 statements for an empty response'
);
assert(
    substr_count($endpointSource, 'avesmapsEcosystemEnsureTables($pdo);') === 1,
    'the DDL runs once, on the path that actually builds an answer'
);

// 💣 The fresh-installation branch must still send the headers, or the very first client of a new
// installation gets a body with no ETag and can never revalidate.
assert(
    preg_match('/if \(\$revision === null\) \{\s*\n\s*\$revision = avesmapsReadEcosystemRevision\(\$pdo\);\s*\n\s*header\(\'ETag: /', $endpointSource) === 1,
    'after the DDL, a fresh installation reads its revision and sends the tag it could not send before'
);

// ⚠️ What this does NOT claim: that the saving is visible today. A34 measured that no PHP endpoint on
// this host delivers an ETag at all -- mod_deflate strips it -- so no client ever sends If-None-Match
// and the 304 branch never fires. This ordering is correct and is the prerequisite for that fix; it is
// not, on its own, a measurable win.

echo "ecosystem-conditional-before-ddl ok\n";
