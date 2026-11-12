import { parseArgs } from "node:util";
import postgres from "postgres";
import { loadConfig } from "../config.ts";
import type { Queryable } from "../database.ts";
import { assetDetail } from "../media-editor/detail.ts";
import { galleryList } from "../media-editor/gallery.ts";
import { mediaNavigation, photoboxStapel, searchMedia } from "../media-editor/search.ts";
import { typeImageList } from "../media-editor/type-images.ts";
import { usageOf } from "../media-editor/usage.ts";

/**
 * Laufzeiten der Lesewege der Medienverwaltung am echten Bestand (WI-0068 R8, Arbeitsanweisung: „reale Query-Latenzen mit
 * `EXPLAIN (ANALYZE, BUFFERS)` bei bestehender Medienmenge (keine Indexe auf Verdacht)“).
 *
 *   npm run media:messung [-- --runden <n>] [--fall <Teil des Namens>] [--voll]   (--voll druckt die ganzen Pläne)
 *
 * 🔴 Liest nur: jeder Fall läuft in einer eigenen `READ ONLY`-Transaktion, ebenso jedes `EXPLAIN ANALYZE` (es führt die Abfrage aus,
 * schreibt aber nichts). Gemessen werden die Funktionen, die auch die Routen rufen; die Abfragen fängt die Verbindung selbst ab
 * (`debug`), damit der Plan genau die gesendete Abfrage mit ihren Werten zeigt. Ausgabe je Fall: Median und Höchstwert der Laufzeit,
 * Zahl der Abfragen, je Abfrage die Ausführungszeit des Plans und Tafeln mit sequentiellem Lesen.
 */
const { values } = parseArgs({
    options: {
        runden: { type: "string", default: "7" },
        fall: { type: "string" },
        voll: { type: "boolean", default: false },
    },
});
const runden = Number(values.runden);
if (!Number.isInteger(runden) || runden < 1) {
    console.error("--runden braucht eine ganze Zahl größer als 0");
    process.exit(2);
}
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

interface Gefangen {
    query: string;
    parameters: unknown[];
}
let gefangen: Gefangen[] = [];
const sql = postgres(config.databaseUrl, {
    max: 1,
    onnotice: () => {},
    debug: (_verbindung, query, parameters) => {
        gefangen.push({ query, parameters: parameters as unknown[] });
    },
});

const nurLesen = <T>(arbeit: (tx: Queryable) => Promise<T>): Promise<T> =>
    sql.begin("READ ONLY", (tx) => arbeit(tx as unknown as Queryable)) as Promise<T>;

try {
    const [bestand] = await sql<{ assets: number; dateien: number; verwendungen: number }[]>`
        SELECT (SELECT count(*)::int FROM media_asset) AS assets, (SELECT count(*)::int FROM media_file) AS dateien,
               (SELECT count(*)::int FROM media_gallery_item WHERE retired_at IS NULL) AS verwendungen
    `;
    // Ein Werk mit vielen Verwendungen, damit Reverse Usage und Inspector nicht am leichtesten Fall gemessen werden.
    const [viel] = await sql<{ id: string }[]>`
        SELECT a.public_id::text AS id FROM media_asset a
          JOIN media_gallery_item i ON i.media_asset_id = a.id AND i.retired_at IS NULL
         GROUP BY a.public_id ORDER BY count(*) DESC, a.public_id LIMIT 1
    `;
    console.log(
        `Bestand: ${String(bestand?.assets)} Werke, ${String(bestand?.dateien)} Dateizeilen, ${String(bestand?.verwendungen)} Galerieeinträge; ${String(runden)} Runden je Fall\n`,
    );
    const faelle: [string, (tx: Queryable) => Promise<unknown>][] = [
        // Der Korb „PhotoBox-Uploads“ (WI-0272 S3); die Route verlangt `view_media_private`, hier misst Claudio ihn ohne Probezugang.
        ["Reisebilder: Stapel", (tx) => photoboxStapel(tx)],
        ["Liste: Vorgabe (Name, 100)", (tx) => searchMedia(tx, { sort: "name", limit: 100, offset: 0 })],
        [
            "Liste: Korb Rechte offen",
            (tx) => searchMedia(tx, { sort: "name", limit: 100, offset: 0, basket: "rights_open" }),
        ],
        [
            "Liste: Korb fehlende Derivate",
            (tx) => searchMedia(tx, { sort: "name", limit: 100, offset: 0, basket: "missing_derivative" }),
        ],
        ["Liste: Freitext „Gareth“", (tx) => searchMedia(tx, { sort: "name", limit: 100, offset: 0, q: "Gareth" })],
        ["Liste: nach Verwendung", (tx) => searchMedia(tx, { sort: "usage", limit: 100, offset: 0 })],
        ["Navigation (Zahlen)", (tx) => mediaNavigation(tx)],
        ["Typbilder", (tx) => typeImageList(tx)],
        ["Galerien", (tx) => galleryList(tx, { limit: 100, offset: 0 })],
        ...(viel === undefined
            ? []
            : ([
                  ["Reverse Usage (meistverwendet)", (tx: Queryable) => usageOf(tx, viel.id)],
                  ["Inspector (meistverwendet)", (tx: Queryable) => assetDetail(tx, viel.id)],
              ] as [string, (tx: Queryable) => Promise<unknown>][])),
    ];
    for (const [name, fall] of faelle) {
        if (values.fall !== undefined && !name.toLowerCase().includes(values.fall.toLowerCase())) continue;
        const zeiten: number[] = [];
        let abfragen: Gefangen[] = [];
        try {
            for (let runde = 0; runde < runden; runde += 1) {
                gefangen = [];
                const start = performance.now();
                await nurLesen(fall);
                zeiten.push(performance.now() - start);
                abfragen = gefangen.filter((eintrag) => /^\s*(SELECT|WITH)\b/iu.test(eintrag.query));
            }
        } catch (error) {
            console.log(
                `${name.padEnd(32)} FEHLER ${error instanceof Error ? error.message.slice(0, 100) : "unbekannt"}`,
            );
            continue;
        }
        zeiten.sort((a, b) => a - b);
        const plaene: string[] = [];
        for (const abfrage of abfragen) {
            try {
                const zeilen = await nurLesen((tx) =>
                    (tx as unknown as postgres.Sql).unsafe(
                        `EXPLAIN (ANALYZE, BUFFERS) ${abfrage.query}`,
                        abfrage.parameters as postgres.ParameterOrJSON<never>[],
                    ),
                );
                const text = (zeilen as unknown as Record<string, string>[]).map((zeile) => zeile["QUERY PLAN"] ?? "");
                const ms = text.find((zeile) => zeile.startsWith("Execution Time"))?.match(/([\d.]+) ms/u)?.[1] ?? "?";
                const sequentiell = [
                    ...new Set(text.flatMap((zeile) => [...zeile.matchAll(/Seq Scan on (\w+)/gu)].map((m) => m[1]))),
                ];
                plaene.push(
                    values.voll
                        ? text.join("\n    ")
                        : `${ms} ms${sequentiell.length > 0 ? ` [sequentiell: ${sequentiell.join(", ")}]` : ""}`,
                );
            } catch (error) {
                plaene.push(`kein Plan (${error instanceof Error ? error.message.slice(0, 60) : "unbekannt"})`);
            }
        }
        const median = zeiten[Math.floor(zeiten.length / 2)] ?? 0;
        const hoechst = zeiten[zeiten.length - 1] ?? 0;
        console.log(
            `${name.padEnd(32)} Median ${median.toFixed(0).padStart(5)} ms · höchstens ${hoechst.toFixed(0).padStart(5)} ms · ${String(abfragen.length)} Abfragen`,
        );
        for (const plan of plaene) console.log(`    ${plan}`);
    }
} finally {
    await sql.end({ timeout: 5 });
}
