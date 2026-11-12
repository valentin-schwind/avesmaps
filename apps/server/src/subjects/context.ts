import {
    AREA_CONTAINED_SHARE,
    AREA_LANDSCAPE_LIMIT,
    AREA_LANDSCAPE_MIN_SHARE,
    AREA_TERRITORY_CHAIN_LIMIT,
    AREA_TERRITORY_MIN_SHARE,
    AREA_LOOKUP_LAYERS,
    MAP_POINT_RIVER_REACH,
    SUBJECT_LIMITS,
    landscapeReaderName,
    pathChainKey,
    type ContextClimateBand,
    type ContextLandscape,
    type ContextRiver,
    type ContextTerritory,
    type SubjectContext,
    type SubjectRelation,
} from "@avesmaps3d/shared";
import { queryAreasAt, queryRiverDistances } from "../areas/area-lookup.ts";
import { withStatementTimeout, type Database } from "../database.ts";
import { huelleDerHauptteile } from "./haupt-huelle.ts";
import { routeLandscapes } from "../landscapes/route-landscapes.ts";
import { resolveTerritoryCoats } from "../media/resolver.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";
import {
    SUBJECT_LAYERS,
    canonicalAreaRef,
    territoryChains,
    type SubjectIndex,
    type TerritoryRecord,
} from "./subject-index.ts";

/**
 * Der räumliche Kontext eines Subjects (WI-0063 5.2, 5.4): was sich aus der GEOMETRIE ergibt - Herrschaftsgebiete,
 * Landschaften, Klima, Flüsse -, nie ein direktes Objektattribut und nie mit Quellen. Welche Geometrie zählt, bestimmt die
 * Art des Subjects (Entwurf Abschnitt 5):
 *  - ein Punkt (Ort, Gipfel, Kartenpunkt): der Kontext AM Punkt;
 *  - eine Fläche: der Kontext der GANZEN Fläche, mit Anteilen;
 *  - eine Linie (Weg, Fluss, Kraftlinie): der Kontext des ganzen Verlaufs, in der Reihenfolge des ersten Eintritts -
 *    ein langer Fluss wirkt nicht, als läge er ganz in der Herrschaft des angeklickten Abschnitts.
 *
 * 🔴 Keine zweite räumliche Semantik (WI-0063 10): Flächen und Flüsse unter einem Punkt sind `queryAreasAt` (die Kartenauswahl),
 * Gebiete an einer Linie sind `routeTerritories` und ihre Landschaften `routeLandscapes` (Planer), Gebiete an einem Punkt
 * sind die abgeleiteten Formen `territory_shape` derselben Kacheln.
 */

/** Auf Tausendstel gerundet und in [0, 1]: Anteile sind Lesehilfe, keine Messung. */
function share(value: number): number {
    return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

function contextTerritory(record: TerritoryRecord, shareValue?: number): ContextTerritory {
    return {
        ref: { kind: "territory", id: record.publicId },
        name: record.name,
        ...(record.type === null || record.type === "" ? {} : { type: record.type }),
        ...(shareValue === undefined ? {} : { share: share(shareValue) }),
    };
}

/** Ein leerer Kontext heißt keiner: ein Teil ohne Inhalt steht nicht in der Antwort. */
function nonEmpty(context: SubjectContext): SubjectContext | undefined {
    return Object.keys(context).length > 0 ? context : undefined;
}

/**
 * Die Wappen der Treppe (WI-0094, Legacy `settlementTerritoryCoatThumbMarkup`): 🔴 EINE Abfrage je Antwort für ALLE Gebiete
 * aller Ketten zusammen. Eine Treppe trägt bis zu `AREA_TERRITORY_CHAIN_LIMIT` Ketten; ein Resolver-Aufruf je Zeile wäre N+1.
 *
 * 🔴 Dieselbe Quelle und dieselbe Variantenwahl wie der Panelkopf - der Media Core entscheidet (`policy.ts`), hier wird
 * nichts gefiltert und nichts geraten. Ein Gebiet ohne erlaubtes Wappen behält sein Objekt unverändert: das Feld FEHLT dann,
 * es steht nie leer da.
 */
async function withCoats(database: Database, chains: ContextTerritory[][]): Promise<ContextTerritory[][]> {
    const ids = chains.flatMap((chain) => chain.map((member) => member.ref.id));
    if (ids.length === 0) return chains;
    const coats = await resolveTerritoryCoats(database, ids);
    if (coats.size === 0) return chains;
    return chains.map((chain) =>
        chain.map((member) => {
            const coat = coats.get(member.ref.id);
            return coat === undefined ? member : { ...member, coat };
        }),
    );
}

/**
 * Landschaften als Kontextzeilen: je Gruppe gleichen Namens, gleicher Art und gleicher Ebene EINE Zeile (WI-0047), mit dem
 * kanonischen Ref. Die Reihenfolge der Eingabe bleibt; die Anteile einer Gruppe addieren sich bis höchstens 1.
 */
function landscapeItems(
    index: SubjectIndex,
    entries: readonly { id: string; share?: number }[],
    limit: number,
): ContextLandscape[] {
    const items = new Map<string, ContextLandscape>();
    for (const entry of entries) {
        const record = index.regions.byPublicId.get(entry.id);
        const ref = canonicalAreaRef(index.regions, entry.id);
        if (!record || !ref) continue;
        const known = items.get(record.groupKey);
        if (known) {
            if (entry.share !== undefined) known.share = share((known.share ?? 0) + entry.share);
            continue;
        }
        const name = landscapeReaderName(record.name, record.type);
        items.set(record.groupKey, {
            ref,
            ...(name === null ? {} : { name }),
            ...(record.type === "" ? {} : { type: record.type }),
            layer: record.layer,
            ...(entry.share === undefined ? {} : { share: share(entry.share) }),
        });
    }
    return [...items.values()].slice(0, limit);
}

/** Wie eine Liste zur Fläche steht: ab 99 % „liegt in“, sonst „überlappt“. */
function relationOf(shares: readonly number[]): SubjectRelation {
    return Math.max(0, ...shares) >= AREA_CONTAINED_SHARE ? "lies_in" : "overlaps";
}

// ------------------------------------------------------------------------------------------------------------------
// Punkt
// ------------------------------------------------------------------------------------------------------------------

/**
 * Der Kontext AM Punkt: die Kette der Gebiete (alle Ebenen bis zur Wurzel, nicht nur die des Kamerazooms), alle Landschaften
 * aller Ebenen einschließlich der Seen und das Klimaband. Mit `rivers` auch die Flüsse im Umkreis (Kartenpunkt).
 */
export async function pointContext(
    database: Database,
    index: SubjectIndex,
    point: { x: number; y: number },
    relation: "lies_in" | "at_point",
    options: { rivers: boolean },
    statementMs: number = SUBJECT_LIMITS.statementMs,
): Promise<SubjectContext | undefined> {
    const { areas, rivers, territoryIds, climate } = await withStatementTimeout(
        database,
        statementMs,
        async (transaction) => {
            const found = await queryAreasAt(
                transaction,
                {
                    x: point.x,
                    y: point.y,
                    layers: AREA_LOOKUP_LAYERS,
                    lakes: true,
                    reach: 0,
                },
                index.mapDomainId,
            );
            const near = options.rivers
                ? await queryRiverDistances(transaction, point.x, point.y, MAP_POINT_RIVER_REACH, index.mapDomainId)
                : [];
            const shapes = index.territories.derived
                ? await transaction<{ territory_id: string }[]>`
                  SELECT DISTINCT sh.territory_id::text AS territory_id
                  FROM territory_shape sh
                  WHERE ST_Intersects(sh.geom, ST_SetSRID(ST_MakePoint(${point.x}, ${point.y}), 0))
              `
                : [];
            const bands = await transaction<{ type_key: string; label: string }[]>`
            SELECT b.type_key, t.label
            FROM climate_band b
            JOIN climate_zone_type t ON t.type_key = b.type_key AND t.is_active
            WHERE ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(${point.x}, ${point.y}), 0))
            ORDER BY t.sort_order
        `;
            return {
                areas: found.areas,
                rivers: near,
                territoryIds: shapes.map((row) => Number(row.territory_id)),
                climate: bands,
            };
        },
    );

    const context: SubjectContext = {};
    const chains = territoryChains(index.territories, territoryIds);
    if (chains.length > 0) {
        context.territories = {
            relation,
            chains: await withCoats(
                database,
                chains.map((chain) => chain.map((record) => contextTerritory(record))),
            ),
        };
    }
    // Die kleinste Fläche zuerst (ein Tal im Gebirge ist das Tal), wie die Auswahl der Karte; je Region die kleinste ihrer Flächen.
    const smallest = new Map<string, number>();
    for (const row of areas) {
        const known = smallest.get(row.region_public_id);
        if (known === undefined || row.area < known) smallest.set(row.region_public_id, row.area);
    }
    const ordered = [...smallest.entries()]
        .sort(([leftId, left], [rightId, right]) => left - right || leftId.localeCompare(rightId))
        .map(([id]) => ({ id }));
    const landscapes = landscapeItems(index, ordered, Number.MAX_SAFE_INTEGER);
    if (landscapes.length > 0) context.landscapes = { relation, items: landscapes };
    if (climate.length > 0) {
        context.climate = {
            relation,
            items: climate.map((band): ContextClimateBand => ({ band: band.type_key, label: band.label })),
        };
    }
    if (rivers.length > 0) {
        context.rivers = rivers.map((river): ContextRiver => ({
            ref: { kind: "path", chain: pathChainKey(river.name) },
            name: river.name,
            subtype: river.subtype,
            isBach: river.is_bach,
            distance: river.distance,
        }));
    }
    return nonEmpty(context);
}

// ------------------------------------------------------------------------------------------------------------------
// Fläche
// ------------------------------------------------------------------------------------------------------------------

/** Ein Schnittfehler von GEOS (Präzision der Eingabe): Der Kontext fehlt dann, die Auskunft zum Subject nicht. */
/**
 * Antworten, deren Kontext an der Zeitgrenze scheiterte (WI-0283; Claudio 2026-11-06: 18 Zeitüberschreitungen an einem Abend, fast nur Wege, unter der Last der
 * Geländekette). Die Auskunft kommt trotzdem; nur darf sie nicht in einen Zwischenspeicher: Sie ist einen Augenblick später vollständig. Kein Feld der Antwort, weil
 * die Oberfläche nichts anders zeigt als bei einem Weg ohne Kontext.
 */
const ohneKontext = new WeakSet<object>();
export function alsOhneKontext<T extends object>(antwort: T): T {
    ohneKontext.add(antwort);
    return antwort;
}
export function istOhneKontext(antwort: unknown): boolean {
    return typeof antwort === "object" && antwort !== null && ohneKontext.has(antwort);
}

export function isGeosTopologyError(error: unknown): boolean {
    return error instanceof Error && /TopologyException|GEOS Error(?!: InterruptedException)/.test(error.message);
}

export interface AreaGeometry {
    context: SubjectContext | undefined;
    /**
     * Ausschnitt und Punkt in `aventuria-v1`; `null` ohne aktive Fläche. Der Ausschnitt umfasst die größten Teile, die zusammen
     * `AREA_HAUPTANTEIL` der Fläche tragen, nicht ferne Splitter (Claudio 2026-10-30, Bornland: vier Splitter spannten die halbe Karte auf).
     */
    extent: { x: number; y: number; bounds: [number, number, number, number] } | null;
}

type AreaRow =
    | { kind: "territory"; payload: { id: string; share: number } }
    | { kind: "landscape"; payload: { id: string; share: number } }
    | { kind: "climate"; payload: { band: string; label: string; share: number } }
    | {
          kind: "extent";
          payload: { x: number; y: number; teile: [number, number, number, number, number][] };
      };

/** Der Anteil der Fläche, den der Ausschnitt einer Gegend mindestens trägt; Splitter zählen kaum, Inselgruppen bleiben drin. */
export const AREA_HAUPTANTEIL = 0.95;

/**
 * Der Kontext einer FLÄCHE (Region samt Gruppe): ihre Gesamtform wird mit den Gebieten (aktuelle Form je Gebiet, größte Form
 * über alle Bänder), den Landschaften und den Klimabändern geschnitten. 💣 Ungültige Legacy-Flächen (20 von 2.499) werden
 * beim Lesen repariert und nur, was ungültig ist (`structure`, wie bei den Landschaften der Route).
 */
export async function areaGeometry(
    database: Database,
    index: SubjectIndex,
    regionIds: readonly string[],
    statementMs: number = SUBJECT_LIMITS.geometryStatementMs,
): Promise<AreaGeometry> {
    const rows = await withStatementTimeout(
        database,
        statementMs,
        (transaction) => transaction<AreaRow[]>`
            WITH subject AS MATERIALIZED (
                SELECT ST_Union(CASE WHEN (ST_IsValidDetail(a.geom)).valid THEN a.geom
                                ELSE ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3) END) AS geom
                FROM region_area a
                JOIN region r ON r.id = a.region_id AND r.is_active
                WHERE r.public_id = ANY(${[...regionIds]}::uuid[]) AND a.is_active AND a.map_domain_id = ${index.mapDomainId}
            ), form AS MATERIALIZED (
                SELECT geom, ST_Area(geom) AS area FROM subject WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
            ), shapes AS MATERIALIZED (
                -- Der Anteil eines Gebiets ist höchstens seine Fläche durch die der Form: was darunter bleibt, erreicht die
                -- Schwelle nie und wird nicht geschnitten (das spart bei großen Flächen den Löwenanteil: der Kontinent schneidet
                -- 930 Gebiete, von denen eine Handvoll die Schwelle erreicht).
                SELECT DISTINCT ON (sh.territory_id) sh.territory_id, sh.geom
                FROM territory_shape sh
                JOIN form ON sh.geom && form.geom AND sh.area >= ${AREA_TERRITORY_MIN_SHARE} * form.area AND ST_Intersects(sh.geom, form.geom)
                ORDER BY sh.territory_id, sh.area DESC
            ), candidates AS MATERIALIZED (
                -- Dasselbe für Landschaften: die Summe der Flächen einer Region deckt ihre Vereinigung nach oben ab. Erst die
                -- Regionen, die die Schwelle erreichen KÖNNEN, werden vereinigt und geschnitten (4,5 Tsd. Kandidaten am Kontinent).
                SELECT r.id AS region_id, r.public_id::text AS id
                FROM region_area a
                JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden
                JOIN form ON a.geom && form.geom
                WHERE a.is_active AND a.map_domain_id = ${index.mapDomainId}
                  AND r.region_layer = ANY(${[...SUBJECT_LAYERS]}::text[])
                  AND r.public_id <> ALL(${[...regionIds]}::uuid[])
                GROUP BY r.id, r.public_id, form.area
                HAVING sum(ST_Area(a.geom)) >= ${AREA_LANDSCAPE_MIN_SHARE} * form.area
            ), neighbours AS MATERIALIZED (
                SELECT c.id,
                       ST_Union(CASE WHEN (ST_IsValidDetail(a.geom)).valid THEN a.geom
                                ELSE ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3) END) AS geom
                FROM candidates c
                JOIN region_area a ON a.region_id = c.region_id AND a.is_active
                GROUP BY c.id
            )
            SELECT 'territory' AS kind,
                   jsonb_build_object('id', t.public_id::text, 'share', ST_Area(ST_Intersection(s.geom, form.geom)) / form.area) AS payload
            FROM shapes s JOIN form ON TRUE JOIN territory t ON t.id = s.territory_id
            WHERE form.area > 0
            UNION ALL
            SELECT 'landscape',
                   jsonb_build_object('id', n.id, 'share', ST_Area(ST_Intersection(n.geom, form.geom)) / form.area)
            FROM neighbours n JOIN form ON TRUE
            WHERE form.area > 0
            UNION ALL
            SELECT 'climate',
                   jsonb_build_object('band', b.type_key, 'label', t.label,
                                      'share', ST_Area(ST_Intersection(b.geom, form.geom)) / form.area)
            FROM climate_band b
            JOIN climate_zone_type t ON t.type_key = b.type_key AND t.is_active
            JOIN form ON b.geom && form.geom AND ST_Intersects(b.geom, form.geom)
            WHERE form.area > 0
            UNION ALL
            SELECT 'extent',
                   jsonb_build_object(
                       'x', ST_X(ST_PointOnSurface(form.geom)), 'y', ST_Y(ST_PointOnSurface(form.geom)),
                       'teile', (SELECT jsonb_agg(jsonb_build_array(ST_Area(d.geom), ST_XMin(d.geom), ST_YMin(d.geom),
                                                                    ST_XMax(d.geom), ST_YMax(d.geom)))
                                   FROM ST_Dump(form.geom) d))
            FROM form
        `,
        { jitOff: true },
    );

    let extent: AreaGeometry["extent"] = null;
    const territoryShares = new Map<number, number>();
    const landscapes: { id: string; share: number }[] = [];
    const climate: ContextClimateBand[] = [];
    for (const row of rows) {
        switch (row.kind) {
            case "extent": {
                const bounds = huelleDerHauptteile(
                    row.payload.teile.map(([flaeche, x0, y0, x1, y1]) => ({
                        flaeche,
                        bbox: [x0, y0, x1, y1] as const,
                    })),
                    AREA_HAUPTANTEIL,
                );
                if (bounds === null) break;
                // Der Punkt auf der Fläche kann auf einem Splitter liegen: Dann zählt die Mitte des Ausschnitts.
                const { x, y } = row.payload;
                const drin = x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
                extent = drin
                    ? { x, y, bounds }
                    : { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2, bounds };
                break;
            }
            case "territory": {
                // Ohne gültige Ableitung keine Gebiete, statt alter (ein Import entwertet sie, WI-0062).
                if (!index.territories.derived) break;
                const record = index.territories.byPublicId.get(row.payload.id);
                if (record && row.payload.share >= AREA_TERRITORY_MIN_SHARE)
                    territoryShares.set(record.id, row.payload.share);
                break;
            }
            case "landscape":
                if (row.payload.share >= AREA_LANDSCAPE_MIN_SHARE) landscapes.push(row.payload);
                break;
            case "climate":
                if (row.payload.share >= AREA_LANDSCAPE_MIN_SHARE) {
                    climate.push({ band: row.payload.band, label: row.payload.label, share: share(row.payload.share) });
                }
                break;
        }
    }

    const context: SubjectContext = {};
    if (territoryShares.size > 0) {
        // Jedes getroffene Gebiet trägt seinen Anteil; die Ketten der innersten Gebiete zeigen die Hierarchie dazu. Die Fläche
        // LIEGT in einem Gebiet, wenn eines davon sie zu 99 % deckt, sonst überlappt sie mehrere (die Anteile sagen, wie viel).
        const shareOf = (record: TerritoryRecord): number | undefined => territoryShares.get(record.id);
        const chains = territoryChains(index.territories, territoryShares.keys())
            .map((chain) => chain.map((record) => contextTerritory(record, shareOf(record))))
            .sort((left, right) => (right[right.length - 1]?.share ?? 0) - (left[left.length - 1]?.share ?? 0))
            .slice(0, AREA_TERRITORY_CHAIN_LIMIT);
        context.territories = {
            relation: relationOf(chains.map((chain) => chain[chain.length - 1]?.share ?? 0)),
            chains: await withCoats(database, chains),
        };
    }
    const items = landscapeItems(
        index,
        landscapes.sort((left, right) => right.share - left.share || left.id.localeCompare(right.id)),
        AREA_LANDSCAPE_LIMIT,
    );
    if (items.length > 0) {
        context.landscapes = { relation: relationOf(items.map((item) => item.share ?? 0)), items };
    }
    if (climate.length > 0) {
        climate.sort((left, right) => (right.share ?? 0) - (left.share ?? 0) || left.band.localeCompare(right.band));
        context.climate = { relation: relationOf(climate.map((band) => band.share ?? 0)), items: climate };
    }
    return { context: nonEmpty(context), extent };
}

/**
 * Das Klima eines Herrschaftsgebiets (WI-0063 P7; Legacy `territory-detail.php`: `climate_zones` mit Anteilen): seine größte abgeleitete
 * Form über alle Bänder, mit den Klimabändern geschnitten. Wie bei einer Fläche zählt ab 5 % ein Band; der Anteil ist der der Form.
 * `undefined` ohne Form (nichts abgeleitet) oder ohne Band.
 */
export async function territoryClimate(
    database: Database,
    territoryId: number,
    statementMs: number = SUBJECT_LIMITS.geometryStatementMs,
): Promise<SubjectContext["climate"]> {
    const rows = await withStatementTimeout(
        database,
        statementMs,
        (transaction) => transaction<{ type_key: string; label: string; share: number }[]>`
            WITH form AS MATERIALIZED (
                SELECT sh.geom, sh.area FROM territory_shape sh
                WHERE sh.territory_id = ${territoryId} AND sh.area > 0
                ORDER BY sh.area DESC
                LIMIT 1
            )
            SELECT b.type_key, t.label, ST_Area(ST_Intersection(b.geom, form.geom)) / form.area AS share
            FROM form
            JOIN climate_band b ON b.geom && form.geom AND ST_Intersects(b.geom, form.geom)
            JOIN climate_zone_type t ON t.type_key = b.type_key AND t.is_active
        `,
        { jitOff: true },
    );
    const items = rows
        .filter((row) => Number(row.share) >= AREA_LANDSCAPE_MIN_SHARE)
        .map((row): ContextClimateBand => ({ band: row.type_key, label: row.label, share: share(Number(row.share)) }))
        .sort((left, right) => (right.share ?? 0) - (left.share ?? 0) || left.band.localeCompare(right.band));
    return items.length === 0 ? undefined : { relation: relationOf(items.map((item) => item.share ?? 0)), items };
}

// ------------------------------------------------------------------------------------------------------------------
// Linie
// ------------------------------------------------------------------------------------------------------------------

/** Der Kontext einer LINIE (Weg-, Kraftliniengruppe): ihr ganzer Verlauf, in der Reihenfolge des ersten Eintritts. */
export async function lineContext(
    database: Database,
    index: SubjectIndex,
    lines: readonly (readonly (readonly [number, number])[])[],
    statementMs: number = SUBJECT_LIMITS.geometryStatementMs,
): Promise<SubjectContext | undefined> {
    if (lines.length === 0) return undefined;
    // Dieselbe Rechnung wie die Landschaften und Gebiete einer Reiseetappe: eine Etappe, die ganze Linie.
    const response = await routeLandscapes(
        database,
        [[...lines.map((line) => [...line])]],
        index.mapDomainId,
        statementMs,
    );
    const context: SubjectContext = {};

    const encountered = (response.territories?.[0] ?? []).flatMap((entry) => {
        const record = index.territories.byPublicId.get(entry.id);
        return record ? [record.id] : [];
    });
    if (encountered.length > 0) {
        const chains = territoryChains(index.territories, encountered, "given");
        if (chains.length > 0) {
            context.territories = {
                relation: "runs_through",
                chains: await withCoats(
                    database,
                    chains.map((chain) => chain.map((record) => contextTerritory(record))),
                ),
            };
        }
    }

    const stage = response.stages[0];
    if (stage && stage.length > 0) {
        // Der eingestellte Anteil (WI-0153) über die Lesestelle des Hauptthreads (WI-0214); das Register führt ihn in Prozent.
        const minShare = (await wegfindungswerte(database)).landscapeMinShare / 100;
        const entries = stage.in
            .map(([id, length]) => ({ id, share: length / stage.length }))
            .filter((entry) => entry.share >= minShare);
        const items = landscapeItems(index, entries, AREA_LANDSCAPE_LIMIT);
        if (items.length > 0) context.landscapes = { relation: "runs_through", items };
    }
    return nonEmpty(context);
}
