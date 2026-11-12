import type { OperationReceipt, TerritoryDisplayBody } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import {
    GEBIET_ART,
    GEBIETSFLAECHE_ART,
    mapOperation,
    type MapActor,
    type MapAuditEntry,
    type MapChange,
} from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { pruefeFremdeGebietssperre } from "./territory-reshape.ts";

/**
 * „Fertig“ in „Farben und Zoombänder“ (WI-0209 D2, D4; EDIT-0005 §6, §7 D2 und D4, H2; Vertrag `TerritoryDisplayBody`): EINE Operation
 * `territory.display` mit Zoomspanne und Farbe aller Gebiete, die der Entwurf im Reiter „Hierarchie“ geändert hat, je gegen ihre Revision.
 *
 * - **Die Flächen eines Gebiets mit neuer Spanne verlieren ihr eigenes Band**, wie in Legacy (`avesmapsPoliticalUpdateTerritoryZoomRange`,
 *   `api/_internal/political/territories-write.php`, Mirror 5ff58118); danach gilt an ihnen die Spanne des Gebiets. Nur aktive Flächen,
 *   je eine Zeile `territory_area.bands_cleared` im Fachprotokoll.
 * - **Die Farbe** ist eine feste Farbe je Gebiet (H2); Mitziehen und „Farbhierarchie erstellen“ rechnet der Editor
 *   (`apps/web/src/gebietseditor/farben.ts`), hier steht nur das Ergebnis. Sie geht in kein abgeleitetes Ergebnis ein (die Kacheln lesen
 *   sie live, `0059_territory_claim_hatch_bands.sql`): Ändert die Operation nur Farben, reiht sie keinen `territory_derive` ein.
 * - **Sperre nur der geänderten Gebiete** (T23 Frage 6): Hält ein anderer eines davon (EDIT-0003 §4), 409 `object_locked`. Ein Konflikt
 *   nimmt alles zurück (409 `edit_conflict`, eine Transaktion). Läuft der Zug, 503 (`mapOperation`, `EDITOR_TABELLEN`).
 * - Lücken und Überlappungen sind Befunde, nie eine Sperre (EDIT-0005 §2); abgewiesen wird nur, was die Datenbank nicht trägt.
 * - **Danach** meldet die Schreibnaht `map.changed` (die Kachelrevision) und, mit einer Spanne, den Auftrag `territory_derive` (B3).
 *   Der Editor leitet nie selbst ab.
 */

export interface GebietZeile {
    public_id: string;
    name: string;
    map_domain_id: string;
    revision: number;
    is_active: boolean;
    min_zoom: number | null;
    max_zoom: number | null;
    color: string;
    updated_at: Date;
}

export async function leseGebiete(sql: Queryable, ids: readonly string[]): Promise<Map<string, GebietZeile>> {
    const rows = await sql<GebietZeile[]>`
        SELECT public_id::text AS public_id, name, map_domain_id, revision::int AS revision, is_active, min_zoom, max_zoom, color,
               updated_at
          FROM territory
         WHERE public_id = ANY(${ids as string[]}::uuid[])
    `;
    return new Map(rows.map((row) => [row.public_id, row]));
}

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

export async function konflikt(tx: Sql, zeile: GebietZeile): Promise<ApiError> {
    const [jetzt] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM territory WHERE public_id = ${zeile.public_id}::uuid
    `;
    return mapEditConflict(
        tx,
        { kind: "territory", publicId: zeile.public_id },
        { revision: jetzt?.revision ?? zeile.revision, changedAt: jetzt?.updated_at ?? zeile.updated_at },
    );
}

/** Die geänderten Grenzen einer Spanne fürs Protokoll; eine offene Grenze steht als `null`. */
function spannenAenderung(
    vorher: { min: number | null; max: number | null },
    nachher: { min: number | null; max: number | null },
): Record<string, MapChange> {
    const aus: Record<string, MapChange> = {};
    if (vorher.min !== nachher.min) aus["minZoom"] = { before: vorher.min, after: nachher.min };
    if (vorher.max !== nachher.max) aus["maxZoom"] = { before: vorher.max, after: nachher.max };
    return aus;
}

const namenSatz = (namen: readonly string[]): string =>
    namen.length <= 3 ? namen.join(", ") : `${namen.slice(0, 3).join(", ")} und ${String(namen.length - 3)} weitere`;

/** `territory.display` (WI-0209 D2, D4): Zoomspannen und Farben mehrerer Gebiete in EINER Operation. */
export async function changeTerritoryDisplay(
    database: Database,
    actor: MapActor,
    body: TerritoryDisplayBody,
): Promise<OperationReceipt> {
    const ids = body.territories.map((gebiet) => gebiet.id);
    if (new Set(ids).size !== ids.length)
        throw ungueltig("Ein Gebiet steht zweimal in der Änderung.", { field: "territories" });
    for (const gebiet of body.territories) {
        if (gebiet.zoom === undefined && gebiet.color === undefined)
            throw ungueltig("Für ein Gebiet steht weder Zoomspanne noch Farbe in der Änderung.", {
                territoryId: gebiet.id,
            });
        const { minZoom, maxZoom } = gebiet.zoom ?? {};
        if (minZoom !== undefined && maxZoom !== undefined && minZoom > maxZoom)
            throw ungueltig("„Zoom von“ liegt über „Zoom bis“.", { territoryId: gebiet.id });
    }
    const vorab = await leseGebiete(database, ids);
    const erste = vorab.get(ids[0]!);
    if (erste === undefined || !erste.is_active)
        throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "territory.display",
            mapDomainId: erste.map_domain_id,
            body,
            ...(body.reverts !== undefined ? { source: "restore" as const } : {}),
        },
        async (tx) => {
            const zeilen = await leseGebiete(tx, ids);
            for (const gebiet of body.territories) {
                const zeile = zeilen.get(gebiet.id);
                if (zeile === undefined || !zeile.is_active)
                    throw ungueltig("Ein Gebiet der Änderung ist nicht mehr da.", { territoryId: gebiet.id });
                if (zeile.map_domain_id !== erste.map_domain_id)
                    throw ungueltig("Ein Gebiet der Änderung liegt auf einer anderen Karte.", {
                        territoryId: gebiet.id,
                    });
                if (zeile.revision !== gebiet.baseRevision) throw await konflikt(tx, zeile);
            }

            // Hält ein anderer eines der geänderten Gebiete (EDIT-0003 §4), schreibt diese Operation nicht über seinen Entwurf hinweg.
            await pruefeFremdeGebietssperre(tx, actor, ids);

            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            const namen: string[] = [];
            let spanneGeaendert = false;
            for (const gebiet of body.territories) {
                const geschrieben = await schreibeDarstellung(tx, gebiet, zeilen.get(gebiet.id)!);
                if (geschrieben === undefined) continue;
                namen.push(geschrieben.name);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                if (geschrieben.spanne) spanneGeaendert = true;
            }
            if (entries.length === 0)
                throw ungueltig("Weder Zoomspanne noch Farbe ändert sich.", { field: "territories" });
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                summary:
                    body.reverts !== undefined
                        ? `Farben und Zoombänder zurückgenommen: ${namenSatz(namen)}`
                        : `Farben und Zoombänder geändert: ${namenSatz(namen)}`,
                entries,
                ...(spanneGeaendert ? {} : { ableitung: false as const }),
            };
        },
    );
}

/**
 * Spanne und Farbe EINES Gebiets in einer laufenden Operation (auch `territory.sammel`), gegen `gebiet.baseRevision`; `zeile` ist sein
 * gelesener Stand. Ändert sich nichts, `undefined`. Bekommt es eine neue Spanne, verlieren seine Flächen ihr eigenes Band (Legacy).
 */
export async function schreibeDarstellung(
    tx: Sql,
    gebiet: { id: string; baseRevision: number; zoom?: { minZoom?: number; maxZoom?: number }; color?: string },
    zeile: GebietZeile,
): Promise<
    { name: string; affected: OperationReceipt["affected"]; entries: MapAuditEntry[]; spanne: boolean } | undefined
> {
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    const vorher = { min: zeile.min_zoom, max: zeile.max_zoom };
    const nachher =
        gebiet.zoom === undefined ? vorher : { min: gebiet.zoom.minZoom ?? null, max: gebiet.zoom.maxZoom ?? null };
    const farbe = gebiet.color ?? zeile.color;
    const changes: Record<string, MapChange> = spannenAenderung(vorher, nachher);
    if (farbe !== zeile.color) changes["color"] = { before: zeile.color, after: farbe };
    if (Object.keys(changes).length === 0) return undefined;
    const neueSpanne = "minZoom" in changes || "maxZoom" in changes;
    const [geschrieben] = await tx<{ id: string; revision: number }[]>`
                    UPDATE territory SET min_zoom = ${nachher.min}, max_zoom = ${nachher.max}, color = ${farbe}
                     WHERE public_id = ${gebiet.id}::uuid AND revision = ${gebiet.baseRevision}
                    RETURNING id::text AS id, revision::int AS revision
                `;
    if (geschrieben === undefined) throw await konflikt(tx, zeile);
    affected.push({ kind: GEBIET_ART, id: gebiet.id, revision: geschrieben.revision });
    entries.push({
        action: "territory.display_changed",
        territoryId: gebiet.id,
        revisionBefore: zeile.revision,
        revisionAfter: geschrieben.revision,
        changes,
    });
    if (!neueSpanne) return { name: zeile.name, affected, entries, spanne: false };

    // Legacy: Die Flächen verlieren ihr eigenes Band, danach gilt die Spanne des Gebiets.
    const geleert = await tx<
        {
            public_id: string;
            min_zoom: number | null;
            max_zoom: number | null;
            vorher: number;
            nachher: number;
        }[]
    >`
                    WITH alt AS (
                        SELECT id, public_id, min_zoom, max_zoom, revision
                          FROM territory_area
                         WHERE territory_id = ${geschrieben.id}::bigint AND is_active
                           AND (min_zoom IS NOT NULL OR max_zoom IS NOT NULL)
                    )
                    UPDATE territory_area a SET min_zoom = NULL, max_zoom = NULL
                      FROM alt
                     WHERE a.id = alt.id
                    RETURNING alt.public_id::text AS public_id, alt.min_zoom, alt.max_zoom, alt.revision::int AS vorher,
                              a.revision::int AS nachher
                `;
    for (const flaeche of geleert) {
        affected.push({ kind: GEBIETSFLAECHE_ART, id: flaeche.public_id, revision: flaeche.nachher });
        entries.push({
            action: "territory_area.bands_cleared",
            territoryId: gebiet.id,
            territoryAreaId: flaeche.public_id,
            revisionBefore: flaeche.vorher,
            revisionAfter: flaeche.nachher,
            changes: spannenAenderung({ min: flaeche.min_zoom, max: flaeche.max_zoom }, { min: null, max: null }),
        });
    }
    return { name: zeile.name, affected, entries, spanne: true };
}
