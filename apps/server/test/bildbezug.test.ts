import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    MEDIA_HEADER_RELATION_URL,
    MediaPublicView,
    MediaSubjectSlots,
    MediaUsageResult,
    OperationReceipt,
    SubjectDetail,
    mediaEditorUsageUrl,
    mediaSubjectSlotsUrl,
    subjectDetailUrl,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { withholdTypeImages } from "../src/media/image-relation.ts";
import { resolvePlaceMedia, resolvePlaceMediaParts } from "../src/media/resolver.ts";
import { PUBLISHED_VARIANT } from "../src/media/roles.ts";
import { storageKey } from "../src/media/storage.ts";
import { setHeaderRelation } from "../src/media-editor/header-relation.ts";
import type { MediaActor } from "../src/media-editor/operation-store.ts";
import { importMedia } from "../src/migration/media-import.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import {
    cleanMediaFixtures,
    insertAsset,
    insertGallery,
    insertPlace,
    sha,
    type FixtureAsset,
} from "./support/media-fixture.ts";
import { cleanLegacyMedia, insertSubjects, manifestOf, type ItemSpec } from "./support/media-import-fixture.ts";
import { cleanEditorMedia, operation } from "./support/media-operations-fixture.ts";
import { place as importPlace } from "./support/media-world.ts";

/**
 * Bildbezug im Infopanel: Ortsansicht oder Typbild (Betreiber 2026-10-11, wörtlich „1A … 2 B … 3 A ja das gilt für alle“;
 * Arbeitsanweisung `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`, Migration 0111).
 *
 * Problemfälle: Eine Datei, die Legacy in zwei Assets an zwei Orten legte, gilt als eigenes Bild, weil man Assets statt Dateien zählt;
 * ein fehlendes Feld wird zur Ortsansicht; die Übersteuerung eines Editors gewinnt nur in eine Richtung oder fällt beim nächsten Zug
 * weg; eine gemischte Folge zeigt zur Ortsansicht noch Typbilder; die öffentliche Antwort verschluckt das Feld (Serialisierung) oder
 * trägt es an einem Wappen. Soll: die Regel über die Quelldatei, die Übersteuerung je Verwendung in beide Richtungen, 2B nach der
 * Entscheidung der Policy, die Operation mit Revision, Protokoll und Recht.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const OWN_CLEARED = { basis: "own_work", clearance: "cleared" } as const;

describe("Bildbezug 2B ohne Datenbank: eine gemischte Folge", () => {
    const view = (id: string, role: "coat" | "header", relation?: "place_view" | "type_image"): MediaPublicView => ({
        id,
        role,
        url: `/media/sha256/aa/bb/${"a".repeat(64)}.webp`,
        width: 800,
        height: 450,
        mimeType: "image/webp",
        ...(relation === undefined ? {} : { relation }),
    });

    it("eine Ortsansicht nimmt die Typbilder weg, das Wappen bleibt, die Reihenfolge bleibt", () => {
        const { delivered, withheld } = withholdTypeImages([
            view("c", "coat"),
            view("t1", "header", "type_image"),
            view("p1", "header", "place_view"),
            view("t2", "header"),
            view("p2", "header", "place_view"),
        ]);
        expect(delivered.map((entry) => entry.id)).toEqual(["c", "p1", "p2"]);
        // Ein fehlendes Feld ist ein Typbild, nie eine Ortsansicht.
        expect(withheld.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    });

    it("ohne Ortsansicht bleibt alles, wie es ist", () => {
        const views = [view("t1", "header", "type_image"), view("t2", "header")];
        expect(withholdTypeImages(views)).toEqual({ delivered: views, withheld: [] });
    });
});

describeWithDatabase("Bildbezug: die Regel je Verwendung über die Quelldatei (1A, 2B)", { timeout: 180_000 }, () => {
    let database: Database;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await cleanMediaFixtures(database);
    }, 120_000);

    afterAll(async () => {
        await cleanMediaFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(() => cleanMediaFixtures(database));
    afterEach(() => cleanMediaFixtures(database));

    /** Ein Kopfbild mit veröffentlichter Fassung und seiner Quelldatei `source` (die Datei-Identität der Regel). */
    async function headerAsset(ref: string, source: string | null): Promise<FixtureAsset> {
        const created = await insertAsset(database, {
            ref,
            rights: OWN_CLEARED,
            published: [{ variant: PUBLISHED_VARIANT.header }],
        });
        if (source !== null) {
            const hash = sha(`quelle:${source}`);
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${created.id}, 'source', 'private_source', ${storageKey("private_source", hash, "png")}, 'image/png', 1600, 900, 4321, ${hash})
            `;
        }
        return created;
    }

    /** Eine Kopf-Galerie aus Legacy an diesem Ort, in dieser Folge. */
    async function gallery(placeId: string, ref: string, assets: readonly FixtureAsset[]): Promise<string> {
        const created = await insertGallery(database, ref);
        await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${placeId}, ${created.id}, 'header', 'legacy')`;
        for (const [position, asset] of assets.entries()) {
            await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${created.id}, ${asset.id}, ${position})`;
        }
        return created.id;
    }

    const relations = async (placePublicId: string): Promise<[string, string | undefined][]> =>
        (await resolvePlaceMedia(database, placePublicId)).map((view) => [view.id, view.relation]);

    it("🔴 eine Datei an genau einem aktiven Ort ist Ortsansicht, an zweien Typbild - auch in ZWEI Assets (Legacy)", async () => {
        const gareth = await insertPlace(database, 70);
        const akiras = await insertPlace(database, 71);
        const tempel = await insertPlace(database, 72);
        const nachbar = await insertPlace(database, 73);
        const eigenes = await headerAsset("bb-eigen", "eigen");
        const geteilt = await headerAsset("bb-geteilt", "geteilt");
        // Dieselbe Quelldatei in zwei Assets an zwei Orten: wer Assets zählt, hielte jedes für ein eigenes Bild.
        const zwillingA = await headerAsset("bb-zwilling-a", "zwilling");
        const zwillingB = await headerAsset("bb-zwilling-b", "zwilling");
        await gallery(gareth.id, "bb-gareth", [eigenes]);
        await gallery(akiras.id, "bb-akiras", [geteilt, zwillingA]);
        await gallery(tempel.id, "bb-tempel", [geteilt]);
        await gallery(nachbar.id, "bb-nachbar", [zwillingB]);

        expect(await relations(gareth.publicId)).toEqual([[eigenes.publicId, "place_view"]]);
        expect(await relations(akiras.publicId)).toEqual([
            [geteilt.publicId, "type_image"],
            [zwillingA.publicId, "type_image"],
        ]);
        expect(await relations(nachbar.publicId)).toEqual([[zwillingB.publicId, "type_image"]]);
        for (const view of await resolvePlaceMedia(database, akiras.publicId)) {
            expect(Value.Check(MediaPublicView, view), JSON.stringify([...Value.Errors(MediaPublicView, view)])).toBe(
                true,
            );
        }
    });

    it("gezählt werden aktive Orte und aktive Verwendungen, Galerie und direkte Bindung zusammen", async () => {
        const hier = await insertPlace(database, 74);
        const stillgelegt = await insertPlace(database, 75);
        const direkt = await insertPlace(database, 76);
        const zurueck = await insertPlace(database, 77);
        await database`UPDATE place SET is_active = FALSE WHERE id = ${stillgelegt.id}`;
        const bild = await headerAsset("bb-aktiv", "aktiv");
        const zweites = await headerAsset("bb-direkt", "direkt");
        await gallery(hier.id, "bb-hier", [bild]);
        // Ein stillgelegter Ort zählt nicht, ein zurückgezogener Eintrag auch nicht.
        await gallery(stillgelegt.id, "bb-stillgelegt", [bild]);
        const alt = await gallery(zurueck.id, "bb-zurueck", [bild]);
        await database`UPDATE media_gallery_item SET retired_at = now() WHERE gallery_id = ${alt}`;
        expect(await relations(hier.publicId)).toEqual([[bild.publicId, "place_view"]]);
        // Eine direkte Bindung `place_media` zählt wie ein Galerieeintrag.
        await gallery(direkt.id, "bb-direkt-galerie", [zweites]);
        await database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${hier.id}, ${zweites.id}, 'header', 'legacy')`;
        expect(await relations(direkt.publicId)).toEqual([[zweites.publicId, "type_image"]]);
    });

    it("🔴 ohne Quelldatei keine Ortsansicht (unbekannte Identität), ein Wappen trägt nie einen Bildbezug", async () => {
        const ort = await insertPlace(database, 78);
        const ohne = await headerAsset("bb-ohne-quelle", null);
        const wappen = await insertAsset(database, { ref: "bb-wappen", rights: OWN_CLEARED });
        await database`INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${ort.id}, ${wappen.id}, 'coat', 'legacy')`;
        await gallery(ort.id, "bb-ohne", [ohne]);
        const views = await resolvePlaceMedia(database, ort.publicId);
        expect(views.map((view) => [view.role, view.relation])).toEqual([
            ["coat", undefined],
            ["header", "type_image"],
        ]);
        expect(views[0]).not.toHaveProperty("relation");
    });

    it("🔴 die Übersteuerung je Verwendung gewinnt in beide Richtungen, NULL gibt die Regel zurück", async () => {
        const eins = await insertPlace(database, 79);
        const zwei = await insertPlace(database, 80);
        const eigenes = await headerAsset("bb-ueber-eigen", "ueber-eigen");
        const geteilt = await headerAsset("bb-ueber-geteilt", "ueber-geteilt");
        const g1 = await gallery(eins.id, "bb-ueber-1", [eigenes, geteilt]);
        await gallery(zwei.id, "bb-ueber-2", [geteilt]);
        // Die Folge hat eine Ortsansicht: das Typbild fällt nach 2B weg.
        expect(await relations(eins.publicId)).toEqual([[eigenes.publicId, "place_view"]]);
        await database`UPDATE media_gallery_item SET image_relation_override = 'type_image' WHERE gallery_id = ${g1} AND media_asset_id = ${eigenes.id}`;
        await database`UPDATE media_gallery_item SET image_relation_override = 'place_view' WHERE gallery_id = ${g1} AND media_asset_id = ${geteilt.id}`;
        expect(await relations(eins.publicId)).toEqual([[geteilt.publicId, "place_view"]]);
        // Die Übersteuerung gilt der Verwendung, nicht dem Asset: am anderen Ort bleibt dasselbe Bild Typbild.
        expect(await relations(zwei.publicId)).toEqual([[geteilt.publicId, "type_image"]]);
        await database`UPDATE media_gallery_item SET image_relation_override = NULL WHERE gallery_id = ${g1}`;
        expect(await relations(eins.publicId)).toEqual([[eigenes.publicId, "place_view"]]);
        // Auch an der direkten Bindung.
        const direkt = await headerAsset("bb-ueber-direkt", "ueber-direkt");
        await database`INSERT INTO place_media (place_id, media_asset_id, role, origin, image_relation_override) VALUES (${zwei.id}, ${direkt.id}, 'header', 'legacy', 'type_image')`;
        expect(await relations(zwei.publicId)).toEqual([
            [direkt.publicId, "type_image"],
            [geteilt.publicId, "type_image"],
        ]);
        // Die Spalte nimmt nur die zwei Werte.
        await expect(
            database`UPDATE media_gallery_item SET image_relation_override = 'ortsansicht' WHERE gallery_id = ${g1}`,
        ).rejects.toThrow(/check/i);
    });

    it("🔴 2B wie Athyros: eine eigene und eine geteilte Datei - nur das eigene Bild, das geteilte bleibt am anderen Ort", async () => {
        const athyros = await insertPlace(database, 81);
        const anderer = await insertPlace(database, 82);
        const eigenes = await headerAsset("bb-athyros-eigen", "athyros-eigen");
        const geteilt = await headerAsset("bb-athyros-geteilt", "athyros-geteilt");
        await gallery(athyros.id, "bb-athyros", [geteilt, eigenes]);
        await gallery(anderer.id, "bb-anderer", [geteilt]);
        const parts = await resolvePlaceMediaParts(database, athyros.publicId);
        expect(parts.delivered.map((view) => [view.id, view.relation])).toEqual([[eigenes.publicId, "place_view"]]);
        expect(parts.withheld.map((view) => view.id)).toEqual([geteilt.publicId]);
        expect(await relations(anderer.publicId)).toEqual([[geteilt.publicId, "type_image"]]);
        // Nach der Policy gerechnet: Eine gesperrte Ortsansicht nimmt dem Ort seine Typbilder nicht.
        await database`UPDATE media_gallery_item SET publication_override = 'blocked' WHERE media_asset_id = ${eigenes.id}`;
        expect(await relations(athyros.publicId)).toEqual([[geteilt.publicId, "type_image"]]);
    });

    it("die öffentliche Antwort des Infopanels trägt das Feld (die Serialisierung verschluckt es nicht)", async () => {
        const ort = await insertPlace(database, 83);
        const eigenes = await headerAsset("bb-http", "http");
        await gallery(ort.id, "bb-http", [eigenes]);
        const app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "test",
                databaseUrl: undefined,
                tileRoot: undefined,
                mediaRoot: undefined,
                auth: TEST_AUTH,
            },
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        try {
            const response = await app.inject({
                method: "GET",
                url: subjectDetailUrl({ kind: "place", id: ort.publicId })!,
            });
            expect(response.statusCode, response.body).toBe(200);
            const body = response.json() as SubjectDetail;
            expect(body.media?.header?.map((view) => view.relation)).toEqual(["place_view"]);
            expect(Value.Check(SubjectDetail, body)).toBe(true);
        } finally {
            await app.close();
        }
    });
});

describeWithDatabase(
    "Bildbezug: die Operation header.relation (Recht, Revision, Protokoll)",
    { timeout: 180_000 },
    () => {
        let database: Database;
        let app: FastifyInstance;
        let fixture: ReturnType<typeof authFixture>;
        const cookies = new Map<string, string>();
        const people = new Map<string, TestPerson>();

        const config = (): ServerConfig => ({
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            mediaRoot: undefined,
            auth: TEST_AUTH,
        });

        const post = (actor: string | undefined, payload: unknown) =>
            app.inject({
                method: "POST",
                url: MEDIA_HEADER_RELATION_URL,
                payload: payload as object,
                headers: { origin: TEST_ORIGIN, ...(actor === undefined ? {} : { cookie: cookies.get(actor) ?? "" }) },
            });
        const get = (url: string, actor: string) =>
            app.inject({ method: "GET", url, headers: { origin: TEST_ORIGIN, cookie: cookies.get(actor) ?? "" } });
        const code = (response: { statusCode: number; json(): unknown }): string =>
            response.statusCode < 300
                ? String(response.statusCode)
                : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string, { max: 6 });
            await migrate(database);
            await cleanMediaFixtures(database);
            fixture = authFixture(database);
            for (const [actor, role, name] of [
                ["reviewer", "reviewer", "Bildbezug Reviewer"],
                ["editor", "editor", "Bildbezug Redakteurin"],
            ] as const) {
                const person = await fixture.person(role, { name });
                people.set(actor, person);
                cookies.set(actor, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
            }
            app = buildApp({
                config: config(),
                database: createDatabase(testDatabaseUrl as string, { max: 4 }),
                logStream: { write: () => undefined },
            });
            await app.ready();
        }, 120_000);

        afterAll(async () => {
            await app?.close();
            await cleanEditorMedia(
                database,
                [...people.values()].map((person) => person.id),
            );
            await cleanMediaFixtures(database);
            await fixture?.cleanup();
            await database?.end({ timeout: 5 });
        });

        async function world() {
            const ort = await insertPlace(database, 84);
            const bild = await insertAsset(database, {
                ref: "bb-op",
                rights: OWN_CLEARED,
                published: [{ variant: PUBLISHED_VARIANT.header }],
            });
            const created = await insertGallery(database, "bb-op");
            await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${ort.id}, ${created.id}, 'header', 'legacy')`;
            await database`INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${created.id}, ${bild.id}, 0)`;
            const revision = async (): Promise<number> => {
                const [row] = await database<
                    { r: number }[]
                >`SELECT revision::int AS r FROM media_gallery WHERE id = ${created.id}`;
                return row!.r;
            };
            return { ort, bild, gallery: created, revision };
        }

        it("🔴 ohne Recht nichts: Besucher 401, Reviewer 403; die Redakteurin setzt, Protokoll und Revision folgen", async () => {
            await cleanMediaFixtures(database);
            const { ort, bild, gallery, revision } = await world();
            const body = (value: string | null, base: number) => ({
                operationId: operation(),
                placeId: ort.publicId,
                assetId: bild.publicId,
                value,
                baseRevision: base,
            });
            const start = await revision();
            expect(code(await post(undefined, body("place_view", start)))).toBe("401 unauthenticated");
            expect(code(await post("reviewer", body("place_view", start)))).toBe("403 forbidden");

            // Ohne Quelldatei sagt die Regel Typbild; die Redakteurin macht es zur Ortsansicht.
            const first = body("place_view", start);
            const response = await post("editor", first);
            expect(response.statusCode, response.body).toBe(200);
            const receipt = response.json() as OperationReceipt;
            expect(Value.Check(OperationReceipt, receipt)).toBe(true);
            expect(receipt.affected).toEqual([{ kind: "gallery", id: gallery.publicId, revision: start + 1 }]);
            expect((await resolvePlaceMedia(database, ort.publicId)).map((view) => view.relation)).toEqual([
                "place_view",
            ]);
            // Dieselbe Kennung ein zweites Mal: dieselbe Quittung, nichts doppelt.
            expect(((await post("editor", first)).json() as OperationReceipt).status).toBe("replayed");

            const [audit] = await database<{ action: string; details: Record<string, unknown>; target: number }[]>`
            SELECT e.action, e.details, e.target_revision::int AS target FROM media_audit_event e
              JOIN media_operation o ON o.operation_id = e.operation_id
             WHERE o.operation_id = ${first.operationId}::uuid
        `;
            expect(audit).toEqual({
                action: "gallery.header_relation_set",
                details: { subject: `place:${ort.publicId}`, relation: "place_view", previous: null },
                target: start + 1,
            });
            const [op] = await database<{ action: string; actor: string }[]>`
            SELECT action, actor_person_id::text AS actor FROM media_operation WHERE operation_id = ${first.operationId}::uuid
        `;
            expect(op).toEqual({ action: "header.relation", actor: people.get("editor")!.id });

            // Der alte Stand gilt nicht mehr: 409 mit „wer, wann“.
            const stale = await post("editor", body("type_image", start));
            expect(code(stale)).toBe("409 edit_conflict");
            expect(
                (stale.json() as { error: { details: { changedBy?: { displayName: string } } } }).error.details
                    .changedBy?.displayName,
            ).toBe("Bildbezug Redakteurin");

            // Der Ortseditor und die Verwendungen der Medienverwaltung lesen den Zustand.
            const slotsResponse = await get(mediaSubjectSlotsUrl("place", ort.publicId), "reviewer");
            const slots = slotsResponse.json() as MediaSubjectSlots;
            expect(
                Value.Check(MediaSubjectSlots, slots),
                JSON.stringify([...Value.Errors(MediaSubjectSlots, slots)]),
            ).toBe(true);
            expect(slots.header?.items[0]?.relation).toEqual({
                value: "place_view",
                rule: "type_image",
                override: "place_view",
                places: 0,
            });
            const usage = (await get(mediaEditorUsageUrl(bild.publicId), "reviewer")).json() as MediaUsageResult;
            expect(
                Value.Check(MediaUsageResult, usage),
                JSON.stringify([...Value.Errors(MediaUsageResult, usage)]),
            ).toBe(true);
            expect(usage.usages.map((entry) => entry.relation?.value)).toEqual(["place_view"]);

            // Zurück auf die Regel.
            const back = await post("editor", body(null, await revision()));
            expect(back.statusCode, back.body).toBe(200);
            expect((await resolvePlaceMedia(database, ort.publicId)).map((view) => view.relation)).toEqual([
                "type_image",
            ]);
            // Ein Bild, das hier nicht hängt: 409 media_not_bound; ein falscher Wert: 400.
            expect(
                code(
                    await post("editor", {
                        ...body("type_image", await revision()),
                        assetId: "6d656469-0000-4000-8000-00000000ffff",
                    }),
                ),
            ).toBe("409 media_not_bound");
            expect(code(await post("editor", { ...body("ortsansicht", await revision()) }))).toBe(
                "400 validation_failed",
            );
        });

        it("an der direkten Bindung zählt die Revision der Bindung, das Protokoll nennt sie", async () => {
            await cleanMediaFixtures(database);
            const ort = await insertPlace(database, 85);
            const bild = await insertAsset(database, {
                ref: "bb-op-direkt",
                rights: OWN_CLEARED,
                published: [{ variant: PUBLISHED_VARIANT.header }],
            });
            const [binding] = await database<{ id: string; revision: number }[]>`
            INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${ort.id}, ${bild.id}, 'header', 'legacy')
            RETURNING id::text, revision::int AS revision
        `;
            const actor: MediaActor = { personId: people.get("editor")!.id, environment: "test" };
            const receipt = await setHeaderRelation(database, actor, {
                operationId: operation(),
                placeId: ort.publicId,
                assetId: bild.publicId,
                via: "binding",
                value: "type_image",
                baseRevision: binding!.revision,
            });
            expect(receipt.affected).toEqual([
                { kind: "header", id: `place:${ort.publicId}`, revision: binding!.revision + 1 },
            ]);
            const [audit] = await database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT action, details FROM media_audit_event WHERE operation_id = ${receipt.operationId}::uuid
        `;
            expect(audit).toEqual({
                action: "binding.header_relation_set",
                details: {
                    binding: `place_media:${binding!.id}`,
                    subject: `place:${ort.publicId}`,
                    relation: "type_image",
                    previous: null,
                },
            });
            // Die Galerie-Verwendung gibt es hier nicht.
            await expect(
                setHeaderRelation(database, actor, {
                    operationId: operation(),
                    placeId: ort.publicId,
                    assetId: bild.publicId,
                    via: "gallery",
                    value: null,
                    baseRevision: 1,
                }),
            ).rejects.toMatchObject({ statusCode: 409, code: "media_not_bound" });
        });
    },
);

describeWithDatabase("Bildbezug: kein Zug hebt die Übersteuerung auf (Schutzregel)", { timeout: 180_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let editor: TestPerson;

    const SPECS: ItemSpec[] = [
        { cls: "settlement_image", subject: importPlace(31), url: "/uploads/siedlungen/bb/a.webp", sort: 0 },
        { cls: "settlement_image", subject: importPlace(31), url: "/uploads/siedlungen/bb/b.webp", sort: 1 },
    ];

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
        editor = await fixture.person("editor", { name: "Bildbezug Zug" });
        await cleanEditorMedia(database, [editor.id]);
        await cleanLegacyMedia(database);
    }, 120_000);

    afterAll(async () => {
        await cleanEditorMedia(database, [editor.id]);
        await cleanLegacyMedia(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    it("🔴 erneuter Zug, neue Folge, Rückzug und Rückkehr: die Übersteuerung bleibt am Eintrag", async () => {
        await insertSubjects(database, { places: [31] });
        await importMedia(database, manifestOf(SPECS, "private"));
        const item = async () => {
            const [row] = await database<
                { override: string | null; retired: boolean; galleryRevision: number; galleryOrigin: string }[]
            >`
                SELECT i.image_relation_override AS override, i.retired_at IS NOT NULL AS retired,
                       g.revision::int AS "galleryRevision", g.origin AS "galleryOrigin"
                  FROM media_gallery_item i
                  JOIN media_gallery g ON g.id = i.gallery_id
                  JOIN media_asset a ON a.id = i.media_asset_id
                 WHERE a.source_ref LIKE '%/uploads/siedlungen/bb/b.webp'
            `;
            return row!;
        };
        const [asset] = await database<{ public_id: string }[]>`
            SELECT a.public_id::text FROM media_asset a WHERE a.source_ref LIKE '%/uploads/siedlungen/bb/b.webp'
        `;
        await setHeaderRelation(
            database,
            { personId: editor.id, environment: "test" },
            {
                operationId: operation(),
                placeId: importPlace(31),
                assetId: asset!.public_id,
                value: "place_view",
                baseRevision: (await item()).galleryRevision,
            },
        );
        // Die Galerie bleibt Legacys: Der Bildbezug ist keine Entscheidung über die Folge.
        expect(await item()).toMatchObject({ override: "place_view", retired: false, galleryOrigin: "legacy" });

        await importMedia(database, manifestOf(SPECS, "private"));
        expect((await item()).override).toBe("place_view");
        // Legacy dreht die Folge um: der Eintrag wandert, die Übersteuerung bleibt.
        await importMedia(
            database,
            manifestOf(
                SPECS.map((spec) => ({ ...spec, sort: 1 - (spec.sort ?? 0) })),
                "private",
            ),
        );
        expect(await item()).toMatchObject({ override: "place_view", retired: false });
        // Legacy nennt das Bild nicht mehr: zurückgezogen, nicht gelöscht; es kommt mit seiner Übersteuerung zurück.
        await importMedia(database, manifestOf([SPECS[0]!], "private"));
        expect(await item()).toMatchObject({ override: "place_view", retired: true });
        await importMedia(database, manifestOf(SPECS, "private"));
        expect(await item()).toMatchObject({ override: "place_view", retired: false });
    });
});
