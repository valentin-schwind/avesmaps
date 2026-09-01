<?php

declare(strict_types=1);

// Retry EXACTLY ONE channel (Entwurf §2.2).
//
// 💣 The narrow scope is the whole point. A post that reached Instagram and failed on Mastodon must
// be repairable without posting to Instagram a second time -- a duplicate there cannot be edited
// away, only deleted. That is also why the retry button sits on the individual chip and not on the
// post: the gesture the editor makes is already the scope of the action.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/channels.php';
require_once __DIR__ . '/../../_internal/social/compose.php';
require_once __DIR__ . '/../../_internal/social/media.php';
require_once __DIR__ . '/../../_internal/social/store.php';
require_once __DIR__ . '/../../_internal/social/publish.php';

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

    // Capability BEFORE the body, so an anonymous probe answers 401 rather than 400.
    avesmapsRequireUserWithCapability('social');
    $request = avesmapsReadJsonRequest();

    $id = (int) ($request['id'] ?? 0);
    $channel = trim((string) ($request['channel'] ?? ''));
    if ($id <= 0 || avesmapsSocialChannel($channel) === null) {
        avesmapsErrorResponse(400, 'invalid_request', 'id und channel werden gebraucht.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // 🔴 DER RIEGEL, UND ER STEHT VOR DEM DISPATCH. Der Hub bietet „Erneut" nur bei einem
    // gescheiterten Kanal an; dieser Endpunkt nahm bis zum 01.09.2026 jeden Zustand an. Ein Retry
    // auf ein bereits GESENDETES Ziel holt den Beitrag nicht noch einmal heraus -- Mastodon
    // antwortet auf den wiederholten Idempotency-Key mit HTTP 500 --, aber er setzt den Chip auf
    // „Fehler", waehrend der Beitrag oeffentlich dasteht. Die falsche Anzeige ist der Schaden.
    //
    // ⚠️ Geprueft wird der Zustand VOR dem Dispatch: danach hat er ihn laengst ueberschrieben.
    $post = avesmapsSocialLoadPost($pdo, $id);
    if ($post === null) {
        avesmapsErrorResponse(404, 'not_found', 'Der Beitrag wurde nicht gefunden.');
    }
    $zielStatus = null;
    foreach ($post['targets'] as $target) {
        if ((string) $target['channel_key'] === $channel) {
            $zielStatus = (string) $target['status'];
        }
    }
    if ($zielStatus === null) {
        avesmapsErrorResponse(404, 'not_found', 'Dieser Beitrag hat kein Ziel für diesen Kanal.');
    }
    if (!avesmapsSocialRetryErlaubt($zielStatus)) {
        // 409, nicht 400: die Anfrage ist in Ordnung, nur der Zustand laesst sie nicht zu.
        avesmapsErrorResponse(409, 'retry_not_allowed', avesmapsSocialRetryAbsage($zielStatus));
    }

    $dispatch = avesmapsSocialDispatch($pdo, $id, $config, $channel);
    if (!$dispatch['ok']) {
        avesmapsErrorResponse(404, 'not_found', 'Der Beitrag wurde nicht gefunden.');
    }
    // A channel the post never targeted yields no result at all. Saying so is better than reporting a
    // success the editor would read as "it went out this time".
    if (!isset($dispatch['results'][$channel])) {
        avesmapsErrorResponse(404, 'not_found', 'Dieser Beitrag hat kein Ziel für diesen Kanal.');
    }

    avesmapsJsonResponse(200, [
        'ok' => true, 'id' => $id, 'channel' => $channel, 'result' => $dispatch['results'][$channel],
        // Bei einem Relais-Kanal landet der Beitrag hier nur in der Warteschlange -- ob der Lauf
        // auch angestossen wurde und warum nicht, ist dann die eigentliche Auskunft. Ohne sie
        // scheitert der Anstoss lautlos und der Beitrag haengt bis zum naechsten Zeitplan-Lauf.
        'relais_anstoss' => $dispatch['relais_anstoss'] ?? null,
    ]);
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
