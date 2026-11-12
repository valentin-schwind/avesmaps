import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { AVENTURIA_CARTOGRAPHY, type DisplayHeightPointer, type RasterPyramidPointer } from "@avesmaps3d/shared";
import {
    beobachteHoehenlinien,
    hoehenlinienImStil,
    hoehenlinienZeigen,
} from "../src/landschaftseditor/hoehenlinien-schalter.ts";
import { landscapeFillLayerId } from "../src/map/landscape-layers.ts";
import { BASEMAP_LAYER_ID, buildPlaceStyle, untergrundDeckkraft } from "../src/map/place-layers.ts";
import {
    CONTOUR_DETAIL_LAYER_ID,
    CONTOUR_DETAIL_SOURCE_ID,
    CONTOUR_LABEL_LAYER_ID,
    CONTOUR_LAYER_IDS,
    CONTOUR_SOURCE_ID,
    HEIGHT_TINT_LAYER_ID,
    PEAK_LAYER_ID,
} from "../src/map/topography-layers.ts";

/**
 * Höhenlinien ausblenden und Höhenstufen unter ◐ (WI-0236; Betreiber 2026-10-19: „Wir wollen sowohl für die Topographie (Höhenlinien und
 * Höhenstufen) die möglichkeit haben die feinen linien mit den höhenmetern auszublenden. Höhenstufen unterstützen übrigens keine
 * transparenz - im gegensatz zum normalen höhenlinienmodus.“).
 *
 * Problemfälle: Der Schalter nimmt nur die Linien und lässt die Zahlen stehen (oder umgekehrt), lässt die Kachelquellen laden, nimmt
 * Gipfel oder Höhenstufen mit, wirkt für Besucher oder am Telefon; ◐ ändert in den Höhenstufen nichts, weil die deckenden Stufen über
 * dem Untergrund liegen; in den Höhenlinien rutscht der Untergrund von seinem Platz über dem Papier.
 */

const HOEHEN: DisplayHeightPointer = { schemaVersion: 1, revision: "cca6668ddc09", demRevision: "cce4be9fbe78" };
const RASTER: RasterPyramidPointer = {
    schemaVersion: 1,
    series: "original",
    revision: "3f2a9c01be47",
    manifest: "3f2a9c01be475d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c5d0c",
    format: "webp",
    tileSize: 512,
    maxNativeZoom: 6,
};

function stil(
    topography: "hoehenlinien" | "hoehenstufen",
    extra: { hoehenlinien?: boolean; untergrund?: number; flaechenTreffer?: boolean } = {},
) {
    return buildPlaceStyle({
        tileUrl: "/p/{z}/{x}/{y}",
        landscapeUrl: "/l/{z}/{x}/{y}",
        landscapeRunUrl: "/r/{z}/{x}/{y}",
        mapLabelUrl: "/m/{z}/{x}/{y}",
        climateUrl: "/c/{z}/{x}/{y}",
        pathUrl: "/w/{z}/{x}/{y}",
        pathLabelUrl: "/wl/{z}/{x}/{y}",
        powerlineUrl: "/k/{z}/{x}/{y}",
        leyNodeUrl: "/n/{z}/{x}/{y}",
        contourUrl: "/tiles/vector/terrain_contour_render/{z}/{x}/{y}",
        contourDetailUrl: "/tiles/vector/terrain_contour_detail_render/{z}/{x}/{y}",
        peakUrl: "/tiles/vector/terrain_peak_render/{z}/{x}/{y}",
        heightBandUrl: "/tiles/vector/terrain_height_band_render/{z}/{x}/{y}",
        waterUrl: "/tiles/vector/terrain_water_render/{z}/{x}/{y}",
        displayHeight: HOEHEN,
        basemap: RASTER,
        seriesId: "original",
        view: "landscapes",
        landscapeSelection: "topographie",
        topography,
        locale: "de",
        ...extra,
    });
}

const ids = (s: ReturnType<typeof stil>): string[] => s.layers.map((layer) => layer.id);
const LINIEN = [...CONTOUR_LAYER_IDS, CONTOUR_LABEL_LAYER_ID, CONTOUR_DETAIL_LAYER_ID];

describe("Höhenlinien ausblenden (WI-0236)", () => {
    it("🔴 aus: alle drei Stufen samt Zahlen und Hundertern im Gebirge weg, ihre Quellen auch; Gipfel und Höhenstufen bleiben", () => {
        for (const variante of ["hoehenlinien", "hoehenstufen"] as const) {
            const an = stil(variante);
            expect(ids(an)).toEqual(expect.arrayContaining(LINIEN));
            const aus = stil(variante, { hoehenlinien: false });
            expect(ids(aus).filter((id) => LINIEN.includes(id))).toEqual([]);
            expect(Object.keys(aus.sources)).not.toContain(CONTOUR_SOURCE_ID);
            expect(Object.keys(aus.sources)).not.toContain(CONTOUR_DETAIL_SOURCE_ID);
            expect(ids(aus)).toContain(PEAK_LAYER_ID);
            expect(ids(aus).includes(HEIGHT_TINT_LAYER_ID)).toBe(variante === "hoehenstufen");
        }
        // Ohne Angabe wie bisher: Besucher sehen die Linien immer.
        expect(ids(stil("hoehenlinien", { hoehenlinien: true }))).toEqual(ids(stil("hoehenlinien")));
    });

    it("🔴 im Stil für alle: der Schalter im Anzeigemenü gilt für Besucher wie Editoren, am Rechner wie am Telefon (Betreiber 2026-10-20)", () => {
        hoehenlinienZeigen.value = false;
        expect(hoehenlinienImStil()).toBe(false);
        hoehenlinienZeigen.value = true;
        expect(hoehenlinienImStil()).toBe(true);
    });

    it("gemerkt im Browser; ein Wechsel baut den Stil neu, aber nur in der Landschaftsansicht", async () => {
        const ansicht = ref("landscapes");
        const neuBauen = vi.fn();
        beobachteHoehenlinien(() => ansicht.value, neuBauen);
        const warte = () => new Promise((fertig) => setTimeout(fertig, 0));
        hoehenlinienZeigen.value = false;
        await warte();
        expect(neuBauen).toHaveBeenCalledTimes(1);
        expect(globalThis.localStorage?.getItem("avesmaps3d.hoehenlinien") ?? "aus").toBe("aus");
        ansicht.value = "standard";
        hoehenlinienZeigen.value = true;
        await warte();
        expect(neuBauen).toHaveBeenCalledTimes(1);
    });
});

/** Die Lasur der Topographie in den Höhenlinien: Mit diesem Anteil stehen die Stufen auch bei ◐ 100 % noch über der Karte. */
const LASUR = AVENTURIA_CARTOGRAPHY.layers["topographie"]?.fillOpacity ?? Number.NaN;

describe("Höhenstufen unter ◐ (WI-0236)", () => {
    it("🔴 in den Höhenstufen liegt der Untergrund ÜBER den Stufen; darüber Wasser und Linien", () => {
        const s = stil("hoehenstufen", { untergrund: 50 });
        const stapel = ids(s);
        const stufen = stapel.indexOf(HEIGHT_TINT_LAYER_ID);
        const untergrund = stapel.indexOf(BASEMAP_LAYER_ID);
        expect(stufen).toBeGreaterThan(0);
        expect(untergrund).toBe(stufen + 1);
        expect(untergrund).toBeLessThan(stapel.indexOf(CONTOUR_LAYER_IDS[0]));
        const ebene = s.layers[untergrund] as { paint?: Record<string, unknown> };
        expect(ebene.paint?.["raster-opacity"]).toBe(untergrundDeckkraft(0.5, true));
    });

    it("🔴 ◐ mischt wie in den Höhenlinien: die Stufen behalten die Lasur der Topographie, nur das Papier wird Karte (Fund 2026-11-10)", () => {
        // Vali 2026-11-10: „Die Buntehöhenkarte ("Höhenstufen") lädt nicht.“ Sein ◐ stand auf 75 %, und die Karte lag mit 75 % über den Stufen.
        expect(LASUR).toBeGreaterThan(0);
        expect(untergrundDeckkraft(0, true)).toBe(0);
        expect(untergrundDeckkraft(1, true)).toBeCloseTo(1 - LASUR, 3);
        expect(untergrundDeckkraft(0.75, true)).toBeCloseTo(0.75 * (1 - LASUR), 3);
        // Bei ◐ 75 % bleiben die Stufen deutlich sichtbar, nicht ein Viertel.
        expect(1 - untergrundDeckkraft(0.75, true)).toBeGreaterThan(0.4);
        // In den Höhenlinien und überall sonst bleibt ◐ die Deckkraft der Karte.
        expect(untergrundDeckkraft(0.75, false)).toBe(0.75);
        const linien = stil("hoehenlinien", { untergrund: 75 });
        const karte = linien.layers.find((layer) => layer.id === BASEMAP_LAYER_ID) as {
            paint?: Record<string, unknown>;
        };
        expect(karte.paint?.["raster-opacity"]).toBe(0.75);
    });

    it("in den Höhenlinien bleibt der Untergrund gleich über dem Papier; bei 0 % gibt es ihn nicht, die Stufen decken wie bisher", () => {
        const linien = ids(stil("hoehenlinien", { untergrund: 50 }));
        expect(linien.indexOf(BASEMAP_LAYER_ID)).toBe(1);
        const null_ = ids(stil("hoehenstufen", { untergrund: 0 }));
        expect(null_).not.toContain(BASEMAP_LAYER_ID);
        expect(null_).toContain(HEIGHT_TINT_LAYER_ID);
        // Besucher: kein Untergrund in der Derographie.
        expect(ids(stil("hoehenstufen"))).not.toContain(BASEMAP_LAYER_ID);
    });
});

describe("Editoren treffen die Topographie auch in den Höhenstufen (Fund 2026-11-10)", () => {
    // Vali 2026-11-10: „Wenn die bunte Höhenkarte an ist, sind manche Flächen der Topographie beim Ausschneiden nicht anklickbar.“ Die
    // Werkzeuge (Kartenmenü, „Mit anderer Fläche ›“, Zerschneiden) lesen die Fläche aus `landscape-fill-*`, und die fehlte dort; nur
    // Seen und Meer (eigene Quelle) blieben treffbar.
    const FUELLUNG = landscapeFillLayerId("topographie");

    it("🔴 für Editoren steht die Füllung der Topographie im Stil, unsichtbar, ohne Kante, unter den Stufen", () => {
        const s = stil("hoehenstufen", { untergrund: 75, flaechenTreffer: true });
        const stapel = ids(s);
        const fuellung = s.layers.find((layer) => layer.id === FUELLUNG) as
            { type: string; paint?: Record<string, unknown> } | undefined;
        expect(fuellung?.type).toBe("fill");
        expect(fuellung?.paint?.["fill-opacity"]).toBe(0);
        expect(stapel).not.toContain("landscape-line-topographie");
        expect(stapel).not.toContain("landscape-saum-topographie");
        // Unter den Stufen: Schattierung (`withTerrain` setzt sie hinter die erste Füllung) und Untergrund bleiben, wo sie waren.
        expect(stapel.indexOf(FUELLUNG)).toBeLessThan(stapel.indexOf(HEIGHT_TINT_LAYER_ID));
        expect(stapel.indexOf(BASEMAP_LAYER_ID)).toBe(stapel.indexOf(HEIGHT_TINT_LAYER_ID) + 1);
    });

    it("Besucher bekommen sie nicht (die Auswahl fragt dort den Server); in den Höhenlinien bleibt alles, wie es war", () => {
        expect(ids(stil("hoehenstufen"))).not.toContain(FUELLUNG);
        expect(ids(stil("hoehenlinien", { untergrund: 50, flaechenTreffer: true }))).toEqual(
            ids(stil("hoehenlinien", { untergrund: 50 })),
        );
    });
});
