import { describe, expect, it } from "vitest";
import { formatViewState, parseViewState, sameViewState, type ViewState } from "../src/map/view-state.ts";

/**
 * A shared link has to keep working when the rendering path changes, so it carries map coordinates
 * in `aventuria-v1` rather than the derived render coordinates (ADR-0003).
 */

const SERIES = ["original", "old", "modern"];

describe("view state in the address", () => {
    it("writes map coordinates with legacy precision", () => {
        const hash = formatViewState({
            center: { x: 551.625, y: 532.969 },
            zoom: 5.5,
            series: "original",
            view: "standard",
            landscape: "alle",
        });
        // Seit dem Kartenfaecher (WI-0009) traegt der Link auch Ansicht und Ebene.
        expect(hash).toBe("#x=551.625&y=532.969&z=5.50&series=original&view=standard&layer=alle");
    });

    it("reads back exactly what it wrote", () => {
        const view = {
            center: { x: 123.456, y: 789.012 },
            zoom: 3.25,
            series: "modern",
            view: "landscapes" as const,
            landscape: "vegetation" as const,
        };
        expect(parseViewState(formatViewState(view), SERIES)).toEqual(view);
    });

    it("🔴 a link without a series opens in the default series (WI-0218: the operator's stage link did not open)", () => {
        const parsed = parseViewState("#x=518.750&y=504.000&z=4.5&view=powerlines", SERIES, "modern");
        expect(parsed).toMatchObject({
            center: { x: 518.75, y: 504 },
            zoom: 4.5,
            series: "modern",
            view: "powerlines",
        });
        // Without a default the link stays incomplete, and an unknown series is refused as before.
        expect(parseViewState("#x=518.750&y=504.000&z=4.5", SERIES)).toBeUndefined();
        expect(parseViewState("#x=10&y=20&z=2&series=satellit", SERIES, "modern")).toBeUndefined();
    });

    it("accepts a fragment with or without its hash", () => {
        const parsed = parseViewState("x=10&y=20&z=2&series=old", SERIES);
        expect(parsed?.center).toEqual({ x: 10, y: 20 });
    });

    it("refuses a view outside the domain instead of opening an empty map", () => {
        expect(parseViewState("#x=2000&y=20&z=2&series=original", SERIES)).toBeUndefined();
        expect(parseViewState("#x=-1&y=20&z=2&series=original", SERIES)).toBeUndefined();
    });

    it("refuses an incomplete or unknown link", () => {
        expect(parseViewState("", SERIES)).toBeUndefined();
        expect(parseViewState("#x=10&y=20", SERIES)).toBeUndefined();
        expect(parseViewState("#x=abc&y=20&z=2&series=original", SERIES)).toBeUndefined();
        // A series we do not have would leave the map without a base map.
        expect(parseViewState("#x=10&y=20&z=2&series=satellit", SERIES)).toBeUndefined();
    });

    it("recognises an unchanged view so the address is not rewritten on every frame", () => {
        const view: ViewState = {
            center: { x: 10, y: 20 },
            zoom: 4,
            series: "original",
            view: "standard",
            landscape: "alle",
        };
        expect(sameViewState(view, { ...view })).toBe(true);
        // Below the written precision the address would not change either.
        expect(sameViewState(view, { ...view, center: { x: 10.0001, y: 20 } })).toBe(true);
        expect(sameViewState(view, { ...view, center: { x: 10.01, y: 20 } })).toBe(false);
        expect(sameViewState(undefined, view)).toBe(false);
    });
});

describe("Drehung und Neigung im Link (WI-0016)", () => {
    const flat = {
        center: { x: 551.625, y: 532.969 },
        zoom: 5.5,
        series: "original",
        view: "standard" as const,
        landscape: "alle" as const,
    };

    it("🔴 ein flacher, genordeter Blick schreibt dieselbe Adresse wie vorher", () => {
        expect(formatViewState({ ...flat, bearing: 0, pitch: 0 })).toBe(formatViewState(flat));
        expect(formatViewState({ ...flat, bearing: 0.04, pitch: 0.04 })).not.toContain("b=");
    });

    it("schreibt Drehung und Neigung mit einer Nachkommastelle", () => {
        const hash = formatViewState({ ...flat, bearing: -35.26, pitch: 44.96 });
        expect(hash).toContain("&b=-35.3");
        expect(hash).toContain("&p=45.0");
    });

    it("liest zurück, was es geschrieben hat", () => {
        const view = { ...flat, bearing: 135, pitch: 30 };
        expect(parseViewState(formatViewState(view), SERIES)).toEqual(view);
    });

    it("🪤 ein alter Link ohne Drehung und Neigung öffnet flach und genordet", () => {
        const parsed = parseViewState("#x=10&y=20&z=2&series=old", SERIES);
        expect(parsed?.bearing).toBeUndefined();
        expect(parsed?.pitch).toBeUndefined();
    });

    it("ein unlesbarer Winkel kostet nur sich selbst, nicht den ganzen Link", () => {
        const parsed = parseViewState("#x=10&y=20&z=2&series=old&b=abc&p=-5", SERIES);
        expect(parsed?.center).toEqual({ x: 10, y: 20 });
        expect(parsed?.bearing).toBeUndefined();
        expect(parsed?.pitch).toBeUndefined();
    });

    it("bringt die Drehung auf (−180, 180] und hält die Neigung unter dem Anschlag", () => {
        const parsed = parseViewState("#x=10&y=20&z=6&series=old&b=270&p=120", SERIES);
        expect(parsed?.bearing).toBe(-90);
        expect(parsed?.pitch).toBe(80);
    });
});
