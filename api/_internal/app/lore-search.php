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
//
// 💣 Task 5 (Regeln in der Suche) DOES require lore-rule-match.php -- and that is allowed, unlike
// lore.php above, because it does not have the same cost. Measured before writing this line:
// lore-rule-match.php, lore-rule-store.php, lore-rule.php and climate-membership.php carry NO
// top-level code at all (only function/const/require_once/declare), and none of their readers
// calls avesmapsLoreRuleEnsureTables (that DDL lives ONLY behind editor endpoints). Requiring the
// file costs nothing at include time; the query cost is paid once per request in
// avesmapsFetchLoreRulePlacesByEntry below, which reads the stamp with a bare SELECT (never
// avesmapsEcosystemEnsureTables) and the whole rule/area inventory in a fixed number of queries --
// never one per area.
require_once __DIR__ . '/app-setting.php';
require_once __DIR__ . '/lore-rule-match.php';

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

/**
 * Mirrors avesmapsLoreKindDefaultEnabled: every kind is on unless a stored '0' says otherwise.
 *
 * 🪤 `spezies` was the exception here until 2026-08-19 -- see the reasoning at the original in
 * api/_internal/app/lore.php. 💣 The two copies must agree; __tests__/lore-kind-default-parity-test.php
 * is what keeps them from drifting apart, which would show a kind in the infobox and hide it from
 * the search without anything ever erroring.
 */
function avesmapsLoreSearchKindDefaultEnabled(string $kind): bool {
    return in_array($kind, AVESMAPS_LORE_SEARCH_KINDS, true);
}

/** '' = never written -> the kind's own default; '0' = off; anything else = on. */
function avesmapsLoreSearchKindIsEnabled(string $kind, string $storedValue): bool {
    $storedValue = trim($storedValue);

    return $storedValue === '' ? avesmapsLoreSearchKindDefaultEnabled($kind) : $storedValue !== '0';
}

/**
 * PURE. Maps a settingKey => value array (the shape avesmapsAppSettingGetManyWithoutDdl returns) to
 * the list of enabled kinds. A kind whose setting key is simply ABSENT from $stored (never written,
 * or the whole read degraded to []) falls back to its own default
 * (avesmapsLoreSearchKindDefaultEnabled) via avesmapsLoreSearchKindIsEnabled -- same rule as before,
 * just fed from a batch read instead of a query this function runs itself.
 *
 * @param array<string, string> $stored settingKey => stored value; a missing key means never written
 * @return list<string>
 */
function avesmapsLoreSearchEnabledKindsFromSettings(array $stored): array {
    $enabled = [];
    foreach (AVESMAPS_LORE_SEARCH_KINDS as $kind) {
        if (avesmapsLoreSearchKindIsEnabled($kind, $stored[avesmapsLoreSearchSettingKey($kind)] ?? '')) {
            $enabled[] = $kind;
        }
    }

    return $enabled;
}

/**
 * The kinds the search may show, read WITHOUT the self-healing DDL and in ONE query.
 *
 * 💣 Not avesmapsLoreEnabledKinds(): it calls avesmapsLoreKindEnabled four times, each of which runs
 * `CREATE TABLE IF NOT EXISTS app_setting` through avesmapsAppSettingGet. Four DDL statements per
 * keystroke. A missing app_setting table means nobody ever switched anything -> all defaults.
 *
 * Thin wrapper: avesmapsAppSettingGetManyWithoutDdl (api/_internal/app/app-setting.php) does the one
 * query, avesmapsLoreSearchEnabledKindsFromSettings (PURE, above) does the kind-by-kind default logic.
 * Kept separate so a caller that already read OTHER settings too (map-search.php: citymaps_enabled,
 * adventures_enabled) can fold all six keys into a SINGLE query instead of running this one on its own.
 *
 * @return list<string>
 */
function avesmapsLoreSearchEnabledKinds(PDO $pdo): array {
    $settingKeys = array_map('avesmapsLoreSearchSettingKey', AVESMAPS_LORE_SEARCH_KINDS);

    return avesmapsLoreSearchEnabledKindsFromSettings(avesmapsAppSettingGetManyWithoutDdl($pdo, $settingKeys));
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
 * Regeltreffer je Eintrag, als FLAECHEN -- fuer avesmapsBuildLoreSearchEntries's vierten
 * Parameter (Task 5). Nur Flaechen, keine Siedlungen: die Live-Vorschau einer Regel trifft 56
 * Flaechen UND 59 Siedlungen, macht 115 Namen in einer Suchzeile, die hoechstens drei zeigt --
 * die Flaeche beantwortet "wo waechst das", die Siedlung ist ihre Innenausstattung.
 *
 * 🔴 KURZSCHLUSS ZUERST (Fix-Runde 1, Befund 1 CRITICAL): dieser Pfad laeuft
 * TASTENDRUCK-GETAKTET (map-search.php ist "the site's hottest public path"). Eine kleine
 * Abfrage liest nur die entry_wiki_keys der aktiven Regeln (heute: eine Zeile); trifft KEINER
 * davon einen der $foundEntryWikiKeys -- die Eintraege, die dieser Suchlauf ueberhaupt zeigen
 * koennte ($loreRows['entries'] an der Aufrufstelle in map-search.php) --, kommt SOFORT [] zurueck:
 * keine Flaechen, keine Zonen, KEIN Stempel-Check. Der teure Teil (ganzer Regelbestand mit
 * Bedingungen, ganzer Flaechenbestand, Zonenreihenfolge, Schleife ueber ~830 Flaechen x wenige
 * Regeln REIN IM SPEICHER) laeuft nur noch, wenn der Kurzschluss eine echte Moeglichkeit zeigt.
 * Die allermeisten Anfragen kosten dann nur die eine kleine Abfrage oben.
 *
 * 🔴 Der Stempel (completed) wird ERST NACH dem Kurzschluss gelesen, nicht davor -- sonst waere
 * er selbst wieder eine Abfrage, die bei jedem Tastendruck liefe, auch wenn gar keine Regel in
 * Frage kommt. completed = 0 heisst: waehrend eines "Zugehoerigkeit rechnen"-Laufs sind die
 * Regeltabellen leer -> GAR KEINE Regelorte. Gelesen mit einem NACKTEN SELECT, wie api/app/lore.php
 * es vormacht (dort im Kommentar begruendet) -- nie ueber avesmapsEcosystemEnsureTables, dessen
 * information_schema-Sonden die Last sind, die den PHP-Worker-Pool am 17.07.2026 erschoepft hat
 * (AGENTS.md §10). Eine fehlende Stempeltabelle (nie gerechnet) faellt ins selbe catch -> [].
 *
 * Kettenauswertung ueber avesmapsLoreRuleChainMatchesSubject (lore-rule-match.php) -- Fix-Runde 1,
 * Befund 2: dieselbe Funktion, die auch avesmapsLoreRuleEntriesForSubject benutzt, statt die
 * links-nach-rechts-UND/ODER-Kette ein zweites Mal woertlich hinzuschreiben (Praezedenz-Regression
 * waere sonst nur in einer der beiden Kopien landbar gewesen und haette Suche und Infobox lautlos
 * auseinanderlaufen lassen).
 *
 * Task 7 erweitert den Rueckgabewert um `zones_by_entry`: die Vereinigung der Klimazonen, die die
 * Regeln eines Eintrags ueber ihre climate_from/climate_to-Bedingungen erlauben
 * (avesmapsLoreRuleZonesByEntry, lore-rule.php). Diese Zonenliste ist eine Aussage ueber die REGEL
 * selbst, nicht ueber gerechnete Flaechen-Ueberschneidungen -- sie haengt deshalb bewusst NICHT vom
 * `ecosystem_assignment_stamp` ab: ist der Stempel nicht gesetzt (Kurzschluss weiter unten), bleiben
 * die Flaechen leer, aber eine Regel mit einer Klimaspanne kennt ihre erlaubten Zonen trotzdem.
 *
 * @param list<string> $foundEntryWikiKeys wiki_key der Eintraege, die dieser Suchlauf ueberhaupt
 *   anzeigen koennte (Aufrufstelle: array_column($loreRows['entries'], 'wiki_key'))
 * @return array{places_by_entry: array<string, list<array{title: string, wiki_key: string, region_public_id: string}>>,
 *               zones_by_entry: array<string, list<string>>}
 */
function avesmapsFetchLoreRulePlacesByEntry(PDO $pdo, array $foundEntryWikiKeys): array {
    $empty = ['places_by_entry' => [], 'zones_by_entry' => []];
    if ($foundEntryWikiKeys === []) {
        return $empty;
    }

    try {
        $activeStatement = $pdo->query("SELECT DISTINCT entry_wiki_key FROM lore_rule WHERE status = 'active'");
        $activeEntryKeys = $activeStatement === false ? [] : $activeStatement->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable) {
        return $empty; // Tabelle fehlt (nie eingerichtet) -> kein Regelzweig, kein 500
    }
    if ($activeEntryKeys === [] || array_intersect($activeEntryKeys, $foundEntryWikiKeys) === []) {
        return $empty;
    }

    $rules = avesmapsLoreRuleReadAllActive($pdo);
    if ($rules === []) {
        return $empty;
    }

    // Einmal geholt, nie je Flaeche -- dieselbe Regel wie avesmapsLoreRuleEntriesForSubject.
    $orderedZoneKeys = avesmapsLoreRuleOrderedZoneKeys($pdo);

    // Task 7: die erlaubten Zonen je Eintrag sind eine Aussage ueber die REGEL, nicht ueber die
    // gerechneten Flaechen -- deshalb VOR dem Stempel-Check berechnet, statt hinter ihm zu haengen.
    $zonesByEntry = avesmapsLoreRuleZonesByEntry($rules, $orderedZoneKeys);

    try {
        $stampStatement = $pdo->query('SELECT completed FROM ecosystem_assignment_stamp WHERE id = 1');
        $stampValue = $stampStatement === false ? false : $stampStatement->fetchColumn();
        $stampCompleted = $stampValue !== false && (int) $stampValue === 1;
    } catch (Throwable) {
        // Tabelle fehlt (nie gerechnet) -> keine Flaechen, aber die Zonen (reine Regel-Aussage) bleiben.
        return ['places_by_entry' => [], 'zones_by_entry' => $zonesByEntry];
    }
    if (!$stampCompleted) {
        return ['places_by_entry' => [], 'zones_by_entry' => $zonesByEntry];
    }

    $areas = avesmapsLoreRuleReadAreas($pdo);
    if ($areas === []) {
        return ['places_by_entry' => [], 'zones_by_entry' => $zonesByEntry];
    }

    $placesByEntry = [];
    foreach ($areas as $area) {
        $subject = avesmapsLoreRuleSubjectFromArea($area);
        $place = [
            'title' => (string) ($area['name'] ?? ''),
            'wiki_key' => (string) ($area['wiki_region_key'] ?? ''),
            // Task 7: ein REGELORT bekommt seine region_public_id -- ein GENANNTER Ort
            // (avesmapsFetchLoreSearchRows -> lore_place) hat keine, denn dort steht keine Region.
            'region_public_id' => (string) ($area['public_id'] ?? ''),
        ];

        foreach ($rules as $rule) {
            if (avesmapsLoreRuleChainMatchesSubject($rule['terms'], $subject, $orderedZoneKeys)) {
                $placesByEntry[$rule['entry_wiki_key']][] = $place;
            }
        }
    }

    return ['places_by_entry' => $placesByEntry, 'zones_by_entry' => $zonesByEntry];
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
 * $rulePlacesByEntry carries the AREAS a Lebensraum-Regel matched for this entry (Task 5) --
 * same {title, wiki_key} shape as $placesByEntry, appended BEHIND the named places, never in
 * front: a named place is an editor's explicit statement, a rule hit is a derivation from it
 * (same ordering as the infobox, avesmapsLoreMergeRuleHitsIntoResult in lore.php). The client
 * cannot tell the two apart -- it never knew where a place came from -- so no extra field marks
 * the origin here either.
 *
 * $ruleZonesByEntry (Task 7) carries the UNION of climate zone keys an entry's rules allow, keyed by
 * entry_wiki_key -- attached to the ENTRY as `rule_zones`, never to an individual place: 57 places times
 * one identical zone list would be the same data 57 times over in the payload.
 *
 * @param array<string, list<array{title: string, wiki_key: string}>> $placesByEntry
 * @param array<string, string> $kindLabels
 * @param array<string, list<array{title: string, wiki_key: string, region_public_id?: string}>> $rulePlacesByEntry
 * @param array<string, list<string>> $ruleZonesByEntry
 * @return list<array<string, mixed>>
 */
function avesmapsBuildLoreSearchEntries(
    array $entryRows,
    array $placesByEntry,
    array $kindLabels,
    array $rulePlacesByEntry = [],
    array $ruleZonesByEntry = []
): array {
    $entries = [];
    foreach ($entryRows as $row) {
        $name = trim((string) ($row['name'] ?? ''));
        $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
        if ($name === '' || $wikiKey === '') {
            continue;
        }

        $kind = (string) ($row['kind'] ?? '');
        $kindLabel = $kindLabels[$kind] ?? $kind;
        // Named places FIRST, rule-matched areas behind -- see the docblock above.
        $places = array_merge($placesByEntry[$wikiKey] ?? [], $rulePlacesByEntry[$wikiKey] ?? []);
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
            // Task 7: the union of zone keys this entry's rules allow, Nord->Sued, per ENTRY -- an
            // entry without a rule gets [] (avesmapsLoreRuleZonesByEntry never emits a key for it).
            'rule_zones' => $ruleZonesByEntry[$wikiKey] ?? [],
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

/**
 * Tie-break comparator for the occurrence (Vorkommen) search section, passed to
 * avesmapsCollectSearchSection (api/_internal/app/search-section.php) as the $tieBreak callable:
 * placed before unplaced, then score, then name.
 */
function avesmapsLoreSearchCompare(array $left, array $right): int {
    // 31 % of occurrences carry no place at all (design §1.4). They stay findable -- being told
    // the thing exists beats hiding it -- but they never take a slot from one that can be shown.
    $placedDiff = ((int) (((int) $left['place_count']) === 0)) <=> ((int) (((int) $right['place_count']) === 0));
    if ($placedDiff !== 0) {
        return $placedDiff;
    }
    $scoreDiff = (int) $left['score'] <=> (int) $right['score'];
    return $scoreDiff !== 0 ? $scoreDiff : strnatcasecmp((string) $left['name'], (string) $right['name']);
}
