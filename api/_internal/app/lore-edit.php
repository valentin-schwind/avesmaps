<?php

declare(strict_types=1);

// Schreibpfad für Flora, Fauna, Spezies und Handelswaren (Editor).
// Design: docs/flora-fauna-handelswaren-design.md. Lesepfad: _internal/app/lore.php.
//
// ÜBERLEBENSREGELN -- diese Datei erzeugt genau die Zustände, die der Reconcile
// (wiki/lore-sync.php, avesmapsLoreChildPlan/avesmapsLoreFieldPlan) bereits
// respektiert und die dort unit-getestet sind:
//
//   Ort HINZUFÜGEN      -> origin='manual'      Der Sync fasst manuelle Zeilen nie an.
//   Wiki-Ort ENTFERNEN  -> status='suppressed'  GRABSTEIN. Ein späterer Sync belebt
//                                               ihn nicht wieder, auch wenn das Wiki
//                                               ihn weiter nennt.
//   Manuellen Ort ENTF. -> DELETE               Er stammt von niemandem sonst.
//   Feld ÜBERSCHREIBEN  -> field_origins[f]='manual'
//
// Das ist der ganze Trick: Der Editor schreibt keine Sonderfälle, er setzt die
// Marker, die der Sync ohnehin liest. Deshalb kann eine Handkorrektur nicht durch
// den nächsten „Natur & Waren syncen"-Lauf verlorengehen.
//
// Side-effect-free on include. Jede Funktion nimmt ihr PDO entgegen.

require_once __DIR__ . '/lore.php';

/** Felder, die von Hand überschrieben werden dürfen. */
const AVESMAPS_LORE_EDITABLE_FIELDS = ['name', 'gruppe', 'typ', 'lebensraum', 'synonyme'];

/** Zustände, die ein Eintrag annehmen darf. */
const AVESMAPS_LORE_ENTRY_STATES = ['active', 'suppressed'];

/**
 * Vollständige Editoransicht eines Eintrags: Stammdaten und ALLE Orte (auch die
 * unterdrückten -- der Editor muss seine eigenen Grabsteine sehen können).
 *
 * Quellen sind bewusst NICHT dabei: sie kommen aus dem geteilten Quellensystem, das
 * seinen eigenen Endpoint und sein eigenes Bauteil mitbringt (siehe unten).
 *
 * @return array<string,mixed>|null
 */
function avesmapsLoreReadEntryDetail(PDO $pdo, string $wikiKey): ?array
{
    $wikiKey = trim($wikiKey);
    if ($wikiKey === '') {
        return null;
    }

    $statement = $pdo->prepare('SELECT * FROM lore_entry WHERE wiki_key = :wk LIMIT 1');
    $statement->execute(['wk' => $wikiKey]);
    $entry = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($entry)) {
        return null;
    }

    $fieldOrigins = [];
    if (is_string($entry['field_origins_json'] ?? null)) {
        $decoded = json_decode((string) $entry['field_origins_json'], true);
        if (is_array($decoded)) {
            $fieldOrigins = $decoded;
        }
    }

    $placeStatement = $pdo->prepare(
        'SELECT place_wiki_key, place_title, relation, origin, status, sort_order
         FROM lore_place WHERE entry_wiki_key = :wk ORDER BY status, sort_order, place_title'
    );
    $placeStatement->execute(['wk' => $wikiKey]);

    // Quellen holt der Editor NICHT hier ab. Seit 2026-07-22 haengen Lore-Quellen im
    // geteilten System, und die Oberflaeche dafuer ist das gemeinsame Bauteil
    // (mountFeatureSourceEditor -> api/edit/map/feature-sources.php), genau wie beim
    // Siedlungseditor. Sie hier ein zweites Mal mitzuliefern hiesse, zwei Quellen der
    // Wahrheit im selben Dialog zu haben -- eine davon waere nach dem ersten
    // Hinzufuegen veraltet.

    $merkmale = [];
    if (is_string($entry['merkmale_json'] ?? null)) {
        $decoded = json_decode((string) $entry['merkmale_json'], true);
        if (is_array($decoded)) {
            $merkmale = $decoded;
        }
    }

    return [
        'wiki_key' => (string) $entry['wiki_key'],
        'kind' => (string) $entry['kind'],
        'name' => (string) $entry['name'],
        'wiki_url' => (string) ($entry['wiki_url'] ?? ''),
        'gruppe' => (string) ($entry['gruppe'] ?? ''),
        'typ' => (string) ($entry['typ'] ?? ''),
        'lebensraum' => (string) ($entry['lebensraum'] ?? ''),
        'synonyme' => (string) ($entry['synonyme'] ?? ''),
        'origin' => (string) ($entry['origin'] ?? 'wiki'),
        'status' => (string) ($entry['status'] ?? 'active'),
        'field_origins' => $fieldOrigins,
        'merkmale' => $merkmale,
        'places' => $placeStatement->fetchAll(PDO::FETCH_ASSOC) ?: [],
    ];
}

/**
 * Ort von Hand zuordnen. Immer origin='manual', damit der Sync ihn in Ruhe lässt.
 * Existiert bereits ein unterdrückter Wiki-Ort mit demselben Schlüssel, wird dieser
 * REAKTIVIERT statt eine zweite Zeile anzulegen -- sonst stünde derselbe Ort zweimal
 * da, einmal als Grabstein und einmal als Handarbeit.
 *
 * @return array<string,mixed>
 */
function avesmapsLoreAddPlace(PDO $pdo, string $entryKey, string $placeTitle, string $relation = 'verbreitung'): array
{
    $entryKey = trim($entryKey);
    $placeTitle = trim($placeTitle);
    if ($entryKey === '' || $placeTitle === '') {
        return ['ok' => false, 'error' => 'invalid_request'];
    }
    $placeKey = avesmapsLoreSlugForTitle($placeTitle);
    if ($placeKey === '') {
        return ['ok' => false, 'error' => 'invalid_place'];
    }
    if (!in_array($relation, ['verbreitung', 'vorkommen', 'herkunft', 'regionen'], true)) {
        $relation = 'verbreitung';
    }

    $existing = $pdo->prepare(
        'SELECT origin, status FROM lore_place
         WHERE entry_wiki_key = :wk AND place_wiki_key = :pk AND relation = :rel LIMIT 1'
    );
    $existing->execute(['wk' => $entryKey, 'pk' => $placeKey, 'rel' => $relation]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);

    if (is_array($row)) {
        if ((string) $row['status'] === 'suppressed') {
            $pdo->prepare(
                'UPDATE lore_place SET status = \'active\'
                 WHERE entry_wiki_key = :wk AND place_wiki_key = :pk AND relation = :rel'
            )->execute(['wk' => $entryKey, 'pk' => $placeKey, 'rel' => $relation]);

            return ['ok' => true, 'action' => 'restored', 'place_wiki_key' => $placeKey];
        }

        return ['ok' => true, 'action' => 'unchanged', 'place_wiki_key' => $placeKey];
    }

    $pdo->prepare(
        'INSERT INTO lore_place (entry_wiki_key, place_wiki_key, place_title, relation, sort_order, origin, status)
         VALUES (:wk, :pk, :pt, :rel, 9999, \'manual\', \'active\')
         ON DUPLICATE KEY UPDATE status = \'active\', place_title = VALUES(place_title)'
    )->execute([
        'wk' => $entryKey,
        'pk' => $placeKey,
        'pt' => mb_substr($placeTitle, 0, 300, 'UTF-8'),
        'rel' => $relation,
    ]);

    return ['ok' => true, 'action' => 'added', 'place_wiki_key' => $placeKey];
}

/**
 * Ort entfernen. Ein WIKI-Ort wird nicht gelöscht, sondern zum Grabstein
 * (status='suppressed') -- sonst brächte ihn der nächste Sync zurück und die
 * Entscheidung des Editors wäre wirkungslos. Ein manueller Ort wird gelöscht.
 *
 * @return array<string,mixed>
 */
function avesmapsLoreRemovePlace(PDO $pdo, string $entryKey, string $placeKey, string $relation): array
{
    $entryKey = trim($entryKey);
    $placeKey = trim($placeKey);
    if ($entryKey === '' || $placeKey === '') {
        return ['ok' => false, 'error' => 'invalid_request'];
    }

    $statement = $pdo->prepare(
        'SELECT origin FROM lore_place
         WHERE entry_wiki_key = :wk AND place_wiki_key = :pk AND relation = :rel LIMIT 1'
    );
    $statement->execute(['wk' => $entryKey, 'pk' => $placeKey, 'rel' => $relation]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return ['ok' => false, 'error' => 'not_found'];
    }

    if ((string) ($row['origin'] ?? 'wiki') === 'wiki') {
        $pdo->prepare(
            'UPDATE lore_place SET status = \'suppressed\'
             WHERE entry_wiki_key = :wk AND place_wiki_key = :pk AND relation = :rel'
        )->execute(['wk' => $entryKey, 'pk' => $placeKey, 'rel' => $relation]);

        return ['ok' => true, 'action' => 'suppressed'];
    }

    $pdo->prepare(
        'DELETE FROM lore_place
         WHERE entry_wiki_key = :wk AND place_wiki_key = :pk AND relation = :rel AND origin <> \'wiki\''
    )->execute(['wk' => $entryKey, 'pk' => $placeKey, 'rel' => $relation]);

    return ['ok' => true, 'action' => 'deleted'];
}

/**
 * Feld von Hand setzen. Markiert es in field_origins_json als 'manual', womit der
 * Sync es ab sofort in Ruhe lässt. Ein LEERER Wert hebt die Übersteuerung wieder auf:
 * die Marke fällt weg, und der nächste Sync darf das Feld wieder füllen.
 *
 * @return array<string,mixed>
 */
function avesmapsLoreSetField(PDO $pdo, string $entryKey, string $field, string $value): array
{
    $entryKey = trim($entryKey);
    if ($entryKey === '' || !in_array($field, AVESMAPS_LORE_EDITABLE_FIELDS, true)) {
        return ['ok' => false, 'error' => 'invalid_field'];
    }

    $statement = $pdo->prepare('SELECT field_origins_json FROM lore_entry WHERE wiki_key = :wk LIMIT 1');
    $statement->execute(['wk' => $entryKey]);
    $current = $statement->fetch(PDO::FETCH_ASSOC);
    if (!is_array($current)) {
        return ['ok' => false, 'error' => 'not_found'];
    }

    $origins = [];
    if (is_string($current['field_origins_json'] ?? null)) {
        $decoded = json_decode((string) $current['field_origins_json'], true);
        if (is_array($decoded)) {
            $origins = $decoded;
        }
    }

    $value = trim($value);
    if ($value === '') {
        unset($origins[$field]); // Übersteuerung aufheben -> der Sync darf wieder
    } else {
        $origins[$field] = 'manual';
    }

    // name darf nicht leer werden -- eine Zeile ohne Namen ist im Editor unauffindbar.
    if ($field === 'name' && $value === '') {
        return ['ok' => false, 'error' => 'name_required'];
    }

    $pdo->prepare(
        'UPDATE lore_entry SET ' . $field . ' = :value, field_origins_json = :fo WHERE wiki_key = :wk'
    )->execute([
        'value' => $value,
        'fo' => json_encode($origins, JSON_UNESCAPED_UNICODE),
        'wk' => $entryKey,
    ]);

    return ['ok' => true, 'field' => $field, 'value' => $value, 'overridden' => $value !== ''];
}

/**
 * Eintrag unterdrücken oder wieder zeigen. 'suppressed' blendet ihn überall aus,
 * ohne ihn zu löschen -- er kann in Orts- und Quellenlisten referenziert sein, und
 * der nächste Sync würde ihn ohnehin neu anlegen.
 *
 * @return array<string,mixed>
 */
function avesmapsLoreSetEntryStatus(PDO $pdo, string $entryKey, string $status): array
{
    $entryKey = trim($entryKey);
    if ($entryKey === '' || !in_array($status, AVESMAPS_LORE_ENTRY_STATES, true)) {
        return ['ok' => false, 'error' => 'invalid_request'];
    }
    $statement = $pdo->prepare('UPDATE lore_entry SET status = :st WHERE wiki_key = :wk');
    $statement->execute(['st' => $status, 'wk' => $entryKey]);

    return ['ok' => true, 'status' => $status, 'changed' => $statement->rowCount() > 0];
}
