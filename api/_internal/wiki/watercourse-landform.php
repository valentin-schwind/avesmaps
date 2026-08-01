<?php

declare(strict_types=1);

// The ONE rule that decides a watercourse article actually describes a LANDFORM, not a waterway.
//
// Wiki Aventurica files a wadi under {{Infobox Fluss}} because a wadi IS a riverbed -- every one
// of the five pages in Kategorie:Wadi carries |Art=[[Wadi]] (verified against the live wiki
// 2026-08-01). Avesmaps draws it as a LANDSCAPE instead: 'wadi' has been a topographic type since
// 2026-07-28 ("a BAND, not an area running for miles", commit 4a8cda0c) and a label subtype of the
// same name. It must never become routable water -- a wiki river can only be assigned to a
// Flussweg/Seeweg (paths.php, avesmapsWikiPathAssign), and a boat cannot sail a bed that is dry
// most of the year.
//
// Deliberately its own file, exactly like path-naming.php: BOTH regions.php and paths.php need the
// rule and neither may depend on the other -- api/edit/wiki/paths.php loads paths.php WITHOUT
// regions.php. Three readers, one list, so they cannot drift apart:
//   - avesmapsWikiRegionParsePage()  ACCEPTS such a page although its infobox is not a Region
//   - avesmapsWikiPathParsePage()    REJECTS it although its infobox is a Fluss
//   - avesmapsWikiDumpClassifyPage() routes it to the region handler (the one exception to O4)
//
// Runtime dependencies -- sync.php + sync-monitor-parsing.php -- are present in every context that
// loads regions.php or paths.php. Nothing is needed at include time.

// Write the Arten the way the WIKI writes them. They are folded with avesmapsWikiSyncCreateMatchKey
// before comparison, the same normalisation AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE's keys go through,
// so an umlaut or a sharp s in a future entry cannot make it silently unreachable.
const AVESMAPS_WIKI_LANDFORM_WATERCOURSE_ARTS = ['Wadi'];

// The named Art of an infobox, reduced to its FIRST component.
//
// "Art=Tal|Grube" is TWO parameters to MediaWiki: the named Art, plus an unused positional one.
// avesmapsWikiSyncMonitorParseTemplateParams is line-based and keeps the whole rest of the line, so
// the stored art -- which the infobox renders as its subtitle -- read "Tal|Grube" while every
// reader of the wiki sees "Tal" (verified 2026-07-27: the rendered page does not contain the string
// at all). Split on the PIPE only; a comma is content, not a separator ("Mischregion, Wald" is one
// Art). Do NOT push this into the shared param parser -- multi-line values such as Verlauf= or
// Positionskarte= legitimately carry pipes inside templates.
function avesmapsWikiNormalizeInfoboxArt(string $art): string
{
    return trim((preg_split('/\s*\|\s*/u', trim($art)) ?: [''])[0]);
}

// The infobox's Art field, cleaned of wikilinks and reduced to its first component -- byte-for-byte
// the value avesmapsWikiRegionParsePage() goes on to store, because both end in the normaliser above.
function avesmapsWikiReadInfoboxArt(string $wikitext): string
{
    $block = avesmapsWikiSyncMonitorExtractInfoboxBlock($wikitext);
    if (trim($block) === '') {
        return '';
    }
    $norm = avesmapsWikiSyncMonitorNormFields(avesmapsWikiSyncMonitorParseTemplateParams($block));

    return avesmapsWikiNormalizeInfoboxArt(
        avesmapsWikiSyncCleanPoliticalTerritoryWikiValue(avesmapsWikiSyncMonitorField($norm, ['art', 'typ']))
    );
}

// True for a {{Infobox Fluss}} page whose Art names a landform (today: Wadi).
//
// 💣 The infobox gate is not decoration. Without it any page whose Art happens to read "Wadi"
// would be pulled out of its own entity kind; with it the rule can only ever reclassify a
// watercourse, which is the only thing it is meant to correct.
function avesmapsWikiIsLandformWatercourse(string $wikitext): bool
{
    $infoboxKey = avesmapsWikiSyncMonitorFieldKey(avesmapsWikiSyncMonitorInfoboxName($wikitext));
    if ($infoboxKey === '' || !str_contains($infoboxKey, 'fluss')) {
        return false;
    }

    $artKey = avesmapsWikiSyncCreateMatchKey(avesmapsWikiReadInfoboxArt($wikitext));
    if ($artKey === '') {
        return false; // a river without an Art stays a river
    }

    foreach (AVESMAPS_WIKI_LANDFORM_WATERCOURSE_ARTS as $landformArt) {
        if (avesmapsWikiSyncCreateMatchKey((string) $landformArt) === $artKey) {
            return true;
        }
    }

    return false;
}
