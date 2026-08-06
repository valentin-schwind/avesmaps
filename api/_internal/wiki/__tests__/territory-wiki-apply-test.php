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
// The adapter calls avesmapsPoliticalSlug() -- territory-wiki-plan-apply.php does not require this
// file itself (only the endpoint's own require chain does, matching the citymap/adventure/publication/
// lore siblings, which likewise assume political/territory.php from their caller), so the test loads it
// before touching the adapter.
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
