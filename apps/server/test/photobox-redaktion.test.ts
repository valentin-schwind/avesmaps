import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    OperationReceipt,
    PhotoboxStatus,
    mediaPhotoboxUrl,
    type PhotoboxEinreichung,
    type PhotoboxRedaktionAktion,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore } from "../src/media/storage.ts";
import { readUsages } from "../src/migration/media-publication.ts";
import { technikNachziehen } from "../src/photobox/db.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { beschreibungSetzen, bildErsetzen, offlineNehmen, statusLesen, zurueckziehen } from "../src/photobox/status.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { file } from "./support/media-operations-fixture.ts";
import { einreichung, legeOrtAn, neueOperation, neueSpuren, raeumeAuf } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die Operationen der Redaktion an einer Reisebild-Einreichung (WI-0272 S3, Aufgabe 17, `photobox/redaktion.ts`) über die echten Routen mit echten
 * Sitzungen, gegen echtes PostgreSQL und einen echten Medienspeicher: freigeben, Rückfrage, ablehnen, korrigieren, offline nehmen.
 *
 * - Freigeben macht aus der Einreichung eine Verwendung (`photobox_media`), reiht den Abgleich ein und setzt beide Zustände; eine wartende Beschreibung
 *   übernimmt es. Die Quelle trägt schon seit dem Eingang keine Metadaten mehr, die Freigabe rührt keine Datei an.
 * - Jede Operation prüft die Revision der Einreichung (409 `edit_conflict`), zieht vorher den Übergang nach der technischen Prüfung nach und ist
 *   idempotent (M10).
 * - Rechte: `moderate_submissions` (ab Reviewer), Offline `publish_media` (ab Editor).
 */

const MARK_ORT = "Photobox-Redaktionsort";

describeWithDatabase("Reisebilder prüfen und freigeben (WI-0272 S3, Aufgabe 17)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: AuthFixture;
    const cookies = new Map<string, string>();
    const personen = new Map<string, { id: string; name: string }>();
    const spuren = neueSpuren();
    const orte: { id: string; publicId: string }[] = [];

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "photobox-redaktion-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-redaktion-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        for (const [name, rolle] of [
            ["tester", "tester"],
            ["reviewer", "reviewer"],
            ["editor", "editor"],
        ] as const) {
            const person = await fixture.person(rolle, { name: `Photobox ${name}` });
            personen.set(name, person);
            cookies.set(name, (await fixture.session(person.id)).cookie);
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
        await raeumeAuf(database, spuren);
        for (const ort of orte) await database`DELETE FROM place WHERE id = ${ort.id}::bigint`;
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    // --- Hilfen -------------------------------------------------------------------------------------------------------------------

    type Akteur = "tester" | "reviewer" | "editor" | undefined;

    const senden = (aktion: PhotoboxRedaktionAktion, id: string, akteur: Akteur, payload: Record<string, unknown>) =>
        app.inject({
            method: "POST",
            url: mediaPhotoboxUrl(id, aktion),
            payload,
            headers: { origin: TEST_ORIGIN, ...(akteur === undefined ? {} : { cookie: cookies.get(akteur) ?? "" }) },
        });
    const fehler = (antwort: { statusCode: number; json(): unknown }): string =>
        antwort.statusCode < 300
            ? String(antwort.statusCode)
            : `${String(antwort.statusCode)} ${(antwort.json() as { error: { code: string } }).error.code}`;

    /** WI-0291: der Fachcode einer Ablehnung (`details.reason`) samt weiteren Angaben, damit das Fenster den genauen Grund sagt. */
    const grund = (antwort: { json(): unknown }): unknown =>
        (antwort.json() as { error: { details?: Record<string, unknown> } }).error.details;

    interface Fall {
        body: PhotoboxEinreichung;
        publicId: string;
        id: string;
        assetId: string;
        assetPublicId: string;
    }

    /** Reicht ein Bild ein (S2) und gibt die Kennungen zurück; der Zustand ist `incoming`. */
    async function eingereicht(seed: number, patch: Partial<PhotoboxEinreichung> = {}): Promise<Fall> {
        const body = await einreichung(spuren, seed, patch);
        const { publicId } = await einreichen(database, store, "test", body);
        const [row] = await database<{ id: string; asset_id: string; asset_public_id: string }[]>`
            SELECT s.id::text AS id, a.id::text AS asset_id, a.public_id::text AS asset_public_id
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${publicId}::uuid
             ORDER BY i.id DESC LIMIT 1`;
        return { body, publicId, id: row!.id, assetId: row!.asset_id, assetPublicId: row!.asset_public_id };
    }

    /** Die technische Prüfung ist gelaufen (wie der Abgleich es tut) und die Liste der Redaktion hat den Übergang nachgezogen: `pending`. */
    async function bereit(seed: number, patch: Partial<PhotoboxEinreichung> = {}): Promise<Fall> {
        const fall = await eingereicht(seed, patch);
        await database`UPDATE media_asset SET technical_state = 'ok' WHERE id = ${fall.assetId}::bigint`;
        expect(await technikNachziehen(database, fall.id)).toBe(1);
        return fall;
    }

    interface Zeile {
        state: string;
        revision: number;
        description: string;
        pending_description: string | null;
        editor_message: string | null;
        adjusted_by_editors: boolean;
        approved_asset: string | null;
        decided: boolean;
        geaendert: Date;
        x: number;
        y: number;
        place_id: string | null;
        reference_kind: string | null;
        reference_key: string | null;
    }
    const zeile = async (fall: Fall): Promise<Zeile> => {
        const [row] = await database<Zeile[]>`
            SELECT state, revision::int AS revision, description, pending_description, editor_message, adjusted_by_editors,
                   approved_media_asset_id::text AS approved_asset, decided_at IS NOT NULL AS decided, state_changed_at AS geaendert,
                   ST_X(geom) AS x, ST_Y(geom) AS y, place_id::text AS place_id, reference_kind, reference_key
              FROM media_submission WHERE public_id = ${fall.publicId}::uuid`;
        return row!;
    };
    const moderation = async (fall: Fall): Promise<string> => {
        const [row] = await database<{ moderation_state: string }[]>`
            SELECT moderation_state FROM media_asset WHERE id = ${fall.assetId}::bigint`;
        return row!.moderation_state;
    };
    const verwendungen = async (fall: Fall) =>
        database<{ asset: string; retired: boolean; role: string }[]>`
            SELECT media_asset_id::text AS asset, retired_at IS NOT NULL AS retired, role
              FROM photobox_media WHERE media_submission_id = ${fall.id}::bigint`;
    const protokoll = async (operationId: string) =>
        database<{ action: string; asset: string | null; revision: number | null; details: Record<string, unknown> }[]>`
            SELECT action, media_asset_public_id::text AS asset, target_revision::int AS revision, details
              FROM media_audit_event WHERE operation_id = ${operationId}::uuid ORDER BY id`;
    const auftraege = async (fall: Fall) =>
        database<{ actor_ref: string | null; input_ref: Record<string, unknown> }[]>`
            SELECT actor_ref, input_ref FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ${fall.assetPublicId} ORDER BY id`;
    const quelle = async (fall: Fall) => {
        const [row] = await database<
            {
                id: string;
                storage_key: string;
                sha256: string;
                byte_size: string;
                mime_type: string;
                width: number;
                height: number;
            }[]
        >`
            SELECT id::text AS id, storage_key, sha256, byte_size::text AS byte_size, mime_type, width, height
              FROM media_file WHERE media_asset_id = ${fall.assetId}::bigint AND storage_class = 'private_source'`;
        return row!;
    };

    const body = (fall: Fall, baseRevision: number, felder: Record<string, unknown> = {}) => ({
        operationId: neueOperation(spuren),
        baseRevision,
        ...felder,
    });

    /** Ein JPEG mit GPS und Gerät im EXIF, 64 × 48, mit eigener Farbe je `seed`. */
    const jpegMitGps = async (seed: number): Promise<Buffer> =>
        sharp({
            create: {
                width: 64,
                height: 48,
                channels: 3,
                background: { r: (seed * 37) % 256, g: (seed * 91) % 256, b: 40 },
            },
        })
            .jpeg({ quality: 90 })
            .withExif({
                IFD0: { Make: "TestCam", Copyright: "Alrik Testmann" },
                IFD3: {
                    GPSLatitudeRef: "N",
                    GPSLatitude: "51/1 28/1 38/1",
                    GPSLongitudeRef: "E",
                    GPSLongitude: "7/1 0/1 12/1",
                },
            })
            .toBuffer();

    // --- Freigeben ----------------------------------------------------------------------------------------------------------------

    describe("freigeben", () => {
        it("🔴 legt Verwendung und Abgleichsauftrag an und setzt beide Zustände (Einreichung und Medium)", async () => {
            const fall = await bereit(1);
            const vorher = await zeile(fall);
            expect(vorher.state).toBe("pending");
            const antrag = body(fall, vorher.revision);

            const antwort = await senden("approve", fall.publicId, "reviewer", antrag);
            expect(fehler(antwort), antwort.body).toBe("200");
            const quittung = antwort.json() as OperationReceipt;
            expect(Value.Check(OperationReceipt, quittung)).toBe(true);
            expect(quittung.status).toBe("applied");

            const nachher = await zeile(fall);
            expect(nachher).toMatchObject({ state: "approved", decided: true, approved_asset: fall.assetId });
            expect(nachher.revision).toBeGreaterThan(vorher.revision);
            // Der Zustandswechsel setzt den Zeitpunkt (die Fristen der Aufbewahrung zählen ab hier).
            expect(nachher.geaendert.getTime()).toBeGreaterThan(vorher.geaendert.getTime());
            expect(quittung.affected).toEqual([
                { kind: "media_submission", id: fall.publicId, revision: nachher.revision },
            ]);
            expect(await moderation(fall)).toBe("approved");

            // Die Verwendung der Rolle photobox: aktiv, und readUsages nennt sie.
            expect(await verwendungen(fall)).toEqual([{ asset: fall.assetId, retired: false, role: "photobox" }]);
            expect(await readUsages(database, fall.assetId)).toEqual([
                { assetId: fall.assetId, role: "photobox", retired: false, override: "none", suppressed: false },
            ]);

            // Der Abgleich der Rolle photobox, ausgelöst von der Person der Redaktion (nicht anonym wie der der Einreichung).
            const reviewer = personen.get("reviewer")!;
            const abgleich = (await auftraege(fall)).filter((auftrag) => auftrag.actor_ref === reviewer.id);
            expect(abgleich).toEqual([
                { actor_ref: reviewer.id, input_ref: { asset: fall.assetPublicId, role: "photobox" } },
            ]);
            expect(quittung.derivedWork).toMatchObject([{ kind: "media_settle", state: "queued" }]);

            // Operation und Fachprotokoll: die Person, die Einreichung mit ihrer neuen Revision, am aktuellen Asset.
            const [operation] = await database<
                { action: string; actor_kind: string; actor_person_id: string | null }[]
            >`
                SELECT action, actor_kind, actor_person_id::text FROM media_operation WHERE operation_id = ${antrag.operationId}::uuid`;
            expect(operation).toEqual({
                action: "photobox.approve",
                actor_kind: "person",
                actor_person_id: reviewer.id,
            });
            expect(await protokoll(antrag.operationId)).toEqual([
                {
                    action: "photobox.approved",
                    asset: fall.assetPublicId,
                    revision: nachher.revision,
                    details: { previous: "pending", descriptionAccepted: false },
                },
            ]);
        });

        it("🔴 übernimmt eine wartende Beschreibung (und leert sie) und löscht eine frühere Rückfrage", async () => {
            const fall = await bereit(2, { beschreibung: "Die alte Fassung" });
            await database`
                UPDATE media_submission SET pending_description = 'Die neue Fassung', editor_message = 'Bitte genauer'
                 WHERE id = ${fall.id}::bigint`;
            const stand = await zeile(fall);
            const antwort = await senden("approve", fall.publicId, "reviewer", body(fall, stand.revision));
            expect(fehler(antwort), antwort.body).toBe("200");
            expect(await zeile(fall)).toMatchObject({
                state: "approved",
                description: "Die neue Fassung",
                pending_description: null,
                editor_message: null,
            });
        });

        it("auch aus der Rückfrage heraus: changes_requested wird approved", async () => {
            const fall = await bereit(3);
            const frage = await senden(
                "ask",
                fall.publicId,
                "reviewer",
                body(fall, (await zeile(fall)).revision, { nachricht: "Welcher Hafen?" }),
            );
            expect(fehler(frage), frage.body).toBe("200");
            const stand = await zeile(fall);
            expect(stand.state).toBe("changes_requested");
            const antwort = await senden("approve", fall.publicId, "reviewer", body(fall, stand.revision));
            expect(fehler(antwort), antwort.body).toBe("200");
            expect(await zeile(fall)).toMatchObject({ state: "approved", editor_message: null });
        });

        it("🔴 nach der Freigabe nimmt es eine wartende Beschreibung an: keine neue Verwendung, kein neuer Abgleich; ohne wartende Beschreibung 409", async () => {
            const fall = await bereit(4, { beschreibung: "Vor der Freigabe" });
            expect(
                fehler(await senden("approve", fall.publicId, "reviewer", body(fall, (await zeile(fall)).revision))),
            ).toBe("200");
            const frei = await zeile(fall);
            const auftraegeVorher = (await auftraege(fall)).length;

            // Nichts wartet: eine zweite Freigabe ist ein Übergang, den es nicht gibt.
            const zweite = await senden("approve", fall.publicId, "reviewer", body(fall, frei.revision));
            expect(fehler(zweite)).toBe("409 photobox_transition");
            expect(grund(zweite)).toEqual({ reason: "nichts_wartet", zustand: "approved" });

            await database`UPDATE media_submission SET pending_description = 'Nach der Freigabe geändert' WHERE id = ${fall.id}::bigint`;
            const stand = await zeile(fall);
            const antrag = body(fall, stand.revision);
            const antwort = await senden("approve", fall.publicId, "reviewer", antrag);
            expect(fehler(antwort), antwort.body).toBe("200");
            expect(await zeile(fall)).toMatchObject({
                state: "approved",
                description: "Nach der Freigabe geändert",
                pending_description: null,
            });
            // Der Zeitpunkt des Zustandswechsels bleibt (der Zustand wechselt nicht), es gibt weiter genau EINE Verwendung und keinen neuen Auftrag.
            expect((await zeile(fall)).geaendert.getTime()).toBe(frei.geaendert.getTime());
            expect(await verwendungen(fall)).toHaveLength(1);
            expect(await auftraege(fall)).toHaveLength(auftraegeVorher);
            expect((await protokoll(antrag.operationId))[0]).toMatchObject({
                action: "photobox.approved",
                details: { previous: "approved", descriptionAccepted: true },
            });
        });

        it("🔴 die Freigabe rührt die Quelle nicht an: Zeile, Hash und Datei bleiben; das EXIF ist schon beim Eingang weggefallen", async () => {
            const original = await jpegMitGps(1);
            expect(original.includes(Buffer.from("TestCam"))).toBe(true);
            const fall = await bereit(5, { bild: file(original, "foto.jpg") });
            const vorher = await quelle(fall);
            expect(vorher.mime_type).toBe("image/jpeg");
            // Die Quelle ist die Fassung ohne Metadaten, nicht die gesendete.
            const abgelegt = await store.read(vorher.storage_key, 1024 * 1024);
            expect(abgelegt.includes(Buffer.from("TestCam"))).toBe(false);
            expect((await sharp(abgelegt).metadata()).exif).toBeUndefined();

            const antrag = body(fall, (await zeile(fall)).revision);
            const antwort = await senden("approve", fall.publicId, "reviewer", antrag);
            expect(fehler(antwort), antwort.body).toBe("200");

            // Die Zeile der Quelle und die Datei sind unverändert.
            expect(await quelle(fall)).toEqual(vorher);
            const bytes = await store.read(vorher.storage_key, 1024 * 1024);
            expect(bytes.equals(abgelegt)).toBe(true);
            // Der Abgleich ist eingereiht (Rolle photobox, die Person der Redaktion), gelaufen ist er nicht.
            const reviewer = personen.get("reviewer")!;
            expect((await auftraege(fall)).filter((auftrag) => auftrag.actor_ref === reviewer.id)).toHaveLength(1);
            const [eintrag] = await protokoll(antrag.operationId);
            expect(eintrag!.details).toEqual({ previous: "pending", descriptionAccepted: false });
        });

        it("auch unter einem Notaus auf den Bytes geht die Freigabe durch: Er hält erst die Veröffentlichung an, die Quelle bleibt", async () => {
            const fall = await bereit(6, { bild: file(await jpegMitGps(3), "foto.jpg") });
            const vorher = await quelle(fall);
            await database`
                INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
                VALUES (${vorher.sha256}, ${fall.assetId}::bigint, 'Test', ${personen.get("editor")!.id}::uuid)`;
            try {
                const antwort = await senden(
                    "approve",
                    fall.publicId,
                    "reviewer",
                    body(fall, (await zeile(fall)).revision),
                );
                expect(fehler(antwort), antwort.body).toBe("200");
                expect(await moderation(fall)).toBe("approved");
                expect(await quelle(fall)).toEqual(vorher);
            } finally {
                await database`DELETE FROM media_publication_suspension WHERE media_asset_id = ${fall.assetId}::bigint`;
            }
        });

        it("🔴 zieht den Übergang nach der technischen Prüfung vorher nach: erst danach gilt die Revision, die die Liste der Redaktion zeigt", async () => {
            const fall = await eingereicht(10);
            const eingang = await zeile(fall);
            expect(eingang.state).toBe("incoming");
            // Noch ungeprüft: keine Freigabe.
            expect(fehler(await senden("approve", fall.publicId, "reviewer", body(fall, eingang.revision)))).toBe(
                "409 photobox_transition",
            );

            await database`UPDATE media_asset SET technical_state = 'ok' WHERE id = ${fall.assetId}::bigint`;
            // Mit der Revision von vorher: Das Nachziehen zählt die Revision hoch, also war der Stand veraltet. Die abgewiesene Operation rollt auch ihr
            // Nachziehen zurück (eine Transaktion); die Einreichung steht danach wie vorher da.
            expect(fehler(await senden("approve", fall.publicId, "reviewer", body(fall, eingang.revision)))).toBe(
                "409 edit_conflict",
            );
            expect(await zeile(fall)).toMatchObject({ state: "incoming", revision: eingang.revision });
            // Mit der Revision NACH dem Nachziehen (die Liste der Redaktion zieht nach und zeigt sie) geht die Freigabe in einem Zug.
            const antwort = await senden("approve", fall.publicId, "reviewer", body(fall, eingang.revision + 1));
            expect(fehler(antwort), antwort.body).toBe("200");
            expect((await zeile(fall)).state).toBe("approved");
        });
    });

    // --- Rückfrage und Ablehnung --------------------------------------------------------------------------------------------------

    describe("Rückfrage und Ablehnung", () => {
        it("🔴 eine Rückfrage zeigt auf der Statusseite die Nachricht und den Zustand, im Protokoll steht der Text nur unter note", async () => {
            const fall = await bereit(11);
            const vorher = await zeile(fall);
            const antrag = body(fall, vorher.revision, { nachricht: "  Welcher Hafen ist das?  " });
            const antwort = await senden("ask", fall.publicId, "reviewer", antrag);
            expect(fehler(antwort), antwort.body).toBe("200");

            const nachher = await zeile(fall);
            expect(nachher).toMatchObject({
                state: "changes_requested",
                editor_message: "Welcher Hafen ist das?",
                decided: true,
            });
            expect(nachher.geaendert.getTime()).toBeGreaterThan(vorher.geaendert.getTime());
            const status = await statusLesen(database, fall.body.schluessel);
            expect(Value.Check(PhotoboxStatus, status)).toBe(true);
            expect(status).toMatchObject({ zustand: "changes_requested", nachricht: "Welcher Hafen ist das?" });

            const [eintrag] = await protokoll(antrag.operationId);
            expect(eintrag).toMatchObject({ action: "photobox.asked", revision: nachher.revision });
            expect(eintrag!.details).toEqual({ previous: "pending", note: "Welcher Hafen ist das?" });
            // Das Asset bleibt wartend (nichts ist entschieden).
            expect(await moderation(fall)).toBe("pending");
        });

        it("eine zweite Rückfrage ersetzt die Nachricht, ohne den Zustandswechsel neu zu zählen", async () => {
            const fall = await bereit(12);
            expect(
                fehler(
                    await senden(
                        "ask",
                        fall.publicId,
                        "reviewer",
                        body(fall, (await zeile(fall)).revision, { nachricht: "Erste Frage" }),
                    ),
                ),
            ).toBe("200");
            const eins = await zeile(fall);
            expect(
                fehler(
                    await senden(
                        "ask",
                        fall.publicId,
                        "reviewer",
                        body(fall, eins.revision, { nachricht: "Zweite Frage" }),
                    ),
                ),
            ).toBe("200");
            const zwei = await zeile(fall);
            expect(zwei).toMatchObject({ state: "changes_requested", editor_message: "Zweite Frage" });
            expect(zwei.geaendert.getTime()).toBe(eins.geaendert.getTime());
        });

        it("🔴 die Antwort des Einsenders auf eine Rückfrage leert die Nachricht (Review M10): Beschreibung, neues Bild und Zurückziehen; die Statusseite zeigt keine alte Warnung", async () => {
            const einsender = async (seed: number) => {
                const fall = await bereit(seed);
                const frage = await senden(
                    "ask",
                    fall.publicId,
                    "reviewer",
                    body(fall, (await zeile(fall)).revision, { nachricht: "Welcher Hafen?" }),
                );
                expect(fehler(frage), frage.body).toBe("200");
                expect(await zeile(fall)).toMatchObject({
                    state: "changes_requested",
                    editor_message: "Welcher Hafen?",
                });
                expect(await statusLesen(database, fall.body.schluessel)).toMatchObject({
                    nachricht: "Welcher Hafen?",
                });
                return fall;
            };
            // Beschreibung geändert: zurück bei der Redaktion (pending).
            const beschrieben = await einsender(31);
            await beschreibungSetzen(database, "test", {
                operationId: neueOperation(spuren),
                schluessel: beschrieben.body.schluessel,
                beschreibung: "Der Hafen von Havena",
            });
            expect(await zeile(beschrieben)).toMatchObject({ state: "pending", editor_message: null });
            expect(await statusLesen(database, beschrieben.body.schluessel)).not.toHaveProperty("nachricht");

            // Neues Bild: zurück auf incoming.
            const ersetzt = await einsender(32);
            await bildErsetzen(database, store, "test", {
                operationId: neueOperation(spuren),
                schluessel: ersetzt.body.schluessel,
                bild: file(await jpegMitGps(32), "neu.jpg"),
            });
            expect(await zeile(ersetzt)).toMatchObject({ state: "incoming", editor_message: null });
            expect(await statusLesen(database, ersetzt.body.schluessel)).not.toHaveProperty("nachricht");

            // Zurückgezogen: Die Rückfrage gilt nicht mehr.
            const zurueck = await einsender(33);
            await zurueckziehen(database, "test", {
                operationId: neueOperation(spuren),
                schluessel: zurueck.body.schluessel,
            });
            expect(await zeile(zurueck)).toMatchObject({ state: "withdrawn", editor_message: null });
        });

        it("die Nachricht einer Ablehnung bleibt: sie ist der Grund und bleibt auf der Statusseite", async () => {
            const fall = await bereit(34);
            const antwort = await senden(
                "reject",
                fall.publicId,
                "reviewer",
                body(fall, (await zeile(fall)).revision, { grund: "Passt nicht nach Aventurien" }),
            );
            expect(fehler(antwort), antwort.body).toBe("200");
            expect(await zeile(fall)).toMatchObject({
                state: "rejected",
                editor_message: "Passt nicht nach Aventurien",
            });
        });

        it("🔴 ablehnen setzt das Asset auf rejected, die Einreichung auf rejected, der Grund steht auf der Statusseite und im Protokoll unter reason", async () => {
            const fall = await bereit(13);
            const vorher = await zeile(fall);
            const antrag = body(fall, vorher.revision, { grund: "Passt nicht nach Aventurien" });
            const antwort = await senden("reject", fall.publicId, "reviewer", antrag);
            expect(fehler(antwort), antwort.body).toBe("200");

            const nachher = await zeile(fall);
            expect(nachher).toMatchObject({
                state: "rejected",
                editor_message: "Passt nicht nach Aventurien",
                decided: true,
            });
            expect(nachher.geaendert.getTime()).toBeGreaterThan(vorher.geaendert.getTime());
            expect(await moderation(fall)).toBe("rejected");
            expect(await verwendungen(fall)).toEqual([]);
            expect(await statusLesen(database, fall.body.schluessel)).toMatchObject({
                zustand: "rejected",
                nachricht: "Passt nicht nach Aventurien",
            });
            const [eintrag] = await protokoll(antrag.operationId);
            expect(eintrag).toMatchObject({ action: "photobox.rejected", asset: fall.assetPublicId });
            expect(eintrag!.details).toEqual({ previous: "pending", reason: "Passt nicht nach Aventurien" });
            // Das Bild war nie öffentlich und die Quelle trägt keine Metadaten: Ablehnen reiht keinen Abgleich ein.
            const reviewer = personen.get("reviewer")!;
            expect((await auftraege(fall)).filter((auftrag) => auftrag.actor_ref === reviewer.id)).toEqual([]);
            expect((antwort.json() as OperationReceipt).derivedWork).toEqual([]);
            // Danach ist der Weg zu Ende.
            expect(fehler(await senden("approve", fall.publicId, "reviewer", body(fall, nachher.revision)))).toBe(
                "409 photobox_transition",
            );
            expect(
                fehler(
                    await senden(
                        "ask",
                        fall.publicId,
                        "reviewer",
                        body(fall, nachher.revision, { nachricht: "Doch?" }),
                    ),
                ),
            ).toBe("409 photobox_transition");
        });

        it("nach der Freigabe gibt es weder Rückfrage noch Ablehnung (dafür ist Offline da)", async () => {
            const fall = await bereit(14);
            expect(
                fehler(await senden("approve", fall.publicId, "reviewer", body(fall, (await zeile(fall)).revision))),
            ).toBe("200");
            const stand = await zeile(fall);
            expect(
                fehler(await senden("ask", fall.publicId, "reviewer", body(fall, stand.revision, { nachricht: "Hm" }))),
            ).toBe("409 photobox_transition");
            expect(
                fehler(
                    await senden("reject", fall.publicId, "reviewer", body(fall, stand.revision, { grund: "Nein" })),
                ),
            ).toBe("409 photobox_transition");
            expect(await zeile(fall)).toEqual(stand);
        });

        it("Nachricht und Grund: leer oder nur Leerraum ist 400, mehr als 1000 Zeichen ebenfalls; nichts wird geschrieben", async () => {
            const fall = await bereit(15);
            const stand = await zeile(fall);
            for (const [aktion, feld] of [
                ["ask", "nachricht"],
                ["reject", "grund"],
            ] as const) {
                for (const text of ["", "   ", "x".repeat(1001)]) {
                    const antwort = await senden(
                        aktion,
                        fall.publicId,
                        "reviewer",
                        body(fall, stand.revision, { [feld]: text }),
                    );
                    expect(fehler(antwort), `${aktion} ${String(text.length)}`).toBe("400 validation_failed");
                }
            }
            expect(await zeile(fall)).toEqual(stand);
        });
    });

    // --- Korrigieren --------------------------------------------------------------------------------------------------------------

    describe("korrigieren", () => {
        it("🔴 vor der Freigabe: Lage, Ort, Bezug und Beschreibung ändern, adjusted_by_editors wird gesetzt, der Zustand bleibt", async () => {
            const ort = await legeOrtAn(database, MARK_ORT);
            orte.push(ort);
            const fall = await bereit(16);
            const vorher = await zeile(fall);
            expect(vorher.adjusted_by_editors).toBe(false);
            const antrag = body(fall, vorher.revision, {
                lage: { x: 310.5, y: 320 },
                placeId: ort.publicId,
                bezug: { art: "landschaft", id: "name:Svellt" },
                beschreibung: "  Der Hafen von Havena  ",
            });
            const antwort = await senden("correct", fall.publicId, "reviewer", antrag);
            expect(fehler(antwort), antwort.body).toBe("200");

            const nachher = await zeile(fall);
            expect(nachher).toMatchObject({
                state: "pending",
                adjusted_by_editors: true,
                x: 310.5,
                y: 320,
                place_id: ort.id,
                reference_kind: "landschaft",
                reference_key: "name:Svellt",
                description: "Der Hafen von Havena",
                pending_description: null,
            });
            expect(nachher.revision).toBeGreaterThan(vorher.revision);
            // Kein Zustandswechsel, also bleibt der Zeitpunkt.
            expect(nachher.geaendert.getTime()).toBe(vorher.geaendert.getTime());
            expect(await statusLesen(database, fall.body.schluessel)).toMatchObject({
                angepasst: true,
                lage: { x: 310.5, y: 320 },
                ortName: MARK_ORT,
                beschreibung: "Der Hafen von Havena",
            });
            const [eintrag] = await protokoll(antrag.operationId);
            expect(eintrag).toMatchObject({ action: "photobox.corrected", revision: nachher.revision });
            expect(eintrag!.details).toEqual({
                previous: "pending",
                fields: ["lage", "placeId", "bezug", "beschreibung"],
            });
            // Keine Freitexte im Protokoll.
            expect(JSON.stringify(eintrag!.details)).not.toContain("Havena");
        });

        it("null entfernt Ort und Bezug; was nicht genannt ist, bleibt", async () => {
            const ort = await legeOrtAn(database, MARK_ORT);
            orte.push(ort);
            const fall = await bereit(17, { placeId: ort.publicId, bezug: { art: "klima", id: "klima:sommer" } });
            const vorher = await zeile(fall);
            expect(vorher).toMatchObject({ place_id: ort.id, reference_kind: "klima" });
            const antwort = await senden(
                "correct",
                fall.publicId,
                "reviewer",
                body(fall, vorher.revision, { placeId: null, bezug: null }),
            );
            expect(fehler(antwort), antwort.body).toBe("200");
            expect(await zeile(fall)).toMatchObject({
                place_id: null,
                reference_kind: null,
                reference_key: null,
                description: vorher.description,
                x: vorher.x,
                y: vorher.y,
                adjusted_by_editors: true,
            });
        });

        it("🔴 die Lage wird wie beim Einreichen geprüft: außerhalb der Karte ist 422, ein unbekannter Ort 422; nichts wird geschrieben", async () => {
            const fall = await bereit(18);
            const stand = await zeile(fall);
            // Innerhalb der Welt (das Schema lässt es durch), aber außerhalb der Kartendomäne.
            const draussen = await senden(
                "correct",
                fall.publicId,
                "reviewer",
                body(fall, stand.revision, { lage: { x: 5000, y: 5 } }),
            );
            expect(["400 validation_failed", "422 photobox_invalid"]).toContain(fehler(draussen));
            if (draussen.statusCode === 422) expect(grund(draussen)).toEqual({ reason: "stelle_ausserhalb" });
            const fremd = await senden(
                "correct",
                fall.publicId,
                "reviewer",
                body(fall, stand.revision, { placeId: "6d656469-0000-4000-8000-0000000fffff" }),
            );
            expect(fehler(fremd)).toBe("422 photobox_invalid");
            expect(grund(fremd)).toEqual({ reason: "ort_unbekannt" });
            expect(await zeile(fall)).toEqual(stand);
        });

        it("ohne ein einziges Feld gibt es nichts zu korrigieren (422)", async () => {
            const fall = await bereit(19);
            const stand = await zeile(fall);
            const leer = await senden("correct", fall.publicId, "reviewer", body(fall, stand.revision));
            expect(fehler(leer)).toBe("422 photobox_invalid");
            expect(grund(leer)).toEqual({ reason: "nichts_zu_korrigieren" });
            expect(await zeile(fall)).toEqual(stand);
        });

        it("🔴 nach der Freigabe: Lage, Ort und Bezug sind 409 (und ändern nichts), die Beschreibung geht und leert die wartende", async () => {
            const fall = await bereit(20, { beschreibung: "Vor der Freigabe" });
            expect(
                fehler(await senden("approve", fall.publicId, "reviewer", body(fall, (await zeile(fall)).revision))),
            ).toBe("200");
            const frei = await zeile(fall);

            for (const feld of [
                { lage: { x: 301, y: 302 } },
                { placeId: null },
                { bezug: null },
                { lage: { x: 301, y: 302 }, beschreibung: "Mit Lage" },
            ]) {
                const antwort = await senden("correct", fall.publicId, "reviewer", body(fall, frei.revision, feld));
                expect(fehler(antwort), JSON.stringify(feld)).toBe("409 photobox_transition");
            }
            expect(await zeile(fall)).toEqual(frei);

            await database`UPDATE media_submission SET pending_description = 'Wartende Fassung' WHERE id = ${fall.id}::bigint`;
            const stand = await zeile(fall);
            const antwort = await senden(
                "correct",
                fall.publicId,
                "reviewer",
                body(fall, stand.revision, { beschreibung: "Von der Redaktion" }),
            );
            expect(fehler(antwort), antwort.body).toBe("200");
            expect(await zeile(fall)).toMatchObject({
                state: "approved",
                description: "Von der Redaktion",
                pending_description: null,
                adjusted_by_editors: true,
            });
        });

        it("nach Ablehnung und Offline gibt es nichts mehr zu korrigieren", async () => {
            const fall = await bereit(21);
            expect(
                fehler(
                    await senden(
                        "reject",
                        fall.publicId,
                        "reviewer",
                        body(fall, (await zeile(fall)).revision, { grund: "Nein" }),
                    ),
                ),
            ).toBe("200");
            const stand = await zeile(fall);
            expect(
                fehler(
                    await senden(
                        "correct",
                        fall.publicId,
                        "reviewer",
                        body(fall, stand.revision, { beschreibung: "Doch" }),
                    ),
                ),
            ).toBe("409 photobox_transition");
        });
    });

    // --- Offline ------------------------------------------------------------------------------------------------------------------

    describe("offline nehmen", () => {
        /** Legt eine veröffentlichte Datei des Assets an (Zeile und Datei im Speicher), so wie der Abgleich sie nach der Freigabe anlegte. */
        async function veroeffentlicht(fall: Fall, seed: number): Promise<{ key: string; sha256: string }> {
            const webp = await sharp({
                create: { width: 32, height: 24, channels: 3, background: { r: seed, g: 9, b: 9 } },
            })
                .webp()
                .toBuffer();
            const gespeichert = await store.store("published", webp, "webp");
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                        derivative_recipe, recipe_version)
                VALUES (${fall.assetId}::bigint, 'photobox_2048', 'published', ${gespeichert.key}, 'image/webp', 32, 24, ${gespeichert.byteSize},
                        ${gespeichert.sha256}, 'photobox_2048-recipe', '1')`;
            return { key: gespeichert.key, sha256: gespeichert.sha256 };
        }

        it("🔴 nimmt eine freigegebene Einreichung zurück: offline, Asset rejected, Verwendung zurückgezogen, öffentliche Datei sofort weg", async () => {
            const fall = await bereit(22);
            expect(
                fehler(await senden("approve", fall.publicId, "reviewer", body(fall, (await zeile(fall)).revision))),
            ).toBe("200");
            const datei = await veroeffentlicht(fall, 40);
            expect(await store.exists(datei.key)).toBe(true);
            const vorher = await zeile(fall);

            const antrag = body(fall, vorher.revision);
            const antwort = await senden("offline", fall.publicId, "editor", antrag);
            expect(fehler(antwort), antwort.body).toBe("200");

            const nachher = await zeile(fall);
            expect(nachher).toMatchObject({ state: "offline", approved_asset: fall.assetId });
            expect(nachher.geaendert.getTime()).toBeGreaterThan(vorher.geaendert.getTime());
            expect(await moderation(fall)).toBe("rejected");
            const [verwendung] = await verwendungen(fall);
            expect(verwendung).toMatchObject({ asset: fall.assetId, retired: true });
            expect(await readUsages(database, fall.assetId)).toEqual([
                { assetId: fall.assetId, role: "photobox", retired: true, override: "none", suppressed: false },
            ]);
            // Die öffentliche Datei ist sofort weg: Zeile und Datei.
            expect(await store.exists(datei.key)).toBe(false);
            const [rest] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_file WHERE media_asset_id = ${fall.assetId}::bigint AND storage_class = 'published'`;
            expect(rest?.n).toBe(0);
            // Ein Abgleich räumt nach, falls zwischen Commit und Löschen etwas abbrach.
            expect((antwort.json() as OperationReceipt).derivedWork).toMatchObject([
                { kind: "media_settle", state: "queued" },
            ]);
            const [eintrag] = await protokoll(antrag.operationId);
            expect(eintrag).toMatchObject({
                action: "photobox.taken_offline",
                revision: nachher.revision,
                asset: fall.assetPublicId,
            });
            expect(eintrag!.details).toEqual({ previous: "approved", files: 1 });
            // Danach ist der Weg zu Ende, auch für die Redaktion.
            expect(fehler(await senden("offline", fall.publicId, "editor", body(fall, nachher.revision)))).toBe(
                "409 photobox_transition",
            );
        });

        it("nur eine freigegebene Einreichung geht offline: vor der Freigabe ist es 409", async () => {
            const fall = await bereit(23);
            const stand = await zeile(fall);
            expect(fehler(await senden("offline", fall.publicId, "editor", body(fall, stand.revision)))).toBe(
                "409 photobox_transition",
            );
            expect(await zeile(fall)).toEqual(stand);
        });

        it("🔴 auch das Offline-Nehmen durch den Einreicher zieht die Verwendung zurück (sonst hielte sie die Aufbewahrung für immer)", async () => {
            const fall = await bereit(24);
            expect(
                fehler(await senden("approve", fall.publicId, "reviewer", body(fall, (await zeile(fall)).revision))),
            ).toBe("200");
            expect((await verwendungen(fall))[0]).toMatchObject({ retired: false });
            await offlineNehmen(database, store, "test", {
                schluessel: fall.body.schluessel,
                operationId: neueOperation(spuren),
            });
            expect((await zeile(fall)).state).toBe("offline");
            expect((await verwendungen(fall))[0]).toMatchObject({ retired: true });
        });
    });

    describe("erneut zur Prüfung", () => {
        it("🔴 stellt eine freigegebene Einreichung zurück: offen, Medium wartend, Verwendung weg, wieder entscheidbar; die nächste Freigabe legt sie neu an", async () => {
            const fall = await bereit(25);
            expect(
                fehler(await senden("approve", fall.publicId, "reviewer", body(fall, (await zeile(fall)).revision))),
            ).toBe("200");
            expect(await verwendungen(fall)).toHaveLength(1);
            const vorher = await zeile(fall);

            const antrag = body(fall, vorher.revision);
            const antwort = await senden("reopen", fall.publicId, "reviewer", antrag);
            expect(fehler(antwort), antwort.body).toBe("200");

            const nachher = await zeile(fall);
            expect(nachher).toMatchObject({ state: "pending", decided: false, approved_asset: null });
            expect(nachher.geaendert.getTime()).toBeGreaterThan(vorher.geaendert.getTime());
            expect(await moderation(fall)).toBe("pending");
            expect(await verwendungen(fall)).toEqual([]);
            // Der Abgleich nimmt die öffentliche Fassung weg, sobald die Policy NEIN sagt.
            expect((antwort.json() as OperationReceipt).derivedWork).toMatchObject([
                { kind: "media_settle", state: "queued" },
            ]);
            const [eintrag] = await protokoll(antrag.operationId);
            expect(eintrag).toMatchObject({
                action: "photobox.reopened",
                revision: nachher.revision,
                asset: fall.assetPublicId,
            });
            expect(eintrag!.details).toEqual({ previous: "approved" });

            // Ein zweites Mal geht es nicht: Sie ist schon offen.
            expect(fehler(await senden("reopen", fall.publicId, "reviewer", body(fall, nachher.revision)))).toBe(
                "409 photobox_transition",
            );
            // Die nächste Entscheidung ist frei: wieder freigeben legt die Verwendung neu an.
            expect(fehler(await senden("approve", fall.publicId, "reviewer", body(fall, nachher.revision)))).toBe(
                "200",
            );
            expect(await zeile(fall)).toMatchObject({ state: "approved", approved_asset: fall.assetId });
            expect(await moderation(fall)).toBe("approved");
            expect(await verwendungen(fall)).toMatchObject([{ asset: fall.assetId, retired: false }]);
        });

        it("nur eine freigegebene Einreichung: vor der Freigabe und nach Offline ist es 409", async () => {
            const fall = await bereit(26);
            const stand = await zeile(fall);
            expect(fehler(await senden("reopen", fall.publicId, "reviewer", body(fall, stand.revision)))).toBe(
                "409 photobox_transition",
            );
            expect(await zeile(fall)).toEqual(stand);
            expect(fehler(await senden("approve", fall.publicId, "reviewer", body(fall, stand.revision)))).toBe("200");
            expect(
                fehler(await senden("offline", fall.publicId, "editor", body(fall, (await zeile(fall)).revision))),
            ).toBe("200");
            expect(
                fehler(await senden("reopen", fall.publicId, "reviewer", body(fall, (await zeile(fall)).revision))),
            ).toBe("409 photobox_transition");
        });
    });

    // --- Rechte, Revision, Wiederholung ---------------------------------------------------------------------------------------------

    describe("Rechte, Revision und Wiederholung", () => {
        it("🔴 ohne Anmeldung 401, als Tester 403; Freigeben, Rückfrage, Ablehnen und Korrigieren braucht moderate_submissions (Reviewer), Offline publish_media (Editor)", async () => {
            const fall = await bereit(25);
            const stand = await zeile(fall);
            const versuche: [PhotoboxRedaktionAktion, Record<string, unknown>][] = [
                ["approve", {}],
                ["ask", { nachricht: "Hm" }],
                ["reject", { grund: "Nein" }],
                ["correct", { beschreibung: "Neu" }],
                ["offline", {}],
            ];
            for (const [aktion, felder] of versuche) {
                expect(
                    fehler(await senden(aktion, fall.publicId, undefined, body(fall, stand.revision, felder))),
                    aktion,
                ).toBe("401 unauthenticated");
                expect(
                    fehler(await senden(aktion, fall.publicId, "tester", body(fall, stand.revision, felder))),
                    aktion,
                ).toBe("403 forbidden");
            }
            // Offline ohne publish_media: ein Reviewer darf prüfen, aber nicht zurücknehmen.
            expect(fehler(await senden("offline", fall.publicId, "reviewer", body(fall, stand.revision)))).toBe(
                "403 forbidden",
            );
            expect(await zeile(fall)).toEqual(stand);
            // Ein Editor darf beides.
            expect(
                fehler(
                    await senden(
                        "ask",
                        fall.publicId,
                        "editor",
                        body(fall, stand.revision, { nachricht: "Ein Editor fragt" }),
                    ),
                ),
            ).toBe("200");
        });

        it("🔴 eine falsche Revision ist 409 edit_conflict mit der geltenden Revision und dem Namen dessen, der sie schrieb; nichts ändert sich", async () => {
            const fall = await bereit(26);
            const erste = await zeile(fall);
            expect(
                fehler(
                    await senden(
                        "ask",
                        fall.publicId,
                        "reviewer",
                        body(fall, erste.revision, { nachricht: "Erste Frage" }),
                    ),
                ),
            ).toBe("200");
            const jetzt = await zeile(fall);

            // Eine zweite Person arbeitet mit der Revision von vorhin.
            for (const [aktion, felder] of [
                ["approve", {}],
                ["reject", { grund: "Nein" }],
                ["correct", { beschreibung: "Neu" }],
            ] as const) {
                const antwort = await senden(aktion, fall.publicId, "editor", body(fall, erste.revision, felder));
                expect(fehler(antwort), aktion).toBe("409 edit_conflict");
                const details = (
                    antwort.json() as {
                        error: { details: { currentRevision: number; changedBy?: { displayName: string } } };
                    }
                ).error.details;
                expect(details.currentRevision).toBe(jetzt.revision);
                expect(details.changedBy?.displayName).toBe(personen.get("reviewer")!.name);
            }
            expect(await zeile(fall)).toEqual(jetzt);
            expect(await verwendungen(fall)).toEqual([]);
            // Mit der geltenden Revision geht es.
            expect(fehler(await senden("approve", fall.publicId, "editor", body(fall, jetzt.revision)))).toBe("200");
        });

        it("eine unbekannte Einreichung ist 404", async () => {
            const antwort = await senden("approve", "6d656469-0000-4000-8000-0000000fffff", "reviewer", {
                operationId: neueOperation(spuren),
                baseRevision: 1,
            });
            expect(fehler(antwort)).toBe("404 not_found");
        });

        it("🔴 dieselbe operationId noch einmal: dieselbe Quittung (replayed), nichts doppelt; mit anderem Inhalt 409 idempotency_key_reused", async () => {
            const fall = await bereit(27);
            const antrag = body(fall, (await zeile(fall)).revision);
            const erste = await senden("approve", fall.publicId, "reviewer", antrag);
            expect(fehler(erste)).toBe("200");
            const stand = await zeile(fall);
            const auftraegeNach = (await auftraege(fall)).length;

            const zweite = await senden("approve", fall.publicId, "reviewer", antrag);
            expect(fehler(zweite), zweite.body).toBe("200");
            const a = erste.json() as OperationReceipt;
            const b = zweite.json() as OperationReceipt;
            expect(b.status).toBe("replayed");
            expect({ ...b, status: "applied" }).toEqual(a);
            expect(await zeile(fall)).toEqual(stand);
            expect(await verwendungen(fall)).toHaveLength(1);
            expect(await auftraege(fall)).toHaveLength(auftraegeNach);
            expect(await protokoll(antrag.operationId)).toHaveLength(1);

            // Dieselbe Kennung mit anderem Inhalt (hier eine andere Revision) ist keine Wiederholung.
            const anders = await senden("approve", fall.publicId, "reviewer", {
                ...antrag,
                baseRevision: antrag.baseRevision + 7,
            });
            expect(fehler(anders)).toBe("409 idempotency_key_reused");

            // Gilt ebenso für die Rückfrage: anderer Text, gleiche Kennung.
            const fall2 = await bereit(28);
            const frage = body(fall2, (await zeile(fall2)).revision, { nachricht: "Erste Fassung" });
            expect(fehler(await senden("ask", fall2.publicId, "reviewer", frage))).toBe("200");
            expect(
                fehler(await senden("ask", fall2.publicId, "reviewer", { ...frage, nachricht: "Zweite Fassung" })),
            ).toBe("409 idempotency_key_reused");
            expect((await zeile(fall2)).editor_message).toBe("Erste Fassung");
        });

        it("ein Rumpf ohne baseRevision (oder mit einer Revision unter 1) ist 400; geschrieben wird nichts", async () => {
            const fall = await bereit(29);
            const stand = await zeile(fall);
            expect(
                fehler(await senden("approve", fall.publicId, "reviewer", { operationId: neueOperation(spuren) })),
            ).toBe("400 validation_failed");
            expect(fehler(await senden("approve", fall.publicId, "reviewer", body(fall, 0)))).toBe(
                "400 validation_failed",
            );
            expect(await zeile(fall)).toEqual(stand);
        });
    });
});
