<?php

declare(strict_types=1);

// Der Weg des Relais hinaus: „So ist es ausgegangen."
// (Entwurf docs/superpowers/specs/2026-08-30-mastodon-relais-design.md.)
//
// POST /api/social/relay-result.php  mit Kopf X-Avesmaps-Relay-Token
//   { post_id, channel, ok, remote_id?, remote_url?, error? }  ->  { ok:true, uebernommen:bool }
//
// 💣 `uebernommen:false` IST EINE ANTWORT, KEIN FEHLER. Geschrieben wird nur auf ein Ziel, das
// wirklich in `sending` steht. Hat jemand denselben Beitrag in der Zwischenzeit von Hand erneut
// gesendet, darf eine spaet eintreffende Rueckmeldung sein `sent` nicht mit einem alten `failed`
// ueberschreiben -- der Chip stuende dann auf Rot, waehrend der Beitrag oeffentlich draussen ist.
//
// ⚠️ Derselbe Schluessel wie in relay-next.php, aus demselben Kopf, mit demselben Riegel vor der
// Methodenpruefung.

require __DIR__ . '/../_internal/auth.php';
require_once __DIR__ . '/../_internal/social/relay.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    if (!avesmapsSocialRelayTokenOk($social, (string) ($_SERVER['HTTP_X_AVESMAPS_RELAY_TOKEN'] ?? ''))) {
        avesmapsErrorResponse(401, 'unauthenticated', 'Kein gueltiger Schluessel.');
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    $request = avesmapsReadJsonRequest();
    $postId = (int) ($request['post_id'] ?? 0);
    $channel = trim((string) ($request['channel'] ?? ''));
    if ($postId <= 0 || $channel === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'post_id und channel werden gebraucht.');
    }

    // ⚠️ Ausdruecklich `=== true`. Ein fehlendes oder unlesbares Feld heisst NICHT „gesendet" --
    // dieselbe Richtung wie ueberall im Hub: ein unbekannter Zustand faellt nie auf Erfolg.
    $ok = ($request['ok'] ?? false) === true;

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $uebernommen = avesmapsSocialRelayStoreResult(
        $pdo,
        $postId,
        $channel,
        $ok,
        (string) ($request['remote_id'] ?? ''),
        (string) ($request['remote_url'] ?? ''),
        (string) ($request['error'] ?? '')
    );

    avesmapsJsonResponse(200, ['ok' => true, 'uebernommen' => $uebernommen]);
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
