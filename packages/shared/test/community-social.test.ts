import { describe, expect, it } from "vitest";
import {
    KANAL_KONTEXT_VORGABE,
    SocialKanalStand,
    SocialZiel,
    bereinigeHashtags,
    kanalKontext,
    leseSoc,
    pruefeBeitrag,
    socNummer,
    type SocialKanalStand as KanalStand,
} from "../src/index.ts";
import { Value } from "@sinclair/typebox/value";

/** Der Vertrag des Social Hubs (WI-0270 C11): Nummern, Hashtags und die Prüfung, die Fenster und Server gleich rufen. */
describe("SOC-Nummern", () => {
    it("sechs Stellen wie COM-, und zurück", () => {
        expect(socNummer(12)).toBe("SOC-000012");
        expect(leseSoc("SOC-000012")).toBe(12);
        expect(leseSoc("soc-12")).toBe(12);
        expect(leseSoc("12")).toBe(12);
        expect(leseSoc("SOC-0")).toBeUndefined();
        expect(leseSoc("COM-000012")).toBeUndefined();
        expect(leseSoc("")).toBeUndefined();
    });
});

describe("Hashtags", () => {
    it("setzt das # davor, wirft Ungültiges und Doppelte (ohne Rücksicht auf die Schreibweise) weg", () => {
        expect(
            bereinigeHashtags(["Aventurien", "#DSA", "#dsa", " #Über ", "#", "#mit leer", "##Karte", "#a-b"]),
        ).toEqual(["#Aventurien", "#DSA", "#Über", "#Karte"]);
    });

    it("höchstens zehn", () => {
        const viele = Array.from({ length: 30 }, (_, i) => `#t${String(i)}`);
        expect(bereinigeHashtags(viele)).toHaveLength(10);
    });
});

describe("pruefeBeitrag: der Grund, der Vorlegen und Freigeben sperrt", () => {
    const gut = { titel: "Neu", text: "Etwas ist neu.", hashtags: [], kanaele: ["neuigkeiten"] as const };

    it("ein vollständiger Beitrag geht", () => {
        expect(pruefeBeitrag(gut)).toBeNull();
    });

    it("kein Kanal, ein Kanal ohne Verbindung, kein Text, keine Titelzeile", () => {
        expect(pruefeBeitrag({ ...gut, kanaele: [] })).toEqual({ art: "kein_kanal" });
        expect(pruefeBeitrag({ ...gut, kanaele: ["neuigkeiten", "mastodon"] })).toEqual({
            art: "kanal_nicht_verbunden",
            kanal: "mastodon",
        });
        expect(pruefeBeitrag({ ...gut, text: "   " })).toEqual({ art: "text_fehlt" });
        expect(pruefeBeitrag({ ...gut, titel: " " })).toEqual({ art: "titel_fehlt" });
        expect(pruefeBeitrag({ ...gut, titel: null })).toEqual({ art: "titel_fehlt" });
    });

    it("zu lang: der Kanal, der Teil und wie viel zu viel", () => {
        expect(pruefeBeitrag({ ...gut, text: "a".repeat(4003) })).toEqual({
            art: "zu_lang",
            kanal: "neuigkeiten",
            zuviel: 3,
            teil: "text",
        });
        expect(pruefeBeitrag({ ...gut, titel: "T".repeat(201) })).toEqual({
            art: "zu_lang",
            kanal: "neuigkeiten",
            zuviel: 1,
            teil: "titel",
        });
    });

    it("ein Bild verlangt eine Bildbeschreibung und ein geklärtes Medium", () => {
        const bild = "11111111-1111-4111-8111-111111111111";
        expect(pruefeBeitrag({ ...gut, bild })).toEqual({ art: "beschreibung_fehlt" });
        expect(pruefeBeitrag({ ...gut, bild, bildBeschreibung: "  " })).toEqual({ art: "beschreibung_fehlt" });
        expect(pruefeBeitrag({ ...gut, bild, bildBeschreibung: "Eine Karte", bildGeklaert: false })).toEqual({
            art: "bild_nicht_geklaert",
        });
        expect(pruefeBeitrag({ ...gut, bild, bildBeschreibung: "Eine Karte", bildGeklaert: true })).toBeNull();
    });
});

describe("Kanäle mit Zugang: Kontext aus dem Stand des Servers (WI-0268 C12a)", () => {
    const grenzen = {
        zeichen: 800,
        adresse: 30,
        bilder: 4,
        beschreibung: 1500,
        bildBytes: 16_777_216,
        bildTypen: ["image/webp"],
    };
    const stand = (patch: Partial<KanalStand> = {}): KanalStand => ({
        kanal: "mastodon",
        eingerichtet: true,
        freigeschaltet: true,
        freigeschaltetAt: "2026-11-01T10:00:00.000Z",
        notschalter: false,
        grenzen,
        grenzenAt: "2026-11-01T09:00:00.000Z",
        bereit: true,
        sperre: null,
        ...patch,
    });
    const gut = { titel: "Neu", text: "Etwas ist neu.", hashtags: [], kanaele: ["neuigkeiten", "mastodon"] as const };

    it("🔴 ohne Kontext gilt wie bisher: nur die Neuigkeiten senden, Mastodon ist „nicht verbunden“", () => {
        expect(KANAL_KONTEXT_VORGABE.verbunden).toEqual(["neuigkeiten"]);
        expect(pruefeBeitrag(gut)).toEqual({ art: "kanal_nicht_verbunden", kanal: "mastodon" });
        expect(kanalKontext([]).verbunden).toEqual(["neuigkeiten"]);
    });

    it("🔴 bereit heißt wählbar; die Grenzen der Instanz ersetzen die Zahlen der Zählung", () => {
        const kontext = kanalKontext([stand()]);
        expect(kontext.verbunden).toEqual(["neuigkeiten", "mastodon"]);
        expect(kontext.sperren).toEqual({});
        expect(kontext.regeln.mastodon).toMatchObject({ grenze: 800, adresse: 30, geprueft: "2026-11-01" });
        expect(pruefeBeitrag({ ...gut, kontext })).toBeNull();
        // 700 Zeichen sind bei den 500 der Vorgabe zu viel, bei den 800 der Instanz nicht.
        const lang = { ...gut, kanaele: ["mastodon"] as const, text: "a".repeat(700) };
        expect(pruefeBeitrag({ ...lang, kontext })).toBeNull();
        expect(pruefeBeitrag({ ...lang, kontext: { ...kontext, regeln: {} } })).toMatchObject({
            art: "zu_lang",
            kanal: "mastodon",
            zuviel: 200,
        });
    });

    it("🔴 gesperrt mit Grund: nicht eingerichtet, Zählregel noch nicht geprüft, Notschalter; die Grenzen gelten trotzdem für den Zähler", () => {
        for (const sperre of ["nicht_eingerichtet", "nicht_freigeschaltet", "notschalter"] as const) {
            const kontext = kanalKontext([stand({ bereit: false, sperre })]);
            expect(kontext.verbunden).toEqual(["neuigkeiten"]);
            expect(kontext.sperren).toEqual({ mastodon: sperre });
            expect(pruefeBeitrag({ ...gut, kontext })).toEqual({
                art: "kanal_nicht_verbunden",
                kanal: "mastodon",
                sperre,
            });
            expect(kontext.regeln.mastodon?.grenze).toBe(800);
        }
        // Ohne gelesene Grenzen bleibt die Vorgabe.
        expect(
            kanalKontext([stand({ grenzen: null, grenzenAt: null, bereit: false, sperre: "nicht_freigeschaltet" })])
                .regeln,
        ).toEqual({});
    });

    it("der Vertrag der Antworten: Stand und Ziel mit `ausstehend`", () => {
        expect(Value.Check(SocialKanalStand, stand())).toBe(true);
        expect(Value.Check(SocialKanalStand, { ...stand(), adresse: "https://mastodon.beispiel.test" })).toBe(false);
        const ziel = {
            kanal: "mastodon",
            zustand: "ok",
            adresse: "https://x.test/1",
            fehler: null,
            versuche: 1,
            sendeAt: null,
        };
        expect(Value.Check(SocialZiel, { ...ziel, ausstehend: null })).toBe(true);
        expect(Value.Check(SocialZiel, { ...ziel, ausstehend: "zuruecknehmen" })).toBe(true);
        expect(Value.Check(SocialZiel, { ...ziel, ausstehend: "loeschen" })).toBe(false);
    });
});
