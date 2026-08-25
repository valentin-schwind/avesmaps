<?php

declare(strict_types=1);

/**
 * Die Bot-Sitzung ueberlebt die Prozessgrenze -- und weiss, wann sie das NICHT mehr darf.
 *
 * 💣 WOZU (gemessen 25.08.2026): der Anmeldezustand lebte nur im jeweiligen PHP-Prozess, und
 * jeder Schritt eines Dump-Laufs ist ein eigener Prozess. Die Kontinent-Phase meldete sich
 * deshalb in JEDEM ihrer 21 Schritte neu an und zahlte dafuer zwei zusaetzliche gedrosselte
 * Anfragen -- drei statt einer, also 60 statt 20 Sekunden je Schritt. 14 der 34 Wiki-Minuten
 * eines Laufs gingen fuer nichts drauf.
 *
 * 🔴 DIE HALTBARKEIT IST DIE GANZE SICHERHEIT DIESER ABLAGE. Eine zu alte Sitzung wird vom Wiki
 * mit 'assertuserfailed' abgelehnt, und dann scheitert JEDER Schritt -- also genau der Schaden,
 * den das Sparen vermeiden soll, nur schlimmer. Deshalb wird hier jede Form geprueft, in der ein
 * Satz unbrauchbar sein kann.
 *
 * Kein HTTP, keine Datenbank: geprueft wird die reine Haltbarkeitsregel plus der Rundlauf ueber
 * eine echte Datei.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/bot-sitzung-ablage-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

require dirname(__DIR__) . '/sync.php';

$jetzt = 1000000.0;
$gueltig = ['cookies' => ['sess' => 'abc'], 'seit' => $jetzt - 60.0];

// ------------------------------------------------------------ DER NORMALFALL ---
assert(
    avesmapsWikiBotSitzungBrauchbar($gueltig, $jetzt) === true,
    'eine eine Minute alte Sitzung mit Cookies ist brauchbar'
);

// ------------------------------------------------------------ ZU ALT ---
assert(
    avesmapsWikiBotSitzungBrauchbar(
        ['cookies' => ['sess' => 'abc'], 'seit' => $jetzt - AVESMAPS_WIKI_BOT_SESSION_MAX_AGE - 1],
        $jetzt
    ) === false,
    'jenseits der Haltbarkeit ist Schluss -- das Wiki wuerde sie mit assertuserfailed ablehnen'
);
assert(
    avesmapsWikiBotSitzungBrauchbar(
        ['cookies' => ['sess' => 'abc'], 'seit' => $jetzt - AVESMAPS_WIKI_BOT_SESSION_MAX_AGE + 1],
        $jetzt
    ) === true,
    'knapp innerhalb der Haltbarkeit ist sie noch brauchbar -- die Grenze darf nicht um einen ganzen Lauf danebenliegen'
);

// ------------------------------------------------- 💣 OHNE ZEITSTEMPEL ---
// Der gefaehrlichste Fall: ein fehlender Zeitstempel ist KEIN Alter von null. Wer ihn so liest,
// benutzt eine beliebig alte Sitzung ewig weiter -- und merkt es erst, wenn jeder Schritt
// scheitert.
assert(
    avesmapsWikiBotSitzungBrauchbar(['cookies' => ['sess' => 'abc']], $jetzt) === false,
    '💣 ohne Zeitstempel ist ein Satz unbrauchbar, nicht frisch'
);
assert(
    avesmapsWikiBotSitzungBrauchbar(['cookies' => ['sess' => 'abc'], 'seit' => 'gestern'], $jetzt) === false,
    'und ein Zeitstempel, der keine Zahl ist, ebenso'
);

// ------------------------------------------------- 💣 AUS DER ZUKUNFT ---
// Eine verstellte Uhr machte die Sitzung sonst unbegrenzt haltbar.
assert(
    avesmapsWikiBotSitzungBrauchbar(['cookies' => ['sess' => 'abc'], 'seit' => $jetzt + 5000.0], $jetzt) === false,
    '💣 ein Zeitstempel aus der Zukunft ist unbrauchbar, nicht ewig frisch'
);

// ------------------------------------------------------------ OHNE COOKIES ---
assert(
    avesmapsWikiBotSitzungBrauchbar(['cookies' => [], 'seit' => $jetzt], $jetzt) === false,
    'ohne Cookies ist nichts zu uebernehmen'
);
assert(
    avesmapsWikiBotSitzungBrauchbar(['seit' => $jetzt], $jetzt) === false,
    'und ein Satz ganz ohne Cookie-Feld erst recht nicht'
);
assert(avesmapsWikiBotSitzungBrauchbar(null, $jetzt) === false, 'kein Satz, keine Sitzung');

// ------------------------------------------------------------ DIE HALTBARKEIT SELBST ---
// ⚠️ MediaWiki laesst eine Sitzung in der Voreinstellung eine Stunde leben. Wer diese Zahl
// hochsetzt, muss das wissen -- deshalb steht die Schranke hier und nicht nur im Kommentar.
assert(
    AVESMAPS_WIKI_BOT_SESSION_MAX_AGE > 0 && AVESMAPS_WIKI_BOT_SESSION_MAX_AGE <= 3000,
    'die Haltbarkeit muss deutlich unter MediaWikis Stunde bleiben, ist aber '
        . AVESMAPS_WIKI_BOT_SESSION_MAX_AGE
);
// Und sie muss einen ganzen Dump-Lauf tragen, sonst spart sie nichts: die Kontinent-Phase
// braucht rund 20 Minuten.
assert(
    AVESMAPS_WIKI_BOT_SESSION_MAX_AGE >= 900,
    'kuerzer als 15 Minuten deckt keinen ganzen Lauf ab und die Ablage waere sinnlos'
);

// ------------------------------------------------------------ OHNE ABLAGEORT ---
// 🔴 Auf dem Entwicklungsrechner gibt es keine Konfiguration und kein uploads/. Alles muss dann
// still auf das alte Verhalten zurueckfallen -- eine Ausnahme legte jeden Wiki-Zugriff lahm.
assert(avesmapsWikiBotSitzungDatei() === null, 'ohne avesmapsApiRoot gibt es keinen Ablageort');
assert(avesmapsWikiBotSitzungLaden() === null, 'und dann auch nichts zu laden');
avesmapsWikiBotSitzungSpeichern(['sess' => 'abc']); // darf nichts tun und nichts werfen
avesmapsWikiBotSitzungVergessen();                  // ebenso

// ------------------------------------------------------------ DER RUNDLAUF ---
// 🪤 Die Regel allein beweist nichts: sie koennte stimmen, waehrend Schreiben und Lesen sich
// auf ein anderes Format geeinigt haben. Deshalb einmal ueber eine echte Datei -- mit genau der
// Kodierung, die avesmapsWikiBotSitzungSpeichern benutzt.
$datei = tempnam(sys_get_temp_dir(), 'avm_sitzung_') ?: '';
assert($datei !== '', 'temporaere Datei anlegbar');
file_put_contents($datei, json_encode(['cookies' => ['sess' => 'abc'], 'seit' => microtime(true)]));
$roh = json_decode((string) file_get_contents($datei), true);
assert(
    avesmapsWikiBotSitzungBrauchbar($roh, microtime(true)) === true,
    'was gespeichert wurde, muss beim Lesen als brauchbar durchgehen -- sonst spart die Ablage nichts'
);
@unlink($datei);

// ------------------------------------------------------------ DIE ZWEITE CHANCE ---
// ⚠️ Nur eine UEBERNOMMENE Sitzung bekommt sie. Eine soeben frisch erworbene, die trotzdem
// abgelehnt wird, ist ein echter Fehler und muss laut werden -- sonst meldet sich ein kaputter
// Zugang endlos neu an.
avesmapsWikiBotZustand(['status' => 'bot', 'grund' => '', 'cookies' => ['s' => '1'], 'aus_ablage' => false]);
assert(
    avesmapsWikiBotSitzungErneuern() === false,
    '💣 eine FRISCH erworbene Sitzung wird nicht erneuert -- ihre Ablehnung ist ein echter Fehler'
);

echo "bot-sitzung-ablage: alle Zusicherungen erfuellt\n";
