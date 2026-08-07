<?php

declare(strict_types=1);

// Authed Endpoint der neuen Sync-Monitor-Surface (Herrschaftsgebiete-Crawler-Rework).
// Bewusst isoliert vom Legacy-WikiSync-Dispatcher (endpoint.php). Nutzt die geteilte
// authed Plumbing (bootstrap/auth) + den vorhandenen Wiki-API-Client/Parser und die
// Sandbox-Logik in _internal/wiki/sync-monitor.php.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/sync.php';
require_once __DIR__ . '/../../_internal/wiki/locations.php';
require_once __DIR__ . '/../../_internal/wiki/territories.php';
require_once __DIR__ . '/../../_internal/political/territory.php';
require_once __DIR__ . '/../../_internal/wiki/sync-monitor.php';
require_once __DIR__ . '/../../_internal/wiki/sync-plan.php';
require_once __DIR__ . '/../../_internal/wiki/territory-wiki-plan.php';
require_once __DIR__ . '/../../_internal/wiki/territory-plan.php';
// dump-reader.php -- home of AVESMAPS_WIKI_DUMP_STEP_SECONDS, which both compute steps below read for
// their per-step time budget. Not in sync-constants.php; without this require both are a fatal on the
// first request. sync-monitor-model.php / sync-monitor-identity.php (also read by the two compute
// steps) already arrive via the sync-monitor.php require just above -- see its own require_once list.
require_once __DIR__ . '/../../_internal/wiki/dump-reader.php';
require_once __DIR__ . '/../../_internal/app/coat-display.php';
// Only for avesmapsPoliticalInvalidateLayerCache(): the "Wappen: An/Aus" toggle changes what the layer
// payload contains, and the layer's file cache would otherwise serve the old URLs for up to 300 s.
require_once __DIR__ . '/../../_internal/political/territories-derived-layer.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Sync-Monitor nicht verwenden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($requestMethod === 'POST') {
        // upload_coat kommt als multipart/form-data (Datei-Upload) -> dann liegen die Felder in $_POST
        // und die Datei in $_FILES; php://input ist leer und waere kein gueltiges JSON. Sonst JSON-Body.
        $isMultipart = strpos(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'multipart/form-data') !== false;
        $payload = $isMultipart ? $_POST : avesmapsReadJsonRequest();
        $action = trim((string) ($payload['action'] ?? ($_GET['action'] ?? '')));
        $options = is_array($payload['options'] ?? null) ? $payload['options'] : $payload;

        // The two territory compute actions below OVERRIDE any open plan of the same kind (design
        // §6b) -- so gate them at 'edit', stricter than this endpoint's overall 'review'. The sheet
        // that reads/ticks/applies a plan (api/edit/wiki/sync-plan.php) already requires 'edit';
        // without this, a review-only account could wipe out an open preview another editor is
        // working through and could not even see the sheet that shows what got lost.
        if (in_array($action, ['build_territory_wiki_plan', 'build_territory_plan'], true)) {
            avesmapsRequireUserWithCapability('edit');
        }

        $response = match ($action) {
            'start_run' => avesmapsWikiSyncMonitorStartRun(
                $pdo,
                avesmapsWikiSyncMonitorSeedsFromInput($payload['seeds'] ?? ''),
                $options
            ),
            'crawl_step' => avesmapsWikiSyncMonitorCrawlStep(
                $pdo,
                trim((string) ($payload['run_id'] ?? '')),
                $options
            ),
            'rebuild_model' => avesmapsWikiSyncMonitorRebuildModel($pdo),
            'enrich_licenses' => avesmapsWikiSyncMonitorEnrichLicenses($pdo, $options),
            'sync_parent_cache' => avesmapsWikiSyncMonitorSyncParentCache(
                $pdo,
                // Schreiben NUR bei dry_run:false UND confirm:"apply"; sonst immer lesender Dry-Run.
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'apply_parent_cache' => avesmapsWikiSyncMonitorApplyParentCache(
                $pdo,
                is_array($payload['skip'] ?? null) ? $payload['skip'] : [],
                // Schreiben NUR bei dry_run:false UND confirm:"apply"; sonst immer lesender Dry-Run.
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                is_array($payload['only'] ?? null) ? $payload['only'] : null
            ),
            'set_territory_trashed' => avesmapsWikiSyncMonitorSetTerritoryTrashed(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                (bool) ($payload['trashed'] ?? true),
                // Schreiben NUR bei dry_run:false UND confirm:"apply"; sonst lesender Dry-Run.
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'set_parent' => avesmapsWikiSyncMonitorSetParent(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                array_key_exists('parent_wiki_key', $payload) ? ($payload['parent_wiki_key'] !== null ? (string) $payload['parent_wiki_key'] : null) : null,
                (bool) ($payload['lock'] ?? true)
            ),
            'set_excluded' => avesmapsWikiSyncMonitorSetExcluded(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                (bool) ($payload['excluded'] ?? true)
            ),
            'create_custom_node' => avesmapsWikiSyncMonitorCreateCustomNode(
                $pdo,
                (string) ($payload['name'] ?? '')
            ),
            'delete_custom_node' => avesmapsWikiSyncMonitorDeleteCustomNode(
                $pdo,
                (string) ($payload['wiki_key'] ?? '')
            ),
            'apply_custom_nodes' => avesmapsWikiSyncMonitorApplyCustomNodes(
                $pdo,
                // Schreiben NUR bei dry_run:false UND confirm:"apply"; sonst lesender Dry-Run.
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply'),
                is_array($payload['only'] ?? null) ? $payload['only'] : null
            ),
            'apply_identity' => avesmapsWikiSyncMonitorApplyIdentity(
                $pdo,
                is_array($payload['skip'] ?? null) ? $payload['skip'] : [],
                // null, nicht []: seit der only-Vereinheitlichung heisst [] „waehle nichts" und null
                // „keine Einschraenkung" -- wie beim apply_parent_cache-Arm darueber. Ein fehlendes
                // `only` im Aufruf ist das alte, uneingeschraenkte Verhalten dieser Aktion.
                is_array($payload['only'] ?? null) ? $payload['only'] : null,
                (int) ($payload['limit'] ?? 0),
                // Schreiben NUR bei dry_run:false UND confirm:"apply"; sonst immer lesender Dry-Run.
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'revert_identity' => avesmapsWikiSyncMonitorRevertIdentity(
                $pdo,
                (string) ($payload['batch_id'] ?? ''),
                // Schreiben NUR bei dry_run:false UND confirm:"apply"; sonst immer lesender Dry-Run.
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'apply_coats' => avesmapsWikiSyncMonitorApplyCoats(
                $pdo,
                // Schreiben NUR bei dry_run:false UND confirm:"apply"; sonst immer lesender Dry-Run.
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'revert_coats' => avesmapsWikiSyncMonitorRevertCoats(
                $pdo,
                (string) ($payload['batch_id'] ?? ''),
                !(($payload['dry_run'] ?? true) === false && (string) ($payload['confirm'] ?? '') === 'apply')
            ),
            'set_field_override' => avesmapsWikiSyncMonitorSetFieldOverride(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                (string) ($payload['field_key'] ?? ''),
                array_key_exists('value', $payload) ? ($payload['value'] !== null ? (string) $payload['value'] : '') : null
            ),
            'clear_field_override' => avesmapsWikiSyncMonitorClearFieldOverride(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                (string) ($payload['field_key'] ?? '')
            ),
            'save_coat_local' => avesmapsWikiSyncMonitorSaveCoatLocal(
                $pdo,
                (string) ($payload['wiki_key'] ?? '')
            ),
            'localize_coats' => avesmapsWikiSyncMonitorLocalizeCoats($pdo, $options),
            // Global "Wappen: An/Aus" for the TERRITORY coats (ribbon toggle). No dry_run -- always a real
            // write, like the settlement-image switch it mirrors.
            'set_territory_coats_enabled' => avesmapsSetTerritoryCoatsEnabled($pdo, (bool) ($payload['enabled'] ?? true)),
            'upload_coat' => avesmapsWikiSyncMonitorUploadCoat(
                $pdo,
                (string) ($payload['wiki_key'] ?? ''),
                (string) ($payload['source_url'] ?? ''),
                (string) ($payload['license'] ?? ''),
                (string) ($payload['author'] ?? ''),
                is_array($_FILES['coat_file'] ?? null) ? $_FILES['coat_file'] : null
            ),
            'clear' => avesmapsWikiSyncMonitorClear(
                $pdo,
                (string) ($payload['target'] ?? ''),
                (string) ($payload['run_id'] ?? '')
            ),
            // Die Rechen-Haelften. Sie schreiben Planzeilen, keine Nutzdaten -- deshalb ohne den
            // dry_run/confirm-Riegel der Schreiber daneben, und deshalb ist ein zweiter Aufruf
            // ungefaehrlich: er loest den offenen Plan ab (Entwurf §6b). Die Kopie ist cursor-getrieben
            // und wird vom Client geschleift; die Karte ist ein einziger Durchlauf ohne Cursor.
            'build_territory_wiki_plan' => avesmapsTerritoryWikiPlanStep(
                $pdo,
                (string) ($payload['cursor'] ?? ''),
                (int) ($user['id'] ?? 0)
            ),
            'build_territory_plan' => avesmapsTerritoryPlanStep(
                $pdo,
                '',
                (int) ($user['id'] ?? 0)
            ),
            default => null,
        };

        if ($response === null) {
            avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Sync-Monitor-POST-Action: ' . $action);
        }

        // The coat switch flips what the public payloads contain without touching a single row the
        // caches key on. Both of them have to be told, or the change shows up minutes later (or never):
        // map-features hangs its ETag off map_revision, the political layer keeps a 300 s file cache.
        if ($action === 'set_territory_coats_enabled' && is_array($response)) {
            avesmapsWikiSyncNextMapRevision($pdo);
            avesmapsPoliticalInvalidateLayerCache();
        }

        // Editor-Status mitschreiben (Buttons zeigen frisch/veraltet relativ zur letzten Sync).
        if ($action === 'rebuild_model') {
            avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'rebuild');
            // 💣 Der Baum ist gerade umgeschrieben worden: eine offene KARTEN-Vorschau zeigt ab jetzt
            // Eltern-Umzuege, die der Schreiber so nicht mehr machen wuerde -- er nimmt den Elternteil,
            // den das Modell JETZT nennt, und meldete die Zeile trotzdem als "uebernommen"
            // (Entwurf §3/§6b). Serverseitig, nicht im Browser: der zweite Weg hierher ist "Syncen".
            avesmapsSyncPlanSupersedeRuns($pdo, 'territory');
        } elseif ($action === 'sync_parent_cache') {
            avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'test');
        } elseif ($action === 'apply_parent_cache' && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'apply');
        } elseif ($action === 'apply_identity' && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'apply');
        } elseif ($action === 'apply_coats' && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'apply');
        } elseif ($action === 'apply_custom_nodes' && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'apply');
        }

        // Map-Cache invalidieren: Identitaets-/Coat-Apply (+Revert) aendern political_territory,
        // das die Map-Features-API liefert. Ohne Revisions-Bump bekommen Clients per ETag 304
        // und sehen die Aenderung (Wappen/Name/...) nicht. Bump bei jedem echten (non-dry-run) Lauf.
        if (in_array($action, ['apply_identity', 'apply_coats', 'revert_identity', 'revert_coats', 'apply_custom_nodes'], true)
            && is_array($response) && ($response['dry_run'] ?? true) === false) {
            avesmapsWikiSyncNextMapRevision($pdo);
        }

        // WikiSync-Mutationen sofort in Editor/Review/Trees sichtbar machen: model_tree-Cache nach
        // jeder (nicht-dry-run) Aktion hart invalidieren -> naechster model_tree-Fetch baut frisch.
        if (is_array($response) && ($response['dry_run'] ?? false) !== true) {
            avesmapsWikiSyncMonitorInvalidateModelTreeCache($pdo);
        }

        avesmapsJsonResponse(200, $response);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET und POST sind erlaubt.');
    }

    $action = trim((string) ($_GET['action'] ?? 'status'));

    $response = match ($action) {
        'status', '' => avesmapsWikiSyncMonitorBuildStatus($pdo),
        'run_status' => avesmapsWikiSyncMonitorRunStatus($pdo, trim((string) ($_GET['run_id'] ?? ''))),
        'staging_sample' => avesmapsWikiSyncMonitorStagingSample(
            $pdo,
            array_filter(array_map('trim', explode('|', (string) ($_GET['wiki_keys'] ?? '')))),
            (int) ($_GET['limit'] ?? 40)
        ),
        'model_sample' => avesmapsWikiSyncMonitorModelSample(
            $pdo,
            array_filter(array_map('trim', explode('|', (string) ($_GET['wiki_keys'] ?? '')))),
            (int) ($_GET['limit'] ?? 40)
        ),
        'diff' => avesmapsWikiSyncMonitorDiff($pdo),
        'hierarchy_diff' => avesmapsWikiSyncMonitorHierarchyDiff($pdo),
        'model_tree' => avesmapsWikiSyncMonitorModelTree($pdo),
        'wiki_rows' => avesmapsWikiSyncMonitorWikiRows($pdo),
        'territory_lookup' => avesmapsWikiSyncMonitorTerritoryLookup(
            $pdo,
            array_filter(array_map('trim', explode('|', (string) ($_GET['wiki_keys'] ?? '')))),
            array_filter(array_map('trim', explode('|', (string) ($_GET['names'] ?? ''))))
        ),
        'territory_search' => avesmapsWikiSyncMonitorTerritorySearch(
            $pdo,
            (string) ($_GET['q'] ?? ''),
            (int) ($_GET['limit'] ?? 50)
        ),
        'geometry_lookup' => avesmapsWikiSyncMonitorGeometryLookup(
            $pdo,
            (string) ($_GET['geometry_id'] ?? ''),
            (string) ($_GET['public_id'] ?? ''),
            array_filter(array_map('trim', explode('|', (string) ($_GET['territory_ids'] ?? ''))))
        ),
        'editor_state' => avesmapsWikiSyncMonitorEditorState($pdo),
        'apply_identity_preview' => avesmapsWikiSyncMonitorApplyIdentityPreview($pdo),
        'apply_coats_preview' => avesmapsWikiSyncMonitorApplyCoatsPreview($pdo),
        'localize_coats_pending' => ['ok' => true, 'remaining' => count(avesmapsWikiSyncMonitorPendingLocalizeCoatKeys($pdo))],
        'geometry_model_audit' => avesmapsWikiSyncMonitorGeometryModelAudit($pdo),
        'location_search' => avesmapsWikiSyncMonitorLocationSearch(
            $pdo,
            (string) ($_GET['q'] ?? ''),
            (int) ($_GET['limit'] ?? 20)
        ),
        'identity_backups' => avesmapsWikiSyncMonitorIdentityBackups($pdo, (int) ($_GET['limit'] ?? 20)),
        default => null,
    };

    if ($response === null) {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Sync-Monitor-Action: ' . $action);
    }

    // "Find Differences" merkt sein Ergebnis (Zahlen) fuer die Button-Statuszeile.
    if ($action === 'diff' && is_array($response)) {
        avesmapsWikiSyncMonitorRecordEditorAction($pdo, 'diff', [
            'new' => $response['new'] ?? 0,
            'changed' => $response['changed'] ?? 0,
            'deleted' => $response['disappeared'] ?? 0,
        ]);
    }

    avesmapsJsonResponse(200, $response);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
