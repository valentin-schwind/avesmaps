import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_MERGE_URL,
    MEDIA_UPLOAD_URL,
    mediaEditorAssetUrl,
    mediaEditorUsageUrl,
    mediaMergeLiftUrl,
    type MediaAssetDetail,
    type MediaUsageResult,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mergePreview } from "../src/media-editor/merge-preview.ts";
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
 * Zwei Werke mit DENSELBEN BYTES werden eines (WI-0068 D1, Migration 0121).
 *
 * Betreiber 2026-10-13: „bytegleiche bilder die doppelt sind sollen zu einem werden - verlier die referenzen nicht.“ Genau das
 * prüfen diese Fälle: dass die Verwendungen ankommen, dass keine verloren geht, wo zwei auf denselben Platz zeigen, und dass
 * „aufheben“ exakt denselben Stand wiederherstellt.
 *
 * - **Soll**: Das bleibende Werk trägt danach beide Verwendungen, das aufgegangene keine.
 * - **Nur bytegleich**: Zwei verschiedene Bilder sind 409 — die Bedingung der ganzen Operation.
 * - **Derselbe Platz**: Hängen beide in derselben Galerie, geht dort nur eine Zeile; die andere wird zurückgezogen, und die
 *   Quittung sagt es. Ginge sie still verloren, fehlte später ein Bild, ohne dass jemand wüsste warum.
 * - **Aufheben**: genau die bewegten Zeilen zurück, keine andere.
 * - **Vorschau**: die Zahlen, die vor dem Klick dastehen, stimmen mit dem überein, was der Klick tut.
 */
describeWithDatabase("Zusammenführen bytegleicher Werke (WI-0068 D1)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    let cookie = "";
    let ruleId = "";
    /** Drei Werke: `a` und `b` tragen DIESELBEN Bytes, `fremd` andere. */
    let a = "";
    let b = "";
    let fremd = "";
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

    const post = async (url: string, payload: object): Promise<{ status: number; body: unknown }> => {
        const antwort = await app.inject({
            method: "POST",
            url,
            payload: { operationId: operation(), ...payload },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        return { status: antwort.statusCode, body: antwort.json() as unknown };
    };

    const ok = async (url: string, payload: object): Promise<OperationReceipt> => {
        const { status, body } = await post(url, payload);
        expect(status, `${url}: ${JSON.stringify(body)}`).toBe(200);
        return body as OperationReceipt;
    };

    const fehler = (body: unknown): string | undefined => (body as { error?: { code?: string } }).error?.code;
    const detail = async (publicId: string): Promise<MediaAssetDetail> => {
        const antwort = await app.inject({
            method: "GET",
            url: mediaEditorAssetUrl(publicId),
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json() as MediaAssetDetail;
    };

    const verwendung = async (publicId: string): Promise<MediaUsageResult> => {
        const antwort = await app.inject({
            method: "GET",
            url: mediaEditorUsageUrl(publicId),
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json() as MediaUsageResult;
    };

    /** Der aktuelle Stand eines Werks: Revision und wie viele AKTIVE Verwendungen es trägt. */
    const stand = async (publicId: string): Promise<{ revision: number; orte: number; galerien: number }> => {
        const [row] = await database<{ revision: number; orte: number; galerien: number }[]>`
            SELECT a.revision::int AS revision,
                   (SELECT count(*)::int FROM place_media p
                     WHERE p.media_asset_id = a.id AND p.retired_at IS NULL) AS orte,
                   (SELECT count(*)::int FROM media_gallery_item i
                     WHERE i.media_asset_id = a.id AND i.retired_at IS NULL) AS galerien
              FROM media_asset a WHERE a.public_id = ${publicId}::uuid
        `;
        return row!;
    };

    /**
     * 🪤 Hochgeladen wird als WAPPEN: Die Wappenbindung landet in `place_media`, der Tafel, die beim Zusammenführen umhängt.
     * Ein Titelbild aus einer Galerie hinge dort nicht (das prüft der Galeriefall weiter unten).
     */
    const ladeHoch = async (seed: number, titel: string): Promise<string> => {
        const antwort = await app.inject({
            method: "POST",
            url: MEDIA_UPLOAD_URL,
            payload: {
                operationId: operation(),
                file: file(await pngBytes(seed), `${titel}.png`),
                form: uploadForm({ title: titel, role: "coat", creationMethod: "ai_generated" }),
            },
            headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "media_asset")!.id;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-merge-"));
        fixture = authFixture(database);
        const person = await fixture.person("editor", { name: "Merge Redakteurin" });
        people.push(person);
        cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        const [rule] = await database<{ id: string }[]>`
            INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
            VALUES ('own_work', 'ai_generated', 'coat', 'media-test Mergeregel', 'Testzitat', '2026-10-13')
            RETURNING id::text AS id
        `;
        ruleId = rule!.id;
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();

        // 🔴 Zwei Werke mit DENSELBEN Bytes - so ist der Bestand entstanden (Legacy legte je Verwendung ein eigenes Werk an). Das
        // zweite kommt nicht über das Hochladen: Das lehnt dieselben Bytes seit 2026-10-17 ab.
        a = await ladeHoch(81, "Merge A");
        b = await bytegleichesWerk(database, a, "Merge B");
        fremd = await ladeHoch(82, "Merge Fremd");
        expect(new Set([a, b, fremd]).size, "drei verschiedene Werke").toBe(3);

        ortA = (await insertPlace(database, 81)).publicId;
        ortB = (await insertPlace(database, 82)).publicId;
        // `baseState: "undecided"` ist der gesehene Stand eines Platzes OHNE Bindung - ohne ihn antwortet der Server mit 409.
        await ok(MEDIA_COAT_BIND_URL, { subject: { kind: "place", id: ortA }, assetId: a, baseState: "undecided" });
        await ok(MEDIA_COAT_BIND_URL, { subject: { kind: "place", id: ortB }, assetId: b, baseState: "undecided" });
    }, 150_000);

    afterAll(async () => {
        await app?.close();
        if (ruleId !== "") await database`DELETE FROM publication_rule WHERE id = ${ruleId}::bigint`;
        await database`
            DELETE FROM media_merge_move WHERE merge_id IN (
                SELECT m.id FROM media_merge m JOIN media_asset x ON x.id = m.merged_asset_id
                 WHERE x.source_system = 'avesmaps3d'
            )
        `;
        await database`
            DELETE FROM media_merge WHERE merged_asset_id IN (SELECT id FROM media_asset WHERE source_system = 'avesmaps3d')
        `;
        await cleanEditorMedia(
            database,
            people.map((person) => person.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("🔴 zwei verschiedene Bilder lassen sich NICHT zusammenführen - das ist die Bedingung der Operation", async () => {
        const { status, body } = await post(MEDIA_MERGE_URL, {
            keep: { assetId: a, baseRevision: (await stand(a)).revision },
            merge: [{ assetId: fremd, baseRevision: (await stand(fremd)).revision }],
        });
        expect(status).toBe(409);
        expect(fehler(body)).toBe("media_not_same_file");
    });

    it("ein Bild kann nicht in sich selbst aufgehen", async () => {
        const revision = (await stand(a)).revision;
        const { status } = await post(MEDIA_MERGE_URL, {
            keep: { assetId: a, baseRevision: revision },
            merge: [{ assetId: a, baseRevision: revision }],
        });
        expect(status).toBe(400);
    });

    it("🔴 ein veralteter Stand ist 409 - sonst zöge die Operation eine Verwendung um, die inzwischen jemand gesetzt hat", async () => {
        // 🪤 NICHT `baseRevision: 1` als "alter Stand": Eine Bindung hebt die Revision des ASSETS nicht, ein frisch
        // hochgeladenes Werk steht also wirklich auf 1 - der Fall liefe durch und führte still zusammen.
        const { status, body } = await post(MEDIA_MERGE_URL, {
            keep: { assetId: a, baseRevision: (await stand(a)).revision + 99 },
            merge: [{ assetId: b, baseRevision: (await stand(b)).revision }],
        });
        expect(status).toBe(409);
        expect(fehler(body)).toBe("edit_conflict");
    });

    it("🔴 die Vorschau nennt die Gruppe, bevor jemand klickt", async () => {
        const vorschau = await mergePreview(database);
        const gruppe = vorschau.groups.find((eintrag) => [a, b].includes(eintrag.keepAssetId));
        expect(gruppe, "die Gruppe der beiden bytegleichen Werke steht da").toBeDefined();
        expect(gruppe?.members).toBe(2);
        expect(gruppe?.moves, "eine Ortsbindung zieht um").toBe(1);
        expect(gruppe?.retires).toBe(0);
        expect(gruppe?.rightsDiffer, "beide kamen aus demselben Formular").toBe(false);
        expect(vorschau.totals.groups).toBeGreaterThan(0);
    });

    it("🔴 zusammenführen: das bleibende Werk trägt danach BEIDE Ortsbindungen, das aufgegangene keine", async () => {
        const vorher = { a: await stand(a), b: await stand(b) };
        expect([vorher.a.orte, vorher.b.orte]).toEqual([1, 1]);

        const quittung = await ok(MEDIA_MERGE_URL, {
            keep: { assetId: a, baseRevision: vorher.a.revision },
            merge: [{ assetId: b, baseRevision: vorher.b.revision }],
            reason: "Dieselbe Datei, zweimal angelegt",
        });
        expect(quittung.affected[0]).toMatchObject({ kind: "media_asset", id: a });
        expect(quittung.warnings, "nichts musste zurückgezogen werden").toEqual([]);
        // 🔴 S8-02: Der Abgleich rechnet die Rolle, die umzog (Wappen), nicht fest das Titelbild.
        const jobs = await database<{ asset: string; role: string }[]>`
            SELECT input_ref ->> 'asset' AS asset, input_ref ->> 'role' AS role FROM job
             WHERE public_id = ANY(${quittung.derivedWork.map((work) => work.jobId!)}::uuid[])
        `;
        expect(jobs.map((job) => job.role)).not.toContain("header");
        // Das bleibende Werk trägt jetzt beide Wappen; das aufgegangene nur, wenn es noch Dateien hat (hier im Test nie gerechnet).
        expect(jobs).toContainEqual({ asset: a, role: "coat" });

        const nachher = { a: await stand(a), b: await stand(b) };
        expect(nachher.a.orte, "beide Orte zeigen jetzt auf A").toBe(2);
        expect(nachher.b.orte, "B hat keine Ortsbindung mehr").toBe(0);
        // 🪤 Die Revision des Assets steigt NICHT, und das ist richtig: Der Trigger `media_asset_revision` zählt nur die
        // FACHLICHEN Spalten (Titel, Art, Herkunft …). Eine Verwendung ist keine Spalte am Asset - auch eine gewöhnliche
        // Bindung hebt sie nicht. Wer hier einen Sprung erwartet, verwechselt das Werk mit seinen Verwendungen.
        expect(nachher.a.revision).toBe(vorher.a.revision);

        // 🪤 B ist NICHT gelöscht: Original, Rechte und Herkunft bleiben, sonst fände der Legacy-Zug seinen Schlüssel nicht wieder.
        const [bleibt] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_asset WHERE public_id = ${b}::uuid
        `;
        expect(bleibt?.n).toBe(1);
        const [datei] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_file f JOIN media_asset x ON x.id = f.media_asset_id
             WHERE x.public_id = ${b}::uuid AND f.storage_class = 'private_source'
        `;
        expect(datei?.n, "sein Original bleibt bei ihm").toBe(1);
    });

    it("das Fachprotokoll nennt das bleibende Werk und wie viel umzog", async () => {
        const zeilen = await database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT e.action, e.details FROM media_audit_event e
             WHERE e.media_asset_public_id = ${b}::uuid AND e.action = 'asset.merged'
        `;
        expect(zeilen).toHaveLength(1);
        expect(zeilen[0]?.details).toMatchObject({ keptAsset: a, moved: 1, retired: 0 });
    });

    it("🔴 das bleibende Werk nennt das aufgegangene (Zugang zum Aufheben, das aufgegangene steht in keiner Liste mehr)", async () => {
        const bleibt = await detail(a);
        expect(bleibt.mergedHere).toEqual([
            {
                assetId: b,
                title: expect.any(String) as unknown as string,
                mergedAt: expect.any(String) as unknown as string,
                mergedBy: { id: people[0]!.id, displayName: "Merge Redakteurin" },
            },
        ]);
        expect((await detail(b)).mergedHere, "das aufgegangene trägt nichts").toEqual([]);
    });

    it("🔴 OPS-000096: das bleibende Werk bietet das aufgegangene nicht mehr unter „gleiche Datei“ an (sonst führt der Knopf zu 409 media_already_merged)", async () => {
        const bleibt = await verwendung(a);
        expect(bleibt.sameFile.map((eintrag) => eintrag.asset.id)).not.toContain(b);
        expect(bleibt.aufgegangen ?? false).toBe(false);
        expect((await detail(a)).sharedFileCount, "auch die Zahl zählt das aufgegangene nicht").toBe(0);
        // Am aufgegangenen bleibt der Hinweis auf das bleibende stehen; zusammenführen lässt es sich von dort nicht mehr.
        const geht = await verwendung(b);
        expect(geht.aufgegangen).toBe(true);
        expect(geht.sameFile.map((eintrag) => eintrag.asset.id)).toContain(a);
    });

    it("🔴 ein schon aufgegangenes Werk lässt sich nicht noch einmal zusammenführen", async () => {
        const { status, body } = await post(MEDIA_MERGE_URL, {
            keep: { assetId: fremd, baseRevision: (await stand(fremd)).revision },
            merge: [{ assetId: b, baseRevision: (await stand(b)).revision }],
        });
        expect(status).toBe(409);
        expect(fehler(body)).toBe("media_already_merged");
    });

    it("🔴 die Vorschau kennt die Gruppe danach nicht mehr - sie ist erledigt", async () => {
        const vorschau = await mergePreview(database);
        expect(vorschau.groups.find((eintrag) => [a, b].includes(eintrag.keepAssetId))).toBeUndefined();
    });

    it("🔴 aufheben: genau die Verwendung zurück, die umzog", async () => {
        const quittung = await ok(mediaMergeLiftUrl(b), { reason: "Doch zwei verschiedene Bilder" });
        expect(quittung.affected[0]).toMatchObject({ kind: "media_asset", id: b });

        const nachher = { a: await stand(a), b: await stand(b) };
        expect(nachher.a.orte, "A hat wieder nur seinen Ort").toBe(1);
        expect(nachher.b.orte, "B hat seinen Ort zurück").toBe(1);

        const [zeile] = await database<{ lifted: Date | null }[]>`
            SELECT m.lifted_at AS lifted FROM media_merge m JOIN media_asset x ON x.id = m.merged_asset_id
             WHERE x.public_id = ${b}::uuid
        `;
        expect(zeile?.lifted, "die Zusammenführung bleibt als Verlauf stehen, aufgehoben").not.toBeNull();
        expect((await detail(a)).mergedHere, "nach dem Aufheben nennt das bleibende Werk nichts mehr").toEqual([]);
    });

    it("nach dem Aufheben stehen beide Werke wieder unter „gleiche Datei“ (OPS-000096)", async () => {
        expect((await verwendung(a)).sameFile.map((eintrag) => eintrag.asset.id)).toContain(b);
        expect((await verwendung(b)).aufgegangen ?? false).toBe(false);
    });

    it("🪤 hängen beide am SELBEN Platz, wird dort zurückgezogen statt umgehängt - und die Quittung sagt es", async () => {
        const galerie = await ok(MEDIA_GALLERY_CREATE_URL, { title: "Merge-Galerie" });
        const g = galerie.affected.find((eintrag) => eintrag.kind === "gallery")!;
        // 🔴 BEIDE Zeilen direkt in die Tafel: Über die API ginge keine von beiden - ein Wappen ist kein Titelbild, und
        // bytegleich wäre die zweite ohnehin abgewiesen. Genau so steht der Fall aber im Bestand: Legacy legte ihn an.
        for (const [nr, bild] of [a, b].entries()) {
            await database`
                INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order)
                SELECT gal.id, x.id, ${nr} FROM media_gallery gal, media_asset x
                 WHERE gal.public_id = ${g.id}::uuid AND x.public_id = ${bild}::uuid
            `;
        }
        expect((await stand(a)).galerien).toBe(1);
        expect((await stand(b)).galerien).toBe(1);

        const quittung = await ok(MEDIA_MERGE_URL, {
            keep: { assetId: a, baseRevision: (await stand(a)).revision },
            merge: [{ assetId: b, baseRevision: (await stand(b)).revision }],
        });
        expect(
            quittung.warnings.map((warnung) => warnung.code),
            "die Quittung sagt, dass eine Verwendung zurückgezogen wurde",
        ).toContain("merge_rows_retired");

        const nachher = { a: await stand(a), b: await stand(b) };
        expect(nachher.a.galerien, "A steht EINMAL in der Galerie, nicht zweimal").toBe(1);
        expect(nachher.b.galerien).toBe(0);
        expect(nachher.a.orte, "die Ortsbindung von B zog zusätzlich um").toBe(2);
    });

    it("🔴 aufheben stellt auch den zurückgezogenen Eintrag wieder her", async () => {
        await ok(mediaMergeLiftUrl(b), {});
        const nachher = { a: await stand(a), b: await stand(b) };
        expect(nachher.a.galerien).toBe(1);
        expect(nachher.b.galerien, "B steht wieder in der Galerie").toBe(1);
        expect(nachher.a.orte).toBe(1);
        expect(nachher.b.orte).toBe(1);
    });

    it("🪤 steht NUR das aufgehende Werk in einer Galerie, zieht der Eintrag um - und die Galerie gehört danach dem Editor", async () => {
        // Dieser Fall traf den Umhäng-Zweig für Galerien lange nicht: Solange beide in derselben Galerie standen, wurde dort
        // immer zurückgezogen. Ein Galerieeintrag hat KEINE eigene Herkunft - wer sie hier setzen wollte, bekäme hier den Fehler.
        const galerie = await ok(MEDIA_GALLERY_CREATE_URL, { title: "Nur B" });
        const g = galerie.affected.find((eintrag) => eintrag.kind === "gallery")!;
        await database`
            INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order)
            SELECT gal.id, x.id, 0 FROM media_gallery gal, media_asset x
             WHERE gal.public_id = ${g.id}::uuid AND x.public_id = ${b}::uuid
        `;
        expect((await stand(b)).galerien).toBeGreaterThan(0);

        await ok(MEDIA_MERGE_URL, {
            keep: { assetId: a, baseRevision: (await stand(a)).revision },
            merge: [{ assetId: b, baseRevision: (await stand(b)).revision }],
        });

        const [eintrag] = await database<{ asset: string }[]>`
            SELECT x.public_id::text AS asset FROM media_gallery_item i
              JOIN media_gallery gal ON gal.id = i.gallery_id JOIN media_asset x ON x.id = i.media_asset_id
             WHERE gal.public_id = ${g.id}::uuid AND i.retired_at IS NULL
        `;
        expect(eintrag?.asset, "der Eintrag zeigt jetzt auf das bleibende Werk").toBe(a);
        const [gal] = await database<{ origin: string }[]>`
            SELECT origin FROM media_gallery WHERE public_id = ${g.id}::uuid
        `;
        expect(gal?.origin, "die Galerie gehört danach dem Editor - der Import gleicht sie nicht mehr ab").toBe(
            "editor",
        );

        await ok(mediaMergeLiftUrl(b), {});
        const [zurueck] = await database<{ asset: string }[]>`
            SELECT x.public_id::text AS asset FROM media_gallery_item i
              JOIN media_gallery gal ON gal.id = i.gallery_id JOIN media_asset x ON x.id = i.media_asset_id
             WHERE gal.public_id = ${g.id}::uuid AND i.retired_at IS NULL
        `;
        expect(zurueck?.asset, "aufheben gibt den Eintrag zurück").toBe(b);
    });
});
