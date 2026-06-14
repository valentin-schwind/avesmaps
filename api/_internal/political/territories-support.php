<?php

declare(strict_types=1);

function avesmapsPoliticalSignedRingArea(array $ring): float {
    $area = 0.0;
    $count = count($ring);
    for ($index = 0; $index < $count - 1; $index++) {
        $current = $ring[$index];
        $next = $ring[$index + 1];
        $area += (float) ($current[0] ?? 0) * (float) ($next[1] ?? 0)
            - (float) ($next[0] ?? 0) * (float) ($current[1] ?? 0);
    }

    return $area / 2;
}

function avesmapsPoliticalRingIsClosed(array $ring): bool {
    if (count($ring) < 2) {
        return false;
    }

    $first = $ring[0];
    $last = $ring[count($ring) - 1];

    return abs((float) ($first[0] ?? 0) - (float) ($last[0] ?? 0)) <= 0.000001
        && abs((float) ($first[1] ?? 0) - (float) ($last[1] ?? 0)) <= 0.000001;
}

function avesmapsPoliticalExtractCurrentPoliticalParentName(string $affiliation): string {
    $affiliation = trim($affiliation);
    if ($affiliation === '' || avesmapsPoliticalIsGenericHierarchyRootName($affiliation)) {
        return '';
    }

    $clauses = preg_split('/\s*[;·]\s*/u', $affiliation) ?: [];
    $clauses = array_values(array_filter(array_map('trim', $clauses)));

    foreach ($clauses as $clause) {
        if (preg_match('/^politisch\b/iu', $clause) === 1) {
            $parent = preg_replace('/^politisch\s*/iu', '', $clause) ?? $clause;
            return trim($parent, " \t\n\r\0\x0B,:;");
        }
    }

    foreach ($clauses as $clause) {
        if (preg_match('/^(?:derographisch|geographisch|ehemals|früher|frueher|historisch)\b/iu', $clause) === 1) {
            continue;
        }

        $parts = preg_split('/\s*:\s*/u', $clause) ?: [];
        $candidate = trim((string) end($parts));
        if ($candidate !== '') {
            return $candidate;
        }
    }

    $firstClause = $clauses[0] ?? $affiliation;
    $parts = preg_split('/\s*:\s*/u', $firstClause) ?: [];

    return trim((string) end($parts));
}

function avesmapsPoliticalBuildAliasIndex(array $territories, callable $aliasReader): array {
    $aliasToIds = [];
    foreach ($territories as $territoryId => $territory) {
        $resolvedId = (int) ($territory['id'] ?? $territoryId);
        foreach ((array) $aliasReader($territory) as $alias) {
            $slug = avesmapsPoliticalSlug((string) $alias);
            if ($slug === '') {
                continue;
            }

            $aliasToIds[$slug] ??= [];
            if (!in_array($resolvedId, $aliasToIds[$slug], true)) {
                $aliasToIds[$slug][] = $resolvedId;
            }
        }
    }

    return $aliasToIds;
}

function avesmapsPoliticalDetectTimelineIssue(array $territory): string {
    $validTo = avesmapsPoliticalNullableInt($territory['valid_to_bf'] ?? null);
    $dissolvedText = mb_strtolower((string) ($territory['wiki_dissolved_text'] ?? ''));
    if ($validTo === 0 && str_contains($dissolvedText, 'besteht')) {
        return 'valid_to_zero_but_ongoing';
    }

    return '';
}

function avesmapsPoliticalCollectCoordinatePairs(mixed $coordinates, array &$coordinatePairs): void {
    if (!is_array($coordinates)) {
        return;
    }
    if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
        $coordinatePairs[] = [(float) $coordinates[0], (float) $coordinates[1]];
        return;
    }

    foreach ($coordinates as $coordinate) {
        avesmapsPoliticalCollectCoordinatePairs($coordinate, $coordinatePairs);
    }
}

function avesmapsPoliticalUniqueName(PDO $pdo, string $baseName, ?int $excludeId = null): string {
    $normalizedBaseName = avesmapsNormalizeSingleLine($baseName, 240);
    $namePrefix = $normalizedBaseName !== '' ? $normalizedBaseName : 'Neues Herrschaftsgebiet';
    $candidate = $namePrefix;
    $suffix = 2;
    while (avesmapsPoliticalNameExists($pdo, $candidate, $excludeId) && $suffix < 10000) {
        $candidate = avesmapsNormalizeSingleLine("{$namePrefix} ({$suffix})", 255);
        $suffix++;
    }

    if ($suffix >= 10000) {
        throw new InvalidArgumentException('Es konnte kein eindeutiger Name erzeugt werden.');
    }

    return $candidate;
}

function avesmapsPoliticalNameExists(PDO $pdo, string $name, ?int $excludeId): bool {
    $sql = 'SELECT COUNT(*) FROM political_territory WHERE name = :name';
    $params = ['name' => $name];
    if ($excludeId !== null) {
        $sql .= ' AND id <> :exclude_id';
        $params['exclude_id'] = $excludeId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return (int) $statement->fetchColumn() > 0;
}

function avesmapsPoliticalAssertZoomRange(?int $minZoom, ?int $maxZoom): void {
    if ($minZoom !== null && $maxZoom !== null && $minZoom > $maxZoom) {
        throw new InvalidArgumentException('Die minimale Zoomstufe darf nicht groesser als die maximale sein.');
    }
}

function avesmapsPoliticalNullableInt(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    return is_numeric($value) ? (int) $value : null;
}

function avesmapsPoliticalNormalizeRowValidTo(mixed $value, array $row): ?int {
    $normalizedValue = avesmapsPoliticalNullableInt($value);
    if ($normalizedValue !== 0) {
        return $normalizedValue;
    }

    if (avesmapsPoliticalIsOpenEndedDissolved(
        (string) ($row['dissolved_type'] ?? $row['wiki_dissolved_type'] ?? ''),
        (string) ($row['dissolved_text'] ?? $row['wiki_dissolved_text'] ?? '')
    )) {
        return null;
    }

    return 0;
}

function avesmapsPoliticalResolveParentAliasId(array $aliasToIds, string $parentName, array $territoriesById, array $childTerritory, int $selfId = 0): int {
    $candidateIds = [];
    foreach (avesmapsPoliticalExpandTerritoryAliases([$parentName]) as $candidate) {
        $slug = avesmapsPoliticalSlug($candidate);
        foreach ((array) ($aliasToIds[$slug] ?? []) as $candidateId) {
            $candidateId = (int) $candidateId;
            if ($candidateId > 0 && $candidateId !== $selfId && !in_array($candidateId, $candidateIds, true)) {
                $candidateIds[] = $candidateId;
            }
        }
    }

    if ($candidateIds === []) {
        return 0;
    }

    if (count($candidateIds) === 1) {
        return $candidateIds[0];
    }

    $bestId = 0;
    $bestScore = PHP_INT_MIN;
    foreach ($candidateIds as $candidateId) {
        $candidate = $territoriesById[$candidateId] ?? null;
        if (!is_array($candidate)) {
            continue;
        }

        $score = avesmapsPoliticalScoreParentCandidate($candidate, $childTerritory);
        if ($score > $bestScore) {
            $bestScore = $score;
            $bestId = $candidateId;
        }
    }

    return $bestId;
}

function avesmapsPoliticalScoreParentCandidate(array $candidate, array $childTerritory): int {
    $score = 0;
    $childPath = (array) ($childTerritory['wiki_affiliation_path'] ?? $childTerritory['affiliation_path_json'] ?? []);
    $childAffiliationRaw = (string) ($childTerritory['wiki_affiliation_raw'] ?? $childTerritory['affiliation_raw'] ?? '');
    $candidateRoot = (string) ($candidate['wiki_affiliation_root'] ?? $candidate['affiliation_root'] ?? '');
    $candidateRaw = (string) ($candidate['wiki_affiliation_raw'] ?? $candidate['affiliation_raw'] ?? '');
    $candidateValidTo = avesmapsPoliticalNormalizeRowValidTo($candidate['valid_to_bf'] ?? null, $candidate);

    if (count($childPath) > 1) {
        $prefix = (string) $childPath[count($childPath) - 2];
        if ($prefix !== '') {
            if (avesmapsPoliticalSlug($candidateRoot) === avesmapsPoliticalSlug($prefix)) {
                $score += 100;
            }
            if (str_contains(avesmapsPoliticalSlug($candidateRaw), avesmapsPoliticalSlug($prefix))) {
                $score += 40;
            }
        }
    }

    $root = (string) ($childTerritory['wiki_affiliation_root'] ?? '');
    if ($root !== '' && avesmapsPoliticalSlug($candidateRoot) === avesmapsPoliticalSlug($root)) {
        $score += 30;
    }

    if ($childAffiliationRaw !== '' && str_contains(avesmapsPoliticalSlug($childAffiliationRaw), avesmapsPoliticalSlug((string) ($candidate['name'] ?? '')))) {
        $score += 10;
    }

    if ($candidateValidTo === null) {
        $score += 20;
    }

    $sortOrder = max(0, (int) ($candidate['sort_order'] ?? 0));
    $score += max(0, 10 - intdiv($sortOrder, 100));

    return $score;
}
