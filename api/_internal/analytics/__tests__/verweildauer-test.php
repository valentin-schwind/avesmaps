<?php

declare(strict_types=1);

/**
 * Die Verweildauer: wie lange ein Besuch dauerte, gemessen als Zeit mit der Karte im Vordergrund.
 * Entwurf: docs/superpowers/specs/2026-08-25-verweildauer-design.md
 *
 * Geprueft werden die reinen Rechnungen (Korb, Dauer, "Lauf ist aus") und die BAUFORM der drei
 * Ausgaenge am Quelltext.
 *
 * ⚠️ Bewusst KEINE SQLite-Fixture. Die Buchung haengt an `ON DUPLICATE KEY UPDATE`,
 * `TIMESTAMPADD`/`TIMESTAMPDIFF` und `UTC_TIMESTAMP()` -- SQLite kennt davon nichts, und die
 * Anweisungen fuer einen Test umzuschreiben hiesse, den Test gegen die Produktion zu drehen
 * (AGENTS.md §9, Fehler 1093). Dieselbe Entscheidung wie in visitor-stunde-platzhalter-test.php.
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/verweildauer-test.php
 * Exit 0 = alle Zusicherungen halten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../visitor-analytics.php';

$quelle = (string) file_get_contents(__DIR__ . '/../visitor-analytics.php');
$heartbeat = (string) file_get_contents(__DIR__ . '/../../../app/heartbeat.php');

// --- Die Koerbe: fein am kurzen Ende, grob am langen ------------------------------------------
assert(avesmapsVisitorDwellBucket(0) === '00000', 'null Sekunden fallen in den ersten Korb');
assert(avesmapsVisitorDwellBucket(9) === '00000', 'bis 5 min sind es 10-Sekunden-Schritte');
assert(avesmapsVisitorDwellBucket(10) === '00010', 'und die Grenze gehoert schon zum naechsten');
assert(avesmapsVisitorDwellBucket(145) === '00140', '2:25 min -- der Median aus dem Mockup');
assert(avesmapsVisitorDwellBucket(299) === '00290', 'die letzte Zehnersprosse vor dem Wechsel');
assert(avesmapsVisitorDwellBucket(300) === '00300', 'ab 5 min zaehlen ganze Minuten');
assert(avesmapsVisitorDwellBucket(359) === '00300', 'und zwar abgerundet');
assert(avesmapsVisitorDwellBucket(3599) === '03540', 'die letzte Minutensprosse');
assert(avesmapsVisitorDwellBucket(3600) === '03600', 'ab einer Stunde sind es 5-Minuten-Schritte');
assert(avesmapsVisitorDwellBucket(3899) === '03600', 'auch hier abgerundet');

// 💣 Die fuehrenden Nullen sind tragend: `dimension` ist VARCHAR, der Leser sortiert als
// ZEICHENKETTE. Ohne Auffuellung stuende "1200" vor "300" und das Histogramm waere verwuerfelt.
assert(strlen(avesmapsVisitorDwellBucket(10)) === 5, 'jeder Korb ist fuenfstellig');
$sortiert = [avesmapsVisitorDwellBucket(3600), avesmapsVisitorDwellBucket(300), avesmapsVisitorDwellBucket(20)];
sort($sortiert, SORT_STRING);
assert(
    $sortiert === ['00020', '00300', '03600'],
    '💣 als Zeichenkette sortiert stehen die Koerbe trotzdem der Groesse nach'
);

// --- Der Deckel bei 12 Stunden -----------------------------------------------------------------
assert(AVESMAPS_VISITOR_DWELL_MAX_SECONDS === 43200, '12 h ist die Obergrenze aus dem Owner-Wunsch');
assert(avesmapsVisitorDwellBucket(43199) === '42900', 'knapp darunter noch ein regulaerer Korb');
assert(avesmapsVisitorDwellBucket(43200) === '43200', 'genau 12 h faellt schon in den Ueberlauf');
assert(avesmapsVisitorDwellBucket(999999) === '43200', 'und alles darueber in denselben');
assert(avesmapsVisitorDwellBucket(-5) === '00000', 'eine negative Dauer gibt es nicht, sie wird 0');

// --- Die Dauer zwischen zwei Zeitstempeln ------------------------------------------------------
assert(avesmapsVisitorDauerSekunden('2026-08-26 10:00:00', '2026-08-26 10:02:25') === 145, '2:25 min');
assert(avesmapsVisitorDauerSekunden('2026-08-26 10:00:00', '2026-08-26 10:00:00') === 0, 'gleich lang ist null');
// ⚠️ Nie negativ: eine Zeile aus dem Bestand kann einen spaeteren Anfang als Ende tragen.
assert(avesmapsVisitorDauerSekunden('2026-08-26 10:05:00', '2026-08-26 10:00:00') === 0, 'rueckwaerts ist 0, nicht negativ');
assert(avesmapsVisitorDauerSekunden('', '2026-08-26 10:00:00') === 0, 'unlesbar ist 0, kein Wurf');
// Ueber Mitternacht laeuft es durch.
assert(avesmapsVisitorDauerSekunden('2026-08-25 23:58:00', '2026-08-26 00:03:00') === 300, 'ueber Mitternacht');

// --- "Der Lauf ist aus" ------------------------------------------------------------------------
// ⚠️ Gemessen am ANWESENHEITSFENSTER (150 s), nicht an der Aufraeumfrist (15 min).
$lauf = static fn (string $letzte, string $jetzt): array => ['last_seen' => $letzte, 'jetzt' => $jetzt];
assert(
    avesmapsVisitorLiveLaufIstAus($lauf('2026-08-26 10:00:00', '2026-08-26 10:01:00')) === false,
    'eine Minute Pause ist ein normaler Takt'
);
assert(
    avesmapsVisitorLiveLaufIstAus($lauf('2026-08-26 10:00:00', '2026-08-26 10:02:30')) === false,
    'genau 150 s sind noch derselbe Besuch -- das Fenster ist inklusiv'
);
assert(
    avesmapsVisitorLiveLaufIstAus($lauf('2026-08-26 10:00:00', '2026-08-26 10:02:31')) === true,
    '💣 danach ist es ein NEUER Besuch -- sonst verschmelzen Morgen- und Abendbesuch desselben '
    . 'Anschlusses zu einem von zwoelf Stunden, der Tages-Hash ist derselbe'
);
assert(
    avesmapsVisitorLiveLaufIstAus($lauf('2026-08-26 08:00:00', '2026-08-26 20:00:00')) === true,
    'zwoelf Stunden Pause erst recht'
);
assert(avesmapsVisitorLiveLaufIstAus(['jetzt' => '2026-08-26 10:00:00']) === false, 'ohne Daten kein Urteil');

// --- 💣 DIE TRAGENDE ZUSICHERUNG: EIN Buchhalter fuer ALLE DREI Ausgaenge -----------------------
// Eine Regel, die nur einen von mehreren Erzeugern bindet, ist keine Regel -- das hat das Projekt
// am 14.08. und am 15.08.2026 je einen Tag gekostet. Hier waere der Preis ein Histogramm, das je
// nach Ausgang zaehlt oder nicht, und das sieht aus wie ein Datenmangel, nicht wie ein Fehler.
$rumpfVon = static function (string $name) use ($quelle): string {
    $auf = strpos($quelle, 'function ' . $name . '(');
    assert($auf !== false, $name . ' muss es geben');
    $naechste = strpos($quelle, "\nfunction ", $auf + 1);

    return substr($quelle, $auf, $naechste === false ? null : $naechste - $auf);
};

foreach (['avesmapsVisitorRecordLive', 'avesmapsVisitorForgetLive', 'avesmapsVisitorPurgeLive'] as $ausgang) {
    assert(
        str_contains($rumpfVon($ausgang), 'avesmapsVisitorFinishLiveRun'),
        '💣 ' . $ausgang . ' bucht ueber den gemeinsamen Buchhalter'
    );
}
// Und niemand sonst bucht an ihm vorbei: die drei Ausgaenge plus die Funktion selbst.
assert(
    substr_count($quelle, 'avesmapsVisitorFinishLiveRun') === 4,
    '💣 genau drei Aufrufer plus die Erklaerung -- ein vierter Ausgang waere ein neuer Erzeuger'
);

// 💣 Erst buchen, dann loeschen. Andersherum ist die Zeile weg, bevor jemand sie gezaehlt hat --
// und der Purge ist der Ausgang, den die MEISTEN Besuche nehmen (ein pagehide-Beacon geht vor
// allem auf Mobilgeraeten oft nicht mehr ab).
foreach (['avesmapsVisitorForgetLive', 'avesmapsVisitorPurgeLive'] as $loescher) {
    $rumpf = $rumpfVon($loescher);
    assert(
        strpos($rumpf, 'avesmapsVisitorFinishLiveRun') < strpos($rumpf, 'DELETE'),
        '💣 ' . $loescher . ' bucht VOR dem Loeschen'
    );
}

// --- 💣 first_seen darf der Upsert nicht mitnehmen ---------------------------------------------
// Naehme er es blind mit, waere jeder Besuch genau einen Ping lang: das Histogramm haette genau
// einen Balken, gefuellt, plausibel und vollstaendig falsch.
$record = $rumpfVon('avesmapsVisitorRecordLive');
assert(str_contains($record, 'ON DUPLICATE KEY UPDATE'), 'der Ping ist weiterhin ein Upsert');
assert(
    !preg_match('/ON DUPLICATE KEY UPDATE[\s\S]*first_seen\s*=\s*VALUES\(first_seen\)/', $record),
    '💣 first_seen wird im Upsert NICHT stumpf ueberschrieben'
);
assert(
    str_contains($record, 'first_seen = IF(:neu, NOW(), COALESCE(first_seen, NOW()))'),
    'neu gesetzt nur beim ausdruecklichen Neuanfang; COALESCE faengt die Zeilen von vor der Spalte'
);

// --- Der Tag der Buchung ist der Tag des ANFANGS -----------------------------------------------
// Ein Besuch, der um 23:58 endet und um 00:14 aufgeraeumt wird, gehoert in den Vortag.
$finish = $rumpfVon('avesmapsVisitorFinishLiveRun');
assert(str_contains($finish, "\$lauf['utc_tag']"), 'der Buchhalter nimmt den Tag aus der Zeile');
assert(substr_count($finish, '$tag') >= 4, 'und reicht ihn an jede der drei Zeilen weiter');
// ⚠️ Und der Tag ist UTC, weil visitor_metric.day UTC ist -- die Spalte first_seen steht dagegen
// in der Zonenzeit der DB-Sitzung.
assert(
    str_contains($quelle, 'TIMESTAMPDIFF(SECOND, NOW(), UTC_TIMESTAMP())'),
    '💣 der UTC-Tag wird aus dem Versatz gerechnet, den die DB selbst meldet -- keine Zonentabellen'
);

// --- Eine Zeile ohne bekannten Anfang wird uebersprungen, nicht geraten -------------------------
assert(
    str_contains($finish, "\$anfang === ''") && strpos($finish, 'return;') < strpos($finish, '$sekunden'),
    '🔴 ohne first_seen wird nichts gebucht -- eine erfundene Dauer ist schlechter als keine'
);

// --- Der gone-Pfad im Endpunkt kann die Spalte nachruesten -------------------------------------
assert(
    preg_match('/gone[\s\S]{0,600}avesmapsVisitorEnsureLiveTable/', $heartbeat) === 1,
    'auch der gone-Pfad ruestet die Spalte nach, sonst buchte der genaueste Ausgang nie'
);

echo "OK -- alle Zusicherungen halten\n";
