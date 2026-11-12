import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    PHOTOBOX_GRENZEN,
    PHOTOBOX_URL,
    PhotoboxEingegangen,
    PhotoboxStand,
    PhotoboxStatus,
    type PhotoboxEinreichung,
    type PhotoboxUsageGrant,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { schluesselHash } from "../src/community/db.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { technikNachziehen } from "../src/photobox/db.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore, quarantineKey } from "../src/media/storage.ts";
import { TEST_AUTH, TEST_ORIGIN } from "./support/auth-fixture.ts";
import {
    EXIF_GEHEIMNISSE,
    einreichung,
    jpegMitMetadaten,
    legeOrtAn,
    neueOperation,
    neueSpuren,
    pngUpload,
    raeumeAuf,
    svgUpload,
    zaehle,
} from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Die öffentlichen Routen der Reisebilder (WI-0272 S2, Aufgabe 10, `routes/photobox.ts`) über `app.inject`, gegen echtes PostgreSQL und einen echten
 * Medienspeicher:
 *
 * - Herkunft (fremde Seite 403), Falle (Honigtopf, Zeitfalle: 201 ohne Zeile), Drossel (die siebte Einreichung je Adresse und Stunde 429; alles zur
 *   Drossel, auch die Statusdrossel und gleichzeitige Anfragen, steht in `photobox-drossel.test.ts`), Schalter aus (503, `stand.einreichen` falsch);
 * - Status: falscher Schlüssel 404 mit dem einen Satz, richtiger liefert `PhotoboxStatus` (nie Schlüssel oder interne Kennungen);
 * - Aktionen: Zurückziehen, danach Beschreibung 409; Beschreibung nach der Freigabe wartet; Bild ersetzen; Offline nimmt die öffentliche Datei sofort;
 *   Nutzung nach der Freigabe nie zurück zu `avesmaps_only`; jede Aktion höchstens einmal je Kennung (M10) und mit anonymem Protokoll;
 * - 🔴 der Schlüssel taucht in keiner Logzeile und keiner Antwort auf (Logger-Attrappe).
 */

const TEXT_FEHLT = "Zu diesem Link gibt es kein Reisebild (mehr).";

function config(mediaRoot: string | undefined): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "photobox-routes-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        ...(mediaRoot === undefined ? {} : { mediaRoot }),
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Reisebilder: öffentliche Routen (WI-0272 S2, Aufgabe 10)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    const logzeilen: string[] = [];
    const spuren = neueSpuren();
    const orte: string[] = [];
    /** Jede Gruppe von Anfragen kommt von einer eigenen Adresse, damit die Drossel nicht über Tests hinweg zählt. */
    let adresse = 10;
    const neueAdresse = (): string => `10.40.0.${String(adresse++)}`;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-routes-"));
        store = new MediaStore(mediaRoot);
        app = buildApp({
            config: config(mediaRoot),
            database: createDatabase(testDatabaseUrl as string, { max: 3 }),
            logStream: { write: (zeile) => void logzeilen.push(zeile) },
        });
        await app.ready();
    }, 120_000);

    afterEach(async () => {
        await schalter(true);
    });

    afterAll(async () => {
        await app?.close();
        await raeumeAuf(database, spuren);
        for (const ort of orte) await database`DELETE FROM place WHERE id = ${ort}::bigint`;
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    /** Der Schalter „Einreichungen annehmen“, direkt in der Tafel (der Weckruf der Revision fehlt im Test: der Speicher wird verworfen). */
    async function schalter(an: boolean): Promise<void> {
        if (an) await database`DELETE FROM content_switch WHERE key = 'photobox.submissions'`;
        else {
            await database`
                INSERT INTO content_switch (key, enabled, changed_at, changed_by_label)
                VALUES ('photobox.submissions', false, now(), 'photobox-routes-test')
                ON CONFLICT (key) DO UPDATE SET enabled = false`;
        }
        app?.inhaltsschalter?.forget();
    }

    const senden = (url: string, payload: unknown, ip: string = neueAdresse(), origin: string = TEST_ORIGIN) =>
        app.inject({ method: "POST", url, payload: payload as object, remoteAddress: ip, headers: { origin } });
    const fehler = (antwort: { statusCode: number; json(): unknown }): string =>
        antwort.statusCode < 300
            ? String(antwort.statusCode)
            : `${String(antwort.statusCode)} ${(antwort.json() as { error: { code: string } }).error.code}`;
    const status = (schluessel: string, ip: string = neueAdresse()) =>
        senden(`${PHOTOBOX_URL}/status`, { schluessel }, ip);
    const aktion = (
        name: string,
        schluessel: string,
        felder: Record<string, unknown> = {},
        ip: string = neueAdresse(),
    ) => senden(`${PHOTOBOX_URL}/status/${name}`, { schluessel, operationId: neueOperation(spuren), ...felder }, ip);

    /** Reicht ein Bild ein (201) und gibt den Rumpf zurück. */
    async function eingereicht(seed: number, patch: Partial<PhotoboxEinreichung> = {}): Promise<PhotoboxEinreichung> {
        const body = await einreichung(spuren, seed, patch);
        const antwort = await senden(`${PHOTOBOX_URL}/einreichungen`, body);
        expect(fehler(antwort), "Einreichung").toBe("201");
        return body;
    }

    const zeile = async (schluessel: string) => {
        const [row] = await database<
            {
                id: string;
                state: string;
                description: string;
                pending_description: string | null;
                usage_grant: string;
                revision: number;
                alt: boolean;
                approved: string | null;
            }[]
        >`
            SELECT id::text AS id, state, description, pending_description, usage_grant, revision::int AS revision,
                   state_changed_at < now() - interval '1 day' AS alt, approved_media_asset_id::text AS approved
              FROM media_submission WHERE status_key_hash = ${schluesselHash(schluessel)}`;
        return row!;
    };
    /** Setzt den Zustand der Einreichung wie die Redaktion (S3) es tun wird; der letzte Wechsel liegt zehn Tage zurück. */
    async function setzeZustand(schluessel: string, zustand: string): Promise<void> {
        await database`
            UPDATE media_submission s
               SET state = ${zustand}, state_changed_at = now() - interval '10 days',
                   approved_media_asset_id = CASE WHEN ${zustand} IN ('approved', 'offline')
                       THEN (SELECT media_asset_id FROM media_ingest WHERE submission_id = s.id ORDER BY id DESC LIMIT 1)
                       ELSE approved_media_asset_id END
             WHERE status_key_hash = ${schluesselHash(schluessel)}`;
    }
    const assetsDer = (submissionId: string) =>
        database<{ id: string; public_id: string; moderation: string }[]>`
            SELECT a.id::text AS id, a.public_id::text AS public_id, a.moderation_state AS moderation
              FROM media_ingest i JOIN media_asset a ON a.id = i.media_asset_id
             WHERE i.submission_id = ${submissionId}::bigint ORDER BY i.id`;

    it("GET stand: nimmt Einreichungen an, solange der Schalter an ist", async () => {
        const antwort = await app.inject({ method: "GET", url: `${PHOTOBOX_URL}/stand` });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("no-store");
        expect(Value.Check(PhotoboxStand, antwort.json())).toBe(true);
        expect(antwort.json()).toEqual({ einreichen: true });
    });

    it("🔴 fremde Herkunft: 403, nichts wird angelegt; eine Anfrage ohne Origin ebenso", async () => {
        const body = await einreichung(spuren, 1);
        expect(
            fehler(await senden(`${PHOTOBOX_URL}/einreichungen`, body, neueAdresse(), "https://boese.example")),
        ).toBe("403 forbidden_origin");
        const ohne = await app.inject({
            method: "POST",
            url: `${PHOTOBOX_URL}/status`,
            payload: { schluessel: body.schluessel },
        });
        expect(fehler(ohne)).toBe("403 forbidden_origin");
        expect((await zaehle(database, spuren)).einreichung).toBe(0);
    });

    it("🔴 Honigtopf gefüllt oder Zeitfalle zu schnell: 201 wie bei einer echten Einreichung, aber keine Zeile und keine Datei", async () => {
        const honig = await einreichung(spuren, 2, { falle: { feld: "http://spam.example", dauerMs: 9000 } });
        const antwort = await senden(`${PHOTOBOX_URL}/einreichungen`, honig);
        expect(fehler(antwort)).toBe("201");
        expect(Value.Check(PhotoboxEingegangen, antwort.json())).toBe(true);
        const schnell = await einreichung(spuren, 3, {
            falle: { feld: "", dauerMs: PHOTOBOX_GRENZEN.mindestDauerMs - 1 },
        });
        expect(fehler(await senden(`${PHOTOBOX_URL}/einreichungen`, schnell))).toBe("201");
        expect(await zaehle(database, spuren)).toEqual({
            einreichung: 0,
            asset: 0,
            datei: 0,
            eingang: 0,
            operation: 0,
            auftrag: 0,
        });
    });

    it("eine gültige Einreichung: 201 { ok: true }; der Status zeigt sie, ohne Schlüssel und ohne interne Kennung", async () => {
        const ort = await legeOrtAn(database, "Havena-Testort");
        orte.push(ort.id);
        const body = await eingereicht(4, {
            placeId: ort.publicId,
            blickrichtung: 2,
            name: "Alrike",
            beschreibung: "Der Blick vom Hafen",
        });
        const antwort = await status(body.schluessel);
        expect(fehler(antwort)).toBe("200");
        const sicht = antwort.json() as Record<string, unknown>;
        expect(Value.Check(PhotoboxStatus, sicht)).toBe(true);
        expect(sicht).toMatchObject({
            zustand: "incoming",
            beschreibung: "Der Blick vom Hafen",
            entstehung: "photo",
            nutzung: "avesmaps_only",
            blickrichtung: 2,
            name: "Alrike",
            lage: { x: 300, y: 300 },
            ortName: "Havena-Testort",
            vorschauBereit: false,
            angepasst: false,
        });
        expect(new Date(sicht["eingereichtAm"] as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
        expect(sicht).not.toHaveProperty("wartendeBeschreibung");
        expect(sicht).not.toHaveProperty("nachricht");
        expect(antwort.body).not.toContain(body.schluessel);
        expect(await zaehle(database, spuren)).toEqual({
            einreichung: 1,
            asset: 1,
            datei: 1,
            eingang: 1,
            operation: 1,
            auftrag: 1,
        });
    });

    it("🔴 die siebte Einreichung derselben Adresse in einer Stunde: 429 photobox_rate; eine andere Adresse darf weiter", async () => {
        const ip = neueAdresse();
        for (let nummer = 0; nummer < PHOTOBOX_GRENZEN.jeAdresseJeStunde; nummer += 1) {
            const body = await einreichung(spuren, 20 + nummer);
            expect(
                fehler(await senden(`${PHOTOBOX_URL}/einreichungen`, body, ip)),
                `Einreichung ${String(nummer + 1)}`,
            ).toBe("201");
        }
        const siebte = await einreichung(spuren, 30);
        const abgelehnt = await senden(`${PHOTOBOX_URL}/einreichungen`, siebte, ip);
        expect(fehler(abgelehnt)).toBe("429 photobox_rate");
        expect((await zaehle(database, { ...spuren, schluessel: [siebte.schluessel] })).einreichung).toBe(0);
        // Eine andere Adresse ist nicht betroffen, und derselbe Rumpf geht dort durch.
        expect(fehler(await senden(`${PHOTOBOX_URL}/einreichungen`, siebte, neueAdresse()))).toBe("201");
    });

    it("🔴 Schalter aus: 503 photobox_paused, stand.einreichen ist falsch, der Status des Eingereichten bleibt lesbar", async () => {
        const vorher = await eingereicht(40);
        await schalter(false);
        const body = await einreichung(spuren, 41);
        expect(fehler(await senden(`${PHOTOBOX_URL}/einreichungen`, body))).toBe("503 photobox_paused");
        expect((await zaehle(database, { ...spuren, schluessel: [body.schluessel] })).einreichung).toBe(0);
        const stand = await app.inject({ method: "GET", url: `${PHOTOBOX_URL}/stand` });
        expect(stand.json()).toEqual({ einreichen: false });
        // Was schon eingereicht ist, bleibt bedienbar (nur NEUE Bilder pausieren).
        expect(fehler(await status(vorher.schluessel))).toBe("200");
        expect(fehler(await aktion("beschreibung", vorher.schluessel, { beschreibung: "Auch jetzt änderbar" }))).toBe(
            "200",
        );
        // Wieder an: die Einreichung geht.
        await schalter(true);
        expect((await app.inject({ method: "GET", url: `${PHOTOBOX_URL}/stand` })).json()).toEqual({
            einreichen: true,
        });
        expect(fehler(await senden(`${PHOTOBOX_URL}/einreichungen`, body))).toBe("201");
    });

    it("🔴 ein falscher Schlüssel: 404 photobox_not_found mit dem einen Satz, auf jeder Route", async () => {
        const unbekannt = "A".repeat(43);
        const antwort = await status(unbekannt);
        expect(fehler(antwort)).toBe("404 photobox_not_found");
        expect((antwort.json() as { error: { message: string } }).error.message).toBe(TEXT_FEHLT);
        for (const name of ["beschreibung", "bild", "zurueckziehen", "offline", "nutzung"]) {
            const felder: Record<string, unknown> =
                name === "beschreibung"
                    ? { beschreibung: "x" }
                    : name === "bild"
                      ? { bild: await pngUpload(50) }
                      : name === "nutzung"
                        ? { nutzung: "cc-by-4.0" }
                        : {};
            const roh = await aktion(name, unbekannt, felder);
            expect(fehler(roh), name).toBe("404 photobox_not_found");
            expect((roh.json() as { error: { message: string } }).error.message, name).toBe(TEXT_FEHLT);
        }
        const vorschau = await senden(`${PHOTOBOX_URL}/status/vorschau`, { schluessel: unbekannt });
        expect(fehler(vorschau)).toBe("404 photobox_not_found");
        // Ein Schlüssel, der kein Schlüssel ist, scheitert schon an der Form.
        expect(fehler(await status("zu-kurz"))).toBe("400 validation_failed");
    });

    it("🔴 Zurückziehen vor der Freigabe: withdrawn; danach Beschreibung, Bild, Nutzung, Offline und noch einmal Zurückziehen sind 409", async () => {
        const body = await eingereicht(60);
        const vorher = await zeile(body.schluessel);
        const antwort = await aktion("zurueckziehen", body.schluessel);
        expect(fehler(antwort)).toBe("200");
        expect((antwort.json() as { zustand: string }).zustand).toBe("withdrawn");
        const nachher = await zeile(body.schluessel);
        expect(nachher.state).toBe("withdrawn");
        expect(nachher.revision).toBeGreaterThan(vorher.revision);
        // Das Bild ist abgelehnt (nie mehr bindbar).
        expect((await assetsDer(vorher.id)).map((asset) => asset.moderation)).toEqual(["rejected"]);

        expect(fehler(await aktion("beschreibung", body.schluessel, { beschreibung: "Neu" }))).toBe(
            "409 photobox_transition",
        );
        expect(fehler(await aktion("bild", body.schluessel, { bild: await pngUpload(61) }))).toBe(
            "409 photobox_transition",
        );
        expect(fehler(await aktion("nutzung", body.schluessel, { nutzung: "cc-by-4.0" }))).toBe(
            "409 photobox_transition",
        );
        expect(fehler(await aktion("offline", body.schluessel))).toBe("409 photobox_transition");
        const nochmal = await aktion("zurueckziehen", body.schluessel);
        expect(fehler(nochmal)).toBe("409 photobox_transition");
        // WI-0291: Fachcode und Zustand stehen in `details`, das Fenster sagt „zurückgezogen“ und rät zum Neuladen.
        expect((nochmal.json() as { error: { details?: unknown } }).error.details).toEqual({
            reason: "uebergang",
            zustand: "withdrawn",
        });
        // Der Status bleibt lesbar.
        const sicht = await status(body.schluessel);
        expect((sicht.json() as { zustand: string }).zustand).toBe("withdrawn");
        // Nichts davon hat etwas geändert.
        expect((await zeile(body.schluessel)).description).toBe(vorher.description);
    });

    it("🔴 vor der Freigabe offline zu gehen ist 409; die Aktion eines nicht erlaubten Zustands schreibt nichts", async () => {
        const body = await eingereicht(62);
        const vorher = await zeile(body.schluessel);
        expect(fehler(await aktion("offline", body.schluessel))).toBe("409 photobox_transition");
        const nachher = await zeile(body.schluessel);
        expect(nachher.revision).toBe(vorher.revision);
        expect(nachher.state).toBe("incoming");
    });

    it("Beschreibung: vor der Freigabe sofort und getrimmt (nur Leerraum ist abgewiesen), nach der Freigabe wartet sie; state_changed_at bleibt stehen", async () => {
        const body = await eingereicht(70, { beschreibung: "Erste Fassung" });
        const erste = await aktion("beschreibung", body.schluessel, { beschreibung: "  Zweite Fassung  " });
        expect(fehler(erste)).toBe("200");
        expect(erste.json()).toMatchObject({ zustand: "incoming", beschreibung: "Zweite Fassung" });
        // Nur Leerraum weist schon das Schema ab (`pattern: "\S"`, 400); die 422 der Funktion (`bereinigt`) ist das Netz dahinter.
        expect(fehler(await aktion("beschreibung", body.schluessel, { beschreibung: "   " }))).toBe(
            "400 validation_failed",
        );
        expect(fehler(await aktion("beschreibung", body.schluessel, { beschreibung: "x".repeat(301) }))).toBe(
            "400 validation_failed",
        );

        await setzeZustand(body.schluessel, "approved");
        const vorher = await zeile(body.schluessel);
        expect(vorher.alt).toBe(true);
        const nach = await aktion("beschreibung", body.schluessel, { beschreibung: "Dritte Fassung" });
        expect(fehler(nach)).toBe("200");
        expect(nach.json()).toMatchObject({
            zustand: "approved",
            beschreibung: "Zweite Fassung",
            wartendeBeschreibung: "Dritte Fassung",
        });
        const row = await zeile(body.schluessel);
        expect(row).toMatchObject({
            description: "Zweite Fassung",
            pending_description: "Dritte Fassung",
            state: "approved",
        });
        // Der Zustand hat sich nicht geändert, also auch nicht der Zeitpunkt des Wechsels.
        expect(row.alt).toBe(true);
        expect(row.revision).toBeGreaterThan(vorher.revision);
    });

    /** Die privaten Quellen (Zeile und Datei) der Assets einer Einreichung, in der Reihenfolge des Eingangs. */
    const quellenDer = async (submissionId: string) => {
        const zeilen = await database<{ storage_key: string; sha256: string; byte_size: number; mime_type: string }[]>`
            SELECT f.storage_key, f.sha256, f.byte_size::int AS byte_size, f.mime_type
              FROM media_ingest i JOIN media_file f ON f.media_asset_id = i.media_asset_id AND f.storage_class = 'private_source'
             WHERE i.submission_id = ${submissionId}::bigint ORDER BY i.id`;
        return Promise.all(
            zeilen.map(async (zeile) => ({ ...zeile, bytes: await store.read(zeile.storage_key, 8 * 1024 * 1024) })),
        );
    };
    const ohneMetadaten = (bytes: Uint8Array): void => {
        for (const geheimnis of EXIF_GEHEIMNISSE)
            expect(Buffer.from(bytes).includes(Buffer.from(geheimnis, "latin1")), geheimnis).toBe(false);
    };

    it("🔴 Metadaten fallen beim Eingang weg (WI-0272 S3, Fixrunde A): eine Einreichung und eine Ersetzung mit GPS-EXIF, XMP und Anhang legen eine saubere Quelle ab", async () => {
        const mit = await jpegMitMetadaten(90);
        for (const geheimnis of EXIF_GEHEIMNISSE)
            expect(mit.bytes.includes(Buffer.from(geheimnis, "latin1")), geheimnis).toBe(true);
        const zuvor = await zaehle(database, spuren);
        const body = await eingereicht(90, { bild: mit.upload });
        const eingeschickt = await zeile(body.schluessel);
        const [quelle] = await quellenDer(eingeschickt.id);
        expect(quelle).toBeDefined();
        ohneMetadaten(quelle!.bytes);
        expect((await sharp(quelle!.bytes).metadata()).exif).toBeUndefined();
        // Prüfsumme, Größe und Ablage sind die der bereinigten Bytes; das Bild ist dasselbe.
        expect(quelle!.sha256).toBe(createHash("sha256").update(quelle!.bytes).digest("hex"));
        expect(quelle!.byte_size).toBe(quelle!.bytes.length);
        expect(quelle!.bytes.length).toBeLessThan(mit.bytes.length);
        expect(quelle!.mime_type).toBe("image/jpeg");
        const vorher = await sharp(mit.bytes).raw().toBuffer({ resolveWithObject: true });
        const nachher = await sharp(quelle!.bytes).raw().toBuffer({ resolveWithObject: true });
        expect([nachher.info.width, nachher.info.height]).toEqual([vorher.info.width, vorher.info.height]);
        expect(nachher.data.equals(vorher.data)).toBe(true);

        // Dieselbe Kennung mit denselben Bytes noch einmal: dieselbe Quittung, keine zweite Zeile (die Wiederholungserkennung rechnet mit den bereinigten Bytes).
        const noch = await senden(`${PHOTOBOX_URL}/einreichungen`, body);
        expect(fehler(noch)).toBe("201");
        expect((await zaehle(database, spuren)).einreichung).toBe(zuvor.einreichung + 1);

        // Das Bild ersetzen: auch die neue Quelle ist sauber.
        await setzeZustand(body.schluessel, "pending");
        const zweites = await jpegMitMetadaten(91);
        expect(fehler(await aktion("bild", body.schluessel, { bild: zweites.upload }))).toBe("200");
        const quellen = await quellenDer(eingeschickt.id);
        expect(quellen.length).toBe(2);
        ohneMetadaten(quellen[1]!.bytes);
        expect(quellen[1]!.sha256).toBe(createHash("sha256").update(quellen[1]!.bytes).digest("hex"));
    });

    it("🔴 ein Bild, das nur durch seine EXIF-Ausrichtung aufrecht steht, ist 422 und legt nichts an (Einreichen und Ersetzen); Ausrichtung 1 geht", async () => {
        const gedreht = await jpegMitMetadaten(92, { ausrichtung: 6 });
        const zuvor = await zaehle(database, spuren);
        const abgewiesen = await einreichung(spuren, 92, { bild: gedreht.upload });
        expect(fehler(await senden(`${PHOTOBOX_URL}/einreichungen`, abgewiesen))).toBe("422 media_file_rejected");
        expect(await zaehle(database, spuren)).toEqual(zuvor);

        const gerade = await jpegMitMetadaten(93, { ausrichtung: 1 });
        const body = await eingereicht(93, { bild: gerade.upload });
        const eins = await zeile(body.schluessel);
        const [quelle] = await quellenDer(eins.id);
        expect((await sharp(quelle!.bytes).metadata()).orientation).toBeUndefined();

        await setzeZustand(body.schluessel, "pending");
        expect(fehler(await aktion("bild", body.schluessel, { bild: gedreht.upload }))).toBe("422 media_file_rejected");
        expect((await assetsDer(eins.id)).length).toBe(1);
    });

    it("Bild ersetzen: neues Asset samt Eingang, Zustand zurück auf incoming, das alte Asset rejected, ein neuer Abgleich; SVG ist 415", async () => {
        const body = await eingereicht(80);
        await setzeZustand(body.schluessel, "pending");
        const vorher = await zeile(body.schluessel);
        const [altesAsset] = await assetsDer(vorher.id);
        expect(altesAsset?.moderation).toBe("pending");

        expect(fehler(await aktion("bild", body.schluessel, { bild: svgUpload() }))).toBe("415 unsupported_media_type");
        expect((await assetsDer(vorher.id)).length).toBe(1);

        const antwort = await aktion("bild", body.schluessel, { bild: await pngUpload(81) });
        expect(fehler(antwort)).toBe("200");
        expect(antwort.json()).toMatchObject({ zustand: "incoming", vorschauBereit: false });
        const assets = await assetsDer(vorher.id);
        expect(assets.map((asset) => asset.moderation)).toEqual(["rejected", "pending"]);
        const nachher = await zeile(body.schluessel);
        expect(nachher.state).toBe("incoming");
        // Der Zustand hat gewechselt (pending → incoming): der Zeitpunkt wurde gesetzt.
        expect(nachher.alt).toBe(false);
        const [auftrag] = await database<{ actor_ref: string | null }[]>`
            SELECT actor_ref FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ${assets[1]!.public_id}`;
        expect(auftrag?.actor_ref).toBe("photobox");
        const [eingang] = await database<{ source_ref: string | null; filename: string | null }[]>`
            SELECT source_ref, original_filename AS filename FROM media_ingest WHERE media_asset_id = ${assets[1]!.id}::bigint`;
        expect(eingang?.filename).toBeNull();
        // Ein Bild noch einmal im Zustand incoming ersetzen: der Zustand bleibt, der Zeitpunkt auch.
        await database`UPDATE media_submission SET state_changed_at = now() - interval '5 days' WHERE id = ${vorher.id}::bigint`;
        expect(fehler(await aktion("bild", body.schluessel, { bild: await pngUpload(82) }))).toBe("200");
        expect((await zeile(body.schluessel)).alt).toBe(true);
        expect((await assetsDer(vorher.id)).map((asset) => asset.moderation)).toEqual([
            "rejected",
            "rejected",
            "pending",
        ]);
        // Nach der Freigabe geht es nicht mehr.
        await setzeZustand(body.schluessel, "approved");
        expect(fehler(await aktion("bild", body.schluessel, { bild: await pngUpload(83) }))).toBe(
            "409 photobox_transition",
        );
    });

    /** Setzt den technischen Zustand des aktuellen Bildes, wie der Abgleich (`media_settle`) es nach seiner Prüfung tut. */
    async function setzeTechnik(schluessel: string, technik: string): Promise<void> {
        const row = await zeile(schluessel);
        const assets = await assetsDer(row.id);
        await database`UPDATE media_asset SET technical_state = ${technik} WHERE id = ${assets.at(-1)!.id}::bigint`;
    }

    it("🔴 Nach der technischen Prüfung wechselt die Einreichung beim Lesen: ok wird pending, ein Fehler technical_failed, ungeprüft bleibt incoming (Stage-Fund)", async () => {
        const offen = await eingereicht(140);
        const gut = await eingereicht(141);
        const kaputt = await eingereicht(142);
        const unbekannt = await eingereicht(143);
        await setzeTechnik(gut.schluessel, "ok");
        await setzeTechnik(kaputt.schluessel, "decode_failed");
        await setzeTechnik(unbekannt.schluessel, "unsupported_format");

        // Ungeprüft (technical_state pending): bleibt eingegangen, die Zeile ändert sich nicht.
        const vorher = await zeile(offen.schluessel);
        expect((await status(offen.schluessel)).json()).toMatchObject({ zustand: "incoming" });
        expect(await zeile(offen.schluessel)).toEqual(vorher);

        const antwortGut = await status(gut.schluessel);
        expect(Value.Check(PhotoboxStatus, antwortGut.json())).toBe(true);
        expect(antwortGut.json()).toMatchObject({ zustand: "pending" });
        expect((await status(kaputt.schluessel)).json()).toMatchObject({ zustand: "technical_failed" });
        expect((await status(unbekannt.schluessel)).json()).toMatchObject({ zustand: "technical_failed" });

        // Der Wechsel ist geschrieben: Zustand in der Tafel, Zeitpunkt neu, Revision hochgezählt; ein zweites Lesen ändert nichts mehr.
        const gutVorher = await zeile(gut.schluessel);
        expect(gutVorher.state).toBe("pending");
        expect(gutVorher.alt).toBe(false);
        expect(gutVorher.revision).toBeGreaterThan(1);
        expect((await status(gut.schluessel)).json()).toMatchObject({ zustand: "pending" });
        expect((await zeile(gut.schluessel)).revision).toBe(gutVorher.revision);

        // Wird die Prüfung erst später fertig, wechselt die Einreichung dann.
        await setzeTechnik(offen.schluessel, "ok");
        expect((await status(offen.schluessel)).json()).toMatchObject({ zustand: "pending" });
    });

    it("🔴 Die Statusaktionen sehen den Zustand nach der technischen Prüfung: ein gelungenes Bild lässt sich beschreiben, ein misslungenes nicht mehr (keine Beschreibung)", async () => {
        const gut = await eingereicht(150);
        const kaputt = await eingereicht(151);
        await setzeTechnik(gut.schluessel, "ok");
        await setzeTechnik(kaputt.schluessel, "missing_file");

        // Keine Statusabfrage davor: die Aktion selbst zieht den Wechsel nach.
        const antwort = await aktion("beschreibung", gut.schluessel, { beschreibung: "Nach der Prüfung" });
        expect(fehler(antwort)).toBe("200");
        expect(antwort.json()).toMatchObject({ zustand: "pending", beschreibung: "Nach der Prüfung" });

        // Die abgewiesene Aktion rollt auch ihr Nachziehen zurück; die Statusabfrage danach zieht es nach.
        expect(fehler(await aktion("beschreibung", kaputt.schluessel, { beschreibung: "Zu spät" }))).toBe(
            "409 photobox_transition",
        );
        expect((await status(kaputt.schluessel)).json()).toMatchObject({ zustand: "technical_failed" });
        expect((await zeile(kaputt.schluessel)).state).toBe("technical_failed");

        // Ein ersetztes Bild beginnt von vorn: das neue Asset ist ungeprüft, der Zustand bleibt incoming, auch wenn das alte in Ordnung war.
        const dritte = await eingereicht(152);
        await setzeTechnik(dritte.schluessel, "ok");
        expect((await status(dritte.schluessel)).json()).toMatchObject({ zustand: "pending" });
        expect(fehler(await aktion("bild", dritte.schluessel, { bild: await pngUpload(153) }))).toBe("200");
        expect((await status(dritte.schluessel)).json()).toMatchObject({ zustand: "incoming" });
    });

    it("🔴 Technisch gescheitert (WI-0272 S3): Zurückziehen und ein anderes Bild gehen, Beschreibung, Lizenzwahl und Offline nicht", async () => {
        const zurueck = await eingereicht(154);
        const neu = await eingereicht(155);
        await setzeTechnik(zurueck.schluessel, "decode_failed");
        await setzeTechnik(neu.schluessel, "unsupported_format");

        for (const [name, felder] of [
            ["beschreibung", { beschreibung: "Noch ein Versuch" }],
            ["nutzung", { nutzung: "cc-by-4.0" }],
            ["offline", {}],
        ] as const) {
            expect(fehler(await aktion(name, zurueck.schluessel, felder)), name).toBe("409 photobox_transition");
        }
        // Zurückziehen: Das Bild ist abgelehnt (nie mehr bindbar), die Aufbewahrung löscht es 30 Tage danach.
        const antwort = await aktion("zurueckziehen", zurueck.schluessel);
        expect(fehler(antwort)).toBe("200");
        expect(antwort.json()).toMatchObject({ zustand: "withdrawn" });
        const assetsZurueck = await assetsDer((await zeile(zurueck.schluessel)).id);
        expect(assetsZurueck.map((asset) => asset.moderation)).toEqual(["rejected"]);

        // Ein anderes Bild: Die Einreichung beginnt von vorn, das alte Asset ist abgelehnt.
        const ersetzt = await aktion("bild", neu.schluessel, { bild: await pngUpload(156) });
        expect(fehler(ersetzt)).toBe("200");
        expect(ersetzt.json()).toMatchObject({ zustand: "incoming" });
        const assetsNeu = await assetsDer((await zeile(neu.schluessel)).id);
        expect(assetsNeu.map((asset) => asset.moderation)).toEqual(["rejected", "pending"]);
    });

    it("technikNachziehen ohne Angabe prüft alle eingegangenen, mit Angabe nur diese eine; andere Zustände bleiben unberührt", async () => {
        const eins = await eingereicht(160);
        const zwei = await eingereicht(161);
        const fertig = await eingereicht(162);
        for (const body of [eins, zwei, fertig]) await setzeTechnik(body.schluessel, "ok");
        await setzeZustand(fertig.schluessel, "approved");
        const zeileEins = await zeile(eins.schluessel);
        expect(await technikNachziehen(database, zeileEins.id)).toBe(1);
        expect((await zeile(eins.schluessel)).state).toBe("pending");
        expect((await zeile(zwei.schluessel)).state).toBe("incoming");
        expect(await technikNachziehen(database, zeileEins.id)).toBe(0);
        expect(await technikNachziehen(database)).toBeGreaterThanOrEqual(1);
        expect((await zeile(zwei.schluessel)).state).toBe("pending");
        expect((await zeile(fertig.schluessel)).state).toBe("approved");
    });

    it("🔴 Bild ersetzen höchstens fünfmal je Einreichung: die sechste Ersetzung ist 409 photobox_replace_limit und schreibt nichts", async () => {
        const body = await eingereicht(170);
        const vorher = await zeile(body.schluessel);
        for (let nummer = 1; nummer <= PHOTOBOX_GRENZEN.ersetzungenJeEinreichung; nummer += 1) {
            const antwort = await aktion("bild", body.schluessel, { bild: await pngUpload(170 + nummer) });
            expect(fehler(antwort), `Ersetzung ${String(nummer)}`).toBe("200");
        }
        // Die erste Zeile des Eingangs ist die Einreichung selbst: fünf Ersetzungen sind sechs Zeilen.
        expect((await assetsDer(vorher.id)).length).toBe(PHOTOBOX_GRENZEN.ersetzungenJeEinreichung + 1);
        const stand = await zeile(body.schluessel);

        const zuViele = await aktion("bild", body.schluessel, { bild: await pngUpload(179) });
        expect(fehler(zuViele)).toBe("409 photobox_replace_limit");
        expect((zuViele.json() as { error: { message: string } }).error.message).toBe(
            "Dieses Reisebild wurde schon zu oft ersetzt. Reiche es bitte neu ein.",
        );
        expect((await assetsDer(vorher.id)).length).toBe(PHOTOBOX_GRENZEN.ersetzungenJeEinreichung + 1);
        expect((await zeile(body.schluessel)).revision).toBe(stand.revision);
        // Der Deckel gilt nur für das Bild: die übrigen Aktionen gehen weiter.
        expect(fehler(await aktion("beschreibung", body.schluessel, { beschreibung: "Noch immer änderbar" }))).toBe(
            "200",
        );
        // Eine andere Einreichung zählt für sich.
        const andere = await eingereicht(178);
        expect(fehler(await aktion("bild", andere.schluessel, { bild: await pngUpload(177) }))).toBe("200");
    });

    it("🔴 Beschreibung ändern bei einer Rückfrage ist die Antwort darauf: der Zustand wird pending, state_changed_at neu", async () => {
        const body = await eingereicht(180, { beschreibung: "Vor der Rückfrage" });
        await setzeZustand(body.schluessel, "changes_requested");
        await database`UPDATE media_submission SET editor_message = 'Welcher Hafen ist das?' WHERE status_key_hash = ${schluesselHash(body.schluessel)}`;
        const vorher = await zeile(body.schluessel);
        expect(vorher).toMatchObject({ state: "changes_requested", alt: true });

        const antwort = await aktion("beschreibung", body.schluessel, { beschreibung: "Der Hafen von Havena" });
        expect(fehler(antwort)).toBe("200");
        expect(antwort.json()).toMatchObject({ zustand: "pending", beschreibung: "Der Hafen von Havena" });
        const nachher = await zeile(body.schluessel);
        expect(nachher).toMatchObject({
            state: "pending",
            description: "Der Hafen von Havena",
            pending_description: null,
        });
        // Der Zustand hat gewechselt: die Fristen des Verfalls zählen ab jetzt.
        expect(nachher.alt).toBe(false);
        expect(nachher.revision).toBeGreaterThan(vorher.revision);
        const [protokoll] = await database<{ details: Record<string, unknown>; revision: number }[]>`
            SELECT details, target_revision::int AS revision FROM media_audit_event
             WHERE action = 'photobox.description_set' ORDER BY id DESC LIMIT 1`;
        expect(protokoll).toEqual({
            details: { pending: false, previous: "changes_requested" },
            revision: nachher.revision,
        });

        // Eine weitere Beschreibung in pending bleibt in pending und lässt den Zeitpunkt stehen.
        await database`UPDATE media_submission SET state_changed_at = now() - interval '3 days' WHERE status_key_hash = ${schluesselHash(body.schluessel)}`;
        expect(fehler(await aktion("beschreibung", body.schluessel, { beschreibung: "Noch genauer" }))).toBe("200");
        expect(await zeile(body.schluessel)).toMatchObject({ state: "pending", alt: true });
    });

    it("🔴 Offline bei approved: offline, alle Assets rejected, die öffentliche Datei ist weg, ihre Zeile auch", async () => {
        const body = await eingereicht(90);
        await setzeZustand(body.schluessel, "approved");
        const row = await zeile(body.schluessel);
        const [asset] = await assetsDer(row.id);
        // Eine öffentliche Fassung (so, wie der Abgleich nach der Freigabe sie ablegt) samt Kopie in der Quarantäne.
        const fassung = await store.store("published", Buffer.from("veroeffentlichte-fassung-90"), "webp");
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                    derivative_recipe, recipe_version)
            VALUES (${asset!.id}::bigint, 'photobox_2048', 'published', ${fassung.key}, 'image/webp', 64, 48, ${fassung.byteSize},
                    ${fassung.sha256}, 'photobox_2048-recipe', '1')`;
        expect(await store.exists(fassung.key)).toBe(true);

        const antwort = await aktion("offline", body.schluessel);
        expect(fehler(antwort)).toBe("200");
        expect((antwort.json() as { zustand: string }).zustand).toBe("offline");
        const nachher = await zeile(body.schluessel);
        expect(nachher.state).toBe("offline");
        expect(nachher.alt).toBe(false);
        expect((await assetsDer(row.id)).map((a) => a.moderation)).toEqual(["rejected"]);
        expect(await store.exists(fassung.key)).toBe(false);
        const [rest] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_file WHERE media_asset_id = ${asset!.id}::bigint AND storage_class = 'published'`;
        expect(rest?.n).toBe(0);
        // Ein Auftrag räumt nach, falls etwas liegen blieb; er ist in derselben Transaktion eingereiht.
        const [auftrag] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' = ${asset!.public_id}`;
        expect(auftrag?.n).toBe(2);
        // Offline ist nicht rückgängig zu machen: nichts geht mehr.
        expect(fehler(await aktion("offline", body.schluessel))).toBe("409 photobox_transition");
        expect(fehler(await aktion("beschreibung", body.schluessel, { beschreibung: "Doch noch" }))).toBe(
            "409 photobox_transition",
        );
    });

    it("🔴 liegt die öffentliche Datei in der Quarantäne (Schalter aus), fällt auch ihre Kopie dort weg", async () => {
        const body = await eingereicht(92);
        await setzeZustand(body.schluessel, "approved");
        const row = await zeile(body.schluessel);
        const [asset] = await assetsDer(row.id);
        const fassung = await store.store("published", Buffer.from("quarantaene-fassung-92"), "webp");
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                    derivative_recipe, recipe_version)
            VALUES (${asset!.id}::bigint, 'photobox_2048', 'published', ${fassung.key}, 'image/webp', 64, 48, ${fassung.byteSize},
                    ${fassung.sha256}, 'photobox_2048-recipe', '1')`;
        expect(await store.moveToQuarantine(fassung.sha256)).toBe("moved");
        expect(await store.exists(quarantineKey(fassung.sha256))).toBe(true);
        expect(fehler(await aktion("offline", body.schluessel))).toBe("200");
        expect(await store.exists(quarantineKey(fassung.sha256))).toBe(false);
        expect(await store.exists(fassung.key)).toBe(false);
    });

    it("🔴 eine Datei, die ein anderes Werk mitträgt, bleibt beim Offline-Nehmen liegen (bytegleiche Werke teilen sich ihre Datei)", async () => {
        const body = await eingereicht(91);
        await setzeZustand(body.schluessel, "approved");
        const row = await zeile(body.schluessel);
        const [asset] = await assetsDer(row.id);
        const fassung = await store.store("published", Buffer.from("geteilte-fassung-91"), "webp");
        const fremd = await database<{ id: string }[]>`
            INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system)
            VALUES ('image', 'picture', 'editor_upload', 'photo', 'ok', 'not_applicable', 'photobox-test') RETURNING id::text AS id`;
        try {
            for (const id of [asset!.id, fremd[0]!.id]) {
                await database`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                            derivative_recipe, recipe_version)
                    VALUES (${id}::bigint, 'photobox_2048', 'published', ${fassung.key}, 'image/webp', 64, 48, ${fassung.byteSize},
                            ${fassung.sha256}, 'photobox_2048-recipe', '1')`;
            }
            expect(fehler(await aktion("offline", body.schluessel))).toBe("200");
            // Die Zeile dieses Werks ist weg, die Datei bleibt für das andere.
            expect(await store.exists(fassung.key)).toBe(true);
            const [rest] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_file WHERE media_asset_id = ${asset!.id}::bigint AND storage_class = 'published'`;
            expect(rest?.n).toBe(0);
        } finally {
            await database`DELETE FROM media_file WHERE media_asset_id = ${fremd[0]!.id}::bigint`;
            await database`DELETE FROM media_asset WHERE id = ${fremd[0]!.id}::bigint`;
        }
    });

    it("Nutzung: vor der Freigabe beliebig (die Rechte folgen), nach der Freigabe nur noch zu CC BY, nie zurück zu avesmaps_only", async () => {
        const body = await eingereicht(100);
        const rechte = async (): Promise<{ basis: string; key: string | null }> => {
            const [row] = await database<{ basis: string; key: string | null }[]>`
                SELECT r.rights_basis AS basis, r.license_key AS key
                  FROM media_submission s JOIN media_ingest i ON i.submission_id = s.id JOIN media_rights r ON r.media_asset_id = i.media_asset_id
                 WHERE s.status_key_hash = ${schluesselHash(body.schluessel)}`;
            return row!;
        };
        expect(await rechte()).toEqual({ basis: "permission", key: null });
        const zuCc = await aktion("nutzung", body.schluessel, { nutzung: "cc-by-4.0" });
        expect(fehler(zuCc)).toBe("200");
        expect(zuCc.json()).toMatchObject({ nutzung: "cc-by-4.0" });
        expect(await rechte()).toEqual({ basis: "license", key: "cc-by-4.0" });
        expect(fehler(await aktion("nutzung", body.schluessel, { nutzung: "avesmaps_only" }))).toBe("200");
        expect(await rechte()).toEqual({ basis: "permission", key: null });

        await setzeZustand(body.schluessel, "approved");
        // Nach der Freigabe: zurück zu avesmaps_only ist 409 (wer das will, nimmt das Bild offline) und ändert nichts.
        expect(fehler(await aktion("nutzung", body.schluessel, { nutzung: "avesmaps_only" }))).toBe(
            "409 photobox_transition",
        );
        expect((await zeile(body.schluessel)).usage_grant).toBe("avesmaps_only");
        expect(await rechte()).toEqual({ basis: "permission", key: null });
        // Zu CC BY geht noch; danach nicht mehr zurück.
        expect(fehler(await aktion("nutzung", body.schluessel, { nutzung: "cc-by-4.0" }))).toBe("200");
        expect(await rechte()).toEqual({ basis: "license", key: "cc-by-4.0" });
        expect(fehler(await aktion("nutzung", body.schluessel, { nutzung: "avesmaps_only" }))).toBe(
            "409 photobox_transition",
        );
        const ziel: PhotoboxUsageGrant = (await zeile(body.schluessel)).usage_grant as PhotoboxUsageGrant;
        expect(ziel).toBe("cc-by-4.0");
    });

    it("🔴 eine Avesmaps-Aufnahme lässt sich nicht auf CC BY stellen (422), und die Einreichung unter CC BY ist schon 422", async () => {
        const unter = await einreichung(spuren, 110, { entstehung: "avesmaps_capture", nutzung: "cc-by-4.0" });
        expect(fehler(await senden(`${PHOTOBOX_URL}/einreichungen`, unter))).toBe("422 photobox_invalid");
        const body = await eingereicht(111, { entstehung: "avesmaps_capture" });
        const wechsel = await aktion("nutzung", body.schluessel, { nutzung: "cc-by-4.0" });
        expect(fehler(wechsel)).toBe("422 photobox_invalid");
        // WI-0291: der Fachcode steht in `details.reason`, auch auf der Statusseite.
        expect((wechsel.json() as { error: { details?: unknown } }).error.details).toEqual({
            reason: "cc_by_avesmaps",
        });
        expect((await zeile(body.schluessel)).usage_grant).toBe("avesmaps_only");
    });

    it("Vorschau: 404 photobox_preview_missing, solange der Worker sie nicht rechnete; danach das WebP des Einreichers, sonst nichts", async () => {
        const body = await eingereicht(120);
        const fehlt = await senden(`${PHOTOBOX_URL}/status/vorschau`, { schluessel: body.schluessel });
        expect(fehler(fehlt)).toBe("404 photobox_preview_missing");

        const row = await zeile(body.schluessel);
        const [asset] = await assetsDer(row.id);
        const bytes = Buffer.from("RIFFxxxxWEBPvorschau-120");
        const datei = await store.store("derivative", bytes, "webp");
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256,
                                    derivative_recipe, recipe_version)
            VALUES (${asset!.id}::bigint, 'intern_photobox_2048', 'derivative', ${datei.key}, 'image/webp', 64, 48, ${datei.byteSize},
                    ${datei.sha256}, 'photobox_2048-recipe', '1')`;
        expect(((await status(body.schluessel)).json() as { vorschauBereit: boolean }).vorschauBereit).toBe(true);
        const antwort = await senden(`${PHOTOBOX_URL}/status/vorschau`, { schluessel: body.schluessel });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["content-type"]).toBe("image/webp");
        expect(antwort.headers["cache-control"]).toBe("no-store");
        expect(antwort.rawPayload.equals(bytes)).toBe(true);
        // Die Datei steht im Speicher, aber nicht mehr dort: 404 statt 500.
        await store.removeAfterDelete(datei.key);
        expect(fehler(await senden(`${PHOTOBOX_URL}/status/vorschau`, { schluessel: body.schluessel }))).toBe(
            "404 photobox_preview_missing",
        );
    });

    it("🔴 jede Aktion höchstens einmal je Kennung (M10): dieselbe Kennung noch einmal liefert die Quittung, nichts wird doppelt getan", async () => {
        const body = await eingereicht(130);
        const operationId = neueOperation(spuren);
        const felder = { schluessel: body.schluessel, operationId, beschreibung: "Einmal ist genug" };
        const erste = await senden(`${PHOTOBOX_URL}/status/beschreibung`, felder);
        expect(fehler(erste)).toBe("200");
        const revision = (await zeile(body.schluessel)).revision;
        const zweite = await senden(`${PHOTOBOX_URL}/status/beschreibung`, felder);
        expect(fehler(zweite)).toBe("200");
        expect((await zeile(body.schluessel)).revision).toBe(revision);
        // Dieselbe Kennung mit anderem Inhalt ist keine Wiederholung.
        expect(
            fehler(await senden(`${PHOTOBOX_URL}/status/beschreibung`, { ...felder, beschreibung: "Etwas anderes" })),
        ).toBe("409 idempotency_key_reused");
        // Das Zurückziehen mit einer Kennung und die Wiederholung NACH dem Zustandswechsel: weiter die Quittung, kein 409.
        const abziehen = { schluessel: body.schluessel, operationId: neueOperation(spuren) };
        expect(fehler(await senden(`${PHOTOBOX_URL}/status/zurueckziehen`, abziehen))).toBe("200");
        expect(fehler(await senden(`${PHOTOBOX_URL}/status/zurueckziehen`, abziehen))).toBe("200");
        const operationen = await database<
            { actor_kind: string; actor_label: string | null; actor_person_id: string | null; action: string }[]
        >`
            SELECT actor_kind, actor_label, actor_person_id::text, action FROM media_operation
             WHERE operation_id IN (${operationId}::uuid, ${abziehen.operationId}::uuid) ORDER BY at`;
        expect(operationen).toEqual([
            { actor_kind: "anonymous", actor_label: "photobox", actor_person_id: null, action: "photobox.describe" },
            { actor_kind: "anonymous", actor_label: "photobox", actor_person_id: null, action: "photobox.withdraw" },
        ]);
        const protokoll = await database<{ action: string; details: Record<string, unknown> }[]>`
            SELECT action, details FROM media_audit_event WHERE operation_id IN (${operationId}::uuid, ${abziehen.operationId}::uuid) ORDER BY id`;
        expect(protokoll).toEqual([
            { action: "photobox.description_set", details: { pending: false } },
            { action: "photobox.withdrawn", details: { previous: "incoming" } },
        ]);
        // Dieselbe Kennung gehört zu einem Schlüssel: mit einem fremden Schlüssel ist sie keine Wiederholung.
        const fremd = await eingereicht(131);
        expect(
            fehler(await senden(`${PHOTOBOX_URL}/status/zurueckziehen`, { ...abziehen, schluessel: fremd.schluessel })),
        ).toBe("409 idempotency_key_reused");
    });

    it("ohne Datenbank: stand sagt einreichen falsch, das Einreichen ist 503 photobox_unavailable", async () => {
        const ohne = buildApp({ config: config(undefined), logStream: { write: () => undefined } });
        try {
            await ohne.ready();
            const stand = await ohne.inject({ method: "GET", url: `${PHOTOBOX_URL}/stand` });
            expect(stand.json()).toEqual({ einreichen: false });
            const body = await einreichung(spuren, 150);
            const antwort = await ohne.inject({
                method: "POST",
                url: `${PHOTOBOX_URL}/einreichungen`,
                payload: body,
                remoteAddress: neueAdresse(),
                headers: { origin: TEST_ORIGIN },
            });
            expect(fehler(antwort)).toBe("503 photobox_unavailable");
        } finally {
            await ohne.close();
        }
    });

    it("🔴 der Schlüssel taucht in keiner Logzeile auf (Logger-Attrappe), und keine Antwort der Aktionen nennt ihn", async () => {
        // Jeder Weg, der etwas protokolliert: Einreichen, Falle, Lesen, Aktionen, Fehler (404, 409, 413, 415, 422, 429).
        const body = await eingereicht(160);
        const falle = await einreichung(spuren, 161, { falle: { feld: "bot", dauerMs: 10 } });
        await senden(`${PHOTOBOX_URL}/einreichungen`, falle);
        const antworten = [
            await status(body.schluessel),
            await aktion("beschreibung", body.schluessel, { beschreibung: "Mit Protokoll" }),
            await aktion("bild", body.schluessel, { bild: svgUpload() }),
            await aktion("nutzung", body.schluessel, { nutzung: "cc-by-4.0" }),
            await aktion("offline", body.schluessel),
            await senden(`${PHOTOBOX_URL}/status/vorschau`, { schluessel: body.schluessel }),
            await aktion("zurueckziehen", body.schluessel),
            await aktion("beschreibung", body.schluessel, { beschreibung: "Zu spät" }),
        ];
        for (const antwort of antworten) expect(antwort.body).not.toContain(body.schluessel);
        const alles = logzeilen.join("\n");
        expect(logzeilen.length).toBeGreaterThan(10);
        expect(alles).toContain("Falle verworfen");
        for (const schluessel of spuren.schluessel) {
            expect(alles).not.toContain(schluessel);
            // Auch der Hash steht in keiner Zeile.
            expect(alles).not.toContain(schluesselHash(schluessel).toString("hex"));
            expect(alles).not.toContain(schluesselHash(schluessel).toString("base64url"));
        }
    });
});
