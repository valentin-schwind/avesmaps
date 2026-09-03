<?php

declare(strict_types=1);

/**
 * `display_style.otherSource` gibt es nicht mehr -- die Quellen eines Herrschaftsgebiets liegen in
 * `sources` + `feature_sources` (AGENTS.md §5: EIN Quellensystem), montiert ueber das geteilte Bauteil.
 *
 * Entwurf: docs/superpowers/specs/2026-09-03-quellen-herrschaftsgebiete-design.md (§2.4).
 *
 * 💣 Das Feld „Andere Quelle" des Territoriumseditors war seit dem 07.07.2026 fuer keinen Knoten
 * erreichbar (Sektion `hidden`, Feld bei jedem wiki_key ausgeblendet), und seine Ablage las kein
 * oeffentlicher Endpunkt. Es faellt OHNE Migration (Owner). Damit es nicht als zweiter Erzeuger
 * neben dem Katalog wieder auflebt, prueft dieser Test die zwei reinen Bauer AUSGEFUEHRT: ein Rumpf,
 * der `otherSource` mitschickt (ein alter, zwischengespeicherter Editor), kommt ohne den Schluessel
 * wieder heraus -- kein Fehler, kein 400, der Schluessel wird schlicht nicht mehr getragen.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 \
 *     api/_internal/political/__tests__/display-style-ohne-andere-quelle-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-read.php';
require_once __DIR__ . '/../territories-write.php';

$alterRumpf = [
    // ⚠️ Ein Anzeigename, der vom Gebietsnamen ABWEICHT: der Bauer speichert nur die Abweichung
    // (gleicher Name -> leer), und genau daran soll hier nichts haengen.
    'displayName' => 'Der Sternenbund',
    'otherSource' => ['url' => 'https://www.westlande.de/index.php?title=Sternenbund', 'label' => 'Sternenbund'],
    'coatOfArmsUrl' => '',
    'zoomMin' => 3,
    'zoomMax' => 6,
    'color' => '#385d72',
    'opacity' => 0.33,
    'existsUntilToday' => true,
];
$territory = ['public_id' => 't-1', 'id' => 7, 'wiki_key' => 'wiki:sternenbund', 'name' => 'Sternenbund',
    'valid_from_bf' => 1039, 'valid_to_bf' => 9999, 'min_zoom' => 3, 'max_zoom' => 6, 'color' => '#385d72', 'opacity' => 0.33];

// ---- 1. Der Schreib-Bauer traegt den Schluessel nicht mehr -- auch wenn ein alter Client ihn schickt
$gespeichert = avesmapsPoliticalBuildStoredAssignmentDisplay($territory, $alterRumpf, 0);
assert(!array_key_exists('otherSource', $gespeichert), 'avesmapsPoliticalBuildStoredAssignmentDisplay traegt kein otherSource mehr');
assert($gespeichert['displayName'] === 'Der Sternenbund', 'der Rest des Rumpfs kommt unveraendert durch');
assert($gespeichert['territoryPublicId'] === 't-1');
assert($gespeichert['zoomMin'] === 3 && $gespeichert['zoomMax'] === 6, 'Zoomband unveraendert');

// ---- 2. Der Lese-Bauer laesst gespeicherte Reste liegen, statt sie weiterzureichen ---------------
$gelesen = avesmapsPoliticalReadAssignmentDisplaysFromStyle([
    'assignmentDisplays' => [[
        'territoryPublicId' => 't-1',
        'nodeKey' => 'wiki:sternenbund',
        'displayName' => 'Sternenbund',
        'otherSource' => ['url' => 'https://example.test/rest', 'label' => 'Rest'],
        'color' => '#385d72',
        'opacity' => 0.33,
        'zoomMin' => 3,
        'zoomMax' => 6,
        'existsUntilToday' => true,
    ]],
]);
assert(count($gelesen) === 1, 'die Zeile wird gelesen');
assert(!array_key_exists('otherSource', $gelesen[0]), 'avesmapsPoliticalReadAssignmentDisplaysFromStyle reicht otherSource nicht weiter');
assert($gelesen[0]['displayName'] === 'Sternenbund');

// ---- 3. Und der Bezeichner ist aus den drei Dateien verschwunden --------------------------------
// ⚠️ Kommentare vorher entfernen: ein Test darf nicht an der Warnung anschlagen, die vor dem Muster
// warnt -- und `//` nur dort, wo es kein Teil einer Adresse ist.
$ohneKommentare = static function (string $php): string {
    $php = preg_replace('~/\*.*?\*/~s', '', $php) ?? $php;
    return preg_replace('~(^|[^:])//[^\n]*~', '$1', $php) ?? $php;
};
foreach (['assignment.php', 'territories-read.php', 'territories-write.php'] as $datei) {
    $quelle = $ohneKommentare((string) file_get_contents(__DIR__ . '/../' . $datei));
    assert(strpos($quelle, 'otherSource') === false, $datei . ' kennt otherSource nicht mehr');
}

echo "display-style-ohne-andere-quelle: alle Zusicherungen gehalten\n";
