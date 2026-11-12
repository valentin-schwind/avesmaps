// Das Messwerkzeug der Infopanel-Antworten (Qualitätsreview 2026-10-12, Plan C5; Claudios Hotspots §3 seines Handovers
// `2026-10-12-qualitaetsreview-claudio-ergebnis.md`): wie lange `/api/subjects/<art>/<id>` braucht, je Art, auf FESTEN Gegenständen.
//
// 🔴 ES SCHREIBT NICHTS. Es liest die Kennungen der Gegenstände read-only aus der Datenbank und ruft danach nur GET-Routen auf.
// Die Auswahl ist deterministisch (feste Reihenfolge, feste Grenzen), damit „vorher" und „nachher" dieselben Gegenstände treffen.
//
// Aufruf:
//   node --env-file-if-exists=.env scripts/dev/measure-subjects.mjs [--api http://127.0.0.1:3000] [--runs 7] [--warmup 2]
//        [--arten area,path,place,territory] [--je 5] [--out datei.json]
//   --api     Grundadresse der API (lokal 3000; Claudio auf der Stage 127.0.0.1:3100)
//   --runs    Messläufe je Gegenstand (Vorgabe 7, Median und p95 daraus)
//   --warmup  Läufe je Gegenstand, die NICHT zählen (Vorgabe 2; der erste Aufruf füllt Pläne und Seitencache)
//   --arten   welche Arten gemessen werden (Vorgabe area,path,place,territory)
//   --je      wie viele Gegenstände je Art (Vorgabe 5): die „schwersten" nach einem festen Maß, siehe AUSWAHL
//   --out     schreibt alle Zahlen als JSON (für den Vorher/Nachher-Vergleich)
//
// AUSWAHL je Art, absteigend nach Gewicht, bei Gleichstand nach `public_id`:
//   area       Regionen mit den meisten gleichnamigen Mitgliedern derselben Art und Ebene (eine Gruppe ist EIN Subject, WI-0047)
//   path       Wegegruppen mit den meisten Abschnitten je Name (Claudios Fall „Reichsstraße 2/3")
//   place      Orte mit den meisten Stätten am Namen (der reiche Fall des Infopanels)
//   territory  Gebiete mit der größten Fläche der Anteile
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
    const at = args.indexOf(flag);
    return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};
const api = valueOf("--api", "http://127.0.0.1:3000").replace(/\/$/u, "");
const runs = Math.max(1, Number(valueOf("--runs", "7")));
const warmup = Math.max(0, Number(valueOf("--warmup", "2")));
const je = Math.max(1, Number(valueOf("--je", "5")));
const arten = valueOf("--arten", "area,path,place,territory").split(",").filter(Boolean);
const out = valueOf("--out", undefined);

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined) {
    console.error("DATABASE_URL fehlt (node --env-file-if-exists=.env davorsetzen).");
    process.exit(2);
}

/** Die Gegenstände je Art, read-only und deterministisch. Jede Abfrage liefert `{ id, name, gewicht }`. */
const AUSWAHL = {
    area: (sql) => sql`
        SELECT id, name, gewicht FROM (
            SELECT DISTINCT ON (lower(btrim(r.name)), r.region_type, r.region_layer)
                   r.public_id::text AS id, r.name,
                   count(*) OVER (PARTITION BY lower(btrim(r.name)), r.region_type, r.region_layer)::int AS gewicht
              FROM region r WHERE r.is_active
             ORDER BY lower(btrim(r.name)), r.region_type, r.region_layer, r.public_id
        ) g ORDER BY gewicht DESC, id LIMIT ${je}
    `,
    // Der Kettenschlüssel der Suche, `name:subtype` (`PathParams` in `routes/subjects.ts`), nicht der Name allein.
    path: (sql) => sql`
        SELECT DISTINCT ON (g.n, g.name, g.subtype) (g.name || ':' || g.subtype) AS id, g.name, g.n AS gewicht
          FROM (SELECT name, subtype, count(*)::int AS n FROM path WHERE is_active GROUP BY 1, 2) g
         ORDER BY g.n DESC, g.name, g.subtype LIMIT ${je}
    `,
    place: (sql) => sql`
        SELECT p.public_id::text AS id, p.name,
               (SELECT count(*)::int FROM settlement_place sp
                 WHERE sp.is_active AND sp.state = 'active' AND sp.settlement_key = lower(btrim(p.name))) AS gewicht
          FROM place p WHERE p.is_active
         ORDER BY gewicht DESC, p.public_id LIMIT ${je}
    `,
    territory: (sql) => sql`
        SELECT t.public_id::text AS id, t.name, count(c.id)::int AS gewicht
          FROM territory t LEFT JOIN territory_claim c ON c.territory_id = t.id AND c.is_active
         WHERE t.is_active GROUP BY t.id, t.public_id, t.name
         ORDER BY gewicht DESC, t.public_id LIMIT ${je}
    `,
};

const quantil = (werte, anteil) => {
    const sortiert = [...werte].sort((a, b) => a - b);
    const stelle = Math.min(sortiert.length - 1, Math.max(0, Math.ceil(anteil * sortiert.length) - 1));
    return sortiert[stelle];
};
const runde = (wert) => Math.round(wert * 10) / 10;

async function messe(pfad) {
    const zeiten = [];
    let status = 0;
    let bytes = 0;
    for (let lauf = 0; lauf < warmup + runs; lauf += 1) {
        const start = performance.now();
        const antwort = await globalThis.fetch(`${api}${pfad}`, { headers: { "cache-control": "no-cache" } });
        const koerper = await antwort.arrayBuffer();
        const dauer = performance.now() - start;
        status = antwort.status;
        bytes = koerper.byteLength;
        if (lauf >= warmup) zeiten.push(dauer);
    }
    return {
        pfad,
        status,
        bytes,
        p50: runde(quantil(zeiten, 0.5)),
        p95: runde(quantil(zeiten, 0.95)),
        max: runde(Math.max(...zeiten)),
    };
}

const sql = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => undefined });
const ergebnis = { api, runs, warmup, je, gemessen: new Date().toISOString(), arten: {} };
try {
    for (const art of arten) {
        const auswahl = AUSWAHL[art];
        if (auswahl === undefined) {
            console.error(`unbekannte Art: ${art}`);
            continue;
        }
        const gegenstaende = await auswahl(sql);
        const zeilen = [];
        for (const gegenstand of gegenstaende) {
            const pfad = `/api/subjects/${art}/${encodeURIComponent(gegenstand.id)}`;
            zeilen.push({ name: gegenstand.name, gewicht: gegenstand.gewicht, ...(await messe(pfad)) });
        }
        ergebnis.arten[art] = zeilen;
        const alle = zeilen.filter((zeile) => zeile.status === 200);
        console.log(`\n${art}  (${String(alle.length)}/${String(zeilen.length)} mit 200)`);
        console.log("  gewicht  p50 ms  p95 ms  max ms  bytes  name");
        for (const zeile of zeilen) {
            const marke = zeile.status === 200 ? " " : `!${String(zeile.status)}`;
            console.log(
                `  ${String(zeile.gewicht).padStart(7)}  ${String(zeile.p50).padStart(6)}  ${String(zeile.p95).padStart(6)}` +
                    `  ${String(zeile.max).padStart(6)}  ${String(zeile.bytes).padStart(5)}  ${zeile.name ?? ""}${marke}`,
            );
        }
        if (alle.length > 0) {
            console.log(
                `  Klasse: p50 ${String(
                    runde(
                        quantil(
                            alle.map((z) => z.p50),
                            0.5,
                        ),
                    ),
                )} ms,` +
                    ` p95 ${String(
                        runde(
                            quantil(
                                alle.map((z) => z.p95),
                                0.95,
                            ),
                        ),
                    )} ms`,
            );
        }
    }
} finally {
    await sql.end({ timeout: 5 });
}
if (out !== undefined) {
    writeFileSync(out, `${JSON.stringify(ergebnis, null, 2)}\n`, "utf8");
    console.log(`\ngeschrieben: ${out}`);
}
