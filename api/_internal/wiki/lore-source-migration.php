<?php

declare(strict_types=1);

// One-off migration: lore_source -> the shared source system (sources + feature_sources with
// entity_type='lore'). See docs/superpowers/specs/2026-07-22-lore-quellen-vereinheitlichung-design.md.
//
// ⏳ THIS FILE HAS AN END OF LIFE. It exists solely to move the ~35.000 rows the Lore feature
// wrote into its own table before AGENTS.md §5 was written down. Once the owner has run it,
// verified the counts and dropped lore_source, this file and its test go with it. That is why the
// migration lives here and not sprinkled through lore-sync.php: a temporary thing should look
// temporary and be deletable in one move.
//
// 💣 THE COUNT THAT DOES NOT MATCH, AND MUST NOT BE "FIXED":
//   lore_source is unique per (entry, publication, reference_kind, sort_order).
//   feature_sources is unique per (entity_type, entity_public_id, source_id).
// The same publication cited twice in one article is TWO lore_source rows and ONE feature_sources
// link. So the expected target is COUNT(DISTINCT entry_wiki_key, publication_wiki_key), NOT the
// raw row count. avesmapsLoreSourceMigrationCounts reports both; comparing against the raw number
// makes a correct run look like data loss.
//
// Side-effect-free on include (const + function only), so __tests__/lore-source-migration-test.php
// can require the PURE core without MySQL. Every DB function takes its PDO as an argument and
// calls the shared source library at RUNTIME (the endpoint loads it).

/** How many lore entries one bounded migration step processes. STRATO: no unbounded loop. */
const AVESMAPS_LORE_SOURCE_MIGRATION_BATCH = 200;

// ===========================================================================
// 1. PURE core (DB-free, unit-tested) -- the collapse and the identity rule.
// ===========================================================================

/** The three coverage classifications feature_sources accepts; anything else is not data. */
const AVESMAPS_LORE_SOURCE_MIGRATION_KINDS = ['ausfuehrlich', 'ergaenzend', 'erwaehnung'];

/**
 * PURE: '' and null are the same absence. Returned as null so a value reaches feature_sources
 * exactly as the reconcile would write it -- otherwise every later reconcile would see a
 * difference that is not one and rewrite the row forever.
 */
function avesmapsLoreSourceMigrationNullIfBlank(mixed $value): ?string
{
    $text = trim((string) ($value ?? ''));

    return $text === '' ? null : $text;
}

/**
 * PURE: collapse ALL lore_source rows of ONE (entry, publication) pair into the single
 * feature_sources link they become.
 *
 *   reference_kind/pages/note  the row with the lowest sort_order -- the FIRST mention in the
 *                              wiki article, which is the one a reader would consider primary.
 *   origin                     'manual' if ANY row is manual. A hand-made row exists precisely so
 *                              the sync leaves it alone; demoting it here would hand it back.
 *   status                     'suppressed' if ANY row is suppressed. Suppression is a deliberate
 *                              act and survives a merge -- the same rule avesmapsMergeWinningLink
 *                              applies when two catalogue sources are folded together.
 *
 * Returns null for an empty group (the caller skips it rather than writing a blank link).
 *
 * @param list<array<string,mixed>> $rows
 * @return array{reference_kind:?string, pages:?string, note:?string, origin:string, status:string}|null
 */
function avesmapsLoreSourceMigrationWinner(array $rows): ?array
{
    if ($rows === []) {
        return null;
    }

    $detail = null;
    $lowest = null;
    $manual = false;
    $suppressed = false;

    foreach ($rows as $row) {
        // Not a sort(): a stable minimum is order-independent by construction, so the migration
        // yields the same result no matter how the database hands the rows back.
        $order = (int) ($row['sort_order'] ?? 0);
        if ($lowest === null || $order < $lowest) {
            $lowest = $order;
            $detail = $row;
        }
        if ((string) ($row['origin'] ?? 'wiki') === 'manual') {
            $manual = true;
        }
        if ((string) ($row['status'] ?? 'active') === 'suppressed') {
            $suppressed = true;
        }
    }

    $kind = avesmapsLoreSourceMigrationNullIfBlank($detail['reference_kind'] ?? null);
    if ($kind !== null && !in_array($kind, AVESMAPS_LORE_SOURCE_MIGRATION_KINDS, true)) {
        $kind = null; // an unknown classification is dropped, never carried into the shared system
    }

    return [
        'reference_kind' => $kind,
        'pages' => avesmapsLoreSourceMigrationNullIfBlank($detail['pages'] ?? null),
        'note' => avesmapsLoreSourceMigrationNullIfBlank($detail['note'] ?? null),
        // The two vocabularies differ: lore says wiki/manual + active/suppressed, the shared system
        // says wiki_publication/manual + approved/suppressed. Every lore wiki source IS a wiki
        // publication link -- that is the whole reason this migration is possible at all.
        'origin' => $manual ? 'manual' : 'wiki_publication',
        'status' => $suppressed ? 'suppressed' : 'approved',
    ];
}

/**
 * PURE: flat lore_source rows -> one collapsed record per (entry, publication) pair.
 * Rows without an entry key or without a publication key cannot become a link and are dropped;
 * the caller reports how many, so a shortfall is explainable rather than mysterious.
 *
 * @param list<array<string,mixed>> $rows
 * @return list<array<string,mixed>>
 */
function avesmapsLoreSourceMigrationGroup(array $rows): array
{
    $groups = [];
    foreach ($rows as $row) {
        $entry = trim((string) ($row['entry_wiki_key'] ?? ''));
        $publication = trim((string) ($row['publication_wiki_key'] ?? ''));
        if ($entry === '' || $publication === '') {
            continue;
        }
        $groups[$entry . '|' . $publication][] = $row;
    }

    $out = [];
    foreach ($groups as $key => $group) {
        $winner = avesmapsLoreSourceMigrationWinner($group);
        if ($winner === null) {
            continue;
        }
        [$entry, $publication] = explode('|', $key, 2);
        // The stored title of the FIRST row is the fallback label; the catalogue overrides it
        // later (avesmapsLoreSourceMigrationIdentity) when it knows the work.
        $out[] = $winner + [
            'entry_wiki_key' => $entry,
            'publication_wiki_key' => $publication,
            'publication_title' => trim((string) ($group[0]['publication_title'] ?? '')),
        ];
    }

    return $out;
}

/**
 * PURE: the catalogue identity of one publication -- the inputs avesmapsFeatureSourceUpsert needs.
 *
 * 💣 This MUST agree byte-for-byte with avesmapsPublicationDesiredLinksForEntity, or the same book
 * enters the shared catalogue twice: once through this migration and once through the next
 * reconcile. Three cases:
 *   has_link=1  -> the shop url IS the identity (url_hash of chosen_url)
 *   has_link=0  -> URL-less, identity synthesized from 'wikipub:'+wiki_key
 *   not in the catalogue at all -> also URL-less by wiki_key. Staging may be stale or incomplete
 *      (the migration deliberately does NOT require a fresh dump). This is self-healing: a
 *      catalogue row that later appears with has_link=0 MERGES with the row written here, and one
 *      that appears with has_link=1 makes the next reconcile add the shop row and retire this one
 *      -- it is origin='wiki_publication' and no longer desired, which is exactly the case the
 *      reconcile's remove branch is for.
 *
 * @param array<string,mixed>|null $catalogRow the wiki_publication_catalog row, or null
 * @return array{url:string, wiki_key:string, label:string, source_type:string}
 */
function avesmapsLoreSourceMigrationIdentity(string $wikiKey, string $loreTitle, ?array $catalogRow): array
{
    $hasLink = is_array($catalogRow) && (int) ($catalogRow['has_link'] ?? 0) === 1;
    $chosenUrl = is_array($catalogRow) ? trim((string) ($catalogRow['chosen_url'] ?? '')) : '';

    // The catalogue owns the canonical title of a work it knows; the title copied into every
    // lore_source row is only the fallback. (That duplication is what this migration is undoing.)
    $catalogTitle = is_array($catalogRow) ? trim((string) ($catalogRow['title'] ?? '')) : '';
    $label = $catalogTitle !== '' ? $catalogTitle : trim($loreTitle);

    $type = is_array($catalogRow) ? trim((string) ($catalogRow['source_type'] ?? '')) : '';

    return [
        'url' => $hasLink ? $chosenUrl : '',
        'wiki_key' => $hasLink ? '' : $wikiKey,
        'label' => $label,
        'source_type' => $type !== '' ? $type : 'sonstiges',
    ];
}

// ===========================================================================
// 2. Counts -- the before/after reconciliation the owner checks.
// ===========================================================================

/**
 * The numbers that make the migration verifiable. Read BEFORE and AFTER; the pair is the proof
 * that nothing was lost.
 *
 *   lore_rows        raw lore_source rows (status='active') -- the number people quote (~34.933)
 *   lore_pairs       DISTINCT (entry, publication) -- ⚠️ THE ACTUAL TARGET, always <= lore_rows
 *   lore_entries     how many lore entries carry at least one source
 *   shared_links     feature_sources rows with entity_type='lore' (any status)
 *   shared_approved  ... of those, the visible ones
 *   catalog_hits     distinct publications of lore_source that wiki_publication_catalog knows
 *
 * Every read is guarded: a missing table is a state (not yet migrated / already dropped), not an
 * error, and must not turn a status call into a 500.
 *
 * @return array<string,int>
 */
function avesmapsLoreSourceMigrationCounts(PDO $pdo): array
{
    $scalar = static function (PDO $pdo, string $sql): int {
        try {
            $statement = $pdo->query($sql);

            return $statement === false ? 0 : (int) $statement->fetchColumn();
        } catch (Throwable) {
            return 0; // table absent -> 0, which is the honest answer for "how many are there"
        }
    };

    return [
        'lore_rows' => $scalar($pdo, "SELECT COUNT(*) FROM lore_source WHERE status = 'active'"),
        'lore_pairs' => $scalar($pdo, "SELECT COUNT(*) FROM (SELECT 1 FROM lore_source WHERE status = 'active'
                                        GROUP BY entry_wiki_key, publication_wiki_key) g"),
        'lore_entries' => $scalar($pdo, "SELECT COUNT(DISTINCT entry_wiki_key) FROM lore_source WHERE status = 'active'"),
        'shared_links' => $scalar($pdo, "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'lore'"),
        'shared_approved' => $scalar($pdo, "SELECT COUNT(*) FROM feature_sources WHERE entity_type = 'lore' AND status = 'approved'"),
        'catalog_hits' => $scalar($pdo, "SELECT COUNT(DISTINCT s.publication_wiki_key)
                                           FROM lore_source s
                                           JOIN wiki_publication_catalog c ON c.wiki_key = s.publication_wiki_key"),
    ];
}

/**
 * Rows that could NOT become a link, listed so a shortfall in the count reconciliation has a name.
 * Today the expected answer is zero on both counts; if it is not, the sample says which entries.
 *
 * @return array{orphan_entries:int, keyless_rows:int, sample:list<string>}
 */
function avesmapsLoreSourceMigrationGaps(PDO $pdo, int $sampleLimit = 20): array
{
    $out = ['orphan_entries' => 0, 'keyless_rows' => 0, 'sample' => []];
    try {
        // A source hanging on an entry that does not exist: it would produce a feature_sources row
        // pointing at nothing, which surfaces later as a source that silently disappeared.
        $out['orphan_entries'] = (int) $pdo->query(
            "SELECT COUNT(DISTINCT s.entry_wiki_key) FROM lore_source s
              LEFT JOIN lore_entry e ON e.wiki_key = s.entry_wiki_key
              WHERE s.status = 'active' AND e.wiki_key IS NULL"
        )->fetchColumn();
        $out['keyless_rows'] = (int) $pdo->query(
            "SELECT COUNT(*) FROM lore_source
              WHERE status = 'active' AND (entry_wiki_key = '' OR publication_wiki_key = '')"
        )->fetchColumn();
        $sample = $pdo->query(
            "SELECT DISTINCT s.entry_wiki_key FROM lore_source s
              LEFT JOIN lore_entry e ON e.wiki_key = s.entry_wiki_key
              WHERE s.status = 'active' AND e.wiki_key IS NULL
              LIMIT " . max(1, $sampleLimit)
        );
        $out['sample'] = array_map('strval', $sample === false ? [] : ($sample->fetchAll(PDO::FETCH_COLUMN) ?: []));
    } catch (Throwable) {
        return $out; // lore_source already gone -> nothing to report
    }

    return $out;
}

// ===========================================================================
// 3. One bounded, resumable migration step.
// ===========================================================================

/**
 * ONE bounded step: take the next AVESMAPS_LORE_SOURCE_MIGRATION_BATCH lore entries past the
 * $cursor high-water mark and move their sources into the shared system.
 *
 * Resumable and idempotent. Writing goes through avesmapsFeatureSourceUpsert +
 * avesmapsFeatureSourceLink rather than hand-written SQL, so it inherits their contract: a link
 * that already exists is not demoted from 'manual', and a 'suppressed' tombstone is never
 * resurrected. Running the migration twice therefore changes nothing the second time.
 *
 * $dryRun writes NOTHING and reports exactly what a sharp run would do.
 *
 * ⚠️ Entries are walked by entry_wiki_key, and ALL of one entry's rows are handled in the same
 * step -- the batch boundary never falls inside an entry, so a collapse can never see half a
 * group and pick the wrong winner.
 *
 * @return array<string,mixed>
 */
function avesmapsLoreSourceMigrationStep(PDO $pdo, string $cursor = '', bool $dryRun = false, int $userId = 0): array
{
    $stats = [
        'ok' => true, 'dry_run' => $dryRun, 'done' => false, 'nextCursor' => $cursor,
        'entries_processed' => 0, 'rows_read' => 0, 'links_written' => 0,
        'sources_touched' => 0, 'rows_skipped' => 0, 'links_failed' => 0, 'source_missing' => false,
    ];

    try {
        $batch = $pdo->prepare(
            "SELECT DISTINCT entry_wiki_key FROM lore_source
              WHERE status = 'active' AND entry_wiki_key > :cursor
              ORDER BY entry_wiki_key LIMIT " . (int) AVESMAPS_LORE_SOURCE_MIGRATION_BATCH
        );
        $batch->execute(['cursor' => $cursor]);
        $entries = array_map('strval', $batch->fetchAll(PDO::FETCH_COLUMN) ?: []);
    } catch (Throwable) {
        // lore_source does not exist: already dropped, or never created on this installation.
        // A STATE, not a failure -- reported so the client can say so instead of showing an error.
        $stats['done'] = true;
        $stats['source_missing'] = true;

        return $stats;
    }

    if ($entries === []) {
        $stats['done'] = true;

        return $stats;
    }

    avesmapsEnsureFeatureSourceTables($pdo);

    $placeholders = implode(',', array_fill(0, count($entries), '?'));
    $read = $pdo->prepare(
        "SELECT entry_wiki_key, publication_wiki_key, publication_title, reference_kind,
                pages, note, sort_order, origin, status
           FROM lore_source
          WHERE status = 'active' AND entry_wiki_key IN ({$placeholders})"
    );
    $read->execute($entries);
    $rows = $read->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $stats['rows_read'] = count($rows);

    $links = avesmapsLoreSourceMigrationGroup($rows);

    // 🪤 rows_skipped is NOT count($rows) - count($links). That difference is the COLLAPSE -- rows
    // that merged into a link, which is the migration working as designed, not data being dropped.
    // Reporting it as "skipped" would make every correct run look lossy. Skipped means exactly one
    // thing: a row that carried no entry key or no publication key and therefore cannot become a
    // link at all. Today that is expected to be zero.
    foreach ($rows as $row) {
        if (trim((string) ($row['entry_wiki_key'] ?? '')) === ''
            || trim((string) ($row['publication_wiki_key'] ?? '')) === '') {
            $stats['rows_skipped']++;
        }
    }

    // The catalogue rows for exactly the publications in this batch -- ONE query, not one per
    // link. At ~35.000 rows a per-link lookup would be the self-inflicted N+1 the lore catalogue
    // read already learned to avoid.
    $publicationKeys = array_values(array_unique(array_map(
        static fn(array $l): string => (string) $l['publication_wiki_key'],
        $links
    )));
    $catalogByKey = [];
    if ($publicationKeys !== []) {
        try {
            $catalogPlaceholders = implode(',', array_fill(0, count($publicationKeys), '?'));
            $catalog = $pdo->prepare(
                "SELECT wiki_key, title, source_type, chosen_url, has_link
                   FROM wiki_publication_catalog WHERE wiki_key IN ({$catalogPlaceholders})"
            );
            $catalog->execute($publicationKeys);
            foreach ($catalog->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $catalogByKey[(string) $row['wiki_key']] = $row;
            }
        } catch (Throwable) {
            // No WikiSync staging here -> every publication takes the URL-less route. Correct,
            // and self-healing once a dump has run (see avesmapsLoreSourceMigrationIdentity).
        }
    }

    $sourceIdCache = [];
    foreach ($links as $link) {
        $publicationKey = (string) $link['publication_wiki_key'];
        $identity = avesmapsLoreSourceMigrationIdentity(
            $publicationKey,
            (string) $link['publication_title'],
            $catalogByKey[$publicationKey] ?? null
        );

        if ($dryRun) {
            $stats['links_written']++;
            $sourceIdCache[$publicationKey] = true;
            continue;
        }

        if (!isset($sourceIdCache[$publicationKey])) {
            // A publication is an official source, and the catalogue owns its label -- the same
            // two decisions avesmapsPublicationDesiredLinksForEntity makes.
            $sourceIdCache[$publicationKey] = avesmapsFeatureSourceUpsert(
                $pdo,
                $identity['url'],
                $identity['label'],
                $identity['source_type'],
                true,
                $userId,
                $identity['wiki_key'],
                true
            );
        }
        $sourceId = (int) $sourceIdCache[$publicationKey];
        if ($sourceId <= 0) {
            // The catalogue upsert did not yield an id. Counted separately from rows_skipped: that
            // one is about unusable INPUT, this is a WRITE that did not land -- a different problem
            // with a different fix, and folding them together would hide it.
            $stats['links_failed']++;
            continue;
        }

        avesmapsFeatureSourceLink(
            $pdo,
            'lore',
            (string) $link['entry_wiki_key'],
            $sourceId,
            $userId,
            $link['origin'],
            $link['reference_kind'],
            $link['pages'],
            $link['note']
        );
        // A suppressed lore row must ARRIVE suppressed. avesmapsFeatureSourceLink never sets
        // status on a wiki-origin insert (it protects existing tombstones), so the tombstone is
        // stamped here -- guarded to origin='wiki_publication' so it can never touch handwork.
        if ($link['status'] === 'suppressed') {
            $pdo->prepare(
                "UPDATE feature_sources SET status = 'suppressed'
                  WHERE entity_type = 'lore' AND entity_public_id = :id AND source_id = :sid
                    AND origin = 'wiki_publication'"
            )->execute(['id' => (string) $link['entry_wiki_key'], 'sid' => $sourceId]);
        }
        $stats['links_written']++;
    }

    $stats['sources_touched'] = count($sourceIdCache);
    $stats['entries_processed'] = count($entries);
    $stats['nextCursor'] = (string) end($entries);
    $stats['done'] = count($entries) < AVESMAPS_LORE_SOURCE_MIGRATION_BATCH;

    return $stats;
}
