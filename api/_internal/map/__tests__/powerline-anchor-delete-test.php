<?php

declare(strict_types=1);

/**
 * Deactivating a point that a powerline hangs on (finding A9). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/map/__tests__/powerline-anchor-delete-test.php
 * Exit 0 = all asserts passed.
 *
 * 💣 The first version of this file asserted the ORDER of two calls and nothing else, so four
 * mutations survived it -- including the one that shipped: a gate scoped to `feature_type = 'location'`
 * while two of the three endpoint kinds are something else. Every assert below was re-checked by
 * breaking the thing it names.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ===== THE RULE UNDER TEST =====
// avesmapsCreatePowerlineFeature checks both endpoints hard, via avesmapsFetchEditablePointFeature --
// which, in the words of api/edit/map/powerlines.php:93, requires "a Point and not a location". So an
// endpoint is any of:
//   * a Nodix settlement            feature_type = 'location'
//   * a crossing                    feature_type = 'junction'  (plus 798 legacy rows spelled 'crossing')
//   * a Nodix LABEL                 feature_type = 'label'     (owner decision, 2026-07-28)
// Deactivating such a point checked nothing at all, and the inventory carries 14 segments pointing at 6
// vanished ids.

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    name TEXT,
    feature_type TEXT,
    is_active INTEGER,
    properties_json TEXT
)');
$insert = $pdo->prepare('INSERT INTO map_features (name, feature_type, is_active, properties_json) VALUES (?, ?, ?, ?)');
$line = static fn(string $from, string $to): string => json_encode(['from_public_id' => $from, 'to_public_id' => $to]);

// 💣 One segment per endpoint KIND. The finder carries no type predicate precisely so that the kind
// cannot matter -- and these rows are what proves it instead of a comment claiming it.
$insert->execute(['Konzilslinie', 'powerline', 1, $line('nodix-ort', 'kreuzung-neu')]);
$insert->execute(['Nelkra-Linie', 'powerline', 1, $line('kreuzung-alt', 'nodix-label')]);
$insert->execute(['Hexenband', 'powerline', 1, $line('nodix-label', 'nodix-ort')]);
$insert->execute(['Totes Band', 'powerline', 0, $line('nodix-ort', 'nirgends')]);
$insert->execute(['Reichsstrasse', 'path', 1, $line('nodix-ort', 'kreuzung-neu')]);
// The endpoints themselves, in all four spellings that occur in the live inventory.
$insert->execute(['Gareth', 'location', 1, json_encode(['is_nodix' => true])]);
$insert->execute(['Kreuzung-1', 'junction', 1, json_encode([])]);
$insert->execute(['Kreuzung-alt', 'crossing', 1, json_encode([])]);
$insert->execute(['Streitberge', 'label', 1, json_encode(['is_nodix' => true])]);

assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'nodix-ort') === ['Konzilslinie', 'Hexenband'],
    'a Nodix settlement is anchored'
);
assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'kreuzung-neu') === ['Konzilslinie'],
    "a crossing (feature_type 'junction') is anchored -- the shipped gate missed this entirely"
);
assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'kreuzung-alt') === ['Nelkra-Linie'],
    "and so is a legacy crossing (feature_type 'crossing'), of which 798 rows are live"
);
assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'nodix-label') === ['Nelkra-Linie', 'Hexenband'],
    'and a Nodix label, which the owner made a valid endpoint on 2026-07-28'
);
assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'nirgends') === [],
    'a soft-deleted segment does not block anything -- it is gone from the map too'
);
assert(avesmapsFindPowerlinesAnchoredAt($pdo, 'unbekannt') === [], 'a point no line names is free');
assert(avesmapsFindPowerlinesAnchoredAt($pdo, '') === [], 'an empty id returns before touching the database');

// The assert wrapper throws for anchored points and stays silent otherwise.
$threw = false;
try {
    avesmapsAssertNoPowerlineAnchoredAt($pdo, 'nodix-label');
} catch (InvalidArgumentException $exception) {
    $threw = true;
    assert(str_contains($exception->getMessage(), 'Hexenband'), 'and the refusal names the lines');
}
assert($threw, 'an anchored point cannot be deactivated');
avesmapsAssertNoPowerlineAnchoredAt($pdo, 'unbekannt');   // must not throw

// --- The message: names, count, grammar -----------------------------------------------------------

$two = avesmapsBuildAnchoredPowerlineMessage(['Konzilslinie', 'Hexenband']);
assert(str_contains($two, '2 Kraftlinien-Abschnitte'), 'the count is stated');
assert(str_contains($two, 'haengen'), 'plural verb for two');
assert(str_contains($two, 'Hexenband, Konzilslinie'), 'and the names, sorted');

// 💣 Singular is the COMMON case, not the edge: an endpoint at the end of a line carries exactly one
// segment. The first version said "1 Kraftlinien-Abschnitte" there.
$one = avesmapsBuildAnchoredPowerlineMessage(['Basiliuslinie']);
assert(str_contains($one, 'haengt noch 1 Kraftlinien-Abschnitt'), 'singular reads as German: ' . $one);
assert(!str_contains($one, 'Abschnitte'), 'and not as a plural');
assert(!str_contains($one, 'haengen'), 'the verb agrees too');

$many = avesmapsBuildAnchoredPowerlineMessage(['E', 'D', 'C', 'B', 'A']);
assert(str_contains($many, 'A, B, C und weitere'), 'more than three names are cut, and it says so');
assert(str_contains($many, '5 Kraftlinien-Abschnitte'), 'while the count stays true');

$duplicated = avesmapsBuildAnchoredPowerlineMessage(['Nelkra-Linie', 'Nelkra-Linie']);
assert(substr_count($duplicated, 'Nelkra-Linie') === 1, 'a name is listed once');
assert(str_contains($duplicated, '2 Kraftlinien-Abschnitte'), 'but both segments are counted');

$unnamed = avesmapsBuildAnchoredPowerlineMessage(['', '']);
assert(str_contains($unnamed, '2 Kraftlinien-Abschnitte'), 'nameless segments still block');
assert(!str_contains($unnamed, '()'), 'and produce no empty bracket');

// --- 💣 THREE server paths deactivate a point, not one --------------------------------------------

$featuresSource = file_get_contents(__DIR__ . '/../features.php');
$ecosystemSource = file_get_contents(__DIR__ . '/../../app/ecosystem.php');
assert(is_string($featuresSource) && is_string($ecosystemSource), 'both sources readable');

// (a) The delete itself -- and with NO type condition. Naming types is how the shipped version missed
// crossings and labels; the next kind added would have fallen out again.
assert(
    preg_match('/function avesmapsDeleteMapFeature\(PDO \$pdo, array \$payload, array \$user\): array \{(.*?)\n\}/s', $featuresSource, $deleteMatch) === 1,
    'the delete body can be isolated'
);
$deleteBody = $deleteMatch[1];
$gateAt = strpos($deleteBody, 'avesmapsAssertNoPowerlineAnchoredAt($pdo, $publicId);');
$updateAt = strpos($deleteBody, 'SET is_active = 0,');
assert(is_int($gateAt) && is_int($updateAt), 'the gate and the soft delete are both there');
assert($gateAt < $updateAt, 'and the gate runs first, or it guards nothing');
assert(
    !preg_match("/feature_type'\s*\]\s*\?\?\s*''\)\s*===\s*'location'/", $deleteBody),
    'the gate does not ask for a feature type -- two of the three endpoint kinds are not "location"'
);

// (b) 💣 Undo of a create sets is_active = 0 without ever entering the delete. Create a place, hang a
// powerline on it, press "Rückgängig" on the create row: a fresh orphan, by button.
// avesmapsAssertUndoPatchStillCurrent cannot notice -- it only compares the POINT's own columns, and
// creating the powerline touched none of them.
assert(
    preg_match('/\$updates\[\'is_active\'\] \?\? 1\) === 0\) \{\s*\n\s*avesmapsAssertNoPowerlineAnchoredAt/', $featuresSource) === 1,
    'the undo path checks before it deactivates'
);

// (c) 💣 The landscape cascade deactivates label rows with its own UPDATE, and a landscape label can be
// the Nodix anchor. Deleting the last label of a region takes the region's OTHER labels with it.
assert(
    preg_match('/function avesmapsEcosystemDeleteLabels\(.*?foreach \(\$rows as \$row\) \{(.*?)\$update->execute/s', $ecosystemSource, $cascadeMatch) === 1,
    'the cascade loop can be isolated'
);
assert(
    str_contains($cascadeMatch[1], 'avesmapsAssertNoPowerlineAnchoredAt'),
    'the landscape cascade checks each label before deactivating it'
);

// --- 💣 The client has TWO delete paths, and one shared refusal ------------------------------------

$repoRoot = __DIR__ . '/../../../../';
$powerlinesSource = file_get_contents($repoRoot . 'js/map-features/map-features-powerlines.js');
$locationSource = file_get_contents($repoRoot . 'js/map-features/map-features-location-editing.js');
$labelSource = file_get_contents($repoRoot . 'js/map-features/map-features-labels.js');
assert(is_string($powerlinesSource) && is_string($locationSource) && is_string($labelSource), 'client sources readable');

assert(
    substr_count($powerlinesSource, 'function refusePowerlineAnchoredDeletion(') === 1,
    'the refusal is defined once, next to the data it reads'
);
assert(
    substr_count($locationSource, 'function refusePowerlineAnchoredDeletion(') === 0
        && substr_count($labelSource, 'function refusePowerlineAnchoredDeletion(') === 0,
    'and nowhere else -- two copies of the same refusal is the divergence that made the orphans'
);
assert(
    str_contains($locationSource, 'if (refusePowerlineAnchoredDeletion(markerEntry.name, markerEntry.publicId)) {'),
    'the place/crossing path calls it'
);
assert(
    str_contains($labelSource, 'if (refusePowerlineAnchoredDeletion(entry.label?.text'),
    'and so does the label path, which does not go through deleteLocationMarker at all'
);
assert(
    !preg_match('/connectedPowerlines\s*=\s*markerEntry\.locationType === CROSSING_LOCATION_TYPE/', $locationSource),
    'and it no longer asks only about crossings'
);
// 💣 `line.name` is always undefined -- a powerline object carries id/geometry/properties and nothing
// else at the top level. The first version listed no line at all; the live probe at Gareth found it.
assert(
    str_contains($powerlinesSource, 'line.properties?.name'),
    'the line name is read from properties, where it lives'
);
// The refusal must return before the confirm, not after: asking "really delete?" and then refusing is
// the wrong order.
assert(
    preg_match('/if \(refusePowerlineAnchoredDeletion\([^)]*\)\) \{\s*\n\s*return;\s*\n\s*\}/', $locationSource) === 1,
    'the caller returns on a refusal'
);
assert(
    strpos($locationSource, 'refusePowerlineAnchoredDeletion(markerEntry.name')
        < strpos($locationSource, 'window.confirm(`${markerEntry.name} wirklich löschen?`)'),
    'and does so before asking for confirmation'
);

echo "powerline-anchor-delete ok\n";
