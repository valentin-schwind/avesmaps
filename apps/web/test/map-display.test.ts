import { describe, expect, it } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { composeView, type MapView } from "@avesmaps3d/shared";
import {
    cascade,
    displayDefaults,
    effectiveDisplay,
    lockedSwitches,
    PLACE_TIERS,
    type MapDisplay,
} from "../src/map/map-display.ts";
import { buildPlaceLayers, PLACE_LABEL_LAYER_IDS } from "../src/map/place-layers.ts";

/**
 * Das Auge-Menü (WI-0028): Vorgaben je Ansicht, Sperren, Legacys Kaskade der Ortsklassen - und was
 * davon im Stil ankommt.
 */

function defaults(view: MapView): MapDisplay {
    return displayDefaults(view);
}

function layersFor(view: MapView, display: MapDisplay, flowDirectionsVisible = false) {
    const composition = composeView(view, "alle");
    return buildPlaceLayers({
        labels: true,
        flowDirectionsVisible,
        composition,
        display: effectiveDisplay(view, composition, display),
    });
}

const ids = (layers: { id: string }[]): string[] => layers.map((layer) => layer.id);

describe("Vorgaben und Sperren je Ansicht", () => {
    it("🔴 die Vorgaben sind Legacys Besucherprofil (Betreiber 2026-09-23)", () => {
        // Standard ohne Flusslinien: die Kachel malt die Flüsse schon.
        expect(defaults("standard")).toEqual({
            layers: true,
            placeLevel: PLACE_TIERS.length,
            paths: true,
            labels: true,
            borders: true, // Betreiber 2026-09-29: „an“ (wie Legacy, schwach)
            rivers: false,
            flow: false,
        });
        expect(defaults("none")).toEqual({
            layers: true,
            placeLevel: 0,
            paths: false,
            labels: false,
            borders: false,
            rivers: false,
            flow: false,
        });
        // Politisch (WI-0062, F6): Orte, Straßen, Flüsse und Labels aus, die Grenzen gehören zum Bild.
        expect(defaults("political")).toEqual({
            layers: true,
            placeLevel: 0,
            paths: false,
            labels: false,
            borders: true,
            rivers: false,
            flow: false,
        });
        // Landschaften: Wege, Labels, Flüsse und Seen an (Legacy, Owner 09.09.2026), Orte nur Metropolen
        // und Großstädte (Betreiber 2026-09-28).
        expect(defaults("landscapes")).toEqual({
            layers: true,
            placeLevel: 2,
            paths: true,
            labels: true,
            borders: false,
            rivers: true,
            flow: false,
        });
        // Strömungsrichtungen sind ein Editorwerkzeug und stehen überall aus (Betreiber 2026-09-28).
    });

    it("🔴 „Grenzen“ ist in Standard, Landschaften und Politisch frei (WI-0062, F3 B), sonst gesperrt", () => {
        for (const view of ["standard", "landscapes", "political"] as const) {
            expect(lockedSwitches(view).has("borders"), view).toBe(false);
        }
        for (const view of ["none", "powerlines"] as const) {
            expect(lockedSwitches(view).has("borders"), view).toBe(true);
        }
    });

    it("die Kraftlinien sperren Orte, Wege, Flüsse und Strömung", () => {
        expect([...lockedSwitches("powerlines").keys()].sort()).toEqual(
            ["borders", "flow", "paths", "places", "rivers"].sort(),
        );
        expect(lockedSwitches("standard").has("places")).toBe(false);
    });

    it("🔴 Grenzen: kräftig in Politisch, schwach über Standard und Landschaften, nie in Nur Karte (Legacys Modi)", () => {
        const borders = (view: MapView, on: boolean) =>
            effectiveDisplay(view, composeView(view, "alle"), { ...defaults(view), borders: on }).borders;
        expect(borders("political", true)).toBe("strong");
        expect(borders("political", false)).toBeUndefined();
        expect(borders("standard", true)).toBe("weak");
        expect(borders("landscapes", true)).toBe("weak");
        expect(borders("standard", false)).toBeUndefined();
        // Gesperrt entscheidet die Ansicht: ein eingeschalteter Schalter zeichnet in „Nur Karte“ nichts.
        expect(borders("none", true)).toBeUndefined();
        expect(borders("powerlines", true)).toBeUndefined();
    });

    it("🔴 Legacys Kaskade: Stufe n zeigt 1 bis n, dieselbe Stufe noch einmal blendet alle aus", () => {
        expect(cascade(6, 3)).toBe(3);
        expect(cascade(0, 4)).toBe(4);
        expect(cascade(3, 3)).toBe(0);
    });
});

describe("Was im Stil ankommt", () => {
    it("🔴 die Ortsklassen gehen in jeden Ortsfilter: Marke und Name", () => {
        const layers = layersFor("standard", { ...defaults("standard"), placeLevel: 2 });
        for (const id of ["place-marker", ...PLACE_LABEL_LAYER_IDS]) {
            const layer = layers.find((entry) => entry.id === id) as { filter: unknown } | undefined;
            expect(JSON.stringify(layer?.filter), id).toContain('["literal",["metropole","grossstadt"]]');
        }
        // Ohne Stufe keine einzige Ortsebene.
        expect(ids(layersFor("standard", { ...defaults("standard"), placeLevel: 0 }))).not.toContain("place-marker");
    });

    it("die Bauwerksstufe ist die letzte: bis Dorf erscheint kein Stadtviertel", () => {
        const composition = composeView("standard", "alle");
        const shown = effectiveDisplay("standard", composition, { ...defaults("standard"), placeLevel: 5 });
        expect(shown.placeClasses).toEqual(["metropole", "grossstadt", "stadt", "kleinstadt", "dorf"]);
        expect(effectiveDisplay("standard", composition, defaults("standard")).placeClasses).toBeUndefined();
    });

    it("🔴 „Wege“ und „Flüsse“ teilen die Wegarten wie Legacy", () => {
        const ohneFluesse = ids(layersFor("standard", { ...defaults("standard"), rivers: false }));
        expect(ohneFluesse).not.toContain("path-center-flussweg");
        expect(ohneFluesse).toContain("path-center-reichsstrasse");
        const nurFluesse = ids(layersFor("standard", { ...defaults("standard"), paths: false, rivers: true }));
        expect(nurFluesse).toContain("path-center-flussweg");
        expect(nurFluesse).not.toContain("path-center-reichsstrasse");
    });

    it("„Labels“ nimmt die freien Beschriftungen weg, nicht die Ortsnamen", () => {
        const layers = ids(layersFor("standard", { ...defaults("standard"), labels: false }));
        // Seit WI-0135 je Landschaftsebene eigene Namensebenen: keine einzige darf stehen.
        expect(layers.filter((id) => id.startsWith("map-label") || id.startsWith("landscape-label-run"))).toEqual([]);
        expect(layers).toContain(PLACE_LABEL_LAYER_IDS[0]);
    });

    it("🔴 „Labels“ aus nimmt auch die Flussnamen weg, die Wegnamen bleiben am Schalter „Wege“ (Betreiber 2026-11-09)", () => {
        // Vali: „flusslabels werden angezeigt, obwohl die option "labels" im anzeigemenü (beim auge) deaktiviert ist“.
        for (const view of ["standard", "landscapes", "political"] as const) {
            const composition = composeView(view, "alle");
            expect(effectiveDisplay(view, composition, { ...defaults(view), labels: true }).riverNames, view).toBe(
                true,
            );
            expect(effectiveDisplay(view, composition, { ...defaults(view), labels: false }).riverNames, view).toBe(
                false,
            );
        }
        const steht = (display: MapDisplay, subtype: string): boolean => {
            const layer = layersFor("standard", display).find((entry) => entry.id === "path-label") as
                { filter?: unknown } | undefined;
            if (!layer) return false;
            if (layer.filter === undefined) return true;
            const compiled = featureFilter(layer.filter as never, "filter");
            // Irgendeine Stufe des Zoombands „Name“ reicht: Es geht um den Schalter, nicht um das Band.
            return Array.from({ length: 13 }, (_, zoom) => zoom).some((zoom) =>
                compiled.filter(
                    { zoom },
                    { type: 2, properties: { subtype, name: "Großer Fluss" } } as never,
                    undefined as never,
                ),
            );
        };
        expect(steht(defaults("standard"), "Flussweg")).toBe(true);
        expect(steht({ ...defaults("standard"), labels: false }, "Flussweg")).toBe(false);
        expect(steht({ ...defaults("standard"), labels: false }, "Reichsstrasse")).toBe(true);
        // Ohne Wege und ohne Labels gibt es gar keine Ebene der Wegnamen mehr.
        expect(ids(layersFor("standard", { ...defaults("standard"), paths: false, labels: false }))).not.toContain(
            "path-label",
        );
    });

    it("🔴 Politisch: „Labels“ ab Werk aus und heißt dasselbe wie überall (Betreiber 2026-11-09, „Aus, wie überall“)", () => {
        const composition = composeView("political", "alle");
        const freieNamen = (layers: string[]): string[] =>
            layers.filter((id) => id.startsWith("map-label") || id.startsWith("landscape-label-run"));
        expect(defaults("political").labels).toBe(false);
        const aus = effectiveDisplay("political", composition, defaults("political"));
        expect(aus.riverNames).toBe(false);
        expect(aus.mapLabels).toBe(false);
        expect(ids(layersFor("political", defaults("political")))).not.toContain("path-label");
        // Eingeschaltet: Fluss- und Landschaftsnamen, wie in jeder anderen Ansicht.
        const an = effectiveDisplay("political", composition, { ...defaults("political"), labels: true });
        expect(an.riverNames).toBe(true);
        expect(an.mapLabels).toBe(true);
        const layers = ids(layersFor("political", { ...defaults("political"), labels: true }));
        expect(layers).toContain("path-label");
        expect(freieNamen(layers).length).toBeGreaterThan(0);
        expect(freieNamen(ids(layersFor("political", defaults("political"))))).toEqual([]);
    });

    it("in „Nur Karte“ zeigen eingeschaltete Labels alle Ebenen mit Namen", () => {
        const composition = composeView("none", "alle");
        const shown = effectiveDisplay("none", composition, { ...defaults("none"), labels: true });
        expect(shown.mapLabels).toBe(true);
        expect([...shown.labelLayers].sort()).toEqual(["derographisch", "topographie", "vegetation"]);
    });

    it("🔴 die Kraftlinien-Ansicht gewinnt: eingeschaltete Wege und Orte bleiben weg", () => {
        const alles: MapDisplay = {
            layers: true,
            placeLevel: 6,
            paths: true,
            labels: false,
            borders: true,
            rivers: true,
            flow: true,
        };
        const layers = ids(layersFor("powerlines", alles, true));
        expect(layers.some((id) => id.startsWith("path-"))).toBe(false);
        expect(layers).not.toContain("place-marker");
    });

    it("🔴 Seewege zeigt die Karte niemandem, auch keinem Editor (Betreiber 2026-09-27)", () => {
        expect(ids(layersFor("standard", defaults("standard"), false))).not.toContain("path-center-seeweg");
        expect(ids(layersFor("standard", defaults("standard"), true))).not.toContain("path-center-seeweg");
    });

    it("🔴 in den Landschaften nimmt „Flüsse und Seen“ auch die Seeflächen weg - nur dort sind sie Flächen", () => {
        const composition = composeView("landscapes", "topographie");
        const layers = buildPlaceLayers({
            labels: true,
            composition,
            display: effectiveDisplay("landscapes", composition, { ...defaults("landscapes"), rivers: false }),
        });
        const fill = layers.find((layer) => layer.id === "landscape-fill-topographie") as { filter: unknown };
        const compiled = featureFilter(fill.filter as never, "filter");
        const passes = (type: string): boolean =>
            compiled.filter(
                { zoom: 4 },
                { type: 3, properties: { region_layer: "topographie", region_type: type } } as never,
                undefined as never,
            );
        expect(passes("see")).toBe(false);
        expect(passes("meer")).toBe(true);
        // Außerhalb der Landschaften malt die Kachel die Seen: dort gibt es nichts wegzunehmen.
        expect(
            effectiveDisplay("standard", composeView("standard", "alle"), { ...defaults("standard"), rivers: false })
                .hideLakes,
        ).toBe(false);
    });
});

describe("Landschaftsflächen unabhängig vom Gelände", () => {
    it("Ebenen aus entfernt alle Landschaftsfüllungen, lässt Höhen, Wasser, Wege und Namen stehen", () => {
        const composition = composeView("landscapes", "topographie", "hoehenstufen");
        const build = (layers: boolean) =>
            buildPlaceLayers({
                labels: true,
                composition,
                display: effectiveDisplay("landscapes", composition, { ...defaults("landscapes"), layers }),
                smoothWater: { lakes: true, seas: true },
                topography: { contours: true, heightTint: true, peaks: "heights", locale: "de" },
            });
        const off = ids(build(false));
        expect(
            off.some(
                (id) =>
                    id.startsWith("landscape-fill-") || (id.startsWith("area-preview") && id !== "area-preview-path"),
            ),
        ).toBe(false);
        expect(off.filter((id) => /contour|height|water|path-center|map-label/.test(id))).toEqual(
            ids(build(true)).filter(
                (id) =>
                    /contour|height|water|path-center|map-label/.test(id) &&
                    !(id.startsWith("area-preview") && id !== "area-preview-path"),
            ),
        );
        expect(ids(layersFor("landscapes", { ...defaults("landscapes"), layers: false }))).not.toContain(
            "landscape-fill-vegetation",
        );
    });
});
