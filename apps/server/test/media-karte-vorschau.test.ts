import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_KARTE_DATEI_URL,
    MEDIA_KARTEN_URL,
    mediaEditorAssetUrl,
    mediaEditorUsageUrl,
    mediaKarteBildUrl,
    mediaKarteStilllegenUrl,
    mediaKarteUrl,
    mediaKarteVorschauUrl,
    type MamKarteDetail,
    type MediaAssetDetail,
    type MediaUsageResult,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { LEICHTE_ARTEN } from "../src/jobs/dirigent/plan.ts";
import { JOB_HANDLERS, JobFailure, type JobContext } from "../src/jobs/handlers.ts";
import { runKartenvorschauErzeugen } from "../src/jobs/kartenvorschau-job.ts";
import { JOB_KIND_CATALOG } from "../src/jobs/kinds.ts";
import { gehalteneAssets, gehalteneQuellbytes, zielNotausQuarantaene } from "../src/media/notaus.ts";
import { MediaStore } from "../src/media/storage.ts";
import { reviewRights, setMetadata, setRights } from "../src/media-editor/asset-operations.ts";
import { KARTENVORSCHAU_QUELLE, rechneKartenvorschau } from "../src/media-editor/kartenvorschau-datei.ts";
import { KARTENVORSCHAU_KIND } from "../src/media-editor/kartensammlung-vorschau.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { liftSuspension, suspendAsset } from "../src/media-editor/suspension.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures } from "./support/media-fixture.ts";
import { cleanEditorMedia, pngBytes } from "./support/media-operations-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** Ein gültiges PDF mit einer farbigen Fläche (wie `media-raster-pdf.test.ts`), damit pdf.js es wirklich rastert. */
function pdfMitSeite(seed: number, width = 600, height = 400): Buffer {
    const inhalt = `0.${String(seed % 10)} 0.1 0.1 rg 50 50 ${String(width - 100)} ${String(height - 100)} re f`;
    const objekte = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(width)} ${String(height)}] /Contents 4 0 R >>`,
        `<< /Length ${String(inhalt.length)} >>\nstream\n${inhalt}\nendstream`,
    ];
    let text = "%PDF-1.4\n";
    const stellen: number[] = [];
    objekte.forEach((objekt, i) => {
        stellen.push(text.length);
        text += `${String(i + 1)} 0 obj\n${objekt}\nendobj\n`;
    });
    const xref = text.length;
    text += `xref\n0 ${String(objekte.length + 1)}\n0000000000 65535 f \n`;
    for (const stelle of stellen) text += `${String(stelle).padStart(10, "0")} 00000 n \n`;
    text += `trailer\n<< /Size ${String(objekte.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
    return Buffer.from(text, "latin1");
}

/**
 * „Vorschau erzeugen“ (WI-0287 Stufe 1, Punkt 5; OPS-000091). Die Operation legt ein Werk der Art `map_preview` an, bindet es und reiht den Job ein; gesperrt nur bei Notaus,
 * unbekannter Rechtsgrundlage oder fehlender Datei der Karte, dazu belegter Platz, stillgelegter Eintrag, fremde Karte und veralteter Stand. Rechte und Entstehung folgen der
 * Karte dauerhaft (Auslöser aus 0320), der Notaus ebenso (`GEHALTENE_QUELLBYTES_SQL`); ob die Vorschau öffentlich ist, entscheidet die Policy für `map_preview`. Der Job rechnet
 * aus einem Bild und aus einem PDF das Original der Vorschau und reiht den Abgleich ein; fehlt die Datei, endet er mit Befund.
 */
describeWithDatabase("Vorschau erzeugen (WI-0287 Punkt 5)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let cookie = "";
    let leseCookie = "";
    let personId = "";
    let pruefId = "";
    let fixture: ReturnType<typeof authFixture>;
    const akteur = () => ({ personId, environment: "test" as const });
    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });
    const post = (url: string, payload: Record<string, unknown>, kekse = cookie) =>
        app.inject({ method: "POST", url, headers: { origin: TEST_ORIGIN, cookie: kekse }, payload });
    const hole = async <T>(url: string): Promise<T> =>
        (await app.inject({ method: "GET", url, headers: { origin: TEST_ORIGIN, cookie } })).json();
    const lies = (id: string) => hole<MamKarteDetail>(mediaKarteUrl(id));
    let seed = 900;

    /** Eine Kartendatei über die Route (Rohkörper), eigenes Werk von Elwe, ungeprüft. */
    async function karte(datei?: Buffer, name = "karte.png"): Promise<string> {
        const kopf = Buffer.from(
            JSON.stringify({
                operationId: randomUUID(),
                name,
                form: {
                    title: `Karte der Vorschauprobe ${String(seed)}`,
                    role: "map_full",
                    creationMethod: "drawing",
                    rights: {
                        basis: "own_work",
                        creator: "Elwe",
                        rightsHolder: "Haus Elwe",
                        attribution: "Karte: Elwe",
                    },
                },
            }),
            "utf8",
        );
        const laenge = Buffer.alloc(4);
        laenge.writeUInt32BE(kopf.byteLength);
        const antwort = await app.inject({
            method: "PUT",
            url: MEDIA_KARTE_DATEI_URL,
            headers: { origin: TEST_ORIGIN, cookie, "content-type": "application/octet-stream" },
            payload: Buffer.concat([laenge, kopf, datei ?? (await pngBytes(seed++, 320, 200))]),
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "media_asset")!.id;
    }
    /** Ein Eintrag mit dieser Karte als `map_full`; die Revision danach. */
    async function eintragMit(titel: string, werk: string): Promise<{ id: string; revision: number }> {
        const angelegt = await post(MEDIA_KARTEN_URL, {
            operationId: randomUUID(),
            fields: { title: titel },
            types: [],
            places: [],
        });
        expect(angelegt.statusCode, angelegt.body).toBe(200);
        const id = (angelegt.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "citymap")!.id;
        const stand = (await lies(id)).revision;
        const gebunden = await post(mediaKarteBildUrl(id), {
            operationId: randomUUID(),
            baseRevision: stand,
            role: "map_full",
            assetId: werk,
        });
        expect(gebunden.statusCode, gebunden.body).toBe(200);
        return { id, revision: stand + 1 };
    }
    const erzeuge = (id: string, baseRevision: number, sourceAssetId: string, title: string, kekse = cookie) =>
        post(mediaKarteVorschauUrl(id), { operationId: randomUUID(), baseRevision, sourceAssetId, title }, kekse);
    /** Erzeugt und gibt die Kennung der neuen Vorschau zurück. */
    async function vorschauVon(id: string, revision: number, werk: string, titel: string): Promise<string> {
        const antwort = await erzeuge(id, revision, werk, titel);
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "media_asset")!.id;
    }
    const fehlercode = (antwort: { statusCode: number; json(): unknown }): string =>
        `${String(antwort.statusCode)} ${(antwort.json() as { error?: { code: string } }).error?.code ?? ""}`.trim();
    const rechteVon = async (asset: string) => {
        const [zeile] = await database<
            {
                rights_basis: string;
                license_key: string | null;
                creator: string | null;
                rights_holder: string | null;
                attribution: string | null;
                clearance_state: string;
                reviewed_by_person: string | null;
                creation_method: string;
                revision: number;
            }[]
        >`
            SELECT r.rights_basis, r.license_key, r.creator, r.rights_holder, r.attribution, r.clearance_state,
                   r.reviewed_by_person::text AS reviewed_by_person, a.creation_method, r.revision::int AS revision
              FROM media_asset a JOIN media_rights r ON r.media_asset_id = a.id WHERE a.public_id = ${asset}::uuid
        `;
        return zeile!;
    };
    /** Was der Karte folgt: Grundlage, Lizenz, Namen, Prüfstand und Entstehung (die Revision zählt jede Zeile für sich). */
    const ohneRevision = (zeile: Awaited<ReturnType<typeof rechteVon>>) => ({
        rights_basis: zeile.rights_basis,
        license_key: zeile.license_key,
        creator: zeile.creator,
        rights_holder: zeile.rights_holder,
        attribution: zeile.attribution,
        clearance_state: zeile.clearance_state,
        reviewed_by_person: zeile.reviewed_by_person,
        creation_method: zeile.creation_method,
    });
    const abgleicheFuer = async (asset: string): Promise<number> => {
        const [zeile] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ${asset}
        `;
        return zeile!.n;
    };
    const quellbytesVon = async (asset: string): Promise<string> => {
        const [zeile] = await database<{ sha256: string }[]>`
            SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${asset}::uuid AND f.storage_class = 'private_source'
        `;
        return zeile!.sha256;
    };
    const aufraeumen = async (): Promise<void> => {
        const ids = (
            await database<{ id: string }[]>`
                SELECT id::text AS id FROM citymap WHERE title LIKE '%Vorschauprobe%' AND source_system = 'avesmaps3d'
            `
        ).map((zeile) => zeile.id);
        await database`DELETE FROM citymap_media WHERE citymap_id = ANY(${ids}::bigint[])`;
        await database`
            DELETE FROM media_audit_event
             WHERE citymap_public_id IN (SELECT public_id FROM citymap WHERE id = ANY(${ids}::bigint[]))
        `;
        await database`DELETE FROM citymap WHERE id = ANY(${ids}::bigint[])`;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        await cleanMediaFixtures(database);
        fixture = authFixture(database);
        const redakteurin = await fixture.person("editor", { name: "Vorschau Erzeugerin" });
        personId = redakteurin.id;
        cookie = (await fixture.session(redakteurin.id, { passkeyMinutesAgo: 1 })).cookie;
        const pruefer = await fixture.person("reviewer", { name: "Vorschau Prüfer" });
        pruefId = pruefer.id;
        leseCookie = (await fixture.session(pruefer.id, { passkeyMinutesAgo: 1 })).cookie;
        await cleanEditorMedia(database, [personId, pruefId]);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-vorschau-"));
        store = new MediaStore(mediaRoot);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await cleanEditorMedia(database, [personId, pruefId]);
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("🔴 erzeugt Werk, Bindung und Auftrag: Rechte und Entstehung wie die Karte, Protokoll, der Abgleich wartet auf den Job", async () => {
        const werk = await karte();
        const { id, revision } = await eintragMit("Erzeugen der Vorschauprobe", werk);
        const titel = "Vorschau von „Erzeugen der Vorschauprobe“";

        const vorher = await lies(id);
        expect(vorher.images.find((bild) => bild.role === "map_full")).toMatchObject({ vorschauSperre: null });

        const anfrage = { operationId: randomUUID(), baseRevision: revision, sourceAssetId: werk, title: titel };
        const antwort = await post(mediaKarteVorschauUrl(id), anfrage);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as OperationReceipt;
        const vorschau = quittung.affected.find((eintrag) => eintrag.kind === "media_asset")!.id;
        expect(quittung.affected).toContainEqual({ kind: "citymap", id, revision: revision + 1 });
        expect(quittung.derivedWork).toEqual([
            { kind: KARTENVORSCHAU_KIND, jobId: expect.any(String), state: "queued" },
        ]);
        // Dieselbe Kennung erzeugt nichts zweimal.
        expect((await post(mediaKarteVorschauUrl(id), anfrage)).json()).toEqual({ ...quittung, status: "replayed" });

        const [neu] = await database<
            {
                asset_type: string;
                origin: string;
                technical_state: string;
                title: string;
                karte: string;
                ingest_kind: string;
                actor: string;
                gebunden: number;
            }[]
        >`
            SELECT a.asset_type, a.origin, a.technical_state, a.title, k.public_id::text AS karte, i.ingest_kind,
                   i.actor_person_id::text AS actor,
                   (SELECT count(*)::int FROM citymap_media m JOIN citymap c ON c.id = m.citymap_id
                     WHERE m.media_asset_id = a.id AND m.role = 'map_preview' AND m.retired_at IS NULL AND c.public_id = ${id}::uuid) AS gebunden
              FROM media_asset a JOIN media_asset k ON k.id = a.generated_from_asset_id
              JOIN media_ingest i ON i.media_asset_id = a.id
             WHERE a.public_id = ${vorschau}::uuid
        `;
        expect(neu).toEqual({
            asset_type: "map_preview",
            origin: "project_generated",
            technical_state: "pending",
            title: titel,
            karte: werk,
            ingest_kind: "generated",
            actor: personId,
            gebunden: 1,
        });
        // 🔴 Rechte und Entstehung sind die der Karte; eine offene Prüfung sperrt nicht.
        expect(ohneRevision(await rechteVon(vorschau))).toEqual(ohneRevision(await rechteVon(werk)));
        expect((await rechteVon(werk)).clearance_state).toBe("unreviewed");

        const [auftrag] = await database<{ input_ref: Record<string, string>; actor_ref: string }[]>`
            SELECT input_ref, actor_ref FROM job WHERE kind = ${KARTENVORSCHAU_KIND} AND input_ref ->> 'asset' = ${vorschau}
        `;
        expect(auftrag).toEqual({ input_ref: { asset: vorschau, karte: werk, actor: personId }, actor_ref: personId });
        const zeilen = await database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT action, details FROM media_audit_event WHERE media_asset_public_id = ${vorschau}::uuid ORDER BY id
        `;
        expect(zeilen).toEqual([
            { action: "citymap.updated", details: { fields: ["images"] } },
            { action: "asset.generated", details: { role: "map_preview", source: werk } },
        ]);

        // Der Platz: die Vorschau hängt sofort, wird gerechnet und nennt ihre Karte.
        const danach = await lies(id);
        expect(danach.revision).toBe(revision + 1);
        expect(danach.images.find((bild) => bild.role === "map_preview")).toMatchObject({
            assetId: vorschau,
            title: titel,
            technicalState: "pending",
            erzeugtAus: { assetId: werk, offline: false },
        });
        // Der Inspector: an der Vorschau ihre Karte, an der Karte „gilt auch für“ und die Verwendung mit Vorschau.
        expect((await hole<MediaAssetDetail>(mediaEditorAssetUrl(vorschau))).erzeugtAus).toMatchObject({
            assetId: werk,
            offline: false,
        });
        const kartenDetail = await hole<MediaAssetDetail>(mediaEditorAssetUrl(werk));
        expect(kartenDetail.erzeugte).toEqual([{ assetId: vorschau, title: titel }]);
        expect(kartenDetail.vorschauSperre).toBeNull();
        const verwendung = await hole<MediaUsageResult>(mediaEditorUsageUrl(werk));
        expect(verwendung.usages.find((usage) => usage.subject?.id === id)?.citymap).toEqual({
            revision: revision + 1,
            preview: { assetId: vorschau, title: titel },
        });

        // Ein Abgleich vor dem Job sagt nicht „Datei fehlt“: Er wartet.
        const frueh = await settleAssetFiles(database, store, { assetPublicId: vorschau, role: "map_preview" });
        expect(frueh).toMatchObject({ unchanged: true, reasons: ["generation_pending"] });
        expect(
            (await database`SELECT technical_state FROM media_asset WHERE public_id = ${vorschau}::uuid`)[0],
        ).toEqual({
            technical_state: "pending",
        });
    });

    it("🔴 gesperrt nur bei unbekannter Grundlage, offline oder fehlender Datei; belegt, stillgelegt, fremde Karte und veralteter Stand sind 409, ohne Recht 403", async () => {
        const werk = await karte();
        const fremd = await karte();
        const { id, revision } = await eintragMit("Sperren der Vorschauprobe", werk);
        const titel = "Vorschau von „Sperren der Vorschauprobe“";
        const sperreAmPlatz = async () =>
            (await lies(id)).images.find((bild) => bild.role === "map_full")?.vorschauSperre ?? null;

        await database`
            UPDATE media_rights SET rights_basis = 'unknown'
             WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${werk}::uuid)
        `;
        expect(await sperreAmPlatz()).toBe("rights_unknown");
        expect(fehlercode(await erzeuge(id, revision, werk, titel))).toBe("409 preview_rights_unknown");
        await database`
            UPDATE media_rights SET rights_basis = 'own_work'
             WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${werk}::uuid)
        `;

        await database`UPDATE media_asset SET technical_state = 'missing_file' WHERE public_id = ${werk}::uuid`;
        expect(await sperreAmPlatz()).toBe("file_missing");
        expect(fehlercode(await erzeuge(id, revision, werk, titel))).toBe("409 preview_source_missing");
        await database`UPDATE media_asset SET technical_state = 'ok' WHERE public_id = ${werk}::uuid`;

        await suspendAsset(database, akteur(), werk, { operationId: randomUUID(), reason: "Probe: Karte offline" });
        expect(await sperreAmPlatz()).toBe("suspended");
        expect((await hole<MediaAssetDetail>(mediaEditorAssetUrl(werk))).vorschauSperre).toBe("suspended");
        expect(fehlercode(await erzeuge(id, revision, werk, titel))).toBe("409 preview_source_suspended");
        const [notaus] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_publication_suspension WHERE media_asset_id =
                   (SELECT id FROM media_asset WHERE public_id = ${werk}::uuid) AND lifted_at IS NULL
        `;
        await liftSuspension(database, akteur(), werk, {
            operationId: randomUUID(),
            baseRevision: notaus!.revision,
            reason: "Probe: wieder frei",
        });
        expect(await sperreAmPlatz()).toBeNull();

        expect(fehlercode(await erzeuge(id, revision, fremd, titel))).toBe("409 preview_source_not_bound");
        expect(fehlercode(await erzeuge(id, revision + 4, werk, titel))).toBe("409 edit_conflict");
        expect((await erzeuge(id, revision, werk, titel, leseCookie)).statusCode).toBe(403);
        expect((await erzeuge(id, revision, werk, "   ")).statusCode).toBe(400);
        expect((await lies(id)).images.map((bild) => bild.role)).toEqual(["map_full"]);

        await vorschauVon(id, revision, werk, titel);
        expect(fehlercode(await erzeuge(id, revision + 1, werk, titel))).toBe("409 preview_taken");

        const entfernt = await post(mediaKarteStilllegenUrl(id), {
            operationId: randomUUID(),
            baseRevision: revision + 1,
        });
        expect(entfernt.statusCode, entfernt.body).toBe(200);
        expect(fehlercode(await erzeuge(id, revision + 2, werk, titel))).toBe("409 citymap_retired");
    });

    it("🔴 Stufe 2: jede Version taugt als Quelle, der Platz nimmt die erste, der Inspector eines Bildes genau dieses; eine gelöste nicht mehr", async () => {
        const erste = await karte();
        const zweite = await karte();
        const { id, revision } = await eintragMit("Versionen der Vorschauprobe", erste);
        const gebunden = await post(mediaKarteBildUrl(id), {
            operationId: randomUUID(),
            baseRevision: revision,
            role: "map_full",
            assetId: zweite,
            versionLabel: "SL-Version",
        });
        expect(gebunden.statusCode, gebunden.body).toBe(200);
        const titel = "Vorschau von „Versionen der Vorschauprobe“";
        const vorschau = await vorschauVon(id, revision + 1, zweite, titel);
        const [aus] = await database<{ karte: string }[]>`
            SELECT k.public_id::text AS karte FROM media_asset v JOIN media_asset k ON k.id = v.generated_from_asset_id
             WHERE v.public_id = ${vorschau}::uuid
        `;
        expect(aus!.karte).toBe(zweite);
        // Beide Versionen tragen ihren Sperrgrund (hier keinen), die Vorschau sagt, woraus sie entstand.
        const detail = await lies(id);
        expect(detail.images.map((bild) => [bild.role, bild.assetId])).toEqual([
            ["map_preview", vorschau],
            ["map_full", erste],
            ["map_full", zweite],
        ]);
        expect(detail.images.find((bild) => bild.role === "map_preview")?.erzeugtAus?.assetId).toBe(zweite);
    });

    it("🔴 Rechte folgen der Karte: Ändern, Prüfen und Entstehung an der Karte ziehen die Vorschau nach und reihen ihren Abgleich ein; an der Vorschau selbst 409", async () => {
        const werk = await karte();
        const { id, revision } = await eintragMit("Rechte der Vorschauprobe", werk);
        const vorschau = await vorschauVon(id, revision, werk, "Vorschau von „Rechte der Vorschauprobe“");
        const abgleicheVorher = await abgleicheFuer(vorschau);

        const geaendert = await setRights(
            database,
            akteur(),
            werk,
            {
                operationId: randomUUID(),
                baseRevision: (await rechteVon(werk)).revision,
                rights: {
                    basis: "permission",
                    creator: "Alrike",
                    rightsHolder: "Verlag Alrike",
                    attribution: "Alrike",
                },
            },
            { pruefeCommunityLizenz: () => undefined },
        );
        expect(geaendert.derivedWork.length).toBeGreaterThan(0);
        expect(await rechteVon(vorschau)).toMatchObject({
            rights_basis: "permission",
            creator: "Alrike",
            rights_holder: "Verlag Alrike",
            attribution: "Alrike",
            clearance_state: "unreviewed",
        });
        expect(await abgleicheFuer(vorschau), "der Abgleich der Vorschau läuft neu").toBeGreaterThan(abgleicheVorher);

        await reviewRights(database, akteur(), werk, {
            operationId: randomUUID(),
            baseRevision: (await rechteVon(werk)).revision,
            decision: "cleared",
        });
        expect(await rechteVon(vorschau)).toMatchObject({ clearance_state: "cleared", reviewed_by_person: personId });

        const kartenRevision = (await hole<MediaAssetDetail>(mediaEditorAssetUrl(werk))).asset.revision;
        await setMetadata(database, akteur(), werk, {
            operationId: randomUUID(),
            baseRevision: kartenRevision,
            creationMethod: "ai_generated",
        });
        expect((await rechteVon(vorschau)).creation_method).toBe("ai_generated");
        expect(ohneRevision(await rechteVon(vorschau))).toEqual(ohneRevision(await rechteVon(werk)));

        // An der Vorschau selbst: Rechte, Prüfung und Entstehung sind 409, der Name nicht.
        const vorschauRevision = (await hole<MediaAssetDetail>(mediaEditorAssetUrl(vorschau))).asset.revision;
        await expect(
            setRights(
                database,
                akteur(),
                vorschau,
                {
                    operationId: randomUUID(),
                    baseRevision: (await rechteVon(vorschau)).revision,
                    rights: { basis: "own_work", creator: "Jemand" },
                },
                { pruefeCommunityLizenz: () => undefined },
            ),
        ).rejects.toMatchObject({ statusCode: 409, code: "media_rights_follow_source" });
        await expect(
            reviewRights(database, akteur(), vorschau, {
                operationId: randomUUID(),
                baseRevision: (await rechteVon(vorschau)).revision,
                decision: "rejected",
            }),
        ).rejects.toMatchObject({ statusCode: 409, code: "media_rights_follow_source" });
        await expect(
            setMetadata(database, akteur(), vorschau, {
                operationId: randomUUID(),
                baseRevision: vorschauRevision,
                creationMethod: "photo",
            }),
        ).rejects.toMatchObject({ statusCode: 409, code: "media_rights_follow_source" });
        await setMetadata(database, akteur(), vorschau, {
            operationId: randomUUID(),
            baseRevision: vorschauRevision,
            title: "Vorschau mit eigenem Namen",
        });
        // 🔴 Auch ein Schreiben an der Tafel vorbei hält nicht: Der Auslöser nimmt die Werte der Karte.
        await database`
            UPDATE media_rights SET rights_basis = 'unknown', creator = 'Fremd'
             WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${vorschau}::uuid)
        `;
        expect(await rechteVon(vorschau)).toMatchObject({ rights_basis: "permission", creator: "Alrike" });
    });

    it("🔴 der Job rechnet aus einem Bild und aus einem PDF das Original der Vorschau und reiht den Abgleich ein; fehlt die Datei, endet er mit Befund", async () => {
        // Ein Bild größer als die lange Kante des Originals: Es wird verkleinert, nie vergrößert.
        const bildKarte = await karte(await pngBytes(seed++, 2400, 1600));
        const bild = await eintragMit("Bild der Vorschauprobe", bildKarte);
        const ausBild = await vorschauVon(bild.id, bild.revision, bildKarte, "Vorschau von „Bild der Vorschauprobe“");
        const eingabe = (asset: string, werk: string) => ({ asset, karte: werk, actor: personId });

        expect(KARTENVORSCHAU_QUELLE).toMatchObject({
            geometry: { kind: "fit_inside", longEdge: 1200 },
            encoding: { mode: "lossy", quality: 90 },
        });
        const ergebnis = await rechneKartenvorschau(database, store, eingabe(ausBild, bildKarte));
        expect(ergebnis.source).toMatchObject({ width: 1200, height: 800 });
        expect(ergebnis.settle).toMatchObject({ kind: "media_settle", state: "queued" });
        const [original] = await database<{ mime_type: string; width: number; height: number; storage_key: string }[]>`
            SELECT f.mime_type, f.width, f.height, f.storage_key FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${ausBild}::uuid AND f.storage_class = 'private_source'
        `;
        expect(original).toMatchObject({ mime_type: "image/webp", width: 1200, height: 800 });
        expect(original!.storage_key).toMatch(/^private\/source\//u);
        const [eingereiht] = await database<{ role: string }[]>`
            SELECT input_ref ->> 'role' AS role FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ${ausBild}
        `;
        expect(eingereiht).toEqual({ role: "map_preview" });
        // Der Abgleich danach rechnet die Vorschau wie jede andere: technisch in Ordnung.
        await settleAssetFiles(database, store, { assetPublicId: ausBild, role: "map_preview" });
        expect((await lies(bild.id)).images.find((zeile) => zeile.role === "map_preview")?.technicalState).toBe("ok");
        // Ein zweiter Lauf rechnet nichts neu.
        const zweiter = await rechneKartenvorschau(database, store, eingabe(ausBild, bildKarte));
        expect(zweiter).toMatchObject({ source: null, findings: ["source_present"] });

        const pdfKarte = await karte(pdfMitSeite(seed++), "karte.pdf");
        const pdf = await eintragMit("PDF der Vorschauprobe", pdfKarte);
        const ausPdf = await vorschauVon(pdf.id, pdf.revision, pdfKarte, "Vorschau von „PDF der Vorschauprobe“");
        const pdfErgebnis = await rechneKartenvorschau(database, store, eingabe(ausPdf, pdfKarte));
        expect(pdfErgebnis.source).not.toBeNull();
        expect(Math.max(pdfErgebnis.source!.width, pdfErgebnis.source!.height)).toBeLessThanOrEqual(1200);

        // Die Datei der Karte fehlt im Speicher: Befund, die Vorschau trägt den Zustand und bleibt sichtbar.
        const weg = await karte();
        const ohne = await eintragMit("Ohne Datei der Vorschauprobe", weg);
        const ausWeg = await vorschauVon(ohne.id, ohne.revision, weg, "Vorschau von „Ohne Datei der Vorschauprobe“");
        const [schluessel] = await database<{ storage_key: string }[]>`
            SELECT f.storage_key FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${weg}::uuid AND f.storage_class = 'private_source'
        `;
        await rm(join(mediaRoot, schluessel!.storage_key));
        await expect(rechneKartenvorschau(database, store, eingabe(ausWeg, weg))).rejects.toMatchObject({
            code: "source_missing",
            technicalState: "missing_file",
        });
        expect((await lies(ohne.id)).images.find((zeile) => zeile.role === "map_preview")).toMatchObject({
            assetId: ausWeg,
            technicalState: "missing_file",
        });

        // Die Jobart: im Katalog mit dem Schlüssel der Rasterpipeline, leicht, mit Handler; eine falsche Eingabe endet sofort.
        expect(JOB_KIND_CATALOG[KARTENVORSCHAU_KIND]).toMatchObject({ origin: "queued", threads: 1 });
        expect(JOB_KIND_CATALOG[KARTENVORSCHAU_KIND]?.memoryKey({}, null)).toBe("media_derive");
        expect(LEICHTE_ARTEN.has(KARTENVORSCHAU_KIND)).toBe(true);
        expect(JOB_HANDLERS[KARTENVORSCHAU_KIND]).toBeTypeOf("function");
        const kontext = {
            input: { asset: "nein" },
            attempt: 1,
            job: { id: 0, publicId: randomUUID(), leaseNo: 1, mapDomainId: null },
            beginPhase: async () => undefined,
            checkpoint: () => undefined,
        } satisfies JobContext;
        await expect(runKartenvorschauErzeugen(kontext)).rejects.toBeInstanceOf(JobFailure);
    });

    it("🔴 der Notaus der Karte gilt auch der Vorschau, das Freigeben holt sie zurück, ein eigener Notaus der Vorschau bleibt", async () => {
        const werk = await karte();
        const { id, revision } = await eintragMit("Notaus der Vorschauprobe", werk);
        // Geprüft: Die Freigabe trägt in jeder Rolle, auch die Vorschau wird öffentlich und hat eine Datei, die mit offline gehen kann.
        await reviewRights(database, akteur(), werk, {
            operationId: randomUUID(),
            baseRevision: (await rechteVon(werk)).revision,
            decision: "cleared",
        });
        const vorschau = await vorschauVon(id, revision, werk, "Vorschau von „Notaus der Vorschauprobe“");
        await rechneKartenvorschau(database, store, { asset: vorschau, karte: werk, actor: personId });
        expect(
            (await settleAssetFiles(database, store, { assetPublicId: vorschau, role: "map_preview" })).published,
        ).toBe(true);
        const bytes = await quellbytesVon(vorschau);
        const [veroeffentlicht] = await database<{ sha256: string }[]>`
            SELECT f.sha256 FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${vorschau}::uuid AND f.storage_class = 'published'
        `;
        expect([...(await gehalteneQuellbytes(database))]).not.toContain(bytes);

        await suspendAsset(database, akteur(), werk, { operationId: randomUUID(), reason: "Probe: Karte offline" });
        expect([...(await gehalteneQuellbytes(database))]).toContain(bytes);
        expect((await gehalteneAssets(database)).publicIds.has(vorschau)).toBe(true);
        expect([...(await zielNotausQuarantaene(database))]).toContain(veroeffentlicht!.sha256);
        expect(
            (await settleAssetFiles(database, store, { assetPublicId: vorschau, role: "map_preview" })).reasons,
        ).toEqual(["suspended"]);
        const offline = (await lies(id)).images.find((bild) => bild.role === "map_preview")!;
        expect(offline.erzeugtAus).toMatchObject({ offline: true });
        expect(offline.publication).toEqual({ public: false, reason: "publication_suspended" });
        expect((await hole<MediaAssetDetail>(mediaEditorAssetUrl(vorschau))).erzeugtAus?.offline).toBe(true);

        const [notaus] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_publication_suspension
             WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${werk}::uuid) AND lifted_at IS NULL
        `;
        const frei = await liftSuspension(database, akteur(), werk, {
            operationId: randomUUID(),
            baseRevision: notaus!.revision,
            reason: "Probe: wieder frei",
        });
        // Das Freigeben reiht auch den Abgleich der Vorschau ein: Sie kommt zurück.
        const auftraege = await database<{ asset: string }[]>`
            SELECT input_ref ->> 'asset' AS asset FROM job WHERE public_id = ANY(${frei.derivedWork.map((w) => w.jobId ?? "")}::uuid[])
        `;
        expect(auftraege.map((zeile) => zeile.asset)).toContain(vorschau);
        expect([...(await gehalteneQuellbytes(database))]).not.toContain(bytes);
        expect((await lies(id)).images.find((bild) => bild.role === "map_preview")?.erzeugtAus).toMatchObject({
            offline: false,
        });

        // Ein eigener Notaus der Vorschau bleibt, wenn die Karte wieder frei ist.
        await suspendAsset(database, akteur(), vorschau, {
            operationId: randomUUID(),
            reason: "Probe: Vorschau offline",
        });
        await suspendAsset(database, akteur(), werk, { operationId: randomUUID(), reason: "Probe: Karte offline" });
        const [zweiter] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_publication_suspension
             WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${werk}::uuid) AND lifted_at IS NULL
        `;
        await liftSuspension(database, akteur(), werk, {
            operationId: randomUUID(),
            baseRevision: zweiter!.revision,
            reason: "Probe: Karte frei",
        });
        expect([...(await gehalteneQuellbytes(database))]).toContain(bytes);
        expect((await lies(id)).images.find((bild) => bild.role === "map_preview")?.erzeugtAus).toMatchObject({
            offline: false,
        });
    });

    it("🔴 ob die Vorschau öffentlich ist, entscheidet die Policy für map_preview: Eine Karte mit Einzelfreigabe ergibt eine private Vorschau", async () => {
        const werk = await karte();
        const { id, revision } = await eintragMit("Freigabe der Vorschauprobe", werk);
        await setRights(
            database,
            akteur(),
            werk,
            {
                operationId: randomUUID(),
                baseRevision: (await rechteVon(werk)).revision,
                rights: { basis: "permission", creator: "Elwe", rightsHolder: "Haus Elwe" },
            },
            { pruefeCommunityLizenz: () => undefined },
        );
        // Die Einzelfreigabe gilt der Bindung der Karte an diesem Eintrag.
        await database`
            UPDATE citymap_media SET publication_override = 'approved', override_decided_on = CURRENT_DATE,
                   override_decided_by = ${personId}::uuid, override_reason = 'Probe: Einzelfreigabe'
             WHERE role = 'map_full' AND media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${werk}::uuid)
        `;
        await settleAssetFiles(database, store, { assetPublicId: werk, role: "map_full" });

        const vorschau = await vorschauVon(id, revision, werk, "Vorschau von „Freigabe der Vorschauprobe“");
        await rechneKartenvorschau(database, store, { asset: vorschau, karte: werk, actor: personId });
        const abgleich = await settleAssetFiles(database, store, { assetPublicId: vorschau, role: "map_preview" });
        // Die Entscheidung des Abgleichs (für eine gedachte öffentliche Datei): Für eine Erlaubnis fehlt der Vorschau die Freigabe.
        expect(abgleich).toMatchObject({ published: false, reasons: ["permission_needs_approval"] });

        const bilder = (await lies(id)).images;
        expect(bilder.find((bild) => bild.role === "map_full")?.publication).toEqual({
            public: true,
            reason: "override_approved",
        });
        expect(bilder.find((bild) => bild.role === "map_preview")?.publication.public).toBe(false);
        expect((await rechteVon(vorschau)).rights_basis).toBe("permission");
    });
});
