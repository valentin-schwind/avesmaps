import { AVENTURIA, AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { checkWord } from "../blocking-checks.ts";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { verifySeaRoutes } from "../routing/sea-verify.ts";

/** Prüft den gespeicherten Seegraphen (WI-0046). Liest nur; Exit 1, wenn eine Prüfung scheitert. */
const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const database = createDatabase(config.databaseUrl);
let failed = 0;
let befunde = 0;
try {
    for (const check of await verifySeaRoutes(database, AVENTURIA.mapDomain, AVENTURIA_TRAVEL_MODEL)) {
        const blocking = check.blocking !== false;
        if (!check.ok && blocking) failed += 1;
        if (!check.ok && !blocking) befunde += 1;
        console.log(`${checkWord(check.ok, blocking, "PASS")}  ${check.name}: ${check.detail}`);
    }
} finally {
    await database.end({ timeout: 5 });
}
if (befunde > 0) {
    console.log(`${String(befunde)} Pruefung(en) als BEFUND gemeldet, der Lauf wurde nicht angehalten`);
}
console.log(failed === 0 ? "Seegraph in Ordnung" : `${String(failed)} Pruefung(en) gescheitert`);
process.exitCode = failed === 0 ? 0 : 1;
