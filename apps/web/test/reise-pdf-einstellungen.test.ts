import { describe, expect, it } from "vitest";
import { karteneinstellungVorgaben, karteneinstellungenWirksam, PDF_KARTEN, PDF_SPRACHEN } from "@avesmaps3d/shared";
import { LOCALES } from "../src/i18n/plural.ts";
import { formatNumber, inSprache, ladeTafel, locale, t } from "../src/i18n/i18n.ts";
import {
    ansichtFuer,
    dateiAusVorlage,
    dateiName,
    inhaltZaehler,
    kartenWahlen,
    seitenMasse,
    startSprache,
    startWahl,
    vorgaben,
    wahlAus,
    wirksamerInhalt,
    type KartenAnsicht,
} from "../src/reise-pdf/einstellungen.ts";
import { groesstesIn, liegtIn, umriss, zuschnitt } from "../src/reise-pdf/zuschnitt.ts";

/**
 * „Reise als PDF“ (WI-0306): die Wahl des Kartenbilds und wie die Karte dafür steht, der Dateiname, der Zähler der Inhalte, der Zuschnitt
 * des Kartenbilds und die Sprache des PDFs neben der Sprache der Seite.
 */

const SERIEN = [
    { id: "modern", label: "Modern" },
    { id: "original", label: "Original" },
    { id: "old", label: "Old", nurKarte: true },
];
const STANDARD: KartenAnsicht = { view: "standard", landscape: "alle", topography: "hoehenlinien", series: "modern" };

describe("Die Wahl des Kartenbilds", () => {
    it("in der Folge des Entwurfs: Serien, Politisch, die sieben Ebenen der Derographie", () => {
        expect(kartenWahlen(SERIEN)).toEqual([
            "serie:modern",
            "serie:original",
            "serie:old",
            "politisch",
            "dero:alle",
            "dero:derographisch",
            "dero:vegetation",
            "dero:topographie",
            "dero:hoehenstufen",
            "dero:klima",
            "dero:sprachen",
        ]);
    });

    it("was gerade auf der Karte ist: Serie, Politisch, Ebene, Höhenstufen; die Kraftlinien sind keine Wahl", () => {
        expect(wahlAus(STANDARD, SERIEN)).toBe("serie:modern");
        expect(wahlAus({ ...STANDARD, view: "political" }, SERIEN)).toBe("politisch");
        expect(wahlAus({ ...STANDARD, view: "landscapes", landscape: "vegetation" }, SERIEN)).toBe("dero:vegetation");
        expect(
            wahlAus({ ...STANDARD, view: "landscapes", landscape: "topographie", topography: "hoehenstufen" }, SERIEN),
        ).toBe("dero:hoehenstufen");
        expect(wahlAus({ ...STANDARD, view: "powerlines" }, SERIEN)).toBeUndefined();
    });

    it("🔴 „Old“ steht unter „Nur Karte“, jede andere Serie in der Standardansicht", () => {
        expect(ansichtFuer("serie:old", STANDARD, SERIEN, "modern")).toMatchObject({ view: "none", series: "old" });
        expect(ansichtFuer("serie:original", STANDARD, SERIEN, "modern")).toMatchObject({
            view: "standard",
            series: "original",
        });
    });

    it("Politisch und Derographie nehmen nie eine Serie mit Namen im Bild; Höhenstufen ist die Topographie in Stufen", () => {
        const alt = { ...STANDARD, view: "none" as const, series: "old" };
        expect(ansichtFuer("politisch", alt, SERIEN, "modern")).toMatchObject({ view: "political", series: "modern" });
        expect(ansichtFuer("dero:hoehenstufen", STANDARD, SERIEN, "modern")).toMatchObject({
            view: "landscapes",
            landscape: "topographie",
            topography: "hoehenstufen",
        });
        expect(
            ansichtFuer("dero:topographie", { ...STANDARD, topography: "hoehenstufen" }, SERIEN, "modern"),
        ).toMatchObject({
            topography: "hoehenlinien",
        });
    });

    it("🔴 ist die Wahl das, was die Karte zeigt, bleibt alles, wie es ist (auch „Nur Karte“)", () => {
        const nurKarte = { ...STANDARD, view: "none" as const };
        expect(ansichtFuer("serie:modern", nurKarte, SERIEN, "modern")).toEqual(nurKarte);
    });
});

describe("Datei, Inhalte, Papier", () => {
    it("der Dateiname nimmt, was ein Dateisystem nimmt; leer die Vorgabe, eine getippte Endung fällt weg", () => {
        expect(dateiName("Reise von Gareth nach Havena", "Reise")).toBe("Reise von Gareth nach Havena");
        expect(dateiName('  a/b:c*?"<>|  d.pdf ', "Reise")).toBe("abc d");
        expect(dateiName("   ", "Reise")).toBe("Reise");
        expect(dateiName("x".repeat(200), "Reise")).toHaveLength(120);
    });

    it("„5 von 8“ zählt nur, was die Reise trägt; was fehlt, kommt nicht hinein", () => {
        const e = vorgaben(karteneinstellungVorgaben(), "", "de", "", "serie:modern");
        const alles = {
            etappen: true,
            profil: true,
            kosten: true,
            schiffe: true,
            gebiete: true,
            unterwegs: true,
            tagebuch: true,
            qr: true,
        };
        expect(inhaltZaehler(e.inhalt, alles)).toEqual({ gewaehlt: 5, von: 8 });
        const ohneSchiff = { ...alles, schiffe: false };
        expect(inhaltZaehler(e.inhalt, ohneSchiff)).toEqual({ gewaehlt: 4, von: 7 });
        expect(wirksamerInhalt(e.inhalt, ohneSchiff).schiffe).toBe(false);
    });

    it("A5 ist ein Heft in halber A4", () => {
        expect(seitenMasse("a5", "hoch")).toEqual({ breite: 419.53, hoehe: 595.28 });
    });
});

describe("Der Zuschnitt des Kartenbilds", () => {
    const behaelter = { x: 0, y: 0, w: 1600, h: 900 };
    const frei = { x: 360, y: 0, w: 1240, h: 900 };

    it("Ausschnitt: das größte Rechteck im Verhältnis des Felds in der freien Fläche", () => {
        const k = zuschnitt("ausschnitt", 1.25, behaelter, frei);
        expect(k.w / k.h).toBeCloseTo(1.25);
        expect(liegtIn(k, frei, -0.001)).toBe(true);
        expect(k.h).toBe(900);
    });

    it("Ganze Route: der Umriss mit Rand, im Verhältnis des Felds, in der freien Fläche", () => {
        const route = { x: 800, y: 300, w: 300, h: 200 };
        const k = zuschnitt("route", 1.25, behaelter, frei, route);
        expect(k.w / k.h).toBeCloseTo(1.25);
        expect(liegtIn(route, k, 20)).toBe(true);
        expect(liegtIn(k, frei, -0.001)).toBe(true);
    });

    it("ist die Route größer als die freie Fläche, darf der Zuschnitt unter den Planer, nie aus dem Behälter", () => {
        const route = { x: 100, y: 100, w: 1300, h: 600 };
        const k = zuschnitt("route", 2, behaelter, frei, route);
        expect(liegtIn(k, behaelter, -0.001)).toBe(true);
        expect(k.x).toBeLessThan(frei.x);
    });

    it("Umriss und größtes Rechteck", () => {
        expect(
            umriss([
                { x: 3, y: 4 },
                { x: 1, y: 9 },
            ]),
        ).toEqual({ x: 1, y: 4, w: 2, h: 5 });
        expect(groesstesIn({ x: 0, y: 0, w: 100, h: 100 }, 2)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    });
});

describe("Die Sprache des PDFs neben der Sprache der Seite", () => {
    it("🔴 `inSprache` rechnet Zahlen und Wörter in der anderen Sprache und lässt die Seite, wie sie ist", async () => {
        await ladeTafel("fr");
        expect(locale.value).toBe("de");
        const [zahl, wort] = inSprache("fr", () => [formatNumber(1234.5, 1), t("planner.summary.distance")]);
        // Französisch trennt Tausender mit dem schmalen Zwischenraum (den das PDF zum geschützten Leerzeichen macht).
        expect(zahl).toBe("1 234,5");
        expect(wort).toBe("Distance");
        expect(t("planner.summary.distance")).toBe("Distanz");
        expect(formatNumber(1234.5, 1)).toBe("1.234,5");
        expect(locale.value).toBe("de");
    });
});

describe("Die Vorgaben aus den Standardwerten (Panel „PDF Exporter“)", () => {
    it("🔴 Vali 2026-11-10: „Jede Etappe als default, Reisetagebuch standard aus“", () => {
        const e = vorgaben(karteneinstellungVorgaben(), "", "de", "", "serie:modern");
        expect(e.etappenArt).toBe("lang");
        expect(e.inhalt.tagebuch).toBe(false);
        expect(e).toMatchObject({ karte: "route", format: "a4", lage: "hoch", papier: "pergament", wetter: true });
        expect(e.inhalt).toEqual({
            etappen: true,
            profil: true,
            kosten: true,
            schiffe: true,
            gebiete: false,
            unterwegs: false,
            tagebuch: false,
            qr: true,
        });
        expect(e.zusaetze).toEqual({ gegend: true, gebiet: true, sprache: false, gelaende: true, neu: true });
    });

    it("was die Systemsteuerung einstellt, öffnet den Dialog", () => {
        const werte = karteneinstellungenWirksam({
            pdfKartenbild: "ohne",
            pdfEtappenArt: "kurz",
            pdfTagebuch: true,
            pdfDazuSprache: true,
            pdfFormat: "a5",
            pdfLage: "quer",
            pdfPapier: "weiss",
            pdfWetter: false,
        });
        const e = vorgaben(werte, "Titel", "en", "Datei", "politisch");
        expect(e).toMatchObject({
            karte: "ohne",
            etappenArt: "kurz",
            format: "a5",
            lage: "quer",
            papier: "weiss",
            wetter: false,
            titel: "Titel",
            sprache: "en",
            datei: "Datei",
            wahl: "politisch",
        });
        expect(e.inhalt.tagebuch).toBe(true);
        expect(e.zusaetze.sprache).toBe(true);
    });

    it("die Karte: „aktuell“ ist, was die Karte zeigt; eine fehlende Serie und Politisch ohne Gebiete fallen darauf zurück", () => {
        expect(startWahl("aktuell", "dero:klima", "modern", SERIEN, true)).toBe("dero:klima");
        expect(startWahl("aktuell", undefined, "original", SERIEN, true)).toBe("serie:original");
        expect(startWahl("serie:old", "serie:modern", "modern", SERIEN, true)).toBe("serie:old");
        expect(startWahl("serie:old", "serie:modern", "modern", SERIEN.slice(0, 2), true)).toBe("serie:modern");
        expect(startWahl("politisch", "serie:modern", "modern", SERIEN, true)).toBe("politisch");
        expect(startWahl("politisch", "serie:modern", "modern", SERIEN, false)).toBe("serie:modern");
        expect(startWahl("dero:hoehenstufen", undefined, "modern", SERIEN, false)).toBe("dero:hoehenstufen");
    });

    it("jede Karte der Standardwerte ist eine Wahl des Dialogs (außer „aktuell“)", () => {
        expect(PDF_KARTEN.filter((karte) => karte !== "aktuell")).toEqual(kartenWahlen(SERIEN));
    });

    it("die Sprache: „seite“ ist die Sprache der Seite; die Liste ist die der Seite", () => {
        expect(PDF_SPRACHEN.filter((sprache) => sprache !== "seite")).toEqual([...LOCALES]);
        expect(startSprache("seite", "fr")).toBe("fr");
        expect(startSprache("pl", "fr")).toBe("pl");
    });

    it("der Dateiname: {von} und {bis} werden Start und Ziel, ein Ersetzungszeichen im Namen bleibt, wie es ist", () => {
        expect(dateiAusVorlage("Avesmaps {von} bis {bis}", "Gareth", "Havena")).toBe("Avesmaps Gareth bis Havena");
        expect(dateiAusVorlage("{bis}", "$&", "$1")).toBe("$1");
        expect(dateiAusVorlage("Ohne Platzhalter", "A", "B")).toBe("Ohne Platzhalter");
    });
});
