<?php

declare(strict_types=1);

// Wiki-Bilder lokalisieren: holt jedes Bild EINMAL auf unsere Platte, damit die Anzeige es nie
// wieder beim Wiki anfragen muss. Ein gebundener Schritt je Anfrage, der CLIENT treibt die
// Wiederholung -- STRATO hat keinen Cron, und ein langer Lauf belegt einen PHP-Worker
// (AGENTS.md §10, derselbe Aufbau wie citymap-autoget.php und der Territorien-Lauf).
//
// 🔴 Dies ist die EINZIGE Stelle, die den Datei-Riegel oeffnet, und sie tut es nur fuer die Dauer
// ihres eigenen Laufs (avesmapsWikiLokalisierungLaeuft, im finally zurueckgenommen). Der Riegel
// gilt der ANZEIGE; dieser Lauf ist das Gegenteil davon -- er holt einmal, damit nie wieder
// geholt werden muss.
//
// POST … {action:"status"}  -> { ok, remaining }
// POST … {action:"run"}     -> { ok, geholt, tot, remaining, details }
// POST … {action:"reset"}   -> { ok, geloescht }   (nur Grabsteine, nie ein Bild)

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/wiki/bilder-lokalisieren.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Bilder lokalisieren.');
    }

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($method !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
    }

    // 🔴 Der Lauf greift nach draussen -- er gehoert hinter eine Faehigkeit, nicht in die
    // oeffentliche Zone. Ohne dieses Gate koennte ein Fremder den Riegel fuer uns oeffnen.
    avesmapsRequireUserWithCapability('edit');

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $body = avesmapsReadJsonRequest();
    $action = trim((string) ($body['action'] ?? ''));
    $docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 3)), '/');

    if ($action === 'status') {
        avesmapsJsonResponse(200, ['ok' => true] + avesmapsWikiBilderStatus($pdo, $docroot));
    }

    if ($action === 'run') {
        avesmapsJsonResponse(200, ['ok' => true] + avesmapsWikiBilderLokalisierenLauf($pdo, $docroot));
    }

    if ($action === 'reset') {
        // ⚠️ Raeumt NUR die Grabsteine weg (tote Adressen werden wieder versucht). Nie ein Bild --
        // ein Zuruecksetzen darf keinen Bestand vernichten, den wir schon haben.
        avesmapsJsonResponse(200, [
            'ok' => true,
            'geloescht' => avesmapsWikiBilderGrabsteineLoeschen($docroot),
        ]);
    }

    avesmapsErrorResponse(400, 'invalid_request', 'action muss status, run oder reset sein.');
} catch (Throwable $error) {
    // ⚠️ Die Meldung bleibt allgemein (kein getMessage() nach aussen, M1); der Grund steht im Log.
    error_log('bilder-lokalisieren: ' . $error->getMessage());
    avesmapsErrorResponse(500, 'internal_error', 'Der Lauf konnte nicht ausgefuehrt werden.');
}
