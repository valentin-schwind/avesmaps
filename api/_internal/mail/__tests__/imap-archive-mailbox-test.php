<?php

declare(strict_types=1);

/**
 * Unit test for "which folder is the archive?" -- pure name logic, no IMAP, no DB.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 api/_internal/mail/__tests__/imap-archive-mailbox-test.php
 * Exit 0 = all asserts passed.
 *
 * WHY THIS IS TESTED: same silent failure mode as the trash folder. An IMAP server CREATES a
 * mailbox that does not exist, so a guessed name does not raise an error -- it moves the editor's
 * mail into a folder nobody ever opens and reports success. The one answer that must never be
 * invented is the empty one: no archive folder has to stay empty so the endpoint can answer 422.
 *
 * 🔴 And unlike the SENT folder, there is no literal fallback here. avesmapsImapSentMailboxFrom()
 * keeps 'Sent' when the listing comes back empty, because a missing sent copy costs a convenience.
 * A wrong archive name costs the mail.
 *
 * Design: docs/superpowers/specs/2026-08-15-mail-archiv-design.md §4
 */

if (!ini_get('zend.assertions') || (int) ini_get('zend.assertions') !== 1) {
    fwrite(STDERR, "FATAL: run with -d zend.assertions=1, otherwise assert() is a no-op and this test proves nothing.\n");
    exit(1);
}

require_once __DIR__ . '/../imap.php';

$REF = '{imap.strato.de:993/imap/ssl}';

// ---------------------------------------------------------------- THE PLAIN CASE ----------------
// The real mailbox, as the owner described it on 2026-08-15: STRATO's four defaults plus the
// archive folder he had already created.

$folders = [$REF . 'INBOX', $REF . 'Sent Items', $REF . 'Trash', $REF . 'Drafts', $REF . 'Spam', $REF . 'Archive'];
assert(avesmapsImapResolveArchiveMailbox($folders) === 'Archive', 'the archive folder of the real mailbox is found');
assert(
    !str_contains(avesmapsImapResolveArchiveMailbox($folders), '{'),
    'the connect reference is stripped -- imap_mail_move() and imap_reopen() take a bare name'
);

// ---------------------------------------------------------------- NO CONFUSION WITH ITS NEIGHBOURS
// All three special folders are resolved from the SAME listing by the same helper. If one of them
// ever answered with another one's folder, mails would be filed into a folder that looks plausible
// in the response and is wrong in the mailbox.

assert(avesmapsImapResolveTrashMailbox($folders) === 'Trash', 'trash still resolves next to an archive');
assert(avesmapsImapResolveSentMailbox($folders) === 'Sent Items', 'and so does the sent folder');
assert(avesmapsImapResolveArchiveMailbox($folders) !== 'Trash', 'the archive is never the trash');
assert(avesmapsImapResolveArchiveMailbox($folders) !== 'Sent Items', 'nor the sent folder');

// ---------------------------------------------------------------- NAME VARIANTS -----------------

assert(avesmapsImapResolveArchiveMailbox([$REF . 'INBOX', $REF . 'Archiv']) === 'Archiv', 'German name');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'Archives']) === 'Archives', 'plural name');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'Archivierte Objekte']) === 'Archivierte Objekte', 'German Outlook name');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'Archivierte Elemente']) === 'Archivierte Elemente', 'and its sibling');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'ARCHIVE']) === 'ARCHIVE', 'case does not matter');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'archiv']) === 'archiv', 'lower case too');

// The name is returned VERBATIM, not normalised -- it is fed back to the server, which is
// case-sensitive about mailbox names.
assert(avesmapsImapResolveArchiveMailbox([$REF . 'Archiv']) !== 'archiv', 'the stored spelling survives');

// ---------------------------------------------------------------- PREFIXED HIERARCHIES ----------
// Servers with an INBOX namespace expose "INBOX.Archive" (dot) or "INBOX/Archive" (slash). Matching
// the whole string would miss both; only the last segment decides.

assert(avesmapsImapResolveArchiveMailbox([$REF . 'INBOX', $REF . 'INBOX.Archive']) === 'INBOX.Archive', 'dot delimiter');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'INBOX/Archive']) === 'INBOX/Archive', 'slash delimiter');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'INBOX.Archiv']) === 'INBOX.Archiv', 'prefixed German name');

// ---------------------------------------------------------------- PRECEDENCE --------------------
// A mailbox can carry several (a German client next to an English one). The order of
// AVESMAPS_IMAP_ARCHIVE_NAMES decides, NOT the order the server happens to list them in.
// "Archive" is first because THIS mailbox spells it that way.

$both = [$REF . 'Archiv', $REF . 'Archives', $REF . 'Archive'];
assert(avesmapsImapResolveArchiveMailbox($both) === 'Archive', 'Archive wins over Archiv and Archives');
assert(avesmapsImapResolveArchiveMailbox(array_reverse($both)) === 'Archive', 'and the listing order does not change that');
assert(
    avesmapsImapResolveArchiveMailbox([$REF . 'Archives', $REF . 'Archiv']) === 'Archiv',
    'Archiv wins over the plural Archives'
);

// ---------------------------------------------------------------- THE REFUSAL -------------------
// The load-bearing case: no archive folder must yield '' so the endpoint answers 422 instead of
// letting the server create one. If this ever returns a name, mails vanish into a folder nobody
// opens -- and the response says "moved" either way.

assert(avesmapsImapResolveArchiveMailbox([]) === '', 'an empty listing has no archive folder');
assert(
    avesmapsImapResolveArchiveMailbox([$REF . 'INBOX', $REF . 'Sent Items', $REF . 'Trash', $REF . 'Drafts', $REF . 'Spam']) === '',
    'nor have STRATO\'s four defaults -- this is exactly the state before the owner creates the folder'
);
assert(avesmapsImapResolveArchiveMailbox([$REF]) === '', 'a bare reference is not a folder');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'Archived']) === '', 'a similar name is not a match');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'Archiv-alt']) === '', 'nor is a suffixed one');
assert(avesmapsImapResolveArchiveMailbox([$REF . 'My Archive']) === '', 'nor a prefixed one');

// A folder NAMED like the archive below another one is still an archive folder -- but a parent
// segment alone is not (only the leaf is compared).
assert(avesmapsImapResolveArchiveMailbox([$REF . 'Archive.2024']) === '', 'a folder UNDER Archive is not the archive itself');

// ---------------------------------------------------------------- CONFIGURED OVERRIDE -----------
// contact.imap.archive_mailbox wins outright: it exists for the mailbox whose folder is named in a
// way this list will never guess.

assert(avesmapsImapResolveArchiveMailbox($folders, 'INBOX.Ablage') === 'INBOX.Ablage', 'the configured name wins');
assert(avesmapsImapResolveArchiveMailbox([], 'INBOX.Ablage') === 'INBOX.Ablage', 'even without any listing');
assert(avesmapsImapResolveArchiveMailbox($folders, '   ') === 'Archive', 'a blank setting is no setting');
assert(avesmapsImapResolveArchiveMailbox($folders, ' INBOX.Ablage ') === 'INBOX.Ablage', 'and it is trimmed');

// ---------------------------------------------------------------- THE CONFIG KEY ----------------
// The endpoint reads $imapCfg['archive_mailbox']; if avesmapsResolveImapConfig() did not carry it,
// the override above would be unreachable in production while this test still passed.

$cfg = avesmapsResolveImapConfig(['contact' => ['imap' => ['archive_mailbox' => 'INBOX.Ablage'], 'smtp' => []]]);
assert(($cfg['archive_mailbox'] ?? null) === 'INBOX.Ablage', 'the config key reaches the endpoint');
$cfgEmpty = avesmapsResolveImapConfig(['contact' => ['imap' => [], 'smtp' => []]]);
assert(($cfgEmpty['archive_mailbox'] ?? null) === '', 'and it defaults to empty -- discovered, never guessed');

// ---------------------------------------------------------------- MOVE GUARDS -------------------
// avesmapsImapMoveToFolder() must refuse before touching the connection when it has no target;
// the '' from the refusal above has to stay harmless even if a caller forgets to check it.

assert(avesmapsImapMoveToFolder(null, 12, '') === false, 'an empty target folder is never moved to');
assert(avesmapsImapMoveToFolder(null, 12, '   ') === false, 'nor a blank one');
assert(avesmapsImapMoveToFolder(null, 0, 'Archive') === false, 'and a uid of 0 is not a message');
assert(avesmapsImapSelectFolder(null, $REF, '') === false, 'selecting an unnamed folder fails instead of reopening the inbox');

echo "OK: imap archive mailbox resolution\n";
