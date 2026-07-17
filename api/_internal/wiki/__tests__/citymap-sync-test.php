<?php

declare(strict_types=1);

/**
 * Unit tests for the PURE parser core in api/_internal/wiki/citymap-sync.php.
 * No DB, no HTTP, no dump -- hand-built wikitext only. Run (Windows):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/wiki/__tests__/citymap-sync-test.php
 * Exit 0 = all asserts passed.
 *
 * The fixtures are SYNTHETIC but reproduce the exact shapes measured on the real pages on 2026-07-16
 * (see docs/superpowers/specs/2026-07-16-kartensammlung-wiki-sync-design.md). They are hand-built
 * rather than a copy of the real wikitext on purpose: 34 KB of Wiki Aventurica prose has no business
 * in this repo (docs/repository-data-policy.md), and the shapes are what matters.
 *
 * NB: this test asserts INVARIANTS, never concrete slug VALUES. avesmapsPoliticalSlug depends on
 * iconv, which is absent in some local builds ("Sueden" -> "s-uden" without it), so a frozen slug
 * string would pass here and fail on the server. See tools/wikidump/test-wiki-key-derivation.php.
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is '" . ini_get('zend.assertions') . "', not '1' -- asserts would be no-ops.\n"
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../../political/territory.php'; // avesmapsPoliticalSlug (runtime dependency)
require __DIR__ . '/../citymap-sync.php';

/** @param array<int, array<string, mixed>> $cards */
function findCard(array $cards, string $place, string $source, string $variant): ?array
{
    foreach ($cards as $card) {
        if ($card['place_raw'] === $place && $card['source_raw'] === $source && $card['variant'] === $variant) {
            return $card;
        }
    }

    return null;
}

// ------------------------------------------------------------------ ESCAPING ---
// The measured reality: the new list writes Al\'Anfa, the old list writes Al'Anfa. Both must land on
// ONE identity, or Al'Anfa silently becomes two sets of maps.
assert(avesmapsCitymapUnescapeApostrophes("Al\\'Anfa") === "Al'Anfa");
assert(avesmapsCitymapUnescapeApostrophes("Al'Anfa") === "Al'Anfa");      // already clean -> no-op
assert(avesmapsCitymapHasEscaping("Al\\'Anfa") === true);
assert(avesmapsCitymapHasEscaping("Al'Anfa") === false);

$keyClean = avesmapsCitymapWikiKey('stadtplanindex', "Al'Anfa", "Al'Anfa und der tiefe Süden", 'stadtplan-farbe');
$keyEsc = avesmapsCitymapWikiKey('stadtplanindex', "Al\\'Anfa", "Al\\'Anfa und der tiefe Süden", 'stadtplan-farbe');
assert($keyClean === $keyEsc); // THE invariant: escaping cannot split an identity
assert(str_starts_with($keyClean, 'stadtplanindex:'));
assert(strlen($keyClean) <= 190);
// A key that would overflow the column keeps a hash rather than truncating into a collision.
$long = avesmapsCitymapWikiKey('stadtplanindex', str_repeat('Stadt', 40), str_repeat('Quelle', 40), 'stadtplan-farbe');
assert(strlen($long) <= 190);
assert($long !== avesmapsCitymapWikiKey('stadtplanindex', str_repeat('Stadt', 40), str_repeat('Andere', 40), 'stadtplan-farbe'));
echo "escaping+key ok\n";

// -------------------------------------------------------------- LINK TARGETS ---
// Rule 2: the TARGET is the full title; the display text is the abbreviation. Reading the target is
// what makes the Legende unnecessary.
$targets = avesmapsCitymapExtractLinkTargets('[[Landkartenset Die Siebenwindküste]], [[Die Siebenwindküste|VG2]]');
assert($targets === ['Landkartenset Die Siebenwindküste', 'Die Siebenwindküste']);
assert(avesmapsCitymapExtractLinkTargets('') === []);
assert(avesmapsCitymapExtractLinkTargets('Klartext ohne Link') === []);
// File links (Kartenindex) carry a leading colon.
assert(avesmapsCitymapExtractLinkTargets('[[:Datei:Karten X.jpg|Politische Karte der Streitenden Königreiche (A2)]]')
    === ['Datei:Karten X.jpg']);
echo "linktargets ok\n";

// ------------------------------------------------------------------ SECTIONS ---
$sections = avesmapsCitymapExtractSections("==Eins==\nA\n==Zwei==\nB\n");
assert(array_keys($sections) === ['Eins', 'Zwei']);
assert(trim($sections['Eins']) === 'A');
assert(avesmapsCitymapIsMyranorSection('Myranische Städte') === true);
assert(avesmapsCitymapIsMyranorSection('neue Liste - Myranische Städte') === true);
assert(avesmapsCitymapIsMyranorSection('Aventurische Städte') === false);
echo "sections ok\n";

// -------------------------------------------------------- SOURCE CELL SPLIT ---
// The parallel array is the ONLY witness to how many sources a cell holds. Without it, or against it,
// we take the cell whole -- "give up instead of guessing".
$r = avesmapsCitymapSplitSourceCell('IdDM, Al’Anfa und der tiefe Süden', 'A2/-');
assert($r['split'] === true && count($r['sources']) === 2);          // 2 sources, 2 formats -> trusted
$r = avesmapsCitymapSplitSourceCell('Fürsten, Händler, Intriganten', '-');
assert($r['split'] === false && $r['sources'] === ['Fürsten, Händler, Intriganten']); // ONE title with commas
$r = avesmapsCitymapSplitSourceCell('SdR, Alptraum ohne Ende, Märchenwälder, Zauberflüsse', '17 x 11,5/-/-');
assert($r['split'] === false && count($r['sources']) === 1);          // 4 commas vs 3 formats -> give up
$r = avesmapsCitymapSplitSourceCell('Der siebente Schleier (Basargeschichten)', 'A4');
assert($r['split'] === false && count($r['sources']) === 1);          // single source
$r = avesmapsCitymapSplitSourceCell('-', 'A4');
assert($r['sources'] === []);                                          // "-" = nothing
echo "sourcesplit ok\n";

assert(avesmapsCitymapParallelValue('A2/-', 0, true) === 'A2');
assert(avesmapsCitymapParallelValue('A2/-', 1, true) === null);        // "-" = unknown, not ""
assert(avesmapsCitymapParallelValue('A4', 0, false) === 'A4');
assert(avesmapsCitymapParallelValue('-', 0, false) === null);
// A field with NO parallel array describes EVERY source of the row. Regression: running the real page
// through the parser produced 1 artist attribution instead of 82, because "Ina Kramer" (named once for
// two sources) was handed only to the first -- and that first one is the abbreviation we then drop.
assert(avesmapsCitymapParallelValue('Ina Kramer', 0, true) === 'Ina Kramer');
assert(avesmapsCitymapParallelValue('Ina Kramer', 1, true) === 'Ina Kramer');
echo "parallel ok\n";

// ------------------------------------------------------- STADTPLANINDEX: OLD ---
$page = <<<'WIKI'
==Aventurische Städte==
{| class="wikitable"
|- class="vordergrund"
!Stadt
!Stadtplan (Farbe)
!Stadtplan (s/w)
!Umgebungskarte
|-
| [[Abilacht]] || [[Landkartenset Die Siebenwindküste]], [[Die Siebenwindküste|VG2]] || ||
|-
| [[Al'Anfa]] || [[Al'Anfa und der tiefe Süden|Al'Anfa]] || [[Stunden der Entscheidung|A50]] || [[Das Bornland|Bornland]]
|}
==Myranische Städte==
{| class="wikitable"
|-
| [[Aran]] || [[Myranor-Band|MYR]] || ||
|}
WIKI;
$result = avesmapsCitymapParseStadtplanindex($page);
$cards = $result['cards'];

// Two colour sources for Abilacht -> two cards (the wiki row IS the map).
assert(findCard($cards, 'Abilacht', 'Landkartenset Die Siebenwindküste', 'stadtplan-farbe') !== null);
$vg2 = findCard($cards, 'Abilacht', 'Die Siebenwindküste', 'stadtplan-farbe');
assert($vg2 !== null);                       // the TARGET, not "VG2"
assert($vg2['is_color'] === 1);              // column position encodes colour
assert($vg2['type_key'] === 'stadtplan');
assert($vg2['title'] === 'Stadtplan von Abilacht (Die Siebenwindküste)');

$sw = findCard($cards, "Al'Anfa", 'Stunden der Entscheidung', 'stadtplan-sw');
assert($sw !== null && $sw['is_color'] === 0);
$env = findCard($cards, "Al'Anfa", 'Das Bornland', 'umgebung');
assert($env !== null);
assert($env['is_color'] === null);           // unknown, NOT 0 -- the core rule of citymaps.php
assert($env['type_key'] === 'uebersicht');
assert($env['title'] === "Umgebungskarte von Al'Anfa (Das Bornland)");

// Rule 3: Myranor never produces a card.
foreach ($cards as $card) {
    assert($card['place_raw'] !== 'Aran');
}
echo "old-list ok\n";

// ------------------------------------------------------- STADTPLANINDEX: NEW ---
$page = <<<'WIKI'
==Aventurische Städte==
{| class="wikitable"
!Stadt
!Stadtplan (Farbe)
!Stadtplan (s/w)
!Umgebungskarte
|-
| [[Al'Anfa]] || [[Al'Anfa und der tiefe Süden|Al'Anfa]] || ||
|}
==neue Liste - Aventurische Städte==
{| class="wikitable"
!Stadt
!Quelle
!Farbe
!Format
!Maßstab
!Notiz
!Künstler
|-
| Al\'Anfa||Al\'Anfa und der tiefe Süden||Farbe||A2||Ja||Mit Legende||Ina Kramer
|-
| Al\'Anfa||IdDM||Farbe||A2||Ja||-||Ina Kramer
|-
| Neustadt||Borbarads Erben||sw||A4||Ja||-||Max Muster
|}
WIKI;
$cards = avesmapsCitymapParseStadtplanindex($page)['cards'];

// (a) Known city + MATCHING source -> enriched, not duplicated.
$alanfa = findCard($cards, "Al'Anfa", "Al'Anfa und der tiefe Süden", 'stadtplan-farbe');
assert($alanfa !== null);
assert($alanfa['author'] === 'Ina Kramer');            // enrichment from the new list
assert($alanfa['is_labeled'] === 1);                   // "Mit Legende"
assert($alanfa['note'] !== null && str_contains((string) $alanfa['note'], 'A2'));
assert(str_contains((string) $alanfa['note'], 'Maßstab: Ja')); // yes/no field -> text, never a number

// (b) Known city + UNMATCHED source ("IdDM") -> DROPPED. This is the owner decision that keeps
// Al'Anfa from showing "(IdDM)" and "(In den Dschungeln Meridianas)" as two maps of one publication.
assert(findCard($cards, "Al'Anfa", 'IdDM', 'stadtplan-farbe') === null);

// (c) City the old list never had -> the new list owns it.
$neu = findCard($cards, 'Neustadt', 'Borbarads Erben', 'stadtplan-sw');
assert($neu !== null);
assert($neu['is_color'] === 0);
assert($neu['author'] === 'Max Muster');
assert($neu['is_labeled'] === null);                   // "-" is unknown, not "unlabelled"

// The escaping never reaches the stored name.
foreach ($cards as $card) {
    assert(!str_contains((string) $card['place_raw'], "\\"));
    assert(!str_contains((string) $card['title'], "\\"));
}
echo "new-list merge ok\n";

// ----------------------------------------------------------------- IDEMPOTENT ---
// A second run of the same wikitext must produce byte-identical keys, or every sync duplicates.
$first = avesmapsCitymapParseStadtplanindex($page)['cards'];
$second = avesmapsCitymapParseStadtplanindex($page)['cards'];
assert(array_column($first, 'wiki_key') === array_column($second, 'wiki_key'));
$keys = array_column($first, 'wiki_key');
assert(count($keys) === count(array_unique($keys))); // no key twice within one run
echo "idempotent ok\n";

// The escaped-name counter answers "does the real dump escape?" on the first run.
$counted = avesmapsCitymapParseStadtplanindex($page);
assert($counted['escaped_names_seen'] === 3); // the three Al\'Anfa cells above
echo "escape-counter ok\n";

// ---------------------------------------------------------------- KARTENINDEX ---
$page = <<<'WIKI'
==Aventurienkarten==
{| class="wikitable"
!Beschreibung
!Abmessungen
!Maßstab
!Publikation(en)
!Erstveröffentlichung
|-
| Aventurien-Hexkarte || 43 x 57 cm || ca. 1:6.400.000 || [[Abenteuer Ausbau-Spiel]] || 1985
|}
==Myranorkarten==
{| class="wikitable"
|-
| Myranor-Weltkarte || 40 x 50 cm || || [[Myranor-Band]] || 2005
|}
==DSA4-Regionalkartenwerk==
{| class="wikitable"
!Nr.
!Karte
!Publikation(en)
!Veröffentlichungsdatum
|-
| ||[[:Datei:Karten Landkartenset Die Streitenden Königreiche.jpg|Politische Karte der Streitenden Königreiche (A2)]] || [[Landkartenset Die Streitenden Königreiche]] || 2008
|}
WIKI;
$cards = avesmapsCitymapParseKartenindex($page)['cards'];

// Continent-wide map: placeless -> hangs on the continent name as an unresolved place.
$hex = findCard($cards, 'Aventurien', 'Abenteuer Ausbau-Spiel', 'kontinent');
assert($hex !== null);
assert($hex['title'] === 'Aventurien-Hexkarte');
// THE trap: "Abmessungen" is centimetres. It must be prose in `note`, never a pixel column.
assert(str_contains((string) $hex['note'], '43 x 57 cm'));
assert(!array_key_exists('width_px', $hex));
assert(!array_key_exists('height_px', $hex));
assert(str_contains((string) $hex['note'], '1985'));

// Rule 3 again: Myranor is skipped even here.
foreach ($cards as $card) {
    assert($card['place_raw'] !== 'Myranor');
    assert(!str_contains((string) $card['title'], 'Myranor-Weltkarte'));
}

// Regionalkartenwerk: the file link's TITLE names the region and the kind.
$regional = null;
foreach ($cards as $card) {
    if ($card['variant'] === 'regional') {
        $regional = $card;
    }
}
assert($regional !== null);
assert($regional['art'] === 'politisch');            // "Politische Karte ..." -> art
assert($regional['type_key'] === 'region');
assert(str_contains((string) $regional['place_raw'], 'Streitenden Königreiche')); // kind prefix stripped
assert($regional['source_raw'] === 'Landkartenset Die Streitenden Königreiche');
echo "kartenindex ok\n";

assert(avesmapsCitymapArtFromTitle('Politische Karte von X') === 'politisch');
assert(avesmapsCitymapArtFromTitle('Kartenskizze von Y') === 'skizze');
assert(avesmapsCitymapArtFromTitle('Karte von Z') === null); // unknown, not a default
echo "art ok\n";

// ------------------------------------------- KARTENINDEX: THE COLLISION BUG ---
// REGRESSION. Running the real Kartenindex through the parser showed 3 of 48 regional rows vanishing:
// the key was (region, source, variant), but ONE region+publication legitimately carries SEVERAL maps,
// so they collided and the dedupe ate the survivors. The TITLE is what tells them apart, so the title
// is the identity. The earlier version of this test passed while the bug was live -- it never fed two
// maps of one region through.
$page = <<<'WIKI'
==DSA4-Regionalkartenwerk==
{| class="wikitable"
!Nr.
!Karte
!Publikation(en)
!Veröffentlichungsdatum
|-
| ||[[:Datei:A.jpg|Detaillierte Karte der Streitenden Königreiche (A2)]] || [[Landkartenset Die Streitenden Königreiche]] || 2008
|-
| ||[[:Datei:B.jpg|Politische Karte der Streitenden Königreiche (A3)]] || [[Landkartenset Die Streitenden Königreiche]] || 2008
|-
| ||[[:Datei:C.jpg|Ingame-Karte der Streitenden Königreiche (A3)]] || [[Landkartenset Die Streitenden Königreiche]] || 2008
|-
| ||[[:Datei:D.jpg|Übersichtskarte der geographischen Regionen der Streitenden Königreiche (A3)]] || [[Landkartenset Die Streitenden Königreiche]] || 2008
|-
| ||[[:Datei:E.jpg|thumb|100px|Altoum und die Waldinseln]] || [[Landkartenset Meridiana]] || 2010
|}
WIKI;
$cards = avesmapsCitymapParseKartenindex($page)['cards'];

// Four maps of ONE region+publication must survive as FOUR cards.
$sk = array_values(array_filter($cards, static fn(array $c): bool => str_contains((string) $c['title'], 'Streitenden')));
assert(count($sk) === 4);
assert(count(array_unique(array_column($sk, 'wiki_key'))) === 4); // four DISTINCT keys
// ...and all four name the same place, so they group at one region.
foreach ($sk as $card) {
    assert($card['place_raw'] === 'Streitenden Königreiche');
}
// The prefix strippers that were missing: "Ingame-" needs the hyphen class, and the "geographischen
// Regionen der" qualifier has to go too or the place can never resolve.
$titles = array_column($sk, 'title');
sort($titles);
assert(str_contains($titles[0], 'Detaillierte'));

// MediaWiki puts display options BEFORE the caption; the caption is the LAST parameter.
$waldinseln = findCard($cards, 'Altoum und die Waldinseln', 'Landkartenset Meridiana', 'regional');
assert($waldinseln !== null);
assert($waldinseln['title'] === 'Altoum und die Waldinseln'); // NOT "thumb|100px|Altoum und die Waldinseln"
echo "kartenindex-collision ok\n";

// --------------------------------------- TEMPLATES CONTAINING "||" (THE SPLIT) ---
// REGRESSION. "{{Zwölfgöttliche Zeitrechnung|von=Hal|17||}}" contains a literal "||". Splitting the row
// before stripping templates tore the cell in half and shifted every column after it, producing a map
// titled "...|von=Hal|17" with note "Abmessungen: }}". 5 of the real page's rows look like this.
$row = "|Karte von Aventurien<br />gezeichnet im Jahre 17 Hal ({{Zwölfgöttliche Zeitrechnung|von=Hal|17||}})||42 x 56 cm ||1:6.000.000 ||[[Die Helden]] ||1984";
$cells = avesmapsCitymapSplitRow($row);
assert(count($cells) === 5);                                  // 5 columns, not 6 from a torn cell
assert(!str_contains($cells[0], '{{') && !str_contains($cells[0], '}}'));
assert(str_contains($cells[0], 'Aventurien gezeichnet'));     // <br /> became a SPACE, not nothing
assert($cells[1] === '42 x 56 cm');                           // the dimension column is where it belongs
assert($cells[2] === '1:6.000.000');
// Nested templates unwind too.
$cells = avesmapsCitymapSplitRow('|Das Imperium im Jahre {{IZ|4782 IZ}} ({{Zeitrechnung|von=IZ|4782||}}) || 34 x 39 cm || || [[Quelle]] ||');
assert(str_contains($cells[0], 'Das Imperium im Jahre'));
assert($cells[1] === '34 x 39 cm');
echo "template-split ok\n";

$page = <<<'WIKI'
==Aventurienkarten==
{| class="wikitable"
|-
| Aventurien (Großformat mit Farbtopografie) || 57 x 80 cm || ca. 1:4.250.000 || [[Aventurischer Atlas]] || 2005
|-
| Charta Mundi Jelhorathi Anno XIV Jeli ({{-|315 v. BF}}) ||21 x 30 cm || ||[[Die Dunklen Zeiten]] ||
|}
WIKI;
$cards = avesmapsCitymapParseKartenindex($page)['cards'];
// A legitimate parenthetical is part of the name and must survive (an earlier fix trimmed "()" blindly
// and ate the closing brace).
$gross = findCard($cards, 'Aventurien', 'Aventurischer Atlas', 'kontinent');
assert($gross !== null);
assert($gross['title'] === 'Aventurien (Großformat mit Farbtopografie)');
// A parenthetical that held ONLY a template leaves no empty "( )" behind.
$charta = null;
foreach ($cards as $c) {
    if (str_contains((string) $c['title'], 'Charta')) { $charta = $c; }
}
assert($charta !== null);
assert($charta['title'] === 'Charta Mundi Jelhorathi Anno XIV Jeli');
// Two continent maps from different publications keep distinct identities.
assert(count(array_unique(array_column($cards, 'wiki_key'))) === count($cards));
echo "kontinent-titles ok\n";

// ---------------------------------------------------------------------- DEDUP ---
$dupes = [
    ['wiki_key' => 'k1', 'author' => null, 'note' => 'N', 'is_labeled' => null, 'is_color' => 1, 'art' => null],
    ['wiki_key' => 'k1', 'author' => 'A', 'note' => null, 'is_labeled' => 1, 'is_color' => null, 'art' => null],
];
$deduped = avesmapsCitymapDedupeByWikiKey($dupes);
assert(count($deduped) === 1);
assert($deduped[0]['author'] === 'A');        // blanks filled from the twin rather than row order winning
assert($deduped[0]['note'] === 'N');
assert($deduped[0]['is_color'] === 1);
echo "dedupe ok\n";

// ------------------------------------------------------- RECONCILE PLAN ---
// The override-safety heart. Every rule here is one the owner named explicitly.
$desired = ['title' => 'Stadtplan von X (Q)', 'map_url' => 'https://de.wiki-aventurica.de/wiki/Q',
    'art' => null, 'is_color' => 1, 'is_labeled' => null, 'author' => 'Ina Kramer', 'note' => 'Format: A2'];

// No live row -> create.
$plan = avesmapsCitymapReconcilePlan(null, $desired);
assert($plan['action'] === 'create');
assert($plan['set']['title'] === 'Stadtplan von X (Q)');
assert($plan['set']['author'] === 'Ina Kramer');
// The index links no maps (they are book references), so the link is the publication's wiki page.
assert($plan['set']['map_url'] === 'https://de.wiki-aventurica.de/wiki/Q');
// A source we cannot link to must yield '' -- citymap.map_url is NOT NULL.
$noUrl = avesmapsCitymapReconcilePlan(null, ['title' => 'T'] + $desired);
assert(array_key_exists('map_url', $noUrl['set']));

// A wiki row that already matches -> NO-OP. This IS "zweiter Sync-Lauf legt KEINE Dubletten an".
$live = ['origin' => 'wiki', 'status' => 'approved', 'title' => 'Stadtplan von X (Q)',
    'map_url' => 'https://de.wiki-aventurica.de/wiki/Q', 'art' => null,
    'is_color' => 1, 'is_labeled' => null, 'author' => 'Ina Kramer', 'note' => 'Format: A2'];
$plan = avesmapsCitymapReconcilePlan($live, $desired);
assert($plan['action'] === 'noop');
assert($plan['set'] === []);

// A wiki row with a changed field -> only that field is written.
$live['author'] = 'Alt';
$plan = avesmapsCitymapReconcilePlan($live, $desired);
assert($plan['action'] === 'update');
assert($plan['set'] === ['author' => 'Ina Kramer']);

// NULL vs '' are both "unknown" -> no spurious write.
$plan = avesmapsCitymapReconcilePlan(
    ['origin' => 'wiki', 'status' => 'approved', 'title' => 'T', 'art' => null, 'is_color' => null,
     'is_labeled' => null, 'author' => '', 'note' => null],
    ['title' => 'T', 'art' => null, 'is_color' => null, 'is_labeled' => null, 'author' => null, 'note' => null]
);
assert($plan['action'] === 'noop');

// A MANUAL card is never touched -- this is how a hand edit protects itself.
$manual = $live;
$manual['origin'] = 'manual';
assert(avesmapsCitymapReconcilePlan($manual, $desired)['action'] === 'skip');
// A COMMUNITY card is not ours either.
$community = $live;
$community['origin'] = 'community';
assert(avesmapsCitymapReconcilePlan($community, $desired)['action'] === 'skip');
// A SUPPRESSED wiki card stays dead: resurrecting a tombstone is the bug 5a4ec69 fixed.
$tomb = $live;
$tomb['status'] = 'suppressed';
assert(avesmapsCitymapReconcilePlan($tomb, $desired)['action'] === 'skip');
echo "reconcile-plan ok\n";

// ------------------------------------------------------ REMOVABLE KEYS ---
$live = [
    ['wiki_key' => 'a', 'origin' => 'wiki', 'status' => 'approved'],      // still listed -> keep
    ['wiki_key' => 'gone', 'origin' => 'wiki', 'status' => 'approved'],   // wiki dropped it -> remove
    ['wiki_key' => 'm', 'origin' => 'manual', 'status' => 'approved'],    // manual -> never
    ['wiki_key' => 'c', 'origin' => 'community', 'status' => 'approved'], // community -> never
    ['wiki_key' => 't', 'origin' => 'wiki', 'status' => 'suppressed'],    // tombstone -> never
];
assert(avesmapsCitymapRemovableKeys($live, ['a']) === ['gone']);
// THE safety net: an empty catalog means "Dump holen" never ran. Removing everything then would wipe
// the whole wiki-born collection on a misfire.
assert(avesmapsCitymapRemovableKeys($live, []) === []);
echo "removable ok\n";

// ------------------------------------------------ RESOLVABLE DEPENDENCIES ---
// REGRESSION, and the expensive kind: the sync died with a 500 on the owner's first real run because
// avesmapsCitymapReconcileEntity called avesmapsUuidV4() -- which lives in map/features.php, a file the
// dump endpoint does NOT require. Three identical UUID helpers exist; only wiki/sync.php's is in that
// chain. Every test above passed, because a unit test never loads the endpoint's require chain.
//
// So: load what api/edit/wiki/dump.php loads, and assert every FOREIGN function this file calls is
// actually there. Catches the whole class (undefined function on the sync path), not just this one.
$chain = [
    '/../../political/territory.php',
    '/../sync.php',
    '/../../app/feature-sources.php',
    '/../publication-parsing.php',
    '/../publication-sync.php',
    '/../../app/adventures.php',
    '/../../app/adventure-resolve.php',
    '/../../app/citymaps.php',
    '/../dump-reader.php',
    '/../locations-helpers.php',
];
foreach ($chain as $relative) {
    $path = __DIR__ . $relative;
    if (is_file($path)) {
        require_once $path;
    }
}

// Every avesmaps* call in citymap-sync.php that the file does not define itself.
//
// Comments are stripped via the TOKENIZER first, not by regex over raw text: the fix for this very bug
// left a comment reading "NOT avesmapsUuidV4 (map/features.php)", and a plain text scan dutifully
// reported the warning against calling it as a call to it. A test that flags its own documentation is
// worse than no test -- it trains you to ignore it.
$raw = (string) file_get_contents(__DIR__ . '/../citymap-sync.php');
$source = '';
foreach (token_get_all($raw) as $token) {
    if (is_array($token)) {
        if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
            continue;
        }
        $source .= $token[1];
        continue;
    }
    $source .= $token;
}
preg_match_all('/\bavesmaps[A-Za-z0-9_]+(?=\s*\()/', $source, $calls);
preg_match_all('/^function\s+(avesmaps[A-Za-z0-9_]+)/m', $source, $defs);
$foreign = array_diff(array_unique($calls[0]), $defs[1]);
sort($foreign);
assert($foreign !== []); // the scan itself must find something, or this test is vacuous

$missing = [];
foreach ($foreign as $fn) {
    if (!function_exists($fn)) {
        $missing[] = $fn;
    }
}
assert($missing === [], 'Not in the dump endpoint require chain: ' . implode(', ', $missing));
// The specific trap, named: features.php is NOT loaded here, so this must never come back.
assert(in_array('avesmapsWikiSyncUuidV4', $foreign, true));
assert(!in_array('avesmapsUuidV4', $foreign, true));
echo 'deps ok (' . count($foreign) . " foreign functions, all resolvable)\n";

echo "\nALL CITYMAP-SYNC PARSER + RECONCILE TESTS PASSED\n";
