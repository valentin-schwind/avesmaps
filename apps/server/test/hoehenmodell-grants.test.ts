import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVENTURIA } from "@avesmaps3d/shared";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { readHoehenmodell } from "../src/terrain/hoehenmodell-lesen.ts";
import { nimmAb, waehleFassung } from "../src/terrain/hoehenmodell.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte am Höhenmodell aus Migration 0100 (WI-0127 SYS-13), so wie auf dem VPS: Wegwerf-Cluster mit den Rollen und
 * Default-Privilegien des VPS, `grants_sql_tmpl`, dann `apps/server/src/db/hoehenmodell-grants.psql` (die Vorlage für Claudios Zeile).
 *
 * 🔴 Die App wählt (eine Zeile anlegen, umschalten) und löscht die Auswahl nie; Abnahmen hängt sie nur an; Entwürfe legt sie an und
 * verwirft sie, löscht sie nie. Die Jobs-Rolle liest alle drei (der volle Lauf und die Messung lesen Auswahl und Entwurf). Die volle
 * Kette und die Messung reiht die App nur über die Funktionen ein, nie direkt in `job`. Ohne `hoehenmodell-grants.psql` fällt der Test.
 */

const ENV = "terraingrants";
const PERSON = "7e570000-0000-4000-8000-0000000000ac";
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
type Privilege = (typeof PRIVILEGES)[number];

/** Was die App-Rolle an jeder Tabelle aus 0100 darf. */
const APP_MAY: Readonly<Record<string, readonly Privilege[]>> = {
    terrain_recipe_choice: ["SELECT", "INSERT", "UPDATE"],
    terrain_recipe_acceptance: ["SELECT", "INSERT"],
    terrain_recipe_draft: ["SELECT", "INSERT", "UPDATE"],
};

const grants = fileURLToPath(new URL("../src/db/hoehenmodell-grants.psql", import.meta.url));
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Höhenmodell: Rechte der Rollen wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    const domain = AVENTURIA.mapDomain;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [grants]);
        await seedMapDomains(cluster.migrator);
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

    /** SQLSTATE je Anweisung unter einer Rolle (`SET LOCAL ROLE`); die Transaktion wird immer zurückgerollt. */
    async function as(role: string, statements: string[]): Promise<string[]> {
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

    it("🔴 die App darf an den drei Tafeln genau, was die Vorlage lässt; die Jobs-Rolle liest; die Kachelrolle nichts", async () => {
        const { app, jobs, tiles } = cluster!.roles;
        for (const [table, may] of Object.entries(APP_MAY)) {
            expect([table, await granted(app, table)]).toEqual([table, may]);
            expect([table, await granted(jobs, table)]).toEqual([table, ["SELECT"]]);
            expect([table, await granted(tiles, table)]).toEqual([table, []]);
        }
        expect(
            await as(app, [
                `DELETE FROM terrain_recipe_choice`,
                `UPDATE terrain_recipe_acceptance SET reason = 'x'`,
                `DELETE FROM terrain_recipe_acceptance`,
                `DELETE FROM terrain_recipe_draft`,
            ]),
        ).toEqual(["42501", "42501", "42501", "42501"]);
    });

    it("🔴 die App reiht die volle Kette und die Messung über die Funktionen ein, nie direkt in job", async () => {
        expect(
            await as(cluster!.roles.app, [
                `SELECT terrain_chain_enqueue('${domain}', '${PERSON}', 'Gelände voll: Fassung 17')`,
                `SELECT * FROM job_enqueue('terrain_preview', 1::smallint, '${domain}', '${PERSON}', '{"draft": "x"}'::jsonb)`,
                `INSERT INTO job (kind, map_domain_id) VALUES ('terrain_full', '${domain}')`,
            ]),
        ).toEqual(["ok", "ok", "42501"]);
        expect(await as(cluster!.roles.tiles, [`SELECT terrain_chain_enqueue('${domain}', '${PERSON}', 'x')`])).toEqual(
            ["42501"],
        );
    });

    it("🔴 wählen mit den Rechten der App: Auswahl, Kette (voll, Routen, Höhenlinien), ein zweiter Wechsel nimmt den wartenden Lauf mit", async () => {
        const app = cluster!.app;
        const actor = { personId: null, label: "Rechteprobe", actorRef: PERSON };
        const first = await app.begin((tx) =>
            waehleFassung(tx, { domain, version: 17, reason: "Probe", actor, profil: "voll" }),
        );
        expect(first).toMatchObject({ from: 18, to: 17, revision: 1 });
        const chain = await cluster!.admin<{ kind: string; priority: number; parents: string[] }[]>`
            SELECT j.kind, j.priority, COALESCE(array_agg(p.kind) FILTER (WHERE p.kind IS NOT NULL), '{}') AS parents
              FROM job j
              LEFT JOIN job_dependency d ON d.job_id = j.id
              LEFT JOIN job p ON p.id = d.depends_on_id
             WHERE j.map_domain_id = ${domain} AND j.kind IN ('terrain_full', 'routing_reload', 'display_heights')
             GROUP BY j.id, j.kind, j.priority ORDER BY j.id
        `;
        expect(chain.map((row) => [row.kind, row.priority, row.parents])).toEqual([
            ["terrain_full", 70, []],
            ["routing_reload", 20, ["terrain_full"]],
            ["display_heights", 60, ["terrain_full"]],
        ]);

        await app.begin((tx) => nimmAb(tx, { domain, version: 17, reason: "abgenommen", actor }));
        const second = await app.begin((tx) =>
            waehleFassung(tx, { domain, version: 18, reason: "zurück", actor, profil: "voll", rueckweg: true }),
        );
        expect(second).toMatchObject({ from: 17, to: 18, revision: 2, job: first.job });
        const [full] = await cluster!.admin<{ n: number; coalesced: number }[]>`
            SELECT count(*)::int AS n, max(coalesced_count)::int AS coalesced FROM job WHERE kind = 'terrain_full'
        `;
        expect(full).toEqual({ n: 1, coalesced: 1 });

        // Das Lesemodell mit genau den Rechten der App: ohne Master nichts wirksam, die Kette wartet, die Abnahme steht an der Fassung.
        const model = await readHoehenmodell(app, domain, "voll");
        expect(model.eingestellt).toMatchObject({ version: 18, quelle: "auswahl" });
        expect(model.wirksam.version).toBeNull();
        expect(model.kette).toMatchObject({ jobId: first.job, art: "terrain_full", state: "QUEUED" });
        expect(model.rueckweg).toBe(17);
        expect(model.fassungen.find((fassung) => fassung.version === 17)?.abnahme?.grund).toBe("abgenommen");
    });
});
