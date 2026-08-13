<?php

declare(strict_types=1);

// Reine Array-Funktion: avesmapsLoreMergeRuleHitsIntoResult (api/_internal/app/lore.php)
// mischt Regeltreffer (avesmapsLoreReadEntriesForRuleHits) in ein fertiges
// avesmapsLoreReadForPlaces-Ergebnis -- kein PDO noetig, zwei Fixture-Arrays reichen.
// Fix-Runde 1, Befund 2: diese Funktion war bislang vollstaendig ungetestet, obwohl dort die
// Zusage wohnt, die der Brief eigens hervorhebt -- ein Eintrag, der ueber einen genannten Ort
// UND ueber eine Regel hereinkommt, bleibt einmal drin, mit dem kleineren Rang.

if (!assert_options(ASSERT_ACTIVE)) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1 -- assert() is a no-op otherwise\n");
    exit(1);
}

require_once __DIR__ . '/../lore.php';

// Leeres Grundgeruest wie avesmapsLoreReadForPlaces es zurueckgibt: alle vier Sektionen als
// leere Liste, Zaehler auf 0.
$emptyResult = static function (): array {
    $out = ['sections' => [], 'counts' => [], 'total' => 0];
    foreach (AVESMAPS_LORE_KINDS as $kind) {
        $out['sections'][$kind] = [];
        $out['counts'][$kind] = 0;
    }

    return $out;
};

// --- Aussage 1: ein Eintrag, den NUR die Regel trifft, kommt neu hinein (rank 1) -------------
$result = $emptyResult();
$ruleRows = [[
    'wiki_key' => 'einbeere', 'kind' => 'flora', 'name' => 'Einbeere', 'wiki_url' => 'https://x/einbeere',
    'gruppe' => '', 'typ' => '', 'lebensraum' => '', 'relations' => ['verbreitung'], 'place_title' => '', 'rank' => 1,
]];
$merged = avesmapsLoreMergeRuleHitsIntoResult($result, $ruleRows, false);
assert($merged['counts']['flora'] === 1);
assert($merged['total'] === 1);
assert(count($merged['sections']['flora']) === 1);
assert($merged['sections']['flora'][0]['wiki_key'] === 'einbeere');
assert($merged['sections']['flora'][0]['rank'] === 1);
assert($merged['sections']['flora'][0]['relations'] === ['verbreitung']);
// 'kind' steuert nur die Einsortierung in die richtige Sektion, gehoert aber nicht in die Zeile
// selbst -- dieselbe Form wie $byKind in avesmapsLoreReadForPlaces.
assert(!array_key_exists('kind', $merged['sections']['flora'][0]));
// Andere Sektionen bleiben unberuehrt.
assert($merged['sections']['fauna'] === []);
assert($merged['counts']['fauna'] === 0);

// --- Aussage 2: Ort UND Regel treffen denselben Eintrag -- er bleibt EINMAL, kleinerer Rang --
$result = $emptyResult();
$result['sections']['flora'] = [[
    'wiki_key' => 'bergwald-baum', 'name' => 'Bergwaldbaum', 'wiki_url' => '', 'gruppe' => '', 'typ' => '',
    'lebensraum' => '', 'relations' => ['verbreitung'], 'place_title' => 'Weiden', 'rank' => 0,
]];
$result['counts']['flora'] = 1;
$result['total'] = 1;
$ruleRows = [[
    'wiki_key' => 'bergwald-baum', 'kind' => 'flora', 'name' => 'Bergwaldbaum', 'wiki_url' => '',
    'gruppe' => '', 'typ' => '', 'lebensraum' => '', 'relations' => ['herkunft'], 'place_title' => '', 'rank' => 1,
]];
$merged = avesmapsLoreMergeRuleHitsIntoResult($result, $ruleRows, false);
assert(count($merged['sections']['flora']) === 1, 'bleibt EINMAL drin, kein zweiter Eintrag');
assert($merged['counts']['flora'] === 1, 'kein neuer Eintrag gezaehlt -- derselbe wiki_key war schon da');
assert($merged['total'] === 1);
assert($merged['sections']['flora'][0]['rank'] === 0,
    'der Ortstreffer (Rang 0) ist spezifischer als die Regel (Rang 1) -- der kleinere Rang gewinnt');
$relations = $merged['sections']['flora'][0]['relations'];
sort($relations);
assert($relations === ['herkunft', 'verbreitung'], 'Relationen werden vereinigt, nicht ersetzt');

// --- Aussage 3: place_title aus einem Ortstreffer wird von der Regel NICHT ueberschrieben -----
// Anders als Aussage 2 VERBESSERT sich hier der Rang (3 -> 1) -- und genau dieser Zweig ist die
// Falle: avesmapsLoreReadForPlaces kopiert beim Rangwechsel bewusst auch place_title mit (dort
// richtig, weil beide Kandidaten einen echten Ort tragen). Ein Regeltreffer hat KEINEN Ort;
// dieselbe Zeile hierher kopiert wuerde 'Aventurien' lautlos durch '' ersetzen.
$result = $emptyResult();
$result['sections']['flora'] = [[
    'wiki_key' => 'sumpfkraut', 'name' => 'Sumpfkraut', 'wiki_url' => '', 'gruppe' => '', 'typ' => '',
    'lebensraum' => '', 'relations' => ['verbreitung'], 'place_title' => 'Aventurien', 'rank' => 3,
]];
$result['counts']['flora'] = 1;
$result['total'] = 1;
$ruleRows = [[
    'wiki_key' => 'sumpfkraut', 'kind' => 'flora', 'name' => 'Sumpfkraut', 'wiki_url' => '',
    'gruppe' => '', 'typ' => '', 'lebensraum' => '', 'relations' => ['verbreitung'], 'place_title' => '', 'rank' => 1,
]];
$merged = avesmapsLoreMergeRuleHitsIntoResult($result, $ruleRows, false);
assert(count($merged['sections']['flora']) === 1);
assert($merged['sections']['flora'][0]['rank'] === 1,
    'die Regel (Rang 1) ist spezifischer als kontinentweit (Rang 3) -- der Rang verbessert sich');
assert($merged['sections']['flora'][0]['place_title'] === 'Aventurien',
    'place_title bleibt stehen, obwohl sich der Rang aendert -- die Regel hat keinen Ort');

echo "lore-merge-rule-hits: OK\n";
