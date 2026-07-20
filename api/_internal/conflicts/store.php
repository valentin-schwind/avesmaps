<?php

declare(strict_types=1);

/**
 * Conflict centre -- decision store.
 * =========================================================================
 * The ONE table this feature adds. Conflicts themselves are never stored: they are recomputed from
 * the current data on every run (docs/konfliktmanagement-design.md §2), so a repaired conflict
 * disappears by itself and a new one shows up without a sync. Only the human DECISION is durable.
 *
 * Identity is (rule_id, fingerprint) -- NOT (rule_id, object). A conflict can have parties of
 * different types (a place and a territory claiming one wiki article), so no single object owns it.
 * subject_* is a lookup index ("what hangs on this place?"), acted_* records where the decision
 * actually wrote, which for a wrong capital may be either side.
 *
 * The fingerprint covers the parties AND the facts, so when the underlying situation changes the
 * stored decision stops matching and the case correctly returns as open -- the generalisation of
 * the course_hash trick in wiki_path_verlauf_case_status.
 */

require_once __DIR__ . '/core.php';

function avesmapsConflictEnsureSchema(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS conflict_decision (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            rule_id VARCHAR(80) NOT NULL,
            fingerprint CHAR(64) NOT NULL,
            decision VARCHAR(20) NOT NULL,
            subject_type VARCHAR(30) NOT NULL DEFAULT '',
            subject_id VARCHAR(64) NOT NULL DEFAULT '',
            acted_type VARCHAR(30) NULL,
            acted_id VARCHAR(64) NULL,
            note VARCHAR(500) NULL,
            detail_json JSON NULL,
            reviewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            reviewed_by BIGINT UNSIGNED NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_conflict_decision (rule_id, fingerprint),
            KEY idx_conflict_decision_subject (subject_type, subject_id),
            KEY idx_conflict_decision_rule (rule_id, decision)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

/**
 * All stored decisions, keyed "<rule_id>|<fingerprint>" so the detector output can be joined in
 * memory. The set is small by construction (one row per decided conflict), so it is read whole.
 *
 * @return array<string, array<string, mixed>>
 */
function avesmapsConflictReadDecisions(PDO $pdo): array {
    avesmapsConflictEnsureSchema($pdo);
    $statement = $pdo->query(
        'SELECT rule_id, fingerprint, decision, acted_type, acted_id, note, reviewed_at, reviewed_by
         FROM conflict_decision'
    );
    if ($statement === false) {
        return [];
    }

    $decisions = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $key = (string) $row['rule_id'] . '|' . (string) $row['fingerprint'];
        $decisions[$key] = $row;
    }

    return $decisions;
}

/**
 * Join detector output with stored decisions and derive the status of each conflict (§5a).
 * Conflicts the detector still finds keep their decision; a decision whose fingerprint no longer
 * appears means the situation is gone -> the case is reported as "done" (history), which is the
 * only way an already-repaired conflict stays visible at all.
 *
 * @param list<array<string,mixed>> $conflicts  fresh from the rules
 * @param array<string, array<string,mixed>> $decisions  from avesmapsConflictReadDecisions()
 * @return list<array<string,mixed>>
 */
function avesmapsConflictApplyDecisions(array $conflicts, array $decisions): array {
    $out = [];
    $seen = [];

    foreach ($conflicts as $conflict) {
        $key = (string) ($conflict['rule_id'] ?? '') . '|' . (string) ($conflict['fingerprint'] ?? '');
        $seen[$key] = true;
        $decision = $decisions[$key] ?? null;
        $conflict['decision'] = $decision['decision'] ?? null;
        $conflict['status'] = avesmapsConflictStatus(true, $conflict['decision']);
        $conflict['reviewed_at'] = $decision['reviewed_at'] ?? null;
        $conflict['reviewed_by'] = $decision['reviewed_by'] ?? null;
        $conflict['note'] = $decision['note'] ?? null;
        $out[] = $conflict;
    }

    // Decided cases the detector no longer finds = the data was repaired. They stay as history.
    foreach ($decisions as $key => $decision) {
        if (isset($seen[$key])) {
            continue;
        }
        [$ruleId] = explode('|', $key, 2);
        $out[] = [
            'rule_id' => $ruleId,
            'fingerprint' => (string) $decision['fingerprint'],
            'parties' => [],
            'severity' => AVESMAPS_CONFLICT_UNVERIFIED,
            'title' => '',
            'decision' => (string) $decision['decision'],
            'status' => avesmapsConflictStatus(false, (string) $decision['decision']),
            'reviewed_at' => $decision['reviewed_at'] ?? null,
            'reviewed_by' => $decision['reviewed_by'] ?? null,
            'note' => $decision['note'] ?? null,
        ];
    }

    return $out;
}

/**
 * Record (or overwrite) one decision. Idempotent by (rule_id, fingerprint).
 *
 * Deliberately does NOT touch feature data -- writing the actual fix is the rule's business, and
 * P1 only records the verdict. That keeps the store honest: it never claims something was repaired
 * that wasn't. `acted_*` is filled by the caller once a rule can apply its own fix.
 */
function avesmapsConflictRecordDecision(PDO $pdo, array $input, int $userId = 0): array {
    avesmapsConflictEnsureSchema($pdo);

    $ruleId = trim((string) ($input['rule_id'] ?? ''));
    $fingerprint = trim((string) ($input['fingerprint'] ?? ''));
    $decision = trim((string) ($input['decision'] ?? ''));
    if ($ruleId === '' || $fingerprint === '') {
        throw new RuntimeException('rule_id/fingerprint fehlt.');
    }
    if (!in_array($decision, AVESMAPS_CONFLICT_DECISIONS, true)) {
        throw new RuntimeException('Unbekannte Entscheidung.');
    }
    if (!preg_match('/^[a-f0-9]{64}$/', $fingerprint)) {
        throw new RuntimeException('Ungueltiger Fingerabdruck.');
    }

    $statement = $pdo->prepare(
        'INSERT INTO conflict_decision
            (rule_id, fingerprint, decision, subject_type, subject_id, acted_type, acted_id, note, reviewed_at, reviewed_by)
         VALUES (:rule_id, :fingerprint, :decision, :subject_type, :subject_id, :acted_type, :acted_id, :note, CURRENT_TIMESTAMP(3), :reviewed_by)
         ON DUPLICATE KEY UPDATE
            decision = VALUES(decision),
            acted_type = VALUES(acted_type),
            acted_id = VALUES(acted_id),
            note = VALUES(note),
            reviewed_at = CURRENT_TIMESTAMP(3),
            reviewed_by = VALUES(reviewed_by)'
    );
    $statement->execute([
        'rule_id' => $ruleId,
        'fingerprint' => $fingerprint,
        'decision' => $decision,
        'subject_type' => mb_substr(trim((string) ($input['subject_type'] ?? '')), 0, 30, 'UTF-8'),
        'subject_id' => mb_substr(trim((string) ($input['subject_id'] ?? '')), 0, 64, 'UTF-8'),
        'acted_type' => ($input['acted_type'] ?? null) !== null ? mb_substr(trim((string) $input['acted_type']), 0, 30, 'UTF-8') : null,
        'acted_id' => ($input['acted_id'] ?? null) !== null ? mb_substr(trim((string) $input['acted_id']), 0, 64, 'UTF-8') : null,
        'note' => ($input['note'] ?? null) !== null ? mb_substr(trim((string) $input['note']), 0, 500, 'UTF-8') : null,
        'reviewed_by' => $userId > 0 ? $userId : null,
    ]);

    return ['ok' => true, 'rule_id' => $ruleId, 'fingerprint' => $fingerprint, 'decision' => $decision];
}

/**
 * Undo: drop the decision so the conflict returns to "open" (the reopen_case equivalent).
 */
function avesmapsConflictClearDecision(PDO $pdo, string $ruleId, string $fingerprint): array {
    avesmapsConflictEnsureSchema($pdo);
    $statement = $pdo->prepare('DELETE FROM conflict_decision WHERE rule_id = :r AND fingerprint = :f');
    $statement->execute(['r' => trim($ruleId), 'f' => trim($fingerprint)]);

    return ['ok' => true, 'removed' => $statement->rowCount()];
}
