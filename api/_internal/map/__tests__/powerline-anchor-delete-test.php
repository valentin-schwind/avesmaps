<?php

declare(strict_types=1);

/**
 * Deleting a point that a powerline hangs on (finding A9). Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/map/__tests__/powerline-anchor-delete-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ===== THE RULE UNDER TEST =====
// avesmapsCreatePowerlineFeature checks BOTH endpoints hard: they must exist and be a Nodix place or a
// crossing. Deleting such a point checked nothing. The inventory carried 14 segments pointing at 6
// vanished ids -- the line still draws (its geometry lives in the feature) but "connects A to B" is
// dead, and the powerline editor orders its segments along exactly that chain.

// --- The finder actually runs. The query is portable SQL (no MySQL-only function), so sqlite can
// execute the real statement rather than a paraphrase of it. What sqlite cannot vouch for is nothing
// here: there is no INTERVAL, no JSON function, no collation comparison in it.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    name TEXT,
    feature_type TEXT,
    is_active INTEGER,
    properties_json TEXT
)');
$insert = $pdo->prepare('INSERT INTO map_features (name, feature_type, is_active, properties_json) VALUES (?, ?, ?, ?)');
$line = static fn(string $from, string $to): string => json_encode(['from_public_id' => $from, 'to_public_id' => $to]);

$insert->execute(['Konzilslinie', 'powerline', 1, $line('nodix-a', 'nodix-b')]);
$insert->execute(['Nelkra-Linie', 'powerline', 1, $line('nodix-b', 'nodix-c')]);
$insert->execute(['Hexenband', 'powerline', 1, $line('nodix-c', 'nodix-a')]);
// An already-deleted segment must not block anything -- it is not on the map either.
$insert->execute(['Totes Band', 'powerline', 0, $line('nodix-a', 'nodix-z')]);
// Neither may a path that happens to carry the same property names.
$insert->execute(['Reichsstrasse', 'path', 1, $line('nodix-a', 'nodix-b')]);

assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'nodix-a') === ['Konzilslinie', 'Hexenband'],
    'both ends count: a point named as `from` or as `to` is anchored'
);
assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'nodix-b') === ['Konzilslinie', 'Nelkra-Linie'],
    'and a point in the middle of a chain is anchored twice'
);
assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'nodix-z') === [],
    'a soft-deleted segment does not block a delete -- it is gone from the map too'
);
assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, 'nirgends') === [],
    'a point no line names is free'
);
assert(
    avesmapsFindPowerlinesAnchoredAt($pdo, '') === [],
    'an empty id asks nothing -- and returns before touching the database'
);

// --- The message names the lines, because a number sends the editor hunting ------------------------

$message = avesmapsBuildAnchoredPowerlineMessage(['Konzilslinie', 'Hexenband']);
assert(str_contains($message, '2 Kraftlinien-Abschnitte'), 'the count is stated');
assert(str_contains($message, 'Hexenband, Konzilslinie'), 'and the names, sorted');
assert(!str_contains($message, 'und weitere'), 'no truncation marker when nothing was truncated');

$many = avesmapsBuildAnchoredPowerlineMessage(['E', 'D', 'C', 'B', 'A']);
assert(str_contains($many, 'A, B, C und weitere'), 'more than three names are cut, and it says so');
assert(str_contains($many, '5 Kraftlinien-Abschnitte'), 'while the count stays the true one');

// Duplicates are one line named twice (a segment from X to X cannot exist, but a name group can repeat).
$duplicated = avesmapsBuildAnchoredPowerlineMessage(['Nelkra-Linie', 'Nelkra-Linie']);
assert(substr_count($duplicated, 'Nelkra-Linie') === 1, 'a name is listed once');
assert(str_contains($duplicated, '2 Kraftlinien-Abschnitte'), 'but both segments are counted');

// An unnamed segment still blocks; it just cannot be listed.
$unnamed = avesmapsBuildAnchoredPowerlineMessage(['', '']);
assert(str_contains($unnamed, '2 Kraftlinien-Abschnitte'), 'nameless segments are counted');
assert(!str_contains($unnamed, '()'), 'and produce no empty bracket');

// --- 💣 The gate must sit BEFORE the delete, and the client must not gate it on crossings ----------

$featuresSource = file_get_contents(__DIR__ . '/../features.php');
assert(
    preg_match('/function avesmapsDeleteMapFeature\(PDO \$pdo, array \$payload, array \$user\): array \{(.*?)\n\}/s', $featuresSource, $deleteMatch) === 1,
    'the delete body can be isolated'
);
$deleteBody = $deleteMatch[1];
$gateAt = strpos($deleteBody, 'avesmapsFindPowerlinesAnchoredAt($pdo, $publicId)');
$updateAt = strpos($deleteBody, 'SET is_active = 0,');
assert(is_int($gateAt) && is_int($updateAt), 'both the gate and the soft delete are in there');
assert($gateAt < $updateAt, 'the gate runs before the row is deactivated, or it guards nothing');

// 💣 The client warned only for crossings. Powerlines connect Nodix PLACES or crossings -- the create
// check says so in as many words -- so deleting a Nodix place ran through without a word. That is how
// the 14 orphans were made, and a server gate alone would only turn it into a late error.
$clientSource = file_get_contents(__DIR__ . '/../../../../js/map-features/map-features-location-editing.js');
assert(is_string($clientSource) && $clientSource !== '', 'the client source is readable');
assert(
    preg_match('/function deleteLocationMarker\(markerEntry\) \{(.*?)\n\}/s', $clientSource, $clientMatch) === 1,
    'the client delete body can be isolated'
);
$clientBody = $clientMatch[1];
assert(
    str_contains($clientBody, 'getConnectedPowerlinesForPublicId(markerEntry.publicId)'),
    'the client still asks which lines are attached'
);
assert(
    !preg_match('/connectedPowerlines\s*=\s*markerEntry\.locationType === CROSSING_LOCATION_TYPE/', $clientBody),
    'and no longer asks only for crossings -- a Nodix place carries powerlines just as well'
);
// 💣 A powerline object in powerlineData carries only id/geometry/properties at the top level, so
// `line.name` is always undefined and the message listed no line at all -- exactly the part that tells
// the editor where to go. Found by probing the deployed client at Gareth, not by this file.
assert(
    str_contains($clientBody, 'line.properties?.name'),
    'the client reads the line name from properties, where it actually lives'
);
assert(
    !preg_match('/connectedPowerlines\.map\(\(line\) => line\.name\)/', $clientBody),
    'and not from the top level, where it is always undefined'
);

echo "powerline-anchor-delete ok\n";
