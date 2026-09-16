<?php

declare(strict_types=1);

require __DIR__ . '/siedlungen-gebiet-sammelbeleg-test.php';
require_once __DIR__ . '/../territories.php';
require_once __DIR__ . '/../../political/territory.php';
require_once __DIR__ . '/../sync-monitor.php';
$pdo->exec('CREATE TABLE wiki_sync_pages (title TEXT PRIMARY KEY, settlement_class TEXT, settlement_label TEXT, wiki_url TEXT, details_json TEXT)');
function connectGroupSeed(PDO $pdo, int $count): void {
    territoryGroupSeed($pdo, $count);
    $pdo->exec('DELETE FROM wiki_sync_pages');
    $pdo->beginTransaction();
    $insert = $pdo->prepare('INSERT INTO wiki_sync_pages (title, settlement_class, settlement_label, wiki_url) VALUES (?, ?, ?, ?)');
    $update = $pdo->prepare('UPDATE map_features SET name = ?, properties_json = ? WHERE public_id = ?');
    for ($i = 1; $i <= $count; $i++) {
        $title = 'Testort ' . $i;
        $insert->execute([$title, 'dorf', 'Dorf', 'https://de.wiki-aventurica.de/wiki/Testort_' . $i]);
        $update->execute([$title, json_encode(['description' => 'Alte Beschreibung ' . $i, 'einwohner' => 'Eigener Wert']), wikiGroupId($i)]);
    }
    $pdo->commit();
}
$fetchCalls = 0;
$fetch = static function (array $titles) use ($pdo, &$fetchCalls): array {
    assert(!$pdo->inTransaction() && count($titles) <= 50, 'Wiki-Abrufe erfolgen ohne Schreibsperren.');
    $fetchCalls++;
    return array_fill_keys($titles, "{{Infobox Siedlung\n|Name=Wiki-Ort\n|Einwohner=123\n}}\nNeue Wiki-Beschreibung.");
};
foreach ([1, 27, 200] as $count) {
    connectGroupSeed($pdo, $count);
    $fetchCalls = 0;
    $before = $normal($state());
    $preview = avesmapsWikiSettlementBulkConnect($pdo, 200, true, 5, $fetch);
    assert($preview['would_connect'] === $count && $fetchCalls === 0 && $normal($state()) === $before);
    $result = avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $fetch);
    assert($result['connected'] === $count && $result['remaining'] === 0 && $result['failed'] === []);
    assert($fetchCalls === (int) ceil($count / 50));
    $saved = $normal($state());
    assert(!isset($saved[0][2]['description']) && $saved[0][2]['wiki_settlement']['title'] === 'Testort 1');
    assert($saved[0][2]['einwohner'] === 'Eigener Wert');
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log WHERE actor_user_id = 5')->fetchColumn() === 1);
    assert((int) $pdo->query('SELECT COUNT(*) FROM wiki_sync_pages WHERE details_json IS NOT NULL')->fetchColumn() === $count);
    $revision = $pdo->query('SELECT revision FROM map_revision')->fetchColumn();
    assert(avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $fetch)['connected'] === 0);
    assert($fetchCalls === (int) ceil($count / 50) && $pdo->query('SELECT revision FROM map_revision')->fetchColumn() === $revision);
    $undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
    assert($undo['fields'] === ['wiki_settlement'] && $undo['steps'] === $count && $normal($state()) === $before);
    assert(count($undo['kanon_je_kennung']) === $count && array_key_exists(wikiGroupId(1), $undo['kanon_je_kennung']) && $undo['kanon_je_kennung'][wikiGroupId(1)] === null);
    assert((int) $pdo->query('SELECT COUNT(*) FROM wiki_sync_pages WHERE details_json IS NOT NULL')->fetchColumn() === $count, 'Wiki-Lesevorrat bleibt unabhängig von der Ortszuordnung.');
    $redo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
    assert(count($redo['kanon_je_kennung']) === $count && $redo['kanon_je_kennung'][wikiGroupId(1)]['kanon'] === 'offiziell');
    assert($normal($state()) === $saved);
    $action = $pdo->query('SELECT action FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetchColumn();
    assert($action === 'undo_undo_link_wiki_location_group' && strlen($action) <= 40);
}

connectGroupSeed($pdo, 201);
$result = avesmapsWikiSettlementBulkConnect($pdo, 500, false, 5, $fetch);
assert($result['connected'] === 200 && $result['remaining'] === 1);
assert(!isset($normal($state())[200][2]['wiki_settlement']));
assert(avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $fetch)['connected'] === 1);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 2);

foreach (['missing', 'network', 'lock', 'rename', 'edit', 'deactivate', 'size'] as $case) {
    connectGroupSeed($pdo, 27);
    if ($case === 'lock') $pdo->prepare("INSERT INTO map_feature_locks VALUES (?, 9, 'Andere Person', '2999-01-01 00:00:00')")->execute([wikiGroupId(27)]);
    if ($case === 'size') $pdo->prepare('UPDATE map_features SET properties_json = ?')->execute([json_encode(['description' => str_repeat('x', 24000)])]);
    $before = $normal($state());
    $testFetch = static function (array $titles) use ($case, $fetch, $pdo, &$before, $normal, $state): array {
        if ($case === 'network') throw new RuntimeException('Netzfehler');
        $contents = $fetch($titles);
        if ($case === 'missing') unset($contents['Testort 27']);
        if ($case === 'rename') $pdo->exec("UPDATE map_features SET name = 'Später umbenannt'");
        if ($case === 'edit') $pdo->exec("UPDATE map_features SET properties_json = '{\"description\":\"Später bearbeitet\"}', revision = revision + 1");
        if ($case === 'deactivate') $pdo->exec('UPDATE map_features SET is_active = 0');
        $before = $normal($state());
        return $contents;
    };
    wikiGroupReject(fn() => avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $testFetch));
    assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
    assert((int) $pdo->query('SELECT COUNT(*) FROM wiki_sync_pages WHERE details_json IS NOT NULL')->fetchColumn() === 0);
}
connectGroupSeed($pdo, 27);
$before = $normal($state());
$pdo->exec("CREATE TRIGGER connect_fail BEFORE UPDATE ON map_features WHEN NEW.public_id = '" . wikiGroupId(27) . "' BEGIN SELECT RAISE(ABORT, 'Fixture'); END");
wikiGroupReject(fn() => avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $fetch));
assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
$pdo->exec('DROP TRIGGER connect_fail');

// Eindeutige Auswahl bleibt erhalten; Kreuzungen und bereits zugewiesene Orte werden ausgelassen.
connectGroupSeed($pdo, 5);
$pdo->exec("INSERT INTO wiki_sync_pages (title) VALUES ('Testort 1 (Siedlung)'), ('Testort 2 (Stadt)')");
$pdo->prepare("UPDATE map_features SET feature_subtype = 'kreuzung' WHERE public_id = ?")->execute([wikiGroupId(3)]);
$pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')->execute(['{"wiki_settlement":{"title":"Manuell"}}',wikiGroupId(4)]);
$pdo->prepare("UPDATE map_features SET name = 'Kreuzung-X' WHERE public_id = ?")->execute([wikiGroupId(5)]);
$targets = avesmapsWikiSettlementCollectConnectTargets($pdo);
assert(count($targets) === 1 && $targets[0]['title'] === 'Testort 1 (Siedlung)');
assert(avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $fetch)['connected'] === 1);

// Spätere Eigenschaften blockieren die Rücknahme, spätere Namen und Geometrien bleiben erhalten.
connectGroupSeed($pdo, 1);
avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $fetch);
$pdo->exec("UPDATE map_features SET name = 'Späterer Name', geometry_json = '{\"type\":\"Point\",\"coordinates\":[30,40]}'");
avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
assert($normal($state())[0][1] === 'Späterer Name' && $normal($state())[0][2]['description'] === 'Alte Beschreibung 1');
assert(json_decode($pdo->query('SELECT geometry_json FROM map_features')->fetchColumn(), true)['coordinates'] === [30,40]);
connectGroupSeed($pdo, 1);
avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $fetch);
$pdo->exec("UPDATE map_features SET properties_json = '{\"description\":\"Später\"}'");
$before = $normal($state());
wikiGroupReject(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]));
assert($normal($state()) === $before);
echo "OK: Wiki-Ortsverknüpfung als vollständiges Paket mit Beschreibung, Undo/Redo und Konfliktschutz.\n";

connectGroupSeed($pdo, 1);
$before = $normal($state());
$pdo->beginTransaction();
$insert = $pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, reference_kind) VALUES ('settlement', ?, ?, 'approved', '')");
for ($i = 1; $i <= 2501; $i++) {
    $insert->execute([wikiGroupId(1), $i]);
}
$pdo->commit();
wikiGroupReject(fn() => avesmapsWikiSettlementBulkConnect($pdo, 200, false, 5, $fetch));
assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
assert((int) $pdo->query('SELECT COUNT(*) FROM wiki_sync_pages WHERE details_json IS NOT NULL')->fetchColumn() === 0);
$pdo->exec('DELETE FROM feature_sources');
