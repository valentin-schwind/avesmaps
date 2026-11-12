import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    BUILTIN_TYPE_IMAGE_RIGHTS_QUOTE,
    HEADER_GRAPHICS,
    MEDIA_TYPE_IMAGE_SET_URL,
    MEDIA_TYPE_IMAGES_ADOPT_URL,
    MEDIA_TYPE_IMAGES_PUBLIC_URL,
    MEDIA_TYPE_IMAGES_URL,
    MEDIA_EDITOR_NAVIGATION_URL,
    MEDIA_UPLOAD_URL,
    type MamNavigation,
    type MamSearchResult,
    type MamTypeImageList,
    type MediaTypeImagesPublic,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore } from "../src/media/storage.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { typeImageList } from "../src/media-editor/type-images.ts";
import { usageOf } from "../src/media-editor/usage.ts";
import { assetPublishes, readUsages } from "../src/migration/media-publication.ts";
import { readPublicationRules } from "../src/media/rules.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Eine kleine 16:9-Kopfgrafik als WebP (wie die eingebauten unter icons/header). */
const kopfgrafik = (farbe: number): Promise<Buffer> =>
    sharp({ create: { width: 160, height: 90, channels: 3, background: { r: farbe, g: 120, b: 80 } } })
        .webp()
        .toBuffer();

describeWithDatabase("Typbilder (WI-0068, Migration 0113)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let quelle = "";
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    const cookies: string[] = [];
    let ruleId = "";

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });
    const send = (method: "GET" | "POST", url: string, payload?: unknown, wer = 0) =>
        app.inject({
            method,
            url,
            ...(payload === undefined ? {} : { payload: payload as object }),
            headers: { origin: TEST_ORIGIN, cookie: cookies[wer] ?? "" },
        });
    const liste = async (): Promise<MamTypeImageList> => (await send("GET", MEDIA_TYPE_IMAGES_URL)).json();
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-typbilder-"));
        // Die eingebauten Grafiken: zwei der Kategorien (Dorf, Wald) liegen vor, die übrigen fehlen hier.
        quelle = join(mediaRoot, "..", `typbilder-quelle-${String(Date.now())}`);
        await mkdir(quelle, { recursive: true });
        await writeFile(join(quelle, "dorf.webp"), await kopfgrafik(200));
        await writeFile(join(quelle, "wald.webp"), await kopfgrafik(40));
        process.env["TYPE_IMAGE_SOURCE_DIR"] = quelle;
        fixture = authFixture(database);
        for (const name of ["Typbild Betreiberin", "Typbild Redakteur"]) {
            const person = await fixture.person("editor", { name });
            people.push(person);
            cookies.push((await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        // Die KI-Regel der Kopfbilder (eigenes Werk, KI-erzeugt), wie sie im Bestand gilt.
        const [rule] = await database<{ id: string }[]>`
            INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
            VALUES ('own_work', 'ai_generated', 'header', 'media-test Typbilder KI-Regel', 'Testzitat', '2026-10-11')
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

    it("🔴 die Liste: jede Kategorie, Zahlen je Objektart, ohne ★ die eingebaute Grafik; übernehmen legt nur an, was fehlt", async () => {
        const vorher = await liste();
        expect(vorher.items.map((item) => item.category)).toEqual([...HEADER_GRAPHICS]);
        expect(vorher.items.find((item) => item.category === "dorf")).toMatchObject({
            label: "Dorf",
            objects: "place",
            current: null,
            former: 0,
        });
        expect(typeof vorher.items.find((item) => item.category === "dorf")!.count).toBe("number");
        // Frueher `null` (Luecke L1 der Typbildmatrix): die Kategorie zaehlt jetzt ihre Kraftlinien.
        expect(vorher.items.find((item) => item.category === "kraftlinien")!.count).toBeGreaterThanOrEqual(0);
        // Die Zahl kommt aus dem Vertrag, nicht aus einer Zahl im Test: eine neue Kategorie (2026-10-13 „Gebiet“) zählt mit.
        expect(vorher.adoptable).toBe(HEADER_GRAPHICS.length);
        // Noch kein ★: Die Navigation zählt 0 Typbilder (Spalte 1 der Medienverwaltung).
        const navVorher = (await send("GET", MEDIA_EDITOR_NAVIGATION_URL)).json() as MamNavigation;
        expect(navVorher.typeImages).toBe(0);

        const ohneRecht = await send("POST", MEDIA_TYPE_IMAGES_URL + "/adopt", { operationId: operation() }, 99);
        expect(ohneRecht.statusCode).toBe(401);
        const uebernommen = await send("POST", MEDIA_TYPE_IMAGES_ADOPT_URL, { operationId: operation() });
        expect(code(uebernommen)).toBe("200");
        const quittung = uebernommen.json() as OperationReceipt;
        expect(quittung.affected.map((entry) => entry.id).sort()).toEqual(["dorf", "wald"]);
        expect(quittung.derivedWork).toHaveLength(2);

        const nachher = await liste();
        const dorf = nachher.items.find((item) => item.category === "dorf")!;
        expect(dorf.current).toMatchObject({ title: "Typbild Dorf", public: false });
        expect(nachher.adoptable).toBe(HEADER_GRAPHICS.length - 2);
        // Die Navigation zählt die Kategorien MIT ★, nicht die Größe der Liste.
        const navNachher = (await send("GET", MEDIA_EDITOR_NAVIGATION_URL)).json() as MamNavigation;
        expect(navNachher.typeImages).toBe(2);
        // Rechte: eigenes Werk, KI-erzeugt, das Zitat des Betreibers als Beleg; kein erfundener Prüfstand.
        const [rechte] = await database<
            { basis: string; clearance: string; creation: string; origin: string; beleg: string }[]
        >`
            SELECT r.rights_basis AS basis, r.clearance_state AS clearance, a.creation_method AS creation, a.origin,
                   e.description AS beleg
              FROM media_asset a JOIN media_rights r ON r.media_asset_id = a.id
              JOIN media_rights_evidence e ON e.media_asset_id = a.id
             WHERE a.public_id = ${dorf.current!.assetId}::uuid
        `;
        expect(rechte).toMatchObject({
            basis: "own_work",
            clearance: "unreviewed",
            creation: "ai_generated",
            origin: "project_generated",
        });
        expect(rechte!.beleg).toContain(`„${BUILTIN_TYPE_IMAGE_RIGHTS_QUOTE}“`);

        // Der Abgleich rechnet die öffentliche Datei: Die KI-Regel der Kopfbilder trägt das Typbild (Verwendung der Rolle header).
        const store = new MediaStore(mediaRoot);
        const settled = await settleAssetFiles(database, store, {
            assetPublicId: dorf.current!.assetId,
            role: "header",
        });
        expect(settled).toMatchObject({ technicalState: "ok", published: true });
        const oeffentlich = (await send("GET", MEDIA_TYPE_IMAGES_PUBLIC_URL)).json() as MediaTypeImagesPublic;
        expect(Object.keys(oeffentlich.images)).toEqual(["dorf"]);
        expect(oeffentlich.images["dorf"]!.url).toMatch(/^\/media\/sha256\//);
        // R8 (Leckprüfung): Die öffentliche Antwort trägt je Kategorie nur Adresse und Maße, nichts vom Asset, nichts Privates.
        expect(Object.keys(oeffentlich.images["dorf"]!).sort()).toEqual(["height", "url", "width"]);
        const roh = JSON.stringify(oeffentlich);
        expect(roh).not.toContain(dorf.current!.assetId);
        expect(roh).not.toContain("private/");
        expect((await liste()).items.find((item) => item.category === "dorf")!.current!.public).toBe(true);

        // Ein zweiter Klick legt nichts an.
        const nochmal = await send("POST", MEDIA_TYPE_IMAGES_ADOPT_URL, { operationId: operation() });
        expect((nochmal.json() as OperationReceipt).affected).toEqual([]);
    });

    it("🔴 der ★ wandert: das alte Typbild bleibt als Asset und zählt als früheres; veraltet 409, Wappen 409, dasselbe 409", async () => {
        const dorf = (await liste()).items.find((item) => item.category === "dorf")!.current!;
        const neu = await send("POST", MEDIA_UPLOAD_URL, {
            operationId: operation(),
            file: file(await pngBytes(31, 160, 90)),
            // Die KI-Variante nimmt kein Bild, das als ohne KI eingetragen ist (WI-0281); die Vorgabe des Formulars ist eine Zeichnung.
            form: uploadForm({ title: "Ein anderes Dorf", role: "header", creationMethod: "ai_generated" }),
        });
        expect(code(neu)).toBe("200");
        const neuId = (neu.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;
        const wappen = await send("POST", MEDIA_UPLOAD_URL, {
            operationId: operation(),
            file: file(await pngBytes(32)),
            form: uploadForm({ title: "Ein Wappen", role: "coat" }),
        });
        const wappenId = (wappen.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;

        const setze = (assetId: string, baseRevision?: number) =>
            send("POST", MEDIA_TYPE_IMAGE_SET_URL, {
                operationId: operation(),
                category: "dorf",
                assetId,
                ...(baseRevision === undefined ? {} : { baseRevision }),
            });
        expect(code(await setze(wappenId, dorf.revision))).toBe("409 media_type_mismatch");
        expect(code(await setze(neuId))).toBe("409 edit_conflict");
        expect(code(await setze(dorf.assetId, dorf.revision))).toBe("409 media_already_bound");
        expect(code(await setze(neuId, dorf.revision))).toBe("200");

        const nachher = (await liste()).items.find((item) => item.category === "dorf")!;
        expect(nachher.current!.assetId).toBe(neuId);
        expect(nachher.former).toBe(1);
        // Der Verlauf nennt das abgelöste Asset samt Zeitpunkt (Inspector „Frühere Typbilder“), neueste zuerst.
        expect(nachher.formerItems).toHaveLength(1);
        expect(nachher.formerItems[0]!.assetId).toBe(dorf.assetId);
        expect(nachher.formerItems[0]!.title).toBe("Typbild Dorf");
        expect(Date.parse(nachher.formerItems[0]!.retiredAt)).toBeGreaterThan(0);
        // Eine Kategorie ohne Wechsel hat einen leeren Verlauf, kein `null`.
        expect((await liste()).items.find((item) => item.category === "stadt")!.formerItems).toEqual([]);
        const [alt] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${dorf.assetId}::uuid
        `;
        expect(alt!.n).toBe(1);
        // Das alte zählt nicht mehr als Verwendung, das neue ist eine Verwendung der Rolle header.
        const rules = await readPublicationRules(database);
        const [ids] = await database<{ alt: string; neu: string }[]>`
            SELECT (SELECT id::text FROM media_asset WHERE public_id = ${dorf.assetId}::uuid) AS alt,
                   (SELECT id::text FROM media_asset WHERE public_id = ${neuId}::uuid) AS neu
        `;
        const aktiv = async (id: string) => (await readUsages(database, id)).filter((usage) => !usage.retired);
        expect(await aktiv(ids!.alt)).toEqual([]);
        expect((await aktiv(ids!.neu)).map((usage) => usage.role)).toEqual(["header"]);
        // 🔴 S8-03: Reverse Usage nennt den ★ als Verwendung mit Kategorie; das abgelöste Asset hat keine mehr.
        expect((await usageOf(database, neuId))?.usages).toEqual([
            expect.objectContaining({
                via: "type_image",
                subject: null,
                role: "header",
                // Die Variante steht dabei (WI-0281); ein Wechsel ohne Angabe setzt die KI-Variante.
                typeImage: { category: "dorf", label: expect.any(String) as unknown as string, variant: "ki" },
            }),
        ]);
        expect((await usageOf(database, dorf.assetId))?.usages).toEqual([]);
        // … und die Liste zählt ihn: Das Typbild steht nicht unter „Unbenutzt“, das abgelöste schon.
        const unbenutzt = (
            (await send("GET", `${MEDIA_UPLOAD_URL}?basket=unused&q=Dorf&limit=200`)).json() as MamSearchResult
        ).items.map((item) => item.id);
        expect(unbenutzt).not.toContain(neuId);
        expect(unbenutzt).toContain(dorf.assetId);
        // Die Policy fragt die Verwendung wie bei jedem Kopfbild (hier: eigenes Werk ohne KI, keine Regel → privat).
        expect(
            assetPublishes(
                {
                    technicalState: "ok",
                    moderationState: "not_applicable",
                    creationMethod: "drawing",
                    basis: "own_work",
                    clearance: "unreviewed",
                    licenseKey: null,
                    requiresAttribution: null,
                },
                "header",
                await aktiv(ids!.neu),
                { mimeType: "image/webp" },
                rules,
            ).allowed,
        ).toBe(false);
    });

    /**
     * Lücke L1 der Typbildmatrix (`project-control/discovery/typbildabdeckung-matrix-2026-10-13.md`): Gezählt wurden nur `place`,
     * `region` und `path`. Gipfel, Gebiete, Klimabänder und Kraftlinien fehlten — und sie sind kein Randfall: „Berggipfel“ zeigte 0
     * trotz 240 Gipfeln, und die größte Kategorie „Region“ gar keine Zahl.
     */
    it("🔴 zwei gleichzeitige ★-Wechsel auf demselben Stand: genau einer gewinnt, der andere 409; nie zwei ★ (R8)", async () => {
        const vorher = (await liste()).items.find((item) => item.category === "dorf")!.current!;
        const hochladen = async (seed: number): Promise<string> => {
            const antwort = await send("POST", MEDIA_UPLOAD_URL, {
                operationId: operation(),
                file: file(await pngBytes(seed, 160, 90)),
                form: uploadForm({ title: `Wettlauf ${String(seed)}`, role: "header", creationMethod: "ai_generated" }),
            });
            expect(code(antwort)).toBe("200");
            return (antwort.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;
        };
        const [erstes, zweites] = [await hochladen(33), await hochladen(34)];
        const setze = (assetId: string) =>
            send("POST", MEDIA_TYPE_IMAGE_SET_URL, {
                operationId: operation(),
                category: "dorf",
                assetId,
                baseRevision: vorher.revision,
            });
        const antworten = (await Promise.all([setze(erstes), setze(zweites)])).map(code).sort();
        expect(antworten).toEqual(["200", "409 edit_conflict"]);
        const [aktiv] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_type_image WHERE category = 'dorf' AND retired_at IS NULL
        `;
        expect(aktiv!.n, "genau ein ★ in der Kategorie").toBe(1);
        // Die Datenbank hält es auch ohne die Operation: ein zweiter aktiver ★ derselben Variante verletzt `media_type_image_one_active_variant`
        // (0314, vorher `media_type_image_one_active` aus 0113); ohne Angabe ist es die KI-Variante.
        const fehler = await database`
            INSERT INTO media_type_image (category, media_asset_id)
            SELECT 'dorf', id FROM media_asset WHERE public_id = ${erstes}::uuid
        `.then(
            () => "eingefügt",
            (error: unknown) => (error as { code?: string }).code,
        );
        expect(fehler).toBe("23505");
    });

    it("🔴 die Zahl je Kategorie zählt ALLE Objekte, die sie zeigen - auch Gipfel, Gebiete, Klimabänder, Kraftlinien", async () => {
        const zahl = async (kategorie: string): Promise<number | null> =>
            (await typeImageList(database, "aventuria")).items.find((item) => item.category === kategorie)!.count;
        const vorher = {
            berggipfel: await zahl("berggipfel"),
            gebirge: await zahl("gebirge"),
            vulkan: await zahl("vulkan"),
            region: await zahl("region"),
            kraftlinien: await zahl("kraftlinien"),
        };
        const vorherMetropole = await zahl("metropole");
        const vorherGebiet = await zahl("gebiet");
        // Keine Kategorie ist mehr ohne Zahl: „Region“ und „Kraftlinien“ hatten vorher `null`.
        for (const [name, wert] of Object.entries(vorher)) expect(wert, name).not.toBeNull();

        const [gipfel] = await database<{ id: string }[]>`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (gen_random_uuid(), 'aventuria', 'L1T Gipfel', 'berggipfel',
                    ST_SetSRID(ST_MakePoint(710, 710), 0), 'test', TRUE)
            RETURNING id::text AS id
        `;
        const [vulkan] = await database<{ id: string }[]>`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (gen_random_uuid(), 'aventuria', 'L1T Vulkan', 'vulkan',
                    ST_SetSRID(ST_MakePoint(711, 711), 0), 'test', TRUE)
            RETURNING id::text AS id
        `;
        try {
            // Ein Berggipfel zählt bei „Berggipfel“, ein Vulkan seit WI-0271 L6 bei seinem eigenen Bild „Vulkan“ (vorher „Gebirge“) - wie `headerGraphicOf`
            // für `peak` entscheidet.
            expect(await zahl("berggipfel")).toBe(vorher.berggipfel! + 1);
            expect(await zahl("vulkan")).toBe(vorher.vulkan! + 1);
            expect(await zahl("gebirge")).toBe(vorher.gebirge);
        } finally {
            await database`DELETE FROM terrain_peak WHERE id = ANY(${[gipfel!.id, vulkan!.id]}::bigint[])`;
        }
        expect(await zahl("berggipfel")).toBe(vorher.berggipfel);

        /**
         * Lücke L3 der Typbildmatrix, BERICHTIGT durch diesen Test: Im Code fällt eine Ortsklasse ohne Kategorie auf „Metropole“
         * zurück (`headerGraphicOfPlace`, Legacy-Verhalten). In der Datenbank ist dieser Rückfall aber UNERREICHBAR — `place_subtype_check`
         * lässt genau die sieben bekannten Klassen zu und verbietet NULL. Ein Legacy-Zug mit einer neuen Klasse wird also
         * ABGEWIESEN, nicht still zur Metropole gemacht. Erst wer die Prüfbedingung per Migration erweitert, macht den Rückfall
         * erreichbar — und muss dann im selben Zug die Zuordnung mitnehmen. Genau dort soll dieser Test stolpern.
         */
        await expect(
            database`
                INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (gen_random_uuid(), 'aventuria', 'L3T Ort einer unbekannten Klasse', 'kommandantur',
                        ST_SetSRID(ST_MakePoint(712, 712), 0), 'test', TRUE)
            `,
        ).rejects.toThrow(/place_subtype_check/);
        expect(await zahl("metropole")).toBe(vorherMetropole);

        // 🔴 Seit dem Entscheid vom 2026-10-13 trägt „Gebiet“ die Gebiete, nicht mehr „Region“: ein neues Gebiet erhöht
        // genau die eine Zahl, und die andere bleibt stehen.
        const [gebiet] = await database<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, name, territory_type, color, opacity, source_system, is_active)
            VALUES (gen_random_uuid(), 'aventuria', 'L1T Baronie', 'Baronie', '#B2B065', 0.7, 'test', TRUE)
            RETURNING id::text AS id
        `;
        try {
            expect(await zahl("gebiet")).toBe(vorherGebiet! + 1);
            expect(await zahl("region"), "ein Gebiet zählt nicht mehr beim allgemeinen Bild").toBe(vorher.region);
        } finally {
            await database`DELETE FROM territory WHERE id = ${gebiet!.id}::bigint`;
        }
        expect(await zahl("gebiet")).toBe(vorherGebiet);
    });

    /**
     * Qualitätsreview Q-04: `objectCounts` zählte über ALLE Kartendomänen. Heute folgenlos (eine Domäne), mit der zweiten falsch —
     * das Infopanel zeigt immer die Objekte EINER Domäne. Der Fix ist das Prädikat, nicht ein Index (gemessen: derselbe Plan,
     * dieselben Buffer, der erzwungene Indexpfad ist langsamer).
     */
    it("🔴 die Objektzahl gilt je Kartendomäne, nicht über alle", async () => {
        const zahlVon = (liste: Awaited<ReturnType<typeof typeImageList>>, kategorie: string): number | null =>
            liste.items.find((item) => item.category === kategorie)!.count;
        const vorher = zahlVon(await typeImageList(database, "aventuria"), "stadt") ?? 0;

        const [ort] = await database<{ id: string }[]>`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (gen_random_uuid(), 'aventuria', 'Q04T Stadt', 'stadt',
                    ST_SetSRID(ST_MakePoint(700, 700), 0), 'test', TRUE)
            RETURNING id::text AS id
        `;
        try {
            const eigene = await typeImageList(database, "aventuria");
            expect(zahlVon(eigene, "stadt")).toBe(vorher + 1);

            // Dieselben Kategorien, aber die fremde Domäne zählt den Ort NICHT mit.
            const fremd = await typeImageList(database, "eine-andere-domaene");
            expect(fremd.items.map((item) => item.category)).toEqual([...HEADER_GRAPHICS]);
            expect(zahlVon(fremd, "stadt")).toBe(0);
            // Was keine Zählung hat, bleibt `null` - 0 und „es gibt keine Zahl“ sind nicht dasselbe.
            // Eine fremde Domaene hat auch keine Kraftlinien; `climate_band` hat keine Domaenenspalte und zaehlt ueberall.
            expect(zahlVon(fremd, "kraftlinien")).toBe(0);
            // Der ★ hängt am Asset, nicht an der Karte: er bleibt in jeder Domäne derselbe.
            expect(fremd.items.find((item) => item.category === "dorf")!.current?.assetId).toBe(
                eigene.items.find((item) => item.category === "dorf")!.current?.assetId,
            );
        } finally {
            await database`DELETE FROM place WHERE id = ${ort!.id}::bigint`;
        }
    });
});
