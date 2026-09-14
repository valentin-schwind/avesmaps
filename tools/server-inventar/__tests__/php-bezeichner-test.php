<?php

declare(strict_types=1);

/*
 * Der Leseteil des Server-PHP-Inventars (tools/server-inventar/php-bezeichner.php).
 *
 * 🔴 Die tragende Zusicherung ist die NEGATIVE: aus einer Datei mit Zugangsdaten darf nichts als Namen
 *    herauskommen. Die Dateien stammen vom Webroot, das Ergebnis landet in einem Artefakt.
 * 💣 Und die zweite: ein Aufruf im Kommentar, in einer Zeichenkette oder als Methode ist KEIN Aufruf
 *    der globalen Funktion -- sonst gilt eine tote Funktion als lebend, und genau das soll das
 *    Inventar entscheiden.
 *
 * Aus der Wurzel des Repos: php tools/server-inventar/__tests__/php-bezeichner-test.php
 */

require_once __DIR__ . '/../php-bezeichner.php';

$fehlschlaege = 0;
function pruefe(bool $bedingung, string $text): void
{
    global $fehlschlaege;
    if (!$bedingung) {
        $fehlschlaege++;
        fwrite(STDERR, "ROT: {$text}\n");
    }
}

$code = <<<'PHP'
<?php
require_once __DIR__ . '/_internal/wiki/sync.php';
include 'alt/helfer.php';
function avesmapsEigene(&$x) { return strlen($x); }
function &avesmapsReferenz() { static $a = []; return $a; }
$pdo = new PDO('mysql:host=db.example', 'datenbanknutzer', 'GeheimesPasswort123');
// avesmapsNurImKommentar($pdo);
/* avesmapsAuchNurImKommentar(); */
$wert = avesmapsBeispielAufruf($pdo, 'kennwortImString');
$obj->avesmapsMethode();
$obj?->avesmapsNullsicher();
Klasse::avesmapsStatisch();
$neu = new avesmapsKlasse();
\avesmapsMitNamensraum();
array_map('avesmapsRueckruf', []);
$f = function () { return avesmapsInDerClosure(); };
echo "avesmapsInDoppeltenAnfuehrungszeichen()";
PHP;

$ergebnis = avesmapsInventarBezeichner($code);
$json = json_encode($ergebnis);

// --- 1. Echte Aufrufe werden gefunden, mit Zeile ---
pruefe(($ergebnis['aufrufe']['avesmapsBeispielAufruf'] ?? null) === [9], 'Aufruf mit Zeile 9');
pruefe(isset($ergebnis['aufrufe']['avesmapsMitNamensraum']), 'voll qualifizierter Aufruf zaehlt');
pruefe(isset($ergebnis['aufrufe']['avesmapsInDerClosure']), 'Aufruf in einer Closure zaehlt');

// --- 2. Was KEIN Aufruf der globalen Funktion ist ---
foreach (['avesmapsNurImKommentar', 'avesmapsAuchNurImKommentar', 'avesmapsMethode', 'avesmapsNullsicher',
    'avesmapsStatisch', 'avesmapsKlasse', 'avesmapsEigene', 'avesmapsReferenz',
    'avesmapsInDoppeltenAnfuehrungszeichen'] as $keinAufruf) {
    pruefe(!isset($ergebnis['aufrufe'][$keinAufruf]), "{$keinAufruf} ist kein Aufruf");
}
pruefe(!isset($ergebnis['aufrufe']['strlen']), 'eingebaute Funktionen fallen heraus');
pruefe(!isset($ergebnis['aufrufe']['array_map']), 'eingebaute Funktionen fallen heraus (array_map)');

// --- 3. Deklarationen, Rueckrufe, Einbindungen ---
pruefe(($ergebnis['deklariert']['avesmapsEigene'] ?? null) === 4, 'Deklaration mit Zeile');
pruefe(isset($ergebnis['deklariert']['avesmapsReferenz']), 'function &name() ist eine Deklaration');
pruefe(count($ergebnis['deklariert']) === 2, 'die Closure ist keine Deklaration');
pruefe(isset($ergebnis['rueckrufe_als_zeichenkette']['avesmapsRueckruf']), 'Rueckruf per Name zaehlt');
pruefe(count($ergebnis['einbindungen']) === 2, 'zwei Einbindungen');
pruefe(str_contains($ergebnis['einbindungen'][0]['pfad'] ?? '', '__DIR__')
    && str_contains($ergebnis['einbindungen'][0]['pfad'] ?? '', '/_internal/wiki/sync.php'), 'require-Pfad samt __DIR__');
pruefe(($ergebnis['einbindungen'][0]['art'] ?? '') === 'require_once', 'Art der Einbindung');
pruefe(str_contains($ergebnis['einbindungen'][1]['pfad'] ?? '', 'alt/helfer.php'), 'include-Pfad');

// --- 4. 🔴 Nichts von den Zugangsdaten verlaesst die Funktion ---
foreach (['GeheimesPasswort123', 'datenbanknutzer', 'db.example', 'kennwortImString', 'NurImKommentar'] as $geheim) {
    pruefe(!str_contains($json, $geheim), "'{$geheim}' steht nicht im Ergebnis");
}

// --- 5. Ein ParseError meldet nur die Zeile, nie die Meldung (sie zitiert das Token) ---
$kaputt = avesmapsInventarBezeichner("<?php\n\$a = 'GeheimInFehler' 'zweitesGeheimnis';\n");
pruefe($kaputt['parse_fehler_zeile'] === 2, 'ParseError mit Zeile');
pruefe(!str_contains((string) json_encode($kaputt), 'Geheim'), 'ParseError traegt keinen Zeichenketten-Inhalt hinaus');

// --- 6. Der Kommandozeilen-Weg, wie der Workflow ihn faehrt ---
$verzeichnis = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'inventar-test-' . bin2hex(random_bytes(4));
mkdir($verzeichnis . DIRECTORY_SEPARATOR . 'api', 0777, true);
file_put_contents($verzeichnis . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'alt.php', $code);
file_put_contents($verzeichnis . DIRECTORY_SEPARATOR . 'liesmich.txt', 'avesmapsKeinPhp();');
$befehl = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(dirname(__DIR__) . DIRECTORY_SEPARATOR . 'php-bezeichner.php')
    . ' ' . escapeshellarg($verzeichnis);
$ausgabe = json_decode((string) shell_exec($befehl), true);
pruefe(is_array($ausgabe) && array_keys($ausgabe) === ['api/alt.php'], 'CLI: relativer Pfad mit /, nur .php');
pruefe(isset($ausgabe['api/alt.php']['aufrufe']['avesmapsBeispielAufruf']), 'CLI: Analyse je Datei');
unlink($verzeichnis . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'alt.php');
unlink($verzeichnis . DIRECTORY_SEPARATOR . 'liesmich.txt');
rmdir($verzeichnis . DIRECTORY_SEPARATOR . 'api');
rmdir($verzeichnis);

if ($fehlschlaege > 0) {
    exit(1);
}
echo "OK -- php-bezeichner: Aufrufe, Deklarationen, Einbindungen, und nichts von den Zugangsdaten.\n";
