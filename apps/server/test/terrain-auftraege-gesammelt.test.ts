import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { loadDomainInputIndex } from "../src/terrain/domain/input-index.ts";
import { loadMountainJobs } from "../src/terrain/inputs.ts";

/**
 * Die Aufträge der Gebirge, Flüsse und Seen einmal gelesen (WI-0283; Claudio 2026-11-06: `inputs` und `seeds` rund 30 s bei CPU/Wand 0,4). Vorher zwei Abfragen je Gebirge.
 *
 * Problemfälle: Das Sammeln nimmt einem Gebirge einen Fluss oder See, der nur knapp berührt (Kante am Rahmen), oder gibt ihm einen fernen; das Laden eines einzelnen
 * Gebirges sieht weniger als das Laden aller; der Index mit mitgegebenen Aufträgen weicht vom selbst geladenen ab.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const QUELLE = "wi0283-auftraege";
const DOM = "aventuria";
const id = (art: number, n: number): string =>
    `28300001-${art.toString(16).padStart(4, "0")}-4000-8000-${n.toString(16).padStart(12, "0")}`;
const GEBIRGE_A = id(1, 1);
const GEBIRGE_B = id(1, 2);

describeWithDatabase("Aufträge der Gebirge: Flüsse und Seen gesammelt", () => {
    let database: Database;

    const aufraeumen = async (): Promise<void> => {
        await database`DELETE FROM terrain_control WHERE source_system = ${QUELLE}`;
        await database`DELETE FROM path WHERE source_system = ${QUELLE}`;
        await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE name LIKE 'wi0283 %')`;
        await database`DELETE FROM region WHERE name LIKE 'wi0283 %'`;
    };
    const flaeche = async (publicId: string, name: string, typ: string, wkt: string): Promise<string> => {
        const [region] = await database<{ id: string }[]>`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
            VALUES (gen_random_uuid(), ${DOM}, ${name}, 'topographie', ${typ}, TRUE) RETURNING id::text
        `;
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
            VALUES (${publicId}, ${DOM}, ${region!.id}::bigint, ST_GeomFromText(${wkt}), TRUE) RETURNING id::text
        `;
        return zeile!.id;
    };
    const fluss = async (name: string, x0: number, y0: number, x1: number, y1: number): Promise<void> => {
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, is_bach, geom, source_system, is_active)
            VALUES (gen_random_uuid(), ${DOM}, ${name}, 'Flussweg', false,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x0}, ${y0}), ST_MakePoint(${x1}, ${y1})), 0), ${QUELLE}, TRUE)
        `;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await seedMapDomains(database);
        await aufraeumen();
        for (const [publicId, name, wkt] of [
            [GEBIRGE_A, "wi0283 Gebirge A", "POLYGON((100 100, 200 100, 200 200, 100 200, 100 100))"],
            [GEBIRGE_B, "wi0283 Gebirge B", "POLYGON((700 700, 800 700, 800 800, 700 800, 700 700))"],
        ] as const) {
            const areaId = await flaeche(publicId, name, "gebirge", wkt);
            await database`
                INSERT INTO terrain_control (area_id, map_domain_id, source_system, maximalhoehe, erosion)
                VALUES (${areaId}::bigint, ${DOM}, ${QUELLE}, 2000, 1.5)
            `;
        }
        // Durch A; durch B; Hüllrechteck berührt A, kein Stützpunkt darin; weit weg.
        await fluss("wi0283 durch A", 150, 150, 250, 150);
        await fluss("wi0283 durch B", 750, 750, 850, 750);
        await fluss("wi0283 vorbei an A", 90, 90, 95, 300);
        await fluss("wi0283 fern", 400, 400, 450, 450);
        // Berührt A genau an der Kante; in B; fern.
        await flaeche(id(2, 1), "wi0283 See Kante", "see", "POLYGON((200 150, 220 150, 220 170, 200 170, 200 150))");
        await flaeche(id(2, 2), "wi0283 See B", "see", "POLYGON((710 710, 720 710, 720 720, 710 720, 710 710))");
        await flaeche(id(2, 3), "wi0283 See fern", "see", "POLYGON((400 400, 420 400, 420 420, 400 420, 400 400))");
    });

    afterAll(async () => {
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 jedes Gebirge bekommt genau seine Flüsse und Seen, auch den See an der Kante", async () => {
        const jobs = await loadMountainJobs(database, DOM);
        const job = (publicId: string) => jobs.find((eintrag) => eintrag.areaPublicId === publicId)!;
        const namen = (eintraege: readonly { n: string }[]) =>
            eintraege.map((e) => e.n).filter((n) => n.startsWith("wi0283"));
        expect(namen(job(GEBIRGE_A).input.fluesse)).toEqual(["wi0283 durch A"]);
        expect(namen(job(GEBIRGE_B).input.fluesse)).toEqual(["wi0283 durch B"]);
        expect(namen(job(GEBIRGE_A).input.seen)).toEqual(["wi0283 See Kante"]);
        expect(namen(job(GEBIRGE_B).input.seen)).toEqual(["wi0283 See B"]);
    });

    it("🔴 ein einzelnes Gebirge geladen ist derselbe Auftrag wie unter allen", async () => {
        const alle = await loadMountainJobs(database, DOM);
        const [einzeln] = await loadMountainJobs(database, DOM, [GEBIRGE_B]);
        expect(einzeln).toEqual(alle.find((eintrag) => eintrag.areaPublicId === GEBIRGE_B));
    });

    it("🔴 der erzeugte Kamm bleibt gleich, und ein zweites Laden ändert keinen Fingerabdruck", async () => {
        const erster = await loadMountainJobs(database, DOM);
        const zweiter = await loadMountainJobs(database, DOM);
        expect(zweiter.map((job) => job.fingerprint)).toEqual(erster.map((job) => job.fingerprint));
    });

    it("🔴 der Index mit mitgegebenen Aufträgen ist derselbe wie selbst geladen", async () => {
        const jobs = await loadMountainJobs(database, DOM);
        expect(await loadDomainInputIndex(database, DOM, jobs)).toEqual(await loadDomainInputIndex(database, DOM));
    });
});
