<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/auth.php';
require __DIR__ . '/../_internal/analytics/visitor-analytics.php';

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

    $payload = avesmapsReadJsonRequest();
    $events = is_array($payload['events'] ?? null) ? $payload['events'] : [];
    if ($events === []) {
        avesmapsJsonResponse(200, ['ok' => true]);
    }

    $user = avesmapsOptionalUser();
    $actorType = avesmapsVisitorActorType($user);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsVisitorAnalyticsEnsureTables($pdo);

    avesmapsVisitorRecordUnique($pdo, $actorType);
    avesmapsVisitorIncrement($pdo, $actorType, 'device', avesmapsVisitorDeviceClass((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')));
    avesmapsVisitorIncrement($pdo, $actorType, 'language', avesmapsVisitorLanguage());
    avesmapsVisitorIncrement($pdo, $actorType, 'referrer', avesmapsVisitorReferrerSource((string) ($payload['referrer'] ?? ($_SERVER['HTTP_REFERER'] ?? ''))));

    $allowed = ['pageview', 'map_load', 'search', 'route', 'route_waypoint', 'transport', 'route_option', 'map_mode', 'display_toggle'];
    $hourly = ['pageview', 'map_load'];
    foreach (array_slice($events, 0, 100) as $event) {
        if (!is_array($event)) {
            continue;
        }
        $metric = (string) ($event['metric'] ?? '');
        if (!in_array($metric, $allowed, true)) {
            continue;
        }
        $hour = in_array($metric, $hourly, true) ? (int) gmdate('G') : null;
        avesmapsVisitorIncrement($pdo, $actorType, $metric, (string) ($event['dimension'] ?? ''), $hour);
    }

    avesmapsJsonResponse(200, ['ok' => true]);
} catch (Throwable $exception) {
    avesmapsJsonResponse(200, ['ok' => true]);
}
