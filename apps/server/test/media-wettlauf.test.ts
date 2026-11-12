import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_COVER_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_HEADER_SET_URL,
    MEDIA_MERGE_URL,
    MEDIA_UPLOAD_URL,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";
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
 * 🔴 **Gleichzeitige Wechsel an einem Platz** (WI-0068 R8, AC17 und AC19; Arbeitsanweisung: „zweifache Sitzung mit Revisionen“, „Race
 * auf ★, Galeriecover, Einzelbild-/Batchupload“). Zwei Redakteurinnen sehen denselben Stand und schicken ihn zugleich: Genau eine
 * gewinnt, die andere bekommt 409 und überschreibt nichts.
 *
 * 🪤 Der Befund, aus dem diese Datei entstand (2026-10-18): Ersetzt ein Wechsel das Bild eines Platzes, zieht er die alte Bindung zurück
 * und legt eine NEUE an, und die begann bei Revision 1. Hatte die alte auch Revision 1, ging der zweite Wechsel mit demselben
 * gesehenen Stand durch und ersetzte den ersten still (beide 200). Ebenso, wenn eine zurückgezogene Bindung zurückkam und dabei genau die
 * Revision erreichte, die der andere gesehen hatte.
 */
describeWithDatabase("Gleichzeitige Wechsel an einem Platz (WI-0068 R8)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    let cookie = "";

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });
    const send = (url: string, payload: object) =>
        app.inject({
            method: "POST",
            url,
            payload: { operationId: operation(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const quittung = (response: { json(): unknown }): OperationReceipt => response.json() as OperationReceipt;

    async function hochladen(seed: number, rolle: "coat" | "header"): Promise<string> {
        const antwort = await send(MEDIA_UPLOAD_URL, {
            file: file(await pngBytes(seed, 160, 90)),
            form: uploadForm({ title: `Wettlauf ${String(seed)}`, role: rolle }),
        });
        expect(code(antwort)).toBe("200");
        return quittung(antwort).affected.find((entry) => entry.kind === "media_asset")!.id;
    }
    /** Die Revision der aktiven Wappen-Bindung, wie sie der Platz zeigt. */
    const wappen = async (ortId: string): Promise<{ assetId: string; revision: number }[]> =>
        database<{ assetId: string; revision: number }[]>`
            SELECT a.public_id::text AS "assetId", m.revision::int AS revision
              FROM place_media m JOIN place p ON p.id = m.place_id JOIN media_asset a ON a.id = m.media_asset_id
             WHERE p.public_id = ${ortId}::uuid AND m.role = 'coat' AND m.retired_at IS NULL
        `;
    const titelbild = async (ortId: string): Promise<{ assetId: string; revision: number }[]> =>
        database<{ assetId: string; revision: number }[]>`
            SELECT a.public_id::text AS "assetId", m.revision::int AS revision
              FROM place_media m JOIN place p ON p.id = m.place_id JOIN media_asset a ON a.id = m.media_asset_id
             WHERE p.public_id = ${ortId}::uuid AND m.role = 'header' AND m.retired_at IS NULL
        `;
    /** Zwei Anfragen zugleich; die Codes sortiert, damit die Reihenfolge des Gewinners keine Rolle spielt. */
    const zugleich = async (a: () => Promise<{ statusCode: number; json(): unknown }>, b: typeof a) =>
        (await Promise.all([a(), b()])).map(code).sort();

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-wettlauf-"));
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Wettlauf Redakteurin" });
        people.push(person);
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 6 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        // Die Zusammenführungen dieser Datei zuerst: Sie zeigen auf die Werke, die das Aufräumen danach löscht.
        const personen = people.map((person) => person.id);
        await database`
            DELETE FROM media_merge_move WHERE merge_id IN (
                SELECT id FROM media_merge WHERE merged_by_person = ANY(${personen}::uuid[])
            )
        `;
        await database`DELETE FROM media_merge WHERE merged_by_person = ANY(${personen}::uuid[])`;
        await cleanEditorMedia(
            database,
            people.map((person) => person.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("🔴 Wappen: zwei Wechsel auf demselben Stand - einer gewinnt, der andere 409, ein Wappen am Ort", async () => {
        const ort = (await insertPlace(database, 91)).publicId;
        const subject = { kind: "place", id: ort };
        const [a, b, c] = [await hochladen(91, "coat"), await hochladen(92, "coat"), await hochladen(93, "coat")];
        expect(code(await send(MEDIA_COAT_BIND_URL, { subject, assetId: a, baseState: "undecided" }))).toBe("200");
        const [gesehen] = await wappen(ort);
        const codes = await zugleich(
            () => send(MEDIA_COAT_BIND_URL, { subject, assetId: b, baseRevision: gesehen!.revision }),
            () => send(MEDIA_COAT_BIND_URL, { subject, assetId: c, baseRevision: gesehen!.revision }),
        );
        expect(codes).toEqual(["200", "409 edit_conflict"]);
        expect(await wappen(ort)).toHaveLength(1);
    });

    it("🔴 Wappen: auch wenn eine zurückgezogene Bindung zurückkommt, gewinnt nur einer", async () => {
        const ort = (await insertPlace(database, 94)).publicId;
        const subject = { kind: "place", id: ort };
        const [a, b, c] = [await hochladen(94, "coat"), await hochladen(95, "coat"), await hochladen(96, "coat")];
        expect(code(await send(MEDIA_COAT_BIND_URL, { subject, assetId: a, baseState: "undecided" }))).toBe("200");
        const [erst] = await wappen(ort);
        expect(code(await send(MEDIA_COAT_BIND_URL, { subject, assetId: b, baseRevision: erst!.revision }))).toBe(
            "200",
        );
        const [gesehen] = await wappen(ort);
        // A kommt zurück (seine Zeile wird wieder aktiv), C ist neu: beide auf dem Stand von B.
        const codes = await zugleich(
            () => send(MEDIA_COAT_BIND_URL, { subject, assetId: a, baseRevision: gesehen!.revision }),
            () => send(MEDIA_COAT_BIND_URL, { subject, assetId: c, baseRevision: gesehen!.revision }),
        );
        expect(codes).toEqual(["200", "409 edit_conflict"]);
        // Wer jetzt noch den Stand von B hält, kann nicht mehr treffen: Die neu aktive Bindung zählt über jeder früheren des Platzes.
        const [jetzt] = await wappen(ort);
        expect(jetzt!.revision, "die neue Bindung trägt eine Revision über der abgelösten").toBeGreaterThan(
            gesehen!.revision,
        );
    });

    it("🔴 Titelbild: zwei Wechsel auf demselben Stand - einer gewinnt, der andere 409", async () => {
        const ort = (await insertPlace(database, 97)).publicId;
        const [a, b, c] = [await hochladen(97, "header"), await hochladen(98, "header"), await hochladen(99, "header")];
        expect(code(await send(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: a, baseState: "undecided" }))).toBe(
            "200",
        );
        const [gesehen] = await titelbild(ort);
        const codes = await zugleich(
            () => send(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: b, baseRevision: gesehen!.revision }),
            () => send(MEDIA_HEADER_SET_URL, { placeId: ort, assetId: c, baseRevision: gesehen!.revision }),
        );
        expect(codes[0]).toBe("200");
        expect(codes[1]).toMatch(/^409 /u);
        expect(await titelbild(ort)).toHaveLength(1);
    });

    it("🔴 Galerie-Cover: zwei Setzungen auf derselben Revision - eine gewinnt, die andere 409", async () => {
        const angelegt = quittung(await send(MEDIA_GALLERY_CREATE_URL, { title: "Wettlauf-Galerie" }));
        const galerie = angelegt.affected.find((entry) => entry.kind === "gallery")!;
        let revision = galerie.revision!;
        const bilder = [await hochladen(101, "header"), await hochladen(102, "header")];
        for (const assetId of bilder) {
            const antwort = await send(MEDIA_GALLERY_ADD_URL, {
                galleryId: galerie.id,
                baseRevision: revision,
                assetId,
            });
            expect(code(antwort)).toBe("200");
            revision = quittung(antwort).affected.find((entry) => entry.kind === "gallery")!.revision!;
        }
        const codes = await zugleich(
            () => send(MEDIA_GALLERY_COVER_URL, { galleryId: galerie.id, baseRevision: revision, assetId: bilder[0] }),
            () => send(MEDIA_GALLERY_COVER_URL, { galleryId: galerie.id, baseRevision: revision, assetId: bilder[1] }),
        );
        expect(codes[0]).toBe("200");
        expect(codes[1]).toMatch(/^409 /u);
    });

    /** Die Revision eines Werks, wie die Medienverwaltung sie als gesehenen Stand mitschickt. */
    const werkRevision = async (assetId: string): Promise<number> => {
        const [row] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_asset WHERE public_id = ${assetId}::uuid
        `;
        return row!.revision;
    };
    /** Aktive Zusammenführungen zwischen genau diesen Werken. */
    const zusammenfuehrungen = async (ids: readonly string[]): Promise<{ merged: string; kept: string }[]> =>
        database<{ merged: string; kept: string }[]>`
            SELECT m.public_id::text AS merged, k.public_id::text AS kept
              FROM media_merge z JOIN media_asset m ON m.id = z.merged_asset_id JOIN media_asset k ON k.id = z.kept_asset_id
             WHERE z.lifted_at IS NULL AND m.public_id = ANY(${ids as string[]}::uuid[])
        `;

    it("🔴 Zusammenführen: dieselbe Gruppe zweimal zugleich - einmal zusammengeführt, das zweite 409", async () => {
        const a = await hochladen(103, "header");
        const b = await bytegleichesWerk(database, a, "Zwilling 103");
        const body = async () => ({
            keep: { assetId: a, baseRevision: await werkRevision(a) },
            merge: [{ assetId: b, baseRevision: await werkRevision(b) }],
        });
        const [eins, zwei] = [await body(), await body()];
        const codes = await zugleich(
            () => send(MEDIA_MERGE_URL, eins),
            () => send(MEDIA_MERGE_URL, zwei),
        );
        expect(codes[0]).toBe("200");
        expect(codes[1]).toMatch(/^409 /u);
        expect(await zusammenfuehrungen([a, b])).toEqual([{ merged: b, kept: a }]);
    });

    it("🔴 Zusammenführen über Kreuz zugleich (A in B und B in A): eines gewinnt, nie beide - kein Kreis", async () => {
        const a = await hochladen(104, "header");
        const b = await bytegleichesWerk(database, a, "Zwilling 104");
        const [ra, rb] = [await werkRevision(a), await werkRevision(b)];
        const codes = await zugleich(
            () =>
                send(MEDIA_MERGE_URL, {
                    keep: { assetId: a, baseRevision: ra },
                    merge: [{ assetId: b, baseRevision: rb }],
                }),
            () =>
                send(MEDIA_MERGE_URL, {
                    keep: { assetId: b, baseRevision: rb },
                    merge: [{ assetId: a, baseRevision: ra }],
                }),
        );
        expect(codes[0]).toBe("200");
        expect(codes[1]).toMatch(/^409 /u);
        expect(await zusammenfuehrungen([a, b]), "genau eine Richtung").toHaveLength(1);
    });
});
