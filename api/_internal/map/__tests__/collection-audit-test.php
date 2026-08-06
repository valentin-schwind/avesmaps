<?php

declare(strict_types=1);

/**
 * Finding A16, stage 1: the three HARD deletions in the citymap, adventure and lore libraries left no
 * trace at all. Move a label by three pixels and it is in the change log and can be taken back; delete
 * an adventure (1.352 rows), a citymap (457) or an occurrence (5.104) and it was simply gone.
 *
 * This file tests the pure parts and the wiring. The sister file collection-audit-write-test.php runs
 * the writer against a real table -- "the function is called" and "a row exists afterwards" are two
 * different statements, and the 06.08.2026 session got caught by that difference repeatedly.
 *
 * Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/collection-audit-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../collection-audit.php';

// ---- 💣 None of these may ever become undoable ----------------------------------------------------
//
// Stage 1 writes a trail, it does not build a way back: the tables have no soft delete, so an "undo"
// button would promise something no code can deliver. avesmapsCanUndoAuditAction() says no because
// these names are neither in the create LIST, nor delete_feature, nor carry undo columns -- a
// consequence, not a decision, so it is asserted rather than trusted. A future name starting with
// "create_" would flip it silently, and the change log offers the button server-side and client-side
// from this one function.
foreach (AVESMAPS_COLLECTION_AUDIT_ACTIONS as $action) {
    assert(
        avesmapsCanUndoAuditAction($action) === false,
        "the collection action {$action} must never be undoable (stage 1 has no way back)"
    );
    assert(
        avesmapsIsCreateAuditAction($action) === false,
        "{$action} is not a create action -- that list is what makes an entry restorable"
    );
    assert(
        avesmapsUndoColumnsForAuditAction($action) === [],
        "{$action} carries no undo columns"
    );
}

// The vocabulary itself, so a rename has to come past this line.
//
// ⚠️ apply_sync_plan (2026-08-06) is not a deletion but a confirmed Übernahme-Vorschau -- ONE row per
// run, never one per entry. It sits in the same list because it is under the same no-undo rule, which
// the loop above has just asserted for it along with the other four.
$expectedActions = ['delete_citymap', 'delete_adventure', 'delete_lore_place', 'suppress_lore_place',
    'apply_sync_plan'];
sort($expectedActions);
$actualActions = AVESMAPS_COLLECTION_AUDIT_ACTIONS;
sort($actualActions);
assert($actualActions === $expectedActions, 'the five actions the collection log knows');

assert(avesmapsCollectionAuditActionIsKnown('delete_citymap'), 'a known action passes');
assert(!avesmapsCollectionAuditActionIsKnown('delete_feature'), 'a map-feature action is not one of ours');
assert(!avesmapsCollectionAuditActionIsKnown(''), 'and empty is not an action');

// ---- 💣 THE TRAP OF §3, AND ONE STEP FURTHER ------------------------------------------------------
//
// The design warns that a citymap id in feature_id hits an unrelated map object through
// `LEFT JOIN map_features features ON features.id = audit.feature_id` -- the id spaces are separate but
// the numbers overlap. feature_id therefore stays NULL (asserted in the sister file, against a table).
//
// What the design does NOT say, and what costs just as much: avesmapsNormalizeAuditRow lifts
// `public_id`, `feature_type` and `feature_subtype` OUT OF after_json when the join found nothing
// (audit-log.php:109-111). A citymap public_id landing there makes renderChangeLog treat the entry as
// focusable (`canFocusEntry`), so the editor gets a button that answers "Objekt ist nicht mehr aktiv
// oder wurde noch nicht neu geladen." -- a false error for a deletion that worked. That is the exact
// bug A4 wrote the "Nur was sich zeigen lässt, ist ein Knopf" comment for.
//
// So the identity travels under its own name and these keys are dropped, whatever a caller passes.
assert(
    AVESMAPS_COLLECTION_AUDIT_RESERVED_KEYS === ['public_id', 'feature_type', 'feature_subtype', 'geometry_json'],
    'the keys the audit reader would lift into a map-object claim'
);

$smuggled = avesmapsBuildCollectionAuditSnapshots(
    [
        'name' => 'Havena',
        'public_id' => '2f0d8f7a-0000-4000-8000-000000000001',
        'feature_type' => 'location',
        'feature_subtype' => 'stadt',
        'geometry_json' => '{"type":"Point","coordinates":[1,2]}',
        'citymap_public_id' => '2f0d8f7a-0000-4000-8000-000000000001',
    ],
    ['name' => 'Havena', 'public_id' => 'x', 'deleted' => true],
    ''
);
$smuggledBefore = json_decode($smuggled['before'], true);
$smuggledAfter = json_decode($smuggled['after'], true);
foreach (AVESMAPS_COLLECTION_AUDIT_RESERVED_KEYS as $reserved) {
    assert(!array_key_exists($reserved, $smuggledBefore), "{$reserved} must not survive into the before snapshot");
    assert(!array_key_exists($reserved, $smuggledAfter), "{$reserved} must not survive into the after snapshot");
}
assert($smuggledBefore['citymap_public_id'] === '2f0d8f7a-0000-4000-8000-000000000001', 'the identity travels under its own key');
// ⚠️ The reader falls back to after_json for the displayed name. Without it the change log reads
// "Unbenannt" and answers "somebody deleted something".
assert($smuggledBefore['name'] === 'Havena' && $smuggledAfter['name'] === 'Havena', 'the name travels in BOTH snapshots');
assert($smuggledAfter['deleted'] === '1', 'a bool is written as a flag, not as JSON true/false');

// Null and non-scalar values are dropped rather than serialised as "" or "Array".
$sparse = avesmapsBuildCollectionAuditSnapshots(
    ['name' => 'Ohne alles', 'origin' => null, 'places' => ['a', 'b'], 'count' => 0],
    ['name' => 'Ohne alles'],
    ''
);
$sparseBefore = json_decode($sparse['before'], true);
assert(!array_key_exists('origin', $sparseBefore), 'a null column is left out, not written as ""');
assert(!array_key_exists('places', $sparseBefore), 'an array is left out, not written as "Array"');
assert($sparseBefore['count'] === '0', 'a zero is a value, not an absence');

// ---- The actor: a person, or an honest note that it was not one -----------------------------------
//
// Mirrors A39: NULL means "no human", and the note rides in after_json rather than in a user id that
// nobody can look up. Nothing passes NULL today (all three doors are behind the editor login), but the
// wiki citymap sync deletes citymaps through its own path (citymap-sync.php) and is the obvious next
// caller -- a signature that cannot say "it was not a person" is how A39 happened.
$machine = avesmapsBuildCollectionAuditSnapshots(['name' => 'X'], ['name' => 'X'], AVESMAPS_COLLECTION_AUDIT_ACTOR_SYSTEM);
$machineAfter = json_decode($machine['after'], true);
$machineBefore = json_decode($machine['before'], true);
assert($machineAfter['actor_source'] === 'system', 'the note says who it was instead');
// ⚠️ Only in the after. In the before it would blame the system for the state that existed earlier.
assert(!array_key_exists('actor_source', $machineBefore), 'the note is not in the previous state');
$human = avesmapsBuildCollectionAuditSnapshots(['name' => 'X'], ['name' => 'X'], '');
assert(!array_key_exists('actor_source', json_decode($human['after'], true)), 'a human carries no note');

// 💣 The audit writer must accept a NULL feature id, or none of this can be written at all. Asserted
// through reflection: it is the behaviour that matters, not the spelling.
require_once __DIR__ . '/../features.php';
$writerParams = (new ReflectionFunction('avesmapsWriteMapAuditLog'))->getParameters();
assert($writerParams[1]->getName() === 'featureId' && $writerParams[1]->allowsNull(), 'feature_id is nullable');

// ---- 💣 The three libraries must actually call this ------------------------------------------------
//
// Asserting the library alone proves nothing about what ships -- this project has had a green test on
// top of a live bug for exactly that reason. Read as text: requiring them would pull in MySQL DDL.
$citymapSource = file_get_contents(__DIR__ . '/../../app/citymaps.php');
$adventureSource = file_get_contents(__DIR__ . '/../../app/adventures.php');
$loreSource = file_get_contents(__DIR__ . '/../../app/lore-edit.php');
assert(is_string($citymapSource) && is_string($adventureSource) && is_string($loreSource), 'the three libraries are readable');

/**
 * The body of one function with all COMMENTS REMOVED, so an assertion cannot pass on a match somewhere
 * else in the file -- and, more importantly, cannot pass on a call that is commented out.
 *
 * 💣 This was the first version's mistake, caught by running the mutation: prefixing the audit call
 * with `// ` left every str_contains() below true and the whole file green, while a deleted citymap
 * went back to leaving no trace. Presence is not execution -- the same lesson this project has now
 * learned for "position is not effect" and "the name is there but the gate never fires".
 */
$bodyOf = static function (string $source, string $signature): string {
    $start = strpos($source, $signature);
    assert(is_int($start), "the function is where it is expected: {$signature}");
    $end = strpos($source, "\n}", $start);
    assert(is_int($end), "and its body can be isolated: {$signature}");
    $body = substr($source, $start, $end - $start);

    // Block comments first (a /* … */ around the call is the same mutation in another spelling), then
    // whole-line // comments. Only comment-ONLY lines go: a trailing // after code cannot hide a call.
    $body = (string) preg_replace('#/\*.*?\*/#s', '', $body);

    return (string) preg_replace('#^[ \t]*//[^\n]*$#m', '', $body);
};

$deleteCitymapBody = $bodyOf($citymapSource, 'function avesmapsDeleteCitymap(');
$deleteAdventureBody = $bodyOf($adventureSource, 'function avesmapsDeleteAdventure(');
$removeLorePlaceBody = $bodyOf($loreSource, 'function avesmapsLoreRemovePlace(');

// ⚠️ Anchored at FUNCTION-BODY indentation (a newline and exactly four spaces). The second net after
// the comment stripping above: wrapping the call in `if (false) {` or in a branch that never runs would
// indent it further, and this pattern then goes red as well.
assert(
    preg_match("/\n {4}avesmapsLogCollectionDeletion\(\\\$pdo, 'delete_citymap',/", $deleteCitymapBody) === 1,
    'deleting a citymap writes a trail, unconditionally'
);
assert(
    preg_match("/\n {4}avesmapsLogCollectionDeletion\(\\\$pdo, 'delete_adventure',/", $deleteAdventureBody) === 1,
    'deleting an adventure writes a trail, unconditionally'
);
assert(
    preg_match("/\n {4}avesmapsLogCollectionDeletion\(/", $removeLorePlaceBody) === 1
        && preg_match(
            '/\$action = \$suppress \? \'suppress_lore_place\' : \'delete_lore_place\';/',
            $removeLorePlaceBody
        ) === 1,
    'removing an occurrence says WHICH of the two things happened -- tombstone or gone'
);

// 🔴 AND AFTER THE DELETION, NOT BEFORE. Above the commit the log would claim a deletion that a
// rollback then undid. A log that claims more than happened is worse than none, and the source does not
// show this ordering unless you ask for it (the same assert A39 needed).
$commitAt = strpos($deleteCitymapBody, '$pdo->commit();');
$logAt = strpos($deleteCitymapBody, 'avesmapsLogCollectionDeletion(');
assert(is_int($commitAt) && is_int($logAt) && $commitAt < $logAt, 'the citymap trail is written after the commit');
$commitAt = strpos($deleteAdventureBody, '$pdo->commit();');
$logAt = strpos($deleteAdventureBody, 'avesmapsLogCollectionDeletion(');
assert(is_int($commitAt) && is_int($logAt) && $commitAt < $logAt, 'the adventure trail is written after the commit');

// ⚠️ And the previous state has to be READ before the row is gone -- afterwards there is no `before`.
$readAt = strpos($removeLorePlaceBody, 'SELECT origin, place_title FROM lore_place');
$writeAt = strpos($removeLorePlaceBody, 'DELETE FROM lore_place');
assert(is_int($readAt) && is_int($writeAt) && $readAt < $writeAt, 'the occurrence is read before it is deleted');

// 💣 The library has to LOAD the writer, or the call is an undefined function that the writer's own
// try/catch cannot even see. Loaded inside the delete function on purpose: app/citymaps.php and
// app/adventures.php are on PUBLIC read paths (api/app/citymaps.php, map-search.php, report-location.php)
// and must not carry map/features.php on every visitor request.
foreach (
    [
        'citymap' => $deleteCitymapBody,
        'adventure' => $deleteAdventureBody,
        'lore' => $removeLorePlaceBody,
    ] as $label => $body
) {
    assert(
        str_contains($body, "require_once __DIR__ . '/../map/collection-audit.php';"),
        "the {$label} delete loads the audit library itself rather than hoping a caller did"
    );
}
// The other half of that rule: NOT at file scope, or every public read pays for it.
foreach (['citymaps' => $citymapSource, 'adventures' => $adventureSource] as $label => $source) {
    assert(
        preg_match('#^require(_once)? __DIR__ \. \'/\.\./map/#m', (string) $source) !== 1,
        "app/{$label}.php does not pull the map library in at file scope -- it is on a public read path"
    );
}

// 💣 And every audit write from these files passes NULL as the feature id. This is the assertion §5 of
// the design asks for, and it is the one that catches the trap of §3 at the source.
foreach (
    ['citymaps.php' => $citymapSource, 'adventures.php' => $adventureSource, 'lore-edit.php' => $loreSource,
        'collection-audit.php' => file_get_contents(__DIR__ . '/../collection-audit.php')] as $file => $source
) {
    assert(is_string($source), "{$file} is readable");
    preg_match_all('/avesmapsWriteMapAuditLog\(\s*\$[A-Za-z_]+\s*,\s*([^,]+),/', (string) $source, $matches);
    foreach ($matches[1] as $featureIdArgument) {
        assert(
            trim($featureIdArgument) === 'null',
            "{$file} writes an audit row with a non-NULL feature id ({$featureIdArgument}) -- "
                . 'a citymap/adventure id in feature_id LEFT JOINs onto an unrelated map object'
        );
    }
}

// ---- The three endpoints must hand the user down ---------------------------------------------------
//
// citymaps.php already kept $user; adventures.php and lore.php threw the return value of
// avesmapsRequireUserWithCapability away, so without this the trail would say "system" for a person who
// is sitting right there and is logged in.
$citymapEndpoint = file_get_contents(__DIR__ . '/../../../edit/map/citymaps.php');
$adventureEndpoint = file_get_contents(__DIR__ . '/../../../edit/map/adventures.php');
$loreEndpoint = file_get_contents(__DIR__ . '/../../../edit/map/lore.php');
assert(
    str_contains($citymapEndpoint, 'avesmapsDeleteCitymap($pdo, $publicId, $user)'),
    'the citymap endpoint names the acting editor'
);
assert(
    str_contains($adventureEndpoint, 'avesmapsDeleteAdventure($pdo, $publicId, $user)')
        && str_contains($adventureEndpoint, "\$user = avesmapsRequireUserWithCapability('edit');"),
    'the adventure endpoint keeps the user it authenticated'
);
assert(
    str_contains($loreEndpoint, "\$user = avesmapsRequireUserWithCapability('edit');")
        && preg_match('/avesmapsLoreRemovePlace\(\s*\$pdo,.*?\$user\s*\)/s', $loreEndpoint) === 1,
    'the lore endpoint keeps the user it authenticated'
);

// ---- The change log has to be able to name them ----------------------------------------------------
//
// Without a label formatChangeAction falls back to the raw action name, so the editor reads
// "delete_lore_place" -- true, but not German and not an answer.
$panelSource = file_get_contents(__DIR__ . '/../../../../js/review/review-panels-change-log.js');
assert(is_string($panelSource) && $panelSource !== '', 'the change-log panel is readable');
foreach (AVESMAPS_COLLECTION_AUDIT_ACTIONS as $action) {
    assert(
        preg_match('/\b' . preg_quote($action, '/') . ':\s*"[^"]+"/', $panelSource) === 1,
        "the change log has a German label for {$action}"
    );
}
// ⚠️ The two lore actions must not read the same, or the list stops answering the one question that
// matters here: is there a way back? A tombstone can be taken back with "Ort wieder aufnehmen"; a
// deleted manual row cannot.
preg_match('/\bdelete_lore_place:\s*"([^"]+)"/', $panelSource, $deleteLabel);
preg_match('/\bsuppress_lore_place:\s*"([^"]+)"/', $panelSource, $suppressLabel);
assert(
    ($deleteLabel[1] ?? 'a') !== ($suppressLabel[1] ?? 'b'),
    'a tombstone and a hard delete do not read the same in the change log'
);

echo "collection-audit ok\n";
