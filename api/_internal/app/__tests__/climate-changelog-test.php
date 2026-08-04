<?php

declare(strict_types=1);

/**
 * Unit test: was steht in der Änderungsliste, wenn jemand eine Klimagrenze verschoben hat? Keine DB.
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/app/__tests__/climate-changelog-test.php
 * Exit 0 = alle Zusicherungen bestanden.
 *
 * 💣 WARUM DAS EIN TEST IST. Die Liste sah so aus (Owner 2026-08-04):
 *     update_climate_divider
 *     Unbenannt
 * Beides sind FALLBACKS, keine Fehler -- der rohe Aktionsschlüssel, weil die Beschriftungstabelle die
 * Aktion nicht kannte, und „Unbenannt", weil eine Trennlinie weder auf eine Fläche noch auf eine Region
 * zeigt. Solche Lücken melden sich nie von selbst; sie sehen aus wie eine Anzeige, die funktioniert.
 */

require_once __DIR__ . '/../ecosystem.php';

// Die sieben Zonen von Nord nach Süd, so wie avesmapsEcosystemClimateZones sie liefert.
$zonen = [
    ['type_key' => 'polar', 'label' => 'Polare Zone'],
    ['type_key' => 'subpolar', 'label' => 'Subpolare Zone'],
    ['type_key' => 'boreal', 'label' => 'Boreale Zone'],
    ['type_key' => 'gemaessigt', 'label' => 'Gemäßigte Zone'],
    ['type_key' => 'subtropen_winterfeucht', 'label' => 'Winterfeuchte Subtropen'],
    ['type_key' => 'trockene_subtropen', 'label' => 'Subtropische Steppenzone'],
    ['type_key' => 'subtropisch', 'label' => 'Subtropische Wüstenzone'],
    ['type_key' => 'tropisch', 'label' => 'Tropische Zone'],
];

// ---- die Beschriftung ------------------------------------------------------------------------------

assert(avesmapsEcosystemActionLabel('update_climate_divider') === 'Klimagrenze verschoben',
    'die Aktion hat einen deutschen Namen und nicht mehr ihren Schlüssel');
assert(avesmapsEcosystemActionLabel('reset_climate_dividers') === 'Klimagrenzen zurückgesetzt',
    'und das Zurücksetzen auch');
// Der Rückfall bleibt, was er ist: eine unbekannte Aktion zeigt ihren Schlüssel, statt zu verschwinden.
assert(avesmapsEcosystemActionLabel('etwas_neues') === 'etwas_neues', 'Unbekanntes zeigt sich roh');

// ---- welche Grenze war das? ------------------------------------------------------------------------

assert(avesmapsEcosystemClimateDividerName($zonen, 'gemaessigt') === 'Boreale Zone – Gemäßigte Zone',
    'die Linie wird über die Zone UNTER ihr benannt, mit der darüber davor');
assert(avesmapsEcosystemClimateDividerName($zonen, 'tropisch') === 'Subtropische Wüstenzone – Tropische Zone',
    'die südlichste Grenze genauso');

// 🔴 Über der nördlichsten Zone liegt keine Trennlinie -- dort gibt es nichts zu benennen.
assert(avesmapsEcosystemClimateDividerName($zonen, 'polar') === '',
    'über der Polaren Zone liegt keine Grenze');
assert(avesmapsEcosystemClimateDividerName($zonen, 'gibtsnicht') === '', 'ein unbekannter Schlüssel gibt nichts');
assert(avesmapsEcosystemClimateDividerName([], 'gemaessigt') === '', 'ohne Zonen gibt es keinen Namen');
// Lieber gar kein Name als ein halber: eine Zone ohne Beschriftung nimmt die Grenze mit.
assert(avesmapsEcosystemClimateDividerName(
    [['type_key' => 'a', 'label' => ''], ['type_key' => 'b', 'label' => 'B']], 'b') === '',
    'fehlt eine der beiden Beschriftungen, bleibt der Name leer');

// ---- woher kommt die Zone unter der Linie? ----------------------------------------------------------
// 🪤 ZUERST der mitgeschriebene Schlüssel, DANN erst die Nummer.

assert(avesmapsEcosystemClimateSouthKeyOfAudit($zonen, ['south_type_key' => 'boreal', 'seq' => 99]) === 'boreal',
    'der mitgeschriebene Schlüssel schlägt die Nummer');

// Ältere Zeilen haben nur die Nummer: seq k trennt Zone k von Zone k+1 (1-basiert).
assert(avesmapsEcosystemClimateSouthKeyOfAudit($zonen, ['seq' => 1]) === 'subpolar',
    'seq 1 liegt zwischen der ersten und der zweiten Zone');
assert(avesmapsEcosystemClimateSouthKeyOfAudit($zonen, ['seq' => 3]) === 'gemaessigt', 'seq 3 entsprechend');

// 💣 UND GENAU DESHALB IST DER SCHLÜSSEL BESSER. Am 2026-08-03 wurde die „Subtropische Steppenzone"
// zwischen zwei bestehende Zonen geschoben -- jede Nummer darunter zeigt seitdem auf eine andere Grenze.
$alteZonen = array_values(array_filter($zonen, static fn($z) => $z['type_key'] !== 'trockene_subtropen'));
assert(avesmapsEcosystemClimateSouthKeyOfAudit($alteZonen, ['seq' => 6]) === 'tropisch',
    'vor dem Einschub zeigte seq 6 auf die Tropische Zone ...');
assert(avesmapsEcosystemClimateSouthKeyOfAudit($zonen, ['seq' => 6]) === 'subtropisch',
    '... und danach auf die Subtropische Wüstenzone -- der Grund, aus dem der Schlüssel mitgeschrieben wird');

assert(avesmapsEcosystemClimateSouthKeyOfAudit($zonen, ['seq' => 0]) === '', 'seq 0 gibt es nicht');
assert(avesmapsEcosystemClimateSouthKeyOfAudit($zonen, ['seq' => 99]) === '', 'eine Nummer jenseits der Liste auch nicht');
assert(avesmapsEcosystemClimateSouthKeyOfAudit($zonen, null) === '', 'ohne Protokollinhalt gibt es nichts');
assert(avesmapsEcosystemClimateSouthKeyOfAudit($zonen, []) === '', 'und aus einer leeren Zeile auch nicht');

fwrite(STDOUT, "climate-changelog-test: OK\n");
