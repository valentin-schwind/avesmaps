<?php

declare(strict_types=1);

require __DIR__ . '/siedlungen-gebiet-sammelbeleg-test.php';
$pdo->exec('CREATE TABLE wiki_sync_pages (title TEXT PRIMARY KEY, coat_url TEXT, coat_license_status TEXT, coat_author TEXT, coat_attribution TEXT)');
$pdo->exec("INSERT INTO wiki_sync_pages VALUES ('Testort', 'https://de.wiki-aventurica.de/images/test.png', 'public_domain', 'Autor', 'Attribution'), ('Unfrei', 'https://de.wiki-aventurica.de/images/unfrei.png', 'unknown', '', '')");
function coatGroupSeed(PDO $pdo, int $count): void {
    territoryGroupSeed($pdo, $count);
    $pdo->prepare('UPDATE map_features SET properties_json = ?')->execute([json_encode([
        'wiki_settlement' => ['title' => 'Testort'], 'description' => 'Eigener Text',
    ])]);
}
foreach ([1, 27, 200] as $count) {
    coatGroupSeed($pdo, $count);
    $before = $normal($state());
    $preview = avesmapsWikiSettlementBulkRecordCoats($pdo, true, 200, 5);
    assert($preview['matched'] === $count && $preview['applied'] === 0 && $normal($state()) === $before);
    $result = avesmapsWikiSettlementBulkRecordCoats($pdo, false, 200, 5);
    assert($result['applied'] === $count && $result['remaining'] === 0);
    $saved = $normal($state());
    assert($saved[0][2]['coat']['author'] === 'Autor' && $saved[0][2]['description'] === 'Eigener Text');
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log WHERE actor_user_id = 5')->fetchColumn() === 1);
    $revision = $pdo->query('SELECT revision FROM map_revision')->fetchColumn();
    assert(avesmapsWikiSettlementBulkRecordCoats($pdo, false, 200, 5)['applied'] === 0);
    assert($pdo->query('SELECT revision FROM map_revision')->fetchColumn() === $revision);
    $undo = avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
    assert($undo['fields'] === ['coat'] && $undo['steps'] === $count && $normal($state()) === $before);
    assert(in_array('coat', $undo['features'][0]['removed_properties'], true));
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
    assert($normal($state()) === $saved);
    assert($pdo->query('SELECT action FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetchColumn() === 'undo_undo_set_coat_location_group');
}
coatGroupSeed($pdo, 201);
$result = avesmapsWikiSettlementBulkRecordCoats($pdo, false, 500, 5);
assert($result['applied'] === 200 && $result['remaining'] === 1 && !isset($normal($state())[200][2]['coat']));
assert(avesmapsWikiSettlementBulkRecordCoats($pdo, false, 500, 5)['applied'] === 1);
assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 2);

coatGroupSeed($pdo, 6);
$variants = [
    ['coat' => ['source' => 'own', 'url' => '/uploads/own.png']],
    ['coat_none' => true],
    ['wiki_settlement' => ['title' => 'Unfrei']],
    ['coat' => ['source' => 'wiki', 'url' => '/uploads/wappen/wiki/local.png', 'wiki_url' => 'https://de.wiki-aventurica.de/images/test.png']],
    ['coat' => ['source' => 'wiki', 'url' => '/uploads/wappen/wiki/old.png', 'wiki_url' => 'https://de.wiki-aventurica.de/images/old.png']],
    ['coat' => ['source' => 'wiki', 'url' => 'https://de.wiki-aventurica.de/images/old.png']],
];
foreach ($variants as $i => $variant) {
    $pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')->execute([
        json_encode($variant + ['wiki_settlement' => ['title' => 'Testort'], 'description' => 'Eigener Text']), wikiGroupId($i + 1),
    ]);
}
$before = $normal($state());
assert(avesmapsWikiSettlementBulkRecordCoats($pdo, false, 200, 5)['applied'] === 2);
assert(array_slice($normal($state()), 0, 4) === array_slice($before, 0, 4));
avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
assert($normal($state()) === $before, 'Vorhandene alte Wappen werden vollständig wiederhergestellt.');

foreach (['lock', 'size', 'write'] as $case) {
    coatGroupSeed($pdo, 27);
    if ($case === 'lock') $pdo->prepare("INSERT INTO map_feature_locks VALUES (?, 9, 'Andere Person', '2999-01-01 00:00:00')")->execute([wikiGroupId(27)]);
    if ($case === 'size') $pdo->prepare('UPDATE map_features SET properties_json = ?')->execute([json_encode(['wiki_settlement' => ['title' => 'Testort'], 'description' => str_repeat('x', 24000)])]);
    if ($case === 'write') $pdo->exec("CREATE TRIGGER coat_fail BEFORE UPDATE ON map_features WHEN NEW.public_id = '" . wikiGroupId(27) . "' BEGIN SELECT RAISE(ABORT, 'Fixture'); END");
    $before = $normal($state());
    wikiGroupReject(fn() => avesmapsWikiSettlementBulkRecordCoats($pdo, false, 200, 5));
    assert($normal($state()) === $before && (int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 0);
    if ($case === 'write') $pdo->exec('DROP TRIGGER coat_fail');
}
coatGroupSeed($pdo, 2);
avesmapsWikiSettlementBulkRecordCoats($pdo, false, 200, 5);
$auditId = $last();
$pdo->exec("UPDATE map_features SET name = 'Späterer Name', geometry_json = '{\"type\":\"Point\",\"coordinates\":[30,40]}'");
avesmapsUndoAuditChange($pdo, ['audit_id' => $auditId], ['id' => 6]);
assert($pdo->query('SELECT name FROM map_features LIMIT 1')->fetchColumn() === 'Späterer Name');
avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
// Eine spätere Lokalisierung ist ein eigener Schreibvorgang und darf nicht übergangen werden.
$props = $normal($state())[1][2];
$props['coat']['wiki_url'] = $props['coat']['url'];
$props['coat']['url'] = '/uploads/wappen/wiki/local.png';
$pdo->prepare('UPDATE map_features SET properties_json = ? WHERE public_id = ?')->execute([json_encode($props), wikiGroupId(2)]);
$before = $normal($state());
wikiGroupReject(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]));
assert($normal($state()) === $before);
echo "OK: Wiki-Wappen als vollständiger Sammelbeleg mit Undo/Redo und Konfliktschutz.\n";

require_once __DIR__ . '/../settlements-coat-localize.php';
require_once __DIR__ . '/../sync-monitor.php';
$originalRoot = $_SERVER['DOCUMENT_ROOT'] ?? null;
$root = sys_get_temp_dir() . '/avesmaps-coat-' . bin2hex(random_bytes(8));
mkdir($root);
$_SERVER['DOCUMENT_ROOT'] = $root;
$bytes = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>';
$download = static function (string $url) use ($pdo, &$bytes): array {
    assert(!$pdo->inTransaction(), 'Bilder werden vor den Schreibsperren geladen.');
    return ['bytes' => $bytes, 'content_type' => 'image/svg+xml'];
};
try {
    foreach ([1, 27, 40] as $count) {
        coatGroupSeed($pdo, $count);
        $original = $normal($state());
        avesmapsWikiSettlementBulkRecordCoats($pdo, false, 200, 5);
        $assignId = $last();
        $assigned = $normal($state());
        $result = avesmapsWikiSettlementLocalizeCoatsAusfuehren($pdo, 40, 0, 5, $download);
        assert($result['localized'] === $count && $result['failed'] === 0 && $result['remaining'] === 0);
        $localId = $last();
        $localized = $normal($state());
        $url = $localized[0][2]['coat']['url'];
        assert(file_get_contents($root . $url) === $bytes);
        if (PHP_OS_FAMILY !== 'Windows') assert((fileperms($root . $url) & 0777) === 0644);
        assert(avesmapsWikiSettlementBulkRecordCoats($pdo, false, 200, 5)['applied'] === 0);
        assert(avesmapsWikiSettlementLocalizeCoatsAusfuehren($pdo, 40, 0, 5, $download)['localized'] === 0);
        wikiGroupReject(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $assignId], ['id' => 6]));
        avesmapsUndoAuditChange($pdo, ['audit_id' => $localId], ['id' => 6]);
        $undoLocalId = $last();
        assert($normal($state()) === $assigned && file_get_contents($root . $url) === $bytes);
        avesmapsUndoAuditChange($pdo, ['audit_id' => $assignId], ['id' => 6]);
        assert($normal($state()) === $original);
        avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 5]);
        avesmapsUndoAuditChange($pdo, ['audit_id' => $undoLocalId], ['id' => 5]);
        assert($normal($state()) === $localized && file_get_contents($root . $url) === $bytes);
    }
    coatGroupSeed($pdo, 2);
    avesmapsWikiSettlementBulkRecordCoats($pdo, false, 200, 5);
    $assigned = $normal($state());
    $calls = 0;
    $partial = static function ($url) use (&$calls, $download): ?array { return ++$calls === 1 ? $download($url) : null; };
    $result = avesmapsWikiSettlementLocalizeCoatsAusfuehren($pdo, 40, 0, 5, $partial);
    assert($result['localized'] === 1 && $result['failed'] === 1 && $result['remaining'] === 1);
    assert($normal($state())[1] === $assigned[1]);
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
    assert($normal($state()) === $assigned);
    $revision = $pdo->query('SELECT revision FROM map_revision')->fetchColumn();
    $auditId = $last();
    $result = avesmapsWikiSettlementLocalizeCoatsAusfuehren($pdo, 40, 0, 5, static fn() => null);
    assert($result['localized'] === 0 && $result['failed'] === 2 && $last() === $auditId);
    assert($pdo->query('SELECT revision FROM map_revision')->fetchColumn() === $revision);
    $changed = static function ($url) use ($pdo, $download): array {
        $pdo->exec("UPDATE map_features SET revision = revision + 1");
        return $download($url);
    };
    wikiGroupReject(fn() => avesmapsWikiSettlementLocalizeCoatsAusfuehren($pdo, 40, 0, 5, $changed));
    assert($normal($state()) === $assigned && $last() === $auditId);
    // Neue Inhalte erhalten einen neuen Namen, ältere Rücknahmebelege behalten ihr Bild.
    avesmapsWikiSettlementLocalizeCoatsAusfuehren($pdo, 40, 0, 5, $download);
    $oldUrl = $normal($state())[0][2]['coat']['url'];
    $oldBytes = $bytes;
    avesmapsUndoAuditChange($pdo, ['audit_id' => $last()], ['id' => 6]);
    $bytes = str_replace('red', 'blue', $bytes);
    avesmapsWikiSettlementLocalizeCoatsAusfuehren($pdo, 40, 0, 5, $download);
    $newUrl = $normal($state())[0][2]['coat']['url'];
    assert($oldUrl !== $newUrl && file_get_contents($root . $oldUrl) === $oldBytes && file_get_contents($root . $newUrl) === $bytes);
} finally {
    foreach (glob($root . '/uploads/wappen/wiki/*') ?: [] as $file) unlink($file);
    foreach (['/uploads/wappen/wiki', '/uploads/wappen', '/uploads', ''] as $suffix) {
        if (is_dir($root . $suffix)) rmdir($root . $suffix);
    }
    $_SERVER['DOCUMENT_ROOT'] = $originalRoot;
}
echo "OK: Wappenfolge Zuordnung/Download lässt sich paketweise zurücknehmen und wiederherstellen.\n";

require_once __DIR__ . '/../wappen-aufraeumen.php';
foreach (['https://de.wiki-aventurica.de/images/Wappen_Gareth.svg', 'https://de.wiki-aventurica.de/de/index.php?title=Spezial:Dateipfad/Wappen%20Gareth.svg'] as $origin) {
    $coat = ['source' => 'wiki', 'url' => '/uploads/wappen/wiki/' . wikiGroupId(1) . '-' . str_repeat('a', 64) . '.svg', 'wiki_url' => $origin];
    assert(avesmapsWappenAufraeumenUrteil(['coat' => $coat])['tun'] === false);
    $coat['wiki_url'] = 'https://de.wiki-aventurica.de/images/Museum.jpg';
    assert(avesmapsWappenAufraeumenUrteil(['coat' => $coat])['tun'] === true);
    unset($coat['wiki_url']);
    assert(avesmapsWappenAufraeumenUrteil(['coat' => $coat])['tun'] === false);
}
