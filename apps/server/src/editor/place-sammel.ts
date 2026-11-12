import {
    type OperationReceipt,
    type PlaceDeleteManyBody,
    type PlaceSammelBody,
    type PlaceSammelOrt,
    type PlaceUpdateBody,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import {
    aendereOrt,
    domainOf,
    lockedPlace,
    pruefeFremdeOrtssperre,
    wikiOrtsgroesse,
    wikiValue,
    type PlaceRow,
} from "./place-edit.ts";
import { loescheOrt } from "./place-removal.ts";
import { pruefeEntfernen } from "./place-removal-regeln.ts";

/**
 * Die Mehrfachauswahl der Ortsliste (WI-0237, EDIT-0003 T57; Vertrag `shared/editor-place-sammel.ts`): ↺ auf Wiki-Werte und „Ganz
 * löschen“ für mehrere Orte, je als EINE Operation mit einem Protokolleintrag je Ort.
 *
 * - Je Ort gelten dieselben Regeln wie einzeln (`place-edit.ts`, `place-removal.ts`): gesperrt gelesen gegen seine Revision (409
 *   `edit_conflict`), beim Löschen `pruefeEntfernen` (Kraftlinie, innerorts-Punkt), die Stätten umkehrbar mit, Wegenden bleiben liegen.
 *   Ein Fehler an EINEM Ort lässt die ganze Operation fallen und nennt ihn beim Namen.
 * - 🔴 Bearbeitet ein anderer einen der Orte gerade (EDIT-0003 §4, `editor_lock`), sperrt die Operation (409 `object_locked`). Einzeln
 *   hält das Fenster die Sperre selbst; hier gibt es kein Fenster je Ort, also prüft der Server.
 * - Die Orte werden in fester Reihenfolge gesperrt (nach Kennung), damit zwei Operationen über dieselben Orte sich nicht verklemmen.
 */

/** Alle gewählten Orte gehören einer Karte; sonst ginge eine Operation über zwei Domänen. */
async function domaeneAller(database: Database, orte: readonly PlaceSammelOrt[]): Promise<string> {
    const domaenen = new Set<string>();
    for (const ort of orte) domaenen.add(await domainOf(database, ort.id));
    if (domaenen.size > 1)
        throw new ApiError(400, "validation_failed", "Die gewählten Orte liegen auf verschiedenen Karten.", {
            field: "orte",
        });
    return [...domaenen][0]!;
}

function einmal(orte: readonly PlaceSammelOrt[]): PlaceSammelOrt[] {
    const ids = new Set(orte.map((ort) => ort.id));
    if (ids.size !== orte.length)
        throw new ApiError(400, "validation_failed", "Ein Ort steht doppelt in der Auswahl.", { field: "orte" });
    return [...orte].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Ein Fehler an einem Ort nennt den Ort: In der Mehrfachauswahl wüsste man sonst nicht, welcher es war. */
async function amOrt<T>(row: PlaceRow, arbeit: () => Promise<T>): Promise<T> {
    try {
        return await arbeit();
    } catch (fehler) {
        if (fehler instanceof ApiError && fehler.statusCode === 400)
            throw new ApiError(400, fehler.code, `${row.name}: ${fehler.message}`, {
                ...fehler.details,
                publicId: row.public_id,
            });
        throw fehler;
    }
}

/**
 * ↺ an EINEM Ort, wie einzeln im Ortseditor (`entwurf.ts`, `aufWiki`, `aufWikiName`, `aufWikiGroesse`): ein Feld nur, wo das Wiki einen
 * Wert kennt; sonst bleibt es, wie es ist.
 */
function wikiAenderung(row: PlaceRow, felder: PlaceSammelBody["wiki"]): PlaceUpdateBody["changes"] {
    const raus: Record<string, { revert: "wiki" }> = {};
    for (const feld of felder) {
        if (feld === "name" && row.s_wiki_name === null) continue;
        if (feld === "subtype" && wikiOrtsgroesse(row) === undefined) continue;
        if (feld !== "name" && feld !== "subtype" && wikiValue(row, feld) === null) continue;
        raus[feld] = { revert: "wiki" };
    }
    return raus as PlaceUpdateBody["changes"];
}

/** `place.sammel`: die genannten Wiki-Felder an allen gewählten Orten auf den Wiki-Wert, als EINE Operation. */
export async function sammelPlaces(
    database: Database,
    actor: MapActor,
    body: PlaceSammelBody,
): Promise<OperationReceipt> {
    const orte = einmal(body.orte);
    const domain = await domaeneAller(database, orte);
    return mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "place.sammel", mapDomainId: domain, body },
        async (tx) => {
            await pruefeFremdeOrtssperre(
                tx,
                actor,
                orte.map((ort) => ort.id),
            );
            const affected: OperationReceipt["affected"] = [];
            const warnings: OperationReceipt["warnings"] = [];
            const entries: MapAuditEntry[] = [];
            for (const ort of orte) {
                const row = await lockedPlace(tx, ort.id, ort.baseRevision);
                const geaendert = await amOrt(row, () => aendereOrt(tx, row, wikiAenderung(row, body.wiki)));
                if (geaendert === undefined) continue;
                affected.push({ kind: "place", id: row.public_id, revision: geaendert.revision });
                for (const befund of geaendert.warnings)
                    if (!warnings.some((w) => w.code === befund.code)) warnings.push(befund);
                entries.push({
                    action: "place.updated",
                    placeId: row.public_id,
                    revisionBefore: row.revision,
                    revisionAfter: geaendert.revision,
                    changes: geaendert.changes,
                });
            }
            if (entries.length === 0)
                throw new ApiError(400, "validation_failed", "Alle gewählten Orte stehen schon auf den Wiki-Werten.");
            if (entries.length < orte.length)
                warnings.push({
                    code: "sammel_teilweise",
                    message: `${String(orte.length - entries.length)} von ${String(orte.length)} Orten standen schon auf den Wiki-Werten.`,
                });
            return {
                receipt: { affected, derivedWork: [], warnings },
                summary: `${String(entries.length)} Orte auf Wiki-Werte`,
                entries,
            };
        },
    );
}

/**
 * `place.delete` für mehrere: alle gewählten Orte „Ganz löschen“, weich, als EINE Operation. 🔴 Der Name bleibt `place.delete`, mit einem
 * Eintrag je Ort: `place.restore` holt so jeden Ort einzeln zurück (↺ unter „Änderungen“).
 */
export async function deletePlaces(
    database: Database,
    actor: MapActor,
    body: PlaceDeleteManyBody,
): Promise<OperationReceipt> {
    const orte = einmal(body.orte);
    const domain = await domaeneAller(database, orte);
    return mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "place.delete", mapDomainId: domain, body },
        async (tx) => {
            await pruefeFremdeOrtssperre(
                tx,
                actor,
                orte.map((ort) => ort.id),
            );
            const affected: OperationReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            let staetten = 0;
            let aufDerKarte = false;
            for (const ort of orte) {
                const row = await lockedPlace(tx, ort.id, ort.baseRevision);
                if (!row.unplaced && !row.is_active)
                    throw new ApiError(400, "validation_failed", `${row.name} ist schon gelöscht.`, {
                        publicId: row.public_id,
                    });
                await amOrt(row, () => pruefeEntfernen(tx, row, "loeschen", undefined));
                const { revision, stillgelegt, entry } = await loescheOrt(tx, row);
                affected.push({ kind: "place", id: row.public_id, revision });
                entries.push(entry);
                staetten += stillgelegt;
                aufDerKarte ||= !row.unplaced;
            }
            return {
                receipt: {
                    affected,
                    derivedWork: aufDerKarte ? [{ kind: "routing", state: "pending" }] : [],
                    warnings: [],
                },
                summary:
                    staetten === 0
                        ? `${String(entries.length)} Orte gelöscht`
                        : `${String(entries.length)} Orte gelöscht, ${String(staetten)} Stätten mit stillgelegt`,
                entries,
            };
        },
    );
}
