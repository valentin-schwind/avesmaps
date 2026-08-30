<?php

declare(strict_types=1);

/**
 * Die Ausgangs-Sonde (Vorfall 30.08.2026).
 *
 * 🔴 DREI EIGENSCHAFTEN, UND DIE ERSTE IST DIE WICHTIGERE:
 *   1. Sie ruft NIE eine Adresse ab, die in der Anfrage steht -- die Ziele sind eine feste Liste.
 *      Ein Diagnose-Endpunkt mit freier Adresse ist ein offener Weiterleiter.
 *   2. Sie liest die Phase aus der ERSTEN Null der cURL-Zeitmarken, nicht aus der letzten Zahl.
 *   3. Sie reicht den Rumpf eines fremden Dienstes nie ungeprueft in die eigene Antwort.
 *
 * Ausfuehren:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/diagnostics/__tests__/ausgang-sonde-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../ausgang-sonde.php';

// --------------------------------------------------------------------------------------------
// 1. Die Phase. Der Fall, um den es geht, steht zuerst: der echte Messwert vom 30.08.2026 --
//    Namensaufloesung gelungen, Verbindung nie zustande gekommen.
// --------------------------------------------------------------------------------------------
$verbindungTot = ['namelookup_time' => 0.021, 'connect_time' => 0.0, 'appconnect_time' => 0.0,
    'starttransfer_time' => 0.0, 'total_time' => 8.006];
assert(
    avesmapsAusgangPhase($verbindungTot, 28, true) === 'tcp',
    'DNS ging, die Verbindung nicht -- das ist die Phase tcp'
);

// 💣 Die Zusicherung, die die Verwechslung fangen soll: WER DIE GROESSTE ZAHL LIEST, sieht hier
// total_time = 8.006 und meldet „uebertragung" -- also einen Fehler ganz am Ende statt ganz am
// Anfang. Genau darum wird die erste Null gelesen.
assert(
    avesmapsAusgangPhase($verbindungTot, 28, true) !== 'uebertragung',
    'total_time ist die Dauer bis zum Abbruch, nicht die Phase'
);

// Der Name loest gar nicht auf: alles bleibt auf 0.
assert(
    avesmapsAusgangPhase(['namelookup_time' => 0.0, 'connect_time' => 0.0], 6, true) === 'dns',
    'ohne Namensaufloesung ist die Phase dns'
);

// TCP stand, TLS nicht -- die Gegenseite nimmt uns an und weist uns erst danach ab.
assert(
    avesmapsAusgangPhase(
        ['namelookup_time' => 0.02, 'connect_time' => 0.04, 'appconnect_time' => 0.0],
        35,
        true
    ) === 'tls',
    'ohne TLS-Handschlag ist die Phase tls'
);

// ⚠️ Bei http gibt es keinen TLS-Handschlag -- appconnect_time bleibt dort IMMER 0. Ohne die
// Unterscheidung meldete jede einfache http-Verbindung einen TLS-Fehler, den es nicht gibt.
assert(
    avesmapsAusgangPhase(
        ['namelookup_time' => 0.02, 'connect_time' => 0.04, 'appconnect_time' => 0.0,
            'starttransfer_time' => 0.0],
        28,
        false
    ) === 'warten_auf_antwort',
    'ohne https darf niemals die Phase tls herauskommen'
);

// Verbindung und TLS standen, die Antwort blieb aus.
assert(
    avesmapsAusgangPhase(
        ['namelookup_time' => 0.02, 'connect_time' => 0.04, 'appconnect_time' => 0.09,
            'starttransfer_time' => 0.0],
        28,
        true
    ) === 'warten_auf_antwort',
    'nach dem Handschlag ohne Antwort: warten_auf_antwort'
);

// Ohne Fehler ist die Phase immer „antwort" -- egal, was in den Zeitmarken steht.
assert(
    avesmapsAusgangPhase([], 0, true) === 'antwort',
    'errno 0 heisst: es kam eine Antwort'
);

// Jede Phase hat einen Klartext, und keiner ist leer.
foreach (['antwort', 'dns', 'tcp', 'tls', 'warten_auf_antwort', 'uebertragung'] as $phase) {
    assert(trim(avesmapsAusgangPhaseText($phase)) !== '', "die Phase {$phase} hat einen Klartext");
}

// --------------------------------------------------------------------------------------------
// 2. Der fremde Rumpf. Was keine Adresse ist, ist keine Auskunft.
// --------------------------------------------------------------------------------------------
assert(avesmapsAusgangIpAusText("81.169.144.135\n") === '81.169.144.135', 'eine IPv4 wird uebernommen');
assert(avesmapsAusgangIpAusText('2a01:238::1') === '2a01:238::1', 'eine IPv6 wird uebernommen');
assert(avesmapsAusgangIpAusText('<html>Fehler 502</html>') === '', 'eine Fehlerseite ist keine Adresse');
assert(avesmapsAusgangIpAusText('') === '', 'leer bleibt leer');
assert(avesmapsAusgangIpAusText(str_repeat('1', 200)) === '', 'ein langer Rumpf wird nicht geprueft, sondern verworfen');

// --------------------------------------------------------------------------------------------
// 3. Die Ziele. 🔴 Fest, vollstaendig, und keines davon kommt aus einer Anfrage.
// --------------------------------------------------------------------------------------------
$ziele = avesmapsAusgangZiele();
assert(array_keys($ziele) === ['ausgangs_ip', 'mastodon', 'kontrolle'], 'die drei Ziele stehen fest');
foreach ($ziele as $name => $ziel) {
    assert(str_starts_with($ziel['url'], 'https://'), "{$name} wird ueber https abgefragt");
    assert(trim($ziel['zweck']) !== '', "{$name} sagt, wozu es da ist");
}
assert(
    str_contains($ziele['mastodon']['url'], 'rollenspiel.social'),
    'das kranke Ziel ist die Mastodon-Instanz selbst'
);

// 💣 Die tragende Zusicherung: der Quelltext nimmt KEINE Adresse aus der Anfrage entgegen.
// ⚠️ Kommentare werden vorher entfernt -- sonst schlaegt der Test an der Warnung an, die vor
// genau diesem Muster warnt, und der naechste Leser loescht den Kommentar statt des Fehlers.
$sondeQuelle = (string) file_get_contents(__DIR__ . '/../ausgang-sonde.php');
$sondeOhneKommentare = preg_replace('~/\*.*?\*/|//[^\n]*~s', '', $sondeQuelle) ?? '';
foreach (['$_GET', '$_POST', '$_REQUEST', 'avesmapsReadJsonRequest'] as $verboten) {
    assert(
        !str_contains($sondeOhneKommentare, $verboten),
        "die Sonde liest kein {$verboten} -- ihre Ziele stehen fest"
    );
}

// --------------------------------------------------------------------------------------------
// 4. Der Endpunkt. Riegel vor Methode, admin, und rein lesend.
// --------------------------------------------------------------------------------------------
$endpunktQuelle = (string) file_get_contents(__DIR__ . '/../../../edit/admin/ausgang-check.php');
$endpunktOhneKommentare = preg_replace('~/\*.*?\*/|//[^\n]*~s', '', $endpunktQuelle) ?? '';

$riegelBei = strpos($endpunktOhneKommentare, "avesmapsRequireUserWithCapability('admin')");
$methodeBei = strpos($endpunktOhneKommentare, "\$requestMethod !== 'GET'");
assert(is_int($riegelBei), 'der Endpunkt verlangt die Faehigkeit admin');
assert(is_int($methodeBei), 'die Methodenpruefung steht in der Datei');
assert($riegelBei < $methodeBei, 'ein Unbefugter bekommt 401, nicht 405 -- die Methode verraet er ihm nicht');

$optionsBei = strpos($endpunktOhneKommentare, "\$requestMethod === 'OPTIONS'");
assert(is_int($optionsBei) && $optionsBei < $riegelBei, 'OPTIONS bleibt vor dem Riegel');

// ⚠️ Rein lesend, und das soll so bleiben: keine Datenbank, kein Schreiben, kein Protokoll.
foreach (['avesmapsCreatePdo', 'INSERT', 'UPDATE', 'error_log'] as $verboten) {
    assert(
        !str_contains($endpunktOhneKommentare, $verboten),
        "der Endpunkt bleibt rein lesend -- kein {$verboten}"
    );
}

// 💣 Die Sitzung muss losgelassen werden, BEVOR gemessen wird -- sonst friert der eigene Aufruf
// den restlichen Editor fuer denselben Benutzer ein, solange die drei Deckel laufen.
$sitzungBei = strpos($endpunktOhneKommentare, 'session_write_close');
$messungBei = strpos($endpunktOhneKommentare, 'avesmapsAusgangBefund');
assert(is_int($sitzungBei) && is_int($messungBei), 'Sitzungsfreigabe und Messung stehen in der Datei');
assert($sitzungBei < $messungBei, 'die Sitzung wird vor der Messung freigegeben');

echo "ausgang-sonde ok\n";
