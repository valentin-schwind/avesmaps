<?php

declare(strict_types=1);

// Conflict centre editor surface (docs/konfliktmanagement-design.md, P1). Capability-gated; the
// dispatcher stays thin -- all logic lives in api/_internal/conflicts/.
//
// Conflicts are COMPUTED, never stored (§2): "list" re-detects from the current data and joins the
// stored decisions in. Only the decision is durable, so a repaired conflict disappears by itself
// and one whose facts changed reopens by itself (the fingerprint stops matching).
//
// POST /api/edit/map/conflicts.php {action:"list"}
//     -> { ok, rules:[…], conflicts:[…], summary:{ by_severity, by_status, by_type } }
// POST … {action:"decide", rule_id, fingerprint, decision:"resolved"|"deferred"|"ignored", note?}
//     -> { ok, rule_id, fingerprint, decision }
// POST … {action:"reopen", rule_id, fingerprint}   -> { ok, removed }
//
// The full scan is a table walk over map_features and reads a JSON path that carries no index
// (§3), so it is deliberately an editor-triggered action with progress in its own button -- never
// something that runs on dialog open, and never in a loop (AGENTS.md §9, STRATO).

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/conflicts/rules.php';
require_once __DIR__ . '/../../_internal/conflicts/store.php';
require_once __DIR__ . '/../../_internal/conflicts/repair.php';
require_once __DIR__ . '/../../_internal/wiki/dump-report.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Konflikte nicht lesen.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    // The scan walks every active map feature; holding the session lock for it would freeze the rest
    // of the editor for this user (same reasoning as link-check.php).
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    $payload = avesmapsReadJsonRequest();
    // Stored WITH the decision: a repaired case has no object left to look a name up from.
    $userName = trim((string) ($user['username'] ?? $user['name'] ?? ''));
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'list'), 40);
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($action === 'decide') {
        $result = avesmapsConflictRecordDecision($pdo, $payload, (int) ($user['id'] ?? 0), $userName);
        avesmapsJsonResponse(200, $result);
    }

    // The repairing verb. Writes real map data (revision + audit log), then records the decision so
    // the case shows as handled instead of silently vanishing on the next scan.
    if ($action === 'resolve') {
        $result = avesmapsConflictResolve($pdo, $payload, (int) ($user['id'] ?? 0));
        if (($payload['rule_id'] ?? '') !== '' && ($payload['fingerprint'] ?? '') !== '') {
            avesmapsConflictRecordDecision($pdo, [
                'rule_id' => $payload['rule_id'],
                'fingerprint' => $payload['fingerprint'],
                'decision' => 'resolved',
                'subject_type' => $payload['subject_type'] ?? '',
                'subject_id' => $payload['subject_id'] ?? '',
                'acted_type' => $payload['acted_type'] ?? null,
                'acted_id' => $payload['acted_id'] ?? null,
                'title' => $payload['title'] ?? '',
                'wiki_url' => $payload['wiki_url'] ?? '',
                'severity' => $payload['severity'] ?? '',
                'parties' => $payload['parties'] ?? [],
            ], (int) ($user['id'] ?? 0), $userName);
        }
        avesmapsJsonResponse(200, $result);
    }

    if ($action === 'reopen') {
        $result = avesmapsConflictClearDecision(
            $pdo,
            (string) ($payload['rule_id'] ?? ''),
            (string) ($payload['fingerprint'] ?? '')
        );
        avesmapsJsonResponse(200, $result);
    }

    if ($action !== 'list' && $action !== '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Aktion: ' . $action);
    }

    $conflicts = avesmapsConflictApplyDecisions(
        avesmapsConflictDetectAll($pdo),
        avesmapsConflictReadDecisions($pdo)
    );

    // Sprechbare Fallnummer, zentral vergeben statt in jeder Regel -- so kann keine sie vergessen,
    // und sie ist garantiert nach demselben Verfahren gebildet. Abgeleitet aus dem Fingerabdruck,
    // also ohne eigene Tabelle stabil.
    foreach ($conflicts as $index => $conflict) {
        $conflicts[$index]['short_id'] = avesmapsConflictShortId((string) ($conflict['fingerprint'] ?? ''));
    }

    // Summary counters. Computed here so the client never has to re-derive them and the two cannot
    // drift apart -- the filter rail and the pills must agree.
    $bySeverity = [];
    $byStatus = [];
    $byType = [];
    foreach ($conflicts as $conflict) {
        $severity = (string) ($conflict['severity'] ?? '');
        $status = (string) ($conflict['status'] ?? '');
        $bySeverity[$severity] = ($bySeverity[$severity] ?? 0) + 1;
        $byStatus[$status] = ($byStatus[$status] ?? 0) + 1;
        // A conflict counts under EVERY party type: a place-and-territory case appears under both
        // (§4.3). Counting only the subject would hide it from one of the two filters.
        $seenTypes = [];
        foreach (($conflict['parties'] ?? []) as $party) {
            $type = (string) ($party['type'] ?? '');
            if ($type === '' || isset($seenTypes[$type])) {
                continue;
            }
            $seenTypes[$type] = true;
            $byType[$type] = ($byType[$type] ?? 0) + 1;
        }
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'rules' => avesmapsConflictRuleCatalog(),
        // The last dump run's report -- its OWN top-level key, deliberately NOT an entry in
        // `conflicts`. A report is a snapshot of a moment; a conflict is computed fresh every
        // time and disappears by itself once repaired. Mixing them would break that invariant
        // AND poison `summary` (total / by_severity / by_status / by_type all count over
        // `conflicts`), so a protocol row would inflate the very numbers the filter rail shows.
        // null when no run has been reported yet -- the client renders "kein Bericht vorhanden".
        'dump_report' => avesmapsDumpReportLatest($pdo),
        'type_labels' => AVESMAPS_CONFLICT_TYPE_LABELS,
        'conflicts' => $conflicts,
        'summary' => [
            'total' => count($conflicts),
            'by_severity' => $bySeverity,
            'by_status' => $byStatus,
            'by_type' => $byType,
        ],
    ]);
} catch (Throwable $exception) {
    // Canonical helper: writes the real reason to the PHP error log and returns a generic 500 to the
    // client. Swallowing it entirely (the first draft here) would have made a failed first run
    // undiagnosable, while echoing getMessage() would add exactly the info-disclosure leak M1 is
    // cleaning up elsewhere (AGENTS.md §10). The first call also runs CREATE TABLE IF NOT EXISTS, so
    // a missing privilege surfaces here -- and now says so in the log.
    avesmapsServerErrorResponse($exception, 'conflicts');
}
