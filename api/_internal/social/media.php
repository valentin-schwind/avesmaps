<?php

declare(strict_types=1);

// The picture pipeline (Entwurf §3.1, §5): bytes in, a JPEG in a ratio Instagram accepts out.
//
// 💣 INSTAGRAM TAKES NO PNG. It is the most common stumbling block and it only surfaces at send time,
// as an API error, long after the editor pressed publish. So everything is converted here, up front,
// and the hub can say BEFORE sending what will get through.
//
// 💣 JPEG HAS NO TRANSPARENCY. A transparent PNG composited without a backdrop comes out BLACK. The
// white fill below is the entire reason the destination canvas is not simply copied onto.
//
// 💣 CROP, NEVER SQUASH. Forcing the ratio by resizing distorts the picture -- and a distorted map is
// precisely the artefact this project exists to get right.
//
// The encode half is pure (bytes in, bytes out) so it can be unit-tested against real GD -- the same
// reason citymap-image-encode.php lives in its own file. Only the reachability probe touches HTTP.

require_once __DIR__ . '/channels.php';

const AVESMAPS_SOCIAL_MEDIA_MAX_BYTES = 12 * 1024 * 1024; // mirrors the citymap upload cap
const AVESMAPS_SOCIAL_MEDIA_TYPES = [
    'image/png' => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
];
// Instagram's window, and therefore everybody's: 4:5 (portrait) to 1.91:1 (landscape).
const AVESMAPS_SOCIAL_MIN_RATIO = 0.8;
const AVESMAPS_SOCIAL_MAX_RATIO = 1.91;
const AVESMAPS_SOCIAL_JPEG_QUALITY = 88;
// No .htaccess belongs in this directory and none may be added: Meta LOADS the picture from its
// public URL, it cannot be attached to the request (Entwurf §5).
const AVESMAPS_SOCIAL_UPLOAD_DIR = '/uploads/social';

/**
 * Convert to JPEG and centre-crop into the allowed ratio window.
 *
 * @return array{bytes: string, ext: string, width: int, height: int, cropped: bool}
 *   Unreadable input yields bytes '' and width 0 -- the caller turns that into a 415. It never
 *   returns the ORIGINAL bytes on failure: storing a PNG under a .jpg name is the very trap above.
 */
function avesmapsSocialEncodeImageBytes(string $bytes): array
{
    $empty = ['bytes' => '', 'ext' => 'jpg', 'width' => 0, 'height' => 0, 'cropped' => false];
    if ($bytes === '' || !function_exists('imagecreatefromstring') || !function_exists('imagejpeg')) {
        return $empty;
    }

    $src = @imagecreatefromstring($bytes);
    if ($src === false) {
        return $empty;
    }

    try {
        $width = imagesx($src);
        $height = imagesy($src);
        if ($width < 1 || $height < 1) {
            return $empty;
        }

        // The crop window. Only ONE dimension ever shrinks: too tall loses top and bottom, too wide
        // loses left and right. Both boundaries are INCLUSIVE -- a picture sitting exactly on 4:5 is
        // allowed, and cropping it by a pixel would be a change nobody asked for.
        $ratio = $width / $height;
        $cropWidth = $width;
        $cropHeight = $height;
        $cropped = false;
        if ($ratio < AVESMAPS_SOCIAL_MIN_RATIO) {
            $cropHeight = (int) round($width / AVESMAPS_SOCIAL_MIN_RATIO);
            $cropped = true;
        } elseif ($ratio > AVESMAPS_SOCIAL_MAX_RATIO) {
            $cropWidth = (int) round($height * AVESMAPS_SOCIAL_MAX_RATIO);
            $cropped = true;
        }
        // Never larger than the source and never zero -- a 1x1 upload must survive, not divide by zero.
        $cropWidth = max(1, min($cropWidth, $width));
        $cropHeight = max(1, min($cropHeight, $height));
        $offsetX = (int) floor(($width - $cropWidth) / 2);
        $offsetY = (int) floor(($height - $cropHeight) / 2);

        $dst = imagecreatetruecolor($cropWidth, $cropHeight);
        if ($dst === false) {
            return $empty;
        }

        try {
            // 💣 THE WHITE BACKDROP. Without it a transparent PNG composites onto black and the editor
            // finds a black square on Instagram -- after it is public.
            $white = imagecolorallocate($dst, 255, 255, 255);
            if ($white === false) {
                return $empty;
            }
            imagefilledrectangle($dst, 0, 0, $cropWidth - 1, $cropHeight - 1, $white);
            // Blending ON, so semi-transparent pixels mix WITH the white below instead of replacing it.
            imagealphablending($dst, true);
            // imagecopy, not imagecopyresampled: same pixel scale, so this is a crop and nothing else.
            if (!imagecopy($dst, $src, 0, 0, $offsetX, $offsetY, $cropWidth, $cropHeight)) {
                return $empty;
            }

            ob_start();
            $ok = imagejpeg($dst, null, AVESMAPS_SOCIAL_JPEG_QUALITY);
            $out = (string) ob_get_clean();
            if (!$ok || $out === '') {
                return $empty;
            }

            return [
                'bytes' => $out,
                'ext' => 'jpg',
                'width' => $cropWidth,
                'height' => $cropHeight,
                'cropped' => $cropped,
            ];
        } finally {
            imagedestroy($dst);
        }
    } finally {
        imagedestroy($src);
    }
}

/**
 * Which channels accept a picture of this size? Drives the hub's "✓ Passt für …" line, which exists
 * so the answer arrives BEFORE publishing instead of as an API error afterwards.
 *
 * @return list<string>
 */
function avesmapsSocialMediaFitsChannels(int $width, int $height): array
{
    // A picture we cannot measure is not judged as fitting. Fails closed: better a channel the editor
    // has to think about than a confident "✓" in front of a rejected post.
    $ratio = ($width > 0 && $height > 0) ? $width / $height : 0.0;

    $fits = [];
    foreach (avesmapsSocialChannelKeys() as $key) {
        // Only Instagram constrains the ratio. Everyone else takes what they are given.
        if ($key === 'instagram'
            && ($ratio < AVESMAPS_SOCIAL_MIN_RATIO || $ratio > AVESMAPS_SOCIAL_MAX_RATIO)) {
            continue;
        }
        $fits[] = $key;
    }

    return $fits;
}

/**
 * Absolute, publicly fetchable URL for a stored path. Meta LOADS the picture from it, so a relative
 * path here is a post without a picture.
 */
function avesmapsSocialAbsoluteUrl(string $path): string
{
    if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
        return $path;
    }
    // A cron or CLI run has no HTTP_HOST; the live host is the only sensible fallback, and it is not
    // a secret. Returning the relative path instead would produce a post the network silently drops.
    $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $base = $host === '' ? 'https://avesmaps.de' : 'https://' . $host;

    return $base . '/' . ltrim($path, '/');
}

/**
 * 💣 LIVE FIRST, THEN POST (Entwurf §5). The same trap as the Discord picture: post before the URL
 * serves 200 and the network caches the failure -- the post then carries an empty picture for good,
 * and re-uploading does not repair it.
 *
 * Fails CLOSED: anything other than a 2xx counts as unreachable. The caller records that as the
 * target's error, so the editor sees WHY nothing went out and can retry that one channel.
 */
function avesmapsSocialMediaIsReachable(string $absoluteUrl): bool
{
    if ($absoluteUrl === '' || !function_exists('curl_init')) {
        return false;
    }
    $handle = curl_init($absoluteUrl);
    if ($handle === false) {
        return false;
    }
    curl_setopt_array($handle, [
        CURLOPT_NOBODY => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        // Short on purpose: this runs inside the publish request on shared hosting, where a hanging
        // probe costs a PHP worker (AGENTS.md §10, the pool incident).
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_RETURNTRANSFER => true,
    ]);
    curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);

    return $status >= 200 && $status < 300;
}
