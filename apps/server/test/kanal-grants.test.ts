import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Rechte am Betreiber-Kanal aus Migration 0106 (WI-0124, KANAL-0001 §4), so wie auf dem VPS: Wegwerf-Cluster mit den Rollen des VPS,
 * `grants_sql_tmpl`, dann `apps/server/src/db/kanal-grants.psql`; dazu die zwei Agentenrollen, die Claudio später anlegt.
 *
 * - 🔴 Die App liest die Tafeln und schreibt nur über die Funktionen der Betreiber; Agentenfunktionen darf sie nicht ausführen.
 * - 🔴 Ein Agent hat an keiner Tafel ein Recht; sein Name folgt aus der Rolle, er kann nicht als der andere handeln; abnehmen kann er nicht.
 * - Nachprüfen kann nur Claudias Rolle. Die Jobs-Rolle führt nur die Funktionen der Bilder und der Aufbewahrung aus. Die Kachelrolle nichts.
 */

const ENV = "kanaltest";
const TAFELN = ["vorgang", "eintrag", "nachweis", "aenderung", "beobachtung", "bild", "agent"] as const;
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
const grants = fileURLToPath(new URL("../src/db/kanal-grants.psql", import.meta.url));
const describeWithCluster = postgresBin ? describe : describe.skip;
const CLAUDIO = `avesmaps3d_${ENV}_claudio`;
const CLAUDIA = `avesmaps3d_${ENV}_claudia`;

describeWithCluster("Betreiber-Kanal: Rechte wie auf dem VPS (Wegwerf-Cluster)", () => {
    let cluster: VpsCluster | undefined;
    let claudio: Database;
    let claudia: Database;
    let jobs: Database;
    let person: string;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [grants]);
        const { host, port, database } = cluster.admin.options as unknown as {
            host: string[];
            port: number[];
            database: string;
        };
        // Die Agentenrollen (claudio, claudia) legt der Cluster selbst an, samt CONNECT und Rechten (WI-0189).
        const url = (rolle: string): string => `postgres://${rolle}@${host[0]!}:${String(port[0])}/${database}`;
        claudio = createDatabase(url(CLAUDIO), { max: 1 });
        claudia = createDatabase(url(CLAUDIA), { max: 1 });
        jobs = createDatabase(url(cluster.roles.jobs), { max: 1 });
        const [row] = await cluster.admin<{ id: string }[]>`
            INSERT INTO avesmaps_auth.person (display_name, status, created_via) VALUES ('Rondrikan', 'active', 'system') RETURNING id
        `;
        person = row!.id;
    }, 180_000);

    afterAll(async () => {
        for (const db of [claudio, claudia, jobs]) await db?.end({ timeout: 5 }).catch(() => undefined);
        await cluster?.stop();
    }, 60_000);

    async function rechte(rolle: string, tafel: string): Promise<string[]> {
        const rows = await cluster!.admin.unsafe<{ privilege: string; ok: boolean }[]>(
            `SELECT p AS privilege, has_table_privilege($1, $2, p) AS ok FROM unnest($3::text[]) AS p`,
            [rolle, `avesmaps_kanal.${tafel}`, [...PRIVILEGES]] as never[],
        );
        return rows.filter((row) => row.ok).map((row) => row.privilege);
    }

    const melden = (db: Database) => db`
        SELECT avesmaps_kanal.kanal_melden(${randomUUID()}::uuid, 'staging', ${person}::uuid, 'bug', 'hoch', 'See-321 wird sichtbar',
                                           'Im Infopanel steht See-321.', NULL, '{}'::jsonb, NULL) AS id
    `;

    it("🔴 an den Tafeln: die App liest nur; Agenten, Jobs und Kacheln nichts", async () => {
        for (const tafel of TAFELN) {
            expect(await rechte(cluster!.roles.app, tafel), tafel).toEqual(["SELECT"]);
            for (const rolle of [CLAUDIO, CLAUDIA, cluster!.roles.jobs, cluster!.roles.tiles])
                expect(await rechte(rolle, tafel), `${rolle} ${tafel}`).toEqual([]);
        }
    });

    it("🔴 die App meldet über die Funktion, schreibt nie direkt und führt keine Agentenfunktion aus", async () => {
        const [row] = await melden(cluster!.app);
        expect(Number(row!["id"])).toBeGreaterThan(0);
        await expect(
            cluster!
                .app`INSERT INTO avesmaps_kanal.eintrag (vorgang_id, seq, art, von_agent, operation_id) VALUES (1, 99, 'befund', 'claudio', ${randomUUID()}::uuid)`,
        ).rejects.toMatchObject({ code: "42501" });
        await expect(cluster!.app`SELECT * FROM avesmaps_kanal.kanal_abholen(5)`).rejects.toMatchObject({
            code: "42501",
        });
        await expect(cluster!.app`SELECT avesmaps_kanal.kanal_purge_expired()`).rejects.toMatchObject({
            code: "42501",
        });
    });

    it("🔴 die App legt eine Freigabe über die Funktion an; direkt in `vorgang` schreiben darf sie nie", async () => {
        // 🔴 Der Regressionsfall zu Claudios Befund 2026-10-14: Der Knopf „Alles nach Production“ schrieb
        //    `INSERT INTO avesmaps_kanal.vorgang` als App-Rolle und endete mit `permission denied for table vorgang`.
        //    Der Weg konnte nie funktionieren — die App hat an den Kanal-Tafeln nur SELECT.
        await expect(
            cluster!.app`
                INSERT INTO avesmaps_kanal.vorgang (environment, art, kategorie, prioritaet, status, zustaendig, titel,
                                                    gemeldet_von, operation_id)
                VALUES ('staging', 'freigabe', 'umbau', 'hoch', 'neu', 'claudio', 'direkt geschrieben', ${person}::uuid,
                        ${randomUUID()}::uuid)
            `,
        ).rejects.toMatchObject({ code: "42501" });

        const operation = randomUUID();
        const freigabe = (op: string, env: string, art: string, titel: string) => cluster!.app<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_freigabe_anlegen(${op}::uuid, ${env}, ${person}::uuid, ${art}, ${titel},
                                                         'Stand abc1234 nach Production.') AS id
        `;
        const [erste] = await freigabe(operation, "staging", "release", "Nach Production: 20261014T0100Z-abc1234");
        expect(Number(erste!.id)).toBeGreaterThan(0);

        // Derselbe Druck zweimal (Netz, Doppelklick) gibt denselben Vorgang.
        const [wieder] = await freigabe(operation, "staging", "release", "Egal");
        expect(wieder!.id).toBe(erste!.id);

        // Eine nach der anderen: solange sie offen steht, kommt in derselben Umgebung keine zweite durch.
        await expect(
            freigabe(randomUUID(), "staging", "rollback", "Zurück auf den vorigen Stand"),
        ).rejects.toMatchObject({ code: "KA409" });

        // Nur „release“ oder „rollback“.
        await expect(freigabe(randomUUID(), "andere", "loeschen", "Weg damit")).rejects.toMatchObject({
            code: "KA422",
        });

        // 🔴 Der Titel wandert auf den VPS und wird dort ZEILENWEISE gelesen, Felder mit `|`. Die Funktion ist die letzte
        //    Lage: Weder ein Zeilenumbruch noch ein `|` darf durchkommen, sonst stünde dort eine zweite, erfundene Zeile.
        const [sauber] = await freigabe(
            randomUUID(),
            "andere",
            "release",
            "Nach Production: gut\nfreigabe|rollback|sofort",
        );
        const [titel] = await cluster!.admin<{ t: string }[]>`
            SELECT titel AS t FROM avesmaps_kanal.vorgang WHERE id = ${Number(sauber!.id)}::bigint
        `;
        expect(titel!.t).toBe("Nach Production: gutfreigaberollbacksofort");
    });

    it("🔴 ein Agent: Name aus der Rolle, nie als der andere, keine Tafel, kein Abnehmen; nachprüfen nur Claudia", async () => {
        const [row] = await melden(cluster!.app);
        const id = Number(row!["id"]);
        const abgeholt = await claudio<{ id: string }[]>`SELECT id FROM avesmaps_kanal.kanal_abholen(5)`;
        expect(abgeholt.map((r) => Number(r.id))).toContain(id);
        const [lease] = await cluster!.admin<
            { a: string }[]
        >`SELECT lease_agent AS a FROM avesmaps_kanal.vorgang WHERE id = ${id}`;
        expect(lease!.a).toBe("claudio");
        await expect(claudio`SELECT * FROM avesmaps_kanal.kanal_abholen(5, false, 'claudia')`).rejects.toMatchObject({
            code: "KA403",
        });
        await expect(claudio`SELECT count(*) FROM avesmaps_kanal.vorgang`).rejects.toMatchObject({ code: "42501" });
        await expect(
            claudio`SELECT avesmaps_kanal.kanal_abnehmen(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, 1)`,
        ).rejects.toMatchObject({ code: "42501" });
        await claudio`SELECT avesmaps_kanal.kanal_status(${randomUUID()}::uuid, ${id}::bigint, 'in_arbeit', NULL)`;
        const [aenderung] = await claudio<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_aenderung(${randomUUID()}::uuid, ${id}::bigint, 'A', 'code', 'Infopanel ohne technischen Titel', NULL,
                                                  '{}', ${"a".repeat(40)}, NULL, NULL, NULL) AS id
        `;
        await expect(
            claudio`SELECT avesmaps_kanal.kanal_nachpruefen(${randomUUID()}::uuid, ${aenderung!.id}::bigint, 'ok', NULL)`,
        ).rejects.toMatchObject({ code: "KA403" });
        await claudia`SELECT avesmaps_kanal.kanal_nachpruefen(${randomUUID()}::uuid, ${aenderung!.id}::bigint, 'ok', NULL)`;
        const [eintrag] = await cluster!.admin<{ a: string }[]>`
            SELECT von_agent AS a FROM avesmaps_kanal.eintrag WHERE vorgang_id = ${id} AND art = 'status' ORDER BY seq DESC LIMIT 1
        `;
        expect(eintrag!.a).toBe("claudio");
    });

    it("🔴 Discord (WI-0255 Paket 2, 0231): die App meldet und gibt frei; ein Agent kann weder das eine noch holt er Ungesichtetes ab", async () => {
        const discord = (db: Database) => db<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_discord_melden(${randomUUID()}::uuid, 'staging', 'bug', 'Weg fehlt', 'Der Weg nach Gareth fehlt.',
                                                       'Rondrikan', '1100000000000000001', '{}'::jsonb) AS id
        `;
        const [row] = await discord(cluster!.app);
        const id = Number(row!.id);
        expect(id).toBeGreaterThan(0);
        for (const agent of [claudio, claudia]) {
            await expect(discord(agent)).rejects.toMatchObject({ code: "42501" });
            await expect(
                agent`SELECT avesmaps_kanal.kanal_sichten(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, 1, NULL)`,
            ).rejects.toMatchObject({ code: "42501" });
        }
        expect(
            (await claudia<{ id: string }[]>`SELECT id FROM avesmaps_kanal.kanal_abholen(50, true)`).map((r) =>
                Number(r.id),
            ),
        ).not.toContain(id);
        const [vorher] = await cluster!.admin<
            { r: number }[]
        >`SELECT revision AS r FROM avesmaps_kanal.vorgang WHERE id = ${id}`;
        await cluster!
            .app`SELECT avesmaps_kanal.kanal_sichten(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${vorher!.r}::integer, 'claudia')`;
        expect(
            (await claudia<{ id: string }[]>`SELECT id FROM avesmaps_kanal.kanal_abholen(50)`).map((r) => Number(r.id)),
        ).toContain(id);
    });

    it("🔴 An die Community (WI-0297, 0332): die App leitet weiter; ein Agent kann es nicht, holt nichts ab, liest nichts und schreibt nichts daran", async () => {
        const [row] = await cluster!.app<{ id: string }[]>`
            SELECT avesmaps_kanal.kanal_discord_melden(${randomUUID()}::uuid, 'staging', 'idee', 'Tempel fehlt', 'Am Markt von Gareth fehlt der Tempel.',
                                                       'Praiodan', '1100000000000000297', '{}'::jsonb) AS id
        `;
        const id = Number(row!.id);
        const revision = async (): Promise<number> =>
            (
                await cluster!.admin<{ r: number }[]>`SELECT revision AS r FROM avesmaps_kanal.vorgang WHERE id = ${id}`
            )[0]!.r;
        for (const agent of [claudio, claudia]) {
            await expect(
                agent`SELECT avesmaps_kanal.kanal_an_community(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${await revision()}::integer, 'COM-000297')`,
            ).rejects.toMatchObject({ code: "42501" });
        }
        await cluster!
            .app`SELECT avesmaps_kanal.kanal_an_community(${randomUUID()}::uuid, ${id}::bigint, ${person}::uuid, ${await revision()}::integer, 'COM-000297')`;
        for (const agent of [claudio, claudia]) {
            expect(
                (await agent<{ id: string }[]>`SELECT id FROM avesmaps_kanal.kanal_abholen(50, true)`).map((r) =>
                    Number(r.id),
                ),
            ).not.toContain(id);
            const [gelesen] = await agent<
                { v: Record<string, unknown> }[]
            >`SELECT avesmaps_kanal.kanal_lesen(${id}::bigint) AS v`;
            expect(gelesen!.v).toMatchObject({ anCommunity: true, gemeldetVon: "Discord", eintraege: [] });
            expect(JSON.stringify(gelesen!.v)).not.toMatch(/COM-|Praiodan|Tempel/u);
            await expect(
                agent`SELECT avesmaps_kanal.kanal_eintragen(${randomUUID()}::uuid, ${id}::bigint, 'befund', 'Gesehen.', NULL)`,
            ).rejects.toMatchObject({ code: "KA409" });
        }
    });

    it("die Jobs-Rolle: Bilder und Aufbewahrung, sonst nichts", async () => {
        await jobs`SELECT * FROM avesmaps_kanal.kanal_faellige_bilder()`;
        await jobs`SELECT avesmaps_kanal.kanal_purge_expired()`;
        await expect(melden(jobs)).rejects.toMatchObject({ code: "42501" });
        await expect(jobs`SELECT * FROM avesmaps_kanal.kanal_abholen(5, false, 'claudio')`).rejects.toMatchObject({
            code: "42501",
        });
    });
});
