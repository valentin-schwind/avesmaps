<?php

declare(strict_types=1);

require __DIR__ . '/wiki-wege-sammelbeleg-test.php';
require_once __DIR__ . '/../regions.php';
require_once __DIR__ . '/../region-label-audit.php';
$pdo->exec('CREATE TABLE wiki_region_staging (wiki_key TEXT PRIMARY KEY, name TEXT, match_key TEXT, continent TEXT, art TEXT, wiki_url TEXT)');
$pdo->exec("INSERT INTO wiki_region_staging VALUES ('testberg', 'Testberg', 'testberg', 'Aventurien', 'Berg', 'https://de.wiki-aventurica.de/wiki/Testberg')");
$pdo->exec('CREATE TABLE ecosystem_region (id INTEGER PRIMARY KEY, public_id TEXT, label_public_id TEXT, is_active INTEGER)');
function labelGroupSeed(PDO $pdo, int $count): void {
    wikiGroupSeed($pdo, $count);
    $pdo->exec('DELETE FROM ecosystem_region');
    $pdo->exec("UPDATE map_features SET name = 'Testberg', feature_type = 'label', feature_subtype = 'region', geometry_type = 'Point', geometry_json = '{\"type\":\"Point\",\"coordinates\":[10,20]}', properties_json = '{\"text\":\"Testberg\",\"size\":18}'");
}
foreach ([1, 27, 200] as $count) {
    labelGroupSeed($pdo, $count);
    $before = $normal($state());
    assert(avesmapsWikiRegionAssign($pdo, 'testberg', true, 5)['labels'] === $count && $normal($state()) === $before);
    assert(avesmapsWikiRegionAssign($pdo, 'testberg', false, 5)['applied'] === $count);
    $saved = $normal($state());
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log WHERE actor_user_id=5')->fetchColumn() === 1);
    $auditId = $last();
    $revision = $pdo->query('SELECT revision FROM map_revision')->fetchColumn();
    avesmapsWikiRegionAssign($pdo, 'testberg', false, 5);
    assert($last() === $auditId && $pdo->query('SELECT revision FROM map_revision')->fetchColumn() === $revision);
    $undo = avesmapsUndoAuditChange($pdo, ['audit_id'=>$auditId], ['id'=>6]);
    assert($undo['feature_type'] === 'label' && $undo['steps'] === $count && $normal($state()) === $before);
    assert(count($undo['kanon_je_kennung']) === $count && $undo['kanon_je_kennung'][wikiGroupId(1)] === null);
    $redo = avesmapsUndoAuditChange($pdo, ['audit_id'=>$last()], ['id'=>5]);
    assert($normal($state()) === $saved && $redo['kanon_je_kennung'][wikiGroupId(1)]['kanon'] === 'offiziell');
}
labelGroupSeed($pdo, 201);
$before = $normal($state());
wikiGroupReject(fn() => avesmapsWikiRegionAssign($pdo, 'testberg', false, 5));
assert($normal($state()) === $before);
$all = avesmapsWikiRegionAssignAll($pdo, '', false, '', 5);
assert($all['ok'] && $all['complete'] && $all['applied'] === 201 && $all['completed_batches'] === 2);
assert(avesmapsWikiRegionAssignAll($pdo, '', false, '', 5)['applied'] === 0);
labelGroupSeed($pdo, 401);
$pdo->prepare("INSERT INTO map_feature_locks VALUES (?, 9, 'Andere Person', '2999-01-01 00:00:00')")->execute([wikiGroupId(201)]);
$all = avesmapsWikiRegionAssignAll($pdo, '', false, '', 5);
assert(!$all['ok'] && !$all['complete'] && $all['partial'] && $all['applied'] === 200 && $all['completed_batches'] === 1);
assert(!isset($normal($state())[200][2]['wiki_region']) && !isset($normal($state())[400][2]['wiki_region']));
foreach (['primary', 'own'] as $binding) {
    labelGroupSeed($pdo, 2);
    if ($binding === 'own') $pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')->execute([json_encode(['ecosystem_region_public_id'=>'land']), wikiGroupId(2)]);
    $planned = $pdo->query('SELECT * FROM map_features ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    $pdo->prepare('INSERT INTO ecosystem_region VALUES (1, ?, ?, 1)')->execute(['land', $binding === 'primary' ? wikiGroupId(2) : null]);
    $before = $normal($state());
    wikiGroupReject(fn() => avesmapsWikiRegionCommitLabelGroup($pdo, array_map(static fn($row)=>['before'=>$row,'properties_json'=>avesmapsLandschaftWikiNestSetzen(json_decode($row['properties_json'],true),['wiki_key'=>'testberg'])],$planned),5,'assign_wiki_label_group'));
    assert($normal($state()) === $before);
    $result=avesmapsWikiRegionAssign($pdo,'testberg',false,5);
    assert($result['applied']===1 && $result['gebunden_uebersprungen']===1);
}
labelGroupSeed($pdo, 2);
avesmapsWikiRegionAssign($pdo,'testberg',false,5);
$pdo->prepare('INSERT INTO ecosystem_region VALUES (1, ?, ?, 1)')->execute(['land',wikiGroupId(2)]);
$before=$normal($state());
wikiGroupReject(fn()=>avesmapsUndoAuditChange($pdo,['audit_id'=>$last()],['id'=>6]));
assert($normal($state())===$before);
foreach (['lock','size','write'] as $case) {
    labelGroupSeed($pdo,27);
    if ($case==='lock') $pdo->prepare("INSERT INTO map_feature_locks VALUES (?,9,'Andere Person','2999-01-01 00:00:00')")->execute([wikiGroupId(27)]);
    if ($case==='size') $pdo->prepare('UPDATE map_features SET properties_json=?')->execute([json_encode(['description'=>str_repeat('x',24000)])]);
    if ($case==='write') $pdo->exec("CREATE TRIGGER label_fail BEFORE UPDATE ON map_features WHEN NEW.public_id = '" . wikiGroupId(27) . "' BEGIN SELECT RAISE(ABORT, 'Fixture'); END");
    $before=$normal($state());
    wikiGroupReject(fn()=>avesmapsWikiRegionAssign($pdo,'testberg',false,5));
    assert($normal($state())===$before && (int)$pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn()===0);
    if ($case==='write') $pdo->exec('DROP TRIGGER label_fail');
}
echo "OK: Freie Wiki-Regionsbeschriftungen als atomare Pakete mit Undo/Redo.\n";

// Die Antwortgrenze gilt bereits beim Speichern, nicht erst beim späteren Undo.
labelGroupSeed($pdo, 1);
$before = $normal($state());
$insert = $pdo->prepare("INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, reference_kind) VALUES ('region', ?, ?, 'approved', '')");
$pdo->beginTransaction();
for ($i = 1; $i <= 2501; $i++) {
    $insert->execute([wikiGroupId(1), $i]);
}
$pdo->commit();
wikiGroupReject(fn() => avesmapsWikiRegionAssign($pdo, 'testberg', false, 5));
assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);

// Ein langer Lauf darf seine eigenen ersten Belege nicht durch Aufbewahrung verdrängen.
labelGroupSeed($pdo, 6000);
$pdo->prepare('UPDATE map_features SET properties_json = ?')->execute([json_encode(['description' => str_repeat('a', 600)])]);
$all = avesmapsWikiRegionAssignAll($pdo, '', false, '', 5);
assert(!$all['ok'] && $all['partial'] && str_contains($all['error']['message'], 'Aufbewahrungsgrenze'));
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === $all['completed_batches']);
$linked = array_filter($normal($state()), static fn(array $row): bool => isset($row[2]['wiki_region']));
assert(count($linked) === $all['applied'] && $all['applied'] === $all['completed_batches'] * 200);
echo "OK: Quellen- und Aufbewahrungsgrenzen ohne verlorene Belege.\n";
