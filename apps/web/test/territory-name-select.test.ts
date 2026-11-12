import { describe, expect, it } from "vitest";
import { createPropertyExpression, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    canonColour,
    coatImageId,
    composeView,
    mediaPublicUrl,
    type TerritoryPointer,
} from "@avesmaps3d/shared";
import { displayDefaults } from "../src/map/map-display.ts";
import { buildPlaceStyle } from "../src/map/place-layers.ts";
import { TERRITORY_BAND_STATE } from "../src/map/territory-band.ts";
import { TERRITORY_COATS_STATE } from "../src/map/territory-coat-label.ts";
import {
    TERRITORY_LABEL_LAYER_ID,
    TERRITORY_SOURCE_ID,
    buildTerritoryLabelLayer,
} from "../src/map/territory-layers.ts";
import { asLayer, findLayer, propertySpec } from "./style-spec.ts";

/**
 * Der Name eines gewählten Herrschaftsgebiets (WI-0121 Nachtrag, Betreiber 2026-10-09, wörtlich: „einfach nur text, der schon da
 * steht, gelb werden soll und nicht erst neu erzeugt, aus und wieder eingeblendet, und irgendwo platziert wird (wenn ich z.b. auf
 * Heiliges Neues Kaiserreich vom Greifenthron zu Gareth klicke wird daraus ein one liner)“).
 *
 * 🔴 Dasselbe Muster wie WI-0093 bei den Landschaften: Der Name BLEIBT als dasselbe Symbol in derselben Ebene stehen und wechselt
 * allein die Farbe. Geprüft wird, was MapLibre auswertet: Welche Eigenschaften nennen die Auswahl (Farben, Saum), und welche nicht
 * (alles, was Lage, Umbruch, Größe und Kollision bestimmt). Dass der gezeichnete Name dabei auf den Bildpunkt an seiner Stelle
 * bleibt, belegt `e2e/territory-name-select.spec.ts` am Bild.
 */

const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;
const LABEL = POLITICAL.label;
const SHA = "ab".repeat(32);
const GEWAEHLT = "e201c69b-4811-48fd-826c-60ed976c73e0";
const ANDERES = "8358472a-b164-438b-a508-60a0a4b8e7aa";
const WAPPEN = {
    [GEWAEHLT]: coatImageId(mediaPublicUrl(SHA)) as string,
    [ANDERES]: coatImageId(mediaPublicUrl(SHA)) as string,
};
const ZEIGER: TerritoryPointer = { schemaVersion: 1, revision: "abcdef012345", displayYearBf: 1049 };

/** Die Ebene der Gebietsnamen als Symbolebene: mit Kennung der Auswahl (oder ohne), mit Wappen (oder ohne), mit der Tafel (oder einer anderen). */
const bauen = (selected?: string, withCoats = true, look?: Parameters<typeof buildTerritoryLabelLayer>[3]) =>
    asLayer(buildTerritoryLabelLayer("Testfont", selected, withCoats, look), "symbol");

const gebiet = (id: string): Record<string, unknown> => ({
    territory_public_id: id,
    name: "Test",
    band: 0,
    band_to: 6,
});

/** Der Wert einer Eigenschaft für ein Merkmal im Band: so wertet MapLibre sie aus (Farben kommen als Farbobjekt, hier als Text). */
function auswerten(
    group: "layout_symbol" | "paint_symbol",
    ebene: { layout?: unknown; paint?: unknown },
    property: string,
    band: number,
    merkmal: Record<string, unknown>,
): unknown {
    const quelle = (group === "layout_symbol" ? ebene.layout : ebene.paint) as Record<string, unknown>;
    const kompiliert = createPropertyExpression(quelle[property] as never, property, propertySpec(group, property), {
        [TERRITORY_BAND_STATE]: band,
        [TERRITORY_COATS_STATE]: WAPPEN,
    });
    if (kompiliert.result !== "success") {
        throw new Error(
            `Ausdruck ${property} ungültig: ${kompiliert.value.map((fehler) => fehler.message).join("; ")}`,
        );
    }
    const wert = kompiliert.value.evaluate({ zoom: 5 }, { type: 3, properties: merkmal } as never);
    return typeof wert === "object" && wert !== null && "r" in wert && "a" in wert ? String(wert) : wert;
}

/** Eine Farbe in der Schreibweise, in der MapLibre sie auswertet (rgba mit Anteilen), damit Hexwerte vergleichbar sind. */
function farbe(hex: string): string {
    const k = createPropertyExpression(hex as never, "text-color", propertySpec("paint_symbol", "text-color"));
    if (k.result !== "success") throw new Error("Farbe ungültig");
    return String(k.value.evaluate({ zoom: 5 }));
}

describe("Die Farbe des Namens: allein sie wechselt (Auswahlfarbe des Kanons, dunkler Saum)", () => {
    const gewaehlt = bauen(GEWAEHLT);
    const ruhig = bauen();

    it("🔴 das gewählte Gebiet trägt die Auswahlfarbe des Kanons (colour.mapSelection), jedes andere die Farbe des Namens", () => {
        expect(auswerten("paint_symbol", gewaehlt, "text-color", 3, gebiet(GEWAEHLT))).toBe(
            farbe(canonColour("mapSelection")),
        );
        expect(auswerten("paint_symbol", gewaehlt, "text-color", 3, gebiet(ANDERES))).toBe(farbe(LABEL.color));
        // Und ohne Auswahl steht der Name unverändert dunkel, ohne Ausdruck.
        expect(ruhig.paint?.["text-color"]).toBe(LABEL.color);
        expect(auswerten("paint_symbol", ruhig, "text-color", 3, gebiet(GEWAEHLT))).toBe(farbe(LABEL.color));
    });

    it("🔴 keine eigene Farbe: das Gelb ist der Kanonwert, den auch die Landschaft und die Fläche tragen", () => {
        expect(canonColour("mapSelection")).toBe("#ffd72e");
        const farben = JSON.stringify(gewaehlt.paint);
        expect(farben).toContain(canonColour("mapSelection"));
        // Die Tafel nennt für die Auswahl nur den Saum; ein zweites Gelb steht dort nicht.
        expect(JSON.stringify(LABEL.selected)).not.toContain("#ffd7");
    });

    it("🔴 der Saum des gewählten Namens ist dunkel, damit das helle Gelb auf jeder Fläche trägt - der übrige schwarz um weiße Schrift", () => {
        expect(auswerten("paint_symbol", gewaehlt, "text-halo-color", 3, gebiet(GEWAEHLT))).toBe(
            farbe(LABEL.selected.haloColor),
        );
        expect(auswerten("paint_symbol", gewaehlt, "text-halo-color", 3, gebiet(ANDERES))).toBe(farbe(LABEL.haloColor));
        expect(LABEL.selected.haloColor).not.toBe(LABEL.haloColor);
    });

    it("Breite und Unschärfe des Saums folgen der Schrift im Band, für den gewählten wie für jeden anderen Namen", () => {
        for (const band of [0, 1, 2, 3, 5]) {
            const groesse = auswerten("layout_symbol", gewaehlt, "text-size", band, gebiet(GEWAEHLT)) as number;
            expect(auswerten("paint_symbol", gewaehlt, "text-halo-width", band, gebiet(GEWAEHLT))).toBeCloseTo(
                groesse * LABEL.selected.haloWidthRatio,
                9,
            );
            expect(auswerten("paint_symbol", gewaehlt, "text-halo-blur", band, gebiet(GEWAEHLT))).toBeCloseTo(
                groesse * LABEL.selected.haloBlurRatio,
                9,
            );
            expect(auswerten("paint_symbol", gewaehlt, "text-halo-width", band, gebiet(ANDERES))).toBeCloseTo(
                groesse * LABEL.haloWidthRatio,
                9,
            );
            expect(auswerten("paint_symbol", gewaehlt, "text-halo-blur", band, gebiet(ANDERES))).toBeCloseTo(
                groesse * LABEL.haloBlurRatio,
                9,
            );
        }
    });

    it("Was gewählt ist, wird nie animiert (Guide §29.1): Schrift- und Saumfarbe wechseln ohne Übergang", () => {
        for (const name of ["text-color-transition", "text-halo-color-transition"]) {
            expect((gewaehlt.paint as Record<string, unknown>)[name], name).toEqual({ duration: 0, delay: 0 });
        }
    });
});

describe("Alles, was Lage, Umbruch, Größe und Kollision bestimmt, kennt die Auswahl nicht", () => {
    it("🔴 die Layout-Eigenschaften und der Filter sind mit und ohne Auswahl DIESELBEN: Der Name steht beim Klick an derselben Stelle, im selben Umbruch, in derselben Größe", () => {
        for (const mitWappen of [true, false]) {
            const ruhig = bauen(undefined, mitWappen);
            const gewaehlt = bauen(GEWAEHLT, mitWappen);
            expect(gewaehlt.layout, `Wappen ${String(mitWappen)}`).toEqual(ruhig.layout);
            expect(gewaehlt.filter).toEqual(ruhig.filter);
            expect(gewaehlt.id).toBe(ruhig.id);
            expect(gewaehlt.source).toBe(ruhig.source);
            expect(gewaehlt["source-layer"]).toBe(ruhig["source-layer"]);
        }
    });

    it("🔴 nichts davon nennt die Auswahl: weder Text, Anker, Versatz, Größe noch Kollisionsschlüssel", () => {
        const gewaehlt = bauen(GEWAEHLT);
        expect(JSON.stringify(gewaehlt.layout)).not.toContain(GEWAEHLT);
        expect(JSON.stringify(gewaehlt.filter)).not.toContain(GEWAEHLT);
        // Genau die Farben nennen sie.
        expect(JSON.stringify(gewaehlt.paint)).toContain(GEWAEHLT);
    });

    it("das Wappen am gewählten Namen steht wie am gewöhnlichen: dasselbe Bild an derselben Stelle (Wappen und Name sind EIN Symbol)", () => {
        const gewaehlt = bauen(GEWAEHLT);
        for (const band of [0, 1, 2, 3, 6]) {
            const bild = auswerten("layout_symbol", gewaehlt, "icon-image", band, gebiet(GEWAEHLT)) as { name: string };
            expect(bild.name).toBe(`coat:${SHA}`);
            expect(auswerten("layout_symbol", gewaehlt, "text-anchor", band, gebiet(GEWAEHLT))).toBe("top");
        }
    });
});

describe("Die Größe je Band", () => {
    it("🔴 die Schrift der Tafel mal Legacys Faktor je Band: 0,75 / 0,83 / 0,91 / 1 - und die Tafel steht größer als Legacys 13,3 px", () => {
        expect(LABEL.sizePx).toBeGreaterThan(13.3);
        const ebene = bauen();
        [0.75, 0.83, 0.91, 1, 1, 1, 1].forEach((faktor, band) => {
            expect(
                auswerten("layout_symbol", ebene, "text-size", band, gebiet(ANDERES)),
                `Band ${String(band)}`,
            ).toBeCloseTo(LABEL.sizePx * faktor, 9);
        });
    });

    it("der Umbruch bleibt fest bei 7 em (Betreiber 2026-10-09: „nö“ zum Umbruch nach Fläche): die Breite folgt der Schrift, nicht die Zeilenzahl", () => {
        expect(LABEL.maxWidthEm).toBe(7);
        expect(bauen(undefined, false).layout?.["text-max-width"]).toBe(7);
    });

    it("die Schrift ist über die Tafel einstellbar, ohne dass eine andere Stelle mitgezogen werden muss: Größe, Wappen und Saum folgen einer Zahl", () => {
        for (const sizePx of [14.5, 16, 17.5]) {
            const ebene = bauen(GEWAEHLT, true, { ...LABEL, sizePx });
            expect(auswerten("layout_symbol", ebene, "text-size", 3, gebiet(GEWAEHLT))).toBeCloseTo(sizePx, 9);
            expect(auswerten("paint_symbol", ebene, "text-halo-width", 3, gebiet(GEWAEHLT))).toBeCloseTo(
                sizePx * LABEL.selected.haloWidthRatio,
                9,
            );
        }
    });
});

describe("Im Stil: ein Symbol, keine zweite Beschriftung", () => {
    function optionen(auswahl: unknown) {
        const composition = composeView("political", "alle");
        return {
            tileUrl: "/t/{z}/{x}/{y}",
            landscapeUrl: "/l/{z}/{x}/{y}",
            landscapeRunUrl: "/r/{z}/{x}/{y}",
            mapLabelUrl: "/m/{z}/{x}/{y}",
            climateUrl: "/c/{z}/{x}/{y}",
            pathUrl: "/p/{z}/{x}/{y}",
            pathLabelUrl: "/pl/{z}/{x}/{y}",
            powerlineUrl: "/pw/{z}/{x}/{y}",
            leyNodeUrl: "/n/{z}/{x}/{y}",
            seriesId: "original",
            view: "political" as const,
            landscapeSelection: "alle" as const,
            display: { ...displayDefaults("political") },
            territories: ZEIGER,
            territoryCoats: WAPPEN,
            areaSelection: auswahl,
            composition,
        };
    }
    const GEBIET = {
        kind: "territory" as const,
        id: GEWAEHLT,
        name: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
        type: "Kaiserreich",
        anchor: { x: 500, y: 500 },
        label: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth",
    };

    it("🔴 mit gewähltem Gebiet gibt es genau EINE Symbolebene aus der Gebietskachel und keine Ebene des Ersatznamens", () => {
        const style = buildPlaceStyle(optionen(GEBIET) as never);
        const symbole = style.layers.filter(
            (layer) => layer.type === "symbol" && (layer as { source?: string }).source === TERRITORY_SOURCE_ID,
        );
        expect(symbole.map((layer) => layer.id)).toEqual([TERRITORY_LABEL_LAYER_ID]);
        expect(style.layers.map((layer) => layer.id)).not.toContain("area-selection-label");
        // Der Stil bleibt gültig.
        expect(validateStyleMin(style as never).map((eintrag) => eintrag.message)).toEqual([]);
    });

    it("🔴 die Ebene der Gebietsnamen ist mit Auswahl dieselbe wie ohne, bis auf die Farben", () => {
        const mit = findLayer(buildPlaceStyle(optionen(GEBIET) as never).layers, TERRITORY_LABEL_LAYER_ID, "symbol");
        const ohne = findLayer(
            buildPlaceStyle(optionen(undefined) as never).layers,
            TERRITORY_LABEL_LAYER_ID,
            "symbol",
        );
        expect(mit?.layout).toEqual(ohne?.layout);
        expect(mit?.filter).toEqual(ohne?.filter);
        expect(JSON.stringify(mit?.paint)).toContain(GEWAEHLT);
        expect(JSON.stringify(ohne?.paint)).not.toContain(GEWAEHLT);
    });

    it("eine gewählte Landschaft behält ihren Ersatznamen (WI-0093): nur das Gebiet hat keinen", () => {
        const landschaft = {
            ...GEBIET,
            kind: "landscape" as const,
            id: "region-weiden",
            name: "Weiden",
            label: "Weiden",
        };
        const style = buildPlaceStyle(optionen(landschaft) as never);
        expect(style.layers.map((layer) => layer.id)).toContain("area-selection-label");
    });
});
