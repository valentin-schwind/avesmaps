import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import {
    AVENTURIA_CARTOGRAPHY,
    canonColour,
    composeView,
    labelFamily,
    oklchOf,
    withOklchLightness,
} from "@avesmaps3d/shared";
import {
    CLIMATE_FILL_LAYER_ID,
    CLIMATE_LABEL_LAYER_ID,
    climateHaloColour,
    climateNameColour,
} from "../src/map/landscape-layers.ts";
import { buildPlaceLayers } from "../src/map/place-layers.ts";
import { findLayer, propertySpec } from "./style-spec.ts";

/**
 * Die Klimafarben (WI-0012, Nachtrag 2; Betreiber 2026-10-05: „kannst du die farben intensivieren? … die sind wirklich
 * so "pastell"“, gewählt „C“): alle Zonen gleich hell (OKLCH L), bunter als die Pastellrampe, Farbtöne unverändert,
 * benachbarte Zonen mindestens so gut zu unterscheiden wie vorher. Die Werte stehen in der Kartografietafel; geprüft
 * werden die Regel und dass die Karte genau diese Werte zeichnet.
 */

const ZONES = AVENTURIA_CARTOGRAPHY.climateZones;

/** Von Nord nach Süd, wie `climate_zone_type.sort_order`. */
const ORDER = [
    "polar",
    "subpolar",
    "boreal",
    "gemaessigt",
    "subtropen_winterfeucht",
    "trockene_subtropen",
    "subtropisch",
    "tropisch",
] as const;

/** Die Pastellrampe vom 2026-09-21 (WI-0008): Herkunft der Farbtöne und Vergleich für Buntheit und Abstand. */
const PASTEL: Record<(typeof ORDER)[number], string> = {
    polar: "#dbe9f2",
    subpolar: "#c5dbe8",
    boreal: "#b9d2c4",
    gemaessigt: "#c8d9a8",
    subtropen_winterfeucht: "#dfd79a",
    trockene_subtropen: "#e6c98f",
    subtropisch: "#e8b87e",
    tropisch: "#d9a978",
};

const LIGHTNESS = 0.78;

/** Der Abstand zweier Farben in OKLab (der ΔE von OKLab). */
function distance(a: string, b: string): number {
    const p = oklchOf(a);
    const q = oklchOf(b);
    const [pa, pb] = [p.c * Math.cos((p.h * Math.PI) / 180), p.c * Math.sin((p.h * Math.PI) / 180)];
    const [qa, qb] = [q.c * Math.cos((q.h * Math.PI) / 180), q.c * Math.sin((q.h * Math.PI) / 180)];
    return Math.hypot(p.l - q.l, pa - qa, pb - qb);
}

/** Die Zone mit Deckkraft über dem Kartenpapier, wie sie im Bild steht. */
function over(colour: string, paper: string, alpha: number): string {
    const channel = (hex: string, at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
    return `#${[1, 3, 5]
        .map((at) => Math.round(channel(colour, at) * alpha + channel(paper, at) * (1 - alpha)))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")}`;
}

/** WCAG-Kontrast zweier Farben. */
function contrast(a: string, b: string): number {
    const luminance = (hex: string): number => {
        const [r, g, b2] = [1, 3, 5].map((at) => {
            const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    };
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
    return (x + 0.05) / (y + 0.05);
}

function evaluate(layerId: string, property: "fill-color" | "text-color" | "text-halo-color", zone: string): string {
    const layers = buildPlaceLayers({ labels: true, composition: composeView("landscapes", "klima") });
    const layer = property === "fill-color" ? findLayer(layers, layerId, "fill") : findLayer(layers, layerId, "symbol");
    const value = (layer?.paint as Record<string, unknown> | undefined)?.[property];
    const group = property === "fill-color" ? "paint_fill" : "paint_symbol";
    const compiled = createPropertyExpression(value, property, propertySpec(group, property));
    if (compiled.result !== "success") throw new Error(`${layerId} ${property} ungültig`);
    const colour = compiled.value.evaluate({ zoom: 2 }, {
        type: "Polygon",
        properties: { type_key: zone },
    } as never) as {
        r: number;
        g: number;
        b: number;
    };
    return `#${[colour.r, colour.g, colour.b]
        .map((v) =>
            Math.round(v * 255)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")}`;
}

describe("Die Klimafarben", () => {
    it("die Tafel führt genau die acht Zonen, von Nord nach Süd", () => {
        expect(Object.keys(ZONES)).toEqual([...ORDER]);
    });

    it("🔴 alle Zonen gleich hell (OKLCH L 0,78), Farbton wie die Pastellrampe, bunter als sie", () => {
        for (const zone of ORDER) {
            const now = oklchOf(ZONES[zone] as string);
            const before = oklchOf(PASTEL[zone]);
            expect(now.l, zone).toBeCloseTo(LIGHTNESS, 2);
            expect(Math.abs(now.h - before.h), `${zone}: Farbton`).toBeLessThan(1.5);
            expect(now.c, `${zone}: Buntheit`).toBeGreaterThan(before.c);
        }
    });

    it("🔴 benachbarte Zonen unterscheiden sich mindestens so stark wie vorher, voll und zu 50 % über dem Papier", () => {
        const paper = canonColour("mapPaper");
        const alpha = AVENTURIA_CARTOGRAPHY.layers["klima"]?.fillOpacity ?? 0.5;
        for (let at = 1; at < ORDER.length; at++) {
            const [north, south] = [ORDER[at - 1]!, ORDER[at]!];
            const pair = `${north} | ${south}`;
            const now = [ZONES[north] as string, ZONES[south] as string] as const;
            expect(distance(...now), pair).toBeGreaterThanOrEqual(distance(PASTEL[north], PASTEL[south]));
            expect(
                distance(over(now[0], paper, alpha), over(now[1], paper, alpha)),
                `${pair} zu 50 %`,
            ).toBeGreaterThanOrEqual(distance(over(PASTEL[north], paper, alpha), over(PASTEL[south], paper, alpha)));
        }
    });

    it("🔴 die Karte zeichnet genau die Werte der Tafel", () => {
        for (const zone of ORDER) {
            expect(evaluate(CLIMATE_FILL_LAYER_ID, "fill-color", zone), zone).toBe(ZONES[zone]);
        }
    });

    it("🔴 der Name steht dunkel im Ton seiner Zone, lesbar schon ohne Saum: gegen das Band zu 50 % und gewählt zu 100 %", () => {
        // Betreiber 2026-10-05: „die font-color einem dunkleren ton der klimazone geben“. Ziel ohne Saum: 4,5:1 (WCAG AA).
        const lightness = labelFamily("climate").toneLightness;
        expect(lightness).toBe(0.38);
        const paper = canonColour("mapPaper");
        const alpha = AVENTURIA_CARTOGRAPHY.layers["klima"]?.fillOpacity ?? 0.5;
        for (const zone of ORDER) {
            const band = ZONES[zone] as string;
            const name = evaluate(CLIMATE_LABEL_LAYER_ID, "text-color", zone);
            expect(name, zone).toBe(withOklchLightness(band, lightness as number));
            expect(name, zone).toBe(climateNameColour(band));
            expect(oklchOf(name).l, zone).toBeCloseTo(0.38, 2);
            // Auf 3° genau: Die Rundung auf 8 Bit verschiebt den Farbton einer dunklen, blassen Farbe (Polar) um gut 2°.
            expect(Math.abs(oklchOf(name).h - oklchOf(band).h), `${zone}: Farbton`).toBeLessThan(3);
            expect(contrast(name, over(band, paper, alpha)), `${zone}: zu 50 %`).toBeGreaterThanOrEqual(6);
            expect(contrast(name, band), `${zone}: gewählt`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("🔴 der Saum ist schmal, hell und blass im Ton der Zone, scharf: Er trennt, er umrandet nicht", () => {
        // Betreiber 2026-10-05: „kannst du die kontur weniger krass stark machen“.
        const family = labelFamily("climate");
        for (const zone of ORDER) {
            const band = ZONES[zone] as string;
            const halo = evaluate(CLIMATE_LABEL_LAYER_ID, "text-halo-color", zone);
            expect(halo, zone).toBe(climateHaloColour(band));
            expect(oklchOf(halo).l, zone).toBeCloseTo(family.haloToneLightness as number, 2);
            expect(oklchOf(halo).c, zone).toBeLessThanOrEqual((family.haloToneChroma as number) + 0.002);
            expect(halo, `${zone}: kein reines Weiß`).not.toBe("#ffffff");
            // Mit Saum besser lesbar als ohne: Schrift gegen Saum mindestens 8:1.
            expect(contrast(evaluate(CLIMATE_LABEL_LAYER_ID, "text-color", zone), halo), zone).toBeGreaterThanOrEqual(
                8,
            );
        }
        // Höchstens 1,4 px, auch bei der großen Schrift, und ohne Unschärfe.
        expect((family.size as number) * family.haloWidthRatio).toBeLessThanOrEqual(1.4);
        expect(family.haloBlurRatio).toBe(0);
    });
});
