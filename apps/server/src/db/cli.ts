import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { migrate } from "./migrate.ts";
import { seedMapDomains } from "./seed-map-domains.ts";

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
try {
    const executed = await migrate(database);
    console.warn(executed.length > 0 ? `applied: ${executed.join(", ")}` : "no pending migrations");
    const seeded = await seedMapDomains(database);
    console.warn(`map domains seeded: ${seeded.join(", ")}`);
} catch (error) {
    // Erst alles fürs Journal, dann die eine Zeile, die der Deploy als letzte zeigt.
    console.error(error);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
} finally {
    await database.end({ timeout: 5 });
}
