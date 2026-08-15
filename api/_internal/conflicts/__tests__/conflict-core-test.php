<?php

declare(strict_types=1);

/**
 * Unit test for the conflict centre's pure core. No DB, no HTTP.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring \
 *       api/_internal/conflicts/__tests__/conflict-core-test.php
 * Exit 0 = all asserts passed.
 *
 * These four rules get a test rather than a comment because each one fails SILENTLY and in the
 * direction that makes the tool useless rather than broken -- the list still renders, it is just
 * full of noise nobody can act on. All figures below are live measurements from 2026-07-20.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op. "
        . "Re-run with: php -d zend.assertions=1 -d assert.exception=1 " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../core.php';

$SUBTYPES = ['Pfad', 'Weg', 'Gebirgspass', 'Strasse', 'Reichsstrasse', 'Seeweg', 'Flussweg', 'Wuestenpfad'];

// ---- 1. status is derived, never stored (§5a, owner definition) ---------------------------------
assert(avesmapsConflictStatus(true, null) === 'open');
assert(avesmapsConflictStatus(true, 'deferred') === 'deferred');
// "decided, but the conflict still stands" -> archived, and it must stay findable/restorable.
assert(avesmapsConflictStatus(true, 'ignored') === 'archived');
assert(avesmapsConflictStatus(true, 'resolved') === 'archived');
// "data repaired, the case remains as history" -- the detector no longer finds it.
assert(avesmapsConflictStatus(false, 'resolved') === 'done');
assert(avesmapsConflictStatus(false, 'deferred') === 'done');
// "genehmigt": the finding is right, the situation is legitimate (Maraskansund -- one sea, two bays,
// both need a label). Must NOT collapse into 'archived', which means "still wrong, left alone".
assert(avesmapsConflictStatus(true, 'approved') === 'approved');
assert(avesmapsConflictStatus(true, 'approved') !== avesmapsConflictStatus(true, 'ignored'));
assert(in_array('approved', AVESMAPS_CONFLICT_DECISIONS, true));

// ---- 2. the legitimacy table (§6a) -------------------------------------------------------------
// THE one legal pairing: the segments of a single road share one article by design.
assert(avesmapsConflictSharedWikiVerdict(['path', 'path']) === 'legitimate');
assert(avesmapsConflictSharedWikiVerdict(['path']) === 'legitimate');
// Everything else is a case -- Stadt vs. Baronie is a location and a territory (owner, 2026-07-20).
assert(avesmapsConflictSharedWikiVerdict(['location', 'location']) === 'error');
assert(avesmapsConflictSharedWikiVerdict(['location', 'territory']) === 'error');
assert(avesmapsConflictSharedWikiVerdict(['label', 'location']) === 'error');
assert(avesmapsConflictSharedWikiVerdict(['location', 'path']) === 'error');
// A mixed group is NOT rescued by containing paths.
assert(avesmapsConflictSharedWikiVerdict(['path', 'path', 'location']) === 'error');
// Dieselbe Bauform bei den Kraftlinien: eine Linie ist viele Segmente, und der Abgleich schreibt
// jedem denselben Artikel (Discord-Fall #71). Ohne diese Zeile kostet die Reparatur mehr als der
// Fehler: 69 falsche "kein Wiki-Schluessel" wuerden zu 13 Gruppen / 76 Objekten in der SCHWERSTEN
// Kategorie -- gemessen am Livebestand 15.08.2026, u.a. Basiliuslinie mit 16 Segmenten.
assert(avesmapsConflictSharedWikiVerdict(['powerline', 'powerline']) === 'legitimate');
assert(avesmapsConflictSharedWikiVerdict(['powerline']) === 'legitimate');
// Eine Kraftlinie und eine Strasse auf einem Artikel bleiben ein Fall -- das sind zwei Dinge.
assert(avesmapsConflictSharedWikiVerdict(['path', 'powerline']) === 'error');
assert(avesmapsConflictSharedWikiVerdict(['location', 'powerline']) === 'error');

// ---- 3. auto-names never reach the watchlist (§6b) ----------------------------------------------
// 2448 of 3721 linkless ways look like this. They cannot have a wiki counterpart, by construction.
assert(avesmapsConflictPathNameIsAuto('Reichsstrasse-3633', $SUBTYPES) === true);
assert(avesmapsConflictPathNameIsAuto('Weg-17', $SUBTYPES) === true);
assert(avesmapsConflictPathNameIsAuto('Weg', $SUBTYPES) === true);          // bare subtype word
assert(avesmapsConflictPathNameIsAuto('', $SUBTYPES) === true);
// Hand-given names must survive -- these 1178 are the entire point of the watchlist.
assert(avesmapsConflictPathNameIsAuto('Reichslandstraße von Havena nach Abilacht', $SUBTYPES) === false);
assert(avesmapsConflictPathNameIsAuto('Bernsteinroute', $SUBTYPES) === false);
assert(avesmapsConflictPathNameIsAuto('Yasamirer Stieg', $SUBTYPES) === false);
// A real name that merely CONTAINS a subtype word is not an auto-name.
assert(avesmapsConflictPathNameIsAuto('Alter Weg nach Gareth', $SUBTYPES) === false);
// ...and the counter must be the WHOLE tail, not a substring anywhere.
assert(avesmapsConflictPathNameIsAuto('Weg-17 nach Gareth', $SUBTYPES) === false);

// ---- 4. the collision detector ------------------------------------------------------------------
$rows = [
    // one road, three segments, one article -> legitimate, must NOT be reported (the 1547 trap)
    ['type' => 'path', 'id' => 'p1', 'label' => 'Reichsstraße 1', 'wiki_url' => 'https://w/Reichsstrasse_1'],
    ['type' => 'path', 'id' => 'p2', 'label' => 'Reichsstraße 1', 'wiki_url' => 'https://w/Reichsstrasse_1'],
    ['type' => 'path', 'id' => 'p3', 'label' => 'Reichsstraße 1', 'wiki_url' => 'https://w/Reichsstrasse_1'],
    // two settlements on one article -> error
    ['type' => 'location', 'id' => 'l1', 'label' => 'Feste Hohenstein', 'wiki_url' => 'https://w/Feste_Hohenstein'],
    ['type' => 'location', 'id' => 'l2', 'label' => 'Feste Hohenstein (Weiden)', 'wiki_url' => 'https://w/Feste_Hohenstein'],
    // the owner's Heldenweiler: a place and a territory on one article -> error, across types
    ['type' => 'location', 'id' => 'l3', 'label' => 'Heldenweiler', 'wiki_url' => 'https://w/Heldenweiler'],
    ['type' => 'territory', 'id' => 't1', 'label' => 'Heldenweiler', 'wiki_url' => 'https://w/Heldenweiler'],
    // a lone claim is never a conflict
    ['type' => 'location', 'id' => 'l4', 'label' => 'Gareth', 'wiki_url' => 'https://w/Gareth'],
    // rows without a url belong to the "no wiki key" rule, not here
    ['type' => 'location', 'id' => 'l5', 'label' => 'Namenlos', 'wiki_url' => ''],
];
$found = avesmapsConflictFindSharedWikiUrls($rows);
assert(count($found) === 2);
$urls = array_column($found, 'wiki_url');
sort($urls);
assert($urls === ['https://w/Feste_Hohenstein', 'https://w/Heldenweiler']);
foreach ($found as $conflict) {
    assert($conflict['severity'] === 'error');
    assert(count($conflict['parties']) === 2);
}

// ---- 4b. the article key: same page, different spelling -----------------------------------------
// The claim arrives in different shapes per table (map features vs territories vs adventures), so
// raw string comparison would let the same article miss itself and the rule would find nothing.
assert(avesmapsConflictArticleKey('https://w/wiki/Heldenweiler') === 'heldenweiler');
assert(avesmapsConflictArticleKey('https://w/wiki/Feste_Hohenstein') === 'feste hohenstein');
assert(avesmapsConflictArticleKey('https://w/wiki/Feste%20Hohenstein') === 'feste hohenstein');
assert(avesmapsConflictArticleKey('https://w/wiki/Feste_Hohenstein') === avesmapsConflictArticleKey('https://w/wiki/Feste%20Hohenstein'));
// Anchors and query strings are not part of the identity.
assert(avesmapsConflictArticleKey('https://w/wiki/Havena#Hafen') === 'havena');
// A non-wiki link keeps its whole URL: two objects on the same foreign link still collide.
assert(avesmapsConflictArticleKey('https://herzogtum-weiden.net/x/') === 'https://herzogtum-weiden.net/x');
assert(avesmapsConflictArticleKey('') === '');

// A territory and a settlement of the same name now actually meet -- they live in different tables
// and never did before (owner's "Heldenweiler").
$crossTable = [
    ['type' => 'location', 'id' => 'l1', 'label' => 'Heldenweiler', 'wiki_url' => 'https://w/wiki/Heldenweiler'],
    ['type' => 'territory', 'id' => 't1', 'label' => 'Heldenweiler', 'wiki_url' => 'https://w/wiki/Heldenweiler'],
];
$crossFound = avesmapsConflictFindSharedWikiUrls($crossTable);
assert(count($crossFound) === 1);
assert($crossFound[0]['severity'] === 'error');

// ---- 4c. wo ein Wiki-Anspruch stehen darf (Discord-Fall #71) ------------------------------------
// Diese Liste ist die EINZIGE Stelle, an der die Nester stehen -- sie stand vorher zweimal
// abgeschrieben da (rules.php und repair.php), und in beiden fehlte 'wiki_powerline'. Der
// Kraftlinien-Abgleich legt seinen Link ausschliesslich dort ab (api/_internal/wiki/powerlines.php:
// "Touches ONLY properties.wiki_powerline"), also sah die Regel wiki.missing_key ihn nie: live am
// 15.08.2026 meldete sie 144 Kraftlinien-Segmente als "kein Wiki-Schluessel", 69 davon MIT Link.
assert(avesmapsConflictExtractClaim([])['wiki_url'] === '');
assert(avesmapsConflictExtractClaim([])['claim_source'] === '');
// Das schlichte Feld gewinnt -- und nur es darf aus dem Konfliktzentrum geleert werden (repair.php).
$plainClaim = avesmapsConflictExtractClaim(['wiki_url' => 'https://w/wiki/A', 'wiki_powerline' => ['wiki_url' => 'https://w/wiki/B']]);
assert($plainClaim['wiki_url'] === 'https://w/wiki/A');
assert($plainClaim['claim_source'] === 'wiki_url');
assert(avesmapsConflictExtractClaim(['wiki_settlement' => ['wiki_url' => 'https://w/wiki/S']])['claim_source'] === 'wiki_settlement');
assert(avesmapsConflictExtractClaim(['wiki_region' => ['wiki_url' => 'https://w/wiki/R']])['claim_source'] === 'wiki_region');
assert(avesmapsConflictExtractClaim(['wiki_path' => ['wiki_url' => 'https://w/wiki/P']])['claim_source'] === 'wiki_path');
$powerlineClaim = avesmapsConflictExtractClaim(['wiki_powerline' => ['wiki_url' => 'https://w/wiki/Hexenband']]);
assert($powerlineClaim['wiki_url'] === 'https://w/wiki/Hexenband');
assert($powerlineClaim['claim_source'] === 'wiki_powerline');
// Ein Nest OHNE Link ist kein Anspruch: der Abgleich legt es auch dann an, wenn die Wiki-Seite
// keine URL hergibt -- 75 der 156 Segmente stehen genau so da und gehoeren zu Recht auf die Liste.
assert(avesmapsConflictExtractClaim(['wiki_powerline' => ['staerke' => 'kontinental', 'wiki_url' => '']])['claim_source'] === '');
assert(in_array('wiki_powerline', AVESMAPS_CONFLICT_CLAIM_BLOCKS, true));

// ---- 5. the fingerprint ------------------------------------------------------------------------
$a = [['type' => 'location', 'id' => 'l1'], ['type' => 'territory', 'id' => 't1']];
$b = [['type' => 'territory', 'id' => 't1'], ['type' => 'location', 'id' => 'l1']];
// Party ORDER must not matter -- otherwise every deferral dies on the next run because the query
// happened to return the rows the other way round.
assert(avesmapsConflictFingerprint('r', $a) === avesmapsConflictFingerprint('r', $b));
// Different rule, same parties -> different conflict.
assert(avesmapsConflictFingerprint('r1', $a) !== avesmapsConflictFingerprint('r2', $a));
// A changed FACT must reopen the case: that is the whole point of hanging decisions on this.
assert(avesmapsConflictFingerprint('r', $a, ['url' => 'x']) !== avesmapsConflictFingerprint('r', $a, ['url' => 'y']));
// ...but the same facts in a different key order must not.
assert(avesmapsConflictFingerprint('r', $a, ['x' => 1, 'y' => 2]) === avesmapsConflictFingerprint('r', $a, ['y' => 2, 'x' => 1]));
// A third party joining is a different conflict (4 places sharing an article is not the same case
// as 3 -- the editor must see it again).
$c = array_merge($a, [['type' => 'path', 'id' => 'p9']]);
assert(avesmapsConflictFingerprint('r', $a) !== avesmapsConflictFingerprint('r', $c));

// ---- 6. the speakable case number ---------------------------------------------------------------
// Editors talk about cases and were talking past each other; the number only helps if it is the
// SAME number next week, and if nobody mistypes it reading it aloud.
$printA = str_repeat("a", 64);
$printB = str_repeat("b", 64);
assert(avesmapsConflictShortId($printA) === avesmapsConflictShortId($printA));   // stabil
assert(avesmapsConflictShortId($printA) !== avesmapsConflictShortId($printB));
assert(strlen(avesmapsConflictShortId($printA)) === 6);
// Kein I, L, O oder U -- genau die Zeichen, die beim Vorlesen verwechselt werden.
assert(preg_match("/^[0-9A-HJKMNP-TV-Z]{6}$/", avesmapsConflictShortId($printA)) === 1);
// Ueber viele Faelle hinweg keine auffaellige Haeufung (grobe Streuungspruefung).
$seen = [];
for ($i = 0; $i < 4000; $i++) { $seen[avesmapsConflictShortId(hash("sha256", (string) $i))] = true; }
assert(count($seen) > 3980);

fwrite(STDOUT, "conflict-core-test: alle Zusicherungen erfuellt\n");
