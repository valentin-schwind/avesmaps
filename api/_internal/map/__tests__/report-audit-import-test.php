<?php

declare(strict_types=1);

/**
 * Befund A39, erste Haelfte: die Import-Tuer moderierte OHNE SPUR.
 *
 * 🔴 WAS HIER BEWIESEN WIRD, UND ZWAR AN EINER ECHTEN TABELLE: ein Aufruf ohne Benutzer schreibt eine
 * Zeile in map_audit_log, sie traegt den Vermerk „import" und behauptet keinen Menschen. Der
 * Schwester-Test nebenan (report-audit-test.php) prueft die reinen Bausteine; dieser hier laesst den
 * Schreiber wirklich laufen -- „ruft die Funktion" und „es steht hinterher etwas da" sind zwei
 * verschiedene Aussagen, und die Sitzung vom 06.08.2026 ist an genau dieser Luecke mehrfach
 * haengengeblieben.
 *
 * Laeuft gegen pdo_sqlite, weil der Schreiber reine DML ist:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/map/__tests__/report-audit-import-test.php
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "FATAL: the pdo_sqlite driver is missing -- re-run with -d extension=php_pdo_sqlite.dll\n");
    exit(2);
}

require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../report-audit.php';
require __DIR__ . '/../features.php';

function avesmapsTestAuditPdo(): PDO {
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('CREATE TABLE map_audit_log (
        id INTEGER PRIMARY KEY,
        feature_id INTEGER NULL,
        action TEXT,
        actor_user_id INTEGER,
        before_json TEXT,
        after_json TEXT
    )');

    return $pdo;
}

$reportRow = [
    'id' => 281,
    'name' => 'Ambosshain',
    'reporter_name' => 'Melderin',
    'report_type' => 'location',
    'report_subtype' => 'dorf',
    'status' => 'neu',
    'review_note' => '',
    // 💣 darf NIE im Protokoll landen -- map_audit_log wird von einem anderen Endpunkt gelesen und
    // reist in jeder Datenbank-Sicherung mit.
    'ip_hash' => 'c0ffee' . str_repeat('a', 58),
    'remote_ip' => '203.0.113.7',
    'user_agent' => 'Mozilla/5.0 (Testsonde)',
];

// ---- Die Import-Tuer: kein Mensch, aber eine Spur -------------------------------------------------

$pdo = avesmapsTestAuditPdo();
avesmapsLogReportModeration($pdo, $reportRow, 'location_reports', 'approved', null, null);

$rows = $pdo->query('SELECT * FROM map_audit_log')->fetchAll();
assert(count($rows) === 1, 'die Import-Tuer schreibt genau EINE Zeile -- vorher schrieb sie keine');

$row = $rows[0];
$after = json_decode((string) $row['after_json'], true);
$before = json_decode((string) $row['before_json'], true);

assert($row['action'] === 'report_approved', 'unter demselben Aktionsnamen wie der Editor');
assert($row['feature_id'] === null, 'feature_id NULL -- eine Entscheidung ist kein Kartenobjekt');
// 💣 Der Kern des Owner-Entscheids (b): kein technischer Benutzer. Eine Id ungleich 0 waere die
// Behauptung, ein Konto habe entschieden.
assert((int) $row['actor_user_id'] === 0, 'kein Benutzer -- die Id bleibt 0');
assert(($after['actor_source'] ?? '') === 'import', 'und der Vermerk sagt, wer es statt dessen war');
assert(($after['status'] ?? '') === 'approved', 'der neue Status steht drin');
assert(($before['status'] ?? '') === 'neu', 'und der alte auch');
// ⚠️ Nur im `after`. Im `before` waere er die Behauptung, der Import sei auch fuer den vorigen
// Zustand verantwortlich gewesen.
assert(!array_key_exists('actor_source', $before), 'der Vermerk steht NICHT im Vorzustand');

// 💣 Die Erlaubnisliste gilt auch durch diese Tuer.
$raw = (string) $row['before_json'] . (string) $row['after_json'];
foreach (['c0ffeeaaa', '203.0.113.7', 'Testsonde'] as $verboten) {
    assert(!str_contains($raw, $verboten), "personenbezogene Angabe im Protokoll: {$verboten}");
}

// ---- Ein Mensch: unveraendert, und ohne Vermerk ---------------------------------------------------
//
// 💣 Faengt: der Vermerk wird an JEDE Zeile gehaengt. Dann stuende „import" auch unter den
// Entscheidungen echter Bearbeiter -- und der Eintrag loege in die andere Richtung.
$pdo = avesmapsTestAuditPdo();
avesmapsLogReportModeration($pdo, $reportRow, 'location_reports', 'rejected', 'Doppelt.', ['id' => 42, 'username' => 'Valentin']);

$row = $pdo->query('SELECT * FROM map_audit_log')->fetch();
$after = json_decode((string) $row['after_json'], true);
assert((int) $row['actor_user_id'] === 42, 'ein Mensch steht mit seiner Id da');
assert(!array_key_exists('actor_source', $after), 'und traegt keinen Herkunftsvermerk');
assert(($after['review_note'] ?? '') === 'Doppelt.', 'seine Notiz reist mit');

// ---- Ein unbekannter Status schreibt gar nichts ---------------------------------------------------

$pdo = avesmapsTestAuditPdo();
avesmapsLogReportModeration($pdo, $reportRow, 'location_reports', 'voellig-erfunden', null, null);
assert((int) $pdo->query('SELECT COUNT(*) AS n FROM map_audit_log')->fetch()['n'] === 0,
    'ohne Aktionsnamen wird keine Zeile geschrieben -- lieber keine Spur als eine namenlose');

// ---- 💣 Und ein Schreibfehler darf die Entscheidung NICHT umwerfen ---------------------------------
//
// Die Meldung ist an jeder Aufrufstelle bereits geaendert. Wirft der Schreiber, antwortet der
// Endpunkt 500 auf etwas, das GEWIRKT hat -- und der Wiederholungsversuch laeuft danach in den
// `AND status = 'neu'`-Riegel und meldet 404. Nachgestellt, indem die Tabelle gar nicht existiert.
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$geworfen = false;
try {
    avesmapsLogReportModeration($pdo, $reportRow, 'location_reports', 'approved', null, null);
} catch (Throwable $exception) {
    $geworfen = true;
}
assert($geworfen === false, 'ein fehlgeschlagener Protokollschreiber wirft nicht');

// ---- Und die Tuer muss ihn wirklich rufen ---------------------------------------------------------
//
// 💣 Genau hier ist diese Sitzung mehrfach hereingefallen: die Regel steht fertig da, und niemand
// ruft sie. Der Test bliebe gruen, und die Tuer schriebe weiter nichts.
$importSource = file_get_contents(__DIR__ . '/../../../import/location-reports/update-status.php');
assert(is_string($importSource) && $importSource !== '', 'die Import-Tuer ist lesbar');
assert(
    str_contains($importSource, "avesmapsLogReportModeration(\$pdo, \$reportRow, 'location_reports', \$newStatus, null, null);"),
    'die Import-Tuer schreibt die Spur -- ohne Notiz und ohne Benutzer'
);

// 🔴 UND ZWAR NACH DEM RIEGEL. Oberhalb stuende eine Protokollzeile fuer eine Entscheidung, die gar
// nicht stattgefunden hat. Ein Protokoll, das mehr behauptet als geschehen ist, ist schlimmer als
// keines -- und diese Reihenfolge sieht man dem Quelltext nicht an, wenn man nicht danach fragt.
$riegelBei = strpos($importSource, 'if ($statement->rowCount() < 1) {');
$spurBei = strpos($importSource, 'avesmapsLogReportModeration(');
assert(is_int($riegelBei) && is_int($spurBei), 'Riegel und Spur stehen beide in der Datei');
assert($riegelBei < $spurBei, 'die Spur wird NACH dem rowCount-Riegel geschrieben');

// ⚠️ Und der Vorzustand muss VOR dem UPDATE gelesen werden -- danach gibt es kein `before` mehr.
$lesenBei = strpos($importSource, 'SELECT * FROM location_reports WHERE id = :report_id');
$schreibenBei = strpos($importSource, 'UPDATE location_reports');
assert(is_int($lesenBei) && is_int($schreibenBei), 'Lesen und Schreiben stehen beide in der Datei');
assert($lesenBei < $schreibenBei, 'der Vorzustand wird vor dem UPDATE gelesen');

// ---- Die Lesehaelfte muss den Vermerk auch herausgeben ---------------------------------------------
//
// 💣 Ohne das steht im Protokoll-Fenster weiter „unbekannt" -- eine Behauptung ueber einen Menschen,
// den es nie gab. Die Zeile wuerde geschrieben und niemand saehe, von wem.
$readerSource = file_get_contents(__DIR__ . '/../../../edit/map/audit-log.php');
assert(is_string($readerSource) && $readerSource !== '', 'der Lesepfad ist lesbar');
assert(
    str_contains($readerSource, "'actor_source' => (string) (\$after['actor_source'] ?? ''),"),
    'der Lesepfad gibt den Herkunftsvermerk heraus'
);
// ⚠️ NICHT in `username` hineingeschrieben: dort steht der Name einer Person, und „import" waere dort
// eine Person namens import.
assert(
    !str_contains($readerSource, "'username' => (string) (\$row['username'] ?? \$after['actor_source']"),
    'und schreibt ihn nicht in das Feld fuer Personennamen',
);

$panelSource = file_get_contents(__DIR__ . '/../../../../js/review/review-panels-change-log.js');
assert(is_string($panelSource) && $panelSource !== '', 'die Oberflaeche ist lesbar');
assert(str_contains($panelSource, 'changeLogEntryActor(entry)'), 'die Zeile fragt, wer es war');
assert(str_contains($panelSource, 'import: "Import"'), 'und kennt den Namen fuer die Import-Tuer');

echo "report-audit-import ok\n";
