import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAbgleiche } from "../src/abgleiche/lesen.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Abgleiche mit den Rechten des VPS (WI-0127 SYS-14, Migration 0094), auf einem Wegwerf-Cluster mit den Rollen und dem
 * Rechtewerkzeug von Claudio (`support/vps-cluster.ts`):
 *
 * - Die App-Rolle reiht die zwei Arten über `job_enqueue` ein (SECURITY DEFINER), `import` und `probe` bleiben ihr verwehrt, und
 *   direkt in `job` schreibt sie nie (0070, Q10).
 * - Das Lesemodell läuft mit genau den Rechten der App-Rolle (Warteschlange und Anzeigenamen aus `avesmaps_auth.person`).
 */

const ENV = "syncgrants";
const PERSON = "7e570000-0000-4000-8000-0000000000aa";
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Abgleiche: Rechte der App-Rolle wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, []);
        await seedMapDomains(cluster.migrator);
    }, 180_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    /** SQLSTATE je Anweisung, als App-Rolle per `SET LOCAL ROLE`; die Transaktion wird immer zurückgerollt. */
    async function asApp(statements: string[]): Promise<string[]> {
        const codes: string[] = [];
        try {
            await cluster!.admin.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL ROLE ${cluster!.roles.app}`);
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

    it("🔴 die App reiht legacy_pull und legacy_media ein, import und probe nicht, und schreibt nie direkt in job", async () => {
        expect(
            await asApp([
                `SELECT * FROM job_enqueue('legacy_pull', 1::smallint, 'aventuria', '${PERSON}', '{"quelle": "legacy"}'::jsonb)`,
                `SELECT * FROM job_enqueue('legacy_media', 1::smallint, 'aventuria', '${PERSON}', '{"quelle": "medien"}'::jsonb)`,
                `SELECT * FROM job_enqueue('import', 1::smallint, 'aventuria', '${PERSON}', '{}'::jsonb)`,
                `SELECT * FROM job_enqueue('probe', 1::smallint, 'aventuria', '${PERSON}', '{}'::jsonb)`,
                `INSERT INTO job (kind, map_domain_id) VALUES ('legacy_pull', 'aventuria')`,
            ]),
        ).toEqual(["ok", "ok", "42501", "42501", "42501"]);
    });

    it("das Lesemodell läuft mit den Rechten der App-Rolle und zeigt den eingereihten Auftrag", async () => {
        const app = cluster!.app;
        expect((await readAbgleiche(app)).map((zeile) => [zeile.quelle, zeile.kreis, zeile.laufend])).toEqual([
            ["legacy", "leer", null],
            ["legacy_landschaften", "leer", null],
            ["legacy_wege", "leer", null],
            ["legacy_orte", "leer", null],
            ["medien", "leer", null],
            // Das Lesemodell liest jede Quelle; welche Zeile hinausgeht, entscheidet die Route (WI-0144).
            ["production", "leer", null],
        ]);
        await app`SELECT * FROM job_enqueue('legacy_pull', 1::smallint, 'aventuria', ${PERSON}, ${app.json({ quelle: "legacy" })})`;
        const [legacy, medien] = await readAbgleiche(app);
        expect(legacy?.laufend?.state).toBe("QUEUED");
        // Die Person gibt es in diesem Cluster nicht: dann steht der Auslöser ohne Namen da, nie ein Fehler.
        expect(legacy?.laufend?.ausgeloest).toEqual({ art: "ablauf", name: null });
        expect(medien?.laufend).toBeNull();
    });
});
