import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ApiErrorBody,
    EDITOR_LANDSCAPES_URL,
    EditorLandscapeDetail,
    EditorLandscapeList,
    EditorLandscapeTargets,
    type EditorLandscapeRow,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";

/**
 * Der Lesepfad des Landschaftseditors (WI-0178 Paket A1, EDIT-0004 §5, §7) gegen echtes PostgreSQL (`avesmaps3d_test`, nie die
 * geteilte Testwelt).
 *
 * Problemfälle: ein Besucher oder Tester liest die Liste; der Kreis verwechselt die Hälften (Wiki links, Karte rechts) oder kennt nur
 * drei Zustände; Klimazonen stehen darin, eine ganz gelöschte fehlt statt unter „Gelöscht“ (T54); eine Landschaft ohne Fläche fehlt; ein unveränderter
 * Stand wird jedes Mal neu übertragen; das Detail liefert gerundete statt eckiger Flächen oder schließt den Ring doppelt.
 * Soll: ab Reviewer, 401/403 vor jeder Abfrage, ● ◐ ◑ ○ je Beispiel, `ETag` mit 304 und neuem Wert nach einer Änderung, gemeinsame
 * Ecken mit der Nachbarin derselben Ebene.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const L = {
    becken: "a1a1a1a1-0000-4000-8000-000000000001",
    vorgebirge: "a1a1a1a1-0000-4000-8000-000000000002",
    nurWiki: "a1a1a1a1-0000-4000-8000-000000000003",
    nichts: "a1a1a1a1-0000-4000-8000-000000000004",
    klima: "a1a1a1a1-0000-4000-8000-000000000005",
    weg: "a1a1a1a1-0000-4000-8000-000000000006",
    fern: "a1a1a1a1-0000-4000-8000-000000000007",
} as const;
const FLAECHE = {
    becken: "a1a1a1a1-0000-4000-8000-0000000000a1",
    vorgebirge: "a1a1a1a1-0000-4000-8000-0000000000a2",
    klima: "a1a1a1a1-0000-4000-8000-0000000000a5",
    fern: "a1a1a1a1-0000-4000-8000-0000000000a7",
} as const;
const FLUSS = "a1a1a1a1-0000-4000-8000-0000000000c1";
const LABEL = "a1a1a1a1-0000-4000-8000-0000000000b1";
const SOURCE = "test-wi0178-a1";
const WIKI_KEY = "wi0178-a1-becken";
const WIKI_URL = "https://de.wiki-aventurica.de/wiki/A1_Probe_Becken";

describeWithDatabase("Lesepfad des Landschaftseditors (WI-0178 A1)", { timeout: 120_000 }, () => {
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
        const regionen = database`SELECT id FROM region WHERE source_system = ${SOURCE}`;
        await database`UPDATE region SET primary_label_id = NULL WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM map_label WHERE region_id IN (${regionen})`;
        await database`DELETE FROM region_area WHERE region_id IN (${regionen})`;
        await database`DELETE FROM region WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM wiki_region_snapshot WHERE wiki_key = ${WIKI_KEY}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["tester", "reviewer", "editor", "admin"] as const) {
            const person = await fixture.person(role, { name: `Landschaftsliste ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        // Vier Landschaften, je ein Beispiel der vier Zustände; dazu eine Klimazone, die fehlen muss, und eine ganz gelöschte (T54).
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_locked, wiki_url, wiki_region_key, label_curve_enabled, label_curve_max, is_active, source_system)
            VALUES (${L.becken}, 'aventuria', 'A1 Probe Becken', 'topographie', 'tal', 740, FALSE, ${WIKI_URL}, ${WIKI_KEY}, FALSE, NULL, TRUE, ${SOURCE}),
                   (${L.vorgebirge}, 'aventuria', 'A1 Probe Vorgebirge', 'topographie', 'huegelland', 280, FALSE, NULL, NULL, TRUE, 2, TRUE, ${SOURCE}),
                   (${L.nurWiki}, 'aventuria', 'A1 Probe Nur Wiki', 'vegetation', 'wald', 10, TRUE, 'https://de.wiki-aventurica.de/wiki/A1_Nur_Wiki', NULL, NULL, NULL, TRUE, ${SOURCE}),
                   (${L.nichts}, 'aventuria', 'A1 Probe Nichts', 'derographisch', NULL, 0, FALSE, NULL, NULL, NULL, NULL, TRUE, ${SOURCE}),
                   (${L.klima}, 'aventuria', 'A1 Probe Klima', 'klima', NULL, 0, FALSE, NULL, NULL, NULL, NULL, TRUE, ${SOURCE}),
                   (${L.weg}, 'aventuria', 'A1 Probe Weg', 'topographie', NULL, 0, FALSE, NULL, NULL, NULL, NULL, FALSE, ${SOURCE})
        `;
        await database`
            INSERT INTO wiki_region_snapshot (wiki_key, wiki_url, name, synced_at) VALUES (${WIKI_KEY}, ${WIKI_URL}, 'Probe-Becken (Artikel)', now())
        `;
        // Becken und Vorgebirge teilen die Kante x = 410 mit zwei koordinatengleichen Ecken.
        await database`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${FLAECHE.becken}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((400 400, 410 400, 410 410, 400 410, 400 400))', 0), ${SOURCE} FROM region WHERE public_id = ${L.becken}
            UNION ALL
            SELECT ${FLAECHE.vorgebirge}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((410 400, 420 400, 420 410, 410 410, 410 400))', 0), ${SOURCE} FROM region WHERE public_id = ${L.vorgebirge}
            UNION ALL
            SELECT ${FLAECHE.klima}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((400 400, 420 400, 420 420, 400 400))', 0), ${SOURCE} FROM region WHERE public_id = ${L.klima}
        `;
        const [label] = await database<{ id: string }[]>`
            INSERT INTO map_label (public_id, map_domain_id, region_id, name, geom, label_min_zoom, label_max_zoom, label_size, label_priority, show_name, source_system)
            SELECT ${LABEL}::uuid, 'aventuria', id, 'A1 Probe Becken', ST_SetSRID(ST_MakePoint(405, 405), 0), 2, 8, 18, 3, TRUE, ${SOURCE} FROM region WHERE public_id = ${L.becken}
            RETURNING id::text
        `;
        await database`UPDATE region SET primary_label_id = ${label!.id} WHERE public_id = ${L.becken}`;
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

    const zeile = (list: EditorLandscapeList, id: string): EditorLandscapeRow | undefined =>
        list.rows.find((row) => row.id === id);

    it("🔴 Besucher 401, Tester 403; Reviewer und Editor lesen, privat und jedes Mal neu geprüft", async () => {
        const anonymous = await get(EDITOR_LANDSCAPES_URL);
        expect([anonymous.statusCode, anonymous.json().error.code]).toEqual([401, "unauthenticated"]);
        expect(Value.Check(ApiErrorBody, anonymous.json())).toBe(true);
        const tester = await get(EDITOR_LANDSCAPES_URL, "tester");
        expect([tester.statusCode, tester.json().error.code]).toEqual([403, "forbidden"]);
        const detailTester = await get(`${EDITOR_LANDSCAPES_URL}/${L.becken}`, "tester");
        expect(detailTester.statusCode).toBe(403);
        for (const role of ["reviewer", "editor"] as const) {
            const allowed = await get(EDITOR_LANDSCAPES_URL, role);
            expect([role, allowed.statusCode]).toEqual([role, 200]);
            expect(allowed.headers["cache-control"]).toBe("private, no-cache");
            expect(String(allowed.headers["etag"])).toMatch(/^W\/"/);
            expect(Value.Check(EditorLandscapeList, allowed.json())).toBe(true);
        }
    });

    it("🔴 der Kreis in vier Zuständen, links Wiki, rechts Karte; die Klimazone fehlt, die ganz gelöschte steht als gelöscht", async () => {
        const list = (await get(EDITOR_LANDSCAPES_URL, "editor")).json() as EditorLandscapeList;
        // Knapp: Was falsch, null oder 0 ist, fehlt in der Zeile.
        expect(zeile(list, L.becken)).toEqual({
            id: L.becken,
            name: "A1 Probe Becken",
            layer: "topographie",
            type: "tal",
            circle: "voll",
            wiki: { url: WIKI_URL, title: "Probe-Becken (Artikel)" },
            areas: 1,
            labels: 1,
            order: 740,
            bounds: [400, 400, 410, 410],
            source: SOURCE,
        });
        expect(zeile(list, L.vorgebirge)).toMatchObject({ circle: "halb-rechts", areas: 1, curve: true });
        expect(zeile(list, L.vorgebirge)).not.toHaveProperty("wiki");
        expect(zeile(list, L.vorgebirge)).not.toHaveProperty("labels");
        expect(zeile(list, L.nurWiki)).toMatchObject({
            circle: "halb",
            clickLocked: true,
            layer: "vegetation",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/A1_Nur_Wiki" },
        });
        expect(zeile(list, L.nurWiki)).not.toHaveProperty("areas");
        expect(zeile(list, L.nurWiki)).not.toHaveProperty("bounds");
        expect(zeile(list, L.nichts)).toEqual({
            id: L.nichts,
            name: "A1 Probe Nichts",
            layer: "derographisch",
            circle: "leer",
            order: 0,
            source: SOURCE,
        });
        expect(zeile(list, L.klima)).toBeUndefined();
        // Die ganz gelöschte steht unter „Gelöscht“ (D2, EDIT-0003 T54); die Liste zählt sie nicht in der Legende.
        expect(zeile(list, L.weg)).toMatchObject({ state: "retired" });
    });

    it("🔴 ETag: unverändert 304 ohne Körper, nach einer Änderung neu; ungepackt auch auf Wunsch (packen tut Nginx)", async () => {
        const erste = await get(EDITOR_LANDSCAPES_URL, "editor");
        const etag = String(erste.headers["etag"]);
        const wieder = await get(EDITOR_LANDSCAPES_URL, "editor", { "if-none-match": etag });
        expect([wieder.statusCode, wieder.body]).toEqual([304, ""]);
        const roh = await get(EDITOR_LANDSCAPES_URL, "editor", { "accept-encoding": "gzip" });
        expect(roh.headers["content-encoding"]).toBeUndefined();
        expect(Value.Check(EditorLandscapeList, roh.json())).toBe(true);
        await database`UPDATE region SET name = 'A1 Probe Nichts (umbenannt)' WHERE public_id = ${L.nichts}`;
        try {
            const danach = await get(EDITOR_LANDSCAPES_URL, "editor", { "if-none-match": etag });
            expect(danach.statusCode).toBe(200);
            expect(String(danach.headers["etag"])).not.toBe(etag);
            expect(zeile(danach.json() as EditorLandscapeList, L.nichts)?.name).toBe("A1 Probe Nichts (umbenannt)");
        } finally {
            await database`UPDATE region SET name = 'A1 Probe Nichts' WHERE public_id = ${L.nichts}`;
        }
    });

    it("🔴 Detail: Flächen eckig ohne doppelten Schlusspunkt, Beschriftung mit ihren Werten, Nachbarin mit zwei gemeinsamen Ecken", async () => {
        const antwort = await get(`${EDITOR_LANDSCAPES_URL}/${L.becken}`, "reviewer");
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("private, no-cache");
        const detail = antwort.json() as EditorLandscapeDetail;
        expect(Value.Check(EditorLandscapeDetail, detail)).toBe(true);
        // Die Revisionen (Migration 0137, B1) sind die der Zeilen: die Basis jeder Änderung.
        const [stand] = await database<{ region: number; area: number; label: number }[]>`
            SELECT (SELECT revision FROM region WHERE public_id = ${L.becken})::int AS region,
                   (SELECT revision FROM region_area WHERE public_id = ${FLAECHE.becken})::int AS area,
                   (SELECT revision FROM map_label WHERE public_id = ${LABEL})::int AS label
        `;
        expect(stand!.region, "der Zeiger auf die Beschriftung hat die Region einmal gezählt").toBeGreaterThan(1);
        expect(detail).toEqual({
            id: L.becken,
            name: "A1 Probe Becken",
            layer: "topographie",
            type: "tal",
            circle: "voll",
            wiki: { url: WIKI_URL, title: "Probe-Becken (Artikel)", key: WIKI_KEY },
            order: 740,
            // Platz 1 von 2 in der Topographie (D1): der höchste Rang liegt vorn.
            place: { n: 1, of: 2 },
            clickLocked: false,
            curve: { enabled: false },
            areas: [
                {
                    id: FLAECHE.becken,
                    polygons: [
                        [
                            [
                                [400, 400],
                                [410, 400],
                                [410, 410],
                                [400, 410],
                            ],
                        ],
                    ],
                    affectsPaths: true,
                    revision: stand!.area,
                },
            ],
            labels: [
                {
                    id: LABEL,
                    text: "A1 Probe Becken",
                    x: 405,
                    y: 405,
                    size: 18,
                    priority: 3,
                    zoomMin: 2,
                    zoomMax: 8,
                    visible: true,
                    primary: true,
                    revision: stand!.label,
                },
            ],
            neighbors: [{ id: L.vorgebirge, name: "A1 Probe Vorgebirge", sharedCorners: 2 }],
            source: SOURCE,
            revision: stand!.region,
        });
        const vorgebirge = (
            await get(`${EDITOR_LANDSCAPES_URL}/${L.vorgebirge}`, "editor")
        ).json() as EditorLandscapeDetail;
        expect(vorgebirge).toMatchObject({
            circle: "halb-rechts",
            curve: { enabled: true, max: 2 },
            labels: [],
            neighbors: [{ id: L.becken, sharedCorners: 2 }],
        });
        // Ohne Fläche: keine Teilflächen, keine Nachbarn; „Nicht auf der Karte“ ist ein gültiges Detail.
        const nurWiki = (await get(`${EDITOR_LANDSCAPES_URL}/${L.nurWiki}`, "editor")).json() as EditorLandscapeDetail;
        expect(nurWiki).toMatchObject({ circle: "halb", areas: [], neighbors: [], clickLocked: true });
    });

    it("🔴 Detail: Klimazone und unbekannte Landschaft sind 404, die ganz gelöschte liest sich (T54); eine Nicht-Kennung ist 400", async () => {
        const geloescht = await get(`${EDITOR_LANDSCAPES_URL}/${L.weg}`, "editor");
        expect([geloescht.statusCode, geloescht.json().state]).toEqual([200, "retired"]);
        for (const id of [L.klima, "a1a1a1a1-0000-4000-8000-00000000ffff"]) {
            const antwort = await get(`${EDITOR_LANDSCAPES_URL}/${id}`, "editor");
            expect([id, antwort.statusCode, antwort.json().error.code]).toEqual([id, 404, "not_found"]);
        }
        expect((await get(`${EDITOR_LANDSCAPES_URL}/kein-uuid`, "editor")).statusCode).toBe(400);
    });

    it("🔴 Andockziele (C1): Nachbarin derselben Ebene ganz mit Revision, Kanten ohne eigene und Nachbarn; Recht edit_map_geometry", async () => {
        const url = `${EDITOR_LANDSCAPES_URL}/${L.becken}/targets`;
        // Ein Reviewer liest, darf aber keine Geometrie bearbeiten: 403 vor jeder Abfrage.
        expect((await get(url, "reviewer")).statusCode).toBe(403);
        // Ein Editor ebenso: Die Form kommt ab Admin oder mit der Sonderrolle (WI-0279, Paket 6).
        expect((await get(url, "editor")).statusCode).toBe(403);
        const antwort = await get(url, "admin");
        expect(antwort.statusCode).toBe(200);
        const ziele = antwort.json() as EditorLandscapeTargets;
        expect(Value.Check(EditorLandscapeTargets, ziele)).toBe(true);
        const [stand] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM region_area WHERE public_id = ${FLAECHE.vorgebirge}
        `;
        expect(ziele.neighbors).toEqual([
            {
                id: FLAECHE.vorgebirge,
                regionId: L.vorgebirge,
                name: "A1 Probe Vorgebirge",
                revision: stand!.revision,
                polygons: [
                    [
                        [
                            [410, 400],
                            [420, 400],
                            [420, 410],
                            [410, 410],
                        ],
                    ],
                ],
            },
        ]);
        // Die eigene Fläche und die Nachbarin stehen nicht unter den Kanten; die Klimazone nie.
        const fremde = new Set(ziele.edges.map((kante) => kante.areaId));
        for (const id of [FLAECHE.becken, FLAECHE.vorgebirge, FLAECHE.klima]) expect(fremde.has(id)).toBe(false);
        expect(ziele.margin).toBe(15);
        // WI-0298 Stufe 5: Kanten und Flusspunkte baut PostgreSQL als JSON-Text. Eine fremde Fläche und ein Fluss im Kasten, mit
        // Bruchzahlen: Form, Zahlen und Reihenfolge (Ring der Fläche, Stützpunkte des Wegs) wie vorher als Zeilen; 430/430 liegt draußen.
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_active, source_system)
            VALUES (${L.fern}, 'aventuria', 'A1 Probe Fern', 'topographie', 'huegelland', 5, TRUE, ${SOURCE})
        `;
        await database`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${FLAECHE.fern}::uuid, id, 'aventuria', ST_GeomFromText('POLYGON((402.5 412, 405.25 412, 404 415.125, 402.5 412))', 0), ${SOURCE}
              FROM region WHERE public_id = ${L.fern}
        `;
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${FLUSS}::uuid, 'aventuria', 'A1 Probe Fluss', 'Flussweg', FALSE, FALSE,
                    ST_GeomFromText('LINESTRING(390 390, 395.5 391.25, 430 430)', 0), ${SOURCE}, TRUE)
        `;
        const mitFern = (await get(url, "admin")).json() as EditorLandscapeTargets;
        expect(Value.Check(EditorLandscapeTargets, mitFern)).toBe(true);
        const fern = { areaId: FLAECHE.fern, name: "A1 Probe Fern" };
        expect(mitFern.edges.filter((kante) => kante.areaId === FLAECHE.fern)).toEqual([
            { ...fern, a: [402.5, 412], b: [405.25, 412] },
            { ...fern, a: [405.25, 412], b: [404, 415.125] },
            { ...fern, a: [404, 415.125], b: [402.5, 412] },
        ]);
        expect(mitFern.riverPoints.filter((punkt) => punkt.pathId === FLUSS)).toEqual([
            { pathId: FLUSS, name: "A1 Probe Fluss", x: 390, y: 390 },
            { pathId: FLUSS, name: "A1 Probe Fluss", x: 395.5, y: 391.25 },
        ]);
        // Nur sichtbare Ebenen; eine unbekannte Ebene ist 400.
        expect((await get(`${url}?layers=vegetation`, "admin")).statusCode).toBe(200);
        expect((await get(`${url}?layers=klima`, "admin")).statusCode).toBe(400);
        // Ohne Fläche: nichts anzudocken.
        const ohne = (
            await get(`${EDITOR_LANDSCAPES_URL}/${L.nurWiki}/targets`, "admin")
        ).json() as EditorLandscapeTargets;
        expect(ohne).toEqual({ margin: 15, neighbors: [], edges: [], riverPoints: [] });
    });
});
