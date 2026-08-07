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
    'political_territory', 'political_territory_wiki', 'political_territory_geometry',
    'political_territory_wiki_test', 'wiki_territory_model',
];
// ⚠️ STATEMENTS, not table names: `ALTER TABLE citymap ADD COLUMN wiki_key` is self-healing schema
// (avesmapsEnsureCitymapStagingTables) and is allowed to stay -- it writes no data.
//
// 💣 NAMED EXCEPTION (owner decision 2026-08-07): avesmapsPoliticalEnsureTables, reached from the
// territory compute half via avesmapsWikiSyncMonitorApplyIdentityPreview, contains a conditional
// `UPDATE political_territory ... SET wiki_key = ...`. It is exempted BY FUNCTION NAME, not by
// removing political_territory from the table list above -- doing the latter would blind this scan to
// every real write that table's OTHER callers make. The exemption holds because: (1) it is the
// codebase-wide self-healing-schema convention (AGENTS.md §5, "self-healing" CREATE TABLE IF NOT
// EXISTS / ALTER TABLE pattern -- the same shape as the citymap exception above, just an UPDATE instead
// of an ALTER); (2) it backfills a DERIVED key (wiki_key, copied from political_territory_wiki), never
// user data; (3) it already runs on every political read path, sync or not; and (4) on the live data it
// is a no-op today (AGENTS.md records 1384/1384 rows already keyed).
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

// ==================================================================================================
// ABENTEUER (Sitzung 2). Dieselbe Prüfung, dieselbe Gegenprobe -- und zwei Fallen, die es bei den
// Karten nicht gab: der Finder ANTWORTET durch Übernehmen, und das Titelbild kommt über HTTP.
// ==================================================================================================

$adventureCompute = $reachFrom($bodies, ['avesmapsAdventurePlanStep']);
assert(count($adventureCompute) >= 8, 'the adventure walk reaches the called functions too (got ' . count($adventureCompute) . ')');
foreach (['avesmapsAdventurePlanForCatalogRow', 'avesmapsAdventurePlanItem', 'avesmapsAdventurePlanFindRow',
    'avesmapsAdventureFieldPlan', 'avesmapsAdventurePlacePlan', 'avesmapsAdventureDesiredPlaces',
    'avesmapsSyncPlanAddItem'] as $expected) {
    assert(isset($adventureCompute[$expected]), "the walk reaches {$expected}");
}

$adventureTables = ['adventure', 'adventure_place', 'wiki_adventure_catalog',
    'wiki_adventure_place_staging', 'map_features', 'map_audit_log'];
foreach ($adventureCompute as $name => $body) {
    foreach ($adventureTables as $table) {
        foreach ($forbiddenStatements($table) as $statement) {
            assert(
                !str_contains($body, $statement),
                "{$name} runs in the COMPUTE half and writes: {$statement}"
            );
        }
    }
}

// 🔴 Die zwei Wege, auf denen gerade diese Hälfte am leichtesten schreibt.
assert(
    !isset($adventureCompute['avesmapsAdventureFindOrAdoptRow']),
    'the compute half must use the read-only twin, not the finder that ANSWERS by adopting'
);
assert(
    !isset($adventureCompute['avesmapsAdventureReconcileEntity']),
    'the compute half must never reach the entity writer'
);
// 💣 UND KEIN BILD-DOWNLOAD. avesmapsAdventureSaveCoverLocal holt über HTTP und legt eine Datei in
// /uploads/questcovers -- ein Seiteneffekt, den in einem Lauf, der nur rechnet, niemand erlaubt hat.
// Die Zeile kündigt das Laden an ("wird neu geladen"); getan wird es erst beim Übernehmen.
assert(
    !isset($adventureCompute['avesmapsAdventureSaveCoverLocal']),
    'the compute half must not fetch a cover -- it announces the fetch, it does not perform it'
);
foreach ($adventureCompute as $name => $body) {
    assert(!str_contains($body, 'file_put_contents('), "{$name} writes a file in the compute half");
}

// 💣 UND DER LAUF MUSS BEISSEN.
$adventureApply = $reachFrom($bodies, ['avesmapsAdventureApplyStep']);
assert(isset($adventureApply['avesmapsAdventureReconcileEntity']), 'die Ausführ-Hälfte ruft den Schreiber');
assert(
    isset($adventureApply['avesmapsAdventureSaveCoverLocal']),
    'und dort DARF das Titelbild geholt werden -- sonst prüft das Verbot oben nichts'
);
$adventureWriters = array_filter(
    $adventureApply,
    static fn(string $body): bool => str_contains($body, 'INSERT INTO adventure ')
        || str_contains($body, 'UPDATE adventure SET ')
);
assert($adventureWriters !== [], 'die Ausführ-Hälfte enthält die Schreiber -- sonst prüft der Lauf oben nichts');

// ==================================================================================================
// PUBLIKATIONSQUELLEN (Sitzung 2). Die Falle hier: die Wunschliste des Schreibers ANTWORTET, indem sie
// den Quellenkatalog füllt -- eine Vorschau, die sie ruft, hat schon geschrieben.
// ==================================================================================================

$publicationCompute = $reachFrom($bodies, ['avesmapsPublicationPlanStep']);
assert(count($publicationCompute) >= 8, 'der Publikations-Lauf erreicht die aufgerufenen Funktionen (got ' . count($publicationCompute) . ')');
foreach (['avesmapsPublicationPlanForEntity', 'avesmapsPublicationLinkDiffForPlan',
    'avesmapsPublicationSourceIdForPlan', 'avesmapsPublicationDiffLinks',
    'avesmapsPublicationStagingHasEntityType', 'avesmapsPublicationFetchLiveEntityBatch',
    'avesmapsSyncPlanAddItem'] as $expected) {
    assert(isset($publicationCompute[$expected]), "the walk reaches {$expected}");
}

$publicationTables = ['sources', 'feature_sources', 'map_features', 'political_territory', 'lore_entry',
    'wiki_entity_publication', 'wiki_publication_catalog', 'map_audit_log'];
foreach ($publicationCompute as $name => $body) {
    foreach ($publicationTables as $table) {
        foreach ($forbiddenStatements($table) as $statement) {
            assert(
                !str_contains($body, $statement),
                "{$name} runs in the COMPUTE half and writes: {$statement}"
            );
        }
    }
}

// 🔴 Die drei Wege in den Quellenkatalog, und keiner gehört in die Rechen-Hälfte.
assert(
    !isset($publicationCompute['avesmapsPublicationDesiredLinksForEntity']),
    'the compute half must use the read-only probe, not the desired-list that upserts into `sources`'
);
assert(!isset($publicationCompute['avesmapsFeatureSourceUpsert']), 'no upsert in the compute half');
assert(!isset($publicationCompute['avesmapsFeatureSourceLink']), 'no linking in the compute half');
assert(
    !isset($publicationCompute['avesmapsPublicationReconcileEntity']),
    'the compute half must never reach the entity writer'
);

// 💣 UND DER LAUF MUSS BEISSEN.
$publicationApply = $reachFrom($bodies, ['avesmapsPublicationApplyStep']);
assert(
    isset($publicationApply['avesmapsPublicationReconcileEntityWrites']),
    'die Ausführ-Hälfte ruft den Schreiber'
);
assert(
    isset($publicationApply['avesmapsFeatureSourceUpsert']),
    'und dort DARF der Katalog gefüllt werden -- sonst prüft das Verbot oben nichts'
);
assert(
    array_filter($publicationApply, static fn(string $body): bool
        => str_contains($body, 'DELETE FROM feature_sources')) !== [],
    'die Ausführ-Hälfte enthält den Löscher -- sonst prüft der Lauf oben nichts'
);

// --- Der Typ-Riegel steht, wo er stehen muss ------------------------------------------------------
//
// Er ist das einzige, was einen nie gestagten Typ von einem Typ unterscheidet, dessen Artikel alle
// ihre Quellen verloren haben. Beide Hälften müssen ihn fragen: die Rechen-Hälfte, damit die Vorschau
// nicht 4.653 Verluste vorschlägt, und die Ausführ-Hälfte, weil zwischen Vorschau und Übernahme ein
// neues „Dump holen" beginnen kann.
assert(
    str_contains($bodies['avesmapsPublicationPlanStep'] ?? '', 'avesmapsPublicationStagingHasEntityType($pdo, $type)'),
    'die Rechen-Hälfte fragt den Typ-Riegel'
);
assert(
    str_contains($bodies['avesmapsPublicationApplyStep'] ?? '', 'avesmapsPublicationStagingHasEntityType('),
    'und die Ausführ-Hälfte fragt ihn noch einmal'
);

// ==================================================================================================
// VORKOMMEN (Sitzung 2). Hier ist die Löschung ein GRABSTEIN -- und auch ein Grabstein ist eine
// Handlung, kein Nebeneffekt des Rechnens.
// ==================================================================================================

$loreCompute = $reachFrom($bodies, ['avesmapsLorePlanStep']);
assert(count($loreCompute) >= 8, 'der Vorkommen-Lauf erreicht die aufgerufenen Funktionen (got ' . count($loreCompute) . ')');
foreach (['avesmapsLorePlanForCatalogRow', 'avesmapsLorePlanItem', 'avesmapsLoreRetirableRows',
    'avesmapsLorePlanStagingEmpty', 'avesmapsLoreFieldPlan', 'avesmapsLoreChildPlan',
    'avesmapsPublicationLinkDiffForPlan', 'avesmapsSyncPlanAddItem'] as $expected) {
    assert(isset($loreCompute[$expected]), "the walk reaches {$expected}");
}

$loreTables = ['lore_entry', 'lore_place', 'feature_sources', 'sources', 'wiki_lore_catalog',
    'wiki_lore_place_staging', 'map_audit_log'];
foreach ($loreCompute as $name => $body) {
    foreach ($loreTables as $table) {
        foreach ($forbiddenStatements($table) as $statement) {
            assert(
                !str_contains($body, $statement),
                "{$name} runs in the COMPUTE half and writes: {$statement}"
            );
        }
    }
}

// 🔴 Der Stilleger ist eine Handlung, kein Nebeneffekt -- und die Quellen erst recht.
assert(
    !isset($loreCompute['avesmapsLoreRetireWikiEntry']),
    'the compute half only PROPOSES the tombstone'
);
assert(!isset($loreCompute['avesmapsLoreApplyEntity']), 'and never reaches the entity writer');
assert(
    !isset($loreCompute['avesmapsPublicationReconcileEntity']),
    'the compute half must use the read-only source probe, not the reconcile that writes links'
);
// Das Stilllegen ist ein UPDATE auf status -- die Tabellen-Prüfung oben fängt es schon, aber diese
// Zusicherung nennt es beim Namen, damit ein Umbau die Absicht liest und nicht nur die Regel.
foreach ($loreCompute as $name => $body) {
    assert(!str_contains($body, "SET status = 'retired'"), "{$name} retires an entry in the compute half");
}

// 💣 UND DER LAUF MUSS BEISSEN.
$loreApply = $reachFrom($bodies, ['avesmapsLoreApplyStep']);
assert(isset($loreApply['avesmapsLoreApplyEntity']), 'die Ausführ-Hälfte ruft den Schreiber');
assert(isset($loreApply['avesmapsLoreRetireWikiEntry']), 'und den Stilleger');
assert(
    array_filter($loreApply, static fn(string $body): bool
        => str_contains($body, "SET status = 'retired'")) !== [],
    'die Ausführ-Hälfte legt wirklich still -- sonst prüft der Lauf oben nichts'
);
assert(
    array_filter($loreApply, static fn(string $body): bool
        => str_contains($body, 'INSERT INTO ') && str_contains($body, 'AVESMAPS_LORE_TABLE_ENTRY')) !== [],
    'und sie schreibt Einträge'
);

// --- Der Quellen-Riegel wird in BEIDEN Hälften gefragt ---------------------------------------------
// Leeres Lore-Staging heisst "weiss ich nicht", nie "es gibt keine Quellen" -- das ist der Beinah-Unfall
// vom 22.07. (~34.800 Verknüpfungen). Die Rechen-Hälfte fragt, damit die Vorschau keine Verluste
// vorschlägt; die Ausführ-Hälfte fragt erneut, weil zwischen beiden ein neues "Dump holen" beginnen kann.
foreach (['avesmapsLorePlanStep', 'avesmapsLoreApplyStep'] as $half) {
    assert(
        str_contains($bodies[$half] ?? '', "avesmapsPublicationStagingHasEntityType(\$pdo, 'lore')"),
        "{$half} fragt den Quellen-Riegel"
    );
}

// =================================================================================================
// Sitzung 4 -- die Wiki-Kopie der Herrschaftsgebiete
// =================================================================================================

$territoryWikiCompute = $reachFrom($bodies, ['avesmapsTerritoryWikiPlanStep']);
assert(count($territoryWikiCompute) >= 5, 'der Lauf erreicht die gerufenen Funktionen (' . count($territoryWikiCompute) . ')');
foreach (['avesmapsTerritoryWikiPlanItem', 'avesmapsTerritoryWikiVanishedRows', 'avesmapsSyncPlanAddItem'] as $expected) {
    assert(isset($territoryWikiCompute[$expected]), "der Lauf erreicht {$expected}");
}
// 💣 Der Schreiber der Kopie gehört der ANDEREN Hälfte.
assert(!isset($territoryWikiCompute['avesmapsPoliticalUpsertWikiRecord']), 'kein Upsert in der Rechen-Hälfte');
assert(!isset($territoryWikiCompute['avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey']), 'kein Relink');
foreach ($territoryWikiCompute as $name => $body) {
    foreach ($forbiddenTables as $table) {
        foreach ($forbiddenStatements($table) as $statement) {
            assert(!str_contains($body, $statement), "{$name} schreibt in {$table}");
        }
    }
}
// UND DER LAUF MUSS BEISSEN: die Ausführ-Hälfte findet dieselben Schreiber sehr wohl.
$territoryWikiApply = $reachFrom($bodies, ['avesmapsTerritoryWikiApplyStep']);
assert(isset($territoryWikiApply['avesmapsPoliticalUpsertWikiRecord']), 'die Ausführ-Hälfte ruft den Schreiber');
assert(isset($territoryWikiApply['avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey']), 'und den Relink');
assert(
    array_filter($territoryWikiApply, static fn(string $body): bool
        => str_contains($body, 'DELETE FROM political_territory_wiki ')) !== [],
    'und sie löscht wirklich -- sonst prüft der Lauf oben nichts'
);

// =================================================================================================
// Sitzung 4 -- die Karte
// =================================================================================================

$territoryCompute = $reachFrom($bodies, ['avesmapsTerritoryPlanStep']);
assert(count($territoryCompute) >= 5, 'der Lauf erreicht die gerufenen Funktionen (' . count($territoryCompute) . ')');
foreach (['avesmapsTerritoryPlanRoleShift', 'avesmapsTerritoryPlanNodeCounts', 'avesmapsTerritoryPlanParentMoves',
    'avesmapsWikiSyncMonitorApplyIdentityPreview'] as $expected) {
    assert(isset($territoryCompute[$expected]), "der Lauf erreicht {$expected}");
}
foreach ($territoryCompute as $name => $body) {
    // 💣 NAMED EXCEPTION (owner decision 2026-08-07), see the comment beside $forbiddenTables above:
    // avesmapsPoliticalEnsureTables is reached here (via avesmapsWikiSyncMonitorApplyIdentityPreview ->
    // avesmapsWikiSyncMonitorEnsureTables) and contains a self-healing backfill UPDATE on
    // political_territory.wiki_key. Skipped BY NAME, not by shrinking $forbiddenTables -- every other
    // function in this span (and every other span in this file) is still checked against the full list.
    if ($name === 'avesmapsPoliticalEnsureTables') {
        continue;
    }
    foreach ($forbiddenTables as $table) {
        foreach ($forbiddenStatements($table) as $statement) {
            assert(!str_contains($body, $statement), "{$name} schreibt in {$table}");
        }
    }
}
// 💣 Und NICHTS aus dem Aussengrenzen-System, in KEINER der beiden Hälften. Vier Fehler hingen an
// diesem Praedikat, der letzte fail OPEN und mitten im Speicherpfad.
foreach ([$territoryCompute, $reachFrom($bodies, ['avesmapsTerritoryApplyStep'])] as $span) {
    foreach ($span as $name => $body) {
        foreach (['DerivedGeometry', 'derived_geometry'] as $forbidden) {
            assert(!str_contains($body, $forbidden), "{$name} fasst {$forbidden} an");
        }
    }
}
// UND DER LAUF MUSS BEISSEN.
$territoryApply = $reachFrom($bodies, ['avesmapsTerritoryApplyStep']);
foreach (['avesmapsWikiSyncMonitorApplyParentCache', 'avesmapsWikiSyncMonitorApplyCustomNodes',
    'avesmapsWikiSyncMonitorApplyIdentity'] as $writer) {
    assert(isset($territoryApply[$writer]), "die Ausführ-Hälfte ruft {$writer}");
}
// 💣 Die Rechen-Hälfte erreicht die Bulk-Schreiber GAR NICHT -- auch nicht im Trockenlauf.
foreach (['avesmapsWikiSyncMonitorApplyParentCache', 'avesmapsWikiSyncMonitorApplyCustomNodes',
    'avesmapsWikiSyncMonitorApplyIdentity'] as $writer) {
    assert(!isset($territoryCompute[$writer]), "die Rechen-Hälfte erreicht {$writer}");
}

echo "sync-plan-purity ok\n";
