import { SUBJECT_LIMITS, type RouteStage, type RouteStagePoint } from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../database.ts";
import { territoryChains, type SubjectIndex } from "./subject-index.ts";

/**
 * Das Herrschaftsgebiet an den WEGPUNKTEN einer Reise (WI-0087 P3, Weg A): Start, Zwischenziele und Ziel bekommen das
 * unterste Gebiet mit Namen an ihren Vertrag geschrieben, damit die Etappenliste ihren Untertitel schreiben kann, ohne
 * je Wegpunkt noch einmal zu fragen.
 *
 * 🔴 **Dieselbe Semantik wie der Punktkontext des Infopanels** (`context.ts` `pointContext`): die abgeleiteten Formen
 * `territory_shape` am Punkt, danach die wirksamen Ketten im Speicher (`territoryChains`), und daraus das LETZTE Glied
 * der ersten Kette - die unterste Ebene, genau die, die der Untertitel des Panels nennt (`panel-header.ts`). Keine
 * zweite räumliche Semantik (WI-0063 10), keine zweite Vorstellung davon, welche Ebene gemeint ist.
 *
 * 🔴 **Hier und nicht im Routing-Worker**, weil nur der Fastify-Prozess beides hat: eine Datenbankverbindung UND den
 * Gebietsbaum (`app.subjects.index()`). Der Worker kennt den Baum nicht. Der Handler bleibt damit, was er ist - er
 * liest und übersetzt die Antwort, er rechnet nicht.
 *
 * 🪤 **Ein Fehlschlag ist ein Befund, kein Tor** (`AGENTS.md`, „Blockierende Prüfungen im Betrieb"): Ohne Ableitung,
 * ohne Treffer oder bei einem Fehler bleibt das Feld weg, und die Reise wird trotzdem beantwortet. Die zweite Zeile
 * nennt dann nur die Ortsklasse.
 */

/** Ein Gebiet, wie der Vertrag es nennt: öffentliche Kennung und Name. */
export interface StageTerritory {
    id: string;
    name: string;
}

/**
 * Die Stellen, an denen eine Station der Etappenliste steht (dieselbe Ableitung wie im Client,
 * `stage-list-model.ts` `stationsByStage`): vor der ersten Etappe jeder Teilstrecke ihr Wegpunkt, nach der letzten
 * Etappe das Ziel. Nur diese Punkte brauchen das Gebiet - eine Reise hat zwei bis fünf davon, keine dreißig.
 */
export function stationPointsOf(stages: readonly RouteStage[]): { stage: number; end: "from" | "to" }[] {
    const stations: { stage: number; end: "from" | "to" }[] = [];
    let leg = -1;
    stages.forEach((stage, position) => {
        if (stage.leg_index === leg) return;
        leg = stage.leg_index;
        stations.push({ stage: position, end: "from" });
    });
    if (stages.length > 0) stations.push({ stage: stages.length - 1, end: "to" });
    return stations;
}

/**
 * Das unterste Gebiet mit Namen je Punkt, in EINEM Statement; der Rückgabewert liegt in der Reihenfolge der Punkte.
 * Ein Punkt ohne Gebiet (hohe See, Niemandsland) bleibt `undefined`.
 */
export async function leafTerritoriesAt(
    database: Database,
    index: SubjectIndex,
    points: readonly { x: number; y: number }[],
): Promise<(StageTerritory | undefined)[]> {
    const empty = points.map(() => undefined);
    if (points.length === 0 || !index.territories.derived) return empty;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const rows = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (transaction) => {
        return transaction<{ at: number; territory_id: string }[]>`
            WITH want AS (
                SELECT (t.n - 1)::int AS at, ST_SetSRID(ST_MakePoint(t.x, t.y), 0) AS geom
                FROM unnest(${xs}::float8[], ${ys}::float8[]) WITH ORDINALITY AS t(x, y, n)
            )
            SELECT DISTINCT w.at, sh.territory_id::text AS territory_id
            FROM want w
            JOIN territory_shape sh ON sh.geom && w.geom AND ST_Intersects(sh.geom, w.geom)
        `;
    });
    const hits = new Map<number, number[]>();
    for (const row of rows) {
        const at = Number(row.at);
        const list = hits.get(at);
        if (list) list.push(Number(row.territory_id));
        else hits.set(at, [Number(row.territory_id)]);
    }
    return points.map((_point, at) => {
        const chain = territoryChains(index.territories, hits.get(at) ?? [])[0];
        const leaf = chain?.[chain.length - 1];
        return leaf === undefined || leaf.name === "" ? undefined : { id: leaf.publicId, name: leaf.name };
    });
}

/**
 * Schreibt das Gebiet an die Wegpunkte der Etappen. Die Etappen der Antwort werden ersetzt, nicht verändert; ein
 * Punkt ohne Ort (`marker`, `exit`, `join`, `landing`) und ein Kartenpunkt bekommen keines - sie liegen nicht AN einem
 * Ort, und der Untertitel nennt dort nichts.
 */
export async function addStageTerritories(
    database: Database,
    index: SubjectIndex,
    stages: readonly RouteStage[],
): Promise<RouteStage[]> {
    const copy = stages.map((stage) => ({ ...stage }));
    const stations = stationPointsOf(copy).filter((station) => {
        const stage = copy[station.stage];
        return stage !== undefined && stage[station.end].point === "place";
    });
    if (stations.length === 0) return copy;
    const points = stations.map((station) => (copy[station.stage] as RouteStage)[station.end]);
    const territories = await leafTerritoriesAt(database, index, points);
    stations.forEach((station, at) => {
        const territory = territories[at];
        if (territory === undefined) return;
        const stage = copy[station.stage] as RouteStage;
        const point: RouteStagePoint = { ...stage[station.end], territory };
        if (station.end === "from") stage.from = point;
        else stage.to = point;
    });
    return copy;
}
