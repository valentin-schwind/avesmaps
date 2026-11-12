import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { migrationFailure } from "../src/db/migrate.ts";
import {
    createDatabase,
    isDatabaseUnavailable,
    RECONNECT_BACKOFF_MAX_S,
    reconnectBackoff,
    SERVER_TIMEOUTS,
    sessionLimits,
    WORKER_TIMEOUTS,
    type Database,
    type SessionTimeouts,
} from "../src/database.ts";

/**
 * Zeitgrenzen der Pools (WI-0037, S-05; Kap. 10.129, 10.130). Vorher wartete jede Verbindung ohne
 * Ende: hinter einer Migration mit `ACCESS EXCLUSIVE`, hinter einer ausufernden PostGIS-Abfrage
 * (der Körper aus S-01 rechnete lokal 34 s) oder in einer vergessenen Transaktion.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
// Kap. 11.10 und 11.155: gegen echtes PostgreSQL, sonst ein sichtbarer Skip.
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const opened: Database[] = [];
afterEach(async () => {
    await Promise.all(opened.splice(0).map((database) => database.end({ timeout: 1 })));
});

function open(timeouts?: SessionTimeouts): Database {
    const database = createDatabase(testDatabaseUrl as string, { max: 1, ...(timeouts ? { timeouts } : {}) });
    opened.push(database);
    return database;
}

const SHORT: SessionTimeouts = { statementMs: 200, lockMs: 200, idleInTransactionMs: 300 };
/** Ein Schlüssel nur für diesen Test: Beratungssperren berühren keine Tabelle der gemeinsamen Testdatenbank. */
const LOCK_KEY = 370_005;

/** Was Server und Worker beim Start ins Journal schreiben. */
async function settings(database: Database): Promise<string[]> {
    const limits = await sessionLimits(database);
    return [limits["statement_timeout"]!, limits["lock_timeout"]!, limits["idle_in_transaction_session_timeout"]!];
}

async function failure(query: Promise<unknown>): Promise<unknown> {
    try {
        await query;
    } catch (error) {
        return error;
    }
    throw new Error("die Abfrage lief durch, obwohl sie hätte abbrechen müssen");
}

describeWithDatabase("Zeitgrenzen der Pools", () => {
    it("🔴 Server und Worker bekommen ihre Grenzen mit jeder Verbindung, und die Journalzeile meldet sie", async () => {
        expect(await settings(open(SERVER_TIMEOUTS))).toEqual(["5s", "2s", "30s"]);
        expect(await settings(open(WORKER_TIMEOUTS))).toEqual(["15s", "2s", "30s"]);
    });

    it("🪤 ohne `timeouts` gilt keine Grenze: Importe und Ableitungen dürfen lange rechnen", async () => {
        // Die Rolle darf eigene Werte tragen (Claudio); die Testrolle trägt keine.
        expect(await settings(open())).toEqual(["0", "0", "0"]);
    });

    it("🔴 statement_timeout bricht eine lange Abfrage ab, und der Fehler heißt „nicht bedienbar“", async () => {
        const database = open(SHORT);
        const started = performance.now();
        const error = await failure(database`SELECT pg_sleep(3)`);

        expect(performance.now() - started).toBeLessThan(2_000);
        expect(error).toMatchObject({ code: "57014" });
        expect(isDatabaseUnavailable(error)).toBe(true);
    });

    it("🔴 lock_timeout: niemand wartet ohne Ende auf eine Sperre", async () => {
        const holder = open();
        // Die Statement-Grenze liegt darüber, sonst bräche sie zuerst ab (57014 statt 55P03).
        const waiter = open({ ...SHORT, statementMs: 5_000 });
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let held!: () => void;
        const isHeld = new Promise<void>((resolve) => (held = resolve));

        const holding = holder.begin(async (transaction) => {
            await transaction`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
            held();
            await released;
        });
        await isHeld;
        const started = performance.now();
        const error = await failure(waiter`SELECT pg_advisory_lock(${LOCK_KEY})`);
        release();
        await holding;

        expect(performance.now() - started).toBeLessThan(2_000);
        expect(error).toMatchObject({ code: "55P03" });
        expect(isDatabaseUnavailable(error)).toBe(true);
        // Scheitert eine Migration so, steht in EINER Zeile, welche und warum: Der Deploy zeigt nur drei.
        const line = migrationFailure("0042_beispiel", error).message;
        expect(line).not.toContain("\n");
        expect(line).toMatch(/^migration 0042_beispiel failed \(SQLSTATE 55P03\) - lock_timeout.*wiederholen: /);
    });

    it("🔴 idle_in_transaction_session_timeout: eine liegengelassene Transaktion hält nichts fest", async () => {
        // PostgreSQL beendet dabei die ganze Verbindung (25P03, FATAL), nicht nur die Anweisung.
        const database = open(SHORT);
        const error = await failure(
            database.begin(async (transaction) => {
                await transaction`SELECT 1`;
                await new Promise((resolve) => setTimeout(resolve, 800));
                await transaction`SELECT 1`;
            }),
        );

        expect(isDatabaseUnavailable(error)).toBe(true);
        // Der Pool baut die Verbindung neu auf und bedient weiter (Claudio).
        expect(await database`SELECT 1 AS n`).toEqual([{ n: 1 }]);
        expect(await settings(database)).toEqual(["200ms", "200ms", "300ms"]);
    });
});

describe("Pause vor dem nächsten Verbindungsversuch", () => {
    it("🔴 wächst wie bei postgres.js, aber nie über RECONNECT_BACKOFF_MAX_S (sonst bis zu 20 s tot nach einem Ausfall)", () => {
        expect(reconnectBackoff(0)).toBeLessThanOrEqual(0.01);
        for (const retries of [5, 10, 50, 1_000]) {
            const pause = reconnectBackoff(retries);
            expect(pause, String(retries)).toBeGreaterThanOrEqual(RECONNECT_BACKOFF_MAX_S / 2);
            expect(pause, String(retries)).toBeLessThanOrEqual(RECONNECT_BACKOFF_MAX_S);
        }
    });
});

describe("Fehler einordnen", () => {
    it("🪤 nur Verbindung, Anmeldung, Grenzen und Ressourcen sind „nicht bedienbar“", () => {
        expect(isDatabaseUnavailable(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(true);
        expect(isDatabaseUnavailable(Object.assign(new Error("write"), { code: "CONNECT_TIMEOUT" }))).toBe(true);
        // Ein SQLSTATE zählt nur an einem Fehler der Datenbank, nicht an irgendeinem Error mit `code`.
        expect(isDatabaseUnavailable(Object.assign(new Error("x"), { code: "57014" }))).toBe(false);
        expect(isDatabaseUnavailable(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(false);
        expect(isDatabaseUnavailable(new Error("ohne Code"))).toBe(false);
        expect(isDatabaseUnavailable("kein Error")).toBe(false);
    });

    it("🔴 S-01: die Zeitgrenze mitten in GEOS (XX000, InterruptedException) ist ein Abbruch - jedes andere XX000 nicht", () => {
        // So meldet PostGIS 3.6 den Abbruch, lokal nachgestellt mit der Landschaftsabfrage.
        const geos = (message: string) => new postgres.PostgresError({ code: "XX000", message } as never);
        expect(
            isDatabaseUnavailable(geos("lwgeom_intersection_prec: GEOS Error: InterruptedException: Interrupted!")),
        ).toBe(true);
        expect(
            isDatabaseUnavailable(geos("lwgeom_unaryunion_prec: GEOS Error: InterruptedException: Interrupted!")),
        ).toBe(true);
        expect(
            isDatabaseUnavailable(
                geos("lwgeom_intersection_prec: GEOS Error: TopologyException: side location conflict"),
            ),
        ).toBe(false);
        expect(isDatabaseUnavailable(geos("unrecognized error"))).toBe(false);
    });

    it("🪤 eine gescheiterte Migration ohne SQLSTATE nennt trotzdem ihre Version", () => {
        expect(migrationFailure("0001_x", new Error("kaputt")).message).toBe("migration 0001_x failed: kaputt");
    });
});
