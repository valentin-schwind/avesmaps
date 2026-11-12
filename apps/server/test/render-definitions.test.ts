import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";

/**
 * Jede Renderansicht und jede Kachelfunktion als Schnappschuss im Repository.
 *
 * 💣 Anlass: Migration 0028 hat `path_render` per `CREATE OR REPLACE VIEW` neu geschrieben — aus
 * einer ÄLTEREN Fassung abgeschrieben — und dabei den `LEFT JOIN path_visual` aus 0024 verloren.
 * Die Catmull-Rom-Glättung war weg, kein Test schlug an, der Betreiber sah es am Bild.
 *
 * ⭐ Dieser Test verhindert nicht, dass sich eine Ansicht ändert. Er verhindert, dass sie sich
 * UNBEMERKT ändert: jede Änderung lässt ihn fallen, und wer den Schnappschuss danach bewusst
 * aktualisiert (`npm test -- -u`), trägt die Änderung als Diff in denselben Commit. Ein verlorener
 * Join steht dort als rote Zeile — sichtbar für jeden, der den Commit liest.
 *
 * 🪤 Das Verhalten einzelner Ansichten sichern eigene Tests (etwa `path-render-visual.test.ts`).
 * Dieser hier ist das Netz darunter für alles, woran noch niemand einen Test gedacht hat.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Renderdefinitionen", () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 ändern sich nie unbemerkt", async () => {
        const ansichten = await database<{ name: string; definition: string }[]>`
            SELECT c.relname AS name, pg_get_viewdef(c.oid, true) AS definition
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE '%\_render'
            ORDER BY c.relname
        `;
        const funktionen = await database<{ name: string; definition: string }[]>`
            SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
                   pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND (p.proname LIKE '%\_tile' OR p.proname IN ('map_domain_to_render', 'label_collision_rank'))
            ORDER BY 1
        `;
        expect(ansichten.length, "es gibt überhaupt Renderansichten").toBeGreaterThan(5);
        expect(funktionen.length, "es gibt überhaupt Kachelfunktionen").toBeGreaterThan(1);

        const text = [
            ...ansichten.map((a) => `-- VIEW ${a.name}\n${a.definition.trim()}\n`),
            ...funktionen.map((f) => `-- FUNCTION ${f.name}\n${f.definition.trim()}\n`),
        ]
            .join("\n")
            // 🪤 Funktionsrümpfe tragen die Zeilenenden ihrer Migrationsdatei: unter Windows CRLF, auf
            // dem VPS LF. Ohne diese Zeile fiele der Test je nach Rechner, auf dem migriert wurde.
            .replace(/\r\n/g, "\n");
        await expect(text).toMatchFileSnapshot("./__snapshots__/render-definitions.sql");
    });
});
