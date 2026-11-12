import { nextTick, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
    frischerSchutz,
    nachKopieren,
    nachMerken,
    pruefeWeiter,
    trotzdemSchluessel,
    warnungSteht,
    type Schutz,
    type WeiterArt,
} from "../src/photobox/fertig-schutz.ts";
import { createReisebildSteuerung, type ReisebildSteuerung } from "../src/photobox/reisebild-besucher.ts";

/**
 * Der Linkschutz hängt an der STEUERUNG, nicht an den Knöpfen des Bestätigungsfensters (WI-0272 S3, Review I1): Jeder Weg, der die Bestätigung ersetzen oder schließen würde (Kartenmenü „Eigenes
 * Bild hinzufügen“ und „Meine Reisebilder“, „Stand ansehen“, ein Fenster der Meldungen), fragt zuerst den Wächter, den das Bestätigungsfenster einhängt, solange der Link weder kopiert noch gemerkt ist.
 * Hier steht der Ablauf ohne Browser; den Browser prüft `e2e/reisebild-merken.spec.ts`.
 */

function umfeld() {
    const andere = {
        anzeige: shallowRef<unknown>(undefined),
        schliesse: vi.fn(() => {
            andere.anzeige.value = undefined;
        }),
    };
    const s = createReisebildSteuerung({ naechsterOrt: () => Promise.resolve(undefined), andere });
    return { s, andere };
}

/** Das Bestätigungsfenster im Kleinen: derselbe Ablauf wie `weiter` in `reisebild-fenster.vue` (Schutz, gemerkt, der wartende Weg). */
function bestaetigung(s: ReisebildSteuerung, start: { gemerkt?: boolean } = {}) {
    const zustand: { schutz: Schutz; gemerkt: boolean; ausstehend: (() => void) | undefined } = {
        schutz: frischerSchutz(),
        gemerkt: start.gemerkt === true,
        ausstehend: undefined,
    };
    const abmelden = s.schuetze((weg: WeiterArt, danach?: () => void) => {
        const ergebnis = pruefeWeiter(zustand.schutz, weg, zustand.gemerkt);
        zustand.schutz = ergebnis.schutz;
        if (ergebnis.halt) zustand.ausstehend = danach;
        return !ergebnis.halt;
    });
    return { zustand, abmelden };
}

const LAGE = { x: 560, y: 540 };
const ANDERE_LAGE = { x: 300, y: 200 };

describe("🔴 die Steuerung fragt den Wächter, bevor die Bestätigung verschwindet", () => {
    it("ohne Wächter geht jeder Weg wie bisher durch", () => {
        const { s } = umfeld();
        s.oeffne(LAGE);
        s.oeffne(ANDERE_LAGE, undefined, { neu: true });
        expect(s.anzeige.value).toMatchObject({ art: "formular", nr: 2, stelle: ANDERE_LAGE });
        s.oeffneMeine();
        expect(s.anzeige.value).toMatchObject({ art: "meine" });
        s.oeffneStatus(null);
        expect(s.anzeige.value).toMatchObject({ art: "status" });
        s.schliesse();
        expect(s.anzeige.value).toBeUndefined();
    });

    it("🔴 Kartenmenü „Eigenes Bild hinzufügen“: der erste Versuch hält an, die Bestätigung bleibt, der zweite geht durch", () => {
        const { s, andere } = umfeld();
        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const { zustand } = bestaetigung(s);
        const davor = s.anzeige.value;
        andere.schliesse.mockClear();
        s.oeffne(ANDERE_LAGE);
        expect(s.anzeige.value).toBe(davor);
        expect(warnungSteht(zustand.schutz)).toBe(true);
        // Das Fenster der Meldungen wird erst geschlossen, wenn der Weg wirklich weitergeht.
        expect(andere.schliesse).not.toHaveBeenCalled();
        // Der Besucher wählt es noch einmal.
        s.oeffne(ANDERE_LAGE);
        expect(s.anzeige.value).toMatchObject({ art: "formular", nr: 2, stelle: ANDERE_LAGE });
        expect(s.anzeige.value).not.toHaveProperty("abgesendet");
        expect(andere.schliesse).toHaveBeenCalledTimes(1);
    });

    it("🔴 „Meine Reisebilder“: der erste Versuch hält an, der zweite geht durch", () => {
        const { s } = umfeld();
        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const { zustand } = bestaetigung(s);
        const davor = s.anzeige.value;
        s.oeffneMeine();
        expect(s.anzeige.value).toBe(davor);
        expect(warnungSteht(zustand.schutz)).toBe(true);
        s.oeffneMeine();
        expect(s.anzeige.value).toMatchObject({ art: "meine" });
    });

    it("🔴 „Stand ansehen“ (oeffneStatus) und das Schließen halten ebenso einmal an", () => {
        const { s } = umfeld();
        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const { zustand } = bestaetigung(s);
        const davor = s.anzeige.value;
        s.oeffneStatus("A".repeat(43));
        expect(s.anzeige.value).toBe(davor);
        expect(zustand.schutz.gewarnt).toBe("stand");
        // Egal welcher Weg es zuerst war: der zweite geht durch.
        s.schliesse();
        expect(s.anzeige.value).toBeUndefined();
    });

    it("🔴 der wartende Weg bleibt erhalten: „Trotzdem weiter“ führt ihn aus, ohne dass er noch einmal gewählt werden muss", () => {
        const { s } = umfeld();
        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const { zustand } = bestaetigung(s);
        s.oeffneMeine();
        expect(s.anzeige.value).toMatchObject({ art: "formular" });
        expect(zustand.ausstehend).toBeTypeOf("function");
        zustand.ausstehend?.();
        expect(s.anzeige.value).toMatchObject({ art: "meine" });
    });

    it("🔴 nach dem Kopieren oder Merken gibt es gar keine Warnung, jeder Weg geht sofort durch", () => {
        const { s } = umfeld();
        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const kopiert = bestaetigung(s);
        kopiert.zustand.schutz = nachKopieren();
        s.oeffneMeine();
        expect(s.anzeige.value).toMatchObject({ art: "meine" });
        expect(warnungSteht(kopiert.zustand.schutz)).toBe(false);
        kopiert.abmelden();

        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const gemerkt = bestaetigung(s, { gemerkt: true });
        s.oeffne(ANDERE_LAGE);
        expect(s.anzeige.value).toMatchObject({ art: "formular", stelle: ANDERE_LAGE });
        expect(gemerkt.zustand.schutz.gewarnt).toBeUndefined();
        // Wird das Häkchen später genommen, hält der nächste Weg wieder einmal an.
        gemerkt.zustand.schutz = nachMerken(gemerkt.zustand.schutz);
        gemerkt.zustand.gemerkt = false;
        s.markiereAbgesendet();
        s.oeffneMeine();
        expect(s.anzeige.value).toMatchObject({ art: "formular" });
    });

    it("🔴 ein Fenster der Meldungen schließt die Bestätigung erst beim zweiten Versuch", async () => {
        const { s, andere } = umfeld();
        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const { zustand } = bestaetigung(s);
        andere.anzeige.value = { art: "formular" };
        await nextTick();
        expect(s.anzeige.value).toMatchObject({ art: "formular", abgesendet: true });
        expect(warnungSteht(zustand.schutz)).toBe(true);
        // Das Fenster der Meldungen geht zu und wird noch einmal geöffnet: Jetzt geht es durch.
        andere.anzeige.value = undefined;
        await nextTick();
        andere.anzeige.value = { art: "formular" };
        await nextTick();
        expect(s.anzeige.value).toBeUndefined();
    });

    it("ohne Bestätigung (Formular offen) hält nichts an: Ein weiterer Rechtsklick setzt die Stelle neu", () => {
        const { s } = umfeld();
        s.oeffne(LAGE);
        // Das Formular selbst hängt keinen Wächter ein.
        s.oeffne(ANDERE_LAGE);
        expect(s.anzeige.value).toMatchObject({ art: "formular", nr: 1, stelle: ANDERE_LAGE });
    });

    it("der Wächter geht mit dem Fenster: Abmelden räumt ihn, ein älterer Abmelder räumt keinen neueren", () => {
        const { s } = umfeld();
        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const alt = bestaetigung(s);
        alt.abmelden();
        s.oeffneMeine();
        expect(s.anzeige.value).toMatchObject({ art: "meine" });

        s.oeffne(LAGE);
        s.markiereAbgesendet();
        const neu = bestaetigung(s);
        alt.abmelden();
        s.oeffneMeine();
        // Der neue Wächter steht noch und hält an.
        expect(s.anzeige.value).toMatchObject({ art: "formular", abgesendet: true });
        expect(neu.zustand.schutz.gewarnt).toBe("meine");
    });
});

describe("der Schutz kennt „Stand ansehen“ und die Wege von außen", () => {
    it("„stand“ hält einmal an und trägt den Satz „Trotzdem weiter“", () => {
        const erster = pruefeWeiter(frischerSchutz(), "stand");
        expect(erster.halt).toBe(true);
        expect(erster.schutz).toEqual({ kopiert: false, gewarnt: "stand" });
        expect(trotzdemSchluessel(erster.schutz)).toBe("photobox.fertig.trotzdemWeiter");
        expect(pruefeWeiter(erster.schutz, "zu").halt).toBe(false);
    });

    it("nur das Schließen trägt „Trotzdem schließen“, jeder andere Weg „Trotzdem weiter“", () => {
        const wege: readonly WeiterArt[] = ["zu", "noch-eins", "stand", "meine"];
        for (const weg of wege) {
            expect(trotzdemSchluessel({ kopiert: false, gewarnt: weg }), weg).toBe(
                weg === "zu" ? "photobox.fertig.trotzdemSchliessen" : "photobox.fertig.trotzdemWeiter",
            );
        }
    });
});
