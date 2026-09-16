<?php

declare(strict_types=1);

require __DIR__ . '/wege-gruppe-wiki-public-ids-test.php';
foreach (['undone_at TEXT', 'undone_by INTEGER', 'undo_audit_id INTEGER'] as $column) {
    $pdo->prepare('ALTER TABLE map_audit_log ADD COLUMN ' . $column)->execute();
}

$pdo->exec('CREATE TABLE feature_sources (entity_type TEXT, entity_public_id TEXT, source_id INTEGER, status TEXT, reference_kind TEXT)');
$pdo->exec('CREATE TABLE sources (id INTEGER PRIMARY KEY, url TEXT, label TEXT, source_type TEXT, is_official INTEGER, license TEXT, attribution TEXT)');
$pdo->exec('CREATE TABLE source_corpus (corpus_key TEXT PRIMARY KEY, label TEXT, form TEXT, source_type TEXT, license TEXT, attribution TEXT, is_official INTEGER)');
assert(avesmapsWikiPathRowMatchesWay('Anders', '{"wiki_path": {"wiki_key": "weg-1"}}', 'kein-treffer', 'weg-1'));
assert(!avesmapsWikiPathRowMatchesWay('Anders', '{"wiki_path": {"wiki_key": "weg-11"}}', 'kein-treffer', 'weg-1'));
function wikiGroupId(int $id): string {
    return sprintf('%08d-1111-4111-8111-111111111111', $id);
}
function wikiGroupSeed(PDO $pdo, int $count): void {
    foreach (['map_features', 'map_audit_log', 'map_feature_locks', 'map_revision', 'feature_sources'] as $table) {
        $pdo->exec('DELETE FROM ' . $table);
    }
    $insert = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype, geometry_type, geometry_json, properties_json, revision)
        VALUES (?, 'Mein Weg', 'path', 'Weg', 'LineString', ?, ?, 7)");
    for ($i = 1; $i <= $count; $i++) {
        $insert->execute([wikiGroupId($i), json_encode(['type' => 'LineString', 'coordinates' => [[$i, 1], [$i + 1, 2]]]),
            json_encode(['name' => 'Mein Weg', 'description' => 'Abschnitt ' . $i, 'show_label' => false,
                'wiki_path' => ['wiki_key' => 'alt', 'source' => 'verlauf-sync', 'course_hash' => 'vorher', 'course_hops' => ['A', 'B']],
                'wiki_path_weitere' => [['wiki_key' => 'alte-strasse', 'name' => 'Alte Straße'], ['wiki_key' => 'weiter', 'name' => 'Weiter']]])]);
    }
}
assert(avesmapsMapGroupNormalizeJson(['b' => ['y' => 2, 'x' => 1], 'a' => [1, 2]]) === avesmapsMapGroupNormalizeJson(['a' => [1, 2], 'b' => ['x' => 1, 'y' => 2]]));
assert(avesmapsMapGroupNormalizeJson(['a' => [1, 2]]) !== avesmapsMapGroupNormalizeJson(['a' => [2, 1]]));
assert(avesmapsMapGroupNormalizeJson(['a' => 1]) !== avesmapsMapGroupNormalizeJson(['a' => '1']));
function wikiGroupReject(callable $run): void {
    try { $run(); } catch (InvalidArgumentException | RuntimeException $error) { return; }
    throw new RuntimeException('Der ungültige Vorgang wurde angenommen.');
}
$last = static fn() => (int) $pdo->query('SELECT MAX(id) FROM map_audit_log')->fetchColumn();
$state = static fn() => $pdo->query('SELECT public_id, name, properties_json FROM map_features ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$normal = static fn(array $rows) => array_map(static fn(array $row) => [$row['public_id'], $row['name'], json_decode($row['properties_json'], true)], $rows);
foreach ([1, 27, 250] as $count) {
    wikiGroupSeed($pdo, $count);
    $before = $normal($state());
    $result = avesmapsWikiPathAssignTo($pdo, 'alte-strasse', wikiGroupId(1), false, 5);
    assert($result['applied'] === $count && count($result['segments_updated']) === $count);
    assert(count(array_unique(array_column($result['segments_updated'], 'revision'))) === 1);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
    $saved = $normal($state());
    assert($saved[0][1] === 'Alte Straße' && $saved[0][2]['show_label'] === true);
    assert(count($saved[0][2]['wiki_path_weitere']) === 1);
    $auditId = $last();
    $beforeRevision = (int) $pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn();
    avesmapsWikiPathAssignTo($pdo, 'alte-strasse', wikiGroupId(1), false, 5);
    assert($last() === $auditId, 'No-op erzeugt keinen weiteren Sammelbeleg.');
    assert((int) $pdo->query('SELECT revision FROM map_revision WHERE id = 1')->fetchColumn() === $beforeRevision);
    $undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
    assert($undo['steps'] === $count && $normal($state()) === $before);
    assert(count($undo['kanon_je_kennung']) === $count && $undo['kanon_je_kennung'][wikiGroupId(1)] === null);
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
    assert($normal($state()) === $saved);
    $clear = avesmapsWikiPathClearAssign($pdo, wikiGroupId(1), false, 5);
    assert($clear['applied'] === $count && count(array_unique(array_column($state(), 'name'))) === $count);
    assert(!isset($normal($state())[0][2]['wiki_path']));
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
    assert($normal($state()) === $saved);
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
    assert(!isset($normal($state())[0][2]['wiki_path']));
}
// Namen vereinheitlichen erfasst auch alte Namen mit derselben Wiki-Zuordnung.
wikiGroupSeed($pdo, 3);
$pdo->exec("UPDATE map_features SET name = 'Alte Straße' WHERE id = (SELECT MIN(id) FROM map_features)");
$properties = ['wiki_path' => ['wiki_key' => 'alte-strasse']];
$pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')->execute([json_encode($properties), wikiGroupId(3)]);
$result = avesmapsWikiPathAssign($pdo, 'alte-strasse', false, 5);
assert($result['applied'] === 2 && $normal($state())[1][1] === 'Mein Weg');
assert(json_decode($pdo->query('SELECT after_json FROM map_audit_log')->fetchColumn(), true)['count'] === 2);
// 251 Kandidaten, fremde Sperre und fehlendes explizites Mitglied: keinerlei Teiländerung.
foreach (['size', 'lock', 'missing'] as $case) {
    wikiGroupSeed($pdo, $case === 'size' ? 251 : 3);
    if ($case === 'lock') {
        $pdo->prepare('INSERT INTO map_feature_locks VALUES (?, 6, ?, ?)')->execute([wikiGroupId(3), 'Andere Person', '2999-01-01']);
    }
    $before = $state();
    wikiGroupReject(fn() => avesmapsWikiPathAssignTo($pdo, 'alte-strasse', wikiGroupId(1), false, 5, false, [],
        $case === 'missing' ? [wikiGroupId(1), wikiGroupId(9)] : null));
    assert($state() === $before && $last() === 0 && !$pdo->inTransaction());
}
// Fehler am letzten Write rollt auch Revision und Audit zurück.
wikiGroupSeed($pdo, 3);
$pdo->exec("CREATE TRIGGER wiki_write_fails BEFORE UPDATE ON map_features WHEN OLD.public_id = '" . wikiGroupId(3) . "' BEGIN SELECT RAISE(ABORT, 'Probe'); END");
$before = $state();
wikiGroupReject(fn() => avesmapsWikiPathAssignTo($pdo, 'alte-strasse', wikiGroupId(1), false, 5));
assert($state() === $before && $last() === 0 && !$pdo->inTransaction());
$pdo->exec('DROP TRIGGER wiki_write_fails');
// Veraltete Planung, belegter generischer Name und späterer Undo-Konflikt.
wikiGroupSeed($pdo, 3);
$row = $pdo->query('SELECT * FROM map_features ORDER BY id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
$plan = [['before' => $row, 'name' => 'Weg-1', 'properties_json' => ['name' => 'Weg-1']]];
$pdo->exec('UPDATE map_features SET revision = revision + 1');
wikiGroupReject(fn() => avesmapsWikiPathCommitGroup($pdo, $plan, 5, 'clear_wiki_path_group'));
assert($last() === 0);
$row = $pdo->query('SELECT * FROM map_features ORDER BY id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
$plan[0]['before'] = $row;
$pdo->prepare('UPDATE map_features SET name = ? WHERE public_id = ?')->execute(['Weg-1', wikiGroupId(1)]);
wikiGroupReject(fn() => avesmapsWikiPathCommitGroup($pdo, $plan, 5, 'clear_wiki_path_group'));
assert($last() === 0);
avesmapsWikiPathAssignTo($pdo, 'alte-strasse', wikiGroupId(2), false, 5);
$pdo->prepare('UPDATE map_features SET name = ? WHERE public_id = ?')->execute(['Später', wikiGroupId(3)]);
$before = $state();
wikiGroupReject(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]));
assert($state() === $before);
// Ein unveränderter Namensnachbar erbt das Etikett; Undo muss auch IHN aktualisieren.
wikiGroupSeed($pdo, 3);
$pdo->prepare('UPDATE map_features SET name = ?, properties_json = ? WHERE public_id = ?')
    ->execute(['Alte Straße', json_encode(['name' => 'Alte Straße']), wikiGroupId(3)]);
avesmapsWikiPathAssignTo($pdo, 'alte-strasse', wikiGroupId(1), false, 5, false, [], [wikiGroupId(1)]);
$undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
assert(array_key_exists(wikiGroupId(3), $undo['kanon_je_kennung']) && $undo['kanon_je_kennung'][wikiGroupId(3)] === null);
$redo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
assert($redo['kanon_je_kennung'][wikiGroupId(3)]['kanon'] === 'offiziell');
// Eine eigene inoffizielle Quelle bleibt nach Wegfall der geerbten Wiki-Aussage sichtbar.
$pdo->exec("INSERT INTO sources VALUES (7, 'https://example.org/beleg', 'Beleg', 'briefspiel', 0, '', '')");
$pdo->prepare("INSERT INTO feature_sources VALUES ('path', ?, 7, 'approved', '')")->execute([wikiGroupId(3)]);
avesmapsWikiPathClearAssign($pdo, wikiGroupId(1), false, 5, true);
$undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
assert($undo['kanon_je_kennung'][wikiGroupId(3)]['kanon'] === 'offiziell');
$redo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
assert($redo['kanon_je_kennung'][wikiGroupId(3)]['kanon'] === 'inoffiziell');
$pdo->exec("UPDATE feature_sources SET reference_kind = 'ergaenzend'");
$members = array_map('avesmapsMapGroupAuditMember', $pdo->query('SELECT * FROM map_features')->fetchAll(PDO::FETCH_ASSOC));
$kanon = avesmapsWikiPathGroupKanon($pdo, ['members' => $members], ['members' => $members]);
assert($kanon[wikiGroupId(3)] === ['kanon' => ''], 'Publikationsverweise allein bestimmen keinen Kanon.');
echo "OK: Wiki-Wege als atomare Sammelbelege mit Undo/Redo und Konfliktschutz.\n";
