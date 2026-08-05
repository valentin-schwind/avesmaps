<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require_once __DIR__ . '/../../_internal/map/report-audit.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    $configuredImportToken = avesmapsGetConfiguredImportApiToken($config);
    if ($configuredImportToken === '') {
        avesmapsErrorResponse(503, 'service_unavailable', 'Die Import-API ist auf dem Server noch nicht konfiguriert.');
    }

    $requestToken = avesmapsReadImportApiTokenFromRequest();
    if ($requestToken === '' || !hash_equals($configuredImportToken, $requestToken)) {
        avesmapsErrorResponse(401, 'unauthenticated', 'Das Import-API-Token fehlt oder ist ungueltig.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST-Anfragen sind fuer diesen Endpoint erlaubt.');
    }

    $requestPayload = avesmapsReadJsonRequest();
    $reportId = filter_var($requestPayload['report_id'] ?? null, FILTER_VALIDATE_INT);
    $newStatus = avesmapsNormalizeSingleLine((string) ($requestPayload['status'] ?? ''), 20);

    if ($reportId === false || $reportId <= 0) {
        avesmapsErrorResponse(400, 'invalid_request', 'Es wurde keine gueltige report_id uebergeben.');
    }

    // 💣 A WHITELIST, WHICH THIS ENDPOINT NEVER HAD (finding A33). The status was only cut to 20
    // characters, so a typo in the import tool wrote a status no surface in the project knows. The
    // report then shows up under "Bearbeitet" -- the list asks for status <> 'neu' -- wearing a
    // label nobody chose, and A32 means it cannot be moved back either.
    //
    // ⚠️ The accepted values are NAMED in the error, because this endpoint answers a machine and a
    // human reading its log: "ungueltig" alone would send someone to the source to find out what
    // is valid, and this is exactly the moment they should not have to.
    if (!avesmapsReportModerationStatusIsAllowed($newStatus)) {
        avesmapsErrorResponse(
            400,
            'invalid_request',
            'Ungueltiger Status. Erlaubt sind: ' . implode(', ', avesmapsReportModerationStatuses()) . '.'
        );
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    // 💣 AND status = 'neu' -- THIS ENDPOINT COULD OVERWRITE A DECISION A HUMAN HAD ALREADY MADE
    // (finding A39). The editor carries this guard in every one of its write paths; the import door
    // did not, so a token could move an approved report to rejected -- silently, with no
    // reviewed_by, no review_note, and no audit entry anywhere. A machine replacing an editor's
    // judgement is bad; doing it without a trace is what made it a finding.
    //
    // ⚠️ This does NOT cost idempotent retries anything, and that was checked rather than assumed:
    // the connection does not set MYSQL_ATTR_FOUND_ROWS, so rowCount() counts CHANGED rows. Writing
    // the status a report already carries has always returned 0 here and always answered 404. The
    // guard adds no new failure to a retry -- it only stops the case where the row would really
    // have changed under someone else's decision.
    $statement = $pdo->prepare(
        "UPDATE location_reports
        SET
            status = :status,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = :report_id
            AND status = 'neu'"
    );
    $statement->execute([
        'status' => $newStatus,
        'report_id' => $reportId,
    ]);

    // ⚠️ The wording is the editor's, word for word, because it is the same fact: with the guard in
    // place, zero rows means EITHER no such report OR one that is no longer open, and the endpoint
    // cannot tell the two apart without a second query it does not need. Saying "nicht gefunden"
    // alone would now be a lie for the more interesting of the two cases.
    if ($statement->rowCount() < 1) {
        avesmapsErrorResponse(
            404,
            'not_found',
            'Die gewuenschte Ortsmeldung wurde bereits verarbeitet oder nicht gefunden.'
        );
    }

    avesmapsJsonResponse(200, [
        'ok' => true,
        'message' => 'Der Status der Ortsmeldung wurde aktualisiert.',
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Der Status der Ortsmeldung konnte nicht aktualisiert werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Der Status der Ortsmeldung konnte nicht verarbeitet werden.');
}
