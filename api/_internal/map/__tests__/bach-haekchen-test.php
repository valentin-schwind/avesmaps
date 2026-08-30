<?php

declare(strict_types=1);

/**
 * Das Häkchen „Bach" an einem Flussweg -- Owner 30.08.2026, an einem Bildschirmfoto des Dialogs
 * „Weg bearbeiten": ein Häkchen NEBEN dem Wegtyp, kein eigener Wegtyp.
 *
 * Wörtlich: „Flusswege bekommen die zusätzlich Option 'Bach'. Bach deaktiviert automatisch
 * Flusssegler und Flusskahn (oder jeder art von Befahrbarkeit), bleibt aber Flussweg (z.b. als
 * Hindernis)."
 *
 * 🔴 DIESE DATEI LÖST bach-domaene-test.php AB. Vom 29. bis zum 30.08.2026 war `Bach` eine eigene
 * WEGART (`PATH_SUBTYPE_KEYS`, Domäne 'none'). Sie war nie in der Auswahlliste des Dialogs und lag
 * auf keinem einzigen Objekt -- live gemessen 0 von 6038 Wegen --, und der Owner hat sich am
 * 30.08. für das Häkchen entschieden. Beides nebeneinander wären zwei Wege, dasselbe zu sagen.
 *
 * 💣 DIE ZUSICHERUNG, DIE DIESE DATEI TRÄGT, IST DIE ÜBER DIE SCHREIBWEGE. Es gibt DREI, die die
 * Verkehrsmittelliste eines Weges rechnen, und sie lösten die Domäne bisher jeder für sich auf.
 * Hätte jeder das Häkchen einzeln beachten müssen, wäre das die Fehlerklasse, die dieses Projekt
 * schon zweimal bezahlt hat („eine Regel, die einen von mehreren Erzeugern bindet, ist keine
 * Regel"). Deshalb wird hier zur LAUFZEIT gezählt, wie viele Schreibwege die gemeinsame Regel
 * wirklich rufen -- und deshalb steht in diesem Kommentar KEINE Zahl.
 *
 * Ausführen (Windows), vom Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/bach-haekchen-test.php
 */

// ⚠️ bootstrap.php ZUERST -- features.php setzt seine Abhaengigkeiten (avesmapsNormalizeSingleLine
// & Co.) voraus und laedt sie nicht selbst. Dieselbe Reihenfolge wie im abgeloesten
// bach-domaene-test.php.
require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';

$pruefungen = 0;

// =================================================================================================
// 1. „Bach" ist KEIN Wegtyp mehr -- der Schreib-Riegel lehnt ihn ab
// =================================================================================================
$abgelehnt = false;
try {
    avesmapsReadPathSubtype('Bach');
} catch (InvalidArgumentException $e) {
    $abgelehnt = true;
}
assert($abgelehnt, 'avesmapsReadPathSubtype darf "Bach" nicht mehr als Wegtyp annehmen');
assert(avesmapsReadPathSubtype('Flussweg') === 'Flussweg', 'Flussweg bleibt selbstverstaendlich gueltig');
$pruefungen += 2;

// ⚠️ Und die Domaenentafel kennt ihn ebenso wenig -- sonst faende ein spaeterer Leser zwei
// Wahrheiten darueber, was ein Bach ist.
assert(avesmapsDefaultTransportDomainForPathSubtype('Bach') === 'land',
    'ein unbekannter Wegtyp faellt auf "land" -- es gibt keinen Sonderzweig "Bach" mehr');
assert(avesmapsDefaultTransportDomainForPathSubtype('Flussweg') === 'river', 'Flussweg bleibt river');
$pruefungen += 2;

// =================================================================================================
// 2. avesmapsPathIstBach -- NUR an einem Flussweg
// =================================================================================================
assert(avesmapsPathIstBach('Flussweg', true) === true, 'ein angehaktes Flussweg-Haekchen zaehlt');
assert(avesmapsPathIstBach('Flussweg', false) === false, 'ein abgehaktes nicht');
assert(avesmapsPathIstBach('Flussweg', null) === false, 'und ein fehlendes ebenso wenig');
$pruefungen += 3;

// 🔴 An jedem anderen Wegtyp ist das Haekchen bedeutungslos und wird VERWORFEN. Damit loescht ein
// Wegtypwechsel weg vom Flussweg das Haekchen von selbst -- ohne eigene Aufraeumregel, die jemand
// beim naechsten Schreibweg vergessen koennte.
foreach (['Strasse', 'Weg', 'Pfad', 'Seeweg', 'Reichsstrasse'] as $andere) {
    assert(avesmapsPathIstBach($andere, true) === false,
        "an einem $andere hat das Bach-Haekchen keine Bedeutung und wird verworfen");
    $pruefungen++;
}

// =================================================================================================
// 3. Die Regel: ein Bach ist BAULICH nicht befahrbar
// =================================================================================================
$fluss = avesmapsPathTransportRegel('Flussweg', false, null);
assert($fluss['domain'] === 'river', 'ein gewoehnlicher Flussweg bleibt in der Fluss-Domaene');
assert($fluss['allowed'] === ['riverSailer', 'riverBarge'],
    'und traegt beide Fluss-Verkehrsmittel: ' . json_encode($fluss['allowed']));
$pruefungen += 2;

$bach = avesmapsPathTransportRegel('Flussweg', true, null);
assert($bach['domain'] === 'none', 'ein Bach faellt in die leere Domaene');
assert($bach['allowed'] === [], 'und traegt KEIN Verkehrsmittel: ' . json_encode($bach['allowed']));
$pruefungen += 2;

// 💣 DIE TRAGENDE ZUSICHERUNG: ein alter oder zwischengespeicherter Client, der Fluss-Verkehrsmittel
// MITSCHICKT, bekommt trotzdem eine leere Liste. Die Sperre ist die leere Vertraeglichkeitsliste der
// Domaene 'none', gegen die avesmapsReadAllowedTransports jeden eingereichten Wert filtert -- nicht
// eine Bedingung, die jemand vergessen kann.
$eingereicht = avesmapsPathTransportRegel('Flussweg', true, ['riverSailer', 'riverBarge', 'groupFoot']);
assert($eingereicht['allowed'] === [],
    'eingereichte Verkehrsmittel werden gegen die leere Liste gefiltert: ' . json_encode($eingereicht['allowed']));
$pruefungen++;

// ⚠️ Gegenprobe: DERSELBE Rumpf ohne Haekchen kommt durch -- sonst belegte die Zeile darueber nur,
// dass avesmapsReadAllowedTransports ueberhaupt filtert.
$ohne = avesmapsPathTransportRegel('Flussweg', false, ['riverSailer', 'groupFoot']);
assert($ohne['allowed'] === ['riverSailer'],
    'ohne Haekchen kommt das passende Verkehrsmittel durch, nur das fremde faellt weg: '
    . json_encode($ohne['allowed']));
$pruefungen++;

// =================================================================================================
// 4. 🔴 ALLE Schreibwege gehen durch die EINE Regel -- zur LAUFZEIT gezaehlt, nicht aufgezaehlt
// =================================================================================================
// Gezaehlt wird im Quelltext, weil die drei Schreibwege eine Datenbank brauchen: jede Funktion, die
// `allowed_transports` in `$properties` schreibt, MUSS avesmapsPathTransportRegel rufen. Ein neuer
// vierter Schreibweg faellt hier auf, statt lautlos einem Bach seine Flusssegler zurueckzugeben.
//
// 🪤 Kommentare werden VORHER entfernt: dieser Test wuerde sonst an der Warnung anschlagen, die vor
// dem Muster warnt -- und der naechste Leser loescht dann den Kommentar (AGENTS.md-Falle
// „Quelltexttest darf Kommentare nicht mitlesen").
$quelle = (string) file_get_contents(__DIR__ . '/../features.php');
$quelle = str_replace("\r\n", "\n", $quelle);
$ohneKommentare = preg_replace('~/\*.*?\*/~s', '', $quelle);
$ohneKommentare = preg_replace('~^\s*//.*$~m', '', (string) $ohneKommentare);
$ohneKommentare = (string) $ohneKommentare;

// 🔴 DIE INVARIANTE: NUR avesmapsPathTransportRegel RUFT avesmapsReadAllowedTransports.
// Das ist die schaerfste Form dieser Zusicherung, die es hier gibt -- schaerfer als "zaehle die
// Schreibwege", denn sie faengt AUCH einen Leser, der nur anzeigt. Wer den Verkehrsmittel-Leser
// direkt ruft, umgeht das Bach-Haekchen; und weil ein Bach dann Flusssegler zeigte oder speicherte,
// ohne dass irgendwo ein Fehler entstuende, faellt es sonst niemandem auf.
// ⚠️ Erlaubt sind genau zwei Vorkommen: die Definition der Funktion selbst und der EINE Ruf aus der
// Regel. Jedes weitere ist ein Umweg an der Regel vorbei.
$leserRufe = preg_match_all('~avesmapsReadAllowedTransports\s*\(~', $ohneKommentare);
assert($leserRufe === 2,
    "avesmapsReadAllowedTransports darf NUR aus avesmapsPathTransportRegel gerufen werden "
    . "(gefunden: $leserRufe Vorkommen; erlaubt sind 2 -- die Definition und der Ruf aus der Regel). "
    . "Ein direkter Ruf umgeht das Bach-Haekchen.");
$pruefungen++;

// Zeuge: die Regel ruft ihn wirklich -- sonst waere die Zahl 2 auch dann erfuellt, wenn irgendwo
// zwei tote Erwaehnungen stuenden.
$regelrumpf = (string) (preg_split('~\nfunction ~', $ohneKommentare)[0] ?? '');
$regelStelle = strpos($ohneKommentare, 'function avesmapsPathTransportRegel');
assert($regelStelle !== false, 'avesmapsPathTransportRegel muss es geben');
$regelrumpf = substr($ohneKommentare, $regelStelle, 600);
assert(str_contains($regelrumpf, 'avesmapsReadAllowedTransports('),
    'und sie muss den Leser selbst rufen -- sonst rechnet sie die Liste woanders');
$pruefungen += 2;

// 🪤 HIER STAND EINE ZWEITE, SCHWAECHERE ZUSICHERUNG ("hoechstens N Aufrufe von
// avesmapsDefaultTransportDomainForPathSubtype"). Sie ist ersatzlos entfallen: sie braeuchte eine
// gepflegte ZAHL -- und eine Zahl in einem Test liest sich wie eine vollstaendige Liste, obwohl
// drei der fuenf Vorkommen harmlose Lesehelfer sind. Die Zeile darueber sagt dasselbe schaerfer und
// ohne Zahl, die veralten kann.

echo "OK: {$pruefungen} Pruefungen\n";
