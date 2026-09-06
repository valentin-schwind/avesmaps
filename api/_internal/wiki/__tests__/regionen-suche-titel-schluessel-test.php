<?php

declare(strict_types=1);

/**
 * Die Regionen-Zeile des WikiSync-Panels traegt Artikeltitel und Synonyme -- damit die Suche im
 * Browser eine Region auch unter ihrem ARTIKELTITEL findet, nicht nur unter dem Infobox-Namen.
 *
 * Der Fall (Owner 06.09.2026): „Suedperricum" ist im Wiki eine {{Infobox Region}} mit
 * |Name=Perricumer Land. Der Parser nimmt |Name= als Namen, der Titel landet nur in wiki_key
 * (`s-dperricum`) und in den Synonymen -- und die Zeile, die der Endpunkt an den Browser gab,
 * trug weder Titel noch Synonyme. Wer „Suedperricum" tippte, fand nichts, obwohl die Region
 * zugewiesen und auf der Karte war.
 *
 * 🔴 Die NAHT ist der eigentliche Pruefgegenstand: eine Spalte, die der Zeilenbauer liest, muss
 * das SELECT auch holen. Deshalb baut das SELECT aus AVESMAPS_WIKI_REGION_MATCH_COLUMNS, und die
 * Fixture hier hat GENAU diese Spalten als Schluessel -- liest der Bauer eine Spalte, die das
 * SELECT nicht kennt, fehlt sie in der Fixture, und der Test faellt.
 *
 * Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/regionen-suche-titel-schluessel-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1'.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../regions.php';

$checks = 0;

// ---------------------------------------------------------------- 1. Die Spaltenliste ---------
assert(defined('AVESMAPS_WIKI_REGION_MATCH_COLUMNS'), 'die Spaltenliste des Match-SELECT ist eine Konstante');
$spalten = AVESMAPS_WIKI_REGION_MATCH_COLUMNS;
assert(is_array($spalten) && $spalten !== [], 'sie ist eine nicht-leere Liste');
foreach (['wiki_key', 'title', 'name', 'match_key', 'synonyms_json', 'art', 'continent', 'region_parent', 'affiliation_staat', 'image_url', 'wiki_url'] as $pflicht) {
    assert(in_array($pflicht, $spalten, true), "die Spalte '$pflicht' wird geholt");
}
$checks += 3;

// ---------------------------------------------------------------- 2. Der Fall Suedperricum ----
// Die Fixture traegt GENAU die Spalten der Konstante, sonst nichts (siehe Kopf).
$werte = [
    'wiki_key' => 's-dperricum',
    'title' => 'Südperricum',
    'name' => 'Perricumer Land',
    'match_key' => 'perricumer land',
    'synonyms_json' => '["Südperricum"]',
    'art' => 'Mischregion',
    'continent' => 'Aventurien',
    'region_parent' => 'Mittelaventurien: Perricum',
    'affiliation_staat' => 'Mittelreich, Markgrafschaft Perricum',
    'image_url' => 'https://de.wiki-aventurica.de/images/Perricumer_Land_Sofus.jpg',
    'wiki_url' => 'https://de.wiki-aventurica.de/wiki/S%C3%BCdperricum',
];
$zeile = [];
foreach ($spalten as $spalte) {
    $zeile[$spalte] = $werte[$spalte] ?? null;
}

$eintrag = avesmapsWikiRegionMatchEntry($zeile, 'Aventurien');
assert($eintrag['wiki_key'] === 's-dperricum', 'der Schluessel reist mit');
assert($eintrag['name'] === 'Perricumer Land', 'der Name bleibt der Infobox-Name');
assert($eintrag['title'] === 'Südperricum', 'der ARTIKELTITEL reist jetzt mit -- das ist die Zeile, die fehlte');
assert($eintrag['synonyms'] === ['Südperricum'], 'die Synonyme reisen als Liste von Zeichenketten mit');
assert($eintrag['art'] === 'Mischregion');
assert($eintrag['continent'] === 'Aventurien', 'der Kontinent kommt vom Aufrufer (dort faellt leer auf die Vorgabe)');
assert($eintrag['region_parent'] === 'Mittelaventurien: Perricum');
assert($eintrag['affiliation_staat'] === 'Mittelreich, Markgrafschaft Perricum');
assert($eintrag['wiki_url'] === 'https://de.wiki-aventurica.de/wiki/S%C3%BCdperricum');
assert($eintrag['has_image'] === true);
$checks += 10;

// ---------------------------------------------------------------- 3. Synonyme: kaputt = leer --
// synonyms_json ist NULL-able und kommt aus dem Crawler; nichts davon darf die ganze Liste werfen.
foreach ([null, '', '{nicht json', '"nur eine zeichenkette"', '42'] as $kaputt) {
    $zeile['synonyms_json'] = $kaputt;
    $e = avesmapsWikiRegionMatchEntry($zeile, 'Aventurien');
    assert($e['synonyms'] === [], 'ein unlesbares synonyms_json ist eine leere Liste, kein Fehler: ' . var_export($kaputt, true));
    assert($e['title'] === 'Südperricum', 'der Titel haengt nicht an den Synonymen');
    $checks += 2;
}
// Nur Zeichenketten, leere fallen raus, Reihenfolge bleibt.
$zeile['synonyms_json'] = '["Perricumer Lande", 7, null, "", " ", "Südperricum"]';
assert(avesmapsWikiRegionMatchEntry($zeile, 'Aventurien')['synonyms'] === ['Perricumer Lande', 'Südperricum'],
    'nur nicht-leere Zeichenketten bleiben, in ihrer Reihenfolge');
$checks++;

// Ein fehlender Titel (alte Zeile) ist eine leere Zeichenkette, kein Fehler.
unset($zeile['title']);
assert(avesmapsWikiRegionMatchEntry($zeile, 'Aventurien')['title'] === '', 'ohne Titel: leer, kein Wurf');
$checks++;

// ---------------------------------------------------------------- 4. Die Naht im SELECT ------
// avesmapsWikiRegionMatch baut sein SELECT aus der Konstante -- keine zweite, handgeschriebene
// Spaltenliste, die beim naechsten Feld wieder auseinanderlaeuft. Per Reflection auf den Rumpf,
// nicht per Regex ueber die ganze Datei (die traefe auch Kommentare).
$rf = new ReflectionFunction('avesmapsWikiRegionMatch');
$quelle = file($rf->getFileName());
$rumpf = implode('', array_slice($quelle, $rf->getStartLine() - 1, $rf->getEndLine() - $rf->getStartLine() + 1));
assert(str_contains($rumpf, 'AVESMAPS_WIKI_REGION_MATCH_COLUMNS'), 'das SELECT des Match-Laufs nennt die Konstante');
assert(!preg_match('/SELECT\s+wiki_key\s*,\s*name\s*,/i', $rumpf), 'keine handgeschriebene Spaltenliste mehr neben der Konstante');
assert(str_contains($rumpf, 'avesmapsWikiRegionMatchEntry('), 'der Match-Lauf baut seine Zeilen mit dem geteilten Bauer');
$checks += 3;

echo "regionen-suche-titel-schluessel: {$checks} Zusicherungen bestanden\n";
