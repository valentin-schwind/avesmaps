import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    editorPlaceSiteRelationUrl,
    editorPlaceSitesAddUrl,
    editorPlaceSitesUrl,
    type EditorPlaceSites,
    type OperationReceipt,
    type Role,
    type SiteRelationWay,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { STAETTEN_SPERRE } from "../src/editor/site-edit.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Die Stätten am Ort über Kennungen (WI-0128 E18, WI-0134, Migration 0099) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Problemfälle aus dem Abschlussauftrag §3.3 und dem Bericht des Zugs 0028: Zwei Sitze derselben Organisation in zwei Städten
 * werden eine Stadt zugeschlagen; zwei gleichnamige Orte teilen sich die Stätten des anderen; ein Umbenennen reißt die Bindung
 * ab; ein Weg-Rohkandidat landet als „innerorts“; eine Entscheidung „keine Stadt“ taucht wieder als offene Frage auf; eine
 * anderswo gebundene Stätte steht trotzdem in der Arbeitsliste. Soll: WI-0134 §3 Regel 1 bis 3.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const QUELLE = "test-wi0128-e18";
const FESTUM = "e18e18e1-0000-4000-8000-000000000001";
const GARETH = "e18e18e1-0000-4000-8000-000000000002";
/** Ein zweiter Ort mit demselben Namen wie Festum: Er darf dessen Stätten nicht erben. */
const FESTUM_ZWEI = "e18e18e1-0000-4000-8000-000000000003";
/** Ein Ort ohne Wiki-Key, nur für B4: Was hier hängt, stört die Zählungen an Festum und Gareth nicht. */
const WEHRHEIM = "e18e18e1-0000-4000-8000-000000000004";
const KEY_FESTUM = "wiki:e18-festum";
const KEY_GARETH = "wiki:e18-gareth";

describeWithDatabase("Stätten am Ort über Kennungen (WI-0128 E18)", { timeout: 120_000 }, () => {
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
        await database`DELETE FROM map_audit_event WHERE operation_id IN (SELECT operation_id FROM map_operation WHERE operation_id::text LIKE 'e18e18e1-%')`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'e18e18e1-%'`;
        await database`DELETE FROM job_event WHERE kind = 'map.changed'`;
        await database`DELETE FROM site_named_place WHERE site_id IN (SELECT id FROM site WHERE source_system = ${QUELLE})`;
        await database`DELETE FROM site_settlement WHERE source_system = 'avesmaps3d' AND site_id IN (SELECT id FROM site WHERE source_system = ${QUELLE})`;
        await database`DELETE FROM site_settlement WHERE site_id IN (SELECT id FROM site WHERE source_system = ${QUELLE})`;
        await database`DELETE FROM site WHERE source_system = ${QUELLE}`;
        await database`DELETE FROM settlement_place WHERE source_system = ${QUELLE}`;
        await database`DELETE FROM wiki_key_assignment WHERE wiki_key IN (${KEY_FESTUM}, ${KEY_GARETH})`;
        await database`DELETE FROM place WHERE source_system = ${QUELLE}`;
    }

    /** Legt eine Stätte an und gibt ihre Kennung zurück. */
    async function staette(felder: {
        kind: string;
        key: string;
        name: string;
        typ?: string;
        rolle?: [string, number];
        wikiKey?: string;
        lage?: string;
        /** B4: Ein Zug hat diesen Sitz abgelöst. Die Beziehung bleibt trotzdem hängen - darum geht es. */
        stillgelegt?: boolean;
    }): Promise<string> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO site (source_kind, source_key, name, site_type, seat_role, seat_order, wiki_key, raw_location,
                              source_system, is_active, retired_at, retired_origin)
            VALUES (${felder.kind}, ${felder.key}, ${felder.name}, ${felder.typ ?? null}, ${felder.rolle?.[0] ?? null},
                    ${felder.rolle?.[1] ?? null}, ${felder.wikiKey ?? null}, ${felder.lage ?? null}, ${QUELLE},
                    ${felder.stillgelegt !== true}, ${felder.stillgelegt === true ? new Date() : null},
                    ${felder.stillgelegt === true ? "import" : null})
            RETURNING id::text AS id
        `;
        return row!.id;
    }

    const bindeAn = (siteId: string, ortPublicId: string | null, origin: string) => database`
        INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
        VALUES (${siteId}::bigint, ${ortPublicId}::uuid,
                (SELECT id FROM place WHERE public_id = ${ortPublicId}::uuid), ${origin}, ${QUELLE})
    `;

    const nenne = (siteId: string, position: number, raw: string, key: string | null) => database`
        INSERT INTO site_named_place (site_id, position, target_raw, target_key)
        VALUES (${siteId}::bigint, ${position}, ${raw}, ${key})
    `;

    const lies = async (publicId: string): Promise<EditorPlaceSites> =>
        (
            await app.inject({
                method: "GET",
                url: editorPlaceSitesUrl(publicId),
                headers: { cookie: cookies.get("editor") ?? "" },
            })
        ).json<EditorPlaceSites>();

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        const fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `E18 ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }

        for (const [id, name, x] of [
            [FESTUM, "E18 Festum", 500],
            [GARETH, "E18 Gareth", 520],
            [FESTUM_ZWEI, "E18 Festum", 540],
            [WEHRHEIM, "E18 Wehrheim", 560],
        ] as const) {
            await database`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${id}, 'aventuria', ${name}, 'stadt', ST_SetSRID(ST_MakePoint(${x}, 500), 0), ${QUELLE}, TRUE)
            `;
        }
        for (const [key, id] of [
            [KEY_FESTUM, FESTUM],
            [KEY_GARETH, GARETH],
        ] as const) {
            await database`
                INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, is_active)
                VALUES ('siedlung', ${id}::uuid, ${key}, TRUE)
            `;
        }

        // Nordlandbank: zwei Sitze derselben Organisation, je eine eigene Stätte, je eigene Stadt (WI-0134 T1).
        const sitzFestum = await staette({
            kind: "sitz",
            key: "Nordlandbank\u001f[[E18 Festum]]",
            name: "Nordlandbank",
            typ: "Bank",
            rolle: ["hauptsitz", 0],
            wikiKey: "wiki:e18-nordlandbank",
            lage: "[[E18 Festum]]",
        });
        const sitzGareth = await staette({
            kind: "sitz",
            key: "Nordlandbank\u001f[[E18 Gareth]]",
            name: "Nordlandbank",
            typ: "Bank",
            rolle: ["zweigsitz", 1],
            wikiKey: "wiki:e18-nordlandbank",
            lage: "[[E18 Gareth]]",
        });
        await bindeAn(sitzFestum, FESTUM, "gespeichert");
        await bindeAn(sitzGareth, GARETH, "gespeichert");
        await nenne(sitzFestum, 0, "E18 Festum", KEY_FESTUM);
        await nenne(sitzGareth, 0, "E18 Gareth", KEY_GARETH);

        // Ein Weg-Rohkandidat (P3b): Er NENNT Festum, ist aber nie innerorts (603 Fälle des Zugs 0028).
        const weg = await staette({ kind: "weg", key: "wiki:e18-weg", name: "E18 Saumpfad", typ: "Weg" });
        await nenne(weg, 0, "E18 Festum", KEY_FESTUM);

        /*
         * B2: zweimal „keine Stadt“, einmal aus einem Lauf und einmal von Hand. Nur das zweite ist ein Entscheid.
         * Gemessen am 2026-10-13: 43 Punkte tragen `wiki`, einer `manual`, einer `gespeichert`.
         */
        const keineStadt = await staette({
            kind: "punkt",
            key: "e18e18e1-0000-4000-8000-0000000000aa",
            name: "E18 Einsiedelei",
        });
        await database`
            INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
            VALUES (${keineStadt}::bigint, NULL, NULL, 'wiki', ${QUELLE})
        `;
        await nenne(keineStadt, 0, "E18 Festum", KEY_FESTUM);

        const vonHand = await staette({
            kind: "punkt",
            key: "e18e18e1-0000-4000-8000-0000000000cc",
            name: "E18 Klause",
        });
        await database`
            INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
            VALUES (${vonHand}::bigint, NULL, NULL, 'manual', ${QUELLE})
        `;
        await nenne(vonHand, 0, "E18 Festum", KEY_FESTUM);

        /*
         * B4: Die Wiki hat die Ortsangabe der Gilde geändert. Der alte Sitz liegt still, seine Beziehung hängt noch an
         * Wehrheim; der neue Sitz trägt dieselbe Organisation in der Kennung und noch keine Beziehung.
         */
        const gildeAlt = await staette({
            kind: "sitz",
            key: "E18 Gilde\u001f[[E18 Alt]]",
            name: "E18 Gildenhaus",
            typ: "Gilde",
            rolle: ["hauptsitz", 0],
            lage: "[[E18 Alt]]",
            stillgelegt: true,
        });
        await bindeAn(gildeAlt, WEHRHEIM, "gespeichert");
        await staette({
            kind: "sitz",
            key: "E18 Gilde\u001f[[E18 Wehrheim]]",
            name: "E18 Gildenhaus",
            typ: "Gilde",
            rolle: ["hauptsitz", 0],
            lage: "[[E18 Wehrheim]]",
        });

        // Und ein zweiter Fall, in dem die Organisation ZWEI freie Sitze trägt: Dort darf nichts umgehängt werden.
        const bundAlt = await staette({
            kind: "sitz",
            key: "E18 Bund\u001f[[E18 Alt]]",
            name: "E18 Bundhaus",
            typ: "Bund",
            rolle: ["hauptsitz", 0],
            lage: "[[E18 Alt]]",
            stillgelegt: true,
        });
        await bindeAn(bundAlt, WEHRHEIM, "gespeichert");
        for (const wo of ["Nord", "Sued"])
            await staette({
                kind: "sitz",
                key: `E18 Bund\u001f[[E18 ${wo}]]`,
                name: "E18 Bundhaus",
                typ: "Bund",
                rolle: ["zweigsitz", 1],
            });

        // Eine Stätte, die Festum nennt, aber an Gareth gebunden ist: geklärt, nur nicht hierher.
        const anderswo = await staette({
            kind: "gespeichert",
            key: "e18e18e1-0000-4000-8000-0000000000bb",
            name: "E18 Zollhaus",
        });
        await bindeAn(anderswo, GARETH, "gespeichert");
        await nenne(anderswo, 0, "E18 Festum", KEY_FESTUM);

        // Eine offene Stätte mit unbekanntem Key: Sie nennt Festum ohne Key und bleibt darum unsichtbar für die Evidenz.
        const ohneKey = await staette({ kind: "stadtteil", key: "E18 Vorstadt", name: "E18 Vorstadt" });
        await nenne(ohneKey, 0, "E18 Festum", null);

        // Legacys heutige Anzeige: zwei Zeilen am gefalteten Namen „e18 festum“ - die BEIDE gleichnamigen Orte zeigen.
        for (const name of ["E18 Alte Mühle", "E18 Neue Mühle"]) {
            await database`
                INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, source_system, is_active, state)
                VALUES ('e18 festum', 'E18 Festum', ${name}, 'Gebaeude', ${QUELLE}, TRUE, 'active')
            `;
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
        await database?.end();
    });

    it("🔴 belegt sind nur die Stätten mit gespeicherter Beziehung an DIESEM Ort", async () => {
        const festum = await lies(FESTUM);
        expect(festum.bound.map((x) => x.name)).toEqual(["Nordlandbank"]);
        const sitz = festum.bound[0]!;
        expect(sitz.sourceKind).toBe("sitz");
        expect(sitz.seat).toEqual({ role: "hauptsitz", order: 0 });
        expect(sitz.relation).toMatchObject({ origin: "gespeichert", placePublicId: FESTUM });

        // 🔴 Der zweite Sitz derselben Organisation gehört Gareth - und zwar als eigenes Objekt mit eigener Kennung.
        const gareth = await lies(GARETH);
        const sitzeDort = gareth.bound.filter((x) => x.name === "Nordlandbank");
        expect(sitzeDort).toHaveLength(1);
        expect(sitzeDort[0]!.seat).toEqual({ role: "zweigsitz", order: 1 });
        expect(sitzeDort[0]!.id).not.toBe(sitz.id);
    });

    it("🔴 zwei gleichnamige Orte teilen nichts mehr - weder Beziehung noch sichtbare Zeile", async () => {
        const eins = await lies(FESTUM);
        const zwei = await lies(FESTUM_ZWEI);
        expect(eins.bound.length).toBeGreaterThan(0);
        expect(zwei.bound).toEqual([]);
        /*
         * 🪤 Hier lag Legacys Loch: Zwei Zeilen hängen am gefalteten Namen „e18 festum" und standen damit bei BEIDEN Orten.
         * Seit Lesart B (Betreiberentscheid 2026-10-13) liest das Panel über Kennungen; der zweite Festum zeigt nichts, und
         * die zwei Zeilen am Namen zählen nirgends mehr mit.
         */
        expect(zwei.sichtbar.count).toBe(0);
        expect(eins.sichtbar.count).toBeGreaterThan(0);
    });

    it("🔴 ein Weg-Rohkandidat ist nie „innerorts“, er steht offen", async () => {
        const festum = await lies(FESTUM);
        expect(festum.bound.some((x) => x.sourceKind === "weg")).toBe(false);
        const weg = festum.open.find((x) => x.sourceKind === "weg");
        expect(weg?.name).toBe("E18 Saumpfad");
        expect(weg?.relation).toBeUndefined();
        expect(weg?.named).toEqual([
            { raw: "E18 Festum", key: KEY_FESTUM, placePublicId: FESTUM, placeName: "E18 Festum" },
        ]);
    });

    it("🔴 B2: ein Lauf, der keine Stadt fand, ist kein Entscheid - nur `manual` und `editor` halten eine Stätte draußen", async () => {
        /*
         * 💣 Hier lag ein stiller Fehler: Jede aktive Beziehung hielt eine Stätte aus der Arbeitsliste, auch die
         * 43 Zeilen „keine Stadt“ mit Herkunft `wiki`. Die sind das Protokoll eines Laufs, der nichts fand, und kein
         * Mensch hat sie entschieden; sie gegen einen Editor zu schützen hieße, eine Nicht-Entscheidung festzuschreiben.
         */
        const festum = await lies(FESTUM);
        const namen = festum.open.map((x) => x.name);
        expect(namen).toContain("E18 Einsiedelei");
        // Die Herkunft reist mit, damit der Reiter sagen kann, woran man ist - aber ohne Ort.
        const offen = festum.open.find((x) => x.name === "E18 Einsiedelei")!;
        expect(offen.relation).toEqual({ origin: "wiki" });

        // Der eine Entscheid eines Menschen bleibt draußen, und eine Bindung anderswo ebenso.
        expect(namen).not.toContain("E18 Klause");
        expect(namen).not.toContain("E18 Zollhaus");
    });

    it("🔴 B4: eine stillgelegte Stätte verschwindet nicht - sie steht belegt, mit Hinweis und Nachfolger", async () => {
        const wehrheim = await lies(WEHRHEIM);
        const alt = wehrheim.bound.find((x) => x.name === "E18 Gildenhaus")!;
        expect(alt.retired).toBe(true);
        expect(alt.successor).toMatchObject({ name: "E18 Gildenhaus", rawLocation: "[[E18 Wehrheim]]" });

        // 🔴 Mehrere Anwärter sind kein Nachfolger: Dort bleibt das Feld leer, und der Reiter zeigt keinen Knopf.
        const bund = wehrheim.bound.find((x) => x.name === "E18 Bundhaus")!;
        expect(bund.retired).toBe(true);
        expect(bund.successor).toBeUndefined();

        // 🪤 Der sichtbare Leser zeigt sie NICHT: Was still liegt, geht den Besucher nichts an.
        expect(wehrheim.sichtbar.count).toBe(0);
    });

    it("🔴 ohne Key gibt es keine Evidenz: ein Linkziel ohne Key bindet und nennt nichts", async () => {
        const festum = await lies(FESTUM);
        expect(festum.open.map((x) => x.name)).not.toContain("E18 Vorstadt");
    });

    it("🔴 ein Umbenennen ändert gar nichts mehr - weder Beziehung noch sichtbare Zahl", async () => {
        const vorher = await lies(FESTUM);
        await database`UPDATE place SET name = 'E18 Festum (neu)' WHERE public_id = ${FESTUM}::uuid`;
        try {
            const nachher = await lies(FESTUM);
            expect(nachher.bound.map((x) => x.name)).toEqual(["Nordlandbank"]);
            /*
             * 🔴 Das ist der Gewinn des Kennungsmodells: Legacys Faltung hing am Namen, ein Umbenennen trennte die Bindung.
             * Über Kennungen bleibt alles stehen, und die sichtbare Zahl bleibt dieselbe.
             */
            expect(nachher.sichtbar.count).toBe(vorher.sichtbar.count);
        } finally {
            await database`UPDATE place SET name = 'E18 Festum' WHERE public_id = ${FESTUM}::uuid`;
        }
    });

    describe("E10b zuordnen, verlagern, lösen", () => {
        let nr = 0;
        const operationId = (): string => `e18e18e1-0000-4000-9000-${String((nr += 1)).padStart(12, "0")}`;
        const relate = (ort: string, siteId: string, weg: SiteRelationWay, rolle: Role = "editor") =>
            app.inject({
                method: "POST",
                url: editorPlaceSiteRelationUrl(ort),
                headers: { cookie: cookies.get(rolle) ?? "", origin: TEST_ORIGIN },
                payload: { operationId: operationId(), siteId, weg },
            });
        const idVon = async (name: string, kind: string, aktiv = true): Promise<string> => {
            const [row] = await database<{ id: string }[]>`
                SELECT id::text AS id FROM site
                 WHERE source_system = ${QUELLE} AND name = ${name} AND source_kind = ${kind}
                   AND is_active = ${aktiv}
                 ORDER BY id LIMIT 1
            `;
            return row!.id;
        };

        it("\u{1f534} eine offene Stätte lässt sich diesem Ort zuordnen - mit Herkunft `editor`, nie aus einem Namen", async () => {
            const weg = await idVon("E18 Saumpfad", "weg");
            expect((await lies(FESTUM)).open.some((x) => x.id === weg)).toBe(true);

            const antwort = await relate(FESTUM, weg, "hierher");
            expect(antwort.statusCode).toBe(200);
            expect(antwort.json<OperationReceipt>().affected).toEqual(
                expect.arrayContaining([{ kind: "site", id: weg }]),
            );

            const danach = await lies(FESTUM);
            const gebunden = danach.bound.find((x) => x.id === weg);
            expect(gebunden?.relation).toEqual({ origin: "editor", placePublicId: FESTUM });
            // 🔴 Keine Kennung aus Legacy: Der Mensch hat den Ort gewählt, das ist die Kennung.
            expect(gebunden?.relation?.legacyPublicId).toBeUndefined();
            expect(danach.open.some((x) => x.id === weg)).toBe(false);
        });

        it("\u{1f534} dieselbe Kennung ein zweites Mal legt nichts an (Replay), ein zweites Binden am selben Ort wird abgelehnt", async () => {
            const weg = await idVon("E18 Saumpfad", "weg");
            const wieder = await relate(FESTUM, weg, "hierher");
            expect(wieder.statusCode).toBe(400);
            expect(wieder.json()).toMatchObject({ error: { details: { field: "siteId" } } });

            // Replay: dieselbe `operationId` mit demselben Körper gibt die erste Quittung zurück.
            const sitz = await idVon("E18 Zollhaus", "gespeichert");
            const einmal = operationId();
            const koerper = { operationId: einmal, siteId: sitz, weg: "hierher" };
            const a = await app.inject({
                method: "POST",
                url: editorPlaceSiteRelationUrl(FESTUM),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: koerper,
            });
            const b = await app.inject({
                method: "POST",
                url: editorPlaceSiteRelationUrl(FESTUM),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: koerper,
            });
            expect(a.json<OperationReceipt>().status).toBe("applied");
            expect(b.json<OperationReceipt>().status).toBe("replayed");
            const [zahl] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM site_settlement WHERE site_id = ${sitz}::bigint AND is_active
            `;
            expect(zahl!.n).toBe(1);
        });

        it("\u{1f534} Verlagern ist EINE Operation und steht im Verlauf BEIDER Orte", async () => {
            const sitz = await idVon("E18 Zollhaus", "gespeichert");
            // Das Zollhaus liegt nach dem vorigen Fall in Festum; jetzt nach Gareth.
            const antwort = await relate(GARETH, sitz, "hierher");
            expect(antwort.statusCode).toBe(200);
            const quittung = antwort.json<OperationReceipt>();

            expect((await lies(GARETH)).bound.some((x) => x.id === sitz)).toBe(true);
            expect((await lies(FESTUM)).bound.some((x) => x.id === sitz)).toBe(false);
            const [zahl] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM site_settlement WHERE site_id = ${sitz}::bigint AND is_active
            `;
            expect(zahl!.n).toBe(1);

            const protokoll = await database<
                {
                    action: string;
                    place_public_id: string;
                    changes: { staetten?: { before?: unknown; after?: unknown } };
                }[]
            >`
                SELECT action, place_public_id::text AS place_public_id, changes
                  FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid
                 ORDER BY action
            `;
            expect(protokoll.map((zeile) => [zeile.action, zeile.place_public_id])).toEqual([
                ["place.site_attached", GARETH],
                ["place.site_detached", FESTUM],
            ]);
            /*
             * 💣 Der Inhalt, nicht nur die Zeilen: `before` und `after` sind LISTEN von Kennungen. Eine Zeit lang stand in
             * `before` die Revision des Orts, weil ein Aufruf ein Argument zu viel trug - Vitest merkte nichts, weil es die
             * Typen abstreift, und erst `tsc` fand es. Beide Enden nennen dieselbe Zeile: EINE Beziehung je Stätte (0099).
             */
            const an = protokoll.find((zeile) => zeile.action === "place.site_attached")!.changes.staetten;
            const ab = protokoll.find((zeile) => zeile.action === "place.site_detached")!.changes.staetten;
            expect(an?.before).toEqual([]);
            expect(Array.isArray(an?.after) && (an.after as string[]).length).toBe(1);
            expect(ab?.after).toEqual([]);
            expect(ab?.before).toEqual(an?.after);
        });

        it("\u{1f534} Lösen nimmt die Beziehung zurück; an einem fremden Ort geht es nicht", async () => {
            const sitz = await idVon("E18 Zollhaus", "gespeichert");
            const falsch = await relate(FESTUM, sitz, "loesen");
            expect(falsch.statusCode).toBe(400);

            const richtig = await relate(GARETH, sitz, "loesen");
            expect(richtig.statusCode).toBe(200);
            expect((await lies(GARETH)).bound.some((x) => x.id === sitz)).toBe(false);
            // Die Stätte bleibt eine Stätte und steht wieder offen, wo ihre Kette einen Ort nennt.
            expect((await lies(FESTUM)).open.some((x) => x.id === sitz)).toBe(true);
        });

        it("🔴 B4: Umhängen ist EINE Operation - der Nachfolger bekommt die Beziehung, die alte geht still", async () => {
            const alt = await idVon("E18 Gildenhaus", "sitz", false);
            const neu = await idVon("E18 Gildenhaus", "sitz", true);

            const antwort = await relate(WEHRHEIM, alt, "nachfolger");
            expect(antwort.statusCode).toBe(200);
            const quittung = antwort.json<OperationReceipt>();
            expect(
                quittung.affected
                    .filter((x) => x.kind === "site")
                    .map((x) => x.id)
                    .sort(),
            ).toEqual([alt, neu].sort());

            const nachher = await lies(WEHRHEIM);
            expect(nachher.bound.some((x) => x.id === alt)).toBe(false);
            const gebunden = nachher.bound.find((x) => x.id === neu)!;
            expect(gebunden.retired).toBeUndefined();
            expect(gebunden.relation).toMatchObject({ origin: "editor", placePublicId: WEHRHEIM });
            // Jetzt sieht ihn auch der Besucher: Der lebende Sitz zählt, der stillgelegte zählte nie.
            expect(nachher.sichtbar.count).toBe(1);

            const [protokoll] = await database<{ action: string; changes: Record<string, unknown> }[]>`
                SELECT action, changes FROM map_audit_event WHERE operation_id = ${quittung.operationId}::uuid
            `;
            expect(protokoll!.action).toBe("place.site_succeeded");
            const bewegt = protokoll!.changes["staetten"] as { before: string[]; after: string[] };
            expect(bewegt.before).toHaveLength(1);
            expect(bewegt.after).toHaveLength(1);
            expect(bewegt.before).not.toEqual(bewegt.after);
        });

        it("🔴 B4: ohne eindeutigen Nachfolger wird abgelehnt, nicht geraten", async () => {
            const bund = await idVon("E18 Bundhaus", "sitz", false);
            const antwort = await relate(WEHRHEIM, bund, "nachfolger");
            expect(antwort.statusCode).toBe(400);
            expect(antwort.json<{ error: { message: string } }>().error.message).toContain("Anwärter");
            // Die Beziehung steht unverändert da: Eine Ablehnung bewegt nichts.
            expect((await lies(WEHRHEIM)).bound.some((x) => x.id === bund)).toBe(true);

            // Und eine LEBENDE Stätte wird nicht umgehängt: Es gibt nichts abzulösen.
            const lebt = await idVon("Nordlandbank", "sitz", true);
            expect((await relate(FESTUM, lebt, "nachfolger")).statusCode).toBe(400);
        });

        /*
         * 🔴 Die Sperre je Stätte (`STAETTEN_SPERRE`): Die App hat an `site` nur SELECT, `FOR UPDATE` darauf scheitert als App-Rolle
         * (`schreibwege-app-rolle.test.ts`). Zwei Schreiber derselben Stätte laufen darum über eine Advisory-Sperre nacheinander. Hier
         * hält der Test sie selbst, wie ein Vorgänger, der mitten in seiner Operation steckt: Der zweite muss WARTEN und danach lesen,
         * was der erste festgeschrieben hat. Läse er davor, hielte er die Stätte für ungebunden und liefe in den eindeutigen Schlüssel
         * (`site_settlement_site_unique`, 0099), statt zu verlagern.
         */
        const schlaf = (ms: number): Promise<void> => new Promise((erfuellt) => setTimeout(erfuellt, ms));

        /** Hält die Sperre einer Stätte in einer eigenen Transaktion, schreibt darin `tat` und gibt sie erst mit `freigeben` frei. */
        async function halteSperre(
            siteId: string,
            tat: (tx: Queryable) => Promise<void>,
        ): Promise<{ freigeben: () => Promise<void> }> {
            let loese!: () => void;
            const frei = new Promise<void>((erfuellt) => {
                loese = erfuellt;
            });
            let meldeGehalten!: () => void;
            const gehalten = new Promise<void>((erfuellt) => {
                meldeGehalten = erfuellt;
            });
            const lauf = database.begin(async (tx) => {
                await tx`SELECT pg_advisory_xact_lock(hashtext(${STAETTEN_SPERRE}), hashtext(${siteId}::bigint::text))`;
                await tat(tx);
                meldeGehalten();
                await frei;
            });
            // Scheitert die Vorbereitung, endet `lauf` mit dem Fehler, und der Test bricht dort ab statt zu hängen.
            await Promise.race([gehalten, lauf]);
            return {
                freigeben: async () => {
                    loese();
                    await lauf;
                },
            };
        }

        /** Wartet, bis eine Sitzung auf eine Advisory-Sperre wartet: die Gewissheit, dass der zweite Schreiber am ersten hängt. */
        async function wartetAufSperre(): Promise<void> {
            for (let versuch = 0; versuch < 100; versuch += 1) {
                const [zeile] = await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
                `;
                if (zeile!.n > 0) return;
                await schlaf(50);
            }
            throw new Error("Niemand wartet auf die Sperre der Stätte.");
        }

        /** Die Beziehung der Stätte an einen Ort legen, innerhalb der Transaktion des Vorgängers. */
        const bindeInTransaktion = (siteId: string, ortPublicId: string) => async (tx: Queryable) => {
            await tx`
                INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
                VALUES (${siteId}::bigint, NULL, (SELECT id FROM place WHERE public_id = ${ortPublicId}::uuid), 'editor', ${QUELLE})
            `;
        };

        it("🔴 Zuordnen: wer um dieselbe Stätte kommt, wartet auf die Sperre und verlagert dann, was der Vorgänger gebunden hat", async () => {
            const sitz = await staette({
                kind: "weg",
                key: "wiki:e18-wettlauf-zuordnen",
                name: "E18 Wettlauf Zuordnen",
            });
            const vorgaenger = await halteSperre(sitz, bindeInTransaktion(sitz, GARETH));

            let fertig = false;
            const antwort = relate(FESTUM, sitz, "hierher").then((a) => {
                fertig = true;
                return a;
            });
            await wartetAufSperre();
            await schlaf(100);
            expect(fertig, "der zweite Schreiber darf nicht vor dem ersten fertig sein").toBe(false);

            await vorgaenger.freigeben();
            const a = await antwort;
            expect(a.statusCode, a.body).toBe(200);
            // Es war ein VERLAGERN (Gareth nach Festum), kein zweites Anlegen: eine Zeile, aktiv, an Festum.
            const zeilen = await database<{ place: string; is_active: boolean }[]>`
                SELECT p.public_id::text AS place, ss.is_active
                  FROM site_settlement ss JOIN place p ON p.id = ss.place_id WHERE ss.site_id = ${sitz}::bigint
            `;
            expect(zeilen).toEqual([{ place: FESTUM, is_active: true }]);
            const protokoll = await database<{ action: string; place_public_id: string }[]>`
                SELECT action, place_public_id::text AS place_public_id FROM map_audit_event
                 WHERE operation_id = ${a.json<OperationReceipt>().operationId}::uuid ORDER BY action
            `;
            expect(protokoll.map((zeile) => [zeile.action, zeile.place_public_id])).toEqual([
                ["place.site_attached", FESTUM],
                ["place.site_detached", GARETH],
            ]);
        });

        it("🔴 Hinzufügen: dieselbe Wartepflicht, und die Ablehnung nennt, was der Vorgänger inzwischen gebunden hat", async () => {
            const sitz = await staette({
                kind: "weg",
                key: "wiki:e18-wettlauf-hinzufuegen",
                name: "E18 Wettlauf Hinzufügen",
            });
            const vorgaenger = await halteSperre(sitz, bindeInTransaktion(sitz, GARETH));

            let fertig = false;
            const antwort = app
                .inject({
                    method: "POST",
                    url: editorPlaceSitesAddUrl(FESTUM),
                    headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                    payload: { operationId: operationId(), sites: [sitz], places: [] },
                })
                .then((a) => {
                    fertig = true;
                    return a;
                });
            await wartetAufSperre();
            await schlaf(100);
            expect(fertig, "der zweite Schreiber darf nicht vor dem ersten fertig sein").toBe(false);

            await vorgaenger.freigeben();
            const a = await antwort;
            expect(a.statusCode, a.body).toBe(409);
            expect(a.json<{ error: { code: string; message: string } }>().error).toMatchObject({
                code: "edit_conflict",
                message: expect.stringContaining("inzwischen E18 Gareth zugeordnet"),
            });
            // Die Ablehnung bewegt nichts: Die Stätte bleibt, wo der Vorgänger sie hingelegt hat.
            const [zeile] = await database<{ place: string }[]>`
                SELECT p.public_id::text AS place FROM site_settlement ss JOIN place p ON p.id = ss.place_id
                 WHERE ss.site_id = ${sitz}::bigint AND ss.is_active
            `;
            expect(zeile?.place).toBe(GARETH);
        });

        it("🔴 zwei Zuordnungen derselben Stätte zugleich enden in EINER aktiven Beziehung, nie in einem Schlüsselfehler", async () => {
            for (const runde of [1, 2, 3]) {
                const sitz = await staette({
                    kind: "weg",
                    key: `wiki:e18-wettlauf-zugleich-${String(runde)}`,
                    name: "E18 Wettlauf Zugleich",
                });
                const antworten = await Promise.all([relate(FESTUM, sitz, "hierher"), relate(GARETH, sitz, "hierher")]);
                // Beide gehen durch: Die zweite Operation verlagert, was die erste gebunden hat.
                expect(
                    antworten.map((a) => a.statusCode),
                    antworten.map((a) => a.body).join(" | "),
                ).toEqual([200, 200]);
                const aktiv = await database<{ place: string }[]>`
                    SELECT p.public_id::text AS place FROM site_settlement ss JOIN place p ON p.id = ss.place_id
                     WHERE ss.site_id = ${sitz}::bigint AND ss.is_active
                `;
                expect(aktiv).toHaveLength(1);
                const operationen = antworten.map((a) => a.json<OperationReceipt>().operationId);
                const protokoll = await database<{ action: string; place_public_id: string }[]>`
                    SELECT action, place_public_id::text AS place_public_id FROM map_audit_event
                     WHERE operation_id = ANY(${operationen}::uuid[]) ORDER BY action, place_public_id
                `;
                // Zweimal angebunden; einmal gelöst, und zwar an dem Ort, an dem die erste Operation die Stätte hinterließ.
                const verlassen = [FESTUM, GARETH].find((ort) => ort !== aktiv[0]!.place)!;
                expect(protokoll.map((zeile) => [zeile.action, zeile.place_public_id])).toEqual([
                    ["place.site_attached", FESTUM],
                    ["place.site_attached", GARETH],
                    ["place.site_detached", verlassen],
                ]);
            }
        });

        it("ohne Schreibrecht 403, eine unbekannte Stätte 404", async () => {
            const weg = await idVon("E18 Saumpfad", "weg");
            expect((await relate(FESTUM, weg, "loesen", "reviewer")).statusCode).toBe(403);
            const fehlt = await relate(FESTUM, "999999999", "hierher");
            expect(fehlt.statusCode).toBe(404);
        });
    });

    it("ohne Recht 403, ohne Ort 404", async () => {
        const ohne = await app.inject({ method: "GET", url: editorPlaceSitesUrl(FESTUM) });
        expect(ohne.statusCode).toBe(401);
        const fehlt = await app.inject({
            method: "GET",
            url: editorPlaceSitesUrl("e18e18e1-0000-4000-8000-00000000ffff"),
            headers: { cookie: cookies.get("editor") ?? "" },
        });
        expect(fehlt.statusCode).toBe(404);
        // Ein Reviewer darf lesen (`use_editor_menu`).
        const reviewer = await app.inject({
            method: "GET",
            url: editorPlaceSitesUrl(FESTUM),
            headers: { cookie: cookies.get("reviewer") ?? "" },
        });
        expect(reviewer.statusCode).toBe(200);
    });
});
