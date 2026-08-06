<?php

declare(strict_types=1);

/**
 * The pure rules of the Übernahme foundation (design §2/§5/§8). No DB, no clock. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/sync-plan-test.php
 * Exit 0 = all asserts passed.
 *
 * These four functions are the whole behaviour contract of the preview: what arrives pre-checked,
 * what a decision is keyed by, when a stored plan has gone stale, and what the tile counts. Everything
 * else in sync-plan.php is SQL around them.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-plan.php';

// --- Pre-checking (design §2) --------------------------------------------------------------------

assert(avesmapsSyncPlanDefaultSelected('new', 0) === 1, 'Neu ist vorangehaekelt');
assert(avesmapsSyncPlanDefaultSelected('new', 9) === 1, 'auch nach Ueberspringen -- Neu kennt keinen Zaehler');
assert(avesmapsSyncPlanDefaultSelected('changed', 0) === 1, 'Geaendert ist vorangehaekelt');
assert(avesmapsSyncPlanDefaultSelected('changed', 1) === 1, 'einmal stehen gelassen: noch vorangehaekelt');
// 💣 From the SECOND skip on it is not: one "not now" is a mood, two is an answer.
assert(avesmapsSyncPlanDefaultSelected('changed', 2) === 0, 'zweimal Nein -> nicht mehr vorangehaekelt');
assert(avesmapsSyncPlanDefaultSelected('changed', 7) === 0);
// 🔴 A deletion is NEVER pre-checked, whatever happened before. This is the core of the design, not a
// preference: a deletion has to be an act, not the default a tired click confirms.
assert(avesmapsSyncPlanDefaultSelected('deleted', 0) === 0, 'Loeschen ist nie vorangehaekelt');
assert(avesmapsSyncPlanDefaultSelected('deleted', 5) === 0);

// --- The decision key ----------------------------------------------------------------------------
//
// 💣 TWO MEANINGS IN ONE TABLE (design §5). The same entry can carry a declined deletion AND a
// skipped change. Drop change_type from the key and one silently overwrites the other -- a declined
// deletion would be reset by the next skipped change, and the deletion would be proposed again.
assert(
    avesmapsSyncPlanDecisionKey('stadtplanindex:havena', 'deleted')
        !== avesmapsSyncPlanDecisionKey('stadtplanindex:havena', 'changed'),
    'Loeschung und Aenderung derselben Zeile sind zwei Entscheidungen'
);
assert(
    avesmapsSyncPlanDecisionKey('a', 'changed') === avesmapsSyncPlanDecisionKey('a', 'changed'),
    'und derselbe Schluessel ist stabil'
);
// ⚠️ The separator must be a character no wiki_key can contain, or two different entities could
// collide into one decision. avesmapsCitymapWikiKey builds single-line keys from page titles.
assert(str_contains(avesmapsSyncPlanDecisionKey('a', 'changed'), "\n"), 'getrennt durch ein Zeichen, das kein wiki_key traegt');

// --- Staleness (design §4a/§8) -------------------------------------------------------------------

$stored = ['title' => 'Havena – Hafenviertel', 'has_scale' => '1'];
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena – Hafenviertel', 'has_scale' => '1']) === false);
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena, Hafen', 'has_scale' => '1']) === true, 'Wert weicht ab');
assert(avesmapsSyncPlanIsStale($stored, ['title' => 'Havena – Hafenviertel']) === true, 'Feld fehlt jetzt');
assert(
    avesmapsSyncPlanIsStale($stored, ['title' => 'Havena – Hafenviertel', 'has_scale' => '1', 'author' => 'X']) === true,
    'ein Feld ist dazugekommen'
);
assert(avesmapsSyncPlanIsStale($stored, null) === true, 'nichts mehr zu tun -> veraltet, nicht ausfuehren');
// 💣 Compared by KEY, not by the JSON string: json_encode preserves insertion order, so two runs that
// agree on every value but disagree on field order would look stale forever and nothing would apply.
assert(avesmapsSyncPlanIsStale($stored, ['has_scale' => '1', 'title' => 'Havena – Hafenviertel']) === false);
// null and '' both mean "unknown" in this schema (avesmapsCitymapReconcilePlan says so) -- a plan that
// stored null and now reads '' has NOT changed.
assert(avesmapsSyncPlanIsStale(['author' => null], ['author' => '']) === false, 'null und "" sind dasselbe Unbekannt');
assert(avesmapsSyncPlanIsStale(null, null) === false, 'eine Loeschzeile hat kein after_json');
assert(avesmapsSyncPlanIsStale([], []) === false);

// --- Counting -------------------------------------------------------------------------------------

$counts = avesmapsSyncPlanCountsFromItems([
    ['change_type' => 'new'],
    ['change_type' => 'new'],
    ['change_type' => 'changed'],
    ['change_type' => 'deleted'],
]);
assert($counts === ['new' => 2, 'changed' => 1, 'deleted' => 1, 'total' => 4], 'die Kachel-Zahlen');
assert(avesmapsSyncPlanCountsFromItems([]) === ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0]);
// An unknown change_type is counted in the total but invents no category -- the three are the contract.
$odd = avesmapsSyncPlanCountsFromItems([['change_type' => 'renamed']]);
assert($odd === ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 1]);

echo "sync-plan ok\n";
