<?php

declare(strict_types=1);

/**
 * Der gespeicherte Haken „Auto-Name" einer Landschaftsflaeche, Schreibseite --
 * avesmapsEcosystemRegionAutoName + avesmapsEcosystemApplyRegionAutoName
 * (api/_internal/app/ecosystem.php).
 *
 * 💣 DER FEHLER, DER DAZU GEFUEHRT HAT (Owner 26.08.2026): der Haken wurde gar nicht gespeichert,
 * sondern im Browser aus dem NAMEN abgeleitet -- mit einer Zusatzbedingung, die der Namensgeber
 * nicht kennt (`region_type !== ""`). Eine frisch gezeichnete Region hat noch KEINE Art; der
 * Namensgeber stoert das nicht (er faellt auf den Griff „Flaeche" zurueck und vergibt
 * „Flaeche-100"), die Ableitung sagte dagegen „keine Art ⇒ niemals automatisch". Anhaken,
 * speichern, wieder aufmachen -- Haken weg. Der NAME war korrekt gespeichert, nur die Anzeige log.
 *
 * 🔴 DIE EINE UNTERSCHEIDUNG ZUM NACHBARN: `wiki_no_article` LOESCHT sein `false` (dort sind
 * „entschieden: nein" und „nie entschieden" bedeutungsgleich), dieser Merker SPEICHERT es. Eine
 * Region, die „Wald-001" heisst und deren Haken jemand bewusst entfernt hat, kaeme sonst beim
 * naechsten Oeffnen wieder angehakt zurueck -- derselbe Fehler, nur andersherum.
 *
 * Run (Windows), vom Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/app/__tests__/ecosystem-auto-name-merker-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

// assert() ist ohne zend.assertions=1 ein Nulloperator -- sonst liefe die Probe falsch gruen.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- "
        . "assert() waere hier wirkungslos und die Probe meldete falsche Erfolge.\n");
    exit(2);
}

require __DIR__ . '/../ecosystem.php';

$zeile = static fn (?string $properties): array => ['properties_json' => $properties];
$merker = static function (array $felder): ?bool {
    if (!array_key_exists('properties_json', $felder)) {
        return null;                       // nichts zu schreiben
    }
    return avesmapsEcosystemRegionAutoName($felder['properties_json']);
};

// ---- 1) Lesen: DREI Zustaende, und der dritte ist der Punkt --------------------------------------
// 🔴 `null` heisst „nie angefasst" und uebergibt die Entscheidung an den Namen. Waere er `false`,
// koennte der Browser Altbestand („Wald-001", nie angefasst) nicht mehr von einer ausdruecklichen
// Abwahl unterscheiden -- und 401 auto-benannte Flaechen gingen auf einen Schlag ungehakt auf.
assert(avesmapsEcosystemRegionAutoName(null) === null, 'NULL muss „nie angefasst" heissen');
assert(avesmapsEcosystemRegionAutoName('') === null, 'leer muss „nie angefasst" heissen');
assert(avesmapsEcosystemRegionAutoName('kein json') === null, 'kaputtes JSON muss „nie angefasst" heissen');
assert(avesmapsEcosystemRegionAutoName('{"hoehe":3}') === null, 'ein fremder Schluessel ist kein Merker');
assert(avesmapsEcosystemRegionAutoName('{"auto_name":true}') === true);
assert(avesmapsEcosystemRegionAutoName('{"auto_name":false}') === false);

// ---- 2) 💣 FEHLT DER SCHLUESSEL IM RUMPF, BLEIBT DER MERKER UNANGETASTET -------------------------
// Die Partialitaet IST die Regel: geschrieben wird nur, was mitgeschickt wurde. Sonst nimmt ein
// Rumpf, der bloss den Namen aendert, die Entscheidung eines zweiten Editors still zurueck.
assert(avesmapsEcosystemApplyRegionAutoName($zeile('{"auto_name":true}'), ['name' => 'X'], []) === [],
    'ein Rumpf ohne auto_name schreibt am Merker herum');
assert(avesmapsEcosystemApplyRegionAutoName($zeile(null), ['name' => 'X'], []) === [],
    'ein Rumpf ohne auto_name legt einen Merker an');

// ---- 3) Setzen und wieder abwaehlen -- BEIDE Richtungen ------------------------------------------
$gesetzt = avesmapsEcosystemApplyRegionAutoName($zeile(null), ['auto_name' => true], []);
assert($merker($gesetzt) === true, 'das Haekchen erreicht die Ablage nicht');

// 🔴 DIE ZUSICHERUNG, DIE DIESEN MERKER VOM NACHBARN TRENNT: abgewaehlt wird als `false`
// GESPEICHERT, nicht entfernt. Wer hier „aufraeumt" und `unset` schreibt, bekommt eine Region, die
// „Wald-001" heisst, beim naechsten Oeffnen wieder angehakt -- und das naechste Speichern benennt
// sie um. Der Test unterscheidet deshalb ausdruecklich `false` von `null`.
$abgewaehlt = avesmapsEcosystemApplyRegionAutoName($zeile('{"auto_name":true}'), ['auto_name' => false], []);
assert($merker($abgewaehlt) === false, 'das Abwaehlen wird nicht gespeichert: '
    . var_export($abgewaehlt['properties_json'] ?? null, true));
assert($merker($abgewaehlt) !== null, 'das Abwaehlen loescht den Merker, statt ihn auf false zu setzen');

// 🔴 Und `null` im Rumpf ist der Weg ZURUECK in den dritten Zustand -- ohne ihn liesse sich eine
// einmal getroffene Entscheidung nie mehr aufgeben.
$zurueckgesetzt = avesmapsEcosystemApplyRegionAutoName($zeile('{"auto_name":false}'), ['auto_name' => null], []);
assert($zurueckgesetzt['properties_json'] === null, 'null setzt nicht auf „ableiten" zurueck');

// ---- 4) Die uebrigen Eigenschaften ueberleben ----------------------------------------------------
// Der Merker ist ein Schluessel IN der Ablage, nicht die Ablage. Ginge das schief, naehme jedes
// Umlegen des Hakens Hoehenwerte, Kurvenbeschriftung und Feldherkunft mit.
$mitNachbarn = avesmapsEcosystemApplyRegionAutoName(
    $zeile('{"hoehe":3,"auto_name":true}'),
    ['auto_name' => false],
    []
);
$nachher = json_decode((string) $mitNachbarn['properties_json'], true);
assert(($nachher['hoehe'] ?? null) === 3, 'die Nachbareigenschaften ueberleben das Umlegen nicht');
assert(($nachher['auto_name'] ?? null) === false);

// ---- 5) ⚠️ GERECHNET WIRD AUF DEM RUMPF, WENN ER EIGENSCHAFTEN MITBRINGT -------------------------
// Steht in `$fields` schon ein `properties_json` (weil ein frueherer Anwender es dort abgelegt hat),
// ist DAS die Quelle -- sonst loeschte diese Funktion dessen Ergebnis still wieder weg. Genau
// deshalb steht sie in `update_region` VOR den drei anderen `properties_json`-Schreibern.
$ausFields = avesmapsEcosystemApplyRegionAutoName(
    $zeile('{"hoehe":3}'),
    ['auto_name' => true],
    ['properties_json' => '{"kurve":1}']
);
$gelesen = json_decode((string) $ausFields['properties_json'], true);
assert(($gelesen['kurve'] ?? null) === 1, 'der Stand aus $fields wird verworfen');
assert(!array_key_exists('hoehe', $gelesen), 'es wird auf der gespeicherten Zeile gerechnet statt auf $fields');

// ---- 6) Ein Rumpf, der NUR den Haken umlegt, ist ein gueltiger Schreibvorgang --------------------
// 💣 In `update_region` steht die Leer-Pruefung („No updatable field was sent") NACH allen vier
// Anwendern. Liefe sie davor, taete der Haken im Regionen-Editor nichts, ohne dass irgendwo etwas
// fehlschluege -- die Fehlerklasse, die diesen ganzen Merker ausgeloest hat.
$nurHaken = avesmapsEcosystemApplyRegionAutoName($zeile(null), ['auto_name' => true], []);
assert($nurHaken !== [], 'ein Rumpf mit nur dem Haken liefert kein Feld zum Schreiben');

// ---- 7) DER ANLEGEWEG: leere Vorzeile, ausdrueckliches `false` -----------------------------------
// 💣 `avesmapsCreateEcosystemRegion` ruft denselben Anwender mit einem LEEREN `$before` -- es gibt
// ja noch keine Zeile. Der Zeichner schickt `auto_name: false`, weil sein provisorischer Griff
// „Flaeche-100" die Form `<Griff>-<Zahl>` hat und im Dialog sonst als Auto-Name abgeleitet wuerde:
// die frische Flaeche ginge mit gesetztem Haken auf und haette das Namensfeld GESPERRT, genau in
// dem Augenblick, in dem der Editor sie benennen soll.
// 🔴 Beide Erzeuger, oder es ist keine Regel -- der Anwender darf mit leerem `$before` nicht
// aussteigen, sonst faellt das mitgeschickte `false` lautlos auf den Boden.
$frisch = avesmapsEcosystemApplyRegionAutoName([], ['auto_name' => false], []);
assert($merker($frisch) === false, 'der Anlegeweg speichert das ausdrueckliche false nicht: '
    . var_export($frisch['properties_json'] ?? null, true));

// ---- 8) Die Wahrheitswerte kommen aus dem Hausleser ----------------------------------------------
// Der Client schickt einen echten Bool, aber ein Rumpf aus einem Skript schickt „1"/„0"/„true".
foreach ([true, 1, '1', 'true'] as $wahr) {
    assert($merker(avesmapsEcosystemApplyRegionAutoName($zeile(null), ['auto_name' => $wahr], [])) === true,
        'wahr in der Schreibweise ' . var_export($wahr, true) . ' kommt nicht als true an');
}
foreach ([false, 0, '0', 'false'] as $falsch) {
    assert($merker(avesmapsEcosystemApplyRegionAutoName($zeile(null), ['auto_name' => $falsch], [])) === false,
        'falsch in der Schreibweise ' . var_export($falsch, true) . ' kommt nicht als false an');
}

echo "ecosystem-auto-name-merker: alle Zusicherungen gruen\n";
