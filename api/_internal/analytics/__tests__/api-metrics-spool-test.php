<?php
// api/_internal/analytics/__tests__/api-metrics-spool-test.php
// Der Puffer: eine Anfrage OHNE Datenbankverbindung darf keine oeffnen -- sie schreibt ihre
// Zaehlerzeilen in eine Datei, und die naechste Anfrage MIT Verbindung nimmt sie mit.
//
// 💣 Anlass (04.09.2026): der Schnellpfad der politischen Ebene antwortet ausdruecklich VOR dem PDO
// und `exit`et -- die Abschlussroutine baute danach eine Verbindung auf, nur um zu zaehlen, dass
// keine gebraucht wurde. 1.765 an einem Tag, rund die Haelfte aller Aufrufe des heissesten Endpunkts.
//
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/api-metrics-spool-test.php
declare(strict_types=1);

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 4);
require_once $WURZEL . '/api/_internal/analytics/api-metrics.php';

// ---------------------------------------------------------------------------
// Hilfsmittel: Quelltext OHNE Kommentare.
//
// 🪤 Muss ueber den Tokenizer laufen, nicht ueber preg_replace. Der Kommentar an der geaenderten
// Stelle nennt `avesmapsCreatePdo()` woertlich (er erklaert, was dort NICHT mehr steht) -- ein
// Regex-Test schlaegt daran an und behauptet das Gegenteil dessen, was er pruefen soll. Und ein
// Blockkommentar-Entferner frisst an einem `/*` in einer ZEILE hunderte Zeilen echten Code.
// ---------------------------------------------------------------------------
function spooltestCodeOhneKommentare(string $pfad): string {
    $roh = (string) file_get_contents($pfad);
    $aus = '';
    foreach (token_get_all($roh) as $token) {
        if (is_array($token)) {
            if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                continue;
            }
            $aus .= $token[1];
            continue;
        }
        $aus .= $token;
    }
    return $aus;
}

function spooltestAufraeumen(): void {
    $datei = avesmapsApiMetricsSpoolDatei();
    if (is_file($datei)) {
        @unlink($datei);
    }
    foreach ((array) glob($datei . '.*') as $rest) {
        @unlink((string) $rest);
    }
}

spooltestAufraeumen();

// ===========================================================================
// 1) Anhaengen schreibt und meldet Erfolg -- der Aufrufer darf ohne Verbindung enden
// ===========================================================================
$zeilen = [
    ['metric' => 'antwort', 'dimension' => 'app/political-territories|leer', 'hour' => 24],
    ['metric' => 'stunde', 'dimension' => '', 'hour' => 7],
];
assert(avesmapsApiMetricsSpoolAnhaengen($zeilen, '2026-09-04') === true, 'Anhaengen meldet Erfolg');
assert(is_file(avesmapsApiMetricsSpoolDatei()), 'Pufferdatei existiert');

// Zweiter Aufruf haengt an, statt zu ueberschreiben.
assert(avesmapsApiMetricsSpoolAnhaengen($zeilen, '2026-09-04') === true, 'zweites Anhaengen');
$inhalt = (string) file_get_contents(avesmapsApiMetricsSpoolDatei());
assert(substr_count($inhalt, "\n") === 4, 'vier Zeilen im Puffer, nicht zwei');

// Eine leere Zeilenliste ist kein Fehlschlag -- sonst zahlte der Aufrufer grundlos eine Verbindung.
assert(avesmapsApiMetricsSpoolAnhaengen([], '2026-09-04') === true, 'leere Liste = Erfolg');

// Eine belegte Datei muss sofort in den Datenbank-Rückfall führen.
$sperre = fopen(avesmapsApiMetricsSpoolDatei(), 'ab');
assert(flock($sperre, LOCK_EX | LOCK_NB));
$start = hrtime(true);
assert(avesmapsApiMetricsSpoolAnhaengen($zeilen, '2026-09-04') === false);
assert((hrtime(true) - $start) / 1e6 < 200, 'der Puffer wartet nicht auf eine belegte Sperre');
fclose($sperre);
assert(file_get_contents(avesmapsApiMetricsSpoolDatei()) === $inhalt, 'bei belegter Sperre bleibt der Puffer unverändert');

// ===========================================================================
// 2) Gruppieren zaehlt zusammen -- und der TAG bleibt am Satz
// ===========================================================================
$gruppen = avesmapsApiMetricsSpoolGruppieren($inhalt);
assert(count($gruppen) === 2, 'zwei Gruppen aus vier Zeilen, nicht vier');
$nachDimension = [];
foreach ($gruppen as $gruppe) {
    $nachDimension[$gruppe['dimension']] = $gruppe;
}
assert($nachDimension['app/political-territories|leer']['anzahl'] === 2, 'zweimal gezaehlt');
assert($nachDimension['app/political-territories|leer']['tag'] === '2026-09-04', 'Tag reist mit');
assert($nachDimension['app/political-territories|leer']['hour'] === 24, 'Stunde reist mit');
assert($nachDimension['']['metric'] === 'stunde', 'leere Dimension ist eine eigene Gruppe');

// 🔴 Der Tag ist der des PUFFERNS, nicht der des Leerens: eine um 23:59 gepufferte Zeile, die um
// 00:01 geschrieben wird, gehoert in den Vortag. Zwei Tage bleiben deshalb zwei Gruppen.
$zweiTage = avesmapsApiMetricsSpoolGruppieren(
    '{"t":"2026-09-04","h":24,"m":"antwort","d":"x|2xx"}' . "\n"
    . '{"t":"2026-09-05","h":24,"m":"antwort","d":"x|2xx"}' . "\n"
);
assert(count($zweiTage) === 2, 'gleiche Dimension an zwei Tagen = zwei Gruppen');

// ⚠️ Eine halbe oder kaputte Zeile wird uebersprungen, nie geraten -- und verwirft den Rest nicht.
$mitMuell = avesmapsApiMetricsSpoolGruppieren(
    '{"t":"2026-09-04","h":1,"m":"antwort","d":"a|2xx"}' . "\n"
    . '{"t":"2026-09-04","h":1,"m":"antw' . "\n"
    . 'kein json' . "\n"
    . '{"h":1,"m":"antwort","d":"b|2xx"}' . "\n"
    . '{"t":"2026-09-04","h":1,"m":"antwort","d":"c|2xx"}' . "\n"
);
assert(count($mitMuell) === 2, 'zwei heile Zeilen ueberleben drei kaputte');

// ===========================================================================
// 3) Leeren holt die Datei per rename -- nur EINER gewinnt
// ===========================================================================
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// ⚠️ Der Schreiber benutzt bewusst MySQL-Syntax (ON DUPLICATE KEY UPDATE) und scheitert auf SQLite.
// Das ist Absicht und die Hausregel: die Produktionsform wird NICHT verbogen, damit ein Test laeuft.
// Geprueft wird hier die Dateimechanik; dass die richtige Anweisung abgesetzt wird, prueft (5).
$geschrieben = avesmapsApiMetricsSpoolLeeren($pdo);
assert($geschrieben === 2, 'zwei Gruppen geschrieben, gemeldet: ' . $geschrieben);
assert(!is_file(avesmapsApiMetricsSpoolDatei()), 'Puffer ist nach dem Leeren weg');
assert(glob(avesmapsApiMetricsSpoolDatei() . '.*') === [], 'keine Uebergabedatei bleibt liegen');

// Ein zweiter Lauf findet nichts -- so verhaelt sich der Verlierer des rename-Rennens.
assert(avesmapsApiMetricsSpoolLeeren($pdo) === 0, 'leerer Puffer = 0');

// ===========================================================================
// 4) Der Deckel faellt OFFEN aus
// ===========================================================================
spooltestAufraeumen();
file_put_contents(avesmapsApiMetricsSpoolDatei(), str_repeat('x', AVESMAPS_API_METRICS_SPOOL_MAX_BYTES + 1));
assert(
    avesmapsApiMetricsSpoolAnhaengen($zeilen, '2026-09-04') === false,
    'ueber dem Deckel meldet der Puffer false -- der Aufrufer zahlt dann die Verbindung'
);
spooltestAufraeumen();

// ===========================================================================
// 5) DIE VERDRAHTUNG. Ohne sie ist alles obige wirkungslos.
// ===========================================================================
$bootstrap = spooltestCodeOhneKommentare($WURZEL . '/api/_internal/bootstrap.php');

// Die Gegenprobe zum Tokenizer: der Kommentar nennt avesmapsCreatePdo, der Code darunter nicht mehr.
$bootstrapRoh = (string) file_get_contents($WURZEL . '/api/_internal/bootstrap.php');
assert(
    strpos($bootstrapRoh, 'stand hier ein') !== false,
    'der erklaerende Kommentar steht da -- genau deshalb darf dieser Test kein Regex sein'
);

$start = strpos($bootstrap, 'avesmapsLetzteDatenbankverbindung()');
assert($start !== false, 'Abschlussroutine gefunden');
$ende = strpos($bootstrap, 'avesmapsApiMetricsAufraeumen(', $start);
assert($ende !== false, 'Ende der Abschlussroutine gefunden');
$block = substr($bootstrap, $start, $ende - $start);

// 🔴 Der Puffer wird gefragt, BEVOR eine Verbindung entsteht.
$posSpool = strpos($block, 'avesmapsApiMetricsSpoolAnhaengen(');
$posPdo = strpos($block, 'avesmapsCreatePdo(');
assert($posSpool !== false, 'die Abschlussroutine puffert');
assert($posPdo !== false, 'der Rueckfall auf eine echte Verbindung ist noch da (faellt OFFEN aus)');
assert($posSpool < $posPdo, 'erst puffern, dann erst verbinden -- nicht andersherum');

// 🔴 Und sie kehrt zurueck, statt danach doch noch zu verbinden.
$zwischen = substr($block, $posSpool, $posPdo - $posSpool);
assert(strpos($zwischen, 'return') !== false, 'gelungenes Puffern beendet die Routine');

// Wer eine Verbindung hat, leert den Puffer mit.
assert(
    strpos($bootstrap, 'avesmapsApiMetricsSpoolLeeren(') !== false,
    'der Verbindungspfad leert den Puffer'
);

// Der Schreiber setzt die Anweisung mit explizitem Tag und explizitem Zaehler ab.
$metriken = spooltestCodeOhneKommentare($WURZEL . '/api/_internal/analytics/api-metrics.php');
assert(
    strpos($metriken, 'count = count + VALUES(count)') !== false,
    'gepufferte Gruppen tragen ihre Anzahl mit'
);
assert(
    strpos($metriken, "sys_get_temp_dir() . '/avesmaps-api-metrik.spool'") !== false,
    'der Puffer liegt im Temp-Verzeichnis, wie die Ensure-Marken des Hauses'
);

spooltestAufraeumen();
echo "OK api-metrics-spool-test\n";
