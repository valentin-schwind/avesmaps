<?php

declare(strict_types=1);

// V10: the public read behind the „Führt durch" line. It answers ONE question -- which landscapes
// does each of these ways run through, and over how much of its length.
// Spec: docs/superpowers/specs/2026-07-29-landschaften-v10-fuehrt-durch-design.md
//
// PURITY CONTRACT (mirrors path-ecosystem.php): side-effect-free on include -- only const and
// function definitions, no DB connect, no headers. The offline-decidable half (request validation,
// arc length) is pure and unit-tested; the DB half takes a PDO explicitly.
//
// 💣 NO DDL, NO information_schema PROBE. This endpoint only reads. The tables are created in the
// editor's write path, and an information_schema probe on a public read is exactly the load that
// saturated the PHP pool on 2026-07-17.

require_once __DIR__ . '/path-ecosystem.php';
require_once __DIR__ . '/app-setting.php';

// Ways one request may ask about. A measured route (Gareth -> Thorwal) has 45 legs, so this is far
// above anything real -- it exists so a single request stays small however the stock grows. Over the
// ceiling the server REFUSES; it never answers a shortened list, because a half answer to
// „Führt durch" is indistinguishable from a whole one.
const AVESMAPS_PATH_LANDSCAPES_MAX = 400;

/**
 * PURE: validate the request body and hand back the ways worth asking about.
 *
 * Anything that cannot be a public_id is DROPPED, not rejected: between the client building its
 * list and the request arriving, nothing can turn a good id into rubbish, so rubbish means a
 * confused caller, and a confused caller still deserves the answer for its good ids. An EMPTY list
 * is different -- that is a caller asking nothing at all, and answering `{}` would let a bug look
 * like „this route touches no landscape".
 *
 * @return list<string>
 */
function avesmapsPathLandscapesNormalizeRequest(mixed $payload): array
{
    $raw = is_array($payload) ? ($payload['paths'] ?? null) : null;
    if (!is_array($raw)) {
        throw new InvalidArgumentException('paths must be a list of public ids.');
    }
    if (count($raw) > AVESMAPS_PATH_LANDSCAPES_MAX) {
        throw new InvalidArgumentException(
            'paths holds more than ' . AVESMAPS_PATH_LANDSCAPES_MAX . ' entries.'
        );
    }

    $ids = [];
    foreach ($raw as $candidate) {
        if (!is_string($candidate)) {
            continue;
        }
        $trimmed = trim($candidate);
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $trimmed) !== 1) {
            continue;
        }
        $ids[strtolower($trimmed)] = true;
    }
    if ($ids === []) {
        throw new InvalidArgumentException('paths holds no usable public id.');
    }

    return array_keys($ids);
}

// avesmapsPathLandscapesEcosystemEnabled ist am 2026-08-01 mit dem Totmannschalter entfallen.
//
// 💣 Sie war der Leser mit der groessten Aussenwirkung und wurde beim ersten Anlauf uebersehen: dieser
// Endpunkt traegt V10 „Fuehrt durch" im Reiseplaner JEDES Besuchers. Stand app_setting['ecosystem_enabled']
// auf '0', antwortete er leer -- die Zeile verschwand fuer alle, und niemand haette den Schalter dafuer
// verantwortlich gemacht. Genau das ist der Grund, warum der Schalter weg ist statt umgebaut.
//
// ⭐ Was hier BLEIBT und nicht verwechselt werden darf: V11 hat einen eigenen Schalter,
// AVESMAPS_TERRAIN_SETTING = 'terrain_travel_enabled' (api/_internal/routing/terrain-read.php).

/**
 * PURE: arc length of a coordinate list, in MAP UNITS.
 *
 * ⚠️ The same measure as `calculatePathCoordinateDistance` in the browser and as basis 0 in
 * path_ecosystem: plain hypot over the STORED support points. Not the drawn Catmull-Rom curve --
 * that one is longer, and a share measured against it would silently shrink every percentage.
 */
function avesmapsPathLandscapesLineLength(array $coordinates): float
{
    $total = 0.0;
    $count = count($coordinates);
    for ($index = 0; $index < $count - 1; $index++) {
        $from = $coordinates[$index];
        $to = $coordinates[$index + 1];
        if (!is_array($from) || !is_array($to) || count($from) < 2 || count($to) < 2) {
            continue;
        }
        $total += hypot((float) $to[0] - (float) $from[0], (float) $to[1] - (float) $from[1]);
    }

    return $total;
}

/**
 * When the stored answer was computed, and whether the stock has moved since.
 *
 * 💣 A MISSING TABLE IS NOT AN ERROR HERE. The V9 tables are created in the editor's write path, so
 * on a database where „Zugehörigkeit rechnen" has never run they simply do not exist -- and PDO is
 * in ERRMODE_EXCEPTION, so the plain read would throw and this public endpoint would answer 500 for
 * a state that is perfectly normal. „Nothing computed yet" and „this way touches no landscape" are
 * the same answer to a visitor: no line. Neither deserves a 500, and neither may create a table on
 * a read path.
 */
function avesmapsPathLandscapesStamp(PDO $pdo): ?array
{
    try {
        $status = avesmapsPathEcosystemStatus($pdo);
    } catch (PDOException) {
        return null;
    }
    if (!is_array($status['stamp'] ?? null)) {
        return null;
    }

    return [
        'computed_at' => (string) $status['stamp']['computed_at'],
        'ecosystem_revision' => (int) $status['stamp']['ecosystem_revision'],
        'map_revision' => (int) $status['stamp']['map_revision'],
        'stale' => (int) $status['stamp']['ecosystem_revision'] !== (int) ($status['current']['ecosystem_revision'] ?? 0)
            || (int) $status['stamp']['map_revision'] !== (int) ($status['current']['map_revision'] ?? 0),
    ];
}

/**
 * The read itself. Two queries, both bounded by the requested ways:
 *   1. the ways -- their internal id, their geometry (for the length) ;
 *   2. their stored intervals at basis 0, joined up to the region that owns the area.
 *
 * `basis = 0` is not a preference. It is the CHORD, the measure the routing graph and the leg
 * distances use. basis 1 is the drawn curve and belongs to anything drawn -- colouring a stretch,
 * placing a marker. Mixing them would not throw; it would just make every share a little wrong.
 *
 * The region name travels RAW, together with its kind label. Choosing between „Farindelwald" and
 * „Wald" is `ecosystemRegionDisplayName` in the browser -- rebuilding that rule here would be a
 * second copy of it, and the two would drift.
 *
 * @param list<string> $publicIds
 * @return array{landscapes: array<string, array<string, mixed>>, paths: array<string, array<string, mixed>>}
 */
function avesmapsPathLandscapesRead(PDO $pdo, array $publicIds): array
{
    if ($publicIds === []) {
        return ['landscapes' => [], 'paths' => []];
    }

    $placeholders = implode(',', array_fill(0, count($publicIds), '?'));

    $pathStatement = $pdo->prepare(
        "SELECT id, public_id, geometry_json FROM map_features
         WHERE public_id IN ({$placeholders}) AND feature_type = 'path' AND is_active = 1"
    );
    $pathStatement->execute($publicIds);

    $paths = [];
    $publicIdByInternalId = [];
    foreach ($pathStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $geometry = json_decode((string) $row['geometry_json'], true);
        $coordinates = is_array($geometry) && is_array($geometry['coordinates'] ?? null)
            ? $geometry['coordinates']
            : [];
        $publicId = (string) $row['public_id'];
        $publicIdByInternalId[(int) $row['id']] = $publicId;
        $paths[$publicId] = [
            'length' => round(avesmapsPathLandscapesLineLength($coordinates), 4),
            'in' => [],
        ];
    }
    if ($publicIdByInternalId === []) {
        return ['landscapes' => [], 'paths' => []];
    }

    $internalIds = array_keys($publicIdByInternalId);
    $idPlaceholders = implode(',', array_fill(0, count($internalIds), '?'));

    // 💣 The sum lives in the SQL, not in PHP. One way can cross the SAME area up to thirteen
    // times (V9 §5.5: rivers are often the border themselves), and one region can own several
    // areas -- hence GROUP BY the REGION's public_id, not the area's. Without it a single river
    // way would come back as forty rows the client would have to add up all over again.
    $intervalStatement = $pdo->prepare(
        "SELECT pe.path_id,
                r.public_id AS region_public_id,
                r.name AS region_name,
                r.kind AS region_kind,
                r.wiki_region_key,
                r.wiki_url,
                COALESCE(rt.label, '') AS region_type_label,
                COALESCE(r.region_type, '') AS region_type,
                SUM(pe.exit_distance_mapunits - pe.enter_distance_mapunits) AS covered
         FROM path_ecosystem pe
         JOIN ecosystem_area a ON a.id = pe.area_id AND a.is_active = 1
         JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
         LEFT JOIN ecosystem_region_type rt ON rt.kind = r.kind AND rt.type_key = r.region_type
         WHERE pe.basis = 0 AND pe.path_id IN ({$idPlaceholders})
         GROUP BY pe.path_id, r.public_id, r.name, r.kind, r.wiki_region_key, r.wiki_url, rt.label, r.region_type"
    );
    $intervalStatement->execute($internalIds);

    $landscapes = [];
    foreach ($intervalStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $publicId = $publicIdByInternalId[(int) $row['path_id']] ?? '';
        if ($publicId === '' || !isset($paths[$publicId])) {
            continue;
        }
        $regionId = (string) $row['region_public_id'];
        $landscapes[$regionId] ??= [
            'name' => (string) $row['region_name'],
            'art' => (string) $row['region_type_label'],
            // 💣 Der SCHLUESSEL neben dem Label. `art` ist „Gemäßigte Zone" und gehoert der Anzeige;
            // wer damit rechnen will, braucht `gemaessigt` -- so heisst die Zone in jeder Tabelle
            // (season-ground.php/.js). Ohne dieses Feld verglich der Bodenabzug ein Label gegen einen
            // Schluessel, fand nie eine Zone und wirkte auf keiner einzigen Etappe.
            'art_key' => (string) $row['region_type'],
            'kind' => (string) $row['region_kind'],
            'wiki_key' => (string) ($row['wiki_region_key'] ?? ''),
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        ];
        $paths[$publicId]['in'][] = [$regionId, round((float) $row['covered'], 4)];
    }

    return ['landscapes' => $landscapes, 'paths' => $paths];
}
