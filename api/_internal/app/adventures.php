<?php

declare(strict_types=1);

// Abenteuer-Feature (Phase 1) -- backend entity for DSA adventures + their ordered place list.
// Self-healing inline DDL (project idiom, mirror of api/_internal/app/feature-sources.php). The public
// read wrapper is api/app/adventures.php; name resolution (place -> entity) lives in
// api/_internal/app/adventure-resolve.php. Language policy: code/identifiers EN, domain content DE.
//
// CORE INVARIANT (Spec §3.2): adventure_place.sort_order = position in the wiki "Ort" list; the smallest
// sort_order is the start place (role='start', "beginnt hier"). NEVER reorder/resort that list -- the
// start detection depends on it.

// Idempotent DDL. Runs on every read (cheap: CREATE TABLE IF NOT EXISTS + INFORMATION_SCHEMA column
// probes), so a fresh deploy self-heals on the first endpoint hit -- no migration step.
function avesmapsAdventuresEnsureTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS adventure (
            id INT AUTO_INCREMENT PRIMARY KEY,
            public_id CHAR(36) NOT NULL,
            wiki_key VARCHAR(190) NULL,
            wiki_url VARCHAR(500) NULL,
            title VARCHAR(300) NOT NULL,
            product_type VARCHAR(32) NOT NULL,
            edition VARCHAR(16) NULL,
            bf_year INT NULL,
            bf_label VARCHAR(120) NULL,
            genre VARCHAR(160) NULL,
            complexity_gm VARCHAR(60) NULL,
            complexity_pl VARCHAR(60) NULL,
            is_official TINYINT(1) NOT NULL DEFAULT 1,
            authors VARCHAR(500) NULL,
            series VARCHAR(200) NULL,
            fshop_code VARCHAR(40) NULL,
            cover_url VARCHAR(500) NULL,
            field_origins_json JSON NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            origin VARCHAR(16) NOT NULL DEFAULT 'manual',
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            synced_at DATETIME(3) NULL,
            UNIQUE KEY uq_adventure_public_id (public_id),
            UNIQUE KEY uq_adventure_wiki_key (wiki_key),
            KEY idx_adventure_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    // NB: UNIQUE(wiki_key) enforces uniqueness only among non-NULL values (MySQL allows many NULLs) ->
    // "UNIQUE(wiki_key) sobald gesetzt" (manual adventures without a wiki page stay wiki_key = NULL).
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS adventure_place (
            id INT AUTO_INCREMENT PRIMARY KEY,
            adventure_id INT NOT NULL,
            sort_order INT NOT NULL,
            raw_name VARCHAR(300) NOT NULL,
            target_kind VARCHAR(16) NOT NULL DEFAULT 'unresolved',
            target_public_id VARCHAR(64) NULL,
            target_wiki_key VARCHAR(190) NULL,
            role VARCHAR(8) NOT NULL DEFAULT 'play',
            origin VARCHAR(16) NOT NULL DEFAULT 'manual',
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            KEY idx_adventure_place_adventure (adventure_id, sort_order),
            KEY idx_adventure_place_target_public (target_public_id),
            KEY idx_adventure_place_target_wiki (target_wiki_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

function avesmapsAdventuresCount(PDO $pdo): int
{
    avesmapsAdventuresEnsureTables($pdo);
    return (int) $pdo->query('SELECT COUNT(*) FROM adventure')->fetchColumn();
}

// The public catalog read (B1 client aggregation): the whole approved catalog in ONE payload so the
// client can index + aggregate locally. Places travel WITH each adventure, in sort_order (start first);
// spoiler separation (start vs play) is done in the client, the catalog ships both.
function avesmapsAdventuresReadCatalog(PDO $pdo): array
{
    avesmapsAdventuresEnsureTables($pdo);
    $rows = $pdo->query(
        "SELECT id, public_id, title, wiki_url, product_type, edition, bf_year, bf_label,
                genre, complexity_gm, complexity_pl, is_official, fshop_code, cover_url, series
           FROM adventure
          WHERE status = 'approved'
          ORDER BY (bf_year IS NULL), bf_year DESC, title ASC"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    // All places for all adventures in one query (INDEX adventure_id, sort_order), grouped in PHP.
    $ids = array_map(static fn(array $r): int => (int) $r['id'], $rows);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $placeStatement = $pdo->prepare(
        "SELECT adventure_id, role, target_kind, target_public_id, target_wiki_key, raw_name, sort_order
           FROM adventure_place
          WHERE status = 'approved' AND adventure_id IN ($placeholders)
          ORDER BY adventure_id ASC, sort_order ASC"
    );
    $placeStatement->execute($ids);
    $placesByAdventure = [];
    foreach ($placeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $place) {
        $placesByAdventure[(int) $place['adventure_id']][] = [
            'role' => (string) $place['role'],
            'target_kind' => (string) $place['target_kind'],
            'target_public_id' => $place['target_public_id'] !== null ? (string) $place['target_public_id'] : '',
            'target_wiki_key' => $place['target_wiki_key'] !== null ? (string) $place['target_wiki_key'] : '',
            'raw_name' => (string) $place['raw_name'],
            'sort_order' => (int) $place['sort_order'],
        ];
    }

    $adventures = [];
    foreach ($rows as $row) {
        $adventures[] = [
            'public_id' => (string) $row['public_id'],
            'title' => (string) $row['title'],
            'wiki_url' => (string) ($row['wiki_url'] ?? ''),
            'product_type' => (string) $row['product_type'],
            'edition' => (string) ($row['edition'] ?? ''),
            'bf_year' => $row['bf_year'] !== null ? (int) $row['bf_year'] : null,
            'bf_label' => (string) ($row['bf_label'] ?? ''),
            'genre' => (string) ($row['genre'] ?? ''),
            'complexity_gm' => (string) ($row['complexity_gm'] ?? ''),
            'complexity_pl' => (string) ($row['complexity_pl'] ?? ''),
            'is_official' => (int) $row['is_official'] === 1,
            'fshop_code' => (string) ($row['fshop_code'] ?? ''),
            'cover_url' => (string) ($row['cover_url'] ?? ''),
            'series' => (string) ($row['series'] ?? ''),
            'places' => $placesByAdventure[(int) $row['id']] ?? [],
        ];
    }
    return $adventures;
}

// ---- Sample/bootstrap data (Task 1.2) -------------------------------------------------------------
// Six real DSA adventures with ordered "Ort" lists, defined ONCE here (the CLI tool and the endpoint
// seed action both call avesmapsAdventuresSeedSamples). These are BOOTSTRAP samples so Phase 1 has
// something to render; the Phase 4 wiki sync reconciles the real catalog override-safely by wiki_key.
// Order is verbatim -- the FIRST place of each list is the start ("beginnt hier"). Place lists mix
// precise (settlement/path) and area (territory/region) targets to exercise the whole pipeline:
//   - Nedime (Fasar->Khunchom): two settlements   -> precise questroute (route planner)
//   - Siegelbruch (Mittelreich, ...): starts on a territory -> area questroute (dashed line)
//   - Das Jahr des Greifen: contains "Bornstraße" -> path resolution
//   - Die Verschwörung von Gareth: single place   -> no questroute button (< 2 places)
// public_id values are fixed so re-seeding is idempotent (UNIQUE(public_id)).
function avesmapsAdventuresSampleSeedData(): array
{
    return [
        [
            'public_id' => 'a0e17e10-0000-4000-8000-000000000001',
            'title' => 'Siegelbruch',
            'product_type' => 'gruppenabenteuer',
            'edition' => 'DSA5',
            'bf_year' => 1044,
            'bf_label' => 'Travia 1044 BF',
            'genre' => 'Intrige',
            'complexity_gm' => 'mittel',
            'complexity_pl' => 'mittel',
            'is_official' => 1,
            'authors' => '',
            'series' => '',
            'fshop_code' => '',
            'cover_url' => 'https://de.wiki-aventurica.de/de/images/thumb/5/55/AB_VA62.jpg/240px-AB_VA62.jpg',
            'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Siegelbruch',
            'places' => ['Mittelreich', 'Königreich Garetien', 'Gareth', 'Wagenhalt'],
        ],
        [
            'public_id' => 'a0e17e10-0000-4000-8000-000000000002',
            'title' => 'Nedime – Die Tochter des Kalifen',
            'product_type' => 'soloabenteuer',
            'edition' => 'DSA3',
            'bf_year' => 1015,
            'bf_label' => '1015 BF',
            'genre' => 'Reise',
            'complexity_gm' => 'niedrig',
            'complexity_pl' => 'niedrig',
            'is_official' => 1,
            'authors' => '',
            'series' => '',
            'fshop_code' => '',
            'cover_url' => '',
            'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Nedime_%E2%80%93_Die_Tochter_des_Kalifen',
            'places' => ['Fasar', 'Khunchom'],
        ],
        [
            'public_id' => 'a0e17e10-0000-4000-8000-000000000003',
            'title' => 'Die Verschwörung von Gareth',
            'product_type' => 'gruppenabenteuer',
            'edition' => 'DSA4',
            'bf_year' => 1021,
            'bf_label' => '1021 BF',
            'genre' => 'Intrige',
            'complexity_gm' => 'hoch',
            'complexity_pl' => 'mittel',
            'is_official' => 1,
            'authors' => '',
            'series' => '',
            'fshop_code' => '',
            'cover_url' => '',
            'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Die_Verschwörung_von_Gareth',
            'places' => ['Gareth'],
        ],
        [
            'public_id' => 'a0e17e10-0000-4000-8000-000000000004',
            'title' => 'Havena – Versunkene Geheimnisse',
            'product_type' => 'gruppenabenteuer',
            'edition' => 'DSA4.1',
            'bf_year' => 1027,
            'bf_label' => '1027 BF',
            'genre' => 'Stadt',
            'complexity_gm' => 'mittel',
            'complexity_pl' => 'mittel',
            'is_official' => 1,
            'authors' => '',
            'series' => '',
            'fshop_code' => '',
            'cover_url' => '',
            'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Havena_%E2%80%93_Versunkene_Geheimnisse',
            'places' => ['Havena', 'Grangor'],
        ],
        [
            'public_id' => 'a0e17e10-0000-4000-8000-000000000005',
            'title' => 'Das Jahr des Greifen',
            'product_type' => 'kampagne',
            'edition' => 'DSA3',
            'bf_year' => 1018,
            'bf_label' => '1018 BF',
            'genre' => 'Krieg',
            'complexity_gm' => 'hoch',
            'complexity_pl' => 'hoch',
            'is_official' => 1,
            'authors' => '',
            'series' => 'Das Jahr des Greifen',
            'fshop_code' => '',
            'cover_url' => '',
            'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Das_Jahr_des_Greifen',
            'places' => ['Festum', 'Bornstraße', 'Riva'],
        ],
        [
            'public_id' => 'a0e17e10-0000-4000-8000-000000000006',
            'title' => 'Im Wirtshaus zum Schwarzen Keiler',
            'product_type' => 'soloabenteuer',
            'edition' => 'DSA1',
            'bf_year' => 1000,
            'bf_label' => 'um 1000 BF',
            'genre' => 'Dungeon',
            'complexity_gm' => 'niedrig',
            'complexity_pl' => 'niedrig',
            'is_official' => 1,
            'authors' => '',
            'series' => '',
            'fshop_code' => '',
            'cover_url' => '',
            'wiki_url' => 'https://de.wiki-aventurica.de/wiki/Im_Wirtshaus_zum_Schwarzen_Keiler',
            'places' => ['Thorwal', 'Prem'],
        ],
    ];
}

// Idempotent seed: insert each sample adventure (skip if its public_id already exists) and, for a
// freshly created adventure, its ordered places (sort_order = list index, role = start for index 0).
// Places are seeded target_kind='unresolved'; the resolver (adventure-resolve.php) fills target_* on a
// later resolve pass. Returns the number of adventures actually inserted.
function avesmapsAdventuresSeedSamples(PDO $pdo): int
{
    avesmapsAdventuresEnsureTables($pdo);

    $insertAdventure = $pdo->prepare(
        "INSERT INTO adventure
            (public_id, wiki_key, wiki_url, title, product_type, edition, bf_year, bf_label, genre,
             complexity_gm, complexity_pl, is_official, authors, series, fshop_code, cover_url, origin, status)
         VALUES
            (:public_id, NULL, :wiki_url, :title, :product_type, :edition, :bf_year, :bf_label, :genre,
             :complexity_gm, :complexity_pl, :is_official, :authors, :series, :fshop_code, :cover_url, 'manual', 'approved')"
    );
    $selectId = $pdo->prepare('SELECT id FROM adventure WHERE public_id = :public_id LIMIT 1');
    $countPlaces = $pdo->prepare('SELECT COUNT(*) FROM adventure_place WHERE adventure_id = :aid');
    $insertPlace = $pdo->prepare(
        "INSERT INTO adventure_place
            (adventure_id, sort_order, raw_name, target_kind, role, origin, status)
         VALUES (:aid, :sort_order, :raw_name, 'unresolved', :role, 'manual', 'approved')"
    );

    $inserted = 0;
    foreach (avesmapsAdventuresSampleSeedData() as $adventure) {
        $selectId->execute(['public_id' => $adventure['public_id']]);
        $existingId = $selectId->fetchColumn();
        if ($existingId === false) {
            $insertAdventure->execute([
                'public_id' => $adventure['public_id'],
                'wiki_url' => $adventure['wiki_url'],
                'title' => $adventure['title'],
                'product_type' => $adventure['product_type'],
                'edition' => $adventure['edition'],
                'bf_year' => $adventure['bf_year'],
                'bf_label' => $adventure['bf_label'],
                'genre' => $adventure['genre'],
                'complexity_gm' => $adventure['complexity_gm'],
                'complexity_pl' => $adventure['complexity_pl'],
                'is_official' => (int) $adventure['is_official'],
                'authors' => $adventure['authors'],
                'series' => $adventure['series'],
                'fshop_code' => $adventure['fshop_code'],
                'cover_url' => $adventure['cover_url'],
            ]);
            $inserted++;
        }

        $selectId->execute(['public_id' => $adventure['public_id']]);
        $adventureId = (int) $selectId->fetchColumn();
        if ($adventureId <= 0) {
            continue;
        }

        // Only seed places when the adventure has none yet (keeps re-seed idempotent, never duplicates).
        $countPlaces->execute(['aid' => $adventureId]);
        if ((int) $countPlaces->fetchColumn() > 0) {
            continue;
        }
        $sortOrder = 0;
        foreach ($adventure['places'] as $rawName) {
            $insertPlace->execute([
                'aid' => $adventureId,
                'sort_order' => $sortOrder,
                'raw_name' => (string) $rawName,
                'role' => $sortOrder === 0 ? 'start' : 'play',
            ]);
            $sortOrder++;
        }
    }
    return $inserted;
}
