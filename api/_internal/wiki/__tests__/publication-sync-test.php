<?php

declare(strict_types=1);

/**
 * Unit tests for the pure diff core in api/_internal/wiki/publication-sync.php.
 * No DB, no HTTP, no dump -- avesmapsPublicationDiffLinks() is a pure function and
 * publication-sync.php is side-effect-free on include (function defs only), so this
 * test can `require` it with no MySQL. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/wiki/__tests__/publication-sync-test.php
 * (from the repo root). Exit 0 = all asserts passed.
 */

// Environment guard (same rationale as publication-parsing-test.php): assert() is a
// compiled no-op unless zend.assertions=1 at startup -- without this guard a broken
// implementation would print every "... ok" line and exit 0 (false green).
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../publication-sync.php';

// ---------------------------------------------------------------------------
// Override-Garantie: a manual row is NEVER in remove; a suppressed row is NEVER in add.
// (VERBATIM from the task-4 brief, plus stronger idempotency + collision asserts.)
// ---------------------------------------------------------------------------
$cur = [
    ['source_id' => 1, 'origin' => 'manual', 'status' => 'approved'],
    ['source_id' => 2, 'origin' => 'wiki_publication', 'status' => 'approved'],
    ['source_id' => 3, 'origin' => 'wiki_publication', 'status' => 'suppressed'],
];
$des = [
    ['source_id' => 2, 'reference_kind' => 'ausfuehrlich', 'pages' => '54', 'note' => null], // stays (update)
    ['source_id' => 3, 'reference_kind' => 'erwaehnung', 'pages' => null, 'note' => null],    // suppressed -> NOT add
    ['source_id' => 4, 'reference_kind' => 'ausfuehrlich', 'pages' => '7', 'note' => null],   // new -> add
];
$d = avesmapsPublicationDiffLinks($cur, $des);
assert(in_array(4, array_column($d['add'], 'source_id'), true));       // new wiki link added
assert(!in_array(3, array_column($d['add'], 'source_id'), true));      // suppression respected
assert(count($d['remove']) === 0);                                     // manual(1) untouched; 2 kept; 3 suppressed
echo "diff ok\n";

// The add carries the reference fields so the reconcile can persist them verbatim.
$added = array_values(array_filter($d['add'], static fn(array $r): bool => (int) $r['source_id'] === 4))[0];
assert($added['reference_kind'] === 'ausfuehrlich' && $added['pages'] === '7' && $added['note'] === null);
// source 2 (approved wiki, present in desired) is aligned via update, never re-added.
assert(!in_array(2, array_column($d['add'], 'source_id'), true));
assert(in_array(2, array_column($d['update'], 'source_id'), true));
echo "fields ok\n";

// ---------------------------------------------------------------------------
// Idempotency: after the diff is applied, a 2nd reconcile of the SAME desired set
// yields ZERO add/remove/update (the added row is now an approved wiki row whose
// reference fields already match).
// ---------------------------------------------------------------------------
$cur2 = [
    ['source_id' => 1, 'origin' => 'manual', 'status' => 'approved'],
    ['source_id' => 2, 'origin' => 'wiki_publication', 'status' => 'approved', 'reference_kind' => 'ausfuehrlich', 'pages' => '54', 'note' => null],
    ['source_id' => 3, 'origin' => 'wiki_publication', 'status' => 'suppressed'],
    ['source_id' => 4, 'origin' => 'wiki_publication', 'status' => 'approved', 'reference_kind' => 'ausfuehrlich', 'pages' => '7', 'note' => null],
];
$d2 = avesmapsPublicationDiffLinks($cur2, $des);
assert(count($d2['add']) === 0 && count($d2['remove']) === 0 && count($d2['update']) === 0);
echo "idempotent ok\n";

// ---------------------------------------------------------------------------
// Override-Garantie on collision: a manual row with the same source_id a wiki
// publication desires -> the manual row wins (no add, no update, no remove of it),
// while a stale approved-wiki row NOT in the desired set IS removed and a suppressed
// tombstone is left alone.
// ---------------------------------------------------------------------------
$desManual = [
    ['source_id' => 1, 'reference_kind' => 'ausfuehrlich', 'pages' => '9', 'note' => null], // collides with the manual row
];
$dm = avesmapsPublicationDiffLinks($cur, $desManual);
assert(count($dm['add']) === 0 && count($dm['update']) === 0);                    // manual wins -> wiki never touches it
assert(in_array(2, array_column($dm['remove'], 'source_id'), true));             // approved wiki, not desired -> removed
assert(!in_array(3, array_column($dm['remove'], 'source_id'), true));            // suppressed -> tombstone kept
assert(!in_array(1, array_column($dm['remove'], 'source_id'), true));            // manual -> never removed
echo "override ok\n";

// Empty desired: every approved wiki row is removed, manual + suppressed untouched.
$dEmpty = avesmapsPublicationDiffLinks($cur, []);
assert(array_column($dEmpty['remove'], 'source_id') === [2]);
assert(count($dEmpty['add']) === 0 && count($dEmpty['update']) === 0);
echo "empty ok\n";

// ---------------------------------------------------------------------------
// Pure helpers that need no DB: the redirect-key prefix strip + the reconcile
// segment order (territory first so its 'wiki:'-prefixed keys never collide with
// the plain settlement/region/path slugs).
// ---------------------------------------------------------------------------
assert(avesmapsPublicationStripWikiKeyPrefix('wiki:efferds-wogen') === 'efferds-wogen');
assert(avesmapsPublicationStripWikiKeyPrefix('name:efferds-wogen') === 'efferds-wogen');
assert(avesmapsPublicationStripWikiKeyPrefix('efferds-wogen') === 'efferds-wogen'); // already plain
// 'lore' joined as the fifth segment on 2026-07-22 and runs LAST: it is the largest population
// (~5.100 entries) and the only one whose live table may be absent, so a shortfall there never
// delays the four map-element segments.
assert(avesmapsPublicationReconcileSegmentOrder() === ['territory', 'settlement', 'region', 'path', 'lore']);
echo "helpers ok\n";

// 💣 THE "EMPTY DESIRED WIPES EVERYTHING" HAZARD, pinned so nobody removes the guard that stops it.
// The diff above is CORRECT to remove every approved wiki row when nothing is desired -- that is
// how an article that dropped its sources gets cleaned up. But the same input also arises when a
// whole entity type was never staged, and there it would delete data nobody asked to delete.
// The diff cannot tell the two apart; avesmapsPublicationStagingHasEntityType is what does, and
// both callers (the lore reconcile, the segment loop) must ask it BEFORE reconciling.
$wipe = avesmapsPublicationDiffLinks(
    [
        ['source_id' => 7, 'origin' => 'wiki_publication', 'status' => 'approved'],
        ['source_id' => 8, 'origin' => 'wiki_publication', 'status' => 'approved'],
    ],
    []
);
assert(count($wipe['remove']) === 2); // <- this is why the type-level guard exists
// The guard itself queries the DB, and this suite is deliberately DB-free (the test PHP has no PDO
// driver at all), so only its EXISTENCE is pinned here. That is the part worth pinning: the risk is
// somebody deleting the guard as a redundant-looking query, not somebody breaking its three lines.
assert(function_exists('avesmapsPublicationStagingHasEntityType'));
echo "staging-guard ok\n";

// ReferenceFieldsDiffer: null vs '' are equal; a missing field forces "differ".
assert(avesmapsPublicationReferenceFieldsDiffer(
    ['reference_kind' => 'ausfuehrlich', 'pages' => null, 'note' => ''],
    ['reference_kind' => 'ausfuehrlich', 'pages' => '', 'note' => null]
) === false);
assert(avesmapsPublicationReferenceFieldsDiffer(
    ['reference_kind' => 'ausfuehrlich', 'pages' => '54', 'note' => null],
    ['reference_kind' => 'ausfuehrlich', 'pages' => '55', 'note' => null]
) === true);
assert(avesmapsPublicationReferenceFieldsDiffer(
    ['reference_kind' => 'ausfuehrlich'], // missing pages/note -> cannot prove equal
    ['reference_kind' => 'ausfuehrlich', 'pages' => null, 'note' => null]
) === true);
echo "fielddiff ok\n";

// avesmapsWikiAventuricaPageTitleFromUrl: pure URL -> wiki page title (the gate before the DB-backed
// publication-identity normalization). Only wiki-aventurica /wiki/ + ?title= links resolve; anything
// else (F-Shop, wrong host, empty) yields '' so the add keeps the reporter's original URL.
assert(avesmapsWikiAventuricaPageTitleFromUrl('https://de.wiki-aventurica.de/wiki/Die_Flusslande') === 'Die Flusslande');
assert(avesmapsWikiAventuricaPageTitleFromUrl('https://de.wiki-aventurica.de/wiki/Kosch_(Regionalspielhilfe)') === 'Kosch (Regionalspielhilfe)');
assert(avesmapsWikiAventuricaPageTitleFromUrl('https://de.wiki-aventurica.de/wiki/Die_Flusslande#Publikationen') === 'Die Flusslande'); // #fragment stripped
assert(avesmapsWikiAventuricaPageTitleFromUrl('https://de.wiki-aventurica.de/index.php?title=Die_Flusslande') === 'Die Flusslande'); // ?title= shape
assert(avesmapsWikiAventuricaPageTitleFromUrl('https://de.wiki-aventurica.de/wiki/G%C3%B6tterwirken') === 'Götterwirken'); // percent-decoded
assert(avesmapsWikiAventuricaPageTitleFromUrl('https://www.f-shop.de/search?sSearch=12017') === ''); // shop link -> no normalization
assert(avesmapsWikiAventuricaPageTitleFromUrl('https://example.com/wiki/Die_Flusslande') === ''); // wrong host
assert(avesmapsWikiAventuricaPageTitleFromUrl('') === '');
echo "urltitle ok\n";

echo "ALL PUBLICATION-SYNC DIFF TESTS PASSED\n";
