import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { AVENTURIA } from "@avesmaps3d/shared";
import { importPlaces, MigrationAborted, PLACE_SUBTYPES, type ImportScope, type LegacyPayload } from "./places.ts";
import { locationsFromMapFeatures, type MapFeaturesPayload } from "./map-features.ts";

/**
 * Imports a legacy places slice from a saved payload file.
 *
 * The file is fetched separately and deliberately: GET /api/locations/ builds the whole legacy
 * route network server side, so this tool never calls it on its own (chapter 3.2.3).
 *
 * The scope defaults to the whole map domain; a bounding box narrows it. Everything outside the
 * scope stays untouched, because absence outside it says nothing about deletion.
 *
 * Example:
 *   npm run migrate:places -- --source legacy-locations.json
 *   npm run migrate:places -- --source legacy-locations.json --bbox 480,460,560,540
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
        // Wirkungslos seit 2026-10-03 (Betreiber): die Stilllegequote wird gemeldet, hält den Lauf aber nicht an.
        "allow-shrink": { type: "boolean", default: false },
    },
});

if (!values.source) {
    console.error("usage: --source <legacy-locations.json> [--bbox minX,minY,maxX,maxY] [--subtypes a,b]");
    process.exit(1);
}
if (values["allow-shrink"]) {
    console.warn(
        "Hinweis: --allow-shrink ist wirkungslos; die Stilllegequote wird nur gemeldet (Betreiber 2026-10-03).",
    );
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
    const report = await importPlaces(database, payload, scope);
    console.warn(JSON.stringify(report, null, 2));
    for (const text of formatFindings(report.findings)) {
        console.warn(text);
    }
} catch (error) {
    if (error instanceof MigrationAborted) {
        // A safety gate, not a crash: nothing was written, and the numbers say why.
        console.error(`aborted: ${error.message}`);
        console.error(JSON.stringify(error.detail, null, 2));
        process.exitCode = 2;
    } else {
        throw error;
    }
} finally {
    await database.end({ timeout: 5 });
}
