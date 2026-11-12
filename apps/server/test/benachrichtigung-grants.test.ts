import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte an den Benachrichtigungen aus Migration 0107 (WI-0136 N2), so wie auf dem VPS: Wegwerf-Cluster mit den Rollen und
 * Default-Privilegien des VPS, `grants_sql_tmpl`, dann `system-grants.psql` und `kanal-grants.psql`.
 *
 * 🔴 Die App liest und setzt „gelesen“ und die Antwort, legt aber nie an und löscht nie (anlegen nur `benachrichtige()`, löschen nur
 * Aufbewahrung und Kontoauflösung); die Jobs-Rolle ruft die Aufbewahrung; PUBLIC und die Kachelrolle rufen keine der Funktionen.
 */

const ENV = "nachgrants";
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
type Privilege = (typeof PRIVILEGES)[number];

const grants = ["system-grants.psql", "kanal-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Benachrichtigungen: Rechte der Rollen wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    const rolle = (art: "app" | "jobs" | "tiles") => `avesmaps3d_${ENV}_${art}`;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, grants);
    }, 180_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    async function tafel(role: string): Promise<Privilege[]> {
        const rows = await cluster!.admin.unsafe<{ privilege: Privilege; ok: boolean }[]>(
            `SELECT p AS privilege, has_table_privilege($1, 'public.benachrichtigung', p) AS ok FROM unnest($2::text[]) AS p`,
            [role, [...PRIVILEGES]] as never[],
        );
        return rows.filter((row) => row.ok).map((row) => row.privilege);
    }

    async function darf(role: string, funktion: string): Promise<boolean> {
        const [row] = await cluster!.admin.unsafe<{ ok: boolean }[]>(
            `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`,
            [role, funktion] as never[],
        );
        return row!.ok;
    }

    it("🔴 die App liest und ändert, legt nie an und löscht nie; die Jobs-Rolle liest nur, die Kachelrolle nichts", async () => {
        expect(await tafel(rolle("app"))).toEqual(["SELECT", "UPDATE"]);
        expect(await tafel(rolle("jobs"))).toEqual(["SELECT"]);
        expect(await tafel(rolle("tiles"))).toEqual([]);
    });

    it("🔴 Funktionen: anlegen nur die Auslöser (Besitzer), die Aufbewahrung die Jobs-Rolle, die Kontoauflösung die App; PUBLIC nichts", async () => {
        const anlegen = "public.benachrichtige(text, jsonb, text, uuid, text, bigint, text, text, boolean)";
        expect(await darf("public", anlegen)).toBe(false);
        expect(await darf(rolle("tiles"), anlegen)).toBe(false);
        // Die App meldet hängende Aufträge selbst (WI-0179, `jobs/haengt-melder.ts`): mit dem Standardrecht der Migrationsrolle auf
        // Funktionen (`runtime-foundation.sh`), wie die Auslöser des Kanals. Fiele es weg, bliebe ein hängender Auftrag wieder still.
        expect(await darf(rolle("app"), anlegen)).toBe(true);
        expect(await darf(rolle("jobs"), "public.benachrichtigung_purge_expired()")).toBe(true);
        expect(await darf("public", "public.benachrichtigung_purge_expired()")).toBe(false);
        expect(await darf(rolle("app"), "public.redact_person_benachrichtigung(uuid)")).toBe(true);
        expect(await darf("public", "public.redact_person_benachrichtigung(uuid)")).toBe(false);
    });
});
