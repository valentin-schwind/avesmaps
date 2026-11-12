import { describe, expect, it, vi } from "vitest";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import { createLandschaftseditorSteuerung } from "../src/landschaftseditor/landschaftseditor-steuerung.ts";

/**
 * Der Klick auf eine Fläche im Editor-Modus (WI-0178; EDIT-0003 T34 (1): „muss automatisch kommen … Bei Orten kommt er schon
 * automatisch“). Problemfälle: Der Klick öffnet den Landschaftseditor nicht, wenn er zu ist, oder wählt die Landschaft nicht; außerhalb
 * des Editor-Modus, aus Suche oder Link oder still (`still`) nimmt er dem Infopanel den Platz; ein Ort landet im Landschaftseditor.
 */
const FLAECHE = { kind: "area", id: "a1a1a1a1-0000-4000-8000-000000000001" } as const;

function aufbau() {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 }));
    const fenster = createWerkzeugfenster(undefined);
    return { fenster, steuerung: createLandschaftseditorSteuerung(fenster, fetcher), fetcher };
}

describe("Landschaftseditor: Klick auf eine Fläche", () => {
    it("🔴 im Editor-Modus öffnet der Kartenklick das Fenster an der Landschaft, auch wenn es zu war; ein zweiter öffnet an seiner Stelle", () => {
        const { steuerung } = aufbau();
        expect(steuerung.geoeffnet(FLAECHE, { source: "map", camera: "none" }, true)).toBe(true);
        expect(steuerung.fenster.value).toHaveLength(1);
        expect(steuerung.bearbeitungVon(FLAECHE.id)).toBeDefined();
        expect(steuerung.auswahl.value).toBe(FLAECHE.id);
        const andere = { kind: "area", id: "a1a1a1a1-0000-4000-8000-000000000002" } as const;
        expect(steuerung.geoeffnet(andere, { source: "map", camera: "none" }, true)).toBe(true);
        // Je Landschaft ein Fenster (EDIT-0003 T44, D19): Die zweite öffnet an der Stelle der ersten, die erste ist abgelegt.
        expect(steuerung.fenster.value.filter((x) => x.lage !== "versenkt")).toHaveLength(1);
        expect(steuerung.fenster.value.map((x) => x.gegenstand).sort()).toEqual([FLAECHE.id, andere.id].sort());
        expect(steuerung.auswahl.value).toBe(andere.id);
        steuerung.destroy();
    });

    it("🔴 außerhalb des Editor-Modus, aus Suche oder Link, still, oder ein Ort: nichts", () => {
        const { steuerung } = aufbau();
        expect(steuerung.geoeffnet(FLAECHE, { source: "map", camera: "none" }, false)).toBe(false);
        expect(steuerung.geoeffnet(FLAECHE, { source: "search", camera: "none" }, true)).toBe(false);
        expect(steuerung.geoeffnet(FLAECHE, { source: "map", camera: "none", still: true }, true)).toBe(false);
        expect(steuerung.geoeffnet({ kind: "place", id: "p-1" }, { source: "map", camera: "none" }, true)).toBe(false);
        expect(steuerung.fenster.value).toHaveLength(0);
        expect(steuerung.auswahl.value).toBeUndefined();
        steuerung.destroy();
    });
});
