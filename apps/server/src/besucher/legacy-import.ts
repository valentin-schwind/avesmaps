import { readFile } from "node:fs/promises";
import type { Queryable } from "../database.ts";

/**
 * Legacys Messreihe als Vorgeschichte übernehmen (WI-0138 V14, BESUCH-0001 §12; Betreiber 2026-10-12: „übertrage die daten bis zu
 * production“).
 *
 * Quelle ist der Abzug `api/app/visitor-metrics.php?days=3660&actor=<sorte>`, abgelegt unter
 * `project-control/discovery/legacy-nutzung-2026-10-12/`. Übernommen wird, was **tagesgenau** darin steht:
 *
 * | Legacy | bei uns |
 * |---|---|
 * | `daily[].views` | `pageview`, Sorte der Datei, Stunde 24 |
 * | `daily[].uniques` | `unique` |
 * | `daily[].routes` | `route` |
 * | `daily[].editors` | `unique`, Sorte `editor` |
 *
 * 🔴 **Nicht übernommen wird, was keinen Tag trägt**: die Tafel der aktivsten Zeiten (dort nur Wochentag × Stunde über den ganzen
 * Zeitraum), die Verweildauer und alle Ausprägungslisten (Herkunft, Geräte, Reisemittel …). Sie auf einen Tag zu buchen wäre
 * erfunden. Wer sie tagesgenau will, braucht den Rohexport der Tabelle `visitor_metric` — er steht noch aus.
 *
 * 🔴 **Nichts wird überschrieben.** `ON CONFLICT DO NOTHING`: Ein zweiter Lauf ändert nichts, und eine Zeile, die unsere eigene
 * Zählung schon geschrieben hat, bleibt stehen. Der Import ist damit beliebig oft wiederholbar.
 */

interface LegacyAbzug {
    actor?: string;
    metrics?: {
        daily?: {
            day: string;
            views: string | number;
            uniques: string | number;
            routes: string | number;
            editors: string | number;
        }[];
    };
}

export interface ImportErgebnis {
    sorte: string;
    tage: number;
    zeilen: number;
    geschrieben: number;
    von: string;
    bis: string;
}

const zahl = (wert: string | number | undefined): number => {
    const roh = Number(wert ?? 0);
    return Number.isFinite(roh) && roh > 0 ? Math.round(roh) : 0;
};

/** Welche Zeilen ein Abzug ergibt. Rein, ohne Datenbank, damit ein Test sie ohne Cluster prüft. */
export function zeilenAusAbzug(
    abzug: LegacyAbzug,
): { day: string; hour: number; actor_type: string; metric: string; dimension: string; count: number }[] {
    const sorte = abzug.actor === "editor" ? "editor" : "visitor";
    const zeilen: {
        day: string;
        hour: number;
        actor_type: string;
        metric: string;
        dimension: string;
        count: number;
    }[] = [];
    for (const tag of abzug.metrics?.daily ?? []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tag.day)) continue;
        const werte: [string, string, number, boolean][] = [
            [sorte, "pageview", zahl(tag.views), false],
            [sorte, "unique", zahl(tag.uniques), false],
            [sorte, "route", zahl(tag.routes), false],
            // 🪤 `editors` steht in JEDEM Abzug, auch im Editorabzug - dort wäre es dieselbe Zahl ein zweites Mal.
            ["editor", "unique", zahl(tag.editors), true],
        ];
        for (const [actor, metric, count, ausEditorsSpalte] of werte) {
            if (ausEditorsSpalte && sorte === "editor") continue;
            if (count > 0) zeilen.push({ day: tag.day, hour: 24, actor_type: actor, metric, dimension: "", count });
        }
    }
    return zeilen;
}

export async function importiereLegacyAbzug(sql: Queryable, pfad: string): Promise<ImportErgebnis> {
    const abzug = JSON.parse(await readFile(pfad, "utf8")) as LegacyAbzug;
    const zeilen = zeilenAusAbzug(abzug);
    const tage = abzug.metrics?.daily ?? [];
    if (zeilen.length === 0) {
        return { sorte: abzug.actor ?? "visitor", tage: 0, zeilen: 0, geschrieben: 0, von: "", bis: "" };
    }
    let geschrieben = 0;
    // In Blöcken, damit eine große Reihe nicht an der Zahl der Parameter scheitert.
    for (let anfang = 0; anfang < zeilen.length; anfang += 500) {
        const block = zeilen.slice(anfang, anfang + 500);
        const ergebnis = await sql`
            INSERT INTO visitor_metric ${sql(block, "day", "hour", "actor_type", "metric", "dimension", "count")}
            ON CONFLICT (day, hour, actor_type, metric, dimension) DO NOTHING
            RETURNING day
        `;
        geschrieben += ergebnis.length;
    }
    return {
        sorte: abzug.actor ?? "visitor",
        tage: tage.length,
        zeilen: zeilen.length,
        geschrieben,
        von: tage[0]?.day ?? "",
        bis: tage.at(-1)?.day ?? "",
    };
}
