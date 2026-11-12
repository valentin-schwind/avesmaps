import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    editorPlaceDeleteUrl,
    editorPlaceRemovalUrl,
    editorPlaceRestoreUrl,
    editorPlaceTakeOffMapUrl,
    type OperationReceipt,
    type PlaceRemoval,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * Qualitätsreview 2026-10-12, Befund Q-01 gegen echtes PostgreSQL: „Ort entfernen“ beurteilte die Stätten am Ort allein über den
 * GEFALTETEN NAMEN (`settlement_place.settlement_key`, 0078). Das Kennungsmodell (WI-0134, Migration 0099) bindet eine Stätte über
 * Legacys gespeicherte Kennung der Siedlung (`site_settlement.settlement_legacy_public_id`, dazu `place_id`).
 *
 * 🔴 Belegter Befund im lokalen Datenstand vom 2026-10-12: Vier Stätten sind über die Kennung an „Fuchswalden (Bärenau)“ und
 * „Siebeneichen (Bärenau)“ gebunden, ihr `settlement_key` lautet aber „fuchswalden (siebeneichen)“ beziehungsweise
 * „siebeneichen (dorf)“ und trifft damit KEINEN Ort. Die Namensregel zählte dort 0: Die Vorschau sagte „keine Stätten“, und der
 * Server ließ das Entfernen zu, obwohl Stätten am Ort hängen.
 *
 * Soll (Handover 2026-10-12: „Mit dem Kennungsmodell abgleichen … Nicht blind ersetzen. Identitäten getrennt halten.“): BEIDE
 * Bindungen gelten. Die Namensregel bleibt unverändert die Quelle der heutigen Leser (0099 „erweitern, nicht umstellen“), die
 * Kennungsregel kommt hinzu. Kein Ort verliert dadurch Schutz; zwei Orte gewinnen ihn.
 *
 * Problemfälle hier: Stätte nur über die Kennung; Stätte nur über den Namen (Regression); gleichnamige Orte (Identitäten getrennt);
 * dieselbe Stätte über beide Regeln (keine Doppelung); Ort ohne Lage (hat keine `place.id`, nur die `public_id`); Umbenennen.
 *
 * 🔴 Seit WI-0128 E22 G2 (Abschlussauftrag 2026-10-13 §3.2.6) SPERREN Stätten das Löschen nicht mehr: Eine Siedlung geht
 * samt ihren belegten Beziehungen still, umkehrbar, und `place.restore` holt genau sie zurück. Der Schutz aus Q-01 bleibt, er
 * heißt nur anders: Die Vorschau nennt JEDE Stätte am Ort über beide Bindungen, und das Abnehmen fragt weiter nach.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-qr-staetten";
const KENNUNG = "ab220128-0000-4000-8000-000000000a01";
const NAME = "ab220128-0000-4000-8000-000000000b01";
const DOPPEL_A = "ab220128-0000-4000-8000-000000000c01";
const DOPPEL_B = "ab220128-0000-4000-8000-000000000c02";
const OHNE_LAGE = "ab220128-0000-4000-8000-000000000d01";
let zaehler = 0;
const operationId = (): string => `ab220128-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;

describeWithDatabase("Ort entfernen: Stätten über Kennung und Name (Q-01)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let cookie = "";

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
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'ab220128-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'ab220128-%'`;
        await database`DELETE FROM site_settlement WHERE site_id IN (SELECT id FROM site WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM site WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM settlement_place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place_unplaced WHERE source_system = ${SOURCE}`;
    }

    /** Eine Stätte, die Legacy nur unter einem Siedlungsnamen führt (0078): Der gefaltete Name ist ihr ganzer Bezug. */
    async function staetteUeberNamen(siedlung: string, name: string, art: string): Promise<void> {
        await database`
            INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, on_map, source_system)
            VALUES (${siedlung.trim().toLowerCase()}, ${siedlung}, ${name}, ${art}, FALSE, ${SOURCE})
        `;
    }

    /**
     * Eine Stätte, die Legacy mit der gespeicherten Kennung der Siedlung führt (0099, P2 `gespeichert`): Ihr Eintrag in
     * `settlement_place` nennt einen Siedlungsnamen, der keinen Ort trifft — genau der belegte Fall „Fuchswalden (Bärenau)“.
     */
    async function staetteUeberKennung(ort: string, name: string, art: string, fremdeSiedlung: string): Promise<void> {
        await staetteUeberNamen(fremdeSiedlung, name, art);
        const [stelle] = await database<{ id: string }[]>`
            INSERT INTO site (source_kind, source_key, name, site_type, source_system)
            VALUES ('gespeichert', ${`${SOURCE}:${name}`}, ${name}, ${art}, ${SOURCE})
            RETURNING id::text
        `;
        await database`
            INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
            VALUES (${stelle!.id}::bigint, ${ort}::uuid, (SELECT id FROM place WHERE public_id = ${ort}::uuid),
                    'gespeichert', ${SOURCE})
        `;
    }

    const vorschau = async (id: string): Promise<PlaceRemoval> =>
        (await app.inject({ method: "GET", url: editorPlaceRemovalUrl(id), headers: { cookie } })).json<PlaceRemoval>();

    const namen = async (id: string): Promise<string[]> =>
        (await vorschau(id)).staetten.map((staette) => staette.name).sort();

    const loeschen = (id: string, baseRevision: number) =>
        app.inject({
            method: "POST",
            url: editorPlaceDeleteUrl(id),
            headers: { cookie, origin: TEST_ORIGIN },
            payload: { operationId: operationId(), baseRevision },
        });

    const abnehmen = (id: string, baseRevision: number, staetten?: "bleiben") =>
        app.inject({
            method: "POST",
            url: editorPlaceTakeOffMapUrl(id),
            headers: { cookie, origin: TEST_ORIGIN },
            payload: { operationId: operationId(), baseRevision, ...(staetten ? { staetten } : {}) },
        });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        const fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "QR Staetten" });
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;

        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${KENNUNG}, 'aventuria', 'QR Kennungsstadt', 'stadt', ST_SetSRID(ST_MakePoint(451, 455), 0), ${SOURCE}, TRUE),
                   (${NAME}, 'aventuria', 'QR Namensstadt', 'stadt', ST_SetSRID(ST_MakePoint(452, 456), 0), ${SOURCE}, TRUE),
                   (${DOPPEL_A}, 'aventuria', 'QR Doppelstadt', 'stadt', ST_SetSRID(ST_MakePoint(453, 457), 0), ${SOURCE}, TRUE),
                   (${DOPPEL_B}, 'aventuria', 'QR Doppelstadt', 'stadt', ST_SetSRID(ST_MakePoint(454, 458), 0), ${SOURCE}, TRUE)
        `;
        await database`
            INSERT INTO place_unplaced (public_id, map_domain_id, name, subtype, source_system)
            VALUES (${OHNE_LAGE}, 'aventuria', 'QR Ortohnelage', 'dorf', ${SOURCE})
        `;

        // Nur über die Kennung gebunden: der belegte Fall.
        await staetteUeberKennung(KENNUNG, "QR Kennungstempel", "Tempel", "QR Fremder Siedlungsname");
        // Nur über den Namen gebunden: der heutige Regelfall (3.793 Zeilen an 384 Orten im Stand vom 2026-10-12).
        await staetteUeberNamen("QR Namensstadt", "QR Namenstempel", "Tempel");
        // Über BEIDE Regeln gebunden: darf nur einmal erscheinen.
        await staetteUeberNamen("QR Namensstadt", "QR Beidetempel", "Tempel");
        const [beide] = await database<{ id: string }[]>`
            INSERT INTO site (source_kind, source_key, name, site_type, source_system)
            VALUES ('gespeichert', ${`${SOURCE}:beide`}, 'QR Beidetempel', 'Tempel', ${SOURCE})
            RETURNING id::text
        `;
        await database`
            INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
            VALUES (${beide!.id}::bigint, ${NAME}::uuid, (SELECT id FROM place WHERE public_id = ${NAME}::uuid),
                    'gespeichert', ${SOURCE})
        `;
        // Gleichnamige Orte: Die Namensregel trifft beide, die Kennung nur den zweiten.
        await staetteUeberNamen("QR Doppelstadt", "QR Doppeltempel", "Tempel");
        await staetteUeberKennung(DOPPEL_B, "QR Zweittempel", "Burg", "QR Fremder Zweitname");
        // Ort ohne Lage: Er hat keine `place.id`, die Kennung trifft ihn über die `public_id`.
        await staetteUeberKennung(OHNE_LAGE, "QR Lagelostempel", "Tempel", "QR Fremder Drittname");

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

    it("🔴 Q-01 eine nur über die Kennung gebundene Stätte steht in der Vorschau, und das Abnehmen fragt nach", async () => {
        expect(await namen(KENNUNG)).toEqual(["QR Kennungstempel"]);
        // Ohne Angabe fragt das Blatt erst; mit „bleiben“ geht das Abnehmen, die Stätte bleibt unberührt.
        expect((await abnehmen(KENNUNG, 1)).json()).toMatchObject({ error: { details: { field: "staetten" } } });
        expect((await abnehmen(KENNUNG, 1, "bleiben")).statusCode).toBe(200);
        const [gebunden] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM site_settlement ss JOIN site s ON s.id = ss.site_id
             WHERE s.source_system = ${SOURCE} AND ss.settlement_legacy_public_id = ${KENNUNG}::uuid AND ss.is_active
        `;
        expect(gebunden!.n).toBe(1);
        // Von der Karte genommen bleibt die Bindung: Die Vorschau des Orts ohne Lage nennt sie weiter.
        expect(await namen(KENNUNG)).toEqual(["QR Kennungstempel"]);
    });

    it("🔴 Q-01 die Namensregel bleibt unverändert, dieselbe Stätte erscheint nur einmal", async () => {
        expect(await namen(NAME)).toEqual(["QR Beidetempel", "QR Namenstempel"]);
        expect((await abnehmen(NAME, 1)).json()).toMatchObject({ error: { details: { field: "staetten" } } });
    });

    it("🔴 Q-01 gleichnamige Orte: der Name trifft beide, die Kennung nur den einen", async () => {
        expect(await namen(DOPPEL_A)).toEqual(["QR Doppeltempel"]);
        expect(await namen(DOPPEL_B)).toEqual(["QR Doppeltempel", "QR Zweittempel"]);
    });

    it("🔴 Q-01 ein Ort ohne Lage hat keine place.id; die Kennung trifft ihn über die public_id", async () => {
        expect(await namen(OHNE_LAGE)).toEqual(["QR Lagelostempel"]);
    });

    it("🔴 E22 G2 Löschen nimmt die belegten Stätten umkehrbar mit; ↺ holt genau sie zurück", async () => {
        const gebunden = async (): Promise<number> => {
            const [zeile] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM site_settlement ss JOIN site s ON s.id = ss.site_id
                 WHERE s.source_system = ${SOURCE} AND ss.settlement_legacy_public_id = ${OHNE_LAGE}::uuid AND ss.is_active
            `;
            return zeile!.n;
        };
        expect(await gebunden()).toBe(1);

        const weg = await loeschen(OHNE_LAGE, 1);
        expect(weg.statusCode).toBe(200);
        const quittung = weg.json<OperationReceipt>();
        // 🔴 In DERSELBEN Transaktion: Der Ort ist weg, die Beziehung liegt still.
        expect(await gebunden()).toBe(0);

        const zurueck = await app.inject({
            method: "POST",
            url: editorPlaceRestoreUrl(OHNE_LAGE),
            headers: { cookie, origin: TEST_ORIGIN },
            payload: { operationId: operationId(), reverts: quittung.operationId },
        });
        expect(zurueck.statusCode).toBe(200);
        expect(zurueck.json<OperationReceipt>().warnings).toEqual([]);
        expect(await gebunden()).toBe(1);
        expect(await namen(OHNE_LAGE)).toEqual(["QR Lagelostempel"]);
    });

    it("🔴 Q-01 Umbenennen trennt die Namensbindung (bekannter Befund), die Kennungsbindung hält", async () => {
        await database`UPDATE place SET name = 'QR Namensstadt neu' WHERE public_id = ${NAME}::uuid`;
        const [jetzt] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM place WHERE public_id = ${NAME}::uuid
        `;
        // Der Name trennt „QR Namenstempel“ ab; „QR Beidetempel“ hängt zusätzlich an der Kennung und bleibt.
        expect(await namen(NAME)).toEqual(["QR Beidetempel"]);
        expect((await abnehmen(NAME, jetzt!.revision)).json()).toMatchObject({
            error: { details: { field: "staetten" } },
        });
        // Zur Gegenprobe: Ohne die Kennungsbindung wäre der Ort nach dem Umbenennen frei.
        await database`
            UPDATE site_settlement SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE site_id IN (SELECT id FROM site WHERE source_system = ${SOURCE} AND name = 'QR Beidetempel')
        `;
        expect(await namen(NAME)).toEqual([]);
        expect((await loeschen(NAME, jetzt!.revision)).statusCode).toBe(200);
    });
});
