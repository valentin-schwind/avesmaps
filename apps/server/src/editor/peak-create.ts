import { randomUUID } from "node:crypto";
import {
    AVENTURIA,
    LANDMARKE_CREATE_HANDLE,
    PEAK_CREATE_DIGITS,
    PEAK_CREATE_HANDLE,
    formtGelaende,
    merkmaleDerArt,
    istLandmarkenArt,
    type PeakCreateBody,
    type PeakCreateReceipt,
} from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { GIPFEL_ART } from "./gelaende-folgen.ts";
import { haengeKandidatAn, sperreKandidatZumSetzen, type KandidatZumSetzen } from "./landmarken-kandidaten.ts";
import { mapOperation, type MapActor } from "./map-operation.ts";
import { merkmaleGeordnet } from "./peak-update.ts";

/**
 * „Hier hinzufügen › ▲ Gipfel setzen …“ (WI-0178 P7; Fassung 16 des Gebirge-Entwurfs: „setzt hier einen Gipfel (Legacy „Höhenpunkt
 * setzen“); danach öffnet sein Fenster mit Name und Höhe“): `peak.create`, ein Berggipfel an EINER Stelle als EINE Operation (Vertrag
 * `PeakCreateBody` in `packages/shared/src/editor-peaks.ts`).
 *
 * - **Wie Legacy** (`startNewEcosystemPeak` in `js/map-features/map-features-ecosystem-context-action.js`, Mirror a7f2dac8): ein
 *   `berggipfel` an der Stelle des Rechtsklicks, ohne Wiki-Artikel und trotzdem auf der Karte (Owner-Entscheid 2026-07-28), ohne Höhe
 *   (die Ableitung nimmt die Vorgabe des Höhenmodells). Legacy fragt den Namen im Dialog und lässt ihn leer; bei uns trägt er den Griff
 *   „Gipfel-001“ wie eine neue Fläche (`landscape-create.ts`), denn ein Gipfel braucht einen Namen (`peak.update`), und das Fenster
 *   öffnet mit dem Namen markiert.
 * - **Eine Operation:** Gipfel und Protokoll (`peak.created`) in EINER Transaktion; die Schreibnaht reiht das Gelände im Umkreis ein
 *   (`affected` `{ kind: "peak" }`, `gelaende-folgen.ts`) und stößt die Kacheln an. Außerhalb der Karte 400.
 * - **Herkunft `avesmaps3d`:** Der Geländezug (I10, `migration/terrain.ts`) legt nur Gipfel aus Legacy still, die Testwelt diesen.
 * - Läuft der Zug, 503 (`mapOperation`); eine wiederholte Kennung bekommt die erste Quittung samt ihrem Gipfel.
 * - **Landmarken** (WI-0271 L3): `subtype` wählt die Art (ohne: Berggipfel), `merkmale` gibt sie von Anfang an mit. Eine Art ohne Gelände
 *   heißt „Landmarke-001“ (eigene Zählung) und reiht kein Gelände ein: Der Eingabeindex liest nur die Sicht der Geländearten.
 * - **Aus einem Wiki-Kandidaten** (WI-0271 L7, „Auf der Karte setzen“ an einer ◐-Zeile, `wikiKandidat`): Name, Art (wo `subtype` fehlt) und Höhe (nur Berg und Vulkan) kommen vom Artikel, und der
 *   Artikel hängt an der neuen Landmarke (`landmarken-kandidaten.ts`), in derselben Transaktion. Der Kandidat wird gesperrt; war er inzwischen gesetzt, unterdrückt oder still gelegt, 409.
 */

/** Der Griff zur Nummer, wie bei der Fläche mit drei Stellen; jenseits von 999 wächst er weiter. Ohne Gelände: „Landmarke-001“. */
export const gipfelGriff = (nummer: number, griff: string = PEAK_CREATE_HANDLE): string =>
    `${griff}-${String(nummer).padStart(PEAK_CREATE_DIGITS, "0")}`;

export async function createPeak(
    database: Database,
    actor: MapActor,
    body: PeakCreateBody,
): Promise<PeakCreateReceipt> {
    const domain = AVENTURIA.mapDomain;
    const publicId = randomUUID();
    const [x, y] = body.position;
    const merkmale = merkmaleGeordnet(body.merkmale ?? []);
    let art = body.subtype ?? "berggipfel";
    let name = "";
    const receipt = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "peak.create", mapDomainId: domain, body },
        async (tx) => {
            const [lage] = await tx<{ inside: boolean | null }[]>`
                SELECT map_domain_contains(${domain}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)) AS inside
            `;
            if (lage?.inside !== true)
                throw new ApiError(400, "validation_failed", "Der Gipfel liegt außerhalb der Karte.", {
                    field: "position",
                });
            // Ein Wiki-Kandidat gibt Name, Art und Höhe; sonst der Griff mit der nächsten freien Nummer. Zwei gleichzeitige Anlagen warten hier aufeinander.
            await tx`SELECT pg_advisory_xact_lock(hashtext(${`peak.create:${domain}`}))`;
            let kandidat: KandidatZumSetzen | undefined;
            if (body.wikiKandidat !== undefined) {
                kandidat = await sperreKandidatZumSetzen(tx, body.wikiKandidat);
                if (body.subtype === undefined && istLandmarkenArt(kandidat.art)) art = kandidat.art;
                name = kandidat.name;
            } else {
                const griff = formtGelaende(art) ? PEAK_CREATE_HANDLE : LANDMARKE_CREATE_HANDLE;
                const muster = `^${griff}-([0-9]+)$`;
                const [nummer] = await tx<{ n: string }[]>`
                    SELECT (coalesce(max((substring(name FROM ${muster}))::bigint), 0) + 1)::text AS n
                      FROM terrain_peak WHERE map_domain_id = ${domain} AND name ~ ${muster}
                `;
                name = gipfelGriff(Number(nummer?.n ?? 1), griff);
            }
            // Die Höhe nur, wo die Art Gelände formt (CHECK `terrain_peak_hoehe_nur_gelaende`).
            const hoehe = kandidat !== undefined && formtGelaende(art) ? kandidat.height : null;
            if (merkmale.some((merkmal) => !merkmaleDerArt(art).includes(merkmal)))
                throw new ApiError(400, "validation_failed", "„Nur Gelände“ geht nur an Berggipfel und Vulkan.", {
                    field: "merkmale",
                });
            const [zeile] = await tx<{ revision: number }[]>`
                INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, merkmale, height_schritt, geom, source_system, is_active)
                VALUES (${publicId}::uuid, ${domain}, ${name}, ${art}, ${merkmale}::text[], ${hoehe},
                        ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'avesmaps3d', TRUE)
                RETURNING revision::int AS revision
            `;
            if (kandidat !== undefined) await haengeKandidatAn(tx, publicId, kandidat);
            return {
                receipt: {
                    affected: [{ kind: GIPFEL_ART, id: publicId, revision: zeile!.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                // 🪤 Der Artikel steht nur in der Zusammenfassung, nicht als Feld `wiki` am Gipfel: Ein Gipfelfeld, das die Rücknahme nicht kennt, machte das Setzen unrücknehmbar (`ruecknahme-flaeche.ts`).
                summary: `${art === "berggipfel" ? `${name}: neuer Berggipfel` : `${name}: neue Landmarke (${art})`}${kandidat === undefined ? "" : ` aus dem Wiki-Artikel „${kandidat.titel}“`}`,
                entries: [
                    {
                        action: "peak.created",
                        peakId: publicId,
                        revisionBefore: null,
                        revisionAfter: zeile!.revision,
                        changes: {
                            name: { after: name },
                            subtype: { after: art },
                            ...(merkmale.length === 0 ? {} : { merkmale: { after: merkmale } }),
                            ...(hoehe === null ? {} : { height: { after: hoehe } }),
                            position: { after: [x, y] },
                            active: { after: true },
                        },
                    },
                ],
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung (`runOperation`): Ihr Gipfel ist der aus der Quittung.
    const angelegt = receipt.affected.find((entity) => entity.kind === GIPFEL_ART)?.id ?? publicId;
    if (angelegt !== publicId || name === "") {
        const [vorhanden] = await database<{ name: string }[]>`
            SELECT name FROM terrain_peak WHERE public_id = ${angelegt}::uuid
        `;
        name = vorhanden?.name ?? name;
    }
    return { ...receipt, publicId: angelegt, name };
}
