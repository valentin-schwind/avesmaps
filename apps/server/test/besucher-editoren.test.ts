import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BesuchEditoren, type BesuchEditor } from "@avesmaps3d/shared";
import { leseEditoren } from "../src/besucher/editoren.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { takeEditorLock } from "../src/editor/editor-lock.ts";
import { authFixture } from "./support/auth-fixture.ts";

/**
 * Was die Editorenliste über eine Person sagt (WI-0276) gegen echtes PostgreSQL (`TEST_DATABASE_URL`).
 *
 * Problemfälle: Eine abgelaufene Sperre gilt noch als „bearbeitet“; von zwei Sperren steht die ältere da; das Objekt steht ohne seinen Namen da; die letzte Änderung ist nicht
 * die jüngste; die Änderungen einer anderen Person zählen mit; eine Person ohne alles fällt aus der Liste oder bricht die Antwort.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Die Editorenliste: was gerade, was zuletzt (WI-0276)", { timeout: 60_000 }, () => {
    let database: Database;
    let thomas: string;
    let vali: string;
    let neu: string;
    const orte = { tarle: randomUUID(), luring: randomUUID(), gareth: randomUUID() };
    const operationen: string[] = [];

    async function aendere(personId: string, ortId: string, minutenHer: number): Promise<void> {
        const id = randomUUID();
        operationen.push(id);
        await database`
            INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, environment, actor_kind, actor_person_id, at)
            VALUES (${id}::uuid, 'aventuria', decode(repeat('ab', 32), 'hex'), jsonb_build_object('operationId', ${id}::text, 'status', 'applied'),
                    'place.update', 'editor', 'test', 'person', ${personId}::uuid, now() - make_interval(mins => ${minutenHer}))
        `;
        await database`
            INSERT INTO map_audit_event (operation_id, action, place_public_id, revision_before, revision_after, changes)
            VALUES (${id}::uuid, 'place.updated', ${ortId}::uuid, 1, 2, '{"name":{"before":"a","after":"b"}}'::jsonb)
        `;
    }

    const person = async (id: string): Promise<BesuchEditor> => {
        const stand = await leseEditoren(database, "test");
        const gefunden = stand.editoren.find((zeile) => zeile.id === id);
        if (gefunden === undefined) throw new Error(`${id} fehlt in der Liste`);
        return gefunden;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        const fixture = authFixture(database);
        thomas = (await fixture.person("editor", { name: "Thomas Liste" })).id;
        vali = (await fixture.person("operator", { name: "Vali Liste" })).id;
        neu = (await fixture.person("editor", { name: "Neu Liste" })).id;
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${orte.tarle}::uuid, 'aventuria', 'Tarle 276', 'dorf', ST_SetSRID(ST_MakePoint(100, 100), 0), 'test', TRUE),
                   (${orte.luring}::uuid, 'aventuria', 'Luring 276', 'dorf', ST_SetSRID(ST_MakePoint(110, 110), 0), 'test', TRUE),
                   (${orte.gareth}::uuid, 'aventuria', 'Gareth 276', 'stadt', ST_SetSRID(ST_MakePoint(120, 120), 0), 'test', TRUE)
        `;
        await aendere(thomas, orte.luring, 300);
        await aendere(thomas, orte.tarle, 60);
        await aendere(vali, orte.gareth, 10);
    });

    afterAll(async () => {
        await database`DELETE FROM editor_lock WHERE object_id = ANY(${Object.values(orte)}::uuid[])`;
        await database`DELETE FROM map_audit_event WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM map_operation WHERE operation_id = ANY(${operationen}::uuid[])`;
        await database`DELETE FROM place WHERE public_id = ANY(${Object.values(orte)}::uuid[])`;
        await database.end();
    });

    it("🔴 die letzte Änderung ist die jüngste der Person, mit Art und heutigem Namen; gezählt wird nur, was von ihr stammt", async () => {
        const zeile = await person(thomas);
        expect(zeile.zuletztGeaendert).toMatchObject({ art: "place", id: orte.tarle, name: "Tarle 276" });
        expect(zeile.aenderungen).toBe(2);
        expect((await person(vali)).aenderungen).toBe(1);
    });

    it("eine Person ohne Sperre und ohne Änderung steht mit leeren Angaben in der Liste", async () => {
        expect(await person(neu)).toMatchObject({ bearbeitet: null, zuletztGeaendert: null, aenderungen: 0 });
    });

    it("🔴 „bearbeitet“ nennt die jüngste geltende Sperre; eine ohne Herzschlag seit 15 Minuten gilt nicht mehr", async () => {
        const lauf = randomUUID();
        const nimm = (id: string, part: "form" | "felder") =>
            takeEditorLock(database, {
                kind: "place",
                id,
                part,
                run: lauf,
                personId: thomas,
                personName: "Thomas Liste",
            });
        await nimm(orte.luring, "felder");
        await database`UPDATE editor_lock SET since = now() - interval '20 minutes' WHERE object_id = ${orte.luring}::uuid`;
        await nimm(orte.tarle, "form");

        expect((await person(thomas)).bearbeitet).toMatchObject({
            art: "place",
            id: orte.tarle,
            name: "Tarle 276",
            woran: "form",
        });

        await database`UPDATE editor_lock SET heartbeat_at = now() - interval '16 minutes' WHERE object_id = ${orte.tarle}::uuid`;
        expect((await person(thomas)).bearbeitet).toMatchObject({ id: orte.luring, woran: "felder" });

        await database`UPDATE editor_lock SET heartbeat_at = now() - interval '16 minutes' WHERE object_id = ${orte.luring}::uuid`;
        expect((await person(thomas)).bearbeitet).toBeNull();
    });

    it("🔴 die Antwort erfüllt das strenge Antwortschema der Route", async () => {
        const lauf = randomUUID();
        await takeEditorLock(database, {
            kind: "place",
            id: orte.gareth,
            part: "felder",
            run: lauf,
            personId: vali,
            personName: "Vali Liste",
        });
        const stand = await leseEditoren(database, "test");
        expect([...Value.Errors(BesuchEditoren, stand)]).toEqual([]);
    });
});
