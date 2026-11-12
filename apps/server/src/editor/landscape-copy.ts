import { randomUUID } from "node:crypto";
import { landscapeTypeFits, type LandscapeCopyBody, type LandscapeCopyReceipt } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { leseZeilen, nimmTeilflaecheWeg, pruefeKraftlinien } from "./landscape-boolean.ts";
import { legeLandschaftAn, legeTeilflaecheAn } from "./landscape-create.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { GELAENDE_VERALTET, speistGelaende } from "./landscape-update.ts";
import { LANDSCHAFT_ART, mapOperation, TEILFLAECHE_ART, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";
import { polygoneVon } from "./ring-form.ts";

/**
 * „Kopieren …“ (Werkzeug 8, Betreiber 2026-10-19 wörtlich: „wie legacy B mit haken“; Vertrag `LandscapeCopyBody` in
 * `packages/shared/src/landscape-editor.ts`). Wie Legacy (Mirror 5ff58118, `map-features-ecosystem-transfer.js`):
 *
 * - **Eine KOPIE, nie eine Verknüpfung:** eine neue Teilfläche mit eigener Kennung und eigener Revision; wer später eine Ecke der Kopie
 *   zieht, zieht nicht die Quelle.
 * - **Ziel:** eine bestehende Landschaft der Zielebene oder eine neue mit Name und Art (die Art aus der Zielebene; Legacy schickte die Art
 *   der Quelle nie mit, weil `wald` in der Topographie 400 wäre). Der Wiki-Artikel reist nur, solange der Name der der Quelle ist
 *   (`ecosystemTransferCarriesWiki`). Die neue Landschaft liegt ganz vorn in ihrer Ebene wie „Neue Fläche“.
 * - **„Originalfläche löschen“** macht daraus ein Umziehen: Die Quelle geht von der Karte, und war sie die letzte ihrer Landschaft, die
 *   Landschaft samt Beschriftungen (wie Werkzeug 1, vorher dieselbe Prüfung der Kraftlinien). Legacy schrieb dreimal nacheinander und
 *   musste ein halbes Umziehen melden; hier ist es EINE Operation `landscape.copy`, ganz oder gar nicht.
 * - Gegen die Revision der Teilfläche und die Sperren beider Landschaften; ↺ im Verlauf der Ziellandschaft (`restoreBoolean`, Anker
 *   `area.copied`): Die Kopie und eine neue Landschaft gehen wieder, die Quelle kommt zurück.
 */

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

interface Ziel {
    id: string;
    public_id: string;
    name: string;
    region_layer: string;
    region_type: string | null;
    revision: number;
}

export async function copyLandscape(
    database: Database,
    actor: MapActor,
    regionId: string,
    body: LandscapeCopyBody,
): Promise<LandscapeCopyReceipt> {
    const vorab = (await leseZeilen(database, [body.areaId], false)).get(body.areaId);
    if (vorab === undefined || vorab.region !== regionId)
        throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
    const name = body.name?.trim() ?? "";
    if (body.targetId === undefined && name === "")
        throw ungueltig("Bitte einen Namen für die neue Landschaft eingeben.", { field: "name" });
    if (body.targetId === undefined && body.type !== undefined && !landscapeTypeFits(body.layer, body.type))
        throw ungueltig("Diese Art gehört nicht zur Zielebene.", { field: "type", layer: body.layer, type: body.type });
    const neueId = randomUUID();
    const kopieId = randomUUID();
    let ergebnis: { publicId: string; name: string } | undefined;

    const receipt = await mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "landscape.copy",
            mapDomainId: vorab.map_domain_id,
            body: { regionId, ...body },
        },
        async (tx) => {
            const domain = vorab.map_domain_id;
            const quelle = (await leseZeilen(tx, [body.areaId], true)).get(body.areaId);
            if (quelle === undefined || quelle.region !== regionId)
                throw new ApiError(404, "not_found", "Diese Landschaft hat keine solche Teilfläche.");
            if (quelle.revision !== body.baseRevision)
                throw await mapEditConflict(
                    tx,
                    { kind: "area", publicId: quelle.public_id },
                    { revision: quelle.revision, changedAt: quelle.updated_at },
                );
            let ziel: Ziel | undefined;
            if (body.targetId !== undefined) {
                [ziel] = await tx<Ziel[]>`
                    SELECT id::text, public_id::text, name, region_layer, region_type, revision::int AS revision
                      FROM region WHERE public_id = ${body.targetId}::uuid AND map_domain_id = ${domain} AND is_active
                       FOR NO KEY UPDATE
                `;
                if (ziel === undefined) throw new ApiError(404, "not_found", "Die Ziellandschaft gibt es nicht mehr.");
                if (ziel.region_layer !== body.layer)
                    throw ungueltig("Die Ziellandschaft liegt nicht in der Zielebene.", { field: "targetId" });
            }
            await pruefeFremdeSperre(tx, actor, [...new Set([quelle.region, ...(ziel ? [ziel.public_id] : [])])]);
            const [zahl] = await tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM region_area WHERE region_id = ${quelle.region_id}::bigint AND is_active
            `;
            const mitLandschaft = body.deleteSource && zahl!.n === 1 && ziel?.public_id !== quelle.region;
            if (mitLandschaft) await pruefeKraftlinien(tx, quelle);

            const polygone = polygoneVon(quelle.geojson);
            const affected: LandscapeCopyReceipt["affected"] = [];
            const entries: MapAuditEntry[] = [];
            let zielName: string;
            let zielArt: string | null;
            if (ziel === undefined) {
                const [wiki] = await tx<{ wiki_url: string | null; wiki_region_key: string | null }[]>`
                    SELECT wiki_url, wiki_region_key FROM region WHERE id = ${quelle.region_id}::bigint
                `;
                const neu = await legeLandschaftAn(tx, {
                    domain,
                    publicId: neueId,
                    areaId: kopieId,
                    layer: body.layer,
                    type: body.type ?? null,
                    polygone,
                    name,
                    wiki:
                        name === quelle.region_name.trim() && wiki !== undefined
                            ? { url: wiki.wiki_url, key: wiki.wiki_region_key }
                            : undefined,
                });
                affected.push(...neu.affected);
                entries.push(...neu.entries);
                zielName = neu.name;
                zielArt = body.type ?? null;
                ergebnis = { publicId: neueId, name: neu.name };
            } else {
                const teil = await legeTeilflaecheAn(tx, {
                    domain,
                    region: { id: ziel.id, publicId: ziel.public_id },
                    areaId: kopieId,
                    polygone,
                });
                affected.push({ kind: LANDSCHAFT_ART, id: ziel.public_id, revision: ziel.revision }, teil.affected);
                entries.push(teil.entry);
                zielName = ziel.name;
                zielArt = ziel.region_type;
                ergebnis = { publicId: ziel.public_id, name: ziel.name };
            }
            // Der Anker des ↺ (`restoreBoolean`): die Kopie, in der Ziellandschaft.
            const kopie = entries.findIndex((e) => e.action === "area.created" && e.areaId === kopieId);
            entries[kopie] = { ...entries[kopie]!, action: "area.copied" };
            if (body.deleteSource) await nimmTeilflaecheWeg(tx, quelle, mitLandschaft, affected, entries);
            const gelaende =
                speistGelaende(body.layer, zielArt) ||
                (body.deleteSource && speistGelaende(quelle.region_layer, quelle.region_type));
            return {
                receipt: { affected, derivedWork: [], warnings: gelaende ? [GELAENDE_VERALTET] : [] },
                summary: `${quelle.region_name}: ${body.deleteSource ? "umgezogen" : "kopiert"} nach ${zielName} (${body.layer})`,
                entries,
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung (`runOperation`): Ziel und Kopie stehen dort vorn.
    if (ergebnis === undefined) {
        const zielId = receipt.affected.find((x) => x.kind === LANDSCHAFT_ART)?.id;
        const [vorhanden] = zielId
            ? await database<{ name: string }[]>`SELECT name FROM region WHERE public_id = ${zielId}::uuid`
            : [];
        ergebnis = { publicId: zielId ?? "", name: vorhanden?.name ?? "" };
    }
    const kopie = receipt.affected.find((x) => x.kind === TEILFLAECHE_ART)?.id ?? kopieId;
    return { ...receipt, publicId: ergebnis.publicId, name: ergebnis.name, areaId: kopie };
}
