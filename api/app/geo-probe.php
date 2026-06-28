<?php

declare(strict_types=1);

// TEMPORARY diagnostic: does the host provide a geo/country header? Returns ONLY geo-related
// $_SERVER key NAMES (and the value for country-code-like headers, which are non-identifying).
// Never returns the IP. Delete after probing.

header('Content-Type: application/json');

$found = [];
foreach ($_SERVER as $key => $value) {
    if (preg_match('/GEO|COUNTRY|CF_|CLOUDFRONT|FASTLY|X_FORWARDED|CLIENT_IP|REAL_IP/i', (string) $key)) {
        $isCountryCode = (bool) preg_match('/COUNTRY/i', (string) $key);
        $found[$key] = $isCountryCode ? (string) $value : '(present, value hidden)';
    }
}

echo json_encode(['geo_related_keys' => $found], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
