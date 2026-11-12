import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { lockAdministration } from "../src/auth/admin-guard.ts";
import { changeLock, changeMode, restrictedAccessHolders } from "../src/system/state-changes.ts";
import { SystemStateStore } from "../src/system/state-store.ts";
import { authFixture } from "./support/auth-fixture.ts";

/**
 * Der Betriebszustand auf der Kommandozeile (WI-0127 SYS-2, SYS-0001 §4.7, §7.2 „alle Inhaber ausgesperrt“; Claudio 2026-10-09
 * Punkt 6): `betrieb-normal`, `sperre-loesen`, dazu `betrieb-einschraenken`, `sperre-setzen`, `betrieb-zeigen`.
 *
 * Problemfälle: eingeschränkt UND beide Sperren gesetzt, und niemand kommt mehr hinein (Sitzungen beendet, Passkeys widerrufen); ein
 * zweiter Aufruf ohne Wirkung; fehlender Grund, unbekannte Sperre; Einschränken, obwohl niemand einen Passkey hat. Soll: ohne
 * Sitzung sofort wirksam, auf einer laufenden Instanz binnen 1 s, genau ein Protokolleintrag je Änderung als `cli:<Benutzer>`, keiner
 * ohne Änderung.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const USER = "sys2-test";
const ENVIRONMENT = { AVESMAPS_ENV: "test" };

describeWithDatabase("Betriebszustand auf der Kommandozeile", { timeout: 60_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let store: SystemStateStore | undefined;

    async function resetState(): Promise<void> {
        await database`
            UPDATE system_state
               SET mode = 'normal', mode_by = NULL, mode_by_label = NULL, mode_reason = NULL,
                   map_lock = false, map_lock_since = NULL, map_lock_by = NULL, map_lock_by_label = NULL, map_lock_reason = NULL,
                   system_lock = false, system_lock_since = NULL, system_lock_by = NULL, system_lock_by_label = NULL,
                   system_lock_reason = NULL
             WHERE id = 1
        `;
    }

    async function cli(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runAuthCli(
            argv,
            ENVIRONMENT,
            { out: (line) => void out.push(line), err: (line) => void err.push(line) },
            { database, systemUser: USER },
        );
        return { code, out, err };
    }

    const cliEvents = () =>
        database<
            {
                action: string;
                actor_kind: string;
                actor_label: string;
                operation_id: string | null;
                details: Record<string, unknown>;
            }[]
        >`
            SELECT action, actor_kind, actor_label, operation_id, details FROM avesmaps_auth.security_event
             WHERE actor_label = ${`cli:${USER}`} ORDER BY id
        `;

    const state = async () => {
        const [row] = await database<
            { mode: string; map_lock: boolean; system_lock: boolean; mode_by_label: string | null }[]
        >`
            SELECT mode, map_lock, system_lock, mode_by_label FROM system_state WHERE id = 1
        `;
        return row!;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        await resetState();
    });

    afterEach(async () => {
        await store?.close();
        store = undefined;
        await database`DELETE FROM avesmaps_auth.security_event WHERE actor_label = ${`cli:${USER}`}`;
        await fixture.cleanup();
        await resetState();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    it("🔴 alle Inhaber ausgesperrt: `betrieb-normal` und `sperre-loesen` ohne Sitzung heben es auf, sofort auf einer laufenden Instanz", async () => {
        // Ein Betreiber schränkt ein und sperrt beides; danach verliert er Sitzung und Passkey.
        const operator = await fixture.person("operator", { name: "Rondrikan" });
        await database`
            INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, created_via)
            VALUES (${operator.id}, 'test', 'avesmaps.test', ${randomBytes(16).toString("hex")}, ${randomBytes(8)}, 'passkey')
        `;
        await database.begin(async (tx) => {
            await lockAdministration(tx, "test");
            const actor = { kind: "person", personId: operator.id } as const;
            await changeMode(tx, { environment: "test", mode: "restricted", reason: "Probe", actor });
            await changeLock(tx, { environment: "test", lock: "map", locked: true, reason: "Probe", actor });
            await changeLock(tx, { environment: "test", lock: "system", locked: true, reason: "Probe", actor });
        });
        await database`UPDATE avesmaps_auth.session SET revoked_at = now() WHERE person_id = ${operator.id}`;
        await database`UPDATE avesmaps_auth.passkey_credential SET revoked_at = now() WHERE person_id = ${operator.id}`;

        store = new SystemStateStore({
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            tickMs: 60_000,
        });
        await store.start();
        expect(store.snapshot()).toMatchObject({ mode: "restricted", mapLock: true, systemLock: true });

        const started = performance.now();
        const normal = await cli("betrieb-normal");
        expect(normal.code).toBe(0);
        expect(normal.out.join("\n")).toMatch(/^Betrieb: Normal \(vorher Eingeschränkt\), Revision \d+\./u);
        const unlock = await cli("sperre-loesen");
        expect(unlock.code).toBe(0);
        expect(unlock.out.slice(0, 2)).toEqual([
            expect.stringMatching(/^Kartensperre: gelöst/u),
            expect.stringMatching(/^Systemsperre: gelöst/u),
        ]);
        const deadline = started + 1_000;
        while (store.snapshot().systemLock !== false && performance.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(performance.now() - started).toBeLessThan(1_000);
        expect(store.snapshot()).toMatchObject({ mode: "normal", mapLock: false, systemLock: false });
        expect(await state()).toMatchObject({
            mode: "normal",
            map_lock: false,
            system_lock: false,
            mode_by_label: `cli:${USER}`,
        });

        expect(await cliEvents()).toEqual([
            {
                action: "system.mode_changed",
                actor_kind: "cli",
                actor_label: `cli:${USER}`,
                operation_id: null,
                details: { from: "restricted", to: "normal", reason: null },
            },
            {
                action: "system.lock_changed",
                actor_kind: "cli",
                actor_label: `cli:${USER}`,
                operation_id: null,
                details: { lock: "map", from: true, to: false, reason: null },
            },
            {
                action: "system.lock_changed",
                actor_kind: "cli",
                actor_label: `cli:${USER}`,
                operation_id: null,
                details: { lock: "system", from: true, to: false, reason: null },
            },
        ]);
        await store.close();
    });

    it("🔴 ohne Wirkung kein Eintrag: ein zweiter Aufruf sagt „Nichts geändert“ und endet mit 0", async () => {
        const normal = await cli("betrieb-normal");
        expect(normal).toEqual({ code: 0, out: ["Der Betrieb steht schon auf Normal. Nichts geändert."], err: [] });
        const unlock = await cli("sperre-loesen", "--art", "karte");
        expect(unlock).toEqual({ code: 0, out: ["Kartensperre: schon offen. Nichts geändert."], err: [] });
        expect(await cliEvents()).toEqual([]);
    });

    it("🔴 setzen geht auch: Grund Pflicht, unbekannte Sperre abgewiesen; Einschränken ohne Passkey-Inhaber nur mit Warnung", async () => {
        expect((await cli("betrieb-einschraenken")).code).toBe(2);
        expect((await cli("sperre-setzen", "--art", "karte")).code).toBe(2);
        const unknown = await cli("sperre-setzen", "--art", "boden", "--grund", "x");
        expect([unknown.code, unknown.err]).toEqual([2, ["Unbekannte Sperre: boden (karte oder system)."]]);
        expect(await cliEvents()).toEqual([]);

        // Die Warnung hängt an der ganzen Umgebung; ein Rest eines abgebrochenen Laufs mit Passkey nähme sie weg.
        const someoneGetsIn = (await restrictedAccessHolders(database, "test")).some((holder) => holder.hasPasskey);
        const restricted = await cli("betrieb-einschraenken", "--grund", "Wartung der Datenbank");
        expect(restricted.code).toBe(0);
        expect(restricted.err).toEqual(
            someoneGetsIn
                ? []
                : [
                      "Warnung: Niemand mit dem Zugangsrecht hat in dieser Umgebung einen Passkey; im eingeschränkten Betrieb käme niemand hinein.",
                  ],
        );
        const lock = await cli("sperre-setzen", "--art", "karte", "--grund", "Umzug");
        expect(lock.code).toBe(0);
        const shown = await cli("betrieb-zeigen");
        expect(shown.code).toBe(0);
        expect(shown.out[0]).toMatch(
            /^Betrieb: Eingeschränkt · seit .+ · cli:sys2-test · Grund: Wartung der Datenbank$/u,
        );
        expect(shown.out[1]).toMatch(/^Kartensperre: gesetzt · seit .+ · cli:sys2-test · Grund: Umzug$/u);
        expect(shown.out[2]).toBe("Systemsperre: offen");
        // Die Warteschlange steht seit WI-0160 mit in der Übersicht — und ist hier nicht pausiert.
        expect(shown.out[3]).toBe("Warteschlange: läuft");
        expect(shown.out[4]).toMatch(/^Revision \d+ · Inhaltsrevision \d+$/u);
        expect((await cliEvents()).map((event) => [event.action, event.details])).toEqual([
            ["system.mode_changed", { from: "normal", to: "restricted", reason: "Wartung der Datenbank" }],
            ["system.lock_changed", { lock: "map", from: false, to: true, reason: "Umzug" }],
        ]);
    });

    it("die Hilfe nennt die Befehle des Betriebszustands", async () => {
        const help = await cli("hilfe");
        expect(help.code).toBe(0);
        for (const command of [
            "betrieb-zeigen",
            "betrieb-normal",
            "betrieb-einschraenken",
            "sperre-setzen",
            "sperre-loesen",
        ]) {
            expect(help.out.join("\n")).toContain(command);
        }
    });
});
