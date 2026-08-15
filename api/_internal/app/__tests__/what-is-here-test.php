<?php

declare(strict_types=1);

/**
 * Unit-Test der reinen Haelfte von „Was ist hier?". Keine DB, kein HTTP.
 * Ausfuehren (aus dem Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/what-is-here-test.php
 * Exit 0 = alle Zusicherungen halten.
 *
 * WARUM GENAU DAS GEPRUEFT WIRD: jeder Fehler hier ist lautlos. Eine gedrehte Kette zeigt
 * dieselben vier Namen in falscher Reihenfolge; ein doppeltes Gebiet sieht aus wie zwei Stufen;
 * und ein Lore-Schluessel zuviel („aventurien") schuettet ueber JEDEN Punkt der Karte dieselben
 * 1.167 Eintraege aus, ohne dass irgendwo ein Fehler auftaucht.
 */

require_once __DIR__ . '/../what-is-here.php';

// ---------------------------------------------------------------- DIE KETTE ---------------------
// Vier Treffer, absichtlich in wilder Reihenfolge -- so kamen sie am 15.08.2026 aus dem bbox.

$treffer = [
    ['id' => 539, 'parent_id' => 538, 'public_id' => 'p-539', 'wiki_key' => 'wiki:grafenmark-ferdok',
     'name' => 'Grafenmark Ferdok', 'short_name' => '', 'type' => 'Grafenmark', 'coat_url' => '/u/a.png'],
    ['id' => 345, 'parent_id' => 0,   'public_id' => 'p-345', 'wiki_key' => 'wiki:kaiserreich',
     'name' => 'Kaiserreich', 'short_name' => 'Mittelreich', 'type' => 'Kaiserreich', 'coat_url' => ''],
    ['id' => 491, 'parent_id' => 345, 'public_id' => 'p-491', 'wiki_key' => 'wiki:kosch',
     'name' => 'Fuerstentum Kosch', 'short_name' => '', 'type' => 'Fuerstentum', 'coat_url' => ''],
    ['id' => 538, 'parent_id' => 491, 'public_id' => 'p-538', 'wiki_key' => 'wiki:grafschaft-ferdok',
     'name' => 'Grafschaft Ferdok', 'short_name' => '', 'type' => 'Grafschaft', 'coat_url' => ''],
];

$kette = avesmapsWhatIsHereOrderTerritories($treffer);
assert(count($kette) === 4, 'vier Treffer, vier Stufen');
assert($kette[0]['name'] === 'Grafenmark Ferdok', 'BLATT zuerst -- buildSettlementHierarchyMarkup dreht selbst');
assert($kette[3]['name'] === 'Kaiserreich', 'Wurzel zuletzt');

// 💣 Dasselbe Gebiet mit ZWEI Geometriezeilen -- am 15.08.2026 auf Maraskan gemessen.
$doppelt = [$treffer[0], $treffer[0]];
assert(count(avesmapsWhatIsHereOrderTerritories($doppelt)) === 1, 'entdoppelt ueber public_id');

// Ein Wurzelgebiet allein (Fuerstkomturei Tobimora): EINE Stufe, kein Absturz.
assert(count(avesmapsWhatIsHereOrderTerritories([$treffer[1]])) === 1, 'ein unabhaengiges Gebiet');
assert(avesmapsWhatIsHereOrderTerritories([]) === [], 'kein Treffer -> leere Kette, kein Fehler');

// ---------------------------------------------------------------- DIE LORE-SCHLUESSEL -----------

$flaechen = [
    ['kind' => 'derographisch', 'region_public_id' => 'r-1', 'wiki_region_key' => 'aventurien'],
    ['kind' => 'vegetation',    'region_public_id' => 'r-2', 'wiki_region_key' => 'dunkelwald'],
    ['kind' => 'vegetation',    'region_public_id' => 'r-3', 'wiki_region_key' => null],
    ['kind' => 'klima',         'region_public_id' => 'r-4', 'wiki_region_key' => null],
];

$lore = avesmapsWhatIsHereLoreKeys($kette, $flaechen);

// 🔴 „aventurien" traegt 1.167 Lore-Eintraege. Waere es dabei, listete JEDER Punkt der Karte
// dieselben 1.167 -- was ueberall gilt, sagt ueber diese Stelle nichts.
assert(!in_array('aventurien', $lore['place'], true), 'die Derographie liefert KEINE Lore');
assert(in_array('dunkelwald', $lore['place'], true), 'die Vegetationsflaeche liefert welche');
assert(in_array('grafenmark-ferdok', $lore['place'], true), 'das Gebiet auch -- und das Praefix wiki: ist ab');
assert(!in_array('', $lore['place'], true), 'eine Flaeche ohne Wiki-Schluessel liefert keinen leeren Schluessel');

// 🔴 `area` nimmt JEDE getroffene Flaeche, auch die derographische: dort greift die
// Lebensraum-REGEL, nicht die Ortsverknuepfung -- das sind zwei verschiedene Quellen.
assert(count($lore['area']) === 4, 'alle vier Flaechen stehen in area');

echo "what-is-here: alles gruen\n";
