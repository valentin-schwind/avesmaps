import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_CHANGE_CHANNEL, watchAuthChanges } from "../src/auth/change-watch.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { relayTo } from "./support/db-relay.ts";

/**
 * Der Wächter über Entzüge (`watchAuthChanges`, WI-0120 A11) nach einem Abbruch der Datenbank (WI-0127 SYS-3, Befund aus SYS-2 §9.5).
 * Nutzer sind die Tür (Speicher der Sitzungen) und `/ws` (Entzug an offenen Verbindungen).
 *
 * 🪤 **Gemessen 2026-10-10 (postgres.js 3.4.9), genauer als der Befund:** postgres.js verwirft `LISTEN` in den nachgestellten Fällen
 * (Verbindung abgewiesen, Datenbank hängt, `FATAL 57P03` beim Hochfahren) nicht für immer, sondern baut es selbst neu auf und ruft
 * `onlisten`. Ohne Deckel wuchs die Pause dafür bis 20 s; seit `62951ae9` (`reconnectBackoff`, höchstens 1 s) kam `LISTEN` in allen
 * gemessenen Läufen binnen 1 s nach der Rückkehr wieder (WI-0127 §12.8). Für immer verloren wäre das Abonnement nur, wenn ein
 * Neuaufbau scheitert, ohne dass die Verbindung danach noch einmal schließt (`listen(…).catch(() => {})`); nachgestellt hat sich das
 * nicht. Deshalb erkennt der Wächter „taub“ an einer Probe, die die Datenbank annimmt und die nicht zurückkommt, und prüft dann in jedem Takt
 * neu (`onResync`), bis wieder eine ankommt. Er fasst das Abonnement nicht an.
 *
 * Problemfälle: die Probe kommt still nicht zurück (taub, die Datenbank antwortet); die Datenbank ist weg (die Probe scheitert, das
 * zählt nicht); postgres.js hört selbst neu; `LISTEN` scheitert schon beim Start; zwei Wächter auf demselben Kanal derselben Verbindung
 * (Tür und `/ws`).
 * Soll: taub heißt `onResync` in jedem Takt und kein neues `LISTEN`; nach einem echten Ausfall meldet `onResync` den möglichen Verlust,
 * und ein Entzug kommt wieder an; solange das Abonnement hört, nichts. Gegenprobe mit abgeschaltetem Takt: Der Fall „taub“ fällt.
 */

/** Wartet, bis `done()` gilt, höchstens `limitMs`. */
async function until(done: () => boolean, limitMs: number): Promise<void> {
    const end = Date.now() + limitMs;
    while (!done()) {
        if (Date.now() > end) throw new Error(`nach ${String(limitMs)} ms nicht eingetreten`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

interface FakeListener {
    notify: (payload: string) => void;
    listening: (() => void) | undefined;
    active: boolean;
}

/** Eine Verbindung wie postgres.js: `LISTEN` je Aufruf, `pg_notify` kommt bei jedem aktiven Hörer an, wenn er nicht `deaf` ist. */
function fakeDatabase() {
    const listeners: FakeListener[] = [];
    const state = { down: false, deaf: false, listenFails: false, probes: 0, listens: 0 };
    const deliver = (payload: string) => {
        if (state.deaf) return;
        for (const listener of listeners.filter((entry) => entry.active)) listener.notify(payload);
    };
    const database = ((strings: TemplateStringsArray, ...values: unknown[]) => {
        if (!strings.join("").includes("pg_notify")) throw new Error(`unerwartet: ${strings.join("?")}`);
        if (state.down) return Promise.reject(Object.assign(new Error("weg"), { code: "ECONNREFUSED" }));
        state.probes += 1;
        expect(values[0]).toBe(AUTH_CHANGE_CHANNEL);
        queueMicrotask(() => deliver(String(values[1])));
        return Promise.resolve([]);
    }) as unknown as Database;
    Object.assign(database, {
        listen: async (channel: string, notify: (payload: string) => void, listening?: () => void) => {
            expect(channel).toBe(AUTH_CHANGE_CHANNEL);
            state.listens += 1;
            if (state.listenFails || state.down) throw Object.assign(new Error("weg"), { code: "ECONNREFUSED" });
            const listener: FakeListener = { notify, listening, active: true };
            listeners.push(listener);
            listening?.();
            return {
                unlisten: async () => {
                    listener.active = false;
                },
            };
        },
    });
    return { database, state, listeners, deliver };
}

describe("Wächter über Entzüge: taub, weg, wieder da (ohne Datenbank)", () => {
    function watch(fake: ReturnType<typeof fakeDatabase>, tickMs = 20) {
        const changes: string[] = [];
        let resyncs = 0;
        const started = watchAuthChanges(
            fake.database,
            (personId) => changes.push(personId),
            undefined,
            () => (resyncs += 1),
            { tickMs },
        );
        return { changes, resyncs: () => resyncs, started };
    }

    it("🔴 taub: die angenommene Probe kommt nicht zurück; jeder Takt prüft neu, kein neues LISTEN, bis wieder eine ankommt", async () => {
        const fake = fakeDatabase();
        const { changes, resyncs, started } = watch(fake);
        const close = await started;
        try {
            const person = randomUUID();
            fake.deliver(person);
            expect(changes).toEqual([person]);
            await until(() => fake.state.probes >= 2, 1_000);
            expect(resyncs()).toBe(0);
            // Das Abonnement hört nicht mehr, die Datenbank antwortet aber.
            fake.state.deaf = true;
            const listens = fake.state.listens;
            await until(() => resyncs() >= 3, 1_000);
            expect(fake.state.listens).toBe(listens);
            // Es hört wieder: ab der nächsten zurückgekommenen Probe kein Neuprüfen mehr.
            fake.state.deaf = false;
            const probes = fake.state.probes;
            await until(() => fake.state.probes >= probes + 2, 1_000);
            const settled = resyncs();
            await until(() => fake.state.probes >= probes + 5, 1_000);
            expect(resyncs()).toBe(settled);
            expect(fake.state.listens).toBe(listens);
            const next = randomUUID();
            fake.deliver(next);
            expect(changes).toEqual([person, next]);
        } finally {
            await close();
        }
    });

    it("🔴 Datenbank weg: eine Probe, die sie nicht annimmt, zählt nicht; hört das Abonnement danach, bleibt es", async () => {
        const fake = fakeDatabase();
        const { resyncs, started } = watch(fake);
        const close = await started;
        try {
            await until(() => fake.state.probes >= 1, 1_000);
            fake.state.down = true;
            const listens = fake.state.listens;
            await new Promise((resolve) => setTimeout(resolve, 100));
            fake.state.down = false;
            const probes = fake.state.probes;
            await until(() => fake.state.probes >= probes + 3, 1_000);
            expect([fake.state.listens, resyncs()]).toEqual([listens, 0]);
        } finally {
            await close();
        }
    });

    it("🔴 postgres.js hört selbst neu (`onlisten`): onResync, und die Probe von davor zählt nicht als verloren", async () => {
        const fake = fakeDatabase();
        const { resyncs, started } = watch(fake, 150);
        const close = await started;
        try {
            // Die Verbindung von LISTEN ist weg, die Datenbank nimmt die Probe aber an: sie kommt nicht zurück.
            fake.state.deaf = true;
            const probes = fake.state.probes;
            await until(() => fake.state.probes > probes, 1_000);
            // Bevor der nächste Takt sie vermisst, baut postgres.js das Abonnement selbst neu auf.
            fake.state.deaf = false;
            fake.listeners.at(-1)!.listening?.();
            expect(resyncs()).toBe(1);
            const listens = fake.state.listens;
            const after = fake.state.probes;
            await until(() => fake.state.probes >= after + 3, 2_000);
            expect([fake.state.listens, resyncs()]).toEqual([listens, 1]);
        } finally {
            await close();
        }
    });

    it("🔴 LISTEN scheitert schon beim Start: der Takt versucht es wieder, und erst dann zählt ein Verlust", async () => {
        const fake = fakeDatabase();
        fake.state.listenFails = true;
        const { changes, resyncs, started } = watch(fake);
        const close = await started;
        try {
            await until(() => fake.state.listens >= 3, 1_000);
            expect(fake.state.probes).toBe(0);
            fake.state.listenFails = false;
            await until(() => resyncs() >= 1, 1_000);
            const person = randomUUID();
            fake.deliver(person);
            expect(changes).toEqual([person]);
        } finally {
            await close();
        }
    });

    it("Proben anderer Wächter und Instanzen und fremde Nutzlast zählen nicht", async () => {
        const fake = fakeDatabase();
        const { changes, resyncs, started } = watch(fake);
        const close = await started;
        try {
            fake.deliver("probe:fremd:1");
            fake.deliver("kein-uuid");
            await until(() => fake.state.probes >= 3, 1_000);
            expect(changes).toEqual([]);
            expect(resyncs()).toBe(0);
        } finally {
            await close();
        }
        // Nach dem Schließen keine Probe mehr.
        const probes = fake.state.probes;
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(fake.state.probes).toBe(probes);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Wächter über Entzüge gegen PostgreSQL, Datenbank über ein Relais", { timeout: 60_000 }, () => {
    let direct: Database;

    beforeAll(() => {
        direct = createDatabase(testDatabaseUrl as string, { max: 1 });
    });

    afterAll(async () => {
        await direct.end({ timeout: 5 });
    });

    const notify = (personId: string) => direct`SELECT pg_notify(${AUTH_CHANGE_CHANNEL}, ${personId})`;

    /** Zwei Wächter auf derselben Verbindung, wie Tür und `/ws` in einer Instanz. */
    async function pair(database: Database, tickMs: number) {
        const seen = [new Set<string>(), new Set<string>()];
        const resyncs = [0, 0];
        const closers = await Promise.all(
            [0, 1].map((i) =>
                watchAuthChanges(
                    database,
                    (personId) => seen[i]!.add(personId),
                    undefined,
                    () => (resyncs[i]! += 1),
                    { tickMs },
                ),
            ),
        );
        return { seen, resyncs, close: () => Promise.all(closers.map((close) => close())) };
    }

    for (const [name, outageMs] of [
        ["1 s", 1_000],
        ["200 ms", 200],
    ] as const) {
        it(`🔴 Datenbank ${name} weg: beide Wächter melden den möglichen Verlust, und ein Entzug kommt wieder an`, async () => {
            const relay = await relayTo(testDatabaseUrl as string);
            const viaRelay = createDatabase(relay.url, { max: 2, connectTimeoutS: 1 });
            const watchers = await pair(viaRelay, 100);
            try {
                const before = randomUUID();
                await notify(before);
                await until(() => watchers.seen.every((set) => set.has(before)), 2_000);

                await relay.cut();
                await new Promise((resolve) => setTimeout(resolve, outageMs));
                await relay.restore();
                await until(() => watchers.resyncs.every((count) => count >= 1), 20_000);
                // postgres.js hört nach seiner Pause (höchstens 1 s) wieder; bis dahin prüfen die Wächter neu.
                const end = Date.now() + 20_000;
                let heard = false;
                while (!heard && Date.now() < end) {
                    const after = randomUUID();
                    await notify(after);
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    heard = watchers.seen.every((set) => set.has(after));
                }
                expect(heard).toBe(true);
            } finally {
                await watchers.close();
                await viaRelay.end({ timeout: 1 });
                await relay.close();
            }
        });
    }
});
