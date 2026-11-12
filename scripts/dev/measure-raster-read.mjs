// Wie das Domain-Raster aus der Datenbank gelesen wird und wo die Zeit bleibt (WI-0071, Nachtrag 3). NUR LESEND: Die
// Verbindung ist ab dem Start auf `default_transaction_read_only = on` gestellt, alle Anfragen sind SELECT oder EXPLAIN
// (ANALYZE führt nur ein SELECT aus). Es wird nichts geschrieben, kein Dienst angefasst oder neu gestartet; das Skript
// braucht nur das Paket `postgres` und `DATABASE_URL` (eine Leserolle genügt).
//
// Aufruf (von der Wurzel eines Release-Baums oder des Repositorys):
//   node --env-file-if-exists=.env scripts/dev/measure-raster-read.mjs [--sizes 1,4,16] [--runs 2] [--no-rows]
//        [--no-explain] [--whole] [--domain aventuria] [--out datei.json]
//   --sizes   Stückgrößen in MiB, je eine Anfrage je Stück (Vorgabe 1,4,16; der Dienst liest mit 1)
//   --runs    Durchgänge je Größe (Vorgabe 2); „kalt“ ist nur der erste Durchgang der ersten Größe (Cache, wie er gerade ist)
//   --no-rows lässt die Zeilen-Variante aus (alle Stücke als Zeilen EINER Anfrage, die Zeile einmal entpackt, Cursor)
//   --whole   liest zusätzlich die ganze Zeile in einer Anfrage (braucht im Skript rund 3 mal die Zeilengröße an Speicher)
//
// Was es zeigt, in dieser Reihenfolge:
//   Befund   wie die Zeile liegt: komprimiert (`pg_column_compression`) oder nicht, Spaltenart, TOAST-Tabelle, Einstellungen
//            des Servers, Verbindung (Unix-Socket oder TCP, TLS), Antwortzeit einer leeren Anfrage
//   Scheiben die Zeit je Stück (Mittel, Median, p95, erstes gegen letztes Viertel) für jede Größe, ganz wie der Dienst es
//            liest, dazu dieselben Stücke nur am Server (`octet_length(substring(…))`, ohne Übertragung). Wächst die Zeit
//            mit dem Offset (letztes Viertel viel größer als das erste), entpackt jedes Stück alles vor sich.
//   Zeilen   dasselbe Lesen als EINE Anfrage; die Bytes werden gegen die Scheiben und gegen `md5(samples)` am Server geprüft
//   Zeile    die ganze Zeile am Server (`get_byte`, entpackt alles ohne Übertragung), mit --whole auch übertragen
//   Plan     `EXPLAIN (ANALYZE, BUFFERS)` eines Stücks von 1 MiB am Anfang, in der Mitte und am Ende, und der Zeilen-Anfrage:
//            `shared hit`/`read` zeigen, ob aus dem Cache oder von der Platte gelesen wird
// Ein „kalter“ Lauf ist nur der erste Durchgang der ersten Größe; wer die Platte prüfen will, leert vorher den Cache des
// Betriebssystems (das ist seine Entscheidung, das Skript tut es nicht).
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import postgres from "postgres";

const MiB = 1024 * 1024;
const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : fallback;
};
const sizes = valueOf("--sizes", "1,4,16")
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
const runs = Math.max(1, Number(valueOf("--runs", "2")));
const domain = valueOf("--domain", "aventuria");
const out = valueOf("--out", undefined);
const withRows = !args.includes("--no-rows");
const withExplain = !args.includes("--no-explain");
const withWhole = args.includes("--whole");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt (--env-file-if-exists=.env)");

const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
    // Der Server lehnt jede Schreibanweisung dieser Sitzung ab.
    connection: { default_transaction_read_only: "on", application_name: "measure-raster-read" },
});

const results = [];
const print = (name, data = {}) => {
    results.push({ name, ...data });
    const text = Object.entries(data)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join("  ");
    process.stdout.write(`${name.padEnd(44)} ${text}\n`);
};
/** Eine Messung, die auch scheitern darf (fehlende Rechte, ältere Version): Der Rest läuft weiter. */
const attempt = async (name, work) => {
    try {
        return await work();
    } catch (error) {
        print(name, { fehler: `${error.code ?? ""} ${String(error.message).slice(0, 160)}`.trim() });
        return undefined;
    }
};
const now = () => performance.now();
const round = (value, digits = 1) => Number(value.toFixed(digits));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

/** Die Zeiten je Stück: Mittel, Median, p95, Maximum, erstes und letztes Viertel und das Wachstum dazwischen. */
function stats(times, wholeMs, bytes) {
    const sorted = [...times].sort((a, b) => a - b);
    const quarter = Math.max(1, Math.floor(times.length / 4));
    const first = mean(times.slice(0, quarter));
    const last = mean(times.slice(-quarter));
    return {
        stuecke: times.length,
        gesamt_ms: Math.round(wholeMs),
        mittel_ms: round(mean(times)),
        median_ms: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
        p95_ms: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0),
        max_ms: round(sorted.at(-1) ?? 0),
        erstes_viertel_ms: round(first),
        letztes_viertel_ms: round(last),
        wachstum: round(last / Math.max(first, 0.001), 2),
        MiB_je_s: round(bytes / MiB / Math.max(wholeMs / 1000, 0.001)),
    };
}

// ---------------------------------------------------------------------------------------------------------------- Befund
const [raster] = await sql`
    SELECT t.fingerprint, d.revision, t.size FROM terrain_domain_raster t
    JOIN terrain_dem d ON d.map_domain_id = t.map_domain_id AND d.domain_fingerprint = t.fingerprint
    WHERE t.map_domain_id = ${domain} AND d.is_current
    ORDER BY d.is_current DESC, t.derived_at DESC, d.created_at DESC LIMIT 1
`;
if (!raster) {
    print("Befund: kein Raster", { domain });
    await sql.end();
    process.exit(0);
}
const { fingerprint } = raster;
const total = raster.size * raster.size * 2;
print("Befund: Raster", {
    fingerprint: String(fingerprint).slice(0, 12),
    revision: raster.revision,
    seitenlaenge: raster.size,
    MiB: total / MiB,
});

const layout = await attempt("Befund: Ablage", async () => {
    const [row] = await sql`
        SELECT pg_column_size(samples) AS gespeichert, octet_length(samples) AS roh
        FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
    `;
    // `pg_column_compression` gibt es seit PostgreSQL 14: Wo es fehlt, entscheidet der Größenvergleich allein.
    const kind = await sql`
        SELECT pg_column_compression(samples) AS verfahren
        FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
    `.then(
        (rows) => rows[0]?.verfahren ?? null,
        () => undefined,
    );
    const compressed = row.gespeichert < row.roh;
    print("Befund: Ablage", {
        gespeichert_MiB: round(row.gespeichert / MiB),
        roh_MiB: round(row.roh / MiB),
        komprimiert: compressed ? `JA (${String(kind ?? "?")})` : "nein",
        urteil: compressed
            ? "KOMPRIMIERT: jedes Stück entpackt alles vor sich (Zeit wächst mit dem Offset)"
            : "unkomprimiert: ein Stück kostet unabhängig vom Offset gleich viel",
    });
    return { compressed };
});
await attempt("Befund: Spalte", async () => {
    const [row] = await sql`
        SELECT attstorage AS speicherart, attcompression AS verfahren FROM pg_attribute
        WHERE attrelid = 'terrain_domain_raster'::regclass AND attname = 'samples'
    `;
    print("Befund: Spalte", {
        speicherart: `${row.speicherart} (e = EXTERNAL, x = EXTENDED)`,
        verfahren: row.verfahren || "-",
    });
});
await attempt("Befund: Raster der Tabelle", async () => {
    const rows = await sql`
        SELECT size, count(*)::int AS zeilen, round(sum(octet_length(samples)) / 1048576.0) AS roh_mib,
            round(sum(pg_column_size(samples)) / 1048576.0) AS gespeichert_mib
        FROM terrain_domain_raster GROUP BY size ORDER BY size
    `;
    for (const row of rows) print("Befund: Raster der Tabelle", { ...row });
});
await attempt("Befund: TOAST-Tabelle", async () => {
    const [row] = await sql`
        SELECT c.reltoastrelid::regclass::text AS toast, round(pg_relation_size(c.reltoastrelid) / 1048576.0) AS toast_mib,
            round(pg_relation_size(i.indexrelid) / 1048576.0) AS index_mib, s.n_live_tup, s.n_dead_tup, s.last_autovacuum
        FROM pg_class c
        LEFT JOIN pg_index i ON i.indrelid = c.reltoastrelid
        LEFT JOIN pg_stat_all_tables s ON s.relid = c.reltoastrelid
        WHERE c.oid = 'terrain_domain_raster'::regclass
    `;
    print("Befund: TOAST-Tabelle", { ...row, last_autovacuum: String(row.last_autovacuum ?? "-") });
});
await attempt("Befund: Server", async () => {
    const names = [
        "shared_buffers",
        "effective_cache_size",
        "effective_io_concurrency",
        "random_page_cost",
        "jit",
        "track_io_timing",
        "bytea_output",
        "default_toast_compression",
        "work_mem",
    ];
    const rows = await sql`SELECT name, setting, unit FROM pg_settings WHERE name IN ${sql(names)} ORDER BY name`;
    const [version] = await sql`SELECT version() AS v`;
    print("Befund: Server", { version: String(version.v).slice(0, 60) });
    print(
        "Befund: Einstellungen",
        Object.fromEntries(rows.map((row) => [row.name, `${row.setting}${row.unit ?? ""}`])),
    );
});
await attempt("Befund: Verbindung", async () => {
    const [row] = await sql`
        SELECT inet_server_addr()::text AS adresse, current_user AS rolle,
            (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls
    `;
    print("Befund: Verbindung", { adresse: row.adresse ?? "Unix-Socket", rolle: row.rolle, tls: String(row.tls) });
});
await attempt("Befund: leere Anfrage", async () => {
    const times = [];
    for (let run = 0; run < 40; run += 1) {
        const at = now();
        await sql`SELECT 1`;
        times.push(now() - at);
    }
    times.sort((a, b) => a - b);
    print("Befund: leere Anfrage", { median_ms: round(times[20] ?? 0, 2), p95_ms: round(times[38] ?? 0, 2) });
});

// -------------------------------------------------------------------------------------------------------------- Scheiben
/** Alle Stücke von `n` Byte, je eine Anfrage; `serverOnly` liest sie, schickt aber nur ihre Länge. */
async function timeSlices(n, serverOnly, into) {
    const times = [];
    const began = now();
    for (let offset = 0; offset < total; offset += n) {
        const length = Math.min(n, total - offset);
        const at = now();
        if (serverOnly) {
            await sql`
                SELECT octet_length(substring(samples FROM ${offset + 1} FOR ${length})) AS part
                FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
            `;
        } else {
            const [row] = await sql`
                SELECT substring(samples FROM ${offset + 1} FOR ${length}) AS part
                FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
            `;
            if (row?.part?.length !== length)
                throw new Error(
                    `Stück bei ${String(offset)} hat ${String(row?.part?.length)} statt ${String(length)} Byte`,
                );
            into?.set(row.part, offset);
        }
        times.push(now() - at);
    }
    return stats(times, now() - began, total);
}

const buffer = new Uint8Array(total);
const md5Of = (bytes) => createHash("md5").update(bytes).digest("hex");
let sliceMd5;
for (const size of sizes) {
    const n = Math.round(size * MiB);
    for (let run = 1; run <= runs; run += 1) {
        const label = `Scheiben ${String(size)} MiB, Durchgang ${String(run)}${run === 1 && size === sizes[0] ? " (erste Messung überhaupt)" : ""}`;
        const measured = await attempt(label, () => timeSlices(n, false, run === 1 ? buffer : undefined));
        if (measured) {
            print(label, measured);
            if (run === 1 && sliceMd5 === undefined) sliceMd5 = md5Of(buffer);
        }
    }
    const server = await attempt(`Scheiben ${String(size)} MiB nur Server`, () => timeSlices(n, true));
    if (server) print(`Scheiben ${String(size)} MiB nur Server`, server);
}

// ---------------------------------------------------------------------------------------------------------------- Zeilen
const rowsText = (n) => `
    SELECT i, substring(r.v, i * ${String(n)} + 1, ${String(n)}) AS part
    FROM (SELECT substring(samples, 1) AS v FROM terrain_domain_raster WHERE map_domain_id = $1 AND fingerprint = $2 OFFSET 0) r,
        generate_series(0, ${String(Math.ceil(total / n) - 1)}) AS i`;
if (withRows) {
    for (const size of sizes.filter((value) => value <= 8)) {
        const n = Math.round(size * MiB);
        for (let run = 1; run <= runs; run += 1) {
            const label = `Zeilen ${String(size)} MiB (eine Anfrage), Durchgang ${String(run)}`;
            await attempt(label, async () => {
                const gaps = [];
                const target = new Uint8Array(total);
                let received = 0;
                let last = now();
                const began = last;
                await sql.unsafe(rowsText(n), [domain, fingerprint]).cursor(1, (rows) => {
                    for (const row of rows) {
                        target.set(row.part, Number(row.i) * n);
                        received += row.part.length;
                        const at = now();
                        gaps.push(at - last);
                        last = at;
                    }
                });
                const measured = stats(gaps, now() - began, total);
                print(label, { ...measured, bytes_ok: received === total, md5: md5Of(target).slice(0, 12) });
            });
        }
    }
}
await attempt("Zeile: md5 am Server", async () => {
    const at = now();
    const [row] =
        await sql`SELECT md5(samples) AS md5 FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}`;
    print("Zeile: md5 am Server", {
        ms: Math.round(now() - at),
        md5: String(row.md5).slice(0, 12),
        gleich_wie_scheiben: sliceMd5 === undefined ? "?" : String(row.md5 === sliceMd5),
    });
});
for (const pass of ["erste Messung", "wieder"]) {
    await attempt(`Zeile: ganz am Server (${pass})`, async () => {
        const at = now();
        await sql`SELECT get_byte(samples, 0) AS b FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}`;
        print(`Zeile: ganz am Server (${pass})`, {
            ms: Math.round(now() - at),
            hinweis: "entpackt alles, ohne Übertragung",
        });
    });
}
if (withWhole) {
    await attempt("Zeile: ganz übertragen", async () => {
        const at = now();
        const [row] =
            await sql`SELECT samples FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}`;
        const usage = process.memoryUsage();
        print("Zeile: ganz übertragen", {
            ms: Math.round(now() - at),
            bytes_ok: row.samples.length === total,
            rss_MiB: round(usage.rss / MiB),
            arrayBuffers_MiB: round(usage.arrayBuffers / MiB),
        });
    });
}

// ------------------------------------------------------------------------------------------------------------------ Plan
if (withExplain) {
    const explain = async (label, text, params) => {
        // `SERIALIZE` (PostgreSQL 17) zählt die Umwandlung der Ausgabe mit; ältere Server nehmen die Anfrage ohne.
        for (const options of ["ANALYZE, BUFFERS, SERIALIZE", "ANALYZE, BUFFERS"]) {
            try {
                const plan = await sql.unsafe(`EXPLAIN (${options}) ${text}`, params);
                process.stdout.write(`Plan: ${label} (${options})\n`);
                for (const line of plan) process.stdout.write(`    ${String(line["QUERY PLAN"])}\n`);
                results.push({ name: `Plan: ${label}`, zeilen: plan.map((line) => String(line["QUERY PLAN"])) });
                return;
            } catch (error) {
                if (options === "ANALYZE, BUFFERS")
                    print(`Plan: ${label}`, { fehler: String(error.message).slice(0, 160) });
            }
        }
    };
    const one =
        "SELECT substring(samples FROM $1 FOR $2) AS part FROM terrain_domain_raster WHERE map_domain_id = $3 AND fingerprint = $4";
    for (const [label, offset] of [
        ["Stück am Anfang", 0],
        ["Stück in der Mitte", Math.floor(total / 2 / MiB) * MiB],
        ["Stück am Ende", total - MiB],
    ]) {
        await explain(`${label} (1 MiB ab ${String(offset / MiB)} MiB)`, one, [offset + 1, MiB, domain, fingerprint]);
    }
    if (withRows) await explain("alle Stücke als Zeilen (1 MiB)", rowsText(MiB), [domain, fingerprint]);
}

const summary = layout?.compressed
    ? "Die Zeile ist komprimiert: Wächst die Zeit je Stück mit dem Offset, ist das die Ursache; die Zeilen-Variante und ein unkomprimiertes Neuschreiben der Zeile umgehen sie."
    : "Die Zeile ist unkomprimiert: Bleibt die Zeit je Stück über den Offset gleich, liegt sie in der Platte, im Cache oder auf der Leitung (siehe Plan: shared read gegen hit).";
process.stdout.write(`\n${summary}\n`);
if (out) writeFileSync(out, `${JSON.stringify({ domain, fingerprint, total, results }, null, 2)}\n`);
await sql.end();
