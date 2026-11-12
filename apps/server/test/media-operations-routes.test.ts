import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ApiErrorBody,
    MEDIA_COAT_BIND_URL,
    MEDIA_COAT_NONE_URL,
    MEDIA_HEADER_SET_URL,
    MEDIA_LICENSES_URL,
    MEDIA_PUBLICATION_PREVIEW_URL,
    MEDIA_UPLOAD_BODY_LIMIT,
    MEDIA_UPLOAD_LIMITS,
    MEDIA_UPLOAD_URL,
    MEDIA_EDITOR_NAVIGATION_URL,
    MEDIA_EDITOR_URL,
    MamNavigation,
    MamSearchResult,
    MediaAssetDetail,
    MediaSubjectSlots,
    OperationReceipt,
    mediaCreationUrl,
    mediaEditorAssetUrl,
    mediaEvidenceUrl,
    mediaMetadataUrl,
    mediaRightsReviewUrl,
    mediaRightsUrl,
    mediaSubjectSlotsUrl,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { RASTER_LIMITS } from "../src/media/raster/limits.ts";
import { MediaStore } from "../src/media/storage.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import type { SystemStateSnapshot, SystemStateStore } from "../src/system/state-store.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertAsset, insertPlace, insertTerritory } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

/**
 * Der Schreibpfad der Medienverwaltung (WI-0068 P4a) gegen echtes PostgreSQL, über die echten Routen mit echten Sitzungen.
 *
 * Problemfälle: Ein Reviewer oder Tester schreibt; jemand prüft die Rechte am eigenen Hochgeladenen; eine ausführbare oder zu große
 * Datei landet im Speicher; eine Wiederholung legt ein zweites Asset an; ein veralteter Stand überschreibt den eines anderen; ein
 * Wappen „entfernen“ hinterlässt bloß einen leeren Platz; ein Bild wird öffentlich, ohne dass die Policy JA sagt; die Kartensperre
 * hält eine Operation nicht an. Soll: jede Handlung eine Operation mit Revision, Protokoll und Quittung; öffentlich nur über
 * `decidePublication`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

type Actor = Role | "editor2";

describeWithDatabase("Medienverwaltung: Schreibpfad (WI-0068 P4a)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let fixture: ReturnType<typeof authFixture>;
    const cookies = new Map<Actor, string>();
    const people = new Map<Actor, TestPerson>();

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    const send = (target: FastifyInstance, method: "GET" | "POST", url: string, actor?: Actor, payload?: unknown) =>
        target.inject({
            method,
            url,
            ...(payload === undefined ? {} : { payload: payload as object }),
            headers: { origin: TEST_ORIGIN, ...(actor === undefined ? {} : { cookie: cookies.get(actor) ?? "" }) },
        });
    const post = (url: string, actor: Actor | undefined, payload: unknown) => send(app, "POST", url, actor, payload);
    const get = (url: string, actor: Actor | undefined) => send(app, "GET", url, actor);

    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    /**
     * Jeder Upload ohne eigene Bytes bekommt ein eigenes Bild: Dieselben Bytes lehnt der Server ab (`media_already_exists`). Die
     * Farbe hängt am Seed modulo 256, deshalb zählt der Seed hoch statt zu würfeln; ab 100, unter den festen Seeds dieser Datei.
     */
    let naechsterSeed = 100;
    const upload = async (actor: Actor, overrides: Parameters<typeof uploadForm>[0] = {}, bytes?: Buffer) =>
        post(MEDIA_UPLOAD_URL, actor, {
            operationId: operation(),
            file: file(bytes ?? (await pngBytes(naechsterSeed++))),
            form: uploadForm(overrides),
        });

    /** Lädt hoch und gibt die Kennung des neuen Assets zurück. */
    const uploaded = async (actor: Actor = "editor", overrides: Parameters<typeof uploadForm>[0] = {}) => {
        const response = await upload(actor, overrides);
        expect(response.statusCode, response.body).toBe(200);
        const receipt = response.json() as OperationReceipt;
        return receipt.affected.find((entry) => entry.kind === "media_asset")!.id;
    };

    const editorAssets = async (): Promise<number> => {
        const [row] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM media_asset WHERE source_system = 'avesmaps3d'`;
        return row!.n;
    };

    const slots = async (kind: "place" | "territory", id: string) => {
        const response = await get(mediaSubjectSlotsUrl(kind, id), "reviewer");
        expect(response.statusCode, response.body).toBe(200);
        const body = response.json() as MediaSubjectSlots;
        expect(Value.Check(MediaSubjectSlots, body), JSON.stringify([...Value.Errors(MediaSubjectSlots, body)])).toBe(
            true,
        );
        return body;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanEditorMedia(database, []);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-mam-p4a-"));
        fixture = authFixture(database);
        for (const [actor, role, name] of [
            ["tester", "tester", "P4a Testerin"],
            ["reviewer", "reviewer", "P4a Reviewer"],
            ["editor", "editor", "P4a Redakteurin"],
            ["editor2", "editor", "P4a Zweiter Redakteur"],
            ["admin", "admin", "P4a Admin"],
            ["operator", "operator", "P4a Betreiberin"],
        ] as const) {
            const person = await fixture.person(role, { name });
            people.set(actor, person);
            cookies.set(actor, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 6 }),
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
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    describe("Rechte und Kartensperre", () => {
        it("🔴 schreiben: Besucher 401, Tester und Reviewer 403; Editor, Admin und Betreiber dürfen", async () => {
            const place = await insertPlace(database, 61);
            const coat = await insertAsset(database, { ref: "mamop-recht" });
            const writes: [string, unknown][] = [
                [MEDIA_UPLOAD_URL, { operationId: operation(), file: file(await pngBytes(1)), form: uploadForm() }],
                [
                    MEDIA_COAT_BIND_URL,
                    {
                        operationId: operation(),
                        subject: { kind: "place", id: place.publicId },
                        assetId: coat.publicId,
                        baseState: "undecided",
                    },
                ],
            ];
            for (const [url, payload] of writes) {
                expect(code(await post(url, undefined, payload)), url).toBe("401 unauthenticated");
                expect(code(await post(url, "tester", payload)), url).toBe("403 forbidden");
                expect(code(await post(url, "reviewer", payload)), url).toBe("403 forbidden");
            }
            for (const actor of ["editor", "admin", "operator"] as const) {
                expect(code(await upload(actor)), actor).toBe("200");
            }
            // Wer nicht darf, erfährt nichts über die Form der Anfrage.
            expect(code(await post(MEDIA_UPLOAD_URL, "reviewer", { kaputt: true }))).toBe("403 forbidden");
            expect(code(await post(MEDIA_UPLOAD_URL, "editor", { kaputt: true }))).toBe("400 validation_failed");
        });

        it("🔴 die Kartensperre hält jede Operation an (423 map_locked); wer nicht darf, bekommt zuerst 401/403", async () => {
            const snapshot: SystemStateSnapshot = {
                source: "database",
                mode: "normal",
                mapLock: true,
                systemLock: false,
                revision: 3,
                contentRevision: 1,
                readAt: new Date(),
                ready: true,
                listen: { connected: true, generation: 1, lastResyncAt: null },
            };
            const fake = {
                start: async () => undefined,
                close: async () => undefined,
                refresh: async () => snapshot,
                snapshot: () => snapshot,
                lockSetter: () => ({ since: new Date(), by: null, byLabel: "cli:test", reason: "Test" }),
                onChange: () => () => undefined,
            } as unknown as SystemStateStore;
            const locked = buildApp({
                config: config(),
                database: createDatabase(testDatabaseUrl as string, { max: 2 }),
                logStream: { write: () => undefined },
                systemState: fake,
            });
            await locked.ready();
            try {
                const before = await editorAssets();
                const payload = { operationId: operation(), file: file(await pngBytes(2)), form: uploadForm() };
                expect(code(await send(locked, "POST", MEDIA_UPLOAD_URL, "editor", payload))).toBe("423 map_locked");
                expect(code(await send(locked, "POST", MEDIA_UPLOAD_URL, undefined, payload))).toBe(
                    "401 unauthenticated",
                );
                expect(code(await send(locked, "POST", MEDIA_UPLOAD_URL, "reviewer", payload))).toBe("403 forbidden");
                const bind = {
                    operationId: operation(),
                    placeId: "6d656469-0000-4000-8000-00000000003d",
                    assetId: "6d656469-0000-4000-8000-00000000003d",
                };
                expect(code(await send(locked, "POST", MEDIA_HEADER_SET_URL, "editor", bind))).toBe("423 map_locked");
                // Lesen bleibt offen.
                expect(code(await send(locked, "GET", MEDIA_LICENSES_URL, "reviewer"))).toBe("200");
                expect(await editorAssets()).toBe(before);
            } finally {
                await locked.close();
            }
        });
    });

    describe("Hochladen über die Ingestion", () => {
        it("legt das Asset privat an: pending, Original unter private/source, Rechte ungeprüft, Hochlader als Person, Job und Protokoll", async () => {
            const bytes = await pngBytes(7, 160, 120);
            const operationId = operation();
            const response = await post(MEDIA_UPLOAD_URL, "editor", {
                operationId,
                file: file(bytes, "Mein Wappen.png"),
                form: uploadForm({
                    provenance: "eigene Zeichnung, Skizzenbuch 3",
                    rights: { basis: "own_work", creator: "Alrike" },
                }),
            });
            expect(response.statusCode, response.body).toBe(200);
            const receipt = response.json() as OperationReceipt;
            expect(Value.Check(OperationReceipt, receipt)).toBe(true);
            expect(receipt).toMatchObject({ operationId, status: "applied", environment: "test" });
            expect(receipt.derivedWork).toEqual([expect.objectContaining({ kind: "media_settle", state: "queued" })]);
            const assetId = receipt.affected.find((entry) => entry.kind === "media_asset")!.id;

            const [asset] = await database<
                { id: string; origin: string; title: string; technical_state: string; creation_method: string }[]
            >`
                SELECT id::text, origin, title, technical_state, creation_method FROM media_asset WHERE public_id = ${assetId}::uuid
            `;
            expect(asset).toMatchObject({
                origin: "editor_upload",
                title: "Wappen von Teststadt",
                technical_state: "pending",
                creation_method: "drawing",
            });
            const files = await database<
                { storage_class: string; storage_key: string; width: number; mime_type: string }[]
            >`
                SELECT storage_class, storage_key, width, mime_type FROM media_file WHERE media_asset_id = ${asset!.id}
            `;
            expect(files).toEqual([
                expect.objectContaining({ storage_class: "private_source", width: 160, mime_type: "image/png" }),
            ]);
            expect(files[0]?.storage_key).toMatch(
                /^private\/source\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/,
            );
            expect(existsSync(join(mediaRoot, files[0]!.storage_key))).toBe(true);
            // Nichts Öffentliches: kein Pfad unter published/, bevor die Policy entschieden hat.
            expect(existsSync(join(mediaRoot, "published"))).toBe(false);

            const [rights] = await database<{ rights_basis: string; clearance_state: string; creator: string }[]>`
                SELECT rights_basis, clearance_state, creator FROM media_rights WHERE media_asset_id = ${asset!.id}
            `;
            expect(rights).toEqual({ rights_basis: "own_work", clearance_state: "unreviewed", creator: "Alrike" });
            const [ingest] = await database<
                { ingest_kind: string; actor: string; original_filename: string; source_ref: string }[]
            >`
                SELECT ingest_kind, actor_person_id::text AS actor, original_filename, source_ref
                  FROM media_ingest WHERE media_asset_id = ${asset!.id}
            `;
            // Der Hochlader ist eine Person und nicht der Urheber (WI-0068 §2 Nr. 5).
            expect(ingest).toEqual({
                ingest_kind: "editor_upload",
                actor: people.get("editor")!.id,
                original_filename: "Mein Wappen.png",
                source_ref: "eigene Zeichnung, Skizzenbuch 3",
            });
            const audit = await database<{ action: string; details: Record<string, unknown> }[]>`
                SELECT action, details FROM media_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id
            `;
            expect(audit.map((row) => row.action)).toEqual(["asset.uploaded", "rights.set"]);
            expect(JSON.stringify(audit)).not.toContain("Mein Wappen");
            const [job] = await database<{ kind: string; state: string; actor_ref: string; input_ref: unknown }[]>`
                SELECT kind, state, actor_ref, input_ref FROM job WHERE public_id = ${receipt.derivedWork[0]!.jobId!}::uuid
            `;
            expect(job).toEqual({
                kind: "media_settle",
                state: "QUEUED",
                actor_ref: people.get("editor")!.id,
                input_ref: { asset: assetId, role: "coat" },
            });
        });

        it("dieselbe Kennung: dieselbe Quittung (replayed), kein zweites Asset; anderer Inhalt: 409 idempotency_key_reused", async () => {
            const payload = { operationId: operation(), file: file(await pngBytes(8)), form: uploadForm() };
            const first = await post(MEDIA_UPLOAD_URL, "editor", payload);
            const before = await editorAssets();
            const again = await post(MEDIA_UPLOAD_URL, "editor", payload);
            expect(again.json()).toEqual({ ...first.json(), status: "replayed" });
            expect(await editorAssets()).toBe(before);
            const other = await post(MEDIA_UPLOAD_URL, "editor", { ...payload, form: uploadForm({ title: "Anders" }) });
            expect(code(other)).toBe("409 idempotency_key_reused");
            expect(await editorAssets()).toBe(before);
        });

        it("🔴 Abweisung vor jedem Byte: Typ 415, Größe 413, Pixel und SVG mit Text 422, Anfrage über der Grenze 413", async () => {
            const before = await editorAssets();
            const sources = async () =>
                existsSync(join(mediaRoot, "private", "source"))
                    ? (await readdir(join(mediaRoot, "private", "source"), { recursive: true })).length
                    : 0;
            const sourcesBefore = await sources();
            const png = await pngBytes(9);
            const exe = Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "latin1"), Buffer.alloc(512, 1)]);
            const huge = Buffer.concat([png, Buffer.alloc(RASTER_LIMITS.maxRasterBytes + 1024, 0)]);
            const wide = Buffer.from(png);
            wide.writeUInt32BE(5000, 16);
            wide.writeUInt32BE(4000, 20);
            const text = Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>Gareth</text></svg>',
            );
            const cases: [string, Buffer, string, string][] = [
                ["ausführbar", exe, "415 unsupported_media_type", "unsupported_format"],
                ["zu groß", huge, "413 payload_too_large", "too_large_bytes"],
                ["zu viele Pixel", wide, "422 media_file_rejected", "too_many_pixels"],
                ["SVG mit Text", text, "422 media_file_rejected", "svg_has_text"],
            ];
            for (const [name, bytes, expected, reason] of cases) {
                const response = await upload("editor", {}, bytes);
                expect(code(response), name).toBe(expected);
                expect(Value.Check(ApiErrorBody, response.json()), name).toBe(true);
                expect((response.json() as { error: { details: { reason: string } } }).error.details.reason, name).toBe(
                    reason,
                );
            }
            const tooBig = await post(MEDIA_UPLOAD_URL, "editor", {
                operationId: operation(),
                file: { name: "riesig.png", dataBase64: "A".repeat(MEDIA_UPLOAD_BODY_LIMIT + 10) },
                form: uploadForm(),
            });
            expect(code(tooBig)).toBe("413 payload_too_large");
            expect(await editorAssets()).toBe(before);
            expect(await sources()).toBe(sourcesBefore);
            // Die Grenzen des Formulars sind die des Betreibers (D2), an einer Stelle gehalten.
            expect(MEDIA_UPLOAD_LIMITS).toEqual(RASTER_LIMITS);
        });

        it("Pflichtfelder je Rechtsgrundlage und die Prüfung als reine Funktion: 400 mit Pfad und Regel, nie mit dem Wert", async () => {
            const cases: [Parameters<typeof uploadForm>[0], { path: string; rule: string }[]][] = [
                [{ rights: { basis: "license" } }, [{ path: "rights.licenseKey", rule: "required" }]],
                [
                    { rights: { basis: "license", licenseKey: "cc-by-4.0" } },
                    [{ path: "rights.attribution", rule: "required_by_license" }],
                ],
                [
                    { rights: { basis: "license", licenseKey: "erfunden-1.0" } },
                    [{ path: "rights.licenseKey", rule: "unknown_license" }],
                ],
                [
                    { rights: { basis: "own_work", licenseKey: "cc0-1.0" } },
                    [{ path: "rights.licenseKey", rule: "only_with_license" }],
                ],
                [{ creation: { prompt: "ein Löwe" } }, [{ path: "creation.prompt", rule: "needs_ai_generated" }]],
                [{ title: "  " }, [{ path: "title", rule: "required" }]],
                // Freigeben beim Hochladen geht, nur nicht mit unbekannter Grundlage (WI-0282).
                [
                    { rights: { basis: "unknown" }, rightsReviewed: true },
                    [{ path: "rightsReviewed", rule: "not_allowed" }],
                ],
                [{ evidence: { kind: "license_page" } }, [{ path: "evidence.url", rule: "required" }]],
                [{ evidence: { kind: "source_page", url: "ftp://x" } }, [{ path: "evidence.url", rule: "not_http" }]],
            ];
            for (const [overrides, issues] of cases) {
                const response = await upload("editor", overrides);
                expect(code(response), JSON.stringify(overrides)).toBe("400 validation_failed");
                expect((response.json() as { error: { details: { issues: unknown } } }).error.details.issues).toEqual(
                    issues,
                );
                expect(response.body).not.toContain("ein Löwe");
            }
            // CC BY mit Namensnennung und KI mit Prompt gehen durch.
            expect(
                code(
                    await upload("editor", {
                        rights: { basis: "license", licenseKey: "cc-by-4.0", attribution: "Foto: Alrike, CC BY 4.0" },
                        creationMethod: "ai_generated",
                        creation: { tool: "Werkzeug", prompt: "ein Löwe" },
                    }),
                ),
            ).toBe("200");
        });

        it("Beleg: Datei privat unter private/evidence, Notiz als Text, Lizenzseite mit Adresse; ausführbar 415", async () => {
            const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");
            const assetId = await uploaded("editor", {
                evidence: { kind: "pdf", file: file(pdf, "genehmigung.pdf"), text: "Mail vom 2. Oktober" },
            });
            const evidence = async () =>
                database<
                    {
                        evidence_kind: string;
                        storage_key: string | null;
                        external_url: string | null;
                        description: string;
                    }[]
                >`
                    SELECT evidence_kind, storage_key, external_url, description FROM media_rights_evidence
                     WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid) ORDER BY id
                `;
            const [first] = await evidence();
            expect(first).toMatchObject({
                evidence_kind: "pdf",
                external_url: null,
                description: "Mail vom 2. Oktober",
            });
            expect(first?.storage_key).toMatch(/^private\/evidence\/sha256\/.*\.pdf$/);
            expect(existsSync(join(mediaRoot, first!.storage_key!))).toBe(true);

            const add = (evidencePayload: unknown) =>
                post(mediaEvidenceUrl(assetId), "editor", { operationId: operation(), evidence: evidencePayload });
            expect(code(await add({ kind: "operator_note", text: "Betreiber: eigenes Werk" }))).toBe("200");
            expect(code(await add({ kind: "license_page", url: "https://creativecommons.org/licenses/by/4.0/" }))).toBe(
                "200",
            );
            const exe = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(64, 0)]);
            expect(code(await add({ kind: "document", file: file(exe, "brief.exe") }))).toBe(
                "415 unsupported_media_type",
            );
            const html = Buffer.from("<html><script>alert(1)</script></html>");
            expect(code(await add({ kind: "email", file: file(html, "mail.txt") }))).toBe("415 unsupported_media_type");
            expect((await evidence()).map((row) => row.evidence_kind)).toEqual([
                "pdf",
                "operator_note",
                "license_page",
            ]);
        });
    });

    describe("Metadaten, Entstehung und Rechte", () => {
        it("Titel mit baseRevision; ein veralteter Stand 409 mit dem Bearbeiter aus dem Fachprotokoll", async () => {
            const assetId = await uploaded("editor");
            const first = await post(mediaMetadataUrl(assetId), "editor", {
                operationId: operation(),
                baseRevision: 1,
                title: "Löwenwappen",
            });
            expect(code(first)).toBe("200");
            const revision = (first.json() as OperationReceipt).affected[0]!.revision;
            expect(revision).toBe(2);
            const stale = await post(mediaMetadataUrl(assetId), "editor2", {
                operationId: operation(),
                baseRevision: 1,
                title: "Adlerwappen",
            });
            expect(code(stale)).toBe("409 edit_conflict");
            expect((stale.json() as { error: { details: unknown } }).error.details).toMatchObject({
                currentRevision: 2,
                changedBy: { id: people.get("editor")!.id, displayName: "P4a Redakteurin" },
            });
            const [row] = await database<
                { title: string }[]
            >`SELECT title FROM media_asset WHERE public_id = ${assetId}::uuid`;
            expect(row?.title).toBe("Löwenwappen");
        });

        it("Werkzeug und Prompt: Prompt nur bei KI-Erzeugung, nach dem Wechsel der Art geht es", async () => {
            const assetId = await uploaded("editor");
            const prompt = { operationId: operation(), creation: { tool: "Stift", prompt: "ein Löwe" } };
            const refused = await post(mediaCreationUrl(assetId), "editor", prompt);
            expect(code(refused)).toBe("400 validation_failed");
            expect((refused.json() as { error: { details: { issues: unknown } } }).error.details.issues).toEqual([
                { path: "creation.prompt", rule: "needs_ai_generated" },
            ]);
            expect(
                code(
                    await post(mediaMetadataUrl(assetId), "editor", {
                        operationId: operation(),
                        baseRevision: 1,
                        creationMethod: "ai_generated",
                    }),
                ),
            ).toBe("200");
            const set = await post(mediaCreationUrl(assetId), "editor", { ...prompt, operationId: operation() });
            expect(code(set)).toBe("200");
            const [creation] = await database<{ prompt: string; tool: string; revision: number }[]>`
                SELECT prompt, tool, revision::int AS revision FROM media_creation
                 WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
            `;
            expect(creation).toEqual({ prompt: "ein Löwe", tool: "Stift", revision: 1 });
            // Die Entstehung hat jetzt eine Revision: ohne sie ist es ein Konflikt.
            expect(code(await post(mediaCreationUrl(assetId), "editor", { ...prompt, operationId: operation() }))).toBe(
                "409 edit_conflict",
            );
        });

        it("Rechte setzen: neue Grundlage setzt den Prüfstand zurück (Warnung), Pflichtfelder gelten auch hier", async () => {
            const legacy = await insertAsset(database, {
                ref: "mamop-rechte",
                rights: { basis: "public_domain", clearance: "legacy_asserted" },
            });
            const [current] = await database<{ revision: number }[]>`
                SELECT revision::int AS revision FROM media_rights WHERE media_asset_id = ${legacy.id}
            `;
            const missing = await post(mediaRightsUrl(legacy.publicId), "editor", {
                operationId: operation(),
                baseRevision: current!.revision,
                rights: { basis: "license", licenseKey: "cc-by-sa-4.0" },
            });
            expect(code(missing)).toBe("400 validation_failed");
            const changed = await post(mediaRightsUrl(legacy.publicId), "editor", {
                operationId: operation(),
                baseRevision: current!.revision,
                rights: {
                    basis: "license",
                    licenseKey: "cc-by-sa-4.0",
                    attribution: "Foto: Wiki Aventurica",
                    rightsNote: "privat",
                },
            });
            expect(code(changed)).toBe("200");
            expect((changed.json() as OperationReceipt).warnings.map((warning) => warning.code)).toEqual([
                "clearance_reset",
            ]);
            const [rights] = await database<
                {
                    rights_basis: string;
                    license_key: string;
                    license_family: string;
                    clearance_state: string;
                    rights_note: string;
                }[]
            >`
                SELECT rights_basis, license_key, license_family, clearance_state, rights_note FROM media_rights
                 WHERE media_asset_id = ${legacy.id}
            `;
            expect(rights).toEqual({
                rights_basis: "license",
                license_key: "cc-by-sa-4.0",
                license_family: "cc-by-sa",
                clearance_state: "unreviewed",
                rights_note: "privat",
            });
        });

        it("🔴 S8-01: Rechte prüfen und setzen reihen den Abgleich ein; „abgelehnt“ nimmt die öffentliche Datei weg", async () => {
            const store = new MediaStore(mediaRoot);
            const place = await insertPlace(database, 68);
            // Gemeinfrei: erst mit „geprüft“ automatisch öffentlich.
            const assetId = await uploaded("editor", { rights: { basis: "public_domain" } });
            const settle = () => settleAssetFiles(database, store, { assetPublicId: assetId, role: "coat" });
            const published = async () =>
                database<{ storage_key: string }[]>`
                    SELECT storage_key FROM media_file WHERE storage_class = 'published'
                       AND media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
                `;
            const rechteRevision = async (): Promise<number> => {
                const [row] = await database<{ revision: number }[]>`
                    SELECT revision::int AS revision FROM media_rights
                     WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
                `;
                return row!.revision;
            };
            const abgleiche = (response: { json(): unknown }): number =>
                (response.json() as OperationReceipt).derivedWork.filter((work) => work.kind === "media_settle").length;

            // Ohne Verwendung gibt es nichts abzugleichen.
            const ohneVerwendung = await post(mediaRightsReviewUrl(assetId), "editor2", {
                operationId: operation(),
                baseRevision: await rechteRevision(),
                decision: "needs_review",
            });
            expect(code(ohneVerwendung)).toBe("200");
            expect(abgleiche(ohneVerwendung)).toBe(0);

            const bound = await post(MEDIA_COAT_BIND_URL, "editor", {
                operationId: operation(),
                subject: { kind: "place", id: place.publicId },
                assetId,
                baseState: "undecided",
            });
            expect(code(bound)).toBe("200");
            const geprueft = await post(mediaRightsReviewUrl(assetId), "editor2", {
                operationId: operation(),
                baseRevision: await rechteRevision(),
                decision: "cleared",
            });
            expect(abgleiche(geprueft)).toBe(1);
            expect(await settle()).toMatchObject({ published: true });
            const [datei] = await published();
            expect(existsSync(join(mediaRoot, datei!.storage_key))).toBe(true);

            // „Abgelehnt“: Der Abgleich nimmt die Datei unter `published/` weg, nicht erst eine spätere Operation.
            const abgelehnt = await post(mediaRightsReviewUrl(assetId), "editor2", {
                operationId: operation(),
                baseRevision: await rechteRevision(),
                decision: "rejected",
            });
            expect(code(abgelehnt)).toBe("200");
            expect(abgleiche(abgelehnt)).toBe(1);
            expect(await settle()).toMatchObject({ published: false });
            expect(await published()).toEqual([]);
            expect(existsSync(join(mediaRoot, datei!.storage_key))).toBe(false);

            // Rechte setzen: nur eine Notiz ändert die Entscheidung nicht, eine andere Grundlage schon.
            const nurNotiz = await post(mediaRightsUrl(assetId), "editor", {
                operationId: operation(),
                baseRevision: await rechteRevision(),
                rights: { basis: "public_domain", rightsNote: "nur eine Notiz" },
            });
            expect(code(nurNotiz)).toBe("200");
            expect(abgleiche(nurNotiz)).toBe(0);
            const neueGrundlage = await post(mediaRightsUrl(assetId), "editor", {
                operationId: operation(),
                baseRevision: await rechteRevision(),
                rights: { basis: "own_work", creator: "Redaktion Avesmaps" },
            });
            expect(code(neueGrundlage)).toBe("200");
            expect(abgleiche(neueGrundlage)).toBe(1);
        });

        it("🔴 „Rechte geprüft“: auch am eigenen Hochgeladenen (WI-0282); wer review_media_rights hat, darf, ein Reviewer nicht", async () => {
            const assetId = await uploaded("editor");
            const review = (actor: Actor, decision = "cleared") =>
                post(mediaRightsReviewUrl(assetId), actor, { operationId: operation(), baseRevision: 1, decision });
            expect(code(await review("reviewer"))).toBe("403 forbidden");
            expect(code(await review("editor"))).toBe("200");
            const [rights] = await database<{ clearance_state: string; reviewer: string; reviewed: boolean }[]>`
                SELECT clearance_state, reviewed_by_person::text AS reviewer, reviewed_at IS NOT NULL AS reviewed FROM media_rights
                 WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
            `;
            expect(rights).toEqual({ clearance_state: "cleared", reviewer: people.get("editor")!.id, reviewed: true });
            // Eine unbekannte Grundlage lässt sich nicht als geprüft freigeben.
            const unknown = await uploaded("editor", { rights: { basis: "unknown" } });
            const refused = await post(mediaRightsReviewUrl(unknown), "editor2", {
                operationId: operation(),
                baseRevision: 1,
                decision: "cleared",
            });
            expect(code(refused)).toBe("400 validation_failed");
        });
    });

    describe("Editoren geben frei, auch die eigenen Uploads (WI-0282, Betreiber 2026-11-06)", () => {
        const rechteVon = async (assetId: string) => {
            const [zeile] = await database<{ clearance_state: string; reviewer: string | null; reviewed: boolean }[]>`
                SELECT clearance_state, reviewed_by_person::text AS reviewer, reviewed_at IS NOT NULL AS reviewed FROM media_rights
                 WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
            `;
            return zeile!;
        };
        const revisionVon = async (assetId: string) => {
            const [zeile] = await database<{ revision: number }[]>`
                SELECT revision::int AS revision FROM media_rights
                 WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
            `;
            return zeile!.revision;
        };
        const vorschau = async (query: string) => {
            const antwort = await get(`${MEDIA_PUBLICATION_PREVIEW_URL}?${query}`, "editor");
            expect(antwort.statusCode, antwort.body).toBe(200);
            return antwort.json() as { public: boolean; reason: string };
        };

        it("🔴 schon beim Hochladen: „rightsReviewed“ setzt den Prüfstand, protokolliert den eigenen Upload, ohne bleibt es offen", async () => {
            const frei = await uploaded("editor", { rightsReviewed: true });
            expect(await rechteVon(frei)).toEqual({
                clearance_state: "cleared",
                reviewer: people.get("editor")!.id,
                reviewed: true,
            });
            const [eintrag] = await database<{ details: { decision: string; eigenerUpload: boolean } }[]>`
                SELECT details FROM media_audit_event
                 WHERE media_asset_public_id = ${frei}::uuid AND action = 'rights.reviewed'
            `;
            expect(eintrag?.details).toMatchObject({ decision: "cleared", eigenerUpload: true });
            const offen = await uploaded("editor");
            expect(await rechteVon(offen)).toEqual({ clearance_state: "unreviewed", reviewer: null, reviewed: false });
        });

        it("🔴 jede bekannte Rechtslage: Der Satz unter dem Formular sagt mit Freigabe öffentlich, ohne wartend", async () => {
            for (const lage of [
                "basis=license&licenseKey=cc-by-4.0",
                "basis=permission",
                "basis=fan_policy",
                "basis=own_work",
                "basis=public_domain",
            ]) {
                for (const role of ["header", "coat", "map_full", "map_preview", "literature_cover"]) {
                    const antwort = await vorschau(`role=${role}&${lage}&clearance=cleared&creation=photo`);
                    expect(antwort, `${role} ${lage}`).toMatchObject({ public: true, reason: "automatic" });
                }
            }
            expect(await vorschau("role=map_full&basis=license&licenseKey=cc-by-4.0&creation=photo")).toMatchObject({
                public: false,
                reason: "clearance_pending",
            });
            // Unbekannt bleibt zu, auch mit Prüfstand; das Reisebild bleibt bei seiner Regel.
            expect(await vorschau("role=header&basis=unknown&clearance=cleared")).toMatchObject({ public: false });
        });

        it("🔴 Community-Upload: Die Lizenz ändert nur der Betreiber; Nennung und Freigabe bleiben möglich", async () => {
            const assetId = await uploaded("editor2", {
                role: "map_full",
                rights: { basis: "license", licenseKey: "cc-by-4.0", attribution: "Karte: Rohaja, CC BY 4.0" },
            });
            await database`UPDATE media_asset SET origin = 'community_upload' WHERE public_id = ${assetId}::uuid`;
            const setze = async (actor: Actor, rights: object) =>
                post(mediaRightsUrl(assetId), actor, {
                    operationId: operation(),
                    baseRevision: await revisionVon(assetId),
                    rights,
                });
            const neueLizenz = { basis: "license", licenseKey: "cc-by-sa-4.0", attribution: "Karte: Rohaja" };
            expect(code(await setze("editor", neueLizenz))).toBe("403 community_license_locked");
            expect(code(await setze("admin", neueLizenz))).toBe("403 community_license_locked");
            expect(code(await setze("editor", { basis: "public_domain" }))).toBe("403 community_license_locked");
            // Dieselbe Lizenz, andere Nennung: keine Lizenzänderung.
            expect(
                code(
                    await setze("editor", {
                        basis: "license",
                        licenseKey: "cc-by-4.0",
                        attribution: "Karte: Rohaja Hesindian, CC BY 4.0",
                    }),
                ),
            ).toBe("200");
            // Freigeben dürfen Editoren.
            const review = await post(mediaRightsReviewUrl(assetId), "editor", {
                operationId: operation(),
                baseRevision: await revisionVon(assetId),
                decision: "cleared",
            });
            expect(code(review)).toBe("200");
            expect(code(await setze("operator", neueLizenz))).toBe("200");
            // Der eigene Upload ist keine Ausnahme von der Ausnahme, ein Editor-Upload bleibt frei.
            const eigenes = await uploaded("editor", { rights: { basis: "own_work" } });
            const anders = await post(mediaRightsUrl(eigenes), "editor", {
                operationId: operation(),
                baseRevision: await revisionVon(eigenes),
                rights: { basis: "public_domain" },
            });
            expect(code(anders)).toBe("200");
        });
    });

    describe("Bindungen für den Ortseditor", () => {
        it("Wappen am Ort: setzen, ersetzen mit Revision, veraltet 409, entfernen ist „bewusst ohne“, wieder setzen", async () => {
            const place = await insertPlace(database, 62);
            const first = await insertAsset(database, { ref: "mamop-wappen-1" });
            const second = await insertAsset(database, { ref: "mamop-wappen-2" });
            const subject = { kind: "place", id: place.publicId };
            expect((await slots("place", place.publicId)).coat).toMatchObject({ state: "undecided", revision: null });

            const set = await post(MEDIA_COAT_BIND_URL, "editor", {
                operationId: operation(),
                subject,
                assetId: first.publicId,
                baseState: "undecided",
            });
            expect(code(set)).toBe("200");
            const setRevision = (set.json() as OperationReceipt).affected[0]!.revision!;
            const afterSet = await slots("place", place.publicId);
            expect(afterSet.coat).toMatchObject({ state: "set", origin: "editor", revision: setRevision });
            expect(afterSet.coat.asset?.id).toBe(first.publicId);

            // Ein zweiter Editor mit dem alten Stand („kein Entscheid“) verliert.
            const stale = await post(MEDIA_COAT_BIND_URL, "editor2", {
                operationId: operation(),
                subject,
                assetId: second.publicId,
                baseState: "undecided",
            });
            expect(code(stale)).toBe("409 edit_conflict");
            expect((stale.json() as { error: { details: unknown } }).error.details).toMatchObject({
                currentRevision: setRevision,
                changedBy: { id: people.get("editor")!.id },
            });
            expect(
                code(
                    await post(MEDIA_COAT_BIND_URL, "editor2", {
                        operationId: operation(),
                        subject,
                        assetId: first.publicId,
                        baseRevision: setRevision,
                    }),
                ),
            ).toBe("409 media_already_bound");

            const replaced = await post(MEDIA_COAT_BIND_URL, "editor2", {
                operationId: operation(),
                subject,
                assetId: second.publicId,
                baseRevision: setRevision,
            });
            expect(code(replaced)).toBe("200");
            expect((replaced.json() as OperationReceipt).derivedWork).toHaveLength(2);
            const afterReplace = await slots("place", place.publicId);
            expect(afterReplace.coat.asset?.id).toBe(second.publicId);

            const none = await post(MEDIA_COAT_NONE_URL, "editor", {
                operationId: operation(),
                subject,
                baseRevision: afterReplace.coat.revision,
            });
            expect(code(none)).toBe("200");
            const afterNone = await slots("place", place.publicId);
            expect(afterNone.coat).toEqual({ state: "none", origin: "editor", revision: null, asset: null });
            const [suppression] = await database<{ origin: string }[]>`
                SELECT origin FROM place_media_suppression WHERE place_id = ${place.id} AND role = 'coat'
            `;
            expect(suppression?.origin).toBe("editor");
            // Das Asset bleibt; die Bindungen sind zurückgezogen, nicht gelöscht.
            const [bindings] = await database<{ active: number; retired: number }[]>`
                SELECT count(*) FILTER (WHERE retired_at IS NULL)::int AS active, count(*) FILTER (WHERE retired_at IS NOT NULL)::int AS retired
                  FROM place_media WHERE place_id = ${place.id}
            `;
            expect(bindings).toEqual({ active: 0, retired: 2 });

            // Aus „bewusst ohne“ heraus: der gesehene Zustand muss „none“ sein; das frühere Bild kommt als Zeile zurück.
            expect(
                code(
                    await post(MEDIA_COAT_BIND_URL, "editor", {
                        operationId: operation(),
                        subject,
                        assetId: first.publicId,
                        baseState: "undecided",
                    }),
                ),
            ).toBe("409 edit_conflict");
            const back = await post(MEDIA_COAT_BIND_URL, "editor", {
                operationId: operation(),
                subject,
                assetId: first.publicId,
                baseState: "none",
            });
            expect(code(back)).toBe("200");
            expect((await slots("place", place.publicId)).coat).toMatchObject({ state: "set", origin: "editor" });
            const actions = await database<{ action: string; subject: string }[]>`
                SELECT e.action, e.details ->> 'subject' AS subject FROM media_audit_event e
                 WHERE e.details ->> 'subject' = ${`place:${place.publicId}`} ORDER BY e.id
            `;
            // Ein Asset ohne Titel bekommt beim ersten Binden den Namen aus dem Ort (Betreiber 2026-10-10), einmal: beim Zurückkommen
            // hat es ihn schon.
            expect(actions.map((row) => row.action)).toEqual([
                "binding.coat_set",
                "asset.title_derived",
                "binding.coat_released",
                "binding.coat_set",
                "asset.title_derived",
                "binding.coat_none",
                "binding.coat_set",
            ]);
            const titles = await database<{ title: string | null }[]>`
                SELECT title FROM media_asset WHERE id IN (${first.id}, ${second.id}) ORDER BY id
            `;
            expect(titles.map((row) => row.title)).toEqual(["Wappen von Medienort 62", "Wappen von Medienort 62"]);
            expect((set.json() as OperationReceipt).affected).toEqual([
                { kind: "coat", id: `place:${place.publicId}`, revision: setRevision },
                { kind: "media_asset", id: first.publicId, revision: expect.any(Number) as number },
            ]);
        });

        it("Wappen am Gebiet; ein 3D-Modell ist kein Wappen (409)", async () => {
            const territory = await insertTerritory(database, 63);
            const coat = await insertAsset(database, { ref: "mamop-gebiet" });
            const model = await insertAsset(database, { ref: "mamop-modell", mediaKind: "model_3d", published: [] });
            const subject = { kind: "territory", id: territory.publicId };
            expect(
                code(
                    await post(MEDIA_COAT_BIND_URL, "editor", {
                        operationId: operation(),
                        subject,
                        assetId: model.publicId,
                        baseState: "undecided",
                    }),
                ),
            ).toBe("409 media_kind_not_bindable");
            expect(
                code(
                    await post(MEDIA_COAT_BIND_URL, "editor", {
                        operationId: operation(),
                        subject,
                        assetId: coat.publicId,
                        baseState: "undecided",
                    }),
                ),
            ).toBe("200");
            const territorySlots = await slots("territory", territory.publicId);
            expect(territorySlots.coat).toMatchObject({ state: "set", origin: "editor" });
            expect(territorySlots.header).toBeNull();
            expect(
                code(await get(mediaSubjectSlotsUrl("territory", "6d656469-0000-4000-8000-0000000000ff"), "reviewer")),
            ).toBe("404 not_found");
        });

        it("🔴 Hochladen, dann Binden: zwei Operationen auf einen Klick, ein Verlaufseintrag am Ort, „wartet auf Rechteprüfung“", async () => {
            const place = await insertPlace(database, 65);
            const assetId = await uploaded("editor", { title: "Neues Wappen" });
            const bound = await post(MEDIA_COAT_BIND_URL, "editor", {
                operationId: operation(),
                subject: { kind: "place", id: place.publicId },
                assetId,
                baseState: "undecided",
            });
            expect(code(bound)).toBe("200");
            const history = await database<{ action: string }[]>`
                SELECT action FROM media_audit_event WHERE details ->> 'subject' = ${`place:${place.publicId}`}
            `;
            expect(history).toEqual([{ action: "binding.coat_set" }]);
            const coat = (await slots("place", place.publicId)).coat;
            expect(coat.asset).toMatchObject({
                id: assetId,
                title: "Neues Wappen",
                technicalState: "pending",
                uploadedBy: { id: people.get("editor")!.id, displayName: "P4a Redakteurin" },
                publication: { public: false },
            });
        });
    });

    describe("Name beim Hochladen aus der Auswahl (7b)", () => {
        it("🔴 der Name nach der Regel kommt mit den Plätzen; unverändert hochgeladen vergibt ihn die Bindung als abgeleiteten", async () => {
            const place = await insertPlace(database, 67);
            const vorschlag = (await slots("place", place.publicId)).suggestedTitles!;
            expect(vorschlag.coat).toMatch(/^Wappen von /);
            expect(vorschlag.header).toMatch(/^Bild von .*\(1\)$/);
            // Mit Name und „aus der Bindung“ zugleich: 400.
            const doppelt = await upload("editor", { title: "Wappen", titleFromBinding: true });
            expect(code(doppelt)).toBe("400 validation_failed");

            const assetId = await uploaded("editor", { title: "", titleFromBinding: true });
            const titel = async () =>
                (
                    await database<
                        { title: string | null }[]
                    >`SELECT title FROM media_asset WHERE public_id = ${assetId}::uuid`
                )[0]!.title;
            expect(await titel()).toBeNull();
            const bound = await post(MEDIA_COAT_BIND_URL, "editor", {
                operationId: operation(),
                subject: { kind: "place", id: place.publicId },
                assetId,
                baseState: "undecided",
            });
            expect(code(bound)).toBe("200");
            expect(await titel()).toBe(vorschlag.coat);
            const ereignisse = await database<{ action: string }[]>`
                SELECT action FROM media_audit_event WHERE media_asset_public_id = ${assetId}::uuid ORDER BY id
            `;
            expect(ereignisse.map((e) => e.action)).toContain("asset.title_derived");
            expect(ereignisse.map((e) => e.action)).not.toContain("asset.metadata_set");
        });
    });

    describe("Abgleich der Dateien (Jobart media_settle) und Lesen", () => {
        it("🔴 öffentlich nur, wenn die Policy JA sagt; ein Notaus der Bytes hält jede öffentliche Datei zurück; Lösen nimmt sie weg", async () => {
            const store = new MediaStore(mediaRoot);
            const place = await insertPlace(database, 66);
            // Gemeinfrei, ungeprüft: keine Regel trägt das (die Klassenregeln gelten eigenem Werk, Fan-Richtlinie, Erlaubnis).
            const assetId = await uploaded("editor", { rights: { basis: "public_domain" } });
            const settle = () => settleAssetFiles(database, store, { assetPublicId: assetId, role: "coat" });
            const published = async () =>
                database<{ storage_key: string }[]>`
                    SELECT storage_key FROM media_file WHERE storage_class = 'published'
                       AND media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
                `;
            // Die private Vorschau (WI-0068 P4b): da, solange das Bild privat bleibt.
            const intern = async () =>
                database<{ storage_key: string; variant: string }[]>`
                    SELECT storage_key, variant FROM media_file WHERE storage_class = 'derivative'
                       AND media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${assetId}::uuid)
                `;
            const privateUrl = async () => {
                const detail = (await get(mediaEditorAssetUrl(assetId), "editor")).json() as MediaAssetDetail;
                return detail.representations.find((datei) => datei.storageClass === "derivative")?.privateUrl ?? null;
            };

            // Ohne Verwendung: technisch geprüft, nichts öffentlich; die private Vorschau liegt unter derivatives/.
            expect(await settle()).toMatchObject({ technicalState: "ok", published: false, unchanged: false });
            expect(await published()).toEqual([]);
            const [vorschau] = await intern();
            expect(vorschau?.variant).toMatch(/^intern_coat/);
            expect(vorschau?.storage_key).toMatch(/^derivatives\//);
            expect(existsSync(join(mediaRoot, vorschau!.storage_key))).toBe(true);
            expect((await settle()).unchanged).toBe(true);

            // 🔴 Der geschützte Bildweg: nur mit view_media_private, nie aus einem Cache, nie als etwas anderes als ein Bild.
            const url = await privateUrl();
            expect(url).toBe(`${mediaEditorAssetUrl(assetId)}/preview/${vorschau!.variant}`);
            const bild = await get(url!, "editor");
            expect(bild.statusCode).toBe(200);
            expect(bild.headers["content-type"]).toBe("image/webp");
            expect(bild.headers["cache-control"]).toBe("no-store");
            expect(bild.headers["x-content-type-options"]).toBe("nosniff");
            expect(bild.headers["content-security-policy"]).toBe("default-src 'none'");
            expect(bild.rawPayload.subarray(8, 12).toString("latin1")).toBe("WEBP");
            expect(code(await get(url!, "tester"))).toBe("403 forbidden");
            expect(code(await get(url!, undefined))).toBe("401 unauthenticated");
            expect(code(await get(`${mediaEditorAssetUrl(assetId)}/preview/source`, "editor"))).toBe(
                "400 validation_failed",
            );
            expect(code(await get(`${mediaEditorAssetUrl(assetId)}/preview/intern_header_16_9`, "editor"))).toBe(
                "404 not_found",
            );
            const bound = await post(MEDIA_COAT_BIND_URL, "editor", {
                operationId: operation(),
                subject: { kind: "place", id: place.publicId },
                assetId,
                baseState: "undecided",
            });
            expect(code(bound)).toBe("200");
            // Ungeprüft und ohne Regel: weiter nichts öffentlich („wartet auf Rechteprüfung“).
            const pending = await settle();
            expect(pending.published).toBe(false);
            expect((await slots("place", place.publicId)).coat.asset?.publication.public).toBe(false);

            const geprueft = await post(mediaRightsReviewUrl(assetId), "editor2", {
                operationId: operation(),
                baseRevision: 1,
                decision: "cleared",
            });
            expect(code(geprueft)).toBe("200");
            // S8-01: Die Prüfung reiht den Abgleich der gebundenen Rolle ein; gerechnet wird im Worker, im Test nie von selbst.
            expect((geprueft.json() as OperationReceipt).derivedWork.map((work) => work.kind)).toEqual([
                "media_settle",
            ]);
            // Geprüft, aber noch nicht gerechnet: Die Entscheidung erlaubt es, die öffentliche Datei fehlt („Fehlende Derivate“, 6c).
            const imKorb = async (): Promise<boolean> => {
                const result = (
                    await get(`${MEDIA_EDITOR_URL}?basket=missing_derivative&limit=200`, "editor")
                ).json() as MamSearchResult;
                return result.items.some((item) => item.id === assetId);
            };
            const fehlend = async (): Promise<number> =>
                ((await get(MEDIA_EDITOR_NAVIGATION_URL, "editor")).json() as MamNavigation).baskets.missing_derivative;
            expect(await imKorb()).toBe(true);
            const vorher = await fehlend();
            expect(vorher).toBeGreaterThan(0);
            expect(await settle()).toMatchObject({ published: true, technicalState: "ok" });
            expect(await imKorb()).toBe(false);
            expect(await fehlend()).toBe(vorher - 1);
            const [file1] = await published();
            expect(existsSync(join(mediaRoot, file1!.storage_key))).toBe(true);
            // Öffentlich: die private Vorschau fällt weg, samt Datei und Adresse.
            expect(await intern()).toEqual([]);
            expect(existsSync(join(mediaRoot, vorschau!.storage_key))).toBe(false);
            expect(code(await get(url!, "editor"))).toBe("404 not_found");
            expect((await slots("place", place.publicId)).coat.asset?.publication).toEqual({
                public: true,
                reason: "automatic",
            });
            expect((await settle()).unchanged).toBe(true);

            // Notaus der Bytes: die öffentliche Datei fällt weg, der Notaus selbst bleibt unberührt.
            const [source] = await database<{ sha256: string; id: string }[]>`
                SELECT f.sha256, a.id::text AS id FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
                 WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'private_source'
            `;
            await database`
                INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                VALUES (${source!.sha256}, ${source!.id}, 'Test', ${people.get("operator")!.id})
            `;
            const held = await settle();
            expect(held).toMatchObject({ published: false, reasons: ["suspended"] });
            // Was ein Notaus hält, fehlt nicht: Es ist absichtlich offline (eigener Korb).
            expect(await imKorb()).toBe(false);
            expect(held.findings).toContain("suspended_held");
            // 🔴 S8-04: Der Abgleich lässt die veröffentlichte Zeile und ihre Datei stehen; aus der Zeile rechnet die Quarantäne, welche
            // Datei sie hält (der Job media_quarantine bewegt sie). Gezeigt wird das Bild trotzdem nicht mehr.
            expect(await published()).toHaveLength(1);
            expect(existsSync(join(mediaRoot, file1!.storage_key))).toBe(true);
            expect((await slots("place", place.publicId)).coat.asset?.publication).toEqual({
                public: false,
                reason: "publication_suspended",
            });
            // Was der Notaus hält, sehen Editoren weiter: über die private Vorschau.
            expect(await intern()).toHaveLength(1);
            await database`
                UPDATE media_publication_suspension SET lifted_at = now(), lifted_by_person = ${people.get("operator")!.id}
                 WHERE source_sha256 = ${source!.sha256} AND lifted_at IS NULL
            `;
            expect((await settle()).published).toBe(true);
            // Nach dem Aufheben wieder öffentlich: dieselbe Zeile, die private Vorschau fällt weg.
            expect(await published()).toEqual([{ storage_key: file1!.storage_key }]);
            expect(await intern()).toEqual([]);

            // „bewusst ohne“: keine Verwendung mehr, die öffentliche Datei fällt weg.
            const revision = (await slots("place", place.publicId)).coat.revision;
            expect(
                code(
                    await post(MEDIA_COAT_NONE_URL, "editor", {
                        operationId: operation(),
                        subject: { kind: "place", id: place.publicId },
                        baseRevision: revision,
                    }),
                ),
            ).toBe("200");
            expect((await settle()).published).toBe(false);
            expect(await published()).toEqual([]);
            expect(await intern()).toHaveLength(1);
        });

        it("Lizenzkatalog und Vorschau der Veröffentlichung für das Formular, hinter view_media_private", async () => {
            expect(code(await get(MEDIA_LICENSES_URL, "tester"))).toBe("403 forbidden");
            const licenses = (await get(MEDIA_LICENSES_URL, "reviewer")).json() as {
                licenses: { key: string; requiresAttribution: boolean }[];
            };
            expect(licenses.licenses).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ key: "cc-by-4.0", requiresAttribution: true }),
                    expect.objectContaining({ key: "cc0-1.0", requiresAttribution: false }),
                ]),
            );
            const preview = async (query: string) =>
                (await get(`${MEDIA_PUBLICATION_PREVIEW_URL}?${query}`, "reviewer")).json();
            expect(await preview("role=coat&basis=public_domain&clearance=cleared")).toEqual({
                public: true,
                reason: "automatic",
            });
            expect(await preview("role=coat&basis=unknown")).toEqual({ public: false, reason: "rights_unknown" });
            expect(await preview("role=header&basis=license&licenseKey=cc-by-4.0")).toMatchObject({ public: false });
            expect(await preview("role=header&basis=license&licenseKey=cc-by-4.0&clearance=cleared")).toMatchObject({
                public: true,
            });
        });
    });
});
