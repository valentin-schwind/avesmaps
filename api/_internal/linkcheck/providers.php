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
require_once __DIR__ . '/../app/citymaps.php';
require_once __DIR__ . '/../app/feature-sources.php';

// The registry doubles as the scope list: every key is something an editor surface can check on its own
// (see the per-editor "Links prüfen" buttons). The source catalogue is split by the entity type its
// links hang on, so the Siedlungseditor checks settlement sources and the Territoriumseditor territory
// sources -- one 2851-link run split into portions someone can actually sit through.
//
// region/path sources have no editor dialog of their own; they are covered by the unscoped CLI run
// (scripts/check-links.php --confirm). They are listed here anyway so the registry stays complete --
// otherwise their refs would be pruned as belonging to an unknown type.
function avesmapsLinkCheckProviders(): array
{
    return [
        'adventure' => 'avesmapsLinkCheckCollectAdventureLinks',
        'citymap' => 'avesmapsLinkCheckCollectCitymapLinks',
        'source_settlement' => 'avesmapsLinkCheckCollectSettlementSourceLinks',
        'source_territory' => 'avesmapsLinkCheckCollectTerritorySourceLinks',
        'source_region' => 'avesmapsLinkCheckCollectRegionSourceLinks',
        'source_path' => 'avesmapsLinkCheckCollectPathSourceLinks',
    ];
}

// Every shop/reference link of every approved adventure. Uses avesmapsAdventureLinks() -- the SAME
// function the public catalog renders from (Spec §2.5), so the checker can never end up probing a
// different set of URLs than the one the reader sees.
function avesmapsLinkCheckCollectAdventureLinks(PDO $pdo): array
{
    avesmapsAdventuresEnsureTables($pdo);
    $rows = $pdo->query(
        "SELECT id, public_id, title, wiki_url, link_ulisses, link_fshop, isbn
           FROM adventure WHERE status = 'approved'"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    // The curated "Weitere Links" (Spec §2.4) belong to the adventure just as much as its shop links, so
    // they are collected in the same pass -- one batch query, never per adventure. Skipping them here
    // would leave the reader looking at an "(noch nicht geprüft)" marker forever: the catalog renders
    // them, but nothing would ever register or probe them.
    $extraLinksByAdventure = avesmapsAdventureExtraLinksByAdventure(
        $pdo,
        array_map(static fn(array $r): int => (int) $r['id'], $rows)
    );

    $collected = [];
    foreach ($rows as $row) {
        foreach (avesmapsAdventureLinks($row, $extraLinksByAdventure[(int) $row['id']] ?? []) as $link) {
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

// The external map link of every approved citymap (Spec §3.1: "immer gespeichert, immer angezeigt").
// Uses avesmapsCitymapLinks() -- the SAME function the public catalog renders from -- so the checker can
// never end up probing a different set of URLs than the one the reader sees.
//
// A map's catalogue SOURCES (feature_sources, §3.2) are deliberately not collected here: they live in the
// shared `sources` table and are already covered per SOURCE by the source_* scopes, keyed by the
// catalogue id. Keying them by citymap public_id as well would produce one ref per citing map for a
// single URL -- exactly the fan-out those providers exist to avoid. (A dedicated 'source_citymap' scope
// would be the way to give the map editor its own source run; that is a registry change, not this one.)
function avesmapsLinkCheckCollectCitymapLinks(PDO $pdo): array
{
    avesmapsCitymapsEnsureTables($pdo);
    $rows = $pdo->query(
        "SELECT public_id, title, map_url FROM citymap WHERE status = 'approved'"
    )->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $collected = [];
    foreach ($rows as $row) {
        foreach (avesmapsCitymapLinks($row) as $link) {
            $collected[] = [
                'entity_public_id' => (string) $row['public_id'],
                'field' => (string) $link['key'],
                // The map's TITLE, not the link's label -- deliberately unlike the adventure provider
                // above. An adventure's links each carry a distinguishing label (Ulisses / F-Shop / Wiki /
                // DNB) worth recording; a citymap has exactly one link, so its label ("Karte") would say
                // nothing on every row, while the title is what a human scanning dead links needs.
                'label' => (string) $row['title'],
                'url' => (string) $link['url'],
                'url_hash' => (string) $link['url_hash'],
            ];
        }
    }
    return $collected;
}

// One thin provider per feature entity type -- the registry maps names to plain callables, so each scope
// gets its own function rather than a bound parameter.
function avesmapsLinkCheckCollectSettlementSourceLinks(PDO $pdo): array
{
    return avesmapsLinkCheckCollectSourceLinks($pdo, 'settlement');
}

function avesmapsLinkCheckCollectTerritorySourceLinks(PDO $pdo): array
{
    return avesmapsLinkCheckCollectSourceLinks($pdo, 'territory');
}

function avesmapsLinkCheckCollectRegionSourceLinks(PDO $pdo): array
{
    return avesmapsLinkCheckCollectSourceLinks($pdo, 'region');
}

function avesmapsLinkCheckCollectPathSourceLinks(PDO $pdo): array
{
    return avesmapsLinkCheckCollectSourceLinks($pdo, 'path');
}

// Every URL in the shared source catalogue attached to an approved feature_sources link OF ONE ENTITY
// TYPE. Suppressed links and orphaned catalogue rows are not the reader's problem, so we do not probe
// them.
//
// A source shared by a settlement AND a territory legitimately appears in both scopes: link_ref then
// holds two refs, but url_hash keeps link_status at ONE row, so it is still probed once. The ref is
// keyed by the catalogue id rather than by each citing element -- otherwise a publication cited by 300
// settlements would produce 300 refs for a single URL.
function avesmapsLinkCheckCollectSourceLinks(PDO $pdo, string $featureEntityType): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    // url = '' is the wiki-publication convention (those rows are hashed as 'wikipub:<wiki_key>' and
    // carry no reachable URL) -- there is nothing to probe, so they are skipped (Spec §1.6).
    $statement = $pdo->prepare(
        "SELECT DISTINCT s.id, s.url, s.label
           FROM sources s
           JOIN feature_sources fs ON fs.source_id = s.id AND fs.status = 'approved'
          WHERE s.url <> '' AND fs.entity_type = :type"
    );
    $statement->execute(['type' => $featureEntityType]);

    $collected = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $url = trim((string) $row['url']);
        if ($url === '') {
            continue;
        }
        $collected[] = [
            'entity_public_id' => (string) $row['id'],
            'field' => 'url', // a source row has exactly one URL
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
        // Refs of retired types can go in any pass -- nothing will ever re-stamp them.
        avesmapsLinkCheckDropUnknownTypeRefs($pdo, $types);
        // But NOT the orphan prune: a type not yet synced in this registry has no refs, so its links
        // would look orphaned and lose their probe history. Only a full pass (the CLI) may prune.
        $result['pruned'] = 0;
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
    // Orphan pruning must wait for the LAST provider: only once EVERY type has re-stamped its refs in
    // this pass does "no refs" really mean orphaned. This unscoped walk is the only path that earns it.
    if ($isLast) {
        avesmapsLinkCheckDropUnknownTypeRefs($pdo, $types);
    }
    $result['pruned'] = $isLast ? avesmapsLinkCheckPruneOrphans($pdo) : 0;
    $result['entity_type'] = $type;
    $result['done'] = $isLast;
    $result['cursor'] = $isLast ? '' : $types[$index + 1];
    return $result;
}
