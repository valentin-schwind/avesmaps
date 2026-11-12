import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_COAT_NONE_URL,
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_BIND_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_GALLERY_UNBIND_URL,
    MEDIA_HEADER_NONE_URL,
    MEDIA_HEADER_SET_URL,
    MEDIA_UPLOAD_URL,
    mediaSubjectSlotsUrl,
    type MediaSlotSubjectKind,
    type MediaSubjectSlots,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertPlace, insertTerritory } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Jede Zuordnung in jedem Zustand ihres Platzes (WI-0068, Paket „was beim Bedienen nicht geht“; Register 2026-10-18: „alle module müssen
 * funktionieren … alles muss änderbar sein“). Anlass: An A'Sarar brach „Galerie lösen“ mit 500 ab, weil der Fall „nur eine Galerie, kein
 * Einzelbild“ in keinem Test vorkam (WI-0219 §6). Die Tests prüften je Operation den glücklichen Fall; diese Matrix prüft alle Zustände.
 *
 * - **Titelbild am Ort:** Zustände leer, „bewusst ohne“, Einzelbild, Galerie und beides (wie aus Legacy, vor WI-0219). Operationen:
 *   Titelbild setzen, kein Titelbild, Galerie binden, Galerie lösen. Der gesehene Stand kommt wie in der Oberfläche aus den Plätzen
 *   (`ortseditor-bilder.vue`): am Einzelbild seine Revision, sonst die der Galerie, sonst der Zustand.
 * - **Wappen an Ort und Gebiet:** Zustände leer, „bewusst ohne“, gesetzt; Operationen setzen und entfernen.
 * - 🔴 Nie ein 5xx. Wo nichts zu tun ist (kein Titelbild an einem leeren Platz), ein 409 mit Code; sonst 200 und der erwartete Zustand.
 */
describeWithDatabase("Zuordnungen in jedem Zustand ihres Platzes (WI-0068)", { timeout: 300_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let ruleId = "";
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    let cookie = "";
    const titelbilder: string[] = [];
    const wappen: string[] = [];
    let naechsterOrt = 120;
    let naechstesGebiet = 120;

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    const post = async (url: string, payload: object): Promise<{ status: number; body: unknown }> => {
        const antwort = await app.inject({
            method: "POST",
            url,
            payload: { operationId: operation(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        return { status: antwort.statusCode, body: antwort.json() as unknown };
    };
    const code = (body: unknown): string | undefined => (body as { error?: { code?: string } }).error?.code;
    const ok = async (url: string, payload: object): Promise<OperationReceipt> => {
        const { status, body } = await post(url, payload);
        expect(status, `${url}: ${JSON.stringify(body)}`).toBe(200);
        return body as OperationReceipt;
    };
    const plaetze = async (kind: MediaSlotSubjectKind, id: string): Promise<MediaSubjectSlots> => {
        const antwort = await app.inject({
            method: "GET",
            url: mediaSubjectSlotsUrl(kind, id),
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json() as MediaSubjectSlots;
    };
    /** Was die Oberfläche als gesehenen Stand des Titelbildplatzes schickt. */
    const gesehen = (kopf: NonNullable<MediaSubjectSlots["header"]>) =>
        kopf.image != null
            ? { baseRevision: kopf.image.revision }
            : kopf.gallery != null
              ? { galleryRevision: kopf.gallery.revision }
              : { baseState: kopf.suppressed ? "none" : "undecided" };
    const stand = async (ort: string) => {
        const kopf = (await plaetze("place", ort)).header!;
        return { bild: kopf.image?.asset.id ?? null, galerie: kopf.gallery?.id ?? null, ohne: kopf.suppressed };
    };

    /** Eine neue Galerie mit einem Bild, wie aus der Medienverwaltung. */
    async function galerie(titel: string): Promise<{ id: string; revision: number }> {
        const angelegt = (await ok(MEDIA_GALLERY_CREATE_URL, { title: titel })).affected.find(
            (a) => a.kind === "gallery",
        )!;
        const mit = await ok(MEDIA_GALLERY_ADD_URL, {
            galleryId: angelegt.id,
            baseRevision: angelegt.revision,
            assetId: titelbilder[2],
        });
        return { id: angelegt.id, revision: mit.affected.find((a) => a.kind === "gallery")!.revision! };
    }
    const galerieRevision = async (id: string): Promise<number> => {
        const [zeile] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_gallery WHERE public_id = ${id}::uuid
        `;
        return zeile!.revision;
    };

    type Zustand = "leer" | "ohne" | "bild" | "galerie" | "beides";
    /** Ein neuer Ort im gewünschten Zustand des Titelbildplatzes. */
    async function ortIm(zustand: Zustand): Promise<{ ort: string; galerie?: string }> {
        const { id, publicId } = await insertPlace(database, (naechsterOrt += 1));
        if (zustand === "leer") return { ort: publicId };
        await ok(MEDIA_HEADER_SET_URL, { placeId: publicId, assetId: titelbilder[0], baseState: "undecided" });
        if (zustand === "bild") return { ort: publicId };
        if (zustand === "ohne") {
            const kopf = (await plaetze("place", publicId)).header!;
            await ok(MEDIA_HEADER_NONE_URL, { placeId: publicId, baseRevision: kopf.image!.revision });
            return { ort: publicId };
        }
        const neu = await galerie(`Zustand ${zustand} ${String(naechsterOrt)}`);
        await ok(MEDIA_GALLERY_BIND_URL, { galleryId: neu.id, baseRevision: neu.revision, placeId: publicId });
        if (zustand === "beides") {
            // Wie aus Legacy vor WI-0219: Das Einzelbild hängt neben der Galerie.
            await database`
                UPDATE place_media SET retired_at = NULL
                 WHERE place_id = ${id}::bigint AND role = 'header'
                   AND id = (SELECT max(id) FROM place_media WHERE place_id = ${id}::bigint AND role = 'header')
            `;
        }
        return { ort: publicId, galerie: neu.id };
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-plaetze-zustaende-"));
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Zustands-Redakteurin" });
        people.push(person);
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        const [rule] = await database<{ id: string }[]>`
            INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
            VALUES ('own_work', 'ai_generated', 'header', 'media-test Plätze in jedem Zustand', 'Testzitat', '2026-10-19')
            RETURNING id::text AS id
        `;
        ruleId = rule!.id;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        for (const [rolle, seeds, ziel] of [
            ["header", [101, 102, 103], titelbilder],
            ["coat", [104, 105], wappen],
        ] as const) {
            for (const seed of seeds) {
                const hochgeladen = await app.inject({
                    method: "POST",
                    url: MEDIA_UPLOAD_URL,
                    payload: {
                        operationId: operation(),
                        file: file(await pngBytes(seed, 160, 90), `zustand-${String(seed)}.png`),
                        form: uploadForm({
                            title: `Zustand ${String(seed)}`,
                            role: rolle,
                            creationMethod: "ai_generated",
                        }),
                    },
                    headers: { origin: TEST_ORIGIN, cookie },
                });
                expect(hochgeladen.statusCode, hochgeladen.body).toBe(200);
                ziel.push((hochgeladen.json() as OperationReceipt).affected.find((a) => a.kind === "media_asset")!.id);
            }
        }
    }, 240_000);

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

    const ZUSTAENDE: readonly Zustand[] = ["leer", "ohne", "bild", "galerie", "beides"];

    it.each(ZUSTAENDE)(
        "🔴 Titelbild setzen an einem Ort im Zustand „%s“: 200, danach hängt genau das neue Bild",
        async (zustand) => {
            const { ort } = await ortIm(zustand);
            const kopf = (await plaetze("place", ort)).header!;
            await ok(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: titelbilder[1], ...gesehen(kopf) });
            expect(await stand(ort)).toEqual({ bild: titelbilder[1], galerie: null, ohne: false });
        },
    );

    it.each(ZUSTAENDE)(
        "🔴 kein Titelbild an einem Ort im Zustand „%s“: nie 5xx; wo etwas hängt, danach „bewusst ohne“",
        async (zustand) => {
            const { ort } = await ortIm(zustand);
            const kopf = (await plaetze("place", ort)).header!;
            const seen = gesehen(kopf);
            const { status, body } = await post(MEDIA_HEADER_NONE_URL, {
                placeId: ort,
                ...("baseState" in seen ? {} : seen),
            });
            if (zustand === "leer" || zustand === "ohne") {
                // Nichts zu lösen: Die Oberfläche zeigt den Knopf dann nicht; der Server sagt, dass sich der Platz geändert hat.
                expect([status, code(body)], JSON.stringify(body)).toEqual([409, "edit_conflict"]);
                return;
            }
            expect(status, JSON.stringify(body)).toBe(200);
            expect(await stand(ort)).toEqual({ bild: null, galerie: null, ohne: true });
        },
    );

    it.each(ZUSTAENDE)(
        "🔴 Galerie binden an einem Ort im Zustand „%s“: 200, danach hängt genau die neue Galerie",
        async (zustand) => {
            const { ort } = await ortIm(zustand);
            const kopf = (await plaetze("place", ort)).header!;
            const neu = await galerie(`Neu ${zustand}`);
            await ok(MEDIA_GALLERY_BIND_URL, {
                galleryId: neu.id,
                baseRevision: neu.revision,
                placeId: ort,
                ...(kopf.gallery == null ? {} : { replaceRevision: kopf.gallery.revision }),
            });
            expect(await stand(ort)).toEqual({ bild: null, galerie: neu.id, ohne: false });
        },
    );

    it.each(["galerie", "beides"] as const)(
        "🔴 Galerie lösen (Medienverwaltung) an einem Ort im Zustand „%s“: 200, die Galerie hängt nicht mehr",
        async (zustand) => {
            const { ort, galerie: id } = await ortIm(zustand);
            await ok(MEDIA_GALLERY_UNBIND_URL, {
                galleryId: id!,
                baseRevision: await galerieRevision(id!),
                placeId: ort,
            });
            const nachher = await stand(ort);
            expect(nachher.galerie).toBeNull();
            // Beim Zustand „beides“ bleibt das Einzelbild hängen: Lösen nimmt nur die Galerie.
            expect(nachher.bild).toBe(zustand === "beides" ? titelbilder[0] : null);
        },
    );

    const WAPPEN_ZUSTAENDE = ["leer", "ohne", "gesetzt"] as const;
    const KINDS = ["place", "territory"] as const;

    async function subjektIm(
        kind: (typeof KINDS)[number],
        zustand: (typeof WAPPEN_ZUSTAENDE)[number],
    ): Promise<string> {
        const { publicId } =
            kind === "place"
                ? await insertPlace(database, (naechsterOrt += 1))
                : await insertTerritory(database, (naechstesGebiet += 1));
        if (zustand === "leer") return publicId;
        await ok(MEDIA_COAT_BIND_URL, { subject: { kind, id: publicId }, assetId: wappen[0], baseState: "undecided" });
        if (zustand === "ohne") {
            const revision = (await plaetze(kind, publicId)).coat.revision!;
            await ok(MEDIA_COAT_NONE_URL, { subject: { kind, id: publicId }, baseRevision: revision });
        }
        return publicId;
    }

    for (const kind of KINDS) {
        it.each(WAPPEN_ZUSTAENDE)(
            `🔴 Wappen (${kind}) im Zustand „%s“: setzen ist 200, entfernen nie 5xx`,
            async (zustand) => {
                const id = await subjektIm(kind, zustand);
                const vorher = (await plaetze(kind, id)).coat;
                const basis =
                    vorher.state === "set"
                        ? { baseRevision: vorher.revision! }
                        : { baseState: vorher.state === "none" ? "none" : "undecided" };
                await ok(MEDIA_COAT_BIND_URL, { subject: { kind, id }, assetId: wappen[1], ...basis });
                const gesetzt = (await plaetze(kind, id)).coat;
                expect(gesetzt.state).toBe("set");
                expect(gesetzt.asset?.id).toBe(wappen[1]);
                await ok(MEDIA_COAT_NONE_URL, { subject: { kind, id }, baseRevision: gesetzt.revision! });
                expect((await plaetze(kind, id)).coat.state).toBe("none");
            },
        );
    }
});
