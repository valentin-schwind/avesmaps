<?php

declare(strict_types=1);

/**
 * Innerorts als eigenes Praedikat.
 * ===========================================================================
 * Ein Kartenpunkt der Ortsgroesse `gebaeude` oder `stadtviertel` kann zu einer STADT gehoeren,
 * unabhaengig davon, ob er selbst noch auf der Karte liegt (Owner-Entscheid, Spec §1: „innerorts
 * ist ein unabhaengiges Praedikat"). Die Ablage ist bewusst EIN Objekt, EINE Ablage
 * (Spec §3): „Von der Karte nehmen" legt keine Zeile in `settlement_place` an, sondern setzt
 * `is_active = 0` an genau demselben Datensatz und merkt sich das mit
 * `properties.innerorts.von_der_karte = true`. „Auf die Karte setzen" nimmt den Merker wieder weg.
 *
 * Entwurf: docs/superpowers/specs/2026-09-26-innerorts-praedikat-design.md §3-§6
 * Plan:    docs/superpowers/plans/2026-09-27-innerorts-schritt-1.md, Task 1
 *
 * 🔴 GESPEICHERT IST, WAS GILT (Spec §5, §9). Kein Leser rechnet den Wiki-Stand zur Laufzeit nach --
 * nur die Schreiber (`avesmapsInnerortsWikiNachziehen`, der Admin-Lauf) fragen je den Artikel.
 *
 * Ablage in `properties_json`:
 *   "innerorts": { "ort": "<public_id der Stadt>" }                    -- auf der Karte
 *   "innerorts": { "ort": "<public_id der Stadt>", "von_der_karte": true } -- von der Karte genommen
 *   "field_origins": { "innerorts": "wiki" | "manual" }                -- ueber den Hausstempler
 *
 * 💣 DIESE BIBLIOTHEK TUT KEINE FAEHIGKEITS-/SPERREN-PRUEFUNG. Anders als
 * `avesmapsDeleteMapFeature` (die Faehigkeit und Sperre selbst prueft) nehmen unsere vier
 * schreibenden Funktionen nur eine nackte Nutzer-ID -- die Endpunkt-Verdrahtung (Task 2, „Sperre/
 * Faehigkeit wie delete_feature") prueft das VOR dem Aufruf. Das entspricht der Signatur aus dem
 * Bauplan (`PDO, string $publicId, int $userId`), nicht `PDO, array $payload, array $user`.
 *
 * 🪤 KEINE HARTE ABHAENGIGKEIT AUF `api/_internal/map/features.php`. Jenes ist die grosse
 * Editor-Bibliothek und wird von jedem Aufrufer, der uns je ruft (der Editor-Endpunkt, die
 * update_point-Verdrahtung), ohnehin schon geladen -- genau das Argument, das
 * `api/_internal/app/settlement-places.php` fuer `avesmapsUuidV4` bereits fuehrt. Die paar
 * Helfer, die wir von dort brauchen (Revisionszaehler, Audit-Log-Schreiber, Kraftlinien-Riegel),
 * holen wir uns per `function_exists()` -- fehlen sie, wirft die Bibliothek LAUT statt still zu
 * schweigen (dieselbe Haltung wie beim `avesmapsUuidV4`-Check nebenan).
 */

require_once __DIR__ . '/../wiki/place-scope.php';
require_once __DIR__ . '/../map/field-origins.php';
// Fuer AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES ohnehin schon geladen (require_once, kein
// doppeltes Laden); und fuer `avesmapsInnerortsPropertiesDekodieren` -- KEINE eigene Abschrift
// dieses Decoders, der Name gehoert bereits dieser Datei (Task-1-Brief: „nicht duplizieren").
require_once __DIR__ . '/settlement-places.php';

/**
 * Die zwei Ortsgroessen, die „innerorts" tragen koennen. Deckungsgleich mit
 * `AVESMAPS_BAUWERKSKLASSEN` (api/_internal/ortsklassen.php) -- absichtlich eine EIGENE Konstante
 * (Brief-Vorgabe), nicht ein Alias: diese Datei soll ohne die grosse Ortsklassen-Datei ladbar
 * bleiben, und ein Test haelt beide Listen gegeneinander (siehe innerorts-test.php), damit sie
 * nie auseinanderlaufen.
 */
const AVESMAPS_INNERORTS_KLASSEN = ['gebaeude', 'stadtviertel'];

/**
 * REIN: traegt diese Ortsgroesse ueberhaupt ein „innerorts"-Feld?
 */
function avesmapsInnerortsIstKlasse(string $subtype): bool
{
    return in_array(trim($subtype), AVESMAPS_INNERORTS_KLASSEN, true);
}

/**
 * REIN: die public_id der Stadt, zu der dieser Punkt gehoert -- '' = keine Zugehoerigkeit.
 */
function avesmapsInnerortsOrtVon(array $properties): string
{
    $innerorts = is_array($properties['innerorts'] ?? null) ? $properties['innerorts'] : [];

    return trim((string) ($innerorts['ort'] ?? ''));
}

/**
 * REIN: wurde dieser Punkt „von der Karte genommen" (Merker `von_der_karte`)?
 *
 * ⚠️ Sagt nichts ueber `is_active` aus -- das ist die Spalte, dies ist der Merker. Ein Punkt kann
 * (kurzzeitig, ausserhalb dieser Bibliothek nie erzeugt) inaktiv OHNE Merker sein: ein normal
 * geloeschter Punkt. Dieser Merker ist die einzige Stelle, an der „bleibt Staette" von „ist ganz
 * weg" unterschieden wird (Spec §4.1).
 */
function avesmapsInnerortsVonDerKarte(array $properties): bool
{
    $innerorts = is_array($properties['innerorts'] ?? null) ? $properties['innerorts'] : [];

    return (bool) ($innerorts['von_der_karte'] ?? false);
}

/**
 * REIN: `properties.innerorts` (samt `field_origins.innerorts`) neu setzen oder loesen.
 *
 * @param string $ortId    public_id der Stadt; '' loest die Zugehoerigkeit
 * @param string $herkunft 'wiki' | 'manual' -- wer diesen Wert gesetzt hat
 *
 * 💣 Ein vorhandener `von_der_karte`-Merker WANDERT MIT, wenn die Stadt geaendert wird (Stätten-
 * Kasten „⇄"): ein von der Karte genommener Punkt bleibt von der Karte genommen, nur seine Stadt
 * wechselt. Wird $ortId auf '' gesetzt (Zugehoerigkeit geloest), faellt das ganze Feld -- ein
 * Punkt ohne Stadt kann keine Staette „von der Karte genommen" sein.
 *
 * Die Herkunft geht durch den vorhandenen Stempler (`avesmapsFieldOriginsStempeln`,
 * api/_internal/map/field-origins.php) -- keine Abschrift dieser Regel (Brief-Vorgabe).
 */
function avesmapsInnerortsSetzen(array $properties, string $ortId, string $herkunft): array
{
    $ortId = trim($ortId);
    $herkunft = trim($herkunft);
    $vorherOrt = avesmapsInnerortsOrtVon($properties);
    $vonDerKarte = avesmapsInnerortsVonDerKarte($properties);

    if ($ortId === '') {
        unset($properties['innerorts']);
    } else {
        $innerorts = ['ort' => $ortId];
        if ($vonDerKarte) {
            $innerorts['von_der_karte'] = true;
        }
        $properties['innerorts'] = $innerorts;
    }

    $bestand = is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [];
    $karte = avesmapsFieldOriginsStempeln(
        $bestand,
        ['innerorts' => $vorherOrt],
        ['innerorts' => $ortId],
        $herkunft === AVESMAPS_FIELD_ORIGIN_WIKI ? ['innerorts'] : []
    );
    if ($karte === []) {
        unset($properties['field_origins']);
    } else {
        $properties['field_origins'] = $karte;
    }

    return $properties;
}

/**
 * Der WIKI-STAND: die public_id der Stadt, die der zugewiesene Wiki-Artikel nennt -- '' = keiner
 * (Spec §5). Ablauf (jede Unsicherheit -> ''):
 *
 *   1. Artikeltitel aus `properties.wiki_settlement.title`, sonst `properties.name`.
 *   2. `wiki_sync_pages.standort` dieser Seite (bei Stadtteilen setzt der Dump dort `[[Stadt]]`,
 *      siehe api/_internal/wiki/dump-entity-scan.php ~Z. 914).
 *   3. Scope-Klassifikator (`avesmapsPlaceScopeClassifyWithIndex`) -- nur `inside` zaehlt.
 *   4. Der genannte Stadtname muss GENAU EINEN aktiven Kartenpunkt einer Siedlungsklasse
 *      (Dorf...Metropole) treffen, gefaltet wie der Klassifikator (`avesmapsPlaceScopeFoldName`).
 *      Mehrdeutig oder gar keiner -> ''.
 *
 * ⚠️ Fehlende Tabelle/Spalte faellt OFFEN aus: '' -- dieselbe Regel wie ueberall in diesem Haus.
 */
function avesmapsInnerortsWikiStand(PDO $pdo, array $properties): string
{
    $wikiSettlement = is_array($properties['wiki_settlement'] ?? null) ? $properties['wiki_settlement'] : [];
    $titel = trim((string) ($wikiSettlement['title'] ?? ''));
    if ($titel === '') {
        $titel = trim((string) ($properties['name'] ?? ''));
    }
    if ($titel === '') {
        return '';
    }

    try {
        $statement = $pdo->prepare('SELECT standort FROM wiki_sync_pages WHERE title = :title LIMIT 1');
        $statement->execute(['title' => $titel]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return '';
    }
    if (!is_array($row)) {
        return '';
    }
    $standort = trim((string) ($row['standort'] ?? ''));
    if ($standort === '') {
        return '';
    }

    try {
        $index = avesmapsPlaceScopeLoadIndex($pdo);
    } catch (Throwable) {
        return '';
    }
    $klassifiziert = avesmapsPlaceScopeClassifyWithIndex($standort, $index);
    if ($klassifiziert['scope'] !== AVESMAPS_PLACE_SCOPE_INSIDE) {
        return '';
    }
    $stadtName = trim((string) $klassifiziert['settlement']);
    if ($stadtName === '') {
        return '';
    }
    $gefaltet = avesmapsPlaceScopeFoldName($stadtName);

    $platzhalter = [];
    $werte = [];
    foreach (AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES as $i => $subtype) {
        $schluessel = 'sub' . $i;
        $platzhalter[] = ':' . $schluessel;
        $werte[$schluessel] = $subtype;
    }
    try {
        $statement = $pdo->prepare(
            "SELECT public_id, name FROM map_features WHERE feature_type = 'location' AND is_active = 1
              AND feature_subtype IN (" . implode(', ', $platzhalter) . ')'
        );
        $statement->execute($werte);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return '';
    }

    $treffer = [];
    foreach ((array) $rows as $row) {
        $name = (string) ($row['name'] ?? '');
        if (avesmapsPlaceScopeFoldName($name) === $gefaltet) {
            $treffer[(string) ($row['public_id'] ?? '')] = true;
        }
    }

    return count($treffer) === 1 ? (string) array_key_first($treffer) : '';
}

/**
 * Zielpruefung fuer „welche Stadt gehoert dieser Punkt an": das Ziel muss ein aktiver
 * `location`-Punkt einer Siedlungsklasse sein, nicht der Punkt selbst.
 *
 * @return string|null null = Ziel ist gueltig, sonst die Fehlermeldung
 */
function avesmapsInnerortsZielPruefen(PDO $pdo, string $ortId, string $eigeneId): ?string
{
    $ortId = trim($ortId);
    $eigeneId = trim($eigeneId);
    $fehler = 'Das Ziel ist kein Ort auf der Karte.';

    if ($ortId === '' || $ortId === $eigeneId) {
        return $fehler;
    }

    $platzhalter = [];
    $werte = ['ort' => $ortId];
    foreach (AVESMAPS_PLACE_SCOPE_SETTLEMENT_SUBTYPES as $i => $subtype) {
        $schluessel = 'sub' . $i;
        $platzhalter[] = ':' . $schluessel;
        $werte[$schluessel] = $subtype;
    }

    try {
        $statement = $pdo->prepare(
            "SELECT 1 FROM map_features WHERE public_id = :ort AND feature_type = 'location' AND is_active = 1
              AND feature_subtype IN (" . implode(', ', $platzhalter) . ')'
        );
        $statement->execute($werte);
        $gefunden = $statement->fetchColumn() !== false;
    } catch (Throwable) {
        $gefunden = false;
    }

    return $gefunden ? null : $fehler;
}

/**
 * Eine einheitliche Fehler-Antwort fuer die vier schreibenden Funktionen unten.
 */
function avesmapsInnerortsFehler(string $code, string $message): array
{
    return ['ok' => false, 'code' => $code, 'message' => $message];
}

/**
 * Den Punkt lesen -- UNABHAENGIG von `is_active` (anders als `avesmapsFetchEditableFeature` in
 * features.php, die nur aktive Punkte liefert): „Auf die Karte setzen" und „Endgueltig entfernen"
 * muessen gerade den INAKTIVEN Punkt finden. `FOR UPDATE` sperrt die Zeile fuer die Dauer der
 * Transaktion -- Hausmuster.
 */
function avesmapsInnerortsFetchFeature(PDO $pdo, string $publicId): ?array
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return null;
    }

    $statement = $pdo->prepare(
        "SELECT id, public_id, feature_type, feature_subtype, name, properties_json, is_active
           FROM map_features WHERE public_id = :pid LIMIT 1 FOR UPDATE"
    );
    $statement->execute(['pid' => $publicId]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);

    return is_array($row) ? $row : null;
}

/**
 * Nur der Name eines Punktes -- ohne Sperre, fuer Vorschauen (Admin-Lauf-Stichprobe). Faellt
 * offen aus: unbekannt/kaputt -> ''.
 */
function avesmapsInnerortsFeatureName(PDO $pdo, string $publicId): string
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return '';
    }
    try {
        $statement = $pdo->prepare('SELECT name FROM map_features WHERE public_id = :pid LIMIT 1');
        $statement->execute(['pid' => $publicId]);
        $name = $statement->fetchColumn();
    } catch (Throwable) {
        return '';
    }

    return is_string($name) ? $name : '';
}

/**
 * JSON-Kodierung wie im Haus (`avesmapsEncodeJson`, api/_internal/map/features.php) -- eine
 * eigene, winzige Kopie: dieselbe Zeile steht schon zweimal im Projekt (die zweite in
 * api/_internal/wiki/locations-helpers.php als `avesmapsWikiSyncEncodeJson`), eine dritte, rein
 * mechanische Kopie ist hier kein Abweichungsrisiko.
 */
function avesmapsInnerortsEncodeJson(mixed $value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

/**
 * Den Revisionszaehler weiterschalten -- ueber die Hausfunktion, wenn geladen (Aufrufer laden sie
 * immer, siehe Kopf-Notiz). Kein Duplikat der Zaehl-Logik hier: bricht der Zaehler, soll GENAU
 * EINE Stelle es reparieren.
 */
function avesmapsInnerortsNextMapRevision(PDO $pdo): int
{
    if (function_exists('avesmapsNextMapRevision')) {
        return avesmapsNextMapRevision($pdo);
    }
    if (function_exists('avesmapsWikiSyncNextMapRevision')) {
        return avesmapsWikiSyncNextMapRevision($pdo);
    }

    throw new RuntimeException('avesmapsNextMapRevision fehlt -- api/_internal/map/features.php'
        . ' oder api/_internal/wiki/locations-helpers.php muss vor dieser Datei geladen sein.');
}

/**
 * Den Kraftlinien-Riegel rufen (`avesmapsAssertNoPowerlineAnchoredAt`, wie `avesmapsDeleteMapFeature`)
 * -- wirft, wenn eine Kraftlinie an diesem Punkt haengt. Siehe Kopf-Notiz: keine Abschrift der
 * Pruefung, nur ein LAUTER Fehlschlag, falls die Hausfunktion nicht geladen ist.
 */
function avesmapsInnerortsPowerlineRiegel(PDO $pdo, string $publicId): void
{
    if (function_exists('avesmapsAssertNoPowerlineAnchoredAt')) {
        avesmapsAssertNoPowerlineAnchoredAt($pdo, $publicId);

        return;
    }

    throw new RuntimeException('avesmapsAssertNoPowerlineAnchoredAt fehlt -- api/_internal/map/features.php'
        . ' muss vor dieser Datei geladen sein.');
}

/**
 * Einen Protokolleintrag schreiben -- ueber die Hausfunktion, wenn geladen.
 */
function avesmapsInnerortsWriteAuditLog(PDO $pdo, int $featureId, string $action, int $actorUserId, array $before, array $after): void
{
    $beforeJson = avesmapsInnerortsEncodeJson($before);
    $afterJson = avesmapsInnerortsEncodeJson($after);

    if (function_exists('avesmapsWriteMapAuditLog')) {
        avesmapsWriteMapAuditLog($pdo, $featureId, $action, $actorUserId, $beforeJson, $afterJson);

        return;
    }
    if (function_exists('avesmapsWikiSyncWriteMapAuditLog')) {
        avesmapsWikiSyncWriteMapAuditLog($pdo, $featureId, $action, $actorUserId, $beforeJson, $afterJson);

        return;
    }

    throw new RuntimeException('Kein Audit-Log-Schreiber gefunden -- api/_internal/map/features.php'
        . ' oder api/_internal/wiki/locations-helpers.php muss vor dieser Datei geladen sein.');
}

/**
 * Den Wiki-Stand nachziehen: nur `gebaeude`/`stadtviertel`, nur wenn die Herkunft NICHT `manual`
 * ist, nur bei echter Aenderung (Spec §5, Schreiber 2). Loest den bisherigen Wert, wenn der
 * Artikel jetzt keine Stadt mehr eindeutig nennt.
 *
 * @return bool true = es wurde wirklich geschrieben
 */
function avesmapsInnerortsWikiNachziehen(PDO $pdo, string $publicId, int $userId): bool
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return false;
    }

    $pdo->beginTransaction();
    try {
        $feature = avesmapsInnerortsFetchFeature($pdo, $publicId);
        if ($feature === null || !avesmapsInnerortsIstKlasse((string) ($feature['feature_subtype'] ?? ''))) {
            $pdo->rollBack();

            return false;
        }

        $properties = avesmapsInnerortsPropertiesDekodieren($feature['properties_json'] ?? null) ?? [];
        $herkunftBestand = is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [];
        if ((string) ($herkunftBestand['innerorts'] ?? '') === AVESMAPS_FIELD_ORIGIN_MANUAL) {
            $pdo->rollBack();

            return false;
        }

        $wikiStand = avesmapsInnerortsWikiStand($pdo, $properties);
        $neueProperties = avesmapsInnerortsSetzen($properties, $wikiStand, AVESMAPS_FIELD_ORIGIN_WIKI);

        if (avesmapsInnerortsEncodeJson($properties) === avesmapsInnerortsEncodeJson($neueProperties)) {
            $pdo->rollBack();

            return false;
        }

        $revision = avesmapsInnerortsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features SET properties_json = :props, revision = :revision, updated_by = :updated_by WHERE id = :id'
        );
        $statement->execute([
            'props' => avesmapsInnerortsEncodeJson($neueProperties),
            'revision' => $revision,
            'updated_by' => $userId > 0 ? $userId : null,
            'id' => (int) $feature['id'],
        ]);

        avesmapsInnerortsWriteAuditLog($pdo, (int) $feature['id'], 'wiki_sync_update_point', $userId, $feature, [
            'public_id' => $publicId,
            'feature_type' => (string) ($feature['feature_type'] ?? 'location'),
            'name' => (string) ($feature['name'] ?? ''),
            'feature_subtype' => (string) ($feature['feature_subtype'] ?? ''),
            'properties_json' => $neueProperties,
            'revision' => $revision,
        ]);

        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    return true;
}

/**
 * „Von der Karte nehmen" (Spec §4.1): nur ein aktiver Punkt MIT `innerorts.ort` -- sonst
 * `invalid_state`. Setzt `is_active = 0` und den Merker `von_der_karte`; Kraftlinien-Riegel wie
 * `avesmapsDeleteMapFeature`; Protokoll `take_off_map` mit einem Vorher-Schnappschuss, den
 * `avesmapsUndoAuditChange` versteht (siehe die neue Spalte in
 * `avesmapsUndoColumnsForAuditAction`, api/_internal/map/features.php).
 *
 * @return array{ok:true, public_id:string, name:string}|array{ok:false, code:string, message:string}
 */
function avesmapsInnerortsVonDerKarteNehmen(PDO $pdo, string $publicId, int $userId): array
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
    }

    $pdo->beginTransaction();
    try {
        $feature = avesmapsInnerortsFetchFeature($pdo, $publicId);
        if ($feature === null) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
        }
        if ((int) ($feature['is_active'] ?? 0) !== 1) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_state', 'Dieser Punkt ist nicht mehr auf der Karte.');
        }

        $properties = avesmapsInnerortsPropertiesDekodieren($feature['properties_json'] ?? null) ?? [];
        $ort = avesmapsInnerortsOrtVon($properties);
        if ($ort === '') {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_state', 'Dieser Punkt gehört keiner Stadt an.');
        }

        // Refuse rather than repair -- dieselbe Haltung wie beim regulaeren Loeschen: der Editor
        // loest zuerst die Kraftlinie, mit ihrem eigenen Undo.
        avesmapsInnerortsPowerlineRiegel($pdo, $publicId);

        $neueProperties = $properties;
        $neueProperties['innerorts'] = ['ort' => $ort, 'von_der_karte' => true];
        $revision = avesmapsInnerortsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features SET is_active = 0, properties_json = :props, revision = :revision, updated_by = :updated_by WHERE id = :id'
        );
        $statement->execute([
            'props' => avesmapsInnerortsEncodeJson($neueProperties),
            'revision' => $revision,
            'updated_by' => $userId > 0 ? $userId : null,
            'id' => (int) $feature['id'],
        ]);

        avesmapsInnerortsWriteAuditLog($pdo, (int) $feature['id'], 'take_off_map', $userId, $feature, [
            'public_id' => $publicId,
            'is_active' => 0,
            'properties_json' => $neueProperties,
            'revision' => $revision,
        ]);

        $pdo->commit();

        return ['ok' => true, 'public_id' => $publicId, 'name' => (string) ($feature['name'] ?? '')];
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}

/**
 * „Auf die Karte setzen" (Spec §4.2): nur ein inaktiver Punkt MIT Merker -- sonst `invalid_state`.
 * Setzt `is_active = 1`, nimmt den Merker weg; die Position bleibt unveraendert (sie wurde nie
 * angefasst). Protokoll `put_on_map`.
 *
 * @return array{ok:true, public_id:string, name:string}|array{ok:false, code:string, message:string}
 */
function avesmapsInnerortsAufDieKarteSetzen(PDO $pdo, string $publicId, int $userId): array
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
    }

    $pdo->beginTransaction();
    try {
        $feature = avesmapsInnerortsFetchFeature($pdo, $publicId);
        if ($feature === null) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
        }
        if ((int) ($feature['is_active'] ?? 1) !== 0) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_state', 'Dieser Punkt ist schon auf der Karte.');
        }

        $properties = avesmapsInnerortsPropertiesDekodieren($feature['properties_json'] ?? null) ?? [];
        if (!avesmapsInnerortsVonDerKarte($properties)) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_state', 'Dieser Punkt wurde nicht von der Karte genommen.');
        }

        $ort = avesmapsInnerortsOrtVon($properties);
        $neueProperties = $properties;
        $neueProperties['innerorts'] = ['ort' => $ort];
        $revision = avesmapsInnerortsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features SET is_active = 1, properties_json = :props, revision = :revision, updated_by = :updated_by WHERE id = :id'
        );
        $statement->execute([
            'props' => avesmapsInnerortsEncodeJson($neueProperties),
            'revision' => $revision,
            'updated_by' => $userId > 0 ? $userId : null,
            'id' => (int) $feature['id'],
        ]);

        avesmapsInnerortsWriteAuditLog($pdo, (int) $feature['id'], 'put_on_map', $userId, $feature, [
            'public_id' => $publicId,
            'is_active' => 1,
            'properties_json' => $neueProperties,
            'revision' => $revision,
        ]);

        $pdo->commit();

        return ['ok' => true, 'public_id' => $publicId, 'name' => (string) ($feature['name'] ?? '')];
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}

/**
 * „Endgueltig entfernen" (Stätten-Kasten `✕` bei einer von-der-Karte-genommenen Zeile, Spec §6.3):
 * nur ein inaktiver Punkt MIT Merker -- der Merker (und damit `innerorts` als Ganzes) verschwindet,
 * der Punkt bleibt inaktiv. 🔴 Unumkehrbar wie ein regulaeres Loeschen: keine neue Undo-Spalte in
 * `avesmapsUndoColumnsForAuditAction`, damit „Rueckgaengig" hier bewusst NICHT angeboten wird.
 *
 * @return array{ok:true, public_id:string, name:string}|array{ok:false, code:string, message:string}
 */
function avesmapsInnerortsEndgueltigEntfernen(PDO $pdo, string $publicId, int $userId): array
{
    $publicId = trim($publicId);
    if ($publicId === '') {
        return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
    }

    $pdo->beginTransaction();
    try {
        $feature = avesmapsInnerortsFetchFeature($pdo, $publicId);
        if ($feature === null) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('not_found', 'Das Kartenobjekt wurde nicht gefunden.');
        }
        if ((int) ($feature['is_active'] ?? 1) !== 0) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_state', 'Dieser Punkt ist noch auf der Karte.');
        }

        $properties = avesmapsInnerortsPropertiesDekodieren($feature['properties_json'] ?? null) ?? [];
        if (!avesmapsInnerortsVonDerKarte($properties)) {
            $pdo->rollBack();

            return avesmapsInnerortsFehler('invalid_state', 'Dieser Punkt wurde nicht von der Karte genommen.');
        }

        $neueProperties = $properties;
        unset($neueProperties['innerorts']);
        $revision = avesmapsInnerortsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features SET properties_json = :props, revision = :revision, updated_by = :updated_by WHERE id = :id'
        );
        $statement->execute([
            'props' => avesmapsInnerortsEncodeJson($neueProperties),
            'revision' => $revision,
            'updated_by' => $userId > 0 ? $userId : null,
            'id' => (int) $feature['id'],
        ]);

        avesmapsInnerortsWriteAuditLog($pdo, (int) $feature['id'], 'innerorts_endgueltig_entfernen', $userId, $feature, [
            'public_id' => $publicId,
            'properties_json' => $neueProperties,
            'revision' => $revision,
        ]);

        $pdo->commit();

        return ['ok' => true, 'public_id' => $publicId, 'name' => (string) ($feature['name'] ?? '')];
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}

/**
 * Die Eintraege fuer `in_settlement_places` aus innerorts-Punkten: aktive Punkte MIT
 * `innerorts.ort` UND inaktive Punkte MIT dem Merker `von_der_karte` (Spec §6.1). Ein regulaer
 * geloeschter Punkt (inaktiv, ohne Merker) erscheint NICHT.
 *
 * Ein Abfragedurchgang fuer alle Stadtnamen (kein N+1) -- der Stadtname wird beim LESEN aus dem
 * Stadtpunkt geholt, nie mitgespeichert (umbenannte Staedte behalten ihre Staetten, Spec §3).
 * Ist die Stadt selbst nicht (mehr) aktiv, entfaellt der Eintrag.
 *
 * @return list<array{name:string, settlement:string, type:string, wiki_url:string, public_id:string, auf_der_karte:bool}>
 */
function avesmapsInnerortsPunkteFuerStaetten(PDO $pdo): array
{
    $platzhalter = [];
    $werte = [];
    foreach (AVESMAPS_INNERORTS_KLASSEN as $i => $subtype) {
        $schluessel = 'k' . $i;
        $platzhalter[] = ':' . $schluessel;
        $werte[$schluessel] = $subtype;
    }

    try {
        $statement = $pdo->prepare(
            "SELECT public_id, name, feature_subtype, properties_json, is_active
               FROM map_features
              WHERE feature_type = 'location'
                AND feature_subtype IN (" . implode(', ', $platzhalter) . ")
                AND properties_json LIKE '%innerorts%'"
        );
        $statement->execute($werte);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return [];
    }

    $kandidaten = [];
    $ortIds = [];
    foreach ((array) $rows as $row) {
        $properties = avesmapsInnerortsPropertiesDekodieren($row['properties_json'] ?? null);
        if ($properties === null) {
            continue; // kaputtes JSON -- ueberspringen, kein Fehler
        }
        $ortId = avesmapsInnerortsOrtVon($properties);
        if ($ortId === '') {
            continue;
        }
        $auf_der_karte = (int) ($row['is_active'] ?? 0) === 1;
        if (!$auf_der_karte && !avesmapsInnerortsVonDerKarte($properties)) {
            continue; // regulaer geloescht (ohne Merker) -- ist keine Staette mehr
        }

        $kandidaten[] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'subtype' => (string) ($row['feature_subtype'] ?? ''),
            'ort' => $ortId,
            'auf_der_karte' => $auf_der_karte,
            'properties' => $properties,
        ];
        $ortIds[$ortId] = true;
    }

    if ($kandidaten === []) {
        return [];
    }

    $staedte = [];
    try {
        $ortPlatzhalter = [];
        $ortWerte = [];
        $i = 0;
        foreach (array_keys($ortIds) as $ortId) {
            $schluessel = 'o' . $i++;
            $ortPlatzhalter[] = ':' . $schluessel;
            $ortWerte[$schluessel] = $ortId;
        }
        $statement = $pdo->prepare(
            "SELECT public_id, name FROM map_features
              WHERE feature_type = 'location' AND is_active = 1
                AND public_id IN (" . implode(', ', $ortPlatzhalter) . ')'
        );
        $statement->execute($ortWerte);
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $staedte[(string) ($row['public_id'] ?? '')] = (string) ($row['name'] ?? '');
        }
    } catch (Throwable) {
        return [];
    }

    $ergebnis = [];
    foreach ($kandidaten as $kandidat) {
        $stadtName = $staedte[$kandidat['ort']] ?? '';
        if ($stadtName === '') {
            continue; // Stadt nicht (mehr) aktiv -> Eintrag entfaellt
        }

        $properties = $kandidat['properties'];
        $wikiSettlement = is_array($properties['wiki_settlement'] ?? null) ? $properties['wiki_settlement'] : [];
        $wikiUrl = trim((string) ($wikiSettlement['wiki_url'] ?? ''));
        if ($wikiUrl === '') {
            $wikiUrl = trim((string) ($properties['wiki_url'] ?? ''));
        }
        $typ = $kandidat['subtype'] === 'stadtviertel'
            ? 'Stadtviertel'
            : trim((string) ($properties['place_kind'] ?? ''));

        $ergebnis[] = [
            'name' => $kandidat['name'],
            'settlement' => $stadtName,
            'type' => $typ,
            'wiki_url' => $wikiUrl,
            'public_id' => $kandidat['public_id'],
            'auf_der_karte' => $kandidat['auf_der_karte'],
        ];
    }

    return $ergebnis;
}

/**
 * Admin-Lauf „Innerorts aus Wiki" (Spec §5, Schreiber 3): alle `gebaeude`/`stadtviertel`-Punkte
 * mit Wiki-Zuweisung, deren Herkunft NICHT `manual` ist. Trockenlauf (Vorgabe) liefert die volle
 * Anzahl plus eine Stichprobe (Name -> Stadt); `apply` schreibt ueber `avesmapsInnerortsWikiNachziehen`,
 * gedeckelt auf `$limit`.
 *
 * @return array{ok:true, apply:bool, count:int, sample:list<array{name:string, stadt:string}>, written:int}
 */
function avesmapsInnerortsAusWikiLauf(PDO $pdo, bool $apply, int $limit, int $userId): array
{
    $limit = max(1, $limit);

    try {
        $statement = $pdo->query(
            "SELECT public_id, name, properties_json
               FROM map_features
              WHERE feature_type = 'location'
                AND feature_subtype IN ('gebaeude', 'stadtviertel')
                AND is_active = 1
                AND properties_json LIKE '%wiki_settlement%'"
        );
        $rows = $statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable) {
        $rows = [];
    }

    $kandidaten = [];
    foreach ((array) $rows as $row) {
        $properties = avesmapsInnerortsPropertiesDekodieren($row['properties_json'] ?? null);
        if ($properties === null) {
            continue;
        }
        $wikiSettlement = is_array($properties['wiki_settlement'] ?? null) ? $properties['wiki_settlement'] : [];
        if (trim((string) ($wikiSettlement['title'] ?? '')) === '') {
            continue; // keine Wiki-Zuweisung -- der Lauf betrifft nur zugewiesene Punkte
        }
        $herkunftBestand = is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [];
        if ((string) ($herkunftBestand['innerorts'] ?? '') === AVESMAPS_FIELD_ORIGIN_MANUAL) {
            continue; // manuelle Zuordnung wird nie ueberschrieben
        }

        $wikiStand = avesmapsInnerortsWikiStand($pdo, $properties);
        if ($wikiStand === avesmapsInnerortsOrtVon($properties)) {
            continue; // keine echte Aenderung
        }

        $kandidaten[] = [
            'public_id' => (string) ($row['public_id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'stadt' => $wikiStand !== '' ? avesmapsInnerortsFeatureName($pdo, $wikiStand) : '',
        ];
    }

    $anzahl = count($kandidaten);
    $stichprobe = array_map(
        static fn(array $kandidat): array => ['name' => $kandidat['name'], 'stadt' => $kandidat['stadt']],
        array_slice($kandidaten, 0, 5)
    );

    $geschrieben = 0;
    if ($apply) {
        foreach (array_slice($kandidaten, 0, $limit) as $kandidat) {
            if (avesmapsInnerortsWikiNachziehen($pdo, $kandidat['public_id'], $userId)) {
                $geschrieben++;
            }
        }
    }

    return [
        'ok' => true,
        'apply' => $apply,
        'count' => $anzahl,
        'sample' => $stichprobe,
        'written' => $geschrieben,
    ];
}
