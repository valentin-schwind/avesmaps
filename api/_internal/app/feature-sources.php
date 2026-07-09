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
function avesmapsFeatureSourceUpsert(PDO $pdo, string $url, string $label, string $type, bool $official, int $userId, string $wikiKey = ''): int
{
    $allowed = ['regionalspielhilfe', 'abenteuer', 'aventurischer_bote', 'quellenband', 'roman', 'briefspiel', 'regelbuch', 'sonstiges'];
    $type = in_array($type, $allowed, true) ? $type : 'sonstiges';
    // URL-less identity: synthesize the hash from the stable wiki key instead of the (missing) URL.
    $hash = ($url === '' && $wikiKey !== '') ? hash('sha256', 'wikipub:' . $wikiKey) : hash('sha256', $url);
    $pdo->prepare(
        "INSERT INTO sources (url, url_hash, label, source_type, is_official, created_by)
         VALUES (:u, :h, :l, :t, :o, :cb)
         ON DUPLICATE KEY UPDATE label = IF(label = '', VALUES(label), label),
                                 is_official = VALUES(is_official)"
    )->execute(['u' => $url, 'h' => $hash, 'l' => $label, 't' => $type, 'o' => $official ? 1 : 0, 'cb' => $userId > 0 ? $userId : null]);
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
        "SELECT s.id AS source_id, s.url, s.label, s.source_type, s.is_official, fs.origin
           FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'
          ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $stmt->execute(['t' => $entityType, 'id' => $publicId]);
    // 'origin' lets the editor UI (review-feature-sources.js) group wiki-derived rows
    // ('wiki_publication') under their own "automatisch" heading, separate from manual/community.
    $sources = array_map(static fn(array $r): array => [
        'source_id' => (int) $r['source_id'], 'url' => (string) $r['url'], 'label' => (string) $r['label'],
        'type' => (string) $r['source_type'], 'official' => (int) $r['is_official'] === 1,
        'origin' => (string) $r['origin'],
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
    if ($entityType === 'territory') {
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
    $s = $pdo->prepare("SELECT properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $s->execute(['id' => $publicId]);
    $props = json_decode((string) ($s->fetchColumn() ?: ''), true);
    return is_array($props) ? trim((string) ($props['wiki_url'] ?? '')) : '';
}

function avesmapsAddFeatureSource(PDO $pdo, string $entityType, string $publicId, string $url, string $label, string $type, bool $official, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $sourceId = avesmapsFeatureSourceUpsert($pdo, $url, $label, $type, $official, $userId);
    avesmapsFeatureSourceLink($pdo, $entityType, $publicId, $sourceId, $userId);
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
