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

// ------------------------------------------------------------------- VULKAN AS ITS OWN TYPE ---
// Measured 2026-07-27 against Kategorie:Vulkan (40 pages): 34 carry Art=Vulkan and every one of the
// 40 uses {{Infobox Region}}, so the region parser accepts them -- they simply had no subtype.
assert(avesmapsWikiRegionArtToSubtype('Vulkan') === 'vulkan', 'Vulkan is its own label category');
// Depends on the pipe split above: the live page for this one reads "Art=Vulkan|Magmafluss".
assert(avesmapsWikiRegionArtToSubtype('Vulkan|Magmafluss') === 'vulkan', 'a multi-valued Vulkan still resolves');
assert(artOf('Vulkan|Magmafluss', 'Rihutu') === 'Vulkan', 'and its stored art is the bare first component');
// Amran Thjalgyn is the single live label already hanging on a Vulkan article; it sits as
// "berggipfel" and now reports a conflict until an editor adopts the category.
assert(avesmapsWikiRegionTypeConflict('berggipfel', 'Vulkan') === true, 'a Vulkan stored as berggipfel is a conflict');
assert(avesmapsWikiRegionTypeConflict('vulkan', 'Vulkan') === false, 'a Vulkan stored as vulkan is fine');
// Neighbours in the same category that are deliberately NOT volcanoes must keep their own mapping.
// Note the composed path: "Berg" never reaches the mapping table -- avesmapsWikiRegionParsePage
// renames it to "Berggipfel" first, and only that has a table entry. Asserting the table alone
// would be asserting the wrong contract.
assert(avesmapsWikiRegionArtToSubtype('Berg') === '', 'the table itself does not know Berg');
assert(avesmapsWikiRegionArtToSubtype(artOf('Berg', 'Ehernes Schwert')) === 'berggipfel', 'but the parsed art does');
assert(avesmapsWikiRegionArtToSubtype('Insel') === 'insel', 'the two islands in the category stay islands');
assert(avesmapsWikiRegionArtToSubtype('Magmastrom') === '', 'a lava flow is not a peak -- deliberately unmapped');

// --------------------------------------------------------------------------- THE CRAWL SEEDS ---
// 🔴 The structural half of the volcano gap: only 3 of the 40 pages were reachable from the old
// seeds, so the staging table never learned about volcanoes and the editor's landscape picker
// could not offer them at all. Kategorie:Anhoehe is the taxonomic parent and has exactly three
// children -- Berg (the old seed), Eisberg (3 pages) and Vulkan (40) -- so moving the seed up one
// level closes the gap without widening the crawl into an unrelated branch.
$seeds = avesmapsWikiRegionDefaultSeeds();
assert(in_array("Kategorie:Anh\u{00F6}he", $seeds, true), 'the crawl seeds reach Anhoehe (and thus Vulkan)');
assert(!in_array('Kategorie:Berg', $seeds, true), 'Kategorie:Berg is redundant once Anhoehe is seeded');
assert(in_array('Kategorie:Derographische Region', $seeds, true), 'the other seeds are untouched');
assert(in_array('Kategorie:Hydroderographie', $seeds, true), 'the other seeds are untouched');

// -------------------------------------------------------------------------- THE TYPE IS VALID ---
// The subtype has to survive the server whitelist, otherwise saving a label with it 400s.
require_once __DIR__ . '/../../bootstrap.php'; // avesmapsNormalizeSingleLine
require_once __DIR__ . '/../../map/features.php';
assert(avesmapsReadLabelSubtype('vulkan') === 'vulkan', 'the server accepts the new subtype');
assert(avesmapsReadLabelSubtype('berggipfel') === 'berggipfel', 'and still accepts the old one');
$rejected = false;
try {
    avesmapsReadLabelSubtype('vulkane');
} catch (InvalidArgumentException) {
    $rejected = true;
}
assert($rejected === true, 'a near-miss is still rejected -- the whitelist stays a whitelist');

// -------------------------------------------------------------- THE FOLDED UMLAUT KEYS ---
// 💣 The lookup folds both sides with avesmapsWikiSyncCreateMatchKey, and that folding drops
// umlauts entirely instead of expanding them. These four asserts pin the folding itself: they are
// what makes 'Hügelland' and 'Hugelland' two DIFFERENT entries rather than one, which is why both
// spellings have to stay in the table.
assert(avesmapsWikiSyncCreateMatchKey("H\u{00FC}gelland") === 'hgelland', 'the folding DROPS the umlaut, it does not expand it');
assert(avesmapsWikiSyncCreateMatchKey("W\u{00FC}ste") === 'wste', 'same for Wueste');
assert(avesmapsWikiSyncCreateMatchKey("K\u{00FC}ste") === 'kste', 'same for Kueste');
assert(avesmapsWikiSyncCreateMatchKey("Halbw\u{00FC}ste") === 'halbwste', 'same for Halbwueste');

// The four arts now resolve. Before the fix every one of these returned '' -- an unknown art is
// treated as "no expected subtype", so avesmapsWikiRegionTypeConflict returned false for all of
// them and the check was silently off. Measured on revision 44492: 18 labels affected.
assert(avesmapsWikiRegionArtToSubtype("H\u{00FC}gelland") === 'huegelland', 'Huegelland resolves');
assert(avesmapsWikiRegionArtToSubtype("W\u{00FC}ste") === 'wueste', 'Wueste resolves');
assert(avesmapsWikiRegionArtToSubtype("K\u{00FC}ste") === 'kueste', 'Kueste resolves');
assert(avesmapsWikiRegionArtToSubtype("Halbw\u{00FC}ste") === 'wueste', 'Halbwueste is a desert too');
// The multi-valued live case: Zhandukistan carries "Wueste|Halbwueste, Huegelland".
assert(avesmapsWikiRegionArtToSubtype("W\u{00FC}ste|Halbw\u{00FC}ste, H\u{00FC}gelland") === 'wueste', 'the first component still wins');
// The ASCII spellings stay reachable for an art written without the umlaut.
assert(avesmapsWikiRegionArtToSubtype('Hugelland') === 'huegelland', 'the ASCII spelling still maps');
assert(avesmapsWikiRegionArtToSubtype('Wuste') === 'wueste', 'the ASCII spelling still maps');

// The intended new signal: 12 of the 18 labels sit on a subtype that disagrees with the wiki.
assert(avesmapsWikiRegionTypeConflict('region', "H\u{00FC}gelland") === true, 'Huegelland stored as region is now a conflict');
assert(avesmapsWikiRegionTypeConflict('gebirge', "H\u{00FC}gelland") === true, 'Goblinhoehen: gebirge vs Huegelland is a conflict');
assert(avesmapsWikiRegionTypeConflict('huegelland', "H\u{00FC}gelland") === false, 'and an agreeing label stays quiet');
assert(avesmapsWikiRegionTypeConflict('wueste', "W\u{00FC}ste") === false, 'the 6 already-correct labels stay quiet');

// ---------------------------------------- THE TABLE'S OWN KEYS GO THROUGH THE SAME FOLDING ---
// 💣 A lookup key is avesmapsWikiSyncCreateMatchKey's OUTPUT. An entry whose key is not already in
// that form is DEAD: no wiki art can ever produce it. That is exactly how 'wuste', 'kuste',
// 'hugelland' and 'halbwuste' sat here unreachable and kept the type check switched off for 18
// labels. Hand-writing the folded spelling fixes those four but leaves the rule to human memory --
// the next 'Öde' or 'Höhle' added to the table would be dead again, and silently so.
// The lookup therefore folds the table's keys with the same function it folds the art with, so the
// entries are written the way a human writes them and reachability is a property of the code.
assert(array_key_exists("H\u{00FC}gelland", AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE), 'the table is written in readable German, not in pre-folded form');
assert(array_key_exists("W\u{00FC}ste", AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE), 'the table is written in readable German, not in pre-folded form');

// The permanent guard: EVERY entry has to be reachable through the public lookup. An art carrying
// an umlaut, an accent or a sharp s can no longer become a silent no-op.
foreach (AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE as $tableArt => $tableSubtype) {
    assert(
        avesmapsWikiRegionArtToSubtype((string) $tableArt) === $tableSubtype,
        'the entry "' . $tableArt . '" => "' . $tableSubtype . '" is unreachable: the lookup folds it to "'
            . avesmapsWikiSyncCreateMatchKey((string) $tableArt) . '", which the table does not answer'
    );
}

// 'ß' is the one special character the fold EXPANDS (to 'ss', see ascii-fold.php), so a single
// "Großregion" entry answers both spellings and no ASCII twin is needed -- unlike the umlauts.
assert(avesmapsWikiRegionArtToSubtype("Gro\u{00DF}region") === 'region', 'the sharp-s spelling resolves');
assert(avesmapsWikiRegionArtToSubtype('Grossregion') === 'region', 'and so does the ss spelling, through the same entry');

// Folding is lossy, so two readable keys CAN collapse onto one lookup key -- every character it
// drops is a chance for that ("Öde" and "Ode" both fold to 'de'). Landing on the same subtype is
// harmless; landing on different ones silently drops whichever entry loses the race, and no caller
// would ever see the one that lost.
$seenFoldedKeys = [];
foreach (AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE as $tableArt => $tableSubtype) {
    $foldedKey = avesmapsWikiSyncCreateMatchKey((string) $tableArt);
    assert(
        !isset($seenFoldedKeys[$foldedKey]) || $seenFoldedKeys[$foldedKey][1] === $tableSubtype,
        'the arts "' . ($seenFoldedKeys[$foldedKey][0] ?? '') . '" and "' . $tableArt . '" both fold to "'
            . $foldedKey . '" but expect different subtypes -- one of them is unreachable'
    );
    $seenFoldedKeys[$foldedKey] = [$tableArt, $tableSubtype];
}

echo "ok: region art parsing + subtype mapping + vulkan + every table key reachable\n";
