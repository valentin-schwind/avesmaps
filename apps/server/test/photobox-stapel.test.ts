import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    BENACHRICHTIGUNG_URL,
    type BenachrichtigungListe,
    MEDIA_EDITOR_NAVIGATION_URL,
    MEDIA_EDITOR_PREVIEW_URL_PATTERN,
    MEDIA_PHOTOBOX_STAPEL_URL,
    MamNavigation,
    PHOTOBOX_STAPEL_MAX,
    PhotoboxStapel,
    type PhotoboxSubmissionState,
    type Role,
    VorgangDetail,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { MediaStore } from "../src/media/storage.ts";
import { technikNachziehen } from "../src/photobox/db.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { reisebildVorschauen } from "../src/media-editor/search.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { einreichung, neueSpuren, raeumeAuf } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Der Stapel neuer Reisebilder (WI-0272 S3, Aufgabe 19; `GET /api/editor/media/photobox/stapel`, Klarstellung 7) gegen echtes PostgreSQL und einen echten Medienspeicher:
 * die Zahl der offenen Einreichungen und die Vorschauen der neuesten.
 *
 * - Recht `view_media_private` (ab Reviewer): ohne Anmeldung 401, ohne Recht 403, vor jeder Prüfung.
 * - 🔴 `offen` zählt wie die Unterteilung „offen“ des Korbs „PhotoBox-Uploads“ (eingegangen, geprüft, und freigegeben mit wartender Beschreibung; ein technisch gescheitertes Bild ist erledigt):
 *   dieselbe Zahl wie `MamNavigation.einreichungen.offen`, nicht eine zweite Fassung der Regel.
 * - Höchstens fünf Vorschauen, neueste zuerst, nur INTERNE Vorschauen über den vorhandenen Weg der Medienverwaltung (`…/:id/preview/intern_…`); eine Einreichung
 *   ohne gerechnete Vorschau zählt mit, steht aber nicht im Stapel.
 */

const ROLLEN_MIT_MAM: readonly Role[] = ["reviewer", "editor", "admin", "operator"];

describeWithDatabase("Stapel neuer Reisebilder (WI-0272 S3, Aufgabe 19)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: AuthFixture;
    let mediaRoot = "";
    let store: MediaStore;
    const spuren = neueSpuren();
    const cookies = new Map<Role, string>();
    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "photobox-stapel-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-stapel-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        for (const role of ["tester", ...ROLLEN_MIT_MAM] as const) {
            const person = await fixture.person(role, { name: `Stapel ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
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
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    const get = (url: string, role?: Role) =>
        app.inject({ method: "GET", url, headers: role === undefined ? {} : { cookie: cookies.get(role) ?? "" } });
    const stapel = async (role: Role = "reviewer"): Promise<PhotoboxStapel> => {
        const antwort = await get(MEDIA_PHOTOBOX_STAPEL_URL, role);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const body = antwort.json() as PhotoboxStapel;
        expect(Value.Check(PhotoboxStapel, body), JSON.stringify([...Value.Errors(PhotoboxStapel, body)])).toBe(true);
        return body;
    };
    const offenImKorb = async (): Promise<number> => {
        const antwort = await get(MEDIA_EDITOR_NAVIGATION_URL, "reviewer");
        expect(antwort.statusCode, antwort.body).toBe(200);
        const navigation = antwort.json() as MamNavigation;
        return navigation.einreichungen?.offen ?? 0;
    };

    interface Fall {
        publicId: string;
        id: string;
        assetPublicId: string;
        eingereichtAm: Date;
    }
    let seed = 8000;
    /** Reicht ein Bild ein, lässt den Abgleich laufen (technisch geprüft, interne Vorschau) und zieht den Übergang nach: Zustand `pending`. */
    async function geprueft(): Promise<Fall> {
        const fall = await eingereicht();
        await settleAssetFiles(database, store, { assetPublicId: fall.assetPublicId, role: "photobox" });
        expect(await technikNachziehen(database, fall.id)).toBe(1);
        return fall;
    }
    /** Nur eingereicht: das Bild ist noch nicht geprüft, es gibt keine Vorschau (`incoming`). */
    async function eingereicht(): Promise<Fall> {
        seed += 1;
        const { publicId } = await einreichen(database, store, "test", await einreichung(spuren, seed));
        const [row] = await database<{ id: string; asset: string; at: Date }[]>`
            SELECT s.id::text AS id, a.public_id::text AS asset, s.submitted_at AS at
              FROM media_submission s
              JOIN media_ingest i ON i.submission_id = s.id
              JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${publicId}::uuid`;
        return { publicId, id: row!.id, assetPublicId: row!.asset, eingereichtAm: row!.at };
    }
    async function setzeZustand(fall: Fall, state: PhotoboxSubmissionState, wartend = false): Promise<void> {
        const asset = state === "approved" || state === "offline";
        const [datei] = await database<{ id: string }[]>`
            SELECT a.id::text AS id FROM media_asset a WHERE a.public_id = ${fall.assetPublicId}::uuid`;
        await database`UPDATE media_submission
                          SET state = ${state},
                              approved_media_asset_id = ${asset ? datei!.id : null}::bigint,
                              pending_description = ${wartend ? "Neu gefasst" : null}
                        WHERE id = ${fall.id}::bigint`;
    }

    it("🔴 ohne Anmeldung 401, ohne das Recht 403; ab Reviewer 200 im Vertrag, `no-store`", async () => {
        expect((await get(MEDIA_PHOTOBOX_STAPEL_URL)).statusCode).toBe(401);
        expect((await get(MEDIA_PHOTOBOX_STAPEL_URL, "tester")).statusCode).toBe(403);
        for (const rolle of ROLLEN_MIT_MAM) {
            const antwort = await get(MEDIA_PHOTOBOX_STAPEL_URL, rolle);
            expect(antwort.statusCode, rolle).toBe(200);
            expect(antwort.headers["cache-control"], rolle).toContain("no-store");
            expect(Value.Check(PhotoboxStapel, antwort.json()), rolle).toBe(true);
        }
    });

    it("🔴 offen zählt wie der Korb: eingegangen, geprüft und freigegeben mit wartender Beschreibung; Rückfrage, freigegeben und abgelehnt nicht", async () => {
        const vorher = await stapel();
        const korbVorher = await offenImKorb();
        expect(vorher.offen).toBe(korbVorher);

        await eingereicht();
        await geprueft();
        const rueckfrage = await geprueft();
        await setzeZustand(rueckfrage, "changes_requested");
        const freigegeben = await geprueft();
        await setzeZustand(freigegeben, "approved");
        const wartend = await geprueft();
        await setzeZustand(wartend, "approved", true);
        const abgelehnt = await geprueft();
        await setzeZustand(abgelehnt, "rejected");

        const nachher = await stapel();
        // Offen: eingegangen, geprüft, freigegeben mit wartender Beschreibung.
        expect(nachher.offen - vorher.offen).toBe(3);
        expect(nachher.offen).toBe(await offenImKorb());
        // Alle Rollen sehen dieselbe Zahl.
        for (const rolle of ROLLEN_MIT_MAM) expect((await stapel(rolle)).offen, rolle).toBe(nachher.offen);
    });

    it("🔴 höchstens fünf Vorschauen, neueste zuerst; eine Einreichung ohne Vorschau zählt mit, steht aber nicht im Stapel", async () => {
        const mit: Fall[] = [];
        for (let i = 0; i < 6; i++) mit.push(await geprueft());
        const ohne = await eingereicht();
        const vorschau = (await stapel()).vorschau;
        expect(vorschau).toHaveLength(PHOTOBOX_STAPEL_MAX);
        // Die fünf jüngsten mit Vorschau: die sechs eben geprüften sind die jüngsten Einreichungen (die ohne Vorschau ist noch jünger, hat aber keine).
        const erwartet = [...mit]
            .reverse()
            .slice(0, PHOTOBOX_STAPEL_MAX)
            .map((fall) => fall.assetPublicId);
        expect(vorschau.map((eintrag) => eintrag.publicId)).toEqual(erwartet);
        expect(vorschau.map((eintrag) => eintrag.publicId)).not.toContain(ohne.assetPublicId);
        expect(ohne.eingereichtAm.getTime()).toBeGreaterThanOrEqual(mit[5]!.eingereichtAm.getTime());
        // Jede Adresse ist der vorhandene Weg der Medienverwaltung zur internen Vorschau.
        const muster = new RegExp(MEDIA_EDITOR_PREVIEW_URL_PATTERN, "u");
        for (const eintrag of vorschau) {
            expect(eintrag.url).toMatch(muster);
            expect(eintrag.url).toContain(`/api/editor/media/${eintrag.publicId}/preview/intern_`);
        }
    });

    it("🔴 eine Meldung aus der Bildansicht: Vorgang und Glocke kennen das Bild; eine fremde Kennung führt zu nichts", async () => {
        const fall = await geprueft();
        const melde = async (reisebildId: string): Promise<string> => {
            const antwort = await app.inject({
                method: "POST",
                url: "/api/community/meldungen",
                remoteAddress: `10.77.${String(seed % 200)}.${String(1 + (seed++ % 200))}`,
                headers: { origin: TEST_ORIGIN },
                payload: {
                    operationId: randomUUID(),
                    schluessel: randomBytes(32).toString("base64url"),
                    kategorie: "sonstiges",
                    text: "Dieses Reisebild zeigt etwas anderes.",
                    bezug: { art: "stelle", lage: { x: 500, y: 400 }, reisebildId },
                    falle: { feld: "", dauerMs: 8000 },
                },
            });
            expect(antwort.statusCode, antwort.body).toBe(201);
            return (antwort.json() as { nummer: string }).nummer;
        };
        const nummer = await melde(fall.assetPublicId);
        const fremd = randomUUID();
        const fremdeNummer = await melde(fremd);
        try {
            const vorgang = await get(`/api/community/vorgaenge/${nummer}`, "reviewer");
            expect(vorgang.statusCode, vorgang.body).toBe(200);
            const detail = vorgang.json() as VorgangDetail;
            expect(Value.Check(VorgangDetail, detail), JSON.stringify([...Value.Errors(VorgangDetail, detail)])).toBe(
                true,
            );
            expect(detail.bezug?.reisebildId).toBe(fall.assetPublicId);
            expect(detail.bezug?.reisebild?.publicId).toBe(fall.assetPublicId);
            expect(detail.bezug?.reisebild?.url).toContain(`/api/editor/media/${fall.assetPublicId}/preview/intern_`);

            const unbekannt = (
                await get(`/api/community/vorgaenge/${fremdeNummer}`, "reviewer")
            ).json() as VorgangDetail;
            expect(unbekannt.bezug?.reisebildId).toBe(fremd);
            expect(unbekannt.bezug?.reisebild).toBeUndefined();
            expect(await reisebildVorschauen(database, [fremd])).toEqual(new Map());

            // Die erste neue Meldung trägt ihre Nummer und das Bild; die zweite ließ dieselbe Zeile zur Zahl wachsen, die nennt kein Bild mehr.
            const glocke = (await get(BENACHRICHTIGUNG_URL, "reviewer")).json() as BenachrichtigungListe;
            const zeile = glocke.eintraege.find((eintrag) => eintrag.art === "community_neu");
            expect(zeile?.text).toBe("2");
            expect(zeile?.bilder).toBeUndefined();
            await database`
                UPDATE public.benachrichtigung SET text = ${nummer}
                 WHERE id = ${zeile!.id}::bigint
            `;
            const einzeln = (await get(BENACHRICHTIGUNG_URL, "reviewer")).json() as BenachrichtigungListe;
            expect(einzeln.eintraege.find((eintrag) => eintrag.id === zeile!.id)?.bilder).toEqual([
                detail.bezug?.reisebild,
            ]);
        } finally {
            await database`
                DELETE FROM avesmaps_community.vorgang
                 WHERE id = ANY(${[nummer, fremdeNummer].map((com) => Number(com.slice(4)))}::bigint[])
            `;
        }
    });

    it("🔴 die Vorschau lässt sich über genau diese Adresse holen (privat, WebP) und nur mit dem Recht", async () => {
        const fall = await geprueft();
        const eintrag = (await stapel()).vorschau.find((vorschau) => vorschau.publicId === fall.assetPublicId);
        expect(eintrag).toBeDefined();
        const mitRecht = await get(eintrag!.url, "reviewer");
        expect(mitRecht.statusCode).toBe(200);
        expect(mitRecht.headers["content-type"]).toBe("image/webp");
        expect(mitRecht.headers["cache-control"]).toContain("no-store");
        expect((await get(eintrag!.url)).statusCode).toBe(401);
        expect((await get(eintrag!.url, "tester")).statusCode).toBe(403);
    });

    it("🔴 nichts als Kennung und Adresse: keine Beschreibung, kein Name, kein Ort, kein Schlüssel", async () => {
        seed += 1;
        const body = await einreichung(spuren, seed, {
            name: "Alrike Sonnenschein",
            beschreibung: "Die Türme von Wehrheim",
        });
        await einreichen(database, store, "test", body);
        const roh = (await get(MEDIA_PHOTOBOX_STAPEL_URL, "reviewer")).body;
        for (const fremd of ["Alrike", "Sonnenschein", "Türme", "Wehrheim", body.schluessel]) {
            expect(roh).not.toContain(fremd);
        }
        const schluessel = Object.keys(JSON.parse(roh) as object).sort();
        expect(schluessel).toEqual(["offen", "vorschau"]);
    });
});
