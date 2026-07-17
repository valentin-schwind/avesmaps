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

/**
 * The key a page title WOULD have without its disambiguating parenthetical: "Havena (Siedlung)" ->
 * 'wiki:havena'. Empty string when the title carries no parenthetical.
 *
 * Why this exists: the wiki disambiguates pages that share a name ("Havena (Siedlung)" the city vs the
 * region), but a source that mentions the place in passing just writes "Havena". The canonical key is
 * built from the page title, so those never met -- measured on the live data, Havena alone lost 8 maps
 * that way, plus Cumrat, Donnerbach and Thorwal.
 *
 * It must be a SEPARATE key rather than part of the slug: avesmapsPoliticalSlug turns "(Siedlung)" into
 * "-siedlung", by which point "Havena (Siedlung)" and a genuine "Havena-Siedlung" are indistinguishable.
 * The parenthetical has to be read off the title, before slugging.
 */
function avesmapsAdventureDeparenKeyForTitle(string $pageTitle): string
{
    $title = trim(str_replace('_', ' ', $pageTitle));
    if (preg_match('/^(.*?)\s*\([^)]+\)\s*$/u', $title, $matches) !== 1) {
        return '';
    }
    $base = trim($matches[1]);

    return $base === '' ? '' : avesmapsAdventureCanonicalKeyForName($base);
}

/** The wiki page title behind a wiki_url ("…/wiki/Havena_(Siedlung)" -> "Havena (Siedlung)"). */
function avesmapsAdventurePageTitleFromUrl(string $wikiUrl): string
{
    $path = (string) parse_url(trim($wikiUrl), PHP_URL_PATH);
    if ($path === '') {
        return '';
    }

    return trim(str_replace('_', ' ', rawurldecode(basename($path))));
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

    // LAST RESORT: the name may be the undisambiguated form of a parenthesised page ("Havena" ->
    // "Havena (Siedlung)"). Deliberately AFTER every direct lookup, so this can only ever turn an
    // unresolved into a resolved -- never redirect a name that already matches something. That is what
    // makes it safe for adventures, which share this resolver.
    //
    // ONLY when the winning kind holds EXACTLY ONE such candidate. The wiki uses parentheticals for two
    // different jobs: type ("Havena (Siedlung)" vs the region -- one obvious answer) and location ("Berg
    // (Nordmarken)" vs "Berg (Kosch)" -- no answer at all). Requiring uniqueness resolves the first and
    // refuses the second, instead of guessing. Kind precedence stays settlement > territory > region.
    foreach (['settlement', 'territory', 'region'] as $kind) {
        $rows = $candidates[$kind . '_deparen'][$canonicalKey] ?? [];
        if (count($rows) === 1) {
            return [
                'kind' => $kind,
                'public_id' => (string) $rows[0]['public_id'],
                // The REAL key of the page we landed on, not the searched-for one -- the territory path
                // lookup keys off this, and 'wiki:havena' names no page.
                'wiki_key' => (string) $rows[0]['wiki_key'],
            ];
        }
    }

    return ['kind' => 'unresolved', 'public_id' => '', 'wiki_key' => $canonicalKey];
}

// Build the candidate key-maps ONCE from the DB (no per-place N+1). Narrowed by feature_type; the
// diacritic/translit normalization can't run in SQL, so keys are built in PHP. This is a type-filtered
// scan of map_features (cheaper than map-search.php, which scans ALL active rows every request) plus an
// indexed read of political_territory.wiki_key -- run it once per resolve pass, never in a loop.
function avesmapsAdventureLoadCandidates(PDO $pdo): array
{
    // The *_deparen maps back the last-resort lookup in avesmapsAdventureMatchCandidates: they map the
    // UNDISAMBIGUATED key ('wiki:havena') to every candidate whose page title carries a parenthetical
    // ('Havena (Siedlung)'). A LIST, not a single value, because uniqueness is the safety condition --
    // two entries mean the name is genuinely ambiguous and must stay unresolved.
    $candidates = [
        'settlement' => [], 'territory' => [], 'region' => [], 'path' => [],
        'settlement_deparen' => [], 'territory_deparen' => [], 'region_deparen' => [],
    ];

    // Record a parenthesised page under its undisambiguated key. Same "first writer wins" rule as the
    // direct maps: a page already seen is not added twice (its title and wiki_url both reach here).
    $addDeparen = static function (array &$candidates, string $kind, string $pageTitle, string $realKey, string $publicId): void {
        $deparenKey = avesmapsAdventureDeparenKeyForTitle($pageTitle);
        if ($deparenKey === '' || $deparenKey === $realKey) {
            return;
        }
        foreach ($candidates[$kind . '_deparen'][$deparenKey] ?? [] as $existing) {
            if ($existing['public_id'] === $publicId) {
                return;
            }
        }
        $candidates[$kind . '_deparen'][$deparenKey][] = ['public_id' => $publicId, 'wiki_key' => $realKey];
    };

    // Landscapes (Raschtulswall, Regengebirge, ...) are stored as feature_type='label' and carry their
    // wiki link like a true region feature -- include them so an adventure/citymap can be assigned to a
    // landscape (owner requirement 2026-07-12); otherwise every landscape stays 'unresolved'.
    //
    // EVERY label subtype counts, not just 'region'. A label's subtype is its landscape CATEGORY, and
    // there are 19 of them (avesmapsReadLabelSubtype in api/_internal/map/features.php: region, gebirge,
    // wald, insel, kontinent, ...); which one a landscape got is an editorial detail, not a statement
    // about whether it is a place. Scanning only 'region' silently excluded 389 of the 529 live labels --
    // Regengebirge is 'gebirge', Aventurien is 'kontinent', and neither could EVER resolve (owner report
    // 2026-07-17). It read as correct because the example everyone tested with, Raschtulswall, is itself
    // a Gebirge that happens to be filed under 'region'. The real gate is the WIKI LINK below.
    //
    // ORDER BY: several labels may share one wiki page (a 'steppe' and a 'region' label both named
    // Brydia). Candidate maps are first-writer-wins, so let the 'region' subtype land first -- that keeps
    // those ties resolving to exactly the row they resolved to before this filter widened.
    $mapFeatures = $pdo->query(
        "SELECT public_id, feature_type, feature_subtype, name, properties_json
           FROM map_features
          WHERE is_active = 1
            AND feature_type IN ('location','region','path','label')
          ORDER BY CASE WHEN feature_subtype = 'region' THEN 0 ELSE 1 END"
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
                if ($key !== '') {
                    $addDeparen($candidates, 'settlement', $title, $key, $publicId);
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
                if (strncmp($key, 'wiki:', 5) === 0) {
                    $addDeparen($candidates, 'settlement', avesmapsAdventurePageTitleFromUrl($wikiUrl), $key, $publicId);
                }
            }
        } elseif ($type === 'region' || $type === 'label') {
            // Landscape labels keep their wiki link NESTED under properties.wiki_region.{wiki_url,wiki_key}
            // -- a top-level properties.wiki_url is EMPTY for many of them (that is why regions never
            // resolved at all before). Read the nested link, with a top-level wiki_url fallback for any
            // true region feature that might carry it directly. A label with NO wiki link either way is
            // simply not a candidate -- this is the gate that makes scanning all label subtypes safe.
            $wikiUrl = trim((string) ($props['wiki_url'] ?? ''));
            if ($wikiUrl === '' && isset($props['wiki_region']) && is_array($props['wiki_region'])) {
                $wikiUrl = trim((string) ($props['wiki_region']['wiki_url'] ?? ''));
            }
            if ($wikiUrl !== '') {
                $key = avesmapsPoliticalBuildWikiKey($wikiUrl, $name);
                if (strncmp($key, 'wiki:', 5) === 0 && !isset($candidates['region'][$key])) {
                    $candidates['region'][$key] = $publicId;
                }
                if (strncmp($key, 'wiki:', 5) === 0) {
                    $addDeparen($candidates, 'region', avesmapsAdventurePageTitleFromUrl($wikiUrl), $key, $publicId);
                }
            }
        } elseif ($type === 'path') { // path -- properties.wiki_path.wiki_key is a BARE slug (no 'wiki:' prefix)
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
        if ($key === '') {
            continue;
        }
        if (!isset($candidates['territory'][$key])) {
            $candidates['territory'][$key] = (string) $row['public_id'];
        }
        // A territory's wiki_key IS the slugged page title, so the parenthetical is already collapsed
        // into it ("wiki:x-y"). Recover the page title from the key's own shape instead: only a
        // trailing segment that names a known disambiguator counts, so "Greifenfurt-Mark" is left alone.
        $candidates['territory_deparen'] = $candidates['territory_deparen'] ?? [];
        if (preg_match('/^(wiki:.+?)-(siedlung|stadt|dorf|burg|region|fluss|hort|historisch)$/u', $key, $matches) === 1) {
            $base = $matches[1];
            $seen = false;
            foreach ($candidates['territory_deparen'][$base] ?? [] as $existing) {
                if ($existing['public_id'] === (string) $row['public_id']) {
                    $seen = true;
                }
            }
            if (!$seen) {
                $candidates['territory_deparen'][$base][] = ['public_id' => (string) $row['public_id'], 'wiki_key' => $key];
            }
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

// Pick-by-public_id wiki-key (P3 autocomplete): a picked suggestion is an EXACT map-search entity, so the
// editor stores target_kind + target_public_id directly (name-resolution can fail for non-wiki-linked or
// name/key-divergent entities like the settlement "Thalhaus"). This returns the entity's derived wiki_key
// (empty when it genuinely has no wiki link -> the editor shows "ohne Wiki-Eintrag", a valid state, not an
// error). Intentionally does NOT walk the territory tree -- keep it a single cheap lookup.
function avesmapsAdventureWikiKeyByPublicId(PDO $pdo, string $kind, string $publicId): string
{
    if ($kind === 'territory') {
        $stmt = $pdo->prepare('SELECT wiki_key FROM political_territory WHERE public_id = :p LIMIT 1');
        $stmt->execute(['p' => $publicId]);
        return trim((string) ($stmt->fetchColumn() ?: ''));
    }
    if ($kind === 'settlement' || $kind === 'region' || $kind === 'path') {
        $stmt = $pdo->prepare('SELECT properties_json FROM map_features WHERE public_id = :p LIMIT 1');
        $stmt->execute(['p' => $publicId]);
        $decoded = json_decode((string) ($stmt->fetchColumn() ?: ''), true);
        $props = is_array($decoded) ? $decoded : [];
        if ($kind === 'settlement') {
            $settlement = is_array($props['wiki_settlement'] ?? null) ? $props['wiki_settlement'] : [];
            $title = trim((string) ($settlement['title'] ?? ''));
            if ($title !== '') {
                return avesmapsAdventureCanonicalKeyForName($title);
            }
            $wikiUrl = trim((string) ($settlement['wiki_url'] ?? ($props['wiki_url'] ?? '')));
            if ($wikiUrl !== '') {
                $built = avesmapsPoliticalBuildWikiKey($wikiUrl, '');
                if (strncmp($built, 'wiki:', 5) === 0) { return $built; }
            }
            return '';
        }
        if ($kind === 'region') {
            $wikiRegion = is_array($props['wiki_region'] ?? null) ? $props['wiki_region'] : [];
            $regionUrl = trim((string) ($wikiRegion['wiki_url'] ?? ''));
            if ($regionUrl !== '') {
                $built = avesmapsPoliticalBuildWikiKey($regionUrl, '');
                if (strncmp($built, 'wiki:', 5) === 0) { return $built; }
            }
            return '';
        }
        // path -- properties.wiki_path.wiki_key is a BARE slug (no 'wiki:' prefix)
        $wikiPath = is_array($props['wiki_path'] ?? null) ? $props['wiki_path'] : [];
        return trim((string) ($wikiPath['wiki_key'] ?? ''));
    }
    return '';
}

// Resolve-all: (1) resolve every place still 'unresolved' (manually CHOSEN targets have target_kind !=
// 'unresolved' and are left untouched = override protection); (2) fill target_territory_path for
// settlement/territory places (from the deepest territory + parent tree) so the client aggregates
// territory/region adventures locally. Processes places that are unresolved OR still missing a path;
// idempotent. Candidate maps + parent tree loaded once (no N+1). Returns counts.
function avesmapsAdventureResolveAll(PDO $pdo): array
{
    avesmapsAdventuresEnsureTables($pdo);
    return avesmapsResolvePlacesInTable($pdo, 'adventure_place');
}

// The resolve-all CORE, parameterised by the place table. Everything above this line was ALREADY
// table-agnostic: it answers "raw place name -> which map entity", and never knew what cites the place.
// Only these two statements named adventure_place. The Kartensammlung (Spec §3.1) declares citymap_place
// as a 1:1 copy of adventure_place precisely so the Ort-Autocomplete keeps working unchanged -- copying
// 60 lines to change one table name is exactly how the two would then drift apart.
//
// $table is interpolated (a table name cannot be a bound parameter), hence the whitelist: every caller
// passes a literal today, and this keeps it that way. The caller ensures its own tables first.
//
// NB: the avesmapsAdventure* prefix on the helpers is historical -- they are place resolvers, not
// adventure code. Renaming them is a separate sweep; it would touch the adventure editor and its tests
// for no behaviour change.
function avesmapsResolvePlacesInTable(PDO $pdo, string $table): array
{
    if (!in_array($table, ['adventure_place', 'citymap_place'], true)) {
        throw new InvalidArgumentException('Unbekannte Ort-Tabelle: ' . $table);
    }
    $places = $pdo->query(
        "SELECT id, raw_name, target_kind, target_public_id, target_wiki_key
           FROM {$table}
          WHERE status = 'approved' AND (target_kind = 'unresolved' OR target_territory_path IS NULL)"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($places === []) {
        return ['resolved' => 0, 'unresolved' => 0, 'total' => 0, 'paths' => 0];
    }

    $candidates = avesmapsAdventureLoadCandidates($pdo);
    $parentMap = avesmapsAdventureLoadTerritoryParentMap($pdo);
    $settlementTerritory = avesmapsAdventureLoadSettlementTerritoryKeys($pdo);
    $update = $pdo->prepare(
        "UPDATE {$table}
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
