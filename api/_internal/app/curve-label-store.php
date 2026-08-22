<?php

declare(strict_types=1);

// Die Kurvenbeschriftung je REGION lesen und ans Label haengen.
// Entwurf: docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md §2, §8
//
// 🔴 DIE EINSTELLUNG GEHOERT DER REGION, nicht dem Label und nicht der Flaeche (Owner 22.08.2026).
// Eine Region traegt N Labels und M Flaechen; der Wert existiert genau einmal, in
// ecosystem_region.properties_json. Die Spalte gibt es bereits -- kein DDL.

require_once __DIR__ . '/curve-labels.php';
require_once __DIR__ . '/app-setting.php';

const AVESMAPS_CURVE_LABEL_MAX = 3;

// 🔴 Fehlt der Schluessel, ist die Kurvenbeschriftung AUS. Die beiden Fehlrichtungen sind nicht
// gleich teuer: „aus" laesst alles, wie es ist, „an" stellt 657 Labels auf einen Schlag um.
function avesmapsCurveLabelSettingsFromProperties(?array $properties): array
{
    $roh = $properties['curve_label'] ?? null;
    $an = $roh === true || $roh === 1 || $roh === '1';
    $max = $properties['curve_label_max'] ?? null;
    $zahl = is_int($max) || (is_string($max) && ctype_digit($max)) || is_float($max) ? (int) $max : 1;

    return [
        'enabled' => $an,
        'max_labels' => max(1, min(AVESMAPS_CURVE_LABEL_MAX, $zahl)),
    ];
}

// Der Umstellzustand, aus den Daten statt aus einer Vermutung: eine Region, deren Labels heute
// gedreht sind, bekommt die Kurve -- und so viele Namen, wie sie Labels hat.
//
// 💣 Der Winkel wird MODULO 360 geprueft, nicht auf „ungleich 0". Von den 83 derographischen Labels
// ist genau eines gedreht: „Weiden" mit 360 Grad -- sichtbar identisch mit 0, numerisch verschieden.
// Roh geprueft schaltet die Regel dort eine Kurve ein, wo niemand etwas gedreht haben wollte.
// ⚠️ Dieselbe Normalisierung benutzt der Zeichner heute schon (createLabelIcon in
// js/map-features/map-features-labels.js) -- zwei Stellen, die denselben Wert verschieden lesen,
// widersprechen sich frueher oder spaeter sichtbar.
function avesmapsCurveLabelRolloutFor(array $rotations): array
{
    if ($rotations === []) {
        return ['enabled' => false, 'max_labels' => 1];
    }
    $gedreht = false;
    foreach ($rotations as $r) {
        if (((((int) $r) % 360) + 360) % 360 !== 0) {
            $gedreht = true;
            break;
        }
    }

    return [
        'enabled' => $gedreht,
        'max_labels' => max(1, min(AVESMAPS_CURVE_LABEL_MAX, count($rotations))),
    ];
}

// Die Kurve an jedes Label haengen, dessen Region eine hat.
//
// 🔴 EMITTIERT, NICHT GESPEICHERT -- dieselbe Haltung wie bei
// avesmapsEcosystemApplyLabelRegionsToFeatures: die dauerhafte Wahrheit ist die Geometrie plus die
// Einstellung an der Region. Die Kurve ist ihre abgeleitete Ansicht.
//
// 🔴 Fehlt die Kurve, fehlt der SCHLUESSEL -- nicht `null`, nicht `[]`. Der Client unterscheidet
// „hat keine Kurve" an der Abwesenheit; ein leeres Feld waere eine leere Kurve, und die zeichnet
// sich als Nichts statt als Gerade.
//
// @param list<array<string,mixed>> $features gebaute GeoJSON-Features (wird veraendert)
// @param array<string,array{line:list<array{0:float,1:float}>,max_labels:int}> $byRegion
function avesmapsCurveApplyToFeatures(array &$features, array $byRegion): void
{
    if ($byRegion === []) {
        return;
    }
    foreach ($features as $i => $feature) {
        $properties = $feature['properties'] ?? null;
        if (!is_array($properties) || (string) ($properties['feature_type'] ?? '') !== 'label') {
            continue;
        }
        $regionId = trim((string) ($properties['ecosystem_region_public_id'] ?? ''));
        if ($regionId === '' || !isset($byRegion[$regionId])) {
            continue;
        }
        $features[$i]['properties']['curve_label_line'] = $byRegion[$regionId]['line'];
        $features[$i]['properties']['curve_label_max'] = $byRegion[$regionId]['max_labels'];
    }
}

// Der Schluessel des Zwischenspeichers. Eigene Funktion statt einer nackten Konstante, damit der
// Sammellauf (api/edit/map/curve-labels-run.php) und der Leser sich nicht auf zwei Schreibweisen
// desselben Wortes verlassen.
function avesmapsCurveCacheKey(): string
{
    return 'curve_label_baselines';
}

// Die Zahl der Punkte, mit denen eine Kurve AUSGELIEFERT wird. Gerechnet wird mit 120 (das braucht
// der Polynomfit), geliefert werden 32 -- gemessen 433 Byte je Kurve, gegen 1,7 KB bei 120.
// ⚠️ Nicht mit `samples` im Optionsfeld verwechseln: das ist die Rechen-, dies die Lieferdichte.
const AVESMAPS_CURVE_LABEL_PAYLOAD_POINTS = 32;

// Den abgelegten Zwischenspeicher lesen und gegen die heutigen Geometrierevisionen halten.
//
// 🔴 Reine Funktion, damit sie ohne DB testbar ist -- dieselbe Trennung wie in
// ecosystem-label-link.php. Der PDO-Teil steht in avesmapsCurveReadBaselines darunter.
//
// 💣 Ein unlesbarer, leerer oder zu neuer Zwischenspeicher ergibt LEER. Nie eine halbe Kurve, nie
// eine Ausnahme: der Lesepfad einer Karte darf an einer Beschriftung nicht scheitern.
//
// @param array<string,int> $revisionByRegion region public_id => Summe der geometry_revision
// @return array<string,array{line:list<array{0:float,1:float}>,max_labels:int}>
function avesmapsCurveBaselinesFromCache(string $json, array $revisionByRegion): array
{
    if (trim($json) === '') {
        return [];
    }
    $daten = json_decode($json, true);
    if (!is_array($daten) || ($daten['version'] ?? null) !== 1 || !is_array($daten['regions'] ?? null)) {
        return [];
    }
    $raus = [];
    foreach ($daten['regions'] as $regionId => $rec) {
        $regionId = (string) $regionId;
        if (!is_array($rec) || !isset($revisionByRegion[$regionId])) {
            continue;
        }
        // 💣 Veraltet heisst WEGLASSEN. Die alte Achse gehoert zu einer Geometrie, die es nicht mehr
        // gibt; eine Gerade ist schlichter, eine falsche Kurve ist ein Fehler, den niemand bemerkt.
        if ((int) ($rec['rev'] ?? -1) !== (int) $revisionByRegion[$regionId]) {
            continue;
        }
        $linie = $rec['line'] ?? null;
        if (!is_array($linie) || count($linie) < 2) {
            continue;
        }
        $sauber = [];
        foreach ($linie as $p) {
            if (!is_array($p) || count($p) < 2 || !is_numeric($p[0]) || !is_numeric($p[1])) {
                return [];
            }
            $sauber[] = [(float) $p[0], (float) $p[1]];
        }
        $raus[$regionId] = [
            'line' => $sauber,
            'max_labels' => max(1, min(AVESMAPS_CURVE_LABEL_MAX, (int) ($rec['max'] ?? 1))),
        ];
    }

    return $raus;
}

// Der Leser fuer den Endpunkt: EINE leichte Aggregatabfrage plus EIN app_setting-Lesevorgang.
//
// ⚠️ KEIN DDL (AGENTS.md §10) -- deshalb avesmapsAppSettingGetWithoutDdl und nicht ...Get.
// ⚠️ KEINE Berechnung. 56 Regionen mal rund 50 ms waeren 2,8 s auf jeder Kartenanfrage.
function avesmapsCurveReadBaselines(PDO $pdo): array
{
    try {
        $stmt = $pdo->query(
            'SELECT r.public_id AS region_id, SUM(a.geometry_revision) AS rev
             FROM ecosystem_region r
             INNER JOIN ecosystem_area a ON a.region_id = r.id AND a.is_active = 1
             WHERE r.is_active = 1
             GROUP BY r.public_id'
        );
        $rows = $stmt !== false ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable $e) {
        // ⚠️ Still, aber nicht blind: ohne diese Zeile ist eine Absage von aussen unauffindbar.
        error_log('avesmapsCurveReadBaselines (Revisionen): ' . $e->getMessage());

        return [];
    }
    $revisionByRegion = [];
    foreach ($rows as $row) {
        $revisionByRegion[(string) $row['region_id']] = (int) $row['rev'];
    }
    if ($revisionByRegion === []) {
        return [];
    }

    try {
        $json = avesmapsAppSettingGetWithoutDdl($pdo, avesmapsCurveCacheKey(), '');
    } catch (Throwable $e) {
        error_log('avesmapsCurveReadBaselines (Zwischenspeicher): ' . $e->getMessage());

        return [];
    }

    return avesmapsCurveBaselinesFromCache($json, $revisionByRegion);
}
