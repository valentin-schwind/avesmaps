<?php

declare(strict_types=1);

/**
 * Die Stundenspalte von visitor_metric darf nicht NULL-faehig sein.
 *
 * 💣 WORUM ES GEHT: `hour` steht im UNIQUE-Schluessel uq_visitor_metric. Waere die Spalte
 * NULL-faehig, griffe ON DUPLICATE KEY UPDATE fuer die dreizehn Metriken ohne Stunde NIE -- nach
 * dem SQL-Standard gelten zwei NULL als VERSCHIEDEN, und MySQL erlaubt im UNIQUE-Index beliebig
 * viele davon. Jedes Ereignis legte eine NEUE Zeile mit count=1 an, statt eine vorhandene
 * hochzuzaehlen. Weil der Lesepfad ohnehin `SUM(count) GROUP BY dimension` rechnet, blieben die
 * ANGEZEIGTEN ZAHLEN richtig -- der Fehler war allein an der Zeilenzahl zu erkennen, und die
 * steht ausgerechnet in der Karte "Speicher".
 *
 * Genau dieser Fehler stand vom 28.06.2026 bis zum 25.08.2026 in der Tabelle. Die
 * Schwestertabelle api_metric hat die Form von Anfang an richtig
 * (AVESMAPS_API_METRICS_KEINE_STUNDE); dieser Test haelt sie nun auch fuer visitor_metric fest.
 *
 * ⚠️ Geprueft wird die BAUFORM am Quelltext, nicht das Verhalten einer Datenbank. Absicht: eine
 * SQLite-Fixture kann hier gar nichts beweisen -- sie kennt `ON DUPLICATE KEY UPDATE` nicht, und
 * die Anweisung fuer sie umzuschreiben hiesse, den Test gegen die Produktion zu drehen
 * (AGENTS.md §9, Fehler 1093).
 *
 * Lauf aus dem Repo-Wurzelverzeichnis:
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/analytics/__tests__/visitor-stunde-platzhalter-test.php
 * Exit 0 = alle Zusicherungen halten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos. "
        . "Neu starten mit: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../visitor-analytics.php';
require __DIR__ . '/../api-metrics.php';

// --- Der Platzhalter selbst ------------------------------------------------------------------
assert(defined('AVESMAPS_VISITOR_KEINE_STUNDE'), 'der Platzhalter muss einen Namen haben');
assert(AVESMAPS_VISITOR_KEINE_STUNDE === 24, '24 = "diese Zeile hat keine Stunde"');
// Er teilt die Bedeutung mit der Schwestertabelle. Zwei verschiedene Zahlen fuer dieselbe Aussage
// waeren beim naechsten gemeinsamen Leser eine Falle.
assert(AVESMAPS_VISITOR_KEINE_STUNDE === AVESMAPS_API_METRICS_KEINE_STUNDE);

// --- Die Abbildung null -> Platzhalter --------------------------------------------------------
// 🔴 Das ist die Naht, an der die Regel EINMAL steht. Alle Aufrufer von avesmapsVisitorIncrement
// gehen durch sie -- eine Regel, die nur einen von mehreren Erzeugern bindet, ist keine Regel
// (AGENTS.md, die Vier-Erzeuger-Falle).
assert(avesmapsVisitorStunde(null) === AVESMAPS_VISITOR_KEINE_STUNDE, 'keine Stunde -> Platzhalter');
assert(avesmapsVisitorStunde(0) === 0, 'Mitternacht ist eine echte Stunde und bleibt 0');
assert(avesmapsVisitorStunde(13) === 13);
assert(avesmapsVisitorStunde(23) === 23, '23 ist die letzte echte Stunde');
// Ausserhalb von 0..23 gibt es keine Stunde -- der Platzhalter ist die sichere Richtung. Eine
// stillschweigende 0 waere schlimmer: sie stuende als Mitternacht in der Heatmap.
assert(avesmapsVisitorStunde(24) === AVESMAPS_VISITOR_KEINE_STUNDE);
assert(avesmapsVisitorStunde(-1) === AVESMAPS_VISITOR_KEINE_STUNDE);
assert(avesmapsVisitorStunde(99) === AVESMAPS_VISITOR_KEINE_STUNDE);

// --- Die Bauform am Quelltext -----------------------------------------------------------------
// 🪤 Kommentare werden VORHER herausgetrennt. Dieser Test sucht Muster, vor denen die Kommentare
// derselben Datei ausdruecklich warnen ("hour ... NULL") -- ohne das Heraustrennen schluege er an
// der Begruendung an, und der naechste Leser loeschte nicht den Test, sondern den Kommentar.
$quelle = (string) file_get_contents(__DIR__ . '/../visitor-analytics.php');
// ⚠️ Zeilenenden zuerst vereinheitlichen: der Arbeitsbaum steht unter Windows, .gitattributes
// setzt text=auto, und ein Schnittmuster mit "\n" findet bei CRLF nie etwas.
$quelle = str_replace("\r\n", "\n", $quelle);

$nurCode = '';
foreach (token_get_all($quelle) as $stueck) {
    if (is_array($stueck)) {
        if ($stueck[0] === T_COMMENT || $stueck[0] === T_DOC_COMMENT) {
            continue;
        }
        $nurCode .= $stueck[1];
        continue;
    }
    $nurCode .= $stueck;
}

// Den DDL-Block herausschneiden, damit die Zusicherungen nicht versehentlich eine andere Tabelle
// derselben Datei messen (visitor_daily_seen, visitor_live, visitor_geo_range).
$start = strpos($nurCode, 'CREATE TABLE IF NOT EXISTS visitor_metric');
assert($start !== false, 'die DDL muss auffindbar bleiben');
$ende = strpos($nurCode, 'ENGINE=InnoDB', $start);
assert($ende !== false, 'der DDL-Block muss ein Ende haben');
$ddl = substr($nurCode, $start, $ende - $start);

// 🔴 DIE ZUSICHERUNG, UM DIE ES GEHT: keine Spalte des UNIQUE-Schluessels ist NULL-faehig.
// Bewusst ueber ALLE Schluesselspalten gerechnet statt nur ueber `hour` -- so faengt sie auch den
// naechsten, der dem Schluessel eine neue NULL-faehige Spalte hinzufuegt.
assert(preg_match('/UNIQUE KEY uq_visitor_metric \(([^)]*)\)/', $ddl, $treffer) === 1,
    'der UNIQUE-Schluessel muss auffindbar bleiben');
$schluesselSpalten = array_map('trim', explode(',', $treffer[1]));
assert($schluesselSpalten === ['day', 'hour', 'actor_type', 'metric', 'dimension']);

foreach ($schluesselSpalten as $spalte) {
    assert(preg_match('/^\s+' . preg_quote($spalte, '/') . '\s+([^\n]+)$/m', $ddl, $zeile) === 1,
        "die Spalte {$spalte} muss im DDL-Block stehen");
    assert(str_contains($zeile[1], 'NOT NULL'),
        "💣 {$spalte} steht im UNIQUE-Schluessel und MUSS NOT NULL sein -- sonst greift "
        . 'ON DUPLICATE KEY UPDATE fuer diese Zeilen nie und jedes Ereignis legt eine neue Zeile an');
}

// Und die Stundenspalte traegt den Platzhalter als Vorgabe.
assert(str_contains($ddl, 'hour TINYINT UNSIGNED NOT NULL DEFAULT 24'));

// --- Der Schreiber bindet nie ein blankes null ------------------------------------------------
// Ohne diese Zeile waere die Spalte zwar NOT NULL, der Schreiber schickte aber weiter null --
// und ausserhalb des strict mode macht MySQL daraus stillschweigend eine 0, also MITTERNACHT.
// Das waere schlimmer als der Ausgangsfehler: falsche Zahlen statt nur zu vieler Zeilen.
assert(preg_match('/function avesmapsVisitorIncrement\(.*?\n\}/s', $nurCode, $koerper) === 1,
    'der Schreiber muss auffindbar bleiben');
assert(str_contains($koerper[0], 'avesmapsVisitorStunde($hour)'),
    'der Schreiber muss die Stunde durch avesmapsVisitorStunde() binden');
assert(preg_match('/\'hour\'\s*=>\s*\$hour\s*,/', $koerper[0]) !== 1,
    '💣 das rohe $hour darf nicht mehr gebunden werden');

// --- Der Leser filtert nicht mehr auf NULL ----------------------------------------------------
// Nach der Umstellung gibt es keine NULL mehr; `hour IS NOT NULL` waere ab dann immer wahr und
// naehme die stundenlosen Zeilen mit in die Heatmap.
assert(!str_contains($nurCode, 'hour IS NOT NULL'),
    '💣 der Heatmap-Filter muss den Platzhalter ausschliessen, nicht NULL');
assert(!str_contains($nurCode, 'hour IS NULL'));

echo "OK: visitor_metric.hour ist NOT NULL, der Schreiber bindet den Platzhalter.\n";
