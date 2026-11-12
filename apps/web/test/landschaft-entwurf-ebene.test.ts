import { describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import { cartographyForType } from "@avesmaps3d/shared";
import { entwurfsFlaechen } from "../src/landschaftseditor/entwurf-ebene.ts";
import type { LandschaftBearbeitung } from "../src/landschaftseditor/landschaftseditor-steuerung.ts";

/**
 * Welche Flächen die Karte als Entwurf zeichnet (WI-0178; Betreiber 2026-10-18 „A (Empfehlung)“, Fund „Tal am Donnerkessel“).
 * Problemfälle: Eine Fläche mit neuer Ebene im Entwurf fehlt; eine unveränderte wird doppelt gezeichnet; die Farbe ist die der alten Art.
 */
const TAL = "b450b96c-85bd-4ce0-8d28-86c3e90a5a65";
const RING: [number, number][] = [
    [630, 665],
    [646, 665],
    [646, 680],
    [630, 680],
];

function bearbeitung(felder: { ebene: string; art: string | undefined }): LandschaftBearbeitung {
    const detail = {
        id: TAL,
        name: "Tal am Donnerkessel",
        layer: "topographie",
        type: "tal",
        areas: [{ id: "a-1", polygons: [[RING]], affectsPaths: true, revision: 1 }],
    };
    return {
        detail: shallowRef(detail),
        stand: shallowRef({ felder: { name: detail.name, ...felder }, form: undefined }),
    } as unknown as LandschaftBearbeitung;
}

describe("Flächen im Entwurf auf der Karte", () => {
    it("🔴 Topographie/Tal → Vegetation/Flussland: die Fläche steht in der Vegetation, in der Farbe von Flussland", () => {
        const [flaeche, ...rest] = entwurfsFlaechen([bearbeitung({ ebene: "vegetation", art: "flussland_flusstal" })]);
        expect(rest).toHaveLength(0);
        expect(flaeche).toEqual({
            id: TAL,
            ebene: "vegetation",
            farbe: cartographyForType("flussland_flusstal").fill,
            polygone: [[RING]],
        });
    });

    it("ohne Änderung an Ebene und Art nichts; nach neuer Ebene ohne Art in der Farbe ohne Art", () => {
        expect(entwurfsFlaechen([bearbeitung({ ebene: "topographie", art: "tal" }), undefined])).toEqual([]);
        expect(entwurfsFlaechen([bearbeitung({ ebene: "vegetation", art: undefined })])[0]?.farbe).toBe(
            cartographyForType(undefined).fill,
        );
    });
});
