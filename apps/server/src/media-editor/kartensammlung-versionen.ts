import { AVENTURIA, type MamKarteVersionBody, type OperationReceipt } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { notBound } from "./binding-operations.ts";
import {
    aktiveVersionen,
    hebeRevision,
    sperreKarte,
    versionsBezeichnung,
    zaehleVersionenDurch,
    type Karte,
} from "./kartensammlung-bilder.ts";
import { mediaOperation, type MediaActor } from "./operation-store.ts";

/**
 * Bezeichnung und Reihenfolge der Versionen einer Karte (WI-0287 Stufe 2, Operation `citymap.version`; Vali: „"Die Karte" darf mehrere einträge haben“). Eine Version ist eine
 * aktive Bindung `map_full` des Eintrags (Migration 0321). `label` setzt die Bezeichnung („Spielerversion“; leer nimmt sie weg), `first` stellt die Version an den Anfang: Sie ist
 * dann die, die Besucher zuerst sehen und aus der „Vorschau erzeugen“ rechnet. Anhängen und Lösen sind `citymap.image` und `citymap.image_remove` (`kartensammlung-bilder.ts`).
 *
 * 🔴 Gleicher Weg wie die anderen Operationen am Eintrag: Sperre der Kartendomäne (503), gesehener Stand (`baseRevision`, 409), ein stillgelegter Eintrag nimmt nichts an (409
 * `citymap_retired`), Revision plus eins und eine Zeile `citymap.updated` mit `details.fields = ["images"]`, die die Karte gegen den Legacy-Zug hält. Eine Handlung, die nichts
 * ändert (dieselbe Bezeichnung, schon die erste), schreibt weder Revision noch Protokoll. Hängt das Werk nicht als Karte hier, 409 `media_not_bound`. Kein Abgleich: Bezeichnung und
 * Folge ändern an keinem Werk, was öffentlich ist; Besucher lesen sie frisch (`resolveCitymapVersions`).
 */

/** Die eine Handlung; `false`, wenn sie nichts ändert. */
async function wendeAn(tx: Queryable, karte: Karte, body: MamKarteVersionBody): Promise<boolean> {
    const versionen = await aktiveVersionen(tx, karte.id);
    const version = versionen.find((eintrag) => eintrag.assetPublicId === body.assetId);
    if (version === undefined) throw notBound();
    switch (body.op) {
        case "label": {
            if (body.label === undefined) {
                throw new ApiError(400, "validation_failed", "Die Bezeichnung fehlt.", {
                    issues: [{ path: "/label", rule: "required" }],
                });
            }
            const neu = versionsBezeichnung(body.label);
            if (neu === version.label) return false;
            await tx`UPDATE citymap_media SET version_label = ${neu}, updated_at = now() WHERE id = ${version.id}::bigint`;
            return true;
        }
        case "first": {
            if (versionen[0]?.id === version.id) return false;
            await zaehleVersionenDurch(tx, [
                version.id,
                ...versionen.filter((eintrag) => eintrag.id !== version.id).map((eintrag) => eintrag.id),
            ]);
            return true;
        }
    }
}

export function aendereKartenversion(
    database: Database,
    actor: MediaActor,
    publicId: string,
    body: MamKarteVersionBody,
    /** Die Kartendomäne der Sperre; nur Tests nennen eine eigene. */
    optionen: { mapDomainId?: string } = {},
): Promise<OperationReceipt> {
    const domaene = optionen.mapDomainId ?? AVENTURIA.mapDomain;
    return mediaOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "citymap.version",
            body: {
                citymapId: publicId,
                baseRevision: body.baseRevision,
                assetId: body.assetId,
                op: body.op,
                ...(body.label === undefined ? {} : { label: body.label }),
            },
        },
        async (tx) => {
            const karte = await sperreKarte(tx, publicId, body.baseRevision, domaene);
            if (!(await wendeAn(tx, karte, body))) {
                return {
                    receipt: {
                        affected: [{ kind: "citymap", id: publicId, revision: karte.revision }],
                        derivedWork: [],
                        warnings: [],
                    },
                    entries: [],
                };
            }
            const revision = await hebeRevision(tx, karte);
            return {
                receipt: { affected: [{ kind: "citymap", id: publicId, revision }], derivedWork: [], warnings: [] },
                entries: [
                    {
                        action: "citymap.updated",
                        citymapId: publicId,
                        assetId: body.assetId,
                        targetRevision: revision,
                        details: { fields: ["images"] },
                    },
                ],
            };
        },
    );
}
