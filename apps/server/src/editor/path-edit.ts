import {
    EDITOR_LANDSCAPE_LAYERS,
    PATH_TARGET_MARGIN,
    stuetzpunkteZuordnen,
    type EditorPathAttachment,
    type EditorPathDetail,
    type EditorPathEnds,
    type EditorLandscapeLayer,
    type EditorPathTargets,
    type OperationReceipt,
    type PathCarriedPoint,
    ORT_NAEHE,
    WEG_MINDESTENS,
    endenAufeinander,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { derivePathVisualsFor } from "../derive/path-visual.ts";
import { ApiError } from "../http/api-error.ts";
import { netzOptionen } from "../routing/einstellungen.ts";
import type { RouteNode } from "../routing/network.ts";
import { deriveTopology, exactKey, type TopologyPath } from "../routing/topology.ts";
import { wegfindungswerte } from "../system/wegfindungsstand.ts";
import { fuehreFlussHoehenNach, wasserHoehenProtokoll, type FlussPunktVerschoben } from "../terrain/fluss-hoehen.ts";
import { flussZiele } from "./fluss-ziele.ts";
import type { MapActor, MapAuditEntry } from "./map-operation.ts";
import { pruefeSperren } from "./path-split.ts";
import { mapEditConflict } from "./place-edit.ts";

/**
 * Die Wegkurve im Wegeditor (WI-0177 Stufe 1): einen Weg lesen, seine Andockziele holen und sein Kontrollpolygon speichern.
 *
 * - **Gespeichert wird das Kontrollpolygon** (`path.geom`), auf fünf Nachkommastellen gerundet (Betreiber 2026-10-10, „fünf
 *   Nachkommastellen“); die gezeichnete Catmull-Rom-Kurve entsteht in derselben Transaktion (`derivePathVisualsFor`), Wegprofile
 *   und Kacheln stößt die Schreibnaht an (`map-operation.ts`).
 * - **Die Kurve eines Abschnitts** (`formeUmIn`, geschrieben von `path.update` mit `shape`, W5b Schritt 3): der eigene Weg gegen seine
 *   Revision, dazu die mitgezogenen Punkte anderer Wege, je gegen IHRE Revision (Betreiber 2026-10-15, Frage 3: „ja“).
 * - 🔴 **Mitziehen nur an einem Knoten ohne Ort.** An einem Ort hängen die Wege am Ort, und der bleibt stehen; ein mitgezogener
 *   Punkt, der genau auf einem Ort liegt, ist ein Fehler im Client und wird abgelehnt.
 * - **Eigene Höhen an Flüssen** (WI-0259, Vali 2026-10-30 „Höhe wandert mit“): Ändert eine Kurve die Geometrie eines Flusswegs (Ziehen, Einfügen,
 *   Löschen, Vereinfachen, auch ein mitgezogener Punkt), zieht die Flusshöhe eines verschobenen Stützpunkts in derselben Transaktion mit
 *   (`terrain/fluss-hoehen.ts`, Zuordnung `stuetzpunkteZuordnen`); gelöscht bleibt sie stehen (unwirksam, ein ↶ macht sie wieder wirksam),
 *   ein eingefügter Punkt hat keine. Das Fachprotokoll führt sie als `wasserHoehen` am Eintrag des Wegs.
 * - **Woran die Enden hängen**, rechnet `endsOf` nach dem Speichern mit derselben Topologie und denselben freigegebenen Werten wie
 *   die Wegfindung (`routing/topology.ts`, WI-0153): „Ort zuerst“, dann Ende, Stützpunkt, Strecke anderer Wege, sonst frei.
 */

interface PathRow {
    id: string;
    public_id: string;
    map_domain_id: string;
    name: string;
    subtype: string;
    label_visible: boolean;
    is_bach: boolean;
    flow_direction: "forward" | "reverse" | null;
    source_system: string;
    is_active: boolean;
    off_map: boolean;
    revision: number;
    updated_at: Date;
    geojson: string;
}

type Punkt = { x: number; y: number };

async function readPathRow(sql: Queryable, publicId: string): Promise<PathRow | undefined> {
    const [row] = await sql<PathRow[]>`
        SELECT id::text, public_id::text, map_domain_id, name, subtype, label_visible, is_bach, flow_direction, source_system,
               is_active, off_map, revision::int AS revision, updated_at, ST_AsGeoJSON(geom, 15) AS geojson
          FROM path WHERE public_id = ${publicId}::uuid
    `;
    return row;
}

const punkteVon = (geojson: string): Punkt[] =>
    (JSON.parse(geojson) as { coordinates: [number, number][] }).coordinates.map(([x, y]) => ({ x, y }));

/** Fünf Nachkommastellen, die Genauigkeit der Wegenden (Betreiber 2026-10-10). */
const runde = (wert: number): number => Math.round(wert * 1e5) / 1e5;
const schluessel = (p: Punkt): string => exactKey(p.x, p.y);

/** Gerundet und ohne zwei gleiche Punkte hintereinander (ein Stützpunkt, auf seinen Nachbarn gezogen, verschwindet). */
export function normalisiere(punkte: readonly Punkt[]): Punkt[] {
    const raus: Punkt[] = [];
    for (const p of punkte) {
        const q = { x: runde(p.x), y: runde(p.y) };
        const vorher = raus.at(-1);
        if (vorher && schluessel(vorher) === schluessel(q)) continue;
        raus.push(q);
    }
    return raus;
}

/** Die Werte, mit denen die Wegfindung gerade rechnet (WI-0153), über die eine Lesestelle des Hauptthreads (WI-0214). */
async function topologieWerte(sql: Queryable): Promise<{ endSnap: number; endpointBox: number; exactHit: number }> {
    const { endSnap, endpointBox, exactHit } = netzOptionen(await wegfindungswerte(sql));
    return { endSnap, endpointBox, exactHit };
}

/**
 * Woran die beiden Enden dieses Kontrollpolygons hängen: die Topologie der Wegfindung, gerechnet nur über die Orte und Wege um
 * die Enden (ein Kasten, der den Ortskasten und den Fangbereich weit überdeckt). Rein lesend.
 */
export async function endsOf(
    sql: Queryable,
    weg: { publicId: string; mapDomainId: string; punkte: readonly Punkt[] },
): Promise<EditorPathEnds> {
    const werte = await topologieWerte(sql);
    const reichweite = werte.endpointBox + 1;
    const enden = [weg.punkte[0]!, weg.punkte.at(-1)!];
    const [a, b] = enden as [Punkt, Punkt];
    const orte = await sql<{ id: string; name: string; hidden: boolean; x: number; y: number }[]>`
        SELECT public_id::text AS id, name, is_hidden AS hidden, ST_X(geom) AS x, ST_Y(geom) AS y
          FROM place
         WHERE is_active AND map_domain_id = ${weg.mapDomainId}
           AND (geom && ST_MakeEnvelope(${a.x - reichweite}, ${a.y - reichweite}, ${a.x + reichweite}, ${a.y + reichweite}, 0)
             OR geom && ST_MakeEnvelope(${b.x - reichweite}, ${b.y - reichweite}, ${b.x + reichweite}, ${b.y + reichweite}, 0))
    `;
    const andere = await sql<{ id: string; name: string; subtype: string; is_bach: boolean; geojson: string }[]>`
        SELECT public_id::text AS id, name, subtype, is_bach, ST_AsGeoJSON(geom, 15) AS geojson
          FROM path
         WHERE is_active AND map_domain_id = ${weg.mapDomainId} AND public_id <> ${weg.publicId}::uuid
           AND (geom && ST_MakeEnvelope(${a.x - reichweite}, ${a.y - reichweite}, ${a.x + reichweite}, ${a.y + reichweite}, 0)
             OR geom && ST_MakeEnvelope(${b.x - reichweite}, ${b.y - reichweite}, ${b.x + reichweite}, ${b.y + reichweite}, 0))
    `;
    const knoten: RouteNode[] = orte.map((ort) => ({
        id: ort.id,
        name: ort.name,
        kind: "place",
        isHidden: ort.hidden,
        x: ort.x,
        y: ort.y,
    }));
    const wege: TopologyPath[] = [
        { publicId: weg.publicId, coordinates: weg.punkte.map((p) => [p.x, p.y] as [number, number]) },
        ...andere.map((w) => ({
            publicId: w.id,
            coordinates: punkteVon(w.geojson).map((p) => [p.x, p.y] as [number, number]),
        })),
    ];
    const ortNamen = new Map(orte.map((o) => [o.id, o.name] as const));
    const wegArt = new Map(andere.map((w) => [w.id, w] as const));
    const topologie = deriveTopology(knoten, wege, werte);
    const anschluss = (which: "anfang" | "ende"): EditorPathAttachment => {
        const ende = topologie.ends.find((e) => e.pathPublicId === weg.publicId && e.which === which);
        if (!ende || ende.contact === "offen") return { kind: "free" };
        if (ende.contact === "ort")
            return { kind: "place", publicId: ende.nodeId, name: ortNamen.get(ende.nodeId) ?? "" };
        const partner =
            ende.partners.find((p) => p.kind === ende.contact && p.pathPublicId !== weg.publicId) ??
            ende.partners.find((p) => p.pathPublicId !== weg.publicId);
        // Trifft das Ende nur den eigenen Weg (ein Ring auf sich selbst), hängt es an nichts anderem.
        if (!partner) return { kind: "free" };
        const art = wegArt.get(partner.pathPublicId);
        return {
            kind: "path",
            publicId: partner.pathPublicId,
            name: art?.name ?? "",
            subtype: art?.subtype ?? "",
            isBach: art?.is_bach ?? false,
            contact: partner.kind,
        };
    };
    return { start: anschluss("anfang"), end: anschluss("ende") };
}

/** Der Weg, wie der Wegeditor ihn liest (`GET /api/editor/paths/:id`); `undefined`, wenn es ihn nicht gibt. */
export async function readEditorPath(database: Database, publicId: string): Promise<EditorPathDetail | undefined> {
    const row = await readPathRow(database, publicId);
    if (row === undefined) return undefined;
    const points = punkteVon(row.geojson);
    return {
        publicId: row.public_id,
        revision: row.revision,
        name: row.name,
        subtype: row.subtype,
        labelVisible: row.label_visible,
        isBach: row.is_bach,
        flowDirection: row.flow_direction,
        sourceSystem: row.source_system,
        active: row.is_active,
        offMap: row.off_map,
        points,
        ends: await endsOf(database, { publicId: row.public_id, mapDomainId: row.map_domain_id, punkte: points }),
    };
}

/**
 * Die Andockziele um den Weg (`GET /api/editor/paths/:id/targets`): aktive Orte und die Stützpunkte anderer aktiver Wege im Kasten
 * des Wegs, erweitert um `PATH_TARGET_MARGIN`. Einmal beim Start des Modus und nach jeder Quittung geholt, nie während einer Geste.
 * Seewege fehlen: Die Karte zeigt sie niemandem (Betreiber 2026-09-27), also dockt auch nichts an ihnen an. Ein Fluss oder Bach
 * bekommt dazu die Flächenkanten der Ebenen `layers` und die Abschnitte anderer Flüsse (`flussZiele`, Vali 2026-11-08).
 */
export async function readPathTargets(
    database: Database,
    publicId: string,
    layers: readonly EditorLandscapeLayer[] = EDITOR_LANDSCAPE_LAYERS,
): Promise<EditorPathTargets | undefined> {
    const row = await readPathRow(database, publicId);
    if (row === undefined) return undefined;
    const punkte = punkteVon(row.geojson);
    const xs = punkte.map((p) => p.x);
    const ys = punkte.map((p) => p.y);
    const rand = PATH_TARGET_MARGIN;
    const kasten = [Math.min(...xs) - rand, Math.min(...ys) - rand, Math.max(...xs) + rand, Math.max(...ys) + rand];
    const places = await database<EditorPathTargets["places"]>`
        SELECT public_id::text AS "publicId", name, ST_X(geom) AS x, ST_Y(geom) AS y
          FROM place
         WHERE is_active AND map_domain_id = ${row.map_domain_id}
           AND geom && ST_MakeEnvelope(${kasten[0]!}, ${kasten[1]!}, ${kasten[2]!}, ${kasten[3]!}, 0)
         ORDER BY public_id
    `;
    const vertices = await database<EditorPathTargets["vertices"]>`
        SELECT w.public_id::text AS "pathId", w.name, (d.path[1] - 1)::int AS index, ST_X(d.geom) AS x, ST_Y(d.geom) AS y,
               (d.path[1] = 1 OR d.path[1] = ST_NPoints(w.geom)) AS "end", w.revision::int AS revision
          FROM path w
         CROSS JOIN LATERAL ST_DumpPoints(w.geom) AS d
         WHERE w.is_active AND w.map_domain_id = ${row.map_domain_id} AND w.subtype <> 'Seeweg'
           AND w.public_id <> ${publicId}::uuid
           AND w.geom && ST_MakeEnvelope(${kasten[0]!}, ${kasten[1]!}, ${kasten[2]!}, ${kasten[3]!}, 0)
           AND d.geom && ST_MakeEnvelope(${kasten[0]!}, ${kasten[1]!}, ${kasten[2]!}, ${kasten[3]!}, 0)
         ORDER BY w.public_id, d.path[1]
    `;
    const peaks = await database<EditorPathTargets["peaks"]>`
        SELECT public_id::text AS "publicId", name, ST_X(geom) AS x, ST_Y(geom) AS y
          FROM terrain_peak
         WHERE is_active AND map_domain_id = ${row.map_domain_id}
           AND geom && ST_MakeEnvelope(${kasten[0]!}, ${kasten[1]!}, ${kasten[2]!}, ${kasten[3]!}, 0)
         ORDER BY public_id
    `;
    const fluss =
        row.subtype === "Flussweg"
            ? await flussZiele(
                  database,
                  kasten as [number, number, number, number],
                  layers,
                  row.map_domain_id,
                  publicId,
              )
            : {};
    return { margin: rand, places, vertices, peaks, ...fluss };
}

async function wegKonflikt(tx: Sql, publicId: string): Promise<ApiError> {
    const row = await readPathRow(tx, publicId);
    return mapEditConflict(
        tx,
        { kind: "path", publicId },
        { revision: row?.revision ?? 0, changedAt: row?.updated_at ?? new Date() },
    );
}

const zeile = (punkte: readonly Punkt[]): [number, number][] => punkte.map((p) => [p.x, p.y]);

/** Die Punkte einer neuen Kurve, gerundet und vor der Transaktion geprüft: mindestens zwei, Anfang nicht gleich Ende. */
export function pruefeKurve(points: readonly Punkt[]): Punkt[] {
    const neu = normalisiere(points);
    // Dieselben Regeln wie im Editor (`weg-regeln.ts`): mindestens zwei Stützpunkte, Anfang und Ende nie aufeinander.
    if (neu.length < WEG_MINDESTENS)
        throw new ApiError(400, "validation_failed", "Ein Weg braucht mindestens zwei Stützpunkte.", {
            field: "points",
        });
    if (endenAufeinander(neu))
        throw new ApiError(400, "validation_failed", "Anfang und Ende des Wegs liegen aufeinander.", {
            field: "points",
        });
    return neu;
}

/** Was eine Kurve in der Transaktion geschrieben hat. */
export interface KurveGeschrieben {
    readonly affected: OperationReceipt["affected"];
    readonly entries: MapAuditEntry[];
    readonly name: string;
    /** Wie viele andere Wege mitgezogen wurden. */
    readonly mitgezogen: number;
}

/**
 * Die Kurve eines Abschnitts in einer laufenden Transaktion (`path.update` mit `shape`, W5b Schritt 3): das neue
 * Kontrollpolygon gegen `revision`, die mitgezogenen Punkte anderer Wege gegen ihre, nie über eine fremde Sperre, die Kurven aller
 * berührten Wege in derselben Transaktion.
 */
export async function formeUmIn(
    tx: Sql,
    actor: MapActor,
    publicId: string,
    neu: readonly Punkt[],
    carried: readonly PathCarriedPoint[],
    revision: number,
): Promise<KurveGeschrieben> {
    const row = await readPathRow(tx, publicId);
    if (row === undefined || !row.is_active) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
    if (row.revision !== revision) throw await wegKonflikt(tx, publicId);
    const alt = punkteVon(row.geojson);

    const [lage] = await tx<{ inside: boolean | null }[]>`
        SELECT bool_and(map_domain_contains(${row.map_domain_id}, ST_SetSRID(ST_MakePoint(t.x, t.y), 0))) AS inside
          FROM unnest(${neu.map((p) => p.x)}::float8[], ${neu.map((p) => p.y)}::float8[]) AS t(x, y)
    `;
    if (lage?.inside !== true)
        throw new ApiError(400, "validation_failed", "Ein Stützpunkt liegt außerhalb der Karte.", {
            field: "points",
        });

    // Mitgezogen wird nur, was genau auf einem alten Stützpunkt dieses Wegs lag und auf einen neuen geht.
    const altSchluessel = new Set(alt.map(schluessel));
    const neuSchluessel = new Set(neu.map(schluessel));
    const jeWeg = new Map<string, PathCarriedPoint[]>();
    for (const punkt of carried) {
        if (punkt.pathId === publicId)
            throw new ApiError(400, "validation_failed", "Der eigene Weg zieht nicht mit.", {
                field: "carried",
            });
        const von = { x: runde(punkt.from.x), y: runde(punkt.from.y) };
        const nach = { x: runde(punkt.to.x), y: runde(punkt.to.y) };
        if (!altSchluessel.has(schluessel(von)) || !neuSchluessel.has(schluessel(nach)))
            throw new ApiError(
                400,
                "validation_failed",
                "Ein mitgezogener Punkt liegt nicht am gezogenen Stützpunkt.",
                {
                    field: "carried",
                    pathId: punkt.pathId,
                },
            );
        jeWeg.set(punkt.pathId, [...(jeWeg.get(punkt.pathId) ?? []), { ...punkt, from: von, to: nach }]);
    }
    if (jeWeg.size > 0) {
        const knoten = carried.map((p) => ({ x: runde(p.from.x), y: runde(p.from.y) }));
        const [amOrt] = await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM place p
             WHERE p.is_active AND p.map_domain_id = ${row.map_domain_id}
               AND EXISTS (SELECT 1 FROM unnest(${knoten.map((k) => k.x)}::float8[], ${knoten.map((k) => k.y)}::float8[]) AS k(x, y)
                            WHERE abs(ST_X(p.geom) - k.x) < ${ORT_NAEHE} AND abs(ST_Y(p.geom) - k.y) < ${ORT_NAEHE})
        `;
        if ((amOrt?.n ?? 0) > 0)
            throw new ApiError(400, "validation_failed", "An einem Ort zieht nichts mit; die Wege hängen am Ort.", {
                field: "carried",
            });
    }

    // Nie über die Sperre eines anderen hinweg (EDIT-0003 §4), weder am eigenen Weg noch an einem mitgezogenen: 409
    // `object_locked` mit der Sperre, wie bei den übrigen Schreibwegen der Wege (Befund der Sicherheitsprüfung OPS-000036).
    await pruefeSperren(tx, actor, [publicId, ...jeWeg.keys()]);

    const [geaendert] = await tx<{ id: string; revision: number }[]>`
        UPDATE path
           SET geom = ST_SetSRID(ST_MakeLine(ARRAY(
                   SELECT ST_MakePoint(t.x, t.y)
                     FROM unnest(${neu.map((p) => p.x)}::float8[], ${neu.map((p) => p.y)}::float8[]) WITH ORDINALITY AS t(x, y, n)
                    ORDER BY t.n)), 0)
         WHERE public_id = ${publicId}::uuid AND revision = ${row.revision}
        RETURNING id::text, revision::int AS revision
    `;
    if (geaendert === undefined) throw await wegKonflikt(tx, publicId);
    const ids = [Number(geaendert.id)];
    const affected: OperationReceipt["affected"] = [{ kind: "path", id: publicId, revision: geaendert.revision }];
    // Welche Stützpunkte eines Flusswegs gewandert sind: ihre Flusshöhen ziehen am Ende mit.
    const gewandert: FlussPunktVerschoben[] =
        row.subtype === "Flussweg"
            ? stuetzpunkteZuordnen(alt, neu).verschoben.map((v) => ({ von: v.von, nach: v.nach }))
            : [];
    const entries: MapAuditEntry[] = [
        {
            action: "path.reshaped",
            pathId: publicId,
            revisionBefore: row.revision,
            revisionAfter: geaendert.revision,
            changes: { geometry: { before: zeile(alt), after: zeile(neu) } },
        },
    ];

    for (const [anderer, punkte] of jeWeg) {
        const other = await readPathRow(tx, anderer);
        if (other === undefined || !other.is_active)
            throw new ApiError(400, "validation_failed", "Ein mitgezogener Weg ist nicht mehr da.", {
                pathId: anderer,
            });
        // 🔴 Nur Wege derselben Karte ziehen mit (Befund der Sicherheitsprüfung OPS-000036).
        if (other.map_domain_id !== row.map_domain_id)
            throw new ApiError(400, "validation_failed", "Ein mitgezogener Weg liegt auf einer anderen Karte.", {
                field: "carried",
                pathId: anderer,
            });
        const basis = punkte[0]!.baseRevision;
        if (punkte.some((p) => p.baseRevision !== basis) || other.revision !== basis)
            throw await wegKonflikt(tx, anderer);
        const seine = punkteVon(other.geojson);
        for (const p of punkte) {
            const jetzt = seine[p.index];
            if (jetzt === undefined || schluessel({ x: runde(jetzt.x), y: runde(jetzt.y) }) !== schluessel(p.from))
                throw await wegKonflikt(tx, anderer);
        }
        // Ein mitgezogener Punkt eines Flusswegs nimmt seine Höhe mit (`von` ist seine gespeicherte Lage).
        if (other.subtype === "Flussweg") for (const p of punkte) gewandert.push({ von: seine[p.index]!, nach: p.to });
        let geometrie = "geom";
        const parameter: unknown[] = [anderer, basis];
        for (const p of punkte) {
            parameter.push(p.index, p.to.x, p.to.y);
            const n = parameter.length;
            geometrie = `ST_SetPoint(${geometrie}, $${String(n - 2)}::int, ST_SetSRID(ST_MakePoint($${String(n - 1)}, $${String(n)}), 0))`;
        }
        const [mit] = await tx.unsafe<{ id: string; revision: number }[]>(
            `UPDATE path SET geom = ${geometrie} WHERE public_id = $1::uuid AND revision = $2
             RETURNING id::text, revision::int AS revision`,
            parameter as never[],
        );
        if (mit === undefined) throw await wegKonflikt(tx, anderer);
        ids.push(Number(mit.id));
        affected.push({ kind: "path", id: anderer, revision: mit.revision });
        entries.push({
            action: "path.carried",
            pathId: anderer,
            revisionBefore: basis,
            revisionAfter: mit.revision,
            changes: {
                geometry: {
                    before: punkte.map((p) => ({ index: p.index, x: p.from.x, y: p.from.y })),
                    after: punkte.map((p) => ({ index: p.index, x: p.to.x, y: p.to.y })),
                },
            },
        });
    }
    await derivePathVisualsFor(tx, ids);
    // Die Flusshöhen folgen den gewanderten Stützpunkten, NACH allen Geometrien dieser Transaktion (ein Knoten, an dem zwei Flüsse
    // hängen und beide wandern, zieht seine Höhe einmal um).
    if (gewandert.length > 0) {
        const hoehen = await fuehreFlussHoehenNach(tx, row.map_domain_id, gewandert);
        if (hoehen.umzuege.length > 0) entries[0]!.changes!["wasserHoehen"] = wasserHoehenProtokoll(hoehen.umzuege);
        for (const g of hoehen.affected) affected.push(g);
    }
    return { affected, entries, name: row.name, mitgezogen: jeWeg.size };
}

/** Woran die Enden des Wegs JETZT hängen (nach dem Speichern, außerhalb der Transaktion gelesen). */
export async function currentEnds(database: Database, publicId: string): Promise<EditorPathEnds> {
    const row = await readPathRow(database, publicId);
    if (row === undefined) return { start: { kind: "free" }, end: { kind: "free" } };
    return endsOf(database, {
        publicId: row.public_id,
        mapDomainId: row.map_domain_id,
        punkte: punkteVon(row.geojson),
    });
}
