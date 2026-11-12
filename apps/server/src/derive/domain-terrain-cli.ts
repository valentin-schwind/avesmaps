import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { formatFindings } from "../findings.ts";
import { deriveDomainTerrain } from "../terrain/domain/derive.ts";
import { activateDomainDem } from "../terrain/domain/activate.ts";

const { values } = parseArgs({
    options: {
        force: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        size: { type: "string" },
        activate: { type: "boolean", default: false },
    },
});
const config = loadConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is not configured");
const database = createDatabase(config.databaseUrl, { max: 2 });
try {
    if (values.activate && values["dry-run"]) throw new Error("Cannot activate a dry run");
    const report = await deriveDomainTerrain(database, {
        force: values.force,
        dryRun: values["dry-run"],
        ...(values.size ? { size: Number(values.size) } : {}),
        onProgress: (phase) => console.warn(phase),
    });
    const activated = values.activate ? await activateDomainDem(database, "aventuria", report.fingerprint) : false;
    const { burn, ...constraints } = report.constraints;
    console.warn(
        JSON.stringify(
            {
                ...report,
                activated,
                constraints: {
                    ...constraints,
                    burn: {
                        converged: burn.converged,
                        rounds: burn.rounds,
                        unresolved: burn.unresolved,
                        peakRises: burn.peakRises,
                        runs: burn.runs,
                        changedCells: burn.changedCells,
                    },
                },
            },
            null,
            2,
        ),
    );
    // Betreiber 2026-10-03: Seen eben, Gipfel exakt, Meer 0, Flüsse nicht bergauf halten die Ableitung nicht an.
    for (const text of formatFindings(report.constraints.findings ?? [])) console.warn(text);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
} finally {
    console.warn(`Spitze RSS: ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MiB`);
    await database.end({ timeout: 5 });
}
