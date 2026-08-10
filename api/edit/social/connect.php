<?php

declare(strict_types=1);

// Einen Kanal-Zugang einrichten: EIN kurzlebiger Token hinein, ein geprüfter dauerhafter Token in die
// Datenbank (Entwurf §3.2). Ersetzt die Handarbeit über Explorer, Debugger und phpMyAdmin, an der sich
// am 10.08.2026 dreimal etwas Falsches ablegen ließ.
//
// 🔴 KEIN TOKEN GEHT ZURÜCK. Die Antwort trägt den Namen der Seite und die Aussage „läuft nie ab" --
// mehr nicht. Auch keine Fehlermeldung enthält je einen Token.
//
// ⚠️ Der eingefügte Token steht im Anfragerumpf, nicht in der Adresse: eine Abfragezeichenfolge landet
// in Server-Protokollen, ein POST-Rumpf nicht. Deshalb POST, obwohl es sich wie ein Formular anfühlt.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/channels.php';
require_once __DIR__ . '/../../_internal/social/store.php';
require_once __DIR__ . '/../../_internal/social/connect.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf nicht senden.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    // Fähigkeit VOR dem Rumpf, damit eine anonyme Sonde 401 bekommt und nicht 400 -- und damit ein
    // fremder Token gar nicht erst entgegengenommen wird.
    avesmapsRequireUserWithCapability('social');
    $request = avesmapsReadJsonRequest();

    $channel = trim((string) ($request['channel'] ?? ''));
    if (avesmapsSocialChannel($channel) === null || !avesmapsSocialConnectSupports($channel)) {
        avesmapsErrorResponse(400, 'invalid_request',
            'Für diesen Kanal gibt es keine Einrichtung über diesen Weg.');
    }

    $token = trim((string) ($request['token'] ?? ''));
    if ($token === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Es wurde kein Token eingefügt.');
    }

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $result = avesmapsSocialConnectFacebook($pdo, $social, $token);

    if (($result['ok'] ?? false) !== true) {
        // 400, nicht 500: das ist fast immer eine Sache der Konfiguration oder der Freigabe, und der
        // Text sagt welche. Ein 500 würde den Editor in die Server-Protokolle schicken, wo nichts steht.
        avesmapsErrorResponse(400, 'connect_failed', (string) ($result['error'] ?? 'Unbekannter Fehler.'));
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'channel' => $channel,
        'page_name' => (string) ($result['page_name'] ?? ''),
        'page_id' => (string) ($result['page_id'] ?? ''),
        // Nachgewiesen, nicht behauptet: die Ablage findet nur statt, wenn debug_token expires_at = 0
        // gemeldet hat (api/_internal/social/connect.php).
        'expires' => 'nie',
    ]);
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
