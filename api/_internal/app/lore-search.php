<?php

declare(strict_types=1);

// Vorkommen (Flora/Fauna/Spezies/Waren) as a search source. Design:
// docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md
//
// 💣 A lore place has NO resolved target. Unlike citymap_place and adventure_place, lore_place stores
// only place_wiki_key + place_title (design §1.6) -- the join to a map object happens at READ time via
// the object's wiki key. So this file ships both strings unresolved and the CLIENT resolves them: it
// holds every loaded object together with its wiki key, and it is the only side that knows what is on
// the map right now.
//
// 💣 This file deliberately does NOT require api/_internal/app/lore.php. avesmapsLoreReadCatalog opens
// with avesmapsLoreEnsureContinentColumn (an ALTER TABLE probe) and avesmapsLoreKindEnabled reads
// through avesmapsAppSettingGet (a CREATE TABLE IF NOT EXISTS per call, four calls per request). On a
// keystroke-debounced public path that is precisely the DDL load AGENTS.md §10 blames for the
// 2026-07-17 PHP-worker-pool exhaustion. The tables and the switch semantics are mirrored here instead
// -- the same choice citymap-search.php made with the citymap type table.
//
// The building function is PURE (rows in, entries out) so it is testable without a database.

// Mirrors AVESMAPS_LORE_KINDS in api/_internal/app/lore.php.
const AVESMAPS_LORE_SEARCH_KINDS = ['flora', 'fauna', 'spezies', 'ware'];

// Mirrors AVESMAPS_LORE_DIALOG_LABELS in js/map-features/map-features-lore.js. Singular here, because
// a search row names ONE occurrence -- the dialog headings are plural for a list.
const AVESMAPS_LORE_SEARCH_KIND_LABELS = [
    'flora' => 'Flora',
    'fauna' => 'Fauna',
    'spezies' => 'Spezies',
    'ware' => 'Ware',
];

/** Mirrors avesmapsLoreKindSettingKey in api/_internal/app/lore.php. */
function avesmapsLoreSearchSettingKey(string $kind): string {
    return 'lore_kind_' . $kind . '_enabled';
}

/** Mirrors avesmapsLoreKindDefaultEnabled: everything is on by default EXCEPT spezies. */
function avesmapsLoreSearchKindDefaultEnabled(string $kind): bool {
    return $kind !== 'spezies';
}

/** '' = never written -> the kind's own default; '0' = off; anything else = on. */
function avesmapsLoreSearchKindIsEnabled(string $kind, string $storedValue): bool {
    $storedValue = trim($storedValue);

    return $storedValue === '' ? avesmapsLoreSearchKindDefaultEnabled($kind) : $storedValue !== '0';
}

/**
 * The kinds the search may show, read WITHOUT the self-healing DDL and in ONE query.
 *
 * 💣 Not avesmapsLoreEnabledKinds(): it calls avesmapsLoreKindEnabled four times, each of which runs
 * `CREATE TABLE IF NOT EXISTS app_setting` through avesmapsAppSettingGet. Four DDL statements per
 * keystroke. A missing app_setting table means nobody ever switched anything -> all defaults.
 *
 * @return list<string>
 */
function avesmapsLoreSearchEnabledKinds(PDO $pdo): array {
    $settingKeys = [];
    foreach (AVESMAPS_LORE_SEARCH_KINDS as $kind) {
        $settingKeys[avesmapsLoreSearchSettingKey($kind)] = $kind;
    }

    $stored = [];
    try {
        $placeholders = implode(',', array_fill(0, count($settingKeys), '?'));
        $statement = $pdo->prepare(
            'SELECT setting_key, setting_value FROM app_setting WHERE setting_key IN (' . $placeholders . ')'
        );
        $statement->execute(array_keys($settingKeys));
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $stored[(string) $row['setting_key']] = (string) $row['setting_value'];
        }
    } catch (PDOException) {
        $stored = [];
    }

    $enabled = [];
    foreach ($settingKeys as $settingKey => $kind) {
        if (avesmapsLoreSearchKindIsEnabled($kind, $stored[$settingKey] ?? '')) {
            $enabled[] = $kind;
        }
    }

    return $enabled;
}

/**
 * Entries of the enabled kinds plus their places, in TWO queries -- never one per entry.
 *
 * The place query is deliberately unjoined: lore_place carries the entry key, so grouping in PHP costs
 * one pass and avoids a cross-table collation comparison (the trap feature_sources hit, see the note in
 * avesmapsLoreReadCatalog). Places of a disabled kind are fetched and then simply never attached.
 *
 * @param list<string> $enabledKinds
 * @return array{entries: list<array<string, mixed>>, places_by_entry: array<string, list<array{title: string, wiki_key: string}>>}
 */
function avesmapsFetchLoreSearchRows(PDO $pdo, array $enabledKinds): array {
    $empty = ['entries' => [], 'places_by_entry' => []];
    $enabledKinds = array_values(array_filter($enabledKinds, static fn (string $k): bool => $k !== ''));
    if ($enabledKinds === []) {
        return $empty;
    }

    try {
        $placeholders = implode(',', array_fill(0, count($enabledKinds), '?'));
        $statement = $pdo->prepare(
            "SELECT wiki_key, kind, name, COALESCE(gruppe, '') AS gruppe, COALESCE(typ, '') AS typ
             FROM lore_entry
             WHERE status = 'active' AND kind IN (" . $placeholders . ')'
        );
        $statement->execute($enabledKinds);
        $entries = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $placeStatement = $pdo->query(
            "SELECT entry_wiki_key, place_wiki_key, place_title
             FROM lore_place
             WHERE status = 'active'
             ORDER BY entry_wiki_key ASC, sort_order ASC"
        );
        $placeRows = $placeStatement !== false ? $placeStatement->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable) {
        return $empty; // tables missing (never synced) -> no occurrences in the search, not a 500
    }

    $placesByEntry = [];
    foreach ($placeRows as $row) {
        $placesByEntry[(string) $row['entry_wiki_key']][] = [
            'title' => (string) $row['place_title'],
            'wiki_key' => (string) $row['place_wiki_key'],
        ];
    }

    return ['entries' => $entries, 'places_by_entry' => $placesByEntry];
}

/**
 * "[[Fisch]]" -> "Fisch", "[[Seite|Anzeige]]" -> "Anzeige".
 *
 * gruppe and typ carry raw wiki links. Left in, the brackets become part of a search text nobody can
 * see in the UI, and a hit on "parfuem" looks unexplained.
 */
function avesmapsLoreSearchStripWikiMarkup(string $value): string {
    $stripped = preg_replace('/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/u', '$1', $value);

    return trim(str_replace(['[', ']'], '', $stripped ?? $value));
}

/**
 * PURE. Builds search entries from entry rows plus their places.
 *
 * @param array<string, list<array{title: string, wiki_key: string}>> $placesByEntry
 * @param array<string, string> $kindLabels
 * @return list<array<string, mixed>>
 */
function avesmapsBuildLoreSearchEntries(array $entryRows, array $placesByEntry, array $kindLabels): array {
    $entries = [];
    foreach ($entryRows as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
        if ($name === '' || $wikiKey === '') {
            continue;
        }

        $kind = (string) ($row['kind'] ?? '');
        $kindLabel = $kindLabels[$kind] ?? $kind;
        $places = $placesByEntry[$wikiKey] ?? [];
        $placeTitles = [];
        foreach ($places as $place) {
            $title = trim((string) ($place['title'] ?? ''));
            if ($title !== '') {
                $placeTitles[] = $title;
            }
        }

        $entries[] = [
            'kind' => 'lore',
            // A lore entry has no public id -- its wiki_key IS its identity (AGENTS.md §5).
            'public_id' => $wikiKey,
            'public_ids' => [$wikiKey],
            'name' => $name,
            'type_label' => $kindLabel,
            'feature_subtype' => $kind,
            // Unresolved on purpose: title AND wiki key travel, the client picks the map object.
            'lore_places' => $places,
            'place_count' => count($places),
            'not_on_map' => true,
            'min_x' => 0.0,
            'min_y' => 0.0,
            'max_x' => 0.0,
            'max_y' => 0.0,
            // lebensraum (78 of 500) and continent stay out: too thin to pay for the noise against
            // name, kind, group and the place list.
            'search_texts' => array_values(array_filter(array_merge(
                [
                    $name,
                    $kindLabel,
                    $kind,
                    avesmapsLoreSearchStripWikiMarkup((string) ($row['gruppe'] ?? '')),
                    avesmapsLoreSearchStripWikiMarkup((string) ($row['typ'] ?? '')),
                ],
                $placeTitles
            ))),
        ];
    }

    return $entries;
}
