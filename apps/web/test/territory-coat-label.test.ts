import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    coatImageId,
    coatLabelGeometry,
    mediaPublicUrl,
    type CoatLabelGeometry,
} from "@avesmaps3d/shared";
import { buildPlaceStyle } from "../src/map/place-layers.ts";
import { TERRITORY_BAND_STATE } from "../src/map/territory-band.ts";
import { TERRITORY_COATS_STATE, stepOverBands, withTerritoryCoats } from "../src/map/territory-coat-label.ts";
import { TERRITORY_LABEL_LAYER_ID, buildTerritoryLabelLayer } from "../src/map/territory-layers.ts";
import { displayDefaults } from "../src/map/map-display.ts";
import { composeView } from "@avesmaps3d/shared";
import { findLayer, propertySpec } from "./style-spec.ts";

/**
 * Das Wappen am Namen im STIL (WI-0121): welche Gebiete eines tragen, wie groß es steht und wo Wappen und Name vom Anker aus
 * liegen - an Ausdrücken geprüft, die ein Auswerter wirklich ausführt, nicht an ihrer Gestalt.
 *
 * 🔴 Gerechnet wird gegen Legacys Block (`coatLabelGeometry`, `packages/shared/test/political-coat.test.ts`): Das Wappen
 * sitzt mit der Unterkante auf `coatBottomPx`, die Oberkante der Schrift liegt Legacys Lücke darunter.
 */

const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;
const LABEL = POLITICAL.label;
const COAT = LABEL.coat;

const SHA_A = "ab".repeat(32);
const SHA_B = "cd".repeat(32);
const MIT_WAPPEN = "e201c69b-4811-48fd-826c-60ed976c73e0";
const MIT_ANDEREM = "8358472a-b164-438b-a508-60a0a4b8e7aa";
const OHNE_WAPPEN = "00000000-0000-4000-8000-000000000001";
const WAPPEN = {
    [MIT_WAPPEN]: coatImageId(mediaPublicUrl(SHA_A)) as string,
    [MIT_ANDEREM]: coatImageId(mediaPublicUrl(SHA_B)) as string,
};

/** Der Wert einer Layout-Eigenschaft für ein Merkmal, im Band, mit dieser Liste: so wertet MapLibre sie beim Kachelbau aus. */
function auswerten(
    layer: { layout?: unknown },
    property: string,
    band: number,
    eigenschaften: Record<string, unknown>,
    wappen: Record<string, string> = WAPPEN,
): unknown {
    const ausdruck = (layer.layout as Record<string, unknown>)[property];
    const kompiliert = createPropertyExpression(ausdruck as never, property, propertySpec("layout_symbol", property), {
        [TERRITORY_BAND_STATE]: band,
        [TERRITORY_COATS_STATE]: wappen,
    });
    if (kompiliert.result !== "success") {
        throw new Error(
            `Ausdruck ${property} ungültig: ${kompiliert.value.map((fehler) => fehler.message).join("; ")}`,
        );
    }
    return kompiliert.value.evaluate({ zoom: 5 }, { type: 1, properties: eigenschaften } as never);
}

const gebiet = (id: string): Record<string, unknown> => ({
    territory_public_id: id,
    name: "Test",
    band: 0,
    band_to: 6,
});
const geometrie = (band: number): CoatLabelGeometry => coatLabelGeometry(COAT, LABEL, band, COAT.calibratedLines);

describe("Stufen über dem Band", () => {
    it("ein Wert je Band als Stufenausdruck über dem Zustand der Ansicht, nie über dem Zoom; gleiche Werte bleiben ein Wert", () => {
        expect(stepOverBands(() => 3)).toBe(3);
        expect(stepOverBands((band) => band * 2)).toEqual([
            "step",
            ["number", ["global-state", TERRITORY_BAND_STATE]],
            0,
            1,
            2,
            2,
            4,
            3,
            6,
        ]);
        expect(JSON.stringify(stepOverBands((band) => band))).not.toContain('"zoom"');
    });
});

describe("Name der Gebiete: Größe je Band, mit Wappen oder ohne", () => {
    const ohne = buildTerritoryLabelLayer("Testfont");

    it("🔴 Schrift und Saum folgen Legacys Faktor: 0,75 / 0,83 / 0,91 / 1 in den Bändern 0 bis 3, darüber unverändert", () => {
        const schrift = [0, 1, 2, 3, 4, 6].map(
            (band) => auswerten(ohne, "text-size", band, gebiet(OHNE_WAPPEN)) as number,
        );
        [0.75, 0.83, 0.91, 1, 1, 1].forEach((faktor, index) => {
            expect(schrift[index]).toBeCloseTo(LABEL.sizePx * faktor, 10);
        });
        // Der Saum bleibt unter einem Zehntel der Schrift, in jedem Band (sonst füllt er die Glyphenkachel).
        for (const band of [0, 1, 2, 3]) {
            const size = auswerten(ohne, "text-size", band, gebiet(OHNE_WAPPEN)) as number;
            const kompiliert = createPropertyExpression(
                (ohne.paint as Record<string, unknown>)["text-halo-width"] as never,
                "text-halo-width",
                propertySpec("paint_symbol", "text-halo-width"),
                { [TERRITORY_BAND_STATE]: band },
            );
            if (kompiliert.result !== "success") throw new Error("Saum ungültig");
            const saum = kompiliert.value.evaluate({ zoom: 5 }) as number;
            expect(saum / size).toBeCloseTo(LABEL.haloWidthRatio, 10);
        }
    });

    it("🔴 ohne Liste der Wappen bleibt der Name, wie er stand: mittig auf dem Anker, kein Bild, keine Zusatzeigenschaft", () => {
        const layout = ohne.layout as Record<string, unknown>;
        for (const name of ["icon-image", "icon-anchor", "icon-offset", "icon-size", "text-offset"]) {
            expect(layout, name).not.toHaveProperty(name);
        }
        expect(layout["text-anchor"]).toBe("center");
    });
});

describe("Name der Gebiete mit Wappen", () => {
    const mit = buildTerritoryLabelLayer("Testfont", undefined, true);

    it("🔴 ein Gebiet der Liste trägt sein Bild (coat:<sha256>), ein anderes keines; dieselbe Datei hat denselben Namen", () => {
        expect(auswerten(mit, "icon-image", 3, gebiet(MIT_WAPPEN))).toMatchObject({ name: `coat:${SHA_A}` });
        expect(auswerten(mit, "icon-image", 3, gebiet(MIT_ANDEREM))).toMatchObject({ name: `coat:${SHA_B}` });
        // Ohne Wappen: kein Bild (MapLibre bekommt keinen Namen, den es nicht gibt).
        expect(auswerten(mit, "icon-image", 3, gebiet(OHNE_WAPPEN))).toBeNull();
        // Eine leere Liste: niemand trägt eins.
        expect(auswerten(mit, "icon-image", 3, gebiet(MIT_WAPPEN), {})).toBeNull();
    });

    it("🔴 Wappen oben, Name darunter: Anker unten am Wappen, Anker oben am Text - nur dort, wo es ein Wappen gibt", () => {
        expect((mit.layout as Record<string, unknown>)["icon-anchor"]).toBe("bottom");
        expect(auswerten(mit, "text-anchor", 3, gebiet(MIT_WAPPEN))).toBe("top");
        expect(auswerten(mit, "text-anchor", 3, gebiet(OHNE_WAPPEN))).toBe("center");
        expect(auswerten(mit, "text-offset", 3, gebiet(OHNE_WAPPEN))).toEqual([0, 0]);
    });

    it("🔴 das Wappen 30 / 33 / 36 / 40 px: icon-size ist Legacys ganzzahlige Kante durch die Kante des Bildes", () => {
        const groesse = [0, 1, 2, 3, 4, 6].map(
            (band) => auswerten(mit, "icon-size", band, gebiet(MIT_WAPPEN)) as number,
        );
        expect(groesse.map((wert) => wert * COAT.edgePx)).toEqual([30, 33, 36, 40, 40, 40]);
    });

    it("🔴 die Unterkante des Wappens liegt, wo Legacys Block sie hat, und die Lücke zur Schrift bleibt in jedem Band", () => {
        for (const band of [0, 1, 2, 3, 4, 6]) {
            const lage = geometrie(band);
            const groesse = auswerten(mit, "icon-size", band, gebiet(MIT_WAPPEN)) as number;
            const bild = auswerten(mit, "icon-offset", band, gebiet(MIT_WAPPEN)) as [number, number];
            // `icon-offset` wird mit `icon-size` malgenommen.
            expect(bild[0]).toBe(0);
            expect(bild[1] * groesse, `Band ${String(band)}: Unterkante`).toBeCloseTo(lage.coatBottomPx, 6);

            const schrift = auswerten(mit, "text-size", band, gebiet(MIT_WAPPEN)) as number;
            const text = auswerten(mit, "text-offset", band, gebiet(MIT_WAPPEN)) as [number, number];
            const kastenOben = text[1] * schrift;
            // Die Schrift steht mittig in ihrer Zeile: Der Kasten beginnt eine halbe Zeilenhöhe (ohne die Schrift) über ihr.
            const schriftOben = kastenOben + ((LABEL.lineHeightEm - 1) / 2) * schrift;
            expect(schriftOben - bild[1] * groesse, `Band ${String(band)}: Lücke Wappen → Schrift`).toBeCloseTo(
                lage.gapToEmTopPx,
                6,
            );
        }
    });

    it("🔴 der Block aus Wappen und zwei Zeilen Name steht in jedem Band zentriert auf dem Anker, auch mit der größeren Schrift", () => {
        for (const band of [0, 1, 2, 3, 6]) {
            const lage = geometrie(band);
            const oben = lage.coatBottomPx - lage.coatPx - COAT.paddingTopPx;
            const unten = oben + lage.blockPx;
            expect((oben + unten) / 2, `Band ${String(band)}`).toBeCloseTo(0, 6);
            // Das Namensbild hängt um den Überstand der Schrift unter der Lücke (Legacy: 2 px Abstand bei der Schrift von 13,3 px).
            expect(lage.firstLineCenterPx - lage.fontPx / 2 - lage.coatBottomPx, `Band ${String(band)}`).toBeCloseTo(
                COAT.gapToEmTopPx * lage.scale,
                6,
            );
        }
    });

    it("🔴 die Lücke vom Wappen zur Schrift wächst NICHT mit der Schrift: 8,85 px bei Faktor 1 für jede Größe der Tafel (Betreiber 2026-10-09: Schrift größer)", () => {
        for (const sizePx of [13.3, 14.5, 16, 17.5]) {
            const look = { ...LABEL, sizePx };
            const ebene = buildTerritoryLabelLayer("Testfont", undefined, true, look);
            const groesse = auswerten(ebene, "text-size", 3, gebiet(MIT_WAPPEN)) as number;
            expect(groesse, `Schrift ${String(sizePx)}`).toBeCloseTo(sizePx, 10);
            const bildGroesse = auswerten(ebene, "icon-size", 3, gebiet(MIT_WAPPEN)) as number;
            const bild = auswerten(ebene, "icon-offset", 3, gebiet(MIT_WAPPEN)) as [number, number];
            const text = auswerten(ebene, "text-offset", 3, gebiet(MIT_WAPPEN)) as [number, number];
            const unterkante = bild[1] * bildGroesse;
            const schriftOben = text[1] * groesse + ((LABEL.lineHeightEm - 1) / 2) * groesse;
            expect(schriftOben - unterkante, `Schrift ${String(sizePx)}: Lücke`).toBeCloseTo(8.85, 6);
        }
    });

    it("🔴 alles hängt am Band der Ansicht (global-state), nichts am Zoom: MapLibre wertet Layout-Eigenschaften mit dem Zoom der KACHEL aus", () => {
        const layout = mit.layout as Record<string, unknown>;
        for (const name of ["icon-image", "icon-offset", "icon-size", "text-anchor", "text-offset", "text-size"]) {
            expect(JSON.stringify(layout[name]), name).not.toContain('"zoom"');
        }
        expect(JSON.stringify(layout["icon-image"])).toContain(TERRITORY_COATS_STATE);
        expect(JSON.stringify(layout["text-offset"])).toContain(TERRITORY_BAND_STATE);
    });

    it("gemeinsam gesetzt oder verworfen: Weder Bild noch Text darf wegbleiben, und beide kollidieren mit der Rangfolge der Fläche", () => {
        const layout = mit.layout as Record<string, unknown>;
        expect(layout).not.toHaveProperty("icon-optional");
        expect(layout).not.toHaveProperty("text-optional");
        expect(layout["icon-allow-overlap"]).toBeUndefined();
        expect(layout["text-allow-overlap"]).toBe(false);
        expect(layout["symbol-sort-key"]).toEqual(["*", -1, ["get", "area"]]);
    });
});

describe("Der Stil trägt die Liste", () => {
    function stilOptionen(view: "political" | "standard", wappen?: Record<string, string>) {
        const composition = composeView(view, "alle");
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
            view,
            landscapeSelection: "alle" as const,
            display: { ...displayDefaults(view) },
            territories: { schemaVersion: 1 as const, revision: "abcdef012345", displayYearBf: 1049 },
            ...(wappen ? { territoryCoats: wappen } : {}),
            composition,
        };
    }

    it("🔴 die Liste steht als Anfangswert des globalen Zustands, EINMAL, nicht in jedem Ausdruck", () => {
        const style = buildPlaceStyle(stilOptionen("political", WAPPEN) as never);
        expect(style.state?.[TERRITORY_COATS_STATE]).toEqual({ default: WAPPEN });
        const namen = findLayer(style.layers, TERRITORY_LABEL_LAYER_ID, "symbol");
        expect(namen).toBeDefined();
        expect(JSON.stringify(namen)).not.toContain(MIT_WAPPEN);
        expect(JSON.stringify(namen)).toContain("icon-image");
    });

    it("🔴 ohne Liste (die Antwort fehlt oder ist leer) trägt die Ebene kein Bild, und der Zustand ist leer", () => {
        for (const wappen of [undefined, {}]) {
            const style = buildPlaceStyle(stilOptionen("political", wappen) as never);
            expect(style.state?.[TERRITORY_COATS_STATE]).toEqual({ default: {} });
            const namen = findLayer(style.layers, TERRITORY_LABEL_LAYER_ID, "symbol");
            expect(namen?.layout).not.toHaveProperty("icon-image");
        }
    });

    it("🔴 nur in „Politisch“: Standard hat keine Namensebene der Fläche, also auch kein Wappen", () => {
        const standard = buildPlaceStyle(stilOptionen("standard", WAPPEN) as never);
        expect(standard.layers.map((layer) => layer.id)).not.toContain(TERRITORY_LABEL_LAYER_ID);
        expect(JSON.stringify(standard.layers)).not.toContain(
            'icon-image":["case",["has",["to-string",["get","territory_public_id"]]',
        );
        // Die Namen entlang der Grenze tragen nie ein Wappen.
        const grenzname = standard.layers.find((layer) => layer.id === "territory-border-name");
        expect(grenzname?.layout).not.toHaveProperty("icon-image");
    });

    it("withTerritoryCoats lässt die übrigen Zustände des Stils stehen", () => {
        const vorher = { version: 8 as const, sources: {}, layers: [], state: { territoryBand: { default: 3 } } };
        expect(withTerritoryCoats(vorher, WAPPEN).state).toEqual({
            territoryBand: { default: 3 },
            [TERRITORY_COATS_STATE]: { default: WAPPEN },
        });
    });
});
