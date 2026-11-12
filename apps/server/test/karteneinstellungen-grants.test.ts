import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Queryable } from "../src/database.ts";
import { leseKarteneinstellungen, verstelleKarteneinstellung } from "../src/system/karteneinstellungen.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte an den Karteneinstellungen (WI-0166, Migrationen 0134 und 0136), so wie auf dem VPS: Wegwerf-Cluster mit den Rollen
 * und Default-Privilegien des VPS, dann `apps/server/src/db/system-grants.psql`.
 *
 * 🔴 **Anlass:** In Production scheiterte das Speichern mit „permission denied for table map_setting_state“ (Claudio 2026-10-15).
 * Der Schreibweg sperrte die Revisionszeile mit `SELECT … FOR UPDATE`, und das verlangt das UPDATE-Recht, das die App dort nicht
 * haben soll. Lokal und in den übrigen Tests fiel es nicht auf, weil dort als Eigentümer gearbeitet wird. Darum schreibt dieser
 * Wächter als App-Rolle — und zwar auch OHNE das UPDATE-Recht, das Claudio als Notbehelf vergeben hat: So hält der Test fest, dass
 * der Code es nicht mehr braucht, bevor es im nächsten Release wieder entzogen wird.
 */

const ENV = "karteneinst";
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
type Privilege = (typeof PRIVILEGES)[number];

/**
 * Was die App-Rolle an den beiden Tafeln darf. `map_setting`: anlegen, ändern, beim Zurücksetzen löschen, nie leeren.
 * `map_setting_state`: lesen; das UPDATE ist Claudios Notbehelf vom 2026-10-15 und fällt im Release nach dieser Änderung weg
 * (dann steht hier nur noch `SELECT`, und der Test unten läuft unverändert).
 */
const APP_MAY: Readonly<Record<string, readonly Privilege[]>> = {
    map_setting: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    map_setting_state: ["SELECT", "UPDATE"],
};

const systemGrants = fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url));
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Karteneinstellungen: Rechte und Schreibweg als App-Rolle (Wegwerf-Cluster)", () => {
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

    /** Läuft als App-Rolle in einer Transaktion, die immer zurückgerollt wird; `ohneUpdate` nimmt ihr das UPDATE vorher weg. */
    async function alsApp<T>(ohneUpdate: boolean, arbeit: (tx: Queryable) => Promise<T>): Promise<T> {
        let ergebnis: T | undefined;
        try {
            await cluster!.admin.begin(async (tx) => {
                if (ohneUpdate) await tx.unsafe(`REVOKE UPDATE ON map_setting_state FROM ${cluster!.roles.app}`);
                await tx.unsafe(`SET LOCAL ROLE ${cluster!.roles.app}`);
                ergebnis = await arbeit(tx);
                throw new Error("__zurueck__");
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "__zurueck__") throw error;
        }
        return ergebnis as T;
    }

    it("🔴 die App darf an den Tafeln genau das, was die Wege brauchen; PUBLIC nichts", async () => {
        for (const [table, may] of Object.entries(APP_MAY)) {
            expect(await granted(cluster!.roles.app, table), `App an ${table}`).toEqual(may);
            expect(await granted("public", table), `PUBLIC an ${table}`).toEqual([]);
        }
    });

    it("🔴 der Schreibweg läuft als App-Rolle, auch ohne UPDATE an der Revisionstafel; die Revision hebt der Trigger", async () => {
        const nachher = await alsApp(true, async (tx) => {
            const vorher = await leseKarteneinstellungen(tx);
            const ergebnis = await verstelleKarteneinstellung(tx, {
                id: "startZoom",
                value: 4,
                baseRevision: vorher.revision!,
                actor: { personId: null, label: "Wächter WI-0166" },
            });
            return { vorher: vorher.revision, ergebnis, stand: await leseKarteneinstellungen(tx) };
        });
        expect(nachher.ergebnis).toMatchObject({ from: null, to: 4 });
        expect(nachher.ergebnis.revision).toBe(nachher.vorher! + 1);
        expect([...nachher.stand.zeilen.keys()]).toEqual(["startZoom"]);
    });

    it("🔴 die Revision selbst kann die App nicht schreiben, auch nicht anlegen oder löschen", async () => {
        const codes: string[] = [];
        for (const sql of [
            "INSERT INTO map_setting_state (id) VALUES (1) ON CONFLICT DO NOTHING",
            "DELETE FROM map_setting_state",
            "TRUNCATE map_setting",
            "UPDATE map_setting_state SET revision = revision + 1",
        ]) {
            codes.push(
                await alsApp(true, async (tx) => {
                    try {
                        await tx.unsafe(sql);
                        return "ok";
                    } catch (error) {
                        return (error as { code?: string }).code ?? "fehler";
                    }
                }),
            );
        }
        expect(codes).toEqual(["42501", "42501", "42501", "42501"]);
    });
});
