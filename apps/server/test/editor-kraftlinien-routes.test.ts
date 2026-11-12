import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ApiErrorBody,
    EDITOR_POWERLINES_URL,
    EditorPowerlineDetail,
    EditorPowerlineList,
    kraftlinienGestalt,
    type EditorPowerlineRow,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";

/**
 * Der Lesepfad des Kraftlinien-Editors (WI-0205 Paket K1) gegen echtes PostgreSQL (`avesmaps3d_test`, nie die geteilte Testwelt).
 *
 * Problemfälle: ein Besucher oder Tester liest die Liste; eine Linie zerfällt in ihre Abschnitte statt einer Zeile je Name; der Kreis
 * ist voll, obwohl nur ein Teil der Abschnitte den Artikel trägt (T28 (1): je Abschnitt); ein leerer Name fasst fremde Abschnitte
 * zusammen; ein fehlender Knoten bricht die Liste; ein unveränderter Stand wird jedes Mal neu übertragen; das Detail zu einem
 * beliebigen Abschnitt liefert eine andere Linie als die Liste.
 * Soll: ab Reviewer, 401/403 vor jeder Abfrage; ● bei voller, ◑ bei teilweiser Zuordnung mit Zahl; Strang mit Enden von West nach Ost,
 * Ring, fehlender Knoten gezählt; ETag mit 304; Detail mit Knoten, Merkmal Nodix und Treffpunkten.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0205-k1";
const P = "b2b2b2b2-0000-4000-8000-";
/** Knoten: drei Orte (zwei mit Nodix), ein Kraftlinienpunkt, ein fehlender. */
const K = {
    west: `${P}000000000001`,
    mitte: `${P}000000000002`,
    ost: `${P}000000000003`,
    punkt: `${P}000000000004`,
    fehlt: `${P}000000000005`,
} as const;
/** Abschnitte: „K1 Strang“ West → Mitte → Ost (nur einer mit Artikel), „K1 Ring“ Mitte → Punkt → Ost → Mitte (alle mit Artikel),
 *  „K1 Offen“ ins Leere, zwei namenlose. */
const A = {
    strang1: `${P}0000000000a1`,
    strang2: `${P}0000000000a2`,
    ring1: `${P}0000000000b1`,
    ring2: `${P}0000000000b2`,
    ring3: `${P}0000000000b3`,
    offen: `${P}0000000000c1`,
    leer1: `${P}0000000000d1`,
    leer2: `${P}0000000000d2`,
    alt: `${P}0000000000e1`,
} as const;
const WIKI_URL = "https://de.wiki-aventurica.de/wiki/K1_Probe_Ring";

describeWithDatabase("Lesepfad des Kraftlinien-Editors (WI-0205 K1)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    let snapshotId = "";
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
        await database`DELETE FROM powerline_wiki_assignment WHERE powerline_id IN (SELECT id FROM powerline WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM powerline WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM wiki_powerline_snapshot WHERE wiki_key = 'wi0205-k1-ring'`;
        await database`DELETE FROM nodix WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    const liste = async (role: Role = "reviewer"): Promise<EditorPowerlineRow[]> => {
        const res = await get(EDITOR_POWERLINES_URL, role);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as unknown;
        expect(Value.Check(EditorPowerlineList, body)).toBe(true);
        return (body as EditorPowerlineList).rows.filter((r) => r.name.startsWith("K1 ") || r.id.startsWith(P));
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["tester", "reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Kraftlinienliste ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, is_nodix, source_system)
            VALUES (${K.west}, 'aventuria', 'K1 Westheim', 'dorf', ST_SetSRID(ST_MakePoint(100, 500), 0), TRUE, ${SOURCE}),
                   (${K.mitte}, 'aventuria', 'K1 Mittdorf', 'dorf', ST_SetSRID(ST_MakePoint(200, 500), 0), TRUE, ${SOURCE}),
                   (${K.ost}, 'aventuria', 'K1 Ostburg', 'dorf', ST_SetSRID(ST_MakePoint(300, 500), 0), FALSE, ${SOURCE})
        `;
        await database`
            INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system)
            VALUES (${K.punkt}, 'aventuria', 'junction', ST_SetSRID(ST_MakePoint(250, 450), 0), ${SOURCE})
        `;
        const linie = (id: string, name: string, von: string, nach: string, aktiv = true) => database`
            INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, curve, geom, drawn_geom, source_system, is_active)
            VALUES (${id}, 'aventuria', ${name}, TRUE, ${von}, ${nach}, 10,
                    ST_GeomFromText('LINESTRING(100 500, 300 500)', 0), ST_GeomFromText('LINESTRING(100 500, 300 500)', 0), ${SOURCE}, ${aktiv})
        `;
        await linie(A.strang1, "K1 Strang", K.mitte, K.ost);
        await linie(A.strang2, "K1 Strang", K.west, K.mitte);
        await linie(A.ring1, "K1 Ring", K.mitte, K.punkt);
        await linie(A.ring2, "K1 Ring", K.punkt, K.ost);
        await linie(A.ring3, "K1 Ring", K.ost, K.mitte);
        await linie(A.offen, "K1 Offen", K.west, K.fehlt);
        await linie(A.leer1, "", K.west, K.ost);
        await linie(A.leer2, "", K.west, K.ost);
        await linie(A.alt, "K1 Strang", K.ost, K.punkt, false);
        const [snap] = await database<{ id: string }[]>`
            INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, synced_at)
            VALUES ('wi0205-k1-ring', ${WIKI_URL}, 'Probe-Ring (Artikel)', now()) RETURNING id::text
        `;
        snapshotId = snap!.id;
        // Der Ring trägt den Artikel an allen drei Abschnitten, der Strang nur an einem.
        await database`
            INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state)
            SELECT id, ${WIKI_URL}, ${snapshotId}::bigint, 'assigned' FROM powerline
             WHERE public_id = ANY(${[A.ring1, A.ring2, A.ring3, A.strang1]}::uuid[])
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
        expect((await get(EDITOR_POWERLINES_URL)).statusCode).toBe(401);
        const tester = await get(EDITOR_POWERLINES_URL, "tester");
        expect(tester.statusCode).toBe(403);
        expect(Value.Check(ApiErrorBody, JSON.parse(tester.body))).toBe(true);
        expect((await get(`${EDITOR_POWERLINES_URL}/${A.ring1}`, "tester")).statusCode).toBe(403);
        expect((await get(EDITOR_POWERLINES_URL, "reviewer")).statusCode).toBe(200);
    });

    it("eine Zeile je Name, der Kreis je Abschnitt, Gestalt und Enden", async () => {
        const rows = await liste();
        const strang = rows.find((r) => r.name === "K1 Strang");
        const ring = rows.find((r) => r.name === "K1 Ring");
        const offen = rows.find((r) => r.name === "K1 Offen");
        expect(strang).toMatchObject({
            id: A.strang1,
            segments: 2,
            nodes: 3,
            circle: "halb-rechts",
            shape: "strang",
            wikiSegments: 1,
        });
        expect(strang?.ends).toEqual(["K1 Westheim", "K1 Ostburg"]); // West vor Ost
        expect(ring).toMatchObject({
            id: A.ring1,
            segments: 3,
            circle: "voll",
            shape: "ring",
            wiki: { url: WIKI_URL, title: "Probe-Ring (Artikel)" },
        });
        expect(ring?.wikiSegments).toBeUndefined();
        expect(offen).toMatchObject({ segments: 1, missingNodes: 1, circle: "halb-rechts" });
        // Zwei namenlose Abschnitte bleiben zwei Linien; ein stillgelegter Abschnitt ist eine eigene, gelöschte Linie (EDIT-0003 T54).
        expect(
            rows
                .filter((r) => r.name === "")
                .map((r) => r.id)
                .sort(),
        ).toEqual([A.leer1, A.leer2]);
        expect(rows.find((r) => r.id === A.alt)).toMatchObject({ name: "K1 Strang", deleted: true });
        expect(rows.filter((r) => r.name === "K1 Strang" && r.deleted !== true)).toHaveLength(1);
    });

    it("ETag: ein unveränderter Stand kommt als 304; ungepackt auch auf Wunsch (packen tut Nginx, Block E)", async () => {
        const erste = await get(EDITOR_POWERLINES_URL, "reviewer", { "accept-encoding": "gzip" });
        expect(erste.headers["content-encoding"]).toBeUndefined();
        expect(Value.Check(EditorPowerlineList, erste.json())).toBe(true);
        const etag = String(erste.headers["etag"]);
        expect((await get(EDITOR_POWERLINES_URL, "reviewer", { "if-none-match": etag })).statusCode).toBe(304);
        // Die Kurve steht nicht in der Liste (304 bleibt richtig); ein neuer Name ändert sie.
        await database`UPDATE powerline SET curve = 20 WHERE public_id = ${A.ring2}`;
        expect((await get(EDITOR_POWERLINES_URL, "reviewer", { "if-none-match": etag })).statusCode).toBe(304);
        await database`UPDATE powerline SET name = 'K1 Umbenannt' WHERE public_id = ${A.leer2}`;
        expect((await get(EDITOR_POWERLINES_URL, "reviewer", { "if-none-match": etag })).statusCode).toBe(200);
    });

    it("das Detail über jeden Abschnitt: dieselbe Linie, Knoten mit Nodix, Treffpunkte, fehlender Knoten", async () => {
        const res = await get(`${EDITOR_POWERLINES_URL}/${A.ring3}`, "reviewer");
        expect(res.statusCode).toBe(200);
        const detail = JSON.parse(res.body) as EditorPowerlineDetail;
        expect(Value.Check(EditorPowerlineDetail, detail)).toBe(true);
        expect(detail.id).toBe(A.ring1);
        expect(detail.segments.map((s) => s.id)).toEqual([A.ring1, A.ring2, A.ring3]);
        const mitte = detail.nodes.find((n) => n.id === K.mitte);
        expect(mitte).toMatchObject({ kind: "place", name: "K1 Mittdorf", nodix: true });
        expect(mitte?.meets).toEqual(["K1 Strang"]);
        expect(detail.nodes.find((n) => n.id === K.punkt)).toMatchObject({ kind: "nodix", nodix: true });
        expect(detail.nodes.find((n) => n.id === K.ost)).toMatchObject({ nodix: false });
        const offen = (await liste()).find((r) => r.name === "K1 Offen");
        const offenDetail = JSON.parse(
            (await get(`${EDITOR_POWERLINES_URL}/${offen!.id}`, "reviewer")).body,
        ) as EditorPowerlineDetail;
        expect(offenDetail.nodes.find((n) => n.id === K.fehlt)).toMatchObject({ kind: "missing", nodix: false });
        // Ein stillgelegter Abschnitt hat sein Detail im Stand „gelöscht“ (K10): So erreichen Verlauf und „Zurückholen“ die Linie.
        const alt = await get(`${EDITOR_POWERLINES_URL}/${A.alt}`, "reviewer");
        expect(alt.statusCode).toBe(200);
        expect((JSON.parse(alt.body) as EditorPowerlineDetail).state).toBe("geloescht");
    });

    it("die Kette eines Strangs vom westlichen Ende her (reine Rechnung)", () => {
        const lage = new Map<string, [number, number]>([
            ["a", [300, 0]],
            ["b", [200, 0]],
            ["c", [100, 0]],
        ]);
        const g = kraftlinienGestalt(
            [
                { id: "1", from: "a", to: "b" },
                { id: "2", from: "b", to: "c" },
            ],
            (k) => lage.get(k),
        );
        expect(g.shape).toBe("strang");
        expect(g.kette).toEqual([
            { knoten: "c" },
            { abschnitt: "2" },
            { knoten: "b" },
            { abschnitt: "1" },
            { knoten: "a" },
        ]);
        expect(
            kraftlinienGestalt([
                { id: "1", from: "a", to: "b" },
                { id: "2", from: "c", to: "d" },
            ]).shape,
        ).toBe("teile");
        expect(
            kraftlinienGestalt([
                { id: "1", from: "a", to: "b" },
                { id: "2", from: "a", to: "c" },
                { id: "3", from: "a", to: "d" },
            ]).shape,
        ).toBe("verzweigt");
    });
});
