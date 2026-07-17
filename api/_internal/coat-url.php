<?php

declare(strict_types=1);

/**
 * Cache-busting for locally stored coats of arms (/uploads/wappen/<slug>-custom.<ext>).
 *
 * A re-uploaded coat keeps its filename (the upload in sync-monitor-identity.php derives it from the
 * wiki_key slug), and /uploads is served with Cache-Control: max-age=2592000. Without a version marker a
 * browser that already fetched the old image keeps showing it for up to 30 days -- the coat looks like it
 * "was not taken over". Appending ?v=<mtime> breaks the browser cache EXACTLY on change and keeps the
 * 30-day cache otherwise (perf). Remote coats (wiki URLs, api/app/coat.php) are left untouched.
 *
 * This lives here rather than in one endpoint because three separate readers surface the same coat URL --
 * the political layer, the territory detail (infobox) and the settlement breadcrumb thumbnail. When only
 * one of them versioned the URL, the others served stale bytes (Discord #32, Grafschaft Ferdok).
 */
function avesmapsCoatUrlCacheBust(string $url): string {
    static $resolved = [];

    $url = trim($url);
    // Remote URLs and anything that already carries a query string are none of our business.
    if ($url === '' || strpos($url, '?') !== false || strncmp($url, '/uploads/', 9) !== 0) {
        return $url;
    }
    if (array_key_exists($url, $resolved)) {
        return $resolved[$url];
    }

    $root = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    if ($root === '') {
        return $url;
    }
    $mtime = @filemtime($root . $url);

    return $resolved[$url] = ($mtime !== false ? ($url . '?v=' . $mtime) : $url);
}
