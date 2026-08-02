<?php

declare(strict_types=1);

// Pure scoring core of the map search. Extracted from api/app/map-search.php so it can be tested
// without a database: that file is an ENDPOINT -- requiring it runs a request. Nothing here touches
// PDO, $_GET or the network; arguments in, verdict out.
//
// Guarded against double declaration because the endpoint and in-settlement-search.php may both
// require it depending on load order.

require_once __DIR__ . '/../text/ascii-fold.php';

/**
 * Score an entry against a normalised query. NULL = no match.
 *
 * The query is split into WORDS, and every word must hit at least one of the entry's search texts --
 * but they may hit DIFFERENT ones. That is the whole difference to the previous version, which
 * compared the query as one string against each text on its own and therefore could not match
 * "stadtplan gareth" (type in one text, place in another).
 *
 * The entry scores as badly as its WEAKEST word: a query is only satisfied to the degree its worst
 * part is. A single-word query walks the identical path as before -- one word, its own score -- which
 * is what keeps the common case bit-for-bit unchanged.
 */
function avesmapsCalculateSearchScore(array $entry, string $normalizedQuery): ?int {
    $words = array_values(array_filter(preg_split('/\s+/', $normalizedQuery) ?: [], static fn (string $w): bool => $w !== ''));
    if ($words === []) {
        return null;
    }

    $candidates = [];
    foreach ($entry['search_texts'] ?? [] as $searchText) {
        $candidate = avesmapsNormalizeSearchText((string) $searchText);
        if ($candidate !== '') {
            $candidates[] = $candidate;
        }
    }
    if ($candidates === []) {
        return null;
    }

    $worstWordScore = 0;
    foreach ($words as $word) {
        $bestForWord = null;
        foreach ($candidates as $candidate) {
            $score = avesmapsScoreSearchWord($candidate, $word);
            if ($score !== null) {
                $bestForWord = $bestForWord === null ? $score : min($bestForWord, $score);
            }
        }

        if ($bestForWord === null) {
            return null; // one unmatched word is enough to reject the entry
        }
        $worstWordScore = max($worstWordScore, $bestForWord);
    }

    return $worstWordScore;
}

/**
 * The four tiers, unchanged from the original: equal / prefix / word-prefix / contained.
 */
function avesmapsScoreSearchWord(string $candidate, string $word): ?int {
    if ($candidate === $word) {
        return 0;
    }
    if (str_starts_with($candidate, $word)) {
        return 1;
    }
    if (avesmapsAnySearchWordStartsWith($candidate, $word)) {
        return 2;
    }
    if (str_contains($candidate, $word)) {
        return 3;
    }

    return null;
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
