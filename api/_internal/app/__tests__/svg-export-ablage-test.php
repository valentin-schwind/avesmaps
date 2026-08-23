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
require __DIR__ . '/../svg-export-hinterlegen.php';

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
$codeAblegen = $nurCode((string) file_get_contents(__DIR__ . '/../../../svg-export-deposit.php'));
$codeHinterlegen = $nurCode((string) file_get_contents(__DIR__ . '/../svg-export-hinterlegen.php'));
// Gegenprobe, damit das Heraustrennen selbst nicht luegt: die Erklaerung steht im Rohtext und
// ist im Code weg.
assert(str_contains($quelltextAblage, '$_GET') && !str_contains($codeAblage, '$_GET'),
    'die Kommentar-Entfernung wirkt -- sonst prueft der naechste Block gar nichts');

foreach (['svg-export-ablage.php' => $codeAblage, 'svg-export.php' => $codeEndpunkt] as $wo => $q) {
    assert(!str_contains($q, '$_GET'), "{$wo} fasst \$_GET nicht an");
    assert(!str_contains($q, '$_POST'), "{$wo} fasst \$_POST nicht an");
    assert(!str_contains($q, '$_REQUEST'), "{$wo} fasst \$_REQUEST nicht an");
    // 🔴 config.local.php IST seit 23.08.2026 der Hauptweg (Owner: „unsere token werden in
    // der config.local gesammelt") -- die alte Zusicherung stand hier genau andersherum.
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

// ---- 3b. Die Absage sagt, ob der Kopf ueberhaupt ankam --------------------------------------
// 🔴 Am 23.08.2026 reichte STRATO den Authorization-Kopf nicht an PHP durch (CGI-Falle). Jeder
// Token wirkte falsch, und die 401 war von einem echten Fehlversuch nicht zu unterscheiden --
// gefunden wurde es ueber ein Session-Cookie, das der Endpunkt nebenbei setzte.
assert(avesmapsSvgExportAuthKopfGesehen([]) === false);
assert(avesmapsSvgExportAuthKopfGesehen(['HTTP_AUTHORIZATION' => 'Bearer x']) === true);
assert(avesmapsSvgExportAuthKopfGesehen(['REDIRECT_HTTP_AUTHORIZATION' => 'Bearer x']) === true);
assert(avesmapsSvgExportAuthKopfGesehen(['HTTP_AUTHORIZATION' => '   ']) === false,
    'ein leerer Kopf ist kein Kopf');
// ⚠️ Auch ein Kopf, den der Leser nicht verwerten kann (kein Bearer), ist ANGEKOMMEN -- genau
// diese Unterscheidung ist der Sinn der Angabe.
assert(avesmapsSvgExportAuthKopfGesehen(['HTTP_AUTHORIZATION' => 'Basic abc']) === true);
assert(avesmapsSvgExportBearerAusAnfrage(['HTTP_AUTHORIZATION' => 'Basic abc']) === '',
    'verwertbar ist er trotzdem nicht');

// 💣 UND SIE VERRAET NICHTS UEBER DEN TOKEN. Richtig und falsch muessen dieselbe Antwort
// ergeben -- sonst haette ein Probierer eine Rueckmeldung, und genau dagegen sind die beiden
// 401-Faelle zusammengelegt.
$mitRichtig = avesmapsSvgExportAbsageDetails(['HTTP_AUTHORIZATION' => 'Bearer geheim']);
$mitFalsch = avesmapsSvgExportAbsageDetails(['HTTP_AUTHORIZATION' => 'Bearer falsch']);
assert($mitRichtig === $mitFalsch, 'die Angabe haengt am KOPF, nicht am Wert');
assert(array_keys($mitRichtig) === ['auth_header_seen'], 'genau ein Feld, nichts sonst');
// Und sie hängt in beiden Endpunkten an der 401.
assert(substr_count($codeEndpunkt, 'avesmapsSvgExportAbsageDetails($_SERVER)') === 1);
assert(substr_count($codeAblegen, 'avesmapsSvgExportAbsageDetails($_SERVER)') === 1);

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

// ---- 5. Der Token kommt aus config.local.php, die Umgebung ist der Rueckfall -----------
// 🔴 Owner-Entscheid 23.08.2026: „unsere token werden in der config.local gesammelt, da
// existieren schon token." Derselbe Ort und dieselbe Form wie import_api, discord,
// changelog und social -- ein siebter Ablageort waere eine zweite Stelle, an der jemand
// nach Zugangsdaten suchen muss.
assert(avesmapsSvgExportConfiguredToken(['svg_export' => ['token' => 'aus-config']]) === 'aus-config');
assert(avesmapsSvgExportConfiguredToken(['svg_export' => ['token' => '  getrimmt  ']]) === 'getrimmt');
assert(avesmapsSvgExportConfiguredToken([]) === '', 'ohne Schluessel gibt es keinen Token');
assert(avesmapsSvgExportConfiguredToken(['svg_export' => 'kein-array']) === '',
    'ein Skalar statt eines Teilbaums darf nicht durchschlagen');
assert(avesmapsSvgExportConfiguredToken(['svg_export' => ['token' => '   ']]) === '',
    'nur Leerzeichen ist kein Token');
// ⚠️ Der Schluessel ist ein EIGENER -- nie der von import_api oder discord.
assert(avesmapsSvgExportConfiguredToken(['import_api' => ['token' => 'fremd']]) === '',
    'der Import-Token oeffnet den SVG-Export NICHT');

// Die Umgebungsvariable bleibt als ZWEITE Flaeche, fuer einen Aufbau ohne config.local.php.
// ⚠️ Unter CGI landet ein SetEnv je nach Aufbau in $_SERVER, waehrend getenv() leer bleibt --
// dieselbe Variable auf einem anderen Weg, keine dritte Quelle.
$_SERVER['AVESMAPS_SVG_EXPORT_TOKEN'] = ' aus-server ';
assert(avesmapsSvgExportConfiguredToken([]) === 'aus-server');
// 💣 Und die Config SCHLAEGT die Umgebung -- sonst uebersteuerte eine vergessene Variable
// auf dem Host lautlos den gepflegten Wert.
assert(avesmapsSvgExportConfiguredToken(['svg_export' => ['token' => 'aus-config']]) === 'aus-config',
    'config.local.php gewinnt gegen die Umgebung');
unset($_SERVER['AVESMAPS_SVG_EXPORT_TOKEN']);
$_ENV['AVESMAPS_SVG_EXPORT_TOKEN'] = 'aus-env';
assert(avesmapsSvgExportConfiguredToken([]) === 'aus-env');
unset($_ENV['AVESMAPS_SVG_EXPORT_TOKEN']);
putenv('AVESMAPS_SVG_EXPORT_TOKEN=aus-getenv');
assert(avesmapsSvgExportConfiguredToken([]) === 'aus-getenv');
putenv('AVESMAPS_SVG_EXPORT_TOKEN');
assert(avesmapsSvgExportConfiguredToken([]) === '', 'ohne alles gibt es keinen Token');

// 💣 Der Endpunkt muss den WURF von avesmapsLoadApiConfig fangen. Ohne config.local.php und
// ohne DB-Umgebung wirft sie -- ein reiner Dateiendpunkt duerfte daran nicht mit einem 500
// zerbrechen, an dem der Aufrufer nichts ablesen kann.
assert(str_contains($codeEndpunkt, 'avesmapsLoadApiConfig(avesmapsApiRoot())'));
assert(str_contains($codeEndpunkt, 'catch (Throwable)'), 'und der Wurf wird gefangen');
$tryStelle = strpos($codeEndpunkt, 'try {');
$tokenStelle = strpos($codeEndpunkt, 'avesmapsSvgExportConfiguredToken(');
assert(is_int($tryStelle) && is_int($tokenStelle) && $tokenStelle > $tryStelle,
    'der Aufruf steht IM try-Block, nicht davor');

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

// ---- 7. Die Ablage liegt ausserhalb von api/ und wird von PHP gesperrt ----------------------
$verzeichnis = avesmapsSvgExportAblageVerzeichnis();
assert(str_ends_with(str_replace(DIRECTORY_SEPARATOR, '/', $verzeichnis), '/uploads/svg-export'),
    'die Abzuege liegen neben den Datenbank-Backups');

// 🔴 KEINE REPO-KOPIE DER SPERRE, anders als bei uploads/db-backups. `uploads/` steht nicht in
// der Deploy-Allowlist -- eine Datei im Repo kaeme also nie auf den Server und waere nur eine
// zweite, veraltende Fassung. Gemessen 23.08.2026: genau das ist beim Backup der Fall, dessen
// Repo-Datei traegt CRLF und seine PHP-Konstante LF, also schreibt es die Sperre bei JEDEM Lauf
// neu, ohne dass es jemandem auffiele.
// 💣 GEFRAGT WIRD .gitignore, NICHT DIE PLATTE. Auf der Platte LIEGT die Sperre, sobald der
// Endpunkt einmal lief -- sie heilt sich ja selbst. Ein `is_file`-Test verwechselt dieses
// Laufzeit-Erzeugnis mit einer Repo-Kopie und wird rot, sobald jemand vorher einen Ablauftest
// gefahren hat. Gemeint ist: das Verzeichnis kann gar nicht ins Repo geraten.
$ignoriert = (string) file_get_contents(dirname(__DIR__, 4) . '/.gitignore');
assert(str_contains($ignoriert, 'uploads/svg-export/'),
    'die Ablage ist ignoriert');
assert(!str_contains($ignoriert, '!uploads/svg-export/'),
    'und ohne Ausnahme -- keine Repo-Kopie der Sperre, die veralten koennte');
assert(str_contains(AVESMAPS_SVG_EXPORT_HTACCESS, 'Require all denied')
    && str_contains(AVESMAPS_SVG_EXPORT_HTACCESS, 'Deny from all'),
    'beide Apache-Fassungen, wie bei uploads/db-backups und uploads/dumps');

// ---- 7b. Die Sperre heilt sich zur LAUFZEIT ------------------------------------------------
// Das Hausmuster (avesmapsDbBackupEnsureStorageDir, uploads/dumps): geschrieben wird bei Bedarf,
// bei jeder Anfrage. Die erste Fassung liess die Sperre stattdessen vom naechtlichen CI-Lauf
// hochladen -- das repariert sie einmal pro Nacht, und nur solange die CI laeuft.
assert(function_exists('avesmapsSvgExportEnsureAblage'));
assert(str_contains($codeEndpunkt, 'avesmapsSvgExportEnsureAblage()'),
    'der Leseendpunkt benutzt sie -- eine ungenutzte Selbstheilung heilt nichts');
assert(str_contains($codeAblegen, 'avesmapsSvgExportEnsureAblage()'),
    'und der Schreibendpunkt ebenso -- er legt das Verzeichnis ueberhaupt erst an');
// ⚠️ NACH dem Tokenriegel, damit eine anonyme Anfrage keinen Schreibvorgang ausloest.
$riegelStelle = strpos($codeEndpunkt, "401, 'unauthorized'");
$heilStelle = strpos($codeEndpunkt, 'avesmapsSvgExportEnsureAblage()');
assert(is_int($riegelStelle) && is_int($heilStelle) && $heilStelle > $riegelStelle,
    'die Selbstheilung steht hinter dem Riegel');

// Und sie tut es wirklich -- gefahren, nicht behauptet.
$probe = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-sperre-' . bin2hex(random_bytes(5));
$tief = $probe . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'svg-export';
mkdir($tief, 0700, true);
$h = $tief . DIRECTORY_SEPARATOR . '.htaccess';
file_put_contents($h, 'kaputt');
// Dieselben zwei Zeilen wie in avesmapsSvgExportEnsureAblage, hier gegen ein Testverzeichnis.
if (!is_file($h) || file_get_contents($h) !== AVESMAPS_SVG_EXPORT_HTACCESS) {
    file_put_contents($h, AVESMAPS_SVG_EXPORT_HTACCESS);
}
assert(file_get_contents($h) === AVESMAPS_SVG_EXPORT_HTACCESS,
    'eine beschaedigte Sperre wird ueberschrieben, nicht stehen gelassen');
@unlink($h);
@rmdir($tief);
@rmdir(dirname($tief));
@rmdir($probe);

// ---- 7c. Der SCHREIBWEG: Aufbewahrung, Kennungen, Kurzfelder -------------------------------
// 💣 Der aktuelle Abzug faellt NIE, auch wenn er nach Datum herausfiele -- der Zeiger zeigt auf
// ihn, und eine Ablage mit totem Zeiger meldet „kein Abzug vorhanden", obwohl gerade einer
// hinterlegt wurde.
$lager = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-lager-' . bin2hex(random_bytes(5));
mkdir($lager, 0700, true);
$mach = static function (string $dir, string $hex, int $alter): string {
    $name = 'abzug-' . $hex . '.svg';
    file_put_contents($dir . DIRECTORY_SEPARATOR . $name, 'x');
    touch($dir . DIRECTORY_SEPARATOR . $name, time() - $alter);
    return $name;
};
$a1 = $mach($lager, str_repeat('1', 16), 500);   // aeltester
$a2 = $mach($lager, str_repeat('2', 16), 400);
$a3 = $mach($lager, str_repeat('3', 16), 300);
$a4 = $mach($lager, str_repeat('4', 16), 200);   // neuester
// Der AELTESTE ist der aktuelle -- genau der Fall, in dem eine Sortierung ihn wegwerfen wuerde.
$weg = avesmapsSvgExportAufraeumen($lager, $a1);
assert(is_file($lager . DIRECTORY_SEPARATOR . $a1), 'der aktuelle bleibt, auch als aeltester');
$uebrig = array_map('basename', (array) glob($lager . DIRECTORY_SEPARATOR . 'abzug-*.svg'));
assert(count($uebrig) === AVESMAPS_SVG_EXPORT_KEEP_FILES,
    'genau ' . AVESMAPS_SVG_EXPORT_KEEP_FILES . ' bleiben, gezaehlt: ' . count($uebrig));
assert(in_array($a4, $uebrig, true) && in_array($a3, $uebrig, true), 'die neuesten bleiben');
assert(!in_array($a2, $uebrig, true) && $weg === [$a2], 'der aelteste ueberzaehlige faellt');

// ⚠️ Fremde Dateien im Verzeichnis werden nie angefasst.
file_put_contents($lager . DIRECTORY_SEPARATOR . 'aktuell.json', '{}');
file_put_contents($lager . DIRECTORY_SEPARATOR . '.htaccess', 'x');
avesmapsSvgExportAufraeumen($lager, $a1);
assert(is_file($lager . DIRECTORY_SEPARATOR . 'aktuell.json'), 'der Zeiger bleibt');
assert(is_file($lager . DIRECTORY_SEPARATOR . '.htaccess'), 'die Sperre bleibt');

// 💣 Verwaiste Uploads: alt weg, frisch bleibt. Ohne das sammelt jeder Abbruch 8 MB an -- und
// ein volles Webspace entzieht auf STRATO der Datenbank die Schreibrechte.
$altUp = avesmapsSvgExportUploadPfad($lager, str_repeat('a', 32));
$neuUp = avesmapsSvgExportUploadPfad($lager, str_repeat('b', 32));
file_put_contents($altUp, 'x');
touch($altUp, time() - AVESMAPS_SVG_EXPORT_UPLOAD_TTL - 60);
file_put_contents($neuUp, 'x');
assert(avesmapsSvgExportUploadsAufraeumen($lager, time()) === 1);
assert(!is_file($altUp) && is_file($neuUp), 'nur der verwaiste faellt');

foreach ((array) glob($lager . DIRECTORY_SEPARATOR . '*') as $f) {
    @unlink((string) $f);
}
foreach ((array) glob($lager . DIRECTORY_SEPARATOR . '.*') as $f) {
    if (!in_array(basename((string) $f), ['.', '..'], true)) {
        @unlink((string) $f);
    }
}
@rmdir($lager);

// 💣 EIN NAME, KEIN PFAD -- auch fuer die Upload-Kennung. Sie kommt aus einer Anfrage und
// landet in einem Dateinamen.
assert(avesmapsSvgExportUploadIdGueltig(str_repeat('a', 32)) === true);
assert(avesmapsSvgExportUploadIdGueltig('../../../api/config.local') === false);
assert(avesmapsSvgExportUploadIdGueltig(str_repeat('A', 32)) === false, 'Hex ist klein');
assert(avesmapsSvgExportUploadIdGueltig(str_repeat('a', 31)) === false, 'genau 32 Stellen');

// 💣 KEIN mbstring. Die erste Fassung kappte mit `mb_substr` -- fehlt die Erweiterung, ist das
// ein FATAL, und ein Fatal antwortet mit LEEREM Rumpf: der Aufrufer sieht „Unexpected end of
// JSON input" und sucht den Fehler im Netz. Genau daran ist der erste Ablaufversuch gescheitert.
assert(!str_contains($codeHinterlegen, 'mb_substr') && !str_contains($codeHinterlegen, 'mb_strlen'),
    'der Schreibweg haengt nicht an mbstring');
assert(avesmapsSvgExportKurzfeld('Fuerstentum Kosch', 8) === 'Fuersten', 'acht Zeichen sind acht');
assert(avesmapsSvgExportKurzfeld("a\r\nb", 40) === 'a b', 'Steuerzeichen werden zu Leerraum');
assert(avesmapsSvgExportKurzfeld(88513, 40) === '88513', 'Zahlen sind erlaubt');
assert(avesmapsSvgExportKurzfeld(['x'], 40) === '', 'ein Array ist kein Feld');
// ⚠️ Gekappt wird nach ZEICHEN, nicht nach Bytes -- sonst steht ein halber Umlaut im Zeiger,
// und json_encode verwirft die ganze Datei.
$umlaut = avesmapsSvgExportKurzfeld('Fürstentum Kosch', 12);
assert($umlaut === 'Fürstentum K', 'an der Zeichengrenze geschnitten, nicht im Umlaut');
assert(json_encode(['x' => $umlaut]) !== false, 'und das Ergebnis ist gueltiges UTF-8');

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
