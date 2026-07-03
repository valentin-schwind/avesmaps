# Editor Mail Inbox ("Mails") — Design

**Date:** 2026-07-03
**Status:** Approved (design), ready for implementation plan.

## Purpose

Some editors do not want to set up the shared `info@avesmaps.de` postbox in
their own mail client, yet contact-form messages (and people's replies) land
there. Give editors a **minimal in-editor mailbox**: read the real `info@`
inbox and reply from the UI over `info@`, without a separate mail program.

Placement: editor panel → **Meldungen** tab → new sub-tab **Mails**, with two
inner tabs **Empfangen** (received) and **Gesendet** (sent).

## Confirmed decisions

| Decision | Choice |
|---|---|
| Receive scope | **Real `info@` mailbox via IMAP** (all mail, incl. replies) |
| HTML mails | **Text-first**: show the `text/plain` part; HTML-only mails are stripped to text server-side |
| Mailbox writes | **Read + reply + mark-as-read** (set IMAP `\Seen` on open). No delete/archive. |
| Access | **All logged-in editors** → capability `edit` (roles admin + editor) |

## Feasibility (verified 2026-07-03)

STRATO PHP 8.4.22 has `imap` extension **enabled** (`imap_open` present),
plus `openssl`, `mbstring`, `iconv` → native IMAP + MIME/charset handling is
available. No self-built IMAP parser needed.

## Architecture

Single action-based endpoint `api/edit/mail/mailbox.php` (capability `edit`,
JSON envelope `{ok:true,…}` / `{ok:false,error:{code,message}}`), backed by two
internal libs:

- `api/_internal/mail/mailer.php` — generalized authenticated SMTP send,
  **extracted** from the existing `contact.php` SMTP client (behavior-preserving)
  so contact form and reply endpoint share one transport.
- `api/_internal/mail/imap.php` — IMAP read helpers: config resolution, connect,
  list recent headers, fetch one message as UTF-8 text, mark `\Seen`.

Actions:
- `ping` — connect + return message count (connectivity self-test; no content).
- `inbox` — last ~40 INBOX headers `{uid, from, fromEmail, subject, date, seen, messageId, answered, replyId}`.
- `message` — one message text by uid, sets `\Seen`, returns `{…, answered, replyId}`.
- `sent` — recent `mail_reply` rows.
- `reply` (POST) — reply to a referenced inbox message (see security).

Frontend: `js/review/review-mail.js` + `css/features/mail-inbox.css`, wired as a
`data-review-subtab` sibling ("Mails") with inner Empfangen/Gesendet tabs.
Message text is inserted via `textContent` (never `innerHTML`).

## Data model

New table (self-healing `CREATE TABLE IF NOT EXISTS`, like `contact_message`):

```
mail_reply (
  id BIGINT UNSIGNED AUTO_INCREMENT PK,
  message_id   VARCHAR(255) NULL,     -- Message-ID of the mail replied to (linkage)
  to_email     VARCHAR(255) NOT NULL, -- resolved server-side from that mail
  subject      VARCHAR(255) NULL,
  body         TEXT NOT NULL,
  editor_user  VARCHAR(80)  NULL,     -- who sent it
  delivery_status VARCHAR(40) NULL,   -- smtp_sent / smtp_* (reuse mailer status)
  sent_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_mail_reply_message (message_id),
  KEY idx_mail_reply_sent (sent_at)
)
```

"beantwortet" badge + link = existence of a `mail_reply` row whose `message_id`
matches the inbox mail's `Message-ID`.

## Security invariants

1. **No open relay.** The reply recipient is resolved **server-side** from the
   referenced inbox message's `From` (client sends only `uid` + text). An editor
   can never reply to an arbitrary address.
2. **Auth.** Every action requires `avesmapsRequireUserWithCapability('edit')`.
3. **No XSS.** Mail text is delivered as plain text and rendered with
   `textContent`. HTML parts are tag-stripped server-side; nothing is rendered
   as HTML.
4. **Header-injection safe.** Recipient/subject are sanitized to single lines
   (strip CR/LF); body is base64-encoded in DATA (existing SMTP builder).
5. **STRATO discipline.** IMAP connects once per request, fetches a bounded list,
   loads bodies on demand, no auto-poll. Manual "Aktualisieren" button.

## Config (no secrets in repo)

Defaults require **zero** new config: IMAP host defaults to
`imap.strato.de:993/imap/ssl`, mailbox `INBOX`, credentials reused from the
existing `contact.smtp.{username,password}`. Optional overrides:
`contact.imap.{host,port,mailbox,username,password,sent_mailbox,novalidate}`.

## Out of scope (possible phase 2)

Attachments (list filenames only, no download), HTML rendering (sandboxed
iframe), delete/archive, IMAP `\Seen` sync beyond open, multi-folder browsing.
The "Gesendet" tab is DB-backed; IMAP-APPEND of the reply into the Sent folder
is best-effort only (failure never breaks the reply).

## Threading

Outgoing reply sets `In-Reply-To` + `References` = original `Message-ID`, and
`Subject: Re: <original>` (no double "Re:"), `From: info@avesmaps.de`, so it
threads in the recipient's client.
