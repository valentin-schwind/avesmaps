<?php

declare(strict_types=1);

require __DIR__ . '/../../_internal/auth.php';

// Write logic lives in the app-layer library (multi-source system #2); the atomic
// other_source takeover needs avesmapsEncodeJson/avesmapsNextMapRevision from the
// map-features library, so both are required here (dispatcher stays thin).
require_once __DIR__ . '/../../_internal/map/features.php';
require_once __DIR__ . '/../../_internal/app/feature-sources.php';
// Publication-link normalization (avesmapsResolvePublicationIdentityFromUrl): lets an `add` merge a
// community/editor link to a publication's wiki article with the wiki-reconciled source (same
// source_id). Side-effect-free on include; it lazy-loads its own slug chain only for wiki-aventurica URLs.
require_once __DIR__ . '/../../_internal/wiki/publication-sync.php';
// Step 6: a source carrying an adventure's wiki key connects its place to that adventure on add and
// disconnects it again on remove. Loaded here so the guarded calls in the app library find it; the
// library stays usable without it (the calls are function_exists-gated).
require_once __DIR__ . '/../../_internal/app/game-literature.php';
// Die Adressauskunft der Eingabezeile (Korpus + Katalogtreffer + optionaler Abruf). Sie zieht
// source-corpus.php und den Linkchecker nach; beide sind beim Einbinden nebenwirkungsfrei.
require_once __DIR__ . '/../../_internal/app/source-inspect.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Quellen nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? ''), 40);

    $entityType = trim((string) ($payload['entity_type'] ?? ''));
    $entityPublicId = trim((string) ($payload['entity_public_id'] ?? ''));
    // citymap joined in with the Kartensammlung (Spec §3.2): maps hang on the SAME shared source
    // catalogue as every other element, so "Ulisses F-Shop" exists once rather than once per map.
    // lore joined the same way (2026-07-22), undoing the one time this rule was ignored: "Natur &
    // Waren" had shipped its own lore_source table, which duplicated a publication title into every
    // one of ~35.000 rows and cost the editor add/remove/autocomplete. Its entity_public_id is
    // lore_entry.wiki_key -- lore has no public_id, and the wiki_key IS its public identity.
    //
    // `ecosystem` joined 2026-07-28 (plan V4a) and is exactly the two-line change AGENTS.md §5
    // describes: a landscape region needs sources like any other element, so it gets a name in this
    // list -- NOT a table of its own. Its entity_public_id is ecosystem_region.public_id (a UUID).
    // 🔴 Deliberately NOT reusing `region`: that one means a map_features REGION LABEL. A landscape
    // region is a row in ecosystem_region, a different table with different ids -- sharing the key
    // would silently join sources across two unrelated things.
    $allowedTypes = ['settlement', 'region', 'path', 'territory', 'citymap', 'lore', 'powerline', 'ecosystem'];

    if (!in_array($entityType, $allowedTypes, true)) {
        avesmapsErrorResponse(400, 'invalid_request', 'entity_type muss settlement, region, path, territory, citymap, lore, powerline oder ecosystem sein.');
    }
    if ($entityPublicId === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'entity_public_id ist erforderlich.');
    }

    $userId = (int) ($user['id'] ?? 0);
    $pdo = avesmapsCreatePdo($config['database'] ?? []);

    $result = match ($action) {
        'list' => avesmapsListFeatureSourcesForEdit($pdo, $entityType, $entityPublicId, $userId),
        'add' => (static function () use ($pdo, $entityType, $entityPublicId, $payload, $userId): array {
            $url = trim((string) ($payload['url'] ?? ''));
            if ($url === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'url ist erforderlich.');
            }
            $label = (string) ($payload['label'] ?? '');
            // '' heisst „keine Aussage" -- beim Anlegen wird daraus 'sonstiges', eine bekannte
            // Quelle bleibt unberuehrt (avesmapsNormalizeSourceType).
            $type = (string) ($payload['source_type'] ?? '');
            // 🔴 „Der Benutzer hat die Art AUSDRUECKLICH gewaehlt" -- ein eigener Schluessel, kein
            // Rueckschluss aus dem Wert. Ein alter, noch zwischengespeicherter Client schickt die
            // vorausgewaehlte erste Art ('regionalspielhilfe') mit, ohne dass jemand sie gewaehlt hat;
            // wer aus „Wert vorhanden" auf „gewaehlt" schloesse, liesse ausgerechnet diesen Client
            // fremde Katalogzeilen umschreiben. Er kennt den Schluessel nicht und aendert nichts.
            $artGewaehlt = ($payload['source_type_chosen'] ?? false) === true;
            $official = (bool) ($payload['is_official'] ?? false);
            $pages = trim((string) ($payload['pages'] ?? ''));
            $referenceKind = trim((string) ($payload['reference_kind'] ?? ''));
            // Lizenz und Namensnennung der QUELLE (nicht dieser Verknuepfung) -- der Schluessel
            // wird in avesmapsFeatureSourceUpsert gegen AVESMAPS_SOURCE_LICENSES geprueft, ein
            // unbekannter faellt dort auf '' und nicht auf einen geratenen.
            $license = trim((string) ($payload['license'] ?? ''));
            $attribution = trim((string) ($payload['attribution'] ?? ''));
            return avesmapsAddFeatureSource($pdo, $entityType, $entityPublicId, $url, $label, $type, $official, $userId, $pages, $referenceKind, $license, $attribution, $artGewaehlt);
        })(),
        // Instruction 5a: the editor picked an existing catalog row from the typeahead. Separate
        // from 'add' because that action requires a url -- and the rows most worth reusing (wiki
        // publications) may not have one.
        'add_existing' => (static function () use ($pdo, $entityType, $entityPublicId, $payload, $userId): array {
            $sourceId = (int) ($payload['source_id'] ?? 0);
            if ($sourceId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'source_id ist erforderlich.');
            }
            $pages = trim((string) ($payload['pages'] ?? ''));
            $referenceKind = trim((string) ($payload['reference_kind'] ?? ''));
            // Dieselbe Erlaubnis wie beim Anlegen: nur eine ausdrueckliche Wahl stellt die Art
            // einer bestehenden Katalogzeile richtig, alles andere verknuepft nur.
            $type = ($payload['source_type_chosen'] ?? false) === true
                ? (string) ($payload['source_type'] ?? '')
                : '';
            return avesmapsLinkExistingFeatureSource($pdo, $entityType, $entityPublicId, $sourceId, $userId, $pages, $referenceKind, $type);
        })(),
        // Eine bestehende Zeile aendern. Bis zum 01.09.2026 gab es diesen Weg NICHT -- eine Quelle
        // liess sich nur anlegen und entfernen, und ein falscher Titel war damit unkorrigierbar
        // (Owner-Meldung). Entwurf: docs/quellen-bearbeiten-mockup.html.
        //
        // 🔴 `fields` traegt NUR, was jemand angefasst hat -- dieselbe Regel wie beim Sammel-
        // Speichern der Weg-Ebene. Ein vollstaendig mitgeschicktes Formular wuerde jede gewollte
        // Ausnahme platt machen, und bei einer Katalogzeile gleich an bis zu 1.549 Objekten.
        'update' => (static function () use ($pdo, $entityType, $entityPublicId, $payload, $userId): array {
            $sourceId = (int) ($payload['source_id'] ?? 0);
            if ($sourceId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'source_id ist erforderlich.');
            }
            $fields = $payload['fields'] ?? null;
            if (!is_array($fields)) {
                avesmapsErrorResponse(400, 'invalid_request', 'fields muss ein Objekt der geaenderten Felder sein.');
            }
            // 🔴 Die Bestaetigung ist ein EIGENER Schluessel, kein Rueckschluss -- dieselbe Form wie
            // `source_type_chosen` daneben und aus demselben Grund: ein alter Client, der ihn nicht
            // kennt, darf eine katalogweit zitierte Zeile nicht unbemerkt umschreiben.
            $confirm = ($payload['confirm_catalog'] ?? false) === true;
            $ergebnis = avesmapsUpdateFeatureSource($pdo, $entityType, $entityPublicId, $sourceId, $fields, $userId, $confirm);
            // Die Bibliothek gibt ihren Fehler ZURUECK, statt ihn zu senden -- nur so ist sie ohne
            // HTTP pruefbar. Der Endpunkt macht daraus die Antwort und behaelt dabei den genauen
            // Code (`catalog_confirm_required`, `wiki_owned_field`), an dem der Client die
            // Rueckfrage von einem echten Fehler unterscheidet.
            if (($ergebnis['ok'] ?? true) !== true) {
                $fehler = is_array($ergebnis['error'] ?? null) ? $ergebnis['error'] : [];
                avesmapsErrorResponse(
                    (int) ($fehler['status'] ?? 400),
                    (string) ($fehler['code'] ?? 'invalid_request'),
                    (string) ($fehler['message'] ?? 'Die Quelle konnte nicht geaendert werden.'),
                    array_diff_key($ergebnis, ['ok' => 1, 'error' => 1])
                );
            }

            return $ergebnis;
        })(),
        // „Was ist das fuer eine Adresse?" -- die Auskunft, die die Eingabezeile beim Einfuegen holt:
        // steht die Seite schon im Katalog, zu welchem Korpus gehoert sie, und wie heisst sie.
        // Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §3.4 + §4.
        //
        // 🔴 LESEND. Diese Aktion legt nichts an und aendert nichts -- sie beantwortet eine Frage,
        // die der Editor stellt, BEVOR er auf „Hinzufuegen" drueckt. Wer hier je etwas schreibt,
        // macht aus dem Tippen im Adressfeld einen Schreibvorgang.
        //
        // ⚠️ `fetch` ist ausdruecklich, nicht abgeleitet: die Oberflaeche fragt beim TIPPEN nur
        // lokal (Katalog + Korpus, kostet nichts) und erst beim Einfuegen oder auf Knopfdruck nach
        // draussen. Ein Formular, das bei jedem Tastendruck einen fremden Server anruft, ist
        // kaputt, sobald der langsam ist.
        'inspect_url' => (static function () use ($pdo, $payload): array {
            $url = trim((string) ($payload['url'] ?? ''));
            if ($url === '') {
                avesmapsErrorResponse(400, 'invalid_request', 'url ist erforderlich.');
            }
            $fetch = ($payload['fetch'] ?? false) === true;

            return ['ok' => true, 'inspect' => avesmapsSourceInspectUrl($pdo, $url, $fetch)];
        })(),
        'remove' => (static function () use ($pdo, $entityType, $entityPublicId, $payload, $userId): array {
            $sourceId = (int) ($payload['source_id'] ?? 0);
            if ($sourceId <= 0) {
                avesmapsErrorResponse(400, 'invalid_request', 'source_id ist erforderlich.');
            }
            return avesmapsRemoveFeatureSource($pdo, $entityType, $entityPublicId, $sourceId, $userId);
        })(),
        default => throw new InvalidArgumentException('Die Aktion ist unbekannt.'),
    };

    avesmapsJsonResponse(200, $result);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException) {
    avesmapsErrorResponse(500, 'server_error', 'Die Quellen konnten nicht gespeichert werden.');
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Quellen konnten nicht verarbeitet werden.');
}
