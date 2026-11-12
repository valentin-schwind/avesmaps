import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_GEBIRGE_URL,
    editorGebirgeProfilUrl,
    editorLandscapeUrl,
    editorPathUpdateUrl,
    type LandscapeUpdateBody,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Das gezeichnete Netz am Gebirge (WI-0245, Datenmodell C: Betreiber 2026-10-20 „C eigene tafeln.“; Nebengipfel als Formpunkte, N1):
 * `PATCH /api/editor/landscapes/:id` mit `gebirge[].changes.netz`, `modell` und `baseRevision`, durch Fastify, als App-Rolle im
 * Wegwerf-Cluster. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: Die App-Rolle darf die neuen Tafeln nicht schreiben; das Netz wird ergänzt statt ersetzt, oder seine Folge geht verloren;
 * ein Netz allein zählt die Revision nicht, und ein offener Entwurf überschreibt eine fremde Änderung still; das Protokoll kennt das alte
 * Netz nicht, ↺ hätte nichts zum Zurückschreiben; ein Netz außerhalb der Karte oder ein Kamm ohne Länge landet halb in der Tafel; ein
 * Wechsel zum Gebirge lässt das Netz einer früheren Zeit als Gebirge stehen.
 */

const ENV = "gebirgenetz";
const vorlagen = ["auth-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const GEBIRGE = "d5d5d5d5-0000-4000-8000-000000000001";
const HUEGEL = "d5d5d5d5-0000-4000-8000-000000000002";
const FLAECHE = "d5d5d5d5-0000-4000-8000-0000000000a1";
const HUEGEL_FLAECHE = "d5d5d5d5-0000-4000-8000-0000000000a2";
const SOURCE = "test-wi0245";

const NETZ = {
    kaemme: [
        {
            punkte: [
                [502, 510],
                [510, 512],
                [518, 509],
            ] as [number, number][],
            rang: "haupt" as const,
            // Höhe je Stützpunkt (WI-0249 P9): geschrieben als Paare `[Stelle, Höhe]`, der mittlere Punkt ohne eigene Höhe.
            hoehen: [
                [0, 2100],
                [2, 1900],
            ] as [number, number][],
        },
        {
            punkte: [
                [510, 512],
                [511, 518],
            ] as [number, number][],
            rang: "neben" as const,
        },
    ],
    nebengipfel: [
        { x: 515, y: 504, h: 1800 },
        { x: 505, y: 516 },
    ],
};
/** Die Kämme von `NETZ`, wie sie gelesen werden: Punkthöhen parallel zu den Punkten, `null` = Vorgabe. */
const NETZ_KAEMME_GELESEN = [
    { punkte: NETZ.kaemme[0]!.punkte, rang: "haupt", hoehen: [2100, null, 1900] },
    { punkte: NETZ.kaemme[1]!.punkte, rang: "neben" },
];

describeWithCluster("Netz am Gebirge über PATCH, als App-Rolle (WI-0245)", { timeout: 240_000 }, () => {
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
    const stand = async (landschaft: string, flaeche: string) => {
        const detail = (
            await app.inject({ method: "GET", url: editorLandscapeUrl(landschaft), headers: { cookie } })
        ).json() as {
            areas: { id: string; gebirge?: { netz: unknown; modell: unknown; revision: number } }[];
        };
        return detail.areas.find((a) => a.id === flaeche)?.gebirge;
    };
    const zeilen = async (flaeche: string) => ({
        kaemme: (
            await cluster.admin<
                { ordinal: number; rang: string; wkt: string; hoehen: (number | null)[] | null; h: number | null }[]
            >`
            SELECT e.ordinal, e.rang, ST_AsText(e.geom) AS wkt, to_json(e.heights_schritt) AS hoehen, e.height_schritt AS h
              FROM terrain_ridge_edge e JOIN region_area a ON a.id = e.area_id
             WHERE a.public_id = ${flaeche}::uuid ORDER BY e.ordinal
        `
        ).map(({ hoehen, h, ...rest }) => {
            // Die Höhe je Linie (0216) schreibt dieses Release nie mehr (0219).
            expect(h).toBeNull();
            return hoehen === null ? rest : { ...rest, hoehen };
        }),
        punkte: await cluster.admin<{ ordinal: number; wkt: string; h: number | null }[]>`
            SELECT p.ordinal, ST_AsText(p.geom) AS wkt, p.height_schritt AS h
              FROM terrain_ridge_point p JOIN region_area a ON a.id = p.area_id
             WHERE a.public_id = ${flaeche}::uuid ORDER BY p.ordinal
        `,
    });
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
            VALUES (${GEBIRGE}, 'aventuria', 'Netz Probegebirge', 'topographie', 'gebirge', 10, TRUE, ${SOURCE}),
                   (${HUEGEL}, 'aventuria', 'Netz Probehügel', 'topographie', 'huegelland', 11, TRUE, ${SOURCE})
        `;
        await cluster.admin`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${FLAECHE}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((500 500, 520 500, 520 520, 500 520, 500 500))', 0), ${SOURCE}
              FROM region WHERE public_id = ${GEBIRGE}
            UNION ALL
            SELECT ${HUEGEL_FLAECHE}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((540 500, 560 500, 560 520, 540 520, 540 500))', 0), ${SOURCE}
              FROM region WHERE public_id = ${HUEGEL}
        `;
        const fixture = authFixture(cluster.admin);
        const person = await fixture.person("admin", { name: "Netz" });
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        // Ohne Routing-Worker: Die Profile fragen sonst einen echten Worker (WI-0245); hier zählt nur, dass nichts erfunden wird.
        const ohneRouting = {
            run: () => Promise.resolve({ ok: false as const, error: "routing_failed" as const }),
            warm: () => undefined,
            status: () => ({ state: "cold" as const, ageMs: 0 }),
            close: () => Promise.resolve(),
        };
        app = buildApp({
            config,
            database: cluster.app,
            logStream: { write: () => undefined },
            routeRunner: ohneRouting,
        });
        await app.ready();
    }, 240_000);
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    });

    it("🔴 ein Netz an einem Gebirge ohne Zeile: die App-Rolle legt Zeile, Kämme in ihrer Folge und Nebengipfel an; Detail und Reiter lesen es", async () => {
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz: NETZ, baseRevision: 0 } }],
        });
        expect(antwort.statusCode).toBe(200);
        expect((antwort.json() as { affected: unknown[] }).affected).toContainEqual({
            kind: "terrain_control",
            id: FLAECHE,
            revision: 1,
        });
        expect(await zeilen(FLAECHE)).toEqual({
            kaemme: [
                {
                    ordinal: 0,
                    rang: "haupt",
                    wkt: "LINESTRING(502 510,510 512,518 509)",
                    hoehen: [2100, null, 1900],
                },
                { ordinal: 1, rang: "neben", wkt: "LINESTRING(510 512,511 518)" },
            ],
            punkte: [
                { ordinal: 0, wkt: "POINT(515 504)", h: 1800 },
                { ordinal: 1, wkt: "POINT(505 516)", h: null },
            ],
        });
        const gelesen = {
            kaemme: NETZ_KAEMME_GELESEN,
            nebengipfel: [NETZ.nebengipfel[0], { x: 505, y: 516, h: null }],
        };
        expect(await stand(GEBIRGE, FLAECHE)).toMatchObject({ netz: gelesen, modell: {}, revision: 1 });
        const reiter = await app.inject({
            method: "GET",
            url: `${EDITOR_GEBIRGE_URL}/${FLAECHE}`,
            headers: { cookie },
        });
        expect(reiter.statusCode).toBe(200);
        expect((reiter.json() as { stand: unknown }).stand).toMatchObject({ netz: gelesen, revision: 1 });
        // Die Profile der Flüsse und Pässe (WI-0245): Ohne Routing-Worker im Test gibt es kein Höhenmodell und keine erfundene Höhe.
        const profile = await app.inject({ method: "GET", url: editorGebirgeProfilUrl(FLAECHE), headers: { cookie } });
        expect(profile.statusCode).toBe(200);
        const body = profile.json() as {
            verfuegbar: boolean;
            fluesse: unknown[];
            paesse: unknown[];
            objekte: { fluesse: unknown[]; seen: unknown[]; paesse: unknown[] };
        };
        expect(body.verfuegbar).toBe(false);
        // Die Objekte kommen auch ohne Höhenmodell, in der Folge der Eingabe.
        expect(body.objekte.fluesse).toHaveLength(body.fluesse.length);
        expect(body.objekte.paesse).toHaveLength(body.paesse.length);
        expect(body.fluesse.every((profil) => profil === null)).toBe(true);
        expect(body.paesse.every((profil) => profil === null)).toBe(true);
    });

    it("🔴 das Protokoll hält das ganze Netz vorher und nachher (Grundlage für ↺); ein gleiches Netz ist keine Änderung", async () => {
        const [zeile] = await cluster.admin<
            { changes: { gebirge: { before: { netz: unknown }; after: { netz: unknown } } } }[]
        >`
            SELECT changes FROM map_audit_event WHERE region_area_public_id = ${FLAECHE}::uuid AND action = 'area.gebirge'
             ORDER BY id DESC LIMIT 1
        `;
        expect(zeile!.changes.gebirge.before.netz).toEqual({ kaemme: [], nebengipfel: [] });
        expect(zeile!.changes.gebirge.after.netz).toMatchObject({ kaemme: NETZ_KAEMME_GELESEN });
        const nochmal = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz: NETZ, baseRevision: 1 } }],
        });
        expect(nochmal.statusCode).toBe(200);
        expect((await stand(GEBIRGE, FLAECHE))?.revision).toBe(1);
    });

    it("🔴 gegen eine alte Revision: 409 `edit_conflict` mit wer und wann, nichts geschrieben", async () => {
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz: { kaemme: [], nebengipfel: [] }, baseRevision: 0 } }],
        });
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details).toMatchObject({ currentRevision: 1, changedBy: { displayName: "Netz" } });
        expect((await zeilen(FLAECHE)).kaemme).toHaveLength(2);
    });

    it("🔴 Werte des Rückennetzes setzen und über `zurueck` leeren; jede Änderung zählt die Revision", async () => {
        const gesetzt = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        // Die Erosionsfestigkeit (WI-0249, Migration 0222) in Prozent, wie sie der Reiter zeigt.
                        modell: { grat: 0.2, gratBreite: 0.6, talboden: 0.4, erosionsfestigkeit: 60 },
                        baseRevision: 1,
                    },
                },
            ],
        });
        expect(gesetzt.statusCode).toBe(200);
        expect(await stand(GEBIRGE, FLAECHE)).toMatchObject({
            modell: { grat: 0.2, gratBreite: 0.6, talboden: 0.4, erosionsfestigkeit: 60 },
            revision: 2,
        });
        const zurueck = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { zurueck: ["talboden", "gratBreite"], baseRevision: 2 } }],
        });
        expect(zurueck.statusCode).toBe(200);
        // Was nicht in `zurueck` steht, bleibt: die Erosionsfestigkeit.
        expect(await stand(GEBIRGE, FLAECHE)).toMatchObject({
            modell: { grat: 0.2, erosionsfestigkeit: 60 },
            revision: 3,
        });
        const [zeile] = await cluster.admin<{ changes: { gebirge: { before: unknown; after: unknown } } }[]>`
            SELECT changes FROM map_audit_event WHERE region_area_public_id = ${FLAECHE}::uuid AND action = 'area.gebirge'
             ORDER BY id DESC LIMIT 1
        `;
        expect(zeile!.changes.gebirge).toEqual({
            before: { grat_breite: 0.6, talboden: 0.4 },
            after: { grat_breite: null, talboden: null },
        });
        // Außerhalb der Grenzen des Editors (Gratlinie bis 0,3): 400.
        const zuViel = await patch(GEBIRGE, { gebirge: [{ area: FLAECHE, changes: { modell: { grat: 0.5 } } }] });
        expect(zuViel.statusCode).toBe(400);
        // Die Erosionsfestigkeit geht bis 100 %.
        const zuFest = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { modell: { erosionsfestigkeit: 120 } } }],
        });
        expect(zuFest.statusCode).toBe(400);
    });

    it("🔴 ein Netz außerhalb der Karte und ein Kamm ohne Länge sind 400; das alte Netz bleibt ganz", async () => {
        const draussen = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        netz: {
                            kaemme: [
                                {
                                    punkte: [
                                        [510, 510],
                                        [-90_000_000, 510],
                                    ],
                                    rang: "haupt",
                                },
                            ],
                            nebengipfel: [],
                        },
                    },
                },
            ],
        });
        expect([draussen.statusCode, draussen.json().error.code]).toEqual([400, "invalid_gebirge"]);
        const ohneLaenge = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        netz: {
                            kaemme: [
                                {
                                    punkte: [
                                        [510, 510],
                                        [510, 510],
                                    ],
                                    rang: "neben",
                                },
                            ],
                            nebengipfel: [],
                        },
                    },
                },
            ],
        });
        expect([ohneLaenge.statusCode, ohneLaenge.json().error.code]).toEqual([400, "invalid_gebirge"]);
        expect((await zeilen(FLAECHE)).kaemme).toHaveLength(2);
        expect((await zeilen(FLAECHE)).punkte).toHaveLength(2);
    });

    it("🔴 ein leeres Netz nimmt alle Kämme und Nebengipfel weg (das Gebirge rechnet wieder die V12)", async () => {
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz: { kaemme: [], nebengipfel: [] }, baseRevision: 3 } }],
        });
        expect(antwort.statusCode).toBe(200);
        expect(await zeilen(FLAECHE)).toEqual({ kaemme: [], punkte: [] });
        expect((await stand(GEBIRGE, FLAECHE))?.revision).toBe(4);
    });

    it("🔴 zum Gebirge werden verwirft auch ein Netz aus einer früheren Zeit als Gebirge (T50)", async () => {
        await cluster.admin`
            INSERT INTO terrain_ridge_edge (area_id, map_domain_id, ordinal, rang, geom)
            SELECT id, 'aventuria', 0, 'haupt', ST_GeomFromText('LINESTRING(545 510, 555 510)', 0) FROM region_area WHERE public_id = ${HUEGEL_FLAECHE}
        `;
        const antwort = await patch(HUEGEL, { baseRevision: await revision(HUEGEL), changes: { type: "gebirge" } });
        expect(antwort.statusCode).toBe(200);
        expect((await zeilen(HUEGEL_FLAECHE)).kaemme).toEqual([]);
    });

    it("🔴 Saat würfeln (Migration 0214): gespeichert, im Detail gelesen, über `zurueck` wieder abgeleitet; außerhalb von INTEGER 400", async () => {
        const vorher = (await stand(GEBIRGE, FLAECHE)) as { revision: number };
        const gesetzt = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { saat: -123456789, baseRevision: vorher.revision } }],
        });
        expect(gesetzt.statusCode).toBe(200);
        expect(await stand(GEBIRGE, FLAECHE)).toMatchObject({ saat: -123456789, revision: vorher.revision + 1 });
        const zurueck = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { zurueck: ["saat"], baseRevision: vorher.revision + 1 } }],
        });
        expect(zurueck.statusCode).toBe(200);
        expect(await stand(GEBIRGE, FLAECHE)).toMatchObject({ saat: null });
        const zuGross = await patch(GEBIRGE, { gebirge: [{ area: FLAECHE, changes: { saat: 2 ** 31 } }] });
        expect(zuGross.statusCode).toBe(400);
    });
    it("Tal und Mulden speichern Boden 0/Vorgabe, Revision und alte Clients verlieren keine Mulden", async () => {
        const vorher = await stand(GEBIRGE, FLAECHE);
        const netz = {
            kaemme: [
                {
                    punkte: [
                        [502, 510],
                        [518, 509],
                    ] as [number, number][],
                    rang: "tal" as const,
                    // Ein Client vor 0219 schickt die Höhe der ganzen Linie: Der Server füllt damit beide Stützpunkte (WI-0249 P9).
                    h: 700,
                },
            ],
            nebengipfel: [],
            mulden: [
                { x: 505, y: 505, h: 0 },
                { x: 508, y: 508 },
            ],
        };
        const talGelesen = [{ punkte: netz.kaemme[0]!.punkte, rang: "tal", hoehen: [700, 700] }];
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz, baseRevision: vorher!.revision } }],
        });
        expect(antwort.statusCode).toBe(200);
        const gelesen = await stand(GEBIRGE, FLAECHE);
        expect(gelesen).toMatchObject({
            netz: {
                kaemme: talGelesen,
                nebengipfel: [],
                mulden: [
                    { x: 505, y: 505, h: 0 },
                    { x: 508, y: 508, h: null },
                ],
            },
        });
        expect(gelesen!.revision).toBeGreaterThan(vorher!.revision);
        const nochmal = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz, baseRevision: gelesen!.revision } }],
        });
        expect(nochmal.statusCode).toBe(200);
        expect((await stand(GEBIRGE, FLAECHE))!.revision).toBe(gelesen!.revision);
        const konflikt = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz, baseRevision: vorher!.revision } }],
        });
        expect(konflikt.statusCode).toBe(409);
        // Der Rückweg liest ausschließlich die alten Tafeln: Senken dürfen dort nicht als Rücken erscheinen.
        expect(await zeilen(FLAECHE)).toEqual({ kaemme: [], punkte: [] });
        const alt = await patch(GEBIRGE, {
            gebirge: [
                { area: FLAECHE, changes: { netz: { kaemme: [], nebengipfel: [] }, baseRevision: gelesen!.revision } },
            ],
        });
        expect(alt.statusCode).toBe(200);
        expect((await stand(GEBIRGE, FLAECHE))!.netz).toMatchObject({
            kaemme: talGelesen,
            mulden: [
                { x: 505, y: 505, h: 0 },
                { x: 508, y: 508, h: null },
            ],
        });
        const leer = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz: { kaemme: [], nebengipfel: [], mulden: [] } } }],
        });
        expect(leer.statusCode).toBe(200);
        expect((await zeilen(FLAECHE)).punkte).toEqual([]);
        expect((await stand(GEBIRGE, FLAECHE))!.netz).toEqual({ kaemme: [], nebengipfel: [] });
        // Gültiger API-Aufruf mit explizitem Tal ohne Muldenfeld: Das Tal wird übernommen, nicht still verworfen.
        const nurTal = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz: { kaemme: netz.kaemme, nebengipfel: [] } } }],
        });
        expect(nurTal.statusCode).toBe(200);
        expect((await stand(GEBIRGE, FLAECHE))!.netz).toMatchObject({ kaemme: talGelesen });
    });

    it("🔴 Punkthöhen (WI-0249 P9): Paare geschrieben, als Liste je Stützpunkt gelesen, Tal mit eigener Sohle; eine Stelle hinter dem letzten Punkt ist 400", async () => {
        const vorher = (await stand(GEBIRGE, FLAECHE))!;
        const netz = {
            kaemme: [
                {
                    punkte: [
                        [502, 510],
                        [510, 512],
                        [518, 509],
                    ] as [number, number][],
                    rang: "neben" as const,
                    hoehen: [
                        [1, 0],
                        [2, 65535],
                    ] as [number, number][],
                },
                {
                    punkte: [
                        [503, 503],
                        [517, 503],
                    ] as [number, number][],
                    rang: "tal" as const,
                    hoehen: [[0, 450]] as [number, number][],
                },
            ],
            nebengipfel: [{ x: 512, y: 515, h: 2300 }],
            mulden: [],
        };
        const antwort = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz, baseRevision: vorher.revision } }],
        });
        expect(antwort.statusCode).toBe(200);
        expect((await stand(GEBIRGE, FLAECHE))!.netz).toEqual({
            kaemme: [
                { punkte: netz.kaemme[0]!.punkte, rang: "neben", hoehen: [null, 0, 65535] },
                { punkte: netz.kaemme[1]!.punkte, rang: "tal", hoehen: [450, null] },
            ],
            nebengipfel: [{ x: 512, y: 515, h: 2300 }],
        });
        const [tal] = await cluster.admin<{ hoehen: (number | null)[]; h: number | null }[]>`
            SELECT to_json(v.heights_schritt) AS hoehen, v.height_schritt AS h
              FROM terrain_valley_edge v JOIN region_area a ON a.id = v.area_id WHERE a.public_id = ${FLAECHE}::uuid
        `;
        expect(tal).toEqual({ hoehen: [450, null], h: null });
        const daneben = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        netz: {
                            ...netz,
                            kaemme: [{ ...netz.kaemme[0]!, hoehen: [[3, 1000]] as [number, number][] }],
                        },
                    },
                },
            ],
        });
        expect([daneben.statusCode, daneben.json().error.code]).toEqual([400, "invalid_gebirge"]);
        const zuHoch = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        netz: {
                            ...netz,
                            kaemme: [{ ...netz.kaemme[0]!, hoehen: [[0, 65536]] as [number, number][] }],
                        },
                    },
                },
            ],
        });
        expect(zuHoch.statusCode).toBe(400);
        // Nichts davon ist geschrieben.
        expect((await zeilen(FLAECHE)).kaemme).toEqual([
            { ordinal: 0, rang: "neben", wkt: "LINESTRING(502 510,510 512,518 509)", hoehen: [null, 0, 65535] },
        ]);
    });

    it("🔴 Übergang aus 0216: eine Linie mit Höhe je Linie liest sich als dieselbe Höhe an allen Stützpunkten; neu geschrieben steht sie je Punkt", async () => {
        await cluster.admin`
            UPDATE terrain_ridge_edge e SET heights_schritt = NULL, height_schritt = 1700
              FROM region_area a WHERE a.id = e.area_id AND a.public_id = ${FLAECHE}::uuid
        `;
        const gelesen = (await stand(GEBIRGE, FLAECHE))! as {
            netz: { kaemme: { hoehen?: unknown }[]; nebengipfel: unknown[] };
            revision: number;
        };
        expect(gelesen.netz.kaemme[0]!.hoehen).toEqual([1700, 1700, 1700]);
        // Der Editor schreibt das gelesene Netz zurück: Die Höhe steht je Punkt, die alte Spalte ist leer.
        const kamm = gelesen.netz.kaemme[0] as { punkte: [number, number][]; rang: "neben"; hoehen: number[] };
        const antwort = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        netz: {
                            kaemme: [
                                {
                                    punkte: kamm.punkte,
                                    rang: kamm.rang,
                                    hoehen: kamm.hoehen.map((h, i) => [i, i === 1 ? 1500 : h] as [number, number]),
                                },
                            ],
                            nebengipfel: [{ x: 512, y: 515, h: 2300 }],
                            mulden: [],
                        },
                        baseRevision: gelesen.revision,
                    },
                },
            ],
        });
        expect(antwort.statusCode).toBe(200);
        expect((await zeilen(FLAECHE)).kaemme).toEqual([
            { ordinal: 0, rang: "neben", wkt: "LINESTRING(502 510,510 512,518 509)", hoehen: [1700, 1500, 1700] },
        ]);
    });

    it("🔴 Kammhöhe und Netz in EINER Operation (die mitgenommenen Punkthöhen): ein Protokolleintrag mit beiden, ↺ hat beides", async () => {
        const vorher = (await stand(GEBIRGE, FLAECHE))! as { revision: number };
        const antwort = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        kammhoehe: 3000,
                        netz: {
                            kaemme: [
                                {
                                    punkte: [
                                        [502, 510],
                                        [510, 512],
                                        [518, 509],
                                    ],
                                    rang: "neben",
                                    hoehen: [
                                        [0, 2550],
                                        [1, 2250],
                                        [2, 2550],
                                    ],
                                },
                            ],
                            nebengipfel: [{ x: 512, y: 515, h: 2300 }],
                            mulden: [],
                        },
                        baseRevision: vorher.revision,
                    },
                },
            ],
        });
        expect(antwort.statusCode).toBe(200);
        const eintraege = await cluster.admin<
            { changes: { gebirge: { before: Record<string, unknown>; after: Record<string, unknown> } } }[]
        >`
            SELECT changes FROM map_audit_event WHERE region_area_public_id = ${FLAECHE}::uuid AND action = 'area.gebirge'
               AND operation_id = (SELECT operation_id FROM map_audit_event WHERE region_area_public_id = ${FLAECHE}::uuid
                                    AND action = 'area.gebirge' ORDER BY id DESC LIMIT 1)
        `;
        expect(eintraege).toHaveLength(1);
        const { before, after } = eintraege[0]!.changes.gebirge;
        expect([before["maximalhoehe"], after["maximalhoehe"]]).toEqual([null, 3000]);
        expect((before["netz"] as { kaemme: { hoehen: number[] }[] }).kaemme[0]!.hoehen).toEqual([1700, 1500, 1700]);
        expect((after["netz"] as { kaemme: { hoehen: number[] }[] }).kaemme[0]!.hoehen).toEqual([2550, 2250, 2550]);
    });

    it("🔴 Höhen an Flüssen und Seen (WI-0249, 0230): nach Lage geschrieben und gelesen; ohne das Feld bleiben sie, leer nimmt sie weg", async () => {
        // Ein Fluss mit einem Stützpunkt an der Stelle der Flusshöhe: Das Netz speichert nur Flusshöhen auf dem Stützpunkt eines aktiven Flusswegs
        // (WI-0259, „Höhe wandert mit“); eine ohne ihn ist verwaist und fällt beim Schreiben weg (`editor-path-fluss-hoehen.test.ts`).
        await cluster.admin`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES ('d5d5d5d5-0000-4000-8000-0000000000f1', 'aventuria', 'Netz Fluss', 'Flussweg', FALSE, FALSE,
                    ST_GeomFromText('LINESTRING(503 505, 505.5 505.25, 508 506)', 0), ${SOURCE}, TRUE)
        `;
        const kamm = {
            punkte: [
                [502, 510],
                [518, 509],
            ] as [number, number][],
            rang: "haupt" as const,
        };
        const mit = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        netz: {
                            kaemme: [kamm],
                            nebengipfel: [],
                            mulden: [],
                            flussHoehen: [{ x: 505.5, y: 505.25, h: 1200 }],
                            seeHoehen: [{ x: 510, y: 515, h: 900 }],
                        },
                    },
                },
            ],
        });
        expect(mit.statusCode).toBe(200);
        expect((await stand(GEBIRGE, FLAECHE))!.netz).toEqual({
            kaemme: [kamm],
            nebengipfel: [],
            flussHoehen: [{ x: 505.5, y: 505.25, h: 1200 }],
            seeHoehen: [{ x: 510, y: 515, h: 900 }],
        });
        const zeilenWasser = () => cluster.admin<{ art: string; ordinal: number; wkt: string; h: number }[]>`
            SELECT w.art, w.ordinal, ST_AsText(w.geom) AS wkt, w.height_schritt AS h
              FROM terrain_water_height w JOIN region_area a ON a.id = w.area_id
             WHERE a.public_id = ${FLAECHE}::uuid ORDER BY w.art, w.ordinal
        `;
        expect(await zeilenWasser()).toEqual([
            { art: "fluss", ordinal: 0, wkt: "POINT(505.5 505.25)", h: 1200 },
            { art: "see", ordinal: 0, wkt: "POINT(510 515)", h: 900 },
        ]);
        // Ein alter Client nennt sie nicht: Sie bleiben, auch wenn er das Netz sonst ändert.
        const alt = await patch(GEBIRGE, {
            gebirge: [{ area: FLAECHE, changes: { netz: { kaemme: [{ ...kamm, rang: "neben" }], nebengipfel: [] } } }],
        });
        expect(alt.statusCode).toBe(200);
        expect((await zeilenWasser()).length).toBe(2);
        // Über den Grenzen eines Schritts: 400, nichts geschrieben.
        const zuHoch = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        netz: { kaemme: [kamm], nebengipfel: [], flussHoehen: [{ x: 505.5, y: 505.25, h: 65536 }] },
                    },
                },
            ],
        });
        expect(zuHoch.statusCode).toBe(400);
        expect((await zeilenWasser()).length).toBe(2);
        // Leere Listen nehmen sie weg; das gelesene Netz trägt dann keine Felder dafür.
        const leer = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: { netz: { kaemme: [kamm], nebengipfel: [], mulden: [], flussHoehen: [], seeHoehen: [] } },
                },
            ],
        });
        expect(leer.statusCode).toBe(200);
        expect(await zeilenWasser()).toEqual([]);
        expect((await stand(GEBIRGE, FLAECHE))!.netz).toEqual({ kaemme: [kamm], nebengipfel: [] });
        // Eine Flusshöhe, an der kein Fluss einen Stützpunkt hat (verwaist), speichert das Netz nicht; die auf dem Stützpunkt bleibt.
        const verwaist = await patch(GEBIRGE, {
            gebirge: [
                {
                    area: FLAECHE,
                    changes: {
                        netz: {
                            kaemme: [kamm],
                            nebengipfel: [],
                            flussHoehen: [
                                { x: 505.5, y: 505.25, h: 1200 },
                                { x: 515, y: 515, h: 700 },
                            ],
                        },
                    },
                },
            ],
        });
        expect(verwaist.statusCode).toBe(200);
        expect(await zeilenWasser()).toEqual([{ art: "fluss", ordinal: 0, wkt: "POINT(505.5 505.25)", h: 1200 }]);
    });
    it("🔴 Der Wegeditor zieht die Flusshöhe mit (WI-0259), als App-Rolle: die Höhe liegt am neuen Stützpunkt, die Gebirgswerte zählen ihre Revision", async () => {
        const fluss = "d5d5d5d5-0000-4000-8000-0000000000f1";
        const wasser = () => cluster.admin<{ wkt: string; h: number }[]>`
            SELECT ST_AsText(w.geom) AS wkt, w.height_schritt AS h
              FROM terrain_water_height w JOIN region_area a ON a.id = w.area_id
             WHERE a.public_id = ${FLAECHE}::uuid AND w.art = 'fluss' ORDER BY w.ordinal
        `;
        expect(await wasser()).toEqual([{ wkt: "POINT(505.5 505.25)", h: 1200 }]);
        const [weg] = await cluster.admin<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM path WHERE public_id = ${fluss}::uuid`;
        const vorher = (await stand(GEBIRGE, FLAECHE))!.revision;
        const antwort = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(fluss),
            headers: { cookie, origin: TEST_ORIGIN },
            payload: {
                operationId: randomUUID(),
                sections: [{ publicId: fluss, baseRevision: weg!.revision }],
                shape: {
                    publicId: fluss,
                    points: [
                        { x: 503, y: 505 },
                        { x: 506, y: 505.75 },
                        { x: 508, y: 506 },
                    ],
                    carried: [],
                },
            },
        });
        expect(antwort.statusCode).toBe(200);
        expect(await wasser()).toEqual([{ wkt: "POINT(506 505.75)", h: 1200 }]);
        expect((antwort.json() as { affected: unknown[] }).affected).toContainEqual({
            kind: "terrain_control",
            id: FLAECHE,
            revision: vorher + 1,
        });
        expect((await stand(GEBIRGE, FLAECHE))!.revision).toBe(vorher + 1);
    });
});
