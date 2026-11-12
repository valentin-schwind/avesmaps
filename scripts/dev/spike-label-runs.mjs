// Applies or removes the ADR-0007 spike fixture in the development database.
//
// 💣 Development only, and deliberately not a migration: the model it measures is not decided yet.
// Run with --down to remove every trace of it.
//
//   node --env-file-if-exists=.env scripts/dev/spike-label-runs.mjs
//   node --env-file-if-exists=.env scripts/dev/spike-label-runs.mjs --down
//
// Martin reads its catalogue once at startup, so a newly created function source only appears
// after a restart. The script says so rather than leaving the next run to wonder why the tile
// endpoint answers 404.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
    console.error("DATABASE_URL is not configured; run scripts/dev/install-toolchain.ps1 first");
    process.exit(1);
}

const down = process.argv.includes("--down");
const teardown = `
    DROP FUNCTION IF EXISTS spike_run_clipped(integer, integer, integer);
    DROP FUNCTION IF EXISTS spike_run_owned(integer, integer, integer);
    DROP FUNCTION IF EXISTS spike_run_shared(integer, integer, integer);
    DROP FUNCTION IF EXISTS spike_run_owns(geometry, integer, integer, integer);
    DROP FUNCTION IF EXISTS spike_run_target_metres(integer);
    DROP TABLE IF EXISTS spike_label_run;
`;
const sql = down ? teardown : readFileSync(`${repositoryRoot}scripts/dev/spike-label-runs.sql`, "utf8");

const database = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });
try {
    await database.unsafe(sql);
    if (down) {
        console.warn("spike fixture removed");
    } else {
        const [counted] = await database`SELECT count(*)::int AS runs FROM spike_label_run`;
        console.warn(`spike fixture applied: ${counted.runs} runs, 3 Martin function sources`);
        console.warn("restart Martin (npm run tiles:dev) so it picks the new sources up");
    }
} finally {
    await database.end({ timeout: 5 });
}
