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

    // Self-healing column-add (project idiom). Phase 2: per-place territory ancestor path (JSON array of
    // 'wiki:'-keys, deepest->root) so the CLIENT aggregates territory/region adventures locally WITHOUT
    // loading the political parent tree (which is edit-mode-only in the frontend). Filled by the resolver
    // (adventure-resolve.php) from properties.territory_wiki_key + the wiki_territory_model parent tree.
    $columnExists = static function (PDO $pdo, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'adventure_place' AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    if (!$columnExists($pdo, 'target_territory_path')) {
        $pdo->exec('ALTER TABLE adventure_place ADD COLUMN target_territory_path JSON NULL');
    }
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
        "SELECT adventure_id, role, target_kind, target_public_id, target_wiki_key, target_territory_path, raw_name, sort_order
           FROM adventure_place
          WHERE status = 'approved' AND adventure_id IN ($placeholders)
          ORDER BY adventure_id ASC, sort_order ASC"
    );
    $placeStatement->execute($ids);
    $placesByAdventure = [];
    foreach ($placeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $place) {
        $territoryPath = [];
        if (isset($place['target_territory_path']) && $place['target_territory_path'] !== null) {
            $decodedPath = json_decode((string) $place['target_territory_path'], true);
            if (is_array($decodedPath)) {
                $territoryPath = array_values(array_map(static fn($value): string => (string) $value, $decodedPath));
            }
        }
        $placesByAdventure[(int) $place['adventure_id']][] = [
            'role' => (string) $place['role'],
            'target_kind' => (string) $place['target_kind'],
            'target_public_id' => $place['target_public_id'] !== null ? (string) $place['target_public_id'] : '',
            'target_wiki_key' => $place['target_wiki_key'] !== null ? (string) $place['target_wiki_key'] : '',
            'territory_path' => $territoryPath,
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

// Phase 2.3 -- compact { wiki_key => {name, rank} } lookup for the territory keys that appear in any
// place's territory_path, so the nested "Alle anzeigen" dialog can label each subtree node with its
// name + rank (political_territory.type) WITHOUT the client loading the political layer. Only the keys
// actually referenced are shipped (lean payload); keyed by the RAW 'wiki:'-key exactly as stored in
// territory_path, so the client looks meta up by the same key it walks. First active row per key wins
// (timeline variants share a wiki_key; Phase-2 aggregation does not depend on the exact variant).
function avesmapsAdventuresTerritoryMeta(PDO $pdo, array $adventures): array
{
    $keys = [];
    foreach ($adventures as $adventure) {
        foreach ($adventure['places'] ?? [] as $place) {
            foreach ($place['territory_path'] ?? [] as $pathKey) {
                $pathKey = (string) $pathKey;
                if ($pathKey !== '') {
                    $keys[$pathKey] = true;
                }
            }
        }
    }
    if ($keys === []) {
        return [];
    }
    $keyList = array_keys($keys);
    $placeholders = implode(',', array_fill(0, count($keyList), '?'));
    $statement = $pdo->prepare(
        "SELECT wiki_key, name, type FROM political_territory
          WHERE is_active = 1 AND wiki_key IN ($placeholders)
          ORDER BY id ASC"
    );
    $statement->execute($keyList);
    $meta = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $key = (string) ($row['wiki_key'] ?? '');
        if ($key === '' || isset($meta[$key])) {
            continue; // first active row per wiki_key wins
        }
        $meta[$key] = [
            'name' => (string) ($row['name'] ?? ''),
            'rank' => (string) ($row['type'] ?? ''),
        ];
    }
    return $meta;
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

// ---- Phase 3 (P1): capability-gated editor write library ------------------------------------------
// These functions back api/edit/map/adventures.php (the editor dispatcher). They rely on globals loaded
// by that dispatcher -- avesmapsUuidV4() (api/_internal/map/features.php), avesmapsErrorResponse()
// (bootstrap.php via auth.php) and, for resolve_place, avesmapsAdventureResolveAll()
// (adventure-resolve.php) -- exactly like the feature-sources write library relies on the map-features
// globals loaded by its own dispatcher. They are NEVER reached on the public read path
// (api/app/adventures.php), so that path stays free of those includes.

// Encode a per-field origin map ({field:'manual', ...}) as a JSON object (never a JSON array, so an
// empty map still serialises as "{}").
function avesmapsAdventuresEncodeOrigins(array $origins): string
{
    return (string) json_encode((object) $origins, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

// Editor left-hand list: EVERY adventure (approved AND non-approved), with an approved-place count.
// Same ordering as the public catalog (newest BF year first, undated last, then title).
function avesmapsListAdventuresForEdit(PDO $pdo): array
{
    avesmapsAdventuresEnsureTables($pdo);
    $rows = $pdo->query(
        "SELECT a.public_id, a.title, a.product_type, a.bf_label, a.bf_year, a.wiki_key, a.origin, a.status,
                (SELECT COUNT(*) FROM adventure_place p WHERE p.adventure_id = a.id AND p.status = 'approved')
                    AS place_count
           FROM adventure a
          ORDER BY (a.bf_year IS NULL), a.bf_year DESC, a.title ASC"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $adventures = [];
    foreach ($rows as $row) {
        $adventures[] = [
            'public_id' => (string) $row['public_id'],
            'title' => (string) $row['title'],
            'product_type' => (string) $row['product_type'],
            'bf_label' => (string) ($row['bf_label'] ?? ''),
            'bf_year' => $row['bf_year'] !== null ? (int) $row['bf_year'] : null,
            'wiki_key' => $row['wiki_key'] !== null ? (string) $row['wiki_key'] : '',
            'origin' => (string) $row['origin'],
            'status' => (string) $row['status'],
            'place_count' => (int) $row['place_count'],
        ];
    }
    return ['adventures' => $adventures];
}

// Editor detail view: one adventure with all business columns + its whole place list (approved AND
// suppressed, sort_order ASC). Returns null when the public_id does not exist. The surrogate integer id
// is intentionally not exposed (the editor addresses adventures by public_id, places by their own id).
function avesmapsAdventureDetailForEdit(PDO $pdo, string $publicId): ?array
{
    avesmapsAdventuresEnsureTables($pdo);
    $stmt = $pdo->prepare(
        "SELECT id, public_id, wiki_key, wiki_url, title, product_type, edition, bf_year, bf_label, genre,
                complexity_gm, complexity_pl, is_official, authors, series, fshop_code, cover_url,
                field_origins_json, status, origin, created_at, updated_at, synced_at
           FROM adventure WHERE public_id = :pid LIMIT 1"
    );
    $stmt->execute(['pid' => $publicId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        return null;
    }

    $fieldOrigins = [];
    if (!empty($row['field_origins_json'])) {
        $decoded = json_decode((string) $row['field_origins_json'], true);
        if (is_array($decoded)) {
            $fieldOrigins = $decoded;
        }
    }

    $placeStmt = $pdo->prepare(
        "SELECT id, sort_order, raw_name, target_kind, target_public_id, target_wiki_key, role, origin, status
           FROM adventure_place
          WHERE adventure_id = :aid AND status IN ('approved', 'suppressed')
          ORDER BY sort_order ASC"
    );
    $placeStmt->execute(['aid' => (int) $row['id']]);
    $places = [];
    foreach ($placeStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $place) {
        $places[] = [
            'id' => (int) $place['id'],
            'sort_order' => (int) $place['sort_order'],
            'raw_name' => (string) $place['raw_name'],
            'target_kind' => (string) $place['target_kind'],
            'target_public_id' => $place['target_public_id'] !== null ? (string) $place['target_public_id'] : '',
            'target_wiki_key' => $place['target_wiki_key'] !== null ? (string) $place['target_wiki_key'] : '',
            'role' => (string) $place['role'],
            'origin' => (string) $place['origin'],
            'status' => (string) $place['status'],
        ];
    }

    return [
        'public_id' => (string) $row['public_id'],
        'wiki_key' => $row['wiki_key'] !== null ? (string) $row['wiki_key'] : '',
        'wiki_url' => (string) ($row['wiki_url'] ?? ''),
        'title' => (string) $row['title'],
        'product_type' => (string) $row['product_type'],
        'edition' => (string) ($row['edition'] ?? ''),
        'bf_year' => $row['bf_year'] !== null ? (int) $row['bf_year'] : null,
        'bf_label' => (string) ($row['bf_label'] ?? ''),
        'genre' => (string) ($row['genre'] ?? ''),
        'complexity_gm' => (string) ($row['complexity_gm'] ?? ''),
        'complexity_pl' => (string) ($row['complexity_pl'] ?? ''),
        'is_official' => (int) $row['is_official'] === 1,
        'authors' => (string) ($row['authors'] ?? ''),
        'series' => (string) ($row['series'] ?? ''),
        'fshop_code' => (string) ($row['fshop_code'] ?? ''),
        'cover_url' => (string) ($row['cover_url'] ?? ''),
        'field_origins' => (object) $fieldOrigins,
        'status' => (string) $row['status'],
        'origin' => (string) $row['origin'],
        'created_at' => (string) ($row['created_at'] ?? ''),
        'updated_at' => (string) ($row['updated_at'] ?? ''),
        'synced_at' => $row['synced_at'] !== null ? (string) $row['synced_at'] : '',
        'places' => $places,
    ];
}

// Create (no/empty public_id -> fresh UUID) or partial-update (public_id given) an adventure. Always
// stamps origin='manual', status='approved'. field_origins_json records 'manual' ONLY for the fields the
// caller actually sent; on update that map is merged into the stored one so an override-safe wiki sync
// (Phase 4) can leave manually-touched fields alone. title is mandatory. Returns ['public_id','created'].
function avesmapsUpsertAdventure(PDO $pdo, array $data): array
{
    avesmapsAdventuresEnsureTables($pdo);

    $title = trim((string) ($data['title'] ?? ''));
    if ($title === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Ein Titel ist erforderlich.');
    }

    // Editable business columns; public_id/origin/status/field_origins_json are managed, never taken raw.
    $editableFields = [
        'title', 'product_type', 'edition', 'bf_year', 'bf_label', 'genre',
        'complexity_gm', 'complexity_pl', 'is_official', 'authors', 'series',
        'fshop_code', 'cover_url', 'wiki_url', 'wiki_key',
    ];
    $normalize = static function (string $field, mixed $raw): int|string|null {
        if ($field === 'bf_year') {
            return ($raw === null || $raw === '') ? null : (int) $raw;
        }
        if ($field === 'is_official') {
            return ((bool) $raw) ? 1 : 0;
        }
        if ($field === 'title' || $field === 'product_type') {
            return trim((string) $raw); // NOT NULL columns -> always a string
        }
        // nullable text (incl. the UNIQUE wiki_key, where '' would collide across rows): empty -> NULL
        $value = trim((string) $raw);
        return $value === '' ? null : $value;
    };

    // Collect values + per-field origin ONLY for the keys the caller actually sent.
    $values = [];
    $origins = [];
    foreach ($editableFields as $field) {
        if (array_key_exists($field, $data)) {
            $values[$field] = $normalize($field, $data[$field]);
            $origins[$field] = 'manual';
        }
    }
    $values['title'] = $title; // required -> always written and always 'manual'
    $origins['title'] = 'manual';

    $publicId = trim((string) ($data['public_id'] ?? ''));

    if ($publicId === '') {
        // ---- INSERT (create) --------------------------------------------------------------------
        $publicId = avesmapsUuidV4();
        $insertParams = [
            'public_id' => $publicId,
            'field_origins_json' => avesmapsAdventuresEncodeOrigins($origins),
        ];
        foreach ($editableFields as $field) {
            $default = $field === 'product_type' ? '' : ($field === 'is_official' ? 1 : null);
            $insertParams[$field] = array_key_exists($field, $values) ? $values[$field] : $default;
        }
        $pdo->prepare(
            "INSERT INTO adventure
                (public_id, title, product_type, edition, bf_year, bf_label, genre, complexity_gm,
                 complexity_pl, is_official, authors, series, fshop_code, cover_url, wiki_url, wiki_key,
                 field_origins_json, origin, status)
             VALUES
                (:public_id, :title, :product_type, :edition, :bf_year, :bf_label, :genre, :complexity_gm,
                 :complexity_pl, :is_official, :authors, :series, :fshop_code, :cover_url, :wiki_url, :wiki_key,
                 :field_origins_json, 'manual', 'approved')"
        )->execute($insertParams);
        return ['public_id' => $publicId, 'created' => true];
    }

    // ---- UPDATE (partial; only the sent fields) --------------------------------------------------
    $existing = $pdo->prepare('SELECT id, field_origins_json FROM adventure WHERE public_id = :pid LIMIT 1');
    $existing->execute(['pid' => $publicId]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);
    if ($row === false) {
        avesmapsErrorResponse(404, 'not_found', 'Das Abenteuer wurde nicht gefunden.');
    }

    $mergedOrigins = [];
    if (!empty($row['field_origins_json'])) {
        $decoded = json_decode((string) $row['field_origins_json'], true);
        if (is_array($decoded)) {
            $mergedOrigins = $decoded;
        }
    }
    foreach ($origins as $field => $origin) {
        $mergedOrigins[$field] = $origin; // this edit's fields -> 'manual'; untouched fields keep prior origin
    }

    $setClauses = [];
    $updateParams = ['id' => (int) $row['id']];
    foreach ($editableFields as $field) {
        if (!array_key_exists($field, $values)) {
            continue; // only touch fields the caller sent (title is always present)
        }
        $setClauses[] = $field . ' = :' . $field;
        $updateParams[$field] = $values[$field];
    }
    $setClauses[] = "origin = 'manual'";
    $setClauses[] = "status = 'approved'";
    $setClauses[] = 'field_origins_json = :field_origins_json';
    $updateParams['field_origins_json'] = avesmapsAdventuresEncodeOrigins($mergedOrigins);

    $pdo->prepare('UPDATE adventure SET ' . implode(', ', $setClauses) . ' WHERE id = :id')->execute($updateParams);
    return ['public_id' => $publicId, 'created' => false];
}

// Append one place to an adventure (looked up by public_id -> 404 if unknown). raw_name is mandatory.
// sort_order defaults to MAX(existing)+1 (0 for the first place) so the CORE INVARIANT holds -- the
// editor sets sort_order/role explicitly, this NEVER reorders the list. Returns ['place_id'].
function avesmapsAddAdventurePlace(PDO $pdo, string $adventurePublicId, array $data): array
{
    avesmapsAdventuresEnsureTables($pdo);

    $find = $pdo->prepare('SELECT id FROM adventure WHERE public_id = :pid LIMIT 1');
    $find->execute(['pid' => $adventurePublicId]);
    $adventureId = $find->fetchColumn();
    if ($adventureId === false) {
        avesmapsErrorResponse(404, 'not_found', 'Das Abenteuer wurde nicht gefunden.');
    }
    $adventureId = (int) $adventureId;

    $rawName = trim((string) ($data['raw_name'] ?? ''));
    if ($rawName === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Ein Ortsname (raw_name) ist erforderlich.');
    }

    $targetKind = trim((string) ($data['target_kind'] ?? 'unresolved'));
    if ($targetKind === '') {
        $targetKind = 'unresolved';
    }
    $targetPublicId = trim((string) ($data['target_public_id'] ?? ''));
    $targetWikiKey = trim((string) ($data['target_wiki_key'] ?? ''));
    $role = trim((string) ($data['role'] ?? 'play'));
    if ($role !== 'start' && $role !== 'play') {
        $role = 'play';
    }

    if (array_key_exists('sort_order', $data) && $data['sort_order'] !== null && $data['sort_order'] !== '') {
        $sortOrder = (int) $data['sort_order'];
    } else {
        $maxStmt = $pdo->prepare('SELECT MAX(sort_order) FROM adventure_place WHERE adventure_id = :aid');
        $maxStmt->execute(['aid' => $adventureId]);
        $max = $maxStmt->fetchColumn();
        $sortOrder = ($max === null || $max === false) ? 0 : ((int) $max) + 1;
    }

    $pdo->prepare(
        "INSERT INTO adventure_place
            (adventure_id, sort_order, raw_name, target_kind, target_public_id, target_wiki_key, role, origin, status)
         VALUES (:aid, :sort_order, :raw_name, :target_kind, :target_public_id, :target_wiki_key, :role, 'manual', 'approved')"
    )->execute([
        'aid' => $adventureId,
        'sort_order' => $sortOrder,
        'raw_name' => $rawName,
        'target_kind' => $targetKind,
        'target_public_id' => $targetPublicId === '' ? null : $targetPublicId,
        'target_wiki_key' => $targetWikiKey === '' ? null : $targetWikiKey,
        'role' => $role,
    ]);
    $placeId = (int) $pdo->lastInsertId();

    // P3 pick-by-public_id: when the editor picked an EXACT entity (target_public_id + a real kind) but
    // sent no wiki_key, backfill the derived target_wiki_key + territory_path FROM the public_id, so the
    // link is complete even for non-wiki-linked entities (no fragile name-resolution needed).
    if ($targetPublicId !== '' && $targetWikiKey === ''
        && in_array($targetKind, ['settlement', 'territory', 'region', 'path'], true)) {
        $complete = avesmapsAdventureCompleteTargetByPublicId($pdo, $targetKind, $targetPublicId);
        $pdo->prepare('UPDATE adventure_place SET target_wiki_key = :wk, target_territory_path = :tp WHERE id = :id')
            ->execute([
                'wk' => $complete['wiki_key'] !== '' ? $complete['wiki_key'] : null,
                'tp' => json_encode(array_values($complete['territory_path']), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'id' => $placeId,
            ]);
    }
    return ['place_id' => $placeId];
}

// Partial-update a place (by id -> 404 if unknown). Only the sent fields are written; origin is always
// stamped 'manual' so avesmapsAdventureResolveAll leaves the (now manually chosen) target alone. Does NOT
// re-derive sort_order/role -- the editor owns both (CORE INVARIANT). Returns ['place_id'].
function avesmapsSetAdventurePlace(PDO $pdo, int $placeId, array $data): array
{
    avesmapsAdventuresEnsureTables($pdo);

    $find = $pdo->prepare('SELECT id FROM adventure_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    if ($find->fetchColumn() === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    $setClauses = ["origin = 'manual'"];
    $params = ['id' => $placeId];

    if (array_key_exists('raw_name', $data)) {
        $rawName = trim((string) $data['raw_name']);
        if ($rawName === '') {
            avesmapsErrorResponse(400, 'invalid_request', 'raw_name darf nicht leer sein.');
        }
        $setClauses[] = 'raw_name = :raw_name';
        $params['raw_name'] = $rawName;
    }
    if (array_key_exists('target_kind', $data)) {
        $kind = trim((string) $data['target_kind']);
        $setClauses[] = 'target_kind = :target_kind';
        $params['target_kind'] = $kind === '' ? 'unresolved' : $kind;
    }
    if (array_key_exists('target_public_id', $data)) {
        $value = trim((string) $data['target_public_id']);
        $setClauses[] = 'target_public_id = :target_public_id';
        $params['target_public_id'] = $value === '' ? null : $value;
    }
    if (array_key_exists('target_wiki_key', $data)) {
        $value = trim((string) $data['target_wiki_key']);
        $setClauses[] = 'target_wiki_key = :target_wiki_key';
        $params['target_wiki_key'] = $value === '' ? null : $value;
    }
    if (array_key_exists('role', $data)) {
        $role = trim((string) $data['role']);
        if ($role !== 'start' && $role !== 'play') {
            $role = 'play';
        }
        $setClauses[] = 'role = :role';
        $params['role'] = $role;
    }
    if (array_key_exists('sort_order', $data)) {
        $setClauses[] = 'sort_order = :sort_order';
        $params['sort_order'] = (int) $data['sort_order'];
    }

    $pdo->prepare('UPDATE adventure_place SET ' . implode(', ', $setClauses) . ' WHERE id = :id')->execute($params);
    return ['place_id' => $placeId];
}

// Remove a place (by id -> 404 if unknown). A wiki-origin place is tombstoned (status='suppressed') so a
// later wiki sync does not resurrect it; a manual/community place has nothing to protect and is deleted.
// Returns ['place_id','suppressed'] (suppressed=true tombstoned, false hard-deleted).
function avesmapsSuppressAdventurePlace(PDO $pdo, int $placeId): array
{
    avesmapsAdventuresEnsureTables($pdo);

    $find = $pdo->prepare('SELECT origin FROM adventure_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    $origin = $find->fetchColumn();
    if ($origin === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    if ((string) $origin === 'wiki') {
        $pdo->prepare("UPDATE adventure_place SET status = 'suppressed' WHERE id = :id")->execute(['id' => $placeId]);
        return ['place_id' => $placeId, 'suppressed' => true];
    }

    $pdo->prepare('DELETE FROM adventure_place WHERE id = :id')->execute(['id' => $placeId]);
    return ['place_id' => $placeId, 'suppressed' => false];
}

// Re-resolve a place (by id -> 404 if unknown): reset it to 'unresolved', then run the shared resolver
// (avesmapsAdventureResolveAll, loaded by the dispatcher) which only touches unresolved places. Returns
// the freshly resolved ['target_kind','target_public_id','target_wiki_key'].
function avesmapsResolveAdventurePlace(PDO $pdo, int $placeId): array
{
    avesmapsAdventuresEnsureTables($pdo);

    $find = $pdo->prepare('SELECT id FROM adventure_place WHERE id = :id LIMIT 1');
    $find->execute(['id' => $placeId]);
    if ($find->fetchColumn() === false) {
        avesmapsErrorResponse(404, 'not_found', 'Der Ort wurde nicht gefunden.');
    }

    $pdo->prepare(
        "UPDATE adventure_place
            SET target_kind = 'unresolved', target_public_id = NULL, target_wiki_key = NULL
          WHERE id = :id"
    )->execute(['id' => $placeId]);

    avesmapsAdventureResolveAll($pdo);

    $select = $pdo->prepare(
        'SELECT target_kind, target_public_id, target_wiki_key FROM adventure_place WHERE id = :id LIMIT 1'
    );
    $select->execute(['id' => $placeId]);
    $row = $select->fetch(PDO::FETCH_ASSOC) ?: [];
    return [
        'target_kind' => (string) ($row['target_kind'] ?? 'unresolved'),
        'target_public_id' => ($row['target_public_id'] ?? null) !== null ? (string) $row['target_public_id'] : '',
        'target_wiki_key' => ($row['target_wiki_key'] ?? null) !== null ? (string) $row['target_wiki_key'] : '',
    ];
}
