import { createHash } from "node:crypto";
import {
    bereinigeDiagnose,
    CLIENT_FEHLER_GRENZEN,
    type ClientFehlerDiagnose,
    type ClientFehlerDraht,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Diagnosen zu Fehlern im Browser (WI-0202): annehmen, aufräumen, lesen. Die Zählung je Art läuft daneben über den
 * gewöhnlichen Zählpfad (`client_fehler` in `visitor_metric`, `zaehler.ts`); hier liegt nur der Text mit seiner kurzen Frist.
 *
 * 🔴 **Was eine Zeile trägt, steht abschließend in der Migration 0148 (reserviert war 0141).** Keine IP, keine Tageskennung, keine Sorte, keine
 * Uhrzeit: Der Aufrufer reicht nur Release und Browserfamilie dazu, beides grob.
 */

export interface DiagnoseUmgebung {
    /** Das laufende Release (`RELEASE_ID`), höchstens 64 Zeichen. */
    release: string;
    /** Die Browserfamilie aus dem User-Agent (`browserArt`). */
    browser: string;
}

interface Zeile {
    signatur: string;
    diagnose: ClientFehlerDiagnose;
}

/** Gleiche Diagnose, gleiche Signatur: Alles, was gespeichert wird, geht ein, sonst nichts. */
export function signaturVon(diagnose: ClientFehlerDiagnose, umgebung: DiagnoseUmgebung): string {
    return createHash("sha256")
        .update(
            JSON.stringify([
                diagnose.art,
                diagnose.name,
                diagnose.meldung,
                diagnose.stellen,
                diagnose.grafik ?? "",
                umgebung.release,
                umgebung.browser,
            ]),
        )
        .digest("hex")
        .slice(0, 32);
}

/** Bereinigt, was vom Draht kommt, und fasst Gleiches zusammen. Rein, ohne Datenbank. */
export function diagnosenAus(roh: readonly ClientFehlerDraht[], umgebung: DiagnoseUmgebung): Zeile[] {
    const zeilen = new Map<string, Zeile>();
    for (const eintrag of roh.slice(0, CLIENT_FEHLER_GRENZEN.jeMeldung)) {
        const diagnose = bereinigeDiagnose(eintrag);
        if (diagnose === undefined) continue;
        const signatur = signaturVon(diagnose, umgebung);
        if (!zeilen.has(signatur)) zeilen.set(signatur, { signatur, diagnose });
    }
    return [...zeilen.values()];
}

/**
 * Speichert die Diagnosen einer Meldung. Eine schon bekannte Signatur zählt hoch; eine neue nur, solange der Tag weniger als
 * `jeTag` verschiedene hat (danach zählt nur noch die Art im Zählpfad). Gibt die Zahl der geschriebenen Zeilen zurück.
 *
 * 🪤 Der Tag kommt aus der Datenbank (`CURRENT_DATE`), wie im Zählpfad: Die Summen und die Diagnosen desselben Fehlers
 * stehen dann am selben Tag.
 */
export async function speichereDiagnosen(
    sql: Queryable,
    roh: readonly ClientFehlerDraht[],
    umgebung: DiagnoseUmgebung,
): Promise<number> {
    const zeilen = diagnosenAus(roh, {
        release: umgebung.release.slice(0, 64),
        browser: umgebung.browser.slice(0, 20),
    });
    let geschrieben = 0;
    for (const { signatur, diagnose } of zeilen) {
        const ergebnis = await sql`
            INSERT INTO client_error_diagnosis (day, signature, kind, name, message, frames, release, browser, graphics)
            SELECT CURRENT_DATE, ${signatur}, ${diagnose.art}, ${diagnose.name}, ${diagnose.meldung},
                   ${diagnose.stellen}::text[], ${umgebung.release.slice(0, 64)}, ${umgebung.browser.slice(0, 20)},
                   ${diagnose.grafik ?? ""}
            WHERE EXISTS (SELECT 1 FROM client_error_diagnosis WHERE day = CURRENT_DATE AND signature = ${signatur})
               OR (SELECT COUNT(*) FROM client_error_diagnosis WHERE day = CURRENT_DATE) < ${CLIENT_FEHLER_GRENZEN.jeTag}
            ON CONFLICT (day, signature) DO UPDATE SET count = client_error_diagnosis.count + 1
            RETURNING signature
        `;
        geschrieben += ergebnis.length;
    }
    return geschrieben;
}

/** Die Frist: Diagnosen älter als `fristTage` fallen weg. Läuft im Takt der Besucherstatistik (`takt.ts`). */
export async function raeumeDiagnosenAuf(sql: Queryable): Promise<number> {
    const weg = await sql`
        DELETE FROM client_error_diagnosis
        WHERE day < CURRENT_DATE - ${CLIENT_FEHLER_GRENZEN.fristTage}::int
        RETURNING day
    `;
    return weg.length;
}

export interface DiagnoseZeile {
    art: string;
    name: string;
    meldung: string;
    stellen: string[];
    release: string;
    browser: string;
    grafik: string;
    anzahl: number;
    zuletzt: string;
}

/** Die häufigsten Diagnosen im Zeitraum (höchstens die Frist), über die Tage zusammengezählt. */
export async function leseDiagnosen(sql: Queryable, tage: number, grenze = 12): Promise<DiagnoseZeile[]> {
    const spanne = Math.max(1, Math.min(CLIENT_FEHLER_GRENZEN.fristTage + 1, Math.round(tage)));
    const zeilen = await sql<
        {
            kind: string;
            name: string;
            message: string;
            frames: string[];
            release: string;
            browser: string;
            graphics: string;
            anzahl: string;
            zuletzt: string;
        }[]
    >`
        SELECT kind, name, message, frames, release, browser, graphics,
               SUM(count)::text AS anzahl, MAX(day)::text AS zuletzt
        FROM client_error_diagnosis
        WHERE day >= CURRENT_DATE - ${spanne - 1}::int
        GROUP BY signature, kind, name, message, frames, release, browser, graphics
        ORDER BY SUM(count) DESC, MAX(day) DESC
        LIMIT ${grenze}
    `;
    return zeilen.map((zeile) => ({
        art: zeile.kind,
        name: zeile.name,
        meldung: zeile.message,
        stellen: zeile.frames,
        release: zeile.release,
        browser: zeile.browser,
        grafik: zeile.graphics,
        anzahl: Math.round(Number(zeile.anzahl)),
        zuletzt: zeile.zuletzt,
    }));
}
