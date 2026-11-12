import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildProbeManifest } from "./media-probe-manifest.ts";

/**
 * Schreibt ein ABGELEITETES Medien-Manifest für Proben (kein Export von Legacy, siehe `media-probe-manifest.ts`) aus den Dateien des
 * Kartensatzes. Nur lesend gegen die Eingaben; es ruft nichts ab.
 *
 *   npm run media:probe-manifest -- --features <map-features.json> --territories <legacy-political-territories.json> --out <datei> [--revision probe-161832]
 */
const { values } = parseArgs({
    options: {
        features: { type: "string" },
        territories: { type: "string" },
        out: { type: "string" },
        revision: { type: "string", default: "probe" },
    },
});
if (!values.features || !values.territories || !values.out) {
    console.error(
        "usage: --features <map-features.json> --territories <legacy-political-territories.json> --out <datei> [--revision <name>]",
    );
    process.exit(1);
}
const manifest = buildProbeManifest({
    features: JSON.parse(await readFile(values.features, "utf8")) as never,
    territories: JSON.parse(await readFile(values.territories, "utf8")) as never,
    mediaRevision: values.revision,
});
await writeFile(values.out, `${JSON.stringify(manifest, null, 1)}\n`, "utf8");
const counts = manifest["counts"] as { items: number; by_class: Record<string, number> };
console.log(
    `${values.out}: ${String(counts.items)} Einträge ${JSON.stringify(counts.by_class)} (abgeleitet, kein Export von Legacy)`,
);
