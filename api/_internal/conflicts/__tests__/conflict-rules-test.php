<?php

declare(strict_types=1);

/**
 * Unit test for the conflict rules over fixture rows. No DB, no HTTP.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/conflicts/__tests__/conflict-rules-test.php
 * Exit 0 = all asserts passed.
 *
 * The rules themselves are thin; what is worth pinning is that the two noise filters actually fire
 * on data shaped like the real thing, and that a named way collapses to ONE case instead of one per
 * segment (1273 hand-named segments are only 1178 decisions).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}

require __DIR__ . '/../rules.php';

$rows = [
    // A road in three segments, all on one article -> legitimate, never a conflict.
    ['type' => 'path', 'id' => 'p1', 'label' => 'Reichsstraße 1', 'subtype' => 'Reichsstrasse', 'wiki_url' => 'https://w/wiki/Reichsstrasse_1'],
    ['type' => 'path', 'id' => 'p2', 'label' => 'Reichsstraße 1', 'subtype' => 'Reichsstrasse', 'wiki_url' => 'https://w/wiki/Reichsstrasse_1'],
    ['type' => 'path', 'id' => 'p3', 'label' => 'Reichsstraße 1', 'subtype' => 'Reichsstrasse', 'wiki_url' => 'https://w/wiki/Reichsstrasse_1'],
    // The owner's Heldenweiler: a place and a territory-ish label on one article -> error.
    ['type' => 'location', 'id' => 'l1', 'label' => 'Heldenweiler', 'subtype' => 'dorf', 'wiki_url' => 'https://w/wiki/Heldenweiler'],
    ['type' => 'label', 'id' => 'r1', 'label' => 'Heldenweiler', 'subtype' => 'region', 'wiki_url' => 'https://w/wiki/Heldenweiler'],
    // Hand-named ways without a key, one of them across four segments -> watchlist, ONE case each.
    ['type' => 'path', 'id' => 'p4', 'label' => 'Bernsteinroute', 'subtype' => 'Strasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p5', 'label' => 'Bernsteinroute', 'subtype' => 'Strasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p6', 'label' => 'Bernsteinroute', 'subtype' => 'Strasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p7', 'label' => 'Bernsteinroute', 'subtype' => 'Strasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p8', 'label' => 'Yasamirer Stieg', 'subtype' => 'Pfad', 'wiki_url' => ''],
    // Auto-named ways without a key -> NEVER on the watchlist (2448 of them live).
    ['type' => 'path', 'id' => 'p9', 'label' => 'Reichsstrasse-3633', 'subtype' => 'Reichsstrasse', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p10', 'label' => 'Weg-17', 'subtype' => 'Weg', 'wiki_url' => ''],
    ['type' => 'path', 'id' => 'p11', 'label' => 'Weg', 'subtype' => 'Weg', 'wiki_url' => ''],
    // A hand-made place without a key -> watchlist.
    ['type' => 'location', 'id' => 'l2', 'label' => 'Neudorf', 'subtype' => 'dorf', 'wiki_url' => ''],
];

// ---- rule 1: shared article --------------------------------------------------------------------
$shared = avesmapsConflictRuleSharedArticle($rows);
assert(count($shared) === 1);                                    // the road must NOT be in here
assert($shared[0]['rule_id'] === 'wiki.shared_article');
assert($shared[0]['severity'] === 'error');
assert($shared[0]['title'] === 'Heldenweiler');                   // title decoded from the url
assert(count($shared[0]['parties']) === 2);
$partyTypes = array_column($shared[0]['parties'], 'type');
sort($partyTypes);
assert($partyTypes === ['label', 'location']);                    // cross-type, exactly the owner's case
assert($shared[0]['parties'][0]['type_label'] !== '');            // German label reaches the screen
assert(preg_match('/^[a-f0-9]{64}$/', $shared[0]['fingerprint']) === 1);

// ---- the per-party evidence (owner: "ist Jergan im Wiki? ist Jergan (Wasserfall) im Wiki?") -----
// The index is keyed on the EXACT title, case-folded. This is the assertion that keeps #38 from
// coming back in through the evidence column: normalized_key would strip "(Wasserfall)" and claim
// the waterfall has its own article when it merely collides with the settlement's.
$wikiTitles = [
    'jergan' => ['title' => 'Jergan', 'url' => 'https://w/wiki/Jergan'],
    'heldenweiler' => ['title' => 'Heldenweiler', 'url' => 'https://w/wiki/Heldenweiler'],
];
$jerganRows = [
    ['type' => 'location', 'id' => 'j1', 'label' => 'Jergan', 'subtype' => 'dorf', 'wiki_url' => 'https://w/wiki/Jergan', 'position' => ['lat' => 1.0, 'lng' => 2.0]],
    ['type' => 'location', 'id' => 'j2', 'label' => 'Jergan (Wasserfall)', 'subtype' => 'dorf', 'wiki_url' => 'https://w/wiki/Jergan', 'position' => ['lat' => 3.0, 'lng' => 4.0]],
];
$jergan = avesmapsConflictRuleSharedArticle($jerganRows, $wikiTitles);
assert(count($jergan) === 1);
$byLabel = [];
foreach ($jergan[0]['parties'] as $party) {
    $byLabel[$party['label']] = $party;
}
// "Jergan" has an article of its own -> it is the plausible owner of the shared link.
assert($byLabel['Jergan']['own_wiki']['title'] === 'Jergan');
// "Jergan (Wasserfall)" has NONE -- and must not inherit Jergan's just because the key would fold.
assert($byLabel['Jergan (Wasserfall)']['own_wiki'] === null);
// Each party carries where it sits, so the editor can look at it before deciding.
assert($byLabel['Jergan']['position']['lat'] === 1.0);
assert($byLabel['Jergan (Wasserfall)']['position']['lng'] === 4.0);

// ---- rule 2: missing key, before collapsing -----------------------------------------------------
$missing = avesmapsConflictRuleMissingKey($rows);
$missingLabels = array_column($missing, 'title');
sort($missingLabels);
// 4x Bernsteinroute + Yasamirer Stieg + Neudorf = 6 rows; the three auto-named ways are gone.
assert(count($missing) === 6);
assert(!in_array('Reichsstrasse-3633', $missingLabels, true));
assert(!in_array('Weg-17', $missingLabels, true));
assert(!in_array('Weg', $missingLabels, true));
assert(in_array('Neudorf', $missingLabels, true));
foreach ($missing as $conflict) {
    assert($conflict['severity'] === 'unverified');               // watchlist, not a to-do
}

// ---- rule 2: after collapsing a named way to one case -------------------------------------------
$collapsed = avesmapsConflictCollapsePathsByName($missing);
assert(count($collapsed) === 3);                                  // Bernsteinroute, Yasamirer Stieg, Neudorf
$byTitle = [];
foreach ($collapsed as $conflict) {
    $byTitle[$conflict['title']] = $conflict;
}
assert(isset($byTitle['Bernsteinroute'], $byTitle['Yasamirer Stieg'], $byTitle['Neudorf']));
assert($byTitle['Bernsteinroute']['segments'] === 4);             // the count survives as information
assert($byTitle['Yasamirer Stieg']['segments'] === 1);
// A non-path case must pass through untouched -- no 'segments' key invented for it.
assert(!isset($byTitle['Neudorf']['segments']));

// ---- fingerprints are stable across runs and distinct per case ----------------------------------
$again = avesmapsConflictRuleSharedArticle($rows);
assert($again[0]['fingerprint'] === $shared[0]['fingerprint']);
$allPrints = array_merge(array_column($shared, 'fingerprint'), array_column($collapsed, 'fingerprint'));
assert(count($allPrints) === count(array_unique($allPrints)));

fwrite(STDOUT, "conflict-rules-test: alle Zusicherungen erfuellt\n");
