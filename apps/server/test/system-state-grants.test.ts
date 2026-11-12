import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAuthCli } from "../src/auth/cli-commands.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte am Betriebszustand aus Migration 0087 (WI-0127 SYS-2, SYS-0001 §5.1 „Grants“), so wie auf dem VPS: Wegwerf-Cluster mit
 * den Rollen und Default-Privilegien des VPS, `grants_sql_tmpl`, dann `apps/server/src/db/system-grants.psql` (die Vorlage für
 * Claudios Zeile).
 *
 * 🔴 Die App liest die eine Zeile und schaltet sie um, legt nie eine an und löscht nie; PUBLIC und die Kachelrolle dürfen nichts, die
 * Jobs-Rolle nur lesen (für die Zulassung unter Sperre, SYS-4). Die Kommandozeile läuft auf dem VPS mit der App-`.env`: Sie muss mit
 * genau diesen Rechten schalten und protokollieren können. Ohne `system-grants.psql` fällt der Test (Gegenprobe im Work Item).
 */

const ENV = "sysgrants";
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
type Privilege = (typeof PRIVILEGES)[number];

/** Was die App-Rolle an jeder Tabelle aus 0087 darf. Eine neue Tabelle ohne Zeile hier lässt den Test fallen. */
const APP_MAY: Readonly<Record<string, readonly Privilege[]>> = {
    system_state: ["SELECT", "UPDATE"],
};

const systemGrants = fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url));
const migrationFile = fileURLToPath(new URL("../migrations/0087_system_state.sql", import.meta.url));
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Betriebszustand: Rechte der Rollen wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [systemGrants]);
    }, 180_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    async function granted(role: string, table: string): Promise<Privilege[]> {
        const rows = await cluster!.admin.unsafe<{ privilege: Privilege; ok: boolean }[]>(
            `SELECT p AS privilege, has_table_privilege($1, $2, p) AS ok FROM unnest($3::text[]) AS p`,
            [role, `public.${table}`, [...PRIVILEGES]] as never[],
        );
        return rows.filter((row) => row.ok).map((row) => row.privilege);
    }

    /** SQLSTATE je Anweisung, als `role` per `SET LOCAL ROLE`; die Transaktion wird immer zurückgerollt. */
    async function asRole(role: string, statements: string[]): Promise<string[]> {
        const codes: string[] = [];
        try {
            await cluster!.admin.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL ROLE ${role}`);
                for (const sql of statements) {
                    await tx.unsafe("SAVEPOINT probe");
                    try {
                        await tx.unsafe(sql);
                        await tx.unsafe("RELEASE SAVEPOINT probe");
                        codes.push("ok");
                    } catch (error) {
                        await tx.unsafe("ROLLBACK TO SAVEPOINT probe");
                        codes.push((error as { code?: string }).code ?? "fehler");
                    }
                }
                throw new Error("__zurueck__");
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "__zurueck__") throw error;
        }
        return codes;
    }

    it("jede Tabelle aus 0087 hat hier eine Zusage", () => {
        const created = [...readFileSync(migrationFile, "utf8").matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(
            (match) => match[1] as string,
        );
        expect(created.sort()).toEqual(Object.keys(APP_MAY).sort());
    });

    it("🔴 App liest und schaltet um, legt nie an und löscht nie; PUBLIC und Kachelrolle nichts, Jobs nur lesen", async () => {
        const { roles } = cluster!;
        for (const [table, may] of Object.entries(APP_MAY)) {
            expect(await granted(roles.app, table), `App an ${table}`).toEqual(may);
            expect(await granted("public", table), `PUBLIC an ${table}`).toEqual([]);
            expect(await granted(roles.tiles, table), `Kachelrolle an ${table}`).toEqual([]);
            expect(await granted(roles.jobs, table), `Jobs-Rolle an ${table}`).toEqual(["SELECT"]);
        }
    });

    it("🔴 per SET ROLE: die App schaltet um (Revision und Weckruf laufen mit ihren Rechten), anlegen, löschen und leeren scheitern", async () => {
        const { roles } = cluster!;
        expect(
            await asRole(roles.app, [
                "UPDATE system_state SET mode = 'restricted', mode_reason = 'Probe' WHERE id = 1",
                `DO $$ BEGIN
                     IF (SELECT revision FROM system_state WHERE id = 1) <> 2 THEN
                         RAISE EXCEPTION 'Revision nicht gezählt' USING ERRCODE = 'P0001';
                     END IF;
                 END $$`,
                "INSERT INTO system_state (id) VALUES (1) ON CONFLICT DO NOTHING",
                "DELETE FROM system_state",
                "TRUNCATE system_state",
            ]),
        ).toEqual(["ok", "ok", "42501", "42501", "42501"]);
        expect(
            await asRole(roles.jobs, [
                "SELECT mode FROM system_state",
                "UPDATE system_state SET mode = 'normal' WHERE false",
            ]),
        ).toEqual(["ok", "42501"]);
        expect(await asRole(roles.tiles, ["SELECT mode FROM system_state"])).toEqual(["42501"]);
    });

    it("🔴 Funktionen: PUBLIC ruft weder den Weckruf noch das Schwärzen; die App behält das Schwärzen nach der neuen Fassung", async () => {
        const { admin, roles } = cluster!;
        const [row] = await admin<
            {
                notify_public: boolean;
                redact_public: boolean;
                redact_app: boolean;
                redact_jobs: boolean;
                config: string[] | null;
            }[]
        >`
            SELECT has_function_privilege('public', 'public.system_state_notify()', 'EXECUTE') AS notify_public,
                   has_function_privilege('public', 'avesmaps_auth.redact_person_events(uuid)', 'EXECUTE') AS redact_public,
                   has_function_privilege(${roles.app}, 'avesmaps_auth.redact_person_events(uuid)', 'EXECUTE') AS redact_app,
                   has_function_privilege(${roles.jobs}, 'avesmaps_auth.redact_person_events(uuid)', 'EXECUTE') AS redact_jobs,
                   (SELECT proconfig FROM pg_proc WHERE oid = 'avesmaps_auth.redact_person_events(uuid)'::regprocedure) AS config
        `;
        expect(row).toEqual({
            notify_public: false,
            redact_public: false,
            redact_app: true,
            redact_jobs: false,
            config: ["search_path=pg_catalog, pg_temp"],
        });
    });

    it("🔴 die Kommandozeile schaltet mit genau den Rechten der App-Rolle, ohne Sitzung, und protokolliert jede Änderung", async () => {
        const { app, admin } = cluster!;
        const lines: string[] = [];
        const io = { out: (line: string) => void lines.push(line), err: (line: string) => void lines.push(line) };
        const run = (...argv: string[]) =>
            runAuthCli(argv, { AVESMAPS_ENV: "test" }, io, { database: app, systemUser: "root" });
        expect(await run("betrieb-einschraenken", "--grund", "Rollentest")).toBe(0);
        expect(await run("sperre-setzen", "--art", "system", "--grund", "Rollentest")).toBe(0);
        expect(await run("betrieb-zeigen")).toBe(0);
        expect(await run("betrieb-normal")).toBe(0);
        expect(await run("sperre-loesen")).toBe(0);
        // Revision 1 aus der Migration (der Fall davor rollte zurück): einschränken 2, sperren 3, zurück auf Normal 4.
        expect(lines).toContain(
            "Betrieb: Normal (vorher Eingeschränkt), Revision 4. Jede Instanz übernimmt es binnen einer Sekunde.",
        );
        const events = await admin<{ action: string; actor_label: string }[]>`
            SELECT action, actor_label FROM avesmaps_auth.security_event WHERE actor_kind = 'cli' ORDER BY id
        `;
        expect(events).toEqual([
            { action: "system.mode_changed", actor_label: "cli:root" },
            { action: "system.lock_changed", actor_label: "cli:root" },
            { action: "system.mode_changed", actor_label: "cli:root" },
            { action: "system.lock_changed", actor_label: "cli:root" },
        ]);
        const [state] = await admin<{ mode: string; map_lock: boolean; system_lock: boolean }[]>`
            SELECT mode, map_lock, system_lock FROM system_state
        `;
        expect(state).toEqual({ mode: "normal", map_lock: false, system_lock: false });
    });
});
