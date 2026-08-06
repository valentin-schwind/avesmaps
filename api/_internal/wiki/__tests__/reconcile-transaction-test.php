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
    // Only the owner commits -- an inner call must leave the outer transaction alone.
    assert(
        preg_match('/if \(\$ownsTransaction\) \{\s*\n\s*\$pdo->commit\(\);/', $source) === 1,
        "{$functionName} commits only what it opened"
    );

    // ⚠️ Everything below is asserted on the WRAPPER's text, not on the whole file. The file has
    // other try/catch blocks -- avesmapsCitymapLinkSource rethrows too -- and a file-wide count would
    // pass or fail for reasons that have nothing to do with this wrapper.
    $body = $transactionBody($source, $functionName);

    // What sits between begin and commit: exactly one call, to the extracted body. Everything the
    // reach check below examines hangs off that call.
    assert(
        substr_count($body, $functionName . 'Writes(') === 1,
        "{$functionName}: the transaction wraps exactly one call, the extracted writes"
    );
    assert(
        str_contains($body, '} catch (Throwable $exception) {'),
        "{$functionName} catches every Throwable, not only PDOException"
    );
    assert(
        str_contains($body, 'if ($ownsTransaction && $pdo->inTransaction()) {'),
        "{$functionName} rolls back only a transaction it owns and that is still open"
    );
    // A rollback that does not rethrow turns a failed entity into a silent success -- and the run
    // would carry on past an entity that was rolled back.
    assert(
        substr_count($body, 'throw $exception;') === 1,
        "{$functionName} rethrows the original exception"
    );
    // 💣 And the rollBack is itself guarded. It throws precisely when the connection is gone -- the
    // abort this whole change is about -- and an unguarded one replaces the real cause with "MySQL
    // server has gone away", with no previous-chaining.
    assert(
        preg_match('/try \{\s*\n\s*\$pdo->rollBack\(\);\s*\n\s*\} catch \(Throwable\) \{/', $body) === 1,
        "{$functionName}: the rollBack is itself guarded, or it buries the original exception"
    );
}

// --- The REACH of the transaction, computed rather than assumed ----------------------------------
//
// 💣 THE FIRST VERSION OF THIS TEST CHECKED ONLY THE WRAPPER -- ten lines that contain one function
// call -- and that made its central assertion vacuous. Verified after the fact: an
// `avesmapsEnsureFeatureSourceTables($pdo);` placed as the first line of ...EntityWrites passed
// GREEN. The rule has to hold over what the transaction actually spans: the extracted body AND
// every avesmaps* function it reaches, at any depth. That is where such a call would really be
// written, and it is the only place the rule can realistically break.
//
// ⚠️ PHP's own tokenizer does the brace matching. A regex cannot: a `{` inside a comment or a string
// literal is indistinguishable from a real one, and these files are full of both.

/** @return array<string,string> avesmaps* function name => its body source */
function avesmapsTestIndexFunctionBodies(string $root): array
{
    $bodies = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($files as $file) {
        if (!$file->isFile() || strtolower($file->getExtension()) !== 'php') {
            continue;
        }
        $source = (string) file_get_contents($file->getPathname());
        if (!str_contains($source, 'function avesmaps')) {
            continue;
        }
        $tokens = token_get_all($source);
        $count = count($tokens);
        for ($i = 0; $i < $count; $i++) {
            if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION) {
                continue;
            }
            $j = $i + 1;
            while ($j < $count && is_array($tokens[$j]) && in_array($tokens[$j][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                $j++;
            }
            if ($j >= $count || !is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING || !str_starts_with($tokens[$j][1], 'avesmaps')) {
                continue;
            }
            $depth = 0;
            $start = null;
            $end = null;
            for ($k = $j; $k < $count; $k++) {
                $text = is_array($tokens[$k]) ? $tokens[$k][1] : $tokens[$k];
                if ($text === '{') {
                    if ($start === null) {
                        $start = $k;
                    }
                    $depth++;
                } elseif ($text === '}') {
                    $depth--;
                    if ($depth === 0 && $start !== null) {
                        $end = $k;
                        break;
                    }
                }
            }
            if ($start === null || $end === null) {
                continue;
            }
            $body = '';
            for ($m = $start; $m <= $end; $m++) {
                $body .= is_array($tokens[$m]) ? $tokens[$m][1] : $tokens[$m];
            }
            $bodies[$tokens[$j][1]] = $body;
            $i = $end;
        }
    }

    return $bodies;
}

$bodies = avesmapsTestIndexFunctionBodies(dirname(__DIR__, 3));
assert(count($bodies) > 500, 'the index found the project functions (got ' . count($bodies) . ')');

$reachFrom = static function (array $bodies, array $roots): array {
    $seen = [];
    $queue = $roots;
    while ($queue !== []) {
        $name = array_shift($queue);
        if (isset($seen[$name]) || !isset($bodies[$name])) {
            continue;
        }
        $seen[$name] = $bodies[$name];
        if (preg_match_all('/\b(avesmaps[A-Za-z0-9_]*)\s*\(/', $bodies[$name], $matches) > 0) {
            foreach ($matches[1] as $called) {
                $queue[] = $called;
            }
        }
        // A guarded call reaches just as far as a plain one.
        if (preg_match_all("/function_exists\(\s*'(avesmaps[A-Za-z0-9_]*)'/", $bodies[$name], $guarded) > 0) {
            foreach ($guarded[1] as $called) {
                $queue[] = $called;
            }
        }
    }

    return $seen;
};

$spanned = $reachFrom($bodies, ['avesmapsCitymapReconcileEntityWrites', 'avesmapsPublicationReconcileEntityWrites']);
// If the walk collapses to the two roots, the index or the regex broke and every assert below would
// pass for the wrong reason.
assert(count($spanned) >= 15, 'the walk reaches the called functions too (got ' . count($spanned) . ')');

foreach ($spanned as $name => $body) {
    // 💣 THE HOUSE RULE. MySQL commits an open transaction implicitly when it sees DDL -- no error,
    // no warning, and everything after it is outside the rollback.
    foreach (['EnsureTables', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE', 'AppSettingSet', 'AppSettingGet'] as $ddl) {
        assert(
            !str_contains($body, $ddl),
            "{$name} runs inside the transaction and contains DDL ({$ddl}) -- MySQL would commit implicitly"
        );
    }
    // 💣 No network and no file writes either: a transaction held open across an HTTP fetch ties up a
    // connection for unbounded latency on shared hosting, and a written file is not rolled back.
    foreach (['curl_', 'HttpGet', 'file_get_contents', 'file_put_contents', 'fopen(', 'mkdir('] as $io) {
        assert(
            !str_contains($body, $io),
            "{$name} runs inside the transaction and does I/O ({$io})"
        );
    }
    // 💣 And no nested transaction: PDO has none. An inner commit() would end the outer one early and
    // hand back exactly the half-written entity this change exists to prevent.
    foreach (['beginTransaction(', '->commit(', '->rollBack('] as $nested) {
        assert(
            !str_contains($body, $nested),
            "{$name} runs inside the transaction and manages one of its own ({$nested})"
        );
    }
}

// 💣 The walk must actually bite. avesmapsAdventureReconcileEntity is the control: the same walk
// from there MUST find the cover download. If it does not, the tokenizer or the regex is broken and
// the green above means nothing.
$adventureSpan = $reachFrom($bodies, ['avesmapsAdventureReconcileEntity']);
$adventureIo = array_filter($adventureSpan, static fn(string $body): bool => str_contains($body, 'curl_') || str_contains($body, 'file_put_contents('));
assert($adventureIo !== [], 'the walk finds the I/O in the adventure reconciler -- otherwise it proves nothing above');

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
// ⚠️ THREE callers, not one. Besides the two *ReconcileStep functions, the lore sync calls
// avesmapsPublicationReconcileEntity once per lore entry (lore-sync.php), and the publication step
// is driven from dump-hybrid-driver.php as well as from dump.php. An outer transaction anywhere on
// those paths would make $ownsTransaction false for every entity and turn the per-entity guarantee
// silently into a per-step one -- which is what the finding argued against, a step being hundreds
// of entities.
//
// ⚠️ citymap-plan-apply.php stands where citymap-sync.php used to (2026-08-06): the citymap reconcile
// loop moved into the APPLY half of the Übernahme-Vorschau, and it is the same loop with the same
// rule -- one transaction per entity, and an exception must leave the loop rather than be swallowed
// into "skip the broken one and carry on". citymap-sync.php itself no longer calls the entity
// reconciler at all, so listing it here would only assert something about a call that is gone.
//
// ⚠️ adventure-plan-apply.php joined on 2026-08-06 (session 2), and for the adventure reconciler the
// rule reads the other way round: it is the ONE entity writer that is deliberately NOT wrapped (it
// downloads the cover mid-write, see the exception above). What still holds -- and what this list
// checks -- is the other half of the promise: no transaction is opened around the loop, and the entity
// is not wrapped in a catch that would let the run continue past a rolled-back one.
$callerFiles = [
    'api/edit/wiki/dump.php',
    'api/_internal/wiki/lore-sync.php',
    'api/_internal/wiki/citymap-plan-apply.php',
    'api/_internal/wiki/adventure-plan-apply.php',
    'api/_internal/wiki/publication-sync.php',
];
foreach ($callerFiles as $relative) {
    $source = file_get_contents(dirname(__DIR__, 4) . '/' . $relative);
    assert(is_string($source) && $source !== '', "{$relative} is readable");
    // The two sync files legitimately contain beginTransaction -- their own wrappers, and
    // avesmapsCitymapRemoveVanished. What must not exist is one AROUND the reconcile loop.
    $entityAt = strpos($source, 'ReconcileEntity($pdo');
    if ($entityAt === false) {
        assert(!str_contains($source, 'beginTransaction'), "{$relative} opens no transaction at all");
        continue;
    }
    $loopAt = max((int) strrpos(substr($source, 0, $entityAt), 'foreach ('), (int) strrpos(substr($source, 0, $entityAt), 'while ('));
    $betweenLoopAndCall = substr($source, $loopAt, $entityAt - $loopAt);
    assert(
        !str_contains($betweenLoopAndCall, 'beginTransaction'),
        "{$relative}: no transaction is opened around the reconcile loop"
    );
    // 💣 AND NO try/catch AROUND THE ENTITY EITHER, which is what the per-entity promise really
    // rests on. The step cursor is assigned BEFORE the entity is processed (citymap-sync.php,
    // publication-sync.php) -- so the promise does not come from the cursor lagging, as the first
    // version of this change claimed. It comes from an exception leaving the loop entirely: the step
    // function never returns, the caller keeps its old cursor, and the run stops with a 500. Put a
    // "skip the broken entity and carry on" catch in that loop and the cursor moves past an entity
    // that was rolled back -- the exact damage the transaction was added to prevent, reintroduced
    // one level up. This assert is what makes that refactor loud instead of silent.
    assert(
        !str_contains($betweenLoopAndCall, 'try {'),
        "{$relative}: the reconciled entity is not wrapped in a catch that would let the run continue past it"
    );
}

echo "reconcile-transaction ok\n";
