import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { SYSTEM_CHANNEL, SystemStateStore } from "../src/system/state-store.ts";

/**
 * Der Betriebszustand im Speicher einer Instanz (WI-0127 SYS-2, SYS-0001 §3.2, §7.1 „Store: Fehlerrichtung, Revision, Resync“), ohne
 * Datenbank: eine nachgebaute Verbindung, die liest, scheitert oder eine Tabelle vermisst, und eine eigene Uhr.
 *
 * Problemfälle: vor dem ersten Lesen, Datenbank weg, Datenbank zurück, Stand zu alt, Tabelle fehlt (vor `migrate`), Zeile fehlt,
 * `LISTEN` scheitert, `LISTEN` verbindet neu, ein Lesen während eines Lesens. Soll: nie Normal, wenn der Zustand nicht bekannt ist;
 * nach jedem Wiederverbinden neu gelesen; wer nach seiner Änderung fragt, sieht sie.
 */

interface Row {
    mode: "normal" | "restricted";
    map_lock: boolean;
    system_lock: boolean;
    revision: number;
}

function stateRow(row: Row): Record<string, unknown> {
    const since = new Date("2026-10-10T08:00:00Z");
    return {
        mode: row.mode,
        mode_since: since,
        mode_by: null,
        mode_by_label: null,
        mode_reason: row.mode === "restricted" ? "Probe" : null,
        map_lock: row.map_lock,
        map_lock_since: null,
        map_lock_by: null,
        map_lock_by_label: null,
        map_lock_reason: row.map_lock ? "Probe" : null,
        system_lock: row.system_lock,
        system_lock_since: null,
        system_lock_by: null,
        system_lock_by_label: null,
        system_lock_reason: row.system_lock ? "Probe" : null,
        revision: row.revision,
        content_revision: 1,
        updated_at: since,
    };
}

const failure = (code: string) => Object.assign(new Error(`gescheitert (${code})`), { code });

/** Eine Verbindung, deren Antworten der Test vorgibt; `order` hält fest, ob zuerst gehört oder gelesen wurde. */
function fakeDatabase() {
    let answer: () => Promise<unknown[]> = async () => [
        stateRow({ mode: "normal", map_lock: false, system_lock: false, revision: 1 }),
    ];
    let listenAnswer: () => Promise<void> = async () => undefined;
    const order: string[] = [];
    const listeners: { onNotify: (payload: string) => void; onListen: (() => void) | undefined }[] = [];
    let reads = 0;
    const database = ((strings: TemplateStringsArray) => {
        if (!strings.join("").includes("FROM system_state")) return {};
        reads += 1;
        order.push("lesen");
        return answer();
    }) as unknown as Database;
    Object.assign(database, {
        listen: async (channel: string, onNotify: (payload: string) => void, onListen?: () => void) => {
            order.push(`hören ${channel}`);
            await listenAnswer();
            const listener = { onNotify, onListen };
            listeners.push(listener);
            onListen?.();
            return {
                unlisten: async () => {
                    listeners.splice(listeners.indexOf(listener), 1);
                },
            };
        },
    });
    return {
        database,
        order,
        listeners,
        reads: () => reads,
        rows(row: Row) {
            answer = async () => [stateRow(row)];
        },
        answer(next: () => Promise<unknown[]>) {
            answer = next;
        },
        listen(next: () => Promise<void>) {
            listenAnswer = next;
        },
    };
}

function quietLog() {
    const lines: { level: string; message: string; fields: Record<string, unknown> }[] = [];
    return {
        lines,
        log: {
            warn: (fields: Record<string, unknown>, message: string) =>
                void lines.push({ level: "warn", message, fields }),
            info: (fields: Record<string, unknown>, message: string) =>
                void lines.push({ level: "info", message, fields }),
        },
    };
}

let store: SystemStateStore | undefined;
afterEach(async () => {
    await store?.close();
    store = undefined;
});

describe("Betriebszustand im Speicher", () => {
    it("🔴 vor dem ersten Lesen unbekannt: Stellung und Sperren null, nie Normal, nicht bereit", () => {
        store = new SystemStateStore({ database: fakeDatabase().database });
        expect(store.snapshot()).toMatchObject({
            source: "unknown",
            mode: null,
            mapLock: null,
            systemLock: null,
            revision: null,
            ready: false,
        });
    });

    it("🔴 erst hören, dann lesen; danach steht der gelesene Zustand im Speicher", async () => {
        const fake = fakeDatabase();
        fake.rows({ mode: "restricted", map_lock: true, system_lock: false, revision: 7 });
        store = new SystemStateStore({ database: fake.database, tickMs: 60_000 });
        await store.start();
        expect(fake.order).toEqual([`hören ${SYSTEM_CHANNEL}`, "lesen"]);
        expect(store.snapshot()).toMatchObject({
            source: "database",
            mode: "restricted",
            mapLock: true,
            systemLock: false,
            revision: 7,
            contentRevision: 1,
            ready: true,
            listen: { connected: true, generation: 1 },
        });
    });

    it("🔴 Datenbank weg: sofort unbekannt (fail-closed); zurück: wieder bekannt, und es wird neu gehört", async () => {
        const fake = fakeDatabase();
        const { lines, log } = quietLog();
        store = new SystemStateStore({ database: fake.database, tickMs: 60_000, log });
        await store.start();
        fake.answer(() => Promise.reject(failure("ECONNREFUSED")));
        const gone = await store.refresh();
        expect(gone).toMatchObject({ source: "unknown", mode: null, mapLock: null, systemLock: null, ready: false });
        expect(gone.listen.connected).toBe(false);
        // Ein zweiter Fehlschlag schreibt keine zweite Zeile.
        await store.refresh();
        expect(lines.filter((line) => line.level === "warn")).toEqual([
            {
                level: "warn",
                message: "system: Betriebszustand unbekannt, Schreibwege antworten 503",
                fields: { code: "ECONNREFUSED" },
            },
        ]);
        fake.rows({ mode: "normal", map_lock: false, system_lock: true, revision: 9 });
        const back = await store.refresh();
        expect(back).toMatchObject({ source: "database", mode: "normal", systemLock: true, revision: 9, ready: true });
        // postgres.js verwirft ein Abonnement still, wenn sein eigener Neuaufbau scheitert: Der Speicher hört deshalb neu.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(fake.listeners).toHaveLength(1);
        expect(store.snapshot().listen).toMatchObject({ connected: true, generation: 2 });
    });

    it("🔴 ohne erfolgreiches Lesen höchstens 30 s der letzte Stand; bereit nur bis zwei Takte", async () => {
        const fake = fakeDatabase();
        let now = 1_000_000;
        store = new SystemStateStore({ database: fake.database, tickMs: 60_000, now: () => now });
        await store.start();
        expect(store.snapshot()).toMatchObject({ source: "database", mode: "normal", ready: true });
        now += 10_001;
        expect(store.snapshot()).toMatchObject({ source: "database", mode: "normal", ready: false });
        now += 19_999;
        expect(store.snapshot()).toMatchObject({ source: "database", mode: "normal" });
        now += 1;
        expect(store.snapshot()).toMatchObject({ source: "unknown", mode: null, ready: false });
    });

    it("🔴 Tabelle fehlt (Fastify vor `migrate`): Normal wie bisher, eine WARN-Zeile; fehlt die ZEILE, ist der Zustand unbekannt", async () => {
        const fake = fakeDatabase();
        const { lines, log } = quietLog();
        fake.answer(() => Promise.reject(failure("42P01")));
        store = new SystemStateStore({ database: fake.database, tickMs: 60_000, log });
        await store.start();
        await store.refresh();
        expect(store.snapshot()).toMatchObject({
            source: "unprovisioned",
            mode: "normal",
            mapLock: false,
            systemLock: false,
            revision: null,
            ready: true,
        });
        expect(lines.map((line) => line.message)).toEqual([
            "system: Tabelle system_state fehlt (vor migrate), es gilt Normal",
        ]);
        fake.answer(async () => []);
        expect(await store.refresh()).toMatchObject({ source: "unknown", mode: null });
        // Ein fehlendes Recht ist kein „noch nicht migriert“: unbekannt.
        fake.answer(() => Promise.reject(failure("42501")));
        expect(await store.refresh()).toMatchObject({ source: "unknown", mode: null });
    });

    it("🔴 eine Meldung liest neu; nach jedem Wiederverbinden von LISTEN wird neu gelesen, beim ersten Hören nicht doppelt", async () => {
        const fake = fakeDatabase();
        let now = 5_000;
        store = new SystemStateStore({ database: fake.database, tickMs: 60_000, now: () => now });
        await store.start();
        expect(fake.reads()).toBe(1);
        fake.rows({ mode: "restricted", map_lock: false, system_lock: false, revision: 2 });
        fake.listeners[0]!.onNotify("2");
        await store.refresh();
        expect(store.snapshot().revision).toBe(2);
        const readsBefore = fake.reads();
        now = 6_000;
        fake.rows({ mode: "normal", map_lock: false, system_lock: false, revision: 3 });
        // So ruft postgres.js nach einem Verbindungsverlust: Meldungen dazwischen sind verloren.
        fake.listeners[0]!.onListen?.();
        await store.refresh();
        expect(fake.reads()).toBeGreaterThan(readsBefore);
        expect(store.snapshot()).toMatchObject({ revision: 3, mode: "normal" });
        expect(store.snapshot().listen).toMatchObject({ generation: 2, lastResyncAt: new Date(6_000) });
    });

    it("🔴 fragt jemand während eines laufenden Lesens, folgt genau ein weiteres: er sieht nie den Stand von davor", async () => {
        const fake = fakeDatabase();
        store = new SystemStateStore({ database: fake.database, tickMs: 60_000 });
        await store.start();
        let release: (() => void) | undefined;
        fake.answer(
            () =>
                new Promise((resolve) => {
                    release = () =>
                        resolve([stateRow({ mode: "normal", map_lock: false, system_lock: false, revision: 4 })]);
                }),
        );
        const first = store.refresh();
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Die Änderung ist geschrieben, während das alte Lesen noch läuft.
        fake.rows({ mode: "restricted", map_lock: false, system_lock: false, revision: 5 });
        const second = store.refresh();
        // Takt und Meldungen fragen weiter, solange das langsame Lesen läuft: Sie teilen das EINE folgende Lesen.
        const more = [store.refresh(), store.refresh(), store.refresh()];
        release?.();
        expect((await first).revision).toBe(4);
        expect((await second).revision).toBe(5);
        for (const later of more) expect((await later).revision).toBe(5);
        expect(fake.reads()).toBe(3);
    });

    it("🔴 ein Lesen, das länger dauert als der Takt, hält niemanden auf: höchstens zwei Lesen bis zur Antwort", async () => {
        const fake = fakeDatabase();
        store = new SystemStateStore({ database: fake.database, tickMs: 5 });
        await store.start();
        fake.answer(
            () =>
                new Promise((resolve) =>
                    setTimeout(
                        () => resolve([stateRow({ mode: "normal", map_lock: false, system_lock: false, revision: 6 })]),
                        40,
                    ),
                ),
        );
        const started = Date.now();
        expect((await store.refresh()).revision).toBe(6);
        expect(Date.now() - started).toBeLessThan(500);
    });

    it("🔴 LISTEN scheitert beim Start: eine WARN-Zeile, der Takt liest weiter und versucht das Hören erneut", async () => {
        const fake = fakeDatabase();
        const { lines, log } = quietLog();
        let attempts = 0;
        fake.listen(async () => {
            attempts += 1;
            if (attempts === 1) throw failure("ECONNREFUSED");
        });
        store = new SystemStateStore({ database: fake.database, tickMs: 20, log });
        await store.start();
        expect(store.snapshot()).toMatchObject({ source: "database", listen: { connected: false, generation: 0 } });
        expect(lines.some((line) => line.message.startsWith("system: LISTEN nicht möglich"))).toBe(true);
        const deadline = Date.now() + 2_000;
        while (store.snapshot().listen.generation === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(store.snapshot().listen).toMatchObject({ connected: true, generation: 1 });
        expect(fake.listeners).toHaveLength(1);
    });

    it("schließen hört auf zu hören und liest nicht mehr", async () => {
        const fake = fakeDatabase();
        store = new SystemStateStore({ database: fake.database, tickMs: 10 });
        await store.start();
        await store.close();
        const reads = fake.reads();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(fake.reads()).toBe(reads);
        expect(fake.listeners).toHaveLength(0);
    });
});
