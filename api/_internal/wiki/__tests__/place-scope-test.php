<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE innerorts/ausserorts classifier in
 * api/_internal/wiki/place-scope.php. No DB, no HTTP.
 *
 * Most fixtures below are VERBATIM field values from Wiki Aventurica, captured
 * during the 2026-07-27 measurement run -- including every case that run flagged
 * as wrong or borderline. Real values are used wherever one exists, because the
 * whole question was whether real wiki fields carry the signal. The handful of
 * CONSTRUCTED cases are marked as such inline; they cover boundaries the corpus
 * happens not to contain (word-boundary traps, a malformed index).
 *
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/place-scope-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../place-scope.php';

// Live-shaped index: settlements avesmaps has on the map, and the region /
// territory names that collide with some of them.
$settlements = avesmapsPlaceScopeBuildNameSet([
    'Gareth', 'Khunchom', 'Grangor', 'Elenvina', 'Punin', 'Vinsalt', 'Festum', 'Xorlosch',
    'Mengbilla', 'Ragath', 'Andergast', 'Albenhus', 'Fairnhain', 'Abagund', 'Drôl', 'Greifenfurt',
    'Mendlicum', 'Winhall', "H'Rabaal", 'Yol-Ghurmak',
]);
$regions = avesmapsPlaceScopeBuildNameSet([
    'Koschberge', 'Greings Klamm', 'Eisenwald', 'Grenzmark', 'Almada', 'Bornland (Region)',
    'Festenland', 'Lahmaria', 'Ehernes Schwert', 'Südaventurien', 'Liebliches Feld',
    // The collision set: each of these is ALSO a settlement above.
    'Abagund', 'Drôl', 'Greifenfurt',
]);

$scope = static function (string $raw) use ($settlements, $regions): string {
    return avesmapsPlaceScopeClassify($raw, $settlements, $regions)['scope'];
};
$where = static function (string $raw) use ($settlements, $regions): string {
    return avesmapsPlaceScopeClassify($raw, $settlements, $regions)['settlement'];
};

// ------------------------------------------------------------------- LINKS ---
assert(avesmapsPlaceScopeExtractLinks('[[Koschberge]]: [[Greings Klamm]]') === ['Koschberge', 'Greings Klamm']);
// Pipe: the TARGET is read, never the display text. This is what keeps
// "[[Bornland (Region)|Bornland]]" from being mistaken for a settlement.
assert(avesmapsPlaceScopeExtractLinks('[[Bornland (Region)|Bornland]]') === ['Bornland (Region)']);
assert(avesmapsPlaceScopeExtractLinks('[[Gareth]] ([[Alt-Gareth]])') === ['Gareth', 'Alt-Gareth']);
assert(avesmapsPlaceScopeExtractLinks('') === []);
assert(avesmapsPlaceScopeExtractLinks('Quad Basari') === []); // unlinked prose is not a link
echo "links ok\n";

// ----------------------------------------------------------- BUILDINGS: IN ---
// Real |Standort= values of articles the measurement classified as inside.
assert($scope('[[Gareth]]: [[Arenaviertel (Alt-Gareth)|Arenaviertel]]') === AVESMAPS_PLACE_SCOPE_INSIDE);
assert($where('[[Gareth]]: [[Arenaviertel (Alt-Gareth)|Arenaviertel]]') === 'Gareth'); // coarsest wins
assert($scope('[[Elenvina]]: [[Gülden]]: [[Akademie der Herrschaft]]') === AVESMAPS_PLACE_SCOPE_INSIDE);
assert($where('[[Elenvina]]: [[Gülden]]: [[Akademie der Herrschaft]]') === 'Elenvina');
assert($scope('[[Albenhus]]: [[Oberstadt (Albenhus)|Oberstadt]]') === AVESMAPS_PLACE_SCOPE_INSIDE);
assert($scope("[[H'Rabaal]]") === AVESMAPS_PLACE_SCOPE_INSIDE);      // apostrophe in the name
assert($scope('[[Yol-Ghurmak]]') === AVESMAPS_PLACE_SCOPE_INSIDE);   // hyphen in the name
assert($scope('[[Mendlicum]]') === AVESMAPS_PLACE_SCOPE_INSIDE);
echo "buildings-inside ok\n";

// ---------------------------------------------------------- BUILDINGS: OUT ---
// Real |Standort= values of fortresses that are drawn on the world map today.
assert($scope('[[Koschberge]]: [[Greings Klamm]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($scope('[[Eisenwald]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($scope('[[Grenzmark]]: [[Yaquirbruch]]: [[Almada]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($scope('[[Bornland (Region)|Bornland]]: [[Festenland]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($scope('[[Südaventurien]]: [[Liebliches Feld]]: [[Wilder Süden]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($scope('[[Ehernes Schwert]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
// No field at all must never be read as "inside" -- absent evidence is not evidence.
assert($scope('') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($scope('   ') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($where('') === '');
echo "buildings-outside ok\n";

// --------------------------------------------------------- OUTSKIRTS MARKER ---
// "Adler von Gevinsbar" -- names a settlement, and is explicitly outside it.
// Without this rule the measurement counted it as a mis-filter.
assert($scope('[[Fairnhain]] (Umland)') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert(avesmapsPlaceScopeHasOutskirtsMarker('[[Fairnhain]] (Umland)'));
// "Burg Gnitzenbach" -- real value, and the reason the marker is scoped to the
// link instead of the field. A compass qualifier disqualifies the link it leads.
assert($scope('[[Streitende Königreiche]]: östlich von [[Andergast]]: südlich des [[Ingval]]')
    === AVESMAPS_PLACE_SCOPE_OUTSIDE);
// CONSTRUCTED: postposed qualifiers, which German allows on either side.
assert($scope('[[Gareth]], unweit der Stadt') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($scope('bei [[Punin]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
assert($scope('[[Vinsalt]] (außerhalb)') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
// 💣 CONSTRUCTED word-boundary traps. A field-wide contains() fails all three:
// "Beilunk" starts with "bei", and a marker on an EARLIER link must not leak
// onto a later one.
assert(!avesmapsPlaceScopeHasOutskirtsMarker('[[Beilunk]]'));
assert($scope('[[Beilunk]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE); // not a settlement here, but must not crash
assert($scope('[[Gareth]]: [[Nordquartier]], im nördlichen Stadtteil') === AVESMAPS_PLACE_SCOPE_INSIDE);
assert($scope('bei [[Punin]]: [[Gareth]]') === AVESMAPS_PLACE_SCOPE_INSIDE); // only Punin is disqualified
assert($where('bei [[Punin]]: [[Gareth]]') === 'Gareth');
echo "outskirts ok\n";

// ---------------------------------------------------------------- AMBIGUOUS ---
// Name is a settlement AND a region/barony -> never filtered, handed to the editor.
// These are exactly the cases the measurement could not decide (Burg Draustein,
// Chalinba, Breitenstieg).
assert($scope('[[Albernia]]: [[Abagund]]') === AVESMAPS_PLACE_SCOPE_AMBIGUOUS);
assert($where('[[Albernia]]: [[Abagund]]') === 'Abagund');
assert($scope('[[Drôl]]') === AVESMAPS_PLACE_SCOPE_AMBIGUOUS);
assert($scope('[[Greifenfurt]], [[Königreich Garetien]]') === AVESMAPS_PLACE_SCOPE_AMBIGUOUS);
// An outskirts marker still wins over ambiguity -- "outside" is the safe answer
// and the one the editor would give.
assert($scope('bei [[Abagund]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE);
echo "ambiguous ok\n";

// -------------------------------------------------------------- PATHS: |Regionen= ---
// Real values. Streets use bracket nesting where buildings use a colon; the
// classifier must not care, because it reads links and not punctuation.
assert($scope('[[Gareth]] ([[Alt-Gareth]])') === AVESMAPS_PLACE_SCOPE_INSIDE);       // Kaiser-Reto-Straße
assert($scope('[[Punin]] ([[Goldacker]])') === AVESMAPS_PLACE_SCOPE_INSIDE);         // Lotosstieg
assert($scope('[[Ragath]] <small>(Marktviertel)</small>') === AVESMAPS_PLACE_SCOPE_INSIDE); // Yaquirallee, with markup
assert($scope('[[Mengbilla]] (Quad Basari)') === AVESMAPS_PLACE_SCOPE_INSIDE);       // Goldstraße
assert($scope('[[Khunchom]]') === AVESMAPS_PLACE_SCOPE_INSIDE);                      // Webergasse
assert($scope('[[Andergast]]') === AVESMAPS_PLACE_SCOPE_INSIDE);                     // König-Wendolyn-Allee
// A real Fernstraße names regions only.
assert($scope('[[Mittelaventurien]]: [[Trollzacken]]') === AVESMAPS_PLACE_SCOPE_OUTSIDE); // Wolfskopfpass
echo "paths ok\n";

// ------------------------------------------------------------------ FOLDING ---
// Case and stray whitespace must not decide anything.
assert($scope('[[gareth]]') === AVESMAPS_PLACE_SCOPE_INSIDE);
assert($scope('[[  Gareth  ]]') === AVESMAPS_PLACE_SCOPE_INSIDE);
assert(avesmapsPlaceScopeFoldName('  Alt-Gareth  ') === 'alt-gareth');
assert(avesmapsPlaceScopeFoldName("Feste\tEternenwacht") === 'feste eternenwacht');
// 💣 Umlauts must SURVIVE the fold. If this ever folds to ASCII, "Drôl" and a
// hypothetical "Drol" collapse into one name and the collision guard misfires.
assert(avesmapsPlaceScopeFoldName('Drôl') === 'drôl');
assert(avesmapsPlaceScopeFoldName('Fürstenhort') === 'fürstenhort');
echo "folding ok\n";

// ------------------------------------------------------------------- LABELS ---
assert(avesmapsPlaceScopeLabel(AVESMAPS_PLACE_SCOPE_INSIDE) === 'innerorts');
assert(avesmapsPlaceScopeLabel(AVESMAPS_PLACE_SCOPE_OUTSIDE) === 'außerorts');
assert(avesmapsPlaceScopeLabel(AVESMAPS_PLACE_SCOPE_AMBIGUOUS) === 'unklar');
assert(avesmapsPlaceScopeLabel('nonsense') === 'außerorts'); // unknown -> the safe label
echo "labels ok\n";

// ------------------------------------------------------------- INDEX HELPER ---
$index = ['settlements' => $settlements, 'regions' => $regions];
assert(avesmapsPlaceScopeClassifyWithIndex('[[Khunchom]]', $index)['scope'] === AVESMAPS_PLACE_SCOPE_INSIDE);
assert(avesmapsPlaceScopeClassifyWithIndex('[[Eisenwald]]', $index)['scope'] === AVESMAPS_PLACE_SCOPE_OUTSIDE);
// A malformed index must degrade to "outside", never to a crash or to "inside".
assert(avesmapsPlaceScopeClassifyWithIndex('[[Khunchom]]', [])['scope'] === AVESMAPS_PLACE_SCOPE_OUTSIDE);
echo "index-helper ok\n";

echo "\nALL PLACE-SCOPE TESTS PASSED\n";
