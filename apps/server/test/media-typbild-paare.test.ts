import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_EDITOR_NAVIGATION_URL,
    MEDIA_TYPE_IMAGE_RELEASE_URL,
    MEDIA_TYPE_IMAGE_SET_URL,
    MEDIA_TYPE_IMAGES_ADOPT_URL,
    MEDIA_TYPE_IMAGES_PUBLIC_URL,
    MEDIA_TYPE_IMAGES_URL,
    MEDIA_UPLOAD_URL,
    type MamNavigation,
    type MamTypeImage,
    type MamTypeImageList,
    type MediaCreationMethod,
    type MediaTypeImagesPublic,
    type MediaTypeImageVariant,
    type MediaUploadForm,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore } from "../src/media/storage.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { usageOf } from "../src/media-editor/usage.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

/**
 * Typbildpaare KI und ohne KI (WI-0281, Betreiber 2026-11-05, Migration 0314), gegen echtes PostgreSQL/PostGIS.
 *
 * Abnahme des Betreibers: „für ‚Kleinstadt‘ ein KI-Typbild und ein Ohne-KI-Typbild unabhängig voneinander auswählen“; der Modus „Ohne KI“ zeigt nur
 * das Nicht-KI-Typbild, der Normalmodus das KI-Typbild. Hier: Setzen je Variante mit eigener Revision, die Entstehung entscheidet die Variante, die
 * öffentliche Karte je Modus (nur KI, nur ohne KI, beide, keines, nicht freigegeben, umgetragene Entstehung, Nennung), Übernehmen nur in die
 * KI-Variante, Verwendungen und Navigation, die Zuordnung der Migration und der Index je Kategorie und Variante. Die Oberfläche prüfen
 * `apps/web/test/typbilder-quelle.test.ts`, `apps/web/test/bildbezug.test.ts` und `apps/web/test/info-header-typbild.test.ts`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MIGRATION_0314 = fileURLToPath(new URL("../migrations/0314_typbild_variante.sql", import.meta.url));

describeWithDatabase("Typbildpaare KI und ohne KI (WI-0281, Migration 0314)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let quelle = "";
    let fixture: ReturnType<typeof authFixture>;
    let store: MediaStore;
    const people: TestPerson[] = [];
    const cookies: string[] = [];
    let ruleId = "";
    let seed = 60;

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });
    const send = (method: "GET" | "POST", url: string, payload?: unknown) =>
        app.inject({
            method,
            url,
            ...(payload === undefined ? {} : { payload: payload as object }),
            headers: { origin: TEST_ORIGIN, cookie: cookies[0] ?? "" },
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const liste = async (): Promise<MamTypeImageList> => (await send("GET", MEDIA_TYPE_IMAGES_URL)).json();
    const eintrag = async (category: string): Promise<MamTypeImage> =>
        (await liste()).items.find((item) => item.category === category)!;
    const oeffentlich = async (): Promise<MediaTypeImagesPublic> =>
        (await send("GET", MEDIA_TYPE_IMAGES_PUBLIC_URL)).json() as MediaTypeImagesPublic;

    /** Ein Bild hochladen: Entstehung und Rechte wie angegeben; liefert die öffentliche Kennung. */
    async function hochladen(
        title: string,
        creationMethod: MediaCreationMethod,
        rights: MediaUploadForm["rights"] = { basis: "own_work", creator: "Zeichnerin Alrike" },
    ): Promise<string> {
        seed += 1;
        const antwort = await send("POST", MEDIA_UPLOAD_URL, {
            operationId: operation(),
            file: file(await pngBytes(seed, 160, 90), "typbild.png"),
            form: uploadForm({ title, role: "header", creationMethod, rights }),
        });
        expect(code(antwort), title).toBe("200");
        return (antwort.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;
    }

    /** Den ★ einer Variante setzen; `baseRevision` aus der Liste, ohne bisherigen ★ keine. */
    async function setze(category: string, variant: MediaTypeImageVariant | undefined, assetId: string) {
        const zeile = await eintrag(category);
        const slot = variant === "ohne_ki" ? zeile.ohneKi!.current : zeile.current;
        return send("POST", MEDIA_TYPE_IMAGE_SET_URL, {
            operationId: operation(),
            category,
            assetId,
            ...(slot === null ? {} : { baseRevision: slot.revision }),
            ...(variant === undefined ? {} : { variant }),
        });
    }

    /** Die Rechte als geprüft eintragen (die Prüfung selbst prüfen andere Tests); dann rechnet der Abgleich die öffentliche Datei. */
    async function freigeben(assetId: string): Promise<void> {
        await database`
            UPDATE media_rights SET clearance_state = 'cleared'
             WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
        `;
        await rechne(assetId);
    }
    const rechne = (assetId: string) => settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        await database`DELETE FROM media_type_image`;
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-typbildpaare-"));
        store = new MediaStore(mediaRoot);
        // Eine eingebaute Grafik (Dorf): Übernehmen legt sie nur in die KI-Variante.
        quelle = join(mediaRoot, "..", `typbildpaare-quelle-${String(Date.now())}`);
        await mkdir(quelle, { recursive: true });
        await writeFile(
            join(quelle, "dorf.webp"),
            await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 90, g: 120, b: 80 } } })
                .webp()
                .toBuffer(),
        );
        process.env["TYPE_IMAGE_SOURCE_DIR"] = quelle;
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Typbildpaar Redakteurin" });
        people.push(person);
        cookies.push((await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        // Die KI-Regel der Kopfbilder (eigenes Werk, KI-erzeugt), wie sie im Bestand gilt: KI-Typbilder sind ohne Prüfung öffentlich.
        const [rule] = await database<{ id: string }[]>`
            INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
            VALUES ('own_work', 'ai_generated', 'header', 'media-test Typbildpaare KI-Regel', 'Testzitat', '2026-10-11')
            RETURNING id::text AS id
        `;
        ruleId = rule!.id;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        delete process.env["TYPE_IMAGE_SOURCE_DIR"];
        if (ruleId !== "") await database`DELETE FROM publication_rule WHERE id = ${ruleId}::bigint`;
        await database`DELETE FROM media_type_image`;
        await cleanEditorMedia(
            database,
            people.map((person) => person.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
        if (quelle !== "") await rm(quelle, { recursive: true, force: true });
    });

    it("🔴 Kleinstadt: KI- und Ohne-KI-Typbild unabhängig wählen, je mit eigenem ★, eigener Revision und eigenem Verlauf", async () => {
        const ki = await hochladen("Kleinstadt KI", "ai_generated");
        const gezeichnet = await hochladen("Kleinstadt gezeichnet", "drawing");
        const leer = await eintrag("kleinstadt");
        expect(leer.current).toBeNull();
        expect(leer.ohneKi).toEqual({ current: null, former: 0, formerItems: [] });

        expect(code(await setze("kleinstadt", "ohne_ki", gezeichnet))).toBe("200");
        // Die KI-Variante bleibt leer: Die Ohne-KI-Variante ist eine eigene Zuordnung.
        let zeile = await eintrag("kleinstadt");
        expect(zeile.current).toBeNull();
        expect(zeile.ohneKi!.current).toMatchObject({ assetId: gezeichnet, creationMethod: "drawing" });

        // Ohne Angabe der Variante (Vorversion) gilt die KI-Variante, mit ihrer eigenen Revision: Der Stand der anderen ist keiner.
        expect(code(await setze("kleinstadt", undefined, ki))).toBe("200");
        zeile = await eintrag("kleinstadt");
        expect(zeile.current).toMatchObject({ assetId: ki, creationMethod: "ai_generated" });
        expect(zeile.ohneKi!.current!.assetId).toBe(gezeichnet);
        const kiStand = zeile.current!.revision;
        const ohneStand = zeile.ohneKi!.current!.revision;
        expect(kiStand).not.toBe(ohneStand);
        const mitStand = (variant: MediaTypeImageVariant, assetId: string, baseRevision: number) =>
            send("POST", MEDIA_TYPE_IMAGE_SET_URL, {
                operationId: operation(),
                category: "kleinstadt",
                assetId,
                baseRevision,
                variant,
            });
        const zweitesKi = await hochladen("Kleinstadt KI zwei", "ai_generated");
        expect(code(await mitStand("ki", zweitesKi, ohneStand)), "die Revision der anderen Variante").toBe(
            "409 edit_conflict",
        );
        expect(code(await mitStand("ki", zweitesKi, kiStand))).toBe("200");
        zeile = await eintrag("kleinstadt");
        // Der Wechsel der KI-Variante lässt die Ohne-KI-Variante stehen; der Verlauf gehört der Variante.
        expect(zeile.current!.assetId).toBe(zweitesKi);
        expect(zeile.former).toBe(1);
        expect(zeile.formerItems.map((alt) => alt.assetId)).toEqual([ki]);
        expect(zeile.ohneKi).toMatchObject({ former: 0, formerItems: [] });
        expect(zeile.ohneKi!.current).toMatchObject({ assetId: gezeichnet, revision: ohneStand });

        // Die Datenbank hält zwei aktive Zeilen der Kategorie, eine je Variante.
        const aktiv = await database<{ variant: string }[]>`
            SELECT variant FROM media_type_image WHERE category = 'kleinstadt' AND retired_at IS NULL ORDER BY variant
        `;
        expect(aktiv.map((row) => row.variant)).toEqual(["ki", "ohne_ki"]);
        // Die Verwendung nennt die Variante (Inspector „Verwendungen“).
        expect((await usageOf(database, gezeichnet))?.usages).toEqual([
            expect.objectContaining({
                via: "type_image",
                typeImage: { category: "kleinstadt", label: "Kleinstadt", variant: "ohne_ki" },
            }),
        ]);
        // Die Navigation zählt Kategorien, nicht Zeilen: Kleinstadt mit zwei ★ ist eine.
        const navigation = (await send("GET", MEDIA_EDITOR_NAVIGATION_URL)).json() as MamNavigation;
        expect(navigation.typeImages).toBe(1);
    });

    it("🔴 die Entstehung entscheidet die Variante: ohne KI nur Foto, Zeichnung, Scan; unbekannte Herkunft gilt nie als ohne KI", async () => {
        const kiBild = await hochladen("Stadt KI", "ai_generated");
        const unbekannt = await hochladen("Stadt unbekannt", "unknown");
        const abgeleitet = await hochladen("Stadt abgeleitet", "derived");
        const foto = await hochladen("Stadt Foto", "photo");
        const scan = await hochladen("Stadt Scan", "scan");
        for (const [assetId, name] of [
            [kiBild, "KI-generiert"],
            [unbekannt, "unbekannt"],
            [abgeleitet, "abgeleitet"],
        ] as const) {
            expect(code(await setze("stadt", "ohne_ki", assetId)), name).toBe("409 type_image_variant_mismatch");
        }
        // Und umgekehrt: Ein Foto ist kein KI-Typbild. So steht dasselbe Asset nie in beiden Varianten.
        expect(code(await setze("stadt", "ki", foto))).toBe("409 type_image_variant_mismatch");
        // Unbekannt darf in die KI-Variante (sie ist die reguläre), dort sagt es der Inspector.
        expect(code(await setze("stadt", "ki", unbekannt))).toBe("200");
        expect(code(await setze("stadt", "ohne_ki", foto))).toBe("200");
        expect(code(await setze("stadt", "ohne_ki", scan))).toBe("200");
        const zeile = await eintrag("stadt");
        expect(zeile.current).toMatchObject({ assetId: unbekannt, creationMethod: "unknown" });
        expect(zeile.ohneKi!.current).toMatchObject({ assetId: scan, creationMethod: "scan" });
        expect(zeile.ohneKi!.formerItems.map((alt) => alt.assetId)).toEqual([foto]);
    });

    it("🔴 öffentlich je Modus: Normalmodus KI vor ohne KI, „Ohne KI“ nur ohne KI; nicht Freigegebenes und umgetragene Entstehung fehlen", async () => {
        // Kleinstadt: beide Varianten. Das KI-Bild trägt die KI-Regel, die Zeichnung erst nach der Prüfung.
        const kleinstadt = await eintrag("kleinstadt");
        await rechne(kleinstadt.current!.assetId);
        await freigeben(kleinstadt.ohneKi!.current!.assetId);
        // Fluss: nur eine Ohne-KI-Variante; Krater: nur eine KI-Variante; Grotte: eine Ohne-KI-Variante ohne Prüfung.
        const fluss = await hochladen("Fluss gemalt", "drawing");
        expect(code(await setze("fluss", "ohne_ki", fluss))).toBe("200");
        await freigeben(fluss);
        const krater = await hochladen("Krater KI", "ai_generated");
        expect(code(await setze("krater", "ki", krater))).toBe("200");
        await rechne(krater);
        const grotte = await hochladen("Grotte gezeichnet, ungeprüft", "drawing");
        expect(code(await setze("grotte", "ohne_ki", grotte))).toBe("200");
        await rechne(grotte);

        const karte = await oeffentlich();
        const adresse = async (assetId: string): Promise<string> => {
            const [row] = await database<{ sha256: string }[]>`
                SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
                 WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'published' LIMIT 1
            `;
            return row!.sha256;
        };
        // Beide: der Normalmodus nimmt die KI-Variante, „Ohne KI“ die Zeichnung.
        expect(karte.images["kleinstadt"]!.url).toContain(await adresse(kleinstadt.current!.assetId));
        expect(karte.ohneKi!["kleinstadt"]!.url).toContain(await adresse(kleinstadt.ohneKi!.current!.assetId));
        // Nur ohne KI: der Normalmodus fällt auf sie zurück.
        expect(karte.images["fluss"]!.url).toContain(await adresse(fluss));
        expect(karte.ohneKi!["fluss"]!.url).toBe(karte.images["fluss"]!.url);
        // 🔴 Nur KI: „Ohne KI“ kennt die Kategorie nicht (Platzhalter), nie die KI-Variante.
        expect(karte.images["krater"]).toBeDefined();
        expect(karte.ohneKi!["krater"]).toBeUndefined();
        // Nicht freigegeben: in keinem Modus, und die Liste sagt es.
        expect(karte.images["grotte"]).toBeUndefined();
        expect(karte.ohneKi!["grotte"]).toBeUndefined();
        expect((await eintrag("grotte")).ohneKi!.current!.public).toBe(false);
        // Keine Variante: Die Kategorie fehlt in beiden Karten (das Infopanel zeigt die eingebaute Grafik bzw. den Platzhalter).
        expect(karte.images["wueste"]).toBeUndefined();
        expect(karte.ohneKi!["wueste"]).toBeUndefined();
        const zeile = await eintrag("kleinstadt");
        expect([zeile.current!.public, zeile.ohneKi!.current!.public]).toEqual([true, true]);

        // 🔴 Trägt jemand die Zeichnung auf „KI-generiert“ um, zählt sie nicht mehr als Ohne-KI-Variante: nie im Modus „Ohne KI“, und der Normalmodus
        // fällt dann auf die eingebaute Grafik zurück (EINE Regel: die Ohne-KI-Variante gilt nur, solange ihre Entstehung ohne KI eingetragen ist).
        await database`
            UPDATE media_asset SET creation_method = 'ai_generated' WHERE public_id = ${fluss}::uuid
        `;
        const danach = await oeffentlich();
        expect(danach.ohneKi!["fluss"]).toBeUndefined();
        expect(danach.images["fluss"]).toBeUndefined();
        expect((await eintrag("fluss")).ohneKi!.current).toMatchObject({
            public: false,
            creationMethod: "ai_generated",
        });
        await database`UPDATE media_asset SET creation_method = 'drawing' WHERE public_id = ${fluss}::uuid`;
    });

    it("🔴 ein Foto unter CC BY: die Nennung kommt mit, in beiden Karten, und sonst nichts vom Asset", async () => {
        const foto = await hochladen("Küste fotografiert", "photo", {
            basis: "license",
            licenseKey: "cc-by-4.0",
            creator: "Fotografin Rahja",
            attribution: "Foto: Rahja, CC BY 4.0",
        });
        expect(code(await setze("kueste", "ohne_ki", foto))).toBe("200");
        // Die Freigabe eines Editors trägt auch eine Lizenz mit Nennung (WI-0282).
        await freigeben(foto);
        const karte = await oeffentlich();
        const eintragKueste = karte.ohneKi!["kueste"];
        expect(eintragKueste, "ein geprüftes Foto unter CC BY ist öffentlich").toBeDefined();
        expect(eintragKueste!.credit).toMatchObject({ creator: "Fotografin Rahja" });
        expect(karte.images["kueste"]).toEqual(eintragKueste);
        expect(Object.keys(eintragKueste!).sort()).toEqual(["credit", "height", "url", "width"]);
        expect(JSON.stringify(karte)).not.toContain(foto);
    });

    it("🔴 eingebaute Grafiken übernehmen füllt nur die KI-Variante; eine Ohne-KI-Variante bleibt, wie sie ist", async () => {
        const gezeichnet = await hochladen("Dorf gezeichnet", "drawing");
        expect(code(await setze("dorf", "ohne_ki", gezeichnet))).toBe("200");
        const vorher = await liste();
        // Dorf hat keine KI-Variante: Es zählt zu dem, was übernommen werden kann.
        expect(vorher.adoptable).toBe(vorher.items.filter((item) => item.current === null).length);
        expect(vorher.items.find((item) => item.category === "dorf")!.current).toBeNull();
        const antwort = await send("POST", MEDIA_TYPE_IMAGES_ADOPT_URL, { operationId: operation() });
        expect(code(antwort)).toBe("200");
        expect((antwort.json() as OperationReceipt).affected.map((entry) => entry.id)).toEqual(["dorf"]);
        const dorf = await eintrag("dorf");
        expect(dorf.current).toMatchObject({ title: "Typbild Dorf", creationMethod: "ai_generated" });
        expect(dorf.ohneKi!.current!.assetId).toBe(gezeichnet);
    });

    it("🔴 die Datenbank hält einen ★ je Kategorie UND Variante; eine zweite Variante ist erlaubt, ein zweiter ★ derselben nicht", async () => {
        const [asset] = await database<{ id: string }[]>`
            SELECT a.id::text AS id FROM media_asset a JOIN media_type_image t ON t.media_asset_id = a.id
             WHERE t.category = 'kleinstadt' AND t.variant = 'ohne_ki' AND t.retired_at IS NULL
        `;
        const zweiter = await database`
            INSERT INTO media_type_image (category, variant, media_asset_id) VALUES ('kleinstadt', 'ohne_ki', ${asset!.id}::bigint)
        `.then(
            () => "eingefügt",
            (error: unknown) => (error as { code?: string }).code,
        );
        expect(zweiter).toBe("23505");
        const unbekannt = await database`
            INSERT INTO media_type_image (category, variant, media_asset_id) VALUES ('see', 'halb', ${asset!.id}::bigint)
        `.then(
            () => "eingefügt",
            (error: unknown) => (error as { code?: string }).code,
        );
        expect(unbekannt, "nur ki und ohne_ki").toBe("23514");
    });

    it("🔴 die Migration ordnet nach der Entstehung zu: nur Foto, Zeichnung, Scan werden ohne KI, alles andere bleibt KI", async () => {
        const sql = await readFile(MIGRATION_0314, "utf8");
        const update = /UPDATE media_type_image t[\s\S]*?;/.exec(sql)?.[0];
        expect(update, "die Zuordnung steht in 0314").toBeDefined();
        const arten: MediaCreationMethod[] = ["ai_generated", "unknown", "derived", "photo", "drawing", "scan"];
        const ergebnis = await database
            .begin(async (tx) => {
                await tx`DELETE FROM media_type_image`;
                const kategorien = ["see", "wald", "meer", "riff", "tundra", "steppe"];
                for (const [stelle, art] of arten.entries()) {
                    const [neu] = await tx<{ id: string }[]>`
                        INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system, title)
                        VALUES ('image', 'picture', 'editor_upload', ${art}, 'ok', 'not_applicable', 'media-test', ${`Migration ${art}`})
                        RETURNING id::text AS id
                    `;
                    // Wie vor 0314: ohne Angabe der Variante, je Kategorie eine Zeile; dazu je eine frühere.
                    await tx`
                        INSERT INTO media_type_image (category, media_asset_id) VALUES (${kategorien[stelle]!}, ${neu!.id}::bigint)
                    `;
                    await tx`
                        INSERT INTO media_type_image (category, media_asset_id, retired_at)
                        VALUES (${kategorien[stelle]!}, ${neu!.id}::bigint, now())
                    `;
                }
                await tx.unsafe(update!);
                const rows = await tx<{ art: string; variant: string; aktiv: boolean }[]>`
                    SELECT a.creation_method AS art, t.variant, t.retired_at IS NULL AS aktiv
                      FROM media_type_image t JOIN media_asset a ON a.id = t.media_asset_id
                     ORDER BY a.creation_method, aktiv
                `;
                throw Object.assign(new Error("zurückrollen"), { rows });
            })
            .catch((error: { rows?: { art: string; variant: string; aktiv: boolean }[] }) => error.rows);
        const variante = new Map(ergebnis!.map((row) => [`${row.art}:${String(row.aktiv)}`, row.variant]));
        for (const art of arten) {
            const erwartet = ["photo", "drawing", "scan"].includes(art) ? "ohne_ki" : "ki";
            expect(variante.get(`${art}:true`), `${art} aktiv`).toBe(erwartet);
            expect(variante.get(`${art}:false`), `${art} früher`).toBe(erwartet);
        }
        // Zurückgerollt: der Stand der übrigen Tests ist unberührt.
        expect((await eintrag("kleinstadt")).ohneKi!.current).not.toBeNull();
    });

    it("🔴 eine Variante lösen: ohne neues Bild, das Asset bleibt im Verlauf, „Ohne KI“ ist danach grau; veralteter Stand 409", async () => {
        const vorher = await eintrag("kleinstadt");
        const ohne = vorher.ohneKi!.current!;
        const loese = (variant: MediaTypeImageVariant, baseRevision: number) =>
            send("POST", MEDIA_TYPE_IMAGE_RELEASE_URL, {
                operationId: operation(),
                category: "kleinstadt",
                variant,
                baseRevision,
            });
        expect(code(await loese("ohne_ki", ohne.revision + 99)), "veralteter Stand").toBe("409 edit_conflict");
        expect(code(await loese("ohne_ki", ohne.revision))).toBe("200");
        const danach = await eintrag("kleinstadt");
        expect(danach.ohneKi!.current).toBeNull();
        expect(danach.ohneKi!.former).toBe(vorher.ohneKi!.former + 1);
        expect(danach.ohneKi!.formerItems[0]!.assetId).toBe(ohne.assetId);
        // Die KI-Variante bleibt, wie sie war.
        expect(danach.current).toEqual(vorher.current);
        // Öffentlich: „Ohne KI“ kennt Kleinstadt nicht mehr (graue Fläche), der Normalmodus zeigt weiter die KI-Variante.
        const karte = await oeffentlich();
        expect(karte.ohneKi!["kleinstadt"]).toBeUndefined();
        expect(karte.images["kleinstadt"]).toBeDefined();
        // Das Asset bleibt, nur seine Verwendung als Typbild ist weg.
        const [asset] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${ohne.assetId}::uuid
        `;
        expect(asset!.n).toBe(1);
        expect((await usageOf(database, ohne.assetId))?.usages).toEqual([]);
        // Schon leer: Ein zweites Lösen ist ein Konflikt, kein stilles Gelingen.
        expect(code(await loese("ohne_ki", ohne.revision))).toBe("409 edit_conflict");
        // Das Fachprotokoll nennt Kategorie und Variante.
        const [protokoll] = await database<{ details: Record<string, unknown> }[]>`
            SELECT details FROM media_audit_event
             WHERE media_asset_public_id = ${ohne.assetId}::uuid AND action = 'binding.type_image_released'
             ORDER BY id DESC LIMIT 1
        `;
        expect(protokoll!.details).toMatchObject({ category: "kleinstadt", variant: "ohne_ki" });
    });
});
