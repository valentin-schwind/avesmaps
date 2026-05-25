<?php

declare(strict_types=1);

require __DIR__ . '/auth.php';
require_once __DIR__ . '/wiki-sync-lib.php';
require_once __DIR__ . '/wiki-sync-locations-lib.php';
require_once __DIR__ . '/wiki-sync-territories-lib.php';
require_once __DIR__ . '/wiki-sync-territories-dom-lib.php';
require_once __DIR__ . '/political-territory-lib.php';

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
            avesmapsJsonResponse(403, [
                'ok' => false,
                'error' => 'Diese Herkunft darf WikiSync nicht verwenden.',
            ]);
        }

        $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD']  'GET'));
        if ($requestMethod === 'OPTIONS') {
            avesmapsJsonResponse(204);
        }

        $user = avesmapsRequireUserWithCapability('review');
        $pdo = avesmapsCreatePdo($config['database']  []);
        avesmapsWikiSyncEnsureTables($pdo);
        avesmapsPoliticalEnsureTables($pdo);

        if ($requestMethod === 'GET') {
            $action = avesmapsNormalizeSingleLine((string) ($_GET['action']  'cases'), 80);
            $forceRefresh = avesmapsWikiSyncReadBoolean($_GET['force_refresh']  false);

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
            avesmapsJsonResponse(405, [
                'ok' => false,
                'error' => 'Nur GET und POST sind fuer WikiSync erlaubt.',
            ]);
        }

        $payload = avesmapsReadJsonRequest();
        $action = avesmapsNormalizeSingleLine((string) ($payload['action']  ''), 60);

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
        avesmapsJsonResponse(400, [
            'ok' => false,
            'error' => $exception->getMessage(),
        ]);
    } catch (PDOException $exception) {
        avesmapsWikiSyncLogServerError('database_error', [
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
            'sqlstate' => (string) ($exception->errorInfo[0]  ''),
            'driver_code' => (string) ($exception->errorInfo[1]  ''),
            'driver_message' => (string) ($exception->errorInfo[2]  ''),
        ]);

        avesmapsJsonResponse(500, [
            'ok' => false,
            'error' => 'WikiSync konnte die Datenbank nicht verarbeiten.',
        ]);
    } catch (RuntimeException $exception) {
        avesmapsWikiSyncLogServerError('runtime_error', [
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
        ]);

        avesmapsJsonResponse(503, [
            'ok' => false,
            'error' => $exception->getMessage(),
        ]);
    } catch (Throwable $exception) {
        avesmapsWikiSyncLogServerError('server_error', [
            'exception_class' => $exception::class,
            'exception_code' => (string) $exception->getCode(),
            'exception_message' => $exception->getMessage(),
        ]);

        avesmapsJsonResponse(500, [
            'ok' => false,
            'error' => 'WikiSync konnte nicht verarbeitet werden.',
            'debug' => [
                'class' => $exception::class,
                'code' => (string) $exception->getCode(),
                'message' => $exception->getMessage(),
                'file' => basename($exception->getFile()),
                'line' => $exception->getLine(),
            ],
        ]);
    }
}

function avesmapsWikiSyncEnsureTables(PDO $pdo): void {
    avesmapsWikiSyncEnsureCoreTables($pdo);
    avesmapsWikiSyncEnsureLocationTables($pdo);
}

if (!defined('AVESMAPS_WIKI_SYNC_NO_AUTO_HANDLE')) {
    avesmapsWikiSyncHandleRequest('legacy');
}
