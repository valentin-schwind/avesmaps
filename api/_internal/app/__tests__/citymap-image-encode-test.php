<?php

declare(strict_types=1);

/**
 * Unit test for the Kartensammlung's preview encoder. No DB, no HTTP -- but REAL GD.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=gd \
 *       api/_internal/app/__tests__/citymap-image-encode-test.php
 * Exit 0 = all asserts passed.
 *
 * GD is NOT loaded by default in this dev PHP -- without `-d extension=gd` every branch below would
 * take the "no WebP support" fallback and the test would prove nothing. Hence the hard guard.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=gd " . __FILE__ . "\n");
    exit(2);
}
$fallbackMode = in_array('--fallback', $argv ?? [], true);
if (!$fallbackMode && (!function_exists('imagewebp') || !function_exists('imagecreatefromstring'))) {
    fwrite(STDERR, "FATAL: GD with WebP is required, otherwise this test only exercises the fallback. "
        . "Re-run with: php -d extension=gd " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../citymap-image-encode.php';

// ---- FALLBACK MODE: run WITHOUT `-d extension=gd` and pass --fallback ---------------------------------
// This is the branch that runs on a server whose GD cannot write WebP -- the one thing about STRATO we
// cannot measure in advance (api/diagnostics/ is .htaccess-denied). The promise being tested is not
// "it converts" but "it never destroys and never throws": the caller gets usable bytes and an extension
// that honestly describes them, so the upload still succeeds.
if ($fallbackMode) {
    if (function_exists('imagewebp')) {
        fwrite(STDERR, "FATAL: --fallback needs GD absent. Re-run WITHOUT -d extension=gd.\n");
        exit(2);
    }
    $fb = avesmapsCitymapEncodeThumbBytes('pretend-png-bytes', 'png');
    assert($fb['ext'] === 'png', 'without WebP the extension must stay truthful');
    assert($fb['bytes'] === 'pretend-png-bytes', 'without GD the original must survive untouched');
    $fbGif = avesmapsCitymapEncodeThumbBytes('gif-bytes', 'gif');
    assert($fbGif['ext'] === 'gif' && $fbGif['bytes'] === 'gif-bytes');
    echo "citymap-image-encode-test [fallback]: OK\n";
    exit(0);
}

/** Build PNG bytes of a given size, with a fully transparent left half. */
function tstPngBytes(int $w, int $h): string
{
    $im = imagecreatetruecolor($w, $h);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagefilledrectangle($im, 0, 0, $w - 1, $h - 1, (int) imagecolorallocate($im, 200, 30, 30));
    imagefilledrectangle($im, 0, 0, (int) ($w / 2), $h - 1, (int) imagecolorallocatealpha($im, 0, 0, 0, 127));
    ob_start();
    imagepng($im);
    $bytes = (string) ob_get_clean();
    imagedestroy($im);
    return $bytes;
}

// ---- a large PNG becomes WebP, bounded at 400 on the longest edge ------------------------------------
$big = tstPngBytes(1000, 500);
$out = avesmapsCitymapEncodeThumbBytes($big, 'png');
assert($out['ext'] === 'webp');
$info = getimagesizefromstring($out['bytes']);
assert(is_array($info));
assert($info[0] === 400 && $info[1] === 200); // aspect ratio preserved
assert(max($info[0], $info[1]) === 400);

// ---- a SMALL picture is still converted -------------------------------------------------------------
// "passendes WebP-Format" is the order, not "only when it pays off". Dimensions stay untouched.
$small = tstPngBytes(120, 60);
$outSmall = avesmapsCitymapEncodeThumbBytes($small, 'png');
assert($outSmall['ext'] === 'webp');
$infoSmall = getimagesizefromstring($outSmall['bytes']);
assert(is_array($infoSmall));
assert($infoSmall[0] === 120 && $infoSmall[1] === 60);

// ---- transparency survives the conversion -----------------------------------------------------------
$re = imagecreatefromstring($out['bytes']);
assert($re !== false);
$corner = imagecolorat($re, 2, 2);  // inside the transparent half
$alpha = ($corner >> 24) & 0x7F;    // 127 = fully transparent
imagedestroy($re);
assert($alpha > 100);

// ---- GIF is passed through UNTOUCHED ----------------------------------------------------------------
// Converting would silently drop every frame but the first.
$gifSrc = imagecreatetruecolor(800, 800);
ob_start();
imagegif($gifSrc);
$gif = (string) ob_get_clean();
imagedestroy($gifSrc);
$outGif = avesmapsCitymapEncodeThumbBytes($gif, 'gif');
assert($outGif['ext'] === 'gif');
assert($outGif['bytes'] === $gif);

// ---- garbage in -> unchanged out, never an exception ------------------------------------------------
$outJunk = avesmapsCitymapEncodeThumbBytes('not an image', 'png');
assert($outJunk['ext'] === 'png');
assert($outJunk['bytes'] === 'not an image');
$outEmpty = avesmapsCitymapEncodeThumbBytes('', 'png');
assert($outEmpty['bytes'] === '');

// ---- REGRESSION GUARDS on the endpoint that consumes all this ---------------------------------------
// The endpoint itself is HTTP + $_FILES + DB and cannot be unit-tested here. What CAN be nailed down is
// the ORDER of its steps -- and order is exactly what breaks silently in both cases below.
$endpoint = (string) file_get_contents(__DIR__ . '/../../../edit/map/citymap-image.php');

// Match the CALL, not the name: the require line mentions the function in a comment and would satisfy
// a looser search from the top of the file, making this guard pass no matter where the call moved.
$posEncode = strpos($endpoint, 'avesmapsCitymapEncodeThumbBytes($rawBytes');
$posName = strpos($endpoint, "\$filename = \$slot . '-'");
assert($posEncode !== false, 'endpoint no longer calls the encoder');
assert($posName !== false, 'filename assignment not found -- update this guard');
assert($posEncode < $posName, 'the filename must be built AFTER the encoder decided the extension');

// The full map must not be downscaled any more (owner 2026-08-01: "soll nicht veraendert werden").
assert(!str_contains($endpoint, 'AVESMAPS_CITYMAP_MAP_MAX_EDGE'), 'the map slot must be stored unchanged');

// The endpoint must refuse a non-free licence BEFORE it writes anything to disk. Owner 2026-08-01:
// "geschuetzte bilder duerfen nicht bei uns landen". Until then the endpoint argued in a comment that
// the read gate was enough and enforced nothing -- the editor merely hid the button, which is not
// enforcement: any client holding capability 'edit' could POST a protected image straight past it.
$posGate = strpos($endpoint, 'license_not_free');
$posWrite = strpos($endpoint, 'file_put_contents($target');
assert($posGate !== false, 'the upload licence gate is gone');
assert($posWrite !== false, 'the file write was renamed -- update this guard');
assert($posGate < $posWrite, 'the licence must be checked BEFORE any bytes reach the disk');

echo "citymap-image-encode-test: OK\n";
