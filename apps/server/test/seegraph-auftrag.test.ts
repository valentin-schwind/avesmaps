import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leiteSeegraphAb } from "../src/jobs/seegraph-job.ts";
import { JOB_KIND_CATALOG } from "../src/jobs/kinds.ts";
import { gibWegfindungFrei, SEA_DERIVE_KIND, seegraphLage, verstelleWegfindung } from "../src/system/wegfindung.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Der Seegraph als Auftrag (WI-0153 Schnitt 7b; Migration 0153; Claudio 2026-10-17 „bau 7b so“), so wie auf dem VPS: Wegwerf-Cluster
 * mit Migrations-, App- und Jobs-Rolle und den Vorlagen. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: `job_enqueue` nimmt die Art nicht an; die Jobs-Rolle darf den Graphen nicht schreiben, oder sie darf löschen; ein
 * Lauf ohne geänderte Quellen rechnet trotzdem; der eine Knopf (Betreiber 2026-10-18) merkt ein geändertes Meer nicht, reiht eine
 * zweite wartende Ableitung ein, oder der Reload läuft vor der Ableitung statt an ihr zu hängen.
 */

const ENV = "seeauf";
const DOMAIN = "aventuria";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

describeWithCluster("Seegraph als Auftrag (WI-0153 7b, Wegwerf-Cluster)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster | undefined;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        // Ein kleines Meer mit zwei Häfen an seinen Ufern, angelegt wie vom Import (Migrationsrolle).
        const [meer] = await cluster.migrator<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (gen_random_uuid(), ${DOMAIN}, '7b Testmeer', 'topographie', 'meer', true)
            RETURNING id::text
        `;
        await cluster.migrator`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (gen_random_uuid(), ${DOMAIN}, ${Number(meer!.id)},
                    ST_GeomFromText('POLYGON((100 100,140 100,140 130,100 130,100 100))'), true)
        `;
        for (const [name, x, y] of [
            ["7b Westhafen", 99, 115],
            ["7b Osthafen", 141, 115],
        ] as const) {
            await cluster.migrator`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_seaport)
                VALUES (gen_random_uuid(), ${DOMAIN}, ${name}, 'dorf', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'test', true, true)
            `;
        }
    }, 240_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 die Art steht im Katalog: schwer, mit geteilter Sperre der Domäne und eigenem Speicherschlüssel", () => {
        expect(JOB_KIND_CATALOG[SEA_DERIVE_KIND]).toMatchObject({
            origin: "queued",
            holdsSharedDomainLock: true,
            learnsFromHistory: true,
        });
        expect(JOB_KIND_CATALOG[SEA_DERIVE_KIND]!.memoryKey({}, null)).toBe("sea_derive");
    });

    // 🪤 Die App-Rolle darf den Graphen heute auch schreiben (Rechtetafel WI-0200, `support/public-rechte.ts`); das ist nicht Teil von 7b.
    it("🔴 Rechte: die Jobs-Rolle schreibt den Graphen, löscht ihn nie; die App-Rolle liest ihn", async () => {
        const recht = async (rolle: string) => {
            const [zeile] = await cluster!.admin<
                { lesen: boolean; einfuegen: boolean; aendern: boolean; loeschen: boolean; leeren: boolean }[]
            >`
                SELECT has_table_privilege(${rolle}, 'sea_route_graph', 'SELECT') AS lesen,
                       has_table_privilege(${rolle}, 'sea_route_graph', 'INSERT') AS einfuegen,
                       has_table_privilege(${rolle}, 'sea_route_graph', 'UPDATE') AS aendern,
                       has_table_privilege(${rolle}, 'sea_route_graph', 'DELETE') AS loeschen,
                       has_table_privilege(${rolle}, 'sea_route_graph', 'TRUNCATE') AS leeren
            `;
            return zeile;
        };
        expect(await recht(cluster!.roles.jobs)).toEqual({
            lesen: true,
            einfuegen: true,
            aendern: true,
            loeschen: false,
            leeren: false,
        });
        expect(await recht(cluster!.roles.app)).toMatchObject({ lesen: true });
    });

    it("🔴 als Jobs-Rolle: der erste Lauf leitet ab, der zweite ohne geänderte Quellen ist `ueberholt`", async () => {
        const erst = await leiteSeegraphAb(cluster!.jobs, DOMAIN);
        expect(erst).toMatchObject({ status: "abgeleitet", haefen: 2, ohneAnlegestelle: 0 });
        expect(erst["kanten"]).toEqual(expect.any(Number));
        const [graph] = await cluster!.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM sea_route_graph WHERE map_domain_id = ${DOMAIN}
        `;
        expect(graph?.n).toBe(1);
        expect(await leiteSeegraphAb(cluster!.jobs, DOMAIN)).toMatchObject({
            status: "ueberholt",
            fingerprint: erst["fingerprint"],
        });
    });

    it("🔴 der eine Knopf: veraltet reiht er die Ableitung vor dem Reload ein; wartet sie, hängt der nächste an ihr", async () => {
        const handelnd = { personId: null, label: "test:7b" };
        const freigabe = () =>
            cluster!.app.begin(async (tx) => {
                const [zustand] = await tx<{ revision: number }[]>`
                    SELECT revision::int AS revision FROM routing_setting_state WHERE id = 1
                `;
                return gibWegfindungFrei(tx, { baseRevision: zustand!.revision, mapDomainId: DOMAIN, actor: handelnd });
            });
        const kette = async (reload: string) =>
            cluster!.admin<{ kind: string; state: string; vorher: string[] }[]>`
                SELECT j.kind, j.state, coalesce(array_agg(p.public_id::text) FILTER (WHERE p.id IS NOT NULL), '{}') AS vorher
                  FROM job j
                  LEFT JOIN job_dependency d ON d.job_id = j.id
                  LEFT JOIN job p ON p.id = d.depends_on_id
                 WHERE j.public_id = ${reload}::uuid
                 GROUP BY j.id
            `;

        // Der Graph passt (der Lauf davor): nichts freizugeben.
        expect(await seegraphLage(cluster!.app, DOMAIN)).toMatchObject({ stale: false, wartendId: null });
        await expect(freigabe()).rejects.toMatchObject({ statusCode: 409, code: "nothing_to_apply" });

        // Ein Editor macht das Meer größer: Der Graph passt nicht mehr, und der Knopf reiht die Ableitung ein.
        await cluster!.migrator`
            UPDATE region_area SET geom = ST_GeomFromText('POLYGON((100 100,150 100,150 130,100 130,100 100))')
             WHERE region_id = (SELECT id FROM region WHERE name = '7b Testmeer')
        `;
        expect(await seegraphLage(cluster!.app, DOMAIN)).toMatchObject({ stale: true, job: null });
        const erste = await freigabe();
        expect(erste.vorarbeit).toEqual([{ kind: "sea_derive", job: erste.seegraph }]);
        expect(await kette(erste.job!)).toEqual([
            { kind: "routing_reload", state: "QUEUED", vorher: [erste.seegraph] },
        ]);
        expect(await seegraphLage(cluster!.app, DOMAIN)).toMatchObject({
            stale: true,
            job: erste.seegraph,
            jobState: "QUEUED",
            wartendId: expect.any(String),
        });

        // Wartet die Ableitung, gibt es ohne offenen Wert nichts freizugeben.
        await expect(freigabe()).rejects.toMatchObject({ statusCode: 409, code: "nothing_to_apply" });

        // Ein Wert des Seegraphen am Knopf (7c): Die Freigabe hängt den Reload an die wartende Ableitung, statt eine zweite einzureihen.
        await cluster!.app.begin(async (tx) => {
            const [zustand] = await tx<
                { revision: number }[]
            >`SELECT revision::int AS revision FROM routing_setting_state WHERE id = 1`;
            await verstelleWegfindung(tx, {
                id: "landingReach",
                value: 4,
                baseRevision: zustand!.revision,
                actor: handelnd,
            });
        });
        const zweite = await freigabe();
        expect(zweite.werte).toBe(1);
        expect(zweite.seegraph).toBe(erste.seegraph);
        expect(await kette(zweite.job!)).toEqual([
            { kind: "routing_reload", state: "QUEUED", vorher: [erste.seegraph] },
        ]);
        const [ableitungen] = await cluster!.admin<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM job WHERE kind = 'sea_derive'`;
        expect(ableitungen?.n).toBe(1);
    });
});
