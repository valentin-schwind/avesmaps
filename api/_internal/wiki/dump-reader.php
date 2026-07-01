<?php

declare(strict_types=1);

/**
 * WikiDump migration -- streaming dump-reader SKELETON.
 * ---------------------------------------------------------------------------
 * Reads the offline MediaWiki XML export of Wiki Aventurica
 * (`dewa_dump_small.xml.bz2`, ~223k pages, ~315 MB uncompressed) as a
 * constant-memory stream. This file is the FOUNDATION the later entity parsers
 * (settlements / territories / regions / paths -- a separate task) hang off. It
 * does NOT parse entities; it provides:
 *
 *   1. A stream-wrapper-selecting reader opener (bz2 / gz / plain .xml).
 *   2. A streaming <page> iterator yielding {title, ns, redirect, wikitext}.
 *      `wikitext` is `revision/text` -- the SAME string the online crawler fed
 *      downstream as `revisions[0]['slots']['main']['content']`
 *      (see api/_internal/wiki/locations.php:629), so later parsers plug in
 *      unchanged.
 *   3. A page-counter "skip-to-cursor" for resume (XMLReader is not seekable and
 *      bz2 is not byte-seekable -> reopen-from-start + skip N pages is the
 *      intended resume shape).
 *   4. Pass A -- redirect alias extraction, split into a PURE collect step and a
 *      THIN persistence step. The pure step derives `alias_slug` +
 *      `canonical_wiki_key` via the EXISTING real functions (invariants I1/I7):
 *        - alias_slug        = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($title))
 *                              (the exact composition avesmapsWikiSyncMonitorStoreAlias() uses)
 *        - canonical_wiki_key = avesmapsPoliticalBuildWikiKey(<page-url(target)>, target)
 *                              => 'wiki:' . avesmapsPoliticalSlug(target)
 *          i.e. the same 'wiki:'-prefixed key shape the online crawler produced
 *          and that avesmapsWikiSyncMonitorResolveParentKey() expects
 *          (it strips a leading 'wiki:'). This library NEVER re-implements slug
 *          or normalization -- it calls the real code so behavior is bit-identical.
 *      The THIN persistence step reuses avesmapsWikiSyncMonitorStoreAlias()
 *      verbatim -- it writes no new upsert of its own.
 *   5. A THIN resume/read_step scaffold over the existing `wiki_sync_runs` table
 *      (new sync_type 'dump_read'; cursor in stats_json), reusing the existing
 *      run-lifecycle helpers. This layer needs a DB and is therefore NOT covered
 *      by the local fixture test; its live verification is deferred to the
 *      controlled rollout / compare-test. It must not auto-run anywhere yet.
 *
 * PURITY CONTRACT: side-effect-free on include (only `const` + `function`
 * definitions -- no top-level executable code, no DB connect, no headers), so a
 * test can `require` it with no MySQL and no STRATO. The reader CORE
 * (open + iterate + Pass A collect) is entirely DB-free; every DB touch lives in
 * a clearly separated function that takes a PDO.
 *
 * STREAMING ONLY: XMLReader (pull parser), never SimpleXML/DOM. The 315 MB
 * document must never be materialised in RAM.
 *
 * The reused derivation functions call mb_strtolower()/mb_substr(), so mbstring
 * must be loaded at runtime (guaranteed on STRATO; on a bare CLI use
 * `php -d extension=php_mbstring.dll`). This file requires nothing on include;
 * the caller is responsible for having loaded the derivation libraries
 * (political/territory.php + wiki/sync.php + wiki/sync-monitor.php) before
 * invoking Pass A / persistence.
 */

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

/**
 * Dedicated sync_type for dump-read runs in `wiki_sync_runs`. Kept separate from
 * the online crawler's 'location' type so the two flows never collide. Defined
 * locally (not imported) because the 'location' constant lives in the endpoint
 * layer (api/edit/wiki/sync.php), not in the pure library layer.
 */
const AVESMAPS_WIKI_DUMP_SYNC_TYPE = 'dump_read';

/**
 * Batch size for one dump-read step. A step processes at most this many pages,
 * then returns, so a web request stays well under STRATO's ~30-45 s ceiling
 * (mirrors the sync-monitor step-runtime discipline).
 */
const AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET = 2000;

/**
 * Wall-clock budget (seconds) for one dump-read step, matching the sync-monitor
 * `min(28, ...)` pattern; set_time_limit() is given a small headroom on top.
 */
const AVESMAPS_WIKI_DUMP_STEP_SECONDS = 28;

/**
 * Rough page-count estimate for progress display (the dump has ~223,583 pages).
 * Refined from the actual stream when known; only used to seed progress_total.
 */
const AVESMAPS_WIKI_DUMP_ESTIMATED_PAGE_COUNT = 223583;

// ===========================================================================
// 1. Reader opener -- stream-wrapper selection by extension + availability.
// ===========================================================================

/**
 * Open an XMLReader over a MediaWiki XML dump, choosing the decompression stream
 * wrapper by file extension:
 *
 *   *.bz2 -> compress.bzip2://   (requires ext/bz2; throws if absent -- never a
 *                                 silent raw-byte fallback)
 *   *.gz  -> compress.zlib://    (ext/zlib is always present in PHP)
 *   *.xml -> the path directly
 *
 * The wrapper streams: XMLReader pulls decompressed bytes on demand, so the full
 * document never enters RAM.
 *
 * @throws RuntimeException if a *.bz2 path is requested without ext/bz2, or if
 *                          XMLReader::open() fails (path + reason included).
 */
function avesmapsWikiDumpOpenReader(string $path): XMLReader
{
    $streamUri = avesmapsWikiDumpResolveStreamUri($path);

    $reader = new XMLReader();
    // XMLReader::open() emits a warning + returns false on failure; suppress the
    // warning and translate the failure into an explicit, actionable exception.
    $opened = @$reader->open($streamUri, null, LIBXML_NONET);
    if ($opened !== true) {
        throw new RuntimeException(
            'Der Dump konnte nicht geoeffnet werden (XMLReader::open fehlgeschlagen): ' . $path
            . ' [stream: ' . $streamUri . ']'
        );
    }

    return $reader;
}

/**
 * Map a dump file path to the stream URI XMLReader should open, applying the
 * decompression wrapper for the extension. Pure string logic apart from the
 * ext/bz2 availability probe.
 *
 * @throws RuntimeException if a *.bz2 path is requested but ext/bz2 is missing.
 */
function avesmapsWikiDumpResolveStreamUri(string $path): string
{
    $lower = strtolower($path);

    if (str_ends_with($lower, '.bz2')) {
        if (!extension_loaded('bz2')) {
            throw new RuntimeException(
                'Die PHP-Erweiterung "bz2" ist nicht geladen; eine .bz2-Datei kann nicht gelesen werden: '
                . $path
                . '. Erst bz2 aktivieren (auf STRATO vorhanden) oder eine entpackte .xml/.gz-Datei angeben.'
            );
        }

        return 'compress.bzip2://' . $path;
    }

    if (str_ends_with($lower, '.gz')) {
        return 'compress.zlib://' . $path;
    }

    // Plain .xml (or anything else): open the path directly.
    return $path;
}

// ===========================================================================
// 2. Streaming <page> iterator (+ 3. skip-to-cursor).
// ===========================================================================

/**
 * Stream <page> elements from an opened dump reader, yielding one associative
 * array per page:
 *
 *   [
 *     'title'    => string,   // <title> text (namespace prefix preserved)
 *     'ns'       => int,      // <ns> as int (0 = Main; filtering is the caller's job)
 *     'redirect' => ?string,  // <redirect title="..."/> target, or null
 *     'wikitext' => string,   // <revision><text> content (multi-line intact)
 *   ]
 *
 * Only one page is held in memory at a time; nothing is accumulated. Uses the
 * XMLReader pull API (read()/name/nodeType), never DOM/SimpleXML.
 *
 * Skip-to-cursor resume: the first $skipPages fully-parsed pages are counted and
 * discarded cheaply (their text is still parsed to advance the cursor, but not
 * yielded), then up to $maxPages pages are yielded. This supports the
 * "reopen-from-start, skip N, process the next batch" resume model, since
 * XMLReader is not seekable and bz2 is not byte-seekable.
 *
 * @param int      $skipPages number of leading <page> elements to skip (cursor).
 * @param int|null $maxPages  max pages to yield after skipping (null = no limit).
 *
 * @return \Generator<int, array{title:string, ns:int, redirect:?string, wikitext:string}>
 */
function avesmapsWikiDumpIteratePages(XMLReader $reader, int $skipPages = 0, ?int $maxPages = null): \Generator
{
    if ($skipPages < 0) {
        $skipPages = 0;
    }

    $seen = 0;     // total <page> elements encountered
    $yielded = 0;  // pages actually yielded (after skipping)

    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT || $reader->localName !== 'page') {
            continue;
        }

        $page = avesmapsWikiDumpReadPageElement($reader);
        $seen++;

        if ($seen <= $skipPages) {
            continue; // already-processed page -> advance cursor, do not yield
        }

        yield $page;
        $yielded++;

        if ($maxPages !== null && $yielded >= $maxPages) {
            return;
        }
    }
}

/**
 * Parse a single <page> subtree, with the reader positioned on the opening
 * <page> element. Advances the reader to the matching </page>. Reads:
 *   - the first <title> text,
 *   - the first <ns> text (as int),
 *   - the <redirect title="..."/> attribute (if present),
 *   - the first <revision>'s <text> content.
 *
 * Uses depth tracking so a nested <text> (revision text) is captured while an
 * unrelated element named "text" elsewhere would not be. Constant memory: only
 * the four scalar fields of this one page are retained.
 *
 * @return array{title:string, ns:int, redirect:?string, wikitext:string}
 */
function avesmapsWikiDumpReadPageElement(XMLReader $reader): array
{
    $title = '';
    $ns = 0;
    $redirect = null;
    $wikitext = '';

    $haveTitle = false;
    $haveNs = false;
    $haveText = false;
    $inRevision = false;

    // An empty <page/> (shouldn't occur in a real dump, but be defensive).
    if ($reader->isEmptyElement) {
        return ['title' => $title, 'ns' => $ns, 'redirect' => $redirect, 'wikitext' => $wikitext];
    }

    $pageDepth = $reader->depth;

    while ($reader->read()) {
        $nodeType = $reader->nodeType;

        // Closing </page> at the page's own depth ends this subtree.
        if ($nodeType === XMLReader::END_ELEMENT && $reader->localName === 'page' && $reader->depth === $pageDepth) {
            break;
        }

        if ($nodeType === XMLReader::END_ELEMENT) {
            if ($reader->localName === 'revision') {
                $inRevision = false;
            }
            continue;
        }

        if ($nodeType !== XMLReader::ELEMENT) {
            continue;
        }

        switch ($reader->localName) {
            case 'title':
                if (!$haveTitle) {
                    $title = avesmapsWikiDumpReadElementText($reader);
                    $haveTitle = true;
                }
                break;

            case 'ns':
                if (!$haveNs) {
                    $ns = (int) avesmapsWikiDumpReadElementText($reader);
                    $haveNs = true;
                }
                break;

            case 'redirect':
                // <redirect title="Target" /> -- an attribute, not element text.
                if ($redirect === null && $reader->hasAttributes) {
                    $target = $reader->getAttribute('title');
                    if (is_string($target) && $target !== '') {
                        $redirect = $target;
                    }
                }
                break;

            case 'revision':
                $inRevision = true;
                break;

            case 'text':
                // Only the FIRST revision's text; later <revision> blocks (none in
                // a page-current dump, but be strict) are ignored.
                if ($inRevision && !$haveText) {
                    $wikitext = avesmapsWikiDumpReadElementText($reader);
                    $haveText = true;
                }
                break;

            default:
                break;
        }
    }

    return ['title' => $title, 'ns' => $ns, 'redirect' => $redirect, 'wikitext' => $wikitext];
}

/**
 * Read the full text content of the element the reader is currently positioned
 * on (which may span multiple TEXT / CDATA / significant-whitespace nodes), and
 * leave the reader on the element's END node. Preserves line breaks so
 * multi-line wikitext is captured intact.
 *
 * For an empty element (<text />) returns ''.
 */
function avesmapsWikiDumpReadElementText(XMLReader $reader): string
{
    if ($reader->isEmptyElement) {
        return '';
    }

    $elementDepth = $reader->depth;
    $buffer = '';

    while ($reader->read()) {
        $nodeType = $reader->nodeType;

        if ($nodeType === XMLReader::END_ELEMENT && $reader->depth === $elementDepth) {
            break;
        }

        if (
            $nodeType === XMLReader::TEXT
            || $nodeType === XMLReader::CDATA
            || $nodeType === XMLReader::SIGNIFICANT_WHITESPACE
            || $nodeType === XMLReader::WHITESPACE
        ) {
            $buffer .= $reader->value;
        }
    }

    return $buffer;
}

// ===========================================================================
// 4. Pass A -- redirect alias extraction (PURE collect + THIN persist).
// ===========================================================================

/**
 * PURE (DB-free) Pass A: from a stream of page arrays (as produced by
 * avesmapsWikiDumpIteratePages), build the redirect alias map
 *
 *   alias_slug => canonical_wiki_key
 *
 * for every page carrying a <redirect> target. Both sides are derived with the
 * EXISTING real functions so the result is bit-identical to the online crawler
 * (invariants I1/I7):
 *
 *   - alias_slug        = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($page['title']))
 *                         -- the exact composition avesmapsWikiSyncMonitorStoreAlias() applies.
 *   - canonical_wiki_key = avesmapsWikiDumpCanonicalWikiKeyForTitle($page['redirect'])
 *                         => avesmapsPoliticalBuildWikiKey(<page-url(target)>, target)
 *                         => 'wiki:' . avesmapsPoliticalSlug(target).
 *
 * No DB, no side effects -- unit-testable against a fixture. Redirect pages with
 * an empty derived slug or empty target are skipped. On duplicate alias_slug,
 * last write wins (matches the ON DUPLICATE KEY upsert semantics of StoreAlias).
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return array<string, string> alias_slug => canonical_wiki_key
 */
function avesmapsWikiDumpCollectRedirectAliases(iterable $pages): array
{
    $map = [];

    foreach ($pages as $page) {
        $target = $page['redirect'] ?? null;
        if (!is_string($target) || $target === '') {
            continue; // not a redirect page
        }

        $title = (string) ($page['title'] ?? '');
        $aliasSlug = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($title));
        if ($aliasSlug === '') {
            continue;
        }

        $canonical = avesmapsWikiDumpCanonicalWikiKeyForTitle($target);
        if ($canonical === '') {
            continue;
        }

        $map[$aliasSlug] = $canonical; // last write wins (upsert-consistent)
    }

    return $map;
}

/**
 * Canonical `wiki_key` for a wiki page title, using the real territory key
 * builder as if the page were reached via its /wiki/<Title> URL (the online
 * crawler always had such a URL). Yields the 'wiki:'-prefixed key shape the rest
 * of the system expects. Reuses avesmapsPoliticalBuildWikiKey() +
 * avesmapsWikiSyncPageUrl() -- no re-implementation.
 */
function avesmapsWikiDumpCanonicalWikiKeyForTitle(string $title): string
{
    $title = trim($title);
    if ($title === '') {
        return '';
    }

    // avesmapsWikiSyncPageUrl() builds the exact /wiki/<Title> URL the crawler
    // used; BuildWikiKey() then slugs the URL's page segment -> 'wiki:'.slug.
    $pageUrl = avesmapsWikiSyncPageUrl($title);

    return avesmapsPoliticalBuildWikiKey($pageUrl, $title);
}

/**
 * THIN persistence for Pass A: upsert an alias_slug => canonical_wiki_key map
 * into `wiki_redirect_alias` by REUSING the existing
 * avesmapsWikiSyncMonitorStoreAlias() (no new upsert here).
 *
 * StoreAlias() re-derives the alias_slug from the given titles via
 * avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle(...)) -- the same
 * derivation the pure collector used. To make the round-trip lossless we group
 * the map by canonical_wiki_key and, for each group, hand StoreAlias() the set
 * of redirect page TITLES so it reproduces the identical alias_slug keys.
 *
 * Because StoreAlias() needs the source titles (not slugs), callers pass the
 * original page rows here; this function re-runs the same pure derivation to
 * bucket titles by canonical key. This is the ONLY function in Pass A that
 * touches a DB.
 *
 * NB: requires a DB -> NOT exercised by the local fixture test; live-verified in
 * the controlled rollout.
 *
 * @param iterable<array{title:string, ns:int, redirect:?string, wikitext:string}> $pages
 * @return int number of distinct canonical keys written (StoreAlias calls made)
 */
function avesmapsWikiDumpPersistRedirectAliases(PDO $pdo, iterable $pages): int
{
    // canonical_wiki_key => list of redirect page titles that alias to it.
    $titlesByCanonical = [];

    foreach ($pages as $page) {
        $target = $page['redirect'] ?? null;
        if (!is_string($target) || $target === '') {
            continue;
        }
        $title = (string) ($page['title'] ?? '');
        if (trim($title) === '') {
            continue;
        }
        $canonical = avesmapsWikiDumpCanonicalWikiKeyForTitle($target);
        if ($canonical === '') {
            continue;
        }
        $titlesByCanonical[$canonical][] = $title;
    }

    $written = 0;
    foreach ($titlesByCanonical as $canonicalWikiKey => $titles) {
        // Reuse the real upsert verbatim (it recomputes the alias_slug itself).
        avesmapsWikiSyncMonitorStoreAlias($pdo, $titles, (string) $canonicalWikiKey);
        $written++;
    }

    return $written;
}

// ===========================================================================
// 5. Resume / progress wiring (THIN, DB-backed -- deferred live verification).
// ===========================================================================

/**
 * Read the dump-read cursor (page counter) from a run's stats_json.
 * Pure array access -- no DB.
 *
 * @param array<string, mixed> $run a `wiki_sync_runs` row.
 */
function avesmapsWikiDumpReadCursor(array $run): int
{
    $stats = avesmapsWikiSyncDecodeJson($run['stats_json'] ?? null);
    $cursor = $stats['dump_cursor'] ?? 0;

    return is_int($cursor) ? max(0, $cursor) : max(0, (int) $cursor);
}

/**
 * Create a new dump-read run in `wiki_sync_runs` (sync_type 'dump_read'),
 * seeding the cursor at 0 and progress_total at the page-count estimate. Returns
 * the run's public_id.
 *
 * DB-backed -> not covered by the fixture test; live-verified in rollout.
 */
function avesmapsWikiDumpCreateRun(PDO $pdo, ?int $createdBy = null): string
{
    avesmapsWikiSyncEnsureCoreTables($pdo);

    $publicId = avesmapsPoliticalUuidV4();
    $stats = ['dump_cursor' => 0, 'pages_processed' => 0, 'aliases_written' => 0];

    $statement = $pdo->prepare(
        'INSERT INTO wiki_sync_runs
            (public_id, sync_type, status, phase, progress_current, progress_total, message, stats_json, created_by)
        VALUES
            (:public_id, :sync_type, :status, :phase, :progress_current, :progress_total, :message, :stats_json, :created_by)'
    );
    $statement->execute([
        'public_id' => $publicId,
        'sync_type' => AVESMAPS_WIKI_DUMP_SYNC_TYPE,
        'status' => 'running',
        'phase' => 'pass_a_redirects',
        'progress_current' => 0,
        'progress_total' => AVESMAPS_WIKI_DUMP_ESTIMATED_PAGE_COUNT,
        'message' => 'Dump-Read gestartet.',
        'stats_json' => avesmapsWikiSyncEncodeJson($stats),
        'created_by' => $createdBy,
    ]);

    return $publicId;
}

/**
 * Process ONE bounded dump-read step for Pass A (redirect alias extraction),
 * resuming from the run's page-counter cursor:
 *
 *   1. reopen the dump from the start and skip `cursor` pages,
 *   2. process up to AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET pages (or until the
 *      ~28 s wall-clock budget is hit), collecting + persisting redirect aliases,
 *   3. advance the cursor in stats_json and update progress_current,
 *   4. mark the run 'completed' when the stream is exhausted, else leave it
 *      'running' for the next step.
 *
 * This mirrors the sync-monitor step discipline (bounded batch + set_time_limit)
 * and reuses the existing run-lifecycle helpers
 * (avesmapsWikiSyncFetchRunByPublicId / avesmapsWikiSyncUpdateRun). It does NOT
 * use the online crawler's 4-phase location state machine or its frontend
 * 8-step limit -- this is a single-phase, cursor-advancing loop.
 *
 * DB- AND dump-backed -> NOT exercised by the local fixture test. Its live
 * verification is deferred to the controlled rollout / compare-test; nothing
 * calls it automatically yet.
 *
 * @return array{ok:bool, done:bool, cursor:int, processed_this_step:int, aliases_written:int}
 */
function avesmapsWikiDumpRunPassAStep(PDO $pdo, string $dumpPath, string $runPublicId): array
{
    @set_time_limit(AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + AVESMAPS_WIKI_DUMP_STEP_SECONDS;

    $run = avesmapsWikiSyncFetchRunByPublicId($pdo, $runPublicId);
    $runId = (int) $run['id'];
    $cursor = avesmapsWikiDumpReadCursor($run);
    $stats = avesmapsWikiSyncDecodeJson($run['stats_json'] ?? null);

    $reader = avesmapsWikiDumpOpenReader($dumpPath);

    $processedThisStep = 0;
    $aliasesWritten = 0;
    $batchTitlesByCanonical = [];
    $done = false;

    try {
        foreach (avesmapsWikiDumpIteratePages($reader, $cursor) as $page) {
            $processedThisStep++;

            $target = $page['redirect'] ?? null;
            if (is_string($target) && $target !== '' && trim((string) ($page['title'] ?? '')) !== '') {
                $canonical = avesmapsWikiDumpCanonicalWikiKeyForTitle($target);
                if ($canonical !== '') {
                    $batchTitlesByCanonical[$canonical][] = (string) $page['title'];
                }
            }

            if ($processedThisStep >= AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET || microtime(true) >= $deadline) {
                break;
            }
        }
        // If the iterator ran dry before hitting the budget, the stream is done.
        if ($processedThisStep < AVESMAPS_WIKI_DUMP_STEP_PAGE_BUDGET && microtime(true) < $deadline) {
            $done = true;
        }
    } finally {
        $reader->close();
    }

    // Persist this batch's aliases via the reused real upsert.
    foreach ($batchTitlesByCanonical as $canonicalWikiKey => $titles) {
        avesmapsWikiSyncMonitorStoreAlias($pdo, $titles, (string) $canonicalWikiKey);
        $aliasesWritten++;
    }

    $cursor += $processedThisStep;
    $stats['dump_cursor'] = $cursor;
    $stats['pages_processed'] = (int) ($stats['pages_processed'] ?? 0) + $processedThisStep;
    $stats['aliases_written'] = (int) ($stats['aliases_written'] ?? 0) + $aliasesWritten;

    avesmapsWikiSyncUpdateRun(
        $pdo,
        $runId,
        $done ? 'completed' : 'running',
        'pass_a_redirects',
        $cursor,
        $done ? 'Pass A abgeschlossen.' : ('Pass A laeuft (Cursor ' . $cursor . ').'),
        $stats
    );

    return [
        'ok' => true,
        'done' => $done,
        'cursor' => $cursor,
        'processed_this_step' => $processedThisStep,
        'aliases_written' => $aliasesWritten,
    ];
}
