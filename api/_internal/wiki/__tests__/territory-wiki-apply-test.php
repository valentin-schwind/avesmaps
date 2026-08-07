<?php

declare(strict_types=1);

/**
 * 💣 Die Staging-Zeile ist NICHT der Datensatz, den der Upsert erwartet. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/territory-wiki-apply-test.php
 *
 * avesmapsPoliticalUpsertWikiRecord schickt jedes *_json-Feld durch avesmapsPoliticalEncodeJsonOrNull,
 * und das ruft json_encode. Die Staging-Spalte ist aber bereits eine JSON-ZEICHENKETTE -- unveraendert
 * durchgereicht landet in der Kopie ein doppelt kodierter String ("\"{...}\""), den jeder Leser als
 * Text statt als Struktur bekommt. Der Fehler waere lautlos: das Feld ist gefuellt, die Zeile sieht
 * richtig aus, und erst die Infobox zeigt Anfuehrungszeichen.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-plan.php';
require_once __DIR__ . '/../territory-wiki-plan.php';
require_once __DIR__ . '/../territory-wiki-plan-apply.php';
// Fuer die Gegenproben unten (avesmapsPoliticalEncodeJsonOrNull / …NullableString): das sind die zwei
// Funktionen, durch die der Upsert jeden Wert schickt, und nur an ihnen laesst sich zeigen, was aus
// einem bewahrten und was aus einem leeren Feld wirklich wird. territory-wiki-plan-apply.php requiret
// diese Datei nicht selbst (das tut die Kette des Endpunkts, wie bei den citymap/adventure/publication/
// lore-Geschwistern), also laedt der Test sie.
require_once __DIR__ . '/../../political/territory.php';

$row = [
    'id' => 42,
    'synced_at' => '2026-08-06 22:03:00',
    'wiki_key' => 'wiki:f-rstentum-kosch',
    'name' => 'Fürstentum Kosch',
    'affiliation_path_json' => '["Kaiserreich Mittelreich","Fürstentum Kosch"]',
    'affiliation_json' => '{"root":"Kaiserreich Mittelreich"}',
    'founded_json' => '',
    'dissolved_json' => null,
    'raw_json' => '{"Name":"Fürstentum Kosch"}',
];

$record = avesmapsTerritoryWikiRecordFromStagingRow($row);

assert(is_array($record['affiliation_path_json']), '💣 JSON-Spalten kommen als STRUKTUR zurueck');
assert($record['affiliation_path_json'][0] === 'Kaiserreich Mittelreich');
assert(is_array($record['affiliation_json']) && $record['affiliation_json']['root'] === 'Kaiserreich Mittelreich');
assert($record['founded_json'] === [], 'leer bleibt leer, nicht [""]');
assert($record['dissolved_json'] === []);
assert(is_array($record['raw_json']) && $record['raw_json']['Name'] === 'Fürstentum Kosch');
assert($record['name'] === 'Fürstentum Kosch', 'Textspalten bleiben Text');
assert(!array_key_exists('id', $record), 'die Staging-id gehoert nicht in die Kopie');
assert(!array_key_exists('synced_at', $record), 'und die Staging-Uhr auch nicht');

// Gegenprobe: was der Upsert daraus macht, ist wieder eine EINFACH kodierte Zeichenkette.
assert(
    avesmapsPoliticalEncodeJsonOrNull($record['affiliation_json']) === '{"root":"Kaiserreich Mittelreich"}',
    '💣 einfach kodiert -- genau das war die Falle'
);

echo "territory-wiki-apply ok\n";

// =====================================================================================================
// 🔴 DIE LEER-REGEL AUF DEM SCHREIBWEG -- der kritische Befund der Gesamtpruefung (2026-08-07)
// =====================================================================================================
//
// avesmapsPoliticalUpsertWikiRecord schreibt ALLE 36 Spalten (ON DUPLICATE KEY UPDATE <col> =
// VALUES(<col>)), und avesmapsPoliticalNullableString('') ist NULL. Die rohe Staging-Zeile durchzureichen
// NULLt damit jedes Feld, zu dem der Dump nichts liefert -- auch die, die die Vorschau nicht einmal
// genannt hat, weil avesmapsTerritoryWikiPlanItem einen leeren frischen Wert korrekt uebergeht
// (Entwurf §4). Die Kopie ist die LIVE-Quelle von Hauptstadt, Oberhaupt, Sprache, Waehrung,
// Handelswaren und Blasonierung, und sie hat kein Backup.

// --- Was leer heisst, und was NICHT ---------------------------------------------------------------
assert(avesmapsTerritoryWikiStagingValueIsEmpty(null) === true);
assert(avesmapsTerritoryWikiStagingValueIsEmpty('') === true);
assert(avesmapsTerritoryWikiStagingValueIsEmpty('   ') === true, 'nur Leerzeichen ist leer -- wie trim() im Rechen-Teil');
assert(avesmapsTerritoryWikiStagingValueIsEmpty([]) === true, 'ein leeres Feld-Array wird ohnehin zu NULL kodiert');
assert(avesmapsTerritoryWikiStagingValueIsEmpty('Kosch-Taler') === false);
// 💣 Die eine Entscheidung, die begruendet werden muss: 0 ist ein WERT. Der Parser schreibt 0 in
// founded_start_bf, wenn im Artikel kein Datum steht -- der Rechen-Teil vergleicht diese 0 aber als
// Wert und BIETET "1050 -> 0" an. Wuerde der Schreibweg sie schlucken, meldete genau diese
// angehaekelte Zeile "uebernommen", ohne dass etwas passiert waere.
assert(avesmapsTerritoryWikiStagingValueIsEmpty(0) === false, '💣 0 ist ein Wert, kein Nichts');
assert(avesmapsTerritoryWikiStagingValueIsEmpty('0') === false);
assert(avesmapsTerritoryWikiStagingValueIsEmpty(0.0) === false);
// Gegenprobe zur Behauptung oben: der Rechen-Teil bietet 1050 -> 0 tatsaechlich an. Ohne diese Zeile
// waere die Begruendung fuer "0 ist ein Wert" eine Behauptung ueber fremden Code.
$zeroItem = avesmapsTerritoryWikiPlanItem(['founded_start_bf' => 1050], ['founded_start_bf' => 0]);
assert(is_array($zeroItem) && ($zeroItem['after']['founded_start_bf'] ?? null) === '0',
    '💣 der Rechen-Teil nennt 1050 -> 0 als Aenderung -- deshalb muss der Schreibweg sie auch schreiben');

// --- Der Bestand: die Kopie ist gefuellt, der Dump liefert nur das Oberhaupt -----------------------
$mirror = [
    'id' => 7,
    'synced_at' => '2026-01-01 00:00:00',
    'wiki_key' => 'wiki:f-rstentum-kosch',
    'name' => 'Fürstentum Kosch',
    'currency' => 'Kosch-Taler',
    'blazon' => 'In Silber ein schwarzer Zwergenhammer',
    'language' => 'Garethi, Kosch-Dialekt',
    'capital_name' => 'Angbar',
    'ruler' => 'Fürst A',
    'seat_name' => '',
    'affiliation_json' => '{"root":"Kaiserreich Mittelreich"}',
    'raw_json' => '{"Name":"Fürstentum Kosch"}',
];
$staging = [
    'id' => 42,
    'synced_at' => '2026-08-07 09:00:00',
    'wiki_key' => 'wiki:f-rstentum-kosch',
    'name' => 'Fürstentum Kosch',
    'currency' => '',           // der Dump kennt |Währung= nicht mehr
    'blazon' => null,           // und die Blasonierung auch nicht
    'language' => '   ',        // nur Leerraum -- ebenfalls nichts
    'capital_name' => 'Angbar',
    'ruler' => 'Fürst B',       // das EINE, was die Vorschau genannt hat
    'seat_name' => '',          // in beiden leer
    'affiliation_json' => '',   // leere JSON-Spalte
    'raw_json' => '{"Name":"Fürstentum Kosch","Oberhaupt":"Fürst B"}',
];

$merged = avesmapsTerritoryWikiRecordFromStagingRow($staging, $mirror);

assert($merged['currency'] === 'Kosch-Taler', '💣 ein im Dump leeres Feld behaelt den guten Wert der Kopie');
assert($merged['blazon'] === 'In Silber ein schwarzer Zwergenhammer', '💣 auch bei NULL im Staging');
assert($merged['language'] === 'Garethi, Kosch-Dialekt', '💣 und bei reinem Leerraum');
assert($merged['ruler'] === 'Fürst B', 'ein echter frischer Wert gewinnt -- sonst waere die Vorschau sinnlos');
assert($merged['capital_name'] === 'Angbar', 'ein gleicher Wert bleibt, was er ist');
assert($merged['seat_name'] === '', 'in beiden leer bleibt leer -- nichts wird erfunden');
assert($merged['affiliation_json'] === ['root' => 'Kaiserreich Mittelreich'],
    '💣 auch eine JSON-Spalte wird uebernommen -- und danach DEKODIERT, nicht als Zeichenkette gereicht');
assert(!array_key_exists('id', $merged) && !array_key_exists('synced_at', $merged),
    'die Staging-id und ihre Uhr kommen auch ueber den Spiegel nicht zurueck');

// Und was der Upsert daraus macht: ein bewahrter Wert bleibt ein Wert, kein NULL.
assert(avesmapsPoliticalNullableString($merged['currency']) === 'Kosch-Taler', '💣 kein NULL mehr an dieser Stelle');
assert(avesmapsPoliticalNullableString($merged['seat_name']) === null, 'leer bleibt leer -- das ist erlaubt');

// --- Eine NEUE Kopie (kein Spiegel) verhaelt sich unveraendert -------------------------------------
$fresh = avesmapsTerritoryWikiRecordFromStagingRow($staging);
assert($fresh['currency'] === '', 'ohne Spiegel gibt es nichts zu bewahren');
assert($fresh['ruler'] === 'Fürst B');
assert($fresh['affiliation_json'] === [], 'und die leere JSON-Spalte bleibt leer');
assert($fresh['name'] === 'Fürstentum Kosch' && !array_key_exists('id', $fresh),
    'sonst ist die Ein-Argument-Fassung unveraendert -- dieselbe Zeile wie oben, nur ohne Spiegel');

// --- 💣 Und die Ausfuehr-Haelfte reicht den Spiegel tatsaechlich weiter ---------------------------
//
// Presence is not execution: die Regel oben ist wertlos, wenn avesmapsTerritoryWikiApplyStep den
// Adapter weiterhin mit EINEM Argument ruft. Der Aufruf steht genau einmal in der Datei.
$applySource = (string) file_get_contents(__DIR__ . '/../territory-wiki-plan-apply.php');
assert(
    (bool) preg_match('/avesmapsTerritoryWikiRecordFromStagingRow\(\s*\$staging\s*,\s*\$mirror\s*\)/', $applySource),
    '💣 der Schreiber bekommt Staging UND Spiegel -- mit nur einem Argument NULLt er gute Werte'
);
assert(
    !preg_match('/avesmapsPoliticalUpsertWikiRecord\([^)]*avesmapsTerritoryWikiRecordFromStagingRow\(\s*\$staging\s*\)/', $applySource),
    'und es gibt keinen zweiten, einarmigen Aufruf daneben'
);

echo "territory-wiki-apply (Leer-Regel) ok\n";
