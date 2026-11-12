import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { TerritoryPointer } from "@avesmaps3d/shared";
import { DEFAULT_LANDSCAPE_SELECTION, type MapView } from "@avesmaps3d/shared";
import { buildPlaceStyle } from "../src/map/place-layers";
import {
    buildMehrfachMarkierungLayers,
    createMehrfachMarkierung,
    folgeMehrfachauswahl,
    type Mehrfachmarkierung,
} from "../src/map/mehrfach-markierung";
import { buildAreaSelectionLayers, type DrawnArea } from "../src/map/area-selection";
import { LANDSCAPE_SOURCE_ID, WATER_SOURCE_ID } from "../src/map/landscape-layers";

/**
 * Die Mehrfachauswahl auf der Karte (Betreiber 2026-10-20: „auf der karte, gelb markier wär auch toll“). Problemfälle: Ein angehaktes
 * Gebiet leuchtet nicht oder in einer anderen Farbe als ein einzeln gewähltes; abgehakt bleibt es gelb; ausgeschaltet bleiben alle gelb;
 * außerhalb der politischen Ansicht fehlt dem Stil die Kachelquelle der Gebiete.
 */
const A = "a4a4a4a4-0000-4000-8000-0000000000a1";
const B = "a4a4a4a4-0000-4000-8000-0000000000b2";
const C = "a4a4a4a4-0000-4000-8000-0000000000c3";
const ZEIGER: TerritoryPointer = { schemaVersion: 1, revision: "abcdef012345", displayYearBf: 1049 };

function stil(
    view: MapView,
    mehrfach: readonly Mehrfachmarkierung[],
    peakUrl?: string,
    mehr: { waterUrl?: string; areaSelection?: DrawnArea } = {},
) {
    return buildPlaceStyle({
        tileUrl: "/v/place/{z}/{x}/{y}",
        landscapeUrl: "/v/landscape/{z}/{x}/{y}",
        landscapeRunUrl: "/v/run/{z}/{x}/{y}",
        mapLabelUrl: "/v/label/{z}/{x}/{y}",
        climateUrl: "/v/climate/{z}/{x}/{y}",
        pathUrl: "/v/path/{z}/{x}/{y}",
        pathLabelUrl: "/v/path-label/{z}/{x}/{y}",
        powerlineUrl: "/v/powerline/{z}/{x}/{y}",
        leyNodeUrl: "/v/ley-node/{z}/{x}/{y}",
        basemap: undefined,
        seriesId: "original",
        view,
        landscapeSelection: DEFAULT_LANDSCAPE_SELECTION,
        territories: ZEIGER,
        mehrfachMarkierung: mehrfach,
        ...(peakUrl ? { peakUrl } : {}),
        ...mehr,
    });
}

describe("Mehrfachauswahl gelb auf der Karte", () => {
    it("🔴 drei angehakte Gebiete leuchten wie ein einzeln gewähltes: Füllung, Schein, Kontur, dieselbe Farbe, ein Filter über alle drei", () => {
        const ebenen = buildMehrfachMarkierungLayers([{ art: "territory", ids: [A, B, C] }], { territoryData: true });
        expect(ebenen.map((x) => x.id)).toEqual([
            "mehrfach-territory-fill",
            "mehrfach-territory-glow",
            "mehrfach-territory-line",
        ]);
        const einzeln = buildAreaSelectionLayers({
            kind: "territory",
            id: A,
            name: null,
            type: "",
            anchor: { x: 0, y: 0 },
        });
        expect(ebenen.map((x) => ("paint" in x ? x.paint : undefined))).toEqual(
            einzeln.map((x) => ("paint" in x ? x.paint : undefined)),
        );
        const filter = JSON.stringify("filter" in ebenen[0]! ? ebenen[0].filter : undefined);
        for (const id of [A, B, C]) expect(filter).toContain(id);
    });

    it("🔴 abhaken nimmt die Markierung weg, ausschalten alle; ohne Gebietskacheln zeichnet nichts", async () => {
        const markierung = createMehrfachMarkierung();
        const an = ref(true);
        const angehakt = ref<readonly string[]>([A, B, C]);
        const stop = folgeMehrfachauswahl(
            markierung,
            "gebiete",
            "territory",
            () => an.value,
            () => angehakt.value,
        );
        expect(markierung.stand.value).toEqual([{ art: "territory", ids: [A, B, C] }]);
        angehakt.value = [A, C];
        await nextTick();
        expect(markierung.stand.value).toEqual([{ art: "territory", ids: [A, C] }]);
        an.value = false;
        await nextTick();
        expect(markierung.stand.value).toEqual([]);
        an.value = true;
        await nextTick();
        stop();
        expect(markierung.stand.value).toEqual([]);
        expect(buildMehrfachMarkierungLayers([{ art: "territory", ids: [A] }], { territoryData: false })).toEqual([]);
        expect(buildMehrfachMarkierungLayers([{ art: "territory", ids: [] }], { territoryData: true })).toEqual([]);
    });

    it("mehrere Quellen derselben Art vereinigen sich ohne Doppel; eine leere Meldung löscht nur die eigene", () => {
        const markierung = createMehrfachMarkierung();
        markierung.setze("gebiete", "territory", [A, B]);
        markierung.setze("andere", "territory", [B, C]);
        expect(markierung.stand.value).toEqual([{ art: "territory", ids: [A, B, C] }]);
        markierung.setze("andere", "territory", []);
        expect(markierung.stand.value).toEqual([{ art: "territory", ids: [A, B] }]);
    });

    it("🔴 auch in Standard und Landschaft: der Stil trägt dann die Kachelquelle der Gebiete und ist gültig", () => {
        for (const view of ["standard", "landscapes", "political"] as MapView[]) {
            const mit = stil(view, [{ art: "territory", ids: [A, B, C] }]);
            expect(validateStyleMin(mit), view).toEqual([]);
            expect(
                mit.layers.some((x) => x.id === "mehrfach-territory-fill"),
                view,
            ).toBe(true);
            const ohne = stil(view, []);
            expect(
                ohne.layers.some((x) => x.id.startsWith("mehrfach-")),
                view,
            ).toBe(false);
        }
    });

    it("🔴 Derographie: angehakte Landschaften leuchten wie eine einzeln gewählte, angehakte Gipfel mit gelbem Hof, nur wo die Gipfelkacheln liegen", () => {
        const flaechen = buildMehrfachMarkierungLayers([{ art: "landscape", ids: [A, B] }], { territoryData: false });
        const einzeln = buildAreaSelectionLayers({
            kind: "landscape",
            id: A,
            group: [A, B],
            name: null,
            type: "",
            anchor: { x: 0, y: 0 },
        });
        expect(flaechen.map((e) => e.id)).toEqual(
            einzeln.map((e) => e.id.replace(/^area-selection/, "mehrfach-landscape")),
        );
        expect(flaechen.map((e) => ("paint" in e ? e.paint : undefined))).toEqual(
            einzeln.map((e) => ("paint" in e ? e.paint : undefined)),
        );
        const ohneKacheln = buildMehrfachMarkierungLayers([{ art: "peak", ids: [C] }], { territoryData: false });
        expect(ohneKacheln).toEqual([]);
        const hof = buildMehrfachMarkierungLayers([{ art: "peak", ids: [C] }], {
            territoryData: false,
            peakData: true,
        });
        expect(hof.map((e) => e.id)).toEqual(["mehrfach-peak-hof"]);
        expect((hof[0] as { filter: unknown }).filter).toEqual(["in", ["get", "public_id"], ["literal", [C]]]);
        const mitGipfeln = stil(
            "landscapes",
            [
                { art: "landscape", ids: [A] },
                { art: "peak", ids: [C] },
            ],
            "/v/peak/{z}/{x}/{y}",
        );
        expect(validateStyleMin(mitGipfeln)).toEqual([]);
        expect(mitGipfeln.layers.some((x) => x.id === "mehrfach-landscape-fill")).toBe(true);
    });

    it("🔴 Umschalt-Klick auf der Karte geht nur an ein bereites Ziel seiner Art; sonst ist er ein gewöhnlicher Klick", () => {
        const markierung = createMehrfachMarkierung();
        const genommen: string[] = [];
        let bereit = false;
        expect(markierung.umschalteAufKarte("territory", A)).toBe(false);
        const ab = markierung.ziel("territory", { bereit: () => bereit, umschalten: (id) => genommen.push(id) });
        expect(markierung.umschalteAufKarte("territory", A)).toBe(false);
        bereit = true;
        expect(markierung.umschalteAufKarte("territory", A)).toBe(true);
        expect(markierung.umschalteAufKarte("landscape", B)).toBe(false);
        ab();
        expect(markierung.umschalteAufKarte("territory", C)).toBe(false);
        expect(genommen).toEqual([A]);
    });

    it("🔴 ein See leuchtet über seinem Wasser, einzeln gewählt und angehakt (Stage-Fund 2026-10-20, Blutsee in Landschaft · Topo)", () => {
        // Der See liegt geglättet in der Wasserquelle über den Füllungen (`buildSmoothWaterLayers`); läge das Gelb darunter, deckte ihn das
        // Blau zu. Einzeln leuchtet er in der Wasserquelle, angehakt in der Landschaftsquelle (`region_area_render` trägt Seen mit).
        const see: DrawnArea = {
            kind: "landscape",
            id: A,
            name: "Blutsee",
            type: "see",
            anchor: { x: 0, y: 0 },
            label: "Blutsee",
        };
        const s = stil("landscapes", [{ art: "landscape", ids: [B] }], undefined, {
            waterUrl: "/v/water/{z}/{x}/{y}",
            areaSelection: see,
        });
        expect(validateStyleMin(s)).toEqual([]);
        const ids = s.layers.map((x) => x.id);
        const wasser = s.layers.flatMap((x, i) =>
            "source" in x && x.source === WATER_SOURCE_ID && !x.id.startsWith("area-") ? [i] : [],
        );
        expect(wasser.length).toBeGreaterThan(0);
        const einzeln = s.layers.find((x) => x.id === "area-selection-fill");
        expect(einzeln && "source" in einzeln ? einzeln.source : undefined).toBe(WATER_SOURCE_ID);
        expect(ids.indexOf("area-selection-fill")).toBeGreaterThan(Math.max(...wasser));
        const angehakt = s.layers.find((x) => x.id === "mehrfach-landscape-fill");
        expect(angehakt && "source" in angehakt ? angehakt.source : undefined).toBe(LANDSCAPE_SOURCE_ID);
        expect(ids.indexOf("mehrfach-landscape-fill")).toBeGreaterThan(Math.max(...wasser));
    });

    it("🔴 mehrere Fenster einer Art: Das jüngste bereite nimmt den Umschalt-Klick, ein abgelegtes jüngeres nicht", () => {
        const markierung = createMehrfachMarkierung();
        const genommen: string[] = [];
        markierung.ziel("landscape", { bereit: () => true, umschalten: (id) => genommen.push(`alt:${id}`) });
        const abJung = markierung.ziel("landscape", {
            bereit: () => false,
            umschalten: (id) => genommen.push(`jung:${id}`),
        });
        expect(markierung.umschalteAufKarte("landscape", "a")).toBe(true);
        expect(genommen).toEqual(["alt:a"]);
        abJung();
        expect(markierung.umschalteAufKarte("landscape", "b")).toBe(true);
        expect(genommen).toEqual(["alt:a", "alt:b"]);
    });
});
