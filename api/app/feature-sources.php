<?php

declare(strict_types=1);

// Oeffentlicher, read-only Endpoint fuer die genehmigten Quellen eines Kartenelements
// (Multi-Source-System #1). Liefert NUR status='approved'-Links, keine Auth noetig
// (oeffentliche Karte, wie map-features/territory-detail).
//
// GET ?entity_type=<settlement|territory|region|path>&entity_public_id=<public_id>

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/feature-sources.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Quellen laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer Quellen erlaubt.');
    }

    $entityType = trim((string) ($_GET['entity_type'] ?? ''));
    $entityPublicId = trim((string) ($_GET['entity_public_id'] ?? ''));
    // citymap joined in with the Kartensammlung (Spec §3.2); lore joined 2026-07-22 (AGENTS.md §5).
    $allowedTypes = ['settlement', 'territory', 'region', 'path', 'citymap', 'lore'];

    if (!in_array($entityType, $allowedTypes, true) || $entityPublicId === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'entity_type (settlement|territory|region|path|citymap|lore) und entity_public_id sind erforderlich.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $sources = avesmapsReadFeatureSources($pdo, $entityType, $entityPublicId);

    avesmapsJsonResponse(200, ['ok' => true, 'sources' => $sources]);
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Quellen konnten nicht aus der Datenbank geladen werden.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Quellen konnten nicht geladen werden.');
}
