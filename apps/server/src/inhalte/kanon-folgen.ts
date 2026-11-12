import type { InhalteTraegerArt, KanonObjektart } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { KANON_TRAEGER, kanonDesTraegers, ladeGespeicherteKanonZeilen, ladeKanonTraeger } from "../kanon/laden.ts";
import { KANON_ABGELEITET_VON, gleicheAussage } from "../kanon/neu-berechnen.ts";
import { leseNamespaceTafelImSchnitt } from "../kanon/tafel.ts";

/**
 * Das Etikett der Träger, deren Quellen sich geändert haben (WI-0254): Rang 1 bis 3 der Kanon-Regel (`kanon/ableitung.ts`, `sources.yaml`
 * `kanon.raenge`) neu gerechnet und in `<träger>_canon` geschrieben, in DERSELBEN Transaktion wie die Änderung. Ohne das stünde das Etikett
 * der Pille bis zum nächsten Zug auf dem alten Stand, obwohl die Quelle schon eine andere Auskunft gibt.
 *
 * - **Nur die berührten Träger.** Die Regel rechnet über die Träger einer Art (die Wegegruppe erbt vom Namensraum ihrer Abschnitte), darum
 *   lädt `ladeKanonTraeger` die ganze Art; geschrieben wird nur, was sich ändert (`gleicheAussage`), und gelöscht nur, wo Rang 1 bis 3
 *   nichts mehr sagen (dann greift Rang 4 beim Lesen, `subjects/carrier-tables.ts`). Dieselbe Rechnung wie `kanon/neu-berechnen.ts`.
 * - **Herkunft** `avesmaps_regel`; der nächste Legacy-Zug schreibt die Tafeln wieder neu, solange Legacy den Bereich führt
 *   (`sources.yaml`, `kanon.entscheidung`). Das ist die bekannte Lage jeder Änderung vor dem Cutoff.
 * - Die Kennungen sind die INTERNEN Nummern der Träger (`<träger>.id`), als Text.
 */
const ART_VON_TRAEGER: Readonly<Record<InhalteTraegerArt, KanonObjektart>> = {
    place: "place",
    territory: "territory",
    area: "area",
    peak: "peak",
    path: "path",
};

export type BeruehrteTraeger = Partial<Record<InhalteTraegerArt, ReadonlySet<string>>>;

export interface KanonFolge {
    /** Wie viele Zeilen neu oder anders geschrieben wurden. */
    geschrieben: number;
    /** Wie viele Zeilen entfielen, weil Rang 1 bis 3 nichts mehr sagen. */
    entfernt: number;
}

export async function aktualisiereKanon(tx: Sql, beruehrt: BeruehrteTraeger): Promise<KanonFolge> {
    const folge: KanonFolge = { geschrieben: 0, entfernt: 0 };
    const arten = (Object.keys(beruehrt) as InhalteTraegerArt[]).filter((art) => (beruehrt[art]?.size ?? 0) > 0);
    if (arten.length === 0) return folge;
    const tafel = await leseNamespaceTafelImSchnitt(tx);
    for (const traegerArt of arten) {
        const art = ART_VON_TRAEGER[traegerArt];
        const ids = beruehrt[traegerArt]!;
        const alle = await ladeKanonTraeger(tx, art, tafel);
        const gespeichert = await ladeGespeicherteKanonZeilen(tx, art);
        const schreiben: {
            id: string;
            kanon: string;
            typ: string | null;
            anzahl: number | null;
            etikett: string | null;
        }[] = [];
        const entfernen: string[] = [];
        for (const eines of alle) {
            if (!ids.has(eines.id)) continue;
            const ergebnis = kanonDesTraegers(eines, tafel, "avesmaps");
            const bisher = gespeichert.get(eines.id);
            if (gleicheAussage(bisher, ergebnis)) {
                // `unlabelled` und keine Zeile sagen dasselbe: Es zählt nichts, die Zeile entfällt, dann greift Rang 4.
                if (ergebnis === null && bisher !== undefined) entfernen.push(eines.id);
                continue;
            }
            if (ergebnis === null) entfernen.push(eines.id);
            else
                schreiben.push({
                    id: eines.id,
                    kanon: ergebnis.kanon,
                    typ: ergebnis.designatorType,
                    anzahl: ergebnis.designatorCount,
                    etikett: ergebnis.designatorLabel,
                });
        }
        const tafeln = KANON_TRAEGER[art];
        if (schreiben.length > 0) {
            await tx.unsafe(
                `INSERT INTO ${tafeln.kanon}
                        (${tafeln.fremdschluessel}, canon, designator_type, designator_count, designator_label, derived_from,
                         source_revision, source_system, imported_at)
                 SELECT t.id::bigint, t.canon, t.dtype, t.dcount, t.dlabel, '${KANON_ABGELEITET_VON}', NULL, 'avesmaps3d', now()
                   FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[]) AS t(id, canon, dtype, dcount, dlabel)
                 ON CONFLICT (${tafeln.fremdschluessel}) DO UPDATE SET
                     canon = EXCLUDED.canon, designator_type = EXCLUDED.designator_type,
                     designator_count = EXCLUDED.designator_count, designator_label = EXCLUDED.designator_label,
                     derived_from = EXCLUDED.derived_from, source_revision = NULL, source_system = EXCLUDED.source_system,
                     imported_at = EXCLUDED.imported_at, updated_at = now()`,
                [
                    schreiben.map((eintrag) => eintrag.id),
                    schreiben.map((eintrag) => eintrag.kanon),
                    schreiben.map((eintrag) => eintrag.typ),
                    schreiben.map((eintrag) => eintrag.anzahl),
                    schreiben.map((eintrag) => eintrag.etikett),
                ] as never[],
            );
            folge.geschrieben += schreiben.length;
        }
        if (entfernen.length > 0) {
            await tx.unsafe(`DELETE FROM ${tafeln.kanon} WHERE ${tafeln.fremdschluessel} = ANY($1::bigint[])`, [
                entfernen,
            ] as never[]);
            folge.entfernt += entfernen.length;
        }
    }
    return folge;
}
