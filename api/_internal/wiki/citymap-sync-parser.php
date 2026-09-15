<?php

declare(strict_types=1);

// The Stadtplanindex and Kartenindex parsers -- wikitext table rows in, catalog rows out. PURE: no DB, no
// dump. The three rules they implement (identity from the old list, link target = full title, Myranor
// skipped) are explained in the header of citymap-sync.php, not repeated here.
// Split out of citymap-sync.php, which requires this file at the point the block used to sit (section 1,
// "PURE parser core"). The helpers they call there (avesmapsCitymapWikiKey, avesmapsCitymapUnescapeApostrophes,
// avesmapsCitymapStadtplanIdentityVariant) and the two AVESMAPS_CITYMAP_INDEX_* constants are defined first.
// avesmapsPoliticalSlug (political/territory.php) comes, as for the host, from the caller's require chain.
// Side-effect-free on include, like its host; __tests__/citymap-sync-test.php reaches it through the host.

/**
 * Split a wikitext table row into its cells. MediaWiki rows are "| a || b || c"; a leading "|" and
 * cell padding are dropped. Returns [] for anything that is not a data row (|-, |}, ! headers).
 *
 * TEMPLATES ARE STRIPPED BEFORE THE SPLIT, and that ordering is the whole point. A template with empty
 * trailing parameters contains a literal "||":
 *
 *     |Karte von Aventurien<br />gezeichnet im Jahre 17 Hal ({{Zwölfgöttliche Zeitrechnung|von=Hal|17||}})||42 x 56 cm ||…
 *                                                                                                   ^^ここ
 *
 * Splitting first tears that cell in half and shifts EVERY column after it -- which is how a map ended
 * up titled "…|von=Hal|17" with note "Abmessungen: }}". Measured on the real Kartenindex: 5 rows.
 * The loop handles nesting ({{IZ|4782 IZ}} inside a parenthetical); <br /> becomes a space rather than
 * vanishing, or "Aventurien<br />gezeichnet" would read "Aventuriengezeichnet".
 *
 * @return array<int, string>
 */
function avesmapsCitymapSplitRow(string $line): array
{
    $trimmed = trim($line);
    if ($trimmed === '' || $trimmed[0] !== '|') {
        return [];
    }
    if (str_starts_with($trimmed, '|-') || str_starts_with($trimmed, '|}') || str_starts_with($trimmed, '|+')) {
        return [];
    }

    $body = preg_replace('/^\|\s*/', '', $trimmed) ?? '';
    $body = preg_replace('/<br\s*\/?>/i', ' ', $body) ?? $body;
    $previous = null;
    while ($previous !== $body) {
        $previous = $body;
        $body = preg_replace('/\{\{[^{}]*\}\}/u', '', $body) ?? $body;
    }
    // A template that never closes on this line (the page has none today, but wikitext allows it)
    // would otherwise leave a dangling "{{…|a|b" to be split. Cut from the orphan brace on.
    $orphan = mb_strpos($body, '{{');
    if ($orphan !== false) {
        $body = mb_substr($body, 0, $orphan);
    }

    return array_map('trim', explode('||', $body));
}

/**
 * Every wikilink TARGET in a cell, in order. "[[Die Siebenwindkueste|VG2]]" yields "Die
 * Siebenwindkueste" -- the target, never the display text (rule 2: that IS the abbreviation table).
 *
 * @return array<int, string>
 */
function avesmapsCitymapExtractLinkTargets(string $cell): array
{
    if (preg_match_all('/\[\[\s*:?([^\]\|]+)/u', $cell, $matches) === false || empty($matches[1])) {
        return [];
    }

    $targets = [];
    foreach ($matches[1] as $target) {
        $clean = trim($target);
        if ($clean !== '') {
            $targets[] = $clean;
        }
    }

    return $targets;
}

/**
 * Cut a wikitext page into its == Sections ==, keyed by heading. Used to skip Myranor (rule 3) and
 * the Legende/Links prose without regex-ing across the whole page.
 *
 * @return array<string, string> heading => body
 */
function avesmapsCitymapExtractSections(string $wikitext): array
{
    $lines = preg_split('/\r?\n/', $wikitext) ?: [];
    $sections = [];
    $current = '';
    $buffer = [];

    foreach ($lines as $line) {
        if (preg_match('/^==+\s*([^=]+?)\s*==+\s*$/u', $line, $m) === 1) {
            if ($current !== '') {
                $sections[$current] = implode("\n", $buffer);
            }
            $current = trim($m[1]);
            $buffer = [];
            continue;
        }
        if ($current !== '') {
            $buffer[] = $line;
        }
    }
    if ($current !== '') {
        $sections[$current] = implode("\n", $buffer);
    }

    return $sections;
}

/** Myranor sections carry cities that are not on our map (0/12 resolve) -- rule 3. */
function avesmapsCitymapIsMyranorSection(string $heading): bool
{
    return stripos($heading, 'myran') !== false;
}

/**
 * The old Stadtplanindex table: "Stadt | Stadtplan (Farbe) | Stadtplan (s/w) | Umgebungskarte".
 * Column position encodes both the type and the colour mode -- that is the whole reason the variant is
 * part of the identity.
 *
 * @return array<int, array<string, mixed>>
 */
function avesmapsCitymapParseOldStadtplanRows(string $sectionBody): array
{
    // [variant, type_key, color_mode] per column index (1..3). NULL = unknown, never 'graustufen':
    // "nobody recorded whether it is coloured" is not "it is not coloured" (citymaps.php core rule).
    // 🔴 DIE WIKI-LISTE KENNT NUR ZWEI DER VIER STUFEN. 'braun' entsteht hier nie -- Brauntoene sind
    // ein reiner Handwert, und die Wiki-Tabelle hat keine Spalte dafuer (AVESMAPS_CITYMAP_COLOR_MODES).
    $columns = [
        1 => ['stadtplan-farbe', 'stadtplan', 'farbig'],
        2 => ['stadtplan-sw', 'stadtplan', 'graustufen'],
        3 => ['umgebung', 'uebersicht', null],
    ];

    $rows = [];
    foreach (preg_split('/\r?\n/', $sectionBody) ?: [] as $line) {
        $cells = avesmapsCitymapSplitRow($line);
        if (count($cells) < 2) {
            continue;
        }
        $cityTargets = avesmapsCitymapExtractLinkTargets($cells[0]);
        if ($cityTargets === []) {
            continue; // no linked city -> not a data row (legend rows land here too)
        }
        $city = $cityTargets[0];

        foreach ($columns as $index => [$variant, $typeKey, $colorMode]) {
            if (!isset($cells[$index])) {
                continue;
            }
            foreach (avesmapsCitymapExtractLinkTargets($cells[$index]) as $source) {
                $rows[] = [
                    'place_raw' => $city,
                    'source_raw' => $source,
                    'variant' => $variant,
                    'type_key' => $typeKey,
                    'color_mode' => $colorMode,
                    'is_labeled' => null,
                    // The old table has four columns and none of them is Format or Maßstab. Unknown ->
                    // NULL, and the new list may fill them in via avesmapsCitymapMergeStadtplanRows.
                    'format' => null,
                    'has_scale' => null,
                    'author' => null,
                    'note' => null,
                ];
            }
        }
    }

    return $rows;
}

/**
 * Split the new list's source cell into individual sources -- but ONLY where that is decidable.
 *
 * The parallel arrays are the only witness to how many sources a cell holds: "A2/-" means two. When
 * the comma count agrees with them, the split is trusted; when it disagrees (4 measured cases, e.g.
 * "Maerchenwaelder, Zauberfluesse" being ONE title inside a 3-source row) or when there is no
 * parallel array to ask (39 cells), the cell is taken WHOLE. Giving up beats guessing: a wrong split
 * invents sources that do not exist.
 *
 * @return array{sources: array<int, string>, split: bool}
 */
function avesmapsCitymapSplitSourceCell(string $sourceCell, string $formatCell): array
{
    $cell = trim($sourceCell);
    if ($cell === '' || $cell === '-') {
        return ['sources' => [], 'split' => false];
    }

    $expected = count(array_map('trim', explode('/', trim($formatCell))));
    if ($expected < 2) {
        return ['sources' => [$cell], 'split' => false]; // single source, or nothing to confirm a split
    }

    $parts = array_values(array_filter(array_map('trim', explode(',', $cell)), static fn(string $p): bool => $p !== ''));
    if (count($parts) !== $expected) {
        return ['sources' => [$cell], 'split' => false]; // length mismatch -> give up, keep it whole
    }

    return ['sources' => $parts, 'split' => true];
}

/**
 * Pick the i-th value of a parallel array ("A2/-"), or null when it is absent/"-" (= unknown).
 *
 * A field that carries NO parallel array applies to EVERY source of the row. The real page relies on
 * this: "IdDM, Al'Anfa und der tiefe Süden || Farbe || A2/- || Ja/- || - || Ina Kramer" splits into
 * two sources, but names the artist once -- she drew the one map that both publications printed.
 * Handing her only to the first source loses the attribution on the row that survives (found by
 * running the real page through this parser: 1 enrichment instead of 82).
 */
function avesmapsCitymapParallelValue(string $cell, int $index, bool $split): ?string
{
    $raw = trim($cell);
    // "-" means unknown, and the parallel-array form "-/-/-" means it for every source. Catching only
    // the bare "-" let an all-unknown array survive as a literal string: on a row whose source split
    // gave up (split=false keeps the cell whole) it was handed to `author` verbatim -- the real page
    // has one (Gareth/HdR, measured 2026-07-17). Stripping the separators leaves nothing exactly when
    // every slot is unknown; a real value ("A2/-", "33,5x25,5/-") always leaves something behind.
    if (trim($raw, " \t\n\r/-") === '') {
        return null;
    }
    if (!$split) {
        return $raw;
    }
    $parts = array_map('trim', explode('/', $raw));
    if (count($parts) === 1) {
        return $raw; // one value, many sources -> it describes all of them
    }
    $value = $parts[$index] ?? null;
    if ($value === null || $value === '' || $value === '-') {
        return null;
    }

    return $value;
}

/**
 * The new Stadtplanindex table: "Stadt | Quelle | Farbe | Format | Massstab | Notiz | Kuenstler".
 *
 * NB "Massstab" holds "Ja", not a scale -- it is a yes/no field. It goes to `note` as text; it must
 * never reach a numeric column. Same for "Format" (A2 / "33,5x25,5" cm): note, never width_px.
 *
 * @return array<int, array<string, mixed>>
 */
function avesmapsCitymapParseNewStadtplanRows(string $sectionBody): array
{
    $rows = [];
    foreach (preg_split('/\r?\n/', $sectionBody) ?: [] as $line) {
        $cells = avesmapsCitymapSplitRow($line);
        if (count($cells) < 3) {
            continue;
        }
        $city = trim($cells[0]);
        if ($city === '' || $city === '-' || str_starts_with($city, '!')) {
            continue;
        }

        $formatCell = $cells[3] ?? '';
        $split = avesmapsCitymapSplitSourceCell($cells[1] ?? '', $formatCell);
        if ($split['sources'] === []) {
            continue;
        }

        // Die Zelle sagt "Farbe" oder "s/w" und sonst nichts -- zwei der vier Stufen. 'braun' kann
        // von hier nie kommen; wer Brauntoene setzt, tut das im Editor, und dann steht die Zeile auf
        // origin='manual' und avesmapsCitymapReconcilePlan fasst sie nie wieder an.
        $colorCell = strtolower(trim($cells[2] ?? ''));
        $colorMode = null;
        if (str_contains($colorCell, 'farbe')) {
            $colorMode = 'farbig';
        } elseif ($colorCell === 'sw' || str_contains($colorCell, 's/w')) {
            $colorMode = 'graustufen';
        }
        // 🔴 DIE VARIANTE BLEIBT 'stadtplan-sw', AUCH WENN DER WERT JETZT 'graustufen' HEISST: sie ist
        // Teil des wiki_key und damit IDENTITAET, nicht Anzeige (AGENTS.md Paragraph 5 -- ein umbenannter
        // Schluessel bricht jeden Join, der ihn benutzt).
        $variant = $colorMode === 'farbig' ? 'stadtplan-farbe' : ($colorMode === 'graustufen' ? 'stadtplan-sw' : 'stadtplan');

        foreach ($split['sources'] as $i => $source) {
            $format = avesmapsCitymapParallelValue($formatCell, $i, $split['split']);
            $scale = avesmapsCitymapParallelValue($cells[4] ?? '', $i, $split['split']);
            $notice = avesmapsCitymapParallelValue($cells[5] ?? '', $i, $split['split']);
            $author = avesmapsCitymapParallelValue($cells[6] ?? '', $i, $split['split']);

            // Format and Maßstab used to be glued into `note` as "Format: A2 · Maßstab: Ja · Mit
            // Legende" -- three different kinds of thing in one string, none of them filterable and
            // none of them editable on their own. They are their own fields now, and `note` is a note
            // again. The ONLY thing that still reaches note from these two columns is a Maßstab value
            // we cannot read (see avesmapsCitymapScaleFromCell).
            $scaleRead = avesmapsCitymapScaleFromCell((string) $scale);

            $noteParts = [];
            if ($scaleRead['text'] !== null) {
                $noteParts[] = $scaleRead['text'];
            }
            if ($notice !== null) {
                $noteParts[] = $notice;
            }

            // "Mit Legende" is a strong signal, and the only one the table gives. Anything else stays
            // NULL = unknown rather than 0 -- absence of a note is not evidence of an unlabelled map.
            $isLabeled = ($notice !== null && stripos($notice, 'legende') !== false) ? 1 : null;

            $rows[] = [
                'place_raw' => $city,
                'source_raw' => $source,
                'variant' => $variant,
                'type_key' => 'stadtplan',
                'color_mode' => $colorMode,
                'is_labeled' => $isLabeled,
                // "A2", "33,5x25,5", "ca. 8,5 x 8,5 cm" -- centimetres and DIN names. A VARCHAR, never
                // width_px: those are pixels, and the wiki has never written one.
                'format' => $format,
                'has_scale' => $scaleRead['has_scale'],
                'author' => $author,
                'note' => $noteParts === [] ? null : implode(' · ', $noteParts),
            ];
        }
    }

    return $rows;
}

/**
 * Read a "Maßstab" cell into the tri-bool + whatever text the tri-bool cannot hold.
 *
 * THE COLUMN MEANS TWO DIFFERENT THINGS on the two index pages, and this is where that is reconciled
 * (measured on the real wikitext 2026-07-17 -- do not re-derive):
 *
 *   Stadtplanindex, "neue Liste" -> a YES/NO field. Of 230 rows: 70 "Ja", 36 "Nein", 81 "-",
 *     24 "Forum" (!), 18 parallel arrays. This is why the column is has_scale TINYINT(1) NULL and NOT
 *     a `scale VARCHAR`: the wiki is answering "does it have one?", not naming one.
 *   Kartenindex, continent tables -> a REAL scale, "1:12.750.000" / "ca. 1:6.400.000". 5 of 8 rows.
 *
 * Hence the two rules:
 *
 *   A SPELLED-OUT SCALE PROVES A SCALE -> has_scale = 1, and the string is handed back because it says
 *   strictly more than "yes" does. Losing "1:12.750.000" to a boolean would be a downgrade.
 *
 *   AN UNREADABLE VALUE STAYS UNKNOWN AND STAYS VISIBLE -> has_scale = null, text handed back (owner
 *   decision 2026-07-17). "Forum" is not a typo on one Andergast row -- it is 24 of 230, systematically
 *   entered, and nobody knows what it means. Swallowing it would hide a wiki error from the only people
 *   who could fix it; NULL-ing it silently would also violate the core rule (unknown != false).
 *
 * @return array{has_scale:?int, text:?string}
 */
function avesmapsCitymapScaleFromCell(string $cell): array
{
    $value = trim($cell);
    if ($value === '' || $value === '-') {
        return ['has_scale' => null, 'text' => null];
    }

    $key = mb_strtolower($value);
    if ($key === 'ja') {
        return ['has_scale' => 1, 'text' => null];
    }
    if ($key === 'nein') {
        return ['has_scale' => 0, 'text' => null];
    }
    // "1:6.000.000", "ca. 1:6.400.000". Digit-colon-digit is what a scale looks like and what nothing
    // else in this column looks like ("Forum", "Mit Nummern" carry no colon at all).
    if (preg_match('/\d\s*:\s*\d/u', $value) === 1) {
        return ['has_scale' => 1, 'text' => $value];
    }

    return ['has_scale' => null, 'text' => $value];
}

/**
 * Merge the two Stadtplanindex tables under rule 1.
 *
 * For a city the old list knows, the old list is the SOLE source of identity; a new-list row may only
 * enrich fields of a card whose source it actually matches. For a city the old list does not know,
 * the new list's rows become cards. This is what keeps Al'Anfa from appearing twice under two names
 * for one publication, while still covering the 69 cities only the new list carries.
 *
 * @param array<int, array<string, mixed>> $oldRows
 * @param array<int, array<string, mixed>> $newRows
 * @return array<int, array<string, mixed>>
 */
function avesmapsCitymapMergeStadtplanRows(array $oldRows, array $newRows): array
{
    $knownCities = [];
    foreach ($oldRows as $row) {
        $knownCities[avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes((string) $row['place_raw']))] = true;
    }

    // Index the old rows by (city, source) so a matching new row can enrich them. The variant is left
    // out on purpose: the new list encodes colour in its own column, and an enrichment that only
    // matches the identical variant would drop the author for the s/w twin of the same source.
    $enrichable = [];
    foreach ($oldRows as $i => $row) {
        $citySlug = avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes((string) $row['place_raw']));
        $sourceSlug = avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes((string) $row['source_raw']));
        $enrichable[$citySlug . '|' . $sourceSlug][] = $i;
    }

    $merged = $oldRows;
    foreach ($newRows as $row) {
        $citySlug = avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes((string) $row['place_raw']));
        $sourceSlug = avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes((string) $row['source_raw']));

        if (!isset($knownCities[$citySlug])) {
            $merged[] = $row; // city the old list never had -> the new list owns it
            continue;
        }

        $targets = $enrichable[$citySlug . '|' . $sourceSlug] ?? [];
        if ($targets === []) {
            // Known city, unmatched source name -> almost certainly the same publication under an
            // abbreviation ("IdDM"). Dropped by owner decision: no duplicate cards.
            continue;
        }
        foreach ($targets as $i) {
            // format/has_scale enrich exactly like author/note do: the old list cannot know them, the
            // new list often can. Only blanks are filled -- an old-list value is never overwritten.
            foreach (['author', 'note', 'is_labeled', 'format', 'has_scale'] as $field) {
                if ($merged[$i][$field] === null && $row[$field] !== null) {
                    $merged[$i][$field] = $row[$field];
                }
            }
        }
    }

    return $merged;
}

/**
 * Parse the Stadtplanindex page into finished card rows (identity + fields + title).
 *
 * @return array{cards: array<int, array<string, mixed>>, escaped_names_seen: int}
 */
function avesmapsCitymapParseStadtplanindex(string $wikitext): array
{
    $escapedSeen = substr_count($wikitext, "\\'");

    $oldRows = [];
    $newRows = [];
    foreach (avesmapsCitymapExtractSections($wikitext) as $heading => $body) {
        if (avesmapsCitymapIsMyranorSection($heading)) {
            continue; // rule 3
        }
        if (stripos($heading, 'neue Liste') !== false) {
            $newRows = array_merge($newRows, avesmapsCitymapParseNewStadtplanRows($body));
            continue;
        }
        if (stripos($heading, 'Städte') !== false || stripos($heading, 'Staedte') !== false) {
            $oldRows = array_merge($oldRows, avesmapsCitymapParseOldStadtplanRows($body));
        }
        // Legende / Bearbeitungshinweise / Links / Kurzbeschreibung: prose, skipped by construction.
    }

    $cards = [];
    foreach (avesmapsCitymapMergeStadtplanRows($oldRows, $newRows) as $row) {
        $place = avesmapsCitymapUnescapeApostrophes((string) $row['place_raw']);
        $source = avesmapsCitymapUnescapeApostrophes((string) $row['source_raw']);
        $variant = (string) $row['variant'];

        $label = $variant === 'umgebung' ? 'Umgebungskarte' : 'Stadtplan';
        $cards[] = [
            // Colour-agnostic identity: Farbe/s-w/unknown of one Stadtplan are ONE map (same title),
            // so they share a key and dedupe folds them. 'umgebung' stays distinct. (Discord/citymaps 2026-07-18)
            'wiki_key' => avesmapsCitymapWikiKey(AVESMAPS_CITYMAP_INDEX_STADTPLAN, $place, $source, avesmapsCitymapStadtplanIdentityVariant($variant)),
            'index' => AVESMAPS_CITYMAP_INDEX_STADTPLAN,
            'title' => $label . ' von ' . $place . ' (' . $source . ')',
            'place_raw' => $place,
            'source_raw' => $source,
            'variant' => $variant,
            'type_key' => (string) $row['type_key'],
            'art' => null,
            'color_mode' => $row['color_mode'],
            'is_labeled' => $row['is_labeled'],
            'format' => $row['format'] !== null ? avesmapsCitymapUnescapeApostrophes((string) $row['format']) : null,
            'has_scale' => $row['has_scale'],
            'author' => $row['author'] !== null ? avesmapsCitymapUnescapeApostrophes((string) $row['author']) : null,
            'note' => $row['note'] !== null ? avesmapsCitymapUnescapeApostrophes((string) $row['note']) : null,
        ];
    }

    return ['cards' => avesmapsCitymapDedupeByWikiKey($cards), 'escaped_names_seen' => $escapedSeen];
}

/**
 * Last line of defence for idempotency: a wiki_key must appear once. The wiki genuinely repeats rows
 * (Al'Anfa is listed twice in the new list), and a duplicate key would make the reconcile write the
 * same card twice in one run.
 *
 * @param array<int, array<string, mixed>> $cards
 * @return array<int, array<string, mixed>>
 */
function avesmapsCitymapDedupeByWikiKey(array $cards): array
{
    $byKey = [];
    foreach ($cards as $card) {
        $key = (string) $card['wiki_key'];
        if (!isset($byKey[$key])) {
            $byKey[$key] = $card;
            continue;
        }
        // Keep the richer row: fill blanks rather than let row order decide.
        foreach (['author', 'note', 'is_labeled', 'color_mode', 'art', 'format', 'has_scale'] as $field) {
            if (($byKey[$key][$field] ?? null) === null && ($card[$field] ?? null) !== null) {
                $byKey[$key][$field] = $card[$field];
            }
        }
    }

    return array_values($byKey);
}

/**
 * Map a Kartenindex title to our art vocabulary. The title names it ("Politische Karte der
 * Streitenden Koenigreiche" -> politisch). NULL = unknown, per the citymaps core rule.
 */
function avesmapsCitymapArtFromTitle(string $title): ?string
{
    $lower = mb_strtolower($title);
    if (str_contains($lower, 'politisch')) {
        return 'politisch';
    }
    if (str_contains($lower, 'topolog') || str_contains($lower, 'topograf') || str_contains($lower, 'topograph')) {
        return 'topologisch';
    }
    if (str_contains($lower, 'skizze')) {
        return 'skizze';
    }

    return null;
}

/**
 * Parse the Kartenindex page.
 *
 * Two very different halves:
 *   - Regionalkartenwerk (DSA3/4/5): the "Karte" column is a FILE link whose title names the region
 *     ("Politische Karte der Streitenden Koenigreiche (A2)") -> a card that hangs on that region.
 *   - Aventurienkarten / Derekarten: continent-wide and PLACELESS. Owner decision: they become cards
 *     whose place is the continent name as an UNRESOLVED place -- exactly like the 33 real gaps
 *     (Bosparan, Keft). No special path: the resolver tries, finds nothing, keeps raw_name.
 *
 * "Abmessungen" is CENTIMETRES ("43 x 57 cm"), not pixels -> note, never width_px/height_px.
 *
 * @return array{cards: array<int, array<string, mixed>>, escaped_names_seen: int}
 */
function avesmapsCitymapParseKartenindex(string $wikitext): array
{
    $escapedSeen = substr_count($wikitext, "\\'");
    $cards = [];

    foreach (avesmapsCitymapExtractSections($wikitext) as $heading => $body) {
        if (avesmapsCitymapIsMyranorSection($heading)) {
            continue; // rule 3
        }

        $continent = null;
        if (stripos($heading, 'Aventurienkarten') !== false) {
            $continent = 'Aventurien';
        } elseif (stripos($heading, 'Derekarten') !== false) {
            $continent = 'Dere';
        }

        if ($continent !== null) {
            $cards = array_merge($cards, avesmapsCitymapParseContinentRows($body, $continent));
            continue;
        }
        if (stripos($heading, 'Regionalkartenwerk') !== false) {
            $cards = array_merge($cards, avesmapsCitymapParseRegionalRows($body));
        }
        // Links / prose: skipped.
    }

    return ['cards' => avesmapsCitymapDedupeByWikiKey($cards), 'escaped_names_seen' => $escapedSeen];
}

/**
 * Continent-wide tables: "Beschreibung | Abmessungen | Massstab | Publikation(en) | Erstveroeffentlichung".
 *
 * @return array<int, array<string, mixed>>
 */
function avesmapsCitymapParseContinentRows(string $sectionBody, string $continent): array
{
    $cards = [];
    foreach (preg_split('/\r?\n/', $sectionBody) ?: [] as $line) {
        $cells = avesmapsCitymapSplitRow($line);
        if (count($cells) < 2) {
            continue;
        }
        // Templates and <br /> are already gone (avesmapsCitymapSplitRow strips them BEFORE splitting,
        // because their stray "||" would shift the columns). What is left here is link/quote markup.
        $description = trim(strip_tags($cells[0]));
        $description = trim(preg_replace('/\[\[[^\]\|]*\|([^\]]*)\]\]/u', '$1', $description) ?? $description);
        $description = trim(str_replace(['[[', ']]', "'''", "''"], '', $description));
        $description = trim(preg_replace('/\s+/u', ' ', $description) ?? $description);
        // Trim whitespace/commas, and an EMPTY parenthetical the template removal left behind ("Karte
        // ... ( )"). NOT a blanket "()" trim -- that ate the closing brace of "Aventurien (Grossformat
        // mit Farbtopografie)", which is a legitimate part of the name.
        $description = trim(preg_replace('/\s*\(\s*\)\s*$/u', '', $description) ?? $description);
        $description = trim($description, " \t\n\r,");
        if ($description === '' || $description === '-' || str_starts_with($description, '!')) {
            continue;
        }

        $sources = avesmapsCitymapExtractLinkTargets($cells[3] ?? '');
        $source = $sources[0] ?? trim($cells[3] ?? '');
        if ($source === '' || $source === '-') {
            continue; // a map we cannot attribute is a map we cannot show a reference for
        }

        // "Abmessungen" is CENTIMETRES ("43 x 57 cm") -> `format`, the SAME field the Stadtplanindex
        // fills with "33,5x25,5". Two column names, one measurement; splitting it across two columns by
        // which page delivered it is the divergence this change exists to remove. Never width_px.
        $dimensions = trim($cells[1] ?? '');
        $format = ($dimensions !== '' && $dimensions !== '-') ? $dimensions : null;

        // Unlike the Stadtplanindex, THIS page's Maßstab column holds a real scale ("1:12.750.000").
        // avesmapsCitymapScaleFromCell reads both shapes: it sets has_scale=1 and hands the string back,
        // which then stays visible in `note` -- a scale says more than "yes".
        $scaleRead = avesmapsCitymapScaleFromCell((string) ($cells[2] ?? ''));

        $noteParts = [];
        if ($scaleRead['text'] !== null) {
            $noteParts[] = 'Maßstab: ' . $scaleRead['text'];
        }
        $published = trim($cells[4] ?? '');
        if ($published !== '' && $published !== '-') {
            $noteParts[] = 'Erstveröffentlichung: ' . $published;
        }

        $cards[] = [
            // Identity = the DESCRIPTION, not the continent: one publication carries several
            // continent-wide maps ("Aventurien-Hexkarte" and "Aventurien (Grossformat)"), and keying
            // them on "Aventurien" would collapse them into one.
            'wiki_key' => avesmapsCitymapWikiKey(AVESMAPS_CITYMAP_INDEX_KARTEN, $description, $source, 'kontinent'),
            'index' => AVESMAPS_CITYMAP_INDEX_KARTEN,
            'title' => $description,
            'place_raw' => $continent, // resolves to nothing today -> unresolved, exactly like the real gaps
            'source_raw' => $source,
            'variant' => 'kontinent',
            'type_key' => 'uebersicht',
            'art' => avesmapsCitymapArtFromTitle($description),
            'color_mode' => null,
            'is_labeled' => null,
            'format' => $format,
            'has_scale' => $scaleRead['has_scale'],
            'author' => null,
            'note' => $noteParts === [] ? null : implode(' · ', $noteParts),
        ];
    }

    return $cards;
}

/**
 * Regionalkartenwerk tables: "Nr. | Karte | Publikation(en) | Veroeffentlichungsdatum", where "Karte"
 * is a file link whose TITLE names the region and the kind.
 *
 * @return array<int, array<string, mixed>>
 */
function avesmapsCitymapParseRegionalRows(string $sectionBody): array
{
    $cards = [];
    foreach (preg_split('/\r?\n/', $sectionBody) ?: [] as $line) {
        $cells = avesmapsCitymapSplitRow($line);
        if ($cells === []) {
            continue;
        }
        // The row may open with an empty "Nr." cell, so scan for the first cell holding a file link.
        $title = null;
        $cellIndex = null;
        foreach ($cells as $i => $cell) {
            $caption = avesmapsCitymapFileLinkCaption($cell);
            if ($caption !== null) {
                $title = $caption;
                $cellIndex = $i;
                break;
            }
        }
        if ($title === null || $title === '') {
            continue;
        }

        // The place is best-effort; the TITLE is the identity, so a miss here costs an unresolved
        // place, never a lost or merged card. Null means "the title carries no place we can name" ->
        // fall back to the whole title, which for 18 of 51 rows IS the region ("Altoum und die
        // Waldinseln"). Better an honest raw_name the resolver can try than a skipped row.
        $region = avesmapsCitymapRegionFromMapTitle($title) ?? $title;

        $sourceCell = $cells[$cellIndex + 1] ?? '';
        $sources = avesmapsCitymapExtractLinkTargets($sourceCell);
        $source = $sources[0] ?? trim($sourceCell);
        if ($source === '' || $source === '-') {
            continue;
        }

        $cards[] = [
            // Identity = TITLE, not region: one region+publication carries several distinct maps.
            'wiki_key' => avesmapsCitymapWikiKey(AVESMAPS_CITYMAP_INDEX_KARTEN, $title, $source, 'regional'),
            'index' => AVESMAPS_CITYMAP_INDEX_KARTEN,
            'title' => $title,
            'place_raw' => $region,
            'source_raw' => $source,
            'variant' => 'regional',
            'type_key' => 'region',
            'art' => avesmapsCitymapArtFromTitle($title),
            'color_mode' => null,
            'is_labeled' => null,
            // The regional table has no Abmessungen/Maßstab columns at all. (The format often hides in
            // the map's own title -- "Politische Karte der Flusslande (A2)" -- but that parenthetical is
            // load-bearing for the identity, and mining it would be guessing. Unknown stays unknown.)
            'format' => null,
            'has_scale' => null,
            'author' => null,
            'note' => null,
        ];
    }

    return $cards;
}

/**
 * The CAPTION of a wikitext file link, or null if the cell holds none.
 *
 * "[[Datei:X.jpg|Politische Karte der Flusslande (A2)]]" -> the caption.
 * "[[Datei:X.jpg|thumb|100px|DSA3-Kartenwerke]]"         -> "DSA3-Kartenwerke", NOT "thumb|100px|...".
 *
 * MediaWiki image syntax puts display options (thumb, 100px, left, ...) BEFORE the caption, and the
 * caption is the last parameter. Taking everything after the first pipe -- which is what a naive
 * `\|([^\]]+)\]\]` does -- yields "thumb|100px|DSA3-Kartenwerke" as the title. Measured on the real
 * Kartenindex: 2 of 51 rows.
 */
function avesmapsCitymapFileLinkCaption(string $cell): ?string
{
    if (preg_match('/\[\[\s*:?\s*(?:Datei|File|Bild|Image)\s*:([^\]]+)\]\]/ui', $cell, $m) !== 1) {
        return null;
    }
    $params = explode('|', $m[1]);
    array_shift($params); // the file name itself
    if ($params === []) {
        return null; // a bare file link has no caption to name the map
    }
    $caption = trim((string) array_pop($params));

    return $caption === '' ? null : $caption;
}

/**
 * Pull the place out of a Kartenindex map title: "Politische Karte der Flusslande (A2)" ->
 * "Flusslande". Strips a trailing format parenthetical, wiki templates, and a leading kind.
 *
 * BEST-EFFORT BY DESIGN, and safe to be so: since the TITLE is the identity (see
 * avesmapsCitymapWikiKey), a miss here only costs an unresolved place with the raw name kept -- the
 * same honest state the 33 real Stadtplanindex gaps land in. It can never merge or drop a card.
 *
 * The prefixes are the ones the page actually uses, counted rather than imagined: Uebersichtskarte
 * (12), Detaillierte Karte (6), Ingame-Karte (6), Politische Karte (3). Note "Ingame-Karte" needs the
 * hyphen class -- \w+\s+ does not match it, which is how "Ingame-Karte der Streitenden Koenigreiche"
 * survived as a "place" in the first pass.
 *
 * NOT handled on purpose: the bare genitive ("Detaillierte Karte Araniens" -> "Araniens", not
 * "Aranien"). De-inflecting German would be guessing dressed up as data; the recon's rule is "give up
 * instead of guessing". It stays unresolved and visible.
 */
function avesmapsCitymapRegionFromMapTitle(string $title): ?string
{
    $value = trim($title);
    // Wiki templates ({{-|315 v. BF}}, {{Zwoelfgoettliche Zeitrechnung|...}}) are markup, not names.
    $value = trim(preg_replace('/\{\{[^}]*\}\}/u', '', $value) ?? $value);
    $value = trim(preg_replace('/<br\s*\/?>/i', ' ', $value) ?? $value);
    $value = trim(preg_replace('/\s*\([^)]*\)\s*$/u', '', $value) ?? $value); // drop "(A2)"
    // "Uebersichtskarte der geographischen Regionen der X" -> "X": strip the qualifier too, else the
    // place becomes "geographischen Regionen der X" and can never resolve. The page writes this family
    // in three shapes, all measured on the live payload 2026-07-17 -- covering only the first left 7
    // cards carrying qualifier text as their "place": "Regionen"/"Region" (both numbers), a SECOND
    // family "politischen Einteilung", and the place following either DIRECTLY ("Region oestliches
    // Wuestenreich") instead of via von/des/der/dem -- hence the optional connector.
    $value = preg_replace('/^\s*(?:Übersichts|Uebersichts)karte\s+(?:der|über die|ueber die)\s+(?:geographischen\s+Region(?:en)?|politischen\s+Einteilung)\s+(?:(?:von|des|der|dem)\s+)?/ui', '', $value) ?? $value;
    $value = preg_replace(
        '/^\s*(?:[A-Za-zÄÖÜäöüß-]+\s+)?(?:Karte|Karten|Landkarte|Übersichtskarte|Uebersichtskarte|Ingame-Karte|Regionalkarte|Stadtplan)\s+(?:von|des|der|dem|zu|über die|ueber die)\s+/ui',
        '',
        $value
    ) ?? $value;
    $value = trim($value, " \t\n\r,");
    if ($value === '' || mb_strlen($value) < 3) {
        return null;
    }

    return $value;
}
