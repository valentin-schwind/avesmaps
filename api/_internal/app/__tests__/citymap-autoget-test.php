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

// ---- the Ulisses detour -----------------------------------------------------------------------------
// The shop's HTML is 403 to any server-side request (TLS-fingerprint gate), so og:image is unreachable
// there and this detour is what makes Autoget work at all for the most common map source.
assert(avesmapsCitymapUlissesApiUrl('https://www.ulisses-ebooks.de/de/product/120516/gareth-karte-pdf-als-download-kaufen')
    === 'https://api.ulisses-ebooks.de/api/vBeta/products/120516');
assert(avesmapsCitymapUlissesApiUrl('https://ulisses-ebooks.de/en/product/99/x') === 'https://api.ulisses-ebooks.de/api/vBeta/products/99');
assert(avesmapsCitymapUlissesApiUrl('https://www.ulisses-ebooks.de/de/product/120516') === 'https://api.ulisses-ebooks.de/api/vBeta/products/120516');
// Everything else takes the og:image route -- '' is "not my case", not an error.
assert(avesmapsCitymapUlissesApiUrl('https://www.f-shop.de/gareth') === '');
assert(avesmapsCitymapUlissesApiUrl('https://de.wiki-aventurica.de/wiki/Gareth') === '');
assert(avesmapsCitymapUlissesApiUrl('') === '');
// A lookalike domain must NOT trigger the rewrite -- otherwise an attacker-owned host gets our request
// redirected onto a URL they chose the shape of.
assert(avesmapsCitymapUlissesApiUrl('https://ulisses-ebooks.de.evil.example/de/product/1/x') === '');
assert(avesmapsCitymapUlissesApiUrl('https://evil-ulisses-ebooks.de/de/product/1/x') === '');

// BOTH real shapes, copied from the live answer for product 120516 on 2026-07-16. The API
// content-negotiates and the choice is made by a header set in citymap-image.php, far from this
// function:
//   Accept: application/json  -> FLAT      <- what our endpoint actually sends, so this is the live case
//   no Accept header          -> ENVELOPE  <- what a bare curl gets
// The first shipped version handled only the envelope and answered "kein Titelbild" for every map,
// because the fixture here had been copied from a bare curl while the endpoint sent the JSON header.
// Both shapes are asserted so that mistake cannot repeat in either direction.
$apiFlat = '{"image":"3444\/120516.jpg","webImage":"3444\/120516.webp",'
    . '"thumbnail":"3444\/120516-thumb140.jpg","thumbnail200":"3444\/120516-thumb200.webp","price":4.0}';
$apiEnvelope = '{"data":{"id":"\/api\/vBeta\/products\/120516","type":"Product","attributes":'
    . '{"image":"3444\/120516.jpg","webImage":"3444\/120516.webp",'
    . '"thumbnail":"3444\/120516-thumb140.jpg","thumbnail200":"3444\/120516-thumb200.webp"}}}';
// The FULL image wins: our own downscaler makes a better 400px thumb than the shop's 200px one.
assert(avesmapsCitymapPickUlissesImage($apiFlat) === 'https://www.ulisses-ebooks.de/images/3444/120516.jpg', 'FLAT shape (what the endpoint gets)');
assert(avesmapsCitymapPickUlissesImage($apiEnvelope) === 'https://www.ulisses-ebooks.de/images/3444/120516.jpg', 'ENVELOPE shape');
// Fallback chain when the fuller fields are missing -- in both shapes.
assert(avesmapsCitymapPickUlissesImage('{"thumbnail200":"3444\/x.webp"}') === 'https://www.ulisses-ebooks.de/images/3444/x.webp');
assert(avesmapsCitymapPickUlissesImage('{"data":{"attributes":{"thumbnail200":"3444\/x.webp"}}}')
    === 'https://www.ulisses-ebooks.de/images/3444/x.webp');
assert(avesmapsCitymapPickUlissesImage('{"image":"","webImage":"3444\/w.webp"}')
    === 'https://www.ulisses-ebooks.de/images/3444/w.webp');
// No cover / wrong shape / not JSON -> '' (the caller says "bitte eins hochladen"), never a guess.
assert(avesmapsCitymapPickUlissesImage('{"data":{"attributes":{}}}') === '');
assert(avesmapsCitymapPickUlissesImage('{"price":4.0,"sku":"DSK102"}') === '', 'a product without any image field');
assert(avesmapsCitymapPickUlissesImage('{"data":{}}') === '');
assert(avesmapsCitymapPickUlissesImage('not json at all') === '');
assert(avesmapsCitymapPickUlissesImage('') === '');
assert(avesmapsCitymapPickUlissesImage('[1,2,3]') === '');
// The API returns bare "<publisher>/<file>" paths. Anything else is not its shape and must not be
// improvised around -- a traversal or an absolute URL here would be someone rewriting where we fetch.
// Checked on the FLAT shape too: that is the one the endpoint actually parses.
foreach (['../../etc/passwd', 'https://evil.example/x.jpg', '/absolute/x.jpg', 'javascript:alert(1)', '//evil.example/x.jpg'] as $bad) {
    assert(avesmapsCitymapPickUlissesImage(json_encode(['image' => $bad])) === '', 'flat, refused: ' . $bad);
    assert(avesmapsCitymapPickUlissesImage(json_encode(['data' => ['attributes' => ['image' => $bad]]])) === '', 'envelope, refused: ' . $bad);
}
// A hostile first field falls through to the next usable one rather than giving up.
assert(avesmapsCitymapPickUlissesImage('{"image":"../x","webImage":"3444\/ok.webp"}')
    === 'https://www.ulisses-ebooks.de/images/3444/ok.webp');
echo "ulisses detour ok\n";

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

// ---- the WIKI route (2026-07-17) --------------------------------------------------------------------
// 364 of 365 map links point at de.wiki-aventurica.de. Reading their og:image would be an HTML CRAWL, and
// the operator asked us not to ("prefer the dump, API ok, NO HTML crawls"). These functions are the API
// route that replaces it. All pure: no DB, no HTTP.

// The title falls out of the URL -- live-measured 2026-07-17, the form is always /wiki/<title>, no query,
// no fragment. That is why the wiki route needs no page fetch at all.
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Land%20des%20schwarzen%20B%C3%A4ren') === 'Land des schwarzen Bären');
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Gareth') === 'Gareth');
// MediaWiki treats '_' and ' ' as the same character in a title; the API answers in spaces.
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Herz_des_Reiches') === 'Herz des Reiches');
// Quotes in a title are real: Kommando "Olachtai".
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Kommando%20%22Olachtai%22') === 'Kommando "Olachtai"');
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/F%C3%BCrsten%2C%20H%C3%A4ndler%2C%20Intriganten') === 'Fürsten, Händler, Intriganten');
// A fragment is not part of the title (does not occur today, but it would be a silent miss).
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/Gareth#Karten') === 'Gareth');
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/wiki/') === '');
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de/de/api.php?x=1') === '');
assert(avesmapsCitymapWikiPageTitle('https://example.org/wiki/Gareth') === '');
// A lookalike domain must NOT reach the wiki route -- its answer is trusted enough to be published.
assert(avesmapsCitymapWikiPageTitle('https://de.wiki-aventurica.de.evil.tld/wiki/Gareth') === '');
assert(avesmapsCitymapWikiPageTitle('') === '');

// The route is a property of the SOURCE, not a flag: wiki + ulisses yield a publisher cover by
// construction and go public; an arbitrary og:image does not.
assert(avesmapsCitymapAutogetRoute('https://de.wiki-aventurica.de/wiki/Gareth') === 'wiki');
assert(avesmapsCitymapAutogetRoute('https://www.ulisses-ebooks.de/de/product/120516/gareth-karte-pdf-als-download-kaufen') === 'ulisses');
assert(avesmapsCitymapAutogetRoute('https://maps.aventuria.ru/gareth.png') === 'ogimage');
assert(avesmapsCitymapAutogetRoute('https://de.wiki-aventurica.de.evil.tld/wiki/Gareth') === 'ogimage');
assert(avesmapsCitymapAutogetRoute('') === 'ogimage');

// The batch call: 50 titles in one request is what makes 133 sources cost ~6 requests.
$wikiApi = avesmapsCitymapWikiApiUrl(['Gareth', 'Land des schwarzen Bären']);
assert(str_starts_with($wikiApi, 'https://de.wiki-aventurica.de/de/api.php?'), 'must be /de/api.php -- plain /api.php is a 404 on this wiki');
assert(str_contains($wikiApi, 'prop=pageimages'));
assert(str_contains($wikiApi, 'pithumbsize=400'));
assert(str_contains($wikiApi, 'redirects=1'), 'without redirects=1 the API does not resolve a redirected map_url');
assert(str_contains($wikiApi, 'format=json'));
assert(str_contains($wikiApi, rawurlencode('Gareth|Land des schwarzen Bären')), 'titles are pipe-separated');
assert(avesmapsCitymapWikiApiUrl([]) === '');
$fifty = [];
for ($i = 0; $i < 50; $i++) {
    $fifty[] = 'T' . $i;
}
assert(avesmapsCitymapWikiApiUrl($fifty) !== '', '50 is the limit for ordinary users and must pass');
$tooMany = $fifty;
$tooMany[] = 'T50';
$threwOnBatch = false;
try {
    avesmapsCitymapWikiApiUrl($tooMany);
} catch (InvalidArgumentException $e) {
    $threwOnBatch = true;
}
assert($threwOnBatch, '51 titles must throw -- a silent slice would drop maps from a run that reports itself complete');

// The parser, against the shape measured live on 2026-07-17 (4 titles in ONE answer).
$wikiJson = json_encode(['query' => ['pages' => [
    '12450' => ['pageid' => 12450, 'title' => 'Herz des Reiches', 'pageimage' => 'RSH.jpg',
        'thumbnail' => ['source' => 'https://de.wiki-aventurica.de/de/images/thumb/5/54/RSH.jpg/400px-RSH.jpg', 'width' => 400, 'height' => 588],
        'original' => ['source' => 'https://de.wiki-aventurica.de/de/images/5/54/RSH.jpg', 'width' => 1181, 'height' => 1736]],
    '1315' => ['pageid' => 1315, 'title' => 'Gareth'],
    '-1' => ['pageid' => -1, 'title' => 'Gibtsnicht'],
]]], JSON_UNESCAPED_UNICODE);
$wikiImages = avesmapsCitymapPickWikiImages($wikiJson);
// The THUMBNAIL, not the original: pithumbsize already asked for our exact edge length, so the original
// would only be bytes we downscale away again.
assert($wikiImages['Herz des Reiches'] === 'https://de.wiki-aventurica.de/de/images/thumb/5/54/RSH.jpg/400px-RSH.jpg');
// A page without a page image is a NORMAL answer, not an error -> simply absent.
assert(!isset($wikiImages['Gareth']));
// pageid -1 = the page does not exist.
assert(!isset($wikiImages['Gibtsnicht']));
assert(count($wikiImages) === 1);

// Only an original, no thumbnail -> better than nothing.
$onlyOriginal = json_encode(['query' => ['pages' => ['5' => ['pageid' => 5, 'title' => 'X',
    'original' => ['source' => 'https://de.wiki-aventurica.de/de/images/5/54/X.jpg']]]]]);
assert(avesmapsCitymapPickWikiImages($onlyOriginal)['X'] === 'https://de.wiki-aventurica.de/de/images/5/54/X.jpg');

// Broken/empty answers are a statement ("nothing"), not a crash.
assert(avesmapsCitymapPickWikiImages('{}') === []);
assert(avesmapsCitymapPickWikiImages('kein json') === []);
assert(avesmapsCitymapPickWikiImages('') === []);
assert(avesmapsCitymapPickWikiImages(json_encode(['query' => ['pages' => []]])) === []);

// The API normalises titles and resolves redirects, so the key coming back need not be the one we sent.
$normalizedJson = json_encode(['query' => [
    'normalized' => [['from' => 'Herz_des_Reiches', 'to' => 'Herz des Reiches']],
    'pages' => ['12450' => ['pageid' => 12450, 'title' => 'Herz des Reiches',
        'thumbnail' => ['source' => 'https://de.wiki-aventurica.de/de/images/t.jpg']]],
]], JSON_UNESCAPED_UNICODE);
assert(avesmapsCitymapPickWikiImages($normalizedJson)['Herz des Reiches'] === 'https://de.wiki-aventurica.de/de/images/t.jpg');

// We asked the WIKI for titles, so the answer does not get to choose which server we talk to next. The
// linkcheck guard would still refuse it; this is the door in front of it.
$foreignHost = json_encode(['query' => ['pages' => ['5' => ['pageid' => 5, 'title' => 'X',
    'thumbnail' => ['source' => 'https://evil.tld/x.jpg']]]]]);
assert(avesmapsCitymapPickWikiImages($foreignHost) === []);
echo "wiki route ok\n";

echo "citymap-autoget ok\n";
