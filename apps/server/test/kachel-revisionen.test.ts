import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TILE_REVISIONS_URL, readTileRevisions } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { readTileRevisionsFrom } from "../src/routes/tile-revisions.ts";

/**
 * Die Kachelrevisionen beim Start der Karte (WI-0283 H3): je Art das jüngste Ereignis `map.changed`, gegen PostgreSQL. Die Karte rechnet
 * daraus die Revision jeder Quelle (`beginne` in `edit-revision.ts`); sie muss derselben Regel folgen wie das Ereignis selbst
 * (`quellenFuer`): Ein Ereignis ohne `affected` oder ein Element ohne Art betrifft alle.
 */
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Kachelrevisionen gegen PostgreSQL", () => {
    let database: Database;
    const ereignis = async (payload: Record<string, unknown>): Promise<number> => {
        const [zeile] = await database<{ seq: string }[]>`
            SELECT map_event_add('aventuria', ${database.json(JSON.parse(JSON.stringify(payload)))}::jsonb) AS seq
        `;
        return Number(zeile!.seq);
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await database`DELETE FROM job_event WHERE kind = 'map.changed'`;
    });
    afterAll(async () => {
        await database`DELETE FROM job_event WHERE kind = 'map.changed'`;
        await database.end({ timeout: 5 });
    });

    it("ohne Ereignis gibt es keine Stände, und die Antwort trägt trotzdem das Schema", async () => {
        const stand = await readTileRevisionsFrom(database);
        expect(stand).toEqual({ schemaVersion: 1, ohneArt: 0, arten: {} });
        expect(readTileRevisions(JSON.parse(JSON.stringify(stand)))).toEqual(stand);
    });

    it("🔴 je Art das jüngste Ereignis; zwei Arten in einem Ereignis zählen beide; ohne Art heißt alle", async () => {
        await ereignis({ affected: [{ kind: "path", id: "a" }] });
        const wegUndOrt = await ereignis({
            affected: [
                { kind: "path", id: "b" },
                { kind: "path", id: "c" },
                { kind: "place", id: "d" },
            ],
        });
        const flaeche = await ereignis({ affected: [{ kind: "region", id: "e" }] });
        const auftrag = await ereignis({ operation: "land_smooth", affected: [] });
        const ohneFeld = await ereignis({ operation: "territory_derive" });
        const ohneArt = await ereignis({ affected: [{ id: "f" }] });
        expect(auftrag).toBeLessThan(ohneFeld);
        expect(await readTileRevisionsFrom(database)).toEqual({
            schemaVersion: 1,
            ohneArt,
            arten: { path: wegUndOrt, place: wegUndOrt, region: flaeche },
        });
    });

    it("andere Ereignisse zählen nicht", async () => {
        const vorher = await readTileRevisionsFrom(database);
        await database`SELECT job_event_add('display_heights.changed', NULL, 'aventuria', '{"affected":[{"kind":"path"}]}'::jsonb, NULL)`;
        expect(await readTileRevisionsFrom(database)).toEqual(vorher);
    });
});

describe("Kachelrevisionen lesen (tolerant)", () => {
    it("die Adresse liegt unter /api/, Nginx braucht keinen neuen Ort", () => {
        expect(TILE_REVISIONS_URL.startsWith("/api/")).toBe(true);
    });

    it("ein neues Feld wird ignoriert; was die Karte kennt, wird geprüft", () => {
        expect(readTileRevisions({ schemaVersion: 1, ohneArt: 3, arten: { path: 9 }, neu: true })).toEqual({
            schemaVersion: 1,
            ohneArt: 3,
            arten: { path: 9 },
        });
        for (const kaputt of [
            null,
            "x",
            {},
            { schemaVersion: 2, ohneArt: 0, arten: {} },
            { schemaVersion: 1, ohneArt: -1, arten: {} },
            { schemaVersion: 1, ohneArt: 0, arten: [] },
            { schemaVersion: 1, ohneArt: 0, arten: { path: "9" } },
        ])
            expect(readTileRevisions(kaputt)).toBeUndefined();
    });
});
