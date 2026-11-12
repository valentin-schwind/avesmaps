import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { AVENTURIA } from "@avesmaps3d/shared";
import { befundSummary, checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { PLACE_SUBTYPES, type ImportScope, type LegacyPayload } from "./places.ts";
import { locationsFromMapFeatures, type MapFeaturesPayload } from "./map-features.ts";
import { verifyPlaces } from "./verify-places.ts";

/**
 * Checks the migrated places against the legacy payload they came from.
 *
 * Separate from the import on purpose: a verification that runs inside the thing it verifies only
 * proves the importer agrees with itself. This reads the database back and compares it to the
 * source file, and exits non-zero when anything differs (chapter 11.155).
 *
 * Example:
 *   npm run verify:places -- --source legacy-locations.json
 */
const domainBounds = AVENTURIA.coordinateSpace.bounds;
const { values } = parseArgs({
    options: {
        source: { type: "string" },
        bbox: {
            type: "string",
            default: [domainBounds.minX, domainBounds.minY, domainBounds.maxX, domainBounds.maxY].join(","),
        },
        subtypes: { type: "string", default: PLACE_SUBTYPES.join(",") },
    },
});

if (!values.source) {
    console.error("usage: --source <legacy-locations.json> [--bbox minX,minY,maxX,maxY]");
    process.exit(1);
}

const bboxParts = values.bbox.split(",").map((part) => Number(part.trim()));
if (bboxParts.length !== 4 || bboxParts.some((part) => !Number.isFinite(part))) {
    console.error(`--bbox must be minX,minY,maxX,maxY, got: ${values.bbox}`);
    process.exit(1);
}

const scope: ImportScope = {
    bounds: {
        minX: bboxParts[0] as number,
        minY: bboxParts[1] as number,
        maxX: bboxParts[2] as number,
        maxY: bboxParts[3] as number,
    },
    subtypes: values.subtypes.split(",").map((value) => value.trim()) as ImportScope["subtypes"],
};

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const raw = JSON.parse(await readFile(values.source, "utf8")) as LegacyPayload & MapFeaturesPayload;
// Two shapes are accepted: the map payload (complete, the one the legacy map draws from) and the
// older route-network list. Which one it is, the file says itself.
const payload: LegacyPayload = Array.isArray(raw.features) ? locationsFromMapFeatures(raw) : raw;
const database = createDatabase(config.databaseUrl);
try {
    const report = await verifyPlaces(database, payload, scope);
    for (const check of report.checks) {
        console.warn(
            `${checkWord(check.passed, check.blocking !== false, "PASS")}  ${check.name.padEnd(20)} ${check.detail}`,
        );
        for (const offender of check.offenders ?? []) {
            console.warn(`                            ${offender}`);
        }
    }
    const befunde = befundSummary(report.checks, (check) => check.passed);
    if (befunde) console.warn(`\n${befunde}`);
    console.warn(`\n${report.passed ? "PARITY OK" : "PARITY FAILED"}  (${report.sourceRef})`);
    if (!report.passed) {
        process.exitCode = 1;
    }
} finally {
    await database.end({ timeout: 5 });
}
