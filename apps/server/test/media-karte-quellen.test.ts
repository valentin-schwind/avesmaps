import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    INHALTE_QUELLEN_URL,
    MEDIA_KARTEN_URL,
    mediaKarteQuellenUrl,
    mediaKarteStilllegenUrl,
    mediaKarteUrl,
    type InhalteQuellenListe,
    type MamKarteDetail,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { umschlaegeVon } from "../src/inhalte/quellen-umschlag.ts";
import { aendereKartenquellen } from "../src/media-editor/kartensammlung-quellen.ts";
import { storageKey } from "../src/media/storage.ts";
import { listCitymaps } from "../src/subjects/sections/citymaps.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertAdventure, insertAsset, insertPlace, sha } from "./support/media-fixture.ts";
import { cleanEditorMedia } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Publikationen eines Eintrags der Kartensammlung (WI-0287 Stufe 1, Punkt 4; `citymap.sources`): anhängen mit Fundstelle, Fundstelle ändern, an den Anfang stellen, lösen und
 * wiederherstellen, je eine Operation gegen den gesehenen Stand, mit dem Recht der Sammlung (auch der Kartograph ohne `manage_sources`; Anlegen im Verzeichnis bleibt bei ihm verwehrt).
 * Das Umschlagbild kommt über den Schlüssel `wikipub:` und über die Adresse, nie über den Titel. Besucher bekommen alle aktiven als `bands`, `band` bleibt die erste.
 */
describeWithDatabase("Publikationen der Kartensammlung (WI-0287)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let cookie = "";
    let leseCookie = "";
    let kartographCookie = "";
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
    const legeAn = async (titel: string, places: string[] = []): Promise<string> => {
        const antwort = await post(MEDIA_KARTEN_URL, {
            operationId: randomUUID(),
            fields: { title: `P287T ${titel}` },
            types: [],
            places,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "citymap")!.id;
    };
    const tue = (
        id: string,
        baseRevision: number,
        op: string,
        sourceId: string,
        weiter: Record<string, unknown> = {},
        kekse = cookie,
    ) => post(mediaKarteQuellenUrl(id), { operationId: randomUUID(), baseRevision, op, sourceId, ...weiter }, kekse);
    /** Eine Handlung, die gelingen muss; gibt die neue Revision zurück. */
    const muss = async (id: string, op: string, sourceId: string, weiter: Record<string, unknown> = {}) => {
        const stand = (await lies(id)).revision;
        const antwort = await tue(id, stand, op, sourceId, weiter);
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected[0]!.revision;
    };
    const quelle = async (titel: string, schluessel: { url?: string; key?: string }): Promise<string> => {
        const [zeile] = await database<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official)
            VALUES (${schluessel.key ?? `url:${sha(schluessel.url ?? titel)}`}, 'final', ${schluessel.url ?? null}, ${`P287T ${titel}`},
                    'regionalspielhilfe', TRUE)
            RETURNING public_id::text AS public_id
        `;
        return zeile!.public_id;
    };
    /** Ein Werk mit Umschlag: öffentlich (eine veröffentlichte Datei, gemeinfrei) oder nur mit privater Vorschau. */
    const werkMitUmschlag = async (
        n: number,
        felder: { wikiKey?: string; fshop?: string; fshopCode?: string; ulisses?: string; titel?: string },
        oeffentlich: boolean,
    ): Promise<void> => {
        const werk = await insertAdventure(database, n);
        await database`
            UPDATE adventure SET wiki_key = ${felder.wikiKey ?? null}, link_fshop = ${felder.fshop ?? null}, fshop_code = ${felder.fshopCode ?? null},
                                 link_ulisses = ${felder.ulisses ?? null}, title = ${felder.titel ?? `Medienwerk ${String(n)}`}
             WHERE id = ${werk.id}::bigint
        `;
        const bild = await insertAsset(database, {
            ref: `p287-umschlag-${String(n)}`,
            published: oeffentlich ? [{ variant: "literature_cover", width: 60, height: 80 }] : [],
        });
        if (!oeffentlich) {
            const hash = sha(`p287-intern-${String(n)}`);
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                        derivative_recipe, recipe_version)
                VALUES (${bild.id}, 'intern_literature_cover', 'derivative', ${storageKey("derivative", hash, "webp")}, 'image/webp', 30, 40, 99,
                        ${hash}, 'literature_cover', '1')
            `;
        }
        await database`
            INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin)
            VALUES (${werk.id}::bigint, ${bild.id}::bigint, 'literature_cover', 'legacy')
        `;
    };
    const zeilen = (id: string) =>
        database<
            {
                titel: string;
                position: number;
                state: string;
                is_active: boolean;
                pages: string | null;
                retired_origin: string | null;
                source_system: string;
                legacy_origin: string | null;
            }[]
        >`
            SELECT f.title AS titel, q.position, q.state, q.is_active, q.pages, q.retired_origin, q.source_system, q.legacy_origin
              FROM citymap_source q JOIN citymap c ON c.id = q.citymap_id JOIN feature_source f ON f.id = q.source_id
             WHERE c.public_id = ${id}::uuid ORDER BY q.position, q.id
        `;
    const aufraeumen = async (): Promise<void> => {
        const ids = await database<{ id: string }[]>`
            SELECT id::text AS id FROM citymap WHERE title LIKE 'P287T %' AND source_system = 'avesmaps3d'
        `;
        const kennungen = ids.map((zeile) => zeile.id);
        await database`DELETE FROM citymap_source WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM citymap_place WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM citymap_type WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`
            DELETE FROM media_audit_event
             WHERE citymap_public_id IN (SELECT public_id FROM citymap WHERE id = ANY(${kennungen}::bigint[]))
        `;
        await database`DELETE FROM citymap WHERE id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM feature_source WHERE title LIKE 'P287T %'`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        await cleanMediaFixtures(database);
        const fixture = authFixture(database);
        const redakteurin = await fixture.person("editor", { name: "Publikationen Redakteurin" });
        const pruefer = await fixture.person("reviewer", { name: "Publikationen Prüfer" });
        // Der Kartograph: Grundrolle Reviewer (ohne `manage_sources`), die Rechte der Sammlung kommen allein aus der Sonderrolle.
        const kartograph = await fixture.person("reviewer", { name: "Publikationen Kartograph" });
        await database`
            INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, reason)
            VALUES (${kartograph.id}, 'test', 'kartograph', 'Probe')
        `;
        personen.push(redakteurin.id, pruefer.id, kartograph.id);
        cookie = (await fixture.session(redakteurin.id, { passkeyMinutesAgo: 1 })).cookie;
        leseCookie = (await fixture.session(pruefer.id, { passkeyMinutesAgo: 1 })).cookie;
        kartographCookie = (await fixture.session(kartograph.id, { passkeyMinutesAgo: 1 })).cookie;
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

    it("anhängen mit Fundstelle, die Fundstelle ändern und leeren; eine neue kommt ans Ende; jede Handlung ist eine Zeile im Fachprotokoll", async () => {
        const id = await legeAn("Anhängen");
        const eins = await quelle("Band Eins", { url: "https://p287test.example/eins" });
        const zwei = await quelle("Band Zwei", { key: "wikipub:p287t-band-zwei" });
        const stand = (await lies(id)).revision;

        expect((await tue(id, stand, "add", eins, { pages: "  42 " })).statusCode).toBe(200);
        expect(await muss(id, "add", zwei)).toBe(stand + 2);
        let karte = await lies(id);
        expect(karte.publications?.map((p) => [p.title, p.pages, p.state])).toEqual([
            ["P287T Band Eins", "42", "active"],
            ["P287T Band Zwei", null, "active"],
        ]);
        expect(karte.publications?.[0]).toMatchObject({
            sourceId: eins,
            sourceType: "regionalspielhilfe",
            offiziell: true,
            url: "https://p287test.example/eins",
        });
        expect((await zeilen(id)).map((z) => [z.position, z.source_system, z.legacy_origin])).toEqual([
            [0, "avesmaps3d", "manual"],
            [1, "avesmaps3d", "manual"],
        ]);

        expect(await muss(id, "pages", zwei, { pages: "S. 130" })).toBe(stand + 3);
        expect(await muss(id, "pages", eins, { pages: "" })).toBe(stand + 4);
        karte = await lies(id);
        expect(karte.publications?.map((p) => p.pages)).toEqual([null, "S. 130"]);
        // Dieselbe Fundstelle noch einmal ändert nichts: keine Revision, kein Protokoll.
        expect(await muss(id, "pages", zwei, { pages: " S. 130 " })).toBe(stand + 4);

        const protokoll = await database<{ details: { fields: string[] }; target_revision: number }[]>`
            SELECT details, target_revision::int AS target_revision FROM media_audit_event
             WHERE citymap_public_id = ${id}::uuid AND action = 'citymap.updated' ORDER BY id
        `;
        expect(protokoll.map((z) => [z.details.fields, z.target_revision])).toEqual([
            [["sources"], stand + 1],
            [["sources"], stand + 2],
            [["sources"], stand + 3],
            [["sources"], stand + 4],
        ]);
        // 🔴 Die Zeile hält die Karte gegen den Legacy-Zug.
        expect(karte.editorHeld).toBe(true);
        // Doppelt anhängen und eine unbekannte Quelle: abgewiesen, nichts ändert sich.
        expect((await tue(id, karte.revision, "add", eins)).statusCode).toBe(400);
        expect((await tue(id, karte.revision, "add", randomUUID())).statusCode).toBe(404);
        expect((await tue(id, karte.revision, "pages", eins)).statusCode).toBe(400);
        expect((await lies(id)).revision).toBe(karte.revision);
    });

    it("🔴 Reihenfolge: „zuerst zeigen“ stellt eine an den Anfang, sie wird der Band; Besucher sehen alle als `bands`, `band` bleibt die erste", async () => {
        const ort = await insertPlace(database, 287);
        const id = await legeAn("Reihenfolge", [ort.publicId]);
        const a = await quelle("Reihe A", { url: "https://p287test.example/a" });
        const b = await quelle("Reihe B", { url: "https://p287test.example/b" });
        const c = await quelle("Reihe C", { url: "https://p287test.example/c" });
        for (const q of [a, b, c]) await muss(id, "add", q);

        await muss(id, "first", c);
        expect((await zeilen(id)).map((z) => [z.titel, z.position])).toEqual([
            ["P287T Reihe C", 0],
            ["P287T Reihe A", 1],
            ["P287T Reihe B", 2],
        ]);
        // Schon die erste: nichts zu tun.
        const vorher = (await lies(id)).revision;
        expect(await muss(id, "first", c)).toBe(vorher);

        const besucher = async () =>
            (await listCitymaps(database, "place", [ort.publicId])).find((eintrag) => eintrag.id === id);
        expect(await besucher()).toMatchObject({
            band: "P287T Reihe C",
            bands: ["P287T Reihe C", "P287T Reihe A", "P287T Reihe B"],
        });

        // Gelöst: die erste aktive rückt nach, die gelöste fehlt bei Besuchern.
        await muss(id, "remove", c);
        expect(await besucher()).toMatchObject({ band: "P287T Reihe A", bands: ["P287T Reihe A", "P287T Reihe B"] });
        // Eine gelöste lässt sich nicht an den Anfang stellen.
        expect((await tue(id, (await lies(id)).revision, "first", c)).statusCode).toBe(400);
    });

    it("lösen und wiederherstellen: die Zeile bleibt (gelöst, nicht gelöscht) und kommt an ihren Platz zurück; Anhängen holt eine gelöste ebenso", async () => {
        const id = await legeAn("Lösen");
        const a = await quelle("Löse A", { url: "https://p287test.example/loese-a" });
        const b = await quelle("Löse B", { url: "https://p287test.example/loese-b" });
        await muss(id, "add", a, { pages: "7" });
        await muss(id, "add", b);

        await muss(id, "remove", a);
        let gespeichert = await zeilen(id);
        expect(gespeichert[0]).toMatchObject({
            titel: "P287T Löse A",
            state: "retired",
            is_active: false,
            retired_origin: "editor",
            pages: "7",
        });
        expect((await lies(id)).publications?.map((p) => [p.title, p.state])).toEqual([
            ["P287T Löse A", "retired"],
            ["P287T Löse B", "active"],
        ]);
        // Doppelt lösen und eine aktive wiederherstellen: abgewiesen.
        const stand = (await lies(id)).revision;
        expect((await tue(id, stand, "remove", a)).statusCode).toBe(400);
        expect((await tue(id, stand, "restore", b)).statusCode).toBe(400);

        await muss(id, "restore", a);
        gespeichert = await zeilen(id);
        expect(gespeichert.map((z) => [z.titel, z.state, z.pages])).toEqual([
            ["P287T Löse A", "active", "7"],
            ["P287T Löse B", "active", null],
        ]);
        expect(gespeichert[0]!.retired_origin).toBeNull();

        // Über die Suche angehängt: dieselbe Zeile lebt an ihrem Platz wieder auf, mit der neuen Fundstelle.
        await muss(id, "remove", a);
        await muss(id, "add", a, { pages: "8" });
        gespeichert = await zeilen(id);
        expect(gespeichert).toHaveLength(2);
        expect(gespeichert.map((z) => [z.titel, z.state, z.pages])).toEqual([
            ["P287T Löse A", "active", "8"],
            ["P287T Löse B", "active", null],
        ]);
    });

    it("🔴 Rechte: der Kartograph ohne `manage_sources` hängt an, sucht und löst, legt aber keine Quelle an; der Reviewer liest nur (403)", async () => {
        const id = await legeAn("Rechte");
        const q = await quelle("Recht", { url: "https://p287test.example/recht" });
        const stand = (await lies(id)).revision;

        expect((await tue(id, stand, "add", q, {}, leseCookie)).statusCode).toBe(403);
        const angehaengt = await tue(id, stand, "add", q, { pages: "3" }, kartographCookie);
        expect(angehaengt.statusCode, angehaengt.body).toBe(200);
        expect((await tue(id, stand + 1, "first", q, {}, kartographCookie)).statusCode).toBe(200);
        expect((await tue(id, stand + 1, "remove", q, {}, kartographCookie)).statusCode).toBe(200);

        // Die Suche ist mit dem Recht der Sammlung lesbar, das Anlegen einer neuen Quelle nicht.
        const suche = await get(`${INHALTE_QUELLEN_URL}?q=P287T%20Recht&limit=8&umschlag=true`, kartographCookie);
        expect(suche.statusCode).toBe(200);
        expect((suche.json() as InhalteQuellenListe).items.map((zeile) => zeile.title)).toContain("P287T Recht");
        const anlegen = await post(
            INHALTE_QUELLEN_URL,
            { operationId: randomUUID(), url: "https://p287test.example/neu", title: "P287T Neu" },
            kartographCookie,
        );
        expect(anlegen.statusCode).toBe(403);
    });

    it("der gesehene Stand zählt (409), ein stillgelegter Eintrag nimmt nichts an (409 citymap_retired), dieselbe Kennung wirkt nur einmal", async () => {
        const id = await legeAn("Stand");
        const q = await quelle("Stand", { url: "https://p287test.example/stand" });
        const stand = (await lies(id)).revision;
        expect((await tue(id, stand + 2, "add", q)).statusCode).toBe(409);

        const operationId = randomUUID();
        const body = { operationId, baseRevision: stand, op: "add", sourceId: q, pages: "1" };
        const erste = await post(mediaKarteQuellenUrl(id), body);
        expect(erste.statusCode, erste.body).toBe(200);
        const zweite = await post(mediaKarteQuellenUrl(id), body);
        expect(zweite.json()).toEqual({ ...(erste.json() as OperationReceipt), status: "replayed" });

        const entfernt = await post(mediaKarteStilllegenUrl(id), {
            operationId: randomUUID(),
            baseRevision: stand + 1,
        });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        const antwort = await tue(id, stand + 2, "pages", q, { pages: "2" });
        expect(antwort.statusCode).toBe(409);
        expect(antwort.json()).toMatchObject({ error: { code: "citymap_retired" } });
    });

    it("schreibt der Legacy-Zug gerade, ist die Handlung 503 und nichts ändert sich", async () => {
        const id = await legeAn("Zug");
        const q = await quelle("Zug", { url: "https://p287test.example/zug" });
        const stand = (await lies(id)).revision;
        const domaene = `test-karte-quellen-${randomUUID()}`;
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
                aendereKartenquellen(
                    database,
                    { personId: personen[0]!, environment: "test" as const },
                    id,
                    { operationId: randomUUID(), baseRevision: stand, op: "add", sourceId: q },
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

    it("🔴 Umschlag über `wikipub:` und über die Adresse (auch die Nummer des Produkts), nie über den Titel; mehrdeutig heißt kein Bild", async () => {
        await werkMitUmschlag(28701, { wikiKey: "p287t-schluessel" }, true);
        await werkMitUmschlag(28702, { fshop: "https://p287test.example/shop/gleich" }, false);
        await werkMitUmschlag(28703, { fshopCode: "P287T-11" }, true);
        await werkMitUmschlag(
            28704,
            { ulisses: "https://www.ulisses-ebooks.de/de/product/987001/p287t-produkt-pdf-als-download-kaufen" },
            true,
        );
        // Derselbe Titel wie eine Quelle, aber weder Schlüssel noch Adresse: Er darf nie treffen.
        await werkMitUmschlag(28705, { titel: "P287T Nur der Titel" }, true);
        // Zwei Werke unter derselben Produktnummer (ein Sammelband): kein Bild.
        await werkMitUmschlag(28706, { fshopCode: "P287T-22" }, true);
        await werkMitUmschlag(28707, { fshopCode: "P287T-22" }, true);

        const ueberSchluessel = await quelle("Über Schlüssel", { key: "wikipub:p287t-schluessel" });
        const ueberAdresse = await quelle("Über Adresse", { url: "https://p287test.example/shop/gleich" });
        const ueberFshop = await quelle("Über F-Shop", { url: "https://www.f-shop.de/search?sSearch=p287t-11" });
        const ueberUlisses = await quelle("Über Ulisses", {
            url: "https://www.ulisses-ebooks.de/de/product/987001/",
        });
        const nurTitel = await quelle("Nur der Titel", { url: "https://p287test.example/nur-titel" });
        const sammelband = await quelle("Sammelband", { url: "https://www.f-shop.de/search?sSearch=P287T-22" });

        const umschlaege = await umschlaegeVon(database, [
            ueberSchluessel,
            ueberAdresse,
            ueberFshop,
            ueberUlisses,
            nurTitel,
            sammelband,
        ]);
        expect(umschlaege.get(ueberSchluessel)).toMatchObject({ oeffentlich: true, width: 60, height: 80 });
        expect(umschlaege.get(ueberSchluessel)?.url).toMatch(/^\/media\/sha256\//u);
        // Nicht öffentlich: die private Vorschau, nur für Editoren.
        expect(umschlaege.get(ueberAdresse)).toMatchObject({ oeffentlich: false, width: 30, height: 40 });
        expect(umschlaege.get(ueberAdresse)?.url).toMatch(/\/preview\/intern_literature_cover$/u);
        expect(umschlaege.get(ueberFshop)).toMatchObject({ oeffentlich: true });
        expect(umschlaege.get(ueberUlisses)).toMatchObject({ oeffentlich: true });
        expect(umschlaege.has(nurTitel), "nie über den Titel").toBe(false);
        expect(umschlaege.has(sammelband), "mehrdeutig: kein Bild").toBe(false);

        // Am Eintrag und in der Suche der Publikationen dasselbe Bild; ohne `umschlag` fragt die Suche nicht danach.
        const id = await legeAn("Umschlag");
        await muss(id, "add", ueberSchluessel);
        await muss(id, "add", nurTitel);
        expect((await lies(id)).publications?.map((p) => p.umschlag?.oeffentlich ?? null)).toEqual([true, null]);
        const mit = (
            await get(`${INHALTE_QUELLEN_URL}?q=P287T%20%C3%9Cber&limit=8&umschlag=true`)
        ).json() as InhalteQuellenListe;
        expect(mit.items.find((zeile) => zeile.id === ueberSchluessel)?.umschlag).toMatchObject({ oeffentlich: true });
        const nurTitelZeile = (
            await get(`${INHALTE_QUELLEN_URL}?q=P287T%20Nur&limit=8&umschlag=true`)
        ).json() as InhalteQuellenListe;
        expect(nurTitelZeile.items.find((zeile) => zeile.id === nurTitel)?.umschlag).toBeNull();
        const ohne = (await get(`${INHALTE_QUELLEN_URL}?q=P287T%20%C3%9Cber&limit=8`)).json() as InhalteQuellenListe;
        expect(ohne.items.every((zeile) => !("umschlag" in zeile))).toBe(true);
    });
});
