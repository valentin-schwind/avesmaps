<?php

declare(strict_types=1);

// Öffentlich, nur lesend: die Meilensteine für den „Änderungsverlauf" im Hinweise-Dialog.
// Logik + Startbestand: api/_internal/app/changelog.php. Schreibpfad: api/edit/map/changelog.php.
//
// GET -> { ok: true, entries: [ { date, title, body, category, sort_order }, ... ], source }
//
// `source` sagt, woher die Liste kommt: "db", sobald die Tabelle steht, sonst "seed". Das ist kein
// Debug-Ausgang, sondern die einzige Möglichkeit, nach einem Deploy zu erkennen, ob der Verlauf
// schon in der Datenbank angekommen ist — von außen sehen beide Fassungen identisch aus.
//
// KEIN DDL hier (Begründung im Kopf der Bibliothek): dieser Pfad läuft für jeden Besucher, der die
// Hinweise öffnet, und ein CREATE TABLE je Aufruf kostet auf STRATO messbar.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/changelog.php';

try {
    // Wie bei den Ortsarten: ein leerer Config ist strikt RESTRIKTIVER, nie offener --
    // avesmapsGetAllowedOrigins([]) ist [], fremde Herkunft fliegt raus, gleiche Herkunft läuft.
    // Damit antwortet der Verlauf auch aus einer frischen Arbeitskopie ohne config.local.php.
    $config = [];
    try {
        $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    } catch (Throwable $ignored) {
    }

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Änderungsverlauf nicht laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind für den Änderungsverlauf erlaubt.');
    }

    $entries = null;
    try {
        $entries = avesmapsChangelogReadPublished(avesmapsCreatePdo($config['database'] ?? []));
    } catch (Throwable $ignored) {
        // Keine Datenbank erreichbar: der Verlauf steht trotzdem. Ein Fenster mit dem Startbestand
        // ist ungleich besser als eines mit einer Fehlermeldung — die Einträge sind ohnehin
        // Geschichte und ändern sich nicht.
    }

    // Leere Tabelle zählt wie keine: sonst zeigte ein angelegtes, aber noch nicht gefülltes Schema
    // ein leeres Fenster, das behauptet, es sei nie etwas passiert.
    $source = 'db';
    if ($entries === null || $entries === []) {
        $entries = avesmapsChangelogPrepareEntries(avesmapsChangelogSeed());
        $source = 'seed';
    }

    // Zehn Minuten geteilter Cache: der Verlauf wächst um wenige Einträge pro Woche, und dieser
    // Endpunkt hängt am Öffnen der Hinweise — er soll die PHP-Worker nicht beschäftigen.
    header('Cache-Control: public, max-age=600');
    avesmapsJsonResponse(200, ['ok' => true, 'entries' => $entries, 'source' => $source]);
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Der Änderungsverlauf konnte nicht geladen werden.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Der Änderungsverlauf konnte nicht geladen werden.');
}
