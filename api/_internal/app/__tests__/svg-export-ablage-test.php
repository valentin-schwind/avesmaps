<?php

declare(strict_types=1);

/**
 * Die Ablage und der Riegel von GET /api/svg-export.php. Kein Server, keine Datenbank:
 * geprueft wird die Entscheidung, nicht der Transport. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/app/__tests__/svg-export-ablage-test.php
 *
 * Der ECHTE HTTP-Ablauf (401 / 401 / 200 / 304, Koepfe, Inhalt) laeuft ueber
 * tools/svg-export/__tests__/endpunkt-ablauf.js gegen einen `php -S` -- Abnahme heisst
 * Ablauf, nicht Mass (AGENTS.md sec.9).
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../svg-export-ablage.php';

// ---- 1. Der Dateiname ist ein NAME, kein Pfad ------------------------------------------------
// 💣 Das `datei`-Feld kommt aus einer Datei auf der Platte. Ein `../` darin waere ein Leseloch
// in den ganzen Webspace -- und der Endpunkt liefert aus, was dort steht, ohne nachzufragen.
assert(avesmapsSvgExportDateinameGueltig('abzug-0123456789abcdef.svg') === true);
assert(avesmapsSvgExportDateinameGueltig('../../api/config.local.php') === false, 'kein Aufstieg');
assert(avesmapsSvgExportDateinameGueltig('abzug-0123456789abcdef.svg/../x') === false);
assert(avesmapsSvgExportDateinameGueltig('/etc/passwd') === false);
assert(avesmapsSvgExportDateinameGueltig('abzug-0123456789ABCDEF.svg') === false, 'Hex ist klein');
assert(avesmapsSvgExportDateinameGueltig('abzug-0123.svg') === false, 'genau 16 Stellen');
assert(avesmapsSvgExportDateinameGueltig('abzug-0123456789abcdef.php') === false);

// ---- 2. Der Dateiname im Kopf traegt keine Kopfzeilen mit ------------------------------------
// Ein `Content-Disposition`, dessen Wert aus einer Datei stammt, ist sonst eine Einladung,
// weitere Koepfe einzuschleusen.
$vergiftet = "karte\r\nSet-Cookie: a=b\".svg";
$sauber = avesmapsSvgExportDateinameSaeubern($vergiftet);
assert(!str_contains($sauber, "\r") && !str_contains($sauber, "\n"), 'keine Zeilenumbrueche');
assert(!str_contains($sauber, '"'), 'kein Anfuehrungszeichen');
assert(avesmapsSvgExportDateinameSaeubern('avesmaps-karte-2026-08-23-r76178-inkscape.svg')
    === 'avesmaps-karte-2026-08-23-r76178-inkscape.svg', 'der echte Name bleibt unangetastet');
assert(avesmapsSvgExportDateinameSaeubern('///') === 'avesmaps-karte.svg', 'nie ein leerer Name');

// ---- 3. Der Token kommt AUSSCHLIESSLICH aus dem Authorization-Kopf ---------------------------
// 🔴 Ein Token in der Adresse steht im Serverprotokoll, im Referrer und im Browserverlauf.
$_GET['token'] = 'geheim';
$_GET['access_token'] = 'geheim';
assert(avesmapsSvgExportBearerAusAnfrage([]) === '', 'ohne Kopf gibt es keinen Token');
assert(avesmapsSvgExportBearerAusAnfrage(['HTTP_AUTHORIZATION' => 'Bearer abc123']) === 'abc123');
assert(avesmapsSvgExportBearerAusAnfrage(['HTTP_AUTHORIZATION' => 'bearer abc123']) === 'abc123',
    'die Kennzeichnung ist gross-/kleinschreibungsblind (RFC 7235)');
assert(avesmapsSvgExportBearerAusAnfrage(['HTTP_AUTHORIZATION' => '  Bearer   abc123  ']) === 'abc123');
assert(avesmapsSvgExportBearerAusAnfrage(['HTTP_AUTHORIZATION' => 'Basic abc123']) === '',
    'Basic ist kein Bearer');
assert(avesmapsSvgExportBearerAusAnfrage(['HTTP_AUTHORIZATION' => 'Bearer']) === '');
// ⚠️ Apache reicht `Authorization` nicht in jedem CGI-Aufbau durch -- STRATO faehrt PHP als CGI.
assert(avesmapsSvgExportBearerAusAnfrage(['REDIRECT_HTTP_AUTHORIZATION' => 'Bearer umweg']) === 'umweg',
    'der Umleitungsweg ist auf CGI der einzige, der ankommt');
unset($_GET['token'], $_GET['access_token']);

// 💣 Und das haelt es fest, statt es nur zu behaupten: die Quelltextpruefung. Ein spaeterer
// „mach es doch bequemer"-Zusatz mit $_GET faellt hier auf, nicht erst im Serverprotokoll.
$quelltextAblage = (string) file_get_contents(__DIR__ . '/../svg-export-ablage.php');
$quelltextEndpunkt = (string) file_get_contents(__DIR__ . '/../../../svg-export.php');

// ⚠️ GEPRUEFT WIRD DER CODE, NICHT DIE PROSA. Beide Dateien ERKLAEREN in Kommentaren, warum
// sie $_GET nicht anfassen -- eine Suche im Rohtext faende genau diese Erklaerung und waere
// rot, waehrend der Code stimmt. Also erst die Kommentare heraustrennen. (Anders herum ist es
// schlimmer: ein Test, den man durch Umformulieren eines Kommentars gruen bekommt, ist keiner.)
$nurCode = static function (string $quelle): string {
    $aus = '';
    foreach (token_get_all($quelle) as $stueck) {
        if (is_array($stueck) && in_array($stueck[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $aus .= is_array($stueck) ? $stueck[1] : $stueck;
    }
    return $aus;
};
$codeAblage = $nurCode($quelltextAblage);
$codeEndpunkt = $nurCode($quelltextEndpunkt);
// Gegenprobe, damit das Heraustrennen selbst nicht luegt: die Erklaerung steht im Rohtext und
// ist im Code weg.
assert(str_contains($quelltextAblage, '$_GET') && !str_contains($codeAblage, '$_GET'),
    'die Kommentar-Entfernung wirkt -- sonst prueft der naechste Block gar nichts');

foreach (['svg-export-ablage.php' => $codeAblage, 'svg-export.php' => $codeEndpunkt] as $wo => $q) {
    assert(!str_contains($q, '$_GET'), "{$wo} fasst \$_GET nicht an");
    assert(!str_contains($q, '$_POST'), "{$wo} fasst \$_POST nicht an");
    assert(!str_contains($q, '$_REQUEST'), "{$wo} fasst \$_REQUEST nicht an");
    assert(!str_contains($q, 'config.local'), "{$wo} liest den Token nicht aus einer Datei");
}
// 🔴 Der Token wird nirgends protokolliert -- ein Token im Logfile ist ein veroeffentlichter Token.
foreach (['error_log', 'syslog', 'file_put_contents'] as $schreiber) {
    assert(!str_contains($codeEndpunkt, $schreiber), "der Endpunkt schreibt nichts weg ({$schreiber})");
}
// 🔴 Nur Lesen: kein Schreibweg, keine Datenbank.
assert(!str_contains($codeEndpunkt, 'avesmapsCreatePdo'), 'der Endpunkt oeffnet keine Datenbank');
assert(str_contains($codeEndpunkt, 'readfile('),
    'die Datei wird gestreamt, nicht in den Speicher geladen');
assert(!str_contains($codeEndpunkt, 'file_get_contents($abzug'),
    '8 MB in einer PHP-Variable sind auf dem Shared Hosting genau die Last, die AGENTS.md sec.10 meint');

// ---- 4. Der Vergleich ------------------------------------------------------------------------
assert(avesmapsSvgExportTokenPasst('geheim', 'geheim') === true);
assert(avesmapsSvgExportTokenPasst('geheim', 'Geheim') === false);
assert(avesmapsSvgExportTokenPasst('geheim', 'geheim ') === false);
// 💣 Ein leerer erwarteter Token darf NIE passen -- sonst oeffnete eine vergessene
// Umgebungsvariable den Endpunkt fuer jeden, der irgendetwas schickt.
assert(avesmapsSvgExportTokenPasst('', '') === false, 'leer gegen leer ist KEIN Treffer');
assert(avesmapsSvgExportTokenPasst('', 'irgendwas') === false);
assert(avesmapsSvgExportTokenPasst('geheim', '') === false);
// ⭐ Zeitgleich, also ueber hash_equals -- ein `===` verriete die Laenge des Praefixes.
assert(str_contains($codeAblage, 'hash_equals('), 'der Vergleich laeuft ueber hash_equals');

// ---- 5. Der Token kommt aus der UMGEBUNG, und aus drei ihrer PHP-Flaechen --------------------
// ⚠️ Unter CGI landet ein SetEnv je nach Aufbau in $_SERVER, waehrend getenv() leer bleibt.
// Das ist kein Rueckfall auf eine andere QUELLE, es ist dieselbe Variable auf einem anderen Weg.
$_SERVER['AVESMAPS_SVG_EXPORT_TOKEN'] = ' aus-server ';
assert(avesmapsSvgExportToken() === 'aus-server', 'aus $_SERVER, getrimmt');
unset($_SERVER['AVESMAPS_SVG_EXPORT_TOKEN']);
$_ENV['AVESMAPS_SVG_EXPORT_TOKEN'] = 'aus-env';
assert(avesmapsSvgExportToken() === 'aus-env');
unset($_ENV['AVESMAPS_SVG_EXPORT_TOKEN']);
putenv('AVESMAPS_SVG_EXPORT_TOKEN=aus-getenv');
assert(avesmapsSvgExportToken() === 'aus-getenv');
putenv('AVESMAPS_SVG_EXPORT_TOKEN');
$_SERVER['AVESMAPS_SVG_EXPORT_TOKEN'] = '   ';
assert(avesmapsSvgExportToken() === '', 'nur Leerzeichen ist kein Token');
unset($_SERVER['AVESMAPS_SVG_EXPORT_TOKEN']);
assert(avesmapsSvgExportToken() === '', 'ohne Umgebungsvariable gibt es keinen Token');

// ---- 6. Die Ablage: Zeiger, Traversal, abgerissener Upload -----------------------------------
$tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-svgx-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
$aufraeumen = static function (string $dir): void {
    foreach ((array) glob($dir . DIRECTORY_SEPARATOR . '*') as $f) { @unlink((string) $f); }
    foreach ((array) glob($dir . DIRECTORY_SEPARATOR . '.*') as $f) {
        if (!in_array(basename((string) $f), ['.', '..'], true)) { @unlink((string) $f); }
    }
    @rmdir($dir);
};

// Leeres Verzeichnis: keine Antwort, aber auch kein Krach.
assert(avesmapsSvgExportZeigerLesen($tmp) === null, 'ohne aktuell.json gibt es keinen Zeiger');
assert(avesmapsSvgExportAbzug($tmp) === null);

$inhalt = "<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n";
$sha = hash('sha256', $inhalt);
$datei = 'abzug-' . substr($sha, 0, 16) . '.svg';
file_put_contents($tmp . DIRECTORY_SEPARATOR . $datei, $inhalt);

$zeigerSchreiben = static function (string $dir, array $daten): void {
    file_put_contents($dir . DIRECTORY_SEPARATOR . 'aktuell.json',
        json_encode($daten, JSON_UNESCAPED_SLASHES));
};
$guterZeiger = [
    'datei' => $datei,
    'dateiname' => 'avesmaps-karte-2026-08-23-r76178-inkscape.svg',
    'bytes' => strlen($inhalt),
    'sha256' => $sha,
    'etag' => '"' . $sha . '"',
    'kartenfassung' => '76178',
    'landschaftsfassung' => '21358',
    'exportiert' => '2026-08-23T03:17:00.000Z',
];

$zeigerSchreiben($tmp, $guterZeiger);
$abzug = avesmapsSvgExportAbzug($tmp);
assert(is_array($abzug), 'der gute Fall liefert einen Abzug');
assert($abzug['bytes'] === strlen($inhalt));
assert($abzug['etag'] === '"' . $sha . '"', 'der ETag kommt aus dem Zeiger -- 8 MB werden nicht gehasht');
assert($abzug['kartenfassung'] === '76178' && $abzug['landschaftsfassung'] === '21358');
assert($abzug['dateiname'] === 'avesmaps-karte-2026-08-23-r76178-inkscape.svg');

// 💣 Der abgerissene Upload. Steht im Zeiger eine andere Groesse als auf der Platte, gehoert
// der gespeicherte Hash NICHT zu diesen Bytes -- und ein ETag auf fremden Inhalt ist schlimmer
// als keiner: der Client bekaeme spaeter 304 („deine Kopie ist aktuell") fuer eine halbe Datei.
// Dann wird neu gehasht, nicht geglaubt.
$zeigerSchreiben($tmp, array_merge($guterZeiger, ['bytes' => 999999, 'etag' => '"gelogen"']));
$abzugKaputt = avesmapsSvgExportAbzug($tmp);
assert(is_array($abzugKaputt));
assert($abzugKaputt['etag'] === '"' . $sha . '"', 'bei Groessenstreit gewinnt die Datei, nicht der Zeiger');
assert($abzugKaputt['bytes'] === strlen($inhalt), 'und die echte Groesse geht in Content-Length');

// Traversal im Zeiger wird gar nicht erst gelesen.
$zeigerSchreiben($tmp, array_merge($guterZeiger, ['datei' => '../../../api/config.local.php']));
assert(avesmapsSvgExportZeigerLesen($tmp) === null, 'ein Pfad im Zeiger ist kein gueltiger Zeiger');
assert(avesmapsSvgExportAbzug($tmp) === null);

// Zeiger auf eine Datei, die es nicht gibt (abgeraeumt, bevor der Zeiger umsprang).
$zeigerSchreiben($tmp, array_merge($guterZeiger, ['datei' => 'abzug-ffffffffffffffff.svg']));
assert(avesmapsSvgExportAbzug($tmp) === null, 'kein Abzug ist eine ehrliche Absage, keine leere Datei');

// Halb geschriebener / kaputter Zeiger.
file_put_contents($tmp . DIRECTORY_SEPARATOR . 'aktuell.json', '{"datei": "abz');
assert(avesmapsSvgExportZeigerLesen($tmp) === null, 'kaputtes JSON ist kein Zeiger');
file_put_contents($tmp . DIRECTORY_SEPARATOR . 'aktuell.json', '');
assert(avesmapsSvgExportZeigerLesen($tmp) === null);

$aufraeumen($tmp);

// ---- 7. Die Ablage liegt ausserhalb von api/ und ist gesperrt --------------------------------
$verzeichnis = avesmapsSvgExportAblageVerzeichnis();
assert(str_ends_with(str_replace('\\', '/', $verzeichnis), '/uploads/svg-export'),
    'die Abzuege liegen neben den Datenbank-Backups');
$htaccess = dirname(__DIR__, 4) . '/uploads/svg-export/.htaccess';
assert(is_file($htaccess), 'ohne die Sperre waere der Dateiname das Passwort');
$sperre = (string) file_get_contents($htaccess);
assert(str_contains($sperre, 'Require all denied') && str_contains($sperre, 'Deny from all'),
    'beide Apache-Fassungen, wie bei uploads/db-backups');

// ---- 8. Der Endpunkt sagt die drei Faelle AUSEINANDER ----------------------------------------
// 💣 Eine fehlende Umgebungsvariable ist KEIN 401. Ein 401 hiesse „dein Token ist falsch" und
// schickte den Aufrufer auf die Suche nach einem Fehler, den er nicht hat.
assert(str_contains($codeEndpunkt, "503, 'export_not_configured'"));
assert(str_contains($codeEndpunkt, "401, 'unauthorized'"));
assert(str_contains($codeEndpunkt, "404, 'export_not_available'"));
assert(str_contains($codeEndpunkt, "405, 'method_not_allowed'"));
// ⚠️ Fehlender und falscher Token teilen sich EINE Antwort -- sie zu unterscheiden verriete
// einem Probierer, dass sein Format stimmt.
assert(substr_count($codeEndpunkt, "401, 'unauthorized'") === 1, 'genau eine 401-Stelle');
// 🔴 Kein CORS: ein Bearer-Token gehoert nicht in eine Webseite.
assert(!str_contains($codeEndpunkt, 'avesmapsApplyCorsPolicy'));

// 💣 Die Koepfe gehen MIT der Antwort raus, nie vor der Arbeit -- dieselbe Falle, die
// api/_internal/__tests__/etag-shared-test.php fuer die Karte festhaelt: ein ETag, der auch
// einen Fehler begleitet, laesst einen Client den Fehlertext unter diesem Tag ablegen.
$etagStelle = strpos($codeEndpunkt, "header('ETag: '");
$abzugStelle = strpos($codeEndpunkt, 'avesmapsSvgExportAbzug(');
assert(is_int($etagStelle) && is_int($abzugStelle) && $etagStelle > $abzugStelle,
    'der ETag wird erst gesetzt, wenn die Datei feststeht');
// 🔴 Und die geteilte Vergleichsregel, keine eigene: drei Fassungen driften so zuverlaessig wie zwei.
assert(str_contains($codeEndpunkt, 'avesmapsETagMatches('));
assert(!str_contains($codeEndpunkt, 'function avesmapsETagMatches'),
    'keine zweite Umsetzung der Vergleichsregel');

echo "svg-export-ablage ok\n";
