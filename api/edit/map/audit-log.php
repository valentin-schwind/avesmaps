<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';
// 💣 THE UNDO GATE HAS TO BE THE SAME FUNCTION ON BOTH SIDES. This file used to carry its own copy of
// avesmapsCanUndoAuditAction (a hardcoded whitelist) next to the one the write path uses (derived from
// the undo column map). Nothing loaded both, so nothing ever failed loudly -- they simply drifted, and
// on 2026-07-26 the read copy said "no" to entries the write path had just learned to accept, so the
// Wiederherstellen button never appeared. avesmapsEnsureMapAuditUndoColumns and
// avesmapsFetchTableColumnNames were byte-identical duplicates of the same kind and are gone too.
require_once __DIR__ . '/../../_internal/map/features.php';
// „Was hat dieser Schritt getan?" -- die Erklaerzeile. Sie leitet sich aus denselben Spalten ab,
// die avesmapsUndoColumnsForAuditAction() beim Zuruecknehmen wirklich zurueckschreibt.
require_once __DIR__ . '/../../_internal/audit-detail.php';
// „Zeig mir die Zeilen DIESER Leute" -- ohne Auswahl die juengsten von allen, mit Auswahl die
// juengsten von den Ausgewaehlten. Erst moeglich, seit jedes Protokoll je Person aufraeumt.
require_once __DIR__ . '/../../_internal/audit-filter.php';
// „Wo auf der Karte war das?" -- der Sprungpunkt hinter dem Fadenkreuz. 💣 Die Rechnung stand
// dreimal im Haus (hier, in territories-audit.php, gar nicht bei den Landschaften); jetzt einmal,
// weil ein Editor sonst je nach Objektart an verschiedene Stellen springt.
require_once __DIR__ . '/../../_internal/audit-focus.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Änderungsverlauf nicht lesen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMapAuditUndoColumnsEinmal($pdo);
    avesmapsJsonResponse(200, avesmapsListMapAuditLog(
        $pdo,
        avesmapsUserCan($user, 'edit'),
        avesmapsAuditReadEditorNames($_GET['editors'] ?? null)
    ));
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Der Änderungsverlauf konnte nicht geladen werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Der Änderungsverlauf konnte nicht verarbeitet werden.');
}

function avesmapsListMapAuditLog(PDO $pdo, bool $canUndoChanges, array $editorNames = []): array {
    [$wo, $parameter] = avesmapsAuditActorWhereClause(
        avesmapsAuditResolveActorFilter($pdo, $editorNames),
        'audit.actor_user_id'
    );
    // ⚠️ prepare/execute statt query(), seit die Bedingung Parameter tragen kann. Ohne Auswahl ist
    // sie „1 = 1" und die Abfrage genau die von vorher.
    $statement = $pdo->prepare(
        'SELECT
            audit.id,
            audit.feature_id,
            audit.action,
            audit.created_at,
            audit.after_json,
            audit.before_json,
            audit.undone_at,
            audit.undo_audit_id,
            features.public_id,
            features.feature_type,
            features.feature_subtype,
            features.name,
            features.geometry_json AS current_geometry_json,
            features.min_x AS current_min_x,
            features.min_y AS current_min_y,
            features.max_x AS current_max_x,
            features.max_y AS current_max_y,
            features.is_active AS current_is_active,
            users.username,
            undone_users.username AS undone_username
        FROM map_audit_log audit
        LEFT JOIN map_features features ON features.id = audit.feature_id
        LEFT JOIN users ON users.id = audit.actor_user_id
        LEFT JOIN users undone_users ON undone_users.id = audit.undone_by
        WHERE ' . $wo . '
        ORDER BY audit.created_at DESC, audit.id DESC
        LIMIT 200'
    );
    $statement->execute($parameter);
    $rows = $statement->fetchAll();

    return [
        'ok' => true,
        // Die Namensliste des Trichters -- ueber die GANZE Tabelle gezaehlt, nie aus den gelieferten
        // Zeilen abgeleitet. Sonst sperrt sich der Trichter beim ersten Haken selbst zu.
        'actors' => avesmapsAuditActorRoster($pdo, 'map_audit_log'),
        'changes' => array_map(
            static fn(array $row): array => avesmapsNormalizeAuditRow($row, $canUndoChanges),
            $rows
        ),
    ];
}

function avesmapsNormalizeAuditRow(array $row, bool $canUndoChanges): array {
    $after = avesmapsDecodeAuditJson($row['after_json'] ?? null);
    $before = avesmapsDecodeAuditJson($row['before_json'] ?? null);
    $isUndone = (string) ($row['undone_at'] ?? '') !== '';
    $action = (string) $row['action'];

    return [
        'id' => (int) $row['id'],
        'action' => $action,
        'created_at' => (string) $row['created_at'],
        'username' => (string) ($row['username'] ?? ''),
        // 💣 WER, WENN ES KEIN MENSCH WAR (Befund A39). Die Import-Tuer moderiert mit einem Token;
        // `actor_user_id` ist dann 0, der LEFT JOIN findet niemanden, und die Oberflaeche schrieb
        // „unbekannt" -- eine Behauptung ueber einen Menschen, den es nie gab. Der Vermerk kommt aus
        // dem after_json, das ihn seit dem 06.08.2026 mitfuehrt.
        // ⚠️ Eigenes Feld, NICHT in `username` hineingeschrieben: dort steht der Name einer Person,
        // und „import" waere dort eine Person namens import. Die Oberflaeche entscheidet, wie sie es
        // nennt -- hier steht nur, was zutrifft.
        'actor_source' => (string) ($after['actor_source'] ?? ''),
        'undone' => $isUndone,
        'undone_at' => (string) ($row['undone_at'] ?? ''),
        'undone_username' => (string) ($row['undone_username'] ?? ''),
        'undo_audit_id' => (int) ($row['undo_audit_id'] ?? 0),
        'can_undo' => $canUndoChanges && !$isUndone && avesmapsCanUndoAuditAction($action),
        'public_id' => (string) ($row['public_id'] ?? ($after['public_id'] ?? $before['public_id'] ?? '')),
        'feature_type' => (string) ($row['feature_type'] ?? ($after['feature_type'] ?? $before['feature_type'] ?? '')),
        'feature_subtype' => (string) ($row['feature_subtype'] ?? ($after['feature_subtype'] ?? $before['feature_subtype'] ?? '')),
        'name' => (string) ($row['name'] ?? ($after['name'] ?? $before['name'] ?? '')),
        // Was der Schritt getan hat, in einem Satz -- leer, wenn sich nichts sagen laesst. Die
        // Spaltenliste kommt von der Undo-Seite, damit Zeile und Knopf dasselbe meinen.
        'detail' => avesmapsMapAuditDetailText($action, $before, $after, avesmapsUndoColumnsForAuditAction($action)),
        'focus' => avesmapsBuildAuditFocusTarget($row, $before, $after),
    ];
}

function avesmapsBuildAuditFocusTarget(array $row, array $before, array $after): ?array {
    $current = [
        'geometry_json' => $row['current_geometry_json'] ?? null,
        'min_x' => $row['current_min_x'] ?? null,
        'min_y' => $row['current_min_y'] ?? null,
        'max_x' => $row['current_max_x'] ?? null,
        'max_y' => $row['current_max_y'] ?? null,
        'is_active' => $row['current_is_active'] ?? null,
    ];
    $snapshots = avesmapsFocusSnapshotOrder((string) $row['action'], $before, $after, $current);
    foreach ($snapshots as $snapshot) {
        $geometry = avesmapsAuditReadGeometry($snapshot['geometry_json'] ?? null);
        if ($geometry === null) {
            continue;
        }

        return avesmapsAuditFocusFromGeometry($geometry);
    }

    return null;
}

function avesmapsFocusSnapshotOrder(string $action, array $before, array $after, array $current): array {
    if ($action === 'delete_feature' || str_starts_with($action, 'undo_create_') || avesmapsSnapshotIsInactive($after)) {
        return [$before, $after, $current];
    }

    return [$after, $before, $current];
}

function avesmapsSnapshotIsInactive(array $snapshot): bool {
    return array_key_exists('is_active', $snapshot) && (int) $snapshot['is_active'] !== 1;
}

function avesmapsDecodeAuditJson(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    try {
        $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($decoded) ? $decoded : [];
}
