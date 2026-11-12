import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ApiErrorBody,
    InvalidAreasResult,
    LooseEndsResult,
    MAP_CHECKS_URL,
    MapCheckResult,
    NoWikiResult,
    UnconnectedResult,
    type PathsApartResult,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    linesOf,
    loadRiverLines,
    looseEndsFrom,
    unconnectedFrom,
    UPHILL_FINDING_CODE,
    uphillRiverRefs,
} from "../src/map-checks/checks.ts";
import type { RouteNetwork } from "../src/routing/network.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";

/**
 * Die Prüfhaken im Auge (WI-0131 Stufe 1): der Leseweg je Prüfung.
 *
 * Problemfälle: ein Besucher oder Tester liest die Funde; eine interne Kennung (`path.id`) geht hinaus; ein verborgener Ort oder ein
 * Nodix an einer Kraftlinie gilt als unverbunden; ein Weg mit bloßem Griff („Pfad-…“) oder ein Ort mit X2-Zuweisung gilt als ohne Wiki;
 * die erlaubten Anstiege an Gipfelkernen werden markiert; ein unveränderter Stand wird jedes Mal neu übertragen; eine Fläche, die sich
 * kreuzt, fehlt unter „Flächen kreuzen sich“, oder eine stillgelegte steht dort.
 * Soll: ab Reviewer, 401/403 vor jeder Abfrage, 400 für eine unbekannte Prüfung, nur öffentliche Kennungen, Legacys Regeln, ETag mit 304.
 */

describe("Prüfhaken: reine Teile", () => {
    it("liest den Befund „Flüsse bergaufwärts“ mit Anstieg je Fluss, und nur ihn", () => {
        const findings = [
            {
                code: "gelaende/fluss_bergauf_ungeloest",
                objects: [{ publicId: "999" }],
                notes: ["X (999): Anstieg 5 Schritt"],
            },
            {
                code: UPHILL_FINDING_CODE,
                objects: [{ publicId: "186789" }, { publicId: "0b6f6a52-6a0e-4f43-9d3a-6f1d6c2f0a17" }],
                notes: [
                    "Flussweg-9297 (186789): Anstieg 1455.4848960000072 Schritt",
                    "Aufwärtsbach (0b6f6a52-6a0e-4f43-9d3a-6f1d6c2f0a17): Anstieg 12 Schritt",
                ],
            },
        ];
        expect(uphillRiverRefs(findings)).toEqual([
            { ref: "186789", rise: 1455.4848960000072 },
            { ref: "0b6f6a52-6a0e-4f43-9d3a-6f1d6c2f0a17", rise: 12 },
        ]);
        expect(uphillRiverRefs(undefined)).toEqual([]);
        expect(uphillRiverRefs([{ code: "gelaende/meer_nicht_null" }])).toEqual([]);
    });

    it("liest Linien aus LineString und MultiLineString", () => {
        expect(linesOf('{"type":"LineString","coordinates":[[1,2],[3,4]]}')).toEqual([
            [
                [1, 2],
                [3, 4],
            ],
        ]);
        expect(linesOf('{"type":"MultiLineString","coordinates":[[[1,2],[3,4]],[[5,6],[7,8]]]}')).toHaveLength(2);
    });

    it("Offene Wegenden: ein Ring je losem Kantenende, der Weg ganz; Treffpunkte und Wege ohne Kante nur als Zahl (B)", () => {
        const result = looseEndsFrom(
            {
                loose: [{ pathPublicId: "w1", x: 10.2, y: 5 } as never],
                detached: [{ pathPublicId: "w2" } as never],
                absorbed: 3,
            },
            [
                { id: "w1", name: "Lose", geometry: '{"type":"LineString","coordinates":[[9,5],[10.2,5]]}' },
                { id: "w2", name: "Schlinge", geometry: '{"type":"LineString","coordinates":[[1,1],[2,2],[1.1,1]]}' },
            ],
        );
        expect(result.ends).toEqual([{ x: 10.2, y: 5, path: "w1" }]);
        expect(result.paths.map((path) => path.id)).toEqual(["w1"]);
        expect(result).toMatchObject({ absorbed_ends: 3, looped_paths: 1 });
        expect(Value.Check(LooseEndsResult, result)).toBe(true);
    });

    it("Unverbunden: ohne Kante, nicht am Ende einer Kraftlinie, nicht verborgen; ein technischer Knoten ohne Namen", () => {
        const node = (id: string, kind: "place" | "technical", isHidden = false) => ({
            id,
            kind,
            name: kind === "place" ? `Ort ${id}` : "",
            isHidden,
            x: 1,
            y: 2,
        });
        const network = {
            nodes: new Map(
                [
                    node("a", "place"),
                    node("b", "place"),
                    node("allein", "place"),
                    node("verborgen", "place", true),
                    node("nodix", "place"),
                    node("k", "technical"),
                ].map((entry) => [entry.id, entry]),
            ),
            links: [{ from: "a", to: "b" }],
        } as unknown as RouteNetwork;
        const result = unconnectedFrom(network, new Set(["nodix"]));
        expect(result.nodes).toEqual([
            { id: "allein", kind: "place", name: "Ort allein", x: 1, y: 2 },
            { id: "k", kind: "technical", name: null, x: 1, y: 2 },
        ]);
        expect(Value.Check(UnconnectedResult, result)).toBe(true);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0131";
const ORT = {
    a: "31313131-0000-4000-8000-000000000001",
    b: "31313131-0000-4000-8000-000000000002",
    allein: "31313131-0000-4000-8000-000000000003",
    verborgen: "31313131-0000-4000-8000-000000000004",
    nodix: "31313131-0000-4000-8000-000000000005",
    nodixGegenueber: "31313131-0000-4000-8000-000000000006",
} as const;
const WEG = {
    verbunden: "31313131-0000-4000-8000-000000000101",
    lose: "31313131-0000-4000-8000-000000000102",
    schlinge: "31313131-0000-4000-8000-000000000103",
    griff: "31313131-0000-4000-8000-000000000104",
    fluss: "31313131-0000-4000-8000-000000000105",
    knapp: "31313131-0000-4000-8000-000000000106",
    quer: "31313131-0000-4000-8000-000000000107",
    treff: "31313131-0000-4000-8000-000000000108",
} as const;
const LINIE = "31313131-0000-4000-8000-000000000201";
/** „Flächen kreuzen sich“: Gebiete und Landschaften mit je einer Fläche. */
const FLAECHE = {
    acht: { gebiet: "31313131-0000-4000-8000-000000000301", flaeche: "31313131-0000-4000-8000-000000000311" },
    heil: { gebiet: "31313131-0000-4000-8000-000000000302", flaeche: "31313131-0000-4000-8000-000000000312" },
    still: { gebiet: "31313131-0000-4000-8000-000000000303", flaeche: "31313131-0000-4000-8000-000000000313" },
    spitze: { landschaft: "31313131-0000-4000-8000-000000000304", flaeche: "31313131-0000-4000-8000-000000000314" },
    zwei: { landschaft: "31313131-0000-4000-8000-000000000305", flaeche: "31313131-0000-4000-8000-000000000315" },
} as const;
/** Eine Acht: zwei Kanten kreuzen sich bei (945, 945). */
const ACHT = "POLYGON((940 940, 950 950, 950 940, 940 950, 940 940))";
/** Eine Fläche aus zwei Teilen, einer davon nur zwei Ecken (wie 81 Landschaftsflächen der Stage 2026-11-10). */
const ZWEI_ECKEN =
    "MULTIPOLYGON(((1000 940, 1010 940, 1010 950, 1000 950, 1000 940)), ((1012 940, 1013 941, 1013 941, 1012 940)))";
/** Ein Rand, der sich bei (965, 945) in einem Punkt berührt: zwei Dreiecke, Spitze an Spitze, in EINEM Ring. */
const SPITZE = "POLYGON((960 940, 970 940, 965 945, 970 950, 960 950, 965 945, 960 940))";
const QUADRAT = "POLYGON((980 940, 990 940, 990 950, 980 950, 980 940))";

describeWithDatabase("Prüfhaken gegen PostgreSQL (WI-0131)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    const cookies = new Map<Role, string>();

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    const get = (check: string, role?: Role, headers: Record<string, string> = {}) =>
        app.inject({
            method: "GET",
            url: `${MAP_CHECKS_URL}/${check}`,
            headers: { ...headers, ...(role === undefined ? {} : { cookie: cookies.get(role) ?? "" }) },
        });

    async function aufraeumen(): Promise<void> {
        const gebiete = [FLAECHE.acht.gebiet, FLAECHE.heil.gebiet, FLAECHE.still.gebiet];
        await database`DELETE FROM territory_area WHERE territory_id IN (SELECT id FROM territory WHERE public_id = ANY(${gebiete}::uuid[]))`;
        await database`DELETE FROM territory WHERE public_id = ANY(${gebiete}::uuid[])`;
        const landschaften = [FLAECHE.spitze.landschaft, FLAECHE.zwei.landschaft];
        await database`DELETE FROM region_area WHERE region_id IN (SELECT id FROM region WHERE public_id = ANY(${landschaften}::uuid[]))`;
        await database`DELETE FROM region WHERE public_id = ANY(${landschaften}::uuid[])`;
        await database`DELETE FROM wiki_key_assignment WHERE wiki_key LIKE 'wiki:wi0131-%'`;
        await database`DELETE FROM powerline WHERE public_id = ${LINIE}`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["tester", "reviewer"] as const) {
            const person = await fixture.person(role, { name: `Prüfhaken ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        // Weit draußen am Kartenrand, damit kein anderer Bestand in den Kasten der Endpunktsuche (±0,5) fällt.
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
            VALUES (${ORT.a}, 'aventuria', 'WI0131 A', 'stadt', ST_SetSRID(ST_MakePoint(1001, 1001), 0), ${SOURCE}, TRUE, FALSE),
                   (${ORT.b}, 'aventuria', 'WI0131 B', 'dorf', ST_SetSRID(ST_MakePoint(1002, 1001), 0), ${SOURCE}, TRUE, FALSE),
                   (${ORT.allein}, 'aventuria', 'WI0131 Allein', 'dorf', ST_SetSRID(ST_MakePoint(1010, 1010), 0), ${SOURCE}, TRUE, FALSE),
                   (${ORT.verborgen}, 'aventuria', 'WI0131 Verborgen', 'dorf', ST_SetSRID(ST_MakePoint(1012, 1012), 0), ${SOURCE}, TRUE, TRUE),
                   (${ORT.nodix}, 'aventuria', 'WI0131 Nodix', 'gebaeude', ST_SetSRID(ST_MakePoint(1014, 1014), 0), ${SOURCE}, TRUE, FALSE),
                   (${ORT.nodixGegenueber}, 'aventuria', 'WI0131 Nodix 2', 'gebaeude', ST_SetSRID(ST_MakePoint(1016, 1014), 0), ${SOURCE}, TRUE, FALSE)
        `;
        // Verbunden: A–B genau. Lose: von A bis 0,2 neben B (im Kasten, über 0,05). Schlinge: beide Enden an B. Griff: „Pfad-…“.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${WEG.verbunden}, 'aventuria', 'WI0131 Verbunden', 'Strasse', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1001, 1001), ST_MakePoint(1002, 1001)), 0), ${SOURCE}, TRUE),
                   (${WEG.lose}, 'aventuria', 'WI0131 Lose', 'Weg', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1001, 1001), ST_MakePoint(1002.2, 1001.1)), 0), ${SOURCE}, TRUE),
                   (${WEG.schlinge}, 'aventuria', 'WI0131 Schlinge', 'Weg', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ARRAY[ST_MakePoint(1002, 1001), ST_MakePoint(1002.1, 1001.3), ST_MakePoint(1002, 1001.02)]), 0), ${SOURCE}, TRUE),
                   (${WEG.griff}, 'aventuria', 'Pfad-913131', 'Pfad', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1001, 1001), ST_MakePoint(1001, 1000)), 0), ${SOURCE}, TRUE),
                   (${WEG.fluss}, 'aventuria', 'WI0131 Fluss', 'Flussweg', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1020, 1020), ST_MakePoint(1021, 1021)), 0), ${SOURCE}, TRUE),
                   (${WEG.quer}, 'aventuria', 'WI0132 Querweg', 'Strasse', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1006, 1004), ST_MakePoint(1006, 1006)), 0), ${SOURCE}, TRUE),
                   (${WEG.knapp}, 'aventuria', 'WI0132 Knapp', 'Weg', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1005, 1005), ST_MakePoint(1005.95, 1005)), 0), ${SOURCE}, TRUE),
                   -- Endet genau auf „Verbunden“, 0,3 neben B: hängt nach „Ort zuerst“ an B, ein Treffpunkt im Ortskasten.
                   (${WEG.treff}, 'aventuria', 'WI0132 Treff', 'Weg', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1002.3, 1003), ST_MakePoint(1001.7, 1001)), 0), ${SOURCE}, TRUE)
        `;
        await database`
            INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id,
                                   geom, drawn_geom, source_system, legacy_public_id)
            VALUES (${LINIE}, 'aventuria', 'WI0131 Linie', FALSE, ${ORT.nodix}, ${ORT.nodixGegenueber},
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1014, 1014), ST_MakePoint(1016, 1014)), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1014, 1014), ST_MakePoint(1016, 1014)), 0),
                    ${SOURCE}, ${LINIE})
        `;
        // „Flächen kreuzen sich“: eine Acht, ein heiles Quadrat, eine Acht an einem stillgelegten Gebiet, eine Landschaft mit Spitze.
        for (const [gebiet, name, aktiv] of [
            [FLAECHE.acht, "WI0131 Acht", true],
            [FLAECHE.heil, "WI0131 Heil", true],
            [FLAECHE.still, "WI0131 Still", false],
        ] as const) {
            await database`
                INSERT INTO territory (public_id, map_domain_id, name, color, opacity, is_active, source_system)
                VALUES (${gebiet.gebiet}::uuid, 'aventuria', ${name}, '#336699', 0.5, ${aktiv}, ${SOURCE})
            `;
            await database`
                INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system)
                SELECT ${gebiet.flaeche}::uuid, t.id, 'aventuria', ST_Multi(ST_GeomFromText(${gebiet === FLAECHE.heil ? QUADRAT : ACHT}, 0)), ${SOURCE}
                  FROM territory t WHERE t.public_id = ${gebiet.gebiet}::uuid
            `;
        }
        for (const [landschaft, name, wkt] of [
            [FLAECHE.spitze, "WI0131 Spitze", SPITZE],
            [FLAECHE.zwei, "WI0131 Zwei Ecken", ZWEI_ECKEN],
        ] as const) {
            await database`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active)
                VALUES (${landschaft.landschaft}::uuid, 'aventuria', ${name}, 'topographie', 'gebirge', TRUE)
            `;
            await database`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                SELECT ${landschaft.flaeche}::uuid, 'aventuria', r.id, ST_GeomFromText(${wkt}, 0), TRUE
                  FROM region r WHERE r.public_id = ${landschaft.landschaft}::uuid
            `;
        }
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key)
            VALUES ('siedlung', ${ORT.a}, 'wiki:wi0131-a'), ('weg', ${WEG.verbunden}, 'wiki:wi0131-verbunden')
        `;
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    it("🔴 ohne Anmeldung 401, als Tester 403, beides im Umschlag; eine unbekannte Prüfung 400", async () => {
        const anonym = await get("unconnected");
        expect(anonym.statusCode).toBe(401);
        expect(Value.Check(ApiErrorBody, anonym.json())).toBe(true);
        const tester = await get("unconnected", "tester");
        expect(tester.statusCode).toBe(403);
        expect(Value.Check(ApiErrorBody, tester.json())).toBe(true);
        expect((await get("kreuzungen", "reviewer")).statusCode).toBe(400);
    });

    it("Unverbunden: der Ort ohne Weg, nicht der verborgene, nicht die Nodices an der Kraftlinie, nicht die verbundenen", async () => {
        const antwort = await get("unconnected", "reviewer");
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("private, no-cache");
        const body = antwort.json<UnconnectedResult>();
        expect(Value.Check(MapCheckResult, body)).toBe(true);
        const ids = new Set(body.nodes.map((node) => node.id));
        expect(body.nodes.find((node) => node.id === ORT.allein)).toEqual({
            id: ORT.allein,
            kind: "place",
            name: "WI0131 Allein",
            x: 1010,
            y: 1010,
        });
        for (const id of [ORT.a, ORT.b, ORT.verborgen, ORT.nodix, ORT.nodixGegenueber])
            expect(ids.has(id), id).toBe(false);
    });

    it("Offene Wegenden: das lose Ende als Ring, der Weg ganz; Schlinge und Treffpunkt im Ortskasten nur als Zahl (B)", async () => {
        const antwort = await get("loose-ends", "reviewer", { "accept-encoding": "gzip" });
        expect(antwort.statusCode).toBe(200);
        // Packen tut Nginx (Block E): die Route antwortet ungepackt, auch auf Wunsch.
        expect(antwort.headers["content-encoding"]).toBeUndefined();
        const body = antwort.json() as LooseEndsResult;
        expect(Value.Check(MapCheckResult, body)).toBe(true);
        expect(body.ends.filter((end) => end.path === WEG.lose)).toEqual([{ x: 1002.2, y: 1001.1, path: WEG.lose }]);
        const lose = body.paths.find((path) => path.id === WEG.lose);
        expect(lose?.lines).toEqual([
            [
                [1001, 1001],
                [1002.2, 1001.1],
            ],
        ]);
        expect(body.paths.some((path) => path.id === WEG.verbunden)).toBe(false);
        // Entscheidung B (Koordination 2026-10-10, WI-0132 §10.6): keine Ringe, nur Zahlen.
        for (const id of [WEG.schlinge, WEG.treff]) {
            expect(
                body.ends.some((end) => end.path === id),
                id,
            ).toBe(false);
            expect(
                body.paths.some((path) => path.id === id),
                id,
            ).toBe(false);
        }
        expect(body.looped_paths, "die Schlinge").toBeGreaterThanOrEqual(1);
        expect(body.absorbed_ends, "der Treffpunkt am Ort B").toBeGreaterThanOrEqual(1);
    });

    /**
     * 🪤 **Die Lücke des Prüffalls ist 0,05, nicht mehr 0,0004** (WI-0147): Mit `END_SNAP` = 0,02 ist ein Ende, das 0,0004
     * neben einem fremden Weg endet, längst verbunden und gar keine Stelle mehr. Übrig bleibt für den Haken, was der
     * Fangradius NICHT fängt — und das ist dann auch kein Rundungsfall (`near_miss` falsch).
     */
    it("🔴 Wege treffen sich nicht (WI-0132 P2): das verfehlte Ende mit Abstand; repariert verschwindet es", async () => {
        const vorher = (await get("paths-apart", "reviewer")).json<PathsApartResult>();
        expect(Value.Check(MapCheckResult, vorher)).toBe(true);
        expect(vorher.spots.filter((spot) => spot.path === WEG.knapp)).toEqual([
            { kind: "offen", x: 1005, y: 1005, path: WEG.knapp, other: null, distance: null, near_miss: false },
            {
                kind: "offen",
                x: 1005.95,
                y: 1005,
                path: WEG.knapp,
                other: WEG.quer,
                distance: 0.05,
                near_miss: false,
            },
        ]);
        // Die Redaktion zieht das Ende genau auf den Querweg: ein T-Stoß, die Stelle verschwindet. Der Haken verbindet nie selbst.
        await database`
            UPDATE path SET geom = ST_SetSRID(ST_MakeLine(ST_MakePoint(1005, 1005), ST_MakePoint(1006, 1005)), 0)
            WHERE public_id = ${WEG.knapp}
        `;
        try {
            const nachher = (await get("paths-apart", "reviewer")).json<PathsApartResult>();
            expect(nachher.spots.filter((spot) => spot.path === WEG.knapp).map((spot) => [spot.x, spot.y])).toEqual([
                [1005, 1005],
            ]);
            expect(
                nachher.spots.some((spot) => spot.other === WEG.knapp),
                "auch vom Querweg aus nichts",
            ).toBe(false);
        } finally {
            await database`
                UPDATE path SET geom = ST_SetSRID(ST_MakeLine(ST_MakePoint(1005, 1005), ST_MakePoint(1005.95, 1005)), 0)
                WHERE public_id = ${WEG.knapp}
            `;
        }
    });

    it("Keine Wiki-Zuweisung: nach X2, Orte ohne Key, benannte Wege ohne Key; ein Griff ist nicht gemeint", async () => {
        const body = (await get("no-wiki", "reviewer")).json<NoWikiResult>();
        expect(Value.Check(MapCheckResult, body)).toBe(true);
        expect(body.places).not.toContain(ORT.a);
        expect(body.places).toEqual(expect.arrayContaining([ORT.b, ORT.allein, ORT.verborgen]));
        expect(body.paths).not.toContain(WEG.verbunden);
        expect(body.paths).not.toContain(WEG.griff);
        expect(body.paths).toEqual(expect.arrayContaining([WEG.lose, WEG.schlinge]));
    });

    it("🔴 Flächen kreuzen sich: dieselbe Prüfung wie beim Speichern, mit Stelle und Namen; heil und stillgelegt fehlen", async () => {
        const antwort = await get("invalid-areas", "reviewer");
        expect(antwort.statusCode).toBe(200);
        const body = antwort.json<InvalidAreasResult>();
        expect(Value.Check(MapCheckResult, body)).toBe(true);
        const meine = body.spots.filter((spot) =>
            [
                FLAECHE.acht.flaeche,
                FLAECHE.heil.flaeche,
                FLAECHE.still.flaeche,
                FLAECHE.spitze.flaeche,
                FLAECHE.zwei.flaeche,
            ].includes(spot.area as never),
        );
        expect(meine).toEqual([
            {
                kind: "territory",
                area: FLAECHE.acht.flaeche,
                owner: FLAECHE.acht.gebiet,
                name: "WI0131 Acht",
                art: "schneidet_sich",
                x: 945,
                y: 945,
            },
            {
                kind: "landscape",
                area: FLAECHE.spitze.flaeche,
                owner: FLAECHE.spitze.landschaft,
                name: "WI0131 Spitze",
                art: "beruehrt_sich",
                x: 965,
                y: 945,
            },
            {
                kind: "landscape",
                area: FLAECHE.zwei.flaeche,
                owner: FLAECHE.zwei.landschaft,
                name: "WI0131 Zwei Ecken",
                art: "zu_wenig_ecken",
                x: 1012,
                y: 940,
            },
        ]);
        // Die Gebiete stehen vor den Landschaften, damit die Reihenfolge beim Durchsehen fest ist.
        const arten = body.spots.map((spot) => spot.kind);
        expect(arten.indexOf("landscape") === -1 || arten.lastIndexOf("territory") < arten.indexOf("landscape")).toBe(
            true,
        );
        expect((await get("invalid-areas", "tester")).statusCode).toBe(403);
    });

    it("🔴 Flüsse bergaufwärts: die interne Kennung eines alten Berichts wird zur öffentlichen, nichts Internes geht hinaus", async () => {
        const [row] = await database<{ id: string }[]>`SELECT id::text FROM path WHERE public_id = ${WEG.fluss}`;
        const beide = await loadRiverLines(database, "aventuria", [
            { ref: row!.id, rise: 12.5 },
            { ref: WEG.fluss, rise: 12.5 },
            { ref: "0", rise: 3 },
        ]);
        expect(beide).toEqual([
            {
                id: WEG.fluss,
                name: "WI0131 Fluss",
                rise: 12.5,
                lines: [
                    [
                        [1020, 1020],
                        [1021, 1021],
                    ],
                ],
            },
        ]);
        const antwort = await get("uphill-rivers", "reviewer");
        expect(antwort.statusCode).toBe(200);
        expect(Value.Check(MapCheckResult, antwort.json())).toBe(true);
    });

    it("ETag: ein unveränderter Stand kommt als 304 ohne Körper, eine Änderung gibt einen neuen ETag", async () => {
        const erste = await get("unconnected", "reviewer");
        const etag = String(erste.headers["etag"]);
        expect(etag).toMatch(/^W\/"/);
        const wieder = await get("unconnected", "reviewer", { "if-none-match": etag });
        expect(wieder.statusCode).toBe(304);
        expect(wieder.body).toBe("");
        await database`UPDATE place SET is_hidden = TRUE WHERE public_id = ${ORT.allein}`;
        try {
            const geaendert = await get("unconnected", "reviewer", { "if-none-match": etag });
            expect(geaendert.statusCode).toBe(200);
            expect(geaendert.json<UnconnectedResult>().nodes.some((node) => node.id === ORT.allein)).toBe(false);
        } finally {
            await database`UPDATE place SET is_hidden = FALSE WHERE public_id = ${ORT.allein}`;
        }
    });
});
