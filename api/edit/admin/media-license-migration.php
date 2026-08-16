<?php

declare(strict_types=1);

/**
 * Media-Lizenz-Migration -- Steuerflaeche (nur admin).
 * ---------------------------------------------------------------------------
 * Ruft avesmapsMediaLicenseMigrationRun() (api/_internal/media-license-migration-run.php) auf. Faehig-
 * keit `admin`, nicht `edit`: der Lauf schreibt quer ueber fuenf Flaechen in Bestandsdaten, und sobald
 * er einen Sichtbarkeitswechsel oder einen Wappen-ohne-Lizenz-Fall findet, ist das eine Entscheidung,
 * die ein Editor nicht im Vorbeigehen treffen soll (dieselbe Begruendung wie beim Datenbank-Backup
 * nebenan, das ebenfalls admin statt edit verlangt).
 *
 * POST { "dry_run"?: bool, "batch_limit"?: int }
 *   -> { ok:true, dry_run:bool, surfaces:{...}, sichtbarkeitswechsel:[...], coat_ohne_lizenz:[...] }
 *
 * 🔴 dry_run ist die VORGABE -- geschrieben wird nur, wenn der Aufrufer ausdruecklich dry_run:false
 * sendet. Ein fehlendes Feld, ein truthy Nicht-false-Wert oder ein Tippfehler bleiben allesamt die
 * Vorschau (dieselbe Regel wie in avesmapsMediaLicenseMigrationRun() selbst: `!== false`).
 */

require __DIR__ . '/../../_internal/bootstrap.php';
require __DIR__ . '/../../_internal/auth.php';
require __DIR__ . '/../../_internal/media-license-migration-run.php';

$config = avesmapsLoadApiConfig(avesmapsApiRoot());
if (!avesmapsApplyCorsPolicy($config)) {
    avesmapsErrorResponse(403, 'origin_not_allowed', 'Origin not allowed.');
}

$requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($requestMethod === 'OPTIONS') {
    avesmapsJsonResponse(204);
}

avesmapsRequireUserWithCapability('admin');

if ($requestMethod !== 'POST') {
    avesmapsErrorResponse(405, 'method_not_allowed', 'Die Methode ist nicht erlaubt.');
}

try {
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
} catch (Throwable $exception) {
    avesmapsServerErrorResponse($exception, 'media-license-migration connect');
}

$payload = avesmapsReadJsonRequest();
// ⚠️ Vorgabe ist die Vorschau -- nur ein ausdrueckliches false schreibt.
$dryRun = ($payload['dry_run'] ?? true) !== false;
$batchLimit = array_key_exists('batch_limit', $payload) ? (int) $payload['batch_limit'] : 200;

try {
    $result = avesmapsMediaLicenseMigrationRun($pdo, ['dry_run' => $dryRun, 'batch_limit' => $batchLimit]);
} catch (Throwable $exception) {
    avesmapsServerErrorResponse($exception, 'media-license-migration run');
}

avesmapsJsonResponse(200, [
    'ok' => true,
    'dry_run' => $result['dry_run'],
    'surfaces' => $result['surfaces'],
    'sichtbarkeitswechsel' => $result['sichtbarkeitswechsel'],
    'coat_ohne_lizenz' => $result['coat_ohne_lizenz'],
]);
