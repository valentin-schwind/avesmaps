import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_PLACES_URL,
    editorPlaceHistoryUrl,
    editorPlaceMoveTargetsUrl,
    editorPlaceMoveUrl,
    editorPlaceDeleteUrl,
    editorPlaceRemovalUrl,
    editorPlaceRestoreUrl,
    editorPlaceTakeOffMapUrl,
    editorPlaceUrl,
    type PlaceRemoval,
    type EditorMoveTargets,
    type EditorPlaceDetail,
    type EditorPlaceList,
    type MapHistoryPage,
    type OperationReceipt,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { assignmentSpec } from "../src/migration/wiki-link-targets-import.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Die Fachoperationen am Ort, Teil a (WI-0128 E10; EDIT-0001 §4.3, §4.4, §6.2, §7.1 E10) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle: Ein veralteter Entwurf überschreibt still; dieselbe Kennung schreibt zweimal; ein Reviewer schreibt; der Zug importiert
 * und ein Speichern mischt sich hinein; eine Änderung nur an den Einzelheiten zählt die Revision nicht (oder doppelt); ↺ setzt den Wert
 * ohne Herkunft; ein Verschieben zieht die Wegenden nicht mit oder lässt die gezeichnete Kurve zurück; ein Wegende ohne Strg bleibt
 * unbemerkt liegen. Soll: EDIT-0001 §7.1 E10.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0128-e10";
const ORT = "e10e10e1-0000-4000-8000-000000000001";
const WEG_A = "e10e10e1-0000-4000-8000-0000000000a1";
const WEG_B = "e10e10e1-0000-4000-8000-0000000000b1";
const WIKI_KEY = "wi0128-e10-probe";
/** Ein Wiki-Eintrag ohne Kartenpunkt (E16), wie Legacys Verzeichnis X3 ihn liefert. */
const E16_WIKI_KEY = "wiki:wi0128-e16-tor";
let zaehler = 0;
const operationId = (): string => `e10e10e1-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;

describeWithDatabase("Fachoperationen am Ort, Teil a (WI-0128 E10)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    const cookies = new Map<Role, string>();
    let editorName = "";

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
        // E13: Ereignisse und Jobs der Operationen (in der Testdatenbank entstehen beide Arten nur hier).
        await database`DELETE FROM job_event WHERE kind = 'map.changed' OR job_id IN (SELECT id FROM job WHERE kind = 'path_profile')`;
        await database`DELETE FROM job WHERE kind = 'path_profile'`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'e10e10e1-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'e10e10e1-%'`;
        await database`DELETE FROM path_visual WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place_detail WHERE place_id IN (SELECT id FROM place WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM place_wiki_assignment WHERE place_id IN (SELECT id FROM place WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM wiki_settlement_snapshot WHERE wiki_key = ${WIKI_KEY}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = 'avesmaps3d' AND name ILIKE 'E10 Neu%'`;
        // E16: Orte ohne Lage, platzierte Orte samt ihren Zuordnungen, der Wiki-Eintrag.
        await database`
            DELETE FROM wiki_key_assignment
             WHERE object_public_id IN (SELECT public_id FROM place WHERE name ILIKE 'E16 %') OR wiki_key = ${E16_WIKI_KEY}
        `;
        await database`DELETE FROM place_detail WHERE place_id IN (SELECT id FROM place WHERE name ILIKE 'E16 %')`;
        await database`DELETE FROM place_wiki_assignment WHERE place_id IN (SELECT id FROM place WHERE name ILIKE 'E16 %')`;
        await database`DELETE FROM place WHERE name ILIKE 'E16 %'`;
        await database`DELETE FROM place_unplaced WHERE name ILIKE 'E16 %'`;
        await database`DELETE FROM wiki_settlement_registry WHERE wiki_key = ${E16_WIKI_KEY}`;
        // E22: Kraftlinie, Gebiet und Stätte der Proben, die Orte selbst.
        await database`DELETE FROM powerline WHERE source_system = 'test-e22'`;
        await database`DELETE FROM territory WHERE source_system = 'test-e22'`;
        await database`DELETE FROM settlement_place WHERE source_system = 'test-e22'`;
        await database`DELETE FROM place WHERE name ILIKE 'E22 %'`;
        await database`DELETE FROM place_unplaced WHERE name ILIKE 'E22 %'`;
        // Herkunft je Feld (WI-0225): der Probeort und Vermerke an Orten, die es nicht mehr gibt.
        await database`DELETE FROM field_origin WHERE object_kind = 'place' AND object_id = ${ORT}::uuid`;
        await database`
            DELETE FROM field_origin
             WHERE object_kind = 'place'
               AND object_id NOT IN (SELECT public_id FROM place UNION SELECT public_id FROM place_unplaced)
        `;
    }

    const detail = async (): Promise<EditorPlaceDetail> =>
        (
            await app.inject({
                method: "GET",
                url: editorPlaceUrl(ORT),
                headers: { cookie: cookies.get("editor") ?? "" },
            })
        ).json<EditorPlaceDetail>();

    const patch = (body: object, role: Role = "editor") =>
        app.inject({
            method: "PATCH",
            url: editorPlaceUrl(ORT),
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: body,
        });
    const move = (body: object, role: Role = "editor") =>
        app.inject({
            method: "POST",
            url: editorPlaceMoveUrl(ORT),
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: body,
        });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        const fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Ort ${role}` });
            if (role === "editor") editorName = `Ort ${role}`;
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, 'aventuria', 'E10 Probeort', 'stadt', ST_SetSRID(ST_MakePoint(431, 432), 0), ${SOURCE}, TRUE)
        `;
        // Weg A beginnt am Ort, Weg B endet dort (0,3 daneben: noch im Kasten von ±0,5).
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${WEG_A}, 'aventuria', 'E10 Weg A', 'Weg', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ARRAY[ST_MakePoint(431, 432), ST_MakePoint(435, 434), ST_MakePoint(440, 433)]), 0), ${SOURCE}, TRUE),
                   (${WEG_B}, 'aventuria', 'E10 Weg B', 'Strasse', TRUE, FALSE,
                    ST_SetSRID(ST_MakeLine(ARRAY[ST_MakePoint(425, 428), ST_MakePoint(428, 430), ST_MakePoint(431.3, 432)]), 0), ${SOURCE}, TRUE)
        `;
        const [snapshot] = await database<{ id: string }[]>`
            INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, einwohner, oberhaupt, region_text, staat_text, synced_at)
            VALUES (${WIKI_KEY}, 'https://de.wiki-aventurica.de/wiki/E10', 'E10', 'E10', '1.200', 'Graf Probe', 'Kosch', 'Mittelreich', now())
            RETURNING id::text
        `;
        await database`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/E10', ${snapshot!.id}, 'assigned', 'unknown' FROM place WHERE public_id = ${ORT}
        `;
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

    it("das Detail nennt Revision, Herkunft, Wiki-Werte und die Wegenden am Ort", async () => {
        const ort = await detail();
        expect(ort).toMatchObject({ publicId: ORT, revision: 1, name: "E10 Probeort", position: { x: 431, y: 432 } });
        expect(ort.fields.einwohner).toEqual({ value: null, origin: null, wiki: "1.200" });
        expect(ort.fields.lage.wiki).toContain("Kosch");
        // Der Name laut Wiki (WI-0225), noch ohne Vermerk zur Herkunft.
        expect(ort.nameWiki).toBe("E10");
        expect(ort.herkunft).toBeUndefined();
        expect(ort.pathEnds.map((end) => [end.name, end.end])).toEqual([
            ["E10 Weg A", "start"],
            ["E10 Weg B", "end"],
        ]);
        // Der Nachbarpunkt jedes Endes, für die gestrichelte Vorschau beim Verschieben (E12).
        expect(ort.pathEnds.map((end) => end.neighbor)).toEqual([
            { x: 435, y: 434 },
            { x: 428, y: 430 },
        ]);
    });

    it("🔴 Recht: ein Reviewer schreibt nicht (403), ohne Anmeldung 401", async () => {
        expect(
            (await patch({ operationId: operationId(), baseRevision: 1, changes: { hidden: true } }, "reviewer"))
                .statusCode,
        ).toBe(403);
        const ohne = await app.inject({
            method: "PATCH",
            url: editorPlaceUrl(ORT),
            headers: { origin: TEST_ORIGIN },
            payload: {},
        });
        expect(ohne.statusCode).toBe(401);
    });

    it("🔴 eine Änderung nur an den Einzelheiten zählt place.revision genau einmal; ↺ setzt Wert und Herkunft wiki", async () => {
        const eigen = await patch({
            operationId: operationId(),
            baseRevision: 1,
            changes: { einwohner: { value: "2.000" } },
        });
        expect(eigen.statusCode).toBe(200);
        expect(eigen.json()).toMatchObject({ status: "applied", affected: [{ kind: "place", id: ORT, revision: 2 }] });
        let ort = await detail();
        expect(ort.revision).toBe(2);
        expect(ort.fields.einwohner).toEqual({ value: "2.000", origin: "manual", wiki: "1.200" });
        const zurueck = await patch({
            operationId: operationId(),
            baseRevision: 2,
            changes: { einwohner: { revert: "wiki" } },
        });
        expect(zurueck.statusCode).toBe(200);
        ort = await detail();
        expect(ort.revision).toBe(3);
        expect(ort.fields.einwohner).toEqual({ value: "1.200", origin: "wiki", wiki: "1.200" });
        // Das Protokoll nennt nur Felder der Positivliste, mit vorher und nachher.
        const [zeile] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e WHERE e.place_public_id = ${ORT} AND e.revision_after = 3
        `;
        expect(zeile?.changes).toEqual({
            einwohner: { before: "2.000", after: "1.200" },
            einwohnerOrigin: { before: "manual", after: "wiki" },
        });
    });

    it("🔴 veraltete baseRevision → 409 mit wer und wann; dieselbe Kennung → replayed; anderer Inhalt → idempotency_key_reused", async () => {
        const id = operationId();
        const erste = await patch({
            operationId: id,
            baseRevision: 3,
            changes: { name: "E10 Probeort Neu", hidden: true },
        });
        expect(erste.statusCode).toBe(200);
        const nochmal = await patch({
            operationId: id,
            baseRevision: 3,
            changes: { name: "E10 Probeort Neu", hidden: true },
        });
        expect(nochmal.json()).toMatchObject({ status: "replayed" });
        const anders = await patch({ operationId: id, baseRevision: 3, changes: { name: "E10 Anders" } });
        expect(anders.statusCode).toBe(409);
        expect(anders.json()).toMatchObject({ error: { code: "idempotency_key_reused" } });
        const veraltet = await patch({ operationId: operationId(), baseRevision: 3, changes: { ruined: true } });
        expect(veraltet.statusCode).toBe(409);
        expect(veraltet.json()).toMatchObject({
            error: { code: "edit_conflict", details: { currentRevision: 4, changedBy: { displayName: editorName } } },
        });
        expect((await detail()).revision).toBe(4);
    });

    it("🔴 der Zug hält die Sperre der Domäne: 503 map_import_running, nichts geschrieben", async () => {
        const sperre = createDatabase(testDatabaseUrl as string, { max: 1 });
        try {
            await sperre.begin(async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext('aventuria'))`;
                const antwort = await patch({
                    operationId: operationId(),
                    baseRevision: 4,
                    changes: { ruined: false },
                });
                expect(antwort.statusCode).toBe(503);
                expect(antwort.json()).toMatchObject({ error: { code: "map_import_running" } });
                expect(antwort.headers["retry-after"]).toBeDefined();
            });
        } finally {
            await sperre.end({ timeout: 5 });
        }
        expect((await detail()).revision).toBe(4);
    });

    it("🔴 place.move: Ort, genannte Wegenden und ihre Kurve in einer Operation; ein nicht genanntes Ende bleibt liegen (Befund)", async () => {
        const vorher = await detail();
        const wegA = vorher.pathEnds.find((end) => end.name === "E10 Weg A")!;
        const antwort = await move({
            operationId: operationId(),
            baseRevision: vorher.revision,
            to: { x: 432, y: 433 },
            pathEnds: [{ pathId: wegA.pathId, end: "start", baseRevision: wegA.revision, to: { x: 432, y: 433 } }],
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json();
        expect(quittung.affected).toEqual([
            { kind: "place", id: ORT, revision: vorher.revision + 1 },
            { kind: "path", id: WEG_A, revision: 2 },
        ]);
        expect(quittung.warnings).toEqual([{ code: "path_end_left", message: expect.stringContaining("1 Wegenden") }]);
        // Die Linie beginnt an der neuen Lage, und die gezeichnete Kurve auch; Weg B blieb, wo er war.
        const [linien] = await database<{ a: string; a_visual: string; b: string }[]>`
            SELECT ST_AsText(ST_StartPoint(a.geom)) AS a, ST_AsText(ST_StartPoint(v.geom)) AS a_visual, ST_AsText(ST_EndPoint(b.geom)) AS b
              FROM path a JOIN path_visual v ON v.path_id = a.id, path b
             WHERE a.public_id = ${WEG_A} AND b.public_id = ${WEG_B}
        `;
        expect(linien).toEqual({ a: "POINT(432 433)", a_visual: "POINT(432 433)", b: "POINT(431.3 432)" });
        const nachher = await detail();
        expect(nachher.position).toEqual({ x: 432, y: 433 });
        // Ein Weg-Ende mit veralteter Revision: 409 für den Weg, nichts verschoben.
        const veraltet = await move({
            operationId: operationId(),
            baseRevision: nachher.revision,
            to: { x: 433, y: 433 },
            pathEnds: [{ pathId: WEG_A, end: "start", baseRevision: 1, to: { x: 433, y: 433 } }],
        });
        expect(veraltet.statusCode).toBe(409);
        expect(veraltet.json()).toMatchObject({ error: { code: "edit_conflict", details: { currentRevision: 2 } } });
        expect((await detail()).position).toEqual({ x: 432, y: 433 });
    });

    it("ein Wegende, das nicht am Ort hängt, und eine Lage außerhalb der Karte: 400, nichts geschrieben", async () => {
        const ort = await detail();
        const fremd = await move({
            operationId: operationId(),
            baseRevision: ort.revision,
            to: { x: 432.1, y: 433 },
            pathEnds: [{ pathId: WEG_A, end: "end", baseRevision: 2, to: { x: 432.1, y: 433 } }],
        });
        expect(fremd.statusCode).toBe(400);
        const draussen = await move({
            operationId: operationId(),
            baseRevision: ort.revision,
            to: { x: -50, y: 5 },
            pathEnds: [],
        });
        expect(draussen.statusCode).toBe(400);
        expect((await detail()).revision).toBe(ort.revision);
    });

    it("🔴 ein Wegende außerhalb der Karte: 400 mit dem Ende, nichts geschrieben (Befund der Koordination zu ajv, 2026-10-19)", async () => {
        const ort = await detail();
        const ende = ort.pathEnds.find((e) => e.pathId === WEG_A)!;
        const [vorher] = await database<
            { geom: string }[]
        >`SELECT ST_AsText(geom) AS geom FROM path WHERE public_id = ${WEG_A}`;
        const draussen = await move({
            operationId: operationId(),
            baseRevision: ort.revision,
            to: { x: 432.2, y: 433 },
            pathEnds: [{ pathId: WEG_A, end: ende.end, baseRevision: ende.revision, to: { x: -50, y: 5 } }],
        });
        expect(draussen.statusCode).toBe(400);
        expect(draussen.json()).toMatchObject({
            error: {
                code: "validation_failed",
                message: "Ein Wegende liegt außerhalb der Karte.",
                details: { field: "pathEnds", pathId: WEG_A, end: ende.end },
            },
        });
        expect((await detail()).revision).toBe(ort.revision);
        const [nachher] = await database<
            { geom: string }[]
        >`SELECT ST_AsText(geom) AS geom FROM path WHERE public_id = ${WEG_A}`;
        expect(nachher).toEqual(vorher);
    });

    it("🔴 E12: die Einrastziele sind freie Wegenden im Umkreis; ein Ende am Ort ist keins; nur mit edit_map_geometry", async () => {
        // Nach dem Verschieben (oben) hängt Weg A mit seinem Anfang am Ort; Weg B blieb liegen und ist jetzt frei.
        const antwort = await app.inject({
            method: "GET",
            url: editorPlaceMoveTargetsUrl(ORT),
            headers: { cookie: cookies.get("editor") ?? "" },
        });
        expect(antwort.statusCode).toBe(200);
        const ziele = antwort.json<EditorMoveTargets>();
        expect(ziele.radius).toBeGreaterThan(0);
        const namen = ziele.freeEnds.map((ende) => `${ende.name}:${ende.end}`);
        expect(namen).toContain("E10 Weg B:end");
        expect(namen).toContain("E10 Weg A:end");
        expect(namen).not.toContain("E10 Weg A:start");
        // Das nächste zuerst: das liegengebliebene Ende von Weg B.
        expect(namen[0]).toBe("E10 Weg B:end");
        const reviewer = await app.inject({
            method: "GET",
            url: editorPlaceMoveTargetsUrl(ORT),
            headers: { cookie: cookies.get("reviewer") ?? "" },
        });
        expect(reviewer.statusCode).toBe(403);
    });

    it("🔴 E10 Teil b place.create: ein neuer Ort mit Lage, Revision 1, eigene Daten, im Protokoll; Name eindeutig, Lage auf der Karte, Reviewer 403", async () => {
        const anlegen = (body: object, role: Role = "editor") =>
            app.inject({
                method: "POST",
                url: EDITOR_PLACES_URL,
                headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
                payload: body,
            });
        const neu = await anlegen({
            operationId: operationId(),
            name: " E10 Neu ",
            subtype: "dorf",
            kind: "Weiler",
            position: { x: 433, y: 436 },
        });
        expect(neu.statusCode).toBe(200);
        const quittung = neu.json<OperationReceipt>();
        expect(quittung.affected).toEqual([{ kind: "place", id: expect.any(String), revision: 1 }]);
        const id = quittung.affected[0]!.id;
        const [ort] = await database<Record<string, unknown>[]>`
            SELECT name, subtype, place_kind, source_system, legacy_public_id, revision::int AS revision, ST_X(geom) AS x, ST_Y(geom) AS y
              FROM place WHERE public_id = ${id}::uuid
        `;
        expect(ort).toEqual({
            name: "E10 Neu",
            subtype: "dorf",
            place_kind: "Weiler",
            source_system: "avesmaps3d",
            legacy_public_id: null,
            revision: 1,
            x: 433,
            y: 436,
        });
        const [protokoll] = await database<{ action: string; before: number | null; after: number; changes: object }[]>`
            SELECT action, revision_before::int AS before, revision_after::int AS after, changes
              FROM map_audit_event WHERE place_public_id = ${id}::uuid
        `;
        expect(protokoll).toMatchObject({ action: "place.created", before: null, after: 1 });
        expect(Object.keys(protokoll!.changes).sort()).toEqual(["kind", "name", "position", "subtype"]);
        // Der Ortseditor liest ihn wie jeden anderen.
        const gelesen = await app.inject({
            method: "GET",
            url: editorPlaceUrl(id),
            headers: { cookie: cookies.get("editor") ?? "" },
        });
        expect(gelesen.json<EditorPlaceDetail>()).toMatchObject({
            name: "E10 Neu",
            revision: 1,
            sourceSystem: "avesmaps3d",
        });

        const doppelt = await anlegen({
            operationId: operationId(),
            name: "e10 neu",
            subtype: "dorf",
            position: { x: 434, y: 437 },
        });
        // Ein doppelter Name ist ein Befund, kein Tor (WI-0126 §2, EDIT-0001 E20): angelegt, mit Warnung.
        expect(doppelt.statusCode).toBe(200);
        expect(doppelt.json<OperationReceipt>().warnings).toEqual([
            { code: "name_taken", message: "Diesen Namen trägt schon ein anderer Ort." },
        ]);
        const aussen = await anlegen({
            operationId: operationId(),
            name: "E10 Neu draußen",
            subtype: "dorf",
            position: { x: -99999, y: -99999 },
        });
        expect(aussen.statusCode).toBe(400);
        expect(aussen.json()).toMatchObject({ error: { details: { field: "position" } } });
        const reviewer = await anlegen(
            { operationId: operationId(), name: "E10 Neu Reviewer", subtype: "dorf", position: { x: 434, y: 437 } },
            "reviewer",
        );
        expect(reviewer.statusCode).toBe(403);
    });

    it("🔴 place.create trägt ALLE Felder der Eigenschaften - mit Lage in `place_detail`, ohne Lage in der eigenen Zeile", async () => {
        /*
         * 🔴 Betreiber 2026-10-13: „neuer ort hat immer noch nicht alle felder“. Wer einen Ort anlegt, weiß schon, was
         * drinsteht; vorher brauchte es dafür eine zweite Operation gleich hinterher und damit zwei Zeilen im Verlauf.
         */
        const anlegen = (body: object) =>
            app.inject({
                method: "POST",
                url: EDITOR_PLACES_URL,
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: body,
            });
        const voll = {
            name: "E10 Vollsatz",
            subtype: "kleinstadt",
            kind: "Handelsposten",
            einwohner: "1.200",
            oberhaupt: "Gräfin Alrike",
            lage: "am Breitenfluss",
            description: "Ein Posten an der Furt.",
            ruined: true,
            seaport: true,
            underground: true,
            approximate: true,
        };

        const mitLage = await anlegen({ operationId: operationId(), ...voll, position: { x: 435, y: 438 } });
        expect(mitLage.statusCode).toBe(200);
        const id = mitLage.json<OperationReceipt>().affected[0]!.id;
        const [ort] = await database<Record<string, unknown>[]>`
            SELECT p.is_ruined, p.is_seaport, p.is_underground, p.is_hidden, p.is_nodix, p.is_withdrawn, p.is_approximate,
                   d.einwohner, d.oberhaupt, d.lage, d.description, d.einwohner_origin, d.lage_origin, d.oberhaupt_origin
              FROM place p LEFT JOIN place_detail d ON d.place_id = p.id AND d.is_active
             WHERE p.public_id = ${id}::uuid
        `;
        expect(ort).toEqual({
            is_ruined: true,
            is_seaport: true,
            is_underground: true,
            is_hidden: false,
            is_nodix: false,
            is_withdrawn: false,
            is_approximate: true,
            einwohner: "1.200",
            oberhaupt: "Gräfin Alrike",
            lage: "am Breitenfluss",
            description: "Ein Posten an der Furt.",
            // 🔴 `manual`: Ein neuer Ort hat keinen Wiki-Stand, von dem ein Wert stammen könnte.
            einwohner_origin: "manual",
            lage_origin: "manual",
            oberhaupt_origin: "manual",
        });
        // Das Protokoll nennt jedes gesetzte Feld - und NUR die gesetzten.
        const [protokoll] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT changes FROM map_audit_event WHERE place_public_id = ${id}::uuid
        `;
        expect(Object.keys(protokoll!.changes).sort()).toEqual([
            "approximate",
            "description",
            "einwohner",
            "kind",
            "lage",
            "name",
            "oberhaupt",
            "position",
            "ruined",
            "seaport",
            "subtype",
            "underground",
        ]);

        // Ohne Lage stehen dieselben Werte in `place_unplaced` (0105), nicht in `place_detail`.
        const ohneLage = await anlegen({ operationId: operationId(), ...voll, name: "E10 Vollsatz ohne Lage" });
        expect(ohneLage.statusCode).toBe(200);
        const zweiteId = ohneLage.json<OperationReceipt>().affected[0]!.id;
        const [frei] = await database<Record<string, unknown>[]>`
            SELECT is_ruined, is_seaport, is_underground, is_approximate, einwohner, oberhaupt, lage, description
              FROM place_unplaced WHERE public_id = ${zweiteId}::uuid
        `;
        expect(frei).toEqual({
            is_ruined: true,
            is_seaport: true,
            is_underground: true,
            is_approximate: true,
            einwohner: "1.200",
            oberhaupt: "Gräfin Alrike",
            lage: "am Breitenfluss",
            description: "Ein Posten an der Furt.",
        });

        // 🪤 Ein leeres Feld ist kein Wert: Es legt keine Zeile in `place_detail` an und steht nicht im Protokoll.
        const leer = await anlegen({
            operationId: operationId(),
            name: "E10 Leerfelder",
            subtype: "dorf",
            einwohner: "   ",
            description: "",
            position: { x: 436, y: 439 },
        });
        expect(leer.statusCode).toBe(200);
        const leerId = leer.json<OperationReceipt>().affected[0]!.id;
        const [kein] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM place_detail d JOIN place p ON p.id = d.place_id
             WHERE p.public_id = ${leerId}::uuid
        `;
        expect(kein!.n).toBe(0);
        const [leerProtokoll] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT changes FROM map_audit_event WHERE place_public_id = ${leerId}::uuid
        `;
        expect(Object.keys(leerProtokoll!.changes).sort()).toEqual(["name", "position", "subtype"]);
    });

    it("🔴 E13: ein Verschieben mit Wegenden reiht in seiner Transaktion den Job path_profile ein, ein zweites nimmt ihn mit; mapRevision ist die Nummer von map.changed und steigt", async () => {
        const ereignisse = async (
            nach: number,
        ): Promise<{ seq: number; payload: { operation: string; affected: unknown[] } }[]> =>
            database<{ seq: number; payload: { operation: string; affected: unknown[] } }[]>`
                SELECT seq::int AS seq, payload FROM job_event WHERE kind = 'map.changed' AND seq > ${nach} ORDER BY seq
            `;
        const verschiebe = async (to: { x: number; y: number }): Promise<OperationReceipt> => {
            const ort = await detail();
            const antwort = await move({
                operationId: operationId(),
                baseRevision: ort.revision,
                to,
                pathEnds: ort.pathEnds.map((ende) => ({
                    pathId: ende.pathId,
                    end: ende.end,
                    baseRevision: ende.revision,
                    to,
                })),
            });
            expect(antwort.statusCode).toBe(200);
            return antwort.json<OperationReceipt>();
        };
        const [vorher] = await database<{ seq: number }[]>`SELECT coalesce(max(seq), 0)::int AS seq FROM job_event`;

        const erste = await verschiebe({ x: 431.5, y: 432.5 });
        const job = erste.derivedWork.find((arbeit) => arbeit.kind === "path_profile");
        expect(job).toMatchObject({ state: "queued", jobId: expect.any(String) });
        expect(erste.derivedWork).toContainEqual({ kind: "tiles", state: "done" });
        expect(erste.mapRevision).toBeGreaterThan(vorher!.seq);
        const [zeile] = await database<{ state: string; wartet: boolean; actor_ref: string }[]>`
            SELECT state, not_before > now() + interval '5 seconds' AS wartet, actor_ref FROM job WHERE public_id = ${job!.jobId!}::uuid
        `;
        // Wartet ein paar Sekunden, damit ein zweites Speichern ihn mitnimmt; die Person ist der Auslöser (Editor-Job, SYS-4).
        expect(zeile).toMatchObject({ state: "QUEUED", wartet: true });
        expect(zeile!.actor_ref).toMatch(/^[0-9a-f-]{36}$/u);
        const [ereignis] = await ereignisse(vorher!.seq);
        expect(ereignis).toMatchObject({ seq: erste.mapRevision, payload: { operation: "place.move" } });
        expect(ereignis!.payload.affected).toContainEqual(expect.objectContaining({ kind: "place", id: ORT }));

        const zweite = await verschiebe({ x: 431, y: 432 });
        expect(zweite.derivedWork.find((arbeit) => arbeit.kind === "path_profile")?.jobId).toBe(job!.jobId);
        expect(zweite.mapRevision).toBeGreaterThan(erste.mapRevision!);
        const [{ jobs }] =
            (await database`SELECT count(*)::int AS jobs FROM job WHERE kind = 'path_profile' AND state = 'QUEUED'`) as unknown as [
                { jobs: number },
            ];
        expect(jobs).toBe(1);

        // Scheitert die Operation (veralteter Stand), gibt es weder Ereignis noch Job: beides hängt an ihrer Transaktion.
        const veraltet = await move({
            operationId: operationId(),
            baseRevision: 1,
            to: { x: 431, y: 432 },
            pathEnds: [],
        });
        expect(veraltet.statusCode).toBe(409);
        expect(await ereignisse(zweite.mapRevision!)).toEqual([]);

        // Ohne Weg kein Job, aber das Ereignis: Name und Merkmale stehen in den Kacheln der Orte.
        const ort = await detail();
        const ohneWeg = await patch({
            operationId: operationId(),
            baseRevision: ort.revision,
            changes: { ruined: !ort.ruined },
        });
        const quittung = ohneWeg.json<OperationReceipt>();
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).not.toContain("path_profile");
        expect(quittung.mapRevision).toBeGreaterThan(zweite.mapRevision!);
    });

    it("🔴 Merkmale: Seehafen und Nodix setzt der Editor (nicht aus Seewegen oder Kraftlinien), dazu Unterirdisch und Entrückt; eine Revision, im Protokoll", async () => {
        const neu = await app.inject({
            method: "POST",
            url: EDITOR_PLACES_URL,
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: operationId(),
                name: "E10 Neu Merkmale",
                subtype: "dorf",
                position: { x: 433, y: 436 },
            },
        });
        const id = neu.json<OperationReceipt>().affected[0]!.id;
        const lesen = async () =>
            (
                await app.inject({
                    method: "GET",
                    url: editorPlaceUrl(id),
                    headers: { cookie: cookies.get("editor") ?? "" },
                })
            ).json<EditorPlaceDetail>();
        const vorher = await lesen();
        expect(vorher).toMatchObject({ seaport: false, nodix: false, underground: false, withdrawn: false });
        // Ob Wasser in Reichweite liegt, ist nur ein Hinweis; er steht bei jedem Ort mit Lage da.
        expect(typeof vorher.waterNearby).toBe("boolean");

        const gesetzt = await app.inject({
            method: "PATCH",
            url: editorPlaceUrl(id),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: operationId(),
                baseRevision: 1,
                changes: { seaport: true, nodix: true, underground: true, withdrawn: true },
            },
        });
        expect(gesetzt.json<OperationReceipt>().affected).toEqual([{ kind: "place", id, revision: 2 }]);
        expect(await lesen()).toMatchObject({
            revision: 2,
            seaport: true,
            nodix: true,
            underground: true,
            withdrawn: true,
        });
        const [protokoll] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT changes FROM map_audit_event WHERE place_public_id = ${id}::uuid AND action = 'place.updated'
        `;
        expect(Object.keys(protokoll!.changes).sort()).toEqual(["nodix", "seaport", "underground", "withdrawn"]);
    });

    describe("E16: Orte ohne Lage und Wiki-Einträge aus „Nicht auf der Karte“", () => {
        const anlegen = (body: object, role: Role = "editor") =>
            app.inject({
                method: "POST",
                url: EDITOR_PLACES_URL,
                headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
                payload: body,
            });
        const liste = async (): Promise<EditorPlaceList> =>
            (
                await app.inject({
                    method: "GET",
                    url: EDITOR_PLACES_URL,
                    headers: { cookie: cookies.get("editor") ?? "" },
                })
            ).json<EditorPlaceList>();
        const lesen = async (id: string): Promise<EditorPlaceDetail> =>
            (
                await app.inject({
                    method: "GET",
                    url: editorPlaceUrl(id),
                    headers: { cookie: cookies.get("editor") ?? "" },
                })
            ).json<EditorPlaceDetail>();

        it("🔴 ein Ort ohne Lage wird gespeichert, steht unter „Nicht auf der Karte“, lässt sich bearbeiten und mit derselben Kennung auf die Karte setzen", async () => {
            const neu = await anlegen({ operationId: operationId(), name: "E16 Weiler", subtype: "dorf" });
            expect(neu.statusCode).toBe(200);
            const quittung = neu.json<OperationReceipt>();
            expect(quittung.affected).toEqual([{ kind: "place", id: expect.any(String), revision: 1 }]);
            // Ohne Lage gibt es kein Routing nachzurechnen.
            expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).not.toContain("routing");
            const id = quittung.affected[0]!.id;
            const [inPlace] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM place WHERE public_id = ${id}::uuid`;
            expect(inPlace?.n).toBe(0);

            // Gelesen wie jeder Ort, nur ohne Lage und ohne Wegenden; in der Liste „nicht auf der Karte“.
            const detail = await lesen(id);
            expect(detail).toMatchObject({
                publicId: id,
                name: "E16 Weiler",
                revision: 1,
                sourceSystem: "avesmaps3d",
                pathEnds: [],
            });
            expect(detail.position).toBeUndefined();
            expect((await liste()).rows.find((row) => row.key === id)).toEqual({
                key: id,
                origin: "ohne-lage",
                name: "E16 Weiler",
                circle: "leer",
                assignment: "none",
                subtype: "dorf",
                source: "avesmaps3d",
            });

            // Der Name gehört auch ihm: Ein zweiter Ort mit demselben Namen ist ein Befund (E20), kein Tor.
            const doppelt = await anlegen({
                operationId: operationId(),
                name: "e16 weiler",
                subtype: "dorf",
                position: { x: 434, y: 437 },
            });
            expect(doppelt.json<OperationReceipt>().warnings).toEqual([
                { code: "name_taken", message: "Diesen Namen trägt schon ein anderer Ort." },
            ]);

            // Bearbeiten: Name und Beschreibung in EINER Revision.
            const geaendert = await app.inject({
                method: "PATCH",
                url: editorPlaceUrl(id),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: {
                    operationId: operationId(),
                    baseRevision: 1,
                    changes: { name: "E16 Weilerhof", description: { value: "Ein Hof am Fluss." } },
                },
            });
            expect(geaendert.json<OperationReceipt>().affected).toEqual([{ kind: "place", id, revision: 2 }]);
            expect((await lesen(id)).fields.description).toEqual({
                value: "Ein Hof am Fluss.",
                origin: null,
                wiki: null,
            });

            // Keine Umgebung zum Einrasten.
            const ziele = await app.inject({
                method: "GET",
                url: editorPlaceMoveTargetsUrl(id),
                headers: { cookie: cookies.get("editor") ?? "" },
            });
            expect(ziele.json<EditorMoveTargets>().freeEnds).toEqual([]);

            // Auf die Karte setzen: dieselbe Kennung, die nächste Revision, die Beschreibung als eigener Wert.
            const gesetzt = await app.inject({
                method: "POST",
                url: editorPlaceMoveUrl(id),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: { operationId: operationId(), baseRevision: 2, to: { x: 433, y: 438 }, pathEnds: [] },
            });
            expect(gesetzt.statusCode).toBe(200);
            expect(gesetzt.json<OperationReceipt>().affected).toEqual([{ kind: "place", id, revision: 3 }]);
            const [ort] = await database<
                { revision: number; x: number; y: number; name: string; description: string }[]
            >`
                SELECT p.revision::int AS revision, ST_X(p.geom) AS x, ST_Y(p.geom) AS y, p.name, d.description
                  FROM place p LEFT JOIN place_detail d ON d.place_id = p.id WHERE p.public_id = ${id}::uuid
            `;
            expect(ort).toEqual({
                revision: 3,
                x: 433,
                y: 438,
                name: "E16 Weilerhof",
                description: "Ein Hof am Fluss.",
            });
            const [ohne] = await database<{ aktiv: boolean; herkunft: string }[]>`
                SELECT is_active AS aktiv, retired_origin AS herkunft FROM place_unplaced WHERE public_id = ${id}::uuid
            `;
            expect(ohne).toEqual({ aktiv: false, herkunft: "placed" });
            expect((await liste()).rows.filter((row) => row.key === id).map((row) => row.origin)).toEqual(["karte"]);
            expect((await lesen(id)).position).toEqual({ x: 433, y: 438 });
            const protokoll = await database<{ action: string }[]>`
                SELECT action FROM map_audit_event WHERE place_public_id = ${id}::uuid ORDER BY id
            `;
            expect(protokoll.map((zeile) => zeile.action)).toEqual(["place.created", "place.updated", "place.placed"]);

            // Ein Reviewer legt nichts an.
            const reviewer = await anlegen(
                { operationId: operationId(), name: "E16 Reviewer", subtype: "dorf" },
                "reviewer",
            );
            expect(reviewer.statusCode).toBe(403);
        });

        it("🔴 ein Wiki-Eintrag aus „Nicht auf der Karte“ wird platziert: der Ort trägt den Artikel, der Eintrag verschwindet; ein zweites Mal nicht", async () => {
            await database`
                INSERT INTO wiki_settlement_registry (wiki_key, title, wiki_url, settlement_class)
                VALUES (${E16_WIKI_KEY}, 'E16 Tor', 'https://de.wiki-aventurica.de/wiki/E16_Tor', 'gebaeude')
            `;
            expect((await liste()).rows.some((row) => row.key === E16_WIKI_KEY)).toBe(true);
            const ohneLage = await anlegen({
                operationId: operationId(),
                name: "E16 Tor",
                subtype: "gebaeude",
                wikiKey: E16_WIKI_KEY,
            });
            expect(ohneLage.json()).toMatchObject({ error: { details: { field: "position" } } });

            const neu = await anlegen({
                operationId: operationId(),
                name: "E16 Tor",
                subtype: "gebaeude",
                position: { x: 436, y: 439 },
                wikiKey: E16_WIKI_KEY,
            });
            expect(neu.statusCode).toBe(200);
            const id = neu.json<OperationReceipt>().affected[0]!.id;
            const [x2] = await database<{ key: string; quelle: string; ns: number | null; ns_name: string | null }[]>`
                SELECT wiki_key AS key, source_system AS quelle, ns, ns_name FROM wiki_key_assignment
                 WHERE object_public_id = ${id}::uuid AND is_active
            `;
            // B-2: Der Namensraum kommt aus dem Präfix des Titels hinter der Adresse (hier der Hauptraum), nicht aus dem Schlüssel.
            expect(x2).toEqual({ key: E16_WIKI_KEY, quelle: "avesmaps3d", ns: 0, ns_name: "" });
            const [zuordnung] = await database<{ zustand: string; herkunft: string; url: string }[]>`
                SELECT a.assignment_state AS zustand, a.assignment_origin AS herkunft, a.wiki_url AS url
                  FROM place_wiki_assignment a JOIN place p ON p.id = a.place_id WHERE p.public_id = ${id}::uuid
            `;
            expect(zuordnung).toEqual({
                zustand: "address_only",
                herkunft: "editor",
                url: "https://de.wiki-aventurica.de/wiki/E16_Tor",
            });

            // In der Liste: ein Ort auf der Karte mit seinem Artikel (●), der Wiki-Eintrag ist weg.
            const rows = (await liste()).rows;
            expect(rows.some((row) => row.key === E16_WIKI_KEY)).toBe(false);
            expect(rows.find((row) => row.key === id)).toMatchObject({
                origin: "karte",
                circle: "voll",
                assignment: "assigned",
                wiki: { url: "https://de.wiki-aventurica.de/wiki/E16_Tor", title: "E16 Tor" },
            });

            // Betreiber 2026-10-11: „natürlich darf man nur orte auf die karte ziehen, die noch nicht auf der karte sind“.
            const nochmal = await anlegen({
                operationId: operationId(),
                name: "E16 Tor zwei",
                subtype: "gebaeude",
                position: { x: 437, y: 440 },
                wikiKey: E16_WIKI_KEY,
            });
            expect(nochmal.json()).toMatchObject({
                error: { code: "validation_failed", details: { field: "wikiKey" } },
            });
            // Der Zug aus Legacy fasst eine eigene Zuordnung nie an.
            expect(assignmentSpec().protectedWhere).toBe("t.source_system <> 'legacy'");
        });

        it("🔴 B-2: Die Zuweisung trägt ns und ns_name nach der Namensraum-Tafel der Umgebung; ohne Wiki-Adresse (Eigenkennung) bleiben beide leer", async () => {
            const schluessel = {
                inoffiziell: `${E16_WIKI_KEY}-inoffiziell`,
                eigenerRaum: `${E16_WIKI_KEY}-raum`,
                eigen: `${E16_WIKI_KEY}-eigen`,
                fremd: `${E16_WIKI_KEY}-fremd`,
            };
            const registry = (key: string, titel: string, url: string | null) => database`
                INSERT INTO wiki_settlement_registry (wiki_key, title, wiki_url, settlement_class)
                VALUES (${key}, ${titel}, ${url}, 'gebaeude')
            `;
            const raum = async (name: string, key: string, x: number) => {
                const antwort = await anlegen({
                    operationId: operationId(),
                    name,
                    subtype: "gebaeude",
                    position: { x, y: 441 },
                    wikiKey: key,
                });
                expect(antwort.statusCode, name).toBe(200);
                const id = antwort.json<OperationReceipt>().affected[0]!.id;
                const [zeile] = await database<{ ns: number | null; ns_name: string | null }[]>`
                    SELECT ns, ns_name FROM wiki_key_assignment WHERE object_public_id = ${id}::uuid AND is_active
                `;
                return zeile;
            };
            try {
                await registry(
                    schluessel.inoffiziell,
                    "Inoffiziell:E16 Tor",
                    "https://de.wiki-aventurica.de/wiki/Inoffiziell:E16_Tor_I",
                );
                await registry(schluessel.eigenerRaum, "E16Raum:Tor", "https://de.wiki-aventurica.de/wiki/E16Raum:Tor");
                await registry(schluessel.eigen, "E16 Eigen", null);
                await registry(schluessel.fremd, "E16 Fremd", "https://www.garetien.de/wiki/Inoffiziell:E16_Fremd");
                expect(await raum("E16 Tor I", schluessel.inoffiziell, 438)).toEqual({
                    ns: 222,
                    ns_name: "Inoffiziell",
                });
                // Ein Raum, den nur diese Umgebung in ihrer Tafel führt: Ohne die Zeile wäre „E16Raum:“ Teil des Titels im Hauptraum.
                await database`
                    INSERT INTO wiki_namespace_setting (ns, prefix, canon, collect, designator)
                    VALUES (4416, 'E16Raum', 'unofficial', false, '')
                `;
                expect(await raum("E16 Tor R", schluessel.eigenerRaum, 439)).toEqual({ ns: 4416, ns_name: "E16Raum" });
                // 🔴 Eigenkennung und fremde Adresse: kein Raum, nicht der Hauptraum.
                expect(await raum("E16 Tor E", schluessel.eigen, 440)).toEqual({ ns: null, ns_name: null });
                expect(await raum("E16 Tor F", schluessel.fremd, 441)).toEqual({ ns: null, ns_name: null });
            } finally {
                await database`DELETE FROM wiki_namespace_setting WHERE ns = 4416`;
                await database`DELETE FROM wiki_key_assignment WHERE wiki_key LIKE ${E16_WIKI_KEY + "-%"}`;
                await database`DELETE FROM wiki_settlement_registry WHERE wiki_key LIKE ${E16_WIKI_KEY + "-%"}`;
            }
        });

        it("🔴 ⊖ Von der Karte nehmen (Betreiber 2026-10-11): der Ort steht unter „Nicht auf der Karte“, Setzen holt DIESELBE Zeile zurück; mit Stätten nicht", async () => {
            const abnehmen = (id: string, baseRevision: number, role: Role = "editor") =>
                app.inject({
                    method: "POST",
                    url: editorPlaceTakeOffMapUrl(id),
                    headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
                    payload: { operationId: operationId(), baseRevision },
                });
            const neu = await anlegen({
                operationId: operationId(),
                name: "E16 Refugium",
                subtype: "gebaeude",
                kind: "Refugium",
                position: { x: 437, y: 441 },
            });
            const id = neu.json<OperationReceipt>().affected[0]!.id;
            await app.inject({
                method: "PATCH",
                url: editorPlaceUrl(id),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: { operationId: operationId(), baseRevision: 1, changes: { description: { value: "Still." } } },
            });
            const [vorher] = await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${id}::uuid`;

            // Ein Reviewer nicht, eine veraltete Revision nicht.
            expect((await abnehmen(id, 2, "reviewer")).statusCode).toBe(403);
            expect((await abnehmen(id, 1)).statusCode).toBe(409);

            const ab = await abnehmen(id, 2);
            expect(ab.statusCode).toBe(200);
            const quittung = ab.json<OperationReceipt>();
            expect(quittung.derivedWork).toContainEqual({ kind: "routing", state: "pending" });
            expect(quittung.mapRevision).toBeGreaterThan(0);
            const revision = quittung.affected[0]?.revision ?? 0;
            expect(revision).toBeGreaterThan(2);
            const ohne = await lesen(id);
            expect(ohne.position).toBeUndefined();
            expect(ohne.revision).toBe(revision);
            expect(ohne.fields.description.value).toBe("Still.");
            expect(ohne.kind).toBe("Refugium");
            expect((await liste()).rows.filter((row) => row.key === id).map((row) => row.origin)).toEqual([
                "ohne-lage",
            ]);
            // Ein zweites Mal geht nicht: Er steht schon nicht auf der Karte.
            expect((await abnehmen(id, revision)).statusCode).toBe(400);

            // Setzen holt die stillgelegte Zeile zurück (dieselbe id, mit ihr Wiki, Bilder, Einzelheiten).
            const gesetzt = await app.inject({
                method: "POST",
                url: editorPlaceMoveUrl(id),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: { operationId: operationId(), baseRevision: revision, to: { x: 438, y: 442 }, pathEnds: [] },
            });
            expect(gesetzt.statusCode).toBe(200);
            const [nachher] = await database<{ id: string; aktiv: boolean; x: number; description: string }[]>`
                SELECT p.id::text, p.is_active AS aktiv, ST_X(p.geom) AS x, d.description
                  FROM place p LEFT JOIN place_detail d ON d.place_id = p.id WHERE p.public_id = ${id}::uuid
            `;
            expect(nachher).toEqual({ id: vorher!.id, aktiv: true, x: 438, description: "Still." });
            expect((await liste()).rows.filter((row) => row.key === id).map((row) => row.origin)).toEqual(["karte"]);
            const wieder = await lesen(id);
            expect(wieder.position).toEqual({ x: 438, y: 442 });

            // Noch einmal ab und wieder drauf: Die stillgelegte Zeile ohne Lage kommt zurück (`public_id` ist eindeutig).
            const zweimal = await abnehmen(id, wieder.revision);
            expect(zweimal.statusCode).toBe(200);
            const [zeilen] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM place_unplaced WHERE public_id = ${id}::uuid
            `;
            expect(zeilen!.n).toBe(1);
            const protokoll = await database<{ action: string }[]>`
                SELECT action FROM map_audit_event WHERE place_public_id = ${id}::uuid ORDER BY id
            `;
            expect(protokoll.map((zeile) => zeile.action)).toEqual([
                "place.created",
                "place.updated",
                "place.taken_off_map",
                "place.placed",
                "place.taken_off_map",
            ]);
        });

        /**
         * Fehler 2026-10-12 („Vali's Heimat“: ⊖ antwortete 500, `map_audit_event_revision_forward`): Ein Ort wandert mit DERSELBEN
         * `public_id` zwischen `place` und `place_unplaced`, und jede Tafel zählte ihre Zeile für sich. Wurde der Ort dazwischen
         * bearbeitet, lag die zurückgeholte Zeile hinter der anderen, und die Revision des Objekts fiel zurück. Soll: Jeder Wechsel
         * geht, jede Quittung und jeder Protokolleintrag steht vorwärts, die Kette hat keine Lücke, keine Zeile beider Tafeln liegt
         * über dem Stand des Objekts.
         */
        describe("Revision über beide Tafeln (Fehler 2026-10-12)", () => {
            const senden = (method: "POST" | "PATCH", url: string, payload: object) =>
                app.inject({
                    method,
                    url,
                    headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                    payload: { operationId: operationId(), ...payload },
                });
            const abnehmen = (id: string, baseRevision: number) =>
                senden("POST", editorPlaceTakeOffMapUrl(id), { baseRevision });
            const setzen = (id: string, baseRevision: number, x: number, y: number) =>
                senden("POST", editorPlaceMoveUrl(id), { baseRevision, to: { x, y }, pathEnds: [] });
            const aendern = (id: string, baseRevision: number, changes: object) =>
                senden("PATCH", editorPlaceUrl(id), { baseRevision, changes });

            /** Die höchste Revision der Zeilen beider Tafeln mit dieser Kennung. */
            const hoechste = async (id: string): Promise<number> => {
                const [zeile] = await database<{ revision: number }[]>`
                    SELECT GREATEST((SELECT max(revision) FROM place WHERE public_id = ${id}::uuid),
                                    (SELECT max(revision) FROM place_unplaced WHERE public_id = ${id}::uuid))::int AS revision
                `;
                return zeile!.revision;
            };

            /** Führt Buch über die Quittungen: jede 200, jede vorwärts, keine Zeile beider Tafeln darüber. */
            function buch(id: string, start: number) {
                const quittungen = [start];
                return {
                    quittungen,
                    async weiter(antwort: Promise<LightMyRequestResponse>): Promise<number> {
                        const fertig = await antwort;
                        expect(fertig.statusCode, fertig.body).toBe(200);
                        const revision = fertig.json<OperationReceipt>().affected[0]?.revision ?? 0;
                        expect(revision).toBeGreaterThan(quittungen.at(-1)!);
                        quittungen.push(revision);
                        expect(await hoechste(id)).toBe(revision);
                        expect((await lesen(id)).revision).toBe(revision);
                        return revision;
                    },
                };
            }

            /** Das Protokoll des Orts als lückenlose Kette, deren Glieder den Quittungen entsprechen. */
            async function kette(id: string, quittungen: number[]): Promise<string[]> {
                const protokoll = await database<{ action: string; vorher: number | null; nachher: number }[]>`
                    SELECT action, revision_before::int AS vorher, revision_after::int AS nachher
                      FROM map_audit_event WHERE place_public_id = ${id}::uuid ORDER BY id
                `;
                protokoll.forEach((zeile, index) => {
                    if (index === 0) expect(zeile.vorher).toBeNull();
                    else {
                        expect(zeile.vorher, zeile.action).toBe(protokoll[index - 1]!.nachher);
                        expect(zeile.nachher, zeile.action).toBeGreaterThan(zeile.vorher!);
                    }
                });
                expect(protokoll.map((zeile) => zeile.nachher)).toEqual(quittungen);
                return protokoll.map((zeile) => zeile.action);
            }

            it("🔴 auf der Karte → ab → (bearbeitet) → drauf → (verschoben, umbenannt) → ab → drauf: jeder Wechsel geht, die Revision steigt", async () => {
                const neu = await anlegen({
                    operationId: operationId(),
                    name: "E16 Heimat",
                    subtype: "dorf",
                    position: { x: 440, y: 444 },
                });
                const id = neu.json<OperationReceipt>().affected[0]!.id;
                const { quittungen, weiter } = buch(id, 1);

                let revision = await weiter(abnehmen(id, 1));
                // Ohne Lage bearbeitet: Die Zeile ohne Lage läuft der stillgelegten in `place` davon.
                revision = await weiter(aendern(id, revision, { name: "E16 Heimat am Bach" }));
                revision = await weiter(aendern(id, revision, { description: { value: "Ein Dorf am Bach." } }));
                revision = await weiter(setzen(id, revision, 441, 445));
                // Auf der Karte bearbeitet: Jetzt läuft `place` der stillgelegten Zeile ohne Lage davon.
                revision = await weiter(setzen(id, revision, 442, 446));
                revision = await weiter(aendern(id, revision, { name: "E16 Heimat" }));
                revision = await weiter(abnehmen(id, revision));
                await weiter(setzen(id, revision, 443, 447));

                expect(await kette(id, quittungen)).toEqual([
                    "place.created",
                    "place.taken_off_map",
                    "place.updated",
                    "place.updated",
                    "place.placed",
                    "place.moved",
                    "place.updated",
                    "place.taken_off_map",
                    "place.placed",
                ]);
                const ort = await lesen(id);
                expect(ort).toMatchObject({ name: "E16 Heimat", position: { x: 443, y: 447 } });
                expect(ort.fields.description.value).toBe("Ein Dorf am Bach.");
            });

            it("🔴 ohne Lage angelegt, gesetzt, verschoben, dann ⊖ (der Fall „Vali's Heimat“): 200, die Revision steigt", async () => {
                const neu = await anlegen({ operationId: operationId(), name: "E16 Valis Heimat", subtype: "dorf" });
                const id = neu.json<OperationReceipt>().affected[0]!.id;
                const { quittungen, weiter } = buch(id, 1);

                let revision = await weiter(setzen(id, 1, 444, 448));
                revision = await weiter(setzen(id, revision, 445, 449));
                revision = await weiter(abnehmen(id, revision));
                await weiter(setzen(id, revision, 446, 450));

                expect(await kette(id, quittungen)).toEqual([
                    "place.created",
                    "place.placed",
                    "place.moved",
                    "place.taken_off_map",
                    "place.placed",
                ]);
            });
        });

        it("🔴 ⊖ mit Stätten (Legacys Bindung über den Namen) wartet auf E18: 400, nichts geschrieben", async () => {
            const neu = await anlegen({
                operationId: operationId(),
                name: "E16 Stadt mit Tempel",
                subtype: "stadt",
                position: { x: 439, y: 443 },
            });
            const id = neu.json<OperationReceipt>().affected[0]!.id;
            await database`
                INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, on_map, source_system)
                VALUES ('e16 stadt mit tempel', 'E16 Stadt mit Tempel', 'E16 Tempel', 'Tempel', FALSE, 'test-e16-staette')
            `;
            try {
                const ab = await app.inject({
                    method: "POST",
                    url: editorPlaceTakeOffMapUrl(id),
                    headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                    payload: { operationId: operationId(), baseRevision: 1 },
                });
                expect(ab.statusCode).toBe(400);
                expect(ab.json()).toMatchObject({ error: { details: { field: "staetten" } } });
                const [ort] = await database<{ aktiv: boolean }[]>`
                    SELECT is_active AS aktiv FROM place WHERE public_id = ${id}::uuid
                `;
                expect(ort!.aktiv).toBe(true);
            } finally {
                await database`DELETE FROM settlement_place WHERE source_system = 'test-e16-staette'`;
            }
        });

        // --- E22 „Ort entfernen“ (Betreiber 2026-10-12: „ort-entfernen-konzept ist prima, genau das wollte ich“) ---
        const post = (url: string, payload: object, role: Role = "editor") =>
            app.inject({
                method: "POST",
                url,
                headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
                payload,
            });
        const vorschau = (id: string) =>
            app.inject({
                method: "GET",
                url: editorPlaceRemovalUrl(id),
                headers: { cookie: cookies.get("editor") ?? "" },
            });

        it("🔴 E22 Ganz löschen ist weich: weg aus Liste und Vorschau, ↺ holt DIESELBE Zeile zurück, auch ohne Lage; Reviewer und veralteter Stand nicht", async () => {
            const neu = await anlegen({
                operationId: operationId(),
                name: "E22 Weiler",
                subtype: "dorf",
                position: { x: 441, y: 445 },
            });
            const id = neu.json<OperationReceipt>().affected[0]!.id;
            const [vorher] = await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${id}::uuid`;
            const davor = (await vorschau(id)).json<PlaceRemoval>();
            expect(davor).toMatchObject({
                publicId: id,
                name: "E22 Weiler",
                onMap: true,
                subtype: "dorf",
                position: { x: 441, y: 445 },
                staetten: [],
                kraftlinien: [],
                gebiete: [],
            });
            expect(davor.bleibt).toEqual({
                wiki: false,
                bilder: 0,
                quellen: 0,
                stadtplaene: 0,
                abenteuer: 0,
                bewertungen: 0,
            });

            expect(
                (await post(editorPlaceDeleteUrl(id), { operationId: operationId(), baseRevision: 1 }, "reviewer"))
                    .statusCode,
            ).toBe(403);
            expect(
                (await post(editorPlaceDeleteUrl(id), { operationId: operationId(), baseRevision: 9 })).statusCode,
            ).toBe(409);
            const loeschen = operationId();
            const weg = await post(editorPlaceDeleteUrl(id), { operationId: loeschen, baseRevision: 1 });
            expect(weg.statusCode).toBe(200);
            expect(weg.json<OperationReceipt>().derivedWork).toContainEqual({ kind: "routing", state: "pending" });
            expect((await liste()).rows.some((row) => row.key === id)).toBe(false);
            expect((await vorschau(id)).statusCode).toBe(404);
            const revision = weg.json<OperationReceipt>().affected[0]!.revision;
            expect(
                (await post(editorPlaceDeleteUrl(id), { operationId: operationId(), baseRevision: revision }))
                    .statusCode,
            ).toBe(400);

            // ↺: nur ein place.delete dieses Orts, dann dieselbe Zeile; ein zweites ↺ findet ihn schon da.
            expect(
                (await post(editorPlaceRestoreUrl(id), { operationId: operationId(), reverts: operationId() }))
                    .statusCode,
            ).toBe(400);
            const zurueck = await post(editorPlaceRestoreUrl(id), { operationId: operationId(), reverts: loeschen });
            expect(zurueck.statusCode).toBe(200);
            const [nachher] = await database<{ id: string; aktiv: boolean }[]>`
                SELECT id::text, is_active AS aktiv FROM place WHERE public_id = ${id}::uuid
            `;
            expect(nachher).toEqual({ id: vorher!.id, aktiv: true });
            expect((await liste()).rows.filter((row) => row.key === id).map((row) => row.origin)).toEqual(["karte"]);
            expect(
                (await post(editorPlaceRestoreUrl(id), { operationId: operationId(), reverts: loeschen })).statusCode,
            ).toBe(400);
            const protokoll = await database<{ action: string; changes: unknown }[]>`
                SELECT e.action, e.changes FROM map_audit_event e WHERE e.place_public_id = ${id}::uuid ORDER BY e.id
            `;
            expect(protokoll.map((zeile) => zeile.action)).toEqual([
                "place.created",
                "place.deleted",
                "place.restored",
            ]);
            expect(protokoll[1]!.changes).toEqual({ active: { before: true, after: false } });
            const [quelle] = await database<{ source: string }[]>`
                SELECT o.source FROM map_operation o JOIN map_audit_event e ON e.operation_id = o.operation_id
                 WHERE e.place_public_id = ${id}::uuid AND e.action = 'place.restored'
            `;
            expect(quelle!.source).toBe("restore");

            // Ein Ort ohne Lage: stillgelegt mit retired_origin = editor, ↺ holt ihn unter „Nicht auf der Karte“ zurück.
            const ohne = await anlegen({ operationId: operationId(), name: "E22 Ohne Lage", subtype: "dorf" });
            const ohneId = ohne.json<OperationReceipt>().affected[0]!.id;
            expect((await vorschau(ohneId)).json<PlaceRemoval>()).toMatchObject({ onMap: false, wegenden: [] });
            const ohneLoeschen = operationId();
            expect(
                (await post(editorPlaceDeleteUrl(ohneId), { operationId: ohneLoeschen, baseRevision: 1 })).statusCode,
            ).toBe(200);
            const [still] = await database<{ aktiv: boolean; herkunft: string }[]>`
                SELECT is_active AS aktiv, retired_origin AS herkunft FROM place_unplaced WHERE public_id = ${ohneId}::uuid
            `;
            expect(still).toEqual({ aktiv: false, herkunft: "editor" });
            expect((await liste()).rows.some((row) => row.key === ohneId)).toBe(false);
            expect(
                (await post(editorPlaceRestoreUrl(ohneId), { operationId: operationId(), reverts: ohneLoeschen }))
                    .statusCode,
            ).toBe(200);
            expect((await liste()).rows.filter((row) => row.key === ohneId).map((row) => row.origin)).toEqual([
                "ohne-lage",
            ]);
        });

        it("🔴 E22 eine Kraftlinie sperrt jedes Entfernen; Stätten bleiben beim Abnehmen mit „bleiben“, Löschen geht seit G2 auch mit ihnen; die Vorschau nennt Stätten, Gebiet und Kraftlinie", async () => {
            const neu = await anlegen({
                operationId: operationId(),
                name: "E22 Stadt",
                subtype: "stadt",
                position: { x: 443, y: 447 },
            });
            const id = neu.json<OperationReceipt>().affected[0]!.id;
            await database`
                INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, on_map, source_system)
                VALUES ('e22 stadt', 'E22 Stadt', 'E22 Tempel', 'Tempel', FALSE, 'test-e22')
            `;
            await database`
                INSERT INTO territory (public_id, map_domain_id, name, color, opacity, capital_place_public_id, source_system)
                VALUES (gen_random_uuid(), 'aventuria', 'E22 Grafschaft', '#336699', 0.5, ${id}::uuid, 'test-e22')
            `;
            await database`
                INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
                VALUES (gen_random_uuid(), 'aventuria', 'E22 Linie', ${id}::uuid, ${ORT}::uuid,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(443, 447), ST_MakePoint(431, 432)), 0),
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(443, 447), ST_MakePoint(431, 432)), 0), 'test-e22')
            `;
            const davor = (await vorschau(id)).json<PlaceRemoval>();
            expect(davor.staetten).toEqual([{ name: "E22 Tempel", art: "Tempel" }]);
            expect(davor.gebiete).toEqual([{ name: "E22 Grafschaft", rolle: "hauptstadt" }]);
            expect(davor.kraftlinien).toEqual([{ name: "E22 Linie", gegenueber: (await detail()).name }]);

            // Die Kraftlinie sperrt beides, auch mit „bleiben“.
            const ab = (staetten?: "bleiben") =>
                post(editorPlaceTakeOffMapUrl(id), {
                    operationId: operationId(),
                    baseRevision: 1,
                    ...(staetten ? { staetten } : {}),
                });
            expect((await ab("bleiben")).json()).toMatchObject({ error: { details: { field: "kraftlinien" } } });
            expect(
                (await post(editorPlaceDeleteUrl(id), { operationId: operationId(), baseRevision: 1 })).json(),
            ).toMatchObject({ error: { details: { field: "kraftlinien" } } });

            await database`DELETE FROM powerline WHERE source_system = 'test-e22'`;
            // Ohne Angabe fragt das Blatt erst; mit „bleiben“ geht es, die Stätte bleibt unberührt am Namen.
            expect((await ab()).json()).toMatchObject({ error: { details: { field: "staetten" } } });
            const mit = await ab("bleiben");
            expect(mit.statusCode).toBe(200);
            const [staette] = await database<{ aktiv: boolean; schluessel: string }[]>`
                SELECT is_active AS aktiv, settlement_key AS schluessel FROM settlement_place WHERE source_system = 'test-e22'
            `;
            expect(staette).toEqual({ aktiv: true, schluessel: "e22 stadt" });
            const ohne = (await vorschau(id)).json<PlaceRemoval>();
            expect(ohne).toMatchObject({ onMap: false, staetten: [{ name: "E22 Tempel", art: "Tempel" }] });

            // 🔴 Seit E22 G2 geht „Ganz löschen“ auch mit Stätten. Legacys namensgebundene Zeile bleibt dabei stehen: Sie
            // hängt am NAMEN, nicht an diesem Ort, und verschwindet von selbst aus jedem Leser, solange kein aktiver Ort so
            // heißt. Was über eine Kennung gebunden ist, geht still mit - das prüft `qr-ort-entfernen-staetten.test.ts`.
            const weg = await post(editorPlaceDeleteUrl(id), {
                operationId: operationId(),
                baseRevision: ohne.revision,
            });
            expect(weg.statusCode).toBe(200);
            const [danach] = await database<{ aktiv: boolean }[]>`
                SELECT is_active AS aktiv FROM settlement_place WHERE source_system = 'test-e22'
            `;
            expect(danach).toEqual({ aktiv: true });
        });
    });

    it("🔴 E17 Verlauf: jede Operation am Ort, neueste zuerst, mit Person, Feldern alt → neu und Revision; seitenweise; ↺ ist eine neue Operation (restore)", async () => {
        const lesen = async (url: string): Promise<MapHistoryPage> =>
            (
                await app.inject({ method: "GET", url, headers: { cookie: cookies.get("editor") ?? "" } })
            ).json<MapHistoryPage>();
        const verlauf = await lesen(editorPlaceHistoryUrl(ORT));
        expect(verlauf.entries.length).toBeGreaterThan(2);
        const seqs = verlauf.entries.map((eintrag) => eintrag.seq);
        expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
        const juengster = verlauf.entries[0]!;
        expect(juengster.actor).toMatchObject({ kind: "person", name: editorName, self: true });
        const ort = juengster.objects.find((gegenstand) => gegenstand.kind === "place");
        const name = (await detail()).name;
        expect(ort).toMatchObject({ id: ORT, name });
        expect(ort!.revisionAfter).toBe((await detail()).revision);
        // Ein Verschieben trägt seine Wegenden als eigene Gegenstände: Das Zurücknehmen braucht sie.
        const verschoben = verlauf.entries.find((eintrag) => eintrag.operation === "place.move");
        expect(verschoben?.objects.some((gegenstand) => gegenstand.kind === "path")).toBe(true);
        expect(verschoben?.objects.find((gegenstand) => gegenstand.kind === "place")?.changes).toHaveProperty(
            "position",
        );

        // Seitenweise: eine Zeile, dann ab dem Cursor die nächste.
        const erste = await lesen(`${editorPlaceHistoryUrl(ORT)}?limit=1`);
        expect(erste.entries).toHaveLength(1);
        expect(erste.next).toBe(erste.entries[0]!.seq);
        const zweite = await lesen(`${editorPlaceHistoryUrl(ORT)}?limit=1&before=${String(erste.next)}`);
        expect(zweite.entries[0]!.seq).toBeLessThan(erste.entries[0]!.seq);

        // ↺: eine neue Operation mit der Quelle restore, im Verlauf ganz oben.
        const jetzt = await detail();
        const zurueck = await patch({
            operationId: operationId(),
            baseRevision: jetzt.revision,
            reverts: juengster.operationId,
            changes: { hidden: !jetzt.hidden },
        });
        expect(zurueck.statusCode).toBe(200);
        const danach = await lesen(editorPlaceHistoryUrl(ORT));
        expect(danach.entries[0]).toMatchObject({
            source: "restore",
            summary: `${name}: Änderung zurückgenommen`,
        });

        // „Änderungen“: alle Operationen der Domäne, `mine` nur die eigenen.
        const alle = await lesen(`${EDITOR_CHANGES_URL}?limit=200`);
        expect(alle.entries.some((eintrag) => eintrag.operationId === danach.entries[0]!.operationId)).toBe(true);
        const meine = await lesen(`${EDITOR_CHANGES_URL}?mine=true&limit=200`);
        expect(meine.entries.every((eintrag) => eintrag.actor.self === true)).toBe(true);

        // Die Suche (Leiste jeder Liste, Guide §13.45): Ort, Feld, Person, ohne Groß und Klein; `%` ist ein Zeichen.
        const ruecknahme = danach.entries[0]!.operationId;
        const findet = async (frage: string): Promise<string[]> =>
            (await lesen(`${EDITOR_CHANGES_URL}?limit=200&${frage}`)).entries.map((eintrag) => eintrag.operationId);
        expect(await findet(`q=${encodeURIComponent(name.toUpperCase())}`), "nach dem Ort").toContain(ruecknahme);
        expect(await findet(`q=${encodeURIComponent(editorName.toLowerCase())}`), "nach der Person").toContain(
            ruecknahme,
        );
        expect(await findet("q=hidd"), "nach dem Schlüssel des Felds").toContain(ruecknahme);
        expect(await findet("q=Verborgen&qFelder=hidden"), "nach dem angezeigten Namen des Felds").toContain(
            ruecknahme,
        );
        expect(await findet("q=Verborgen"), "ohne qFelder kennt der Server den deutschen Namen nicht").not.toContain(
            ruecknahme,
        );
        expect(await findet("q=%25%25"), "% ist ein Zeichen, kein Muster").toEqual([]);
        expect(await findet("q=gibt-es-nicht-e17"), "kein Treffer").toEqual([]);
        expect(
            (
                await app.inject({
                    method: "GET",
                    url: `${EDITOR_CHANGES_URL}?q=a&qFelder=x%3By`,
                    headers: { cookie: cookies.get("editor") ?? "" },
                })
            ).statusCode,
            "qFelder nur als Liste von Schlüsseln",
        ).toBe(400);
        expect(
            (await app.inject({ method: "GET", url: EDITOR_CHANGES_URL })).statusCode,
            "ohne Anmeldung kein Protokoll",
        ).toBe(401);
    });

    it("🔴 MAP_EDITING aus: 423 map_editing_off an jeder Schreibroute", async () => {
        const aus = buildApp({
            config: { ...config, mapEditing: "off" },
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
        });
        await aus.ready();
        try {
            const headers = { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN };
            const a = await aus.inject({
                method: "PATCH",
                url: editorPlaceUrl(ORT),
                headers,
                payload: { operationId: operationId(), baseRevision: 9, changes: { hidden: false } },
            });
            const b = await aus.inject({
                method: "POST",
                url: editorPlaceMoveUrl(ORT),
                headers,
                payload: { operationId: operationId(), baseRevision: 9, to: { x: 1, y: 1 }, pathEnds: [] },
            });
            const c = await aus.inject({
                method: "POST",
                url: EDITOR_PLACES_URL,
                headers,
                payload: {
                    operationId: operationId(),
                    name: "E10 Neu aus",
                    subtype: "dorf",
                    position: { x: 433, y: 436 },
                },
            });
            expect([a.statusCode, b.statusCode, c.statusCode]).toEqual([423, 423, 423]);
            expect(a.json()).toMatchObject({ error: { code: "map_editing_off" } });
        } finally {
            await aus.close();
        }
    });
});
