<?php

declare(strict_types=1);

/**
 * Unit test for the deterministic ASCII fold (avesmapsFoldToAscii).
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *   The `wiki_key` / match-key derivations used to hand the transliteration of
 *   non-ASCII characters to iconv('UTF-8','ASCII//TRANSLIT//IGNORE', ...). That
 *   is LIBC-dependent, not PHP-dependent: the same name produced different keys
 *   on the dev machine and on STRATO. Nothing was broken -- everything that
 *   writes AND reads those keys runs on the server, so the stored keys were
 *   self-consistent -- but a PHP or system-library change on STRATO would have
 *   silently changed the form of every key carrying a special character and
 *   broken every join without an error.
 *
 *   avesmapsFoldToAscii() replaces iconv with a fixed table. This test pins that
 *   table down over the COMPLETE character repertoire of the live data set.
 *
 * THE TABLE REPRODUCES THE SERVER, NOT THE DEV MACHINE -- READ BEFORE "FIXING"
 *   'ü' folds to '?', NOT to 'u' and not to 'ue'. That looks lossy and ugly
 *   ("Fürstentum Kosch" -> wiki:f-rstentum-kosch), and it is. It is also what
 *   production has stored since day one, measured, not assumed:
 *
 *     hypothesis                          matches  misses   (1384 live rows)
 *     latin ligatures + '?' for the rest     1384       0
 *     dev machine  ('ü' -> '"u')             1198     186
 *     base letter survives ('ü' -> 'u')      1198     186
 *
 *   Making the fold "nicer" here rewrites the form of every umlaut-bearing key
 *   and breaks every join that uses one. If you want prettier keys, that is a
 *   data migration, not an edit to this table. See
 *   docs/superpowers/specs/2026-07-24-wiki-key-deterministische-transliteration-design.md
 *
 * WHAT THE TABLE HAS TO GET RIGHT
 *   Every caller runs `[^a-z0-9]+` over the fold's output afterwards, so an
 *   entry only changes the result if its output contains [a-z0-9]. '«' -> '<<'
 *   and '«' -> '?' are indistinguishable after that pass; 'æ' -> 'ae' and
 *   'æ' -> '?' are not. Hence: the latin ligature family is spelled out, and
 *   every other non-ASCII codepoint folds to a single '?'.
 *
 * HOW TO RUN
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       -d extension=php_curl.dll tools/wikidump/test-ascii-fold.php
 *
 * Exit code: 0 iff every case passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 0. Preconditions.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the fold requires mb_str_split()/mb_ord().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}

$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
$foldPath = $repoRoot . '/api/_internal/text/ascii-fold.php';
if (!is_file($foldPath)) {
    fwrite(STDERR, "FATAL: library not found: {$foldPath}\n");
    exit(2);
}
require $foldPath;

if (!function_exists('avesmapsFoldToAscii')) {
    fwrite(STDERR, "FATAL: expected function avesmapsFoldToAscii() was not defined by the included library.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Banner. Deliberately prints the FOLD, not iconv: after this change the
//    derivation no longer depends on the environment, and the banner should say
//    so rather than record a machine-specific artifact.
// ---------------------------------------------------------------------------
$sample = 'Köln Ärger Übel Fürstentum';
echo "================================================================\n";
echo " deterministic ASCII fold (avesmapsFoldToAscii)\n";
echo "================================================================\n";
echo 'PHP version     : ' . PHP_VERSION . "\n";
echo 'mbstring loaded : ' . (extension_loaded('mbstring') ? 'yes' : 'no') . "\n";
echo 'iconv present   : ' . (function_exists('iconv') ? 'yes (unused by the fold)' : 'no (irrelevant)') . "\n";
echo "fold sample     : '{$sample}'\n";
echo "                = '" . avesmapsFoldToAscii($sample) . "'\n";
echo "NOTE: this is environment-INDEPENDENT by construction and reproduces the\n";
echo "      STRATO form the live keys are stored in (1384/1384 rows verified).\n";
echo "----------------------------------------------------------------\n\n";

// ---------------------------------------------------------------------------
// 2. Tiny assertion harness (no framework in this repo).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

/**
 * @param string $label    human-readable case name
 * @param string $expected hand-derived literal (never the function's own output)
 * @param string $actual   value produced by the real fold
 * @param string $why      one-line note: which rule produced $expected
 */
$check = static function (string $label, string $expected, string $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-44s -> %-16s | %s\n", $label, "'{$actual}'", $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-44s | %s\n", $label, $why);
    printf("     |   expected: '%s'\n", $expected);
    printf("     |   actual  : '%s'\n", $actual);
};

/** Assert a single codepoint folds to '?' -- the rule for everything non-ligature. */
$checkDropped = static function (string $label, string $char) use ($check): void {
    $check(
        $label . ' (U+' . strtoupper(str_pad(dechex(mb_ord($char, 'UTF-8')), 4, '0', STR_PAD_LEFT)) . ')',
        '?',
        avesmapsFoldToAscii($char),
        'no alphanumeric translit -> single replacement char'
    );
};

// ===========================================================================
// A. The latin ligature family -- the ONLY entries whose output carries [a-z0-9].
// ===========================================================================
echo "-- A: ligature family (the only result-relevant entries) --\n";

$check('sharp s',      'ss',  avesmapsFoldToAscii("\u{00DF}"), 'ligature family');
$check('aesc lower',   'ae',  avesmapsFoldToAscii("\u{00E6}"), 'MEASURED: Horasiat Hældingard -> wiki:horasiat-haeldingard');
$check('aesc upper',   'AE',  avesmapsFoldToAscii("\u{00C6}"), 'ligature family (upper)');
$check('oe lower',     'oe',  avesmapsFoldToAscii("\u{0153}"), 'ligature family');
$check('oe upper',     'OE',  avesmapsFoldToAscii("\u{0152}"), 'ligature family (upper)');
$check('ff ligature',  'ff',  avesmapsFoldToAscii("\u{FB00}"), 'ligature family');
$check('fi ligature',  'fi',  avesmapsFoldToAscii("\u{FB01}"), 'ligature family');
$check('fl ligature',  'fl',  avesmapsFoldToAscii("\u{FB02}"), 'ligature family');
$check('ffi ligature', 'ffi', avesmapsFoldToAscii("\u{FB03}"), 'ligature family');
$check('ffl ligature', 'ffl', avesmapsFoldToAscii("\u{FB04}"), 'ligature family');

// ===========================================================================
// B. Words, in the exact shape the derivations feed the fold (already lowercased).
//    These are the cases that used to differ between dev machine and server.
// ===========================================================================
echo "\n-- B: whole words (the six cases that were red on STRATO) --\n";

$check('u umlaut in a word', 'f?rstentum kosch', avesmapsFoldToAscii('fürstentum kosch'), 'SERVER form: the base letter is LOST');
$check('o umlaut in a word', 'k?nigreich',       avesmapsFoldToAscii('königreich'),       'SERVER form');
$check('a umlaut in a word', '?rger',            avesmapsFoldToAscii('ärger'),            'SERVER form');
$check('all three umlauts',  '???',              avesmapsFoldToAscii('äöü'),              'one mark each, no base letters');
$check('leading umlaut',     '?ber den wolken',  avesmapsFoldToAscii('über den wolken'),  'SERVER form, word-initial');
$check('sharp s in a word',  'reichsstrasse',    avesmapsFoldToAscii('reichsstraße'),     'ligature family inside a word');

// ===========================================================================
// C. The COMPLETE non-ASCII repertoire of the live data set.
//    Measured 2026-07-24 over the full public payload (GET /api/app/map-features.php,
//    /api/app/political-territory-wiki.php, /api/app/game-literature.php): 45 distinct
//    codepoints. Every one of them lands here, so a future table edit cannot
//    silently change a character that actually occurs in the data.
//    'ß' and 'æ' are the only two with an alphanumeric translit -- they are in
//    section A above; the remaining 43 all fold to '?'.
// ===========================================================================
echo "\n-- C: every non-ASCII codepoint present in the live data --\n";

foreach ([
    // German umlauts (by far the most frequent)
    'u umlaut'            => "\u{00FC}", // ü
    'a umlaut'            => "\u{00E4}", // ä
    'o umlaut'            => "\u{00F6}", // ö
    'U umlaut upper'      => "\u{00DC}", // Ü
    'A umlaut upper'      => "\u{00C4}", // Ä
    'O umlaut upper'      => "\u{00D6}", // Ö
    // circumflex / acute / grave / diaeresis
    'o circumflex'        => "\u{00F4}", // ô
    'u circumflex'        => "\u{00FB}", // û
    'a circumflex'        => "\u{00E2}", // â
    'i circumflex'        => "\u{00EE}", // î
    'e circumflex'        => "\u{00EA}", // ê
    'E circumflex upper'  => "\u{00CA}", // Ê
    'a acute'             => "\u{00E1}", // á
    'e acute'             => "\u{00E9}", // é
    'i acute'             => "\u{00ED}", // í
    'o acute'             => "\u{00F3}", // ó
    'u acute'             => "\u{00FA}", // ú
    'a grave'             => "\u{00E0}", // à
    'e grave'             => "\u{00E8}", // è
    'i diaeresis'         => "\u{00EF}", // ï
    'e diaeresis'         => "\u{00EB}", // ë
    'y diaeresis'         => "\u{00FF}", // ÿ
    'u breve'             => "\u{016D}", // ŭ
    // punctuation and symbols
    'rightwards arrow'    => "\u{2192}", // →
    'middle dot'          => "\u{00B7}", // ·
    'en dash'             => "\u{2013}", // –
    'em dash'             => "\u{2014}", // —
    'horizontal ellipsis' => "\u{2026}", // …
    'low double quote'    => "\u{201E}", // „
    'left double quote'   => "\u{201C}", // “
    'left single quote'   => "\u{2018}", // ‘
    'right single quote'  => "\u{2019}", // ’
    'acute accent'        => "\u{00B4}", // ´
    'left guillemet'      => "\u{00AB}", // «
    'right guillemet'     => "\u{00BB}", // »
    'degree sign'         => "\u{00B0}", // °
    // invisible / formatting
    'no-break space'      => "\u{00A0}",
    'left-to-right mark'  => "\u{200E}",
    'variation selector'  => "\u{FE0F}",
    // emoji used as map marker glyphs
    'house with garden'   => "\u{1F3E1}", // 🏡
    'houses'              => "\u{1F3D8}", // 🏘
    'european castle'     => "\u{1F3F0}", // 🏰
    'classical building'  => "\u{1F3DB}", // 🏛
    'church'              => "\u{26EA}",  // ⛪
] as $label => $char) {
    $checkDropped($label, $char);
}

// ===========================================================================
// D. Invariants the callers depend on.
// ===========================================================================
echo "\n-- D: invariants --\n";

$check('pure ASCII passes through', 'Angbar-1 (Kosch)', avesmapsFoldToAscii('Angbar-1 (Kosch)'), 'ASCII is never touched');
$check('empty string',              '',                 avesmapsFoldToAscii(''),                  'empty in, empty out');
$check('idempotent on its output',  'f?rstentum',       avesmapsFoldToAscii(avesmapsFoldToAscii('fürstentum')), 'folding twice changes nothing');

// EXACTLY ONE replacement character per codepoint. Load-bearing: the callers'
// `[^a-z0-9]+` collapses RUNS, so emitting two marks where the server emits one
// is invisible mid-string but changes trim($slug, '-') at the edges.
$check('one mark per codepoint',    'a?b',              avesmapsFoldToAscii('aüb'),               'exactly ONE mark per dropped codepoint');
$check('two codepoints, two marks', 'a??b',             avesmapsFoldToAscii('aüöb'),              'no run collapsing inside the fold');
$check('leading and trailing',      '?a?',              avesmapsFoldToAscii('üaö'),               'edges matter for trim($slug, "-")');

// A decomposed umlaut is 'u' + U+0308: the base letter is ASCII and survives,
// the combining mark does not. Same shape iconv produced.
$check('decomposed umlaut',         'u?',               avesmapsFoldToAscii("u\u{0308}"),         'combining mark folds, ASCII base survives');

// ===========================================================================
// E. The two transient callers that can be included stand-alone.
//    (The third, avesmapsNormalizeSearchText() in api/app/map-search.php, lives
//    in an endpoint file that executes on include and cannot be unit-tested
//    without refactoring it -- out of scope here. It pre-maps ä/ö/ü itself, so
//    the fold only ever sees residual accents there, exactly as below.)
// ===========================================================================
echo "\n-- E: transient callers --\n";

require $repoRoot . '/api/_internal/political/wiki-browser-support.php';
require $repoRoot . '/api/_internal/political/territories-read.php';

foreach (['makeStableKey', 'avesmapsPoliticalNormalizeHierarchyRootKey'] as $requiredFn) {
    if (!function_exists($requiredFn)) {
        fwrite(STDERR, "FATAL: expected function {$requiredFn}() was not defined by the included libraries.\n");
        exit(2);
    }
}

// makeStableKey maps ä/ö/ü -> ae/oe/ue ITSELF, before the fold. So for umlauts
// it is a genuine no-op: identical before and after this change, on both
// machines. Pinned so a later "cleanup" cannot quietly route umlauts through
// the fold here and turn 'fuerstentum-kosch' into 'f-rstentum-kosch'.
$check(
    'stable key, umlaut pre-mapped',
    'fuerstentum-kosch',
    makeStableKey('Fürstentum Kosch'),
    'ue is pre-mapped -> the fold never sees it (NO-OP)'
);

// ô is NOT in makeStableKey's pre-map, so it does reach the fold. This is the
// case that differed: dev machine produced 'c-ote-d-or', STRATO 'c-te-d-or'.
$check(
    'stable key, residual accent',
    'c-te-d-or',
    makeStableKey("C\u{00F4}te d\u{2019}Or"),
    "o-circumflex reaches the fold -> '?' -> hyphen (the SERVER's form)"
);

// This one is why api/_internal/political/territories-read.php:1095 lists BOTH
// 'unabhangig' AND 'unabhngig': someone hit the two libc forms and defended
// against them without naming the cause.
$check(
    'root key, umlaut',
    'unabhngig',
    avesmapsPoliticalNormalizeHierarchyRootKey('unabhängig'),
    "SERVER form -- the reason line 1095 carries both spellings"
);

$check(
    'root key, second both-forms entry',
    'ungeklrt',
    avesmapsPoliticalNormalizeHierarchyRootKey('ungeklärt'),
    'same, for the other hard-coded root key'
);

// ---------------------------------------------------------------------------
// 3. Summary + exit code.
// ---------------------------------------------------------------------------
$total = $passCount + $failCount;
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d/%d passing (%d failing)\n", $passCount, $total, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
