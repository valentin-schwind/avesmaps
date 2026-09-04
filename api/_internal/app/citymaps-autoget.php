<?php

declare(strict_types=1);

// Where an autoget preview COMES FROM -- URL resolution plus the three route parsers (wiki API,
// Ulisses, plain page). Split out of citymaps.php, which requires this file at the point the block
// used to sit; the four AVESMAPS_CITYMAP_WIKI_* constants it reads stay there and are defined first.

// ---- Autoget: find a preview on the map's own page ---------------------------------------------------
// PURE (no PDO, no HTTP) -> unit-tested in __tests__/citymap-autoget-test.php. The fetching, and the SSRF
// guard around it, live in api/edit/map/citymap-image.php + avesmapsLinkCheckFetchBody.
//
// This REVERSES the spec: §3.3/§6 said "kein serverseitiger Bild-Fetch, SSRF-Risiko ohne Gegenwert".
// Owner decision 2026-07-16 -- the value is real (a preview without hand-work) and the risk is now
// covered by the linkcheck guard, which did not exist when that line was written. The result is
// EDITOR-ONLY (thumb_auto_url), so we crawl a picture we never publish.

// Resolve a possibly-relative URL against the page it came from. Returns '' for anything that is not
// plain http(s) afterwards -- data:, javascript:, mailto: and friends have no business here, and this is
// the last place before the URL is handed to a fetcher.
function avesmapsCitymapResolveUrl(string $candidate, string $baseUrl): string
{
    $candidate = trim($candidate);
    if ($candidate === '') {
        return '';
    }
    $base = parse_url($baseUrl);
    $baseScheme = strtolower((string) ($base['scheme'] ?? 'https'));
    $baseHost = (string) ($base['host'] ?? '');
    if ($baseHost === '') {
        return '';
    }
    $basePort = isset($base['port']) ? ':' . (int) $base['port'] : '';

    if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $candidate)) {
        // Already absolute with a scheme -- keep only http/https.
        $scheme = strtolower((string) (parse_url($candidate, PHP_URL_SCHEME) ?: ''));
        return ($scheme === 'http' || $scheme === 'https') ? $candidate : '';
    }
    if (str_starts_with($candidate, '//')) {
        return $baseScheme . ':' . $candidate; // protocol-relative
    }
    if (str_starts_with($candidate, '/')) {
        return $baseScheme . '://' . $baseHost . $basePort . $candidate;
    }
    // Document-relative: hang it off the base path's directory.
    $basePath = (string) ($base['path'] ?? '/');
    $dir = substr($basePath, 0, (int) strrpos($basePath, '/') + 1);
    if ($dir === '') {
        $dir = '/';
    }
    return $baseScheme . '://' . $baseHost . $basePort . $dir . $candidate;
}

// ---- Autoget, the Ulisses special case ---------------------------------------------------------------
// The DSA shop is our single most common map source and its HTML answers 403 to any server-side request
// -- it gates on the TLS fingerprint, not on who we claim to be (verified for the linkchecker on
// 2026-07-16, re-verified here: 403 to our bot UA AND to a Chrome UA). So there is no og:image to read
// and the generic path below would simply fail on nearly every map we have.
//
// The linkchecker already solved exactly this: avesmapsLinkCheckProbeUrl rewrites a product page to the
// shop's own product API, which answers our honest bot politely. That API also carries the cover, so
// Autoget reuses the same detour rather than inventing a second piece of host knowledge. We do NOT spoof
// a browser to get past the gate -- we ask an endpoint that is willing to answer.
//
// Returns '' for every other host, and the caller then takes the og:image route.
function avesmapsCitymapUlissesApiUrl(string $mapUrl): string
{
    // Anchored on the exact host (optionally www) so a lookalike domain cannot trigger the rewrite --
    // same anchoring as avesmapsLinkCheckProbeUrl, whose regex this deliberately mirrors.
    if (preg_match('~^https?://(?:www\.)?ulisses-ebooks\.de/[a-z]{2}/product/(\d+)(?:[/?\#]|$)~i', $mapUrl, $m) === 1) {
        return 'https://api.ulisses-ebooks.de/api/vBeta/products/' . $m[1];
    }
    return '';
}

// PURE. The cover out of the product API's JSON. The paths are relative to the shop's /images/ (which
// 301s to its CDN -- the fetcher follows redirects, bounded, and re-checks the final peer).
// Priority: the full image first, because our own downscaler produces a better 400px thumb than the
// shop's 200px one; the pre-made thumbnails are the fallback when there is no full cover.
//
// TWO SHAPES, because the API CONTENT-NEGOTIATES (measured 2026-07-16, and it cost us a live failure):
//   Accept: application/json  ->  {"image":"3444/120516.jpg", ...}                 (flat)
//   no Accept header          ->  {"data":{"attributes":{"image":"3444/..."}}}     (JSON:API envelope)
// The first shipped version read only the envelope while the endpoint sent the JSON Accept header, so it
// always answered "kein Titelbild" -- and the test agreed with it, because the fixture had been copied
// from a curl run that sent no Accept header. Test and code were consistent with each other and both
// wrong about the server. Handling BOTH shapes is not belt-and-braces: which one arrives depends on a
// header far from here, and that is exactly the coupling that broke it.
function avesmapsCitymapPickUlissesImage(string $json): string
{
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return '';
    }
    $attributes = $decoded['data']['attributes'] ?? null;
    if (!is_array($attributes)) {
        $attributes = $decoded; // flat shape
    }
    foreach (['image', 'webImage', 'thumbnail200', 'thumbnail'] as $field) {
        $path = trim((string) ($attributes[$field] ?? ''));
        // Guard the shape: these are bare "<publisher>/<file>" paths. Anything else -- an absolute URL,
        // a traversal, a scheme -- is not what this API returns, and we do not improvise around it.
        if ($path === '' || str_contains($path, '..') || preg_match('~^[a-z][a-z0-9+.-]*:~i', $path) === 1 || str_starts_with($path, '/')) {
            continue;
        }
        return 'https://www.ulisses-ebooks.de/images/' . $path;
    }
    return '';
}

// ---- Autoget, the wiki route -------------------------------------------------------------------------
// PURE. The page title out of a map_url, or '' when this is not a wiki article URL.
//
// Host-anchored exactly like avesmapsCitymapUlissesApiUrl, and for a sharper reason: this route's answer
// is trusted enough to be PUBLISHED (a wiki page image is a publisher cover by construction), so a
// lookalike domain must never reach it.
function avesmapsCitymapWikiPageTitle(string $mapUrl): string
{
    $parts = parse_url($mapUrl);
    if (!is_array($parts)) {
        return '';
    }
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $host = strtolower((string) ($parts['host'] ?? ''));
    if (($scheme !== 'http' && $scheme !== 'https') || $host !== AVESMAPS_CITYMAP_WIKI_HOST) {
        return '';
    }
    $path = (string) ($parts['path'] ?? '');
    if (!str_starts_with($path, '/wiki/')) {
        return '';
    }
    // rawurldecode, not urldecode: '+' is a literal plus in a path segment, not a space. parse_url has
    // already stripped any #fragment, which is not part of the title.
    $title = rawurldecode(substr($path, strlen('/wiki/')));
    // MediaWiki treats '_' and ' ' as the same character in a title, and the API answers in spaces.
    return trim(str_replace('_', ' ', $title));
}

// PURE. Which of the three routes a map_url takes.
//
// The route decides whether the result may be shown to readers (Spec §4), and it is deliberately DERIVED
// FROM THE SOURCE rather than stored as a flag: a wiki page image and an Ulisses product image are
// publisher covers by construction, an arbitrary og:image from a third-party host is not. A flag can be
// set wrongly; a route cannot.
function avesmapsCitymapAutogetRoute(string $mapUrl): string
{
    if (avesmapsCitymapWikiPageTitle($mapUrl) !== '') {
        return 'wiki';
    }
    if (avesmapsCitymapUlissesApiUrl($mapUrl) !== '') {
        return 'ulisses';
    }
    return 'ogimage';
}

// PURE. The batch query for up to 50 titles -- the reason a 133-source run costs ~6 requests.
//
// Throws above the limit rather than slicing: a silent slice would drop maps from a run that then reports
// itself complete, and "no silent truncation" is the one thing the owner asked for by name.
function avesmapsCitymapWikiApiUrl(array $titles): string
{
    $clean = [];
    foreach ($titles as $title) {
        $value = trim((string) $title);
        if ($value !== '' && !in_array($value, $clean, true)) {
            $clean[] = $value;
        }
    }
    if ($clean === []) {
        return '';
    }
    if (count($clean) > AVESMAPS_CITYMAP_WIKI_TITLE_BATCH) {
        throw new InvalidArgumentException('Zu viele Titel für einen API-Call: ' . count($clean));
    }
    return AVESMAPS_CITYMAP_WIKI_API_URL . '?' . http_build_query([
        'action' => 'query',
        'titles' => implode('|', $clean),
        'prop' => 'pageimages',
        'piprop' => 'thumbnail|original|name',
        'pithumbsize' => (string) AVESMAPS_CITYMAP_THUMB_MAX_EDGE_WIKI,
        // Without this a map_url pointing at a redirect resolves to nothing at all.
        'redirects' => '1',
        'format' => 'json',
    ], '', '&', PHP_QUERY_RFC3986);
}

// PURE. [title => image url] out of the API's answer. A title that is absent simply has no page image --
// a normal answer, not an error (pageid -1 means the page does not exist at all).
//
// Prefers `thumbnail` over `original`: pithumbsize already asked for exactly our edge length, so the
// original would only be bytes we downscale away again.
function avesmapsCitymapPickWikiImages(string $json): array
{
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return [];
    }
    $pages = $decoded['query']['pages'] ?? null;
    if (!is_array($pages)) {
        return [];
    }
    $out = [];
    foreach ($pages as $page) {
        if (!is_array($page) || (int) ($page['pageid'] ?? -1) < 0) {
            continue;
        }
        $title = trim((string) ($page['title'] ?? ''));
        if ($title === '') {
            continue;
        }
        $source = '';
        foreach (['thumbnail', 'original'] as $field) {
            $candidate = trim((string) ($page[$field]['source'] ?? ''));
            if ($candidate !== '') {
                $source = $candidate;
                break;
            }
        }
        // We asked the WIKI for titles, so the picture must be the wiki's. A foreign host here would mean
        // the answer is choosing which server we talk to next -- exactly the og:image -> 169.254.169.254
        // shape. avesmapsLinkCheckFetchBody would still refuse it; this is the door in front of it.
        if ($source === '' || strtolower((string) parse_url($source, PHP_URL_HOST)) !== AVESMAPS_CITYMAP_WIKI_HOST) {
            continue;
        }
        $out[$title] = $source;
    }
    return $out;
}

// Pick the preview image out of a page's HTML, in the order publishers actually maintain them:
// og:image (the one every shop sets for social sharing) -> twitter:image -> link rel=image_src (legacy).
// Returns an absolute http(s) URL, or '' when the page offers none -- which is a normal answer, not an
// error: plenty of pages have no preview and the editor then uploads one.
//
// Regex rather than DOMDocument on purpose: we want the <meta> tags and nothing else, on input that is
// frequently malformed, and a parser would happily follow it into places we do not need to go.
function avesmapsCitymapPickPreviewImage(string $html, string $baseUrl): string
{
    if ($html === '') {
        return '';
    }
    // og:/twitter: use `property`, some CMSes use `name` for both -> accept either.
    $wanted = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'];
    $found = [];
    if (preg_match_all('/<meta\b[^>]*>/i', $html, $metas)) {
        foreach ($metas[0] as $meta) {
            if (!preg_match('/\b(?:property|name)\s*=\s*["\']([^"\']+)["\']/i', $meta, $keyMatch)) {
                continue;
            }
            $key = strtolower(trim($keyMatch[1]));
            if (!in_array($key, $wanted, true) || isset($found[$key])) {
                continue;
            }
            if (preg_match('/\bcontent\s*=\s*["\']([^"\']*)["\']/i', $meta, $valueMatch)) {
                $value = html_entity_decode(trim($valueMatch[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                if ($value !== '') {
                    $found[$key] = $value;
                }
            }
        }
    }
    foreach ($wanted as $key) {
        if (isset($found[$key])) {
            $resolved = avesmapsCitymapResolveUrl($found[$key], $baseUrl);
            if ($resolved !== '') {
                return $resolved;
            }
        }
    }
    // Legacy fallback: <link rel="image_src" href="...">
    if (preg_match_all('/<link\b[^>]*>/i', $html, $links)) {
        foreach ($links[0] as $link) {
            if (!preg_match('/\brel\s*=\s*["\']?image_src["\']?/i', $link)) {
                continue;
            }
            if (preg_match('/\bhref\s*=\s*["\']([^"\']*)["\']/i', $link, $hrefMatch)) {
                $resolved = avesmapsCitymapResolveUrl(html_entity_decode(trim($hrefMatch[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'), $baseUrl);
                if ($resolved !== '') {
                    return $resolved;
                }
            }
        }
    }
    return '';
}
