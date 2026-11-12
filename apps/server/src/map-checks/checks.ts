import {
    AVENTURIA,
    formFehlerArt,
    isPathHandle,
    type InvalidAreasResult,
    type LooseEndsResult,
    type MapCheck,
    type MapCheckResult,
    type NoWikiResult,
    type PathsApartResult,
    type UnconnectedResult,
    type UphillRiversResult,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { netzOptionen } from "../routing/einstellungen.ts";
import { loadLooseEndpoints, type LooseEndpointReport } from "../routing/loose-endpoints.ts";
import {
    buildRouteNetwork,
    buildTopologyNetwork,
    loadRouteGraphRows,
    storedLine,
    type RouteNetwork,
} from "../routing/network.ts";
import { unmetSpots, type UnmetFindings } from "../routing/topology-findings.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";

/**
 * Die Funde der Prüfhaken im Auge (WI-0131 Stufe 1; Vertrag `packages/shared/src/map-checks.ts`).
 *
 * 🔴 EINE RECHNUNG: Jeder Haken ruft den Prüfer, der dieselbe Frage schon beantwortet, und rechnet nichts nach. Diese Datei liest
 * nur, übersetzt Kennungen und legt die Geometrie dazu. Sie schreibt nie.
 *
 * 🔴 Hinaus gehen nur öffentliche Kennungen. Der Befund „Flüsse bergaufwärts“ führte bis WI-0131 die interne `path.id`
 * (`constraint-findings.ts`); ein Bericht, der vor dem Fix entstand, trägt sie noch und wird hier übersetzt.
 */

type Line = [number, number][];
interface GeometryRow {
    id: string;
    name: string;
    geometry: string;
}

/** Die Linien einer Weggeometrie (`LineString` oder `MultiLineString`) in Kartenkoordinaten. */
export function linesOf(geometry: string): Line[] {
    const parsed = JSON.parse(geometry) as { type: string; coordinates: unknown };
    if (parsed.type === "LineString") return [parsed.coordinates as Line];
    if (parsed.type === "MultiLineString") return parsed.coordinates as Line[];
    return [];
}

// ═══ Flüsse bergaufwärts ════════════════════════════════════════════════════════════════════════════════════════════

/** Der Befund der unabhängigen Prüfung des fertigen Höhenrasters (`verifyDomainRaster`, `constraint-findings.ts`). */
export const UPHILL_FINDING_CODE = "gelaende/fluss_steigt";

interface StoredFinding {
    code?: unknown;
    objects?: { publicId?: unknown }[];
    notes?: unknown[];
}

/**
 * Welche Flüsse der Befund nennt, mit ihrem Anstieg. Objekte und Notizen entstehen aus derselben Liste in derselben Reihenfolge
 * (`constraintFindings`), die Notiz endet auf „Anstieg <Zahl> Schritt“.
 *
 * 🪤 Die zwei erlaubten Anstiege an geschützten Gipfelkernen stehen NICHT in diesem Befund (`risingRivers` führt sie getrennt als
 * `atPeaks`), sie werden also auch nicht markiert (Blatt 1).
 */
export function uphillRiverRefs(findings: unknown): { ref: string; rise: number | null }[] {
    if (!Array.isArray(findings)) return [];
    const finding = (findings as StoredFinding[]).find((entry) => entry.code === UPHILL_FINDING_CODE);
    if (!finding || !Array.isArray(finding.objects)) return [];
    return finding.objects.flatMap((object, index) => {
        if (typeof object.publicId !== "string" || object.publicId === "") return [];
        const note = finding.notes?.[index];
        const match = typeof note === "string" ? /Anstieg (-?\d+(?:\.\d+)?) Schritt$/.exec(note) : null;
        return [{ ref: object.publicId, rise: match?.[1] === undefined ? null : Number(match[1]) }];
    });
}

/** Die Befunde des gültigen Domain-Rasters (dieselbe Wahl wie das Routing, `terrain-load.ts`); ohne Raster keine. */
async function currentDomainFindings(database: Queryable, mapDomainId: string): Promise<unknown> {
    const [row] = await database<{ findings: unknown }[]>`
        SELECT t.report -> 'findings' AS findings FROM terrain_domain_raster t
        JOIN terrain_dem d ON d.map_domain_id = t.map_domain_id AND d.domain_fingerprint = t.fingerprint
        WHERE t.map_domain_id = ${mapDomainId} AND d.is_current
        ORDER BY t.derived_at DESC, d.created_at DESC LIMIT 1
    `;
    return row?.findings ?? [];
}

/**
 * Die Flüsse zu den Kennungen des Befunds, je öffentlich. Ein älterer Bericht nennt `path.id`, ein neuer `public_id`; beide
 * Schlüsselräume können sich nicht überschneiden (Zahl gegen UUID). Ein inzwischen stillgelegter Weg fällt heraus.
 */
export async function loadRiverLines(
    database: Queryable,
    mapDomainId: string,
    refs: readonly { ref: string; rise: number | null }[],
): Promise<UphillRiversResult["rivers"]> {
    if (refs.length === 0) return [];
    const keys = refs.map((entry) => entry.ref);
    const rows = await database<(GeometryRow & { internal: string })[]>`
        SELECT p.public_id::text AS id, p.id::text AS internal, p.name, ST_AsGeoJSON(p.geom, 5) AS geometry
        FROM path p
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active
          AND (p.public_id::text = ANY(${keys}) OR p.id::text = ANY(${keys}))
    `;
    const byRef = new Map(rows.flatMap((row) => [[row.id, row] as const, [row.internal, row] as const]));
    const seen = new Set<string>();
    return refs.flatMap((entry) => {
        const row = byRef.get(entry.ref);
        if (!row || seen.has(row.id)) return [];
        seen.add(row.id);
        return [{ id: row.id, name: row.name, rise: entry.rise, lines: linesOf(row.geometry) }];
    });
}

export async function uphillRivers(database: Queryable, mapDomainId: string): Promise<UphillRiversResult> {
    const refs = uphillRiverRefs(await currentDomainFindings(database, mapDomainId));
    return { check: "uphill-rivers", rivers: await loadRiverLines(database, mapDomainId, refs) };
}

// ═══ Offene Wegenden ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Was die Messung der losen Wegenden findet, als Ringe und rote Wege (Legacy `map-features-open-path-check.js`): jedes Kantenende
 * ohne genauen Wegkontakt über `LOOSE_DISTANCE` neben seinem Ort, der Weg ganz. Seit WI-0132 Release N auf der Topologie ohne
 * Kreuzungen; ein Wegende ohne Ort und ohne Wegkontakt ist dort eine Sackgasse und erscheint unter „Wege treffen sich nicht“.
 * 🔴 Nur als Zahl (Entscheidung B der Koordination 2026-10-10, WI-0132 §10.6): die Treffpunkte mit genauem Kontakt, die der
 * Ortskasten aufnimmt (`absorbed_ends`), und die Wege ohne Kante (`looped_paths`).
 */
export function looseEndsFrom(
    report: Pick<LooseEndpointReport, "loose" | "detached" | "absorbed">,
    paths: readonly GeometryRow[],
): LooseEndsResult {
    const geometry = new Map(paths.map((row) => [row.id, row]));
    const ends: LooseEndsResult["ends"] = report.loose.map((end) => ({ x: end.x, y: end.y, path: end.pathPublicId }));
    const ids = [...new Set(ends.map((end) => end.path))];
    return {
        check: "loose-ends",
        paths: ids.flatMap((id) => {
            const row = geometry.get(id);
            return row ? [{ id, name: row.name, lines: linesOf(row.geometry) }] : [];
        }),
        ends,
        absorbed_ends: report.absorbed,
        looped_paths: report.detached.length,
    };
}

export async function looseEnds(database: Queryable, mapDomainId: string): Promise<LooseEndsResult> {
    const report = await loadLooseEndpoints(database, mapDomainId);
    const ids = [...new Set(report.loose.map((entry) => entry.pathPublicId))];
    const paths =
        ids.length === 0
            ? []
            : await database<GeometryRow[]>`
                  SELECT public_id::text AS id, name, ST_AsGeoJSON(geom, 5) AS geometry
                  FROM path WHERE map_domain_id = ${mapDomainId} AND is_active AND public_id::text = ANY(${ids})
              `;
    return looseEndsFrom(report, paths);
}

// ═══ Unverbunden ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Orte und technische Knoten ohne jede Kante im Netz (`buildRouteNetwork`), in Legacys Regel (`computeLocationConnectivityIndex`,
 * `js/routing/route-graph-routing.js`): kein Wegarm, nicht am Ende einer Kraftlinie (Nodices hängen an Kraftlinien, nicht an Wegen),
 * nicht verborgen (Owner Legacy 2026-10-09: „wer einen Ort verbirgt, lässt ihn meist absichtlich ohne Weg“). Ein technischer Knoten
 * ohne Kante entsteht nur an einem Weg, der ganz an einem Knoten hängt (WI-0132 Release N).
 */
export function unconnectedFrom(network: RouteNetwork, onPowerline: ReadonlySet<string>): UnconnectedResult {
    const linked = new Set(network.links.flatMap((link) => [link.from, link.to]));
    return {
        check: "unconnected",
        nodes: [...network.nodes.values()]
            .filter((node) => !linked.has(node.id) && !onPowerline.has(node.id) && !node.isHidden)
            .map((node) => ({
                id: node.id,
                kind: node.kind,
                name: node.kind === "place" ? node.name : null,
                x: node.x,
                y: node.y,
            })),
    };
}

export async function unconnected(database: Queryable, mapDomainId: string): Promise<UnconnectedResult> {
    const { places, paths } = await loadRouteGraphRows(database, mapDomainId);
    const powerlines = await database<{ id: string }[]>`
        SELECT from_public_id::text AS id FROM powerline WHERE map_domain_id = ${mapDomainId} AND is_active
        UNION SELECT to_public_id::text FROM powerline WHERE map_domain_id = ${mapDomainId} AND is_active
    `;
    // Dasselbe Netz wie der Router: mit den freigegebenen Kenngrößen der Wegfindung (WI-0214), nicht mit den Vorgaben.
    const netz = netzOptionen(await wegfindungswerte(database));
    return unconnectedFrom(buildRouteNetwork(places, paths, netz), new Set(powerlines.map((row) => row.id)));
}

// ═══ Wege treffen sich nicht ════════════════════════════════════════════════════════════════════════════════════════

/** Fünf Stellen genügen für die Lage (der Schlüssel der Topologie), sechs für den Abstand („knapp verfehlt“ ist 0,001). */
const round = (value: number, digits: number): number => Number(value.toFixed(digits));

/**
 * Die Stellen aus `unmetSpots` (WI-0132 P2), als Antwort. Sie liegen auf derselben Topologie wie der Router; der Haken zeigt nur
 * und verbindet nichts. „knapp verfehlt“ (`near_miss`) unter 0,001 E macht die Rundungsfälle leicht auffindbar.
 */
export function pathsApartFrom({ spots, atPlace }: UnmetFindings): PathsApartResult {
    return {
        check: "paths-apart",
        at_place: atPlace,
        spots: spots.map((spot) => ({
            kind: spot.kind,
            x: round(spot.x, 5),
            y: round(spot.y, 5),
            path: spot.path,
            other: spot.other,
            distance: spot.distance === null ? null : round(spot.distance, 6),
            near_miss: spot.nearMiss,
        })),
    };
}

export async function pathsApart(database: Queryable, mapDomainId: string): Promise<PathsApartResult> {
    const { places, paths } = await loadRouteGraphRows(database, mapDomainId);
    const netz = netzOptionen(await wegfindungswerte(database));
    const { network, topology } = buildTopologyNetwork(places, paths, netz);
    const lines = paths.map((row) => ({ publicId: row.public_id, coordinates: storedLine(row) }));
    return pathsApartFrom(unmetSpots(topology, network, lines, { nearMiss: netz.endSnap, meet: netz.endpointBox }));
}

// ═══ Keine Wiki-Zuweisung ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Orte und benannte Wege ohne Eintrag in der Zuordnungstafel X2 (`wiki_key_assignment`), Legacys Regel (`wiki-zuweisung.js`): Gezählt
 * wird der Wiki-Key, nie eine bloße Adresse. Kreuzungen sind keine Orte (eigene Tabelle). Ein Weg, der nur einen Griff trägt
 * (`isPathHandle`, Legacys `shouldShowRoutePathDisplayName`), kann per Konstruktion keinen Artikel haben und ist nicht gemeint
 * (Owner Legacy 2026-09-01).
 */
export async function noWiki(database: Queryable, mapDomainId: string): Promise<NoWikiResult> {
    const places = await database<{ id: string }[]>`
        SELECT p.public_id::text AS id FROM place p
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active
          AND NOT EXISTS (SELECT 1 FROM wiki_key_assignment a
                          WHERE a.is_active AND a.legacy_art = 'siedlung' AND a.object_public_id = p.public_id)
        ORDER BY p.public_id
    `;
    const paths = await database<{ id: string; name: string; subtype: string }[]>`
        SELECT p.public_id::text AS id, p.name, p.subtype FROM path p
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active
          AND NOT EXISTS (SELECT 1 FROM wiki_key_assignment a
                          WHERE a.is_active AND a.legacy_art = 'weg' AND a.object_public_id = p.public_id)
        ORDER BY p.public_id
    `;
    return {
        check: "no-wiki",
        places: places.map((row) => row.id),
        paths: paths.filter((row) => !isPathHandle(row.name, row.subtype)).map((row) => row.id),
    };
}

// ═══ Flächen kreuzen sich ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Aktive Flächen aktiver Gebiete und Landschaften, die PostGIS ungültig nennt (Vali 2026-11-10: „kann man die dinger anzeigen?“). Dieselbe
 * Prüfung wie beim Speichern einer Form (`territory-reshape.ts`, `landscape-reshape.ts`): `ST_IsValidDetail`, der Grund übersetzt mit
 * `formFehlerArt`. Eine solche Fläche bleibt bearbeitbar; der Haken zeigt nur, wo sie sich kreuzt oder berührt. Erst die Gebiete, dann
 * die Landschaften, je nach Namen.
 */
export async function invalidAreas(database: Queryable, mapDomainId: string): Promise<InvalidAreasResult> {
    const rows = await database<
        {
            kind: "territory" | "landscape";
            area: string;
            owner: string;
            name: string;
            grund: string | null;
            x: number | null;
            y: number | null;
        }[]
    >`
        SELECT f.kind, f.area, f.owner, f.name, (d.befund).reason AS grund,
               ST_X((d.befund).location) AS x, ST_Y((d.befund).location) AS y
          FROM (
                SELECT 'territory' AS kind, 0 AS folge, a.public_id::text AS area, t.public_id::text AS owner, t.name, a.geom
                  FROM territory_area a JOIN territory t ON t.id = a.territory_id
                 WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND t.is_active
                UNION ALL
                SELECT 'landscape', 1, a.public_id::text, r.public_id::text, r.name, a.geom
                  FROM region_area a JOIN region r ON r.id = a.region_id
                 WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND r.is_active
               ) AS f
         CROSS JOIN LATERAL (SELECT ST_IsValidDetail(f.geom) AS befund) AS d
         WHERE NOT (d.befund).valid
         ORDER BY f.folge, f.name, f.area
    `;
    return {
        check: "invalid-areas",
        // Ohne Stelle kann der Haken nichts zeigen; GEOS nennt bei einer ungültigen Fläche immer eine.
        spots: rows.flatMap((row) =>
            row.x === null || row.y === null
                ? []
                : [
                      {
                          kind: row.kind,
                          area: row.area,
                          owner: row.owner,
                          name: row.name,
                          art: formFehlerArt(row.grund),
                          x: row.x,
                          y: row.y,
                      },
                  ],
        ),
    };
}

// ═══ Ein Einstieg ═══════════════════════════════════════════════════════════════════════════════════════════════════

const LOADERS: Record<MapCheck, (database: Queryable, mapDomainId: string) => Promise<MapCheckResult>> = {
    "uphill-rivers": uphillRivers,
    "loose-ends": looseEnds,
    unconnected,
    "paths-apart": pathsApart,
    "no-wiki": noWiki,
    "invalid-areas": invalidAreas,
};

/** Die Funde einer Prüfung, in einer Lesetransaktion: Alle Teile einer Antwort stammen aus demselben Stand. */
export async function loadMapCheck(
    database: Database,
    check: MapCheck,
    mapDomainId: string = AVENTURIA.mapDomain,
): Promise<MapCheckResult> {
    return database.begin("isolation level repeatable read read only", (tx) => LOADERS[check](tx, mapDomainId));
}
