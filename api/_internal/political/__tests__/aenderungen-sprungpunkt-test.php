<?php

declare(strict_types=1);

/**
 * 💣 DAS FADENKREUZ EINER GEBIETSZEILE FLOG AN DAS START-SECHSECK, NICHT AUF DAS GEBIET.
 *
 * `avesmapsPoliticalBuildAuditFocusTarget` las `min_x..max_y` AUS DEM SCHNAPPSCHUSS. Die vier
 * Spalten waren aber abgeleitete Daten, die kein Schreiber nachzog (AGENTS.md §10): sie trugen den
 * Kasten des Sechsecks, mit dem die Flaeche einmal angelegt wurde. Am Dump vom 04.09.2026 gezaehlt:
 * **222 von 223** Protokollzeilen wiesen damit an eine Stelle, an der nichts liegt -- „Herrschafts-
 * gebiet-Geometrie geaendert" sprang an einen leeren Fleck, und der Editor suchte den Fehler bei
 * sich.
 *
 * 🔴 Die Bestandsreparatur der GEOMETRIE-Tabelle vom 05.09.2026 heilt das NICHT: ein Protokoll ist
 * ein Archiv, seine Schnappschuesse bleiben, wie sie geschrieben wurden. Gerechnet wird deshalb aus
 * der GEOMETRIE des Schnappschusses -- dieselbe Regel, die `avesmapsPoliticalApplyGeometryAuditSnapshot`
 * beim Zuruecknehmen schon hat.
 *
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *     api/_internal/political/__tests__/aenderungen-sprungpunkt-test.php
 * Exit 0 = alle Zusicherungen bestanden.
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

$checks = 0;

// Der gemessene Fall: gespeicherter Kasten ist das Start-Sechseck (20 breit, 17,32 hoch), die echte
// Flaeche liegt woanders und ist viel groesser. Zahlen aus Zeile 100591 des Dumps vom 04.09.2026.
$SECHSECK = ['min_x' => 381.9, 'min_y' => 176.8, 'max_x' => 401.9, 'max_y' => 194.2];
$ECHT = [[345.9, 118.2], [447.1, 118.2], [447.1, 255.5], [345.9, 255.5], [345.9, 118.2]];

$flaeche = static function (int $aktiv) use ($SECHSECK, $ECHT): array {
    return [
        'public_id' => 'f74ea2ed-29a9-460d-8d3f-3832e4fbc86b',
        'territory_id' => 7,
        'geometry_geojson' => ['type' => 'Polygon', 'coordinates' => [$ECHT]],
        'valid_from_bf' => 1000,
        'valid_to_bf' => 9999,
        'min_zoom' => 0,
        'max_zoom' => 6,
        'min_x' => $SECHSECK['min_x'],
        'min_y' => $SECHSECK['min_y'],
        'max_x' => $SECHSECK['max_x'],
        'max_y' => $SECHSECK['max_y'],
        'source' => 'editor',
        'style_json' => null,
        'is_active' => $aktiv,
    ];
};

// ---- (1) Die Zusicherung, um die es geht ---------------------------------------------------------

$ziel = avesmapsPoliticalBuildAuditFocusTarget(
    ['geometries' => ['f74ea2ed-29a9-460d-8d3f-3832e4fbc86b' => $flaeche(1)], 'territories' => []],
    ['geometries' => ['f74ea2ed-29a9-460d-8d3f-3832e4fbc86b' => $flaeche(1)], 'territories' => []]
);
assert($ziel !== null, 'ein Schnappschuss mit Geometrie liefert ein Ziel');
assert($ziel['type'] === 'bounds', 'eine Flaeche ist ein Rechteck');
assert($ziel['bounds'] === [[118.2, 345.9], [255.5, 447.1]], 'die Ecken folgen der GEOMETRIE, nicht den bbox-Feldern');
assert(abs($ziel['lat'] - 186.85) < 0.001 && abs($ziel['lng'] - 396.5) < 0.001, 'und die Mitte ebenso');
$checks += 4;

// 💣 Die Gegenprobe: das Ziel darf NICHT der gespeicherte Sechseck-Kasten sein. Ohne sie waere der
// Test auch dann gruen, wenn jemand die alte Rechnung zurueckbaut und die Fixture zufaellig passt.
assert($ziel['bounds'] !== [[176.8, 381.9], [194.2, 401.9]], 'das Start-Sechseck ist NICHT das Ziel');
$checks += 1;

// ---- (2) Ohne lesbare Geometrie bleiben die bbox-Felder der Rueckfall -----------------------------
// ⚠️ Eine sehr alte Zeile kann eine kaputte oder fehlende Geometrie tragen. Dann ist der gespeicherte
// Kasten die beste verfuegbare Auskunft -- schlechter als nichts ist er nicht.

$ohneGeometrie = $flaeche(1);
unset($ohneGeometrie['geometry_geojson']);
$zielRueckfall = avesmapsPoliticalBuildAuditFocusTarget(
    ['geometries' => [], 'territories' => []],
    ['geometries' => ['x' => $ohneGeometrie], 'territories' => []]
);
assert($zielRueckfall !== null, 'ohne Geometrie gibt es trotzdem ein Ziel');
assert($zielRueckfall['bounds'] === [[176.8, 381.9], [194.2, 401.9]], 'und es ist dann der gespeicherte Kasten');
$checks += 2;

// ---- (3) Gar kein Schnappschuss heisst gar kein Ziel ----------------------------------------------
// 🔴 `null` schaltet im Browser das Fadenkreuz ab. Ein erfundener Nullpunkt floege in die Kartenecke.

assert(
    avesmapsPoliticalBuildAuditFocusTarget(['geometries' => []], ['geometries' => []]) === null,
    'ohne Schnappschuss kein Ziel'
);
$checks += 1;

// ---- (4) Der echte Lesepfad, gegen eine Datenbank gefahren ---------------------------------------
// Eine gruene Formel ohne Verdrahtung beweist nichts -- dieselbe Begruendung wie im Nachbartest.

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('CREATE TABLE political_territory (id INTEGER PRIMARY KEY, public_id TEXT, name TEXT, is_active INTEGER)');
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec('CREATE TABLE political_territory_geometry_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, actor_user_id INTEGER,
    before_json TEXT, after_json TEXT, undone_at TEXT, undone_by INTEGER,
    undo_audit_id INTEGER, created_at TEXT
)');
$pdo->exec("INSERT INTO political_territory (id, public_id, name, is_active) VALUES (7, 'terr-h', 'Baronie Hügelsee', 1)");
$pdo->exec("INSERT INTO users (id, username) VALUES (3, 'Valentin')");
$statement = $pdo->prepare(
    'INSERT INTO political_territory_geometry_audit_log (action, actor_user_id, before_json, after_json, created_at)
    VALUES (:action, 3, :before_json, :after_json, :created_at)'
);
$paket = ['geometries' => ['f74ea2ed-29a9-460d-8d3f-3832e4fbc86b' => $flaeche(1)], 'territories' => []];
$statement->execute([
    'action' => 'update_geometry',
    'before_json' => json_encode($paket, JSON_UNESCAPED_UNICODE),
    'after_json' => json_encode($paket, JSON_UNESCAPED_UNICODE),
    'created_at' => '2026-08-27 15:29:42',
]);

$antwort = avesmapsPoliticalReadChangeLog($pdo, true);
assert(count($antwort['changes']) === 1, 'die Zeile kommt zurueck');
$zeile = $antwort['changes'][0];
assert(is_array($zeile['focus'] ?? null), 'sie traegt ein Ziel');
assert($zeile['focus']['bounds'] === [[118.2, 345.9], [255.5, 447.1]], 'und das Ziel folgt der Geometrie bis in die Antwort');
$checks += 3;

echo "OK -- {$checks} Zusicherungen bestanden.\n";
