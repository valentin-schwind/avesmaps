<?php

declare(strict_types=1);

function avesmapsPoliticalResolveDisplayStateForTerritory(array $displays, array $territory, int $index): array {
    $territoryPublicId = trim((string) ($territory['public_id'] ?? ''));
    $territorySlug = trim((string) ($territory['slug'] ?? ''));
    $territoryName = trim((string) ($territory['name'] ?? ''));
    $territoryNameKey = $territoryName === '' ? '' : mb_strtolower($territoryName);

    foreach ($displays as $candidateDisplay) {
        if (!is_array($candidateDisplay)) {
            continue;
        }

        $candidateTerritoryPublicId = trim((string) (
            $candidateDisplay['territoryPublicId']
            ?? $candidateDisplay['territory_public_id']
            ?? ''
        ));

        if ($territoryPublicId !== '' && $candidateTerritoryPublicId === $territoryPublicId) {
            return $candidateDisplay;
        }
    }

    foreach ($displays as $candidateDisplay) {
        if (!is_array($candidateDisplay)) {
            continue;
        }

        $candidateNodeKey = trim((string) (
            $candidateDisplay['nodeKey']
            ?? $candidateDisplay['node_key']
            ?? $candidateDisplay['slug']
            ?? ''
        ));

        if ($territorySlug === '' || $candidateNodeKey === '') {
            continue;
        }

        if ($candidateNodeKey === $territorySlug || avesmapsPoliticalSlug($candidateNodeKey) === $territorySlug) {
            return $candidateDisplay;
        }
    }

    if ($territoryNameKey !== '') {
        foreach ($displays as $candidateDisplay) {
            if (!is_array($candidateDisplay)) {
                continue;
            }

            $candidateName = trim((string) (
                $candidateDisplay['originalName']
                ?? $candidateDisplay['original_name']
                ?? $candidateDisplay['name']
                ?? $candidateDisplay['displayName']
                ?? $candidateDisplay['display_name']
                ?? ''
            ));

            if ($candidateName !== '' && mb_strtolower($candidateName) === $territoryNameKey) {
                return $candidateDisplay;
            }
        }
    }

    $fallbackDisplay = $displays[$index] ?? null;

    return is_array($fallbackDisplay) ? $fallbackDisplay : [];
}

function avesmapsPoliticalListTerritories(PDO $pdo, array $query): array {
    $continent = avesmapsNormalizeSingleLine((string) ($query['continent'] ?? AVESMAPS_POLITICAL_DEFAULT_CONTINENT), 120);
    $includeDiagnostics = filter_var($query['debug'] ?? false, FILTER_VALIDATE_BOOL);
    $conditions = [];
    $params = [];
    if ($continent !== '') {
        $conditions[] = 'territory.continent = :continent';
        $params['continent'] = $continent;
    }

    $statement = $pdo->prepare(
        'SELECT
            territory.*,
            parent.public_id AS parent_public_id,
            parent.name AS parent_name,
            capital_place.public_id AS capital_place_public_id,
            seat_place.public_id AS seat_place_public_id,
            wiki.name AS wiki_name,
            wiki.type AS wiki_type,
            wiki.affiliation_raw AS wiki_affiliation_raw,
            wiki.affiliation_root AS wiki_affiliation_root,
            wiki.affiliation_path_json AS wiki_affiliation_path_json,
            wiki.founded_text AS wiki_founded_text,
            wiki.dissolved_text AS wiki_dissolved_text,
            wiki.capital_name AS wiki_capital_name,
            wiki.seat_name AS wiki_seat_name
        FROM political_territory territory
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        ' . ($conditions === [] ? '' : 'WHERE ' . implode(' AND ', $conditions)) . '
        ORDER BY territory.sort_order ASC, territory.name ASC'
    );
    $statement->execute($params);
    $territories = array_map(
        static fn(array $row): array => avesmapsPoliticalTerritoryRowToPublic($row),
        $statement->fetchAll(PDO::FETCH_ASSOC)
    );
    $diagnostics = [
        'territory_count' => count($territories),
    ];
    $warnings = [];

    try {
        $territories = avesmapsPoliticalApplyEffectiveParents($territories);
    } catch (Throwable $exception) {
        $warnings[] = 'effective_parent_resolution_failed';
        if ($includeDiagnostics) {
            $diagnostics['effective_parent_error'] = $exception->getMessage();
        }
    }

    $hierarchy = [];
    try {
        $hierarchy = avesmapsPoliticalBuildHierarchy($territories);
    } catch (Throwable $exception) {
        $warnings[] = 'hierarchy_build_failed';
        if ($includeDiagnostics) {
            $diagnostics['hierarchy_error'] = $exception->getMessage();
        }
    }

    $response = [
        'ok' => true,
        'territories' => $territories,
        'hierarchy' => $hierarchy,
    ];

    if ($warnings !== []) {
        $response['warnings'] = $warnings;
    }

    if ($includeDiagnostics) {
        $response['diagnostics'] = $diagnostics;
    }

    return $response;
}

// Normalize a place/capital name for fuzzy matching: lowercase, drop parentheticals, fold German umlauts and
// common diacritics, keep only [a-z0-9] separated by single spaces. The SAME normalization is applied to both
// sides so spelling-consistent wiki names match regardless of case/diacritics/qualifier suffixes.
function avesmapsPoliticalNormalizeCapitalName(string $name): string {
    $name = mb_strtolower(trim($name), 'UTF-8');
    $name = preg_replace('/\([^)]*\)/u', ' ', $name) ?? $name; // strip (parentheticals)
    $name = strtr($name, [
        'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'ß' => 'ss',
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e',
        'í' => 'i', 'î' => 'i', 'ó' => 'o', 'ô' => 'o', 'ú' => 'u', 'û' => 'u',
        'ñ' => 'n', 'ç' => 'c',
    ]);
    $name = preg_replace('/[^a-z0-9]+/u', ' ', $name) ?? $name;
    return trim(preg_replace('/\s+/u', ' ', $name) ?? $name);
}

// Review surface for the manual capital-link bulk-match: every active territory that has a capital NAME (own
// column or wiki) but NO linked capital location (capital_place_id IS NULL), plus name-matched candidate
// locations. Nothing is auto-assigned -- ambiguous names (e.g. two "Nordhag") return multiple candidates so the
// editor picks; capital names that are prose or "keine" return no candidate and are handled via free search.
function avesmapsPoliticalListCapitalAssignments(PDO $pdo, array $query): array {
    $continent = avesmapsNormalizeSingleLine((string) ($query['continent'] ?? AVESMAPS_POLITICAL_DEFAULT_CONTINENT), 120);
    return ['ok' => true, 'territories' => avesmapsPoliticalComputeMissingCapitalRows($pdo, $continent)];
}

// Live-computed conflict cases for the WikiSync Konfliktloesung list: every territory with a wiki capital name
// but no linked capital location becomes a "missing_capital" case, carrying its name-matched candidates and the
// persisted review status (deferred/archived) from political_capital_case_status. "open" is the computed
// default; "resolved" = a capital was assigned -> the territory drops out of the compute entirely.
function avesmapsPoliticalListCapitalCases(PDO $pdo, array $query): array {
    $territories = avesmapsPoliticalComputeMissingCapitalRows($pdo, '');

    $statusByTerritory = [];
    foreach ($pdo->query('SELECT territory_public_id, status, resolution_json FROM political_capital_case_status') as $statusRow) {
        $statusByTerritory[(string) $statusRow['territory_public_id']] = $statusRow;
    }

    $cases = [];
    foreach ($territories as $territory) {
        $publicId = (string) $territory['territory_public_id'];
        $statusRow = $statusByTerritory[$publicId] ?? null;
        $resolution = null;
        if ($statusRow !== null && isset($statusRow['resolution_json']) && $statusRow['resolution_json'] !== null && $statusRow['resolution_json'] !== '') {
            $decoded = json_decode((string) $statusRow['resolution_json'], true);
            $resolution = is_array($decoded) ? $decoded : null;
        }
        $cases[] = [
            'id' => $publicId,
            'source' => 'political',
            'case_type' => 'missing_capital',
            'status' => $statusRow !== null ? (string) $statusRow['status'] : 'open',
            'payload' => $territory,
            'resolution' => $resolution,
        ];
    }

    return ['ok' => true, 'cases' => $cases];
}

/**
 * Exact wiki page titles (case-folded) -> URL, for turning a capital NAME into a real link.
 *
 * Nur nachgeschlagen, nie gebaut. Aus "Südwall" liesse sich muehelos eine URL basteln, und fuer die
 * meisten Hauptstaedte waere sie sogar richtig -- aber `capital_name` ist ein Infobox-Freitext und
 * enthaelt auch Prosa ("wohl Alstfurt") oder "keine". Eine geratene URL ist genau der Fehler aus
 * Discord #38, nur an einer anderen Stelle: sie sieht aus wie eine Feststellung und ist geraten.
 * Kein Treffer in der Tabelle => kein Link, der Name bleibt einfach Text.
 *
 * @return array<string, string>
 */
function avesmapsPoliticalLoadWikiPageUrls(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            "SELECT title, wiki_url FROM wiki_sync_pages
             WHERE title IS NOT NULL AND title <> '' AND wiki_url IS NOT NULL AND wiki_url <> ''"
        );
    } catch (Throwable $exception) {
        return []; // noch kein Dump gelesen -- dann gibt es hier eben keine Links
    }
    if ($statement === false) {
        return [];
    }

    $index = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $title = trim((string) $row['title']);
        if ($title !== '') {
            $index[mb_strtolower($title, 'UTF-8')] = (string) $row['wiki_url'];
        }
    }

    return $index;
}

// Core compute shared by both surfaces above. continent='' returns all continents (the cases view is unfiltered;
// the legacy list passes its continent filter).
function avesmapsPoliticalComputeMissingCapitalRows(PDO $pdo, string $continent = ''): array {
    // The capital NAME lives only in political_territory_wiki (the main table carries the LINK capital_place_id,
    // not the text). So the gap = territories whose wiki has a capital name but whose capital_place_id is unset.
    $conditions = [
        'territory.is_active = 1',
        'territory.capital_place_id IS NULL',
        "wiki.capital_name IS NOT NULL AND wiki.capital_name <> ''",
    ];
    $params = [];
    if ($continent !== '') {
        $conditions[] = 'territory.continent = :continent';
        $params['continent'] = $continent;
    }

    $statement = $pdo->prepare(
        'SELECT territory.public_id, territory.name, territory.type, territory.continent,
                wiki.capital_name AS wiki_capital_name,
                COALESCE(NULLIF(territory.wiki_url, \'\'), wiki.wiki_url) AS wiki_url
        FROM political_territory territory
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        WHERE ' . implode(' AND ', $conditions) . '
        ORDER BY territory.name ASC'
    );
    $statement->execute($params);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

    // Einmal fuer den ganzen Lauf, nicht je Gebiet -- sonst waeren das ein paar hundert Abfragen.
    $wikiPageUrls = avesmapsPoliticalLoadWikiPageUrls($pdo);

    // Index all active locations by normalized name once (~2400 rows). Ambiguous names map to several entries.
    $byNorm = [];
    $locationStatement = $pdo->query(
        "SELECT public_id, name FROM map_features
        WHERE feature_type = 'location' AND is_active = 1 AND name IS NOT NULL AND name <> ''"
    );
    foreach ($locationStatement as $location) {
        $norm = avesmapsPoliticalNormalizeCapitalName((string) $location['name']);
        if ($norm === '') {
            continue;
        }
        $byNorm[$norm][] = [
            'public_id' => (string) $location['public_id'],
            'name' => (string) $location['name'],
        ];
    }

    $territories = [];
    foreach ($rows as $row) {
        $capitalName = trim((string) ($row['wiki_capital_name'] ?? ''));
        $norm = avesmapsPoliticalNormalizeCapitalName($capitalName);

        $suggestions = [];
        $seen = [];
        $appendCandidates = static function (array $entries) use (&$suggestions, &$seen): void {
            foreach ($entries as $entry) {
                if (!isset($seen[$entry['public_id']])) {
                    $seen[$entry['public_id']] = true;
                    $suggestions[] = $entry;
                }
            }
        };
        if ($norm !== '' && isset($byNorm[$norm])) {
            $appendCandidates($byNorm[$norm]); // whole-name match (incl. parenthetical-stripped)
        }
        foreach (explode(' ', $norm) as $token) { // single place name buried in prose ("wohl Alstfurt")
            if (strlen($token) >= 4 && isset($byNorm[$token])) {
                $appendCandidates($byNorm[$token]);
            }
        }

        $territories[] = [
            'territory_public_id' => (string) $row['public_id'],
            'name' => (string) $row['name'],
            'type' => (string) ($row['type'] ?? ''),
            'continent' => (string) ($row['continent'] ?? ''),
            'capital_name' => $capitalName,
            // Beide Links, damit ein Editor den Fall im Wiki nachlesen kann, ohne selbst zu suchen.
            // Das Gebiet bringt seine eigene, gespeicherte URL mit; die Hauptstadt nur dann, wenn es
            // unter genau diesem Namen wirklich einen Artikel gibt (siehe Nachschlagewerk oben).
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'capital_wiki_url' => $capitalName !== ''
                ? ($wikiPageUrls[mb_strtolower($capitalName, 'UTF-8')] ?? '')
                : '',
            'suggestions' => array_slice($suggestions, 0, 8),
        ];
    }

    return $territories;
}

function avesmapsPoliticalGetTerritory(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalFetchTerritoryByRequest($pdo, $query);
    $wiki = $territory['wiki_id'] ? avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id']) : null;
    $geometries = avesmapsPoliticalFetchGeometryRowsForTerritory($pdo, (int) $territory['id']);
    $territoryPublic = avesmapsPoliticalResolveSingleEffectiveTerritory($pdo, avesmapsPoliticalTerritoryRowToPublic($territory));
    $assignmentChain = avesmapsPoliticalBuildAssignmentChain($pdo, $territory);

    return [
        'ok' => true,
        'territory' => $territoryPublic,
        'wiki' => $wiki === null ? null : avesmapsPoliticalWikiRowToPublic($wiki),
        'geometries' => array_map(static fn(array $row): array => avesmapsPoliticalGeometryRowToPublic($row), $geometries),
        'assignment_chain' => $assignmentChain,
    ];
}

function avesmapsPoliticalGetWikiReference(PDO $pdo, array $query): array {
    $territory = avesmapsPoliticalFetchTerritoryByRequest($pdo, $query);
    if (empty($territory['wiki_id'])) {
        return [
            'ok' => true,
            'wiki' => null,
        ];
    }

    return [
        'ok' => true,
        'wiki' => avesmapsPoliticalWikiRowToPublic(avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id'])),
    ];
}

function avesmapsPoliticalListWikiReferences(PDO $pdo, array $query): array {
    $continent = avesmapsNormalizeSingleLine((string) ($query['continent'] ?? AVESMAPS_POLITICAL_DEFAULT_CONTINENT), 120);
    $conditions = [];
    $params = [];
    if ($continent !== '') {
        $conditions[] = 'continent = :continent';
        $params['continent'] = $continent;
    }

    $statement = $pdo->prepare(
        'SELECT
            id,
            wiki_key,
            name,
            type,
            continent,
            affiliation_raw,
            affiliation_root,
            affiliation_path_json,
            status,
            capital_name,
            seat_name,
            ruler,
            founded_text,
            dissolved_text,
            wiki_url,
            coat_of_arms_url
        FROM political_territory_wiki
        ' . ($conditions === [] ? '' : 'WHERE ' . implode(' AND ', $conditions)) . '
        ORDER BY affiliation_root ASC, name ASC'
    );
    $statement->execute($params);

    return [
        'ok' => true,
        'wiki' => array_map(
            static fn(array $row): array => avesmapsPoliticalWikiReferenceRowToPublic($row),
            $statement->fetchAll(PDO::FETCH_ASSOC)
        ),
    ];
}

function avesmapsPoliticalReadHierarchy(PDO $pdo): array {
    $response = avesmapsPoliticalListTerritories($pdo, ['continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT]);

    return [
        'ok' => true,
        'hierarchy' => $response['hierarchy'],
        'territories' => $response['territories'],
    ];
}

function avesmapsPoliticalReadWikiTreeKey(mixed $value): string {
    $text = avesmapsNormalizeSingleLine((string) $value, 255);
    if ($text === '') {
        throw new InvalidArgumentException('Der Wiki-Knoten ist ungueltig.');
    }

    return $text;
}

function avesmapsPoliticalFetchWikiByKey(PDO $pdo, string $wikiKey): array {
    $slug = str_starts_with($wikiKey, 'wiki:') || str_starts_with($wikiKey, 'name:')
        ? substr($wikiKey, 5)
        : $wikiKey;
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory_wiki
        WHERE wiki_key = :wiki_key
            OR wiki_key = :wiki_slug
            OR wiki_key = :name_key
        ORDER BY wiki_key = :wiki_key_order DESC, id ASC
        LIMIT 1'
    );
    $statement->execute([
        'wiki_key' => $wikiKey,
        'wiki_key_order' => $wikiKey,
        'wiki_slug' => $slug,
        'name_key' => 'name:' . $slug,
    ]);
    $wiki = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$wiki) {
        $nameCandidate = str_starts_with($wikiKey, 'wiki:') || str_starts_with($wikiKey, 'name:')
            ? substr($wikiKey, 5)
            : $wikiKey;

        $nameCandidate = str_replace('-', ' ', $nameCandidate);

        $fallbackStatement = $pdo->prepare(
            'SELECT *
            FROM political_territory_wiki
            WHERE name = :name
                OR LOWER(REPLACE(name, " ", "-")) = :slug
            ORDER BY id ASC
            LIMIT 1'
        );
        $fallbackStatement->execute([
            'name' => $nameCandidate,
            'slug' => mb_strtolower(str_replace(' ', '-', $nameCandidate)),
        ]);
        $wiki = $fallbackStatement->fetch(PDO::FETCH_ASSOC);
    }

    if (!$wiki) {
        throw new InvalidArgumentException('Der Wiki-Knoten wurde in den synchronisierten Referenzdaten nicht gefunden.');
    }

    return $wiki;
}

function avesmapsPoliticalFindTerritoryBySlug(PDO $pdo, string $slug): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory
        WHERE slug = :slug
        ORDER BY id ASC
        LIMIT 1'
    );
    $statement->execute(['slug' => $slug]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);

    return $territory ?: null;
}

function avesmapsPoliticalDeactivateTerritoryIfOrphaned(PDO $pdo, int $territoryId): void {
    if ($territoryId < 1) {
        return;
    }

    $statement = $pdo->prepare(
        'SELECT COUNT(*)
        FROM political_territory_geometry
        WHERE territory_id = :territory_id
            AND is_active = 1'
    );
    $statement->execute([
        'territory_id' => $territoryId,
    ]);

    if ((int) $statement->fetchColumn() > 0) {
        return;
    }

    $updateStatement = $pdo->prepare(
        'UPDATE political_territory
        SET is_active = 0
        WHERE id = :id'
    );
    $updateStatement->execute([
        'id' => $territoryId,
    ]);
}

function avesmapsPoliticalArrayIsList(array $values): bool {
    $expectedIndex = 0;
    foreach ($values as $index => $_value) {
        if ($index !== $expectedIndex) {
            return false;
        }
        $expectedIndex++;
    }

    return true;
}

function avesmapsPoliticalFindTerritoryByExactNameOrSlug(PDO $pdo, string $name): ?array {
    $statement = $pdo->prepare(
        'SELECT *
        FROM political_territory
        WHERE name = :name OR slug = :slug
        ORDER BY name = :name_order DESC, id ASC
        LIMIT 1'
    );
    $statement->execute([
        'name' => $name,
        'name_order' => $name,
        'slug' => avesmapsPoliticalSlug($name),
    ]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);

    return $territory ?: null;
}

function avesmapsPoliticalResponseForTerritory(PDO $pdo, string $publicId): array {
    $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $publicId);
    $geometries = avesmapsPoliticalFetchGeometryRowsForTerritory($pdo, (int) $territory['id']);
    $wiki = !empty($territory['wiki_id']) ? avesmapsPoliticalFetchWikiById($pdo, (int) $territory['wiki_id']) : null;
    $assignmentChain = avesmapsPoliticalBuildAssignmentChain($pdo, $territory);

    return [
        'ok' => true,
        'territory' => avesmapsPoliticalTerritoryRowToPublic($territory),
        'wiki' => $wiki === null ? null : avesmapsPoliticalWikiRowToPublic($wiki),
        'geometries' => array_map(static fn(array $row): array => avesmapsPoliticalGeometryRowToPublic($row), $geometries),
        'feature' => $geometries === [] ? null : avesmapsPoliticalBuildFeatureFromStoredRows($territory, $geometries[0]),
        'assignment_chain' => $assignmentChain,
    ];
}

function avesmapsPoliticalTerritoryRowToPublic(array $row): array {
    return [
        'id' => (int) $row['id'],
        'public_id' => (string) $row['public_id'],
        'wiki_id' => isset($row['wiki_id']) ? (int) $row['wiki_id'] : null,
        'wiki_key' => (string) ($row['wiki_key'] ?? ''),
        'slug' => (string) $row['slug'],
        'name' => (string) $row['name'],
        'short_name' => (string) ($row['short_name'] ?? ''),
        'type' => (string) ($row['type'] ?? ''),
        'parent_id' => isset($row['parent_id']) ? (int) $row['parent_id'] : null,
        'parent_public_id' => (string) ($row['parent_public_id'] ?? ''),
        'parent_name' => (string) ($row['parent_name'] ?? ''),
        'continent' => (string) ($row['continent'] ?? ''),
        'status' => (string) ($row['status'] ?? ''),
        'color' => (string) ($row['color'] ?? '#888888'),
        'opacity' => (float) ($row['opacity'] ?? 0.33),
        'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
        'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        'capital_place_public_id' => (string) ($row['capital_place_public_id'] ?? ''),
        'seat_place_public_id' => (string) ($row['seat_place_public_id'] ?? ''),
        'valid_from_bf' => avesmapsPoliticalNullableInt($row['valid_from_bf'] ?? null),
        'valid_to_bf' => avesmapsPoliticalNormalizeRowValidTo($row['valid_to_bf'] ?? null, $row),
        'valid_label' => (string) ($row['valid_label'] ?? ''),
        'min_zoom' => avesmapsPoliticalNullableInt($row['min_zoom'] ?? null),
        'max_zoom' => avesmapsPoliticalNullableInt($row['max_zoom'] ?? null),
        'is_active' => (int) ($row['is_active'] ?? 1) === 1,
        'editor_notes' => (string) ($row['editor_notes'] ?? ''),
        'sort_order' => (int) ($row['sort_order'] ?? 0),
        'wiki_name' => (string) ($row['wiki_name'] ?? ''),
        'wiki_type' => (string) ($row['wiki_type'] ?? ''),
        'wiki_affiliation_raw' => (string) ($row['wiki_affiliation_raw'] ?? ''),
        'wiki_affiliation_root' => (string) ($row['wiki_affiliation_root'] ?? ''),
        'wiki_affiliation_path' => avesmapsPoliticalDecodeJson($row['wiki_affiliation_path_json'] ?? null),
        'wiki_founded_text' => (string) ($row['wiki_founded_text'] ?? ''),
        'wiki_dissolved_text' => (string) ($row['wiki_dissolved_text'] ?? ''),
        'wiki_capital_name' => (string) ($row['wiki_capital_name'] ?? ''),
        'wiki_seat_name' => (string) ($row['wiki_seat_name'] ?? ''),
    ];
}

function avesmapsPoliticalWikiRowToPublic(array $row): array {
    $public = $row;
    foreach (['affiliation_path_json', 'affiliation_json', 'founded_json', 'dissolved_json', 'raw_json'] as $key) {
        $public[$key] = avesmapsPoliticalDecodeJson($row[$key] ?? null);
    }

    return $public;
}

function avesmapsPoliticalWikiReferenceRowToPublic(array $row): array {
    return [
        'id' => (int) ($row['id'] ?? 0),
        'wiki_key' => (string) ($row['wiki_key'] ?? ''),
        'name' => (string) ($row['name'] ?? ''),
        'type' => (string) ($row['type'] ?? ''),
        'continent' => (string) ($row['continent'] ?? ''),
        'affiliation_raw' => (string) ($row['affiliation_raw'] ?? ''),
        'affiliation_root' => (string) ($row['affiliation_root'] ?? ''),
        'affiliation_path' => avesmapsPoliticalDecodeJson($row['affiliation_path_json'] ?? null),
        'status' => (string) ($row['status'] ?? ''),
        'capital_name' => (string) ($row['capital_name'] ?? ''),
        'seat_name' => (string) ($row['seat_name'] ?? ''),
        'ruler' => (string) ($row['ruler'] ?? ''),
        'founded_text' => (string) ($row['founded_text'] ?? ''),
        'dissolved_text' => (string) ($row['dissolved_text'] ?? ''),
        'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        'coat_of_arms_url' => (string) ($row['coat_of_arms_url'] ?? ''),
    ];
}

function avesmapsPoliticalBuildHierarchy(array $territories): array {
    $nodesById = [];
    $territoriesById = [];
    foreach ($territories as $territory) {
        $territoryId = (int) ($territory['id'] ?? 0);
        if ($territoryId < 1) {
            continue;
        }

        $territoriesById[$territoryId] = $territory;
        $nodesById[$territoryId] = [
            'public_id' => $territory['public_id'],
            'name' => $territory['name'],
            'short_name' => $territory['short_name'] ?? '',
            'type' => $territory['type'],
            'valid_label' => $territory['valid_label'] ?? '',
            'parent_public_id' => $territory['parent_public_id'] ?? '',
            'parent_name' => $territory['parent_name'] ?? '',
            'wiki_name' => $territory['wiki_name'] ?? '',
            'wiki_affiliation_raw' => $territory['wiki_affiliation_raw'] ?? '',
            'wiki_affiliation_root' => $territory['wiki_affiliation_root'] ?? '',
            'aliases' => avesmapsPoliticalPublicTerritoryAliases($territory),
            'children' => [],
        ];
    }

    $aliasToIds = avesmapsPoliticalBuildAliasIndex(
        $territoriesById,
        static fn(array $territory): array => avesmapsPoliticalPublicTerritoryAliases($territory)
    );

    $resolvedParentIds = [];
    foreach ($territoriesById as $territoryId => $territory) {
        $resolvedParentIds[$territoryId] = avesmapsPoliticalResolveHierarchyParentId(
            $territoryId,
            $territory,
            $territoriesById,
            $aliasToIds
        );
    }

    $childrenByParentId = [];
    foreach ($territoriesById as $territoryId => $territory) {
        $parentId = (int) ($resolvedParentIds[$territoryId] ?? 0);
        if ($parentId > 0 && isset($nodesById[$parentId])) {
            $childrenByParentId[$parentId] ??= [];
            $childrenByParentId[$parentId][] = $territoryId;
        }
    }

    $displayRootNames = [];
    $rootGroups = [];
    foreach ($territoriesById as $territoryId => $territory) {
        $rootName = avesmapsPoliticalResolveHierarchyDisplayRootName(
            $territoryId,
            $territoriesById,
            $childrenByParentId,
            $displayRootNames
        );
        $rootKey = avesmapsPoliticalSlug($rootName);
        if ($rootKey === '') {
            $rootKey = 'territory:' . $territoryId;
            $rootName = (string) ($territory['name'] ?? '');
        }

        if (!isset($rootGroups[$rootKey])) {
            $rootGroups[$rootKey] = [
                'key' => $rootKey,
                'name' => $rootName,
                'territory_ids' => [],
            ];
        }

        $rootGroups[$rootKey]['territory_ids'][] = $territoryId;
    }

    uasort(
        $rootGroups,
        static fn(array $left, array $right): int => strnatcasecmp((string) ($left['name'] ?? ''), (string) ($right['name'] ?? ''))
    );

    $hierarchy = [];
    foreach ($rootGroups as $group) {
        $groupTerritoryIds = [];
        foreach ((array) ($group['territory_ids'] ?? []) as $territoryId) {
            $groupTerritoryIds[(int) $territoryId] = true;
        }

        $buildNode = function (int $territoryId, array $trail = []) use (&$buildNode, $nodesById, $childrenByParentId, $groupTerritoryIds): array {
            if (!isset($nodesById[$territoryId])) {
                return [];
            }

            $node = $nodesById[$territoryId];
            if (isset($trail[$territoryId])) {
                return $node;
            }

            $trail[$territoryId] = true;
            $childIds = array_values(
                array_filter(
                    (array) ($childrenByParentId[$territoryId] ?? []),
                    static fn(mixed $childId): bool => is_int($childId) && isset($groupTerritoryIds[$childId])
                )
            );
            usort(
                $childIds,
                static fn(int $leftId, int $rightId): int => strnatcasecmp(
                    (string) ($nodesById[$leftId]['name'] ?? ''),
                    (string) ($nodesById[$rightId]['name'] ?? '')
                )
            );

            foreach ($childIds as $childId) {
                $childNode = $buildNode($childId, $trail);
                if ($childNode !== []) {
                    $node['children'][] = $childNode;
                }
            }

            return $node;
        };

        $topLevelIds = [];
        foreach (array_keys($groupTerritoryIds) as $territoryId) {
            $parentId = (int) ($resolvedParentIds[$territoryId] ?? 0);
            if ($parentId > 0 && isset($groupTerritoryIds[$parentId])) {
                continue;
            }

            $topLevelIds[] = $territoryId;
        }

        usort(
            $topLevelIds,
            static fn(int $leftId, int $rightId): int => strnatcasecmp(
                (string) ($nodesById[$leftId]['name'] ?? ''),
                (string) ($nodesById[$rightId]['name'] ?? '')
            )
        );

        $children = [];
        foreach ($topLevelIds as $territoryId) {
            $node = $buildNode($territoryId);
            if ($node !== []) {
                $children[] = $node;
            }
        }

        $hierarchy[] = [
            'public_id' => '',
            'name' => (string) ($group['name'] ?? ''),
            'short_name' => '',
            'type' => '',
            'valid_label' => '',
            'parent_public_id' => '',
            'parent_name' => '',
            'wiki_name' => (string) ($group['name'] ?? ''),
            'wiki_affiliation_raw' => (string) ($group['name'] ?? ''),
            'wiki_affiliation_root' => (string) ($group['name'] ?? ''),
            'aliases' => [(string) ($group['name'] ?? '')],
            'children' => $children,
            'is_group' => true,
        ];
    }

    return $hierarchy;
}

function avesmapsPoliticalResolveHierarchyParentId(
    int $territoryId,
    array $territory,
    array $territoriesById,
    array $aliasToIds
): int {
    $parentId = (int) ($territory['parent_id'] ?? 0);
    if ($parentId < 1 || !isset($territoriesById[$parentId])) {
        $parentId = avesmapsPoliticalInferPublicTerritoryParentId($territory, $aliasToIds, $territoriesById);
    }

    if ($parentId < 1 || !isset($territoriesById[$parentId]) || $parentId === $territoryId) {
        return 0;
    }

    $visited = [$territoryId => true];
    $currentId = $parentId;
    $safety = 0;
    while ($currentId > 0 && $safety < 128) {
        if (isset($visited[$currentId])) {
            return 0;
        }

        $visited[$currentId] = true;
        $current = $territoriesById[$currentId] ?? null;
        if (!is_array($current)) {
            return $parentId;
        }

        $nextParentId = (int) ($current['parent_id'] ?? 0);
        if ($nextParentId < 1 || !isset($territoriesById[$nextParentId])) {
            $nextParentId = avesmapsPoliticalInferPublicTerritoryParentId($current, $aliasToIds, $territoriesById);
        }

        if ($nextParentId === $currentId) {
            return 0;
        }

        $currentId = $nextParentId;
        $safety++;
    }

    return $safety >= 128 ? 0 : $parentId;
}

function avesmapsPoliticalPublicTerritoryAliases(array $territory): array {
    $aliases = avesmapsPoliticalExpandTerritoryAliases([
        (string) ($territory['name'] ?? ''),
        (string) ($territory['short_name'] ?? ''),
        (string) ($territory['wiki_name'] ?? ''),
    ]);

    return array_values(array_unique(array_filter(array_map('trim', $aliases))));
}

function avesmapsPoliticalResolveHierarchyRootName(array $territory): string {
    $rootName = trim((string) ($territory['wiki_affiliation_root'] ?? ''));
    if ($rootName !== '') {
        return $rootName;
    }

    $path = $territory['wiki_affiliation_path'] ?? [];
    if (is_array($path) && $path !== []) {
        $first = trim((string) reset($path));
        if ($first !== '') {
            return $first;
        }
    }

    $affiliation = trim((string) ($territory['wiki_affiliation_raw'] ?? ''));
    if ($affiliation !== '') {
        $parts = preg_split('/\s*[:;]\s*/u', $affiliation) ?: [];
        $first = trim((string) reset($parts));
        if ($first !== '') {
            return $first;
        }
    }

    return trim((string) ($territory['name'] ?? ''));
}

function avesmapsPoliticalResolveHierarchyDisplayRootName(
    int $territoryId,
    array $territoriesById,
    array $childrenByParentId,
    array &$cache,
    array $trail = []
): string {
    if (isset($cache[$territoryId])) {
        return $cache[$territoryId];
    }

    $territory = $territoriesById[$territoryId] ?? null;
    if (!is_array($territory) || isset($trail[$territoryId])) {
        return '';
    }

    $trail[$territoryId] = true;
    $rootName = avesmapsPoliticalResolveHierarchyRootName($territory);
    if (!avesmapsPoliticalIsGenericHierarchyRootName($rootName)) {
        $cache[$territoryId] = $rootName;
        return $rootName;
    }

    $rootCounts = [];
    foreach ((array) ($childrenByParentId[$territoryId] ?? []) as $childId) {
        if (!is_int($childId)) {
            continue;
        }

        $childRootName = avesmapsPoliticalResolveHierarchyDisplayRootName(
            $childId,
            $territoriesById,
            $childrenByParentId,
            $cache,
            $trail
        );
        if ($childRootName === '' || avesmapsPoliticalIsGenericHierarchyRootName($childRootName)) {
            continue;
        }

        $rootCounts[$childRootName] = (int) ($rootCounts[$childRootName] ?? 0) + 1;
    }

    if ($rootCounts === []) {
        $cache[$territoryId] = $rootName;
        return $rootName;
    }

    uksort($rootCounts, 'strnatcasecmp');
    arsort($rootCounts);
    $displayRootName = (string) array_key_first($rootCounts);
    $cache[$territoryId] = $displayRootName;
    return $displayRootName;
}

function avesmapsPoliticalReadAssignmentDisplaysFromStyle(array $style): array {
    $rawDisplays = $style['assignmentDisplays'] ?? $style['assignment_displays'] ?? [];
    if (!is_array($rawDisplays)) {
        return [];
    }

    $displays = [];
    foreach ($rawDisplays as $rawDisplay) {
        if (!is_array($rawDisplay)) {
            continue;
        }

        $territoryPublicId = trim((string) (
            $rawDisplay['territoryPublicId']
            ?? $rawDisplay['territory_public_id']
            ?? ''
        ));

        $nodeKey = trim((string) (
            $rawDisplay['nodeKey']
            ?? $rawDisplay['node_key']
            ?? ''
        ));

        $originalName = trim((string) (
            $rawDisplay['originalName']
            ?? $rawDisplay['original_name']
            ?? $rawDisplay['name']
            ?? ''
        ));

        $displayName = trim((string) (
            $rawDisplay['displayName']
            ?? $rawDisplay['display_name']
            ?? ''
        ));

        if ($territoryPublicId === '' && $nodeKey === '' && $originalName === '' && $displayName === '') {
            continue;
        }

        $opacity = $rawDisplay['opacity'] ?? null;
        $existsUntilToday = array_key_exists('existsUntilToday', $rawDisplay)
            ? filter_var($rawDisplay['existsUntilToday'], FILTER_VALIDATE_BOOL)
            : (
                array_key_exists('exists_until_today', $rawDisplay)
                    ? filter_var($rawDisplay['exists_until_today'], FILTER_VALIDATE_BOOL)
                    : false
            );

        $isLocalOverride = filter_var(
            $rawDisplay['localOverride']
            ?? $rawDisplay['local_override']
            ?? false,
            FILTER_VALIDATE_BOOL
        );

        $displays[] = [
            'territoryPublicId' => $territoryPublicId,
            'territory_public_id' => $territoryPublicId,
            'nodeKey' => $nodeKey,
            'node_key' => $nodeKey,
            'originalName' => $originalName,
            'original_name' => $originalName,
            'displayName' => $displayName,
            'display_name' => $displayName,
            'coatOfArmsUrl' => trim((string) (
                $rawDisplay['coatOfArmsUrl']
                ?? $rawDisplay['coat_of_arms_url']
                ?? ''
            )),
            'otherSource' => is_array($rawDisplay['otherSource'] ?? null) ? $rawDisplay['otherSource'] : null,
            'color' => trim((string) ($rawDisplay['color'] ?? '')),
            'opacity' => is_numeric($opacity) ? (float) $opacity : null,
            'zoomMin' => avesmapsPoliticalNullableInt($rawDisplay['zoomMin'] ?? $rawDisplay['zoom_min'] ?? null),
            'zoomMax' => avesmapsPoliticalNullableInt($rawDisplay['zoomMax'] ?? $rawDisplay['zoom_max'] ?? null),
            'startYear' => avesmapsPoliticalNullableInt($rawDisplay['startYear'] ?? $rawDisplay['start_year'] ?? null),
            'endYear' => $existsUntilToday ? null : avesmapsPoliticalNullableInt($rawDisplay['endYear'] ?? $rawDisplay['end_year'] ?? null),
            'existsUntilToday' => $existsUntilToday,
            'localOverride' => $isLocalOverride,
            'local_override' => $isLocalOverride,
        ];
    }

    return $displays;
}

function avesmapsPoliticalFindAssignmentDisplayForTerritory(array $style, string $territoryPublicId, string $nodeKey = ''): ?array {
    $territoryPublicId = trim($territoryPublicId);
    $nodeKey = trim($nodeKey);

    foreach (avesmapsPoliticalReadAssignmentDisplaysFromStyle($style) as $display) {
        if (empty($display['localOverride']) && empty($display['local_override'])) {
            continue;
        }

        $displayTerritoryPublicId = trim((string) ($display['territoryPublicId'] ?? $display['territory_public_id'] ?? ''));
        $displayNodeKey = trim((string) ($display['nodeKey'] ?? $display['node_key'] ?? ''));

        if ($territoryPublicId !== '' && $displayTerritoryPublicId === $territoryPublicId) {
            return $display;
        }

        if ($nodeKey !== '' && $displayNodeKey === $nodeKey) {
            return $display;
        }
    }

    return null;
}

function avesmapsPoliticalResolveAssignmentDisplayName(?array $display, string $fallbackName): string {
    if ($display === null) {
        return trim($fallbackName);
    }

    $displayName = trim((string) ($display['displayName'] ?? $display['display_name'] ?? ''));
    if ($displayName !== '' && !avesmapsPoliticalIsGenericHierarchyRootName($displayName)) {
        return $displayName;
    }

    $originalName = trim((string) ($display['originalName'] ?? $display['original_name'] ?? ''));
    if ($originalName !== '' && !avesmapsPoliticalIsGenericHierarchyRootName($originalName)) {
        return $originalName;
    }

    return trim($fallbackName);
}

function avesmapsPoliticalIsGenericHierarchyRootName(string $rootName): bool {
    $normalizedRootName = trim($rootName);
    if ($normalizedRootName === '') {
        return false;
    }

    if (preg_match('/^unabh.*ngig\b/iu', $normalizedRootName) === 1) {
        return true;
    }

    if (preg_match('/^umstritten\b/iu', $normalizedRootName) === 1) {
        return true;
    }

    if (preg_match('/^ungekl.*rt\b/iu', $normalizedRootName) === 1) {
        return true;
    }

    $rootKey = avesmapsPoliticalNormalizeHierarchyRootKey($normalizedRootName);

    return in_array($rootKey, ['unabhangig', 'unabhngig', 'umstritten', 'ungeklart', 'ungeklrt'], true);
}

function avesmapsPoliticalNormalizeHierarchyRootKey(string $value): string {
    $normalized = trim($value);
    if ($normalized === '') {
        return '';
    }

    if (function_exists('mb_strtolower')) {
        $normalized = mb_strtolower($normalized);
    } else {
        $normalized = strtolower($normalized);
    }

    $normalized = str_replace('ß', 'ss', $normalized);
    if (function_exists('iconv')) {
        $transliterated = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $normalized);
        if (is_string($transliterated)) {
            $normalized = $transliterated;
        }
    }

    $normalized = preg_replace('/[^a-z0-9]+/i', '', $normalized) ?? '';

    return $normalized;
}

function avesmapsPoliticalInferPublicTerritoryParentId(array $territory, array $aliasToIds, array $territoriesById): int {
    $parentName = '';
    $path = $territory['wiki_affiliation_path'] ?? [];
    if (is_array($path) && $path !== []) {
        $parentName = (string) end($path);
        if (avesmapsPoliticalSlug($parentName) === avesmapsPoliticalSlug((string) ($territory['name'] ?? ''))) {
            $parentName = count($path) > 1 ? (string) $path[count($path) - 2] : '';
        }
    }

    if (trim($parentName) === '') {
        $affiliation = trim((string) ($territory['wiki_affiliation_raw'] ?? ''));
        $parentName = avesmapsPoliticalExtractCurrentPoliticalParentName($affiliation);
    }

    $parentId = avesmapsPoliticalResolveParentAliasId(
        $aliasToIds,
        $parentName,
        $territoriesById,
        $territory,
        (int) ($territory['id'] ?? 0)
    );
    return $parentId === (int) ($territory['id'] ?? 0) ? 0 : $parentId;
}

// Feature #1.2: render-unabhaengige Bounding-Box eines Territoriums (Quell- UND
// Derived-Geometrie vereint) fuer den Karten-Fokus beim Breadcrumb-Durchwechseln.
// Liefert bounds=null, wenn das Territorium keine (aktive) Geometrie hat -> Ansicht ruhig.
function avesmapsPoliticalReadTerritoryBounds(PDO $pdo, array $query): array {
    $publicId = avesmapsPoliticalReadPublicId($query['public_id'] ?? $query['territory_public_id'] ?? '');

    try {
        $territory = avesmapsPoliticalFetchTerritoryByPublicId($pdo, $publicId);
    } catch (InvalidArgumentException) {
        return ['ok' => true, 'bounds' => null];
    }

    $territoryId = (int) ($territory['id'] ?? 0);
    if ($territoryId < 1) {
        return ['ok' => true, 'bounds' => null];
    }

    $statement = $pdo->prepare(
        'SELECT MIN(min_x) AS min_x, MIN(min_y) AS min_y, MAX(max_x) AS max_x, MAX(max_y) AS max_y
        FROM (
            SELECT min_x, min_y, max_x, max_y
            FROM political_territory_geometry
            WHERE territory_id = :tid_geometry AND is_active = 1
            UNION ALL
            SELECT min_x, min_y, max_x, max_y
            FROM political_territory_derived_geometry
            WHERE territory_id = :tid_derived AND is_active = 1
        ) AS combined'
    );
    $statement->execute([
        'tid_geometry' => $territoryId,
        'tid_derived' => $territoryId,
    ]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$row || $row['min_x'] === null || $row['min_y'] === null || $row['max_x'] === null || $row['max_y'] === null) {
        return ['ok' => true, 'bounds' => null];
    }

    return [
        'ok' => true,
        'bounds' => [
            'min_x' => (float) $row['min_x'],
            'min_y' => (float) $row['min_y'],
            'max_x' => (float) $row['max_x'],
            'max_y' => (float) $row['max_y'],
        ],
    ];
}

function avesmapsPoliticalFetchTerritoryByRequest(PDO $pdo, array $query): array {
    $publicId = avesmapsPoliticalReadPublicId($query['public_id'] ?? $query['territory_public_id'] ?? '');

    return avesmapsPoliticalFetchTerritoryByPublicId($pdo, $publicId);
}

function avesmapsPoliticalFetchTerritoryByPublicId(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare(
        'SELECT
            territory.*,
            parent.public_id AS parent_public_id,
            parent.name AS parent_name,
            capital_place.public_id AS capital_place_public_id,
            seat_place.public_id AS seat_place_public_id,
            wiki.name AS wiki_name,
            wiki.type AS wiki_type,
            wiki.affiliation_raw AS wiki_affiliation_raw,
            wiki.affiliation_root AS wiki_affiliation_root,
            wiki.affiliation_path_json AS wiki_affiliation_path_json,
            wiki.founded_text AS wiki_founded_text,
            wiki.dissolved_text AS wiki_dissolved_text,
            wiki.capital_name AS wiki_capital_name,
            wiki.seat_name AS wiki_seat_name
        FROM political_territory territory
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        WHERE territory.public_id = :public_id
        LIMIT 1'
    );
    $statement->execute(['public_id' => $publicId]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$territory) {
        throw new InvalidArgumentException('Das Herrschaftsgebiet wurde nicht gefunden.');
    }

    return $territory;
}

function avesmapsPoliticalFetchTerritoryById(PDO $pdo, int $territoryId): array {
    $statement = $pdo->prepare(
        'SELECT
            territory.*,
            parent.public_id AS parent_public_id,
            parent.name AS parent_name,
            capital_place.public_id AS capital_place_public_id,
            seat_place.public_id AS seat_place_public_id,
            wiki.name AS wiki_name,
            wiki.type AS wiki_type,
            wiki.affiliation_raw AS wiki_affiliation_raw,
            wiki.affiliation_root AS wiki_affiliation_root,
            wiki.affiliation_path_json AS wiki_affiliation_path_json,
            wiki.founded_text AS wiki_founded_text,
            wiki.dissolved_text AS wiki_dissolved_text,
            wiki.capital_name AS wiki_capital_name,
            wiki.seat_name AS wiki_seat_name
        FROM political_territory territory
        LEFT JOIN political_territory parent ON parent.id = territory.parent_id
        LEFT JOIN map_features capital_place ON capital_place.id = territory.capital_place_id
        LEFT JOIN map_features seat_place ON seat_place.id = territory.seat_place_id
        LEFT JOIN political_territory_wiki wiki ON wiki.id = territory.wiki_id
        WHERE territory.id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $territoryId]);
    $territory = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$territory) {
        throw new InvalidArgumentException('Das Herrschaftsgebiet wurde nicht gefunden.');
    }

    return $territory;
}

function avesmapsPoliticalFetchTerritoryPublicIdById(PDO $pdo, int $territoryId): string {
    return (string) avesmapsPoliticalFetchTerritoryById($pdo, $territoryId)['public_id'];
}

function avesmapsPoliticalFetchWikiById(PDO $pdo, int $wikiId): array {
    $statement = $pdo->prepare('SELECT * FROM political_territory_wiki WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $wikiId]);
    $wiki = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$wiki) {
        throw new InvalidArgumentException('Die Wiki-Referenzdaten wurden nicht gefunden.');
    }

    return $wiki;
}

function avesmapsPoliticalReadOptionalTerritoryId(PDO $pdo, mixed $publicId): ?int {
    $value = avesmapsNormalizeSingleLine((string) ($publicId ?? ''), 36);
    if ($value === '') {
        return null;
    }

    return (int) avesmapsPoliticalFetchTerritoryByPublicId($pdo, avesmapsPoliticalReadPublicId($value))['id'];
}

function avesmapsPoliticalReadOptionalWikiId(PDO $pdo, mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $wikiId = filter_var($value, FILTER_VALIDATE_INT);
    if ($wikiId === false || $wikiId < 1) {
        throw new InvalidArgumentException('Die Wiki-Referenz ist ungueltig.');
    }

    $statement = $pdo->prepare(
        'SELECT id
        FROM political_territory_wiki
        WHERE id = :id
            AND continent = :continent
        LIMIT 1'
    );
    $statement->execute([
        'id' => (int) $wikiId,
        'continent' => AVESMAPS_POLITICAL_DEFAULT_CONTINENT,
    ]);
    if ($statement->fetchColumn() === false) {
        throw new InvalidArgumentException('Die Wiki-Referenz wurde nicht gefunden.');
    }

    return (int) $wikiId;
}

function avesmapsPoliticalReadPublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die Herrschaftsgebiet-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsPoliticalReadRequiredName(mixed $value, string $fieldLabel): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 255);
    if ($name === '') {
        throw new InvalidArgumentException("{$fieldLabel} fehlt.");
    }

    return $name;
}

function avesmapsPoliticalReadHexColor(mixed $value): string {
    $color = avesmapsNormalizeSingleLine((string) ($value ?: '#888888'), 9);
    if (preg_match('/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/', $color) !== 1) {
        throw new InvalidArgumentException('Der Farbwert ist ungueltig.');
    }

    return $color;
}

function avesmapsPoliticalReadOpacity(mixed $value): float {
    $opacity = filter_var($value, FILTER_VALIDATE_FLOAT);
    if ($opacity === false || $opacity < 0 || $opacity > 1) {
        throw new InvalidArgumentException('Die Transparenz ist ungueltig.');
    }

    return (float) $opacity;
}

function avesmapsPoliticalReadBoolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
}

function avesmapsPoliticalReadOptionalInt(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $parsedValue = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsedValue === false) {
        throw new InvalidArgumentException('Ein Zahlenwert ist ungueltig.');
    }

    return (int) $parsedValue;
}

function avesmapsPoliticalReadEditorValidTo(array $state, mixed $fallback = null): ?int {
    if (!empty($state['existsUntilToday'])) {
        return null;
    }

    if (array_key_exists('endYear', $state)) {
        if ($state['endYear'] === null || $state['endYear'] === '') {
            return null;
        }

        return avesmapsPoliticalReadOptionalInt($state['endYear']);
    }

    return avesmapsPoliticalReadOptionalInt($fallback);
}

function avesmapsPoliticalReadOptionalZoom(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $zoom = filter_var($value, FILTER_VALIDATE_INT);
    if ($zoom === false || $zoom < 0 || $zoom > 6) {
        throw new InvalidArgumentException('Die Zoomstufe ist ungueltig.');
    }

    return (int) $zoom;
}

// Klemmt einen ANGEFRAGTEN Layer-Zoom auf das politische Band-Maximum (6). Die Karte erlaubt jetzt
// Zoom 7; die politischen Zoom-Baender gehen aber nur bis 6. Ueber 6 -> 6 (Zoom 7 zeigt die
// Zoom-6-Ansicht statt einen "Zoomstufe ungueltig"-Fehler zu werfen). Gilt NUR fuer den Layer-Request;
// gespeicherte Territoriums-Baender bleiben strikt via avesmapsPoliticalReadOptionalZoom validiert.
function avesmapsPoliticalClampLayerRequestZoom(mixed $value): mixed {
    if (is_numeric($value) && (int) $value > 6) {
        return 6;
    }

    return $value;
}

function avesmapsPoliticalReadOpenEndedValidTo(array $payload, mixed $fallback = null): ?int {
    if (avesmapsPoliticalReadBoolean($payload['valid_to_open'] ?? false)) {
        return null;
    }

    return avesmapsPoliticalReadOptionalInt($payload['valid_to_bf'] ?? $fallback);
}

function avesmapsPoliticalReadOptionalUrl(mixed $value, string $fieldLabel): string {
    return avesmapsNormalizeOptionalUrl((string) ($value ?? ''), 500, $fieldLabel);
}

function avesmapsPoliticalExpandTerritoryAliases(array $values): array {
    $aliases = [];
    foreach ($values as $value) {
        $text = trim((string) $value);
        if ($text === '') {
            continue;
        }

        $aliases[] = $text;
        $withoutParenthetical = trim((string) preg_replace('/\s*\([^)]*\)/u', '', $text));
        if ($withoutParenthetical !== '') {
            $aliases[] = $withoutParenthetical;
        }

        foreach (preg_split('/\s*,\s*/u', $withoutParenthetical) ?: [] as $part) {
            $part = trim((string) $part);
            if ($part !== '') {
                $aliases[] = $part;
            }
        }
    }

    return array_values(array_unique($aliases));
}
