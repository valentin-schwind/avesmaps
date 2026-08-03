<?php

declare(strict_types=1);

// Schreibpfad für den Änderungsverlauf. Logik + Startbestand: api/_internal/app/changelog.php,
// öffentlicher Lesepfad: api/app/changelog.php.
//
// POST { action: "list" }                      -> alle Einträge, auch unveröffentlichte, + latest_source_ref
// POST { action: "save", entry: { … } }        -> anlegen (ohne id) oder ändern (mit id)
// POST { action: "delete", id }                -> löschen
//
// Dieser Pfad — und NUR dieser — legt die Tabelle an und spielt beim ersten Mal die 42 Meilensteine
// des Startbestands ein. Danach ist die Tabelle die Wahrheit und die Konstante nur noch Geschichte.
//
// Gedacht ist er für die Routine „Avesmaps feature updates": sie liest über `list` den
// `latest_source_ref` (den Commit, bis zu dem der Verlauf reicht), nimmt die Commits seit dann und
// hängt das Erzählenswerte per `save` an. Alles capability-gated ('edit') wie jeder Editor-Schreibweg.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/changelog.php';

/**
 * Prüft und normalisiert einen eingehenden Eintrag. Gibt eine Fehlermeldung als String zurück,
 * wenn er nicht taugt — der Aufrufer macht daraus die 400er-Antwort.
 *
 * @param array<string, mixed> $raw
 * @return array{0: array<string, mixed>|null, 1: string}
 */
function avesmapsChangelogValidateInput(array $raw): array
{
    $date = avesmapsNormalizeSingleLine((string) ($raw['date'] ?? $raw['entry_date'] ?? ''), 10);
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
        return [null, 'Das Datum muss die Form JJJJ-MM-TT haben.'];
    }

    $title = avesmapsNormalizeSingleLine((string) ($raw['title'] ?? ''), 190);
    if ($title === '') {
        return [null, 'Ein Eintrag braucht einen Titel.'];
    }

    $category = strtolower(avesmapsNormalizeSingleLine((string) ($raw['category'] ?? ''), 40));
    if ($category !== '' && !in_array($category, AVESMAPS_CHANGELOG_CATEGORIES, true)) {
        return [null, 'Unbekannte Rubrik: ' . $category];
    }

    // Der Fließtext darf Absätze haben, also NICHT durch avesmapsNormalizeSingleLine — der würde
    // die Zeilenumbrüche schlucken. Gekappt wird trotzdem: TEXT fasst mehr, aber ein Eintrag, der
    // das Fenster füllt, ist keine Meldung mehr.
    $body = trim((string) ($raw['body'] ?? ''));
    if (function_exists('mb_substr')) {
        $body = mb_substr($body, 0, 2000);
    } else {
        $body = substr($body, 0, 2000);
    }

    return [[
        'entry_date' => $date,
        'title' => $title,
        'body' => $body,
        'category' => $category,
        'is_published' => !empty($raw['is_published'] ?? true) ? 1 : 0,
        'sort_order' => (int) ($raw['sort_order'] ?? $raw['order'] ?? 0),
        'source_ref' => avesmapsNormalizeSingleLine((string) ($raw['source_ref'] ?? ''), 190),
    ], ''];
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf den Änderungsverlauf nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist für diesen Endpoint erlaubt.');
    }

    avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);

    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    // Tabelle und Startbestand entstehen beim ERSTEN Schreibzugriff, welcher Art auch immer —
    // damit ein `list` nicht auf eine leere Welt schaut und die Routine nichts anzuhängen findet.
    // avesmapsChangelogSeedIfEmpty() ist idempotent: eine gefüllte Tabelle rührt es nicht an.
    avesmapsChangelogEnsureTable($pdo);
    $seeded = avesmapsChangelogSeedIfEmpty($pdo);

    switch ($action) {
        case 'list':
            $rows = $pdo->query(
                'SELECT id, entry_date, title, body, category, is_published, sort_order, source_ref, updated_at
                 FROM changelog_entry
                 ORDER BY entry_date DESC, sort_order ASC, id ASC'
            )->fetchAll(PDO::FETCH_ASSOC) ?: [];

            // Der Anschluss für die Routine: der source_ref des JÜNGSTEN Eintrags, der einen hat.
            // "seed" zählt nicht als Commit — nach dem Startbestand fängt sie beim Anfang an und
            // lässt sich vom Datum des obersten Eintrags leiten.
            $latestSourceRef = '';
            foreach ($rows as $row) {
                $ref = trim((string) ($row['source_ref'] ?? ''));
                if ($ref !== '' && $ref !== 'seed') {
                    $latestSourceRef = $ref;
                    break;
                }
            }

            avesmapsJsonResponse(200, [
                'ok' => true,
                'entries' => $rows,
                'latest_source_ref' => $latestSourceRef,
                'latest_date' => (string) ($rows[0]['entry_date'] ?? ''),
                'seeded' => $seeded,
                'categories' => AVESMAPS_CHANGELOG_CATEGORIES,
            ]);
            // no break -- avesmapsJsonResponse beendet die Anfrage.

        case 'save':
            $input = is_array($payload['entry'] ?? null) ? $payload['entry'] : [];
            [$entry, $error] = avesmapsChangelogValidateInput($input);
            if ($entry === null) {
                avesmapsErrorResponse(400, 'invalid_request', $error);
            }

            $id = (int) ($input['id'] ?? $payload['id'] ?? 0);
            if ($id > 0) {
                $statement = $pdo->prepare(
                    'UPDATE changelog_entry
                     SET entry_date = :entry_date, title = :title, body = :body, category = :category,
                         is_published = :is_published, sort_order = :sort_order, source_ref = :source_ref
                     WHERE id = :id'
                );
                $statement->execute($entry + ['id' => $id]);
                if ($statement->rowCount() === 0) {
                    // rowCount 0 heißt bei MySQL AUCH "identisch gespeichert" -- also nachsehen,
                    // statt einen unveränderten Speichervorgang als 404 zu melden.
                    $exists = $pdo->prepare('SELECT COUNT(*) FROM changelog_entry WHERE id = :id');
                    $exists->execute([':id' => $id]);
                    if ((int) $exists->fetchColumn() === 0) {
                        avesmapsErrorResponse(404, 'not_found', 'Diesen Eintrag gibt es nicht.');
                    }
                }
            } else {
                $statement = $pdo->prepare(
                    'INSERT INTO changelog_entry
                        (entry_date, title, body, category, is_published, sort_order, source_ref)
                     VALUES (:entry_date, :title, :body, :category, :is_published, :sort_order, :source_ref)'
                );
                $statement->execute($entry);
                $id = (int) $pdo->lastInsertId();
            }

            avesmapsJsonResponse(200, ['ok' => true, 'id' => $id]);
            // no break

        case 'delete':
            $id = (int) ($payload['id'] ?? 0);
            if ($id <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'id ist erforderlich.');
            }
            $statement = $pdo->prepare('DELETE FROM changelog_entry WHERE id = :id');
            $statement->execute([':id' => $id]);
            avesmapsJsonResponse(200, ['ok' => true, 'deleted' => $statement->rowCount()]);
            // no break

        default:
            avesmapsErrorResponse(400, 'invalid_request', 'Unbekannte Aktion: ' . $action);
    }
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Der Änderungsverlauf konnte nicht gespeichert werden.');
} catch (Throwable $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Der Änderungsverlauf konnte nicht gespeichert werden.');
}
