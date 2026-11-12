import { randomUUID } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_KARTEN_URL,
    MamKarteDetail,
    MamKartenListe,
    mediaEditorUsageUrl,
    mediaKarteAendernUrl,
    mediaKarteStilllegenUrl,
    mediaKarteZurueckholenUrl,
    mediaKarteUrl,
    type EditConflictDetails,
    type MediaUsageResult,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { aendereKarte } from "../src/media-editor/kartensammlung-schreiben.ts";
import { entferneKarte } from "../src/media-editor/kartensammlung-stilllegen.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, fixtureId, insertAsset, insertCitymap, insertPlace } from "./support/media-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Kartensammlung in der Medienverwaltung (WI-0068 R5, `media-editor/kartensammlung.ts`, `kartensammlung-schreiben.ts`). Lesen: Liste mit Suche über
 * Titel und Ortsnamen (`%` ist Text), Zahl der Bilder und der öffentlichen; Detail mit allem aus 0069, Unbekanntes bleibt `null`,
 * `validToBf` 9999 bleibt; die Entscheidung je Bild ist dieselbe wie in Reverse Usage; eine unbekannte Karte ist 404. Wer was darf,
 * prüft die Rechte-Matrix (`media-rechte-matrix.test.ts`) mit allen Medienrouten.
 *
 * Ändern (Betreiber 2026-10-18 „B jetzt“): Felder und Typen gegen den gesehenen Stand, Text ohne Ränder, leer ist „nicht erfasst“; die
 * Revision zählt auch bei nur geänderten Typen; das Fachprotokoll nennt die Felder, nicht die Werte; danach hält der Zug die Karte. Ein
 * veralteter Stand ist 409 mit wer und wann; nichts zu ändern und ein leerer Titel sind 400; schreibt der Zug, ist es 503 und nichts
 * ändert sich. Dass der Zug die Karte dann stehen lässt, prüft `citymaps.test.ts`.
 *
 * Entfernen und Zurückholen (WI-0287 Stufe 1): stilllegen, nie löschen; Revision, 409 bei altem Stand und doppeltem Aufruf, Rechte,
 * Protokollzeile, die Liste ohne den Eintrag (mit Schalter und Zahl der Stillgelegten), der Katalog der Besucher ohne ihn, das Bild nicht
 * mehr öffentlich, der Abgleich je aktiver Bindung eingereiht.
 */
describeWithDatabase("Kartensammlung in der Medienverwaltung (WI-0068 R5)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    let cookie = "";
    /** Ändern darf erst die Redaktion (`upload_media`); die Prüferin oben liest nur. */
    let schreibCookie = "";
    let personId = "";
    /** Die Revision der Karte vor dem ersten Ändern (der Aufbau unten ändert sie schon). */
    let r0 = 0;
    const welt = { karte: "", eltern: "", verwandt: "", vorschau: "", vollbild: "", ort: "", ortName: "" };

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot: undefined,
        auth: TEST_AUTH,
    };
    const lies = (url: string) => app.inject({ method: "GET", url, headers: { origin: TEST_ORIGIN, cookie } });
    const aendere = (id: string, body: Record<string, unknown>) =>
        app.inject({
            method: "POST",
            url: mediaKarteAendernUrl(id),
            headers: { origin: TEST_ORIGIN, cookie: schreibCookie },
            payload: { operationId: randomUUID(), ...body },
        });
    const detail = async (): Promise<MamKarteDetail> =>
        (await lies(mediaKarteUrl(welt.karte))).json() as MamKarteDetail;
    /** Das Fachprotokoll an den Karten dieser Datei, auch aus einem abgebrochenen Lauf (die Karten tragen feste Kennungen). */
    const protokollWeg = async (): Promise<void> => {
        await database`
            DELETE FROM media_audit_event
             WHERE citymap_public_id = ANY(${[61, 62, 63, 64].map(fixtureId)}::uuid[])
                OR operation_id IN (SELECT operation_id FROM media_operation WHERE actor_person_id::text = ${personId})
        `;
        await database`DELETE FROM media_operation WHERE actor_person_id::text = ${personId}`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await cleanMediaFixtures(database);
        fixture = authFixture(database);
        const person = await fixture.person("reviewer", { name: "Karten Prüferin" });
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        const redakteurin = await fixture.person("editor", { name: "Karten Redakteurin" });
        schreibCookie = (await fixture.session(redakteurin.id, { passkeyMinutesAgo: 1 })).cookie;
        personId = redakteurin.id;

        await protokollWeg();
        const karte = await insertCitymap(database, 61);
        const eltern = await insertCitymap(database, 62);
        const verwandt = await insertCitymap(database, 63);
        const ort = await insertPlace(database, 61);
        welt.karte = karte.publicId;
        welt.eltern = eltern.publicId;
        welt.verwandt = verwandt.publicId;
        welt.ort = ort.publicId;
        welt.ortName = "Medienort 61";
        await database`
            UPDATE citymap SET art = 'politisch', valid_from_bf = 1000, valid_to_bf = 9999, author = 'Zeichnerin Elwe',
                               parent_id = ${eltern.id}::bigint, legacy_wiki_key = 'wikischluessel-intern-61'
             WHERE id = ${karte.id}::bigint
        `;
        await database`
            INSERT INTO citymap_related (citymap_id, related_citymap_id) VALUES (${karte.id}::bigint, ${verwandt.id}::bigint)
        `;
        await database`
            INSERT INTO citymap_type (citymap_id, type_key) VALUES (${karte.id}::bigint, 'stadtplan'), (${karte.id}::bigint, 'lageplan')
        `;
        await database`
            INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, raw_name, target_state, resolved_by, place_id)
            VALUES (${karte.id}::bigint, 0, 0, 'medienort 61', 'Medienort 61', 'resolved', 'public_id', ${ort.id}::bigint),
                   (${karte.id}::bigint, 1, 1, 'irgendwo', 'Irgendwo im Bornland', 'unmatched', NULL, NULL)
        `;
        await database`
            INSERT INTO citymap_link (citymap_id, link_role, url, label, is_paid, position)
            VALUES (${karte.id}::bigint, 'primary', 'https://example.test/karte-61', 'Fundstelle', NULL, 0)
        `;
        // Die Vorschau ist gemeinfrei und veröffentlicht (öffentlich); das Vollbild hat keine Rechte und keine Datei (privat).
        const vorschau = await insertAsset(database, {
            ref: "karte-61-vorschau",
            published: [{ variant: "citymap_preview" }],
        });
        const vollbild = await insertAsset(database, { ref: "karte-61-voll", rights: null, published: [] });
        welt.vorschau = vorschau.publicId;
        welt.vollbild = vollbild.publicId;
        await database`
            INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
            VALUES (${karte.id}::bigint, ${vorschau.id}::bigint, 'map_preview', 'legacy'),
                   (${karte.id}::bigint, ${vollbild.id}::bigint, 'map_full', 'legacy')
        `;
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        if (database !== undefined) await protokollWeg();
        await database?.unsafe(
            `DELETE FROM citymap_place WHERE citymap_id IN (SELECT id FROM citymap WHERE source_system = 'test');
             DELETE FROM citymap_link WHERE citymap_id IN (SELECT id FROM citymap WHERE source_system = 'test');
             DELETE FROM citymap_type WHERE citymap_id IN (SELECT id FROM citymap WHERE source_system = 'test');
             DELETE FROM citymap_related WHERE citymap_id IN (SELECT id FROM citymap WHERE source_system = 'test');`,
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    it("🔴 die Liste: Suche über Titel und Ortsnamen, Bilder und öffentliche Bilder gezählt, die Vorschau als Bild der Zeile", async () => {
        const antwort = await lies(`${MEDIA_KARTEN_URL}?q=${encodeURIComponent("Medienkarte 61")}`);
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toContain("no-store");
        const liste = antwort.json() as MamKartenListe;
        expect(Value.Check(MamKartenListe, liste), JSON.stringify([...Value.Errors(MamKartenListe, liste)])).toBe(true);
        expect(liste.items.map((zeile) => zeile.id)).toEqual([welt.karte]);
        expect(liste.items[0]).toMatchObject({
            art: "politisch",
            types: ["lageplan", "stadtplan"],
            places: 2,
            images: 2,
            publicImages: 1,
            validToBf: 9999,
        });
        expect(liste.items[0]!.preview?.url).toMatch(/^\/media\/sha256\//u);

        const nachOrt = (
            await lies(`${MEDIA_KARTEN_URL}?q=${encodeURIComponent("Bornland")}`)
        ).json() as MamKartenListe;
        expect(nachOrt.items.map((zeile) => zeile.id)).toEqual([welt.karte]);
        const prozent = (await lies(`${MEDIA_KARTEN_URL}?q=${encodeURIComponent("%")}`)).json() as MamKartenListe;
        expect(prozent.total, "% ist Text, kein Muster").toBe(0);
    });

    it("🔴 das Detail: alles aus 0069, Unbekanntes bleibt null, 9999 bleibt; Orte mit Ziel, Bezüge, Verweise", async () => {
        const antwort = await lies(mediaKarteUrl(welt.karte));
        expect(antwort.statusCode).toBe(200);
        const karte = antwort.json() as MamKarteDetail;
        expect(Value.Check(MamKarteDetail, karte), JSON.stringify([...Value.Errors(MamKarteDetail, karte)])).toBe(true);
        expect(karte).toMatchObject({
            title: "Medienkarte 61",
            art: "politisch",
            colorMode: null,
            isSpoiler: null,
            isOfficial: null,
            validFromBf: 1000,
            validToBf: 9999,
            author: "Zeichnerin Elwe",
            legacyWikiKey: "wikischluessel-intern-61",
            parent: { id: welt.eltern, title: "Medienkarte 62" },
            related: [{ id: welt.verwandt, title: "Medienkarte 63" }],
            types: ["lageplan", "stadtplan"],
            links: [{ role: "primary", url: "https://example.test/karte-61", label: "Fundstelle", isPaid: null }],
            sources: [],
            wiki: null,
        });
        expect(karte.places).toEqual([
            {
                name: "Medienort 61",
                target: { kind: "place", id: welt.ort, name: welt.ortName, active: true, type: "stadt" },
                targetState: "resolved",
            },
            { name: "Irgendwo im Bornland", target: null, targetState: "unmatched" },
        ]);
    });

    it("🔴 je Bild dieselbe Entscheidung wie Reverse Usage: die Vorschau öffentlich, das Vollbild nicht", async () => {
        const karte = (await lies(mediaKarteUrl(welt.karte))).json() as MamKarteDetail;
        expect(karte.images.map((bild) => [bild.role, bild.assetId, bild.publication.public])).toEqual([
            ["map_preview", welt.vorschau, true],
            ["map_full", welt.vollbild, false],
        ]);
        for (const bild of karte.images) {
            const verwendung = (await lies(mediaEditorUsageUrl(bild.assetId))).json() as MediaUsageResult;
            const hier = verwendung.usages.find(
                (usage) => usage.subject?.id === welt.karte && usage.role === bild.role,
            );
            expect(hier?.publication, bild.role).toEqual(bild.publication);
        }
    });

    it("🔴 der Katalog der Besucher zeigt dieselbe Karte ohne interne Werte und ohne das private Vollbild (R8, Leckprüfung)", async () => {
        const antwort = await app.inject({ method: "GET", url: `/api/subjects/place/${welt.ort}/citymaps` });
        expect(antwort.statusCode).toBe(200);
        const roh = antwort.body;
        expect(roh, "die Karte steht im Katalog").toContain(welt.karte);
        expect(roh, "der Wiki-Schlüssel ist intern").not.toContain("wikischluessel-intern-61");
        expect(roh, "das Vollbild ist nicht öffentlich").not.toContain(welt.vollbild);
        expect(roh).not.toContain("private/");
        expect(roh).not.toContain("intern_");
    });

    it("eine unbekannte Karte ist 404 im Umschlag", async () => {
        const antwort = await lies(mediaKarteUrl("00000000-0000-4000-8000-0000000000aa"));
        expect(antwort.statusCode).toBe(404);
        expect((antwort.json() as { error: { code: string } }).error.code).toBe("not_found");
    });

    it("🔴 ändern: Felder und Typen gegen den gesehenen Stand; Revision, Protokoll ohne Werte, danach hält der Zug die Karte", async () => {
        const vorher = await detail();
        expect(vorher).toMatchObject({ editorHeld: false, types: ["lageplan", "stadtplan"] });
        r0 = vorher.revision;

        const antwort = await aendere(welt.karte, {
            baseRevision: r0,
            fields: { author: "  Zeichnerin Elwe von Gareth ", isSpoiler: true, colorMode: "farbig", note: "   " },
            types: ["stadtplan", "schatzkarte"],
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((antwort.json() as OperationReceipt).affected).toEqual([
            { kind: "citymap", id: welt.karte, revision: r0 + 1 },
        ]);
        const nachher = await detail();
        expect(Value.Check(MamKarteDetail, nachher)).toBe(true);
        expect(nachher).toMatchObject({
            revision: r0 + 1,
            editorHeld: true,
            title: "Medienkarte 61",
            author: "Zeichnerin Elwe von Gareth",
            isSpoiler: true,
            colorMode: "farbig",
            note: null,
            art: "politisch",
            types: ["schatzkarte", "stadtplan"],
        });
        const [lageplan] = await database<{ is_active: boolean; retired_origin: string | null }[]>`
            SELECT t.is_active, t.retired_origin FROM citymap_type t JOIN citymap c ON c.id = t.citymap_id
             WHERE c.public_id = ${welt.karte}::uuid AND t.type_key = 'lageplan'
        `;
        expect(lageplan, "stillgelegt, nicht gelöscht").toEqual({ is_active: false, retired_origin: "editor" });

        // Nur die Typen: Die Revision zählt trotzdem (0197), der Typ kommt als dieselbe Zeile zurück.
        const typen = await aendere(welt.karte, { baseRevision: r0 + 1, types: ["lageplan", "stadtplan"] });
        expect(typen.statusCode, typen.body).toBe(200);
        expect((typen.json() as OperationReceipt).affected[0]?.revision).toBe(r0 + 2);
        expect((await detail()).types).toEqual(["lageplan", "stadtplan"]);

        const protokoll = await database<{ action: string; target_revision: number; details: unknown }[]>`
            SELECT action, target_revision::int AS target_revision, details FROM media_audit_event
             WHERE citymap_public_id = ${welt.karte}::uuid ORDER BY id
        `;
        expect(protokoll).toEqual([
            {
                action: "citymap.updated",
                target_revision: r0 + 1,
                details: { fields: ["author", "isSpoiler", "colorMode", "note", "types"] },
            },
            { action: "citymap.updated", target_revision: r0 + 2, details: { fields: ["types"] } },
        ]);
        expect(JSON.stringify(protokoll), "keine Werte im Protokoll").not.toContain("Elwe");
    });

    it("🔴 ein veralteter Stand ist 409: wer und wann, und nichts ändert sich", async () => {
        const antwort = await aendere(welt.karte, { baseRevision: r0, fields: { author: "Zu spät" } });
        expect(antwort.statusCode).toBe(409);
        const fehler = antwort.json() as { error: { code: string; details: EditConflictDetails } };
        expect(fehler.error.code).toBe("edit_conflict");
        expect(fehler.error.details).toMatchObject({
            currentRevision: r0 + 2,
            changedBy: { displayName: "Karten Redakteurin" },
        });
        expect((await detail()).author).toBe("Zeichnerin Elwe von Gareth");
    });

    it("400: nichts zu ändern, ein leerer Titel, ein unbekannter Wert; 404: eine unbekannte Karte", async () => {
        expect((await aendere(welt.karte, { baseRevision: r0 + 2, fields: {} })).statusCode).toBe(400);
        const titel = await aendere(welt.karte, { baseRevision: r0 + 2, fields: { title: "   " } });
        expect(titel.statusCode).toBe(400);
        expect((titel.json() as { error: { message: string } }).error.message).toContain("Titel");
        expect((await aendere(welt.karte, { baseRevision: r0 + 2, fields: { art: "bunt" } })).statusCode).toBe(400);
        expect((await aendere(welt.karte, { baseRevision: r0 + 2, types: ["gibtesnicht"] })).statusCode).toBe(400);
        const fremd = await aendere("00000000-0000-4000-8000-0000000000aa", {
            baseRevision: 1,
            fields: { author: "x" },
        });
        expect(fremd.statusCode).toBe(404);
        expect((await detail()).revision, "nichts davon zählt").toBe(r0 + 2);
    });

    it("🔴 schreibt der Zug gerade (exklusive Sperre der Domäne), antwortet das Speichern 503 und ändert nichts", async () => {
        // Eine eigene Domäne, damit die Sperre keine anderen Tests aufhält; der Weg ist derselbe wie für Aventurien.
        const domaene = "test-karte-r5";
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
        const actor = { personId, environment: "test" as const };
        try {
            const versuch = aendereKarte(
                database,
                actor,
                welt.karte,
                { operationId: randomUUID(), baseRevision: r0 + 2, fields: { author: "Während des Zugs" } },
                { mapDomainId: domaene },
            );
            await expect(versuch).rejects.toMatchObject({ statusCode: 503, code: "map_import_running" });
        } finally {
            freigeben();
            await zug;
        }
        expect((await detail()).author).toBe("Zeichnerin Elwe von Gareth");
        const danach = await aendereKarte(
            database,
            actor,
            welt.karte,
            { operationId: randomUUID(), baseRevision: r0 + 2, fields: { author: "Nach dem Zug" } },
            { mapDomainId: domaene },
        );
        expect(danach.affected[0]?.revision).toBe(r0 + 3);
    });

    it("🔴 „unbekannt“ bleibt null, ein Nein bleibt false, 0 kommt nicht durch (ajv-Falle, docs/regeln/entwicklung.md)", async () => {
        const antwort = await aendere(welt.karte, {
            baseRevision: r0 + 3,
            fields: { isSpoiler: null, art: null, colorMode: null, widthPx: null, author: null, isLabeled: false },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await detail()).toMatchObject({
            isSpoiler: null,
            art: null,
            colorMode: null,
            widthPx: null,
            author: null,
            isLabeled: false,
        });
        // Eine Breite von 0 gibt es nicht: abgewiesen, nicht zu null umgedeutet.
        expect((await aendere(welt.karte, { baseRevision: r0 + 4, fields: { widthPx: 0 } })).statusCode).toBe(400);
        expect((await detail()).revision).toBe(r0 + 4);
    });
    it("🔴 entfernen und zurückholen (WI-0287): stillgelegt, nie gelöscht; Liste, Besucher, Bild und Abgleich folgen", async () => {
        const karte = await insertCitymap(database, 64);
        const ort = await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${welt.ort}::uuid`;
        await database`
            INSERT INTO citymap_place (citymap_id, sort_order, export_ordinal, name_key, raw_name, target_state, resolved_by, place_id)
            VALUES (${karte.id}::bigint, 0, 0, 'medienort 61', 'Medienort 61', 'resolved', 'public_id', ${ort[0]!.id}::bigint)
        `;
        const bild = await insertAsset(database, {
            ref: "karte-64-vorschau",
            published: [{ variant: "citymap_preview" }],
        });
        await database`
            INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
            VALUES (${karte.id}::bigint, ${bild.id}::bigint, 'map_preview', 'legacy')
        `;
        const stand = async (): Promise<MamKarteDetail> =>
            (await lies(mediaKarteUrl(karte.publicId))).json() as MamKarteDetail;
        const schicke = (url: string, baseRevision: number, cookieDerPerson = schreibCookie) =>
            app.inject({
                method: "POST",
                url,
                headers: { origin: TEST_ORIGIN, cookie: cookieDerPerson },
                payload: { operationId: randomUUID(), baseRevision },
            });
        const imKatalog = async (): Promise<boolean> =>
            (await app.inject({ method: "GET", url: `/api/subjects/place/${welt.ort}/citymaps` })).body.includes(
                karte.publicId,
            );
        const bildOeffentlich = async (): Promise<boolean | undefined> =>
            ((await lies(mediaEditorUsageUrl(bild.publicId))).json() as MediaUsageResult).usages.find(
                (usage) => usage.subject?.id === karte.publicId,
            )?.publication?.public;
        const suche = `${MEDIA_KARTEN_URL}?q=${encodeURIComponent("Medienkarte 64")}`;

        const vorher = await stand();
        expect(vorher).toMatchObject({ state: "active", active: true, editorHeld: false });
        expect(await imKatalog(), "vorher sehen Besucher den Eintrag").toBe(true);
        expect(await bildOeffentlich(), "vorher ist das Bild öffentlich").toBe(true);
        expect(((await lies(suche)).json() as MamKartenListe).items.map((zeile) => zeile.id)).toEqual([karte.publicId]);

        // Wer nur liest, darf weder entfernen noch zurückholen.
        const nurLesen = await schicke(mediaKarteStilllegenUrl(karte.publicId), vorher.revision, cookie);
        expect(nurLesen.statusCode).toBe(403);
        expect((await stand()).active, "nichts geändert").toBe(true);

        const entfernt = await schicke(mediaKarteStilllegenUrl(karte.publicId), vorher.revision);
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        const quittung = entfernt.json() as OperationReceipt;
        expect(quittung.affected).toEqual([{ kind: "citymap", id: karte.publicId, revision: vorher.revision + 1 }]);
        expect(
            quittung.derivedWork.map((arbeit) => [arbeit.kind, arbeit.state]),
            "der Abgleich je aktiver Bindung",
        ).toEqual([["media_settle", "queued"]]);
        const weg = await stand();
        expect(Value.Check(MamKarteDetail, weg)).toBe(true);
        expect(weg).toMatchObject({ state: "retired", active: false, revision: vorher.revision + 1, editorHeld: true });
        const [zeile] = await database<
            { is_active: boolean; retired_origin: string | null; retired_at: Date | null }[]
        >`
            SELECT is_active, retired_origin, retired_at FROM citymap WHERE public_id = ${karte.publicId}::uuid
        `;
        expect(zeile!.is_active).toBe(false);
        expect(zeile!.retired_origin, "vom Editor entfernt").toBe("editor");
        expect(zeile!.retired_at).not.toBeNull();
        const [bindung] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM citymap_media WHERE citymap_id = ${karte.id}::bigint AND retired_at IS NULL
        `;
        expect(bindung!.n, "die Bindung bleibt, damit das Zurückholen den Eintrag unverändert zurückgibt").toBe(1);

        // Liste: Standard ohne den Eintrag, mit Schalter dabei; die Zahl der Stillgelegten steht dabei.
        const ohne = (await lies(suche)).json() as MamKartenListe;
        expect(ohne.items).toEqual([]);
        expect(ohne.retiredTotal).toBeGreaterThanOrEqual(1);
        const mit = (await lies(`${suche}&retired=true`)).json() as MamKartenListe;
        expect(Value.Check(MamKartenListe, mit)).toBe(true);
        expect(mit.items.map((eintrag) => [eintrag.id, eintrag.state, eintrag.active])).toEqual([
            [karte.publicId, "retired", false],
        ]);
        expect(await imKatalog(), "Besucher sehen den Eintrag nicht mehr").toBe(false);
        expect(await bildOeffentlich(), "ein Bild nur an einem stillgelegten Eintrag ist nicht öffentlich").toBe(false);

        // Doppelt: mit neuem Stand 409 mit eigenem Code, mit altem Stand der Konflikt.
        const doppelt = await schicke(mediaKarteStilllegenUrl(karte.publicId), weg.revision);
        expect(doppelt.statusCode).toBe(409);
        expect((doppelt.json() as { error: { code: string } }).error.code).toBe("citymap_already_retired");
        const alt = await schicke(mediaKarteStilllegenUrl(karte.publicId), vorher.revision);
        expect(alt.statusCode).toBe(409);
        expect((alt.json() as { error: { code: string } }).error.code).toBe("edit_conflict");
        expect((await stand()).revision, "beides ändert nichts").toBe(weg.revision);
        const unbekannt = await schicke(mediaKarteStilllegenUrl("00000000-0000-4000-8000-0000000000aa"), 1);
        expect(unbekannt.statusCode).toBe(404);

        // Zurückholen.
        expect((await schicke(mediaKarteZurueckholenUrl(karte.publicId), weg.revision, cookie)).statusCode).toBe(403);
        const geholt = await schicke(mediaKarteZurueckholenUrl(karte.publicId), weg.revision);
        expect(geholt.statusCode, geholt.body).toBe(200);
        expect((geholt.json() as OperationReceipt).derivedWork).toHaveLength(1);
        expect(await stand()).toMatchObject({
            state: "active",
            active: true,
            revision: weg.revision + 1,
            editorHeld: true,
        });
        const [zurueck] = await database<{ retired_origin: string | null; retired_at: Date | null }[]>`
            SELECT retired_origin, retired_at FROM citymap WHERE public_id = ${karte.publicId}::uuid
        `;
        expect(zurueck).toEqual({ retired_origin: null, retired_at: null });
        expect(await imKatalog()).toBe(true);
        expect(await bildOeffentlich()).toBe(true);
        const nochmal = await schicke(mediaKarteZurueckholenUrl(karte.publicId), weg.revision + 1);
        expect(nochmal.statusCode).toBe(409);
        expect((nochmal.json() as { error: { code: string } }).error.code).toBe("citymap_not_retired");

        const protokoll = await database<{ action: string; target_revision: number; details: unknown }[]>`
            SELECT action, target_revision::int AS target_revision, details FROM media_audit_event
             WHERE citymap_public_id = ${karte.publicId}::uuid ORDER BY id
        `;
        expect(protokoll).toEqual([
            { action: "citymap.retired", target_revision: weg.revision, details: { bindings: 1 } },
            { action: "citymap.restored", target_revision: weg.revision + 1, details: { bindings: 1 } },
        ]);
    });

    it("🔴 schreibt der Zug gerade, antwortet das Entfernen 503 und ändert nichts", async () => {
        const domaene = "test-karte-wi0287";
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
        const aktuell = (await detail()).revision;
        try {
            await expect(
                entferneKarte(
                    database,
                    { personId, environment: "test" as const },
                    welt.karte,
                    { operationId: randomUUID(), baseRevision: aktuell },
                    { mapDomainId: domaene },
                ),
            ).rejects.toMatchObject({ statusCode: 503, code: "map_import_running" });
        } finally {
            freigeben();
            await zug;
        }
        expect(await detail()).toMatchObject({ state: "active", revision: aktuell });
    });
});
