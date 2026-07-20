<?php

declare(strict_types=1);

/**
 * Conflict centre -- rule registry.
 * =========================================================================
 * Every rule is deterministic: SQL plus the pure helpers in core.php. Nothing here guesses, and
 * nothing here writes -- detection is machine work, deciding is editor work
 * (docs/konfliktmanagement-design.md §3).
 *
 * DETECTION RUNS ON THE RAW STORED DATA, not on the enriched map-features payload. That matters:
 * avesmapsEnrichMapFeatureWikiUrl() invents a wiki_url by name when the column is empty, so the
 * payload shows collisions that exist only at request time. Those are an enrichment defect (fixed
 * separately in P3), not a data conflict, and mixing them in would tell an editor to repair a row
 * that is already empty. Consequence to expect: this rule finds FEWER settlement collisions than
 * the 2026-07-20 payload measurement (12 groups) -- the difference is exactly the 7 runtime-guessed
 * ones, which have nothing stored to repair.
 */

require_once __DIR__ . '/core.php';

// PATH_SUBTYPE_KEYS as they appear in map_features.feature_subtype (AGENTS.md §2).
const AVESMAPS_CONFLICT_PATH_SUBTYPES = ['Pfad', 'Weg', 'Gebirgspass', 'Strasse', 'Reichsstrasse', 'Seeweg', 'Flussweg', 'Wuestenpfad'];

// Which feature_type maps to which conflict-party type. Crossings/junctions carry no wiki identity.
const AVESMAPS_CONFLICT_FEATURE_TYPES = [
    'location' => 'location',
    'path' => 'path',
    'label' => 'label',
    'powerline' => 'powerline',
];

/**
 * Human labels for the party types. German -- these reach the editor's screen (AGENTS.md §8).
 */
const AVESMAPS_CONFLICT_TYPE_LABELS = [
    'location' => 'Ort',
    'path' => 'Weg',
    'label' => 'Region/Landschaft',
    'powerline' => 'Kraftlinie',
    'territory' => 'Territorium',
    'adventure' => 'Abenteuer',
    'citymap' => 'Karte',
];

/**
 * Load every map feature that can claim a wiki identity, with its RAW stored wiki_url.
 *
 * @return list<array{type:string,id:string,label:string,subtype:string,wiki_url:string}>
 */
function avesmapsConflictLoadMapRows(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT public_id, name, feature_type, feature_subtype, properties_json, geometry_json
         FROM map_features
         WHERE is_active = 1 AND feature_type IN ('location','path','label','powerline')"
    );
    if ($statement === false) {
        return [];
    }

    $rows = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $type = AVESMAPS_CONFLICT_FEATURE_TYPES[(string) $row['feature_type']] ?? '';
        if ($type === '') {
            continue;
        }
        $name = trim((string) ($row['name'] ?? ''));
        if ($name === '' || str_starts_with($name, 'Kreuzung')) {
            continue;
        }
        $properties = json_decode((string) ($row['properties_json'] ?? '{}'), true);
        if (!is_array($properties)) {
            $properties = [];
        }
        // The stored claim, in the order the editors write it. No enrichment, no fallback guessing.
        // WHERE it comes from is carried along: only the plain field can be cleared from here.
        // A block-borne claim (wiki_settlement/-region/-path) hangs off the whole infobox payload
        // and belongs to its own editor -- see repair.php.
        $wikiUrl = trim((string) ($properties['wiki_url'] ?? ''));
        $claimSource = $wikiUrl !== '' ? 'wiki_url' : '';
        foreach (['wiki_settlement', 'wiki_region', 'wiki_path'] as $block) {
            if ($wikiUrl !== '') {
                break;
            }
            $wikiUrl = trim((string) ($properties[$block]['wiki_url'] ?? ''));
            if ($wikiUrl !== '') {
                $claimSource = $block;
            }
        }

        $rows[] = [
            'type' => $type,
            'id' => (string) $row['public_id'],
            'label' => $name,
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
            'wiki_url' => $wikiUrl,
            'position' => avesmapsConflictFirstPosition($row['geometry_json'] ?? null),
            'claim_source' => $claimSource,
        ];
    }

    return $rows;
}

/**
 * First coordinate of a feature as [lat, lng], or null. GeoJSON stores [x, y] = [lng, lat] and
 * Leaflet wants [lat, lng] (AGENTS.md §5) -- swapped here ONCE so no caller has to remember.
 * A line takes its first vertex: good enough to fly the map there.
 */
function avesmapsConflictFirstPosition($geometryJson): ?array {
    $geometry = json_decode((string) ($geometryJson ?? ''), true);
    $coordinates = is_array($geometry) ? ($geometry['coordinates'] ?? null) : null;
    while (is_array($coordinates) && isset($coordinates[0]) && is_array($coordinates[0])) {
        $coordinates = $coordinates[0];
    }
    if (!is_array($coordinates) || !isset($coordinates[0], $coordinates[1])) {
        return null;
    }

    return ['lat' => (float) $coordinates[1], 'lng' => (float) $coordinates[0]];
}

/**
 * EXACT wiki page titles, indexed for a per-party lookup: "does an article with THIS object's own
 * name exist?".
 *
 * Deliberately NOT keyed on normalized_key. That key strips the parenthetical suffix, which is
 * precisely what caused Discord #38 -- "Jergan (Wasserfall)" would resolve to the article "Jergan"
 * and the evidence shown to the editor would repeat the very mistake being reviewed. Only a
 * case-folded exact title match answers the question honestly.
 *
 * @return array<string, array{title:string,url:string}>
 */
function avesmapsConflictLoadWikiTitles(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT title, wiki_url FROM wiki_sync_pages
             WHERE title IS NOT NULL AND title <> '' AND wiki_url IS NOT NULL AND wiki_url <> ''"
        );
    } catch (Throwable $exception) {
        return []; // no dump read yet -- the evidence column simply stays empty
    }
    if ($statement === false) {
        return [];
    }

    $index = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $title = trim((string) $row['title']);
        if ($title === '') {
            continue;
        }
        $index[mb_strtolower($title, 'UTF-8')] = ['title' => $title, 'url' => (string) $row['wiki_url']];
    }

    return $index;
}

/**
 * Rule 1 -- several objects claim the same wiki article.
 *
 * The one legitimate sharing (the segments of a single road) is filtered out in core.php; without
 * that filter this rule would report 1547 correct road segments and be abandoned on sight (§6a).
 *
 * Each party carries its OWN evidence, because the conflict alone is not decidable. Owner, on the
 * live list: "ist Jergan im Wiki? ist Jergan auf der Karte? ist Jergan (Wasserfall) im Wiki? ist
 * Jergan (Wasserfall) auf der Karte -> dann kann ich entscheiden." So every party reports whether an
 * article under its own exact name exists, and where it sits on the map.
 */
function avesmapsConflictRuleSharedArticle(array $rows, array $wikiTitles = []): array {
    $meta = [];
    foreach ($rows as $row) {
        $meta[$row['type'] . '|' . $row['id']] = [
            'position' => $row['position'] ?? null,
            'claim_source' => $row['claim_source'] ?? '',
        ];
    }
    $conflicts = [];
    foreach (avesmapsConflictFindSharedWikiUrls($rows) as $group) {
        $parties = array_map(static function (array $party) use ($wikiTitles, $meta): array {
            $party['type_label'] = AVESMAPS_CONFLICT_TYPE_LABELS[$party['type']] ?? $party['type'];
            $own = $wikiTitles[mb_strtolower((string) $party['label'], 'UTF-8')] ?? null;
            $party['own_wiki'] = $own;
            $info = $meta[$party['type'] . '|' . $party['id']] ?? [];
            $party['position'] = $info['position'] ?? null;
            // Only a plain-field claim may be cleared from the conflict centre (repair.php).
            $party['claim_source'] = $info['claim_source'] ?? '';
            $party['unlinkable'] = ($info['claim_source'] ?? '') === 'wiki_url';
            return $party;
        }, $group['parties']);
        $title = decodeConflictWikiTitle($group['wiki_url']);
        $conflicts[] = [
            'rule_id' => 'wiki.shared_article',
            'fingerprint' => avesmapsConflictFingerprint('wiki.shared_article', $parties, ['url' => $group['wiki_url']]),
            'severity' => $group['severity'],
            'title' => $title,
            'wiki_url' => $group['wiki_url'],
            'parties' => $parties,
            'subject_type' => $parties[0]['type'] ?? '',
            'subject_id' => $parties[0]['id'] ?? '',
        ];
    }

    return $conflicts;
}

/**
 * Rule 2 -- a hand-made object carries no wiki key at all.
 *
 * Owner 2026-07-20: we cannot know whether a wiki counterpart exists, so these need periodic eyes.
 * Auto-named ways are excluded -- a generated "Reichsstrasse-3633" can never match a wiki page, and
 * including them would bury the 1178 hand-named ways under 2448 machine-made ones (§6b).
 */
function avesmapsConflictRuleMissingKey(array $rows): array {
    $conflicts = [];
    foreach ($rows as $row) {
        if (trim((string) $row['wiki_url']) !== '') {
            continue;
        }
        if ($row['type'] === 'path' && avesmapsConflictPathNameIsAuto((string) $row['label'], AVESMAPS_CONFLICT_PATH_SUBTYPES)) {
            continue;
        }
        $party = [
            'type' => $row['type'],
            'id' => $row['id'],
            'label' => $row['label'],
            'type_label' => AVESMAPS_CONFLICT_TYPE_LABELS[$row['type']] ?? $row['type'],
        ];
        $conflicts[] = [
            'rule_id' => 'wiki.missing_key',
            'fingerprint' => avesmapsConflictFingerprint('wiki.missing_key', [$party]),
            'severity' => AVESMAPS_CONFLICT_UNVERIFIED,
            'title' => (string) $row['label'],
            'wiki_url' => '',
            'parties' => [$party],
            'subject_type' => $row['type'],
            'subject_id' => $row['id'],
        ];
    }

    return $conflicts;
}

/**
 * A named way is ONE case, not one per segment: "Reichslandstraße von Havena nach Abilacht" runs
 * across 20 segments but is a single decision. Collapses same-name path conflicts of one rule.
 */
function avesmapsConflictCollapsePathsByName(array $conflicts): array {
    // Index map instead of PHP array references -- references into arrays are a well-known footgun
    // (they survive the loop and quietly alias later writes), and this list is user-visible.
    $out = [];
    $indexByName = [];
    foreach ($conflicts as $conflict) {
        $parties = $conflict['parties'] ?? [];
        $isSinglePath = count($parties) === 1 && ($parties[0]['type'] ?? '') === 'path';
        if (!$isSinglePath) {
            $out[] = $conflict;
            continue;
        }
        $key = (string) ($conflict['rule_id'] ?? '') . '|' . mb_strtolower((string) $parties[0]['label'], 'UTF-8');
        if (isset($indexByName[$key])) {
            $out[$indexByName[$key]]['segments']++;
            continue;
        }
        $conflict['segments'] = 1;
        $out[] = $conflict;
        $indexByName[$key] = count($out) - 1;
    }

    return $out;
}

function decodeConflictWikiTitle(string $wikiUrl): string {
    if (preg_match('~/wiki/([^?#]+)~i', $wikiUrl, $match) === 1) {
        return str_replace('_', ' ', rawurldecode($match[1]));
    }

    return $wikiUrl;
}

/**
 * Registry. Order is display order.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsConflictRuleCatalog(): array {
    return [
        [
            'id' => 'wiki.shared_article',
            'label' => 'Mehrere Objekte beanspruchen denselben Wiki-Artikel',
            'hint' => 'Ein Wiki-Artikel kann nur zu einem Objekt gehören. Segmente einer Straße sind ausgenommen.',
            'severity' => AVESMAPS_CONFLICT_ERROR,
            'actions' => ['pick_one', 'unlink', 'defer', 'ignore'],
            // What each button DOES. The difference between "Trennen" and "Kein Wiki-Eintrag" is not
            // cosmetic: only the second one sticks, because the enrichment keeps proposing a link for
            // any name it can match. Without this spelled out, an editor picks the weaker verb and
            // the link quietly returns -- which is Discord #38 all over again.
            'verbs' => [
                ['label' => 'Behält den Link', 'effect' => 'Dieses Objekt bleibt mit dem Artikel verknüpft. Alle anderen in diesem Fall verlieren ihre Verknüpfung.'],
                ['label' => 'Trennen', 'effect' => 'Nur dieses Objekt verliert die Verknüpfung. Achtung: Trägt es einen Namen, der zu einem Wiki-Artikel passt, kann der Server ihn später erneut vorschlagen.'],
                ['label' => 'Kein Wiki-Eintrag', 'effect' => 'Trennt UND hält fest, dass es im Wiki nichts dazu gibt. Nur so bleibt die Trennung dauerhaft — nichts wird mehr vorgeschlagen.'],
                ['label' => 'Zurückstellen / Archivieren', 'effect' => 'Ändern die Daten nicht. Zurückgestellt heißt „später“, archiviert heißt „bewusst so gelassen“ — beides bleibt auffindbar und umkehrbar.'],
            ],
        ],
        [
            'id' => 'wiki.missing_key',
            'label' => 'Kein Wiki-Schlüssel',
            'hint' => 'Von Hand angelegt. Ob es im Wiki ein Gegenstück gibt, weiß bisher niemand.',
            'severity' => AVESMAPS_CONFLICT_UNVERIFIED,
            'actions' => ['defer', 'ignore'],
            'verbs' => [
                ['label' => 'Zurückstellen', 'effect' => 'Nimmt den Eintrag aus „Offen“, holt ihn aber zurück, sobald sich am Objekt etwas ändert.'],
                ['label' => 'Archivieren', 'effect' => 'Bewusst so gelassen. Bleibt unter „Archiviert“ auffindbar und lässt sich jederzeit wieder öffnen.'],
            ],
        ],
    ];
}

/**
 * Run every rule and return the raw conflict list (undecided -- the store joins the decisions in).
 */
function avesmapsConflictDetectAll(PDO $pdo): array {
    $rows = avesmapsConflictLoadMapRows($pdo);
    $wikiTitles = avesmapsConflictLoadWikiTitles($pdo);
    $conflicts = array_merge(
        avesmapsConflictRuleSharedArticle($rows, $wikiTitles),
        avesmapsConflictCollapsePathsByName(avesmapsConflictRuleMissingKey($rows))
    );

    return $conflicts;
}
