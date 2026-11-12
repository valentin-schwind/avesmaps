import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
    KARTENVORSCHLAG_GRENZEN,
    KARTENVORSCHLAG_REDAKTION_URL,
    KARTENVORSCHLAG_SCHLUESSEL_KOPF,
    KARTENVORSCHLAG_TERMS_VERSION,
    KARTENVORSCHLAG_URL,
    KartenvorschlagDetail,
    KartenvorschlagEingegangen,
    KartenvorschlagListe,
    KartenvorschlagStand,
    KartenvorschlagStatus,
    type KartenvorschlagEinreichung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { schluesselHash } from "../src/community/db.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { bereinigt, pruefeKartendatei } from "../src/kartenvorschlag/db.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { MediaStore } from "../src/media/storage.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import {
    EXIF_GEHEIMNISSE,
    jpegMitMetadaten,
    legeOrtAn,
    neueSpuren,
    neuerSchluessel,
    svgUpload,
} from "./support/photobox-fixture.ts";

// pdf.js und die Zeichenbibliothek laden beim ersten PDF; unter Last reichen 5 Sekunden nicht.
vi.setConfig({ testTimeout: 60_000 });

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Karte vorschlagen (WI-0275 Stufe B, `routes/kartenvorschlag.ts`, `kartenvorschlag/`) über `app.inject`, gegen echtes PostgreSQL und einen echten Medienspeicher:
 *
 * - Einreichen als Link und als Datei (JPEG mit Metadaten, PDF, ein Raster über den 6 MiB der Medienverwaltung), Idempotenz, Schlüssel belegt;
 * - Herkunft, Honigtopf, Zeitfalle, Drossel (Einreichungen und Dateien getrennt), ungültige Angaben, falsches Format, zu groß;
 * - 🔴 nie öffentlich: kein Weg legt eine Karte an, das Werk bleibt `pending` und ohne Verwendung; die Tafel verlangt für `approved` eine Karte;
 * - Statusseite (falscher Schlüssel 404 mit einem Satz, Schlüssel nie im Protokoll), Zurückziehen, Redaktion (Rechte, Liste, Ablehnen, Ereignis).
 */

function pdfEinfach(): Buffer {
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Contents 5 0 R >>",
        `<< /Length 36 >>\nstream\n0.8 0.1 0.1 rg 50 50 500 300 re f\nendstream`,
    ];
    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(body.length);
        body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
    body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
    return Buffer.from(body, "latin1");
}

function config(mediaRoot: string): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "kartenvorschlag-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Karte vorschlagen (WI-0275 Stufe B)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: AuthFixture;
    let mediaRoot = "";
    let store: MediaStore;
    let reviewer: { cookie: string; id: string };
    let tester: { cookie: string };
    const logzeilen: string[] = [];
    const spuren = neueSpuren();
    const orte: string[] = [];
    /** Jede Gruppe von Anfragen kommt von einer eigenen Adresse, damit die Drossel nicht über Tests hinweg zählt. */
    let adresse = 10;
    const neueAdresse = (): string => `10.60.0.${String(adresse++)}`;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-kartenvorschlag-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        app = buildApp({
            config: config(mediaRoot),
            database: createDatabase(testDatabaseUrl as string, { max: 3 }),
            logStream: { write: (zeile) => void logzeilen.push(zeile) },
        });
        await app.ready();
        const person = async (role: "reviewer" | "tester") => {
            const created = await fixture.person(role);
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 60 });
            return { id: created.id, cookie };
        };
        reviewer = await person("reviewer");
        tester = await person("tester");
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await raeumeAuf();
        for (const ort of orte) await database`DELETE FROM place WHERE id = ${ort}::bigint`;
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    async function raeumeAuf(): Promise<void> {
        const hashes = spuren.schluessel.map((schluessel) => schluesselHash(schluessel).toString("hex"));
        const zeilen = await database<{ id: string; asset: string | null; public_id: string | null }[]>`
            SELECT s.id::text AS id, s.media_asset_id::text AS asset, a.public_id::text AS public_id
              FROM citymap_suggestion s LEFT JOIN media_asset a ON a.id = s.media_asset_id
             WHERE encode(s.status_key_hash, 'hex') = ANY(${hashes}::text[])`;
        const assetIds = zeilen.flatMap((zeile) => (zeile.asset === null ? [] : [zeile.asset]));
        const assetPublic = zeilen.flatMap((zeile) => (zeile.public_id === null ? [] : [zeile.public_id]));
        await database`DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ANY(${assetPublic}::text[]))`;
        await database`DELETE FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ANY(${assetPublic}::text[])`;
        await database`DELETE FROM citymap_suggestion WHERE id = ANY(${zeilen.map((zeile) => zeile.id)}::bigint[])`;
        await database`DELETE FROM media_file WHERE media_asset_id = ANY(${assetIds}::bigint[])`;
        await database`DELETE FROM media_rights WHERE media_asset_id = ANY(${assetIds}::bigint[])`;
        await database`DELETE FROM media_asset WHERE id = ANY(${assetIds}::bigint[])`;
    }

    const roh = (
        method: "POST" | "PUT" | "GET",
        url: string,
        payload: unknown,
        opt: { ip?: string; origin?: string; headers?: Record<string, string> } = {},
    ) =>
        app.inject({
            method,
            url,
            payload: payload as object,
            remoteAddress: opt.ip ?? neueAdresse(),
            headers: { origin: opt.origin ?? TEST_ORIGIN, ...(opt.headers ?? {}) },
        });
    const senden = (url: string, payload: unknown, ip?: string, origin?: string) =>
        roh("POST", url, payload, { ...(ip === undefined ? {} : { ip }), ...(origin === undefined ? {} : { origin }) });
    const fehler = (antwort: { statusCode: number; json(): unknown }): string =>
        antwort.statusCode < 300
            ? String(antwort.statusCode)
            : `${String(antwort.statusCode)} ${(antwort.json() as { error?: { code?: string } }).error?.code ?? ""}`.trim();
    const datei = (schluessel: string, bytes: Buffer, ip?: string) =>
        roh("PUT", `${KARTENVORSCHLAG_URL}/datei`, bytes, {
            ...(ip === undefined ? {} : { ip }),
            headers: { "content-type": "application/octet-stream", [KARTENVORSCHLAG_SCHLUESSEL_KOPF]: schluessel },
        });
    const status = (schluessel: string, ip?: string) => senden(`${KARTENVORSCHLAG_URL}/status`, { schluessel }, ip);

    function link(patch: Partial<KartenvorschlagEinreichung> = {}): KartenvorschlagEinreichung {
        const schluessel = neuerSchluessel(spuren);
        return {
            operationId: randomUUID(),
            schluessel,
            weg: "link",
            titel: "Gareth - Gesamtplan",
            link: "https://www.ulisses-ebooks.de/de/product/120516/gareth",
            falle: { feld: "", dauerMs: 8000 },
            ...patch,
        };
    }
    function mitDatei(
        typ: "image/jpeg" | "image/png" | "image/webp" | "application/pdf",
        patch: Partial<KartenvorschlagEinreichung> = {},
    ) {
        return link({
            weg: "datei",
            titel: "Selbst gezeichnet",
            datei: { typ, groesse: 1000 },
            nutzung: "avesmaps_only",
            bedingungen: KARTENVORSCHLAG_TERMS_VERSION,
            ...patch,
            // Ein Link gehört nicht zu einer Datei.
            link: undefined as never,
        });
    }
    const zeile = async (schluessel: string) => {
        const [row] = await database<
            {
                id: string;
                state: string;
                way: string;
                asset: string | null;
                moderation: string | null;
                revision: number;
                accepted: string | null;
                typen: string[];
                spoiler: boolean | null;
            }[]
        >`
            SELECT s.id::text AS id, s.state, s.way, s.media_asset_id::text AS asset, a.moderation_state AS moderation, s.revision::int AS revision,
                   s.accepted_citymap_id::text AS accepted, s.type_keys AS typen, s.is_spoiler AS spoiler
              FROM citymap_suggestion s LEFT JOIN media_asset a ON a.id = s.media_asset_id
             WHERE s.status_key_hash = ${schluesselHash(schluessel)}`;
        return row;
    };
    const einreichenOk = async (body: KartenvorschlagEinreichung) => {
        const antwort = await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, body);
        expect(fehler(antwort), "Einreichung").toBe("201");
        expect(Value.Check(KartenvorschlagEingegangen, antwort.json())).toBe(true);
        return antwort.json() as { ok: true; nummer: string; dateiNoetig: boolean };
    };
    /** Der Abgleich im Worker, hier in-Prozess: rechnet die Datei und setzt den technischen Zustand des Werks. */
    async function abgleichen(schluessel: string): Promise<void> {
        const row = await zeile(schluessel);
        const [werk] = await database<
            { public_id: string }[]
        >`SELECT public_id::text AS public_id FROM media_asset WHERE id = ${row!.asset}::bigint`;
        await settleAssetFiles(database, store, { assetPublicId: werk!.public_id, role: "map_full" });
    }

    it("GET stand: nimmt Vorschläge an", async () => {
        const antwort = await app.inject({ method: "GET", url: `${KARTENVORSCHLAG_URL}/stand` });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("no-store");
        expect(Value.Check(KartenvorschlagStand, antwort.json())).toBe(true);
        expect(antwort.json()).toEqual({ einreichen: true });
    });

    it("🔴 fremde Herkunft: 403, nichts wird angelegt", async () => {
        const body = link();
        expect(
            fehler(await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, body, undefined, "https://boese.example")),
        ).toBe("403 forbidden_origin");
        expect(await zeile(body.schluessel)).toBeUndefined();
    });

    it("Link: nur Titel und Link sind Pflicht; der Vorschlag wartet auf die Redaktion und ist nie eine Karte", async () => {
        const body = link();
        const quittung = await einreichenOk(body);
        expect(quittung.nummer).toMatch(/^K-\d+$/);
        expect(quittung.dateiNoetig).toBe(false);
        const row = await zeile(body.schluessel);
        expect(row).toMatchObject({
            state: "pending",
            way: "link",
            asset: null,
            accepted: null,
            typen: [],
            spoiler: null,
        });
        // 🔴 Nie öffentlich: keine Karte mit diesem Titel, kein Werk.
        const [karte] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM citymap WHERE title = ${body.titel}`;
        expect(karte!.n).toBe(0);
    });

    it("Link mit allen freiwilligen Angaben: dreiwertige Angaben bleiben NULL, wenn sie fehlen, und false, wenn sie ausdrücklich „nein“ sind", async () => {
        const ort = await legeOrtAn(database, "Kartenvorschlag-Testort");
        orte.push(ort.id);
        const body = link({
            beschreibung: "  Der Stadtplan mit allen Vierteln  ",
            quelle: "Herz des Reiches",
            placeId: ort.publicId,
            typen: ["stadtplan", "uebersicht", "stadtplan" as never].slice(0, 2) as never,
            urheber: "Elwe von Gareth",
            art: "politisch",
            gueltigAb: 1027,
            gueltigBis: 1045,
            farbe: "farbig",
            spoiler: false,
            offiziell: true,
            vorschauLink: "https://www.ulisses-ebooks.de/images/gareth.jpg",
            notiz: "Beilage der Box",
            name: "Alrike",
        });
        await einreichenOk(body);
        const [row] = await database<Record<string, unknown>[]>`
            SELECT description, source_text, place_id::text AS place_id, type_keys, author, art, valid_from_bf, valid_to_bf, color_mode,
                   is_spoiler, is_labeled, is_official, is_paid, attribution_name
              FROM citymap_suggestion WHERE status_key_hash = ${schluesselHash(body.schluessel)}`;
        expect(row).toMatchObject({
            description: "Der Stadtplan mit allen Vierteln",
            source_text: "Herz des Reiches",
            place_id: ort.id,
            type_keys: ["stadtplan", "uebersicht"],
            author: "Elwe von Gareth",
            art: "politisch",
            valid_from_bf: 1027,
            valid_to_bf: 1045,
            color_mode: "farbig",
            is_spoiler: false,
            is_labeled: null,
            is_official: true,
            is_paid: null,
            attribution_name: "Alrike",
        });
    });

    it("Idempotenz: dieselbe Kennung liefert dieselbe Quittung ohne zweite Zeile; derselbe Schlüssel mit neuer Kennung ist 409", async () => {
        const body = link();
        const erste = await einreichenOk(body);
        const zweite = await einreichenOk(body);
        expect(zweite.nummer).toBe(erste.nummer);
        const [anzahl] = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM citymap_suggestion WHERE status_key_hash = ${schluesselHash(body.schluessel)}`;
        expect(anzahl!.n).toBe(1);
        expect(
            fehler(await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, { ...body, operationId: randomUUID() })),
        ).toBe("409 kartenvorschlag_key_used");
        // Dieselbe Kennung mit fremdem Schlüssel ist keine Wiederholung.
        expect(
            fehler(await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, { ...link(), operationId: body.operationId })),
        ).toBe("409 kartenvorschlag_key_used");
    });

    it("🔴 Honigtopf gefüllt oder Zeitfalle zu schnell: 201 wie bei einer echten Einreichung, aber keine Zeile", async () => {
        const honig = link({ falle: { feld: "http://spam.example", dauerMs: 9000 } });
        const antwort = await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, honig);
        expect(fehler(antwort)).toBe("201");
        expect(Value.Check(KartenvorschlagEingegangen, antwort.json())).toBe(true);
        expect(await zeile(honig.schluessel)).toBeUndefined();
        const schnell = link({ falle: { feld: "", dauerMs: KARTENVORSCHLAG_GRENZEN.mindestDauerMs - 1 } });
        expect(fehler(await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, schnell))).toBe("201");
        expect(await zeile(schnell.schluessel)).toBeUndefined();
    });

    it("🔴 Drossel: die siebte Einreichung einer Adresse in der Stunde ist 429, auch Fallen-Treffer zählen", async () => {
        const ip = neueAdresse();
        for (let i = 0; i < KARTENVORSCHLAG_GRENZEN.jeAdresseJeStunde; i += 1) {
            const body = i % 2 === 0 ? link() : link({ falle: { feld: "x", dauerMs: 9000 } });
            expect(fehler(await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, body, ip)), `Versuch ${String(i)}`).toBe(
                "201",
            );
        }
        const antwort = await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, link(), ip);
        expect(fehler(antwort)).toBe("429 kartenvorschlag_rate");
        // Eine andere Adresse ist nicht betroffen.
        expect(fehler(await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, link()))).toBe("201");
    });

    it("ungültige Angaben: keine URL, falsches Schema, Link UND Datei, Datei ohne Nutzung, unbekannter Ort, Zeitraum verkehrt", async () => {
        const status400 = async (patch: Record<string, unknown>) =>
            fehler(await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, { ...link(), ...patch }));
        expect((await status400({ link: "ftp://irgendwo/karte.png" })).slice(0, 3)).toBe("400");
        expect((await status400({ link: "javascript:alert(1)" })).slice(0, 3)).toBe("400");
        expect((await status400({ link: "kein link" })).slice(0, 3)).toBe("400");
        expect((await status400({ titel: "   " })).slice(0, 3)).toBe("400");
        expect((await status400({ vorschauLink: "data:text/html,x" })).slice(0, 3)).toBe("400");
        expect((await status400({ datei: { typ: "image/gif", groesse: 10 } })).slice(0, 3)).toBe("400");
        expect(
            (await status400({ datei: { typ: "image/png", groesse: KARTENVORSCHLAG_GRENZEN.dateiBytes + 1 } })).slice(
                0,
                3,
            ),
        ).toBe("400");
        // Link UND Datei, Datei ohne Nutzung/Bedingungen, Link ohne Adresse
        expect(await status400({ datei: { typ: "image/png", groesse: 10 } })).toBe("422 kartenvorschlag_invalid");
        expect(await status400({ weg: "datei", link: undefined, datei: { typ: "image/png", groesse: 10 } })).toBe(
            "422 kartenvorschlag_invalid",
        );
        expect(await status400({ link: undefined })).toBe("422 kartenvorschlag_invalid");
        expect(await status400({ placeId: randomUUID() })).toBe("422 kartenvorschlag_invalid");
        expect(await status400({ gueltigAb: 1045, gueltigBis: 1027 })).toBe("422 kartenvorschlag_invalid");
    });

    it("🔴 WI-0291: jede Ablehnung der Einreichung trägt details.reason und die Angaben dazu", async () => {
        const details = async (body: unknown) => {
            const antwort = await senden(`${KARTENVORSCHLAG_URL}/einreichungen`, body);
            expect(antwort.statusCode).toBe(422);
            return (antwort.json() as { error: { details?: Record<string, unknown> } }).error.details;
        };
        const lnk = "https://www.ulisses-ebooks.de/x";
        expect(await details({ ...mitDatei("image/png"), link: lnk })).toEqual({ reason: "datei_und_link" });
        expect(await details(mitDatei("image/png", { nutzung: undefined as never }))).toEqual({
            reason: "datei_angaben_fehlen",
            fehlt: "nutzung",
        });
        expect(await details(mitDatei("image/png", { bedingungen: undefined as never }))).toEqual({
            reason: "datei_angaben_fehlen",
            fehlt: "bedingungen",
        });
        expect(await details({ ...mitDatei("image/png"), datei: undefined })).toEqual({
            reason: "datei_angaben_fehlen",
            fehlt: "datei",
        });
        expect(await details(link({ link: undefined as never }))).toEqual({ reason: "link_fehlt" });
        expect(await details(link({ nutzung: "avesmaps_only" }))).toEqual({ reason: "link_mit_datei" });
        expect(await details(link({ gueltigAb: 1045, gueltigBis: 1027 }))).toEqual({
            reason: "zeitraum_verkehrt",
            gueltigAb: 1045,
            gueltigBis: 1027,
        });
        expect(await details(link({ placeId: randomUUID() }))).toEqual({ reason: "ort_unbekannt" });
        // Ein leerer Text kommt über das Schema nie so weit; die Prüfung der Datenbankzeile sagt trotzdem das Feld.
        expect(() => bereinigt("  ", "Der Titel", "titel")).toThrowError(
            expect.objectContaining({ details: { reason: "feld_leer", feld: "titel" } }),
        );
    });

    it("🔴 WI-0291: die Datei sagt den Grund: leer, Art falsch, Format, Pixel, Kante, zu groß", async () => {
        const grund = async (schluessel: string, bytes: Buffer) => {
            const antwort = await datei(schluessel, bytes);
            const f = (antwort.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
            return { status: antwort.statusCode, code: f.code, details: f.details };
        };
        const neu = async (typ: "image/jpeg" | "image/png") => {
            const b = mitDatei(typ);
            await einreichenOk(b);
            return b.schluessel;
        };
        const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } })
            .png()
            .toBuffer();
        expect(await grund(await neu("image/jpeg"), png)).toMatchObject({
            status: 422,
            code: "kartenvorschlag_invalid",
            details: { reason: "datei_art_falsch", angekuendigt: "image/jpeg", tatsaechlich: "image/png" },
        });
        expect(() => pruefeKartendatei(Buffer.alloc(0), "image/png")).toThrowError(
            expect.objectContaining({ details: { reason: "datei_leer" } }),
        );
        expect(
            await grund(await neu("image/png"), Buffer.from((await svgUpload()).dataBase64, "base64")),
        ).toMatchObject({
            status: 415,
            details: { reason: "unsupported_format" },
        });
        const viele = await sharp({ create: { width: 4100, height: 4100, channels: 3, background: "#123456" } })
            .png()
            .toBuffer();
        expect(await grund(await neu("image/png"), viele)).toMatchObject({
            status: 422,
            code: "media_file_rejected",
            details: { reason: "too_many_pixels" },
        });
        const lang = await sharp({ create: { width: 8300, height: 8, channels: 3, background: "#123456" } })
            .png()
            .toBuffer();
        expect(await grund(await neu("image/png"), lang)).toMatchObject({
            status: 422,
            code: "media_file_rejected",
            details: { reason: "too_large_dimensions" },
        });
        const kaputt = Buffer.concat([png.subarray(0, 40), Buffer.alloc(40, 7)]);
        expect(await grund(await neu("image/png"), kaputt)).toMatchObject({
            status: 422,
            code: "media_file_rejected",
        });
        const zuGross = Buffer.alloc(KARTENVORSCHLAG_GRENZEN.dateiBytes + 1024, 1);
        expect(await grund(await neu("image/png"), zuGross)).toMatchObject({
            status: 413,
            code: "kartenvorschlag_too_large",
            details: { reason: "datei_zu_gross", limitBytes: KARTENVORSCHLAG_GRENZEN.dateiBytes },
        });
    });

    it("Datei JPEG: Metadaten fallen ab, das Werk ist privat und ohne Verwendung, der Abgleich macht den Vorschlag wartend", async () => {
        const body = mitDatei("image/jpeg", { beschreibung: "Eigene Zeichnung", name: "Alrike" });
        const quittung = await einreichenOk(body);
        expect(quittung.dateiNoetig).toBe(true);
        expect(await zeile(body.schluessel)).toMatchObject({ state: "incoming", asset: null });
        const { bytes } = await jpegMitMetadaten(7);
        expect(fehler(await datei(body.schluessel, bytes))).toBe("200");
        const row = (await zeile(body.schluessel))!;
        expect(row.asset).not.toBeNull();
        expect(row.moderation).toBe("pending");
        // 🔴 Kein Geheimnis in der privaten Quelle, keine Verwendung, ein Abgleich eingereiht.
        const [quelle] = await database<
            { storage_key: string }[]
        >`SELECT storage_key FROM media_file WHERE media_asset_id = ${row.asset}::bigint AND storage_class = 'private_source'`;
        const abgelegt = (await readFile(store.pathFor(quelle!.storage_key))).toString("latin1");
        for (const geheimnis of EXIF_GEHEIMNISSE) expect(abgelegt).not.toContain(geheimnis);
        const [verwendung] = await database<
            { n: number }[]
        >`SELECT (SELECT count(*) FROM citymap_media WHERE media_asset_id = ${row.asset}::bigint)::int AS n`;
        expect(verwendung!.n).toBe(0);
        const [auftrag] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = (SELECT public_id::text FROM media_asset WHERE id = ${row.asset}::bigint)`;
        expect(auftrag!.n).toBe(1);
        // Zweiter Aufruf (Wiederholung des Hochladens): wirkungslos, kein zweites Werk.
        expect(fehler(await datei(body.schluessel, bytes))).toBe("200");
        expect((await zeile(body.schluessel))!.asset).toBe(row.asset);

        await abgleichen(body.schluessel);
        const antwort = await status(body.schluessel);
        expect(fehler(antwort)).toBe("200");
        expect(Value.Check(KartenvorschlagStatus, antwort.json())).toBe(true);
        expect(antwort.json()).toMatchObject({
            zustand: "pending",
            weg: "datei",
            dateiTyp: "image/jpeg",
            zurueckziehbar: true,
            link: null,
        });
        expect((await zeile(body.schluessel))!.state).toBe("pending");
    });

    it("🔴 Datei über den 6 MiB der Medienverwaltung (PNG ~9 MB): Vorschlagsweg nimmt sie an, der Abgleich verarbeitet sie; die globale Grenze bleibt", async () => {
        const breite = 2200;
        const hoehe = 1400;
        const rauschen = await sharp(randomBytes(breite * hoehe * 3), {
            raw: { width: breite, height: hoehe, channels: 3 },
        })
            .png({ compressionLevel: 0 })
            .toBuffer();
        expect(rauschen.byteLength).toBeGreaterThan(6 * 1024 * 1024);
        expect(rauschen.byteLength).toBeLessThan(KARTENVORSCHLAG_GRENZEN.dateiBytes);
        const body = mitDatei("image/png");
        await einreichenOk(body);
        expect(fehler(await datei(body.schluessel, rauschen))).toBe("200");
        await abgleichen(body.schluessel);
        expect(((await status(body.schluessel)).json() as { zustand: string }).zustand).toBe("pending");
        const [technik] = await database<{ technical_state: string }[]>`
            SELECT a.technical_state FROM media_asset a JOIN citymap_suggestion s ON s.media_asset_id = a.id WHERE s.status_key_hash = ${schluesselHash(body.schluessel)}`;
        expect(technik!.technical_state).toBe("ok");
    });

    it("Datei PDF: Seite 1 wird gerastert, der Vorschlag wartet auf die Redaktion; ein kaputtes PDF wird technical_failed", async () => {
        const gut = mitDatei("application/pdf");
        await einreichenOk(gut);
        expect(fehler(await datei(gut.schluessel, pdfEinfach()))).toBe("200");
        await abgleichen(gut.schluessel);
        expect(((await status(gut.schluessel)).json() as { zustand: string }).zustand).toBe("pending");

        const kaputt = mitDatei("application/pdf");
        await einreichenOk(kaputt);
        const halb = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog"), Buffer.from("kein ende")]);
        expect(fehler(await datei(kaputt.schluessel, halb))).toBe("200");
        await abgleichen(kaputt.schluessel);
        const antwort = (await status(kaputt.schluessel)).json() as { zustand: string; zurueckziehbar: boolean };
        expect(antwort).toMatchObject({ zustand: "technical_failed", zurueckziehbar: true });
    });

    it("falsches Format: SVG 415, GIF 415, Art passt nicht zur Angabe 422, leere Datei 422, falscher Schlüssel 404; es entsteht nie ein Werk", async () => {
        const svg = mitDatei("image/png");
        await einreichenOk(svg);
        expect(fehler(await datei(svg.schluessel, Buffer.from((await svgUpload()).dataBase64, "base64")))).toBe(
            "415 unsupported_media_type",
        );
        const gif = mitDatei("image/png");
        await einreichenOk(gif);
        const gifBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } })
            .gif()
            .toBuffer();
        expect(fehler(await datei(gif.schluessel, gifBytes))).toBe("415 unsupported_media_type");
        const falsch = mitDatei("image/jpeg");
        await einreichenOk(falsch);
        const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } })
            .png()
            .toBuffer();
        expect(fehler(await datei(falsch.schluessel, png))).toBe("422 kartenvorschlag_invalid");
        expect(fehler(await datei(falsch.schluessel, Buffer.alloc(0)))).toMatch(/^(400|415|422)/);
        for (const body of [svg, gif, falsch]) expect((await zeile(body.schluessel))!.asset).toBeNull();
        expect(fehler(await datei(neuerSchluessel(), png))).toBe("404 kartenvorschlag_not_found");
        expect(
            fehler(
                await roh("PUT", `${KARTENVORSCHLAG_URL}/datei`, png, {
                    headers: {
                        "content-type": "application/octet-stream",
                        [KARTENVORSCHLAG_SCHLUESSEL_KOPF]: "zu-kurz",
                    },
                }),
            ),
        ).toBe("404 kartenvorschlag_not_found");
        // Ein Link-Vorschlag nimmt keine Datei an.
        const nurLink = link();
        await einreichenOk(nurLink);
        expect(fehler(await datei(nurLink.schluessel, png))).toBe("409 kartenvorschlag_transition");
        // WI-0291: der Grund und der Zustand stehen in details.
        expect(
            ((await datei(nurLink.schluessel, png)).json() as { error: { details: unknown } }).error.details,
        ).toEqual({ reason: "kein_dateiweg", zustand: "pending" });
    });

    it("zu groß: über 50 MiB ist 413 und es entsteht kein Werk", async () => {
        const body = mitDatei("image/png");
        await einreichenOk(body);
        const zuGross = Buffer.alloc(KARTENVORSCHLAG_GRENZEN.dateiBytes + 1024, 1);
        expect(fehler(await datei(body.schluessel, zuGross)).slice(0, 3)).toBe("413");
        const drueber = Buffer.alloc(KARTENVORSCHLAG_GRENZEN.dateiBytes + 200 * 1024, 1);
        expect(fehler(await datei(body.schluessel, drueber)).slice(0, 3)).toBe("413");
        expect((await zeile(body.schluessel))!.asset).toBeNull();
    });

    it("🔴 Drossel der Dateien: die siebte Datei einer Adresse in der Stunde ist 429", async () => {
        const ip = neueAdresse();
        for (let i = 0; i < KARTENVORSCHLAG_GRENZEN.dateiJeAdresseJeStunde; i += 1) {
            expect(fehler(await datei(neuerSchluessel(), Buffer.from("x"), ip)), `Versuch ${String(i)}`).toBe(
                "404 kartenvorschlag_not_found",
            );
        }
        expect(fehler(await datei(neuerSchluessel(), Buffer.from("x"), ip))).toBe("429 kartenvorschlag_rate");
    });

    it("Statusseite: ein falscher Schlüssel liefert immer denselben 404-Satz; der Schlüssel steht in keiner Logzeile und keiner Antwort", async () => {
        const body = link();
        await einreichenOk(body);
        const falsch = await status(neuerSchluessel());
        expect(fehler(falsch)).toBe("404 kartenvorschlag_not_found");
        expect(falsch.body).toContain("Zu diesem Link gibt es keinen Kartenvorschlag (mehr).");
        const richtig = await status(body.schluessel);
        expect(Value.Check(KartenvorschlagStatus, richtig.json())).toBe(true);
        expect(richtig.json()).toMatchObject({
            zustand: "pending",
            weg: "link",
            titel: body.titel,
            link: body.link,
            grund: null,
        });
        expect(richtig.body).not.toContain(body.schluessel);
        expect(logzeilen.join("\n")).not.toContain(body.schluessel);
    });

    it("Zurückziehen: wartend → zurückgezogen (Werk abgelehnt), wiederholbar; nach der Entscheidung 409", async () => {
        const body = mitDatei("image/jpeg");
        await einreichenOk(body);
        const { bytes } = await jpegMitMetadaten(11);
        await datei(body.schluessel, bytes);
        await abgleichen(body.schluessel);
        const aktion = () =>
            senden(`${KARTENVORSCHLAG_URL}/status/zurueckziehen`, {
                schluessel: body.schluessel,
                operationId: randomUUID(),
            });
        const erste = await aktion();
        expect(fehler(erste)).toBe("200");
        expect(erste.json()).toMatchObject({ zustand: "withdrawn", zurueckziehbar: false });
        expect((await zeile(body.schluessel))!.moderation).toBe("rejected");
        expect(fehler(await aktion())).toBe("200");
        expect(
            fehler(
                await senden(`${KARTENVORSCHLAG_URL}/status/zurueckziehen`, {
                    schluessel: neuerSchluessel(),
                    operationId: randomUUID(),
                }),
            ),
        ).toBe("404 kartenvorschlag_not_found");
    });

    it("🔴 Datenbank: angenommen verlangt eine Karte, Link und Datei schließen sich aus", async () => {
        const body = link();
        await einreichenOk(body);
        await expect(
            database`UPDATE citymap_suggestion SET state = 'approved', decided_at = now() WHERE status_key_hash = ${schluesselHash(body.schluessel)}`,
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
            database`UPDATE citymap_suggestion SET file_mime = 'image/png' WHERE status_key_hash = ${schluesselHash(body.schluessel)}`,
        ).rejects.toMatchObject({ code: "23514" });
    });

    it("Redaktion: ohne Anmeldung 401, ohne Recht 403; Liste (Standard: wartende, älteste zuerst), Detail, Ablehnen mit Grund und Ereignis", async () => {
        expect(fehler(await app.inject({ method: "GET", url: KARTENVORSCHLAG_REDAKTION_URL }))).toMatch(/^401/);
        expect(
            fehler(
                await app.inject({
                    method: "GET",
                    url: KARTENVORSCHLAG_REDAKTION_URL,
                    headers: { cookie: tester.cookie },
                }),
            ),
        ).toMatch(/^403/);

        const a = link({ titel: "Redaktion A" });
        const b = mitDatei("image/jpeg", { titel: "Redaktion B", quelle: "Aventurischer Bote" });
        await einreichenOk(a);
        await einreichenOk(b);
        await datei(b.schluessel, (await jpegMitMetadaten(21)).bytes);
        await abgleichen(b.schluessel);

        const liste = await app.inject({
            method: "GET",
            url: `${KARTENVORSCHLAG_REDAKTION_URL}?limit=100`,
            headers: { cookie: reviewer.cookie },
        });
        expect(liste.statusCode).toBe(200);
        expect(Value.Check(KartenvorschlagListe, liste.json())).toBe(true);
        const eintraege = (liste.json() as KartenvorschlagListe).eintraege;
        const iA = eintraege.findIndex((e) => e.titel === "Redaktion A");
        const iB = eintraege.findIndex((e) => e.titel === "Redaktion B");
        expect(iA).toBeGreaterThanOrEqual(0);
        expect(iB).toBeGreaterThan(iA);
        expect(eintraege.every((e) => e.zustand === "pending")).toBe(true);

        const idB = eintraege[iB]!.id;
        const detail = await app.inject({
            method: "GET",
            url: `${KARTENVORSCHLAG_REDAKTION_URL}/${idB}`,
            headers: { cookie: reviewer.cookie },
        });
        expect(detail.statusCode).toBe(200);
        expect(Value.Check(KartenvorschlagDetail, detail.json())).toBe(true);
        const d = detail.json() as KartenvorschlagDetail;
        expect(d).toMatchObject({ quelle: "Aventurischer Bote", dateiTyp: "image/jpeg", technik: "ok" });
        expect(d.asset).not.toBeNull();

        const ablehnen = (id: string, payload: Record<string, unknown>, cookie = reviewer.cookie) =>
            app.inject({
                method: "POST",
                url: `${KARTENVORSCHLAG_REDAKTION_URL}/${id}/ablehnen`,
                payload,
                headers: { origin: TEST_ORIGIN, cookie },
            });
        // Falsche Revision: 409, nichts geändert.
        expect(fehler(await ablehnen(idB, { operationId: randomUUID(), baseRevision: d.revision + 5 }))).toBe(
            "409 kartenvorschlag_conflict",
        );
        expect(
            fehler(await ablehnen(idB, { operationId: randomUUID(), baseRevision: d.revision }, tester.cookie)),
        ).toMatch(/^403/);
        const erst = await ablehnen(idB, {
            operationId: randomUUID(),
            baseRevision: d.revision,
            grund: "Rechte unklar",
        });
        expect(fehler(erst)).toBe("200");
        expect(erst.json()).toMatchObject({ zustand: "rejected", grund: "Rechte unklar" });
        // Wiederholung: derselbe Stand, kein zweites Ereignis; das Werk ist abgelehnt (keine Veröffentlichung).
        expect(fehler(await ablehnen(idB, { operationId: randomUUID(), baseRevision: d.revision }))).toBe("200");
        expect((await zeile(b.schluessel))!.moderation).toBe("rejected");
        const [ereignisse] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event WHERE action = 'system.community_kartenvorschlag_abgelehnt' AND target_ref = ${idB}`;
        expect(ereignisse!.n).toBe(1);
        // Der Einreicher liest den Grund auf seiner Statusseite; Ablehnen ist endgültig.
        expect((await status(b.schluessel)).json()).toMatchObject({
            zustand: "rejected",
            grund: "Rechte unklar",
            zurueckziehbar: false,
        });
        expect(
            fehler(
                await senden(`${KARTENVORSCHLAG_URL}/status/zurueckziehen`, {
                    schluessel: b.schluessel,
                    operationId: randomUUID(),
                }),
            ),
        ).toBe("409 kartenvorschlag_transition");
        // Unbekannter Vorschlag: 404; die Liste der abgelehnten zeigt ihn.
        expect(fehler(await ablehnen(randomUUID(), { operationId: randomUUID(), baseRevision: 1 }))).toBe(
            "404 kartenvorschlag_not_found",
        );
        const abgelehnt = await app.inject({
            method: "GET",
            url: `${KARTENVORSCHLAG_REDAKTION_URL}?zustand=rejected&limit=100`,
            headers: { cookie: reviewer.cookie },
        });
        expect((abgelehnt.json() as KartenvorschlagListe).eintraege.map((e) => e.id)).toContain(idB);
    });
});
