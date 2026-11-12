import { randomUUID } from "node:crypto";
import {
    AVENTURIA,
    type EditorPowerlineTargets,
    type NodixCreateBody,
    type NodixMoveBody,
    type OperationReceipt,
    type PowerlineCreateBody,
    selberNodix,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { zieheKraftlinienNach } from "../derive/powerline-bahn.ts";
import { ApiError } from "../http/api-error.ts";
import { leseNodices, pruefeLinienSperre } from "./kraftlinien-schreiben.ts";
import { mapOperation, type MapActor } from "./map-operation.ts";

/**
 * „Neue Kraftlinie“ (WI-0205 K9; Vertrag `PowerlineCreateBody` in `packages/shared/src/powerline-editor-ops.ts`; Blatt Kraftlinien R4).
 *
 * - **Wie Legacy** (`create_powerline`, Mirror, `api/_internal/map/features.php`): ein gerader Abschnitt von einem Nodix zu einem
 *   anderen. Ohne Namen heißt er nach seinen Enden „A - B“ (ein Kraftlinienpunkt ohne Namen heißt „Nodix“) und ist eine Linie für sich;
 *   mit Namen schließt er an die Linie dieses Namens an („Nodix anfügen“) und übernimmt ihre Beschriftung und Beschreibung, wie Legacy
 *   die Felder der Linie erbt. Ohne Bogen (`curve` NULL, gerade wie „nie gespeichert“).
 * - **Beide Enden ein Nodix** (Ort oder Beschriftung mit dem Merkmal, oder Kraftlinienpunkt) und verschieden; sonst 400.
 * - **Eine Operation:** Abschnitt, gezeichnete Bahn (`zieheKraftlinienNach`, K5) und Protokoll (`powerline.created`) in EINER Transaktion;
 *   Kachelrevision und Bögen stößt die Schreibnaht an. Herkunft `avesmaps3d`: Kein Import kennt die Zeile, die Testwelt legt sie still.
 * - Kein anderer Abschnitt ändert sich; eine Wiki-Zuordnung bekommt der neue Abschnitt erst im Fenster.
 * - Hält ein anderer die Linie, an die der Abschnitt anschließt (gleicher Name), schreibt er nicht (409 `object_locked`, WI-0205 K11).
 */

/** Die Nodices der Domäne für eine neue Kraftlinie (`GET /api/editor/powerline-targets`). */
export async function readCreateTargets(database: Queryable): Promise<EditorPowerlineTargets> {
    return { targets: await leseNodices(database, AVENTURIA.mapDomain) };
}

export interface PowerlineCreated {
    readonly receipt: OperationReceipt;
    readonly publicId: string;
    readonly name: string;
}

/** Der Name eines Endes in „A - B“: wie Legacy „Nodix“, wo der Punkt keinen hat. */
const endName = (name: string | undefined): string => (name ?? "").trim() || "Nodix";

/** `powerline.create` (K9): ein Abschnitt von Nodix zu Nodix, EINE Operation. */
export async function createPowerline(
    database: Database,
    actor: MapActor,
    body: PowerlineCreateBody,
): Promise<PowerlineCreated> {
    if (selberNodix(body.from, body.to))
        throw new ApiError(400, "validation_failed", "Anfang und Ende der Kraftlinie sind derselbe Nodix.", {
            field: "to",
        });
    const gewuenscht = body.name?.trim();
    if (gewuenscht === "")
        throw new ApiError(400, "validation_failed", "Eine Kraftlinie braucht einen Namen.", { field: "name" });
    const domain = AVENTURIA.mapDomain;
    const publicId = randomUUID();
    let name = "";
    const receipt = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "powerline.create", mapDomainId: domain, body },
        async (tx) => {
            const enden = await leseNodices(tx, domain, [body.from, body.to]);
            const von = enden.find((n) => n.id === body.from);
            const nach = enden.find((n) => n.id === body.to);
            if (von === undefined || nach === undefined)
                throw new ApiError(400, "validation_failed", "Eine Kraftlinie verbindet nur Nodices.", {
                    field: von === undefined ? "from" : "to",
                });
            let beschriftung = false;
            let beschreibung: string | null = null;
            if (gewuenscht === undefined) {
                name = `${endName(von.name)} - ${endName(nach.name)}`;
            } else {
                name = gewuenscht;
                // An eine bestehende Linie: ihre Felder, damit der neue Abschnitt sofort zu ihr passt (Legacy erbt sie ebenso).
                const [linie] = await tx<{ label_visible: boolean; description: string | null }[]>`
                    SELECT label_visible, description FROM powerline
                     WHERE map_domain_id = ${domain} AND name = ${name} AND is_active
                     ORDER BY public_id LIMIT 1
                `;
                beschriftung = linie?.label_visible ?? false;
                beschreibung = linie?.description ?? null;
            }
            const gruppe = await tx<{ public_id: string }[]>`
                SELECT public_id::text AS public_id FROM powerline WHERE map_domain_id = ${domain} AND name = ${name} AND is_active
            `;
            await pruefeLinienSperre(
                tx,
                actor,
                gruppe.map((a) => a.public_id),
            );
            const [zeile] = await tx<{ revision: number }[]>`
                INSERT INTO powerline (public_id, map_domain_id, name, label_visible, description, from_public_id, to_public_id,
                                       curve, geom, drawn_geom, source_system, is_active)
                VALUES (${publicId}::uuid, ${domain}, ${name}, ${beschriftung}, ${beschreibung}, ${body.from}::uuid,
                        ${body.to}::uuid, NULL,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${von.x}, ${von.y}), ST_MakePoint(${nach.x}, ${nach.y})), 0),
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${von.x}, ${von.y}), ST_MakePoint(${nach.x}, ${nach.y})), 0),
                        'avesmaps3d', TRUE)
                RETURNING revision::int AS revision
            `;
            await zieheKraftlinienNach(tx, { abschnitte: [publicId] });
            return {
                receipt: {
                    affected: [{ kind: "powerline", id: publicId, revision: zeile!.revision }],
                    derivedWork: [{ kind: "powerline_path", state: "done" }],
                    warnings: [],
                },
                summary: `Kraftlinie „${name}“: neuer Abschnitt ${endName(von.name)} – ${endName(nach.name)}`,
                entries: [
                    {
                        action: "powerline.created",
                        powerlineId: publicId,
                        revisionBefore: null,
                        revisionAfter: zeile!.revision,
                        changes: {
                            name: { after: name },
                            from: { after: body.from },
                            to: { after: body.to },
                            active: { after: true },
                        },
                    },
                ],
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung (`runOperation`): Ihr Abschnitt ist der aus der Quittung.
    const angelegt = receipt.affected.find((entity) => entity.kind === "powerline")?.id ?? publicId;
    if (angelegt !== publicId || name === "") {
        const [vorhanden] = await database<{ name: string }[]>`
            SELECT name FROM powerline WHERE public_id = ${angelegt}::uuid
        `;
        name = vorhanden?.name ?? name;
    }
    return { receipt, publicId: angelegt, name };
}

/**
 * `nodix.create` (K9; Blatt Kraftlinien R7 und Frage 4): ein Kraftlinienpunkt an einer Stelle der Karte, EINE Operation. Eine Abzweigung
 * (`junction`, KF4), ohne Namen, Herkunft `avesmaps3d` (die Testwelt legt ihn still). Ein Punkt außerhalb der Karte ist 400; die Tafel
 * prüft es zusätzlich (`nodix_inside_domain`). Die Kachelrevision stößt die Schreibnaht an (`ley_node_render`).
 */
export async function createNodix(
    database: Database,
    actor: MapActor,
    body: NodixCreateBody,
): Promise<{ readonly receipt: OperationReceipt; readonly publicId: string }> {
    const domain = AVENTURIA.mapDomain;
    const publicId = randomUUID();
    const receipt = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "nodix.create", mapDomainId: domain, body },
        async (tx) => {
            const [lage] = await tx<{ inside: boolean | null }[]>`
                SELECT map_domain_contains(${domain}, ST_SetSRID(ST_MakePoint(${body.x}, ${body.y}), 0)) AS inside
            `;
            if (lage?.inside !== true)
                throw new ApiError(400, "validation_failed", "Der Punkt liegt außerhalb der Karte.", { field: "x" });
            const [zeile] = await tx<{ revision: number }[]>`
                INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system, is_active)
                VALUES (${publicId}::uuid, ${domain}, 'junction', ST_SetSRID(ST_MakePoint(${body.x}, ${body.y}), 0), 'avesmaps3d', TRUE)
                RETURNING revision::int AS revision
            `;
            return {
                receipt: {
                    affected: [{ kind: "nodix", id: publicId, revision: zeile!.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                summary: "Neuer Kraftlinienpunkt",
                entries: [
                    {
                        action: "nodix.created",
                        nodixId: publicId,
                        revisionBefore: null,
                        revisionAfter: zeile!.revision,
                        changes: {
                            position: { after: [body.x, body.y] },
                            kind: { after: "junction" },
                            active: { after: true },
                        },
                    },
                ],
            };
        },
    );
    return { receipt, publicId: receipt.affected.find((entity) => entity.kind === "nodix")?.id ?? publicId };
}

/**
 * `nodix.move` (K5): ein Kraftlinienpunkt an eine neue Stelle, EINE Operation gegen seine Revision. Die Bahn jedes Abschnitts, der an ihm
 * endet, folgt in derselben Transaktion (`zieheKraftlinienNach`, wie `place.move`); außerhalb der Karte 400. Eine fremde Sperre an
 * einer Linie hält das Verschieben nicht auf (WI-0205 K11: die Linie selbst bleibt, nur ihre Bahn folgt dem Knoten).
 */
export async function moveNodix(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: NodixMoveBody,
): Promise<OperationReceipt> {
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM nodix WHERE public_id = ${publicId} AND is_active
    `;
    if (vorab === undefined) throw new ApiError(404, "not_found", "Diesen Kraftlinienpunkt gibt es nicht.");
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "nodix.move",
            mapDomainId: vorab.map_domain_id,
            body: { publicId, ...body },
        },
        async (tx) => {
            const [punkt] = await tx<{ revision: number; x: number; y: number }[]>`
                SELECT revision::int AS revision, ST_X(geom) AS x, ST_Y(geom) AS y FROM nodix
                 WHERE public_id = ${publicId} AND is_active FOR UPDATE
            `;
            if (punkt === undefined) throw new ApiError(404, "not_found", "Diesen Kraftlinienpunkt gibt es nicht.");
            if (punkt.revision !== body.baseRevision)
                throw new ApiError(409, "edit_conflict", "Der Kraftlinienpunkt wurde inzwischen geändert.", {
                    revision: punkt.revision,
                });
            const [lage] = await tx<{ inside: boolean | null }[]>`
                SELECT map_domain_contains(${vorab.map_domain_id}, ST_SetSRID(ST_MakePoint(${body.x}, ${body.y}), 0)) AS inside
            `;
            if (lage?.inside !== true)
                throw new ApiError(400, "validation_failed", "Der Punkt liegt außerhalb der Karte.", { field: "x" });
            const [neu] = await tx<{ revision: number }[]>`
                UPDATE nodix SET geom = ST_SetSRID(ST_MakePoint(${body.x}, ${body.y}), 0)
                 WHERE public_id = ${publicId}::uuid RETURNING revision::int AS revision
            `;
            const nachgezogen = await zieheKraftlinienNach(tx, { knoten: [publicId] });
            return {
                receipt: {
                    affected: [{ kind: "nodix", id: publicId, revision: neu!.revision }],
                    derivedWork: nachgezogen > 0 ? [{ kind: "powerline_path", state: "done" }] : [],
                    warnings: [],
                },
                summary: "Kraftlinienpunkt verschoben",
                entries: [
                    {
                        action: "nodix.moved",
                        nodixId: publicId,
                        revisionBefore: punkt.revision,
                        revisionAfter: neu!.revision,
                        changes: { position: { before: [punkt.x, punkt.y], after: [body.x, body.y] } },
                    },
                ],
            };
        },
    );
}
