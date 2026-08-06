<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/bootstrap.php';
require_once __DIR__ . '/../../_internal/map/report-audit.php';
// A39: avesmapsWriteMapAuditLog() wohnt hier. Gross, aber ohne Nebenwirkung beim Einbinden -- die
// Datei definiert nur Funktionen, und diese Tuer wird von einem Werkzeug gerufen, nicht von Besuchern.
require_once __DIR__ . '/../../_internal/map/features.php';

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

    // A39: der Zustand VOR der Aenderung, fuer die Spur. Muss vor dem UPDATE gelesen werden -- danach
    // ist `before` nicht mehr da.
    // ⚠️ Diese Zeile entscheidet NICHTS. Der Riegel ist das `AND status = 'neu'` im UPDATE unten, und
    // das ist Absicht: eine Pruefung hier und ein Schreiben dort waeren zwei Schritte, zwischen die
    // ein zweiter Aufrufer passt. Findet das SELECT nichts, laeuft das UPDATE trotzdem und meldet
    // ueber rowCount ehrlich 404 -- nur die Spur faellt dann aus, und das ist die richtige
    // Rangfolge: lieber eine Entscheidung ohne Protokollzeile als ein Protokoll ohne Entscheidung.
    $beforeStatement = $pdo->prepare('SELECT * FROM location_reports WHERE id = :report_id LIMIT 1');
    $beforeStatement->execute(['report_id' => $reportId]);
    $reportRow = $beforeStatement->fetch();
    $reportRow = is_array($reportRow) ? $reportRow : [];

    // 💣 AND status = 'neu' -- THIS ENDPOINT COULD OVERWRITE A DECISION A HUMAN HAD ALREADY MADE
    // (finding A39). The editor carries this guard in every one of its write paths; the import door
    // did not, so a token could move an approved report to rejected -- silently, with no
    // reviewed_by, no review_note, and no audit entry anywhere. A machine replacing an editor's
    // judgement is bad; doing it without a trace is what made it a finding.
    //
    // ⚠️ IT DOES CHANGE WHAT A REPEATED CALL ANSWERS, and the first version of this comment claimed
    // the opposite. That claim checked the connection options -- no MYSQL_ATTR_FOUND_ROWS, so
    // rowCount() counts CHANGED rows -- and never looked at the SET list one line above it.
    // `reviewed_at = CURRENT_TIMESTAMP` is in that list, and MySQL calls a row changed when ANY
    // assigned column takes a different value. So a decided report re-sent with the status it
    // already has used to answer 200 "aktualisiert", every time, a second later.
    //
    // ⭐ That is not a loss, it is the finding. Each of those repeats silently moved reviewed_at
    // forward on a decision somebody else had made -- the timestamp drifted away from the moment of
    // the decision, quietly, with nothing recording it. 404 is the honest answer.
    //
    // ⚠️ The rowCount reasoning is MySQL's, and this project's PDO factory also accepts pgsql, where
    // rowCount() reports MATCHED rows and the distinction never existed. The guard is right under
    // both; only the old comment's arithmetic was driver-specific.
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

    // 💣 A39, ERSTE HAELFTE: DIESE TUER SCHRIEB NULL PROTOKOLLZEILEN. Mit gueltigem Token liess sich
    // jede Meldung entscheiden, ohne dass irgendwo stand, dass es geschah -- A4 hatte genau das fuer
    // die Editor-Tuer geschlossen, diese blieb offen. Jetzt geht beides in DASSELBE map_audit_log.
    //
    // 🔴 `null` als Urheber ist der Owner-Entscheid (b) vom 06.08.2026: kein technischer Benutzer,
    // der Eintrag traegt den Vermerk „import". Es war keine Person, und der Eintrag soll keine
    // behaupten.
    //
    // ⚠️ ERST NACH dem rowCount-Riegel. Oberhalb stuende eine Zeile im Protokoll fuer eine
    // Entscheidung, die gar nicht stattgefunden hat -- ein Protokoll, das mehr behauptet als
    // geschehen ist, ist schlimmer als keines.
    avesmapsLogReportModeration($pdo, $reportRow, 'location_reports', $newStatus, null, null);

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
