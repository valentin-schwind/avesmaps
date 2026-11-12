import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { anzeigenamen } from "../src/jobs/ausloeser.ts";
import { darfNamenLesen } from "../src/jobs/dirigent/quelle.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Namen in der gemeinsamen Reihe (WI-0293; Betreiber 2026-11-09 auf die Frage, ob Aufträge der anderen Umgebung den Namen zeigen sollen:
 * „Ja, Namen zeigen“), gegen einen Wegwerf-Cluster mit den Rollen des VPS.
 *
 * **Soll:** Die Leserolle des Dirigenten (`queue_read`) liest aus `avesmaps_auth` genau Kennung und Anzeigename der Personen, sonst
 * nichts (`auth-grants.psql`). Ob sie das darf, beantwortet `darfNamenLesen` aus dem Katalog OHNE Fehler, auch für eine Rolle ohne jedes
 * Recht am Schema: Sonst stünde im Log der Datenbank bei jeder Prüfung ein `42501`.
 */

const ENV = "namen";
const describeWithCluster = postgresBin ? describe : describe.skip;
const queueReadGrants = fileURLToPath(new URL("../src/db/queue-read-grants.psql", import.meta.url));
const authGrants = fileURLToPath(new URL("../src/db/auth-grants.psql", import.meta.url));

describeWithCluster("Die Leserolle des Dirigenten und die Namen (WI-0293, Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let person = "";

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [queueReadGrants, authGrants]);
        const [row] = await cluster.admin<{ id: string }[]>`
            INSERT INTO avesmaps_auth.person (display_name, created_via) VALUES ('Rondrikan', 'system') RETURNING id::text AS id
        `;
        person = row!.id;
    }, 180_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    /** Arbeit unter einer Rolle (`SET LOCAL ROLE`), danach immer zurückgerollt; SQLSTATE je Anweisung, wo es Anweisungen sind. */
    async function alsRolle<T>(rolle: string, arbeit: (tx: Database) => Promise<T>): Promise<T> {
        let ergebnis: T | undefined;
        try {
            await cluster!.admin.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL ROLE ${rolle}`);
                ergebnis = await arbeit(tx as unknown as Database);
                throw new Error("__zurueck__");
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "__zurueck__") throw error;
        }
        return ergebnis as T;
    }

    async function codes(rolle: string, anweisungen: string[]): Promise<string[]> {
        return alsRolle(rolle, async (tx) => {
            const ergebnis: string[] = [];
            for (const sql of anweisungen) {
                await tx.unsafe("SAVEPOINT probe");
                try {
                    await tx.unsafe(sql);
                    await tx.unsafe("RELEASE SAVEPOINT probe");
                    ergebnis.push("ok");
                } catch (error) {
                    await tx.unsafe("ROLLBACK TO SAVEPOINT probe");
                    ergebnis.push((error as { code?: string }).code ?? "fehler");
                }
            }
            return ergebnis;
        });
    }

    it("🔴 nur Kennung und Anzeigename, keine andere Spalte, keine andere Tafel, nichts schreiben", async () => {
        const rolle = cluster!.roles.queue_read;
        expect(await codes(rolle, ["SELECT id, display_name FROM avesmaps_auth.person"])).toEqual(["ok"]);
        expect(
            await codes(rolle, [
                "SELECT status FROM avesmaps_auth.person",
                "SELECT * FROM avesmaps_auth.person",
                "SELECT count(*) FROM avesmaps_auth.person_access",
                "SELECT count(*) FROM avesmaps_auth.session",
                "SELECT count(*) FROM avesmaps_auth.security_event",
                "UPDATE avesmaps_auth.person SET display_name = 'x'",
                "INSERT INTO avesmaps_auth.person (display_name, created_via) VALUES ('x', 'system')",
            ]),
        ).toEqual(Array.from({ length: 7 }, () => "42501"));
    });

    it("🔴 der Dirigent fragt den Katalog: ja für die Leserolle, nein ohne Recht, und nie ein Fehler", async () => {
        expect(await alsRolle(cluster!.roles.queue_read, (tx) => darfNamenLesen(tx))).toBe(true);
        // Die Kachelrolle hat am Schema kein Recht: Die Frage selbst darf trotzdem nicht scheitern.
        expect(await alsRolle(cluster!.roles.tiles, (tx) => darfNamenLesen(tx))).toBe(false);
        const namen = await alsRolle(cluster!.roles.queue_read, (tx) => anzeigenamen(tx, [person, "cli:root", null]));
        expect([...namen.entries()]).toEqual([[person, "Rondrikan"]]);
    });
});
