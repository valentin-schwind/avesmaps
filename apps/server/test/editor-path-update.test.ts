import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
    allowedTransportsForPath,
    AVENTURIA_TRAVEL_MODEL,
    EditorPathStreet,
    editorPathStreetUrl,
    editorPathUpdateUrl,
    pathSeasonWindow,
    type PathReisenBody,
    type PathUpdateBody,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { loadRouteGraphRows } from "../src/routing/network.ts";
import { changedParts, readRoutingRevision } from "../src/routing/revision.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * `path.update`: die Felder der ganzen Straße (WI-0177 W5b) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle: Ein Abschnitt bekommt den neuen Namen, der andere nicht (die Straße zerfällt); eine fremde Änderung an einem Abschnitt
 * wird überschrieben; ein Abschnitt, der inzwischen dazukam oder fehlt, bleibt unbemerkt; ein Flussweg wird zur Straße (Bach, Strömung
 * und Reisemittel des Wassers hingen dann an einem Landweg); ein Reviewer schreibt; ein anderer hält einen Abschnitt; die Revision zählt
 * auch ohne Änderung; das Protokoll nennt nicht, was sich änderte. Reisemittel (Migration 0208, F16 „A“): Der Karren erbt trotz
 * Abwahl von der Kutsche; ein Mittel, das der Wegtyp nicht anbietet, oder ein Fenster außerhalb der Liste wird gespeichert; ↺ holt den
 * Stand mit Erbe nicht zurück.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0177-w5b";
const P = "a1770177-0000-4000-8000-0000000005";
const A = { s1: `${P}b1`, s2: `${P}b2`, fluss: `${P}c1`, andere: `${P}d1`, karte2: `${P}e1` } as const;
/** Eine zweite Karte (Domäne) für die Sicherheitsprüfung OPS-000036: eine Kopie von Aventurien unter anderer Kennung. */
const ZWEITE_KARTE = "test-wi0177-zweite";

let zaehler = 0;
const operationId = (): string => `a1770177-0000-4000-9000-${String((zaehler += 1)).padStart(8, "0")}5b5b`;

describeWithDatabase("path.update: Felder der Straße (WI-0177 W5b)", { timeout: 120_000 }, () => {
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
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a1770177-0000-4000-9000-%5b5b'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a1770177-0000-4000-9000-%5b5b'`;
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ANY(${Object.values(A)}::uuid[])`;
        await database`DELETE FROM path_visual WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM field_origin WHERE object_kind = 'path' AND object_id = ANY(${Object.values(A)}::uuid[])`;
        await database`DELETE FROM path_wiki_assignment WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM wiki_path_snapshot WHERE wiki_key = 'w5b-kronweg' OR wiki_key LIKE 'w5b-weiter-%'`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
    }

    async function lege(): Promise<void> {
        await aufraeumen();
        const weg = (id: string, name: string, subtype: string, sichtbar: boolean, x: number) => database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${id}, 'aventuria', ${name}, ${subtype}, ${sichtbar}, FALSE,
                    ST_GeomFromText(${`LINESTRING(${String(x)} 300, ${String(x + 5)} 301)`}, 0), ${SOURCE})
        `;
        await weg(A.s1, "W5b Handelsweg", "Strasse", true, 700);
        await weg(A.s2, "W5b Handelsweg", "Strasse", false, 705);
        await weg(A.fluss, "W5b Fluss", "Flussweg", true, 710);
        await weg(A.andere, "W5b Schon da", "Pfad", true, 720);
    }

    const zeilen = async () =>
        database<{ id: string; name: string; subtype: string; sichtbar: boolean; revision: number }[]>`
            SELECT public_id::text AS id, name, subtype, label_visible AS sichtbar, revision::int AS revision
              FROM path WHERE source_system = ${SOURCE} ORDER BY public_id
        `;
    const post = (url: string, body: Partial<PathUpdateBody>, role: Role = "editor") =>
        app.inject({
            method: "POST",
            url,
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: { operationId: operationId(), ...body },
        });
    const strasse = [
        { publicId: A.s1, baseRevision: 1 },
        { publicId: A.s2, baseRevision: 1 },
    ];

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
            const person = await fixture.person(role, { name: `W5b ${role}` });
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

    it("🔴 Name, Wegart und „Name auf der Karte“ für ALLE Abschnitte in EINER Operation, jeder mit seiner Revision", async () => {
        await lege();
        const id = operationId();
        const antwort = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(A.s2),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: id,
                sections: strasse,
                name: " W5b Neuer Weg ",
                subtype: "Reichsstrasse",
                labelVisible: true,
            },
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<{
            affected: { id: string; revision: number }[];
            derivedWork: { kind: string }[];
        }>();
        expect(quittung.affected.map((a) => a.id).sort()).toEqual([A.s1, A.s2]);
        expect(quittung.derivedWork).toContainEqual({ kind: "routing", state: "pending" });
        expect((await zeilen()).filter((z) => z.id === A.s1 || z.id === A.s2)).toEqual([
            { id: A.s1, name: "W5b Neuer Weg", subtype: "Reichsstrasse", sichtbar: true, revision: 2 },
            { id: A.s2, name: "W5b Neuer Weg", subtype: "Reichsstrasse", sichtbar: true, revision: 2 },
        ]);
        const protokoll = await database<{ path: string; changes: Record<string, unknown> }[]>`
            SELECT path_public_id::text AS path, changes FROM map_audit_event WHERE operation_id = ${id}::uuid ORDER BY path_public_id
        `;
        expect(protokoll).toEqual([
            {
                path: A.s1,
                changes: {
                    name: { before: "W5b Handelsweg", after: "W5b Neuer Weg" },
                    subtype: { before: "Strasse", after: "Reichsstrasse" },
                    // Getippt und gewählt: Herkunft manual an jedem Abschnitt (WI-0225 §7).
                    nameOrigin: { before: null, after: "manual" },
                    subtypeOrigin: { before: null, after: "manual" },
                },
            },
            {
                path: A.s2,
                changes: {
                    name: { before: "W5b Handelsweg", after: "W5b Neuer Weg" },
                    subtype: { before: "Strasse", after: "Reichsstrasse" },
                    labelVisible: { before: false, after: true },
                    nameOrigin: { before: null, after: "manual" },
                    subtypeOrigin: { before: null, after: "manual" },
                },
            },
        ]);
        const [{ n } = { n: 0 }] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${id}::uuid
        `;
        expect(n).toBe(1);
    });

    it("🔴 Felder und Kurve in EINER Operation (W5b Schritt 3): Name für beide Abschnitte, die Kurve für einen; ein fremder Abschnitt nie", async () => {
        await lege();
        const id = operationId();
        const antwort = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(A.s1),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: id,
                sections: strasse,
                name: "W5b Kurvenweg",
                shape: {
                    publicId: A.s2,
                    points: [
                        { x: 705, y: 301 },
                        { x: 707, y: 303 },
                        { x: 710, y: 301 },
                    ],
                    carried: [],
                },
            },
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<{ affected: { id: string; revision: number }[]; ends?: unknown }>();
        // Der Abschnitt mit Kurve zählt zweimal (Felder, dann Linie), der andere einmal; je Gegenstand EINE Zeile in `affected`.
        expect(quittung.affected.map((a) => [a.id, a.revision]).sort()).toEqual([
            [A.s1, 2],
            [A.s2, 3],
        ]);
        expect(quittung.ends).toBeDefined();
        const [{ n } = { n: 0 }] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_operation WHERE operation_id = ${id}::uuid
        `;
        expect(n).toBe(1);
        const aktionen = await database<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${id}::uuid ORDER BY id
        `;
        expect(aktionen.map((x) => x.action)).toEqual(["path.updated", "path.updated", "path.reshaped"]);
        const fremd = await post(editorPathUpdateUrl(A.s1), {
            sections: (await zeilen())
                .filter((z) => z.id === A.s1 || z.id === A.s2)
                .map((z) => ({ publicId: z.id, baseRevision: z.revision })),
            shape: {
                publicId: A.andere,
                points: [
                    { x: 720, y: 300 },
                    { x: 726, y: 301 },
                ],
                carried: [],
            },
        });
        expect(fremd.statusCode).toBe(400);
    });

    it("🔴 Tunnel je Abschnitt (Migration 0172): nur der genannte Abschnitt, mit Protokoll und Revision; die Wegfindung rechnet neu", async () => {
        await lege();
        const wegfindungVorher = await readRoutingRevision(database, "aventuria", "modell");
        const antwort = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                { publicId: A.s2, baseRevision: 1, tunnel: true },
            ],
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<{
            affected: { id: string; revision: number }[];
            derivedWork: { kind: string }[];
        }>();
        expect(quittung.affected).toEqual([{ kind: "path", id: A.s2, revision: 2 }]);
        expect(quittung.derivedWork.map((w) => w.kind)).toContain("routing");
        const tunnel = await database<{ id: string; tunnel: boolean }[]>`
            SELECT public_id::text AS id, is_tunnel AS tunnel FROM path WHERE public_id = ANY(${[A.s1, A.s2]}::uuid[]) ORDER BY public_id
        `;
        expect(tunnel).toEqual([
            { id: A.s1, tunnel: false },
            { id: A.s2, tunnel: true },
        ]);
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE o.action = 'path.update' AND e.path_public_id = ${A.s2}::uuid ORDER BY e.id DESC LIMIT 1
        `;
        expect(eintrag?.changes).toEqual({ tunnel: { before: false, after: true } });
        // Der Routenrechner lädt von selbst neu (`routing_reload`): Der Teil `map` seiner Revision hat sich bewegt, und das Netz trägt
        // das Merkmal am Stück.
        const wegfindungNachher = await readRoutingRevision(database, "aventuria", "modell");
        expect(changedParts(wegfindungVorher, wegfindungNachher)).toContain("map");
        const { paths } = await loadRouteGraphRows(database, "aventuria");
        expect(paths.find((zeile) => zeile.public_id === A.s2)?.is_tunnel).toBe(true);
        expect(paths.find((zeile) => zeile.public_id === A.s1)?.is_tunnel).toBe(false);
        // Derselbe Wert noch einmal schreibt nichts.
        const nochmal = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                { publicId: A.s2, baseRevision: 2, tunnel: true },
            ],
        });
        expect(nochmal.json<{ affected: unknown[] }>().affected).toEqual([]);
    });

    it("🔴 Wegtyp je Abschnitt (Schritt 3): nur der genannte, Herkunft manual nur an ihm, mit Protokoll und Wegfindung; er bleibt in seinem Weg; ein Seeweg bleibt", async () => {
        await lege();
        const wegfindungVorher = await readRoutingRevision(database, "aventuria", "modell");
        const antwort = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                { publicId: A.s2, baseRevision: 1, subtype: "Pfad" },
            ],
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<{ affected: unknown[]; derivedWork: { kind: string }[] }>();
        expect(quittung.affected).toEqual([{ kind: "path", id: A.s2, revision: 2 }]);
        expect(quittung.derivedWork.map((w) => w.kind)).toContain("routing");
        expect((await zeilen()).filter((z) => z.id === A.s1 || z.id === A.s2).map((z) => [z.id, z.subtype])).toEqual([
            [A.s1, "Strasse"],
            [A.s2, "Pfad"],
        ]);
        const herkunft = await database<{ id: string; field: string; origin: string }[]>`
            SELECT object_id::text AS id, field, origin FROM field_origin
             WHERE object_kind = 'path' AND object_id = ANY(${[A.s1, A.s2]}::uuid[]) ORDER BY object_id, field
        `;
        expect(herkunft).toEqual([{ id: A.s2, field: "subtype", origin: "manual" }]);
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE o.action = 'path.update' AND e.path_public_id = ${A.s2}::uuid ORDER BY e.id DESC LIMIT 1
        `;
        expect(eintrag?.changes).toEqual({
            subtype: { before: "Strasse", after: "Pfad" },
            subtypeOrigin: { before: null, after: "manual" },
        });
        expect(changedParts(wegfindungVorher, await readRoutingRevision(database, "aventuria", "modell"))).toContain(
            "map",
        );
        // Der Abschnitt bleibt in seinem Weg (ein Weg ist sein Name): Ohne ihn im Satz ist es nicht derselbe Weg.
        expect(
            (
                await post(editorPathUpdateUrl(A.s1), {
                    sections: [{ publicId: A.s1, baseRevision: 1 }],
                    labelVisible: true,
                })
            ).statusCode,
        ).toBe(409);
        // Derselbe Wegtyp noch einmal schreibt nichts.
        const nochmal = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                { publicId: A.s2, baseRevision: 2, subtype: "Pfad" },
            ],
        });
        expect(nochmal.json<{ affected: unknown[] }>().affected).toEqual([]);
        // Seeweg gibt es im Vertrag nicht.
        const see = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(A.s1),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: operationId(),
                sections: [
                    { publicId: A.s1, baseRevision: 1, subtype: "Seeweg" },
                    { publicId: A.s2, baseRevision: 2 },
                ],
            },
        });
        expect(see.statusCode).toBe(400);
    });

    it("🔴 Reisemittel mit den Mitteln nach Legacy (WI-0069: Karren, Fuhrwerk, Schlitten) speichern; der Prüfwert der Spalte kennt den ganzen Katalog (Stage-Fund Claudio 2026-10-19 23:41, 500 an path_allowed_transports_check)", async () => {
        await lege();
        // Genau der Stage-Fall: „Fertig“ schreibt die Liste aus, wie die Wegfindung rechnet, also mit den geerbten Karren und Fuhrwerk.
        const antwort = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                {
                    publicId: A.s2,
                    baseRevision: 1,
                    reisen: { liste: ["groupFoot", "horseCarriage", "cart", "wagon", "sleigh"], fenster: {} },
                },
            ],
        });
        expect(antwort.statusCode).toBe(200);
        const [zeile] = await database<{ liste: string[] }[]>`
            SELECT allowed_transports AS liste FROM path WHERE public_id = ${A.s2}::uuid
        `;
        expect([...(zeile?.liste ?? [])].sort()).toEqual(["cart", "groupFoot", "horseCarriage", "sleigh", "wagon"]);
        // Kein Mittel des Modells fehlt im Prüfwert (er ist eine zweite Liste neben `travel-model/aventuria.json`).
        const [regel] = await database<{ def: string }[]>`
            SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
             WHERE c.conrelid = 'path'::regclass AND c.conname = 'path_allowed_transports_check'
        `;
        const katalog = [...new Set(Object.values(AVENTURIA_TRAVEL_MODEL.transportmittel.wert).flat())];
        expect(katalog.filter((mittel) => !(regel?.def ?? "").includes(`'${mittel}'`))).toEqual([]);
    });

    it("🔴 Reisemittel je Abschnitt (Migration 0208, F16 „A“): Liste und Fenster samt Grund ganz, ohne Erbe, mit Protokoll und Wegfindung; Fremdes ist 400; ↺ holt den Stand mit Erbe", async () => {
        await lege();
        const wegfindungVorher = await readRoutingRevision(database, "aventuria", "modell");
        // Der Karren ist abgewählt, obwohl die Kutsche fährt: Ohne „vollständig geschrieben“ erbte er ihre Freigabe und ihr Fenster.
        const reisen: PathReisenBody = {
            liste: ["horseCarriage", "groupFoot"],
            fenster: {
                horseCarriage: {
                    from_month: "peraine",
                    from_day: 1,
                    to_month: "boron",
                    to_day: 30,
                    reason: "schneemassen",
                },
            },
        };
        const antwort = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                { publicId: A.s2, baseRevision: 1, reisen },
            ],
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<{ affected: unknown[]; derivedWork: { kind: string }[] }>();
        expect(quittung.affected).toEqual([{ kind: "path", id: A.s2, revision: 2 }]);
        expect(quittung.derivedWork.map((w) => w.kind)).toContain("routing");
        const gespeichert = async () =>
            database<{ liste: string[] | null; fenster: unknown; geschrieben: boolean }[]>`
                SELECT allowed_transports AS liste, transport_seasons AS fenster, transports_written AS geschrieben
                  FROM path WHERE public_id = ${A.s2}::uuid
            `;
        // Die Liste in der Folge des Angebots.
        expect(await gespeichert()).toEqual([
            { liste: ["groupFoot", "horseCarriage"], fenster: reisen.fenster, geschrieben: true },
        ]);

        // Die Wegfindung rechnet neu und erbt nichts: Der Karren fährt nicht, und die Kutsche nur im Fenster.
        expect(changedParts(wegfindungVorher, await readRoutingRevision(database, "aventuria", "modell"))).toContain(
            "map",
        );
        const { paths } = await loadRouteGraphRows(database, "aventuria");
        const s2 = paths.find((zeile) => zeile.public_id === A.s2)!;
        expect(s2.transports_written).toBe(true);
        const fenster = s2.transport_seasons as Record<string, unknown>;
        expect(
            allowedTransportsForPath(
                AVENTURIA_TRAVEL_MODEL,
                "Strasse",
                s2.allowed_transports,
                s2.transport_domain,
                true,
            ),
        ).toEqual(["groupFoot", "horseCarriage"]);
        expect(pathSeasonWindow(AVENTURIA_TRAVEL_MODEL, fenster, "cart", true)).toBeUndefined();
        // Gegenprobe ohne das Merkmal: So erbte er.
        expect(allowedTransportsForPath(AVENTURIA_TRAVEL_MODEL, "Strasse", s2.allowed_transports, null)).toContain(
            "cart",
        );

        // Der Lesepfad nennt das Merkmal und den Grund.
        const gelesen = await app.inject({
            method: "GET",
            url: editorPathStreetUrl(A.s1),
            headers: { cookie: cookies.get("reviewer") ?? "" },
        });
        const strasseGelesen = JSON.parse(gelesen.body) as EditorPathStreet;
        expect(Value.Check(EditorPathStreet, strasseGelesen)).toBe(true);
        expect(strasseGelesen.segments.find((a) => a.id === A.s2)?.reisen).toEqual({
            liste: ["groupFoot", "horseCarriage"],
            domaene: null,
            fenster: reisen.fenster,
            geschrieben: true,
        });

        // Das Protokoll führt den Stand vorher und nachher.
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE o.action = 'path.update' AND e.path_public_id = ${A.s2}::uuid ORDER BY e.id DESC LIMIT 1
        `;
        expect(eintrag?.changes).toEqual({
            reisen: {
                before: { liste: null, fenster: {}, geschrieben: false },
                after: { liste: ["groupFoot", "horseCarriage"], fenster: reisen.fenster, geschrieben: true },
            },
        });

        // Fremdes ist 400 und schreibt nichts: ein Mittel des Wassers an einer Straße; ein Fenster an einem Mittel außerhalb der Liste.
        const fenster1 = { from_month: "praios", from_day: 1, to_month: "rondra", to_day: 30 } as const;
        for (const falsch of [
            { liste: ["riverSailer"], fenster: {} },
            { liste: ["groupFoot"], fenster: { caravan: fenster1 } },
        ] satisfies PathReisenBody[]) {
            const abgewiesen = await post(editorPathUpdateUrl(A.s1), {
                sections: [
                    { publicId: A.s1, baseRevision: 1 },
                    { publicId: A.s2, baseRevision: 2, reisen: falsch },
                ],
            });
            expect(abgewiesen.statusCode).toBe(400);
        }
        // Derselbe Stand noch einmal schreibt nichts.
        const nochmal = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                { publicId: A.s2, baseRevision: 2, reisen },
            ],
        });
        expect(nochmal.json<{ affected: unknown[] }>().affected).toEqual([]);

        // ↺ aus dem Verlauf: zurück auf die Vorgabe des Wegtyps, mit Erbe.
        const zurueck = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                { publicId: A.s2, baseRevision: 2, reisen: { liste: null, fenster: {}, geschrieben: false } },
            ],
        });
        expect(zurueck.statusCode).toBe(200);
        expect(await gespeichert()).toEqual([{ liste: null, fenster: null, geschrieben: false }]);
        // Ohne „geschrieben: false“ braucht es eine Liste.
        const ohneListe = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1 },
                { publicId: A.s2, baseRevision: 3, reisen: { liste: null, fenster: {} } },
            ],
        });
        expect(ohneListe.statusCode).toBe(400);
    });

    it("🔴 Karawanenroute (Migration 0174): das Kennzeichen an allen Abschnitten, mit Protokoll; keine neue Wegfindung; über Wegtypen hinweg EINE Straße", async () => {
        await lege();
        const marks = async () =>
            database<{ id: string; subtype: string; mark: string | null; revision: number }[]>`
                SELECT public_id::text AS id, subtype, mark, revision::int AS revision FROM path
                 WHERE public_id = ANY(${[A.s1, A.s2, A.andere]}::uuid[]) ORDER BY public_id
            `;
        const antwort = await post(editorPathUpdateUrl(A.s1), { sections: strasse, mark: "karawanenroute" });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<{ affected: { id: string }[]; derivedWork: { kind: string }[] }>();
        expect(quittung.affected.map((a) => a.id).sort()).toEqual([A.s1, A.s2]);
        // Das Kennzeichen hat keine Reisewerte: Die Wegfindung rechnet nicht neu.
        expect(quittung.derivedWork.map((w) => w.kind)).not.toContain("routing");
        expect(await marks()).toEqual([
            { id: A.s1, subtype: "Strasse", mark: "karawanenroute", revision: 2 },
            { id: A.s2, subtype: "Strasse", mark: "karawanenroute", revision: 2 },
            { id: A.andere, subtype: "Pfad", mark: null, revision: 1 },
        ]);
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE o.action = 'path.update' AND e.path_public_id = ${A.s1}::uuid ORDER BY e.id DESC LIMIT 1
        `;
        // Gesetzt von Hand: Herkunft manual (WI-0225 §7).
        expect(eintrag?.changes).toEqual({
            mark: { before: null, after: "karawanenroute" },
            markOrigin: { before: null, after: "manual" },
        });
        // Ein Pfad gleichen Namens mit Kennzeichen gehört dazu: EINE Straße auf zwei Wegtypen, die Quittung sagt „zusammen“.
        const dazu = await post(editorPathUpdateUrl(A.andere), {
            sections: [{ publicId: A.andere, baseRevision: 1 }],
            name: "W5b Handelsweg",
            mark: "karawanenroute",
        });
        expect(dazu.statusCode).toBe(200);
        expect(dazu.json<{ warnings: { code: string }[] }>().warnings.map((w) => w.code)).toEqual(["merged"]);
        const route = [
            { publicId: A.s1, baseRevision: 2 },
            { publicId: A.s2, baseRevision: 2 },
            { publicId: A.andere, baseRevision: 2 },
        ];
        // Die Wegart gilt dann allen Abschnitten, auch denen, die sie schon haben; nur wer sich ändert, bekommt eine Revision.
        const art = await post(editorPathUpdateUrl(A.s2), { sections: route, subtype: "Strasse" });
        expect(art.statusCode).toBe(200);
        expect(art.json<{ affected: { id: string }[] }>().affected.map((a) => a.id)).toEqual([A.andere]);
        // Ohne den Pfad im Satz ist die Straße nicht dieselbe: 409.
        expect((await post(editorPathUpdateUrl(A.s1), { sections: strasse, mark: "" })).statusCode).toBe(409);
        // Weg damit: Alle drei verlieren das Kennzeichen.
        const weg = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 2 },
                { publicId: A.s2, baseRevision: 2 },
                { publicId: A.andere, baseRevision: 3 },
            ],
            mark: "",
        });
        expect(weg.statusCode).toBe(200);
        expect((await marks()).map((z) => z.mark)).toEqual([null, null, null]);
    });

    it("🔴 ↺ zum Wiki-Wert (WI-0225 §7): Wert aus dem Artikel, Herkunft wiki an ALLEN Abschnitten; ein Wert ist manual; ohne Wiki-Wert 400", async () => {
        await lege();
        const [schnappschuss] = await database<{ id: string }[]>`
            INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind, art)
            VALUES ('w5b-kronweg', 'https://de.wiki-aventurica.de/wiki/W5b_Kronweg', 'W5b Kronweg', 'strasse', 'Kronstraße')
            RETURNING id::text AS id
        `;
        await database`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state)
            SELECT id, 'main', 'https://de.wiki-aventurica.de/wiki/W5b_Kronweg', ${schnappschuss!.id}::bigint, 'assigned'
              FROM path WHERE public_id = ANY(${[A.s1, A.s2]}::uuid[])
        `;
        const herkunft = async () =>
            database<{ id: string; field: string; origin: string }[]>`
                SELECT object_id::text AS id, field, origin FROM field_origin
                 WHERE object_kind = 'path' AND object_id = ANY(${[A.s1, A.s2]}::uuid[]) ORDER BY object_id, field
            `;
        const protokoll = async () => {
            const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
                SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
                 WHERE o.action = 'path.update' AND e.path_public_id = ${A.s2}::uuid ORDER BY e.id DESC LIMIT 1
            `;
            return eintrag?.changes;
        };
        // ↺ an Name und Wegart: Kronstraße ist Reichsstraße (`wegtypAusWiki`), der Titel der Name.
        const zurueck = await post(editorPathUpdateUrl(A.s1), {
            sections: strasse,
            name: { revert: "wiki" },
            subtype: { revert: "wiki" },
        });
        expect(zurueck.statusCode).toBe(200);
        expect((await zeilen()).filter((z) => z.id === A.s1 || z.id === A.s2)).toEqual([
            { id: A.s1, name: "W5b Kronweg", subtype: "Reichsstrasse", sichtbar: true, revision: 2 },
            { id: A.s2, name: "W5b Kronweg", subtype: "Reichsstrasse", sichtbar: false, revision: 2 },
        ]);
        expect(await herkunft()).toEqual([
            { id: A.s1, field: "name", origin: "wiki" },
            { id: A.s1, field: "subtype", origin: "wiki" },
            { id: A.s2, field: "name", origin: "wiki" },
            { id: A.s2, field: "subtype", origin: "wiki" },
        ]);
        expect(await protokoll()).toEqual({
            name: { before: "W5b Handelsweg", after: "W5b Kronweg" },
            subtype: { before: "Strasse", after: "Reichsstrasse" },
            nameOrigin: { before: null, after: "wiki" },
            subtypeOrigin: { before: null, after: "wiki" },
        });
        const nachZurueck = [
            { publicId: A.s1, baseRevision: 2 },
            { publicId: A.s2, baseRevision: 2 },
        ];
        // ↺ am Kennzeichen: Kronstraße heißt keins; der Wert bleibt, nur die Herkunft wird wiki (keine Revision).
        const ohneKennzeichen = await post(editorPathUpdateUrl(A.s1), {
            sections: nachZurueck,
            mark: { revert: "wiki" },
        });
        expect(ohneKennzeichen.statusCode).toBe(200);
        expect(ohneKennzeichen.json<{ affected: unknown[] }>().affected).toEqual([]);
        expect((await herkunft()).filter((h) => h.field === "mark").map((h) => h.origin)).toEqual(["wiki", "wiki"]);
        expect(await protokoll()).toEqual({ markOrigin: { before: null, after: "wiki" } });
        // Getippt ist manual, auch beim Wortlaut des Wiki.
        const getippt = await post(editorPathUpdateUrl(A.s1), { sections: nachZurueck, name: "W5b Eigener Name" });
        expect(getippt.statusCode).toBe(200);
        expect(await protokoll()).toEqual({
            name: { before: "W5b Kronweg", after: "W5b Eigener Name" },
            nameOrigin: { before: "wiki", after: "manual" },
        });
        // Der Lesepfad nennt die Herkunft je Abschnitt.
        const gelesen = await app.inject({
            method: "GET",
            url: editorPathStreetUrl(A.s1),
            headers: { cookie: cookies.get("reviewer") ?? "" },
        });
        const strasseGelesen = JSON.parse(gelesen.body) as EditorPathStreet;
        expect(Value.Check(EditorPathStreet, strasseGelesen)).toBe(true);
        expect(strasseGelesen.segments.map((s) => s.herkunft)).toEqual([
            { name: "manual", subtype: "wiki", mark: "wiki" },
            { name: "manual", subtype: "wiki", mark: "wiki" },
        ]);
        // Ohne Artikel gibt es keinen Wiki-Wert: 400, nichts geschrieben.
        const ohneArtikel = await post(editorPathUpdateUrl(A.andere), {
            sections: [{ publicId: A.andere, baseRevision: 1 }],
            name: { revert: "wiki" },
        });
        expect(ohneArtikel.statusCode).toBe(400);
        expect(ohneArtikel.json<{ error: { details: { field: string } } }>().error.details.field).toBe("name");
    });

    it("🔴 ein Kennzeichen tragen nur Landwege", async () => {
        await lege();
        const fluss = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: 1 }],
            mark: "karawanenroute",
        });
        expect(fluss.statusCode).toBe(400);
        expect(fluss.json<{ error: { message: string } }>().error.message).toBe("Ein Kennzeichen tragen nur Landwege.");
        const fremd = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(A.s1),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: { operationId: operationId(), sections: strasse, mark: "pilgerweg" },
        });
        expect(fremd.statusCode).toBe(400);
    });

    it("🔴 nur was sich ändert: „Name auf der Karte“ an einem gemischten Paar zählt nur den Abschnitt, der anders war", async () => {
        await lege();
        expect((await post(editorPathUpdateUrl(A.s1), { sections: strasse, labelVisible: true })).statusCode).toBe(200);
        expect((await zeilen()).filter((z) => z.id === A.s1 || z.id === A.s2).map((z) => z.revision)).toEqual([1, 2]);
    });

    it("🔴 speichern, während eine Ableitung Zeilen mit Fremdschlüssel auf die Abschnitte schreibt (FOR KEY SHARE): kein 503", async () => {
        // Wie das Wegprofil im Zeigerwechsel eines Geländes: Die Fremdschlüsselprüfung sperrt den Weg mit FOR KEY SHARE, bis die
        // Transaktion endet. Vorher wartete `path.update` mit FOR UPDATE darauf und brach nach 2 s lock_timeout mit 503 ab.
        await lege();
        let loesen!: () => void;
        const gehalten = new Promise<void>((erfuellt) => (loesen = erfuellt));
        let gesperrt!: () => void;
        const sperreDa = new Promise<void>((erfuellt) => (gesperrt = erfuellt));
        const halter = database.begin(async (tx) => {
            await tx`SELECT 1 FROM path WHERE public_id = ANY(${[A.s1, A.s2]}::uuid[]) FOR KEY SHARE`;
            gesperrt();
            await gehalten;
        });
        await sperreDa;
        try {
            const antwort = await post(editorPathUpdateUrl(A.s1), { sections: strasse, name: "W5b Neuer Handelsweg" });
            expect(antwort.statusCode, antwort.body).toBe(200);
        } finally {
            loesen();
            await halter;
        }
        expect((await zeilen()).filter((z) => z.id === A.s1 || z.id === A.s2).map((z) => z.name)).toEqual([
            "W5b Neuer Handelsweg",
            "W5b Neuer Handelsweg",
        ]);
    });

    it("🔴 eine fremde Änderung, ein fehlender oder ein zusätzlicher Abschnitt: 409, und nichts ist geschrieben", async () => {
        await lege();
        const veraltet = await post(editorPathUpdateUrl(A.s1), {
            sections: [strasse[0]!, { publicId: A.s2, baseRevision: 7 }],
            name: "W5b Nie",
        });
        expect(veraltet.statusCode).toBe(409);
        expect(veraltet.json<{ error: { code: string } }>().error.code).toBe("edit_conflict");
        const fehlt = await post(editorPathUpdateUrl(A.s1), { sections: [strasse[0]!], name: "W5b Nie" });
        expect(fehlt.statusCode).toBe(409);
        // 🔴 Ein Abschnitt einer anderen Straße oder einer anderen Karte ist 400 (Sicherheitsprüfung OPS-000036).
        const fremd = await post(editorPathUpdateUrl(A.s1), {
            sections: [...strasse, { publicId: A.andere, baseRevision: 1 }],
            name: "W5b Nie",
        });
        expect(fremd.statusCode).toBe(400);
        await database`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system)
            VALUES (${A.karte2}, ${ZWEITE_KARTE}, 'W5b Handelsweg', 'Strasse', TRUE, FALSE,
                    ST_GeomFromText('LINESTRING(730 300, 735 301)', 0), ${SOURCE})
        `;
        const andereKarte = await post(editorPathUpdateUrl(A.s1), {
            sections: [...strasse, { publicId: A.karte2, baseRevision: 1 }],
            name: "W5b Nie",
        });
        expect(andereKarte.statusCode).toBe(400);
        expect((await zeilen()).every((z) => z.name !== "W5b Nie" && z.revision === 1)).toBe(true);
    });

    it("🔴 Fluss, Bach und Landweg umstellen (Plan Fluss/Bach, Schritt 3): Reisemittel auf die Vorgabe der neuen Art, ein Bach ohne Boote, die Richtung bleibt; ein Bach ist ein Fluss; Seeweg gibt es im Vertrag nicht", async () => {
        await lege();
        const wegfindungVorher = await readRoutingRevision(database, "aventuria", "modell");
        const zeile = async () => {
            const [z] = await database<
                {
                    subtype: string;
                    bach: boolean;
                    richtung: string | null;
                    liste: string[] | null;
                    domaene: string | null;
                    geschrieben: boolean;
                    revision: number;
                }[]
            >`
                SELECT subtype, is_bach AS bach, flow_direction AS richtung, allowed_transports AS liste,
                       transport_domain AS domaene, transports_written AS geschrieben, revision::int AS revision
                  FROM path WHERE public_id = ${A.fluss}::uuid
            `;
            return z!;
        };
        await database`UPDATE path SET flow_direction = 'reverse', allowed_transports = ARRAY['riverBarge'], transports_written = TRUE
                        WHERE public_id = ${A.fluss}::uuid`;
        const r0 = (await zeile()).revision;
        // Bach an: keine Boote (F14), die Domäne `none` hält die leere Liste; die Richtung bleibt.
        const zuBach = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: r0 }],
            bach: true,
        });
        expect(zuBach.statusCode).toBe(200);
        expect(zuBach.json<{ derivedWork: { kind: string }[] }>().derivedWork.map((w) => w.kind)).toContain("routing");
        expect(await zeile()).toMatchObject({
            subtype: "Flussweg",
            bach: true,
            richtung: "reverse",
            liste: [],
            domaene: "none",
            geschrieben: false,
        });
        // Zum Landweg je Abschnitt: kein Bach mehr, die Reisemittel sind die Vorgabe der Straße.
        const zuStrasse = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: (await zeile()).revision, subtype: "Strasse" }],
        });
        expect(zuStrasse.statusCode).toBe(200);
        expect(await zeile()).toMatchObject({ subtype: "Strasse", bach: false, liste: null, domaene: null });
        // Zurück zum Fluss über die Wegart der Straße; die Richtung stand die ganze Zeit (Legacy).
        const zuFluss = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: (await zeile()).revision }],
            subtype: "Flussweg",
        });
        expect(zuFluss.statusCode).toBe(200);
        expect(await zeile()).toMatchObject({ subtype: "Flussweg", bach: false, richtung: "reverse", liste: null });
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE o.action = 'path.update' AND e.path_public_id = ${A.fluss}::uuid ORDER BY e.id DESC LIMIT 1
        `;
        expect(eintrag?.changes).toMatchObject({ subtype: { before: "Strasse", after: "Flussweg" } });
        expect(changedParts(wegfindungVorher, await readRoutingRevision(database, "aventuria", "modell"))).toContain(
            "map",
        );
        // Ein Bach ist ein Fluss: an einem Landweg 400.
        const bachAmLand = await post(editorPathUpdateUrl(A.s1), { sections: strasse, bach: true });
        expect(bachAmLand.statusCode).toBe(400);
        expect(bachAmLand.json<{ error: { message: string } }>().error.message).toBe("Ein Bach ist ein Fluss.");
        const see = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(A.s1),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: { operationId: operationId(), sections: strasse, subtype: "Seeweg" },
        });
        expect(see.statusCode).toBe(400);
        // Der Name eines Flusswegs geht.
        const name = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: (await zeile()).revision }],
            name: "W5b Großer Fluss",
        });
        expect(name.statusCode).toBe(200);
    });

    it("🔴 Fließrichtung je Abschnitt (Plan Fluss/Bach, Schritt 4): umkehren und offen, mit Protokoll und Wegfindung; nur an einem Fluss", async () => {
        await lege();
        const richtung = async () => {
            const [z] = await database<{ richtung: string | null; revision: number }[]>`
                SELECT flow_direction AS richtung, revision::int AS revision FROM path WHERE public_id = ${A.fluss}::uuid
            `;
            return z!;
        };
        const umgekehrt = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: 1, flowDirection: "reverse" }],
        });
        expect(umgekehrt.statusCode).toBe(200);
        expect(umgekehrt.json<{ derivedWork: { kind: string }[] }>().derivedWork.map((w) => w.kind)).toContain(
            "routing",
        );
        expect((await richtung()).richtung).toBe("reverse");
        // Der Lesepfad nennt sie am Abschnitt (für die Tafel).
        const gelesen = await app.inject({
            method: "GET",
            url: editorPathStreetUrl(A.fluss),
            headers: { cookie: cookies.get("editor") ?? "" },
        });
        expect(gelesen.json<{ segments: { flowDirection?: string }[] }>().segments[0]?.flowDirection).toBe("reverse");
        const [eintrag] = await database<{ changes: Record<string, unknown> }[]>`
            SELECT e.changes FROM map_audit_event e JOIN map_operation o USING (operation_id)
             WHERE o.action = 'path.update' AND e.path_public_id = ${A.fluss}::uuid ORDER BY e.id DESC LIMIT 1
        `;
        expect(eintrag?.changes).toEqual({ flowDirection: { before: null, after: "reverse" } });
        // Dieselbe Richtung noch einmal schreibt nichts; offen geht.
        const nochmal = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: 2, flowDirection: "reverse" }],
        });
        expect(nochmal.json<{ affected: unknown[] }>().affected).toEqual([]);
        const offen = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: 2, flowDirection: null }],
        });
        expect(offen.statusCode).toBe(200);
        expect((await richtung()).richtung).toBeNull();
        // Ein Landweg hat keine Fließrichtung.
        const amLand = await post(editorPathUpdateUrl(A.s1), {
            sections: [
                { publicId: A.s1, baseRevision: 1, flowDirection: "forward" },
                { publicId: A.s2, baseRevision: 1 },
            ],
        });
        expect(amLand.statusCode).toBe(400);
        expect(amLand.json<{ error: { message: string } }>().error.message).toBe(
            "Nur ein Fluss hat eine Fließrichtung.",
        );
    });

    it("🔴 ein Weg ist sein Name (Schritt 2, Regel (c)): ein Abschnitt anderer Wegart gehört dazu, ohne ihn im Satz 409; ein nicht genanntes Kennzeichen bleibt je Abschnitt", async () => {
        await lege();
        // Der Pfad bekommt den Namen der Straße: Danach ist er ein Teil von ihr, die Quittung sagt „zusammen“.
        const dazu = await post(editorPathUpdateUrl(A.andere), {
            sections: [{ publicId: A.andere, baseRevision: 1 }],
            name: "W5b Handelsweg",
        });
        expect(dazu.statusCode).toBe(200);
        expect(dazu.json<{ warnings: { code: string }[] }>().warnings.map((w) => w.code)).toEqual(["merged"]);
        // Ohne den Pfad im Satz ist es nicht derselbe Weg.
        expect((await post(editorPathUpdateUrl(A.s1), { sections: strasse, labelVisible: true })).statusCode).toBe(409);
        // Nur der Pfad trägt das Kennzeichen; ein neuer Name für alle lässt es, wo es war.
        await database`UPDATE path SET mark = 'karawanenroute' WHERE public_id = ${A.andere}::uuid`;
        const stand = await zeilen();
        const satz = stand
            .filter((z) => [A.s1, A.s2, A.andere].includes(z.id as never))
            .map((z) => ({ publicId: z.id, baseRevision: z.revision }));
        const umbenannt = await post(editorPathUpdateUrl(A.s1), { sections: satz, name: "W5b Handelsstraße" });
        expect(umbenannt.statusCode).toBe(200);
        const marks = await database<{ id: string; name: string; mark: string | null }[]>`
            SELECT public_id::text AS id, name, mark FROM path WHERE public_id = ANY(${[A.s1, A.s2, A.andere]}::uuid[])
             ORDER BY public_id
        `;
        expect(marks).toEqual([
            { id: A.s1, name: "W5b Handelsstraße", mark: null },
            { id: A.s2, name: "W5b Handelsstraße", mark: null },
            { id: A.andere, name: "W5b Handelsstraße", mark: "karawanenroute" },
        ]);
    });

    it("heißt die Straße danach wie eine andere, sind beide eine: Die Quittung sagt es", async () => {
        await lege();
        const antwort = await post(editorPathUpdateUrl(A.s1), {
            sections: strasse,
            name: "W5b Schon da",
            subtype: "Pfad",
        });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.json<{ warnings: { code: string }[] }>().warnings.map((w) => w.code)).toEqual(["merged"]);
    });

    it("🔴 Sperrungen am Fluss (Plan Fluss/Bach, Auftrag der Hauptorchestrierung): Boote mit Fenster und Grund schreiben, ein Landmittel ist 400; die Bearbeitungssperre greift wie am Weg", async () => {
        await lege();
        // Die Stromschnelle im Winter: der Flusskahn nur im Sommer, der Flusssegler gar nicht.
        const winter = await post(editorPathUpdateUrl(A.fluss), {
            sections: [
                {
                    publicId: A.fluss,
                    baseRevision: 1,
                    reisen: {
                        liste: ["riverBarge"],
                        fenster: {
                            riverBarge: {
                                from_month: "peraine",
                                from_day: 1,
                                to_month: "efferd",
                                to_day: 30,
                                reason: "vereisung",
                            },
                        },
                    },
                },
            ],
        });
        expect(winter.statusCode).toBe(200);
        const [gespeichert] = await database<{ liste: string[]; fenster: Record<string, { reason?: string }> }[]>`
            SELECT allowed_transports AS liste, transport_seasons AS fenster FROM path WHERE public_id = ${A.fluss}::uuid
        `;
        expect(gespeichert).toMatchObject({ liste: ["riverBarge"], fenster: { riverBarge: { reason: "vereisung" } } });
        // Ein Landmittel bietet der Fluss nicht an.
        const zuFuss = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: 2, reisen: { liste: ["groupFoot"], fenster: {} } }],
        });
        expect(zuFuss.statusCode).toBe(400);
        // Hält ein anderer den Fluss, ist er gesperrt wie jeder Weg.
        const anderer = await authFixture(database).person("editor", { name: "W5b Flussnachbar" });
        await database`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${A.fluss}::uuid, 'felder', ${anderer.id}::uuid, 'W5b Flussnachbar', gen_random_uuid())
        `;
        const gesperrt = await post(editorPathUpdateUrl(A.fluss), {
            sections: [{ publicId: A.fluss, baseRevision: 2, flowDirection: "forward" }],
        });
        expect(gesperrt.statusCode).toBe(409);
        expect(gesperrt.json<{ error: { code: string } }>().error.code).toBe("object_locked");
        await database`DELETE FROM editor_lock WHERE object_id = ${A.fluss}::uuid`;
    });

    it("🔴 weitere Straßennamen je Abschnitt (WI-0302): anlegen, streichen, wiederbeleben mit Herkunft; Hauptartikel und unbekannt 400; die Revision zählt, keine Aufträge; das Protokoll nennt `weitere`", async () => {
        await lege();
        const stand = async (key: string, name: string) =>
            (
                await database<{ id: string }[]>`
                    INSERT INTO wiki_path_snapshot (wiki_key, wiki_url, name, kind)
                    VALUES (${key}, ${`https://de.wiki-aventurica.de/wiki/${name.replaceAll(" ", "_")}`}, ${name}, 'strasse')
                    RETURNING id::text AS id
                `
            )[0]!.id;
        const kron = await stand("w5b-weiter-kron", "W5b Kronweg");
        const pilger = await stand("w5b-weiter-pilger", "W5b Pilgerweg");
        await stand("w5b-weiter-gold", "W5b Goldfelser Stieg");
        await database`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state)
            SELECT id, 'main', 'https://de.wiki-aventurica.de/wiki/W5b_Kronweg', ${kron}::bigint, 'assigned'
              FROM path WHERE public_id = ANY(${[A.s1, A.s2]}::uuid[])
        `;
        // Eine still gelegte Zeile aus dem Import: Sie wird belebt, nicht ersetzt, und behält ihre Herkunft.
        const [alt] = await database<{ id: string }[]>`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin, is_active, retired_at, retired_origin)
            SELECT id, 'further', 'https://de.wiki-aventurica.de/wiki/W5b_Pilgerweg', ${pilger}::bigint, 'assigned', 'legacy_editor', FALSE, now(), 'import'
              FROM path WHERE public_id = ${A.s1}::uuid
            RETURNING id::text AS id
        `;
        const weitere = async () =>
            database<
                { key: string; origin: string; system: string; aktiv: boolean; still: string | null; zeile: string }[]
            >`
                SELECT s.wiki_key AS key, w.assignment_origin AS origin, w.source_system AS system, w.is_active AS aktiv,
                       w.retired_origin AS still, w.id::text AS zeile
                  FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
                 WHERE p.public_id = ${A.s1}::uuid AND w.role = 'further' ORDER BY s.wiki_key, w.id
            `;
        const protokoll = async (id: string) =>
            database<{ path: string; changes: Record<string, unknown> }[]>`
                SELECT path_public_id::text AS path, changes FROM map_audit_event WHERE operation_id = ${id}::uuid ORDER BY path_public_id
            `;
        const speichere = (s1: number, liste: string[], id = operationId()) =>
            app.inject({
                method: "POST",
                url: editorPathUpdateUrl(A.s2),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: {
                    operationId: id,
                    sections: [
                        { publicId: A.s1, baseRevision: s1, weitere: liste },
                        { publicId: A.s2, baseRevision: 1 },
                    ],
                },
            });
        const fehler = (antwort: Awaited<ReturnType<typeof speichere>>) => {
            const { code, details } = antwort.json<{ error: { code: string; details?: Record<string, unknown> } }>()
                .error;
            return [antwort.statusCode, code, details?.["field"]];
        };

        // Unbekannt und Hauptartikel: 400, nichts geschrieben.
        expect(fehler(await speichere(1, ["w5b-weiter-gold", "gibt-es-nicht"]))).toEqual([
            400,
            "validation_failed",
            "weitere",
        ]);
        expect(fehler(await speichere(1, ["w5b-weiter-kron"]))).toEqual([400, "ist_hauptartikel", "weitere"]);
        expect((await weitere()).filter((w) => w.aktiv)).toEqual([]);

        // Anlegen: Goldfelser neu (editor), der Pilgerweg aus seiner still gelegten Zeile belebt (legacy_editor). Nur der Abschnitt zählt, keine Aufträge.
        const jobs = async () =>
            (await database<{ n: number }[]>`SELECT count(*)::int AS n FROM job WHERE kind = 'path_profile'`)[0]!.n;
        const jobsVorher = await jobs();
        const an = operationId();
        const angelegt = await speichere(1, ["w5b-weiter-pilger", "w5b-weiter-gold"], an);
        expect(angelegt.statusCode, angelegt.body).toBe(200);
        const quittung = angelegt.json<{
            affected: { id: string; revision: number }[];
            derivedWork: { kind: string }[];
        }>();
        expect(quittung.affected).toEqual([{ kind: "path", id: A.s1, revision: 2 }]);
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["tiles"]);
        expect(await jobs()).toBe(jobsVorher);
        expect((await zeilen()).filter((z) => z.id === A.s1 || z.id === A.s2).map((z) => z.revision)).toEqual([2, 1]);
        expect(await weitere()).toEqual([
            {
                key: "w5b-weiter-gold",
                origin: "editor",
                system: "avesmaps3d",
                aktiv: true,
                still: null,
                zeile: expect.any(String),
            },
            {
                key: "w5b-weiter-pilger",
                origin: "legacy_editor",
                system: "legacy",
                aktiv: true,
                still: null,
                zeile: alt!.id,
            },
        ]);
        const gold = { key: "w5b-weiter-gold", name: "W5b Goldfelser Stieg" };
        const pilgerweg = { key: "w5b-weiter-pilger", name: "W5b Pilgerweg" };
        expect(await protokoll(an)).toEqual([
            { path: A.s1, changes: { weitere: { before: [], after: [gold, pilgerweg] } } },
        ]);

        // Dieselbe Liste: nichts zu schreiben, die Revision bleibt.
        const gleich = await speichere(2, ["w5b-weiter-gold", "w5b-weiter-pilger"]);
        expect(gleich.statusCode).toBe(200);
        expect(gleich.json<{ affected: unknown[] }>().affected).toEqual([]);

        // Streichen: still gelegt (nie gelöscht) mit retired_origin editor, die Herkunft der Zeile bleibt.
        const weg = operationId();
        expect((await speichere(2, ["w5b-weiter-gold"], weg)).statusCode).toBe(200);
        expect((await weitere()).find((w) => w.key === "w5b-weiter-pilger")).toMatchObject({
            origin: "legacy_editor",
            aktiv: false,
            still: "editor",
            zeile: alt!.id,
        });
        expect(await protokoll(weg)).toEqual([
            { path: A.s1, changes: { weitere: { before: [gold, pilgerweg], after: [gold] } } },
        ]);

        // Wieder anlegen: dieselbe Zeile, wieder mit ihrer Herkunft.
        expect((await speichere(3, ["w5b-weiter-gold", "w5b-weiter-pilger"])).statusCode).toBe(200);
        expect((await weitere()).filter((w) => w.aktiv).map((w) => [w.key, w.origin, w.zeile])).toEqual([
            ["w5b-weiter-gold", "editor", expect.any(String)],
            ["w5b-weiter-pilger", "legacy_editor", alt!.id],
        ]);
        expect((await zeilen()).find((z) => z.id === A.s1)?.revision).toBe(4);

        // Mit einem anderen Feld zusammen gibt es die Aufträge wie immer.
        const mitName = await app.inject({
            method: "POST",
            url: editorPathUpdateUrl(A.s1),
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: operationId(),
                sections: [
                    { publicId: A.s1, baseRevision: 4, weitere: [] },
                    { publicId: A.s2, baseRevision: 1 },
                ],
                name: "W5b Goldweg",
            },
        });
        expect(mitName.statusCode, mitName.body).toBe(200);
        expect(mitName.json<{ derivedWork: { kind: string }[] }>().derivedWork.map((arbeit) => arbeit.kind)).toContain(
            "path_profile",
        );
        expect((await weitere()).filter((w) => w.aktiv)).toEqual([]);
    });

    it("🔴 ein Reviewer schreibt nicht (403); hält ein anderer einen Abschnitt, 409 object_locked", async () => {
        await lege();
        expect(
            (await post(editorPathUpdateUrl(A.s1), { sections: strasse, name: "W5b Nie" }, "reviewer")).statusCode,
        ).toBe(403);
        const anderer = await authFixture(database).person("editor", { name: "W5b anderer" });
        await database`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${A.s2}::uuid, 'form', ${anderer.id}::uuid, 'W5b anderer', gen_random_uuid())
        `;
        const gesperrt = await post(editorPathUpdateUrl(A.s1), { sections: strasse, name: "W5b Nie" });
        expect(gesperrt.statusCode).toBe(409);
        expect(gesperrt.json<{ error: { code: string } }>().error.code).toBe("object_locked");
    });
});
