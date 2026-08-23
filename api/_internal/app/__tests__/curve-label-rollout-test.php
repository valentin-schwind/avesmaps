<?php
// api/_internal/app/__tests__/curve-label-rollout-test.php
declare(strict_types=1);

/**
 * DER EINMALIGE UMSTELLLAUF (Entwurf §8.2) -- gegen SQLite gefahren.
 *
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll
 *       -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/curve-label-rollout-test.php
 *
 * 💣 DER GRUND, WARUM ES DIESEN TEST GIBT: avesmapsCurveLabelRolloutFor stand fertig und mit zwoelf
 * Zusicherungen belegt in curve-label-store.php -- und wurde von NICHTS aufgerufen. Am 23.08.2026
 * trug deshalb genau EINE Flaeche der Karte eine Kurve, waehrend 56 sie haetten tragen sollen. Ein
 * gruener Test beweist nichts ohne Verdrahtung; dieser hier faehrt den Lauf wirklich.
 *
 * ⚠️ ZUR SQLITE-UEBERSETZUNG: avesmapsEcosystemReadLabelRegionMap sucht die Zeiger per LIKE, und das
 * Muster maskiert die Anfuehrungszeichen in MySQL-Syntax. SQLite liest die Maskierung woertlich und
 * faende nie etwas. Uebersetzt wird deshalb HIER, im Testwirt -- NICHT in der Produktionsabfrage.
 * Wer die Produktionsform verbiegt, damit ein Test laeuft, hat den Test gegen die Produktion
 * gedreht (AGENTS.md §9, Fall MySQL-1093).
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, 'FATAL: zend.assertions ist nicht 1.' . PHP_EOL);
    exit(2);
}

require_once __DIR__ . '/../app-setting.php';
require_once __DIR__ . '/../curve-label-store.php';

final class AvesmapsCurveRolloutTestPdo extends PDO
{
    public function exec($statement): int|false
    {
        if (str_contains((string) $statement, 'CREATE TABLE IF NOT EXISTS app_setting')) {
            return parent::exec(
                'CREATE TABLE IF NOT EXISTS app_setting (
                    setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at TEXT)'
            );
        }
        return parent::exec($statement);
    }

    public function query($query, $fetchMode = null, ...$args): PDOStatement|false
    {
        // Siehe Kopf: die MySQL-Maskierung in ein SQLite-taugliches Muster uebersetzen.
        $maskiert = chr(92) . '"ecosystem_region_public_id' . chr(92) . '"';
        return parent::query(str_replace($maskiert, '"ecosystem_region_public_id"', (string) $query));
    }

    public function prepare($query, $options = []): PDOStatement|false
    {
        return parent::prepare(str_replace(
            'ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            'ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value',
            (string) $query
        ), $options);
    }
}

$pdo = new AvesmapsCurveRolloutTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT NOT NULL,
            label_public_id TEXT NULL, kind TEXT NULL, properties_json TEXT NULL, is_active INTEGER NOT NULL DEFAULT 1)');
$pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY, public_id TEXT NOT NULL,
            feature_type TEXT NOT NULL, properties_json TEXT NULL, is_active INTEGER NOT NULL DEFAULT 1)');
avesmapsAppSettingEnsureTable($pdo);

$label = static function (string $id, string $regionId, ?int $rotation) use ($pdo): void {
    $props = ['ecosystem_region_public_id' => $regionId];
    if ($rotation !== null) {
        $props['rotation'] = $rotation;
    }
    $pdo->prepare('INSERT INTO map_features (public_id, feature_type, properties_json, is_active)
                   VALUES (?, ' . "'label'" . ', ?, 1)')->execute([$id, json_encode($props)]);
};
$region = static function (string $id) use ($pdo): void {
    $pdo->prepare('INSERT INTO ecosystem_region (public_id, kind, properties_json, is_active)
                   VALUES (?, ?, NULL, 1)')->execute([$id, 'topographie']);
};

// r-dreh: ein gedrehtes Label   -> Kurve AN, Anzahl 1
// r-null: ein ungedrehtes       -> unveraendert
// r-360 : "Weiden", 360 Grad    -> unveraendert (die Modulo-Falle)
// r-zwei: zwei gedrehte Labels  -> Kurve AN, Anzahl 2
// r-aus : gedreht, spaeter vom Editor abgeschaltet -> darf NICHT zurueckgeholt werden
$region('r-dreh'); $label('l1', 'r-dreh', 326);
$region('r-null'); $label('l2', 'r-null', 0);
$region('r-360');  $label('l3', 'r-360', 360);
$region('r-zwei'); $label('l4', 'r-zwei', 317); $label('l5', 'r-zwei', 325);
$region('r-aus');  $label('l6', 'r-aus', 300);
// r-misch: ein gedrehtes Label UND eines ganz OHNE rotation-Schluessel.
// 💣 Das zweite zaehlt zur ANZAHL mit (Entwurf §8.2: "so viele Labels wie vorhanden"), nur nicht zur
// Entscheidung "gedreht". Wer es ueberspringt, weil es keinen Winkel traegt, gibt der Region eine 1
// statt einer 2 -- und sie verliert beim Zeichnen einen ihrer beiden Namen.
$region('r-misch'); $label('l7', 'r-misch', 300); $label('l8', 'r-misch', null);

$ergebnis = avesmapsCurveRolloutFromRotations($pdo);
assert($ergebnis['ran'] === true, 'der Lauf muss beim ersten Mal laufen');
assert($ergebnis['changed'] === 4, 'vier Regionen sind gedreht, nicht ' . $ergebnis['changed']);

$lies = static function (string $id) use ($pdo): array {
    $st = $pdo->prepare('SELECT properties_json FROM ecosystem_region WHERE public_id = ?');
    $st->execute([$id]);
    return avesmapsCurveLabelSettingsFromProperties(json_decode((string) $st->fetchColumn(), true) ?: null);
};

assert($lies('r-dreh') === ['enabled' => true, 'max_labels' => 1], 'ein gedrehtes Label bekommt die Kurve');
assert($lies('r-null') === ['enabled' => false, 'max_labels' => 1], 'Rotation 0 bleibt unveraendert');
// 💣 360 Grad ist sichtbar identisch mit 0 und numerisch verschieden -- roh geprueft schaltete die
// Regel hier eine Kurve ein, wo niemand etwas gedreht haben wollte (Weiden, Entwurf §8.2).
assert($lies('r-360') === ['enabled' => false, 'max_labels' => 1], '360 Grad darf KEINE Kurve ausloesen');
assert($lies('r-zwei') === ['enabled' => true, 'max_labels' => 2], 'zwei Labels ergeben Anzahl 2');
assert($lies('r-misch') === ['enabled' => true, 'max_labels' => 2],
    'ein Label OHNE rotation-Schluessel zaehlt zur Anzahl mit -- sonst verliert die Region einen Namen');

// ---- EINMALIGKEIT -------------------------------------------------------------------------------
$felder = avesmapsCurveLabelApplyToProperties('{"curve_label":true,"curve_label_max":1}', false, null);
$pdo->prepare('UPDATE ecosystem_region SET properties_json = ? WHERE public_id = ?')
    ->execute([$felder['properties_json'], 'r-aus']);
assert($lies('r-aus')['enabled'] === false);

$zweiter = avesmapsCurveRolloutFromRotations($pdo);
assert($zweiter['ran'] === false && $zweiter['reason'] === 'already', 'der zweite Lauf muss sich zurueckhalten');
// 💣 DIE TRAGENDE ZUSICHERUNG. Aus entfernt den Schluessel, ist also von nie-entschieden nicht zu
// unterscheiden -- ohne den Merker holte jeder weitere Lauf jede Abschaltung lautlos zurueck.
assert($lies('r-aus')['enabled'] === false, 'eine Abschaltung darf NICHT zurueckgeholt werden');

// ---- Der Notausgang schaltet nur EIN, nie aus ----------------------------------------------------
$erzwungen = avesmapsCurveRolloutFromRotations($pdo, true);
assert($erzwungen['ran'] === true, 'force_rollout muss laufen');
assert($lies('r-null')['enabled'] === false, 'auch erzwungen bleibt ein ungedrehtes Label ohne Kurve');
assert($lies('r-dreh')['enabled'] === true);

// ---- VERDRAHTUNG --------------------------------------------------------------------------------
// 💣 Der Grund fuer diesen Test in einem Satz: die Regel war da, der Aufrufer nicht.
$endpunkt = file_get_contents(__DIR__ . '/../../../edit/map/curve-labels-run.php');
assert(str_contains($endpunkt, 'avesmapsCurveRolloutFromRotations('), 'der Umstelllauf ist nicht verdrahtet');
$posRollout = strpos($endpunkt, 'avesmapsCurveRolloutFromRotations(');
$posRebuild = strpos($endpunkt, 'avesmapsCurveRebuildCache(');
assert($posRollout !== false && $posRebuild !== false);
assert($posRollout < $posRebuild,
    'der Umstelllauf muss VOR der Rechnung stehen -- er entscheidet, welche Regionen eine Kurve bekommen');

echo 'curve-label-rollout tests passed' . PHP_EOL;
