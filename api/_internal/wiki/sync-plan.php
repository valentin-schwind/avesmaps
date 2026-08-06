<?php

declare(strict_types=1);

// The Übernahme-Vorschau: every wiki sync first shows what it WOULD do, and only what an editor ticked
// gets written. Design: docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md, session 1.
//
// This file is the foundation and knows nothing about city maps, adventures or occurrences. It owns
// three tables and four rules; each sync brings its own compute half that fills sync_plan_item and its
// own apply half that reads it back.
//
//   sync_plan_run   one computed run per kind, superseded by the next one
//   sync_plan_item  one row per difference, with the tick that survives "Später"
//   sync_decision   🔴 THE ONLY DURABLE DECISION -- everything else is recomputed on every run
//
// 💣 THE DISTINCTION THIS WHOLE DESIGN TURNS ON (design §2). Declining a deletion is NOT the same as
// adopting the row:
//   "I edited it"            -> origin='manual'. It is ours, the sync is out entirely.
//   "I declined the deletion" -> only the deletion question is unsubscribed. It stays origin='wiki',
//                               keeps its wiki_key, and carries on being maintained. If the wiki
//                               article comes back, it rides along again without anybody doing a thing.
// Writing origin='manual' for a declined deletion would decide both at once, and in that moment a
// person is only thinking about the first one.

/** Highest number of rows ONE category shows in the preview (design §10.2, owner 2026-08-06). */
const AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT = 200;

/** Rows one bounded apply step works through. Same shape as the reconcile budget it replaces. */
const AVESMAPS_SYNC_PLAN_APPLY_BUDGET = 40;

/** The three categories, and there are exactly three -- they are the contract with the component. */
const AVESMAPS_SYNC_PLAN_CHANGE_TYPES = ['new', 'changed', 'deleted'];

// ===========================================================================
// 1. The pure rules
// ===========================================================================

/**
 * How a freshly computed row arrives pre-checked. PURE (design §2).
 *
 * 🔴 'deleted' is NEVER pre-checked, whatever happened before: a deletion has to be an act, not the
 * default that a tired click confirms. 'changed' drops out of the pre-check at the SECOND skip -- one
 * "not now" is a mood, two is an answer, and the row still appears (with its counter) so the decision
 * stays visible rather than silently permanent.
 */
function avesmapsSyncPlanDefaultSelected(string $changeType, int $skippedCount): int
{
    if ($changeType === 'deleted') {
        return 0;
    }
    if ($changeType === 'changed' && $skippedCount >= 2) {
        return 0;
    }

    return 1;
}

/**
 * The key one durable decision is stored under. PURE.
 *
 * 💣 change_type is part of it. The same entry can carry a declined deletion AND a skipped change;
 * one key for both would let the next skipped change reset the declined deletion, and the deletion
 * would be proposed all over again. The separator is a newline, which no wiki_key can contain
 * (they are built from single-line page titles).
 */
function avesmapsSyncPlanDecisionKey(string $entityKey, string $changeType): string
{
    return $entityKey . "\n" . $changeType;
}

/**
 * Has the world moved on since the plan was computed? PURE (design §4a).
 *
 * A stored plan is allowed to go stale -- that is the price of "Später" -- so every ticked row is
 * checked once more against a freshly computed one before it is written. What no longer matches is
 * left standing and named afterwards.
 *
 * 💣 Compared by KEY, not by the encoded JSON string: json_encode preserves insertion order, so two
 * runs that agree on every value but disagree on field order would look stale forever and nothing
 * would ever apply.
 *
 * ⚠️ null and '' are the SAME unknown here, exactly as avesmapsCitymapReconcilePlan defines it. A plan
 * that recorded null and now reads '' has not changed.
 *
 * @param array<string,mixed>|null $stored the after_json the plan was built with (null = a deletion row)
 * @param array<string,mixed>|null $fresh  the same computation, run again just now (null = nothing left to do)
 */
function avesmapsSyncPlanIsStale(?array $stored, ?array $fresh): bool
{
    if ($stored === null) {
        return false; // a deletion row carries no after_json; its freshness is checked differently
    }
    if ($fresh === null) {
        return true;  // nothing left to do: somebody else did it, or the wiki changed its mind
    }
    if (count($stored) !== count($fresh)) {
        return true;
    }
    foreach ($stored as $field => $value) {
        if (!array_key_exists($field, $fresh)) {
            return true;
        }
        if ((string) ($fresh[$field] ?? '') !== (string) ($value ?? '')) {
            return true;
        }
    }

    return false;
}

/**
 * The numbers behind the three category headings. PURE.
 *
 * An unknown change_type counts towards the total but invents no category: the three above are the
 * contract, and a fourth one appearing in the data is a bug to be seen, not a heading to be drawn.
 *
 * @param array<int, array<string,mixed>> $items
 * @return array{new:int, changed:int, deleted:int, total:int}
 */
function avesmapsSyncPlanCountsFromItems(array $items): array
{
    $counts = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    foreach ($items as $item) {
        $type = (string) ($item['change_type'] ?? '');
        if (isset($counts[$type]) && in_array($type, AVESMAPS_SYNC_PLAN_CHANGE_TYPES, true)) {
            $counts[$type]++;
        }
        $counts['total']++;
    }

    return $counts;
}

// ===========================================================================
// 2. Schema
// ===========================================================================

/**
 * Self-healing schema for the three tables.
 *
 * ⚠️ WRITE PATHS ONLY -- never call this from a read path. The preview's `get` tolerates a missing
 * table (SQLSTATE 42S02) and answers "no plan" instead. Same reasoning as the Änderungsverlauf
 * (AGENTS.md §11): DDL on a read path runs for every visitor and makes the file untestable without a
 * live database. And DDL commits an open transaction implicitly on MySQL, so it has to stay far away
 * from the apply step's writes.
 */
function avesmapsEnsureSyncPlanTables(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS sync_plan_run (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kind VARCHAR(24) NOT NULL,
            state VARCHAR(16) NOT NULL DEFAULT 'building',
            source_stamp VARCHAR(64) NULL,
            counts_json TEXT NULL,
            created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            created_by INT NULL,
            applied_at DATETIME(3) NULL,
            applied_by INT NULL,
            KEY idx_sync_plan_run_kind_state (kind, state, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // entity_public_id is 190, not 64: a lore key is a wiki article slug rather than a short public id,
    // which is exactly why feature_sources.entity_public_id had to be widened on 2026-07-22. This table
    // serves the same nine syncs, so it starts wide.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS sync_plan_item (
            id INT AUTO_INCREMENT PRIMARY KEY,
            run_id INT NOT NULL,
            entity_key VARCHAR(190) NOT NULL,
            entity_public_id VARCHAR(190) NULL,
            change_type VARCHAR(8) NOT NULL,
            label VARCHAR(300) NOT NULL,
            before_json TEXT NULL,
            after_json TEXT NULL,
            override_json TEXT NULL,
            selected TINYINT(1) NOT NULL DEFAULT 1,
            apply_state VARCHAR(12) NULL,
            apply_note VARCHAR(300) NULL,
            KEY idx_sync_plan_item_run (run_id, change_type, id),
            KEY idx_sync_plan_item_apply (run_id, selected, apply_state, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );

    // 🔴 The only durable decision. Never emptied automatically -- it IS the memory. Revocable through
    // "früher abgelehnte Löschungen anzeigen" in the preview, because a permanent decision nobody can
    // look at any more is a black hole.
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS sync_decision (
            kind VARCHAR(24) NOT NULL,
            entity_key VARCHAR(190) NOT NULL,
            change_type VARCHAR(8) NOT NULL,
            skipped_count INT NOT NULL DEFAULT 0,
            last_skipped_at DATETIME(3) NULL,
            last_skipped_by INT NULL,
            declined_at DATETIME(3) NULL,
            declined_by INT NULL,
            PRIMARY KEY (kind, entity_key, change_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

// ===========================================================================
// 3. The run
// ===========================================================================

/**
 * Open a fresh run and retire whatever was lying around for this kind (design §6).
 *
 * A second run replaces the open plan: the decisions in sync_decision survive, the ticks do not --
 * they belonged to numbers that no longer exist.
 */
function avesmapsSyncPlanStartRun(PDO $pdo, string $kind, int $userId, ?string $sourceStamp): int
{
    $pdo->prepare("UPDATE sync_plan_run SET state = 'superseded' WHERE kind = :k AND state IN ('building', 'open')")
        ->execute(['k' => $kind]);

    $pdo->prepare(
        "INSERT INTO sync_plan_run (kind, state, source_stamp, created_by)
         VALUES (:k, 'building', :st, :by)"
    )->execute(['k' => $kind, 'st' => $sourceStamp, 'by' => $userId > 0 ? $userId : null]);

    return (int) $pdo->lastInsertId();
}

/** The run currently being computed, or null. Server-derived -- a client never names a run id. */
function avesmapsSyncPlanBuildingRun(PDO $pdo, string $kind): ?array
{
    return avesmapsSyncPlanRunInState($pdo, $kind, 'building');
}

/** The finished run waiting to be applied, or null. */
function avesmapsSyncPlanOpenRun(PDO $pdo, string $kind): ?array
{
    return avesmapsSyncPlanRunInState($pdo, $kind, 'open');
}

function avesmapsSyncPlanRunInState(PDO $pdo, string $kind, string $state): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, kind, state, source_stamp, counts_json, created_at, created_by, applied_at, applied_by
           FROM sync_plan_run WHERE kind = :k AND state = :s ORDER BY id DESC LIMIT 1'
    );
    $stmt->execute(['k' => $kind, 's' => $state]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    return $row === false ? null : $row;
}

/** One row of the run by id, whatever its state (the apply step re-reads it to check it is still open). */
function avesmapsSyncPlanRunById(PDO $pdo, int $runId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, kind, state, source_stamp, counts_json, created_at, created_by, applied_at, applied_by
           FROM sync_plan_run WHERE id = :id LIMIT 1'
    );
    $stmt->execute(['id' => $runId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    return $row === false ? null : $row;
}

/**
 * Close the compute half: count what was written and open the plan for the editor.
 *
 * @return array{new:int, changed:int, deleted:int, total:int}
 */
function avesmapsSyncPlanFinishBuild(PDO $pdo, int $runId): array
{
    $counts = ['new' => 0, 'changed' => 0, 'deleted' => 0, 'total' => 0];
    $stmt = $pdo->prepare('SELECT change_type, COUNT(*) AS n FROM sync_plan_item WHERE run_id = :r GROUP BY change_type');
    $stmt->execute(['r' => $runId]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $type = (string) $row['change_type'];
        $n = (int) $row['n'];
        if (isset($counts[$type]) && in_array($type, AVESMAPS_SYNC_PLAN_CHANGE_TYPES, true)) {
            $counts[$type] = $n;
        }
        $counts['total'] += $n;
    }

    $pdo->prepare("UPDATE sync_plan_run SET state = 'open', counts_json = :c WHERE id = :id AND state = 'building'")
        ->execute(['c' => json_encode($counts, JSON_UNESCAPED_UNICODE), 'id' => $runId]);

    return $counts;
}

/** Mark the run done. Called once, by the apply half, after the last ticked row. */
function avesmapsSyncPlanMarkApplied(PDO $pdo, int $runId, int $userId): void
{
    $pdo->prepare(
        "UPDATE sync_plan_run SET state = 'applied', applied_at = UTC_TIMESTAMP(3), applied_by = :by
          WHERE id = :id AND state = 'open'"
    )->execute(['by' => $userId > 0 ? $userId : null, 'id' => $runId]);
}

// ===========================================================================
// 4. The rows
// ===========================================================================

/**
 * Write ONE computed difference.
 *
 * @param array{entity_key:string, entity_public_id?:?string, change_type:string, label:string,
 *              before?:array<string,mixed>, after?:array<string,mixed>, override?:array<string,mixed>,
 *              selected:int} $item
 */
function avesmapsSyncPlanAddItem(PDO $pdo, int $runId, array $item): void
{
    $encode = static function (array $value): ?string {
        // An empty set is stored as NULL rather than "[]", so a deletion row and an empty change row
        // are told apart by the column itself (avesmapsSyncPlanIsStale reads NULL as "not applicable").
        return $value === [] ? null : json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    };

    $pdo->prepare(
        'INSERT INTO sync_plan_item (run_id, entity_key, entity_public_id, change_type, label,
                                     before_json, after_json, override_json, selected)
         VALUES (:r, :ek, :pid, :ct, :label, :before, :after, :override, :sel)'
    )->execute([
        'r' => $runId,
        'ek' => mb_substr((string) $item['entity_key'], 0, 190, 'UTF-8'),
        'pid' => ($item['entity_public_id'] ?? null) === null ? null : mb_substr((string) $item['entity_public_id'], 0, 190, 'UTF-8'),
        'ct' => (string) $item['change_type'],
        'label' => mb_substr((string) $item['label'], 0, 300, 'UTF-8'),
        'before' => $encode((array) ($item['before'] ?? [])),
        'after' => $encode((array) ($item['after'] ?? [])),
        'override' => $encode((array) ($item['override'] ?? [])),
        'sel' => (int) $item['selected'],
    ]);
}

/**
 * The rows of one category for the preview, capped (design §10.2).
 *
 * ⚠️ The cap is on what is SHOWN, never on what exists: the hidden rows keep their tick in the
 * database, so "alle übernehmen" reaches them too. The caller reports the real number from
 * counts_json, so the list can say that it is short.
 *
 * The decision (skip counter / decline) rides along per row so the component can render the
 * "⤴ 3× übersprungen" tag without a second request.
 *
 * @return array<int, array<string,mixed>>
 */
function avesmapsSyncPlanItems(PDO $pdo, int $runId, string $kind, string $changeType, int $limit): array
{
    $stmt = $pdo->prepare(
        'SELECT i.id, i.entity_key, i.entity_public_id, i.change_type, i.label, i.before_json,
                i.after_json, i.override_json, i.selected, i.apply_state, i.apply_note,
                d.skipped_count, d.last_skipped_at
           FROM sync_plan_item i
           LEFT JOIN sync_decision d
             ON d.kind = :k AND d.entity_key = i.entity_key AND d.change_type = i.change_type
          WHERE i.run_id = :r AND i.change_type = :ct
          ORDER BY i.id ASC LIMIT :lim'
    );
    $stmt->bindValue(':k', $kind, PDO::PARAM_STR);
    $stmt->bindValue(':r', $runId, PDO::PARAM_INT);
    $stmt->bindValue(':ct', $changeType, PDO::PARAM_STR);
    $stmt->bindValue(':lim', max(1, $limit), PDO::PARAM_INT);
    $stmt->execute();

    return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

/**
 * Tick or untick rows. Either a list of ids, or a whole category ("alle" / "keine" per group).
 *
 * Only while the run is open: once it is applied, its ticks are history, not a control.
 */
function avesmapsSyncPlanSetSelection(PDO $pdo, int $runId, ?array $ids, ?string $changeType, int $selected): int
{
    if ($ids !== null) {
        $clean = [];
        foreach ($ids as $id) {
            $value = (int) $id;
            if ($value > 0) {
                $clean[] = $value;
            }
        }
        if ($clean === []) {
            return 0;
        }
        $placeholders = implode(',', array_fill(0, count($clean), '?'));
        $stmt = $pdo->prepare(
            'UPDATE sync_plan_item SET selected = ? WHERE run_id = ? AND apply_state IS NULL AND id IN (' . $placeholders . ')'
        );
        $stmt->execute(array_merge([$selected, $runId], $clean));

        return $stmt->rowCount();
    }

    if ($changeType === null || !in_array($changeType, AVESMAPS_SYNC_PLAN_CHANGE_TYPES, true)) {
        return 0;
    }
    $stmt = $pdo->prepare(
        'UPDATE sync_plan_item SET selected = :sel WHERE run_id = :r AND change_type = :ct AND apply_state IS NULL'
    );
    $stmt->execute(['sel' => $selected, 'r' => $runId, 'ct' => $changeType]);

    return $stmt->rowCount();
}

/** Are there ticked deletions in this run? The server-side half of the second confirmation. */
function avesmapsSyncPlanSelectedDeletionCount(PDO $pdo, int $runId): int
{
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) FROM sync_plan_item
          WHERE run_id = :r AND change_type = 'deleted' AND selected = 1 AND apply_state IS NULL"
    );
    $stmt->execute(['r' => $runId]);

    return (int) $stmt->fetchColumn();
}

/** The next bounded batch of ticked, not-yet-handled rows. */
function avesmapsSyncPlanPendingItems(PDO $pdo, int $runId, int $limit): array
{
    $stmt = $pdo->prepare(
        'SELECT id, entity_key, entity_public_id, change_type, label, before_json, after_json
           FROM sync_plan_item
          WHERE run_id = :r AND selected = 1 AND apply_state IS NULL
          ORDER BY id ASC LIMIT :lim'
    );
    $stmt->bindValue(':r', $runId, PDO::PARAM_INT);
    $stmt->bindValue(':lim', max(1, $limit), PDO::PARAM_INT);
    $stmt->execute();

    return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function avesmapsSyncPlanMarkItem(PDO $pdo, int $itemId, string $applyState, string $note = ''): void
{
    $pdo->prepare('UPDATE sync_plan_item SET apply_state = :s, apply_note = :n WHERE id = :id')
        ->execute([
            's' => $applyState,
            'n' => $note === '' ? null : mb_substr($note, 0, 300, 'UTF-8'),
            'id' => $itemId,
        ]);
}

// ===========================================================================
// 5. The decisions
// ===========================================================================

/**
 * Every durable decision for one kind, keyed by avesmapsSyncPlanDecisionKey.
 *
 * ONE query for the whole table, never one per row: this is read while walking thousands of catalog
 * rows, and a per-row lookup is exactly the loop STRATO cannot take (AGENTS.md §10).
 *
 * @return array<string, array{skipped_count:int, last_skipped_at:?string, declined_at:?string}>
 */
function avesmapsSyncPlanDecisions(PDO $pdo, string $kind): array
{
    $stmt = $pdo->prepare(
        'SELECT entity_key, change_type, skipped_count, last_skipped_at, declined_at
           FROM sync_decision WHERE kind = :k'
    );
    $stmt->execute(['k' => $kind]);

    $decisions = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $decisions[avesmapsSyncPlanDecisionKey((string) $row['entity_key'], (string) $row['change_type'])] = [
            'skipped_count' => (int) $row['skipped_count'],
            'last_skipped_at' => $row['last_skipped_at'] === null ? null : (string) $row['last_skipped_at'],
            'declined_at' => $row['declined_at'] === null ? null : (string) $row['declined_at'],
        ];
    }

    return $decisions;
}

/** The wiki keys whose deletion an editor has declined. The compute half never proposes them again. */
function avesmapsSyncPlanDeclinedKeys(PDO $pdo, string $kind): array
{
    $stmt = $pdo->prepare(
        "SELECT entity_key FROM sync_decision
          WHERE kind = :k AND change_type = 'deleted' AND declined_at IS NOT NULL"
    );
    $stmt->execute(['k' => $kind]);

    return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN) ?: []);
}

/** "Not now", counted. The row comes back next run, with its counter shown. */
function avesmapsSyncPlanRecordSkip(PDO $pdo, string $kind, string $entityKey, int $userId): void
{
    $pdo->prepare(
        "INSERT INTO sync_decision (kind, entity_key, change_type, skipped_count, last_skipped_at, last_skipped_by)
         VALUES (:k, :ek, 'changed', 1, UTC_TIMESTAMP(3), :by)
         ON DUPLICATE KEY UPDATE skipped_count = skipped_count + 1,
                                 last_skipped_at = UTC_TIMESTAMP(3), last_skipped_by = VALUES(last_skipped_by)"
    )->execute(['k' => $kind, 'ek' => $entityKey, 'by' => $userId > 0 ? $userId : null]);
}

/**
 * "Keep it", permanently. The deletion is never proposed again -- but the row stays a WIKI row
 * (design §2), so everything else about it carries on being maintained.
 */
function avesmapsSyncPlanRecordDecline(PDO $pdo, string $kind, string $entityKey, int $userId): void
{
    $pdo->prepare(
        "INSERT INTO sync_decision (kind, entity_key, change_type, declined_at, declined_by)
         VALUES (:k, :ek, 'deleted', UTC_TIMESTAMP(3), :by)
         ON DUPLICATE KEY UPDATE declined_at = UTC_TIMESTAMP(3), declined_by = VALUES(declined_by)"
    )->execute(['k' => $kind, 'ek' => $entityKey, 'by' => $userId > 0 ? $userId : null]);
}

/**
 * Forget the skip counter of a change that has now been applied.
 *
 * ⚠️ Without this the tag lies: a row skipped three times and then taken would keep telling the next
 * editor "3× übersprungen" about a change that no longer exists.
 */
function avesmapsSyncPlanClearSkip(PDO $pdo, string $kind, string $entityKey): void
{
    $pdo->prepare("DELETE FROM sync_decision WHERE kind = :k AND entity_key = :ek AND change_type = 'changed'")
        ->execute(['k' => $kind, 'ek' => $entityKey]);
}

/** The declined deletions, so the preview can show them. Never a black hole (design §5). */
function avesmapsSyncPlanDeclinedList(PDO $pdo, string $kind, int $limit): array
{
    $stmt = $pdo->prepare(
        "SELECT entity_key, declined_at FROM sync_decision
          WHERE kind = :k AND change_type = 'deleted' AND declined_at IS NOT NULL
          ORDER BY declined_at DESC LIMIT :lim"
    );
    $stmt->bindValue(':k', $kind, PDO::PARAM_STR);
    $stmt->bindValue(':lim', max(1, $limit), PDO::PARAM_INT);
    $stmt->execute();

    return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

/** Take a decline back: the deletion will be proposed again on the next run. */
function avesmapsSyncPlanUndecline(PDO $pdo, string $kind, array $entityKeys): int
{
    $clean = [];
    foreach ($entityKeys as $key) {
        $value = trim((string) $key);
        if ($value !== '') {
            $clean[] = $value;
        }
    }
    if ($clean === []) {
        return 0;
    }
    $placeholders = implode(',', array_fill(0, count($clean), '?'));
    $stmt = $pdo->prepare(
        "DELETE FROM sync_decision WHERE kind = ? AND change_type = 'deleted' AND entity_key IN (" . $placeholders . ')'
    );
    $stmt->execute(array_merge([$kind], $clean));

    return $stmt->rowCount();
}
