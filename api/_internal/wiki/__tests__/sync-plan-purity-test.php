<?php

declare(strict_types=1);

/**
 * 💣 THE PROPERTY THE WHOLE ÜBERNAHME-VORSCHAU IS: the compute half writes into NO live table. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/sync-plan-purity-test.php
 * Exit 0 = all asserts passed.
 *
 * Static, and that is the honest option rather than a compromise: this code runs inside the chunked
 * dump sync, which must never be triggered to test something (STRATO shared hosting), so there is no
 * live proof to be had. What CAN be proven is the shape of the call graph -- and that is exactly where
 * this guarantee would break, because the way to break it is to call one of the old writers again.
 *
 * The walk is the one from reconcile-transaction-test.php next door, for the reason spelled out
 * there: PHP's own tokenizer does the brace matching, because a regex cannot tell a `{` in a comment
 * from a real one, and these files are full of both.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

/** @return array<string,string> avesmaps* function name => its body source */
function avesmapsPurityIndexFunctionBodies(string $root): array
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

$bodies = avesmapsPurityIndexFunctionBodies(dirname(__DIR__, 3));
assert(count($bodies) > 500, 'the index found the project functions (got ' . count($bodies) . ')');

/**
 * Every avesmaps* function reachable from the given roots, at any depth. A guarded call
 * (function_exists) reaches just as far as a plain one.
 *
 * @return array<string,string>
 */
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
        if (preg_match_all("/function_exists\(\s*'(avesmaps[A-Za-z0-9_]*)'/", $bodies[$name], $guarded) > 0) {
            foreach ($guarded[1] as $called) {
                $queue[] = $called;
            }
        }
    }

    return $seen;
};

// The tables an Übernahme is supposed to protect. wiki_citymap_catalog is in the list because the
// compute half must not "tidy up" staging either -- a plan that edits its own input cannot be checked
// against the input later (the staleness re-check in the apply half does exactly that).
$forbiddenTables = [
    'citymap', 'citymap_place', 'citymap_type', 'citymap_link', 'citymap_related',
    'feature_sources', 'sources', 'map_features', 'map_audit_log', 'wiki_citymap_catalog',
];
// ⚠️ STATEMENTS, not table names: `ALTER TABLE citymap ADD COLUMN wiki_key` is self-healing schema
// (avesmapsEnsureCitymapStagingTables) and is allowed to stay -- it writes no data.
$forbiddenStatements = static function (string $table): array {
    return [
        'INSERT INTO ' . $table . ' ',
        'INSERT IGNORE INTO ' . $table . ' ',
        'INSERT INTO ' . $table . "\n",
        'UPDATE ' . $table . ' ',
        'DELETE FROM ' . $table . ' ',
        'DELETE FROM ' . $table . "\n",
    ];
};

$computeSpan = $reachFrom($bodies, ['avesmapsCitymapPlanStep']);
// If the walk collapses to its root, the index or the regex broke and every assert below would pass
// for the wrong reason.
assert(count($computeSpan) >= 10, 'the walk reaches the called functions too (got ' . count($computeSpan) . ')');
// Named, so a rename cannot quietly shrink what is being checked.
foreach (['avesmapsCitymapPlanForCatalogRow', 'avesmapsCitymapPlanItem', 'avesmapsCitymapVanishedRows',
    'avesmapsSyncPlanAddItem', 'avesmapsCitymapSourceLinkMissing', 'avesmapsCitymapWikiLinkDiff'] as $expected) {
    assert(isset($computeSpan[$expected]), "the walk reaches {$expected}");
}

foreach ($computeSpan as $name => $body) {
    foreach ($forbiddenTables as $table) {
        foreach ($forbiddenStatements($table) as $statement) {
            assert(
                !str_contains($body, $statement),
                "{$name} runs in the COMPUTE half and writes: {$statement}"
            );
        }
    }
}

// 💣 AND THE WALK MUST BITE. The same check from the APPLY half MUST find the writers -- if it does
// not, the green above is a broken tokenizer rather than a guarantee. This is the control the first
// version of the transaction test lacked, which made its central assertion vacuous.
$applySpan = $reachFrom($bodies, ['avesmapsCitymapApplyStep']);
assert(isset($applySpan['avesmapsCitymapReconcileEntityWrites']), 'the apply half reaches the writer');
$writers = array_filter(
    $applySpan,
    static fn(string $body): bool => str_contains($body, 'INSERT INTO citymap ')
        || str_contains($body, 'DELETE FROM citymap ')
);
assert($writers !== [], 'the apply half contains the writers -- otherwise the walk proves nothing above');

// 🔴 And the two halves must stay two. If the compute step ever reaches the entity writer, the plan
// is being applied while it is being made and the preview is a lie.
assert(
    !isset($computeSpan['avesmapsCitymapReconcileEntityWrites']),
    'the compute half must never reach the entity writer'
);
assert(
    !isset($computeSpan['avesmapsCitymapDeleteWikiRow']),
    'the compute half must never reach the deleter -- it only produces the rows that PROPOSE a deletion'
);
assert(
    !isset($computeSpan['avesmapsCitymapLinkSource']),
    'the compute half must use the read-only source probe, not the writer that answers by upserting'
);
assert(
    !isset($computeSpan['avesmapsCitymapReconcileWikiLinks']),
    'the compute half must use the read-only Fundstellen diff, not the writer'
);

// --- The empty-catalog gate is where it has to be -------------------------------------------------
//
// avesmapsCitymapRemovableKeys is pure and tested; what matters here is that the row PRODUCER still
// goes through it, because that is the only thing standing between a misfired "Dump holen" and a
// preview offering 457 deletions.
assert(
    str_contains($bodies['avesmapsCitymapVanishedRows'] ?? '', 'avesmapsCitymapRemovableKeys('),
    'the deletion-row producer still goes through the gate that refuses an empty catalog'
);
assert(
    str_contains($bodies['avesmapsCitymapRemovableKeys'] ?? '', 'if ($catalogKeys === []) {'),
    'and the gate is still the first thing that function does'
);

// --- The declined-deletion gate --------------------------------------------------------------------
assert(
    str_contains($bodies['avesmapsCitymapPlanStep'] ?? '', 'avesmapsSyncPlanDeclinedKeys($pdo,'),
    'the compute step asks which deletions were declined before it proposes any'
);

echo "sync-plan-purity ok\n";
