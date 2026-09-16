<?php

declare(strict_types=1);

// Fall #132: echter Schreibweg mit Quellen, Bach-Merkmal und Ruecknahme.
if (ini_get('zend.assertions') !== '1') {
    throw new RuntimeException('zend.assertions=1 ist erforderlich.');
}
require __DIR__ . '/../../bootstrap.php';
require __DIR__ . '/../features.php';
require __DIR__ . '/../path-split.php';

final class PathSplitTestPdo extends PDO {
    public function prepare(string $query, array $options = []): PDOStatement|false {
        $query = str_replace(['FOR UPDATE', 'NOW(3)', 'CURRENT_TIMESTAMP(3)'], ['', 'CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP'], $query);
        return parent::prepare($query, $options);
    }

    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false {
        if (str_starts_with($query, 'SHOW COLUMNS FROM ')) {
            $query = "SELECT name AS Field FROM pragma_table_info('map_audit_log')";
        }
        return parent::query($query, $fetchMode, ...$fetchModeArgs);
    }

    public function exec(string $statement): int|false {
        if (str_contains($statement, 'ON DUPLICATE KEY UPDATE revision = revision + 1')) {
            $statement = 'INSERT INTO map_revision (id, revision) VALUES (1, 2) ON CONFLICT(id) DO UPDATE SET revision = revision + 1';
        }
        return parent::exec($statement);
    }
}

function splitFixture(string $subtype = 'Flussweg'): array {
    $pdo = new PathSplitTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE map_features (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT UNIQUE,
        name TEXT, feature_type TEXT, feature_subtype TEXT, geometry_type TEXT, geometry_json TEXT,
        properties_json TEXT, style_json TEXT, is_active INTEGER DEFAULT 1, revision INTEGER,
        sort_order INTEGER DEFAULT 1, created_by INTEGER, updated_by INTEGER, min_x REAL, min_y REAL, max_x REAL, max_y REAL)');
    $pdo->exec('CREATE TABLE map_revision (id INTEGER PRIMARY KEY, revision INTEGER)');
    $pdo->exec('CREATE TABLE map_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER,
        action TEXT, actor_user_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        undone_at TEXT, undone_by INTEGER, undo_audit_id INTEGER)');
    $pdo->exec('CREATE TABLE map_feature_locks (public_id TEXT PRIMARY KEY, user_id INTEGER, username TEXT, locked_until TEXT)');
    avesmapsEnsureFeatureSourceTablesSqlite($pdo);
    $id = '11111111-1111-4111-8111-111111111111';
    $properties = ['name' => 'Testweg', 'feature_type' => 'path', 'feature_subtype' => $subtype,
        'description' => 'Beschreibung', 'show_label' => true, 'allowed_transports' => ['groupFoot'],
        'wiki_path' => ['wiki_key' => 'wiki:testweg', 'article_origin' => 'manual'],
        'transport_seasons' => ['groupFoot' => ['from' => 2, 'to' => 4]],
        'field_origins' => ['feature_subtype' => 'manual']];
    if ($subtype === 'Flussweg') {
        $properties['is_bach'] = true;
        $properties['flow'] = ['dir' => 'reverse', 'factor' => 3.2, 'source' => 'editor'];
    }
    $geometry = ['type' => 'LineString', 'coordinates' => [[10, 20], [15, 27], [30, 40], [50, 60]]];
    $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json, style_json, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute([$id, 'Testweg', 'path', $subtype, 'LineString', json_encode($geometry), json_encode($properties), '{"color":"red"}', 7]);
    foreach (['manual', 'community', 'wiki_publication'] as $index => $origin) {
        $pdo->prepare('INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, origin, reference_kind, pages, note, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')->execute(['path', $id, $index + 1, $index === 1 ? 'suppressed' : 'approved', $origin, 'erwaehnung', '42', 'Notiz', 9, '2026-09-01']);
    }
    return [$pdo, ['public_id' => $id, 'node_index' => 1, 'expected_revision' => 7, 'expected_coordinates' => $geometry['coordinates']], $properties, $geometry];
}

$user = ['id' => 5, 'username' => 'Pruefer'];
foreach (['Flussweg', 'Straße'] as $subtype) {
    [$pdo, $payload, $properties, $geometry] = splitFixture($subtype);
    $result = avesmapsSplitPathFeature($pdo, $payload, $user);
    assert(count($result['paths']) === 2);
    assert($result['crossing']['lat'] === 27.0 && $result['crossing']['lng'] === 15.0);
    assert($result['paths'][0]['geometry']['coordinates'] === array_slice($geometry['coordinates'], 0, 2));
    assert($result['paths'][1]['geometry']['coordinates'] === array_slice($geometry['coordinates'], 1));
    foreach ($result['paths'] as $path) {
        $row = $pdo->query("SELECT * FROM map_features WHERE public_id = '" . $path['id'] . "'")->fetch();
        assert(json_decode($row['properties_json'], true) === $properties, 'Alle Eigenschaften bleiben erhalten, insbesondere Bach und Stroemung.');
        assert($row['style_json'] === '{"color":"red"}');
        $sources = $pdo->query("SELECT source_id, status, origin, reference_kind, pages, note, created_by, created_at FROM feature_sources WHERE entity_public_id = '" . $path['id'] . "' ORDER BY source_id")->fetchAll();
        $originalSources = $pdo->query("SELECT source_id, status, origin, reference_kind, pages, note, created_by, created_at FROM feature_sources WHERE entity_public_id = '" . $payload['public_id'] . "' ORDER BY source_id")->fetchAll();
        assert($sources === $originalSources, 'Quellen samt Herkunft und Grabstein an beiden Abschnitten.');
    }
    assert((int) $pdo->query('SELECT is_active FROM map_features WHERE id = 1')->fetchColumn() === 0);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 4);
    // Bestehende Einzel-Ruecknahme in umgekehrter Reihenfolge bis zum Original.
    $auditIds = $pdo->query('SELECT id FROM map_audit_log ORDER BY id DESC')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($auditIds as $auditId) {
        avesmapsUndoAuditChange($pdo, ['audit_id' => (int) $auditId], $user);
    }
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_features WHERE is_active = 1')->fetchColumn() === 1);
    assert((int) $pdo->query('SELECT is_active FROM map_features WHERE id = 1')->fetchColumn() === 1);
    assert((int) $pdo->query("SELECT COUNT(*) FROM feature_sources WHERE entity_public_id = '" . $payload['public_id'] . "'")->fetchColumn() === 3);
}

foreach (['stale', 'endpoint', 'fraction', 'missing_revision', 'empty_revision', 'unsaved', 'closed_half', 'wrong_type', 'locked', 'source_failure'] as $case) {
    [$pdo, $payload] = splitFixture();
    if ($case === 'stale') { $payload['expected_revision'] = 6; }
    if ($case === 'endpoint') { $payload['node_index'] = 0; }
    if ($case === 'fraction') { $payload['node_index'] = 1.5; }
    if ($case === 'missing_revision') { unset($payload['expected_revision']); }
    if ($case === 'empty_revision') { $payload['expected_revision'] = ''; }
    if ($case === 'unsaved') { $payload['expected_coordinates'][1] = [11, 21]; }
    if ($case === 'closed_half') {
        $payload['expected_coordinates'] = [[10, 20], [15, 27], [10, 20], [50, 60]];
        $payload['node_index'] = 2;
        $pdo->prepare('UPDATE map_features SET geometry_json = ?')->execute([json_encode(['type' => 'LineString', 'coordinates' => $payload['expected_coordinates']])]);
    }
    if ($case === 'wrong_type') { $pdo->exec("UPDATE map_features SET feature_type = 'powerline'"); }
    if ($case === 'locked') {
        $pdo->prepare('INSERT INTO map_feature_locks VALUES (?, 99, ?, ?)')->execute([$payload['public_id'], 'Andere Person', '2099-01-01']);
    }
    if ($case === 'source_failure') {
        $pdo->exec("CREATE TRIGGER source_failure BEFORE INSERT ON feature_sources BEGIN SELECT RAISE(ABORT, 'Testfehler'); END");
    }
    try {
        avesmapsSplitPathFeature($pdo, $payload, $user);
        throw new LogicException('Erwarteter Fehler fehlt: ' . $case);
    } catch (InvalidArgumentException | AvesmapsConflictException | PDOException $error) {
        assert(!$pdo->inTransaction());
        assert((int) $pdo->query('SELECT COUNT(*) FROM map_features')->fetchColumn() === 1, $case);
        assert((int) $pdo->query('SELECT is_active FROM map_features')->fetchColumn() === 1, $case);
        assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0, $case);
        assert((int) $pdo->query('SELECT COUNT(*) FROM map_revision')->fetchColumn() === 0, $case);
        assert((int) $pdo->query('SELECT COUNT(*) FROM feature_sources')->fetchColumn() === 3, $case);
    }
}
echo "OK: Wege teilen, Quellen, Bach, Eigenschaften, Audit und atomare Fehlerfaelle\n";
