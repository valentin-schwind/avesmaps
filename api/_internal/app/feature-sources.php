<?php
declare(strict_types=1);

// Multi-source system (#1): catalog of distinct sources + element<->source links.
// Self-healing DDL (project idiom); dedup by url_hash so arbitrary-length URLs get a
// fixed-length UNIQUE index (avoids the utf8mb4 index-length limit on a long url column).
function avesmapsEnsureFeatureSourceTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS sources (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            url TEXT NOT NULL,
            url_hash CHAR(64) NOT NULL,
            label VARCHAR(200) NOT NULL DEFAULT '',
            source_type VARCHAR(32) NOT NULL DEFAULT 'sonstiges',
            is_official TINYINT(1) NOT NULL DEFAULT 0,
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_sources_url_hash (url_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS feature_sources (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            entity_type VARCHAR(16) NOT NULL,
            entity_public_id VARCHAR(64) NOT NULL,
            source_id BIGINT UNSIGNED NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'approved',
            created_by INT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            UNIQUE KEY uq_feature_source (entity_type, entity_public_id, source_id),
            KEY idx_feature_lookup (entity_type, entity_public_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // Self-healing column-adds (project idiom, see wiki/settlements.php:22-55): provenance +
    // reference-detail columns for the wiki-publication-sources feature. `status` already exists;
    // the new allowed value 'suppressed' (manual removal of a wiki-origin link, tombstoned so a
    // later reconcile does not resurrect it) is an application-level convention, no DDL needed.
    $columnExists = static function (PDO $pdo, string $table, string $column): bool {
        $stmt = $pdo->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = '" . $table . "'
               AND COLUMN_NAME = '" . $column . "'"
        );
        return $stmt !== false && (int) $stmt->fetchColumn() > 0;
    };
    $addColumn = static function (string $column, string $definition) use ($pdo, $columnExists): void {
        if (!$columnExists($pdo, 'feature_sources', $column)) {
            $pdo->exec('ALTER TABLE feature_sources ADD COLUMN ' . $column . ' ' . $definition);
        }
    };
    // Who established this link: 'manual' (editor, default) vs 'wiki_publication' (reconcile) etc.
    $addColumn('origin', "VARCHAR(24) NOT NULL DEFAULT 'manual'");
    // How the source refers to the entity (e.g. wiki "Seite"/"Kapitel"), free-form pages/note.
    $addColumn('reference_kind', 'VARCHAR(16) NULL');
    $addColumn('pages', 'VARCHAR(120) NULL');
    $addColumn('note', 'VARCHAR(200) NULL');

    // Step 1 of docs/quellen-wiki-key-instruction.md: a source MAY carry the wiki key of the work
    // it IS. NULL means "no wiki reference known" and is a valid PERMANENT state -- most rows keep
    // it (the 539 shop-only sources are expected to, section 6).
    //
    // Column and index in ONE statement so a half-applied migration is impossible: the guard below
    // only checks the column, and a separate index ALTER could be skipped forever if it failed once.
    //
    // Plain index, deliberately NOT unique yet: the key only becomes the identity once step 5 has
    // folded the duplicates away, and today several rows still describe the same work. The UNIQUE
    // is the last step of the migration, not the first.
    if (!$columnExists($pdo, 'sources', 'wiki_key')) {
        $pdo->exec(
            'ALTER TABLE sources
                ADD COLUMN wiki_key VARCHAR(190) NULL AFTER url_hash,
                ADD KEY idx_sources_wiki_key (wiki_key)'
        );
    }
}

// The read used by the public endpoint: approved catalog links PLUS the element's legacy single
// properties.other_source (settlements/regions/paths keep that field per the owner decision),
// merged and deduped by URL (catalog wins). Official-first then insertion order. This makes the
// existing "Andere Quelle" show without any migration; if it is later also added to the catalog,
// the dedup prevents a double entry.
function avesmapsReadFeatureSources(PDO $pdo, string $entityType, string $entityPublicId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $statement = $pdo->prepare(
        "SELECT s.url, s.label, s.source_type, s.is_official
           FROM feature_sources fs
           JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'
          ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $statement->execute(['t' => $entityType, 'id' => $entityPublicId]);
    $catalog = array_map(static fn(array $r): array => [
        'url' => (string) $r['url'],
        'label' => (string) $r['label'],
        'type' => (string) $r['source_type'],
        'official' => (int) $r['is_official'] === 1,
    ], $statement->fetchAll(PDO::FETCH_ASSOC) ?: []);

    // Legacy "Andere Quelle": settlement/region/path live in map_features.properties.other_source.
    $legacy = null;
    if (in_array($entityType, ['settlement', 'region', 'path'], true)) {
        $lookup = $pdo->prepare(
            "SELECT properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1"
        );
        $lookup->execute(['id' => $entityPublicId]);
        $props = json_decode((string) ($lookup->fetchColumn() ?: ''), true);
        $other = is_array($props) ? ($props['other_source'] ?? null) : null;
        $otherUrl = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
        if ($otherUrl !== '') {
            $legacy = [
                'url' => $otherUrl,
                'label' => is_array($other) ? trim((string) ($other['label'] ?? '')) : '',
                'type' => 'sonstiges',
                'official' => false,
            ];
        }
    }

    if ($legacy === null) {
        return $catalog;
    }
    foreach ($catalog as $existing) {
        if ($existing['url'] === $legacy['url']) {
            return $catalog; // already curated in the catalog -> don't show it twice
        }
    }
    $catalog[] = $legacy;
    return $catalog;
}

// Dedup-Upsert einer Katalog-Quelle (url_hash = Identität). Gibt die sources.id zurück.
// $wikiKey: set only for URL-less publication sources (a wiki catalog entry without a shop
// link); the call contract is a URL-less source ALWAYS passes $wikiKey, otherwise leave it empty.
// The same read as avesmapsReadFeatureSources, but for EVERY entity of one type in ONE query:
// { entity_public_id => [ {url, label, type, official}, ... ] }. Mirrors the shape of
// avesmapsLinkCheckStatesByEntityType so a catalog endpoint can decorate its whole payload without an
// N+1 -- api/app/citymaps.php (Spec §3.5, "zwei Queries, kein N+1") is the first caller, and the reader
// dialog needs it because it filters by source.
//
// Deliberately does NOT merge the legacy properties.other_source the per-entity read adds for
// settlement/region/path: that merge is a per-element map_features lookup (an N+1 by construction) and it
// only exists for entity types that predate the catalog. An entity with no approved sources is simply
// absent from the map.
function avesmapsReadFeatureSourcesByEntityType(PDO $pdo, string $entityType): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $statement = $pdo->prepare(
        "SELECT fs.entity_public_id, s.url, s.label, s.source_type, s.is_official
           FROM feature_sources fs
           JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.status = 'approved'
          ORDER BY fs.entity_public_id ASC, s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $statement->execute(['t' => $entityType]);

    $byEntity = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $byEntity[(string) $row['entity_public_id']][] = [
            'url' => (string) $row['url'],
            'label' => (string) $row['label'],
            'type' => (string) $row['source_type'],
            'official' => (int) $row['is_official'] === 1,
        ];
    }
    return $byEntity;
}

// $refreshLabel: opt-in, used ONLY by the wiki-publication reconcile. The default keeps the
// historic write-once behaviour (a label is only filled when empty). The wiki catalog OWNS the
// canonical label of the rows it creates, so a corrected wiki title must be able to replace a
// stale one -- without it, a fixed catalog title never reaches the live row (Discord case #33:
// "Aventurien" stayed put instead of becoming "Aventurien - Das Lexikon des Schwarzen Auges").
// An EMPTY new label never overwrites a filled one, so a refresh can only ever add information.
function avesmapsFeatureSourceUpsert(PDO $pdo, string $url, string $label, string $type, bool $official, int $userId, string $wikiKey = '', bool $refreshLabel = false): int
{
    $allowed = ['regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch', 'sonstiges'];
    $type = in_array($type, $allowed, true) ? $type : 'sonstiges';
    // URL-less identity: synthesize the hash from the stable wiki key instead of the (missing) URL.
    $hash = ($url === '' && $wikiKey !== '') ? hash('sha256', 'wikipub:' . $wikiKey) : hash('sha256', $url);
    // Step 2: the key is no longer just a hash ingredient -- it is STORED. Until now it was
    // computed here and thrown away because the column did not exist, which is the whole gap
    // section 1 of the instruction describes. Both wiki syncs already pass it, so they need no
    // change; the editor path passes the key avesmapsResolvePublicationIdentityFromUrl proved.
    //
    // Fill, never blank: a later caller without a key (an editor adding the same url by hand) must
    // not erase a key the wiki established. Same one-way rule the label refresh follows.
    $pdo->prepare(
        "INSERT INTO sources (url, url_hash, wiki_key, label, source_type, is_official, created_by)
         VALUES (:u, :h, :wk, :l, :t, :o, :cb)
         ON DUPLICATE KEY UPDATE
             label = " . ($refreshLabel ? "IF(VALUES(label) = '', label, VALUES(label))" : "IF(label = '', VALUES(label), label)") . ",
             is_official = VALUES(is_official),
             wiki_key = IF(VALUES(wiki_key) IS NULL, wiki_key, VALUES(wiki_key))"
    )->execute([
        'u' => $url, 'h' => $hash, 'wk' => $wikiKey !== '' ? $wikiKey : null,
        'l' => $label, 't' => $type, 'o' => $official ? 1 : 0, 'cb' => $userId > 0 ? $userId : null,
    ]);
    return (int) $pdo->query('SELECT id FROM sources WHERE url_hash = ' . $pdo->quote($hash))->fetchColumn();
}

// Element <-> source link (idempotent). $origin/$refKind/$pages/$note are for the future
// wiki-publication reconcile task; existing callers (editor) omit them and keep origin='manual'
// with empty reference fields, unchanged from before.
// Re-linking (ON DUPLICATE KEY UPDATE) always refreshes reference_kind/pages/note. origin/status
// follow a two-caller contract:
//   - $origin='manual' (editor add/re-add, avesmapsAddFeatureSource): manual ALWAYS wins -- origin
//     is forced to 'manual' and status is resurrected to 'approved', even over an existing
//     'suppressed' wiki-origin tombstone, so a manual re-add of a previously-suppressed URL
//     becomes visible again instead of silently staying hidden (status='approved' reads).
//   - $origin='wiki_publication' (wiki reconcile, avesmapsPublicationReconcileEntity in
//     api/_internal/wiki/publication-sync.php): never demotes an existing 'manual' origin, and
//     never touches/resurrects status -- a 'suppressed' tombstone stays suppressed. (The
//     reconcile's diff already excludes suppressed rows from add/update; this is a second,
//     SQL-level guarantee of the same invariant.)
function avesmapsFeatureSourceLink(PDO $pdo, string $entityType, string $publicId, int $sourceId, int $userId, string $origin = 'manual', ?string $refKind = null, ?string $pages = null, ?string $note = null): void
{
    $pdo->prepare(
        "INSERT INTO feature_sources (entity_type, entity_public_id, source_id, status, created_by, origin, reference_kind, pages, note)
         VALUES (:t, :id, :sid, 'approved', :cb, :o, :rk, :pg, :nt)
         ON DUPLICATE KEY UPDATE
             reference_kind = VALUES(reference_kind),
             pages = VALUES(pages),
             note = VALUES(note),
             origin = IF(VALUES(origin) = 'manual' OR feature_sources.origin = 'manual', 'manual', VALUES(origin)),
             status = IF(VALUES(origin) = 'manual', 'approved', feature_sources.status)"
    )->execute([
        't' => $entityType,
        'id' => $publicId,
        'sid' => $sourceId,
        'cb' => $userId > 0 ? $userId : null,
        'o' => $origin,
        'rk' => $refKind,
        'pg' => $pages,
        'nt' => $note,
    ]);
}

// ATOMAR + verlustfrei: legacy properties.other_source -> Katalog + Verknüpfung, DANN Feld leeren.
// Nur map_features-Typen (settlement/region/path) tragen other_source. Idempotent (leer -> no-op).
function avesmapsFeatureSourcesTakeoverOtherSource(PDO $pdo, string $entityType, string $publicId, int $userId): void
{
    if (!in_array($entityType, ['settlement', 'region', 'path'], true)) {
        return;
    }
    $stmt = $pdo->prepare("SELECT id, properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $stmt->execute(['id' => $publicId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return;
    }
    $props = json_decode((string) $row['properties_json'], true);
    if (!is_array($props)) {
        return;
    }
    $other = $props['other_source'] ?? null;
    $url = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
    if ($url === '') {
        return; // nichts zu übernehmen
    }
    $label = is_array($other) ? trim((string) ($other['label'] ?? '')) : '';
    $pdo->beginTransaction();
    try {
        $sourceId = avesmapsFeatureSourceUpsert($pdo, $url, $label, 'sonstiges', false, $userId); // Quelle ist jetzt sicher im Katalog
        avesmapsFeatureSourceLink($pdo, $entityType, $publicId, $sourceId, $userId);
        unset($props['other_source']); // ERST JETZT das alte Feld leeren
        $pdo->prepare("UPDATE map_features SET properties_json = :p, revision = :r WHERE id = :id")
            ->execute(['p' => avesmapsEncodeJson($props), 'r' => avesmapsNextMapRevision($pdo), 'id' => (int) $row['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// Liste FÜR DEN EDITOR: erst Takeover (konsolidiert other_source), dann alle Katalog-Quellen (mit source_id
// zum Löschen) + der feste Wiki-Link. Einheitlich -> keine Sonderfälle in der UI.
function avesmapsListFeatureSourcesForEdit(PDO $pdo, string $entityType, string $publicId, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    avesmapsFeatureSourcesTakeoverOtherSource($pdo, $entityType, $publicId, $userId);
    $stmt = $pdo->prepare(
        "SELECT s.id AS source_id, s.url, s.label, s.source_type, s.is_official, fs.origin, fs.reference_kind, fs.pages
           FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'
          ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $stmt->execute(['t' => $entityType, 'id' => $publicId]);
    // 'origin' lets the editor UI (review-feature-sources.js) group wiki-derived rows
    // ('wiki_publication') under their own "automatisch" heading, separate from manual/community.
    // 'pages' surfaces a source's page citation so the editor row can show it (e.g. "S. 12").
    // 'reference_kind' surfaces a source's coverage classification (ausfuehrlich/ergaenzend/erwaehnung
    // or '') so the editor row can show + round-trip it, and syncFeatureSourcesToClientCache can fold it
    // into the popup globals -> a freshly classified source lands in the right tab without a reload.
    $sources = array_map(static fn(array $r): array => [
        'source_id' => (int) $r['source_id'], 'url' => (string) $r['url'], 'label' => (string) $r['label'],
        'type' => (string) $r['source_type'], 'official' => (int) $r['is_official'] === 1,
        'origin' => (string) $r['origin'], 'pages' => (string) ($r['pages'] ?? ''),
        'reference_kind' => (string) ($r['reference_kind'] ?? ''),
    ], $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);
    return [
        'ok' => true,
        'sources' => $sources,
        'wiki_url' => avesmapsFeatureSourcesReadWikiUrl($pdo, $entityType, $publicId),
        // Post-takeover map_features.revision so an editor that guards its save with
        // expected_revision can refresh its cached token -- the takeover above bumps the
        // revision when it consolidates a legacy other_source (null for territory: no map row).
        'revision' => avesmapsFeatureSourcesReadRevision($pdo, $entityType, $publicId),
    ];
}

// Current optimistic-locking token (map_features.revision) for settlement/region/path; null for
// territory (no map_features row). Read AFTER the takeover in the list response so a caller learns
// the bumped value rather than a stale one.
function avesmapsFeatureSourcesReadRevision(PDO $pdo, string $entityType, string $publicId): ?int
{
    // Only the map_features-backed types have a revision. Territories and citymaps live in their own
    // tables, so their public_id must NEVER be looked up here: it would silently return ANOTHER feature's
    // revision on an id collision, rather than the "no revision" this returns.
    if (!in_array($entityType, ['settlement', 'region', 'path'], true)) {
        return null;
    }
    $s = $pdo->prepare("SELECT revision FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $s->execute(['id' => $publicId]);
    $value = $s->fetchColumn();
    return $value === false ? null : (int) $value;
}

// Der feste Wiki-Link (read-only): settlement/region/path aus properties.wiki_url; territory aus political_territory.wiki_url.
function avesmapsFeatureSourcesReadWikiUrl(PDO $pdo, string $entityType, string $publicId): string
{
    if ($entityType === 'territory') {
        $s = $pdo->prepare("SELECT wiki_url FROM political_territory WHERE public_id = :id LIMIT 1");
        $s->execute(['id' => $publicId]);
        return trim((string) ($s->fetchColumn() ?: ''));
    }
    // A citymap is not a map_features row and has no wiki page of its own (Spec §3.1 gives it no
    // wiki_url column). Falling through to the lookup below would query map_features with a citymap id
    // and, on a collision, hand back an unrelated feature's wiki_url.
    if ($entityType === 'citymap') {
        return '';
    }
    $s = $pdo->prepare("SELECT properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $s->execute(['id' => $publicId]);
    $props = json_decode((string) ($s->fetchColumn() ?: ''), true);
    return is_array($props) ? trim((string) ($props['wiki_url'] ?? '')) : '';
}

function avesmapsAddFeatureSource(PDO $pdo, string $entityType, string $publicId, string $url, string $label, string $type, bool $official, int $userId, string $pages = '', string $referenceKind = ''): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    // Publication-link normalization (dedup): if the URL is a Wiki-Aventurica article for a KNOWN
    // publication, resolve it to the SAME identity the wiki reconcile uses (chosen_url or URL-less
    // wiki_key) so a manual/community link and the wiki-reconciled row become ONE feature_source (the
    // manual row then wins the override) instead of the same book appearing twice. Guarded so the app
    // layer still works when the wiki lib is not loaded (then: no normalization, prior behavior).
    $upsertUrl = $url;
    $upsertWikiKey = '';
    if (function_exists('avesmapsResolvePublicationIdentityFromUrl')) {
        $identity = avesmapsResolvePublicationIdentityFromUrl($pdo, $url);
        if (is_array($identity)) {
            $upsertUrl = (string) ($identity['url'] ?? '');
            $upsertWikiKey = (string) ($identity['wiki_key'] ?? '');
        }
    }
    $sourceId = avesmapsFeatureSourceUpsert($pdo, $upsertUrl, $label, $type, $official, $userId, $upsertWikiKey);
    // Manual/community add: origin stays 'manual'. reference_kind is OPTIONAL classification of how the
    // place is covered in this source -- ausfuehrlich/ergaenzend -> the "Offiziell" publication tab,
    // erwaehnung -> the "Erwähnt" tab, empty -> the flat "Quelle(n):" line (buildSourceListMarkup splits
    // purely on reference_kind presence). Stored so an editor- or community-classified source renders in
    // the matching tab exactly like a wiki-reconciled publication. An optional free-form page citation is
    // stored alongside. Both capped to their column widths (16 / 120). Unknown kinds fall back to null.
    $allowedKinds = ['ausfuehrlich', 'ergaenzend', 'erwaehnung'];
    $refKind = in_array($referenceKind, $allowedKinds, true) ? $referenceKind : null;
    $pagesValue = trim($pages);
    avesmapsFeatureSourceLink($pdo, $entityType, $publicId, $sourceId, $userId, 'manual', $refKind, $pagesValue !== '' ? mb_substr($pagesValue, 0, 120) : null);
    // Cache invalidation (Fix #1): a new source link changes the element's rendered source list,
    // which rides in the ETag-cached map-features payload (W/"mf-<map_revision>-..."). Bump the SAME
    // global map_revision counter ordinary editor edits use so warm-cache clients don't keep a stale
    // 304. avesmapsNextMapRevision is available because api/edit/map/feature-sources.php loads
    // api/_internal/map/features.php (the same reason the other_source takeover below can call it).
    // The trailing list-for-edit's takeover only bumps when it consolidates a legacy other_source,
    // which in the normal editor flow already happened during the initial `list` -> single bump here.
    avesmapsNextMapRevision($pdo);
    return avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId); // Takeover passiert hier drin
}

// Removing a link is a SUPPRESSION for a wiki-derived row and a hard DELETE for everything else.
// A wiki-origin row is tombstoned (status='suppressed') instead of deleted so the next WikiSync
// publication reconcile's pure diff (avesmapsPublicationDiffLinks, api/_internal/wiki/publication-sync.php)
// sees status !== 'approved' and never re-adds it. Manual/community rows keep the prior hard-delete
// behaviour unchanged. The branch is keyed off the existing row's own origin (looked up by the
// entity_type+entity_public_id+source_id triple), not off any client-supplied flag.
function avesmapsRemoveFeatureSource(PDO $pdo, string $entityType, string $publicId, int $sourceId, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    $originStmt = $pdo->prepare(
        "SELECT origin FROM feature_sources
          WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid LIMIT 1"
    );
    $originStmt->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    $origin = $originStmt->fetchColumn();

    if ($origin === 'wiki_publication') {
        $pdo->prepare(
            "UPDATE feature_sources SET status = 'suppressed'
              WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid"
        )->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    } else {
        $pdo->prepare("DELETE FROM feature_sources WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid")
            ->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    }

    // Cache invalidation (Fix #1): suppress OR hard-delete both change the element's rendered
    // source list -> bump the same global map_revision counter (ETag seed) ordinary edits use, so
    // warm-cache clients don't keep a stale 304. Same avesmapsNextMapRevision reuse as the add path.
    avesmapsNextMapRevision($pdo);
    return avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId);
}

// Link an EXISTING catalog row to an element (instruction 5a: "Treffer -> direkte Zuweisung").
//
// Deliberately NOT routed through avesmapsAddFeatureSource: that one upserts a source FROM A URL,
// which cannot express "this exact row". A URL-less wiki publication (its url_hash is synthesized
// from the wiki key, see avesmapsFeatureSourceUpsert) has no URL to upsert by, so a pick sent
// through `add` would either be rejected outright or mint a second row for the same work -- which
// is the very thing 5a exists to stop.
//
// origin='manual' is the same contract as the editor add path: manual wins, and re-picking a
// previously suppressed source makes it visible again rather than silently staying hidden.
function avesmapsLinkExistingFeatureSource(PDO $pdo, string $entityType, string $publicId, int $sourceId, int $userId, string $pages = '', string $referenceKind = ''): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    // The id must name a real catalog row. A stale or invented id would otherwise produce a
    // feature_sources row joining to nothing, which surfaces as a source that silently disappeared.
    $exists = $pdo->prepare('SELECT COUNT(*) FROM sources WHERE id = :id');
    $exists->execute(['id' => $sourceId]);
    if ((int) $exists->fetchColumn() === 0) {
        throw new InvalidArgumentException('Diese Quelle gibt es nicht (mehr).');
    }

    $allowedKinds = ['ausfuehrlich', 'ergaenzend', 'erwaehnung'];
    $refKind = in_array($referenceKind, $allowedKinds, true) ? $referenceKind : null;
    $pagesValue = trim($pages);
    avesmapsFeatureSourceLink(
        $pdo,
        $entityType,
        $publicId,
        $sourceId,
        $userId,
        'manual',
        $refKind,
        $pagesValue !== '' ? mb_substr($pagesValue, 0, 120) : null
    );
    // Same cache invalidation as the add path: the element's rendered source list changed.
    avesmapsNextMapRevision($pdo);
    return avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId);
}

// --- Step 4: work out which sources have a wiki key, WITHOUT writing anything -------------------

// Reads the wiki key a source WOULD get, rather than the one it has. sources.wiki_key is only
// filled by a publication reconcile (step 2), so a report keyed off the column would show nothing
// until after the very run it is supposed to inform. Deriving it from the freshly dumped catalog
// answers the useful question instead: what would the reconcile do, and what collides?
//
// Three routes, and the report says which one produced each key -- "woher" from step 4:
//   stored -- already on the row (a reconcile has run)
//   hash   -- the row IS a reconciled one: its url_hash equals the identity the reconcile computes
//             (sha256 of chosen_url, or of 'wikipub:'+key for a publication with no shop link)
//   url    -- the row points at a Wiki-Aventurica article that resolves to a known publication,
//             redirects included (avesmapsPublicationResolvePublicationKey walks the alias chain)
// No fourth route. Title similarity and shop ids are excluded by invariant 3 -- measured at 1 %.
function avesmapsSourceWikiKeyReport(PDO $pdo, int $sampleLimit = 50): array
{
    avesmapsEnsureFeatureSourceTables($pdo);

    // The identity map the reconcile itself uses, built once from the catalog: hash -> wiki_key.
    $identityByHash = [];
    $catalogTypeByKey = [];
    $catalogTitleByKey = [];
    try {
        $catalog = $pdo->query('SELECT wiki_key, chosen_url, has_link, source_type, title FROM wiki_publication_catalog');
        foreach ($catalog === false ? [] : $catalog->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $key = (string) $row['wiki_key'];
            $hash = (int) ($row['has_link'] ?? 0) === 1
                ? hash('sha256', (string) ($row['chosen_url'] ?? ''))
                : hash('sha256', 'wikipub:' . $key);
            $identityByHash[$hash] = $key;
            $catalogTypeByKey[$key] = (string) ($row['source_type'] ?? '');
            $catalogTitleByKey[$key] = (string) ($row['title'] ?? '');
        }
    } catch (Throwable) {
        // No WikiSync staging on this installation -> every source simply reports "no key".
    }

    $sources = $pdo->query('SELECT id, url, url_hash, wiki_key, label, source_type, is_official FROM sources')
        ?: null;
    $rows = $sources === null ? [] : $sources->fetchAll(PDO::FETCH_ASSOC);

    $byKey = [];
    $routes = ['stored' => 0, 'hash' => 0, 'url' => 0, 'none' => 0];
    foreach ($rows as $row) {
        $id = (int) $row['id'];
        $stored = trim((string) ($row['wiki_key'] ?? ''));
        $key = '';
        $route = 'none';

        if ($stored !== '') {
            $key = $stored;
            $route = 'stored';
        } elseif (isset($identityByHash[(string) $row['url_hash']])) {
            $key = $identityByHash[(string) $row['url_hash']];
            $route = 'hash';
        } elseif (function_exists('avesmapsResolvePublicationIdentityFromUrl')) {
            // Go through avesmapsResolvePublicationIdentityFromUrl rather than calling the key
            // resolver directly: it owns the lazy require chain (sync-monitor's alias-table constant
            // and the political slug helper). Calling past it throws on the first wiki url and the
            // failure lands in the catch below -- a route that silently reports zero instead of
            // saying it is broken. That happened; hence this note.
            //
            // It returns the reconcile's identity INPUTS, not the key, so the result is mapped back
            // through the same hash table the hash route uses -- one definition of identity, not two.
            try {
                $identity = avesmapsResolvePublicationIdentityFromUrl($pdo, (string) $row['url']);
                if (is_array($identity)) {
                    $identityUrl = (string) ($identity['url'] ?? '');
                    $identityKey = (string) ($identity['wiki_key'] ?? '');
                    $identityHash = ($identityUrl === '' && $identityKey !== '')
                        ? hash('sha256', 'wikipub:' . $identityKey)
                        : hash('sha256', $identityUrl);
                    if (isset($identityByHash[$identityHash])) {
                        $key = $identityByHash[$identityHash];
                        $route = 'url';
                    }
                }
            } catch (Throwable) {
                // A single unresolvable url must not sink the whole report.
            }
        }

        $routes[$route]++;
        if ($key === '') {
            continue;
        }
        $byKey[$key][] = [
            'source_id' => $id,
            'label' => (string) $row['label'],
            'type' => (string) $row['source_type'],
            'official' => (int) $row['is_official'] === 1,
            'route' => $route,
        ];
    }

    // How many place links hang on each source -- the number invariant 1 is about.
    $linkCounts = [];
    $countStmt = $pdo->query("SELECT source_id, COUNT(*) AS n FROM feature_sources WHERE status = 'approved' GROUP BY source_id");
    foreach ($countStmt === false ? [] : $countStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $linkCounts[(int) $row['source_id']] = (int) $row['n'];
    }

    // Which resolved keys are an adventure we already know? That is what step 6 will light up.
    $adventureKeys = [];
    try {
        $adv = $pdo->query("SELECT wiki_key FROM adventure WHERE wiki_key IS NOT NULL AND wiki_key <> ''");
        foreach ($adv === false ? [] : $adv->fetchAll(PDO::FETCH_COLUMN) as $key) {
            $adventureKeys[(string) $key] = true;
        }
    } catch (Throwable) {
        // adventure table absent -> the count stays 0, the rest of the report is unaffected.
    }

    $merges = [];
    $conflicts = [];
    $linksInMerges = 0;
    $keysHittingAdventure = 0;
    foreach ($byKey as $key => $group) {
        if (isset($adventureKeys[$key])) {
            $keysHittingAdventure++;
        }
        if (count($group) < 2) {
            continue;
        }
        $links = 0;
        foreach ($group as $entry) {
            $links += $linkCounts[$entry['source_id']] ?? 0;
        }
        $linksInMerges += $links;

        $types = array_values(array_unique(array_map(static fn(array $e): string => $e['type'], $group)));
        $officials = array_values(array_unique(array_map(static fn(array $e): bool => $e['official'], $group)));
        $entry = [
            'wiki_key' => $key,
            'catalog_title' => $catalogTitleByKey[$key] ?? '',
            'sources' => $group,
            'links_affected' => $links,
            'is_adventure' => isset($adventureKeys[$key]),
        ];
        $merges[] = $entry;
        // A conflict is a disagreement about WHAT THE WORK IS. Section 6 decided the wiki wins those,
        // but every one is listed so the override is visible rather than silent.
        if (count($types) > 1 || count($officials) > 1) {
            $conflicts[] = $entry + [
                'types' => $types,
                'officials' => $officials,
                'catalog_type' => $catalogTypeByKey[$key] ?? '',
            ];
        }
    }

    // Biggest first: those are the ones worth looking at by hand.
    usort($merges, static fn(array $a, array $b): int => $b['links_affected'] <=> $a['links_affected']);

    return [
        'sources_total' => count($rows),
        'by_route' => $routes,
        'with_key' => $routes['stored'] + $routes['hash'] + $routes['url'],
        'without_key' => $routes['none'],
        'distinct_keys' => count($byKey),
        'keys_matching_an_adventure' => $keysHittingAdventure,
        'merge_groups' => count($merges),
        'links_affected_by_merges' => $linksInMerges,
        'conflicts' => count($conflicts),
        // Full list of conflicts (step 4 requires each one named), merges capped to keep the
        // response readable -- the count above is the complete figure.
        'conflict_cases' => $conflicts,
        'merge_sample' => array_slice($merges, 0, max(1, $sampleLimit)),
    ];
}

// --- Source merge (instruction step 5: fold one catalog row into another) -----------------------

// Origin precedence when the SAME element is linked to both the old and the new source: the
// stronger origin wins (manual > community > wiki_publication) and a 'suppressed' status survives.
// Pure so it can be unit-tested without a database -- this rule decides data ownership, and getting
// it wrong silently demotes handwork to sync-owned, which the next reconcile would then overwrite.
function avesmapsMergeWinningLink(array $from, array $into): array
{
    $rank = ['wiki_publication' => 1, 'community' => 2, 'manual' => 3];
    $fromRank = $rank[(string) ($from['origin'] ?? '')] ?? 0;
    $intoRank = $rank[(string) ($into['origin'] ?? '')] ?? 0;
    $winner = $fromRank > $intoRank ? $from : $into;

    // Suppression is a deliberate act on either side and must not be undone by a merge.
    $suppressed = ((string) ($from['status'] ?? '')) === 'suppressed'
        || ((string) ($into['status'] ?? '')) === 'suppressed';

    return [
        'origin' => (string) ($winner['origin'] ?? 'manual'),
        'status' => $suppressed ? 'suppressed' : 'approved',
        // Reference details describe the citation, not the work: keep whichever side has them.
        'pages' => ($into['pages'] ?? null) !== null && (string) $into['pages'] !== ''
            ? $into['pages'] : ($from['pages'] ?? null),
        'reference_kind' => ($into['reference_kind'] ?? null) !== null && (string) $into['reference_kind'] !== ''
            ? $into['reference_kind'] : ($from['reference_kind'] ?? null),
    ];
}

// The alt->neu record demanded by invariant 4: without it, nothing is merged.
function avesmapsEnsureSourceMergeLog(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS source_merge_log (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            merged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            merged_by INT NULL,
            from_source_id BIGINT UNSIGNED NOT NULL,
            into_source_id BIGINT UNSIGNED NOT NULL,
            entity_type VARCHAR(16) NOT NULL,
            entity_public_id VARCHAR(64) NOT NULL,
            prior_origin VARCHAR(24) NULL,
            prior_status VARCHAR(16) NULL,
            prior_pages VARCHAR(120) NULL,
            prior_reference_kind VARCHAR(16) NULL,
            prior_other_source_url VARCHAR(500) NULL,
            KEY idx_source_merge_from (from_source_id),
            KEY idx_source_merge_entity (entity_type, entity_public_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// Fold $fromId into $intoId: every element citing the old row ends up citing the new one.
//
// $dryRun=true writes NOTHING and returns exactly what an apply would do -- the report from step 4.
//
// Two populations are folded, because a source reaches an element two ways:
//   1. feature_sources rows pointing at $fromId (the catalog links)
//   2. elements still carrying the old single properties.other_source with the SAME url -- those
//      have no feature_sources row at all. They are converted first via the existing atomic
//      takeover, which puts them into population 1 without a window where the source is nowhere.
//
// Order per element is invariant 5: write the new link, THEN drop the old one. Never the reverse.
function avesmapsMergeSourceInto(PDO $pdo, int $fromId, int $intoId, int $userId, bool $dryRun): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    if ($fromId === $intoId || $fromId <= 0 || $intoId <= 0) {
        throw new InvalidArgumentException('from_source_id und into_source_id muessen verschiedene, gueltige Quellen sein.');
    }

    $read = $pdo->prepare('SELECT id, url, label FROM sources WHERE id IN (:a, :b)');
    $read->execute(['a' => $fromId, 'b' => $intoId]);
    $rows = $read->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if (count($rows) !== 2) {
        throw new InvalidArgumentException('Mindestens eine der beiden Quellen gibt es nicht.');
    }
    $byId = [];
    foreach ($rows as $row) {
        $byId[(int) $row['id']] = $row;
    }
    $fromUrl = trim((string) ($byId[$fromId]['url'] ?? ''));

    // -- population 2: legacy other_source carriers ------------------------------------------------
    // map_features.feature_type is NOT the source system's entity_type: a settlement is stored as
    // 'location'. junction/powerline have no source surface at all and are skipped.
    $entityTypeOf = ['location' => 'settlement', 'path' => 'path', 'region' => 'region', 'label' => 'region'];

    $legacy = [];
    if ($fromUrl !== '') {
        // LIKE is only a coarse pre-filter (the url lives inside properties_json). Every hit is then
        // verified EXACTLY: the url must be this feature's other_source.url, not merely appear
        // somewhere in its JSON. Without that check a feature that cites the url in another field
        // would have its unrelated other_source taken over -- the wrong source, silently.
        $scan = $pdo->prepare(
            "SELECT public_id, feature_type, properties_json FROM map_features
              WHERE is_active = 1 AND properties_json LIKE :needle"
        );
        $scan->execute(['needle' => '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $fromUrl) . '%']);
        foreach ($scan->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $props = json_decode((string) $row['properties_json'], true);
            $other = is_array($props) ? ($props['other_source'] ?? null) : null;
            $otherUrl = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
            if ($otherUrl !== $fromUrl) {
                continue;
            }
            $entityType = $entityTypeOf[(string) $row['feature_type']] ?? null;
            if ($entityType === null) {
                continue;
            }
            $legacy[] = ['public_id' => (string) $row['public_id'], 'entity_type' => $entityType];
        }
    }

    if (!$dryRun) {
        avesmapsEnsureSourceMergeLog($pdo);
        foreach ($legacy as $entry) {
            // Atomic and loss-free: creates the catalog link for $fromId, THEN clears the old field.
            // After this the element is an ordinary population-1 row and folds like any other.
            avesmapsFeatureSourcesTakeoverOtherSource($pdo, $entry['entity_type'], $entry['public_id'], $userId);
        }
    }

    // -- population 1: the catalog links (now including everything just taken over) -----------------
    $linkStmt = $pdo->prepare(
        'SELECT entity_type, entity_public_id, origin, status, pages, reference_kind
           FROM feature_sources WHERE source_id = :id'
    );
    $linkStmt->execute(['id' => $fromId]);
    $fromLinks = $linkStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $moved = 0;
    $mergedWithExisting = 0;
    foreach ($fromLinks as $link) {
        $entityType = (string) $link['entity_type'];
        $publicId = (string) $link['entity_public_id'];

        $existing = $pdo->prepare(
            'SELECT origin, status, pages, reference_kind FROM feature_sources
              WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid LIMIT 1'
        );
        $existing->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $intoId]);
        $target = $existing->fetch(PDO::FETCH_ASSOC) ?: null;
        $winner = avesmapsMergeWinningLink($link, $target ?? []);
        if ($target !== null) {
            $mergedWithExisting++;
        }

        if ($dryRun) {
            $moved++;
            continue;
        }

        $pdo->beginTransaction();
        try {
            // 1. the new link FIRST (invariant 5) -- upsert so an existing one takes the winning values
            $pdo->prepare(
                "INSERT INTO feature_sources
                    (entity_type, entity_public_id, source_id, status, created_by, origin, reference_kind, pages)
                 VALUES (:t, :id, :sid, :st, :cb, :o, :rk, :pg)
                 ON DUPLICATE KEY UPDATE status = VALUES(status), origin = VALUES(origin),
                     reference_kind = VALUES(reference_kind), pages = VALUES(pages)"
            )->execute([
                't' => $entityType, 'id' => $publicId, 'sid' => $intoId,
                'st' => $winner['status'], 'cb' => $userId > 0 ? $userId : null,
                'o' => $winner['origin'], 'rk' => $winner['reference_kind'], 'pg' => $winner['pages'],
            ]);

            // 2. the reversal record BEFORE the old link disappears
            $pdo->prepare(
                'INSERT INTO source_merge_log
                    (merged_by, from_source_id, into_source_id, entity_type, entity_public_id,
                     prior_origin, prior_status, prior_pages, prior_reference_kind, prior_other_source_url)
                 VALUES (:by, :from, :into, :t, :id, :o, :st, :pg, :rk, :url)'
            )->execute([
                'by' => $userId > 0 ? $userId : null, 'from' => $fromId, 'into' => $intoId,
                't' => $entityType, 'id' => $publicId,
                'o' => $link['origin'], 'st' => $link['status'],
                'pg' => $link['pages'], 'rk' => $link['reference_kind'],
                'url' => $fromUrl !== '' ? mb_substr($fromUrl, 0, 500) : null,
            ]);

            // 3. only NOW the old link goes
            $pdo->prepare(
                'DELETE FROM feature_sources WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid'
            )->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $fromId]);

            $pdo->commit();
            $moved++;
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }

    if (!$dryRun && $moved > 0) {
        avesmapsNextMapRevision($pdo); // one bump for the whole run, not one per element
    }

    // NOTE the asymmetry, or the two runs look like they disagree: on an APPLY the takeover has
    // already turned the legacy carriers into catalog links, so links_moved counts them too. On a
    // DRY RUN nothing was converted, so links_moved covers only the pre-existing catalog links and
    // the carriers are still listed separately. total_entities is the comparable number.
    return [
        'dry_run' => $dryRun,
        'from' => ['id' => $fromId, 'label' => (string) ($byId[$fromId]['label'] ?? ''), 'url' => $fromUrl],
        'into' => ['id' => $intoId, 'label' => (string) ($byId[$intoId]['label'] ?? '')],
        'legacy_other_source_carriers' => count($legacy),
        'total_entities' => $dryRun ? $moved + count($legacy) : $moved,
        'links_moved' => $moved,
        'merged_with_existing_link' => $mergedWithExisting,
        'entities' => array_map(static fn(array $l): array => [
            'entity_type' => (string) $l['entity_type'],
            'entity_public_id' => (string) $l['entity_public_id'],
            'origin' => (string) $l['origin'],
            'status' => (string) $l['status'],
        ], $fromLinks),
    ];
}

// --- Catalog search (instruction 5a: reference an EXISTING source instead of typing a new one) ---

// feature_sources has no key on source_id alone -- its unique key leads with entity_type, so
// counting how often a source is cited meant a full scan of ~55k rows. Added here and NOT in
// avesmapsEnsureFeatureSourceTables on purpose: that one runs on the map-features hot path
// (AGENTS.md §10) while the search endpoint is only hit while an editor types.
function avesmapsEnsureSourceSearchIndex(PDO $pdo): void
{
    $statement = $pdo->query(
        "SELECT COUNT(*) FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'feature_sources'
            AND INDEX_NAME = 'idx_feature_sources_source'"
    );
    if ($statement !== false && (int) $statement->fetchColumn() === 0) {
        try {
            $pdo->exec('ALTER TABLE feature_sources ADD KEY idx_feature_sources_source (source_id, status)');
        } catch (PDOException) {
            // Two searches racing on a cold table both pass the check above and both try the ALTER;
            // the loser gets "Duplicate key name". The index exists either way, which is all this
            // function promises -- so swallow it rather than turning one keystroke into a 500.
        }
    }
}

// Typeahead over the shared catalog. Matches label OR url, so pasting a link also finds the row
// that already holds it. Prefix hits rank above substring hits, official above unofficial.
// `uses` (how many elements already cite this source) is what tells an editor they picked the
// right row; it is counted only for the handful of rows actually returned, never catalog-wide.
//
// Returns a flat list; the ENDPOINT wraps it in a group. Once sources.wiki_key exists (steps 1+2)
// the adventure and citymap catalogues become a second group and the client renders them unchanged.
function avesmapsSearchSourceCatalog(PDO $pdo, string $query, int $limit): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    avesmapsEnsureSourceSearchIndex($pdo);

    // LIKE wildcards typed by a user are literals, not operators. Backslash first, then % and _.
    $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $query);
    $limit = max(1, min(10, $limit));

    // Distinct placeholder names: the same name twice is only safe under emulated prepares.
    $statement = $pdo->prepare(
        "SELECT id, url, label, source_type, is_official
           FROM sources
          WHERE label LIKE :contains ESCAPE '\\\\' OR url LIKE :contains_url ESCAPE '\\\\'
          ORDER BY (label LIKE :prefix ESCAPE '\\\\') DESC, is_official DESC, label ASC, id ASC
          LIMIT " . $limit
    );
    $statement->execute([
        'contains' => '%' . $escaped . '%',
        'contains_url' => '%' . $escaped . '%',
        'prefix' => $escaped . '%',
    ]);
    $rows = $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if ($rows === []) {
        return [];
    }

    $ids = array_map(static fn(array $row): int => (int) $row['id'], $rows);
    $countStatement = $pdo->prepare(
        "SELECT source_id, COUNT(*) AS uses FROM feature_sources
          WHERE status = 'approved' AND source_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")
          GROUP BY source_id"
    );
    $countStatement->execute($ids);
    $uses = [];
    foreach ($countStatement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $uses[(int) $row['source_id']] = (int) $row['uses'];
    }

    return array_map(static fn(array $row): array => [
        'source_id' => (int) $row['id'],
        'url' => (string) $row['url'],
        'label' => (string) $row['label'],
        'type' => (string) $row['source_type'],
        'official' => (int) $row['is_official'] === 1,
        'uses' => $uses[(int) $row['id']] ?? 0,
    ], $rows);
}
