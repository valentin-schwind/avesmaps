<?php

declare(strict_types=1);

// Die Warteschlange fuer Kanaele, die dieser Server nicht erreicht
// (Entwurf docs/superpowers/specs/2026-08-30-mastodon-relais-design.md).
//
// 💣 WARUM ES DAS GIBT: rollenspiel.social verwirft die Pakete unserer Ausgangsadresse. Gemessen am
// 30.08.2026 mit api/edit/admin/ausgang-check.php -- Phase `tcp`, Port 80 UND 443, waehrend dieselbe
// Adresse jedes andere Ziel in 17 ms erreicht. Es ist kein Token-, Zeichen- oder Bildproblem; die
// Verbindung kommt nicht zustande. Die Instanz-Administration hat eine Ausnahme geprueft, abgelehnt
// (Shared-Hosting-Adresse, fremde Reputation) und um eine Alternative gebeten.
//
// 🔴 NUR DIE KANAELE MIT `relay` IM REGISTER. Facebook, Instagram und „Neuigkeiten" senden
// unveraendert direkt. Ein zweiter Versandweg fuer alle waere eine zweite Wahrheit ueber das Senden.
//
// 🔴 HIER LIEGT KEIN ZUGANGSSCHLUESSEL DES ZIELNETZES. Der Mastodon-Token liegt in den GitHub
// Secrets, dieser Server kennt ihn fuer den Versand nicht mehr. Beide Seiten haben genau das
// Geheimnis, das sie brauchen -- und `relay_token` ist ein eigenes, nicht das von Discord, nicht
// `social.app_token` und nicht das des SVG-Abzugs (dieselbe Entscheidung wie am 08.08.2026:
// Bequemlichkeit ist kein Grund, zwei Rechte zu verschmelzen).

require_once __DIR__ . '/channels.php';
require_once __DIR__ . '/compose.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/adapters/mastodon.php';

// Wann ein uebernommener Beitrag als verschollen gilt und zurueck in die Warteschlange faellt.
// 💣 EIN `sending` MUSS VERFALLEN. Bricht ein Lauf zwischen Abholen und Zurueckmelden ab -- GitHub
// bricht Laeufe ab, Netze reissen --, laege der Beitrag sonst FUER IMMER in `sending` und niemand
// holte ihn je wieder. Das sieht im Hub aus wie „wird gerade gesendet" und ist in Wahrheit ein
// Totalausfall dieses einen Beitrags.
// ⚠️ Deutlich groesser als die Laufzeit eines Laufs (Sekunden) und groesser als der Takt (30 Min.),
// damit sich nie zwei Laeufe denselben Beitrag greifen.
const AVESMAPS_SOCIAL_RELAY_STALE_MINUTES = 60;

/**
 * Die Kanaele, die ueber ein Relais gehen -- aus dem Register, nie als Namensliste.
 *
 * @return list<string>
 */
function avesmapsSocialRelayChannelKeys(): array
{
    $keys = [];
    foreach (AVESMAPS_SOCIAL_CHANNELS as $key => $channel) {
        if (trim((string) ($channel['relay'] ?? '')) !== '') {
            $keys[] = (string) $key;
        }
    }

    return $keys;
}

/**
 * Der Riegel.
 *
 * 💣 Die zwei Leerpruefungen kommen ZUERST, weil `hash_equals('', '')` wahr ist -- ein Server ohne
 * konfigurierten Schluessel liesse sonst jeden herein. Dasselbe Muster wie in routine-post.php.
 */
function avesmapsSocialRelayTokenOk(array $social, string $sent): bool
{
    $expected = (string) ($social['relay_token'] ?? '');
    if ($expected === '' || $sent === '') {
        return false;
    }

    return hash_equals($expected, $sent);
}

/**
 * Die aktuelle Zeit der DATENBANK, als Zeichenkette.
 *
 * 💣 NICHT `time()` IN PHP. `attempted_at` wird von der Datenbank gesetzt (`CURRENT_TIMESTAMP(3)`);
 * eine in PHP gerechnete Grenze verglaeche zwei Uhren, die in verschiedenen Zeitzonen laufen
 * koennen. Gerechnet wird deshalb relativ zur Uhr, die auch schreibt.
 *
 * ⚠️ Und NICHT `NOW() - INTERVAL x MINUTE` im SQL: `INTERVAL` kennt SQLite nicht, gegen das die
 * Tests laufen. Die Produktionsform darf man nicht verbiegen, damit ein Test laeuft (AGENTS.md §9,
 * die 1093-Falle vom 16.08.2026) -- also wird die Grenze in PHP aus der DB-Zeit gebildet und als
 * gewoehnlicher Parameter uebergeben. Das laeuft auf beiden.
 */
function avesmapsSocialRelayDatabaseNow(PDO $pdo): string
{
    $row = $pdo->query('SELECT CURRENT_TIMESTAMP AS jetzt')->fetch(PDO::FETCH_ASSOC);

    return (string) ($row['jetzt'] ?? '');
}

/**
 * Verschollene Uebernahmen zurueck in die Warteschlange.
 *
 * @return int Wie viele zurueckgefallen sind.
 */
function avesmapsSocialRelayReleaseStale(PDO $pdo, ?string $now = null): int
{
    $keys = avesmapsSocialRelayChannelKeys();
    if ($keys === []) {
        return 0;
    }
    $now = $now ?? avesmapsSocialRelayDatabaseNow($pdo);
    if ($now === '') {
        return 0;
    }

    $grenze = date('Y-m-d H:i:s', strtotime($now) - AVESMAPS_SOCIAL_RELAY_STALE_MINUTES * 60);

    $platzhalter = [];
    $werte = ['grenze' => $grenze];
    foreach ($keys as $i => $key) {
        $platzhalter[] = ':k' . $i;
        $werte['k' . $i] = $key;
    }

    $stmt = $pdo->prepare(
        'UPDATE social_post_target
            SET status = :neu
          WHERE status = :alt
            AND channel_key IN (' . implode(', ', $platzhalter) . ')
            AND attempted_at IS NOT NULL
            AND attempted_at < :grenze'
    );
    // ⚠️ Eigene Platzhalter fuer die beiden Zustaende: derselbe Name zweimal in EINER Anweisung ist
    // mit ATTR_EMULATE_PREPARES => false ein HY093-Fehler (die Falle von „Was ist hier?").
    $werte['neu'] = 'queued';
    $werte['alt'] = 'sending';
    $stmt->execute($werte);

    return $stmt->rowCount();
}

/**
 * Den naechsten wartenden Beitrag uebernehmen.
 *
 * 💣 ANSPRUCH STATT LESEN. Der UPDATE traegt `AND status = 'queued'` und gilt nur, wenn er GENAU
 * eine Zeile getroffen hat. Zwei gleichzeitige Laeufe koennen sonst denselben Beitrag holen -- und
 * obwohl Mastodons Idempotency-Key einen Doppelbeitrag verhindert, waere die zweite Rueckmeldung
 * eine Luege ueber den Zustand.
 *
 * @return array<string, mixed>|null null heisst „nichts zu tun" -- der Normalfall, kein Fehler.
 */
function avesmapsSocialRelayClaimNext(PDO $pdo, array $config): ?array
{
    avesmapsSocialEnsureTables($pdo);
    avesmapsSocialRelayReleaseStale($pdo);

    $keys = avesmapsSocialRelayChannelKeys();
    if ($keys === []) {
        return null;
    }

    $platzhalter = [];
    $werte = [];
    foreach ($keys as $i => $key) {
        $platzhalter[] = ':k' . $i;
        $werte['k' . $i] = $key;
    }
    $werte['status'] = 'queued';

    // 🔴 NUR freigegebene Beitraege. Ein Entwurf (`state = 'proposal'`) hat noch niemand gesehen --
    // ihn zu senden waere genau die unbeaufsichtigte Veroeffentlichung, gegen die es den
    // Freigabe-Kasten ueberhaupt gibt.
    $stmt = $pdo->prepare(
        'SELECT t.post_id, t.channel_key
           FROM social_post_target t
           JOIN social_post p ON p.id = t.post_id
          WHERE t.status = :status
            AND t.channel_key IN (' . implode(', ', $platzhalter) . ')
            AND p.state = :state
          ORDER BY t.post_id ASC
          LIMIT 1'
    );
    $werte['state'] = 'released';
    $stmt->execute($werte);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }

    $postId = (int) $row['post_id'];
    $channelKey = (string) $row['channel_key'];

    $anspruch = $pdo->prepare(
        'UPDATE social_post_target
            SET status = :neu, attempted_at = CURRENT_TIMESTAMP(3)
          WHERE post_id = :pid AND channel_key = :key AND status = :alt'
    );
    $anspruch->execute(['neu' => 'sending', 'alt' => 'queued', 'pid' => $postId, 'key' => $channelKey]);
    if ($anspruch->rowCount() !== 1) {
        return null;
    }

    $post = avesmapsSocialLoadPost($pdo, $postId);
    $channel = avesmapsSocialChannel($channelKey);
    if ($post === null || $channel === null) {
        return null;
    }

    // 💣 DER TEXT WIRD HIER GEBAUT, NICHT IM WORKFLOW. Baute ihn der Workflow, gaebe es zwei Regeln
    // dafuer, wie Hashtags an einen Beitrag kommen -- und die eine wuerde im Hub angezeigt und die
    // andere gesendet. `avesmapsSocialCompose` ist dieselbe Funktion, die auch der Direktversand
    // benutzt.
    $hashtags = avesmapsSocialNormalizeHashtags((string) ($post['hashtags'] ?? ''));
    $composed = avesmapsSocialCompose((string) $post['body'], $hashtags, $channel);

    $mediaUrl = trim((string) ($post['media_url'] ?? ''));

    return [
        'post_id' => $postId,
        'channel' => $channelKey,
        'text' => $composed['caption'],
        // Absolut, weil der Workflow von aussen kommt und einen Pfad nicht aufloesen kann.
        'media_url' => $mediaUrl === '' ? '' : avesmapsSocialAbsoluteUrl($mediaUrl),
        'media_alt' => (string) ($post['media_alt'] ?? ''),
        'sprache' => AVESMAPS_SOCIAL_MASTODON_LANGUAGE,
        // ⭐ DERSELBE Schluessel wie im Direktversand -- eine Funktion, ein Wert. Er haengt allein an
        // der Beitrags-ID, also ist ein Wiederholungsversuch nach einer Zeitueberschreitung
        // gefahrlos: Mastodon liefert dann den urspruenglichen Beitrag zurueck.
        'idempotency_key' => avesmapsSocialMastodonIdempotencyKey($postId),
        'instanz' => avesmapsSocialMastodonBaseUrl(
            (string) (($config['social']['mastodon']['base_url'] ?? '')),
        ),
    ];
}

/**
 * Das Ergebnis eines Laufs zurueckschreiben.
 *
 * ⚠️ Geschrieben wird NUR auf ein Ziel, das auch wirklich uebernommen wurde (`sending`). Eine
 * Rueckmeldung zu einem Beitrag, den inzwischen jemand von Hand erneut gesendet hat, darf ein
 * `sent` nicht mit einem alten `failed` ueberschreiben.
 */
function avesmapsSocialRelayStoreResult(
    PDO $pdo,
    int $postId,
    string $channelKey,
    bool $ok,
    string $remoteId,
    string $remoteUrl,
    string $error
): bool {
    if (!in_array($channelKey, avesmapsSocialRelayChannelKeys(), true)) {
        return false;
    }

    $stmt = $pdo->prepare(
        'SELECT status FROM social_post_target WHERE post_id = :pid AND channel_key = :key LIMIT 1'
    );
    $stmt->execute(['pid' => $postId, 'key' => $channelKey]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row) || (string) $row['status'] !== 'sending') {
        return false;
    }

    avesmapsSocialUpdateTarget($pdo, $postId, $channelKey, $ok
        ? ['status' => 'sent', 'remote_id' => $remoteId, 'remote_url' => $remoteUrl, 'error' => '']
        // ⚠️ Ohne eigenen Text ein Satz, der sagt WO es scheiterte -- „Unbekannter Fehler" liesse
        // den Editor im Hub raten, ob der Beitrag nun draussen ist oder nicht.
        : ['status' => 'failed', 'error' => $error !== '' ? $error
            : 'Der Versand ueber den GitHub-Workflow ist ohne Angabe eines Grundes fehlgeschlagen.']);

    return true;
}
