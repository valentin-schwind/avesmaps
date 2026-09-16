<?php

declare(strict_types=1);

// Dieselbe echte Schreib-Fixture; nur MySQL-Syntax wird an der Treibernaht übersetzt.
require __DIR__ . '/wege-gruppe-schreiben-test.php';
$pdo->exec('DELETE FROM map_feature_locks');
require_once __DIR__ . '/../../audit-filter.php';
require_once __DIR__ . '/../../audit-detail.php';
$endpoint = file_get_contents(__DIR__ . '/../../../edit/map/audit-log.php');
eval(substr($endpoint, strpos($endpoint, 'function avesmapsListMapAuditLog')));
$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
$pdo->exec("INSERT INTO users VALUES (5, 'Ersteller'), (6, 'Prüfer')");

function gruppeLetzterBeleg(PDO $pdo): int {
    return (int) $pdo->query('SELECT MAX(id) FROM map_audit_log')->fetchColumn();
}

function gruppeErwartetFehler(callable $run): void {
    try {
        $run();
    } catch (InvalidArgumentException | AvesmapsConflictException | PDOException $error) {
        return;
    }
    throw new RuntimeException('Die ungültige Rücknahme wurde nicht abgelehnt.');
}

foreach ([1, 27, 250] as $anzahl) {
    $seed($pdo);
    $pdo->exec('DELETE FROM map_features');
    $insert = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype,
        geometry_type, geometry_json, properties_json, is_active, revision)
        VALUES (?, 'Alter Weg', 'path', 'Weg', 'LineString', ?, ?, 1, 7)");
    $ids = [];
    for ($i = 1; $i <= $anzahl; $i++) {
        $ids[] = sprintf('%08d-1111-4111-8111-111111111111', $i);
        $insert->execute([$ids[$i - 1], json_encode($LINIE), json_encode(['name' => 'Alter Weg', 'feature_type' => 'path'])]);
    }
    $old = $karte($pdo);
    avesmapsUpdatePathGroupDetails($pdo, ['public_ids' => $ids, 'fields' => ['name'], 'name' => 'Neuer Weg'], $user);
    $original = gruppeLetzterBeleg($pdo);
    $saved = $karte($pdo);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
    $list = avesmapsListMapAuditLog($pdo, true, ['Ersteller']);
    assert(count($list['changes']) === 1 && $list['changes'][0]['member_count'] === $anzahl);
    assert(strlen(json_encode($list)) < 3000, 'der Listenabruf liefert keine großen Mitgliedersnapshots');
    assert($list['changes'][0]['focus']['type'] === 'bounds');
    assert(avesmapsListMapAuditLog($pdo, true, ['Prüfer'])['changes'] === []);
    $result = avesmapsUndoAuditChange($pdo, ['audit_id' => $original], ['id' => 6]);
    assert(count($result['features']) === $anzahl && $result['steps'] === $anzahl);
    foreach ($karte($pdo) as $row) {
        assert($row['name'] === 'Alter Weg');
    }
    $undo = gruppeLetzterBeleg($pdo);
    assert((int) $pdo->query('SELECT actor_user_id FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetchColumn() === 6);
    gruppeErwartetFehler(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $original], $user));
    $result = avesmapsUndoAuditChange($pdo, ['audit_id' => $undo], $user);
    foreach ($karte($pdo) as $row) {
        assert($row['name'] === 'Neuer Weg');
    }
    gruppeErwartetFehler(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => gruppeLetzterBeleg($pdo)], $user));
}

// Der letzte Abschnitt hat sich verändert: die ersten dürfen nicht zurückgenommen werden.
$seed($pdo);
avesmapsUpdatePathGroupDetails($pdo, ['public_ids' => $alleDrei, 'fields' => ['name'], 'name' => 'Neuer Weg'], $user);
$audit = gruppeLetzterBeleg($pdo);
$pdo->prepare('UPDATE map_features SET name = ? WHERE public_id = ?')->execute(['Fremder Name', $alleDrei[2]]);
$stand = $karte($pdo);
gruppeErwartetFehler(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $audit], $user));
assert($karte($pdo) === $stand && gruppeLetzterBeleg($pdo) === $audit);
$pdo->prepare('UPDATE map_features SET name = ? WHERE public_id = ?')->execute(['Neuer Weg', $alleDrei[2]]);
$pdo->prepare('INSERT INTO map_feature_locks VALUES (?, 7, ?, ?)')->execute([$alleDrei[2], 'Andere Person', '2099-01-01']);
$stand = $karte($pdo);
gruppeErwartetFehler(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $audit], $user));
assert($karte($pdo) === $stand);
$pdo->exec('DELETE FROM map_feature_locks');

// Eine spätere Geometrieänderung ist unabhängig von den zurückgenommenen Detailspalten.
$geometrie = json_encode(['type' => 'LineString', 'coordinates' => [[40, 50], [60, 70]]]);
$pdo->prepare('UPDATE map_features SET geometry_json = ? WHERE public_id = ?')->execute([$geometrie, $alleDrei[0]]);
avesmapsUndoAuditChange($pdo, ['audit_id' => $audit], $user);
$read = $pdo->prepare('SELECT geometry_json FROM map_features WHERE public_id = ?');
$read->execute([$alleDrei[0]]);
assert($read->fetchColumn() === $geometrie);

// Beschädigte Mitglieder, Versionen und Kennungsmengen werden vor jedem Write abgelehnt.
$seed($pdo);
avesmapsUpdatePathGroupDetails($pdo, ['public_ids' => $alleDrei, 'fields' => ['name'], 'name' => 'Neuer Weg'], $user);
$audit = gruppeLetzterBeleg($pdo);
$originalJson = (string) $pdo->query('SELECT after_json FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetchColumn();
$valid = json_decode($originalJson, true);
$badSnapshots = [];
$bad = $valid; $bad['version'] = 2; $badSnapshots[] = $bad;
$bad = $valid; array_pop($bad['members']); $badSnapshots[] = $bad;
$bad = $valid; $bad['members'][1] = $bad['members'][0]; $badSnapshots[] = $bad;
$bad = $valid; unset($bad['members'][0]['name']); $badSnapshots[] = $bad;
$bad = $valid; $bad['members'][0]['id'] = 999999; $badSnapshots[] = $bad;
$stand = $karte($pdo);
foreach ($badSnapshots as $bad) {
    $pdo->prepare('UPDATE map_audit_log SET after_json = ? WHERE id = ?')->execute([json_encode($bad), $audit]);
    gruppeErwartetFehler(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $audit], $user));
    assert($karte($pdo) === $stand && gruppeLetzterBeleg($pdo) === $audit);
}

// Byteüberschreitung beim Speichern rollt sämtliche Fachänderungen zurück.
$seed($pdo);
$pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')->execute([
    json_encode(['huge' => str_repeat('x', AVESMAPS_MAP_GROUP_AUDIT_MAX_BYTES)]), $alleDrei[2],
]);
$stand = $karte($pdo);
gruppeErwartetFehler(fn() => avesmapsUpdatePathGroupDetails($pdo,
    ['public_ids' => $alleDrei, 'fields' => ['name'], 'name' => 'Zu groß'], $user));
assert($karte($pdo) === $stand && gruppeLetzterBeleg($pdo) === 0);

// Ein Fehler am letzten UPDATE darf auch die ersten Änderungen nicht durchlassen.
$seed($pdo);
avesmapsUpdatePathGroupDetails($pdo, ['public_ids' => $alleDrei, 'fields' => ['name'], 'name' => 'Neuer Weg'], $user);
$audit = gruppeLetzterBeleg($pdo);
$pdo->exec("CREATE TRIGGER gruppe_abbruch BEFORE UPDATE ON map_features WHEN OLD.public_id = '" . $alleDrei[2]
    . "' BEGIN SELECT RAISE(ABORT, 'absichtlicher Testfehler'); END");
$stand = $karte($pdo);
gruppeErwartetFehler(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $audit], $user));
assert($karte($pdo) === $stand && gruppeLetzterBeleg($pdo) === $audit);
$pdo->exec('DROP TRIGGER gruppe_abbruch');

// Belege werden stets vollständig entfernt, und andere Akteure bleiben unter ihrem eigenen Budget.
$seed($pdo);
$insert = $pdo->prepare("INSERT INTO map_audit_log (action, actor_user_id, before_json, after_json) VALUES ('update_path_group_details', ?, ?, '{}')");
for ($i = 0; $i < 25; $i++) {
    $insert->execute([5, str_repeat('x', 400000)]);
}
$insert->execute([6, str_repeat('x', 400000)]);
avesmapsPruneMapGroupAuditBytes($pdo, 5);
assert((int) $pdo->query('SELECT SUM(LENGTH(before_json) + LENGTH(after_json)) FROM map_audit_log WHERE actor_user_id = 5')->fetchColumn() <= AVESMAPS_MAP_GROUP_AUDIT_ACTOR_BYTES);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log WHERE actor_user_id = 6')->fetchColumn() === 1);

// Der globale Riegel greift über mehrere Personen hinweg und löscht die ältesten ganzen Belege.
$seed($pdo);
for ($actor = 1; $actor <= 5; $actor++) {
    for ($i = 0; $i < 20; $i++) {
        $insert->execute([$actor, str_repeat('x', 400000)]);
    }
}
$latest = gruppeLetzterBeleg($pdo);
avesmapsPruneMapGroupAuditBytes($pdo, 5);
assert((int) $pdo->query('SELECT SUM(LENGTH(before_json) + LENGTH(after_json)) FROM map_audit_log')->fetchColumn() <= AVESMAPS_MAP_GROUP_AUDIT_GLOBAL_BYTES);
assert(gruppeLetzterBeleg($pdo) === $latest);

$seed($pdo);
avesmapsUpdatePathGroupDetails($pdo, ['public_ids' => $alleDrei, 'fields' => ['show_label'], 'show_label' => true], $user);
$result = avesmapsUndoAuditChange($pdo, ['audit_id' => gruppeLetzterBeleg($pdo)], $user);
foreach ($result['features'] as $feature) {
    assert(in_array('show_label', $feature['removed_properties'], true));
    assert(!array_key_exists('show_label', $feature['properties']));
}

echo "OK: Wegegruppen speichern, vollständig zurücknehmen, wiederherstellen und begrenzen.\n";

// Die zweistufige Liste behält Zeit-/ID-Reihenfolge, Grenze und Personenfilter.
$pdo->exec('DELETE FROM map_audit_log');
$insert = $pdo->prepare('INSERT INTO map_audit_log (action, actor_user_id, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?)');
$snapshot = json_encode(['version' => 1, 'name' => 'Großes Paket', 'feature_type' => 'path', 'count' => 250,
    'fields' => ['wiki_path_assignment'], 'members' => array_fill(0, 250, ['description' => str_repeat('a', 500)])]);
for ($i = 0; $i < 205; $i++) {
    $insert->execute(['bulk_assign_wiki_path_group', $i % 2 === 0 ? 5 : 6, $snapshot, $snapshot,
        $i % 3 === 0 ? '2026-09-15 10:00:00' : '2026-09-16 10:00:00']);
}
foreach ([[], ['Ersteller'], ['Prüfer']] as $names) {
    $where = $names === [] ? '' : ' WHERE actor_user_id = ' . ($names[0] === 'Ersteller' ? 5 : 6);
    $expected = array_map('intval', $pdo->query('SELECT id FROM map_audit_log' . $where . ' ORDER BY created_at DESC, id DESC LIMIT 200')->fetchAll(PDO::FETCH_COLUMN));
    $list = avesmapsListMapAuditLog($pdo, true, $names);
    assert(array_column($list['changes'], 'id') === $expected);
    assert(strlen(json_encode($list)) < 200000, 'Große Mitgliedersnapshots verlassen die Datenbank nicht.');
}
