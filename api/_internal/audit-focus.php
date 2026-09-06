<?php

declare(strict_types=1);

/**
 * „Wo auf der Karte war das?" -- der Sprungpunkt einer Zeile im Fenster „Aenderungen".
 *
 * Das Fenster mischt DREI Protokolle (Karte, Herrschaftsgebiete, Landschaften), und jede Zeile soll
 * auf ihre Stelle springen koennen. Die Umrechnung „Kasten -> Punkt oder Rechteck" steht deshalb
 * hier, EINMAL, und nicht ein drittes Mal in der naechsten Quelle.
 *
 * 🔴 DIE FORM IST DIE, DIE DER BROWSER LIEST (`focusAuditChangeTarget`, review-panels-change-log.js):
 *   ['type' => 'point',  'lat' => .., 'lng' => ..]
 *   ['type' => 'bounds', 'lat' => .., 'lng' => .., 'bounds' => [[minLat,minLng],[maxLat,maxLng]]]
 * Eine vierte Form waere ein stiller Fehlschlag -- `L.latLngBounds` antwortet auf halb gefuellte
 * Werte mit NaN, und die Karte fliegt dann irgendwohin, statt eine Fehlermeldung zu zeigen.
 *
 * 💣 x IST LNG, y IST LAT. GeoJSON speichert `[x, y]`, Leaflet `L.CRS.Simple` will `[lat, lng]`
 * (AGENTS.md §5). Das ist der Hausklassiker, und dies hier ist die einzige Stelle, an der er noch
 * passieren kann -- gewacht von `api/_internal/__tests__/audit-focus-test.php`.
 *
 * 🔴 `null` heisst „dazu gibt es keine Stelle" und schaltet im Browser das Fadenkreuz ab. Ein
 * erfundener Nullpunkt waere die schlimmere Antwort: die Karte floege in die linke untere Ecke, und
 * der Editor haette keinen Anhalt, dass es die Stelle gar nicht gibt.
 *
 * PURITAETSVERTRAG: nebenwirkungsfrei beim Einbinden, kein PDO, kein I/O -- wie `audit-detail.php`
 * daneben. Wer eine bbox aus der Datenbank holt, tut das bei sich und reicht vier Zahlen herein.
 */

/**
 * Ab wann ein Kasten ein Rechteck ist und nicht mehr ein Punkt: 0.0001 Karteneinheiten (rund
 * 0,3 Meilen). ⚠️ Darunter ist ein Rechteck auf jeder Zoomstufe ein Punkt, und `fitBounds` auf ein
 * entartetes Rechteck zoomt bis zum Anschlag hinein.
 */
const AVESMAPS_AUDIT_FOCUS_POINT_EPSILON = 0.0001;

/**
 * Vier Zahlen in Kartenkoordinaten -> das Ziel, das der Browser anfliegt.
 *
 * @return array{type: string, lat: float, lng: float, bounds?: array<int, array<int, float>>}
 */
function avesmapsAuditFocusFromBounds(float $minX, float $minY, float $maxX, float $maxY): array
{
    $lat = ($minY + $maxY) / 2;
    $lng = ($minX + $maxX) / 2;

    if (abs($maxX - $minX) < AVESMAPS_AUDIT_FOCUS_POINT_EPSILON
        && abs($maxY - $minY) < AVESMAPS_AUDIT_FOCUS_POINT_EPSILON
    ) {
        return [
            'type' => 'point',
            'lat' => round($lat, 6),
            'lng' => round($lng, 6),
        ];
    }

    return [
        'type' => 'bounds',
        'lat' => round($lat, 6),
        'lng' => round($lng, 6),
        'bounds' => [
            [round($minY, 6), round($minX, 6)],
            [round($maxY, 6), round($maxX, 6)],
        ],
    ];
}

/**
 * Eine GeoJSON-Geometrie -> das Ziel. `null`, wenn sie keine Koordinaten traegt.
 *
 * @return array{type: string, lat: float, lng: float, bounds?: array<int, array<int, float>>}|null
 */
function avesmapsAuditFocusFromGeometry(array $geometry): ?array
{
    $coordinatePairs = [];
    avesmapsAuditCollectCoordinatePairs($geometry['coordinates'] ?? null, $coordinatePairs);
    if ($coordinatePairs === []) {
        return null;
    }

    $xValues = array_map(static fn(array $coordinate): float => $coordinate[0], $coordinatePairs);
    $yValues = array_map(static fn(array $coordinate): float => $coordinate[1], $coordinatePairs);

    // ⚠️ Ein EINZELNES Paar ist immer ein Punkt, auch wenn die Schwelle oben es nicht faengt: eine
    // Geometrie mit einer Koordinate hat keine Ausdehnung, und ein Rechteck der Groesse null waere
    // eine Behauptung ueber eine Flaeche, die es nicht gibt.
    if (count($coordinatePairs) === 1) {
        return [
            'type' => 'point',
            'lat' => round($yValues[0], 6),
            'lng' => round($xValues[0], 6),
        ];
    }

    return avesmapsAuditFocusFromBounds(min($xValues), min($yValues), max($xValues), max($yValues));
}

/**
 * Die Geometrie eines Protokoll-Schnappschusses, egal wie sie dort liegt.
 *
 * 💣 Die Karte legt sie als JSON-ZEICHENKETTE ab, die Politik als bereits dekodiertes Feld -- ein
 * Leser fuer beide, damit keine Quelle ihren eigenen `json_decode` samt eigener Fehlerbehandlung
 * mitbringt. Unsinn liefert `null`, statt zu werfen: ein Protokoll ist ein Archiv, und eine alte
 * Zeile mit kaputtem JSON darf die ganze Liste nicht in den Fehlerpfad ziehen.
 */
function avesmapsAuditReadGeometry(mixed $value): ?array
{
    if ($value === null || $value === '') {
        return null;
    }
    if (is_array($value)) {
        return isset($value['type']) ? $value : null;
    }

    try {
        $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null;
    }

    return is_array($decoded) && isset($decoded['type']) ? $decoded : null;
}

/**
 * Sammelt alle [x, y]-Paare einer Geometrie, gleich wie tief sie verschachtelt sind.
 *
 * 💣 REKURSIV, nicht auf einer erwarteten Tiefe: Point, LineString, Polygon und MultiPolygon
 * verschachteln unterschiedlich tief. Wer eine Tiefe annimmt, bekommt fuer genau eine Geometrieart
 * ein Ergebnis und fuer die anderen lautlos nichts.
 *
 * @param array<int, array<int, float>> $coordinatePairs
 */
function avesmapsAuditCollectCoordinatePairs(mixed $coordinates, array &$coordinatePairs): void
{
    if (!is_array($coordinates)) {
        return;
    }
    if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
        $coordinatePairs[] = [(float) $coordinates[0], (float) $coordinates[1]];

        return;
    }

    foreach ($coordinates as $coordinate) {
        avesmapsAuditCollectCoordinatePairs($coordinate, $coordinatePairs);
    }
}
