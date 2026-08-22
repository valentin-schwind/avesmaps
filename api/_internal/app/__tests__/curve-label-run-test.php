<?php
// api/_internal/app/__tests__/curve-label-run-test.php
declare(strict_types=1);

/**
 * Die Rueckleseprobe des Sammellaufs: mit SQLite simuliert, ob eine STILLE MySQL-Kuerzung
 * wirklich als Fehlschlag erkannt wird.
 * Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §7.1
 * Vorbild in Bauart: api/_internal/app/__tests__/zoom-bands-test.php, Abschnitt „D. Die Rueckleseprobe".
 *
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/curve-label-run-test.php
 *
 * 💣 DER GRUND, WARUM ES DIESEN TEST GIBT: avesmapsCurveRebuildCache schreibt und liest sofort
 * zurueck -- aber dass ein WIDERSPRUCH (das Zurueckgelesene weicht vom Geschriebenen ab) auch
 * WIRKLICH als `ok === false` gemeldet wird, war unbelegt. Genau das ist die Regel, wegen der es
 * die Rueckleseprobe ueberhaupt gibt: `app_setting.setting_value` war einmal VARCHAR(255), MySQL
 * kuerzte ausserhalb des strikten Modus STILL, und ein Speichern-Knopf tat wochenlang nichts, ohne
 * je zu klagen (AGENTS.md §10).
 *
 * ⚠️ In einer EIGENEN Datei, nicht in curve-label-store-test.php -- deren Kopf sagt ausdruecklich
 * „Keine DB, kein HTTP", und avesmapsCurveRebuildCache hat ein PDO.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../app-setting.php';
require_once __DIR__ . '/../curve-label-store.php';

/**
 * SQLite spricht kein MySQL. Nur `app_setting` braucht eine Uebersetzung -- dieselben zwei
 * Stellen wie in zoom-bands-test.php: ENGINE=InnoDB kennt SQLite nicht, und ON DUPLICATE KEY
 * UPDATE auch nicht. `ecosystem_region`/`ecosystem_area` legt dieser Test direkt in SQLite-Syntax
 * an -- ihr MySQL-DDL steht in ecosystem.php und wird von avesmapsCurveRebuildCache nie
 * aufgerufen, es setzt die Tabellen als vorhanden voraus (kein DDL im Sammellauf).
 */
final class AvesmapsCurveLabelRunTestPdo extends PDO
{
    public function exec($statement): int|false
    {
        if (str_contains((string) $statement, 'CREATE TABLE IF NOT EXISTS app_setting')) {
            return parent::exec(
                'CREATE TABLE IF NOT EXISTS app_setting (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    updated_at TEXT
                )'
            );
        }
        return parent::exec($statement);
    }

    public function prepare($query, $options = []): PDOStatement|false
    {
        $query = str_replace(
            'ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            'ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value',
            (string) $query
        );
        return parent::prepare($query, $options);
    }
}

$pdo = new AvesmapsCurveLabelRunTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

// Die Flaechentabellen, so, wie avesmapsCurveRebuildCache sie per SELECT erwartet -- vorhanden,
// keine DDL noetig (dieselbe Erwartung wie im echten Endpunkt).
$pdo->exec(
    'CREATE TABLE ecosystem_region (
        id INTEGER PRIMARY KEY,
        public_id TEXT NOT NULL,
        properties_json TEXT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
    )'
);
$pdo->exec(
    'CREATE TABLE ecosystem_area (
        id INTEGER PRIMARY KEY,
        region_id INTEGER NOT NULL,
        geometry_geojson TEXT NOT NULL,
        geometry_revision INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1
    )'
);

// Eine einzige, eingeschaltete Region mit einem einfachen Rechteck -- klein und schnell, keine
// grosse Fixture noetig (Owner-Vorgabe fuer diesen Test).
$pdo->exec(
    "INSERT INTO ecosystem_region (id, public_id, properties_json, is_active)
     VALUES (1, 'r1', '{\"curve_label\":true,\"curve_label_max\":1}', 1)"
);
$rechteck = (string) json_encode(['type' => 'Polygon', 'coordinates' => [[
    [0.0, 0.0], [100.0, 0.0], [100.0, 10.0], [0.0, 10.0], [0.0, 0.0],
]]]);
$stmt = $pdo->prepare(
    'INSERT INTO ecosystem_area (id, region_id, geometry_geojson, geometry_revision, is_active)
     VALUES (1, 1, :geom, 5, 1)'
);
$stmt->execute(['geom' => $rechteck]);

// ============================================================ A. Ohne Trigger: der Normalfall

$ergebnis = avesmapsCurveRebuildCache($pdo);
assert($ergebnis['ok'] === true, 'ohne stille Kuerzung meldet der Lauf Erfolg');
assert($ergebnis['regions'] === 1, 'genau die eine eingeschaltete Region wird gezaehlt');
assert($ergebnis['bytes'] > 0, 'es wurde tatsaechlich etwas geschrieben');

$gelesen = avesmapsAppSettingGetWithoutDdl($pdo, avesmapsCurveCacheKey(), '');
assert($gelesen !== '', 'die Ablage steht wirklich in app_setting, nicht nur im Rueckgabewert');

// ============================================================ B. Die Rueckleseprobe

// 💣 Die Zeile muss VORHER weg sein: `INSERT ... ON CONFLICT DO UPDATE` zaehlt in SQLite als
// UPDATE, sobald schon eine Zeile mit demselben Schluessel existiert -- ein AFTER-INSERT-Trigger
// faehrt dann gar nicht erst an, und die Probe wuerde stillschweigend nichts pruefen. Dieselbe
// Reihenfolge wie in zoom-bands-test.php (dort raeumt Block C die Zeile vorher weg).
$pdo->exec("DELETE FROM app_setting WHERE setting_key = 'curve_label_baselines'");

// ⭐ Simuliert MySQLs einstige stille VARCHAR(255)-Kuerzung mit einem SQLite-TRIGGER, der jeden
// frisch eingefuegten Wert nach 40 Zeichen abschneidet -- ohne Fehler, genau wie MySQL es tat.
$pdo->exec(
    "CREATE TRIGGER curve_label_baselines_kappen AFTER INSERT ON app_setting
     BEGIN
        UPDATE app_setting SET setting_value = substr(setting_value, 1, 40)
         WHERE setting_key = new.setting_key;
     END"
);

$gekuerzt = avesmapsCurveRebuildCache($pdo);
assert($gekuerzt['ok'] === false,
    'ein still abgeschnittener Zwischenspeicher MUSS als Fehlschlag gemeldet werden');

$pdo->exec('DROP TRIGGER curve_label_baselines_kappen');

echo "curve-label-run tests passed\n";
