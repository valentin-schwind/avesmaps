<?php

declare(strict_types=1);

/**
 * Live parity check: does the key derivation still reproduce PRODUCTION?
 * ---------------------------------------------------------------------------
 * WHAT IT PROVES
 *   avesmapsPoliticalBuildWikiKey() is the function that mints `wiki_key`, the
 *   join anchor between political_territory, wiki_publication_catalog,
 *   wiki_adventure_catalog, adventure_place, lore_place, sources and a handful
 *   more. Its output MUST stay byte-identical to the keys already stored, or
 *   every join using an affected key breaks silently -- no error, no log line,
 *   just rows that stop finding each other.
 *
 *   This tool rebuilds every live territory key from its stored name/URL and
 *   compares. Expected result: 1384 match, 0 differ (as of 2026-07-24).
 *
 * WHY IT EXISTS AS A TOOL AND NOT AS A SELF-TEST
 *   It needs the network, so it cannot join the DB-free set the in-editor panel
 *   runs (api/edit/wiki/selftest.php). Run it by hand after touching
 *   api/_internal/text/ascii-fold.php, avesmapsPoliticalSlug(), or anything else
 *   in the derivation chain.
 *
 * ⚠️ ONE REQUEST, NEVER IN A LOOP (AGENTS.md §9). The endpoint runs two
 *    correlated subqueries per row; hammering it saturates the STRATO PHP
 *    workers and looks exactly like a database outage.
 *
 * HOW TO RUN
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_curl.dll tools/wikidump/verify-live-key-parity.php
 *
 *   A PHP CLI without a CA bundle cannot verify the certificate. Rather than
 *   turning verification off, fetch the corpus with any tool you trust and pass
 *   it in -- same check, and it can then be re-run offline:
 *
 *     curl -s "<endpoint printed below>" -o corpus.json
 *     php ... tools/wikidump/verify-live-key-parity.php --file=corpus.json
 *
 * Exit code: 0 iff every live key is reproduced; 1 on any mismatch; 2 if the
 * corpus could not be obtained (inconclusive -- NOT a pass).
 */

const AVESMAPS_PARITY_ENDPOINT = 'https://avesmaps.de/api/app/political-territory-wiki.php?limit=2000';
const AVESMAPS_PARITY_TIMEOUT_SECONDS = 120;
const AVESMAPS_PARITY_EXAMPLE_LIMIT = 25;

if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the derivation requires it.\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/political/territory.php';

if (!function_exists('avesmapsPoliticalBuildWikiKey')) {
    fwrite(STDERR, "FATAL: avesmapsPoliticalBuildWikiKey() was not defined by the included library.\n");
    exit(2);
}

// A pre-fetched corpus may be passed in with --file=<path> (see the docblock).
$corpusFile = '';
foreach (array_slice($argv ?? [], 1) as $argument) {
    if (str_starts_with((string) $argument, '--file=')) {
        $corpusFile = substr((string) $argument, 7);
    }
}

echo "================================================================\n";
echo " live wiki_key parity check (production vs. the local derivation)\n";
echo "================================================================\n";
echo 'PHP version : ' . PHP_VERSION . "\n";
echo 'source      : ' . ($corpusFile !== '' ? $corpusFile : AVESMAPS_PARITY_ENDPOINT) . "\n";
echo "----------------------------------------------------------------\n\n";

// ---------------------------------------------------------------------------
// Obtain the corpus. ONE request, or a file the caller fetched themselves.
// ---------------------------------------------------------------------------
if ($corpusFile !== '') {
    if (!is_file($corpusFile)) {
        fwrite(STDERR, "FATAL: corpus file not found: {$corpusFile}\n");
        exit(2);
    }
    $payload = file_get_contents($corpusFile);
    if (!is_string($payload) || $payload === '') {
        fwrite(STDERR, "FATAL: corpus file is empty or unreadable: {$corpusFile}\n");
        exit(2);
    }
} elseif (function_exists('curl_init')) {
    $curl = curl_init(AVESMAPS_PARITY_ENDPOINT);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => AVESMAPS_PARITY_TIMEOUT_SECONDS,
        CURLOPT_USERAGENT => 'Avesmaps key-parity check',
    ]);
    $payload = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);
    if (!is_string($payload) || $status !== 200) {
        fwrite(STDERR, "FATAL: fetch failed (HTTP {$status}) {$curlError}\n");
        // A CLI without a CA bundle is the common case here. Do NOT work around
        // it by disabling verification -- fetch the corpus separately instead.
        fwrite(STDERR, "\nFetch it with a tool that has a CA store and pass it in:\n");
        fwrite(STDERR, '  curl -s "' . AVESMAPS_PARITY_ENDPOINT . "\" -o corpus.json\n");
        fwrite(STDERR, '  php -d extension=php_mbstring.dll ' . basename(__FILE__) . " --file=corpus.json\n");
        exit(2);
    }
} else {
    fwrite(STDERR, "FATAL: ext/curl is not loaded and no --file=<path> was given.\n");
    fwrite(STDERR, "Re-run with -d extension=php_curl.dll, or pass a pre-fetched corpus.\n");
    exit(2);
}

$decoded = json_decode($payload, true);
$items = is_array($decoded) ? ($decoded['items'] ?? null) : null;
if (!is_array($items) || $items === []) {
    fwrite(STDERR, "FATAL: the response carried no 'items' array -- nothing to compare.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// Rebuild every key and compare.
// ---------------------------------------------------------------------------
$matched = 0;
$differed = 0;
$skipped = 0;
$examples = [];
$nonAsciiRows = 0;

foreach ($items as $row) {
    if (!is_array($row)) {
        continue;
    }
    $stored = trim((string) ($row['wiki_key'] ?? ''));
    if ($stored === '') {
        $skipped++;
        continue;
    }

    $name = (string) ($row['name'] ?? '');
    $wikiUrl = (string) ($row['wiki_url'] ?? '');
    if (preg_match('/[^\x00-\x7F]/', rawurldecode($wikiUrl !== '' ? $wikiUrl : $name)) === 1) {
        $nonAsciiRows++;
    }

    $rebuilt = avesmapsPoliticalBuildWikiKey($wikiUrl, $name);
    if ($rebuilt === $stored) {
        $matched++;
        continue;
    }

    $differed++;
    if (count($examples) < AVESMAPS_PARITY_EXAMPLE_LIMIT) {
        $examples[] = ['name' => $name, 'url' => $wikiUrl, 'stored' => $stored, 'rebuilt' => $rebuilt];
    }
}

printf("rows compared        : %d\n", $matched + $differed);
printf("  carrying non-ASCII : %d  (the ones the fold can affect)\n", $nonAsciiRows);
printf("rows without a key   : %d  (skipped)\n", $skipped);
printf("\nMATCH: %d    DIFFER: %d\n", $matched, $differed);

if ($differed > 0) {
    printf("\nfirst %d mismatches:\n", count($examples));
    foreach ($examples as $example) {
        echo "  name    : {$example['name']}\n";
        echo "  url     : {$example['url']}\n";
        echo "  STORED  : {$example['stored']}\n";
        echo "  rebuilt : {$example['rebuilt']}\n\n";
    }
    echo "----------------------------------------------------------------\n";
    echo "The derivation no longer reproduces production. Fix the derivation --\n";
    echo "do NOT rewrite the stored keys. See\n";
    echo "docs/superpowers/specs/2026-07-24-wiki-key-deterministische-transliteration-design.md\n";
    exit(1);
}

echo "\n----------------------------------------------------------------\n";
echo "RESULT: every live key is reproduced exactly. Safe.\n";
echo "----------------------------------------------------------------\n";
exit(0);
