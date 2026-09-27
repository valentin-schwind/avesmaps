<?php

declare(strict_types=1);

/**
 * „WikiSync-Fall lösen" wechselt die Ortsgroesse -- und nimmt dabei `properties.innerorts` mit, sobald
 * der Punkt kein Stadtviertel/Bauwerk mehr ist (M2 der Gesamtpruefung zu Innerorts, Schritt 1).
 * Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_pdo_sqlite.dll \
 *       api/_internal/wiki/__tests__/wikisync-fall-innerorts-test.php
 *
 * 🔴 WARUM: `avesmapsWikiSyncUpdateLocationFeature` (api/_internal/wiki/locations-faelle.php) schreibt
 * `feature_subtype` -- ein dritter Schreiber der Ortsgroesse neben update_point und dem Ortseditor. Er
 * kannte die Innerorts-Invariante nicht: ein Bauwerk, das ein Fall zum Dorf machte, behielt seine Stadt,
 * und die Kachel „Von der Karte nehmen" bot dem Dorf eine Geste an, die der Server verweigert.
 *
 * ⚠️ ABLAUF, NICHT BAUER: gefahren wird der Schreibweg selbst an einer SQLite-Karte -- dieselbe Hausform
 * wie api/_internal/wiki/__tests__/wikisync-fall-no-article-test.php.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../locations.php';
require __DIR__ . '/../../map/features.php';

/** Die MySQL-eigenen Anweisungen im Schreibpfad, an der TREIBER-Naht uebersetzt. */
final class AvesmapsWikiSyncFallInnerortsTestPdo extends PDO
{
    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $query = str_replace('FOR UPDATE', '', $query);
        $query = str_replace('NOW(3)', "datetime('now')", $query);

        return parent::prepare($query, $options);
    }

    public function exec(string $statement): int|false
    {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2)
                          ON CONFLICT(id) DO UPDATE SET revision = map_revision.revision + 1';
        }

        return parent::exec($statement);
    }
}

$pdo = new AvesmapsWikiSyncFallInnerortsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('CREATE TABLE map_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT, name TEXT, feature_type TEXT, feature_subtype TEXT,
    geometry_type TEXT, geometry_json TEXT, properties_json TEXT, style_json TEXT,
    is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 1,
    updated_by INTEGER NULL, min_x REAL, min_y REAL, max_x REAL, max_y REAL
)');
$pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
$pdo->exec('CREATE TABLE map_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NULL, action TEXT,
    actor_user_id INTEGER, before_json TEXT, after_json TEXT
)');
$pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');

$seed = static function (PDO $pdo, string $subtype, array $properties): void {
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $pdo->prepare(
        'INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type,
             geometry_json, properties_json, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 7)'
    )->execute([
        'loc-1', 'Hafenturm', 'location', $subtype, 'Point',
        json_encode(['type' => 'Point', 'coordinates' => [12.5, 34.5]]),
        json_encode((object) $properties),
    ]);
};
$props = static function (PDO $pdo): array {
    $decoded = json_decode((string) $pdo->query("SELECT properties_json FROM map_features WHERE public_id = 'loc-1'")->fetchColumn(), true);

    return is_array($decoded) ? $decoded : [];
};
$user = ['id' => 3, 'username' => 'pruefer'];
$pruefungen = 0;

// ── 1) Bauwerk -> Dorf: `innerorts` (samt seiner Herkunft) faellt weg ──────────────────────────
$seed($pdo, 'gebaeude', [
    'name' => 'Hafenturm',
    'innerorts' => ['ort' => 'stadt-gareth'],
    'field_origins' => ['innerorts' => 'manual', 'name' => 'wiki'],
]);
avesmapsWikiSyncUpdateLocationFeature($pdo, [], $user, 'loc-1', 'Hafenturm', 'dorf', '', '', false, false);
$nachDorf = $props($pdo);
assert(!array_key_exists('innerorts', $nachDorf), 'ein Dorf gehoert keiner Stadt an: ' . json_encode($nachDorf));
assert(($nachDorf['field_origins'] ?? null) === ['name' => 'wiki'], 'nur die Herkunft von innerorts faellt, fremde bleiben: ' . json_encode($nachDorf));
$zeile = $pdo->query("SELECT feature_subtype FROM map_features WHERE public_id = 'loc-1'")->fetchColumn();
assert($zeile === 'dorf', 'die Ortsgroesse wurde geschrieben');
$pruefungen += 3;

// ── 2) Bauwerk -> Stadtviertel: bleibt Innerorts-Klasse, `innerorts` bleibt stehen ────────────────
$seed($pdo, 'gebaeude', ['name' => 'Hafenturm', 'innerorts' => ['ort' => 'stadt-gareth']]);
avesmapsWikiSyncUpdateLocationFeature($pdo, [], $user, 'loc-1', 'Hafenturm', 'stadtviertel', '', '', false, false);
assert(($props($pdo)['innerorts'] ?? null) === ['ort' => 'stadt-gareth'], 'zwischen den zwei Innerorts-Klassen bleibt die Stadt');
$pruefungen++;

// ── 3) Der Merker `von_der_karte` gehoert zum Feld und faellt mit (ein aktiver Punkt traegt ihn nie,
// aber die Regel ist dieselbe wie in update_point: das GANZE Feld) ──────────────────────────────────
$seed($pdo, 'stadtviertel', ['name' => 'Hafenturm', 'innerorts' => ['ort' => 'stadt-gareth']]);
avesmapsWikiSyncUpdateLocationFeature($pdo, [], $user, 'loc-1', 'Hafenturm', 'kleinstadt', '', '', false, false);
assert(!array_key_exists('innerorts', $props($pdo)), 'Stadtviertel -> Kleinstadt: das Feld faellt');
$pruefungen++;

echo "wikisync-fall-innerorts: alle {$pruefungen} Zusicherungen gruen\n";
