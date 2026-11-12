import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verbindungen } from "../src/system/systemzustand.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte am Systemzustand aus Migration 0101 (WI-0127 SYS-8, SYS-0001 §3.7, Claudio `2026-10-10-wi0119-systemzustand-antwort.md` Nr. 2),
 * so wie auf dem VPS: Wegwerf-Cluster mit den Rollen des VPS, `grants_sql_tmpl`, dann `apps/server/src/db/system-grants.psql`.
 *
 * 🔴 Die App schreibt Stichproben und löscht alte, ändert aber keine. `connection_counts()` liefert nur Zahlen und nur, wenn sie der Rolle
 * `avesmaps3d_stats` (mit `pg_read_all_stats`) gehört; bis Claudio die Rolle anlegt, antwortet sie `NULL` („unbekannt“). Die App-Rolle selbst
 * sieht nie fremde Abfragetexte. Kachel- und Jobs-Rolle dürfen die Funktion nicht ausführen.
 */

const ENV = "sysstats";
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
const grants = fileURLToPath(new URL("../src/db/system-grants.psql", import.meta.url));
const mediaGrants = fileURLToPath(new URL("../src/db/media-grants.psql", import.meta.url));
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Systemzustand: Rechte wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [grants, mediaGrants]);
    }, 180_000);

    afterAll(async () => {
        await cluster?.admin.unsafe("DROP ROLE IF EXISTS avesmaps3d_stats").catch(() => undefined);
        await cluster?.stop();
    }, 60_000);

    async function granted(role: string, table: string): Promise<string[]> {
        const rows = await cluster!.admin.unsafe<{ privilege: string; ok: boolean }[]>(
            `SELECT p AS privilege, has_table_privilege($1, $2, p) AS ok FROM unnest($3::text[]) AS p`,
            [role, `public.${table}`, [...PRIVILEGES]] as never[],
        );
        return rows.filter((row) => row.ok).map((row) => row.privilege);
    }

    const darfAusfuehren = async (role: string): Promise<boolean> => {
        const [row] = await cluster!.admin<{ ok: boolean }[]>`
            SELECT has_function_privilege(${role}, 'public.connection_counts()', 'EXECUTE') AS ok
        `;
        return row!.ok;
    };

    it("🔴 schema_migration: die App liest den Schemastand, schreibt ihn nie", async () => {
        // Der Systemzustand zeigt, welche Migration eingespielt ist (Betreiber 2026-10-14). Lesen muss die App dafür —
        // schreiben nie: Die Default-Privilegie in public gäbe ihr sonst auch INSERT, UPDATE und DELETE, und damit
        // könnte sie sich selbst einen Stand eintragen, den niemand eingespielt hat.
        expect(await granted(cluster!.roles.app, "schema_migration")).toEqual(["SELECT"]);
        expect(await granted(cluster!.roles.tiles, "schema_migration")).toEqual([]);
    });

    it("🔴 system_sample: die App liest, hängt an und löscht, ändert nie; die Kachelrolle nichts", async () => {
        expect(await granted(cluster!.roles.app, "system_sample")).toEqual(["SELECT", "INSERT", "DELETE"]);
        expect(await granted(cluster!.roles.tiles, "system_sample")).toEqual([]);
    });

    it("🔴 content_switch (SYS-10, 0102): die App legt an und schaltet um, löscht nie; der Trigger hebt die Inhaltsrevision mit ihren Rechten", async () => {
        expect(await granted(cluster!.roles.app, "content_switch")).toEqual(["SELECT", "INSERT", "UPDATE"]);
        expect(await granted(cluster!.roles.tiles, "content_switch")).toEqual([]);
        const vorher = await cluster!.admin<{ c: number; r: number }[]>`
            SELECT content_revision::int AS c, revision::int AS r FROM system_state WHERE id = 1
        `;
        await cluster!.app`INSERT INTO content_switch (key, enabled) VALUES ('panel.reviews', false)`;
        await cluster!.app`UPDATE content_switch SET enabled = true WHERE key = 'panel.reviews'`;
        const nachher = await cluster!.admin<{ c: number; r: number }[]>`
            SELECT content_revision::int AS c, revision::int AS r FROM system_state WHERE id = 1
        `;
        // Zwei Änderungen heben die Inhaltsrevision zweimal; die Revision des Betriebszustands bleibt stehen.
        expect(nachher[0]!.c).toBe(vorher[0]!.c + 2);
        expect(nachher[0]!.r).toBe(vorher[0]!.r);
        await expect(cluster!.app`DELETE FROM content_switch`).rejects.toMatchObject({ code: "42501" });
    });

    it("🔴 media_quarantine (SYS-10 b3, 0104): die App liest nur; die Jobs-Rolle legt an und hebt auf; niemand löscht", async () => {
        expect(await granted(cluster!.roles.app, "media_quarantine")).toEqual(["SELECT"]);
        expect(await granted(cluster!.roles.jobs, "media_quarantine")).toEqual(["SELECT", "INSERT"]);
        expect(await granted(cluster!.roles.tiles, "media_quarantine")).toEqual([]);
        const [spalten] = await cluster!.admin<{ restored: boolean; sha: boolean; folge: boolean }[]>`
            SELECT has_column_privilege(${cluster!.roles.jobs}, 'public.media_quarantine', 'restored_at', 'UPDATE') AS restored,
                   has_column_privilege(${cluster!.roles.jobs}, 'public.media_quarantine', 'sha256', 'UPDATE') AS sha,
                   has_sequence_privilege(${cluster!.roles.jobs}, 'public.media_quarantine_id_seq', 'USAGE') AS folge
        `;
        expect(spalten).toEqual({ restored: true, sha: false, folge: true });
        await expect(
            cluster!
                .app`INSERT INTO media_quarantine (sha256, reason_kind) VALUES (${"a".repeat(64)}, 'content_switch')`,
        ).rejects.toMatchObject({ code: "42501" });
    });

    it("🔴 ohne die Rolle avesmaps3d_stats antwortet connection_counts() der App NULL, nie falsche Zahlen", async () => {
        expect(await darfAusfuehren(cluster!.roles.app)).toBe(true);
        expect(await darfAusfuehren(cluster!.roles.tiles)).toBe(false);
        expect(await darfAusfuehren(cluster!.roles.jobs)).toBe(false);
        expect(await darfAusfuehren("public")).toBe(false);
        const [row] = await cluster!.app<{ c: unknown }[]>`SELECT connection_counts() AS c`;
        expect(row!.c).toBeNull();
        expect(await verbindungen(cluster!.app)).toBeNull();
    });

    it("🔴 mit der Rolle (Claudios Superuser-Schritt) und dem Rechtewerkzeug: nur Zahlen; die App sieht weiter keine fremden Texte", async () => {
        await cluster!.admin.unsafe("CREATE ROLE avesmaps3d_stats NOLOGIN");
        await cluster!.admin.unsafe("GRANT pg_read_all_stats TO avesmaps3d_stats");
        await cluster!.regrant();
        const [owner] = await cluster!.admin<{ owner: string }[]>`
            SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = 'public.connection_counts()'::regprocedure
        `;
        expect(owner!.owner).toBe("avesmaps3d_stats");
        expect(await darfAusfuehren(cluster!.roles.app)).toBe(true);
        expect(await darfAusfuehren(cluster!.roles.tiles)).toBe(false);

        const zahlen = await verbindungen(cluster!.app);
        expect(zahlen).not.toBeNull();
        expect(zahlen!.erlaubt).toBeGreaterThan(0);
        expect(zahlen!.belegt).toBeGreaterThanOrEqual(1);
        expect(Object.values(zahlen!.eigene).reduce((sum, n) => sum + n, 0)).toBeGreaterThanOrEqual(1);
        // Nur Zahlen: keine Texte, Benutzer oder Adressen in der Antwort.
        const [row] = await cluster!.app<{ c: Record<string, unknown> }[]>`SELECT connection_counts() AS c`;
        expect(Object.keys(row!.c).sort()).toEqual(["max", "own", "reserved", "total"]);

        // Die App-Rolle selbst sieht die Abfragetexte der Migrationsrolle und des Superusers nicht (bei fremden Sitzungen sind auch
        // `state` und `backend_type` leer; genau deshalb zählt die Funktion ohne `pg_read_all_stats` nicht).
        await cluster!.admin`SELECT 1`;
        const fremde = await cluster!.app<{ query: string | null }[]>`
            SELECT query FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND usename IS DISTINCT FROM current_user
        `;
        expect(fremde.length).toBeGreaterThan(0);
        expect(fremde.every((entry) => entry.query === null || entry.query === "<insufficient privilege>")).toBe(true);
    });
});
