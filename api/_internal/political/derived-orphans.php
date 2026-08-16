<?php

declare(strict_types=1);

/**
 * „Huelle ohne Quelle" -- EINE Rechnung, geteilt.
 *
 * 💣 Scanner (geometry_inventory), Bulk-Knopf (purge_unassigned_geometries) und die Hart/Weich-
 * Weiche beim Loeschen fragen ALLE hier. Drei Kopien derselben Regel driften auseinander, und
 * dann zeigt die Liste etwas anderes, als der Knopf loescht -- genau der Fehler, der diese
 * Baustelle ueberhaupt erzeugt hat (der Bulk-Knopf ging an der vorhandenen Ketten-Regel vorbei).
 *
 * 💣 Eine Huelle lebt von den Flaechen ihres GEBIETS UND SEINER NACHFAHREN. Wer nur das Gebiet
 * fragt, erklaert jedes Aggregat zum Geist: am Livebestand vom 16.08.2026 waren das 111 von 114.
 */

function avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT DISTINCT geometry.territory_id
        FROM political_territory_geometry geometry
        INNER JOIN political_territory territory ON territory.id = geometry.territory_id
        WHERE geometry.is_active = 1
            AND territory.is_active = 1'
    );
    if ($statement === false) {
        return [];
    }

    $ids = [];
    foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $territoryId) {
        $ids[(int) $territoryId] = true;
    }

    return $ids;
}

function avesmapsPoliticalDerivedHullIsSourceless(int $territoryId, array $territories, array $withGeometry): bool {
    if ($territoryId < 1 || !isset($territories[$territoryId])) {
        // Die Huelle zeigt auf kein Territorium mehr -- niemand kann sie je wieder erzeugen.
        return true;
    }
    if (isset($withGeometry[$territoryId])) {
        return false;
    }
    foreach (avesmapsPoliticalCollectDerivedGeometryDescendantIds($territoryId, $territories) as $descendantId) {
        if (isset($withGeometry[(int) $descendantId])) {
            return false;
        }
    }

    return true;
}

function avesmapsPoliticalCollectSourcelessDerivedHulls(PDO $pdo): array {
    $territories = avesmapsPoliticalFetchDerivedGeometrySourceTerritories($pdo);
    $withGeometry = avesmapsPoliticalFetchTerritoryIdsWithActiveGeometry($pdo);

    $statement = $pdo->query(
        'SELECT
            derived.public_id,
            derived.territory_id,
            derived.min_x, derived.min_y, derived.max_x, derived.max_y,
            derived.created_at,
            cu.username AS created_by_username,
            territory.public_id AS territory_public_id,
            territory.name AS territory_name,
            territory.type AS territory_type,
            territory.is_active AS territory_is_active
        FROM political_territory_derived_geometry derived
        LEFT JOIN political_territory territory ON territory.id = derived.territory_id
        LEFT JOIN users cu ON cu.id = derived.created_by
        WHERE derived.is_active = 1'
    );
    if ($statement === false) {
        return [];
    }

    $hulls = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territoryId = (int) ($row['territory_id'] ?? 0);
        if (!avesmapsPoliticalDerivedHullIsSourceless($territoryId, $territories, $withGeometry)) {
            continue;
        }

        $minX = (float) ($row['min_x'] ?? 0);
        $minY = (float) ($row['min_y'] ?? 0);
        $maxX = (float) ($row['max_x'] ?? 0);
        $maxY = (float) ($row['max_y'] ?? 0);
        $territoryName = trim((string) ($row['territory_name'] ?? ''));

        $hulls[] = [
            'derived_geometry_public_id' => (string) ($row['public_id'] ?? ''),
            'territory_public_id' => (string) ($row['territory_public_id'] ?? ''),
            // 🔴 Wortgleich mit dem Inventar der Konturen -- eine Vokabel, nicht zwei
            // waeren zwei Zustaende fuer den Leser.
            'territory_name' => $territoryName !== '' ? $territoryName : '(KEIN TERRITORIUM)',
            'territory_type' => (string) ($row['territory_type'] ?? ''),
            'territory_is_active' => (int) ($row['territory_is_active'] ?? 0) === 1,
            'area' => round(max(0.0, $maxX - $minX) * max(0.0, $maxY - $minY), 1),
            'bbox' => [round($minX, 1), round($minY, 1), round($maxX, 1), round($maxY, 1)],
            'created_by' => (string) ($row['created_by_username'] ?? ''),
            'created_at' => (string) ($row['created_at'] ?? ''),
        ];
    }

    usort($hulls, static fn(array $a, array $b): int => $b['area'] <=> $a['area']);

    return $hulls;
}
