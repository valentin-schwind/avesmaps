import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n/i18n";
import {
    endenText,
    meldungText,
    neuerWegGrund,
    neuerWegMeldungText,
    neuerWegSatz,
    neuerWegSchild,
    wegName,
} from "../src/wegeditor/wegeditor-texte";
import type { Ziel } from "../src/map/geometrie/geometrie";
import { t } from "../src/i18n/i18n";

/**
 * Die Sätze des Wegeditors (WI-0177). Problemfälle: Die Leiste nennt einen Weg nach seinem Griff („Weg-6029“, 5.130 aktive Wege
 * tragen einen, WI-0105); der Satz zu den Enden setzt Bruchstücke zusammen, die eine andere Sprache anders großschreibt; die Liste der
 * mitgezogenen Wege steht mit Komma statt mit „und“.
 */

afterEach(() => setLocale("de"));

describe("Die Sätze des Wegeditors", () => {
    it("🔴 ein Griff ist kein Name: dann steht der Satz für einen Weg ohne Namen", () => {
        expect(wegName({ name: "Weg-6029", subtype: "Weg", isBach: false })).toBe("Unbezeichneter Weg");
        expect(wegName({ name: "Strasse", subtype: "Strasse", isBach: false })).toBe("Unbezeichnete Straße");
        expect(wegName({ name: "Reichsstraße 2", subtype: "Strasse", isBach: false })).toBe("Reichsstraße 2");
        expect(
            endenText({
                start: { kind: "place", publicId: "o", name: "Raulsknochen" },
                end: {
                    kind: "path",
                    publicId: "p",
                    name: "Pfad-3443",
                    subtype: "Pfad",
                    isBach: false,
                    contact: "ende",
                },
            }),
        ).toBe("Anfang hängt an Raulsknochen, Ende an Unbezeichneter Pfad.");
    });

    it("🔴 jeder Fall der Enden ist ein ganzer Satz, auch auf Englisch", () => {
        const ort = { kind: "place", publicId: "o", name: "Praiograd" } as const;
        const frei = { kind: "free" } as const;
        expect(endenText({ start: ort, end: frei })).toBe("Anfang hängt an Praiograd, das Ende ist frei.");
        expect(endenText({ start: frei, end: ort })).toBe("Der Anfang ist frei, das Ende hängt an Praiograd.");
        expect(endenText({ start: frei, end: frei })).toBe("Anfang und Ende sind frei.");
        setLocale("en");
        expect(endenText({ start: frei, end: ort })).toBe("The start is free, the end is attached to Praiograd.");
    });

    it("gespeichert: Haken und Name, Anschlüsse aus der Quittung, die Mitgezogenen als Aufzählung der Sprache", () => {
        const enden = { start: { kind: "place", publicId: "o", name: "Gareth" }, end: { kind: "free" } } as const;
        const gespeichert = { art: "gespeichert", publicId: "w", name: "Reichsstraße 3", enden } as const;
        expect(meldungText({ ...gespeichert, mitgezogen: ["Nebenweg", "Hohlweg"] })).toBe(
            "✓ „Reichsstraße 3“ gespeichert. Anfang hängt an Gareth, das Ende ist frei. Mitgezogen: Nebenweg und Hohlweg.",
        );
        // Nach „Wegkurve vereinfachen“ (W3) dazu, wie viele Stützpunkte es waren und sind.
        expect(meldungText({ ...gespeichert, mitgezogen: [], stuetzpunkte: { vorher: 19, nachher: 7 } })).toBe(
            "✓ „Reichsstraße 3“ gespeichert. 19 → 7 Stützpunkte. Anfang hängt an Gareth, das Ende ist frei.",
        );
        expect(meldungText({ ...gespeichert, mitgezogen: [] })).toBe(
            "✓ „Reichsstraße 3“ gespeichert. Anfang hängt an Gareth, das Ende ist frei.",
        );
    });

    it("Konflikt: wer und wann, der Entwurf bleibt ungespeichert; ohne Zeitpunkt „gerade“, ohne Namen ohne Person", () => {
        expect(meldungText({ art: "konflikt", publicId: "w", wer: "Thomas", wann: undefined })).toBe(
            "Thomas hat den Weg gerade geändert; der Entwurf ist nicht gespeichert. Verwerfen und neu beginnen.",
        );
        expect(meldungText({ art: "konflikt", publicId: "w", wer: undefined, wann: undefined })).toBe(
            "Der Weg wurde gerade geändert; der Entwurf ist nicht gespeichert. Verwerfen und neu beginnen.",
        );
        expect(meldungText({ art: "abgelehnt", publicId: "w", satz: "Nein." })).toBe("Nein.");
        expect(meldungText({ art: "verworfen", publicId: "w", name: "Hohlweg" })).toBe(
            "Änderungen an „Hohlweg“ verworfen.",
        );
    });

    it("🔴 „Neuer Fluss“ und „Neuer Bach“ nennen, was entsteht (Befund der Hauptorchestrierung, Stage 2026-10-20), als ganze Sätze je Sprache", () => {
        expect(t(neuerWegSatz("fluss", "titel"))).toBe("Neuer Fluss");
        expect(t(neuerWegSatz("bach", "titel"))).toBe("Neuer Bach");
        expect(t(neuerWegSatz("weg", "titel"))).toBe("Neuer Weg");
        expect(neuerWegGrund("zuWenig", "fluss")).toBe("Ein Fluss braucht mindestens zwei Punkte.");
        expect(neuerWegGrund("zuWenig")).toBe("Ein Weg braucht mindestens zwei Punkte.");
        expect(t(neuerWegSatz("bach", "frage"))).toBe("Neuen Bach verwerfen? Nichts davon ist gespeichert.");
        expect(neuerWegMeldungText({ art: "verworfen", anlage: "bach" })).toBe(
            "Neuer Bach verworfen. Nichts gespeichert.",
        );
        expect(neuerWegMeldungText({ art: "verworfen" })).toBe("Neuer Weg verworfen. Nichts gespeichert.");
        expect(neuerWegMeldungText({ art: "serverfehler", status: 500, anlage: "fluss" })).toContain(
            "Der Server konnte den Fluss nicht anlegen (Fehler 500).",
        );
        // Geschlecht und Fall wechseln mit der Art: kein eingesetztes Wort.
        setLocale("fr");
        expect(t(neuerWegSatz("fluss", "titel"))).toBe("Nouvelle rivière");
        expect(t(neuerWegSatz("bach", "titel"))).toBe("Nouveau ruisseau");
        setLocale("pl");
        expect(neuerWegGrund("zuWenig", "bach")).toBe("Strumień potrzebuje co najmniej dwóch punktów.");
    });
});

describe("Das Schild beim Zeichnen eines neuen Flusses (Vali 2026-11-08)", () => {
    const schild = (ziel: Ziel) =>
        neuerWegSchild(
            { treffer: { ziel, at: ziel.at, abstand: 0 }, lage: "weiter", tut: "einrasten", schirm: { x: 0, y: 0 } },
            "fluss",
        );
    const at = { x: 1, y: 2 };

    it("🔴 an einer Fläche Ecke oder Kante wie bei „Neue Fläche“, an einem Fluss Kante oder Stützpunkt; nie „Stützpunkt“ einer Fläche", () => {
        expect(schild({ art: "ecke", at, objekt: "see", name: "Probesee" }).name).toBe("Ecke von Probesee");
        expect(schild({ art: "kante", at, bis: at, objekt: "see", name: "Probesee" }).name).toBe("Kante von Probesee");
        expect(schild({ art: "kante", at, bis: at, objekt: "see", name: "" }).name).toBe("Kante einer Fläche");
        const stelle = { objekt: "fluss", nr: 0, index: 3 };
        expect(schild({ art: "kante", at, bis: at, objekt: "fluss", name: "Nagrach", stelle }).name).toBe(
            "Kante von Nagrach",
        );
        expect(schild({ art: "kante", at, bis: at, objekt: "fluss", name: "Flussweg-12", stelle }).name).toBe(
            "Kante von Unbezeichneter Fluss",
        );
        expect(schild({ art: "ecke", at, objekt: "fluss", name: "Nagrach", stelle }).name).toBe(
            "Stützpunkt von Nagrach",
        );
        expect(schild({ art: "ecke", at, objekt: "see", name: "Probesee" }).tut).toBe(
            t("wegeditor.neu.schild.anschluss"),
        );
    });
});
