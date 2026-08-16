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
 * POST { "dry_run"?: bool, "batch_limit"?: int, "cursors"?: {<flaeche>: <cursor>} }
 *   -> { ok:true, dry_run:bool, surfaces:{...surface.naechster_cursor/offen je Flaeche...},
 *        sichtbarkeitswechsel:[...], coat_ohne_lizenz:[...], coat_ohne_lizenz_gesamt:int }
 *
 * 🔴 dry_run ist die VORGABE -- geschrieben wird nur, wenn der Aufrufer ausdruecklich dry_run:false
 * sendet. Ein fehlendes Feld, ein truthy Nicht-false-Wert oder ein Tippfehler bleiben allesamt die
 * Vorschau (dieselbe Regel wie in avesmapsMediaLicenseMigrationRun() selbst: `!== false`).
 *
 * 🔧 Fix-Runde 2 (Resumierbarkeit, Critical 2): ein Aufruf deckt genau EIN batch_limit-Fenster je
 * Flaeche ab. `surfaces[<flaeche>].offen` sagt, ob noch etwas aussteht; `surfaces[<flaeche>]
 * .naechster_cursor` wird beim naechsten Aufruf unveraendert unter `cursors[<flaeche>]` zurueckgereicht
 * (fuer territory_coat ein Objekt `{staging, override}`, sonst eine Zahl). Derselbe client-treibt-die-
 * Schleife-Ablauf wie bei database-backup.php `step`.
 *
 * ⚡ Betriebshinweis (Fix-Runde 2, N3): bei `dry_run:false` prueft avesmapsMediaLicenseMigrationRun()
 * VOR jedem Schreibvorgang den ganzen Bestand neu (die Sichtbarkeits-Sperre gilt je Lauf, nicht je
 * Fenster) -- das kostet Durchsatz, nicht Zeit je Aufruf (gemessen: Vorlauf 230 ms, scharfer Lauf
 * 249 ms). Bei `batch_limit` 200 (Vorgabe) braucht ein vollstaendiger Durchlauf 24 Aufrufe und liest
 * dabei insgesamt rund 116.000 Zeilen statt 4.653, weil jeder Aufruf den Vorlauf wiederholt. Mit
 * `batch_limit: 2000` (das eingebaute Maximum) sind es gemessen 3 Aufrufe / 334 ms. Wer die Migration
 * von Hand durchklickt, sollte also 2000 setzen, nicht die Vorgabe stehen lassen.
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
// Wird unveraendert durchgereicht, wie ihn der VORHERIGE Aufruf unter surfaces[<flaeche>].naechster_cursor
// zurueckgegeben hat -- der Endpunkt validiert die Form nicht im Detail, avesmapsMediaLicenseMigrationRun()
// tut das selbst (jeder Wert wird auf int bzw. das staging/override-Paar gecastet).
$cursors = is_array($payload['cursors'] ?? null) ? $payload['cursors'] : [];

try {
    $result = avesmapsMediaLicenseMigrationRun($pdo, [
        'dry_run' => $dryRun, 'batch_limit' => $batchLimit, 'cursors' => $cursors,
    ]);
} catch (Throwable $exception) {
    avesmapsServerErrorResponse($exception, 'media-license-migration run');
}

avesmapsJsonResponse(200, [
    'ok' => true,
    'dry_run' => $result['dry_run'],
    'surfaces' => $result['surfaces'],
    'sichtbarkeitswechsel' => $result['sichtbarkeitswechsel'],
    'coat_ohne_lizenz' => $result['coat_ohne_lizenz'],
    'coat_ohne_lizenz_gesamt' => $result['coat_ohne_lizenz_gesamt'],
]);
