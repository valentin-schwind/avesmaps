import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_BIND_URL,
    MEDIA_GALLERY_CAPTION_URL,
    MEDIA_GALLERY_COVER_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_GALLERY_DELETE_URL,
    MEDIA_GALLERY_ORDER_URL,
    MEDIA_GALLERY_REMOVE_URL,
    MEDIA_GALLERY_TITLE_URL,
    MEDIA_GALLERY_UNBIND_URL,
    MEDIA_UPLOAD_URL,
    mediaEditorGalleryUrl,
    type MediaGalleryDetail,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { resolvePlaceMedia } from "../src/media/resolver.ts";
import { MediaStore } from "../src/media/storage.ts";
import { searchMedia } from "../src/media-editor/search.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { usageOf } from "../src/media-editor/usage.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertAsset, insertGallery, insertPlace } from "./support/media-fixture.ts";
import {
    bytegleichesWerk,
    cleanEditorMedia,
    file,
    operation,
    pngBytes,
    uploadForm,
} from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Der Schreibpfad der Galerie als eigenes Medienobjekt (WI-0068 P6, `gallery-operations.ts`).
 *
 * Geprüft werden die Fälle, in denen eine Galerieoberfläche sonst still das Falsche täte:
 *
 * - **Soll**: anlegen ohne Ort, Bilder hineinlegen, binden - und erst mit dem Ort wird ein Bild öffentlich (Betreiber 2026-10-13,
 *   Variante A).
 * - **Lösen rührt die Bilder nicht an**: Die Folge bleibt vollständig, nur dieser Ort verliert sie. Das ist die Zusicherung, die
 *   ein versehentliches „Entfernen“ von einem Ort aus sonst stillschweigend brechen würde.
 * - **Dieselbe Galerie an zwei Orten**, aber nie zwei Galerien an einem Ort.
 * - **Wiederaufnahme**: lösen und erneut binden am selben Ort endet NICHT in einem erfundenen Bearbeitungskonflikt.
 * - **Revision**: zwei Operationen auf demselben gesehenen Stand - die zweite bekommt 409, kein stilles Überschreiben.
 * - **Folge**: eine Reihenfolge, die nicht genau die aktiven Einträge nennt, ist 400 statt einer halb umsortierten Galerie.
 * - **Cover**: nur ein aktiver Eintrag kann Titelbild sein; nimmt jemand das Coverbild heraus, fällt die Setzung weg.
 * - **Idempotenz**: dieselbe `operationId` zweimal legt kein zweites Bild ein.
 */
describeWithDatabase("Galerie-Schreibpfad (WI-0068 P6)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let store: MediaStore;
    let mediaRoot = "";
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    let cookie = "";
    let ruleId = "";
    const bilder: string[] = [];
    /** Ein eigenes Werk mit DENSELBEN Bytes wie `bilder[0]` - die Dublette, die Legacy hinterlassen hat. */
    let doppelgaenger = "";
    let galerie = "";
    let revision = 0;
    let ortA = "";
    let ortB = "";

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    /** Eine Operation gegen den Server; die Antwort kommt roh zurück, damit auch Fehlerfälle prüfbar sind. */
    const post = async (url: string, payload: object): Promise<{ status: number; body: unknown }> => {
        const antwort = await app.inject({
            method: "POST",
            url,
            payload: { operationId: operation(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        return { status: antwort.statusCode, body: antwort.json() as unknown };
    };

    /** 🪤 Die Fehlerform des Hauses ist `{ error: { code, message, details } }`, nicht `{ code }`. */
    const fehler = (body: unknown): string | undefined => (body as { error?: { code?: string } }).error?.code;

    /**
     * Eine Operation, die gelingen MUSS.
     *
     * 🪤 Sie schreibt die Revision NUR fort, wenn die Quittung DIESE Galerie nennt: Mehrere Fälle legen zwischendurch eine
     * zweite Galerie an, und deren Revision 1 würde den laufenden Stand sonst zurückdrehen.
     */
    const ok = async (url: string, payload: object): Promise<OperationReceipt> => {
        const { status, body } = await post(url, payload);
        expect(status, `${url}: ${JSON.stringify(body)}`).toBe(200);
        const quittung = body as OperationReceipt;
        const frisch = quittung.affected.find((eintrag) => eintrag.kind === "gallery");
        if (frisch?.revision !== undefined && (galerie === "" || frisch.id === galerie)) revision = frisch.revision;
        return quittung;
    };

    const eintraege = async (): Promise<{ assetId: string; sortOrder: number; retired: boolean }[]> =>
        database<{ assetId: string; sortOrder: number; retired: boolean }[]>`
            SELECT a.public_id::text AS "assetId", i.sort_order AS "sortOrder", i.retired_at IS NOT NULL AS retired
              FROM media_gallery_item i
              JOIN media_asset a ON a.id = i.media_asset_id
              JOIN media_gallery g ON g.id = i.gallery_id
             WHERE g.public_id = ${galerie}::uuid
             ORDER BY i.retired_at IS NOT NULL, i.sort_order
        `;

    const ortsbilder = async (ort: string): Promise<string[]> =>
        (await resolvePlaceMedia(database, ort)).filter((view) => view.role === "header").map((view) => view.role);

    const abgleich = async (assetId: string): Promise<boolean> =>
        (await settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" })).published;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-galerie-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Galerie Redakteurin" });
        people.push(person);
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        const [rule] = await database<{ id: string }[]>`
            INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
            VALUES ('own_work', 'ai_generated', 'header', 'media-test Galerieregel', 'Testzitat', '2026-10-13')
            RETURNING id::text AS id
        `;
        ruleId = rule!.id;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();

        for (const seed of [71, 72, 73]) {
            const hochgeladen = await app.inject({
                method: "POST",
                url: MEDIA_UPLOAD_URL,
                payload: {
                    operationId: operation(),
                    file: file(await pngBytes(seed, 160, 90)),
                    form: uploadForm({
                        title: `Galeriebild ${String(seed)}`,
                        role: "header",
                        creationMethod: "ai_generated",
                    }),
                },
                headers: { origin: TEST_ORIGIN, cookie },
            });
            expect(hochgeladen.statusCode, hochgeladen.body).toBe(200);
            bilder.push(
                (hochgeladen.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "media_asset")!.id,
            );
        }
        // 🔴 Ein VIERTES Werk mit DENSELBEN Bytes wie das erste: So ist der Bestand entstanden (Legacy legte je Verwendung
        // ein eigenes Werk an, 1.025 Assets teilen ihre Quelldatei). Über das Hochladen entsteht es seit 2026-10-17 nicht mehr
        // (`media_already_exists`), deshalb legt es die Fixture an wie Legacy.
        doppelgaenger = await bytegleichesWerk(database, bilder[0]!, "Zwilling von 71");
        expect(doppelgaenger).not.toBe(bilder[0]);

        ortA = (await insertPlace(database, 71)).publicId;
        ortB = (await insertPlace(database, 72)).publicId;
    }, 150_000);

    afterAll(async () => {
        await app?.close();
        if (ruleId !== "") await database`DELETE FROM publication_rule WHERE id = ${ruleId}::bigint`;
        await cleanEditorMedia(
            database,
            people.map((person) => person.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("anlegen: eine Galerie ohne Ort, mit Titel", async () => {
        const quittung = await ok(MEDIA_GALLERY_CREATE_URL, { title: "Hafenbilder" });
        const angelegt = quittung.affected.find((eintrag) => eintrag.kind === "gallery");
        expect(angelegt?.id).toBeDefined();
        galerie = angelegt!.id;
        const [row] = await database<{ title: string | null; origin: string }[]>`
            SELECT title, origin FROM media_gallery WHERE public_id = ${galerie}::uuid
        `;
        expect(row).toMatchObject({ title: "Hafenbilder", origin: "editor" });
        expect(await eintraege()).toEqual([]);
    });

    it("Titel ändern und leeren - leer heißt „kein eigener Titel“, nicht der leere String", async () => {
        await ok(MEDIA_GALLERY_TITLE_URL, { galleryId: galerie, baseRevision: revision, title: "  Hafen  " });
        const [getrimmt] = await database<{ title: string | null }[]>`
            SELECT title FROM media_gallery WHERE public_id = ${galerie}::uuid
        `;
        expect(getrimmt?.title).toBe("Hafen");

        await ok(MEDIA_GALLERY_TITLE_URL, { galleryId: galerie, baseRevision: revision, title: "   " });
        const [geleert] = await database<{ title: string | null }[]>`
            SELECT title FROM media_gallery WHERE public_id = ${galerie}::uuid
        `;
        expect(geleert?.title, "ein leerer Titel ist NULL - der CHECK verbietet den leeren String").toBeNull();
    });

    it("Bilder hineinlegen - die Folge entsteht in der Reihenfolge des Einlegens", async () => {
        for (const bild of bilder) {
            await ok(MEDIA_GALLERY_ADD_URL, { galleryId: galerie, baseRevision: revision, assetId: bild });
        }
        expect((await eintraege()).map((eintrag) => eintrag.assetId)).toEqual(bilder);
        expect((await eintraege()).map((eintrag) => eintrag.sortOrder)).toEqual([0, 1, 2]);
    });

    it("🔴 ohne Ort ist kein Bild öffentlich - die Entwurfsgalerie (Betreiber 2026-10-13, Variante A)", async () => {
        expect(await abgleich(bilder[0]!)).toBe(false);
        expect(await ortsbilder(ortA)).toEqual([]);
    });

    it("dasselbe Bild zweimal einlegen ist 409, nicht ein zweiter Eintrag", async () => {
        const { status, body } = await post(MEDIA_GALLERY_ADD_URL, {
            galleryId: galerie,
            baseRevision: revision,
            assetId: bilder[0],
        });
        expect(status).toBe(409);
        expect(fehler(body)).toBe("media_already_bound");
        expect(await eintraege()).toHaveLength(3);
    });

    it("🔴 ein ANDERES Werk mit denselben Bytes ist 409 - zwei davon in einer Galerie wären dasselbe Bild zweimal", async () => {
        const { status, body } = await post(MEDIA_GALLERY_ADD_URL, {
            galleryId: galerie,
            baseRevision: revision,
            assetId: doppelgaenger,
        });
        expect(status).toBe(409);
        expect(fehler(body)).toBe("media_duplicate_file");
        // 🪤 Die Eindeutigkeit der Tafel fängt das NICHT: Es sind zwei verschiedene Asset-Kennungen.
        expect(await eintraege(), "nichts ist dazugekommen").toHaveLength(3);
        // Der Fehler NENNT das vorhandene Bild, damit die Oberfläche sagen kann, welches gemeint ist.
        expect((body as { error?: { details?: { assetId?: string } } }).error?.details?.assetId).toBe(bilder[0]);
    });

    it("dasselbe Werk in eine ANDERE Galerie zu legen bleibt erlaubt - die Sperre gilt je Galerie", async () => {
        const andere = await ok(MEDIA_GALLERY_CREATE_URL, { title: "Andere Galerie" });
        const neueGalerie = andere.affected.find((eintrag) => eintrag.kind === "gallery")!;
        const { status } = await post(MEDIA_GALLERY_ADD_URL, {
            galleryId: neueGalerie.id,
            baseRevision: neueGalerie.revision,
            assetId: doppelgaenger,
        });
        expect(status, "eine andere Galerie darf das Werk tragen").toBe(200);
    });

    it("🔴 zwei Operationen auf demselben gesehenen Stand: die zweite bekommt 409, kein stilles Überschreiben", async () => {
        const stand = revision;
        await ok(MEDIA_GALLERY_TITLE_URL, { galleryId: galerie, baseRevision: stand, title: "Erste" });
        const { status, body } = await post(MEDIA_GALLERY_TITLE_URL, {
            galleryId: galerie,
            baseRevision: stand,
            title: "Zweite",
        });
        expect(status).toBe(409);
        expect(fehler(body)).toBe("edit_conflict");
        const [row] = await database<{ title: string | null }[]>`
            SELECT title FROM media_gallery WHERE public_id = ${galerie}::uuid
        `;
        expect(row?.title, "der erste Schreiber behält sein Ergebnis").toBe("Erste");
    });

    it("🪤 die Revision steigt auch bei einer Änderung AM EINTRAG - eine baseRevision schützt die ganze Folge", async () => {
        const vorher = revision;
        await ok(MEDIA_GALLERY_CAPTION_URL, {
            galleryId: galerie,
            baseRevision: revision,
            assetId: bilder[1],
            caption: "Blick vom Kai",
        });
        expect(revision).toBeGreaterThan(vorher);
        const [row] = await database<{ caption: string | null }[]>`
            SELECT i.caption FROM media_gallery_item i
              JOIN media_asset a ON a.id = i.media_asset_id
              JOIN media_gallery g ON g.id = i.gallery_id
             WHERE g.public_id = ${galerie}::uuid AND a.public_id = ${bilder[1]!}::uuid
        `;
        expect(row?.caption).toBe("Blick vom Kai");
    });

    it("umsortieren: genau die aktiven Einträge in neuer Folge", async () => {
        const neu = [bilder[2]!, bilder[0]!, bilder[1]!];
        await ok(MEDIA_GALLERY_ORDER_URL, { galleryId: galerie, baseRevision: revision, order: neu });
        expect((await eintraege()).map((eintrag) => eintrag.assetId)).toEqual(neu);
    });

    it("🔴 eine Folge, die nicht genau die aktiven Einträge nennt, ist 400 - keine halb umsortierte Galerie", async () => {
        const vorher = (await eintraege()).map((eintrag) => eintrag.assetId);
        const zuWenig = await post(MEDIA_GALLERY_ORDER_URL, {
            galleryId: galerie,
            baseRevision: revision,
            order: [bilder[0]],
        });
        expect(zuWenig.status).toBe(400);
        expect((await eintraege()).map((eintrag) => eintrag.assetId)).toEqual(vorher);
    });

    it("Cover setzen, und 409 für ein Bild, das nicht in der Galerie steht", async () => {
        await ok(MEDIA_GALLERY_COVER_URL, { galleryId: galerie, baseRevision: revision, assetId: bilder[1] });
        const [gesetzt] = await database<{ cover: string | null }[]>`
            SELECT ca.public_id::text AS cover FROM media_gallery g
              LEFT JOIN media_gallery_item ci ON ci.id = g.cover_item_id
              LEFT JOIN media_asset ca ON ca.id = ci.media_asset_id
             WHERE g.public_id = ${galerie}::uuid
        `;
        expect(gesetzt?.cover).toBe(bilder[1]);

        const fremd = await ok(MEDIA_GALLERY_CREATE_URL, {});
        const fremdeGalerie = fremd.affected.find((eintrag) => eintrag.kind === "gallery")!;
        const { status } = await post(MEDIA_GALLERY_COVER_URL, {
            galleryId: fremdeGalerie.id,
            baseRevision: fremdeGalerie.revision,
            assetId: bilder[0],
        });
        expect(status).toBe(409);
        // Die fremde Galerie hat die laufende Revision NICHT verändert; sie gehört nicht zu diesem Faden.
        const [immerNoch] = await database<{ cover: string | null }[]>`
            SELECT ci.id::text AS cover FROM media_gallery g
              LEFT JOIN media_gallery_item ci ON ci.id = g.cover_item_id
             WHERE g.public_id = ${galerie}::uuid
        `;
        expect(immerNoch?.cover).not.toBeNull();
    });

    it("🔴 binden: erst mit dem Ort wird ein Bild öffentlich", async () => {
        const quittung = await ok(MEDIA_GALLERY_BIND_URL, {
            galleryId: galerie,
            baseRevision: revision,
            placeId: ortA,
        });
        expect(quittung.derivedWork.length, "jedes aktive Bild wird neu gerechnet").toBe(3);
        for (const bild of bilder) expect(await abgleich(bild)).toBe(true);
        expect(await ortsbilder(ortA)).toContain("header");
    });

    it("🔴 dieselbe Galerie an einem zweiten Ort - beide Orte zeigen dieselben Bilder", async () => {
        await ok(MEDIA_GALLERY_BIND_URL, { galleryId: galerie, baseRevision: revision, placeId: ortB });
        expect(await ortsbilder(ortB)).toContain("header");
        expect(await ortsbilder(ortA)).toContain("header");
        // Reverse Usage (WI-0068 R4): EIN Eintrag der Galerie, je Ort eine Verwendung - beide Orte stehen am Bild.
        const hier = (await usageOf(database, bilder[2]!))!.usages.filter((usage) => usage.gallery?.id === galerie);
        expect(hier.map((usage) => usage.subject?.id).sort()).toEqual([ortA, ortB].sort());
        expect(hier.map((usage) => usage.role)).toEqual(["header", "header"]);
    });

    it("🔴 aber nie zwei Galerien an einem Ort: 409 place_has_gallery", async () => {
        const zweite = await ok(MEDIA_GALLERY_CREATE_URL, { title: "Zweite Galerie" });
        const neu = zweite.affected.find((eintrag) => eintrag.kind === "gallery")!;
        const { status, body } = await post(MEDIA_GALLERY_BIND_URL, {
            galleryId: neu.id,
            baseRevision: neu.revision,
            placeId: ortA,
        });
        expect(status).toBe(409);
        expect(fehler(body)).toBe("place_has_gallery");
    });

    it("dieselbe Galerie zweimal an denselben Ort ist 409 media_already_bound", async () => {
        const { status, body } = await post(MEDIA_GALLERY_BIND_URL, {
            galleryId: galerie,
            baseRevision: revision,
            placeId: ortA,
        });
        expect(status).toBe(409);
        expect(fehler(body)).toBe("media_already_bound");
    });

    it("🔴 lösen rührt die Bilder nicht an: nur DIESER Ort verliert die Galerie", async () => {
        const vorher = await eintraege();
        const quittung = await ok(MEDIA_GALLERY_UNBIND_URL, {
            galleryId: galerie,
            baseRevision: revision,
            placeId: ortB,
        });
        expect(quittung.warnings, "die Galerie hängt noch an Ort A - keine Entwurfswarnung").toEqual([]);
        expect(await eintraege(), "Bilder und Folge unverändert").toEqual(vorher);
        expect(await ortsbilder(ortB)).toEqual([]);
        expect(await ortsbilder(ortA), "der andere Ort behält seine Galerie").toContain("header");
    });

    it("🔴 vom letzten Ort lösen: die Quittung sagt, dass Besucher nun nichts sehen", async () => {
        const quittung = await ok(MEDIA_GALLERY_UNBIND_URL, {
            galleryId: galerie,
            baseRevision: revision,
            placeId: ortA,
        });
        expect(quittung.warnings.map((warnung) => warnung.code)).toContain("gallery_is_draft");
        for (const bild of bilder) expect(await abgleich(bild)).toBe(false);
        expect(await ortsbilder(ortA)).toEqual([]);
        // Ohne Ort bleibt der Eintrag EINE Verwendung, ohne Fachobjekt und ohne Rolle: Er hält das Werk (WI-0068 R4).
        const entwurf = (await usageOf(database, bilder[2]!))!.usages.filter((usage) => usage.gallery?.id === galerie);
        expect(entwurf.map((usage) => [usage.subject, usage.role, usage.publication])).toEqual([[null, null, null]]);
    });

    it("🪤 lösen und erneut binden am selben Ort: Wiederaufnahme, kein erfundener Konflikt", async () => {
        await ok(MEDIA_GALLERY_BIND_URL, { galleryId: galerie, baseRevision: revision, placeId: ortA });
        // 🪤 Die Operation REIHT den Abgleich ein (Kap. 7.15): Die öffentliche Datei, die das Lösen abgeräumt hat, entsteht erst
        // mit ihm wieder. Ohne diesen Lauf wäre der Ort hier noch leer - und der Test behauptete einen Fehler, den es nicht gibt.
        for (const bild of bilder) expect(await abgleich(bild)).toBe(true);
        expect(await ortsbilder(ortA)).toContain("header");
        const [bindungen] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM place_media_gallery b
              JOIN media_gallery g ON g.id = b.media_gallery_id
              JOIN place p ON p.id = b.place_id
             WHERE g.public_id = ${galerie}::uuid AND p.public_id = ${ortA}::uuid
        `;
        expect(bindungen?.n, "eine Zeile, wieder aufgenommen - keine zweite").toBe(1);
    });

    it("🔴 ein Bild herausnehmen: der Eintrag wird zurückgezogen, das Asset bleibt", async () => {
        const herausgenommen = bilder[1]!;
        await ok(MEDIA_GALLERY_REMOVE_URL, {
            galleryId: galerie,
            baseRevision: revision,
            assetId: herausgenommen,
        });
        const jetzt = await eintraege();
        expect(jetzt.filter((eintrag) => !eintrag.retired).map((eintrag) => eintrag.assetId)).not.toContain(
            herausgenommen,
        );
        expect(jetzt.filter((eintrag) => eintrag.retired).map((eintrag) => eintrag.assetId)).toEqual([herausgenommen]);
        expect(
            jetzt.filter((eintrag) => !eintrag.retired).map((eintrag) => eintrag.sortOrder),
            "die aktiven Einträge sind wieder lückenlos",
        ).toEqual([0, 1]);
        const [asset] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${herausgenommen}::uuid
        `;
        expect(asset?.n, "das Asset selbst bleibt").toBe(1);
        const [cover] = await database<{ cover: string | null }[]>`
            SELECT g.cover_item_id::text AS cover FROM media_gallery g WHERE g.public_id = ${galerie}::uuid
        `;
        expect(cover?.cover, "war es das Coverbild, fällt die Setzung weg").toBeNull();
    });

    it("ein zurückgezogenes Bild wieder einlegen nimmt denselben Eintrag auf", async () => {
        await ok(MEDIA_GALLERY_ADD_URL, { galleryId: galerie, baseRevision: revision, assetId: bilder[1] });
        const jetzt = await eintraege();
        expect(jetzt.filter((eintrag) => eintrag.retired)).toEqual([]);
        expect(jetzt).toHaveLength(3);
    });

    it("🔴 dieselbe operationId zweimal: replayed, kein zweiter Eintrag", async () => {
        const stand = revision;
        const operationId = operation();
        const payload = { operationId, galleryId: galerie, baseRevision: stand, title: "Einmal" };
        const erste = await app.inject({
            method: "POST",
            url: MEDIA_GALLERY_TITLE_URL,
            payload,
            headers: { origin: TEST_ORIGIN, cookie },
        });
        const zweite = await app.inject({
            method: "POST",
            url: MEDIA_GALLERY_TITLE_URL,
            payload,
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(erste.statusCode, erste.body).toBe(200);
        expect(zweite.statusCode, zweite.body).toBe(200);
        expect((erste.json() as OperationReceipt).status).toBe("applied");
        expect((zweite.json() as OperationReceipt).status).toBe("replayed");
        revision = (erste.json() as OperationReceipt).affected.find((e) => e.kind === "gallery")!.revision!;
    });

    it("das Fachprotokoll nennt Galerie, Revision und Gegenstand", async () => {
        const zeilen = await database<{ action: string; revision: number | null; details: Record<string, unknown> }[]>`
            SELECT e.action, e.target_revision::int AS revision, e.details
              FROM media_audit_event e
             WHERE e.media_gallery_public_id = ${galerie}::uuid
             ORDER BY e.id
        `;
        const aktionen = zeilen.map((zeile) => zeile.action);
        expect(aktionen).toContain("gallery.created");
        expect(aktionen).toContain("gallery.header_added");
        expect(aktionen).toContain("gallery.bound");
        expect(aktionen).toContain("gallery.unbound");
        expect(aktionen).toContain("gallery.header_removed");
        expect(
            zeilen.every((zeile) => zeile.revision !== null),
            "jede Zeile nennt die Revision danach",
        ).toBe(true);
        const gebunden = zeilen.find((zeile) => zeile.action === "gallery.bound");
        expect(gebunden?.details).toMatchObject({ subject: `place:${ortA}`, role: "header" });
        const geloest = zeilen.filter((zeile) => zeile.action === "gallery.unbound");
        expect(
            geloest.some((zeile) => zeile.details["draft"] === true),
            "das Lösen vom letzten Ort ist vermerkt",
        ).toBe(true);
    });

    it("🔴 die Suche fasst bytegleiche Werke zusammen, sobald eine AUSWAHL danach fragt", async () => {
        const beide = await searchMedia(database, { q: "71", type: "picture", limit: 50, offset: 0 });
        const gefunden = beide.items.filter((zeile) => zeile.id === bilder[0] || zeile.id === doppelgaenger);
        expect(
            gefunden,
            "ohne groupFiles stehen BEIDE Werke da - die Verwaltung soll Dubletten ja finden",
        ).toHaveLength(2);
        expect(gefunden.every((zeile) => zeile.sharedFileCount >= 1)).toBe(true);
        expect(new Set(gefunden.map((zeile) => zeile.fileGroup)).size, "eine Gruppe, eine Kennung").toBe(1);

        const gruppiert = await searchMedia(database, {
            q: "71",
            type: "picture",
            groupFiles: true,
            limit: 50,
            offset: 0,
        });
        const jetzt = gruppiert.items.filter((zeile) => zeile.id === bilder[0] || zeile.id === doppelgaenger);
        expect(jetzt, "mit groupFiles nur EINES").toHaveLength(1);
        expect(jetzt[0]?.id, "und zwar das älteste - es führt die Gruppe").toBe(bilder[0]);
        // 🪤 Der Filter wirkt über Seitengrenzen: Er steht im WHERE, nicht in der Oberfläche.
        expect(gruppiert.total).toBeLessThan(beide.total);
    });

    it("ein Werk, das seine Datei allein trägt, hat keine Gruppe", async () => {
        const treffer = await searchMedia(database, { q: "72", type: "picture", limit: 50, offset: 0 });
        const allein = treffer.items.find((zeile) => zeile.id === bilder[1]);
        expect(allein?.sharedFileCount).toBe(0);
        expect(allein?.fileGroup, "ohne Dublette keine Gruppenkennung").toBeNull();
    });

    it("🔴 keine Zehnergrenze: ein elftes und zwölftes Bild gehen hinein (Betreiber 2026-10-12, „Grenze 10 entfällt“)", async () => {
        const angelegt = (await ok(MEDIA_GALLERY_CREATE_URL, { title: "Viele Bilder" })).affected.find(
            (eintrag) => eintrag.kind === "gallery",
        )!;
        let stand = angelegt.revision!;
        for (let n = 0; n < 12; n += 1) {
            const bild = await insertAsset(database, { ref: `galerie-viele-${String(n)}` });
            const quittung = await ok(MEDIA_GALLERY_ADD_URL, {
                galleryId: angelegt.id,
                baseRevision: stand,
                assetId: bild.publicId,
            });
            stand = quittung.affected.find((eintrag) => eintrag.kind === "gallery")!.revision!;
        }
        const [zahl] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_gallery_item i JOIN media_gallery g ON g.id = i.gallery_id
             WHERE g.public_id = ${angelegt.id}::uuid AND i.retired_at IS NULL
        `;
        expect(zahl?.n).toBe(12);
    });

    it("eine Galerie, die es nicht gibt, ist 404", async () => {
        const { status } = await post(MEDIA_GALLERY_TITLE_URL, {
            galleryId: "00000000-0000-4000-8000-000000000999",
            baseRevision: 1,
            title: "Nichts",
        });
        expect(status).toBe(404);
    });

    describe("Galerie entfernen (R3 „Entfernen/Retire“, Paket „was beim Bedienen nicht geht“)", () => {
        const detail = async (id: string): Promise<{ status: number; body: MediaGalleryDetail }> => {
            const antwort = await app.inject({
                method: "GET",
                url: mediaEditorGalleryUrl(id),
                headers: { origin: TEST_ORIGIN, cookie },
            });
            return { status: antwort.statusCode, body: antwort.json() as MediaGalleryDetail };
        };
        const neueGalerie = async (titel: string, mitBild = true): Promise<{ id: string; revision: number }> => {
            const angelegt = (await ok(MEDIA_GALLERY_CREATE_URL, { title: titel })).affected.find(
                (eintrag) => eintrag.kind === "gallery",
            )!;
            if (!mitBild) return { id: angelegt.id, revision: angelegt.revision! };
            const mit = await ok(MEDIA_GALLERY_ADD_URL, {
                galleryId: angelegt.id,
                baseRevision: angelegt.revision,
                assetId: bilder[2],
            });
            return { id: angelegt.id, revision: mit.affected.find((eintrag) => eintrag.kind === "gallery")!.revision! };
        };
        const grund = (body: unknown): string | undefined =>
            (body as { error?: { details?: { reason?: string } } }).error?.details?.reason;

        it("🔴 eine eigene Galerie ohne Ort: entfernt, die Bilder bleiben, das Fachprotokoll nennt sie", async () => {
            const g = await neueGalerie("Zum Entfernen");
            const vorher = await detail(g.id);
            expect(vorher.body).toMatchObject({ fromLegacy: false, createdBy: { id: people[0]!.id } });
            const quittung = await ok(MEDIA_GALLERY_DELETE_URL, { galleryId: g.id, baseRevision: g.revision });
            expect(quittung.affected).toEqual([{ kind: "gallery", id: g.id }]);
            expect((await detail(g.id)).status, "die Galerie gibt es nicht mehr").toBe(404);
            const [bild] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${bilder[2]!}::uuid
            `;
            expect(bild?.n, "das Bild bleibt").toBe(1);
            const [zeile] = await database<{ details: unknown }[]>`
                SELECT details FROM media_audit_event WHERE media_gallery_public_id = ${g.id}::uuid AND action = 'gallery.deleted'
            `;
            expect(zeile?.details).toEqual({ items: 1 });
        });

        it("🔴 hängt sie an einem Ort, ist 409 bound; vom Ort gelöst geht es, auch mit Verlauf der Bindung", async () => {
            const g = await neueGalerie("Am Ort");
            const gebunden = await ok(MEDIA_GALLERY_BIND_URL, {
                galleryId: g.id,
                baseRevision: g.revision,
                placeId: ortB,
            });
            const rev = gebunden.affected.find((eintrag) => eintrag.kind === "gallery")!.revision!;
            const abgewiesen = await post(MEDIA_GALLERY_DELETE_URL, { galleryId: g.id, baseRevision: rev });
            expect([abgewiesen.status, fehler(abgewiesen.body), grund(abgewiesen.body)]).toEqual([
                409,
                "media_not_deletable",
                "bound",
            ]);
            const geloest = await ok(MEDIA_GALLERY_UNBIND_URL, { galleryId: g.id, baseRevision: rev, placeId: ortB });
            const rev2 = geloest.affected.find((eintrag) => eintrag.kind === "gallery")!.revision!;
            await ok(MEDIA_GALLERY_DELETE_URL, { galleryId: g.id, baseRevision: rev2 });
            expect((await detail(g.id)).status).toBe(404);
        });

        it("🔴 eine Galerie aus Legacy ist 409 legacy (der nächste Import legte sie wieder an)", async () => {
            const legacy = await insertGallery(database, "entfernen-legacy");
            const [zeile] = await database<{ revision: number }[]>`
                SELECT revision::int AS revision FROM media_gallery WHERE public_id = ${legacy.publicId}::uuid
            `;
            expect((await detail(legacy.publicId)).body.fromLegacy).toBe(true);
            const abgewiesen = await post(MEDIA_GALLERY_DELETE_URL, {
                galleryId: legacy.publicId,
                baseRevision: zeile!.revision,
            });
            expect([abgewiesen.status, grund(abgewiesen.body)]).toEqual([409, "legacy"]);
        });

        it("🔴 eine Galerie, die jemand anderes angelegt hat, ist 409 foreign; ein veralteter Stand 409 edit_conflict", async () => {
            const g = await neueGalerie("Fremd", false);
            const andere = await fixture.person("editor", { name: "Andere Redakteurin" });
            people.push(andere);
            const eigenerCookie = cookie;
            cookie = (await fixture.session(andere.id, { passkeyMinutesAgo: 1 })).cookie;
            try {
                const fremd = await post(MEDIA_GALLERY_DELETE_URL, { galleryId: g.id, baseRevision: g.revision });
                expect([fremd.status, grund(fremd.body)]).toEqual([409, "foreign"]);
            } finally {
                cookie = eigenerCookie;
            }
            const alt = await post(MEDIA_GALLERY_DELETE_URL, { galleryId: g.id, baseRevision: g.revision + 5 });
            expect([alt.status, fehler(alt.body)]).toEqual([409, "edit_conflict"]);
            await ok(MEDIA_GALLERY_DELETE_URL, { galleryId: g.id, baseRevision: g.revision });
        });
    });
});
