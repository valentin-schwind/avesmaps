<?php

declare(strict_types=1);

// Section-cap core of the map search: score, sort and cap ONE capped section source (Kartensammlung,
// adventures, occurrences). Extracted from api/app/map-search.php so it can be tested without a
// database: that file is an ENDPOINT -- requiring it runs a request. Nothing here touches PDO, $_GET
// or the network; already-built entries and a tie-break comparator in, the capped list and the
// pre-cap total out. Same reasoning as map-search-scoring.php, which this file requires because the
// scoring it calls lives there.

require_once __DIR__ . '/map-search-scoring.php';

/**
 * Score, sort and cap ONE section source.
 *
 * Exists so the cap lives in exactly one place: three copies of "score, usort, count, array_slice" is
 * three chances to forget the cap on the source that needs it most.
 *
 * @param list<array<string, mixed>> $entries already-built search entries
 * @param callable(array<string, mixed>, array<string, mixed>): int $tieBreak full comparator, score included
 * @return array{0: list<array<string, mixed>>, 1: int} the capped list and the total BEFORE capping
 */
function avesmapsCollectSearchSection(array $entries, string $normalizedQuery, callable $tieBreak, int $limit): array {
    $matches = [];
    foreach ($entries as $entry) {
        $score = avesmapsCalculateSearchScore($entry, $normalizedQuery);
        if ($score === null) {
            continue;
        }
        $entry['score'] = $score;
        $matches[] = $entry;
    }

    usort($matches, $tieBreak);

    return [array_slice($matches, 0, $limit), count($matches)];
}
