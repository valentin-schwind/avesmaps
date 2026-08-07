<?php

declare(strict_types=1);

// Literatur as a search source. An entry has NO geometry of its own -- it inherits its position
// from the place it BEGINS at, exactly like a Kartensammlung map inherits the place it is assigned to.
// Design: docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md
//
// 💣 Only SPOILER-FREE places are read here, and that is the SPOILER RULE, not an optimisation.
// "beginnt hier" (start) and "beschreibt" (covers) are spoiler-free, "spielt hier" (play) IS the
// spoiler -- the infopanel already enforces that with a veil (avesmapsSpoilerVeilMarkup). A search row
// has no veil: it appears unasked while somebody types something else. The only version that cannot
// leak is the one that never learns the play location. Measured cost, live 2026-08-02: 4 adventures
// have ONLY play places and 80 more have a resolved play place but no resolved start place -- 84 of
// 1352 lose their jump target, none loses its findability.
//
// 'covers' joined the list with the Literatur rebuild: a Regionalspielhilfe has no start place at all
// (its places come from `Thema` and all carry 'covers'), so restricting to 'start' would have left
// every one of them without a jump target -- ~100-150 works, i.e. the whole point of the rebuild.
//
// The building function is PURE (rows in, entries out) so it is testable without a database.

// Mirrors avesmapsGameLiteratureProductTypeLabel in js/map-features/map-features-game-literature.js.
// Both key and label are searchable: the payload carries 'gruppenabenteuer', a human types
// "Gruppenabenteuer" -- matching only the key fails silently on every capitalised or umlaut-bearing
// label (same trap the Kartensammlung hit with 'uebersicht' / "Übersicht").
// 💣 A product_type MISSING here falls back to the raw slug, and the raw slug is what the reader then
// sees in the type line: "regionalspielhilfe", lowercase and unhyphenated, reads as a database field
// rather than a statement about a book (Owner 2026-08-07, same finding as in the editor). Every key
// AVESMAPS_GAME_LITERATURE_KINDS (api/_internal/wiki/publication-parsing.php) lets in belongs here.
const AVESMAPS_GAME_LITERATURE_SEARCH_TYPE_LABELS = [
    'gruppenabenteuer' => 'Gruppenabenteuer',
    'soloabenteuer' => 'Soloabenteuer',
    'kurzabenteuer' => 'Kurzabenteuer',
    'szenario' => 'Szenario',
    'anthologie' => 'Anthologie',
    'kampagne' => 'Kampagne',
    'kampagnenband' => 'Kampagnenband',
    'metaband' => 'Metaband',
    'roman' => 'Roman',
    'kurzgeschichte' => 'Kurzgeschichte',
    'regionalspielhilfe' => 'Regionalspielhilfe',
    'spielhilfe' => 'Spielhilfe',
];

/**
 * One row per approved adventure, with its FIRST RESOLVED approved SPOILER-FREE place (design §4.1)
 * -- a resolved row always outranks an unresolved one, regardless of sort_order.
 *
 * The correlated subquery picks exactly one place per adventure, so no GROUP BY and no N+1 -- this
 * runs on a public, per-keystroke path.
 *
 * 💣 The join condition carries `role IN ('start', 'covers')`. Letting the play role in would silently
 * turn every play location into a searchable, jumpable, printable fact. game-literature-search-test.php
 * pins that by asserting this whole FILE contains no SQL literal for it -- which is why the word
 * appears unquoted in every comment here. That is the pin working, not an oversight.
 *
 * A work carries EITHER ordered places (start/play) OR covers places -- which of the two is decided by
 * its kind, not per place. `start` is preferred anyway, so a hand-edited row that mixes both still
 * answers with the place a reader would call its first.
 *
 * contained_in is a self-healing column added by game-literature.php; if a deployment ever lacks it the
 * query throws and this returns [] -- the adventure section disappears, the search does not 500.
 */
function avesmapsFetchGameLiteratureSearchRows(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT a.public_id,
                    a.title,
                    a.product_type,
                    COALESCE(a.edition, '') AS edition,
                    COALESCE(a.genre, '') AS genre,
                    COALESCE(a.series, '') AS series,
                    COALESCE(a.contained_in, '') AS contained_in,
                    COALESCE(p.raw_name, '') AS place_name,
                    COALESCE(p.target_kind, 'unresolved') AS place_kind,
                    COALESCE(p.role, '') AS place_role,
                    p.target_public_id AS place_public_id
             FROM adventure a
             LEFT JOIN adventure_place p ON p.id = (
                 SELECT p2.id FROM adventure_place p2
                 WHERE p2.adventure_id = a.id AND p2.status = 'approved' AND p2.role IN ('start', 'covers')
                 ORDER BY (p2.target_public_id IS NULL OR p2.target_kind = 'unresolved') ASC,
                          (p2.role = 'start') DESC, p2.sort_order ASC, p2.id ASC LIMIT 1
             )
             WHERE a.status = 'approved'"
        );
    } catch (Throwable) {
        return []; // table missing (never synced) -> no adventures in the search, not a 500
    }

    return $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
}

/**
 * PURE. Builds search entries from rows.
 *
 * The place travels with its KIND and is NOT resolved here -- adventures hang on the same four kinds
 * of place as maps (settlement|territory|region|path) and the client looks them up with ITS own
 * vocabulary (location|region|label|path), a mapping only it knows and only it can check against what
 * is loaded right now. All this function can honestly say is whether the database resolved the start
 * place at all.
 *
 * @param array<string, string> $typeLabels product_type => German label
 * @return list<array<string, mixed>>
 */
function avesmapsBuildGameLiteratureSearchEntries(array $rows, array $typeLabels): array {
    $entries = [];
    foreach ($rows as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }

        $productType = (string) ($row['product_type'] ?? '');
        $typeLabel = $typeLabels[$productType] ?? $productType;
        $edition = trim((string) ($row['edition'] ?? ''));
        $placeName = trim((string) ($row['place_name'] ?? ''));
        $placeKind = (string) ($row['place_kind'] ?? 'unresolved');
        // Which spoiler-free role the place carries -- the CLIENT words the hint from it ("beginnt in
        // Gareth" vs "beschreibt Gareth"), because every visible German string of the result list lives
        // in js/ui/spotlight-search.js. Anything but 'covers' reads as "beginnt".
        $placeRole = (string) ($row['place_role'] ?? '') === 'covers' ? 'covers' : 'start';
        $placePublicId = (string) ($row['place_public_id'] ?? '');
        $unresolved = $placePublicId === '' || $placeKind === 'unresolved';

        // The type line carries product type AND edition. 29 titles are handed out more than once
        // ("Silvanas Befreiung" 3x, "Zukunft im Sand" 3x) -- without the edition two hits read as one
        // duplicated row. The PLACE is deliberately not in here: it goes into the client's hint line
        // as "beginnt in <Ort>" / "beschreibt <Ort>", where the wording carries the spoiler-free role.
        $typeLabelParts = array_values(array_filter([$typeLabel, $edition]));

        $entries[] = [
            'kind' => 'adventure',
            'public_id' => (string) ($row['public_id'] ?? ''),
            'public_ids' => [(string) ($row['public_id'] ?? '')],
            'name' => $title,
            'type_label' => implode(' · ', $typeLabelParts),
            'feature_subtype' => 'adventure',
            'edition_sort_key' => avesmapsGameLiteratureSearchEditionSortKey($edition),
            'place_public_id' => $unresolved ? '' : $placePublicId,
            'place_kind' => $placeKind,
            'place_name' => $placeName,
            'place_role' => $placeRole,
            'not_on_map' => true,
            'unresolved' => $unresolved,
            'min_x' => 0.0,
            'min_y' => 0.0,
            'max_x' => 0.0,
            'max_y' => 0.0,
            // bf_year/bf_label/isbn stay out: filled on 6 and 0 of 1352 rows respectively, because
            // {{Infobox Produkt}} carries neither. complexity_*/fshop_code/link_* are not words anyone
            // types into a map search.
            'search_texts' => array_values(array_filter([
                $title,
                (string) ($row['series'] ?? ''),
                (string) ($row['contained_in'] ?? ''),
                $productType,
                $typeLabel,
                (string) ($row['genre'] ?? ''),
                $edition,
                $placeName,
            ])),
        ];
    }

    return $entries;
}

/**
 * Sort key for the DSA edition so "newest first" runs DSA5 > DSA4.1 > DSA4 > ... > DSA1, then non-DSA
 * rulesets, then no edition. Ascending sort of this key yields that order.
 *
 * Mirrors avesmapsGameLiteratureEditionSortKey in js/map-features/map-features-game-literature.js on purpose:
 * the search and the adventure dialog must order the same catalogue the same way. bf_year is NOT an
 * alternative -- it is filled on 6 of 1352 rows.
 */
function avesmapsGameLiteratureSearchEditionSortKey(string $edition): float {
    $edition = trim($edition);
    if ($edition === '') {
        return 1001.0;
    }
    if (preg_match('/DSA\s*(\d+(?:\.\d+)?)/i', $edition, $matches) === 1) {
        return -1.0 * (float) $matches[1];
    }

    return 1000.0;
}

/**
 * Tie-break comparator for the adventure search section, passed to avesmapsCollectSearchSection
 * (api/_internal/app/search-section.php) as the $tieBreak callable: resolved start place before
 * unresolved, then score, then edition, then name.
 */
function avesmapsGameLiteratureSearchCompare(array $left, array $right): int {
    $resolvedDiff = ((int) $left['unresolved']) <=> ((int) $right['unresolved']);
    if ($resolvedDiff !== 0) {
        return $resolvedDiff;
    }
    $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
    if ($scoreDiff !== 0) {
        return $scoreDiff;
    }
    // Newest edition first -- the same order the adventure dialog uses. With 1040 equally
    // scored hits behind a word like "abenteuer", this tie-break alone decides which five a
    // reader ever sees; without it they would be five arbitrary rows.
    $editionDiff = ((float) $left['edition_sort_key']) <=> ((float) $right['edition_sort_key']);
    return $editionDiff !== 0 ? $editionDiff : strnatcasecmp((string) $left['name'], (string) $right['name']);
}
