<?php

declare(strict_types=1);

/**
 * Aufgabe 1 des Tors „Bach und fünf neue Ortsarten" -- die Transport-Domäne von `Bach` in
 * api/_internal/map/features.php.
 *
 * Auftrag: docs/superpowers/plans/2026-08-29-tor-bach-und-fuenf-ortsarten.md, Aufgabe 1
 * Brief:   .superpowers/sdd/2026-08-29-tor-bach-und-fuenf-ortsarten/task-1-brief.md
 *
 * 🔴 EIN BACH IST KEIN REISEWEG (Owner 27.08.2026: „wie flusswege, die aber nicht befahren werden
 * können"). Die Frage aus der Spec (§1.4: eigene Domäne oder gar keine Kante?) ist schon gebaut:
 * die Domäne `'none'` existiert, ist gültig und ergibt eine LEERE Verkehrsmittelliste -- und eine
 * leere Liste ist maßgeblich (avesmapsAllowedTransportOptionsForDomain, default => []). KEINE neue
 * Domäne, KEIN Eingriff in die Sperrregel der Querfeldein-Wand (offroad-grid.php) -- die greift
 * über avesmapsGetRouteTransportType() === 'river' von selbst nicht, weil ein Bach dort 'unknown'
 * liefert (network-data.php).
 *
 * 💣 ZUSÄTZLICH ZUM BRIEF: avesmapsReadPathSubtype() führt eine EIGENE, zweite Kopie der
 * Wegarten-Liste (nicht PATH_SUBTYPE_KEYS aus js/config.js -- eine rein serverseitige
 * Schreib-Validierung). Ohne 'Bach' dort wirft jeder Versuch, einen Bach anzulegen oder zu
 * speichern -- insbesondere avesmapsCreatePathFeature, der Schreibweg des Garetien-Importers
 * (api/_internal/import/garetien-uebernahme.php:508) -- 'Der Wegtyp ist ungueltig.', BEVOR die
 * Domäne je berechnet wird. Dieser Fund stand in keinem der 6 Aufgaben-Briefs des Plans; er ist
 * hier mitgeprüft, weil er in genau der Datei liegt, die diese Aufgabe ohnehin ändert, und ohne ihn
 * wäre "der Schlüssel" nur ein Wort in einer JS-Konstante, das die eigene Schreib-API ablehnt.
 *
 * Run (Windows), from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/bach-domaene-test.php
 * Exit 0 = all asserts passed.
 */

// assert() ist ohne zend.assertions=1 ein No-Op -- ohne diese Wache waere jeder Fehlschlag ein
// stilles Gruen.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded -- features.php needs it.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

// bootstrap.php zuerst: features.php ruft avesmapsNormalizeSingleLine auf, die dort lebt. Beide
// sind beim Einbinden nebenwirkungsfrei -- bootstrap.php definiert nur AVESMAPS_API_ROOT und
// Funktionen, es verbindet sich zu nichts.
require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';

// =================================================================================================
// A. Die Domäne -- gemessen am ERGEBNIS der Hausfunktionen, nicht an einer eigenen Liste
// =================================================================================================

assert(avesmapsDefaultTransportDomainForPathSubtype('Bach') === 'none',
    'Bach muss die Domäne "none" bekommen -- keine eigene vierte Domäne, siehe features.php');
assert(avesmapsAllowedTransportOptionsForPathSubtype('Bach') === [],
    'die Domäne "none" muss eine LEERE Verkehrsmittelliste ergeben');

// 🔴 DIE GEGENPROBE, ohne die die beiden Zeilen darüber nichts belegen: der Flussweg behält seine
// zwei Boote. Ohne diese Zeile könnte avesmapsAllowedTransportOptionsForDomain() für JEDE Domäne
// [] liefern und die Prüfung darüber wäre trotzdem grün.
assert(avesmapsAllowedTransportOptionsForPathSubtype('Flussweg') === ['riverSailer', 'riverBarge'],
    'Gegenprobe: der Flussweg behält seine zwei Boote -- sonst belegt die Bach-Prüfung nur eine leere Fixture');
echo "Bach bekommt die Domaene 'none' und eine leere Verkehrsmittelliste, Flussweg bleibt unberuehrt ok\n";

// ⚠️ Und 'none' muss durch die Normalisierung kommen, sonst fällt sie auf 'land' zurück
// (avesmapsReadTransportDomain fällt bei einem UNGÜLTIGEN Wert auf den Subtyp-Default zurück --
// 'none' ist aber selbst gültig und darf diesen Rückfall NICHT auslösen).
assert(avesmapsReadTransportDomain('none', 'Bach') === 'none',
    "'none' ist eine gueltige Domaene und muss die Normalisierung unveraendert durchlaufen");
// Gegenprobe: ein wirklich ungültiger Wert fällt weiterhin auf den Subtyp-Default zurück -- ohne
// diese Zeile könnte avesmapsReadTransportDomain() jeden String klaglos durchreichen und die
// Zeile darüber bewiese nichts über eine echte Normalisierung.
assert(avesmapsReadTransportDomain('voegel-zwitschern', 'Bach') === 'none',
    'ein wirklich ungueltiger Wert faellt auf den Subtyp-Default zurueck -- fuer Bach ist das ebenfalls none');
echo "'none' kommt unveraendert durch die Normalisierung, ein ungueltiger Wert faellt auf den Subtyp-Default zurueck ok\n";

// =================================================================================================
// B. Der Schreib-Riegel avesmapsReadPathSubtype -- NICHT im Brief, aber in derselben Datei
// =================================================================================================
//
// 💣 Ohne diesen Abschnitt bliebe unentdeckt, dass avesmapsCreatePathFeature() (und damit der
// Garetien-Importer) 'Der Wegtyp ist ungueltig.' wirft, sobald jemand einen Bach anlegen will --
// obwohl die Domänen-Funktionen oben längst 'Bach' kennen. Die beiden Prüfungen sind UNABHÄNGIG:
// avesmapsReadPathSubtype() hat ihre eigene, zweite hartkodierte Liste (Zeile ~193).

assert(avesmapsReadPathSubtype('Bach') === 'Bach',
    'Bach muss den Schreib-Riegel passieren -- sonst wirft avesmapsCreatePathFeature() '
    . 'fuer jeden importierten oder gezeichneten Bach eine InvalidArgumentException');

// Gegenprobe 1: die sieben vorhandenen Wegarten passieren weiterhin unveraendert.
foreach (['Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad', 'Flussweg', 'Seeweg'] as $vorhandenerSubtyp) {
    assert(avesmapsReadPathSubtype($vorhandenerSubtyp) === $vorhandenerSubtyp,
        "die vorhandene Wegart '$vorhandenerSubtyp' darf durch die Erweiterung nicht verloren gehen");
}

// Gegenprobe 2: der Riegel ist immer noch ein RIEGEL -- ein erfundener Subtyp fliegt weiterhin raus.
// Ohne diese Zeile könnte 'Bach' hinzugefügt worden sein, indem die ganze Prüfung entschärft wurde
// (z.B. die if-Bedingung invertiert oder entfernt), und die Zeile oben wäre trotzdem grün.
$wurfAusgeloest = false;
try {
    avesmapsReadPathSubtype('Voegelchen');
} catch (InvalidArgumentException $erwarteterFehler) {
    $wurfAusgeloest = true;
}
assert($wurfAusgeloest,
    'ein erfundener Wegtyp muss weiterhin eine InvalidArgumentException werfen -- sonst ist der '
    . 'Riegel keiner mehr');
echo "avesmapsReadPathSubtype() kennt Bach, behaelt die acht Bestandsarten und lehnt Erfundenes weiter ab ok\n";

echo "ALL OK\n";
