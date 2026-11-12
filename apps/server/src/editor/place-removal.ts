import type {
    OperationReceipt,
    PlaceDeleteBody,
    PlaceRemoval,
    PlaceRemovalGebiet,
    PlaceRestoreBody,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import type { Sql } from "../auth/session-store.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import {
    domainOf,
    lockedPlace,
    mapEditConflict,
    nextObjectRevision,
    pathEndsAt,
    pruefeFremdeOrtssperre,
    readPlace,
    type PlaceRow,
} from "./place-edit.ts";
import {
    holeStaettenZurueck,
    kraftlinienAm,
    pruefeEntfernen,
    staettenAm,
    staettenStand,
    stillegeStaetten,
} from "./place-removal-regeln.ts";

/**
 * „Ort entfernen“ (WI-0128 E22; Vertrag `shared/editor-place-removal.ts`; Betreiber 2026-10-12: „ort-entfernen-konzept ist prima, genau
 * das wollte ich“): was das Entfernen trifft, und die drei Operationen dahinter.
 *
 * - `place.take_off_map`: „Von der Karte nehmen“, in `place-edit.ts` (`takePlaceOffMap`); es prüft dieselben Regeln.
 * - `place.delete`: „Ganz löschen“, weich. Die Zeile wird stillgelegt (`place.is_active` bzw. `place_unplaced` mit `retired_origin =
 *   'editor'`); Wiki-Zuordnung, Bilder, Quellen bleiben an ihr. Der Wiki-Artikel steht derweil wieder unter „Nicht auf der Karte“, weil
 *   kein aktiver Ort ihn mehr trägt (`wiki-settlement-rows.ts`).
 * - `place.restore`: ↺ eines `place.delete` unter „Änderungen“, solange der Ort seitdem unverändert gelöscht ist (sonst 409).
 *
 * 🔴 Gesperrt (400 `validation_failed`, das Blatt sagt es vorher): eine Kraftlinie am Ort (`field: kraftlinien`, D20, wie
 * Legacy), ein Ort, der selbst ein innerorts-Punkt einer Stadt ist (das ist ein Verlagern und gehört zu E10b), und beim
 * Abnehmen Stätten anders als „bleiben“. Wegenden bleiben liegen und stehen als Befund im Blatt (G1).
 *
 * 🔴 G2: Eine Siedlung lässt sich MIT ihren Stätten löschen. Die belegten Innerorts-Beziehungen gehen in DERSELBEN
 * Transaktion still (`site_settlement`, umkehrbar), ihre Kennungen stehen im Fachprotokoll, und `place.restore` holt genau sie
 * zurück. Legacys Zeilen über den gefalteten Namen (`settlement_place`) bleiben unangetastet: Sie hängen am Namen, nicht an
 * diesem Ort, und verschwinden von selbst aus jedem Leser, solange kein aktiver Ort so heißt.
 */

/** Die Zeile in `place`, an der Wiki, Bilder und Quellen hängen; ein Ort, der nie auf der Karte stand, hat keine. */
async function placeIdOf(sql: Queryable, row: PlaceRow): Promise<string | undefined> {
    if (!row.unplaced) return row.id;
    const [stillgelegt] = await sql<
        { id: string }[]
    >`SELECT id::text FROM place WHERE public_id = ${row.public_id}::uuid`;
    return stillgelegt?.id;
}

/** Was das Entfernen trifft (`GET …/removal`); `undefined`, wenn es den Ort nicht (mehr) gibt. */
export async function readPlaceRemoval(database: Database, publicId: string): Promise<PlaceRemoval | undefined> {
    const row = await readPlace(database, publicId, false);
    if (row === undefined || (!row.unplaced && !row.is_active)) return undefined;
    const stand = await staettenStand(database, row);
    // Beide Bindungen der Stätten, an einer Stelle mit der Sperrregel (`place-removal-regeln.ts`, Befund Q-01).
    const staetten = await staettenAm(database, row);
    const gebiete = await database<PlaceRemovalGebiet[]>`
        SELECT t.name, 'hauptstadt' AS rolle FROM territory t WHERE t.is_active AND t.capital_place_public_id = ${publicId}::uuid
        UNION ALL
        SELECT t.name, 'sitz' AS rolle FROM territory t WHERE t.is_active AND t.seat_place_public_id = ${publicId}::uuid
        ORDER BY rolle, name
    `;
    const placeId = await placeIdOf(database, row);
    const [bleibt] =
        placeId === undefined
            ? []
            : await database<PlaceRemoval["bleibt"][]>`
                  SELECT EXISTS (SELECT 1 FROM place_wiki_assignment a WHERE a.place_id = ${placeId}::bigint AND a.is_active) AS wiki,
                         ((SELECT count(*) FROM place_media m WHERE m.place_id = ${placeId}::bigint AND m.retired_at IS NULL)
                          + (SELECT count(*) FROM place_media_gallery g
                               JOIN media_gallery_item i ON i.gallery_id = g.media_gallery_id AND i.retired_at IS NULL
                              WHERE g.place_id = ${placeId}::bigint AND g.retired_at IS NULL))::int AS bilder,
                         (SELECT count(*)::int FROM place_source s WHERE s.place_id = ${placeId}::bigint AND s.is_active) AS quellen,
                         (SELECT count(*)::int FROM citymap_place c WHERE c.place_id = ${placeId}::bigint AND c.is_active) AS stadtplaene,
                         (SELECT count(*)::int FROM adventure_place a WHERE a.place_id = ${placeId}::bigint AND a.is_active) AS abenteuer,
                         (SELECT count(*)::int FROM place_review r WHERE r.place_id = ${placeId}::bigint) AS bewertungen
              `;
    return {
        publicId: row.public_id,
        name: row.name,
        revision: row.revision,
        onMap: !row.unplaced,
        subtype: row.subtype,
        ...(row.x !== null && row.y !== null && !row.unplaced ? { position: { x: row.x, y: row.y } } : {}),
        staetten,
        ...(stand.innerortsVon !== null ? { innerortsVon: stand.innerortsVon } : {}),
        wegenden: row.unplaced ? [] : (await pathEndsAt(database, row)).map((ende) => ende.name),
        gebiete,
        kraftlinien: await kraftlinienAm(database, publicId),
        bleibt: bleibt ?? { wiki: false, bilder: 0, quellen: 0, stadtplaene: 0, abenteuer: 0, bewertungen: 0 },
    };
}

/** Die Handlung im Fachprotokoll: Sie sagt `place.restore`, welche Zeile zurückkommt. */
const GELOESCHT = { karte: "place.deleted", ohneLage: "place.deleted_unplaced" } as const;

/** `place.delete`: „Ganz löschen“, weich (D20, „Wiederherstellen unter Änderungen“). */
export async function deletePlace(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PlaceDeleteBody,
): Promise<OperationReceipt> {
    const domain = await domainOf(database, publicId);
    return mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "place.delete", mapDomainId: domain, body: { publicId, ...body } },
        async (tx) => {
            await pruefeFremdeOrtssperre(tx, actor, [publicId]);
            const row = await lockedPlace(tx, publicId, body.baseRevision);
            if (!row.unplaced && !row.is_active)
                throw new ApiError(400, "validation_failed", "Dieser Ort ist schon gelöscht.");
            await pruefeEntfernen(tx, row, "loeschen", undefined);
            const { revision, stillgelegt, entry } = await loescheOrt(tx, row);
            return {
                receipt: {
                    affected: [{ kind: "place", id: row.public_id, revision }],
                    derivedWork: row.unplaced ? [] : [{ kind: "routing", state: "pending" }],
                    warnings: [],
                },
                summary:
                    stillgelegt === 0
                        ? `${row.name} gelöscht`
                        : `${row.name} gelöscht, ${String(stillgelegt)} Stätten mit stillgelegt`,
                entries: [entry],
            };
        },
    );
}

/**
 * „Ganz löschen“ an EINEM gesperrten und geprüften Ort (`pruefeEntfernen`), für `place.delete` einzeln und für mehrere (WI-0237): die
 * Stätten umkehrbar mit (G2), die Zeile still, die Revision über beiden Tafeln. Gibt den Eintrag fürs Fachprotokoll zurück.
 */
export async function loescheOrt(
    tx: Sql,
    row: PlaceRow,
): Promise<{ revision: number; stillgelegt: number; entry: MapAuditEntry }> {
    // G2: Die belegten Innerorts-Beziehungen gehen mit, umkehrbar; ihre Kennungen trägt das Protokoll.
    const stillgelegt = await stillegeStaetten(tx, row);
    // Die nächste Revision über beiden Zeilen (0115): Die Revision eines Orts fällt nie zurück, auch über place und place_unplaced.
    const revision = await nextObjectRevision(tx, row.public_id);
    const [still] = row.unplaced
        ? await tx<{ revision: number }[]>`
              UPDATE place_unplaced SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', revision = ${revision}
               WHERE id = ${row.id}::bigint RETURNING revision::int AS revision
          `
        : await tx<{ revision: number }[]>`
              UPDATE place SET is_active = FALSE, revision = ${revision} WHERE id = ${row.id}::bigint
              RETURNING revision::int AS revision
          `;
    return {
        revision: still!.revision,
        stillgelegt: stillgelegt.length,
        entry: {
            action: row.unplaced ? GELOESCHT.ohneLage : GELOESCHT.karte,
            placeId: row.public_id,
            revisionBefore: row.revision,
            revisionAfter: still!.revision,
            changes: {
                active: { before: true, after: false },
                ...(stillgelegt.length > 0 ? { staetten: { before: stillgelegt, after: [] } } : {}),
            },
        },
    };
}

/** `place.restore`: ↺ eines `place.delete`. Die gelöschte Zeile kommt zurück, wenn sie seitdem niemand verändert hat. */
export async function restorePlace(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: PlaceRestoreBody,
): Promise<OperationReceipt> {
    const [geloescht] = await database<
        {
            action: string;
            revision_after: number | null;
            map_domain_id: string;
            changes: { staetten?: { before?: unknown } } | null;
        }[]
    >`
        SELECT e.action, e.revision_after::int AS revision_after, o.map_domain_id, e.changes
          FROM map_audit_event e JOIN map_operation o ON o.operation_id = e.operation_id
         WHERE e.operation_id = ${body.reverts}::uuid AND e.place_public_id = ${publicId}::uuid AND o.action = 'place.delete'
    `;
    if (geloescht === undefined)
        throw new ApiError(400, "validation_failed", "Diese Operation hat den Ort nicht gelöscht.", {
            field: "reverts",
        });
    const ohneLage = geloescht.action === GELOESCHT.ohneLage;
    // G2: Genau die Beziehungen, die mit DIESEM Löschen stillgelegt wurden - nicht alle, die heute an dem Ort still liegen.
    const vorherStaetten = geloescht.changes?.staetten?.before;
    const staettenZurueck: string[] = Array.isArray(vorherStaetten)
        ? vorherStaetten.filter((x): x is string => typeof x === "string")
        : [];
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "place.restore",
            mapDomainId: geloescht.map_domain_id,
            body: { publicId, ...body },
            source: "restore",
        },
        async (tx) => {
            await pruefeFremdeOrtssperre(tx, actor, [publicId]);
            return holeOrtZurueck(tx, publicId, { ohneLage, staettenZurueck, revisionAfter: geloescht.revision_after });
        },
    );
}

/**
 * Ein gelöschter Ort kommt zurück (`place.restore`, und die Rücknahme eines „Ganz löschen“ für mehrere in EINER Operation, `ruecknahme-ort.ts`): die Zeile aktiv, die Revision über
 * beiden Tafeln, genau die Stätten, die mit DIESEM Löschen stillgelegt wurden. Gesperrt gelesen; 409, wenn der Ort seit dem Löschen (`revisionAfter`) verändert wurde, 400, wenn es ihn
 * wieder gibt.
 */
export async function holeOrtZurueck(
    tx: Sql,
    publicId: string,
    geloescht: { ohneLage: boolean; staettenZurueck: readonly string[]; revisionAfter: number | null },
): Promise<{
    receipt: Pick<OperationReceipt, "affected" | "derivedWork" | "warnings">;
    summary: string;
    entries: MapAuditEntry[];
}> {
    const { ohneLage, staettenZurueck } = geloescht;
    const [zeile] = ohneLage
        ? await tx<{ id: string; name: string; revision: number; is_active: boolean; updated_at: Date }[]>`
                      SELECT id::text, name, revision::int AS revision, is_active, updated_at FROM place_unplaced
                       WHERE public_id = ${publicId}::uuid FOR UPDATE
                  `
        : await tx<{ id: string; name: string; revision: number; is_active: boolean; updated_at: Date }[]>`
                      SELECT id::text, name, revision::int AS revision, is_active, updated_at FROM place
                       WHERE public_id = ${publicId}::uuid FOR UPDATE
                  `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
    const [anders] = await tx<{ da: boolean }[]>`
                SELECT EXISTS (SELECT 1 FROM place WHERE public_id = ${publicId}::uuid AND is_active)
                    OR EXISTS (SELECT 1 FROM place_unplaced WHERE public_id = ${publicId}::uuid AND is_active) AS da
            `;
    if (zeile.is_active || anders?.da === true)
        throw new ApiError(400, "validation_failed", `${zeile.name} ist schon wieder da.`);
    if (zeile.revision !== geloescht.revisionAfter)
        throw await mapEditConflict(
            tx,
            { kind: "place", publicId },
            { revision: zeile.revision, changedAt: zeile.updated_at },
        );
    const revision = await nextObjectRevision(tx, publicId);
    const geholt = await holeStaettenZurueck(tx, staettenZurueck);
    const [zurueck] = ohneLage
        ? await tx<{ revision: number }[]>`
                      UPDATE place_unplaced SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, revision = ${revision}
                       WHERE id = ${zeile.id}::bigint RETURNING revision::int AS revision
                  `
        : await tx<{ revision: number }[]>`
                      UPDATE place SET is_active = TRUE, revision = ${revision} WHERE id = ${zeile.id}::bigint
                      RETURNING revision::int AS revision
                  `;
    return {
        receipt: {
            affected: [{ kind: "place", id: publicId, revision: zurueck!.revision }],
            derivedWork: ohneLage ? [] : [{ kind: "routing", state: "pending" }],
            // Eine Beziehung, die inzwischen jemand anders angefasst hat, kommt nicht zurück: ein Befund, kein Fehler.
            warnings:
                geholt === staettenZurueck.length
                    ? []
                    : [
                          {
                              code: "staetten_teilweise_zurueck",
                              message: `${String(staettenZurueck.length - geholt)} von ${String(staettenZurueck.length)} Stätten kamen nicht zurück; sie wurden seitdem anders zugeordnet.`,
                          },
                      ],
        },
        summary:
            geholt === 0
                ? `${zeile.name} wiederhergestellt`
                : `${zeile.name} wiederhergestellt, ${String(geholt)} Stätten zurück`,
        entries: [
            {
                action: "place.restored",
                placeId: publicId,
                revisionBefore: zeile.revision,
                revisionAfter: zurueck!.revision,
                changes: {
                    active: { before: false, after: true },
                    ...(staettenZurueck.length > 0 ? { staetten: { before: [], after: staettenZurueck } } : {}),
                },
            },
        ],
    };
}
