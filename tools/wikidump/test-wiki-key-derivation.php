<?php

declare(strict_types=1);

/**
 * Characterization test for the `wiki_key` / match-key derivation (invariant I1).
 * ---------------------------------------------------------------------------
 * This is the FOUNDATION of the WikiDump migration. The upcoming offline
 * dump-reader MUST derive the `wiki_key` (the identity anchor between a DB row
 * and its Wiki page) bit-for-bit identically to the current online crawler.
 * If the derivation drifts by a single character, DB rows silently stop
 * matching their Wiki page -> data / hierarchy / routing breakage.
 *
 * This test does NOT build the dump-reader. It pins down (freezes) the EXISTING
 * derivation so the later reader can reuse it verbatim, and fails loudly if the
 * behavior ever changes. It reproduces current behavior exactly -- including
 * quirks that look like latent bugs. Reproduce, never "improve".
 *
 * TWO SCHEMES, kept strictly separate (do not conflate them):
 *
 *   1. TERRITORIES -- avesmapsPoliticalBuildWikiKey() -> avesmapsPoliticalSlug()
 *      (api/_internal/political/territory.php). Non-[a-z0-9] runs collapse to a
 *      HYPHEN '-'. Prefix is `wiki:` when a wiki URL is supplied (slug of the
 *      `/wiki/<Page>` path segment, `_`->space first), else `name:` (slug of
 *      the raw name). NOTE: the slug does NOT strip a "(Suffix)" parenthetical
 *      -- the parens just become hyphens.
 *
 *   2. SETTLEMENTS / REGIONS / PATHS -- avesmapsWikiSyncCreateMatchKey()
 *      -> avesmapsWikiSyncCreateMatchKeyInternal() (api/_internal/wiki/sync.php).
 *      Strips a trailing "(Suffix)" parenthetical, then removes EVERY separator
 *      and non-[a-z0-9] char -- i.e. they VANISH, no hyphen. So a space becomes
 *      `-` in the territory slug but disappears entirely in the match key.
 *
 * THE UMLAUT ("swallow") QUIRK -- THE WHOLE POINT, and environment-dependent.
 *   Neither scheme maps oe/ae/ue for German umlauts explicitly (only sz/ligature
 *   chars are in the explicit str_replace: ss/ae/oe/o/d/th for ss/aesc/oe-lig/
 *   slash-o/eth/thorn). The fate of oe/ae/ue therefore falls to
 *   iconv('UTF-8','ASCII//TRANSLIT//IGNORE', ...) and is LOCALE/BUILD-DEPENDENT:
 *   - A "clean" glibc iconv typically yields the bare base letter (o/a/u).
 *   - This Windows PHP 8.5 build emits an artifact: it prepends a literal
 *     double-quote to the base letter (ue -> ["u], oe -> ["o], ae -> ["a]).
 *     The slug scheme turns that '"' into a hyphen; the match-key scheme drops
 *     it in the final non-[a-z0-9] pass. Either way the base letter survives and
 *     the German digraph (ue/oe/ae) does NOT appear.
 *   - If iconv were unavailable/failing, //IGNORE + the final regex would drop
 *     the char entirely (e.g. "Koeln" -> "koln" or "kln").
 *
 *   Because this is environment-dependent, the umlaut expectations below are
 *   hand-derived against THIS runtime's observed iconv behavior (printed in the
 *   diagnostic banner), NOT by asserting the function equals itself. The
 *   AUTHORITATIVE cross-check against real STRATO-derived DB `wiki_key` values
 *   happens later in the migration's compare-test (assert A1); STRATO's own
 *   iconv behavior is verified in Task 2. If STRATO's iconv differs from this
 *   box, the umlaut rows here may need re-deriving -- that is expected and is
 *   exactly why the diagnostic banner records the local iconv sample.
 *
 * DEPENDENCIES / HOW TO RUN
 *   The production functions call mb_strtolower()/mb_substr(), so the mbstring
 *   extension must be loaded. On a bare Windows CLI it often is not; load it for
 *   just this run without touching php.ini:
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-wiki-key-derivation.php
 *
 *   (If mbstring is compiled in / enabled globally, a plain
 *    `php tools/wikidump/test-wiki-key-derivation.php` works too.)
 *
 * Minimal include chain (found via TDD): the two library files ONLY. They are
 * side-effect-free on include (constants + function definitions, no require, no
 * DB, no headers) -- diagnostics/political-schema.php includes territory.php the
 * same way. No bootstrap.php is needed.
 *
 * Exit code: 0 iff every case passes; non-zero otherwise (so CI/later steps can
 * gate on it).
 */

// ---------------------------------------------------------------------------
// 0. Preconditions: the production functions need mbstring. Fail loudly, early.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the derivation functions require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Minimal include chain: the two real library files, nothing else.
//    (No bootstrap, no DB, no headers -- verified side-effect-free on include.)
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';

foreach (['avesmapsPoliticalBuildWikiKey', 'avesmapsPoliticalSlug', 'avesmapsWikiSyncCreateMatchKey'] as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by the included libraries.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 2. Diagnostic banner -- records the environment-dependent iconv behavior so a
//    future reader can tell WHY the umlaut rows expect what they expect.
// ---------------------------------------------------------------------------
$iconvAvailable = function_exists('iconv');
$umlautSampleIn = 'Köln Ärger Übel Fürstentum';
$umlautSampleOut = $iconvAvailable
    ? (static function (string $s): string {
        $r = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        return is_string($r) ? $r : '(iconv returned false)';
    })($umlautSampleIn)
    : '(iconv unavailable)';

echo "================================================================\n";
echo " wiki_key derivation characterization test (invariant I1)\n";
echo "================================================================\n";
echo 'PHP version        : ' . PHP_VERSION . "\n";
echo 'mbstring loaded    : ' . (extension_loaded('mbstring') ? 'yes' : 'no') . "\n";
echo 'iconv available    : ' . ($iconvAvailable ? 'yes' : 'no') . "\n";
echo "iconv umlaut sample: iconv('UTF-8','ASCII//TRANSLIT//IGNORE',\n";
echo "                       '{$umlautSampleIn}')\n";
echo "                   = '{$umlautSampleOut}'\n";
echo "NOTE: umlaut (oe/ae/ue) outcomes are iconv/locale-dependent. Expectations\n";
echo "      below are hand-derived against THIS runtime. The authoritative\n";
echo "      cross-check vs. real STRATO DB values is the later compare-test\n";
echo "      (assert A1); STRATO iconv is verified in Task 2.\n";
echo "----------------------------------------------------------------\n\n";

// ---------------------------------------------------------------------------
// 3. Tiny assertion harness (no framework in this repo).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

/**
 * @param string $label       human-readable case name
 * @param string $expected    hand-derived literal (never the function's own output)
 * @param string $actual      value produced by the real derivation function
 * @param string $why         one-line note: which transformation produced $expected
 */
$check = static function (string $label, string $expected, string $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-46s -> %-22s | %s\n", $label, "'{$actual}'", $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-46s | %s\n", $label, $why);
    printf("     |   expected: '%s'\n", $expected);
    printf("     |   actual  : '%s'\n", $actual);
};

// ===========================================================================
// SCHEME 1 -- TERRITORIES: avesmapsPoliticalBuildWikiKey / avesmapsPoliticalSlug
//   Non-[a-z0-9] runs -> HYPHEN. `wiki:` from URL path (`_`->space), else `name:`.
// ===========================================================================
echo "-- Scheme 1: territory wiki_key (avesmapsPoliticalBuildWikiKey) --\n";

// (a) wiki: prefix from a plain URL, single ASCII word -> straight slug.
$check(
    'wiki: URL, simple ASCII (Mittelreich)',
    'wiki:mittelreich', // path 'Mittelreich' -> lower -> slug -> 'mittelreich'; URL present => 'wiki:'
    avesmapsPoliticalBuildWikiKey('https://de.wiki-aventurica.de/wiki/Mittelreich', 'Mittelreich'),
    "URL path slugged, 'wiki:' prefix"
);

// (b) wiki: from URL with percent-encoded umlaut + underscore -> space, then slug.
//     'F%C3%BCrstentum_Kosch' -rawurldecode-> 'Fürstentum_Kosch' -_->space->
//     'Fürstentum Kosch'; ü -iconv-> ["u]; '"' and space -> '-' => 'f-urstentum-kosch'.
$check(
    'wiki: URL, encoded umlaut + underscore (Fuerstentum Kosch)',
    'wiki:f-urstentum-kosch', // rawurldecode + '_'->' ' + umlaut '"u' artifact -> '-' + space -> '-'
    avesmapsPoliticalBuildWikiKey('https://de.wiki-aventurica.de/wiki/F%C3%BCrstentum_Kosch', 'Fürstentum Kosch'),
    "underscore->space, umlaut '\"u' artifact->hyphen"
);

// (c) wiki: from URL whose page has a parenthetical -- slug does NOT strip it;
//     parens become hyphens. 'Kosch_(Region)' -> 'Kosch (Region)' -> 'kosch-region'.
$check(
    'wiki: URL with parenthetical page (Kosch_(Region))',
    'wiki:kosch-region', // slug keeps '(Region)'; '_','(',')' + space all -> '-', trimmed
    avesmapsPoliticalBuildWikiKey('https://de.wiki-aventurica.de/wiki/Kosch_(Region)', 'Kosch'),
    "slug does NOT strip parenthetical; parens->hyphen"
);

// (d) wiki: from URL with an ampersand-joined name in the path.
//     'Nostria_&_Andergast' -> 'Nostria & Andergast' -> 'nostria-andergast'.
$check(
    'wiki: URL, ampersand path (Nostria & Andergast)',
    'wiki:nostria-andergast', // '&' + surrounding spaces collapse to a single hyphen
    avesmapsPoliticalBuildWikiKey('https://de.wiki-aventurica.de/wiki/Nostria_%26_Andergast', 'Nostria & Andergast'),
    "'&' run -> single hyphen"
);

// (e) name: fallback (empty URL) for a simple ASCII name.
$check(
    'name: fallback, simple ASCII (Mittelreich)',
    'name:mittelreich', // no URL => 'name:' + slug('Mittelreich')
    avesmapsPoliticalBuildWikiKey('', 'Mittelreich'),
    "no URL => 'name:' prefix (contrast with (a))"
);

// (f) name: fallback for a multi-word umlaut name -- same slug body as (b) but
//     different prefix, proving prefix selection is URL-driven.
$check(
    'name: fallback, multi-word umlaut (Fuerstentum Kosch)',
    'name:f-urstentum-kosch', // 'name:' + slug: space->'-', ü '"u' artifact->'-'
    avesmapsPoliticalBuildWikiKey('', 'Fürstentum Kosch'),
    "same slug body as (b), 'name:' prefix"
);

// (g) name: fallback exercising the slug's 'marktgrafschaft'->'markgrafschaft'
//     special-case rewrite (a real quirk of avesmapsPoliticalSlug).
$check(
    'name: fallback, marktgrafschaft rewrite',
    'name:markgrafschaft-test', // slug: 'Marktgrafschaft Test' -> 'marktgrafschaft-test' -> str_replace 'marktgrafschaft'->'markgrafschaft'
    avesmapsPoliticalBuildWikiKey('', 'Marktgrafschaft Test'),
    "slug rewrites 'marktgrafschaft'->'markgrafschaft'"
);

// ===========================================================================
// SCHEME 2 -- SETTLEMENTS / REGIONS / PATHS: avesmapsWikiSyncCreateMatchKey
//   Strip trailing "(Suffix)"; separators AND non-[a-z0-9] all VANISH (no hyphen).
// ===========================================================================
echo "\n-- Scheme 2: match key (avesmapsWikiSyncCreateMatchKey) --\n";

// (h) DIRECT CONTRAST with (b)/(f): same multi-word umlaut name, but here the
//     space and the umlaut artifact are REMOVED (not hyphenated) -> one token.
$check(
    'match key, multi-word umlaut (Fuerstentum Kosch)',
    'furstentumkosch', // space removed by separator regex; ü '"u' -> final regex drops '"' , keeps 'u'
    avesmapsWikiSyncCreateMatchKey('Fürstentum Kosch'),
    "space + umlaut artifact VANISH (contrast slug 'f-urstentum-kosch')"
);

// (i) parenthetical suffix is stripped before keying.
$check(
    'match key, parenthetical suffix (Kosch (Region))',
    'kosch', // ' (Region)' stripped, then 'kosch'
    avesmapsWikiSyncCreateMatchKey('Kosch (Region)'),
    "trailing '(Region)' stripped"
);

// (j) a DIFFERENT parenthetical suffix collapses to the SAME key as (i) --
//     shows the suffix content is discarded, not encoded.
$check(
    'match key, different suffix same base (Kosch (Grafschaft))',
    'kosch', // ' (Grafschaft)' stripped => same as (i)
    avesmapsWikiSyncCreateMatchKey('Kosch (Grafschaft)'),
    "any trailing '(...)' stripped => collides with (i)"
);

// (k) sharp-s: ß handled to 'ss' (here via iconv TRANSLIT; ß is NOT in the
//     explicit ligature str_replace, but TRANSLIT maps it to 'ss').
$check(
    'match key, sharp-s (Strasse)',
    'strasse', // 'ß' -> 'ss' (iconv TRANSLIT), no separators
    avesmapsWikiSyncCreateMatchKey('Straße'),
    "sharp-s -> 'ss'"
);

// (l) compound with sharp-s -- 'ß'->'ss', all one token.
$check(
    'match key, compound sharp-s (Reichsstrasse)',
    'reichsstrasse', // 'Reichsstraße' -> 'reichsstrasse'
    avesmapsWikiSyncCreateMatchKey('Reichsstraße'),
    "compound path name, 'ß'->'ss'"
);

// (m) plain ASCII settlement -- identity-ish (just lowercased).
$check(
    'match key, plain ASCII (Angbar)',
    'angbar', // already ASCII, just lowercased
    avesmapsWikiSyncCreateMatchKey('Angbar'),
    "plain ASCII, lowercase only"
);

// (n) acute-accent apostrophe (U+00B4) between letters is a SEPARATOR -> removed.
$check(
    'match key, acute-accent apostrophe (Al´Anfa)',
    'alanfa', // '´' (U+00B4) matched by separator regex -> removed
    avesmapsWikiSyncCreateMatchKey('Al´Anfa'),
    "U+00B4 acute in separator class -> removed"
);

// (o) curly right single quote (U+2019) as apostrophe -> removed.
$check(
    'match key, curly apostrophe (El’Gorm)',
    'elgorm', // U+2019 in separator class -> removed
    avesmapsWikiSyncCreateMatchKey('El’Gorm'),
    "U+2019 curly apostrophe -> removed"
);

// (p) straight ASCII apostrophe + hyphen both removed.
$check(
    "match key, ASCII apostrophe + hyphen (O'Brien-Test)",
    'obrientest', // U+0027 apostrophe and '-' both in separator class -> removed
    avesmapsWikiSyncCreateMatchKey("O'Brien-Test"),
    "ASCII apostrophe + hyphen removed"
);

// (q) umlaut ö at the START of a word -- artifact-then-base 'o' survives.
$check(
    'match key, leading umlaut (Koenigreich)',
    'konigreich', // 'Königreich' -> ö '"o' -> final regex drops '"', keeps 'o'
    avesmapsWikiSyncCreateMatchKey('Königreich'),
    "ö -> 'o' (digraph 'oe' does NOT appear)"
);

// (r) underscores collapse to nothing (separator class) + umlaut ü -> 'u'.
$check(
    'match key, underscores + umlaut (Ueber den Wolken)',
    'uberdenwolken', // '_' in separator class -> removed; ü -> 'u'
    avesmapsWikiSyncCreateMatchKey('Über_den_Wolken'),
    "underscores removed (contrast: territory '_'->space)"
);

// (s) parenthetical strip + sharp-s together.
$check(
    'match key, suffix + sharp-s (Neue Strasse (historisch))',
    'neuestrasse', // ' (historisch)' stripped; space removed; 'ß'->'ss'
    avesmapsWikiSyncCreateMatchKey('Neue Straße (historisch)'),
    "suffix stripped, space removed, 'ß'->'ss'"
);

// (t) ligature aesc explicitly mapped to 'ae' by the str_replace (NOT iconv path).
$check(
    'match key, aesc ligature (aesir)',
    'aesir', // 'æ' -> 'ae' via explicit str_replace
    avesmapsWikiSyncCreateMatchKey('Æsir'),
    "aesc ligature -> 'ae' (explicit str_replace)"
);

// (u) all-umlaut word -> all three base letters survive, no digraphs, no seps.
$check(
    'match key, all umlauts (aeoeue)',
    'aou', // 'äöü' -> each artifact '"x' -> final regex keeps base a/o/u only
    avesmapsWikiSyncCreateMatchKey('ÄÖÜ'),
    "ä/ö/ü -> a/o/u (all digraphs suppressed)"
);

// (v) STRIP-REGEX EDGE CASE (empirically discovered while writing this test):
//     the suffix-strip regex is /\s+\([^)]*\)\s*$/u -- it requires WHITESPACE
//     *before* the '('. But avesmapsWikiSyncStripParentheticalSuffixInternal()
//     runs trim() FIRST, so '  (Nur Suffix)' -> '(Nur Suffix)' has no leading
//     whitespace => the regex does NOT match => the parenthetical is KEPT, not
//     stripped. So a title that is *only* a parenthetical is preserved and keyed
//     as content. This looks surprising but is the current behavior (reproduce,
//     not fix). Contrast (i)/(j) where a real body precedes ' (Suffix)'.
$check(
    'match key, parenthetical-only NOT stripped (  (Nur Suffix))',
    'nursuffix', // trim->'(Nur Suffix)'; no leading \s => strip regex misses; parens+space removed => 'nursuffix'
    avesmapsWikiSyncCreateMatchKey('  (Nur Suffix)'),
    "strip regex needs leading \\s; trim removes it => suffix KEPT"
);

// ---------------------------------------------------------------------------
// 4. Summary + exit code.
// ---------------------------------------------------------------------------
$total = $passCount + $failCount;
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d/%d passing (%d failing)\n", $passCount, $total, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
