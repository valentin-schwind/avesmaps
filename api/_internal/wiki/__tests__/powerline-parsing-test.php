<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE powerline parser in api/_internal/wiki/powerlines.php.
 * No DB, no dump, no HTTP -- the wikitext fixture is a REAL excerpt from Wiki Aventurica
 * (Basiliuslinie, fetched 2026-07-22), so the asserts pin actual quirks rather than
 * invented ones. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/powerline-parsing-test.php
 * Exit 0 = all asserts passed.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

// powerlines.php reuses primitives that live across the wiki libs; the real endpoints load
// this same chain before including a parser (see the note at the top of paths.php).
require_once __DIR__ . '/../sync.php';
require_once __DIR__ . '/../sync-monitor.php';
require_once __DIR__ . '/../sync-monitor-parsing.php';
require_once __DIR__ . '/../territories-tree.php';
require_once __DIR__ . '/../territories-parsing.php';
require_once __DIR__ . '/../../political/territory.php';
require __DIR__ . '/../powerlines.php';

// Real excerpt (Basiliuslinie). The Verlauf rows are verbatim, including the empty second
// param of the Sala-Mandra row and the "Zwei=j" flags.
$basiliuslinie = <<<'WIKI'
{{Aventurien}}
{{Spoiler|[[Borbarad-Kampagne]]}}
__TOC__
{{Infobox Kraftlinie
|Name=Basiliuslinie
|Bild={{Boximage|Basiliuslinie.png}}
|Stärke=kontinental
|Affinität=Leben und Tod
|Länge=ca. 3000 Meilen
|Regionen=Ewiges Eis, [[Firunsfinger]], [[Salamandersteine]], [[Neunaugensee]], [[Weiden|Weiden]], [[Almada]]
|Verlauf=
{{Nexus|[[Himmelsturm (Siedlung)|Himmelsturm]]|u.a. mit [[Schlüssellinie des Eises]]}}
{{Kraftlinie|[[Asainyf]]|}}
{{Nodix|[[Sala Mandra]]| |Zwei=j}}
{{Nodix|[[Nachtschattensturm]]|mit [[Hexenband]]}}
}}
Die '''Basiliuslinie''' ist eine der bekanntesten [[Kraftlinie]]n Aventuriens.

==Publikationen==
* {{Quelle|Aventurischer Almanach|S. 12}}
WIKI;

// ------------------------------------------------------------------- GATE ---
$parsed = avesmapsWikiPowerlineParsePage('Basiliuslinie', $basiliuslinie, 'Basiliuslinie', 'dump', '');
assert($parsed['is_powerline'] === true, 'an Infobox Kraftlinie page must be claimed');
$record = $parsed['record'];
assert(is_array($record));
echo "gate ok\n";

// Entities owned by other handlers must never be claimed here.
$road = "{{Infobox Straße\n|Name=Reichsstraße 2\n}}\nEine Straße.";
assert(avesmapsWikiPowerlineParsePage('Reichsstraße 2', $road)['is_powerline'] === false, 'a road must not be claimed');
$noInfobox = "Nur Fließtext über [[Kraftlinie]]n, ohne Infobox.";
assert(avesmapsWikiPowerlineParsePage('Kraftlinie', $noInfobox)['is_powerline'] === false, 'prose mentioning Kraftlinie is not an entity');
echo "foreign infoboxes rejected ok\n";

// ----------------------------------------------------------------- FIELDS ---
// Umlaut field keys arrive normalized (ä->a): Stärke->starke, Affinität->affinitat,
// Länge->lange. Getting this wrong would silently yield empty strings.
assert($record['name'] === 'Basiliuslinie', 'name: ' . $record['name']);
assert($record['staerke'] === 'kontinental', 'staerke: ' . $record['staerke']);
assert($record['affinitaet'] === 'Leben und Tod', 'affinitaet: ' . $record['affinitaet']);
assert($record['laenge'] === 'ca. 3000 Meilen', 'laenge: ' . $record['laenge']);
assert(str_contains($record['regionen'], 'Firunsfinger'), 'regionen: ' . $record['regionen']);
assert($record['wiki_url'] !== '', 'a wiki_url must be built');
echo "fields ok\n";

// ---------------------------------------------------------------- VERLAUF ---
// Ordered station chain out of {{Nexus}}/{{Kraftlinie}}/{{Nodix}} rows. Display text after
// "|" wins (Himmelsturm, not "Himmelsturm (Siedlung)"), and the empty second param of the
// Sala-Mandra row must not swallow the station.
$stations = explode(' → ', $record['verlauf']);
assert($stations[0] === 'Himmelsturm', 'first station: ' . $stations[0]);
assert(in_array('Sala Mandra', $stations, true), 'Sala Mandra missing from: ' . $record['verlauf']);
assert(in_array('Nachtschattensturm', $stations, true), 'Nachtschattensturm missing');
// The note param names OTHER lines (Hexenband, Schlüssellinie des Eises). Those are not
// stations of THIS line and must never enter the chain.
assert(!in_array('Hexenband', $stations, true), 'a note-param line leaked into the chain');
assert(!in_array('Schlüssellinie des Eises', $stations, true), 'a note-param line leaked into the chain');
echo "verlauf ok\n";

// ------------------------------------------------------------------- KEYS ---
// match_key is the join to our map: the 162 powerline rows carry real lore names.
assert($record['match_key'] === avesmapsWikiSyncCreateMatchKey('Basiliuslinie'));
assert($record['wiki_key'] !== '', 'wiki_key must not be empty');
echo "keys ok\n";

// --------------------------------------------------------- UNNAMED FALLBACK ---
// "(unbenannte Kraftlinie)" is a REAL infobox value in the wiki; the title must win.
$unnamed = "{{Infobox Kraftlinie\n|Name=(unbenannte Kraftlinie)\n|Stärke=regional\n}}\nText.";
$u = avesmapsWikiPowerlineParsePage('Kraftlinie zwischen Himmelsturm und Heiligtum der alten Götter', $unnamed);
assert($u['is_powerline'] === true);
assert($u['record']['name'] === 'Kraftlinie zwischen Himmelsturm und Heiligtum der alten Götter', 'name: ' . $u['record']['name']);
echo "unnamed fallback ok\n";

echo "powerline parsing tests passed\n";
