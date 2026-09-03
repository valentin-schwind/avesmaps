<?php
// api/_internal/__tests__/schema-ensure-once-test.php
// Der DDL-Riegel: ein Ensure laeuft je definierender Datei hoechstens einmal je Frist -- und sofort
// wieder, wenn die Datei sich aendert (Deploy mit neuer Spalte).
//
// 💣 Gemessen 03.09.2026: die Meldungsliste fuhr je 45 s CREATE TABLE + 5x SHOW COLUMNS + SHOW TABLES,
// jeder Sperr-Wecker 2x CREATE TABLE IF NOT EXISTS, der politische Endpunkt 13 DDL-Statements je
// Nicht-Cache-Treffer. Alles idempotent, alles auf dem heissen Pfad.
//
//   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/schema-ensure-once-test.php
declare(strict_types=1);

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1'.\n");
    exit(2);
}

$WURZEL = dirname(__DIR__, 3);
require_once $WURZEL . '/api/_internal/schema-ensure-once.php';

// ---- 1. Einmal je Frist ------------------------------------------------------------------------
$datei = (string) tempnam(sys_get_temp_dir(), 'avesmaps-ensure-');
file_put_contents($datei, "a");
$name = 'test-' . bin2hex(random_bytes(6));
@unlink(avesmapsSchemaEnsureMarkerFile($name, $datei));
$laeufe = 0;
$ensure = static function () use (&$laeufe): void { $laeufe++; };

assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure) === true, 'der erste Aufruf laeuft');
assert($laeufe === 1);
assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure) === false, 'der zweite innerhalb der Frist nicht');
assert($laeufe === 1);

// ---- 2. Die Frist ------------------------------------------------------------------------------
assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure, 0) === true, 'Frist 0 -> laeuft wieder');
assert($laeufe === 2);

// ---- 3. Eine geaenderte Datei (Deploy) bricht den Riegel sofort ---------------------------------
touch($datei, time() + 10);
clearstatcache(true, $datei);
assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure) === true, 'andere mtime -> anderer Schluessel -> laeuft');
assert($laeufe === 3);
assert(avesmapsSchemaEnsureOnce($name, $datei, $ensure) === false, 'und danach wieder gesperrt');

// ---- 4. Ein werfender Ensure setzt keine Marke --------------------------------------------------
$name2 = 'test-' . bin2hex(random_bytes(6));
$geworfen = false;
try {
    avesmapsSchemaEnsureOnce($name2, $datei, static function (): void { throw new RuntimeException('DDL kaputt'); });
} catch (RuntimeException) {
    $geworfen = true;
}
assert($geworfen, 'der Fehler kommt beim Aufrufer an');
assert(!is_file(avesmapsSchemaEnsureMarkerFile($name2, $datei)), 'keine Marke nach einem Fehlschlag');

@unlink(avesmapsSchemaEnsureMarkerFile($name, $datei));
@unlink($datei);

// ---- 5. Die Takt-Endpunkte gehen durch die Wrapper, nie am Riegel vorbei -----------------------
$ohneKommentare = static function (string $pfad) use ($WURZEL): string {
    $q = (string) file_get_contents($WURZEL . '/' . $pfad);
    $q = (string) preg_replace('#/\*.*?\*/#s', '', $q);
    return (string) preg_replace('#^\s*//.*$#m', '', $q);
};
$editFeatures = $ohneKommentare('api/edit/map/features.php');
assert(str_contains($editFeatures, 'avesmapsEnsureMapFeatureLocksTableEinmal($pdo);'), 'edit/map/features.php: Praeambel ueber den Riegel');
assert(!str_contains($editFeatures, "\n    avesmapsEnsureMapFeatureLocksTable(\$pdo);"), 'edit/map/features.php: kein blanker Ensure mehr');

$libFeatures = $ohneKommentare('api/_internal/map/features.php');
assert(substr_count($libFeatures, 'avesmapsEnsureMapFeatureLocksTableEinmal($pdo);') >= 2, 'acquire und release gehen durch den Riegel');
assert(str_contains($libFeatures, "function avesmapsEnsureMapFeatureLocksTableEinmal(PDO \$pdo): void"), 'der Wrapper steht bei der Definition');
assert(str_contains($libFeatures, "function avesmapsEnsureMapAuditUndoColumnsEinmal(PDO \$pdo): void"), 'ebenso fuer die Undo-Spalten');

$auditLog = $ohneKommentare('api/edit/map/audit-log.php');
assert(str_contains($auditLog, 'avesmapsEnsureMapAuditUndoColumnsEinmal($pdo);'), 'audit-log.php ueber den Riegel');
assert(!str_contains($auditLog, "\n    avesmapsEnsureMapAuditUndoColumns(\$pdo);"), 'audit-log.php: kein blanker Ensure');

$reports = $ohneKommentare('api/edit/reports/locations.php');
assert(str_contains($reports, "function avesmapsEnsureMapReportsTableForReviewEinmal(PDO \$pdo): void"), 'Wrapper fuer map_reports');
assert(substr_count($reports, 'avesmapsEnsureMapReportsTableForReviewEinmal($pdo);') >= 1, 'die Liste (45-s-Takt) geht durch den Riegel');

$endpunkt = $ohneKommentare('api/_internal/political/territories-endpoint.php');
assert(str_contains($endpunkt, 'avesmapsPoliticalEnsureTablesEinmal($pdo);'), 'politischer Endpunkt: Tabellen ueber den Riegel');
assert(str_contains($endpunkt, 'avesmapsPoliticalEnsureDerivedGeometryTablesEinmal($pdo);'), 'politischer Endpunkt: Derived-Tabellen ueber den Riegel');
assert(!str_contains($endpunkt, "\n    avesmapsPoliticalEnsureTables(\$pdo);"), 'kein blanker Ensure im Endpunkt');

$bootstrap = $ohneKommentare('api/_internal/bootstrap.php');
assert(str_contains($bootstrap, "require_once __DIR__ . '/schema-ensure-once.php';"), 'bootstrap.php laedt den Riegel fuer alle Endpunkte');
// Die Bibliotheken laden ihn SELBST -- ein Test laedt sie ohne bootstrap.php.
assert(str_contains($libFeatures, "require_once __DIR__ . '/../schema-ensure-once.php';"), 'map/features.php laedt den Riegel selbst');
assert(str_contains($ohneKommentare('api/_internal/political/territory.php'), "require_once __DIR__ . '/../schema-ensure-once.php';"), 'territory.php laedt den Riegel selbst');
assert(str_contains($ohneKommentare('api/_internal/political/territories-derived-geometry.php'), "require_once __DIR__ . '/../schema-ensure-once.php';"), 'territories-derived-geometry.php laedt den Riegel selbst');
assert(str_contains($reports, "require_once __DIR__ . '/../../_internal/schema-ensure-once.php';"), 'reports/locations.php laedt den Riegel selbst');

fwrite(STDOUT, "OK schema-ensure-once-test\n");
