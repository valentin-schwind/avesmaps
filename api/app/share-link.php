<?php

declare(strict_types=1);

// Kurzlink-Dienst: speichert den langen Planer-/Ansichts-Zustand (Query-String) unter einem
// kurzen Code und loest ihn wieder auf.
//   POST { query: "route=...&toggle..." }  -> { ok, code, url }
//   GET  ?code=<code>                       -> { ok, query }
// Oeffentlich (kein Login), wie die Melde-/Bewertungs-Endpoints. Tabelle wird auto-angelegt.

require __DIR__ . '/../_internal/bootstrap.php';

const AVESMAPS_SHARE_QUERY_MAX = 4000;
const AVESMAPS_SHARE_CODE_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

function avesmapsEnsureShareLinksTable(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS map_share_links (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            code VARCHAR(16) NOT NULL,
            query_hash CHAR(64) NOT NULL,
            target_query VARCHAR(4000) NOT NULL,
            hits INT UNSIGNED NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ip_hash VARCHAR(64) NOT NULL DEFAULT "",
            PRIMARY KEY (id),
            UNIQUE KEY uniq_share_code (code),
            KEY idx_share_query_hash (query_hash),
            KEY idx_share_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function avesmapsShareIpHash(array $config): string
{
    $secret = (string) ($config['database']['name'] ?? 'avesmaps');
    return hash_hmac('sha256', avesmapsClientIpAddress(), $secret);
}

function avesmapsGenerateShareCode(int $length = 8): string
{
    $alphabetLength = strlen(AVESMAPS_SHARE_CODE_ALPHABET);
    $bytes = random_bytes($length);
    $code = '';
    for ($i = 0; $i < $length; $i++) {
        $code .= AVESMAPS_SHARE_CODE_ALPHABET[ord($bytes[$i]) % $alphabetLength];
    }

    return $code;
}

// Normalisiert den eingehenden Query-String: fuehrendes "?" weg, Steuerzeichen raus, Laenge begrenzt.
function avesmapsNormalizeShareQuery(string $query): string
{
    $query = ltrim(trim($query), '?');
    $query = (string) preg_replace('/[\x00-\x1F\x7F\s]/u', '', $query);

    return mb_substr($query, 0, AVESMAPS_SHARE_QUERY_MAX);
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, ['ok' => false, 'error' => 'Diese Herkunft darf keine Kurzlinks verwenden.']);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureShareLinksTable($pdo);

    if ($requestMethod === 'GET') {
        $code = avesmapsNormalizeSingleLine((string) ($_GET['code'] ?? ''), 16);
        if ($code === '') {
            avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Es fehlt der Code.']);
        }

        $statement = $pdo->prepare('SELECT id, target_query FROM map_share_links WHERE code = :code LIMIT 1');
        $statement->execute(['code' => $code]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            avesmapsJsonResponse(404, ['ok' => false, 'error' => 'Kurzlink nicht gefunden.']);
        }

        // Aufrufzaehler best-effort hochzaehlen (Fehler ignorieren).
        try {
            $pdo->prepare('UPDATE map_share_links SET hits = hits + 1 WHERE id = :id')->execute(['id' => (int) $row['id']]);
        } catch (Throwable $ignore) {
        }

        avesmapsJsonResponse(200, ['ok' => true, 'query' => (string) $row['target_query']]);
    }

    if ($requestMethod !== 'POST') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.']);
    }

    $payload = avesmapsReadJsonRequest();
    $query = avesmapsNormalizeShareQuery((string) ($payload['query'] ?? ''));
    if ($query === '') {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Es gibt nichts zu teilen (kein Zustand gesetzt).']);
    }

    $queryHash = hash('sha256', $query);
    $ipHash = avesmapsShareIpHash($config);

    // Schon vorhanden? -> denselben Code zurueckgeben (idempotent, spart Eintraege).
    $existing = $pdo->prepare('SELECT code FROM map_share_links WHERE query_hash = :hash LIMIT 1');
    $existing->execute(['hash' => $queryHash]);
    $existingCode = $existing->fetchColumn();
    if ($existingCode !== false) {
        avesmapsJsonResponse(200, ['ok' => true, 'code' => (string) $existingCode]);
    }

    // Rate-Limit: max. 40 neue Kurzlinks pro Stunde und IP.
    $rate = $pdo->prepare('SELECT COUNT(*) FROM map_share_links WHERE ip_hash = :ip AND created_at >= (CURRENT_TIMESTAMP - INTERVAL 1 HOUR)');
    $rate->execute(['ip' => $ipHash]);
    if ((int) $rate->fetchColumn() >= 40) {
        avesmapsJsonResponse(429, ['ok' => false, 'error' => 'Zu viele Kurzlinks in kurzer Zeit. Bitte spaeter erneut versuchen.']);
    }

    $insert = $pdo->prepare(
        'INSERT INTO map_share_links (code, query_hash, target_query, ip_hash) VALUES (:code, :hash, :query, :ip)'
    );

    // Bei (sehr seltener) Code-Kollision neu wuerfeln.
    $code = '';
    for ($attempt = 0; $attempt < 6; $attempt++) {
        $code = avesmapsGenerateShareCode(8);
        try {
            $insert->execute(['code' => $code, 'hash' => $queryHash, 'query' => $query, 'ip' => $ipHash]);
            avesmapsJsonResponse(201, ['ok' => true, 'code' => $code]);
        } catch (PDOException $exception) {
            if (($exception->errorInfo[0] ?? '') !== '23000') {
                throw $exception;
            }
            // Doppelter Code -> erneut versuchen. Falls inzwischen derselbe query_hash existiert, den nehmen.
            $existing->execute(['hash' => $queryHash]);
            $existingCode = $existing->fetchColumn();
            if ($existingCode !== false) {
                avesmapsJsonResponse(200, ['ok' => true, 'code' => (string) $existingCode]);
            }
        }
    }

    avesmapsJsonResponse(500, ['ok' => false, 'error' => 'Kurzlink konnte nicht erzeugt werden.']);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, ['ok' => false, 'error' => 'Kurzlink-Dienst nicht verfügbar.']);
}
