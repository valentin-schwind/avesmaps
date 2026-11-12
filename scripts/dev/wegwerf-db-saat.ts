// `node scripts/dev/wegwerf-db-saat.ts <Wurzel>` mit gesetzter `TEST_DATABASE_URL`: spielt die Migrationen eines Stands und die Kartendomänen
// in die Datenbank ein (WI-0224), wie `apps/server/src/db/cli.ts` es für eine echte Datenbank tut. `starteWegwerfDb` ruft es auf.
//
// 🔴 Anlass: Eine frische Datenbank hat keine Zeilen in `map_domain`. 63 Testdateien legen sie selbst an (`seedMapDomains`), sechs nicht
// (`citymaps`, `editor-place-edit`, `literature`, `lore`, `media-schema`, `subjects`): Sie scheitern am Fremdschlüssel `map_domain_id`, solange
// keine frühere Datei die Zeilen hinterlassen hat. Gemessen 2026-10-18: im ersten Lauf rot, im Nachlauf grün.
//
// 🪤 Der Stand wird über seine Wurzel geladen (dynamischer Import), nicht über den Ort dieses Skripts: In `vor-dem-push` ist die Wurzel die
// Kopie des Commits, dieses Skript gehört zur laufenden Arbeitskopie. Die Pakete (`postgres`, `@avesmaps3d/shared`) löst Node vom Stand aus auf.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const wurzel = process.argv[2];
const url = process.env["TEST_DATABASE_URL"];
if (wurzel === undefined || url === undefined || url === "") {
    process.stderr.write("Aufruf: node wegwerf-db-saat.ts <Wurzel> mit gesetzter TEST_DATABASE_URL\n");
    process.exit(2);
}

const lade = (pfad: string): Promise<unknown> => import(pathToFileURL(join(wurzel, pfad)).href);
const { createDatabase } = (await lade(
    "apps/server/src/database.ts",
)) as typeof import("../../apps/server/src/database.ts");
const { migrate } = (await lade(
    "apps/server/src/db/migrate.ts",
)) as typeof import("../../apps/server/src/db/migrate.ts");
const { seedMapDomains } = (await lade(
    "apps/server/src/db/seed-map-domains.ts",
)) as typeof import("../../apps/server/src/db/seed-map-domains.ts");

const datenbank = createDatabase(url, { max: 1 });
try {
    const angewendet = await migrate(datenbank);
    const domaenen = await seedMapDomains(datenbank);
    process.stdout.write(
        `${String(angewendet.length)} Migrationen eingespielt, ${String(domaenen.length)} Kartendomänen angelegt.\n`,
    );
} finally {
    await datenbank.end({ timeout: 5 });
}
