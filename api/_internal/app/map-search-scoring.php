<?php

declare(strict_types=1);

// Pure scoring core of the map search. Extracted from api/app/map-search.php so it can be tested
// without a database: that file is an ENDPOINT -- requiring it runs a request. Nothing here touches
// PDO, $_GET or the network; arguments in, verdict out.
//
// Guarded against double declaration because the endpoint and in-settlement-search.php may both
// require it depending on load order.

require_once __DIR__ . '/../text/ascii-fold.php';

function avesmapsCalculateSearchScore(array $entry, string $normalizedQuery): ?int {
    $bestScore = null;
    foreach ($entry['search_texts'] ?? [] as $searchText) {
        $candidate = avesmapsNormalizeSearchText((string) $searchText);
        if ($candidate === '') {
            continue;
        }

        $score = null;
        if ($candidate === $normalizedQuery) {
            $score = 0;
        } elseif (str_starts_with($candidate, $normalizedQuery)) {
            $score = 1;
        } elseif (avesmapsAnySearchWordStartsWith($candidate, $normalizedQuery)) {
            $score = 2;
        } elseif (str_contains($candidate, $normalizedQuery)) {
            $score = 3;
        }

        if ($score !== null) {
            $bestScore = $bestScore === null ? $score : min($bestScore, $score);
        }
    }

    return $bestScore;
}

function avesmapsAnySearchWordStartsWith(string $candidate, string $query): bool {
    foreach (preg_split('/\s+/', $candidate) ?: [] as $word) {
        if ($word !== '' && str_starts_with($word, $query)) {
            return true;
        }
    }

    return false;
}

function avesmapsNormalizeSearchText(string $value): string {
    $normalizedValue = mb_strtolower(trim($value));
    $normalizedValue = str_replace(
        ['ß', 'ä', 'ö', 'ü', 'à', 'á', 'â', 'è', 'é', 'ê', 'ì', 'í', 'î', 'ò', 'ó', 'ô', 'ù', 'ú', 'û'],
        ['ss', 'ae', 'oe', 'ue', 'a', 'a', 'a', 'e', 'e', 'e', 'i', 'i', 'i', 'o', 'o', 'o', 'u', 'u', 'u'],
        $normalizedValue
    );
    // Deterministic table, NOT iconv//TRANSLIT. The German umlauts and the
    // common accents are already mapped above, so the fold only catches the
    // leftovers -- and turns them into a word separator, exactly as the
    // server's iconv did. Query and haystack run through the same function.
    $normalizedValue = avesmapsFoldToAscii($normalizedValue);

    return trim(preg_replace('/[^a-z0-9]+/', ' ', $normalizedValue) ?? '');
}
