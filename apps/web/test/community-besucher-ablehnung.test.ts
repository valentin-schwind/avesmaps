import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEWERTUNG_GRENZEN, COMMUNITY_GRENZEN } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import { kuerzeZeichen, neuesFormular, zeichenZahl } from "../src/community/api.ts";
import {
    BEWERTUNG_ABLEHNUNG,
    BEWERTUNG_MELDEN_ABLEHNUNG,
    GEFAELLT_ABLEHNUNG,
    KONTAKT_ABLEHNUNG,
    MELDUNG_ABLEHNUNG,
    besucherSatz,
    sperreUhr,
    statusAblehnung,
    type BesucherSaetze,
} from "../src/community/besucher-ablehnung.ts";
import {
    bewertungSperrGrund,
    bewertungsBody,
    leererBewertungsEntwurf,
    meldeSperrGrund,
} from "../src/community/bewertung-modell.ts";
import { kontaktBody, leererKontaktEntwurf, sperrGrund as kontaktSperrGrund } from "../src/community/kontakt-modell.ts";
import { setLocale, t } from "../src/i18n/i18n.ts";

/**
 * Die Sätze der Besucherfenster zu Ablehnungen des Servers (WI-0291; Vali 2026-11-08): Fachcode (`details.reason`) und Feld eines Schemafehlers werden zu einem Satz, der Grund UND Handlung nennt;
 * die Drossel nennt die Uhrzeit; ein 409 sagt den Zustand; die Längen zählt das Fenster wie der Server in Codepunkten. Erwartungen über `t(key, params)`, nicht über den Wortlaut.
 */

const reason = (status: number, code: string, grund: string): ApiFailure =>
    new ApiFailure(status, code, "Satz des Servers.", { reason: grund });
const schema = (...issues: [string, string][]): ApiFailure =>
    new ApiFailure(400, "validation_failed", "Die Anfrage ist unvollständig oder falsch geformt.", {
        issues: issues.map(([path, rule]) => ({ path, rule })),
    });

const SAETZE: BesucherSaetze = { zuViele: "community.fehler.zuViele", rueckfall: () => "ALLGEMEIN" };
const NACHRICHT = { min: COMMUNITY_GRENZEN.textMin, max: COMMUNITY_GRENZEN.textMax };

beforeEach(() => setLocale("de"));
afterEach(() => vi.useRealTimers());

describe("Kontakt", () => {
    it("Fachcodes der Datenbank: Nachricht, Name, Adresse, Thema", () => {
        const satz = (grund: string) =>
            besucherSatz(reason(422, "community_invalid", grund), KONTAKT_ABLEHNUNG, SAETZE);
        expect(satz("nachricht_laenge")).toBe(t("community.ablehnung.nachrichtLaenge", NACHRICHT));
        expect(satz("name_zu_lang")).toBe(t("community.ablehnung.nameLang", { max: COMMUNITY_GRENZEN.nameMax }));
        expect(satz("adresse_falsch")).toBe(t("community.ablehnung.adresseFalsch"));
        expect(satz("kategorie_unbekannt")).toBe(t("community.ablehnung.kategorieUnbekannt"));
    });

    it("Schemafehler am Feld: zu lange Nachricht und Adresse", () => {
        expect(besucherSatz(schema(["body/text", "maxLength"]), KONTAKT_ABLEHNUNG, SAETZE)).toBe(
            t("community.ablehnung.nachrichtLaenge", NACHRICHT),
        );
        expect(besucherSatz(schema(["body/mail", "pattern"]), KONTAKT_ABLEHNUNG, SAETZE)).toBe(
            t("community.ablehnung.adresseFalsch"),
        );
    });

    it("ein Schemafehler an unbekanntem Feld und 500 bleiben beim allgemeinen Satz des Fensters", () => {
        expect(besucherSatz(schema(["body/falle", "type"]), KONTAKT_ABLEHNUNG, SAETZE)).toBe("ALLGEMEIN");
        expect(besucherSatz(new ApiFailure(500, "internal", "Fehler."), KONTAKT_ABLEHNUNG, SAETZE)).toBe("ALLGEMEIN");
    });

    it("413: zu große Angaben sagen, was zu kürzen ist", () => {
        expect(besucherSatz(new ApiFailure(413, "payload_too_large", "Zu groß."), KONTAKT_ABLEHNUNG, SAETZE)).toBe(
            t("community.ablehnung.zuGross"),
        );
    });
});

describe("Meldung", () => {
    it("Beschreibung und Bezug aus der Datenbank, Quelle aus dem Schema", () => {
        expect(besucherSatz(reason(422, "community_invalid", "beschreibung_laenge"), MELDUNG_ABLEHNUNG, SAETZE)).toBe(
            t("community.ablehnung.beschreibungLaenge", NACHRICHT),
        );
        expect(
            besucherSatz(reason(422, "community_invalid", "schluessel_bezug_fehlt"), MELDUNG_ABLEHNUNG, SAETZE),
        ).toBe(t("community.ablehnung.bezugFehlt"));
        expect(besucherSatz(schema(["body/quelle", "maxLength"]), MELDUNG_ABLEHNUNG, SAETZE)).toBe(
            t("community.ablehnung.quelleLang", { max: COMMUNITY_GRENZEN.quelleMax }),
        );
    });
});

describe("Statusseite: 409 nennt den Zustand", () => {
    it("zurückgezogen und abgeschlossen, mit den Wörtern der Meldung beziehungsweise der Nachricht", () => {
        const zurueck = reason(409, "community_transition", "meldung_zurueckgezogen");
        const fertig = reason(409, "community_transition", "vorgang_abgeschlossen");
        expect(besucherSatz(zurueck, statusAblehnung(false), SAETZE)).toBe(t("community.ablehnung.zurueckgezogen"));
        expect(besucherSatz(zurueck, statusAblehnung(true), SAETZE)).toBe(
            t("community.ablehnung.zurueckgezogenAnfrage"),
        );
        expect(besucherSatz(fertig, statusAblehnung(false), SAETZE)).toBe(t("community.ablehnung.abgeschlossen"));
        expect(besucherSatz(fertig, statusAblehnung(true), SAETZE)).toBe(t("community.ablehnung.abgeschlossenAnfrage"));
    });

    it("die Antwort: zu lang aus dem Schema", () => {
        expect(besucherSatz(schema(["body/text", "maxLength"]), statusAblehnung(false), SAETZE)).toBe(
            t("community.ablehnung.antwortLang", { max: COMMUNITY_GRENZEN.nachrichtMax }),
        );
    });
});

describe("Drossel (429): mit Uhrzeit, nie der Platzhalter", () => {
    it("Discord und „Gefällt mir“ nennen die Uhrzeit aus retryAfterSeconds", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
        const rate = new ApiFailure(429, "rate_limited", "Zu viele Versuche.", { retryAfterSeconds: 60 });
        const uhr = sperreUhr(rate);
        expect(uhr).not.toBe("");
        const discord = besucherSatz(rate, {}, { zuViele: "community.ablehnung.discordZuViele", rueckfall: () => "X" });
        expect(discord).toBe(t("community.ablehnung.discordZuViele", { uhr }));
        expect(discord).not.toContain("{uhr}");

        const stunde = new ApiFailure(429, "community_rate", "Zu viele.", { retryAfterSeconds: 3600 });
        const gefaellt = besucherSatz(stunde, GEFAELLT_ABLEHNUNG, {
            zuViele: "bewertungen.ablehnung.gefaelltZuViele",
            rueckfall: () => "X",
        });
        expect(gefaellt).toBe(t("bewertungen.ablehnung.gefaelltZuViele", { uhr: sperreUhr(stunde) }));
        expect(gefaellt).not.toContain("{uhr}");
    });
});

describe("Bewertung schreiben", () => {
    it("Codes der Datenbank und das Datum aus TypeScript", () => {
        const satz = (grund: string) =>
            besucherSatz(reason(422, "community_invalid", grund), BEWERTUNG_ABLEHNUNG, SAETZE);
        expect(satz("sterne")).toBe(t("bewertungen.ablehnung.sterne"));
        expect(satz("text_zu_lang")).toBe(t("bewertungen.ablehnung.textLang", { max: BEWERTUNG_GRENZEN.textMax }));
        expect(satz("datum_zu_lang")).toBe(t("bewertungen.ablehnung.datumLang", { max: BEWERTUNG_GRENZEN.datumMax }));
        expect(satz("datum_ungueltig")).toBe(t("bewertungen.ablehnung.datumUngueltig"));
        expect(besucherSatz(reason(404, "community_not_found", "ort_unbekannt"), BEWERTUNG_ABLEHNUNG, SAETZE)).toBe(
            t("bewertungen.ablehnung.ortFehlt"),
        );
    });
});

describe("Bewertung melden: eigener Rückfall, nur eigene Felder", () => {
    it("Grund und Beschreibung", () => {
        const satz = (grund: string) =>
            besucherSatz(reason(422, "community_invalid", grund), BEWERTUNG_MELDEN_ABLEHNUNG, SAETZE);
        expect(satz("grund_fehlt")).toBe(t("bewertungen.ablehnung.grundFehlt"));
        expect(satz("beschreibung_zu_lang")).toBe(
            t("bewertungen.ablehnung.beschreibungLang", { max: BEWERTUNG_GRENZEN.beschreibungMax }),
        );
        expect(besucherSatz(schema(["body/grund", "enum"]), BEWERTUNG_MELDEN_ABLEHNUNG, SAETZE)).toBe(
            t("bewertungen.ablehnung.grundFehlt"),
        );
    });
});

describe("„Gefällt mir“", () => {
    it("422 und 404 haben eigene Sätze, alles Übrige den allgemeinen", () => {
        expect(besucherSatz(reason(422, "community_invalid", "gefaellt_schritt"), GEFAELLT_ABLEHNUNG, SAETZE)).toBe(
            t("bewertungen.ablehnung.gefaelltSchritt"),
        );
        expect(
            besucherSatz(reason(404, "community_not_found", "bewertung_unbekannt"), GEFAELLT_ABLEHNUNG, SAETZE),
        ).toBe(t("bewertungen.ablehnung.gefaelltFehlt"));
        expect(besucherSatz(new ApiFailure(0, "network", "weg"), GEFAELLT_ABLEHNUNG, SAETZE)).toBe("ALLGEMEIN");
    });
});

describe("Längen zählen in Codepunkten wie der Server", () => {
    const emoji = String.fromCodePoint(0x1f600);

    it("ein Emoji ist ein Zeichen; Kürzen schneidet keines durch", () => {
        expect(emoji.length).toBe(2);
        expect(zeichenZahl(emoji.repeat(5))).toBe(5);
        expect(kuerzeZeichen(emoji.repeat(5), 3)).toBe(emoji.repeat(3));
        expect(kuerzeZeichen("abc", 5)).toBe("abc");
    });

    it("Kontakt: 2000 Emojis (4000 UTF-16-Einheiten) sind erlaubt, 2001 nicht", () => {
        const entwurf = { ...leererKontaktEntwurf(), text: emoji.repeat(COMMUNITY_GRENZEN.textMax) };
        expect(kontaktSperrGrund(entwurf)).toBeUndefined();
        expect(kontaktBody(neuesFormular(), entwurf, 5000).text).toBe(entwurf.text);
        expect(kontaktSperrGrund({ ...entwurf, text: entwurf.text + emoji })).toBe("community.kontakt.sperre.textLang");
    });

    it("Bewertung: 200 Emojis sind erlaubt, 201 nicht; der Name wird nicht mitten im Zeichen gekürzt", () => {
        const entwurf = { ...leererBewertungsEntwurf(4), text: emoji.repeat(BEWERTUNG_GRENZEN.textMax) };
        expect(bewertungSperrGrund(entwurf)).toBeUndefined();
        expect(bewertungSperrGrund({ ...entwurf, text: entwurf.text + emoji })).toBe(
            "bewertungen.schreiben.sperre.text",
        );
        const body = bewertungsBody(neuesFormular(), "ort", { ...entwurf, name: emoji.repeat(100) }, 5000);
        expect(zeichenZahl(body.name ?? "")).toBe(BEWERTUNG_GRENZEN.nameMax);
        expect([...(body.name ?? "")].every((z) => z === emoji)).toBe(true);
    });

    it("Bewertung melden: Beschreibung in Codepunkten", () => {
        const text = emoji.repeat(BEWERTUNG_GRENZEN.beschreibungMax);
        expect(meldeSperrGrund({ grund: "spam", text, honig: "" })).toBeUndefined();
        expect(meldeSperrGrund({ grund: "spam", text: text + emoji, honig: "" })).toBe(
            "bewertungen.melden.sperre.text",
        );
    });
});
