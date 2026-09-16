<?php

declare(strict_types=1);

require __DIR__ . '/wiki-wege-sammelbeleg-test.php';

function wikiBulkSeed(PDO $pdo, int $count): void {
    wikiGroupSeed($pdo, $count);
    $pdo->exec("UPDATE map_features SET name = 'Alte Straße'");
}

foreach ([1, 250, 501] as $count) {
    wikiBulkSeed($pdo, $count);
    $before = $normal($state());
    $preview = avesmapsWikiPathAssignAll($pdo, 'Aventurien', true, [], 5);
    assert($preview['segments_affected'] === $count && $preview['applied'] === 0);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
    $result = avesmapsWikiPathAssignAll($pdo, 'Aventurien', false, [], 5);
    assert($result['ok'] && $result['complete'] && $result['applied'] === $count);
    assert($result['completed_batches'] === (int) ceil($count / 250));
    $audits = $pdo->query('SELECT * FROM map_audit_log ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    assert(count($audits) === (int) ceil($count / 250));
    foreach ($audits as $audit) {
        assert((int) $audit['actor_user_id'] === 5 && $audit['action'] === 'bulk_assign_wiki_path_group');
        $snapshot = json_decode($audit['after_json'], true);
        assert($snapshot['count'] <= 250 && $snapshot['fields'] === ['wiki_path_assignment']);
    }
    $saved = $normal($state());
    assert($saved[0][1] === 'Alte Straße' && $saved[0][2]['name'] === 'Mein Weg', 'Der Massenlauf benennt nicht um.');
    assert($saved[0][2]['show_label'] === true && count($saved[0][2]['wiki_path_weitere']) === 1);
    $revision = $pdo->query('SELECT revision FROM map_revision')->fetchColumn();
    avesmapsWikiPathAssignAll($pdo, 'Aventurien', false, [], 5);
    assert($pdo->query('SELECT revision FROM map_revision')->fetchColumn() === $revision);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === count($audits));
    $undoIds = [];
    foreach (array_reverse($audits) as $audit) {
        avesmapsUndoAuditChange($pdo, ['audit_id' => (int) $audit['id']], ['id' => 6]);
        $undoIds[] = $last();
    }
    assert($normal($state()) === $before);
    foreach (array_reverse($undoIds) as $undoId) {
        avesmapsUndoAuditChange($pdo, ['audit_id' => $undoId], ['id' => 5]);
    }
    assert($normal($state()) === $saved);
}

// Ein Konflikt im zweiten Paket lässt nur das erste stehen; Wiederholung erzeugt dort keinen Doppelbeleg.
wikiBulkSeed($pdo, 501);
$before = $normal($state());
$pdo->prepare("INSERT INTO map_feature_locks VALUES (?, 9, 'Andere Person', '2999-01-01 00:00:00')")->execute([wikiGroupId(251)]);
$result = avesmapsWikiPathAssignAll($pdo, 'Aventurien', false, [], 5);
assert(!$result['ok'] && !$result['complete'] && $result['partial']);
assert($result['applied'] === 250 && $result['completed_batches'] === 1);
assert($result['error']['code'] === 'edit_conflict' && str_contains($result['error']['message'], '250 von 501'));
assert(array_slice($normal($state()), 250) === array_slice($before, 250));
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
$pdo->exec('DELETE FROM map_feature_locks');
$result = avesmapsWikiPathAssignAll($pdo, 'Aventurien', false, [], 5);
assert($result['ok'] && $result['applied'] === 501);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 3);

// Fehler beim letzten Write eines Pakets: auch seine vorherigen Writes und Revision rollen zurück.
wikiBulkSeed($pdo, 27);
$before = $normal($state());
$pdo->exec("CREATE TRIGGER bulk_fail BEFORE UPDATE ON map_features WHEN NEW.public_id = '" . wikiGroupId(27) . "' BEGIN SELECT RAISE(ABORT, 'nur in der Fixture'); END");
$result = avesmapsWikiPathAssignAll($pdo, 'Aventurien', false, [], 5);
assert(!$result['ok'] && !$result['partial'] && $result['applied'] === 0);
assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
assert(!str_contains($result['error']['message'], 'Fixture'), 'Keine internen Datenbankdetails in der Antwort.');
$pdo->exec('DROP TRIGGER bulk_fail');

// Ein bereits beim Schreiben nicht rücknehmbares Paket wird nicht gespeichert.
wikiBulkSeed($pdo, 1001);
$before = $normal($state());
$result = avesmapsWikiPathAssignAll($pdo, 'Aventurien', false, [], 5);
assert(!$result['ok'] && $result['applied'] === 0 && $normal($state()) === $before);

// Schwere Pakete dürfen die ersten Belege desselben Laufs nicht selbst verdrängen.
wikiGroupSeed($pdo, 6000);
$stage = $pdo->prepare("INSERT INTO wiki_path_staging (wiki_key, name, kind, art, continent, wiki_url) VALUES (?, ?, 'strasse', 'Straße', 'Aventurien', ?)");
$rename = $pdo->prepare('UPDATE map_features SET name = ?, properties_json = ? WHERE public_id = ?');
for ($group = 0; $group < 24; $group++) {
    $name = 'Massenweg ' . $group;
    $stage->execute(['massenweg-' . $group, $name, 'https://example.org/weg-' . $group]);
    for ($member = 1; $member <= 250; $member++) {
        $rename->execute([$name, json_encode(['name' => $name, 'description' => str_repeat('a', 500)]), wikiGroupId($group * 250 + $member)]);
    }
}
$result = avesmapsWikiPathAssignAll($pdo, 'Aventurien', false, [], 5);
assert(!$result['ok'] && $result['partial'] && str_contains($result['error']['message'], 'Aufbewahrungsgrenze'));
$audits = $pdo->query('SELECT before_json, after_json FROM map_audit_log')->fetchAll(PDO::FETCH_ASSOC);
assert(count($audits) === $result['completed_batches'], 'Kein eigenes Paket darf aus dem Verlauf verschwinden.');
$members = 0;
$bytes = 0;
foreach ($audits as $audit) {
    $members += json_decode($audit['after_json'], true)['count'];
    $bytes += strlen($audit['before_json']) + strlen($audit['after_json']);
}
assert($members === $result['applied'] && $bytes <= AVESMAPS_MAP_GROUP_AUDIT_ACTOR_BYTES);
$assigned = 0;
foreach ($normal($state()) as $row) {
    $assigned += isset($row[2]['wiki_path']) ? 1 : 0;
}
assert($assigned === $members, 'Jede neue Zuordnung hat noch ihren Beleg; das verdrängende Paket wurde zurückgerollt.');

$endpoint = file_get_contents(__DIR__ . '/../../../edit/wiki/paths.php');
$start = strpos($endpoint, "'assign_all' =>");
$end = strpos($endpoint, "'assign_to' =>", $start);
assert(str_contains(substr($endpoint, $start, $end - $start), "(int) (\$user['id'] ?? 0)"));
echo "OK: Wiki-Massenlauf mit begrenzten Sammelbelegen, Akteur, Teilfehler und Wiederholung.\n";
