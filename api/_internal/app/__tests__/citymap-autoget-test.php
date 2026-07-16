<?php

declare(strict_types=1);

/**
 * Unit test for the Autoget crawl's PURE parts. No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/app/__tests__/citymap-autoget-test.php
 *
 * Autoget reverses §3.3/§6 ("kein serverseitiger Bild-Fetch, SSRF-Risiko") on the owner's call, and the
 * risk is carried by the linkcheck guard. But the guard can only refuse what it is handed: these two
 * functions decide WHAT URL gets handed to it, from HTML we do not control. A page we crawl is free to
 * declare <meta property="og:image" content="http://169.254.169.254/latest/meta-data/"> and we would
 * dutifully resolve it -- the guard then refuses the fetch, but only because the URL reached it intact
 * and recognisable. So: no scheme smuggling, no silent mangling, and a relative URL must resolve against
 * the page it actually came from (the FINAL url after redirects), never somewhere else.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../citymaps.php';

$base = 'https://shop.example.org/de/product/120516/gareth-karte';

// ---- URL resolution ---------------------------------------------------------------------------------
// Absolute stays absolute.
assert(avesmapsCitymapResolveUrl('https://cdn.example.org/a.jpg', $base) === 'https://cdn.example.org/a.jpg');
assert(avesmapsCitymapResolveUrl('http://cdn.example.org/a.jpg', $base) === 'http://cdn.example.org/a.jpg');
// Protocol-relative inherits the PAGE's scheme (not a hardcoded https -- an http page must not be
// silently upgraded, that would fetch a different resource than the page meant).
assert(avesmapsCitymapResolveUrl('//cdn.example.org/a.jpg', $base) === 'https://cdn.example.org/a.jpg');
assert(avesmapsCitymapResolveUrl('//cdn.example.org/a.jpg', 'http://shop.example.org/p') === 'http://cdn.example.org/a.jpg');
// Root-relative hangs off the host.
assert(avesmapsCitymapResolveUrl('/img/cover.png', $base) === 'https://shop.example.org/img/cover.png');
// Document-relative hangs off the base path's DIRECTORY, not the page itself.
assert(avesmapsCitymapResolveUrl('cover.png', $base) === 'https://shop.example.org/de/product/120516/cover.png');
assert(avesmapsCitymapResolveUrl('cover.png', 'https://x.example.org/') === 'https://x.example.org/cover.png');
assert(avesmapsCitymapResolveUrl('cover.png', 'https://x.example.org') === 'https://x.example.org/cover.png');
// A non-default port survives -- dropping it would fetch a different service on the same host.
assert(avesmapsCitymapResolveUrl('/a.jpg', 'https://x.example.org:8443/p') === 'https://x.example.org:8443/a.jpg');

// EVERY non-http(s) scheme is dropped, not "cleaned". This is the last gate before a fetcher; a
// data:-URI would be embedded wholesale and javascript: has no meaning server-side but every meaning if
// the value ever reached a template.
foreach (['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'file:///etc/passwd',
          'mailto:a@b.c', 'ftp://x/y.jpg', 'gopher://x/1'] as $bad) {
    assert(avesmapsCitymapResolveUrl($bad, $base) === '', 'scheme must be refused: ' . $bad);
}
assert(avesmapsCitymapResolveUrl('', $base) === '');
assert(avesmapsCitymapResolveUrl('  ', $base) === '');
// No usable base -> nothing to resolve against -> refuse rather than guess a host.
assert(avesmapsCitymapResolveUrl('/a.jpg', 'not-a-url') === '');
// The guard's job, not ours: a link-local target resolves NORMALLY here and is refused by
// avesmapsLinkCheckFetchBody. Mangling it here would only hide it from the thing that can judge it.
assert(avesmapsCitymapResolveUrl('http://169.254.169.254/latest/meta-data/', $base) === 'http://169.254.169.254/latest/meta-data/');
echo "resolve-url ok\n";

// ---- preview picking --------------------------------------------------------------------------------
$og = '<html><head><meta property="og:image" content="https://cdn.example.org/og.jpg">'
    . '<meta name="twitter:image" content="https://cdn.example.org/tw.jpg"></head><body>x</body></html>';
assert(avesmapsCitymapPickPreviewImage($og, $base) === 'https://cdn.example.org/og.jpg', 'og:image wins');

// twitter:image when there is no og:image.
$tw = '<meta name="twitter:image" content="https://cdn.example.org/tw.jpg">';
assert(avesmapsCitymapPickPreviewImage($tw, $base) === 'https://cdn.example.org/tw.jpg');
// Some CMSes put og: on `name` and twitter: on `property` -- accept either attribute for either family.
assert(avesmapsCitymapPickPreviewImage('<meta name="og:image" content="/a.png">', $base) === 'https://shop.example.org/a.png');
assert(avesmapsCitymapPickPreviewImage('<meta property="twitter:image" content="/b.png">', $base) === 'https://shop.example.org/b.png');
// Legacy <link rel="image_src">.
assert(avesmapsCitymapPickPreviewImage('<link rel="image_src" href="/legacy.png">', $base) === 'https://shop.example.org/legacy.png');
// Relative og:image resolves against the page.
assert(avesmapsCitymapPickPreviewImage('<meta property="og:image" content="cover.png">', $base) === 'https://shop.example.org/de/product/120516/cover.png');
// Entities in the attribute are decoded -- a query string is where &amp; shows up, and a wrong URL is a
// failed fetch, not a bug you would look for here.
assert(avesmapsCitymapPickPreviewImage('<meta property="og:image" content="/i?a=1&amp;b=2">', $base) === 'https://shop.example.org/i?a=1&b=2');
// Attribute order, single quotes, extra attributes, uppercase tags: all real-world HTML.
assert(avesmapsCitymapPickPreviewImage("<META CONTENT='https://cdn.example.org/x.jpg' PROPERTY='og:image'>", $base) === 'https://cdn.example.org/x.jpg');
// Duplicated og:image (common on paginated shops) -> the FIRST wins, deterministically.
assert(avesmapsCitymapPickPreviewImage(
    '<meta property="og:image" content="/first.png"><meta property="og:image" content="/second.png">', $base
) === 'https://shop.example.org/first.png');

// No preview is a NORMAL answer, not an error -- the editor then uploads one.
assert(avesmapsCitymapPickPreviewImage('<html><head><title>x</title></head></html>', $base) === '');
assert(avesmapsCitymapPickPreviewImage('', $base) === '');
assert(avesmapsCitymapPickPreviewImage('<meta property="og:image" content="">', $base) === '');
// A hostile scheme in og:image is dropped -> as if the page had no preview, NOT passed on.
assert(avesmapsCitymapPickPreviewImage('<meta property="og:image" content="javascript:alert(1)">', $base) === '');
assert(avesmapsCitymapPickPreviewImage('<meta property="og:image" content="data:text/html,<script>alert(1)</script>">', $base) === '');
// A hostile og:image must not shadow a usable twitter:image -- we fall through rather than give up.
assert(avesmapsCitymapPickPreviewImage(
    '<meta property="og:image" content="data:text/html,x"><meta name="twitter:image" content="/ok.png">', $base
) === 'https://shop.example.org/ok.png');
// og:image:secure_url / :url are accepted, ranked after the plain one.
assert(avesmapsCitymapPickPreviewImage('<meta property="og:image:secure_url" content="/s.png">', $base) === 'https://shop.example.org/s.png');
assert(avesmapsCitymapPickPreviewImage(
    '<meta property="og:image:secure_url" content="/s.png"><meta property="og:image" content="/plain.png">', $base
) === 'https://shop.example.org/plain.png');
// An og:image pointing at cloud metadata resolves intact and is handed to the guard to refuse. It must
// NOT be silently rewritten here -- a guard that never sees the URL cannot refuse it.
assert(avesmapsCitymapPickPreviewImage(
    '<meta property="og:image" content="http://169.254.169.254/latest/meta-data/iam/">', $base
) === 'http://169.254.169.254/latest/meta-data/iam/');
echo "pick-preview ok\n";

// ---- the editor/public split (owner decision: Autoget never goes public) -----------------------------
$row = [
    'thumb_url' => '', 'thumb_local_url' => '', 'thumb_auto_url' => '/uploads/kartensammlungen/x/auto-1.png',
    'thumb_license' => 'cc0', // even a FREE licence must not publish an auto-crawled picture
];
assert(avesmapsCitymapEditorThumbUrl($row) === '/uploads/kartensammlungen/x/auto-1.png', 'the editor sees it');
assert(avesmapsCitymapPublicThumbUrl($row) === '', 'the public read NEVER sees it, licence notwithstanding');
// The editor's own upload outranks the crawl; the external thumb ranks last.
$row['thumb_local_url'] = '/uploads/kartensammlungen/x/thumb-2.png';
assert(avesmapsCitymapEditorThumbUrl($row) === '/uploads/kartensammlungen/x/thumb-2.png');
assert(avesmapsCitymapPublicThumbUrl($row) === '/uploads/kartensammlungen/x/thumb-2.png', 'an upload with a free licence IS public');
assert(avesmapsCitymapEditorThumbUrl(['thumb_url' => 'https://e.org/t.jpg']) === 'https://e.org/t.jpg');
assert(avesmapsCitymapEditorThumbUrl([]) === '');
echo "autoget editor/public split ok\n";

echo "citymap-autoget ok\n";
