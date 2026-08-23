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

// ============================================================ C. Fingerabdruck-Kopplung, ECHT durch die DB
//
// 💣 Befund 8 der Zweigpruefung: der Bauer (avesmapsCurveRebuildCache) und der Leser
// (avesmapsCurveReadBaselines) muessen DENSELBEN Fingerabdruck (Revisionssumme UND Flaechenzahl)
// bilden. Getrennt getestet (wie in curve-label-store-test.php) liesse genau die Naht ungeprueft,
// an der sie auseinanderlaufen -- deshalb hier einmal frisch bauen (nach dem Kuerzungs-Trigger von
// Block B) und mit der ECHTEN SQL-Aggregatabfrage des Lesers zurueckholen.
$frisch = avesmapsCurveRebuildCache($pdo);
assert($frisch['ok'] === true, 'der frische Lauf nach Block B muss wieder gelingen');

$baselines = avesmapsCurveReadBaselines($pdo);
assert(array_key_exists('r1', $baselines),
    'der ECHTE Leser muss die gerade gebaute Kurve wiederfinden -- Bauer und Leser bilden denselben Fingerabdruck');
assert(count($baselines['r1']['line']) === 32);
assert($baselines['r1']['max_labels'] === 1);

// ============================================================ D. Befund 8: eine stillgelegte Flaeche
// veraltet die Kurve, auch wenn die Summe zufaellig gleich bleibt
//
// Region 'y' bekommt drei Flaechen: A (Revision 1), B (Revision 1) und eine dritte, UNBERUEHRTE
// Flaeche C (Revision 0) -- Summe 2, drei Flaechen. SUM(geometry_revision) ALLEIN bleibt nach dem
// Stilllegen von C bei 2 (die 0 traegt nichts zur Summe bei), obwohl die Flaeche verschwunden ist --
// genau die Kollision aus dem Befund ("eine Flaeche mit Revision 3 stilllegen und eine andere
// dreimal bearbeiten ergibt dieselbe Summe").
$pdo->exec(
    "INSERT INTO ecosystem_region (id, public_id, properties_json, is_active)
     VALUES (2, 'y', '{\"curve_label\":true,\"curve_label_max\":1}', 1)"
);
$dreieckA = (string) json_encode(['type' => 'Polygon', 'coordinates' => [[
    [0.0, 0.0], [30.0, 0.0], [30.0, 20.0], [0.0, 20.0], [0.0, 0.0],
]]]);
$dreieckB = (string) json_encode(['type' => 'Polygon', 'coordinates' => [[
    [50.0, 0.0], [80.0, 0.0], [80.0, 20.0], [50.0, 20.0], [50.0, 0.0],
]]]);
$dreieckC = (string) json_encode(['type' => 'Polygon', 'coordinates' => [[
    [100.0, 0.0], [130.0, 0.0], [130.0, 20.0], [100.0, 20.0], [100.0, 0.0],
]]]);
$stmtY = $pdo->prepare(
    'INSERT INTO ecosystem_area (id, region_id, geometry_geojson, geometry_revision, is_active)
     VALUES (:id, 2, :geom, :rev, 1)'
);
$stmtY->execute(['id' => 2, 'geom' => $dreieckA, 'rev' => 1]);
$stmtY->execute(['id' => 3, 'geom' => $dreieckB, 'rev' => 1]);
$stmtY->execute(['id' => 4, 'geom' => $dreieckC, 'rev' => 0]);

$mitDreiFlaechen = avesmapsCurveRebuildCache($pdo);
assert($mitDreiFlaechen['ok'] === true);
assert($mitDreiFlaechen['regions'] === 2, 'jetzt sind beide Regionen (r1, y) eingeschaltet und in der Ablage');

$vorher = avesmapsCurveReadBaselines($pdo);
assert(array_key_exists('y', $vorher), 'Region y muss mit drei aktiven Flaechen eine Kurve haben');

// Die dritte, unberuehrte Flaeche (Revision 0) wird stillgelegt -- die reine Summe bleibt bei 2, nur
// die Flaechenzahl faellt von 3 auf 2. Der Sammellauf wird NICHT wiederholt (das ist der Punkt: der
// Zwischenspeicher ist jetzt veraltet, und niemand hat das gemeldet).
$pdo->exec('UPDATE ecosystem_area SET is_active = 0 WHERE id = 4');

$nachher = avesmapsCurveReadBaselines($pdo);
assert(!array_key_exists('y', $nachher),
    'Befund 8: eine stillgelegte Flaeche muss die Kurve veralten lassen, auch wenn SUM(geometry_revision) unveraendert bleibt');

// ============================================================ E. Befund 9: die teure Aggregatabfrage
// darf nicht laufen, solange der Zwischenspeicher leer ist
//
// 💣 Der Grund fuer die Sonde statt einer reinen Rueckgabepruefung: BEIDE Reihenfolgen liefern []
// zurueck, wenn die Aggregatabfrage gegen eine fehlende Tabelle laeuft (ihr Fehler wird
// abgefangen) -- nur ein Zaehler am PDO selbst zeigt, ob sie ueberhaupt GESTARTET wurde.
final class AvesmapsCurveReadOrderSpyPdo extends PDO
{
    public int $aggregateQueries = 0;

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false
    {
        if (str_contains($query, 'FROM ecosystem_region')) {
            $this->aggregateQueries++;
        }
        return parent::query($query, $fetchMode, ...$fetchModeArgs);
    }
}

$spyPdo = new AvesmapsCurveReadOrderSpyPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$spyPdo->exec('CREATE TABLE app_setting (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)');
// KEINE ecosystem_region/ecosystem_area Tabelle -- liefe die Aggregatabfrage doch, wuerfe sie eine
// Ausnahme (die avesmapsCurveReadBaselines abfaengt); der Zaehler haette trotzdem angeschlagen.

$leer = avesmapsCurveReadBaselines($spyPdo);
assert($leer === [], 'ohne Zwischenspeicher muss der Leser leer zurueckgeben');
assert($spyPdo->aggregateQueries === 0,
    'Befund 9: die teure Aggregatabfrage darf NIE laufen, solange der Zwischenspeicher leer ist');

$spyPdo->exec(
    "INSERT INTO app_setting (setting_key, setting_value) VALUES ('curve_label_baselines', '{\"version\":1,\"regions\":{}}')"
);
avesmapsCurveReadBaselines($spyPdo);
assert($spyPdo->aggregateQueries === 1,
    'sobald der Zwischenspeicher etwas enthaelt, MUSS die Aggregatabfrage laufen');

// ---- AUSGESCHALTET HEISST: KEINE KURVE -----------------------------------------------------------
// 💣 Am 23.08.2026 im Browser des Owners gemessen: „Kurvenbeschriftung aus" hielt nur bis zum
// naechsten Neuladen und war dann wieder da. Der Lesepfad prueft den Fingerabdruck des
// Zwischenspeichers (Revisionssumme + Flaechenzahl), aber NICHT, ob die Region ihre Kurve
// ueberhaupt noch will. Die Ablage darf ruhig noch eine halten -- der Sammellauf raeumt sie
// spaeter weg; bis dahin entscheidet die EINSTELLUNG.
$vorherAn = avesmapsCurveReadBaselines($pdo);
assert(isset($vorherAn['r1']), 'Vorbedingung: eingeschaltet liefert der Lesepfad eine Kurve');

$pdo->exec("UPDATE ecosystem_region SET properties_json = '{\"curve_label_max\":1}' WHERE public_id = 'r1'");
assert(avesmapsCurveReadBaselines($pdo) === [],
    'ausgeschaltet darf der Lesepfad KEINE Kurve mehr liefern -- sonst kommt sie beim Neuladen zurueck');

// ⭐ Und die ANZAHL kommt aus der EINSTELLUNG, nicht aus der Ablage: ein geaendertes „Max. Namen"
// wirkt damit schon beim naechsten Laden, ohne dass jemand den Sammellauf fahren muss. Die KURVE
// selbst braucht ihn weiterhin -- sie wird gerechnet, die Anzahl nur gelesen.
$pdo->exec("UPDATE ecosystem_region SET properties_json = '{\"curve_label\":true,\"curve_label_max\":3}' WHERE public_id = 'r1'");
$nachher = avesmapsCurveReadBaselines($pdo);
assert(isset($nachher['r1']), 'wieder eingeschaltet muss die Kurve zurueckkommen');
assert($nachher['r1']['max_labels'] === 3, 'die Anzahl muss aus der Einstellung kommen, nicht aus der Ablage');

echo "curve-label-run tests passed\n";
