import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_KARTE_DATEI_URL,
    MEDIA_KARTEN_URL,
    mediaKarteBildLoesenUrl,
    mediaKarteBildUrl,
    mediaKarteStilllegenUrl,
    mediaKarteUrl,
    mediaKarteVersionUrl,
    type MamKarteDetail,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { DERIVE_LOCK_CLASS } from "../src/derive/derive-lock.ts";
import { weiseKartenbildZu } from "../src/media-editor/kartensammlung-bilder.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, fixtureId, insertPlace } from "./support/media-fixture.ts";
import { cleanEditorMedia, pngBytes } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Neuer Eintrag der Kartensammlung, Bilder hochladen, zuweisen, ändern und lösen (WI-0287 Stufe 1, Punkt 2). Anlegen: Name, Orte, Angaben, Typen, von Hand angelegt und gegen den
 * Legacy-Zug gehalten; ohne Namen oder mit unbekanntem Ort entsteht nichts. Hochladen: eine Kartendatei als Rohkörper, bis 50 MB (deutlich über den 6 MiB der anderen Bilder), ein PDF,
 * eine Vorschau nur bis 6 MiB; ein falscher Rumpf und eine fremde Rolle sind 400, ohne Recht 403. Zuweisen: Karte und Vorschau sind getrennte Werke, die falsche Art ist 409, eine
 * Vorschau wird ersetzt (die alte Bindung zurückgezogen, das Werk bleibt), eine Karte kommt seit Stufe 2 als weitere Version dazu (Bezeichnung, Reihenfolge, `citymap.version`), ein
 * stillgelegter Eintrag nimmt nichts an, der gesehene Stand zählt, der Legacy-Zug hat Vorrang (503). Die Rechte aller Routen prüft die Matrix (`media-rechte-matrix.test.ts`), die
 * Oberfläche `medien-karte-neu-modell.test.ts`.
 */
describeWithDatabase("Eintrag und Bilder der Kartensammlung (WI-0287)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let cookie = "";
    let leseCookie = "";
    let personId = "";
    let pruefId = "";
    let ort = "";
    const rights = { basis: "own_work", creator: "Elwe" };
    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });
    const form = (role: "map_full" | "map_preview", extra: Record<string, unknown> = {}) => ({
        title: role === "map_full" ? "Karte der Probe" : "Vorschau der Probe",
        role,
        creationMethod: "drawing",
        rights,
        ...extra,
    });
    const rumpf = (kopf: unknown, datei: Buffer): Buffer => {
        const text = Buffer.from(JSON.stringify(kopf), "utf8");
        const laenge = Buffer.alloc(4);
        laenge.writeUInt32BE(text.byteLength);
        return Buffer.concat([laenge, text, datei]);
    };
    const hochladen = (body: Buffer, kekse = cookie) =>
        app.inject({
            method: "PUT",
            url: MEDIA_KARTE_DATEI_URL,
            headers: { origin: TEST_ORIGIN, cookie: kekse, "content-type": "application/octet-stream" },
            payload: body,
        });
    const post = (url: string, payload: Record<string, unknown>, kekse = cookie) =>
        app.inject({ method: "POST", url, headers: { origin: TEST_ORIGIN, cookie: kekse }, payload });
    const lies = async (id: string): Promise<MamKarteDetail> =>
        (await app.inject({ method: "GET", url: mediaKarteUrl(id), headers: { origin: TEST_ORIGIN, cookie } })).json();
    let seed = 700;
    /** Ein Werk der Rolle, hochgeladen über die Route (Rohkörper). */
    const werk = async (role: "map_full" | "map_preview", extra: Record<string, unknown> = {}): Promise<string> => {
        const antwort = await hochladen(
            rumpf({ operationId: randomUUID(), name: "probe.png", form: form(role, extra) }, await pngBytes(seed++)),
        );
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "media_asset")!.id;
    };
    const legeAn = async (extra: Record<string, unknown> = {}): Promise<string> => {
        const antwort = await post(MEDIA_KARTEN_URL, {
            operationId: randomUUID(),
            fields: { title: "Eintrag der Probe" },
            types: [],
            places: [],
            ...extra,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "citymap")!.id;
    };
    const weise = (id: string, baseRevision: number, role: string, assetId: string, kekse = cookie) =>
        post(mediaKarteBildUrl(id), { operationId: randomUUID(), baseRevision, role, assetId }, kekse);
    const aufraeumen = async (): Promise<void> => {
        const ids = await database<{ id: string }[]>`
            SELECT id::text AS id FROM citymap WHERE title LIKE '%der Probe%' AND source_system = 'avesmaps3d'
        `;
        const kennungen = ids.map((zeile) => zeile.id);
        await database`DELETE FROM citymap_media WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM citymap_type WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM citymap_place WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`DELETE FROM citymap_link WHERE citymap_id = ANY(${kennungen}::bigint[])`;
        await database`
            DELETE FROM media_audit_event
             WHERE citymap_public_id IN (SELECT public_id FROM citymap WHERE id = ANY(${kennungen}::bigint[]))
        `;
        await database`DELETE FROM citymap WHERE id = ANY(${kennungen}::bigint[])`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        await cleanMediaFixtures(database);
        const fixture = authFixture(database);
        const redakteurin = await fixture.person("editor", { name: "Karten Anlegerin" });
        personId = redakteurin.id;
        cookie = (await fixture.session(redakteurin.id, { passkeyMinutesAgo: 1 })).cookie;
        const pruefer = await fixture.person("reviewer", { name: "Karten Prüfer" });
        pruefId = pruefer.id;
        leseCookie = (await fixture.session(pruefer.id, { passkeyMinutesAgo: 1 })).cookie;
        await cleanEditorMedia(database, [personId, pruefId]);
        await insertPlace(database, 71);
        ort = fixtureId(71);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-karte-"));
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
        await cleanEditorMedia(database, [personId, pruefId]);
        await cleanMediaFixtures(database);
        await database.end();
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("ein neuer Eintrag: Name, Orte, Angaben und Typen, von Hand angelegt und gegen den Legacy-Zug gehalten", async () => {
        const operationId = randomUUID();
        const anfrage = {
            operationId,
            fields: {
                title: "  Eintrag der Probe  ",
                art: "politisch",
                author: "Elwe",
                validFromBf: 1020,
                isOfficial: null,
            },
            types: ["stadtplan", "bezirk"],
            places: [ort],
        };
        const erste = await post(MEDIA_KARTEN_URL, anfrage);
        expect(erste.statusCode, erste.body).toBe(200);
        const quittung = erste.json() as OperationReceipt;
        const id = quittung.affected.find((eintrag) => eintrag.kind === "citymap")!.id;
        expect(quittung.derivedWork).toEqual([]);

        const karte = await lies(id);
        expect(karte).toMatchObject({
            title: "Eintrag der Probe",
            art: "politisch",
            author: "Elwe",
            validFromBf: 1020,
            isOfficial: null,
            legacyOrigin: "manual",
            state: "active",
            editorHeld: true,
            images: [],
            links: [],
            types: ["bezirk", "stadtplan"],
        });
        expect(karte.places[0]).toMatchObject({ targetState: "resolved", target: { kind: "place", id: ort } });

        // Dieselbe Kennung legt nichts zweimal an.
        expect((await post(MEDIA_KARTEN_URL, anfrage)).json()).toEqual({ ...quittung, status: "replayed" });
        const [zahl] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM citymap WHERE title = 'Eintrag der Probe'`;
        expect(zahl!.n).toBe(1);
    });

    it("ohne Namen oder mit einem unbekannten Ort entsteht nichts; ohne Recht 403", async () => {
        const leer = await post(MEDIA_KARTEN_URL, {
            operationId: randomUUID(),
            fields: { title: "   " },
            types: [],
            places: [],
        });
        expect(leer.statusCode).toBe(400);
        const ohne = await post(MEDIA_KARTEN_URL, {
            operationId: randomUUID(),
            fields: { title: "Falsch der Probe" },
            types: [],
            places: [randomUUID()],
        });
        expect(ohne.statusCode).toBe(400);
        const [zahl] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM citymap WHERE title = 'Falsch der Probe'`;
        expect(zahl!.n).toBe(0);
        const lesend = await post(
            MEDIA_KARTEN_URL,
            { operationId: randomUUID(), fields: { title: "Lesen der Probe" }, types: [], places: [] },
            leseCookie,
        );
        expect(lesend.statusCode).toBe(403);
    });

    it("🔴 eine Kartendatei darf deutlich über 6 MiB liegen, ein PDF sein; eine Vorschau nicht; ein falscher Rumpf und eine fremde Rolle sind 400", async () => {
        const gross = Buffer.concat([await pngBytes(seed++), Buffer.alloc(14 * 1024 * 1024)]);
        const grossAntwort = await hochladen(
            rumpf({ operationId: randomUUID(), name: "gross.png", form: form("map_full") }, gross),
        );
        expect(grossAntwort.statusCode, grossAntwort.body).toBe(200);
        const [datei] = await database<{ byte_size: number; asset_type: string; ingest_kind: string }[]>`
            SELECT f.byte_size::int AS byte_size, a.asset_type, i.ingest_kind
              FROM media_asset a JOIN media_file f ON f.media_asset_id = a.id AND f.storage_class = 'private_source'
              JOIN media_ingest i ON i.media_asset_id = a.id
             WHERE a.public_id = ${(grossAntwort.json() as OperationReceipt).affected[0]!.id}::uuid
        `;
        expect(datei).toMatchObject({ asset_type: "map", ingest_kind: "editor_upload" });
        expect(datei!.byte_size).toBeGreaterThan(14 * 1024 * 1024);

        // Dieselbe Größe als Vorschau: abgewiesen (413), die Grenze der Vorschau bleibt bei 6 MiB.
        const vorschauAntwort = await hochladen(
            rumpf(
                { operationId: randomUUID(), name: "gross.png", form: form("map_preview") },
                Buffer.concat([await pngBytes(seed++), Buffer.alloc(7 * 1024 * 1024)]),
            ),
        );
        expect(vorschauAntwort.statusCode).toBe(413);

        // Über den 50 MB der Karte: ebenso 413.
        const zuGross = await hochladen(
            rumpf(
                { operationId: randomUUID(), name: "riesig.png", form: form("map_full") },
                Buffer.concat([await pngBytes(seed++), Buffer.alloc(51 * 1024 * 1024)]),
            ),
        );
        expect(zuGross.statusCode).toBe(413);

        const pdf = Buffer.from(
            `%PDF-1.4\n% ${String(seed++)}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`,
            "latin1",
        );
        const pdfAntwort = await hochladen(
            rumpf({ operationId: randomUUID(), name: "karte.pdf", form: form("map_full") }, pdf),
        );
        expect(pdfAntwort.statusCode, pdfAntwort.body).toBe(200);

        expect((await hochladen(Buffer.from("kein Rumpf"))).statusCode).toBe(400);
        const andereRolle = rumpf(
            { operationId: randomUUID(), name: "x.png", form: { ...form("map_full"), role: "header" } },
            await pngBytes(seed++),
        );
        expect((await hochladen(andereRolle)).statusCode).toBe(400);
        const ohneRecht = rumpf(
            { operationId: randomUUID(), name: "x.png", form: form("map_full") },
            await pngBytes(seed++),
        );
        expect((await hochladen(ohneRecht, leseCookie)).statusCode).toBe(403);
    });

    it("Karte und Vorschau zuweisen: getrennte Werke, die Revision zählt, die Zeile hält den Eintrag und der Abgleich ist eingereiht", async () => {
        const id = await legeAn({ fields: { title: "Zuweisen der Probe" } });
        const vorher = await lies(id);
        const karte = await werk("map_full", { rightsReviewed: true });
        const vorschau = await werk("map_preview", { rightsReviewed: true });

        const veraltet = await weise(id, vorher.revision + 5, "map_full", karte);
        expect(veraltet.statusCode).toBe(409);

        const gebunden = await weise(id, vorher.revision, "map_full", karte);
        expect(gebunden.statusCode, gebunden.body).toBe(200);
        expect((gebunden.json() as OperationReceipt).derivedWork).toHaveLength(1);
        const danach = await lies(id);
        expect(danach.revision).toBe(vorher.revision + 1);
        expect(danach.images.map((bild) => [bild.role, bild.assetId])).toEqual([["map_full", karte]]);

        const zweite = await weise(id, danach.revision, "map_preview", vorschau);
        expect(zweite.statusCode, zweite.body).toBe(200);
        const beide = await lies(id);
        expect(beide.images.map((bild) => bild.role).sort()).toEqual(["map_full", "map_preview"]);
        expect(beide.images.find((bild) => bild.role === "map_preview")!.assetId).toBe(vorschau);

        const zeilen = await database<{ details: { fields: string[] } }[]>`
            SELECT details FROM media_audit_event WHERE citymap_public_id = ${id}::uuid AND action = 'citymap.updated' ORDER BY id
        `;
        expect(zeilen.map((zeile) => zeile.details.fields)).toEqual([["images"], ["images"]]);
        const [halten] = await database<{ editor_held: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM media_audit_event g WHERE g.citymap_public_id = ${id}::uuid AND g.action = 'citymap.updated') AS editor_held
        `;
        expect(halten!.editor_held).toBe(true);
    });

    it("🔴 die falsche Art ist 409: eine Vorschau ist keine Karte und eine Karte keine Vorschau", async () => {
        const id = await legeAn({ fields: { title: "Art der Probe" } });
        const stand = (await lies(id)).revision;
        const karte = await werk("map_full");
        const vorschau = await werk("map_preview");
        const alsKarte = await weise(id, stand, "map_full", vorschau);
        expect(alsKarte.statusCode).toBe(409);
        expect(alsKarte.json()).toMatchObject({ error: { code: "media_type_mismatch" } });
        const alsVorschau = await weise(id, stand, "map_preview", karte);
        expect(alsVorschau.statusCode).toBe(409);
        expect(alsVorschau.json()).toMatchObject({ error: { code: "media_type_mismatch" } });
        expect((await lies(id)).revision).toBe(stand);
    });

    it("eine Vorschau derselben Rolle wird ersetzt: die alte Bindung zurückgezogen, das Werk bleibt, ein erneutes Zuweisen belebt die Zeile", async () => {
        const id = await legeAn({ fields: { title: "Ersetzen der Probe" } });
        const erstes = await werk("map_preview");
        const zweites = await werk("map_preview");
        let stand = (await lies(id)).revision;
        expect((await weise(id, stand, "map_preview", erstes)).statusCode).toBe(200);
        stand += 1;

        // Dasselbe Werk noch einmal: 409, nichts ändert sich.
        const doppelt = await weise(id, stand, "map_preview", erstes);
        expect(doppelt.statusCode).toBe(409);
        expect(doppelt.json()).toMatchObject({ error: { code: "media_already_bound" } });

        const ersetzt = await weise(id, stand, "map_preview", zweites);
        expect(ersetzt.statusCode, ersetzt.body).toBe(200);
        // Der Abgleich für das neue UND das abgelöste Werk.
        expect((ersetzt.json() as OperationReceipt).derivedWork).toHaveLength(2);
        stand += 1;
        expect((await lies(id)).images.map((bild) => bild.assetId)).toEqual([zweites]);
        const [altes] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
             WHERE a.public_id = ${erstes}::uuid AND m.retired_at IS NOT NULL
        `;
        expect(altes!.n).toBe(1);
        const [werkNoch] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${erstes}::uuid`;
        expect(werkNoch!.n).toBe(1);

        const zurueck = await weise(id, stand, "map_preview", erstes);
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect((await lies(id)).images.map((bild) => bild.assetId)).toEqual([erstes]);
        const [zeilen] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
             WHERE a.public_id = ${erstes}::uuid AND m.role = 'map_preview'
        `;
        expect(zeilen!.n).toBe(1);
        // Eine Vorschau hat keine Version.
        const mitBezeichnung = await post(mediaKarteBildUrl(id), {
            operationId: randomUUID(),
            baseRevision: stand + 1,
            role: "map_preview",
            assetId: zweites,
            versionLabel: "Spielerversion",
        });
        expect(mitBezeichnung.statusCode).toBe(400);
    });

    it("🔴 Stufe 2: eine weitere Karte kommt als Version dazu, mit Bezeichnung und ans Ende; Lösen nimmt genau die genannte, die übrigen rücken auf", async () => {
        const id = await legeAn({ fields: { title: "Versionen der Probe" } });
        const [spieler, meister, dritte] = [await werk("map_full"), await werk("map_full"), await werk("map_full")];
        let stand = (await lies(id)).revision;
        const binde = async (assetId: string, versionLabel?: string): Promise<void> => {
            const antwort = await post(mediaKarteBildUrl(id), {
                operationId: randomUUID(),
                baseRevision: stand,
                role: "map_full",
                assetId,
                ...(versionLabel === undefined ? {} : { versionLabel }),
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            // Nur der Abgleich des neuen Werks: Keine Version wird abgelöst.
            expect((antwort.json() as OperationReceipt).derivedWork).toHaveLength(1);
            stand += 1;
        };
        await binde(spieler, "  Spielerversion  ");
        await binde(meister, "SL-Version");
        await binde(dritte, "   ");
        const versionen = (karte: MamKarteDetail) =>
            karte.images
                .filter((bild) => bild.role === "map_full")
                .map((bild) => [bild.assetId, bild.versionLabel, bild.versionPosition]);
        expect(versionen(await lies(id))).toEqual([
            [spieler, "Spielerversion", 0],
            [meister, "SL-Version", 1],
            [dritte, null, 2],
        ]);
        expect(
            (
                await app.inject({
                    method: "GET",
                    url: `${MEDIA_KARTEN_URL}?q=Versionen%20der%20Probe`,
                    headers: { cookie },
                })
            )
                .json()
                .items.find((zeile: { id: string }) => zeile.id === id),
        ).toMatchObject({ versions: 3 });

        // Dieselbe Karte noch einmal: 409.
        const doppelt = await weise(id, stand, "map_full", meister);
        expect(doppelt.statusCode).toBe(409);
        expect(doppelt.json()).toMatchObject({ error: { code: "media_already_bound" } });

        // Ohne Nennung ist bei mehreren Versionen offen, welche gemeint ist: 400.
        const loesen = (body: Record<string, unknown>) =>
            post(mediaKarteBildLoesenUrl(id), {
                operationId: randomUUID(),
                baseRevision: stand,
                role: "map_full",
                ...body,
            });
        expect((await loesen({})).statusCode).toBe(400);
        expect((await loesen({ assetId: randomUUID() })).json()).toMatchObject({ error: { code: "media_not_bound" } });
        const geloest = await loesen({ assetId: spieler });
        expect(geloest.statusCode, geloest.body).toBe(200);
        stand += 1;
        expect(versionen(await lies(id))).toEqual([
            [meister, "SL-Version", 0],
            [dritte, null, 1],
        ]);

        // Wieder zugewiesen: dieselbe Zeile lebt auf, mit der Bezeichnung von jetzt und am Ende.
        await binde(spieler);
        expect(versionen(await lies(id))).toEqual([
            [meister, "SL-Version", 0],
            [dritte, null, 1],
            [spieler, null, 2],
        ]);
        const [zeilen] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM citymap_media m JOIN media_asset a ON a.id = m.media_asset_id
             WHERE a.public_id = ${spieler}::uuid AND m.role = 'map_full'
        `;
        expect(zeilen!.n).toBe(1);
    });

    it("Stufe 2: Bezeichnung und Reihenfolge einer Version (`citymap.version`) gegen den gesehenen Stand; ohne Änderung keine Revision, die Zeile hält die Karte", async () => {
        const id = await legeAn({ fields: { title: "Reihenfolge der Probe" } });
        const [erste, zweite] = [await werk("map_full"), await werk("map_full")];
        let stand = (await lies(id)).revision;
        for (const assetId of [erste, zweite]) {
            expect((await weise(id, stand, "map_full", assetId)).statusCode).toBe(200);
            stand += 1;
        }
        const version = (body: Record<string, unknown>, kekse = cookie) =>
            post(mediaKarteVersionUrl(id), { operationId: randomUUID(), baseRevision: stand, ...body }, kekse);

        expect((await version({ assetId: zweite, op: "label", label: "Spielerversion" }, leseCookie)).statusCode).toBe(
            403,
        );
        const veraltet = await post(mediaKarteVersionUrl(id), {
            operationId: randomUUID(),
            baseRevision: stand + 2,
            assetId: zweite,
            op: "first",
        });
        expect(veraltet.statusCode).toBe(409);
        expect((await version({ assetId: zweite, op: "label" })).statusCode).toBe(400);
        const fremd = await version({ assetId: randomUUID(), op: "first" });
        expect(fremd.statusCode).toBe(409);
        expect(fremd.json()).toMatchObject({ error: { code: "media_not_bound" } });

        const benannt = await version({ assetId: zweite, op: "label", label: " Spielerversion " });
        expect(benannt.statusCode, benannt.body).toBe(200);
        stand += 1;
        expect((benannt.json() as OperationReceipt).affected[0]!.revision).toBe(stand);
        // Dieselbe Bezeichnung noch einmal: nichts ändert sich, auch nicht die Revision.
        const gleich = await version({ assetId: zweite, op: "label", label: "Spielerversion" });
        expect(gleich.statusCode).toBe(200);
        expect((gleich.json() as OperationReceipt).affected[0]!.revision).toBe(stand);

        const vorn = await version({ assetId: zweite, op: "first" });
        expect(vorn.statusCode, vorn.body).toBe(200);
        stand += 1;
        expect((await version({ assetId: zweite, op: "first" })).json()).toMatchObject({
            affected: [{ revision: stand }],
        });
        const karte = await lies(id);
        expect(karte.revision).toBe(stand);
        expect(
            karte.images
                .filter((bild) => bild.role === "map_full")
                .map((bild) => [bild.assetId, bild.versionLabel, bild.versionPosition]),
        ).toEqual([
            [zweite, "Spielerversion", 0],
            [erste, null, 1],
        ]);
        // Leer nimmt die Bezeichnung weg.
        expect((await version({ assetId: zweite, op: "label", label: "" })).statusCode).toBe(200);
        stand += 1;
        expect((await lies(id)).images.find((bild) => bild.assetId === zweite)?.versionLabel).toBeNull();

        const zeilen = await database<{ details: { fields: string[] } }[]>`
            SELECT details FROM media_audit_event WHERE citymap_public_id = ${id}::uuid AND action = 'citymap.updated' ORDER BY id
        `;
        // Zwei Bindungen, Bezeichnung, Reihenfolge, Bezeichnung weg: fünf Zeilen, keine für die Handlungen ohne Änderung.
        expect(zeilen).toHaveLength(5);
        expect(zeilen.every((zeile) => zeile.details.fields.join() === "images")).toBe(true);

        // Ein stillgelegter Eintrag nimmt keine Handlung an.
        expect(
            (await post(mediaKarteStilllegenUrl(id), { operationId: randomUUID(), baseRevision: stand })).statusCode,
        ).toBe(200);
        stand += 1;
        const still = await version({ assetId: erste, op: "first" });
        expect(still.statusCode).toBe(409);
        expect(still.json()).toMatchObject({ error: { code: "citymap_retired" } });
    });

    it("das Bild einer Rolle lösen: gegen den gesehenen Stand, das Werk bleibt, ein zweites Lösen ist 409", async () => {
        const id = await legeAn({ fields: { title: "Loesen der Probe" } });
        const vorschau = await werk("map_preview");
        let stand = (await lies(id)).revision;
        expect((await weise(id, stand, "map_preview", vorschau)).statusCode).toBe(200);
        stand += 1;

        const loesen = (baseRevision: number, role = "map_preview", kekse = cookie) =>
            post(mediaKarteBildLoesenUrl(id), { operationId: randomUUID(), baseRevision, role }, kekse);
        expect((await loesen(stand + 3)).statusCode).toBe(409);
        expect((await loesen(stand, "map_preview", leseCookie)).statusCode).toBe(403);
        const quittung = await loesen(stand);
        expect(quittung.statusCode, quittung.body).toBe(200);
        expect((quittung.json() as OperationReceipt).derivedWork).toHaveLength(1);
        const danach = await lies(id);
        expect(danach.images).toEqual([]);
        expect(danach.revision).toBe(stand + 1);
        const [werkNoch] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${vorschau}::uuid`;
        expect(werkNoch!.n).toBe(1);

        const nochmal = await loesen(danach.revision);
        expect(nochmal.statusCode).toBe(409);
        expect(nochmal.json()).toMatchObject({ error: { code: "media_not_bound" } });
    });

    it("ein stillgelegter Eintrag nimmt kein Bild an und lässt keines lösen (409), ohne Recht 403", async () => {
        const id = await legeAn({ fields: { title: "Stillgelegt der Probe" } });
        const karte = await werk("map_full");
        let stand = (await lies(id)).revision;
        expect((await weise(id, stand, "map_full", karte)).statusCode).toBe(200);
        stand += 1;
        expect((await weise(id, stand, "map_full", karte, leseCookie)).statusCode).toBe(403);
        const entfernt = await post(mediaKarteStilllegenUrl(id), { operationId: randomUUID(), baseRevision: stand });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        stand += 1;

        const weiteres = await werk("map_full");
        const zuweisen = await weise(id, stand, "map_full", weiteres);
        expect(zuweisen.statusCode).toBe(409);
        expect(zuweisen.json()).toMatchObject({ error: { code: "citymap_retired" } });
        const loesen = await post(mediaKarteBildLoesenUrl(id), {
            operationId: randomUUID(),
            baseRevision: stand,
            role: "map_full",
        });
        expect(loesen.statusCode).toBe(409);
        expect(loesen.json()).toMatchObject({ error: { code: "citymap_retired" } });
    });

    it("schreibt der Legacy-Zug gerade, ist das Zuweisen 503 und nichts ändert sich", async () => {
        const id = await legeAn({ fields: { title: "Zug der Probe" } });
        const karte = await werk("map_full");
        const stand = (await lies(id)).revision;
        const domaene = `test-karte-bilder-${randomUUID()}`;
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
                weiseKartenbildZu(
                    database,
                    { personId, environment: "test" as const },
                    id,
                    { operationId: randomUUID(), baseRevision: stand, role: "map_full", assetId: karte },
                    { mapDomainId: domaene },
                ),
            ).rejects.toMatchObject({ statusCode: 503, code: "map_import_running" });
        } finally {
            freigeben();
            await zug;
        }
        const danach = await lies(id);
        expect(danach.revision).toBe(stand);
        expect(danach.images).toEqual([]);
    });
});
