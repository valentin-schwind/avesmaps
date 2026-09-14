<?php

declare(strict_types=1);

// Wie das Ende eines Wegabschnitts heisst (Entwurf 2026-09-14 §4). ZWILLING von avesmapsWegEndeName in
// js/map-features/weg-abschnitte.js: der Wege-Editor ist eine eigene Seite ohne Orte, also nennt der
// SERVER dort die Enden. Beide Tests lesen tools/paths/fixtures/weg-abschnitt-enden.json.

const AVESMAPS_WEG_ENDE_KREUZUNG = 'Kreuzung';
const AVESMAPS_WEG_ENDE_OFFEN = 'Wegende';
const AVESMAPS_WEG_ENDE_ZELLE = 0.5;
// 💣 Dieselbe Zahl steht als LOCATION_ENDPOINT_EXACT_HIT (js/config.js) und
// AVESMAPS_ROUTE_CLIENT_ENDPOINT_EXACT_HIT (api/_internal/routing/client-graph.php). Die Tests halten alle drei gleich.
const AVESMAPS_WEG_ENDE_TOLERANZ = 0.01;

/** @param list<array{name:string,x:float,y:float,kreuzung:bool}> $orte */
function avesmapsWegOrtIndex(array $orte): array {
    $index = [];
    foreach ($orte as $ort) {
        $x = filter_var($ort['x'] ?? null, FILTER_VALIDATE_FLOAT);
        $y = filter_var($ort['y'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($x === false || $y === false) {
            continue;
        }
        $zelle = (int) floor($x / AVESMAPS_WEG_ENDE_ZELLE) . ':' . (int) floor($y / AVESMAPS_WEG_ENDE_ZELLE);
        $index[$zelle][] = ['name' => (string) ($ort['name'] ?? ''), 'x' => (float) $x, 'y' => (float) $y, 'kreuzung' => ($ort['kreuzung'] ?? false) === true];
    }
    return $index;
}

function avesmapsWegEndeName(mixed $punkt, array $index, float $toleranz = AVESMAPS_WEG_ENDE_TOLERANZ): string {
    $x = is_array($punkt) ? filter_var($punkt[0] ?? null, FILTER_VALIDATE_FLOAT) : false;
    $y = is_array($punkt) ? filter_var($punkt[1] ?? null, FILTER_VALIDATE_FLOAT) : false;
    if ($x === false || $y === false) {
        return AVESMAPS_WEG_ENDE_OFFEN;
    }
    $zx = (int) floor($x / AVESMAPS_WEG_ENDE_ZELLE);
    $zy = (int) floor($y / AVESMAPS_WEG_ENDE_ZELLE);
    $bester = null;
    $besterAbstand = INF;
    $kreuzung = false;
    for ($dx = -1; $dx <= 1; $dx++) {
        for ($dy = -1; $dy <= 1; $dy++) {
            foreach ($index[($zx + $dx) . ':' . ($zy + $dy)] ?? [] as $kandidat) {
                $abstand = hypot($kandidat['x'] - $x, $kandidat['y'] - $y);
                if (!($abstand < $toleranz)) {
                    continue;
                }
                if ($kandidat['kreuzung']) {
                    $kreuzung = true;
                    continue;
                }
                $naeher = $abstand < $besterAbstand
                    || ($abstand === $besterAbstand && ($kandidat['x'] < $bester['x'] || ($kandidat['x'] === $bester['x'] && $kandidat['y'] < $bester['y'])));
                if ($naeher) {
                    $bester = $kandidat;
                    $besterAbstand = $abstand;
                }
            }
        }
    }
    if ($bester !== null) {
        return $bester['name'];
    }
    return $kreuzung ? AVESMAPS_WEG_ENDE_KREUZUNG : AVESMAPS_WEG_ENDE_OFFEN;
}

/** Aktive Orte und Kreuzungen als {name, x, y, kreuzung}. Eine Abfrage, nur Punkte. */
function avesmapsWegOrteLesen(PDO $pdo): array {
    $statement = $pdo->query(
        "SELECT name, feature_type, feature_subtype, geometry_json FROM map_features
          WHERE is_active = 1 AND feature_type IN ('location', 'crossing', 'junction')
          ORDER BY id"
    );
    $orte = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $zeile) {
        $geometrie = json_decode((string) ($zeile['geometry_json'] ?? ''), true);
        $punkt = is_array($geometrie) ? ($geometrie['coordinates'] ?? null) : null;
        if (!is_array($punkt) || !is_numeric($punkt[0] ?? null) || !is_numeric($punkt[1] ?? null)) {
            continue;
        }
        $name = (string) ($zeile['name'] ?? '');
        // Dieselbe Erkennung wie resolveLocationTypeFromFeature/isCrossingName (map-features-location-lookup.js).
        $kreuzung = in_array((string) $zeile['feature_type'], ['crossing', 'junction'], true)
            || (string) $zeile['feature_subtype'] === 'crossing'
            || preg_match('/^Kreuzung(?:-\d+)?$/i', $name) === 1;
        $orte[] = ['name' => $name, 'x' => (float) $punkt[0], 'y' => (float) $punkt[1], 'kreuzung' => $kreuzung];
    }
    return $orte;
}
