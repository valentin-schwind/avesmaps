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
 *   4. Pass A -- redirect alias extraction as a PURE collect step. It derives
 *      `alias_slug` + `canonical_wiki_key` via the EXISTING real functions
 *      (invariants I1/I7):
 *        - alias_slug        = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($title))
 *                              (the exact composition avesmapsWikiSyncMonitorStoreAlias() uses)
 *        - canonical_wiki_key = avesmapsPoliticalBuildWikiKey(<page-url(target)>, target)
 *                              => 'wiki:' . avesmapsPoliticalSlug(target)
 *          i.e. the same 'wiki:'-prefixed key shape the online crawler produced
 *          and that avesmapsWikiSyncMonitorResolveParentKey() expects
 *          (it strips a leading 'wiki:'). This library NEVER re-implements slug
 *          or normalization -- it calls the real code so behavior is bit-identical.
 *      Persisting the aliases is the hybrid driver's job (dump-hybrid-driver.php,
 *      redirect_aliases phase), not this file's.
 *
 * 🔴 14.09.2026: the THIN persistence step, the run creator and the single-phase
 *    Pass-A step runner that stood here were never called -- the hybrid driver
 *    replaced them -- and are gone. This file touches no database any more.
 *
 * PURITY CONTRACT: side-effect-free on include (only `const` + `function`
 * definitions -- no top-level executable code, no DB connect, no headers), so a
 * test can `require` it with no MySQL and no STRATO. The reader
 * (open + iterate + Pass A collect) is entirely DB-free.
 *
 * STREAMING ONLY: XMLReader (pull parser), never SimpleXML/DOM. The 315 MB
 * document must never be materialised in RAM.
 *
 * The reused derivation functions call mb_strtolower()/mb_substr(), so mbstring
 * must be loaded at runtime (guaranteed on STRATO; on a bare CLI use
 * `php -d extension=php_mbstring.dll`). This file requires nothing on include;
 * the caller is responsible for having loaded the derivation libraries
 * (political/territory.php + wiki/sync.php + wiki/sync-monitor.php) before
 * invoking Pass A.
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
 * 🔴 DIE UNTERGRENZE EINES SCHRITTS -- und sie ist der Riegel gegen einen STILLSTAND, nicht eine
 * Feinjustierung.
 *
 * 💣 DER FALL, DEN SIE ABWENDET (gemessen am Livedump, 01.09.2026). Ein Dump-Schritt zieht den
 * Leser NEU auf und ueberspringt alles, was fruehere Schritte schon verbraucht haben -- bz2 ist
 * nicht springbar, der Strom muss jedes Mal ganz entpackt werden (die O(n^2)-Warnung steht an
 * avesmapsWikiDumpIteratePages). Die Zeitpruefung stand aber HINTER der ersten Seite:
 *
 *     foreach (Seiten ab Cursor) { verarbeiten; if (Zeit um) break; }
 *
 * Sobald das blosse Ueberspringen das Budget aufbraucht, verarbeitet ein Schritt damit GENAU EINE
 * Seite und setzt den Cursor um eins weiter. Der Lauf meldet keinen Fehler, er kommt nur nicht
 * mehr voran -- und das Ende des Dumps wird nie erreicht.
 *
 * 🔴 DAS TRIFFT AUSGERECHNET DEN NAMENSRAUM 222. Die inoffiziellen Seiten liegen im SCHWANZ des
 * Dumps: 3.938 der 6.457 (61 %) in den letzten 28.000 Seiten, „Inoffiziell:Apfeldorn" auf Platz
 * 251.382 von 252.902 (99,4 %). Gemeldet als „der Ort laesst sich im Wiki nicht zuweisen, er wird
 * nicht gefunden" -- und keine Zeile des Klassifizierers, des Parsers oder der Suche war schuld:
 * die Seite kam dort schlicht nie an.
 *
 * ⭐ WARUM EINE UNTERGRENZE REICHT UND NICHTS KOSTET. Der Sprung dominiert vollstaendig; die
 * zusaetzlich verarbeiteten Seiten sind fast umsonst. An derselben Datei gemessen (Sprung auf
 * Seite 240.000, dann N Seiten klassifizieren):
 *     N=0  8,64 s | N=500  8,83 s | N=2000  8,77 s | N=5000  8,88 s
 * Also rund 0,05 ms je Seite -- 2.000 Seiten kosten ein Zehntel einer Sekunde, waehrend sie den
 * Unterschied zwischen 1.500 Schritten und rund 27 ausmachen.
 *
 * 🔴 SIE LIEGT BEWUSST UNTER DEM SEITENBUDGET (500 gegen 2.000), UND DAS IST DER GANZE UNTERSCHIED
 * ZWISCHEN EINEM RIEGEL UND EINEM ZWEITEN FEHLER. Pass B fuehrt beide Grenzen
 * (bis zum 14.09.2026 auch Pass A). Waere die Untergrenze GLEICH dem Budget, faenden beide Bedingungen zur
 * selben Seitenzahl statt -- die Zeitpruefung waere wirkungslos, und ein Schritt liefe IMMER bis
 * 2.000 Seiten, egal wie lange er dazu braucht. Genau das Sicherheitsventil, das die 28 Sekunden
 * sein sollen, waere damit ausgebaut: ein ueberzogener Schritt laeuft auf STRATO in
 * max_execution_time, faellt hart aus, und der Cursor steht danach da, wo er vorher stand.
 * ⭐ So bleibt die Zeit die Hauptregel und die Menge nur ihr Boden: aus 1 Seite je Schritt werden
 * 500 (Faktor 500), und der Ueberzug betraegt hoechstens 500 Seiten -- nach der Messung oben rund
 * 0,03 s. Vom Stillstand bis zum Dumpende sind das Dutzende statt Tausender Schritte, und die
 * Oberflaeche laeuft sie ohnehin selbsttaetig durch.
 */
const AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES = 500;

/**
 * Darf ein Dump-Schritt jetzt aufhoeren? Zeit ist um UND die Untergrenze ist erreicht.
 *
 * 💣 SIE STEHT HIER UND WIRD VON JEDER DUMP-SCHLEIFE GERUFEN, statt je Schleife abgeschrieben zu werden:
 * dump-hybrid-read.php (Sammelphase), dump-hybrid-driver.php (Weiterleitungen), citymap-sync.php
 * (Kartenindex) und dump-entity-scan.php (Pass B); bis zum 14.09.2026 auch der nie gerufene
 * Pass-A-Lauf in dieser Datei. Alle ziehen den Dump per Seiten-Cursor neu auf und trugen denselben
 * Stillstand. Eine Regel, die einen von mehreren Erzeugern bindet, ist in diesem Haus keine Regel.
 *
 * ⚠️ Die OBERgrenze bleibt Sache des Aufrufers -- wer ein Seitenbudget fuehrt, prueft es weiterhin
 * selbst und VOR dieser Funktion. Sie beantwortet nur „ist der Schritt weit genug gekommen, um
 * aufzuhoeren?", nie „muss er aufhoeren?".
 */
function avesmapsWikiDumpStepDarfAnhalten(int $verarbeitet, float $frist): bool
{
    return $verarbeitet >= AVESMAPS_WIKI_DUMP_STEP_MIN_PAGES && microtime(true) >= $frist;
}

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
 *     'id'       => int,      // <page><id> -- die MediaWiki-Seitenkennung, 0 wenn sie fehlt
 *     'redirect' => ?string,  // <redirect title="..."/> target, or null
 *     'wikitext' => string,   // <revision><text> content (multi-line intact)
 *   ]
 *
 * ⭐ `id` ist seit dem 01.09.2026 dabei, und zwar fuer den Kategorie-Verbund: die Tabelle
 * `categorylinks` (offline.wiki-aventurica.de/dump/dump_categorylinks.sql.gz, seit dem
 * 01.09.2026 angeboten) haengt an `cl_from`, und das ist eine SEITENKENNUNG, kein Titel. Ohne
 * sie ist die Datei nicht anschliessbar -- und mit ihr faellt der Grund weg, warum
 * `dump-category-layer.php` rund 450 gedrosselte Zusatzabrufe fahren muss. Am Septemberdump
 * gemessen: alle 252.902 Seiten tragen eine.
 *
 * 💣 GENOMMEN WIRD DIE ERSTE `<id>` AUF SEITENEBENE, nie die aus `<revision>`. Beide heissen
 * `<id>`; wer nicht auf `$inRevision` achtet, speichert die Revisionskennung und verbindet
 * damit gegen nichts -- ein Fehler, der erst beim ersten Kategorie-Abgleich auffiele.
 *
 * Only one page is held in memory at a time; nothing is accumulated. Uses the
 * XMLReader pull API (read()/name/nodeType), never DOM/SimpleXML.
 *
 * Skip-to-cursor resume: the first $skipPages <page> elements are counted and
 * JUMPED via XMLReader::next() -- their subtree (crucially the multi-kilobyte
 * <text> revision body) is never parsed; only the opening <page> tags are counted
 * to advance the cursor. Then up to $maxPages pages are fully parsed and yielded.
 * This supports the "reopen-from-start, skip N, process the next batch" resume
 * model, since XMLReader is not seekable and bz2 is not byte-seekable. Parsing the
 * skipped bodies was pure waste and the dominant cost of the resume: reopen+skip is
 * inherently O(n^2) over the dump (a later step re-skips everything the earlier
 * steps already consumed), so the skip must be a tag-scan, never a body-read.
 *
 * @param int      $skipPages number of leading <page> elements to skip (cursor).
 * @param int|null $maxPages  max pages to yield after skipping (null = no limit).
 *
 * @return \Generator<int, array{title:string, ns:int, id:int, redirect:?string, wikitext:string}>
 */
function avesmapsWikiDumpIteratePages(XMLReader $reader, int $skipPages = 0, ?int $maxPages = null): \Generator
{
    if ($skipPages < 0) {
        $skipPages = 0;
    }

    $seen = 0;     // total <page> elements encountered
    $yielded = 0;  // pages actually yielded (after skipping)

    // Drive the cursor by hand instead of a plain while($reader->read()) so a
    // SKIPPED page can be jumped with next() -- which discards its whole subtree,
    // INCLUDING the <text> body, unread -- while a yielded page is still fully
    // parsed. next() already leaves the reader on the FOLLOWING node, so that
    // branch must NOT read() again; the yield branch leaves the reader on </page>
    // (avesmapsWikiDumpReadPageElement stops there) and read()s past it.
    if (!$reader->read()) {
        return;
    }

    while (true) {
        if ($reader->nodeType !== XMLReader::ELEMENT || $reader->localName !== 'page') {
            if (!$reader->read()) {
                return;
            }
            continue;
        }

        $seen++;

        if ($seen <= $skipPages) {
            // Already-processed page (cursor): count it, then jump its entire
            // subtree UNREAD. This is the O(n^2) hot path of every resumed step --
            // parsing the skipped <text> bodies here was the dominant cost and, on
            // a late step that skips almost the whole dump, what tipped the request
            // over STRATO's per-request worker kill.
            if (!$reader->next()) {
                return; // no node after this subtree -> stream exhausted
            }
            continue; // reader is already on the next node -> do NOT read() again
        }

        yield avesmapsWikiDumpReadPageElement($reader);
        $yielded++;

        if ($maxPages !== null && $yielded >= $maxPages) {
            return;
        }

        // avesmapsWikiDumpReadPageElement left the reader on </page>; step past it.
        if (!$reader->read()) {
            return;
        }
    }
}

/**
 * Parse a single <page> subtree, with the reader positioned on the opening
 * <page> element. Advances the reader to the matching </page>. Reads:
 *   - the first <title> text,
 *   - the first <ns> text (as int),
 *   - the first <id> text on PAGE level (as int) -- see the trap below,
 *   - the <redirect title="..."/> attribute (if present),
 *   - the first <revision>'s <text> content.
 *
 * Uses depth tracking so a nested <text> (revision text) is captured while an
 * unrelated element named "text" elsewhere would not be. Constant memory: only
 * the five scalar fields of this one page are retained.
 *
 * @return array{title:string, ns:int, id:int, redirect:?string, wikitext:string}
 */
function avesmapsWikiDumpReadPageElement(XMLReader $reader): array
{
    $title = '';
    $ns = 0;
    $pageId = 0;
    $redirect = null;
    $wikitext = '';

    $haveTitle = false;
    $haveNs = false;
    $haveId = false;
    $haveText = false;
    $inRevision = false;

    // An empty <page/> (shouldn't occur in a real dump, but be defensive).
    if ($reader->isEmptyElement) {
        return ['title' => $title, 'ns' => $ns, 'id' => $pageId, 'redirect' => $redirect, 'wikitext' => $wikitext];
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

            // 💣 `<id>` GIBT ES MEHRFACH je Seite: auf Seitenebene (die Seitenkennung, an der
            // `categorylinks.cl_from` haengt), in `<revision>` (die Revisionskennung), in
            // `<contributor>` (die Benutzerkennung) und in `<upload>` (die des Hochladers). Sie
            // sehen im Strom identisch aus.
            //
            // 🔴 DER RIEGEL IST DIE TIEFE, KEINE SPERRLISTE. Der erste Anlauf zaehlte die
            // bekannten Behaelter einzeln auf (`!$inRevision`, spaeter `!$inUpload`) -- eine
            // Mutationsprobe hat gezeigt, dass damit `<logitem><id>` und ein `<contributor>`
            // direkt unter `<page>` durchrutschen und als Seitenkennung gelten. Die
            // Seitenkennung ist das, was GENAU EINE Ebene unter `<page>` steht; alles Tiefere
            // gehoert jemand anderem. Diese Fassung ist gegen jedes kuenftige Behaelterelement
            // des Exportschemas immun, ohne dass jemand die Liste nachfuehren muss.
            case 'id':
                if ($reader->depth === $pageDepth + 1 && !$haveId) {
                    $pageId = (int) avesmapsWikiDumpReadElementText($reader);
                    $haveId = true;
                }
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

    return ['title' => $title, 'ns' => $ns, 'id' => $pageId, 'redirect' => $redirect, 'wikitext' => $wikitext];
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

/**
 * Read the raw `redirect` target string off a dump-reader page array (as
 * produced by avesmapsWikiDumpIteratePages() / avesmapsWikiDumpReadPageElement()),
 * or null if the page has no redirect target. This is exactly the
 * `is_string($target) && $target !== ''` guard that was inline-duplicated at
 * several Pass-A/Pass-B/hybrid call sites; it does NO normalization or slugging
 * -- callers that need avesmapsWikiSyncMonitorNormalizeTitle() or a wiki_key
 * still apply that themselves afterward, unchanged.
 *
 * NOT used for the XMLReader `<redirect title="...">` ATTRIBUTE read inside
 * avesmapsWikiDumpReadPageElement() (this file, above) -- that site reads
 * `$reader->getAttribute('title')` off an XMLReader, not a `$page['redirect']`
 * array field, so it is a different input shape and is left as-is.
 *
 * @param array{title?:string, ns?:int, redirect?:?string, wikitext?:string} $page
 */
function avesmapsWikiDumpPageRedirectTarget(array $page): ?string
{
    $target = $page['redirect'] ?? null;

    return (is_string($target) && $target !== '') ? $target : null;
}

// ===========================================================================
// 4. Pass A -- redirect alias extraction (PURE collect).
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
        $target = avesmapsWikiDumpPageRedirectTarget($page);
        if ($target === null) {
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
