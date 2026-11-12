import type { Queryable } from "../database.ts";
import { vorgabeVon, type Vorgabe } from "../inhalte/korpora-vorgabe.ts";

/**
 * Die Vorgabe eines Belegstellen-Korpus, nach dem Abgleich erneut auf die Quellen gerechnet (WI-0254, Runde 4; Vali: „überall“).
 *
 * Der Abgleich der Katalogquellen schreibt Art, „offiziell“, Lizenz und Namensnennung jeder Quelle, wie Legacy sie liefert (`feature_source`, `SOURCE_COLUMNS`).
 * Hat die Redaktion einem Korpus mit der Anzeigeform `belegstelle` eine Vorgabe gesetzt, wäre jede Quelle der Domain danach wieder auf Legacys Wert zurückgestellt,
 * und die Vorgabe gälte nur bis zum nächsten Zug. Deshalb rechnet der Zug die Vorgabe in zwei Schritten auf die Quellen: (1) `legeVorgabeAuf` legt sie VOR dem
 * Abgleich auf die erwarteten Zeilen, damit der Abgleich eine Quelle mit der Vorgabe als unverändert sieht (sonst würde er sie auf Legacys Wert und gleich danach
 * wieder zurückschreiben, zweimal je Lauf, mit jeweils einer neuen Revision der Quelle); (2) `wendeKorpusVorgabeAn` rechnet sie NACH dem Abgleich erneut auf alle
 * aktiven Quellen der Domain, auch auf die, die die Redaktion angelegt oder an anderen Feldern geändert hat (der Abgleich fasst sie nie an): Ausnahmen je Quelle
 * gibt es nicht. Die Quellen werden dafür nicht einzeln als `editor` gesperrt; die geschützte Zeile ist die des Korpus (`source_system = 'editor'`,
 * `protectedWhere` am Abgleich der Korpora).
 *
 * Nur was gesetzt ist, gibt vor (`korpora-vorgabe.ts`): Art und „offiziell“ am Korpus sind nullable, die Lizenzaussage „nicht erfasst“ und eine leere Namensnennung
 * geben nichts vor. Bei `werk` und unentschiedener Form passiert nichts. Gerechnet wird in der Transaktion des Zuges; sie rollt bei einem Probelauf zurück.
 */
export interface KorpusVorgabeBericht {
    /** Wie viele Korpora eine Vorgabe tragen und durchschreiben. */
    korpora: number;
    /** Wie viele Quellen die Vorgabe dabei änderte (Zeilen, in denen mindestens ein Feld von ihr abwich). */
    quellen: number;
}

/** Die Vorgabe je Korpus (Schlüssel = Domain), nur der Korpora mit Anzeigeform Belegstelle und mindestens einem gesetzten Feld. */
export async function ladeKorpusVorgaben(transaction: Queryable): Promise<Map<string, Vorgabe>> {
    const korpora = await transaction<KorpusRow[]>`
        SELECT corpus_key, source_type, is_official, license_statement, license_key, attribution
          FROM source_corpus
         WHERE is_active AND form = 'belegstelle'
           AND (source_type IS NOT NULL OR is_official IS NOT NULL OR license_statement <> 'unrecorded'
                OR (attribution IS NOT NULL AND btrim(attribution) <> ''))
    `;
    return new Map(korpora.map((korpus) => [korpus.corpus_key, vorgabeVon(angabenVon(korpus))]));
}

const angabenVon = (korpus: KorpusRow): Parameters<typeof vorgabeVon>[0] => ({
    form: "belegstelle",
    sourceType: korpus.source_type,
    isOfficial: korpus.is_official,
    lizenzAussage: korpus.license_statement,
    lizenzKey: korpus.license_key,
    attribution: korpus.attribution,
});

/** Die Werte einer erwarteten Quellenzeile, mit der Vorgabe ihres Korpus darübergelegt; ohne Vorgabe unverändert. */
export function legeVorgabeAuf<
    T extends {
        sourceType: string;
        isOfficial: boolean;
        licenseStatement: string;
        licenseKey: string | null;
        attribution: string | null;
    },
>(zeile: T, vorgabe: Vorgabe | undefined): T {
    if (vorgabe === undefined) return zeile;
    return {
        ...zeile,
        sourceType: vorgabe.sourceType ?? zeile.sourceType,
        isOfficial: vorgabe.isOfficial ?? zeile.isOfficial,
        licenseStatement: vorgabe.lizenz?.aussage ?? zeile.licenseStatement,
        licenseKey: vorgabe.lizenz === null ? zeile.licenseKey : vorgabe.lizenz.key,
        attribution: vorgabe.attribution ?? zeile.attribution,
    };
}

interface KorpusRow {
    corpus_key: string;
    source_type: string | null;
    is_official: boolean | null;
    license_statement: string;
    license_key: string | null;
    attribution: string | null;
}

export async function wendeKorpusVorgabeAn(transaction: Queryable): Promise<KorpusVorgabeBericht> {
    const korpora = await transaction<KorpusRow[]>`
        SELECT corpus_key, source_type, is_official, license_statement, license_key, attribution
          FROM source_corpus
         WHERE is_active AND form = 'belegstelle'
           AND (source_type IS NOT NULL OR is_official IS NOT NULL OR license_statement <> 'unrecorded'
                OR (attribution IS NOT NULL AND btrim(attribution) <> ''))
         ORDER BY corpus_key
    `;
    const bericht: KorpusVorgabeBericht = { korpora: 0, quellen: 0 };
    for (const korpus of korpora) {
        const vorgabe = vorgabeVon(angabenVon(korpus));
        const geaendert = await transaction.unsafe<{ id: string }[]>(
            `UPDATE feature_source f SET
                source_type = COALESCE($2::text, f.source_type),
                is_official = COALESCE($3::boolean, f.is_official),
                license_statement = CASE WHEN $4::boolean THEN $5::text ELSE f.license_statement END,
                license_key = CASE WHEN $4::boolean THEN $6::text ELSE f.license_key END,
                attribution = COALESCE($7::text, f.attribution)
              WHERE f.corpus_key = $1 AND f.is_active AND (
                    ($2::text IS NOT NULL AND f.source_type <> $2::text)
                 OR ($3::boolean IS NOT NULL AND f.is_official <> $3::boolean)
                 OR ($4::boolean AND (f.license_statement <> $5::text OR f.license_key IS DISTINCT FROM $6::text))
                 OR ($7::text IS NOT NULL AND f.attribution IS DISTINCT FROM $7::text)
              )
          RETURNING f.id::text AS id`,
            [
                korpus.corpus_key,
                vorgabe.sourceType,
                vorgabe.isOfficial,
                vorgabe.lizenz !== null,
                vorgabe.lizenz?.aussage ?? null,
                vorgabe.lizenz?.key ?? null,
                vorgabe.attribution,
            ] as never[],
        );
        bericht.korpora += 1;
        bericht.quellen += geaendert.length;
    }
    return bericht;
}
