<?php

declare(strict_types=1);

function avesmapsPoliticalFetchDerivedGeometrySourceTerritories(PDO $pdo): array {
    $statement = $pdo->prepare(
        'SELECT
            id,
            public_id,
            wiki_id,
            slug,
            name,
            short_name,
            type,
            parent_id,
            continent,
            status,
            color,
            opacity,
            valid_from_bf,
            valid_to_bf,
            min_zoom,
            max_zoom,
            sort_order
        FROM political_territory
        WHERE is_active = 1
            AND continent = :continent
        ORDER BY parent_id ASC, sort_order ASC, name ASC, id ASC'
    );
    $statement->execute([
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    ]);

    $territories = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $territories[(int) $row['id']] = $row;
    }

    return $territories;
}
