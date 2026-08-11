<?php

declare(strict_types=1);

/**
 * Unit test for "which folder is the trash?" -- pure name logic, no IMAP, no DB.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/mail/__tests__/imap-trash-mailbox-test.php
 * Exit 0 = all asserts passed.
 *
 * WHY THIS IS TESTED: every failure mode of this function is silent. An IMAP server CREATES a
 * mailbox that does not exist, so a wrong name does not raise an error -- it files the editor's
 * mail into a folder nobody ever opens and reports success. The one answer that must never be
 * invented is the empty one: no trash folder has to stay empty so the endpoint can refuse.
 */

if (!ini_get('zend.assertions') || (int) ini_get('zend.assertions') !== 1) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1, otherwise assert() is a no-op and this test proves nothing.\n");
    exit(1);
}

// The function under test must not need a live connection, so the file is required directly.
// imap.php only declares functions; nothing runs at include time.
require_once __DIR__ . '/../imap.php';

$REF = '{imap.strato.de:993/imap/ssl}';

// ---------------------------------------------------------------- THE PLAIN CASE ----------------

$folders = [$REF . 'INBOX', $REF . 'Sent', $REF . 'Trash', $REF . 'Drafts'];
assert(avesmapsImapResolveTrashMailbox($folders) === 'Trash', 'a plain Trash folder is found');
assert(
    !str_contains(avesmapsImapResolveTrashMailbox($folders), '{'),
    'the connect reference is stripped -- imap_mail_move() takes a bare mailbox name'
);

// ---------------------------------------------------------------- NAME VARIANTS -----------------

assert(avesmapsImapResolveTrashMailbox([$REF . 'INBOX', $REF . 'Papierkorb']) === 'Papierkorb', 'German name');
assert(avesmapsImapResolveTrashMailbox([$REF . 'Deleted Items']) === 'Deleted Items', 'Outlook name');
assert(avesmapsImapResolveTrashMailbox([$REF . 'Deleted Messages']) === 'Deleted Messages', 'Apple name');
assert(avesmapsImapResolveTrashMailbox([$REF . 'TRASH']) === 'TRASH', 'case does not matter');
assert(avesmapsImapResolveTrashMailbox([$REF . 'trash']) === 'trash', 'lower case too');

// The name is returned VERBATIM, not normalised -- it is fed back to the server, which is
// case-sensitive about mailbox names.
assert(avesmapsImapResolveTrashMailbox([$REF . 'Papierkorb']) !== 'papierkorb', 'the stored spelling survives');

// ---------------------------------------------------------------- PREFIXED HIERARCHIES ----------
// Servers with an INBOX namespace expose "INBOX.Trash" (dot) or "INBOX/Trash" (slash). Matching
// the whole string would miss both; only the last segment decides.

assert(avesmapsImapResolveTrashMailbox([$REF . 'INBOX', $REF . 'INBOX.Trash']) === 'INBOX.Trash', 'dot delimiter');
assert(avesmapsImapResolveTrashMailbox([$REF . 'INBOX/Trash']) === 'INBOX/Trash', 'slash delimiter');
assert(avesmapsImapResolveTrashMailbox([$REF . 'INBOX.Papierkorb']) === 'INBOX.Papierkorb', 'prefixed German name');

// ---------------------------------------------------------------- PRECEDENCE --------------------
// A mailbox can carry several of them (a German client next to an English one). The order of
// AVESMAPS_IMAP_TRASH_NAMES decides, NOT the order the server happens to list them in.

$both = [$REF . 'Deleted Items', $REF . 'Papierkorb', $REF . 'Trash'];
assert(avesmapsImapResolveTrashMailbox($both) === 'Trash', 'Trash wins over Papierkorb and Deleted Items');
assert(avesmapsImapResolveTrashMailbox(array_reverse($both)) === 'Trash', 'and the listing order does not change that');
assert(
    avesmapsImapResolveTrashMailbox([$REF . 'Deleted', $REF . 'Papierkorb']) === 'Papierkorb',
    'Papierkorb wins over the bare "Deleted"'
);

// ---------------------------------------------------------------- THE REFUSAL -------------------
// The load-bearing case: no trash folder must yield '' so the endpoint answers 422 instead of
// creating one. If this ever returns a name, mails vanish into a folder nobody opens.

assert(avesmapsImapResolveTrashMailbox([]) === '', 'an empty listing has no trash folder');
assert(avesmapsImapResolveTrashMailbox([$REF . 'INBOX', $REF . 'Sent', $REF . 'Drafts']) === '', 'nor has a listing without one');
assert(avesmapsImapResolveTrashMailbox([$REF]) === '', 'a bare reference is not a folder');
assert(avesmapsImapResolveTrashMailbox([$REF . 'Trashcan']) === '', 'a similar name is not a match');
assert(avesmapsImapResolveTrashMailbox([$REF . 'Papierkorb-alt']) === '', 'nor is a suffixed one');

// A folder NAMED like trash below another one is still a trash folder -- but a parent segment
// alone is not (only the leaf is compared).
assert(avesmapsImapResolveTrashMailbox([$REF . 'Trash.2024']) === '', 'an archive UNDER Trash is not the trash folder');

// ---------------------------------------------------------------- CONFIGURED OVERRIDE -----------
// contact.imap.trash_mailbox wins outright: it exists for the mailbox whose folder is named in a
// way this list will never guess.

assert(avesmapsImapResolveTrashMailbox($folders, 'INBOX.Muell') === 'INBOX.Muell', 'the configured name wins');
assert(avesmapsImapResolveTrashMailbox([], 'INBOX.Muell') === 'INBOX.Muell', 'even without any listing');
assert(avesmapsImapResolveTrashMailbox($folders, '   ') === 'Trash', 'a blank setting is no setting');
assert(avesmapsImapResolveTrashMailbox($folders, ' INBOX.Muell ') === 'INBOX.Muell', 'and it is trimmed');

echo "OK: imap trash mailbox resolution\n";
