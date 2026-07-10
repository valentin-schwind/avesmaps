<?php

declare(strict_types=1);

// IMAP read helpers for the editor mailbox. Text-first: we only ever surface a
// UTF-8 plain-text rendering of a message (HTML parts are stripped to text).

function avesmapsResolveImapConfig(array $config): array {
    $imap = (array) ($config['contact']['imap'] ?? []);
    $smtp = (array) ($config['contact']['smtp'] ?? []);
    $host = trim((string) ($imap['host'] ?? 'imap.strato.de'));
    $port = (int) ($imap['port'] ?? 993);
    $flags = '/imap/ssl' . (!empty($imap['novalidate']) ? '/novalidate-cert' : '');
    return [
        'ref' => '{' . $host . ':' . $port . $flags . '}',
        'mailbox' => trim((string) ($imap['mailbox'] ?? 'INBOX')),
        'sent_mailbox' => trim((string) ($imap['sent_mailbox'] ?? 'Sent')),
        'username' => trim((string) ($imap['username'] ?? $smtp['username'] ?? '')),
        'password' => (string) ($imap['password'] ?? $smtp['password'] ?? ''),
    ];
}

function avesmapsImapConnect(array $imapCfg) {
    if (!function_exists('imap_open')) {
        throw new RuntimeException('imap_unavailable');
    }
    if ($imapCfg['username'] === '' || $imapCfg['password'] === '') {
        throw new RuntimeException('imap_not_configured');
    }
    $stream = @imap_open($imapCfg['ref'] . $imapCfg['mailbox'], $imapCfg['username'], $imapCfg['password'], 0, 1);
    if ($stream === false) {
        throw new RuntimeException('imap_connect_failed');
    }
    return $stream;
}

function avesmapsImapDecodeMime(string $value): string {
    $out = '';
    foreach (imap_mime_header_decode($value) as $part) {
        $charset = strtolower((string) $part->charset);
        $text = (string) $part->text;
        if ($charset !== '' && $charset !== 'default' && $charset !== 'utf-8') {
            $conv = @iconv($charset, 'UTF-8//TRANSLIT', $text);
            if ($conv !== false) { $text = $conv; }
        }
        $out .= $text;
    }
    return trim($out);
}

function avesmapsImapExtractEmail(string $from): string {
    if (preg_match('/<([^>]+)>/', $from, $m)) { $from = $m[1]; }
    $from = trim($from);
    return filter_var($from, FILTER_VALIDATE_EMAIL) !== false ? $from : '';
}

function avesmapsImapReplyToEmail($imap, int $uid): string {
    $rawHeader = @imap_fetchheader($imap, $uid, FT_UID);
    if (!is_string($rawHeader) || $rawHeader === '') { return ''; }
    $parsed = @imap_rfc822_parse_headers($rawHeader);
    if (!is_object($parsed) || empty($parsed->reply_to) || !is_array($parsed->reply_to)) { return ''; }
    $addr = $parsed->reply_to[0];
    $mailbox = trim((string) ($addr->mailbox ?? ''));
    $host = trim((string) ($addr->host ?? ''));
    if ($mailbox === '' || $host === '') { return ''; }
    return avesmapsImapExtractEmail($mailbox . '@' . $host);
}

function avesmapsImapListRecent($imap, int $limit): array {
    $limit = max(1, min(100, $limit));
    $total = imap_num_msg($imap);
    if ($total <= 0) { return []; }
    $start = max(1, $total - $limit + 1);
    $overview = imap_fetch_overview($imap, $start . ':' . $total, 0);
    if (!is_array($overview)) { return []; }
    $rows = [];
    foreach (array_reverse($overview) as $o) {
        $from = isset($o->from) ? avesmapsImapDecodeMime((string) $o->from) : '';
        $subject = isset($o->subject) ? avesmapsImapDecodeMime((string) $o->subject) : '';
        $rows[] = [
            'uid' => (int) ($o->uid ?? 0),
            'from' => $from,
            'fromEmail' => avesmapsImapExtractEmail($from),
            'subject' => $subject !== '' ? $subject : '(kein Betreff)',
            'date' => isset($o->date) ? (string) $o->date : '',
            'seen' => !empty($o->seen),
            'messageId' => isset($o->message_id) ? trim((string) $o->message_id) : '',
        ];
    }
    return $rows;
}

function avesmapsImapMessageMeta($imap, int $uid): ?array {
    $ov = imap_fetch_overview($imap, (string) $uid, FT_UID);
    if (!is_array($ov) || !isset($ov[0])) { return null; }
    $o = $ov[0];
    $from = avesmapsImapDecodeMime((string) ($o->from ?? ''));
    return [
        'fromEmail' => avesmapsImapExtractEmail($from),
        'replyToEmail' => avesmapsImapReplyToEmail($imap, $uid),
        'subject' => avesmapsImapDecodeMime((string) ($o->subject ?? '')),
        'messageId' => trim((string) ($o->message_id ?? '')),
    ];
}

function avesmapsImapMarkSeen($imap, int $uid): void {
    @imap_setflag_full($imap, (string) $uid, '\\Seen', ST_UID);
}

function avesmapsImapDecodePart(string $raw, $part): string {
    $encoding = (int) ($part->encoding ?? 0); // 3 = BASE64, 4 = QUOTED-PRINTABLE
    if ($encoding === 3) { $raw = (string) base64_decode($raw, false); }
    elseif ($encoding === 4) { $raw = quoted_printable_decode($raw); }
    $charset = '';
    foreach ((array) ($part->parameters ?? []) as $p) {
        if (strtolower((string) $p->attribute) === 'charset') { $charset = strtolower((string) $p->value); }
    }
    if ($charset !== '' && $charset !== 'utf-8') {
        $conv = @iconv($charset, 'UTF-8//TRANSLIT', $raw);
        if ($conv !== false) { $raw = $conv; }
    }
    return $raw;
}

function avesmapsImapHtmlToText(string $html): string {
    $html = (string) preg_replace('#<(script|style)[^>]*>.*?</\1>#is', '', $html);
    $html = (string) preg_replace('#<br\s*/?>#i', "\n", $html);
    $html = (string) preg_replace('#</p>#i', "\n\n", $html);
    $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = (string) preg_replace("/[ \t]+/", ' ', $text);
    $text = (string) preg_replace("/\n{3,}/", "\n\n", $text);
    return trim($text);
}

function avesmapsImapWalkParts($imap, int $uid, array $parts, string $prefix): string {
    $plain = '';
    $html = '';
    foreach ($parts as $index => $part) {
        $section = ($prefix === '' ? '' : $prefix . '.') . ($index + 1);
        if (!empty($part->parts)) {
            $nested = avesmapsImapWalkParts($imap, $uid, $part->parts, $section);
            if ($nested !== '' && $plain === '') { $plain = $nested; }
            continue;
        }
        if ((int) ($part->type ?? 0) !== 0) { continue; } // 0 = text; skip attachments/others
        $subtype = strtoupper((string) ($part->subtype ?? ''));
        $decoded = avesmapsImapDecodePart(imap_fetchbody($imap, $uid, $section, FT_UID), $part);
        if ($subtype === 'PLAIN' && $plain === '') { $plain = $decoded; }
        elseif ($subtype === 'HTML' && $html === '') { $html = $decoded; }
    }
    if ($plain !== '') { return $plain; }
    if ($html !== '') { return avesmapsImapHtmlToText($html); }
    return '';
}

function avesmapsImapFetchText($imap, int $uid): string {
    $structure = imap_fetchstructure($imap, $uid, FT_UID);
    if ($structure === false) { return ''; }
    if (empty($structure->parts)) {
        $decoded = avesmapsImapDecodePart(imap_fetchbody($imap, $uid, '1', FT_UID), $structure);
        if (strtoupper((string) ($structure->subtype ?? '')) === 'HTML') {
            $decoded = avesmapsImapHtmlToText($decoded);
        }
        return trim($decoded);
    }
    return trim(avesmapsImapWalkParts($imap, $uid, $structure->parts, ''));
}

// --- Inline/attached image support ---------------------------------------------------
// We surface only image parts embedded IN the message (attachments / inline cid: parts),
// served from our own auth-gated endpoint — never remote URLs (those would be tracking
// pixels). Raster types only; SVG is excluded on purpose (an SVG opened directly could
// execute script). The mimetype is always taken from the server-parsed MIME structure.

// Skip inline images larger than this (encoded size) to bound per-request memory on STRATO.
const AVESMAPS_IMAP_IMAGE_MAX_BYTES = 15 * 1024 * 1024;

function avesmapsImapImageSubtypeToMime(string $subtype): string {
    return match (strtoupper(trim($subtype))) {
        'JPEG', 'JPG', 'PJPEG' => 'image/jpeg',
        'PNG' => 'image/png',
        'GIF' => 'image/gif',
        'WEBP' => 'image/webp',
        'BMP' => 'image/bmp',
        default => '',
    };
}

function avesmapsImapPartFilename($part): string {
    $name = '';
    foreach ((array) ($part->dparameters ?? []) as $p) {
        if (strtolower((string) ($p->attribute ?? '')) === 'filename') { $name = (string) ($p->value ?? ''); }
    }
    if ($name === '') {
        foreach ((array) ($part->parameters ?? []) as $p) {
            if (strtolower((string) ($p->attribute ?? '')) === 'name') { $name = (string) ($p->value ?? ''); }
        }
    }
    return $name === '' ? '' : avesmapsImapDecodeMime($name);
}

function avesmapsImapWalkImages($imap, int $uid, array $parts, string $prefix, array &$out): void {
    foreach ($parts as $index => $part) {
        $section = ($prefix === '' ? '' : $prefix . '.') . ($index + 1);
        if (!empty($part->parts)) {
            avesmapsImapWalkImages($imap, $uid, $part->parts, $section, $out);
            continue;
        }
        if ((int) ($part->type ?? 0) !== 5) { continue; } // 5 = image
        $mime = avesmapsImapImageSubtypeToMime((string) ($part->subtype ?? ''));
        if ($mime === '') { continue; } // unsupported / unsafe image subtype
        if ((int) ($part->bytes ?? 0) > AVESMAPS_IMAP_IMAGE_MAX_BYTES) { continue; } // bound memory
        $out[] = [
            'part' => $section,
            'mimetype' => $mime,
            'filename' => avesmapsImapPartFilename($part),
            'encoding' => (int) ($part->encoding ?? 0),
        ];
    }
}

function avesmapsImapCollectImages($imap, int $uid): array {
    $structure = @imap_fetchstructure($imap, $uid, FT_UID);
    if ($structure === false) { return []; }
    $out = [];
    if (!empty($structure->parts)) {
        avesmapsImapWalkImages($imap, $uid, $structure->parts, '', $out);
    } elseif ((int) ($structure->type ?? 0) === 5) {
        $mime = avesmapsImapImageSubtypeToMime((string) ($structure->subtype ?? ''));
        if ($mime !== '' && (int) ($structure->bytes ?? 0) <= AVESMAPS_IMAP_IMAGE_MAX_BYTES) {
            $out[] = ['part' => '1', 'mimetype' => $mime, 'filename' => avesmapsImapPartFilename($structure), 'encoding' => (int) ($structure->encoding ?? 0)];
        }
    }
    return $out;
}

function avesmapsImapFetchImage($imap, int $uid, string $section): ?array {
    // Only serve a section this message actually exposes as a supported image part; the
    // mimetype comes from the server-parsed structure, never from client input.
    foreach (avesmapsImapCollectImages($imap, $uid) as $img) {
        if ($img['part'] === $section) {
            $raw = @imap_fetchbody($imap, $uid, $section, FT_UID);
            if (!is_string($raw) || $raw === '') { return null; }
            if ($img['encoding'] === 3) { $raw = (string) base64_decode($raw, false); }
            elseif ($img['encoding'] === 4) { $raw = quoted_printable_decode($raw); }
            return ['mimetype' => $img['mimetype'], 'bytes' => $raw, 'filename' => $img['filename']];
        }
    }
    return null;
}
