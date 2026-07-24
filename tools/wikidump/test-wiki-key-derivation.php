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
 * THE UMLAUT ("swallow") QUIRK -- THE WHOLE POINT, and no longer environment-
 * dependent.
 *   Neither scheme maps oe/ae/ue for German umlauts explicitly (only sz/ligature
 *   chars are in the explicit str_replace: ss/ae/oe/o/d/th for ss/aesc/oe-lig/
 *   slash-o/eth/thorn). The fate of oe/ae/ue therefore falls to the ASCII fold.
 *
 *   Until 2026-07-24 that fold was iconv('UTF-8','ASCII//TRANSLIT//IGNORE', ...),
 *   whose umlaut handling is LIBC-dependent -- so this test passed 22/22 on the
 *   dev machine and 16/22 on STRATO, having frozen the dev machine's artifact
 *   ('ue' -> '"u') as the expectation. It now calls avesmapsFoldToAscii()
 *   (api/_internal/text/ascii-fold.php), which is a fixed table:
 *
 *   - Umlauts and accented letters fold to a single '?'. The BASE LETTER IS
 *     LOST: the slug scheme turns the '?' into a hyphen ('f-rstentum-kosch'),
 *     the match-key scheme drops it in the final non-[a-z0-9] pass
 *     ('frstentumkosch'). The German digraph (ue/oe/ae) never appears.
 *   - 'aesc' and the other latin ligatures keep their alphanumeric expansion.
 *
 *   That is the SERVER's form, not a prettier one: it reproduces what production
 *   has stored since day one, verified against 1384 of 1384 live territory rows.
 *   Making it "nicer" here would silently change the key of every umlaut-bearing
 *   row. The expectations below are hand-derived from that table, and they now
 *   hold in BOTH environments -- which is the whole point of the change.
 *   See docs/superpowers/specs/2026-07-24-wiki-key-deterministische-transliteration-design.md
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

foreach (['avesmapsPoliticalBuildWikiKey', 'avesmapsPoliticalSlug', 'avesmapsWikiSyncCreateMatchKey', 'avesmapsFoldToAscii'] as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by the included libraries.\n");
        exit(2);
    }
}

// ---------------------------------------------------------------------------
// 2. Diagnostic banner -- records the fold's behavior so a future reader can
//    tell WHY the umlaut rows expect what they expect. It prints the FOLD, not
//    iconv: the derivation no longer depends on the environment, and a banner
//    recording a machine-specific artifact is what made this test lie before.
// ---------------------------------------------------------------------------
$umlautSampleIn = 'Köln Ärger Übel Fürstentum';
$umlautSampleOut = avesmapsFoldToAscii($umlautSampleIn);

echo "================================================================\n";
echo " wiki_key derivation characterization test (invariant I1)\n";
echo "================================================================\n";
echo 'PHP version        : ' . PHP_VERSION . "\n";
echo 'mbstring loaded    : ' . (extension_loaded('mbstring') ? 'yes' : 'no') . "\n";
echo 'iconv present      : ' . (function_exists('iconv') ? 'yes (unused by the derivation)' : 'no (irrelevant)') . "\n";
echo "fold umlaut sample : avesmapsFoldToAscii(\n";
echo "                       '{$umlautSampleIn}')\n";
echo "                   = '{$umlautSampleOut}'\n";
echo "NOTE: the fold is a fixed table, so umlaut (oe/ae/ue) outcomes are the same\n";
echo "      on every machine. Expectations below are hand-derived from that table\n";
echo "      and reproduce the form the LIVE keys are stored in (verified against\n";
echo "      1384 of 1384 production territory rows on 2026-07-24).\n";
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
//     'Fürstentum Kosch'; ü -fold-> '?'; '?' and space -> '-' => 'f-rstentum-kosch'.
//     This is the key production actually stores -- spot-check:
//     GET /api/app/territory-detail.php?wiki_key=wiki:f-rstentum-kosch returns Kosch.
$check(
    'wiki: URL, encoded umlaut + underscore (Fuerstentum Kosch)',
    'wiki:f-rstentum-kosch', // rawurldecode + '_'->' ' + umlaut -> '?' -> '-' + space -> '-'
    avesmapsPoliticalBuildWikiKey('https://de.wiki-aventurica.de/wiki/F%C3%BCrstentum_Kosch', 'Fürstentum Kosch'),
    "underscore->space, umlaut '?'->hyphen (base letter lost)"
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
    'name:f-rstentum-kosch', // 'name:' + slug: space->'-', ü '?'->'-'
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
    'frstentumkosch', // space removed by separator regex; ü -> '?' -> final regex drops it, base letter gone
    avesmapsWikiSyncCreateMatchKey('Fürstentum Kosch'),
    "space + umlaut VANISH (contrast slug 'f-rstentum-kosch')"
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

// (q) umlaut ö inside a word -- it vanishes entirely, base letter included.
$check(
    'match key, umlaut mid-word (Koenigreich)',
    'knigreich', // 'Königreich' -> ö '?' -> final regex drops it => no 'o' at all
    avesmapsWikiSyncCreateMatchKey('Königreich'),
    "ö vanishes (neither 'oe' nor 'o' appears)"
);

// (r) underscores collapse to nothing (separator class) + leading umlaut vanishes.
$check(
    'match key, underscores + umlaut (Ueber den Wolken)',
    'berdenwolken', // '_' in separator class -> removed; leading Ü -> '?' -> dropped
    avesmapsWikiSyncCreateMatchKey('Über_den_Wolken'),
    "underscores removed; word-initial umlaut leaves nothing behind"
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

// (u) all-umlaut word -> NOTHING survives. The starkest illustration of the
//     server's fold: a title made only of umlauts keys to the empty string, so
//     'ÄÖÜ' and 'ÖÄÜ' collide. That is pre-existing live behaviour, not new.
$check(
    'match key, all umlauts (aeoeue)',
    '', // 'äöü' -> '???' -> final regex drops all three => empty key
    avesmapsWikiSyncCreateMatchKey('ÄÖÜ'),
    "ä/ö/ü all vanish -> empty key (no digraph, no base letter)"
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
