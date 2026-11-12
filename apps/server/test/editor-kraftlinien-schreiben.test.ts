import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_NODICES_URL,
    EDITOR_POWERLINE_WIKI_URL,
    EDITOR_POWERLINE_TARGETS_URL,
    EDITOR_POWERLINES_URL,
    editorNodixMoveUrl,
    editorNodixRetireUrl,
    editorPlaceMoveUrl,
    editorPowerlineHistoryUrl,
    editorPowerlinePutOnMapUrl,
    editorPowerlineRestoreUrl,
    editorPowerlineTakeOffMapUrl,
    editorPowerlineRetireUrl,
    editorPowerlineTargetsUrl,
    type EditorPowerlineTargets,
    type WikiTrefferListe,
    editorPowerlineUpdateUrl,
    type EditorPowerlineDetail,
    type EditorPowerlineList,
    type MapHistoryPage,
    type OperationReceipt,
    type NodixCreateReceipt,
    type PowerlineCreateReceipt,
    type PowerlineUpdateBody,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Die Felder einer Kraftlinie schreiben (WI-0205 Paket K6, `powerline.update_line`; Legacy `update_powerline_line`) gegen echtes
 * PostgreSQL. 🔴 Braucht Migration 0143: vor ihrem Push nur gegen eine eigene Datenbank laufen lassen, nie gegen die geteilte.
 *
 * Problemfälle: Ein Reviewer schreibt; der Name landet nur am Anker statt an allen Abschnitten; ein Feld, das nicht mitreist, wird
 * geleert (Legacys Lehre); ein veralteter Abschnitt oder ein inzwischen dazugekommener wird überschrieben statt 409; ein Umbenennen
 * auf einen vorhandenen Namen verschmilzt still; eine leere Beschreibung bleibt als Leerstring stehen; ein leerer Name löst die Linie
 * in Einzelabschnitte auf.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0205-k6";
const P = "b6b6b6b6-0000-4000-8000-";
const ORT = `${P}0000000000c1`;
const ZIEL = `${P}0000000000c2`;
// K8: ein Nodix zum Umhängen, ein Ort ohne Merkmal.
const NODIX_ORT = `${P}0000000000d1`;
const KEIN_NODIX = `${P}0000000000d2`;
/** Die Kraftlinienpunkte, die K9 anlegt (Herkunft des Editors): Das Aufräumen nimmt genau sie. */
const neuePunkte: string[] = [];
const A = { eins: `${P}0000000000a1`, zwei: `${P}0000000000a2`, drei: `${P}0000000000a3`, fremd: `${P}0000000000f1` };
/** Die Linie des Verlaufs: zwei Abschnitte, die sonst kein Fall berührt. */
const V = { eins: `${P}000000000071`, zwei: `${P}000000000072` };
/** K10 und R5: eine Linie B–C–D an eigenen Nodix-Orten, dazu E zum Anfügen. */
const N = { b: `${P}000000000081`, c: `${P}000000000082`, d: `${P}000000000083`, e: `${P}000000000084` };
const R = { eins: `${P}000000000091`, zwei: `${P}000000000092` };

describeWithDatabase("Felder einer Kraftlinie schreiben (WI-0205 K6)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    const cookies = new Map<Role, string>();
    const personen = new Map<Role, string>();
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
        await database`DELETE FROM job_event WHERE kind = 'map.changed'`;
        // Erst das Protokoll der eigenen Operationen (Kraftlinie und Ort verschieben), dann die Operationen, dann die Gegenstände.
        await database`
            DELETE FROM map_audit_event WHERE operation_id IN (
                SELECT operation_id FROM map_operation
                 WHERE action IN ('powerline.update_line', 'powerline.retire', 'powerline.create', 'nodix.create',
                                  'powerline.restore', 'powerline.take_off_map', 'powerline.put_on_map', 'nodix.retire',
                                  'nodix.move')
                    OR (action = 'place.move' AND summary LIKE 'K6 Ort%'))
        `;
        await database`
            DELETE FROM map_operation WHERE action IN ('powerline.update_line', 'powerline.retire', 'powerline.create', 'nodix.create',
                                                       'powerline.restore', 'powerline.take_off_map', 'powerline.put_on_map',
                                                       'nodix.retire', 'nodix.move')
        `;
        // Die Herkunftsvermerke (`field_origin`, Migration 0183) fallen nicht mit der Linie: Blieben sie, fände der nächste Lauf auf
        // derselben Datenbank „manual“ schon vor, und das Protokoll nennte `nameOrigin` und `descriptionOrigin` nicht mehr (zwei Fälle
        // rot beim zweiten Lauf, Befund 2026-10-31). Die festen Kennungen der Linien, auch die eines früheren Laufs.
        await database`
            DELETE FROM field_origin WHERE object_kind = 'powerline'
               AND (object_id = ANY(${[A.eins, A.zwei, A.drei, A.fremd, V.eins, V.zwei, N.b, N.c, N.d, N.e, R.eins, R.zwei]}::uuid[])
                    OR object_id IN (SELECT public_id FROM powerline WHERE source_system = ${SOURCE}))
        `;
        // K9 legt Abschnitte mit der Herkunft des Editors an; sie enden an den Orten dieses Tests.
        await database`
            DELETE FROM powerline WHERE source_system = 'avesmaps3d'
               AND from_public_id = ANY(${[ORT, ZIEL, NODIX_ORT, N.b, N.c, N.d, N.e]}::uuid[])
        `;
        await database`DELETE FROM map_operation WHERE action = 'place.move' AND summary LIKE 'K6 Ort%'`;
        await database`DELETE FROM powerline WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
        if (neuePunkte.length > 0) await database`DELETE FROM nodix WHERE public_id = ANY(${neuePunkte}::uuid[])`;
    }
    const linie = (id: string, name: string, label = true) => database`
        INSERT INTO powerline (public_id, map_domain_id, name, label_visible, from_public_id, to_public_id, geom, drawn_geom, source_system)
        VALUES (${id}, 'aventuria', ${name}, ${label}, ${randomUUID()}, ${randomUUID()},
                ST_GeomFromText('LINESTRING(100 500, 300 500)', 0), ST_GeomFromText('LINESTRING(100 500, 300 500)', 0), ${SOURCE})
    `;
    const detail = async (id: string, role: Role = "editor"): Promise<EditorPowerlineDetail> =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_POWERLINES_URL}/${id}`,
                headers: { cookie: cookies.get(role) ?? "" },
            })
        ).json<EditorPowerlineDetail>();
    const schreibe = (
        id: string,
        body: Omit<PowerlineUpdateBody, "operationId" | "segments"> & Partial<PowerlineUpdateBody>,
        role: Role = "editor",
    ) =>
        app.inject({
            method: "POST",
            url: editorPowerlineUpdateUrl(id),
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), segments: [], ...body },
        });
    /** Der Stand, den ein Entwurf gesehen hätte: alle Abschnitte mit ihrer Revision. */
    const stand = async (id: string): Promise<PowerlineUpdateBody["segments"]> =>
        (await detail(id)).segments.map((s) => ({ id: s.id, baseRevision: s.revision }));

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Kraftlinie ${role}` });
            personen.set(role, person.id);
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        await linie(A.eins, "K6 Probe");
        await linie(A.zwei, "K6 Probe");
        await linie(A.fremd, "K6 Fremd");
        await linie(V.eins, "K6 Verlauf");
        await linie(V.zwei, "K6 Verlauf");
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

    it("🔴 ohne Anmeldung 401, als Reviewer 403, nichts geschrieben", async () => {
        const segments = await stand(A.eins);
        expect(
            (
                await app.inject({
                    method: "POST",
                    url: editorPowerlineUpdateUrl(A.eins),
                    headers: { origin: TEST_ORIGIN },
                    payload: { operationId: randomUUID(), segments, name: "X" },
                })
            ).statusCode,
        ).toBe(401);
        expect((await schreibe(A.eins, { segments, name: "Reviewer" }, "reviewer")).statusCode).toBe(403);
        expect((await detail(A.eins)).name).toBe("K6 Probe");
    });

    it("🔴 Name, Beschriftung und Beschreibung gehen an ALLE Abschnitte; je Abschnitt eine Revision und ein Protokolleintrag", async () => {
        const segments = await stand(A.eins);
        const res = await schreibe(A.zwei, {
            segments,
            name: " K6 Linie ",
            labelVisible: false,
            description: "  Eine Ader. ",
        });
        expect(res.statusCode).toBe(200);
        const quittung = res.json<OperationReceipt>();
        expect(quittung.affected.map((a) => [a.id, a.revision])).toEqual(
            segments.map((s) => [s.id, s.baseRevision + 1]),
        );
        expect(quittung.warnings).toEqual([]);
        const nach = await detail(A.eins);
        expect(nach.name).toBe("K6 Linie");
        expect(nach.description).toBe("Eine Ader.");
        expect(nach.segments.map((s) => [s.labelVisible, s.description, s.revision])).toEqual([
            [false, "Eine Ader.", 2],
            [false, "Eine Ader.", 2],
        ]);
        const protokoll = await database<{ linie: string; changes: Record<string, unknown> }[]>`
            SELECT e.powerline_public_id::text AS linie, e.changes FROM map_audit_event e
              JOIN map_operation o USING (operation_id)
             WHERE o.operation_id = ${quittung.operationId} ORDER BY e.powerline_public_id
        `;
        expect(protokoll).toEqual([
            {
                linie: A.eins,
                changes: {
                    name: { before: "K6 Probe", after: "K6 Linie" },
                    // Getippt ist manual (WI-0225); das Protokoll nennt die Herkunft wie am Ort.
                    nameOrigin: { before: null, after: "manual" },
                    labelVisible: { before: true, after: false },
                    description: { before: null, after: "Eine Ader." },
                    descriptionOrigin: { before: null, after: "manual" },
                },
            },
            expect.objectContaining({ linie: A.zwei }),
        ]);
    });

    it("🔴 ein fehlendes Feld bleibt; eine leere Beschreibung löscht sie (NULL, kein Leerstring)", async () => {
        const res = await schreibe(A.eins, { segments: await stand(A.eins), description: "" });
        expect(res.statusCode).toBe(200);
        const [zeile] = await database<{ description: string | null; label_visible: boolean; name: string }[]>`
            SELECT description, label_visible, name FROM powerline WHERE public_id = ${A.eins}
        `;
        expect(zeile).toEqual({ description: null, label_visible: false, name: "K6 Linie" });
    });

    it("🔴 eine veraltete Revision oder ein inzwischen dazugekommener Abschnitt: 409, nichts geschrieben", async () => {
        const segments = await stand(A.eins);
        const veraltet = await schreibe(A.eins, {
            segments: segments.map((s, i) => (i === 0 ? { ...s, baseRevision: s.baseRevision - 1 } : s)),
            name: "Zu spät",
        });
        expect(veraltet.statusCode).toBe(409);
        expect(veraltet.json<{ error: { code: string; details: { currentRevision: number } } }>().error).toMatchObject({
            code: "edit_conflict",
            details: { currentRevision: segments[0]!.baseRevision },
        });
        // Ein dritter Abschnitt kommt dazu, den der Entwurf nicht kennt.
        await linie(A.drei, "K6 Linie");
        const unvollstaendig = await schreibe(A.eins, { segments, name: "Zu spät" });
        expect(unvollstaendig.statusCode).toBe(409);
        expect((await detail(A.eins)).name).toBe("K6 Linie");
    });

    it("🔴 Umbenennen auf einen vorhandenen Namen verschmilzt beide und sagt es; ein leerer Name ist ein Fehler", async () => {
        expect((await schreibe(A.eins, { segments: await stand(A.eins), name: "   " })).statusCode).toBe(400);
        const res = await schreibe(A.eins, { segments: await stand(A.eins), name: "K6 Fremd" });
        expect(res.statusCode).toBe(200);
        expect(res.json<OperationReceipt>().warnings.map((w) => w.code)).toEqual(["merged"]);
        expect((await detail(A.fremd)).segments.map((s) => s.id).sort()).toEqual(
            [A.eins, A.zwei, A.drei, A.fremd].sort(),
        );
    });

    it("🔴 K5: Ort verschieben zieht die Bahn der dort endenden Kraftlinie in derselben Operation nach, ohne ihre Revision", async () => {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, is_nodix, source_system)
            VALUES (${ORT}, 'aventuria', 'K6 Ort Nodix', 'dorf', ST_SetSRID(ST_MakePoint(400, 500), 0), TRUE, ${SOURCE}),
                   (${ZIEL}, 'aventuria', 'K6 Ort Ziel', 'dorf', ST_SetSRID(ST_MakePoint(460, 500), 0), TRUE, ${SOURCE})
        `;
        const linie = "b6b6b6b6-0000-4000-8000-0000000000e1";
        await database`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, curve, geom, drawn_geom, source_system)
            VALUES (${linie}, 'aventuria', 'K5 Bahn', ${ORT}, ${ZIEL}, 20,
                    ST_GeomFromText('LINESTRING(400 500, 460 500)', 0), ST_GeomFromText('LINESTRING(400 500, 460 500)', 0), ${SOURCE})
        `;
        const [ort] = await database<{ r: number }[]>`SELECT revision::int AS r FROM place WHERE public_id = ${ORT}`;
        const res = await app.inject({
            method: "POST",
            url: editorPlaceMoveUrl(ORT),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), baseRevision: ort!.r, to: { x: 410, y: 520 }, pathEnds: [] },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<OperationReceipt>().derivedWork.map((w) => w.kind)).toContain("powerline_path");
        const [bahn] = await database<
            { x0: number; y0: number; x1: number; y1: number; punkte: number; revision: number }[]
        >`
            SELECT ST_X(ST_StartPoint(drawn_geom)) AS x0, ST_Y(ST_StartPoint(drawn_geom)) AS y0, ST_X(ST_EndPoint(drawn_geom)) AS x1,
                   ST_Y(ST_EndPoint(drawn_geom)) AS y1, ST_NPoints(drawn_geom) AS punkte, revision::int AS revision
              FROM powerline WHERE public_id = ${linie}
        `;
        // Der Bogen bleibt (20 %: mehr als zwei Punkte), die Enden liegen an den Orten, die Revision zählt nicht.
        expect(bahn).toMatchObject({ x0: 410, y0: 520, x1: 460, y1: 500, revision: 1 });
        expect(bahn!.punkte).toBeGreaterThan(2);
    });

    it("🔴 K8: Bogen und umgehängtes Ende in derselben Operation; die Revision zählt einmal, die Bahn folgt; nur an einen Nodix", async () => {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, is_nodix, source_system)
            VALUES (${NODIX_ORT}, 'aventuria', 'K8 Nodix', 'dorf', ST_SetSRID(ST_MakePoint(500, 560), 0), TRUE, ${SOURCE}),
                   (${KEIN_NODIX}, 'aventuria', 'K8 Dorf', 'dorf', ST_SetSRID(ST_MakePoint(520, 560), 0), FALSE, ${SOURCE})
        `;
        const linie = "b6b6b6b6-0000-4000-8000-0000000000e1";
        // Die Ziele kennen den Nodix, nicht das Dorf ohne Merkmal.
        const ziele = await app.inject({
            method: "GET",
            url: editorPowerlineTargetsUrl(linie),
            headers: { cookie: cookies.get("editor") ?? "" },
        });
        expect(ziele.statusCode).toBe(200);
        const ids = ziele.json<EditorPowerlineTargets>().targets.map((z) => z.id);
        expect(ids).toContain(NODIX_ORT);
        expect(ids).not.toContain(KEIN_NODIX);

        const [vorher] = await stand(linie);
        const falsch = await schreibe(linie, { segments: [{ ...vorher!, to: KEIN_NODIX }] });
        expect(falsch.statusCode).toBe(400);
        const gleich = await schreibe(linie, { segments: [{ ...vorher!, to: ORT }] });
        expect(gleich.statusCode).toBe(400);

        const res = await schreibe(linie, { segments: [{ ...vorher!, curve: -12, to: NODIX_ORT }] });
        expect(res.statusCode).toBe(200);
        expect(res.json<OperationReceipt>().derivedWork.map((w) => w.kind)).toContain("powerline_path");
        const [nach] = await database<{ to: string; curve: number; revision: number; x1: number; y1: number }[]>`
            SELECT to_public_id::text AS to, curve, revision::int AS revision,
                   ST_X(ST_EndPoint(drawn_geom)) AS x1, ST_Y(ST_EndPoint(drawn_geom)) AS y1
              FROM powerline WHERE public_id = ${linie}
        `;
        expect(nach).toEqual({ to: NODIX_ORT, curve: -12, revision: vorher!.baseRevision + 1, x1: 500, y1: 560 });
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE e.powerline_public_id = ${linie} AND o.action = 'powerline.update_line' ORDER BY e.id DESC LIMIT 1
        `;
        expect(eintrag?.changes).toEqual({ curve: { before: 20, after: -12 }, to: { before: ZIEL, after: NODIX_ORT } });

        // ajv-Falle (Befund der Koordination 2026-10-19): `null` nimmt den Bogen weg und bleibt NULL, in der Tafel und im Verlauf, nicht 0.
        const [jetzt] = await stand(linie);
        const ohneBogen = await schreibe(linie, { segments: [{ ...jetzt!, curve: null }] });
        expect(ohneBogen.statusCode).toBe(200);
        const [gerade] = await database<
            { curve: number | null }[]
        >`SELECT curve FROM powerline WHERE public_id = ${linie}`;
        expect(gerade?.curve).toBeNull();
        const [rueck] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE e.powerline_public_id = ${linie} AND o.action = 'powerline.update_line' ORDER BY e.id DESC LIMIT 1
        `;
        expect(rueck?.changes).toEqual({ curve: { before: -12, after: null } });
        // Und umgekehrt: Eine echte 0 bleibt 0, nicht `null` (Berichtigung der Koordination: „null zuerst“ machte aus 0 ein null).
        const [danach] = await stand(linie);
        expect((await schreibe(linie, { segments: [{ ...danach!, curve: 0 }] })).statusCode).toBe(200);
        const [null0] = await database<
            { curve: number | null }[]
        >`SELECT curve FROM powerline WHERE public_id = ${linie}`;
        expect(null0?.curve).toBe(0);
        const [null0Protokoll] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE e.powerline_public_id = ${linie} AND o.action = 'powerline.update_line' ORDER BY e.id DESC LIMIT 1
        `;
        expect(null0Protokoll?.changes).toEqual({ curve: { before: null, after: 0 } });
    });

    it("🔴 T39: Kraftlinie entfernen legt alle Abschnitte still (weich), mit Protokoll; eine veraltete Revision ist ein 409", async () => {
        const linie = "b6b6b6b6-0000-4000-8000-0000000000e1";
        const segments = (await stand(linie)).map((s) => ({ id: s.id, baseRevision: s.baseRevision }));
        const post = (body: Record<string, unknown>) =>
            app.inject({
                method: "POST",
                url: editorPowerlineRetireUrl(linie),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: body,
            });
        const veraltet = await post({
            operationId: randomUUID(),
            segments: segments.map((s) => ({ ...s, baseRevision: s.baseRevision - 1 })),
        });
        expect(veraltet.statusCode).toBe(409);
        expect((await post({ operationId: randomUUID(), segments })).statusCode).toBe(200);
        const [zeile] = await database<
            { aktiv: boolean }[]
        >`SELECT is_active AS aktiv FROM powerline WHERE public_id = ${linie}`;
        expect(zeile?.aktiv).toBe(false);
        const [eintrag] = await database<{ changes: unknown }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE e.powerline_public_id = ${linie} AND o.action = 'powerline.retire'
        `;
        expect(eintrag?.changes).toEqual({ active: { before: true, after: false } });
        // Schon gelöscht: Ein zweites Löschen sagt, wo die Linie steht (400, wie bei Wegen; K10).
        expect((await post({ operationId: randomUUID(), segments })).statusCode).toBe(400);
    });

    it("🔴 K9: Neue Kraftlinie von Nodix zu Nodix, „A - B“, gerade, EINE Operation; angefügt erbt sie die Felder der Linie", async () => {
        const kopf = { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN };
        const post = (body: Record<string, unknown>, role: Role = "editor") =>
            app.inject({
                method: "POST",
                url: EDITOR_POWERLINES_URL,
                headers: { ...kopf, cookie: cookies.get(role) ?? "" },
                payload: { operationId: randomUUID(), ...body },
            });
        // Die Ziele ohne Linie: dieselben Nodices, kein Dorf ohne Merkmal.
        const ziele = await app.inject({ method: "GET", url: EDITOR_POWERLINE_TARGETS_URL, headers: kopf });
        expect(ziele.statusCode).toBe(200);
        const ids = ziele.json<EditorPowerlineTargets>().targets.map((z) => z.id);
        expect(ids).toEqual(expect.arrayContaining([ORT, NODIX_ORT]));
        expect(ids).not.toContain(KEIN_NODIX);

        expect((await post({ from: ORT, to: KEIN_NODIX })).statusCode).toBe(400);
        expect((await post({ from: ORT, to: ORT })).statusCode).toBe(400);
        expect((await post({ from: ORT, to: NODIX_ORT }, "reviewer")).statusCode).toBe(403);
        const [vorher] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM powerline WHERE source_system = 'avesmaps3d' AND from_public_id = ${ORT}
        `;
        expect(vorher?.n).toBe(0);

        const operationId = randomUUID();
        const res = await post({ operationId, from: ORT, to: NODIX_ORT });
        expect(res.statusCode).toBe(200);
        const quittung = res.json<PowerlineCreateReceipt>();
        expect(quittung.name).toBe("K6 Ort Nodix - K8 Nodix");
        expect(quittung.derivedWork.map((w) => w.kind)).toContain("powerline_path");
        const [neu] = await database<
            {
                name: string;
                von: string;
                nach: string;
                curve: number | null;
                label: boolean;
                revision: number;
                punkte: number;
                x0: number;
                x1: number;
            }[]
        >`
            SELECT name, from_public_id::text AS von, to_public_id::text AS nach, curve, label_visible AS label, revision::int AS revision,
                   ST_NPoints(drawn_geom) AS punkte, ST_X(ST_StartPoint(drawn_geom)) AS x0, ST_X(ST_EndPoint(drawn_geom)) AS x1
              FROM powerline WHERE public_id = ${quittung.publicId}
        `;
        // Gerade (kein Bogen: zwei Punkte), von der Lage der Orte aus (der Ort wurde in K5 auf x 410 verschoben).
        expect(neu).toEqual({
            name: "K6 Ort Nodix - K8 Nodix",
            von: ORT,
            nach: NODIX_ORT,
            curve: null,
            label: false,
            revision: 1,
            punkte: 2,
            x0: 410,
            x1: 500,
        });
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE e.powerline_public_id = ${quittung.publicId} AND o.action = 'powerline.create'
        `;
        expect(eintrag?.changes).toEqual({
            name: { after: "K6 Ort Nodix - K8 Nodix" },
            from: { after: ORT },
            to: { after: NODIX_ORT },
            active: { after: true },
        });
        // Dieselbe Kennung noch einmal: dieselbe Quittung, kein zweiter Abschnitt.
        const wieder = await post({ operationId, from: ORT, to: NODIX_ORT });
        expect(wieder.json<PowerlineCreateReceipt>().publicId).toBe(quittung.publicId);

        // „Nodix anfügen“: Mit dem Namen einer Linie schließt der Abschnitt an sie an und erbt Beschriftung und Beschreibung.
        await database`
            INSERT INTO powerline (public_id, map_domain_id, name, label_visible, description, from_public_id, to_public_id, geom,
                                   drawn_geom, source_system)
            VALUES (${randomUUID()}, 'aventuria', 'K9 Linie', TRUE, 'Alt', ${randomUUID()}, ${randomUUID()},
                    ST_GeomFromText('LINESTRING(100 600, 300 600)', 0), ST_GeomFromText('LINESTRING(100 600, 300 600)', 0), ${SOURCE})
        `;
        const an = await post({ from: NODIX_ORT, to: ZIEL, name: "K9 Linie" });
        expect(an.statusCode).toBe(200);
        const [angefuegt] = await database<{ name: string; label: boolean; beschreibung: string | null }[]>`
            SELECT name, label_visible AS label, description AS beschreibung FROM powerline
             WHERE public_id = ${an.json<PowerlineCreateReceipt>().publicId}
        `;
        expect(angefuegt).toEqual({ name: "K9 Linie", label: true, beschreibung: "Alt" });
    });

    it("🔴 K9: Neuer Kraftlinienpunkt an einer Stelle, eine Abzweigung ohne Namen, EINE Operation; danach ein Ziel für eine Linie", async () => {
        const post = (body: Record<string, unknown>, role: Role = "editor") =>
            app.inject({
                method: "POST",
                url: EDITOR_NODICES_URL,
                headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
                payload: { operationId: randomUUID(), ...body },
            });
        expect((await post({ x: 530, y: 540 }, "reviewer")).statusCode).toBe(403);
        expect((await post({ x: -100_000, y: 540 })).statusCode).toBe(400);
        const res = await post({ x: 530, y: 540 });
        expect(res.statusCode).toBe(200);
        const punkt = res.json<NodixCreateReceipt>().publicId;
        neuePunkte.push(punkt);
        const [zeile] = await database<{ art: string; quelle: string; aktiv: boolean; x: number; y: number }[]>`
            SELECT legacy_kind AS art, source_system AS quelle, is_active AS aktiv, ST_X(geom) AS x, ST_Y(geom) AS y
              FROM nodix WHERE public_id = ${punkt}
        `;
        expect(zeile).toEqual({ art: "junction", quelle: "avesmaps3d", aktiv: true, x: 530, y: 540 });
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE e.nodix_public_id = ${punkt} AND o.action = 'nodix.create'
        `;
        expect(eintrag?.changes).toEqual({
            position: { after: [530, 540] },
            kind: { after: "junction" },
            active: { after: true },
        });
        // Der neue Punkt ist sofort ein Ziel: eine Kraftlinie von einem Nodix-Ort zu ihm, „K8 Nodix - Nodix“.
        const linie = await app.inject({
            method: "POST",
            url: EDITOR_POWERLINES_URL,
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), from: NODIX_ORT, to: punkt },
        });
        expect(linie.statusCode).toBe(200);
        expect(linie.json<PowerlineCreateReceipt>().name).toBe("K8 Nodix - Nodix");
    });

    it("🔴 Verlauf der Linie: jede Operation an einem ihrer Abschnitte, neueste zuerst; ↺ schreibt mit `reverts` die Quelle restore", async () => {
        const verlauf = async (id: string) =>
            app.inject({
                method: "GET",
                url: editorPowerlineHistoryUrl(id),
                headers: { cookie: cookies.get("editor") ?? "" },
            });
        expect((await verlauf(V.zwei)).json<MapHistoryPage>().entries).toEqual([]);
        expect((await verlauf(`${P}000000000079`)).statusCode).toBe(404);

        const erst = await schreibe(V.eins, { segments: await stand(V.eins), name: "K6 Verlauf neu" });
        expect(erst.statusCode).toBe(200);
        const op = erst.json<OperationReceipt>().operationId;
        // Über den zweiten Abschnitt gefragt: dieselbe Linie, derselbe Verlauf.
        const nachher = (await verlauf(V.zwei)).json<MapHistoryPage>();
        expect(nachher.entries).toHaveLength(1);
        expect(nachher.entries[0]).toMatchObject({
            operationId: op,
            operation: "powerline.update_line",
            source: "editor",
        });
        expect(nachher.entries[0]!.objects).toEqual([
            expect.objectContaining({
                kind: "powerline",
                id: V.eins,
                name: "K6 Verlauf neu",
                changes: {
                    name: { before: "K6 Verlauf", after: "K6 Verlauf neu" },
                    nameOrigin: { before: null, after: "manual" },
                },
            }),
            expect.objectContaining({ kind: "powerline", id: V.zwei }),
        ]);

        const zurueck = await schreibe(V.eins, { segments: await stand(V.eins), name: "K6 Verlauf", reverts: op });
        expect(zurueck.statusCode).toBe(200);
        const beide = (await verlauf(V.eins)).json<MapHistoryPage>().entries;
        expect(beide.map((e) => [e.source, e.summary])).toEqual([
            ["restore", "Kraftlinie „K6 Verlauf“: Änderung zurückgenommen"],
            ["editor", "Kraftlinie „K6 Verlauf neu“: Felder"],
        ]);
        expect((await detail(V.eins)).name).toBe("K6 Verlauf");
    });

    describe("R5 und K10: Nodix herausnehmen und anfügen, Entfernen in zwei Stufen", () => {
        const kopf = () => ({ cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN });
        const wechsel = (url: string, segments: { id: string; baseRevision: number }[], reverts?: string) =>
            app.inject({
                method: "POST",
                url,
                headers: kopf(),
                payload: { operationId: randomUUID(), segments, ...(reverts !== undefined ? { reverts } : {}) },
            });
        const abschnitt = (id: string, von: string, nach: string) => database`
            INSERT INTO powerline (public_id, map_domain_id, name, label_visible, description, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${id}, 'aventuria', 'K10 Ader', TRUE, 'Eine Ader.', ${von}, ${nach},
                    ST_GeomFromText('LINESTRING(100 520, 300 520)', 0), ST_GeomFromText('LINESTRING(100 520, 300 520)', 0), ${SOURCE})
        `;
        const liste = async () =>
            (
                await app.inject({
                    method: "GET",
                    url: EDITOR_POWERLINES_URL,
                    headers: { cookie: cookies.get("editor") ?? "" },
                })
            ).json<EditorPowerlineList>();

        beforeAll(async () => {
            for (const [id, x] of [
                [N.b, 600],
                [N.c, 620],
                [N.d, 640],
                [N.e, 660],
            ] as const)
                await database`
                    INSERT INTO place (public_id, map_domain_id, name, subtype, geom, is_nodix, source_system)
                    VALUES (${id}, 'aventuria', ${`K10 Ort ${id.slice(-2)}`}, 'dorf', ST_SetSRID(ST_MakePoint(${x}, 520), 0), TRUE, ${SOURCE})
                `;
            await abschnitt(R.eins, N.b, N.c);
            await abschnitt(R.zwei, N.c, N.d);
        });

        it("🔴 Herausnehmen verbindet die Nachbarn (B–C–D ohne C ist B–D) und Anfügen erbt die Felder, in EINER Operation", async () => {
            const res = await schreibe(R.eins, {
                segments: [
                    { id: R.eins, baseRevision: 1, to: N.d },
                    { id: R.zwei, baseRevision: 1, remove: true },
                ],
                add: [{ from: N.d, to: N.e, curve: 10 }],
            });
            expect(res.statusCode).toBe(200);
            const quittung = res.json<OperationReceipt>();
            const linie = await detail(R.eins);
            expect(linie.segments.map((a) => [a.from, a.to])).toEqual(
                expect.arrayContaining([
                    [N.b, N.d],
                    [N.d, N.e],
                ]),
            );
            expect(linie.segments).toHaveLength(2);
            const neu = linie.segments.find((a) => a.from === N.d)!;
            expect(neu).toMatchObject({ curve: 10, labelVisible: true, description: "Eine Ader." });
            // Die Quittung nennt, was die Linie danach hat: ohne den herausgenommenen, mit dem angefügten.
            expect(quittung.affected.map((a) => a.id).sort()).toEqual([R.eins, neu.id].sort());
            const [zwei] = await database<{ is_active: boolean; off_map: boolean }[]>`
                SELECT is_active, off_map FROM powerline WHERE public_id = ${R.zwei}
            `;
            expect(zwei).toEqual({ is_active: false, off_map: false });
            const protokoll = await database<{ action: string }[]>`
                SELECT action FROM map_audit_event WHERE operation_id = ${quittung.operationId} ORDER BY action
            `;
            expect(protokoll.map((e) => e.action)).toEqual([
                "powerline.created",
                "powerline.removed",
                "powerline.updated",
            ]);
        });

        it("🔴 die Linie behält mindestens einen Abschnitt; ein angefügtes Ende muss ein Nodix sein", async () => {
            const segments = await stand(R.eins);
            const alle = await schreibe(R.eins, { segments: segments.map((a) => ({ ...a, remove: true as const })) });
            expect(alle.statusCode).toBe(400);
            const fremd = await schreibe(R.eins, { segments, add: [{ from: N.b, to: KEIN_NODIX }] });
            expect(fremd.statusCode).toBe(400);
        });

        it("🔴 ↺ an Herausnehmen und Anfügen: der herausgenommene Abschnitt kommt zurück (`revive`), der angefügte entfällt, in EINER Operation", async () => {
            const [raus] = await database<{ operation_id: string; revision_after: number }[]>`
                SELECT operation_id::text AS operation_id, revision_after::int AS revision_after FROM map_audit_event
                 WHERE powerline_public_id = ${R.zwei} AND action = 'powerline.removed' ORDER BY id DESC LIMIT 1
            `;
            const vorher = await detail(R.eins);
            const zurueck = vorher.segments.map((a) =>
                a.id === R.eins
                    ? { id: a.id, baseRevision: a.revision, to: N.c }
                    : { id: a.id, baseRevision: a.revision, remove: true as const },
            );
            // Seither verändert (andere Revision): Konflikt, nichts geschrieben. Ein Abschnitt auf der Karte kommt nicht „zurück“.
            const veraltet = await schreibe(R.eins, {
                segments: zurueck,
                revive: [{ id: R.zwei, baseRevision: raus!.revision_after + 1 }],
                reverts: raus!.operation_id,
            });
            expect(veraltet.statusCode).toBe(409);
            const aufDerKarte = await schreibe(R.eins, {
                segments: await stand(R.eins),
                revive: [{ id: R.eins, baseRevision: vorher.segments.find((a) => a.id === R.eins)!.revision }],
            });
            expect(aufDerKarte.statusCode).toBe(400);

            const res = await schreibe(R.eins, {
                segments: zurueck,
                revive: [{ id: R.zwei, baseRevision: raus!.revision_after }],
                reverts: raus!.operation_id,
            });
            expect(res.statusCode).toBe(200);
            const quittung = res.json<OperationReceipt>();
            const linie = await detail(R.eins);
            expect(linie.segments.map((a) => [a.id, a.from, a.to]).sort()).toEqual([
                [R.eins, N.b, N.c],
                [R.zwei, N.c, N.d],
            ]);
            expect(linie.segments.find((a) => a.id === R.zwei)).toMatchObject({
                labelVisible: true,
                description: "Eine Ader.",
            });
            expect(quittung.affected.map((a) => a.id).sort()).toEqual([R.eins, R.zwei]);
            const protokoll = await database<{ action: string }[]>`
                SELECT action FROM map_audit_event WHERE operation_id = ${quittung.operationId} ORDER BY action
            `;
            expect(protokoll.map((e) => e.action)).toEqual([
                "powerline.removed",
                "powerline.revived",
                "powerline.updated",
            ]);
            const [operation] = await database<{ source: string }[]>`
                SELECT source FROM map_operation WHERE operation_id = ${quittung.operationId}
            `;
            expect(operation?.source).toBe("restore");
            // Die Bahn des zurückgekommenen Abschnitts ist neu gerechnet (vom Ort C zum Ort D).
            const [bahn] = await database<{ x0: number; x1: number }[]>`
                SELECT ST_X(ST_StartPoint(drawn_geom)) AS x0, ST_X(ST_EndPoint(drawn_geom)) AS x1 FROM powerline WHERE public_id = ${R.zwei}
            `;
            expect(bahn).toEqual({ x0: 620, x1: 640 });
        });

        it("🔴 K10: von der Karte nehmen bleibt in der Liste (offMap, leerer Kreis), zurück, ganz löschen weich, zurückholen; alles im Verlauf", async () => {
            const ab = await wechsel(editorPowerlineTakeOffMapUrl(R.eins), await stand(R.eins));
            expect(ab.statusCode).toBe(200);
            const zeile = (await liste()).rows.find((r) => r.name === "K10 Ader" && r.deleted !== true);
            expect(zeile).toMatchObject({ offMap: true, circle: "leer" });
            expect((await detail(R.eins)).state).toBe("abgenommen");
            // Abgenommen schreibt update nicht (404), und ein zweites Abnehmen sagt, wo die Linie steht.
            expect((await schreibe(R.eins, { segments: await stand(R.eins), name: "x" })).statusCode).toBe(404);
            expect((await wechsel(editorPowerlineTakeOffMapUrl(R.eins), await stand(R.eins))).statusCode).toBe(400);

            const auf = await wechsel(editorPowerlinePutOnMapUrl(R.eins), await stand(R.eins));
            expect(auf.statusCode).toBe(200);
            expect((await detail(R.eins)).state).toBeUndefined();

            const weg = await wechsel(editorPowerlineRetireUrl(R.eins), await stand(R.eins));
            expect(weg.statusCode).toBe(200);
            expect((await detail(R.eins)).state).toBe("geloescht");
            // Ganz gelöscht steht sie nur noch unter „Gelöscht“ (EDIT-0003 T54).
            expect((await liste()).rows.filter((r) => r.name === "K10 Ader").every((r) => r.deleted === true)).toBe(
                true,
            );

            const zurueck = await wechsel(
                editorPowerlineRestoreUrl(R.eins),
                await stand(R.eins),
                weg.json<OperationReceipt>().operationId,
            );
            expect(zurueck.statusCode).toBe(200);
            expect((await detail(R.eins)).state).toBeUndefined();
            const verlauf = (
                await app.inject({ method: "GET", url: editorPowerlineHistoryUrl(R.eins), headers: kopf() })
            ).json<MapHistoryPage>();
            expect(verlauf.entries.slice(0, 4).map((e) => [e.operation, e.source])).toEqual([
                ["powerline.restore", "restore"],
                ["powerline.retire", "editor"],
                ["powerline.put_on_map", "editor"],
                ["powerline.take_off_map", "editor"],
            ]);
        });

        it("🔴 ein Kraftlinienpunkt geht nur ohne Linie, auch eine abgenommene zählt", async () => {
            const punkt = await app.inject({
                method: "POST",
                url: EDITOR_NODICES_URL,
                headers: kopf(),
                payload: { operationId: randomUUID(), x: 680, y: 520 },
            });
            const id = punkt.json<NodixCreateReceipt>().publicId;
            neuePunkte.push(id);
            const angefuegt = await schreibe(R.eins, { segments: await stand(R.eins), add: [{ from: N.e, to: id }] });
            expect(angefuegt.statusCode).toBe(200);
            const revision = async () =>
                (await database<{ r: number }[]>`SELECT revision::int AS r FROM nodix WHERE public_id = ${id}`)[0]!.r;
            const weg = async () =>
                app.inject({
                    method: "POST",
                    url: editorNodixRetireUrl(id),
                    headers: kopf(),
                    payload: { operationId: randomUUID(), baseRevision: await revision() },
                });
            // Die Nodices nennen die Revision des Kraftlinienpunkts, gegen die „Kraftlinienpunkt entfernen“ schreibt (EDIT-0003 T52).
            const ziele = await app.inject({
                method: "GET",
                url: EDITOR_POWERLINE_TARGETS_URL,
                headers: { cookie: cookies.get("editor") ?? "" },
            });
            expect(ziele.json<EditorPowerlineTargets>().targets.find((z) => z.id === id)).toMatchObject({
                kind: "nodix",
                revision: await revision(),
            });
            expect((await weg()).statusCode).toBe(400);
            expect((await wechsel(editorPowerlineTakeOffMapUrl(R.eins), await stand(R.eins))).statusCode).toBe(200);
            expect((await weg()).statusCode).toBe(400);
            expect((await wechsel(editorPowerlineRetireUrl(R.eins), await stand(R.eins))).statusCode).toBe(200);
            const ok = await weg();
            expect(ok.statusCode).toBe(200);
            const [zeile] = await database<
                { is_active: boolean }[]
            >`SELECT is_active FROM nodix WHERE public_id = ${id}`;
            expect(zeile?.is_active).toBe(false);
        });
    });

    describe("K11: fremde Sperre an der Linie (EDIT-0003 §4)", () => {
        const S = { eins: `${P}0000000000b1`, zwei: `${P}0000000000b2` };
        const kopf = () => ({ cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN });
        const sperre = (person: string, name: string) => database`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('powerline', ${S.eins}::uuid, 'form', ${person}::uuid, ${name}, gen_random_uuid())
        `;
        const frei = () =>
            database`DELETE FROM editor_lock WHERE object_kind = 'powerline' AND object_id = ${S.eins}::uuid`;
        let anderer = "";
        beforeAll(async () => {
            await linie(S.eins, "K11 Ader");
            await linie(S.zwei, "K11 Ader");
            anderer = (await fixture.person("editor", { name: "Kraftlinie anderer" })).id;
        });
        afterAll(frei);

        it("🔴 hält ein anderer die Linie, schreiben Felder, Stand und Anfügen nicht (409 object_locked); die eigene Sperre hält nicht auf", async () => {
            await sperre(anderer, "Kraftlinie anderer");
            // Über einen beliebigen Abschnitt: gesperrt ist der Anker, die Sperre nennt alle Abschnitte (`sections`).
            const felder = await schreibe(S.zwei, { segments: await stand(S.zwei), name: "K11 Neu" });
            expect(felder.statusCode).toBe(409);
            expect(
                felder.json<{ error: { code: string; details: { lock: { id: string; sections?: string[] } } } }>()
                    .error,
            ).toMatchObject({ code: "object_locked", details: { lock: { id: S.eins, sections: [S.eins, S.zwei] } } });
            const ab = await app.inject({
                method: "POST",
                url: editorPowerlineTakeOffMapUrl(S.eins),
                headers: kopf(),
                payload: { operationId: randomUUID(), segments: await stand(S.eins) },
            });
            expect(ab.statusCode).toBe(409);
            const an = await app.inject({
                method: "POST",
                url: EDITOR_POWERLINES_URL,
                headers: kopf(),
                payload: { operationId: randomUUID(), from: N.b, to: N.c, name: "K11 Ader" },
            });
            expect(an.statusCode).toBe(409);
            const linieJetzt = await detail(S.eins);
            expect(linieJetzt.name).toBe("K11 Ader");
            expect(linieJetzt.state).toBeUndefined();
            expect(linieJetzt.segments).toHaveLength(2);
            // Die eigene Sperre hält nicht auf.
            await frei();
            await sperre(personen.get("editor")!, "Kraftlinie editor");
            expect((await schreibe(S.eins, { segments: await stand(S.eins), name: "K11 Neu" })).statusCode).toBe(200);
        });
    });

    describe("K5: nodix.move", () => {
        const kopf = () => ({ cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN });
        const revision = async (id: string) =>
            (await database<{ r: number }[]>`SELECT revision::int AS r FROM nodix WHERE public_id = ${id}`)[0]!.r;
        const verschiebe = (id: string, baseRevision: number, x: number, y: number) =>
            app.inject({
                method: "POST",
                url: editorNodixMoveUrl(id),
                headers: kopf(),
                payload: { operationId: randomUUID(), baseRevision, x, y },
            });

        it("🔴 ein Kraftlinienpunkt wandert, die Bahn der Linie an ihm folgt in derselben Operation; veraltet 409, außerhalb 400", async () => {
            const punkt = (
                await app.inject({
                    method: "POST",
                    url: EDITOR_NODICES_URL,
                    headers: kopf(),
                    payload: { operationId: randomUUID(), x: 700, y: 540 },
                })
            ).json<NodixCreateReceipt>().publicId;
            neuePunkte.push(punkt);
            const linie = await app.inject({
                method: "POST",
                url: EDITOR_POWERLINES_URL,
                headers: kopf(),
                payload: { operationId: randomUUID(), from: N.b, to: punkt },
            });
            expect(linie.statusCode).toBe(200);
            const vorher = await revision(punkt);
            expect((await verschiebe(punkt, vorher + 1, 710, 560)).statusCode).toBe(409);
            expect((await verschiebe(punkt, vorher, -1e9, 560)).statusCode).toBe(400);
            const res = await verschiebe(punkt, vorher, 710, 560);
            expect(res.statusCode).toBe(200);
            expect(res.json<OperationReceipt>().derivedWork).toContainEqual({ kind: "powerline_path", state: "done" });
            expect(await revision(punkt)).toBeGreaterThan(vorher);
            const [bahn] = await database<{ x: number; y: number }[]>`
                SELECT ST_X(ST_EndPoint(drawn_geom)) AS x, ST_Y(ST_EndPoint(drawn_geom)) AS y FROM powerline
                 WHERE to_public_id = ${punkt}::uuid AND is_active
            `;
            expect(bahn).toEqual({ x: 710, y: 560 });
            const [protokoll] = await database<{ action: string; changes: unknown }[]>`
                SELECT action, changes FROM map_audit_event WHERE operation_id = ${res.json<OperationReceipt>().operationId}
            `;
            expect(protokoll).toEqual({
                action: "nodix.moved",
                changes: { position: { before: [700, 540], after: [710, 560] } },
            });
        });
    });

    describe("Wiki-Artikel je Linie (WI-0205, wie Legacy)", () => {
        const W = { eins: `${P}0000000000c1`, zwei: `${P}0000000000c2` };
        const SCHLUESSEL = "k6-testader-artikel";
        const URL = "https://de.wiki-aventurica.de/wiki/K6_Testader";
        const lies = (url: string) =>
            app.inject({ method: "GET", url, headers: { cookie: cookies.get("editor") ?? "" } });
        const zuordnung = () => database<
            { id: string; aktiv: boolean; herkunft: string; schluessel: boolean | null }[]
        >`
            SELECT p.public_id::text AS id, w.is_active AS aktiv, w.assignment_origin AS herkunft,
                   (SELECT k.is_active FROM wiki_key_assignment k WHERE k.legacy_art = 'kraftlinie' AND k.object_public_id = p.public_id)
                       AS schluessel
              FROM powerline p JOIN powerline_wiki_assignment w ON w.powerline_id = p.id
             WHERE p.public_id = ANY(${[W.eins, W.zwei]}::uuid[]) ORDER BY p.public_id
        `;
        let abzug = "";

        beforeAll(async () => {
            await linie(W.eins, "K6 Testader");
            await linie(W.zwei, "K6 Testader");
            abzug = (
                await database<{ id: string }[]>`
                    INSERT INTO wiki_powerline_snapshot (wiki_key, wiki_url, name, description, staerke, affinitaet, laenge, regionen)
                    VALUES (${SCHLUESSEL}, ${URL}, 'K6 Testader', 'Eine Ader im Kosch.', 'mittel', NULL, '30 Meilen', 'Kosch')
                    RETURNING id::text
                `
            )[0]!.id;
            // Teilzuordnung: nur der erste Abschnitt trägt den Artikel.
            await database`
                INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
                SELECT id, ${URL}, ${abzug}::bigint, 'assigned', 'unknown' FROM powerline WHERE public_id = ${W.eins}::uuid
            `;
        });
        afterAll(async () => {
            await database`
                DELETE FROM powerline_wiki_assignment WHERE powerline_id IN (SELECT id FROM powerline WHERE public_id = ANY(${[W.eins, W.zwei]}::uuid[]))
            `;
            await database`DELETE FROM wiki_key_assignment WHERE object_public_id = ANY(${[W.eins, W.zwei]}::uuid[])`;
            await database`DELETE FROM wiki_powerline_snapshot WHERE wiki_key = ${SCHLUESSEL}`;
            await database`DELETE FROM field_origin WHERE object_kind = 'powerline' AND object_id = ANY(${[W.eins, W.zwei]}::uuid[])`;
        });

        it("🔴 die Liste nennt den Artikel mit Werten und der Linie, an der er hängt; das Detail den Artikel der Linie und die Teilzuordnung", async () => {
            const liste = (await lies(EDITOR_POWERLINE_WIKI_URL)).json<WikiTrefferListe>();
            expect(liste.articles.find((a) => a.key === SCHLUESSEL)).toEqual({
                key: SCHLUESSEL,
                url: URL,
                name: "K6 Testader",
                werte: {
                    name: "K6 Testader",
                    description: "Eine Ader im Kosch.",
                    staerke: "mittel",
                    affinitaet: null,
                    laenge: "30 Meilen",
                    regionen: "Kosch",
                },
                belegt: "K6 Testader",
            });
            const linieJetzt = await detail(W.zwei);
            expect(linieJetzt.article).toMatchObject({
                key: SCHLUESSEL,
                name: "K6 Testader",
                werte: { name: "K6 Testader", description: "Eine Ader im Kosch." },
            });
            expect(linieJetzt.articleSegments).toBe(1);
        });

        it("🔴 Zuweisen schreibt den Artikel an ALLE Abschnitte (Herkunft editor), Lösen legt beide Zuordnungen still; unbekannt 400", async () => {
            expect(
                (await schreibe(W.eins, { segments: await stand(W.eins), wiki: { key: "gibt-es-nicht" } })).statusCode,
            ).toBe(400);
            const zu = await schreibe(W.eins, { segments: await stand(W.eins), wiki: { key: SCHLUESSEL } });
            expect(zu.statusCode).toBe(200);
            expect(await zuordnung()).toEqual([
                { id: W.eins, aktiv: true, herkunft: "editor", schluessel: true },
                { id: W.zwei, aktiv: true, herkunft: "editor", schluessel: true },
            ]);
            expect((await detail(W.eins)).articleSegments).toBeUndefined();
            const [protokoll] = await database<{ changes: unknown }[]>`
                SELECT changes FROM map_audit_event WHERE operation_id = ${zu.json<OperationReceipt>().operationId}
                   AND powerline_public_id = ${W.zwei}::uuid
            `;
            expect(protokoll?.changes).toEqual({ wiki: { before: null, after: SCHLUESSEL } });
            // B-2: Der Schlüssel der Zuordnung trägt seinen Namensraum nach dem Titel hinter der Adresse (Hauptraum), an allen Abschnitten.
            const raeume = await database<{ ns: number | null; ns_name: string | null }[]>`
                SELECT ns, ns_name FROM wiki_key_assignment
                 WHERE legacy_art = 'kraftlinie' AND object_public_id = ANY(${[W.eins, W.zwei]}::uuid[]) AND is_active
            `;
            expect(raeume).toEqual([
                { ns: 0, ns_name: "" },
                { ns: 0, ns_name: "" },
            ]);

            const los = await schreibe(W.eins, { segments: await stand(W.eins), wiki: null });
            expect(los.statusCode).toBe(200);
            expect((await zuordnung()).map((z) => [z.aktiv, z.schluessel])).toEqual([
                [false, false],
                [false, false],
            ]);
            expect((await detail(W.eins)).article).toBeUndefined();
        });

        it("🔴 Herkunft je Abschnitt (WI-0225): Getipptes ist manual; ↺ setzt den Wiki-Namen, leert die Beschreibung, wiki an allen", async () => {
            expect(
                (await schreibe(W.eins, { segments: await stand(W.eins), wiki: { key: SCHLUESSEL } })).statusCode,
            ).toBe(200);
            const getippt = await schreibe(W.eins, {
                segments: await stand(W.eins),
                name: "K6 Eigenname",
                description: "Von Hand.",
            });
            expect(getippt.statusCode).toBe(200);
            expect((await detail(W.eins)).segments.map((a) => a.herkunft)).toEqual([
                { name: "manual", description: "manual" },
                { name: "manual", description: "manual" },
            ]);
            const zurueck = await schreibe(W.eins, {
                segments: await stand(W.eins),
                name: { revert: "wiki" },
                description: { revert: "wiki" },
            });
            expect(zurueck.statusCode).toBe(200);
            const nachher = await detail(W.eins);
            expect(nachher.name).toBe("K6 Testader");
            // Leer folgt die Beschreibung dem Wiki (Legacy „Handgetipptes schlägt Wiki“): Die eigene Spalte ist an allen Abschnitten leer.
            expect(nachher.description).toBeUndefined();
            expect(
                await database<{ description: string | null }[]>`
                    SELECT description FROM powerline WHERE public_id = ANY(${[W.eins, W.zwei]}::uuid[]) ORDER BY public_id
                `,
            ).toEqual([{ description: null }, { description: null }]);
            expect(nachher.segments.map((a) => a.herkunft)).toEqual([
                { name: "wiki", description: "wiki" },
                { name: "wiki", description: "wiki" },
            ]);
            // Das Protokoll nennt die Herkunft wie am Ort (WI-0225 Nachtrag 2): vorher manual, nachher wiki, je Abschnitt.
            const [protokoll] = await database<{ changes: Record<string, unknown> }[]>`
                SELECT changes FROM map_audit_event
                 WHERE operation_id = ${zurueck.json<OperationReceipt>().operationId} AND powerline_public_id = ${W.zwei}::uuid
            `;
            expect(protokoll?.changes).toMatchObject({
                nameOrigin: { before: "manual", after: "wiki" },
                descriptionOrigin: { before: "manual", after: "wiki" },
            });
            // Ein leer getippter Text geht durch (Typliste string|null neben ↺, ajv-Befund 2026-10-19), leert die Spalte (leer folgt dem
            // Wiki) und ist getippt: Herkunft manual. Ob er als "" oder null ankommt, ändert hier nichts: beides heißt „keine eigene“.
            const leer = await schreibe(W.eins, { segments: await stand(W.eins), description: "Wieder eigen." });
            expect(leer.statusCode).toBe(200);
            const geleert = await schreibe(W.eins, { segments: await stand(W.eins), description: "" });
            expect(geleert.statusCode).toBe(200);
            expect((await detail(W.eins)).segments.map((a) => a.herkunft?.description)).toEqual(["manual", "manual"]);
            expect(
                await database<{ description: string | null }[]>`
                    SELECT description FROM powerline WHERE public_id = ANY(${[W.eins, W.zwei]}::uuid[]) ORDER BY public_id
                `,
            ).toEqual([{ description: null }, { description: null }]);
            // Ohne Artikel kennt das Wiki keinen Namen: 400, nichts geschrieben.
            const ohne = await schreibe(W.eins, {
                segments: await stand(W.eins),
                wiki: null,
                name: { revert: "wiki" },
            });
            expect(ohne.statusCode).toBe(400);
            expect((await detail(W.eins)).article?.key).toBe(SCHLUESSEL);
        });
    });
});
