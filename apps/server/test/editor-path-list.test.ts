import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_PATHS_URL,
    EditorPathList,
    EditorPathStreet,
    editorPathStreetUrl,
    type EditorPathRow,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";

/**
 * Der Lesepfad des Wege-Fensters (WI-0177 Stufe 2, W5a) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle: ein Tester liest die Liste; eine Straße zerfällt in ihre Abschnitte; gleicher Name, andere Art zerfällt in zwei Wege
 * (seit Schritt 2 ist ein Weg sein Name, Legacys Regel (c)); namenlose Abschnitte oder gleiche Griffe fassen sich zusammen; ein stillgelegter Abschnitt oder ein Seeweg steht in der Liste; der Kreis ist voll, obwohl nur ein
 * Teil den Artikel trägt; „Name auf der Karte“ sagt ja, obwohl ein Abschnitt nein sagt; die Straße zu einem beliebigen Abschnitt ist eine
 * andere als die Zeile der Liste; ein unveränderter Stand wird jedes Mal neu übertragen.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0177-w5a";
const P = "c5c5c5c5-0000-4000-8000-";
const A = {
    strasse1: `${P}0000000000a1`,
    strasse2: `${P}0000000000a2`,
    strasseAlt: `${P}0000000000a3`,
    genommen: `${P}0000000000a4`,
    andereArt: `${P}0000000000b1`,
    pfad: `${P}0000000000c1`,
    leer1: `${P}0000000000d1`,
    leer2: `${P}0000000000d2`,
    see: `${P}0000000000e1`,
    griff1: `${P}0000000000f5`,
    griff2: `${P}0000000000f6`,
} as const;

describeWithDatabase("Lesepfad des Wege-Fensters (WI-0177 W5a)", { timeout: 120_000 }, () => {
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

    const get = (url: string, role?: Role, headers: Record<string, string> = {}) =>
        app.inject({
            method: "GET",
            url,
            headers: { ...headers, ...(role === undefined ? {} : { cookie: cookies.get(role) ?? "" }) },
        });

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM path_wiki_assignment WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
    }

    const liste = async (): Promise<EditorPathRow[]> => {
        const res = await get(EDITOR_PATHS_URL, "reviewer");
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as unknown;
        expect(Value.Check(EditorPathList, body)).toBe(true);
        return (body as EditorPathList).rows.filter((r) => r.id.startsWith(P));
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["tester", "reviewer"] as const) {
            const person = await fixture.person(role, { name: `Wegeliste ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        const weg = (
            id: string,
            name: string,
            subtype: string,
            sichtbar: boolean,
            aktiv = true,
            abgenommen = false,
        ) => database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active, off_map)
            VALUES (${id}, 'aventuria', ${name}, ${subtype}, ${sichtbar}, FALSE,
                    ST_GeomFromText('LINESTRING(100 500, 150 520, 300 500)', 0), ${SOURCE}, ${aktiv}, ${abgenommen})
        `;
        await weg(A.strasse1, "W5 Reichsstraße", "Reichsstrasse", true);
        await weg(A.strasse2, "W5 Reichsstraße", "Reichsstrasse", false);
        await weg(A.strasseAlt, "W5 Reichsstraße", "Reichsstrasse", true, false);
        // Ein Abschnitt derselben Straße, von der Karte genommen (Stufe 3b: still mit `off_map`).
        await weg(A.genommen, "W5 Reichsstraße", "Reichsstrasse", true, false, true);
        await weg(A.andereArt, "W5 Reichsstraße", "Strasse", true);
        await weg(A.pfad, "W5 Pfad", "Pfad", true);
        await weg(A.leer1, "", "Weg", false);
        await weg(A.leer2, "", "Weg", false);
        await weg(A.see, "W5 Meer", "Seeweg", true);
        // Zwei Abschnitte mit demselben Griff: kein echter Name, also je ein Weg für sich (Regel (c)).
        await weg(A.griff1, "Strasse-905", "Strasse", true);
        await weg(A.griff2, "Strasse-905", "Strasse", true);
        // Der Pfad trägt den Artikel ganz, die Reichsstraße nur an einem ihrer zwei Abschnitte.
        await database`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, assignment_state)
            SELECT id, 'main', 'https://de.wiki-aventurica.de/wiki/W5_Probe', 'address_only' FROM path
             WHERE public_id = ANY(${[A.pfad, A.strasse1]}::uuid[])
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

    it("ohne Anmeldung 401, als Tester 403, ab Reviewer lesbar", async () => {
        expect((await get(EDITOR_PATHS_URL)).statusCode).toBe(401);
        expect((await get(EDITOR_PATHS_URL, "tester")).statusCode).toBe(403);
        expect((await get(editorPathStreetUrl(A.pfad), "tester")).statusCode).toBe(403);
        expect((await get(EDITOR_PATHS_URL, "reviewer")).statusCode).toBe(200);
    });

    it("🔴 eine Zeile je Weg (sein Name, über Wegtypen hinweg), namenlose und Griffe je für sich; ohne Seewege; Genommene und Gelöschte (T54) für sich; der Kreis je Abschnitt", async () => {
        const rows = await liste();
        expect(
            rows.map((r) => [r.id, r.name, r.subtype, r.segments, r.circle, r.wikiSegments, r.offMap, r.deleted]),
        ).toEqual([
            [A.leer1, "", "Weg", 1, "halb-rechts", undefined, undefined, undefined],
            [A.leer2, "", "Weg", 1, "halb-rechts", undefined, undefined, undefined],
            [A.griff1, "Strasse-905", "Strasse", 1, "halb-rechts", undefined, undefined, undefined],
            [A.griff2, "Strasse-905", "Strasse", 1, "halb-rechts", undefined, undefined, undefined],
            [A.pfad, "W5 Pfad", "Pfad", 1, "voll", undefined, undefined, undefined],
            // Reichsstraße und Straße gleichen Namens sind EIN Weg; der häufigste Wegtyp vorn, beide in `subtypes`.
            [A.strasse1, "W5 Reichsstraße", "Reichsstrasse", 3, "halb-rechts", 1, undefined, undefined],
            [A.strasseAlt, "W5 Reichsstraße", "Reichsstrasse", 1, "leer", undefined, undefined, true],
            [A.genommen, "W5 Reichsstraße", "Reichsstrasse", 1, "leer", undefined, true, undefined],
        ]);
        expect(rows.find((r) => r.id === A.strasse1)?.subtypes).toEqual(["Reichsstrasse", "Strasse"]);
        expect(rows.find((r) => r.id === A.pfad)?.wiki).toEqual({ url: "https://de.wiki-aventurica.de/wiki/W5_Probe" });
        expect(rows.find((r) => r.id === A.strasse1)?.bounds).toEqual([100, 500, 300, 520]);
        expect(rows.find((r) => r.id === A.strasse1)?.source).toBe(SOURCE);
    });

    it("🔴 die Straße zu JEDEM ihrer Abschnitte, mit ihren Abschnitten; „Name auf der Karte“ gemischt ist null", async () => {
        const res = await get(editorPathStreetUrl(A.strasse2), "reviewer");
        expect(res.statusCode).toBe(200);
        const strasse = JSON.parse(res.body) as EditorPathStreet;
        expect(Value.Check(EditorPathStreet, strasse)).toBe(true);
        expect(strasse).toMatchObject({
            id: A.strasse1,
            name: "W5 Reichsstraße",
            subtype: "Reichsstrasse",
            subtypes: ["Reichsstrasse", "Strasse"],
            labelVisible: null,
        });
        // Der Abschnitt der anderen Art gehört dazu (ein Weg ist sein Name) und nennt seinen Wegtyp.
        expect(
            strasse.segments.map((s) => [s.id, s.subtype, s.labelVisible, s.wiki, s.points, s.tunnel]).sort(),
        ).toEqual(
            [
                [A.strasse1, "Reichsstrasse", true, true, 3, undefined],
                [A.strasse2, "Reichsstrasse", false, false, 3, undefined],
                [A.andereArt, "Strasse", true, false, 3, undefined],
            ].sort(),
        );
        // Tunnel (Migration 0172) steht am Abschnitt, nur wo er gesetzt ist.
        try {
            await database`UPDATE path SET is_tunnel = TRUE WHERE public_id = ${A.strasse2}::uuid`;
            const mitTunnel = JSON.parse(
                (await get(editorPathStreetUrl(A.strasse1), "reviewer")).body,
            ) as EditorPathStreet;
            expect(mitTunnel.segments.filter((s) => s.tunnel === true).map((s) => s.id)).toEqual([A.strasse2]);
            expect(Value.Check(EditorPathStreet, mitTunnel)).toBe(true);
        } finally {
            await database`UPDATE path SET is_tunnel = FALSE WHERE public_id = ${A.strasse2}::uuid`;
        }
        const pfad = JSON.parse((await get(editorPathStreetUrl(A.pfad), "reviewer")).body) as EditorPathStreet;
        expect(pfad).toMatchObject({ labelVisible: true, circle: "voll", segments: [{ id: A.pfad }] });
        // Der gelöschte Abschnitt ist seine eigene Straße „gelöscht“ (T54): Sein Fenster liest nur, der Verlauf holt ihn zurück.
        const alt = JSON.parse((await get(editorPathStreetUrl(A.strasseAlt), "reviewer")).body) as EditorPathStreet;
        expect(alt).toMatchObject({
            id: A.strasseAlt,
            deleted: true,
            circle: "leer",
            segments: [{ id: A.strasseAlt }],
        });
        expect(alt).not.toHaveProperty("offMap");
        // Der genommene Abschnitt ist seine eigene Straße „nicht auf der Karte“; die Straße auf der Karte kennt ihn nicht.
        const genommen = JSON.parse((await get(editorPathStreetUrl(A.genommen), "reviewer")).body) as EditorPathStreet;
        expect(genommen).toMatchObject({
            id: A.genommen,
            offMap: true,
            circle: "leer",
            segments: [{ id: A.genommen }],
        });
        expect((await get(editorPathStreetUrl(A.see), "reviewer")).statusCode).toBe(404);
        // Ein Griff ist kein Name: Jeder Abschnitt ist seine eigene Straße.
        const griff = JSON.parse((await get(editorPathStreetUrl(A.griff2), "reviewer")).body) as EditorPathStreet;
        expect(griff).toMatchObject({ id: A.griff2, segments: [{ id: A.griff2 }] });
    });

    it("🔴 Reisemittel je Abschnitt (Vorschlag 3): Wegtyp, Bach und was gespeichert ist; ein Fenster mit falschem Monat oder Tag fällt weg", async () => {
        const sommer = { from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 };
        try {
            await database`
                UPDATE path SET allowed_transports = ARRAY['groupFoot', 'horseCarriage'], transport_domain = 'land',
                       transport_seasons = ${database.json({
                           horseCarriage: sommer,
                           caravan: { ...sommer, from_month: "namenlos" },
                           cart: { ...sommer, to_day: 31 },
                           wagon: null,
                       })}
                 WHERE public_id = ${A.strasse2}::uuid
            `;
            const strasse = JSON.parse(
                (await get(editorPathStreetUrl(A.strasse1), "reviewer")).body,
            ) as EditorPathStreet;
            expect(Value.Check(EditorPathStreet, strasse)).toBe(true);
            // Je Abschnitt (der Weg hat seit Schritt 2 auch den Abschnitt anderer Art).
            const je = (id: string) => strasse.segments.find((x) => x.id === id);
            expect([je(A.strasse1), je(A.strasse2)].map((x) => [x?.art, x?.bach, x?.reisen])).toEqual([
                ["Reichsstrasse", false, { liste: null, domaene: null, fenster: {} }],
                [
                    "Reichsstrasse",
                    false,
                    { liste: ["groupFoot", "horseCarriage"], domaene: "land", fenster: { horseCarriage: sommer } },
                ],
            ]);
        } finally {
            await database`
                UPDATE path SET allowed_transports = NULL, transport_domain = NULL, transport_seasons = NULL
                 WHERE public_id = ${A.strasse2}::uuid
            `;
        }
    });

    it("🔴 Karawanenroute (Migration 0174): EINE Zeile über ihre Wegtypen; derselbe Name ohne Kennzeichen gehört dazu, das Kennzeichen ist dann gemischt", async () => {
        const K = {
            a: `${P}0000000000f1`,
            b: `${P}0000000000f2`,
            c: `${P}0000000000f3`,
            ohne: `${P}0000000000f4`,
        } as const;
        const abschnitt = (id: string, subtype: string, mark: string | null) => database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active, mark)
            VALUES (${id}, 'aventuria', 'W5 Karawane', ${subtype}, TRUE, FALSE,
                    ST_GeomFromText('LINESTRING(400 500, 450 520, 600 500)', 0), ${SOURCE}, TRUE, ${mark})
        `;
        try {
            await abschnitt(K.a, "Pfad", "karawanenroute");
            await abschnitt(K.b, "Wuestenpfad", "karawanenroute");
            await abschnitt(K.c, "Pfad", "karawanenroute");
            await abschnitt(K.ohne, "Pfad", null);
            const rows = (await liste()).filter((r) => r.name === "W5 Karawane");
            // Der häufigste Wegtyp zuerst, der ganze Weg eine Zeile; das Kennzeichen tragen nicht alle, die Zeile nennt keins.
            expect(rows.map((r) => [r.id, r.subtype, r.mark, r.subtypes, r.segments])).toEqual([
                [K.a, "Pfad", undefined, ["Pfad", "Wuestenpfad"], 4],
            ]);
            const strasse = JSON.parse((await get(editorPathStreetUrl(K.b), "reviewer")).body) as EditorPathStreet;
            expect(Value.Check(EditorPathStreet, strasse)).toBe(true);
            expect(strasse).toMatchObject({ id: K.a, subtype: "Pfad", subtypes: ["Pfad", "Wuestenpfad"] });
            expect(strasse).not.toHaveProperty("mark");
            // Je Abschnitt sein Wegtyp und, wo gesetzt, sein Kennzeichen.
            expect(strasse.segments.map((s) => [s.id, s.subtype, s.mark]).sort()).toEqual([
                [K.a, "Pfad", "karawanenroute"],
                [K.b, "Wuestenpfad", "karawanenroute"],
                [K.c, "Pfad", "karawanenroute"],
                [K.ohne, "Pfad", undefined],
            ]);
            // Tragen alle das Kennzeichen, steht es an der Straße.
            await database`UPDATE path SET mark = 'karawanenroute' WHERE public_id = ${K.ohne}::uuid`;
            const ganz = JSON.parse((await get(editorPathStreetUrl(K.ohne), "reviewer")).body) as EditorPathStreet;
            expect(ganz).toMatchObject({ id: K.a, mark: "karawanenroute" });
            // Das Wiki-Feld (WI-0225) liest den Artikel mit Titel und Weg-Art; ohne Schnappschuss fehlt er.
            expect(strasse).not.toHaveProperty("artikel");
            const [schnappschuss] = await database<{ id: string }[]>`
                INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art)
                VALUES ('w5-karawane', 'https://de.wiki-aventurica.de/wiki/W5_Karawane', 'W5 Karawane', 'strasse', 'Karawanenroute')
                RETURNING id::text AS id
            `;
            await database`
                INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state)
                SELECT id, 'main', 'https://de.wiki-aventurica.de/wiki/W5_Karawane', ${schnappschuss!.id}::bigint, 'assigned'
                  FROM path WHERE public_id = ANY(${[K.a, K.b]}::uuid[])
            `;
            const mitArtikel = JSON.parse((await get(editorPathStreetUrl(K.c), "reviewer")).body) as EditorPathStreet;
            expect(Value.Check(EditorPathStreet, mitArtikel)).toBe(true);
            expect(mitArtikel.artikel).toEqual({
                key: "w5-karawane",
                url: "https://de.wiki-aventurica.de/wiki/W5_Karawane",
                name: "W5 Karawane",
                werte: { name: "W5 Karawane", subtype: "Karawanenroute", mark: "Karawanenroute" },
            });
        } finally {
            await database`DELETE FROM path_wiki_assignment WHERE path_id IN (SELECT id FROM path WHERE public_id = ANY(${Object.values(K)}::uuid[]))`;
            await database`DELETE FROM path WHERE public_id = ANY(${Object.values(K)}::uuid[])`;
            await database`DELETE FROM wiki_path_snapshot WHERE wiki_key = 'w5-karawane'`;
        }
    });

    it("🔴 weitere Straßennamen (WI-0302): je Abschnitt `weitere`; die Straße des Artikels nennt den geteilten Abschnitt mit Straße, Anker, Nummer, Von und Bis", async () => {
        // Der Sikramstieg aus drei Abschnitten, West nach Ost; der mittlere (Sibur → Radoleth) trägt den Goldfelser Stieg als weiteren Namen.
        const G = {
            s1: `${P}000000302a01`,
            s2: `${P}000000302a02`,
            s3: `${P}000000302a03`,
            g1: `${P}000000302b01`,
            sibur: `${P}000000302c01`,
            radoleth: `${P}000000302c02`,
        } as const;
        const raeume = async () => {
            await database`DELETE FROM path_wiki_assignment WHERE path_id IN (SELECT id FROM path WHERE public_id = ANY(${Object.values(G)}::uuid[]))`;
            await database`DELETE FROM path WHERE public_id = ANY(${Object.values(G)}::uuid[])`;
            await database`DELETE FROM place WHERE public_id = ANY(${[G.sibur, G.radoleth]}::uuid[])`;
            await database`DELETE FROM wiki_path_snapshot WHERE wiki_key LIKE 'w302-%'`;
        };
        const abschnitt = (id: string, name: string, linie: string) => database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${id}, 'aventuria', ${name}, 'Strasse', TRUE, FALSE, ST_GeomFromText(${linie}, 0), ${SOURCE}, TRUE)
        `;
        const artikel = async (key: string, name: string, rolle: "main" | "further", ids: string[]) => {
            await database`
                INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind)
                VALUES (${key}, ${`https://de.wiki-aventurica.de/wiki/${name.replaceAll(" ", "_")}`}, ${name}, 'strasse')
                ON CONFLICT (wiki_key) DO NOTHING
            `;
            await database`
                INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state)
                SELECT p.id, ${rolle}, s.wiki_url, s.id, 'assigned'
                  FROM path p, wiki_path_snapshot s WHERE p.public_id = ANY(${ids}::uuid[]) AND s.wiki_key = ${key}
            `;
        };
        try {
            await raeume();
            await abschnitt(G.s1, "W302 Sikramstieg", "LINESTRING(900 800, 910 800)");
            await abschnitt(G.s2, "W302 Sikramstieg", "LINESTRING(920 800, 910 800)");
            await abschnitt(G.s3, "W302 Sikramstieg", "LINESTRING(920 800, 930 800)");
            await abschnitt(G.g1, "W302 Goldfelser Stieg", "LINESTRING(920 800, 925 790)");
            await database`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${G.sibur}, 'aventuria', 'W302 Sibur', 'dorf', ST_SetSRID(ST_MakePoint(910, 800), 0), ${SOURCE}, TRUE),
                       (${G.radoleth}, 'aventuria', 'W302 Radoleth', 'dorf', ST_SetSRID(ST_MakePoint(920, 800), 0), ${SOURCE}, TRUE)
            `;
            await artikel("w302-sikram", "W302 Sikramstieg", "main", [G.s1, G.s2, G.s3]);
            await artikel("w302-gold", "W302 Goldfelser Stieg", "main", [G.g1]);
            await artikel("w302-gold", "W302 Goldfelser Stieg", "further", [G.s2]);

            const sikram = JSON.parse((await get(editorPathStreetUrl(G.s3), "reviewer")).body) as EditorPathStreet;
            expect(Value.Check(EditorPathStreet, sikram)).toBe(true);
            expect(sikram.segments.map((s) => [s.id, s.von, s.bis, s.weitere])).toEqual([
                [G.s1, undefined, "W302 Sibur", undefined],
                [
                    G.s2,
                    "W302 Sibur",
                    "W302 Radoleth",
                    [
                        {
                            key: "w302-gold",
                            name: "W302 Goldfelser Stieg",
                            url: "https://de.wiki-aventurica.de/wiki/W302_Goldfelser_Stieg",
                        },
                    ],
                ],
                [G.s3, "W302 Radoleth", undefined, undefined],
            ]);
            // Niemand trägt den Sikramstieg als weiteren Namen.
            expect(sikram).not.toHaveProperty("geteilt");

            const gold = JSON.parse((await get(editorPathStreetUrl(G.g1), "reviewer")).body) as EditorPathStreet;
            expect(Value.Check(EditorPathStreet, gold)).toBe(true);
            expect(gold.segments.map((s) => s.id)).toEqual([G.g1]);
            expect(gold.geteilt).toEqual([
                {
                    id: G.s2,
                    strasse: "W302 Sikramstieg",
                    strasseId: G.s1,
                    nummer: 2,
                    von: "W302 Sibur",
                    bis: "W302 Radoleth",
                    bounds: [910, 800, 920, 800],
                },
            ]);
        } finally {
            await raeume();
        }
    });

    it("ETag: ein unveränderter Stand kommt als 304; ungepackt auch auf Wunsch (packen tut Nginx, Block E)", async () => {
        const erste = await get(EDITOR_PATHS_URL, "reviewer", { "accept-encoding": "gzip" });
        expect(erste.headers["content-encoding"]).toBeUndefined();
        expect(Value.Check(EditorPathList, erste.json())).toBe(true);
        const etag = String(erste.headers["etag"]);
        expect((await get(EDITOR_PATHS_URL, "reviewer", { "if-none-match": etag })).statusCode).toBe(304);
    });
});
