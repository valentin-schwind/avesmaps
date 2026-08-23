<?php

declare(strict_types=1);

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/wiki/sync.php';
require_once __DIR__ . '/../_internal/coat-url.php';
require_once __DIR__ . '/../_internal/app/coat-display.php';
// Fuer avesmapsMediaLicenseIsPublic() -- der EINE Lizenzkatalog (Phase 1). coat-display.php zieht sie
// bereits mit, aber ein Gate auf diesem Pfad darf nicht vom Include eines Nachbarn abhaengen.
require_once __DIR__ . '/../_internal/media-license.php';
// Named explicitly for avesmapsMapFeaturesSettlementImagesEnabled below: coat-display.php happens to pull
// it in too, but a kill switch on this path must not depend on a neighbour's include staying put.
require_once __DIR__ . '/../_internal/app/app-setting.php';
require_once __DIR__ . '/../_internal/app/in-settlement-search.php';
// Which label belongs to which landscape region. ONE definition of that relation, shared with
// api/app/ecosystem-areas.php -- it is stored twice (once per direction) and neither side alone is
// complete, so a second copy of the rule here would be the second truth. Pure functions + one reader;
// nothing runs on include, and it returns the empty relation when the ecosystem tables are absent.
require_once __DIR__ . '/../_internal/app/ecosystem-label-link.php';
require_once __DIR__ . '/../_internal/app/curve-label-store.php';
// "In welcher Klimazone liegt das?" for the two shapes that travel in this payload: a place (a point,
// so exactly one zone) and a landscape label (an area, so shares). A way answers the same question
// through api/app/path-landscapes.php -- 5.765 ways x their stretches do not belong in here.
require_once __DIR__ . '/../_internal/app/climate-membership.php';
// For avesmapsFeatureSourceLiveEntityClause only. 💣 Required rather than copied: the rule for
// "which entity types are soft-deleted, and what collation the compare needs" must exist ONCE.
// It was copied-by-omission on 2026-08-05 -- the fix landed on the per-entity reader, which has
// had no caller since sources started travelling in this payload, while the leak sat here.
// Checked before adding: the library is function definitions plus one const, no top-level code,
// and its 20 function names do not collide with the 24 in this file.
require_once __DIR__ . '/../_internal/app/feature-sources.php';

// Bump when the SHAPE of the map-features payload changes (a property added/renamed/removed) WITHOUT a
// map_revision change. The ETag is revision-based, so cached clients would otherwise keep a stale body
// via 304 and never see the new field -- exactly what happened when `political` was added. Incrementing
// this changes every ETag and forces a one-time revalidation miss + reload. See AGENTS.md §7.
// MUST be declared BEFORE the try block below: the request handler calls avesmapsMapFeaturesETag while
// running top-to-bottom, and a top-level const is sequential (defined when reached), not hoisted like a
// function -- declaring it further down (among the helper functions) left it undefined at call time -> 500.
// 7: breadcrumb coat_url carries ?v=<mtime> for locally re-uploaded coats. A VALUE change rather than a
//    shape change, but with the same consequence -- without a bump, a 304'd client keeps the unversioned
//    URL and still shows the previous coat.
// 8: the "Liegt in" resolver LEFT-JOINs political_territory_wiki now, so a settlement under a wiki-unlinked
//    territory (no wiki row, e.g. Festum) still gets a political line via the intact parent_id backbone --
//    new `political` objects appear on features that previously had none, so cached clients must revalidate.
// 9: every label that belongs to a landscape region now carries properties.ecosystem_region_public_id,
//    resolved server-side from BOTH stored directions (10 labels carried it before, ~137 do now). The
//    read mode depends on it -- a landscape label must not be hidden by the collision resolver, and only
//    this field says which labels those are. Without a bump, a warm client keeps the old body and its
//    landscape labels keep vanishing.
// 10: places carry properties.climate_zone and landscape labels properties.climate_zones, plus the
//    payload-level `climate_zones` vocabulary the client renders the names from. New fields on features
//    that had none -- a warm client would otherwise keep the old body and never show the row.
// 11: jedes Label einer Landschaftsflaeche traegt zusaetzlich properties.ecosystem_region_kind.
//    Ohne Bump zeigte ein warmer Client beim Umschalten auf eine einzelne Ebene GAR KEINE
//    Beschriftung -- er kennt das Feld nicht und haelt jede fuer ebenenfremd.
// 12: Lizenzumbau Phase 3 (16.08.2026, Aufgaben 1/2b): das Siedlungs-Wappen-Gate (properties.coat) und
//    das Siedlungsbilder-Gate (properties.images) lassen jetzt alle fuenf oeffentlichen Katalogwerte
//    durch statt vorher nur eines bzw. dreier (avesmapsSettlementCoatIsPublic()/
//    avesmapsMapFeaturesPublicImageUrls(), coat-display.php) -- KEINE Formaenderung, sondern ein WERT-
//    wechsel: der Phase-4-Dialog ist bereits live, ein Editor kann 'permission_granted'/'own_work'
//    laengst gesetzt haben. Ohne Bump haelt ein warmer Client seinen 304 und zeigt weiterhin das
//    verschwundene Wappen/Bild nicht, obwohl der Bestand es seit Phase 3 zulaesst (dieselbe Begruendung
//    wie Version 4/8/9/10/11 oben und api/_internal/app/ecosystem-areas.php:39).
// 13 (2026-08-22): ein Label, dessen Region die Kurvenbeschriftung eingeschaltet hat, traegt
//    properties.curve_label_line (die Beschriftungskurve in Kartenkoordinaten, 32 Punkte) und
//    properties.curve_label_max. 💣 Der Bump ist nicht Kosmetik: der ETag ist revisionsbasiert,
//    also behielte ein warmer Client den alten Rumpf ueber 304 und saehe nie eine Kurve --
//    waehrend der Server sie laengst liefert.
const AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION = 14;

// 🔴 Fix-Runde 6 (15.08.2026): the coat-of-arms staging/model table constants AND the two loader/gate
// functions that used to sit here (avesmapsLoadSettlementCoatGateInputs, avesmapsSettlementTerritoryCoatUrl)
// moved to api/_internal/coat-url.php (already required above), renamed AVESMAPS_COAT_GATE_STAGING_TABLE /
// AVESMAPS_COAT_GATE_MODEL_TABLE -- so the what-is-here "Liegt in" chain can share the exact same
// implementation instead of a second one. Call sites below are unchanged (same function names).

// Die entity_type, die die KARTE aufloest. renderFeatureSourceLine wird ausschliesslich mit
// diesen fuenf aufgerufen (map-features-labels.js, -location-marker-entry.js, -path-rendering.js,
// -powerlines.js, -region-info-markup.js, popups.js) -- alles andere laege im Payload, ohne dass
// es je jemand nachschlaegt. Gelesen von avesmapsLoadFeatureSourceRefs (weiter unten).
//
// 💣 STEHT HIER OBEN, NICHT BEI DER FUNKTION. PHP hoistet Funktionsdefinitionen, aber KEINE
// const auf Dateiebene: eine Konstante entsteht erst, wenn die Zeile ausgefuehrt wird. Der
// try-Block darunter laeuft aber vorher durch und endet in avesmapsMapFeaturesRespond() + exit,
// sodass eine weiter unten stehende Zeile nie erreicht wird. Genau das hat den Endpunkt am
// 2026-07-28 mit HTTP 500 lahmgelegt -- `php -l` findet es nicht, es ist kein Syntaxfehler.
//
// 'lore' gehoert NICHT dazu, und das ist der teure Teil: Vorkommen (Flora/Fauna/Waren) sind
// keine Kartenobjekte, sie haben ihren eigenen, seitenweise ladenden Endpunkt (api/app/lore.php,
// 200 von ~35.000 Zeilen). Ihre Quellen machten dennoch 3,03 MB von 8,2 MB dieses Blocks aus --
// 33.981 Referenzen ueber 5.087 Eintraege, allein "lore:ork" 19 KB. Wer hier einen Typ ergaenzt,
// muss ihn auf der JS-Seite auch wirklich aufloesen.
//
// 'citymap' bleibt bewusst drin: 631 Referenzen / 0,04 MB, und der Karteneditor schreibt in
// denselben Cache (review-feature-sources.js) -- der Gewinn waere Rauschen, das Risiko nicht.
const AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES = ['settlement', 'region', 'path', 'territory', 'powerline', 'citymap'];

/**
 * Die Innerorts-Liste fuer den Payload (Name + Stadt je Objekt). Faellt sie aus -- fehlende
 * Spalte, Sync nie gelaufen --, liefert sie eine leere Liste: die Karte selbst darf daran
 * NIE scheitern, sie ist die Hauptsache und das hier eine Zutat.
 *
 * @return list<array{name:string, settlement:string, type:string}>
 */
function avesmapsMapFeaturesInSettlementPlaces(PDO $pdo): array {
    try {
        $registryRows = avesmapsFetchInSettlementSearchRows($pdo);
        if ($registryRows === []) {
            return [];
        }

        return avesmapsBuildInSettlementPlaceList($registryRows, avesmapsPlaceScopeLoadIndex($pdo));
    } catch (Throwable) {
        return [];
    }
}

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf keine Kartendaten laden.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    if ($requestMethod !== 'GET') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur GET-Anfragen sind fuer Kartendaten erlaubt.');
    }

    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $revision = avesmapsFetchMapRevision($pdo);

    // HTTP-Caching (#2): ETag aus Revision + payload-bestimmenden Query-Params (bbox/since_revision).
    // Bei unveraenderten Daten antwortet der Server mit 304 -> der Client nutzt seine Kopie; die teure
    // Query UND der 14-MB-Transfer entfallen komplett. Cache-Control: no-cache = jedes Mal revalidieren,
    // aber 304 statt Vollantwort, solange die Revision gleich bleibt.
    $etag = avesmapsMapFeaturesETag($revision, $_GET, avesmapsClimateReadStamp($pdo));
    header('ETag: ' . $etag);
    header('Cache-Control: no-cache, must-revalidate');
    header('Vary: Accept-Encoding', false);
    $ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
    if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
        http_response_code(304);
        exit;
    }

    $wikiLocationLinks = avesmapsLoadWikiSyncLocationLinks($pdo);
    $buildingTypes = avesmapsLoadWikiSyncBuildingTypes($pdo);
    // Settlement -> political context: resolve each place's STORED ray-cast territory assignment
    // (properties.territory_wiki_key/territory_public_id, written by the Siedlungseditor) into a
    // ready-to-render political line for the infobox. Loaded ONCE (one small join over the territory
    // tables), resolved in memory per settlement -> no N+1, no lazy client fetch. See
    // avesmapsLoadSettlementPoliticalContext.
    // Global "Wappen: An/Aus" switches (ribbon toggles in the two editors). OFF replaces every coat URL
    // with the placeholder; edit mode keeps the real ones so an editor still sees what they edit. Read
    // once here (fail-open), then handed to the two places that emit a coat: the settlement breadcrumb
    // (territory switch) and properties.coat on the settlement itself (settlement switch).
    $mapFeaturesEditMode = trim((string) ($_GET['edit_mode'] ?? '')) === '1';
    $territoryCoatsEnabled = $mapFeaturesEditMode
        || avesmapsCoatSwitchEnabledFast($pdo, AVESMAPS_TERRITORY_COATS_SETTING);
    $settlementCoatsEnabled = $mapFeaturesEditMode
        || avesmapsCoatSwitchEnabledFast($pdo, AVESMAPS_SETTLEMENT_COATS_SETTING);
    $politicalContext = avesmapsLoadSettlementPoliticalContext($pdo, $territoryCoatsEnabled);
    // Global settlement-image kill switch (ribbon toggle in the Siedlungseditor): when OFF, no settlement
    // images reach the frontend at all. Read ONCE here (fail-open) and passed into the feature builder.
    $settlementImagesEnabled = avesmapsMapFeaturesSettlementImagesEnabled($pdo);
    // Multi-source system: load the approved source catalog + per-entity references ONCE (two
    // collect-queries, no N+1) so the map renders every element's sources synchronously from this
    // payload -- no lazy per-popup fetch. The catalog is shared/deduped (one entry per source);
    // refs point into it by source_id and cover all four entity types (settlement/region/path/
    // territory), including territory which has no map_features row.
    $sourceCatalog = avesmapsLoadFeatureSourceCatalog($pdo);
    $featureSourceRefs = avesmapsLoadFeatureSourceRefs($pdo);
    $query = avesmapsBuildMapFeaturesQuery($_GET);
    $statement = $pdo->prepare($query['sql']);
    $statement->execute($query['params']);
    $rows = $statement->fetchAll();

    // Fix #2 parity: fold each element's un-taken-over properties.other_source ("Andere Quelle") into
    // the shared catalog + refs, so a legacy source that was never opened in the editor (and so never
    // migrated into feature_sources) still renders. Mutates $sourceCatalog/$featureSourceRefs in place
    // before serialization -- restoring the parity the removed lazy per-popup read (avesmapsReadFeatureSources)
    // used to provide, without touching any JS.
    avesmapsMapFeaturesMergeLegacyOtherSources($rows, $sourceCatalog, $featureSourceRefs);

    $features = array_map(
        static fn(array $row): array => avesmapsMapFeatureRowToGeoJsonFeature($row, $wikiLocationLinks, $buildingTypes, $politicalContext, $settlementImagesEnabled, $settlementCoatsEnabled),
        $rows
    );
    // Landscape membership: fill properties.ecosystem_region_public_id on every label that belongs to a
    // region, resolved from BOTH stored directions. Applied here rather than inside the row builder
    // because it needs a relation the builder has no business knowing about -- same shape as the
    // legacy-other-source merge above.
    $labelRegions = avesmapsEcosystemReadLabelRegionMap($pdo);
    avesmapsEcosystemApplyLabelRegionsToFeatures($features, $labelRegions['by_label'], $labelRegions['kind_by_region'] ?? []);
    // Die Beschriftungskurve. 🔴 STRIKT NACH der Zeile darueber: sie haengt an
    // properties.ecosystem_region_public_id, und fuer ~137 Labels ist das genau der Zeiger, den die
    // Zeile darueber gerade aufgeloest hat. Vertauscht verlieren diese Labels ihre Kurve wortlos --
    // dieselbe Reihenfolgefalle wie bei der Klimazone eine Zeile weiter unten.
    // ⚠️ Der Leser RECHNET NICHT, er liest den Zwischenspeicher (api/_internal/app/curve-label-store.php).
    avesmapsCurveApplyToFeatures($features, avesmapsCurveReadBaselines($pdo));
    // Climate zone, one infobox row down the line. 🔴 STRICTLY AFTER the line above: a landscape label
    // finds its shares through properties.ecosystem_region_public_id, and for ~137 of them that pointer
    // is what the line above just resolved. Swap the two and those labels silently lose the row.
    $climateBands = avesmapsClimateReadBands($pdo);
    avesmapsClimateApplyToFeatures($features, $climateBands, avesmapsClimateReadRegionZones($pdo));

    // Kompression (#1): diese Antwort wird vom Server nicht komprimiert (gemessen: content-encoding none)
    // -> hier explizit gzip, wenn der Client es akzeptiert. ~14 MB JSON -> ~1,5-2,5 MB.
    avesmapsMapFeaturesRespond([
        'ok' => true,
        'revision' => $revision,
        'type' => 'FeatureCollection',
        'features' => $features,
        // 🔴 DIE DREI REISETAGE, damit der Planer sie nicht ein zweites Mal behaupten muss. Land 8
        // (WdE S. 160-162), Fluss/See 12 und Schnellsegler 24 (GA S. 129/131) sind der NENNER der
        // Tempotabelle; das Fenster „Tempowerte" kann sie verstellen, und ohne diese Leitung stuende
        // die Einstellung in der Datenbank, waehrend `#travelHoursPerDay` weiter seine 8 aus dem
        // Markup nimmt. Der Router raste dann nach 8 Stunden, obwohl er mit 10 rechnet -- die
        // Tagesleistung faellt auf 80 %, und keine einzige Zahl sieht dabei falsch aus.
        // ⚠️ EIN app_setting-Lesevorgang je Anfrage, wie der Bild-Notaus daneben. Der Wert wandert
        // NICHT in map_revision (er aendert kein Kartenobjekt); wer im Fenster speichert, sieht ihn
        // beim naechsten vollen Laden.
        'travel_hours' => (object) avesmapsMapFeaturesTravelHours($pdo),
        // (object) casts force JSON objects (maps) even when empty (`{}` not `[]`); the nested
        // ref lists stay JSON arrays. Keys: catalog by source_id, refs by "<entity_type>:<public_id>".
        'source_catalog' => (object) $sourceCatalog,
        'feature_sources' => (object) $featureSourceRefs,
        // Objekte, die IN einer Stadt liegen (Villen, Plaetze, Stadttempel, Gassen) -- je Eintrag
        // nur Name + Stadt. Sie haben keine eigene Kartenposition und sind deshalb KEINE features;
        // der Routenplaner-Autocomplete schlaegt sie trotzdem vor und setzt die STADT als Ziel.
        // Reist EINMAL mit den Kartendaten statt je Tastendruck abgefragt zu werden -- genau das
        // haelt das Tippen so schnell wie bisher.
        'in_settlement_places' => avesmapsMapFeaturesInSettlementPlaces($pdo),
        // The seven zone names, north to south, ONCE. A feature carries only the key -- shipping
        // "Winterfeuchte Subtropen" on each of 4.650 places would repeat seven strings 4.650 times.
        // Empty while the layer is unseeded, and then no feature carries a key either.
        'climate_zones' => avesmapsClimateVocabulary($climateBands),
    ]);
} catch (InvalidArgumentException $exception) {
    avesmapsErrorResponse(400, 'invalid_request', $exception->getMessage());
} catch (PDOException $exception) {
    avesmapsErrorResponse(500, 'server_error', 'Die Kartendaten konnten nicht aus der Datenbank geladen werden.');
} catch (RuntimeException $exception) {
    avesmapsErrorResponse(503, 'service_unavailable', $exception->getMessage());
} catch (Throwable) {
    avesmapsErrorResponse(500, 'server_error', 'Die Kartendaten konnten nicht verarbeitet werden.');
}

function avesmapsBuildMapFeaturesQuery(array $queryParams): array {
    $params = [];

    $sinceRevision = avesmapsParseOptionalPositiveInt($queryParams['since_revision'] ?? null, 'since_revision');
    $whereClauses = $sinceRevision === null ? ['is_active = 1'] : [];
    if ($sinceRevision !== null) {
        $whereClauses[] = 'revision > :since_revision';
        $params['since_revision'] = $sinceRevision;
    }

    $bbox = avesmapsParseOptionalBoundingBox((string) ($queryParams['bbox'] ?? ''));
    if ($bbox !== null) {
        $whereClauses[] = 'max_x >= :bbox_min_x';
        $whereClauses[] = 'min_x <= :bbox_max_x';
        $whereClauses[] = 'max_y >= :bbox_min_y';
        $whereClauses[] = 'min_y <= :bbox_max_y';
        $params['bbox_min_x'] = $bbox['min_x'];
        $params['bbox_min_y'] = $bbox['min_y'];
        $params['bbox_max_x'] = $bbox['max_x'];
        $params['bbox_max_y'] = $bbox['max_y'];
    }

    return [
        'sql' => 'SELECT
            public_id,
            feature_type,
            feature_subtype,
            name,
            geometry_type,
            geometry_json,
            properties_json,
            style_json,
            is_active,
            revision,
            updated_at
        FROM map_features
        WHERE ' . implode(' AND ', $whereClauses) . '
        ORDER BY sort_order ASC, id ASC',
        'params' => $params,
    ];
}

function avesmapsParseOptionalPositiveInt(mixed $value, string $fieldName): ?int {
    if ($value === null || $value === '') {
        return null;
    }

    $parsedValue = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsedValue === false || $parsedValue < 0) {
        throw new InvalidArgumentException("Der Parameter {$fieldName} ist ungueltig.");
    }

    return (int) $parsedValue;
}

function avesmapsParseOptionalBoundingBox(string $rawBoundingBox): ?array {
    $normalizedBoundingBox = trim($rawBoundingBox);
    if ($normalizedBoundingBox === '') {
        return null;
    }

    $parts = array_map('trim', explode(',', $normalizedBoundingBox));
    if (count($parts) !== 4) {
        throw new InvalidArgumentException('Der Parameter bbox muss min_x,min_y,max_x,max_y enthalten.');
    }

    $coordinates = array_map(
        static function (string $value): float {
            $parsedValue = filter_var(str_replace(',', '.', $value), FILTER_VALIDATE_FLOAT);
            if ($parsedValue === false) {
                throw new InvalidArgumentException('Der Parameter bbox enthaelt ungueltige Koordinaten.');
            }

            return (float) $parsedValue;
        },
        $parts
    );

    [$minX, $minY, $maxX, $maxY] = $coordinates;
    if ($minX > $maxX || $minY > $maxY) {
        throw new InvalidArgumentException('Der Parameter bbox enthaelt vertauschte Grenzen.');
    }

    return [
        'min_x' => $minX,
        'min_y' => $minY,
        'max_x' => $maxX,
        'max_y' => $maxY,
    ];
}

function avesmapsFetchMapRevision(PDO $pdo): int {
    $statement = $pdo->query('SELECT revision FROM map_revision WHERE id = 1');
    $revision = $statement !== false ? $statement->fetchColumn() : false;
    if ($revision === false) {
        return 0;
    }

    return (int) $revision;
}

// Schwacher ETag aus Revision + payload-bestimmenden Query-Parametern. Schwach (W/), weil gzip- und
// Identity-Variante semantisch dieselbe Ressource sind. Stabil pro Revision -> 304 bei Reloads.
// edit_mode is part of the seed because the two variants differ in CONTENT and coexist at the SAME
// revision: with "Wappen: Aus" the public payload carries placeholder coat URLs while an edit-mode
// request carries the real ones. Without it, a browser that cached one would be handed a 304 for the
// other. The switch STATE needs no seed of its own -- flipping it bumps map_revision (see
// api/edit/wiki/sync-monitor.php), exactly like the settlement-image switch.
// 💣 $climateStamp IS NOT DECORATION. Places carry their climate zone since payload version 10, and that
// zone changes when a divider is dragged or "Zugehörigkeit rechnen" runs again -- NEITHER of which touches
// map_revision. Without this seed a warm client keeps its 304 and goes on showing the previous zone, with
// nothing in the payload to say why. Same trap the klima layer already paid for once (its seed had to move
// out of EnsureTables because DDL does not raise a revision either). See avesmapsClimateReadStamp.
function avesmapsMapFeaturesETag(int $revision, array $queryParams, string $climateStamp = ''): string {
    // Appended ONLY in edit mode, so the public seed stays byte-identical to what it was before this
    // switch existed -- otherwise every visitor would re-download the whole payload once after the deploy
    // for a marker that changes nothing for them.
    $seed = (string) ($queryParams['since_revision'] ?? '') . '|' . (string) ($queryParams['bbox'] ?? '')
        . (trim((string) ($queryParams['edit_mode'] ?? '')) === '1' ? '|e=1' : '')
        . '|c=' . $climateStamp;
    return 'W/"mf-' . AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION . '-' . $revision . '-' . substr(hash('sha1', $seed), 0, 10) . '"';
}

// avesmapsETagMatches ist nach api/_internal/bootstrap.php gewandert -- api/locations/ braucht
// ihn ebenfalls und kann diese Datei nicht einbinden, ohne die ganze Kartenantwort auszufuehren.

// Gibt die GeoJSON-Antwort aus, gzip-komprimiert wenn der Client es akzeptiert (sonst identity).
// Content-Length passend zur tatsaechlich gesendeten (ggf. komprimierten) Groesse.
function avesmapsMapFeaturesRespond(array $payload): never {
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');

    $acceptsGzip = stripos((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip') !== false;
    if ($acceptsGzip && function_exists('gzencode')) {
        $compressed = gzencode($json, 6);
        if ($compressed !== false) {
            header('Content-Encoding: gzip');
            header('Content-Length: ' . strlen($compressed));
            echo $compressed;
            exit;
        }
    }

    header('Content-Length: ' . strlen($json));
    echo $json;
    exit;
}

// Reads the global settlement-image kill switch (app_setting 'settlement_images_enabled', default ON).
// Fail-open: a missing table / read error keeps images enabled (current behaviour). No DDL here -- the
// hot map-features path must not run DDL; the editor endpoint creates the row. See settlements.php.
//
// The SELECT itself is avesmapsAppSettingGetWithoutDdl(); '1' is this switch's own default, so a missing
// table and a missing row both come back ENABLED. The catch stays Throwable rather than the helper's
// narrower PDOException: failing open on a hot public read is the whole point of this function, and an
// unforeseen error here would otherwise take the entire map payload down with it.
function avesmapsMapFeaturesSettlementImagesEnabled(PDO $pdo): bool {
    try {
        return avesmapsAppSettingGetWithoutDdl($pdo, 'settlement_images_enabled', '1') !== '0';
    } catch (Throwable) {
        return true;
    }
}

/**
 * Die drei Reisetage fuer den Planer — Land, Wasser, Nachtfahrt.
 *
 * 🔴 EINE QUELLE, ZWEI LESER. Der Router liest sie ueber avesmapsTravelValuesRead(); der Browser
 * bekommt sie hierdurch. Ohne diese Leitung waere `#travelHoursPerDay` eine zweite Wahrheit -- und
 * eine, die genau dann falsch wird, wenn jemand die Werte im Fenster „Tempowerte" verstellt.
 *
 * ⚠️ Fail-open wie der Bild-Notaus darueber: faellt der Lesevorgang aus, kommen die Konstanten
 * zurueck, und der Planer verhaelt sich wie vor der Einstellbarkeit. Eine fehlende Einstellung darf
 * die Kartennutzlast nicht mitreissen.
 */
function avesmapsMapFeaturesTravelHours(PDO $pdo): array {
    try {
        require_once __DIR__ . '/../_internal/routing/travel-values.php';
        $values = avesmapsTravelValuesRead($pdo);

        return is_array($values['travel_hours'] ?? null)
            ? $values['travel_hours']
            : avesmapsTravelValuesHoursFallback();
    } catch (Throwable) {
        return ['land' => 8.0, 'water' => 12.0, 'night' => 24.0];
    }
}

// avesmapsMapFeaturesPublicImageUrls() zog nach api/_internal/app/coat-display.php um (Phase 3, aus
// demselben Grund wie avesmapsSettlementCoatIsPublic() daneben: diese Datei ist ein Endpunkt und beim
// `require` fuer einen Test nicht seiteneffektfrei ladbar, die Zieldatei schon).

function avesmapsMapFeatureRowToGeoJsonFeature(array $row, array $wikiLocationLinks = [], array $buildingTypes = [], array $politicalContext = [], bool $settlementImagesEnabled = true, bool $settlementCoatsEnabled = true): array {
    if ((int) ($row['is_active'] ?? 1) !== 1) {
        return [
            'type' => 'Feature',
            'id' => (string) $row['public_id'],
            'geometry' => null,
            'properties' => [
                'public_id' => (string) $row['public_id'],
                'deleted' => true,
                'revision' => (int) $row['revision'],
                'updated_at' => (string) $row['updated_at'],
            ],
        ];
    }

    $properties = avesmapsNormalizeLegacyMapFeatureProperties(avesmapsDecodeJsonColumn($row['properties_json'] ?? null));
    $properties = avesmapsEnrichMapFeatureWikiUrl($properties, $row, $wikiLocationLinks);
    $style = avesmapsDecodeJsonColumn($row['style_json'] ?? null);
    foreach ($style as $styleKey => $styleValue) {
        $properties[$styleKey] = $styleValue;
    }

    $properties['public_id'] = (string) $row['public_id'];
    if ((string) $row['name'] !== '') {
        $properties['name'] = (string) $row['name'];
    }
    $properties['feature_type'] = (string) $row['feature_type'];
    $properties['feature_subtype'] = (string) $row['feature_subtype'];
    $properties['revision'] = (int) $row['revision'];
    $properties['updated_at'] = (string) $row['updated_at'];

    // Settlement own-image gate: properties.images carries a per-image licence ([{url,license,note}]).
    // Only public licences reach the frontend, as a plain URL list -- unknown_other is dropped and the
    // licence/note metadata never leaves the editor. (PAYLOAD_VERSION bumped so cached clients revalidate.)
    if (isset($properties['images'])) {
        $publicImages = $settlementImagesEnabled ? avesmapsMapFeaturesPublicImageUrls($properties['images']) : [];
        if ($publicImages !== []) {
            $properties['images'] = $publicImages;
        } else {
            unset($properties['images']);
        }
    }

    // Lizenz-Gate der Siedlungs-Wappen (Phase 3). Dieselbe Regel wie ueberall: cc_by und
    // unknown_other werden gespeichert, aber nicht gezeigt. Entfernt wird der GANZE coat-Schluessel,
    // nicht nur die url -- aus demselben Grund, den der Schalter-Block darunter nennt: das Wappen
    // ERSETZT hier das Ortssymbol, ein leerer Schild naehme also Information weg.
    //
    // 🔴 STRIKT VOR dem Anzeige-Schalter. Beide enden in unset(), das Ergebnis ist also dasselbe --
    // die Reihenfolge traegt die Bedeutung: der Riegel ist rechtlich, der Schalter eine Praeferenz.
    // Dieselbe Ordnung wie in coat-display.php:92-94, und der Test nagelt sie fest.
    if (isset($properties['coat']) && !avesmapsSettlementCoatIsPublic($properties['coat'])) {
        unset($properties['coat']);
    }

    // 🔴 „Wappen: Aus" -- der Platzhalter tritt an die Stelle des Wappens, wie bei den Territorien.
    //
    // 🪤 Hier stand bis zum 23.08.2026 ein ersatzloses unset(), mit der Begruendung: das Wappen
    // ERSETZE bei Siedlungen das Ortssymbol, also komme ohne properties.coat das Ortssymbol
    // zurueck. Im Browser nachgesehen (Punin, Schalter aus): es kommt NICHT zurueck. Ein Ort mit
    // Titelbild bekommt den ganzen Icon-Block gar nicht erst gebaut --
    // `${headerImageMarkup || `<div class="location-popup__header">…`}` in popups.js ist ein
    // ODER, und das Titelbild gewinnt. Im Kopf stand dann weder Wappen noch Symbol, sondern
    // nichts. Owner: „im frontend fehlt das wappen bei orten insgesamt".
    //
    // ⚠️ Die Lizenzangaben reisen NICHT mit dem Platzhalter: den Urheber eines Bildes zu nennen,
    // das wir gerade nicht zeigen, waere falsch (dieselbe Regel wie in territory-detail.php).
    // ⚠️ '' -> '': ein Ort ohne Wappen bekommt keines angehaengt, sonst wachsen Hunderte Schilde
    // an Orten, die nie eines hatten -- das sieht aus wie Datenverlust.
    // ⭐ Ueber avesmapsCoatDisplayUrl, nicht mit einer eigenen Regel: die Funktion IST der
    // Hausentscheid („leer bleibt leer, sonst der Platzhalter"), und coat-display-test.php wacht
    // ueber sie. Eine nachgebaute Kopie hier haette dieselbe Regel ein zweites Mal behauptet.
    if (is_array($properties['coat'] ?? null)) {
        $angezeigt = avesmapsCoatDisplayUrl(
            (string) ($properties['coat']['url'] ?? ''),
            $settlementCoatsEnabled
        );
        if ($angezeigt !== (string) ($properties['coat']['url'] ?? '')) {
            $properties['coat'] = ['url' => $angezeigt, 'source' => (string) ($properties['coat']['source'] ?? '')];
        }
    }

    // Genauer Bauwerkstyp (Festung/Turm/…) + Ruine aus der Registry an die verbundene Wiki-Siedlung
    // heften, damit die Infobox die Unterüberschrift zeigt (deckt auch schon-verbundene Bauwerke ab).
    if ((string) $row['feature_type'] === 'location' && is_array($properties['wiki_settlement'] ?? null)) {
        $wikiTitle = trim((string) ($properties['wiki_settlement']['title'] ?? ''));
        if ($wikiTitle !== '' && isset($buildingTypes[$wikiTitle])) {
            $properties['wiki_settlement']['building_type'] = $buildingTypes[$wikiTitle]['type'];
            $properties['wiki_settlement']['is_ruined'] = $buildingTypes[$wikiTitle]['ruined'];
            $properties['wiki_settlement']['deity'] = $buildingTypes[$wikiTitle]['deity'] ?? '';
        }
    }

    // Political context line (infobox): resolve the stored territory assignment into {kind,name,type,
    // territory_public_id}. The client renders the label ("Hauptstadt des Mittelreichs" / "Baronie
    // Vierok") + the fly-to link. Only for real locations; skipped silently if nothing resolves.
    if ((string) $row['feature_type'] === 'location' && $politicalContext !== []) {
        $political = avesmapsResolveSettlementPolitical((string) $row['name'], $properties, $politicalContext);
        if ($political !== null) {
            $properties['political'] = $political;
        }
    }

    return [
        'type' => 'Feature',
        'id' => (string) $row['public_id'],
        'geometry' => avesmapsDecodeJsonColumn($row['geometry_json'] ?? null),
        'properties' => $properties,
    ];
}

function avesmapsDecodeJsonColumn(mixed $value): array {
    if ($value === null || $value === '') {
        return [];
    }

    if (is_array($value)) {
        return $value;
    }

    try {
        $decodedValue = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return [];
    }

    return is_array($decodedValue) ? $decodedValue : [];
}

function avesmapsNormalizeLegacyMapFeatureProperties(array $properties): array {
    if (
        (string) ($properties['wiki_url'] ?? '') === ''
        && (string) ($properties['data-report-wiki-url'] ?? '') !== ''
    ) {
        $properties['wiki_url'] = trim((string) $properties['data-report-wiki-url']);
    }

    // svg_id ist der WERTGLEICHE Zwilling von id -- bei allen 5421 betroffenen Features
    // identisch, 0,38 MB im Payload. Im Frontend steht er an genau einer Stelle, als letztes
    // Glied der Kette `public_id || feature.id || properties.id || properties.svg_id`
    // (map-features-region-feature-normalization.js) -- und public_id ist bei jedem Feature
    // gesetzt, dieser Zweig also unerreichbar.
    // 💣 `id` bleibt: das liest der ROUTING-Graph als Kantenkennung (route-engine.js,
    // route-graph-routing.js). Nur der Zwilling faellt, nie das Original.
    unset($properties['svg_id']);

    // 🔴 EIN CHOKE-POINT FUER ALLE WIKI-BILDADRESSEN. Owner 23.08.2026: "hoer auf vom wiki sachen
    // zu ziehen, wenn wir sie lokal haben." Drei Nests fuehrten eine wiki-aventurica-Adresse in den
    // Browser, der sie durch /api/app/coat.php reichte -- eine Anfrage je Bild und Seitenaufbau.
    // Live gemessen am 23.08.2026: 325 wiki_region.image_url, 163 wiki_settlement.wappen_url,
    // 46 wiki_path.image_url, zusammen 534.
    //
    // 💣 Ein grosser Teil davon konnte NIE gelingen: die Adresse wird aus einem DATEINAMEN gebaut
    // (avesmapsWikiSyncMonitorCoatOfArmsUrl), auch wenn das Bild von uns stammt und im Wiki nie
    // existiert hat -- die Zwergenreich-Wappen und die Siedlungsbilder sind genau das. Solche
    // Abrufe scheitern, werden deshalb nie gecacht und wiederholen sich bei jedem Seitenaufbau.
    // Genau diese Endlosschleife hat uns die Sperre unserer Ausgangs-IP eingebracht.
    //
    // 💣 HIER, an der EINEN Rueckgabe, und nicht an den drei Fuellstellen: die Nests werden an
    // mehreren Orten zusammengesetzt, und eine Regel, die einen von mehreren Erzeugern bindet,
    // ist keine Regel (die Lehre vom 14.08.2026).
    // ⚠️ Der STAGING-Wert in der Datenbank bleibt unberuehrt -- er ist die Information "das Wiki
    // nennt diese Datei" und wird beim Abgleich gebraucht. Gebunden ist nur die AUSGABE.
    // 🔴 DER DRITTE ZUSTAND: „dieser Ort hat kein Wappen, und das bleibt so" (Owner 23.08.2026).
    // 💣 Es genuegt NICHT, properties.coat zu entfernen -- der Leser faellt sonst auf
    // wiki_settlement.wappen_url zurueck und zeigt doch wieder das Wiki-Wappen. Genau dieser
    // Rueckfall ist der Grund, warum der Schalter „Wappen: Aus" das Problem verschlimmert hat
    // statt es zu loesen.
    if (($properties['coat_none'] ?? false) === true) {
        unset($properties['coat']);
        if (is_array($properties['wiki_settlement'] ?? null)) {
            $properties['wiki_settlement']['wappen_url'] = '';
        }
    }

    foreach ([['wiki_settlement', 'wappen_url'], ['wiki_region', 'image_url'], ['wiki_path', 'image_url']] as [$nest, $feld]) {
        if (is_array($properties[$nest] ?? null) && ($properties[$nest][$feld] ?? '') !== '') {
            $properties[$nest][$feld] = avesmapsCoatLokaleKopie((string) $properties[$nest][$feld]);
        }
    }

    return $properties;
}

// title -> {type, ruined} aus der Bauwerks-Registry. Try/catch, falls die Spalten (noch) fehlen.
function avesmapsLoadWikiSyncBuildingTypes(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            'SELECT title, building_type, is_ruined, deity FROM wiki_sync_pages
             WHERE (building_type IS NOT NULL AND building_type <> \'\')
                OR (deity IS NOT NULL AND deity <> \'\')'
        );
    } catch (Throwable $error) {
        // 💣 ZWEITER ANLAUF OHNE `deity`. Die Spalte legt nur avesmapsWikiSettlementEnsureSchema an,
        // und die laeuft NUR im Sync-Pfad -- zwischen einem Deploy und dem ersten Dump-Lauf (und auf
        // jeder frischen Installation) gibt es sie nicht. Ohne diesen Rueckfall liefert der Fehler
        // eine LEERE Map, und dann verliert JEDE Infobox ihren building_type: aus „Tempel" wird
        // wieder „Dorf" -- stumm, und niemand ordnet das einem SELECT zu.
        // ⚠️ Kein DDL an dieser Stelle: das ist der heisseste Pfad ueberhaupt (AGENTS.md §10,
        // Pool-Vorfall 17.07.2026).
        try {
            $statement = $pdo->query(
                'SELECT title, building_type, is_ruined, \'\' AS deity FROM wiki_sync_pages
                 WHERE building_type IS NOT NULL AND building_type <> \'\''
            );
        } catch (Throwable $zweiterVersuch) {
            return [];
        }
    }
    if ($statement === false) {
        return [];
    }
    $map = [];
    foreach ($statement->fetchAll() as $row) {
        $title = trim((string) ($row['title'] ?? ''));
        if ($title === '') {
            continue;
        }
        $map[$title] = [
            'type' => (string) ($row['building_type'] ?? ''),
            'ruined' => !empty($row['is_ruined']),
            // Die Gottheit einer Kultstaette (Discord #54) reist denselben Weg wie building_type:
            // aus der Registry an properties.wiki_settlement geheftet, NICHT als eigenes
            // properties-Feld gespeichert -- eine Quelle, kein Editor-Feld, keine Handarbeit
            // fuer 775 Tempel.
            'deity' => (string) ($row['deity'] ?? ''),
        ];
    }
    return $map;
}

// Loads the settlement->political lookup used to build each place's infobox political line: an in-memory
// model of the CURRENT-era territory hierarchy, built from ONE join over the (small) territory tables.
// avesmapsResolveSettlementPolitical then (a) finds the place's ray-cast containing territory by its
// stored wiki_key/public_id and (b) walks the parent_id chain up to the root to decide the line.
//
// Walking parent_id -- never affiliation_path -- is the project KERN-INVARIANTE: ancestry/depth come only
// from the maintained parent_id backbone; affiliation_path is stale and must not drive the hierarchy.
//
// Shape:
//   byId:               territory_id => {id, public_id, wiki_key, parent_id, name, type, capital_key}
//   currentIdByWikiKey: wiki_key => id of the MOST-CURRENT era (highest valid_to_bf); the walk normalizes
//                       every hop to the current era so a stale BF-era row can never be picked.
//   idByPublicId:       public_id => id, a seed fallback when a settlement stored only its public_id.
//
// political_territory can hold several BF-era rows per wiki_key (different public_id, same wiki_key);
// parent_id is an int FK to political_territory.id. Try/catch -> [] so a missing table/column can never
// break the hot map-features payload.
function avesmapsLoadSettlementPoliticalContext(PDO $pdo, bool $territoryCoatsEnabled = true): array {
    try {
        // t.short_name = manually curated short/colloquial name ("Mittelreich"); the wiki apply-flow NEVER
        // writes it (sync-monitor-identity.php), so it is empty until an editor curates it. Preferred over the
        // long formal w.name for display when present -- see avesmapsResolveSettlementPolitical.
        $statement = $pdo->query(
            'SELECT t.id, t.public_id, t.wiki_key, t.parent_id, t.valid_to_bf, t.short_name,
                    t.coat_of_arms_url,
                    w.name AS wiki_name, w.type AS wiki_type, w.capital_name, t.name AS territory_name, t.type AS territory_type
               FROM political_territory t
               LEFT JOIN political_territory_wiki w ON w.wiki_key = t.wiki_key
              WHERE t.wiki_key IS NOT NULL AND t.wiki_key <> \'\''
        );
    } catch (Throwable) {
        return [];
    }
    if ($statement === false) {
        return [];
    }

    // Coat-gate inputs for the breadcrumb thumbnail (wiki staging coat+license / model overrides), keyed by
    // wiki_key. Loaded ONCE here (two small full-table scans -> no N+1) and consulted per territory below.
    // Own try/catch inside so a missing sandbox table simply yields no thumbnails without breaking the line.
    $coatInputs = avesmapsLoadSettlementCoatGateInputs($pdo);
    $coatStaging = $coatInputs['staging'];
    $coatOverrides = $coatInputs['overrides'];

    $byId = [];
    $currentIdByWikiKey = [];
    $bestValidTo = [];
    $idByPublicId = [];

    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $id = (int) ($row['id'] ?? 0);
        $wikiKey = trim((string) ($row['wiki_key'] ?? ''));
        $name = trim((string) ($row['wiki_name'] ?? '')); if ($name === '') { $name = trim((string) ($row['territory_name'] ?? '')); } // wiki-orphan fallback (LEFT JOIN): use the territory's own name when no political_territory_wiki row exists (e.g. Festum), so the parent_id backbone still resolves the political line
        if ($id === 0 || $wikiKey === '' || $name === '') {
            continue;
        }
        $publicId = trim((string) ($row['public_id'] ?? ''));
        $capitalName = trim((string) ($row['capital_name'] ?? ''));
        $byId[$id] = [
            'id' => $id,
            'public_id' => $publicId,
            'wiki_key' => $wikiKey,
            'parent_id' => ($row['parent_id'] !== null && $row['parent_id'] !== '') ? (int) $row['parent_id'] : 0,
            'name' => $name,
            'short_name' => trim((string) ($row['short_name'] ?? '')),
            'type' => trim((string) ($row['wiki_type'] ?? '')) ?: trim((string) ($row['territory_type'] ?? '')),
            'capital_key' => $capitalName !== '' ? avesmapsPoliticalNameKey($capitalName) : '',
            // Public-domain-gated coat URL (or '' when none/not allowed), mirroring territory-detail.php.
            // The global "Wappen: Aus" switch swaps it for the placeholder afterwards -- one wrap here
            // covers every breadcrumb thumbnail, because the whole "Liegt in" staircase reads byId.
            'coat_url' => avesmapsCoatDisplayUrl(
                avesmapsSettlementTerritoryCoatUrl(
                    trim((string) ($row['coat_of_arms_url'] ?? '')),
                    $coatStaging[$wikiKey] ?? [],
                    $coatOverrides[$wikiKey] ?? []
                ),
                $territoryCoatsEnabled
            ),
        ];

        // Most-current era per wiki_key (highest valid_to_bf) is the canonical node the walk hops through.
        $validTo = (int) ($row['valid_to_bf'] ?? 0);
        if (!isset($currentIdByWikiKey[$wikiKey]) || $validTo >= ($bestValidTo[$wikiKey] ?? PHP_INT_MIN)) {
            $currentIdByWikiKey[$wikiKey] = $id;
            $bestValidTo[$wikiKey] = $validTo;
        }
        if ($publicId !== '' && !isset($idByPublicId[$publicId])) {
            $idByPublicId[$publicId] = $id;
        }
    }

    if ($byId === []) {
        return [];
    }
    return ['byId' => $byId, 'currentIdByWikiKey' => $currentIdByWikiKey, 'idByPublicId' => $idByPublicId];
}

// Conservative name-match key for capital<->settlement comparison: lowercased, whitespace-collapsed,
// German umlauts/ss folded, so an umlaut spelling variant still matches. Kept local and deterministic so
// the comparison stays predictable (not the heavier WikiSync match-key).
function avesmapsPoliticalNameKey(string $name): string {
    $value = mb_strtolower(trim($name), 'UTF-8');
    $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
    return strtr($value, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
}

// Resolves ONE settlement's political line by walking the parent_id chain of its stored ray-cast
// containing territory (KERN-INVARIANTE: ancestry from parent_id, never affiliation_path). "Hauptstadt
// bevorzugt": if a BROADER ANCESTOR of the containing territory names this place as its capital, show the
// capital line for the broadest such ancestor ("Hauptstadt des Kaiserreichs"); otherwise show the
// containing territory itself ("Baronie Vierok"). Because the capital match is constrained to the place's
// OWN ancestry, an unrelated territory that merely shares the place's name can no longer produce a false
// "Hauptstadt" line. Returns null when nothing resolves (the client then shows a neutral "Lage").
function avesmapsResolveSettlementPolitical(string $settlementName, array $properties, array $context): ?array {
    $byId = $context['byId'] ?? [];
    $currentIdByWikiKey = $context['currentIdByWikiKey'] ?? [];
    $idByPublicId = $context['idByPublicId'] ?? [];
    if ($byId === []) {
        return null;
    }

    // Seed the walk from the settlement's stored ray-cast assignment: prefer the stable wiki_key, fall
    // back to public_id, then normalize the seed to the current era's canonical node.
    $wikiKey = trim((string) ($properties['territory_wiki_key'] ?? ''));
    $publicId = trim((string) ($properties['territory_public_id'] ?? ''));
    $seedId = 0;
    if ($wikiKey !== '' && isset($currentIdByWikiKey[$wikiKey])) {
        $seedId = (int) $currentIdByWikiKey[$wikiKey];
    } elseif ($publicId !== '' && isset($idByPublicId[$publicId])) {
        $seedRow = $byId[$idByPublicId[$publicId]] ?? null;
        $seedWikiKey = (string) ($seedRow['wiki_key'] ?? '');
        $seedId = ($seedWikiKey !== '' && isset($currentIdByWikiKey[$seedWikiKey]))
            ? (int) $currentIdByWikiKey[$seedWikiKey]
            : (int) $idByPublicId[$publicId];
    }
    if ($seedId === 0 || !isset($byId[$seedId])) {
        return null; // no resolvable containing territory
    }

    // Build the current-era ancestor chain leaf -> ... -> root (visited-guard against cyclic parent data).
    $chain = [];
    $visited = [];
    $node = $byId[$seedId];
    while ($node !== null && !isset($visited[$node['wiki_key']])) {
        $visited[$node['wiki_key']] = true;
        $chain[] = $node;
        $parentId = (int) ($node['parent_id'] ?? 0);
        $parentRow = $parentId !== 0 ? ($byId[$parentId] ?? null) : null;
        if ($parentRow === null) {
            $node = null;
            continue;
        }
        $parentWikiKey = (string) ($parentRow['wiki_key'] ?? '');
        $currentParentId = ($parentWikiKey !== '' && isset($currentIdByWikiKey[$parentWikiKey]))
            ? (int) $currentIdByWikiKey[$parentWikiKey]
            : $parentId;
        $node = $byId[$currentParentId] ?? null;
    }

    $leaf = $chain[0];
    $settlementKey = avesmapsPoliticalNameKey($settlementName);

    // Full leaf -> root hierarchy for the "Liegt in" breadcrumb (Owner Variante A: the leaf is included).
    // Same parent_id chain (KERN-INVARIANTE), just surfaced as a list; the client renders each level as a
    // fly-to link and picks the display label from short_name (curated "Mittelreich") else the full name.
    $hierarchy = [];
    foreach ($chain as $chainNode) {
        $hierarchy[] = [
            'name' => $chainNode['name'],
            'short_name' => $chainNode['short_name'] ?? '',
            'type' => $chainNode['type'],
            'territory_public_id' => $chainNode['public_id'],
            'coat_url' => $chainNode['coat_url'] ?? '',
        ];
    }

    // Capital line: the BROADEST level (closest to root) whose capital matches this place -- INCLUDING the
    // leaf itself (Owner: a place that is the capital of its OWN barony reads "Hauptstadt von Baronie X",
    // not "in Baronie X"). Iterate from the root end inward so the first hit is the broadest; the match is
    // still constrained to the place's OWN ancestry chain, so a same-named foreign territory can't leak in.
    if ($settlementKey !== '') {
        for ($i = count($chain) - 1; $i >= 0; $i--) {
            if (($chain[$i]['capital_key'] ?? '') === $settlementKey) {
                return [
                    'kind' => 'capital',
                    'name' => $chain[$i]['name'],
                    'short_name' => $chain[$i]['short_name'] ?? '',
                    'type' => $chain[$i]['type'],
                    'territory_public_id' => $chain[$i]['public_id'],
                    'coat_url' => $chain[$i]['coat_url'] ?? '',
                    'hierarchy' => $hierarchy,
                ];
            }
        }
    }

    // Otherwise the containing territory it sits in ("Baronie Vierok"). Prefer the settlement's stored
    // public_id (the exact ray-cast era) over the canonical node's, matching the shipped behavior.
    return [
        'kind' => 'territory',
        'name' => $leaf['name'],
        'short_name' => $leaf['short_name'] ?? '',
        'type' => $leaf['type'],
        'territory_public_id' => $publicId !== '' ? $publicId : $leaf['public_id'],
        'coat_url' => $leaf['coat_url'] ?? '',
        'hierarchy' => $hierarchy,
    ];
}

// Shared catalog of every source that is actually linked to at least one element with an approved
// link: { <source_id> => {url,label,type,official} }. One collect-query (EXISTS), deduped to one row
// per source so a source used by many elements is serialized once. Try/catch -> [] when the tables
// do not exist yet (fresh DB): the hot map-features path never runs DDL (see AGENTS.md perf notes).
function avesmapsLoadFeatureSourceCatalog(PDO $pdo): array {
    try {
        $statement = $pdo->query(
            // Same clause as the refs below: a source whose only links hang on deleted elements is
            // not in use and has no business in the shared catalog.
            "SELECT s.id, s.url, s.label, s.source_type, s.is_official
               FROM sources s
              WHERE EXISTS (
                    SELECT 1 FROM feature_sources fs
                     WHERE fs.source_id = s.id AND fs.status = 'approved'"
            . avesmapsFeatureSourceLiveEntityClause('fs') .
            "  )"
        );
    } catch (Throwable $error) {
        return [];
    }
    if ($statement === false) {
        return [];
    }
    $catalog = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $catalog[(int) $row['id']] = [
            'url' => (string) $row['url'],
            'label' => (string) $row['label'],
            'type' => (string) $row['source_type'],
            'official' => (int) $row['is_official'] === 1,
        ];
    }
    return $catalog;
}

// Per-entity approved source references grouped in PHP (no N+1): { "<entity_type>:<public_id>" =>
// [ {source_id[, reference_kind][, pages][, note]} ] }. Ordered official-first then insertion order
// so buildSourceListMarkup keeps a stable within-group order. Null/empty detail fields are omitted
// to keep the payload compact. Try/catch -> [] (tables or the Task-1 detail columns may be absent).
function avesmapsLoadFeatureSourceRefs(PDO $pdo): array {
    $placeholders = implode(', ', array_fill(0, count(AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES), '?'));
    try {
        $statement = $pdo->prepare(
            // 💣 The live-entity clause is what keeps a DELETED element from shipping its sources.
            // The delete is soft, so the link outlives the element -- 216 elements with 4.714 links
            // on 2026-08-05. This is THE public path: sources travel in this payload, there is no
            // per-popup fetch any more. Cost is one unique-key lookup per link.
            "SELECT fs.entity_type, fs.entity_public_id, fs.source_id, fs.reference_kind, fs.pages, fs.note
               FROM feature_sources fs
               JOIN sources s ON s.id = fs.source_id
              WHERE fs.status = 'approved'
                AND fs.entity_type IN (" . $placeholders . ")"
            . avesmapsFeatureSourceLiveEntityClause('fs') .
            " ORDER BY fs.entity_type, fs.entity_public_id, s.is_official DESC, s.created_at ASC, s.id ASC"
        );
        $statement->execute(AVESMAPS_MAP_FEATURES_SOURCE_ENTITY_TYPES);
    } catch (Throwable $error) {
        return [];
    }
    if ($statement === false) {
        return [];
    }
    $refs = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $key = (string) $row['entity_type'] . ':' . (string) $row['entity_public_id'];
        $ref = ['source_id' => (int) $row['source_id']];
        if (($row['reference_kind'] ?? '') !== '') {
            $ref['reference_kind'] = (string) $row['reference_kind'];
        }
        if (($row['pages'] ?? '') !== '') {
            $ref['pages'] = (string) $row['pages'];
        }
        if (($row['note'] ?? '') !== '') {
            $ref['note'] = (string) $row['note'];
        }
        $refs[$key][] = $ref;
    }
    return $refs;
}

// Fix #2 parity: settlement/region/path elements can still carry a legacy single
// properties.other_source ("Andere Quelle") that was never opened in the editor and so never taken
// over into the feature_sources catalog. The removed lazy read (avesmapsReadFeatureSources) merged
// it into the displayed source list; the synchronous payload path reads ONLY the feature_sources
// table, so this restores parity by synthesizing that un-taken-over other_source as a normal catalog
// entry + a per-feature ref. The synthetic id is a NON-numeric string ("os:<public_id>") so it can
// never collide with a real integer sources.id and stays a string key in the (object)-serialized map;
// the JS resolver (resolveFeatureSourceList) then resolves it exactly like any other
// {url,label,official,type} source. Deduped by URL against the element's already-approved links
// (replicating avesmapsReadFeatureSources): a source that WAS taken over is never shown twice.
// Territory has no map_features row, so only these three feature types are in scope. Mutates the
// two shared maps in place.
//
// @param list<array<string,mixed>> $rows this payload's raw map_features rows
// @param array<int|string,array<string,mixed>> $catalog shared source catalog, keyed by source id (mutated)
// @param array<string,list<array<string,mixed>>> $refs per-entity refs, keyed "<entity_type>:<public_id>" (mutated)
function avesmapsMapFeaturesMergeLegacyOtherSources(array $rows, array &$catalog, array &$refs): void {
    // feature_type -> the entity_type the JS resolver / feature_sources rows are keyed by.
    $entityTypeByFeatureType = ['location' => 'settlement', 'label' => 'region', 'path' => 'path'];

    foreach ($rows as $row) {
        if ((int) ($row['is_active'] ?? 1) !== 1) {
            continue; // deleted tombstone -> no source line
        }
        $entityType = $entityTypeByFeatureType[(string) ($row['feature_type'] ?? '')] ?? '';
        if ($entityType === '') {
            continue; // crossing/river/etc. -- no other_source display surface
        }

        // Cheap substring gate before the JSON decode: skips the ~all rows with no legacy field
        // (mirrors the LIKE pre-filters elsewhere; keeps the hot ~14 MB payload decode-once).
        $rawProps = $row['properties_json'] ?? null;
        if (!is_string($rawProps) || strpos($rawProps, '"other_source"') === false) {
            continue;
        }

        $properties = avesmapsDecodeJsonColumn($rawProps);
        $other = $properties['other_source'] ?? null;
        $url = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
        if ($url === '') {
            continue; // present but empty/malformed -> nothing to show
        }

        $publicId = (string) ($row['public_id'] ?? '');
        if ($publicId === '') {
            continue;
        }
        $refKey = $entityType . ':' . $publicId;

        // Dedup (replicating avesmapsReadFeatureSources): skip when this url is ALREADY an approved
        // feature_sources link for the element (it was taken over into the catalog) -> never twice.
        $alreadyLinked = false;
        foreach ($refs[$refKey] ?? [] as $ref) {
            $sourceId = $ref['source_id'] ?? null;
            $entry = ($sourceId !== null && isset($catalog[$sourceId])) ? $catalog[$sourceId] : null;
            if (is_array($entry) && (string) ($entry['url'] ?? '') === $url) {
                $alreadyLinked = true;
                break;
            }
        }
        if ($alreadyLinked) {
            continue;
        }

        // Synthetic id: a NON-numeric string, so it never collides with a real integer sources.id
        // and PHP keeps it a string key (not int-cast) in the (object)-serialized catalog map.
        $syntheticId = 'os:' . $publicId;
        $catalog[$syntheticId] = [
            'url' => $url,
            'label' => is_array($other) ? trim((string) ($other['label'] ?? '')) : '',
            'type' => 'sonstiges',
            'official' => false,
        ];
        // Append last: other_source is non-official and buildSourceListMarkup groups official-first,
        // so it renders after the curated sources -- matching the old "legacy appended after catalog".
        $refs[$refKey][] = ['source_id' => $syntheticId];
    }
}

function avesmapsLoadWikiSyncLocationLinks(PDO $pdo): array {
    $statement = $pdo->query(
        'SELECT normalized_key, wiki_url
        FROM wiki_sync_pages
        WHERE wiki_url IS NOT NULL AND wiki_url <> \'\'
            AND normalized_key IS NOT NULL AND normalized_key <> \'\''
    );
    if ($statement === false) {
        return [];
    }

    $links = [];
    foreach ($statement->fetchAll() as $row) {
        $normalizedKey = trim((string) ($row['normalized_key'] ?? ''));
        $wikiUrl = trim((string) ($row['wiki_url'] ?? ''));
        if ($normalizedKey === '' || $wikiUrl === '') {
            continue;
        }

        $links[$normalizedKey] ??= $wikiUrl;
    }

    return $links;
}

function avesmapsEnrichMapFeatureWikiUrl(array $properties, array $row, array $wikiLocationLinks): array {
    if ((string) ($properties['wiki_url'] ?? '') !== '') {
        return $properties;
    }
    // An editor has stated that this place has NO wiki article (conflict centre, "Kein Wiki-Eintrag").
    // Without honouring that, an empty column is indistinguishable from "nobody set one yet" and the
    // guess below simply puts the wrong link back -- which is why deleting a link never stuck and
    // Discord #38 kept reappearing. A deliberate emptiness is data, not a gap to fill.
    if (!empty($properties['wiki_no_article'])) {
        return $properties;
    }

    // A powerline's wiki link is explicit or nothing. The name match below is built for PLACES:
    // a powerline named like a settlement would silently inherit that settlement's article --
    // the Discord #38 class of bug, where a guessed link became real data on the next save.
    if ((string) ($row['feature_type'] ?? '') === 'powerline') {
        return $properties;
    }

    $locationName = trim((string) ($row['name'] ?? ''));
    if ($locationName === '') {
        return $properties;
    }

    $matchKey = avesmapsWikiSyncCreateMatchKey($locationName);
    if ($matchKey === '' || !isset($wikiLocationLinks[$matchKey])) {
        return $properties;
    }

    $properties['wiki_url'] = (string) ($wikiLocationLinks[$matchKey] ?? '');

    return $properties;
}
