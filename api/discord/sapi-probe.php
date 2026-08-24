<?php

declare(strict_types=1);

// TEMPORAERE MESSUNG (24.08.2026) fuer den Entwurf der aufgeschobenen Discord-Antwort.
// Beantwortet die eine tragende Frage: kann PHP auf STRATO die Antwort ABSCHICKEN und
// danach weiterarbeiten? `function_exists` allein genuegt als Beleg nicht -- Apache kann
// davor puffern. Deshalb misst `?mode=defer` den ABLAUF: frueh abschliessen, dann drei
// Sekunden schlafen. Antwortet der Aufruf nach ~0,2 s, traegt die Aufschiebung; nach
// ~3,2 s nicht. Diese Datei wird nach der Messung wieder entfernt.

require __DIR__ . '/../_internal/bootstrap.php';
require __DIR__ . '/../_internal/discord/app-auth.php';

header('Content-Type: application/json');

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'configuration unavailable']);
    exit;
}
$discord = is_array($config['discord'] ?? null) ? $config['discord'] : [];

$provided = (string) ($_SERVER['HTTP_X_AVESMAPS_TOKEN'] ?? ($_GET['token'] ?? ''));
if (!avesmapsDiscordCheckAppToken((string) ($discord['app_token'] ?? ''), $provided)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

$payload = json_encode([
    'ok' => true,
    'sapi' => PHP_SAPI,
    'has_fastcgi_finish_request' => function_exists('fastcgi_finish_request'),
    'has_litespeed_finish_request' => function_exists('litespeed_finish_request'),
    'mode' => (string) ($_GET['mode'] ?? 'info'),
]);

if ((string) ($_GET['mode'] ?? '') !== 'defer') {
    echo $payload;
    exit;
}

// Frueh abschliessen: erst der Weg, den PHP-FPM anbietet, sonst die Puffer-Variante mit
// gesetzter Laenge (ohne sie haelt Apache die Antwort bis zum Requestende zurueck).
ignore_user_abort(true);
header('Content-Length: ' . strlen($payload));
header('Connection: close');
echo $payload;

if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
} else {
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
}

// Die "Arbeit" nach der Antwort. Drei Sekunden, weil genau das Discords Fenster ist.
usleep(3_000_000);
