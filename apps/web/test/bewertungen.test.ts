import { describe, expect, it } from "vitest";
import {
    BEWERTUNG_ZUERST_GEZEIGT,
    SUBJECT_REVIEW_LIMIT,
    aventurischesDatumHeute,
    normalisiereAventurischesDatum,
    sternVerteilung,
    type BewertungDetail,
    type BewertungListe,
    type BewertungZeile,
    type SubjectReviewsSection,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import {
    bewertungSperrGrund,
    bewertungsBody,
    datumHeute,
    leererBewertungsEntwurf,
    leererMeldeEntwurf,
    meldeBody,
    meldeSperrGrund,
    sterneNachTaste,
} from "../src/community/bewertung-modell";
import {
    anfrageVon,
    filterGesetzt,
    grundName,
    griffe,
    kreisVon,
    legendeNamen,
    legendeZahlen,
    marken,
    ortSatz,
    segmentZahl,
    unterreiterZahl,
    unterzeile,
    verlaufZeilen,
    zustandSatz,
} from "../src/community/bewertungen-modell";
import { createBesucherSteuerung } from "../src/community/community-besucher";
import { createRedaktion, BEWERTUNG_WERKZEUG } from "../src/community/redaktion";
import { fuehreAus, kennung, kennungFrei, ladeBewertungen } from "../src/community/bewertungen-redaktion-api";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { setLocale } from "../src/i18n/i18n.ts";
import { createGemocht, GEMOCHT_MAX, GEMOCHT_SCHLUESSEL } from "../src/info-panel/bewertungen-gemocht";
import {
    bewertungenAnsichtOf,
    bewertungsAdresse,
    kopfzeileOf,
    leseBewertungsLink,
    verteilungOf,
} from "../src/info-panel/bewertungen-modell";
import { merkeBewertungsLink, bewertungsZiel } from "../src/info-panel/bewertung-ziel";
import { panelModelOf } from "../src/info-panel/panel-model";
import { GARETH_ID, REVISION, env, gareth, reichsstrasseMitRoute, shown } from "./panel-fixtures.ts";

/**
 * Bewertungen im Community-Modul (WI-0269 C10) ohne Browser: der Reiter im Infopanel (Ansicht, Kopfzeile, Verteilung, Sterne in halben Schritten, Link auf eine Bewertung, „Gefällt mir“ einmal je Browser),
 * die Fenster der Besucher (Pflicht, Sternwahl mit der Tastatur, Rumpf der Anfrage), die Redaktion (Zeilen, Zahlen, Handgriffe je Zustand und Recht, Verlauf) und die Schritte an der Leitung.
 * Die Server-Seite prüft `apps/server/test/community-bewertungen.test.ts` gegen PostgreSQL.
 */

const ORT = "00000000-0000-4000-8000-000000000001";
const GARETH = { kind: "place", id: GARETH_ID } as const;

const section = (over: Partial<SubjectReviewsSection> = {}): SubjectReviewsSection => ({
    subject: GARETH,
    revision: REVISION,
    count: 2,
    average: 3.5,
    distribution: [0, 1, 1, 0, 0],
    reviews: [
        { id: "a0", stars: 4, author: "Rakorium", text: "Ein Gewimmel.", date: "3. Praios 1047 BF", likes: 7 },
        { id: "a1", stars: 3 },
    ],
    ...over,
});

const viele = (n: number): SubjectReviewsSection =>
    section({
        count: n,
        reviews: Array.from({ length: n }, (_unused, index) => ({ id: `b${String(index)}`, stars: 5 })),
        distribution: [n, 0, 0, 0, 0],
    });

describe("Reiter „Bewertungen“ im Infopanel", () => {
    it("Wert mit einer Nachkommastelle und Komma, Zählung über ALLE öffentlichen, Datenbasis im Tooltip", () => {
        setLocale("de");
        const ansicht = bewertungenAnsichtOf(section({ count: 23, average: 3.8 }), false);
        expect(ansicht.wert).toBe("3,8");
        expect(ansicht.zaehlung).toBe("23 Bewertungen");
        expect(ansicht.datenbasis).toBe("Durchschnitt der 23 sichtbaren Bewertungen");
        expect(bewertungenAnsichtOf(section({ count: 1, average: 5 }), false).datenbasis).toBe(
            "Durchschnitt der 1 sichtbaren Bewertung",
        );
    });

    it("🔴 Sterne in halben Schritten am selben Zeichen: voll ab der Stufe, halb ab einer halben Stufe darunter", () => {
        const sterne = (wert: number) => bewertungenAnsichtOf(section({ average: wert }), false).sterne;
        expect(sterne(5)).toEqual(["full", "full", "full", "full", "full"]);
        expect(sterne(4.5)).toEqual(["full", "full", "full", "full", "half"]);
        expect(sterne(4.3)).toEqual(["full", "full", "full", "full", "empty"]);
        expect(sterne(3.8)).toEqual(["full", "full", "full", "half", "empty"]);
        expect(sterne(1.5)).toEqual(["full", "half", "empty", "empty", "empty"]);
        expect(sterne(1)).toEqual(["full", "empty", "empty", "empty", "empty"]);
    });

    it("Verteilung: 5 bis 1 Stern, Balken relativ zur größten Zahl", () => {
        const zeilen = verteilungOf([6, 3, 0, 0, 3]);
        expect(zeilen.map((z) => [z.stufe, z.anzahl])).toEqual([
            [5, 6],
            [4, 3],
            [3, 0],
            [2, 0],
            [1, 3],
        ]);
        expect(zeilen.map((z) => z.anteil)).toEqual([1, 0.5, 0, 0, 0.5]);
        // Ohne Antwort oder ohne Verteilung stehen fünf leere Zeilen, kein Fehler und keine Teilung durch null.
        expect(verteilungOf(undefined).every((z) => z.anzahl === 0 && z.anteil === 0)).toBe(true);
        expect(sternVerteilung([5, 5, 1, 3])).toEqual([2, 0, 1, 0, 1]);
    });

    it("je Bewertung die Kopfzeile, Sterne, Text in Anführungszeichen, die Kennung und „Gefällt mir“ ab 1", () => {
        setLocale("de");
        const [erste, zweite] = bewertungenAnsichtOf(section(), false).zeilen;
        expect(erste).toMatchObject({
            id: "a0",
            head: "Rakorium schreibt (3. Praios 1047 BF):",
            text: "„Ein Gewimmel.“",
            likes: 7,
            starsLabel: "4 von 5 Sternen",
        });
        // Ohne Autor „Anonym“, ohne Datum keine Klammer, ohne Text keine Zeile, ohne „Gefällt mir“ keine Zahl.
        expect(zweite).toMatchObject({ head: "Anonym schreibt:", text: "", likes: 0 });
    });

    it("🔴 zuerst zwölf, mit „Alle N zeigen“ die übrigen bis zur Grenze des Servers", () => {
        expect(BEWERTUNG_ZUERST_GEZEIGT).toBe(12);
        const dreissig = viele(30);
        const zuerst = bewertungenAnsichtOf(dreissig, false);
        expect(zuerst.zeilen).toHaveLength(12);
        expect(zuerst.weitere).toBe(18);
        expect(zuerst.gesamtGeliefert).toBe(30);
        const alle = bewertungenAnsichtOf(dreissig, true);
        expect(alle.zeilen).toHaveLength(30);
        expect(alle.weitere).toBe(0);
        // Genau zwölf: kein Knopf.
        expect(bewertungenAnsichtOf(viele(12), false).weitere).toBe(0);
        expect(SUBJECT_REVIEW_LIMIT).toBeGreaterThan(12);
    });

    it("ein Ort ohne Bewertung: keine Zeilen, kein Wert, die Zeile im Kopf sagt „Noch keine Bewertung“", () => {
        setLocale("de");
        const ohne: SubjectReviewsSection = { subject: GARETH, revision: REVISION, count: 0, reviews: [] };
        const ansicht = bewertungenAnsichtOf(ohne, false);
        expect(ansicht.anzahl).toBe(0);
        expect(ansicht.wert).toBe("");
        expect(ansicht.zeilen).toEqual([]);
        expect(kopfzeileOf(ohne)).toEqual({ art: "keine" });
        expect(bewertungenAnsichtOf(undefined, false).anzahl).toBe(0);
    });

    it("🔴 die Zeile im Kopf: „3,8 ★★★½ (10 Bewertungen)“", () => {
        setLocale("de");
        const zeile = kopfzeileOf(section({ count: 10, average: 3.8 }));
        expect(zeile).toMatchObject({ art: "wert", wert: "3,8", zaehlung: "10 Bewertungen" });
        expect(zeile.art === "wert" && zeile.sterne).toEqual(["full", "full", "full", "half", "empty"]);
    });

    it("Englisch: Zählung und Datenbasis in der Sprache der Seite", () => {
        setLocale("en");
        const ansicht = bewertungenAnsichtOf(section({ count: 3 }), false);
        expect(ansicht.zaehlung).toBe("3 reviews");
        expect(ansicht.datenbasis).toBe("Average of the 3 visible reviews");
        setLocale("de");
    });
});

describe("Link auf eine Bewertung (Teilen)", () => {
    const BEW = "11111111-2222-4333-8444-555555555555";

    it("🔴 trägt den Ort über seine Kennung und die Bewertung; sie lassen sich wieder lesen", () => {
        const adresse = bewertungsAdresse("https://avesmaps.test/", ORT, BEW);
        expect(adresse).toBe(`https://avesmaps.test/?place=${ORT}&bewertung=${BEW}`);
        expect(leseBewertungsLink(adresse.slice(adresse.indexOf("?")))).toEqual({ ort: ORT, bewertung: BEW });
    });

    it("beide müssen Kennungen sein; sonst nichts (kein Wiki-Name, kein Unfug)", () => {
        expect(leseBewertungsLink(`?place=Gareth&bewertung=${BEW}`)).toBeUndefined();
        expect(leseBewertungsLink(`?place=${ORT}&bewertung=1`)).toBeUndefined();
        expect(leseBewertungsLink(`?place=${ORT}`)).toBeUndefined();
        expect(leseBewertungsLink(`?siedlung=Gareth&bewertung=${BEW}`)).toBeUndefined();
        expect(leseBewertungsLink("")).toBeUndefined();
    });

    it("die Seite merkt sich das Ziel beim Start; ohne gültigen Link bleibt keines", () => {
        merkeBewertungsLink(`?place=${ORT}&bewertung=${BEW}`);
        expect(bewertungsZiel.value).toEqual({ ort: ORT, bewertung: BEW });
        merkeBewertungsLink("?place=x");
        expect(bewertungsZiel.value).toBeUndefined();
    });
});

describe("„Gefällt mir“ einmal je Browser", () => {
    const speicher = () => {
        const daten = new Map<string, string>();
        return {
            daten,
            getItem: (key: string) => daten.get(key) ?? null,
            setItem: (key: string, wert: string) => void daten.set(key, wert),
        };
    };

    it("setzen und zurücknehmen; der Stand überlebt das Neuladen der Seite", () => {
        const s = speicher();
        const erste = createGemocht(s);
        expect(erste.hat("a")).toBe(false);
        expect(erste.umschalten("a")).toBe(true);
        expect(erste.hat("a")).toBe(true);
        expect(createGemocht(s).hat("a")).toBe(true);
        expect(erste.umschalten("a")).toBe(false);
        expect(createGemocht(s).hat("a")).toBe(false);
    });

    it("🔴 gemerkt wird nur eine Kennung, nichts Persönliches; mehr als 500 lassen die ältesten fallen", () => {
        const s = speicher();
        const gemocht = createGemocht(s);
        for (let n = 0; n < GEMOCHT_MAX + 5; n++) gemocht.umschalten(`id-${String(n)}`);
        const gespeichert = JSON.parse(s.daten.get(GEMOCHT_SCHLUESSEL) ?? "[]") as string[];
        expect(gespeichert).toHaveLength(GEMOCHT_MAX);
        expect(gespeichert).not.toContain("id-0");
        expect(gespeichert.at(-1)).toBe(`id-${String(GEMOCHT_MAX + 4)}`);
    });

    it("ohne Speicher (gesperrt, privates Fenster) geht es für die Sitzung weiter; ein kaputter Eintrag stört nicht", () => {
        const kaputt = {
            getItem: () => "{nicht json",
            setItem: () => {
                throw new Error("voll");
            },
        };
        const g = createGemocht(kaputt);
        expect(g.umschalten("a")).toBe(true);
        expect(g.hat("a")).toBe(true);
        expect(createGemocht(undefined).hat("a")).toBe(false);
    });

    it("vergiss nimmt eine Kennung heraus, wo der Server das Setzen abgewiesen hat", () => {
        const g = createGemocht(speicher());
        g.umschalten("a");
        g.vergiss("a");
        expect(g.hat("a")).toBe(false);
        g.vergiss("unbekannt");
    });
});

describe("die Kachel „Bewertung schreiben“", () => {
    it("🔴 steht an einem Ort zwischen „Link teilen“ und „Änderungen vorschlagen“, mit dem Ort als Ziel", () => {
        const aktionen = panelModelOf(shown(gareth), null, env())?.actions ?? [];
        const ids = aktionen.map((a) => a.id);
        const stelle = ids.indexOf("review");
        expect(stelle).toBeGreaterThan(-1);
        expect(ids[stelle - 1]).toBe("share");
        expect(ids[stelle + 1]).toBe("suggest");
        const kachel = aktionen[stelle];
        expect(kachel?.label).toBe("Bewertung schreiben");
        expect(kachel?.run).toMatchObject({ type: "review", ortId: GARETH_ID });
    });

    it("andere Gegenstände (Weg) haben keine", () => {
        const ids = (panelModelOf(shown(reichsstrasseMitRoute), null, env())?.actions ?? []).map((a) => a.id);
        expect(ids).not.toContain("review");
    });
});

describe("Fenster „Bewertung schreiben“", () => {
    it("🔴 Pflicht ist nur die Wertung; Text über 200 Zeichen und ein falsches Datum sperren mit Grund", () => {
        const entwurf = leererBewertungsEntwurf();
        expect(bewertungSperrGrund(entwurf)).toBe("bewertungen.schreiben.sperre.sterne");
        entwurf.sterne = 4;
        expect(bewertungSperrGrund(entwurf)).toBeUndefined();
        entwurf.text = "x".repeat(201);
        expect(bewertungSperrGrund(entwurf)).toBe("bewertungen.schreiben.sperre.text");
        entwurf.text = "x".repeat(200);
        entwurf.datum = "gestern";
        expect(bewertungSperrGrund(entwurf)).toBe("bewertungen.schreiben.sperre.datum");
        entwurf.datum = "7. Rahja 1049 BF";
        expect(bewertungSperrGrund(entwurf)).toBeUndefined();
    });

    it("eine vorgewählte Wertung kommt aus dem Klick auf einen Stern, nur 1 bis 5", () => {
        expect(leererBewertungsEntwurf(3).sterne).toBe(3);
        expect(leererBewertungsEntwurf(0).sterne).toBe(0);
        expect(leererBewertungsEntwurf(9).sterne).toBe(0);
    });

    it("Sternwahl mit der Tastatur: ← und → wechseln, Pos1 und Ende springen, nie außerhalb von 1 bis 5", () => {
        expect(sterneNachTaste(3, "ArrowRight")).toBe(4);
        expect(sterneNachTaste(3, "ArrowLeft")).toBe(2);
        expect(sterneNachTaste(5, "ArrowRight")).toBe(5);
        expect(sterneNachTaste(1, "ArrowLeft")).toBe(1);
        expect(sterneNachTaste(0, "ArrowLeft")).toBe(1);
        expect(sterneNachTaste(0, "ArrowRight")).toBe(1);
        expect(sterneNachTaste(3, "Home")).toBe(1);
        expect(sterneNachTaste(3, "End")).toBe(5);
        expect(sterneNachTaste(3, "a")).toBeUndefined();
    });

    it("🔴 der Rumpf: leere Felder fehlen, das Datum ist kanonisch, die Falle geht mit; ohne Wertung wirft er", () => {
        const kennungen = { operationId: "00000000-0000-4000-8000-0000000000aa" };
        const entwurf = { sterne: 5, text: "  Gutes Bier. ", name: "  ", datum: "7 rahja 1049", honig: "" };
        expect(bewertungsBody(kennungen, ORT, entwurf, 4321.6)).toEqual({
            operationId: kennungen.operationId,
            ort: ORT,
            sterne: 5,
            text: "Gutes Bier.",
            datum: "7. Rahja 1049 BF",
            falle: { feld: "", dauerMs: 4322 },
        });
        const leer = bewertungsBody(kennungen, ORT, { ...entwurf, text: "", datum: "" }, 10);
        expect("text" in leer).toBe(false);
        expect("datum" in leer).toBe(false);
        expect("name" in leer).toBe(false);
        expect(() => bewertungsBody(kennungen, ORT, { ...entwurf, sterne: 0 }, 10)).toThrow();
    });

    it("der Platzhalter am Datum ist der heutige Tag im aventurischen Kalender (Praios = Juli)", () => {
        expect(aventurischesDatumHeute(new Date(Date.UTC(2026, 6, 15)), 1049)).toBe("15. Praios 1049 BF");
        expect(aventurischesDatumHeute(new Date(Date.UTC(2026, 5, 31 - 1)), 1049)).toBe("30. Rahja 1049 BF");
        expect(aventurischesDatumHeute(new Date(Date.UTC(2026, 0, 31)), 1050)).toBe("30. Firun 1050 BF");
        expect(datumHeute(new Date(Date.UTC(2026, 9, 31)))).toMatch(/^30\. Travia \d{4} BF$/u);
    });

    it("das aventurische Datum wird geprüft und kanonisch geschrieben, leer bleibt leer", () => {
        expect(normalisiereAventurischesDatum("")).toBe("");
        expect(normalisiereAventurischesDatum("  ")).toBe("");
        expect(normalisiereAventurischesDatum("7. Rahja 1049 BF")).toBe("7. Rahja 1049 BF");
        expect(normalisiereAventurischesDatum("7 rahja 1049")).toBe("7. Rahja 1049 BF");
        expect(normalisiereAventurischesDatum("3. Namenloser Tag 1049 BF")).toBe("3. Namenloser Tag 1049 BF");
        expect(normalisiereAventurischesDatum("12. Praios 400 v. BF")).toBe("12. Praios 400 v. BF");
        for (const falsch of [
            "gestern",
            "31. Praios 1049 BF",
            "0. Praios 1049",
            "6. Namenloser Tag 1049",
            "1. Foo 1049",
        ]) {
            expect(normalisiereAventurischesDatum(falsch), falsch).toBeNull();
        }
    });
});

describe("Fenster „Bewertung melden“", () => {
    const kennungen = { operationId: "00000000-0000-4000-8000-0000000000bb", schluessel: "k".repeat(43) };

    it("Pflicht ist der Grund; die Beschreibung ist freiwillig, höchstens 2000 Zeichen", () => {
        const entwurf = leererMeldeEntwurf();
        expect(meldeSperrGrund(entwurf)).toBe("bewertungen.melden.sperre.grund");
        entwurf.grund = "beleidigend";
        expect(meldeSperrGrund(entwurf)).toBeUndefined();
        entwurf.text = "x".repeat(2001);
        expect(meldeSperrGrund(entwurf)).toBe("bewertungen.melden.sperre.text");
    });

    it("der Rumpf trägt Kennung, Schlüssel der Statusseite, Grund und Falle; ohne Beschreibung kein Text", () => {
        expect(meldeBody(kennungen, { grund: "spam", text: " ", honig: "" }, 5000)).toEqual({
            operationId: kennungen.operationId,
            schluessel: kennungen.schluessel,
            grund: "spam",
            falle: { feld: "", dauerMs: 5000 },
        });
        expect(meldeBody(kennungen, { grund: "person", text: " Mein Name steht dort. ", honig: "" }, 1)).toMatchObject({
            grund: "person",
            text: "Mein Name steht dort.",
        });
        expect(() => meldeBody(kennungen, leererMeldeEntwurf(), 1)).toThrow();
    });

    it("die Gründe sind die fünf des Fachkonzepts, in Worten", () => {
        setLocale("de");
        expect(["beleidigend", "spam", "ort", "person", "sonstiges"].map(grundName)).toEqual([
            "Beleidigend",
            "Werbung oder Spam",
            "Falscher Ort",
            "Persönliche Daten",
            "Sonstiges",
        ]);
    });
});

describe("Besucherfenster: Steuerung", () => {
    const ziel = { ortId: ORT, ortName: "Gareth" };

    it("öffnet das Formular zum Ort; derselbe Ort noch einmal behält das Fenster (und den Text)", () => {
        const steuerung = createBesucherSteuerung({ naechsterOrt: () => Promise.resolve(undefined) });
        steuerung.oeffneBewertung(ziel);
        const erste = steuerung.anzeige.value;
        expect(erste).toMatchObject({ art: "bewertung", ziel });
        steuerung.oeffneBewertung(ziel);
        expect(steuerung.anzeige.value).toBe(erste);
        steuerung.oeffneBewertung({ ortId: "anderer", ortName: "Wehrheim" });
        expect(steuerung.anzeige.value).not.toBe(erste);
    });

    it("ein Fenster zur Zeit: Melden ersetzt das Formular, Schließen räumt auf", () => {
        const steuerung = createBesucherSteuerung({ naechsterOrt: () => Promise.resolve(undefined) });
        steuerung.oeffneBewertung(ziel);
        steuerung.oeffneBewertungMelden({ ...ziel, bewertung: { id: "b", stars: 1, head: "Troll schreibt:" } });
        expect(steuerung.anzeige.value?.art).toBe("bewertungMelden");
        steuerung.schliesse();
        expect(steuerung.anzeige.value).toBeUndefined();
    });
});

// --- Redaktion --------------------------------------------------------------------------------------------------------------

const rz = (over: Partial<BewertungZeile> = {}): BewertungZeile => ({
    id: "00000000-0000-4000-8000-0000000000c1",
    ort: { id: ORT, name: "Wehrheim" },
    sterne: 4,
    text: "Gutes Bier.",
    name: "Alrik",
    datum: "3. Praios 1047 BF",
    zustand: "neu",
    grund: null,
    herkunft: "website",
    eingangAt: "2026-10-31T10:00:00.000Z",
    gemeldet: [],
    gefaellt: 0,
    inhaltGeloescht: false,
    revision: 1,
    ...over,
});

const REVIEWER = ["moderate_submissions"];
const ADMIN = ["moderate_submissions", "moderate_community"];

describe("Redaktion: Zeilen und Zahlen", () => {
    const liste: BewertungListe = {
        zeilen: [],
        zaehler: { sichten: 4, sichtbar: 120, verborgen: 3, neu: 3, zurueckgehalten: 1, gesichtet: 120 },
    };

    it("Kreise: ○ neu, ◑ zurückgehalten, ● gesichtet, ◌ verborgen", () => {
        expect(kreisVon("neu")).toBe("leer");
        expect(kreisVon("zurueckgehalten")).toBe("halb-rechts");
        expect(kreisVon("gesichtet")).toBe("voll");
        expect(kreisVon("verborgen")).toBe("gestrichelt");
    });

    it("Segmentzahlen und die Zahl am Unterreiter („zu sichten“)", () => {
        expect(segmentZahl(liste.zaehler, "sichten")).toBe(4);
        expect(segmentZahl(liste.zaehler, "sichtbar")).toBe(120);
        expect(segmentZahl(liste.zaehler, "verborgen")).toBe(3);
        expect(unterreiterZahl(liste)).toBe(4);
    });

    it("die Legende nennt alle vier Zustände mit den Zahlen aller: „neu ○ 3 · zurückgehalten ◑ 1 · gesichtet ● 120 · verborgen ◌ 3“", () => {
        setLocale("de");
        expect(legendeNamen()).toEqual({
            leer: "neu",
            "halb-rechts": "zurückgehalten",
            voll: "gesichtet",
            gestrichelt: "verborgen",
        });
        expect(legendeZahlen(liste.zaehler)).toMatchObject({ leer: 3, "halb-rechts": 1, voll: 120, gestrichelt: 3 });
    });

    it("Marken: gemeldet COM-…, Spamverdacht mit Grund, verborgen mit Grund, Legacy", () => {
        setLocale("de");
        expect(marken(rz())).toEqual([]);
        expect(marken(rz({ gemeldet: ["COM-000120"], herkunft: "legacy" }))).toEqual(["gemeldet COM-000120", "Legacy"]);
        expect(marken(rz({ zustand: "zurueckgehalten", grund: "adresse" }))).toEqual(["Spamverdacht: Adresse im Text"]);
        expect(marken(rz({ zustand: "verborgen", grund: "beleidigend" }))).toEqual(["verborgen: Beleidigend"]);
    });

    it("Unterzeile: Name und aventurisches Datum, „Anonym“ ohne Name, „Inhalt gelöscht“ nach dem Löschen", () => {
        setLocale("de");
        expect(unterzeile(rz())).toBe("Alrik · 3. Praios 1047 BF");
        expect(unterzeile(rz({ name: null, datum: null }))).toBe("Anonym");
        expect(
            unterzeile(rz({ name: null, datum: null, text: null, inhaltGeloescht: true, zustand: "verborgen" })),
        ).toBe("Inhalt gelöscht");
    });

    it("Zustand in Worten", () => {
        setLocale("de");
        expect(zustandSatz(rz())).toBe("neu, schon öffentlich");
        expect(zustandSatz(rz({ zustand: "gesichtet" }))).toBe("gesichtet, öffentlich");
        expect(zustandSatz(rz({ zustand: "zurueckgehalten", grund: "adresse" }))).toBe(
            "zurückgehalten: Adresse im Text",
        );
        expect(zustandSatz(rz({ zustand: "verborgen", grund: "beleidigend" }))).toBe("verborgen: Beleidigend");
    });
});

describe("Redaktion: Trichter und Anfrage", () => {
    it("ein Wert je Abschnitt wird zum Filter des Servers; leer ist kein Filter", () => {
        expect(anfrageVon("sichten", "  ", {}, "neueste")).toEqual({ segment: "sichten", sortierung: "neueste" });
        expect(
            anfrageVon(
                "sichtbar",
                " Wehrheim ",
                { sterne: ["2"], herkunft: ["legacy"], sonst: ["gemeldet", "zurueckgehalten"] },
                "wenigste",
            ),
        ).toEqual({
            segment: "sichtbar",
            q: "Wehrheim",
            sterne: 2,
            herkunft: "legacy",
            gemeldet: true,
            zurueckgehalten: true,
            sortierung: "wenigste",
        });
        // Zwei Herkünfte sind kein Filter.
        expect(anfrageVon("sichten", "", { herkunft: ["website", "legacy"] }, "neueste").herkunft).toBeUndefined();
        expect(anfrageVon("sichten", "x".repeat(300), {}, "neueste").q).toHaveLength(100);
        expect(filterGesetzt({})).toBe(false);
        expect(filterGesetzt({ sterne: ["3"] })).toBe(true);
    });
});

describe("Redaktion: was geht, und warum nicht (Bedienkonzept §6.2, Fuß je Zustand)", () => {
    const zeigt = (zeile: BewertungZeile, rechte: readonly string[]) => {
        const g = griffe(zeile, rechte);
        return Object.entries(g)
            .filter(([, griff]) => griff.zeigen)
            .map(([name]) => name);
    };

    it("🔴 neu: Verbergen …, Gesichtet · zurückgehalten: Verbergen …, Freigeben · gesichtet: Verbergen … · verborgen: Inhalt löschen …, Einblenden", () => {
        expect(zeigt(rz({ zustand: "neu" }), REVIEWER)).toEqual(["sichten", "verbergen"]);
        expect(zeigt(rz({ zustand: "zurueckgehalten", grund: "wortliste" }), REVIEWER)).toEqual([
            "freigeben",
            "verbergen",
        ]);
        expect(zeigt(rz({ zustand: "gesichtet" }), REVIEWER)).toEqual(["verbergen"]);
        expect(zeigt(rz({ zustand: "verborgen", grund: "spam" }), ADMIN)).toEqual(["einblenden", "loeschen"]);
    });

    it("🔴 Inhalt löschen braucht moderate_community: ohne das Recht steht der Knopf gesperrt mit Grund da", () => {
        const verborgen = rz({ zustand: "verborgen", grund: "person" });
        expect(griffe(verborgen, REVIEWER).loeschen).toEqual({
            zeigen: true,
            grund: "bewertungen.redaktion.grund.loeschenRecht",
        });
        expect(griffe(verborgen, ADMIN).loeschen).toEqual({ zeigen: true });
    });

    it("ohne moderate_submissions sind alle Handgriffe gesperrt, mit Grund", () => {
        const g = griffe(rz(), []);
        expect(g.sichten.grund).toBe("bewertungen.redaktion.grund.keinRecht");
        expect(g.verbergen.grund).toBe("bewertungen.redaktion.grund.keinRecht");
    });

    it("nach dem Löschen des Inhalts: Einblenden und Löschen gesperrt, mit dem Satz warum", () => {
        const weg = rz({
            zustand: "verborgen",
            grund: "person",
            inhaltGeloescht: true,
            text: null,
            name: null,
            datum: null,
        });
        expect(griffe(weg, ADMIN).einblenden.grund).toBe("bewertungen.redaktion.grund.ohneInhalt");
        expect(griffe(weg, ADMIN).loeschen.grund).toBe("bewertungen.redaktion.grund.schonGeloescht");
    });
});

describe("Redaktion: das Fenster einer Bewertung", () => {
    const detail = (over: Partial<BewertungDetail> = {}): BewertungDetail => ({
        zeile: rz(),
        ort: {
            id: ORT,
            name: "Wehrheim",
            art: "dorf",
            lage: { x: 500, y: 400 },
            jetzt: { n: 12, wert: 4.3 },
            danach: { n: 11, wert: 4.5 },
        },
        meldungen: [],
        verlauf: [
            { art: "eingang", von: null, text: "website", at: "2026-10-31T10:00:00.000Z" },
            { art: "gemeldet", von: null, text: "COM-000120", at: "2026-10-31T10:30:00.000Z" },
            { art: "verborgen", von: { id: "p", name: "Lena" }, text: "beleidigend", at: "2026-10-31T11:00:00.000Z" },
        ],
        ...over,
    });

    it("🔴 der Ort zeigt den Durchschnitt jetzt und nach der Handlung: „★ 4,3 aus 12 · nach dem Verbergen ★ 4,5 aus 11“", () => {
        setLocale("de");
        expect(ortSatz(detail())).toBe("jetzt ★ 4,3 aus 12 · nach dem Verbergen ★ 4,5 aus 11");
        expect(ortSatz(detail({ zeile: rz({ zustand: "zurueckgehalten", grund: "adresse" }) }))).toContain(
            "nach dem Freigeben",
        );
        expect(ortSatz(detail({ zeile: rz({ zustand: "verborgen", grund: "spam" }) }))).toContain(
            "nach dem Einblenden",
        );
        // Ohne Bewertung steht ein Wort, kein „NaN“.
        const leer = detail({
            ort: { ...detail().ort, jetzt: { n: 0, wert: null }, danach: { n: 0, wert: null } },
        });
        expect(ortSatz(leer)).toBe("jetzt ohne Bewertung · nach dem Verbergen ohne Bewertung");
    });

    it("der Verlauf: eingegangen, gemeldet mit Nummer, verborgen mit Grund und Person", () => {
        setLocale("de");
        const zeilen = verlaufZeilen(detail().verlauf, new Date("2026-10-31T12:00:00.000Z"));
        expect(zeilen.map((z) => z.text)).toEqual([
            "eingegangen (Website)",
            "gemeldet: COM-000120",
            "verborgen von Lena: Beleidigend",
        ]);
        expect(new Set(zeilen.map((z) => z.key)).size).toBe(3);
    });
});

describe("Redaktion: Steuerung der Fenster", () => {
    it("🔴 Bewertungen öffnen als Werkzeugfenster `bewertung`; eine zweite ersetzt die erste im selben Fenster", () => {
        const fenster = createWerkzeugfenster(undefined);
        const redaktion = createRedaktion();
        redaktion.verbinde({
            fenster,
            zeige: () => undefined,
            oeffneImEditor: () => undefined,
            zeigeMeldungen: () => undefined,
        });
        const erste = redaktion.oeffneBewertung("b1", "★★★★☆ Wehrheim");
        expect(erste).toBeDefined();
        expect(redaktion.bewertungFenster.value.map((f) => [f.werkzeug, f.gegenstand])).toEqual([
            [BEWERTUNG_WERKZEUG, "b1"],
        ]);
        // Ein Vorgang ist ein anderes Werkzeug: er zählt nicht mit.
        expect(redaktion.vorgangFenster.value).toEqual([]);
        redaktion.oeffneBewertung("b2", "★☆☆☆☆ Gareth");
        expect(redaktion.bewertungFenster.value.map((f) => f.gegenstand)).toEqual(["b2"]);
    });

    it("⊘ in der Liste wünscht das Blatt „Verbergen“; das Fenster nimmt den Wunsch genau einmal und nur für seine Bewertung", () => {
        const fenster = createWerkzeugfenster(undefined);
        const redaktion = createRedaktion();
        redaktion.verbinde({
            fenster,
            zeige: () => undefined,
            oeffneImEditor: () => undefined,
            zeigeMeldungen: () => undefined,
        });
        redaktion.oeffneBewertung("b1", "t", "verbergen");
        expect(redaktion.nimmBlattWunsch("b2")).toBeUndefined();
        expect(redaktion.nimmBlattWunsch("b1")).toBe("verbergen");
        expect(redaktion.nimmBlattWunsch("b1")).toBeUndefined();
        // Ein Öffnen ohne Wunsch räumt einen alten weg.
        redaktion.oeffneBewertung("b1", "t", "verbergen");
        redaktion.oeffneBewertung("b1", "t");
        expect(redaktion.nimmBlattWunsch("b1")).toBeUndefined();
    });

    it("ohne Verbindung öffnet nichts", () => {
        expect(createRedaktion().oeffneBewertung("b1", "t")).toBeUndefined();
    });
});

describe("Redaktion: die Schritte an der Leitung", () => {
    const antwort = (status: number, body: unknown): Response =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const quittung = { id: "b1", revision: 2, abgeschlossen: [] as string[] };

    it("fragt die Liste mit Segment, Sortierung und den gesetzten Filtern", async () => {
        const urls: string[] = [];
        await ladeBewertungen(
            anfrageVon("sichtbar", "Gareth", { sterne: ["5"], sonst: ["gemeldet"] }, "aelteste"),
            (url) => {
                urls.push(String(url));
                return Promise.resolve(antwort(200, { zeilen: [], zaehler: {} }));
            },
        );
        const parameter = new URL(urls[0] ?? "", "https://x.test").searchParams;
        expect(Object.fromEntries(parameter)).toEqual({
            segment: "sichtbar",
            sortierung: "aelteste",
            q: "Gareth",
            sterne: "5",
            gemeldet: "true",
        });
    });

    it("🔴 dieselbe Handlung schickt dieselbe Kennung, bis sie durch ist; ein Netzfehler lässt sie stehen", async () => {
        kennungFrei("b1", "sichten");
        const erste = kennung("b1", "sichten");
        expect(kennung("b1", "sichten")).toBe(erste);
        // Netz weg: die Kennung bleibt, das erneute Senden ist gefahrlos.
        await expect(
            fuehreAus(
                "b1",
                "sichten",
                { baseRevision: 1 },
                { fetcher: () => Promise.reject(new TypeError("offline")) },
            ),
        ).rejects.toBeDefined();
        expect(kennung("b1", "sichten")).toBe(erste);
        // Gelungen: frei.
        const gesendet: Record<string, unknown>[] = [];
        await fuehreAus(
            "b1",
            "sichten",
            { baseRevision: 1 },
            {
                fetcher: (_url, init) => {
                    gesendet.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
                    return Promise.resolve(antwort(200, quittung));
                },
            },
        );
        expect(gesendet[0]).toMatchObject({ operationId: erste, baseRevision: 1 });
        expect(kennung("b1", "sichten")).not.toBe(erste);
    });

    it("eine Absage des Servers (Konflikt) gibt die Kennung frei", async () => {
        kennungFrei("b2", "verbergen");
        const erste = kennung("b2", "verbergen");
        const fehler = await fuehreAus(
            "b2",
            "verbergen",
            { baseRevision: 1, grund: "spam", vorgaengeAbschliessen: false },
            {
                fetcher: () =>
                    Promise.resolve(antwort(409, { error: { code: "community_conflict", message: "x", status: 409 } })),
            },
        ).catch((e: unknown) => e);
        expect(fehler).toBeInstanceOf(ApiFailure);
        expect(kennung("b2", "verbergen")).not.toBe(erste);
        kennungFrei("b2", "verbergen");
    });
});
