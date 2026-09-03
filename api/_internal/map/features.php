<?php

declare(strict_types=1);

// Map-feature edit handlers (move/update/create point/crossing/powerline/path/
// label/region, delete, undo audit, lock acquire/release + all their helpers),
// split out of api/edit/map/features.php (M5 god-file split). Required by that
// endpoint before its dispatch; the endpoint keeps the consts, the
// AvesmapsConflictException class and the try/catch dispatch. Bootstrap/auth deps
// and the const/class are resolved at call time.

require_once __DIR__ . '/../wiki/path-naming.php';
// avesmapsPathFlowNormalize -- die eine Stelle, die entscheidet, was ein gueltiges `flow`
// ist. Die Datei ist rein und ohne eigene Einbindungen (ihr Kopf sagt es ausdruecklich).
require_once __DIR__ . '/../wiki/path-flow.php';
// Ortsarten-Katalog (properties.place_kind). Bewusst die kleine Konstantendatei, NICHT
// wiki/settlements.php -- die ist gross, zieht place-scope + coat-display nach und macht DDL.
require_once __DIR__ . '/../wiki/place-kinds.php';
// Die Zeitfenster je Reisemittel: rein rechnende Datei, ohne Bootstrap und ohne DB.
require_once __DIR__ . '/../routing/transport-season.php';
// Der Widerspruchsriegel des dritten Zustands. Eigene Datei, weil die Landschaft ihn ebenfalls
// braucht und diese hier nicht mitnehmen kann -- die Begruendung steht im Kopf jener Datei.
require_once __DIR__ . '/wiki-claim.php';
require_once __DIR__ . '/field-origins.php';
require_once __DIR__ . '/../audit-prune.php';

// 🔴 DIESE BIBLIOTHEK WIRFT SIE, ALSO DEKLARIERT SIE SIE AUCH. Bis zum 20.08.2026 stand die
// Klasse nur in api/edit/map/features.php -- fuenf `throw new AvesmapsConflictException` hier drin
// verliessen sich darauf, dass genau jener Endpunkt sie vorher angelegt hat. Jeder andere Aufrufer
// (das Konfliktzentrum ist seit heute einer) bekam statt der gemeinten Meldung einen Fatal Error
// „Class not found". Unter `class_exists`, damit die vorhandene, ungeschuetzte Deklaration dort und
// die in ecosystem.php unveraendert gewinnen duerfen, wenn sie zuerst laufen.
if (!class_exists('AvesmapsConflictException')) {
    class AvesmapsConflictException extends RuntimeException
    {
    }
}

// 🔴 DIESELBE FALLE, EIN JAHR SPAETER: `avesmapsReadLocationSubtype` (unten) liest diese Konstante,
// aber sie stand bis zum 29.08.2026 NUR in api/edit/map/features.php -- dem Endpunkt, der DIESE
// Bibliothek erst DANACH einbindet (Kommentar oben, Zeile 24). Der Garetien-Importer ist der erste
// Aufrufer von avesmapsCreatePointFeature ausserhalb jenes Endpunkts (api/_internal/import/
// garetien-uebernahme.php) und bekam dafuer "Undefined constant AVESMAPS_LOCATION_SUBTYPES" statt
// eines angelegten Ortes -- derselbe Fatal-Error-statt-Fehlermeldung-Fehler wie bei
// AvesmapsConflictException oben, nur an einer Konstante statt an einer Klasse.
// ⚠️ Unter `defined()`, damit die vorhandene, ungeschuetzte Deklaration dort (und die
// abweichend sortierte Kopie in api/app/report-location.php) unveraendert gewinnt, wenn sie
// zuerst laeuft -- kein Aufrufer wird umgestellt, nur der fehlende Fall abgesichert.
if (!defined('AVESMAPS_LOCATION_SUBTYPES')) {
    define('AVESMAPS_LOCATION_SUBTYPES', ['metropole', 'grossstadt', 'stadt', 'kleinstadt', 'dorf', 'gebaeude', 'stadtviertel']);
}

function avesmapsReadMapFeaturePublicId(mixed $value): string {
    $publicId = avesmapsNormalizeSingleLine((string) $value, 36);
    if (preg_match('/^[a-f0-9-]{36}$/i', $publicId) !== 1) {
        throw new InvalidArgumentException('Die Feature-ID ist ungueltig.');
    }

    return strtolower($publicId);
}

function avesmapsReadLocationName(mixed $value): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 160);
    if ($name === '') {
        throw new InvalidArgumentException('Der Ortsname fehlt.');
    }

    return $name;
}

function avesmapsNormalizeDuplicateLocationName(string $value): string {
    $normalizedValue = mb_strtolower($value);
    return preg_replace('/[^\p{L}\p{N}]+/u', '', $normalizedValue) ?? '';
}

// Bug #46: a rejected name must not be a dead end. Location names stay unique because the ROUTE
// GRAPH IS KEYED BY NAME on both ends -- api/_internal/routing/client-graph.php builds
// $graph[$name] and js/routing/route-graph-routing.js mirrors it -- so two active locations
// sharing a name collapse into ONE graph node and a route would walk in at one place and out at
// the other. Rather than forbid the second place outright, point the editor at the convention
// Wiki Aventurica itself uses: a parenthetical qualifier. "(Region)" is a visible PLACEHOLDER,
// not a proposed region -- resolving the real one would mean querying the political layer, a
// known performance hotspot. Kept ASCII like every other message in this file; the identical
// wording lives in js/routing/routing.js duplicateLocationNameMessage().
function avesmapsDuplicateLocationNameMessage(string $existingName): string {
    return sprintf(
        'Ein Ort namens "%s" existiert bereits. Ortsnamen bleiben eindeutig - gib dem zweiten Ort'
        . ' einen Zusatz in Klammern, so wie im Wiki (z. B. "%s (Region)").',
        $existingName,
        $existingName
    );
}

// Bug #46, zweiter Teil (17.08.2026): die Meldung NANNTE den blockierenden Ort, aber man kam nicht
// hin -- der Owner lief in sie und wuenschte sich "einen link, dass man das gleich findet".
//
// 🔴 DER VERWEIS GEHOERT NICHT IN DEN MELDUNGSTEXT. Der Satz oben steht wortgleich in PHP und JS
// und wird an jeder Anzeigestelle per `textContent` gesetzt (setDialogStatus in
// js/review/review-status.js, setSettlementEditMsg in html/wiki-sync-settlement-editor.html) --
// Markup darin erschiene roh im Bild, und die ohnehin doppelte Pflege verdoppelte sich noch einmal.
// Die KENNUNG reist deshalb daneben: diese Ausnahme traegt sie, der Endpunkt haengt sie als
// `error.duplicate_location` in die Fehlerhuelle, und erst die Oberflaeche baut daraus einen Knopf.
//
// ⚠️ SIE ERBT VON InvalidArgumentException und muss das auch. Jeder vorhandene Aufrufer faengt
// genau die -- ein eigener Ast (RuntimeException o. ae.) wuerde in api/edit/map/features.php auf
// `catch (Throwable)` fallen und aus einer 400 mit klarem Satz eine 500 mit "konnte nicht
// verarbeitet werden" machen. Wer sie dort abfragt, tut das per `instanceof` in avesmapsMap-
// FeatureErrorDetails() und NICHT per zweitem `catch`-Block -- die Begruendung steht am Endpunkt.
final class AvesmapsDuplicateLocationNameException extends InvalidArgumentException
{
    public function __construct(
        public readonly string $blockingPublicId,
        public readonly string $blockingName
    ) {
        parent::__construct(avesmapsDuplicateLocationNameMessage($blockingName));
    }
}

// Die maschinenlesbare Beilage zu einer abgelehnten Schreibanfrage, fuer `error.duplicate_location`
// in der Fehlerhuelle (AGENTS.md §4). Rein, damit die Weiche pruefbar ist -- im Endpunkt selbst
// waere sie es nicht, der beantwortet eine HTTP-Anfrage und beendet den Prozess.
// ⚠️ Alles, was KEINE Dublettenablehnung ist, liefert `[]` und laesst die Huelle damit exakt so,
// wie sie vorher war. Die Beilage ist eine Zugabe, nie eine Bedingung.
function avesmapsMapFeatureErrorDetails(Throwable $exception): array {
    if (!$exception instanceof AvesmapsDuplicateLocationNameException) {
        return [];
    }

    return [
        'duplicate_location' => [
            'public_id' => $exception->blockingPublicId,
            'name' => $exception->blockingName,
        ],
    ];
}

function avesmapsAssertUniqueLocationName(PDO $pdo, string $name, ?string $excludePublicId = null): void {
    $normalizedName = avesmapsNormalizeDuplicateLocationName($name);
    if ($normalizedName === '') {
        return;
    }

    $statement = $pdo->prepare(
        'SELECT public_id, name
        FROM map_features
        WHERE feature_type = :feature_type
          AND is_active = 1'
        . ($excludePublicId !== null && $excludePublicId !== '' ? ' AND public_id <> :public_id' : '')
    );
    $parameters = [
        'feature_type' => 'location',
    ];
    if ($excludePublicId !== null && $excludePublicId !== '') {
        $parameters['public_id'] = $excludePublicId;
    }
    $statement->execute($parameters);

    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $existingName = (string) ($row['name'] ?? '');
        if ($existingName === '') {
            continue;
        }

        if (avesmapsNormalizeDuplicateLocationName($existingName) === $normalizedName) {
            // Die Abfrage oben liest `public_id` seit jeher mit und warf sie hier weg -- der
            // blockierende Ort ist an dieser Stelle also bereits bekannt und muss nicht gesucht werden.
            throw new AvesmapsDuplicateLocationNameException(
                (string) ($row['public_id'] ?? ''),
                $existingName
            );
        }
    }
}

function avesmapsReadFeatureName(mixed $value, string $fieldLabel): string {
    $name = avesmapsNormalizeSingleLine((string) $value, 160);
    if ($name === '') {
        throw new InvalidArgumentException("{$fieldLabel} fehlt.");
    }

    return $name;
}

function avesmapsReadLocationSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'dorf'), 60);
    if (!in_array($subtype, AVESMAPS_LOCATION_SUBTYPES, true)) {
        throw new InvalidArgumentException('Die Ortsgroesse ist ungueltig.');
    }

    return $subtype;
}

function avesmapsLocationSubtypeLabel(string $subtype): string {
    return match ($subtype) {
        'metropole' => 'Metropole',
        "grossstadt" => "Gro\u{00DF}stadt",
        'stadt' => 'Stadt',
        'kleinstadt' => 'Kleinstadt',
        'gebaeude' => 'Besondere Bauwerke/Staetten',
        'stadtviertel' => 'Stadtviertel',
        default => 'Dorf',
    };
}

function avesmapsReadLocationDescription(mixed $value): string {
    return avesmapsNormalizeMultiline((string) $value, 1200);
}

function avesmapsReadPathSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'Weg'), 60);
    // 🔴 Diese Liste ist der SCHREIB-Riegel -- ohne 'Bach' hier wirft jeder Versuch, einen Bach
    // anzulegen oder zu speichern (u.a. der Garetien-Importer, avesmapsCreatePathFeature),
    // 'Der Wegtyp ist ungueltig.' Sie ist eine EIGENE Kopie von PATH_SUBTYPE_KEYS (js/config.js),
    // nicht dieselbe Liste -- ein Fund beim Bauen dieser Aufgabe, nicht Teil des urspruenglichen
    // Auftrags.
    // 🔴 'Bach' STEHT HIER NICHT MEHR (Owner 30.08.2026, an einem Bildschirmfoto des Dialogs
    // „Weg bearbeiten": ein Haekchen am Wegtyp, kein eigener Wegtyp). Er war vom 29. bis zum
    // 30.08.2026 eine eigene Wegart, aber weder in der Auswahlliste des Dialogs noch auf einem
    // einzigen Objekt: live gemessen 0 von 6038 Wegen. Ein Bach ist seither ein FLUSSWEG mit
    // properties.is_bach -- siehe avesmapsPathIstBach unten.
    $allowedSubtypes = ['Reichsstrasse', 'Strasse', 'Weg', 'Pfad', 'Gebirgspass', 'Wuestenpfad', 'Flussweg', 'Seeweg'];
    if (!in_array($subtype, $allowedSubtypes, true)) {
        throw new InvalidArgumentException('Der Wegtyp ist ungueltig.');
    }

    return $subtype;
}

function avesmapsDefaultTransportDomainForPathSubtype(string $subtype): string {
    return match ($subtype) {
        'Flussweg' => 'river',
        'Seeweg' => 'sea',
        default => 'land',
    };
}

/**
 * PURE: Traegt dieser Weg das Haekchen „Bach"?
 *
 * Owner 30.08.2026: „Flusswege bekommen die zusaetzlich Option 'Bach'. Bach deaktiviert automatisch
 * Flusssegler und Flusskahn (oder jeder art von Befahrbarkeit), bleibt aber Flussweg (z.b. als
 * Hindernis)."
 *
 * 🔴 NUR AN EINEM FLUSSWEG. Das Haekchen sagt „dieses Gewaesser ist zu klein zum Befahren" -- an
 * einer Strasse hat der Satz keine Bedeutung, und ein durchgereichtes `is_bach` an einem Landweg
 * waere eine Aussage, die niemand treffen wollte. Ein Wegtypwechsel weg vom Flussweg loescht das
 * Haekchen deshalb von selbst, ohne eigene Aufraeumregel.
 * ⚠️ Wie is_nodix/is_ruined/is_hidden beim Ort liegt es im `properties_json` -- keine Spalte, keine
 * DDL, keine Migration.
 */
function avesmapsPathIstBach(string $subtype, mixed $wert): bool {
    return $subtype === 'Flussweg' && avesmapsReadBoolean($wert);
}

/**
 * PURE: DER EINE ORT, an dem „ein Bach ist nicht befahrbar" steht.
 *
 * 🔴 EINE REGEL, DREI SCHREIBWEGE. `avesmapsCreatePathFeature`, `avesmapsUpdatePathFeatureDetails`
 * und `avesmapsUpdatePathGroupDetails` loesten die Domaene bisher jeder fuer sich auf. Haette jeder
 * das Haekchen einzeln beachten muessen, waere das die Fehlerklasse, die dieses Projekt schon
 * zweimal bezahlt hat (Querfeldein-Kanten 14.08., Ausstiegsregel 15.08.): „eine Regel, die einen von
 * mehreren Erzeugern bindet, ist keine Regel". Gewacht von bach-haekchen-test.php, das die
 * Schreibwege zur LAUFZEIT zaehlt -- deshalb steht hier keine ZAHL.
 *
 * 🔴 DIE SPERRE IST BAULICH, NICHT BERATEND. Domaene 'none' ergibt in
 * avesmapsAllowedTransportOptionsForDomain eine LEERE Vertraeglichkeitsliste, und
 * avesmapsReadAllowedTransports filtert jeden eingereichten Wert dagegen. Ein alter Client, der
 * `['riverSailer']` mitschickt, bekommt `[]` -- es gibt keinen Pfad, auf dem ein Bach befahrbar
 * wird, und keinen, den ein spaeterer Leser vergessen kann.
 *
 * @return array{domain:string, allowed:list<string>, is_bach:bool}
 */
function avesmapsPathTransportRegel(string $subtype, bool $istBach, mixed $eingereicht): array {
    $domain = $istBach ? 'none' : avesmapsDefaultTransportDomainForPathSubtype($subtype);

    return [
        'domain' => $domain,
        'allowed' => avesmapsReadAllowedTransports($eingereicht, $domain, $subtype),
        'is_bach' => $istBach,
    ];
}

function avesmapsAllowedTransportOptionsForDomain(string $domain): array {
    return match ($domain) {
        'land' => ['caravan', 'groupFoot', 'lightWalker', 'horseCarriage', 'groupHorse', 'lightRider'],
        'river' => ['riverSailer', 'riverBarge'],
        'sea' => ['cargoShip', 'fastShip', 'galley'],
        'none' => [],
        default => [],
    };
}

function avesmapsAllowedTransportOptionsForPathSubtype(string $subtype): array {
    $options = avesmapsAllowedTransportOptionsForDomain(avesmapsDefaultTransportDomainForPathSubtype($subtype));
    if ($subtype === 'Wuestenpfad') {
        return array_values(array_filter($options, static fn(string $option): bool => $option !== 'horseCarriage'));
    }

    return $options;
}

function avesmapsReadTransportDomain(mixed $value, string $subtype): string {
    $domain = avesmapsNormalizeSingleLine((string) ($value ?: avesmapsDefaultTransportDomainForPathSubtype($subtype)), 20);
    return in_array($domain, ['land', 'river', 'sea', 'none'], true) ? $domain : avesmapsDefaultTransportDomainForPathSubtype($subtype);
}

function avesmapsReadAllowedTransports(mixed $value, string $domain, ?string $subtype = null): array {
    $compatibleOptions = avesmapsAllowedTransportOptionsForDomain($domain);
    if ($subtype === 'Wuestenpfad') {
        $compatibleOptions = array_values(array_filter($compatibleOptions, static fn(string $option): bool => $option !== 'horseCarriage'));
    }
    // Nothing submitted -> the way type's PRE-SELECTED list, which is not the same as what it
    // OFFERS. On a Pfad the carriage is offered but unticked (Owner, 2026-07-30): a carriage does
    // get through a handful of paths, so a SUBMITTED one is stored (below), but a path that records
    // nothing must not admit one. The Wuestenpfad rule above has the opposite shape -- there the
    // carriage is not offered at all and a submitted one is dropped. Mirrors
    // getDefaultAllowedTransportsForPathSubtype in js/map-features/map-features-path-domain.js.
    if (!is_array($value)) {
        if ($subtype === 'Pfad') {
            return array_values(array_filter($compatibleOptions, static fn(string $option): bool => $option !== 'horseCarriage'));
        }

        return $compatibleOptions;
    }

    $allowedOptions = [];
    foreach ($value as $option) {
        $normalizedOption = avesmapsNormalizeSingleLine((string) $option, 40);
        if (!in_array($normalizedOption, $compatibleOptions, true)) {
            continue;
        }
        $allowedOptions[] = $normalizedOption;
    }

    $allowedOptions = array_values(array_unique($allowedOptions));
    return $allowedOptions;
}

function avesmapsReadBoolean(mixed $value): bool {
    return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
}

function avesmapsReadOptionalRevision(mixed $value): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $revision = filter_var($value, FILTER_VALIDATE_INT);
    if ($revision === false || $revision < 0) {
        throw new InvalidArgumentException('Die Feature-Revision ist ungueltig.');
    }

    return (int) $revision;
}

function avesmapsReadAuditLogId(mixed $value): int {
    $auditId = filter_var($value, FILTER_VALIDATE_INT);
    if ($auditId === false || $auditId <= 0) {
        throw new InvalidArgumentException('Die Änderungs-ID ist ungueltig.');
    }

    return (int) $auditId;
}

function avesmapsEnsureMapAuditUndoColumns(PDO $pdo): void {
    $columns = avesmapsFetchTableColumnNames($pdo, 'map_audit_log');
    $missingDefinitions = [];
    if (!isset($columns['undone_at'])) {
        $missingDefinitions[] = 'ADD COLUMN undone_at DATETIME(3) NULL';
    }
    if (!isset($columns['undone_by'])) {
        $missingDefinitions[] = 'ADD COLUMN undone_by BIGINT UNSIGNED NULL';
    }
    if (!isset($columns['undo_audit_id'])) {
        $missingDefinitions[] = 'ADD COLUMN undo_audit_id BIGINT UNSIGNED NULL';
    }

    if ($missingDefinitions !== []) {
        $pdo->exec('ALTER TABLE map_audit_log ' . implode(', ', $missingDefinitions));
    }
}

function avesmapsFetchTableColumnNames(PDO $pdo, string $tableName): array {
    if (preg_match('/^[a-z0-9_]+$/i', $tableName) !== 1) {
        throw new InvalidArgumentException('Der Tabellenname ist ungueltig.');
    }

    $statement = $pdo->query("SHOW COLUMNS FROM {$tableName}");
    $columns = [];
    foreach ($statement !== false ? $statement->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
        $columnName = (string) ($row['Field'] ?? '');
        if ($columnName !== '') {
            $columns[$columnName] = true;
        }
    }

    return $columns;
}

function avesmapsBuildAuditAfterSnapshot(array $snapshot, array $payload): array {
    $reviewReportId = filter_var($payload['review_report_id'] ?? null, FILTER_VALIDATE_INT);
    $reviewReportSource = avesmapsNormalizeSingleLine((string) ($payload['review_report_source'] ?? ''), 40);
    if ($reviewReportId !== false && $reviewReportId > 0 && in_array($reviewReportSource, ['location_reports', 'map_reports'], true)) {
        $snapshot['audit_context'] = [
            'review_report' => [
                'id' => (int) $reviewReportId,
                'source' => $reviewReportSource,
            ],
        ];
    }

    return $snapshot;
}

function avesmapsCanUndoAuditAction(string $action): bool {
    // 🔴 EXACTLY ONE REDO, NEVER TWO. Undoing an "undo_X" entry is the redo button; undoing the
    // resulting "undo_undo_X" would be a third level, and avesmapsBuildUndoAuditAction() cuts the
    // action name at 40 characters -- "undo_undo_undo_undo_wiki_sync_update_point" is 42 and would be
    // silently truncated into a name that no longer round-trips. One flip back is also all anybody
    // needs; flip-flopping is not a use case, it is a way to lose track of what the current state is.
    // The rule lives HERE and not in the endpoint so the client's can_undo flag and the server's
    // refusal can never disagree -- a button that appears and then errors is worse than no button.
    if (str_starts_with($action, 'undo_undo_')) {
        return false;
    }

    return avesmapsIsCreateAuditAction($action)
        || $action === 'delete_feature'
        || avesmapsUndoColumnsForAuditAction($action) !== [];
}

// The columns a "delete_feature" undo restores -- the whole row, because a deletion took the whole row
// away. Named rather than inlined because the redo resolver below needs the same list.
function avesmapsDeleteFeatureUndoColumns(): array {
    return ['feature_type', 'feature_subtype', 'name', 'geometry_type', 'geometry_json', 'properties_json', 'style_json', 'min_x', 'min_y', 'max_x', 'max_y', 'is_active'];
}

// 💣 THE WHOLE REDO IN ONE FUNCTION. Undoing an "undo_X" entry has to write back exactly the columns
// that X's undo wrote -- no more (or it would clobber unrelated edits made since) and no less (or the
// restore would be half a restore). So the question "what does a redo touch?" is the same question as
// "what did that undo touch?", asked of the original action:
//
//   X was a create      -> its undo only set is_active = 0, so the redo only sets is_active back
//   X was delete_feature -> its undo restored the whole row, so the redo writes the whole row
//   otherwise            -> the same column list the undo used
//
// The values themselves come from the undo entry's before_json, which is the feature exactly as it
// stood the moment before the undo ran (avesmapsUndoAuditChange writes it there). Nothing has to be
// recomputed or guessed.
function avesmapsRedoColumnsForUndoneAction(string $undoneAction): array {
    if (avesmapsIsCreateAuditAction($undoneAction)) {
        return ['is_active'];
    }
    if ($undoneAction === 'delete_feature') {
        return avesmapsDeleteFeatureUndoColumns();
    }

    return avesmapsUndoColumnsForAuditAction($undoneAction);
}

function avesmapsIsCreateAuditAction(string $action): bool {
    return in_array($action, [
        'create_point',
        'wiki_sync_create_point',
        'create_crossing',
        'create_powerline',
        'create_path',
        'create_label',
        'create_region',
    ], true);
}

function avesmapsCreateUndoColumnsForAuditAction(string $action): array {
    if (!avesmapsIsCreateAuditAction($action)) {
        return [];
    }

    return ['feature_type', 'feature_subtype', 'geometry_json', 'properties_json'];
}

function avesmapsUndoColumnsForAuditAction(string $action): array {
    // A "Rückgängig: …" entry is undoable too -- that is the redo button in the change log. It restores
    // whatever its own undo overwrote; see avesmapsRedoColumnsForUndoneAction.
    if (str_starts_with($action, 'undo_')) {
        return avesmapsRedoColumnsForUndoneAction(substr($action, 5));
    }

    return match ($action) {
        'move_point',
        'move_label',
        'update_path_geometry',
        'update_region_geometry' => ['geometry_json'],
        'update_point',
        'wiki_sync_update_point',
        'update_powerline_details',
        'update_path_details',
        'update_label' => ['name', 'feature_subtype', 'properties_json'],
        'update_region' => ['name', 'properties_json', 'style_json'],
        default => [],
    };
}

function avesmapsUndoAuditChange(PDO $pdo, array $payload, array $user): array {
    $auditId = avesmapsReadAuditLogId($payload['audit_id'] ?? null);
    avesmapsEnsureMapAuditUndoColumns($pdo);

    $pdo->beginTransaction();
    try {
        $auditEntry = avesmapsFetchAuditEntryForUndo($pdo, $auditId);
        $action = (string) $auditEntry['action'];
        // The blanket "never an undo_ entry" ban is gone: undoing one IS the redo the change log was
        // missing. The one-level cap now lives in avesmapsCanUndoAuditAction, so this single check
        // covers both, and the client's can_undo flag is derived from the very same function.
        if (!avesmapsCanUndoAuditAction($action)) {
            throw new InvalidArgumentException('Diese Änderung kann nicht rückgängig gemacht werden.');
        }
        if (!empty($auditEntry['undone_at'])) {
            throw new InvalidArgumentException('Diese Änderung wurde bereits rückgängig gemacht.');
        }

        $featureId = (int) ($auditEntry['feature_id'] ?? 0);
        if ($featureId <= 0) {
            throw new InvalidArgumentException('Diese Änderung ist keinem Kartenobjekt zugeordnet.');
        }

        $featureBeforeUndo = avesmapsFetchFeatureByIdForUpdate($pdo, $featureId);
        avesmapsAssertFeatureCanBeEdited($pdo, [], $featureBeforeUndo, $user);
        $beforeSnapshot = avesmapsDecodeJsonColumnForEdit($auditEntry['before_json'] ?? null);
        $afterSnapshot = avesmapsDecodeJsonColumnForEdit($auditEntry['after_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);
        $updates = avesmapsBuildUndoFeatureUpdates($action, $featureBeforeUndo, $beforeSnapshot, $afterSnapshot, $revision, (int) $user['id']);
        // 💣 „Rueckgaengig" auf ein Anlegen setzt is_active = 0 -- dieselbe Wirkung wie Loeschen,
        // nur an dieser Funktion vorbei. Ort anlegen, Kraftlinie daran haengen, das Anlegen
        // zuruecknehmen: eine frische Waise, per Knopfdruck. avesmapsAssertUndoPatchStillCurrent
        // merkt nichts davon, weil es nur die Spalten des PUNKTES vergleicht, und die hat das
        // Anlegen der Kraftlinie nicht angefasst.
        if ((int) ($updates['is_active'] ?? 1) === 0) {
            avesmapsAssertNoPowerlineAnchoredAt($pdo, (string) ($featureBeforeUndo['public_id'] ?? ''));
        }
        avesmapsAssertUndoNameIsAvailable($pdo, $featureBeforeUndo, $updates);
        avesmapsApplyFeatureUpdates($pdo, $featureId, $updates);

        $featureAfterUndo = avesmapsFetchFeatureByIdForUpdate($pdo, $featureId);
        avesmapsRestoreExternalReviewStateAfterUndo($pdo, $action, $beforeSnapshot, $afterSnapshot);
        $undoAuditId = avesmapsWriteMapAuditLog(
            $pdo,
            $featureId,
            avesmapsBuildUndoAuditAction($action),
            (int) $user['id'],
            avesmapsEncodeAuditJson($featureBeforeUndo),
            avesmapsEncodeAuditJson(avesmapsBuildUndoAuditSnapshot($featureAfterUndo, $auditId))
        );
        avesmapsMarkAuditEntryUndone($pdo, $auditId, (int) $user['id'], $undoAuditId);

        $pdo->commit();
        return avesmapsBuildFeatureResponseFromStoredFeature($featureAfterUndo);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsFetchAuditEntryForUndo(PDO $pdo, int $auditId): array {
    $statement = $pdo->prepare(
        'SELECT id, feature_id, action, before_json, after_json, undone_at
        FROM map_audit_log
        WHERE id = :id
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute(['id' => $auditId]);
    $auditEntry = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$auditEntry) {
        throw new InvalidArgumentException('Die Änderung wurde nicht gefunden.');
    }

    return $auditEntry;
}

function avesmapsFetchFeatureByIdForUpdate(PDO $pdo, int $featureId): array {
    $statement = $pdo->prepare(
        'SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, min_x, min_y, max_x, max_y, is_active, revision
        FROM map_features
        WHERE id = :id
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute(['id' => $featureId]);
    $feature = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$feature) {
        throw new InvalidArgumentException('Das Kartenobjekt wurde nicht gefunden.');
    }

    return $feature;
}

function avesmapsBuildUndoFeatureUpdates(string $action, array $feature, array $beforeSnapshot, array $afterSnapshot, int $revision, int $userId): array {
    if (avesmapsIsCreateAuditAction($action)) {
        if ((int) ($feature['is_active'] ?? 1) !== 1) {
            throw new AvesmapsConflictException('Das erstellte Objekt ist bereits nicht mehr aktiv.');
        }

        avesmapsAssertUndoPatchStillCurrent($action, $feature, $afterSnapshot, avesmapsCreateUndoColumnsForAuditAction($action));

        return [
            'is_active' => 0,
            'revision' => $revision,
            'updated_by' => $userId,
        ];
    }

    $columns = $action === 'delete_feature'
        ? avesmapsDeleteFeatureUndoColumns()
        : avesmapsUndoColumnsForAuditAction($action);
    if ($columns === []) {
        throw new InvalidArgumentException('Diese Änderung kann nicht rückgängig gemacht werden.');
    }

    $conflictColumns = $action === 'delete_feature' ? ['is_active'] : array_values(array_unique([...$columns, 'is_active']));
    avesmapsAssertUndoPatchStillCurrent($action, $feature, $afterSnapshot, $conflictColumns);
    $updates = avesmapsBuildFeatureRestoreValues($beforeSnapshot, $columns);
    if ($action === 'delete_feature') {
        $updates['is_active'] = 1;
    }
    if (array_key_exists('geometry_json', $updates)) {
        $bounds = avesmapsCalculateGeometryBounds(avesmapsReadGeometryFromColumnValue($updates['geometry_json']));
        $updates['min_x'] = $bounds['min_x'];
        $updates['min_y'] = $bounds['min_y'];
        $updates['max_x'] = $bounds['max_x'];
        $updates['max_y'] = $bounds['max_y'];
    }
    $updates['revision'] = $revision;
    $updates['updated_by'] = $userId;

    return $updates;
}

function avesmapsAssertUndoPatchStillCurrent(string $action, array $feature, array $afterSnapshot, array $columns): void {
    foreach ($columns as $column) {
        if (array_key_exists($column, $afterSnapshot)) {
            $afterValue = $afterSnapshot[$column] ?? null;
        } else {
            $inferredAfterValue = avesmapsInferUndoAfterColumnValue($action, $column);
            if (!$inferredAfterValue['found']) {
                throw new AvesmapsConflictException('Diese Aenderung enthaelt nicht genug Audit-Daten fuer ein unabhaengiges Rueckgaengigmachen.');
            }

            $afterValue = $inferredAfterValue['value'];
        }

        $currentValue = avesmapsNormalizeFeatureColumnValue($column, $feature[$column] ?? null);
        $normalizedAfterValue = avesmapsNormalizeFeatureColumnValue($column, $afterValue);
        if ($currentValue !== $normalizedAfterValue) {
            throw new AvesmapsConflictException('Diese Änderung kann nicht unabhängig rückgängig gemacht werden, weil das Objekt inzwischen erneut geändert wurde.');
        }
    }
}

function avesmapsInferUndoAfterColumnValue(string $action, string $column): array {
    if ($column === 'is_active' && $action !== 'delete_feature') {
        return [
            'found' => true,
            'value' => 1,
        ];
    }

    $constantAfterValues = match ($action) {
        'create_point',
        'wiki_sync_create_point',
        'update_point',
        'wiki_sync_update_point' => [
            'feature_type' => 'location',
        ],
        'create_crossing' => [
            'feature_type' => 'junction',
            'feature_subtype' => 'crossing',
        ],
        'create_powerline',
        'update_powerline_details' => [
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
        ],
        'create_path',
        'update_path_details' => [
            'feature_type' => 'path',
        ],
        'create_label' => [
            'feature_type' => 'label',
        ],
        'create_region' => [
            'feature_type' => 'region',
            'feature_subtype' => 'region',
        ],
        default => [],
    };

    if (!array_key_exists($column, $constantAfterValues)) {
        return [
            'found' => false,
            'value' => null,
        ];
    }

    return [
        'found' => true,
        'value' => $constantAfterValues[$column],
    ];
}

function avesmapsBuildFeatureRestoreValues(array $snapshot, array $columns): array {
    $updates = [];
    foreach ($columns as $column) {
        if (array_key_exists($column, $snapshot)) {
            $updates[$column] = avesmapsPrepareFeatureColumnValue($column, $snapshot[$column]);
        }
    }

    return $updates;
}

function avesmapsPrepareFeatureColumnValue(string $column, mixed $value): mixed {
    if (in_array($column, ['geometry_json', 'properties_json', 'style_json'], true)) {
        if ($value === null || $value === '') {
            return null;
        }

        return avesmapsEncodeJson(avesmapsDecodeFeatureJsonValue($value));
    }
    if ($column === 'is_active') {
        return (int) $value === 1 ? 1 : 0;
    }
    if (in_array($column, ['min_x', 'min_y', 'max_x', 'max_y'], true)) {
        return round((float) $value, 4);
    }

    return $value;
}

function avesmapsNormalizeFeatureColumnValue(string $column, mixed $value): string {
    if (in_array($column, ['geometry_json', 'properties_json', 'style_json'], true)) {
        return avesmapsEncodeJson(avesmapsDecodeFeatureJsonValue($value));
    }
    if ($column === 'is_active') {
        return (string) ((int) $value === 1 ? 1 : 0);
    }
    if (in_array($column, ['min_x', 'min_y', 'max_x', 'max_y'], true)) {
        return number_format((float) $value, 4, '.', '');
    }
    if ($value === null) {
        return '';
    }

    return (string) $value;
}

function avesmapsDecodeFeatureJsonValue(mixed $value): mixed {
    if ($value === null || $value === '') {
        return null;
    }
    if (is_array($value)) {
        return $value;
    }

    $decoded = json_decode((string) $value, true);
    return is_array($decoded) ? $decoded : null;
}

function avesmapsReadGeometryFromColumnValue(mixed $value): array {
    $geometry = avesmapsDecodeFeatureJsonValue($value);
    if (!is_array($geometry) || !isset($geometry['type'])) {
        throw new RuntimeException('Die Geometrie der Änderung ist ungueltig.');
    }

    return $geometry;
}

function avesmapsCalculateGeometryBounds(array $geometry): array {
    $coordinatePairs = [];
    avesmapsCollectGeometryCoordinatePairs($geometry['coordinates'] ?? null, $coordinatePairs);
    if ($coordinatePairs === []) {
        throw new RuntimeException('Die Geometrie enthaelt keine Koordinaten.');
    }

    $xValues = array_map(static fn(array $coordinate): float => $coordinate[0], $coordinatePairs);
    $yValues = array_map(static fn(array $coordinate): float => $coordinate[1], $coordinatePairs);

    return [
        'min_x' => min($xValues),
        'min_y' => min($yValues),
        'max_x' => max($xValues),
        'max_y' => max($yValues),
    ];
}

function avesmapsCollectGeometryCoordinatePairs(mixed $coordinates, array &$coordinatePairs): void {
    if (!is_array($coordinates)) {
        return;
    }
    if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
        $coordinatePairs[] = [(float) $coordinates[0], (float) $coordinates[1]];
        return;
    }

    foreach ($coordinates as $coordinate) {
        avesmapsCollectGeometryCoordinatePairs($coordinate, $coordinatePairs);
    }
}

function avesmapsAssertUndoNameIsAvailable(PDO $pdo, array $feature, array $updates): void {
    $featureType = (string) ($updates['feature_type'] ?? $feature['feature_type'] ?? '');
    $isActive = (int) ($updates['is_active'] ?? $feature['is_active'] ?? 1) === 1;
    $name = (string) ($updates['name'] ?? $feature['name'] ?? '');
    if ($isActive && $featureType === 'location' && $name !== '') {
        avesmapsAssertUniqueLocationName($pdo, $name, (string) $feature['public_id']);
    }
}

function avesmapsApplyFeatureUpdates(PDO $pdo, int $featureId, array $updates): void {
    $allowedColumns = [
        'feature_type' => true,
        'feature_subtype' => true,
        'name' => true,
        'geometry_type' => true,
        'geometry_json' => true,
        'properties_json' => true,
        'style_json' => true,
        'min_x' => true,
        'min_y' => true,
        'max_x' => true,
        'max_y' => true,
        'is_active' => true,
        'revision' => true,
        'updated_by' => true,
    ];
    $assignments = [];
    $parameters = ['id' => $featureId];
    foreach ($updates as $column => $value) {
        if (!isset($allowedColumns[$column])) {
            continue;
        }

        $assignments[] = "{$column} = :{$column}";
        $parameters[$column] = $value;
    }
    if ($assignments === []) {
        throw new RuntimeException('Es gibt keine Undo-Änderungen zum Speichern.');
    }

    $statement = $pdo->prepare('UPDATE map_features SET ' . implode(', ', $assignments) . ' WHERE id = :id');
    $statement->execute($parameters);
}

function avesmapsBuildUndoAuditAction(string $action): string {
    return mb_substr('undo_' . $action, 0, 40);
}

function avesmapsBuildUndoAuditSnapshot(array $feature, int $auditId): array {
    $snapshot = $feature;
    $snapshot['undo_audit_id'] = $auditId;
    return $snapshot;
}

function avesmapsMarkAuditEntryUndone(PDO $pdo, int $auditId, int $userId, int $undoAuditId): void {
    $statement = $pdo->prepare(
        'UPDATE map_audit_log
        SET undone_at = CURRENT_TIMESTAMP(3),
            undone_by = :undone_by,
            undo_audit_id = :undo_audit_id
        WHERE id = :id'
    );
    $statement->execute([
        'id' => $auditId,
        'undone_by' => $userId,
        'undo_audit_id' => $undoAuditId,
    ]);
}

function avesmapsRestoreExternalReviewStateAfterUndo(PDO $pdo, string $action, array $beforeSnapshot, array $afterSnapshot): void {
    $wikiSyncCaseId = avesmapsReadAuditContextId($afterSnapshot, 'wiki_sync_case_id') ?? avesmapsReadAuditContextId($beforeSnapshot, 'wiki_sync_case_id');
    if ($wikiSyncCaseId !== null && str_starts_with($action, 'wiki_sync_') && avesmapsTableExistsForAudit($pdo, 'wiki_sync_cases')) {
        $statement = $pdo->prepare(
            "UPDATE wiki_sync_cases
            SET status = 'open',
                reviewed_at = NULL,
                reviewed_by = NULL,
                resolution_json = NULL
            WHERE id = :id"
        );
        $statement->execute(['id' => $wikiSyncCaseId]);
    }

    $reviewReport = avesmapsReadAuditReviewReportContext($afterSnapshot) ?? avesmapsReadAuditReviewReportContext($beforeSnapshot);
    if ($reviewReport !== null && avesmapsIsCreateAuditAction($action) && avesmapsTableExistsForAudit($pdo, $reviewReport['source'])) {
        $reviewedBySql = $reviewReport['source'] === 'map_reports' ? ', reviewed_by = NULL' : '';
        $statement = $pdo->prepare(
            "UPDATE {$reviewReport['source']}
            SET status = 'neu',
                reviewed_at = NULL,
                review_note = NULL
                {$reviewedBySql}
            WHERE id = :id"
        );
        $statement->execute(['id' => $reviewReport['id']]);
    }
}

function avesmapsReadAuditContextId(array $snapshot, string $key): ?int {
    $context = is_array($snapshot['audit_context'] ?? null) ? $snapshot['audit_context'] : [];
    $value = $snapshot[$key] ?? $context[$key] ?? null;
    $id = filter_var($value, FILTER_VALIDATE_INT);
    return $id !== false && $id > 0 ? (int) $id : null;
}

function avesmapsReadAuditReviewReportContext(array $snapshot): ?array {
    $context = is_array($snapshot['audit_context'] ?? null) ? $snapshot['audit_context'] : [];
    $reviewReport = is_array($context['review_report'] ?? null) ? $context['review_report'] : [];
    $id = filter_var($snapshot['review_report_id'] ?? $reviewReport['id'] ?? null, FILTER_VALIDATE_INT);
    $source = avesmapsNormalizeSingleLine((string) ($snapshot['review_report_source'] ?? $reviewReport['source'] ?? ''), 40);
    if ($id === false || $id <= 0 || !in_array($source, ['location_reports', 'map_reports'], true)) {
        return null;
    }

    return [
        'id' => (int) $id,
        'source' => $source,
    ];
}

function avesmapsTableExistsForAudit(PDO $pdo, string $tableName): bool {
    if (preg_match('/^[a-z0-9_]+$/i', $tableName) !== 1) {
        return false;
    }

    $statement = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($tableName));
    return $statement !== false && $statement->fetch() !== false;
}

function avesmapsBuildFeatureResponseFromStoredFeature(array $feature): array {
    $publicId = (string) $feature['public_id'];
    $revision = (int) $feature['revision'];
    if ((int) ($feature['is_active'] ?? 1) !== 1) {
        return [
            'public_id' => $publicId,
            'deleted' => true,
            'revision' => $revision,
        ];
    }

    $geometry = avesmapsReadGeometryFromColumnValue($feature['geometry_json'] ?? null);
    $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
    $featureType = (string) ($feature['feature_type'] ?? $properties['feature_type'] ?? '');
    $featureSubtype = (string) ($feature['feature_subtype'] ?? $properties['feature_subtype'] ?? '');
    $name = (string) ($feature['name'] ?? $properties['name'] ?? '');

    if ($featureType === 'label') {
        [$lng, $lat] = avesmapsReadPointCoordinatesFromGeometry($geometry);
        return avesmapsBuildLabelFeatureResponse($publicId, $name, $featureSubtype, $lat, $lng, $properties, $revision);
    }
    if ($featureType === 'powerline') {
        return avesmapsBuildPowerlineFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    }
    if ($featureType === 'region' || ($geometry['type'] ?? '') === 'Polygon') {
        $style = avesmapsDecodeJsonColumnForEdit($feature['style_json'] ?? null);
        return avesmapsBuildRegionFeatureResponse($publicId, $name, $geometry, $properties + $style, $revision);
    }
    if (($geometry['type'] ?? '') === 'LineString') {
        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $featureSubtype, $geometry, $properties, $revision);
    }
    if (($geometry['type'] ?? '') === 'Point') {
        [$lng, $lat] = avesmapsReadPointCoordinatesFromGeometry($geometry);
        return avesmapsBuildPointFeatureResponse($publicId, $name, $featureSubtype, $lat, $lng, $properties, $revision);
    }

    throw new RuntimeException('Das wiederhergestellte Kartenobjekt kann nicht dargestellt werden.');
}

function avesmapsReadLabelSubtype(mixed $value): string {
    $subtype = avesmapsNormalizeSingleLine((string) ($value ?: 'region'), 40);
    // 🔴 Diese Liste und AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED haengen zusammen: der Subtyp eines Labels
    // IST der Art-Schluessel seiner Region (der V5-Import hat die beiden Vokabulare gleichgesetzt). Eine
    // gesaete Art, die hier fehlt, laesst sich an keinem Label speichern -- 400 auf ein Label, dessen
    // Flaeche die Art laengst traegt. ecosystem-geometry-test.php prueft genau diese Deckung.
    // 🔴 'urwald' seit 2026-08-29 (Garetien-Import): AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED bekam die
    // Art dazu, und ohne den Eintrag hier liesse sich an keinem Label speichern -- siehe den
    // Kommentar oben an dieser Liste.
    $allowedSubtypes = ['region', 'fluss', 'meer', 'gebirge', 'berggipfel', 'wald', 'urwald', 'steppe', 'huegelland', 'tundra', 'kueste', 'ebene', 'graslandschaft', 'auenlandschaft', 'flussland_flusstal', 'dschungel', 'wuestenoase', 'wadi', 'schlucht', 'hochebene', 'tiefebene', 'tal', 'flussdelta', 'kulturlandschaft', 'vulkan', 'kontinent', 'wueste', 'suempfe_moore', 'see', 'insel', 'inselgruppe', 'sonstiges',
        // 🔴 01.09.2026 (Editorenwunsch): drei FREIE Label-Arten in der Familie von
        // Berggipfel und Vulkan -- sie haben KEIN Flaechen-Gegenstueck und stehen deshalb
        // nur hier, nicht im Seed. Dazu 'vorgebirge_mittelgebirge', das SEHR WOHL eine
        // Flaechenart ist (topographie) -- dort waere sein Fehlen hier ein 400 auf jedes
        // Label, dessen Flaeche die Art laengst traegt.
        'felsformation', 'bergkette', 'huegel', 'vorgebirge_mittelgebirge'];
    if (!in_array($subtype, $allowedSubtypes, true)) {
        throw new InvalidArgumentException('Die Label-Kategorie ist ungueltig.');
    }

    return $subtype;
}

function avesmapsReadLabelText(mixed $value): string {
    return avesmapsReadFeatureName($value, 'Der Labeltext');
}

function avesmapsReadLabelSize(mixed $value): int {
    $size = filter_var($value, FILTER_VALIDATE_INT);
    if ($size === false || $size < 10 || $size > 56) {
        throw new InvalidArgumentException('Die Label-Groesse ist ungueltig.');
    }

    return (int) $size;
}

function avesmapsReadLabelRotation(mixed $value): int {
    $rotation = filter_var($value, FILTER_VALIDATE_INT);
    if ($rotation === false || $rotation < -360 || $rotation > 360) {
        throw new InvalidArgumentException('Die Label-Rotation ist ungueltig.');
    }

    return (int) $rotation;
}

function avesmapsReadLabelZoom(mixed $value): int {
    $zoom = filter_var($value, FILTER_VALIDATE_INT);
    // Karte erlaubt jetzt Zoom 7 -> Label-Sichtbarkeit darf bis 7 reichen (vorher 5).
    if ($zoom === false || $zoom < 0 || $zoom > 7) {
        throw new InvalidArgumentException('Die Label-Zoomstufe ist ungueltig.');
    }

    return (int) $zoom;
}

function avesmapsReadLabelPriority(mixed $value): int {
    $priority = filter_var($value, FILTER_VALIDATE_INT);
    if ($priority === false || $priority < 1 || $priority > 5) {
        throw new InvalidArgumentException('Die Label-Prioritaet ist ungueltig.');
    }

    return (int) $priority;
}

// Bereinigt den optionalen Wiki-Landschafts-Datensatz, der per Picker an ein Label geheftet
// wird (Felder werden ins Label kopiert -> self-contained; wiki_key erlaubt spaeteres Re-Sync).
// Gibt null zurueck, wenn keine gueltige Zuordnung vorliegt (= Zuordnung entfernen).
// 🔴 EINE Region, VIELE Labels (Owner 2026-07-28). Ein Gebirge wie der Finsterkamm will im Norden und
// im Sueden beschriftet werden -- zwei Labels derselben Flaeche, mit eigener Drehung, Groesse und Lage.
//
// Die Zugehoerigkeit sitzt deshalb am LABEL und zeigt auf die Region, nicht umgekehrt: `n` Labels
// koennen auf eine Region zeigen, ein einzelnes `ecosystem_region.label_public_id` kann nur eines
// halten. Jenes bleibt trotzdem -- es bezeichnet das PRIMAERE Label, also das, welches der
// Regionsdialog verwaltet ("Regionname anzeigen", Nodix, Umbenennen). Zwei Fragen, zwei Felder:
// "welche Labels gehoeren zu dieser Flaeche" und "welches davon fuehrt sie".
//
// 💣 KEINE neue Tabelle (AGENTS.md §5). Die Beziehung passt in eine Eigenschaft am Label.
function avesmapsReadLabelEcosystemRegion(array $payload): string {
    if (!array_key_exists('ecosystem_region_public_id', $payload)) {
        return '';
    }

    return avesmapsNormalizeSingleLine((string) ($payload['ecosystem_region_public_id'] ?? ''), 36);
}

function avesmapsReadLabelWikiRegion(mixed $value): ?array {
    if (!is_array($value)) {
        return null;
    }
    $wikiKey = avesmapsNormalizeSingleLine((string) ($value['wiki_key'] ?? ''), 255);
    if ($wikiKey === '') {
        return null;
    }

    $line = static fn(mixed $v, int $len): string => avesmapsNormalizeSingleLine((string) ($v ?? ''), $len);
    $text = static fn(mixed $v, int $len): string => mb_substr(trim((string) ($v ?? '')), 0, $len, 'UTF-8');
    $url = static function (mixed $v): string {
        $raw = trim((string) ($v ?? ''));
        if ($raw === '') {
            return '';
        }
        try {
            return avesmapsNormalizeOptionalUrl($raw, 500, 'Der Wiki-Link');
        } catch (Throwable) {
            return '';
        }
    };

    $neighbors = [];
    $rawNeighbors = $value['neighbors'] ?? $value['neighbors_json'] ?? null;
    if (is_array($rawNeighbors)) {
        foreach ($rawNeighbors as $direction => $names) {
            $dir = $line($direction, 4);
            $list = [];
            foreach ((is_array($names) ? $names : [$names]) as $n) {
                $n = $text($n, 120);
                if ($n !== '') {
                    $list[] = $n;
                }
            }
            if ($dir !== '' && $list !== []) {
                $neighbors[$dir] = array_slice($list, 0, 12);
            }
        }
    }

    $synonyms = [];
    if (is_array($value['synonyms'] ?? $value['synonyms_json'] ?? null)) {
        foreach (($value['synonyms'] ?? $value['synonyms_json']) as $s) {
            $s = $text($s, 160);
            if ($s !== '') {
                $synonyms[] = $s;
            }
        }
        $synonyms = array_slice(array_values(array_unique($synonyms)), 0, 40);
    }

    return [
        'wiki_key' => $wikiKey,
        'name' => $line($value['name'] ?? '', 255),
        'art' => $line($value['art'] ?? '', 120),
        'continent' => $line($value['continent'] ?? '', 120),
        'region_parent' => $line($value['region_parent'] ?? '', 255),
        'affiliation_staat' => $line($value['affiliation_staat'] ?? '', 255),
        'einwohner' => $line($value['einwohner'] ?? '', 255),
        'sprache' => $line($value['sprache'] ?? '', 255),
        'vegetation' => $text($value['vegetation'] ?? '', 500),
        'verkehrswege' => $text($value['verkehrswege'] ?? '', 500),
        'description' => $text($value['description'] ?? '', 2000),
        'image_url' => $url($value['image_url'] ?? ''),
        'image_license' => $line($value['image_license'] ?? '', 120),
        'image_author' => $line($value['image_author'] ?? '', 255),
        'image_attribution' => $text($value['image_attribution'] ?? '', 500),
        'image_license_status' => $line($value['image_license_status'] ?? '', 40),
        'image_license_url' => $url($value['image_license_url'] ?? ''),
        'wiki_url' => $url($value['wiki_url'] ?? ''),
        'neighbors' => $neighbors,
        'synonyms' => $synonyms,
        'synced_at' => $line($value['synced_at'] ?? '', 40),
    ];
}

function avesmapsReadHexColor(mixed $value): string {
    $color = avesmapsNormalizeSingleLine((string) ($value ?: '#888888'), 9);
    if (!preg_match('/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/', $color)) {
        throw new InvalidArgumentException('Der Farbwert ist ungueltig.');
    }

    return $color;
}

function avesmapsReadOpacity(mixed $value): float {
    $opacity = filter_var($value, FILTER_VALIDATE_FLOAT);
    if ($opacity === false || $opacity < 0 || $opacity > 1) {
        throw new InvalidArgumentException('Die Transparenz ist ungueltig.');
    }

    return (float) $opacity;
}

function avesmapsReadPolygonCoordinates(mixed $value): array {
    if (!is_array($value) || count($value) < 1 || !is_array($value[0] ?? null) || count($value[0]) < 4) {
        throw new InvalidArgumentException('Eine Region braucht mindestens drei Punkte.');
    }

    $ring = [];
    foreach ($value[0] as $coordinate) {
        if (!is_array($coordinate) || count($coordinate) !== 2) {
            throw new InvalidArgumentException('Die Regionskoordinaten sind ungueltig.');
        }
        $ring[] = [
            avesmapsParseMapCoordinate($coordinate[0], 'lng'),
            avesmapsParseMapCoordinate($coordinate[1], 'lat'),
        ];
    }

    return [$ring];
}

function avesmapsReadOptionalWikiUrl(mixed $value): string {
    return avesmapsNormalizeOptionalUrl((string) $value, 500, 'Der Wiki-Aventurica-Link');
}

// A peak's own height, in Schritt, stored in properties.height_schritt of a berggipfel label.
// Returns null for "not recorded", which is NOT the same as zero: an unrecorded peak falls back to
// a placeholder when the height field is built, a peak recorded as 0 does not. The caller must
// treat null as "remove the property", never as "write 0".
//
// The unit is in the NAME on purpose. V11 will multiply these into edge weights and carries a
// documented unit trap (x3 vs x23); a bare `height` invites exactly that mistake.
//
// The upper bound is a typo guard -- one zero too many -- not a claim about Aventurien. Negative
// input is REJECTED rather than clamped to 0, because a minus sign is a mistake worth losing the
// value over, not an intent to record sea level.
function avesmapsReadOptionalPeakHeight(mixed $value): ?float {
    if ($value === null || (is_string($value) && trim($value) === '')) {
        return null;
    }
    // Editors type German: a comma is the decimal point. Booleans and arrays fall through to
    // is_numeric() below and are rejected there -- (float) true would otherwise mean 1 Schritt.
    if (is_string($value)) {
        $value = str_replace(',', '.', trim($value));
    }
    if (!is_numeric($value)) {
        return null;
    }
    $height = (float) $value;
    if (!is_finite($height) || $height < 0) {
        return null;
    }

    return min($height, 20000.0);
}

// Optional non-wiki source: a { url, label } object stored in properties.other_source. Returns
// null when no usable URL was supplied (empty url -> the field is treated as unset). The url must
// be an absolute http(s) link (same rule as the wiki link); label is a free-form single line.
function avesmapsReadOptionalOtherSource(mixed $value): ?array {
    if (!is_array($value)) {
        return null;
    }
    $url = avesmapsNormalizeOptionalUrl((string) ($value['url'] ?? ''), 500, 'Der Quellen-Link');
    if ($url === '') {
        return null;
    }
    return [
        'url' => $url,
        'label' => avesmapsNormalizeSingleLine((string) ($value['label'] ?? ''), 255),
    ];
}

function avesmapsFetchEditableFeature(PDO $pdo, string $publicId): array {
    $statement = $pdo->prepare(
        'SELECT id, public_id, feature_type, feature_subtype, name, geometry_type, geometry_json, properties_json, style_json, revision
        FROM map_features
        WHERE public_id = :public_id
            AND is_active = 1
        LIMIT 1
        FOR UPDATE'
    );
    $statement->execute([
        'public_id' => $publicId,
    ]);

    $feature = $statement->fetch();
    if (!$feature) {
        throw new InvalidArgumentException('Das Kartenobjekt wurde nicht gefunden.');
    }

    return $feature;
}

function avesmapsFetchEditablePointFeature(PDO $pdo, string $publicId): array {
    $feature = avesmapsFetchEditableFeature($pdo, $publicId);
    if ((string) $feature['geometry_type'] !== 'Point') {
        throw new InvalidArgumentException('Aktuell kann diese Aktion nur Punkte bearbeiten.');
    }

    return $feature;
}

function avesmapsFetchEditableLineStringFeature(PDO $pdo, string $publicId): array {
    $feature = avesmapsFetchEditableFeature($pdo, $publicId);
    if ((string) $feature['geometry_type'] !== 'LineString') {
        throw new InvalidArgumentException('Diese Aktion kann nur Wege bearbeiten.');
    }

    return $feature;
}

function avesmapsEnsureMapFeatureLocksTable(PDO $pdo): void {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS map_feature_locks (
            public_id CHAR(36) NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            username VARCHAR(120) NOT NULL,
            locked_until DATETIME(3) NOT NULL,
            updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (public_id),
            KEY idx_map_feature_locks_locked_until (locked_until)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function avesmapsAssertFeatureCanBeEdited(PDO $pdo, array $payload, array $feature, array $user): void {
    $expectedRevision = avesmapsReadOptionalRevision($payload['expected_revision'] ?? null);
    if ($expectedRevision !== null && $expectedRevision !== (int) $feature['revision']) {
        throw new AvesmapsConflictException('Dieses Kartenobjekt wurde inzwischen geaendert. Bitte neu laden.');
    }

    $statement = $pdo->prepare(
        'SELECT user_id, username
        FROM map_feature_locks
        WHERE public_id = :public_id
            AND locked_until > NOW(3)
        LIMIT 1'
    );
    $statement->execute(['public_id' => (string) $feature['public_id']]);
    $lock = $statement->fetch();
    if ($lock && (int) $lock['user_id'] !== (int) $user['id']) {
        throw new AvesmapsConflictException('Dieses Kartenobjekt wird gerade von ' . (string) $lock['username'] . ' bearbeitet.');
    }
}

function avesmapsAcquireMapFeatureLock(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    avesmapsEnsureMapFeatureLocksTable($pdo);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $statement = $pdo->prepare(
            'INSERT INTO map_feature_locks (public_id, user_id, username, locked_until)
            VALUES (:public_id, :user_id, :username, DATE_ADD(NOW(3), INTERVAL ' . AVESMAPS_FEATURE_LOCK_TTL_SECONDS . ' SECOND))
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                username = VALUES(username),
                locked_until = VALUES(locked_until)'
        );
        $statement->execute([
            'public_id' => $publicId,
            'user_id' => (int) $user['id'],
            'username' => (string) ($user['username'] ?? 'Editor'),
        ]);
        $pdo->commit();

        return [
            'public_id' => $publicId,
            'locked' => true,
            'locked_by' => (string) ($user['username'] ?? 'Editor'),
            'locked_until_seconds' => AVESMAPS_FEATURE_LOCK_TTL_SECONDS,
            'revision' => (int) $feature['revision'],
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsReleaseMapFeatureLock(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    avesmapsEnsureMapFeatureLocksTable($pdo);
    $statement = $pdo->prepare('DELETE FROM map_feature_locks WHERE public_id = :public_id AND user_id = :user_id');
    $statement->execute([
        'public_id' => $publicId,
        'user_id' => (int) $user['id'],
    ]);

    return [
        'public_id' => $publicId,
        'locked' => false,
    ];
}

function avesmapsMovePointFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $geometry = [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ];
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_lng,
                min_y = :min_lat,
                max_x = :max_lng,
                max_y = :max_lat,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_lng' => $lng,
            'min_lat' => $lat,
            'max_lng' => $lng,
            'max_lat' => $lat,
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'move_point', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, (string) ($feature['name'] ?? ''), (string) $feature['feature_subtype'], $lat, $lng, avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null), $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

/**
 * Die drei Wiki-Angaben eines Ortes, die ein Editor selbst pflegt -- Kartenfeld => Hoechstlaenge.
 *
 * 🔴 DIE NAMEN SIND DIE DES NESTS `properties.wiki_settlement` (einwohner/lage/oberhaupt), und die
 * Laengen sind DESSEN Laengen (avesmapsWikiSettlementParseInfobox, api/_internal/wiki/settlements.php
 * :622, :627, :624 -- abgelesen, nicht gewaehlt). Nur so bleibt die Erklaerung im Feldregister eine
 * Zeile je Feld: Wiki-Feld und Kartenfeld heissen gleich, niemand muss uebersetzen.
 *
 * ⚠️ `lage` ist im Nest die ZUSAMMENSETZUNG aus Region und Staat ("Albernia · Mittelreich"), kein
 * eigenes Infoboxfeld -- als Kartenfeld ist es trotzdem eine gewoehnliche Zeichenkette. Die zwei
 * Haelften bleiben daneben Anzeige; sie haben kein Kartenziel.
 */
const AVESMAPS_POINT_WIKI_TEXT_FIELDS = [
    'einwohner' => 200,
    'lage' => 300,
    'oberhaupt' => 200,
];

/**
 * Die Felder eines Ortes, die aus dem Wiki kommen KOENNEN -- und damit die einzigen, fuer die eine
 * Feldherkunft gefuehrt wird (Entwurf 2026-08-17-wiki-override-fuer-alle-design.md §1.2).
 *
 * 🔴 SIE IST DIE GEGENPROBE ZUM FELDREGISTER, nicht seine Wiederholung: dieselben fuenf stehen im
 * Browser als AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER (js/ui/wiki-assign-ort.js) und als die Zeilen
 * mit Kartenziel in der Erklaerung `ort` (js/ui/wiki-assign-registry.js). Weichen sie voneinander
 * ab, zeigt der Editor eine Zeile, deren Herkunft niemand fortschreibt -- oder umgekehrt.
 *
 * ⚠️ `name` und `feature_subtype` sind SPALTEN, die drei uebrigen liegen im `properties_json`. Fuer
 * die Herkunft ist das gleichgueltig: sie fragt nach dem Feldnamen, nicht nach seiner Ablage.
 */
const AVESMAPS_POINT_WIKI_ORIGIN_FIELDS = ['name', 'feature_subtype', 'einwohner', 'lage', 'oberhaupt'];

/**
 * Dasselbe fuer ein LANDSCHAFTS-LABEL. 🔴 Es heisst `text`, nicht `name` -- so heisst das Namensfeld
 * eines Labels, und genau so steht es im Feldregister (Objektart `landschaftslabel`). Die Spalte
 * `map_features.name` traegt dieselbe Zeichenkette als Abbild und bekommt deshalb KEINE eigene
 * Herkunft; zwei Herkuenfte fuer einen Wert waeren die erste Divergenz.
 */
const AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS = ['text', 'feature_subtype'];

/**
 * Dasselbe fuer einen WEG -- und es ist genau EIN Feld.
 *
 * 🔴 `name` STEHT ABSICHTLICH NICHT HIER, obwohl der Weg einen Namen hat und das Wiki ihn liefert.
 * Den Namen schreibt `assign_to` serverseitig auf den ganzen Namensverbund
 * (avesmapsWikiPathEffectiveEditName: „ein zugewiesener Wiki-Weg BESITZT den Namen"), das Formular
 * kann ihn also gar nicht gegen das Wiki setzen. Eine Herkunft dafuer gehoert an die ZUWEISUNG,
 * nicht an dieses Speichern -- und sie hier zu fuehren hiesse, bei jedem Speichern eines
 * zugewiesenen Weges `manual` auf einen Wert zu stempeln, den der Server selbst gerade
 * durchgesetzt hat.
 *
 * ⚠️ Das Feldregister (js/ui/wiki-assign-registry.js, Objektart `weg`) fuehrt genau ein
 * Kartenziel: `wegtyp` -> `feature_subtype`. Die drei uebrigen Zeilen (art, lage, laenge) sind
 * Anzeige ohne Kartenziel; die Laenge entsteht aus der Geometrie und wird nicht gepflegt.
 */
const AVESMAPS_PATH_WIKI_ORIGIN_FIELDS = ['feature_subtype'];

/**
 * REIN: die Wiki-Angaben eines Ortes in seine Eigenschaften schreiben -- der Merker „kein Artikel"
 * und die drei Textfelder. Wirft, wenn Merker und Adresse einander widersprechen.
 *
 * 💣 ABWESENHEIT HEISST „NICHT GEAENDERT", LEER HEISST „LOESCHEN". Das ist der Unterschied zum
 * Kraftlinien-Schreibweg daneben, der `$payload['wiki_no_article'] ?? false` liest -- und er ist
 * begruendet, nicht Geschmack: die Kraftlinie hat EINEN Schreiber, und der schickt den Merker seit
 * jeher. `update_point` hat ZWEI (buildLocationEditPayload in js/review/review-locations.js und
 * buildSettlementSavePayload in html/wiki-sync-settlement-editor.html) und dazu die Ladeluecke eines
 * Deploys: eine gecachte index.html, die diese Felder noch nicht kennt (AGENTS.md §7), wuerde mit
 * `?? ''` bei JEDEM Speichern die Einwohnerzahl loeschen und die Entscheidung des Konfliktzentrums
 * („Kein Wiki-Eintrag") stillschweigend zuruecknehmen. Ein Schreiber, der ein Feld nicht kennt, darf
 * es nicht leeren.
 *
 * ⚠️ Der Merker steht nur drin, wenn er WAHR ist -- als `false` wird er nirgends abgelegt, sonst
 * liesse er sich spaeter nicht von „nie entschieden" unterscheiden (dieselbe Regel wie bei den
 * Kraftlinien, avesmapsPowerlineInheritedLineFields).
 *
 * @param array $properties der bereits dekodierte Bestand
 * @param array $payload    die Anfrage
 * @param string $wikiUrl   die flache Adresse, wie sie gleich gespeichert wird ('' = keine)
 */
function avesmapsApplyPointWikiFields(array $properties, array $payload, string $wikiUrl): array {
    $noArticle = array_key_exists('wiki_no_article', $payload)
        ? avesmapsReadBoolean($payload['wiki_no_article'])
        : !empty($properties['wiki_no_article']);
    avesmapsAssertWikiClaimNotContradictory(
        $wikiUrl,
        $noArticle,
        'Ein Ort',
        'Bitte die Wiki-Zuweisung entfernen oder das Häkchen „Kein Wiki-Artikel vorhanden“ abwählen.'
    );
    if ($noArticle) {
        $properties['wiki_no_article'] = true;
    } else {
        unset($properties['wiki_no_article']);
    }

    foreach (AVESMAPS_POINT_WIKI_TEXT_FIELDS as $feld => $laenge) {
        if (!array_key_exists($feld, $payload)) {
            continue;
        }
        $wert = mb_substr(trim((string) $payload[$feld]), 0, $laenge, 'UTF-8');
        if ($wert === '') {
            unset($properties[$feld]);
        } else {
            $properties[$feld] = $wert;
        }
    }

    return $properties;
}

function avesmapsUpdatePointFeatureDetails(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadLocationName($payload['name'] ?? '');
    $subtype = avesmapsReadLocationSubtype($payload['feature_subtype'] ?? $payload['location_type'] ?? 'dorf');
    $description = avesmapsReadLocationDescription($payload['description'] ?? '');
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $currentName = (string) ($feature['name'] ?? '');
        if (avesmapsNormalizeDuplicateLocationName($currentName) !== avesmapsNormalizeDuplicateLocationName($name)) {
            avesmapsAssertUniqueLocationName($pdo, $name, $publicId);
        }
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        // 🔴 DER STAND VOR DEM SPEICHERN -- hier und nirgends spaeter, denn die naechsten Zeilen
        // ueberschreiben genau diese Felder. Aus den SPALTEN gelesen, nicht aus dem Nest: `name` und
        // `feature_subtype` stehen doppelt da (die Kopie im properties_json ist ein Abbild), und
        // massgeblich ist, was die Karte laedt.
        $herkunftVorher = [
            'name' => (string) ($feature['name'] ?? ''),
            'feature_subtype' => (string) ($feature['feature_subtype'] ?? ''),
            'einwohner' => (string) ($properties['einwohner'] ?? ''),
            'lage' => (string) ($properties['lage'] ?? ''),
            'oberhaupt' => (string) ($properties['oberhaupt'] ?? ''),
        ];
        $properties['name'] = $name;
        $properties['feature_type'] = 'location';
        $properties['feature_subtype'] = $subtype;
        $properties['settlement_class'] = $subtype;
        $properties['settlement_class_label'] = avesmapsLocationSubtypeLabel($subtype);
        $properties['is_nodix'] = avesmapsReadBoolean($payload['is_nodix'] ?? false);
        $properties['is_ruined'] = avesmapsReadBoolean($payload['is_ruined'] ?? false);
        // Versteckt: Markierung und Name bleiben von der Karte weg, und die Routenfindung waehlt den
        // Ort nicht als Kandidat -- bis jemand seinen Namen eingibt (Owner 15.08.2026).
        // 🪤 DER NAME IST IM PROJEKT ZWEIMAL VERGEBEN. map_reviews.is_hidden bedeutet -- von der
        // Moderation verborgen -- und gehoert den Rezensionen (api/_internal/reviews.php); dieses hier
        // gehoert dem ORT und liegt im properties_json. Sie teilen keine Tabelle und keine Datei,
        // aber `git grep is_hidden` findet beide -- also steht der Unterschied hier.
        $properties['is_hidden'] = avesmapsReadBoolean($payload['is_hidden'] ?? false);
        // Ortsart ("Brücke", "Oase", ...) -- beschreibt den Ort, aendert NICHT seine Darstellung.
        // Absent = leer: das Feld ist optional, und "leer" ist eine gueltige Antwort, kein Fehlen.
        $placeKind = avesmapsNormalizePlaceKind((string) ($payload['place_kind'] ?? ''));
        if ($placeKind === '') {
            unset($properties['place_kind']);
        } else {
            $properties['place_kind'] = $placeKind;
        }
        if ($description === '') {
            unset($properties['description']);
        } else {
            $properties['description'] = $description;
        }
        if ($wikiUrl === '') {
            unset($properties['wiki_url']);
        } else {
            $properties['wiki_url'] = $wikiUrl;
        }
        // Der dritte Zustand („dieser Ort hat KEINEN Wiki-Artikel") und die drei Wiki-Textfelder.
        // 💣 Die ganze Entscheidung steht in avesmapsApplyPointWikiFields, nicht hier: sie ist rein
        // und damit ohne Datenbank pruefbar -- und sie ist die EINZIGE Stelle, die die Feldnamen
        // kennt. Ohne den Merker raet avesmapsEnrichMapFeatureWikiUrl (api/app/map-features.php:975)
        // beim naechsten Kartenladen eine Adresse aus dem Ortsnamen zurueck, und ein entfernter
        // Wiki-Link kehrt wieder: das IST Discord #38.
        $properties = avesmapsApplyPointWikiFields($properties, $payload, $wikiUrl);
        // Die Feldherkunft fortschreiben: was hat sich geaendert, und kam es aus dem Wiki?
        // 💣 HIER UND NICHT FRUEHER -- verglichen wird der GESPEICHERTE Wert. avesmapsApplyPointWikiFields
        // kappt die drei Textfelder auf 200/300/200 Zeichen; gegen den rohen Anfragewert verglichen
        // meldete ein ueberlanges Feld bei JEDEM Speichern „geaendert" und truege danach ewig eine
        // Herkunft, die niemand gesetzt hat.
        // ⚠️ Ein leeres Ergebnis wird ENTFERNT statt als `[]` abgelegt: dieselbe Regel wie beim
        // Merker `wiki_no_article` -- was nichts aussagt, steht nicht drin.
        $herkunft = avesmapsFieldOriginsStempeln(
            is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [],
            $herkunftVorher,
            [
                'name' => $name,
                'feature_subtype' => $subtype,
                'einwohner' => (string) ($properties['einwohner'] ?? ''),
                'lage' => (string) ($properties['lage'] ?? ''),
                'oberhaupt' => (string) ($properties['oberhaupt'] ?? ''),
            ],
            avesmapsFieldOriginsAusWikiLesen($payload, AVESMAPS_POINT_WIKI_ORIGIN_FIELDS)
        );
        if ($herkunft === []) {
            unset($properties['field_origins']);
        } else {
            $properties['field_origins'] = $herkunft;
        }
        $otherSource = avesmapsReadOptionalOtherSource($payload['other_source'] ?? null);
        if ($otherSource === null) {
            unset($properties['other_source']);
        } else {
            $properties['other_source'] = $otherSource;
        }

        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        [$lng, $lat] = avesmapsReadPointCoordinatesFromGeometry($geometry);
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_type = :feature_type,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $name,
            'feature_type' => 'location',
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_point', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'location',
            'name' => $name,
            'feature_subtype' => $subtype,
            'is_nodix' => $properties['is_nodix'],
            'is_ruined' => $properties['is_ruined'],
            'is_hidden' => $properties['is_hidden'],
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreatePointFeature(PDO $pdo, array $payload, array $user): array {
    $name = avesmapsReadLocationName($payload['name'] ?? '');
    $subtype = avesmapsReadLocationSubtype($payload['feature_subtype'] ?? $payload['location_type'] ?? 'dorf');
    $description = avesmapsReadLocationDescription($payload['description'] ?? '');
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'settlement_class' => $subtype,
        'settlement_class_label' => avesmapsLocationSubtypeLabel($subtype),
        'is_nodix' => avesmapsReadBoolean($payload['is_nodix'] ?? false),
        'is_ruined' => avesmapsReadBoolean($payload['is_ruined'] ?? false),
        'is_hidden' => avesmapsReadBoolean($payload['is_hidden'] ?? false),
    ];
    // Ortsart -- siehe avesmapsUpdatePointFeatureDetails. Nur setzen, wenn wirklich eine kam:
    // ein leerer Schluessel im JSON waere eine Behauptung ("keine Art"), die niemand getroffen hat.
    $placeKind = avesmapsNormalizePlaceKind((string) ($payload['place_kind'] ?? ''));
    if ($placeKind !== '') {
        $properties['place_kind'] = $placeKind;
    }
    if ($description !== '') {
        $properties['description'] = $description;
    }
    if ($wikiUrl !== '') {
        $properties['wiki_url'] = $wikiUrl;
    }
    // 💣 DERSELBE Rechner wie beim Aendern, und das ist kein Schoenheitsfehler: der Dialog „Ort
    // bearbeiten" ist im ANLEGEN-Fall derselbe, samt Zuweisungskasten und dessen Häkchen „Kein
    // Wiki-Artikel vorhanden". Ohne diese Zeile wäre das Häkchen beim Anlegen ein Häkchen, das nichts
    // merkt -- und die drei Wiki-Textfelder daneben blieben genauso stumm.
    $properties = avesmapsApplyPointWikiFields($properties, $payload, $wikiUrl);
    // Die Feldherkunft eines FRISCH ANGELEGTEN Ortes.
    // 🔴 DER ANLEGEFALL IST DER ZWEITE SCHREIBWEG, und er ist beim Bauen zuerst uebersehen worden --
    // gefunden hat ihn nicht der Autor, sondern die Verdrahtungs-Zusicherung in
    // __tests__/field-origins-test.php, die die Schreibwege zur LAUFZEIT zaehlt. Genau dafuer steht
    // in ihrem Kommentar keine Zahl (die Falle vom 14.08.2026).
    // ⚠️ „Vorher" ist hier durchweg LEER -- ein neuer Ort hat keinen Vorzustand. Jedes gefuellte Feld
    // ist damit eine Aenderung und bekommt eine Herkunft; genau richtig, denn ein Ort, der aus einer
    // Wiki-Zuweisung heraus entsteht, traegt seine Werte wirklich aus dem Wiki.
    $herkunftNeu = avesmapsFieldOriginsStempeln(
        [],
        [],
        [
            'name' => $name,
            'feature_subtype' => $subtype,
            'einwohner' => (string) ($properties['einwohner'] ?? ''),
            'lage' => (string) ($properties['lage'] ?? ''),
            'oberhaupt' => (string) ($properties['oberhaupt'] ?? ''),
        ],
        avesmapsFieldOriginsAusWikiLesen($payload, AVESMAPS_POINT_WIKI_ORIGIN_FIELDS)
    );
    if ($herkunftNeu !== []) {
        $properties['field_origins'] = $herkunftNeu;
    }

    $pdo->beginTransaction();
    try {
        avesmapsAssertUniqueLocationName($pdo, $name);
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'location',
            'feature_subtype' => $subtype,
            'name' => $name,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_point', (int) $user['id'], '{}', avesmapsEncodeAuditJson(avesmapsBuildAuditAfterSnapshot([
            'public_id' => $publicId,
            'feature_type' => 'location',
            'name' => $name,
            'feature_subtype' => $subtype,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ], $payload)));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateCrossingFeature(PDO $pdo, array $payload, array $user): array {
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $name = 'Kreuzung';
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $name,
        'feature_type' => 'junction',
        'feature_subtype' => 'crossing',
    ];

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'junction',
            'feature_subtype' => 'crossing',
            'name' => $name,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_crossing', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'junction',
            'feature_subtype' => 'crossing',
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPointFeatureResponse($publicId, $name, 'crossing', $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

// Direction-independent edge key -- mirrors avesmapsPowerlineEdgeKey in
// js/map-features/powerline-topology.js so the client's reorder preview and this server-side recompute
// classify segments into the same undirected edges (a segment A->B and the ordered pair B->A collapse).
function avesmapsPowerlineUndirectedEdgeKey(string $a, string $b): string {
    return $a < $b ? $a . ' ' . $b : $b . ' ' . $a;
}

// One powerline segment INSERT (+ bounds, sort order, create audit) with NO transaction and NO revision
// bump -- the caller owns those. avesmapsCreatePowerlineFeature and avesmapsReorderPowerlineLine share
// this single insert path so a segment is built identically whichever route creates it. Returns the new
// feature id.
function avesmapsInsertPowerlineFeatureRow(
    PDO $pdo,
    string $publicId,
    string $name,
    array $geometry,
    array $properties,
    int $revision,
    int $userId
): int {
    $coordinates = $geometry['coordinates'] ?? [];
    $xValues = array_map(static fn(array $coordinate): float => (float) $coordinate[0], $coordinates);
    $yValues = array_map(static fn(array $coordinate): float => (float) $coordinate[1], $coordinates);
    $sortOrder = avesmapsNextMapSortOrder($pdo);
    $statement = $pdo->prepare(
        'INSERT INTO map_features (
            public_id, feature_type, feature_subtype, name, geometry_type,
            geometry_json, properties_json, min_x, min_y, max_x, max_y,
            sort_order, revision, created_by, updated_by
        ) VALUES (
            :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
            :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
            :sort_order, :revision, :created_by, :updated_by
        )'
    );
    $statement->execute([
        'public_id' => $publicId,
        'feature_type' => 'powerline',
        'feature_subtype' => 'powerline',
        'name' => $name,
        'geometry_type' => 'LineString',
        'geometry_json' => avesmapsEncodeJson($geometry),
        'properties_json' => avesmapsEncodeJson($properties),
        'min_x' => $xValues === [] ? 0 : min($xValues),
        'min_y' => $yValues === [] ? 0 : min($yValues),
        'max_x' => $xValues === [] ? 0 : max($xValues),
        'max_y' => $yValues === [] ? 0 : max($yValues),
        'sort_order' => $sortOrder,
        'revision' => $revision,
        'created_by' => $userId,
        'updated_by' => $userId,
    ]);

    $featureId = (int) $pdo->lastInsertId();
    avesmapsWriteMapAuditLog($pdo, $featureId, 'create_powerline', $userId, '{}', avesmapsEncodeAuditJson([
        'public_id' => $publicId,
        'feature_type' => 'powerline',
        'feature_subtype' => 'powerline',
        'name' => $name,
        'geometry_json' => $geometry,
        'properties_json' => $properties,
        'revision' => $revision,
    ]));

    return $featureId;
}

function avesmapsCreatePowerlineFeature(PDO $pdo, array $payload, array $user): array {
    $fromPublicId = avesmapsReadMapFeaturePublicId($payload['from_public_id'] ?? '');
    $toPublicId = avesmapsReadMapFeaturePublicId($payload['to_public_id'] ?? '');
    if ($fromPublicId === $toPublicId) {
        throw new InvalidArgumentException('Start und Ziel muessen verschieden sein.');
    }

    $pdo->beginTransaction();
    try {
        $fromFeature = avesmapsFetchEditablePointFeature($pdo, $fromPublicId);
        $toFeature = avesmapsFetchEditablePointFeature($pdo, $toPublicId);
        $fromProperties = avesmapsDecodeJsonColumnForEdit($fromFeature['properties_json'] ?? null);
        $toProperties = avesmapsDecodeJsonColumnForEdit($toFeature['properties_json'] ?? null);
        $fromIsEligibleEndpoint = !empty($fromProperties['is_nodix']) || (string) ($fromFeature['feature_subtype'] ?? '') === 'crossing';
        $toIsEligibleEndpoint = !empty($toProperties['is_nodix']) || (string) ($toFeature['feature_subtype'] ?? '') === 'crossing';
        if (!$fromIsEligibleEndpoint || !$toIsEligibleEndpoint) {
            throw new InvalidArgumentException('Kraftlinien koennen nur Nodix-Orte verbinden.');
        }

        $fromGeometry = avesmapsDecodeJsonColumnForEdit($fromFeature['geometry_json'] ?? null);
        $toGeometry = avesmapsDecodeJsonColumnForEdit($toFeature['geometry_json'] ?? null);
        [$fromLng, $fromLat] = avesmapsReadPointCoordinatesFromGeometry($fromGeometry);
        [$toLng, $toLat] = avesmapsReadPointCoordinatesFromGeometry($toGeometry);
        $publicId = avesmapsUuidV4();
        // A caller (the Kraftlinien editor's "add node") may pass an explicit name so the new segment
        // joins an existing line; otherwise fall back to the auto "A - B" name. When it joins a line,
        // inherit that line's scalar fields so the new segment is consistent at once -- the infobox
        // reads them per-segment. Sources live on the line's anchor segment and are untouched here.
        $providedName = trim((string) ($payload['name'] ?? ''));
        $name = $providedName !== ''
            ? avesmapsReadFeatureName($providedName, 'Der Name der Kraftlinie')
            : trim((string) ($fromFeature['name'] ?? 'Nodix') . ' - ' . (string) ($toFeature['name'] ?? 'Nodix'));
        // Was von der Linie mitkommt, steht in avesmapsPowerlineInheritedLineFields und NUR dort --
        // dieselbe Liste, die auch das Umsortieren benutzt.
        $inherited = avesmapsPowerlineInheritedLineFields(null);
        if ($providedName !== '') {
            $peek = $pdo->prepare(
                "SELECT properties_json FROM map_features
                 WHERE feature_type = 'powerline' AND is_active = 1 AND name = :name LIMIT 1"
            );
            $peek->execute(['name' => $name]);
            $peekRow = $peek->fetch(PDO::FETCH_ASSOC);
            if (is_array($peekRow)) {
                $inherited = avesmapsPowerlineInheritedLineFields(
                    avesmapsDecodeJsonColumnForEdit($peekRow['properties_json'] ?? null)
                );
            }
        }
        $geometry = [
            'type' => 'LineString',
            'coordinates' => [[$fromLng, $fromLat], [$toLng, $toLat]],
        ];
        $properties = array_merge([
            'name' => $name,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
        ], $inherited, [
            'from_public_id' => $fromPublicId,
            'to_public_id' => $toPublicId,
        ]);
        $revision = avesmapsNextMapRevision($pdo);
        avesmapsInsertPowerlineFeatureRow($pdo, $publicId, $name, $geometry, $properties, $revision, (int) $user['id']);
        $pdo->commit();

        return avesmapsBuildPowerlineFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

// 💣 Der Widerspruch "Zuweisung UND kein Wiki-Artikel" steht seit dem 16.08.2026 in einer EIGENEN
// Datei -- api/_internal/map/wiki-claim.php, oben mit require_once eingebunden. Der Grund steht
// dort: die Landschaft braucht denselben Riegel, liegt aber hinter dem oeffentlichen Leseweg der
// Karte, und diese 3.471 Zeilen gehoeren dort nicht hin. Die Regel ist unveraendert.
function avesmapsAssertPowerlineWikiClaimNotContradictory(string $wikiUrl, bool $noArticle): void {
    avesmapsAssertWikiClaimNotContradictory(
        $wikiUrl,
        $noArticle,
        'Eine Kraftlinie',
        'Bitte den Link leeren oder das Häkchen entfernen.'
    );
}

/**
 * REIN: den Merker „kein Wiki-Artikel" auf EIN Kraftlinien-Segment schreiben. Wirft, wenn Merker und
 * Adresse einander widersprechen.
 *
 * 💣 ABWESENHEIT HEISST „NICHT GEAENDERT", LEER HEISST „LOESCHEN" -- dieselbe Regel wie bei
 * avesmapsApplyPointWikiFields, avesmapsApplyPathWikiNoArticle und
 * avesmapsEcosystemApplyRegionNoArticle. 🪤 Sie galt hier bis zum 16.08.2026 NICHT: der Linien-
 * Schreibweg las `$payload['wiki_no_article'] ?? false`, und daneben stand die Begruendung dafuer --
 * „die Kraftlinie hat EINEN Schreiber, und der schickt den Merker seit jeher". Der Satz war wahr und
 * ist es nicht mehr: mit dem Wegfall des Haekchens „Kein Wiki-Artikel vorhanden" (Owner-Entscheid
 * 16.08.2026) schickt der Editor den Schluessel nur noch, wenn eine ZUWEISUNG den Merker beantwortet
 * hat. Unveraendert weitergelesen haette `?? false` bei JEDEM Speichern einer Linie die Entscheidung
 * des Konfliktzentrums geloescht -- lautlos, und hinterher nicht von „nie entschieden" zu
 * unterscheiden (AGENTS.md §10).
 *
 * ⚠️ Der Merker steht nur drin, wenn er WAHR ist -- als `false` wird er nirgends abgelegt.
 *
 * 🔴 EIGENE FUNKTION, weil der Linien-Schreibweg sie je Segment braucht und sie sonst nur INNERHALB
 * einer Transaktion messbar waere. Dieselbe Form wie die drei Vorbilder oben, aus demselben Grund.
 *
 * @param array  $properties der bereits dekodierte Bestand DIESES Segments
 * @param array  $payload    die Anfrage
 * @param string $wikiUrl    die Adresse, wie sie gleich gespeichert wird ('' = keine)
 */
function avesmapsApplyPowerlineWikiNoArticle(array $properties, array $payload, string $wikiUrl): array {
    $noArticle = array_key_exists('wiki_no_article', $payload)
        ? avesmapsReadBoolean($payload['wiki_no_article'])
        : !empty($properties['wiki_no_article']);
    avesmapsAssertPowerlineWikiClaimNotContradictory($wikiUrl, $noArticle);
    if ($noArticle) {
        $properties['wiki_no_article'] = true;
    } else {
        unset($properties['wiki_no_article']);
    }

    return $properties;
}

/**
 * REIN: Was erbt ein NEU entstehendes Segment von seiner Linie?
 *
 * 💣 EINE Liste fuer beide Erzeuger -- "Nodix anhaengen" (avesmapsCreatePowerlineFeature) und
 * "Umsortieren" (avesmapsReorderPowerlineLine). Sie standen zweimal nebeneinander abgeschrieben,
 * und in BEIDEN fehlte `wiki_no_article`: ein frisch entstandenes Segment ohne den Merker bringt
 * den Fall im Konfliktzentrum mit segments = 1 zurueck, obwohl niemand etwas entschieden hat --
 * genau der Effekt, den die Verbund-Reichweite der Reparatur-Verben gerade beseitigt hat. Zwei
 * Abschriften derselben Liste sind die Bauform, in der so ein Feld verlorengeht.
 *
 * ⚠️ `wiki_no_article` steht nur drin, wenn es WAHR ist. Als `false` wird der Merker nirgends
 * abgelegt (der Linien-Schreibweg loescht den Schluessel), und ein `false` liesse sich spaeter
 * nicht von "nie entschieden" unterscheiden.
 */
/**
 * Die Kurvenform einer Kraftlinie: Prozent der Sehne, -45..45, 0 = gerade.
 *
 * 🔴 GEKLEMMT, NIE ABGELEHNT. Ein unlesbarer Wert wird 0.0 -- also der Zustand von heute. Eine
 * Ausnahme waere fuer den Editor von „Server kaputt" nicht zu unterscheiden, und die sichere
 * Richtung ist hier die gerade Linie.
 * Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md Abschnitt 4.
 */
function avesmapsReadPowerlineCurve($wert): float {
    // ⚠️ `is_numeric` allein genuegt und traegt jeden Fall: es weist bool, array, null, Objekt und
    // "quatsch" gleichermassen ab, ohne zu werfen. Hier stand zuerst eine Typpruefung DAVOR, mit der
    // Begruendung, `(float) true` waere sonst 1.0 -- das war falsch (is_numeric(true) ist bereits
    // false), und eine Mutationsprobe am 29.08.2026 zeigte sie als toten Code: ihr Entfernen liess
    // keinen Test rot werden. Toter Code mit falscher Begruendung ist schlimmer als kein Code.
    if (!is_numeric($wert)) {
        return 0.0;
    }
    $zahl = (float) $wert;
    // ⚠️ NAN ueberlebt is_numeric (es IST ein float) und jede Vergleichsoperation -- min/max wuerden
    // es unveraendert durchreichen. INF dagegen klemmt sauber.
    if (is_nan($zahl)) {
        return 0.0;
    }

    return max(-45.0, min(45.0, $zahl));
}

/**
 * Welche Kurve auf DIESES Segment kommt -- die reine Regel hinter dem Linien-Schreibweg.
 * Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md Abschnitt 13.
 *
 * 💣 ABWESENHEIT HEISST „NICHT GEAENDERT", und das ist die Umkehrung des Verhaltens vom Vormittag.
 * Bis dahin las der Schreibweg `$payload['curve'] ?? 0` und schrieb ihn bei JEDEM Speichern auf alle
 * Segmente. Seit die Kurve je Segment einstellbar ist, schickt der Editor den LINIEN-Wert nur noch,
 * wenn jemand den Linien-Schieber angefasst hat -- mit `?? 0` machte ein Speichern damit jede
 * gewollte Ausnahme lautlos platt, auch eine reine Beschreibungsaenderung. Zeichen fuer Zeichen die
 * wiki_no_article-Falle aus dieser Datei.
 * ⚠️ Die zwei Haelften gehoeren zusammen: wer hier `?? 0` wiederherstellt, braucht im selben Zug
 * einen Editor, der den Wert immer sendet.
 *
 * 🔴 Rangfolge: `curves[public_id]` (ein einzeln angefasstes Segment) schlaegt `curve` (alle) --
 * der speziellere Griff ist der juengere Wille. Sagt keiner etwas, bleibt der gespeicherte Wert.
 *
 * ⚠️ Steht sie HIER und nicht im Schreibweg, weil sie dort in einer Transaktion saesse und damit
 * nicht mehr messbar waere -- dasselbe Verhaeltnis wie bei avesmapsApplyPowerlineWikiNoArticle.
 */
function avesmapsApplyPowerlineCurve(array $properties, array $payload, string $publicId): array {
    $karte = $payload['curves'] ?? null;
    // ⚠️ Eine unbrauchbare Kartenangabe wird IGNORIERT, nicht abgelehnt: ein veralteter
    // Editor-Stand darf keine ganze Speicherung scheitern lassen.
    if (is_array($karte) && $publicId !== '' && array_key_exists($publicId, $karte)) {
        $properties['curve'] = avesmapsReadPowerlineCurve($karte[$publicId]);

        return $properties;
    }
    if (array_key_exists('curve', $payload)) {
        $properties['curve'] = avesmapsReadPowerlineCurve($payload['curve']);
    }

    return $properties;
}

function avesmapsPowerlineInheritedLineFields(?array $lineProperties): array {
    $source = is_array($lineProperties) ? $lineProperties : [];
    $inherited = [
        'show_label' => (bool) ($source['show_label'] ?? false),
        'description' => (string) ($source['description'] ?? ''),
        'wiki_url' => (string) ($source['wiki_url'] ?? ''),
        // Ohne diese Zeile laege ein spaeter angehaengtes Segment kerzengerade zwischen zwei
        // gebogenen -- die Kurve ist eine Eigenschaft der LINIE, nicht des einzelnen Stuecks.
        'curve' => avesmapsReadPowerlineCurve($source['curve'] ?? 0),
    ];
    if (!empty($source['wiki_no_article'])) {
        $inherited['wiki_no_article'] = true;
    }

    return $inherited;
}

function avesmapsUpdatePowerlineFeatureDetails(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadFeatureName($payload['name'] ?? '', 'Der Name der Kraftlinie');
    $showLabel = avesmapsReadBoolean($payload['show_label'] ?? false);
    $description = trim((string) ($payload['description'] ?? ''));
    // Explicit or empty -- never guessed. avesmapsEnrichMapFeatureWikiUrl skips powerlines for
    // exactly this reason (see api/app/map-features.php).
    $wikiUrl = trim((string) ($payload['wiki_url'] ?? ''));

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        // Derselbe Riegel wie im Linien-Schreibweg. Dieser zweite Weg kannte ihn nicht, der
        // verbotene Zustand war ueber ihn also herstellbar. Geprueft wird gegen den Merker, wie er
        // in den properties DIESES Segments steht: diese Aktion schreibt ihn nicht, sie kann ihn
        // nur vorfinden -- deshalb steht die Pruefung nach dem Lesen und nicht vor der Transaktion.
        avesmapsAssertPowerlineWikiClaimNotContradictory($wikiUrl, !empty($properties['wiki_no_article']));
        $properties['name'] = $name;
        $properties['feature_type'] = 'powerline';
        $properties['feature_subtype'] = 'powerline';
        $properties['show_label'] = $showLabel;
        $properties['description'] = $description;
        $properties['wiki_url'] = $wikiUrl;
        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_type = :feature_type,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $name,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_powerline_details', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'powerline',
            'feature_subtype' => 'powerline',
            'name' => $name,
            'show_label' => $showLabel,
            'description' => $description,
            'wiki_url' => $wikiUrl,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildPowerlineFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

// Line-level write: a Kraftlinie is many segments sharing one name, so the editor writes the line's
// scalar fields (name, show_label, description, wiki_url) onto ALL of them at once. Renaming to an
// existing name makes both groups share a name -- they merge, and every segment of the resulting line
// gets the same fields (the OR in the SELECT covers the merge target too). Sources are NOT touched
// here: they live on the line's anchor segment (see the editor + powerlineInfoboxMarkup).
function avesmapsUpdatePowerlineLine(PDO $pdo, array $payload, array $user): array {
    $currentName = trim((string) ($payload['current_name'] ?? ''));
    if ($currentName === '') {
        throw new InvalidArgumentException('Der aktuelle Name der Kraftlinie fehlt.');
    }
    $newName = avesmapsReadFeatureName($payload['new_name'] ?? '', 'Der Name der Kraftlinie');
    $showLabel = avesmapsReadBoolean($payload['show_label'] ?? false);
    $description = trim((string) ($payload['description'] ?? ''));
    $wikiUrl = trim((string) ($payload['wiki_url'] ?? ''));
    // 🔴 Die Kurve wird NICHT mehr hier gelesen. Sie ist seit dem 29.08.2026 je Segment
    // einstellbar, und welcher Wert auf welches Segment kommt, entscheidet die reine Regel
    // avesmapsApplyPowerlineCurve -- inklusive „nichts gesagt heisst nichts geaendert".
    // 🔴 ABWESENHEIT HEISST „NICHT GEAENDERT" -- seit dem 16.08.2026, und die Zeile ist der Grund,
    // warum das Haekchen „Kein Wiki-Artikel vorhanden" im Kraftlinien-Editor ueberhaupt fallen DURFTE.
    // 🪤 Hier stand `?? false`, und daneben stand die Begruendung dafuer: „die Kraftlinie hat EINEN
    // Schreiber, und der schickt den Merker seit jeher" (avesmapsApplyPointWikiFields, oben). Der Satz
    // war wahr und traegt nicht mehr: mit dem Wegfall des Haekchens schickt saveLine den Schluessel nur
    // noch, wenn eine ZUWEISUNG den Merker beantwortet hat. Unveraendert weitergelesen haette `?? false`
    // damit bei JEDEM Speichern einer Linie die Entscheidung des Konfliktzentrums geloescht -- lautlos,
    // und von „nie entschieden" hinterher nicht zu unterscheiden (AGENTS.md §10).
    // ⚠️ Die zwei Haelften gehoeren zusammen und duerfen nicht einzeln zurueckgedreht werden: wer hier
    // `?? false` wiederherstellt, braucht im selben Zug ein Bedienelement, das den Merker setzen kann.
    $noArticleGesendet = array_key_exists('wiki_no_article', $payload);
    $noArticle = $noArticleGesendet ? avesmapsReadBoolean($payload['wiki_no_article']) : false;
    // 💣 Abgelehnt, nicht aufgeloest -- Begruendung und Wortlaut stehen an der gemeinsamen Stelle
    // (avesmapsAssertPowerlineWikiClaimNotContradictory), damit der zweite Schreibweg nicht wieder
    // ohne Riegel oder mit einer anderen Begruendung dastehen kann.
    // ⚠️ Vor der Transaktion nur, was der Rumpf AUSDRUECKLICH behauptet. Der gespeicherte Merker steht
    // je Segment in dessen Eigenschaften und wird deshalb unten, nach dem Lesen, noch einmal geprueft.
    if ($noArticleGesendet) {
        avesmapsAssertPowerlineWikiClaimNotContradictory($wikiUrl, $noArticle);
    }

    $pdo->beginTransaction();
    try {
        // Every active segment of the current name OR the target name (so a merge unifies both).
        $select = $pdo->prepare(
            "SELECT id, public_id, properties_json, revision
             FROM map_features
             WHERE feature_type = 'powerline' AND is_active = 1 AND (name = :current OR name = :new)
             FOR UPDATE"
        );
        $select->execute(['current' => $currentName, 'new' => $newName]);
        $rows = $select->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            throw new InvalidArgumentException('Zu diesem Namen gibt es keine Kraftlinien-Segmente mehr. Bitte neu laden.');
        }

        $revision = avesmapsNextMapRevision($pdo);
        $update = $pdo->prepare(
            'UPDATE map_features
             SET name = :name, properties_json = :properties_json, revision = :revision, updated_by = :updated_by
             WHERE id = :id'
        );
        foreach ($rows as $row) {
            $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
            $properties['name'] = $newName;
            $properties['feature_type'] = 'powerline';
            $properties['feature_subtype'] = 'powerline';
            $properties['show_label'] = $showLabel;
            $properties['description'] = $description;
            $properties['wiki_url'] = $wikiUrl;
            $properties = avesmapsApplyPowerlineCurve($properties, $payload, (string) $row['public_id']);
            // Ohne ausdruecklichen Schluessel gilt, was auf DIESEM Segment steht -- die reine Regel
            // steht in avesmapsApplyPowerlineWikiNoArticle, weil sie hier in einer Transaktion
            // saesse und dort messbar ist.
            $properties = avesmapsApplyPowerlineWikiNoArticle($properties, $payload, $wikiUrl);
            $merker = !empty($properties['wiki_no_article']);
            $update->execute([
                'id' => (int) $row['id'],
                'name' => $newName,
                'properties_json' => avesmapsEncodeJson($properties),
                'revision' => $revision,
                'updated_by' => (int) $user['id'],
            ]);
            avesmapsWriteMapAuditLog(
                $pdo,
                (int) $row['id'],
                'update_powerline_line',
                (int) $user['id'],
                avesmapsEncodeAuditJson($row),
                avesmapsEncodeAuditJson([
                    'public_id' => (string) $row['public_id'],
                    'name' => $newName,
                    'show_label' => $showLabel,
                    'description' => $description,
                    'wiki_url' => $wikiUrl,
                    'curve' => $properties['curve'] ?? 0.0,
                    'wiki_no_article' => $merker,
                    'properties_json' => $properties,
                    'revision' => $revision,
                ])
            );
        }
        $pdo->commit();

        return [
            'name' => $newName,
            'previous_name' => $currentName,
            'segment_count' => count($rows),
            'merged' => $newName !== $currentName,
            'revision' => $revision,
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

// Reorder a STRAND: given the new node order, recompute the edge set, diff it against the line's current
// segments and apply the difference ATOMICALLY -- new consecutive edges become straight powerline
// segments (inheriting the line's scalar fields), edges no longer on the path are soft-deleted. One
// transaction, so a partial rewire can never leave the line mangled. Guards: the node SET must stay the
// same (adding/removing nodes is a separate action), and the line must ALREADY be a simple path --
// linearising a branched line or a ring would silently drop structure, so we refuse it. Sources ride the
// anchor (smallest public_id of the name group); after the rewire they move onto the new anchor if it
// changed (a deleted anchor, or a freshly created segment whose uuid sorts smaller). See design §8/§10.
function avesmapsReorderPowerlineLine(PDO $pdo, array $payload, array $user): array {
    $currentName = trim((string) ($payload['current_name'] ?? ''));
    if ($currentName === '') {
        throw new InvalidArgumentException('Der Name der Kraftlinie fehlt.');
    }
    $orderedRaw = $payload['ordered_public_ids'] ?? null;
    if (!is_array($orderedRaw) || count($orderedRaw) < 2) {
        throw new InvalidArgumentException('Zum Umsortieren werden mindestens zwei Nodices in Reihenfolge gebraucht.');
    }
    $ordered = [];
    foreach ($orderedRaw as $value) {
        $ordered[] = avesmapsReadMapFeaturePublicId($value);
    }
    if (count(array_unique($ordered)) !== count($ordered)) {
        throw new InvalidArgumentException('Ein Nodix darf in der Reihenfolge nur einmal vorkommen.');
    }

    $pdo->beginTransaction();
    try {
        $select = $pdo->prepare(
            "SELECT id, public_id, properties_json
             FROM map_features
             WHERE feature_type = 'powerline' AND is_active = 1 AND name = :name
             FOR UPDATE"
        );
        $select->execute(['name' => $currentName]);
        $rows = $select->fetchAll(PDO::FETCH_ASSOC);
        if ($rows === []) {
            throw new InvalidArgumentException('Zu diesem Namen gibt es keine Kraftlinien-Segmente mehr. Bitte neu laden.');
        }

        // Current edges + node degrees from the segment endpoints, plus the line's scalar fields to
        // inherit onto any newly created segment (all segments of a line carry the same ones).
        $degree = [];
        $currentEdges = [];
        // Dieselbe Erbliste wie beim Anhaengen eines Nodix -- eine Quelle, keine zweite Abschrift.
        $inherited = avesmapsPowerlineInheritedLineFields(null);
        $haveInherit = false;
        foreach ($rows as $row) {
            $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
            $from = (string) ($properties['from_public_id'] ?? '');
            $to = (string) ($properties['to_public_id'] ?? '');
            if ($from === '' || $to === '') {
                throw new InvalidArgumentException('Ein Segment ohne Endpunkte laesst sich nicht umsortieren. Bitte neu laden.');
            }
            $degree[$from] = ($degree[$from] ?? 0) + 1;
            $degree[$to] = ($degree[$to] ?? 0) + 1;
            $currentEdges[] = [
                'id' => (int) $row['id'],
                'public_id' => (string) $row['public_id'],
                'from' => $from,
                'to' => $to,
                'key' => avesmapsPowerlineUndirectedEdgeKey($from, $to),
            ];
            if (!$haveInherit) {
                $inherited = avesmapsPowerlineInheritedLineFields($properties);
                $haveInherit = true;
            }
        }
        $currentNodes = array_keys($degree);

        // The node set may not change here (add/remove is a separate action).
        if (
            count($ordered) !== count($currentNodes)
            || array_diff($ordered, $currentNodes) !== []
            || array_diff($currentNodes, $ordered) !== []
        ) {
            throw new InvalidArgumentException('Beim Umsortieren muss die Nodix-Menge gleich bleiben (zum Hinzufuegen/Entfernen die eigenen Aktionen nutzen).');
        }
        // Refuse anything that is not already a simple path (strand): exactly two degree-1 ends, every
        // other node degree 2, and n-1 edges. That uniquely characterises a single path -- a ring has no
        // ends, a branch more than two, and either would be silently linearised otherwise.
        $ends = 0;
        foreach ($degree as $nodeDegree) {
            if ($nodeDegree === 1) {
                $ends++;
                continue;
            }
            if ($nodeDegree !== 2) {
                throw new InvalidArgumentException('Umsortieren gibt es nur fuer Straenge (jeder Nodix mit hoechstens zwei Nachbarn).');
            }
        }
        if ($ends !== 2 || count($currentEdges) !== count($currentNodes) - 1) {
            throw new InvalidArgumentException('Umsortieren gibt es nur fuer Straenge mit genau zwei Enden.');
        }

        // Diff: wanted consecutive edges vs. the current segments (keep one segment per wanted edge).
        $wanted = [];
        for ($i = 0; $i < count($ordered) - 1; $i++) {
            $wanted[avesmapsPowerlineUndirectedEdgeKey($ordered[$i], $ordered[$i + 1])] = [
                'from' => $ordered[$i],
                'to' => $ordered[$i + 1],
            ];
        }
        $satisfied = [];
        $toDelete = [];
        foreach ($currentEdges as $edge) {
            if (isset($wanted[$edge['key']]) && !isset($satisfied[$edge['key']])) {
                $satisfied[$edge['key']] = true;
            } else {
                $toDelete[] = $edge;
            }
        }
        $toCreate = [];
        foreach ($wanted as $key => $edge) {
            if (!isset($satisfied[$key])) {
                $toCreate[] = $edge;
            }
        }

        // Anchor before the rewire (smallest public_id, SORT_STRING so it matches the client's .sort()
        // and MySQL MIN over these uuid strings).
        $publicIds = array_map(static fn(array $row): string => (string) $row['public_id'], $rows);
        sort($publicIds, SORT_STRING);
        $oldAnchor = $publicIds[0];

        $revision = avesmapsNextMapRevision($pdo);

        // Soft-delete the dropped edges.
        $delete = $pdo->prepare(
            'UPDATE map_features SET is_active = 0, revision = :revision, updated_by = :updated_by WHERE id = :id'
        );
        foreach ($toDelete as $edge) {
            $delete->execute([
                'id' => $edge['id'],
                'revision' => $revision,
                'updated_by' => (int) $user['id'],
            ]);
            avesmapsWriteMapAuditLog(
                $pdo,
                $edge['id'],
                'delete_feature',
                (int) $user['id'],
                avesmapsEncodeAuditJson(['public_id' => $edge['public_id']]),
                avesmapsEncodeAuditJson([
                    'public_id' => $edge['public_id'],
                    'is_active' => 0,
                    'revision' => $revision,
                    'reason' => 'reorder_powerline_line',
                ])
            );
        }

        // Create the new edges as straight segments between the two nodes (each node fetched once).
        $pointCache = [];
        foreach ($toCreate as $edge) {
            foreach (['from', 'to'] as $sideKey) {
                $nodeId = $edge[$sideKey];
                if (!isset($pointCache[$nodeId])) {
                    $pointCache[$nodeId] = avesmapsFetchEditablePointFeature($pdo, $nodeId);
                }
            }
            [$fromLng, $fromLat] = avesmapsReadPointCoordinatesFromGeometry(
                avesmapsDecodeJsonColumnForEdit($pointCache[$edge['from']]['geometry_json'] ?? null)
            );
            [$toLng, $toLat] = avesmapsReadPointCoordinatesFromGeometry(
                avesmapsDecodeJsonColumnForEdit($pointCache[$edge['to']]['geometry_json'] ?? null)
            );
            $publicId = avesmapsUuidV4();
            $geometry = [
                'type' => 'LineString',
                'coordinates' => [[$fromLng, $fromLat], [$toLng, $toLat]],
            ];
            $properties = array_merge([
                'name' => $currentName,
                'feature_type' => 'powerline',
                'feature_subtype' => 'powerline',
            ], $inherited, [
                'from_public_id' => $edge['from'],
                'to_public_id' => $edge['to'],
            ]);
            avesmapsInsertPowerlineFeatureRow($pdo, $publicId, $currentName, $geometry, $properties, $revision, (int) $user['id']);
        }

        // Anchor preservation: if the anchor moved (its segment was deleted, or a new segment sorts
        // smaller), move the line's feature_sources onto the new anchor so the infobox keeps showing them.
        $anchorStatement = $pdo->prepare(
            "SELECT MIN(public_id) FROM map_features WHERE feature_type = 'powerline' AND is_active = 1 AND name = :name"
        );
        $anchorStatement->execute(['name' => $currentName]);
        $newAnchor = $anchorStatement->fetchColumn();
        if (is_string($newAnchor) && $newAnchor !== '' && $newAnchor !== $oldAnchor) {
            $move = $pdo->prepare(
                "UPDATE feature_sources SET entity_public_id = :new WHERE entity_type = 'powerline' AND entity_public_id = :old"
            );
            $move->execute(['new' => $newAnchor, 'old' => $oldAnchor]);
        }

        $pdo->commit();

        return [
            'name' => $currentName,
            'created' => count($toCreate),
            'removed' => count($toDelete),
            'anchor' => is_string($newAnchor) && $newAnchor !== '' ? $newAnchor : $oldAnchor,
            'revision' => $revision,
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreatePathFeature(PDO $pdo, array $payload, array $user): array {
    $subtype = avesmapsReadPathSubtype($payload['feature_subtype'] ?? 'Weg');
    $name = avesmapsReadFeatureName($payload['name'] ?? $subtype, 'Der Wegname');
    $showLabel = avesmapsReadBoolean($payload['show_label'] ?? false);
    // 🔴 Bach-Haekchen und Verkehrsmittel kommen aus DERSELBEN Regel (avesmapsPathTransportRegel).
    $istBach = avesmapsPathIstBach($subtype, $payload['is_bach'] ?? false);
    $regel = avesmapsPathTransportRegel($subtype, $istBach, $payload['allowed_transports'] ?? null);
    $transportDomain = $regel['domain'];
    $allowedTransports = $regel['allowed'];
    $coordinates = avesmapsReadLineStringCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates);

    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'LineString',
        'coordinates' => $coordinates,
    ];
    $properties = [
        'name' => $name,
        'display_name' => $name,
        'feature_type' => 'path',
        'feature_subtype' => $subtype,
        'show_label' => $showLabel,
        'transport_domain' => $transportDomain,
        'allowed_transports' => $allowedTransports,
    ];
    // 🔴 NUR WENN GESETZT. `false` wird NICHT geschrieben -- die Abwesenheit ist die Aussage
    // „kein Bach", genau wie bei place_kind am Ort. Ein `is_bach: false` an 1107 Flusswegen waere
    // eine Behauptung in jeder Zeile, die niemand getroffen hat, und sie reiste in der
    // Kartennutzlast mit.
    if ($istBach) {
        $properties['is_bach'] = true;
    }

    // 🔴 DIE STROEMUNGSRICHTUNG, WENN DER ANLEGER EINE MITBRINGT (02.09.2026, Garetien-Import).
    // Bis dahin entstand jeder Weg richtungslos, und die Richtung kam erst durch einen zweiten
    // Aufruf (`set_flow` im Wege-Editor) oder den Wiki-Kurs-Sync. Der Importer weiss sie aber schon
    // beim Anlegen -- der Editor hat sie im Kasten „Eingefuegt wird" bestaetigt oder gedreht.
    //
    // ⚠️ DURCH DEN HAUSNORMALISIERER, nicht roh uebernommen: avesmapsPathFlowNormalize
    // (api/_internal/wiki/path-flow.php) ist die eine Stelle, die entscheidet, was ein gueltiges
    // `flow` ist. Ein hier von Hand gebautes Array waere die zweite Fassung derselben Frage.
    // ⚠️ Und NUR wenn wirklich etwas dasteht -- ein `flow: null` an jedem Weg waere dieselbe
    // Behauptung in jeder Zeile, die `is_bach` eine Zeile darueber ausdruecklich vermeidet.
    // 🪤 HIER STAND EIN `function_exists`-RIEGEL, UND ER WAR EIN STILLER AUSFALL. Ohne den
    // `require_once` am Dateikopf lieferte er kein `flow` und keine Meldung -- eine fehlende Datei
    // sah damit zeichengleich aus wie „es wurde keine Richtung gewuenscht". Gefunden hat das die
    // erste Zusicherung, die die Richtung am angelegten Objekt gemessen hat.
    if (isset($payload['flow'])) {
        $flowNormalisiert = avesmapsPathFlowNormalize($payload['flow']);
        if ($flowNormalisiert !== null) {
            $properties['flow'] = $flowNormalisiert;
        }
    }

    // Die Feldherkunft eines FRISCH GEZEICHNETEN Weges.
    // 🔴 DER ANLEGEFALL IST EIN EIGENER SCHREIBWEG, und er ist beim Bauen zuerst uebersehen worden
    // -- gefunden hat ihn nicht der Autor, sondern die Zusicherung in
    // __tests__/weg-feld-herkunft-test.php, die die Schreibwege ZAEHLT statt sie aufzuzaehlen.
    // Dieselbe Reihenfolge wie beim Ort, wo derselbe Test denselben Fall fand.
    // ⚠️ „Vorher" ist hier LEER -- ein neuer Weg hat keinen Vorzustand. Der gesetzte Wegtyp ist
    // damit eine Aenderung und bekommt eine Herkunft: `manual`, solange die Anfrage nichts anderes
    // sagt. Das ist richtig -- ein frisch gezeichneter Weg traegt keinen Wiki-Artikel, und wer ihn
    // spaeter zuweist, laesst den Wegtyp ueber die Sync-Vorschau nachziehen.
    $herkunftNeu = avesmapsFieldOriginsStempeln(
        [],
        [],
        ['feature_subtype' => $subtype],
        avesmapsFieldOriginsAusWikiLesen($payload, AVESMAPS_PATH_WIKI_ORIGIN_FIELDS)
    );
    if ($herkunftNeu !== []) {
        $properties['field_origins'] = $herkunftNeu;
    }

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'path',
            'feature_subtype' => $subtype,
            'name' => $name,
            'geometry_type' => 'LineString',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);

        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_path', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'path',
            'name' => $name,
            'feature_subtype' => $subtype,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

/**
 * Traegt die Zeitfenster eines Weges auf ALLE Segmente seines Wiki-Weges.
 *
 * 💣 EIN PASS IST BEI UNS EINE KETTE, KEINE STRECKE. Gemessen am Bestand (2026-08-03): Schattenpass
 * 12 Segmente, Kabashpforte 11, Raschtulsweg 9, Roterzpass 4 -- und die Segmente eines Passes tragen
 * verschiedene Wegarten (Zufahrt als Strasse, das Passstueck als Gebirgspass). Wer das Fenster nur
 * an das eine Segment schreibt, das er gerade offen hat, laesst elf Loecher, durch die der Router
 * faehrt. Der Wiki-Weg ist dabei der belastbare Schluessel: alle Passsegmente tragen einen, aber
 * 113 der 187 haben nur einen Auto-Namen (`Gebirgspass-42`).
 *
 * ⭐ Das Fenster wird je Segment gegen dessen EIGENE `allowed_transports` gefiltert. Ein
 * Strassenstueck laesst die Kutsche zu, das Passstueck daneben nicht -- ein stumpf kopiertes
 * Kutschenfenster waere dort tote Angabe, die an dem Tag aufwacht, an dem jemand den Haken setzt.
 *
 * @return int Zahl der zusaetzlich geschriebenen Segmente
 */
function avesmapsApplyTransportSeasonsToWikiSiblings(
    PDO $pdo,
    array $ownProperties,
    array $seasons,
    int $ownFeatureId,
    int $revision,
    int $userId
): int {
    $wikiKey = '';
    if (is_array($ownProperties['wiki_path'] ?? null)) {
        $wikiKey = trim((string) ($ownProperties['wiki_path']['wiki_key'] ?? ''));
    }
    if ($wikiKey === '') {
        return 0;
    }

    $statement = $pdo->prepare(
        "SELECT id, public_id, name, feature_subtype, properties_json
           FROM map_features
          WHERE feature_type = 'path' AND is_active = 1 AND id <> :own
            AND JSON_UNQUOTE(JSON_EXTRACT(properties_json, '$.wiki_path.wiki_key')) = :key"
    );
    $statement->execute(['own' => $ownFeatureId, 'key' => $wikiKey]);
    $siblings = $statement->fetchAll(PDO::FETCH_ASSOC);
    if ($siblings === []) {
        return 0;
    }

    $update = $pdo->prepare(
        'UPDATE map_features SET properties_json = :properties_json, revision = :revision,
                updated_by = :updated_by
          WHERE id = :id'
    );

    $written = 0;
    foreach ($siblings as $sibling) {
        $properties = avesmapsDecodeJsonColumnForEdit($sibling['properties_json'] ?? null);
        $subtype = (string) $sibling['feature_subtype'];
        // ⚠️ Auch der RUECKFALL geht durch die Regel: ein Bach ohne gespeicherte Liste bekaeme
        // sonst Fluss-Verkehrsmittel untergeschoben, und ein Jahreszeitenfenster fuer einen
        // Flusssegler, der dort nie faehrt, waere tote Angabe.
        $allowed = is_array($properties['allowed_transports'] ?? null)
            ? array_values($properties['allowed_transports'])
            : avesmapsPathTransportRegel(
                $subtype,
                avesmapsPathIstBach($subtype, $properties['is_bach'] ?? false),
                null
            )['allowed'];
        $forSibling = avesmapsReadTransportSeasons($seasons, $allowed);

        $before = $properties['transport_seasons'] ?? null;
        if ($forSibling === []) {
            unset($properties['transport_seasons']);
        } else {
            $properties['transport_seasons'] = $forSibling;
        }
        // Nichts anfassen, was sich nicht aendert -- sonst hebt ein Speichern ohne Aenderung die
        // Revision jedes Segments und schickt jedem warmen Client die halbe Karte neu.
        if (($before ?? []) == ($forSibling ?: [])) {
            continue;
        }

        $update->execute([
            'id' => (int) $sibling['id'],
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => $userId,
        ]);
        // 💣 Je Segment ein eigener Eintrag, nicht einer fuer den ganzen Pass: das Rueckgaengig
        // arbeitet auf Feature-Ebene, und ein Sammelvermerk liesse elf der zwoelf Aenderungen
        // ausserhalb der Historie stehen.
        avesmapsWriteMapAuditLog($pdo, (int) $sibling['id'], 'update_path_details', $userId,
            avesmapsEncodeAuditJson($sibling),
            avesmapsEncodeAuditJson([
                'public_id' => (string) $sibling['public_id'],
                'feature_type' => 'path',
                'name' => (string) $sibling['name'],
                'feature_subtype' => $subtype,
                'transport_seasons' => $forSibling,
                'properties_json' => $properties,
                'revision' => $revision,
                'via_wiki_key' => $wikiKey,
            ]));
        $written++;
    }

    return $written;
}

/**
 * REIN: der DRITTE ZUSTAND eines Weges („dieser Weg hat KEINEN Wiki-Artikel") in seinen
 * Eigenschaften. Vorbild und Zwilling: avesmapsApplyPointWikiFields (Ort) und der Linien-Schreibweg
 * der Kraftlinien -- es gibt KEINEN zweiten Mechanismus, nur diesen Merker `wiki_no_article`.
 *
 * 💣 ABWESENHEIT HEISST „NICHT GEAENDERT", und zwar aus demselben Grund wie beim Ort:
 * `update_path_details` hat ZWEI Schreiber (buildPathEditPayload in js/review/review-paths.js und
 * saveDraft in js/pages/wege-editor.js) und dazu die Ladeluecke eines Deploys (AGENTS.md §7). Eine
 * gecachte Oberflaeche, die das Feld noch nicht kennt, wuerde mit `?? false` bei JEDEM Speichern die
 * Entscheidung des Konfliktzentrums stillschweigend zuruecknehmen. Ein Schreiber, der ein Feld nicht
 * kennt, darf es nicht loeschen.
 *
 * ⚠️ Der Merker steht nur drin, wenn er WAHR ist -- als `false` wird er nirgends abgelegt, sonst
 * liesse er sich spaeter nicht von „nie entschieden" unterscheiden (dieselbe Regel wie bei
 * avesmapsPowerlineInheritedLineFields und avesmapsApplyPointWikiFields).
 *
 * 🔴 DAS ANHAKEN LEERT EINE GESPEICHERTE FLACHE ADRESSE (Owner-Entscheid 16.08.2026). Die Begruendung
 * steht hier, damit sie niemand zurueckdreht: das Haekchen sagt „es gibt keinen Artikel", eine
 * gespeicherte Adresse widerspricht dem, und der Ort macht es seit dem 16.08.2026 genauso
 * (settlementWikiKeinArtikelGeaendert leert dort das Feld schon im Browser). Die Alternative -- der
 * Server VERWEIGERT das Haekchen -- waere beim Weg eine Absage ohne Ausweg: er hat in KEINER seiner
 * zwei Oberflaechen ein Adressfeld, und `update_path_details` schickt `wiki_url` gar nicht mit; der
 * Editor bekaeme eine Absage, deren Ursache er nirgends sieht und nirgends beheben kann.
 * ⚠️ Beim ABwaehlen wird nichts zurueckgeholt: eine geloeschte Adresse zu erraten ist genau der
 * Fehler, den der Merker beseitigt.
 *
 * 🔴 DER WIDERSPRUCHS-RIEGEL STEHT DESHALB NACH DEM LEEREN und kann heute nicht zuschlagen. Er ist
 * trotzdem kein toter Code, sondern die Wache ueber genau die Zeile darueber: nimmt jemand das
 * `unset` heraus, wird aus einem still gespeicherten Widerspruch eine laute Absage. Die Formulierung
 * ist die GETEILTE (avesmapsAssertWikiClaimNotContradictory) -- Ort, Weg und Kraftlinie begruenden
 * denselben Widerspruch nicht dreimal verschieden.
 */
function avesmapsApplyPathWikiNoArticle(array $properties, array $payload): array {
    $noArticle = array_key_exists('wiki_no_article', $payload)
        ? avesmapsReadBoolean($payload['wiki_no_article'])
        : !empty($properties['wiki_no_article']);
    if ($noArticle) {
        $properties['wiki_no_article'] = true;
        unset($properties['wiki_url']);
    } else {
        unset($properties['wiki_no_article']);
    }
    avesmapsAssertWikiClaimNotContradictory(
        (string) ($properties['wiki_url'] ?? ''),
        $noArticle,
        'Ein Weg',
        'Bitte das Häkchen „Kein Wiki-Artikel vorhanden“ abwählen.'
    );

    return $properties;
}

/**
 * Traegt den dritten Zustand auf den NAMENSVERBUND des Weges -- alle aktiven Wegstuecke desselben
 * Namens, nicht nur das bearbeitete. Gibt zurueck, wie viele GESCHWISTER geschrieben wurden.
 *
 * 🔴 DIE REICHWEITE IST NICHT NEU ERFUNDEN, SIE IST DIE DES KONFLIKTZENTRUMS
 * (avesmapsConflictRepairSpansNameGroup, api/_internal/conflicts/repair.php, Owner-Entscheid
 * 15.08.2026). Fuer GENAU DIESEN Merker steht die Begruendung dort schon wortwoertlich: ein Fall im
 * Konfliktzentrum ist bei einer segmentierten Art eine LINIE, kein Segment -- am Knopf steht
 * „6 Segmente". Traefe der Schreibvorgang nur eines davon, bliebe der Fall mit 5 Segmenten stehen.
 * 💣 Und die zweite Haelfte derselben Begruendung gilt hier unmittelbar: im Zuweisungskasten stehen
 * das Haekchen und „Zuweisen" NEBENEINANDER, und `assign_to` fasst seit jeher alle gleichnamigen
 * Segmente (avesmapsWikiPathAssignTo). Zwei Knoepfe am selben Kasten, die verschieden weit reichen,
 * sind schlimmer als zwei getrennte Fehler.
 *
 * 🔴 KEIN ZWEITER MECHANISMUS: gefragt wird die Weiche des Konfliktzentrums, und geschrieben wird
 * mit demselben reinen Rechner wie die Zielzeile (avesmapsApplyPathWikiNoArticle) -- ein Geschwister
 * bekommt also auch das Leeren seiner flachen `wiki_url`, sonst traege es den verbotenen Zustand.
 *
 * ⚠️ NUR WENN DER RUMPF DEN MERKER MITBRINGT -- und das ist ein KOSTEN-Riegel, kein Richtigkeits-
 * Riegel: ohne ihn liefe die Verbund-Abfrage bei JEDEM Speichern eines Weges, schriebe aber nichts
 * (der Rechner unten laesst einen abwesenden Schluessel in Ruhe). Der Unterschied ist eine Abfrage
 * ueber alle gleichnamigen Segmente je Speichern -- auf STRATO ist das der Grund (AGENTS.md §10).
 * ⚠️ Genau deshalb zaehlt der Test die Abfragen mit: eine Zusicherung ueber die gespeicherten Werte
 * kann diesen Riegel nicht sehen (gemessen -- die Mutation lief zuerst gruen durch).
 * ⚠️ UND NUR, WAS SICH WIRKLICH AENDERT: eine Zeile ohne Unterschied wird uebersprungen. Sonst hebt
 * ein Speichern ohne Aenderung die Revision jedes Segments und schickt jedem warmen Client die halbe
 * Karte neu -- dieselbe Regel wie in avesmapsApplyTransportSeasonsToWikiSiblings daneben.
 *
 * ⚠️ `require_once` IM RUMPF, nicht im Dateikopf, und das ist Absicht: repair.php zieht core.php,
 * rules.php und -- seit dem 20.08.2026 fuer den Landschafts-Riegel -- app/ecosystem.php nach
 * (zusammen rund 2.100 Zeilen bzw. rund 650 KB Quelltext, gemessen 20.08.2026), und
 * features.php haengt an rund zwanzig Endpunkten,
 * darunter oeffentliche Leser -- im Kopf wuerde jeder davon sie mitparsen (STRATO, AGENTS.md §10).
 * Dazu laedt repair.php seinerseits features.php: im Kopf waere das ein Zyklus. Hausform:
 * api/_internal/routing/travel-values.php:481, api/_internal/app/citymaps.php:2109 u. a.
 */
function avesmapsApplyPathWikiNoArticleToNameGroup(
    PDO $pdo,
    string $name,
    array $payload,
    int $ownFeatureId,
    int $revision,
    int $userId
): int {
    if (!array_key_exists('wiki_no_article', $payload)) {
        return 0;
    }
    require_once __DIR__ . '/../conflicts/repair.php';
    if (!avesmapsConflictRepairSpansNameGroup('path', $name)) {
        return 0;
    }

    // Dieselbe Abfrage wie im Konfliktzentrum (avesmapsConflictUnlinkFeature): gleiche Art, gleicher
    // Name, aktiv. Die eigene Zeile ist ausgenommen -- der Aufrufer hat sie gerade selbst geschrieben.
    $select = $pdo->prepare(
        "SELECT id, public_id, name, properties_json FROM map_features
          WHERE feature_type = 'path' AND name = :n AND is_active = 1 AND id <> :own"
    );
    $select->execute(['n' => $name, 'own' => $ownFeatureId]);
    $siblings = $select->fetchAll(PDO::FETCH_ASSOC);
    if ($siblings === []) {
        return 0;
    }

    $update = $pdo->prepare(
        'UPDATE map_features SET properties_json = :properties_json, revision = :revision,
                updated_by = :updated_by
          WHERE id = :id'
    );

    $written = 0;
    foreach ($siblings as $sibling) {
        $properties = avesmapsDecodeJsonColumnForEdit($sibling['properties_json'] ?? null);
        $neu = avesmapsApplyPathWikiNoArticle($properties, $payload);
        if ($neu == $properties) {
            continue;
        }

        $before = avesmapsEncodeAuditJson($sibling);
        $update->execute([
            'id' => (int) $sibling['id'],
            'properties_json' => avesmapsEncodeJson($neu),
            'revision' => $revision,
            'updated_by' => $userId,
        ]);
        avesmapsWriteMapAuditLog($pdo, (int) $sibling['id'], 'update_path_details', $userId, $before, avesmapsEncodeAuditJson([
            'public_id' => (string) $sibling['public_id'],
            'feature_type' => 'path',
            'name' => (string) $sibling['name'],
            'wiki_no_article' => !empty($neu['wiki_no_article']),
            'properties_json' => $neu,
            'revision' => $revision,
            'via_name_group' => $name,
        ]));
        $written++;
    }

    return $written;
}

function avesmapsUpdatePathFeatureDetails(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadFeatureName($payload['name'] ?? '', 'Der Wegname');
    $subtype = avesmapsReadPathSubtype($payload['feature_subtype'] ?? 'Weg');
    $showLabel = avesmapsReadBoolean($payload['show_label'] ?? false);
    // 🔴 Dieselbe eine Regel wie beim Anlegen -- siehe avesmapsPathTransportRegel.
    $istBach = avesmapsPathIstBach($subtype, $payload['is_bach'] ?? false);
    $regel = avesmapsPathTransportRegel($subtype, $istBach, $payload['allowed_transports'] ?? null);
    $transportDomain = $regel['domain'];
    $allowedTransports = $regel['allowed'];

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        // 🔴 DER STAND VOR DEM SPEICHERN -- hier und nirgends spaeter, denn die naechsten Zeilen
        // ueberschreiben genau dieses Feld. Aus der SPALTE gelesen, nicht aus dem Nest: die Kopie
        // im properties_json ist ein Abbild, massgeblich ist, was die Karte laedt.
        $herkunftVorher = ['feature_subtype' => (string) ($feature['feature_subtype'] ?? '')];
        // R1: an assigned wiki way (properties.wiki_path) always names the way -- the typed or
        // auto-generated form name must not override it. show_label stays form-controlled (R3).
        $name = avesmapsWikiPathEffectiveEditName($name, $properties);
        $properties['name'] = $name;
        $properties['display_name'] = $name;
        $properties['feature_type'] = 'path';
        $properties['feature_subtype'] = $subtype;
        $properties['show_label'] = $showLabel;
        $properties['transport_domain'] = $transportDomain;
        $properties['allowed_transports'] = $allowedTransports;
        // 🔴 GESETZT ODER ENTFERNT, nie als `false` gespeichert -- siehe die Begruendung am
        // Anlegeweg. Das Entfernen ist die Haelfte, die man beim Aendern vergisst: ohne sie
        // liesse sich ein Haekchen nie wieder abwaehlen.
        if ($istBach) {
            $properties['is_bach'] = true;
        } else {
            unset($properties['is_bach']);
        }
        // Wann darf, was darf. Ein leeres Ergebnis heisst „ganzjaehrig" und wird deshalb ENTFERNT
        // statt als leeres Objekt gespeichert -- „das ganze Jahr" ist die Abwesenheit eines Fensters.
        $transportSeasons = avesmapsReadTransportSeasons($payload['transport_seasons'] ?? null, $allowedTransports);
        if ($transportSeasons === []) {
            unset($properties['transport_seasons']);
        } else {
            $properties['transport_seasons'] = $transportSeasons;
        }
        // Der dritte Zustand („dieser Weg hat KEINEN Wiki-Artikel"). 💣 Die ganze Entscheidung steht
        // in avesmapsApplyPathWikiNoArticle, nicht hier: sie ist rein und damit ohne Datenbank
        // pruefbar -- und sie ist die EINZIGE Stelle, an der der Merker eines Weges entsteht.
        $properties = avesmapsApplyPathWikiNoArticle($properties, $payload);
        // Die Feldherkunft fortschreiben: hat sich der Wegtyp geaendert, und kam er aus dem Wiki?
        // 💣 EINER VON ZWEI SCHREIBWEGEN. Der andere ist avesmapsUpdatePathGroupDetails (die
        // Weg-Ebene, 19.08.2026), und der schreibt `feature_subtype` in einer Schleife ueber ALLE
        // Abschnitte einer Namensgruppe. Eine Regel, die nur hier stuende, waere keine -- genau
        // diese Fehlerklasse ist am 14.08.2026 die Verkehrsmittel-Sperre gewesen (zwei von vier
        // Erzeugern gebunden). Die Zahl steht hier bewusst NICHT als „1 von 2": eine Zahl im
        // Kommentar liest sich wie eine vollstaendige Liste, und genau daran suchte damals niemand
        // weiter. Wer einen dritten Schreibweg baut, sucht `AVESMAPS_PATH_WIKI_ORIGIN_FIELDS`.
        // ⚠️ Ein leeres Ergebnis wird ENTFERNT statt als `[]` abgelegt -- dieselbe Regel wie beim
        // Merker `wiki_no_article`: was nichts aussagt, steht nicht drin.
        $herkunft = avesmapsFieldOriginsStempeln(
            is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [],
            $herkunftVorher,
            ['feature_subtype' => $subtype],
            avesmapsFieldOriginsAusWikiLesen($payload, AVESMAPS_PATH_WIKI_ORIGIN_FIELDS)
        );
        if ($herkunft === []) {
            unset($properties['field_origins']);
        } else {
            $properties['field_origins'] = $herkunft;
        }
        // 🔴 KEIN `other_source` MEHR (03.09.2026): Wegquellen haengen im Katalog (sources +
        // feature_sources, am Abschnitt), der Wegedialog und der Wege-Editor montieren das EINE
        // Quellen-Bauteil. Eine noch gespeicherte Altquelle bleibt hier UNANGETASTET -- sie wandert in
        // Schritt 4 des Quellen-Umbaus in den Katalog und wird bis dahin weiter angezeigt
        // (avesmapsMapFeaturesMergeLegacyOtherSources). Ein alter, zwischengespeicherter Client, der
        // das Feld noch schickt, aendert damit nichts. Entwurf:
        // docs/superpowers/specs/2026-09-03-quellen-wege-design.md.
        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_type = :feature_type,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $name,
            'feature_type' => 'path',
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_path_details', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'path',
            'name' => $name,
            'feature_subtype' => $subtype,
            'show_label' => $showLabel,
            'transport_domain' => $transportDomain,
            'allowed_transports' => $allowedTransports,
            'transport_seasons' => $transportSeasons,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        // Die Zeitfenster gehoeren dem WIKI-WEG, nicht dem Segment (siehe Funktionskopf oben).
        avesmapsApplyTransportSeasonsToWikiSiblings(
            $pdo, $properties, $transportSeasons, (int) $feature['id'], $revision, (int) $user['id']
        );
        // 🔴 Der Merker „kein Wiki-Artikel" gehoert dem WEG, nicht dem Wegstueck -- dieselbe
        // Reichweite wie „Zuweisen" im selben Kasten und wie die Reparatur-Verben des
        // Konfliktzentrums (Owner-Entscheid 15.08.2026, hier nachgezogen am 16.08.2026).
        // ⚠️ Der NAME ist der WIRKSAME (nach avesmapsWikiPathEffectiveEditName), also genau der,
        // der eine Zeile drueber in die Zeile geschrieben wurde -- sonst suchte der Verbund unter
        // einem Namen, den dieses Segment gar nicht mehr traegt.
        avesmapsApplyPathWikiNoArticleToNameGroup(
            $pdo, $name, $payload, (int) $feature['id'], $revision, (int) $user['id']
        );
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

/**
 * Wie viele Abschnitte ein Sammel-Speichern hoechstens fasst. Der laengste Weg im Bestand traegt
 * 26 Segmente („Reichsstrasse 1"); der Deckel ist der Riegel gegen einen Rumpf, der die halbe
 * Karte nennt, nicht eine erwartete Grenze.
 */
const AVESMAPS_PATH_GROUP_MAX_SEGMENTS = 250;

/** Die Felder, die ein Sammel-Speichern setzen darf. Alles andere im Rumpf wird ignoriert. */
// ⚠️ `other_source` ist am 03.09.2026 herausgefallen: Quellen haengen im Katalog, und die Weg-Ebene
// verteilt sie ueber das Quellen-Bauteil (entity_public_ids), nicht ueber dieses Sammel-Speichern.
const AVESMAPS_PATH_GROUP_FIELDS = ['name', 'show_label', 'feature_subtype', 'allowed_transports'];

/**
 * DIE WEG-EBENE: ein Speichern fuer alle Abschnitte eines Weges.
 *
 * Ein Weg liegt auf der Karte in Abschnitten (der Schattenbachpass in acht, „Reichsstrasse 1" in
 * 26). Bis zum 19.08.2026 liess sich nur ein Abschnitt bearbeiten -- wer einem Pass die Kutsche
 * verbieten wollte, klickte sich achtmal durch dieselbe Maske. Owner, woertlich: „fuer die
 * editoren war/ist es muehselig alle abschnitte zu konfigurieren."
 * Entwurf: docs/superpowers/specs/2026-08-19-wege-editor-weg-ebene-design.md §5
 *
 * 💣 GESCHRIEBEN WIRD NUR, WAS IN `fields` STEHT. Ein Sammel-Speichern, das alle Felder des
 * Formulars schreibt, macht jede gewollte Ausnahme platt -- und zwar lautlos, weil ein Formular
 * nun einmal alle Felder mitschickt. Genau dieser Fehler ist am 17.08.2026 in
 * `avesmapsUpsertGameLiterature` gemessen worden: dort stempelte er jedes MITGESCHICKTE Feld auf
 * `manual`, und die Spalte sah danach gepflegt aus, ohne etwas auszusagen.
 *
 * 💣 DER AUFRUFER SCHICKT DIE `public_ids`, DIESE FUNKTION BILDET DIE GRUPPE NICHT NACH. Die
 * Gruppierungsregel steht in `wpGroupWays` (js/pages/wege-editor-model.js): `wiki_key`, sonst
 * Art+Name. Sie hier zu wiederholen waere die zweite Wahrheit aus AGENTS.md §5 -- und sie liefe
 * beim ersten geaenderten Namen auseinander.
 * ⚠️ Der Preis: eine Liste kann veralten. Deshalb wird still uebersprungen, was kein aktiver Weg
 * mehr ist, und die Antwort nennt die Zahl der wirklich geschriebenen Abschnitte.
 *
 * 💣 `allowed_transports` reist als ENTSCHEIDUNGEN (`transport_decisions`: {fahrtyp: bool}), nicht
 * als fertige Liste. Ein Fahrtyp, den der Editor auf „teils" stehen laesst, steht gar nicht drin
 * und behaelt je Abschnitt seinen eigenen Zustand. Eine fertige Liste koennte das nicht
 * ausdruecken -- sie machte aus „2 von 8 haben die Kutsche" ein „keiner hat sie".
 *
 * ⚠️ `transport_seasons` bleibt AUSSEN VOR. Die Zeitfenster propagieren laengst ueber den
 * `wiki_key` (avesmapsApplyTransportSeasonsToWikiSiblings), und zwei Regeln mit verschiedener
 * Reichweite auf demselben Feld sind eine Divergenz, die auf ihren ersten Unterschied wartet.
 */
function avesmapsUpdatePathGroupDetails(PDO $pdo, array $payload, array $user): array {
    $publicIds = [];
    foreach (is_array($payload['public_ids'] ?? null) ? $payload['public_ids'] : [] as $candidate) {
        $publicIds[] = avesmapsReadMapFeaturePublicId($candidate);
    }
    $publicIds = array_values(array_unique($publicIds));
    if ($publicIds === []) {
        throw new InvalidArgumentException('Es wurde kein Abschnitt genannt.');
    }
    if (count($publicIds) > AVESMAPS_PATH_GROUP_MAX_SEGMENTS) {
        throw new InvalidArgumentException('Zu viele Abschnitte auf einmal.');
    }

    $fields = [];
    foreach (is_array($payload['fields'] ?? null) ? $payload['fields'] : [] as $field) {
        $name = avesmapsNormalizeSingleLine((string) $field, 40);
        if (in_array($name, AVESMAPS_PATH_GROUP_FIELDS, true)) {
            $fields[] = $name;
        }
    }
    $fields = array_values(array_unique($fields));
    // Ein Speichern ohne ein einziges angefasstes Feld ist kein Fehler -- es ist die Maske, die
    // jemand geoeffnet und wieder gespeichert hat. Sie darf nur nichts tun.
    if ($fields === []) {
        return ['ok' => true, 'written' => 0, 'skipped' => count($publicIds), 'revision' => null];
    }

    $wantsName = in_array('name', $fields, true);
    $wantsShowLabel = in_array('show_label', $fields, true);
    $wantsSubtype = in_array('feature_subtype', $fields, true);
    $wantsTransports = in_array('allowed_transports', $fields, true);

    $newName = $wantsName ? avesmapsReadFeatureName($payload['name'] ?? '', 'Der Wegname') : null;
    $newShowLabel = $wantsShowLabel ? avesmapsReadBoolean($payload['show_label'] ?? false) : null;
    $newSubtype = $wantsSubtype ? avesmapsReadPathSubtype($payload['feature_subtype'] ?? 'Weg') : null;

    $decisions = [];
    if ($wantsTransports) {
        foreach (is_array($payload['transport_decisions'] ?? null) ? $payload['transport_decisions'] : [] as $key => $value) {
            $option = avesmapsNormalizeSingleLine((string) $key, 40);
            if ($option !== '') {
                $decisions[$option] = avesmapsReadBoolean($value);
            }
        }
        // Kein einziger entschiedener Fahrtyp heisst: alle standen auf „teils". Dann ist an den
        // Transportmitteln nichts zu tun -- und `avesmapsReadAllowedTransports` duerfte auch gar
        // nicht laufen, es wuerde die Vorauswahl des Wegtyps ueber gepflegte Listen schreiben.
        if ($decisions === []) {
            $wantsTransports = false;
        }
    }

    $pdo->beginTransaction();
    try {
        $platzhalter = implode(', ', array_fill(0, count($publicIds), '?'));
        $statement = $pdo->prepare(
            'SELECT id, public_id, name, feature_type, feature_subtype, geometry_json,
                    properties_json, style_json, is_active, revision
               FROM map_features
              WHERE public_id IN (' . $platzhalter . ")
                AND feature_type = 'path' AND is_active = 1
              FOR UPDATE"
        );
        $statement->execute($publicIds);
        $features = $statement->fetchAll(PDO::FETCH_ASSOC);
        if ($features === []) {
            $pdo->commit();

            return ['ok' => true, 'written' => 0, 'skipped' => count($publicIds), 'revision' => null];
        }

        $revision = avesmapsNextMapRevision($pdo);
        $update = $pdo->prepare(
            'UPDATE map_features
                SET name = :name, feature_subtype = :feature_subtype,
                    properties_json = :properties_json, revision = :revision,
                    updated_by = :updated_by
              WHERE id = :id'
        );

        $written = 0;
        foreach ($features as $feature) {
            // ⚠️ MIT LEEREM RUMPF: `expected_revision` gehoert einem einzelnen Objekt und gibt es
            // hier nicht. Geprueft wird die SPERRE -- bearbeitet jemand gerade einen der
            // Abschnitte, bricht der ganze Lauf ab, statt halb zu schreiben.
            avesmapsAssertFeatureCanBeEdited($pdo, [], $feature, $user);

            $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
            $vorher = $properties;
            $nameVorher = (string) ($feature['name'] ?? '');
            $subtypeVorher = (string) ($feature['feature_subtype'] ?? 'Weg');

            $name = $nameVorher;
            if ($wantsName) {
                // R1: ein zugewiesener Wiki-Weg BESITZT den Namen -- je Abschnitt entschieden,
                // weil in einer ueber Art+Name gebildeten Gruppe nicht jeder einen tragen muss.
                $name = avesmapsWikiPathEffectiveEditName($newName, $properties);
                $properties['name'] = $name;
                $properties['display_name'] = $name;
            }

            $subtype = $wantsSubtype ? $newSubtype : $subtypeVorher;
            if ($wantsSubtype) {
                $properties['feature_subtype'] = $subtype;
            }

            // 💣 DIE HERKUNFT WIRD JE ABSCHNITT GESTEMPELT, nicht einmal fuer die Gruppe. Eine
            // Namensgruppe kann gemischt sein -- in einer ueber Art+Name gebildeten Gruppe traegt
            // nicht jeder Abschnitt denselben Wegtyp. Fuer die Abschnitte, die den gewaehlten Typ
            // schon haben, aendert sich nichts, und `avesmapsFieldOriginsStempeln` fasst sie
            // deshalb auch nicht an: „unveraendert heisst unangetastet" ist seine erste Regel.
            // Einmal fuer die Gruppe gestempelt, bekaemen genau diese Abschnitte eine Herkunft fuer
            // eine Aenderung, die bei ihnen gar nicht stattgefunden hat.
            // ⚠️ Nur wenn `feature_subtype` ueberhaupt angefasst wurde -- sonst zaehlt dieser
            // Schreibweg eine Aenderung, die von woanders kommt (ein Wegtyp kann sich hier auch
            // durch `$subtypeVorher` nicht aendern, aber die Bedingung sagt die Absicht).
            if ($wantsSubtype) {
                $herkunft = avesmapsFieldOriginsStempeln(
                    is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [],
                    ['feature_subtype' => $subtypeVorher],
                    ['feature_subtype' => $subtype],
                    avesmapsFieldOriginsAusWikiLesen($payload, AVESMAPS_PATH_WIKI_ORIGIN_FIELDS)
                );
                if ($herkunft === []) {
                    unset($properties['field_origins']);
                } else {
                    $properties['field_origins'] = $herkunft;
                }
            }
            $properties['feature_type'] = 'path';

            if ($wantsShowLabel) {
                $properties['show_label'] = $newShowLabel;
            }

            // 💣 Die Fahrtyp-Liste wird auch dann neu gerechnet, wenn nur der WEGTYP wandert: mit
            // ihm wandert die Verkehrsdomaene, und ein Landfahrzeug auf einem Flussweg waere tote
            // Angabe, die an dem Tag aufwacht, an dem jemand den Wegtyp zurueckdreht.
            // ⚠️ Gefragt wird, ob DIESES Segment seinen Typ wechselt -- nicht, ob das Feld
            // im Rumpf steht. In einer gemischten Gruppe traegt die Mehrheit den gewaehlten Typ
            // schon; ein Aufraeumen bei ihnen aendert nichts, wuerde aber `transport_domain`
            // nachtragen und damit als Aenderung durchgehen -- acht neue Revisionen fuer nichts.
            // 🔴 DAS BACH-HAEKCHEN GILT AUCH HIER. Dieser Schreibweg rechnet die Fahrtyp-Liste
            // neu -- ohne die Regel haette ein Gruppen-Speichern einem Bach seine Flusssegler
            // zurueckgegeben, und zwar lautlos: der Kasten „Verkehrsmittel" ist in diesem Fenster
            // gar nicht sichtbar. Gelesen wird der GESPEICHERTE Stand des Segments; gesetzt wird
            // das Haekchen hier nicht (das tut der Dialog „Weg bearbeiten").
            $istBach = avesmapsPathIstBach($subtype, $properties['is_bach'] ?? false);
            if ($wantsTransports || $subtype !== $subtypeVorher) {
                $domain = avesmapsPathTransportRegel($subtype, $istBach, null)['domain'];
                // ⚠️ Der Bestand wird mit dem ALTEN Wegtyp gerechnet (er beschreibt, was VORHER
                // galt) -- aber ebenfalls durch die Regel, aus demselben Grund wie oben. Das
                // Ergebnis wird gleich darunter ohnehin noch einmal gegen den NEUEN Stand
                // gefiltert.
                $bestand = is_array($properties['allowed_transports'] ?? null)
                    ? array_values($properties['allowed_transports'])
                    : avesmapsPathTransportRegel(
                        $subtypeVorher,
                        avesmapsPathIstBach($subtypeVorher, $properties['is_bach'] ?? false),
                        null
                    )['allowed'];
                foreach ($decisions as $option => $an) {
                    $bestand = array_values(array_filter($bestand, static fn(string $v): bool => $v !== $option));
                    if ($an) {
                        $bestand[] = $option;
                    }
                }
                $allowed = avesmapsPathTransportRegel($subtype, $istBach, $bestand)['allowed'];
                $properties['transport_domain'] = $domain;
                $properties['allowed_transports'] = $allowed;
                // Ein Fenster auf einem nicht mehr erlaubten Fahrtyp ist tote Angabe -- derselbe
                // Filter, den der Einzel-Schreibweg auf seinen Rumpf anwendet.
                $seasons = avesmapsReadTransportSeasons($properties['transport_seasons'] ?? null, $allowed);
                if ($seasons === []) {
                    unset($properties['transport_seasons']);
                } else {
                    $properties['transport_seasons'] = $seasons;
                }
            }

            // 🔴 NICHTS ANFASSEN, WAS SICH NICHT AENDERT. Sonst hebt ein Speichern ohne Aenderung
            // die Revision jedes Segments und schickt jedem warmen Client die halbe Karte neu --
            // dieselbe Wache wie in avesmapsApplyTransportSeasonsToWikiSiblings.
            if ($properties == $vorher && $name === $nameVorher && $subtype === $subtypeVorher) {
                continue;
            }

            $update->execute([
                'id' => (int) $feature['id'],
                'name' => $name,
                'feature_subtype' => $subtype,
                'properties_json' => avesmapsEncodeJson($properties),
                'revision' => $revision,
                'updated_by' => (int) $user['id'],
            ]);

            // 💣 JE SEGMENT EIN EIGENER EINTRAG, und er heisst `update_path_details` wie der des
            // Einzelweges: das Rueckgaengig arbeitet auf Feature-Ebene und kennt genau diese
            // Aktion (avesmapsUndoColumnsForAuditAction). Ein Sammelvermerk liesse sieben von acht
            // Aenderungen ausserhalb der Historie stehen.
            avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_path_details', (int) $user['id'],
                avesmapsEncodeAuditJson($feature),
                avesmapsEncodeAuditJson([
                    'public_id' => (string) $feature['public_id'],
                    'feature_type' => 'path',
                    'name' => $name,
                    'feature_subtype' => $subtype,
                    'properties_json' => $properties,
                    'revision' => $revision,
                    // Damit im Protokoll steht, dass hier die WEG-EBENE geschrieben hat und nicht
                    // jemand acht Masken hintereinander -- wortgleiche Absicht wie `via_wiki_key`.
                    'via_path_group' => count($features),
                ]));
            $written++;
        }

        $pdo->commit();

        return [
            'ok' => true,
            'written' => $written,
            'skipped' => count($publicIds) - count($features),
            'revision' => $written > 0 ? $revision : null,
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdatePathFeatureGeometry(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $coordinates = avesmapsReadLineStringCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableLineStringFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $name = avesmapsNormalizeSingleLine((string) ($feature['name'] ?? $properties['name'] ?? 'Weg'), 160) ?: 'Weg';
        $subtype = avesmapsReadPathSubtype($feature['feature_subtype'] ?? $properties['feature_subtype'] ?? 'Weg');
        $geometry = [
            'type' => 'LineString',
            'coordinates' => $coordinates,
        ];
        $revision = avesmapsNextMapRevision($pdo);

        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_x,
                min_y = :min_y,
                max_x = :max_x,
                max_y = :max_y,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_path_geometry', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLineStringFeatureResponse($publicId, $name, $subtype, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateLabelFeature(PDO $pdo, array $payload, array $user): array {
    $text = avesmapsReadLabelText($payload['text'] ?? '');
    $subtype = avesmapsReadLabelSubtype($payload['feature_subtype'] ?? 'region');
    $size = avesmapsReadLabelSize($payload['size'] ?? 18);
    $rotation = avesmapsReadLabelRotation($payload['rotation'] ?? 0);
    $minZoom = avesmapsReadLabelZoom($payload['min_zoom'] ?? 0);
    $maxZoom = avesmapsReadLabelZoom($payload['max_zoom'] ?? 5);
    if ($maxZoom < $minZoom) {
        throw new InvalidArgumentException('Die Label-Zoomspanne ist ungueltig.');
    }
    $priority = avesmapsReadLabelPriority($payload['priority'] ?? 3);
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');
    $publicId = avesmapsUuidV4();
    $geometry = [
        'type' => 'Point',
        'coordinates' => [$lng, $lat],
    ];
    $properties = [
        'name' => $text,
        'text' => $text,
        'feature_type' => 'label',
        'feature_subtype' => $subtype,
        'size' => $size,
        'rotation' => $rotation,
        'min_zoom' => $minZoom,
        'max_zoom' => $maxZoom,
        'priority' => $priority,
        'is_nodix' => avesmapsReadBoolean($payload['is_nodix'] ?? false),
        // Ob der Name auf der Karte ERSCHEINT (Owner 2026-07-27). Seit jede Landschaftsregion
        // automatisch ihr Label bekommt, gibt es Labels, die es geben SOLL, ohne dass ihr Name die
        // Karte füllt -- Wälder und Seen zum Beispiel. Das Label behält dabei Ort, Größe, Drehung und
        // Zoom-Band, es wird nur nicht gezeichnet; ein Ausblenden durch Löschen würde all das verlieren.
        //
        // 🔴 Vorgabe TRUE. Die 543 vorhandenen Labels tragen den Schlüssel nicht, und ihr Verhalten darf
        // sich durch diese Zeile nicht ändern.
        'show_name' => avesmapsReadBoolean($payload['show_name'] ?? true),
    ];

    if (array_key_exists('wiki_region', $payload)) {
        $wikiRegion = avesmapsReadLabelWikiRegion($payload['wiki_region']);
        if ($wikiRegion !== null) {
            $properties['wiki_region'] = $wikiRegion;
            // ⚠️ An einem FRISCHEN Label kann der Merker gar nicht stehen -- die Zeile ist trotzdem da,
            // damit die Regel „jeder Zuweiser loescht ihn" ohne Ausnahme gilt und der zaehlende Test
            // (label-wiki-no-article-test.php) keinen Sonderfall zu erklaeren hat.
            unset($properties['wiki_no_article']);
        }
    }
    // A peak may arrive with its height already known -- "Hoehenpunkt setzen" in the topography
    // layer creates the label and records the height in one gesture. Absent or unusable means the
    // key is simply not written; there is no zero default (see avesmapsReadOptionalPeakHeight).
    if (array_key_exists('height_schritt', $payload)) {
        $peakHeight = avesmapsReadOptionalPeakHeight($payload['height_schritt']);
        if ($peakHeight !== null) {
            $properties['height_schritt'] = $peakHeight;
        }
    }
    $ecosystemRegion = avesmapsReadLabelEcosystemRegion($payload);
    if ($ecosystemRegion !== '') {
        $properties['ecosystem_region_public_id'] = $ecosystemRegion;
    }

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'label',
            'feature_subtype' => $subtype,
            'name' => $text,
            'geometry_type' => 'Point',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);
        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_label', (int) $user['id'], '{}', avesmapsEncodeAuditJson(avesmapsBuildAuditAfterSnapshot([
            'public_id' => $publicId,
            'feature_type' => 'label',
            'name' => $text,
            'feature_subtype' => $subtype,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ], $payload)));
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, $text, $subtype, $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateLabelFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $text = avesmapsReadLabelText($payload['text'] ?? '');
    $subtype = avesmapsReadLabelSubtype($payload['feature_subtype'] ?? 'region');
    $size = avesmapsReadLabelSize($payload['size'] ?? 18);
    $rotation = avesmapsReadLabelRotation($payload['rotation'] ?? 0);
    $minZoom = avesmapsReadLabelZoom($payload['min_zoom'] ?? 0);
    $maxZoom = avesmapsReadLabelZoom($payload['max_zoom'] ?? 5);
    if ($maxZoom < $minZoom) {
        throw new InvalidArgumentException('Die Label-Zoomspanne ist ungueltig.');
    }
    $priority = avesmapsReadLabelPriority($payload['priority'] ?? 3);

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        if ((string) $feature['feature_type'] !== 'label') {
            throw new InvalidArgumentException('Dieses Kartenobjekt ist kein Label.');
        }
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        // 🔴 DER STAND VOR DEM SPEICHERN -- hier und nirgends spaeter, die naechsten Zeilen
        // ueberschreiben genau diese zwei Felder. Die Wiki-Felder eines Labels sind `text` und
        // `feature_subtype` (Feldregister, Objektart `landschaftslabel`); `name` ist nur deren
        // Abbild und traegt keine eigene Herkunft.
        $herkunftVorher = [
            'text' => (string) ($properties['text'] ?? $feature['name'] ?? ''),
            'feature_subtype' => (string) ($feature['feature_subtype'] ?? ''),
        ];
        $properties['name'] = $text;
        $properties['text'] = $text;
        $properties['feature_type'] = 'label';
        $properties['feature_subtype'] = $subtype;
        $herkunftLabel = avesmapsFieldOriginsStempeln(
            is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : [],
            $herkunftVorher,
            ['text' => $text, 'feature_subtype' => $subtype],
            avesmapsFieldOriginsAusWikiLesen($payload, AVESMAPS_LABEL_WIKI_ORIGIN_FIELDS)
        );
        if ($herkunftLabel === []) {
            unset($properties['field_origins']);
        } else {
            $properties['field_origins'] = $herkunftLabel;
        }
        // 💣 DER DARSTELLUNGSSATZ WIRD NUR GESCHRIEBEN, WENN ER MITKOMMT (2026-07-28). Vorher lief das
        // unbedingt: `$payload['size'] ?? 18` machte aus einem fehlenden Schlüssel eine 18, aus einem
        // fehlenden min_zoom eine 0. Wer also nur EINE Eigenschaft ändern wollte, musste den ganzen
        // Satz mitschicken -- und wer ihn mitschickt, muss ihn erst kennen, also die Zeile frisch
        // geladen haben, also eine gültige Revision besitzen.
        //
        // Genau daran scheiterte jede Gipfelhöhe: der Landschaften-Dialog schickte pflichtschuldig den
        // vollen Satz samt `expected_revision` aus einer ~21 MB grossen, längst überholten
        // Kartennutzlast, und der Server antwortete korrekt mit 409. Ein Feld, das man einzeln setzen
        // kann, braucht diesen Umweg gar nicht erst.
        //
        // Dieselbe Regel wie bei show_name, wiki_region, other_source und height_schritt darunter.
        // Ein Aufrufer, der den vollen Satz schickt, merkt keinen Unterschied.
        foreach (['size' => $size, 'rotation' => $rotation, 'min_zoom' => $minZoom,
            'max_zoom' => $maxZoom, 'priority' => $priority] as $schluessel => $wert) {
            if (array_key_exists($schluessel, $payload)) {
                $properties[$schluessel] = $wert;
            }
        }
        if (array_key_exists('is_nodix', $payload)) {
            $properties['is_nodix'] = avesmapsReadBoolean($payload['is_nodix']);
        }
        // 🪤 array_key_exists, nicht ?? -- wie beim Nodix darueber. Diese Funktion schreibt nur, was
        // der Aufrufer wirklich mitschickt; ein ?? false naehme ein gesetztes Versteckt bei jedem
        // unbeteiligten Speichern still zurueck.
        if (array_key_exists('is_hidden', $payload)) {
            $properties['is_hidden'] = avesmapsReadBoolean($payload['is_hidden']);
        }
        // 🪤 Nur schreiben, wenn der Aufrufer es MITSCHICKT -- anders als die Zeilen darüber. Ein
        // blosses Umbenennen (map-features-ecosystem-properties.js) sendet den Darstellungssatz, aber
        // kein show_name; mit einem `?? true` würde es eine ausgeschaltete Anzeige stillschweigend
        // wieder einschalten.
        if (array_key_exists('show_name', $payload)) {
            $properties['show_name'] = avesmapsReadBoolean($payload['show_name']);
        }
        if (array_key_exists('wiki_region', $payload)) {
            $wikiRegion = avesmapsReadLabelWikiRegion($payload['wiki_region']);
            if ($wikiRegion !== null) {
                $properties['wiki_region'] = $wikiRegion;
                // 🔴 EINE ZUWEISUNG BEANTWORTET DEN DRITTEN ZUSTAND -- „es gibt keinen Artikel" und
                // „hier ist er" schliessen einander aus. Es gibt FUENF Schreiber von
                // `properties.wiki_region` (hier, avesmapsCreateLabelFeature, und drei in
                // api/_internal/wiki/regions.php); jeder einzelne loescht den Merker, und der Test
                // label-wiki-no-article-test.php zaehlt sie nach, statt sich auf eine ZAHL in diesem
                // Kommentar zu verlassen (die Falle aus AGENTS.md §11).
                unset($properties['wiki_no_article']);
            } else {
                unset($properties['wiki_region']);
            }
        }
        // 🔴 DER DRITTE ZUSTAND AM LABEL, seit 16.08.2026 (Aufgabe 6). Anders als bei der
        // Landschaftsflaeche hat er hier einen echten VERBRAUCHER: ein Label ist eine Konfliktpartei
        // (`feature_type='label'`, api/_internal/conflicts/rules.php), und die Regel `wiki.missing_key`
        // liest den Merker seit dem 15.08.2026 -- es fehlte nur der Schreibweg.
        // 💣 array_key_exists, nicht ?? -- wie beim Nodix und beim Versteckt darueber: diese Funktion
        // schreibt nur, was der Aufrufer wirklich mitschickt. Ein `?? false` naehme die Entscheidung
        // eines zweiten Editors bei jedem unbeteiligten Speichern still zurueck.
        if (array_key_exists('wiki_no_article', $payload)) {
            if (avesmapsReadBoolean($payload['wiki_no_article'])) {
                $properties['wiki_no_article'] = true;
            } else {
                // Entfernt, nicht auf `false`: als `false` liesse sich „entschieden, es gibt keinen"
                // spaeter nicht von „nie entschieden" unterscheiden (dieselbe Regel wie ueberall sonst).
                unset($properties['wiki_no_article']);
            }
        }
        // Der GETEILTE Riegel (api/_internal/map/wiki-claim.php): beides zugleich wird ABGELEHNT, nicht
        // still nach einer Vorrangregel aufgeloest.
        avesmapsAssertWikiClaimNotContradictory(
            isset($properties['wiki_region']) ? 'wiki:gesetzt' : '',
            !empty($properties['wiki_no_article']),
            'Ein Label',
            'Bitte die Zuweisung entfernen oder das Häkchen abwählen.'
        );
        // 💣 NUR anfassen, wenn der Schluessel mitkommt. Bis 2026-07-28 lief das unbedingt: fehlte
        // `other_source` im Payload, wurde daraus null und die Eigenschaft flog raus. Als der
        // Label-Dialog das Feld verlor und den Schluessel folgerichtig nicht mehr sendete, loeschte
        // jedes Speichern die gespeicherte Quelle -- gemeint war das genaue Gegenteil.
        if (array_key_exists('other_source', $payload)) {
            $otherSource = avesmapsReadOptionalOtherSource($payload['other_source']);
            if ($otherSource === null) {
                unset($properties['other_source']);
            } else {
                $properties['other_source'] = $otherSource;
            }
        }
        // 💣 Only when the caller sends the key -- same rule as other_source directly above, for the
        // same reason. A save that does not mention the height must not erase it, and the height is
        // edited from TWO surfaces (the label dialog and the landscape panel); each of them omits
        // the key whenever the other one is the sensible owner of the moment.
        if (array_key_exists('height_schritt', $payload)) {
            $peakHeight = avesmapsReadOptionalPeakHeight($payload['height_schritt']);
            if ($peakHeight === null) {
                unset($properties['height_schritt']);
            } else {
                $properties['height_schritt'] = $peakHeight;
            }
        }
        // Die Flaeche, zu der dieses Label gehoert. Leer mitgeschickt = ausdruecklich geloest.
        if (array_key_exists('ecosystem_region_public_id', $payload)) {
            $ecosystemRegion = avesmapsReadLabelEcosystemRegion($payload);
            if ($ecosystemRegion === '') {
                unset($properties['ecosystem_region_public_id']);
            } else {
                $properties['ecosystem_region_public_id'] = $ecosystemRegion;
            }
        }
        $geometry = avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null);
        $coordinates = is_array($geometry['coordinates'] ?? null) ? $geometry['coordinates'] : [0, 0];
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET name = :name,
                feature_subtype = :feature_subtype,
                properties_json = :properties_json,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'name' => $text,
            'feature_subtype' => $subtype,
            'properties_json' => avesmapsEncodeJson($properties),
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_label', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'label',
            'name' => $text,
            'feature_subtype' => $subtype,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, $text, $subtype, (float) $coordinates[1], (float) $coordinates[0], $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsMoveLabelFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $lat = avesmapsParseMapCoordinate($payload['lat'] ?? null, 'lat');
    $lng = avesmapsParseMapCoordinate($payload['lng'] ?? null, 'lng');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditablePointFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        if ((string) $feature['feature_type'] !== 'label') {
            throw new InvalidArgumentException('Dieses Kartenobjekt ist kein Label.');
        }
        $geometry = [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ];
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET geometry_json = :geometry_json,
                min_x = :min_x,
                min_y = :min_y,
                max_x = :max_x,
                max_y = :max_y,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'geometry_json' => avesmapsEncodeJson($geometry),
            'min_x' => $lng,
            'min_y' => $lat,
            'max_x' => $lng,
            'max_y' => $lat,
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'move_label', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();

        return avesmapsBuildLabelFeatureResponse($publicId, (string) $feature['name'], (string) $feature['feature_subtype'], $lat, $lng, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsCreateRegionFeature(PDO $pdo, array $payload, array $user): array {
    $name = avesmapsReadFeatureName($payload['name'] ?? 'Neue Region', 'Der Regionsname');
    $color = avesmapsReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsReadOpacity($payload['opacity'] ?? 0.33);
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');
    $coordinates = avesmapsReadPolygonCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates[0]);
    $publicId = avesmapsUuidV4();
    $geometry = ['type' => 'Polygon', 'coordinates' => $coordinates];
    $properties = [
        'type' => 'region',
        'name' => $name,
        'fill' => $color,
        'stroke' => $color,
        'fillOpacity' => $opacity,
        'feature_type' => 'region',
        'feature_subtype' => 'region',
    ];
    if ($wikiUrl !== '') {
        $properties['wiki_url'] = $wikiUrl;
    }

    $pdo->beginTransaction();
    try {
        $revision = avesmapsNextMapRevision($pdo);
        $sortOrder = avesmapsNextMapSortOrder($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO map_features (
                public_id, feature_type, feature_subtype, name, geometry_type,
                geometry_json, properties_json, min_x, min_y, max_x, max_y,
                sort_order, revision, created_by, updated_by
            ) VALUES (
                :public_id, :feature_type, :feature_subtype, :name, :geometry_type,
                :geometry_json, :properties_json, :min_x, :min_y, :max_x, :max_y,
                :sort_order, :revision, :created_by, :updated_by
            )'
        );
        $statement->execute([
            'public_id' => $publicId,
            'feature_type' => 'region',
            'feature_subtype' => 'region',
            'name' => $name,
            'geometry_type' => 'Polygon',
            'geometry_json' => avesmapsEncodeJson($geometry),
            'properties_json' => avesmapsEncodeJson($properties),
            'min_x' => $bounds['min_x'],
            'min_y' => $bounds['min_y'],
            'max_x' => $bounds['max_x'],
            'max_y' => $bounds['max_y'],
            'sort_order' => $sortOrder,
            'revision' => $revision,
            'created_by' => (int) $user['id'],
            'updated_by' => (int) $user['id'],
        ]);
        $featureId = (int) $pdo->lastInsertId();
        avesmapsWriteMapAuditLog($pdo, $featureId, 'create_region', (int) $user['id'], '{}', avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'feature_type' => 'region',
            'feature_subtype' => 'region',
            'name' => $name,
            'geometry_json' => $geometry,
            'properties_json' => $properties,
            'revision' => $revision,
        ]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, $name, $geometry, $properties, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateRegionFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $name = avesmapsReadFeatureName($payload['name'] ?? '', 'Der Regionsname');
    $color = avesmapsReadHexColor($payload['color'] ?? '#888888');
    $opacity = avesmapsReadOpacity($payload['opacity'] ?? 0.33);
    $wikiUrl = avesmapsReadOptionalWikiUrl($payload['wiki_url'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $properties = avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null);
        $properties['type'] = 'region';
        $properties['name'] = $name;
        $properties['fill'] = $color;
        $properties['stroke'] = $color;
        $properties['fillOpacity'] = $opacity;
        if ($wikiUrl === '') {
            unset($properties['wiki_url']);
        } else {
            $properties['wiki_url'] = $wikiUrl;
        }
        $otherSource = avesmapsReadOptionalOtherSource($payload['other_source'] ?? null);
        if ($otherSource === null) {
            unset($properties['other_source']);
        } else {
            $properties['other_source'] = $otherSource;
        }
        $style = avesmapsDecodeJsonColumnForEdit($feature['style_json'] ?? null);
        $style['fill'] = $color;
        $style['stroke'] = $color;
        $style['fillOpacity'] = $opacity;
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare('UPDATE map_features SET name = :name, properties_json = :properties_json, style_json = :style_json, revision = :revision, updated_by = :updated_by WHERE id = :id');
        $statement->execute(['id' => (int) $feature['id'], 'name' => $name, 'properties_json' => avesmapsEncodeJson($properties), 'style_json' => avesmapsEncodeJson($style), 'revision' => $revision, 'updated_by' => (int) $user['id']]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_region', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'name' => $name,
            'properties_json' => $properties,
            'style_json' => $style,
            'revision' => $revision,
        ]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, $name, avesmapsDecodeJsonColumnForEdit($feature['geometry_json'] ?? null), $properties + $style, $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsUpdateRegionFeatureGeometry(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');
    $coordinates = avesmapsReadPolygonCoordinates($payload['coordinates'] ?? null);
    $bounds = avesmapsCalculateLineStringBounds($coordinates[0]);
    $geometry = ['type' => 'Polygon', 'coordinates' => $coordinates];
    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare('UPDATE map_features SET geometry_json = :geometry_json, min_x = :min_x, min_y = :min_y, max_x = :max_x, max_y = :max_y, revision = :revision, updated_by = :updated_by WHERE id = :id');
        $statement->execute(['id' => (int) $feature['id'], 'geometry_json' => avesmapsEncodeJson($geometry), 'min_x' => $bounds['min_x'], 'min_y' => $bounds['min_y'], 'max_x' => $bounds['max_x'], 'max_y' => $bounds['max_y'], 'revision' => $revision, 'updated_by' => (int) $user['id']]);
        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'update_region_geometry', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'geometry_json' => $geometry,
            'revision' => $revision,
        ]));
        $pdo->commit();
        return avesmapsBuildRegionFeatureResponse($publicId, (string) $feature['name'], $geometry, avesmapsDecodeJsonColumnForEdit($feature['properties_json'] ?? null), $revision);
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

// 💣 Die Gegenprobe zum Anlegen. avesmapsCreatePowerlineFeature prueft BEIDE Endpunkte hart --
// sie muessen existieren und Nodix-Ort oder Kreuzung sein. Beim Loeschen eines solchen Punktes
// prueft niemand, ob Kraftlinien daran haengen: im Bestand fanden sich 14 Abschnitte, die auf 6
// verschwundene Ids zeigen (Befund A9). Die Linie zeichnet weiter, weil ihre Geometrie im Feature
// steht -- aber „verbindet A mit B" ist tot, und der Kraftlinien-Editor sortiert die Abschnitte
// genau ueber diese Kette.
//
// ⚠️ 162 Kraftlinien-Zeilen, in PHP gefiltert statt per JSON_EXTRACT in SQL. Das Loeschen eines
// Ortes ist eine seltene Handbewegung, und es gibt keine lokale MySQL, an der sich eine
// JSON-Funktion vorher ausprobieren liesse.
// Nennt die Namen, nicht nur die Zahl: „3 Kraftlinien" schickt den Redakteur auf die Suche,
// „Konzilslinie, Nelkra-Linie" sagt ihm, wo er hin muss. Ab vier Namen gekuerzt, damit die
// Meldung eine Meldung bleibt.
function avesmapsBuildAnchoredPowerlineMessage(array $names): string {
    $unique = array_values(array_unique(array_filter($names, static fn(string $n): bool => $n !== '')));
    sort($unique);
    $shown = array_slice($unique, 0, 3);
    $suffix = count($unique) > 3 ? ' und weitere' : '';
    $list = $shown === [] ? '' : ' (' . implode(', ', $shown) . $suffix . ')';
    $count = count($names);

    // Singular ist der HAEUFIGE Fall, nicht der Randfall: ein Endpunkt am Ende einer Linie traegt
    // genau einen Abschnitt. „1 Kraftlinien-Abschnitte" stand hier trotzdem.
    $verb = $count === 1 ? 'haengt' : 'haengen';
    $noun = $count === 1 ? 'Kraftlinien-Abschnitt' : 'Kraftlinien-Abschnitte';

    // „Punkt", nicht „Ort": ein Endpunkt kann eine Kreuzung oder ein Nodix-Label sein.
    return 'An diesem Punkt ' . $verb . ' noch ' . $count . ' ' . $noun . $list
        . '. Bitte zuerst die Kraftlinie loesen -- sonst zeigt sie ins Leere.';
}

// 💣 KEINE Typ-Bedingung, und das ist die Lehre aus dem ersten Wurf. Der stand auf
// `feature_type === 'location'` -- und traf damit genau EINE der drei Endpunktarten:
//   * eine Kreuzung ist `feature_type = 'junction'` (dazu 798 Altzeilen mit 'crossing'),
//   * ein Nodix-LABEL ist ein gueltiger Endpunkt (Owner 2026-07-28, api/edit/map/powerlines.php:93).
// Der Kommentar dort sagt es genau: avesmapsFetchEditablePointFeature verlangt „einen Punkt und
// keinen Ort". Zwei Drittel des Endpunktbereichs liefen also weiter ungebremst durch.
//
// Statt die Typliste nachzubessern -- die naechste Art faellt wieder heraus -- fragt der Riegel
// gar nicht erst nach dem Typ. Was keine Kraftlinie nennt, kostet eine leere Antwort; was eine
// nennt, kann nicht durchrutschen, egal wie es heisst.
function avesmapsAssertNoPowerlineAnchoredAt(PDO $pdo, string $publicId): void {
    $anchored = avesmapsFindPowerlinesAnchoredAt($pdo, $publicId);
    if ($anchored !== []) {
        throw new InvalidArgumentException(avesmapsBuildAnchoredPowerlineMessage($anchored));
    }
}

function avesmapsFindPowerlinesAnchoredAt(PDO $pdo, string $publicId): array {
    if ($publicId === '') {
        return [];
    }

    $statement = $pdo->prepare(
        "SELECT name, properties_json
        FROM map_features
        WHERE feature_type = 'powerline' AND is_active = 1"
    );
    $statement->execute();

    $names = [];
    foreach ($statement->fetchAll() as $row) {
        $properties = avesmapsDecodeJsonColumnForEdit($row['properties_json'] ?? null);
        if ((string) ($properties['from_public_id'] ?? '') === $publicId
            || (string) ($properties['to_public_id'] ?? '') === $publicId) {
            $names[] = (string) ($row['name'] ?? '');
        }
    }

    return $names;
}

function avesmapsDeleteMapFeature(PDO $pdo, array $payload, array $user): array {
    $publicId = avesmapsReadMapFeaturePublicId($payload['public_id'] ?? '');

    $pdo->beginTransaction();
    try {
        $feature = avesmapsFetchEditableFeature($pdo, $publicId);
        avesmapsAssertFeatureCanBeEdited($pdo, $payload, $feature, $user);
        // Refuse rather than repair: the segments carry names, sources and a sort order, and
        // silently deleting or rewiring them would be a bigger surprise than a refused delete.
        // The editor removes the powerline first, which is a deliberate act with its own undo.
        avesmapsAssertNoPowerlineAnchoredAt($pdo, $publicId);
        $revision = avesmapsNextMapRevision($pdo);
        $statement = $pdo->prepare(
            'UPDATE map_features
            SET is_active = 0,
                revision = :revision,
                updated_by = :updated_by
            WHERE id = :id'
        );
        $statement->execute([
            'id' => (int) $feature['id'],
            'revision' => $revision,
            'updated_by' => (int) $user['id'],
        ]);

        avesmapsWriteMapAuditLog($pdo, (int) $feature['id'], 'delete_feature', (int) $user['id'], avesmapsEncodeAuditJson($feature), avesmapsEncodeAuditJson([
            'public_id' => $publicId,
            'is_active' => 0,
            'revision' => $revision,
        ]));

        // Powerline anchor preservation: a line's sources ride its anchor segment (smallest public_id of
        // the name group; see powerlineInfoboxMarkup + the editor's mountFeatureSourceEditor). If the
        // segment just deleted was that anchor, move its feature_sources onto the new anchor (smallest
        // remaining active segment of the same name) so the infobox keeps showing them. A non-anchor
        // segment carries no sources, so the update simply moves nothing; with no segment left, the line
        // is gone and there is nowhere to move them. See design section 10.
        if ((string) ($feature['feature_type'] ?? '') === 'powerline') {
            $newAnchorStatement = $pdo->prepare(
                "SELECT MIN(public_id) FROM map_features
                 WHERE feature_type = 'powerline' AND is_active = 1 AND name = :name AND id <> :id"
            );
            $newAnchorStatement->execute(['name' => (string) ($feature['name'] ?? ''), 'id' => (int) $feature['id']]);
            $newAnchor = $newAnchorStatement->fetchColumn();
            if (is_string($newAnchor) && $newAnchor !== '') {
                $moveSources = $pdo->prepare(
                    "UPDATE feature_sources SET entity_public_id = :new
                     WHERE entity_type = 'powerline' AND entity_public_id = :old"
                );
                $moveSources->execute(['new' => $newAnchor, 'old' => $publicId]);
            }
        }

        // Landscape cascade (owner, 2026-07-28): a landscape and its name are one thing. Deleting the
        // LAST label of an area takes the region and its remaining areas with it -- otherwise an area
        // stays behind that nothing points at and nobody can select once it leaves the viewport.
        //
        // AFTER the deactivation above, so the count already excludes this label: the rule is about the
        // TRANSITION ("this delete emptied it"), never the state. Inside this transaction, so the delete
        // and its consequence cannot come apart.
        //
        // function_exists rather than a require: this library is loaded by several endpoints that can
        // never delete a label, and dragging the ecosystem library (plus its app-setting chain) into all
        // of them would be a cost with no purchase. api/edit/map/features.php -- the ONE endpoint that
        // reaches this line -- requires it explicitly, so the guard is never false in practice.
        $cascade = [];
        if ((string) ($feature['feature_type'] ?? '') === 'label' && function_exists('avesmapsEcosystemCascadeAfterRemoval')) {
            $properties = json_decode((string) ($feature['properties_json'] ?? ''), true);
            $regionPublicId = avesmapsEcosystemRegionPublicIdOfLabel(
                $pdo,
                $publicId,
                is_array($properties) ? $properties : []
            );
            if ($regionPublicId !== '') {
                // 💣 DER AUFRUFER DARF DIE KASKADE VERBIETEN -- und dann wird sie nicht umgangen,
                // sondern der ganze Loeschvorgang abgebrochen. Das Konfliktzentrum raeumt Dubletten weg
                // und darf dabei unter keinen Umstaenden eine gezeichnete Flaeche mitreissen; es
                // prueft das zwar vorher selbst, aber jene Pruefung laeuft im Autocommit VOR dieser
                // Transaktion.
                //
                // 🔴 Und genau dazwischen liegt ein Rennen: Richtung 1 des Zeigers
                // (`properties.ecosystem_region_public_id`) ist ab hier durch das FOR UPDATE auf der
                // map_features-Zeile gedeckt, Richtung 2 NICHT -- `ecosystem_region.label_public_id`
                // wird allein in `ecosystem_region` geschrieben, die Label-Zeile bleibt dabei
                // unberuehrt. Wer in dem Fenster „Beschriftung zuweisen" drueckt, macht aus dem
                // geprueften '' ein 'R'. Hier drin, hinter dem FOR UPDATE, kann das nicht passieren.
                //
                // ⚠️ Geworfen statt still uebersprungen: eine halb ausgefuehrte Loeschung waere
                // schlimmer als eine Absage. Der Wurf laeuft in avesmapsRollbackAndRethrow, die
                // Deaktivierung von oben rollt also mit zurueck.
                if (!empty($payload['refuse_ecosystem_cascade'])) {
                    throw new AvesmapsConflictException(
                        'Diese Beschriftung gehört inzwischen zu einer Landschaftsfläche — ein Löschen würde die Fläche mitnehmen. Bitte im Landschaften-Editor lösen.'
                    );
                }
                $cascade = avesmapsEcosystemCascadeAfterRemoval($pdo, $regionPublicId, 'label', (int) $user['id']);
            }
        }

        $pdo->commit();

        return [
            'public_id' => $publicId,
            'deleted' => true,
            'revision' => $revision,
            // Said out loud, so the client can report it instead of letting an area vanish quietly,
            // and takes exactly these shapes off the map rather than reloading to find out which went.
            'region_deleted' => (bool) ($cascade['cascaded'] ?? false),
            'areas_deleted' => (int) ($cascade['areas_deleted'] ?? 0),
            'deleted_area_public_ids' => $cascade['deleted_area_public_ids'] ?? [],
            'deleted_label_public_ids' => $cascade['deleted_label_public_ids'] ?? [],
        ];
    } catch (Throwable $exception) {
        avesmapsRollbackAndRethrow($pdo, $exception);
    }
}

function avesmapsReadPointCoordinatesFromGeometry(array $geometry): array {
    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates) || count($coordinates) < 2 || !is_numeric($coordinates[0]) || !is_numeric($coordinates[1])) {
        throw new RuntimeException('Die Point-Geometrie ist ungueltig.');
    }

    return [(float) $coordinates[0], (float) $coordinates[1]];
}

function avesmapsReadLineStringCoordinates(mixed $value): array {
    if (!is_array($value) || count($value) < 2) {
        throw new InvalidArgumentException('Ein Weg braucht mindestens Start- und Endpunkt.');
    }

    $coordinates = [];
    foreach ($value as $index => $coordinatePair) {
        if (!is_array($coordinatePair) || count($coordinatePair) < 2) {
            throw new InvalidArgumentException('Die Wegkoordinaten sind ungueltig.');
        }

        $lat = avesmapsParseMapCoordinate($coordinatePair[0] ?? null, "coordinates[{$index}][0]");
        $lng = avesmapsParseMapCoordinate($coordinatePair[1] ?? null, "coordinates[{$index}][1]");
        $coordinates[] = [$lng, $lat];
    }

    $firstCoordinate = $coordinates[0];
    $lastCoordinate = $coordinates[count($coordinates) - 1];
    if (abs($firstCoordinate[0] - $lastCoordinate[0]) < 0.0001 && abs($firstCoordinate[1] - $lastCoordinate[1]) < 0.0001) {
        throw new InvalidArgumentException('Start und Ziel des Weges duerfen nicht identisch sein.');
    }

    return $coordinates;
}

function avesmapsCalculateLineStringBounds(array $coordinates): array {
    $xValues = array_map(static fn(array $coordinate): float => (float) $coordinate[0], $coordinates);
    $yValues = array_map(static fn(array $coordinate): float => (float) $coordinate[1], $coordinates);

    return [
        'min_x' => min($xValues),
        'min_y' => min($yValues),
        'max_x' => max($xValues),
        'max_y' => max($yValues),
    ];
}

function avesmapsNextMapSortOrder(PDO $pdo): int {
    $statement = $pdo->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM map_features');
    $sortOrder = $statement !== false ? $statement->fetchColumn() : false;

    return $sortOrder === false ? 1 : (int) $sortOrder;
}

function avesmapsNextMapRevision(PDO $pdo): int {
    $pdo->exec(
        'INSERT INTO map_revision (id, revision)
        VALUES (1, 2)
        ON DUPLICATE KEY UPDATE revision = revision + 1'
    );

    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        throw new RuntimeException('Die Kartenrevision konnte nicht gelesen werden.');
    }

    return (int) $revision;
}

// 🔴 Die zwei Grenzen dieses Protokolls stehen bei ihrem Aufraeumer (api/_internal/audit-prune.php):
// AVESMAPS_AUDIT_KEEP_PER_ACTOR (200 je Person, die Zahl, die zaehlt) und
// AVESMAPS_MAP_AUDIT_GLOBAL_KEEP_ROWS (die Unfallbremse). Dort stehen auch die Byte-Rechnungen --
// nebeneinander, weil sie sich EIN Speicherbudget teilen.

// feature_id is nullable because not every logged action is about a map object: a community-report
// moderation decision (api/_internal/map/report-audit.php) has no feature, and the read path already
// LEFT JOINs, so such a row simply shows no target. NULL and not 0 -- 0 would claim a feature id that
// does not exist, and every later query would carry that claim forward.
function avesmapsWriteMapAuditLog(PDO $pdo, ?int $featureId, string $action, int $actorUserId, string $beforeJson, string $afterJson): int {
    $statement = $pdo->prepare(
        'INSERT INTO map_audit_log (feature_id, action, actor_user_id, before_json, after_json)
        VALUES (:feature_id, :action, :actor_user_id, :before_json, :after_json)'
    );
    $statement->execute([
        'feature_id' => $featureId,
        'action' => $action,
        'actor_user_id' => $actorUserId,
        'before_json' => $beforeJson,
        'after_json' => $afterJson,
    ]);
    $auditId = (int) $pdo->lastInsertId();

    // 🔴 HIER und nicht bei den Aufrufern: diese Funktion hat 30 davon. Eine Grenze, die einen
    // von dreissig Erzeugern bindet, ist keine Grenze -- dieselbe Lehre wie bei der Verkehrsmittel-Sperre.
    //
    // Zwei Stufen: erst die Zeilen DIESER Person kappen -- billiger als vorher, weil der Lauf die
    // Zeilen der anderen gar nicht anfasst --, dann die globale Unfallbremse.
    avesmapsPruneActorAcrossAuditLogs($pdo, $actorUserId);
    avesmapsPruneAuditLog($pdo, 'map_audit_log', AVESMAPS_MAP_AUDIT_GLOBAL_KEEP_ROWS);

    return $auditId;
}

function avesmapsBuildPointFeatureResponse(string $publicId, string $name, string $subtype, float $lat, float $lng, array $properties, int $revision): array {
    return [
        'public_id' => $publicId,
        'name' => $name,
        'feature_type' => 'location',
        'feature_subtype' => $subtype,
        'location_type' => $subtype,
        'location_type_label' => avesmapsLocationSubtypeLabel($subtype),
        'description' => (string) ($properties['description'] ?? ''),
        'wiki_url' => (string) ($properties['wiki_url'] ?? ''),
        'other_source' => $properties['other_source'] ?? null,
        'is_nodix' => !empty($properties['is_nodix']),
        'is_ruined' => !empty($properties['is_ruined']),
        'is_hidden' => !empty($properties['is_hidden']),
        // Ortsart -- der Editor liest sie hier zurueck, um das Feld beim Oeffnen zu fuellen.
        'place_kind' => (string) ($properties['place_kind'] ?? ''),
        // 🔴 Der dritte Zustand und die drei Wiki-Textfelder MUESSEN hier stehen. Der Kartendialog
        // baut seinen Marker-Eintrag aus genau dieser Antwort neu (updateLocationMarkerFromFeature,
        // js/map-features/map-features-location-editing.js) -- fehlte eines der vier, saehe der
        // Dialog beim naechsten Oeffnen einen Stand, den er selbst gerade gespeichert hat, als
        // „nicht gesetzt", und das naechste Speichern schriebe die Leere fest.
        'wiki_no_article' => !empty($properties['wiki_no_article']),
        'einwohner' => (string) ($properties['einwohner'] ?? ''),
        'lage' => (string) ($properties['lage'] ?? ''),
        'oberhaupt' => (string) ($properties['oberhaupt'] ?? ''),
        // 🔴 Die FELDHERKUNFT, aus demselben Grund wie die vier darueber: der Kartendialog baut
        // seinen Marker-Eintrag aus genau dieser Antwort neu. Fehlte sie, zeigte der Dialog nach dem
        // Speichern „Herkunft unbekannt" fuer ein Feld, dessen Herkunft der Server soeben selbst
        // gestempelt hat -- und die Sync-Vorschau daneben haekelte wieder nichts vor.
        'field_origins' => (object) (is_array($properties['field_origins'] ?? null) ? $properties['field_origins'] : []),
        'lat' => $lat,
        'lng' => $lng,
        'revision' => $revision,
    ];
}

function avesmapsBuildPowerlineFeatureResponse(string $publicId, string $name, array $geometry, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['name'] = $name;
    $properties['feature_type'] = 'powerline';
    $properties['feature_subtype'] = 'powerline';
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => $geometry,
        'properties' => $properties,
    ];
}

function avesmapsBuildLineStringFeatureResponse(string $publicId, string $name, string $subtype, array $geometry, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['feature_type'] = 'path';
    $properties['feature_subtype'] = $subtype;
    $properties['revision'] = $revision;
    // 🔴 DER DRITTE ZUSTAND STEHT AUSDRUECKLICH DRIN, AUCH ALS `false` -- anders als im
    // properties_json, wo ein `false` nie abgelegt wird.
    // 💣 Der Grund ist der Leser: applyPathFeatureResponse (js/map-features/map-features-path-
    // lifecycle.js) MISCHT die Antwort in die vorhandenen Eigenschaften (`{...alt, ...neu}`). Ein
    // WEGGELASSENER Schluessel loescht dort nichts, er laesst den alten stehen -- ein gerade
    // abgewaehltes Haekchen saehe beim naechsten Oeffnen des Dialogs wieder gesetzt aus, obwohl der
    // Server es geloescht hat, und der Editor haette keine Erklaerung dafuer. Dieselbe Pflicht und
    // derselbe Grund wie bei avesmapsBuildPointFeatureResponse.
    $properties['wiki_no_article'] = !empty($properties['wiki_no_article']);

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => $geometry,
        'properties' => $properties + [
            'name' => $name,
        ],
    ];
}

function avesmapsBuildLabelFeatureResponse(string $publicId, string $text, string $subtype, float $lat, float $lng, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['name'] = $text;
    $properties['text'] = $text;
    $properties['feature_type'] = 'label';
    $properties['feature_subtype'] = $subtype;
    $properties['is_nodix'] = !empty($properties['is_nodix']);
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ],
        'properties' => $properties,
    ];
}

function avesmapsBuildRegionFeatureResponse(string $publicId, string $name, array $geometry, array $properties, int $revision): array {
    $properties['public_id'] = $publicId;
    $properties['type'] = 'region';
    $properties['name'] = $name;
    $properties['feature_type'] = 'region';
    $properties['feature_subtype'] = 'region';
    $properties['revision'] = $revision;

    return [
        'type' => 'Feature',
        'id' => $publicId,
        'geometry' => $geometry,
        'properties' => $properties,
    ];
}

function avesmapsDecodeJsonColumnForEdit(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $value;
    }

    $decoded = json_decode((string) $value, true);
    return is_array($decoded) ? $decoded : [];
}

function avesmapsEncodeAuditJson(array $value): string {
    return avesmapsEncodeJson($value);
}

function avesmapsEncodeJson(mixed $value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function avesmapsUuidV4(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = unpack('H*', $bytes);
    if (!is_array($hex) || !isset($hex[1])) {
        throw new RuntimeException('Die UUID konnte nicht erzeugt werden.');
    }

    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex[1], 0, 8),
        substr($hex[1], 8, 4),
        substr($hex[1], 12, 4),
        substr($hex[1], 16, 4),
        substr($hex[1], 20)
    );
}

function avesmapsRollbackAndRethrow(PDO $pdo, Throwable $exception): never {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    throw $exception;
}
