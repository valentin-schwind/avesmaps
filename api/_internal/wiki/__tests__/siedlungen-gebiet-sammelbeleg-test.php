<?php

declare(strict_types=1);

require __DIR__ . '/wiki-wege-sammelbeleg-test.php';
require_once __DIR__ . '/../settlements.php';

function territoryGroupSeed(PDO $pdo, int $count): array {
    wikiGroupSeed($pdo, $count);
    $pdo->exec("UPDATE map_features SET feature_type = 'location', feature_subtype = 'dorf', geometry_type = 'Point', geometry_json = '{\"type\":\"Point\",\"coordinates\":[10,20]}'");
    return array_map(static fn(int $i): array => ['public_id' => wikiGroupId($i), 'wiki_key' => 'wiki:gebiet', 'territory_public_id' => 'gebiet-id'], range(1, $count));
}

foreach ([1, 27, 200] as $count) {
    $pairs = territoryGroupSeed($pdo, $count);
    $before = $normal($state());
    $dry = avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, true, 200, 5);
    assert($dry['applied'] === 0 && $normal($state()) === $before);
    $result = avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, false, 200, 5);
    assert($result['applied'] === $count && $result['remaining'] === 0);
    $saved = $normal($state());
    assert($saved[0][2]['territory_source'] === 'raycast');
    $audit = $pdo->query('SELECT * FROM map_audit_log')->fetchAll(PDO::FETCH_ASSOC);
    assert(count($audit) === 1 && (int) $audit[0]['actor_user_id'] === 5);
    assert(json_decode($audit[0]['after_json'], true)['count'] === $count);
    $revision = $pdo->query('SELECT revision FROM map_revision')->fetchColumn();
    avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, false, 200, 5);
    assert($pdo->query('SELECT revision FROM map_revision')->fetchColumn() === $revision);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
    $undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
    assert($normal($state()) === $before && $undo['feature_type'] === 'location' && $undo['steps'] === $count);
    assert(in_array('territory_wiki_key', $undo['features'][0]['removed_properties'], true));
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
    assert($normal($state()) === $saved);
    $redoAction = (string) $pdo->query('SELECT action FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetchColumn();
    assert($redoAction === 'undo_undo_set_territory_location_group');
    assert(strlen($redoAction) <= 40 && avesmapsIsMapGroupAuditAction($redoAction));
}
$pairs = territoryGroupSeed($pdo, 201);
$result = avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, false, 200, 5);
assert($result['applied'] === 200 && $result['remaining'] === 1);
assert(!isset($normal($state())[200][2]['territory_source']));

$pairs = territoryGroupSeed($pdo, 2);
$manual = ['territory_source' => 'manual', 'territory_wiki_key' => 'wiki:manuell', 'description' => 'Bleibt'];
$pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')->execute([json_encode($manual), wikiGroupId(2)]);
$result = avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, false, 200, 5);
assert($result['applied'] === 1 && $result['skipped_manual'] === 1 && avesmapsMapGroupNormalizeJson($normal($state())[1][2]) === avesmapsMapGroupNormalizeJson($manual));
$result = avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, true, false, 200, 5);
assert($result['applied'] === 2 && $result['skipped_manual'] === 0);
avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
assert(avesmapsMapGroupNormalizeJson($normal($state())[1][2]) === avesmapsMapGroupNormalizeJson($manual));

foreach (['missing', 'duplicate', 'empty', 'invalid', 'lock'] as $case) {
    $pairs = territoryGroupSeed($pdo, 27);
    $before = $normal($state());
    if ($case === 'missing') $pairs[26]['public_id'] = wikiGroupId(999);
    if ($case === 'duplicate') $pairs[26] = $pairs[0];
    if ($case === 'empty') $pairs[26]['wiki_key'] = '';
    if ($case === 'invalid') $pairs[26] = 'falsch';
    if ($case === 'lock') $pdo->prepare("INSERT INTO map_feature_locks VALUES (?, 9, 'Andere Person', '2999-01-01 00:00:00')")->execute([wikiGroupId(27)]);
    wikiGroupReject(fn() => avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, false, 200, 5));
    assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
}
$pairs = territoryGroupSeed($pdo, 27);
$before = $normal($state());
$pdo->exec("CREATE TRIGGER territory_fail BEFORE UPDATE ON map_features WHEN NEW.public_id = '" . wikiGroupId(27) . "' BEGIN SELECT RAISE(ABORT, 'Fixture'); END");
wikiGroupReject(fn() => avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, false, 200, 5));
assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
$pdo->exec('DROP TRIGGER territory_fail');

// Ein zwischen Planung und Sperre bearbeiteter Ort verhindert jeden Write.
$target = $pdo->query('SELECT * FROM map_features ORDER BY id LIMIT 1')->fetch(PDO::FETCH_ASSOC);
$pdo->exec('UPDATE map_features SET revision = revision + 1');
wikiGroupReject(fn() => avesmapsWikiSettlementCommitTerritoryGroup($pdo, [['before' => $target, 'properties_json' => ['territory_source' => 'raycast']]], 5));
assert($normal($state()) === $before);

// Rücknahme betrifft Properties, niemals spätere Änderungen an Namen oder Koordinaten.
$pairs = territoryGroupSeed($pdo, 1);
avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, false, 200, 5);
$pdo->exec("UPDATE map_features SET name = 'Neuer Name', geometry_json = '{\"type\":\"Point\",\"coordinates\":[30,40]}'");
avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
assert($normal($state())[0][1] === 'Neuer Name');
assert(json_decode($pdo->query('SELECT geometry_json FROM map_features')->fetchColumn(), true)['coordinates'] === [30, 40]);

$pairs = territoryGroupSeed($pdo, 1);
avesmapsWikiSettlementBulkAssignTerritories($pdo, $pairs, false, false, 200, 5);
$pdo->exec("UPDATE map_features SET properties_json = '{\"territory_source\":\"manual\"}'");
$before = $normal($state());
wikiGroupReject(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]));
assert($normal($state()) === $before);
echo "OK: Ortszuweisung als vollständiger Sammelbeleg mit Schutz manueller Angaben.\n";
