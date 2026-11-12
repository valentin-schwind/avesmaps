import type { MesswerteVerlauf } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Der Verlauf der Serverlast für den Unterreiter „Server“ (WI-0141): 24 h fein, die Tage als Mittel und Spitze, dazu die
 * Wochentafel.
 *
 * 🔴 **Ortszeit, nicht UTC.** Die Frage „wann ist viel los“ meint die Uhr an der Wand. `system_hour` steht in UTC; die
 * Tafel rechnet deshalb in der Zeitzone der Datenbank (`AT TIME ZONE`), wie die Tafel der Besucher.
 *
 * 🔴 **`null` heißt „nie gemessen“, nie 0.** Eine Stunde ohne Stichprobe ist kein ruhiger Server, sondern eine Lücke —
 * eine 0 würde den Mittelwert und das Bild verfälschen.
 */

const zahl = (wert: string | number | null): number | null =>
    wert === null ? null : typeof wert === "number" ? wert : Number(wert);

export async function leseServerVerlauf(sql: Queryable): Promise<MesswerteVerlauf> {
    // 24 h aus den Fünf-Minuten-Fächern; die laufende Stunde ist dabei, denn sie ist das Jetzt.
    const tagZeilen = await sql<
        { zeit: Date; cpu: number | null; load1: number | null; belegt: string | null; gesamt: string | null }[]
    >`
        SELECT bucket AS zeit, cpu, load1, mem_used_bytes::text AS belegt, mem_total_bytes::text AS gesamt
          FROM system_sample
         WHERE bucket >= now() - interval '24 hours'
         ORDER BY bucket
    `.catch(() => []);

    const tageZeilen = await sql<
        { tag: string; cpu: number | null; cpu_max: number | null; ram: string | null; ram_max: string | null }[]
    >`
        SELECT to_char(date_trunc('day', hour), 'YYYY-MM-DD') AS tag,
               AVG(cpu)::real AS cpu, MAX(cpu_max)::real AS cpu_max,
               AVG(mem_used_bytes)::bigint::text AS ram, MAX(mem_max_bytes)::text AS ram_max
          FROM system_hour
         GROUP BY 1
         ORDER BY 1
    `.catch(() => []);

    // Wochentag × Stunde in Ortszeit; `dow` zählt ab Sonntag, die Tafel ab Montag.
    const tafelZeilen = await sql<{ wochentag: string; stunde: string; cpu: number | null }[]>`
        SELECT EXTRACT(dow FROM hour)::text AS wochentag, EXTRACT(hour FROM hour)::text AS stunde, AVG(cpu)::real AS cpu
          FROM system_hour
         GROUP BY 1, 2
    `.catch(() => []);

    const tafel: (number | null)[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => null));
    for (const zeile of tafelZeilen) {
        const zeile7 = (Number(zeile.wochentag) + 6) % 7;
        const stunde = Number(zeile.stunde);
        if (zeile7 >= 0 && zeile7 < 7 && stunde >= 0 && stunde < 24) tafel[zeile7]![stunde] = zeile.cpu;
    }

    const [stunden] = await sql<{ anzahl: string }[]>`SELECT COUNT(*)::text AS anzahl FROM system_hour`.catch(
        () => [] as { anzahl: string }[],
    );

    return {
        tag: tagZeilen.map((zeile) => ({
            zeit: zeile.zeit.toISOString(),
            cpu: zeile.cpu,
            last: zeile.load1,
            ramBelegt: zahl(zeile.belegt),
            ramGesamt: zahl(zeile.gesamt),
        })),
        tage: tageZeilen.map((zeile) => ({
            tag: zeile.tag,
            cpu: zeile.cpu,
            cpuSpitze: zeile.cpu_max,
            ram: zahl(zeile.ram),
            ramSpitze: zahl(zeile.ram_max),
        })),
        tafel,
        stunden: Number(stunden?.anzahl ?? 0),
    };
}
