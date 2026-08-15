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

// ---------------------------------------------------------------- DIE OEFFENTLICHE FORM ---------
// 🔴 buildSettlementHierarchyMarkup (js/ui/popups.js:863) liest territory_public_id, nicht public_id
// (Fix-Runde 1, Aufgabe 3 -- ohne die Umbenennung liefen die Gold-Flug-Links der Treppe ins Leere).

// 🔴 DIE SCHRANKE (Fix-Runde 2): $kette steht hier stellvertretend fuer das, was
// avesmapsWhatIsHereReadTerritories() zurueckgibt -- dieselbe Funktion (avesmapsWhatIsHereOrderTerritories)
// auf denselben Rohdaten. avesmapsWhatIsHereLoreKeys() lebt von genau diesem wiki_key (Territorien-Zweig
// von lore.place, siehe unten). Was hier eigentlich bewacht wird: die Kuerzung auf die oeffentliche Form
// (avesmapsWhatIsHereTerritoryPayload) darf NIE innerhalb von avesmapsWhatIsHereReadTerritories passieren
// -- nur danach, im Endpunkt (api/app/what-is-here.php, siehe die Quelltext-Ordnungs-Zusicherung unten).
// Striche man wiki_key schon in der Lesefunktion, verloere lore.place jeden Territoriums-Schluessel
// lautlos, und kein Test hier erreichte das (avesmapsWhatIsHereReadTerritories braucht ein PDO).
foreach ($kette as $stufe) {
    assert(array_key_exists('wiki_key', $stufe) && $stufe['wiki_key'] !== '',
        'die geordnete Kette traegt wiki_key -- die Kuerzung darf nicht in die Lesefunktion wandern');
}

$payload = avesmapsWhatIsHereTerritoryPayload($kette);
assert(count($payload) === 4, 'eine Zeile je Stufe, unveraendert in der Zahl');
assert($payload[0]['territory_public_id'] === $kette[0]['public_id'],
    'territory_public_id traegt den Wert von public_id');
assert($payload[0]['name'] === $kette[0]['name'], 'name reist unveraendert mit');
assert($payload[0]['short_name'] === $kette[0]['short_name'], 'short_name reist unveraendert mit');
assert($payload[0]['type'] === $kette[0]['type'], 'type reist unveraendert mit');
assert($payload[0]['coat_url'] === $kette[0]['coat_url'], 'coat_url reist unveraendert mit');

// 💣 id/parent_id/wiki_key sind interne Angaben und duerfen die oeffentliche Form nicht erreichen.
foreach ($payload as $stufe) {
    assert(!array_key_exists('id', $stufe), 'id fliegt raus -- interne DB-Identitaet');
    assert(!array_key_exists('parent_id', $stufe), 'parent_id fliegt raus -- nur fuer die Tiefenrechnung');
    assert(!array_key_exists('wiki_key', $stufe), 'wiki_key fliegt raus -- schon in lore.place verarbeitet');
}
assert(avesmapsWhatIsHereTerritoryPayload([]) === [], 'kein Treffer -> leere oeffentliche Kette');

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

// ---------------------------------------------------------------- DIE ENDPUNKT-ORDNUNG ----------
// 🔴 DIE SCHRANKE, ZWEITE HAELFTE: avesmapsWhatIsHereReadTerritories() selbst laesst sich hier nicht
// pruefen (braucht ein PDO), und api/app/what-is-here.php wird von keiner Testdatei geladen (nur GET,
// nur HTTP). Diese Zusicherung prueft deshalb den QUELLTEXT des Endpunkts, im Stil des Panel-Tests
// (js/map-features/__tests__/what-is-here-panel.test.js): der Aufruf von avesmapsWhatIsHereLoreKeys()
// muss VOR dem von avesmapsWhatIsHereTerritoryPayload() stehen -- wiki_key muss bis dahin in der Kette
// stehen bleiben. 💣 Kommentare werden VORHER ausgeblendet: die Prosa in dieser Datei nennt beide
// Funktionsnamen mehrfach, ein Treffer darin waere kein Beweis.
function avesmapsWhatIsHereTestOhneKommentare(string $quelltext): string
{
    $ohneBlock = preg_replace('#/\*.*?\*/#s', '', $quelltext);
    return preg_replace('#^[ \t]*//.*$#m', '', $ohneBlock);
}

$endpunktQuelle = avesmapsWhatIsHereTestOhneKommentare(
    (string) file_get_contents(__DIR__ . '/../../../app/what-is-here.php')
);
$loreAufruf = strpos($endpunktQuelle, 'avesmapsWhatIsHereLoreKeys(');
$payloadAufruf = strpos($endpunktQuelle, 'avesmapsWhatIsHereTerritoryPayload(');
assert($loreAufruf !== false, 'der Endpunkt ruft avesmapsWhatIsHereLoreKeys ueberhaupt auf');
assert($payloadAufruf !== false, 'der Endpunkt ruft avesmapsWhatIsHereTerritoryPayload ueberhaupt auf');
assert($loreAufruf < $payloadAufruf,
    'avesmapsWhatIsHereLoreKeys laeuft VOR avesmapsWhatIsHereTerritoryPayload -- sonst wiki_key schon weg');

echo "what-is-here: alles gruen\n";
