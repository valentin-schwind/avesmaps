<?php

declare(strict_types=1);

/**
 * Finding A21: the wiki reconcilers wrote across 4-6 tables per entity with no transaction at all.
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/reconcile-transaction-test.php
 * Exit 0 = all asserts passed.
 *
 * Static, and that is not a compromise -- it is the only honest option here. These reconcilers run
 * inside the chunked dump sync, which must never be triggered to test something (STRATO shared
 * hosting), so there is no live proof to be had. And an sqlite harness would be WORSE than none for
 * the rule that matters most: sqlite does NOT commit implicitly on DDL, so a test that passed there
 * would say nothing about MySQL, where a stray CREATE TABLE IF NOT EXISTS silently ends the
 * transaction and takes everything after it out of reach of the rollback.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

$read = static function (string $relative): string {
    $source = file_get_contents(__DIR__ . '/../' . $relative);
    assert(is_string($source) && $source !== '', "{$relative} is readable");

    return $source;
};

$citymap = $read('citymap-sync.php');
$publication = $read('publication-sync.php');
$adventure = $read('adventure-sync.php');

// Everything from `beginTransaction()` up to the matching `commit()` in the named wrapper.
$transactionBody = static function (string $source, string $functionName): string {
    $at = strpos($source, 'function ' . $functionName . '(PDO $pdo');
    assert(is_int($at), "{$functionName} exists");
    $beginAt = strpos($source, '$pdo->beginTransaction();', $at);
    $commitAt = strpos($source, '$pdo->commit();', $at);
    assert(is_int($beginAt) && is_int($commitAt) && $commitAt > $beginAt, "{$functionName} opens and closes a transaction");

    return substr($source, $beginAt, $commitAt - $beginAt);
};

$wrapped = [
    'avesmapsCitymapReconcileEntity' => $citymap,
    'avesmapsPublicationReconcileEntity' => $publication,
];

foreach ($wrapped as $functionName => $source) {
    // ⚠️ PDO has no nested transactions. A bare beginTransaction() throws for any caller that already
    // opened one, so the ownership check is not defensive dressing -- without it this is a new bug.
    assert(
        preg_match(
            '/function ' . preg_quote($functionName, '/') . '\(PDO \$pdo[^)]*\): array\s*\n\{\s*\n\s*\$ownsTransaction = !\$pdo->inTransaction\(\);\s*\n\s*if \(\$ownsTransaction\) \{\s*\n\s*\$pdo->beginTransaction\(\);/',
            $source
        ) === 1,
        "{$functionName} opens its transaction only when it does not already sit inside one"
    );
    // A rollback that does not rethrow turns a failed entity into a silent success, and the step
    // cursor would move past it.
    assert(
        preg_match(
            '/\} catch \(Throwable \$exception\) \{\s*\n\s*if \(\$ownsTransaction && \$pdo->inTransaction\(\)\) \{\s*\n\s*\$pdo->rollBack\(\);\s*\n\s*\}\s*\n\s*throw \$exception;/',
            $source
        ) === 1,
        "{$functionName} rolls back on any Throwable AND rethrows it"
    );
    // Only the owner commits -- an inner call must leave the outer transaction alone.
    assert(
        preg_match('/if \(\$ownsTransaction\) \{\s*\n\s*\$pdo->commit\(\);/', $source) === 1,
        "{$functionName} commits only what it opened"
    );

    $body = $transactionBody($source, $functionName);

    // 💣 THE HOUSE RULE, and the reason this test exists at all. MySQL commits an open transaction
    // implicitly when it sees DDL -- no error, no warning, and everything after it is outside the
    // rollback. One *EnsureTables call moved in here would defeat the whole change silently.
    foreach (['EnsureTables', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'AppSettingSet', 'AppSettingGet'] as $ddl) {
        assert(
            !str_contains($body, $ddl),
            "{$functionName}: no DDL ({$ddl}) between begin and commit -- MySQL would commit implicitly"
        );
    }

    // 💣 And no network or file I/O either. A transaction held open across an HTTP fetch ties up a
    // connection for unbounded latency on a shared host, and a file written inside one is not rolled
    // back with it. This is the rule that kept the adventure reconciler out (see below).
    foreach (['curl_', 'HttpGet', 'file_get_contents', 'file_put_contents', 'fopen(', 'mkdir('] as $io) {
        assert(
            !str_contains($body, $io),
            "{$functionName}: no I/O ({$io}) between begin and commit"
        );
    }

    // What IS in there: exactly one call, to the extracted body. Anything else added later has to
    // pass the two rules above on purpose rather than by accident.
    assert(
        substr_count($body, $functionName . 'Writes(') === 1,
        "{$functionName}: the transaction wraps exactly one call, the extracted writes"
    );
}

// --- The exemption, and the reason it exists, pinned together ------------------------------------
//
// 💣 avesmapsAdventureReconcileEntity is deliberately NOT wrapped. It fetches the wiki cover over
// HTTP and writes it under /uploads/questcovers in the MIDDLE of its writes, and that fetch is
// interleaved: the row is created first (avesmapsAdventureFindOrAdoptRow), its cover_source is read
// back, and only then is the download decided. Wrapping as-is would span the network; hoisting the
// fetch out means restructuring a read/write sequence on a path that cannot be exercised live.
//
// The point of asserting it here is that an exemption must not outlive its reason. If someone moves
// the fetch out, this assert fails and says so -- at which point the reconciler can and should join
// the two above.
$adventureAt = strpos($adventure, 'function avesmapsAdventureReconcileEntity(PDO $pdo');
$adventureEndAt = strpos($adventure, "\nfunction ", (int) $adventureAt + 10);
$adventureBody = substr($adventure, (int) $adventureAt, (int) $adventureEndAt - (int) $adventureAt);
assert(
    str_contains($adventureBody, 'avesmapsAdventureSaveCoverLocal('),
    'the adventure reconciler still fetches its cover inline -- if it no longer does, wrap it too (A37)'
);
assert(
    !str_contains($adventureBody, '$pdo->beginTransaction();'),
    'and it is therefore still unwrapped, on purpose'
);
// The fetch really is network + file, so the exemption rests on a fact and not on a memory of one.
$coverAt = strpos($adventure, 'function avesmapsAdventureSaveCoverLocal(');
$coverEndAt = strpos($adventure, "\n}", (int) $coverAt);
$coverBody = substr($adventure, (int) $coverAt, (int) $coverEndAt - (int) $coverAt);
assert(
    str_contains($coverBody, 'HttpGetBinary(') && str_contains($coverBody, 'file_put_contents('),
    'the cover helper does download and write a file -- that is what keeps it out of a transaction'
);

// --- The callers must not already hold a transaction open ----------------------------------------
//
// If the dump endpoint wrapped the whole step, $ownsTransaction would be false for every entity and
// the per-entity guarantee would quietly become per-step -- which is the thing the finding asked
// against, because a step is up to a few hundred entities.
$dump = file_get_contents(__DIR__ . '/../../../edit/wiki/dump.php');
assert(is_string($dump) && $dump !== '', 'the dump endpoint is readable');
assert(
    !str_contains($dump, 'beginTransaction'),
    'the dump endpoint opens no transaction of its own, so each entity really gets one'
);

echo "reconcile-transaction ok\n";
