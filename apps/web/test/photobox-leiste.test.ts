import { describe, expect, it } from "vitest";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as itTafel } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import {
    KNOPF_ZAHL_MAX,
    ersteMarkierte,
    knopfZahl,
    leisteHoehe,
    leisteSichtbar,
} from "../src/photobox/reisebilder-leiste-modell.ts";
import { createReisebilderZustand } from "../src/photobox/reisebilder-zustand.ts";

/**
 * Knopf und Leiste der Reisebilder (WI-0272 S4, Aufgabe 28): die reinen Teile ohne Browser, dazu die Sprachtafeln und das Verhalten des Zustands bei einer Kachel, die fehlt.
 *
 * Problemfälle: der Knopf zeigt „0“ oder die Zahl einer gekappten Antwort als Wahrheit; die Leiste steht in einer anderen Ansicht oder verdeckt oder belegt Höhe, obwohl sie zu ist (Eckbund, Toast und
 * Panels hielten dann Platz frei); eine Kachel, deren Datei fehlt, kommt mit der nächsten Antwort wieder (die Karte fragte im Kreis); ein neuer Schlüssel fehlt in einer Sprache oder steht dort auf Deutsch.
 */

describe("Knopf: die Zahl", () => {
    it("bei 0 keine Zahl, sonst die Zahl", () => {
        expect(knopfZahl(0, false)).toBe("");
        expect(knopfZahl(1, false)).toBe("1");
        expect(knopfZahl(42, false)).toBe("42");
    });

    it("🔴 bei einer gekappten Antwort „500+“, auch wenn weniger Bilder im Bild liegen", () => {
        expect(knopfZahl(37, true)).toBe(`${String(KNOPF_ZAHL_MAX)}+`);
        expect(knopfZahl(0, true)).toBe("500+");
    });
});

describe("Leiste: sichtbar und Höhe", () => {
    const offen = { offen: true, standard: true, verdeckt: false };

    it("sichtbar nur offen, in der Standardansicht und unverdeckt", () => {
        expect(leisteSichtbar(offen)).toBe(true);
        expect(leisteSichtbar({ ...offen, offen: false })).toBe(false);
        expect(leisteSichtbar({ ...offen, standard: false })).toBe(false);
        expect(leisteSichtbar({ ...offen, verdeckt: true })).toBe(false);
    });

    it("🔴 die Höhe zählt nur, wenn sie sichtbar ist; sonst 0", () => {
        expect(leisteHoehe(offen, 118)).toBe(118);
        expect(leisteHoehe(offen, 117.6)).toBe(118);
        expect(leisteHoehe({ ...offen, offen: false }, 118)).toBe(0);
        expect(leisteHoehe({ ...offen, standard: false }, 118)).toBe(0);
        expect(leisteHoehe({ ...offen, verdeckt: true }, 118)).toBe(0);
        expect(leisteHoehe(offen, -5)).toBe(0);
    });

    it("die erste markierte Kachel in der Reihenfolge der Leiste kommt in die Mitte", () => {
        expect(ersteMarkierte(["a", "b", "c"], new Set(["c", "b"]))).toBe("b");
        expect(ersteMarkierte(["a", "b"], new Set(["x"]))).toBeUndefined();
        expect(ersteMarkierte(["a"], new Set())).toBeUndefined();
    });
});

describe("Zustand: eine Kachel, deren Datei fehlt, kommt nicht wieder", () => {
    const bild = (id: string) => ({
        id,
        lage: { x: 1, y: 1 },
        datei: { url: `/media/published/${id}.webp`, breite: 100, hoehe: 100 },
        beschreibung: id,
        entstehung: "drawing" as const,
    });

    it("🔴 `vergissBild` hält das Bild auch gegen die nächste Antwort fern, die Abfrage läuft einmal neu", () => {
        const zustand = createReisebilderZustand();
        let neu = 0;
        zustand.verbindeKarte({ schirmVon: () => undefined, zeige: () => undefined, neuLaden: () => (neu += 1) });
        zustand.setzeAntwort({ an: true, bilder: [bild("a"), bild("b")], gekappt: false });
        zustand.vergissBild("a");
        expect(zustand.bilder.value.map((b) => b.id)).toEqual(["b"]);
        expect(neu).toBe(1);
        // Der Server nennt es weiter: Die Karte zeigt es trotzdem nicht.
        zustand.setzeAntwort({ an: true, bilder: [bild("a"), bild("b")], gekappt: false });
        expect(zustand.bilder.value.map((b) => b.id)).toEqual(["b"]);
    });

    it("`gruppeVon` und `mitteFrei` ohne Karte: das Bild allein, keine Stelle", () => {
        const zustand = createReisebilderZustand();
        expect(zustand.gruppeVon("a")).toEqual(["a"]);
        expect(zustand.mitteFrei()).toBeUndefined();
    });
});

describe("Sprachtafeln: photobox.karte.*", () => {
    const tafeln = { en, fr, itTafel, es, nl, pl, sv, da } as const;
    const schluessel = Object.keys(de).filter((k) => k.startsWith("photobox.karte."));

    it("es gibt Schlüssel, und höchstens 25 neue", () => {
        expect(schluessel.length).toBeGreaterThan(0);
        expect(schluessel.length).toBeLessThanOrEqual(25);
    });

    it("🔴 alle neun Sprachen tragen genau dieselben Schlüssel", () => {
        for (const [name, tafel] of Object.entries(tafeln)) {
            const eigene = Object.keys(tafel).filter((k) => k.startsWith("photobox.karte."));
            expect(eigene.sort(), name).toEqual([...schluessel].sort());
        }
    });

    it("keine deutschen Sätze in den anderen acht Sprachen; Französisch und Niederländisch mit ’", () => {
        for (const [name, tafel] of Object.entries(tafeln)) {
            const werte = tafel as Record<string, string>;
            for (const k of schluessel) {
                const wert = werte[k] ?? "";
                const deutsch = (de as Record<string, string>)[k] ?? "";
                // Einzelwörter dürfen gleich sein (anonym, Wörter mit gleicher Schreibung); Sätze nicht.
                if (deutsch.includes(" ")) expect(wert, `${name} ${k}`).not.toBe(deutsch);
                if (name === "fr" || name === "nl") expect(wert, `${name} ${k}`).not.toContain("'");
            }
        }
    });
});
