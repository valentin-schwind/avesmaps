// Das Messwerkzeug der Regelauswertung (WI-0257, S1): wie lange `trefferDesEintrags` (Richtung A) und `eintraegeAmPunkt` / `eintraegeAnPunkten` / `eintraegeAnFlaechen` (Richtung B) brauchen, auf dem
// BESTAND der lokalen Datenbank (448 Regeln, 958 Bedingungen). Die Auswertung läuft im Prozess dieses Skripts, ohne HTTP und ohne Fastify.
//
// 🔴 ES SCHREIBT NICHTS. Die Auswertung selbst liest nur; das Skript legt keine Zeile an.
//
// Aufruf (aus der Repo-Wurzel):
//   node --env-file-if-exists=.env scripts/dev/vorkommen-messen.mjs [--runs 15] [--ohne-alle] [--out datei.json]
//   --runs        Läufe je warmer Messung (Vorgabe 15, Median daraus)
//   --ohne-alle   lässt den Lauf über ALLE Einträge mit Regeln aus (sonst: jeder Eintrag kalt, die langsamsten fünf werden genannt)
//   --out         schreibt alle Zahlen als JSON
//
// Ziele (WI-0257 S1): Eintrag kalt unter 500 ms, warm unter 10 ms, ein Punkt unter 20 ms.
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import {
    eintraegeAmPunkt,
    eintraegeAnFlaechen,
    eintraegeAnPunkten,
    leereVorkommenSpeicher,
    trefferDesEintrags,
} from "../../apps/server/src/vorkommen/index.ts";

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
    const at = args.indexOf(flag);
    return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};
const runs = Math.max(3, Number(valueOf("--runs", "15")));
const ohneAlle = args.includes("--ohne-alle");
const out = valueOf("--out", undefined);

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined) {
    console.error("DATABASE_URL fehlt (node --env-file-if-exists=.env davorsetzen).");
    process.exit(2);
}
const sql = postgres(databaseUrl, { max: 3, onnotice: () => {} });

const ms = (zahl) => `${zahl.toFixed(zahl < 10 ? 1 : 0)} ms`;
const median = (liste) => [...liste].sort((a, b) => a - b)[Math.floor(liste.length / 2)] ?? 0;
async function zeit(f) {
    const t0 = performance.now();
    const ergebnis = await f();
    return { ms: performance.now() - t0, ergebnis };
}
/** Warm: der erste Lauf füllt den Zwischenspeicher und zählt nicht; Median der übrigen. */
async function warm(f) {
    await f();
    const liste = [];
    for (let i = 0; i < runs; i += 1) liste.push((await zeit(f)).ms);
    return median(liste);
}
const ziel = (wert, grenze) => (wert < grenze ? "ok" : "ZU LANGSAM");

const zahlen = {};
const zeile = (name, wert, grenze) => {
    zahlen[name] = Number(wert.toFixed(1));
    console.log(
        `${name.padEnd(46)} ${ms(wert).padStart(9)}${grenze === undefined ? "" : `   Ziel unter ${String(grenze)} ms: ${ziel(wert, grenze)}`}`,
    );
};

console.log("— Richtung A: Eintrag → Karte —");
const eintrag = async (name) =>
    (
        await sql`SELECT e.id::text AS id, e.public_id::text AS public_id, e.name FROM lore_entry e WHERE e.is_active AND e.state = 'active' AND e.name = ${name} LIMIT 1`
    )[0];

for (const name of ["Baumdrache", "Wirselkraut", "Schlinger", "Aranische Wassernuss", "Zwiebel"]) {
    const e = await eintrag(name);
    if (e === undefined) {
        console.log(`${name.padEnd(46)} (nicht im Bestand)`);
        continue;
    }
    leereVorkommenSpeicher();
    const kalt = await zeit(() => trefferDesEintrags(sql, e.public_id));
    const treffer = kalt.ergebnis;
    const einzelheiten = (treffer?.regeln ?? []).map((r) => {
        const ganz = r.landschaften.filter((l) => l.schnitt === "ganz").length;
        return `${r.beziehung}: ${String(ganz)} ganz, ${String(r.landschaften.length - ganz)} angeschnitten, ${String(r.siedlungen.length)} Orte, ${String(r.verwaiste)} verwaiste`;
    });
    zeile(`${name} kalt`, kalt.ms, name === "Baumdrache" ? 500 : undefined);
    console.log(`    ${einzelheiten.join(" | ") || "ohne rechenbare Regel"}`);
    if (name === "Baumdrache")
        zeile(`${name} warm (Median)`, await warm(() => trefferDesEintrags(sql, e.public_id)), 10);
}

if (!ohneAlle) {
    const alle = await sql`
        SELECT e.public_id::text AS public_id, e.name, count(r.id)::int AS regeln
          FROM lore_entry e JOIN lore_rule r ON r.lore_entry_id = e.id AND r.is_active AND r.state = 'active'
         WHERE e.is_active AND e.state = 'active' GROUP BY e.id ORDER BY e.id`;
    const zeiten = [];
    for (const e of alle) {
        leereVorkommenSpeicher();
        zeiten.push({
            name: e.name,
            regeln: e.regeln,
            ms: (await zeit(() => trefferDesEintrags(sql, e.public_id))).ms,
        });
    }
    const liste = zeiten.map((z) => z.ms);
    console.log(`\n${String(zeiten.length)} Einträge mit Regeln, jeder kalt (Zwischenspeicher vorher geleert):`);
    zeile("  Median", median(liste));
    zeile("  95. Perzentil", [...liste].sort((a, b) => a - b)[Math.floor(liste.length * 0.95)] ?? 0);
    zeile(
        "  Summe aller (Sekunden × 1000)",
        liste.reduce((a, b) => a + b, 0),
    );
    const langsam = [...zeiten].sort((a, b) => b.ms - a.ms).slice(0, 5);
    zeile("  langsamster", langsam[0]?.ms ?? 0, 500);
    for (const z of langsam) console.log(`    ${z.name} (${String(z.regeln)} Regeln): ${ms(z.ms)}`);
    zahlen["alleKaltSumme"] = Number(liste.reduce((a, b) => a + b, 0).toFixed(0));
}

console.log("\n— Richtung B: Gegenstand → Einträge —");
const gareth = (
    await sql`SELECT ST_X(geom)::float8 AS x, ST_Y(geom)::float8 AS y FROM place WHERE is_active AND name = 'Gareth' ORDER BY id LIMIT 1`
)[0];
if (gareth !== undefined) {
    leereVorkommenSpeicher();
    const kalt = await zeit(() => eintraegeAmPunkt(sql, { x: gareth.x, y: gareth.y }));
    zeile("Punkt Gareth kalt (Regeln werden geladen)", kalt.ms);
    console.log(`    ${String(kalt.ergebnis.eintraege.length)} Einträge`);
    zeile("Punkt Gareth warm (Median)", await warm(() => eintraegeAmPunkt(sql, { x: gareth.x, y: gareth.y })), 20);
    // Fünfzig Punkte auf der Linie von Gareth nach Havena (eine Etappe), eine Abfrage.
    const havena = (
        await sql`SELECT ST_X(geom)::float8 AS x, ST_Y(geom)::float8 AS y FROM place WHERE is_active AND name = 'Havena' ORDER BY id LIMIT 1`
    )[0] ?? { x: gareth.x - 200, y: gareth.y };
    const punkte = Array.from({ length: 50 }, (_, i) => ({
        x: gareth.x + ((havena.x - gareth.x) * i) / 49,
        y: gareth.y + ((havena.y - gareth.y) * i) / 49,
    }));
    zeile("Bündel von 50 Punkten (eine Etappe) warm", await warm(() => eintraegeAnPunkten(sql, punkte)));
    const einzeln = await warm(async () => {
        for (const p of punkte.slice(0, 10)) await eintraegeAmPunkt(sql, p);
    });
    zeile("  zum Vergleich: 10 Punkte einzeln hintereinander", einzeln);
}
const kosch = (
    await sql`SELECT r.public_id::text AS id FROM region r WHERE r.is_active AND NOT r.is_hidden AND r.name IN ('Kosch', 'Mittelaventurien') ORDER BY (r.name = 'Kosch') DESC, r.id LIMIT 1`
)[0];
if (kosch !== undefined) {
    zeile(
        "Fläche (Kosch, sonst Mittelaventurien), Punkt der Fläche und Schranke „größer“",
        await warm(() => eintraegeAnFlaechen(sql, [kosch.id])),
        50,
    );
}

if (out !== undefined) writeFileSync(out, JSON.stringify(zahlen, null, 2));
await sql.end();
