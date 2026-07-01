<?php

declare(strict_types=1);

/**
 * Fixture-based unit test for Pass B of the dump-reader (WikiDump migration,
 * Task 4a): entity-infobox ENUMERATION + the PATH handler (Fluss / Straße), plus
 * the Aventurien continent filter. Exercises the DB-FREE core of
 * api/_internal/wiki/dump-entity-scan.php against the canonical hand-written
 * MediaWiki-export fixture (tools/wikidump/fixtures/mini-dump.xml), which Task 4a
 * extended with three ns0 path pages:
 *
 *   Breite           {{Infobox Fluss}}   -> path, Aventurien   (KEPT)
 *   Reichsstraße 1   {{Infobox Straße}}  -> path, Aventurien   (KEPT)
 *   Rastullah-Strom  {{Infobox Fluss}}   -> path, Myranor      (FILTERED OUT)
 *
 * plus the pre-existing pages exercising the "recognised but unhandled" and
 * "skipped" branches:
 *   Kosch            {{Infobox Staat}}    -> territory (recognised, NOT a path)
 *   Angbar           {{Infobox Siedlung}} -> settlement (recognised, NOT a path)
 *   Horasreich / Königreich Kosch (historisch) -> redirects (skipped)
 *   Vorlage:Infobox Staat (ns 10)         -> non-Main namespace (skipped)
 *
 * WHAT THIS PROVES (per the Task-4a brief):
 *   (a) infobox-name enumeration classifies the fixture pages correctly
 *       (Fluss/Straße -> path; Staat/Siedlung -> recognised-but-unhandled; ns10
 *       and redirects -> skipped);
 *   (b) the path handler produces staging records whose fields match the REAL
 *       mapping -- name, art, kind ('fluss'/'strasse'), lage, laenge, verlauf,
 *       match_key (= avesmapsWikiSyncCreateMatchKey(name)), wiki_key
 *       (= avesmapsPoliticalSlug(canonical)); expected key values are HAND-DERIVED
 *       via the real functions (like Task 1), never asserted equal to the
 *       function's own output;
 *   (c) the non-Aventurien path page (Rastullah-Strom, Myranor) is FILTERED OUT
 *       (continent != Aventurien -> not in the produced records);
 *   (d) a non-path infobox page (Kosch / Staat) is NOT turned into a path record.
 *
 * NO database and NO STRATO are touched: the tested functions (classify / parse /
 * collect) are DB-free; the DB persist path (avesmapsWikiDumpPersistPathRecords /
 * avesmapsWikiDumpRunPassBStep) is a separate thin layer this test never calls.
 *
 * DEPENDENCIES / HOW TO RUN (same mbstring caveat as Task 1/3 -- the reused
 * derivation functions call mb_strtolower()/mb_substr()):
 *
 *     php -d extension=php_mbstring.dll tools/wikidump/test-dump-entities.php
 *
 * (A plain `php tools/wikidump/test-dump-entities.php` works iff mbstring is
 * enabled globally.) Exit code 0 iff every assert passes; non-zero otherwise.
 */

// ---------------------------------------------------------------------------
// 0. Preconditions: the reused derivation functions need mbstring. Fail loudly.
// ---------------------------------------------------------------------------
if (!function_exists('mb_strtolower')) {
    fwrite(STDERR, "FATAL: mbstring is not loaded, but the reused derivation functions require mb_strtolower()/mb_substr().\n");
    fwrite(STDERR, "Re-run with:  php -d extension=php_mbstring.dll " . basename(__FILE__) . "\n");
    exit(2);
}
if (!class_exists('XMLReader')) {
    fwrite(STDERR, "FATAL: ext/xmlreader is not loaded, but the dump reader requires XMLReader.\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 1. Include chain: dump-reader (page stream) + the real path lib it reuses +
//    that lib's own dependencies + the new Pass-B scaffold. All are
//    side-effect-free on include (const + function defs, no DB/headers). This
//    exact chain was found via TDD (paths.php needs Clean* from
//    territories-parsing.php, which needs a helper from territories-tree.php).
// ---------------------------------------------------------------------------
$repoRoot = dirname(__DIR__, 2); // tools/wikidump -> tools -> <repo root>
require $repoRoot . '/api/_internal/political/territory.php';
require $repoRoot . '/api/_internal/wiki/sync.php';
require $repoRoot . '/api/_internal/wiki/sync-monitor.php';
require $repoRoot . '/api/_internal/wiki/territories-tree.php';
require $repoRoot . '/api/_internal/wiki/territories-parsing.php';
require $repoRoot . '/api/_internal/wiki/paths.php';
require $repoRoot . '/api/_internal/wiki/dump-reader.php';
require $repoRoot . '/api/_internal/wiki/dump-entity-scan.php';

foreach ([
    // Pass-B scaffold under test:
    'avesmapsWikiDumpClassifyEntityKind',
    'avesmapsWikiDumpClassifyPage',
    'avesmapsWikiDumpExtractCategoryNames',
    'avesmapsWikiDumpParsePathPage',
    'avesmapsWikiDumpCollectEntities',
    'avesmapsWikiDumpCollectPathRecords',
    // reused real functions (must be visible so the handler can call them):
    'avesmapsWikiPathParsePage',
    'avesmapsWikiPathUpsertRecord',
    'avesmapsWikiSyncMonitorInfoboxName',
    'avesmapsWikiSyncMonitorDetectContinent',
    'avesmapsWikiSyncCreateMatchKey',
    'avesmapsPoliticalSlug',
    // dump-reader page stream:
    'avesmapsWikiDumpOpenReader',
    'avesmapsWikiDumpIteratePages',
] as $required) {
    if (!function_exists($required)) {
        fwrite(STDERR, "FATAL: expected function {$required}() was not defined by the included libraries.\n");
        exit(2);
    }
}

$fixturePath = __DIR__ . '/fixtures/mini-dump.xml';
if (!is_file($fixturePath)) {
    fwrite(STDERR, "FATAL: fixture not found: {$fixturePath}\n");
    exit(2);
}

// ---------------------------------------------------------------------------
// 2. Diagnostic banner -- record the environment (the iconv umlaut behaviour is
//    what makes the key derivations environment-dependent; see Task 1's banner).
// ---------------------------------------------------------------------------
$iconvSample = function_exists('iconv')
    ? (static function (string $s): string {
        $r = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
        return is_string($r) ? $r : '(iconv false)';
    })('Reichsstraße')
    : '(iconv unavailable)';

echo "================================================================\n";
echo " dump-reader Pass B unit test (WikiDump migration, Task 4a)\n";
echo "================================================================\n";
echo 'PHP version        : ' . PHP_VERSION . "\n";
echo 'mbstring loaded    : ' . (extension_loaded('mbstring') ? 'yes' : 'no') . "\n";
echo 'xmlreader loaded   : ' . (extension_loaded('xmlreader') ? 'yes' : 'no') . "\n";
echo "iconv('Reichsstrasse') = '{$iconvSample}'  (umlaut outcome is env-dependent)\n";
echo 'default continent  : ' . AVESMAPS_POLITICAL_DEFAULT_CONTINENT . "\n";
echo "----------------------------------------------------------------\n\n";

// ---------------------------------------------------------------------------
// 3. Tiny assertion harness (no framework in this repo).
// ---------------------------------------------------------------------------
$passCount = 0;
$failCount = 0;

$check = static function (string $label, $expected, $actual, string $why) use (&$passCount, &$failCount): void {
    if ($actual === $expected) {
        $passCount++;
        printf("PASS | %-54s | %s\n", $label, $why);
        return;
    }
    $failCount++;
    printf("FAIL | %-54s | %s\n", $label, $why);
    printf("     |   expected: %s\n", var_export($expected, true));
    printf("     |   actual  : %s\n", var_export($actual, true));
};

// Helper: fully drain the page iterator into an array of page rows.
$readAll = static function (string $path): array {
    $reader = avesmapsWikiDumpOpenReader($path);
    $rows = [];
    foreach (avesmapsWikiDumpIteratePages($reader) as $page) {
        $rows[] = $page;
    }
    $reader->close();
    return $rows;
};

$pages = $readAll($fixturePath);
// Index the page rows by title for targeted per-page assertions.
$byTitle = [];
foreach ($pages as $p) {
    $byTitle[$p['title']] = $p;
}

// ===========================================================================
// (a) infobox-name ENUMERATION: classify each fixture page correctly.
// ===========================================================================
echo "-- (a) entity enumeration (infobox-presence classification, O4) --\n";

// Raw infobox-name -> entity kind (independent of ns/redirect gating).
$check(
    '(a1) Infobox Fluss -> path',
    'path',
    avesmapsWikiDumpClassifyEntityKind('Fluss'),
    'Fluss infobox is a PATH entity'
);
$check(
    '(a2) Infobox Straße -> path',
    'path',
    avesmapsWikiDumpClassifyEntityKind('Straße'),
    'Straße infobox is a PATH entity (key strasse)'
);
$check(
    '(a3) Infobox Staat -> territory (recognised, unhandled in 4a)',
    'territory',
    avesmapsWikiDumpClassifyEntityKind('Staat'),
    'Staat is recognised but NOT handled here'
);
$check(
    '(a4) Infobox Siedlung -> settlement (recognised, unhandled in 4a)',
    'settlement',
    avesmapsWikiDumpClassifyEntityKind('Siedlung'),
    'Siedlung is recognised but NOT handled here'
);
$check(
    '(a5) unknown/empty infobox -> "" (skip)',
    '',
    avesmapsWikiDumpClassifyEntityKind(''),
    'no infobox name -> no entity kind'
);

// Full page-level classification (ns + redirect gating applied):
$check(
    '(a6) page Breite classified as path',
    'path',
    avesmapsWikiDumpClassifyPage($byTitle['Breite']),
    'ns0 non-redirect Fluss page -> path'
);
$check(
    '(a7) page Reichsstraße 1 classified as path',
    'path',
    avesmapsWikiDumpClassifyPage($byTitle['Reichsstraße 1']),
    'ns0 non-redirect Straße page -> path'
);
$check(
    '(a8) page Kosch classified as territory (not path)',
    'territory',
    avesmapsWikiDumpClassifyPage($byTitle['Kosch']),
    'Staat page recognised as territory, not a path'
);
$check(
    '(a9) redirect page (Horasreich) skipped -> ""',
    '',
    avesmapsWikiDumpClassifyPage($byTitle['Horasreich']),
    'a redirect is a Pass-A alias, never an entity'
);
$check(
    '(a10) ns10 page (Vorlage:Infobox Staat) skipped -> ""',
    '',
    avesmapsWikiDumpClassifyPage($byTitle['Vorlage:Infobox Staat']),
    'non-Main namespace is not an entity even though it names an infobox'
);

// ===========================================================================
// (b) PATH handler: kept records + field mapping via the REAL functions.
//     Expected key values are HAND-DERIVED (see the derivation notes inline),
//     NOT asserted equal to the function's own output.
// ===========================================================================
echo "\n-- (b) path handler: staging records + real field/key mapping --\n";

$collected = avesmapsWikiDumpCollectEntities($pages);
$records = $collected['records'];

// Two Aventurien path pages kept (Breite + Reichsstraße 1); the Myranor river
// (Rastullah-Strom) is filtered -> exactly 2 kept records.
$check(
    '(b1) exactly 2 Aventurien path records kept',
    2,
    count($records),
    'Breite + Reichsstraße 1 kept; Rastullah-Strom (Myranor) filtered out'
);

// Index kept records by wiki_key for targeted assertions.
$recByKey = [];
foreach ($records as $r) {
    $recByKey[(string) ($r['wiki_key'] ?? '')] = $r;
}

// -- Breite (Fluss). Hand-derivation via the REAL funcs (see Task 1 banner):
//    canonical 'Breite' -> avesmapsPoliticalSlug -> 'breite' (plain ASCII)
//    avesmapsWikiSyncCreateMatchKey('Breite') -> 'breite'
$breite = $recByKey['breite'] ?? null;
$check(
    '(b2) Breite record present under wiki_key "breite"',
    true,
    is_array($breite),
    "wiki_key = avesmapsPoliticalSlug('Breite') = 'breite'"
);
$check('(b3) Breite.name', 'Breite', (string) ($breite['name'] ?? '(none)'), 'Name field from the infobox');
$check('(b4) Breite.kind', 'fluss', (string) ($breite['kind'] ?? '(none)'), 'Infobox Fluss -> kind fluss');
$check('(b5) Breite.art', 'Fluss', (string) ($breite['art'] ?? '(none)'), 'Art field from the infobox');
$check('(b6) Breite.lage', 'Kosch, Mittelreich', (string) ($breite['lage'] ?? '(none)'), 'Regionen -> lage (links stripped to names)');
$check('(b7) Breite.laenge', '900 Meilen', (string) ($breite['laenge'] ?? '(none)'), 'Länge field from the infobox');
$check('(b8) Breite.verlauf', 'Angbar → Ferdok → Elenvina', (string) ($breite['verlauf'] ?? '(none)'), 'Verlauf stations joined with →');
$check(
    '(b9) Breite.match_key (real avesmapsWikiSyncCreateMatchKey)',
    'breite',
    (string) ($breite['match_key'] ?? '(none)'),
    "hand-derived: avesmapsWikiSyncCreateMatchKey('Breite') = 'breite'"
);
$check('(b10) Breite.continent', 'Aventurien', (string) ($breite['continent'] ?? '(none)'), 'DetectContinent default -> Aventurien');

// -- Reichsstraße 1 (Straße). This page is the KEY CONTRAST proving BOTH real
//    key funcs are used (not one substituted for the other):
//      wiki_key  = avesmapsPoliticalSlug('Reichsstraße 1') = 'reichsstrasse-1'  (space -> HYPHEN, ß -> ss)
//      match_key = avesmapsWikiSyncCreateMatchKey('Reichsstraße 1') = 'reichsstrasse1' (space VANISHES)
$strasse = $recByKey['reichsstrasse-1'] ?? null;
$check(
    '(b11) Reichsstraße 1 record present under wiki_key "reichsstrasse-1"',
    true,
    is_array($strasse),
    "wiki_key = avesmapsPoliticalSlug('Reichsstraße 1') = 'reichsstrasse-1' (space->hyphen)"
);
$check('(b12) Reichsstraße 1 .kind', 'strasse', (string) ($strasse['kind'] ?? '(none)'), 'Infobox Straße -> kind strasse');
$check('(b13) Reichsstraße 1 .art', 'Reichsstraße', (string) ($strasse['art'] ?? '(none)'), 'Art field from the infobox');
$check('(b14) Reichsstraße 1 .laenge', '400 Meilen', (string) ($strasse['laenge'] ?? '(none)'), 'Länge field from the infobox');
$check(
    '(b15) Reichsstraße 1 .match_key (VANISHING space, contrast wiki_key)',
    'reichsstrasse1',
    (string) ($strasse['match_key'] ?? '(none)'),
    "match_key drops the space ('reichsstrasse1') where wiki_key hyphenates it ('reichsstrasse-1')"
);
$check('(b16) Reichsstraße 1 .continent', 'Aventurien', (string) ($strasse['continent'] ?? '(none)'), 'no foreign-continent signal -> Aventurien default');

// Independent re-derivation cross-check: rebuild both keys via the real funcs and
// confirm the collected record used them (proves NOT a hard-coded literal, I1).
$reWikiKey = avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle('Reichsstraße 1'));
$reMatchKey = avesmapsWikiSyncCreateMatchKey('Reichsstraße 1');
$check(
    '(b17) collected keys == independent real-function re-derivation',
    ['wiki_key' => $reWikiKey, 'match_key' => $reMatchKey],
    ['wiki_key' => (string) ($strasse['wiki_key'] ?? ''), 'match_key' => (string) ($strasse['match_key'] ?? '')],
    'record keys match avesmapsPoliticalSlug + avesmapsWikiSyncCreateMatchKey (I1)'
);

// ===========================================================================
// (c) continent filter: the Myranor river is FILTERED OUT of the records but
//     reported in the `filtered` bucket (so the drop is intentional, not a
//     parse failure). Hand-derivation: DetectContinent sees the category
//     "Fluss (Myranor)" + "{{Nav Staaten Myranor}}" -> "Myranor / Güldenland".
// ===========================================================================
echo "\n-- (c) continent filter (Aventurien only) --\n";

$check(
    '(c1) Rastullah-Strom NOT among kept records',
    false,
    array_key_exists('rastullah-strom', $recByKey),
    'a Myranor river is not staged (continent != Aventurien)'
);

$filteredTitles = array_map(static fn(array $f): string => $f['title'], $collected['filtered']);
$check(
    '(c2) Rastullah-Strom reported in the filtered bucket',
    true,
    in_array('Rastullah-Strom', $filteredTitles, true),
    'the drop is an intentional continent filter, not a parse failure'
);

// The pure handler on that page directly: parsed as a path, but not kept.
$rastullah = avesmapsWikiDumpParsePathPage($byTitle['Rastullah-Strom']);
$check(
    '(c3) Rastullah-Strom handler: kept=false',
    false,
    $rastullah['kept'],
    'handler decides keep=false for a non-Aventurien path'
);
$check(
    '(c4) Rastullah-Strom detected continent != Aventurien',
    true,
    $rastullah['continent'] !== '' && $rastullah['continent'] !== AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    "DetectContinent classified it as '{$rastullah['continent']}' (Myranor), so it is filtered"
);
// And it WAS a genuine path record (record present) -- proves it was dropped by
// the CONTINENT filter, not rejected as a non-path.
$check(
    '(c5) Rastullah-Strom was a real path record before filtering',
    'fluss',
    (string) ($rastullah['record']['kind'] ?? '(none)'),
    'record exists with kind=fluss; only the continent filter removed it'
);

// ===========================================================================
// (d) a non-path infobox (Kosch / Staat) is NOT turned into a path record.
// ===========================================================================
echo "\n-- (d) non-path infobox is not mis-handled as a path --\n";

$koschAsPath = avesmapsWikiDumpParsePathPage($byTitle['Kosch']);
$check(
    '(d1) Kosch (Staat) path handler: kept=false, no record',
    true,
    $koschAsPath['kept'] === false && $koschAsPath['record'] === null,
    'ParsePage returns is_path=false for a Staat infobox -> no path record'
);
$check(
    '(d2) no Kosch record leaked into the kept path records',
    false,
    array_key_exists('kosch', $recByKey),
    'a territory infobox never yields a path staging record (O4/I2)'
);
// Kosch IS still recognised (as a territory) by the enumeration -- just unhandled.
$classifiedByTitle = [];
foreach ($collected['classified'] as $c) {
    $classifiedByTitle[$c['title']] = $c['kind'];
}
$check(
    '(d3) Kosch is recognised as territory (unhandled), Angbar as settlement',
    ['Kosch' => 'territory', 'Angbar' => 'settlement'],
    ['Kosch' => $classifiedByTitle['Kosch'] ?? '(missing)', 'Angbar' => $classifiedByTitle['Angbar'] ?? '(missing)'],
    'recognised-but-unhandled kinds are enumerated, not routed to a handler'
);
$check(
    '(d4) per-kind counts: 3 paths recognised, 1 territory, 1 settlement',
    ['path' => 3, 'territory' => 1, 'settlement' => 1],
    [
        'path' => $collected['counts']['path'] ?? 0,
        'territory' => $collected['counts']['territory'] ?? 0,
        'settlement' => $collected['counts']['settlement'] ?? 0,
    ],
    '3 path pages recognised (2 kept + 1 filtered), plus Kosch + Angbar'
);

// ===========================================================================
// (e) O4 sanity: category links do NOT drive classification (infobox does).
//     Rastullah-Strom carries [[Kategorie:Fluss (Myranor)]] yet is classified by
//     its INFOBOX (Fluss) as a path -- the category only shapes the continent.
// ===========================================================================
echo "\n-- (e) O4: enumeration is by infobox, categories only feed continent --\n";
$check(
    '(e1) category extraction reads the dump category link',
    'Fluss (Myranor)',
    avesmapsWikiDumpExtractCategoryNames($byTitle['Rastullah-Strom']['wikitext']),
    'dump-native category assembly (equiv. of the online category fetch)'
);
$check(
    '(e2) classification still uses the INFOBOX (path), not the category',
    'path',
    avesmapsWikiDumpClassifyPage($byTitle['Rastullah-Strom']),
    'O4: infobox-presence decides the kind; the category only affects continent'
);

// ---------------------------------------------------------------------------
// 4. Summary + exit code.
// ---------------------------------------------------------------------------
$total = $passCount + $failCount;
echo "\n----------------------------------------------------------------\n";
printf("RESULT: %d/%d passing (%d failing)\n", $passCount, $total, $failCount);
echo "----------------------------------------------------------------\n";

exit($failCount === 0 ? 0 : 1);
