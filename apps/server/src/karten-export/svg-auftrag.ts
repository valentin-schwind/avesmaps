import { createHash } from "node:crypto";
import {
    AVENTURIA_SERIES,
    KARTEN_SVG_EIGEN_PRAEFIX,
    KARTEN_SVG_EBENEN,
    KARTEN_SVG_GLATT,
    KARTEN_SVG_JOB_ART,
    KARTEN_SVG_ROH,
    KartenSvgEinstellungen,
    type KartenSvgQuelle,
    type KartenSvgStand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import type { KartenDatei } from "./quellen.ts";

/**
 * Der Auftrag `karten_svg` von der Route aus gesehen (WI-0280): einreihen und seinen Stand lesen. Gebaut wird in `jobs/karten-svg-job.ts`, nie beim Abruf: Ein Abzug liest
 * rund 20.000 Elemente aus der Datenbank, und ein Abruf von außen soll keine Rechnung auslösen können.
 *
 * Die Eingabe `eigen` trägt die Einstellungen und ihre Kennung (`svg-eigen-<12 Hex>`, Prüfsumme der Einstellungen): Dieselben Einstellungen ergeben dieselbe Kennung, also
 * denselben Eintrag in der Liste.
 */

export type KartenSvgEingabe =
    | { readonly art: "standard" }
    | { readonly art: "eigen"; readonly id: string; readonly einstellungen: KartenSvgEinstellungen };

/** Die Einstellungen in fester Form: Reihenfolge der Ebenen und Schlüssel sagen nichts aus. */
function kennungVon(einstellungen: KartenSvgEinstellungen): string {
    const fest = {
        dialekt: einstellungen.dialekt,
        groessePx: einstellungen.groessePx,
        semantik: einstellungen.semantik,
        passmarken: einstellungen.passmarken,
        strichProzent: einstellungen.strichProzent,
        glattWege: einstellungen.glattWege,
        glattFlaechen: einstellungen.glattFlaechen,
        spannung: einstellungen.spannung,
        ebenen: KARTEN_SVG_EBENEN.filter((ebene) => einstellungen.ebenen.includes(ebene)),
    };
    return `${KARTEN_SVG_EIGEN_PRAEFIX}${createHash("sha256").update(JSON.stringify(fest)).digest("hex").slice(0, 12)}`;
}

export function standardMitId(einstellungen: KartenSvgEinstellungen | undefined): KartenSvgEingabe {
    return einstellungen === undefined
        ? { art: "standard" }
        : { art: "eigen", id: kennungVon(einstellungen), einstellungen };
}

/**
 * Reiht den Bau in die Warteschlange ein. `tiles`: Er fasst keine Kartendaten an und überschneidet sich mit keinem Kartenauftrag. Wartet oder läuft derselbe Bau schon, bleibt es
 * bei ihm: Zweimal „SVG erzeugen“ und die tägliche Pflege stapeln keine Aufträge.
 */
export async function auftragEinreihen(
    tx: Queryable,
    eingabe: KartenSvgEingabe,
    personId: string | null,
    quelle: KartenSvgQuelle = "manuell",
): Promise<string> {
    const gleich = eingabe.art === "standard" ? { art: "standard" } : { art: "eigen", id: eingabe.id };
    const [offen] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id FROM job
         WHERE kind = ${KARTEN_SVG_JOB_ART} AND state IN ('QUEUED', 'RUNNING') AND input_ref @> ${tx.json(gleich)}
         ORDER BY id DESC LIMIT 1
    `;
    if (offen !== undefined) return offen.public_id;
    const [job] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id
          FROM job_enqueue(${KARTEN_SVG_JOB_ART}, 1::smallint, ${AVENTURIA_SERIES.mapDomain}, ${personId},
                           ${tx.json({ ...eingabe, quelle } as never)}, 50::smallint, NULL, 'tiles', '{}'::smallint[])
    `;
    return job!.public_id;
}

/** Die aktuelle Kartenfassung, mit der der Abzug verglichen wird; dieselbe Quelle wie sein Stempel (`svg/daten.ts`): die letzte Operation an der Karte. */
export async function leseKartenfassung(sql: Queryable, mapDomainId: string): Promise<string> {
    const [zeile] = await sql<{ seq: string }[]>`
        SELECT coalesce(max(seq), 0)::text AS seq FROM map_operation WHERE map_domain_id = ${mapDomainId}
    `;
    return zeile?.seq ?? "0";
}

/** Läuft ein Bau, ging der letzte schief, und hat sich die Karte seit dem letzten Abzug geändert? */
export async function leseSvgStand(sql: Queryable, dateien: readonly KartenDatei[]): Promise<KartenSvgStand> {
    const [letzter] = await sql<{ state: string; error_summary: string | null }[]>`
        SELECT state, error_summary FROM job
         WHERE kind = ${KARTEN_SVG_JOB_ART}
         ORDER BY id DESC LIMIT 1
    `;
    const fassung = await leseKartenfassung(sql, AVENTURIA_SERIES.mapDomain);
    const fest = dateien.filter((d) => d.eintrag.id === KARTEN_SVG_ROH || d.eintrag.id === KARTEN_SVG_GLATT);
    const veraltet = fest.some((d) => d.eintrag.bytes === null || d.eintrag.fassung !== fassung);
    if (letzter === undefined) return { zustand: "ruht", fehler: null, veraltet };
    if (["QUEUED", "RUNNING"].includes(letzter.state)) {
        return { zustand: "laeuft", fehler: null, veraltet };
    }
    if (letzter.state === "FAILED") return { zustand: "fehler", fehler: letzter.error_summary, veraltet };
    return { zustand: "ruht", fehler: null, veraltet };
}
