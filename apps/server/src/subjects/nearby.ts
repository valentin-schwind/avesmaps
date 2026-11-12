import {
    AVENTURIA,
    SUBJECT_PATH_SUBTYPES,
    distanceInMiles,
    pathReaderName,
    type MapPoint,
    type NearbyItem,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import type { SubjectIndex } from "./subject-index.ts";

/**
 * „In der Nähe“ einer freien Kartenstelle (WI-0063 P7; Legacy `js/map-features/map-features-what-is-here-nearby.js`, Mirror `b9657635a`,
 * Entwurf `2026-08-15-was-ist-hier-design.md` 5): Was rund um den angeklickten Punkt liegt, mit Abstand und Peilung. Legacy rechnet es im
 * Browser aus dem Kartenpayload; hier rechnet der Server, damit die Karte keine Orte und Wege für diese Frage vorhalten muss.
 *
 * Die Auswahlregel ist Legacys, jede Zahl mit ihrem gemessenen Anlass:
 *  - die drei NÄCHSTEN Ortschaften, ohne Schranke („dass die nächste Stadt 35 Meilen entfernt ist, IST die Antwort“),
 *  - je Wegart höchstens EIN Weg, höchstens vier Wege, keiner weiter als das Anderthalbfache der weitesten gezeigten Ortschaft - der
 *    Maßstab ist die Ortsliste, nicht die Wegeliste, weil eine relative Schranke einen Maßstab braucht, der nicht mitwandert,
 *  - alles zusammen nach Entfernung.
 *
 * 🔴 Was Besucher nicht sehen, steht nie darin: Verborgene Orte nicht (Legacy Fix-Runde 7, C1), Seewege nicht (Editorwerkzeug, AGENTS.md).
 * Die Peilung ist die rechtweisende, 0 Grad Norden im Uhrzeigersinn (`atan2(dx, dy)`: y wächst nach Norden), die Entfernung in Meilen.
 */

export const NEARBY_PLACES = 3;
export const NEARBY_PATHS = 4;
export const NEARBY_PATH_REACH = 1.5;

/** Die Wegarten, die Besucher sehen: alle außer dem Seeweg. */
const VISIBLE_SUBTYPES = SUBJECT_PATH_SUBTYPES.filter((subtype) => subtype !== "Seeweg");

const rounded = (value: number, digits: number): number => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

/** Die rechtweisende Peilung von `from` nach `to` in Grad, 0 = Norden, im Uhrzeigersinn, auf eine Stelle gerundet. */
export function bearing(from: MapPoint, to: MapPoint): number {
    const degrees = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
    return rounded((degrees + 360) % 360, 1) % 360;
}

interface PlaceRow {
    id: string;
    name: string;
    subtype: string;
    x: number;
    y: number;
}

interface PathRow {
    id: string;
    name: string;
    subtype: string;
    fx: number;
    fy: number;
}

/** Die Auswahl aus den nächsten Orten und den nächsten Wegen je Art: Legacys Regel, rein. */
export function selectNearby(places: readonly NearbyItem[], paths: readonly NearbyItem[]): NearbyItem[] {
    const shown = [...places].sort((left, right) => left.miles - right.miles).slice(0, NEARBY_PLACES);
    const farthest = shown[shown.length - 1];
    // Der Maßstab steht fest, bevor auch nur ein Weg geprüft wird; ohne Orte gibt es keine Schranke.
    const reach = farthest === undefined ? Number.POSITIVE_INFINITY : farthest.miles * NEARBY_PATH_REACH;
    const byType = new Map<string, NearbyItem>();
    for (const path of paths) {
        const known = byType.get(path.type);
        if (known === undefined || path.miles < known.miles) byType.set(path.type, path);
    }
    const roads = [...byType.values()]
        .filter((path) => path.miles <= reach)
        .sort((left, right) => left.miles - right.miles)
        .slice(0, NEARBY_PATHS);
    return [...shown, ...roads].sort((left, right) => left.miles - right.miles);
}

/** Der Name eines Wegs: der eigene echte Name, sonst der Name des Artikels, an den er gebunden ist (Legacy `getPathTitleName`). */
function pathName(index: SubjectIndex, row: PathRow): string | undefined {
    const reader = pathReaderName(row.name, row.subtype);
    if (reader !== null) return reader;
    const wikiName = index.paths.segments.get(row.id)?.mainName?.trim();
    return wikiName === undefined || wikiName === "" ? undefined : wikiName;
}

export async function readNearby(
    database: Queryable,
    index: SubjectIndex,
    point: MapPoint,
): Promise<NearbyItem[] | undefined> {
    const at = (x: number, y: number): MapPoint => ({ x, y });
    const places = await database<PlaceRow[]>`
        SELECT public_id::text AS id, name, subtype, ST_X(geom) AS x, ST_Y(geom) AS y
        FROM place
        WHERE is_active AND NOT is_hidden AND map_domain_id = ${index.mapDomainId} AND btrim(name) <> ''
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${point.x}, ${point.y}), 0)
        LIMIT ${NEARBY_PLACES}
    `;
    // Je Wegart der nächste Weg (eine Nachbarschaftssuche über den Index je Art), mit dem Fußpunkt, auf den die Peilung zielt.
    const paths = await database<PathRow[]>`
        SELECT near.id, near.name, near.subtype, near.fx, near.fy
        FROM unnest(${[...VISIBLE_SUBTYPES]}::text[]) AS kind (subtype)
        CROSS JOIN LATERAL (
            SELECT t.public_id::text AS id, t.name, t.subtype,
                   ST_X(ST_ClosestPoint(t.geom, ST_SetSRID(ST_MakePoint(${point.x}, ${point.y}), 0))) AS fx,
                   ST_Y(ST_ClosestPoint(t.geom, ST_SetSRID(ST_MakePoint(${point.x}, ${point.y}), 0))) AS fy
            FROM path t
            WHERE t.subtype = kind.subtype AND t.is_active AND t.map_domain_id = ${index.mapDomainId}
            ORDER BY t.geom <-> ST_SetSRID(ST_MakePoint(${point.x}, ${point.y}), 0)
            LIMIT 1
        ) near
    `;
    const space = AVENTURIA.coordinateSpace;
    const placeItems = places.map((row): NearbyItem => ({
        ref: { kind: "place", id: row.id },
        type: row.subtype,
        name: row.name.trim(),
        miles: rounded(distanceInMiles(space, point, at(Number(row.x), Number(row.y))), 2),
        bearing: bearing(point, at(Number(row.x), Number(row.y))),
    }));
    const pathItems = paths.map((row): NearbyItem => {
        const foot = at(Number(row.fx), Number(row.fy));
        const name = pathName(index, row);
        return {
            ref: { kind: "path", anchor: row.id },
            type: row.subtype,
            ...(name === undefined ? {} : { name }),
            miles: rounded(distanceInMiles(space, point, foot), 2),
            bearing: bearing(point, foot),
        };
    });
    const selected = selectNearby(placeItems, pathItems);
    return selected.length === 0 ? undefined : selected;
}
