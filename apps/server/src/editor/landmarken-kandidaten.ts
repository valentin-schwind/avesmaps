import {
    AVENTURIA,
    istLandmarkenArt,
    wikiLinkKey,
    type EditorLandmarkenKandidat,
    type LandmarkenKandidatUnterdrueckenBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { landmarkeAdresse } from "../wiki/abgleich/landmarken.ts";
import { ladeLandmarkenAufDerKarte } from "../wiki/abgleich/lokal.ts";
import { landmarkeSchluessel } from "../wiki/infobox/landmarke.ts";
import { schreibeX2 } from "../wiki/objekt/anschluss.ts";
import { mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";

/**
 * Die Landmarken-Kandidaten im Editor (WI-0271 L7, §4.2): die Landmarken-Artikel des Wikis ohne Landmarke auf der Karte (`wiki_landmarke_artikel`, angelegt vom WikiSync) als ◐-Zeilen der
 * Derographie-Liste, „Auf der Karte setzen“ (über `peak.create` mit `wikiKandidat`) und „Nicht auf die Karte“ (Unterdrücken).
 *
 * - **Nie nach Namen zusammenführen:** Ein Kandidat hängt an seiner Adresse. Hängt dieselbe Adresse schon an einer Landmarke der Karte (auch einer stillgelegten, §4.2 Tombstones), ist er keiner mehr;
 *   die Liste lässt ihn weg, bevor der nächste Lauf ihn still legt.
 * - **Setzen:** Die Landmarke heißt wie der Artikel, trägt seine Art (die Person darf sie wählen) und seine Höhe (nur Berg und Vulkan). Der Artikel hängt als Zuordnung „nur Adresse“ (`address_only`)
 *   an ihr, mit der Tafel X2 gegen den Legacy-Zug geschützt. 🪤 Einen Wiki-Stand (`wiki_region_snapshot`) legt dabei niemand an: Die App liest ihn nur, und der WikiSync legt nur Einträge ohne Fläche an (WI-0284), nie für eine Landmarke.
 * - **Unterdrücken** schreibt allein `unterdrueckt` über die Schreibnaht (Quelle `wikisync`, wie die Zuweisung einer Fläche im Regelfenster), mit Fachprotokoll am Artikel. Die zwei Operationen
 *   sind einander die Rücknahme (`ruecknahme-wikisync.ts`): Ein Unterdrücken nimmt „Wieder anbieten“ zurück und umgekehrt; kein Lauf ändert die Spalte.
 */

/** Die Operationen im Fachprotokoll (`map_operation.action`). */
export const OPERATION_UNTERDRUECKEN = "wikisync.landmarke_unterdruecken";
export const OPERATION_ANBIETEN = "wikisync.landmarke_anbieten";
/** Die Aktionen am Artikel (`map_audit_event.action`). */
export const AKTION_UNTERDRUECKT = "landmarke_artikel.unterdrueckt";
export const AKTION_ANGEBOTEN = "landmarke_artikel.angeboten";

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | undefined => (typeof wert === "string" && wert.trim() !== "" ? wert : undefined);

/** Die Kandidaten der Liste: aktive Landmarken-Artikel, deren Adresse an keiner Landmarke der Karte hängt; unterdrückte mit Marke. Fehlt die Tafel (vor Migration 0290), gibt es keine. */
export async function ladeLandmarkenKandidaten(db: Queryable): Promise<EditorLandmarkenKandidat[]> {
    const [tafel] = await db<{ da: boolean }[]>`SELECT to_regclass('public.wiki_landmarke_artikel') IS NOT NULL AS da`;
    if (tafel?.da !== true) return [];
    const zeilen = await db<Zeile[]>`
        SELECT public_id::text AS id, titel, name, art, wiki_art, region, hoehe_schritt, kurzbeschreibung, unterdrueckt, revision::int AS revision
          FROM wiki_landmarke_artikel
         WHERE is_active
         ORDER BY lower(coalesce(name, titel)), public_id
    `;
    const aufDerKarte = await ladeLandmarkenAufDerKarte(db);
    const kandidaten: EditorLandmarkenKandidat[] = [];
    for (const zeile of zeilen) {
        const titel = String(zeile["titel"]);
        const art = text(zeile["art"]);
        if (art === undefined || !istLandmarkenArt(art) || aufDerKarte.has(landmarkeSchluessel(titel))) continue;
        const wikiArt = text(zeile["wiki_art"]);
        const region = text(zeile["region"]);
        const kurz = text(zeile["kurzbeschreibung"]);
        const hoehe = zeile["hoehe_schritt"];
        kandidaten.push({
            id: String(zeile["id"]),
            titel,
            name: text(zeile["name"]) ?? titel,
            art,
            ...(wikiArt === undefined ? {} : { wikiArt }),
            ...(region === undefined ? {} : { region }),
            ...(typeof hoehe === "number" ? { height: hoehe } : {}),
            ...(kurz === undefined ? {} : { kurzbeschreibung: kurz }),
            wikiUrl: landmarkeAdresse(titel),
            ...(zeile["unterdrueckt"] === true ? { unterdrueckt: true as const } : {}),
            revision: Number(zeile["revision"]),
        });
    }
    return kandidaten;
}

/** Was das Setzen vom Kandidaten braucht. */
export interface KandidatZumSetzen {
    id: string;
    titel: string;
    name: string;
    art: string;
    height: number | null;
    url: string;
}

/**
 * Der Kandidat zum Setzen, gesperrt (`FOR UPDATE`, in der Transaktion von `peak.create`): aktiv, nicht unterdrückt, und seine Adresse hängt an keiner Landmarke der Karte. Sonst 409: Die Liste war
 * veraltet (ein anderer hat ihn gesetzt, ein Lauf hat ihn still gelegt, jemand hat ihn unterdrückt).
 */
export async function sperreKandidatZumSetzen(tx: Queryable, id: string): Promise<KandidatZumSetzen> {
    const [zeile] = await tx<Zeile[]>`
        SELECT public_id::text AS id, titel, name, art, hoehe_schritt, is_active, unterdrueckt
          FROM wiki_landmarke_artikel WHERE public_id = ${id}::uuid FOR UPDATE
    `;
    // Ohne bekannte Art ist er kein Kandidat (die Liste zeigt ihn nicht): Aus ihm entstünde sonst still ein Berggipfel.
    const art = typeof zeile?.["art"] === "string" ? zeile["art"] : "";
    if (zeile === undefined || zeile["is_active"] !== true || !istLandmarkenArt(art))
        throw new ApiError(409, "kandidat_weg", "Diesen Wiki-Artikel gibt es als Kandidaten nicht mehr.");
    if (zeile["unterdrueckt"] === true)
        throw new ApiError(409, "kandidat_unterdrueckt", "Dieser Wiki-Artikel ist unterdrückt (nicht auf die Karte).");
    const titel = String(zeile["titel"]);
    if ((await ladeLandmarkenAufDerKarte(tx)).has(landmarkeSchluessel(titel)))
        throw new ApiError(409, "kandidat_gesetzt", "Dieser Wiki-Artikel hängt schon an einer Landmarke der Karte.");
    const hoehe = zeile["hoehe_schritt"];
    return {
        id: String(zeile["id"]),
        titel,
        name: text(zeile["name"]) ?? titel,
        art,
        height: typeof hoehe === "number" ? hoehe : null,
        url: landmarkeAdresse(titel),
    };
}

/** Hängt den Artikel an die eben gesetzte Landmarke: Zuordnung „nur Adresse“ (Herkunft `editor`) und die Tafel X2, wie die Wiki-Box. */
export async function haengeKandidatAn(tx: Queryable, peakId: string, kandidat: KandidatZumSetzen): Promise<void> {
    await tx`
        INSERT INTO terrain_peak_wiki_assignment (terrain_peak_id, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
        SELECT id, ${kandidat.url}, NULL, 'address_only', 'editor', 'avesmaps3d', TRUE FROM terrain_peak WHERE public_id = ${peakId}::uuid
    `;
    await schreibeX2(tx, "region", [peakId], {
        key: wikiLinkKey(kandidat.url),
        url: kandidat.url,
        name: kandidat.titel,
    });
}

/**
 * Schreibt „nicht auf die Karte“ (oder löst es) und liefert den Eintrag des Fachprotokolls; 409, wenn der Kandidat schon so steht. `nurAktiv`: Der Knopf im Fenster wirkt nur an einem aktiven
 * Kandidaten (404 sonst); die Rücknahme schreibt auch an einem inzwischen still gelegten zurück.
 */
async function schreibeUnterdrueckung(
    tx: Queryable,
    id: string,
    unterdrueckt: boolean,
    baseRevision: number | null,
    nurAktiv = false,
): Promise<{ entry: MapAuditEntry; titel: string; revision: number }> {
    const [vorher] = await tx<{ titel: string; unterdrueckt: boolean; revision: number; is_active: boolean }[]>`
        SELECT titel, unterdrueckt, revision::int AS revision, is_active FROM wiki_landmarke_artikel WHERE public_id = ${id}::uuid FOR UPDATE
    `;
    if (vorher === undefined || (nurAktiv && !vorher.is_active))
        throw new ApiError(404, "not_found", "Diesen Wiki-Artikel gibt es nicht (mehr) als Kandidaten.");
    if (baseRevision !== null && vorher.revision !== baseRevision)
        throw new ApiError(409, "edit_conflict", "Der Kandidat wurde inzwischen geändert.");
    if (vorher.unterdrueckt === unterdrueckt)
        throw new ApiError(
            409,
            "schon_so",
            unterdrueckt ? "Der Kandidat ist schon unterdrückt." : "Der Kandidat wird schon angeboten.",
        );
    const [nachher] = await tx<{ revision: number }[]>`
        UPDATE wiki_landmarke_artikel SET unterdrueckt = ${unterdrueckt} WHERE public_id = ${id}::uuid RETURNING revision::int AS revision
    `;
    return {
        titel: vorher.titel,
        revision: nachher!.revision,
        entry: {
            action: unterdrueckt ? AKTION_UNTERDRUECKT : AKTION_ANGEBOTEN,
            landmarkeArtikelId: id,
            revisionBefore: vorher.revision,
            revisionAfter: nachher!.revision,
            changes: { unterdrueckt: { before: vorher.unterdrueckt, after: unterdrueckt } },
        },
    };
}

/** `POST /api/editor/landmarken-kandidaten/:id/unterdruecken`: „Nicht auf die Karte“ setzen oder lösen, als Operation der Karte (Quelle `wikisync`). */
export async function setzeUnterdrueckung(
    database: Database,
    actor: MapActor,
    id: string,
    body: LandmarkenKandidatUnterdrueckenBody,
): Promise<OperationReceipt> {
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: body.unterdrueckt ? OPERATION_UNTERDRUECKEN : OPERATION_ANBIETEN,
            mapDomainId: AVENTURIA.mapDomain,
            body: { kandidat: id, unterdrueckt: body.unterdrueckt },
            source: "wikisync",
        },
        async (tx) => {
            const { entry, titel, revision } = await schreibeUnterdrueckung(
                tx,
                id,
                body.unterdrueckt,
                body.baseRevision,
                true,
            );
            return {
                receipt: { affected: [{ kind: "landmarke_artikel", id, revision }], derivedWork: [], warnings: [] },
                summary: body.unterdrueckt ? `${titel}: nicht auf die Karte` : `${titel}: wieder angeboten`,
                entries: [entry],
                // Ein Kandidat steht auf keiner Karte: nichts abzuleiten, kein Auftrag (die Schreibnaht meldet trotzdem `map.changed`, wie jede Operation an der Karte).
                ableitung: false,
            };
        },
    );
}

// ----------------------------------------------------------------------------------------------------------------------------
// Rücknahme („Änderungen“, ruecknahme-wikisync.ts)
// ----------------------------------------------------------------------------------------------------------------------------

/** Der Kandidat und der Wert, den eine Operation des Unterdrückens geschrieben hat; `undefined`, wo das Protokoll keinen nennt. */
export async function unterdrueckungDerOperation(
    db: Queryable,
    operationId: string,
): Promise<{ kandidat: string; unterdrueckt: boolean } | undefined> {
    const [zeile] = await db<{ kandidat: string; action: string }[]>`
        SELECT landmarke_artikel_public_id::text AS kandidat, action FROM map_audit_event
         WHERE operation_id = ${operationId}::uuid AND action IN (${AKTION_UNTERDRUECKT}, ${AKTION_ANGEBOTEN}) AND landmarke_artikel_public_id IS NOT NULL
         LIMIT 1
    `;
    return zeile === undefined
        ? undefined
        : { kandidat: zeile.kandidat, unterdrueckt: zeile.action === AKTION_UNTERDRUECKT };
}

/** Steht der Kandidat noch so, wie die Operation ihn ließ? Nur dann geht ihre Rücknahme (sonst ein Konflikt ohne Schreiben). */
export async function unterdrueckungSteht(
    db: Queryable,
    kandidat: string,
    unterdrueckt: boolean,
): Promise<{ steht: boolean; vorhanden: boolean; name: string | null }> {
    const [zeile] = await db<{ unterdrueckt: boolean; titel: string }[]>`
        SELECT unterdrueckt, titel FROM wiki_landmarke_artikel WHERE public_id = ${kandidat}::uuid
    `;
    if (zeile === undefined) return { steht: false, vorhanden: false, name: null };
    return { steht: zeile.unterdrueckt === unterdrueckt, vorhanden: true, name: zeile.titel };
}

/** Die Rücknahme: der umgekehrte Wert dessen, was die Operation schrieb, in der Transaktion der Schreibnaht. */
export async function kehreUnterdrueckungUm(
    tx: Queryable,
    kandidat: string,
    geschrieben: boolean,
): Promise<{
    receipt: Omit<OperationReceipt, "operationId" | "status" | "environment">;
    entries: MapAuditEntry[];
    summary: string;
    ableitung: false;
}> {
    const { entry, titel, revision } = await schreibeUnterdrueckung(tx, kandidat, !geschrieben, null);
    return {
        receipt: { affected: [{ kind: "landmarke_artikel", id: kandidat, revision }], derivedWork: [], warnings: [] },
        entries: [entry],
        summary: geschrieben ? `${titel}: wieder angeboten` : `${titel}: nicht auf die Karte`,
        ableitung: false,
    };
}
