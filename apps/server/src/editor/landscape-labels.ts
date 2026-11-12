import { randomUUID } from "node:crypto";
import type {
    LandscapeLabelCreateBody,
    LandscapeLabelCreateReceipt,
    LandscapeLabelRetireBody,
    OperationReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { LANDSCHAFT_ART, mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";

/**
 * Beschriftungen einer Landschaft anlegen, duplizieren und löschen (WI-0232, Werkzeug 2 des Werkzeugplans der Derographie; Thomas 4.1,
 * wörtlich „Beschriftungen hinzufügen oder bearbeiten“). Vertrag am Ende von `packages/shared/src/landscape-editor.ts`. Je EINE
 * Sofort-Operation gegen die Revision der Landschaft (wie „Gipfel setzen“), mit der Sperre der Landschaft (409 `object_locked`); die
 * Schriftläufe folgen über `deriveAfter` (`affected` nennt die Landschaft).
 *
 * - **Wie Legacy** (Mirror a7f2dac8, `js/map-features/map-features-labels.js`): `create_label` mit Text und Art der Fläche (FL3; Owner
 *   10.09.2026: die Art kommt von der Fläche, ohne Art `region`), beim Duplizieren dazu Größe, Rang, Zoomband und Sichtbarkeit des Originals
 *   (`duplicateLabelEntry`, `#L2151-L2236`). Gelöscht wird nicht, wo eine Kraftlinie endet (`refusePowerlineAnchoredDeletion`; 409 wie
 *   „Fläche entfernen“). Die LETZTE Beschriftung nimmt die Landschaft mit (Owner 2026-07-28, `avesmapsEcosystemCascadeAfterRemoval`): bei
 *   uns über „Fläche entfernen …“ (`landscape.retire`, D2), nicht hier; `label.retire` weist sie mit 409 `last_label` ab (Editor-
 *   Orchestrierung 2026-10-19 „B“).
 * - **Anders als Legacy:** gelöscht wird nur still (`is_active`), nie hart (`map-grants.psql` entzieht der App DELETE).
 * - F7: An einer Landschaft „entlang der Fläche“ gibt es keine Beschriftung an einem Punkt (400).
 * - ↺ im Verlauf: das Gegenstück mit `reverts` (`label.retire` nimmt ein `label.create` zurück, `label.create` holt ein `label.retire`
 *   zurück), Quelle `restore`, nur wenn die Beschriftung noch so steht, wie die Operation sie hinterließ (sonst 409 `edit_conflict`).
 * - 🪤 Bis zum Cutoff holt der Landschaften-Zug eine stillgelegte Legacy-Beschriftung zurück (der Import schreibt `is_active` aus Legacy),
 *   wie bei „Fläche entfernen“; eigene Beschriftungen (`avesmaps3d`) fasst er nicht an.
 */

interface LandschaftZeile {
    id: string;
    public_id: string;
    name: string;
    region_type: string | null;
    label_curve_enabled: boolean | null;
    map_domain_id: string;
    revision: number;
    is_active: boolean;
    updated_at: Date;
}

interface Vorlage {
    label_size: string | null;
    label_priority: number | null;
    label_min_zoom: number | null;
    label_max_zoom: number | null;
    show_name: boolean | null;
}

interface LabelZeile {
    public_id: string;
    revision: number;
    updated_at: Date;
    is_active: boolean;
}

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

async function leseLandschaft(
    sql: Sql | Database,
    regionId: string,
    sperren = false,
): Promise<LandschaftZeile | undefined> {
    const [zeile] = sperren
        ? await sql<LandschaftZeile[]>`
              SELECT id::text AS id, public_id::text AS public_id, name, region_type, label_curve_enabled, map_domain_id,
                     revision::int AS revision, is_active, updated_at
                FROM region WHERE public_id = ${regionId}::uuid FOR UPDATE
          `
        : await sql<LandschaftZeile[]>`
              SELECT id::text AS id, public_id::text AS public_id, name, region_type, label_curve_enabled, map_domain_id,
                     revision::int AS revision, is_active, updated_at
                FROM region WHERE public_id = ${regionId}::uuid
          `;
    return zeile;
}

/** In der Transaktion: die Landschaft gesperrt, gegen ihre Revision, ohne fremde Sperre. */
async function landschaftZumSchreiben(
    tx: Sql,
    actor: MapActor,
    regionId: string,
    baseRevision: number,
): Promise<LandschaftZeile> {
    const landschaft = await leseLandschaft(tx, regionId, true);
    if (landschaft === undefined || !landschaft.is_active)
        throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht.");
    if (landschaft.revision !== baseRevision)
        throw await mapEditConflict(
            tx,
            { kind: "region", publicId: regionId },
            { revision: landschaft.revision, changedAt: landschaft.updated_at },
        );
    await pruefeFremdeSperre(tx, actor, [regionId]);
    return landschaft;
}

/** Die Landschaft berühren: zählt ihre Revision (Trigger `region_revision`, 0137) und ist zugleich die Konfliktprüfung. */
async function beruehreLandschaft(tx: Sql, landschaft: LandschaftZeile): Promise<number> {
    const [danach] = await tx<{ revision: number }[]>`
        UPDATE region SET revision = revision WHERE id = ${landschaft.id}::bigint AND revision = ${landschaft.revision}
        RETURNING revision::int AS revision
    `;
    return danach!.revision;
}

const f7 = (landschaft: LandschaftZeile): void => {
    if (landschaft.label_curve_enabled === true)
        throw ungueltig(
            "Diese Landschaft ist entlang der Fläche beschriftet; eine Beschriftung an einem Punkt geht hier nicht.",
            { field: "placement" },
        );
};

/** Wie stand die Beschriftung nach der Operation `reverts`? `undefined`, wenn die Operation dazu nicht passt. */
async function stand(
    tx: Sql,
    reverts: string,
    operation: "label.create" | "label.retire",
    regionId: string,
    labelId?: string,
): Promise<{ labelId: string; revisionAfter: number } | undefined> {
    const [zeile] = await tx<{ label: string; revision_after: number | null }[]>`
        SELECT e.map_label_public_id::text AS label, e.revision_after::int AS revision_after
          FROM map_operation o JOIN map_audit_event e ON e.operation_id = o.operation_id
         WHERE o.operation_id = ${reverts}::uuid AND o.action = ${operation}
           AND e.region_public_id = ${regionId}::uuid AND e.map_label_public_id IS NOT NULL
         ORDER BY e.id LIMIT 1
    `;
    if (zeile === undefined || zeile.revision_after === null) return undefined;
    if (labelId !== undefined && zeile.label !== labelId) return undefined;
    return { labelId: zeile.label, revisionAfter: zeile.revision_after };
}

const zurueckKonflikt = (): ApiError =>
    new ApiError(
        409,
        "edit_conflict",
        "Seitdem hat sich die Beschriftung geändert; das lässt sich nicht mehr zurücknehmen.",
    );

/** `label.create` (`POST /api/editor/landscapes/:id/labels`): neu, als Duplikat oder ↺ eines Löschens. */
export async function createLandscapeLabel(
    database: Database,
    actor: MapActor,
    regionId: string,
    body: LandscapeLabelCreateBody,
): Promise<LandscapeLabelCreateReceipt> {
    const vorab = await leseLandschaft(database, regionId);
    if (vorab === undefined || !vorab.is_active) throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht.");
    if (body.reverts !== undefined && (body.position !== undefined || body.from !== undefined))
        throw ungueltig("↺ holt eine Beschriftung zurück, wie sie war; Lage und Vorlage gehen nicht mit.", {
            field: "reverts",
        });
    let publicId: string = randomUUID();
    const receipt = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "label.create",
            mapDomainId: vorab.map_domain_id,
            body: { regionId, ...body },
            ...(body.reverts === undefined ? {} : { source: "restore" as const }),
        },
        async (tx) => {
            const landschaft = await landschaftZumSchreiben(tx, actor, regionId, body.baseRevision);
            f7(landschaft);
            let eintrag: MapAuditEntry;
            if (body.reverts !== undefined) {
                // ↺ eines Löschens: genau diese Beschriftung wieder aktiv, wenn sie noch so steht.
                const vorher = await stand(tx, body.reverts, "label.retire", regionId);
                if (vorher === undefined)
                    throw ungueltig("Diese Operation lässt sich hier nicht zurücknehmen.", { field: "reverts" });
                const [label] = await tx<LabelZeile[]>`
                    SELECT public_id::text AS public_id, revision::int AS revision, updated_at, is_active
                      FROM map_label WHERE public_id = ${vorher.labelId}::uuid AND region_id = ${landschaft.id}::bigint
                       FOR NO KEY UPDATE
                `;
                if (label === undefined || label.is_active || label.revision !== vorher.revisionAfter)
                    throw zurueckKonflikt();
                const [danach] = await tx<{ revision: number }[]>`
                    UPDATE map_label SET is_active = TRUE WHERE public_id = ${label.public_id}::uuid RETURNING revision::int AS revision
                `;
                publicId = label.public_id;
                eintrag = {
                    action: "label.restored",
                    regionId,
                    labelId: publicId,
                    revisionBefore: label.revision,
                    revisionAfter: danach!.revision,
                    changes: { active: { before: false, after: true } },
                };
            } else {
                eintrag = await legeAn(tx, landschaft, publicId, body);
            }
            const region = await beruehreLandschaft(tx, landschaft);
            return {
                receipt: {
                    affected: [
                        { kind: LANDSCHAFT_ART, id: regionId, revision: region },
                        { kind: "label", id: publicId, revision: eintrag.revisionAfter! },
                    ],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `${landschaft.name}: ${
                    body.reverts !== undefined
                        ? "Beschriftung zurückgeholt"
                        : body.from !== undefined
                          ? "Beschriftung dupliziert"
                          : "neue Beschriftung"
                }`,
                entries: [eintrag],
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung (`runOperation`): Ihre Beschriftung ist die aus der Quittung.
    const angelegt = receipt.affected.find((entity) => entity.kind === "label")?.id ?? publicId;
    return { ...receipt, publicId: angelegt };
}

/** Eine neue Zeile in `map_label`: Text und Art der Landschaft, an einem Punkt, eigene Herkunft, hinten in der Folge. */
async function legeAn(
    tx: Sql,
    landschaft: LandschaftZeile,
    publicId: string,
    body: LandscapeLabelCreateBody,
): Promise<MapAuditEntry> {
    let vorlage: Vorlage | undefined;
    if (body.from !== undefined) {
        [vorlage] = await tx<Vorlage[]>`
            SELECT label_size::text AS label_size, label_priority, label_min_zoom, label_max_zoom, show_name
              FROM map_label WHERE public_id = ${body.from}::uuid AND region_id = ${landschaft.id}::bigint AND is_active
        `;
        if (vorlage === undefined) throw ungueltig("Die Vorlage gehört nicht zur Landschaft.", { field: "from" });
    }
    // Ohne Lage ein Punkt in der Fläche (die Derographie, 2026-10-19).
    let lage = body.position;
    if (lage === undefined) {
        const [punkt] = await tx<{ x: number | null; y: number | null }[]>`
            SELECT ST_X(p) AS x, ST_Y(p) AS y
              FROM (SELECT ST_PointOnSurface(ST_Union(geom)) AS p FROM region_area
                     WHERE region_id = ${landschaft.id}::bigint AND is_active) AS t
        `;
        if (punkt?.x === null || punkt?.x === undefined || punkt.y === null)
            throw ungueltig("Die Landschaft hat keine Fläche; sag, wo die Beschriftung stehen soll.", {
                field: "position",
            });
        lage = [punkt.x, punkt.y];
    }
    const [x, y] = lage;
    const [drin] = await tx<{ inside: boolean }[]>`
        SELECT map_domain_contains(${landschaft.map_domain_id}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)) AS inside
    `;
    if (drin?.inside !== true) throw ungueltig("Die Beschriftung liegt außerhalb der Karte.", { field: "position" });
    const art = landschaft.region_type ?? "region";
    const [neu] = await tx<{ revision: number; sort_order: number }[]>`
        INSERT INTO map_label (
            public_id, map_domain_id, region_id, name, subtype, geom,
            label_size, label_priority, label_min_zoom, label_max_zoom, show_name,
            placement, sort_order, text_follows_name, source_system, is_active
        )
        SELECT ${publicId}::uuid, ${landschaft.map_domain_id}, ${landschaft.id}::bigint, ${landschaft.name}, ${art},
               ST_SetSRID(ST_MakePoint(${x}, ${y}), 0),
               ${vorlage?.label_size ?? null}::numeric(4, 1), ${vorlage?.label_priority ?? null}::smallint,
               ${vorlage?.label_min_zoom ?? null}::smallint, ${vorlage?.label_max_zoom ?? null}::smallint,
               ${vorlage === undefined ? true : vorlage.show_name}::boolean,
               'punkt',
               (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM map_label WHERE region_id = ${landschaft.id}::bigint AND is_active),
               TRUE, 'avesmaps3d', TRUE
        RETURNING revision::int AS revision, sort_order
    `;
    // Die Felder der Positivliste (`MAP_AUDIT_FIELDS.label`); ein Duplikat nennt, was es vom Original übernahm.
    const changes: Record<string, { before: unknown; after: unknown }> = {
        active: { before: null, after: true },
        text: { before: null, after: landschaft.name },
        type: { before: null, after: art },
        position: { before: null, after: [x, y] },
        placement: { before: null, after: "punkt" },
        textFollowsName: { before: null, after: true },
        order: { before: null, after: neu!.sort_order },
    };
    if (vorlage !== undefined) {
        changes["size"] = { before: null, after: vorlage.label_size === null ? null : Number(vorlage.label_size) };
        changes["priority"] = { before: null, after: vorlage.label_priority };
        changes["zoom"] = { before: null, after: [vorlage.label_min_zoom, vorlage.label_max_zoom] };
        changes["showName"] = { before: null, after: vorlage.show_name };
    }
    return {
        action: "label.created",
        regionId: landschaft.public_id,
        labelId: publicId,
        revisionBefore: null,
        revisionAfter: neu!.revision,
        changes,
    };
}

/** `label.retire` (`POST /api/editor/landscapes/:id/labels/:labelId/retire`): still legen, oder ↺ eines Anlegens. */
export async function retireLandscapeLabel(
    database: Database,
    actor: MapActor,
    regionId: string,
    labelId: string,
    body: LandscapeLabelRetireBody,
): Promise<OperationReceipt> {
    const vorab = await leseLandschaft(database, regionId);
    if (vorab === undefined || !vorab.is_active) throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht.");
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "label.retire",
            mapDomainId: vorab.map_domain_id,
            body: { regionId, labelId, ...body },
            ...(body.reverts === undefined ? {} : { source: "restore" as const }),
        },
        async (tx) => {
            const landschaft = await landschaftZumSchreiben(tx, actor, regionId, body.baseRevision);
            const [label] = await tx<LabelZeile[]>`
                SELECT public_id::text AS public_id, revision::int AS revision, updated_at, is_active
                  FROM map_label WHERE public_id = ${labelId}::uuid AND region_id = ${landschaft.id}::bigint AND is_active
                   FOR NO KEY UPDATE
            `;
            if (label === undefined)
                throw new ApiError(404, "not_found", "Diese Beschriftung gibt es an der Landschaft nicht.");
            if (body.reverts !== undefined) {
                // ↺ eines Anlegens: nur, wenn die Beschriftung noch so steht, wie das Anlegen sie hinterließ.
                const vorher = await stand(tx, body.reverts, "label.create", regionId, labelId);
                if (vorher === undefined)
                    throw ungueltig("Diese Operation lässt sich hier nicht zurücknehmen.", { field: "reverts" });
                if (label.revision !== vorher.revisionAfter) throw zurueckKonflikt();
            }
            if (label.revision !== body.labelRevision)
                throw await mapEditConflict(
                    tx,
                    { kind: "label", publicId: labelId },
                    { revision: label.revision, changedAt: label.updated_at },
                );
            const linien = await tx<{ name: string }[]>`
                SELECT DISTINCT coalesce(nullif(p.name, ''), p.public_id::text) AS name
                  FROM powerline p
                 WHERE (p.is_active OR p.off_map) AND ${labelId}::uuid IN (p.from_public_id, p.to_public_id)
                 ORDER BY 1
            `;
            if (linien.length > 0)
                throw new ApiError(
                    409,
                    "powerline_endpoint",
                    `An dieser Beschriftung endet eine Kraftlinie (${linien
                        .slice(0, 3)
                        .map((l) => l.name)
                        .join(", ")}); erst sie umhängen oder entfernen.`,
                    { powerlines: linien.map((l) => l.name) },
                );
            // Die letzte Beschriftung nimmt die Landschaft mit (Betreiber 2026-07-28 in Legacy): das geht über „Fläche entfernen …“.
            // ↺ eines Anlegens stellt dagegen nur den Stand davor her, auch eine Landschaft ohne Beschriftung.
            if (body.reverts === undefined) {
                const [rest] = await tx<{ andere: number; flaechen: number }[]>`
                    SELECT (SELECT count(*)::int FROM map_label
                             WHERE region_id = ${landschaft.id}::bigint AND is_active AND public_id <> ${labelId}::uuid) AS andere,
                           (SELECT count(*)::int FROM region_area WHERE region_id = ${landschaft.id}::bigint AND is_active) AS flaechen
                `;
                if (rest!.andere === 0)
                    throw new ApiError(
                        409,
                        "last_label",
                        `Das ist die letzte Beschriftung von „${landschaft.name}“. Die Landschaft mit ${rest!.flaechen === 1 ? "ihrer Fläche" : `${rest!.flaechen} Flächen`} wird mit entfernt.`,
                        { name: landschaft.name, areas: rest!.flaechen, regionRevision: landschaft.revision },
                    );
            }
            const [danach] = await tx<{ revision: number }[]>`
                UPDATE map_label SET is_active = FALSE WHERE public_id = ${labelId}::uuid RETURNING revision::int AS revision
            `;
            const region = await beruehreLandschaft(tx, landschaft);
            return {
                receipt: {
                    affected: [
                        { kind: LANDSCHAFT_ART, id: regionId, revision: region },
                        { kind: "label", id: labelId, revision: danach!.revision },
                    ],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `${landschaft.name}: Beschriftung ${body.reverts === undefined ? "gelöscht" : "zurückgenommen"}`,
                entries: [
                    {
                        action: "label.retired",
                        regionId,
                        labelId,
                        revisionBefore: label.revision,
                        revisionAfter: danach!.revision,
                        changes: { active: { before: true, after: false } },
                    },
                ],
            };
        },
    );
}
