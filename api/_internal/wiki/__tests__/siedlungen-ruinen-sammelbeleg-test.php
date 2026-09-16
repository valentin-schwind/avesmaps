<?php

declare(strict_types=1);

require __DIR__ . '/siedlungen-gebiet-sammelbeleg-test.php';
$pdo->exec('CREATE TABLE wiki_sync_pages (title TEXT PRIMARY KEY, is_ruined INTEGER)');
$pdo->exec("INSERT INTO wiki_sync_pages VALUES ('Testort', 1), ('Bewohnt', 0)");
function ruinGroupSeed(PDO $pdo, int $count, int $padding = 0): void {
    territoryGroupSeed($pdo, $count);
    $pdo->prepare('UPDATE map_features SET properties_json = ?')->execute([json_encode([
        'wiki_settlement' => ['title' => 'Testort'], 'description' => str_repeat('x', $padding),
    ])]);
}
foreach ([1, 27, 200, 401] as $count) {
    ruinGroupSeed($pdo, $count);
    $before = $normal($state());
    $preview = avesmapsWikiSettlementBulkRecordRuins($pdo, true, 5);
    assert($preview['matched'] === $count && $preview['applied'] === 0 && $normal($state()) === $before);
    $result = avesmapsWikiSettlementBulkRecordRuins($pdo, false, 5);
    assert($result['ok'] && $result['complete'] && $result['applied'] === $count);
    $auditIds = $pdo->query('SELECT id FROM map_audit_log ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
    assert(count($auditIds) === (int) ceil($count / 200));
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log WHERE actor_user_id = 5')->fetchColumn() === count($auditIds));
    assert(count(array_filter($normal($state()), static fn($r) => $r[2]['is_ruined'] === true)) === $count);
    $revision = $pdo->query('SELECT revision FROM map_revision')->fetchColumn();
    $again = avesmapsWikiSettlementBulkRecordRuins($pdo, false, 5);
    assert($again['applied'] === 0 && $again['complete'] && $pdo->query('SELECT revision FROM map_revision')->fetchColumn() === $revision);
    $saved = $normal($state());
    $undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $auditIds[0]], ['id' => 6]);
    assert($undo['fields'] === ['is_ruined'] && $undo['steps'] === min(200, $count));
    assert(!isset($normal($state())[0][2]['is_ruined']));
    if ($count > 200) assert($normal($state())[200][2]['is_ruined'] === true);
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
    assert($normal($state()) === $saved);
    $action = (string) $pdo->query('SELECT action FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetchColumn();
    assert($action === 'undo_undo_set_ruined_location_group' && strlen($action) <= 40);
}

// Bereits gesetzte Ruinen und nicht passende Wiki-Verknüpfungen bleiben unverändert.
ruinGroupSeed($pdo, 5);
$change = $pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?');
foreach ([2 => ['is_ruined' => true], 3 => ['wiki_settlement' => ['title' => 'Bewohnt']], 4 => ['wiki_settlement' => ['title' => 'Fehlt']]] as $id => $props) {
    $change->execute([json_encode($props), wikiGroupId($id)]);
}
$pdo->prepare('UPDATE map_features SET is_active = 0 WHERE public_id = ?')->execute([wikiGroupId(5)]);
$before = $normal($state());
assert(avesmapsWikiSettlementBulkRecordRuins($pdo, false, 5)['applied'] === 1);
avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
assert($normal($state()) === $before);

// Ein Fehler im zweiten Paket lässt den ersten vollständigen Beleg erhalten.
ruinGroupSeed($pdo, 401);
$pdo->prepare("INSERT INTO map_feature_locks VALUES (?, 9, 'Andere Person', '2999-01-01 00:00:00')")->execute([wikiGroupId(400)]);
$result = avesmapsWikiSettlementBulkRecordRuins($pdo, false, 5);
assert(!$result['ok'] && !$result['complete'] && $result['partial'] && $result['applied'] === 200 && $result['completed_batches'] === 1);
assert(!isset($normal($state())[200][2]['is_ruined']) && !isset($normal($state())[400][2]['is_ruined']));
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
$pdo->exec('DELETE FROM map_feature_locks');
assert(avesmapsWikiSettlementBulkRecordRuins($pdo, false, 5)['applied'] === 201);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 3);

ruinGroupSeed($pdo, 27);
$before = $normal($state());
$pdo->exec("CREATE TRIGGER ruins_fail BEFORE UPDATE ON map_features WHEN NEW.public_id = '" . wikiGroupId(27) . "' BEGIN SELECT RAISE(ABORT, 'Fixture'); END");
$result = avesmapsWikiSettlementBulkRecordRuins($pdo, false, 5);
assert(!$result['ok'] && !$result['partial'] && $result['applied'] === 0);
assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
$pdo->exec('DROP TRIGGER ruins_fail');

ruinGroupSeed($pdo, 1);
avesmapsWikiSettlementBulkRecordRuins($pdo, false, 5);
$pdo->exec("UPDATE map_features SET properties_json = '{\"description\":\"später\"}'");
$before = $normal($state());
wikiGroupReject(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]));
assert($normal($state()) === $before);

// Der Lauf darf seine ersten eigenen Pakete nicht durch die Bytequota verdrängen.
ruinGroupSeed($pdo, 5000, 800);
$result = avesmapsWikiSettlementBulkRecordRuins($pdo, false, 5);
assert(!$result['ok'] && $result['partial'] && $result['applied'] > 200 && $result['applied'] < 5000);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === $result['completed_batches']);
assert(count(array_filter($normal($state()), static fn($r) => !empty($r[2]['is_ruined']))) === $result['applied']);
assert($pdo->query('SELECT action FROM map_audit_log ORDER BY id LIMIT 1')->fetchColumn() === 'set_ruined_location_group');

echo "OK: Ruinenstatus paketweise, atomar, rücknehmbar und ohne Selbstverdrängung.\n";
