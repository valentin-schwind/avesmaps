import type { OperationReceipt, TerritoryUpdateBody, TerritoryUpdateChanges } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { GEBIET_ART, mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { schreibeDetails } from "./territory-details-write.ts";
import {
    formeGebietUmIn,
    pruefeFremdeGebietssperre,
    pruefeGebietsflaechen,
    type GebietsformVorab,
} from "./territory-reshape.ts";

/**
 * „Fertig“ im Gebietseditor (WI-0209 B2; O3, EDIT-0003 T27 (4), T44; EDIT-0005 §6; Vertrag `TerritoryUpdateBody`): `territory.update`,
 * Felder und Form EINES Gebiets als EINE Operation. Der Fensterrumpf (`apps/web/src/fenster/bearbeitung.ts`) schreibt nur hierüber; wie
 * `landscape.update` (`landscape-update.ts`).
 *
 * - **Felder:** Name, Kurzname, Art, Status, Hauptstadt (ein Ort auf der Karte oder ohne Lage; `""` nimmt sie weg). Der Sitz bleibt
 *   nur lesend (EDIT-0005 E1). Gegen `baseRevision` des Gebiets; ein leerer Text leert das Feld.
 * - **Obergebiet** (D1, „Umhängen“; EDIT-0003 F24, Ausnahme der Orchestrierung 2026-10-18): ein Feld wie die anderen, damit „Fertig“
 *   EINE Operation bleibt. Nie das Gebiet selbst oder eines seiner Untergebiete (400 mit Satz; die Datenbank hält es zusätzlich,
 *   `territory_no_cycle`, 0145). Umgehängt heißt Herkunft `override` (`parent_origin`, 0159). Im Fachprotokoll steht `parent` mit
 *   der Kennung vorher und nachher; den Verlauf (D5) holt es zurück. Gesperrt wird nur das umgehängte Gebiet (Frage 5).
 * - **Revision je Objekt** (T44 (4)): Das Gebiet zählt nur seine Felder; eine Operation, die nur die Form ändert, berührt die Zeile
 *   `territory` nicht. Die Form mit `formeGebietUmIn` (`territory-reshape.ts`), je Fläche gegen ihre Revision.
 * - Hält ein anderer das Gebiet (oder einen mitgezogenen Nachbarn), 409 `object_locked`; ein Konflikt nimmt alles zurück (409
 *   `edit_conflict`); läuft der Zug, 503 (`mapOperation`). Nichts zu schreiben ist 400.
 * - **Die 17 Detailfelder** (G6, Wiki-Feld WI-0225) gehen mit `changes.details` als `{ value }` oder `{ revert: "wiki" }` in derselben
 *   Transaktion (`territory-details-write.ts`); sie zählen zu den Feldern des Gebiets (eine Revision des Gebiets).
 * - **Danach** reiht die Schreibnaht `territory_derive` ein; ob er rechnet, entscheidet der Inhalts-Hash (Name und Hauptstadt stehen in
 *   Formen und Hauptstadtbändern, EDIT-0005 §5 Punkt 5).
 */

interface GebietZeile {
    id: string;
    public_id: string;
    name: string;
    short_name: string | null;
    territory_type: string | null;
    status_text: string | null;
    capital: string | null;
    parent: string | null;
    map_domain_id: string;
    wiki_key: string | null;
    revision: number;
    updated_at: Date;
}

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

async function leseGebiet(sql: Queryable, territoryId: string, sperren = false): Promise<GebietZeile | undefined> {
    const [zeile] = sperren
        ? await sql<GebietZeile[]>`
            SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.short_name, t.territory_type, t.status_text,
                   t.capital_place_public_id::text AS capital, p.public_id::text AS parent, t.map_domain_id,
                   t.wiki_key, t.revision::int AS revision, t.updated_at
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
             WHERE t.public_id = ${territoryId}::uuid AND t.is_active FOR NO KEY UPDATE OF t`
        : await sql<GebietZeile[]>`
            SELECT t.id::text AS id, t.public_id::text AS public_id, t.name, t.short_name, t.territory_type, t.status_text,
                   t.capital_place_public_id::text AS capital, p.public_id::text AS parent, t.map_domain_id,
                   t.wiki_key, t.revision::int AS revision, t.updated_at
              FROM territory t LEFT JOIN territory p ON p.id = t.parent_id
             WHERE t.public_id = ${territoryId}::uuid AND t.is_active`;
    return zeile;
}

/**
 * Darf `territoryId` unter `parent`? Nur ein aktives Gebiet derselben Karte, nie das Gebiet selbst oder eines seiner Untergebiete
 * (die Kette von `parent` aufwärts trifft `territoryId` nicht). Wirft 400 mit Satz.
 */
export async function pruefeObergebiet(
    sql: Queryable,
    territoryId: string,
    mapDomainId: string,
    parent: string,
): Promise<void> {
    if (parent === territoryId)
        throw ungueltig("Ein Gebiet kann nicht unter sich selbst hängen.", { field: "parent", reason: "kreis" });
    const [ziel] = await sql<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM territory WHERE public_id = ${parent}::uuid AND is_active
    `;
    if (ziel === undefined) throw ungueltig("Dieses Obergebiet gibt es nicht.", { field: "parent" });
    if (ziel.map_domain_id !== mapDomainId)
        throw ungueltig("Das Obergebiet liegt auf einer anderen Karte.", { field: "parent" });
    const [kreis] = await sql<{ kreis: boolean }[]>`
        WITH RECURSIVE kette AS (
            SELECT id, parent_id, public_id, 1 AS tiefe FROM territory WHERE public_id = ${parent}::uuid
            UNION ALL
            SELECT t.id, t.parent_id, t.public_id, k.tiefe + 1
              FROM territory t JOIN kette k ON t.id = k.parent_id
             WHERE k.tiefe < 64
        )
        SELECT EXISTS (SELECT 1 FROM kette WHERE public_id = ${territoryId}::uuid) AS kreis
    `;
    if (kreis?.kreis === true)
        throw ungueltig("Ein Gebiet kann nicht unter eines seiner Untergebiete.", { field: "parent", reason: "kreis" });
}

/** Die Felder, wie sie im Fachprotokoll stehen (`MAP_AUDIT_FIELDS.territory`); ein leeres Feld steht als `null`. */
function werte(zeile: GebietZeile): Record<string, string | null> {
    return {
        name: zeile.name,
        shortName: zeile.short_name,
        type: zeile.territory_type,
        status: zeile.status_text,
        capital: zeile.capital,
        parent: zeile.parent,
    };
}

/** Die neuen Werte aus den Änderungen: Texte getrimmt, leer heißt NULL; nur was die Änderung nennt. */
function neueWerte(alt: GebietZeile, changes: TerritoryUpdateChanges): Record<string, string | null> {
    const text = (wert: string | undefined, vorher: string | null): string | null =>
        wert === undefined ? vorher : wert.trim() === "" ? null : wert.trim();
    return {
        name: changes.name === undefined ? alt.name : changes.name.trim(),
        shortName: text(changes.shortName, alt.short_name),
        type: text(changes.type, alt.territory_type),
        status: text(changes.status, alt.status_text),
        capital: changes.capital === undefined ? alt.capital : changes.capital === "" ? null : changes.capital,
        parent: changes.parent === undefined ? alt.parent : changes.parent === "" ? null : changes.parent,
    };
}

/** Die Felder EINES Gebiets in einer laufenden Operation (auch `territory.sammel`): nur was sich ändert, gegen `baseRevision`. */
export async function schreibeFelder(
    tx: Sql,
    territoryId: string,
    baseRevision: number,
    changes: TerritoryUpdateChanges,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[]; name: string }> {
    const jetzt = await leseGebiet(tx, territoryId, true);
    if (jetzt === undefined) throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
    if (jetzt.revision !== baseRevision)
        throw await mapEditConflict(
            tx,
            { kind: "territory", publicId: territoryId },
            { revision: jetzt.revision, changedAt: jetzt.updated_at },
        );
    const vorher = werte(jetzt);
    const nachher = neueWerte(jetzt, changes);
    const geaendert = Object.keys(nachher).filter((feld) => nachher[feld] !== vorher[feld]);
    const detailWechsel =
        changes.details === undefined ? {} : await schreibeDetails(tx, jetzt.id, jetzt.wiki_key, changes.details);
    if (geaendert.length === 0 && Object.keys(detailWechsel).length === 0)
        return { affected: [], entries: [], name: jetzt.name };
    // Umhängen: in der Transaktion noch einmal geprüft (ein anderer kann das Ziel inzwischen unter dieses Gebiet gehängt haben).
    const umgehaengt = geaendert.includes("parent");
    if (umgehaengt && nachher["parent"] !== null)
        await pruefeObergebiet(tx, territoryId, jetzt.map_domain_id, nachher["parent"]!);
    // Nur Detailfelder: Die Zeile des Gebiets zählt trotzdem (sie sind seine Felder, T44 (4)); `revision = revision` zählt der Trigger.
    const [geschrieben] =
        geaendert.length === 0
            ? await tx<{ revision: number }[]>`
            UPDATE territory SET revision = revision WHERE id = ${jetzt.id}::bigint AND revision = ${baseRevision}
            RETURNING revision::int AS revision
        `
            : await tx<{ revision: number }[]>`
        UPDATE territory
           SET name = ${nachher["name"]!}, short_name = ${nachher["shortName"] ?? null}, territory_type = ${nachher["type"] ?? null},
               status_text = ${nachher["status"] ?? null}, capital_place_public_id = ${nachher["capital"] ?? null}::uuid,
               parent_id = (SELECT id FROM territory WHERE public_id = ${nachher["parent"] ?? null}::uuid),
               parent_origin = CASE WHEN ${umgehaengt} THEN 'override' ELSE parent_origin END
         WHERE id = ${jetzt.id}::bigint AND revision = ${baseRevision}
        RETURNING revision::int AS revision
    `;
    return {
        affected: [{ kind: GEBIET_ART, id: territoryId, revision: geschrieben!.revision }],
        entries: [
            {
                action: "territory.updated",
                territoryId,
                revisionBefore: jetzt.revision,
                revisionAfter: geschrieben!.revision,
                changes: {
                    ...Object.fromEntries(
                        geaendert.map((feld) => [feld, { before: vorher[feld], after: nachher[feld] }]),
                    ),
                    ...detailWechsel,
                },
            },
        ],
        name: nachher["name"]!,
    };
}

/** `territory.update` (WI-0209 B2): Felder und Form eines Gebiets in EINER Operation. */
export async function updateTerritory(
    database: Database,
    actor: MapActor,
    territoryId: string,
    body: TerritoryUpdateBody,
): Promise<OperationReceipt> {
    const changes = body.changes ?? {};
    const felder = Object.keys(changes).length > 0;
    const areas = body.areas ?? [];
    if (!felder && areas.length === 0)
        throw ungueltig("Die Änderung trägt nichts zu schreiben.", { field: "changes", reason: "nichts_zu_schreiben" });
    if (felder && body.baseRevision === undefined)
        throw ungueltig("Felder des Gebiets brauchen seine Revision.", { field: "baseRevision" });
    if (changes.name !== undefined && changes.name.trim() === "")
        throw ungueltig("Ein Herrschaftsgebiet braucht einen Namen.", { field: "name" });
    const gebiet = await leseGebiet(database, territoryId);
    if (gebiet === undefined) throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
    if (changes.parent !== undefined && changes.parent !== "" && changes.parent !== gebiet.parent)
        await pruefeObergebiet(database, territoryId, gebiet.map_domain_id, changes.parent);
    if (changes.capital !== undefined && changes.capital !== "") {
        const [ort] = await database<{ da: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM place WHERE public_id = ${changes.capital}::uuid AND is_active)
                OR EXISTS (SELECT 1 FROM place_unplaced WHERE public_id = ${changes.capital}::uuid AND is_active) AS da
        `;
        if (ort?.da !== true) throw ungueltig("Diesen Ort gibt es nicht.", { field: "capital" });
    }
    const form: GebietsformVorab | undefined =
        areas.length > 0 ? await pruefeGebietsflaechen(database, territoryId, areas) : undefined;

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "territory.update",
            mapDomainId: gebiet.map_domain_id,
            body: { territoryId, ...body },
            ...(body.reverts !== undefined ? { source: "restore" as const } : {}),
        },
        async (tx) => {
            await pruefeFremdeGebietssperre(tx, actor, [territoryId]);
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            const teile: string[] = [];
            let name = gebiet.name;
            if (felder) {
                const geschrieben = await schreibeFelder(tx, territoryId, body.baseRevision!, changes);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                name = geschrieben.name;
                if (geschrieben.entries.length > 0) teile.push("Felder");
            }
            let nachbarn = 0;
            if (form !== undefined) {
                const geschrieben = await formeGebietUmIn(tx, actor, territoryId, areas, form);
                affected.push(...geschrieben.affected);
                entries.push(...geschrieben.entries);
                nachbarn = geschrieben.nachbarn;
                if (geschrieben.entries.length > 0) teile.push("Grenzen");
            }
            const mit = nachbarn > 0 ? `, ${String(nachbarn)} Nachbarflächen mitgezogen` : "";
            return {
                receipt: { affected: dedupe(affected), derivedWork: [], warnings: [] },
                summary:
                    body.reverts !== undefined
                        ? `${name}: Änderung zurückgenommen`
                        : teile.length === 0
                          ? `${name}: nichts geändert`
                          : `${name}: ${teile.join(", ")} geändert${mit}`,
                entries,
            };
        },
    );
}

/** Jedes Objekt einmal, die geschriebene Revision des Gebiets vor der der Form. */
function dedupe(affected: OperationReceipt["affected"]): OperationReceipt["affected"] {
    const gesehen = new Set<string>();
    return affected.filter((x) => {
        const schluessel = `${x.kind}|${x.id}`;
        if (gesehen.has(schluessel)) return false;
        gesehen.add(schluessel);
        return true;
    });
}
