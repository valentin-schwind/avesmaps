import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ApiErrorBody,
    EditConflictDetails,
    MAM_BASKETS,
    MEDIA_EDITOR_NAVIGATION_URL,
    MEDIA_EDITOR_URL,
    MamNavigation,
    MamSearchResult,
    MediaAssetDetail,
    MediaGalleryDetail,
    MediaUsageResult,
    PHOTOBOX_TERMS_VERSION,
    TERRITORY_COATS_URL,
    mediaEditorAssetUrl,
    mediaEditorGalleryUrl,
    mediaEditorUsageUrl,
    mediaPhotoboxUrl,
    photoboxUnterteilung,
    type MamAssetSummary,
    type PhotoboxEinreichung,
    type PhotoboxSubmissionState,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { apiErrorBody } from "../src/http/api-error.ts";
import { mediaBindingKey, mediaEditConflict } from "../src/media-editor/audit.ts";
import { MediaStore } from "../src/media/storage.ts";
import { resolvePlaceMedia, resolvePlaceMediaParts, resolveTerritoryMedia } from "../src/media/resolver.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { bildErsetzen } from "../src/photobox/status.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import {
    PRIVATE_VALUES,
    buildMediaWorld,
    cleanMediaWorld,
    operationId,
    type MediaWorld,
} from "./support/media-editor-world.ts";
import { einreichung, legeOrtAn, neueOperation, neueSpuren, pngUpload, raeumeAuf } from "./support/photobox-fixture.ts";

/**
 * Der Lesepfad der Medienverwaltung (WI-0068 P2) gegen echtes PostgreSQL.
 *
 * Problemfälle: ein Besucher, ein Tester (Editor-Ansicht ohne MAM) oder eine abgelaufene Anmeldung liest private Angaben; eine
 * öffentliche Antwort trägt Prompt, Rechtenotiz, Beleg, Hochlader oder Begründung; zwei Assets mit denselben Bytes verschmelzen
 * in der Reverse Usage; der Konflikt nennt den falschen Bearbeiter. Soll: ab Reviewer alles, darunter 401/403 vor jeder Prüfung
 * der Anfrage; je Verwendung die Entscheidung der Policy; „gleiche Datei“ als getrennter Hinweis.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const ROLES_WITH_MAM: readonly Role[] = ["reviewer", "editor", "admin", "operator"];

describeWithDatabase("Medienverwaltung: Lesepfad (WI-0068 P2)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    let world: MediaWorld;
    const cookies = new Map<Role, string>();
    const people = new Map<Role, TestPerson>();

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    const get = (url: string, role?: Role) =>
        app.inject({
            method: "GET",
            url,
            headers: role === undefined ? {} : { cookie: cookies.get(role) ?? "" },
        });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await cleanMediaWorld(database);
        fixture = authFixture(database);
        for (const role of ["tester", "reviewer", "editor", "admin", "operator"] as const) {
            const person = await fixture.person(role, { name: `MAM ${role}` });
            people.set(role, person);
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        world = await buildMediaWorld(database, {
            decider: people.get("editor")!.id,
            uploader: people.get("admin")!.id,
        });
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await cleanMediaWorld(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const urls = (): string[] => [
        `${MEDIA_EDITOR_URL}?q=mamweb`,
        MEDIA_EDITOR_NAVIGATION_URL,
        mediaEditorAssetUrl(world.coat.publicId),
        mediaEditorUsageUrl(world.coat.publicId),
        mediaEditorGalleryUrl(world.gallery.publicId),
    ];

    describe("Rechte: view_media_private, serverseitig", () => {
        it("🔴 Besucher 401, Tester 403; Reviewer, Editor, Admin und Betreiber lesen, ohne Cache", async () => {
            for (const url of urls()) {
                const anonymous = await get(url);
                expect([url, anonymous.statusCode, anonymous.json().error.code]).toEqual([url, 401, "unauthenticated"]);
                expect(Value.Check(ApiErrorBody, anonymous.json())).toBe(true);
                const tester = await get(url, "tester");
                expect([url, tester.statusCode, tester.json().error.code]).toEqual([url, 403, "forbidden"]);
                for (const role of ROLES_WITH_MAM) {
                    const allowed = await get(url, role);
                    expect([url, role, allowed.statusCode]).toEqual([url, role, 200]);
                    expect(allowed.headers["cache-control"]).toBe("no-store");
                }
            }
        });

        it("🔴 wer nicht darf, erfährt nichts über die Form der Anfrage: 401/403 vor der Prüfung der Kennung", async () => {
            for (const url of [mediaEditorAssetUrl("kein-uuid"), `${MEDIA_EDITOR_URL}?limit=9999`]) {
                expect((await get(url)).statusCode).toBe(401);
                expect((await get(url, "tester")).statusCode).toBe(403);
                const reviewer = await get(url, "reviewer");
                expect([url, reviewer.statusCode, reviewer.json().error.code]).toEqual([url, 400, "validation_failed"]);
            }
        });

        it("unbekannte Kennung: 404 im Umschlag", async () => {
            const missing = "6d656469-0000-4000-9000-00000000dead";
            for (const url of [
                mediaEditorAssetUrl(missing),
                mediaEditorUsageUrl(missing),
                mediaEditorGalleryUrl(missing),
            ]) {
                const response = await get(url, "reviewer");
                expect([url, response.statusCode, response.json().error.code]).toEqual([url, 404, "not_found"]);
            }
        });
    });

    describe("Private Felder", () => {
        it("🔴 hinter dem Recht stehen die privaten Angaben vollständig im Inspector", async () => {
            const response = await get(mediaEditorAssetUrl(world.coat.publicId), "reviewer");
            const detail = response.json();
            expect(
                Value.Check(MediaAssetDetail, detail),
                JSON.stringify([...Value.Errors(MediaAssetDetail, detail)]),
            ).toBe(true);
            expect(detail.creation).toMatchObject({
                prompt: PRIVATE_VALUES.prompt,
                negativePrompt: PRIVATE_VALUES.negativePrompt,
                tool: PRIVATE_VALUES.tool,
                parameters: { steps: 30 },
                legacyNoteRaw: PRIVATE_VALUES.legacyNote,
            });
            expect(detail.rights).toMatchObject({
                basis: "public_domain",
                creator: "Urheberin Alrike",
                rightsNote: PRIVATE_VALUES.rightsNote,
                legacyRightsCode: PRIVATE_VALUES.legacyRightsCode,
                reviewedBy: PRIVATE_VALUES.reviewedBy,
                reviewer: { id: people.get("editor")!.id, displayName: "MAM editor" },
            });
            // Der Hochlader ist eine Person, nicht der Urheber (WI-0068 §2 Nr. 5).
            expect(detail.ingest).toEqual([
                expect.objectContaining({
                    kind: "editor_upload",
                    actor: { id: people.get("admin")!.id, displayName: "MAM admin" },
                    originalFilename: PRIVATE_VALUES.filename,
                    legacyActorLabel: null,
                }),
            ]);
            expect(detail.evidence).toEqual([
                expect.objectContaining({
                    kind: "operator_note",
                    description: PRIVATE_VALUES.evidence,
                    viaRule: false,
                }),
            ]);
            expect(detail.legacySource).toMatchObject({ localUrl: PRIVATE_VALUES.localUrl, legacyPublic: true });
            // Dateien: das Original ohne Adresse, nur die veröffentlichten mit; der Schlüssel ist privat, aber da.
            const source = detail.representations.find(
                (file: { storageClass: string }) => file.storageClass === "private_source",
            );
            expect(source).toMatchObject({ url: null, sha256: world.bytes });
            expect(source.storageKey).toMatch(/^private\/source\//);
            for (const file of detail.representations.filter(
                (entry: { storageClass: string }) => entry.storageClass === "published",
            ))
                expect(file.url).toMatch(/^\/media\/sha256\//);
            // Der Notaus der Bytes, auch wenn er an ZWILLING ausgelöst wurde.
            expect(detail.suspensions).toEqual([
                expect.objectContaining({
                    sha256: world.bytes,
                    triggeredOn: world.twin.publicId,
                    reason: PRIVATE_VALUES.suspensionReason,
                    liftedAt: null,
                    fileState: "pending",
                }),
            ]);
            expect(detail).toMatchObject({ usageCount: 2, retiredUsageCount: 1, sharedFileCount: 1, history: [] });
            expect(detail.asset).toMatchObject({ id: world.coat.publicId, revision: 1, title: null, kind: "image" });
        });

        it("🔴 die Provenienz kommt aus media_ingest: ein Legacy-Login ist Text, nie eine Person", async () => {
            const detail = (await get(mediaEditorAssetUrl(world.header.publicId), "reviewer")).json();
            expect(detail.ingest).toEqual([
                expect.objectContaining({
                    kind: "legacy_import",
                    actor: null,
                    legacyActorLabel: PRIVATE_VALUES.legacyActor,
                    legacyUploadedAt: null,
                }),
            ]);
            expect(detail.rights).toMatchObject({ basis: "own_work", clearance: "legacy_assumed", reviewer: null });
            expect(detail.creation).toBeNull();
        });

        it("🔴 keine öffentliche Antwort trägt einen privaten Wert: Ort, Gebiet, Wappenliste", async () => {
            const antworten = async () => [
                JSON.stringify(await resolvePlaceMedia(database, world.place.publicId)),
                JSON.stringify(await resolveTerritoryMedia(database, world.territory.publicId)),
                (await app.inject({ method: "GET", url: TERRITORY_COATS_URL })).body,
            ];
            // 🔴 Der Notaus der Welt (an ZWILLING ausgelöst) hält beide Wappen zurück, auch ohne Quarantäne (S8-04).
            const gesperrt = await antworten();
            expect(gesperrt[0]).not.toContain(world.coat.publicId);
            expect(gesperrt[1]).not.toContain(world.twin.publicId);
            // Für die Probe hebt der Fall ihn auf und setzt danach einen neuen (eine aufgehobene Zeile ist endgültig, Migration 0088).
            const decider = people.get("editor")!.id;
            await database`
                UPDATE media_publication_suspension
                   SET lifted_at = now(), lifted_by_person = ${decider}::uuid, lift_reason = 'Probe', file_state = 'pending'
                 WHERE source_sha256 = ${world.bytes} AND lifted_at IS NULL
            `;
            try {
                const publicAnswers = await antworten();
                // Die Probe sieht etwas: das Wappen des Ortes und des Gebiets sind öffentlich.
                expect(publicAnswers[0]).toContain(world.coat.publicId);
                expect(publicAnswers[1]).toContain(world.twin.publicId);
                for (const answer of publicAnswers) {
                    for (const [field, value] of Object.entries(PRIVATE_VALUES))
                        expect(answer, field).not.toContain(value);
                    expect(answer).not.toContain("private/source");
                    expect(answer).not.toContain(people.get("editor")!.id);
                }
            } finally {
                await database`
                    INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                    VALUES (${world.bytes}, ${world.twin.id}, ${PRIVATE_VALUES.suspensionReason}, ${decider}::uuid)
                `;
            }
        });
    });

    describe("Reverse Usage", () => {
        it("🔴 direkte Bindung und Galerie, je mit der Entscheidung der Policy; zurückgezogen nur gezählt", async () => {
            const response = await get(mediaEditorUsageUrl(world.coat.publicId), "reviewer");
            const usage = response.json() as MediaUsageResult;
            expect(
                Value.Check(MediaUsageResult, usage),
                JSON.stringify([...Value.Errors(MediaUsageResult, usage)]),
            ).toBe(true);
            expect(usage.asset).toEqual({ id: world.coat.publicId, revision: 1 });
            expect(usage.retired).toBe(1);
            // Seit wann es die Verwendung gibt (WI-0068 R4): je Zeile ein Tag, aus der Anlage der Bindung oder des Eintrags.
            expect(usage.usages.map((entry) => entry.since)).toEqual([
                expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
                expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            ]);
            expect(
                usage.usages.map((entry) => [
                    entry.via,
                    entry.subject?.kind,
                    entry.subject?.id,
                    entry.role,
                    entry.gallery?.id ?? null,
                    entry.gallery?.position ?? null,
                    entry.override.state,
                    entry.publication,
                ]),
            ).toEqual([
                [
                    "binding",
                    "place",
                    world.place.publicId,
                    "coat",
                    null,
                    null,
                    "approved",
                    // Sonst automatisch öffentlich; der Notaus der Bytes hält es zurück (S8-04).
                    { public: false, reason: "publication_suspended" },
                ],
                [
                    "gallery",
                    "place",
                    world.place.publicId,
                    "header",
                    world.gallery.publicId,
                    1,
                    "blocked",
                    { public: false, reason: "blocked" },
                ],
            ]);
            expect(usage.usages[0]?.override).toEqual({
                state: "approved",
                decidedOn: "2026-10-02",
                decidedBy: { id: people.get("editor")!.id, displayName: "MAM editor" },
                reason: PRIVATE_VALUES.overrideReason,
                operatorQuote: PRIVATE_VALUES.operatorQuote,
            });
            expect(usage.usages[1]?.gallery).toMatchObject({ title: "Hafenbilder", kind: "object_gallery" });
        });

        it("🔴 gleiche Datei: zwei Werke bleiben zwei; die Stellen des anderen stehen getrennt als Hinweis", async () => {
            const coat = (await get(mediaEditorUsageUrl(world.coat.publicId), "reviewer")).json() as MediaUsageResult;
            expect(coat.usages.some((entry) => entry.subject?.kind === "territory")).toBe(false);
            expect(coat.sameFile).toEqual([
                {
                    asset: { id: world.twin.publicId, revision: 1, title: null, kind: "image" },
                    usages: [
                        expect.objectContaining({
                            via: "binding",
                            subject: {
                                kind: "territory",
                                id: world.territory.publicId,
                                name: "Mediengebiet 2",
                                active: true,
                            },
                            role: "coat",
                            publication: { public: false, reason: "publication_suspended" },
                        }),
                    ],
                },
            ]);
            // Andersherum ebenso, und KOPF mit eigenen Bytes hat keinen Zwilling.
            const twin = (await get(mediaEditorUsageUrl(world.twin.publicId), "reviewer")).json();
            expect(twin.usages).toHaveLength(1);
            expect(twin.sameFile.map((entry: { asset: { id: string } }) => entry.asset.id)).toEqual([
                world.coat.publicId,
            ]);
            expect(twin.sameFile[0].usages).toHaveLength(2);
            const header = (await get(mediaEditorUsageUrl(world.header.publicId), "reviewer")).json();
            expect(header.sameFile).toEqual([]);
            const unused = (await get(mediaEditorUsageUrl(world.unused.publicId), "reviewer")).json();
            expect(unused).toMatchObject({ usages: [], retired: 0, sameFile: [] });
        });
    });

    describe("Liste, Suche, Navigation", () => {
        const search = async (query: string) => {
            const response = await get(`${MEDIA_EDITOR_URL}?${query}`, "reviewer");
            expect(response.statusCode, response.body).toBe(200);
            const body = response.json();
            expect(Value.Check(MamSearchResult, body), JSON.stringify([...Value.Errors(MamSearchResult, body)])).toBe(
                true,
            );
            return body as MamSearchResult;
        };
        const ids = (result: MamSearchResult): string[] => result.items.map((item) => item.id);

        it("Suche über Quellschlüssel, Urheber und den Namen des verwendenden Fachobjekts; % ist Text", async () => {
            const world4 = [world.coat, world.twin, world.header, world.unused].map((asset) => asset.publicId).sort();
            expect(ids(await search("q=mamweb")).sort()).toEqual(world4);
            expect(ids(await search("q=urheberin%20alrike"))).toEqual([world.coat.publicId]);
            expect(ids(await search("q=Mediengebiet%202"))).toEqual([world.twin.publicId]);
            expect(ids(await search("q=Hafenbilder")).sort()).toEqual(
                [world.coat.publicId, world.header.publicId].sort(),
            );
            expect((await search("q=%25%25mamweb")).total).toBe(0);
        });

        it("🔴 ein Fachobjekt über Art und Kennung, nie über den Namen", async () => {
            expect(ids(await search(`subject=territory:${world.territory.publicId}`))).toEqual([world.twin.publicId]);
            expect(ids(await search(`subject=place:${world.place.publicId}&sort=name`)).sort()).toEqual(
                [world.coat.publicId, world.header.publicId].sort(),
            );
            expect((await search(`subject=citymap:${world.citymap.publicId}`)).total).toBe(0);
        });

        it("Prüfkörbe und Filter: unbenutzt, gleiche Datei, ausgeblendet, Rechte offen, Importannahme", async () => {
            const basket = async (name: string) => ids(await search(`q=mamweb&basket=${name}`)).sort();
            expect(await basket("unused")).toEqual([world.unused.publicId]);
            expect(await basket("shared_file")).toEqual([world.coat.publicId, world.twin.publicId].sort());
            expect(await basket("suspended")).toEqual([world.coat.publicId, world.twin.publicId].sort());
            expect(await basket("rights_open")).toEqual([world.header.publicId, world.unused.publicId].sort());
            expect(await basket("legacy_assumed")).toEqual([world.header.publicId]);
            expect(await basket("missing_file")).toEqual([world.unused.publicId]);
            expect(await basket("unpublished")).toEqual([world.unused.publicId]);
            expect(await basket("multiple")).toEqual([world.coat.publicId]);
            expect(ids(await search("q=mamweb&role=coat")).sort()).toEqual(
                [world.coat.publicId, world.twin.publicId].sort(),
            );
            expect(ids(await search("q=mamweb&clearance=legacy_assumed"))).toEqual([world.header.publicId]);
        });

        it("Eintrag der Liste: Name aus der ersten Verwendung, Zahlen, Vorschau, Sortierung und Seiten", async () => {
            const byUsage = await search("q=mamweb&sort=usage");
            expect(byUsage.items[0]).toMatchObject({
                id: world.coat.publicId,
                usageCount: 2,
                sharedFileCount: 1,
                suspended: true,
                published: true,
                rightsBasis: "public_domain",
                primaryUsage: {
                    subject: { kind: "place", id: world.place.publicId, name: "Medienort 1", active: true },
                    role: "coat",
                    gallery: null,
                },
            });
            expect(byUsage.items[0]!.preview?.url).toMatch(/^\/media\/sha256\//);
            const unused = byUsage.items.find((item) => item.id === world.unused.publicId);
            expect(unused).toMatchObject({ usageCount: 0, primaryUsage: null, preview: null, rightsBasis: null });

            const page = await search("q=mamweb&sort=name&limit=2&offset=2");
            expect(page).toMatchObject({ total: 4, limit: 2, offset: 2 });
            expect(page.items).toHaveLength(2);
            const beyond = await search("q=mamweb&limit=2&offset=10");
            expect(beyond).toMatchObject({ total: 4, items: [] });
        });

        it("Navigation zählt mit denselben Bedingungen wie die Körbe der Liste", async () => {
            const response = await get(MEDIA_EDITOR_NAVIGATION_URL, "reviewer");
            const navigation = response.json() as MamNavigation;
            expect(Value.Check(MamNavigation, navigation)).toBe(true);
            for (const basket of MAM_BASKETS) {
                expect([basket, navigation.baskets[basket]]).toEqual([
                    basket,
                    (await search(`basket=${basket}`)).total,
                ]);
            }
            expect(navigation.total).toBe((await search("limit=1")).total);
            expect(navigation.kinds.image + navigation.kinds.model_3d).toBe(navigation.total);
            expect(navigation.galleries).toBeGreaterThanOrEqual(1);
        });
    });

    it("Galerie als Objekt: Einträge in ihrer Folge, Cover als Asset, Bindung an den Ort, Revisionen", async () => {
        const response = await get(mediaEditorGalleryUrl(world.gallery.publicId), "reviewer");
        const gallery = response.json() as MediaGalleryDetail;
        expect(
            Value.Check(MediaGalleryDetail, gallery),
            JSON.stringify([...Value.Errors(MediaGalleryDetail, gallery)]),
        ).toBe(true);
        expect(gallery).toMatchObject({
            id: world.gallery.publicId,
            title: "Hafenbilder",
            kind: "object_gallery",
            origin: "legacy",
            publicationState: "published",
            coverAssetId: world.coat.publicId,
        });
        // Jeder Eintrag zählte die Revision der Galerie mit (Migration 0086), das Cover auch.
        expect(gallery.revision).toBeGreaterThanOrEqual(3);
        expect(gallery.items.map((item) => [item.asset.id, item.position, item.override.state])).toEqual([
            [world.header.publicId, 0, "none"],
            [world.coat.publicId, 1, "blocked"],
        ]);
        expect(gallery.items[1]?.override.reason).toBe(PRIVATE_VALUES.itemReason);
        expect(gallery.bindings).toEqual([
            {
                subject: { kind: "place", id: world.place.publicId, name: "Medienort 1", active: true },
                role: "header",
                origin: "legacy",
                retired: false,
                revision: 1,
            },
        ]);
    });

    describe("🔴 Konflikt mit „wer, wann“ aus dem Fachprotokoll (ADR-0020)", () => {
        async function recordChange(n: number, actor: string, action: string, targetRevision: number, details = {}) {
            const id = operationId(n);
            const receipt = {
                operationId: id,
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
            };
            await database`
                INSERT INTO media_operation (operation_id, request_hash, receipt, action, environment, actor_kind, actor_person_id, at)
                VALUES (${id}, sha256(${id}::bytea), ${database.json(receipt as never)}, ${action}, 'test', 'person', ${actor},
                        '2026-10-10T08:00:00Z')`;
            await database`
                INSERT INTO media_audit_event (operation_id, action, media_asset_public_id, target_revision, details)
                VALUES (${id}, ${action}, ${world.coat.publicId}, ${targetRevision}, ${database.json(details as never)})`;
        }

        it("der letzte Eintrag mit genau dieser Revision nennt Person und Zeit; im Umschlag gültig", async () => {
            await database`UPDATE media_asset SET title = 'Wappen von Medienort' WHERE id = ${world.coat.id}`;
            await recordChange(1, people.get("editor")!.id, "asset.title_changed", 2);
            const [row] = await database<
                { updated_at: Date }[]
            >`SELECT updated_at FROM media_asset WHERE id = ${world.coat.id}`;
            const error = await mediaEditConflict(
                database,
                { record: "asset", assetId: world.coat.publicId },
                { revision: 2, changedAt: row!.updated_at },
            );
            expect([error.statusCode, error.code]).toEqual([409, "edit_conflict"]);
            expect(error.details).toEqual({
                currentRevision: 2,
                changedAt: "2026-10-10T08:00:00.000Z",
                changedBy: { id: people.get("editor")!.id, displayName: "MAM editor" },
            });
            expect(Value.Check(EditConflictDetails, error.details)).toBe(true);
            expect(Value.Check(ApiErrorBody, apiErrorBody(error.code, error.message, error.details))).toBe(true);

            // Ein Import ändert danach (Revision 3, kein Fachprotokoll): kein falscher Name, die Zeit des Datensatzes.
            await database`UPDATE media_asset SET title = 'Wappen (Import)' WHERE id = ${world.coat.id}`;
            const [later] = await database<
                { updated_at: Date }[]
            >`SELECT updated_at FROM media_asset WHERE id = ${world.coat.id}`;
            const imported = await mediaEditConflict(
                database,
                { record: "asset", assetId: world.coat.publicId },
                { revision: 3, changedAt: later!.updated_at },
            );
            expect(imported.details).toEqual({ currentRevision: 3, changedAt: later!.updated_at.toISOString() });

            // Ein Eintrag über die Rechte (gleiche Zahl, anderer Datensatz) zählt für das Asset nicht.
            await recordChange(2, people.get("admin")!.id, "rights.reviewed", 3);
            const stillImport = await mediaEditConflict(
                database,
                { record: "asset", assetId: world.coat.publicId },
                { revision: 3, changedAt: later!.updated_at },
            );
            expect(stillImport.details).not.toHaveProperty("changedBy");
        });

        it("eine Bindung über ihren Schlüssel in details", async () => {
            const [binding] = await database<{ id: string; revision: string }[]>`
                SELECT id, revision FROM place_media WHERE media_asset_id = ${world.coat.id}`;
            const key = mediaBindingKey("place_media", binding!.id);
            await recordChange(3, people.get("operator")!.id, "binding.approved", Number(binding!.revision), {
                binding: key,
            });
            const found = await mediaEditConflict(
                database,
                { record: "binding", assetId: world.coat.publicId, binding: key },
                { revision: Number(binding!.revision), changedAt: new Date() },
            );
            expect(found.details?.["changedBy"]).toEqual({
                id: people.get("operator")!.id,
                displayName: "MAM operator",
            });
            const other = await mediaEditConflict(
                database,
                { record: "binding", assetId: world.coat.publicId, binding: mediaBindingKey("territory_media", 1) },
                { revision: Number(binding!.revision), changedAt: new Date() },
            );
            expect(other.details).not.toHaveProperty("changedBy");
        });
    });

    describe("groupFiles: bytegleiche Werke zusammenfassen (WI-0068 P6)", () => {
        it("🔴 der Boolean kommt aus dem QUERY-STRING an - sonst läuft der Filter still ins Leere", async () => {
            const alle = await get(`${MEDIA_EDITOR_URL}?limit=200`, "reviewer");
            const gruppiert = await get(`${MEDIA_EDITOR_URL}?groupFiles=true&limit=200`, "reviewer");
            expect(alle.statusCode).toBe(200);
            expect(gruppiert.statusCode, gruppiert.body).toBe(200);
            // 🪤 Ein Query-Parameter ist IMMER Text. Käme er als `"true"` durch, wäre `=== true` falsch und die Zahl
            // bliebe gleich - ohne Fehler, ohne Spur. Genau das ist hier der Prüfpunkt.
            expect(gruppiert.json().total).toBeLessThan(alle.json().total);
        });

        it("jede Zeile der gruppierten Liste führt ihre Gruppe", async () => {
            const antwort = await get(`${MEDIA_EDITOR_URL}?groupFiles=true&limit=200`, "reviewer");
            const zeilen = antwort.json().items as { id: string; fileGroup: string | null }[];
            expect(zeilen.every((zeile) => zeile.fileGroup === null || zeile.fileGroup === zeile.id)).toBe(true);
            const gruppen = zeilen.map((zeile) => zeile.fileGroup).filter((wert) => wert !== null);
            expect(new Set(gruppen).size, "keine Gruppe steht zweimal").toBe(gruppen.length);
        });
    });

    describe("Korb „PhotoBox-Uploads“ und die Einreichung im Asset (WI-0272 S3, Aufgabe 18)", () => {
        const spuren = neueSpuren();
        const orte: { id: string; publicId: string }[] = [];
        let mediaRoot = "";
        let store: MediaStore;
        let seed = 700;

        beforeAll(async () => {
            mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-mam-korb-"));
            store = new MediaStore(mediaRoot);
        });

        afterAll(async () => {
            await raeumeAuf(database, spuren);
            for (const ort of orte) await database`DELETE FROM place WHERE id = ${ort.id}::bigint`;
            if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
        });

        interface Fall {
            publicId: string;
            schluessel: string;
            id: string;
            assetId: string;
            assetPublicId: string;
        }

        /** Das aktuelle Asset einer Einreichung: das des jüngsten Eingangs. */
        async function aktuell(publicId: string): Promise<Pick<Fall, "id" | "assetId" | "assetPublicId">> {
            const [row] = await database<{ id: string; asset_id: string; asset_public_id: string }[]>`
                SELECT s.id::text AS id, a.id::text AS asset_id, a.public_id::text AS asset_public_id
                  FROM media_submission s
                  JOIN media_ingest i ON i.submission_id = s.id
                  JOIN media_asset a ON a.id = i.media_asset_id
                 WHERE s.public_id = ${publicId}::uuid
                 ORDER BY i.id DESC LIMIT 1`;
            return { id: row!.id, assetId: row!.asset_id, assetPublicId: row!.asset_public_id };
        }
        /** Reicht ein Bild ein (Zustand `incoming`, das Bild ist `pending`). */
        async function eingereicht(patch: Partial<PhotoboxEinreichung> = {}): Promise<Fall> {
            seed += 1;
            const body = await einreichung(spuren, seed, patch);
            const { publicId } = await einreichen(database, store, "test", body);
            return { publicId, schluessel: body.schluessel, ...(await aktuell(publicId)) };
        }
        /** Die technische Prüfung ist gelaufen, aber niemand hat den Übergang nachgezogen: die Einreichung steht noch auf `incoming`. */
        async function geprueft(patch: Partial<PhotoboxEinreichung> = {}): Promise<Fall> {
            const fall = await eingereicht(patch);
            await database`UPDATE media_asset SET technical_state = 'ok' WHERE id = ${fall.assetId}::bigint`;
            return fall;
        }
        const zustandVon = async (fall: Fall): Promise<{ state: string; revision: number }> => {
            const [row] = await database<{ state: string; revision: number }[]>`
                SELECT state, revision::int AS revision FROM media_submission WHERE id = ${fall.id}::bigint`;
            return row!;
        };
        /** Setzt den Zustand unmittelbar (eine Freigabe ohne ihre Spuren); `wartend` ist eine Beschreibung, die auf Prüfung wartet. */
        async function setzeZustand(fall: Fall, state: PhotoboxSubmissionState, wartend = false): Promise<void> {
            const hatAsset = state === "approved" || state === "offline";
            await database`UPDATE media_submission
                              SET state = ${state},
                                  approved_media_asset_id = ${hatAsset ? fall.assetId : null}::bigint,
                                  pending_description = ${wartend ? "Neu gefasst" : null}
                            WHERE id = ${fall.id}::bigint`;
            await database`UPDATE media_asset SET technical_state = 'ok' WHERE id = ${fall.assetId}::bigint`;
        }

        const liste = async (query: string): Promise<{ items: MamAssetSummary[]; total: number }> => {
            const antwort = await get(`${MEDIA_EDITOR_URL}?${query}`, "reviewer");
            expect(antwort.statusCode, antwort.body).toBe(200);
            const ergebnis = antwort.json() as { items: MamAssetSummary[]; total: number };
            expect(
                Value.Check(MamSearchResult, ergebnis),
                JSON.stringify([...Value.Errors(MamSearchResult, ergebnis)]),
            ).toBe(true);
            return ergebnis;
        };
        const navigation = async (): Promise<MamNavigation> => {
            const antwort = await get(MEDIA_EDITOR_NAVIGATION_URL, "reviewer");
            expect(antwort.statusCode, antwort.body).toBe(200);
            return antwort.json() as MamNavigation;
        };
        const detail = async (assetId: string): Promise<MediaAssetDetail> => {
            const antwort = await get(mediaEditorAssetUrl(assetId), "reviewer");
            expect(antwort.statusCode, antwort.body).toBe(200);
            const d = antwort.json() as MediaAssetDetail;
            expect(Value.Check(MediaAssetDetail, d), JSON.stringify([...Value.Errors(MediaAssetDetail, d)])).toBe(true);
            return d;
        };
        const senden = (aktion: "approve" | "ask", id: string, payload: Record<string, unknown>) =>
            app.inject({
                method: "POST",
                url: mediaPhotoboxUrl(id, aktion),
                payload,
                headers: { origin: TEST_ORIGIN, cookie: cookies.get("reviewer") ?? "" },
            });

        /** Zustände der Einreichung, mit und ohne wartende Beschreibung: je einer, mit dem Teil, in den er gehört. */
        const FAELLE: readonly { state: PhotoboxSubmissionState; wartend: boolean }[] = [
            { state: "incoming", wartend: false },
            { state: "technical_failed", wartend: false },
            { state: "pending", wartend: false },
            { state: "approved", wartend: true },
            { state: "changes_requested", wartend: false },
            { state: "approved", wartend: false },
            { state: "rejected", wartend: false },
            { state: "withdrawn", wartend: false },
            { state: "offline", wartend: false },
            { state: "expired", wartend: false },
        ];

        describe("Liste und Zähler", () => {
            const faelle: { fall: Fall; state: PhotoboxSubmissionState; wartend: boolean }[] = [];
            let vorher: MamNavigation;

            beforeAll(async () => {
                vorher = await navigation();
                for (const art of FAELLE) {
                    const fall = await eingereicht();
                    // `incoming` bleibt, wie es ist: das Bild ist noch `pending`, der Übergang kommt erst mit der geprüften Datei.
                    if (art.state !== "incoming") await setzeZustand(fall, art.state, art.wartend);
                    faelle.push({ fall, ...art });
                }
            });

            const meine = (items: MamAssetSummary[]): string[] =>
                items
                    .filter((item) => faelle.some(({ fall }) => fall.assetPublicId === item.id))
                    .map((item) => item.id);
            const dieseIds = (teil: (art: { state: PhotoboxSubmissionState; wartend: boolean }) => boolean): string[] =>
                faelle
                    .filter(teil)
                    .map(({ fall }) => fall.assetPublicId)
                    .sort();

            it("🔴 der Korb zeigt jede Einreichung und nur sie; die Zeile nennt Zustand und Unterteilung nach DERSELBEN Regel wie die Vertragsfunktion", async () => {
                const korb = await liste("basket=photobox_uploads&limit=200");
                expect(meine(korb.items).sort()).toEqual(dieseIds(() => true));
                expect(korb.items.map((item) => item.id)).not.toContain(world.coat.publicId);
                for (const { fall, state, wartend } of faelle) {
                    const zeile = korb.items.find((item) => item.id === fall.assetPublicId)!;
                    expect(zeile.submission, `${state}/${String(wartend)}`).toMatchObject({
                        zustand: state,
                        unterteilung: photoboxUnterteilung(state, wartend),
                        entstehung: "photo",
                        beschreibung: "Der Blick vom Hafen auf die Bucht",
                        ortName: null,
                    });
                }
            });

            it("die drei Unterteilungen filtern: offen, Rückfrage, erledigt", async () => {
                const erwartet = {
                    offen: dieseIds(({ state, wartend }) => photoboxUnterteilung(state, wartend) === "offen"),
                    rueckfrage: dieseIds(({ state }) => state === "changes_requested"),
                    erledigt: dieseIds(({ state, wartend }) => photoboxUnterteilung(state, wartend) === "erledigt"),
                };
                // Die Regel in Worten: offen = eingegangen, geprüft, und freigegeben mit wartender Beschreibung; ein technisch gescheitertes Bild ist erledigt (M11).
                expect(erwartet.offen).toHaveLength(3);
                expect(erwartet.rueckfrage).toHaveLength(1);
                expect(erwartet.erledigt).toHaveLength(6);
                const gescheitert = faelle.find(({ state }) => state === "technical_failed")!;
                expect(erwartet.erledigt).toContain(gescheitert.fall.assetPublicId);
                for (const teil of ["offen", "rueckfrage", "erledigt"] as const) {
                    const antwort = await liste(`basket=photobox_uploads&einreichung=${teil}&limit=200`);
                    expect([teil, meine(antwort.items).sort()]).toEqual([teil, erwartet[teil]]);
                    // Auch ohne den Korb filtert die Unterteilung (und lässt dann nur Einreichungen übrig).
                    const ohneKorb = await liste(`einreichung=${teil}&limit=200`);
                    expect([teil, meine(ohneKorb.items).sort()]).toEqual([teil, erwartet[teil]]);
                    expect(ohneKorb.items.every((item) => item.submission?.unterteilung === teil)).toBe(true);
                }
            });

            it("die Navigation zählt mit denselben Bedingungen: der Korb und seine drei Teile", async () => {
                const jetzt = await navigation();
                expect(Value.Check(MamNavigation, jetzt)).toBe(true);
                expect(jetzt.baskets.photobox_uploads - vorher.baskets.photobox_uploads).toBe(FAELLE.length);
                expect(jetzt.total - vorher.total).toBe(FAELLE.length);
                const v = vorher.einreichungen ?? { offen: 0, rueckfrage: 0, erledigt: 0 };
                expect(jetzt.einreichungen).toBeDefined();
                expect([
                    jetzt.einreichungen!.offen - v.offen,
                    jetzt.einreichungen!.rueckfrage - v.rueckfrage,
                    jetzt.einreichungen!.erledigt - v.erledigt,
                ]).toEqual([3, 1, 6]);
                // Die Teile ergeben den Korb, und die Liste zählt dasselbe wie die Navigation.
                expect(
                    jetzt.einreichungen!.offen + jetzt.einreichungen!.rueckfrage + jetzt.einreichungen!.erledigt,
                ).toBe(jetzt.baskets.photobox_uploads);
                for (const teil of ["offen", "rueckfrage", "erledigt"] as const) {
                    expect((await liste(`einreichung=${teil}&limit=1`)).total).toBe(jetzt.einreichungen![teil]);
                }
                expect((await liste("basket=photobox_uploads&limit=1")).total).toBe(jetzt.baskets.photobox_uploads);
            });

            it("ein Asset ohne Einreichung trägt keine und steht in keinem Teil", async () => {
                const alle = await liste("q=mamweb&limit=200");
                expect(alle.items.length).toBeGreaterThan(0);
                for (const item of alle.items) expect(item.submission ?? null, item.id).toBeNull();
            });

            it("🔴 ein ersetztes Bild zählt nicht mehr: im Korb steht das aktuelle Asset der Einreichung, nie das abgelehnte alte", async () => {
                const fall = await eingereicht();
                const alt = fall.assetPublicId;
                seed += 1;
                await bildErsetzen(database, store, "test", {
                    operationId: neueOperation(spuren),
                    schluessel: fall.schluessel,
                    bild: await pngUpload(seed),
                });
                const neu = (await aktuell(fall.publicId)).assetPublicId;
                expect(neu).not.toBe(alt);
                const korb = await liste("basket=photobox_uploads&limit=200");
                expect(korb.items.filter((item) => item.id === alt || item.id === neu).map((item) => item.id)).toEqual([
                    neu,
                ]);
                expect((await detail(neu)).submission?.publicId).toBe(fall.publicId);
                expect((await detail(alt)).submission).toBeUndefined();
            });
        });

        describe("das Asset trägt die Einreichung", () => {
            it("🔴 der Zustand wird vor dem Lesen nachgezogen: Liste, Zähler und Asset sehen `pending` mit der Revision NACH dem Übergang", async () => {
                for (const lesen of ["liste", "navigation", "asset"] as const) {
                    const fall = await geprueft();
                    expect((await zustandVon(fall)).state, lesen).toBe("incoming");
                    if (lesen === "liste") await liste("basket=photobox_uploads&limit=1");
                    else if (lesen === "navigation") await navigation();
                    else await detail(fall.assetPublicId);
                    expect((await zustandVon(fall)).state, lesen).toBe("pending");
                }
            });

            it("die Revision im Asset ist die, auf die die Operation baut: Freigeben mit ihr gelingt", async () => {
                const fall = await geprueft();
                const d = await detail(fall.assetPublicId);
                expect(d.submission).toMatchObject({ publicId: fall.publicId, zustand: "pending" });
                expect(d.submission!.revision).toBe((await zustandVon(fall)).revision);
                const antwort = await senden("approve", fall.publicId, {
                    operationId: neueOperation(spuren),
                    baseRevision: d.submission!.revision,
                });
                expect(antwort.statusCode, antwort.body).toBe(200);
                const danach = await detail(fall.assetPublicId);
                expect(danach.submission).toMatchObject({ zustand: "approved" });
                expect(danach.submission!.revision).toBeGreaterThan(d.submission!.revision);
            });

            it("alle Angaben des Einsenders und nichts darüber hinaus: Ort mit Typbild, Bezug, Blickrichtung, Name, Bedingungen", async () => {
                const ort = await legeOrtAn(database, "Korbort Ohne Ansicht");
                orte.push(ort);
                const fall = await geprueft({
                    placeId: ort.publicId,
                    bezug: { art: "landschaft", id: "name:Svellt" },
                    blickrichtung: 2,
                    name: "Alrik Testmann",
                    entstehung: "drawing",
                    nutzung: "cc-by-4.0",
                    lage: { x: 301, y: 302 },
                    beschreibung: "Der Hafen am Morgen",
                });
                const d = await detail(fall.assetPublicId);
                expect(d.submission).toEqual({
                    publicId: fall.publicId,
                    revision: expect.any(Number),
                    zustand: "pending",
                    eingereichtAm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
                    beschreibung: "Der Hafen am Morgen",
                    entstehung: "drawing",
                    nutzung: "cc-by-4.0",
                    blickrichtung: 2,
                    name: "Alrik Testmann",
                    lage: { x: 301, y: 302 },
                    ort: { publicId: ort.publicId, name: "Korbort Ohne Ansicht", typ: "stadt" },
                    bezug: { art: "landschaft", id: "name:Svellt" },
                    bedingungen: PHOTOBOX_TERMS_VERSION,
                    angepasst: false,
                    ortHatOrtsansicht: false,
                });
                // Nie der Statusschlüssel oder sein Hash, an keiner Stelle der Antwort.
                const roh = JSON.stringify(d);
                expect(roh).not.toContain(fall.schluessel);
                expect(roh).not.toMatch(/status_?key|statusKey/i);
            });

            it("🔴 ob der Ort eine Ortsansicht hat, sagt die Logik des Ortskopfs (öffentlich ausgelieferte Ortsansicht), nicht eine eigene Rechnung", async () => {
                const fall = await geprueft({ placeId: world.place.publicId });
                const erwartet = (await resolvePlaceMediaParts(database, world.place.publicId)).delivered.some(
                    (sicht) => sicht.role === "header" && sicht.relation === "place_view",
                );
                const d = await detail(fall.assetPublicId);
                expect(d.submission?.ort).toMatchObject({ publicId: world.place.publicId });
                expect(d.submission?.ortHatOrtsansicht).toBe(erwartet);
            });

            it("ohne Ort steht weder Ort noch Ortsansicht da; Rückfrage, wartende Beschreibung und „angepasst“ kommen aus der Einreichung", async () => {
                const fall = await geprueft();
                const d0 = await detail(fall.assetPublicId);
                expect(d0.submission).not.toHaveProperty("ort");
                expect(d0.submission).not.toHaveProperty("ortHatOrtsansicht");
                expect(d0.submission).not.toHaveProperty("nachricht");
                expect(d0.submission).not.toHaveProperty("wartendeBeschreibung");

                const frage = await senden("ask", fall.publicId, {
                    operationId: neueOperation(spuren),
                    baseRevision: d0.submission!.revision,
                    nachricht: "Welcher Hafen ist das?",
                });
                expect(frage.statusCode, frage.body).toBe(200);
                await database`UPDATE media_submission SET pending_description = 'Neu gefasst', adjusted_by_editors = true WHERE id = ${fall.id}::bigint`;
                const d1 = await detail(fall.assetPublicId);
                expect(d1.submission).toMatchObject({
                    zustand: "changes_requested",
                    nachricht: "Welcher Hafen ist das?",
                    wartendeBeschreibung: "Neu gefasst",
                    angepasst: true,
                });
            });

            it("ein Asset ohne Einreichung trägt das Feld nicht", async () => {
                expect(await detail(world.coat.publicId)).not.toHaveProperty("submission");
            });

            it("🔴 die Einreichung ist privat: ohne `view_media_private` gibt es weder Asset noch Korb (Besucher 401, Tester 403)", async () => {
                const fall = await geprueft();
                for (const url of [
                    mediaEditorAssetUrl(fall.assetPublicId),
                    `${MEDIA_EDITOR_URL}?basket=photobox_uploads`,
                ]) {
                    expect([url, (await get(url)).statusCode]).toEqual([url, 401]);
                    expect([url, (await get(url, "tester")).statusCode]).toEqual([url, 403]);
                }
            });
        });
    });
});
