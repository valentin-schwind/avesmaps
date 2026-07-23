<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';
// avesmapsDecodeJsonColumnForEdit lives in the map-features library.
require_once __DIR__ . '/../../_internal/map/features.php';

// Read-only feed for the Kraftlinien (powerline) list editor. A powerline is not one row but many
// map_features segments held together only by a shared `name`; this endpoint returns the raw
// segments, a lookup for every node they touch, and the pool of add-a-node candidates. Grouping and
// topology are computed client-side with the shared pure helpers
// (js/map-features/powerline-topology.js) so there is exactly ONE topology truth. Same bootstrap /
// auth / envelope pattern as api/edit/map/feature-sources.php. GET, capability `edit`.
// Design: docs/superpowers/specs/2026-07-23-kraftlinien-editor-design.md §9.
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'This origin may not read powerlines.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Only GET is allowed for this endpoint.');
    }

    avesmapsRequireUserWithCapability('edit');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // 1) Every powerline segment. The manual fields live inside properties_json; `revision` is the DB
    //    column the editor needs later for optimistic locking.
    $segmentRows = $pdo->query(
        "SELECT public_id, name, properties_json, revision
         FROM map_features
         WHERE feature_type = 'powerline' AND is_active = 1"
    )->fetchAll(PDO::FETCH_ASSOC);

    $segments = [];
    $nodeIds = [];
    foreach ($segmentRows as $row) {
        $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
        $from = (string) ($properties['from_public_id'] ?? '');
        $to = (string) ($properties['to_public_id'] ?? '');
        if ($from !== '') {
            $nodeIds[$from] = true;
        }
        if ($to !== '') {
            $nodeIds[$to] = true;
        }
        $wikiPowerline = $properties['wiki_powerline'] ?? null;
        $segments[] = [
            'public_id' => (string) $row['public_id'],
            'name' => (string) ($row['name'] ?? ($properties['name'] ?? '')),
            'from_public_id' => $from,
            'to_public_id' => $to,
            'show_label' => (bool) ($properties['show_label'] ?? false),
            'description' => (string) ($properties['description'] ?? ''),
            'wiki_url' => (string) ($properties['wiki_url'] ?? ''),
            'wiki_powerline' => is_array($wikiPowerline) ? $wikiPowerline : null,
            'revision' => (int) ($row['revision'] ?? 0),
        ];
    }

    // 2) Resolve every node the segments touch, in ONE query (no N+1 -- STRATO shared hosting).
    $nodes = [];
    if ($nodeIds !== []) {
        $ids = array_keys($nodeIds);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare(
            "SELECT public_id, name, feature_subtype, properties_json
             FROM map_features
             WHERE is_active = 1 AND public_id IN ($placeholders)"
        );
        $stmt->execute($ids);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
            $nodes[(string) $row['public_id']] = [
                'name' => (string) ($row['name'] ?? ''),
                'type' => (string) ($row['feature_subtype'] ?? ''),
                'is_nodix' => (bool) ($properties['is_nodix'] ?? false),
            ];
        }
    }

    // 3) Add-a-node candidates: every Nodix location, plus the crossings already used by a powerline
    //    (so an editor can rewire within the existing structure) -- bounded and meaningful, not every
    //    routing crossing on the map. The LIKE matches the JSON avesmapsEncodeJson writes ("is_nodix":true).
    $candidates = [];
    $seenCandidate = [];
    $nodixRows = $pdo->query(
        "SELECT public_id, name, feature_subtype
         FROM map_features
         WHERE feature_type = 'location' AND is_active = 1 AND properties_json LIKE '%\"is_nodix\":true%'"
    )->fetchAll(PDO::FETCH_ASSOC);
    foreach ($nodixRows as $row) {
        $pid = (string) $row['public_id'];
        if (isset($seenCandidate[$pid])) {
            continue;
        }
        $seenCandidate[$pid] = true;
        $candidates[] = [
            'public_id' => $pid,
            'name' => (string) ($row['name'] ?? ''),
            'type' => (string) ($row['feature_subtype'] ?? ''),
        ];
    }
    foreach ($nodes as $pid => $node) {
        if ($node['type'] === 'crossing' && !isset($seenCandidate[$pid])) {
            $seenCandidate[$pid] = true;
            $candidates[] = ['public_id' => (string) $pid, 'name' => $node['name'], 'type' => 'crossing'];
        }
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'segments' => $segments,
        // Cast so an empty result is a JSON object ({}), not an array ([]).
        'nodes' => (object) $nodes,
        'nodix_candidates' => $candidates,
    ]);
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'The powerlines could not be loaded.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'The powerlines could not be processed.');
}
