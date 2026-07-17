<?php

declare(strict_types=1);

// Wiki publication sources: staging schema + dump-sync/reconcile phase (additive, self-healing
// via IF NOT EXISTS). See docs/wiki-publikations-quellen-design.md.
//
// Side-effect-free on include (function definitions only -- NO top-level code, NO require of a
// side-effectful file), so the pure-diff unit test (__tests__/publication-sync-test.php) can
// `require` it with no MySQL. Every function that touches the DB / dump / parsers takes its
// dependencies as arguments and calls the other libraries at RUNTIME; the caller (the dump
// endpoint) loads that chain before dispatch -- this file requires nothing on include.
//
// Two staging tables (identity = wiki_key, same convention as the other WikiSync staging tables):
//   wiki_publication_catalog: one row per publication wiki page ({{Infobox Produkt}}).
//   wiki_entity_publication:  map-element <-> publication references (reference kind/pages/note
//     parsed from a "==Publikationen==" section), identity =
//     (entity_type, entity_wiki_key, publication_wiki_key). entity_type is part of the identity
//     because a same-named settlement and region/path share the SAME plain slug (a city and its
//     surrounding region both "X" -> both slug "x"); without it their refs would cross-contaminate.
//
// The publication_sources sync phase (avesmapsPublicationSyncPhaseStep, driven by
// dump-hybrid-driver.php) runs three resumable sub-stages: (1) build catalog, (2) build entity
// refs, (3) reconcile refs into production feature_sources (origin='wiki_publication'). The
// reconcile is OVERRIDE-SAFE (never touches a manual/community row or a suppressed tombstone) and
// IDEMPOTENT (identity per publication = wiki_key; a repeat run adds/removes nothing). The
// override-safety heart is the PURE avesmapsPublicationDiffLinks() below (unit-tested first).
function avesmapsEnsurePublicationStagingTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_publication_catalog (
            wiki_key VARCHAR(190) NOT NULL PRIMARY KEY,
            title VARCHAR(300),
            art VARCHAR(80),
            source_type VARCHAR(32),
            isbn VARCHAR(20),
            publisher VARCHAR(160),
            f_shop_url TEXT,
            pdf_shop_url TEXT,
            chosen_url TEXT,
            has_link TINYINT(1),
            synced_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS wiki_entity_publication (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entity_wiki_key VARCHAR(190),
            entity_type VARCHAR(16) NOT NULL DEFAULT '',
            publication_wiki_key VARCHAR(190),
            reference_kind VARCHAR(16),
            pages VARCHAR(120) NULL,
            note VARCHAR(200) NULL,
            UNIQUE KEY uq (entity_type, entity_wiki_key, publication_wiki_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // Self-healing migration for pre-Fix-2 tables (entity_type added after the initial Task-4
    // schema). Territory keys are 'wiki:'-prefixed (disjoint), but a same-named settlement and
    // its surrounding region/path share the SAME plain slug -- keying refs by entity_wiki_key
    // ALONE would cross-contaminate them (the reconcile would apply a settlement's publication
    // sources to the same-named region). entity_type closes that leak. Rebuilt staging has no
    // production data to preserve, so widening the UNIQUE index from 2-col to 3-col is safe.
    $columnExists = static function (PDO $pdo, string $table, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '" . $table . "' AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    if (!$columnExists($pdo, 'wiki_entity_publication', 'entity_type')) {
        $pdo->exec("ALTER TABLE wiki_entity_publication ADD COLUMN entity_type VARCHAR(16) NOT NULL DEFAULT '' AFTER entity_wiki_key");
        // Widen the identity to (entity_type, entity_wiki_key, publication_wiki_key): drop the old
        // 2-col unique, add the 3-col one. Both are try/catch-guarded because MySQL throws on a
        // DROP of a missing index (a hand-migrated table) and on an ADD of a duplicate key name
        // (a prior partial migration) -- both are "already in the desired state", not real errors.
        try {
            $pdo->exec('ALTER TABLE wiki_entity_publication DROP INDEX uq');
        } catch (Throwable) {
            // The old 2-col unique was absent -- nothing to drop.
        }
        try {
            $pdo->exec('ALTER TABLE wiki_entity_publication ADD UNIQUE KEY uq (entity_type, entity_wiki_key, publication_wiki_key)');
        } catch (Throwable) {
            // The 3-col unique already exists -- nothing to add.
        }
    }

    // publisher ({{Infobox Produkt}}|Verlag = the wiki's "Erschienen bei" row). Self-healing ALTER for
    // the same reason as entity_type above: the table already exists in production, where the CREATE
    // above is a no-op. Staging carries no production data, so a NULL column until the next "Dump
    // holen" is the correct honest state -- unknown, not wrong.
    if (!$columnExists($pdo, 'wiki_publication_catalog', 'publisher')) {
        $pdo->exec('ALTER TABLE wiki_publication_catalog ADD COLUMN publisher VARCHAR(160) NULL AFTER isbn');
    }
}

// ===========================================================================
// 1. PURE diff core (Step 1, TDD) -- the override-safety heart. DB-free.
// ===========================================================================

/**
 * PURE: compute the {add, update, remove} plan to reconcile an entity's EXISTING
 * feature_sources rows ($current) toward the DESIRED wiki-publication links ($desired).
 * This is the single source of truth for the override guarantee; the DB reconcile
 * (avesmapsPublicationReconcileEntity) merely applies the plan.
 *
 * $current rows: {source_id, origin, status, [reference_kind], [pages], [note]}.
 * $desired rows: {source_id, reference_kind, pages, note}.
 *
 * Rules (docs/wiki-publikations-quellen-design.md + task-4 brief):
 *   - remove = ONLY rows with origin='wiki_publication' AND status='approved' whose
 *     source_id is NOT in $desired. A manual row, a non-wiki (e.g. community) row, and
 *     a suppressed tombstone are NEVER removed.
 *   - add = a $desired row with NO existing row of that source_id. (A suppressed
 *     tombstone or a manual row IS an existing row, so it blocks the add -- the manual
 *     row wins, the tombstone stays suppressed.)
 *   - update = an existing origin='wiki_publication' AND status='approved' row present
 *     in $desired whose reference_kind/pages/note differ from the desired values (so a
 *     repeat reconcile is a true no-op). A manual/community/suppressed row is never
 *     updated.
 *
 * @param list<array<string,mixed>> $current
 * @param list<array<string,mixed>> $desired
 * @return array{add:list<array<string,mixed>>, update:list<array<string,mixed>>, remove:list<array{source_id:int}>}
 */
function avesmapsPublicationDiffLinks(array $current, array $desired): array
{
    $currentBySource = [];
    foreach ($current as $row) {
        $sourceId = (int) ($row['source_id'] ?? 0);
        if ($sourceId > 0) {
            $currentBySource[$sourceId] = $row;
        }
    }

    $desiredIds = [];
    $add = [];
    $update = [];

    foreach ($desired as $want) {
        $sourceId = (int) ($want['source_id'] ?? 0);
        if ($sourceId <= 0) {
            continue;
        }
        $desiredIds[$sourceId] = true;

        $entry = [
            'source_id' => $sourceId,
            'reference_kind' => $want['reference_kind'] ?? null,
            'pages' => $want['pages'] ?? null,
            'note' => $want['note'] ?? null,
        ];

        if (!isset($currentBySource[$sourceId])) {
            // No existing row of this source -> a brand-new wiki link. (A suppressed
            // tombstone or a manual row would BE an existing row, so absence means the
            // source was never linked to this entity.)
            $add[] = $entry;
            continue;
        }

        $existing = $currentBySource[$sourceId];
        $origin = (string) ($existing['origin'] ?? 'manual');
        $status = (string) ($existing['status'] ?? 'approved');

        // Override guarantee: a manual (or any non-wiki) row wins outright -- the wiki
        // reconcile never adds, updates or removes it.
        if ($origin !== 'wiki_publication') {
            continue;
        }
        // A suppressed wiki row is a tombstone: never resurrected (no add, no update).
        if ($status !== 'approved') {
            continue;
        }
        // Approved wiki row present in the desired set: align its reference fields, but
        // ONLY when they actually differ (idempotency -- a repeat reconcile is a no-op).
        if (avesmapsPublicationReferenceFieldsDiffer($existing, $entry)) {
            $update[] = $entry;
        }
    }

    $remove = [];
    foreach ($currentBySource as $sourceId => $row) {
        if (isset($desiredIds[$sourceId])) {
            continue;
        }
        if ((string) ($row['origin'] ?? '') === 'wiki_publication' && (string) ($row['status'] ?? '') === 'approved') {
            $remove[] = ['source_id' => (int) $sourceId];
        }
    }

    return ['add' => $add, 'update' => $update, 'remove' => $remove];
}

/**
 * PURE: do the reference_kind/pages/note fields of an EXISTING current row differ from
 * the DESIRED entry? Null and '' are treated as equal (an absent field == an empty one).
 * When the current row shape lacks a reference field entirely (e.g. a lean current-state
 * projection), we cannot prove equality -> report "differ" so the reconcile writes the
 * canonical values once (still idempotent on the next run, when the fields are present).
 *
 * @param array<string,mixed> $existing
 * @param array<string,mixed> $desired
 */
function avesmapsPublicationReferenceFieldsDiffer(array $existing, array $desired): bool
{
    $normalize = static fn($value): ?string => ($value === null || $value === '') ? null : (string) $value;
    foreach (['reference_kind', 'pages', 'note'] as $key) {
        if (!array_key_exists($key, $existing)) {
            return true;
        }
        if ($normalize($existing[$key] ?? null) !== $normalize($desired[$key] ?? null)) {
            return true;
        }
    }

    return false;
}

// Per-step budgets. The dump-walking sub-stages use the shared page budget + time
// budget (mirroring dump-sync-kind.php / dump-hybrid-read.php); the reconcile does
// several writes per entity, so it uses a smaller entity budget AND the time budget.
const AVESMAPS_PUBLICATION_RECONCILE_STEP_BUDGET = 150;

// ===========================================================================
// 2. wiki_key derivation (byte-identity with the LIVE stored keys, design I1).
// ===========================================================================

/**
 * Publication catalog identity: the plain hyphen-slug of the publication page's
 * canonical title (avesmapsPoliticalSlug over the normalized title). This is the SAME
 * slug avesmapsPublicationResolvePublicationKey() lands on for a title referenced on an
 * entity page, so wiki_entity_publication.publication_wiki_key JOINs
 * wiki_publication_catalog.wiki_key. NO 'wiki:' prefix (a publication is not a political
 * territory); PoliticalSlug does NOT strip parentheticals, matching the wiki page name.
 */
function avesmapsPublicationCatalogWikiKeyForTitle(string $title): string
{
    return avesmapsPoliticalSlug(avesmapsWikiSyncMonitorNormalizeTitle($title));
}

/**
 * Strip the territory-style 'wiki:'/'name:' prefix the redirect phase writes into
 * wiki_redirect_alias.canonical_wiki_key, landing on the plain slug the publication
 * catalog is keyed by.
 */
function avesmapsPublicationStripWikiKeyPrefix(string $wikiKey): string
{
    if (str_starts_with($wikiKey, 'wiki:') || str_starts_with($wikiKey, 'name:')) {
        return substr($wikiKey, 5);
    }

    return $wikiKey;
}

/**
 * Resolve a publication TITLE referenced on an entity's "==Publikationen==" line to the
 * catalog wiki_key. The title may be a redirect alias (an edition/parenthetical variant);
 * wiki_redirect_alias maps its slug -> canonical_wiki_key (the 'wiki:'-prefixed key the
 * redirect_aliases phase persisted). We strip that prefix to land on the same plain slug
 * avesmapsPublicationCatalogWikiKeyForTitle() produced for the canonical product page, so
 * the ref joins the catalog. A title with no redirect entry is already canonical -> its
 * own slug. (This is why the phase runs AFTER redirect_aliases.)
 */
function avesmapsPublicationResolvePublicationKey(PDO $pdo, string $title): string
{
    $slug = avesmapsPublicationCatalogWikiKeyForTitle($title);
    if ($slug === '') {
        return '';
    }

    $statement = $pdo->prepare(
        'SELECT canonical_wiki_key FROM ' . AVESMAPS_WIKI_SYNC_MONITOR_ALIAS_TABLE . ' WHERE alias_slug = :slug LIMIT 1'
    );
    $statement->execute(['slug' => $slug]);
    $canonical = $statement->fetchColumn();
    if (!is_string($canonical) || $canonical === '') {
        return $slug; // no redirect -> the title is already canonical
    }

    return avesmapsPublicationStripWikiKeyPrefix($canonical);
}

/**
 * Extract a Wiki-Aventurica page title from a URL, or '' if the URL is not a wiki-aventurica
 * article link. Handles the two on-wiki URL shapes: /wiki/<PageName> and /index.php?title=<PageName>.
 * Underscores -> spaces, percent-decoded, #fragment stripped (mirrors how a [[link]] resolves).
 * PURE (no DB, no requires) so it can gate the heavier resolve BEFORE any lazy library load.
 */
function avesmapsWikiAventuricaPageTitleFromUrl(string $url): string
{
    $url = trim($url);
    if ($url === '' || stripos($url, 'wiki-aventurica.de') === false) {
        return '';
    }
    $parts = parse_url($url);
    if (!is_array($parts)) {
        return '';
    }
    $host = strtolower((string) ($parts['host'] ?? ''));
    if (substr($host, -strlen('wiki-aventurica.de')) !== 'wiki-aventurica.de') {
        return '';
    }
    $title = '';
    if (preg_match('#/wiki/(.+)$#', (string) ($parts['path'] ?? ''), $m) === 1) {
        $title = $m[1];
    } elseif (isset($parts['query'])) {
        parse_str((string) $parts['query'], $q);
        $title = (string) ($q['title'] ?? '');
    }
    if ($title === '') {
        return '';
    }
    $title = str_replace('_', ' ', rawurldecode($title));
    $title = preg_replace('/#.*$/u', '', $title) ?? $title;
    return trim($title, " /");
}

/**
 * Normalize a community/editor-provided source URL to the wiki-PUBLICATION identity, so a link to a
 * publication's Wiki-Aventurica ARTICLE merges with the wiki-reconciled row (same source_id) instead
 * of splitting into a duplicate. Returns the avesmapsFeatureSourceUpsert identity inputs
 * ['url'=>..., 'wiki_key'=>...] matching exactly what avesmapsPublicationDesiredLinksForEntity uses:
 *   - has_link=1 publication -> ['url'=>chosen_url, 'wiki_key'=>''] (url_hash identity of the shop link)
 *   - has_link=0 publication -> ['url'=>'',         'wiki_key'=>wiki_key] (URL-less wikipub: identity)
 * Returns null (caller keeps the ORIGINAL url) when the URL is not a wiki-aventurica article, or is one
 * but for a page that is NOT a known publication in wiki_publication_catalog. Fail-safe: any error (e.g.
 * the wiki staging tables don't exist on a site without WikiSync) also yields null -> no normalization.
 * The pure title gate runs FIRST so the common (non-wiki) add path never touches the slug/DB chain.
 */
function avesmapsResolvePublicationIdentityFromUrl(PDO $pdo, string $url): ?array
{
    $title = avesmapsWikiAventuricaPageTitleFromUrl($url);
    if ($title === '') {
        return null;
    }
    try {
        // Lazy-load the pure slug chain (only reached for a real wiki-aventurica article URL).
        if (!function_exists('avesmapsWikiSyncMonitorNormalizeTitle')) {
            require_once __DIR__ . '/sync-monitor.php';
        }
        if (!function_exists('avesmapsPoliticalSlug')) {
            require_once __DIR__ . '/../political/territory.php';
        }
        $wikiKey = avesmapsPublicationResolvePublicationKey($pdo, $title);
        if ($wikiKey === '') {
            return null;
        }
        $stmt = $pdo->prepare('SELECT chosen_url, has_link FROM wiki_publication_catalog WHERE wiki_key = :k LIMIT 1');
        $stmt->execute(['k' => $wikiKey]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return null; // staging tables absent / any error -> keep the original URL (no normalization)
    }
    if (!is_array($row)) {
        return null; // the page is not a known publication -> leave the URL as the reporter gave it
    }
    return (int) ($row['has_link'] ?? 0) === 1
        ? ['url' => (string) ($row['chosen_url'] ?? ''), 'wiki_key' => '']
        : ['url' => '', 'wiki_key' => $wikiKey];
}

/**
 * Derive (entity_type, entity_wiki_key) for a dump page classified as one of the four
 * publication-bearing entity kinds, by REUSING the SAME DB-free dump handlers the Pass-B /
 * hybrid sync uses -- so the key is byte-identical to what a full sync stored on the LIVE
 * entity (design I1 "wiki_key bit-genau"):
 *   settlement/region/path: properties_json.wiki_*.wiki_key = avesmapsPoliticalSlug(canonical)
 *   territory:              political_territory.wiki_key    = avesmapsPoliticalBuildWikiKey -> 'wiki:'.slug
 * Returns ['','']-ish when the page's handler produced no record.
 *
 * @param array{title:string, ns:int, redirect:?string, wikitext:string} $page
 * @return array{entity_type:string, entity_wiki_key:string}
 */
function avesmapsPublicationEntityRefForPage(array $page): array
{
    $kind = avesmapsWikiDumpClassifyPage($page);
    switch ($kind) {
        case AVESMAPS_WIKI_DUMP_ENTITY_SETTLEMENT:
            $record = avesmapsWikiDumpParseSettlementPage($page)['record'] ?? null;
            $entityType = 'settlement';
            break;
        case AVESMAPS_WIKI_DUMP_ENTITY_REGION:
            $record = avesmapsWikiDumpParseRegionPage($page)['record'] ?? null;
            $entityType = 'region';
            break;
        case AVESMAPS_WIKI_DUMP_ENTITY_PATH:
            $record = avesmapsWikiDumpParsePathPage($page)['record'] ?? null;
            $entityType = 'path';
            break;
        case AVESMAPS_WIKI_DUMP_ENTITY_TERRITORY:
            $record = avesmapsWikiDumpParseTerritoryPage($page)['record'] ?? null;
            $entityType = 'territory';
            break;
        default:
            return ['entity_type' => '', 'entity_wiki_key' => ''];
    }

    $wikiKey = is_array($record) ? trim((string) ($record['wiki_key'] ?? '')) : '';

    return ['entity_type' => $entityType, 'entity_wiki_key' => $wikiKey];
}

// ===========================================================================
// 3. Dump-walking sub-steps: build catalog + build entity refs (STAGING only).
// ===========================================================================

/**
 * Default dump page source: reopen the reader and skip $cursor pages (the same
 * reopen+skip pattern Pass A / wikitext_collect use; XMLReader is not seekable).
 * Injectable for tests.
 *
 * @return callable(string,int):iterable
 */
function avesmapsPublicationDefaultPageSource(): callable
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
 * ONE bounded catalog-build step: reopen the dump, skip $cursor pages, and for every
 * Main-namespace non-redirect page that carries an {{Infobox Produkt}} (detected via the
 * Task-2 avesmapsWikiParseProductInfobox), upsert a wiki_publication_catalog row keyed by
 * the PAGE-title slug (the slug a [[link]] to that page resolves to). Time-budgeted like
 * wikitext_collect; done=true iff the stream ran to exhaustion. STAGING-only write.
 *
 * @param callable|null $pageSource test seam: (dumpPath, skipPages) => iterable of page rows
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, found_this_step:int}
 */
function avesmapsPublicationBuildCatalogStep(PDO $pdo, string $dumpPath, int $cursor = 0, ?callable $pageSource = null): array
{
    avesmapsEnsurePublicationStagingTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);

    $source = $pageSource ?? avesmapsPublicationDefaultPageSource();

    $upsert = $pdo->prepare(
        'INSERT INTO wiki_publication_catalog
            (wiki_key, title, art, source_type, isbn, publisher, f_shop_url, pdf_shop_url, chosen_url, has_link, synced_at)
         VALUES
            (:wiki_key, :title, :art, :source_type, :isbn, :publisher, :f_shop_url, :pdf_shop_url, :chosen_url, :has_link, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            title = VALUES(title), art = VALUES(art), source_type = VALUES(source_type),
            isbn = VALUES(isbn), publisher = VALUES(publisher), f_shop_url = VALUES(f_shop_url),
            pdf_shop_url = VALUES(pdf_shop_url),
            chosen_url = VALUES(chosen_url), has_link = VALUES(has_link), synced_at = CURRENT_TIMESTAMP(3)'
    );

    $pagesScanned = 0;
    $found = 0;
    $streamExhausted = true;

    foreach ($source($dumpPath, max(0, $cursor)) as $page) {
        $pagesScanned++;

        $wikitext = (string) ($page['wikitext'] ?? '');
        // Cheap pre-filter before the regex-heavy parse: only a page whose wikitext mentions
        // "Produkt" can carry an {{Infobox Produkt}} (mirrors the refs step's 'Publikationen'
        // gate below). Skips the parser on the vast majority of ns0 articles that are not products.
        if (stripos($wikitext, 'Produkt') !== false && (int) ($page['ns'] ?? 0) === 0 && ($page['redirect'] ?? null) === null) {
            $info = avesmapsWikiParseProductInfobox($wikitext);
            if (is_array($info)) {
                $pageTitle = (string) ($page['title'] ?? '');
                $wikiKey = avesmapsPublicationCatalogWikiKeyForTitle($pageTitle);
                if ($wikiKey !== '') {
                    $displayTitle = trim((string) ($info['title'] ?? ''));
                    if ($displayTitle === '') {
                        $displayTitle = $pageTitle;
                    }
                    $url = avesmapsWikiBuildPublicationUrl($info['f_shop_pid'] ?? null, $info['pdf_shop_id'] ?? null);
                    $upsert->execute([
                        'wiki_key' => $wikiKey,
                        'title' => mb_substr($displayTitle, 0, 300, 'UTF-8'),
                        'art' => mb_substr((string) ($info['art'] ?? ''), 0, 80, 'UTF-8'),
                        'source_type' => (string) ($info['source_type'] ?? 'sonstiges'),
                        'isbn' => mb_substr((string) ($info['isbn'] ?? ''), 0, 20, 'UTF-8'),
                        // '' -> NULL: the schema's "unknown". A book page that names no Verlag must not
                        // hand an empty string to a citymap as if it were an answer.
                        'publisher' => trim((string) ($info['publisher'] ?? '')) === ''
                            ? null
                            : mb_substr((string) $info['publisher'], 0, 160, 'UTF-8'),
                        // chosen_url + has_link are authoritative for the reconcile; the two
                        // per-shop URL columns are left NULL (not needed by the reconcile, and
                        // populating them would duplicate avesmapsWikiBuildPublicationUrl's link
                        // hierarchy and risk drift).
                        'f_shop_url' => null,
                        'pdf_shop_url' => null,
                        'chosen_url' => (string) ($url['chosen_url'] ?? ''),
                        'has_link' => ($url['has_link'] ?? false) ? 1 : 0,
                    ]);
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

/**
 * ONE bounded entity-refs build step: reopen the dump, skip $cursor pages, and for every
 * page that carries a "==Publikationen==" section (cheap stripos pre-filter -> the Task-2
 * avesmapsWikiParsePublicationsSection), derive the entity's wiki_key from its own infobox
 * (avesmapsPublicationEntityRefForPage, byte-identical to the live key) and upsert one
 * wiki_entity_publication row per referenced publication (title resolved to a catalog
 * wiki_key via avesmapsPublicationResolvePublicationKey). Time-budgeted; STAGING-only.
 *
 * @param callable|null $pageSource test seam.
 * @return array{ok:bool, done:bool, nextCursor:int, pages_scanned:int, found_this_step:int}
 */
function avesmapsPublicationBuildEntityRefsStep(PDO $pdo, string $dumpPath, int $cursor = 0, ?callable $pageSource = null): array
{
    avesmapsEnsurePublicationStagingTables($pdo);
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);

    $source = $pageSource ?? avesmapsPublicationDefaultPageSource();

    $upsert = $pdo->prepare(
        'INSERT INTO wiki_entity_publication
            (entity_type, entity_wiki_key, publication_wiki_key, reference_kind, pages, note)
         VALUES (:et, :ewk, :pwk, :rk, :pg, :nt)
         ON DUPLICATE KEY UPDATE reference_kind = VALUES(reference_kind), pages = VALUES(pages), note = VALUES(note)'
    );

    $pagesScanned = 0;
    $refsFound = 0;
    $streamExhausted = true;

    foreach ($source($dumpPath, max(0, $cursor)) as $page) {
        $pagesScanned++;

        $wikitext = (string) ($page['wikitext'] ?? '');
        // Cheap pre-filter before the full parse+classify: only pages mentioning a
        // Publikationen section can carry refs (the parser also gates on the heading).
        if (stripos($wikitext, 'Publikationen') !== false && (int) ($page['ns'] ?? 0) === 0 && ($page['redirect'] ?? null) === null) {
            $publications = avesmapsWikiParsePublicationsSection($wikitext);
            if ($publications !== []) {
                $entityRef = avesmapsPublicationEntityRefForPage($page);
                $entityWikiKey = (string) $entityRef['entity_wiki_key'];
                // entity_type is part of the ref identity (see avesmapsEnsurePublicationStagingTables):
                // it disambiguates a same-named settlement from its region/path (same plain slug).
                $entityType = (string) $entityRef['entity_type'];
                if ($entityWikiKey !== '') {
                    $seen = [];
                    foreach ($publications as $publication) {
                        $publicationKey = avesmapsPublicationResolvePublicationKey($pdo, (string) ($publication['title'] ?? ''));
                        if ($publicationKey === '' || isset($seen[$publicationKey])) {
                            continue; // empty or a duplicate ref within this one page
                        }
                        $seen[$publicationKey] = true;
                        $upsert->execute([
                            'et' => mb_substr($entityType, 0, 16, 'UTF-8'),
                            'ewk' => mb_substr($entityWikiKey, 0, 190, 'UTF-8'),
                            'pwk' => mb_substr($publicationKey, 0, 190, 'UTF-8'),
                            'rk' => $publication['reference_kind'] ?? null,
                            'pg' => $publication['pages'] ?? null,
                            'nt' => $publication['note'] ?? null,
                        ]);
                        $refsFound++;
                    }
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
        'found_this_step' => $refsFound,
    ];
}

// ===========================================================================
// 4. Reconcile: desired links per entity + per-entity apply (SHARP: feature_sources).
// ===========================================================================

/**
 * Assemble the DESIRED wiki-publication links for one entity: JOIN its
 * wiki_entity_publication refs to wiki_publication_catalog, upsert each publication into
 * the shared `sources` catalog (URL-less when the publication has no shop link -- keyed by
 * its wiki_key, per the avesmapsFeatureSourceUpsert URL-less contract) and return
 * [{source_id, reference_kind, pages, note}] for the diff. Publications are OFFICIAL sources.
 * The refs are looked up by the full (entity_type, entity_wiki_key) identity so a same-named
 * settlement and region/path never share links (see avesmapsEnsurePublicationStagingTables).
 *
 * @return list<array{source_id:int, reference_kind:?string, pages:?string, note:?string}>
 */
function avesmapsPublicationDesiredLinksForEntity(PDO $pdo, string $entityType, string $entityWikiKey, int $userId): array
{
    if ($entityType === '' || $entityWikiKey === '') {
        return [];
    }

    // Filter by BOTH entity_type AND entity_wiki_key: a same-named settlement and region/path
    // share the plain slug, so keying on entity_wiki_key alone would leak one's publication
    // sources onto the other. The (entity_type, entity_wiki_key) pair is the true per-entity key.
    $statement = $pdo->prepare(
        'SELECT c.wiki_key AS publication_wiki_key, c.title, c.source_type, c.chosen_url, c.has_link,
                r.reference_kind, r.pages, r.note
           FROM wiki_entity_publication r
           JOIN wiki_publication_catalog c ON c.wiki_key = r.publication_wiki_key
          WHERE r.entity_type = :type AND r.entity_wiki_key = :ewk
          ORDER BY c.title ASC, c.wiki_key ASC'
    );
    $statement->execute(['type' => $entityType, 'ewk' => $entityWikiKey]);

    $desired = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $chosenUrl = (int) ($row['has_link'] ?? 0) === 1 ? (string) ($row['chosen_url'] ?? '') : '';
        $sourceId = avesmapsFeatureSourceUpsert(
            $pdo,
            $chosenUrl,
            (string) ($row['title'] ?? ''),
            (string) ($row['source_type'] ?? 'sonstiges'),
            true, // a wiki publication is an official source
            $userId,
            (string) ($row['publication_wiki_key'] ?? '') // URL-less identity fallback (has_link=0)
        );
        if ($sourceId > 0) {
            $desired[] = [
                'source_id' => $sourceId,
                'reference_kind' => $row['reference_kind'] ?? null,
                'pages' => $row['pages'] ?? null,
                'note' => $row['note'] ?? null,
            ];
        }
    }

    return $desired;
}

/**
 * Reconcile ONE live entity's feature_sources toward its desired wiki-publication links.
 * Reads the current rows, computes the PURE diff, and applies it: add/update via
 * avesmapsFeatureSourceLink(origin='wiki_publication', ...); remove via a DELETE guarded
 * to `origin='wiki_publication' AND status='approved'` (NEVER a manual/community row, NEVER
 * a suppressed tombstone). Idempotent -- a repeat call yields 0/0/0.
 *
 * @return array{links_added:int, links_removed:int, links_updated:int}
 */
function avesmapsPublicationReconcileEntity(PDO $pdo, string $entityType, string $entityPublicId, string $entityWikiKey, int $userId): array
{
    $counters = ['links_added' => 0, 'links_removed' => 0, 'links_updated' => 0];
    if ($entityType === '' || $entityPublicId === '' || $entityWikiKey === '') {
        return $counters;
    }

    $currentStatement = $pdo->prepare(
        'SELECT source_id, origin, status, reference_kind, pages, note
           FROM feature_sources
          WHERE entity_type = :t AND entity_public_id = :id'
    );
    $currentStatement->execute(['t' => $entityType, 'id' => $entityPublicId]);
    $current = $currentStatement->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $desired = avesmapsPublicationDesiredLinksForEntity($pdo, $entityType, $entityWikiKey, $userId);
    $diff = avesmapsPublicationDiffLinks($current, $desired);

    foreach ($diff['add'] as $row) {
        avesmapsFeatureSourceLink(
            $pdo, $entityType, $entityPublicId, (int) $row['source_id'], $userId,
            'wiki_publication', $row['reference_kind'] ?? null, $row['pages'] ?? null, $row['note'] ?? null
        );
        $counters['links_added']++;
    }
    foreach ($diff['update'] as $row) {
        avesmapsFeatureSourceLink(
            $pdo, $entityType, $entityPublicId, (int) $row['source_id'], $userId,
            'wiki_publication', $row['reference_kind'] ?? null, $row['pages'] ?? null, $row['note'] ?? null
        );
        $counters['links_updated']++;
    }
    if ($diff['remove'] !== []) {
        $ids = array_map(static fn(array $r): int => (int) $r['source_id'], $diff['remove']);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        // Override guarantee, enforced a SECOND time in SQL: only ever delete approved
        // wiki_publication rows (the diff already excludes manual/community/suppressed).
        $delete = $pdo->prepare(
            "DELETE FROM feature_sources
              WHERE entity_type = ? AND entity_public_id = ?
                AND origin = 'wiki_publication' AND status = 'approved'
                AND source_id IN ({$placeholders})"
        );
        $delete->execute(array_merge([$entityType, $entityPublicId], $ids));
        $counters['links_removed'] += $delete->rowCount();
    }

    return $counters;
}

// ===========================================================================
// 5. Live-entity enumeration (segmented) + one bounded reconcile step.
// ===========================================================================

/**
 * The stable reconcile segment order. The segment IS the entity_type, which the reconcile
 * threads into the ref lookup (avesmapsPublicationDesiredLinksForEntity filters on both
 * entity_type AND entity_wiki_key). Territory keys are additionally 'wiki:'-prefixed
 * (disjoint from the plain slugs); the entity_type filter also keeps a same-named
 * settlement/region/path -- which DO share a plain slug -- from cross-matching.
 *
 * @return list<string>
 */
function avesmapsPublicationReconcileSegmentOrder(): array
{
    return ['territory', 'settlement', 'region', 'path'];
}

/**
 * Fetch up to $budget live entities of one segment past the id high-water mark $lastId
 * (index-friendly `id > :last ORDER BY id LIMIT`, the same drain pattern
 * avesmapsWikiDumpSyncKindStep uses). territory reads the indexed wiki_key column;
 * settlement/region/path read map_features and extract properties_json.wiki_*.wiki_key in
 * PHP (a `LIKE '%"wiki_*"%'` pre-filter narrows to assigned rows). Rows with an empty key
 * are still returned (they advance the cursor); the caller skips them.
 *
 * @return list<array{id:int, public_id:string, wiki_key:string}>
 */
function avesmapsPublicationFetchLiveEntityBatch(PDO $pdo, string $type, int $lastId, int $budget): array
{
    $budget = max(1, $budget);
    if ($type === 'territory') {
        $statement = $pdo->prepare(
            "SELECT id, public_id, wiki_key
               FROM political_territory
              WHERE wiki_key IS NOT NULL AND wiki_key <> '' AND id > :last
              ORDER BY id LIMIT :budget"
        );
        $statement->bindValue(':last', $lastId, PDO::PARAM_INT);
        $statement->bindValue(':budget', $budget, PDO::PARAM_INT);
        $statement->execute();

        return array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'public_id' => (string) $r['public_id'],
            'wiki_key' => trim((string) $r['wiki_key']),
        ], $statement->fetchAll(PDO::FETCH_ASSOC) ?: []);
    }

    $featureTypeByEntity = ['settlement' => 'location', 'region' => 'label', 'path' => 'path'];
    $propKeyByEntity = ['settlement' => 'wiki_settlement', 'region' => 'wiki_region', 'path' => 'wiki_path'];
    $featureType = $featureTypeByEntity[$type] ?? '';
    $propKey = $propKeyByEntity[$type] ?? '';
    if ($featureType === '' || $propKey === '') {
        return [];
    }

    $statement = $pdo->prepare(
        "SELECT id, public_id, properties_json
           FROM map_features
          WHERE is_active = 1 AND feature_type = :ft AND id > :last AND properties_json LIKE :needle
          ORDER BY id LIMIT :budget"
    );
    $statement->bindValue(':ft', $featureType, PDO::PARAM_STR);
    $statement->bindValue(':last', $lastId, PDO::PARAM_INT);
    $statement->bindValue(':needle', '%"' . $propKey . '"%', PDO::PARAM_STR);
    $statement->bindValue(':budget', $budget, PDO::PARAM_INT);
    $statement->execute();

    $out = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $props = json_decode((string) $row['properties_json'], true);
        $wikiKey = '';
        if (is_array($props) && is_array($props[$propKey] ?? null)) {
            $wikiKey = trim((string) ($props[$propKey]['wiki_key'] ?? ''));
        }
        $out[] = ['id' => (int) $row['id'], 'public_id' => (string) $row['public_id'], 'wiki_key' => $wikiKey];
    }

    return $out;
}

/**
 * ONE bounded reconcile step over the live entities, resumable via (segment, id
 * high-water). Drains the current segment in $budget-sized batches, reconciling each
 * entity; when a batch returns fewer than $budget rows the segment is drained and the
 * cursor advances to the next segment. Honors the step time budget (STRATO: no unbounded
 * loop). done=true only when the LAST segment is drained.
 *
 * @return array{done:bool, nextSegment:int, nextLastId:int, links_added:int, links_removed:int, links_updated:int, processed:int}
 */
function avesmapsPublicationReconcileStep(PDO $pdo, int $segment, int $lastId, int $userId, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_PUBLICATION_RECONCILE_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);

    $segments = avesmapsPublicationReconcileSegmentOrder();
    $linksAdded = 0;
    $linksRemoved = 0;
    $linksUpdated = 0;
    $processed = 0;

    $currentSegment = max(0, $segment);
    $currentLastId = max(0, $lastId);

    while ($currentSegment < count($segments)) {
        $type = $segments[$currentSegment];
        $rows = avesmapsPublicationFetchLiveEntityBatch($pdo, $type, $currentLastId, $budget);

        foreach ($rows as $row) {
            $currentLastId = (int) $row['id'];
            $wikiKey = (string) $row['wiki_key'];
            $publicId = (string) $row['public_id'];
            if ($wikiKey === '' || $publicId === '') {
                continue; // LIKE-matched but unassigned/empty key -> cursor advanced, skip
            }
            $entityCounters = avesmapsPublicationReconcileEntity($pdo, $type, $publicId, $wikiKey, $userId);
            $linksAdded += $entityCounters['links_added'];
            $linksRemoved += $entityCounters['links_removed'];
            $linksUpdated += $entityCounters['links_updated'];
            $processed++;
        }

        if (count($rows) < $budget) {
            // Fewer than a full batch -> this segment is drained; advance to the next.
            $currentSegment++;
            $currentLastId = 0;
        }

        if (microtime(true) >= $deadline) {
            // Cache invalidation (Fix #1): this step wrote to feature_sources, which feeds the
            // ETag-cached map-features payload (W/"mf-<map_revision>-...") -- so bump the SAME
            // global map_revision counter ordinary editor edits use, or warm-cache clients keep
            // 304-ing the pre-publication payload. Reused via avesmapsWikiSyncNextMapRevision
            // (loaded in this runtime by the dump endpoint's locations.php chain). BOTH reconcile
            // drivers -- the sync_publications action AND the apply pipeline -- funnel through this
            // function, so this one spot covers both. Bumping per changed step (not only on the
            // final done=true) means a multi-step run whose LAST step is a no-op still invalidates,
            // while a genuinely no-op step/run never bumps (no needless cache churn).
            if ($linksAdded + $linksRemoved + $linksUpdated > 0) {
                avesmapsWikiSyncNextMapRevision($pdo);
            }
            // Time budget hit: resume from exactly here next step.
            return [
                'done' => $currentSegment >= count($segments),
                'nextSegment' => $currentSegment,
                'nextLastId' => $currentLastId,
                'links_added' => $linksAdded,
                'links_removed' => $linksRemoved,
                'links_updated' => $linksUpdated,
                'processed' => $processed,
            ];
        }
    }

    // Cache invalidation (Fix #1): final step -- same rationale as the deadline branch above. Bump
    // map_revision once iff this step actually changed feature_sources, so warm-cache clients drop
    // their stale 304 and re-fetch the payload that now carries the publication sources.
    if ($linksAdded + $linksRemoved + $linksUpdated > 0) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }

    return [
        'done' => true,
        'nextSegment' => $currentSegment,
        'nextLastId' => 0,
        'links_added' => $linksAdded,
        'links_removed' => $linksRemoved,
        'links_updated' => $linksUpdated,
        'processed' => $processed,
    ];
}

// ===========================================================================
// 6. Small COUNT accessors for the stats counters.
// ===========================================================================

function avesmapsPublicationCountCatalog(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM wiki_publication_catalog')->fetchColumn();
}

function avesmapsPublicationCountCatalogNoLink(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM wiki_publication_catalog WHERE has_link = 0')->fetchColumn();
}

function avesmapsPublicationCountRefs(PDO $pdo): int
{
    return (int) $pdo->query('SELECT COUNT(*) FROM wiki_entity_publication')->fetchColumn();
}

// ===========================================================================
// 7. The publication_sources phase step (three resumable sub-stages).
// ===========================================================================

/**
 * ONE bounded step of the publication_sources phase, dispatched by dump-hybrid-driver.php.
 * Runs three resumable sub-stages in order, tracked by stats['publication_stage']:
 *   'catalog'   -> avesmapsPublicationBuildCatalogStep  (STAGING: wiki_publication_catalog)
 *   'refs'      -> avesmapsPublicationBuildEntityRefsStep (STAGING: wiki_entity_publication)
 *   'reconcile' -> avesmapsPublicationReconcileStep      (SHARP: production feature_sources)
 *
 * THE GATE (mirrors parse_and_upsert): the reconcile sub-stage -- the ONLY production write --
 * runs ONLY when $dryRun === false (the sharp apply path). Under read_step ($dryRun = true) the
 * phase completes after 'refs', so the dry scan stays sandbox-safe (catalog + refs are additive
 * staging tables, like wiki_dump_hybrid_state).
 *
 * Sub-state + counters live in stats_json (returned as 'stats_patch', merged by the driver
 * before the pure transition): publication_stage, publication_cursor (dump page cursor),
 * pub_recon_segment/pub_recon_last_id (reconcile cursor), and the counters
 * publications, entity_refs, links_added/removed/updated, no_link. nextCursor drives the
 * registered 'publication_cursor'.
 *
 * @param array<string,mixed> $stats the run's decoded stats_json (read-only here)
 * @return array{ok:bool, done:bool, nextCursor:int, stats_patch:array<string,mixed>, stage:string,
 *   publications:int, entity_refs:int, links_added:int, links_removed:int, links_updated:int,
 *   no_link:int, processed_this_step:int}
 */
function avesmapsPublicationSyncPhaseStep(PDO $pdo, int $runId, array $stats, string $dumpPath, bool $dryRun, int $userId): array
{
    avesmapsEnsurePublicationStagingTables($pdo);

    $stage = (string) ($stats['publication_stage'] ?? 'catalog');
    $pageCursor = (int) ($stats['publication_cursor'] ?? 0);

    $publications = (int) ($stats['publications'] ?? 0);
    $entityRefs = (int) ($stats['entity_refs'] ?? 0);
    $noLink = (int) ($stats['no_link'] ?? 0);
    $linksAdded = (int) ($stats['links_added'] ?? 0);
    $linksRemoved = (int) ($stats['links_removed'] ?? 0);
    $linksUpdated = (int) ($stats['links_updated'] ?? 0);

    $patch = [];
    $done = false;
    $nextCursor = $pageCursor;
    $processedThisStep = 0;

    if ($stage === 'catalog') {
        $result = avesmapsPublicationBuildCatalogStep($pdo, $dumpPath, $pageCursor);
        $publications = avesmapsPublicationCountCatalog($pdo);
        $noLink = avesmapsPublicationCountCatalogNoLink($pdo);
        $processedThisStep = (int) $result['found_this_step'];
        if ($result['done']) {
            $patch['publication_stage'] = 'refs';
            $nextCursor = 0; // reset the page cursor for the refs walk
        } else {
            $nextCursor = (int) $result['nextCursor'];
        }
    } elseif ($stage === 'refs') {
        $result = avesmapsPublicationBuildEntityRefsStep($pdo, $dumpPath, $pageCursor);
        $entityRefs = avesmapsPublicationCountRefs($pdo);
        $processedThisStep = (int) $result['found_this_step'];
        if ($result['done']) {
            if ($dryRun) {
                // Sandbox path (read_step): catalog + refs are built; the sharp reconcile is
                // gated behind the apply path, so the phase completes here.
                $done = true;
                $nextCursor = 0;
            } else {
                $patch['publication_stage'] = 'reconcile';
                $patch['pub_recon_segment'] = 0;
                $patch['pub_recon_last_id'] = 0;
                $nextCursor = 0;
            }
        } else {
            $nextCursor = (int) $result['nextCursor'];
        }
    } else { // 'reconcile' -- reached only when !$dryRun
        avesmapsEnsureFeatureSourceTables($pdo); // idempotent: ensure feature_sources + provenance columns
        $segment = (int) ($stats['pub_recon_segment'] ?? 0);
        $lastId = (int) ($stats['pub_recon_last_id'] ?? 0);
        $result = avesmapsPublicationReconcileStep($pdo, $segment, $lastId, $userId);
        $linksAdded += (int) $result['links_added'];
        $linksRemoved += (int) $result['links_removed'];
        $linksUpdated += (int) $result['links_updated'];
        $processedThisStep = (int) $result['processed'];
        $patch['pub_recon_segment'] = (int) $result['nextSegment'];
        $patch['pub_recon_last_id'] = (int) $result['nextLastId'];
        $nextCursor = (int) $result['nextLastId'];
        $done = (bool) $result['done'];
    }

    // Fold the (possibly accumulated) counters into the patch so they persist to stats_json.
    $patch['publications'] = $publications;
    $patch['entity_refs'] = $entityRefs;
    $patch['no_link'] = $noLink;
    $patch['links_added'] = $linksAdded;
    $patch['links_removed'] = $linksRemoved;
    $patch['links_updated'] = $linksUpdated;

    return [
        'ok' => true,
        'done' => $done,
        'nextCursor' => $nextCursor,
        'stats_patch' => $patch,
        'stage' => (string) ($patch['publication_stage'] ?? $stage),
        'publications' => $publications,
        'entity_refs' => $entityRefs,
        'links_added' => $linksAdded,
        'links_removed' => $linksRemoved,
        'links_updated' => $linksUpdated,
        'no_link' => $noLink,
        'processed_this_step' => $processedThisStep,
    ];
}
