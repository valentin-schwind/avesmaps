<?php

declare(strict_types=1);

// Authentifizierter Moderations-Endpoint fuer Community-Ortsbewertungen (Cap 'review').
//   GET  ?location=<publicId>          -> alle Bewertungen (inkl. versteckte) zum Moderieren
//   POST { action: hide|unhide|delete, id } -> verbergen / wieder einblenden / loeschen

require __DIR__ . '/../_internal/auth.php';
require_once __DIR__ . '/../_internal/reviews.php';

try {
    $config = avesmapsLoadApiConfig(__DIR__);

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Bewertungen nicht moderieren.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    $user = avesmapsRequireUserWithCapability('review');
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsEnsureMapReviewsTable($pdo);

    if ($requestMethod === 'GET') {
        $publicId = avesmapsNormalizeSingleLine((string) ($_GET['location'] ?? ''), 64);
        if ($publicId === '') {
            // Ohne Orts-ID: ALLE Bewertungen (inkl. versteckte/Spam) fuer die Moderationsliste
            // im "Meldungen"-Reiter, jeweils mit Orts-Info fuer Zoom + Infobox.
            $allStatement = $pdo->query(
                'SELECT id, location_public_id, location_name, author_name, stars, body, dsa_date,
                        is_hidden, is_spam, created_at
                 FROM map_reviews
                 ORDER BY created_at DESC, id DESC
                 LIMIT 300'
            );
            $allReviews = [];
            foreach (($allStatement ? $allStatement->fetchAll(PDO::FETCH_ASSOC) : []) as $row) {
                $allReviews[] = [
                    'id' => (int) $row['id'],
                    'location_public_id' => (string) $row['location_public_id'],
                    'location_name' => (string) $row['location_name'],
                    'author' => (string) $row['author_name'],
                    'stars' => (int) $row['stars'],
                    'body' => (string) $row['body'],
                    'dsa_date' => (string) $row['dsa_date'],
                    'is_hidden' => (int) $row['is_hidden'] === 1,
                    'is_spam' => (int) $row['is_spam'] === 1,
                    'created_at' => (string) $row['created_at'],
                ];
            }
            avesmapsJsonResponse(200, ['ok' => true, 'reviews' => $allReviews, 'count' => count($allReviews)]);
        }

        $statement = $pdo->prepare(
            'SELECT id, author_name, stars, body, dsa_date, is_hidden, is_spam, created_at
             FROM map_reviews
             WHERE location_public_id = :pid
             ORDER BY created_at DESC, id DESC
             LIMIT 100'
        );
        $statement->execute(['pid' => $publicId]);

        $reviews = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $reviews[] = [
                'id' => (int) $row['id'],
                'author' => (string) $row['author_name'],
                'stars' => (int) $row['stars'],
                'body' => (string) $row['body'],
                'dsa_date' => (string) $row['dsa_date'],
                'is_hidden' => (int) $row['is_hidden'] === 1,
                'is_spam' => (int) $row['is_spam'] === 1,
                'created_at' => (string) $row['created_at'],
            ];
        }

        $summary = avesmapsReviewSummary($pdo, $publicId);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'average' => $summary['average'],
            'count' => $summary['count'],
            'reviews' => $reviews,
        ]);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET und POST sind erlaubt.');
    }

    $payload = avesmapsReadJsonRequest();
    $action = trim((string) ($payload['action'] ?? ''));
    $id = (int) ($payload['id'] ?? 0);
    if ($id <= 0) {
        avesmapsErrorResponse(400, 'invalid_request', 'Es fehlt die Bewertungs-ID.');
    }

    if ($action === 'hide' || $action === 'unhide') {
        $statement = $pdo->prepare('UPDATE map_reviews SET is_hidden = :hidden WHERE id = :id');
        $statement->execute(['hidden' => $action === 'hide' ? 1 : 0, 'id' => $id]);
        avesmapsJsonResponse(200, ['ok' => true]);
    }

    if ($action === 'delete') {
        $statement = $pdo->prepare('DELETE FROM map_reviews WHERE id = :id');
        $statement->execute(['id' => $id]);
        avesmapsJsonResponse(200, ['ok' => true]);
    }

    avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Aktion: ' . $action);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Internal server error.');
}
