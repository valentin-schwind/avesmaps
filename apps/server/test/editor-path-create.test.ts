import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    EDITOR_PATHS_URL,
    allowedTransportsForPath,
    PATH_TARGETS_MAX_SIDE,
    editorPathTargetsAreaUrl,
    type EditorPathTargets,
    type PathCreateReceipt,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { zielKasten } from "../src/editor/path-create.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * „Neuer Weg“ im Wegeditor (WI-0177; EDIT-0003 T40 (3)) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle: ein neuer Weg landet ungerundet und sein Ende verfehlt den Ort um 0,0001; die Kurve fehlt; zwei Anlagen tragen denselben
 * Griff und werden auf der Karte eine Straße; eine wiederholte Anfrage legt den Weg zweimal an; die Bestätigung nennt einen Anschluss,
 * den die Wegfindung nicht sieht; ein Weg mit dem Ende auf dem Anfang oder außerhalb der Karte entsteht; ein Reviewer legt an; die Ziele
 * im Kasten nennen Seewege oder wachsen mit dem Ausschnitt ins Unendliche.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0177-neu";
/** Ein leerer Winkel der Karte, weit weg von den Proben anderer Dateien (die Wegkurve nimmt 713|287). */
const X0 = 741;
const Y0 = 251;
const ORT_A = "a1770177-0000-4000-8000-00000000a0a1";
const ORT_B = "a1770177-0000-4000-8000-00000000a0b1";
const ANDERER = "a1770177-0000-4000-8000-00000000a002";
const SEEWEG = "a1770177-0000-4000-8000-00000000a003";
const GRIFF = "a1770177-0000-4000-8000-00000000a004";
let zaehler = 0;
const operationId = (): string => `a1770177-0000-4000-9000-${String((zaehler += 1)).padStart(8, "0")}a0a0`;
const p = (dx: number, dy: number) => ({ x: X0 + dx, y: Y0 + dy });
const KASTEN = { x0: X0 - 5, y0: Y0 - 5, x1: X0 + 30, y1: Y0 + 30 };

describeWithDatabase("Neuer Weg im Wegeditor (WI-0177)", { timeout: 120_000 }, () => {
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

    /** Die neuen Wege dieser Datei: eigene Herkunft, in ihrem Winkel. */
    const neueWege = `source_system = 'avesmaps3d' AND geom && ST_MakeEnvelope(${String(KASTEN.x0)}, ${String(KASTEN.y0)}, ${String(KASTEN.x1)}, ${String(KASTEN.y1)}, 0)`;

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM job_event WHERE kind = 'map.changed' OR job_id IN (SELECT id FROM job WHERE kind = 'path_profile')`;
        await database`DELETE FROM job WHERE kind = 'path_profile'`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a1770177-0000-4000-9000-%a0a0'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a1770177-0000-4000-9000-%a0a0'`;
        await database.unsafe(
            `DELETE FROM path_visual WHERE path_id IN (SELECT id FROM path WHERE source_system = '${SOURCE}' OR (${neueWege}))`,
        );
        await database.unsafe(`DELETE FROM path WHERE source_system = '${SOURCE}' OR (${neueWege})`);
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    async function lege(): Promise<void> {
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT_A}, 'aventuria', 'NW Anfang', 'dorf', ST_SetSRID(ST_MakePoint(${X0}, ${Y0}), 0), ${SOURCE}, TRUE),
                   (${ORT_B}, 'aventuria', 'NW Ziel', 'dorf', ST_SetSRID(ST_MakePoint(${X0 + 20}, ${Y0}), 0), ${SOURCE}, TRUE)
        `;
        const linie = (punkte: { x: number; y: number }[]) =>
            `LINESTRING(${punkte.map((q) => `${String(q.x)} ${String(q.y)}`).join(", ")})`;
        const weg = async (id: string, name: string, subtype: string, punkte: { x: number; y: number }[]) => {
            await database`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
                VALUES (${id}, 'aventuria', ${name}, ${subtype}, FALSE, FALSE, ST_GeomFromText(${linie(punkte)}, 0), ${SOURCE}, TRUE)
            `;
        };
        // Ein anderer Weg mit einem inneren Stützpunkt (10, 8): ein Ende dort ist ein T-Stoß.
        await weg(ANDERER, "NW Anderer", "Strasse", [p(6, 12), p(10, 8), p(14, 12)]);
        await weg(SEEWEG, "NW Meer", "Seeweg", [p(2, -3), p(6, -3)]);
        // Ein Griff mit hoher Nummer: Der nächste neue Weg zählt darüber hinaus.
        await weg(GRIFF, "Weg-990001", "Weg", [p(25, 25), p(28, 28)]);
    }

    const get = async <T>(url: string, role: Role = "editor") =>
        app
            .inject({ method: "GET", url, headers: { cookie: cookies.get(role) ?? "" } })
            .then((r) => ({ status: r.statusCode, body: r.json<T>() }));
    const lege_an = (body: object, role: Role = "editor") =>
        app.inject({
            method: "POST",
            url: EDITOR_PATHS_URL,
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: body,
        });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        const fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Neuer Weg ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 path.create: EINE Operation, fünf Stellen, Art Weg mit Griff, Kurve, Protokoll, Job, Anschlüsse aus der Wegfindung", async () => {
        await lege();
        const antwort = await lege_an({
            operationId: operationId(),
            points: [p(0, 0), { x: X0 + 4.123456789, y: Y0 + 3.000004 }, p(10, 8)],
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<PathCreateReceipt>();
        expect(quittung.subtype).toBe("Weg");
        expect(quittung.name).toMatch(/^Weg-\d+$/);
        expect(Number(quittung.name.slice(4))).toBeGreaterThan(990001);
        expect(quittung.affected).toEqual([{ kind: "path", id: quittung.publicId, revision: 1 }]);
        expect(quittung.mapRevision).toEqual(expect.any(Number));
        // Anfang am Ort, Ende am inneren Stützpunkt des anderen Wegs: ein Knoten der Wegfindung, kein Kreuzungsobjekt.
        expect(quittung.ends).toEqual({
            start: { kind: "place", publicId: ORT_A, name: "NW Anfang" },
            end: {
                kind: "path",
                publicId: ANDERER,
                name: "NW Anderer",
                subtype: "Strasse",
                isBach: false,
                contact: "stuetzpunkt",
            },
        });
        const [zeile] = await database<
            {
                g: string;
                name: string;
                subtype: string;
                label_visible: boolean;
                is_bach: boolean;
                allowed_transports: string[] | null;
                source_system: string;
                is_active: boolean;
                kurve: number;
            }[]
        >`
            SELECT ST_AsGeoJSON(p.geom, 15) AS g, p.name, p.subtype, p.label_visible, p.is_bach, p.allowed_transports, p.source_system,
                   p.is_active, (SELECT count(*)::int FROM path_visual v WHERE v.path_id = p.id) AS kurve
              FROM path p WHERE p.public_id = ${quittung.publicId}
        `;
        expect(JSON.parse(zeile!.g).coordinates).toEqual([
            [X0, Y0],
            [745.12346, 254],
            [X0 + 10, Y0 + 8],
        ]);
        expect(zeile).toMatchObject({
            name: quittung.name,
            subtype: "Weg",
            label_visible: false,
            is_bach: false,
            allowed_transports: null,
            source_system: "avesmaps3d",
            is_active: true,
            kurve: 1,
        });
        // Der andere Weg bleibt, wie er ist: kein Teilen, kein Stützpunkt dazu.
        const [anderer] = await database<{ n: number; r: number }[]>`
            SELECT ST_NPoints(geom) AS n, revision::int AS r FROM path WHERE public_id = ${ANDERER}
        `;
        expect(anderer).toEqual({ n: 3, r: 1 });
        const protokoll = await database<{ action: string; changes: Record<string, { after?: unknown }> }[]>`
            SELECT e.action, e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE o.action = 'path.create' AND e.path_public_id = ${quittung.publicId}
        `;
        expect(protokoll.map((e) => e.action)).toEqual(["path.created"]);
        expect(protokoll[0]!.changes["subtype"]).toEqual({ after: "Weg" });
        expect(quittung.derivedWork.map((w) => w.kind)).toEqual(
            expect.arrayContaining(["path_visual", "path_profile", "tiles"]),
        );
    });

    it("🔴 zwei neue Wege tragen zwei Griffe; dieselbe Kennung legt nur einmal an", async () => {
        await lege();
        const kennung = operationId();
        const body = { operationId: kennung, points: [p(1, 1), p(5, 1)] };
        const erste = (await lege_an(body)).json<PathCreateReceipt>();
        const nochmal = await lege_an(body);
        expect(nochmal.statusCode).toBe(200);
        expect(nochmal.json<PathCreateReceipt>()).toMatchObject({ publicId: erste.publicId, name: erste.name });
        const zweite = (
            await lege_an({ operationId: operationId(), points: [p(1, 2), p(5, 2)] })
        ).json<PathCreateReceipt>();
        expect(Number(zweite.name.slice(4))).toBe(Number(erste.name.slice(4)) + 1);
        const [anzahl] = await database.unsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM path WHERE ${neueWege}`,
        );
        expect(anzahl?.n).toBe(2);
    });

    it("🔴 Neuer Fluss und neuer Bach (Plan Fluss/Bach 2026-10-19): Flussweg mit Griff, Fließrichtung = Zeichenrichtung, Fluss mit den Booten seiner Art, Bach ohne Boote; das Protokoll nennt es", async () => {
        await lege();
        const fluss = await lege_an({ operationId: operationId(), points: [p(1, 3), p(6, 3)], art: "fluss" });
        expect(fluss.statusCode).toBe(200);
        const flussQuittung = fluss.json<PathCreateReceipt>();
        expect(flussQuittung).toMatchObject({ subtype: "Flussweg" });
        expect(flussQuittung.name).toMatch(/^Flussweg-[0-9]+$/);
        expect(flussQuittung).not.toHaveProperty("isBach");
        const bach = (
            await lege_an({ operationId: operationId(), points: [p(1, 4), p(6, 4)], art: "bach" })
        ).json<PathCreateReceipt>();
        expect(bach).toMatchObject({ subtype: "Flussweg", isBach: true });
        // Zwei Griffe derselben Art hintereinander.
        expect(Number(bach.name.slice("Flussweg-".length))).toBe(
            Number(flussQuittung.name.slice("Flussweg-".length)) + 1,
        );
        const zeilen = await database<
            {
                id: string;
                subtype: string;
                bach: boolean;
                richtung: string | null;
                liste: string[] | null;
                domaene: string | null;
            }[]
        >`
            SELECT public_id::text AS id, subtype, is_bach AS bach, flow_direction AS richtung, allowed_transports AS liste,
                   transport_domain AS domaene
              FROM path WHERE public_id = ANY(${[flussQuittung.publicId, bach.publicId]}::uuid[])
        `;
        const zeile = (id: string) => zeilen.find((z) => z.id === id)!;
        expect(zeile(flussQuittung.publicId)).toMatchObject({
            subtype: "Flussweg",
            bach: false,
            richtung: "forward",
            liste: null,
            domaene: null,
        });
        expect(zeile(bach.publicId)).toMatchObject({
            subtype: "Flussweg",
            bach: true,
            richtung: "forward",
            liste: [],
            domaene: "none",
        });
        // Was die Wegfindung daraus liest: der Fluss die Boote seiner Art, der Bach keine (F14).
        const wirksam = (z: ReturnType<typeof zeile>) =>
            allowedTransportsForPath(AVENTURIA_TRAVEL_MODEL, z.subtype, z.liste, z.domaene);
        expect(wirksam(zeile(flussQuittung.publicId))).toEqual(expect.arrayContaining(["riverSailer", "riverBarge"]));
        expect(wirksam(zeile(bach.publicId))).toEqual([]);
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e WHERE e.path_public_id = ${bach.publicId}::uuid
        `;
        expect(eintrag?.changes).toMatchObject({
            subtype: { after: "Flussweg" },
            flowDirection: { after: "forward" },
            isBach: { after: true },
        });
        // Ohne Art bleibt es der Landweg wie bisher.
        const weg = (
            await lege_an({ operationId: operationId(), points: [p(1, 5), p(6, 5)] })
        ).json<PathCreateReceipt>();
        expect(weg).toMatchObject({ subtype: "Weg" });
        expect(weg).not.toHaveProperty("isBach");
        expect(
            (await lege_an({ operationId: operationId(), points: [p(1, 6), p(6, 6)], art: "seeweg" })).statusCode,
        ).toBe(400);
    });

    it("Ablehnungen: ein Punkt, Anfang gleich Ende, außerhalb der Karte; ein Reviewer legt nicht an", async () => {
        await lege();
        expect((await lege_an({ operationId: operationId(), points: [p(1, 1)] })).statusCode).toBe(400);
        const gleich = await lege_an({
            operationId: operationId(),
            points: [p(1, 1), p(3, 3), { x: X0 + 1.000001, y: Y0 + 1 }],
        });
        expect(gleich.statusCode).toBe(400);
        expect(gleich.json<{ error: { code: string } }>().error.code).toBe("validation_failed");
        const draussen = await lege_an({ operationId: operationId(), points: [p(1, 1), { x: 5000, y: 5000 }] });
        expect(draussen.statusCode).toBe(400);
        expect((await lege_an({ operationId: operationId(), points: [p(1, 1), p(4, 4)] }, "reviewer")).statusCode).toBe(
            403,
        );
        const [anzahl] = await database.unsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM path WHERE ${neueWege}`,
        );
        expect(anzahl?.n).toBe(0);
    });

    it("🔴 Ziele im Kasten: Orte und Stützpunkte, nie ein Seeweg; ein zu großer Kasten wird auf die Mitte gekürzt; nur mit edit_map_geometry", async () => {
        await lege();
        const { status, body } = await get<EditorPathTargets>(editorPathTargetsAreaUrl(KASTEN));
        expect(status).toBe(200);
        expect(
            body.places
                .filter((o) => o.name.startsWith("NW "))
                .map((o) => o.name)
                .sort(),
        ).toEqual(["NW Anfang", "NW Ziel"]);
        const wege = new Set(body.vertices.map((v) => v.pathId));
        expect(wege.has(SEEWEG)).toBe(false);
        expect(body.vertices.filter((v) => v.pathId === ANDERER).map((v) => v.index)).toEqual([0, 1, 2]);
        expect((await get(editorPathTargetsAreaUrl(KASTEN), "reviewer")).status).toBe(403);
        const [x0, y0, x1, y1] = zielKasten({ x0: 0, y0: 0, x1: 1024, y1: 400 });
        expect(x1 - x0).toBe(PATH_TARGETS_MAX_SIDE);
        expect(y1 - y0).toBe(PATH_TARGETS_MAX_SIDE);
        expect((x0 + x1) / 2).toBe(512);
    });
});
