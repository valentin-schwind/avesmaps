<?php

declare(strict_types=1);

/**
 * Innerorts vs. ausserorts -- one rule for buildings AND paths.
 * ===========================================================================
 * Wiki Aventurica describes plenty of objects that sit INSIDE a settlement:
 * the Webergasse in Khunchom, the Stadionmarkt in Gareth, the Rahja temple of
 * Grangor. None of them belongs on a world map whose smallest unit is the
 * settlement itself -- but they arrive through the very same sync as the
 * fortresses and roads that DO belong there, and then sit in the editors'
 * "Fehlt" lists as work that can never be completed.
 *
 * THE SIGNAL (measured, not guessed -- see the numbers below):
 *   Both infoboxes carry a location chain, coarse to fine, separated by ':'
 *   or wrapped in brackets:
 *
 *     Burg Fuerstenhort  |Standort= [[Koschberge]]: [[Greings Klamm]]
 *     Stadionmarkt       |Standort= [[Gareth]]: [[Arenaviertel]]
 *     Kaiser-Reto-Str.   |Regionen= [[Gareth]] ([[Alt-Gareth]])
 *
 *   As soon as a link in that chain names a settlement avesmaps ALREADY KNOWS,
 *   the object is inside it. That is a lookup against live data, not a name
 *   heuristic -- and it is the whole trick. Titles do NOT carry the signal:
 *   "X von <Stadt>" matches ~2100 wiki articles that are overwhelmingly people
 *   and events ("Aarian von Gareth", "Belagerung von Elenvina").
 *
 * MEASURED against the live map (2026-07-27), using the already-placed objects
 * as ground truth -- an object drawn on the world map is by definition outside:
 *   buildings: 1222 articles -> 528 inside, 688 outside, 6 ambiguous.
 *              3 of 105 placed buildings mis-filtered (2.9 %), and 2 of those 3
 *              really ARE inside (Festum's harbour bastion, a statue in
 *              Xorlosch) -- they were simply placed anyway.
 *   paths:      143 articles ->  10 inside, 132 outside, 1 ambiguous.
 *              0 of 92 drawn streets mis-filtered.
 *
 * TWO SAFEGUARDS, both load-bearing:
 *   1. AMBIGUOUS IS ITS OWN ANSWER. Some names are a settlement AND a region
 *      (Abagund, Paavi, Greifenfurt, Droel). Those are NOT filtered -- they are
 *      handed to the editor. A filter that silently swallows work is worse than
 *      no filter, because nobody can see what it took.
 *   2. AN OUTSKIRTS MARKER BEATS THE CHAIN. "[[Fairnhain]] (Umland)" names a
 *      settlement and still means "outside it". Plain-text markers win.
 *
 * Everything here except avesmapsPlaceScopeLoadIndex() is PURE -- no DB, no
 * globals -- so api/_internal/wiki/__tests__/place-scope-test.php can drive it
 * with no MySQL, which is the only kind of proof available on this machine.
 */

/** The object sits inside a settlement -> keep it off the world map. */
const AVESMAPS_PLACE_SCOPE_INSIDE = 'inside';

/** The object sits in open country -> it belongs on the world map. */
const AVESMAPS_PLACE_SCOPE_OUTSIDE = 'outside';

/**
 * The chain names something that is BOTH a settlement and a region/territory,
 * so the field cannot decide. Never filtered away -- shown to the editor.
 */
const AVESMAPS_PLACE_SCOPE_AMBIGUOUS = 'ambiguous';

/**
 * Plain-text markers that mean "near this settlement, not in it".
 *
 * 💣 These are matched against the text IMMEDIATELY AROUND ONE LINK, never
 * against the whole field. The difference is not cosmetic -- it is what makes
 * compass words usable at all:
 *
 *     "[[Streitende Königreiche]]: östlich von [[Andergast]]"  -> outside
 *     "[[Gareth]]: [[Nordquartier]], im nördlichen Stadtteil"  -> inside
 *
 * A field-wide match would read the second one as "outside" too and lose a real
 * in-town object. Scoped to the link, "östlich von" disqualifies only the link
 * it precedes. This was found by measurement: Burg Gnitzenbach ("östlich von
 * [[Andergast]]") was classified inside until the marker moved to the link.
 */
const AVESMAPS_PLACE_SCOPE_OUTSKIRTS_MARKERS = [
    'bei', 'nahe', 'unweit', 'ausserhalb', 'außerhalb', 'vor den toren', 'vor der stadt',
    'nördlich von', 'noerdlich von', 'südlich von', 'suedlich von', 'östlich von', 'oestlich von',
    'westlich von', 'nordöstlich von', 'nordwestlich von', 'südöstlich von', 'südwestlich von',
    'in der nähe von', 'in der naehe von', 'umgebung von', 'nahe bei',
];

/**
 * Markers that FOLLOW a link and mean the same thing, because German puts the
 * qualifier on either side: "[[Fairnhain]] (Umland)", "[[Gareth]], unweit der
 * Stadt".
 *
 * "bei" is deliberately absent here although it leads the prefix list: postposed
 * it is not a proximity word at all ("[[Gareth]] bei Nacht").
 */
const AVESMAPS_PLACE_SCOPE_OUTSKIRTS_SUFFIXES = [
    'umland', 'umgebung', 'umgegend', 'unweit', 'nahe', 'außerhalb', 'ausserhalb',
    'vor den toren', 'vor der stadt',
];

/**
 * How many characters before/after a link are inspected for a marker. One short
 * qualifier ("östlich von ") plus slack -- wide enough to catch the phrase,
 * narrow enough that a marker belonging to an EARLIER link in the chain cannot
 * leak onto this one.
 */
const AVESMAPS_PLACE_SCOPE_MARKER_WINDOW = 24;

/**
 * PURE: the link TARGETS of a location chain, in order, coarse to fine.
 *
 * Reads only the part before a '|' -- the article name, never the display text.
 * That is the conservative choice and it matters: "[[Bornland (Region)|Bornland]]"
 * must be read as the region article, not as the display word that happens to
 * collide with a settlement name.
 *
 * @return list<string> link targets, trimmed, empty ones dropped
 */
function avesmapsPlaceScopeExtractLinks(string $raw): array
{
    if (trim($raw) === '') {
        return [];
    }

    if (preg_match_all('/\[\[\s*([^\]\|#]+)/u', $raw, $matches) < 1) {
        return [];
    }

    $links = [];
    foreach ($matches[1] as $target) {
        $target = trim((string) $target);
        if ($target !== '') {
            $links[] = $target;
        }
    }

    return $links;
}

/**
 * PURE: the link targets of a chain WITH the text immediately around each one,
 * so a "near, not in" qualifier can be attributed to the link it modifies.
 *
 * `before` ends where the link starts; `after` starts where the link ends. Both
 * are clipped to AVESMAPS_PLACE_SCOPE_MARKER_WINDOW characters and, for
 * `before`, additionally cut at the previous link's end -- a qualifier belonging
 * to an earlier chain element must never leak onto this one.
 *
 * @return list<array{target:string, before:string, after:string}>
 */
function avesmapsPlaceScopeExtractLinksWithContext(string $raw): array
{
    if (trim($raw) === '') {
        return [];
    }
    if (preg_match_all('/\[\[\s*([^\]\|#]+)[^\]]*\]\]/u', $raw, $matches, PREG_OFFSET_CAPTURE) < 1) {
        return [];
    }

    $links = [];
    $previousEnd = 0;
    foreach ($matches[0] as $index => $whole) {
        $target = trim((string) $matches[1][$index][0]);
        if ($target === '') {
            continue;
        }

        $start = (int) $whole[1];
        $end = $start + strlen((string) $whole[0]);

        $beforeFrom = max($previousEnd, $start - AVESMAPS_PLACE_SCOPE_MARKER_WINDOW * 2);
        $before = substr($raw, $beforeFrom, max(0, $start - $beforeFrom));
        $after = substr($raw, $end, AVESMAPS_PLACE_SCOPE_MARKER_WINDOW * 2);

        $links[] = [
            'target' => $target,
            'before' => (string) $before,
            'after' => (string) $after,
        ];
        $previousEnd = $end;
    }

    return $links;
}

/**
 * PURE: is THIS link qualified as "near, not in"?
 *
 * `before` is searched for a leading qualifier ("östlich von", "bei"), `after`
 * for a trailing one ("(Umland)"). The before-check requires the marker to sit
 * at the very END of the preceding text (allowing punctuation/whitespace), so
 * "bei" inside an unrelated word or an earlier clause cannot fire.
 */
function avesmapsPlaceScopeLinkHasOutskirtsMarker(string $before, string $after): bool
{
    $tail = mb_strtolower(trim($before), 'UTF-8');
    $tail = (string) preg_replace('/[\s,;:\(\)\-–]+$/u', '', $tail);
    $tailLength = mb_strlen($tail, 'UTF-8');
    foreach (AVESMAPS_PLACE_SCOPE_OUTSKIRTS_MARKERS as $marker) {
        $markerLength = mb_strlen($marker, 'UTF-8');
        if ($markerLength === 0 || $tailLength < $markerLength) {
            continue;
        }
        if (mb_substr($tail, $tailLength - $markerLength, $markerLength, 'UTF-8') !== $marker) {
            continue;
        }
        // The marker IS the whole qualifier ("bei [[Punin]]") -- nothing precedes
        // it, so there is no word to be a suffix of.
        if ($tailLength === $markerLength) {
            return true;
        }
        // Otherwise it must stand as a whole word: the character in front of it
        // may not be a letter, or "Rabei" would end in "bei".
        $preceding = mb_substr($tail, $tailLength - $markerLength - 1, 1, 'UTF-8');
        if (preg_match('/[^\p{L}]/u', $preceding) === 1) {
            return true;
        }
    }

    $head = mb_strtolower(trim($after), 'UTF-8');
    $head = (string) preg_replace('/^[\s,;:\(\)\-–]+/u', '', $head);
    foreach (AVESMAPS_PLACE_SCOPE_OUTSKIRTS_SUFFIXES as $suffix) {
        if (mb_strpos($head, $suffix) === 0) {
            return true;
        }
    }

    return false;
}

/**
 * PURE: does the field carry a "near, not in" marker anywhere? Kept as a
 * convenience for callers that only need the yes/no; the classifier itself uses
 * the per-link check above, which is strictly more precise.
 */
function avesmapsPlaceScopeHasOutskirtsMarker(string $raw): bool
{
    foreach (avesmapsPlaceScopeExtractLinksWithContext($raw) as $link) {
        if (avesmapsPlaceScopeLinkHasOutskirtsMarker($link['before'], $link['after'])) {
            return true;
        }
    }

    return false;
}

/**
 * PURE: fold a place name into the form the index is keyed by. Lower-case and
 * whitespace-collapsed only.
 *
 * 💣 Deliberately NOT avesmapsFoldToAscii(): that fold is the wiki_key table and
 * drops umlauts to '?' (AGENTS.md §5). Here two DISPLAY names are compared with
 * each other, both coming from the same live rows, so folding non-ASCII away
 * would only create collisions ("Droel" vs "Drôl") that the raw comparison does
 * not have.
 */
function avesmapsPlaceScopeFoldName(string $name): string
{
    $name = preg_replace('/\s+/u', ' ', trim($name));

    return mb_strtolower((string) $name, 'UTF-8');
}

/**
 * PURE: build a lookup set from a list of names (folded => true).
 *
 * @param iterable<string> $names
 * @return array<string, bool>
 */
function avesmapsPlaceScopeBuildNameSet(iterable $names): array
{
    $set = [];
    foreach ($names as $name) {
        $folded = avesmapsPlaceScopeFoldName((string) $name);
        if ($folded !== '') {
            $set[$folded] = true;
        }
    }

    return $set;
}

/**
 * PURE: classify one location field.
 *
 * Order of decision, and each step is there for a measured reason:
 *   1. no field at all             -> outside (never filter on absent evidence)
 *   2. per link, coarse to fine:
 *      a. link carries a "near"
 *         qualifier                -> skip this link (safeguard 2)
 *      b. link is a settlement AND
 *         a region/territory       -> ambiguous (safeguard 1)
 *      c. link is a settlement     -> inside, and we know WHICH settlement
 *   3. no settlement in the chain  -> outside
 *
 * The chain is walked coarse-to-fine and the FIRST qualifying settlement wins,
 * because "[[Gareth]]: [[Arenaviertel]]" should report Gareth (a place avesmaps
 * knows), not the quarter (which it does not).
 *
 * 💣 Skipping a qualified link rather than rejecting the whole field is what
 * makes "[[Tobrien]]: bei [[Ilsur]]: [[Burgruine]]" behave: only the Ilsur hit
 * is disqualified, and a later genuine settlement in the same chain still
 * counts.
 *
 * @param array<string, bool> $settlementNames folded settlement names
 * @param array<string, bool> $regionNames     folded region/territory names
 * @return array{scope:string, settlement:string} settlement is '' unless inside/ambiguous
 */
function avesmapsPlaceScopeClassify(string $raw, array $settlementNames, array $regionNames): array
{
    $outside = ['scope' => AVESMAPS_PLACE_SCOPE_OUTSIDE, 'settlement' => ''];

    if (trim($raw) === '') {
        return $outside;
    }

    foreach (avesmapsPlaceScopeExtractLinksWithContext($raw) as $link) {
        $folded = avesmapsPlaceScopeFoldName($link['target']);
        if ($folded === '' || !isset($settlementNames[$folded])) {
            continue;
        }
        if (avesmapsPlaceScopeLinkHasOutskirtsMarker($link['before'], $link['after'])) {
            continue;
        }
        if (isset($regionNames[$folded])) {
            return ['scope' => AVESMAPS_PLACE_SCOPE_AMBIGUOUS, 'settlement' => $link['target']];
        }

        return ['scope' => AVESMAPS_PLACE_SCOPE_INSIDE, 'settlement' => $link['target']];
    }

    return $outside;
}

/**
 * PURE: the German label an editor sees for a scope value. The UI language is
 * German and stays German (AGENTS.md §8); the stored value stays English.
 */
function avesmapsPlaceScopeLabel(string $scope): string
{
    switch ($scope) {
        case AVESMAPS_PLACE_SCOPE_INSIDE:
            return 'innerorts';
        case AVESMAPS_PLACE_SCOPE_AMBIGUOUS:
            return 'unklar';
        default:
            return 'außerorts';
    }
}

/**
 * Load the two name sets the classifier needs, from live data.
 *
 * settlements: every placed location that is an actual settlement. gebaeude is
 *   EXCLUDED on purpose -- a building is not a container, and including them
 *   would let one building's name mark another building as "inside" it.
 * regions: region + label features AND political territories. Territories are
 *   what make the collision check work at all: Abagund and Droel are baronies
 *   that share their name with a settlement, and without the territory list
 *   they read as unambiguous settlements.
 *
 * Both queries are plain indexed reads over small columns and run ONCE per list
 * request -- never per row (STRATO, AGENTS.md §9).
 *
 * @return array{settlements:array<string,bool>, regions:array<string,bool>}
 */
function avesmapsPlaceScopeLoadIndex(PDO $pdo): array
{
    $settlementClasses = ['metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf'];
    $placeholders = implode(', ', array_fill(0, count($settlementClasses), '?'));

    $statement = $pdo->prepare(
        'SELECT name FROM map_features
          WHERE feature_type = ? AND is_active = 1 AND feature_subtype IN (' . $placeholders . ')'
    );
    $statement->execute(array_merge(['location'], $settlementClasses));
    $settlements = avesmapsPlaceScopeBuildNameSet($statement->fetchAll(PDO::FETCH_COLUMN) ?: []);

    $regionStatement = $pdo->query(
        "SELECT name FROM map_features WHERE feature_type IN ('region', 'label') AND is_active = 1"
    );
    $regionNames = $regionStatement !== false ? ($regionStatement->fetchAll(PDO::FETCH_COLUMN) ?: []) : [];

    // Territories live in their own table; a missing one (fresh install) must not
    // break the classifier, it only makes the collision check less sharp.
    try {
        $territoryStatement = $pdo->query('SELECT name FROM political_territory');
        if ($territoryStatement !== false) {
            $regionNames = array_merge($regionNames, $territoryStatement->fetchAll(PDO::FETCH_COLUMN) ?: []);
        }
    } catch (Throwable $exception) {
        // Intentionally ignored -- see above.
    }

    return [
        'settlements' => $settlements,
        'regions' => avesmapsPlaceScopeBuildNameSet($regionNames),
    ];
}

/**
 * Convenience: classify with an index produced by avesmapsPlaceScopeLoadIndex().
 * Keeps call sites from having to know the two array keys.
 *
 * @param array{settlements:array<string,bool>, regions:array<string,bool>} $index
 * @return array{scope:string, settlement:string}
 */
function avesmapsPlaceScopeClassifyWithIndex(string $raw, array $index): array
{
    return avesmapsPlaceScopeClassify(
        $raw,
        is_array($index['settlements'] ?? null) ? $index['settlements'] : [],
        is_array($index['regions'] ?? null) ? $index['regions'] : []
    );
}
