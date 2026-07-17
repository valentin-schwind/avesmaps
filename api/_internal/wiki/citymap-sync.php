<?php

declare(strict_types=1);

// Kartensammlung wiki sync -- the MISSING pipeline stages 1+2 for citymaps.
//
// The house pipeline is "Dump ziehen -> syncen (staging, override-safe) -> manuell pflegen". For the
// Kartensammlung stage 3 (html/citymap-editor.html) was built first; this file is stages 1+2. It mirrors
// api/_internal/wiki/adventure-sync.php one-to-one: build STAGING during "Dump holen" (the citymaps
// phase, dryRun), then an owner-triggered `sync_citymaps` action reconciles staging into production.
//
// Side-effect-free on include (function definitions only -- NO top-level code, NO require of a
// side-effectful file), so __tests__/citymap-sync-test.php can `require` it with no MySQL. Every
// DB function takes its dependencies as arguments and calls the other libraries at RUNTIME (the dump
// endpoint loads that chain before dispatch).
//
// WHERE THE DATA COMES FROM (measured 2026-07-16, see docs/superpowers/specs/
// 2026-07-16-kartensammlung-wiki-sync-{recon,design}.md -- do not re-derive, it costs two hours):
//
//   Stadtplanindex -- a CONCORDANCE, not an image collection. TWO overlapping tables:
//     old: "Stadt | Stadtplan (Farbe) | Stadtplan (s/w) | Umgebungskarte", sources are WIKILINKS.
//     new: "Stadt | Quelle | Farbe | Format | Massstab | Notiz | Kuenstler", sources are PLAIN TEXT.
//   Kartenindex -- Regionalkartenwerk tables (file links naming a region) + continent-wide tables.
//
// THE THREE RULES THAT MATTER, each one measured rather than assumed:
//
//   1. IDENTITY COMES FROM THE OLD LIST. The new list names 66% of its sources differently ("IdDM"
//      for "In den Dschungeln Meridianas"), and those abbreviations are NOT in the page's Legende --
//      they are unresolvable. Worse, its source cells are not reliably splittable at all: titles
//      contain commas ("Fuersten, Haendler, Intriganten" is ONE work), the separator flips to a
//      semicolon, and 17% of cells have a separator with no parallel array to confirm the count.
//      So: for a city the old list knows, the old list is the SOLE source of card identity. The new
//      list may only enrich fields (where its source matches) -- never add a card. Otherwise Al'Anfa
//      gets both "(IdDM)" and "(In den Dschungeln Meridianas)": two entries, one publication.
//      Cities the old list does NOT know (69 of them) come wholly from the new list.
//
//   2. THE LINK TARGET IS ALREADY THE FULL TITLE. The Legende maps [[Full Title|Abbrev]] -> Full
//      Title, so reading the link TARGET (not the display text) resolves "VG2"/"G1"/"Land" for free.
//      No legend parser needed.
//
//   3. MYRANOR IS SKIPPED. 0 of 12 Myranor cities resolve -- that continent is not on our map, so
//      those sections would only produce cards that can never appear anywhere.
//
// ESCAPING: the new list really does write `Al\'Anfa` (byte-verified U+005C U+0027, 13 occurrences,
// every one before an apostrophe). This is COSMETIC ONLY: avesmapsPoliticalSlug collapses RUNS of
// non-alphanumerics, so slug("Al'Anfa") === slug("Al\'Anfa") === "al-anfa", and the match key drops
// them entirely. Identity and place resolution are immune; only raw_name/title would show the
// backslash. Unescaping is therefore a no-op on a clean dump and safe on an escaped one -- which is
// why we can ship it before ever seeing the real dump (it is basic-auth, server-only). The citymaps
// phase counts `escaped_names_seen` so the first real "Dump holen" answers that question with a number.

// ===========================================================================
// 1. PURE parser core (DB-free, dump-free -- unit-tested)
// ===========================================================================

/** The two index pages we read. Values are the wiki_key namespace prefix, so a key names its origin. */
const AVESMAPS_CITYMAP_INDEX_STADTPLAN = 'stadtplanindex';
const AVESMAPS_CITYMAP_INDEX_KARTEN = 'kartenindex';

/** Wiki page titles the citymaps dump phase picks up. */
const AVESMAPS_CITYMAP_INDEX_PAGES = ['Stadtplanindex', 'Kartenindex'];

/** Bounded reconcile work per request (STRATO: no server-side loop). Mirrors the adventure budget. */
const AVESMAPS_CITYMAP_RECONCILE_STEP_BUDGET = 40;

/**
 * Strip the new list's backslash-before-apostrophe escaping. Cosmetic only (see the header note):
 * every one of the 13 backslashes in the page sits in front of an apostrophe, so there is no
 * legitimate backslash this could damage, and a clean dump makes it a no-op.
 */
function avesmapsCitymapUnescapeApostrophes(string $value): string
{
    return str_replace("\\'", "'", $value);
}

/** True when the value carries the new list's escaping -- counted, so the first real dump run tells us. */
function avesmapsCitymapHasEscaping(string $value): bool
{
    return str_contains($value, "\\'");
}

/**
 * The stable identity of a wiki-born map: index + identity + source + variant.
 *
 * WHAT $identity IS DIFFERS PER INDEX, because the two pages are shaped differently:
 *
 *   Stadtplanindex -> the CITY. It has no map titles at all, only "city x source x column", and the
 *     new list gives Format/Massstab/Kuenstler PER SOURCE as parallel arrays ("A2/-") -- i.e. the wiki
 *     itself models "one map per source". The variant must be in the key because one source can hold
 *     both a Stadtplan and an Umgebungskarte for the same city.
 *
 *   Kartenindex -> the map TITLE. It names its maps, and one region+publication legitimately carries
 *     SEVERAL of them ("Detaillierte Karte der Streitenden Koenigreiche (A2)" and "Politische Karte der
 *     Streitenden Koenigreiche (A3)" both live in Landkartenset Die Streitenden Koenigreiche). Keying
 *     those on the region collapsed them into one key and the dedupe silently ate the survivors --
 *     measured: 3 of 48 regional rows vanished, and fixing the region extractor would have made it
 *     worse, since better extraction means MORE rows sharing a region. The title is what distinguishes
 *     them, so the title is the identity.
 *
 * Runs through avesmapsPoliticalSlug (the house scheme, cf. avesmapsPublicationCatalogWikiKeyForTitle),
 * which is why the escaping cannot split a key.
 */
function avesmapsCitymapWikiKey(string $index, string $identity, string $source, string $variant): string
{
    $parts = [
        $index,
        avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes($identity)),
        avesmapsPoliticalSlug(avesmapsCitymapUnescapeApostrophes($source)),
        $variant,
    ];

    // 190 = the wiki_key column width. Truncating blind would risk two long rows colliding into one
    // key, so a key that would overflow keeps a short hash of the full value instead.
    $key = implode(':', $parts);
    if (strlen($key) <= 190) {
        return $key;
    }

    return substr($key, 0, 181) . '-' . substr(sha1($key), 0, 8);
}

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
 * Column position encodes both the type and is_color -- that is the whole reason the variant is part
 * of the identity.
 *
 * @return array<int, array<string, mixed>>
 */
function avesmapsCitymapParseOldStadtplanRows(string $sectionBody): array
{
    // [variant, type_key, is_color] per column index (1..3). NULL is_color = unknown, never 0:
    // "nobody recorded whether it is coloured" is not "it is not coloured" (citymaps.php core rule).
    $columns = [
        1 => ['stadtplan-farbe', 'stadtplan', 1],
        2 => ['stadtplan-sw', 'stadtplan', 0],
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

        foreach ($columns as $index => [$variant, $typeKey, $isColor]) {
            if (!isset($cells[$index])) {
                continue;
            }
            foreach (avesmapsCitymapExtractLinkTargets($cells[$index]) as $source) {
                $rows[] = [
                    'place_raw' => $city,
                    'source_raw' => $source,
                    'variant' => $variant,
                    'type_key' => $typeKey,
                    'is_color' => $isColor,
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

        $colorCell = strtolower(trim($cells[2] ?? ''));
        $isColor = null;
        if (str_contains($colorCell, 'farbe')) {
            $isColor = 1;
        } elseif ($colorCell === 'sw' || str_contains($colorCell, 's/w')) {
            $isColor = 0;
        }
        $variant = $isColor === 1 ? 'stadtplan-farbe' : ($isColor === 0 ? 'stadtplan-sw' : 'stadtplan');

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
                'is_color' => $isColor,
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
            'wiki_key' => avesmapsCitymapWikiKey(AVESMAPS_CITYMAP_INDEX_STADTPLAN, $place, $source, $variant),
            'index' => AVESMAPS_CITYMAP_INDEX_STADTPLAN,
            'title' => $label . ' von ' . $place . ' (' . $source . ')',
            'place_raw' => $place,
            'source_raw' => $source,
            'variant' => $variant,
            'type_key' => (string) $row['type_key'],
            'art' => null,
            'is_color' => $row['is_color'],
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
        foreach (['author', 'note', 'is_labeled', 'is_color', 'art', 'format', 'has_scale'] as $field) {
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
            'is_color' => null,
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
            'is_color' => null,
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
    // place becomes "geographischen Regionen der X" and can never resolve.
    $value = preg_replace('/^\s*(?:Übersichts|Uebersichts)karte\s+(?:der|über die|ueber die)\s+geographischen\s+Regionen\s+(?:von|des|der|dem)\s+/ui', '', $value) ?? $value;
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

// ===========================================================================
// 2. PURE reconcile core (DB-free -- the override-safety heart, unit-tested)
// ===========================================================================

/**
 * Decide what a single card's reconcile should do. PURE: no DB, no clock.
 *
 * The rules the owner set, and why each exists:
 *   - status 'suppressed' -> SKIP. The editor tombstoned this card; resurrecting it is exactly the
 *     bug the tombstone exists to prevent (cf. the 5a4ec69 fix to avesmapsSuppressCitymapPlace).
 *   - origin not 'wiki' -> SKIP. A manual/community card is not ours to touch. This is also how a
 *     hand edit protects itself: editing a wiki card adopts it to 'manual' (see the editor write),
 *     after which the sync lets it go.
 *   - no row yet -> CREATE.
 *   - origin 'wiki' -> UPDATE, but only the fields that actually differ, so a repeat sync is a
 *     true no-op (idempotency is the whole point: "zweiter Sync-Lauf legt KEINE Dubletten an").
 *
 * @param array<string,mixed>|null $current live citymap row (null = does not exist)
 * @param array<string,mixed>      $desired catalog row
 * @return array{action:string, set:array<string,mixed>}
 */
function avesmapsCitymapReconcilePlan(?array $current, array $desired): array
{
    // map_url is in here so a wiki card carries a link to its publication's wiki page (see
    // avesmapsCitymapWikiUrlForSource). It is still override-safe: the moment an editor touches the
    // card it becomes origin='manual' and this plan skips it entirely, so a hand-set link stands.
    // format/has_scale/publisher ride this list like every other field -- that is the whole reason they
    // live on the card rather than only on the publication: override-safety costs one entry each.
    // publisher is copied from the publication's {{Infobox Produkt}}|Verlag (see
    // avesmapsCitymapPublisherForSource) and is NOT the author: our own UI defines "Urheber" as who
    // DREW the map, and "Ulisses"/"Fanpro" is who printed the book it appeared in.
    $fields = ['title', 'map_url', 'art', 'is_color', 'is_labeled', 'format', 'has_scale', 'author',
        'publisher', 'note'];

    if ($current === null) {
        $set = [];
        foreach ($fields as $field) {
            $set[$field] = $desired[$field] ?? null;
        }

        return ['action' => 'create', 'set' => $set];
    }

    if ((string) ($current['status'] ?? '') === 'suppressed') {
        return ['action' => 'skip', 'set' => []]; // editor tombstone -- never resurrect
    }
    if ((string) ($current['origin'] ?? '') !== 'wiki') {
        return ['action' => 'skip', 'set' => []]; // manual/community -- not ours
    }

    $set = [];
    foreach ($fields as $field) {
        $now = $current[$field] ?? null;
        $want = $desired[$field] ?? null;
        // '' and null both mean "unknown" in this schema -> not a change worth a write.
        if (($now === null || $now === '') && ($want === null || $want === '')) {
            continue;
        }
        if ((string) $now !== (string) $want) {
            $set[$field] = $want;
        }
    }

    return ['action' => $set === [] ? 'noop' : 'update', 'set' => $set];
}

/**
 * Which live wiki-origin cards must go, given the catalog. PURE.
 *
 * Removal is scoped to origin='wiki' AND status='approved': a manual card, a community card and a
 * suppressed tombstone are never deleted. A card the wiki dropped is a card we drop.
 *
 * @param array<int, array{wiki_key:string, origin:string, status:string}> $liveRows
 * @param array<int, string> $catalogKeys
 * @return array<int, string> wiki_keys to remove
 */
function avesmapsCitymapRemovableKeys(array $liveRows, array $catalogKeys): array
{
    if ($catalogKeys === []) {
        // Empty catalog = "Dump holen" never ran (or ran empty). Treating that as "the wiki dropped
        // everything" would wipe the whole wiki-born collection on a misfire. Refuse instead.
        return [];
    }
    $keep = array_flip($catalogKeys);
    $remove = [];
    foreach ($liveRows as $row) {
        if (($row['origin'] ?? '') !== 'wiki' || ($row['status'] ?? '') !== 'approved') {
            continue;
        }
        $key = (string) ($row['wiki_key'] ?? '');
        if ($key !== '' && !isset($keep[$key])) {
            $remove[] = $key;
        }
    }

    return $remove;
}

/**
 * The label of a publication's shop link: the FUNDSTELLE, not the publication.
 *
 * docs/superpowers/specs/2026-07-17-karten-mehrfachlinks-design.md §7 left this open ("Wiki-Aventurica
 * oder der Publikationstitel?") and answered it in the same breath: "Der Titel der Karte nennt die
 * Publikation bereits". Every wiki card is titled "Stadtplan von X (Publikation)", so a link labelled
 * with the publication would repeat the title one line below it and tell the reader nothing new. The
 * label names where the link LANDS instead.
 *
 * The two hosts are the whole domain, not a sample: avesmapsPublicationChosenUrl builds chosen_url from
 * exactly two templates -- {{F-Shop|PID}} -> f-shop.de and {{PDF-Shop|ID}} -> ulisses-ebooks.de. An
 * unrecognised host keeps a neutral label rather than inventing a shop name it cannot know.
 */
function avesmapsCitymapShopLabel(string $url): string
{
    $host = mb_strtolower((string) parse_url($url, PHP_URL_HOST));
    if (str_contains($host, 'ulisses-ebooks')) {
        return 'PDF-Shop';
    }
    if (str_contains($host, 'f-shop')) {
        return 'F-Shop';
    }

    return 'Shop';
}

/** Wiki-born Fundstellen sort AFTER the editor's own list, which numbers itself up from 0. */
const AVESMAPS_CITYMAP_WIKI_LINK_SORT = 500;

/**
 * What to do with one card's wiki-born Fundstellen. PURE: no DB, no clock.
 *
 * Identity is the URL. A card carries at most a couple of wiki links and the URL is what the reader
 * actually follows, so two rows sharing a URL are a duplicate by definition -- exactly the "dieselbe URL
 * ein zweites Mal" the multilink spec §6.6 refused to ship.
 *
 * The override rules mirror avesmapsCitymapReconcilePlan, for the same reasons:
 *   - status 'suppressed' -> LEAVE ALONE. An editor tombstoned this Fundstelle; re-inserting or
 *     rewriting it is precisely the bug the tombstone exists to prevent.
 *   - a link the wiki no longer offers -> DELETE, but only ours and only while approved.
 *   - label/is_paid drift -> UPDATE, so a repeat sync stays a true no-op.
 *
 * Only wiki-origin rows may be passed in: a manual or community Fundstelle is not ours to plan for.
 *
 * @param array<int, array{id:int, url:string, label:string, is_paid:?int, status:string}> $current wiki-origin rows ONLY
 * @param array<int, array{url:string, label:string, is_paid:?int}> $desired
 * @return array{insert:array<int,array<string,mixed>>, update:array<int,array<string,mixed>>, delete:array<int,int>}
 */
function avesmapsCitymapWikiLinkPlan(array $current, array $desired): array
{
    $byUrl = [];
    foreach ($current as $row) {
        $byUrl[(string) $row['url']] = $row;
    }

    $insert = [];
    $update = [];
    $keep = [];
    foreach ($desired as $want) {
        $url = (string) $want['url'];
        $keep[$url] = true;
        $have = $byUrl[$url] ?? null;
        if ($have === null) {
            $insert[] = $want;
            continue;
        }
        if ((string) $have['status'] === 'suppressed') {
            continue; // tombstone -- never resurrect, never rewrite
        }
        $paidNow = $have['is_paid'] === null ? null : (int) $have['is_paid'];
        $paidWant = $want['is_paid'] === null ? null : (int) $want['is_paid'];
        if ((string) $have['label'] !== (string) $want['label'] || $paidNow !== $paidWant) {
            $update[] = ['id' => (int) $have['id'], 'label' => $want['label'], 'is_paid' => $want['is_paid']];
        }
    }

    $delete = [];
    foreach ($current as $row) {
        if (isset($keep[(string) $row['url']]) || (string) $row['status'] !== 'approved') {
            continue; // still wanted, or a tombstone that stays one
        }
        $delete[] = (int) $row['id'];
    }

    return ['insert' => $insert, 'update' => $update, 'delete' => $delete];
}

// ===========================================================================
// 3. Staging schema + dump build (STAGE 1 -- the "citymaps" phase of "Dump holen")
// ===========================================================================

/**
 * Self-healing staging schema. ONE table, not two: unlike an adventure (an ordered list of places),
 * a map depicts exactly ONE place, so a separate wiki_citymap_place_staging would be an empty
 * analogy -- place_raw lives in the catalog row.
 *
 * DELIBERATELY NOT in avesmapsCitymapsEnsureTables(): that runs on EVERY public read, and this DDL
 * is only ever needed on the owner's sync path. Making every page view pay for it is the
 * territories-endpoint.php mistake (AGENTS.md §10). Also adds citymap.wiki_key, the identity anchor.
 */
function avesmapsEnsureCitymapStagingTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_citymap_catalog (
            wiki_key VARCHAR(190) NOT NULL PRIMARY KEY,
            index_page VARCHAR(24) NOT NULL,
            title VARCHAR(300) NOT NULL,
            place_raw VARCHAR(300) NOT NULL,
            source_raw VARCHAR(300) NOT NULL,
            variant VARCHAR(24) NOT NULL,
            type_key VARCHAR(24) NOT NULL,
            art VARCHAR(24) NULL,
            is_color TINYINT(1) NULL,
            is_labeled TINYINT(1) NULL,
            format VARCHAR(120) NULL,
            has_scale TINYINT(1) NULL,
            author VARCHAR(300) NULL,
            note VARCHAR(2000) NULL,
            synced_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // format/has_scale: self-healing ALTER for a staging table that already exists in production (the
    // CREATE above is a no-op there). No publisher column here on purpose -- it does not come from the
    // index pages at all; the reconcile looks it up per card from wiki_publication_catalog, exactly as
    // it already does for map_url.
    $stagingColumn = static function (PDO $pdo, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wiki_citymap_catalog'
                AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    if (!$stagingColumn($pdo, 'format')) {
        $pdo->exec('ALTER TABLE wiki_citymap_catalog ADD COLUMN format VARCHAR(120) NULL AFTER is_labeled');
    }
    if (!$stagingColumn($pdo, 'has_scale')) {
        $pdo->exec('ALTER TABLE wiki_citymap_catalog ADD COLUMN has_scale TINYINT(1) NULL AFTER format');
    }

    // The live citymap/citymap_place tables (self-healing DDL in api/_internal/app/citymaps.php).
    if (function_exists('avesmapsCitymapsEnsureTables')) {
        avesmapsCitymapsEnsureTables($pdo);
    }

    // wiki_key: the identity anchor. Self-healing ALTER rather than part of the CREATE, because
    // `citymap` already exists in production where CREATE TABLE IF NOT EXISTS is a no-op (the same
    // reasoning as thumb_auto_url in citymaps.php). UNIQUE ignores NULLs in MySQL -> "unique once
    // set", so manual maps without a wiki page keep wiki_key = NULL (mirrors `adventure`).
    $stmt = $pdo->query(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'citymap' AND COLUMN_NAME = 'wiki_key'"
    );
    if ($stmt !== false && (int) $stmt->fetchColumn() === 0) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN wiki_key VARCHAR(190) NULL');
        $pdo->exec('ALTER TABLE citymap ADD UNIQUE KEY uq_citymap_wiki_key (wiki_key)');
    }
}

/** Test seam mirror of avesmapsAdventureDefaultPageSource: (dumpPath, skipPages) => page rows. */
function avesmapsCitymapDefaultPageSource(): callable
{
    return static function (string $path, int $skip): iterable {
        $reader = avesmapsWikiDumpOpenReader($path);
        try {
            yield from avesmapsWikiDumpIteratePages($reader, max(0, $skip));
        } finally {
            $reader->close();
        }
    };
}

/**
 * ONE bounded catalog-build step: walk the dump, and when a page IS one of the two index pages,
 * parse it into card rows and mirror them into staging (delete+insert per index, so a card the wiki
 * dropped disappears from staging too). STAGING-only -> safe under the dry "Dump holen".
 *
 * Unlike the adventure build there is no infobox to detect: we are looking for two specific PAGES,
 * so the scan is a title match and the whole page is consumed at once.
 *
 * @param callable|null $pageSource test seam: (dumpPath, skipPages) => iterable of page rows
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, found_this_step:int, escaped_names_seen:int}
 */
function avesmapsCitymapBuildCatalogStep(PDO $pdo, string $dumpPath, int $cursor = 0, ?callable $pageSource = null): array
{
    avesmapsEnsureCitymapStagingTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    $source = $pageSource ?? avesmapsCitymapDefaultPageSource();

    $pagesScanned = 0;
    $found = 0;
    $escapedSeen = 0;
    $streamExhausted = true;

    foreach ($source($dumpPath, max(0, $cursor)) as $page) {
        $pagesScanned++;

        $title = trim((string) ($page['title'] ?? ''));
        if ((int) ($page['ns'] ?? 0) === 0 && ($page['redirect'] ?? null) === null
            && in_array($title, AVESMAPS_CITYMAP_INDEX_PAGES, true)) {
            $wikitext = (string) ($page['wikitext'] ?? '');
            $parsed = $title === 'Stadtplanindex'
                ? avesmapsCitymapParseStadtplanindex($wikitext)
                : avesmapsCitymapParseKartenindex($wikitext);
            $escapedSeen += (int) $parsed['escaped_names_seen'];
            $found += avesmapsCitymapWriteStaging($pdo, $parsed['cards']);
        }

        if (microtime(true) >= $deadline) {
            $streamExhausted = false;
            break;
        }
    }

    return [
        'ok' => true,
        'done' => $streamExhausted,
        'nextCursor' => max(0, $cursor) + $pagesScanned,
        'pages_scanned' => $pagesScanned,
        'found_this_step' => $found,
        // Answers "does the real dump escape apostrophes like the API does?" on the first real run.
        'escaped_names_seen' => $escapedSeen,
    ];
}

/**
 * Mirror one index page's cards into staging: delete that index's rows, insert the parsed ones. The
 * delete is scoped by index_page so the two pages never clear each other.
 *
 * @param array<int, array<string, mixed>> $cards
 */
function avesmapsCitymapWriteStaging(PDO $pdo, array $cards): int
{
    if ($cards === []) {
        return 0;
    }
    $index = (string) $cards[0]['index'];

    $pdo->prepare('DELETE FROM wiki_citymap_catalog WHERE index_page = :ix')->execute(['ix' => $index]);
    $insert = $pdo->prepare(
        'INSERT INTO wiki_citymap_catalog
            (wiki_key, index_page, title, place_raw, source_raw, variant, type_key, art, is_color,
             is_labeled, format, has_scale, author, note, synced_at)
         VALUES (:wk, :ix, :title, :place, :source, :variant, :tk, :art, :color, :labeled, :format, :scale,
                 :author, :note, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            title = VALUES(title), place_raw = VALUES(place_raw), source_raw = VALUES(source_raw),
            variant = VALUES(variant), type_key = VALUES(type_key), art = VALUES(art),
            is_color = VALUES(is_color), is_labeled = VALUES(is_labeled), format = VALUES(format),
            has_scale = VALUES(has_scale), author = VALUES(author),
            note = VALUES(note), synced_at = CURRENT_TIMESTAMP(3)'
    );

    $written = 0;
    foreach ($cards as $card) {
        $insert->execute([
            'wk' => (string) $card['wiki_key'],
            'ix' => (string) $card['index'],
            'title' => mb_substr((string) $card['title'], 0, 300, 'UTF-8'),
            'place' => mb_substr((string) $card['place_raw'], 0, 300, 'UTF-8'),
            'source' => mb_substr((string) $card['source_raw'], 0, 300, 'UTF-8'),
            'variant' => (string) $card['variant'],
            'tk' => (string) $card['type_key'],
            'art' => $card['art'],
            'color' => $card['is_color'],
            'labeled' => $card['is_labeled'],
            'format' => $card['format'] !== null ? mb_substr((string) $card['format'], 0, 120, 'UTF-8') : null,
            'scale' => $card['has_scale'],
            'author' => $card['author'] !== null ? mb_substr((string) $card['author'], 0, 300, 'UTF-8') : null,
            'note' => $card['note'] !== null ? mb_substr((string) $card['note'], 0, 2000, 'UTF-8') : null,
        ]);
        $written++;
    }

    return $written;
}

// ===========================================================================
// 4. Reconcile (STAGE 2 -- the owner-triggered `sync_citymaps` action)
// ===========================================================================

/** Total staged cards -- the progress denominator for the client loop. */
function avesmapsCitymapCountCatalog(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM wiki_citymap_catalog')->fetchColumn();
}

/** app_setting key holding the last completed sync_citymaps run (UTC 'Y-m-d H:i:s'). */
const AVESMAPS_CITYMAP_LAST_SYNCED_SETTING = 'citymaps_last_synced';

/**
 * When the owner last ran "Karten syncen" to completion, or null if never.
 *
 * A single app_setting row rather than a citymap.synced_at column, on purpose: a per-card timestamp
 * would have to be written on EVERY card on EVERY run to mean "when did the sync last run" -- 419
 * writes to answer one question, and it would destroy the property that a repeat sync is a true no-op.
 * (The adventure sync can use MAX(synced_at) because its table already carries the column.)
 *
 * Distinct from avesmapsCitymapLastStaged, and both are needed: this one answers "when did I last
 * sync?" (the ribbon button), that one answers "is there anything staged TO sync?" (the editor button).
 * Showing the dump time next to a "Syncen" button would be a quiet lie.
 */
function avesmapsCitymapLastSynced(PDO $pdo): ?string
{
    if (!function_exists('avesmapsAppSettingGet')) {
        return null;
    }
    try {
        $value = trim(avesmapsAppSettingGet($pdo, AVESMAPS_CITYMAP_LAST_SYNCED_SETTING, ''));
    } catch (Throwable) {
        return null;
    }

    return $value === '' ? null : $value;
}

/**
 * When the staging catalog was last filled by "Dump holen", or null if never.
 *
 * NB this is the DUMP time, not the reconcile time -- deliberately. Before pressing "Karten syncen"
 * the question that matters is "is there anything staged to sync?", and an editor staring at
 * "Letzte Sync: nie" cannot tell whether the sync failed or the dump was simply never fetched. The
 * editor labels it accordingly. Returns null when the table does not exist yet (fresh deploy).
 */
function avesmapsCitymapLastStaged(PDO $pdo): ?string
{
    try {
        $value = $pdo->query('SELECT MAX(synced_at) FROM wiki_citymap_catalog')->fetchColumn();
    } catch (Throwable) {
        return null; // staging not created yet -> "Dump holen" has never run
    }

    return $value !== false && $value !== null ? (string) $value : null;
}

/**
 * The wiki page URL of a card's source publication, or '' when the source is not a publication we know.
 *
 * The index gives no link to the MAP itself -- it is a book reference, not an image ("Stadtplan von
 * Al'Anfa, zu finden in: Al'Anfa und der tiefe Süden"). The useful link is therefore the publication's
 * wiki page, which answers the question the entry actually raises: where do I find this map? (Owner
 * 2026-07-17: "wenn aus dem wiki, will ich oben den wiki link".)
 *
 * The URL is built from source_raw, NOT from the catalog's title column: that column holds the
 * {{Infobox Produkt}} DISPLAY title, which is not necessarily the page name. source_raw is the wikilink
 * TARGET out of the index -- which is the page name, by definition of a wikilink.
 *
 * The catalog lookup is the GUARD, not the data source: it only answers "is this a real publication
 * page?". That keeps the new list's abbreviations ("IdDM") from becoming links to pages that do not
 * exist -- they resolve to no catalog row, so they get no link at all.
 */
function avesmapsCitymapWikiUrlForSource(PDO $pdo, string $sourceRaw): string
{
    $source = trim($sourceRaw);
    if ($source === '' || !function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return '';
    }
    $key = avesmapsPublicationCatalogWikiKeyForTitle($source);
    if ($key === '') {
        return '';
    }

    try {
        $stmt = $pdo->prepare('SELECT 1 FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $key]);
        if ($stmt->fetchColumn() === false) {
            return ''; // not a known publication page -> no invented link
        }
    } catch (Throwable) {
        return ''; // publication staging absent (site without WikiSync) -> no link, no failure
    }

    // rawurlencode, then put '/' back: a page title may legitimately contain one ("Der Ork/Mensch-Krieg")
    // and %2F would 404. Mirrors the adventure catalog's wiki_url build.
    $url = AVESMAPS_WIKI_PAGE_BASE_URL . str_replace('%2F', '/', rawurlencode($source));

    return strlen($url) <= AVESMAPS_CITYMAP_URL_MAX ? $url : '';
}

/**
 * The publisher of a card's source publication ("Erschienen bei"), or null when we cannot know it.
 *
 * Same shape as avesmapsCitymapWikiUrlForSource, and same reason: the value belongs to the BOOK, the
 * lookup needs a DB, and the plan stays pure. The wiki puts it in {{Infobox Produkt}}|Verlag on the
 * publication page, which the publication sync already parses (see publication-parsing.php) -- so this
 * costs no new crawl, exactly like the F-Shop link before it.
 *
 * ⛔ This is NOT the author. Our own UI defines "Urheber" as who DREW the map
 * (js/map-features/map-features-citymaps-suggest.js); "Ulisses"/"Fanpro" is who printed the book it
 * appeared in. Writing it to `author` would have filled 419 maps with a wrong attribution.
 *
 * It is worth a column of its own because it VARIES -- measured on real pages 2026-07-17:
 * Geographia Aventurica -> Fanpro, Abenteuer Ausbau-Spiel -> Schmidt Spiele & Droemer Knaur,
 * Die Dunklen Zeiten -> Ulisses. Not "always Ulisses".
 */
function avesmapsCitymapPublisherForSource(PDO $pdo, string $sourceRaw): ?string
{
    if (!function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return null;
    }
    $key = avesmapsPublicationCatalogWikiKeyForTitle($sourceRaw);
    if ($key === '') {
        return null;
    }

    try {
        $stmt = $pdo->prepare('SELECT publisher FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $key]);
        $value = $stmt->fetchColumn();
    } catch (Throwable) {
        // Publication staging absent (a site without WikiSync), or the column not yet migrated on a
        // half-deployed server. A missing publisher is unknown, never a failed sync.
        return null;
    }
    if ($value === false || $value === null) {
        return null;
    }
    $publisher = trim((string) $value);

    return $publisher === '' ? null : mb_substr($publisher, 0, 160, 'UTF-8');
}

/**
 * Link a card to its publication in the SHARED source catalogue, with the SAME identity the
 * publication sync uses -- so a map's source and a settlement's source are one `sources` row, not two.
 *
 * The identity rule is copied from avesmapsPublicationDesiredLinksForEntity: a publication with a shop
 * link is identified by that URL, one without by its wiki_key. Deviating here would silently fork the
 * catalogue. A source name that is not a known publication gets NO link -- the title already names it.
 *
 * origin='wiki_publication' is mandatory: avesmapsFeatureSourceLink then never demotes a manual row
 * and never revives a suppressed tombstone.
 */
function avesmapsCitymapLinkSource(PDO $pdo, string $citymapPublicId, string $sourceRaw, int $userId): bool
{
    if (!function_exists('avesmapsFeatureSourceUpsert') || !function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return false; // publication layer absent -> the map still carries its source in the title
    }
    $sourceKey = avesmapsPublicationCatalogWikiKeyForTitle($sourceRaw);
    if ($sourceKey === '') {
        return false;
    }

    try {
        $stmt = $pdo->prepare('SELECT wiki_key, title, source_type, chosen_url, has_link FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $sourceKey]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return false; // not a known publication -> no invented source row
        }

        $chosenUrl = (int) ($row['has_link'] ?? 0) === 1 ? (string) ($row['chosen_url'] ?? '') : '';
        $sourceId = avesmapsFeatureSourceUpsert(
            $pdo,
            $chosenUrl,
            (string) ($row['title'] ?? $sourceRaw),
            (string) ($row['source_type'] ?? 'sonstiges'),
            true, // a wiki publication is an official source
            $userId,
            (string) ($row['wiki_key'] ?? '') // URL-less identity fallback (has_link=0)
        );
        if ($sourceId <= 0) {
            return false;
        }
        avesmapsFeatureSourceLink($pdo, 'citymap', $citymapPublicId, $sourceId, $userId, 'wiki_publication');

        return true;
    } catch (Throwable) {
        // The publication staging tables may not exist on a site without WikiSync. A missing source
        // line must not fail the whole card (same reasoning as the read side in citymaps.php).
        return false;
    }
}

/**
 * The Fundstellen the wiki offers for a card BESIDES map_url, shaped for avesmapsCitymapWikiLinkPlan.
 *
 * Today that is exactly one: the publication's SHOP link -- the wiki's "Erhältlich bei" row, which
 * {{Infobox Produkt}} renders from |Direktlinks={{F-Shop|PID=…}} (verified against the template source
 * 2026-07-17). The publication sync has been parsing it into wiki_publication_catalog.chosen_url all
 * along (avesmapsPublicationChosenUrl), so this costs no new crawl and no policy question -- the answer
 * to "erhältlich bei" was already in our own DB, it just never reached the card.
 *
 * NOT the publication's wiki page: that IS map_url already (avesmapsCitymapWikiUrlForSource), and
 * listing it a second time is exactly the duplicate the multilink spec §6.6 refused to ship.
 *
 * is_paid = 1 is a fact here, not the invention the §3.1 unknown-rule forbids: chosen_url is only ever
 * built from {{F-Shop}} or {{PDF-Shop}}, and both are purchase links. A publication with no shop link
 * yields NO Fundstelle rather than one with an is_paid we would have to guess.
 *
 * @return array<int, array{url:string, label:string, is_paid:?int}>
 */
function avesmapsCitymapDesiredWikiLinks(PDO $pdo, string $sourceRaw): array
{
    if (!function_exists('avesmapsPublicationCatalogWikiKeyForTitle')) {
        return [];
    }
    $key = avesmapsPublicationCatalogWikiKeyForTitle($sourceRaw);
    if ($key === '') {
        return [];
    }

    try {
        $stmt = $pdo->prepare('SELECT chosen_url, has_link FROM wiki_publication_catalog WHERE wiki_key = :wk LIMIT 1');
        $stmt->execute(['wk' => $key]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return []; // publication staging absent (site without WikiSync) -> no Fundstelle, never a failure
    }
    if ($row === false || (int) ($row['has_link'] ?? 0) !== 1) {
        return []; // has_link=0 covers the {{F-Shop|PID=NUMMER}} placeholder the parser already rejects
    }
    $url = trim((string) ($row['chosen_url'] ?? ''));
    if ($url === '' || strlen($url) > 500) {
        return []; // 500 = the citymap_link.url column width
    }

    return [['url' => $url, 'label' => avesmapsCitymapShopLabel($url), 'is_paid' => 1]];
}

/**
 * Write ONE card's wiki-born Fundstellen. Idempotent; returns the number of rows touched.
 *
 * Scoped to origin='wiki' at the SELECT and again at every write: a manual or community Fundstelle is
 * not ours. The editor cannot collide with this either -- set_links replaces the whole list but deletes
 * only its own 'manual' rows, and the detail read hands wiki rows to the read-only `foreign_links`
 * bucket, so they are shown but never posted back.
 */
function avesmapsCitymapReconcileWikiLinks(PDO $pdo, int $citymapId, string $sourceRaw): int
{
    $desired = avesmapsCitymapDesiredWikiLinks($pdo, $sourceRaw);

    $stmt = $pdo->prepare("SELECT id, url, label, is_paid, status FROM citymap_link WHERE citymap_id = :id AND origin = 'wiki'");
    $stmt->execute(['id' => $citymapId]);
    $current = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($current === [] && $desired === []) {
        return 0; // publication without a shop link: the common case, and it costs nothing
    }

    $plan = avesmapsCitymapWikiLinkPlan(
        array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'url' => (string) $r['url'],
            'label' => (string) $r['label'],
            'is_paid' => $r['is_paid'] === null ? null : (int) $r['is_paid'],
            'status' => (string) $r['status'],
        ], $current),
        $desired
    );

    $touched = 0;
    foreach ($plan['insert'] as $row) {
        $pdo->prepare(
            "INSERT INTO citymap_link (citymap_id, label, url, is_paid, sort_order, origin, status)
             VALUES (:id, :label, :url, :paid, :sort, 'wiki', 'approved')"
        )->execute([
            'id' => $citymapId,
            'label' => (string) $row['label'],
            'url' => (string) $row['url'],
            'paid' => $row['is_paid'],
            'sort' => AVESMAPS_CITYMAP_WIKI_LINK_SORT,
        ]);
        $touched++;
    }
    foreach ($plan['update'] as $row) {
        $pdo->prepare("UPDATE citymap_link SET label = :label, is_paid = :paid WHERE id = :id AND origin = 'wiki'")
            ->execute(['label' => (string) $row['label'], 'paid' => $row['is_paid'], 'id' => (int) $row['id']]);
        $touched++;
    }
    foreach ($plan['delete'] as $id) {
        $pdo->prepare("DELETE FROM citymap_link WHERE id = :id AND origin = 'wiki'")->execute(['id' => $id]);
        $touched++;
    }

    return $touched;
}

/**
 * Reconcile ONE staged card into the live tables. Idempotent; returns per-card counters.
 *
 * @param array<string,mixed> $catalog wiki_citymap_catalog row
 * @return array{created:int, updated:int, places_added:int, sources_linked:int, links_written:int}
 */
function avesmapsCitymapReconcileEntity(PDO $pdo, array $catalog, int $userId): array
{
    $counters = ['created' => 0, 'updated' => 0, 'places_added' => 0, 'sources_linked' => 0, 'links_written' => 0];
    $wikiKey = trim((string) ($catalog['wiki_key'] ?? ''));
    if ($wikiKey === '') {
        return $counters;
    }

    $find = $pdo->prepare(
        'SELECT id, public_id, origin, status, title, map_url, art, is_color, is_labeled, format,
                has_scale, author, publisher, note
           FROM citymap WHERE wiki_key = :wk LIMIT 1'
    );
    $find->execute(['wk' => $wikiKey]);
    $current = $find->fetch(PDO::FETCH_ASSOC) ?: null;

    // The catalog has no map_url of its own (the index links no maps, only books) -- derive it from the
    // source here, where a DB lookup is allowed. The plan itself stays pure. The publisher rides the
    // same path for the same reason: it lives on the BOOK page, not in the index.
    $desired = $catalog;
    $desired['map_url'] = avesmapsCitymapWikiUrlForSource($pdo, (string) ($catalog['source_raw'] ?? ''));
    $desired['publisher'] = avesmapsCitymapPublisherForSource($pdo, (string) ($catalog['source_raw'] ?? ''));

    $plan = avesmapsCitymapReconcilePlan($current, $desired);
    if ($plan['action'] === 'skip') {
        return $counters;
    }

    if ($plan['action'] === 'create') {
        // avesmapsWikiSyncUuidV4 (wiki/sync.php), NOT avesmapsUuidV4 (map/features.php): three identical
        // UUID helpers exist in this codebase, and only this one is in the dump endpoint's require
        // chain. Calling the features.php one here was a fatal "undefined function" on the sync path --
        // invisible in unit tests, because they never load the endpoint's chain. adventure-sync.php,
        // the template for this whole file, uses this same helper for exactly this reason.
        $publicId = avesmapsWikiSyncUuidV4();
        $pdo->prepare(
            "INSERT INTO citymap (public_id, wiki_key, title, map_url, art, is_color, is_labeled, format,
                                  has_scale, author, publisher, note,
                                  origin, status, map_license, thumb_license, created_by)
             VALUES (:pid, :wk, :title, :url, :art, :color, :labeled, :format, :scale, :author, :publisher,
                     :note, 'wiki', 'approved', 'unknown_other', 'unknown_other', NULL)"
        )->execute([
            'pid' => $publicId,
            'wk' => $wikiKey,
            'title' => (string) $plan['set']['title'],
            // NOT NULL DEFAULT '' -- a source we cannot link to yields '', never null.
            'url' => (string) ($plan['set']['map_url'] ?? ''),
            'art' => $plan['set']['art'],
            'color' => $plan['set']['is_color'],
            'labeled' => $plan['set']['is_labeled'],
            'format' => $plan['set']['format'],
            'scale' => $plan['set']['has_scale'],
            'author' => $plan['set']['author'],
            'publisher' => $plan['set']['publisher'],
            'note' => $plan['set']['note'],
        ]);
        $citymapId = (int) $pdo->lastInsertId();
        $counters['created'] = 1;

        // The type is a separate table (a map can carry several); the wiki gives exactly one.
        $pdo->prepare('INSERT IGNORE INTO citymap_type (citymap_id, type_key) VALUES (:id, :tk)')
            ->execute(['id' => $citymapId, 'tk' => (string) $catalog['type_key']]);
    } else {
        $citymapId = (int) $current['id'];
        $publicId = (string) $current['public_id'];
        if ($plan['action'] === 'update') {
            $sets = [];
            $params = ['id' => $citymapId];
            foreach ($plan['set'] as $field => $value) {
                $sets[] = $field . ' = :' . $field;
                $params[$field] = $value;
            }
            $pdo->prepare('UPDATE citymap SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);
            $counters['updated'] = 1;
        }
    }

    // The place. A map depicts exactly one, so this is an existence check rather than a list diff.
    // target_kind stays 'unresolved' with raw_name kept -- the shared resolver fills it in afterwards,
    // and a name we cannot resolve (Bosparan, or the placeless 'Aventurien') stays honestly unresolved.
    $placeExists = $pdo->prepare("SELECT id FROM citymap_place WHERE citymap_id = :id AND origin = 'wiki' LIMIT 1");
    $placeExists->execute(['id' => $citymapId]);
    if ($placeExists->fetchColumn() === false) {
        $pdo->prepare(
            "INSERT INTO citymap_place (citymap_id, sort_order, raw_name, target_kind, origin, status)
             VALUES (:id, 0, :rn, 'unresolved', 'wiki', 'approved')"
        )->execute(['id' => $citymapId, 'rn' => mb_substr((string) $catalog['place_raw'], 0, 300, 'UTF-8')]);
        $counters['places_added'] = 1;
    }

    if (avesmapsCitymapLinkSource($pdo, $publicId, (string) $catalog['source_raw'], $userId)) {
        $counters['sources_linked'] = 1;
    }

    // The Fundstellen (citymap_link), which is a different question from the source above: a source says
    // WHICH publication vouches for the map, a Fundstelle says WHERE the reader can get at it. The same
    // F-Shop URL answers both, and they are stored apart on purpose (see avesmapsCitymapLinks).
    $counters['links_written'] = avesmapsCitymapReconcileWikiLinks($pdo, $citymapId, (string) $catalog['source_raw']);

    return $counters;
}

/**
 * ONE bounded reconcile step over the staging catalog, resumable via a wiki_key high-water cursor.
 * Mirrors avesmapsAdventureReconcileStep: same budget shape, same "done" derivation, same
 * resolve-once-at-the-end. One bounded step per request (STRATO: no server-side loop).
 *
 * @return array{done:bool, nextCursor:string, created:int, updated:int, places_added:int,
 *               sources_linked:int, links_written:int, removed:int, processed:int}
 */
function avesmapsCitymapReconcileStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_CITYMAP_RECONCILE_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    avesmapsEnsureCitymapStagingTables($pdo);

    $select = $pdo->prepare('SELECT * FROM wiki_citymap_catalog WHERE wiki_key > :cur ORDER BY wiki_key ASC LIMIT :lim');
    $select->bindValue(':cur', $cursor, PDO::PARAM_STR);
    $select->bindValue(':lim', max(1, $budget), PDO::PARAM_INT);
    $select->execute();
    $catalogRows = $select->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $totals = ['created' => 0, 'updated' => 0, 'places_added' => 0, 'sources_linked' => 0, 'links_written' => 0, 'removed' => 0];
    $processed = 0;
    $nextCursor = $cursor;
    $timedOut = false;

    foreach ($catalogRows as $catalog) {
        $nextCursor = (string) $catalog['wiki_key'];
        $entity = avesmapsCitymapReconcileEntity($pdo, $catalog, $userId);
        foreach (['created', 'updated', 'places_added', 'sources_linked', 'links_written'] as $key) {
            $totals[$key] += (int) ($entity[$key] ?? 0);
        }
        $processed++;
        if (microtime(true) >= $deadline) {
            $timedOut = true;
            break;
        }
    }

    $done = !$timedOut && count($catalogRows) < $budget;

    if ($done) {
        // Stamp the run BEFORE the heavy tail work: this records "the owner ran a full sync", which is
        // true the moment the catalog is drained, whether or not anything changed.
        if (function_exists('avesmapsAppSettingSet')) {
            try {
                avesmapsAppSettingSet($pdo, AVESMAPS_CITYMAP_LAST_SYNCED_SETTING, gmdate('Y-m-d H:i:s'));
            } catch (Throwable) {
                // A missing timestamp is a cosmetic loss; it must never fail the reconcile itself.
            }
        }
        $totals['removed'] = avesmapsCitymapRemoveVanished($pdo);
        // Resolve freshly-added wiki place names -> entities, once, at the end (mirrors the adventures
        // reconcile). THIS is what makes the cards appear at their settlements, so it is not optional:
        // no function_exists guard, because a silently skipped resolve would look exactly like a
        // successful sync while every card stayed invisible. avesmapsResolvePlacesInTable already
        // whitelists 'citymap_place' -- the shared resolver, not a citymap-specific copy.
        avesmapsResolvePlacesInTable($pdo, 'citymap_place');
        if (function_exists('avesmapsWikiSyncNextMapRevision')) {
            avesmapsWikiSyncNextMapRevision($pdo); // bust the map-features ETag
        }
    }

    return [
        'done' => $done,
        'nextCursor' => $nextCursor,
        'created' => $totals['created'],
        'updated' => $totals['updated'],
        'places_added' => $totals['places_added'],
        'sources_linked' => $totals['sources_linked'],
        'links_written' => $totals['links_written'],
        'removed' => $totals['removed'],
        'processed' => $processed,
    ];
}

/**
 * Delete wiki-origin cards the wiki no longer lists. Runs once, when the reconcile has drained.
 * Scoped by avesmapsCitymapRemovableKeys (pure, tested): manual/community/suppressed rows survive,
 * and an EMPTY catalog removes nothing -- a misfired "Dump holen" must not wipe the collection.
 */
function avesmapsCitymapRemoveVanished(PDO $pdo): int
{
    $catalogKeys = $pdo->query('SELECT wiki_key FROM wiki_citymap_catalog')->fetchAll(PDO::FETCH_COLUMN) ?: [];
    $liveRows = $pdo->query("SELECT wiki_key, origin, status FROM citymap WHERE wiki_key IS NOT NULL")
        ->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $remove = avesmapsCitymapRemovableKeys(
        array_map(static fn(array $r): array => [
            'wiki_key' => (string) $r['wiki_key'],
            'origin' => (string) $r['origin'],
            'status' => (string) $r['status'],
        ], $liveRows),
        array_map('strval', $catalogKeys)
    );
    if ($remove === []) {
        return 0;
    }

    $removed = 0;
    $findId = $pdo->prepare('SELECT id FROM citymap WHERE wiki_key = :wk LIMIT 1');
    $delPlaces = $pdo->prepare('DELETE FROM citymap_place WHERE citymap_id = :id');
    $delTypes = $pdo->prepare('DELETE FROM citymap_type WHERE citymap_id = :id');
    $delCard = $pdo->prepare("DELETE FROM citymap WHERE id = :id AND origin = 'wiki'");
    foreach ($remove as $key) {
        $findId->execute(['wk' => $key]);
        $id = $findId->fetchColumn();
        if ($id === false) {
            continue;
        }
        $delPlaces->execute(['id' => (int) $id]);
        $delTypes->execute(['id' => (int) $id]);
        $delCard->execute(['id' => (int) $id]); // origin guard repeated at the DELETE, belt and braces
        $removed += $delCard->rowCount();
    }

    return $removed;
}
