<?php

declare(strict_types=1);

// Linkchecker: the provider registry (Spec §1.6). This is the ONLY place the linkchecker learns that
// adventures or maps exist -- store.php/probe.php/state.php stay entity-agnostic. Adding a new linked
// entity means adding one collector here and one line to the registry; nothing else changes.
//
// Each collector returns [['entity_public_id' => …, 'field' => …, 'label' => …, 'url' => …], …]
// (optionally with a precomputed 'url_hash'). The sync writes those into link_ref, per entity type.

require_once __DIR__ . '/store.php';
require_once __DIR__ . '/../app/adventures.php';
require_once __DIR__ . '/../app/feature-sources.php';

function avesmapsLinkCheckProviders(): array
{
    return [
        'adventure' => 'avesmapsLinkCheckCollectAdventureLinks',
        'citymap' => 'avesmapsLinkCheckCollectCitymapLinks',
        'source' => 'avesmapsLinkCheckCollectSourceLinks',
    ];
}

// Every shop/reference link of every approved adventure. Uses avesmapsAdventureLinks() -- the SAME
// function the public catalog renders from (Spec §2.5), so the checker can never end up probing a
// different set of URLs than the one the reader sees.
function avesmapsLinkCheckCollectAdventureLinks(PDO $pdo): array
{
    avesmapsAdventuresEnsureTables($pdo);
    $rows = $pdo->query(
        "SELECT public_id, title, wiki_url, link_ulisses, link_fshop, isbn
           FROM adventure WHERE status = 'approved'"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $collected = [];
    foreach ($rows as $row) {
        // Phase A has no adventure_link table yet (that ships with Spec §2.4, task B); until then every
        // adventure simply has no extra links. The call site already passes them, so B only has to fill
        // this array -- no signature change here.
        foreach (avesmapsAdventureLinks($row, []) as $link) {
            $collected[] = [
                'entity_public_id' => (string) $row['public_id'],
                'field' => (string) $link['key'],
                'label' => (string) $link['label'],
                'url' => (string) $link['url'],
                'url_hash' => (string) $link['url_hash'],
            ];
        }
    }
    return $collected;
}

// Placeholder until Spec §3 (Kartensammlung) ships the citymap table in phase 3. Returning [] is a
// complete, correct implementation of "no maps exist yet": the sync writes no refs for this type and
// deletes none, so wiring it into the registry now costs nothing and phase 3 only fills in the body.
function avesmapsLinkCheckCollectCitymapLinks(PDO $pdo): array
{
    return [];
}

// Every URL in the shared source catalog that is actually attached to something (an approved
// feature_sources link). Suppressed links and orphaned catalog rows are not the reader's problem, so we
// do not probe them.
function avesmapsLinkCheckCollectSourceLinks(PDO $pdo): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    // url = '' is the wiki-publication convention (those rows are hashed as 'wikipub:<wiki_key>' and
    // carry no reachable URL) -- there is nothing to probe, so they are skipped (Spec §1.6).
    $rows = $pdo->query(
        "SELECT DISTINCT s.id, s.url, s.label
           FROM sources s
           JOIN feature_sources fs ON fs.source_id = s.id AND fs.status = 'approved'
          WHERE s.url <> ''"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $collected = [];
    foreach ($rows as $row) {
        $url = trim((string) $row['url']);
        if ($url === '') {
            continue;
        }
        // A source is identified by its own catalog id: the same source is shared by many entities, so
        // the ref belongs to the source, not to each element that cites it (that would be N duplicates
        // of one URL). field stays 'url' -- a source row has exactly one.
        $collected[] = [
            'entity_public_id' => (string) $row['id'],
            'field' => 'url',
            'label' => (string) ($row['label'] ?? ''),
            'url' => $url,
        ];
    }
    return $collected;
}

// Run ONE provider (Spec §1.7 `sync`: bounded, done-flag). $cursor is the entity type to process next;
// '' starts at the first. Returns the per-type counters plus the next cursor and done.
//
// Bounded per provider rather than per row: a sync does no HTTP at all (it only reads the DB and upserts
// the registry), so one entity type per request is a comfortable unit of work -- and it keeps the stale
// cleanup correct without any cross-request state, because each type only ever prunes its own refs.
// $entityType scopes the pass to ONE provider and finishes in a single step -- that is what the per-tab
// "Links prüfen" buttons use, so the Abenteuer tab never syncs (or waits for) maps and sources.
// '' walks the whole registry via the cursor (the CLI).
function avesmapsLinkCheckSyncStep(PDO $pdo, string $cursor = '', string $entityType = ''): array
{
    $providers = avesmapsLinkCheckProviders();
    $types = array_keys($providers);

    if ($entityType !== '') {
        if (!isset($providers[$entityType])) {
            throw new InvalidArgumentException('Unbekannter entity_type: ' . $entityType);
        }
        $collector = $providers[$entityType];
        $result = avesmapsLinkCheckSyncEntityType($pdo, $entityType, $collector($pdo));
        // Pruning is safe even in a scoped pass: it only deletes link_status rows that NO type
        // references any more, and the other types' refs are still in place from their own last sync.
        $result['pruned'] = avesmapsLinkCheckPruneOrphans($pdo);
        $result['entity_type'] = $entityType;
        $result['done'] = true;
        $result['cursor'] = '';
        return $result;
    }

    $index = 0;
    if ($cursor !== '') {
        $found = array_search($cursor, $types, true);
        // An unknown cursor means the registry changed under a running loop -> start over rather than
        // silently skipping every provider.
        $index = $found === false ? 0 : (int) $found;
    }

    $type = $types[$index] ?? null;
    if ($type === null) {
        return ['done' => true, 'cursor' => '', 'entity_type' => '', 'seen' => 0, 'created' => 0, 'removed' => 0, 'pruned' => 0];
    }

    $collector = $providers[$type];
    $result = avesmapsLinkCheckSyncEntityType($pdo, $type, $collector($pdo));

    $isLast = $index >= count($types) - 1;
    // Orphan pruning must wait for the LAST provider: a link_status row may be referenced by a type that
    // has not been re-synced yet in this pass.
    $result['pruned'] = $isLast ? avesmapsLinkCheckPruneOrphans($pdo) : 0;
    $result['entity_type'] = $type;
    $result['done'] = $isLast;
    $result['cursor'] = $isLast ? '' : $types[$index + 1];
    return $result;
}
