import type { OperationReceipt, TerritorySammelBody, TerritoryUpdateChanges } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { konflikt, leseGebiete, schreibeDarstellung } from "./territory-display.ts";
import { pruefeFremdeGebietssperre } from "./territory-reshape.ts";
import { pruefeObergebiet, schreibeFelder } from "./territory-update.ts";

/**
 * „Fertig“ der Mehrfachauswahl an den Herrschaftsgebieten (EDIT-0003 T57; Fassung 5, Betreiber 2026-10-19: „perfekt genau das wollen
 * wir“): EINE Operation `territory.sammel` mit den gemeinsamen Feldern für ALLE gewählten Gebiete (Vertrag `TerritorySammelBody`).
 *
 * Je Gebiet dieselben Schreibwege wie einzeln, damit Verlauf und ↺ je Gebiet gleich bleiben: die Felder über `schreibeFelder`
 * (`territory.update`: Art, Status, Obergebiet, ↺ der Wiki-Felder), Farbe und Spanne über `schreibeDarstellung` (`territory.display`).
 * Ein Konflikt oder eine fremde Sperre an einem Gebiet nimmt alles zurück.
 */
const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

export async function changeTerritoriesTogether(
    database: Database,
    actor: MapActor,
    body: TerritorySammelBody,
): Promise<OperationReceipt> {
    const ids = body.territories.map((gebiet) => gebiet.id);
    if (new Set(ids).size !== ids.length)
        throw ungueltig("Ein Gebiet steht zweimal in der Änderung.", { field: "territories" });
    const changes = body.changes ?? {};
    const wiki = body.wiki ?? [];
    const felder = Object.keys(changes).length > 0 || wiki.length > 0;
    const darstellung = body.color !== undefined || body.zoom !== undefined;
    if (!felder && !darstellung) throw ungueltig("Die Änderung trägt nichts zu schreiben.", { field: "changes" });
    const { minZoom, maxZoom } = body.zoom ?? {};
    if (minZoom !== undefined && maxZoom !== undefined && minZoom > maxZoom)
        throw ungueltig("„Zoom von“ liegt über „Zoom bis“.", { field: "zoom" });
    const parent = changes.parent;
    if (parent !== undefined && parent !== "" && ids.includes(parent))
        throw ungueltig("Ein Gebiet kann nicht unter ein gewähltes Gebiet gehängt werden.", { field: "parent" });

    const vorab = await leseGebiete(database, ids);
    const erste = vorab.get(ids[0]!);
    if (erste === undefined || !erste.is_active)
        throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
    if (parent !== undefined && parent !== "")
        for (const id of ids) await pruefeObergebiet(database, id, erste.map_domain_id, parent);
    const feldAenderung: TerritoryUpdateChanges = {
        ...(changes.type === undefined ? {} : { type: changes.type }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(parent === undefined ? {} : { parent }),
        ...(changes.details === undefined ? {} : { details: changes.details }),
    };
    /**
     * ↺ auf den Wiki-Wert nur an den Feldern, die an diesem Gebiet einen eigenen Wert tragen: Die anderen folgen dem Wiki schon, und
     * an einem Gebiet ohne Wiki-Schnappschuss kippte ↺ sonst die ganze Operation (400 `wiki_unbekannt`).
     */
    const aenderungFuer = async (tx: Queryable, id: string): Promise<TerritoryUpdateChanges> => {
        if (wiki.length === 0) return feldAenderung;
        const eigene = await tx<{ field: string }[]>`
            SELECT o.field FROM territory_detail_field_origin o
              JOIN territory_detail d ON d.id = o.territory_detail_id
              JOIN territory t ON t.id = d.territory_id
             WHERE t.public_id = ${id}::uuid AND o.origin = 'override' AND o.field = ANY(${[...wiki]}::text[])
        `;
        if (eigene.length === 0) return feldAenderung;
        return {
            ...feldAenderung,
            details: {
                ...feldAenderung.details,
                ...Object.fromEntries(eigene.map((zeile) => [zeile.field, { revert: "wiki" as const }])),
            },
        };
    };

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "territory.sammel",
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
            // Hält ein anderer eines der Gebiete (EDIT-0003 §4), schreibt diese Operation nicht über seinen Entwurf hinweg.
            await pruefeFremdeGebietssperre(tx, actor, ids);
            const affected = new Map<string, OperationReceipt["affected"][number]>();
            const entries: MapAuditEntry[] = [];
            const geaendert: string[] = [];
            // Neu abgeleitet wird nur, wenn ein Gebiet wirklich umhängt oder eine neue Spanne bekommt.
            let ableiten = false;
            for (const gebiet of body.territories) {
                let revision = gebiet.baseRevision;
                let name = zeilen.get(gebiet.id)!.name;
                let bewegt = false;
                if (felder) {
                    const geschrieben = await schreibeFelder(
                        tx,
                        gebiet.id,
                        revision,
                        await aenderungFuer(tx, gebiet.id),
                    );
                    for (const objekt of geschrieben.affected) affected.set(`${objekt.kind}:${objekt.id}`, objekt);
                    entries.push(...geschrieben.entries);
                    name = geschrieben.name;
                    const neu = geschrieben.affected.find((objekt) => objekt.id === gebiet.id)?.revision;
                    if (neu !== undefined) revision = neu;
                    bewegt ||= geschrieben.entries.length > 0;
                    if (geschrieben.entries.some((eintrag) => "parent" in (eintrag.changes ?? {}))) ableiten = true;
                }
                if (darstellung) {
                    const jetzt = (await leseGebiete(tx, [gebiet.id])).get(gebiet.id)!;
                    const geschrieben = await schreibeDarstellung(
                        tx,
                        {
                            id: gebiet.id,
                            baseRevision: revision,
                            ...(body.zoom === undefined ? {} : { zoom: body.zoom }),
                            ...(body.color === undefined ? {} : { color: body.color }),
                        },
                        jetzt,
                    );
                    if (geschrieben !== undefined) {
                        for (const objekt of geschrieben.affected) affected.set(`${objekt.kind}:${objekt.id}`, objekt);
                        entries.push(...geschrieben.entries);
                        if (geschrieben.spanne) ableiten = true;
                        bewegt = true;
                    }
                }
                if (bewegt) geaendert.push(name);
            }
            if (entries.length === 0)
                throw ungueltig("An keinem der gewählten Gebiete ändert sich etwas.", { field: "territories" });
            const namen =
                geaendert.length > 3
                    ? `${geaendert.slice(0, 3).join(", ")} und ${String(geaendert.length - 3)} weitere`
                    : geaendert.join(", ");
            return {
                receipt: { affected: [...affected.values()], derivedWork: [], warnings: [] },
                summary:
                    body.reverts !== undefined
                        ? `Zurückgenommen: ${namen}`
                        : `${String(geaendert.length)} Herrschaftsgebiete gemeinsam geändert: ${namen}`,
                entries,
                ...(ableiten ? {} : { ableitung: false as const }),
            };
        },
    );
}
