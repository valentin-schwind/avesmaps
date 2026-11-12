import { describe, expect, it } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { createArrivalTracker, useArrival } from "../src/info-panel/panel-arrival.ts";

/**
 * Wann der Inhalt des Infopanels eingeblendet wird (WI-0088 P1). Die Regel ist eine Zustandsfolge und wird darum ohne Browser
 * geprüft; wie es aussieht, messen `e2e/info-panel-arrival.spec.ts` und das Abnahmeblatt.
 */
describe("🔴 eingeblendet wird nur, was nach einer sichtbaren Wartezeit eintrifft (WI-0088 P1)", () => {
    it("A2: Das Panel wartet sichtbar, dann kommt die Antwort - der Inhalt blendet ein", () => {
        const arriving = createArrivalTracker();
        expect(arriving({ key: "place:gareth", loading: true })).toBe(false);
        expect(arriving({ key: "place:gareth", loading: false })).toBe(true);
    });

    it("A1: Die Antwort steht schon im ersten Bild (Cache) - nichts blendet ein", () => {
        const arriving = createArrivalTracker();
        // Kein Zwischenbild mit Wartezeile: Das Panel hat nie gewartet, also hat die Bewegung nichts zu überbrücken.
        expect(arriving({ key: "place:gareth", loading: false })).toBe(false);
    });

    it("🔴 eine Wartezeit zählt nur für IHREN Inhalt: Der zweite Gegenstand erbt sie nicht (A6)", () => {
        const arriving = createArrivalTracker();
        expect(arriving({ key: "place:gareth", loading: true })).toBe(false);
        // Dazwischen wird ein anderer Gegenstand geöffnet, dessen Antwort sofort da ist.
        expect(arriving({ key: "area:waldwildnis", loading: false })).toBe(false);
    });

    it("eine Wiederholung nach einem Fehlschlag wartet wieder sichtbar, also blendet sie wieder ein (A7)", () => {
        const arriving = createArrivalTracker();
        expect(arriving({ key: "place:gareth", loading: true })).toBe(false);
        // Fehlschlag: kein Ladezustand mehr, aber auch kein Inhalt - die Wartezeit bleibt diesem Schlüssel zugeordnet.
        expect(arriving({ key: "place:gareth", loading: false })).toBe(true);
        expect(arriving({ key: "place:gareth", loading: true })).toBe(false);
        expect(arriving({ key: "place:gareth", loading: false })).toBe(true);
    });

    it("ohne Auswahl blendet nichts ein", () => {
        const arriving = createArrivalTracker();
        expect(arriving(undefined)).toBe(false);
        expect(arriving({ key: "place:gareth", loading: true })).toBe(false);
        expect(arriving(undefined)).toBe(false);
        expect(arriving({ key: "place:gareth", loading: false })).toBe(true);
    });

    it("💣 die Bindung ist eifrig: Sie sieht die Wartezeit auch, wenn die Vorlage sie währenddessen nicht liest (A9)", async () => {
        // Genau der Fehler vom 2026-10-06: Der Katalogabschnitt liest die Marke nur am Baustein der FERTIGEN Liste. Ein `computed`
        // wäre während des Ladens nie ausgewertet worden, und die Liste hätte ohne Einblendung dagestanden.
        const scope = effectScope();
        const loading = ref(true);
        const arriving = scope.run(() =>
            useArrival(() => ({ key: "literature:place:gareth", loading: loading.value })),
        );
        expect(arriving?.value).toBe(false);
        loading.value = false;
        await nextTick();
        expect(arriving?.value).toBe(true);
        scope.stop();
    });

    it("jeder Beobachter gehört seinem Bauteil: Die Katalogabschnitte warten für sich (A9)", () => {
        const panel = createArrivalTracker();
        const katalog = createArrivalTracker();
        panel({ key: "place:gareth", loading: true });
        expect(panel({ key: "place:gareth", loading: false })).toBe(true);
        // Der Abschnitt beginnt JETZT erst zu laden - der Beobachter des Panels weiß davon nichts.
        expect(katalog({ key: "literature:place:gareth", loading: true })).toBe(false);
        expect(katalog({ key: "literature:place:gareth", loading: false })).toBe(true);
    });
});
