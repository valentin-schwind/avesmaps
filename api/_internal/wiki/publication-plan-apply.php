<?php

declare(strict_types=1);

// The APPLY half of the publication-source sync: it works through the rows an editor ticked in the
// Übernahme-Vorschau and writes exactly those. Design:
// docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md §4/§7, session 2.
//
// 💣 IT WRITES BY CALLING THE UNCHANGED avesmapsPublicationReconcileEntity. Not a copy of it: the same
// override-safe, per-entity-transactional writer the sync has always used -- it writes and deletes ONLY
// approved origin='wiki_publication' rows, manual and community links win outright, suppressed
// tombstones stay suppressed. The only thing this change moves is WHO decides that it runs: the entity
// enumeration before, a tick now.
//
// It lives in its own file so the compute half can be shown not to reach a writer
// (__tests__/sync-plan-purity-test.php walks the call graph from avesmapsPublicationPlanStep).
//
// ⚠️ NO deletion branch. What the wiki stops citing is a CHILD row of a living settlement, region, path,
// territory or lore entry -- the entity itself never disappears on this path, so there is nothing for
// the third category to hold. The lost links ride in the entity's own row as a named loss
// ("Quellenverweise entfallen: 2"). Session-2 plan, Entscheidung 1.
//
// Side-effect-free on include: function definitions only. The endpoint loads the rest of the chain.
//
// 💣 The audit library is required HERE rather than assumed from the caller -- same decision, same
// reason as citymap-plan-apply.php: the audit writer swallows its own failures on purpose, so an
// assumed dependency would be an undefined function inside somebody's catch. Which is finding A16.
require_once __DIR__ . '/../map/collection-audit.php';

/**
 * ONE bounded apply step. Resumable: every handled row carries its apply_state, so the next call
 * simply picks up the ones that have none.
 *
 * 💣 NO try/catch AROUND THE ROW (finding A21) -- see citymap-plan-apply.php for the full argument.
 *
 * The budget is the publication reconcile's own (150), not the foundation's 40: this is the same work
 * per entity that this sync has always done per step, and an entity here is two SELECTs and a handful
 * of link writes rather than an image download.
 *
 * @param array<string,mixed>|null $user the editor, for the audit row (NULL = not a person)
 * @return array{done:bool, applied:int, deleted:int, stale:int, processed:int, remaining:int,
 *               skipped:int, declined:int}
 */
function avesmapsPublicationApplyStep(PDO $pdo, int $runId, int $userId, ?array $user, ?int $budget = null): array
{
    $budget = $budget ?? AVESMAPS_PUBLICATION_RECONCILE_STEP_BUDGET;
    @set_time_limit((int) AVESMAPS_WIKI_DUMP_STEP_SECONDS + 15);
    $deadline = microtime(true) + (float) max(1, AVESMAPS_WIKI_DUMP_STEP_SECONDS - 3);
    // ⚠️ DDL first and once, never inside the per-entity transactions below: MySQL commits an open
    // transaction implicitly when it sees DDL.
    avesmapsEnsurePublicationStagingTables($pdo);
    avesmapsEnsureFeatureSourceTables($pdo);
    avesmapsEnsureSyncPlanTables($pdo);

    $totals = ['applied' => 0, 'stale' => 0, 'processed' => 0];
    // The type-level gate, asked once per step and remembered: an unstaged type means "I know nothing",
    // never "the wiki dropped every source of this type".
    $stagingKnows = [];

    foreach (avesmapsSyncPlanPendingItems($pdo, $runId, $budget) as $row) {
        $totals['processed']++;
        $itemId = (int) $row['id'];
        $split = avesmapsPublicationPlanSplitEntityKey((string) $row['entity_key']);
        $publicId = (string) ($row['entity_public_id'] ?? '');

        if ($split === null || $publicId === '') {
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Die Zeile nennt keine auffindbare Einheit.');
            $totals['stale']++;
            continue;
        }

        [$type, $wikiKey] = $split;
        if (!array_key_exists($type, $stagingKnows)) {
            $stagingKnows[$type] = avesmapsPublicationStagingHasEntityType($pdo, $type);
        }

        if (!$stagingKnows[$type]) {
            // 🔴 THE GATE, ASKED A SECOND TIME. Between preview and Übernahme somebody can start a new
            // "Dump holen", which rebuilds the staging from scratch -- and an empty desired list reads
            // as "remove every wiki link". That is the 2026-07-22 near-miss (~34.800 lore links), and
            // the preview must not become the path on which it finally happens.
            avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Zwischenspeicher kennt diesen Typ gerade nicht.');
            $totals['stale']++;
        } else {
            // 💣 THE RE-CHECK (design §4a). Recomputed with the SAME function that built the row, so
            // "unchanged" really means unchanged. `name` is not part of the plan's after_json, so a
            // renamed entity does not make its row stale -- only its links do.
            $stored = json_decode((string) ($row['after_json'] ?? ''), true);
            $fresh = avesmapsPublicationPlanForEntity($pdo, $type, [
                'public_id' => $publicId,
                'wiki_key' => $wikiKey,
            ]);
            if (avesmapsSyncPlanIsStale(is_array($stored) ? $stored : null, $fresh['item']['after'] ?? null)) {
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'stale', 'Der Stand hat sich seit der Vorschau geaendert.');
                $totals['stale']++;
            } else {
                avesmapsPublicationReconcileEntity($pdo, $type, $publicId, $wikiKey, $userId);
                avesmapsSyncPlanMarkItem($pdo, $itemId, 'applied');
                $totals['applied']++;
            }
        }

        if (microtime(true) >= $deadline) {
            break;
        }
    }

    $remaining = avesmapsSyncPlanPendingCount($pdo, $runId);
    $done = $remaining === 0;
    $closing = ['skipped' => 0, 'declined' => 0];

    if ($done) {
        $closing = avesmapsPublicationApplyFinish($pdo, $runId, $userId, $user);
    }

    return [
        'done' => $done,
        'applied' => $totals['applied'],
        // Always 0: this sync deletes no entity. Kept in the envelope so every kind speaks one language.
        'deleted' => 0,
        'stale' => $totals['stale'],
        'processed' => $totals['processed'],
        'remaining' => $remaining,
        'skipped' => $closing['skipped'],
        'declined' => $closing['declined'],
    ];
}

/**
 * Everything that happens ONCE, after the last ticked row.
 *
 * @return array{skipped:int, declined:int}
 */
function avesmapsPublicationApplyFinish(PDO $pdo, int $runId, int $userId, ?array $user): array
{
    $planned = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    $run = avesmapsSyncPlanRunById($pdo, $runId);
    if ($run !== null) {
        $decoded = json_decode((string) ($run['counts_json'] ?? ''), true);
        if (is_array($decoded)) {
            $planned = array_merge($planned, $decoded);
        }
    }

    $stmt = $pdo->prepare('SELECT entity_key, change_type, selected, apply_state FROM sync_plan_item WHERE run_id = :r');
    $stmt->execute(['r' => $runId]);
    $skipped = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $key = (string) $row['entity_key'];
        $type = (string) $row['change_type'];
        $isSelected = (int) $row['selected'] === 1;
        $applied = (string) ($row['apply_state'] ?? '') === 'applied';

        if (!$isSelected && $type === 'changed') {
            avesmapsSyncPlanRecordSkip($pdo, 'publication', $key, $userId);
            $skipped++;
        } elseif ($applied && $type === 'changed') {
            avesmapsSyncPlanClearSkip($pdo, 'publication', $key);
        }
    }

    avesmapsSyncPlanMarkApplied($pdo, $runId, $userId);

    // The sources travel in the ETag-cached map-features payload, so the same global counter ordinary
    // editor edits use has to move -- otherwise warm-cache clients keep 304-ing the payload without the
    // publication sources. HERE, in the half that wrote something (the reconcile step bumps it for its
    // own door; this one is a second door and needs its own bump).
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        avesmapsWikiSyncNextMapRevision($pdo);
    }

    $countByState = static function (PDO $pdo, int $runId, string $state): int {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM sync_plan_item WHERE run_id = :r AND apply_state = :s');
        $stmt->execute(['r' => $runId, 's' => $state]);

        return (int) $stmt->fetchColumn();
    };

    avesmapsLogSyncPlanApply(
        $pdo,
        'publication',
        $planned,
        [
            'run_id' => $runId,
            'applied' => $countByState($pdo, $runId, 'applied'),
            'stale' => $countByState($pdo, $runId, 'stale'),
            'skipped' => $skipped,
            'declined' => 0,
            'deleted_titles' => [],
        ],
        $user
    );

    return ['skipped' => $skipped, 'declined' => 0];
}
