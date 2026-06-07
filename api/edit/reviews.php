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
        avesmapsJsonResponse(403, ['ok' => false, 'error' => 'Diese Herkunft darf Bewertungen nicht moderieren.']);
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
            avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Es fehlt die Orts-ID.']);
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
        avesmapsJsonResponse(405, ['ok' => false, 'error' => 'Nur GET und POST sind erlaubt.']);
    }

    $payload = avesmapsReadJsonRequest();
    $action = trim((string) ($payload['action'] ?? ''));
    $id = (int) ($payload['id'] ?? 0);
    if ($id <= 0) {
        avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Es fehlt die Bewertungs-ID.']);
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

    avesmapsJsonResponse(400, ['ok' => false, 'error' => 'Unbekannte Aktion: ' . $action]);
} catch (Throwable $error) {
    avesmapsJsonResponse(500, ['ok' => false, 'error' => $error->getMessage()]);
}
