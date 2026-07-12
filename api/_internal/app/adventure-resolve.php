<?php

declare(strict_types=1);

// Abenteuer name resolution (Spec §5): map a wiki "Ort" page name to ONE entity, precedence
// settlement -> territory -> region -> path, else 'unresolved'. The reliable axis is a canonical
// wiki-key built by the SAME slugger on both sides (avesmapsPoliticalSlug) -- NOT a fuzzy name match
// (the design's slug-divergence warning, §5.2). This runs ONLY on the resolve action / editor, never
// on the hot catalog read, so requiring the political lib here does not touch the public read path.

require_once __DIR__ . '/../political/territory.php'; // avesmapsPoliticalSlug, avesmapsPoliticalBuildWikiKey
require_once __DIR__ . '/adventures.php';             // avesmapsAdventuresEnsureTables (resolve writer)

if (!function_exists('avesmapsPoliticalSlug') || !function_exists('avesmapsPoliticalBuildWikiKey')) {
    throw new RuntimeException('adventure-resolve requires the political territory library.');
}

// Canonical 'wiki:<slug>' key for a raw place name. Matches political_territory.wiki_key and the key
// built from any entity's stored wiki_url via avesmapsPoliticalBuildWikiKey (both go through
// avesmapsPoliticalSlug, so any locale-dependent transliteration cancels out).
function avesmapsAdventureCanonicalKeyForName(string $rawName): string
{
    $slug = avesmapsPoliticalSlug(trim($rawName));
    return $slug === '' ? '' : 'wiki:' . $slug;
}

// Redirect alias (wiki_redirect_alias: alias_slug PK -> canonical_wiki_key). Returns '' when there is
// no alias row or the table does not exist yet (fresh DB) -- the caller then falls back to the
// name-derived canonical key.
function avesmapsAdventureResolveRedirect(PDO $pdo, string $rawName): string
{
    $title = trim((string) preg_replace('/#.*$/', '', str_replace('_', ' ', $rawName)));
    $aliasSlug = avesmapsPoliticalSlug($title);
    if ($aliasSlug === '') {
        return '';
    }
    try {
        $statement = $pdo->prepare('SELECT canonical_wiki_key FROM wiki_redirect_alias WHERE alias_slug = :s LIMIT 1');
        $statement->execute(['s' => $aliasSlug]);
        $value = $statement->fetchColumn();
        return $value === false ? '' : trim((string) $value);
    } catch (Throwable $exception) {
        return '';
    }
}

// PURE matcher (no DB) -- the unit-testable core. Given a raw place name and precomputed candidate
// key-maps, return ['kind','public_id','wiki_key'] following the precedence. $candidates:
//   'settlement'|'territory'|'region' => [ 'wiki:<slug>'  => public_id ]   (avesmapsPoliticalBuildWikiKey / column)
//   'path'                            => [ '<bare-slug>'  => public_id ]   (path wiki_key is UNPREFIXED)
// $canonicalKeyOverride lets a caller inject a redirect-resolved key; empty => derive from the name.
function avesmapsAdventureMatchCandidates(string $rawName, array $candidates, string $canonicalKeyOverride = ''): array
{
    $canonicalKey = $canonicalKeyOverride !== '' ? $canonicalKeyOverride : avesmapsAdventureCanonicalKeyForName($rawName);
    if ($canonicalKey === '') {
        return ['kind' => 'unresolved', 'public_id' => '', 'wiki_key' => ''];
    }
    foreach (['settlement', 'territory', 'region'] as $kind) {
        if (isset($candidates[$kind]) && array_key_exists($canonicalKey, $candidates[$kind])) {
            return ['kind' => $kind, 'public_id' => (string) $candidates[$kind][$canonicalKey], 'wiki_key' => $canonicalKey];
        }
    }
    $bareSlug = (string) preg_replace('/^wiki:/', '', $canonicalKey);
    if (isset($candidates['path']) && array_key_exists($bareSlug, $candidates['path'])) {
        return ['kind' => 'path', 'public_id' => (string) $candidates['path'][$bareSlug], 'wiki_key' => $bareSlug];
    }
    return ['kind' => 'unresolved', 'public_id' => '', 'wiki_key' => $canonicalKey];
}

// Build the candidate key-maps ONCE from the DB (no per-place N+1). Narrowed by feature_type; the
// diacritic/translit normalization can't run in SQL, so keys are built in PHP. This is a type-filtered
// scan of map_features (cheaper than map-search.php, which scans ALL active rows every request) plus an
// indexed read of political_territory.wiki_key -- run it once per resolve pass, never in a loop.
function avesmapsAdventureLoadCandidates(PDO $pdo): array
{
    $candidates = ['settlement' => [], 'territory' => [], 'region' => [], 'path' => []];

    $mapFeatures = $pdo->query(
        "SELECT public_id, feature_type, name, properties_json
           FROM map_features
          WHERE is_active = 1 AND feature_type IN ('location','region','path')"
    );
    foreach ($mapFeatures as $row) {
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        if (!is_array($props)) {
            continue;
        }
        $publicId = (string) $row['public_id'];
        $name = (string) ($row['name'] ?? '');
        $type = (string) $row['feature_type'];

        if ($type === 'location') {
            // A location's wiki link lives in properties.wiki_url (editor) and/or the WikiSync object
            // properties.wiki_settlement.{title,wiki_url}. wiki_settlement.title is the most canonical
            // (exact page title); fall back to wiki_url. First writer wins (do not overwrite).
            $settlement = is_array($props['wiki_settlement'] ?? null) ? $props['wiki_settlement'] : [];
            $title = trim((string) ($settlement['title'] ?? ''));
            if ($title !== '') {
                $key = avesmapsAdventureCanonicalKeyForName($title);
                if ($key !== '' && !isset($candidates['settlement'][$key])) {
                    $candidates['settlement'][$key] = $publicId;
                }
            }
            $wikiUrl = trim((string) ($settlement['wiki_url'] ?? ''));
            if ($wikiUrl === '') {
                $wikiUrl = trim((string) ($props['wiki_url'] ?? ''));
            }
            if ($wikiUrl !== '') {
                $key = avesmapsPoliticalBuildWikiKey($wikiUrl, $name);
                if (strncmp($key, 'wiki:', 5) === 0 && !isset($candidates['settlement'][$key])) {
                    $candidates['settlement'][$key] = $publicId;
                }
            }
        } elseif ($type === 'region') {
            $wikiUrl = trim((string) ($props['wiki_url'] ?? ''));
            if ($wikiUrl !== '') {
                $key = avesmapsPoliticalBuildWikiKey($wikiUrl, $name);
                if (strncmp($key, 'wiki:', 5) === 0 && !isset($candidates['region'][$key])) {
                    $candidates['region'][$key] = $publicId;
                }
            }
        } else { // path -- properties.wiki_path.wiki_key is a BARE slug (no 'wiki:' prefix)
            $pathKey = is_array($props['wiki_path'] ?? null) ? trim((string) ($props['wiki_path']['wiki_key'] ?? '')) : '';
            if ($pathKey !== '' && !isset($candidates['path'][$pathKey])) {
                $candidates['path'][$pathKey] = $publicId; // one representative segment per way
            }
        }
    }

    // Territories: wiki_key is an indexed, already 'wiki:'-prefixed column. Multiple timeline/is_active
    // variants can share a wiki_key; the first row wins (Phase-1 aggregation is Phase 2, exact variant
    // does not matter here).
    $territories = $pdo->query(
        "SELECT public_id, wiki_key FROM political_territory WHERE wiki_key IS NOT NULL AND wiki_key <> ''"
    );
    foreach ($territories as $row) {
        $key = trim((string) $row['wiki_key']);
        if ($key !== '' && !isset($candidates['territory'][$key])) {
            $candidates['territory'][$key] = (string) $row['public_id'];
        }
    }

    return $candidates;
}

// Single-place resolve (editor / ad-hoc). Loads candidates every call -> use avesmapsAdventureResolveAll
// for bulk work.
function avesmapsAdventureResolvePlace(PDO $pdo, string $rawName): array
{
    $candidates = avesmapsAdventureLoadCandidates($pdo);
    $canonical = avesmapsAdventureResolveRedirect($pdo, $rawName);
    return avesmapsAdventureMatchCandidates($rawName, $candidates, $canonical);
}

// ---- Phase 2: territory ancestor path (for client-side subtree aggregation) ----------------------

// Territory parent tree from wiki_territory_model (the canonical parent_wiki_key map). Ancestors are
// walked over parent_wiki_key ONLY (KERN-INVARIANTE -- NEVER via affiliation_path). Empty on a fresh DB.
function avesmapsAdventureLoadTerritoryParentMap(PDO $pdo): array
{
    $map = [];
    try {
        $rows = $pdo->query('SELECT wiki_key, parent_wiki_key FROM wiki_territory_model');
        foreach ($rows ?: [] as $row) {
            $key = trim((string) ($row['wiki_key'] ?? ''));
            if ($key !== '') {
                $map[$key] = $row['parent_wiki_key'] !== null ? trim((string) $row['parent_wiki_key']) : '';
            }
        }
    } catch (Throwable $exception) {
        // wiki_territory_model absent on a fresh DB -> no territory aggregation until it is synced.
    }
    return $map;
}

// Settlement public_id -> its ray-cast deepest territory_wiki_key (map_features.properties_json). Bounded
// scan of active locations (same cost class as the candidate scan; resolve is not a hot path).
function avesmapsAdventureLoadSettlementTerritoryKeys(PDO $pdo): array
{
    $map = [];
    $rows = $pdo->query(
        "SELECT public_id, properties_json FROM map_features WHERE feature_type = 'location' AND is_active = 1"
    );
    foreach ($rows ?: [] as $row) {
        $props = json_decode((string) ($row['properties_json'] ?? ''), true);
        if (!is_array($props)) {
            continue;
        }
        $territoryKey = isset($props['territory_wiki_key']) ? trim((string) $props['territory_wiki_key']) : '';
        if ($territoryKey !== '') {
            $map[(string) $row['public_id']] = $territoryKey;
        }
    }
    return $map;
}

// Ancestor chain [deepest, parent, ..., root] via parent_wiki_key, cycle-guarded.
function avesmapsAdventureTerritoryAncestors(string $deepestWikiKey, array $parentMap): array
{
    $path = [];
    $seen = [];
    $current = trim($deepestWikiKey);
    while ($current !== '' && !isset($seen[$current])) {
        $seen[$current] = true;
        $path[] = $current;
        $current = isset($parentMap[$current]) ? trim((string) $parentMap[$current]) : '';
    }
    return $path;
}

// Resolve-all: (1) resolve every place still 'unresolved' (manually CHOSEN targets have target_kind !=
// 'unresolved' and are left untouched = override protection); (2) fill target_territory_path for
// settlement/territory places (from the deepest territory + parent tree) so the client aggregates
// territory/region adventures locally. Processes places that are unresolved OR still missing a path;
// idempotent. Candidate maps + parent tree loaded once (no N+1). Returns counts.
function avesmapsAdventureResolveAll(PDO $pdo): array
{
    avesmapsAdventuresEnsureTables($pdo);
    $places = $pdo->query(
        "SELECT id, raw_name, target_kind, target_public_id, target_wiki_key
           FROM adventure_place
          WHERE status = 'approved' AND (target_kind = 'unresolved' OR target_territory_path IS NULL)"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($places === []) {
        return ['resolved' => 0, 'unresolved' => 0, 'total' => 0, 'paths' => 0];
    }

    $candidates = avesmapsAdventureLoadCandidates($pdo);
    $parentMap = avesmapsAdventureLoadTerritoryParentMap($pdo);
    $settlementTerritory = avesmapsAdventureLoadSettlementTerritoryKeys($pdo);
    $update = $pdo->prepare(
        "UPDATE adventure_place
            SET target_kind = :kind, target_public_id = :pid, target_wiki_key = :wkey, target_territory_path = :path
          WHERE id = :id"
    );

    $resolved = 0;
    $stillUnresolved = 0;
    $paths = 0;
    foreach ($places as $place) {
        if ((string) $place['target_kind'] === 'unresolved') {
            $rawName = (string) $place['raw_name'];
            $canonical = avesmapsAdventureResolveRedirect($pdo, $rawName);
            $match = avesmapsAdventureMatchCandidates($rawName, $candidates, $canonical);
            $kind = $match['kind'];
            $publicId = $match['public_id'];
            $wikiKey = $match['wiki_key'];
            if ($kind === 'unresolved') {
                $stillUnresolved++;
            } else {
                $resolved++;
            }
        } else {
            $kind = (string) $place['target_kind'];
            $publicId = $place['target_public_id'] !== null ? (string) $place['target_public_id'] : '';
            $wikiKey = $place['target_wiki_key'] !== null ? (string) $place['target_wiki_key'] : '';
        }

        $deepestTerritoryKey = '';
        if ($kind === 'settlement' && $publicId !== '') {
            $deepestTerritoryKey = $settlementTerritory[$publicId] ?? '';
        } elseif ($kind === 'territory' && $wikiKey !== '') {
            $deepestTerritoryKey = $wikiKey;
        }
        $path = $deepestTerritoryKey !== '' ? avesmapsAdventureTerritoryAncestors($deepestTerritoryKey, $parentMap) : [];
        if ($path !== []) {
            $paths++;
        }

        $update->execute([
            'kind' => $kind,
            'pid' => $publicId !== '' ? $publicId : null,
            'wkey' => $wikiKey !== '' ? $wikiKey : null,
            'path' => json_encode(array_values($path), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'id' => (int) $place['id'],
        ]);
    }

    return ['resolved' => $resolved, 'unresolved' => $stillUnresolved, 'total' => count($places), 'paths' => $paths];
}
