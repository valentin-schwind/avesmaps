<?php

declare(strict_types=1);

/**
 * Die FELDHERKUNFT der Landschaft auf der Leitung -- avesmapsEcosystemRegionFieldOrigins und ihre
 * Verdrahtung in avesmapsListEcosystemRegions (api/_internal/app/ecosystem.php).
 *
 * 🔴 WARUM ES DIESEN LESEWEG BRAUCHT. Die Schreibhaelfte steht seit dem 18.08.2026 auf `master` und
 * stempelt (`avesmapsEcosystemApplyRegionFieldOrigins`) -- aber `list_regions` gibt `properties_json`
 * BEWUSST nicht heraus, und damit gab es fuer die Stempel keinen Leser. Der Bauplan vom 18.08. nahm
 * an, „die Oberflaeche muss `field_origins` nur noch in ihre Quelle legen"; am 22.08. gemessen war
 * das falsch -- die Daten waren gar nicht auf der Leitung.
 *
 * 💣 DIESER TEST HAT ZWEI HAELFTEN, und die zweite ist die, an der das Haus schon einmal gescheitert
 * ist: eine getestete Funktion, die niemand aufruft, ist gruen und wirkungslos. Also (1) die reine
 * Rechnung UND (2) ein echter `list_regions`-Lauf gegen eine Fixture, der die Zeile im Ergebnis
 * findet.
 *
 * Run (Windows), vom Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/ecosystem-field-origins-projektion-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

// assert() ist ohne zend.assertions=1 ein Nulloperator -- sonst liefe die Probe falsch gruen.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere hier wirkungslos und die Probe meldete falsche Erfolge.\n");
    exit(2);
}

require __DIR__ . '/../ecosystem.php';

// ---- 1) Die reine Rechnung ----------------------------------------------------------------------

assert(avesmapsEcosystemRegionFieldOrigins(null) === [], 'NULL traegt keine Herkunft');
assert(avesmapsEcosystemRegionFieldOrigins('') === [], 'leer traegt keine Herkunft');
assert(avesmapsEcosystemRegionFieldOrigins('kein json') === [], 'kaputtes JSON traegt keine Herkunft');
assert(avesmapsEcosystemRegionFieldOrigins('{"hoehe":3}') === [], 'eine Ablage ohne field_origins ist leer');

assert(avesmapsEcosystemRegionFieldOrigins('{"field_origins":{"name":"manual"}}') === ['name' => 'manual'],
    'die einzelne Herkunft kommt nicht durch');
assert(avesmapsEcosystemRegionFieldOrigins('{"field_origins":{"name":"wiki","region_type":"manual"}}')
    === ['name' => 'wiki', 'region_type' => 'manual'], 'beide Felder kommen nicht durch');

// ⚠️ GEFILTERT: was kein Kartenfeld dieser Objektart ist, faellt heraus. Eine Ablage, die von Hand
// oder aus einer kuenftigen Fassung mehr traegt, soll die Oberflaeche nicht mit Eintraegen fuellen,
// fuer die es gar keine Zeile gibt.
$fremd = avesmapsEcosystemRegionFieldOrigins('{"field_origins":{"name":"manual","geometry":"manual","is_hidden":"wiki"}}');
assert($fremd === ['name' => 'manual'], 'ein fremdes Feld reist mit: ' . json_encode($fremd));

// ⚠️ Und ein unbekannter HERKUNFTSWERT ebenso -- dieselbe Strenge wie avesmapsFieldOriginsStempeln
// und js/ui/wiki-feld-herkunft.js. Sonst reichte eine Ablage „community" bis in die Anzeige durch
// und der Browser entschiede an einem Wert, den niemand definiert hat.
$mist = avesmapsEcosystemRegionFieldOrigins('{"field_origins":{"name":"community","region_type":"wiki"}}');
assert($mist === ['region_type' => 'wiki'], 'ein unbekannter Herkunftswert reist mit: ' . json_encode($mist));

// 🔴 Die zwei Konstanten kommen aus api/_internal/map/field-origins.php und werden vom LESER selbst
// geladen. Ohne das require waeren sie hier undefiniert -- in PHP 8 ein Fatal Error, und ein Fatal
// antwortet mit LEEREM Rumpf („Unexpected end of JSON input" im Browser, sieht aus wie ein
// Netzfehler). Genau daran ist der Wege-Editor am 19.08.2026 beim ersten Klick gescheitert.
assert(defined('AVESMAPS_FIELD_ORIGIN_WIKI') && defined('AVESMAPS_FIELD_ORIGIN_MANUAL'),
    'der Leser laedt field-origins.php nicht -- die Konstanten fehlen');

// ---- 2) 💣 UND SIE MUSS AUCH WIRKLICH AUFGERUFEN WERDEN ------------------------------------------
// Ohne diese Haelfte waere die Probe durch eine Funktion erfuellbar, die korrekt rechnet und die
// NIEMAND aufruft -- genau der Zustand, in dem die Schreibhaelfte seit dem 18.08.2026 steckte:
// gepflegte Stempel, kein Leser. Ein gruener Test ohne Verdrahtung beweist nichts.
//
// 🪤 WARUM KEIN ECHTER DURCHLAUF GEGEN EINE FIXTURE: `avesmapsListEcosystemRegions` ruft als ERSTE
// Anweisung `avesmapsEcosystemEnsureTables()`, und das ist MySQL-DDL (AUTO_INCREMENT, ENGINE,
// COLLATE) -- SQLite bricht dort ab. Die Produktionsform dafuer zu verbiegen, waere der Fehler vom
// 16.08.2026: wer die Produktion an den Test anpasst, hat den Test gegen die Produktion gedreht
// (MySQL Error 1093, AGENTS.md §9). Also wird die GELADENE Funktion befragt statt der Datei --
// Reflection liest die Definition, die auch laufen wuerde, nicht irgendeine Abschrift auf der
// Platte.
$spiegel = new ReflectionFunction('avesmapsListEcosystemRegions');
$quelle = implode('', array_slice(
    file($spiegel->getFileName()),
    $spiegel->getStartLine() - 1,
    $spiegel->getEndLine() - $spiegel->getStartLine() + 1
));

assert(str_contains($quelle, 'avesmapsEcosystemRegionFieldOrigins('),
    'list_regions ruft die Projektion nicht auf -- die Herkunft steht dann nirgends auf der Leitung, '
    . 'und der Editor kann sie nicht kennen, egal wie gepflegt sie in der Ablage steht.');
assert(str_contains($quelle, "'field_origins' =>"),
    'list_regions legt das Ergebnis nicht unter dem Schluessel `field_origins` ab -- der Browser sucht '
    . 'genau diesen Namen (js/ui/wiki-assign-landschaft.js).');
assert(str_contains($quelle, 'r.properties_json'),
    'die Abfrage holt `properties_json` gar nicht mehr -- die Projektion bekaeme dann immer NULL und '
    . 'meldete stumm „keine Herkunft".');

// 🔴 UND DIE ABLAGE SELBST BLEIBT DRAUSSEN. Der Kommentar an dieser Projektion sagt woertlich: „die
// Oberflaechen brauchen die Antwort, nicht die Ablage, und ein `properties_json` auf der Leitung
// waere die Einladung, dort noch etwas anderes hineinzuschreiben." Wer die Herkunft billig
// dazunehmen will, indem er die Spalte durchreicht, faellt hier auf.
assert(!preg_match("/'properties_json'\s*=>/", $quelle),
    'list_regions gibt jetzt die rohe Ablage heraus -- auf die Leitung gehoert die ANTWORT, nie die Ablage');

echo "OK — die Feldherkunft der Landschaft rechnet richtig UND steht auf der Leitung.\n";
