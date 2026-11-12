import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_KARTEN_URL,
    mediaKarteOrteUrl,
    mediaKarteStilllegenUrl,
    mediaKarteUrl,
    type MamKarteDetail,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { aendereKartenorte } from "../src/media-editor/kartensammlung-orte.ts";
import { listCitymaps } from "../src/subjects/sections/citymaps.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";
import { cleanEditorMedia } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Orte und Regionen eines Eintrags der Kartensammlung (WI-0287 Stufe 3; `citymap.places`): eine Region und einen Ort anhängen, doppelt (409), lösen, einer nicht aufgelösten Zeile ein Ziel
 * geben, einer aufgelösten nicht (409), ein unbekanntes oder stillgelegtes Ziel (400), ein fremder Stand (409), ein stillgelegter Eintrag (409), die Rechte, die Zeile im Fachprotokoll (hält
 * die Karte) und: Die Sektion Kartensammlung der Region (`listCitymaps(…, "area", …)`) zeigt die Karte nach dem Anhängen und nach dem Lösen nicht mehr. Dazu `citymap.create` mit `targets`.
 */
describeWithDatabase("Orte und Regionen der Kartensammlung (WI-0287 Stufe 3)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let cookie = "";
    let leseCookie = "";
    const personen: string[] = [];
    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot: undefined,
        auth: TEST_AUTH,
    });
    const post = (url: string, payload: Record<string, unknown>, kekse = cookie) =>
        app.inject({ method: "POST", url, headers: { origin: TEST_ORIGIN, cookie: kekse }, payload });
    const get = (url: string, kekse = cookie) =>
        app.inject({ method: "GET", url, headers: { origin: TEST_ORIGIN, cookie: kekse } });
    const lies = async (id: string): Promise<MamKarteDetail> => (await get(mediaKarteUrl(id))).json();
    const legeAn = async (titel: string, weiter: Record<string, unknown> = {}): Promise<string> => {
        const antwort = await post(MEDIA_KARTEN_URL, {
            operationId: randomUUID(),
            fields: { title: `P287O ${titel}` },
            types: [],
            places: [],
            ...weiter,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "citymap")!.id;
    };
    const tue = (id: string, baseRevision: number, weiter: Record<string, unknown>, kekse = cookie) =>
        post(mediaKarteOrteUrl(id), { operationId: randomUUID(), baseRevision, ...weiter }, kekse);
    /** Eine Handlung, die gelingen muss; gibt die neue Revision zurück. */
    const muss = async (id: string, weiter: Record<string, unknown>) => {
        const stand = (await lies(id)).revision;
        const antwort = await tue(id, stand, weiter);
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected[0]!.revision ?? stand;
    };
    const region = async (name: string, art: string | null = "kueste"): Promise<string> => {
        const kennung = randomUUID();
        await database`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system, is_active)
            VALUES (${kennung}, 'aventuria', ${`P287O ${name}`}, 'derographisch', ${art}, 'test', TRUE)
        `;
        return kennung;
    };
    /** Eine Karte mit einer Zeile, die zu nichts passt (so steht sie nach dem Legacy-Zug, z. B. „Siebenwindküste“). */
    const offeneZeile = async (id: string, name: string): Promise<void> => {
        await database`
            INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, dup_ordinal, raw_name, target_state, legacy_origin)
            SELECT c.id, 0, 0, ${name.toLowerCase()}, 0, ${name}, 'unmatched', 'wiki' FROM citymap c WHERE c.public_id = ${id}::uuid
        `;
    };
    const zeilen = (id: string) =>
        database<
            {
                raw_name: string;
                sort_order: number;
                export_ordinal: number;
                target_state: string;
                resolved_by: string | null;
                kind: string | null;
                is_active: boolean;
                state: string;
                retired_origin: string | null;
                target_origin: string;
                legacy_origin: string;
                source_system: string;
            }[]
        >`
            SELECT p.raw_name, p.sort_order, p.export_ordinal, p.target_state, p.resolved_by,
                   CASE WHEN p.place_id IS NOT NULL THEN 'place' WHEN p.region_id IS NOT NULL THEN 'region' END AS kind,
                   p.is_active, p.state, p.retired_origin, p.target_origin, p.legacy_origin, p.source_system
              FROM citymap_place p JOIN citymap c ON c.id = p.citymap_id
             WHERE c.public_id = ${id}::uuid ORDER BY p.sort_order, p.id
        `;
    const aufraeumen = async (): Promise<void> => {
        const ids = await database<{ id: string }[]>`
            SELECT id::text AS id FROM citymap WHERE title LIKE 'P287O %' AND source_system = 'avesmaps3d'
        `;
        const kennungen = ids.map((zeile) => zeile.id);
        await database`DELETE FROM citymap_place WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM citymap_type WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`
            DELETE FROM media_audit_event
             WHERE citymap_public_id IN (SELECT public_id FROM citymap WHERE id = ANY(${kennungen}::bigint[]))
        `;
        await database`DELETE FROM citymap WHERE id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM region WHERE name LIKE 'P287O %'`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        await cleanMediaFixtures(database);
        const fixture = authFixture(database);
        const redakteurin = await fixture.person("editor", { name: "Orte Redakteurin" });
        const pruefer = await fixture.person("reviewer", { name: "Orte Prüfer" });
        personen.push(redakteurin.id, pruefer.id);
        cookie = (await fixture.session(redakteurin.id, { passkeyMinutesAgo: 1 })).cookie;
        leseCookie = (await fixture.session(pruefer.id, { passkeyMinutesAgo: 1 })).cookie;
        await cleanEditorMedia(database, personen);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await cleanEditorMedia(database, personen);
        await cleanMediaFixtures(database);
        await database.end();
    });

    it("eine Region und einen Ort anhängen: neue Zeilen am Ende, Art im Detail, die Sektion der Region zeigt die Karte, Lösen nimmt sie wieder weg", async () => {
        const id = await legeAn("Anhängen");
        const kueste = await region("Siebenwind-Küste");
        const ort = await insertPlace(database, 288);
        const stand = (await lies(id)).revision;

        // Vor dem Anhängen steht die Karte in keiner Sektion der Region.
        expect((await listCitymaps(database, "area", [kueste])).map((e) => e.id)).not.toContain(id);

        expect(await muss(id, { action: "add", target: { kind: "region", id: kueste } })).toBe(stand + 1);
        expect(await muss(id, { action: "add", target: { kind: "place", id: ort.publicId } })).toBe(stand + 2);

        const karte = await lies(id);
        expect(karte.places).toEqual([
            {
                name: "P287O Siebenwind-Küste",
                target: { kind: "region", id: kueste, name: "P287O Siebenwind-Küste", active: true, type: "kueste" },
                targetState: "resolved",
            },
            {
                name: "Medienort 288",
                target: { kind: "place", id: ort.publicId, name: "Medienort 288", active: true, type: "stadt" },
                targetState: "resolved",
            },
        ]);
        expect(
            (await zeilen(id)).map((z) => [
                z.kind,
                z.sort_order,
                z.export_ordinal,
                z.resolved_by,
                z.target_origin,
                z.legacy_origin,
                z.source_system,
            ]),
        ).toEqual([
            ["region", 0, 0, "public_id", "editor", "manual", "avesmaps3d"],
            ["place", 1, 1, "public_id", "editor", "manual", "avesmaps3d"],
        ]);
        // 🔴 Die Sektion Kartensammlung der Region (und des Orts) zeigt die Karte.
        expect((await listCitymaps(database, "area", [kueste])).map((e) => e.id)).toContain(id);
        expect((await listCitymaps(database, "place", [ort.publicId])).map((e) => e.id)).toContain(id);

        // Lösen: die Zeile wird stillgelegt, nie gelöscht; die Region zeigt die Karte nicht mehr, der Ort weiter.
        await muss(id, { action: "remove", index: 0 });
        const danach = await zeilen(id);
        expect(danach.map((z) => [z.kind, z.is_active, z.state, z.retired_origin])).toEqual([
            ["region", false, "retired", "editor"],
            ["place", true, "active", null],
        ]);
        expect((await lies(id)).places.map((p) => p.target?.id)).toEqual([ort.publicId]);
        expect((await listCitymaps(database, "area", [kueste])).map((e) => e.id)).not.toContain(id);
        expect((await listCitymaps(database, "place", [ort.publicId])).map((e) => e.id)).toContain(id);

        // Dieselbe Region noch einmal anhängen: eine neue Zeile ans Ende (hinter der stillgelegten).
        await muss(id, { action: "add", target: { kind: "region", id: kueste } });
        expect((await zeilen(id)).map((z) => [z.kind, z.sort_order, z.is_active])).toEqual([
            ["region", 0, false],
            ["place", 1, true],
            ["region", 2, true],
        ]);
        expect((await listCitymaps(database, "area", [kueste])).map((e) => e.id)).toContain(id);
    });

    it("doppelt anhängen ist 409, ein unbekanntes oder stillgelegtes Ziel 400; nichts ändert sich", async () => {
        const id = await legeAn("Abweisen");
        const kueste = await region("Doppelt");
        const stillgelegt = await region("Stillgelegt");
        await database`UPDATE region SET is_active = FALSE WHERE public_id = ${stillgelegt}::uuid`;
        const ort = await insertPlace(database, 289);
        await database`UPDATE place SET is_active = FALSE WHERE public_id = ${ort.publicId}::uuid`;
        await muss(id, { action: "add", target: { kind: "region", id: kueste } });
        const stand = (await lies(id)).revision;

        const doppelt = await tue(id, stand, { action: "add", target: { kind: "region", id: kueste } });
        expect(doppelt.statusCode).toBe(409);
        expect(doppelt.json()).toMatchObject({ error: { code: "citymap_target_present" } });
        for (const ziel of [
            { kind: "region", id: randomUUID() },
            { kind: "place", id: randomUUID() },
            { kind: "region", id: stillgelegt },
            { kind: "place", id: ort.publicId },
            // Eine Region ist kein Ort und umgekehrt.
            { kind: "place", id: kueste },
        ]) {
            const antwort = await tue(id, stand, { action: "add", target: ziel });
            expect(antwort.statusCode, JSON.stringify(ziel)).toBe(400);
        }
        // Ohne Ziel und ohne Stelle.
        expect((await tue(id, stand, { action: "add" })).statusCode).toBe(400);
        expect((await tue(id, stand, { action: "remove" })).statusCode).toBe(400);
        expect((await tue(id, stand, { action: "remove", index: 5 })).statusCode).toBe(400);
        expect((await lies(id)).revision).toBe(stand);
        expect(await zeilen(id)).toHaveLength(1);
    });

    it("eine nicht aufgelöste Zeile zuordnen: dieselbe Zeile, der Rohname bleibt; eine aufgelöste ist 409; derselbe Stand ist die Grundlage der Stelle", async () => {
        const id = await legeAn("Zuordnen");
        await offeneZeile(id, "Siebenwindküste");
        const kueste = await region("Siebenwind-Küste");
        const ort = await insertPlace(database, 290);
        const karte0 = await lies(id);
        expect(karte0.places).toEqual([{ name: "Siebenwindküste", target: null, targetState: "unmatched" }]);

        // Der Ort, der schon aktiv hängt, geht nicht noch einmal (auch nicht über das Zuordnen).
        await muss(id, { action: "add", target: { kind: "place", id: ort.publicId } });
        const stand = (await lies(id)).revision;
        // Die Reihenfolge ist die der Detailantwort: erst die offene Zeile (sort_order 0), dann der Ort (1).
        const doppelt = await tue(id, stand, {
            action: "resolve",
            index: 0,
            target: { kind: "place", id: ort.publicId },
        });
        expect(doppelt.statusCode).toBe(409);
        expect(doppelt.json()).toMatchObject({ error: { code: "citymap_target_present" } });

        const stelle = await muss(id, { action: "resolve", index: 0, target: { kind: "region", id: kueste } });
        expect(stelle).toBe(stand + 1);
        expect(
            (await zeilen(id)).map((z) => [
                z.raw_name,
                z.kind,
                z.target_state,
                z.resolved_by,
                z.target_origin,
                z.legacy_origin,
            ]),
        ).toEqual([
            ["Siebenwindküste", "region", "resolved", "public_id", "editor", "wiki"],
            ["Medienort 290", "place", "resolved", "public_id", "editor", "manual"],
        ]);
        expect((await lies(id)).places[0]).toMatchObject({
            name: "Siebenwindküste",
            target: { kind: "region", id: kueste },
            targetState: "resolved",
        });
        expect((await listCitymaps(database, "area", [kueste])).map((e) => e.id)).toContain(id);

        // Eine aufgelöste Zeile zuordnen: 409.
        const nochmal = await tue(id, stelle, {
            action: "resolve",
            index: 0,
            target: { kind: "region", id: await region("Andere") },
        });
        expect(nochmal.statusCode).toBe(409);
        expect(nochmal.json()).toMatchObject({ error: { code: "citymap_place_resolved" } });
        // Eine offene Zeile lösen: stillgelegt, der Name „passte zu nichts“.
        const zwei = await legeAn("Offen lösen");
        await offeneZeile(zwei, "Nirgendwo");
        await muss(zwei, { action: "remove", index: 0 });
        expect((await lies(zwei)).places).toEqual([]);
    });

    it("fremder Stand ist 409 mit wer und wann; ein stillgelegter Eintrag nimmt nichts an; Rechte; die Zeile im Fachprotokoll hält die Karte", async () => {
        const id = await legeAn("Sperren");
        const kueste = await region("Sperre");
        const stand = (await lies(id)).revision;

        const alt = await tue(id, stand + 3, { action: "add", target: { kind: "region", id: kueste } });
        expect(alt.statusCode).toBe(409);
        expect(alt.json()).toMatchObject({ error: { code: "edit_conflict" } });
        // Rechte: ein Prüfer ändert nichts.
        expect(
            (await tue(id, stand, { action: "add", target: { kind: "region", id: kueste } }, leseCookie)).statusCode,
        ).toBe(403);
        expect((await lies(id)).revision).toBe(stand);

        await muss(id, { action: "add", target: { kind: "region", id: kueste } });
        const protokoll = await database<{ details: { fields: string[]; op: string }; target_revision: number }[]>`
            SELECT details, target_revision::int AS target_revision FROM media_audit_event
             WHERE citymap_public_id = ${id}::uuid AND action = 'citymap.updated' ORDER BY id
        `;
        expect(protokoll.map((z) => [z.details.fields, z.details.op, z.target_revision])).toEqual([
            [["places"], "add", stand + 1],
        ]);
        // 🔴 Die Zeile hält die Karte gegen den Legacy-Zug.
        expect((await lies(id)).editorHeld).toBe(true);

        // Stillgelegt: 409 `citymap_retired`.
        const jetzt = (await lies(id)).revision;
        const weg = await post(mediaKarteStilllegenUrl(id), { operationId: randomUUID(), baseRevision: jetzt });
        expect(weg.statusCode, weg.body).toBe(200);
        const still = await tue(id, (await lies(id)).revision, { action: "remove", index: 0 });
        expect(still.statusCode).toBe(409);
        expect(still.json()).toMatchObject({ error: { code: "citymap_retired" } });
    });

    it("🔴 läuft der Legacy-Zug, ist die Handlung 503 und nichts ändert sich", async () => {
        const id = await legeAn("Zug");
        const kueste = await region("Zug");
        const stand = (await lies(id)).revision;
        const domaene = `test-karte-orte-${randomUUID()}`;
        let freigeben: () => void = () => undefined;
        const halten = new Promise<void>((resolve) => {
            freigeben = resolve;
        });
        let steht: () => void = () => undefined;
        const gesperrt = new Promise<void>((resolve) => {
            steht = resolve;
        });
        const zug = database.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${domaene}))`;
            steht();
            await halten;
        });
        await gesperrt;
        try {
            await expect(
                aendereKartenorte(
                    database,
                    { personId: personen[0]!, environment: "test" as const },
                    id,
                    {
                        operationId: randomUUID(),
                        baseRevision: stand,
                        action: "add",
                        target: { kind: "region", id: kueste },
                    },
                    { mapDomainId: domaene },
                ),
            ).rejects.toMatchObject({ statusCode: 503, code: "map_import_running" });
        } finally {
            freigeben();
            await zug;
        }
        expect((await lies(id)).revision).toBe(stand);
        expect(await zeilen(id)).toEqual([]);
    });

    it("citymap.create mit `targets`: Orte und Regionen in der gegebenen Folge, `places` bleibt für alte Aufrufer; unbekannte, doppelte und zu viele sind 400", async () => {
        const kueste = await region("Neu Küste");
        const wald = await region("Neu Wald", "wald");
        const ort = await insertPlace(database, 291);
        const alt = await legeAn("Alt", { places: [ort.publicId] });
        expect((await lies(alt)).places.map((p) => p.target?.kind)).toEqual(["place"]);

        const id = await legeAn("Neu", {
            places: [ort.publicId],
            targets: [
                { kind: "region", id: kueste },
                { kind: "region", id: wald },
            ],
        });
        expect((await lies(id)).places.map((p) => [p.target?.kind, p.target?.id, p.target?.type])).toEqual([
            ["place", ort.publicId, "stadt"],
            ["region", kueste, "kueste"],
            ["region", wald, "wald"],
        ]);
        expect((await zeilen(id)).map((z) => [z.sort_order, z.export_ordinal])).toEqual([
            [0, 0],
            [1, 1],
            [2, 2],
        ]);
        expect((await listCitymaps(database, "area", [wald])).map((e) => e.id)).toContain(id);

        const viele = Array.from({ length: 21 }, () => ({ kind: "region", id: randomUUID() }));
        for (const targets of [
            [{ kind: "region", id: randomUUID() }],
            [
                { kind: "region", id: kueste },
                { kind: "region", id: kueste },
            ],
            viele,
        ]) {
            const antwort = await post(MEDIA_KARTEN_URL, {
                operationId: randomUUID(),
                fields: { title: "P287O Abgewiesen" },
                types: [],
                places: [],
                targets,
            });
            expect(antwort.statusCode, antwort.body).toBe(400);
        }
        const gefunden = await database`SELECT 1 FROM citymap WHERE title = 'P287O Abgewiesen'`;
        expect(gefunden).toHaveLength(0);
    });
});
