<?php

declare(strict_types=1);

/**
 * Unit tests for the location duplicate-name rule (api/_internal/map/features.php):
 * avesmapsNormalizeDuplicateLocationName + avesmapsDuplicateLocationNameMessage.
 *
 * Seit 17.08.2026 auch avesmapsAssertUniqueLocationName selbst (gegen eine SQLite-Fixture) und
 * avesmapsMapFeatureErrorDetails -- der Weg, auf dem die Kennung des blockierenden Ortes neben der
 * Meldung zur Oberflaeche reist, damit man ihn von dort anspringen kann.
 *
 * The normalizer is the AUTHORITY for the rule; js/routing/routing.js mirrors it and
 * js/routing/__tests__/duplicate-location-name.test.js asserts the SAME corpus against that
 * mirror. Discord #46: the two had silently drifted -- the client also folded accents, so it
 * refused "Grotz" while "Grötz" existed even though the server would have accepted it. Keep the
 * corpus below in sync with the JS test; a change to either normalizer must break one of them.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/map/__tests__/duplicate-location-name-test.php
 * Exit 0 = all asserts passed.
 */

// assert() is a compiled no-op unless zend.assertions=1 at startup -- guard against false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded -- the normalizer needs mb_strtolower.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// name => expected normalized key. MUST match js/routing/__tests__/duplicate-location-name.test.js.
const AVESMAPS_DUPLICATE_NAME_CORPUS = [
    'Neu-Sirensteen'     => 'neusirensteen',
    'neusirensteen'      => 'neusirensteen',
    'Neu Sirensteen'     => 'neusirensteen',
    'Havena'             => 'havena',
    '  Havena  '         => 'havena',
    'Punin (Horasreich)' => 'puninhorasreich',
    // Accents are PRESERVED: "Grötz" and "Grotz" are different names in a German setting.
    // This is the pair the client used to fold together (Discord #46).
    'Grötz'              => 'grötz',
    'Grotz'              => 'grotz',
    'Ödland'             => 'ödland',
    'Odland'             => 'odland',
    'Straße'             => 'straße',
    'Strasse'            => 'strasse',
    'Ort-42'             => 'ort42',
    ''                   => '',
    '---'                => '',
];

foreach (AVESMAPS_DUPLICATE_NAME_CORPUS as $input => $expected) {
    $actual = avesmapsNormalizeDuplicateLocationName((string) $input);
    assert(
        $actual === $expected,
        sprintf('normalize(%s): expected "%s", got "%s"', var_export($input, true), $expected, $actual)
    );
}
echo 'normalizer maps ' . count(AVESMAPS_DUPLICATE_NAME_CORPUS) . " inputs as specified ok\n";

// The pairs that decide whether a second place may exist.
assert(avesmapsNormalizeDuplicateLocationName('Neu-Sirensteen') === avesmapsNormalizeDuplicateLocationName('neusirensteen'));
assert(avesmapsNormalizeDuplicateLocationName('Grötz') !== avesmapsNormalizeDuplicateLocationName('Grotz'));
assert(avesmapsNormalizeDuplicateLocationName('Straße') !== avesmapsNormalizeDuplicateLocationName('Strasse'));
// The whole point of the fix: a parenthetical qualifier makes the second place a DIFFERENT name.
assert(avesmapsNormalizeDuplicateLocationName('Sirensteen') !== avesmapsNormalizeDuplicateLocationName('Sirensteen (Almada)'));
echo "collision verdicts ok (qualifier frees the name)\n";

// The message must name the blocking place and show the pattern -- not merely refuse.
$message = avesmapsDuplicateLocationNameMessage('Sirensteen');
assert(str_contains($message, 'Sirensteen'));
assert(str_contains($message, 'Sirensteen (Region)'));      // the concrete, copyable pattern
assert(str_contains($message, 'Klammern'));
assert(substr_count($message, 'Sirensteen') === 2);
// Guard the ASCII convention this file uses for every other user-facing message.
assert(preg_match('/[^\x20-\x7E]/', $message) !== 1, 'message must stay ASCII like its neighbours');
echo "message names the blocker and shows the qualifier pattern ok\n";

// A name that is empty after normalization must not produce a message path at all -- the assert
// helper returns early, so nothing downstream ever sees it. Documented here as behaviour.
assert(avesmapsNormalizeDuplicateLocationName('!!!') === '');
echo "punctuation-only name normalizes to empty (check is skipped) ok\n";

// ===========================================================================================
// Der blockierende Ort ist ANSPRINGBAR (17.08.2026)
// -------------------------------------------------------------------------------------------
// Die Meldung nannte den Ort, aber man kam nicht hin. Owner, woertlich: "wenn du die fehlermeldung
// ergaenzen willst, kannst du gerne einen link einbauen, dass man das gleich findet."
//
// 🔴 DIE FIXTURE IST DER ECHTE FALL vom 17.08.2026: der Owner zog am Ort "Koschim" das Namensfeld
// per Ruecksetzer auf den Wiki-Stand "Hallen von Koschim" -- und ein ZWEITER Ort trug den Namen
// bereits. Beide public_id sind die aus der Live-Datenbank.
// 💣 Die Zusicherung, auf die es ankommt, ist nicht "es wirft", sondern "es wirft MIT DER RICHTIGEN
// KENNUNG". Ein Wurf mit leerer public_id sieht in jeder Oberflaeche aus wie "kein Verweis
// vorhanden" -- also genau wie der Zustand vor diesem Umbau, und niemand merkt es.
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: pdo_sqlite is not loaded -- the fixture below needs it.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring "
        . "-d extension=pdo_sqlite " . __FILE__ . "\n");
    exit(2);
}

const AVESMAPS_KOSCHIM_PUBLIC_ID = '10edc2b5-5484-5804-bd35-196e11a0f3c1';
const AVESMAPS_HALLEN_PUBLIC_ID  = '63e2adfd-16b4-4500-84c0-58b9967c972d';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (public_id TEXT, name TEXT, feature_type TEXT, is_active INTEGER)');
$insert = $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, is_active) VALUES (?, ?, ?, ?)');
// ⚠️ DIE STILLGELEGTE ZEILE STEHT BEWUSST ZUERST. Der Riegel liest die Treffer in Reihenfolge und
// meldet den ERSTEN -- faellt `is_active = 1` aus der Abfrage, wandert genau diese Zeile in den
// Verweis, und der Editor schickte den Owner an einen geloeschten Ort. Stuende sie hinten, bliebe
// derselbe Fehler unbemerkt, weil die echte Zeile ihn ueberdeckte.
$insert->execute(['00000000-0000-0000-0000-0000000000ff', 'Hallen von Koschim', 'location', 0]);
$insert->execute([AVESMAPS_KOSCHIM_PUBLIC_ID, 'Koschim', 'location', 1]);
$insert->execute([AVESMAPS_HALLEN_PUBLIC_ID, 'Hallen von Koschim', 'location', 1]);
// Ein Ort ANDEREN Typs mit demselben Namen blockiert ebenfalls nicht (feature_type-Filter).
$insert->execute(['00000000-0000-0000-0000-0000000000ee', 'Hallen von Koschim', 'path', 1]);

$caught = null;
try {
    avesmapsAssertUniqueLocationName($pdo, 'Hallen von Koschim', AVESMAPS_KOSCHIM_PUBLIC_ID);
} catch (AvesmapsDuplicateLocationNameException $exception) {
    $caught = $exception;
}
assert($caught !== null, 'renaming Koschim to the taken name must be refused');
assert($caught->blockingPublicId === AVESMAPS_HALLEN_PUBLIC_ID,
    'the refusal must carry the BLOCKING place, got "' . ($caught?->blockingPublicId ?? '') . '"');
assert($caught->blockingName === 'Hallen von Koschim');
// Der Satz aendert sich NICHT -- der Verweis reist daneben, nicht im Text (sonst stuende Markup in
// einem textContent und die Doppelpflege PHP/JS verdoppelte sich).
assert($caught->getMessage() === avesmapsDuplicateLocationNameMessage('Hallen von Koschim'));
// ⚠️ Sie MUSS eine InvalidArgumentException bleiben: der Endpunkt faengt genau die. Ein eigener
// Ast fiele dort auf `catch (Throwable)` und machte aus der klaren 400 eine nichtssagende 500.
assert($caught instanceof InvalidArgumentException);
echo "duplicate refusal names the blocking place by public_id (Koschim fixture) ok\n";

// Gegenprobe, beide Richtungen -- ohne sie belegt die Fixture nur, dass ueberhaupt etwas wirft.
$freeNamePassed = true;
try {
    avesmapsAssertUniqueLocationName($pdo, 'Hallen von Koschim (Region)', AVESMAPS_KOSCHIM_PUBLIC_ID);
} catch (InvalidArgumentException) {
    $freeNamePassed = false;
}
assert($freeNamePassed, 'the qualifier the message suggests must actually free the name');
$ownNamePassed = true;
try {
    avesmapsAssertUniqueLocationName($pdo, 'Hallen von Koschim', AVESMAPS_HALLEN_PUBLIC_ID);
} catch (InvalidArgumentException) {
    $ownNamePassed = false;
}
assert($ownNamePassed, 'a place keeping its OWN name must not block itself');
echo "counter-checks ok (qualifier frees it, self does not block self)\n";

// Die Weiche, die im Endpunkt entscheidet, ob die Kennung mitgeschickt wird. Sie steht hier und
// nicht als zweiter catch-Block im Endpunkt, weil eine catch-REIHENFOLGE (Kind vor Elternklasse)
// von keinem Test dieses Feldes zu pruefen waere -- eine reine Funktion schon.
$details = avesmapsMapFeatureErrorDetails($caught);
assert($details['duplicate_location']['public_id'] === AVESMAPS_HALLEN_PUBLIC_ID);
assert($details['duplicate_location']['name'] === 'Hallen von Koschim');
// Jede andere Ablehnung laesst die Huelle unveraendert -- keine leere Kennung, die eine Oberflaeche
// fuer einen Verweis halten koennte, und kein Schluessel, der sonst nirgends vorkommt.
assert(avesmapsMapFeatureErrorDetails(new InvalidArgumentException('Der Ortsname fehlt.')) === []);
assert(avesmapsMapFeatureErrorDetails(new RuntimeException('irgendwas')) === []);
echo "error details carry the id for duplicates and NOTHING for every other refusal ok\n";

echo "ALL OK\n";
