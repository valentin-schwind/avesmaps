<?php

declare(strict_types=1);

/**
 * POST /api/svg-export-deposit.php -- einen fertigen SVG-Abzug hinterlegen.
 * ---------------------------------------------------------------------------------------
 * Gegenstueck zu GET /api/svg-export.php: hier hinein, dort hinaus.
 *
 * 🔴 ZWEI AUFRUFER, EIN ENDPUNKT.
 *   1. Der Owner auf /edit/svg-export.php -- angemeldete Sitzung mit Faehigkeit `admin`,
 *      derselbe Riegel wie die Exportseite selbst.
 *   2. Die naechtliche Routine -- `Authorization: Bearer <svg_export.deposit_token>`.
 *
 * 🔴 UND DAS IST EIN ANDERER TOKEN ALS DER ZUM LESEN. `svg_export.token` darf ausschliesslich
 * lesen; wer ihn hat, kann nichts hinterlegen. Ein gemeinsamer Token haette aus jedem
 * Leserecht ein Schreibrecht gemacht -- und der Lesetoken geht an fremde Werkzeuge.
 *
 * Ablauf (gestueckelt, weil ein Abzug ~8,6 MB hat und ein einzelner POST auf STRATO in
 * `post_max_size` laeuft -- deren Fehlerbild ein LEERER Rumpf ohne Ausnahme ist):
 *   POST ?action=start                       -> {ok, upload_id}
 *   POST ?action=chunk&upload_id=…  (roh)    -> {ok, bytes}
 *   POST ?action=finish&upload_id=… (JSON)   -> {ok, datei, bytes, quelle, aufgeraeumt}
 */

require __DIR__ . '/_internal/bootstrap.php';
require_once __DIR__ . '/_internal/app/svg-export-hinterlegen.php';

// 🔴 Kein CORS: ein Schreibtoken gehoert nicht in eine fremde Webseite.
$anfrageArt = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($anfrageArt !== 'POST') {
    header('Allow: POST');
    avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist erlaubt.');
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
} catch (Throwable) {
    $config = [];
}

$bereich = is_array($config['svg_export'] ?? null) ? $config['svg_export'] : [];
$ablageToken = trim((string) ($bereich['deposit_token'] ?? ''));
$gegeben = avesmapsSvgExportBearerAusAnfrage($_SERVER);

$erlaubt = false;
$wer = '';

// Weg 1: die Routine mit ihrem eigenen Token.
if ($ablageToken !== '' && $gegeben !== '' && hash_equals($ablageToken, $gegeben)) {
    $erlaubt = true;
    $wer = 'routine';
}

// Weg 2: eine angemeldete Admin-Sitzung. ⚠️ Die Auth-Datei startet eine Session und wird
// deshalb NUR geladen, wenn kein Token gepasst hat -- die Routine soll keine Session anfassen.
if (!$erlaubt && $gegeben === '') {
    require_once __DIR__ . '/_internal/auth.php';
    $benutzer = avesmapsCurrentUser();
    if ($benutzer !== null && avesmapsUserCan($benutzer, 'admin')) {
        $erlaubt = true;
        $wer = (string) ($benutzer['username'] ?? 'admin');
    }
}

if (!$erlaubt) {
    header('WWW-Authenticate: Bearer realm="avesmaps-svg-export-deposit"');
    avesmapsErrorResponse(401, 'unauthorized',
        'Admin-Sitzung oder gueltiger Ablage-Token erforderlich.');
}

$verzeichnis = avesmapsSvgExportEnsureAblage();
$aktion = (string) ($_GET['action'] ?? '');

try {
    if ($aktion === 'start') {
        // Bei jedem Start die Leichen abgebrochener Versuche wegraeumen -- sonst waechst das
        // Verzeichnis um 8 MB je Fehlversuch.
        avesmapsSvgExportUploadsAufraeumen($verzeichnis, time());
        avesmapsJsonResponse(200, ['ok' => true, 'upload_id' => bin2hex(random_bytes(16))]);
    }

    $uploadId = (string) ($_GET['upload_id'] ?? '');

    if ($aktion === 'chunk') {
        // 💣 `php://input` gestreamt, nicht `file_get_contents` -- ein Stueck ist zwar nur ein
        // paar MB, aber der Punkt dieses Endpunkts ist gerade, nie den ganzen Abzug im
        // Speicher zu halten.
        $roh = (string) file_get_contents('php://input');
        $bytes = avesmapsSvgExportStueckAnhaengen($verzeichnis, $uploadId, $roh);
        avesmapsJsonResponse(200, ['ok' => true, 'bytes' => $bytes]);
    }

    if ($aktion === 'finish') {
        $angaben = [];
        try {
            $angaben = avesmapsReadJsonRequest();
        } catch (Throwable) {
            $angaben = [];
        }
        // 🔴 Die Herkunft bestimmt der RIEGEL, nicht die Anfrage. Wer sich mit dem
        // Routine-Token anmeldet, ist die Routine; eine Admin-Sitzung ist Handarbeit. Liesse
        // man sie im Rumpf mitschicken, koennte ein Handabzug als Routine auftreten -- und
        // genau diese Angabe soll ja die beiden auseinanderhalten.
        $angaben['quelle'] = $wer === 'routine' ? 'routine' : 'manuell';
        $angaben['hinterlegt_von'] = $wer;

        $zeiger = avesmapsSvgExportUebernehmen($verzeichnis, $uploadId, $angaben);
        avesmapsJsonResponse(200, ['ok' => true] + $zeiger);
    }

    avesmapsErrorResponse(400, 'unknown_action', 'Unbekannte Aktion.');
} catch (InvalidArgumentException $fehler) {
    avesmapsErrorResponse(400, 'bad_request', $fehler->getMessage());
} catch (RuntimeException $fehler) {
    // ⚠️ Die Meldung ist hier ABSICHTLICH sprechend: sie kommt aus unseren eigenen Pruefungen
    // („zu klein", „kein SVG"), nicht aus einer Ausnahme des Systems, und ohne sie stuende der
    // Owner vor einem Knopf, der nichts sagt. Keine Ausnahmetexte, kein getMessage() fremder
    // Herkunft (AGENTS.md sec.10, Info-Leak in mehreren Editor-Endpunkten).
    avesmapsErrorResponse(422, 'deposit_rejected', $fehler->getMessage());
}
