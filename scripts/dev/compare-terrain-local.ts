/**
 * Ein lokal veröffentlichtes Gelände gegen den vollen Lauf messen (WI-0125, JOBS-0001 Etappe 2, Messtor: „Vergleich des Ergebnisses mit
 * dem vollen Lauf (Bytes oder gemessene Abweichung)“).
 *
 *   node --expose-gc scripts/dev/compare-terrain-local.ts [--out bericht.json] [--full master.u16]
 *
 * Liest den GELTENDEN Master; er muss vorläufig sein (`terrain_domain_raster.provisional`, von `dem_publish`). Dann rechnet es den vollen
 * Generatorlauf mit den heutigen Eingaben (ohne Zwischenspeicher, ohne zu schreiben, wie `derive:terrain` von vorn; rund 4 bis 6
 * Minuten und gut 1 GB) und vergleicht in Schritt:
 *
 *   - **innen** (die eingesetzten Rechenkacheln): vorläufiger Master gegen vollen Lauf, die Abweichung des lokalen Jobs;
 *   - **außen**: vorläufiger Master (dort = der Stand davor) gegen vollen Lauf, was der gesammelte volle Lauf noch bringt;
 *   - **Grenze**: je Nachbarpaar über die Grenze des Fußabdrucks der Sprung im vorläufigen Master gegen den im vollen Lauf.
 *
 * Nur lesend (`DATABASE_URL`). 🔴 Vorher prüfen, dass kein anderer voller Geländelauf läuft (Speicher). Mit `--full` wird ein schon
 * gerechneter voller Lauf (uint16, Zeile 0 im Süden, 8192²) gelesen statt gerechnet.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { AVENTURIA } from "@avesmaps3d/shared";
import { loadConfig } from "../../apps/server/src/config.ts";
import { createDatabase } from "../../apps/server/src/database.ts";
import { generateDomainTerrain } from "../../apps/server/src/terrain/domain/generate.ts";
import { loadDomainInputs } from "../../apps/server/src/terrain/domain/inputs.ts";
import { readDomainSamples } from "../../apps/server/src/terrain/domain/read.ts";
import { AVENTURIA_TERRAIN_RECIPE } from "../../apps/server/src/terrain/domain/recipes.ts";

interface Stats {
    pixels: number;
    ge1: number;
    ge10: number;
    ge100: number;
    max: number;
    p99: number;
}

function compare(a: Uint16Array, b: Uint16Array, take: (k: number) => boolean): Stats {
    const histogram = new Uint32Array(4096);
    let pixels = 0;
    let max = 0;
    for (let k = 0; k < a.length; k += 1) {
        if (!take(k)) continue;
        pixels += 1;
        const d = Math.abs(a[k]! - b[k]!);
        histogram[Math.min(4095, d)]! += 1;
        if (d > max) max = d;
    }
    const atLeast = (limit: number): number => histogram.slice(limit).reduce((sum, count) => sum + count, 0);
    let seen = 0;
    let p99 = 0;
    for (let d = 0; d < histogram.length; d += 1) {
        seen += histogram[d]!;
        if (seen >= 0.99 * pixels) {
            p99 = d;
            break;
        }
    }
    return { pixels, ge1: atLeast(1), ge10: atLeast(10), ge100: atLeast(100), max, p99 };
}

const { values } = parseArgs({ options: { out: { type: "string" }, full: { type: "string" } } });
const config = loadConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL fehlt");
const database = createDatabase(config.databaseUrl, { max: 2 });
const domain = AVENTURIA.mapDomain;
try {
    const [master] = await database<
        { fingerprint: string; size: number; provisional: boolean; local_tiles: number[] | null }[]
    >`
        SELECT t.fingerprint, t.size, t.provisional, t.local_tiles FROM terrain_dem d
        JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
        WHERE d.map_domain_id = ${domain} AND d.is_current
    `;
    if (!master?.provisional || !master.local_tiles) throw new Error("Der geltende Master ist nicht vorläufig");
    const n = master.size;
    const local = await readDomainSamples(database, domain, master.fingerprint, n);
    let full: Uint16Array;
    let fullMs = 0;
    let fullFingerprint: string | null = null;
    if (values.full) {
        const bytes = readFileSync(values.full);
        full = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    } else {
        const started = performance.now();
        const input = await database.begin("read only", (tx) => loadDomainInputs(tx, domain));
        const result = generateDomainTerrain(input, AVENTURIA_TERRAIN_RECIPE, AVENTURIA_TERRAIN_RECIPE.generator.size);
        full = result.raster.samples;
        fullFingerprint = result.fingerprint;
        fullMs = Math.round(performance.now() - started);
    }
    if (full.length !== local.length) throw new Error("Voller Lauf und Master haben verschiedene Größen");
    const per = AVENTURIA_TERRAIN_RECIPE.generator.fine?.tiles ?? 8;
    const side = n / per;
    const inside = new Uint8Array(n * n);
    for (const index of master.local_tiles) {
        const tx = index % per;
        const ty = Math.floor(index / per);
        const bottom = n - (ty + 1) * side;
        for (let row = 0; row < side; row += 1)
            inside.fill(1, (bottom + row) * n + tx * side, (bottom + row) * n + (tx + 1) * side);
    }
    let pairs = 0;
    const extras = new Uint32Array(4096);
    let maxExtra = 0;
    for (let y = 0; y < n; y += 1)
        for (let x = 0; x < n; x += 1) {
            const k = y * n + x;
            if (!inside[k]) continue;
            for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ] as const) {
                const nx = x + dx,
                    ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= n || ny >= n || inside[ny * n + nx]) continue;
                const o = ny * n + nx;
                const extra = Math.abs(local[k]! - local[o]! - (full[k]! - full[o]!));
                pairs += 1;
                extras[Math.min(4095, extra)]! += 1;
                maxExtra = Math.max(maxExtra, extra);
            }
        }
    const over = (limit: number): number => extras.slice(limit + 1).reduce((sum, count) => sum + count, 0);
    const report = {
        master: master.fingerprint,
        full: fullFingerprint,
        fullMs,
        tiles: master.local_tiles,
        inside: compare(local, full, (k) => inside[k] === 1),
        outside: compare(local, full, (k) => inside[k] === 0),
        seam: { pairs, over5: over(5), over10: over(10), over50: over(50), max: maxExtra },
    };
    process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
    if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 1));
} finally {
    await database.end({ timeout: 5 });
}
