import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mapChanges } from "../src/editor/history.ts";

/**
 * Die Suche der „Änderungen“ nach dem Namen eines Gegenstands, je Art (WI-0205, Auftrag der Editor-Orchestrierung 2026-10-18): Ort und
 * Weg fand sie immer; Kraftlinie, Derographie-Fläche (samt Teilfläche, die ihre Fläche mitträgt) und Herrschaftsgebiet (samt Fläche) fand
 * sie nicht, obwohl die Einträge sie mit Namen nennen (`history.ts`, `eintraege`). Problemfall: eine Operation an einer dieser Arten
 * fehlt im Treffer, oder ein Treffer kommt aus einem fremden Namen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const P = "c7c7c7c7-0000-4000-8000-";
const LINIE = `${P}000000000001`;
const FLAECHE = `${P}000000000002`;
const GEBIET = `${P}000000000003`;
const OP = {
    linie: `${P}0000000000a1`,
    flaeche: `${P}0000000000a2`,
    teil: `${P}0000000000a3`,
    gebiet: `${P}0000000000a4`,
};
const SOURCE = "test-changes-suche";

describeWithDatabase("Suche der „Änderungen“ je Art", { timeout: 120_000 }, () => {
    let database: Database;
    const personId = randomUUID();

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${Object.values(OP)}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${Object.values(OP)}::uuid[])`;
        await database`DELETE FROM powerline WHERE public_id = ${LINIE}::uuid`;
        await database`DELETE FROM region WHERE public_id = ${FLAECHE}::uuid`;
        await database`DELETE FROM territory WHERE public_id = ${GEBIET}::uuid`;
    }

    /** Eine Operation mit EINEM Protokolleintrag an den genannten Gegenständen (als Import: ohne Quittung des Schreibwegs). */
    async function operation(id: string, ziele: Record<string, string>): Promise<void> {
        await database`
            INSERT INTO map_operation (operation_id, map_domain_id, action, source, environment, actor_kind, actor_label, summary)
            VALUES (${id}::uuid, 'aventuria', 'test.changes_suche', 'import', 'test', 'system', 'test', NULL)
        `;
        await database`
            INSERT INTO map_audit_event (operation_id, action, powerline_public_id, region_public_id, region_area_public_id,
                                         territory_public_id, territory_area_public_id, changes)
            VALUES (${id}::uuid, 'test.geaendert', ${ziele["powerline"] ?? null}::uuid, ${ziele["region"] ?? null}::uuid,
                    ${ziele["region_area"] ?? null}::uuid, ${ziele["territory"] ?? null}::uuid,
                    ${ziele["territory_area"] ?? null}::uuid, '{}'::jsonb)
        `;
    }

    const findet = async (q: string): Promise<string[]> =>
        (await mapChanges(database, { mapDomainId: "aventuria", personId, q, limit: 200 })).entries.map(
            (eintrag) => eintrag.operationId,
        );

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await aufraeumen();
        await database`
            INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${LINIE}::uuid, 'aventuria', 'Suchader Nebelfels', TRUE, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
                    ST_GeomFromText('LINESTRING(100 500, 300 500)', 0), ST_GeomFromText('LINESTRING(100 500, 300 500)', 0), ${SOURCE})
        `;
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, source_system)
            VALUES (${FLAECHE}::uuid, 'aventuria', 'Suchwald Dämmerforst', 'vegetation', ${SOURCE})
        `;
        await database`
            INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
            VALUES (${GEBIET}::uuid, 'aventuria', 'Suchbaronie Grauweiler', '#336699', 0.5, ${SOURCE})
        `;
        await operation(OP.linie, { powerline: LINIE });
        await operation(OP.flaeche, { region: FLAECHE });
        // Eine Teilfläche trägt ihre Fläche mit (wie im Schreibweg der Derographie); ihre eigene Kennung zählt nicht.
        await operation(OP.teil, { region: FLAECHE, region_area: randomUUID() });
        await operation(OP.gebiet, { territory: GEBIET, territory_area: randomUUID() });
    }, 120_000);

    afterAll(async () => {
        await aufraeumen();
        await database.end();
    });

    it("🔴 eine Kraftlinie findet die Suche nach ihrem Namen", async () => {
        expect(await findet("nebelfels")).toEqual([OP.linie]);
    });

    it("🔴 eine Derographie-Fläche findet die Suche nach ihrem Namen, auch an einer Teilfläche", async () => {
        expect((await findet("Dämmerforst")).sort()).toEqual([OP.flaeche, OP.teil].sort());
    });

    it("🔴 ein Herrschaftsgebiet findet die Suche nach seinem Namen, auch an einer seiner Flächen", async () => {
        expect(await findet("GRAUWEILER")).toEqual([OP.gebiet]);
    });

    it("ein fremder Name findet keine dieser Operationen", async () => {
        const treffer = await findet("Suchkeinname");
        for (const id of Object.values(OP)) expect(treffer).not.toContain(id);
    });
});
