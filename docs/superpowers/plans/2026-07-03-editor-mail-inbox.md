# Editor Mail Inbox ("Mails") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-editor mailbox (Meldungen → Mails → Empfangen/Gesendet) that reads the real `info@avesmaps.de` IMAP inbox and lets any logged-in editor reply over `info@` without a separate mail client.

**Architecture:** One action-based endpoint `api/edit/mail/mailbox.php` (capability `edit`) backed by two internal libs — `api/_internal/mail/mailer.php` (generalized SMTP send, extracted from `contact.php`) and `api/_internal/mail/imap.php` (IMAP read/mark-seen). Replies are recorded in a self-healing `mail_reply` table for the "Gesendet" tab and the "beantwortet" linkage. Frontend: `js/review/review-mail.js` + `css/features/mail-inbox.css`, wired as a `data-review-subtab` sibling.

**Tech Stack:** PHP 8.4 (strict types, PDO, native `imap_*` + `iconv`/`mbstring`), vanilla JS (no build), STRATO shared hosting. Design reference: `docs/superpowers/specs/2026-07-03-editor-mail-inbox-design.md`.

## Global Constraints

- **No unit-test harness in this repo.** Per-task verification = `php -l <file>` (PHP), `node --check <file>` (JS), unauthenticated `curl` (expect `401 unauthenticated` → proves the endpoint exists and auth-gates), and **🔧 owner in-browser checks** while logged in as an editor (authenticated paths cannot be curled without a session cookie). There is no pytest/jest; do not invent one.
- **Commit directly to `master`**, one small verified commit per task; push → ~1–2 min auto-deploy. `docs/` is repo-only (not deployed). Verify remote SHA after pushing.
- **CRLF trap:** `index.html` is CRLF. Use single-line-anchored `Edit`s or a Node string-splice for multi-line inserts; never a multi-line `Edit` against a CRLF file.
- **No build step:** every new JS/CSS file MUST be added to `index.html` as a `<script>`/`<link>` include (load order matters — see task 5/6). Deploy auto-stamps `?v=` on index.html-referenced assets; `index.html` itself stays unstamped.
- **No agent-run production DB migrations.** All schema is created via self-healing `CREATE TABLE IF NOT EXISTS` that runs server-side on first request (pattern: `avesmapsEnsureContactMessagesTable` in `contact.php`). The agent never connects to prod MySQL.
- **STRATO discipline:** IMAP connects once per request, fetches a bounded list, loads bodies on demand. No auto-poll, no looping expensive endpoints. Manual "Aktualisieren" only.
- **Security invariants (from spec):** (1) reply recipient is resolved server-side from the referenced inbox message — never from client input (no open relay); (2) every action requires `avesmapsRequireUserWithCapability('edit')`; (3) mail text is rendered with `textContent`, never `innerHTML`; (4) recipient/subject sanitized to single lines; (5) auth capability is `edit` (roles admin + editor).
- **Language:** internal API `error.message` and code comments in English; editor UI strings in German. The editor panel is German-only + `noindex` — **no i18n/EN keys** for this feature.
- **Config, no secrets in repo:** IMAP defaults to `imap.strato.de:993/imap/ssl`, mailbox `INBOX`, credentials reused from `contact.smtp.{username,password}`. `config.local.php` is gitignored and owner-managed; never commit it.

---

### Task 1: Shared SMTP mailer library (extract + generalize from contact.php)

**Files:**
- Create: `api/_internal/mail/mailer.php`
- Modify: `api/app/contact.php` (delegate its SMTP send to the new lib — behavior-preserving)

**Interfaces:**
- Produces:
  - `avesmapsMailBuildMessage(array $env): string` — builds an RFC-822 text/plain (base64) message. `$env` keys: `from, fromName, to, replyTo, subject, body, headers` (assoc extra headers, e.g. `In-Reply-To`).
  - `avesmapsSendMailViaSmtp(array $smtp, array $env): string` — connects (implicit TLS 465 / STARTTLS 587), authenticates, sends. Returns a short status (`smtp_sent`, `smtp_auth_failed`, …), identical to the existing contact statuses.

- [ ] **Step 1: Create `api/_internal/mail/mailer.php`.** Move the SMTP socket helpers from `contact.php` **verbatim** and rename to the generic API. Concretely, copy the bodies of `avesmapsContactSendViaSmtp`, `avesmapsContactSmtpHeloName`, `avesmapsContactSmtpCommand`, `avesmapsContactSmtpExpect` into this file as `avesmapsSendMailViaSmtp` / `avesmapsMailSmtpHeloName` / `avesmapsMailSmtpCommand` / `avesmapsMailSmtpExpect`, changing only: (a) the signature of the send function to `(array $smtp, array $env)`, (b) the message build call to `avesmapsMailBuildMessage($env)`. Add the generalized builder:

```php
<?php

declare(strict_types=1);

// Shared authenticated-SMTP mailer, extracted from contact.php so the contact
// form and the editor mail-reply endpoint use one transport. Build-free project:
// a minimal SMTP-over-TLS client (no library). Port 465 = implicit TLS; 587 = STARTTLS.

function avesmapsMailBuildMessage(array $env): string {
    $from = (string) ($env['from'] ?? '');
    $fromName = (string) ($env['fromName'] ?? 'Avesmaps');
    $to = (string) ($env['to'] ?? '');
    $replyTo = (string) ($env['replyTo'] ?? '');
    $subject = trim(str_replace(["\r", "\n"], '', (string) ($env['subject'] ?? '')));
    $body = (string) ($env['body'] ?? '');

    $headers = [];
    $headers[] = 'Date: ' . gmdate('r');
    $headers[] = 'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $from . '>';
    $headers[] = 'To: <' . $to . '>';
    if ($replyTo !== '') {
        $headers[] = 'Reply-To: <' . $replyTo . '>';
    }
    $headers[] = 'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=';
    foreach ((array) ($env['headers'] ?? []) as $name => $value) {
        $name = trim(str_replace(["\r", "\n", ':'], '', (string) $name));
        $value = trim(str_replace(["\r", "\n"], '', (string) $value));
        if ($name !== '' && $value !== '') {
            $headers[] = $name . ': ' . $value;
        }
    }
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';
    $headers[] = 'Content-Transfer-Encoding: base64';

    $encodedBody = rtrim(chunk_split(base64_encode($body), 76, "\r\n"), "\r\n");
    return implode("\r\n", $headers) . "\r\n\r\n" . $encodedBody;
}

function avesmapsSendMailViaSmtp(array $smtp, array $env): string {
    $host = trim((string) ($smtp['host'] ?? 'smtp.strato.de'));
    $port = (int) ($smtp['port'] ?? 465);
    $from = (string) ($env['from'] ?? '');
    $username = trim((string) ($smtp['username'] ?? $from));
    $password = (string) ($smtp['password'] ?? '');
    $to = (string) ($env['to'] ?? '');
    if ($host === '' || $port <= 0 || $username === '' || $password === '' || $to === '') {
        return 'smtp_misconfigured';
    }
    // ... paste the socket flow from avesmapsContactSendViaSmtp VERBATIM here,
    //     using avesmapsMailSmtp* helpers and avesmapsMailBuildMessage($env) for DATA,
    //     and MAIL FROM:<$from> / RCPT TO:<$to>. Return the same status strings.
}

// avesmapsMailSmtpHeloName / avesmapsMailSmtpCommand / avesmapsMailSmtpExpect:
// paste verbatim from contact.php's avesmapsContactSmtp* equivalents.
```

- [ ] **Step 2: Refactor `contact.php` to delegate.** `require_once __DIR__ . '/../_internal/mail/mailer.php';` at the top. In `avesmapsNotifyContactRecipient`, replace the `avesmapsContactSendViaSmtp(...)` call with:

```php
return avesmapsSendMailViaSmtp($smtp, [
    'from' => $sender, 'fromName' => $fromName, 'to' => $recipient,
    'replyTo' => $replyTo, 'subject' => $subject, 'body' => $body,
]);
```

Delete the now-unused `avesmapsContactSendViaSmtp`, `avesmapsContactSmtp*`, and `avesmapsContactSmtpBuildMessage` from `contact.php` (they live in the lib now). Leave the `mail()` fallback path untouched.

- [ ] **Step 3: Lint.** Run `php -l api/_internal/mail/mailer.php` and `php -l api/app/contact.php`. Expected: "No syntax errors detected" for both. (If `php` is unavailable locally, this is a 🔧 owner step.)

- [ ] **Step 4: Commit.**

```bash
git add api/_internal/mail/mailer.php api/app/contact.php
git commit -m "refactor(mail): extract shared SMTP mailer from contact.php"
git push origin master
```

- [ ] **Step 5: 🔧 Owner verification (behavior-preserving).** After deploy, send one test message through the public contact form (Hinweise → Kontakt). Confirm it still arrives at `info@` (the refactor must not change contact-mail behavior).

---

### Task 2: IMAP read library

**Files:**
- Create: `api/_internal/mail/imap.php`

**Interfaces:**
- Consumes: `$config` (from `avesmapsLoadApiConfig`).
- Produces:
  - `avesmapsResolveImapConfig(array $config): array` → `['ref','mailbox','sent_mailbox','username','password']`.
  - `avesmapsImapConnect(array $imapCfg)` → IMAP stream or throws `RuntimeException`.
  - `avesmapsImapListRecent($imap, int $limit): array` → rows `{uid,from,fromEmail,subject,date,seen,messageId}` newest-first.
  - `avesmapsImapFetchText($imap, int $uid): string` — UTF-8 plain text (HTML stripped).
  - `avesmapsImapMessageMeta($imap, int $uid): ?array` → `{fromEmail,subject,messageId}`.
  - `avesmapsImapMarkSeen($imap, int $uid): void`.

- [ ] **Step 1: Create `api/_internal/mail/imap.php`** with the code below (complete):

```php
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
```

- [ ] **Step 2: Lint.** `php -l api/_internal/mail/imap.php` → "No syntax errors detected".

- [ ] **Step 3: Commit.**

```bash
git add api/_internal/mail/imap.php
git commit -m "feat(mail): IMAP read library (list, fetch text, mark seen)"
git push origin master
```

---

### Task 3: Mailbox endpoint — read actions + `mail_reply` table

**Files:**
- Create: `api/edit/mail/mailbox.php`

**Interfaces:**
- Consumes: `avesmapsRequireUserWithCapability`, `avesmapsLoadApiConfig`, `avesmapsCreatePdo`, `avesmapsJsonResponse`, `avesmapsErrorResponse`, `avesmapsReadJsonRequest` (bootstrap/auth), and Task 2 IMAP lib.
- Produces (GET `?action=`): `ping` → `{ok,count}`; `inbox` → `{ok,messages:[…,answered,replyId]}`; `message&uid=N` → `{ok,message:{uid,from,fromEmail,subject,date,text,answered,replyId}}`; `sent` → `{ok,sent:[…]}`.

- [ ] **Step 1: Create `api/edit/mail/mailbox.php`:**

```php
<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/mail/imap.php';
require __DIR__ . '/../../_internal/mail/mailer.php';

const AVESMAPS_MAIL_INBOX_LIMIT = 40;

try {
    $user = avesmapsRequireUserWithCapability('edit');
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMailReplyTable($pdo);

    $action = (string) ($_GET['action'] ?? 'inbox');

    if ($action === 'sent') {
        avesmapsJsonResponse(200, ['ok' => true, 'sent' => avesmapsMailListSent($pdo)]);
    }

    if ($action === 'reply') { // handled in Task 4; leave a stub that 405s until then
        avesmapsErrorResponse(405, 'not_implemented', 'Reply is added in a later task.');
    }

    $imapCfg = avesmapsResolveImapConfig($config);
    $imap = avesmapsImapConnect($imapCfg);
    try {
        if ($action === 'ping') {
            avesmapsJsonResponse(200, ['ok' => true, 'count' => imap_num_msg($imap)]);
        }
        if ($action === 'message') {
            $uid = (int) ($_GET['uid'] ?? 0);
            if ($uid <= 0) { avesmapsErrorResponse(400, 'invalid_request', 'uid is required.'); }
            $meta = avesmapsImapMessageMeta($imap, $uid);
            if ($meta === null) { avesmapsErrorResponse(404, 'not_found', 'Message not found.'); }
            $text = avesmapsImapFetchText($imap, $uid);
            avesmapsImapMarkSeen($imap, $uid);
            $reply = avesmapsMailFindReply($pdo, $meta['messageId']);
            avesmapsJsonResponse(200, ['ok' => true, 'message' => [
                'uid' => $uid,
                'fromEmail' => $meta['fromEmail'],
                'subject' => $meta['subject'],
                'text' => $text,
                'answered' => $reply !== null,
                'replyId' => $reply['id'] ?? null,
            ]]);
        }
        // default: inbox list
        $rows = avesmapsImapListRecent($imap, AVESMAPS_MAIL_INBOX_LIMIT);
        $answered = avesmapsMailAnsweredMap($pdo, array_column($rows, 'messageId'));
        foreach ($rows as &$row) {
            $row['answered'] = isset($answered[$row['messageId']]);
            $row['replyId'] = $answered[$row['messageId']] ?? null;
        }
        unset($row);
        avesmapsJsonResponse(200, ['ok' => true, 'messages' => $rows]);
    } finally {
        imap_close($imap);
    }
} catch (RuntimeException $e) {
    // imap_unavailable / imap_not_configured / imap_connect_failed
    avesmapsErrorResponse(502, 'imap_error', 'Mailbox is not reachable: ' . $e->getMessage());
} catch (Throwable $e) {
    avesmapsErrorResponse(500, 'server_error', 'The mailbox request could not be processed.');
}

function avesmapsEnsureMailReplyTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS mail_reply (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            message_id VARCHAR(255) NULL,
            to_email VARCHAR(255) NOT NULL,
            subject VARCHAR(255) NULL,
            body TEXT NOT NULL,
            editor_user VARCHAR(80) NULL,
            delivery_status VARCHAR(40) NULL,
            sent_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (id),
            KEY idx_mail_reply_message (message_id),
            KEY idx_mail_reply_sent (sent_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsMailAnsweredMap(PDO $pdo, array $messageIds): array {
    $ids = array_values(array_unique(array_filter($messageIds, static fn($v) => (string) $v !== '')));
    if ($ids === []) { return []; }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT message_id, MAX(id) AS rid FROM mail_reply WHERE message_id IN ($placeholders) GROUP BY message_id");
    $stmt->execute($ids);
    $map = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) { $map[(string) $r['message_id']] = (int) $r['rid']; }
    return $map;
}

function avesmapsMailFindReply(PDO $pdo, string $messageId): ?array {
    if (trim($messageId) === '') { return null; }
    $stmt = $pdo->prepare('SELECT id, to_email, subject, body, sent_at FROM mail_reply WHERE message_id = :m ORDER BY id DESC LIMIT 1');
    $stmt->execute(['m' => $messageId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : $row;
}

function avesmapsMailListSent(PDO $pdo, int $limit = 50): array {
    $stmt = $pdo->query('SELECT id, message_id, to_email, subject, body, editor_user, delivery_status, sent_at FROM mail_reply ORDER BY id DESC LIMIT ' . (int) $limit);
    return $stmt === false ? [] : $stmt->fetchAll(PDO::FETCH_ASSOC);
}
```

- [ ] **Step 2: Lint.** `php -l api/edit/mail/mailbox.php` → clean.

- [ ] **Step 3: Confirm auth-gating (automated).** After deploy, unauthenticated:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://avesmaps.de/api/edit/mail/mailbox.php?action=ping"
```

Expected: `401` (not 200, not 500) — proves the file deployed and requires login.

- [ ] **Step 4: Commit.**

```bash
git add api/edit/mail/mailbox.php
git commit -m "feat(mail): mailbox read endpoint (ping/inbox/message/sent) + mail_reply table"
git push origin master
```

- [ ] **Step 5: 🔧 Owner verification — the IMAP smoke test (make-or-break).** Logged in as an editor, open in the browser:
  `https://avesmaps.de/api/edit/mail/mailbox.php?action=ping` → expect `{"ok":true,"count":<n>}`.
  Then `?action=inbox` → expect a JSON list of recent mails.
  **If `ping` returns `imap_error`**, the IMAP host/credentials need adjustment in `config.local.php` (`contact.imap.*`) before continuing — stop and resolve here (this is exactly why ping comes before the UI).

---

### Task 4: Mailbox endpoint — reply action

**Files:**
- Modify: `api/edit/mail/mailbox.php`

**Interfaces:**
- Produces (POST `?action=reply`, JSON body `{uid:int, message:string}`) → `{ok:true, replyId, deliveryStatus}`. Recipient/subject/Message-ID are resolved server-side from `uid`; the client never supplies an address.

- [ ] **Step 1: Replace the `reply` stub** in `mailbox.php` with the real handler. It must run inside the connected-IMAP block (so it can read the referenced message). Move the `if ($action === 'reply')` check to after `$imap = avesmapsImapConnect(...)` and implement:

```php
if ($action === 'reply') {
    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Reply requires POST.');
    }
    $payload = avesmapsReadJsonRequest();
    $uid = (int) ($payload['uid'] ?? 0);
    $bodyText = trim((string) ($payload['message'] ?? ''));
    if ($uid <= 0 || $bodyText === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'uid and a non-empty message are required.');
    }
    $meta = avesmapsImapMessageMeta($imap, $uid);
    if ($meta === null || $meta['fromEmail'] === '') {
        avesmapsErrorResponse(422, 'no_recipient', 'The referenced message has no usable sender address.');
    }

    $sender = trim((string) ($config['contact']['sender'] ?? $imapCfg['username']));
    $subject = avesmapsMailReplySubject($meta['subject']);
    $env = [
        'from' => $sender, 'fromName' => 'Avesmaps', 'to' => $meta['fromEmail'],
        'replyTo' => $sender, 'subject' => $subject, 'body' => $bodyText,
        'headers' => array_filter([
            'In-Reply-To' => $meta['messageId'] !== '' ? $meta['messageId'] : null,
            'References' => $meta['messageId'] !== '' ? $meta['messageId'] : null,
        ]),
    ];
    $deliveryStatus = avesmapsSendMailViaSmtp((array) ($config['contact']['smtp'] ?? []), $env);

    $insert = $pdo->prepare(
        'INSERT INTO mail_reply (message_id, to_email, subject, body, editor_user, delivery_status)
         VALUES (:m, :to, :subj, :body, :editor, :status)'
    );
    $insert->execute([
        'm' => $meta['messageId'], 'to' => $meta['fromEmail'], 'subj' => $subject,
        'body' => $bodyText, 'editor' => (string) ($user['username'] ?? ''),
        'status' => mb_substr($deliveryStatus, 0, 40),
    ]);
    $replyId = (int) $pdo->lastInsertId();

    // Best-effort: drop a copy into the Sent folder so a real mail client sees it too.
    @imap_append($imap, $imapCfg['ref'] . $imapCfg['sent_mailbox'], avesmapsMailBuildMessage($env), "\\Seen");

    $ok = str_starts_with($deliveryStatus, 'smtp_sent') || $deliveryStatus === 'mail_sent';
    avesmapsJsonResponse($ok ? 200 : 502, [
        'ok' => $ok,
        'replyId' => $replyId,
        'deliveryStatus' => $deliveryStatus,
    ]);
}
```

Add the helper (near the other functions):

```php
function avesmapsMailReplySubject(string $subject): string {
    $subject = trim(str_replace(["\r", "\n"], '', $subject));
    if ($subject === '') { return 'Re: (kein Betreff)'; }
    return preg_match('/^\s*re:/i', $subject) === 1 ? $subject : 'Re: ' . $subject;
}
```

- [ ] **Step 2: Lint.** `php -l api/edit/mail/mailbox.php` → clean.

- [ ] **Step 3: Confirm auth-gating (automated).** Unauthenticated POST must 401:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"uid":1,"message":"x"}' "https://avesmaps.de/api/edit/mail/mailbox.php?action=reply"
```

Expected: `401`.

- [ ] **Step 4: Commit.**

```bash
git add api/edit/mail/mailbox.php
git commit -m "feat(mail): reply action (server-resolved recipient, SMTP send, mail_reply record)"
git push origin master
```

- [ ] **Step 5: 🔧 Owner verification.** After the frontend exists (Task 6), reply to a test mail and confirm it arrives + a `mail_reply` row is written (phpMyAdmin) + "beantwortet" appears.

---

### Task 5: Frontend — "Mails" sub-tab structure + CSS

**Files:**
- Modify: `index.html` (add the Mails sub-tab button + section; add CSS/JS includes)
- Create: `css/features/mail-inbox.css`

**Interfaces:**
- Produces DOM hooks consumed by Task 6: sub-tab button `[data-review-subtab="mails"]`, section `[data-review-subtab-section="mails"]`, inner tab buttons `[data-mail-tab="empfangen"|"gesendet"]`, containers `#mail-inbox-list`, `#mail-inbox-detail`, `#mail-sent-list`, refresh button `#mail-refresh`.

- [ ] **Step 1: Add the "Mails" sub-tab button.** In `index.html`, the Meldungen sub-tab row is:

```html
<nav class="wiki-sync-panel__tabs" aria-label="Meldungen-Bereiche">
    <button class="wiki-sync-panel__tab is-active" type="button" data-review-subtab="reports">Community Meldungen</button>
    <button class="wiki-sync-panel__tab" type="button" data-review-subtab="ratings">Bewertungen</button>
</nav>
```

Add a third button after "Bewertungen" (single-line `Edit`, CRLF-safe):

```html
<button class="wiki-sync-panel__tab" type="button" data-review-subtab="mails">Mails</button>
```

- [ ] **Step 2: Add the Mails section.** After the `data-review-subtab-section="ratings"` closing `</div>`, insert a new section (use a Node splice — multi-line insert into a CRLF file):

```html
<div class="wiki-sync-panel__tab-panel" data-review-subtab-section="mails">
    <nav class="mail-inbox__tabs" aria-label="Mail-Bereiche">
        <button class="status-subtab is-active" type="button" data-mail-tab="empfangen">Empfangen</button>
        <button class="status-subtab" type="button" data-mail-tab="gesendet">Gesendet</button>
        <button id="mail-refresh" class="mail-inbox__refresh" type="button" title="Aktualisieren" aria-label="Aktualisieren">↻</button>
    </nav>
    <div class="mail-inbox__pane is-active" data-mail-pane="empfangen">
        <div id="mail-inbox-list" class="mail-inbox__list" aria-live="polite"></div>
        <div id="mail-inbox-detail" class="mail-inbox__detail" hidden></div>
    </div>
    <div class="mail-inbox__pane" data-mail-pane="gesendet">
        <div id="mail-sent-list" class="mail-inbox__list" aria-live="polite"></div>
    </div>
</div>
```

- [ ] **Step 3: Create `css/features/mail-inbox.css`** (reuse the panel's existing palette; keep it minimal):

```css
.mail-inbox__tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; border-bottom: 1px solid #e7d8c6; padding: 4px 12px 0; }
.mail-inbox__refresh { margin-left: auto; border: 0; background: none; color: #8a7355; cursor: pointer; font-size: 16px; line-height: 1; padding: 4px; appearance: none; -webkit-appearance: none; }
.mail-inbox__refresh:hover { color: #5a4a3a; }
.mail-inbox__pane { display: none; padding: 8px 12px 12px; }
.mail-inbox__pane.is-active { display: block; }
.mail-inbox__list { display: flex; flex-direction: column; gap: 6px; }
.mail-inbox__item { text-align: left; border: 1px solid #e7d8c6; border-radius: 8px; background: #fbf6ee; padding: 8px 10px; cursor: pointer; appearance: none; -webkit-appearance: none; font: inherit; }
.mail-inbox__item:hover { border-color: #cbb79c; }
.mail-inbox__item.is-unread .mail-inbox__from { font-weight: 700; }
.mail-inbox__from { color: #5a4a3a; }
.mail-inbox__subject { color: #6b5a46; }
.mail-inbox__meta { color: #8a7355; font-size: 12px; }
.mail-inbox__badge { display: inline-block; margin-left: 6px; font-size: 11px; color: #1baf7a; }
.mail-inbox__detail { margin-top: 10px; border-top: 1px solid #e7d8c6; padding-top: 10px; }
.mail-inbox__body { white-space: pre-wrap; word-break: break-word; color: #4a3f33; }
.mail-inbox__reply { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.mail-inbox__reply textarea { width: 100%; min-height: 90px; font: inherit; padding: 8px; border: 1px solid #cbb79c; border-radius: 8px; resize: vertical; }
.mail-inbox__reply-actions { display: flex; gap: 8px; align-items: center; }
.mail-inbox__status { color: #8a7355; font-size: 12px; }
```

- [ ] **Step 4: Add includes to `index.html`.** Add the CSS `<link>` next to the other `css/features/*.css` links, and the JS `<script src="js/review/review-mail.js"></script>` **after** `js/app/bootstrap.js` and the other `js/review/*` scripts (it depends on the DOM + the `data-review-subtab` handler in bootstrap.js). Both are single-line `Edit`s.

- [ ] **Step 5: Verify structure.** After deploy, load `/edit/` logged in; the "Mails" sub-tab appears next to Bewertungen and switches (empty panes are fine — behavior comes in Task 6). No console errors.

- [ ] **Step 6: Commit.**

```bash
git add index.html css/features/mail-inbox.css
git commit -m "feat(mail): Mails sub-tab structure + styles"
git push origin master
```

---

### Task 6: Frontend — mailbox behavior (`review-mail.js`)

**Files:**
- Create: `js/review/review-mail.js`

**Interfaces:**
- Consumes the DOM hooks from Task 5 and the endpoint from Tasks 3–4.

- [ ] **Step 1: Create `js/review/review-mail.js`** (complete; renders text with `textContent`, never `innerHTML` for mail content):

```js
(function () {
    "use strict";
    const API = "/api/edit/mail/mailbox.php";
    const listEl = () => document.getElementById("mail-inbox-list");
    const detailEl = () => document.getElementById("mail-inbox-detail");
    const sentEl = () => document.getElementById("mail-sent-list");
    let inboxLoaded = false;
    let sentLoaded = false;

    function api(action, opts) {
        const url = API + "?action=" + encodeURIComponent(action);
        return fetch(url, Object.assign({ credentials: "same-origin" }, opts || {})).then((r) => r.json());
    }

    function fmtDate(s) { const d = new Date(s); return isNaN(d) ? (s || "") : d.toLocaleString("de-DE"); }

    function renderInbox(messages) {
        const el = listEl(); if (!el) return;
        el.textContent = "";
        if (!messages || !messages.length) { el.textContent = "Keine Nachrichten."; return; }
        messages.forEach((m) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "mail-inbox__item" + (m.seen ? "" : " is-unread");
            const from = document.createElement("div"); from.className = "mail-inbox__from"; from.textContent = m.from || m.fromEmail || "(unbekannt)";
            const subj = document.createElement("div"); subj.className = "mail-inbox__subject"; subj.textContent = m.subject || "(kein Betreff)";
            const meta = document.createElement("div"); meta.className = "mail-inbox__meta"; meta.textContent = fmtDate(m.date);
            if (m.answered) { const b = document.createElement("span"); b.className = "mail-inbox__badge"; b.textContent = "✓ beantwortet"; meta.appendChild(b); }
            item.append(from, subj, meta);
            item.addEventListener("click", () => openMessage(m));
            el.appendChild(item);
        });
    }

    function openMessage(m) {
        const el = detailEl(); if (!el) return;
        el.hidden = false; el.textContent = "Lade …";
        api("message&uid=" + encodeURIComponent(m.uid)).then((res) => {
            if (!res || !res.ok) { el.textContent = "Konnte Nachricht nicht laden."; return; }
            renderDetail(res.message);
        }).catch(() => { el.textContent = "Fehler beim Laden."; });
    }

    function renderDetail(msg) {
        const el = detailEl(); if (!el) return;
        el.textContent = "";
        const head = document.createElement("div"); head.className = "mail-inbox__meta";
        head.textContent = (msg.fromEmail || "") + " · " + (msg.subject || "(kein Betreff)");
        const body = document.createElement("div"); body.className = "mail-inbox__body"; body.textContent = msg.text || "(kein Textinhalt)";
        el.append(head, body);

        if (!msg.fromEmail) { const n = document.createElement("div"); n.className = "mail-inbox__status"; n.textContent = "Keine Absenderadresse — Antwort nicht möglich."; el.appendChild(n); return; }

        const wrap = document.createElement("div"); wrap.className = "mail-inbox__reply";
        const ta = document.createElement("textarea"); ta.placeholder = "Antwort an " + msg.fromEmail + " …";
        const actions = document.createElement("div"); actions.className = "mail-inbox__reply-actions";
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "wiki-sync-panel__start"; btn.textContent = "Mail beantworten";
        const status = document.createElement("span"); status.className = "mail-inbox__status";
        if (msg.answered) { status.textContent = "Bereits beantwortet."; }
        actions.append(btn, status); wrap.append(ta, actions); el.appendChild(wrap);

        btn.addEventListener("click", () => {
            const text = ta.value.trim();
            if (!text) { status.textContent = "Bitte Text eingeben."; return; }
            btn.disabled = true; status.textContent = "Sende …";
            api("reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: msg.uid, message: text }) })
                .then((res) => {
                    if (res && res.ok) { status.textContent = "Gesendet ✓"; ta.value = ""; sentLoaded = false; inboxLoaded = false; }
                    else { status.textContent = "Fehler: " + ((res && res.deliveryStatus) || "unbekannt"); btn.disabled = false; }
                })
                .catch(() => { status.textContent = "Netzwerkfehler."; btn.disabled = false; });
        });
    }

    function renderSent(rows) {
        const el = sentEl(); if (!el) return;
        el.textContent = "";
        if (!rows || !rows.length) { el.textContent = "Noch nichts gesendet."; return; }
        rows.forEach((r) => {
            const item = document.createElement("div"); item.className = "mail-inbox__item";
            const to = document.createElement("div"); to.className = "mail-inbox__from"; to.textContent = "An: " + (r.to_email || "");
            const subj = document.createElement("div"); subj.className = "mail-inbox__subject"; subj.textContent = r.subject || "";
            const body = document.createElement("div"); body.className = "mail-inbox__body"; body.textContent = r.body || "";
            const meta = document.createElement("div"); meta.className = "mail-inbox__meta"; meta.textContent = fmtDate(r.sent_at) + " · " + (r.editor_user || "") + " · " + (r.delivery_status || "");
            item.append(to, subj, meta, body); el.appendChild(item);
        });
    }

    function loadInbox(force) {
        if (inboxLoaded && !force) return;
        inboxLoaded = true;
        const el = listEl(); if (el) el.textContent = "Lade …";
        api("inbox").then((res) => { res && res.ok ? renderInbox(res.messages) : (el && (el.textContent = "Mailbox nicht erreichbar.")); })
            .catch(() => { if (el) el.textContent = "Fehler beim Laden."; });
    }
    function loadSent(force) {
        if (sentLoaded && !force) return;
        sentLoaded = true;
        api("sent").then((res) => { if (res && res.ok) renderSent(res.sent); }).catch(() => {});
    }

    function switchMailTab(name) {
        document.querySelectorAll("[data-mail-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.mailTab === name));
        document.querySelectorAll("[data-mail-pane]").forEach((p) => p.classList.toggle("is-active", p.dataset.mailPane === name));
        if (name === "empfangen") loadInbox(false); else loadSent(false);
    }

    document.addEventListener("click", (e) => {
        const tab = e.target.closest("[data-mail-tab]");
        if (tab) { switchMailTab(tab.dataset.mailTab); return; }
        if (e.target.closest("#mail-refresh")) {
            const active = document.querySelector("[data-mail-tab].is-active");
            (active && active.dataset.mailTab === "gesendet") ? loadSent(true) : loadInbox(true);
        }
    });

    // Lazy-load when the Mails sub-tab is opened.
    document.addEventListener("click", (e) => {
        const sub = e.target.closest('[data-review-subtab="mails"]');
        if (sub) loadInbox(false);
    });
})();
```

- [ ] **Step 2: Verify.** `node --check js/review/review-mail.js` → OK.

- [ ] **Step 3: Commit.**

```bash
git add js/review/review-mail.js
git commit -m "feat(mail): mailbox UI behavior (inbox, message view, reply, sent)"
git push origin master
```

- [ ] **Step 4: 🔧 Owner end-to-end verification.** Logged in as editor: open Meldungen → Mails → Empfangen → a mail loads; open it (marks read); type a reply → "Mail beantworten" → "Gesendet ✓"; the reply arrives at the test address; Gesendet tab lists it; reopening the mail shows "beantwortet". Confirm a `mail_reply` row exists (phpMyAdmin).

---

## Notes for the executor

- **Model/effort:** Tasks 1–2 and 5–6 are mechanical transcription (cheap model fine). Tasks 3–4 (endpoint + IMAP/SMTP wiring, security invariants) warrant a standard/capable model and careful review.
- **Do not go live blind:** Task 3 Step 5 (the IMAP `ping`) is the gate — if the mailbox is unreachable there, fix `config.local.php` (`contact.imap.*`) before building/using the UI. Everything downstream assumes `ping` is green.
- **`config.local.php` is owner-managed.** In the common case no config change is needed (IMAP reuses the SMTP credentials). If STRATO's cert or folder names differ, the owner sets `contact.imap.{novalidate,sent_mailbox}` — flag this to them rather than committing anything.
