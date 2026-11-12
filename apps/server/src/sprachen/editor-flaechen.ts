import { randomUUID } from "node:crypto";
import type { PendingQuery, Row } from "postgres";
import {
    SPRACHE_RING_MAX,
    type OperationReceipt,
    type PinselErgebnis,
    type PinselStrich,
    type SpracheFlaecheAngelegt,
    type SpracheFlaecheAnlegenBody,
    type SpracheFlaecheUmformenBody,
    type SpracheStandBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { mapOperation, type MapActor, type MapChange } from "../editor/map-operation.ts";
import { rechneStrich } from "../editor/pinsel-strich.ts";
import { mapEditConflict } from "../editor/place-edit.ts";
import { bereinige, geojsonAus, gleich, polygoneVon, ringe, type Polygone, type Punkt } from "../editor/ring-form.ts";
import { ApiError } from "../http/api-error.ts";
import {
    SPRACHE_ART,
    SPRACHEN_DOMAENE,
    SPRACHFLAECHE_ART,
    flaechenStand,
    spracheZumSchreiben,
    ungueltig,
    verlangeSprachSperre,
} from "./editor-naht.ts";

/**
 * Die Schreibwege an den Teilflächen einer Sprache (WI-0261 S5d; Vertrag im Kopf von `packages/shared/src/sprachen-editor.ts`): `sprache_flaeche.create`,
 * `.reshape`, `.retire`, `.restore`. Je EINE Operation an der Karte mit Fachprotokoll (Ziele `sprache_flaeche_public_id` und `sprache_public_id`, Migration 0258)
 * und nur mit der Sperre ihrer Sprache (`editor-naht.ts`).
 *
 * - 🔴 **Flächen sind unabhängig und dürfen sich überlappen** (E2, Betreiber 2026-10-30: „flächen dürfen sich überlappen und sind unabhängig voneinander“):
 *   Geprüft wird nur die eigene Form, wie bei den Gebieten (`ring-form.ts`): Ringe mit mindestens drei Ecken (ohne Schlusspunkt, ohne doppelte Ecken), jede
 *   Ecke in der Karte, die Form gültig (`ST_IsValid`). Nie gegen andere Sprachen, und nichts rastet ein (E4). Eine schon vorher ungültige Fläche bleibt
 *   bearbeitbar (wie `landscape-reshape.ts`). Keine Rundung: Unveränderte Ecken bleiben bitgenau.
 * - 🔴 **Umformen macht die Fläche zu einer der Redaktion** (T-1): Herkunft `redaktion`, `quelle_revision` leer. Ein erneuter Import der Sprachenkarte ersetzt
 *   nur Flächen der Herkunft `sprachenkarte` (`migration/sprachen-import.ts`); bliebe die umgeformte Fläche eine der Sprachenkarte, legte der nächste Import
 *   mit einer neuen Datei sie still und ersetzte die Arbeit der Redaktion durch die Vorlage. Ein Import mit derselben Datei fasst ohnehin nichts an.
 * - **Stilllegen löscht nie** (`retired_origin = editor`); Zurückholen nur, was die Redaktion stilllegte: Eine Fläche, die ein späterer Import ersetzte
 *   (`retired_origin = import`), gehört zu einer alten Vorlage und kommt nicht zurück.
 * - **Folgen:** Jede dieser Operationen nennt die Sprache unter `affected`; die Schreibnaht reiht darauf den Auftrag `sprache_treffer` für sie ein und meldet
 *   `map.changed` (`editor/map-operation.ts`, `sprachen/treffer-auftrag.ts`).
 * - **Der Pinselstrich** (`maleSprachStrich`, WI-0261 Stufe 2) schreibt nichts: Er rechnet wie an der Landschaft, das Ergebnis geht in den Entwurf, und
 *   erst „Fertig“ schreibt EINE Operation `reshape`, deren Protokoll die ganze Form vorher und nachher trägt (`changes.geometry`).
 */

/** Eine Teilfläche, wie die Schreibwege sie lesen (auch die Werkzeuge der Stufe 3, `editor-flaechen-werkzeuge.ts`); `id` und `sprache_id` sind intern. */
export interface FlaechenZeile {
    id: string;
    public_id: string;
    sprache_id: string;
    sprache_public_id: string;
    sprache_name: string;
    sprache_revision: number;
    sprache_aktiv: boolean;
    map_domain_id: string;
    herkunft: string;
    quelle_revision: string | null;
    is_active: boolean;
    retired_origin: string | null;
    revision: number;
    updated_at: Date;
    geojson: string;
    gueltig: boolean;
}

const SPALTEN = (sql: Queryable) => sql`
    f.id::text, f.public_id::text, f.sprache_id::text, s.public_id::text AS sprache_public_id, s.name AS sprache_name,
    s.revision::int AS sprache_revision, s.is_active AS sprache_aktiv, f.map_domain_id, f.herkunft, f.quelle_revision,
    f.is_active, f.retired_origin, f.revision::int AS revision, f.updated_at, ST_AsGeoJSON(f.geom, 15) AS geojson,
    ST_IsValid(f.geom) AS gueltig
`;

export async function leseFlaeche(
    sql: Queryable,
    flaecheId: string,
    sperren: boolean,
): Promise<FlaechenZeile | undefined> {
    const [zeile] = await sql<FlaechenZeile[]>`
        SELECT ${SPALTEN(sql)}
          FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
         WHERE f.public_id = ${flaecheId}::uuid
         ${sperren ? sql`FOR UPDATE OF f` : sql``}
    `;
    return zeile;
}

/** Mehrere Teilflächen nach ihrer internen Kennung, in deren Folge, gesperrt (Stufe 3: die Teilflächen, die beim Vereinigen in einer aufgehen). */
export async function leseFlaechenGesperrt(sql: Queryable, ids: readonly string[]): Promise<FlaechenZeile[]> {
    if (ids.length === 0) return [];
    return sql<FlaechenZeile[]>`
        SELECT ${SPALTEN(sql)}
          FROM sprache_flaeche f JOIN sprache s ON s.id = f.sprache_id
         WHERE f.id = ANY(${ids as string[]}::bigint[])
         ORDER BY f.id
           FOR UPDATE OF f
    `;
}

/** Die Teilfläche für eine Operation: gesperrt, zur Sprache gehörig (sonst 404), gegen `baseRevision` geprüft (409 `edit_conflict`). */
export async function flaecheZumSchreiben(
    tx: Sql,
    spracheId: string,
    flaecheId: string,
    baseRevision: number,
): Promise<FlaechenZeile> {
    const zeile = await leseFlaeche(tx, flaecheId, true);
    if (zeile === undefined || zeile.sprache_public_id !== spracheId)
        throw new ApiError(404, "not_found", "Diese Teilfläche gibt es an dieser Sprache nicht.");
    if (zeile.revision !== baseRevision)
        throw await mapEditConflict(
            tx,
            { kind: "sprache_flaeche", publicId: flaecheId },
            { revision: zeile.revision, changedAt: zeile.updated_at },
        );
    if (!zeile.sprache_aktiv)
        throw ungueltig("Diese Sprache ist stillgelegt; erst zurückholen, dann ändern.", { field: "state" });
    return zeile;
}

/** Bereinigt die Ringe (ohne Schlusspunkt, ohne doppelte Ecken) und prüft ihre Zahl; vor der Transaktion. */
function formAus(polygons: Polygone): Punkt[][][] {
    const polygone = bereinige(polygons);
    if (polygone.some((polygon) => polygon.some((ring) => ring.length < 3)))
        throw ungueltig("Ein Ring braucht mindestens drei Ecken.", { field: "polygons" });
    if (polygone.flat(2).length > SPRACHE_RING_MAX)
        throw ungueltig(`Eine Teilfläche hat höchstens ${String(SPRACHE_RING_MAX)} Ecken.`, { field: "polygons" });
    return polygone;
}

/**
 * Prüft die Form in der Datenbank: jede Ecke in der Karte (sonst schlüge die Bedingung `sprache_flaeche_inside_domain` als 500 an), die Form gültig. `vorherGueltig`
 * `false`: Die Fläche war schon ungültig (eine alte Vorlage); dann bleibt sie bearbeitbar.
 */
async function pruefeForm(
    tx: Queryable,
    mapDomainId: string,
    polygone: Punkt[][][],
    vorherGueltig = true,
): Promise<void> {
    const [form] = await tx<{ drin: boolean | null; gueltig: boolean; grund: string }[]>`
        SELECT map_domain_contains(${mapDomainId}, g) AS drin, ST_IsValid(g) AS gueltig, ST_IsValidReason(g) AS grund
          FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(polygone)}), 0) AS g) AS f
    `;
    if (form?.drin !== true) throw ungueltig("Eine Ecke liegt außerhalb der Karte.", { field: "polygons" });
    if (!form.gueltig && vorherGueltig)
        throw ungueltig("Die Form schneidet sich selbst, oder ein Loch liegt über ihrem Rand.", {
            field: "polygons",
            reason: form.grund,
        });
}

export const geometrie = (tx: Sql, polygone: Punkt[][][]): PendingQuery<Row[]> =>
    tx`ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(polygone)}), 0)`;

/** `sprache_flaeche.create`: eine gezeichnete Teilfläche der Redaktion, gegen die Revision der Sprache. */
export async function legeSprachflaecheAn(
    database: Database,
    actor: MapActor,
    spracheId: string,
    body: SpracheFlaecheAnlegenBody,
): Promise<SpracheFlaecheAngelegt> {
    const polygone = formAus(body.polygons);
    const flaecheId = randomUUID();
    const quittung = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache_flaeche.create",
            mapDomainId: SPRACHEN_DOMAENE,
            body: { spracheId, ...body },
        },
        async (tx) => {
            const sprache = await spracheZumSchreiben(tx, spracheId, body.baseRevision);
            await verlangeSprachSperre(tx, actor, spracheId);
            await pruefeForm(tx, SPRACHEN_DOMAENE, polygone);
            const [neu] = await tx<{ revision: number }[]>`
                INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft, quelle_revision)
                VALUES (${flaecheId}::uuid, ${sprache.id}::bigint, ${SPRACHEN_DOMAENE}, ${geometrie(tx, polygone)}, 'redaktion', NULL)
                RETURNING revision::int AS revision
            `;
            return {
                receipt: {
                    affected: [
                        { kind: SPRACHE_ART, id: spracheId, revision: sprache.revision },
                        { kind: SPRACHFLAECHE_ART, id: flaecheId, revision: neu!.revision },
                    ],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `Sprache „${sprache.name}“: neue Teilfläche`,
                entries: [
                    {
                        action: "sprache_flaeche.created",
                        spracheId,
                        spracheFlaecheId: flaecheId,
                        revisionBefore: null,
                        revisionAfter: neu!.revision,
                        changes: {
                            geometry: { after: ringe(polygone) },
                            herkunft: { after: "redaktion" },
                            active: { after: true },
                        },
                    },
                ],
            };
        },
    );
    const angelegt = quittung.affected.find((eines) => eines.kind === SPRACHFLAECHE_ART)?.id ?? flaecheId;
    return { ...quittung, flaecheId: angelegt };
}

/** `sprache_flaeche.reshape`: die neue Form gegen die Revision der Teilfläche; die Fläche wird eine der Redaktion (T-1, Kopf). */
export async function formeSprachflaecheUm(
    database: Database,
    actor: MapActor,
    spracheId: string,
    flaecheId: string,
    body: SpracheFlaecheUmformenBody,
): Promise<OperationReceipt> {
    const neu = formAus(body.polygons);
    const vorab = await leseFlaeche(database, flaecheId, false);
    if (vorab === undefined || vorab.sprache_public_id !== spracheId)
        throw new ApiError(404, "not_found", "Diese Teilfläche gibt es an dieser Sprache nicht.");
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "sprache_flaeche.reshape",
            mapDomainId: vorab.map_domain_id,
            body: { spracheId, flaecheId, ...body },
        },
        async (tx) => {
            const zeile = await flaecheZumSchreiben(tx, spracheId, flaecheId, body.baseRevision);
            if (!zeile.is_active)
                throw ungueltig("Diese Teilfläche ist stillgelegt; erst zurückholen, dann ändern.", { field: "state" });
            await verlangeSprachSperre(tx, actor, spracheId);
            const alt = polygoneVon(zeile.geojson);
            const unveraendert = {
                receipt: {
                    affected: [
                        { kind: SPRACHE_ART, id: spracheId, revision: zeile.sprache_revision },
                        { kind: SPRACHFLAECHE_ART, id: flaecheId, revision: zeile.revision },
                    ],
                    derivedWork: [],
                    warnings: [],
                },
                entries: [],
                ableitung: false as const,
            };
            // Dieselbe Form (auf fünf Nachkommastellen): nichts schreiben, keine Revision, keine Folgen; auch die Herkunft bleibt.
            if (gleich(alt, neu)) return unveraendert;
            await pruefeForm(tx, zeile.map_domain_id, neu, zeile.gueltig);
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE sprache_flaeche
                   SET geom = ${geometrie(tx, neu)}, herkunft = 'redaktion', quelle_revision = NULL
                 WHERE id = ${zeile.id}::bigint AND revision = ${body.baseRevision}
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined)
                throw await mapEditConflict(
                    tx,
                    { kind: "sprache_flaeche", publicId: flaecheId },
                    { revision: zeile.revision, changedAt: zeile.updated_at },
                );
            const aenderungen: Record<string, MapChange> = {
                geometry: { before: ringe(alt), after: ringe(neu) },
            };
            if (zeile.herkunft !== "redaktion")
                aenderungen["herkunft"] = { before: zeile.herkunft, after: "redaktion" };
            if (zeile.quelle_revision !== null)
                aenderungen["quelleRevision"] = { before: zeile.quelle_revision, after: null };
            return {
                receipt: {
                    ...unveraendert.receipt,
                    affected: [
                        { kind: SPRACHE_ART, id: spracheId, revision: zeile.sprache_revision },
                        { kind: SPRACHFLAECHE_ART, id: flaecheId, revision: geschrieben.revision },
                    ],
                },
                summary: `Sprache „${zeile.sprache_name}“: Teilfläche umgeformt`,
                entries: [
                    {
                        action: "sprache_flaeche.reshaped",
                        spracheId,
                        spracheFlaecheId: flaecheId,
                        revisionBefore: zeile.revision,
                        revisionAfter: geschrieben.revision,
                        changes: aenderungen,
                    },
                ],
            };
        },
    );
}

/**
 * „Fläche malen“ und „Fläche radieren“ an einer Teilfläche (WI-0261 Stufe 2, `POST …/flaechen/:flaeche/brush`): EIN Strich, gerechnet wie an der
 * Landschaft (`editor/pinsel-strich.ts`), nichts geschrieben, darum ohne Sperre und ohne Protokoll; „Fertig“ schreibt `sprache_flaeche.reshape`. Die
 * Teilfläche muss zu dieser Sprache gehören und mit ihr aktiv sein (404); ihre Revision prüft erst „Fertig“.
 */
export async function maleSprachStrich(
    database: Database,
    spracheId: string,
    flaecheId: string,
    strich: PinselStrich,
): Promise<PinselErgebnis> {
    const zeile = await leseFlaeche(database, flaecheId, false);
    if (zeile === undefined || zeile.sprache_public_id !== spracheId || !zeile.is_active || !zeile.sprache_aktiv)
        throw new ApiError(404, "not_found", "Diese Teilfläche gibt es an dieser Sprache nicht.");
    return rechneStrich(database, strich);
}

/** `sprache_flaeche.retire` und `.restore`: die Teilfläche stilllegen oder eine von der Redaktion stillgelegte zurückholen. */
export async function setzeSprachflaecheStand(
    database: Database,
    actor: MapActor,
    spracheId: string,
    flaecheId: string,
    body: SpracheStandBody,
    wechsel: "sprache_flaeche.retire" | "sprache_flaeche.restore",
): Promise<OperationReceipt> {
    const stilllegen = wechsel === "sprache_flaeche.retire";
    const vorab = await leseFlaeche(database, flaecheId, false);
    if (vorab === undefined || vorab.sprache_public_id !== spracheId)
        throw new ApiError(404, "not_found", "Diese Teilfläche gibt es an dieser Sprache nicht.");
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: wechsel,
            mapDomainId: vorab.map_domain_id,
            body: { spracheId, flaecheId, ...body },
        },
        async (tx) => {
            const zeile = await flaecheZumSchreiben(tx, spracheId, flaecheId, body.baseRevision);
            if (stilllegen && !zeile.is_active)
                throw ungueltig("Diese Teilfläche ist schon stillgelegt.", { field: "state" });
            if (!stilllegen && zeile.is_active)
                throw ungueltig("Diese Teilfläche ist nicht stillgelegt.", { field: "state" });
            if (!stilllegen && zeile.retired_origin !== "editor")
                throw ungueltig(
                    "Diese Teilfläche hat ein späterer Import der Sprachenkarte ersetzt; sie kommt nicht zurück.",
                    { field: "state" },
                );
            await verlangeSprachSperre(tx, actor, spracheId);
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE sprache_flaeche SET ${flaechenStand(tx, !stilllegen)}
                 WHERE id = ${zeile.id}::bigint
                RETURNING revision::int AS revision
            `;
            return {
                receipt: {
                    affected: [
                        { kind: SPRACHE_ART, id: spracheId, revision: zeile.sprache_revision },
                        { kind: SPRACHFLAECHE_ART, id: flaecheId, revision: geschrieben!.revision },
                    ],
                    derivedWork: [],
                    warnings: [],
                },
                summary: `Sprache „${zeile.sprache_name}“: Teilfläche ${stilllegen ? "stillgelegt" : "zurückgeholt"}`,
                entries: [
                    {
                        action: stilllegen ? "sprache_flaeche.retired" : "sprache_flaeche.restored",
                        spracheId,
                        spracheFlaecheId: flaecheId,
                        revisionBefore: zeile.revision,
                        revisionAfter: geschrieben!.revision,
                        changes: { active: { before: stilllegen, after: !stilllegen } },
                    },
                ],
            };
        },
    );
}
