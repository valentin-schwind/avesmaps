import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import {
    WorkerLebenszeichen,
    leseLebenszeichen,
    sendeLebenszeichen,
    type WorkerBeat,
} from "../src/jobs/lebenszeichen.ts";
import { prozesse } from "../src/system/systemzustand.ts";
import { uniqueScope, waitFor } from "./support/jobs-support.ts";

/**
 * Das Lebenszeichen des Jobs-Workers für den Systemzustand (WI-0127 §22):
 *
 * - Eine verstümmelte oder fremde Meldung bleibt folgenlos.
 * - 🔴 Bleibt es drei Takte aus (mindestens 30 s), ist der Speicher unbekannt, nie der alte Wert; das des Planers geht vor.
 * - Gegen echtes PostgreSQL: Ein Lebenszeichen geht per `NOTIFY`, Fastify hört mit. (Der Ausführer eines Auftrags sendet seit WI-0163
 *   keines mehr; wer es künftig sendet, entscheidet der Dirigent.)
 * - Der Systemzustand: Fastify mit RSS, Routing als Thread darin (Heap, Graph), Jobs aus dem Lebenszeichen oder unbekannt.
 */

const beat = (overrides: Partial<WorkerBeat> = {}): WorkerBeat => ({
    instanz: "host:1",
    planer: true,
    release: "r1",
    gemessen: "2026-10-11T12:00:00.000Z",
    taktMs: 10_000,
    rss: 90_000_000,
    kinder: { anzahl: 0, rss: 0 },
    ...overrides,
});

describe("Lebenszeichen lesen und halten", () => {
    it("🔴 eine verstümmelte oder fremde Meldung bleibt folgenlos", () => {
        expect(leseLebenszeichen(JSON.stringify(beat()))).toEqual(beat());
        expect(leseLebenszeichen("kein json")).toBeUndefined();
        expect(leseLebenszeichen(JSON.stringify({ ...beat(), rss: -1 }))).toBeUndefined();
        expect(leseLebenszeichen(JSON.stringify({ ...beat(), kinder: null }))).toBeUndefined();
        expect(leseLebenszeichen(JSON.stringify({ ...beat(), gemessen: "gestern" }))).toBeUndefined();
        expect(leseLebenszeichen("null")).toBeUndefined();
    });

    it("🔴 drei Takte ohne Lebenszeichen: unbekannt, nie der alte Wert; der Planer geht vor", () => {
        let now = 1_000_000;
        // Ohne Datenbank: Der Test gibt die Meldungen selbst, `start` bleibt ungerufen.
        const empfang = new WorkerLebenszeichen({ database: undefined as unknown as Database, now: () => now });
        expect(empfang.aktuell()).toBeUndefined();
        empfang.empfange(JSON.stringify(beat({ instanz: "planer", planer: true, rss: 1 })));
        now += 1_000;
        empfang.empfange(JSON.stringify(beat({ instanz: "wartet", planer: false, rss: 2 })));
        expect(empfang.aktuell()?.instanz).toBe("planer");
        now += 29_500;
        // Der Planer ist 30,5 s still (drei Takte zu 10 s, mindestens 30 s), der andere erst 29,5 s.
        expect(empfang.aktuell()?.instanz).toBe("wartet");
        now += 1_000;
        expect(empfang.aktuell()).toBeUndefined();
        // Ein langer Takt verlängert die Frist.
        empfang.empfange(JSON.stringify(beat({ instanz: "langsam", taktMs: 60_000 })));
        now += 170_000;
        expect(empfang.aktuell()?.instanz).toBe("langsam");
        now += 20_000;
        expect(empfang.aktuell()).toBeUndefined();
    });
});

describe("Speicher je Prozess im Systemzustand", () => {
    it("🔴 Routing als Thread in Fastify mit Heap und Graph; Jobs aus dem Lebenszeichen, ohne eines unbekannt", () => {
        expect(prozesse(400, { heap: 64, graph: 180 }, beat({ rss: 85, kinder: { anzahl: 1, rss: 1200 } }))).toEqual([
            { id: "fastify", rss: 400 },
            { id: "routing", rss: null, imProzess: "fastify", heap: 64, graph: 180 },
            { id: "jobs", rss: 85, kinder: { anzahl: 1, rss: 1200 }, stand: "2026-10-11T12:00:00.000Z" },
        ]);
        expect(prozesse(400, null, undefined)).toEqual([
            { id: "fastify", rss: 400 },
            { id: "routing", rss: null, imProzess: "fastify", heap: null, graph: null },
            { id: "jobs", rss: null },
        ]);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Lebenszeichen über PostgreSQL", { timeout: 30_000 }, () => {
    let database: Database;
    let hoerer: Database;
    const offen: { close(): Promise<void> }[] = [];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        hoerer = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
    });

    afterEach(async () => {
        for (const entry of offen.splice(0)) await entry.close();
    });

    afterAll(async () => {
        await hoerer?.end({ timeout: 5 });
        await database?.end({ timeout: 5 });
    });

    it("🔴 gesendet über NOTIFY, gehört von Fastify", async () => {
        const empfang = new WorkerLebenszeichen({ database: hoerer });
        offen.push(empfang);
        await empfang.start();
        const instanz = uniqueScope("beat");
        await sendeLebenszeichen(database, beat({ instanz, rss: 123_456 }));
        const gehoert = await waitFor(
            () => (empfang.aktuell()?.instanz === instanz ? empfang.aktuell() : undefined),
            5_000,
            "Lebenszeichen gehört",
        );
        expect(gehoert.rss).toBe(123_456);
    });
});
