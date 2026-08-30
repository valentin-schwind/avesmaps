<?php

declare(strict_types=1);

// Der Weg des Relais herein: „Habt ihr etwas fuer mich?"
// (Entwurf docs/superpowers/specs/2026-08-30-mastodon-relais-design.md.)
//
// POST /api/social/relay-next.php  mit Kopf X-Avesmaps-Relay-Token
//   -> { ok:true, arbeit:false }                              nichts zu tun (der Normalfall)
//   -> { ok:true, arbeit:true, post_id, channel, text, ... }  ein Beitrag, jetzt auf `sending`
//
// 🔴 EIGENER SCHLUESSEL `social.relay_token` -- nicht der von Discord, nicht `social.app_token`,
// nicht der des SVG-Abzugs. Wer eines dieser Rechte widerrufen will, muss es allein koennen.
//
// 🔴 ER GIBT AUSSCHLIESSLICH RELAIS-KANAELE HERAUS. Ein Endpunkt hinter einem Token, der beliebige
// Beitraege herausreichte, waere ein Leseweg an der Anmeldung vorbei -- die Beitragsliste des Hubs
// steht sonst hinter der Faehigkeit `social`. Gefiltert wird in avesmapsSocialRelayClaimNext gegen
// das Register, nicht hier gegen einen Namen.
//
// 🔴 UND ER GIBT NIE EINEN ZUGANGSSCHLUESSEL HERAUS. Der Mastodon-Token liegt in den GitHub Secrets;
// dieser Server kennt ihn fuer den Versand nicht mehr.
//
// ⚠️ Der Schluessel kommt aus dem KOPF, nie aus `?token=` -- eine Adresszeile steht im Serverlog,
// ein Kopf nicht.
//
// ⚠️ Ein fehlender Schluessel heisst: die Tuer ist ZU, nicht offen.

require __DIR__ . '/../_internal/auth.php';
require_once __DIR__ . '/../_internal/social/relay.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    // 💣 Der Riegel VOR der Methodenpruefung -- fuer einen Unbefugten ist das die bessere Antwort,
    // sie verraet nicht einmal die erlaubte Methode (Befund A33, dieselbe Reihenfolge wie in
    // api/edit/admin/proxy-check.php).
    if (!avesmapsSocialRelayTokenOk($social, (string) ($_SERVER['HTTP_X_AVESMAPS_RELAY_TOKEN'] ?? ''))) {
        avesmapsErrorResponse(401, 'unauthenticated', 'Kein gueltiger Schluessel.');
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    // 🔴 Der Not-Aus gilt auch hier. Steht `social.enabled` auf false, soll NICHTS hinausgehen --
    // auch nicht ueber einen Umweg, den der Schalter nicht kennt. Ein Not-Aus, den ein zweiter
    // Versandweg umgeht, ist keiner.
    if (($social['enabled'] ?? true) === false) {
        avesmapsJsonResponse(200, ['ok' => true, 'arbeit' => false, 'grund' => 'send_disabled']);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $auftrag = avesmapsSocialRelayClaimNext($pdo, $config);

    if ($auftrag === null) {
        // ⚠️ „Nichts zu tun" ist ein ERFOLG. Der Normalfall ist die leere Warteschlange; ein
        // Workflow, der dann rot wird, erzeugt Dutzende Fehlmeldungen am Tag und wird nach einer
        // Woche ignoriert -- samt der echten.
        avesmapsJsonResponse(200, ['ok' => true, 'arbeit' => false]);
    }

    avesmapsJsonResponse(200, ['ok' => true, 'arbeit' => true] + $auftrag);
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
