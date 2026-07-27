<?php

declare(strict_types=1);

/**
 * Unit tests for how {{Infobox Region}}'s Art= field becomes a stored art string and a label
 * subtype (api/_internal/wiki/regions.php). No DB, no HTTP -- hand-built wikitext only. Run:
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/wiki/__tests__/region-art-parsing-test.php
 * Exit 0 = all asserts passed.
 *
 * Why this file exists: the wiki writes multi-valued Arten as "Art=Tal|Tal". MediaWiki reads the
 * second component as a POSITIONAL parameter and renders only "Tal" -- our template parser is
 * line-based and kept the whole rest of the line, so 12 live labels showed "Tal|Tal" as their
 * infobox subtitle and the JS mirror's lookup (keyed on the raw string) silently missed.
 */

// Environment guard: assert() is compiled to a silent no-op unless zend.assertions=1 is set at
// PHP startup -- it CANNOT be flipped at runtime via ini_set(). Without this guard a broken
// implementation would print the "ok" line and exit 0: a false green.
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- "
        . "assert() below would be a no-op and this test would report false positives.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}
if (!extension_loaded('mbstring')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded -- regions.php calls mb_* and would fatal.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../sync.php';
require __DIR__ . '/../sync-monitor-parsing.php';
require __DIR__ . '/../sync-monitor.php';
require __DIR__ . '/../territories-parsing.php';
require __DIR__ . '/../../political/territory.php';
require __DIR__ . '/../regions.php';

/** Builds the smallest wikitext that avesmapsWikiRegionParsePage accepts. */
function artOf(string $art, string $name = 'Probe'): string {
    $wikitext = "{{Infobox Region\n|Name=" . $name . "\n|Art=" . $art . "\n|Region=Irgendwo\n}}\nFliesstext.";
    $parsed = avesmapsWikiRegionParsePage($name, $wikitext);
    assert($parsed['is_region'] === true, 'the probe wikitext must parse as a region');

    return (string) ($parsed['record']['art'] ?? '');
}

// ------------------------------------------------------- THE PIPE IS A PARAMETER SEPARATOR ---
// Verified against the live wiki 2026-07-27: the rendered Vildromtal page does NOT contain the
// string "Tal|Tal" anywhere -- MediaWiki bound Art=Tal and dropped "Tal" into an unused positional
// slot. Storing the raw line diverges from what every reader of the wiki sees.
assert(artOf('Tal|Tal', 'Vildromtal') === 'Tal', 'a duplicated Art keeps only the named value');
assert(artOf('Tal|Grube', 'Svatkerbe') === 'Tal', 'a second Art component is a positional param, not part of the value');
assert(artOf("W\u{00FC}ste|Halbw\u{00FC}ste, H\u{00FC}gelland", 'Zhandukistan') === "W\u{00FC}ste", 'only the first component survives, umlauts intact');
assert(artOf('Tal|Tal, [[Sph' . "\u{00E4}" . 'renruptur]]', 'D' . "\u{00E4}" . 'monenspalt') === 'Tal', 'wikilinks after the pipe go with the discarded component');

// A comma is NOT a parameter separator in MediaWiki -- a genuinely two-worded Art must survive
// whole, or we would silently truncate content the wiki really does display.
assert(artOf('Mischregion, Wald') === 'Mischregion, Wald', 'commas are content, not separators');
assert(artOf('Tal') === 'Tal', 'the ordinary single-valued case is untouched');
assert(artOf('') === '', 'an empty Art stays empty');

// The existing Berg -> Berggipfel rewrite compares against the WHOLE art string. Before the split
// it could never fire on "Berg|Felsformation" (live: Tenjos, Eibhavalvan), so those regions kept a
// raw art and no subtype at all.
assert(artOf('Berg', 'Tenjos') === 'Berggipfel', 'a plain Berg is renamed to Berggipfel');
assert(artOf('Berg|Felsformation', 'Tenjos') === 'Berggipfel', 'the rename also fires once the pipe is gone');

// ------------------------------------------------------------- ART -> LABEL SUBTYPE MAPPING ---
// Regressions first: the categories that already worked must keep working.
assert(avesmapsWikiRegionArtToSubtype('Tal') === 'tal', 'Tal maps to the tal subtype (Discord #51)');
assert(avesmapsWikiRegionArtToSubtype('Flusstal') === 'tal', 'a Flusstal is a valley too');
assert(avesmapsWikiRegionArtToSubtype('Region') === 'region', 'the catch-all still resolves');
assert(avesmapsWikiRegionArtToSubtype('Wald') === 'wald', 'Wald still resolves');
assert(avesmapsWikiRegionArtToSubtype('Berggipfel') === 'berggipfel', 'Berggipfel still resolves');

// New: the valley forms the wiki files under Kategorie:Tal. Measured 2026-07-27 against the live
// category (74 pages): Schlucht 19, Talkessel 1, Klamm 1 -- 21 of 74 had no mapping at all, so the
// editor's "adopt category from the wiki landscape" button could not categorise them and they
// landed in the "region" catch-all. That is the very complaint Discord #51 raised for Tal.
assert(avesmapsWikiRegionArtToSubtype('Schlucht') === 'tal', 'a Schlucht is a valley form');
assert(avesmapsWikiRegionArtToSubtype('Klamm') === 'tal', 'a Klamm is a valley form');
assert(avesmapsWikiRegionArtToSubtype('Talkessel') === 'tal', 'a Talkessel is a valley form');

// The type check has to follow the mapping, otherwise the two live offenders stay invisible.
// Asbyrgi (Art=Schlucht) and Gespensterkessel (Art=Talkessel) both sit as "region" today.
assert(avesmapsWikiRegionTypeConflict('region', 'Schlucht') === true, 'a Schlucht stored as region is a conflict now');
assert(avesmapsWikiRegionTypeConflict('tal', 'Schlucht') === false, 'a Schlucht stored as tal is fine');
assert(avesmapsWikiRegionTypeConflict('tal', 'Tal|Tal') === false, 'the mapping already split on the pipe -- keep it that way');

// An Art we deliberately do NOT map must stay unmapped: an unknown art disables the type check
// (safe default) instead of guessing. Krater sits in Kategorie:Tal but a crater is not a valley,
// and both live pages are off-continent.
assert(avesmapsWikiRegionArtToSubtype('Krater') === '', 'Krater stays unmapped on purpose');
assert(avesmapsWikiRegionTypeConflict('region', 'Krater') === false, 'an unmapped art never raises a conflict');

echo "ok: region art parsing + subtype mapping\n";
