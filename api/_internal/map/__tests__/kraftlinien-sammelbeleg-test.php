<?php

declare(strict_types=1);

require __DIR__ . '/wege-gruppe-schreiben-test.php';
$pdo->exec('DELETE FROM map_feature_locks');
$pdo->exec('ALTER TABLE map_features ADD COLUMN created_by INTEGER');
$pdo->exec("CREATE TABLE feature_sources (id INTEGER PRIMARY KEY, entity_type TEXT, entity_public_id TEXT, source_id INTEGER, status TEXT, note TEXT)");

$pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY, url TEXT, label TEXT, source_type TEXT, is_official INTEGER, license TEXT, attribution TEXT)');
$pdo->exec('CREATE TABLE source_corpus (corpus_key TEXT PRIMARY KEY, label TEXT, form TEXT, source_type TEXT, license TEXT, attribution TEXT, is_official INTEGER)');
$pdo->exec("INSERT INTO sources VALUES (7, 'https://example.org/beleg', 'Beleg', 'briefspiel', 0, 'cc-by', 'Autor'), (8, '', 'Andere Quelle', 'sonstiges', 0, '', '')");

function kraftId(int $id): string {
    return sprintf('%08d-1111-4111-8111-111111111111', $id);
}
function kraftFehler(callable $run): void {
    try { $run(); } catch (InvalidArgumentException | AvesmapsConflictException | PDOException $error) { return; }
    throw new RuntimeException('Ungültige Aktion wurde nicht abgelehnt.');
}
function kraftSeed(PDO $pdo, int $count, bool $nodes = false): void {
    foreach (['map_features', 'map_feature_locks', 'map_audit_log', 'map_revision', 'feature_sources'] as $table) {
        $pdo->exec('DELETE FROM ' . $table);
    }
    $insert = $pdo->prepare('INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json, is_active, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 7)');
    if ($nodes) {
        for ($i = 1; $i <= $count + 1; $i++) {
            $insert->execute([kraftId(1000 + $i), 'Nodix', 'location', 'dorf', 'Point', json_encode(['type' => 'Point', 'coordinates' => [$i, 5]]), '{"is_nodix":true}']);
        }
    }
    for ($i = 1; $i <= $count; $i++) {
        $properties = ['name' => 'Linie A', 'feature_type' => 'powerline', 'curve' => $i % 30];
        if ($nodes) {
            $properties += ['from_public_id' => kraftId(1000 + $i), 'to_public_id' => kraftId(1001 + $i)];
        }
        $insert->execute([kraftId($i), 'Linie A', 'powerline', 'powerline', 'LineString',
            json_encode(['type' => 'LineString', 'coordinates' => [[$i, 5], [$i + 1, 5]]]), json_encode($properties)]);
    }
}
$last = static fn() => (int) $pdo->query('SELECT MAX(id) FROM map_audit_log')->fetchColumn();
$state = static fn() => $pdo->query("SELECT public_id, name, properties_json, geometry_json, is_active FROM map_features WHERE feature_type = 'powerline' ORDER BY public_id")->fetchAll(PDO::FETCH_ASSOC);
$edit = ['current_name' => 'Linie A', 'new_name' => 'Linie B', 'description' => 'Neue Beschreibung', 'show_label' => true, 'curve' => 12];
foreach ([1, 27, 250] as $count) {
    kraftSeed($pdo, $count);
    $before = $state();
    avesmapsUpdatePowerlineLine($pdo, $edit, $user);
    $saved = $state();
    assert(json_decode($saved[0]['properties_json'], true)['curve'] === 12);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
    assert(json_decode($pdo->query('SELECT after_json FROM map_audit_log')->fetchColumn(), true)['count'] === $count);
    $undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
    assert($undo['feature_type'] === 'powerline' && count($undo['features']) === $count);
    foreach ($state() as $index => $row) {
        assert($row['name'] === $before[$index]['name']);
        assert(json_decode($row['properties_json'], true) === json_decode($before[$index]['properties_json'], true));
    }
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], $user);
    foreach ($state() as $index => $row) {
        assert(json_decode($row['properties_json'], true) === json_decode($saved[$index]['properties_json'], true));
    }
}
// Umbenennen verschmilzt beide Namen; Undo muss beide ursprünglichen Namen wiederherstellen.
kraftSeed($pdo, 3);
$pdo->exec("UPDATE map_features SET name = 'Linie B' WHERE public_id = '" . kraftId(3) . "'");
avesmapsUpdatePowerlineLine($pdo, $edit, $user);
avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], $user);
assert($state()[2]['name'] === 'Linie B' && $state()[0]['name'] === 'Linie A');

// Unveränderte Reihenfolge behält den Antwortvertrag und erzeugt keinen Beleg.
kraftSeed($pdo, 3, true);
$noop = avesmapsReorderPowerlineLine($pdo, ['current_name' => 'Linie A',
    'ordered_public_ids' => [kraftId(1001), kraftId(1002), kraftId(1003), kraftId(1004)]], $user);
assert($noop['anchor'] === kraftId(1) && $noop['created'] === 0 && $noop['removed'] === 0);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);

// Umordnung: alter Quellenanker entfällt, zwei neue Kanten entstehen, eine bleibt erhalten.
kraftSeed($pdo, 3, true);
$pdo->exec("INSERT INTO feature_sources VALUES (1, 'powerline', '" . kraftId(1) . "', 7, 'approved', 'Belegstelle')");
$before = $state();
$order = ['current_name' => 'Linie A', 'ordered_public_ids' => [kraftId(1001), kraftId(1003), kraftId(1002), kraftId(1004)]];
$result = avesmapsReorderPowerlineLine($pdo, $order, $user);
assert($result['created'] === 2 && $result['removed'] === 2);
assert((int) $pdo->query("SELECT COUNT(*) FROM map_features WHERE feature_type = 'powerline' AND is_active = 1")->fetchColumn() === 3);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
assert($pdo->query('SELECT entity_public_id FROM feature_sources')->fetchColumn() === kraftId(2));
$saved = $state();
$original = $last();
$undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $original], ['id' => 6]);
assert(count($undo['features']) === 5);
assert($undo['source_payload']['by_entity'][kraftId(1)][0]['source_id'] === 7);
assert($undo['source_payload']['by_entity'][kraftId(1)][0]['note'] === 'Belegstelle');
assert($undo['source_payload']['by_entity'][kraftId(2)] === []);
assert($undo['source_payload']['sources'][0]['license'] === 'cc-by');
assert($pdo->query('SELECT entity_public_id FROM feature_sources')->fetchColumn() === kraftId(1));
foreach ($state() as $row) {
    $wasPresent = in_array($row['public_id'], array_column($before, 'public_id'), true);
    assert((int) $row['is_active'] === ($wasPresent ? 1 : 0));
}
avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], $user);
assert($pdo->query('SELECT entity_public_id FROM feature_sources')->fetchColumn() === kraftId(2));
foreach ($state() as $index => $row) {
    assert((int) $row['is_active'] === (int) $saved[$index]['is_active']);
    assert(json_decode($row['geometry_json'], true) === json_decode($saved[$index]['geometry_json'], true));
}

kraftSeed($pdo, 3, true);
$pdo->exec("INSERT INTO feature_sources VALUES (1, 'powerline', '" . kraftId(1) . "', 7, 'approved', 'A'), (2, 'powerline', '" . kraftId(2) . "', 8, 'approved', 'B')");
avesmapsReorderPowerlineLine($pdo, $order, $user);
$undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], $user);
assert(array_column($undo['source_payload']['by_entity'][kraftId(1)], 'source_id') === [7]);
assert(array_column($undo['source_payload']['by_entity'][kraftId(2)], 'source_id') === [8]);

// Spätere Quelle oder Nodix-Bewegung verhindert jede Teilrücknahme.
foreach (['source', 'node', 'nodix', 'lock'] as $conflict) {
    kraftSeed($pdo, 3, true);
    avesmapsReorderPowerlineLine($pdo, $order, $user);
    if ($conflict === 'source') {
        $pdo->exec("INSERT INTO feature_sources VALUES (1, 'powerline', '" . kraftId(2) . "', 8, 'approved', 'Später')");
    } elseif ($conflict === 'node') {
        $pdo->exec("UPDATE map_features SET geometry_json = '{\"type\":\"Point\",\"coordinates\":[99,99]}' WHERE public_id = '" . kraftId(1004) . "'");
    } elseif ($conflict === 'nodix') {
        $pdo->exec("UPDATE map_features SET properties_json = '{}' WHERE public_id = '" . kraftId(1004) . "'");
    } else {
        $pdo->exec("INSERT INTO map_feature_locks VALUES ('" . kraftId(3) . "', 6, 'Andere Person', '2999-01-01')");
    }
    $blocked = $state();
    kraftFehler(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], $user));
    assert($state() === $blocked);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
}
kraftSeed($pdo, 251);
$before = $state();
kraftFehler(fn() => avesmapsUpdatePowerlineLine($pdo, $edit, $user));
assert($state() === $before && $last() === 0);
echo "OK: Kraftlinien-Sammelbelege einschließlich Umordnung, Quellen, Undo/Redo und Konflikten.\n";
