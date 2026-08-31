<?php

declare(strict_types=1);

// V14: the two things the cross-country A* needs from the database, both limited to the search box.
// Spec §5.2, instruction §3.2.
//
// PURITY CONTRACT: side-effect-free on include. Every function takes a PDO explicitly, and every one
// of them fails INERT -- an empty result means „the A* knows less", never „the route request 500s".
//
// 💣 NO DDL, NO information_schema PROBE. The ecosystem module owns these tables. `terrain_speed_factor`
// is read here and nowhere else in the routing path, so a database that predates the column must simply
// yield no factors instead of an exception -- which is exactly what the try/catch below does.

require_once __DIR__ . '/offroad-grid.php';
require_once __DIR__ . '/../app/heightmap.php';
// Fuer avesmapsTravelValuesOffroadBaseFactor(): der Bezug, gegen den ein Landschaftsfaktor gemessen
// wird. Dieselbe Zahl ist der Wegtyp-Faktor `Querfeldein`, und sie darf nur EINMAL im Haus stehen.
require_once __DIR__ . '/travel-values.php';

// The three kinds that lie ON TOP of each other; one byte plane each (V11 §10.3).
const AVESMAPS_ROUTE_OFFROAD_KINDS = ['derographisch', 'vegetation', 'topographie'];

/**
 * Height rasters overlapping the box, decoded, blob left as a binary string.
 *
 * 🔴 THIS IS THE FUNCTION heightmap.php SENDS YOU HERE FOR. Its own header is explicit -- „The
 * ROUTING PATH never [reads rasters] -- it reads path_terrain and nothing else. Loading all rasters
 * per route request is exactly what the derived cache exists to prevent." That rule is about
 * avesmapsHeightmapLoadAll, which pulls EVERY raster on EVERY request for a way's profile. The A*
 * has no derived cache to fall back on: it prices ground nobody has drawn a way across, so it must
 * read the raster -- but only the handful that touch its own box, selected in SQL by bbox.
 *
 * A raster's extent is origin + (px - 1) x cell, exactly as avesmapsHeightmapLoadAll computes it.
 * ⚠️ A broken row is skipped, not fatal: avesmapsHeightmapDecode refuses truncated blobs by design,
 * and one bad area may not take the whole route down.
 */
function avesmapsOffroadLoadHeightRasters(PDO $pdo, array $box): array
{
    try {
        $statement = $pdo->prepare(
            'SELECT area_id, origin_x, origin_y, cell_size_mapunits, width_px, height_px, sample_bytes, samples
               FROM ecosystem_area_heightmap
              WHERE origin_x <= :max_x
                AND origin_y <= :max_y
                AND origin_x + (width_px - 1) * cell_size_mapunits >= :min_x
                AND origin_y + (height_px - 1) * cell_size_mapunits >= :min_y'
        );
        $statement->execute([
            'min_x' => $box['min_x'], 'min_y' => $box['min_y'],
            'max_x' => $box['max_x'], 'max_y' => $box['max_y'],
        ]);

        $rasters = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            try { $rasters[] = avesmapsHeightmapDecode($row); } catch (Throwable) { continue; }
        }

        return $rasters;
    } catch (Throwable) {
        return [];
    }
}

/**
 * How many height rasters exist at all -- one indexed count, no blob.
 *
 * ⭐ It exists because nobody could say. The first draft of the instruction cited „3.331 Profilzeilen"
 * as evidence, but those are `path_terrain` rows -- the ways' cache -- and say nothing about stored
 * rasters. This number rides in the route response's debug context so the answer is measured rather
 * than asserted, and so „the A* ignores the mountains" can be told apart from „there are no mountains
 * stored yet".
 */
function avesmapsOffroadCountHeightRasters(PDO $pdo): int
{
    try {
        $statement = $pdo->query('SELECT COUNT(*) FROM ecosystem_area_heightmap');

        return $statement === false ? 0 : (int) $statement->fetchColumn();
    } catch (Throwable) {
        return 0;
    }
}

/**
 * The combined terrain-factor plane for the box: three planes rasterised, then merged by MAXIMUM.
 *
 * Returns '' when nothing is known, which every reader treats as factor 1,0 throughout.
 *
 * 💣 `is_trial` wird NICHT gefiltert, und der Filter, der hier stand, war der Grund, warum diese Ebene
 * fuer Gebirge leer war: am 2026-07-30 trugen ALLE 17 gebirge-Flaechen den Stempel. Die Erprobung ist
 * am 2026-08-01 abgeschafft (promote_trial mode=keep, 133 Flaechen, Revision 6217), die Spalte steht
 * ueberall auf 0 und wird von nichts mehr gelesen. Wer den Filter wieder einzieht, macht gezeichnete
 * Gebirge fuer den A* unsichtbar, ohne dass irgendwo ein Fehler auftaucht -- genauso, wie es
 * `AND a.is_trial = 0` in water-areas.php mit dem Wasser getan hat. Zeilen selbst zaehlen.
 *
 * 🔴 SEIT DEM 14.08.2026 LIEST SIE `terrain_speed_factor`, NICHT MEHR `offroad_factor` (Entwurf
 * 2026-08-07-tempowerte-design.md §7). Der Unterschied ist die LESART, nicht nur die Spalte:
 * `offroad_factor` war ein gewaehlter Multiplikator („Gebirge bremst 2,2fach"), `terrain_speed_factor`
 * ist die Quellenzahl der GA („auf Gebirge kommt man mit 0,20 der Strassenleistung voran", S. 120-123).
 * Die Ebene traegt weiterhin den MULTIPLIKATOR, also `Basis ÷ Faktor` -- Gebirge 0,75 ÷ 0,20 = 3,75.
 *
 * 💣 DER FILTER IST „LANGSAMER ALS OFFENER BODEN", nicht „groesser als 1". Die Basis ist 0,75, nicht
 * 1,00: eine Art mit genau 0,750 IST offener Boden und gehoert nicht in die Ebene, und eine mit 0,900
 * waere schneller als er. `NULL` faellt heraus wie frueher die 1,00 -- es heisst „keine eigene
 * Aussage", nicht „ausdruecklich wie offener Boden".
 *
 * ⚠️ Areas WITHOUT a landscape type, and types with no factor of their own, are simply not written
 * into the plane and read as 1,0 everywhere.
 */
function avesmapsOffroadLoadFactorPlane(PDO $pdo, array $box): string
{
    try {
        $base = avesmapsTravelValuesOffroadBaseFactor();
        $statement = $pdo->prepare(
            'SELECT r.kind, a.geometry_geojson, a.min_x, a.min_y, a.max_x, a.max_y, t.terrain_speed_factor
               FROM ecosystem_area a
               INNER JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
               INNER JOIN ecosystem_region_type t ON t.kind = r.kind AND t.type_key = r.region_type
              WHERE a.is_active = 1
                AND t.terrain_speed_factor IS NOT NULL
                AND t.terrain_speed_factor > 0
                AND t.terrain_speed_factor < :base
                AND a.min_x <= :max_x AND a.max_x >= :min_x
                AND a.min_y <= :max_y AND a.max_y >= :min_y'
        );
        $statement->execute([
            'base' => $base,
            'min_x' => $box['min_x'], 'min_y' => $box['min_y'],
            'max_x' => $box['max_x'], 'max_y' => $box['max_y'],
        ]);

        $byKind = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $kind = (string) ($row['kind'] ?? '');
            if (!in_array($kind, AVESMAPS_ROUTE_OFFROAD_KINDS, true)) { continue; }
            $geometry = json_decode((string) ($row['geometry_geojson'] ?? ''), true);
            if (!is_array($geometry)) { continue; }
            $speedFactor = (float) $row['terrain_speed_factor'];
            if ($speedFactor <= 0.0) { continue; }
            $byKind[$kind][] = [
                'prepared' => avesmapsPrepareRouteAreas([[
                    'geometry' => $geometry,
                    'min_x' => (float) $row['min_x'], 'min_y' => (float) $row['min_y'],
                    'max_x' => (float) $row['max_x'], 'max_y' => (float) $row['max_y'],
                ]]),
                // Die Ebene traegt den Multiplikator, die Spalte die Quellenzahl.
                'factor' => $base / $speedFactor,
            ];
        }
        if ($byKind === []) { return ''; }

        $planes = [];
        foreach (AVESMAPS_ROUTE_OFFROAD_KINDS as $kind) {
            if (isset($byKind[$kind])) { $planes[] = avesmapsOffroadRasteriseFactors($box, $byKind[$kind]); }
        }

        return avesmapsOffroadCombineFactorPlanes($planes);
    } catch (Throwable) {
        return '';
    }
}

/**
 * DER EINE ERZEUGER DER VIER GITTEREBENEN EINER QUERFELDEIN-SUCHE.
 *
 * 🔴 DREI ZUSAMMENBAU-STELLEN, EIN ERZEUGER. Vor dem 30.08.2026 standen dieselben vier Zeilen
 * dreimal da -- in avesmapsAttachOffroadPointToGraph, in avesmapsConnectOffroadPoints und in
 * avesmapsFindOffroadPathBetween. Der Bach-Aufschlag waere die fuenfte Regel gewesen, die man an
 * drei Stellen einzeln haette nachziehen muessen, und dieses Haus hat genau das zweimal bezahlt:
 * die Verkehrsmittel-Sperre (14.08.2026, zwei von vier Erzeugern) und die Ausstiegsregel
 * (15.08.2026, einer von drei). „Eine Regel, die einen von mehreren Erzeugern bindet, ist keine
 * Regel." Gewacht von __tests__/bach-furt-test.php, das die Stellen zur LAUFZEIT im Quelltext
 * ZAEHLT -- deshalb steht hier keine Zahl.
 *
 * 🔴 DIE WAND-LINIEN KOMMEN MIT ZURUECK. avesmapsOffroadStraightPathIfDry geht am Raster VORBEI
 * (das ist ihr Sinn) und muss die Fluesse eigens gefragt bekommen. Nimmt der Aufrufer sie aus
 * DIESEM Rueckgabewert, kann er sie nicht mit der falschen Haelfte fuellen -- das Auspacken des
 * Gewaesser-Bunds geschieht damit an genau einer Stelle.
 *
 * ⚠️ Ohne PDO bleibt alles inert (leere Faktorebene, keine Hoehen) -- der entworfene Fehlermodus
 * dieses Moduls, kein stilles Loch.
 * 🔴 DER GELAENDE-NOTSCHALTER GILT AUCH HIER (V11 §8.3): „Gelaende aus" muss ueberall dasselbe
 * bedeuten.
 *
 * @param array $gewaesser ['wand' => Flusslinien, 'furt' => Bachlinien], aus
 *                         avesmapsCollectRouteRiverBarrierLines.
 * @return array{blocked:string, factors:string, rasters:array, heights:?string, wand:list<array>}
 */
function avesmapsOffroadBuildPlanes(
    array $box,
    array $water,
    ?PDO $pdo,
    array $gewaesser = [],
    bool $terrainEnabled = true
): array {
    $wand = avesmapsOffroadBarrierLines($gewaesser);
    $furt = avesmapsOffroadFordLines($gewaesser);

    $blocked = avesmapsOffroadRasteriseBlocked($box, $water, $wand);
    $furtPlane = avesmapsOffroadRasteriseFurtPlane($box, $furt);
    // Die blanken Punktlisten der Furten -- die Gerade-Abkuerzung braucht Geometrie, keine Ebene.
    $furtLinien = array_map(static fn(array $e): array => $e['coords'], avesmapsOffroadFordLines(['furt' => $furt]));
    // 🔴 DER BACH LIEGT IN DER FAKTOR-EBENE, NICHT IN DER SPERRE. Owner 30.08.2026: „ein bach wird
    // ueberquert werden koennen, aber nur mit etwas erschwernis". Der Aufschlag kommt NACH der
    // Landschaft und ueberlagert sie per Maximum -- eine Bachzelle im Sumpf bleibt Sumpf, wenn der
    // teurer ist.
    // 🔴 UND WATEN BREMST WIEDER (Owner 31.08.2026: „ja, waten soll bremsen"). Der Zell-Aufschlag ist
    // zurueck -- aber NEBEN dem Querungspreis, nicht statt seiner. Ohne ihn war das Mitlaufen im
    // Bachbett gratis, und der Querungspreis lief ins Leere: wer nie herauskommt, quert auch nie.
    // ⚠️ Ueberlagert per Maximum wie jeder Untergrund: eine Bachzelle im Sumpf bleibt Sumpf, wenn der
    // teurer ist.
    $factors = avesmapsOffroadRasteriseWatFactor(
        $box,
        $pdo instanceof PDO ? avesmapsOffroadLoadFactorPlane($pdo, $box) : '',
        $furt
    );
    $rasters = $terrainEnabled && $pdo instanceof PDO ? avesmapsOffroadLoadHeightRasters($pdo, $box) : [];

    return [
        'blocked' => $blocked,
        'factors' => $factors,
        'rasters' => $rasters,
        'heights' => $rasters === [] ? null : avesmapsOffroadSampleHeights($box, $rasters),
        'wand' => $wand,
        // 🔴 EIN BUENDEL: das Gatter (Ebene) und die Genauigkeit (Linien) gehoeren zusammen. Wer nur
        // eines weiterreicht, bekommt entweder gar keinen Querungspreis oder einen unbezahlbaren Test.
        'furt' => ['plane' => $furtPlane, 'linien' => avesmapsOffroadFordLines(['furt' => $furt])],
        'furtlinien' => $furtLinien,
    ];
}
