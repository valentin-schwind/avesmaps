<?php

declare(strict_types=1);

// Kartensammlung as a search source. A map has NO geometry of its own -- it inherits its position from
// the place it is assigned to, exactly like the in-settlement objects do. Design:
// docs/superpowers/specs/2026-08-02-spotlight-kartensammlungen-design.md
//
// The building function is PURE (rows in, entries out) so it is testable without a database.

// Mirrors html/citymap-editor.html TYPE_KEYS. Both key and label are searchable: the payload carries
// 'uebersicht', a human types 'Übersicht' -- matching only the key fails silently on every umlaut type.
const AVESMAPS_CITYMAP_SEARCH_TYPE_LABELS = [
    'ortsplan' => 'Ortsplan',
    'stadtplan' => 'Stadtplan',
    'bezirk' => 'Bezirk',
    'viertel' => 'Viertel',
    'lageplan' => 'Lageplan',
    'uebersicht' => 'Übersicht',
    'schauplatz' => 'Schauplatz',
    'grundriss' => 'Grundriss',
    'befestigungen' => 'Befestigungen',
    'dungeon' => 'Dungeon',
    'hoehlen' => 'Höhlen',
    'krypten' => 'Krypten',
    'katakomben' => 'Katakomben',
    'schatzkarte' => 'Schatzkarte',
    'region' => 'Region',
    'sonstige' => 'Sonstige',
];

/**
 * One row per map, with its FIRST assigned place (sort_order) and its types folded into one column.
 * GROUP_CONCAT avoids a second query and an N+1 -- this runs on a public, per-keystroke path.
 *
 * Only approved maps, and only when the collection is switched on (the caller checks that).
 */
function avesmapsFetchCitymapSearchRows(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT c.public_id,
                    c.title,
                    COALESCE(GROUP_CONCAT(DISTINCT t.type_key ORDER BY t.type_key SEPARATOR ','), '') AS types,
                    COALESCE(c.publisher, '') AS publisher,
                    COALESCE(p.raw_name, '') AS place_name,
                    COALESCE(p.target_kind, 'unresolved') AS place_kind,
                    p.target_public_id AS place_public_id
             FROM citymap c
             LEFT JOIN citymap_type t ON t.citymap_id = c.id
             LEFT JOIN citymap_place p ON p.id = (
                 SELECT p2.id FROM citymap_place p2
                 WHERE p2.citymap_id = c.id AND p2.status = 'approved'
                 ORDER BY p2.sort_order ASC, p2.id ASC LIMIT 1
             )
             WHERE c.status = 'approved'
             GROUP BY c.id, c.public_id, c.title, c.publisher, p.raw_name, p.target_kind, p.target_public_id"
        );
    } catch (Throwable) {
        return []; // table missing (never synced) -> no maps in the search, not a 500
    }

    return $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
}

/**
 * PURE. Builds search entries from rows.
 *
 * The place travels with its KIND and is NOT resolved here. Maps hang on four kinds of place
 * (settlement|territory|region|path) and the client looks them up as `${kind}:${publicId}` using ITS
 * own vocabulary -- a mapping only the client knows, and only it knows what is loaded right now.
 * All this function can honestly say is whether the database ever resolved the place at all.
 *
 * @param array<string, string> $typeLabels key => German label
 * @return list<array<string, mixed>>
 */
function avesmapsBuildCitymapSearchEntries(array $rows, array $typeLabels): array {
    $entries = [];
    foreach ($rows as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }

        $typeKeys = array_values(array_filter(explode(',', (string) ($row['types'] ?? ''))));
        $labels = [];
        foreach ($typeKeys as $typeKey) {
            $labels[] = $typeLabels[$typeKey] ?? $typeKey;
        }

        $placeName = trim((string) ($row['place_name'] ?? ''));
        $placeKind = (string) ($row['place_kind'] ?? 'unresolved');
        $placePublicId = (string) ($row['place_public_id'] ?? '');
        // 85 of 469 assignments were never resolved (measured live 2026-08-02). Those maps stay
        // findable -- being told the map exists beats hiding it -- but they carry no target, so they
        // are marked and ranked last. This is the ONLY reachability claim the server can make.
        $unresolved = $placePublicId === '' || $placeKind === 'unresolved';

        // The type line carries type AND place: for a map named after a building ("Plan des alten
        // Schlosses") the place is the only reason it shows up at all.
        $typeLabelParts = array_filter([$labels === [] ? '' : implode(', ', $labels), $placeName]);

        $entries[] = [
            'kind' => 'citymap',
            'public_id' => (string) ($row['public_id'] ?? ''),
            'public_ids' => [(string) ($row['public_id'] ?? '')],
            'name' => $title,
            'type_label' => implode(' · ', $typeLabelParts),
            'feature_subtype' => 'citymap',
            'place_public_id' => $unresolved ? '' : $placePublicId,
            'place_kind' => $placeKind,
            'place_name' => $placeName,
            'not_on_map' => true,
            'unresolved' => $unresolved,
            'min_x' => 0.0,
            'min_y' => 0.0,
            'max_x' => 0.0,
            'max_y' => 0.0,
            // note/author stay out: note is freetext with wiki leftovers ("Mit Nummern", "Veraltet UDW,
            // Seite 14"), author is filled on 64 of 455 -- both are noise against title/place/type.
            'search_texts' => array_values(array_filter(array_merge(
                [$title, $placeName, (string) ($row['publisher'] ?? '')],
                $typeKeys,
                $labels
            ))),
        ];
    }

    return $entries;
}
