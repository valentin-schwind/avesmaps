<?php

declare(strict_types=1);

/**
 * Deterministic ASCII folding for the key derivations.
 * ---------------------------------------------------------------------------
 * Replaces iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', ...) everywhere a stable
 * key is derived from a name: `wiki_key` (avesmapsPoliticalSlug), the WikiSync
 * match key, the hierarchy root key, makeStableKey() and the search
 * normalisation.
 *
 * WHY iconv HAD TO GO
 *   //TRANSLIT is implemented by the C library, not by PHP. The same name
 *   produced different keys on different machines:
 *
 *     'Fürstentum Kosch'  ->  dev (Windows) 'f-urstentum-kosch'
 *                         ->  STRATO        'f-rstentum-kosch'
 *
 *   Nothing was broken by this: everything that writes AND reads these keys runs
 *   on the server, so the stored keys are self-consistent. The danger was the
 *   silent one -- if STRATO changed its PHP build or system library, the form of
 *   every key carrying a special character would change and every join using one
 *   would break with no error anywhere, the same failure shape as the DPL3->DPL4
 *   incident.
 *
 * 💣 THIS TABLE REPRODUCES THE SERVER, NOT THE "NICER" TRANSLITERATION
 *   'ü' folds to '?', NOT to 'u' and NOT to 'ue'. Downstream every caller runs
 *   `[^a-z0-9]+` over the result, so the '?' becomes a hyphen in the slug scheme
 *   and vanishes in the match-key scheme -- which is why the live keys read
 *   'f-rstentum-kosch' and 'bergk-nigreich-lorgolosch'. Ugly, and lossy, and
 *   correct: it is the form production has stored since day one. Measured
 *   2026-07-24 against every live territory row:
 *
 *     hypothesis                            matches   misses    (1384 rows)
 *     latin ligatures + '?' for the rest       1384         0
 *     dev machine       ('ü' -> '"u')          1198       186
 *     base letter survives ('ü' -> 'u')        1198       186
 *
 *   Changing 'ü' to fold to 'u' or 'ue' here silently changes the key of every
 *   umlaut-bearing row and breaks every join that uses one. Prettier keys are a
 *   data migration across ~10 tables, not an edit to this table.
 *
 * WHY THE TABLE IS THIS SHORT
 *   An entry only changes the outcome if its output contains [a-z0-9] -- after
 *   the callers' `[^a-z0-9]+` pass, '«' -> '<<' and '«' -> '?' are the same
 *   thing, while 'æ' -> 'ae' and 'æ' -> '?' are not. So only the latin ligature
 *   family needs spelling out; every other codepoint folds to a single '?'.
 *   The complete non-ASCII repertoire of the live data (45 codepoints) is
 *   asserted in tools/wikidump/test-ascii-fold.php -- 'ß' and 'æ' are the only
 *   two of them with an alphanumeric expansion.
 *
 *   Deliberately NOT included: symbol transliterations such as '©' -> '(C)' or
 *   '½' -> ' 1/2'. They occur nowhere in the data, and their exact glibc output
 *   is not known without measuring it -- a guessed row in the very table that
 *   exists because guessing went wrong here would be self-defeating.
 *
 * Design: docs/superpowers/specs/2026-07-24-wiki-key-deterministische-transliteration-design.md
 */

/**
 * The latin ligature family: the only characters whose transliteration is
 * alphanumeric, and therefore the only ones that can change a derived key.
 * Keys are UTF-8 codepoints, values their ASCII expansion.
 */
const AVESMAPS_ASCII_FOLD_LIGATURES = [
    "\u{00DF}" => 'ss',  // ß  latin small letter sharp s
    "\u{00E6}" => 'ae',  // æ  latin small letter ae      (measured: Hældingard -> haeldingard)
    "\u{00C6}" => 'AE',  // Æ  latin capital letter ae
    "\u{0153}" => 'oe',  // œ  latin small ligature oe
    "\u{0152}" => 'OE',  // Œ  latin capital ligature oe
    "\u{FB00}" => 'ff',  // ﬀ  latin small ligature ff
    "\u{FB01}" => 'fi',  // ﬁ  latin small ligature fi
    "\u{FB02}" => 'fl',  // ﬂ  latin small ligature fl
    "\u{FB03}" => 'ffi', // ﬃ  latin small ligature ffi
    "\u{FB04}" => 'ffl', // ﬄ  latin small ligature ffl
];

/**
 * Fold a UTF-8 string to ASCII deterministically.
 *
 * ASCII passes through untouched. A ligature expands per the table above. Every
 * other codepoint becomes exactly ONE '?' -- one per codepoint, never two: the
 * callers collapse RUNS of non-alphanumerics, so an extra mark is invisible
 * mid-string but changes trim($slug, '-') at the edges.
 */
function avesmapsFoldToAscii(string $value): string {
    if ($value === '') {
        return '';
    }

    // Fast path: the overwhelming majority of names are pure ASCII already.
    if (preg_match('/[^\x00-\x7F]/', $value) !== 1) {
        return $value;
    }

    $folded = '';
    foreach (mb_str_split($value, 1, 'UTF-8') as $character) {
        if (strlen($character) === 1) { // single byte == ASCII in UTF-8
            $folded .= $character;
            continue;
        }

        $folded .= AVESMAPS_ASCII_FOLD_LIGATURES[$character] ?? '?';
    }

    return $folded;
}

/**
 * Sort key for a GERMAN word list: lower-cased, umlauts on their base letter
 * (DIN 5007 variant 1 -- ae=a, oe=o, ue=u, sz=ss).
 *
 * 💣 THIS IS NOT avesmapsFoldToAscii(), AND THE DIFFERENCE IS THE WHOLE POINT.
 *   The fold above reproduces what production has STORED ('ü' -> '?', the base
 *   letter is gone); it must never change. This one is for DISPLAY order only,
 *   it never touches a key, and it must keep the base letter -- sorted through
 *   the fold, 'Brücke' would read 'br?cke' and land in front of everything.
 *   They sit next to each other so the choice is visible: deriving a key ->
 *   the one above; ordering a list a German reader will read -> this one.
 *
 * Why not strcmp() alone: a UTF-8 umlaut starts with 0xC3, so byte order puts
 * every one of them behind 'z' -- 'Brücke' after 'Brunnen', 'Fährstation' after
 * 'Feggagir'. Why not Collator/intl: the extension is not guaranteed on STRATO,
 * and an order that depends on the host is not an order.
 *
 * Callers: the place-kind list (api/_internal/wiki/place-kinds.php) and the
 * landscape "Art" vocabulary (api/_internal/app/ecosystem.php). Sorting in PHP
 * rather than in SQL is deliberate for the second one: it keeps the result
 * independent of the column's MySQL collation, and makes it testable against
 * pdo_sqlite, which sorts bytewise.
 */
function avesmapsGermanSortKey(string $value): string {
    return str_replace(
        ['ä', 'ö', 'ü', 'ß'],
        ['a', 'o', 'u', 'ss'],
        mb_strtolower(trim($value), 'UTF-8')
    );
}
