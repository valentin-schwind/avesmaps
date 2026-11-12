import { STICHPROBE_HALTEN_MS, STICHPROBE_MS, type SystemVerlaufPunkt } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { cpuAnteil } from "../routes/messwerte.ts";
import { osMesswerte, type OsMesswerte } from "./messwerte.ts";
import { isMissingTable } from "./state-row.ts";

/**
 * Der Verlauf über 24 h (WI-0127 SYS-8, SYS-0001 §3.7, Migration 0101): Jede Instanz schreibt alle 5 min eine Stichprobe in
 * `system_sample` (`INSERT … ON CONFLICT DO NOTHING`: Zwei Instanzen im Blue/Green schreiben eine Zeile) und löscht im selben Zug, was
 * älter als 25 h ist. `NULL` heißt „nicht messbar“, nie 0. Fehlt die Tafel (vor 0101), schreibt sie nichts und meldet nichts.
 */

/** Der Anfang des 5-Minuten-Fachs, in dem `at` liegt. */
export const bucketVon = (at: Date): Date => new Date(Math.floor(at.getTime() / STICHPROBE_MS) * STICHPROBE_MS);

export async function schreibeStichprobe(
    db: Queryable,
    werte: OsMesswerte,
    at: Date,
    cpu: number | null = null,
): Promise<boolean> {
    try {
        const rows = await db<{ bucket: Date }[]>`
            INSERT INTO system_sample (bucket, load1, mem_used_bytes, mem_total_bytes, swap_used_bytes, cpu)
            VALUES (${bucketVon(at)}, ${werte.last?.eins ?? null}, ${werte.speicher.belegt}, ${werte.speicher.gesamt},
                    ${werte.speicher.auslagerung}, ${cpu})
            ON CONFLICT (bucket) DO NOTHING
            RETURNING bucket
        `;
        // 🔴 Verdichten VOR dem Löschen: Was die 25-Stunden-Grenze wegnimmt, muss vorher in der Stunde stehen, sonst
        // reißt der lange Verlauf jedes Mal 25 Stunden hinter der Gegenwart ab (WI-0141).
        await verdichteStunden(db, at);
        await db`DELETE FROM system_sample WHERE bucket < ${new Date(at.getTime() - STICHPROBE_HALTEN_MS)}`;
        return rows.length > 0;
    } catch (error) {
        if (isMissingTable(error)) return false;
        throw error;
    }
}

/** So lange bleibt eine verdichtete Stunde stehen (WI-0141): drei Monate zeigen Woche, Monat und die Spitzen davor. */
export const STUNDEN_HALTEN_MS = 90 * 24 * 3_600_000;

/**
 * Schreibt die abgeschlossenen Stunden aus `system_sample` nach `system_hour` und räumt dort auf.
 *
 * Nur **volle** Stunden: Die laufende ist noch nicht fertig, und ein Mittel über zehn Minuten wäre eine andere Zahl als
 * das über sechzig. Wiederholbar — dieselbe Stunde wird neu gerechnet, nicht addiert (`ON CONFLICT DO UPDATE`), damit
 * zwei Instanzen und ein zweiter Lauf dasselbe Ergebnis liefern.
 */
export async function verdichteStunden(db: Queryable, now: Date): Promise<number> {
    try {
        const rows = await db<{ hour: Date }[]>`
            INSERT INTO system_hour (hour, proben, cpu, cpu_max, load1, load1_max, mem_used_bytes, mem_max_bytes,
                                     mem_total_bytes)
            SELECT date_trunc('hour', bucket) AS hour, COUNT(*)::int,
                   AVG(cpu)::real, MAX(cpu)::real,
                   AVG(load1), MAX(load1),
                   AVG(mem_used_bytes)::bigint, MAX(mem_used_bytes), MAX(mem_total_bytes)
              FROM system_sample
             WHERE bucket < date_trunc('hour', ${now}::timestamptz)
             GROUP BY 1
            ON CONFLICT (hour) DO UPDATE SET
                proben = EXCLUDED.proben, cpu = EXCLUDED.cpu, cpu_max = EXCLUDED.cpu_max,
                load1 = EXCLUDED.load1, load1_max = EXCLUDED.load1_max,
                mem_used_bytes = EXCLUDED.mem_used_bytes, mem_max_bytes = EXCLUDED.mem_max_bytes,
                mem_total_bytes = EXCLUDED.mem_total_bytes
            RETURNING hour
        `;
        await db`DELETE FROM system_hour WHERE hour < ${new Date(now.getTime() - STUNDEN_HALTEN_MS)}`;
        return rows.length;
    } catch (error) {
        if (isMissingTable(error)) return 0;
        throw error;
    }
}

/** Die Stichproben der letzten 24 h, älteste zuerst; ohne Tafel leer. */
export async function leseVerlauf(db: Queryable, now: Date): Promise<SystemVerlaufPunkt[]> {
    try {
        const rows = await db<
            { bucket: Date; load1: number | null; mem_used_bytes: string | null; swap_used_bytes: string | null }[]
        >`
            SELECT bucket, load1, mem_used_bytes::text, swap_used_bytes::text FROM system_sample
             WHERE bucket >= ${new Date(now.getTime() - 24 * 3_600_000)}
             ORDER BY bucket
        `;
        return rows.map((row) => ({
            bucket: row.bucket.toISOString(),
            last1: row.load1,
            belegt: row.mem_used_bytes === null ? null : Number(row.mem_used_bytes),
            auslagerung: row.swap_used_bytes === null ? null : Number(row.swap_used_bytes),
        }));
    } catch (error) {
        if (isMissingTable(error)) return [];
        throw error;
    }
}

export interface Stichprobe {
    start(): void;
    close(): void;
}

/**
 * Der Takt je Instanz: sofort eine Stichprobe, dann zu jedem neuen 5-Minuten-Fach. Ein Fehler (Datenbank weg) kostet eine Zeile im
 * Protokoll und diese Stichprobe, nie den Prozess.
 */
export function createStichprobe(options: {
    database: Queryable;
    log: { warn(object: unknown, message: string): void };
    messen?: () => Promise<OsMesswerte>;
    clock?: () => Date;
    everyMs?: number;
}): Stichprobe {
    const messen = options.messen ?? (() => osMesswerte());
    const clock = options.clock ?? (() => new Date());
    let timer: NodeJS.Timeout | undefined;
    let closed = false;
    // Der CPU-Anteil ist eine Differenz zwischen zwei Messungen (`cpuAnteil`); beim ersten Lauf gibt es ihn nicht.
    let cpuStand: { cpu: ReturnType<typeof process.cpuUsage>; zeit: bigint } | undefined;
    const tick = async (): Promise<void> => {
        try {
            const werte = await messen();
            const { anteil, stand } = cpuAnteil(
                cpuStand,
                { cpu: process.cpuUsage(), zeit: process.hrtime.bigint() },
                werte.kerne ?? 1,
            );
            cpuStand = stand;
            await schreibeStichprobe(options.database, werte, clock(), anteil);
        } catch (error) {
            options.log.warn({ err: error }, "Stichprobe des Systemzustands nicht geschrieben");
        }
    };
    const plan = (): void => {
        if (closed) return;
        const now = clock().getTime();
        const wait = options.everyMs ?? STICHPROBE_MS - (now % STICHPROBE_MS) + 1_000;
        timer = setTimeout(() => {
            void tick().finally(plan);
        }, wait);
        timer.unref();
    };
    return {
        start(): void {
            void tick().finally(plan);
        },
        close(): void {
            closed = true;
            if (timer !== undefined) clearTimeout(timer);
        },
    };
}
