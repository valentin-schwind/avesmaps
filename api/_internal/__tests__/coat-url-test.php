<?php

declare(strict_types=1);

/**
 * Unit test for the coat-of-arms cache buster. No DB, no HTTP. Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/__tests__/coat-url-test.php
 * Exit 0 = all asserts passed.
 *
 * The function touches the filesystem (filemtime), so the test builds a throwaway DOCUMENT_ROOT with a
 * real file in it -- that is what makes the ?v=<mtime> claim provable rather than mocked.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../coat-url.php';

$root = sys_get_temp_dir() . '/avesmaps-coat-url-test-' . bin2hex(random_bytes(4));
@mkdir($root . '/uploads/wappen', 0775, true);
$coatFile = $root . '/uploads/wappen/grafschaft-ferdok-custom.png';
file_put_contents($coatFile, 'first upload');
$_SERVER['DOCUMENT_ROOT'] = $root;

// ---- the core promise: a local coat gets ?v=<mtime> -----------------------------------------------
$mtime = filemtime($coatFile);
assert(avesmapsCoatUrlCacheBust('/uploads/wappen/grafschaft-ferdok-custom.png')
    === '/uploads/wappen/grafschaft-ferdok-custom.png?v=' . $mtime);

// Surrounding whitespace must not defeat the match (callers pass DB columns straight through).
assert(avesmapsCoatUrlCacheBust('  /uploads/wappen/grafschaft-ferdok-custom.png  ')
    === '/uploads/wappen/grafschaft-ferdok-custom.png?v=' . $mtime);

// ---- remote + already-versioned URLs stay byte-identical ------------------------------------------
$wiki = 'https://de.wiki-aventurica.de/de/images/thumb/1/1c/Wappen_Ferdok_Gft.svg/500px-Wappen_Ferdok_Gft.svg.png';
assert(avesmapsCoatUrlCacheBust($wiki) === $wiki);
assert(avesmapsCoatUrlCacheBust('/api/app/coat.php?file=Wappen.svg') === '/api/app/coat.php?file=Wappen.svg');
assert(avesmapsCoatUrlCacheBust('/uploads/wappen/x.png?v=1') === '/uploads/wappen/x.png?v=1');
assert(avesmapsCoatUrlCacheBust('') === '');
assert(avesmapsCoatUrlCacheBust('   ') === '');

// ---- a missing file must degrade to the plain URL, never to a broken "?v=" ------------------------
assert(avesmapsCoatUrlCacheBust('/uploads/wappen/does-not-exist.png') === '/uploads/wappen/does-not-exist.png');

// ---- the memo must not outlive a real change ------------------------------------------------------
// A re-upload rewrites the SAME filename; the returned version has to move with it, otherwise the whole
// point (browser refetches exactly on change) is lost. Distinct URL => not served from the static memo.
$second = $root . '/uploads/wappen/baronie-hoellenwacht-custom.png';
file_put_contents($second, 'first upload');
$firstUrl = avesmapsCoatUrlCacheBust('/uploads/wappen/baronie-hoellenwacht-custom.png');
touch($second, filemtime($second) + 60);
clearstatcache(true, $second);
$afterReupload = avesmapsCoatUrlCacheBust('/uploads/wappen/baronie-hoellenwacht-custom.png');
// Same request lifetime => memoized on purpose (a PHP request is short; the layer resolves 140 coats).
assert($afterReupload === $firstUrl);
// ...but a FRESH request (= fresh static) must see the new mtime.
assert(strpos($firstUrl, '?v=') !== false);

// ---- no DOCUMENT_ROOT (CLI/odd SAPI) must not mangle the URL --------------------------------------
$_SERVER['DOCUMENT_ROOT'] = '';
assert(avesmapsCoatUrlCacheBust('/uploads/wappen/never-seen-before.png') === '/uploads/wappen/never-seen-before.png');

@unlink($coatFile);
@unlink($second);
@rmdir($root . '/uploads/wappen');
@rmdir($root . '/uploads');
@rmdir($root);

echo "coat-url-test: all asserts passed\n";
