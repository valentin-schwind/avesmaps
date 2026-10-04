<?php

declare(strict_types=1);

/**
 * Der gemeinsame Rahmen der Legacy-Exporte E1–E5 -- api/_internal/app/export-rahmen.php.
 *
 *   A. Projektion: genau die freigegebenen Felder, in Listenreihenfolge, nichts erfunden
 *   B. Fingerabdruck: Zahl, hoechste Kennung und juengster Zeitstempel bewegen ihn je EINZELN
 *   C. Stabil lesen: bewegter Stand -> neu lesen; immer bewegt -> werfen, nie falscher Stand
 *   D. Senden: Kopfzeilen-Reihenfolge und Inhalts-ETag (am Quelltext, die Funktion endet mit exit)
 *   E. Der Rahmen selbst schreibt nicht
 *
 * Aus der Wurzel des Repos:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/export-rahmen-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

$wurzel = dirname(__DIR__, 4);
require_once $wurzel . '/api/_internal/bootstrap.php';
require_once $wurzel . '/api/_internal/app/export-rahmen.php';
require_once __DIR__ . '/export-test-helfer.php';

// =====================================================================================================
// A. PROJEKTION
// =====================================================================================================
$zeile = ['b' => 2, 'geheim' => 'X', 'a' => null, 'c' => 3];
$projiziert = avesmapsExportProjektion($zeile, ['a', 'b', 'fehlt']);
assert($projiziert === ['a' => null, 'b' => 2], 'A1: nur freigegebene Felder, in Listenreihenfolge, null bleibt null, Fehlendes wird nicht erfunden');
assert(!array_key_exists('geheim', $projiziert), 'A2: ein nicht freigegebenes Feld faellt heraus');

// =====================================================================================================
// B. FINGERABDRUCK
// =====================================================================================================
$pdo = exportTestNeuePdo();
$pdo->exec('CREATE TABLE t (id INTEGER PRIMARY KEY, wert TEXT, updated_at TEXT)');
$pdo->exec("INSERT INTO t (id, wert, updated_at) VALUES (1, 'a', '2026-10-01 10:00:00'), (2, 'b', '2026-10-02 10:00:00'), (3, 'c', '2026-10-03 10:00:00')");
$pdo->exec('CREATE TABLE ohnezeit (schluessel TEXT PRIMARY KEY, wert TEXT)');
$pdo->exec("INSERT INTO ohnezeit (schluessel, wert) VALUES ('x', '1'), ('y', '2')");
$tabellen = [['t', 'updated_at'], ['ohnezeit', null, 'schluessel']];
$stand0 = avesmapsExportTabellenFingerabdruck($pdo, $tabellen);

$pdo->exec("UPDATE t SET wert = 'b2', updated_at = '2026-10-04 10:00:00' WHERE id = 2");
$stand1 = avesmapsExportTabellenFingerabdruck($pdo, $tabellen);
assert($stand1 !== $stand0, 'B1: eine geaenderte Zeile in der Mitte hebt den Fingerabdruck (Zeitstempel)');

$pdo->exec('DELETE FROM t WHERE id = 1');
$stand2 = avesmapsExportTabellenFingerabdruck($pdo, $tabellen);
assert($stand2 !== $stand1, 'B2: eine hart geloeschte Zeile in der Mitte hebt ihn (Zahl)');

$pdo->exec('DELETE FROM t WHERE id = 3');
$pdo->exec("INSERT INTO t (id, wert, updated_at) VALUES (9, 'neu', '2026-10-01 00:00:00')");
$stand3 = avesmapsExportTabellenFingerabdruck($pdo, $tabellen);
assert($stand3 !== $stand2, 'B3: ein Tausch bei gleicher Zahl und aelterem Zeitstempel hebt ihn (hoechste Kennung)');

$pdo->exec("INSERT INTO ohnezeit (schluessel, wert) VALUES ('z', '3')");
assert(avesmapsExportTabellenFingerabdruck($pdo, $tabellen) !== $stand3, 'B4: eine Tabelle ohne Zeitstempel bewegt ihn ueber Zahl und Kennung');

assert(avesmapsExportStempel('pre', 'abc') === 'pre-' . substr(sha1('abc'), 0, 16), 'B5: der Stempel ist Praefix plus 16 Hexzeichen');

$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
assert(avesmapsExportMapRevision($pdo) === 0, 'B6: fehlt die Zeile, ist die Kartenrevision 0');
$pdo->exec('INSERT INTO map_revision (id, revision) VALUES (1, 4711)');
assert(avesmapsExportMapRevision($pdo) === 4711, 'B7: sonst die gespeicherte Zahl');

// =====================================================================================================
// C. STABIL LESEN
// =====================================================================================================
$aufrufe = 0;
$ergebnis = avesmapsExportStabilLesen(
    static fn () => avesmapsExportTabellenFingerabdruck($pdo, $tabellen),
    static function () use ($pdo, &$aufrufe): array {
        $aufrufe++;
        if ($aufrufe === 1) {
            $pdo->exec("UPDATE t SET updated_at = '2026-10-05 10:00:00' WHERE id = 2");
        }

        return ['lauf' => $aufrufe];
    }
);
assert($aufrufe === 2, 'C1: bewegt sich der Stand beim ersten Lesen, wird ein zweites Mal gelesen');
assert($ergebnis['daten'] === ['lauf' => 2], 'C2: geliefert werden die Daten des stillen Laufs');
assert($ergebnis['stand'] === avesmapsExportTabellenFingerabdruck($pdo, $tabellen), 'C3: der genannte Stand ist der NACH dem Lesen');

$zaehler = 0;
$geworfen = false;
try {
    avesmapsExportStabilLesen(
        static fn () => avesmapsExportTabellenFingerabdruck($pdo, $tabellen),
        static function () use ($pdo, &$zaehler): array {
            $zaehler++;
            $pdo->exec("UPDATE t SET updated_at = '2026-10-06 10:00:0{$zaehler}' WHERE id = 2");

            return [];
        }
    );
} catch (AvesmapsExportInBewegung) {
    $geworfen = true;
}
assert($geworfen, 'C4: bewegt sich der Stand bei JEDEM Versuch, wird geworfen statt einen falschen Stand zu nennen');
assert($zaehler === AVESMAPS_EXPORT_VERSUCHE, 'C5: genau so oft versucht wie zugesagt, war ' . $zaehler);

// =====================================================================================================
// D. SENDEN -- Reihenfolge und Inhalts-ETag
// =====================================================================================================
$rahmen = exportTestOhneKommentare((string) file_get_contents($wurzel . '/api/_internal/app/export-rahmen.php'));
$senden = substr($rahmen, (int) strpos($rahmen, 'function avesmapsExportSenden'));
$senden = substr($senden, 0, (int) strpos($senden, 'function avesmapsExportInBewegungAntworten'));
$stelle = static function (string $nadel) use ($senden): int {
    $pos = strpos($senden, $nadel);
    assert($pos !== false, "D0: in avesmapsExportSenden fehlt '{$nadel}'");

    return (int) $pos;
};
assert(
    $stelle('avesmapsExportKodieren(') < $stelle("header('ETag: '")
    && $stelle("header('ETag: '") < $stelle("header('X-Avesmaps-ETag: '")
    && $stelle("header('X-Avesmaps-ETag: '") < $stelle('avesmapsETagMatches(')
    && $stelle('avesmapsETagMatches(') < $stelle('http_response_code(304)')
    && $stelle('http_response_code(304)') < $stelle('avesmapsJsonResponse(200'),
    'D1: Kodieren -> ETag -> X-Avesmaps-ETag -> Vergleich -> 304 -> 200'
);
assert(str_contains($senden, 'no-cache, must-revalidate'), 'D2: no-cache, must-revalidate');
assert(str_contains($senden, "'private, no-cache, must-revalidate'"), 'D3: ein privater Export liegt in keinem geteilten Zwischenspeicher');
$rumpfA = avesmapsExportKodieren(['ok' => true, 'a' => 'Ä/ö']);
assert($rumpfA === '{"ok":true,"a":"Ä/ö"}', 'D4: dieselben JSON-Flaggen wie avesmapsJsonResponse (Unicode und Schraegstriche unmaskiert)');
assert(avesmapsExportETag('x', $rumpfA) !== avesmapsExportETag('x', avesmapsExportKodieren(['ok' => true, 'a' => 'Ä/o'])), 'D5: der ETag folgt dem Inhalt');
assert(str_starts_with(avesmapsExportETag('x', $rumpfA), 'W/"x-'), 'D6: schwacher ETag mit Praefix');

// =====================================================================================================
// E. DER RAHMEN SCHREIBT NICHT
// =====================================================================================================
foreach (['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP ', '->exec(', 'beginTransaction', 'Ensure', 'file_put_contents', 'session_start'] as $verboten) {
    assert(!str_contains($rahmen, $verboten), "E1: der Rahmen darf '{$verboten}' nicht enthalten");
}
exportTestSchreibfrei($pdo, static fn () => avesmapsExportTabellenFingerabdruck($pdo, $tabellen) . avesmapsExportMapRevision($pdo), 'E2');

echo "export-rahmen-test: alle Zusicherungen erfuellt\n";
