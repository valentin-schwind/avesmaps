<?php

declare(strict_types=1);

// Oeffentlicher Endpoint fuer Community-Ortsbewertungen.
//   GET  ?location=<publicId>&limit=N  -> { ok, average, count, reviews[] } (nur sichtbare)
//   POST { location, location_name, author, stars(1-5), body(<=200), dsa_date?, website(Honeypot) }
// Bewertungen sind sofort sichtbar; Spam/Honeypot werden still verworfen; Editor kann nachmoderieren.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/reviews.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsJsonResponse(403, ['ok' => false, 'error' => 'Diese Herkunft darf keine Bewertungen verwenden.']);
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMapReviewsTable($pdo);

    if ($requestMethod === 'GET') {
        $publicId = avesmapsNormalizeSingleLine((string) ($_GET['location'] ?? ''), 64);
        if ($publicId === '') {
            avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Es fehlt die Orts-ID (location).']);
        }

        $summary = avesmapsReviewSummary($pdo, $publicId);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'average' => $summary['average'],
            'count' => $summary['count'],
            'reviews' => avesmapsFetchVisibleReviews($pdo, $publicId, (int) ($_GET['limit'] ?? 12)),
        ]);
    }

    if ($requestMethod !== 'POST') {
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.']);
    }

    $payload = avesmapsReadJsonRequest();

    // Honeypot: das versteckte Feld "website" muss leer sein (nur Bots fuellen es). Still ok melden.
    if (avesmapsNormalizeSingleLine((string) ($payload['website'] ?? ''), 100) !== '') {
        avesmapsJsonResponse(200, ['ok' => true, 'message' => 'Danke für deine Bewertung!']);
    }

    $publicId = avesmapsNormalizeSingleLine((string) ($payload['location'] ?? ''), 64);
    if ($publicId === '') {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Es fehlt die Orts-ID.']);
    }

    $stars = (int) ($payload['stars'] ?? 0);
    if ($stars < 1 || $stars > 5) {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Bitte 1 bis 5 Sterne vergeben.']);
    }

    $author = avesmapsNormalizeSingleLine((string) ($payload['author'] ?? ''), AVESMAPS_REVIEW_AUTHOR_MAX);
    if ($author === '') {
        $author = 'Anonym';
    }

    $body = trim((string) ($payload['body'] ?? ''));
    $body = mb_substr((string) (preg_replace('/\s+/u', ' ', $body) ?? $body), 0, AVESMAPS_REVIEW_BODY_MAX);

    $locationName = avesmapsNormalizeSingleLine((string) ($payload['location_name'] ?? ''), 255);

    $dsaInput = avesmapsNormalizeSingleLine((string) ($payload['dsa_date'] ?? ''), AVESMAPS_REVIEW_DATE_MAX);
    if ($dsaInput === '') {
        // Leer -> aktuelles Datum automatisch in aventurisches Datum umrechnen.
        $dsaDate = avesmapsReviewDsaDateFromTimestamp(time());
    } else {
        $dsaDate = avesmapsReviewNormalizeDsaDate($dsaInput);
        if ($dsaDate === null) {
            avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Bitte ein gültiges aventurisches Datum eingeben, z. B. „7. Rahja 1049 BF" – oder das Feld leer lassen.']);
        }
    }

    // Rate-Limit: max. 5 Bewertungen pro Stunde und IP. Bei Ueberschreitung still "ok" melden.
    $ipHash = avesmapsReviewIpHash($config);
    $rateStatement = $pdo->prepare(
        'SELECT COUNT(*) FROM map_reviews WHERE ip_hash = :ip AND created_at >= (CURRENT_TIMESTAMP - INTERVAL 1 HOUR)'
    );
    $rateStatement->execute(['ip' => $ipHash]);
    if ((int) $rateStatement->fetchColumn() >= 5) {
        avesmapsJsonResponse(200, ['ok' => true, 'message' => 'Danke für deine Bewertung!']);
    }

    $isSpam = avesmapsReviewLooksLikeSpam($author, $body) ? 1 : 0;

    $insertStatement = $pdo->prepare(
        'INSERT INTO map_reviews
            (location_public_id, location_name, author_name, stars, body, dsa_date, is_hidden, is_spam, request_origin, ip_hash, user_agent)
         VALUES
            (:pid, :name, :author, :stars, :body, :dsa, 0, :spam, :origin, :ip, :ua)'
    );
    $insertStatement->execute([
        'pid' => $publicId,
        'name' => $locationName,
        'author' => $author,
        'stars' => $stars,
        'body' => $body,
        'dsa' => $dsaDate,
        'spam' => $isSpam,
        'origin' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), 255),
        'ip' => $ipHash,
        'ua' => avesmapsNormalizeSingleLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 500),
    ]);

    $summary = avesmapsReviewSummary($pdo, $publicId);
    avesmapsJsonResponse(201, [
        'ok' => true,
        'message' => 'Danke für deine Bewertung!',
        'average' => $summary['average'],
        'count' => $summary['count'],
        'review' => $isSpam ? null : [
            'author' => $author,
            'stars' => $stars,
            'body' => $body,
            'dsa_date' => $dsaDate,
        ],
    ]);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, ['ok' => false, 'error' => 'Bewertung konnte nicht gespeichert werden.']);
}
