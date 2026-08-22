<?php

declare(strict_types=1);

/**
 * 💣 IM FENSTER „AENDERUNGEN" STAND DIE TECHNISCHE KENNUNG DER FLAECHE, NICHT DER NAME DES GEBIETS.
 *
 * `f74ea2ed-29a9-460d-8d3f-3832e4fbc86b` -- so las jede der sieben Gebiets-Aktionen sich fuer einen
 * Editor, weil `avesmapsPoliticalNormalizeChangeLogEntry` die oeffentliche Kennung der Geometrie in
 * das Feld `name` schrieb. Dieser Test faehrt den ECHTEN Lesepfad gegen eine Datenbank, nicht nur
 * die reine Rechnung daneben -- eine gruene Formel ohne Verdrahtung beweist nichts.
 *
 * Lauf:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/political/__tests__/aenderungen-gebietsname-test.php
 * Exit 0 = alle Zusicherungen gehalten.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}
if (!extension_loaded('pdo_sqlite')) {
    fwrite(STDERR, "FATAL: pdo_sqlite fehlt -- mit -d extension=php_pdo_sqlite.dll starten.\n");
    exit(2);
}

require_once __DIR__ . '/../../bootstrap.php';
require_once __DIR__ . '/../territory.php';
require_once __DIR__ . '/../territories-support.php';
require_once __DIR__ . '/../territories-geometry.php';
require_once __DIR__ . '/../territories-audit.php';

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE political_territory (
    id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, is_active INTEGER
)');
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec('CREATE TABLE political_territory_geometry_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
    before_json TEXT, after_json TEXT, undone_at TEXT, undone_by INTEGER,
    undo_audit_id INTEGER, created_at TEXT
)');

$pdo->exec("INSERT INTO political_territory (id, public_id, name, is_active)
    VALUES (7, 'terr-huegelsee', 'Baronie Hügelsee', 1)");
$pdo->exec("INSERT INTO users (id, username) VALUES (3, 'Valentin')");

$GEOMETRIE_KENNUNG = 'f74ea2ed-29a9-460d-8d3f-3832e4fbc86b';
$flaeche = static fn(int $aktiv, ?int $territoryId, int $bisBf = 9999): array => [
    'public_id' => $GLOBALS['GEOMETRIE_KENNUNG'],
    'territory_id' => $territoryId,
    'geometry_geojson' => ['type' => 'Polygon', 'coordinates' => [[[10, 10], [12, 10], [12, 12], [10, 10]]]],
    'valid_from_bf' => 1000,
    'valid_to_bf' => $bisBf,
    'min_zoom' => 0,
    'max_zoom' => 6,
    'min_x' => 10.0,
    'min_y' => 10.0,
    'max_x' => 12.0,
    'max_y' => 12.0,
    'source' => 'editor',
    'style_json' => null,
    'is_active' => $aktiv,
];

$schreibe = static function (PDO $pdo, string $action, array $before, array $after, string $zeit): void {
    $statement = $pdo->prepare(
        'INSERT INTO political_territory_geometry_audit_log (action, actor_user_id, before_json, after_json, created_at)
        VALUES (:action, 3, :before_json, :after_json, :created_at)'
    );
    $statement->execute([
        'action' => $action,
        'before_json' => json_encode($before, JSON_UNESCAPED_UNICODE),
        'after_json' => json_encode($after, JSON_UNESCAPED_UNICODE),
        'created_at' => $zeit,
    ]);
};

// (1) Der gemeldete Fall: eine Gueltigkeit wird geaendert, das Gebiet ist bekannt.
$schreibe($pdo, 'update_geometry', [
    'geometries' => [$GEOMETRIE_KENNUNG => $flaeche(1, 7)],
    'territories' => [],
], [
    'geometries' => [$GEOMETRIE_KENNUNG => $flaeche(1, 7, 1049)],
    'territories' => [],
], '2026-08-22 09:14:00');

// (2) Eine Flaeche OHNE Gebiet -- eine verwaiste Huelle, die geloescht wird. Es gibt hier wirklich
//     keinen Namen, und genau das muss dastehen statt der Kennung.
$schreibe($pdo, 'delete_geometry', [
    'geometries' => [$GEOMETRIE_KENNUNG => $flaeche(1, null)],
    'territories' => [],
], [
    'geometries' => [$GEOMETRIE_KENNUNG => $flaeche(0, null)],
    'territories' => [],
], '2026-08-22 08:00:00');

$antwort = avesmapsPoliticalReadChangeLog($pdo, true);
assert(($antwort['ok'] ?? false) === true, 'der Lesepfad antwortet');
assert(count($antwort['changes']) === 2, 'beide Zeilen kommen zurueck');

[$neueste, $aelteste] = $antwort['changes'];

// ---- Die Zusicherung, um die es geht -----------------------------------------------------------
assert($neueste['name'] === 'Baronie Hügelsee', 'die Zeile nennt das Gebiet beim Namen');
assert($neueste['name'] !== $GEOMETRIE_KENNUNG, 'und NICHT die Kennung der Flaeche');
assert($aelteste['name'] === 'Ohne Herrschaftsgebiet', 'eine Flaeche ohne Gebiet sagt das, statt eine Kennung zu zeigen');

// 🔴 Die Kennung bleibt am Datensatz -- Hinspringen und Zuruecknehmen brauchen sie. Sie ist nur
// nichts, was jemand LESEN soll.
assert($neueste['public_id'] === $GEOMETRIE_KENNUNG, 'die Kennung reist weiter mit, nur nicht als Name');

// 💣 Faengt den Rueckfall, der den Fehler wiederherstellen wuerde: KEIN Feld dieser Zeile darf die
// nackte Kennung als Anzeigetext tragen.
foreach ($antwort['changes'] as $zeile) {
    assert(
        preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', (string) $zeile['name']) !== 1,
        'kein Name ist eine UUID'
    );
    assert(
        preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', (string) $zeile['detail']) !== 1,
        'keine Erklaerzeile ist eine UUID'
    );
}

// ---- Und die Erklaerzeile, die aus demselben Schnappschuss faellt -------------------------------
assert($neueste['detail'] === 'Gültigkeit geändert', 'die geaenderte Gueltigkeit steht in der Zeile');
assert($aelteste['detail'] === '1 Fläche → keine Fläche', 'die Loeschung nennt die Zahl der Flaechen');

echo "aenderungen-gebietsname ok\n";
