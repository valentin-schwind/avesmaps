import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    KARTENEINSTELLUNGEN,
    KARTENEINSTELLUNGEN_URL,
    MAP_SETTINGS_URL,
    karteneinstellung,
    karteneinstellungImRahmen,
    karteneinstellungVorgaben,
    karteneinstellungenWirksam,
    wegfindungImBrowser,
    wegfindungVorgaben,
    AVENTURIA_TRAVEL_MODEL,
    CALENDAR_MONTHS,
    DEFAULT_LODGING,
    ROUTE_DEFAULTS,
    type AdminKarteneinstellungen,
    type KartenWert,
    type MapSettings,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { leseKarteneinstellungen, wirksameKarteneinstellungen } from "../src/system/karteneinstellungen.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

const TRANSPORTS_LAND = AVENTURIA_TRAVEL_MODEL.transportmittel.wert.land;

/**
 * Die Karteneinstellungen der Systemsteuerung (WI-0166): die Tafel (Vorgaben, Art, Grenzen), der öffentliche Leseweg für den
 * Start der Karte, der Schreibweg mit Revision und Protokoll, und das Zurücksetzen.
 */

describe("Tafel der Karteneinstellungen (ohne Datenbank)", () => {
    it("🔴 die Startansicht ist das Label „Aventurien“ auf Zoom 2,5 (Betreiber 2026-10-15)", () => {
        expect(karteneinstellungVorgaben()).toMatchObject({ startPosition: { x: 518.75, y: 504 }, startZoom: 2.5 });
    });

    it("🔴 die Vorgaben des Routenplaners sind die festen Vorgaben des Codes, gegen die jeder Link gelesen wird", () => {
        expect(karteneinstellungVorgaben()).toMatchObject({
            planerReiseart: "surface",
            planerFlugmittel: "witchFlight",
            planerLandErlaubt: true,
            planerLandTransport: ROUTE_DEFAULTS.land,
            planerFlussErlaubt: true,
            planerFlussTransport: ROUTE_DEFAULTS.river,
            planerMeerErlaubt: true,
            planerMeerTransport: ROUTE_DEFAULTS.sea,
            planerRoutenwahl: ROUTE_DEFAULTS.optimize,
            planerUmstiegeMinimieren: ROUTE_DEFAULTS.minimize_transfers,
            planerEiltempo: ROUTE_DEFAULTS.hurry,
            planerReisestunden: ROUTE_DEFAULTS.hours_per_day,
            planerReisebeginn: "unbestimmt",
            planerUnterbringung: DEFAULT_LODGING,
        });
    });

    it("🔴 Auswahl, Schalter, Reisestunden und Reisebeginn: nur, was der Planer auch kennt", () => {
        const land = karteneinstellung("planerLandTransport")!;
        expect(karteneinstellungImRahmen(land, ROUTE_DEFAULTS.land)).toBe(true);
        expect(karteneinstellungImRahmen(land, "Drachenreiter")).toBe(false);
        expect(karteneinstellungImRahmen(land, ROUTE_DEFAULTS.river)).toBe(false);
        const eile = karteneinstellung("planerEiltempo")!;
        expect(karteneinstellungImRahmen(eile, true)).toBe(true);
        expect(karteneinstellungImRahmen(eile, "true")).toBe(false);
        const stunden = karteneinstellung("planerReisestunden")!;
        for (const gut of [0.5, 8.5, 24]) expect(karteneinstellungImRahmen(stunden, gut), String(gut)).toBe(true);
        for (const schlecht of [0, 8.3, 24.5])
            expect(karteneinstellungImRahmen(stunden, schlecht), String(schlecht)).toBe(false);
        const beginn = karteneinstellung("planerReisebeginn")!;
        expect(karteneinstellungImRahmen(beginn, "unbestimmt")).toBe(true);
        expect(karteneinstellungImRahmen(beginn, { monat: CALENDAR_MONTHS[0], tag: 1 })).toBe(true);
        expect(karteneinstellungImRahmen(beginn, { monat: "namenlos", tag: 5 })).toBe(true);
        for (const schlecht of [
            { monat: CALENDAR_MONTHS[0], tag: 31 },
            { monat: "Namenlos", tag: 1 },
            { monat: "namenlos", tag: 6 },
            { monat: CALENDAR_MONTHS[0] },
            "irgendwann",
        ]) {
            expect(karteneinstellungImRahmen(beginn, schlecht), JSON.stringify(schlecht)).toBe(false);
        }
    });

    it("🔴 jede Vorgabe liegt in ihren eigenen Grenzen", () => {
        for (const einstellung of KARTENEINSTELLUNGEN) {
            expect(karteneinstellungImRahmen(einstellung, einstellung.vorgabe), einstellung.id).toBe(true);
        }
    });

    it("🔴 draußen: falsche Art, außerhalb der Karte, nicht endlich, fremde Felder", () => {
        const zoom = karteneinstellung("startZoom")!;
        const position = karteneinstellung("startPosition")!;
        for (const daneben of [-0.5, 9.6, Number.NaN, Number.POSITIVE_INFINITY, "3", { x: 1, y: 2 }, null]) {
            expect(karteneinstellungImRahmen(zoom, daneben), String(daneben)).toBe(false);
        }
        for (const daneben of [
            3,
            { x: -1, y: 500 },
            { x: 500, y: 1025 },
            { x: 500 },
            { x: 500, y: 500, z: 3 },
            { x: "500", y: 500 },
            [500, 500],
        ]) {
            expect(karteneinstellungImRahmen(position, daneben), JSON.stringify(daneben)).toBe(false);
        }
        expect(karteneinstellungImRahmen(zoom, 0)).toBe(true);
        expect(karteneinstellungImRahmen(position, { x: 0, y: 1024 })).toBe(true);
    });

    it("wirksam: die Vorgaben, überschrieben von passenden Abweichungen; Fremdes und Unpassendes wird übergangen", () => {
        const wirksam = karteneinstellungenWirksam({
            startZoom: 4,
            startPosition: { x: 9999, y: 1 },
            gibtEsNicht: 7,
        });
        expect(wirksam).toMatchObject({ startPosition: { x: 518.75, y: 504 }, startZoom: 4 });
        expect(Object.keys(wirksam)).toHaveLength(KARTENEINSTELLUNGEN.length);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "wi0166-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Karteneinstellungen lesen und verstellen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let operator: { cookie: string };
    let admin: { cookie: string };

    const reset = async (): Promise<void> => {
        await database`DELETE FROM map_setting`;
        await database`
            UPDATE system_state SET system_lock = false, system_lock_since = NULL, system_lock_reason = NULL WHERE id = 1
        `;
        await app?.systemState?.refresh();
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 1 });
            return { ...created, cookie };
        };
        operator = await person("operator", "Rondrikan");
        admin = await person("admin", "Admina");
    });

    beforeEach(reset);

    afterAll(async () => {
        await reset();
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const lies = async (cookie: string = admin.cookie): Promise<AdminKarteneinstellungen> => {
        const response = await app.inject({ method: "GET", url: KARTENEINSTELLUNGEN_URL, headers: { cookie } });
        expect(response.statusCode).toBe(200);
        return response.json() as AdminKarteneinstellungen;
    };
    const setze = async (
        id: string,
        value: KartenWert | null | string,
        cookie = operator.cookie,
        baseRevision?: number,
    ): Promise<ReturnType<typeof app.inject>> =>
        app.inject({
            method: "POST",
            url: KARTENEINSTELLUNGEN_URL,
            payload: { operationId: randomUUID(), baseRevision: baseRevision ?? (await lies()).revision!, id, value },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const ereignisse = async (): Promise<{ key: string; from: unknown; to: unknown }[]> =>
        (
            await database<{ details: { key: string; from: unknown; to: unknown } }[]>`
                SELECT details FROM avesmaps_auth.security_event
                 WHERE environment = 'test' AND action = 'system.map_setting_changed'
                 ORDER BY id
            `
        ).map((row) => row.details);
    const oeffentlich = async (etag?: string) =>
        app.inject({
            method: "GET",
            url: MAP_SETTINGS_URL,
            headers: etag === undefined ? {} : { "if-none-match": etag },
        });

    it("🔴 ohne Abweichung: der Leseweg der Verwaltung ist leer, der öffentliche nennt die Vorgaben", async () => {
        const stand = await lies();
        expect(stand.source).toBe("database");
        expect(stand.rows).toEqual([]);
        expect(stand.revision).toBeGreaterThanOrEqual(1);
        const antwort = await oeffentlich();
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("no-cache");
        // Die öffentliche Antwort trägt keine Revision (sie zählte auch private Änderungen, WI-0180 §8).
        // Dazu die Werte der Wegfindung, die der Browser selbst anwendet (WI-0214): ohne Abweichung ihre Vorgaben.
        expect(antwort.json()).toEqual({
            revision: null,
            ...karteneinstellungVorgaben(),
            wegfindung: wegfindungImBrowser(wegfindungVorgaben()),
        });
    });

    it("🔴 verstellen: eine Zeile, höhere Revision, genau ein Ereignis, und der Kartenstart liest den neuen Wert", async () => {
        const vorher = await lies();
        const vorherEreignisse = (await ereignisse()).length;
        expect(code(await setze("startPosition", { x: 520, y: 500 }, operator.cookie, vorher.revision!))).toBe("200");
        expect(code(await setze("startZoom", 4))).toBe("200");
        const nachher = await lies();
        expect(nachher.rows).toEqual([
            expect.objectContaining({ id: "startPosition", value: { x: 520, y: 500 }, changedBy: "Rondrikan" }),
            expect.objectContaining({ id: "startZoom", value: 4, changedBy: "Rondrikan" }),
        ]);
        expect(nachher.revision!).toBe(vorher.revision! + 2);
        const neu = await ereignisse();
        expect(neu).toHaveLength(vorherEreignisse + 2);
        expect(neu.slice(-2)).toEqual([
            { key: "startPosition", from: null, to: { x: 520, y: 500 } },
            { key: "startZoom", from: null, to: 4 },
        ]);
        expect((await oeffentlich()).json()).toEqual({
            ...karteneinstellungVorgaben(),
            revision: null,
            startPosition: { x: 520, y: 500 },
            startZoom: 4,
            wegfindung: wegfindungImBrowser(wegfindungVorgaben()),
        });
        expect(wirksameKarteneinstellungen(await leseKarteneinstellungen(database)).startZoom).toBe(4);
    });

    it("🔴 Routenplaner: Name, Schalter, halbe Stunden und Reisebeginn gehen hinein und kommen öffentlich wieder heraus", async () => {
        const anderesMittel = TRANSPORTS_LAND.find((mittel) => mittel !== ROUTE_DEFAULTS.land)!;
        expect(code(await setze("planerLandTransport", anderesMittel))).toBe("200");
        expect(code(await setze("planerEiltempo", true))).toBe("200");
        expect(code(await setze("planerReisestunden", 10.5))).toBe("200");
        expect(code(await setze("planerReisebeginn", { monat: CALENDAR_MONTHS[2], tag: 12 }))).toBe("200");
        expect(code(await setze("planerReisestunden", 10.3))).toBe("400 value_out_of_range");
        expect(code(await setze("planerLandTransport", "Drachenreiter"))).toBe("400 value_out_of_range");
        expect(code(await setze("planerEiltempo", "ja"))).toBe("400 value_out_of_range");
        expect(code(await setze("planerEiltempo", true))).toBe("409 no_change");
        const oeffentlicheWerte = (await oeffentlich()).json() as MapSettings;
        expect(oeffentlicheWerte).toMatchObject({
            planerLandTransport: anderesMittel,
            planerEiltempo: true,
            planerReisestunden: 10.5,
            planerReisebeginn: { monat: CALENDAR_MONTHS[2], tag: 12 },
            planerUnterbringung: DEFAULT_LODGING,
        });
        // „Unbestimmt“ ist die Vorgabe: Es zu schicken setzt zurück, statt es zu speichern.
        expect(code(await setze("planerReisebeginn", "unbestimmt"))).toBe("200");
        expect((await lies()).rows.map((row) => row.id)).toEqual([
            "planerEiltempo",
            "planerLandTransport",
            "planerReisestunden",
        ]);
        expect((await ereignisse()).at(-1)).toEqual({
            key: "planerReisebeginn",
            from: { monat: CALENDAR_MONTHS[2], tag: 12 },
            to: null,
        });
    });

    it("🔴 PDF Exporter (WI-0306): Vorgaben „Jede Etappe“ und Reisetagebuch aus, ein Dateiname als Vorlage geht hinein und öffentlich heraus", async () => {
        const vorher = (await oeffentlich()).json() as MapSettings;
        expect(vorher).toMatchObject({
            pdfEtappenArt: "lang",
            pdfTagebuch: false,
            pdfDateiname: "",
            pdfKarte: "aktuell",
        });
        expect(code(await setze("pdfDateiname", "Avesmaps {von} bis {bis}"))).toBe("200");
        expect(code(await setze("pdfEtappenArt", "kurz"))).toBe("200");
        expect(code(await setze("pdfKarte", "dero:hoehenstufen"))).toBe("200");
        expect(code(await setze("pdfDateiname", "a/b"))).toBe("400 value_out_of_range");
        expect(code(await setze("pdfKarte", "serie:gibtsnicht"))).toBe("400 value_out_of_range");
        expect((await oeffentlich()).json() as MapSettings).toMatchObject({
            pdfDateiname: "Avesmaps {von} bis {bis}",
            pdfEtappenArt: "kurz",
            pdfKarte: "dero:hoehenstufen",
        });
        // Leer ist die Vorgabe: Es zu schicken setzt zurück.
        expect(code(await setze("pdfDateiname", ""))).toBe("200");
        expect((await lies()).rows.map((row) => row.id)).toEqual(["pdfEtappenArt", "pdfKarte"]);
    });

    it("🔴 der öffentliche Leseweg antwortet 304 auf dasselbe ETag und 200 nach einer Änderung", async () => {
        const erste = await oeffentlich();
        const etag = String(erste.headers["etag"]);
        expect((await oeffentlich(etag)).statusCode).toBe(304);
        expect(code(await setze("startZoom", 3))).toBe("200");
        const danach = await oeffentlich(etag);
        expect(danach.statusCode).toBe(200);
        expect((danach.json() as MapSettings).startZoom).toBe(3);
    });

    it("🔴 zurücksetzen löscht die Zeile; die Vorgabe zu schicken setzt ebenfalls zurück, statt sie zu speichern", async () => {
        expect(code(await setze("startZoom", 4))).toBe("200");
        expect(code(await setze("startZoom", null))).toBe("200");
        expect((await lies()).rows).toEqual([]);
        expect(code(await setze("startZoom", 4))).toBe("200");
        expect(code(await setze("startZoom", 2.5))).toBe("200");
        const [zeilen] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM map_setting`;
        expect(zeilen!.n).toBe(0);
        expect((await ereignisse()).at(-1)).toEqual({ key: "startZoom", from: 4, to: null });
        // Ein zweites Zurücksetzen ist keine Änderung und schreibt kein Ereignis.
        expect(code(await setze("startZoom", null))).toBe("409 no_change");
        expect(code(await setze("startPosition", { x: 518.75, y: 504 }))).toBe("409 no_change");
    });

    it("🔴 veraltete Revision 409, unbekannte Kennung 400, falsche Art oder außerhalb 400, derselbe Wert 409", async () => {
        const alt = (await lies()).revision!;
        expect(code(await setze("startZoom", 4, operator.cookie, alt))).toBe("200");
        expect(code(await setze("startZoom", 5, operator.cookie, alt))).toBe("409 edit_conflict");
        expect(code(await setze("gibtEsNicht", 1))).toBe("400 unknown_setting");
        expect(code(await setze("startZoom", 99))).toBe("400 value_out_of_range");
        expect(code(await setze("startZoom", { x: 1, y: 2 }))).toBe("400 value_out_of_range");
        expect(code(await setze("startPosition", 3))).toBe("400 value_out_of_range");
        expect(code(await setze("startPosition", { x: 2000, y: 500 }))).toBe("400 value_out_of_range");
        expect(code(await setze("startZoom", 4))).toBe("409 no_change");
        // Der Wert hat ein offenes Schema: Text, auch „3“ als Text, oder ein Punkt mit fremdem Feld prüft die Tafel und weist ab;
        // umgewandelt wird nichts. Eine Kennung außerhalb des Musters hält schon das Schema an.
        expect(code(await setze("startZoom", "drei"))).toBe("400 value_out_of_range");
        expect(code(await setze("startZoom", "3"))).toBe("400 value_out_of_range");
        expect(code(await setze("startPosition", { x: 1, y: 2, z: 3 } as never))).toBe("400 value_out_of_range");
        expect(code(await setze("Nicht Erlaubt", 1))).toBe("400 validation_failed");
        expect((await lies()).rows.map((row) => row.id)).toEqual(["startZoom"]);
    });

    it("🔴 Stufe S: wer nur den Betrieb liest, darf nicht verstellen (403), lesen aber schon", async () => {
        expect((await lies(admin.cookie)).source).toBe("database");
        expect((await setze("startZoom", 4, admin.cookie)).statusCode).toBe(403);
        expect((await lies()).rows).toEqual([]);
    });

    it("🔴 Systemsperre: Schreibklasse `system` antwortet 423, beide Lesewege bleiben offen", async () => {
        await database`
            UPDATE system_state
               SET system_lock = true, system_lock_since = now(), system_lock_reason = 'Wächter WI-0166' WHERE id = 1
        `;
        await app.systemState?.refresh();
        expect(code(await setze("startZoom", 4))).toBe("423 system_locked");
        expect((await lies()).rows).toEqual([]);
        expect((await oeffentlich()).statusCode).toBe(200);
    });

    it("gespeicherte Kennungen, die die Tafel nicht kennt, und Werte, die nicht passen, werden übergangen und gemeldet", async () => {
        await database`INSERT INTO map_setting (key, value) VALUES ('ausEinemSpaeterenRelease', '7'::jsonb)`;
        await database`INSERT INTO map_setting (key, value) VALUES ('startZoom', '{"x": 1, "y": 2}'::jsonb)`;
        const stand = await lies();
        expect(stand.rows).toEqual([]);
        expect(stand.unknownKeys).toEqual(["ausEinemSpaeterenRelease", "startZoom"]);
        expect(((await oeffentlich()).json() as MapSettings).startZoom).toBe(2.5);
    });

    it("ein Wert der falschen Art, von Hand am SQL abgelegt, gilt nicht: gemeldet, und die Vorgabe greift (0136 lockert die Tafel)", async () => {
        await database`INSERT INTO map_setting (key, value) VALUES ('startZoom', '"drei"'::jsonb)`;
        expect((await lies()).unknownKeys).toEqual(["startZoom"]);
        expect(((await oeffentlich()).json() as MapSettings).startZoom).toBe(2.5);
    });

    /**
     * Private Einstellungen (WI-0180 §8, die vier Bedingungen der Regel-Koordination): die Adresse von Lokal. Nur der Betreiber liest
     * und schreibt sie; ein Admin mit zugeteiltem `manage_system_settings` nicht. Öffentlich fehlt sie ganz, auch im ETag; im
     * Protokoll steht der Schlüssel, nie der Wert.
     */
    it("🔴 privat: nur der Betreiber, öffentlich unsichtbar auch im ETag, im Protokoll nur der Schlüssel", async () => {
        const NAME = "rechner-wi0180.tailnet-test.ts.net";
        const erste = await oeffentlich();
        const etag = String(erste.headers["etag"]);
        // Die Fixture gibt die Kennung mit; der Typ oben kennt nur das Cookie.
        const adminId = (admin as { cookie: string; id?: string }).id!;
        for (const capability of ["manage_system_settings", "switch_environment"])
            await database`
                INSERT INTO avesmaps_auth.capability_grant (person_id, environment, capability, reason)
                VALUES (${adminId}, 'test', ${capability}, 'Test WI-0180')
            `;
        try {
            // Mit dem zugeteilten Recht schreibt der Admin Öffentliches, Privates nicht.
            expect(code(await setze("lokalName", NAME, admin.cookie))).toBe("403 forbidden");
            expect(code(await setze("lokalName", NAME))).toBe("200");
            expect(code(await setze("lokalPort", 8443))).toBe("200");
            expect(code(await setze("lokalImMenue", "immer"))).toBe("200");
            expect(code(await setze("lokalName", "https://rechner.example.org"))).toBe("400 value_out_of_range");
            expect(code(await setze("lokalImMenue", "nie"))).toBe("400 value_out_of_range");
            // Öffentlich: dieselben Werte, dasselbe ETag, kein Feld und kein Wort davon.
            expect((await oeffentlich(etag)).statusCode).toBe(304);
            const oeffentlicherText = (await oeffentlich()).body;
            expect(oeffentlicherText).not.toContain("rechner-wi0180");
            expect(oeffentlicherText).not.toContain("lokal");
            // Verwaltung: Der Admin sieht weder Zeilen noch das Feld, der Betreiber alles unter `privat`.
            const beimAdmin = await lies(admin.cookie);
            expect(beimAdmin).not.toHaveProperty("privat");
            expect(JSON.stringify(beimAdmin)).not.toContain("rechner-wi0180");
            const beimBetreiber = await lies(operator.cookie);
            expect(beimBetreiber.rows).toEqual([]);
            expect(beimBetreiber.privat?.map((row) => [row.id, row.value])).toEqual([
                ["lokalImMenue", "immer"],
                ["lokalName", NAME],
                ["lokalPort", 8443],
            ]);
            // Protokoll: der Schlüssel ja, der Wert nie, auch nicht irgendwo im Ereignis.
            expect((await ereignisse()).slice(-3)).toEqual([
                { key: "lokalName", from: "privat", to: "privat" },
                { key: "lokalPort", from: "privat", to: "privat" },
                { key: "lokalImMenue", from: "privat", to: "privat" },
            ]);
            const [roh] = await database<{ text: string }[]>`
                SELECT string_agg(row_to_json(e)::text, ' ') AS text FROM avesmaps_auth.security_event e
                 WHERE environment = 'test' AND action = 'system.map_setting_changed'
            `;
            expect(roh?.text ?? "").not.toContain("rechner-wi0180");
        } finally {
            await database`DELETE FROM avesmaps_auth.capability_grant WHERE person_id = ${adminId} AND reason = 'Test WI-0180'`;
        }
    });
});
