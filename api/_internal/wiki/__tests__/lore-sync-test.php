<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE override-safe diff core in api/_internal/wiki/lore-sync.php.
 * No DB, no dump -- hand-built row arrays only. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/lore-sync-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../lore-sync.php';

// ------------------------------------------------------------- FIELD PLAN ---
$current = ['name' => 'Kronenhirsch', 'gruppe' => '[[Hirsch]]', 'lebensraum' => '[[Wald]]', 'typ' => ''];
$desired = ['name' => 'Kronenhirsch', 'gruppe' => '[[Rothirsch]]', 'lebensraum' => '[[Steppe]]', 'typ' => ''];
$plan = avesmapsLoreFieldPlan($current, $desired, ['lebensraum' => 'manual']);
assert($plan['set'] === ['gruppe' => '[[Rothirsch]]']);   // changed & unprotected
assert($plan['origins'] === ['gruppe' => 'wiki']);
assert(!array_key_exists('name', $plan['set']));           // unchanged
assert(!array_key_exists('lebensraum', $plan['set']));     // hand-edited -> protected
echo "fieldplan ok\n";

// null vs '' must not produce a spurious write; a repeat reconcile is a no-op.
assert(avesmapsLoreFieldPlan(['synonyme' => null], ['synonyme' => ''], [])['set'] === []);
assert(avesmapsLoreFieldPlan(['gruppe' => '[[Gras]]'], ['gruppe' => '[[Gras]]'], ['gruppe' => 'wiki'])['set'] === []);
// A field the wiki says nothing about is left alone even if it differs.
assert(avesmapsLoreFieldPlan(['gruppe' => 'alt'], [], [])['set'] === []);
echo "fieldplan-idempotent ok\n";

// -------------------------------------------------------------- KEYS ---
assert(avesmapsLorePlaceKey(['place_wiki_key' => 'weiden', 'relation' => 'verbreitung']) === 'weiden|verbreitung');
// Same place, different relation = different rows: for goods "from there" and
// "traded there" are genuinely different statements.
assert(avesmapsLorePlaceKey(['place_wiki_key' => 'weiden', 'relation' => 'herkunft'])
    !== avesmapsLorePlaceKey(['place_wiki_key' => 'weiden', 'relation' => 'verbreitung']));
assert(avesmapsLorePlaceKey(['place_wiki_key' => '', 'relation' => 'verbreitung']) === '');
echo "keys ok\n";

// -------------------------------------------------------------- CHILD PLAN ---
$k = 'avesmapsLorePlaceKey';

// Fresh entry: everything is an add.
$plan = avesmapsLoreChildPlan([], [
    ['place_wiki_key' => 'weiden', 'relation' => 'verbreitung'],
    ['place_wiki_key' => 'tobrien', 'relation' => 'verbreitung'],
], $k);
assert(count($plan['add']) === 2 && $plan['remove'] === []);

// Unchanged: no add, no remove (idempotency).
$live = [['place_wiki_key' => 'weiden', 'relation' => 'verbreitung', 'origin' => 'wiki', 'status' => 'active']];
$plan = avesmapsLoreChildPlan($live, [['place_wiki_key' => 'weiden', 'relation' => 'verbreitung']], $k);
assert($plan['add'] === [] && $plan['remove'] === [] && $plan['kept'] === 1);

// Dropped in the wiki -> removed here.
$plan = avesmapsLoreChildPlan($live, [], $k);
assert($plan['add'] === [] && count($plan['remove']) === 1);
echo "childplan-basic ok\n";

// 💣 A MANUAL row is untouchable: never removed even when the wiki does not list it,
// and never re-added as a wiki row.
$manual = [['place_wiki_key' => 'moosgrund', 'relation' => 'verbreitung', 'origin' => 'manual', 'status' => 'active']];
$plan = avesmapsLoreChildPlan($manual, [], $k);
assert($plan['remove'] === []);
$plan = avesmapsLoreChildPlan($manual, [['place_wiki_key' => 'moosgrund', 'relation' => 'verbreitung']], $k);
assert($plan['add'] === [] && $plan['remove'] === []);
echo "childplan-manual ok\n";

// 💣 A SUPPRESSED wiki row is a tombstone: the editor removed it on purpose, so a
// later sync must not resurrect it even though the wiki still says otherwise.
$tomb = [['place_wiki_key' => 'aventurien', 'relation' => 'verbreitung', 'origin' => 'wiki', 'status' => 'suppressed']];
$plan = avesmapsLoreChildPlan($tomb, [['place_wiki_key' => 'aventurien', 'relation' => 'verbreitung']], $k);
assert($plan['add'] === [] && $plan['remove'] === [] && $plan['suppressed'] === 1);
echo "childplan-tombstone ok\n";

// Duplicates in the desired list collapse to one add (the wiki repeats links).
$plan = avesmapsLoreChildPlan([], [
    ['place_wiki_key' => 'weiden', 'relation' => 'verbreitung'],
    ['place_wiki_key' => 'weiden', 'relation' => 'verbreitung'],
], $k);
assert(count($plan['add']) === 1);

// Mixed: one kept, one added, one removed, manual untouched, tombstone respected.
$current = [
    ['place_wiki_key' => 'weiden', 'relation' => 'verbreitung', 'origin' => 'wiki', 'status' => 'active'],
    ['place_wiki_key' => 'tobrien', 'relation' => 'verbreitung', 'origin' => 'wiki', 'status' => 'active'],
    ['place_wiki_key' => 'moosgrund', 'relation' => 'verbreitung', 'origin' => 'manual', 'status' => 'active'],
    ['place_wiki_key' => 'aventurien', 'relation' => 'verbreitung', 'origin' => 'wiki', 'status' => 'suppressed'],
];
$desired = [
    ['place_wiki_key' => 'weiden', 'relation' => 'verbreitung'],
    ['place_wiki_key' => 'albernia', 'relation' => 'verbreitung'],
    ['place_wiki_key' => 'aventurien', 'relation' => 'verbreitung'],
];
$plan = avesmapsLoreChildPlan($current, $desired, $k);
assert(array_column($plan['add'], 'place_wiki_key') === ['albernia']);
assert(array_column($plan['remove'], 'place_wiki_key') === ['tobrien']);
assert($plan['suppressed'] === 1);
echo "childplan-mixed ok\n";

// SOURCES ARE NOT TESTED HERE ANY MORE -- and their absence is the point.
//
// Until 2026-07-22 this file also drove avesmapsLoreChildPlan with a source key, because lore
// owned its own lore_source table. It does not any more: lore sources live in the shared system
// (sources + feature_sources, entity_type='lore'), so their override safety is proven where the
// shared code lives -- __tests__/publication-sync-test.php for the reconcile diff. Re-adding
// source cases here would mean lore had grown a second source path again. AGENTS.md §5.

// -------------------------------------------------------------- CONTINENT ---
// PURE Kontext = Titel-Klammer „(Myranor)" + literale [[Kategorie:…]] (NICHT der Bar-Name oder
// Lebensraum -- sonst kapert „…er Güldenländer" die Erkennung ueber die 'guldenland'-Nadel).
assert(avesmapsLoreContinentContext('Fischerspinne (Myranor)', 'Fliesstext, Kategorie kommt aus Vorlage') === 'Myranor');
assert(avesmapsLoreContinentContext('Etwas', '[[Kategorie:Uthuria-Artikel]]') === 'Uthuria-Artikel');
assert(avesmapsLoreContinentContext('Fischerspinne (Myranor)', '[[Kategorie:Tier]]') === 'Myranor Tier');
// Kein Signal: Bar-Name ohne Klammer, keine literale Kategorie -> leer.
assert(avesmapsLoreContinentContext("Al'Anfaner Güldenländer", 'Fliesstext ohne Kategorie') === '');
echo "continent-context ok\n";

// Der Erkenner (avesmapsWikiSyncMonitorDetectContinent) kommt ueber die Parsing-Kette schon
// geladen; ist er es einmal nicht, faellt avesmapsLoreDetectContinent per Guard auf '' zurueck
// (= im Filter Aventurien). Beide Wege werden hier abgedeckt.
if (function_exists('avesmapsWikiSyncMonitorDetectContinent')) {
    assert(avesmapsLoreDetectContinent('Fischerspinne (Myranor)', 'prosa') === 'Myranor / Güldenland');
    assert(avesmapsLoreDetectContinent('Etwas', '[[Kategorie:Uthuria-Artikel]]') === 'Uthuria');
    // Klammer, aber kein Kontinent darin -> Default Aventurien.
    assert(avesmapsLoreDetectContinent('Güldenländer (Gewürz)', '') === 'Aventurien');
    // 💣 REGRESSION (live 2026-07-26): der Aventurien-Wein „Al'Anfaner Güldenländer" hat KEINE
    // Klammer und keine Kontinent-Kategorie -> leer (im Filter Aventurien), NICHT Myranor. Der
    // Bar-Name „Güldenländer" fliesst nicht mehr ein.
    assert(avesmapsLoreDetectContinent("Al'Anfaner Güldenländer", 'prosa ohne Kategorie') === '');
    echo "continent-detect ok\n";
} else {
    assert(avesmapsLoreDetectContinent('Fischerspinne (Myranor)', 'prosa') === '');
    echo "continent-detect (guard) ok\n";
}

echo "\nALL OK\n";
