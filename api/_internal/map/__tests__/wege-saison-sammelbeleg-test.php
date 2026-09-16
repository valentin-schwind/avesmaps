<?php

declare(strict_types=1);

require __DIR__ . '/wege-gruppe-schreiben-test.php';
$pdo->sqliteCreateFunction('JSON_UNQUOTE', static fn($value) => $value, 1);
$pdo->exec('DELETE FROM map_feature_locks');

$window = ['from_month' => 'peraine', 'from_day' => 1, 'to_month' => 'boron', 'to_day' => 30];
$seasons = ['groupFoot' => $window, 'horseCarriage' => $window];
$payload = static fn(string $id, array $windows = []) => [
    'public_id' => $id, 'name' => 'Neuer Abschnittsname', 'feature_subtype' => 'Weg',
    'show_label' => true, 'allowed_transports' => ['groupFoot', 'horseCarriage'],
    'transport_seasons' => $windows,
];
$seedSeasons = static function (int $count, bool $assigned = true) use ($pdo, $LINIE): array {
    $pdo->exec('DELETE FROM map_feature_locks');
    $pdo->exec('DELETE FROM map_features');
    $pdo->exec('DELETE FROM map_audit_log');
    $pdo->exec('DELETE FROM map_revision');
    $insert = $pdo->prepare("INSERT INTO map_features (public_id, name, feature_type, feature_subtype,
        geometry_type, geometry_json, properties_json, is_active, revision)
        VALUES (?, 'Alter Abschnittsname', 'path', 'Weg', 'LineString', ?, ?, 1, 7)");
    $ids = [];
    for ($i = 1; $i <= $count; $i++) {
        $ids[] = sprintf('%08d-1111-4111-8111-111111111111', $i);
        $properties = ['name' => 'Alter Abschnittsname', 'allowed_transports' => ['groupFoot']];
        if ($assigned) {
            $properties['wiki_path'] = ['wiki_key' => 'testpass'];
        }
        $insert->execute([$ids[$i - 1], json_encode($LINIE), json_encode($properties)]);
    }

    return $ids;
};
$state = static fn() => $pdo->query('SELECT * FROM map_features ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
$lastAudit = static fn() => (int) $pdo->query('SELECT MAX(id) FROM map_audit_log')->fetchColumn();
$mustFail = static function (callable $run): void {
    try {
        $run();
    } catch (InvalidArgumentException | AvesmapsConflictException | PDOException $error) {
        return;
    }
    throw new RuntimeException('Die unzulässige Änderung wurde nicht abgelehnt.');
};

foreach ([1, 27, 250] as $count) {
    $ids = $seedSeasons($count);
    // Der Ausgangsabschnitt liegt absichtlich zuletzt: die Sperrreihenfolge muss trotzdem aufsteigend sein.
    $before = $state();
    avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[$count - 1], $seasons), $user);
    $saved = $state();
    $entry = $pdo->query('SELECT * FROM map_audit_log')->fetch(PDO::FETCH_ASSOC);
    assert((int) $pdo->query('SELECT COUNT(*) FROM map_audit_log')->fetchColumn() === 1);
    assert($entry['action'] === ($count > 1 ? 'update_path_group_details' : 'update_path_details'));
    foreach ($saved as $index => $row) {
        $properties = json_decode($row['properties_json'], true);
        assert(isset($properties['transport_seasons']['groupFoot']));
        if ($index < $count - 1) {
            assert(!isset($properties['transport_seasons']['horseCarriage']), 'Eigene Verkehrsmittel des Geschwisters gelten weiter');
            assert($row['name'] === 'Alter Abschnittsname');
        }
    }
    if ($count > 1) {
        $snapshot = json_decode($entry['after_json'], true);
        assert($snapshot['count'] === $count);
        assert(str_contains(avesmapsMapGroupAuditDetail($snapshot), 'Saisonfenster'));
    }
    avesmapsUndoAuditChange($pdo, ['audit_id' => (int) $entry['id']], ['id' => 6]);
    foreach ($state() as $index => $row) {
        assert($row['name'] === $before[$index]['name']);
        assert(json_decode($row['properties_json'], true) === json_decode($before[$index]['properties_json'], true));
    }
    avesmapsUndoAuditChange($pdo, ['audit_id' => $lastAudit()], $user);
    foreach ($state() as $index => $row) {
        assert($row['name'] === $saved[$index]['name']);
        assert(json_decode($row['properties_json'], true) === json_decode($saved[$index]['properties_json'], true));
    }
}

// Leeren ist ebenfalls eine Gruppenänderung; wiederholtes Speichern produziert keine leeren Gruppen.
$ids = $seedSeasons(3);
avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[0], $seasons), $user);
avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[0], $seasons), $user);
assert($pdo->query('SELECT action FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetchColumn() === 'update_path_details');
avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[0]), $user);
assert($pdo->query('SELECT action FROM map_audit_log ORDER BY id DESC LIMIT 1')->fetchColumn() === 'update_path_group_details');
foreach ($state() as $row) {
    assert(!isset(json_decode($row['properties_json'], true)['transport_seasons']));
}
avesmapsUndoAuditChange($pdo, ['audit_id' => $lastAudit()], $user);
foreach ($state() as $row) {
    assert(isset(json_decode($row['properties_json'], true)['transport_seasons']['groupFoot']));
}

// Fremde Sperre am letzten Geschwister und Fehler beim letzten Update rollen auch den Ausgangsabschnitt zurück.
$ids = $seedSeasons(3);
$before = $state();
$lock = $pdo->prepare("INSERT INTO map_feature_locks VALUES (?, 6, 'Andere Person', '2999-01-01')");
$lock->execute([$ids[2]]);
$mustFail(fn() => avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[0], $seasons), $user));
assert($state() === $before && $lastAudit() === 0);
$pdo->exec('DELETE FROM map_feature_locks');
$pdo->exec("CREATE TRIGGER fail_last BEFORE UPDATE ON map_features WHEN OLD.public_id = '" . $ids[2] . "' BEGIN SELECT RAISE(ABORT, 'Fixture'); END");
$mustFail(fn() => avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[0], $seasons), $user));
assert($state() === $before && $lastAudit() === 0);
$pdo->exec('DROP TRIGGER fail_last');

// Spätere Änderung eines Geschwisters blockiert die komplette Rücknahme.
avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[0], $seasons), $user);
$pdo->exec("UPDATE map_features SET name = 'Später geändert' WHERE public_id = '" . $ids[2] . "'");
$conflicted = $state();
$mustFail(fn() => avesmapsUndoAuditChange($pdo, ['audit_id' => $lastAudit()], $user));
assert($state() === $conflicted);

// Zwischen Kandidatensuche und Sperren darf kein inzwischen anders zugeordnetes Mitglied mitgeschrieben werden.
$ids = $seedSeasons(3);
$candidates = avesmapsReadPathSeasonEditCandidates($pdo, $ids[0]);
$pdo->exec("UPDATE map_features SET properties_json = '{\"wiki_path\":{\"wiki_key\":\"anderer-weg\"}}' WHERE public_id = '" . $ids[2] . "'");
$pdo->beginTransaction();
$mustFail(fn() => avesmapsFetchPathSeasonEditFeatures($pdo, $ids[0], $candidates));
$pdo->rollBack();

// Grenze gilt vor jeder Änderung; ohne gemeinsame Wiki-Zuordnung bleibt es eine Einzelaktion.
$ids = $seedSeasons(251);
$before = $state();
$mustFail(fn() => avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[0], $seasons), $user));
assert($state() === $before && $lastAudit() === 0);
$ids = $seedSeasons(3, false);
avesmapsUpdatePathFeatureDetails($pdo, $payload($ids[0], $seasons), $user);
assert($pdo->query('SELECT action FROM map_audit_log')->fetchColumn() === 'update_path_details');
assert(!isset(json_decode($state()[1]['properties_json'], true)['transport_seasons']));

echo "OK: Saisonweitergabe, Sammelbeleg, Undo/Redo, Grenzen und vollständiger Rollback.\n";
