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

/**
 * The only licence under which a coat may appear on the public map (NOTICE.md / Ulisses fan rules).
 * One constant replacing the identical per-endpoint copies AVESMAPS_TERRITORY_DETAIL_COAT_ALLOWED and
 * AVESMAPS_MAP_FEATURES_COAT_ALLOWED, so the legal gate cannot drift apart between readers.
 */
const AVESMAPS_COAT_PUBLIC_LICENSES = ['public_domain'];

/**
 * The ONE canonical precedence for a publicly displayed coat of arms. Every reader routes through this so
 * the territory label, the territory infobox and the settlement "Liegt in" breadcrumb can never diverge
 * again -- Discord #32 (Grafschaft Ferdok) happened precisely because each reader re-implemented the
 * precedence and the map layer put the uploaded override LAST instead of first.
 *
 *   url     = override['coat_of_arms_url']  when the override sets that key (DECISIVE, even when '')
 *             else own (political_territory.coat_of_arms_url)  else staging (the crawled wiki coat)
 *   licence = override['coat_of_arms_license_status']  when the override sets it  else the staging licence
 *
 * An override that sets an EMPTY url is a deliberate "no coat" (e.g. an occupation correction) and is
 * honoured -- there is no fall-through to the wiki coat. Only public_domain is ever emitted; anything else
 * yields '' (a non-public-domain coat on the public map is a NOTICE.md / legal violation). The returned
 * URL is cache-busted (?v=<mtime>) exactly like every other local upload.
 */
function avesmapsResolveGatedCoatUrl(array $override, string $ownUrl, string $stagingUrl, string $stagingLicense): string {
    $license = array_key_exists('coat_of_arms_license_status', $override)
        ? trim((string) $override['coat_of_arms_license_status'])
        : trim($stagingLicense);
    $ownUrl = trim($ownUrl);
    $url = array_key_exists('coat_of_arms_url', $override)
        ? trim((string) $override['coat_of_arms_url'])
        : ($ownUrl !== '' ? $ownUrl : trim($stagingUrl));
    if ($url === '' || !in_array($license, AVESMAPS_COAT_PUBLIC_LICENSES, true)) {
        return '';
    }

    return avesmapsCoatUrlCacheBust($url);
}
