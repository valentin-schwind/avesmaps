import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_HEADER_SET_URL,
    MEDIA_UPLOAD_URL,
    mediaSuspendLiftUrl,
    mediaSuspendUrl,
    type MediaAssetDetail,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { gehalteneQuellbytes, ziehNotausQuarantaeneNach, zielNotausQuarantaene } from "../src/media/notaus.ts";
import { zieheQuarantaeneNach } from "../src/media/quarantine.ts";
import { resolvePlaceMedia } from "../src/media/resolver.ts";
import { MediaStore, quarantineKey, storageKey } from "../src/media/storage.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { usageOf } from "../src/media-editor/usage.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertPlace } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Der Einzelbild-Notaus (WI-0068, Betreiber 2026-10-10: „im mam kann man dann immernoch bilder etc gezielt offline nehmen“;
 * Tafel aus Migration 0086, Quarantäne aus 0104).
 *
 * Problemfälle, die hier geprüft werden: ein Notaus ohne Grund; ein zweiter Notaus auf dieselben Bytes; ein Aufheben mit veralteter
 * Revision; ein Aufheben ohne aktiven Notaus; eine Sitzung ohne frischen Passkey; eine Sitzung ohne das Recht. Soll: Die Zeile ist
 * die Wahrheit, die Datei folgt ihr, das Fachprotokoll nennt Grund und Umfang, und eine Wiederholung derselben Kennung wirkt nicht
 * zweimal.
 *
 * Seit dem Code-Review 2026-10-16 (S8-04, WI-0189 B2): Der Lesepfad fragt den Notaus selbst (kein Bild, keine Adresse, schon bevor die
 * Datei wandert), die Datei bewegt der Job `media_quarantine` (hier `quarantaeneJob`, dieselben Funktionen, die der Job ruft), ein
 * Abgleich unter Notaus lässt die veröffentlichte Zeile stehen, und Aufheben reiht den Abgleich je aktiver Rolle ein.
 */
describeWithDatabase("Einzelbild-Notaus (WI-0068, Migration 0086)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    /** 0: Betreiberin mit frischem Passkey · 1: Reviewerin (kein Notausrecht), Passkey frisch · 2: Betreiberin, Passkey alt. */
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
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    /**
     * Ein Titelbild hochladen, an einen eigenen Ort binden und die Dateien rechnen lassen.
     *
     * 🪤 Die Bindung ist nicht Beiwerk: Ohne eine VERWENDUNG gibt die Policy nichts frei, es entstünde keine öffentliche Datei —
     * und dann hätte der Notaus nichts auszublenden, der Test liefe grün an der Sache vorbei.
     */
    async function neuesBild(seed: number): Promise<{ assetId: string; sha256: string; placeId: string }> {
        const antwort = await send("POST", MEDIA_UPLOAD_URL, {
            operationId: operation(),
            file: file(await pngBytes(seed, 160, 90)),
            // KI-erzeugtes eigenes Werk: nur so gibt die Regel die Datei frei, und nur dann gibt es etwas auszublenden.
            form: uploadForm({
                title: `Notaus-Bild ${String(seed)}`,
                role: "header",
                creationMethod: "ai_generated",
            }),
        });
        expect(code(antwort)).toBe("200");
        const assetId = (antwort.json() as OperationReceipt).affected.find((entry) => entry.kind === "media_asset")!.id;
        const ort = await insertPlace(database, seed);
        expect(
            code(
                await send("POST", MEDIA_HEADER_SET_URL, {
                    operationId: operation(),
                    placeId: ort.publicId,
                    assetId,
                    baseState: "undecided",
                }),
            ),
        ).toBe("200");
        await settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" });
        const [veroeffentlicht] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'published'
        `;
        expect(veroeffentlicht!.n, "ohne öffentliche Datei prüft der Test den Notaus nicht").toBeGreaterThan(0);
        const [row] = await database<{ sha256: string }[]>`
            SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'private_source'
        `;
        return { assetId, sha256: row!.sha256, placeId: ort.publicId };
    }

    /** Was der Job `media_quarantine` tut (`jobs/media-quarantine-job.ts`): erst der Notaus, dann die Inhaltsschalter. */
    const quarantaeneJob = async (): Promise<void> => {
        await ziehNotausQuarantaeneNach(database, store);
        await zieheQuarantaeneNach(database, store);
    };
    /** Die veröffentlichte Datei eines Assets: ihre Bytes und wo sie gerade liegt. */
    const veroeffentlichteDatei = async (assetId: string) => {
        const [row] = await database<{ sha256: string }[]>`
            SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'published'
        `;
        if (row === undefined) return undefined;
        return {
            sha256: row.sha256,
            oeffentlich: await store.exists(storageKey("published", row.sha256, "webp")),
            inQuarantaene: await store.exists(quarantineKey(row.sha256)),
        };
    };
    const kopfbilder = async (placeId: string, assetId: string) =>
        (await resolvePlaceMedia(database, placeId)).filter((view) => view.id === assetId);

    const detail = async (assetId: string): Promise<MediaAssetDetail> =>
        (await send("GET", `/api/editor/media/${assetId}`)).json();

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-notaus-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        // `suspend_media_publication` hat ab der Rolle Editor, wer sie trägt; eine Reviewerin trägt sie nicht.
        const betreiber = await fixture.person("operator", { name: "Notaus Betreiberin" });
        const reviewerin = await fixture.person("reviewer", { name: "Notaus Reviewerin" });
        people.push(betreiber, reviewerin);
        cookies.push((await fixture.session(betreiber.id, { passkeyMinutesAgo: 1 })).cookie);
        cookies.push((await fixture.session(reviewerin.id, { passkeyMinutesAgo: 1 })).cookie);
        cookies.push((await fixture.session(betreiber.id, { passkeyMinutesAgo: 24 * 60 })).cookie);
        // Eine Freigaberegel, damit ein eigenes KI-Bild überhaupt öffentlich wird und es etwas auszublenden gibt.
        const [rule] = await database<{ id: string }[]>`
            INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
            VALUES ('own_work', 'ai_generated', 'header', 'media-test Notaus-Regel', 'Testzitat', '2026-10-13')
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

    it("🔴 blendet die BYTES aus, nicht die Stelle: Zeile, Quarantäne und Fachprotokoll", async () => {
        const { assetId, sha256 } = await neuesBild(71);
        expect([...(await gehalteneQuellbytes(database))]).not.toContain(sha256);

        const antwort = await send("POST", mediaSuspendUrl(assetId), {
            operationId: operation(),
            reason: "Rechtelage ungeklärt, bis zur Prüfung offline",
        });
        expect(code(antwort)).toBe("200");
        const quittung = antwort.json() as OperationReceipt;
        expect(quittung.affected).toEqual([
            { kind: "suspension", id: sha256, revision: expect.any(Number) as unknown as number },
        ]);
        // WI-0189 B2: Die Datei bewegt der Job mit der Jobs-Rolle, nicht die Operation als App-Rolle.
        expect(quittung.derivedWork.map((work) => work.kind)).toEqual(["media_quarantine"]);
        await quarantaeneJob();

        // Die Zeile ist die Wahrheit …
        expect([...(await gehalteneQuellbytes(database))]).toContain(sha256);
        // 🔴 … und die Quarantäne arbeitet in der ANDEREN Einheit: sie bewegt die veröffentlichte Datei, nicht das Original.
        const [publiziert] = await database<{ sha256: string }[]>`
            SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'published'
        `;
        expect(publiziert!.sha256).not.toBe(sha256);
        expect([...(await zielNotausQuarantaene(database))]).toContain(publiziert!.sha256);
        const [zeile] = await database<{ file_state: string; reason: string; lifted_at: Date | null }[]>`
            SELECT file_state, reason, lifted_at FROM media_publication_suspension WHERE source_sha256 = ${sha256}
        `;
        expect(zeile).toMatchObject({ file_state: "quarantined", lifted_at: null });
        expect(zeile!.reason).toBe("Rechtelage ungeklärt, bis zur Prüfung offline");

        // … und die Datei ist ihr gefolgt: in der Quarantäne, nicht mehr unter `published/`.
        const [inQuarantaene] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_quarantine
             WHERE sha256 IN (SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
                               WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'published')
               AND reason_kind = 'asset_suspension' AND restored_at IS NULL
        `;
        expect(inQuarantaene!.n).toBeGreaterThan(0);

        // Das Fachprotokoll nennt Grund und Umfang; `sha256`, `assets` und `usages` stehen in der Positivliste.
        const [protokoll] = await database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT e.action, e.details FROM media_audit_event e
             WHERE e.media_asset_public_id = ${assetId}::uuid AND e.action = 'suspension.set'
        `;
        expect(protokoll?.action).toBe("suspension.set");
        expect(protokoll?.details).toMatchObject({ sha256, reason: "Rechtelage ungeklärt, bis zur Prüfung offline" });
        expect(protokoll?.details["assets"]).toBeGreaterThanOrEqual(1);

        // Der Inspector sieht den Notaus über die Bytes.
        const gelesen = await detail(assetId);
        expect(gelesen.suspensions[0]).toMatchObject({ sha256, liftedAt: null, fileState: "quarantined" });
    });

    it("🔴 ein zweiter Notaus auf dieselben Bytes ist ein Konflikt, kein zweiter Eintrag", async () => {
        const { assetId } = await neuesBild(72);
        const grund = { operationId: operation(), reason: "doppelt gemoppelt" };
        expect(code(await send("POST", mediaSuspendUrl(assetId), grund))).toBe("200");
        expect(
            code(await send("POST", mediaSuspendUrl(assetId), { operationId: operation(), reason: "nochmal" })),
        ).toBe("409 media_already_suspended");
        const [zahl] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_publication_suspension n
             JOIN media_asset a ON a.id = n.media_asset_id WHERE a.public_id = ${assetId}::uuid
        `;
        expect(zahl!.n).toBe(1);
    });

    it("🔴 dieselbe Kennung wiederholt gibt die gespeicherte Quittung, keine zweite Wirkung", async () => {
        const { assetId } = await neuesBild(73);
        const koerper = { operationId: operation(), reason: "einmal genügt" };
        const erste = await send("POST", mediaSuspendUrl(assetId), koerper);
        expect(code(erste)).toBe("200");
        const zweite = await send("POST", mediaSuspendUrl(assetId), koerper);
        expect(code(zweite)).toBe("200");
        expect((zweite.json() as OperationReceipt).status).toBe("replayed");
        const [zahl] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_publication_suspension n
             JOIN media_asset a ON a.id = n.media_asset_id WHERE a.public_id = ${assetId}::uuid
        `;
        expect(zahl!.n).toBe(1);
    });

    it("🔴 aufheben nur mit der geltenden Revision; danach ist die Zeile endgültig und die Datei zurück", async () => {
        const { assetId, sha256 } = await neuesBild(74);
        const gesetzt = await send("POST", mediaSuspendUrl(assetId), {
            operationId: operation(),
            reason: "kurz offline",
        });
        const revision = (gesetzt.json() as OperationReceipt).affected[0]!.revision!;

        expect(
            code(
                await send("POST", mediaSuspendLiftUrl(assetId), {
                    operationId: operation(),
                    baseRevision: revision + 5,
                    reason: "mit falscher Revision",
                }),
            ),
        ).toBe("409 edit_conflict");

        const aufgehoben = await send("POST", mediaSuspendLiftUrl(assetId), {
            operationId: operation(),
            baseRevision: revision,
            reason: "Rechte geklärt, wieder öffentlich",
        });
        expect(code(aufgehoben)).toBe("200");
        // S8-04: erst die Datei zurück, dann der Abgleich je aktiver Rolle (hier das Titelbild am Ort).
        expect((aufgehoben.json() as OperationReceipt).derivedWork.map((work) => work.kind)).toEqual([
            "media_quarantine",
            "media_settle",
        ]);
        await quarantaeneJob();

        expect([...(await gehalteneQuellbytes(database))]).not.toContain(sha256);
        const [zeile] = await database<{ file_state: string; lift_reason: string | null }[]>`
            SELECT file_state, lift_reason FROM media_publication_suspension WHERE source_sha256 = ${sha256}
        `;
        expect(zeile).toMatchObject({ file_state: "restored", lift_reason: "Rechte geklärt, wieder öffentlich" });
        const [aktiv] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_quarantine
             WHERE reason_kind = 'asset_suspension' AND restored_at IS NULL AND sha256 IN (
                   SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
                    WHERE a.public_id = ${assetId}::uuid)
        `;
        expect(aktiv!.n).toBe(0);

        // Ohne aktiven Notaus gibt es nichts aufzuheben.
        expect(
            code(
                await send("POST", mediaSuspendLiftUrl(assetId), {
                    operationId: operation(),
                    baseRevision: revision,
                    reason: "noch einmal",
                }),
            ),
        ).toBe("409 media_not_suspended");
    });

    it("🔴 verlangt Recht, frischen Passkey und einen Grund", async () => {
        const { assetId } = await neuesBild(75);
        // Ohne das Sonderrecht: 403, obwohl der Passkey frisch ist.
        expect(
            code(await send("POST", mediaSuspendUrl(assetId), { operationId: operation(), reason: "darf nicht" }, 1)),
        ).toBe("403 forbidden");
        // Mit Recht, aber ohne frischen Passkey: der Server verlangt die Bestätigung.
        const alt = await send("POST", mediaSuspendUrl(assetId), { operationId: operation(), reason: "zu alt" }, 2);
        expect(alt.statusCode).toBe(403);
        expect((alt.json() as { error: { code: string } }).error.code).toMatch(/assurance_required|reauth_required/);
        // Ohne Anmeldung: 401.
        const ohne = await app.inject({
            method: "POST",
            url: mediaSuspendUrl(assetId),
            payload: { operationId: operation(), reason: "anonym" },
            headers: { origin: TEST_ORIGIN },
        });
        expect(ohne.statusCode).toBe(401);
        // Ein leerer Grund wird vom Schema abgewiesen, ein reiner Leerzeichengrund vom Code.
        expect(code(await send("POST", mediaSuspendUrl(assetId), { operationId: operation(), reason: "" }))).toMatch(
            /^400/,
        );
        expect(code(await send("POST", mediaSuspendUrl(assetId), { operationId: operation(), reason: "   " }))).toBe(
            "400 validation_failed",
        );
        // Und nach all dem gilt noch kein Notaus.
        expect((await detail(assetId)).suspensions).toEqual([]);
    });

    /**
     * 🔴 Schutzregel (Betreiber 2026-10-10 zu SYS-0001 Frage 3: „nur die entscheidung darf nicht nachträglich kompromittiert
     * werden“): Kein Import und kein Medienlauf hebt einen Notaus auf. Hier der Lauf, der eine öffentliche Datei anlegen WÜRDE.
     */
    it("🔴 kein Medienlauf hebt den Notaus auf: der Abgleich legt keine öffentliche Datei an", async () => {
        const { assetId, sha256 } = await neuesBild(76);
        expect(
            code(
                await send("POST", mediaSuspendUrl(assetId), {
                    operationId: operation(),
                    reason: "bleibt aus, auch wenn ein Lauf kommt",
                }),
            ),
        ).toBe("200");
        await quarantaeneJob();
        // Die öffentliche Datei des Assets aus den Zeilen nehmen, damit der Abgleich sie neu anlegen wollte.
        await database`
            DELETE FROM media_file f USING media_asset a
             WHERE a.id = f.media_asset_id AND a.public_id = ${assetId}::uuid AND f.storage_class = 'published'
        `;
        const ergebnis = await settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" });
        expect(ergebnis.published, "ein gehaltenes Bild wird nicht wieder veröffentlicht").toBe(false);
        const [wieder] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${assetId}::uuid AND f.storage_class = 'published'
        `;
        expect(wieder!.n).toBe(0);
        // Und der Notaus selbst steht unverändert.
        expect([...(await gehalteneQuellbytes(database))]).toContain(sha256);
    });

    it("🔴 S8-04: der Lesepfad zeigt ein gesperrtes Bild nicht mehr, schon bevor die Datei wandert, und nach dem Aufheben wieder", async () => {
        const { assetId, placeId } = await neuesBild(77);
        expect(await kopfbilder(placeId, assetId)).toHaveLength(1);
        const gesetzt = await send("POST", mediaSuspendUrl(assetId), {
            operationId: operation(),
            reason: "Lesepfad prüfen",
        });
        expect(code(gesetzt)).toBe("200");
        // Der Job ist noch nicht gelaufen: Die Datei liegt noch unter `published/`, aber niemand bekommt ihre Adresse.
        expect((await veroeffentlichteDatei(assetId))?.oeffentlich).toBe(true);
        expect(await kopfbilder(placeId, assetId)).toEqual([]);
        // Das MAM sagt denselben Grund, an der Verwendung und am Platz des Orts.
        const verwendung = (await usageOf(database, assetId))?.usages[0];
        expect(verwendung?.publication).toEqual({ public: false, reason: "publication_suspended" });
        const plaetze = await send("GET", `/api/editor/media/subjects/place/${placeId}`);
        expect(code(plaetze)).toBe("200");
        const bild = (plaetze.json() as { header: { image: { asset: { publication: unknown; preview: unknown } } } })
            .header.image.asset;
        expect(bild.publication).toEqual({ public: false, reason: "publication_suspended" });
        expect(bild.preview, "keine Vorschau über die Adresse einer Datei in der Quarantäne").toBeNull();

        await quarantaeneJob();
        expect(await veroeffentlichteDatei(assetId)).toMatchObject({ oeffentlich: false, inQuarantaene: true });

        const revision = (gesetzt.json() as OperationReceipt).affected[0]!.revision!;
        expect(
            code(
                await send("POST", mediaSuspendLiftUrl(assetId), {
                    operationId: operation(),
                    baseRevision: revision,
                    reason: "wieder da",
                }),
            ),
        ).toBe("200");
        await quarantaeneJob();
        await settleAssetFiles(database, store, { assetPublicId: assetId, role: "header" });
        expect(await veroeffentlichteDatei(assetId)).toMatchObject({ oeffentlich: true, inQuarantaene: false });
        expect(await kopfbilder(placeId, assetId)).toHaveLength(1);
    });

    it("🔴 S8-04: Notaus, Abgleich, Notaus an einem anderen Bild - die erste Datei bleibt in der Quarantäne", async () => {
        const erstes = await neuesBild(78);
        const zweites = await neuesBild(79);
        expect(
            code(await send("POST", mediaSuspendUrl(erstes.assetId), { operationId: operation(), reason: "erstes" })),
        ).toBe("200");
        await quarantaeneJob();
        // Ein Abgleich am gesperrten Asset (etwa nach einer Bindung) lässt die veröffentlichte Zeile stehen …
        const abgleich = await settleAssetFiles(database, store, { assetPublicId: erstes.assetId, role: "header" });
        expect(abgleich.reasons).toEqual(["suspended"]);
        expect(await veroeffentlichteDatei(erstes.assetId)).toMatchObject({ oeffentlich: false, inQuarantaene: true });
        // … sodass der nächste Notaus, an irgendeinem anderen Bild, die Datei NICHT aus der Quarantäne zurückgibt.
        expect(
            code(await send("POST", mediaSuspendUrl(zweites.assetId), { operationId: operation(), reason: "zweites" })),
        ).toBe("200");
        await quarantaeneJob();
        expect(await veroeffentlichteDatei(erstes.assetId)).toMatchObject({ oeffentlich: false, inQuarantaene: true });
        expect(await veroeffentlichteDatei(zweites.assetId)).toMatchObject({ oeffentlich: false, inQuarantaene: true });
        const [zustand] = await database<{ file_state: string }[]>`
            SELECT file_state FROM media_publication_suspension WHERE source_sha256 = ${erstes.sha256} AND lifted_at IS NULL
        `;
        expect(zustand?.file_state).toBe("quarantined");
    });

    it("ein Medium ohne Originaldatei hat nichts auszublenden", async () => {
        const [asset] = await database<{ public_id: string }[]>`
            INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state,
                                     source_system, source_ref, title)
            VALUES ('image', 'picture', 'editor_upload', 'drawing', 'pending', 'not_applicable',
                    'media-test', 'notaus/ohne-datei', 'Notaus ohne Datei')
            RETURNING public_id::text AS public_id
        `;
        expect(
            code(
                await send("POST", mediaSuspendUrl(asset!.public_id), {
                    operationId: operation(),
                    reason: "geht nicht",
                }),
            ),
        ).toBe("409 media_without_source");
    });
});
