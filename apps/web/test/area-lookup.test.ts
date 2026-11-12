import { afterEach, describe, expect, it, vi } from "vitest";
import { AVENTURIA, composeView, toRenderLngLat } from "@avesmaps3d/shared";
import { fetchAreasAt, fetchOutline, outlineZoom, serverAreaLookup, useAreaRevision } from "../src/map/area-lookup.ts";

/**
 * Die Kartenauswahl per Serverabfrage (WI-0058, Betreiber 2026-09-28: Landschaftsflächen „nur bei Bedarf“): wann
 * sie fragt, was sie schickt und wie sie den Umriss für die Karte umrechnet.
 */

afterEach(() => {
    vi.unstubAllGlobals();
    useAreaRevision(() => 0);
});

describe("Wann die Auswahl den Server fragt", () => {
    it("🔴 nur wo die Ansicht Landschaftsebenen hat, aber keine Flächen zeichnet (Höhenstufen)", () => {
        const stufen = composeView("landscapes", "topographie", "hoehenstufen");
        expect(serverAreaLookup(stufen, true, true)).toEqual({ layers: ["topographie"], lakes: true, smooth: true });
        // Die Höhenlinien zeichnen die Landflächen: Die Kacheln genügen.
        expect(serverAreaLookup(composeView("landscapes", "topographie", "hoehenlinien"), true, true)).toBeUndefined();
        expect(serverAreaLookup(composeView("landscapes", "alle"), false, true)).toBeUndefined();
        // Ohne geglättetes Wasser zeichnen auch die Höhenstufen Flächen (Rückfall).
        expect(serverAreaLookup(stufen, false, true)).toBeUndefined();
        // Standard und „Nur Karte“ haben keine Landschaftsebenen.
        expect(serverAreaLookup(composeView("standard", "alle"), false, true)).toBeUndefined();
    });

    it("holt den Umriss eine Stufe feiner als das Bild, höchstens bis zur Grenze", () => {
        expect(outlineZoom(3.6)).toBe(5);
        expect(outlineZoom(0)).toBe(1);
        expect(outlineZoom(20)).toBe(14);
    });
});

describe("Was sie schickt und bekommt", () => {
    it("rundet den Punkt, damit dieselbe Stelle dieselbe Adresse hat, und fragt sie nur einmal", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ areas: [], rivers: [] }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const lookup = { layers: ["topographie" as const], lakes: false, smooth: true };
        await fetchAreasAt({ x: 638.41234, y: 670.70001 }, lookup);
        await fetchAreasAt({ x: 638.41204, y: 670.69996 }, lookup);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
            "/api/areas/at?x=638.412&y=670.700&layers=topographie&lakes=false",
        );
    });

    it("rechnet den Umriss aus Karteneinheiten in die Koordinaten der Karte um", async () => {
        const body = {
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    properties: { region_public_id: "a", region_type: "see" },
                    geometry: {
                        type: "Polygon",
                        coordinates: [
                            [
                                [500, 500],
                                [501, 500],
                                [501, 501],
                                [500, 500],
                            ],
                        ],
                    },
                },
            ],
        };
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
        );
        const outline = await fetchOutline(["00000000-0000-4000-8000-000000000001"], 6.2, true);
        const geometry = outline.features[0]?.geometry;
        const { lng, lat } = toRenderLngLat(AVENTURIA.coordinateSpace, { x: 501, y: 500 });
        expect(geometry?.type).toBe("Polygon");
        expect((geometry?.coordinates as number[][][])[0]?.[1]).toEqual([lng, lat]);
    });

    it("🔴 nach einer Änderung an der Karte fragen Auswahl und Umriss neu, mit der Kachelrevision in der Adresse (WI-0178 B3)", async () => {
        const fetchMock = vi.fn(async (url: string) =>
            url.includes("outline")
                ? new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), { status: 200 })
                : new Response(JSON.stringify({ areas: [], rivers: [] }), { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const lookup = { layers: ["vegetation" as const], lakes: true, smooth: false };
        const umriss = ["00000000-0000-4000-8000-0000000000b3"];
        let revision = 0;
        useAreaRevision(() => revision);
        await fetchAreasAt({ x: 11, y: 12 }, lookup);
        await fetchOutline(umriss, 4, false);
        revision = 812;
        await fetchAreasAt({ x: 11, y: 12 }, lookup);
        await fetchOutline(umriss, 4, false);
        await fetchOutline(umriss, 4, false);
        const adressen = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
        expect(adressen).toHaveLength(4);
        expect(adressen.slice(0, 2).every((adresse) => !adresse.includes("r="))).toBe(true);
        expect(adressen.slice(2).every((adresse) => adresse.endsWith("&r=812"))).toBe(true);
    });

    it("meldet einen Fehler des Servers, statt still nichts zu finden", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("{}", { status: 503 })),
        );
        await expect(
            fetchAreasAt({ x: 1, y: 2 }, { layers: ["vegetation"], lakes: true, smooth: false }),
        ).rejects.toThrow(/503/);
    });
});
