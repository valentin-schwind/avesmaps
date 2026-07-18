<?php

declare(strict_types=1);

// The four-mechanism safety core for the "Vorschauen holen" mass runs (Kartensammlung + Abenteuer).
// Endpoint-AGNOSTIC on purpose: it governs HOW OFTEN and HOW LONG work happens, never WHAT is fetched, so
// the exact same wrapper serves both runs. Lives in its own file (like app-setting.php) so neither feature
// has to depend on the other's catalog.
//
// WHY MySQL GET_LOCK HERE, WHEN dump-lock.php DELIBERATELY AVOIDS IT: the dump lock must survive ACROSS
// hundreds of client-driven requests (each a new connection), so a connection-scoped lock is useless there
// and it uses a persisted DB row. This lock wants the OPPOSITE: single-flight PER STEP. A step holds the
// lock only while it runs and drops it at the end (or on crash/disconnect -- connection-scoped is exactly
// the auto-release we want). Two concurrent runs can then never WORK at the same instant: whoever holds the
// lock runs its ~4s step; a second tab/reload/agent hitting a step gets GET_LOCK=0 -> {busy:true} and stops.
// Combined with the time budget, a run can no longer saturate the pool no matter how many tabs/clicks
// (php-pool-hang-incident-2026-07-17).
//
// PURITY CONTRACT (mirrors dump-lock.php): side-effect-free on include -- only const + function defs, no
// top-level code, no DB connect, no headers. The genuinely offline-decidable logic (lock-result reading,
// the wall-clock budget) is pure and unit-tested; the DB touches take a PDO explicitly.

// The ONE shared lock name for BOTH runs -- system-wide only one preview run at a time (the calmest choice,
// spec §2). MySQL user-lock names are instance-wide and capped at 64 chars.
const AVESMAPS_AUTOGET_RUN_LOCK = 'avesmaps_preview_autoget';

// Per-step wall-clock budget: a step works until ~4s elapsed, then returns (done:false, remaining:N). This
// REPLACES a fixed source/entity count -- a worker is never held longer than this, and the client just
// calls more often. NB: this bounds the NUMBER of fetches per step; a single hung fetch is capped
// separately by probe.php's own cURL timeout (~20s), not by this budget.
const AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS = 4.0;

/**
 * PURE: did GET_LOCK(name, 0) grant the lock? Returns 1 (got it), 0 (held by another connection), or NULL
 * (error). Drivers surface 1/0 as int OR string, so normalise to string; anything but '1' is "not mine"
 * (conservative: on a NULL error we do NOT run, rather than risk a second concurrent run).
 */
function avesmapsAutogetLockAcquired(mixed $rawResult): bool
{
    return (string) $rawResult === '1';
}

/**
 * PURE: has the per-step wall-clock budget been reached? `>=` so the exact-budget moment stops. Injecting
 * $now (rather than reading microtime here) is what makes this unit-testable.
 */
function avesmapsAutogetDeadlineReached(float $startedAt, float $now, float $budgetSeconds): bool
{
    return ($now - $startedAt) >= $budgetSeconds;
}

/**
 * DB: acquire the shared single-flight lock, NON-BLOCKING (timeout 0 -> returns immediately if held). True
 * iff this connection now holds it.
 */
function avesmapsAutogetAcquireRunLock(PDO $pdo, string $lockName): bool
{
    $stmt = $pdo->prepare('SELECT GET_LOCK(:name, 0)');
    $stmt->execute(['name' => $lockName]);
    return avesmapsAutogetLockAcquired($stmt->fetchColumn());
}

/**
 * DB: release the shared lock. Best-effort (called in a finally); a RELEASE_LOCK on a lock we do not hold
 * is a harmless no-op at the DB level. Connection-scoped, so even if this never runs the lock frees when
 * the request's connection closes.
 */
function avesmapsAutogetReleaseRunLock(PDO $pdo, string $lockName): void
{
    $stmt = $pdo->prepare('SELECT RELEASE_LOCK(:name)');
    $stmt->execute(['name' => $lockName]);
}

/**
 * The guarded step: the gate ORDER that makes a run safe, shared by both endpoints.
 *   1. kill-switch OFF   -> {ok:true, stopped:true}   (checked FIRST, before taking any lock)
 *   2. lock held elsewhere -> {ok:true, busy:true}    (never runs the step, never releases a lock it lacks)
 *   3. otherwise: run $doStep($pdo), ALWAYS release the lock in finally (even on throw).
 *
 * $enabled is passed in already-resolved (the endpoint reads its own per-run kill-switch flag) so this
 * wrapper stays feature-agnostic and directly testable with a bool.
 *
 * @param callable(PDO):array $doStep the feature-specific bounded step; returns the response envelope
 * @return array the stopped/busy envelope, or $doStep's own result
 */
function avesmapsAutogetGuardedStep(PDO $pdo, bool $enabled, string $lockName, callable $doStep): array
{
    if (!$enabled) {
        return ['ok' => true, 'stopped' => true];
    }
    if (!avesmapsAutogetAcquireRunLock($pdo, $lockName)) {
        return ['ok' => true, 'busy' => true];
    }
    try {
        return $doStep($pdo);
    } finally {
        avesmapsAutogetReleaseRunLock($pdo, $lockName);
    }
}
