<?php

declare(strict_types=1);

// Wiki adventure sync (Phase 4): staging schema + dump-build steps + an OVERRIDE-SAFE reconcile of
// the dump's adventure catalog into the live adventure / adventure_place tables. Mirrors
// api/_internal/wiki/publication-sync.php: the SAME two-step model -- build STAGING during
// "Dump holen" (the adventures phase, dryRun), then an owner-triggered `sync_adventures` action
// that reconciles staging into production. Adventures ARE {{Infobox Produkt}} pages (the SAME
// infobox publications use), classified by Art via avesmapsWikiProductIsAdventure().
//
// Side-effect-free on include (function definitions only -- NO top-level code, NO require of a
// side-effectful file), so the pure-diff unit test (__tests__/adventure-sync-test.php) can `require`
// it with no MySQL. Every DB/dump/parser function takes its dependencies as arguments and calls the
// other libraries at RUNTIME (the dump endpoint loads that chain before dispatch).
//
// OVERRIDE-SAFETY (mirrors the publication reconcile, adapted to a single-row entity + its ordered
// place list):
//   - Adventure FIELDS: a field is written from the wiki only when field_origins_json[field] is not
//     'manual' AND the value actually changes (a manual edit wins; a repeat sync is a no-op).
//   - PLACES: only origin='wiki' AND status='approved' places are added/updated/removed; a
//     manual/community place is never touched, and a suppressed wiki place (editor tombstone) is
//     never resurrected even if the wiki still lists it. Identity of a live wiki place is its
//     sort_order (position in the STRICT ordered "Ort" list; the first is role='start').
// See docs/abenteuer-editor-p4-sync-plan.md.

require_once __DIR__ . '/publication-parsing.php'; // avesmapsWikiParseProductInfobox + adventure helpers

// ===========================================================================
// 1. PURE diff core (Step 1, TDD) -- the override-safety heart. DB-free.
// ===========================================================================

// The adventure business columns the wiki sync may fill (override-safe per field_origins_json).
// bf_year/bf_label are NOT here: the {{Infobox Produkt}} infobox carries no in-world BF year.
const AVESMAPS_ADVENTURE_WIKI_FIELDS = [
    'title', 'product_type', 'edition', 'genre', 'complexity_gm', 'complexity_pl',
    'authors', 'series', 'fshop_code', 'cover_url', 'wiki_url',
];

/**
 * PURE: normalize a field value for change-detection (null and '' are equal; trims). String compare.
 */
function avesmapsAdventureNormalizeField(mixed $value): string
{
    return $value === null ? '' : trim((string) $value);
}

/**
 * PURE: which adventure fields to write from the DESIRED (wiki) values. A field is written ONLY when
 * it is NOT protected by a manual override (field_origins[field] !== 'manual') AND its value actually
 * changes (idempotency -- a repeat reconcile is a no-op). Fields absent from $desired are left alone.
 *
 * @param array<string,mixed> $current      the live adventure row (field => value)
 * @param array<string,mixed> $desired      the wiki values (field => value); may omit fields
 * @param array<string,string> $fieldOrigins the stored per-field origin map (field => 'manual'|'wiki')
 * @return array{set:array<string,mixed>, origins:array<string,string>}
 */
function avesmapsAdventureFieldPlan(array $current, array $desired, array $fieldOrigins): array
{
    $set = [];
    foreach (AVESMAPS_ADVENTURE_WIKI_FIELDS as $field) {
        if (!array_key_exists($field, $desired)) {
            continue; // the wiki has nothing to say about this field
        }
        if ((string) ($fieldOrigins[$field] ?? '') === 'manual') {
            continue; // a manual edit wins outright -- never overwritten by the wiki
        }
        if (avesmapsAdventureNormalizeField($current[$field] ?? null) !== avesmapsAdventureNormalizeField($desired[$field])) {
            $set[$field] = $desired[$field];
        }
    }

    $origins = [];
    foreach (array_keys($set) as $field) {
        $origins[$field] = 'wiki';
    }

    return ['set' => $set, 'origins' => $origins];
}

/**
 * PURE: case/space-insensitive key for matching a place name against a wiki tombstone.
 */
function avesmapsAdventurePlaceNameKey(string $name): string
{
    return mb_strtolower(trim($name), 'UTF-8');
}

/**
 * PURE: reconcile an adventure's WIKI-origin places toward the desired ordered list.
 *
 * Rules:
 *   - Identity of a live wiki place = its sort_order (position in the ordered list). So a reordered
 *     or renamed wiki list UPDATES in place; a shrunk list REMOVES the trailing wiki places.
 *   - Manual/community places are NEVER in the plan (only origin='wiki' rows are considered).
 *   - A suppressed WIKI place (editor tombstone, matched by name) is NEVER re-added.
 *   - REMOVE targets only origin='wiki' AND status='approved' places no longer at a desired position.
 *
 * @param list<array<string,mixed>> $currentPlaces [{id, sort_order, raw_name, role, origin, status}]
 * @param list<array<string,mixed>> $desiredPlaces [{sort_order, raw_name, role}] ordered (start=0)
 * @return array{add:list<array<string,mixed>>, update:list<array<string,mixed>>, remove:list<array{id:int}>}
 */
function avesmapsAdventurePlacePlan(array $currentPlaces, array $desiredPlaces): array
{
    $wikiApprovedByOrder = [];
    $suppressedWikiNames = [];
    foreach ($currentPlaces as $place) {
        if ((string) ($place['origin'] ?? '') !== 'wiki') {
            continue; // manual/community -> untouched, invisible to the plan
        }
        $status = (string) ($place['status'] ?? 'approved');
        if ($status === 'suppressed') {
            $suppressedWikiNames[avesmapsAdventurePlaceNameKey((string) ($place['raw_name'] ?? ''))] = true;
            continue;
        }
        if ($status === 'approved') {
            $wikiApprovedByOrder[(int) ($place['sort_order'] ?? 0)] = $place;
        }
    }

    $add = [];
    $update = [];
    $desiredOrders = [];
    foreach ($desiredPlaces as $desired) {
        $order = (int) ($desired['sort_order'] ?? 0);
        $desiredOrders[$order] = true;
        $rawName = (string) ($desired['raw_name'] ?? '');
        $role = (string) ($desired['role'] ?? 'play');

        if (isset($suppressedWikiNames[avesmapsAdventurePlaceNameKey($rawName)])) {
            continue; // editor tombstoned this wiki place -> keep it removed
        }

        if (isset($wikiApprovedByOrder[$order])) {
            $current = $wikiApprovedByOrder[$order];
            if ((string) $current['raw_name'] !== $rawName || (string) ($current['role'] ?? 'play') !== $role) {
                $update[] = ['id' => (int) $current['id'], 'sort_order' => $order, 'raw_name' => $rawName, 'role' => $role];
            }
            continue;
        }
        $add[] = ['sort_order' => $order, 'raw_name' => $rawName, 'role' => $role];
    }

    $remove = [];
    foreach ($wikiApprovedByOrder as $order => $place) {
        if (!isset($desiredOrders[$order])) {
            $remove[] = ['id' => (int) $place['id']];
        }
    }

    return ['add' => $add, 'update' => $update, 'remove' => $remove];
}

// ===========================================================================
// 2. Staging schema (mirror wiki_publication_catalog) + a self-healing adventure.cover_source column.
// ===========================================================================

// Per-step budgets: the dump-walking catalog build reuses the shared page/time budget; the reconcile
// does several writes + up to one image fetch per adventure, so it uses a small entity budget.
const AVESMAPS_ADVENTURE_RECONCILE_STEP_BUDGET = 40;
// Covers display far larger than coats (infobox header / list thumbnail), so keep a bigger long edge.
const AVESMAPS_ADVENTURE_COVER_MAX_EDGE = 600;

/**
 * Self-healing staging schema. wiki_adventure_catalog: one row per adventure {{Infobox Produkt}} page
 * (identity = page-title slug, the SAME slug the publication catalog uses). wiki_adventure_place_staging:
 * the ordered "Ort" list per adventure (identity = (adventure_wiki_key, sort_order)). Also adds a
 * cover_source column to the live `adventure` table so the reconcile fetches an image only when the wiki
 * cover file actually changed. Idempotent.
 */
function avesmapsEnsureAdventureStagingTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_adventure_catalog (
            wiki_key VARCHAR(190) NOT NULL PRIMARY KEY,
            title VARCHAR(300),
            product_type VARCHAR(32),
            edition VARCHAR(16),
            genre VARCHAR(160),
            complexity_gm VARCHAR(60),
            complexity_pl VARCHAR(60),
            authors VARCHAR(500),
            series VARCHAR(200),
            is_official TINYINT(1) NOT NULL DEFAULT 1,
            fshop_code VARCHAR(40),
            cover_file VARCHAR(300),
            wiki_url VARCHAR(500),
            synced_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_adventure_place_staging (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            adventure_wiki_key VARCHAR(190) NOT NULL,
            sort_order INT NOT NULL,
            raw_name VARCHAR(300) NOT NULL,
            UNIQUE KEY uq (adventure_wiki_key, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // The live adventure/adventure_place tables (self-healing DDL in api/_internal/app/adventures.php).
    if (function_exists('avesmapsAdventuresEnsureTables')) {
        avesmapsAdventuresEnsureTables($pdo);
    }
    // cover_source: the wiki cover FILE the current cover_url was fetched from -> refetch only on change.
    $columnExists = static function (PDO $pdo, string $table, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '" . $table . "' AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    try {
        if (!$columnExists($pdo, 'adventure', 'cover_source')) {
            $pdo->exec("ALTER TABLE adventure ADD COLUMN cover_source VARCHAR(300) NULL");
        }
    } catch (Throwable) {
        // adventure table absent in this context -> the reconcile ensures it before use.
    }
}

// ===========================================================================
// 3. Dump-walking build step: adventure catalog + ordered places (STAGING only, dryRun-safe).
// ===========================================================================

/**
 * Default dump page source: reopen the reader and skip $cursor pages (XMLReader is not seekable),
 * the same reopen+skip pattern the publication catalog build / wikitext_collect use. Injectable.
 *
 * @return callable(string,int):iterable
 */
function avesmapsAdventureDefaultPageSource(): callable
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
 * ONE bounded catalog-build step: reopen the dump, skip $cursor pages, and for every Main-namespace
 * non-redirect {{Infobox Produkt}} page that IS an adventure (avesmapsWikiParseProductInfobox ->
 * adventure payload), upsert a wiki_adventure_catalog row + REBUILD its ordered place staging
 * (delete+insert, so the staging list stays a faithful mirror of the dump's "Ort" order). Time-budgeted
 * like the publication catalog build; STAGING-only write (no fetches, no live-table writes) -> safe
 * under the dry "Dump holen".
 *
 * @param callable|null $pageSource test seam: (dumpPath, skipPages) => iterable of page rows
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, found_this_step:int}
 */
function avesmapsAdventureBuildCatalogStep(PDO $pdo, string $dumpPath, int $cursor = 0, ?callable $pageSource = null): array
{
    avesmapsEnsureAdventureStagingTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    $source = $pageSource ?? avesmapsAdventureDefaultPageSource();

    $upsertCatalog = $pdo->prepare(
        'INSERT INTO wiki_adventure_catalog
            (wiki_key, title, product_type, edition, genre, complexity_gm, complexity_pl, authors, series,
             is_official, fshop_code, cover_file, wiki_url, synced_at)
         VALUES
            (:wk, :title, :pt, :ed, :genre, :cgm, :cpl, :authors, :series, :off, :fshop, :cover, :url, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            title = VALUES(title), product_type = VALUES(product_type), edition = VALUES(edition),
            genre = VALUES(genre), complexity_gm = VALUES(complexity_gm), complexity_pl = VALUES(complexity_pl),
            authors = VALUES(authors), series = VALUES(series), is_official = VALUES(is_official),
            fshop_code = VALUES(fshop_code), cover_file = VALUES(cover_file), wiki_url = VALUES(wiki_url),
            synced_at = CURRENT_TIMESTAMP(3)'
    );
    $deletePlaces = $pdo->prepare('DELETE FROM wiki_adventure_place_staging WHERE adventure_wiki_key = :wk');
    $insertPlace = $pdo->prepare(
        'INSERT INTO wiki_adventure_place_staging (adventure_wiki_key, sort_order, raw_name)
         VALUES (:wk, :so, :rn)
         ON DUPLICATE KEY UPDATE raw_name = VALUES(raw_name)'
    );

    $pagesScanned = 0;
    $found = 0;
    $streamExhausted = true;

    foreach ($source($dumpPath, max(0, $cursor)) as $page) {
        $pagesScanned++;

        $wikitext = (string) ($page['wikitext'] ?? '');
        if (stripos($wikitext, 'Produkt') !== false && (int) ($page['ns'] ?? 0) === 0 && ($page['redirect'] ?? null) === null) {
            $info = avesmapsWikiParseProductInfobox($wikitext);
            if (is_array($info) && is_array($info['adventure'] ?? null)) {
                $adventure = $info['adventure'];
                $pageTitle = (string) ($page['title'] ?? '');
                $wikiKey = avesmapsPublicationCatalogWikiKeyForTitle($pageTitle);
                if ($wikiKey !== '') {
                    $displayTitle = trim((string) ($info['title'] ?? ''));
                    if ($displayTitle === '') {
                        $displayTitle = $pageTitle;
                    }
                    $wikiUrl = AVESMAPS_WIKI_PAGE_BASE_URL . str_replace('%2F', '/', rawurlencode($pageTitle));
                    $upsertCatalog->execute([
                        'wk' => $wikiKey,
                        'title' => mb_substr($displayTitle, 0, 300, 'UTF-8'),
                        'pt' => mb_substr((string) ($adventure['product_type'] ?? ''), 0, 32, 'UTF-8'),
                        'ed' => mb_substr((string) ($adventure['edition'] ?? ''), 0, 16, 'UTF-8'),
                        'genre' => mb_substr((string) ($adventure['genre'] ?? ''), 0, 160, 'UTF-8'),
                        'cgm' => mb_substr((string) ($adventure['complexity_gm'] ?? ''), 0, 60, 'UTF-8'),
                        'cpl' => mb_substr((string) ($adventure['complexity_pl'] ?? ''), 0, 60, 'UTF-8'),
                        'authors' => mb_substr((string) ($adventure['authors'] ?? ''), 0, 500, 'UTF-8'),
                        'series' => mb_substr((string) ($adventure['series'] ?? ''), 0, 200, 'UTF-8'),
                        'off' => 1,
                        'fshop' => mb_substr((string) ($info['f_shop_pid'] ?? ''), 0, 40, 'UTF-8'),
                        'cover' => mb_substr((string) ($adventure['cover_file'] ?? ''), 0, 300, 'UTF-8'),
                        'url' => mb_substr($wikiUrl, 0, 500, 'UTF-8'),
                    ]);

                    // Rebuild the ordered place list (delete+insert) so a dropped/reordered "Ort" is mirrored.
                    $deletePlaces->execute(['wk' => $wikiKey]);
                    $sortOrder = 0;
                    foreach ($adventure['places'] as $rawName) {
                        $rawName = trim((string) $rawName);
                        if ($rawName === '') {
                            continue;
                        }
                        $insertPlace->execute(['wk' => $wikiKey, 'so' => $sortOrder, 'rn' => mb_substr($rawName, 0, 300, 'UTF-8')]);
                        $sortOrder++;
                    }
                    $found++;
                }
            }
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
    ];
}

// ===========================================================================
// 4. Cover fetch (SHARP): download the wiki cover -> /uploads/questcovers/<slug>.<ext>.
// ===========================================================================

/**
 * Fetch an adventure's wiki cover image and store it locally under /uploads/questcovers, returning the
 * local URL (or '' on any failure -- the reconcile then leaves cover_url untouched). Modeled on the
 * Wappen engine (avesmapsWikiSyncMonitorSaveCoatLocal): reuses the SAME cURL fetch + format guard +
 * GD downscale. UNLIKE coats there is NO public_domain gate -- adventure covers are shown under the
 * Ulisses fan-content permission WITH a reference to the F-Shop (a licensing basis enforced at the
 * DISPLAY layer, not here). The source URL is built from the cover FILE via the wiki's own
 * Spezial:Dateipfad redirect (so only wiki-aventurica images are ever fetched).
 */
function avesmapsAdventureSaveCoverLocal(string $wikiKey, string $coverFile): string
{
    $coverFile = trim($coverFile);
    $wikiKey = trim($wikiKey);
    if ($coverFile === '' || $wikiKey === '') {
        return '';
    }
    $sourceUrl = avesmapsWikiSyncPoliticalTerritoryFilePathUrl($coverFile); // .../Spezial:Dateipfad/<file> (redirects to the image)
    if ($sourceUrl === '') {
        return '';
    }
    $downloaded = avesmapsWikiSyncMonitorHttpGetBinary($sourceUrl);
    if ($downloaded === null) {
        return '';
    }
    $ext = avesmapsWikiSyncMonitorImageExtension($downloaded['content_type'], $sourceUrl);
    if ($ext === null) {
        return '';
    }
    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');
    $dir = $docroot . '/uploads/questcovers';
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return '';
    }
    $slug = strtolower((string) preg_replace('/[^a-z0-9_-]+/i', '-', (string) preg_replace('/^wiki:/', '', $wikiKey)));
    $slug = trim($slug, '-') ?: 'cover';
    $filename = $slug . '.' . $ext;
    $bytes = avesmapsWikiSyncMonitorDownscaleCoatBytes($downloaded['bytes'], $ext, AVESMAPS_ADVENTURE_COVER_MAX_EDGE);
    if (@file_put_contents($dir . '/' . $filename, $bytes) === false) {
        return '';
    }
    return '/uploads/questcovers/' . $filename;
}

// ===========================================================================
// 5. Reconcile: staging -> live adventure / adventure_place (SHARP, override-safe, resumable).
// ===========================================================================

/**
 * The DESIRED wiki field values for an adventure, from its catalog staging row (cover_url is resolved
 * separately by the fetch). Keys match AVESMAPS_ADVENTURE_WIKI_FIELDS (minus cover_url).
 *
 * @param array<string,mixed> $catalog wiki_adventure_catalog row
 * @return array<string,string>
 */
function avesmapsAdventureDesiredFromStaging(array $catalog): array
{
    return [
        'title' => (string) ($catalog['title'] ?? ''),
        'product_type' => (string) ($catalog['product_type'] ?? ''),
        'edition' => (string) ($catalog['edition'] ?? ''),
        'genre' => (string) ($catalog['genre'] ?? ''),
        'complexity_gm' => (string) ($catalog['complexity_gm'] ?? ''),
        'complexity_pl' => (string) ($catalog['complexity_pl'] ?? ''),
        'authors' => (string) ($catalog['authors'] ?? ''),
        'series' => (string) ($catalog['series'] ?? ''),
        'fshop_code' => (string) ($catalog['fshop_code'] ?? ''),
        'wiki_url' => (string) ($catalog['wiki_url'] ?? ''),
    ];
}

/**
 * Decode a field_origins_json string into a map (field => origin). Empty/invalid -> [].
 *
 * @return array<string,string>
 */
function avesmapsAdventureDecodeOrigins(?string $json): array
{
    if ($json === null || $json === '') {
        return [];
    }
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return [];
    }
    $out = [];
    foreach ($decoded as $field => $origin) {
        $out[(string) $field] = (string) $origin;
    }
    return $out;
}

/**
 * Find the live adventure row for a wiki adventure, ADOPTING a pristine bootstrap-sample placeholder
 * when there is no wiki_key match yet: a manual row with wiki_key IS NULL whose title equals the wiki
 * title is adopted (wiki_key set, origin -> 'wiki'); if it was never hand-edited (no field marked
 * 'manual'), its seeded placeholder places are cleared so the wiki "Ort" list rebuilds cleanly. This
 * prevents the 6 seed samples (wiki_key = NULL) from DUPLICATING their real wiki rows on the first sync.
 * A genuinely hand-curated adventure keeps wiki_key set (the editor writes it), so it is never adopted.
 *
 * @param array<string,mixed> $catalog wiki_adventure_catalog row
 * @return array{id:int, field_origins:array<string,string>, created:bool}
 */
function avesmapsAdventureFindOrAdoptRow(PDO $pdo, array $catalog): array
{
    $wikiKey = trim((string) ($catalog['wiki_key'] ?? ''));

    $byKey = $pdo->prepare('SELECT id, field_origins_json FROM adventure WHERE wiki_key = :wk LIMIT 1');
    $byKey->execute(['wk' => $wikiKey]);
    $row = $byKey->fetch(PDO::FETCH_ASSOC);
    if ($row !== false) {
        return ['id' => (int) $row['id'], 'field_origins' => avesmapsAdventureDecodeOrigins($row['field_origins_json'] ?? null), 'created' => false];
    }

    $title = trim((string) ($catalog['title'] ?? ''));
    if ($title !== '') {
        $byTitle = $pdo->prepare(
            "SELECT id, field_origins_json FROM adventure WHERE wiki_key IS NULL AND origin = 'manual' AND title = :title LIMIT 1"
        );
        $byTitle->execute(['title' => $title]);
        $placeholder = $byTitle->fetch(PDO::FETCH_ASSOC);
        if ($placeholder !== false) {
            $adventureId = (int) $placeholder['id'];
            $fieldOrigins = avesmapsAdventureDecodeOrigins($placeholder['field_origins_json'] ?? null);
            $handEdited = false;
            foreach ($fieldOrigins as $origin) {
                if ($origin === 'manual') {
                    $handEdited = true;
                    break;
                }
            }
            $pdo->prepare("UPDATE adventure SET wiki_key = :wk, origin = 'wiki' WHERE id = :id")
                ->execute(['wk' => $wikiKey, 'id' => $adventureId]);
            if (!$handEdited) {
                // Pristine seed placeholder -> drop its placeholder places so the wiki list rebuilds clean.
                $pdo->prepare('DELETE FROM adventure_place WHERE adventure_id = :id')->execute(['id' => $adventureId]);
                $fieldOrigins = [];
            }
            return ['id' => $adventureId, 'field_origins' => $fieldOrigins, 'created' => false];
        }
    }

    // No match -> create a fresh wiki adventure (title/product_type seeded; the field reconcile below
    // fills the rest and marks their origins 'wiki').
    $publicId = avesmapsWikiSyncUuidV4();
    $pdo->prepare(
        "INSERT INTO adventure (public_id, wiki_key, title, product_type, origin, status, field_origins_json)
         VALUES (:pid, :wk, :title, :pt, 'wiki', 'approved', '{}')"
    )->execute([
        'pid' => $publicId,
        'wk' => $wikiKey,
        'title' => mb_substr($title !== '' ? $title : 'Unbenanntes Abenteuer', 0, 300, 'UTF-8'),
        'pt' => mb_substr((string) ($catalog['product_type'] ?? ''), 0, 32, 'UTF-8'),
    ]);
    return ['id' => (int) $pdo->lastInsertId(), 'field_origins' => [], 'created' => true];
}

/** The adventure columns that are NOT NULL (never written as NULL even when the wiki value is empty). */
const AVESMAPS_ADVENTURE_NOT_NULL_FIELDS = ['title', 'product_type'];

/**
 * Load an adventure's places in the shape avesmapsAdventurePlacePlan consumes.
 *
 * @return list<array<string,mixed>>
 */
function avesmapsAdventureLoadPlacesForReconcile(PDO $pdo, int $adventureId): array
{
    $stmt = $pdo->prepare(
        'SELECT id, sort_order, raw_name, role, origin, status FROM adventure_place WHERE adventure_id = :id'
    );
    $stmt->execute(['id' => $adventureId]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

/**
 * The DESIRED ordered places for an adventure from its place staging (role: the first = 'start').
 *
 * @return list<array{sort_order:int, raw_name:string, role:string}>
 */
function avesmapsAdventureDesiredPlaces(PDO $pdo, string $wikiKey): array
{
    $stmt = $pdo->prepare(
        'SELECT sort_order, raw_name FROM wiki_adventure_place_staging WHERE adventure_wiki_key = :wk ORDER BY sort_order ASC'
    );
    $stmt->execute(['wk' => $wikiKey]);
    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $sortOrder = (int) $row['sort_order'];
        $out[] = ['sort_order' => $sortOrder, 'raw_name' => (string) $row['raw_name'], 'role' => $sortOrder === 0 ? 'start' : 'play'];
    }
    return $out;
}

/**
 * Reconcile ONE live adventure toward its wiki catalog row: adopt/create the row, apply the override-safe
 * field plan (fetching the cover only when its wiki file changed and it is not manually overridden), then
 * reconcile its wiki places. Manual fields/places and suppressed tombstones are never touched. Idempotent.
 *
 * @param array<string,mixed> $catalog wiki_adventure_catalog row
 * @return array{adv_created:int, adv_updated:int, places_added:int, places_updated:int, places_removed:int, covers_fetched:int}
 */
function avesmapsAdventureReconcileEntity(PDO $pdo, array $catalog, int $userId): array
{
    $counters = ['adv_created' => 0, 'adv_updated' => 0, 'places_added' => 0, 'places_updated' => 0, 'places_removed' => 0, 'covers_fetched' => 0];
    $wikiKey = trim((string) ($catalog['wiki_key'] ?? ''));
    if ($wikiKey === '') {
        return $counters;
    }

    $found = avesmapsAdventureFindOrAdoptRow($pdo, $catalog);
    $adventureId = $found['id'];
    $fieldOrigins = $found['field_origins'];
    if ($found['created']) {
        $counters['adv_created']++;
    }

    $currentStmt = $pdo->prepare(
        'SELECT title, product_type, edition, genre, complexity_gm, complexity_pl, authors, series,
                fshop_code, cover_url, cover_source, wiki_url
           FROM adventure WHERE id = :id LIMIT 1'
    );
    $currentStmt->execute(['id' => $adventureId]);
    $current = $currentStmt->fetch(PDO::FETCH_ASSOC) ?: [];

    $desired = avesmapsAdventureDesiredFromStaging($catalog);

    // Cover: fetch ONLY when the wiki cover file changed and the cover is not a manual override.
    if ((string) ($fieldOrigins['cover_url'] ?? '') !== 'manual') {
        $coverFile = trim((string) ($catalog['cover_file'] ?? ''));
        $currentSource = trim((string) ($current['cover_source'] ?? ''));
        if ($coverFile !== '' && $coverFile !== $currentSource) {
            $localUrl = avesmapsAdventureSaveCoverLocal($wikiKey, $coverFile);
            if ($localUrl !== '') {
                $desired['cover_url'] = $localUrl;
                $counters['covers_fetched']++;
                $pdo->prepare('UPDATE adventure SET cover_source = :cs WHERE id = :id')
                    ->execute(['cs' => mb_substr($coverFile, 0, 300, 'UTF-8'), 'id' => $adventureId]);
            }
        } elseif ($coverFile !== '' && $coverFile === $currentSource) {
            // Unchanged cover already fetched -> keep the stored local URL (no re-fetch, no field change).
            $desired['cover_url'] = (string) ($current['cover_url'] ?? '');
        }
    }

    $plan = avesmapsAdventureFieldPlan($current, $desired, $fieldOrigins);
    if ($plan['set'] !== []) {
        $setClauses = [];
        $params = ['id' => $adventureId];
        foreach ($plan['set'] as $field => $value) {
            $setClauses[] = $field . ' = :' . $field;
            $params[$field] = ($value === '' && !in_array($field, AVESMAPS_ADVENTURE_NOT_NULL_FIELDS, true)) ? null : $value;
        }
        $mergedOrigins = $fieldOrigins;
        foreach ($plan['origins'] as $field => $origin) {
            $mergedOrigins[$field] = $origin;
        }
        $setClauses[] = 'field_origins_json = :field_origins_json';
        $params['field_origins_json'] = avesmapsAdventuresEncodeOrigins($mergedOrigins);
        $setClauses[] = 'synced_at = CURRENT_TIMESTAMP(3)';
        $pdo->prepare('UPDATE adventure SET ' . implode(', ', $setClauses) . ' WHERE id = :id')->execute($params);
        if (!$found['created']) {
            $counters['adv_updated']++;
        }
    }

    // Places: reconcile the wiki list (manual/community + suppressed tombstones untouched).
    $placePlan = avesmapsAdventurePlacePlan(
        avesmapsAdventureLoadPlacesForReconcile($pdo, $adventureId),
        avesmapsAdventureDesiredPlaces($pdo, $wikiKey)
    );
    if ($placePlan['add'] !== []) {
        $insertPlace = $pdo->prepare(
            "INSERT INTO adventure_place (adventure_id, sort_order, raw_name, target_kind, role, origin, status)
             VALUES (:aid, :so, :rn, 'unresolved', :role, 'wiki', 'approved')"
        );
        foreach ($placePlan['add'] as $add) {
            $insertPlace->execute(['aid' => $adventureId, 'so' => (int) $add['sort_order'], 'rn' => mb_substr((string) $add['raw_name'], 0, 300, 'UTF-8'), 'role' => (string) $add['role']]);
            $counters['places_added']++;
        }
    }
    if ($placePlan['update'] !== []) {
        // A renamed wiki place is reset to 'unresolved' so the resolver re-resolves it on done.
        $updatePlace = $pdo->prepare(
            "UPDATE adventure_place
                SET raw_name = :rn, role = :role, sort_order = :so,
                    target_kind = 'unresolved', target_public_id = NULL, target_wiki_key = NULL
              WHERE id = :id AND origin = 'wiki'"
        );
        foreach ($placePlan['update'] as $update) {
            $updatePlace->execute(['rn' => mb_substr((string) $update['raw_name'], 0, 300, 'UTF-8'), 'role' => (string) $update['role'], 'so' => (int) $update['sort_order'], 'id' => (int) $update['id']]);
            $counters['places_updated']++;
        }
    }
    if ($placePlan['remove'] !== []) {
        $ids = array_map(static fn(array $r): int => (int) $r['id'], $placePlan['remove']);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        // Override guarantee (a SECOND time in SQL): only ever delete approved wiki places.
        $delete = $pdo->prepare(
            "DELETE FROM adventure_place WHERE origin = 'wiki' AND status = 'approved' AND id IN ({$placeholders})"
        );
        $delete->execute($ids);
        $counters['places_removed'] += $delete->rowCount();
    }

    return $counters;
}

/**
 * ONE bounded reconcile step over the staging catalog, resumable via a wiki_key high-water cursor.
 * Drains wiki_adventure_catalog in $budget-sized ORDER BY wiki_key windows, reconciling each adventure;
 * honors the step time budget (STRATO: no unbounded loop). On done, runs the shared place resolver ONCE
 * (avesmapsAdventureResolveAll) so freshly-added wiki place names resolve to entities, then bumps
 * map_revision if anything changed (the map payload carries adventures). done=true only when drained.
 *
 * @return array{done:bool, nextCursor:string, processed:int, adv_created:int, adv_updated:int,
 *   places_added:int, places_updated:int, places_removed:int, covers_fetched:int}
 */
function avesmapsAdventureReconcileStep(PDO $pdo, string $cursor, int $userId, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_ADVENTURE_RECONCILE_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    avesmapsEnsureAdventureStagingTables($pdo);

    $select = $pdo->prepare('SELECT * FROM wiki_adventure_catalog WHERE wiki_key > :cur ORDER BY wiki_key ASC LIMIT :lim');
    $select->bindValue(':cur', $cursor, PDO::PARAM_STR);
    $select->bindValue(':lim', max(1, $budget), PDO::PARAM_INT);
    $select->execute();
    $catalogRows = $select->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $totals = ['adv_created' => 0, 'adv_updated' => 0, 'places_added' => 0, 'places_updated' => 0, 'places_removed' => 0, 'covers_fetched' => 0];
    $processed = 0;
    $nextCursor = $cursor;
    $timedOut = false;

    foreach ($catalogRows as $catalog) {
        $nextCursor = (string) $catalog['wiki_key'];
        $entityCounters = avesmapsAdventureReconcileEntity($pdo, $catalog, $userId);
        foreach ($totals as $key => $_) {
            $totals[$key] += (int) ($entityCounters[$key] ?? 0);
        }
        $processed++;
        if (microtime(true) >= $deadline) {
            $timedOut = true;
            break;
        }
    }

    // Drained iff we consumed fewer than a full budget AND did not bail on the clock mid-window.
    $done = !$timedOut && count($catalogRows) < $budget;

    $changed = $totals['adv_created'] + $totals['adv_updated'] + $totals['places_added'] + $totals['places_updated'] + $totals['places_removed'] + $totals['covers_fetched'];
    if ($done) {
        if (function_exists('avesmapsAdventureResolveAll')) {
            avesmapsAdventureResolveAll($pdo); // resolve freshly-added wiki place names -> entities (once)
        }
    }
    if ($changed > 0 && function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo); // adventures travel in the map-features payload -> invalidate
    }

    return ['done' => $done, 'nextCursor' => $done ? '' : $nextCursor, 'processed' => $processed] + $totals;
}

// ===========================================================================
// 6. Small COUNT / status accessors.
// ===========================================================================

function avesmapsAdventureCountCatalog(PDO $pdo): int
{
    avesmapsEnsureAdventureStagingTables($pdo);
    return (int) $pdo->query('SELECT COUNT(*) FROM wiki_adventure_catalog')->fetchColumn();
}

/** Last time an adventure was reconciled from the wiki (MAX synced_at over origin='wiki' rows), or null. */
function avesmapsAdventureLastSynced(PDO $pdo): ?string
{
    try {
        $stmt = $pdo->query("SELECT MAX(synced_at) FROM adventure WHERE origin = 'wiki'");
        $value = $stmt !== false ? $stmt->fetchColumn() : false;
        return $value !== false && $value !== null ? (string) $value : null;
    } catch (Throwable) {
        return null;
    }
}

// ===========================================================================
// 6. Cover mass run (SHARP): pull covers for adventures whose local cover is missing.
// ===========================================================================

/**
 * ONE bounded cover-fetch step. Work unit = an adventure with a wiki_key whose LOCAL cover is still due
 * (cover_auto_state IS NULL). Mirrors citymap-autoget's step: EVERY outcome writes cover_auto_state so the
 * run terminates, the state is written PER adventure right after its fetch (never a batch lease), and the
 * ~4s wall-clock budget stops the step (leftovers stay due). The due-query keys off cover_auto_state, NOT
 * an origin field. Manual uploads are skipped (own beats wiki). Bumps map_revision once if any cover was
 * fetched (covers travel in the map-features payload).
 *
 * Called INSIDE avesmapsAutogetGuardedStep (kill-switch + single-flight lock live there), so this body is
 * only ever reached when the run is enabled and this connection holds the lock.
 *
 * @return array{ok:bool, done:bool, remaining:int, adventures_done:int, covers_ok:int, no_image:int,
 *   fetch_failed:int, skipped:int}
 */
function avesmapsAdventureCoverAutogetStep(PDO $pdo, float $budgetSeconds): array
{
    $startedAt = microtime(true);
    @set_time_limit(30);

    // An adventure is DUE when the run has not touched it yet (cover_auto_state IS NULL) and it has a
    // wiki_key (the only source for a wiki cover). Whether the catalog actually has a cover file, and
    // whether the cover is a manual override, is decided in CODE below -- never in this query (an origin
    // filter here would exclude everything, the trap from citymaps-autoget-vorschauen).
    $dueWhere = "wiki_key IS NOT NULL AND TRIM(wiki_key) <> '' AND cover_auto_state IS NULL";

    $due = $pdo->query(
        'SELECT public_id, wiki_key, field_origins_json FROM adventure WHERE ' . $dueWhere
        . ' ORDER BY id LIMIT 200'
    )->fetchAll(PDO::FETCH_ASSOC);

    $coverFileStmt = $pdo->prepare('SELECT cover_file FROM wiki_adventure_catalog WHERE wiki_key = :wk LIMIT 1');
    $stateStmt = $pdo->prepare('UPDATE adventure SET cover_auto_state = :state WHERE public_id = :pid');
    $sourceStmt = $pdo->prepare('UPDATE adventure SET cover_source = :cs WHERE public_id = :pid');

    $tally = ['ok' => 0, 'no_image' => 0, 'fetch_failed' => 0, 'skipped_manual' => 0];
    $adventuresDone = 0;

    foreach ($due as $row) {
        $publicId = (string) $row['public_id'];
        $wikiKey = trim((string) ($row['wiki_key'] ?? ''));

        $origins = [];
        if (!empty($row['field_origins_json'])) {
            $decoded = json_decode((string) $row['field_origins_json'], true);
            if (is_array($decoded)) {
                $origins = $decoded;
            }
        }

        // own beats wiki: never overwrite a manual upload.
        if (avesmapsAdventureCoverAutogetSkips($origins)) {
            $stateStmt->execute(['state' => 'skipped_manual', 'pid' => $publicId]);
            $tally['skipped_manual']++;
            $adventuresDone++;
        } else {
            $coverFileStmt->execute(['wk' => $wikiKey]);
            $coverFile = trim((string) ($coverFileStmt->fetchColumn() ?: ''));

            if ($coverFile === '') {
                // Has a wiki_key but the staging catalog holds no cover file -> nothing to fetch.
                $stateStmt->execute(['state' => 'no_image', 'pid' => $publicId]);
                $tally['no_image']++;
            } else {
                $localUrl = avesmapsAdventureSaveCoverLocal($wikiKey, $coverFile);
                if ($localUrl === '') {
                    $stateStmt->execute(['state' => 'fetch_failed', 'pid' => $publicId]);
                    $tally['fetch_failed']++;
                } else {
                    // Set the cover with origin 'wiki' (field-origin stamped so a manual upload later still
                    // wins) + stamp cover_source so the reconcile treats it as up to date (no re-fetch).
                    avesmapsSetAdventureCoverUrl($pdo, $publicId, $localUrl, 'wiki');
                    $sourceStmt->execute(['cs' => mb_substr($coverFile, 0, 300, 'UTF-8'), 'pid' => $publicId]);
                    $stateStmt->execute(['state' => 'ok', 'pid' => $publicId]);
                    $tally['ok']++;
                }
            }
            $adventuresDone++;
        }

        // Time budget: stop after ~4s; leftovers stay due (cover_auto_state IS NULL) for the next step.
        if (avesmapsAutogetDeadlineReached($startedAt, microtime(true), $budgetSeconds)) {
            break;
        }
    }

    // Covers travel in the map-features payload -> invalidate once if we actually fetched any.
    if ($tally['ok'] > 0) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }

    $remaining = (int) $pdo->query('SELECT COUNT(*) FROM adventure WHERE ' . $dueWhere)->fetchColumn();
    return [
        'ok' => true,
        'done' => $remaining === 0,
        'remaining' => $remaining,
        'adventures_done' => $adventuresDone,
        'covers_ok' => $tally['ok'],
        'no_image' => $tally['no_image'],
        'fetch_failed' => $tally['fetch_failed'],
        'skipped' => $tally['skipped_manual'],
    ];
}
