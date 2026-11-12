import { describe, expect, it } from "vitest";
import type { EditorTerritoryForm } from "@avesmaps3d/shared";
import {
    ableitungAus,
    AUSSTEHEND_HOECHSTENS_MS,
    createAusstehendeGebiete,
    GEBIETE_EBENE,
} from "../src/gebietseditor/ausstehende-gebiete.ts";
import { geschriebeneFlaechen } from "../src/gebietseditor/gebietsform-anbindung.ts";
import type { FormStand } from "../src/map/geometrie/formentwurf.ts";
import type { Teil } from "../src/map/geometrie/geometrie.ts";

/**
 * Gespeicherte Gebietsflächen, bis die Ableitung sie zeichnet (WI-0209; Betreiberfunde 2026-10-19 „sofort von der karte verschwunden“ und
 * „nur die kontur … wird aktualisiert“). Problemfälle: Eine Fläche verschwindet mit der Ableitung eines anderen Auftrags, der die
 * Speicherung noch nicht kannte; eine Fläche bleibt für immer stehen; ein Nachbar fehlt nach „Fertig“ der Form oder trägt die Farbe des
 * bearbeiteten Gebiets.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const ring = (x: number): [number, number][] => [
    [x, 0],
    [x + 10, 0],
    [x + 10, 10],
];

describe("Ausstehende Gebietsflächen", () => {
    it("🔴 bis die eigene Ableitung meldet: eine andere nimmt sie nicht mit; ohne Auftrag geht sie mit jeder; die Farbe aus der Liste", () => {
        let uhr = 0;
        const s = createAusstehendeGebiete({
            farbe: (gebiet) => (gebiet === B ? "#7a8c3c" : undefined),
            jetzt: () => uhr,
        });
        s.merke([
            { flaeche: "f1", gebiet: A, farbe: "#b2b065", polygone: [[ring(0)]], job: "job-2" },
            { flaeche: "f2", gebiet: B, polygone: [[ring(20)]], job: "job-2" },
            { flaeche: "f3", gebiet: "unbekannt", polygone: [[ring(40)]] },
        ]);
        expect(s.flaechen.value).toEqual([
            { id: "f1", ebene: GEBIETE_EBENE, farbe: "#b2b065", polygone: [[ring(0)]] },
            { id: "f2", ebene: GEBIETE_EBENE, farbe: "#7a8c3c", polygone: [[ring(20)]] },
            { id: "f3", ebene: GEBIETE_EBENE, farbe: "#888888", polygone: [[ring(40)]] },
        ]);
        // Der frühere Auftrag (lief schon, als gespeichert wurde) meldet zuerst: Nur die Fläche ohne Auftrag geht.
        s.abgeleitet("job-1");
        expect(s.flaechen.value.map((f) => f.id)).toEqual(["f1", "f2"]);
        // Eine spätere Speicherung derselben Fläche ersetzt die frühere.
        s.merke([{ flaeche: "f1", gebiet: A, farbe: "#b2b065", polygone: [[ring(5)]], job: "job-2" }]);
        expect(s.flaechen.value.map((f) => [f.id, f.polygone[0]![0]![0]])).toEqual([
            ["f2", [20, 0]],
            ["f1", [5, 0]],
        ]);
        s.abgeleitet("job-2");
        expect(s.flaechen.value).toEqual([]);
        // Meldet keine Ableitung (der Auftrag fand nichts zu rechnen), fällt die Fläche nach der Frist weg.
        s.merke([{ flaeche: "f4", gebiet: A, polygone: [[ring(0)]], job: "job-3" }]);
        uhr += AUSSTEHEND_HOECHSTENS_MS;
        s.abgeleitet("job-9");
        expect(s.flaechen.value).toEqual([]);
    });

    it("der Auftrag kommt aus der Quittung", () => {
        expect(
            ableitungAus({
                derivedWork: [
                    { kind: "tiles", state: "done" },
                    { kind: "territory_derive", jobId: "job-7", state: "queued" },
                ],
            }),
        ).toBe("job-7");
        expect(ableitungAus({ derivedWork: [] })).toBeUndefined();
    });

    it("🔴 nach „Fertig“ der Form: jede geänderte Fläche, auch die mitgezogene des Nachbarn mit ihrem Gebiet; unveränderte fehlen", () => {
        const teil = (objekt: string, punkte: [number, number][]): Teil => ({
            objekt,
            name: objekt,
            nr: 0,
            art: "ring",
            punkte: punkte.map(([x, y]) => ({ x, y })),
            revision: 3,
        });
        const start: FormStand = {
            teile: [teil("eigen", ring(0))],
            nachbarn: [teil("nachbar", ring(10)), teil("fern", ring(50))],
        };
        const jetzt: FormStand = {
            teile: [teil("eigen", ring(1))],
            nachbarn: [teil("nachbar", ring(11)), teil("fern", ring(50))],
        };
        const gelesen = {
            id: A,
            areas: [{ id: "eigen" }],
            neighbors: [
                { id: "nachbar", territory: B },
                { id: "fern", territory: B },
            ],
        } as unknown as EditorTerritoryForm;
        const aufbau = new Map([
            ["eigen", [1]],
            ["nachbar", [1]],
            ["fern", [1]],
        ]);
        expect(geschriebeneFlaechen(start, jetzt, aufbau, gelesen, "#b2b065")).toEqual([
            { flaeche: "eigen", gebiet: A, farbe: "#b2b065", polygone: [[ring(1)]] },
            { flaeche: "nachbar", gebiet: B, farbe: undefined, polygone: [[ring(11)]] },
        ]);
    });
});
