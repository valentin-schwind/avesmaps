<?php

declare(strict_types=1);

/**
 * Tests fuer den BOT-ZUGANG in api/_internal/wiki/sync.php.
 * Kein Netz, keine Datenbank -- alle geprueften Funktionen sind rein, und die drei
 * Verdrahtungsproben am Ende lesen Quelltext.
 *
 * Hintergrund: das Wiki Aventurica hat unserem Konto `Avesmaps` am 23.08.2026 Bot-Rechte
 * gegeben. `apihighlimits` (500 statt 50 Titel je Anfrage) gilt aber NUR fuer angemeldete
 * Anfragen -- ohne Login ist das Recht wirkungslos, und das sieht man ihm nicht an.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/bot-login-test.php
 * Exit 0 = alles gruen.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- die Zusicherungen waeren wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../sync.php';

$geprueft = 0;
$pruefe = static function (bool $bedingung, string $text) use (&$geprueft): void {
    $geprueft++;
    if (!$bedingung) {
        fwrite(STDERR, "ROT: {$text}\n");
        exit(1);
    }
};

// --------------------------------------------------------------- ZUGANGSDATEN ---
// 💣 EIN HALBER ZUGANG IST KEINER: mit halbem Zugang waere der Login ein garantiert
// fehlschlagender Fremdaufruf -- und ein Fehlschlag beim Wiki ist genau das, was wir nicht mehr
// produzieren wollen.
$pruefe(
    avesmapsWikiBotZugangAusKonfiguration(['wiki' => ['bot_username' => 'Avesmaps@Avesmaps', 'bot_password' => 'geheim']])
        === ['username' => 'Avesmaps@Avesmaps', 'password' => 'geheim'],
    'vollstaendiger Zugang wird gelesen'
);
$pruefe(avesmapsWikiBotZugangAusKonfiguration([]) === null, 'ohne wiki-Abschnitt: kein Zugang');
$pruefe(avesmapsWikiBotZugangAusKonfiguration(['wiki' => []]) === null, 'leerer wiki-Abschnitt: kein Zugang');
$pruefe(
    avesmapsWikiBotZugangAusKonfiguration(['wiki' => ['bot_username' => 'Avesmaps@Avesmaps', 'bot_password' => '']]) === null,
    'Benutzer ohne Passwort: kein Zugang'
);
$pruefe(
    avesmapsWikiBotZugangAusKonfiguration(['wiki' => ['bot_username' => 'Avesmaps@Avesmaps', 'bot_password' => '   ']]) === null,
    'Passwort nur aus Leerzeichen: kein Zugang'
);
$pruefe(
    avesmapsWikiBotZugangAusKonfiguration(['wiki' => ['bot_username' => '  ', 'bot_password' => 'geheim']]) === null,
    'Benutzer nur aus Leerzeichen: kein Zugang'
);
// ⚠️ Das Passwort wird NICHT getrimmt -- fuehrende/folgende Leerzeichen koennten echt sein.
$pruefe(
    avesmapsWikiBotZugangAusKonfiguration(['wiki' => ['bot_username' => ' Avesmaps ', 'bot_password' => ' x ']])
        === ['username' => 'Avesmaps', 'password' => ' x '],
    'Benutzername wird getrimmt, das Passwort nicht'
);

// ------------------------------------------------------------- STAPELGROESSEN ---
$pruefe(AVESMAPS_WIKI_TITLE_BATCH_SIZE === 50, 'anonym bleiben es 50 Titel');
$pruefe(AVESMAPS_WIKI_TITLE_BATCH_SIZE_BOT === 500, 'mit apihighlimits sind es 500 Titel');
$pruefe(avesmapsWikiTitleBatchSizeFuerZustand('bot') === 500, 'Zustand bot -> 500');
foreach (['anonym', 'unversucht', 'gescheitert', '', 'quatsch'] as $status) {
    $pruefe(
        avesmapsWikiTitleBatchSizeFuerZustand($status) === 50,
        "Zustand '{$status}' -> 50 (alles ausser bot faellt auf den sicheren Wert)"
    );
}

// ------------------------------------------------------------------- COOKIES ---
$kopf = [
    'HTTP/1.1 200 OK',
    'Set-Cookie: de_wikiSession=abc123; path=/; HttpOnly; secure',
    'Content-Type: application/json',
    'set-cookie: de_wikiUserID=7; path=/',
];
$cookies = avesmapsWikiCookiesAusKopfzeilen($kopf);
$pruefe($cookies === ['de_wikiSession' => 'abc123', 'de_wikiUserID' => '7'], 'Set-Cookie wird gelesen, Attribute fallen weg');
$pruefe(
    avesmapsWikiCookiesAusKopfzeilen(['Set-Cookie: a=2'], ['a' => '1', 'b' => '9']) === ['a' => '2', 'b' => '9'],
    'ein neuer Wert ueberschreibt, der Rest bleibt stehen'
);
$pruefe(
    avesmapsWikiCookiesAusKopfzeilen(['Set-Cookie: a=deleted; expires=Thu, 01 Jan 1970 00:00:00 GMT'], ['a' => '1']) === [],
    '„deleted" nimmt den Cookie zurueck, statt ihn leer stehen zu lassen'
);
$pruefe(avesmapsWikiCookiesAusKopfzeilen(['Set-Cookie: a='], ['a' => '1']) === [], 'leerer Wert nimmt den Cookie zurueck');
$pruefe(avesmapsWikiCookiesAusKopfzeilen(['Set-Cookie: kaputt']) === [], 'eine Zeile ohne = ist kein Cookie');
$pruefe(avesmapsWikiCookiesAusKopfzeilen(['X-Set-Cookie: a=1']) === [], 'nur echte Set-Cookie-Zeilen zaehlen, kein Teilstring-Treffer');

$pruefe(avesmapsWikiCookieKopfzeile([]) === '', 'kein Cookie -> leere Zeichenkette');
$pruefe(avesmapsWikiCookieKopfzeile(['a' => '1', 'b' => '2']) === 'a=1; b=2', 'zwei Cookies werden zusammengesetzt');

// --------------------------------------------------------------- KOPFZEILEN ---
$ohne = avesmapsWikiSyncRequestHeaderLines([]);
$mit = avesmapsWikiSyncRequestHeaderLines(['de_wikiSession' => 'abc123']);
$pruefe(!str_contains($ohne, 'Cookie:'), 'ohne Cookie steht auch keine Cookie-Zeile drin');
$pruefe(str_contains($mit, "Cookie: de_wikiSession=abc123\r\n"), 'mit Cookie steht die Zeile drin');
foreach ([$ohne, $mit] as $zeilen) {
    $pruefe(str_contains($zeilen, 'User-Agent: ' . AVESMAPS_WIKI_USER_AGENT), 'der User-Agent faehrt immer mit');
    $pruefe(str_contains($zeilen, 'Accept: application/json'), 'Accept faehrt immer mit');
}

// 🔴 Der Betreiber kann eine htaccess-Ausnahme NUR ueber den User-Agent eintragen. Er muss also
// eindeutig sein UND denselben Wortstamm tragen wie der des Dump-Abrufs, damit EINE Regel beide
// erwischt.
$pruefe(str_contains(AVESMAPS_WIKI_USER_AGENT, 'Avesmaps'), 'der User-Agent nennt uns beim Namen');
$pruefe(str_contains(AVESMAPS_WIKI_USER_AGENT, 'avesmaps.de'), 'der User-Agent sagt, wo man uns findet');
// 🔴 Und er nennt eine Kontaktadresse. MediaWikis eigene Bot-Regeln verlangen das, und der
// Betreiber muss uns erreichen koennen, ohne erst herausfinden zu muessen, wer wir sind.
$pruefe(str_contains(AVESMAPS_WIKI_USER_AGENT, '@'), 'der User-Agent traegt eine Kontaktadresse');

// ------------------------------------------------------------ LOGIN-ANTWORT ---
// 💣 MediaWiki antwortet auch bei ABGELEHNTER Anmeldung mit HTTP 200 -- der Befund steht nur im
// Rumpf. Diese Zusicherungen sind der Grund, warum ein Fehlschlag nicht als Erfolg durchgeht.
$pruefe(avesmapsWikiLoginErgebnis(['login' => ['result' => 'Success']])['ok'] === true, 'Success ist ein Erfolg');
$abgelehnt = avesmapsWikiLoginErgebnis(['login' => ['result' => 'Failed', 'reason' => ['code' => 'wrongpassword', 'text' => 'Falsches Passwort.']]]);
$pruefe($abgelehnt['ok'] === false, 'Failed ist kein Erfolg');
$pruefe($abgelehnt['grund'] === 'Falsches Passwort.', 'der Grund kommt aus reason.text (formatversion=2 liefert ein Objekt)');
$pruefe(
    avesmapsWikiLoginErgebnis(['login' => ['result' => 'Failed', 'reason' => 'schlicht Text']])['grund'] === 'schlicht Text',
    'ein reason als reiner Text wird auch gelesen'
);
$pruefe(
    avesmapsWikiLoginErgebnis(['error' => ['code' => 'badtoken']])['grund'] === 'badtoken',
    'ohne login-Block traegt der error.code den Grund'
);
$pruefe(avesmapsWikiLoginErgebnis([])['ok'] === false, 'eine leere Antwort ist KEIN Erfolg');
$pruefe(avesmapsWikiLoginErgebnis([])['grund'] === 'Grund unbekannt', 'und sie nennt einen Grund, statt leer zu bleiben');
$pruefe(
    avesmapsWikiLoginErgebnis(['login' => ['result' => 'Aborted']])['grund'] === 'Aborted',
    'ohne reason traegt das Ergebniswort den Grund'
);

// ------------------------------------------------------------------- ZUSTAND ---
avesmapsWikiBotZustand(['status' => 'bot', 'grund' => '', 'cookies' => ['s' => '1']]);
$pruefe(avesmapsWikiSyncTitleBatchSize() === 500, 'steht die Bot-Sitzung, sind es 500 Titel');
$pruefe(avesmapsWikiBotSitzungSicherstellen() === true, 'ein bestehender Zustand loest KEINE zweite Anmeldung aus');

avesmapsWikiBotZustand(['status' => 'gescheitert', 'grund' => 'wrongpassword']);
$pruefe(avesmapsWikiSyncTitleBatchSize() === 50, 'nach gescheiterter Anmeldung sind es 50 -- nicht 500');
$pruefe(avesmapsWikiBotSitzungSicherstellen() === false, 'gescheitert wird nicht bei jedem Stapel erneut versucht');
$pruefe(avesmapsWikiBotZustand()['grund'] === 'wrongpassword', 'der Grund bleibt abrufbar, statt still zu verschwinden');

// ⚠️ Ohne geladene Konfiguration (Entwicklungsrechner, Testfeld) MUSS der Weg netzfrei sein.
avesmapsWikiBotZustand(['status' => 'unversucht']);
$pruefe(
    function_exists('avesmapsLoadApiConfig') || avesmapsWikiSyncTitleBatchSize() === 50,
    'ohne ladbare Konfiguration bleibt es anonym -- und zwar ohne einen einzigen Fremdaufruf'
);
$pruefe(
    function_exists('avesmapsLoadApiConfig') || avesmapsWikiBotZustand()['status'] === 'anonym',
    'und der Zustand sagt „anonym", nicht „gescheitert" -- das ist kein Fehler'
);

// ------------------------------------------------------------ VERDRAHTUNG ---
// 💣 Ein gruener Test beweist nichts, wenn die Aufrufstellen weiter die Konstante nehmen: dann
// faehrt der ganze Bau mit 500er-Recht und 50er-Stapeln.
$wikiVerzeichnis = __DIR__ . '/..';
$sünder = [];
foreach ((array) glob($wikiVerzeichnis . '/*.php') as $datei) {
    $quelle = (string) file_get_contents((string) $datei);
    if (preg_match('/array_(chunk|slice)\([^)]*AVESMAPS_WIKI_TITLE_BATCH_SIZE\b/', $quelle) === 1) {
        $sünder[] = basename((string) $datei);
    }
}
$pruefe($sünder === [], 'keine Stapelbildung nimmt die Konstante direkt: ' . implode(', ', $sünder));

$syncQuelle = (string) file_get_contents($wikiVerzeichnis . '/sync.php');
$pruefe(
    str_contains($syncQuelle, "avesmapsWikiSyncTitleBatchSize"),
    'sync.php bietet die Stapelgroesse als Funktion an'
);

// 💣 Die zwei Fehler, die MediaWiki mit HTTP 200 ausliefert, muessen im GET-Weg abgefangen werden.
foreach (['assertuserfailed', 'toomanyvalues'] as $code) {
    $pruefe(str_contains($syncQuelle, "'{$code}'"), "der Riegel kennt {$code} -- sonst kaeme der Fehler als „nichts gefunden\" durch");
}

// 💣 Das Passwort darf niemals in einer Adresse stehen: `avesmapsWikiSyncLogServerError` schreibt
// URLs ins Fehlerprotokoll. Also POST mit Rumpf, und der Rumpf wird nirgends protokolliert.
$postBlock = '';
if (preg_match('/function avesmapsWikiSyncApiPost\(.*?\n\}/s', $syncQuelle, $treffer) === 1) {
    $postBlock = $treffer[0];
}
$pruefe($postBlock !== '', 'avesmapsWikiSyncApiPost ist auffindbar');
$pruefe(str_contains($postBlock, "'method' => 'POST'"), 'die Anmeldung geht per POST');
$pruefe(str_contains($postBlock, "'content' => \$rumpf"), 'die Zugangsdaten reisen im Rumpf');
$pruefe(!str_contains($postBlock, 'avesmapsWikiSyncLogServerError'), 'der POST-Weg protokolliert nichts -- dort faehrt das Passwort mit');

$loginBlock = '';
if (preg_match('/function avesmapsWikiBotSitzungSicherstellen\(.*?\n\}/s', $syncQuelle, $treffer) === 1) {
    $loginBlock = $treffer[0];
}
$pruefe($loginBlock !== '', 'avesmapsWikiBotSitzungSicherstellen ist auffindbar');
$pruefe(str_contains($loginBlock, 'wiki_bot_login_failed'), 'ein Fehlschlag ist laut, nicht still');
$pruefe(
    substr_count($loginBlock, "\$zugang['password']") === 1,
    'das Passwort wird an GENAU EINER Stelle angefasst -- beim Anmelden, sonst nirgends'
);

// 💣 Und kein Protokolleintrag der ganzen Datei darf es mitschreiben. Geprueft wird jeder
// Aufruf samt seiner Argumentliste, nicht nur die Zeile: die Liste ist mehrzeilig, und genau
// darin wuerde ein Passwort landen.
foreach (['password', 'lgpassword'] as $verboten) {
    $stelle = 0;
    while (($stelle = strpos($syncQuelle, 'avesmapsWikiSyncLogServerError(', $stelle)) !== false) {
        // Fenster = vom Aufruf bis zu seiner schliessenden Klammer, nicht eine feste Laenge:
        // ein zu weites Fenster liest den naechsten Codeblock mit und meldet ihn als Treffer.
        $ende = strpos($syncQuelle, ');', $stelle);
        $argumente = substr($syncQuelle, $stelle, $ende === false ? 200 : ($ende - $stelle));
        $pruefe(
            !str_contains($argumente, $verboten),
            "kein Protokolleintrag traegt „{$verboten}\" -- das Fehlerprotokoll ist kein Ort fuer Zugangsdaten"
        );
        $stelle++;
    }
}

// ------------------------------------------------------------- DIE AUSKUNFT ---
// 🔴 Ohne sichtbare Auskunft ist „das Recht wirkt" von „das Recht wirkt nicht" nicht zu
// unterscheiden -- genau die Fehlerklasse, die hier schon zweimal Tage gekostet hat.
$angemeldet = avesmapsWikiBotZugangSatz(true, 'bot', '');
$pruefe(str_contains($angemeldet['text'], '500'), 'angemeldet: der Satz nennt die 500');
$pruefe($angemeldet['fehler'] === '', 'angemeldet ist kein Fehler');

$abgewiesen = avesmapsWikiBotZugangSatz(true, 'gescheitert', 'wrongpassword');
$pruefe(str_contains($abgewiesen['text'], 'wrongpassword'), 'abgelehnt: der Grund steht im Satz');
$pruefe(str_contains($abgewiesen['text'], '50 Titel'), 'abgelehnt: der Satz sagt, was stattdessen gilt');
$pruefe($abgewiesen['fehler'] === $abgewiesen['text'], 'abgelehnt: derselbe Satz stoert auch die Statuszeile');

$ohneGrund = avesmapsWikiBotZugangSatz(true, 'gescheitert', '');
$pruefe($ohneGrund['fehler'] !== '', 'abgelehnt ohne Grund bleibt trotzdem ein Fehler');

$fehlt = avesmapsWikiBotZugangSatz(false, 'anonym', 'keine Zugangsdaten hinterlegt');
$pruefe(str_contains($fehlt['text'], 'nicht hinterlegt'), 'ohne Zugangsdaten sagt der Satz genau das');
// 💣 „nicht hinterlegt" ist KEIN Fehler -- das ist der Zustand jeder Installation ohne Bot-Konto,
// und eine rote Zeile dafuer liest nach dem dritten Mal niemand mehr.
$pruefe($fehlt['fehler'] === '', 'ohne Zugangsdaten wird nichts rot');

$wartet = avesmapsWikiBotZugangSatz(true, 'unversucht', '');
$pruefe(str_contains($wartet['text'], 'hinterlegt'), 'hinterlegt, aber ungeprueft: der Satz sagt beides');
// ⚠️ Er darf keine Gewissheit behaupten, die er nicht hat: die Statusabfrage meldet sich nicht an.
$pruefe(!str_contains($wartet['text'], '500'), 'hinterlegt heisst NICHT angemeldet -- keine 500 versprechen');
$pruefe($wartet['fehler'] === '', 'ein ungeprueftes Feld ist kein Fehler');

// 🔴 Und die Auskunft darf niemals die Zugangsdaten selbst tragen.
$auskunft = avesmapsWikiBotStatusShape();
$pruefe(!array_key_exists('username', $auskunft) && !array_key_exists('password', $auskunft), 'die Auskunft nennt weder Benutzer noch Passwort');
$pruefe(!str_contains((string) json_encode($auskunft), 'password'), 'auch serialisiert steht dort kein Passwortfeld');
foreach (['hinterlegt', 'status', 'grund', 'text', 'fehler'] as $feld) {
    $pruefe(array_key_exists($feld, $auskunft), "die Auskunft traegt {$feld}");
}

echo "bot-login-test: {$geprueft} Zusicherungen gruen\n";
