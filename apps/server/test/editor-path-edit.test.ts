import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    editorPathTargetsUrl,
    editorPathUpdateUrl,
    editorPathUrl,
    type EditorPathDetail,
    type EditorPathTargets,
    type PathUpdateReceipt,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Die Wegkurve im Wegeditor (WI-0177 Stufe 1; seit W5b Schritt 3 als `shape` in `path.update`, `path.reshape` entfällt) gegen echtes
 * PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle: ein Stützpunkt landet ungerundet und das Ende verfehlt den Nachbarn um 0,0001; die gezeichnete Kurve bleibt alt; ein
 * veralteter Stand überschreibt still; ein mitgezogener Weg ändert sich ohne seine Revision oder an einem Ort; die Bestätigung nennt
 * einen Anschluss, den die Wegfindung nicht sieht; ein Andockziel liegt auf dem eigenen Weg oder auf einem unsichtbaren Seeweg.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0177";
/** Ein leerer Winkel der Karte, weit weg von den Proben anderer Dateien. */
const X0 = 713;
const Y0 = 287;
const ORT_A = "a1770177-0000-4000-8000-0000000000a1";
const ORT_B = "a1770177-0000-4000-8000-0000000000b1";
const WEG = "a1770177-0000-4000-8000-000000000001";
const ANDERER = "a1770177-0000-4000-8000-000000000002";
const SEEWEG = "a1770177-0000-4000-8000-000000000003";
const KNOTENWEG = "a1770177-0000-4000-8000-000000000004";
const STICH = "a1770177-0000-4000-8000-000000000005";
const FREMDSTICH = "a1770177-0000-4000-8000-000000000006";
/** Eine zweite Karte (Domäne) für die Sicherheitsprüfung OPS-000036: eine Kopie von Aventurien unter anderer Kennung. */
const ZWEITE_KARTE = "test-wi0177-zweite";

let zaehler = 0;
const operationId = (): string => `a1770177-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;
const p = (dx: number, dy: number) => ({ x: X0 + dx, y: Y0 + dy });

describeWithDatabase("Wegkurve im Wegeditor (WI-0177)", { timeout: 120_000 }, () => {
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
        await database`DELETE FROM job_event WHERE kind = 'map.changed' OR job_id IN (SELECT id FROM job WHERE kind = 'path_profile')`;
        await database`DELETE FROM job WHERE kind = 'path_profile'`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a1770177-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a1770177-%'`;
        await database`DELETE FROM path_visual WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ANY(${[KNOTENWEG, STICH]}::uuid[])`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    async function lege(): Promise<void> {
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT_A}, 'aventuria', 'WE Anfang', 'dorf', ST_SetSRID(ST_MakePoint(${X0}, ${Y0}), 0), ${SOURCE}, TRUE),
                   (${ORT_B}, 'aventuria', 'WE Ziel', 'dorf', ST_SetSRID(ST_MakePoint(${X0 + 10}, ${Y0}), 0), ${SOURCE}, TRUE)
        `;
        const linie = (punkte: { x: number; y: number }[]) =>
            `LINESTRING(${punkte.map((q) => `${String(q.x)} ${String(q.y)}`).join(", ")})`;
        const weg = async (id: string, name: string, subtype: string, punkte: { x: number; y: number }[]) => {
            await database`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
                VALUES (${id}, 'aventuria', ${name}, ${subtype}, FALSE, FALSE, ST_GeomFromText(${linie(punkte)}, 0), ${SOURCE}, TRUE)
            `;
        };
        // Der bearbeitete Weg: von Ort A über zwei Stützpunkte zu Ort B.
        await weg(WEG, "WE Weg", "Weg", [p(0, 0), p(3, 1), p(6, -1), p(10, 0)]);
        // Ein anderer Weg mit einem inneren Stützpunkt (5, 5) als Andockziel.
        await weg(ANDERER, "WE Anderer", "Strasse", [p(2, 8), p(5, 5), p(8, 8)]);
        // Ein Seeweg gleich daneben: unsichtbar, also kein Ziel.
        await weg(SEEWEG, "WE Meer", "Seeweg", [p(1, -3), p(4, -3)]);
        // Ein Knoten ohne Ort bei (20, 5): der Knotenweg hat dort einen inneren Stützpunkt, der Stich endet dort.
        await weg(KNOTENWEG, "WE Knotenweg", "Weg", [p(16, 1), p(20, 5), p(24, 1)]);
        await weg(STICH, "WE Stich", "Pfad", [p(20, 5), p(20, 9)]);
    }

    const get = async <T>(url: string, role: Role = "editor") =>
        app
            .inject({ method: "GET", url, headers: { cookie: cookies.get(role) ?? "" } })
            .then((r) => ({ status: r.statusCode, body: r.json<T>() }));
    /** Die Kurve eines Abschnitts über `path.update` (W5b Schritt 3): der Satz seiner Straße mit `baseRevision` für ihn selbst. */
    const reshape = async (
        id: string,
        body: { operationId: string; baseRevision: number; points: unknown; carried: unknown },
        role: Role = "editor",
    ) => {
        const strasse = await database<{ id: string; revision: number }[]>`
            SELECT q.public_id::text AS id, q.revision::int AS revision
              FROM path p JOIN path q
                ON q.map_domain_id = p.map_domain_id AND q.name = p.name AND q.subtype = p.subtype AND q.is_active
             WHERE p.public_id = ${id}::uuid
        `;
        return app.inject({
            method: "POST",
            url: editorPathUpdateUrl(id),
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: body.operationId,
                sections: strasse.map((a) => ({
                    publicId: a.id,
                    baseRevision: a.id === id ? body.baseRevision : a.revision,
                })),
                shape: { publicId: id, points: body.points, carried: body.carried },
            },
        });
    };
    const revision = async (id: string): Promise<number> =>
        (await database<{ r: number }[]>`SELECT revision::int AS r FROM path WHERE public_id = ${id}`)[0]!.r;
    const punkte = async (id: string): Promise<[number, number][]> => {
        const [row] = await database<
            { g: string }[]
        >`SELECT ST_AsGeoJSON(geom, 15) AS g FROM path WHERE public_id = ${id}`;
        return (JSON.parse(row!.g) as { coordinates: [number, number][] }).coordinates;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await database`
            INSERT INTO map_domain
            SELECT (jsonb_populate_record(NULL::map_domain, to_jsonb(m) || ${database.json({ id: ZWEITE_KARTE })})).*
              FROM map_domain m WHERE m.id = 'aventuria'
            ON CONFLICT (id) DO NOTHING
        `;
        const fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Weg ${role}` });
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
        await database`DELETE FROM map_domain WHERE id = ${ZWEITE_KARTE}`;
        await database.end({ timeout: 5 });
    });

    it("das Detail nennt das Kontrollpolygon, die Revision und woran beide Enden hängen", async () => {
        await lege();
        const { status, body } = await get<EditorPathDetail>(editorPathUrl(WEG));
        expect(status).toBe(200);
        expect(body).toMatchObject({ publicId: WEG, revision: 1, name: "WE Weg", subtype: "Weg", active: true });
        expect(body.points).toEqual([p(0, 0), p(3, 1), p(6, -1), p(10, 0)]);
        expect(body.ends).toEqual({
            start: { kind: "place", publicId: ORT_A, name: "WE Anfang" },
            end: { kind: "place", publicId: ORT_B, name: "WE Ziel" },
        });
    });

    it("🔴 Andockziele: Orte und Stützpunkte anderer Wege im Kasten, nie der eigene Weg, nie ein Seeweg; nur mit edit_map_geometry", async () => {
        await lege();
        const { status, body } = await get<EditorPathTargets>(editorPathTargetsUrl(WEG));
        expect(status).toBe(200);
        expect(body.places.map((ort) => ort.name).sort()).toEqual(["WE Anfang", "WE Ziel"]);
        const wege = new Set(body.vertices.map((v) => v.pathId));
        expect(wege.has(WEG)).toBe(false);
        expect(wege.has(SEEWEG)).toBe(false);
        expect(body.vertices.filter((v) => v.pathId === ANDERER)).toEqual([
            { pathId: ANDERER, name: "WE Anderer", index: 0, ...p(2, 8), end: true, revision: 1 },
            { pathId: ANDERER, name: "WE Anderer", index: 1, ...p(5, 5), end: false, revision: 1 },
            { pathId: ANDERER, name: "WE Anderer", index: 2, ...p(8, 8), end: true, revision: 1 },
        ]);
        expect((await get(editorPathTargetsUrl(WEG), "reviewer")).status).toBe(403);
    });

    it("🔴 Wegkurve (path.update mit shape): Kontrollpolygon auf fünf Stellen, Kurve in derselben Transaktion, Protokoll, Job path_profile, mapRevision", async () => {
        await lege();
        const antwort = await reshape(WEG, {
            operationId: operationId(),
            baseRevision: 1,
            points: [p(0, 0), { x: X0 + 3.123456789, y: Y0 + 2.000004 }, p(6, -1), p(10, 0)],
            carried: [],
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<PathUpdateReceipt>();
        expect(quittung.affected).toEqual([{ kind: "path", id: WEG, revision: 2 }]);
        // Die Wegnamen der Kette folgen der Kurve (`path_label_runs`, Entscheid der Orchestrierung 2026-10-17).
        expect(quittung.derivedWork.map((w) => w.kind)).toEqual([
            "path_visual",
            "routing",
            "path_profile",
            "path_label_runs",
            "tiles",
        ]);
        expect(quittung.mapRevision).toBeGreaterThan(0);
        expect(quittung.ends?.start).toEqual({ kind: "place", publicId: ORT_A, name: "WE Anfang" });
        expect(await punkte(WEG)).toEqual([
            [X0, Y0],
            [X0 + 3.12346, Y0 + 2],
            [X0 + 6, Y0 - 1],
            [X0 + 10, Y0],
        ]);
        // Die gezeichnete Kurve: 1 + 8 je Abschnitt, durch den neuen Stützpunkt.
        const [kurve] = await database<{ n: number; trifft: boolean }[]>`
            SELECT ST_NPoints(v.geom)::int AS n,
                   ST_DWithin(v.geom, ST_SetSRID(ST_MakePoint(${X0 + 3.12346}, ${Y0 + 2}), 0), 1e-9) AS trifft
              FROM path_visual v JOIN path w ON w.id = v.path_id WHERE w.public_id = ${WEG}
        `;
        expect(kurve).toEqual({ n: 25, trifft: true });
        const [eintrag] = await database<
            {
                action: string;
                revision_before: number;
                revision_after: number;
                changes: { geometry: { after: number[][] } };
            }[]
        >`
            SELECT action, revision_before::int AS revision_before, revision_after::int AS revision_after, changes FROM map_audit_event
             WHERE path_public_id = ${WEG} ORDER BY id DESC LIMIT 1
        `;
        expect(eintrag).toMatchObject({ action: "path.reshaped", revision_before: 1, revision_after: 2 });
        expect(eintrag!.changes.geometry.after[1]).toEqual([X0 + 3.12346, Y0 + 2]);
    });

    it("🔴 veralteter Stand → 409 edit_conflict, nichts geschrieben; dieselbe Kennung → replayed, die Revision zählt einmal", async () => {
        await lege();
        const kennung = operationId();
        const body = {
            operationId: kennung,
            baseRevision: 1,
            points: [p(0, 0), p(3, 2), p(6, -1), p(10, 0)],
            carried: [],
        };
        expect((await reshape(WEG, body)).statusCode).toBe(200);
        const nochmal = await reshape(WEG, body);
        expect(nochmal.statusCode).toBe(200);
        expect(nochmal.json<PathUpdateReceipt>().status).toBe("replayed");
        expect(await revision(WEG)).toBe(2);
        const alt = await reshape(WEG, { ...body, operationId: operationId(), points: [p(0, 0), p(4, 4), p(10, 0)] });
        expect(alt.statusCode).toBe(409);
        expect(alt.json<{ error: { code: string; details: { currentRevision: number } } }>().error).toMatchObject({
            code: "edit_conflict",
            details: { currentRevision: 2 },
        });
        expect(await revision(WEG)).toBe(2);
    });

    it("🔴 die Bestätigung rechnet wie die Wegfindung: Ende auf einem Stützpunkt eines anderen Wegs hängt an ihm, ein Ende im Leeren ist frei", async () => {
        await lege();
        const angedockt = await reshape(WEG, {
            operationId: operationId(),
            baseRevision: 1,
            points: [p(0, 0), p(3, 1), p(6, -1), p(5, 5)],
            carried: [],
        });
        expect(angedockt.statusCode).toBe(200);
        expect(angedockt.json<PathUpdateReceipt>().ends?.end).toEqual({
            kind: "path",
            publicId: ANDERER,
            name: "WE Anderer",
            subtype: "Strasse",
            isBach: false,
            contact: "stuetzpunkt",
        });
        const frei = await reshape(WEG, {
            operationId: operationId(),
            baseRevision: 2,
            points: [p(0, 0), p(3, 1), p(6, -1), p(9, 3)],
            carried: [],
        });
        expect(frei.json<PathUpdateReceipt>().ends?.end).toEqual({ kind: "free" });
        // Der andere Weg bleibt, wie er war: Einrasten verändert nur den eigenen Weg.
        expect(await revision(ANDERER)).toBe(1);
    });

    it("🔴 Mitziehen: der Stich am Knoten ohne Ort geht mit, beide Revisionen zählen, beide im Protokoll", async () => {
        await lege();
        const neu = p(21, 6);
        const antwort = await reshape(KNOTENWEG, {
            operationId: operationId(),
            baseRevision: 1,
            points: [p(16, 1), neu, p(24, 1)],
            carried: [{ pathId: STICH, index: 0, baseRevision: 1, from: p(20, 5), to: neu }],
        });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.json<PathUpdateReceipt>().affected).toEqual([
            { kind: "path", id: KNOTENWEG, revision: 2 },
            { kind: "path", id: STICH, revision: 2 },
        ]);
        expect(await punkte(STICH)).toEqual([
            [X0 + 21, Y0 + 6],
            [X0 + 20, Y0 + 9],
        ]);
        const aktionen = await database<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE path_public_id IN (${KNOTENWEG}, ${STICH}) ORDER BY id
        `;
        expect(aktionen.map((a) => a.action)).toEqual(["path.reshaped", "path.carried"]);
    });

    it("🔴 Mitziehen: an einem Ort nie (400); mit veraltetem Stand des anderen Wegs 409; nichts geschrieben", async () => {
        await lege();
        // Der Anfang des bearbeiteten Wegs liegt auf Ort A; ein Punkt dort zieht nicht mit.
        const amOrt = await reshape(WEG, {
            operationId: operationId(),
            baseRevision: 1,
            points: [p(0, 1), p(3, 1), p(6, -1), p(10, 0)],
            carried: [{ pathId: ANDERER, index: 0, baseRevision: 1, from: p(0, 0), to: p(0, 1) }],
        });
        expect(amOrt.statusCode).toBe(400);
        const veraltet = await reshape(KNOTENWEG, {
            operationId: operationId(),
            baseRevision: 1,
            points: [p(16, 1), p(21, 6), p(24, 1)],
            carried: [{ pathId: STICH, index: 0, baseRevision: 7, from: p(20, 5), to: p(21, 6) }],
        });
        expect(veraltet.statusCode).toBe(409);
        expect(await revision(WEG)).toBe(1);
        expect(await revision(KNOTENWEG)).toBe(1);
        expect(await revision(STICH)).toBe(1);
    });

    it("🔴 Mitziehen: nie ein Weg einer anderen Karte, auch wenn er genau am Knoten liegt (400, Sicherheitsprüfung OPS-000036)", async () => {
        await lege();
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${FREMDSTICH}, ${ZWEITE_KARTE}, 'WE Fremdstich', 'Pfad', FALSE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${String(X0 + 20)} ${String(Y0 + 5)}, ${String(X0 + 20)} ${String(Y0 + 9)})`}, 0),
                    ${SOURCE}, TRUE)
        `;
        const fremd = await reshape(KNOTENWEG, {
            operationId: operationId(),
            baseRevision: 1,
            points: [p(16, 1), p(21, 6), p(24, 1)],
            carried: [{ pathId: FREMDSTICH, index: 0, baseRevision: 1, from: p(20, 5), to: p(21, 6) }],
        });
        expect(fremd.statusCode).toBe(400);
        expect(fremd.json<{ error: { message: string } }>().error.message).toBe(
            "Ein mitgezogener Weg liegt auf einer anderen Karte.",
        );
        expect(await revision(KNOTENWEG)).toBe(1);
        expect(await revision(FREMDSTICH)).toBe(1);
    });

    it("🔴 hält ein anderer den Weg oder einen mitgezogenen, schreibt die Kurve nicht (409 object_locked, EDIT-0003 §4)", async () => {
        await lege();
        const anderer = await authFixture(database).person("editor", { name: "Kurve anderer" });
        const sperre = (id: string) => database`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${id}::uuid, 'form', ${anderer.id}::uuid, 'Kurve anderer', gen_random_uuid())
        `;
        const mitStich = () =>
            reshape(KNOTENWEG, {
                operationId: operationId(),
                baseRevision: 1,
                points: [p(16, 1), p(21, 6), p(24, 1)],
                carried: [{ pathId: STICH, index: 0, baseRevision: 1, from: p(20, 5), to: p(21, 6) }],
            });
        await sperre(STICH);
        const amPartner = await mitStich();
        expect(amPartner.statusCode).toBe(409);
        expect(amPartner.json<{ error: { code: string; details: { lock: { id: string } } } }>().error).toMatchObject({
            code: "object_locked",
            details: { lock: { id: STICH } },
        });
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ${STICH}::uuid`;
        await sperre(KNOTENWEG);
        expect((await mitStich()).statusCode).toBe(409);
        expect(await revision(KNOTENWEG)).toBe(1);
        expect(await revision(STICH)).toBe(1);
        // Ohne fremde Sperre geht es wie bisher.
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ${KNOTENWEG}::uuid`;
        expect((await mitStich()).statusCode).toBe(200);
    });

    it("Ablehnungen: Anfang gleich Ende, ein einziger Punkt, außerhalb der Karte; ein Reviewer schreibt nicht", async () => {
        await lege();
        const basis = { baseRevision: 1, carried: [] };
        const ring = await reshape(WEG, { ...basis, operationId: operationId(), points: [p(0, 0), p(3, 1), p(0, 0)] });
        expect(ring.statusCode).toBe(400);
        const einer = await reshape(WEG, {
            ...basis,
            operationId: operationId(),
            points: [p(0, 0), { x: X0 + 0.000001, y: Y0 }],
        });
        expect(einer.statusCode).toBe(400);
        const draussen = await reshape(WEG, {
            ...basis,
            operationId: operationId(),
            points: [p(0, 0), { x: -50, y: -50 }],
        });
        expect(draussen.statusCode).toBe(400);
        const reviewer = await reshape(
            WEG,
            { ...basis, operationId: operationId(), points: [p(0, 0), p(10, 0)] },
            "reviewer",
        );
        expect(reviewer.statusCode).toBe(403);
        expect(await revision(WEG)).toBe(1);
    });
});
