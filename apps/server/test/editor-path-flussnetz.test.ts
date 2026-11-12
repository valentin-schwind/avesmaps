import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    editorPathFlussnetzUrl,
    fliessrichtungDemLaufNach,
    type EditorPathFlussnetz,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";

/**
 * Das Flussnetz einer Straße (OPS-000112, `GET /api/editor/paths/:id/street/flussnetz`) gegen echtes PostgreSQL (Wegwerf-Postgres von
 * `vor-dem-push`, sonst `avesmaps3d_test`): die Knoten der Wegfindung je Flussabschnitt, für „Fließrichtung auf alle Abschnitte übernehmen“.
 *
 * Der Fluss „FN Testfluss“: H1 – (Stoß 0,01 daneben) – H2 – Delta in D1 und D2; L liegt 5 weiter, getrennt durch eine Lücke; T und U enden
 * beide im Kasten des Orts „FN Furt“, 0,4 auseinander; dazu ein Landweg gleichen Namens.
 *
 * Problemfälle: Enden im Fangradius bekommen verschiedene Knoten (der Knopf hielte mitten im Fluss); die Lücke wird überbrückt (er liefe über
 * sie hinweg); der Ort zählt nicht als Knoten; der Landweg kommt mit; ohne Anmeldung gibt es Daten.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-ops112-flussnetz";
const P = "a1120112-0000-4000-8000-0000000001";
const W = {
    h1: `${P}a1`,
    h2: `${P}a2`,
    d1: `${P}b1`,
    d2: `${P}b2`,
    l: `${P}c1`,
    t: `${P}d1`,
    u: `${P}d2`,
    land: `${P}e1`,
} as const;
const FURT = `${P}ff`;

describeWithDatabase("Flussnetz der Straße (OPS-000112)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    const cookies = new Map<Role, string>();
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM path_visual WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    const linie = (punkte: readonly (readonly [number, number])[]): string =>
        `LINESTRING(${punkte.map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")})`;
    const strecke = (id: string, subtype: string, punkte: readonly (readonly [number, number])[]) => database`
        INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, is_tunnel, flow_direction, geom, source_system)
        VALUES (${id}, 'aventuria', 'FN Testfluss', ${subtype}, TRUE, FALSE, FALSE,
                ${subtype === "Flussweg" ? "forward" : null}, ST_GeomFromText(${linie(punkte)}, 0), ${SOURCE})
    `;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        const fixture = authFixture(database);
        const person = await fixture.person("reviewer", { name: "OPS-112 Flussnetz" });
        cookies.set("reviewer", (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${FURT}, 'aventuria', 'FN Furt', 'dorf', ST_SetSRID(ST_MakePoint(930, 400), 0), ${SOURCE}, TRUE)
        `;
        await strecke(W.h1, "Flussweg", [
            [900, 400],
            [902, 401],
            [905, 400],
        ]);
        await strecke(W.h2, "Flussweg", [
            [905.01, 400],
            [910, 400],
        ]);
        await strecke(W.d1, "Flussweg", [
            [910, 400],
            [915, 402],
        ]);
        // D2 andersherum gezeichnet: vom Meer zur Gabelung.
        await strecke(W.d2, "Flussweg", [
            [915, 398],
            [910, 400],
        ]);
        await strecke(W.l, "Flussweg", [
            [920, 400],
            [925, 400],
        ]);
        await strecke(W.t, "Flussweg", [
            [930.2, 400.1],
            [935, 400],
        ]);
        await strecke(W.u, "Flussweg", [
            [929.8, 399.9],
            [926, 399],
        ]);
        await strecke(W.land, "Weg", [
            [900, 390],
            [905, 390],
        ]);
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    const lies = (role?: Role) =>
        app.inject({
            method: "GET",
            url: editorPathFlussnetzUrl(W.h1),
            headers: role === undefined ? {} : { cookie: cookies.get(role) ?? "" },
        });

    it("🔴 Enden im Fangradius und im Ortskasten teilen einen Knoten, die Lücke trennt, der Landweg fehlt", async () => {
        const antwort = await lies("reviewer");
        expect(antwort.statusCode).toBe(200);
        const netz = antwort.json<EditorPathFlussnetz>();
        const je = new Map(netz.abschnitte.map((a) => [a.id, a] as const));
        expect([...je.keys()].sort()).toEqual([W.h1, W.h2, W.d1, W.d2, W.l, W.t, W.u].sort());
        const anfang = (id: string): string => je.get(id)!.knoten[0]!;
        const ende = (id: string): string => je.get(id)!.knoten.at(-1)!;
        expect(anfang(W.h2)).toBe(ende(W.h1));
        expect(anfang(W.d1)).toBe(ende(W.h2));
        expect(ende(W.d2)).toBe(ende(W.h2));
        const ohneL = new Set([W.h1, W.h2, W.d1, W.d2, W.t, W.u].flatMap((id) => je.get(id)!.knoten));
        expect(ohneL.has(anfang(W.l)) || ohneL.has(ende(W.l))).toBe(false);
        expect(anfang(W.t)).toBe(FURT);
        expect(anfang(W.u)).toBe(FURT);
        expect(je.get(W.h1)!.laengen[0]).toBeCloseTo(Math.hypot(2, 1) + Math.hypot(3, 1), 3);
    });

    it("dem Lauf nach: vom Oberlauf in beide Arme, D2 gegen seine Zeichenrichtung; hinter der Lücke nichts", async () => {
        const netz = (await lies("reviewer")).json<EditorPathFlussnetz>();
        const lauf = fliessrichtungDemLaufNach(netz.abschnitte, W.h1, "forward");
        expect(lauf.neu).toEqual({ [W.h1]: "forward", [W.h2]: "forward", [W.d1]: "forward", [W.d2]: "reverse" });
        expect([...lauf.unterbrochen].sort()).toEqual([W.l, W.t, W.u].sort());
    });

    it("ohne Anmeldung 401", async () => {
        expect((await lies()).statusCode).toBe(401);
    });
});
