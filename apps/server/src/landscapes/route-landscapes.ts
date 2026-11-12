import {
    landscapeReaderName,
    renderZoomForBand,
    ROUTE_LANDSCAPE_LIMITS,
    type RouteLandscapeRegion,
    type MapBounds,
    type RouteLandscapesResponse,
} from "@avesmaps3d/shared";
import { routeTerritories } from "./route-territories.ts";
import { sprachenDerEtappen } from "../sprachen/an-der-stelle.ts";
import { sprachenMindestanteil } from "../sprachen/treffer.ts";
import { withStatementTimeout, type Database, type Queryable } from "../database.ts";

/**
 * Welche Landschaften eine Route durchquert (WI-0035, Legacys „Führt durch“, V10).
 *
 * Je Etappe schneidet PostGIS die gefahrenen Linien mit den Flächen, die für Wege zählen:
 * `affects_paths` (aus bei Kontinent, Küste und Meer, Legacys „bleiben unsichtbar“), aktiv. Mehrere
 * Flächen derselben Region werden vorher vereinigt, damit sich Überlappungen nicht doppelt zählen.
 * Gemessen p50 54 ms für Havena–Gareth–Festum–Khunchom (45 Etappen), 14 ms für Gareth–Perricum, mit
 * dem vorhandenen `region_area_geom_gist`; der größte erlaubte Körper (927 KB, 1 000 Etappen) braucht
 * rund 2 s.
 *
 * 🔴 LIEST NUR. Dieselben Flächen liest der Gang querfeldein für seine Bremse, mit demselben Filter.
 *
 * 🔴 Kostenschranke (WI-0037, S-01): Die Abfragen laufen in einer Transaktion mit
 * `SET LOCAL statement_timeout` von 2 s (Claudio, Handover `2026-09-24-stage-rollout-6b80163`). Ein
 * Abbruch ist `57014`, mitten in GEOS `XX000` mit „InterruptedException“; beides wird über den
 * Fehlerhandler 503 mit `Retry-After`. Die Verbindung hält danach wieder die 5 s des Servers.
 *
 * 🔴 JIT AUS, nur in dieser Transaktion (WI-0065, Nachtrag; Claudio, Handover `2026-10-01-stage-rollout-5114892`):
 * Der Planer schätzt die Gebiete einer Route auf 87 152 statt 287 Zeilen und die Landschaftsabfrage auf
 * Kosten von 2 bis 13 Mio. - beide weit über allen Schwellen (`jit_above_cost` 100 000, Inlining und Optimierung
 * je 500 000). Auf Stage gingen so 0,66 von 1,0 s der Gebietsabfrage in die Übersetzung; ohne JIT sind es 0,34 s.
 * Die dritte Abfrage (Regionen, Kosten unter 3 000) liegt unter den Schwellen und bleibt davon unberührt.
 *
 * 🔴 Wer nicht mehr wartet, beschäftigt die Datenbank nicht weiter (WI-0065, Nachtrag): Mit `signal` bricht die
 * laufende Abfrage ab, sobald der Client die Anfrage schließt. Sonst rechnete der Server für jede vom Browser
 * abgebrochene Anfrage weiter, und drei davon belegten die Plätze, die die nächste mit 503 `busy` abwies.
 *
 * Wie eine namenlose Fläche heißt, sagt `landscapeReaderName` in `@avesmaps3d/shared`: Die Karte braucht
 * dieselbe Regel für eine angeklickte Fläche (WI-0043).
 */

/** Eine Etappe als WKT - die Zahlen sind durch das Schema geprüft, anderes kommt nicht hinein. */
function stageWkt(lines: readonly (readonly (readonly [number, number])[])[]): string {
    if (lines.length === 0) return "MULTILINESTRING EMPTY";
    const parts = lines.map((line) => `(${line.map(([x, y]) => `${String(x)} ${String(y)}`).join(",")})`);
    return `MULTILINESTRING(${parts.join(",")})`;
}

/** Wie weit ein Klick heranfährt: wie ein Landschaftstreffer der Suche (`search.ts`, `zoomForKind`). */
const TARGET_ZOOM = renderZoomForBand(3);

export async function routeLandscapes(
    database: Database,
    stages: readonly (readonly (readonly [number, number])[])[][],
    mapDomainId = "aventuria",
    statementMs: number = ROUTE_LANDSCAPE_LIMITS.statementMs,
    signal?: AbortSignal,
): Promise<RouteLandscapesResponse> {
    // Vor der Transaktion: Der Leser der Karteneinstellungen fängt eine fehlende Tafel ab, das bräche eine laufende Transaktion ab.
    const mindestanteil = await sprachenMindestanteil(database);
    return withStatementTimeout(
        database,
        statementMs,
        (transaction) => measure(transaction, stages, mapDomainId, mindestanteil),
        {
            jitOff: true,
            ...(signal ? { signal } : {}),
        },
    );
}

async function measure(
    database: Queryable,
    stages: readonly (readonly (readonly [number, number])[])[][],
    mapDomainId: string,
    mindestanteil: number,
): Promise<RouteLandscapesResponse> {
    const wkts = stages.map((lines) => stageWkt(lines));
    // 💣 20 der 2 499 Flächen aus Legacy sind ungültig (Satz 147359: Schleifen, Löcher außerhalb, zu wenig
    // Punkte), der Silker Hain etwa schneidet sich bei Gareth selbst. Daran brachen ST_Union und
    // ST_Intersection mit „TopologyException“ ab, und die Zeile fehlte still. Repariert wird beim Lesen und
    // nur, was ungültig ist; die Flächen bleiben, wie sie sind (Map Mutation Guard), und eine gültige geht
    // unverändert ein. `structure` statt der Standardreparatur: Überlappt sich eine Fläche selbst, zählt
    // die Überlappung einmal, statt als Loch herauszufallen. ST_IsValidDetail statt ST_IsValid: ohne NOTICE.
    // ⚡ Repariert und vereinigt wird je Region EINMAL je Anfrage, nicht je Etappe: Große Flächen wie „Herz
    // des Kontinents“ kosteten sonst bei jeder Etappe neu. Die Vereinigung aller berührten Flächen einer
    // Region schneidet eine Etappe genau so lang wie die ihrer eigenen - was sie nicht berührt, zählt nichts.
    const rows = await database<{ stage: number; region: string | null; length: number; inside: number | null }[]>`
        WITH stage AS (
            SELECT (t.n - 1)::int AS stage, ST_GeomFromText(t.wkt) AS geom
            FROM unnest(${wkts}::text[]) WITH ORDINALITY AS t(wkt, n)
        ), landscape AS MATERIALIZED (
            SELECT r.public_id::text AS region,
                   ST_Union(CASE WHEN (ST_IsValidDetail(a.geom)).valid THEN a.geom
                            ELSE ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3) END) AS geom
            FROM region_area a
            JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden
            WHERE a.map_domain_id = ${mapDomainId}
              AND a.is_active AND a.affects_paths
              AND EXISTS (SELECT 1 FROM stage s WHERE a.geom && s.geom AND ST_Intersects(a.geom, s.geom))
            GROUP BY r.public_id
        ), hit AS (
            SELECT s.stage, l.region, l.geom AS areas
            FROM stage s
            JOIN landscape l ON l.geom && s.geom AND ST_Intersects(l.geom, s.geom)
        )
        SELECT s.stage, h.region, ST_Length(s.geom) AS length,
               ST_Length(ST_Intersection(s.geom, h.areas)) AS inside
        FROM stage s
        LEFT JOIN hit h ON h.stage = s.stage
        LEFT JOIN LATERAL (
            SELECT line.path[1] AS part,
                   MIN(LEAST(ST_LineLocatePoint(line.geom, ST_StartPoint(piece.geom)),
                             ST_LineLocatePoint(line.geom, ST_EndPoint(piece.geom)))) AS position
            FROM ST_Dump(s.geom) line
            CROSS JOIN LATERAL ST_Dump(ST_CollectionExtract(ST_Intersection(line.geom, h.areas), 2)) piece
            -- Der Kasten je LINIENSTÜCK zuerst (wie route-territories.ts, Qualitätsreview 2026-10-12): Oben steht der Kasten nur
            -- gegen die ganze Etappe; eine Etappe mit vielen Stücken schnitt sonst jede Fläche gegen jedes Stück. Notwendige
            -- Bedingung für einen Schnitt, also dieselben Zeilen.
            WHERE h.areas && line.geom AND ST_Length(piece.geom) > 0
            GROUP BY line.path[1]
            ORDER BY line.path[1]
            LIMIT 1
        ) first_hit ON TRUE
        ORDER BY s.stage, first_hit.part, first_hit.position, h.region
    `;

    // Die Sprachen je Etappe (WI-0261, Betreiber 2026-10-31): die Zeile „Sprachen“ der Etappe, zwischen „Derographie“ und „Gebiete“.
    const sprachen = await sprachenDerEtappen(database, wkts, mapDomainId, mindestanteil);
    const result: RouteLandscapesResponse = {
        territories: await routeTerritories(database, wkts, mapDomainId),
        regions: {},
        stages: stages.map(() => ({ length: 0, in: [] })),
        ...(sprachen.some((etappe) => etappe.length > 0) ? { sprachen } : {}),
    };
    for (const row of rows) {
        const stage = result.stages[row.stage];
        if (!stage) continue;
        stage.length = Number(row.length);
        // Gerundet kann die gedeckte Länge die Etappe um ein Haar überschreiten.
        if (row.region !== null && row.inside !== null && Number(row.inside) > 0) {
            stage.in.push([row.region, Math.min(Number(row.inside), stage.length)]);
        }
    }

    const ids = [...new Set(rows.flatMap((row) => (row.region === null ? [] : [row.region])))];
    if (ids.length === 0) return result;
    // 🔴 JEDES gebundene Label trägt das Ziel, nicht nur das primäre (WI-0043, Legacy
    // `canFocusLandscapeOnMap` → `findLabelEntryByEcosystemRegion`, avesmaps@4938850
    // `js/routing/route-plan.js`, `js/map-features/map-features-labels.js:1110`). Mit nur
    // `primary_label_id` war „Weiden“ im Planer kein Knopf: Sein Label hängt über `region_id`, ein
    // primäres ist nicht benannt. Gibt es mehrere, gewinnt das primäre, dann die kleinste Kennung -
    // Legacy sortiert seine Liste ebenso nach `publicId`, damit die Wahl nicht an der Ladereihenfolge hängt.
    // 🔴 Ohne Label, aber mit echtem Namen, ist der Name trotzdem ein Knopf (WI-0047, E1; Betreiber
    // 2026-09-26 zur Suche: „sie soll natürlich auch flächen ohne beschriftung finden“). Das Ziel ist dann ein
    // Punkt auf der größten Fläche, derselbe wie in der Suche; eine ungültige Fläche wird dafür repariert.
    const regions = await database<
        {
            id: string;
            name: string;
            type: string;
            label: string | null;
            x: number | null;
            y: number | null;
            min_x: number | null;
            min_y: number | null;
            max_x: number | null;
            max_y: number | null;
        }[]
    >`
        SELECT r.public_id::text AS id, r.name, COALESCE(r.region_type, '') AS type,
               l.public_id::text AS label,
               COALESCE(ST_X(l.geom), ST_X(flaeche.punkt)) AS x, COALESCE(ST_Y(l.geom), ST_Y(flaeche.punkt)) AS y,
               -- Alle aktiven Flächen der Region: Ein Klick passt sie ganz ein, wie die Suche (WI-0044).
               ST_XMin(flaechen.box) AS min_x, ST_YMin(flaechen.box) AS min_y,
               ST_XMax(flaechen.box) AS max_x, ST_YMax(flaechen.box) AS max_y
        FROM region r
        LEFT JOIN LATERAL (
            SELECT ST_Extent(a.geom) AS box FROM region_area a WHERE a.region_id = r.id AND a.is_active
        ) flaechen ON TRUE
        LEFT JOIN LATERAL (
            SELECT m.public_id, m.geom
            FROM map_label m
            WHERE m.is_active AND (m.id = r.primary_label_id OR m.region_id = r.id)
            ORDER BY (m.id = r.primary_label_id) DESC NULLS LAST, m.public_id
            LIMIT 1
        ) l ON TRUE
        LEFT JOIN LATERAL (
            SELECT ST_PointOnSurface(CASE WHEN (ST_IsValidDetail(a.geom)).valid THEN a.geom
                                     ELSE ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3) END) AS punkt
            FROM region_area a
            WHERE a.region_id = r.id AND a.is_active AND l.public_id IS NULL
            ORDER BY ST_Area(a.geom) DESC, a.public_id
            LIMIT 1
        ) flaeche ON TRUE
        WHERE r.public_id = ANY(${ids}::uuid[])
    `;
    for (const region of regions) {
        const name = landscapeReaderName(region.name, region.type);
        // Ein Griff ohne Label bleibt Text: Viele namenlose Wälder heißen in der Zeile „Wald“ und stehen dort
        // als EIN Eintrag - ein Knopf wählte davon einen beliebigen.
        const clickable = region.label !== null || name !== null;
        const entry: RouteLandscapeRegion = {
            name,
            type: region.type,
            target:
                clickable && region.x !== null && region.y !== null
                    ? {
                          ...(region.label === null ? {} : { label: region.label }),
                          x: Number(region.x),
                          y: Number(region.y),
                          zoom: TARGET_ZOOM,
                          ...(region.min_x === null ||
                          region.min_y === null ||
                          region.max_x === null ||
                          region.max_y === null
                              ? {}
                              : {
                                    bounds: [
                                        Number(region.min_x),
                                        Number(region.min_y),
                                        Number(region.max_x),
                                        Number(region.max_y),
                                    ] as MapBounds,
                                }),
                      }
                    : null,
        };
        result.regions[region.id] = entry;
    }
    return result;
}
