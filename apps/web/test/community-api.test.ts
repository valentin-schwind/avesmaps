import { afterEach, describe, expect, it } from "vitest";
import { STATUS_SCHLUESSEL_MUSTER, UUID_PATTERN } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import {
    FEHLER_SATZ,
    fehlerArt,
    istSchluessel,
    ladeStand,
    leseStatus,
    neuerSchluessel,
    neuesFormular,
    sendeAntwort,
    sendeMeldung,
    sperreBis,
    statusAdresse,
    ziehZurueck,
    type FehlerArt,
} from "../src/community/api.ts";
import { de } from "../src/i18n/de.ts";
import { setLocale } from "../src/i18n/i18n.ts";

/**
 * Die Besucherseite der Meldungen an der Leitung (WI-0268 C2): Schlüssel im Browser, eine Kennung je Formular, Fehlercode → Satz, nie der Text des Servers.
 */

afterEach(() => setLocale("de"));

const KENNUNG = "11111111-2222-4333-8444-555555555555";
const SCHLUESSEL = "A".repeat(43);

/** Ein Aufruf, den der Browser gemacht hat: Adresse und gesendeter Rumpf. */
interface Aufruf {
    url: string;
    methode: string;
    body: unknown;
}

function holer(antworten: (Response | Error)[]): { fetcher: typeof fetch; aufrufe: Aufruf[] } {
    const aufrufe: Aufruf[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
        aufrufe.push({
            url: String(url),
            methode: init?.method ?? "GET",
            body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        const naechste = antworten.shift();
        if (naechste === undefined) throw new Error("keine Antwort vorbereitet");
        if (naechste instanceof Error) throw naechste;
        return naechste;
    }) as typeof fetch;
    return { fetcher, aufrufe };
}

const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fehler = (status: number, code: string, details?: Record<string, unknown>): Response =>
    json(status, { error: { code, message: "Text des Servers, der nie erscheint", ...(details ? { details } : {}) } });

describe("🔴 der Schlüssel der Statusseite entsteht im Browser", () => {
    it("32 Zufallsbytes als base64url ohne Auffüllung: genau 43 Zeichen, nur das Alphabet des Musters", () => {
        for (let i = 0; i < 50; i += 1) {
            const schluessel = neuerSchluessel();
            expect(schluessel).toHaveLength(43);
            expect(schluessel).toMatch(new RegExp(STATUS_SCHLUESSEL_MUSTER, "u"));
            expect(istSchluessel(schluessel)).toBe(true);
        }
    });

    it("kein „+“, „/“ oder „=“: auch Bytes, die in base64 genau diese Zeichen ergeben, werden zu „-“ und „_“", () => {
        const schluessel = neuerSchluessel((bytes) => bytes.fill(0xfb));
        expect(schluessel).toHaveLength(43);
        expect(schluessel).not.toMatch(/[+/=]/u);
        expect(schluessel).toContain("-");
        const unterstrich = neuerSchluessel((bytes) => bytes.fill(0xff));
        expect(unterstrich).toBe("_".repeat(42) + "8");
        expect(unterstrich).toMatch(new RegExp(STATUS_SCHLUESSEL_MUSTER, "u"));
    });

    it("zwei Schlüssel sind verschieden, und ein verstümmelter ist keiner", () => {
        expect(neuerSchluessel()).not.toBe(neuerSchluessel());
        expect(istSchluessel("zu-kurz")).toBe(false);
        expect(istSchluessel(`${SCHLUESSEL}A`)).toBe(false);
        expect(istSchluessel(`${"A".repeat(42)}+`)).toBe(false);
    });

    it("🔴 die Adresse trägt ihn im Fragment, nie in der Suche", () => {
        const adresse = statusAdresse("https://avesmaps.test", SCHLUESSEL);
        expect(adresse).toBe(`https://avesmaps.test/meldung#${SCHLUESSEL}`);
        expect(new URL(adresse).search).toBe("");
    });
});

describe("🔴 eine Kennung je Formular, nicht je Versuch (ADR-0019)", () => {
    it("ein Formular hat eine UUID und einen Schlüssel, ein zweites hat andere", () => {
        const eins = neuesFormular();
        const zwei = neuesFormular();
        expect(eins.operationId).toMatch(new RegExp(UUID_PATTERN, "u"));
        expect(istSchluessel(eins.schluessel)).toBe(true);
        expect(zwei.operationId).not.toBe(eins.operationId);
        expect(zwei.schluessel).not.toBe(eins.schluessel);
    });

    it("🔴 Netz weg, dann erneut gesendet: beide Anfragen tragen dieselbe Kennung und denselben Schlüssel", async () => {
        const kennung = neuesFormular();
        const body = {
            operationId: kennung.operationId,
            schluessel: kennung.schluessel,
            kategorie: "fehlt" as const,
            text: "Hier fehlt ein Dorf am Fluss.",
            bezug: { art: "stelle" as const, lage: { x: 10, y: 20 } },
            falle: { feld: "", dauerMs: 9000 },
        };
        const { fetcher, aufrufe } = holer([new TypeError("fetch failed"), json(201, { nummer: "COM-000042" })]);
        const erster = await sendeMeldung(body, fetcher).catch((e: unknown) => e);
        expect(fehlerArt(erster)).toBe("netz");
        const zweiter = await sendeMeldung(body, fetcher);
        expect(zweiter).toEqual({ nummer: "COM-000042" });
        expect(aufrufe).toHaveLength(2);
        expect(aufrufe[0]?.body).toEqual(aufrufe[1]?.body);
        expect(aufrufe[1]?.url).toBe("/api/community/meldungen");
        expect((aufrufe[1]?.body as typeof body).operationId).toBe(kennung.operationId);
        expect((aufrufe[1]?.body as typeof body).schluessel).toBe(kennung.schluessel);
    });
});

describe("die Aufrufe", () => {
    it("🔴 die Statusseite fragt per POST: der Schlüssel steht im Rumpf, nie in der Adresse", async () => {
        const sicht = { nummer: "COM-000042", zustand: "neu" };
        const { fetcher, aufrufe } = holer([json(200, sicht)]);
        expect(await leseStatus(SCHLUESSEL, fetcher)).toEqual(sicht);
        expect(aufrufe[0]).toEqual({ url: "/api/community/status", methode: "POST", body: { schluessel: SCHLUESSEL } });
        expect(aufrufe[0]?.url).not.toContain(SCHLUESSEL);
    });

    it("Antwort und Zurückziehen gehen an ihre Wege und tragen Kennung und Schlüssel", async () => {
        const { fetcher, aufrufe } = holer([
            json(200, { nummer: "COM-000042", revision: 3 }),
            json(200, { nummer: "COM-000042", revision: 4 }),
        ]);
        await sendeAntwort({ operationId: KENNUNG, schluessel: SCHLUESSEL, text: "Hier die Quelle." }, fetcher);
        await ziehZurueck({ operationId: KENNUNG, schluessel: SCHLUESSEL }, fetcher);
        expect(aufrufe.map((a) => a.url)).toEqual([
            "/api/community/status/antwort",
            "/api/community/status/zurueckziehen",
        ]);
        expect(aufrufe[0]?.body).toEqual({ operationId: KENNUNG, schluessel: SCHLUESSEL, text: "Hier die Quelle." });
        expect(aufrufe[1]?.body).toEqual({ operationId: KENNUNG, schluessel: SCHLUESSEL });
    });

    it("der Stand: „geht“ nur bei einem klaren Ja; eine fehlende Antwort ist ein Nein, nie ein Fehler im Formular", async () => {
        expect(await ladeStand(holer([json(200, { meldungen: true })]).fetcher)).toBe(true);
        expect(await ladeStand(holer([json(200, { meldungen: false })]).fetcher)).toBe(false);
        expect(await ladeStand(holer([fehler(503, "community_unavailable")]).fetcher)).toBe(false);
        expect(await ladeStand(holer([new TypeError("offline")]).fetcher)).toBe(false);
    });
});

describe("🔴 Fehlercode → Satz der Oberfläche (ADR-0018), nie der Text des Servers", () => {
    const abbildung: [string, number, string, FehlerArt][] = [
        ["Netz weg", 0, "network", "netz"],
        ["Drossel", 429, "community_rate", "zu_viele"],
        ["Modul nicht eingerichtet", 503, "community_unavailable", "nicht_moeglich"],
        ["Angaben abgewiesen", 422, "community_invalid", "ungueltig"],
        ["Rumpf unlesbar", 400, "validation_failed", "ungueltig"],
        ["unbekannter Schlüssel", 404, "community_not_found", "nicht_gefunden"],
        ["fremde Herkunft", 403, "forbidden_origin", "sonst"],
        ["Serverfehler", 500, "unavailable", "sonst"],
    ];

    it.each(abbildung)("%s (%s %s) → %s", (_name, status, code, art) => {
        expect(fehlerArt(new ApiFailure(status, code, "Text des Servers"))).toBe(art);
    });

    it("ein 429 ohne bekannten Code zählt trotzdem als Drossel, ein 503 als „nicht möglich“", () => {
        expect(fehlerArt(new ApiFailure(429, "rate_limited", ""))).toBe("zu_viele");
        expect(fehlerArt(new ApiFailure(503, "database_unavailable", ""))).toBe("nicht_moeglich");
    });

    it("ein Fehler, der keiner der Leitung ist, ist „sonst“", () => {
        expect(fehlerArt(new Error("kaputt"))).toBe("sonst");
        expect(fehlerArt(undefined)).toBe("sonst");
    });

    it("jede Art hat einen Satz in der deutschen Tafel", () => {
        for (const key of Object.values(FEHLER_SATZ)) expect(de[key], key).toBeTypeOf("string");
    });

    it("🔴 über die Leitung: der Satz kommt aus der Tafel, nie aus dem Umschlag", async () => {
        const { fetcher } = holer([fehler(429, "community_rate", { retryAfterSeconds: 3600 })]);
        const e = await sendeMeldung(
            {
                operationId: KENNUNG,
                schluessel: SCHLUESSEL,
                kategorie: "sonstiges",
                text: "Etwas stimmt nicht.",
                bezug: { art: "stelle", lage: { x: 1, y: 2 } },
                falle: { feld: "", dauerMs: 5000 },
            },
            fetcher,
        ).catch((x: unknown) => x);
        expect(fehlerArt(e)).toBe("zu_viele");
        expect(de[FEHLER_SATZ[fehlerArt(e)]]).not.toContain("Text des Servers");
    });
});

describe("die Uhrzeit nach einer Drossel", () => {
    const jetzt = new Date("2026-10-31T12:00:00Z");

    it("der Server nennt die Sekunden; die Oberfläche rechnet die Uhrzeit", () => {
        const bis = sperreBis(new ApiFailure(429, "community_rate", "", { retryAfterSeconds: 1800 }), jetzt);
        expect(bis?.toISOString()).toBe("2026-10-31T12:30:00.000Z");
    });

    it("ohne Angabe gilt eine Stunde (die Drossel rechnet je Stunde)", () => {
        expect(sperreBis(new ApiFailure(429, "community_rate", ""), jetzt)?.toISOString()).toBe(
            "2026-10-31T13:00:00.000Z",
        );
    });

    it("nur eine Drossel hat eine Uhrzeit", () => {
        expect(sperreBis(new ApiFailure(503, "community_unavailable", ""), jetzt)).toBeUndefined();
        expect(sperreBis(new Error("x"), jetzt)).toBeUndefined();
    });
});
