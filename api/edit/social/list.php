<?php

declare(strict_types=1);

// The read path for the "Social Media" subtab (Entwurf §2.2): the channel register, the shared
// hashtag vocabulary, and the posts with their PER-CHANNEL status.
//
// 🔴 It carries no credential. avesmapsSocialChannelList is built for exactly that, and
// channels-test.php pins the eight keys it may return so a field added there cannot reach the
// browser unnoticed.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/social/channels.php';
require_once __DIR__ . '/../../_internal/social/compose.php';
require_once __DIR__ . '/../../_internal/social/store.php';
// Fuer avesmapsSocialRelayDatabaseNow -- die Wartezeit wird gegen die Uhr der Datenbank gerechnet.
require_once __DIR__ . '/../../_internal/social/relay.php';

/**
 * Wie lange dieses Ziel schon auf seinen Versand wartet, in Sekunden -- oder null.
 *
 * ⚠️ null heisst „noch nie angefasst". Es als 0 zu melden hiesse „gerade eben eingereiht", und
 * genau daran haengt im Hub die Warnung, dass der Workflow nicht laeuft.
 */
function avesmapsSocialWartetSekunden(string $jetzt, string $seit): ?int
{
    if ($jetzt === '' || $seit === '') {
        return null;
    }
    $a = strtotime($jetzt);
    $b = strtotime($seit);
    if ($a === false || $b === false) {
        return null;
    }

    return max(0, $a - $b);
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf die Liste nicht lesen.');
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET ist erlaubt.');
    }

    avesmapsRequireUserWithCapability('social');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $social = is_array($config['social'] ?? null) ? $config['social'] : [];
    $tokenKeys = avesmapsSocialTokenKeys($pdo);
    // Wann der Zugang je Kanal abläuft. Eine zweite Abfrage auf dieselbe kleine Tabelle, damit die
    // Verfügbarkeitsprüfung ihre Schlüsselliste behält -- sie hat einen anderen Zweck als die Anzeige.
    $tokenExpiry = avesmapsSocialTokenExpiryMap($pdo);
    // EINMAL fuer die ganze Liste gelesen, nicht je Ziel.
    $jetzt = avesmapsSocialRelayDatabaseNow($pdo);

    $posts = [];
    foreach (avesmapsSocialListPosts($pdo, 50) as $row) {
        $targets = [];
        foreach ($row['targets'] as $target) {
            $channel = avesmapsSocialChannel((string) $target['channel_key']);
            $targets[] = [
                'channel' => (string) $target['channel_key'],
                // A channel that has since been removed from the register still has rows here. Falling
                // back to its key keeps the post readable instead of rendering an empty chip.
                'label' => $channel === null ? (string) $target['channel_key'] : (string) $channel['label'],
                'status' => (string) $target['status'],
                'error' => (string) $target['error'],
                // 💣 DIE WARTEZEIT RECHNET DER SERVER, nicht der Browser. `attempted_at` ist eine
                // Zeichenkette ohne Zeitzone; ein `new Date("2026-08-30 15:16:57")` im Browser
                // liest sie als ORTSZEIT DES BETRACHTERS, und schon steht bei einem Editor in
                // einer anderen Zone „wartet seit 3 Stunden" für etwas, das gerade eben
                // eingereiht wurde. Gerechnet wird gegen die Uhr, die den Wert auch geschrieben
                // hat -- dieselbe Regel wie in relay.php.
                // ⚠️ null heißt „noch nie angefasst", nicht „null Sekunden".
                'wartet_sekunden' => avesmapsSocialWartetSekunden(
                    $jetzt,
                    $target['attempted_at'] === null ? '' : (string) $target['attempted_at']
                ),
                'remote_id' => (string) $target['remote_id'],
                // Die Adresse des veroeffentlichten Beitrags, oder '' wenn der Kanal keine nennt.
                // Der Client macht daraus einen Link -- und laesst ihn weg, wenn nichts dasteht.
                'remote_url' => (string) ($target['remote_url'] ?? ''),
                // Only the probe fills this. It is what makes the rehearsal inspectable (Entwurf §10).
                'sent_payload' => $target['sent_payload'] === null ? null : (string) $target['sent_payload'],
            ];
        }

        $posts[] = [
            'id' => (int) $row['id'],
            'title' => (string) ($row['title'] ?? ''),
            'text' => (string) $row['body'],
            'hashtags' => (string) $row['hashtags'],
            'media_url' => (string) $row['media_url'],
            'media_license' => (string) $row['media_license'],
            // Die Quellenangabe reist mit, damit „Bearbeiten" sie wiederherstellen kann -- ohne sie
            // stuende beim Speichern eines Entwurfs mit freier Lizenz ploetzlich keine Quelle mehr da.
            'media_source' => (string) ($row['media_source'] ?? ''),
            // Wie die Quellenangabe: sie reist mit, damit „Bearbeiten" sie wiederherstellt. Ohne das
            // verlaere ein Entwurf beim zweiten Speichern still seine Bildbeschreibung.
            'media_alt' => (string) ($row['media_alt'] ?? ''),
            // 💣 Wie Quellenangabe und Bildbeschreibung: sie reist mit, damit „Bearbeiten" das
            // Häkchen wiederherstellt. Ohne das verlöre ein Entwurf beim zweiten Speichern still
            // seine KI-Erklärung -- und zwar in die stille Richtung (Häkchen weg, Beitrag raus).
            'ai_declared' => (int) ($row['ai_declared'] ?? 0) === 1,
            'origin' => (string) $row['origin'],
            'state' => (string) $row['state'],
            // The author is INTERNAL (Entwurf §2.3): posts go out as Avesmaps, never under a personal
            // name. Who pressed the button is visible to editors only -- which is exactly here, behind
            // the 'social' capability, and nowhere else.
            'author' => (string) $row['author_name'],
            'created_at' => (string) $row['created_at'],
            'scheduled_for' => $row['scheduled_for'] === null ? null : (string) $row['scheduled_for'],
            'targets' => $targets,
        ];
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'channels' => avesmapsSocialChannelList($social, $tokenKeys, $tokenExpiry),
        'vocabulary' => AVESMAPS_SOCIAL_HASHTAG_VOCABULARY,
        // The kill switch travels so the hub can SAY that sending is off, instead of letting an editor
        // write a post and discover it at the end (Entwurf §8).
        'enabled' => ($social['enabled'] ?? true) !== false,
        'posts' => $posts,
    ]);
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
