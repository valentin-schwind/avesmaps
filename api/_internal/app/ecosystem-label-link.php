<?php

declare(strict_types=1);

// Which map label belongs to which landscape region -- resolved from BOTH directions, in ONE place.
//
// 🔴 WHY THIS IS ITS OWN FILE. Two read paths need the same answer and must never disagree about it:
//   * api/app/ecosystem-areas.php  -- "how many labels does this region carry" (the area tooltip)
//   * api/app/map-features.php     -- "which region does this label belong to" (payload field)
// A second copy of the rule is the second truth, and this relation is exactly the kind that drifts:
// it is stored twice on purpose, once per direction.
//
// 🔴 THE RELATION IS 1:N AND STORED IN TWO PLACES (see docs/superpowers/specs/
// 2026-07-28-landschaften-flaeche-label-kopplung-design.md §2.5):
//   * map_features.properties.ecosystem_region_public_id -- the label names its region (10 of 590 today)
//   * ecosystem_region.label_public_id                   -- the region names its PRIMARY label (137 of 139)
// Neither side alone is complete. Reading only the region side reports the second and third label of an
// area as homeless -- and those are the entire point of the 1:N.
//
// 💣 A POINTER IS NOT A LABEL. ecosystem_region.label_public_id may point at a label somebody deleted by
// hand; the region keeps the stale pointer (the "Regionname anzeigen" checkbox learned this the hard way,
// map-features-ecosystem-properties.js:587). So every pointer is checked against the set of ACTIVE labels
// before it counts. Without that check a region with a deleted label would report "1 label" and the delete
// cascade would never fire for it.
//
// No DDL, no writes, no globals -- pure functions plus one reader, so the core is unit-testable
// (api/_internal/app/__tests__/ecosystem-label-link-test.php).

// The resolved relation, both directions at once.
//
// @param list<array{public_id:string,label_public_id:?string}> $regionRows  active regions
// @param list<array{public_id:string,region_public_id:string}> $pointerRows labels carrying their own pointer
// @param list<string> $activeLabelIds public_ids of ALL active labels
// @return array{by_label:array<string,string>, count_by_region:array<string,int>}
function avesmapsEcosystemLabelRegionMap(array $regionRows, array $pointerRows, array $activeLabelIds): array
{
    $active = [];
    foreach ($activeLabelIds as $labelId) {
        $labelId = trim((string) $labelId);
        if ($labelId !== '') {
            $active[$labelId] = true;
        }
    }

    // 1. The label's OWN pointer wins. It is the direction the feature is moving towards, and it is the
    //    only one that can express a second or third label on the same area.
    $byLabel = [];
    foreach ($pointerRows as $row) {
        $labelId = trim((string) ($row['public_id'] ?? ''));
        $regionId = trim((string) ($row['region_public_id'] ?? ''));
        if ($labelId === '' || $regionId === '' || !isset($active[$labelId])) {
            continue;
        }
        $byLabel[$labelId] = $regionId;
    }

    // 2. The region's primary pointer fills in the rest -- the ~124 stock labels from the V5 import that
    //    do not carry their own. It never OVERRIDES an own pointer: a label that says where it belongs is
    //    right, even if some region still claims it.
    foreach ($regionRows as $row) {
        $regionId = trim((string) ($row['public_id'] ?? ''));
        $labelId = trim((string) ($row['label_public_id'] ?? ''));
        if ($regionId === '' || $labelId === '' || !isset($active[$labelId])) {
            continue;
        }
        if (!isset($byLabel[$labelId])) {
            $byLabel[$labelId] = $regionId;
        }
    }

    // Counted from the RESOLVED map, so a label claimed by both directions counts once.
    $countByRegion = [];
    foreach ($byLabel as $regionId) {
        $countByRegion[$regionId] = ($countByRegion[$regionId] ?? 0) + 1;
    }

    return ['by_label' => $byLabel, 'count_by_region' => $countByRegion];
}

// The same relation, read from the database. Three cheap queries, no N+1 and no cross join.
//
// 🪤 NO CROSS JOIN between map_features and ecosystem_region, however tempting: the two tables can carry
// different collations, and a mismatched one turns the comparison into a silent zero rather than an error
// (the feature_sources collation trap, seen live). Merging in PHP compares plain strings and cannot fail
// that way.
//
// 🪤 The pointer query uses a LIKE pre-filter before touching properties_json, the same gate
// avesmapsMapFeaturesMergeLegacyOtherSources uses (api/app/map-features.php:879): ~10 rows are decoded
// instead of 590, and the JSON is decoded in PHP rather than by JSON_EXTRACT -- one malformed row would
// otherwise take the whole query down.
//
// Returns the empty relation when the ecosystem tables are absent, so an installation without the feature
// behaves exactly as before instead of erroring.
function avesmapsEcosystemReadLabelRegionMap(PDO $pdo): array
{
    try {
        // `kind` mit: die Karte muss wissen, ZU WELCHER EBENE eine Beschriftung gehört, sonst kann sie
        // beim Umschalten auf „Vegetation" nicht die Wälder von den Gebirgen trennen (Owner 2026-08-04).
        $regionStatement = $pdo->query(
            'SELECT public_id, label_public_id, kind FROM ecosystem_region WHERE is_active = 1'
        );
        $regionRows = $regionStatement === false ? [] : $regionStatement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        return ['by_label' => [], 'count_by_region' => [], 'kind_by_region' => []];
    }

    $activeStatement = $pdo->query(
        "SELECT public_id FROM map_features WHERE feature_type = 'label' AND is_active = 1"
    );
    $activeLabelIds = $activeStatement === false ? [] : $activeStatement->fetchAll(PDO::FETCH_COLUMN);

    $pointerStatement = $pdo->query(
        "SELECT public_id, properties_json FROM map_features
          WHERE feature_type = 'label' AND is_active = 1
            AND properties_json LIKE '%\"ecosystem_region_public_id\"%'"
    );
    $pointerRows = [];
    foreach ($pointerStatement === false ? [] : $pointerStatement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $properties = json_decode((string) ($row['properties_json'] ?? ''), true);
        $regionId = is_array($properties) ? trim((string) ($properties['ecosystem_region_public_id'] ?? '')) : '';
        if ($regionId === '') {
            continue;
        }
        $pointerRows[] = ['public_id' => (string) $row['public_id'], 'region_public_id' => $regionId];
    }

    // Die Ebene JE REGION -- getrennt von der reinen Relation darüber, damit deren Regel (und ihr Test)
    // unangetastet bleibt: welche Beschriftung zu welcher Fläche gehört, ist eine andere Frage als
    // welcher Ebene diese Fläche angehört.
    $kindByRegion = avesmapsEcosystemKindByRegion($regionRows);

    return avesmapsEcosystemLabelRegionMap($regionRows, $pointerRows, $activeLabelIds)
        + ['kind_by_region' => $kindByRegion];
}

// Fill properties.ecosystem_region_public_id on every label feature that belongs to a region.
//
// 🔴 EMITTED, NOT STORED. The durable pointers stay where they are (one on the label, one on the
// region); this is their resolved view. Writing the resolution back onto ~127 label rows would mint a
// second copy that can drift from the region side -- and this relation is exactly the kind that drifts,
// which is why it is stored in two places to begin with.
//
// 🔴 A LABEL'S OWN VALUE IS NEVER OVERWRITTEN. avesmapsEcosystemLabelRegionMap already settled any
// disagreement in the label's favour; this second guard means a label with an intact stored pointer
// comes through untouched no matter how the map was built.
//
// Why the READ mode needs this at all: the region cache sits behind the `edit` capability and
// api/app/ecosystem-areas.php is only fetched inside the Landschaften mode. Without this field an
// ordinary visitor's client cannot tell a landscape label from any other -- and the collision resolver,
// which must never hide one, would have nothing to go by.
//
// Lives here rather than in api/app/map-features.php because that file is an endpoint: its request
// handler runs on include, so nothing defined in it can be unit-tested (same reason
// avesmapsEcosystemETagMatches was reimplemented instead of required).
//
// @param list<array<string,mixed>> $features built GeoJSON features (mutated in place)
// @param array<string,string> $byLabel label public_id => region public_id
function avesmapsEcosystemApplyLabelRegionsToFeatures(array &$features, array $byLabel, array $kindByRegion = []): void
{
    if ($byLabel === [] && $kindByRegion === []) {
        return;
    }
    foreach ($features as $index => $feature) {
        $properties = $feature['properties'] ?? null;
        if (!is_array($properties) || (string) ($properties['feature_type'] ?? '') !== 'label') {
            continue;
        }
        // 🔴 Der EIGENE Zeiger des Labels gilt -- aber er beendet die Runde nicht mehr. Bis heute stand
        // hier ein `continue`, und das war richtig, solange es nur um den Zeiger ging. Jetzt hängt die
        // EBENE mit daran, und die brauchen genau diese ~10 Labels genauso wie alle anderen: sonst
        // verschwänden ausgerechnet die, die ihre Fläche selbst benennen, beim Umschalten der Ebene.
        $regionPublicId = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));
        if ($regionPublicId === '') {
            $regionPublicId = (string) ($byLabel[(string) ($properties['public_id'] ?? '')] ?? '');
            if ($regionPublicId === '') {
                continue;
            }
            $features[$index]['properties']['ecosystem_region_public_id'] = $regionPublicId;
        }
        // Welche Ebene? Daran entscheidet die Karte, ob diese Beschriftung zur gewählten Ebene gehört.
        $kind = (string) ($kindByRegion[$regionPublicId] ?? '');
        if ($kind !== '') {
            $features[$index]['properties']['ecosystem_region_kind'] = $kind;
        }
    }
}

// Die Ebene je Flaeche. Eigene Funktion, weil beide Leser dieser Datei sie brauchen -- ein zweiter Loop
// waere die zweite Wahrheit, gegen die es diese Datei ueberhaupt gibt.
//
// @param list<array{public_id:string,kind:?string}> $regionRows
// @return array<string,string> region public_id => kind
function avesmapsEcosystemKindByRegion(array $regionRows): array
{
    $kindByRegion = [];
    foreach ($regionRows as $row) {
        $regionId = trim((string) ($row['public_id'] ?? ''));
        $kind = trim((string) ($row['kind'] ?? ''));
        if ($regionId !== '' && $kind !== '') {
            $kindByRegion[$regionId] = $kind;
        }
    }

    return $kindByRegion;
}

// ---- Der SCHREIBWEG ist der DRITTE Leser dieser Beziehung ------------------------------------------
//
// 🔴 WARUM DAS HIER STEHT UND NICHT IM EDIT-ENDPUNKT. api/edit/map/features.php antwortet auf jedes
// Anlegen, Aendern und Verschieben mit dem fertigen Label-Feature, und der Client baut daraus dasselbe
// Objekt wie aus dem Kartenpayload (normalizeLabelFeature). Diese Antwort ist damit ein dritter Leser
// der Label-Flaeche-Beziehung -- und der Kopf dieser Datei sagt, warum ein zweiter Ort fuer die Regel
// die zweite Wahrheit waere.
//
// 💣 DER FEHLER, DEN DAS BEHEBT (Owner 2026-08-05): ein dupliziertes Label verschwand aus seiner eigenen
// Ebene und stand erst unter „Alle" wieder da. `shouldShowLabelMarker` fragt
// `ecosystemRegionKind === aktive Ebene`; ein leeres Feld heisst dort „gehoert zu keiner Ebene". Und es
// traf nicht nur den Klon: `applyLabelFeatureResponse` macht `Object.assign`, also loeschte JEDES
// Verschieben und jedes Speichern eines Landschafts-Labels die beiden Felder wieder, die der
// Kartenpayload gefuellt hatte.
//
// 🪤 ZWEI Felder, nicht eines. Die ~124 Bestandslabels tragen keinen eigenen Zeiger -- ihre Flaeche nennt
// SIE. Fuer die muss die Antwort auch `ecosystem_region_public_id` aufloesen, sonst verlieren sie beim
// Verschieben zusaetzlich ihre Zugehoerigkeit (Label anklicken -> Flaeche, „nur Labels mit Region").
function avesmapsEcosystemEnrichEditLabelFeature(PDO $pdo, array $feature): array
{
    $properties = $feature['properties'] ?? null;
    if (!is_array($properties) || (string) ($properties['feature_type'] ?? '') !== 'label') {
        return $feature;
    }
    $labelPublicId = trim((string) ($properties['public_id'] ?? ''));
    if ($labelPublicId === '') {
        return $feature;
    }
    $ownRegion = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));

    // Beide Richtungen in EINER Abfrage, und nur die Zeilen, die dieses eine Label angehen: der Lesepfad
    // zieht drei Listen ueber den ganzen Bestand, was hier -- einmal je Bearbeitung -- Verschwendung waere.
    // 🪤 `is_active = 1` gehoert dazu: die Beschriftung einer stillgelegten Flaeche hinge sonst an einer
    // Ebene, in der es diese Flaeche nicht mehr gibt.
    try {
        $statement = $pdo->prepare(
            'SELECT public_id, label_public_id, kind FROM ecosystem_region
              WHERE is_active = 1 AND (label_public_id = :label OR public_id = :own)'
        );
        $statement->execute(['label' => $labelPublicId, 'own' => $ownRegion]);
        $regionRows = $statement->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable) {
        // Installation ohne Landschaften-Tabellen: unveraendert durchreichen, genau wie vor dieser Zeile.
        return $feature;
    }

    return avesmapsEcosystemApplyLabelRegionToEditFeature($feature, is_array($regionRows) ? $regionRows : []);
}

// Der reine Kern dazu: EIN Label-Feature gegen die Regionszeilen, die es angehen.
//
// 🔴 Nutzt dieselbe Regel (avesmapsEcosystemLabelRegionMap) und dieselbe Stempelung
// (avesmapsEcosystemApplyLabelRegionsToFeatures) wie der Lesepfad -- eigener Zeiger schlaegt
// Regionszeiger, ein gesetzter Zeiger wird nie ueberschrieben. Nachgebaut waeren beide Regeln hier
// dieselbe Divergenz, die diese Datei verhindern soll.
function avesmapsEcosystemApplyLabelRegionToEditFeature(array $feature, array $regionRows): array
{
    $properties = $feature['properties'] ?? null;
    if (!is_array($properties) || (string) ($properties['feature_type'] ?? '') !== 'label') {
        return $feature;
    }
    $labelPublicId = trim((string) ($properties['public_id'] ?? ''));
    if ($labelPublicId === '') {
        return $feature;
    }
    $ownRegion = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));
    $pointerRows = $ownRegion === ''
        ? []
        : [['public_id' => $labelPublicId, 'region_public_id' => $ownRegion]];

    // Dieses Label IST aktiv -- es wurde gerade geschrieben. Die Pruefung der Regel gilt den ZEIGERN.
    $relation = avesmapsEcosystemLabelRegionMap($regionRows, $pointerRows, [$labelPublicId]);

    $features = [$feature];
    avesmapsEcosystemApplyLabelRegionsToFeatures(
        $features,
        $relation['by_label'],
        avesmapsEcosystemKindByRegion($regionRows)
    );

    return $features[0];
}
