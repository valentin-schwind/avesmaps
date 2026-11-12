import { Value } from "@sinclair/typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { COMMUNITY_GRENZEN, KONTAKT_THEMEN, KontaktBody } from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import { FEHLER_SATZ, fehlerArt, neuesFormular, sendeKontakt } from "../src/community/api.ts";
import { createBesucherSteuerung } from "../src/community/community-besucher.ts";
import {
    KONTAKT_KATEGORIEN,
    kontaktBody,
    leererKontaktEntwurf,
    mailGueltig,
    sperrFeld,
    sperrGrund,
    type KontaktEntwurf,
} from "../src/community/kontakt-modell.ts";
import { de } from "../src/i18n/de.ts";
import { setLocale } from "../src/i18n/i18n.ts";

/**
 * Das Kontaktformular ohne Browser (WI-0268 C4; Bedienkonzept §3.1): Pflichtfelder samt Grund der Sperre, der Rumpf der Anfrage (gegen das Schema des Servers), der Aufruf an die Leitung und die Steuerung,
 * die EIN Fenster der Besucher hält.
 */

afterEach(() => setLocale("de"));

const entwurf = (teil: Partial<KontaktEntwurf> = {}): KontaktEntwurf => ({
    kategorie: "frage",
    text: "Darf die Karte in einem Spielleiterhandbuch erscheinen?",
    name: "",
    mail: "",
    honig: "",
    ...teil,
});

describe("der Anfang des Formulars", () => {
    it("„Frage“ ist vorgewählt, alles andere beginnt leer, auch das Honigtopf-Feld", () => {
        expect(leererKontaktEntwurf()).toEqual({ kategorie: "frage", text: "", name: "", mail: "", honig: "" });
    });

    it("die sechs Themen des Formulars, jedes mit Name und Einladung in der Tafel; Rechte und Datenschutz bietet es nicht an", () => {
        expect(KONTAKT_KATEGORIEN.map((k) => k.wert)).toEqual([...KONTAKT_THEMEN]);
        expect(KONTAKT_THEMEN).toEqual(["frage", "hinweis", "mitmachen", "lob", "allgemein", "problem"]);
        for (const thema of KONTAKT_KATEGORIEN) {
            expect(de[thema.key], thema.key).toBeTypeOf("string");
            expect(de[thema.einladung], thema.einladung).toBeTypeOf("string");
        }
    });

    it("der gesperrte Knopf führt zum Feld, das fehlt", () => {
        expect(sperrFeld(entwurf())).toBeUndefined();
        expect(sperrFeld(entwurf({ text: "" }))).toBe("text");
        expect(sperrFeld(entwurf({ text: "x".repeat(COMMUNITY_GRENZEN.textMax + 1) }))).toBe("text");
        expect(sperrFeld(entwurf({ mail: "kaputt" }))).toBe("mail");
    });
});

describe("🔴 Senden ist gesperrt, solange Pflichtfelder fehlen - mit dem Grund (Guide §13.19)", () => {
    it("die Nachricht zählt getrimmt: 10 bis 2000 Zeichen", () => {
        expect(sperrGrund(entwurf({ text: "" }))).toBe("community.kontakt.sperre.text");
        expect(sperrGrund(entwurf({ text: "   zu kurz   " }))).toBe("community.kontakt.sperre.text");
        expect(sperrGrund(entwurf({ text: "x".repeat(COMMUNITY_GRENZEN.textMin) }))).toBeUndefined();
        expect(sperrGrund(entwurf({ text: "x".repeat(COMMUNITY_GRENZEN.textMax) }))).toBeUndefined();
        expect(sperrGrund(entwurf({ text: "x".repeat(COMMUNITY_GRENZEN.textMax + 1) }))).toBe(
            "community.kontakt.sperre.textLang",
        );
    });

    it("ohne Kategorie geht nichts; die Reihenfolge ist die des Formulars: Kategorie, Nachricht, Adresse", () => {
        expect(sperrGrund(entwurf({ kategorie: "", text: "" }))).toBe("community.kontakt.sperre.kategorie");
        expect(sperrGrund(entwurf({ text: "", mail: "kaputt" }))).toBe("community.kontakt.sperre.text");
        expect(sperrGrund(entwurf({ mail: "kaputt" }))).toBe("community.kontakt.sperre.mail");
    });

    it("Name und Adresse sind freiwillig: leer sperrt nichts, eine schlichte Adresse auch nicht, eine kaputte schon", () => {
        expect(sperrGrund(entwurf({ name: "", mail: "" }))).toBeUndefined();
        expect(sperrGrund(entwurf({ mail: "alrike@example.org" }))).toBeUndefined();
        expect(sperrGrund(entwurf({ mail: "  alrike@example.org  " }))).toBeUndefined();
        for (const falsch of ["alrike", "alrike@", "@example.org", "alrike@example", "a b@example.org", "a@b@c.de"]) {
            expect(mailGueltig(falsch), falsch).toBe(false);
        }
        expect(mailGueltig("a".repeat(250) + "@b.de")).toBe(false);
    });

    it("jeder Grund hat einen Satz in der Tafel", () => {
        for (const teil of [{ kategorie: "" as const }, { text: "" }, { text: "x".repeat(2001) }, { mail: "kaputt" }]) {
            const grund = sperrGrund(entwurf(teil));
            expect(grund).toBeDefined();
            expect(de[grund!], String(grund)).toBeTypeOf("string");
        }
    });
});

describe("der Rumpf der Anfrage", () => {
    it("🔴 gilt für den Server: er besteht das Schema der Route", () => {
        const kennung = neuesFormular();
        const body = kontaktBody(kennung, entwurf({ name: "Alrike", mail: "alrike@example.org" }), 5400);
        expect(Value.Check(KontaktBody, body)).toBe(true);
        const ohne = kontaktBody(kennung, entwurf(), 5400);
        expect(Value.Check(KontaktBody, ohne)).toBe(true);
    });

    it("🔴 Kennung und Schlüssel sind die des Formulars; Honigtopf und Zeit gehen mit", () => {
        const kennung = neuesFormular();
        const body = kontaktBody(kennung, entwurf({ honig: "spam" }), 4321.7);
        expect(body.operationId).toBe(kennung.operationId);
        expect(body.schluessel).toBe(kennung.schluessel);
        expect(body.falle).toEqual({ feld: "spam", dauerMs: 4322 });
        expect(kontaktBody(kennung, entwurf(), -5).falle.dauerMs).toBe(0);
    });

    it("leere Felder fehlen im Rumpf; Text, Name und Adresse sind getrimmt, der Name ist gekürzt", () => {
        const kennung = neuesFormular();
        const leer = kontaktBody(kennung, entwurf({ text: "  Eine Frage zur Karte.  " }), 4000);
        expect(leer).not.toHaveProperty("name");
        expect(leer).not.toHaveProperty("mail");
        expect(leer.text).toBe("Eine Frage zur Karte.");
        const voll = kontaktBody(
            kennung,
            entwurf({ name: ` ${"N".repeat(200)} `, mail: "  Alrike@Example.org " }),
            4000,
        );
        expect(voll.name).toHaveLength(COMMUNITY_GRENZEN.nameMax);
        expect(voll.mail).toBe("Alrike@Example.org");
    });

    it("🔴 ein unvollständiges Formular baut keinen Rumpf", () => {
        expect(() => kontaktBody(neuesFormular(), entwurf({ text: "kurz" }), 4000)).toThrow();
        expect(() => kontaktBody(neuesFormular(), entwurf({ kategorie: "" }), 4000)).toThrow();
        expect(() => kontaktBody(neuesFormular(), entwurf({ mail: "kaputt" }), 4000)).toThrow();
    });
});

describe("der Aufruf an die Leitung", () => {
    it("🔴 geht als POST an /api/community/anfragen und gibt die COM-Nummer zurück", async () => {
        const aufrufe: { url: string; methode: string; body: unknown }[] = [];
        const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
            aufrufe.push({
                url: String(url),
                methode: init?.method ?? "GET",
                body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
            });
            return new Response(JSON.stringify({ nummer: "COM-000124" }), {
                status: 201,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;
        const body = kontaktBody(neuesFormular(), entwurf(), 4000);
        const antwort = await sendeKontakt(body, fetcher);
        expect(antwort).toEqual({ nummer: "COM-000124" });
        expect(aufrufe).toHaveLength(1);
        expect(aufrufe[0]).toMatchObject({ url: "/api/community/anfragen", methode: "POST" });
        expect(aufrufe[0]!.body).toEqual(body);
    });

    it("Fehlercodes wählen die Sätze der Oberfläche, nie den Text des Servers", () => {
        const fehler = (status: number, code: string) => new ApiFailure(status, code, "Text des Servers", undefined);
        expect(fehlerArt(fehler(429, "community_rate"))).toBe("zu_viele");
        expect(fehlerArt(fehler(422, "community_invalid"))).toBe("ungueltig");
        expect(fehlerArt(fehler(503, "community_unavailable"))).toBe("nicht_moeglich");
        expect(fehlerArt(new ApiFailure(0, "network", "", undefined))).toBe("netz");
        for (const key of Object.values(FEHLER_SATZ)) expect(de[key], key).toBeTypeOf("string");
    });
});

describe("die Steuerung der Besucherfenster", () => {
    const keinOrt = async (): Promise<undefined> => undefined;

    it("🔴 das Kontaktformular ist EIN Fenster: Öffnen ersetzt das offene Fenster, ein zweiter Aufruf lässt den Text stehen", () => {
        const s = createBesucherSteuerung({ naechsterOrt: keinOrt });
        s.oeffneStatus("A".repeat(43));
        s.oeffneKontakt();
        const erste = s.anzeige.value;
        expect(erste).toMatchObject({ art: "kontakt" });
        s.oeffneKontakt();
        expect(s.anzeige.value).toBe(erste);
        s.oeffneStatus("B".repeat(43));
        expect(s.anzeige.value).toMatchObject({ art: "status" });
        s.oeffneKontakt();
        expect(s.anzeige.value?.nr).not.toBe(erste?.nr);
    });

    it("die Lage bleibt, wie sie war; Schließen räumt, und das Fenster ist angedockt, solange es offen ist", () => {
        const s = createBesucherSteuerung({ naechsterOrt: keinOrt });
        s.setzeLage("geloest", { left: 10, top: 20, width: 520, height: 300 });
        s.oeffneKontakt();
        expect(s.fenster.value).toEqual({ lage: "geloest", box: { left: 10, top: 20, width: 520, height: 300 } });
        expect(s.angedockt.value).toBe(false);
        s.setzeLage("angedockt");
        expect(s.angedockt.value).toBe(true);
        s.schliesse();
        expect(s.anzeige.value).toBeUndefined();
        expect(s.angedockt.value).toBe(false);
    });
});
