import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { canonColour, DESIGN_CANON, type SubjectDetail } from "@avesmaps3d/shared";
import {
    buildGefahrEbenen,
    GEFAHR_EBENEN,
    GEFAHR_KACHEL_URL,
    GEFAHR_MUSTER,
    GEFAHR_QUELLE,
    GEFAHR_SCHICHT,
    gefahrMusterPixel,
    withGefahren,
} from "../src/map/gefahr-schicht";
import { panelRules } from "../src/info-panel/panel-extras";
import { headerOf } from "../src/info-panel/panel-header";

/**
 * Die rote Schraffur der gefährlichen Gebiete (WI-0308 Paket 2) und die Pille im Infopanel. Problemfälle: Die Schraffur liegt über den
 * Namen oder unter den Flächen; das Muster hat an der Kachelgrenze einen Sprung; Farbe oder Maße kommen nicht aus dem Kanon; das Infopanel
 * zeigt die Pille ohne die Arten oder rät aus der Karte.
 */

describe("Schraffur der gefährlichen Gebiete", () => {
    it("🔴 Werte aus dem Kanon wie im Entwurf: Rot #c4302b, Raster 9, Strich 2,2, Deckkraft 0,62, Tönung 0,1, Rand 1,8", () => {
        expect(canonColour("mapGefahr")).toBe("#c4302b");
        expect(DESIGN_CANON.mapGefahr).toEqual({
            raster: 9,
            strich: 2.2,
            deckkraft: 0.62,
            toenung: 0.1,
            kante: 1.8,
            kanteDeckkraft: 0.9,
        });
    });

    it("🔴 das Muster ist nahtlos: fünf Striche je 64 px, 9,05 px Abstand, rote Striche auf durchsichtigem Grund", () => {
        const { width, height, data, periodePx } = gefahrMusterPixel(1);
        expect(width).toBe(64);
        expect(height).toBe(64);
        expect(periodePx).toBeCloseTo(9.05, 2);
        const alpha = (x: number, y: number): number => data[((y % 64) * 64 + (x % 64)) * 4 + 3]!;
        // Nahtlos: Die Farbe hängt nur an x + y, und die Periode teilt die Kante.
        for (let y = 0; y < 64; y += 7) expect(alpha(63, y)).toBe(alpha(0, y + 63));
        const werte = Array.from({ length: 64 * 64 }, (_, i) => data[i * 4 + 3]!);
        expect(Math.max(...werte)).toBe(Math.round(255 * 0.62));
        expect(Math.min(...werte)).toBe(0);
        expect([data[0], data[1], data[2]]).toEqual([0xc4, 0x30, 0x2b]);
    });

    it("🔴 Tönung, Striche und Rand aus der eigenen Quelle; ohne eigenen Schalter und ohne Mindestzoom", () => {
        const ebenen = buildGefahrEbenen();
        expect(ebenen.map((ebene) => ebene.id)).toEqual([
            GEFAHR_EBENEN.toenung,
            GEFAHR_EBENEN.schraffur,
            GEFAHR_EBENEN.kante,
        ]);
        for (const ebene of ebenen) {
            expect(ebene).toMatchObject({ source: GEFAHR_QUELLE, "source-layer": GEFAHR_SCHICHT });
            expect("minzoom" in ebene).toBe(false);
        }
        expect(ebenen[1]).toMatchObject({ paint: { "fill-pattern": GEFAHR_MUSTER } });
        expect(ebenen[0]).toMatchObject({ paint: { "fill-color": "#c4302b", "fill-opacity": 0.1 } });
        expect(ebenen[2]).toMatchObject({ paint: { "line-width": 1.8, "line-opacity": 0.9 } });
    });

    it("🔴 über den Flächen, vor den Orten und der ersten Schrift; die Quelle kommt mit", () => {
        const stil: StyleSpecification = {
            version: 8,
            sources: {},
            layers: [
                { id: "hintergrund", type: "background" },
                { id: "landscape-fill-vegetation", type: "fill", source: "landscapes", "source-layer": "x" },
                { id: "wege", type: "line", source: "paths", "source-layer": "x" },
                { id: "orte", type: "circle", source: "places", "source-layer": "x" },
                { id: "namen", type: "symbol", source: "labels", "source-layer": "x" },
            ],
        };
        const neu = withGefahren(stil, GEFAHR_KACHEL_URL);
        expect(neu.layers.map((ebene) => ebene.id)).toEqual([
            "hintergrund",
            "landscape-fill-vegetation",
            "wege",
            GEFAHR_EBENEN.toenung,
            GEFAHR_EBENEN.schraffur,
            GEFAHR_EBENEN.kante,
            "orte",
            "namen",
        ]);
        expect(neu.sources[GEFAHR_QUELLE]).toMatchObject({
            type: "vector",
            tiles: ["/tiles/vector/region_gefahr_tile/{z}/{x}/{y}"],
        });
    });
});

describe("Infopanel: die Pille „Gefahrengebiet“ (WI-0308, Antwort 12)", () => {
    const flaeche = (extra: Partial<SubjectDetail>): SubjectDetail => ({
        subject: { kind: "area", id: "a3a3a3a3-0000-4000-8000-000000000001" },
        revision: "0123456789ab",
        title: "Dunkelforst",
        subtitle: [
            { part: "type", key: "wald" },
            { part: "layer", key: "vegetation" },
        ],
        ...extra,
    });
    const regeln = panelRules("legacy");

    it("🔴 aus dem Lesevertrag: die Pille und die Arten mit Komma in der Folge des Katalogs", () => {
        const kopf = headerOf(
            "area",
            flaeche({ gefahr: { arten: ["kriminalitaet", "kreaturen"] } }),
            undefined,
            regeln,
        );
        expect(kopf.gefahr).toEqual({ arten: "Kriminalität, Gefährliche Kreaturen und Monster" });
    });

    it("ohne Gefahrenlage keine Pille", () => {
        expect(headerOf("area", flaeche({}), undefined, regeln).gefahr).toBeUndefined();
    });
});
