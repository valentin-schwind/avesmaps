import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { AVENTURIA_POLITICAL_CARTOGRAPHY, politicalBandForCameraZoom, politicalMinZoom } from "@avesmaps3d/shared";
import {
    inBand,
    rememberDerivedMaxBand,
    territoryBandForZoom,
    territoryBandLead,
    territoryMaxBand,
    TERRITORY_BAND_STATE,
    watchTerritoryBand,
    withTerritoryBand,
} from "../src/map/territory-band.ts";

/**
 * Das Band der Herrschaftsgebiete aus dem Kamerazoom (WI-0062 Nachtrag, Betreiber 2026-09-30): ein Wert für die ganze
 * Ansicht, als globaler Zustand des Stils, nachgeführt mit der Kamera.
 */

const TAFEL = AVENTURIA_POLITICAL_CARTOGRAPHY;

/** Das Band der Baronien (Legacy z4). */
const BARONIEN = 4;

interface FalscheKarte {
    zoom: number;
    gesetzt: [string, unknown][];
    ausnahme: boolean;
    handler: Map<string, Set<() => void>>;
    getZoom(): number;
    setGlobalStateProperty(name: string, wert: unknown): void;
    on(ereignis: string, handler: () => void): void;
    off(ereignis: string, handler: () => void): void;
    feuere(ereignis: string): void;
}

function falscheKarte(zoom: number): FalscheKarte {
    const karte: FalscheKarte = {
        zoom,
        gesetzt: [],
        ausnahme: false,
        handler: new Map(),
        getZoom: () => karte.zoom,
        setGlobalStateProperty: (name, wert) => {
            if (karte.ausnahme) throw new Error("Style is not done loading.");
            karte.gesetzt.push([name, wert]);
        },
        on: (ereignis, handler) => {
            karte.handler.set(ereignis, (karte.handler.get(ereignis) ?? new Set()).add(handler));
        },
        off: (ereignis, handler) => {
            karte.handler.get(ereignis)?.delete(handler);
        },
        feuere: (ereignis) => {
            for (const handler of karte.handler.get(ereignis) ?? []) handler();
        },
    };
    return karte;
}

/** Ein Zeiger, dessen Ableitung bis `maxBand` reicht (ohne: ein Server vor WI-0188). */
const zeiger = (maxBand?: number) => ({
    schemaVersion: 1 as const,
    revision: "abcdef012345",
    displayYearBf: TAFEL.displayYearBf,
    ...(maxBand === undefined ? {} : { maxBand }),
});

describe("Band aus dem Kamerazoom", () => {
    // Die Ableitung reicht bis zum obersten Band der Tafel; die Klemme auf das Abgeleitete prüft der eigene Block unten.
    beforeEach(() => rememberDerivedMaxBand(zeiger(TAFEL.maxBand)));
    afterEach(() => rememberDerivedMaxBand(undefined));

    it("🔴 das Band der Karte ist das der Tafel: floor(Zoom − 1 + Vorzug des Geräts), 0 bis maxBand", () => {
        for (const zoom of [0, 0.5, 1, 2.9, 3, 5.5, 6, 6.99, 7, 9.2, 12]) {
            expect(territoryBandForZoom(zoom), `Zoom ${String(zoom)}`).toBe(
                politicalBandForCameraZoom(zoom, TAFEL.maxBand, TAFEL.bandLeadZoom),
            );
            expect(territoryBandForZoom(zoom, territoryBandLead(true)), `Telefon, Zoom ${String(zoom)}`).toBe(
                politicalBandForCameraZoom(zoom, TAFEL.maxBand, TAFEL.bandLeadZoomPhone),
            );
        }
    });

    it("🔴 der Vorzug je Gerät steht in der Tafel: Rechner Baronien ab Zoom 5, Telefon ab Zoom 4 (Betreiber 2026-09-30)", () => {
        // Die Werte kommen aus der Tafel; der Test nagelt nur, was der Betreiber entschieden hat (Band 4 = die Baronien).
        expect(politicalMinZoom(BARONIEN, TAFEL.bandLeadZoom)).toBe(5);
        expect(politicalMinZoom(BARONIEN, TAFEL.bandLeadZoomPhone)).toBe(4);
        // Rechner: Grenzfall 4,99 → Band 3, 5,0 → Band 4.
        const rechner = politicalMinZoom(BARONIEN, TAFEL.bandLeadZoom);
        expect(territoryBandForZoom(rechner - 0.01, territoryBandLead(false))).toBe(BARONIEN - 1);
        expect(territoryBandForZoom(rechner, territoryBandLead(false))).toBe(BARONIEN);
        expect(territoryBandForZoom(rechner + 0.99, territoryBandLead(false))).toBe(BARONIEN);
        expect(territoryBandForZoom(rechner + 1, territoryBandLead(false))).toBe(BARONIEN + 1);
        // Telefon: Grenzfall 3,99 → Band 3, 4,0 → Band 4.
        const telefon = politicalMinZoom(BARONIEN, TAFEL.bandLeadZoomPhone);
        expect(territoryBandForZoom(telefon - 0.01, territoryBandLead(true))).toBe(BARONIEN - 1);
        expect(territoryBandForZoom(telefon, territoryBandLead(true))).toBe(BARONIEN);
        expect(territoryBandForZoom(telefon + 0.99, territoryBandLead(true))).toBe(BARONIEN);
        expect(territoryBandForZoom(telefon + 1, territoryBandLead(true))).toBe(BARONIEN + 1);
        // Das Telefon zeigt die Bänder früher, nie später.
        expect(TAFEL.bandLeadZoomPhone).toBeGreaterThan(TAFEL.bandLeadZoom);
        for (const zoom of [0, 1.5, 3.99, 4, 4.99, 5, 6.5, 12]) {
            expect(territoryBandForZoom(zoom, territoryBandLead(true))).toBeGreaterThanOrEqual(
                territoryBandForZoom(zoom, territoryBandLead(false)),
            );
        }
    });

    it("🔴 `territoryBandLead` wählt den Vorzug nach dem Gerät; ohne Angabe fragt es das Gerät, und ohne matchMedia ist es der Rechner", () => {
        expect(territoryBandLead(false)).toBe(TAFEL.bandLeadZoom);
        expect(territoryBandLead(true)).toBe(TAFEL.bandLeadZoomPhone);
        // In dieser Umgebung gibt es kein matchMedia: `isPhoneViewport` sagt „Rechner“, und der Standard ist der des Rechners.
        expect(typeof globalThis.matchMedia).not.toBe("function");
        expect(territoryBandLead()).toBe(TAFEL.bandLeadZoom);
        expect(territoryBandForZoom(5)).toBe(territoryBandForZoom(5, territoryBandLead(false)));
    });

    it("der Stil trägt den Zustand mit dem Anfangswert des Zooms und lässt andere Zustände stehen", () => {
        const style = withTerritoryBand(
            { version: 8, sources: {}, layers: [], state: { routeFlightInSpace: { default: false } } },
            5.2,
        );
        expect(style.state).toEqual({
            routeFlightInSpace: { default: false },
            [TERRITORY_BAND_STATE]: { default: 4 },
        });
    });

    it("🔴 führt den Zustand mit der Kamera nach: beim Zoomen, nach dem Laden und bei einem neuen Stil", () => {
        const karte = falscheKarte(3.4);
        const abmelden = watchTerritoryBand(karte as never);
        karte.feuere("load");
        expect(karte.gesetzt.at(-1)).toEqual([TERRITORY_BAND_STATE, territoryBandForZoom(3.4)]);
        karte.zoom = 6.1;
        karte.feuere("zoom");
        expect(karte.gesetzt.at(-1)).toEqual([TERRITORY_BAND_STATE, territoryBandForZoom(6.1)]);
        karte.zoom = 2.2;
        karte.feuere("styledata");
        expect(karte.gesetzt.at(-1)).toEqual([TERRITORY_BAND_STATE, territoryBandForZoom(2.2)]);
        abmelden();
        const davor = karte.gesetzt.length;
        karte.feuere("zoom");
        expect(karte.gesetzt.length).toBe(davor);
    });

    it("ein Stil, der noch lädt, wirft nicht: sein Anfangswert gilt, `load` holt es nach", () => {
        const karte = falscheKarte(5.5);
        karte.ausnahme = true;
        watchTerritoryBand(karte as never);
        expect(() => karte.feuere("zoom")).not.toThrow();
        expect(karte.gesetzt).toEqual([]);
        karte.ausnahme = false;
        karte.feuere("load");
        expect(karte.gesetzt).toEqual([[TERRITORY_BAND_STATE, territoryBandForZoom(5.5)]]);
    });

    it("🔴 ein fester Bandfilter für Abfragen an geladenen Kacheln nimmt den Durchlauf, der das Band trägt", () => {
        const filter = featureFilter(inBand(4, ["==", ["get", "kind"], "name"]), "filter");
        const zeile = (eigenschaften: Record<string, unknown>) => ({ type: 2, properties: eigenschaften }) as never;
        const pruefe = (eigenschaften: Record<string, unknown>): boolean =>
            filter.filter({ zoom: 0 }, zeile(eigenschaften), undefined as never);
        expect(pruefe({ kind: "name", band: 4, band_to: 6 })).toBe(true);
        expect(pruefe({ kind: "name", band: 2, band_to: 4 })).toBe(true);
        expect(pruefe({ kind: "name", band: 5, band_to: 6 })).toBe(false);
        expect(pruefe({ kind: "name", band: 0, band_to: 3 })).toBe(false);
        expect(pruefe({ kind: "outer", band: 4, band_to: 4 })).toBe(false);
    });
});

describe("🔴 WI-0188 A8: die Karte zeigt nie mehr, als abgeleitet ist", () => {
    afterEach(() => rememberDerivedMaxBand(undefined));

    it("ohne Zeiger oder ohne Angabe bleibt sie bei Legacys 6, für jeden höheren Zoom", () => {
        rememberDerivedMaxBand(undefined);
        expect(territoryMaxBand()).toBe(6);
        expect(territoryBandForZoom(12, 0)).toBe(6);
        rememberDerivedMaxBand(zeiger());
        expect(territoryBandForZoom(9.5, 0)).toBe(6);
    });

    it("reicht die Ableitung bis 8, zeigt sie 7 und 8 (Rechner ab Zoom 8 und 9, Telefon eine Stufe früher)", () => {
        rememberDerivedMaxBand(zeiger(8));
        expect(territoryMaxBand()).toBe(TAFEL.maxBand);
        expect(territoryBandForZoom(7.99, 0)).toBe(6);
        expect(territoryBandForZoom(8, 0)).toBe(7);
        expect(territoryBandForZoom(9, 0)).toBe(8);
        expect(territoryBandForZoom(12, 0)).toBe(8);
        expect(territoryBandForZoom(8, 1)).toBe(8);
    });

    it("nie über die Tafel hinaus und nie über das Abgeleitete", () => {
        rememberDerivedMaxBand(zeiger(7));
        expect(territoryBandForZoom(12, 0)).toBe(7);
        expect(Math.min(TAFEL.maxBand, 7)).toBe(territoryMaxBand());
    });

    it("der Anfangswert des Stils folgt derselben Klemme", () => {
        rememberDerivedMaxBand(undefined);
        const stil = withTerritoryBand({ version: 8, sources: {}, layers: [] }, 12);
        expect(stil.state?.[TERRITORY_BAND_STATE]).toEqual({ default: 6 });
        rememberDerivedMaxBand(zeiger(8));
        const tief = withTerritoryBand({ version: 8, sources: {}, layers: [] }, 12);
        expect(tief.state?.[TERRITORY_BAND_STATE]).toEqual({ default: 8 });
    });
});
