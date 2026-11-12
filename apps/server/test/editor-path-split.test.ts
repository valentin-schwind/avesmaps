import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_PATHS_SAMMEL_DELETE_URL,
    EDITOR_PATHS_SAMMEL_TAKE_OFF_MAP_URL,
    EDITOR_PATHS_URL,
    editorPathDeleteUrl,
    editorPathHistoryUrl,
    editorPathRestoreSeriesUrl,
    editorPathUpdateUrl,
    editorPathPutOnMapUrl,
    editorPathRestoreUrl,
    editorPathSplitUrl,
    editorPathStreetDeleteUrl,
    editorPathStreetTakeOffMapUrl,
    editorPathStreetUrl,
    editorPathTakeOffMapUrl,
    type EditorPathList,
    type EditorPathStreet,
    type MapHistoryPage,
    type OperationReceipt,
    type PathSplitReceipt,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * „Weg hier teilen“, „Ganz löschen“ und ↺ (WI-0177 Stufe 3) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle: Teilen am Ende oder auf einem veralteten Stand; der hintere Teil verliert Reisemittel, Jahreszeiten, Wiki oder Quellen;
 * der Teilungspunkt fehlt in einem Teil, und die Wegfindung sieht eine Lücke; die Kennung des Wegs wandert (Links und Anker brechen);
 * Löschen ist hart oder nimmt Wiki und Quellen mit; ein Weg, den ein anderer bearbeitet, wird geteilt oder gelöscht. Stufe 3b: ein
 * abgenommener Weg bleibt in den Kacheln oder im Netz, verliert seine Linie oder kommt nicht zurück; ein gelöschter wird „zurück auf die
 * Karte“ geholt, als wäre er nur abgenommen. T49 (Abschnitte im Menü): die Abschnitte stehen in der Folge der Kennungen statt entlang der
 * Straße, ein Ende kennt seinen Ort nicht; „Ganze Straße“ schreibt einen Abschnitt und den anderen nicht, oder in mehreren Operationen.
 * T54 (Gelöschtes zurückholen): eine gelöschte Straße fehlt in Liste oder Straße, ihr Verlauf ist leer, ↺ holt nur einen Abschnitt
 * zurück, nimmt einen fremden mit, gilt für eine Operation, die kein Wechsel des Stands war, oder geht ohne das Recht.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0177-teilen";
const X0 = 757;
const Y0 = 233;
const WEG = "a1770177-0000-4000-8000-00000000b001";
const ORT = "a1770177-0000-4000-8000-00000000b0a1";
const WEG2 = "a1770177-0000-4000-8000-00000000b002";
const ORT2 = "a1770177-0000-4000-8000-00000000b0a2";
const FREMD = "a1770177-0000-4000-8000-00000000b003";
const ANDERE_KARTE = "a1770177-0000-4000-8000-00000000b004";
const EINZEL = "a1770177-0000-4000-8000-00000000b005";
/** Eine zweite Karte (Domäne) für die Sicherheitsprüfung OPS-000036: eine Kopie von Aventurien unter anderer Kennung. */
const ZWEITE_KARTE = "test-wi0177-zweite";

let zaehler = 0;
const operationId = (): string => `a1770177-0000-4000-9000-${String((zaehler += 1)).padStart(8, "0")}b0b0`;
const p = (dx: number, dy: number) => ({ x: X0 + dx, y: Y0 + dy });

describeWithDatabase("Weg teilen und entfernen (WI-0177 Stufe 3)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    const cookies = new Map<Role, string>();
    let quelle: string;

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };

    const neueWege = `source_system = 'avesmaps3d' AND geom && ST_MakeEnvelope(${String(X0 - 5)}, ${String(Y0 - 5)}, ${String(X0 + 30)}, ${String(Y0 + 30)}, 0)`;

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM job_event WHERE kind = 'map.changed' OR job_id IN (SELECT id FROM job WHERE kind = 'path_profile')`;
        await database`DELETE FROM job WHERE kind = 'path_profile'`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a1770177-0000-4000-9000-%b0b0'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a1770177-0000-4000-9000-%b0b0'`;
        const wege = `SELECT id FROM path WHERE source_system = '${SOURCE}' OR (${neueWege})`;
        for (const tafel of ["path_visual", "path_wiki_assignment", "path_source", "path_canon"])
            await database.unsafe(`DELETE FROM ${tafel} WHERE path_id IN (${wege})`);
        await database.unsafe(`DELETE FROM path WHERE source_system = '${SOURCE}' OR (${neueWege})`);
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ANY(${[WEG, WEG2]}::uuid[])`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    /** Ein zweiter Abschnitt derselben Straße, gegen die Richtung gespeichert: vom Zielort zurück an das Ende des ersten (T49). */
    async function legeZweiten(): Promise<void> {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT2}, 'aventuria', 'TW Zielort', 'dorf', ST_SetSRID(ST_MakePoint(${X0 + 20}, ${Y0}), 0), ${SOURCE}, TRUE)
        `;
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${WEG2}, 'aventuria', 'TW Handelsweg', 'Strasse', TRUE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${X0 + 20} ${Y0}, ${X0 + 16} ${Y0 + 1}, ${X0 + 12} ${Y0})`}, 0), ${SOURCE}, TRUE)
        `;
    }

    async function lege(): Promise<void> {
        await aufraeumen();
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT}, 'aventuria', 'TW Ort', 'dorf', ST_SetSRID(ST_MakePoint(${X0}, ${Y0}), 0), ${SOURCE}, TRUE)
        `;
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active,
                              allowed_transports, transport_domain, transport_seasons)
            VALUES (${WEG}, 'aventuria', 'TW Handelsweg', 'Strasse', TRUE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${X0} ${Y0}, ${X0 + 4} ${Y0 + 1}, ${X0 + 8} ${Y0 - 1}, ${X0 + 12} ${Y0})`}, 0),
                    ${SOURCE}, TRUE, ARRAY['groupFoot', 'horseCarriage'], 'land', ${database.json({ horseCarriage: { from: "Firun", to: "Tsa" } })})
        `;
        await database`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, assignment_state, assignment_origin, source_system)
            SELECT id, 'main', 'https://de.wiki-aventurica.de/wiki/TW_Handelsweg', 'address_only', 'editor', ${SOURCE}
              FROM path WHERE public_id = ${WEG}
        `;
        const [q] = await database<{ id: string }[]>`SELECT id::text FROM feature_source ORDER BY id LIMIT 1`;
        quelle = q?.id ?? "";
        if (quelle !== "")
            await database`
                INSERT INTO path_source (path_id, source_id, position, source_system)
                SELECT id, ${quelle}::bigint, 0, ${SOURCE} FROM path WHERE public_id = ${WEG}
            `;
    }

    const get = (url: string, role: Role = "editor") =>
        app.inject({ method: "GET", url, headers: { cookie: cookies.get(role) ?? "" } });
    const post = (url: string, body: object, role: Role = "editor") =>
        app.inject({
            method: "POST",
            url,
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: body,
        });
    /** ↺ aus dem Verlauf: die Rücknahme der Wege (`restore-series`, WI-0265 B6a) unter dem Abschnitt `abschnitt` für die Operation `op`. */
    const zuruecknehmen = (abschnitt: string, op: string, rolle: Role = "editor") =>
        post(
            editorPathRestoreSeriesUrl(abschnitt),
            { operationId: operationId(), members: [op], membersHash: mitgliederHash([op]) },
            rolle,
        );
    const weg = async (id: string) =>
        (
            await database<
                {
                    name: string;
                    subtype: string;
                    aktiv: boolean;
                    abgenommen: boolean;
                    revision: number;
                    g: string;
                    reisemittel: string[] | null;
                    jahreszeiten: unknown;
                    wiki: number;
                    quellen: number;
                }[]
            >`
                SELECT p.name, p.subtype, p.is_active AS aktiv, p.off_map AS abgenommen, p.revision::int AS revision,
                       ST_AsGeoJSON(p.geom, 15) AS g,
                       p.allowed_transports AS reisemittel, p.transport_seasons AS jahreszeiten,
                       (SELECT count(*)::int FROM path_wiki_assignment w WHERE w.path_id = p.id AND w.is_active) AS wiki,
                       (SELECT count(*)::int FROM path_source s WHERE s.path_id = p.id AND s.is_active) AS quellen
                  FROM path p WHERE p.public_id = ${id}::uuid
            `
        )[0]!;
    const punkte = (g: string) => (JSON.parse(g) as { coordinates: [number, number][] }).coordinates;

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
            const person = await fixture.person(role, { name: `Teilen ${role}` });
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

    it("🔴 path.split: vorne behält die Kennung, hinten ist neu mit allen Feldern, Wiki und Quellen; der Teilungspunkt in beiden", async () => {
        await lege();
        const antwort = await post(editorPathSplitUrl(WEG), {
            operationId: operationId(),
            baseRevision: 1,
            index: 2,
            at: p(8, -1),
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<PathSplitReceipt>();
        expect(quittung.affected.map((a) => a.id)).toEqual([WEG, quittung.publicId]);
        const vorne = await weg(WEG);
        const hinten = await weg(quittung.publicId);
        expect(punkte(vorne.g)).toEqual([
            [X0, Y0],
            [X0 + 4, Y0 + 1],
            [X0 + 8, Y0 - 1],
        ]);
        expect(punkte(hinten.g)).toEqual([
            [X0 + 8, Y0 - 1],
            [X0 + 12, Y0],
        ]);
        expect(vorne).toMatchObject({ name: "TW Handelsweg", subtype: "Strasse", aktiv: true, revision: 2 });
        expect(hinten).toMatchObject({
            name: "TW Handelsweg",
            subtype: "Strasse",
            aktiv: true,
            reisemittel: ["groupFoot", "horseCarriage"],
            jahreszeiten: { horseCarriage: { from: "Firun", to: "Tsa" } },
            wiki: 1,
            quellen: quelle === "" ? 0 : 1,
        });
        // Die Enden am Teilungspunkt hängen aneinander (Ende an Ende), ohne Kreuzungsobjekt.
        expect(quittung.ends.vorne.start).toMatchObject({ kind: "place", publicId: ORT });
        expect(quittung.ends.vorne.end).toMatchObject({ kind: "path", publicId: quittung.publicId, contact: "ende" });
        expect(quittung.ends.hinten.start).toMatchObject({ kind: "path", publicId: WEG, contact: "ende" });
        const protokoll = await database<{ action: string }[]>`
            SELECT e.action FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE o.action = 'path.split' AND o.operation_id::text LIKE 'a1770177-0000-4000-9000-%b0b0' ORDER BY e.id
        `;
        expect(protokoll.map((e) => e.action)).toEqual(["path.split", "path.created"]);
    });

    it("Teilen: nie an einem Ende, nie mit veraltetem Stand oder anderem Stützpunkt; ein Reviewer teilt nicht", async () => {
        await lege();
        const am = (index: number, at: { x: number; y: number }, baseRevision = 1) =>
            post(editorPathSplitUrl(WEG), { operationId: operationId(), baseRevision, index, at });
        expect((await am(3, p(12, 0))).statusCode).toBe(400);
        expect((await am(2, p(8, -1), 7)).statusCode).toBe(409);
        expect((await am(2, p(4, 1))).statusCode).toBe(409);
        expect(
            (
                await post(
                    editorPathSplitUrl(WEG),
                    { operationId: operationId(), baseRevision: 1, index: 2, at: p(8, -1) },
                    "reviewer",
                )
            ).statusCode,
        ).toBe(403);
        expect((await weg(WEG)).revision).toBe(1);
        const [neu] = await database.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM path WHERE ${neueWege}`);
        expect(neu?.n).toBe(0);
    });

    it("🔴 „Ganz löschen“ ist weich und behält Wiki und Quellen; ↺ holt den Weg zurück; beides gegen die Revision", async () => {
        await lege();
        const geloescht = await post(editorPathDeleteUrl(WEG), { operationId: operationId(), baseRevision: 1 });
        expect(geloescht.statusCode).toBe(200);
        expect(await weg(WEG)).toMatchObject({ aktiv: false, wiki: 1 });
        expect((await post(editorPathDeleteUrl(WEG), { operationId: operationId(), baseRevision: 1 })).statusCode).toBe(
            409,
        );
        const revision = (await weg(WEG)).revision;
        const zurueck = await post(editorPathRestoreUrl(WEG), { operationId: operationId(), baseRevision: revision });
        expect(zurueck.statusCode).toBe(200);
        expect(await weg(WEG)).toMatchObject({ aktiv: true, wiki: 1 });
    });

    it("🔴 „Von der Karte nehmen“ (3b): raus aus Kacheln und Netz, Linie, Wiki und Quellen bleiben; nur „zurück auf die Karte“ holt ihn", async () => {
        await lege();
        const linie = (await weg(WEG)).g;
        const inKacheln = async () =>
            (
                await database<
                    { n: number }[]
                >`SELECT count(*)::int AS n FROM path_render WHERE public_id = ${WEG}::uuid`
            )[0]?.n;
        expect(await inKacheln()).toBe(1);
        expect(
            (await post(editorPathTakeOffMapUrl(WEG), { operationId: operationId(), baseRevision: 1 }, "reviewer"))
                .statusCode,
        ).toBe(403);
        const ab = await post(editorPathTakeOffMapUrl(WEG), { operationId: operationId(), baseRevision: 1 });
        expect(ab.statusCode).toBe(200);
        expect(await weg(WEG)).toMatchObject({ aktiv: false, abgenommen: true, g: linie, wiki: 1 });
        expect(await inKacheln()).toBe(0);
        const [eintrag] = await database<{ action: string; changes: unknown }[]>`
            SELECT action, changes FROM map_audit_event
             WHERE path_public_id = ${WEG}::uuid AND operation_id::text LIKE 'a1770177-0000-4000-9000-%b0b0' ORDER BY id DESC LIMIT 1
        `;
        expect(eintrag).toEqual({
            action: "path.taken_off_map",
            changes: { active: { before: true, after: false }, offMap: { before: false, after: true } },
        });
        // ↺ gilt nur einem gelöschten Weg; ein abgenommener kommt über „zurück auf die Karte“.
        let revision = (await weg(WEG)).revision;
        const falsch = await post(editorPathRestoreUrl(WEG), { operationId: operationId(), baseRevision: revision });
        expect(falsch.statusCode).toBe(400);
        expect(falsch.json<{ error: { message: string } }>().error.message).toBe(
            "Dieser Weg ist von der Karte genommen.",
        );
        const zurueck = await post(editorPathPutOnMapUrl(WEG), { operationId: operationId(), baseRevision: revision });
        expect(zurueck.statusCode).toBe(200);
        expect(await weg(WEG)).toMatchObject({ aktiv: true, abgenommen: false, g: linie });
        expect(await inKacheln()).toBe(1);
        // Abgenommen und dann ganz gelöscht: dann ist er gelöscht, nicht mehr „nicht auf der Karte“, und nur ↺ holt ihn.
        revision = (await weg(WEG)).revision;
        expect(
            (await post(editorPathTakeOffMapUrl(WEG), { operationId: operationId(), baseRevision: revision }))
                .statusCode,
        ).toBe(200);
        revision = (await weg(WEG)).revision;
        expect(
            (await post(editorPathDeleteUrl(WEG), { operationId: operationId(), baseRevision: revision })).statusCode,
        ).toBe(200);
        expect(await weg(WEG)).toMatchObject({ aktiv: false, abgenommen: false });
        revision = (await weg(WEG)).revision;
        expect(
            (await post(editorPathPutOnMapUrl(WEG), { operationId: operationId(), baseRevision: revision })).statusCode,
        ).toBe(400);
    });

    it("🔴 die Straße (T49): Abschnitte entlang der Straße mit dem Ort an jedem Ende, gleich von welchem Abschnitt gelesen", async () => {
        await lege();
        await legeZweiten();
        for (const von of [WEG, WEG2]) {
            const strasse = (await get(editorPathStreetUrl(von))).json<EditorPathStreet>();
            expect(strasse.segments.map((a) => [a.id, a.von, a.bis])).toEqual([
                [WEG, "TW Ort", undefined],
                [WEG2, undefined, "TW Zielort"],
            ]);
        }
    });

    it("🔴 „Ganze Straße“ (T49): EINE Operation über alle Abschnitte, jeder gegen seine Revision; geht einer nicht, geht keiner", async () => {
        await lege();
        await legeZweiten();
        const alle = (revision2 = 1) => [
            { publicId: WEG, baseRevision: 1 },
            { publicId: WEG2, baseRevision: revision2 },
        ];
        // Ein Abschnitt veraltet: 409, und auch der andere bleibt.
        const veraltet = await post(editorPathStreetDeleteUrl(WEG), { operationId: operationId(), sections: alle(7) });
        expect(veraltet.statusCode).toBe(409);
        expect(await weg(WEG)).toMatchObject({ aktiv: true, revision: 1 });
        // Der Abschnitt der Adresse muss dabei sein.
        const fremd = await post(editorPathStreetDeleteUrl(WEG), {
            operationId: operationId(),
            sections: [{ publicId: WEG2, baseRevision: 1 }],
        });
        expect(fremd.statusCode).toBe(400);
        // 🔴 Nur die Straße der Route (Sicherheitsprüfung OPS-000036): ein fremder Weg ist 400, ein fehlender Abschnitt 409.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${FREMD}, 'aventuria', 'TW Anderer Weg', 'Pfad', TRUE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${X0} ${Y0 + 5}, ${X0 + 5} ${Y0 + 5})`}, 0), ${SOURCE})
        `;
        const mitFremdem = await post(editorPathStreetDeleteUrl(WEG), {
            operationId: operationId(),
            sections: [...alle(), { publicId: FREMD, baseRevision: 1 }],
        });
        expect(mitFremdem.statusCode).toBe(400);
        expect(await weg(FREMD)).toMatchObject({ aktiv: true });
        // Derselbe Name und dieselbe Art auf einer anderen Karte: kein Abschnitt dieser Straße.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${ANDERE_KARTE}, ${ZWEITE_KARTE}, 'TW Handelsweg', 'Strasse', TRUE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${X0} ${Y0 + 7}, ${X0 + 5} ${Y0 + 7})`}, 0), ${SOURCE})
        `;
        const andereKarte = await post(editorPathStreetDeleteUrl(WEG), {
            operationId: operationId(),
            sections: [...alle(), { publicId: ANDERE_KARTE, baseRevision: 1 }],
        });
        expect(andereKarte.statusCode).toBe(400);
        expect(await weg(ANDERE_KARTE)).toMatchObject({ aktiv: true });
        expect(await weg(WEG)).toMatchObject({ aktiv: true, revision: 1 });
        const ohneZweiten = await post(editorPathStreetDeleteUrl(WEG), {
            operationId: operationId(),
            sections: [{ publicId: WEG, baseRevision: 1 }],
        });
        expect(ohneZweiten.statusCode).toBe(409);
        // Abnehmen braucht dasselbe Recht wie je Abschnitt.
        expect(
            (
                await post(
                    editorPathStreetTakeOffMapUrl(WEG),
                    { operationId: operationId(), sections: alle() },
                    "reviewer",
                )
            ).statusCode,
        ).toBe(403);
        const id = operationId();
        const ab = await post(editorPathStreetTakeOffMapUrl(WEG2), { operationId: id, sections: alle() });
        expect(ab.statusCode).toBe(200);
        expect(ab.json<{ affected: { id: string }[] }>().affected.map((a) => a.id)).toEqual([WEG, WEG2]);
        expect(await weg(WEG)).toMatchObject({ aktiv: false, abgenommen: true });
        expect(await weg(WEG2)).toMatchObject({ aktiv: false, abgenommen: true });
        const [{ operationen, eintraege } = { operationen: 0, eintraege: 0 }] = await database<
            { operationen: number; eintraege: number }[]
        >`
            SELECT (SELECT count(*)::int FROM map_operation WHERE operation_id = ${id}::uuid) AS operationen,
                   (SELECT count(*)::int FROM map_audit_event WHERE operation_id = ${id}::uuid) AS eintraege
        `;
        expect({ operationen, eintraege }).toEqual({ operationen: 1, eintraege: 2 });
        // Ganz löschen danach: beide gelöscht, nicht mehr „nicht auf der Karte“.
        const geloescht = await post(editorPathStreetDeleteUrl(WEG), {
            operationId: operationId(),
            sections: [
                { publicId: WEG, baseRevision: (await weg(WEG)).revision },
                { publicId: WEG2, baseRevision: (await weg(WEG2)).revision },
            ],
        });
        expect(geloescht.statusCode).toBe(200);
        expect(await weg(WEG2)).toMatchObject({ aktiv: false, abgenommen: false });
    });

    it("🔴 Mehrfachauswahl (WI-0252): „Ganz löschen“ und „Von der Karte nehmen“ für mehrere Wege in EINER Operation; fehlt ein Abschnitt, steht eine Sperre oder ein Reviewer davor, bleibt alles; ↺ holt alle zurück", async () => {
        await lege();
        await legeZweiten();
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${FREMD}, 'aventuria', 'TW Anderer Weg', 'Pfad', TRUE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${X0} ${Y0 + 5}, ${X0 + 5} ${Y0 + 5})`}, 0), ${SOURCE})
        `;
        const alle = [
            { publicId: WEG, baseRevision: 1 },
            { publicId: WEG2, baseRevision: 1 },
            { publicId: FREMD, baseRevision: 1 },
        ];
        const loeschen = (sections: object[], rolle: Role = "editor") =>
            post(EDITOR_PATHS_SAMMEL_DELETE_URL, { operationId: operationId(), sections }, rolle);
        const unberuehrt = async () => {
            for (const id of [WEG, WEG2, FREMD]) expect(await weg(id)).toMatchObject({ aktiv: true, revision: 1 });
        };

        // Fehlt der Weg ein Abschnitt (die Straße hat sich seit dem Lesen geändert): 409, auch der andere Weg bleibt.
        expect((await loeschen([alle[0]!, alle[2]!])).statusCode).toBe(409);
        // Ein veralteter Abschnitt: 409. Ein doppelter: 400. Ohne das Recht: 403.
        expect((await loeschen([alle[0]!, { ...alle[1]!, baseRevision: 7 }, alle[2]!])).statusCode).toBe(409);
        expect((await loeschen([...alle, alle[2]!])).statusCode).toBe(400);
        expect((await loeschen(alle, "reviewer")).statusCode).toBe(403);
        expect(
            (
                await post(
                    EDITOR_PATHS_SAMMEL_TAKE_OFF_MAP_URL,
                    { operationId: operationId(), sections: alle },
                    "reviewer",
                )
            ).statusCode,
        ).toBe(403);
        // Ein Weg auf einer anderen Karte liegt nicht in dieser Auswahl.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${ANDERE_KARTE}, ${ZWEITE_KARTE}, 'TW Dritter Weg', 'Pfad', TRUE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${X0} ${Y0 + 7}, ${X0 + 5} ${Y0 + 7})`}, 0), ${SOURCE})
        `;
        expect((await loeschen([...alle, { publicId: ANDERE_KARTE, baseRevision: 1 }])).statusCode).toBe(400);
        expect(await weg(ANDERE_KARTE)).toMatchObject({ aktiv: true });
        // Hält ein anderer einen der Wege, schreibt die Auswahl nicht über seinen Entwurf hinweg.
        const anderer = await authFixture(database).person("editor", { name: "Sammel anderer" });
        await database`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${FREMD}::uuid, 'form', ${anderer.id}::uuid, 'Sammel anderer', gen_random_uuid())
        `;
        const gesperrt = await loeschen(alle);
        expect(gesperrt.statusCode).toBe(409);
        expect(gesperrt.json<{ error: { code: string } }>().error.code).toBe("object_locked");
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ${FREMD}::uuid`;
        await unberuehrt();

        // Ganz löschen: alle drei Abschnitte zweier Wege, EINE Operation mit drei Einträgen, Wegfindung steht aus wie beim einzelnen Löschen.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${EINZEL}, 'aventuria', 'TW Einzelweg', 'Pfad', TRUE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${X0} ${Y0 + 9}, ${X0 + 5} ${Y0 + 9})`}, 0), ${SOURCE})
        `;
        const einzel = await post(editorPathDeleteUrl(EINZEL), { operationId: operationId(), baseRevision: 1 });
        expect(einzel.statusCode).toBe(200);
        const id = operationId();
        const geloescht = await post(EDITOR_PATHS_SAMMEL_DELETE_URL, { operationId: id, sections: alle });
        expect(geloescht.statusCode).toBe(200);
        const quittung = geloescht.json<OperationReceipt>();
        expect(quittung.affected.map((a) => a.id).sort()).toEqual([WEG, WEG2, FREMD].sort());
        // Dieselbe abgeleitete Arbeit wie beim einzelnen Löschen (Wegfindung, Profil, Namen, Kacheln), die Namen je Straße.
        const arten = (receipt: OperationReceipt) => [...new Set(receipt.derivedWork.map((w) => w.kind))].sort();
        expect(arten(quittung)).toEqual(arten(einzel.json<OperationReceipt>()));
        expect(quittung.derivedWork).toContainEqual({ kind: "routing", state: "pending" });
        for (const kennung of [WEG, WEG2, FREMD])
            expect(await weg(kennung)).toMatchObject({ aktiv: false, abgenommen: false, revision: 2 });
        const [stand] = await database<{ operationen: number; eintraege: number; zusammenfassung: string }[]>`
            SELECT (SELECT count(*)::int FROM map_operation WHERE operation_id = ${id}::uuid) AS operationen,
                   (SELECT count(*)::int FROM map_audit_event WHERE operation_id = ${id}::uuid) AS eintraege,
                   (SELECT summary FROM map_operation WHERE operation_id = ${id}::uuid) AS zusammenfassung
        `;
        expect(stand).toEqual({ operationen: 1, eintraege: 3, zusammenfassung: "2 Wege: 3 Abschnitte gelöscht" });
        const [operation] = await database<{ action: string }[]>`
            SELECT action FROM map_operation WHERE operation_id = ${id}::uuid
        `;
        expect(operation?.action).toBe("path.delete");

        // ↺ im Verlauf einer der Straßen (WI-0265 B6a): ein Weg, den die Operation nie berührte, ist nicht von hier (400); sonst holt die Rücknahme alle Abschnitte der Operation in EINER Operation zurück.
        const nachher = [
            { publicId: WEG, baseRevision: 2 },
            { publicId: WEG2, baseRevision: 2 },
            { publicId: FREMD, baseRevision: 2 },
        ];
        expect((await zuruecknehmen(EINZEL, id)).statusCode).toBe(400);
        const zurueckgeholt = await zuruecknehmen(WEG, id);
        expect(zurueckgeholt.statusCode, zurueckgeholt.body).toBe(200);
        for (const kennung of [WEG, WEG2, FREMD])
            expect(await weg(kennung)).toMatchObject({ aktiv: true, abgenommen: false, revision: 3 });

        // Von der Karte nehmen: dieselbe Auswahl, ein Wechsel des Stands „abgenommen“, nicht gelöscht.
        const abgenommen = await post(EDITOR_PATHS_SAMMEL_TAKE_OFF_MAP_URL, {
            operationId: operationId(),
            sections: nachher.map((teil) => ({ ...teil, baseRevision: 3 })),
        });
        expect(abgenommen.statusCode).toBe(200);
        for (const kennung of [WEG, WEG2, FREMD])
            expect(await weg(kennung)).toMatchObject({ aktiv: false, abgenommen: true });
    });

    it("🔴 hält ein anderer den Weg, teilt und löscht niemand sonst (409 object_locked)", async () => {
        await lege();
        const fixture = authFixture(database);
        const anderer = await fixture.person("editor", { name: "Teilen anderer" });
        await database`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${WEG}::uuid, 'form', ${anderer.id}::uuid, 'Teilen anderer', gen_random_uuid())
        `;
        const antwort = await post(editorPathDeleteUrl(WEG), { operationId: operationId(), baseRevision: 1 });
        expect(antwort.statusCode).toBe(409);
        expect(antwort.json<{ error: { code: string } }>().error.code).toBe("object_locked");
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ${WEG}::uuid`;
    });

    it("🔴 Gelöschtes zurückholen (T54): Liste, Straße und Verlauf kennen die gelöschte Straße; ↺ holt alle Abschnitte in EINER Operation", async () => {
        await lege();
        await legeZweiten();
        const geloescht = operationId();
        const loeschen = await post(editorPathStreetDeleteUrl(WEG), {
            operationId: geloescht,
            sections: [
                { publicId: WEG, baseRevision: 1 },
                { publicId: WEG2, baseRevision: 1 },
            ],
        });
        expect(loeschen.statusCode).toBe(200);
        // Liste und Straße: eine Zeile mit `deleted`, beide Abschnitte, das Fenster liest nur.
        const zeile = (await get(EDITOR_PATHS_URL)).json<EditorPathList>().rows.find((r) => [WEG, WEG2].includes(r.id));
        expect(zeile).toMatchObject({ name: "TW Handelsweg", segments: 2, deleted: true });
        expect(zeile).not.toHaveProperty("offMap");
        const strasse = (await get(editorPathStreetUrl(WEG2))).json<EditorPathStreet>();
        expect(strasse.deleted).toBe(true);
        expect(strasse.segments.map((a) => a.id).sort()).toEqual([WEG, WEG2].sort());
        // Der Verlauf der Straße nennt das Löschen mit beiden Abschnitten.
        const verlauf = (await get(editorPathHistoryUrl(WEG))).json<MapHistoryPage>();
        expect(verlauf.entries[0]).toMatchObject({ operationId: geloescht, operation: "path.delete" });
        expect(verlauf.entries[0]!.objects.map((g) => g.action)).toEqual(["path.deleted", "path.deleted"]);

        // Ein Abschnitt, den die Operation nie berührte (ein anderer Weg): 400; ohne das Recht am Objekt: 403. Keiner kommt dabei zurück.
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${FREMD}, 'aventuria', 'TW Anderer Weg', 'Pfad', TRUE, FALSE,
                    ST_GeomFromText(${`LINESTRING(${X0} ${Y0 + 5}, ${X0 + 5} ${Y0 + 5})`}, 0), ${SOURCE})
        `;
        expect((await zuruecknehmen(FREMD, geloescht)).statusCode).toBe(400);
        expect((await zuruecknehmen(WEG, geloescht, "reviewer")).statusCode).toBe(403);
        expect(await weg(WEG)).toMatchObject({ aktiv: false, abgenommen: false, revision: 2 });

        const geholt = await zuruecknehmen(WEG2, geloescht);
        expect(geholt.statusCode, geholt.body).toBe(200);
        expect(await weg(WEG)).toMatchObject({ aktiv: true, revision: 3 });
        expect(await weg(WEG2)).toMatchObject({ aktiv: true, revision: 3 });
        const [operation] = await database<{ action: string; source: string }[]>`
            SELECT action, source FROM map_operation WHERE operation_id = ${geholt.json<{ operationId: string }>().operationId}::uuid
        `;
        expect(operation).toEqual({ action: "path.restore_series", source: "restore" });

        // Auch die Felder gehen über dieselbe Rücknahme (Quelle restore).
        const umbenannt = operationId();
        const aendern = await post(editorPathUpdateUrl(WEG), {
            operationId: umbenannt,
            sections: [
                { publicId: WEG, baseRevision: 3 },
                { publicId: WEG2, baseRevision: 3 },
            ],
            name: "TW Handelsweg neu",
        });
        expect(aendern.statusCode).toBe(200);
        const felder = await zuruecknehmen(WEG, umbenannt);
        expect(felder.statusCode, felder.body).toBe(200);
        const [rueck] = await database<{ source: string }[]>`
            SELECT source FROM map_operation WHERE operation_id = ${felder.json<{ operationId: string }>().operationId}::uuid
        `;
        expect(rueck?.source).toBe("restore");
        expect(await weg(WEG)).toMatchObject({ name: "TW Handelsweg", aktiv: true });
    });
});
