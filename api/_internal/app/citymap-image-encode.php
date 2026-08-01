<?php

declare(strict_types=1);

// Encoder for the Kartensammlung's PREVIEW picture (slot=thumb): longest edge 400px, always WebP.
// Owner 2026-08-01: "Vorschaubild (slot=thumb) -> soll zu webp 400px".
//
// Its own file rather than a branch inside citymaps.php: it is pure (bytes in, bytes out -- no DB, no
// HTTP), which is the only reason it can be unit-tested against real GD at all. Same motive that moved
// the app_setting store out of adventures.php.
//
// The FULL MAP (slot=map) has deliberately no counterpart here -- it is stored exactly as uploaded
// (owner: "Ganze Karte soll nicht veraendert werden"), because it is the artefact people zoom into and
// re-compressing destroys precisely its purpose. Do not "unify" the two slots.

require_once __DIR__ . '/../wiki/sync-monitor-identity.php'; // avesmapsWikiSyncMonitorDownscaleCoatBytes

const AVESMAPS_CITYMAP_THUMB_WEBP_QUALITY = 82;

/**
 * @return array{bytes: string, ext: string} The bytes to store and the extension they actually are.
 *   The caller MUST name the file after the returned ext -- naming it before calling this is how a
 *   .png ends up holding WebP bytes.
 */
function avesmapsCitymapEncodeThumbBytes(string $bytes, string $ext, int $maxEdge = 400): array
{
    $ext = strtolower($ext);
    $unchanged = ['bytes' => $bytes, 'ext' => $ext];

    // GIF may be animated: re-encoding to WebP here would keep the first frame and silently drop the
    // rest. The Wappen downscaler leaves GIF alone for the same reason.
    if ($bytes === '' || $ext === 'gif') {
        return $unchanged;
    }
    // GD without WebP support (STRATO cannot be measured in advance -- api/diagnostics/ is denied):
    // fall back to today's behaviour, original format bounded at maxEdge. An upload must never fail
    // over the conversion.
    if (!function_exists('imagewebp') || !function_exists('imagecreatefromstring')) {
        return ['bytes' => avesmapsWikiSyncMonitorDownscaleCoatBytes($bytes, $ext, $maxEdge), 'ext' => $ext];
    }

    $src = @imagecreatefromstring($bytes);
    if ($src === false) {
        return $unchanged;
    }
    try {
        $w = imagesx($src);
        $h = imagesy($src);
        if ($w < 1 || $h < 1) {
            return $unchanged;
        }
        // min(1.0, ...) -- never scale UP a small picture; only bound the large ones.
        $scale = min(1.0, $maxEdge / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $dst = imagecreatetruecolor($nw, $nh);
        if ($dst === false) {
            return $unchanged;
        }
        // Take alpha over as-is instead of blending it against black.
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        if (!imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h)) {
            imagedestroy($dst);
            return $unchanged;
        }
        ob_start();
        $ok = imagewebp($dst, null, AVESMAPS_CITYMAP_THUMB_WEBP_QUALITY);
        $out = (string) ob_get_clean();
        imagedestroy($dst);
        // Deliberately NO "keep the original unless the result is smaller" check (unlike the Wappen
        // downscaler): the stored format must not depend on how well a given picture happens to
        // compress. Only a genuinely failed encode falls back.
        if (!$ok || $out === '') {
            return $unchanged;
        }
        return ['bytes' => $out, 'ext' => 'webp'];
    } finally {
        imagedestroy($src);
    }
}
