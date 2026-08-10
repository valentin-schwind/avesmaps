<?php

declare(strict_types=1);

/**
 * Unit test for the picture pipeline. Run, from the repo root:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_gd.dll api/_internal/social/__tests__/media-test.php
 *
 * ⚠️ gd is REQUIRED. Without it this file fails with NO error message at all -- exactly like
 * citymap-image-encode-test.php. That is not a bug in the pipeline, it is a missing extension.
 *
 * The three rules worth guarding (Entwurf §3.1, §5):
 *   1. Everything comes out JPEG. Instagram takes no PNG, and it is the strictest channel.
 *   2. A transparent PNG must NOT come out black. JPEG has no alpha; without an explicit white
 *      backdrop GD composites onto black -- and nobody sees it until the post is public.
 *   3. The ratio is forced into 4:5 … 1.91:1 by CENTRE-CROPPING, never by squashing. A squashed map
 *      is precisely the artefact this project exists to get right.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}
if (!function_exists('imagecreatetruecolor')) {
    fwrite(STDERR, "FATAL: gd is missing -- this test would fail without saying why. "
        . "Re-run with -d extension=php_gd.dll\n");
    exit(2);
}

require __DIR__ . '/../channels.php';
require __DIR__ . '/../media.php';

/** A solid PNG of the given size, in the given colour. */
function avesmapsTestMakePng(int $w, int $h, int $r = 200, int $g = 30, int $b = 30): string
{
    $image = imagecreatetruecolor($w, $h);
    imagefill($image, 0, 0, imagecolorallocate($image, $r, $g, $b));
    ob_start();
    imagepng($image);
    $bytes = (string) ob_get_clean();
    imagedestroy($image);

    return $bytes;
}

/** A FULLY TRANSPARENT PNG -- the black-background trap. */
function avesmapsTestMakeTransparentPng(int $w, int $h): string
{
    $image = imagecreatetruecolor($w, $h);
    imagealphablending($image, false);
    imagesavealpha($image, true);
    imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 0, 0, 127));
    ob_start();
    imagepng($image);
    $bytes = (string) ob_get_clean();
    imagedestroy($image);

    return $bytes;
}

// ---- everything becomes JPEG ---------------------------------------------------------------------

$square = avesmapsSocialEncodeImageBytes(avesmapsTestMakePng(600, 600));
assert($square['ext'] === 'jpg', 'a PNG comes out as JPEG -- instagram takes no PNG (Entwurf §3.1)');
assert(str_starts_with($square['bytes'], "\xFF\xD8\xFF"),
    'and the BYTES really are JPEG -- naming a PNG .jpg is the same bug one layer down');
assert($square['width'] === 600 && $square['height'] === 600, '1:1 sits inside 4:5 … 1.91:1, untouched');
assert($square['cropped'] === false, 'nothing was cropped');

// A JPEG in, a JPEG out -- and still re-encoded, so the ratio rule applies to it too.
$alreadyJpeg = avesmapsSocialEncodeImageBytes($square['bytes']);
assert($alreadyJpeg['ext'] === 'jpg' && $alreadyJpeg['width'] === 600, 'a JPEG survives the pipeline');

// ---- 💣 the transparency trap ------------------------------------------------------------------------

$transparent = avesmapsSocialEncodeImageBytes(avesmapsTestMakeTransparentPng(400, 400));
assert($transparent['bytes'] !== '', 'a transparent PNG is convertible');
$check = imagecreatefromstring($transparent['bytes']);
assert($check !== false, 'the flattened image is readable');
$corner = imagecolorat($check, 5, 5);
$red = ($corner >> 16) & 0xFF;
$green = ($corner >> 8) & 0xFF;
$blue = $corner & 0xFF;
$middle = imagecolorat($check, 200, 200);
imagedestroy($check);
// JPEG has no alpha. Without an explicit white backdrop GD composites onto BLACK, and the editor
// finds a black square on Instagram -- visible only once it is public.
assert($red > 240 && $green > 240 && $blue > 240,
    'a transparent PNG lands on WHITE, not on black (corner rgb was ' . $red . ',' . $green . ',' . $blue . ')');
assert(((($middle >> 16) & 0xFF) > 240), 'and white in the middle too, not just at the edge');

// ---- the aspect ratio ---------------------------------------------------------------------------------

// Too tall: 600x1200 = 0.5, below 4:5. The height is cropped, the width is kept.
$tall = avesmapsSocialEncodeImageBytes(avesmapsTestMakePng(600, 1200));
assert($tall['cropped'] === true, 'a 1:2 picture must be cropped');
assert($tall['width'] === 600, 'the WIDTH is kept -- a too-tall picture loses top and bottom');
assert($tall['height'] === 750, '600 / 0.8 = 750, the tallest instagram allows');
assert(abs(($tall['width'] / $tall['height']) - 0.8) < 0.01, 'the result sits exactly on 4:5');

// Too wide: 2000x500 = 4.0, above 1.91.
$wide = avesmapsSocialEncodeImageBytes(avesmapsTestMakePng(2000, 500));
assert($wide['cropped'] === true, 'a 4:1 panorama must be cropped');
assert($wide['height'] === 500, 'the HEIGHT is kept -- a too-wide picture loses left and right');
assert($wide['width'] === 955, '500 * 1.91 = 955');

// 💣 Never squashed. A crop keeps circles round; resizing to the target ratio distorts the map.
// If this were a resize, a 600x1200 input would still be 600x1200 or scaled whole -- the assertions
// above on ONE changed dimension are what pins it.
$portrait = avesmapsSocialEncodeImageBytes(avesmapsTestMakePng(800, 1000));
assert($portrait['cropped'] === false, '4:5 exactly -- the boundary is INCLUSIVE, not one pixel short');
$landscape = avesmapsSocialEncodeImageBytes(avesmapsTestMakePng(1910, 1000));
assert($landscape['cropped'] === false, '1.91:1 exactly is allowed too');

// A single-pixel picture must not divide by zero or land at 0x0.
$tiny = avesmapsSocialEncodeImageBytes(avesmapsTestMakePng(1, 1));
assert($tiny['width'] >= 1 && $tiny['height'] >= 1, 'a 1x1 picture stays at least one pixel');

// ---- which channels a size fits -------------------------------------------------------------------------

$fits = avesmapsSocialMediaFitsChannels(1080, 1350);
assert(in_array('instagram', $fits, true), '4:5 fits instagram');
assert(in_array('facebook', $fits, true) && in_array('mastodon', $fits, true),
    'facebook and mastodon take any ratio');
assert(in_array('probe', $fits, true), 'and the probe takes everything, or it could not rehearse');

$panorama = avesmapsSocialMediaFitsChannels(3000, 500);
assert(!in_array('instagram', $panorama, true), 'a 6:1 panorama does NOT fit instagram');
assert(in_array('facebook', $panorama, true), 'but facebook still takes it');

// A zero height must not divide by zero, and must not report a fit it cannot judge.
$broken = avesmapsSocialMediaFitsChannels(100, 0);
assert(!in_array('instagram', $broken, true), 'an unmeasurable picture never counts as fitting instagram');

// ---- a broken upload -------------------------------------------------------------------------------------

$garbage = avesmapsSocialEncodeImageBytes('this is not a picture');
assert($garbage['bytes'] === '' && $garbage['width'] === 0,
    'unreadable bytes yield an EMPTY result -- the caller turns that into a 415, it never stores rubbish');
assert(avesmapsSocialEncodeImageBytes('')['bytes'] === '', 'no bytes, no picture');

// ---- the absolute url ---------------------------------------------------------------------------------------

$_SERVER['HTTP_HOST'] = 'avesmaps.de';
assert(avesmapsSocialAbsoluteUrl('/uploads/social/x.jpg') === 'https://avesmaps.de/uploads/social/x.jpg',
    'a stored path becomes an absolute https url -- Meta LOADS the picture from it, it cannot be attached');
assert(avesmapsSocialAbsoluteUrl('uploads/social/x.jpg') === 'https://avesmaps.de/uploads/social/x.jpg',
    'with or without the leading slash');
assert(avesmapsSocialAbsoluteUrl('https://example.org/x.jpg') === 'https://example.org/x.jpg',
    'an already absolute url is left alone');
unset($_SERVER['HTTP_HOST']);
assert(avesmapsSocialAbsoluteUrl('/uploads/social/x.jpg') === 'https://avesmaps.de/uploads/social/x.jpg',
    'a cron run has no HTTP_HOST -- the live host is the fallback, never a relative url the network cannot fetch');

fwrite(STDOUT, "media-test: OK\n");
