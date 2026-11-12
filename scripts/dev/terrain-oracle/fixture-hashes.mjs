/**
 * Erzeugt die erwarteten Prüfsummen für `apps/server/test/terrain-v12.test.ts` mit Legacys Modul aus
 * dem Mirror (WI-0049 S3) und rechnet dieselben Gebirge zur Kontrolle mit dem Port.
 *
 * Aufruf (aus der Wurzel des Repositoriums): node scripts/dev/terrain-oracle/fixture-hashes.mjs
 */
import { createHash } from "node:crypto";
import { buildMountainRaster, rasterSamples } from "@avesmaps3d/shared";
import { legacySamples, loadLegacyV12 } from "./legacy-v12.mjs";
import { V12_FIXTURES } from "./v12-fixtures.ts";

const sha256 = (samples) =>
    createHash("sha256")
        .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
        .digest("hex");

const legacy = loadLegacyV12();
let gleich = true;
for (const { name, input } of V12_FIXTURES) {
    const o = legacy.build(globalThis.structuredClone(input));
    const port = buildMountainRaster(globalThis.structuredClone(input));
    const orakel = sha256(legacySamples(o));
    const eigen = sha256(rasterSamples(port));
    // `h` bitweise, nicht nur die gerundeten Werte.
    const hGleich = Buffer.compare(Buffer.from(o.h.buffer), Buffer.from(port.h.buffer)) === 0;
    if (orakel !== eigen || o.leer !== port.leer || !hGleich) gleich = false;
    let max = 0;
    for (let k = 0; k < port.h.length; k++) if (port.eigen[k]) max = Math.max(max, port.h[k]);
    console.log(
        `${name}: ${o.r.w}×${o.r.hh} leer=${o.leer} max=${max.toFixed(1)} h bitgleich=${hGleich}
` +
            `  orakel=${orakel}
  port  =${eigen}`,
    );
}
process.exitCode = gleich ? 0 : 1;
