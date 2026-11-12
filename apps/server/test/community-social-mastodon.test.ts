import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AVENTURIA,
    SocialDetail,
    SocialKanaele,
    SocialKanalStand,
    SocialQuittung,
    type Role,
    type SocialKanaele as Kanaele,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import {
    leseMastodonZugang,
    mastodonEingerichtet,
    SOCIAL_SENDEN_KIND,
} from "../src/community/social/kanaele/konfiguration.ts";
import {
    MastodonFehler,
    grenzenAus,
    ladeBildHoch,
    leseGrenzen,
    nimmZurueck,
    sende,
} from "../src/community/social/kanaele/mastodon.ts";
import { liesUndSpeichereGrenzen } from "../src/community/social/kanaele/stand.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { LEICHTE_ARTEN, istSchwer } from "../src/jobs/dirigent/plan.ts";
import { JOB_HANDLERS, type JobContext } from "../src/jobs/handlers.ts";
import { JOB_KIND_CATALOG, knowsKind } from "../src/jobs/kinds.ts";
import { SENDEN_ABSTAENDE_MS, leseSendenAuftrag, runSocialSendenJob } from "../src/jobs/social-senden-job.ts";
import { sha256Of } from "../src/media/storage.ts";
import { stelleInstanz, type GestellteInstanz, type StellOptionen } from "./support/mastodon-instanz.ts";
import { pngBytes } from "./support/media-operations-fixture.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Der Kanal Mastodon des Social Hubs (WI-0268 C12a, Migration 0285) gegen echtes PostgreSQL, mit gestellter Instanz: es geht NIE ein echter Aufruf an eine Mastodon-Instanz hinaus.
 *
 * - Konfiguration: Adresse (nur https) und Zugangsschlüssel aus der Umgebung; fehlt eins, gibt es den Kanal nicht. Der Schlüssel taucht nirgends auf.
 * - Grenzen lesen und übernehmen (auch eine geänderte Instanzgrenze); die Zählung nimmt sie statt fester Zahlen.
 * - Freigeben merkt die Sendung vor und reiht den Auftrag ein; der Auftrag sendet mit Kennung gegen Doppeltes (zweimal → einmal), mit Bild und Beschreibung, wiederholt bei vorübergehenden Fehlern, nimmt zurück.
 * - Ohne Freischaltung (Zählregel nicht gegen ein Testkonto geprüft) und bei Notschalter wird nicht gesendet. Rechte: `manage_social_channels` Stufe S.
 * - Ein Ausfall des Kanals ändert den Beitrag in den Neuigkeiten nicht.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;
const URL_INSTANZ = "https://mastodon.beispiel.test";
const SCHLUESSEL = "tok-geheim-1234567890-abcdef";
const ENV = { COMMUNITY_SOCIAL_MASTODON_URL: URL_INSTANZ, COMMUNITY_SOCIAL_MASTODON_TOKEN: SCHLUESSEL };

// --- Konfiguration (ohne Datenbank) ----------------------------------------------------------------------------------------------

describe("Mastodon: Konfiguration", () => {
    it("🔴 ohne beide Angaben gibt es den Kanal nicht; eine allein genügt nicht", () => {
        expect(leseMastodonZugang({})).toBeUndefined();
        expect(leseMastodonZugang({ COMMUNITY_SOCIAL_MASTODON_URL: URL_INSTANZ })).toBeUndefined();
        expect(leseMastodonZugang({ COMMUNITY_SOCIAL_MASTODON_TOKEN: SCHLUESSEL })).toBeUndefined();
        expect(mastodonEingerichtet({})).toBe(false);
        expect(mastodonEingerichtet(ENV)).toBe(true);
    });

    it.each([
        ["http statt https", "http://mastodon.beispiel.test"],
        ["mit Pfad", "https://mastodon.beispiel.test/api"],
        ["mit Anmeldung", "https://nutzer:geheim@mastodon.beispiel.test"],
        ["mit Anfrage", "https://mastodon.beispiel.test/?x=1"],
        ["mit Fragment", "https://mastodon.beispiel.test/#x"],
        ["kein Adresse", "mastodon.beispiel.test"],
        ["mit Zeilenumbruch", "https://mastodon.beispiel.test\r\nX: 1"],
        ["leer", " "],
    ])("🔴 eine Adresse der Instanz %s ist unbrauchbar", (_name, adresse) => {
        expect(leseMastodonZugang({ ...ENV, COMMUNITY_SOCIAL_MASTODON_URL: adresse })).toBeUndefined();
    });

    it.each([
        ["mit Leerzeichen", "tok geheim 1234567890"],
        ["mit Zeilenumbruch", "tok-geheim-1234567890\nX-Evil: 1"],
        ["zu kurz", "kurz"],
    ])("🔴 ein Zugangsschlüssel %s ist unbrauchbar", (_name, schluessel) => {
        expect(leseMastodonZugang({ ...ENV, COMMUNITY_SOCIAL_MASTODON_TOKEN: schluessel })).toBeUndefined();
    });

    it("🔴 der Schlüssel steht in keiner Ausgabe: weder JSON noch Spread noch inspect noch ein Fehlertext", () => {
        const zugang = leseMastodonZugang(ENV)!;
        expect(JSON.stringify(zugang)).not.toContain(SCHLUESSEL);
        expect(JSON.stringify({ ...zugang })).not.toContain(SCHLUESSEL);
        expect(inspect(zugang, { depth: 5, showHidden: true })).not.toContain(SCHLUESSEL);
        expect(inspect(zugang)).not.toContain("beispiel.test");
        expect(zugang.anmeldeKopf()).toEqual({ Authorization: `Bearer ${SCHLUESSEL}` });
        expect(zugang.entschaerfe(`Fehler mit ${SCHLUESSEL} bei mastodon.beispiel.test`)).toBe("Fehler mit … bei …");
    });

    it("🔴 aus dem Pfad kommt nie eine Adresse außerhalb der Schnittstelle", () => {
        const zugang = leseMastodonZugang(ENV)!;
        expect(zugang.adresse("/api/v1/statuses")).toBe(`${URL_INSTANZ}/api/v1/statuses`);
        for (const pfad of [
            "/etc/passwd",
            "/api//x",
            "/api/../x",
            "/api/v1/https://boese.test",
            "/api/v1/\n",
            "api/v1/x",
        ])
            expect(() => zugang.adresse(pfad), pfad).toThrow();
    });
});

// --- Anbindung (ohne Datenbank) --------------------------------------------------------------------------------------------------

describe("Mastodon: Anbindung gegen die gestellte Instanz", () => {
    const zugang = leseMastodonZugang(ENV)!;

    it("liest die Grenzen: Zeichen, Länge einer Adresse, Bilder, Beschreibung, Größe, Formate (nur Bilder)", async () => {
        const instanz = stelleInstanz({ max: 800, adresse: 25 });
        const grenzen = await leseGrenzen(zugang, { fetch: instanz.fetch });
        expect(grenzen).toEqual({
            zeichen: 800,
            adresse: 25,
            bilder: 4,
            beschreibung: 1500,
            bildBytes: 16_777_216,
            bildTypen: ["image/jpeg", "image/png", "image/webp"],
        });
        expect(instanz.aufrufe).toHaveLength(1);
        // Die Grenzen sind öffentlich: kein Schlüssel nötig, keiner geschickt.
        expect(instanz.aufrufe[0]!.kopf.get("Authorization")).toBeNull();
        expect(instanz.aufrufe[0]!.redirect).toBe("manual");
    });

    it("🔴 nennt die Instanz Zeichengrenze oder Länge einer Adresse nicht, ist das ein Fehler und keine Vorgabe", async () => {
        for (const antwort of [{}, { configuration: {} }, { configuration: { statuses: { max_characters: 500 } } }]) {
            const instanz = stelleInstanz({ instanz: antwort });
            await expect(leseGrenzen(zugang, { fetch: instanz.fetch })).rejects.toBeInstanceOf(MastodonFehler);
        }
        expect(() => grenzenAus(null)).toThrow(MastodonFehler);
    });

    it("sendet öffentlich mit Idempotency-Key, Anmeldung und ohne Weiterleitung; dieselbe Kennung zweimal ergibt EINEN Beitrag", async () => {
        const instanz = stelleInstanz();
        const kennung = randomUUID();
        const a = await sende(zugang, { text: "Hallo Aventurien", idempotenz: kennung }, { fetch: instanz.fetch });
        const b = await sende(zugang, { text: "Hallo Aventurien", idempotenz: kennung }, { fetch: instanz.fetch });
        expect(a).toEqual(b);
        expect(a.url).toMatch(/^https:\/\/mastodon\.beispiel\.test\/@konto\/\d+$/u);
        expect(instanz.angelegt()).toBe(1);
        const aufruf = instanz.aufrufe[0]!;
        expect(aufruf.kopf.get("Idempotency-Key")).toBe(kennung);
        expect(aufruf.kopf.get("Authorization")).toBe(`Bearer ${SCHLUESSEL}`);
        expect(aufruf.redirect).toBe("manual");
        expect(JSON.parse(String(aufruf.body))).toEqual({ status: "Hallo Aventurien", visibility: "public" });
    });

    it("🔴 Fehler sind feste Sätze ohne Schlüssel und ohne Adresse der Instanz; dauerhaft oder vorübergehend nach dem Code", async () => {
        const mit = async (fehler: StellOptionen["fehler"]): Promise<MastodonFehler> => {
            const instanz = stelleInstanz({ fehler });
            try {
                await sende(zugang, { text: "x", idempotenz: randomUUID() }, { fetch: instanz.fetch });
            } catch (e) {
                return e as MastodonFehler;
            }
            throw new Error("kein Fehler");
        };
        const antwort = (status: number, body: unknown = {}) =>
            new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        const faelle: [string, StellOptionen["fehler"], boolean][] = [
            ["401", () => antwort(401, { error: `bad ${SCHLUESSEL}` }), true],
            ["403", () => antwort(403), true],
            [
                "422",
                () =>
                    antwort(422, {
                        error: `Text character limit of 500 exceeded for ${SCHLUESSEL} on mastodon.beispiel.test`,
                    }),
                true,
            ],
            ["429", () => antwort(429), false],
            ["503", () => antwort(503), false],
            ["302", () => antwort(302), true],
            ["404", () => antwort(404), true],
            ["netz", () => "netz", false],
        ];
        for (const [name, fehler, dauerhaft] of faelle) {
            const f = await mit(fehler);
            expect(f.dauerhaft, name).toBe(dauerhaft);
            expect(f.message, name).not.toContain(SCHLUESSEL);
            expect(f.message, name).not.toContain("beispiel.test");
            expect(f.message.length, name).toBeLessThan(260);
        }
        expect((await mit(() => antwort(422, { error: "Text character limit of 500 exceeded" }))).message).toContain(
            "character limit",
        );
    });

    it("lädt ein Bild mit Beschreibung hoch und wartet bei 202 auf die Verarbeitung", async () => {
        let abfragen = 0;
        const instanz = stelleInstanz({
            fehler: (aufruf) => {
                if (aufruf.methode === "POST" && aufruf.pfad === "/api/v2/media")
                    return new Response(JSON.stringify({ id: "m77" }), { status: 202 });
                if (aufruf.pfad === "/api/v1/media/m77") {
                    abfragen += 1;
                    return new Response(JSON.stringify({ id: "m77" }), { status: abfragen < 3 ? 206 : 200 });
                }
                return undefined;
            },
        });
        const warten: number[] = [];
        const id = await ladeBildHoch(
            zugang,
            { bytes: new Uint8Array([1, 2, 3]), mime: "image/webp", beschreibung: "Eine Karte der Reichsstraße" },
            { fetch: instanz.fetch, warte: (ms) => (warten.push(ms), Promise.resolve()) },
        );
        expect(id).toBe("m77");
        expect(abfragen).toBe(3);
        expect(warten).toEqual([1000, 1000, 1000]);
        const form = instanz.aufrufe[0]!.body as FormData;
        expect(form.get("description")).toBe("Eine Karte der Reichsstraße");
    });

    it("löscht einen Beitrag; ist er dort nicht (mehr) da, ist das Ziel erreicht; eine unbrauchbare Kennung geht nie in einen Pfad", async () => {
        const instanz = stelleInstanz();
        const gesendet = await sende(zugang, { text: "weg damit", idempotenz: randomUUID() }, { fetch: instanz.fetch });
        await nimmZurueck(zugang, gesendet.id, { fetch: instanz.fetch });
        expect(instanz.beitraege.size).toBe(0);
        await nimmZurueck(zugang, gesendet.id, { fetch: instanz.fetch });
        const vorher = instanz.aufrufe.length;
        await expect(nimmZurueck(zugang, "1/../../x", { fetch: instanz.fetch })).rejects.toBeInstanceOf(MastodonFehler);
        expect(instanz.aufrufe.length).toBe(vorher);
    });

    it("die Zeitgrenze bricht einen hängenden Aufruf ab", async () => {
        const haengt: typeof globalThis.fetch = (_url, init) =>
            new Promise((_ok, fehler) => {
                init?.signal?.addEventListener("abort", () => fehler(new DOMException("zu spät", "TimeoutError")));
            });
        const ergebnis = await leseGrenzen(zugang, { fetch: haengt, timeoutMs: 20 }).catch((e: unknown) => e);
        expect(ergebnis).toBeInstanceOf(MastodonFehler);
        expect((ergebnis as MastodonFehler).message).toBe("Mastodon hat nicht rechtzeitig geantwortet");
        expect((ergebnis as MastodonFehler).dauerhaft).toBe(false);
    });
});

describe("Mastodon: die Jobart", () => {
    it("🔴 im Katalog (queued, leicht, ohne Sperre der Kartendomäne), mit Handler; die Eingabe ist streng", () => {
        expect(JOB_KIND_CATALOG[SOCIAL_SENDEN_KIND]).toMatchObject({
            kind: "social_senden",
            version: 1,
            origin: "queued",
            holdsSharedDomainLock: false,
        });
        expect(knowsKind(SOCIAL_SENDEN_KIND, 1)).toBe(true);
        expect(LEICHTE_ARTEN.has(SOCIAL_SENDEN_KIND)).toBe(true);
        expect(istSchwer(SOCIAL_SENDEN_KIND)).toBe(false);
        expect(Object.keys(JOB_HANDLERS)).toContain(SOCIAL_SENDEN_KIND);
        expect(leseSendenAuftrag({ beitrag: 7, kanal: "mastodon" })).toEqual({ beitrag: 7, kanal: "mastodon" });
        for (const roh of [
            {},
            { beitrag: 0, kanal: "mastodon" },
            { beitrag: 1, kanal: "neuigkeiten" },
            { beitrag: 1, kanal: "mastodon", text: "x" },
        ])
            expect(() => leseSendenAuftrag(roh)).toThrow();
    });
});

// --- Mit Datenbank ---------------------------------------------------------------------------------------------------------------

function serverConfig(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "social-mastodon-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

interface Quittung {
    id: number;
    nr: string;
    revision: number;
    zustand: "entwurf" | "vorgelegt" | "veroeffentlicht";
}

describeWithDatabase("Mastodon als Kanal des Social Hubs (PostgreSQL, gestellte Instanz)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let edda: { id: string; cookie: string };
    let betreiber: { id: string; cookie: string };
    let frisch: { id: string; cookie: string };
    let adrian: { id: string; cookie: string };
    let lena: { id: string; cookie: string };
    const gesichert: Record<string, string | undefined> = {};

    async function leeren(): Promise<void> {
        await database`DELETE FROM job WHERE kind = ${SOCIAL_SENDEN_KIND}`;
        await database`DELETE FROM avesmaps_community.beitrag`;
        await database`DELETE FROM avesmaps_community.kanal_stand`;
        await database`DELETE FROM public.news_entry`;
        await database`DELETE FROM avesmaps_auth.security_event WHERE action LIKE 'system.social_%'`;
        await database`DELETE FROM public.benachrichtigung WHERE art = 'social_freigabe'`;
    }

    beforeAll(async () => {
        for (const name of Object.keys(ENV)) gesichert[name] = process.env[name];
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: serverConfig(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string, passkeyMinutesAgo = 60) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo });
            return { id: created.id, cookie };
        };
        edda = await person("editor", "Edda");
        betreiber = await person("operator", "Rondrikan");
        // Derselbe Betreiber mit frischem Passkey (Stufe S verlangt ihn unmittelbar vor der Handlung).
        adrian = await person("admin", "Adrian", 1);
        lena = await person("reviewer", "Lena", 1);
    });

    beforeEach(async () => {
        // Stufe S verlangt den Passkey unmittelbar davor (höchstens fünf Minuten): je Test eine frische Sitzung.
        frisch = {
            id: betreiber.id,
            cookie: (await fixture.session(betreiber.id, { assurance: "strong", passkeyMinutesAgo: 1 })).cookie,
        };
        for (const [name, wert] of Object.entries(ENV)) process.env[name] = wert;
        await leeren();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        for (const name of Object.keys(ENV)) {
            const alt = gesichert[name];
            if (alt === undefined) delete process.env[name];
            else process.env[name] = alt;
        }
        await app?.close();
        await leeren().catch(() => undefined);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    // --- Hilfen -----------------------------------------------------------------------------------------------------------

    const get = (url: string, cookie?: string) =>
        app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
    const post = (url: string, payload: Record<string, unknown>, cookie: string) =>
        app.inject({ method: "POST", url, payload, headers: { origin: TEST_ORIGIN, cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    const inhalt = (patch: Record<string, unknown> = {}) => ({
        titel: "Die Reichsstraße ist da",
        text: "Die Reichsstraße von Gareth nach Wehrheim steht jetzt auf der Karte.",
        hashtags: ["Aventurien", "Karte"],
        rubrik: "karte",
        ki: false,
        kanaele: ["neuigkeiten", "mastodon"],
        ...patch,
    });
    const anlegen = async (cookie: string, patch: Record<string, unknown> = {}): Promise<Quittung> => {
        const antwort = await post("/api/community/social", { operationId: randomUUID(), ...inhalt(patch) }, cookie);
        expect(code(antwort)).toBe("201");
        expect(Value.Check(SocialQuittung, antwort.json())).toBe(true);
        return antwort.json() as Quittung;
    };
    const schritt = (id: number, was: string, revision: number, cookie: string, extra: Record<string, unknown> = {}) =>
        post(
            `/api/community/social/${String(id)}/${was}`,
            { operationId: randomUUID(), baseRevision: revision, ...extra },
            cookie,
        );
    const tu = async (
        id: number,
        was: string,
        revision: number,
        cookie: string,
        extra: Record<string, unknown> = {},
    ): Promise<Quittung> => {
        const antwort = await schritt(id, was, revision, cookie, extra);
        expect(code(antwort), was).toBe("200");
        return antwort.json() as Quittung;
    };
    const detail = async (id: number, cookie = betreiber.cookie) => {
        const antwort = await get(`/api/community/social/${String(id)}`, cookie);
        expect(code(antwort)).toBe("200");
        const body = antwort.json() as SocialDetail;
        expect(Value.Check(SocialDetail, body)).toBe(true);
        return body;
    };
    const ziel = async (id: number, kanal = "mastodon") =>
        (await detail(id)).zeile.ziele.find((z) => z.kanal === kanal);
    const kanaele = async (cookie = betreiber.cookie): Promise<Kanaele> => {
        const antwort = await get("/api/community/social/kanaele", cookie);
        expect(code(antwort)).toBe("200");
        expect(Value.Check(SocialKanaele, antwort.json())).toBe(true);
        return antwort.json() as Kanaele;
    };
    const protokoll = (action: string) =>
        database<{ target_ref: string | null; details: Record<string, unknown> }[]>`
            SELECT target_ref, details FROM avesmaps_auth.security_event WHERE action = ${action} ORDER BY id
        `;
    const auftraege = () =>
        database<
            {
                input_ref: { beitrag: number; kanal: string };
                state: string;
                actor_ref: string | null;
                not_before: Date | null;
            }[]
        >`
            SELECT input_ref, state, actor_ref, not_before FROM job WHERE kind = ${SOCIAL_SENDEN_KIND} ORDER BY id
        `;
    const sendung = async (id: number) => {
        const [zeile] = await database<
            { idempotenz: string; extern_id: string | null; aufgabe: string | null; versuche: number; serie: number }[]
        >`
            SELECT idempotenz::text, extern_id, aufgabe, versuche, serie FROM avesmaps_community.sendung WHERE beitrag_id = ${id}::bigint AND kanal = 'mastodon'
        `;
        return zeile;
    };
    const neuigkeiten = (beitrag: number) =>
        database<{ zustand: string }[]>`SELECT zustand FROM public.news_entry WHERE beitrag_id = ${beitrag}::bigint`;

    const GRENZEN = {
        zeichen: 500,
        adresse: 23,
        bilder: 4,
        beschreibung: 1500,
        bildBytes: 16_777_216,
        bildTypen: ["image/webp", "image/jpeg"],
    };
    /** Grenzen gelesen und die Zählregel geprüft: der Zustand nach `social:pruefen`. */
    async function bereitMachen(grenzen: Record<string, unknown> = GRENZEN): Promise<void> {
        await database`SELECT avesmaps_community.social_kanal_grenzen_setzen('mastodon', ${database.json(grenzen as never)}::jsonb)`;
        await database`SELECT avesmaps_community.social_kanal_pruefung_eintragen('mastodon', 'cli:test', true, '{}'::jsonb)`;
    }
    /** Ein Beitrag für Neuigkeiten und Mastodon, vorgelegt und vom Betreiber freigegeben. */
    async function veroeffentlichen(patch: Record<string, unknown> = {}): Promise<Quittung> {
        const b = await anlegen(edda.cookie, patch);
        const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
        return tu(b.id, "freigeben", vorgelegt.revision, betreiber.cookie);
    }
    const kontext = (beitrag: number): JobContext => ({
        input: { beitrag, kanal: "mastodon" },
        attempt: 1,
        job: { id: 1, publicId: randomUUID(), leaseNo: 1, mapDomainId: AVENTURIA.mapDomain },
        beginPhase: () => Promise.resolve(),
        checkpoint: () => undefined,
    });
    const lauf = (
        beitrag: number,
        instanz: GestellteInstanz,
        zusatz: {
            jetzt?: () => Date;
            environment?: NodeJS.ProcessEnv;
            bilder?: { read(k: string, m: number): Promise<Uint8Array> };
        } = {},
    ) =>
        runSocialSendenJob(kontext(beitrag), {
            database,
            environment: { ...ENV, ...zusatz.environment },
            fetch: instanz.fetch,
            ...(zusatz.jetzt === undefined ? {} : { jetzt: zusatz.jetzt }),
            ...(zusatz.bilder === undefined ? {} : { bilder: zusatz.bilder }),
        });
    const nichtsGeheimes = (...texte: unknown[]): void => {
        const alles = JSON.stringify(texte);
        expect(alles).not.toContain(SCHLUESSEL);
        expect(alles).not.toContain("beispiel.test");
    };

    // --- Konfiguration und Stand ------------------------------------------------------------------------------------------

    it("🔴 ohne Konfiguration gibt es den Kanal nicht: „nicht eingerichtet“, nicht wählbar zum Vorlegen, ohne Adresse oder Schlüssel in der Antwort", async () => {
        delete process.env["COMMUNITY_SOCIAL_MASTODON_TOKEN"];
        await bereitMachen();
        const stand = (await kanaele()).kanaele[0]!;
        expect(stand).toMatchObject({
            kanal: "mastodon",
            eingerichtet: false,
            freigeschaltet: true,
            bereit: false,
            sperre: "nicht_eingerichtet",
        });
        const b = await anlegen(edda.cookie);
        const antwort = await schritt(b.id, "vorlegen", b.revision, edda.cookie);
        expect(code(antwort)).toBe("422 community_invalid");
        expect((antwort.json() as { error: { message: string } }).error.message).toBe(
            "Mastodon ist in dieser Umgebung nicht eingerichtet.",
        );
        expect(await auftraege()).toEqual([]);
    });

    it("🔴 der Stand nennt nie Adresse oder Schlüssel; eingerichtet, aber nicht geprüft heißt „Zählregel noch nicht geprüft“", async () => {
        const antwort = await get("/api/community/social/kanaele", betreiber.cookie);
        expect(code(antwort)).toBe("200");
        const stand = (antwort.json() as Kanaele).kanaele[0]!;
        expect(stand).toMatchObject({
            kanal: "mastodon",
            eingerichtet: true,
            freigeschaltet: false,
            notschalter: false,
            grenzen: null,
            bereit: false,
            sperre: "nicht_freigeschaltet",
        });
        expect(antwort.body).not.toContain(SCHLUESSEL);
        expect(antwort.body).not.toContain("beispiel.test");
        expect((await kanaele(betreiber.cookie)).verwalten).toBe(true);
        expect((await kanaele(edda.cookie)).verwalten).toBe(false);
    });

    it("🔴 ohne Freischaltung kein Senden: Vorlegen weist ab, und auch die Datenbank gibt nicht frei", async () => {
        await database`SELECT avesmaps_community.social_kanal_grenzen_setzen('mastodon', ${database.json(GRENZEN as never)}::jsonb)`;
        const b = await anlegen(edda.cookie);
        const antwort = await schritt(b.id, "vorlegen", b.revision, edda.cookie);
        expect(code(antwort)).toBe("422 community_invalid");
        expect((antwort.json() as { error: { message: string } }).error.message).toBe(
            "Mastodon: Zählregel noch nicht geprüft.",
        );
        // Direkt an der Datenbank: Selbst wer die Route umgeht, bekommt keine Freigabe.
        await bereitMachen();
        const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
        await database`UPDATE avesmaps_community.kanal_stand SET freigeschaltet_at = NULL, geprueft_durch = NULL WHERE kanal = 'mastodon'`;
        await expect(
            database`SELECT avesmaps_community.beitrag_freigeben(${randomUUID()}::uuid, ${b.id}::bigint, ${betreiber.id}::uuid, ${vorgelegt.revision}::int)`,
        ).rejects.toMatchObject({
            message: expect.stringContaining("Zählregel dieses Kanals ist noch nicht geprüft") as unknown,
        });
        expect(await auftraege()).toEqual([]);
        expect(await neuigkeiten(b.id)).toEqual([]);
    });

    // --- Grenzen -----------------------------------------------------------------------------------------------------------

    it("🔴 Grenzen neu lesen: braucht manage_social_channels und einen frischen Passkey; eine geänderte Instanzgrenze wird übernommen und von der Zählung genutzt", async () => {
        const url = "/api/community/social/kanaele/mastodon/grenzen";
        for (const [wer, cookie, erwartet] of [
            ["Redaktion (Editor)", edda.cookie, "403 forbidden"],
            ["Reviewer", lena.cookie, "403 forbidden"],
            ["Admin", adrian.cookie, "403 forbidden"],
            ["Betreiber ohne frischen Passkey", betreiber.cookie, "403 reauth_required"],
        ] as const) {
            expect(code(await post(url, {}, cookie)), wer).toBe(erwartet);
        }
        expect(await get("/api/community/social/kanaele")).toMatchObject({ statusCode: 401 });
        expect(await protokoll("system.social_kanal_grenzen")).toEqual([]);

        const erste = stelleInstanz({ max: 500, adresse: 23 });
        vi.spyOn(globalThis, "fetch").mockImplementation(erste.fetch);
        const antwort = await post(url, {}, frisch.cookie);
        expect(code(antwort)).toBe("200");
        expect(Value.Check(SocialKanalStand, antwort.json())).toBe(true);
        expect((antwort.json() as { grenzen: unknown }).grenzen).toMatchObject({ zeichen: 500, adresse: 23 });
        nichtsGeheimes(antwort.json());
        expect(erste.aufrufe.map((a) => `${a.methode} ${a.pfad}`)).toEqual(["GET /api/v2/instance"]);

        // Die Instanz ändert ihre Grenze: 800 Zeichen, Adresse zählt 30.
        const zweite = stelleInstanz({ max: 800, adresse: 30 });
        vi.spyOn(globalThis, "fetch").mockImplementation(zweite.fetch);
        const neu = await post(url, {}, frisch.cookie);
        expect(code(neu)).toBe("200");
        expect((neu.json() as { grenzen: unknown }).grenzen).toMatchObject({ zeichen: 800, adresse: 30 });
        expect((await kanaele()).kanaele[0]!.grenzen).toMatchObject({ zeichen: 800, adresse: 30 });

        // Die Zählung des Servers nimmt sie: 600 Zeichen sind bei 500 zu viel, bei 800 nicht.
        await database`SELECT avesmaps_community.social_kanal_pruefung_eintragen('mastodon', 'cli:test', true, '{}'::jsonb)`;
        const lang = await anlegen(edda.cookie, {
            text: "a".repeat(600),
            hashtags: [],
            kanaele: ["mastodon"],
            titel: null,
        });
        expect(code(await schritt(lang.id, "vorlegen", lang.revision, edda.cookie))).toBe("200");
        const zuLang = await anlegen(edda.cookie, {
            text: "a".repeat(801),
            hashtags: [],
            kanaele: ["mastodon"],
            titel: null,
        });
        const abgelehnt = await schritt(zuLang.id, "vorlegen", zuLang.revision, edda.cookie);
        expect(code(abgelehnt)).toBe("422 community_invalid");
        expect((abgelehnt.json() as { error: { message: string } }).error.message).toBe("Mastodon: 1 Zeichen zu viel.");

        const eintraege = await protokoll("system.social_kanal_grenzen");
        expect(eintraege).toHaveLength(2);
        expect(eintraege[1]).toMatchObject({
            target_ref: "kanal:mastodon",
            details: { kanal: "mastodon", zeichen: 800, adresse: 30 },
        });
        nichtsGeheimes(eintraege);
    });

    it("🔴 Grenzen neu lesen: nicht eingerichtet → 409, die Instanz antwortet nicht → 502 mit festem Satz ohne Adresse", async () => {
        const url = "/api/community/social/kanaele/mastodon/grenzen";
        vi.spyOn(globalThis, "fetch").mockImplementation(stelleInstanz({ fehler: () => "netz" }).fetch);
        const aus = await post(url, {}, frisch.cookie);
        expect(code(aus)).toBe("502 community_kanal");
        expect((aus.json() as { error: { message: string } }).error.message).toBe("Mastodon war nicht erreichbar");
        // WI-0291: der Fachcode für das Fenster, mit dem Satz des Dienstes (ohne Schlüssel und Adresse).
        expect((aus.json() as { error: { details?: unknown } }).error.details).toEqual({
            reason: "kanal_antwort",
            antwort: "Mastodon war nicht erreichbar",
        });
        nichtsGeheimes(aus.json());
        delete process.env["COMMUNITY_SOCIAL_MASTODON_URL"];
        expect(code(await post(url, {}, frisch.cookie))).toBe("409 community_transition");
    });

    it("die tägliche Pflege liest die Grenzen ohne Route: gelesen, aus ohne Konfiguration, Fehler als Satz", async () => {
        const instanz = stelleInstanz({ max: 700, adresse: 24 });
        const gelesen = await liesUndSpeichereGrenzen(database, ENV, { fetch: instanz.fetch });
        expect(gelesen).toMatchObject({ art: "gelesen", grenzen: { zeichen: 700, adresse: 24 } });
        expect((await kanaele()).kanaele[0]!.grenzen).toMatchObject({ zeichen: 700 });
        expect(await liesUndSpeichereGrenzen(database, {}, { fetch: instanz.fetch })).toEqual({ art: "aus" });
        const kaputt = stelleInstanz({ fehler: () => new Response("{}", { status: 503 }) });
        const fehler = await liesUndSpeichereGrenzen(database, ENV, { fetch: kaputt.fetch });
        // WI-0291: Das Ergebnis sagt auch, ob der Dienst den Zugang ablehnt (`dauerhaft`) und wie er antwortete; daraus wird der Fachcode der Route.
        expect(fehler).toEqual({
            art: "fehler",
            satz: "Mastodon meldet einen Fehler (503)",
            dauerhaft: false,
            status: 503,
        });
        // Ein Fehler der Instanz lässt die letzten Grenzen stehen.
        expect((await kanaele()).kanaele[0]!.grenzen).toMatchObject({ zeichen: 700 });
    });

    // --- Senden ------------------------------------------------------------------------------------------------------------

    it("🔴 Freigeben schreibt die Neuigkeit, merkt die Sendung vor und reiht EINEN Auftrag ein; gesendet wird im Auftrag, mit Hashtags am Text und Kennung gegen Doppeltes", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        expect(frei.zustand).toBe("veroeffentlicht");
        expect(await neuigkeiten(frei.id)).toEqual([{ zustand: "sichtbar" }]);
        expect(await ziel(frei.id)).toMatchObject({ zustand: "wartet", adresse: null, ausstehend: "senden" });
        expect(await ziel(frei.id, "neuigkeiten")).toMatchObject({ zustand: "ok", ausstehend: null });
        expect(await auftraege()).toEqual([
            {
                input_ref: { beitrag: frei.id, kanal: "mastodon" },
                state: "QUEUED",
                actor_ref: "community",
                not_before: null,
            },
        ]);

        const instanz = stelleInstanz();
        const ergebnis = await lauf(frei.id, instanz);
        expect(ergebnis).toMatchObject({ beitrag: frei.id, kanal: "mastodon", zustand: "ok", versuche: 1 });
        // Der Beitrag dort: Text ohne Titelzeile, die Hashtags dahinter, öffentlich, mit der Kennung gegen Doppeltes.
        const beitrag = [...instanz.beitraege.values()][0]!;
        expect(beitrag.text).toBe(
            "Die Reichsstraße von Gareth nach Wehrheim steht jetzt auf der Karte.\n\n#Aventurien #Karte",
        );
        expect(beitrag.sichtbarkeit).toBe("public");
        expect(beitrag.schluessel).toBe((await sendung(frei.id))!.idempotenz);
        const z = await ziel(frei.id);
        expect(z).toMatchObject({ zustand: "ok", fehler: null, versuche: 1, ausstehend: null });
        expect(z?.adresse).toBe(`https://mastodon.beispiel.test/@konto/${beitrag.id}`);
        expect((await sendung(frei.id))!.extern_id).toBe(beitrag.id);
        const verlauf = (await detail(frei.id)).verlauf.map((e) => `${e.art}:${e.text ?? ""}`);
        expect(verlauf).toContain("gesendet:Mastodon");
        expect(verlauf).toContain("gesendet:Neuigkeiten");
        // Die Adresse des gesendeten Beitrags ist öffentlich und steht im Ziel; nie aber der Zugangsschlüssel.
        nichtsGeheimes(ergebnis, verlauf);
        expect(JSON.stringify(z)).not.toContain(SCHLUESSEL);

        // Derselbe Auftrag noch einmal tut nichts: kein zweiter Beitrag, keine zweite Anfrage.
        const anfragen = instanz.aufrufe.length;
        expect(await lauf(frei.id, instanz)).toMatchObject({ ergebnis: "uebersprungen" });
        expect(instanz.aufrufe.length).toBe(anfragen);
        expect(instanz.beitraege.size).toBe(1);
    });

    it("🔴 stirbt der Auftrag nach dem Senden und vor dem Eintrag, sendet der nächste mit DERSELBEN Kennung: bei der Instanz bleibt es ein Beitrag", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        const instanz = stelleInstanz();
        await lauf(frei.id, instanz);
        // Zurück auf „steht an“, als wäre der Eintrag des Ergebnisses nie angekommen; die Reservierung ist abgelaufen.
        await database`UPDATE avesmaps_community.sendung SET aufgabe = 'senden', reserviert_bis = now() - interval '1 minute', versuche = 0 WHERE beitrag_id = ${frei.id}::bigint`;
        await database`UPDATE avesmaps_community.beitrag_ziel SET zustand = 'wartet', adresse = NULL WHERE beitrag_id = ${frei.id}::bigint AND kanal = 'mastodon'`;
        await lauf(frei.id, instanz);
        expect(instanz.aufrufe.filter((a) => a.methode === "POST" && a.pfad === "/api/v1/statuses")).toHaveLength(2);
        expect(instanz.angelegt()).toBe(1);
        expect(instanz.beitraege.size).toBe(1);
        expect(await ziel(frei.id)).toMatchObject({ zustand: "ok" });
    });

    it("🔴 zwei gleichzeitige Aufträge: nur einer bekommt die Reservierung, der andere sieht später nach", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        const langsam = stelleInstanz();
        let freigeben: () => void = () => undefined;
        const haelt = new Promise<void>((ok) => {
            freigeben = ok;
        });
        const anderer: GestellteInstanz = {
            ...langsam,
            fetch: (async (eingabe: string | URL | Request, init?: RequestInit) => {
                await haelt;
                return langsam.fetch(eingabe, init);
            }) as typeof globalThis.fetch,
        };
        const erster = lauf(frei.id, anderer);
        await new Promise((ok) => setTimeout(ok, 150));
        const zweiter = await lauf(frei.id, langsam);
        expect(zweiter).toMatchObject({ ergebnis: "reserviert" });
        freigeben();
        await erster;
        expect(langsam.angelegt()).toBe(1);
        const jobs = await auftraege();
        expect(jobs.filter((j) => j.not_before !== null)).toHaveLength(1);
    });

    it("🔴 vorübergehende Fehler: Wiederholung mit Abstand, nach dem dritten Versuch „Fehler“ mit Satz ohne Schlüssel; Erneut senden mit derselben Kennung gelingt", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        const kaputt = stelleInstanz({
            fehler: (a) => (a.pfad === "/api/v1/statuses" ? new Response("{}", { status: 503 }) : undefined),
        });
        const jetzt = new Date("2026-11-01T10:00:00Z");
        const eins = await lauf(frei.id, kaputt, { jetzt: () => jetzt });
        expect(eins).toMatchObject({ zustand: "wartet", versuche: 1, naechsterVersuchInMs: SENDEN_ABSTAENDE_MS[0] });
        expect(await ziel(frei.id)).toMatchObject({ zustand: "wartet", ausstehend: "senden" });
        const zwei = await lauf(frei.id, kaputt, { jetzt: () => jetzt });
        expect(zwei).toMatchObject({ versuche: 2, naechsterVersuchInMs: SENDEN_ABSTAENDE_MS[1] });
        const drei = await lauf(frei.id, kaputt, { jetzt: () => jetzt });
        expect(drei).toMatchObject({ zustand: "fehler", versuche: 3 });
        expect(drei).not.toHaveProperty("naechsterVersuchInMs");
        const z = await ziel(frei.id);
        expect(z).toMatchObject({ zustand: "fehler", fehler: "Mastodon meldet einen Fehler (503)", ausstehend: null });
        nichtsGeheimes(z, drei);
        const folge = (await auftraege()).filter((j) => j.not_before !== null);
        expect(folge.map((j) => j.not_before!.getTime() - jetzt.getTime())).toEqual([60_000, 300_000]);
        // Die Neuigkeit bleibt, was sie war: sichtbar.
        expect(await neuigkeiten(frei.id)).toEqual([{ zustand: "sichtbar" }]);
        expect((await detail(frei.id)).zeile.zustand).toBe("veroeffentlicht");

        // Erneut senden: dieselbe Kennung, ein neuer Auftrag; jetzt antwortet die Instanz.
        const kennung = (await sendung(frei.id))!.idempotenz;
        await tu(frei.id, "erneut", (await detail(frei.id)).zeile.revision, betreiber.cookie, { kanal: "mastodon" });
        expect((await sendung(frei.id))!.idempotenz).toBe(kennung);
        expect(await ziel(frei.id)).toMatchObject({ zustand: "wartet", fehler: null, ausstehend: "senden" });
        const gut = stelleInstanz();
        await lauf(frei.id, gut);
        expect([...gut.beitraege.values()][0]!.schluessel).toBe(kennung);
        expect(await ziel(frei.id)).toMatchObject({ zustand: "ok", versuche: 2 });
        expect((await protokoll("system.social_erneut_gesendet"))[0]).toMatchObject({ details: { kanal: "mastodon" } });
    });

    it("🔴 ein dauerhafter Fehler (Schlüssel abgelehnt) macht sofort „Fehler“, ohne Wiederholung", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        const abgelehnt = stelleInstanz({
            fehler: (a) =>
                a.pfad === "/api/v1/statuses"
                    ? new Response(JSON.stringify({ error: `bad ${SCHLUESSEL}` }), { status: 401 })
                    : undefined,
        });
        const ergebnis = await lauf(frei.id, abgelehnt);
        expect(ergebnis).toMatchObject({ zustand: "fehler", versuche: 1 });
        expect(await ziel(frei.id)).toMatchObject({
            zustand: "fehler",
            fehler: "Mastodon hat den Zugangsschlüssel abgelehnt (401)",
        });
        expect((await auftraege()).filter((j) => j.not_before !== null)).toEqual([]);
        nichtsGeheimes(await ziel(frei.id), ergebnis);
    });

    it("🔴 ohne Konfiguration im Auftrag steht das Ziel auf „Fehler“ und es geht nichts hinaus", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        const instanz = stelleInstanz();
        await lauf(frei.id, instanz, {
            environment: { COMMUNITY_SOCIAL_MASTODON_URL: "", COMMUNITY_SOCIAL_MASTODON_TOKEN: "" },
        });
        expect(instanz.aufrufe).toEqual([]);
        expect(await ziel(frei.id)).toMatchObject({
            zustand: "fehler",
            fehler: "Der Kanal ist in dieser Umgebung nicht eingerichtet",
        });
    });

    it("🔴 der Auftrag zählt noch einmal nach: Wird die Grenze der Instanz kleiner, sendet er nichts Zulanges", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen({ text: "a".repeat(450), hashtags: [], titel: "T" });
        await database`SELECT avesmaps_community.social_kanal_grenzen_setzen('mastodon', ${database.json({ ...GRENZEN, zeichen: 300 } as never)}::jsonb)`;
        const instanz = stelleInstanz();
        await lauf(frei.id, instanz);
        expect(instanz.beitraege.size).toBe(0);
        expect(instanz.aufrufe).toEqual([]);
        expect(await ziel(frei.id)).toMatchObject({
            zustand: "fehler",
            fehler: "Der Text ist für die Instanz zu lang (150 Zeichen zu viel)",
        });
    });

    // --- Bild --------------------------------------------------------------------------------------------------------------

    async function medium(klaerung: string, mit = true): Promise<string> {
        const [asset] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO public.media_asset (media_kind, origin, source_system, title)
            VALUES ('image', 'editor_upload', 'test', 'Karte der Reichsstraße') RETURNING id::text, public_id::text
        `;
        await database`
            INSERT INTO public.media_rights (media_asset_id, rights_basis, clearance_state)
            VALUES (${asset!.id}::bigint, 'own_work', ${klaerung})
        `;
        if (mit) {
            const hash = "ab".repeat(32);
            await database`
                INSERT INTO public.media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
                VALUES (${asset!.id}::bigint, 'ansicht', 'published', ${`published/sha256/ab/ab/${hash}.webp`}, 'image/webp', 1200, 800, 3, ${hash}, 'ansicht', '1')
            `;
        }
        return asset!.public_id;
    }

    it("🔴 ein Bild geht mit Beschreibung zuerst hoch, dann hängt der Beitrag daran; die Datei ist die veröffentlichte WebP-Fassung", async () => {
        await bereitMachen();
        const bild = await medium("cleared");
        const frei = await veroeffentlichen({
            bild,
            bildBeschreibung: "Die Reichsstraße auf der Karte von Aventurien",
        });
        const instanz = stelleInstanz();
        const gelesen: string[] = [];
        await lauf(frei.id, instanz, {
            bilder: { read: (schluessel) => (gelesen.push(schluessel), Promise.resolve(new Uint8Array([1, 2, 3]))) },
        });
        expect(gelesen).toEqual([`published/sha256/ab/ab/${"ab".repeat(32)}.webp`]);
        expect(instanz.aufrufe.map((a) => `${a.methode} ${a.pfad}`)).toEqual([
            "POST /api/v2/media",
            "POST /api/v1/statuses",
        ]);
        expect([...instanz.medien.values()]).toEqual([
            { beschreibung: "Die Reichsstraße auf der Karte von Aventurien", typ: "image/webp", groesse: 3 },
        ]);
        expect([...instanz.beitraege.values()][0]!.medien).toEqual(["m1"]);
        expect(await ziel(frei.id)).toMatchObject({ zustand: "ok" });
    });

    it("🔴 sind die Rechte des Bildes beim Senden nicht (mehr) geklärt, geht nichts hinaus", async () => {
        await bereitMachen();
        const bild = await medium("cleared");
        const frei = await veroeffentlichen({ bild, bildBeschreibung: "Eine Karte" });
        await database`UPDATE public.media_rights SET clearance_state = 'rejected' WHERE media_asset_id = (SELECT id FROM public.media_asset WHERE public_id = ${bild}::uuid)`;
        const instanz = stelleInstanz();
        await lauf(frei.id, instanz, { bilder: { read: () => Promise.resolve(new Uint8Array([1])) } });
        expect(instanz.aufrufe).toEqual([]);
        expect((await ziel(frei.id))?.fehler).toBe(
            "Die Rechte des Bildes lassen keinen Beitrag (mehr) zu oder es ist ausgeblendet",
        );
    });

    it("🔴 ein Bild aus der Medienverwaltung, das nirgends hängt, wird für den Beitrag gerechnet: ohne Zuschnitt, als WebP, und auf Avesmaps entsteht keine Datei", async () => {
        await bereitMachen();
        const bild = await medium("cleared", false);
        const png = await pngBytes(77_001, 1600, 400);
        const schluessel = "private/source/sha256/aa/bb/probe.png";
        await database`
            INSERT INTO public.media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
            SELECT a.id, 'original', 'private_source', ${schluessel}, 'image/png', 1600, 400, ${png.byteLength}, ${sha256Of(png)}
              FROM public.media_asset a WHERE a.public_id = ${bild}::uuid
        `;
        const frei = await veroeffentlichen({ bild, bildBeschreibung: "Eine Karte" });
        const instanz = stelleInstanz();
        const gelesen: string[] = [];
        await lauf(frei.id, instanz, {
            bilder: { read: (key) => (gelesen.push(key), Promise.resolve(png)) },
        });
        expect(gelesen).toEqual([schluessel]);
        const [hoch] = [...instanz.medien.values()];
        expect(hoch).toMatchObject({ beschreibung: "Eine Karte", typ: "image/webp" });
        expect(await ziel(frei.id)).toMatchObject({ zustand: "ok" });
        const [dateien] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM public.media_file f JOIN public.media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${bild}::uuid AND f.storage_class = 'published'`;
        expect(dateien?.n).toBe(0);
    });

    it("🔴 ohne Original und ohne öffentliche Datei scheitert es sofort und sagt warum, statt dreimal zu warten", async () => {
        await bereitMachen();
        const bild = await medium("cleared", false);
        const frei = await veroeffentlichen({ bild, bildBeschreibung: "Eine Karte" });
        const instanz = stelleInstanz();
        await lauf(frei.id, instanz, { bilder: { read: () => Promise.resolve(new Uint8Array([1])) } });
        expect(instanz.aufrufe).toEqual([]);
        expect((await ziel(frei.id))?.fehler).toBe("Zum Bild gibt es keine veröffentlichte Fassung");
    });

    it("ein Bildformat, das die Instanz nicht annimmt, geht nie hinaus", async () => {
        await bereitMachen({ ...GRENZEN, bildTypen: ["image/jpeg"] });
        const bild = await medium("cleared");
        const frei = await veroeffentlichen({ bild, bildBeschreibung: "Eine Karte" });
        const instanz = stelleInstanz();
        await lauf(frei.id, instanz, { bilder: { read: () => Promise.resolve(new Uint8Array([1])) } });
        expect(instanz.aufrufe).toEqual([]);
        expect((await ziel(frei.id))?.fehler).toBe("Die Instanz nimmt dieses Bildformat nicht an");
    });

    // --- Zurücknehmen -----------------------------------------------------------------------------------------------------

    it("🔴 Zurücknehmen: der Beitrag wird bei Mastodon gelöscht, das Ziel steht auf „zurückgenommen“, die Neuigkeit bleibt; Erneut senden bekommt eine NEUE Kennung", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        const instanz = stelleInstanz();
        await lauf(frei.id, instanz);
        const alt = (await sendung(frei.id))!;
        const revision = (await detail(frei.id)).zeile.revision;

        // Rechte: ein Editor darf es nicht.
        expect(code(await schritt(frei.id, "kanal-zuruecknehmen", revision, edda.cookie, { kanal: "mastodon" }))).toBe(
            "403 forbidden",
        );
        const q = await tu(frei.id, "kanal-zuruecknehmen", revision, betreiber.cookie, { kanal: "mastodon" });
        expect(await ziel(frei.id)).toMatchObject({ zustand: "ok", ausstehend: "zuruecknehmen" });
        expect(await auftraege()).toHaveLength(2);
        // Ein zweiter Klick, solange es läuft, ändert nichts.
        await tu(frei.id, "kanal-zuruecknehmen", q.revision, betreiber.cookie, { kanal: "mastodon" });

        await lauf(frei.id, instanz);
        expect(instanz.aufrufe.filter((a) => a.methode === "DELETE").map((a) => a.pfad)).toEqual([
            `/api/v1/statuses/${alt.extern_id}`,
        ]);
        expect(instanz.beitraege.size).toBe(0);
        expect(await ziel(frei.id)).toMatchObject({ zustand: "zurueck", fehler: null, ausstehend: null });
        expect(await ziel(frei.id, "neuigkeiten")).toMatchObject({ zustand: "ok" });
        expect(await neuigkeiten(frei.id)).toEqual([{ zustand: "sichtbar" }]);
        expect((await protokoll("system.social_zurueckgenommen"))[0]).toMatchObject({ details: { kanal: "mastodon" } });

        // Wieder senden: neue Kennung, ein neuer Beitrag.
        await tu(frei.id, "erneut", (await detail(frei.id)).zeile.revision, betreiber.cookie, { kanal: "mastodon" });
        const neu = (await sendung(frei.id))!;
        expect(neu.idempotenz).not.toBe(alt.idempotenz);
        expect(neu.extern_id).toBeNull();
        await lauf(frei.id, instanz);
        expect(instanz.beitraege.size).toBe(1);
        expect(await ziel(frei.id)).toMatchObject({ zustand: "ok" });
    });

    it("scheitert das Zurücknehmen, bleibt das Ziel „gesendet“ und trägt den Grund; ist der Beitrag dort schon weg, ist es gelungen", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        const instanz = stelleInstanz();
        await lauf(frei.id, instanz);
        await tu(frei.id, "kanal-zuruecknehmen", (await detail(frei.id)).zeile.revision, betreiber.cookie, {
            kanal: "mastodon",
        });
        const kaputt: GestellteInstanz = {
            ...instanz,
            fetch: stelleInstanz({ fehler: () => new Response("{}", { status: 403 }) }).fetch,
        };
        await lauf(frei.id, kaputt);
        expect(await ziel(frei.id)).toMatchObject({
            zustand: "ok",
            ausstehend: null,
            fehler: "Das Konto darf das bei Mastodon nicht (403)",
        });
        // Noch einmal zurücknehmen; der Beitrag ist inzwischen von Hand gelöscht (404): auch das ist erreicht.
        await tu(frei.id, "kanal-zuruecknehmen", (await detail(frei.id)).zeile.revision, betreiber.cookie, {
            kanal: "mastodon",
        });
        instanz.beitraege.clear();
        await lauf(frei.id, instanz);
        expect(await ziel(frei.id)).toMatchObject({ zustand: "zurueck", fehler: null });
    });

    it("die Neuigkeit eines Beitrags nur für Mastodon wird nicht „zurückgenommen“: 409; die Neuigkeiten-Handlung kennt nur ihren Kanal", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen({ kanaele: ["mastodon"], titel: null });
        expect(await neuigkeiten(frei.id)).toEqual([]);
        expect(code(await schritt(frei.id, "zuruecknehmen", frei.revision, betreiber.cookie))).toBe(
            "409 community_transition",
        );
        // Ein Beitrag nur für Mastodon schreibt keinen Eintrag und keinen Verlaufseintrag „Neuigkeiten“.
        expect((await detail(frei.id)).verlauf.map((e) => `${e.art}:${e.text ?? ""}`)).not.toContain(
            "gesendet:Neuigkeiten",
        );
        expect(await ziel(frei.id)).toMatchObject({ zustand: "wartet", ausstehend: "senden" });
    });

    // --- Notschalter -------------------------------------------------------------------------------------------------------

    it("🔴 Notschalter: braucht manage_social_channels und frischen Passkey; er sperrt Vorlegen und Freigeben, hält einen vorgemerkten Beitrag am Senden und lässt das Zurücknehmen zu", async () => {
        await bereitMachen();
        const url = "/api/community/social/kanaele/mastodon/notschalter";
        for (const [wer, cookie, erwartet] of [
            ["Editor", edda.cookie, "403 forbidden"],
            ["Admin", adrian.cookie, "403 forbidden"],
            ["Betreiber ohne frischen Passkey", betreiber.cookie, "403 reauth_required"],
        ] as const) {
            expect(code(await post(url, { an: true }, cookie)), wer).toBe(erwartet);
        }
        expect((await kanaele()).kanaele[0]!.notschalter).toBe(false);

        // Ein Beitrag, der vor dem Notschalter freigegeben wurde.
        const vorher = await veroeffentlichen();
        const instanz = stelleInstanz();
        const gesendet = await veroeffentlichen({ titel: "Zweiter" });
        await lauf(gesendet.id, instanz);

        const an = await post(url, { an: true }, frisch.cookie);
        expect(code(an)).toBe("200");
        expect(an.json()).toMatchObject({ notschalter: true, bereit: false, sperre: "notschalter" });
        expect(await protokoll("system.social_kanal_notschalter")).toHaveLength(1);
        // Noch einmal an: nichts ändert sich, kein zweiter Eintrag im Protokoll.
        expect(code(await post(url, { an: true }, frisch.cookie))).toBe("200");
        expect(await protokoll("system.social_kanal_notschalter")).toHaveLength(1);
        expect((await protokoll("system.social_kanal_notschalter"))[0]).toMatchObject({
            target_ref: "kanal:mastodon",
            details: { kanal: "mastodon", an: true },
        });

        const neu = await anlegen(edda.cookie);
        const antwort = await schritt(neu.id, "vorlegen", neu.revision, edda.cookie);
        expect(code(antwort)).toBe("422 community_invalid");
        expect((antwort.json() as { error: { message: string } }).error.message).toBe(
            "Mastodon: Der Notschalter steht an.",
        );

        // Der vorgemerkte Beitrag wird nicht gesendet; das Ziel sagt warum.
        const sperrt = stelleInstanz();
        await lauf(vorher.id, sperrt);
        expect(sperrt.aufrufe).toEqual([]);
        expect((await ziel(vorher.id))?.fehler).toBe("Der Notschalter steht an: nichts gesendet");
        expect(await ziel(vorher.id)).toMatchObject({ zustand: "fehler" });
        // Erneut senden bleibt gesperrt, bis der Schalter aus ist.
        expect(
            code(
                await schritt(vorher.id, "erneut", (await detail(vorher.id)).zeile.revision, betreiber.cookie, {
                    kanal: "mastodon",
                }),
            ),
        ).toBe("422 community_invalid");
        // Zurücknehmen geht auch bei Notschalter.
        const q = await tu(
            gesendet.id,
            "kanal-zuruecknehmen",
            (await detail(gesendet.id)).zeile.revision,
            betreiber.cookie,
            { kanal: "mastodon" },
        );
        expect(q.zustand).toBe("veroeffentlicht");
        await lauf(gesendet.id, instanz);
        expect(await ziel(gesendet.id)).toMatchObject({ zustand: "zurueck" });

        // Schalter aus: Erneut senden geht wieder.
        const aus = await post(url, { an: false }, frisch.cookie);
        expect(aus.json()).toMatchObject({ notschalter: false, bereit: true, sperre: null });
        await tu(vorher.id, "erneut", (await detail(vorher.id)).zeile.revision, betreiber.cookie, {
            kanal: "mastodon",
        });
        await lauf(vorher.id, sperrt);
        expect(await ziel(vorher.id)).toMatchObject({ zustand: "ok" });
        expect(await protokoll("system.social_kanal_notschalter")).toHaveLength(2);
    });

    // --- Ausfall -----------------------------------------------------------------------------------------------------------

    it("🔴 ein Ausfall des Kanals ändert nichts an Avesmaps: Beitrag veröffentlicht, Neuigkeit sichtbar und öffentlich, nur das Ziel zeigt den Fehler (und die Liste „wartet“)", async () => {
        await bereitMachen();
        const frei = await veroeffentlichen();
        await lauf(frei.id, stelleInstanz({ fehler: () => "netz" }), { jetzt: () => new Date() });
        await lauf(frei.id, stelleInstanz({ fehler: () => "netz" }));
        await lauf(frei.id, stelleInstanz({ fehler: () => "netz" }));
        expect(await ziel(frei.id)).toMatchObject({ zustand: "fehler", fehler: "Mastodon war nicht erreichbar" });
        expect((await detail(frei.id)).zeile.zustand).toBe("veroeffentlicht");
        expect(await neuigkeiten(frei.id)).toEqual([{ zustand: "sichtbar" }]);
        const oeffentlich = (await get("/api/news")).json() as { eintraege: { titel: string }[] };
        expect(oeffentlich.eintraege.map((e) => e.titel)).toEqual(["Die Reichsstraße ist da"]);
        const liste = (await get("/api/community/social?segment=veroeffentlicht", betreiber.cookie)).json() as {
            zaehler: { wartet: number };
        };
        expect(liste.zaehler.wartet).toBe(1);
    });

    it("Freigeben bleibt eine Handlung: wiederholt (dieselbe Kennung) reiht sie keinen zweiten Auftrag ein", async () => {
        await bereitMachen();
        const b = await anlegen(edda.cookie);
        const vorgelegt = await tu(b.id, "vorlegen", b.revision, edda.cookie);
        const operationId = randomUUID();
        for (let i = 0; i < 2; i += 1) {
            const antwort = await post(
                `/api/community/social/${String(b.id)}/freigeben`,
                { operationId, baseRevision: vorgelegt.revision },
                betreiber.cookie,
            );
            expect(code(antwort)).toBe("200");
        }
        expect(await auftraege()).toHaveLength(1);
        expect((await protokoll("system.social_freigegeben"))[0]).toMatchObject({
            details: { kanal: "neuigkeiten,mastodon" },
        });
    });

    it("die Grenzen sind hart: Unsinn trägt die Datenbank nicht ein", async () => {
        for (const grenzen of [
            { ...GRENZEN, zeichen: 0 },
            { ...GRENZEN, zeichen: 1_000_000 },
            { ...GRENZEN, adresse: "23" },
            { ...GRENZEN, bildTypen: "image/webp" },
            { ...GRENZEN, bildTypen: ["text/html; x"] },
        ]) {
            await expect(
                database`SELECT avesmaps_community.social_kanal_grenzen_setzen('mastodon', ${database.json(grenzen as never)}::jsonb)`,
            ).rejects.toMatchObject({ message: expect.stringContaining("community_invalid") as unknown });
        }
        await expect(
            database`SELECT avesmaps_community.social_kanal_grenzen_setzen('bluesky', ${database.json(GRENZEN as never)}::jsonb)`,
        ).rejects.toBeDefined();
        expect(await database`SELECT 1 FROM avesmaps_community.kanal_stand`).toEqual([]);
    });
});
