import { randomUUID } from "node:crypto";
import { KANON_OBJEKTARTEN, type KanonObjektart, type WikiNamespaceTafel } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import type { KanonErgebnis, KanonRegelstand } from "./ableitung.ts";
import {
    KANON_TRAEGER,
    kanonDesTraegers,
    ladeGespeicherteKanonZeilen,
    ladeKanonTraeger,
    type GespeicherterKanon,
    type KanonTraeger,
} from "./laden.ts";
import { leseKanonTafel } from "./tafel.ts";

/**
 * „Kanon neu berechnen“ für EINE Umgebung (WI-0253 B-2): Rang 1 bis 3 der Kanon-Regel (`ableitung.ts`) über alle aktiven Träger, geschrieben in
 * `<träger>_canon`. Rang 4 gehört nicht hierher: Er wird beim Lesen aufgelöst (`subjects/carrier-tables.ts`).
 *
 * 🔴 Eine Ableitung der Kartendarstellung: Geschrieben wird nur mit der Freigabe des Betreibers je Umgebung und Lauf (Map Mutation Guard). Die
 * Kommandozeile (`neu-cli.ts`) schreibt nur mit seinem Zuruf; hier ist `schreiben` ein ausdrücklicher Schalter, ohne ihn wird gerechnet und
 * gezählt, nichts geschrieben.
 *
 * - **Schreibt den Stand, den die Regel sagt:** je Träger eine Zeile (`derived_from = avesmaps_regel`) oder keine, wenn Rang 1 bis 3 nichts
 *   sagen. Eine Zeile `unlabelled` gibt es nicht mehr (kein Verweis zählt = keine Zeile, dann greift Rang 4).
 * - **Idempotent:** Derselbe Stand ein zweites Mal ändert nichts.
 * - **Der Legacy-Zug rechnet dasselbe** (OPS-000066): Schritt I18 schreibt die Kanon-Tafeln seither nach dieser Regel statt mit Legacys Ergebnis
 *   (`migration/sources-import.ts`, `kanonNachRegel`); ein Zug nach diesem Werkzeug ändert an den Etiketten nichts.
 */

export const KANON_ABGELEITET_VON = "avesmaps_regel";

export interface KanonNeuOptionen {
    /** Gerechnet wird nach dieser Tafel; ohne Angabe die der Umgebung (Datenbank, sonst Vorgabe). */
    tafel?: WikiNamespaceTafel | undefined;
    regelstand?: KanonRegelstand | undefined;
    schreiben: boolean;
    arten?: readonly KanonObjektart[] | undefined;
    /** Nur diese Träger (öffentliche Kennungen): für Tests in einer Datenbank, in der andere Dateien eigene Träger haben. */
    nur?: ReadonlySet<string> | undefined;
}

export interface KanonNeuZahlen {
    traeger: number;
    neu: number;
    geaendert: number;
    /** Dieselbe Aussage, aber die Zeile stammte aus Legacys Ergebnis (`derived_from`): Die Herkunft wird umgeschrieben. */
    herkunftNeu: number;
    entfernt: number;
    unveraendert: number;
    /** Wie viele Träger ein Etikett nach Rang 1 bis 3 haben (nach der Rechnung). */
    mitEtikett: number;
}

export interface KanonNeuBericht {
    runId: string | null;
    tafelRevision: number | null;
    regelstand: KanonRegelstand;
    schreiben: boolean;
    jeArt: Record<KanonObjektart, KanonNeuZahlen>;
}

/** Sagen zwei Zeilen dasselbe (`unlabelled` und keine Zeile sind dasselbe: nichts)? */
export function gleicheAussage(gespeichert: GespeicherterKanon | undefined, ergebnis: KanonErgebnis | null): boolean {
    const nichts = gespeichert === undefined || gespeichert.kanon === "unlabelled";
    if (ergebnis === null) return nichts;
    return (
        !nichts &&
        gespeichert.kanon === ergebnis.kanon &&
        gespeichert.designatorType === ergebnis.designatorType &&
        gespeichert.designatorCount === ergebnis.designatorCount &&
        gespeichert.designatorLabel === ergebnis.designatorLabel
    );
}

const leereZahlen = (): KanonNeuZahlen => ({
    traeger: 0,
    neu: 0,
    geaendert: 0,
    herkunftNeu: 0,
    entfernt: 0,
    unveraendert: 0,
    mitEtikett: 0,
});

/** Rechnet (und schreibt, wenn gewünscht) den Kanon aller aktiven Träger neu. */
export async function berechneKanonNeu(database: Database, optionen: KanonNeuOptionen): Promise<KanonNeuBericht> {
    const regelstand = optionen.regelstand ?? "avesmaps";
    const arten = optionen.arten ?? KANON_OBJEKTARTEN;
    const tafelStand = optionen.tafel === undefined ? await leseKanonTafel(database) : undefined;
    const tafel = optionen.tafel ?? tafelStand!.namensraeume;
    const jeArt = Object.fromEntries(KANON_OBJEKTARTEN.map((art) => [art, leereZahlen()])) as Record<
        KanonObjektart,
        KanonNeuZahlen
    >;
    const bericht: KanonNeuBericht = {
        runId: null,
        tafelRevision: tafelStand?.revision ?? null,
        regelstand,
        schreiben: optionen.schreiben,
        jeArt,
    };

    await database.begin(async (tx) => {
        const runId = randomUUID();
        let geaendert = 0;
        const plan: {
            art: KanonObjektart;
            schreiben: { traeger: KanonTraeger; ergebnis: KanonErgebnis }[];
            entfernen: string[];
        }[] = [];
        for (const art of arten) {
            const alle = await ladeKanonTraeger(tx, art, tafel);
            const traeger =
                optionen.nur === undefined ? alle : alle.filter((eintrag) => optionen.nur!.has(eintrag.publicId));
            const gespeichert = await ladeGespeicherteKanonZeilen(tx, art);
            const zahlen = jeArt[art];
            const eintrag = {
                art,
                schreiben: [] as { traeger: KanonTraeger; ergebnis: KanonErgebnis }[],
                entfernen: [] as string[],
            };
            for (const eines of traeger) {
                zahlen.traeger += 1;
                const ergebnis = kanonDesTraegers(eines, tafel, regelstand);
                const bisher = gespeichert.get(eines.id);
                if (ergebnis !== null) zahlen.mitEtikett += 1;
                if (gleicheAussage(bisher, ergebnis)) {
                    // Dieselbe Aussage: nur eine Zeile aus Legacys Ergebnis bekommt ihre Herkunft umgeschrieben.
                    if (ergebnis !== null && bisher !== undefined && bisher.derivedFrom !== KANON_ABGELEITET_VON) {
                        zahlen.herkunftNeu += 1;
                        eintrag.schreiben.push({ traeger: eines, ergebnis });
                    } else if (ergebnis === null && bisher !== undefined) {
                        // `unlabelled`: Es zählt nichts, die Zeile entfällt (dann greift Rang 4).
                        zahlen.entfernt += 1;
                        eintrag.entfernen.push(eines.id);
                    } else {
                        zahlen.unveraendert += 1;
                    }
                } else if (ergebnis === null) {
                    zahlen.entfernt += 1;
                    eintrag.entfernen.push(eines.id);
                } else {
                    if (bisher === undefined || bisher.kanon === "unlabelled") zahlen.neu += 1;
                    else zahlen.geaendert += 1;
                    eintrag.schreiben.push({ traeger: eines, ergebnis });
                }
            }
            geaendert += eintrag.schreiben.length + eintrag.entfernen.length;
            plan.push(eintrag);
        }
        if (!optionen.schreiben || geaendert === 0) return;
        bericht.runId = runId;
        await tx`
            INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
            VALUES (${runId}, 'kanon-ableitung', 'avesmaps3d',
                    ${`tafel_revision=${String(bericht.tafelRevision)};regelstand=${regelstand}`}, 'sources:kanon-b2')
        `;
        for (const { art, schreiben, entfernen } of plan) {
            const tabellen = KANON_TRAEGER[art];
            if (schreiben.length > 0) {
                await tx.unsafe(
                    `INSERT INTO ${tabellen.kanon}
                            (${tabellen.fremdschluessel}, canon, designator_type, designator_count, designator_label, derived_from,
                             source_revision, source_system, migration_run_id, imported_at)
                     SELECT t.id::bigint, t.canon, t.dtype, t.dcount, t.dlabel, '${KANON_ABGELEITET_VON}', NULL, 'avesmaps3d', $6::uuid, now()
                       FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[]) AS t(id, canon, dtype, dcount, dlabel)
                     ON CONFLICT (${tabellen.fremdschluessel}) DO UPDATE SET
                         canon = EXCLUDED.canon, designator_type = EXCLUDED.designator_type,
                         designator_count = EXCLUDED.designator_count, designator_label = EXCLUDED.designator_label,
                         derived_from = EXCLUDED.derived_from, source_revision = NULL, source_system = EXCLUDED.source_system,
                         migration_run_id = EXCLUDED.migration_run_id, imported_at = EXCLUDED.imported_at, updated_at = now()`,
                    [
                        schreiben.map((eintrag) => eintrag.traeger.id),
                        schreiben.map((eintrag) => eintrag.ergebnis.kanon),
                        schreiben.map((eintrag) => eintrag.ergebnis.designatorType),
                        schreiben.map((eintrag) => eintrag.ergebnis.designatorCount),
                        schreiben.map((eintrag) => eintrag.ergebnis.designatorLabel),
                        runId,
                    ],
                );
            }
            if (entfernen.length > 0) {
                await tx.unsafe(`DELETE FROM ${tabellen.kanon} WHERE ${tabellen.fremdschluessel} = ANY($1::bigint[])`, [
                    entfernen,
                ]);
            }
        }
        await tx`
            UPDATE migration_run
               SET completed_at = now(), status = 'completed', journal = ${{ je_art: jeArt } as unknown as string}
             WHERE id = ${runId}
        `;
    });
    return bericht;
}
