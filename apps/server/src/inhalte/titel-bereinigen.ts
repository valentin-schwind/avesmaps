import { createHash, randomUUID } from "node:crypto";
import type { Database, Queryable } from "../database.ts";
import type { MapActor } from "../editor/map-operation.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "../media-editor/upload.ts";
import { MEDIA_CONTRACT_VERSION } from "../migration/media-legacy.ts";
import { titelOhneAuszeichnung } from "../wiki/infobox/text.ts";
import { inhalteOperation } from "./operation.ts";

/**
 * Titel mit Auszeichnung im Bestand bereinigen, als Lauf (Fund aus OPS-000091, 2026-11-07; Vali auf die Wahl „von Hand“ oder „Daten-Lauf“:
 * „Daten-Lauf“). Seit `2db650287` schreibt kein Weg mehr HTML oder Wiki-Markup in einen Titel (`titelOhneAuszeichnung`); dieser Lauf bringt die
 * Zeilen von vorher auf dieselbe Regel: Quellen (`feature_source.title`), Werke (`adventure.title`) und Asset-Namen (`media_asset.title`, etwa
 * „Umschlag von „…““, die einem geänderten Werktitel nicht von selbst folgen, `media-editor/titles.ts`).
 *
 * - **Gefunden** wird jede aktive Quelle, jedes aktive Werk und jedes Asset, dessen Titel die Regel ändert. Geschrieben wird genau der Titel nach
 *   der Regel, nichts anderes.
 * - 🔴 **Die Herkunft bleibt:** kein `source_system = 'editor'`, kein Vermerk `manual` in `adventure_field_origin`, kein `asset.metadata_set`. Ein
 *   Titel des Wikis bleibt einer des Wikis, ein Name des Systems einer des Systems. Darin unterscheidet sich der Lauf vom Speichern im Fenster
 *   „Inhalte bearbeiten“, das einen Titel zu einem der Redaktion macht.
 * - **Quelle und Werk:** je EINE Operation `source.update` beziehungsweise `work.update` über die Naht der Inhalte (`inhalteOperation`), Akteur
 *   Agent mit dem Wortlaut der Freigabe, Fachprotokoll mit dem Titel vorher und nachher; die Operation steht in „Änderungen“. Die Kennung ist fest
 *   aus Art, Gegenstand, Revision und neuem Titel: Ein zweiter Lauf findet den Gegenstand nicht mehr, ein wiederholter Aufruf schreibt nichts doppelt.
 * - 🪤 **↺ bringt die Auszeichnung nicht zurück:** Die Rücknahme schreibt über `source.update` und `work.update`, und die tragen dieselbe Regel. Ein
 *   falsch getroffener Titel wird von Hand im Fenster „Inhalte bearbeiten“ neu gesetzt; den Wert vorher hält das Protokoll fest.
 * - **Asset:** wie der Nachtrag der Namen (`media:titel`): ein Update gegen den gelesenen Titel und die gelesene Revision, das Journal in
 *   `migration_run` (Domäne `media`, Quelle `titel:bereinigen`) mit vorher und nachher je Asset. Das ist der Rückweg für die Asset-Namen.
 * - Bliebe ein Titel leer, wird er nicht geschrieben (`leer`).
 * - Hat sich ein Gegenstand seit dem Lesen geändert (Revision oder Titel), bleibt er liegen und steht als Fehler da.
 */

export type TitelArt = "quelle" | "werk" | "asset";

export interface TitelFund {
    art: TitelArt;
    /** `public_id` des Gegenstands. */
    kennung: string;
    revision: number;
    vorher: string;
    nachher: string;
    /** Die Regel ließe nichts übrig: nicht schreiben. */
    leer: boolean;
    /** `source_system` der Quelle oder des Werks; beim Asset `null`. */
    herkunft: string | null;
}

export interface TitelFehler {
    fund: TitelFund;
    grund: string;
}

export interface TitelLaufErgebnis {
    geschrieben: TitelFund[];
    fehler: TitelFehler[];
    /** Kennung je geschriebener Quelle und je geschriebenem Werk (`map_operation.operation_id`). */
    operationen: Map<string, string>;
    /** `migration_run.id` des Journals der Asset-Namen; `null` ohne Asset. */
    journal: string | null;
}

/** Was einen Titel zum Kandidaten macht: eine spitze Klammer, ein Wiki-Link, Wiki-Kursiv oder -Fett. Die Regel entscheidet danach je Titel. */
const VERDACHT = "[<[]|''";

interface Zeile {
    kennung: string;
    revision: number;
    titel: string;
    herkunft: string | null;
}

/** Die Kandidaten lesen und nach der Regel prüfen. `nur` grenzt auf bestimmte Gegenstände ein (`public_id`). */
export async function findeTitelMitAuszeichnung(db: Queryable, nur?: readonly string[]): Promise<TitelFund[]> {
    const filter = nur === undefined ? null : [...nur];
    const quellen = await db<Zeile[]>`
        SELECT public_id::text AS kennung, revision::int AS revision, title AS titel, source_system AS herkunft
          FROM feature_source
         WHERE is_active AND title ~ ${VERDACHT}
           AND (${filter}::uuid[] IS NULL OR public_id = ANY(${filter}::uuid[]))
         ORDER BY title, public_id
    `;
    const werke = await db<Zeile[]>`
        SELECT public_id::text AS kennung, revision::int AS revision, title AS titel, source_system AS herkunft
          FROM adventure
         WHERE is_active AND title ~ ${VERDACHT}
           AND (${filter}::uuid[] IS NULL OR public_id = ANY(${filter}::uuid[]))
         ORDER BY title, public_id
    `;
    const assets = await db<Zeile[]>`
        SELECT public_id::text AS kennung, revision::int AS revision, title AS titel, NULL::text AS herkunft
          FROM media_asset
         WHERE title ~ ${VERDACHT}
           AND (${filter}::uuid[] IS NULL OR public_id = ANY(${filter}::uuid[]))
         ORDER BY title, public_id
    `;
    const funde: TitelFund[] = [];
    const pruefe = (art: TitelArt, zeilen: readonly Zeile[]): void => {
        for (const zeile of zeilen) {
            const nachher = titelOhneAuszeichnung(zeile.titel);
            if (nachher === zeile.titel) continue;
            funde.push({
                art,
                kennung: zeile.kennung,
                revision: zeile.revision,
                vorher: zeile.titel,
                nachher,
                leer: nachher.trim() === "",
                herkunft: zeile.herkunft,
            });
        }
    };
    pruefe("quelle", quellen);
    pruefe("werk", werke);
    pruefe("asset", assets);
    return funde;
}

/** Die feste Kennung der Operation (UUID nach Version 5 geformt): derselbe Fund ergibt dieselbe Kennung. */
export function kennungDerOperation(fund: TitelFund): string {
    const h = createHash("sha256")
        .update(`titel-bereinigen:${fund.art}:${fund.kennung}:${String(fund.revision)}:${fund.nachher}`)
        .digest("hex");
    const variante = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

class Veraltet extends Error {}

const TAFEL = {
    quelle: {
        tafel: "feature_source",
        operation: "source.update",
        aktion: "source.updated",
        art: "source",
        wort: "Quelle",
    },
    werk: { tafel: "adventure", operation: "work.update", aktion: "work.updated", art: "work", wort: "Werk" },
} as const;

async function schreibeObjekt(database: Database, actor: MapActor, fund: TitelFund & { art: "quelle" | "werk" }) {
    const t = TAFEL[fund.art];
    const operationId = kennungDerOperation(fund);
    await inhalteOperation(
        database,
        actor,
        {
            operationId,
            operation: t.operation,
            body: {
                [fund.art === "quelle" ? "sourceId" : "workId"]: fund.kennung,
                baseRevision: fund.revision,
                fields: { title: fund.nachher },
                lauf: "titel:bereinigen",
            },
        },
        async (tx) => {
            const [zeile] = await tx.unsafe<{ id: string; revision: number; title: string }[]>(
                `SELECT id::text AS id, revision::int AS revision, title FROM ${t.tafel}
                  WHERE public_id = $1::uuid AND is_active FOR UPDATE`,
                [fund.kennung],
            );
            if (zeile === undefined) throw new Veraltet(`${t.wort} nicht mehr aktiv`);
            if (zeile.revision !== fund.revision || zeile.title !== fund.vorher) {
                throw new Veraltet(
                    `${t.wort} geändert seit dem Lesen (Revision ${String(zeile.revision)} statt ${String(fund.revision)})`,
                );
            }
            // Nur der Titel: `source_system` und die Herkunft je Feld bleiben. Die Revision zählt der Trigger (`revision_bump_forward`).
            const [neu] = await tx.unsafe<{ revision: number }[]>(
                `UPDATE ${t.tafel} SET title = $2 WHERE id = $1::bigint RETURNING revision::int AS revision`,
                [zeile.id, fund.nachher],
            );
            const revision = neu!.revision;
            return {
                receipt: { affected: [{ kind: t.art, id: fund.kennung, revision }], derivedWork: [], warnings: [] },
                summary: `${t.wort} „${fund.nachher}“: Titel ohne Auszeichnung`,
                entries: [
                    {
                        action: t.aktion,
                        ...(fund.art === "quelle" ? { sourceId: fund.kennung } : { workId: fund.kennung }),
                        revisionBefore: zeile.revision,
                        revisionAfter: revision,
                        changes: { title: { before: fund.vorher, after: fund.nachher } },
                    },
                ],
            };
        },
    );
    return operationId;
}

/**
 * Die Funde schreiben. Der Aufrufer hat sie eben gelesen (`findeTitelMitAuszeichnung`), die Anzahl gegen die Freigabe geprüft und die Kartensperre
 * gesehen. Funde mit `leer` schreibt der Lauf nie.
 */
export async function bereinigeTitel(
    database: Database,
    actor: MapActor & { kind: "agent" },
    funde: readonly TitelFund[],
): Promise<TitelLaufErgebnis> {
    const ergebnis: TitelLaufErgebnis = { geschrieben: [], fehler: [], operationen: new Map(), journal: null };
    for (const fund of funde) {
        if (fund.leer || fund.art === "asset") continue;
        try {
            const operationId = await schreibeObjekt(database, actor, fund as TitelFund & { art: "quelle" | "werk" });
            ergebnis.geschrieben.push(fund);
            ergebnis.operationen.set(fund.kennung, operationId);
        } catch (error) {
            ergebnis.fehler.push({ fund, grund: error instanceof Error ? error.message : String(error) });
        }
    }
    const assets = funde.filter((fund) => fund.art === "asset" && !fund.leer);
    if (assets.length > 0) {
        const runId = randomUUID();
        await database.begin(async (tx) => {
            await tx`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'media', ${MEDIA_EDITOR_SOURCE_SYSTEM}, 'titel:bereinigen', ${MEDIA_CONTRACT_VERSION})
            `;
            const titel: {
                asset: string;
                before: string;
                after: string;
                revision_before: number;
                revision_after: number;
            }[] = [];
            for (const fund of assets) {
                const [neu] = await tx<{ revision: number }[]>`
                    UPDATE media_asset SET title = ${fund.nachher}, updated_at = now()
                     WHERE public_id = ${fund.kennung}::uuid AND title = ${fund.vorher} AND revision = ${fund.revision}
                    RETURNING revision::int AS revision
                `;
                if (neu === undefined) {
                    ergebnis.fehler.push({ fund, grund: "Asset geändert seit dem Lesen (Titel oder Revision)" });
                    continue;
                }
                ergebnis.geschrieben.push(fund);
                titel.push({
                    asset: fund.kennung,
                    before: fund.vorher,
                    after: fund.nachher,
                    revision_before: fund.revision,
                    revision_after: neu.revision,
                });
            }
            await tx`
                UPDATE migration_run
                   SET completed_at = now(), status = 'completed', journal = ${
                       {
                           tool: "titel:bereinigen",
                           operator_said: actor.approvalRef,
                           actor: actor.label,
                           renamed_titles: titel,
                       } as unknown as string
                   }
                 WHERE id = ${runId}
            `;
        });
        ergebnis.journal = runId;
    }
    return ergebnis;
}
