import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editorLandscapeUrl, type LandscapeUpdateBody } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Das Gebirge im „Fertig“ der Derographie (WI-0178 P4 × WI-0226): `PATCH /api/editor/landscapes/:id` mit `gebirge`, durch Fastify, als
 * App-Rolle im Wegwerf-Cluster (Beschluss der Editor-Orchestrierung 2026-10-18, Vorlage der Topographie). 🔴 Kein Test schreibt in
 * `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: ↺ geht über `null` und landet als 0 (ajv); die App-Rolle darf `terrain_control` nicht ändern oder kein neues Gebirge
 * anlegen; ein Wechsel zum Gebirge und seine ersten Werte gehen in zwei Operationen, oder das Verwerfen der alten Werte (T50) löscht
 * die neuen; eine Teilfläche einer anderen Landschaft wird über diese geschrieben; das Protokoll und die Quittung schweigen, das Gelände
 * rechnet darum nicht im Umkreis.
 */

const ENV = "landgebirge";
const vorlagen = ["auth-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const GEBIRGE = "d4d4d4d4-0000-4000-8000-000000000001";
const HUEGEL = "d4d4d4d4-0000-4000-8000-000000000002";
const GEBIRGE_ALT = "d4d4d4d4-0000-4000-8000-0000000000a1";
const GEBIRGE_NEU = "d4d4d4d4-0000-4000-8000-0000000000a2";
const HUEGEL_FLAECHE = "d4d4d4d4-0000-4000-8000-0000000000a3";
const SOURCE = "test-wi0178-p4";
const ZINNE = "d4d4d4d4-0000-4000-8000-0000000000b1";
const SPITZE = "d4d4d4d4-0000-4000-8000-0000000000b2";
const DRAUSSEN = "d4d4d4d4-0000-4000-8000-0000000000b3";

interface Werte {
    maximalhoehe: number | null;
    plateau: number | null;
    koernung: number | null;
    gebirgstyp: string | null;
    source_system: string;
}

describeWithCluster("Gebirge über PATCH, als App-Rolle (WI-0178 P4 × WI-0226)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let cookie = "";
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };

    const patch = (landschaft: string, payload: Omit<LandscapeUpdateBody, "operationId">) =>
        app.inject({
            method: "PATCH",
            url: editorLandscapeUrl(landschaft),
            headers: { cookie, origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), ...payload },
        });
    const werte = async (flaeche: string): Promise<Werte | undefined> => {
        const [zeile] = await cluster.admin<Werte[]>`
            SELECT c.maximalhoehe, c.plateau, c.koernung, c.gebirgstyp, c.source_system
              FROM terrain_control c JOIN region_area a ON a.id = c.area_id
             WHERE a.public_id = ${flaeche}::uuid AND c.is_active
        `;
        return zeile;
    };
    const protokoll = async (flaeche: string): Promise<{ action: string; changes: unknown }[]> =>
        cluster.admin<{ action: string; changes: unknown }[]>`
            SELECT action, changes FROM map_audit_event WHERE region_area_public_id = ${flaeche}::uuid ORDER BY id
        `;
    const revision = async (landschaft: string): Promise<number> => {
        const [zeile] = await cluster.admin<{ revision: number }[]>`
            SELECT revision::int AS revision FROM region WHERE public_id = ${landschaft}::uuid
        `;
        return zeile!.revision;
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        await cluster.admin`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_active, source_system)
            VALUES (${GEBIRGE}, 'aventuria', 'P4 Probegebirge', 'topographie', 'gebirge', 10, TRUE, ${SOURCE}),
                   (${HUEGEL}, 'aventuria', 'P4 Probehügel', 'topographie', 'huegelland', 11, TRUE, ${SOURCE})
        `;
        await cluster.admin`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${GEBIRGE_ALT}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((500 500, 520 500, 520 520, 500 520, 500 500))', 0), ${SOURCE}
              FROM region WHERE public_id = ${GEBIRGE}
            UNION ALL
            SELECT ${GEBIRGE_NEU}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((520 500, 540 500, 540 520, 520 520, 520 500))', 0), ${SOURCE}
              FROM region WHERE public_id = ${GEBIRGE}
            UNION ALL
            SELECT ${HUEGEL_FLAECHE}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((540 500, 560 500, 560 520, 540 520, 540 500))', 0), ${SOURCE}
              FROM region WHERE public_id = ${HUEGEL}
        `;
        // Eine Teilfläche mit Werten aus Legacy, die andere ohne Zeile (ein neues Gebirge).
        await cluster.admin`
            INSERT INTO terrain_control (area_id, map_domain_id, source_system, maximalhoehe, plateau, koernung)
            SELECT id, 'aventuria', 'legacy', 4000, 0.9, 14 FROM region_area WHERE public_id = ${GEBIRGE_ALT}
        `;
        // Zwei Gipfel im Gebirge (einer ohne Höhe), einer daneben in der Hügelfläche.
        await cluster.admin`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
            VALUES (${ZINNE}::uuid, 'aventuria', 'P4 Zinne', 'berggipfel', ST_SetSRID(ST_MakePoint(510, 510), 0), 3200),
                   (${SPITZE}::uuid, 'aventuria', 'P4 Spitze', 'vulkan', ST_SetSRID(ST_MakePoint(530, 505), 0), NULL),
                   (${DRAUSSEN}::uuid, 'aventuria', 'P4 Draußen', 'berggipfel', ST_SetSRID(ST_MakePoint(550, 510), 0), 900)
        `;
        const fixture = authFixture(cluster.admin);
        const person = await fixture.person("admin", { name: "Gebirge" });
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
    }, 240_000);
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    });

    it("🔴 das Detail trägt am Gebirge Typ und Abweichungen je Teilfläche, an anderen Flächen nichts", async () => {
        const lies = async (landschaft: string) =>
            (await app.inject({ method: "GET", url: editorLandscapeUrl(landschaft), headers: { cookie } })).json() as {
                areas: { id: string; gebirge?: unknown }[];
            };
        const gebirge = await lies(GEBIRGE);
        expect(gebirge.areas.find((a) => a.id === GEBIRGE_ALT)?.gebirge).toEqual({
            typ: null,
            muster: null,
            kammhoehe: 4000,
            werte: { plateau: 0.9, koernung: 14 },
            // WI-0245: die Werte des Rückennetzes, das Netz und die Revision der Gebirgswerte (eine Zeile aus Legacy: 1).
            modell: {},
            netz: { kaemme: [], nebengipfel: [] },
            saat: null,
            revision: 1,
        });
        expect(gebirge.areas.find((a) => a.id === GEBIRGE_NEU)?.gebirge).toEqual({
            typ: null,
            muster: null,
            kammhoehe: null,
            werte: {},
            modell: {},
            netz: { kaemme: [], nebengipfel: [] },
            saat: null,
            revision: 0,
        });
        expect((await lies(HUEGEL)).areas[0]).not.toHaveProperty("gebirge");
    });

    it("🔴 ↺ für Kammhöhe und Plateau setzt beide leer, die Körnung daneben wird geschrieben; Quittung und Protokoll nennen das Gebirge", async () => {
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: GEBIRGE_ALT, changes: { werte: { koernung: 40 }, zurueck: ["kammhoehe", "plateau"] } }],
        });
        expect(antwort.statusCode).toBe(200);
        expect(await werte(GEBIRGE_ALT)).toMatchObject({ maximalhoehe: null, plateau: null, koernung: 40 });
        // Die Gebirgswerte unter `affected`: Daran rechnet das Gelände im Umkreis neu (WI-0223).
        expect((antwort.json() as { affected: { kind: string; id: string }[] }).affected).toContainEqual({
            kind: "terrain_control",
            id: GEBIRGE_ALT,
            revision: 2,
        });
        expect(await protokoll(GEBIRGE_ALT)).toEqual([
            {
                action: "area.gebirge",
                changes: {
                    gebirge: {
                        before: { maximalhoehe: 4000, plateau: 0.9, koernung: 14 },
                        after: { maximalhoehe: null, plateau: null, koernung: 40 },
                    },
                },
            },
        ]);
    });

    it("🔴 ein neues Gebirge ohne Zeile: die App-Rolle legt sie an (Herkunft avesmaps3d)", async () => {
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: GEBIRGE_NEU, changes: { typ: "kammgebirge", kammhoehe: 1500 } }],
        });
        expect(antwort.statusCode).toBe(200);
        expect(await werte(GEBIRGE_NEU)).toMatchObject({
            gebirgstyp: "kammgebirge",
            maximalhoehe: 1500,
            source_system: "avesmaps3d",
        });
    });

    it("🪤 null im Feld kommt als 0 an: ↺ geht nur über `zurueck`", async () => {
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: GEBIRGE_ALT, changes: { werte: { plateau: null as unknown as number } } }],
        });
        expect(antwort.statusCode).toBe(200);
        expect((await werte(GEBIRGE_ALT))?.plateau).toBe(0);
    });

    it("🔴 dasselbe Feld setzen und zurücknehmen ist 400, nichts geschrieben", async () => {
        const vorher = await werte(GEBIRGE_ALT);
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: GEBIRGE_ALT, changes: { kammhoehe: 3000, zurueck: ["kammhoehe"] } }],
        });
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([400, "invalid_gebirge"]);
        expect(await werte(GEBIRGE_ALT)).toEqual(vorher);
    });

    it("🔴 eine Teilfläche einer anderen Landschaft ist 400, auch neben einer eigenen", async () => {
        const vorher = await werte(GEBIRGE_ALT);
        const antwort = await patch(HUEGEL, {
            gebirge: [{ area: GEBIRGE_ALT, changes: { werte: { koernung: 77 } } }],
        });
        expect(antwort.statusCode).toBe(400);
        expect(await werte(GEBIRGE_ALT)).toEqual(vorher);
    });

    it("🔴 zum Gebirge werden und die ersten Werte in EINER Operation: das Verwerfen der alten Werte (T50) trifft die neuen nicht", async () => {
        await cluster.admin`
            INSERT INTO terrain_control (area_id, map_domain_id, source_system, koernung)
            SELECT id, 'aventuria', 'legacy', 5 FROM region_area WHERE public_id = ${HUEGEL_FLAECHE}
        `;
        const antwort = await patch(HUEGEL, {
            baseRevision: await revision(HUEGEL),
            changes: { type: "gebirge" },
            gebirge: [{ area: HUEGEL_FLAECHE, changes: { typ: "rumpfgebirge" } }],
        });
        expect(antwort.statusCode).toBe(200);
        // Die alte Körnung aus Legacy ist verworfen, der Typ steht.
        expect(await werte(HUEGEL_FLAECHE)).toMatchObject({ gebirgstyp: "rumpfgebirge", koernung: null });
    });

    const gipfel = async (id: string): Promise<{ height: number | null; revision: number }> => {
        const [zeile] = await cluster.admin<{ height: number | null; revision: number }[]>`
            SELECT height_schritt AS height, revision::int AS revision FROM terrain_peak WHERE public_id = ${id}::uuid
        `;
        return zeile!;
    };

    it("🔴 P5: das Detail des Gebirges nennt die Gipfel in seinen Teilflächen, der höchste zuerst, mit Revision; Gipfel daneben nicht", async () => {
        const lies = async (landschaft: string) =>
            (await app.inject({ method: "GET", url: editorLandscapeUrl(landschaft), headers: { cookie } })).json() as {
                peaks?: { id: string; height?: number; revision: number }[];
            };
        const peaks = (await lies(GEBIRGE)).peaks ?? [];
        expect(peaks.map((p) => p.id)).toEqual([ZINNE, SPITZE]);
        expect(peaks[0]).toMatchObject({ height: 3200, revision: 1 });
        expect(peaks[1]).not.toHaveProperty("height");
        // Der Hügel ist seit dem Fall oben ein Gebirge: Er nennt nur den Gipfel in seiner Fläche.
        expect((await lies(HUEGEL)).peaks?.map((p) => p.id)).toEqual([DRAUSSEN]);
    });

    it("🔴 P5: die Höhe aus der Gipfelliste schreibt am Gipfel gegen seine Revision (EIN Schreibweg); Quittung nennt den Gipfel", async () => {
        const antwort = await patch(GEBIRGE, { peaks: [{ id: ZINNE, baseRevision: 1, height: 3400 }] });
        expect(antwort.statusCode).toBe(200);
        expect(await gipfel(ZINNE)).toEqual({ height: 3400, revision: 2 });
        expect((antwort.json() as { affected: { kind: string; id: string }[] }).affected).toContainEqual(
            expect.objectContaining({ kind: "peak", id: ZINNE }),
        );
        const [zeile] = await cluster.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE peak_public_id = ${ZINNE}::uuid ORDER BY id DESC LIMIT 1
        `;
        expect(zeile?.action).toBe("peak.updated");
        // Gegen eine alte Revision: 409, nichts geschrieben.
        const alt = await patch(GEBIRGE, { peaks: [{ id: ZINNE, baseRevision: 1, height: 3500 }] });
        expect([alt.statusCode, alt.json().error.code]).toEqual([409, "edit_conflict"]);
        expect((await gipfel(ZINNE)).height).toBe(3400);
    });

    it("🔴 P5: ein Gipfel außerhalb der Fläche ist 400, auch neben einem eigenen; nichts geschrieben", async () => {
        const vorher = await gipfel(SPITZE);
        const antwort = await patch(GEBIRGE, {
            peaks: [
                { id: SPITZE, baseRevision: vorher.revision, height: 2000 },
                { id: DRAUSSEN, baseRevision: 1, height: 1000 },
            ],
        });
        expect(antwort.statusCode).toBe(400);
        expect(await gipfel(SPITZE)).toEqual(vorher);
        expect((await gipfel(DRAUSSEN)).height).toBe(900);
    });
});
