<?php

declare(strict_types=1);

/**
 * Der Abstand zwischen zwei Wiki-Anfragen muss ueber PROZESSGRENZEN hinweg gelten.
 *
 * 💣 WORUM ES GEHT, UND WARUM ES AM 24.08.2026 AUFFIEL. Die Wiki-robots.txt gibt
 * AvesmapsWikiSync einen Crawl-delay von 20 Sekunden. Gezaehlt wurde er in einer statischen
 * Variablen -- also NUR innerhalb eines PHP-Prozesses, und die erste Anfrage je Prozess schlief
 * gar nicht. Solange eine Dump-Phase ihre zwoelf Abfragen in EINEM Schritt machte, lagen elf
 * Pausen dazwischen. Seit die Phasen unterbrechbar sind, ist jeder Schritt eine eigene HTTP-
 * Anfrage und damit ein eigener Prozess: zwoelf Schritte, zwoelf erste Anfragen, NULL Pausen.
 *
 * Aus "zu langsam" (HTTP 502) war damit "zu schnell" geworden -- dieselbe Grenze, nur von der
 * anderen Seite gerissen. Nicht die Zahl gesenkt, sondern den Ort umgangen, an dem sie zaehlt.
 *
 * ⭐ DIESER TEST FAEHRT ECHTE UNTERPROZESSE, und das ist sein ganzer Sinn: innerhalb EINES
 * Prozesses war der Abstand schon immer da. Ein Test in einem Prozess waere gruen und wertlos.
 *
 * 🪤 GEMESSEN WIRD DER ABSTAND ZWISCHEN DEN ANFRAGEN, NICHT DIE SCHLAFDAUER. Die erste Fassung
 * pruefte, wie lange der zweite Prozess geschlafen hat -- und das ist die falsche Groesse: der
 * Schlaf ist der REST des Abstands, also kuerzer um genau die Zeit, die der Prozessstart
 * gebraucht hat. Sie war damit vom Zufalls-Jitter abhaengig und fiel bei 0,211 s um, obwohl der
 * Abstand eingehalten war. Der Abstand selbst ist exakt: der Vermerk traegt den Zeitpunkt.
 *
 * 🪤 Und er schreibt KEINE plattformabhaengigen ini-Schalter fest (kein `-d extension=…dll`):
 * genau daran ist am 24.08.2026 ein Deploy gescheitert -- das lokale Testfeld faehrt Windows,
 * das Tor faehrt Linux.
 *
 * Kein HTTP, keine Datenbank. Der Abstand wird per Testparameter auf Millisekunden gestellt --
 * ein Test, der 20 Sekunden kostet, wird als erstes wieder herausgenommen.
 *
 * Lauf (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/wiki/__tests__/wiki-drossel-prozessgrenze-test.php
 * Exit 0 = alle Zusicherungen erfuellt.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1' -- asserts waeren wirkungslos.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4); // __tests__ -> wiki -> _internal -> api -> <Repo>

// 300 ms Grundabstand. Der Jitter im Code legt bis zu 250 ms drauf -- er kann den Abstand also
// nur VERGROESSERN, weshalb hier gegen die 300 geprueft wird und nicht gegen eine Spanne.
$abstand = 300000;
$abstandSekunden = $abstand / 1000000;

$vermerk = tempnam(sys_get_temp_dir(), 'avm_drossel_') ?: '';
if ($vermerk === '') {
    fwrite(STDERR, "FATAL: keine temporaere Datei anlegbar.\n");
    exit(2);
}
// tempnam legt die Datei LEER an -- genau der Zustand "es gab noch nie eine Anfrage".
@unlink($vermerk);

/**
 * Einen frischen PHP-Prozess starten, der EINE gedrosselte Anfrage vortaeuscht, und melden,
 * wie lange er gewartet hat und welchen Zeitpunkt er hinterlassen hat.
 *
 * @return array{wartete: float, vermerkt: float}
 */
$einSchrittImEigenenProzess = static function (string $vermerkDatei) use ($wurzel, $abstand): array {
    $zeilen = [
        '<?php',
        'require ' . var_export($wurzel . '/api/_internal/wiki/sync.php', true) . ';',
        '$t0 = microtime(true);',
        'avesmapsWikiSyncThrottleWikiRequest(' . $abstand . ', ' . var_export($vermerkDatei, true) . ');',
        '$roh = is_file(' . var_export($vermerkDatei, true) . ')',
        '    ? trim((string) file_get_contents(' . var_export($vermerkDatei, true) . ')) : "";',
        'echo json_encode(["wartete" => microtime(true) - $t0, "vermerkt" => is_numeric($roh) ? (float) $roh : 0.0]);',
    ];

    $skript = tempnam(sys_get_temp_dir(), 'avm_drossel_lauf_') ?: '';
    if ($skript === '') {
        fwrite(STDERR, "FATAL: keine temporaere Datei anlegbar.\n");
        exit(2);
    }
    file_put_contents($skript, implode("\n", $zeilen) . "\n");

    $ausgabe = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($skript));
    @unlink($skript);

    // Letzte Zeile, die als JSON durchgeht -- eine Startwarnung darf den Test nicht umwerfen.
    foreach (array_reverse(preg_split('/\R/', trim($ausgabe)) ?: []) as $zeile) {
        $versuch = json_decode(trim($zeile), true);
        if (is_array($versuch) && isset($versuch['wartete'], $versuch['vermerkt'])) {
            return ['wartete' => (float) $versuch['wartete'], 'vermerkt' => (float) $versuch['vermerkt']];
        }
    }

    fwrite(STDERR, "FATAL: Unterprozess lieferte kein JSON. Ausgabe:\n" . $ausgabe . "\n");
    exit(2);
};

// ------------------------------------------------------------ OHNE VORGESCHICHTE ---
// Die allererste Anfrage hat nichts, worauf sie warten muesste.
$erster = $einSchrittImEigenenProzess($vermerk);
assert(
    $erster['wartete'] < $abstandSekunden,
    'die erste Anfrage ueberhaupt darf nicht den vollen Abstand warten, wartete aber '
        . round($erster['wartete'], 3) . ' s'
);
assert(
    $erster['vermerkt'] > 0.0,
    'die erste Anfrage muss ihren Zeitpunkt hinterlassen, sonst weiss die naechste nichts'
);

// ------------------------------------------------- DIE ZUSICHERUNG, UM DIE ES GEHT ---
// Ein ZWEITER, voellig frischer Prozess. Vor dem 24.08.2026 lag er unmittelbar hinter dem
// ersten -- seine statische Variable war leer, und damit war der Crawl-delay faktisch
// abgeschafft. Gemessen wird der ABSTAND der beiden Zeitpunkte, nicht die Schlafdauer.
$zweiter = $einSchrittImEigenenProzess($vermerk);
$abstandTatsaechlich = $zweiter['vermerkt'] - $erster['vermerkt'];
assert(
    $abstandTatsaechlich >= $abstandSekunden - 0.01,
    '💣 zwei aufeinanderfolgende PROZESSE liegen nur ' . round($abstandTatsaechlich, 3)
        . ' s auseinander (gefordert: ' . $abstandSekunden . ' s) -- genau so wird aus einer '
        . 'unterbrechbaren Phase ein Sturmlauf gegen das Wiki'
);
assert(
    $abstandTatsaechlich < $abstandSekunden + 5.0,
    'der Abstand darf sich nicht aufschaukeln; gemessen wurden ' . round($abstandTatsaechlich, 3) . ' s'
);

// ------------------------------------------------------------ UND EIN DRITTER ---
// Nicht nur der zweite: der Abstand muss bei JEDEM weiteren Prozess gelten. Ein Vermerk, der
// einmal gesetzt und nie fortgeschrieben wird, bestuende die Probe oben ebenfalls.
$dritter = $einSchrittImEigenenProzess($vermerk);
$abstandZweiterDritter = $dritter['vermerkt'] - $zweiter['vermerkt'];
assert(
    $abstandZweiterDritter >= $abstandSekunden - 0.01,
    '💣 der DRITTE Prozess liegt nur ' . round($abstandZweiterDritter, 3)
        . ' s hinter dem zweiten -- der Vermerk wird nicht fortgeschrieben'
);

// ---------------------------------------------------------------- OHNE ABLAGE ---
// 🔴 Ein nicht schreibbarer Ort darf NICHTS umwerfen. Auf dem Entwicklungsrechner und im
// Testfeld gibt es keine Konfiguration und kein uploads/ -- dort faellt die Drossel auf ihr
// altes, prozesslokales Verhalten zurueck. Ein Fatal Error waere hier der schlechtere Tausch:
// er legte jeden Wiki-Zugriff lahm, um eine Wartezeit zu erzwingen.
$unmoeglich = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'avm-gibt-es-nicht'
    . DIRECTORY_SEPARATOR . 'auch-nicht' . DIRECTORY_SEPARATOR . 'vermerk';
$zeilenOhne = [
    '<?php',
    'require ' . var_export($wurzel . '/api/_internal/wiki/sync.php', true) . ';',
    'avesmapsWikiSyncThrottleWikiRequest(' . $abstand . ', ' . var_export($unmoeglich, true) . ');',
    'echo json_encode(["ok" => true]);',
];
$skriptOhne = tempnam(sys_get_temp_dir(), 'avm_drossel_ohne_') ?: '';
file_put_contents($skriptOhne, implode("\n", $zeilenOhne) . "\n");
$ausgabeOhne = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($skriptOhne) . ' 2>&1');
@unlink($skriptOhne);
assert(
    str_contains($ausgabeOhne, '"ok":true'),
    'ein nicht schreibbarer Vermerk darf nicht werfen; Ausgabe war: ' . trim($ausgabeOhne)
);
assert(
    !str_contains($ausgabeOhne, 'Fatal error') && !str_contains($ausgabeOhne, 'Warning'),
    'und er darf auch nicht warnen -- die Unterdrueckung gehoert an die Datei-Aufrufe: ' . trim($ausgabeOhne)
);


// ------------------------------------------- DIE SPERRE WIRD NICHT GEHALTEN ---
// 💣 Die erste Fassung schlief MIT gehaltener Sperre. Das sieht harmlos aus und ist es nicht:
// N gleichzeitige Anfragen warten dann nacheinander auf die Sperre, jede belegt dabei einen
// PHP-Arbeiter, und die Antwortzeit waechst mit N x Abstand. Auf STRATOs geteiltem Hosting ist
// das die Arbeiter-Saettigung, vor der AGENTS.md warnt -- und zwei Laeufe desselben Benutzers
// reichen dafuer schon.
//
// Geprueft wird die REIHENFOLGE im Quelltext: das Schlafen muss NACH dem Freigeben stehen. Ein
// Ablauftest koennte das nur mit echter Gleichzeitigkeit zeigen, und die ist in einem
// Zusicherungstest weder stabil noch schnell.
$drosselQuelle = str_replace(chr(13), '', (string) file_get_contents($wurzel . '/api/_internal/wiki/sync.php'));
$rumpf = '';
if (preg_match(
    '/function avesmapsWikiSyncDrosselUeberProzessgrenze\([^)]*\)[^{]*\{(.*?)\n\}\n/s',
    $drosselQuelle,
    $m
) === 1) {
    $rumpf = $m[1];
}
assert($rumpf !== '', 'die Drosselfunktion muss im Quelltext auffindbar sein');

$freigabe = strpos($rumpf, 'flock($griff, LOCK_UN)');
$schlaf = strpos($rumpf, 'usleep(');
assert($freigabe !== false, 'die Sperre muss ausdruecklich freigegeben werden');
assert($schlaf !== false, 'und es muss ueberhaupt geschlafen werden');
assert(
    $schlaf > $freigabe,
    '💣 geschlafen wird NACH dem Freigeben der Sperre -- sonst blockiert jeder Wartende einen '
        . 'PHP-Arbeiter, solange ein anderer schlaeft'
);

// Und der Platz wird RESERVIERT, nicht erst nach dem Schlafen eingetragen: sonst vergeben zwei
// gleichzeitige Aufrufer denselben Platz und feuern gemeinsam los.
$schreiben = strpos($rumpf, 'fwrite(');
assert($schreiben !== false, 'der Platz muss geschrieben werden');
assert(
    $schreiben < $freigabe,
    'der Platz wird UNTER der Sperre eingetragen -- danach waere er kein Anspruch mehr, sondern eine Notiz'
);

@unlink($vermerk);

echo "wiki-drossel-prozessgrenze: alle Zusicherungen erfuellt (3 Prozesse + Rueckfall + Sperrdauer)\n";
