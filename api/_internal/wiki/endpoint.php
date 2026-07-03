<?php

declare(strict_types=1);

require __DIR__ . '/../auth.php';
require_once __DIR__ . '/sync.php';
require_once __DIR__ . '/locations.php';
require_once __DIR__ . '/territories.php';
require_once __DIR__ . '/territories-dom.php';
require_once __DIR__ . '/../political/territory.php';
// coordinate_drift resolution ("Auf Wiki-Position setzen") reuses the shared
// map geometry-write helper avesmapsMovePointFeature (+ its lock/revision guard).
// The internal map lib defines only DEFS (it is include-safe: no top-level code),
// but the AvesmapsConflictException class it THROWS is declared only at the edit
// endpoint layer (api/edit/map/features.php). Declare it here (guarded) so the
// move helper's lock/stale-revision throw resolves to a real class instead of a
// fatal "class not found". No function-name collision with the WikiSync chain:
// features.php uses unprefixed names, the WikiSync helpers use avesmapsWikiSync*.
require_once __DIR__ . '/../map/features.php';
if (!class_exists('AvesmapsConflictException')) {
    class AvesmapsConflictException extends RuntimeException {
    }
}

function avesmapsWikiSyncAssertEndpointScope(string $endpointScope, array $allowedScopes, string $action): void {
    if (in_array($endpointScope, $allowedScopes, true)) {
        return;
    }

    throw new InvalidArgumentException("Diese WikiSync-Aktion ist an diesem Endpoint nicht erlaubt: {$action}");
}

function avesmapsWikiSyncHandleRequest(string $endpointScope = 'legacy'): void {
    try {
        $config = avesmapsLoadApiConfig(__DIR__);

        if (!avesmapsApplyCorsPolicy($config)) {
            avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf WikiSync nicht verwenden.');
        }

        $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($requestMethod === 'OPTIONS') {
            avesmapsJsonResponse(204);
        }

        $user = avesmapsRequireUserWithCapability('review');
        $pdo = avesmapsCreatePdo($config['database'] ?? []);
        avesmapsWikiSyncEnsureTables($pdo);
        avesmapsPoliticalEnsureTables($pdo);

        if ($requestMethod === 'GET') {
            $action = avesmapsNormalizeSingleLine((string) ($_GET['action'] ?? 'cases'), 80);
            $forceRefresh = avesmapsWikiSyncReadBoolean($_GET['force_refresh'] ?? false);

            $response = match ($action) {
                'cases', '' => (function () use ($pdo, $endpointScope, $action): array {
                    avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                    return avesmapsWikiSyncListCases($pdo);
                })(),

                'territories_tree' => (function () use ($pdo, $forceRefresh, $endpointScope, $action): array {
                    avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'territories'], $action);
                    return avesmapsWikiSyncReadPoliticalTerritoryDomTree($pdo, $forceRefresh);
                })(),

                'political_territory_tree' => (function () use ($pdo, $forceRefresh, $endpointScope, $action): array {
                    avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'territories'], $action);
                    return avesmapsWikiSyncReadPoliticalTerritoryDomTree($pdo, $forceRefresh);
                })(),

                default => throw new InvalidArgumentException('Die WikiSync-Aktion ist unbekannt.'),
            };

            avesmapsJsonResponse(200, $response);
        }

        if ($requestMethod !== 'POST') {
            avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET und POST sind fuer WikiSync erlaubt.');
        }

        $payload = avesmapsReadJsonRequest();
        $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 60);

        $response = match ($action) {
            'start_run' => (function () use ($pdo, $user, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncStartRun($pdo, $user);
            })(),

            'advance_run' => (function () use ($pdo, $payload, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncAdvanceRun($pdo, $payload);
            })(),

            'defer_case' => (function () use ($pdo, $payload, $user, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'deferred');
            })(),

            'archive_case' => (function () use ($pdo, $payload, $user, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'archived');
            })(),

            'reopen_case' => (function () use ($pdo, $payload, $user, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncUpdateCaseStatus($pdo, $payload, $user, 'open');
            })(),

            'resolve_case' => (function () use ($pdo, $payload, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncResolveCase($pdo, $payload, avesmapsRequireUserWithCapability('edit'));
            })(),

            // coordinate_drift resolution ("Auf Wiki-Position setzen"): a SIBLING of
            // resolve_case (NOT an extension of the property-coupled resolver). Same
            // 'edit' capability; the reused avesmapsMovePointFeature adds the SAME
            // lock + expected_revision guard drag-to-move uses, then the case is
            // archived. The ONLY new map write in the WikiDump rollout -- per-case,
            // on an explicit click, never automatic/bulk.
            'set_geometry_to_wiki' => (function () use ($pdo, $payload, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'locations'], $action);
                return avesmapsWikiSyncSetGeometryToWiki($pdo, $payload, avesmapsRequireUserWithCapability('edit'));
            })(),

            'sync_territories' => (function () use ($pdo, $payload, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'territories'], $action);
                return avesmapsWikiSyncSyncTerritoriesFromDomCache($pdo, avesmapsRequireUserWithCapability('edit'), $payload);
            })(),

            'clear_territory_wiki_table' => (function () use ($pdo, $endpointScope, $action): array {
                avesmapsWikiSyncAssertEndpointScope($endpointScope, ['legacy', 'territories'], $action);
                avesmapsRequireUserWithCapability('edit');
                return avesmapsWikiSyncClearPoliticalTerritoryWikiTable($pdo);
            })(),

            default => throw new InvalidArgumentException('Die WikiSync-Aktion ist unbekannt.'),
        };

        avesmapsJsonResponse(200, $response);
    } catch (InvalidArgumentException $exception) {
        avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
    } catch (AvesmapsConflictException $exception) {
        // Stale expected_revision or a lock held by another editor, thrown by the
        // reused avesmapsMovePointFeature (set_geometry_to_wiki). Must be caught
        // BEFORE the RuntimeException arm below (it extends RuntimeException) so a
        // concurrency conflict surfaces as HTTP 409 with the German message, and
        // the frontend's 409 handler (pollLiveMapUpdates) refreshes the map.
        avesmapsErrorResponse(409, 'conflict', $exception->getMessage());
    } catch (PDOException $exception) {
        avesmapsWikiSyncLogServerError('database_error', [
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
            'sqlstate' => (string) ($exception->errorInfo[0] ?? ''),
            'driver_code' => (string) ($exception->errorInfo[1] ?? ''),
            'driver_message' => (string) ($exception->errorInfo[2] ?? ''),
        ]);

        avesmapsErrorResponse(500, 'server_error', 'WikiSync konnte die Datenbank nicht verarbeiten.');
    } catch (RuntimeException $exception) {
        avesmapsWikiSyncLogServerError('runtime_error', [
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
        ]);

        avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('server_error', [
            'exception_class' => $exception::class,
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
        ]);

        avesmapsErrorResponse(500, 'server_error', 'WikiSync konnte nicht verarbeitet werden.');
    }
}

function avesmapsWikiSyncEnsureTables(PDO $pdo): void {
    avesmapsWikiSyncEnsureCoreTables($pdo);
    avesmapsWikiSyncEnsureLocationTables($pdo);
}

if (!defined('AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE')) {
    avesmapsWikiSyncHandleRequest('legacy');
}
