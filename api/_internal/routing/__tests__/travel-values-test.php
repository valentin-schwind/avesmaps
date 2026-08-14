<?php
// api/_internal/routing/__tests__/travel-values-test.php
declare(strict_types=1);

/**
 * Die Tempowerte als Speicher statt als drei Konstanten.
 * Entwurf: docs/superpowers/specs/2026-08-07-tempowerte-design.md
 *
 * 💣 DIE QUELLE NENNT NIE EINE GESCHWINDIGKEIT, IMMER NUR EINE TAGESLEISTUNG (GA S. 118/123/129/131).
 * Darum sind die Tabellenwerte krumm -- 3,07 statt 3,0, 9,92 statt 10. Wer eine Zahl „glattzieht",
 * bricht die Zuordnung zur Quelle. Der Bauplan ist:
 *
 *     Wert = Tagesleistung x mean_G x TIME_SCALE / Reisestunden
 *
 * mean_G (1,032) steht NUR bei Land und gleicht unsere eigene Steigungsebene aus; die Quelle kennt
 * auf der Straße keine Steigung. Wasser traegt kein Gelaende.
 *
 * ⭐ DER PRUEFSTEIN IST DIE GALEERE. Sie ist das einzige Reisemittel mit DREI Quellenzeilen (S. 131:
 * 70 bei 8 Ruderstunden, 100 bei 12, 200 bei 24) und sie liegen auf einer Geraden. Traegt unsere
 * Zelle wirklich eine Geschwindigkeit und keine verkleidete Tagesleistung, trifft sie alle drei --
 * die anderen zehn Mittel geben je nur einen Punkt her und koennen das nicht zeigen.
 *
 * Run from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/travel-values-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../client-graph.php';
// require_once, nicht require: client-graph.php zieht travel-values.php seit dem
// 14.08.2026 selbst -- ein zweites `require` waere eine Doppeldeklaration.
require_once __DIR__ . '/../travel-values.php';

$nah = static fn(float $a, float $b, float $eps = 0.005): bool => abs($a - $b) < $eps;

// ============================================================ A. Die GA-Tafel ist vollstaendig

$ga = avesmapsTravelValuesSourceTable();
assert(count($ga['day_miles']) === 11, 'elf Tagesleistungen: ' . count($ga['day_miles']));
assert($ga['day_miles']['groupFoot'] === 30.0, 'Fussgruppe 30 (S. 123)');
assert($ga['day_miles']['groupHorse'] === 35.0, 'berittene Gruppe 35 -- die TABELLE S. 123, nicht der Fliesstext S. 118 („kaum mehr als 40")');
assert($ga['day_miles']['galley'] === 100.0, 'Galeere 100 = die 12-Stunden-Zeile, unser Reisetag');
assert($ga['day_miles']['fastShip'] === 250.0, 'Schnellsegler 250');
assert(count($ga['path_factors']) === 7, 'sieben Wegtypen: ' . count($ga['path_factors']));
assert($ga['path_factors']['Strasse'] === 1.0, 'die Strasse ist der Bezug');
assert($ga['path_factors']['Querfeldein'] === 0.75, 'Querfeldein 0,75 („offenes Gelaende", S. 120-123)');

// ============================================================ B. Die Formel reproduziert die Tabelle

// 💣 DAS IST DIE EIGENTLICHE ZUSICHERUNG. Stimmt sie, sind unsere Zellen Geschwindigkeiten aus der
// Quelle; stimmt sie nicht, ist irgendwo eine Tagesleistung als Tempo eingezogen.
foreach (['groupFoot' => 3.07, 'lightWalker' => 4.09, 'groupHorse' => 3.58, 'lightRider' => 5.12,
          'caravan' => 3.07, 'horseCarriage' => 5.12] as $mittel => $strasse) {
    $gerechnet = avesmapsTravelValuesSpeedFromDayMiles($ga['day_miles'][$mittel], true, 12.0);
    assert($nah($gerechnet, $strasse, 0.02), "$mittel auf der Strasse: $gerechnet gegen $strasse");
}
// Wasser: ohne mean_G.
assert($nah(avesmapsTravelValuesSpeedFromDayMiles(60.0, false, 12.0), 6.0, 0.06), 'Flusssegler 60/Tag -> 6,0');
assert($nah(avesmapsTravelValuesSpeedFromDayMiles(120.0, false, 12.0), 11.9, 0.02), 'Lastensegler 120/Tag -> 11,9');
// 🔴 Der Schnellsegler ist das EINE Schiff mit Nachtfahrt (S. 131) -- 24 Stunden, nicht 12.
assert($nah(avesmapsTravelValuesSpeedFromDayMiles(250.0, false, 24.0), 12.4, 0.02), 'Schnellsegler 250/24h -> 12,4');

// ⭐ Der Galeeren-Prüfstein: eine Geschwindigkeit trifft ALLE DREI Quellenzeilen.
$galeere = avesmapsTravelValuesSpeedFromDayMiles(100.0, false, 12.0);
assert($nah($galeere * 8.0 / 1.19, 66.7, 0.5), '8 Ruderstunden -> ~67 (Quelle 70)');
assert($nah($galeere * 12.0 / 1.19, 100.0, 0.5), '12 Ruderstunden -> 100');
assert($nah($galeere * 24.0 / 1.19, 200.0, 1.0), '24 Ruderstunden -> 200 (die Kurier-Dromone)');

// ============================================================ C. Ohne Speicher gilt die Konstante

// 🔴 KEIN GERATENER WERT, WENN DIE DATENBANK SCHWEIGT. Eine frische Anlage und jede Diagnose ohne
// PDO muessen exakt das heutige Raster bekommen -- sonst verschiebt der Bau Reisezeiten, ohne dass
// jemand etwas eingestellt hat.
$werte = avesmapsTravelValuesRead(null);
assert($werte['grid']['groupFoot']['Strasse'] === AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'],
    'ohne PDO faellt das Raster auf die Konstante zurueck');
assert($werte['grid'] == AVESMAPS_ROUTE_CLIENT_SPEED_TABLE, 'und zwar auf das GANZE Raster, Zelle fuer Zelle');
assert($werte['source'] === 'constant', 'und die Antwort sagt, woher sie kommt: ' . $werte['source']);

// ============================================================ D. Der Befund zaehlt die Abweichungen

// Die Zahl, die als Unterzeile in der Kachel steht -- Status gehoert in den Knopf.
$befund = avesmapsTravelValuesDeviations($werte);
assert(isset($befund['path_factors']), 'der Befund nennt die Wegtypen');
// 4.2 des Entwurfs: sechs der sieben weichen ab, nur die Strasse ist der Bezug.
assert($befund['path_factors']['count'] === 6,
    'sechs Wegtypen weichen heute von der GA ab: ' . $befund['path_factors']['count']);
assert($nah($befund['path_factors']['values']['Querfeldein']['ours'], 0.313, 0.002),
    'Querfeldein steht bei 0,313: ' . $befund['path_factors']['values']['Querfeldein']['ours']);
assert($befund['path_factors']['values']['Querfeldein']['source'] === 0.75, 'die Quelle sagt 0,75');
assert(!isset($befund['path_factors']['values']['Strasse']), 'die Strasse weicht nicht ab, sie IST der Bezug');

// ============================================================ E. Der Ruecksetzer zieht auf das Produkt

// 💣 DAS RASTER IST DIE WAHRHEIT, NICHT DAS PRODUKT (Entwurf §5). Nur der Ruecksetzer zieht es auf
// Tagesleistung x GA-Faktor -- ein Fenster, das die 60 Zellen staendig aus 18 Zahlen ableitete,
// schriebe beim ersten Speichern rund 40 Werte still um.
$zurueck = avesmapsTravelValuesResetSection($werte, 'path_factors');
assert($nah($zurueck['grid']['groupFoot']['Querfeldein'], 2.30, 0.02),
    'Querfeldein der Fussgruppe: 3,07 x 0,75 = 2,30, nicht mehr 0,96 -- ' . $zurueck['grid']['groupFoot']['Querfeldein']);
assert($nah($zurueck['grid']['groupFoot']['Reichsstrasse'], 3.377, 0.02), 'Reichsstrasse 3,07 x 1,10');

// 💣 DIE KUTSCHENREGEL IST EINE REGEL, KEIN GELAENDE (S. 123: „auf Karrenwegen und Paessen nur halbe
// Geschwindigkeit"). Sie wird NACH dem Ruecksetzen wieder aufgesetzt, sonst faehrt die Kutsche auf
// dem Karrenweg ploetzlich wie ein Reiter.
$kutsche = $zurueck['grid']['horseCarriage'];
assert($nah($kutsche['Weg'], $kutsche['Strasse'] * 0.80 * 0.5, 0.02),
    'Kutsche auf Weg = halber GA-Wegfaktor: ' . $kutsche['Weg']);
assert($nah($kutsche['Gebirgspass'], $kutsche['Strasse'] * 0.40 * 0.5, 0.02),
    'Kutsche auf dem Pass ebenso: ' . $kutsche['Gebirgspass']);
// ⚠️ Und NUR dort. Auf Pfad und Wuestenpfad gilt die Regel nicht.
assert($nah($kutsche['Pfad'], $kutsche['Strasse'] * 0.80, 0.02), 'auf dem Pfad aber nicht halbiert');

// ⚠️ Wasser bleibt vom Wegtyp-Ruecksetzer unberuehrt -- es hat keine Gelaendespalte.
assert($zurueck['grid']['riverSailer'] === $werte['grid']['riverSailer'], 'der Flusssegler bleibt, wie er war');

echo "travel-values-test: alle Zusicherungen erfüllt\n";

// ============================================================ F. Der aktive Speicher der Anfrage

// 💣 SIEBEN LESESTELLEN IN FÜNF DATEIEN, UND KEINE HAT EINEN PDO. Die Tempotabelle wird tief im
// Graphbau gelesen (`avesmapsAddClientCompatiblePathToGraph` und sechs weitere), und keiner dieser
// Aufrufe bekommt eine Datenbankverbindung durchgereicht. Sie alle umzubauen hiesse, sieben
// Signaturen und ihre Aufrufer zu aendern -- fuer einen Wert, der sich waehrend einer Anfrage nie
// aendert. Stattdessen: EINMAL fuellen, danach lesen.
avesmapsTravelValuesResetActive();
assert(avesmapsTravelValuesSpeed('groupFoot', 'Strasse') === AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Strasse'],
    'ungefuellt gilt die Konstante -- eine frische Anlage darf keine andere Zahl bekommen');

// Gefuellt gilt der Speicher.
$eigen = AVESMAPS_ROUTE_CLIENT_SPEED_TABLE;
$eigen['groupFoot']['Querfeldein'] = 2.30;
avesmapsTravelValuesPrimeGrid($eigen);
assert(avesmapsTravelValuesSpeed('groupFoot', 'Querfeldein') === 2.30,
    'nach dem Fuellen gilt der eingestellte Wert: ' . avesmapsTravelValuesSpeed('groupFoot', 'Querfeldein'));
assert(avesmapsTravelValuesSpeed('groupFoot', 'Strasse') === $eigen['groupFoot']['Strasse'],
    'und die uebrigen Zellen bleiben, wie sie waren');

// ⚠️ Eine unbekannte Zelle ist null, NIE 0. Eine 0 waere im Graphbau keine Ausnahme, sondern eine
// Division durch null -- die Aufrufer pruefen alle auf null und ueberspringen den Weg.
assert(avesmapsTravelValuesSpeed('groupFoot', 'Seeweg') === null, 'die Fussgruppe hat keinen Seeweg');
assert(avesmapsTravelValuesSpeed('gibtsNicht', 'Strasse') === null, 'ein unbekanntes Reisemittel ebenso');

avesmapsTravelValuesResetActive();
assert(avesmapsTravelValuesSpeed('groupFoot', 'Querfeldein') === AVESMAPS_ROUTE_CLIENT_SPEED_TABLE['groupFoot']['Querfeldein'],
    'zuruecknehmen faellt auf die Konstante zurueck');

echo "travel-values-test: aktiver Speicher geprüft\n";
