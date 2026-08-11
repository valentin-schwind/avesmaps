<?php

declare(strict_types=1);

/**
 * Unit test for "which folder are sent copies filed into?" -- pure name logic, no IMAP, no DB.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/mail/__tests__/imap-sent-mailbox-test.php
 * Exit 0 = all asserts passed.
 *
 * WHY THIS IS TESTED: the failure it guards was live and silent for five weeks. The reply copy was
 * appended to a hardcoded "Sent" while this mailbox names the folder "Sent Items"; imap_append is
 * best-effort and its error is suppressed, so every reply reported success and no copy ever showed
 * up in the editor's mail client. Nothing in the UI could have revealed it.
 */

if (!ini_get('zend.assertions') || (int) ini_get('zend.assertions') !== 1) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1, otherwise assert() is a no-op and this test proves nothing.\n");
    exit(1);
}

require_once __DIR__ . '/../imap.php';

$REF = '{imap.strato.de:993/imap/ssl}';

// ---------------------------------------------------------------- THE LIVE MAILBOX --------------
// Exactly what this mailbox exposes (STRATO default folders, 2026-08-11).

$live = [$REF . 'INBOX', $REF . 'Sent Items', $REF . 'Trash', $REF . 'Drafts', $REF . 'Spam'];
assert(avesmapsImapResolveSentMailbox($live) === 'Sent Items', 'the real mailbox names it "Sent Items"');
assert(avesmapsImapResolveSentMailbox($live) !== 'Sent', 'and NOT the literal that shipped before');
assert(avesmapsImapResolveTrashMailbox($live) === 'Trash', 'the same listing still resolves the trash folder');

// ---------------------------------------------------------------- NAME VARIANTS -----------------

assert(avesmapsImapResolveSentMailbox([$REF . 'Sent']) === 'Sent', 'the plain English name');
assert(avesmapsImapResolveSentMailbox([$REF . 'Gesendet']) === 'Gesendet', 'the German name');
assert(avesmapsImapResolveSentMailbox([$REF . 'Gesendete Objekte']) === 'Gesendete Objekte', 'the Outlook-German name');
assert(avesmapsImapResolveSentMailbox([$REF . 'SENT ITEMS']) === 'SENT ITEMS', 'case does not matter');
assert(avesmapsImapResolveSentMailbox([$REF . 'INBOX.Sent']) === 'INBOX.Sent', 'namespaced with a dot');
assert(avesmapsImapResolveSentMailbox([$REF . 'INBOX/Sent Items']) === 'INBOX/Sent Items', 'namespaced with a slash');

// ---------------------------------------------------------------- PRECEDENCE --------------------
// A mailbox can carry both (one client created "Sent", another "Sent Items"). IMAP alone cannot
// say which one the server files into, so the ranking decides -- and it is pinned to THIS mailbox.

$both = [$REF . 'Sent', $REF . 'Sent Items'];
assert(avesmapsImapResolveSentMailbox($both) === 'Sent Items', '"Sent Items" wins over "Sent"');
assert(avesmapsImapResolveSentMailbox(array_reverse($both)) === 'Sent Items', 'listing order does not change that');

// The two folder kinds must not bleed into each other.
assert(avesmapsImapResolveSentMailbox([$REF . 'Trash']) === '', 'the trash folder is not a sent folder');
assert(avesmapsImapResolveTrashMailbox([$REF . 'Sent Items']) === '', 'and the sent folder is not a trash folder');

// ---------------------------------------------------------------- NO MATCH ----------------------

assert(avesmapsImapResolveSentMailbox([]) === '', 'an empty listing resolves to nothing');
assert(avesmapsImapResolveSentMailbox([$REF . 'INBOX', $REF . 'Drafts']) === '', 'a listing without one resolves to nothing');
assert(avesmapsImapResolveSentMailbox([$REF . 'Sent Items Archive']) === '', 'a similar name is not a match');

// ---------------------------------------------------------------- CONFIGURED OVERRIDE -----------

assert(avesmapsImapResolveSentMailbox($live, 'INBOX.Verschickt') === 'INBOX.Verschickt', 'a configured name wins');
assert(avesmapsImapResolveSentMailbox($live, '  ') === 'Sent Items', 'a blank setting is no setting');

// ---------------------------------------------------------------- "COULD NOT LOOK" -------------
// The distinction that decides whether a copy is filed at all: an EMPTY listing means imap_list
// gave us nothing (rights, server quirk) -- we did not get to look, so the historical literal is
// kept. A listing that simply contains no sent folder is a real answer and yields '' (skip).

assert(avesmapsImapSentMailboxFrom([]) === 'Sent', 'no listing at all falls back to the old literal');
assert(avesmapsImapSentMailboxFrom([$REF . 'INBOX', $REF . 'Drafts']) === '', 'a listing WITHOUT a sent folder skips the copy');
assert(avesmapsImapSentMailboxFrom($live) === 'Sent Items', 'and a normal listing resolves as usual');
assert(avesmapsImapSentMailboxFrom([], 'INBOX.Verschickt') === 'INBOX.Verschickt', 'a configured name wins even without a listing');

echo "OK: imap sent mailbox resolution\n";
