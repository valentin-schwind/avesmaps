<?php

declare(strict_types=1);

require __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../auth.php';
require_once __DIR__ . '/../political-territory-lib.php';
require_once __DIR__ . '/../_internal/political/assignment.php';

$debugErrors = filter_var($_GET['debug_errors'] ?? false, FILTER_VALIDATE_BOOL);

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, [
            'ok' => false,
            'error' => 'Diese Herkunft darf Herrschaftsgebiete nicht laden.',
        ]);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsPoliticalEnsureTables($pdo);

    if ($requestMethod === 'GET') {
        $action = avesmapsNormalizeSingleLine((string) ($_GET['action'] ?? 'layer'), 60);
        if ($action === 'change_log') {
            $reviewUser = avesmapsRequireUserWithCapability('review');
            $response = avesmapsPoliticalReadChangeLog($pdo, avesmapsUserCan($reviewUser, 'edit'));
            avesmapsJsonResponse(200, $response);
        }

        $response = match ($action) {
            'layer' => avesmapsPoliticalReadLayer($pdo, $_GET),
            'list' => avesmapsPoliticalListTerritories($pdo, $_GET),
            'get' => avesmapsPoliticalGetTerritory($pdo, $_GET),
            'wiki' => avesmapsPoliticalGetWikiReference($pdo, $_GET),
            'wiki_list' => avesmapsPoliticalListWikiReferences($pdo, $_GET),
            'hierarchy' => avesmapsPoliticalReadHierarchy($pdo),
            'geometries' => avesmapsPoliticalReadGeometries($pdo, $_GET),
            'geometry_assignment' => avesmapsPoliticalGetGeometryAssignment($pdo, $_GET),
            'debug' => avesmapsPoliticalReadDebug($pdo, $_GET),
            'audit' => avesmapsPoliticalReadAudit($pdo, $_GET),
            default => throw new InvalidArgumentException('Die Herrschaftsgebiet-Aktion ist unbekannt.'),
        };

        avesmapsJsonResponse(200, $response);
    }

    if (!in_array($requestMethod, ['POST', 'PATCH', 'DELETE'], true)) {
        avesmapsJsonResponse(405, [
            'ok' => false,
            'error' => 'Nur GET, POST, PATCH und DELETE sind fuer Herrschaftsgebiete erlaubt.',
        ]);
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 80);
    $response = match ($action) {
        'create_territory' => avesmapsPoliticalCreateTerritory($pdo, $payload, $user),
        'update_territory' => avesmapsPoliticalUpdateTerritory($pdo, $payload, $user),
        'delete_territory' => avesmapsPoliticalDeleteTerritory($pdo, $payload),
        'save_hierarchy' => avesmapsPoliticalSaveHierarchy($pdo, $payload),
        'create_geometry' => avesmapsPoliticalCreateGeometry($pdo, $payload, $user),
        'update_geometry' => avesmapsPoliticalUpdateGeometry($pdo, $payload, $user),
        'split_geometry' => avesmapsPoliticalSplitGeometry($pdo, $payload, $user),
        'assign_geometry' => avesmapsPoliticalAssignGeometryToTerritory($pdo, $payload),
        'save_geometry_assignment' => avesmapsPoliticalSaveGeometryAssignment($pdo, $payload, $user),
        'unassign_geometry' => avesmapsPoliticalUnassignGeometry($pdo, $payload),
        'delete_geometry' => avesmapsPoliticalDeleteGeometry($pdo, $payload, $user),
        'delete_geometry_part' => avesmapsPoliticalDeleteGeometryPart($pdo, $payload, $user),
        'geometry_operation' => avesmapsPoliticalApplyGeometryOperationResult($pdo, $payload, $user),
        'geometry_operation_debug' => avesmapsPoliticalDebugGeometryOperation($payload),
        'undo_audit_change' => avesmapsPoliticalUndoAuditChange($pdo, $payload, $user),
        'ensure_wiki_territory_chain' => avesmapsPoliticalEnsureWikiTerritoryChain($pdo, $payload, $user),
        'restore_legacy_region_geometries' => avesmapsPoliticalRestoreLegacyRegionGeometries($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Herrschaftsgebiet-Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $response);
} catch (InvalidArgumentException $exception) {
    $response = [
        'ok' => false,
        'error' => $exception->getMessage(),
    ];
    if ($debugErrors) {
        $response['exception'] = avesmapsPoliticalDebugExceptionPayload($exception);
    }
    avesmapsJsonResponse(400, $response);
} catch (PDOException $exception) {
    $response = [
        'ok' => false,
        'error' => 'Die Herrschaftsgebiete konnten nicht aus der Datenbank verarbeitet werden.',
    ];
    if ($debugErrors) {
        $response['exception'] = avesmapsPoliticalDebugExceptionPayload($exception);
    }
    avesmapsJsonResponse(500, $response);
} catch (RuntimeException $exception) {
    $response = [
        'ok' => false,
        'error' => $exception->getMessage(),
    ];
    if ($debugErrors) {
        $response['exception'] = avesmapsPoliticalDebugExceptionPayload($exception);
    }
    avesmapsJsonResponse(503, $response);
} catch (Throwable $exception) {
    $response = [
        'ok' => false,
        'error' => 'Die Herrschaftsgebiete konnten nicht verarbeitet werden.',
    ];
    if ($debugErrors) {
        $response['exception'] = avesmapsPoliticalDebugExceptionPayload($exception);
    }
    avesmapsJsonResponse(500, $response);
}

function avesmapsPoliticalDebugExceptionPayload(Throwable $exception): array {
    return [
        'type' => $exception::class,
        'message' => $exception->getMessage(),
        'file' => basename((string) $exception->getFile()),
        'line' => $exception->getLine(),
    ];
}
