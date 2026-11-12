import { randomUUID } from "node:crypto";
import {
    AVENTURIA,
    pathCreateSubtype,
    pathTargetLayers,
    PATH_TARGETS_MAX_SIDE,
    type EditorPathTargets,
    type OperationReceipt,
    type PathCreateBody,
    type PathTargetsQuery,
    WEG_MINDESTENS,
    endenAufeinander,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { derivePathVisualsFor } from "../derive/path-visual.ts";
import { ApiError } from "../http/api-error.ts";
import { flussZiele } from "./fluss-ziele.ts";
import { mapOperation, type MapActor } from "./map-operation.ts";
import { normalisiere } from "./path-edit.ts";

/**
 * „Neuer Weg“ im Wegeditor (WI-0177; EDIT-0003 T40 (3)): die Andockziele im Kasten und `path.create` (Vertrag in
 * `packages/shared/src/editor-path-create.ts`).
 *
 * - **Wie Legacy** (`create_path`, Mirror 5ff58118, `api/_internal/map/features.php`): Ein neuer Weg ist ein `Weg` mit einem Griff als
 *   Namen („Weg-N“, die nächste freie Nummer, `js/map-features/map-features-path-domain.js`), ohne Namen auf der Karte, kein Bach, ohne
 *   Fließrichtung, ohne Quellen. Die Reisemittel bleiben ohne eigene Liste (`allowed_transports` NULL): Das ist die Vorgabe der Wegart
 *   (`defaultAllowedTransports`); für den `Weg` sind das dieselben Mittel, die Legacys Liste samt Erbe ergäbe.
 * - **Fluss und Bach** (Plan Fluss/Bach 2026-10-19, `body.art`): Wegtyp `Flussweg` mit dem Griff „Flussweg-N“, Fließrichtung
 *   `forward` (die Zeichenrichtung; das Gelände liest sie vom ersten zum letzten Punkt bergab). Ein Fluss nimmt die Boote seiner Art
 *   (`allowed_transports` NULL), ein Bach keine (F14: leere Liste und Domäne `none`; ohne Domäne fiele die leere Liste auf die Vorgabe
 *   zurück, `allowedTransportsForPath`).
 * - **Eine Operation:** Weg, Kurve (`path_visual`) und Protokoll (`path.created`) in EINER Transaktion; Wegprofile und Kacheln stößt die
 *   Schreibnaht an (`map-operation.ts`). Herkunft `avesmaps3d`: Kein Import kennt die Zeile, die Testwelt legt sie still (`testwelt.ts`).
 * - **Prüfungen** wie die Wegkurve (`pruefeKurve`): mindestens zwei Stützpunkte nach dem Runden auf fünf Stellen, Anfang nicht auf dem Ende, jeder
 *   Punkt in der Karte. Woran die Enden hängen, sagt die Quittung nach dem Speichern (`currentEnds`), nie eine Vorschau.
 * - 🔴 Kein anderer Weg ändert sich: Ein Ende am Stützpunkt eines Wegs ist ein Knoten der Wegfindung, kein Kreuzungsobjekt und keine
 *   Teilung (Entscheid 2026-10-10); die Wegfindung erkennt ihn aus der Lage.
 */

const zeile = (punkte: readonly { x: number; y: number }[]): [number, number][] => punkte.map((p) => [p.x, p.y]);

/** Der Kasten, gekürzt auf die Mitte, wenn eine Seite länger ist als `PATH_TARGETS_MAX_SIDE`. */
export function zielKasten(query: PathTargetsQuery): [number, number, number, number] {
    const seite = (a: number, b: number): [number, number] => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        if (hi - lo <= PATH_TARGETS_MAX_SIDE) return [lo, hi];
        const mitte = (lo + hi) / 2;
        return [mitte - PATH_TARGETS_MAX_SIDE / 2, mitte + PATH_TARGETS_MAX_SIDE / 2];
    };
    const [x0, x1] = seite(query.x0, query.x1);
    const [y0, y1] = seite(query.y0, query.y1);
    return [x0, y0, x1, y1];
}

/**
 * Die Andockziele im Kasten (`GET /api/editor/path-targets`): aktive Orte und die Stützpunkte aktiver Wege, ohne Seewege (die Karte
 * zeigt sie niemandem, Betreiber 2026-09-27). Dieselbe Auswahl wie die Ziele um einen Weg (`readPathTargets`), nur um einen Kasten.
 */
export async function readTargetsInBox(database: Database, query: PathTargetsQuery): Promise<EditorPathTargets> {
    const domain = AVENTURIA.mapDomain;
    const [x0, y0, x1, y1] = zielKasten(query);
    const places = await database<EditorPathTargets["places"]>`
        SELECT public_id::text AS "publicId", name, ST_X(geom) AS x, ST_Y(geom) AS y
          FROM place
         WHERE is_active AND map_domain_id = ${domain}
           AND geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY public_id
    `;
    const vertices = await database<EditorPathTargets["vertices"]>`
        SELECT w.public_id::text AS "pathId", w.name, (d.path[1] - 1)::int AS index, ST_X(d.geom) AS x, ST_Y(d.geom) AS y,
               (d.path[1] = 1 OR d.path[1] = ST_NPoints(w.geom)) AS "end", w.revision::int AS revision
          FROM path w
         CROSS JOIN LATERAL ST_DumpPoints(w.geom) AS d
         WHERE w.is_active AND w.map_domain_id = ${domain} AND w.subtype <> 'Seeweg'
           AND w.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
           AND d.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY w.public_id, d.path[1]
    `;
    const peaks = await database<EditorPathTargets["peaks"]>`
        SELECT public_id::text AS "publicId", name, ST_X(geom) AS x, ST_Y(geom) AS y
          FROM terrain_peak
         WHERE is_active AND map_domain_id = ${domain}
           AND geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY public_id
    `;
    // Ein neuer Fluss oder Bach rastet dazu an Flächenkanten und an Abschnitten der Flüsse ein (Vali 2026-11-08, `flussZiele`).
    const fluss =
        query.art === "fluss" || query.art === "bach"
            ? await flussZiele(database, [x0, y0, x1, y1], pathTargetLayers(query.layers), domain)
            : {};
    return { margin: 0, places, vertices, peaks, ...fluss };
}

/** Was `createPath` über den neuen Weg weiß; die Route ergänzt die Anschlüsse nach dem Speichern. */
export interface PathCreated {
    readonly receipt: OperationReceipt;
    readonly publicId: string;
    readonly name: string;
    readonly subtype: string;
    readonly isBach: boolean;
}

/** `path.create` (WI-0177): ein neuer Weg, EINE Operation. */
export async function createPath(database: Database, actor: MapActor, body: PathCreateBody): Promise<PathCreated> {
    const neu = normalisiere(body.points);
    // Dieselben Regeln wie im Editor (`weg-regeln.ts`).
    if (neu.length < WEG_MINDESTENS)
        throw new ApiError(400, "validation_failed", "Ein Weg braucht mindestens zwei Stützpunkte.", {
            field: "points",
        });
    if (endenAufeinander(neu))
        throw new ApiError(400, "validation_failed", "Anfang und Ende des Wegs liegen aufeinander.", {
            field: "points",
        });
    const domain = AVENTURIA.mapDomain;
    const publicId = randomUUID();
    const art = body.art ?? "weg";
    const subtype = pathCreateSubtype(art);
    const wasser = art !== "weg";
    const bach = art === "bach";
    let name = "";
    const receipt = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "path.create", mapDomainId: domain, body },
        async (tx) => {
            const [lage] = await tx<{ inside: boolean | null }[]>`
                SELECT bool_and(map_domain_contains(${domain}, ST_SetSRID(ST_MakePoint(t.x, t.y), 0))) AS inside
                  FROM unnest(${neu.map((p) => p.x)}::float8[], ${neu.map((p) => p.y)}::float8[]) AS t(x, y)
            `;
            if (lage?.inside !== true)
                throw new ApiError(400, "validation_failed", "Ein Stützpunkt liegt außerhalb der Karte.", {
                    field: "points",
                });
            // Der Griff wie Legacy: die nächste freie Nummer. Zwei gleichzeitige Anlagen warten hier aufeinander, sonst trügen beide
            // denselben Griff und wären auf der Karte eine Straße (`name:subtype`).
            await tx`SELECT pg_advisory_xact_lock(hashtext(${`path.create:${domain}`}))`;
            const muster = `^${subtype}-([0-9]+)$`;
            const [nummer] = await tx<{ n: number }[]>`
                SELECT coalesce(max((substring(name FROM ${muster}))::bigint), 0)::bigint + 1 AS n
                  FROM path WHERE map_domain_id = ${domain} AND name ~ ${muster}
            `;
            name = `${subtype}-${String(nummer?.n ?? 1)}`;
            const [zeile0] = await tx<{ id: string; revision: number }[]>`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active,
                                  flow_direction, allowed_transports, transport_domain)
                VALUES (${publicId}::uuid, ${domain}, ${name}, ${subtype}, FALSE, ${bach},
                        ST_SetSRID(ST_MakeLine(ARRAY(
                            SELECT ST_MakePoint(t.x, t.y)
                              FROM unnest(${neu.map((p) => p.x)}::float8[], ${neu.map((p) => p.y)}::float8[]) WITH ORDINALITY AS t(x, y, n)
                             ORDER BY t.n)), 0),
                        'avesmaps3d', TRUE,
                        ${wasser ? "forward" : null}, ${bach ? [] : null}::text[], ${bach ? "none" : null})
                RETURNING id::text, revision::int AS revision
            `;
            await derivePathVisualsFor(tx, [Number(zeile0!.id)]);
            return {
                receipt: {
                    affected: [{ kind: "path", id: publicId, revision: zeile0!.revision }],
                    derivedWork: [
                        { kind: "path_visual", state: "done" },
                        { kind: "routing", state: "pending" },
                    ],
                    warnings: [],
                },
                summary: `${name}: ${art === "weg" ? "neuer Weg" : art === "fluss" ? "neuer Fluss" : "neuer Bach"} mit ${String(neu.length)} Stützpunkten`,
                entries: [
                    {
                        action: "path.created",
                        pathId: publicId,
                        revisionBefore: null,
                        revisionAfter: zeile0!.revision,
                        changes: {
                            geometry: { after: zeile(neu) },
                            subtype: { after: subtype },
                            active: { after: true },
                            ...(wasser ? { flowDirection: { after: "forward" } } : {}),
                            ...(bach ? { isBach: { after: true } } : {}),
                        },
                    },
                ],
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung (`runOperation`): Ihr Weg ist der aus der Quittung, nicht der eben gedachte.
    const angelegt = receipt.affected.find((entity) => entity.kind === "path")?.id ?? publicId;
    if (angelegt !== publicId || name === "") {
        const [vorhanden] = await database<
            { name: string }[]
        >`SELECT name FROM path WHERE public_id = ${angelegt}::uuid`;
        name = vorhanden?.name ?? name;
    }
    if (angelegt !== publicId) {
        const [vorhanden] = await database<{ subtype: string; is_bach: boolean }[]>`
            SELECT subtype, is_bach FROM path WHERE public_id = ${angelegt}::uuid
        `;
        return {
            receipt,
            publicId: angelegt,
            name,
            subtype: vorhanden?.subtype ?? subtype,
            isBach: vorhanden?.is_bach ?? bach,
        };
    }
    return { receipt, publicId: angelegt, name, subtype, isBach: bach };
}
