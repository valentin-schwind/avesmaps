<?php

declare(strict_types=1);

require __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../auth.php';
require_once __DIR__ . '/territory.php';
require_once __DIR__ . '/assignment.php';
require_once __DIR__ . '/assignment-geometry-validity.php';
require_once __DIR__ . '/assignment-save-guard.php';
require_once __DIR__ . '/territories-support.php';
require_once __DIR__ . '/territories-layer.php';
require_once __DIR__ . '/territories-derived-geometry-shared.php';
require_once __DIR__ . '/territories-derived-layer.php';
require_once __DIR__ . '/territories-read.php';
require_once __DIR__ . '/territories-write.php';
require_once __DIR__ . '/territories-geometry.php';
require_once __DIR__ . '/territories-derived-geometry.php';
require_once __DIR__ . '/territories-derived-geometry-sources-fallback.php';
require_once __DIR__ . '/territories-derived-geometry-plan.php';
require_once __DIR__ . '/territories-boundary-debug.php';
require_once __DIR__ . '/territories-audit.php';
require_once __DIR__ . '/territories-debug.php';
require_once __DIR__ . '/territories-geometry-inventory.php';
require_once __DIR__ . '/territories-claims.php';

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
    avesmapsPoliticalEnsureDerivedGeometryTables($pdo);

    if ($requestMethod === 'GET') {
        $action = avesmapsNormalizeSingleLine((string) ($_GET['action'] ?? 'layer'), 60);
        if ($action === 'change_log') {
            $reviewUser = avesmapsRequireUserWithCapability('review');
            $response = avesmapsPoliticalReadChangeLog($pdo, avesmapsUserCan($reviewUser, 'edit'));
            avesmapsJsonResponse(200, $response);
        }

        if ($action === 'geometry_inventory') {
            avesmapsRequireUserWithCapability('review');
            $response = avesmapsPoliticalReadGeometryInventory($pdo, $_GET);
            avesmapsJsonResponse(200, $response);
        }

        if ($action === 'geometry_collision') {
            avesmapsRequireUserWithCapability('review');
            $response = avesmapsPoliticalReadGeometryCollision($pdo, $_GET);
            avesmapsJsonResponse(200, $response);
        }

        if ($action === 'geometry_assignment') {
            try {
                $response = avesmapsPoliticalGetGeometryAssignment($pdo, $_GET);
            } catch (InvalidArgumentException $exception) {
                $geometryPublicId = avesmapsNormalizeSingleLine((string) ($_GET['geometry_public_id'] ?? $_GET['public_id'] ?? ''), 80);
                if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $geometryPublicId) !== 1) {
                    throw $exception;
                }

                $response = [
                    'ok' => true,
                    'geometry' => null,
                    'assignment' => null,
                    'geometry_public_id' => $geometryPublicId,
                    'missing_geometry_assignment' => true,
                    'message' => 'Noch keine gespeicherten Eigenschaften für diese Geometrie vorhanden.',
                ];
            }

            avesmapsJsonResponse(200, $response);
        }

        if ($action === 'layer') {
            $layerCacheFile = avesmapsPoliticalLayerCacheFile($_GET);
            $layerCacheTtl = avesmapsPoliticalLayerCacheTtlSeconds($_GET);
            if (is_file($layerCacheFile) && (time() - (int) @filemtime($layerCacheFile)) < $layerCacheTtl) {
                $cachedLayer = @file_get_contents($layerCacheFile);
                if (is_string($cachedLayer) && $cachedLayer !== '') {
                    http_response_code(200);
                    header('Content-Type: application/json; charset=utf-8');
                    header('X-Avesmaps-Layer-Cache: hit');
                    echo $cachedLayer;
                    exit;
                }
            }
            $response = avesmapsPoliticalReadLayerWithDerivedGeometry($pdo, $_GET);
            try {
                $encodedLayer = json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
                $tmpLayer = $layerCacheFile . '.' . getmypid() . '.tmp';
                if (@file_put_contents($tmpLayer, $encodedLayer, LOCK_EX) !== false) {
                    @rename($tmpLayer, $layerCacheFile);
                }
                http_response_code(200);
                header('Content-Type: application/json; charset=utf-8');
                header('X-Avesmaps-Layer-Cache: miss');
                echo $encodedLayer;
                exit;
            } catch (Throwable $layerCacheError) {
                avesmapsJsonResponse(200, $response);
            }
        }

        $response = match ($action) {
            'layer' => avesmapsPoliticalReadLayerWithDerivedGeometry($pdo, $_GET),
            'list' => avesmapsPoliticalListTerritories($pdo, $_GET),
            'get' => avesmapsPoliticalGetTerritory($pdo, $_GET),
            'territory_bounds' => avesmapsPoliticalReadTerritoryBounds($pdo, $_GET),
            'wiki' => avesmapsPoliticalGetWikiReference($pdo, $_GET),
            'wiki_list' => avesmapsPoliticalListWikiReferences($pdo, $_GET),
            'hierarchy' => avesmapsPoliticalReadHierarchy($pdo),
            'geometries' => avesmapsPoliticalReadGeometries($pdo, $_GET),
            'derived_geometry', 'get_derived_geometry' => avesmapsPoliticalReadDerivedGeometry($pdo, $_GET),
            'derived_geometry_sources', 'get_derived_geometry_sources' => avesmapsPoliticalReadDerivedGeometrySourcesWithGeometryFallback($pdo, $_GET),
            'derived_geometry_plan', 'get_derived_geometry_plan' => avesmapsPoliticalReadDerivedGeometryPlan($pdo, $_GET),
            'debug_boundary_contract', 'boundary_contract_debug' => avesmapsPoliticalReadBoundaryContractDebug($pdo, $_GET),
            'debug' => avesmapsPoliticalReadDebug($pdo, $_GET),
            'audit' => avesmapsPoliticalReadAudit($pdo, $_GET),
            'list_claims' => avesmapsPoliticalListClaims($pdo, $_GET),
            'suggest_claims' => avesmapsPoliticalSuggestClaims($pdo, $_GET),
            'editor_open_target' => avesmapsPoliticalResolveEditorTarget($pdo, $_GET),
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
        'save_wiki_node_settings' => avesmapsPoliticalSaveWikiNodeSettings($pdo, $payload, $user),
        'delete_territory' => avesmapsPoliticalDeleteTerritory($pdo, $payload),
        'save_hierarchy' => avesmapsPoliticalSaveHierarchy($pdo, $payload),
        'create_geometry' => avesmapsPoliticalCreateGeometry($pdo, $payload, $user),
        'update_geometry' => avesmapsPoliticalUpdateGeometry($pdo, $payload, $user),
        'split_geometry' => avesmapsPoliticalSplitGeometry($pdo, $payload, $user),
        'assign_geometry' => avesmapsPoliticalAssignGeometryToTerritoryWithValidity($pdo, $payload, $user),
        'save_geometry_assignment' => avesmapsPoliticalSaveGeometryAssignmentSafely($pdo, $payload, $user),
        'save_derived_geometry' => avesmapsPoliticalSaveDerivedGeometry($pdo, $payload, $user),
        'delete_derived_geometry' => avesmapsPoliticalDeleteDerivedGeometry($pdo, $payload, $user),
        'delete_derived_geometry_tree' => avesmapsPoliticalDeleteDerivedGeometryTree($pdo, $payload, $user),
        'unassign_geometry' => avesmapsPoliticalUnassignGeometry($pdo, $payload),
        'delete_geometry' => avesmapsPoliticalDeleteGeometry($pdo, $payload, $user),
        'delete_geometry_part' => avesmapsPoliticalDeleteGeometryPart($pdo, $payload, $user),
        'hard_delete_geometry' => avesmapsPoliticalHardDeleteUnassignedGeometry($pdo, $payload, $user),
        'purge_unassigned_geometries' => avesmapsPoliticalPurgeUnassignedGeometries($pdo, $payload, $user),
        'geometry_operation' => avesmapsPoliticalApplyGeometryOperationResult($pdo, $payload, $user),
        'geometry_operation_debug' => avesmapsPoliticalDebugGeometryOperation($payload),
        'undo_audit_change' => avesmapsPoliticalUndoAuditChange($pdo, $payload, $user),
        'ensure_wiki_territory_chain' => avesmapsPoliticalEnsureWikiTerritoryChain($pdo, $payload, $user),
        'restore_legacy_region_geometries' => avesmapsPoliticalRestoreLegacyRegionGeometries($pdo, $payload, $user),
        'deactivate_legacy_regions' => avesmapsPoliticalDeactivateLegacyRegions($pdo, $payload, $user),
        'add_claim' => avesmapsPoliticalAddClaim($pdo, $payload, $user),
        'remove_claim' => avesmapsPoliticalRemoveClaim($pdo, $payload, $user),
        default => throw new InvalidArgumentException('Die Herrschaftsgebiet-Aktion ist unbekannt.'),
    };

    avesmapsPoliticalInvalidateLayerCache(); // Schreibvorgang -> Layer-Cache leeren, naechster Load ist frisch.
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
