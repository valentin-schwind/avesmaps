<?php

declare(strict_types=1);

/**
 * Die Reihenfolge der „Art"-Auswahl je Landschaften-Ebene (Discord-Fall #64, Owner-Entscheid
 * 2026-08-07).
 *
 * 🔴 WAS HIER BEWIESEN WIRD, ist die AUSNAHME, nicht die Regel. Alphabetisch zu sortieren ist die
 * leichte Haelfte; sie faellt sofort auf, wenn sie fehlt. Die schwere Haelfte ist, dass `klima`
 * dabei NICHT mitsortiert wird: dort sagt die `sort_order`, welche Zone noerdlich welcher liegt
 * (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED). Alphabetisch stuende die Polare Zone zwischen der
 * Gemaessigten und der Subpolaren -- eine Auswahl, die eine falsche Erdkunde behauptet, und zwar
 * lautlos. Wer die Klima-Weiche spaeter „vereinfacht", faellt hier durch.
 *
 * Diese eine Funktion (avesmapsEcosystemSortRegionTypes) ordnet ALLE Art-Auswahlfelder der
 * Landschaften: den Landschaften-Editor, „Flaeche uebertragen" auf der Karte und die Art am
 * Flaechenlabel (`region_types` aus list_regions).
 *
 * ⚠️ Der Test laeuft gegen pdo_sqlite, das byteweise sortiert -- und beweist trotzdem die echte
 * Reihenfolge, weil sortiert wird, NACHDEM die Zeilen aus der Datenbank sind
 * (avesmapsEcosystemSortRegionTypes, ueber avesmapsGermanSortKey). Genau dafuer steht die
 * Sortierung in PHP und nicht im ORDER BY: sonst pruefte dieser Test die sqlite-Ordnung und die
 * Oberflaeche zeigte die der MySQL-Kollation.
 *
 * Laufen lassen:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-region-type-order-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../climate-zones.php';
require __DIR__ . '/../ecosystem.php';

$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE ecosystem_region_type (kind TEXT, type_key TEXT, label TEXT, sort_order INT,
    is_active INT DEFAULT 1, terrain_grain REAL, terrain_levels INT, terrain_avg_height REAL,
    terrain_mean_height REAL)');

// Gesaet wird in der Reihenfolge des echten Seeds -- also in der Reihenfolge, in der die Arten
// nachgetragen wurden. Genau die stand bis 2026-08-07 im Auswahlfeld.
$seed = [
    ['topographie', 'gebirge', 'Gebirge', 10],
    ['topographie', 'see', 'See', 20],
    ['topographie', 'kueste', 'Küste', 40],
    ['topographie', 'huegelland', 'Hügelland', 50],
    ['topographie', 'hochebene', 'Hochebene', 80],
    ['topographie', 'insel', 'Insel', 120],
    ['vegetation', 'wald', 'Wald', 10],
    ['vegetation', 'suempfe_moore', 'Sümpfe und Moore', 20],
    ['vegetation', 'steppe', 'Steppe', 30],
    ['vegetation', 'wueste', 'Wüste', 60],
    ['vegetation', 'dschungel', 'Dschungel', 90],
    // 🪤 Der Fall, an dem sich Byte-Ordnung und deutsche Ordnung UNTERSCHEIDEN, und deshalb der
    // einzige, der die Sortierregel selbst prueft. Bei den echten Bezeichnungen antworten beide
    // zufaellig gleich (in Hochebene/Huegelland, Kontinent/Kueste, Steppe/Suempfe steht der
    // Grundbuchstabe des Umlauts jeweils HINTER dem Vergleichsbuchstaben) -- ein Test nur aus
    // ihnen bestuende auch mit einem blanken strcmp(). „Ö" beginnt mit 0xC3 und stuende byteweise
    // hinter „Wüste"; deutsch gehoert es zwischen Dschungel und Steppe.
    ['vegetation', 'oedland', 'Ödland', 95],
    ['derographisch', 'region', 'Region', 10],
    ['derographisch', 'inselgruppe', 'Inselgruppe', 20],
    ['derographisch', 'kontinent', 'Kontinent', 30],
    // Nord -> Sued. Die Beschriftungen stehen absichtlich quer zum Alphabet: „Polare Zone" ist die
    // noerdlichste und muesste alphabetisch mitten hinein rutschen.
    ['klima', 'polar', 'Polare Zone', 10],
    ['klima', 'boreal', 'Boreale Zone', 30],
    ['klima', 'gemaessigt', 'Gemäßigte Zone', 40],
    ['klima', 'tropisch', 'Tropische Zone', 70],
];
foreach ($seed as [$kind, $key, $label, $sort]) {
    $pdo->prepare('INSERT INTO ecosystem_region_type (kind, type_key, label, sort_order) VALUES (?, ?, ?, ?)')
        ->execute([$kind, $key, $label, $sort]);
}

$labelsOf = static function (array $rows, string $kind): array {
    return array_values(array_map(
        static fn(array $row): string => $row['label'],
        array_filter($rows, static fn(array $row): bool => $row['kind'] === $kind)
    ));
};

// ---- Alle Ebenen auf einmal, so wie list_regions ohne Ebenenfilter fragt ---------------------------

$alle = avesmapsEcosystemReadRegionTypes($pdo, null);

assert($labelsOf($alle, 'topographie') === ['Gebirge', 'Hochebene', 'Hügelland', 'Insel', 'Küste', 'See']);
assert($labelsOf($alle, 'vegetation') === ['Dschungel', 'Ödland', 'Steppe', 'Sümpfe und Moore', 'Wald', 'Wüste']);
assert($labelsOf($alle, 'derographisch') === ['Inselgruppe', 'Kontinent', 'Region']);

// 🔴 Der Assert, um den es geht. Nord -> Sued, NICHT alphabetisch.
assert($labelsOf($alle, 'klima') === ['Polare Zone', 'Boreale Zone', 'Gemäßigte Zone', 'Tropische Zone']);
// Und die Gegenprobe dazu, damit der Assert oben nicht zufaellig gruen ist: alphabetisch saehe die
// Klimaliste nachweislich anders aus.
$alphabetisch = $labelsOf($alle, 'klima');
sort($alphabetisch, SORT_STRING);
assert($alphabetisch !== $labelsOf($alle, 'klima'));

// ---- Und mit Ebenenfilter, so wie der Editor je Ebene nachlaedt ------------------------------------

assert($labelsOf(avesmapsEcosystemReadRegionTypes($pdo, 'vegetation'), 'vegetation')
    === ['Dschungel', 'Ödland', 'Steppe', 'Sümpfe und Moore', 'Wald', 'Wüste']);
assert($labelsOf(avesmapsEcosystemReadRegionTypes($pdo, 'klima'), 'klima')
    === ['Polare Zone', 'Boreale Zone', 'Gemäßigte Zone', 'Tropische Zone']);

// Eine stillgelegte Art wird weiterhin gar nicht angeboten -- die Sortierung hat daran nichts geaendert.
$pdo->exec("UPDATE ecosystem_region_type SET is_active = 0 WHERE type_key = 'insel'");
assert($labelsOf(avesmapsEcosystemReadRegionTypes($pdo, 'topographie'), 'topographie')
    === ['Gebirge', 'Hochebene', 'Hügelland', 'Küste', 'See']);

echo "ecosystem-region-type-order: alle Pruefungen bestanden\n";
