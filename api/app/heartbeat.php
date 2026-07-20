<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';
require __DIR__ . '/../_internal/analytics/visitor-analytics.php';

// Presence ping -- "I am still here". Deliberately NOT folded into track.php:
// that endpoint increments device/language/referrer/country on every call, and a
// per-minute heartbeat would inflate those counters by roughly sixty times per
// visitor and hour. This one touches nothing but visitor_live.
//
// Like track.php it swallows every error and always answers {"ok":true}: presence
// is best-effort decoration for the editor panel and must never reach a visitor.
try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(200, ['ok' => true]);
    }

    if (!avesmapsVisitorAnalyticsEnabled()) {
        avesmapsJsonResponse(200, ['ok' => true]);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        avesmapsJsonResponse(200, ['ok' => true]);
    }
    // Crawlers do not run the client script, so this is belt and braces -- but a
    // spoofed presence row would be the one number in the panel nobody can sanity
    // check against a page view.
    if (avesmapsVisitorIsBot((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''))) {
        avesmapsJsonResponse(200, ['ok' => true]);
    }

    $payload = avesmapsReadJsonRequest();
    $state = (string) ($payload['state'] ?? 'reading');
    $actorType = avesmapsVisitorActorType(avesmapsOptionalUser());

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    if ($state === 'gone') {
        avesmapsVisitorForgetLive($pdo);
        avesmapsJsonResponse(200, ['ok' => true]);
    }

    // Self-healing without paying for DDL on every single ping: create the table
    // only once the write actually finds it missing.
    try {
        avesmapsVisitorRecordLive($pdo, $actorType, $state);
    } catch (PDOException $exception) {
        avesmapsVisitorEnsureLiveTable($pdo);
        avesmapsVisitorRecordLive($pdo, $actorType, $state);
    }

    // The reader purges on every poll, but only while an editor has the Status
    // panel open. This keeps the table from creeping up over stretches when
    // nobody is looking.
    if (random_int(1, 50) === 1) {
        avesmapsVisitorPurgeLive($pdo);
    }

    avesmapsJsonResponse(200, ['ok' => true]);
} catch (Throwable $exception) {
    avesmapsJsonResponse(200, ['ok' => true]);
}
