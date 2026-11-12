import { afterEach, describe, expect, it, vi } from "vitest";
import { ladeStartansicht } from "../src/map/start-view.ts";
import type { LayerSpecification } from "maplibre-gl";
import { createPropertyExpression, featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    composeView,
    politicalBandForCameraZoom,
    politicalMinZoom,
    politicalTileMinBand,
    type MapView,
    type TerritoryPointer,
} from "@avesmaps3d/shared";
import { displayDefaults, effectiveDisplay, type MapDisplay } from "../src/map/map-display.ts";
import {
    buildPlaceLayers,
    buildPlaceStyle,
    PLACE_LABEL_LAYER_IDS,
    placeLabelLayerId,
} from "../src/map/place-layers.ts";
import { TERRITORY_BAND_STATE, territoryBandForZoom, territoryBandLead } from "../src/map/territory-band.ts";
import {
    buildTerritoryBorderLayers,
    buildTerritoryBorderNameLayer,
    buildTerritoryClaimLayer,
    buildTerritoryFillLayer,
    buildTerritoryLabelLayer,
    stepByBand,
    TERRITORY_BORDER_NAME_LAYER_ID,
    TERRITORY_BORDER_SOURCE_ID,
    TERRITORY_CASING_LAYER_ID,
    TERRITORY_CASING_ROOT_LAYER_ID,
    TERRITORY_CLAIM_LAYER_ID,
    TERRITORY_FILL_LAYER_ID,
    TERRITORY_INNER_LAYER_PREFIX,
    TERRITORY_LABEL_LAYER_ID,
    TERRITORY_OUTER_LAYER_ID,
    TERRITORY_OUTER_ROOT_LAYER_ID,
    TERRITORY_SOURCE_ID,
} from "../src/map/territory-layers.ts";
import { findLayer, ortsnamenImStapel, propertySpec } from "./style-spec.ts";

/**
 * Die Herrschaftsgebiete auf der Karte (WI-0062, ADR-0014): Fläche, Name, Grenzen, Schraffur, Hauptstädte, Auswahl.
 *
 * 🔴 Geprüft wird, was im Stil ankommt und was ein Stil wirklich auswertet - nicht nur, dass Layer existieren. Das Band der
 * Ansicht ist der globale Zustand `territoryBand` (Kamerazoom, Nachtrag 2026-09-30); die Tests geben ihn den Auswertern
 * so mit, wie MapLibre es tut.
 */

const POLITICAL = AVENTURIA_POLITICAL_CARTOGRAPHY;
/** Der Vorzug am Rechner (in dieser Umgebung ohne `matchMedia` gilt er) und am Telefon. */
const LEAD = POLITICAL.bandLeadZoom;
const LEAD_TELEFON = POLITICAL.bandLeadZoomPhone;
const ZEIGER: TerritoryPointer = { schemaVersion: 1, revision: "abcdef012345", displayYearBf: 1049 };
const ZEILE = (typ: string, eigenschaften: Record<string, unknown>) => ({ type: typ, properties: eigenschaften });
const zustand = (band: number): Record<string, unknown> => ({ [TERRITORY_BAND_STATE]: band });

/** Ein Kamerazoom mitten im Band: dort gilt es sicher, ohne an einer Stufe zu stehen. */
const zoomImBand = (band: number): number => politicalMinZoom(band, LEAD) + 0.5;

function anzeige(view: MapView, ueberschreibe: Partial<MapDisplay> = {}) {
    const composition = composeView(view, "alle");
    const display = { ...displayDefaults(view), ...ueberschreibe };
    return { composition, zeige: effectiveDisplay(view, composition, display) };
}

function layerIds(view: MapView, ueberschreibe: Partial<MapDisplay> = {}, territoryData = true): string[] {
    const { composition, zeige } = anzeige(view, ueberschreibe);
    return buildPlaceLayers({ labels: true, composition, display: zeige, territoryData }).map((layer) => layer.id);
}

/** Nimmt die Ebene ein Merkmal im Band der Ansicht `band` an? So wertet MapLibre den Filter beim Aufbau der Kachel aus. */
function nimmtAn(
    layer: LayerSpecification | undefined,
    band: number,
    eigenschaften: Record<string, unknown>,
    typ = "line",
    zoom = 5,
): boolean {
    const filter = featureFilter((layer as { filter?: unknown } | undefined)?.filter as never, "filter", zustand(band));
    return filter.filter({ zoom }, ZEILE(typ, eigenschaften) as never, undefined as never);
}

/** Der Wert einer Stileigenschaft bei einem Zoom (und Band), so wie MapLibre ihn auswertet. */
function auswerten(
    group: string,
    property: string,
    ausdruck: unknown,
    zoom: number,
    band = 0,
    eigenschaften?: Record<string, unknown>,
): unknown {
    const kompiliert = createPropertyExpression(
        ausdruck as never,
        property,
        propertySpec(group, property),
        zustand(band),
    );
    if (kompiliert.result !== "success") throw new Error(`Ausdruck ${property} ungültig`);
    return kompiliert.value.evaluate({ zoom }, eigenschaften ? (ZEILE("polygon", eigenschaften) as never) : undefined);
}

/** Alle Ausdrücke unterhalb eines Wertes, die `["zoom"]` sind. */
function nenntZoom(wert: unknown): boolean {
    if (Array.isArray(wert)) {
        if (wert.length === 1 && wert[0] === "zoom") return true;
        return wert.some((teil) => nenntZoom(teil));
    }
    if (wert !== null && typeof wert === "object") return Object.values(wert).some((teil) => nenntZoom(teil));
    return false;
}

describe("Bänder und Kamerazoom", () => {
    it("🔴 der Vorzug der Tafel gilt je Gerät (Betreiber 2026-09-30): Rechner Baronien ab Zoom 5, Telefon ab Zoom 4; Band b beginnt bei b + 1 − Vorzug", () => {
        expect(politicalMinZoom(4, LEAD)).toBe(5);
        expect(politicalMinZoom(4, LEAD_TELEFON)).toBe(4);
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, LEAD))).toEqual([0, 2, 3, 4, 5, 6, 7]);
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, LEAD_TELEFON))).toEqual([
            0, 1, 2, 3, 4, 5, 6,
        ]);
        // Ohne Vorzug ist es Legacys Abbildung (Legacy z + 1 = MapLibre z), mit 1 eine ganze Stufe früher.
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, 0))).toEqual([0, 2, 3, 4, 5, 6, 7]);
        expect([0, 1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, 1))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("🔴 das Band folgt allein dem Kamerazoom, floor(Zoom − 1 + Vorzug), von 0 bis 6: Rechner 4,99 → Band 3, 5 → Band 4; Telefon 3,99 → Band 3, 4 → Band 4", () => {
        expect(politicalBandForCameraZoom(4.99, 6, LEAD)).toBe(3);
        expect(politicalBandForCameraZoom(5, 6, LEAD)).toBe(4);
        expect(politicalBandForCameraZoom(3.99, 6, LEAD_TELEFON)).toBe(3);
        expect(politicalBandForCameraZoom(4, 6, LEAD_TELEFON)).toBe(4);
        expect(
            [0, 0.9, 1.49, 1.5, 2.5, 3.49, 3.5, 6.49, 6.5, 7, 12].map((zoom) =>
                politicalBandForCameraZoom(zoom, 6, LEAD),
            ),
        ).toEqual([0, 0, 0, 0, 1, 2, 2, 5, 5, 6, 6]);
        expect(
            [0, 0.9, 1, 2.5, 3, 6, 6.99, 7, 12].map((zoom) => politicalBandForCameraZoom(zoom, 6, LEAD_TELEFON)),
        ).toEqual([0, 0, 1, 2, 3, 6, 6, 6, 6]);
        // Legacys Abbildung: Zoom − 1.
        expect([0, 1, 2, 3, 6, 7, 12].map((zoom) => politicalBandForCameraZoom(zoom, 6, 0))).toEqual([
            0, 0, 1, 2, 5, 6, 6,
        ]);
        expect(politicalBandForCameraZoom(Number.NaN, 6, LEAD)).toBe(0);
        // Die Umkehrung: jedes Band beginnt genau bei seinem Zoom und hält bis kurz vor dem nächsten.
        for (const vorzug of [LEAD, LEAD_TELEFON]) {
            for (let band = 1; band <= 6; band += 1) {
                expect(
                    politicalBandForCameraZoom(politicalMinZoom(band, vorzug), 6, vorzug),
                    `Vorzug ${String(vorzug)}, Band ${String(band)}`,
                ).toBe(band);
                expect(politicalBandForCameraZoom(politicalMinZoom(band, vorzug) - 0.01, 6, vorzug)).toBe(band - 1);
            }
        }
    });

    it("🔴 jede Kachel trägt die Bänder, die im Anzeigebereich ihrer Zoomstufe vorkommen können", () => {
        expect([0, 1, 2, 3, 4, 5, 8].map(politicalTileMinBand)).toEqual([0, 0, 0, 0, 1, 2, 5]);
        // Eine Kachel im Zoom z erscheint bei Kamerazoom z − 2 (nah) bis z + 3 (fern, Gelände, 60°): das Band der Kamera liegt
        // nie unter der Untergrenze der Kachel - für den Vorzug der Tafel und für Legacys Abbildung.
        for (const vorzug of [0, LEAD, LEAD_TELEFON]) {
            for (let kachel = 0; kachel <= 8; kachel += 1) {
                for (let kamera = kachel - 2; kamera <= kachel + 3; kamera += 0.25) {
                    expect(
                        politicalBandForCameraZoom(kamera, 6, vorzug),
                        `Kachel ${String(kachel)}, Kamera ${String(kamera)}, Vorzug ${String(vorzug)}`,
                    ).toBeGreaterThanOrEqual(politicalTileMinBand(kachel));
                }
            }
        }
    });

    it("ein Stufenausdruck legt die Werte auf die Kamerazoomstufen ihrer Bänder", () => {
        expect(stepByBand([1, 1, 1, 1, 1, 1, 1])).toBe(1);
        expect(stepByBand([1.5, 1.5, 2, 2, 2, 2, 2])).toEqual([
            "step",
            ["zoom"],
            1.5,
            ...[1, 2, 3, 4, 5, 6].flatMap((band) => [politicalMinZoom(band, LEAD), [1.5, 2, 2, 2, 2, 2][band - 1]]),
        ]);
        const werte = [0, 0.15, 0.3, 0.5, 1, 1, 1];
        const ausdruck = stepByBand(werte);
        for (let band = 0; band <= 6; band += 1) {
            expect(auswerten("paint_line", "line-opacity", ausdruck, zoomImBand(band)), `Band ${String(band)}`).toBe(
                werte[band],
            );
        }
    });
    it("🔴 die Stufen hängen am Gerät: am Telefon beginnt jedes Band eine Stufe früher, und der Vorzug wird nur an EINER Stelle gefragt", () => {
        const stufen = (werte: readonly number[]): number[] => {
            const ausdruck = stepByBand(werte) as unknown as unknown[];
            return ausdruck.slice(3).filter((_, index) => index % 2 === 0) as number[];
        };
        const werte = [1.5, 1.5, 2, 3, 4, 5, 6];
        expect(stufen(werte)).toEqual([1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, LEAD)));
        vi.stubGlobal("matchMedia", () => ({ matches: true }));
        vi.stubGlobal("innerWidth", 390);
        vi.stubGlobal("innerHeight", 844);
        try {
            expect(stufen(werte)).toEqual([1, 2, 3, 4, 5, 6].map((band) => politicalMinZoom(band, LEAD_TELEFON)));
            // Das Band der Ansicht und die Stufen des Stils nehmen denselben Vorzug: Bei jedem Zoom passt das Band zu seinen Stufen.
            const ausdruck = stepByBand([0, 0.15, 0.3, 0.5, 1, 1, 1]);
            const opazitaet = [0, 0.15, 0.3, 0.5, 1, 1, 1];
            for (let band = 0; band <= 6; band += 1) {
                const zoom = politicalMinZoom(band, LEAD_TELEFON) + 0.5;
                expect(territoryBandForZoom(zoom), `Band ${String(band)}`).toBe(band);
                expect(auswerten("paint_line", "line-opacity", ausdruck, zoom)).toBe(opazitaet[band]);
            }
            // Die Namen entlang der Grenze wachsen mit denselben Stufen: Band 4 beginnt am Telefon bei Zoom 4.
            const namenGroesse = buildTerritoryBorderNameLayer("Testfont").layout as Record<string, unknown>;
            const ersteStufe = (namenGroesse["text-size"] as unknown[]).slice(3)[0];
            expect(ersteStufe).toBe(politicalMinZoom(POLITICAL.borderName.fromBand, LEAD_TELEFON));
        } finally {
            vi.unstubAllGlobals();
        }
        expect(territoryBandLead()).toBe(LEAD);
    });
});

describe("🔴 Das Band gilt für die ganze Ansicht: nie der Zoom der Kachel", () => {
    /** Jede Ebene der Gebiete, in jeder Ansicht und Stärke. */
    function alleGebietsebenen(): { view: string; layer: { id: string } & Record<string, unknown> }[] {
        const found: { view: string; layer: { id: string } & Record<string, unknown> }[] = [];
        for (const view of ["political", "standard", "landscapes"] as const) {
            for (const borders of [true, false]) {
                const { composition, zeige } = anzeige(view, { borders });
                for (const layer of buildPlaceLayers({
                    labels: true,
                    composition,
                    display: zeige,
                    territoryData: true,
                })) {
                    if (layer.id.startsWith("territory-")) {
                        found.push({ view: `${view}/${String(borders)}`, layer: layer as never });
                    }
                }
            }
        }
        return found;
    }

    it("🔴 keine Ebene der Gebiete hat minzoom oder maxzoom: MapLibre baut dort in Kacheln unter diesem Zoom keine Geometrie", () => {
        const ebenen = alleGebietsebenen();
        expect(ebenen.length).toBeGreaterThan(10);
        for (const { view, layer } of ebenen) {
            expect(layer, `${layer.id} in ${view}`).not.toHaveProperty("minzoom");
            expect(layer, `${layer.id} in ${view}`).not.toHaveProperty("maxzoom");
        }
    });

    it("🔴 kein Filter der Gebiete nennt den Zoom, und keine Layout-Eigenschaft, die die Kachel auswertet", () => {
        for (const { view, layer } of alleGebietsebenen()) {
            expect(nenntZoom(layer["filter"]), `Filter von ${layer.id} in ${view}`).toBe(false);
        }
        // `text-offset` und `text-letter-spacing` wertet MapLibre beim Aufbau der Kachel aus: mit dem Zoom der Kachel.
        const layout = buildTerritoryBorderNameLayer("Testfont").layout as Record<string, unknown>;
        expect(nenntZoom(layout["text-offset"])).toBe(false);
        expect(nenntZoom(layout["text-letter-spacing"])).toBe(false);
        expect(JSON.stringify(layout["text-offset"])).toContain("global-state");
    });

    it("🔴 jede Ebene der Fläche filtert auf das Band der Ansicht: ein Durchlauf von band bis band_to gilt in jedem seiner Bänder", () => {
        const fuellung = buildTerritoryFillLayer();
        const name = buildTerritoryLabelLayer("Testfont");
        for (const layer of [fuellung, name]) {
            const merkmal = { band: 2, band_to: 5 };
            expect([0, 1, 2, 3, 4, 5, 6].map((band) => nimmtAn(layer, band, merkmal, "polygon"))).toEqual([
                false,
                false,
                true,
                true,
                true,
                true,
                false,
            ]);
        }
    });

    it("🔴 die Innengrenzen bilden eine Aufteilung der Bänder: in jedem Band zeichnet genau eine Gruppe, in Band 0 keine", () => {
        const gruppen = buildTerritoryBorderLayers("strong").filter((layer) =>
            layer.id.startsWith(TERRITORY_INNER_LAYER_PREFIX),
        );
        expect(gruppen.map((layer) => layer.id)).toEqual([
            `${TERRITORY_INNER_LAYER_PREFIX}1`,
            `${TERRITORY_INNER_LAYER_PREFIX}3`,
            `${TERRITORY_INNER_LAYER_PREFIX}4`,
        ]);
        const linie = { kind: "inner", level: 1, band: 0, band_to: 6 };
        for (let band = 0; band <= 6; band += 1) {
            const zeichnen = gruppen.filter((layer) => nimmtAn(layer, band, linie)).map((layer) => layer.id);
            expect(zeichnen.length, `Band ${String(band)}`).toBe(band === 0 ? 0 : 1);
        }
        // Und sie schneiden nach dem Durchlauf der Linie: eine Linie nur in den Bändern 2 bis 3 zeichnet nur dort.
        const kurz = { kind: "inner", level: 1, band: 2, band_to: 3 };
        expect([1, 2, 3, 4].map((band) => gruppen.some((layer) => nimmtAn(layer, band, kurz)))).toEqual([
            false,
            true,
            true,
            false,
        ]);
    });

    it("🔴 die Hauptstädte folgen dem Band der Ansicht (Zustand), nicht dem Zoom im Filter", () => {
        const { composition, zeige } = anzeige("political");
        const marker = findLayer(
            buildPlaceLayers({ labels: true, composition, display: zeige, territoryData: true }),
            "place-marker",
            "circle",
        );
        const ort = (bands: string) => ({ subtype: "stadt", is_hidden: false, capital_bands: bands });
        expect([3, 4, 5].map((band) => nimmtAn(marker, band, ort("0145"), "point"))).toEqual([false, true, true]);
        expect(JSON.stringify(marker?.filter)).toContain("global-state");
    });

    it("der Stil trägt den Anfangswert des Bandes aus dem Kamerazoom, mit dem er gebaut wird", () => {
        const optionen = { ...stilOptionen("political"), cameraZoom: 5.4 };
        const style = buildPlaceStyle(optionen);
        expect(style.state?.[TERRITORY_BAND_STATE]).toEqual({ default: politicalBandForCameraZoom(5.4, 6, LEAD) });
        expect(buildPlaceStyle({ ...optionen, cameraZoom: 1.2 }).state?.[TERRITORY_BAND_STATE]).toEqual({
            default: politicalBandForCameraZoom(1.2, 6, LEAD),
        });
    });
});

describe("Fläche und Name", () => {
    it("🔴 die Fläche liest die Farbe des Gebiets und die einheitliche Deckkraft der Tafel, nur ganz Umstrittenes bleibt ungefüllt", () => {
        const layer = buildTerritoryFillLayer();
        expect(layer).toMatchObject({
            id: TERRITORY_FILL_LAYER_ID,
            type: "fill",
            source: TERRITORY_SOURCE_ID,
            "source-layer": "territory_fill_render",
            paint: { "fill-color": ["get", "color"] },
            layout: { "fill-sort-key": ["get", "sort_order"] },
        });
        const deckkraft = (eigenschaften: Record<string, unknown>): unknown =>
            auswerten(
                "paint_fill",
                "fill-opacity",
                (layer.paint as Record<string, unknown>)["fill-opacity"],
                5,
                4,
                eigenschaften,
            );
        // Deckkraft einheitlich für Besucher wie Legacys Frontend (Betreiber 2026-09-30: „70“), nicht je Gebiet.
        expect(deckkraft({ hatched: false })).toBe(POLITICAL.fillOpacity);
        expect(deckkraft({})).toBe(POLITICAL.fillOpacity);
        // Ganz umstritten: Die Fläche bleibt als Ziel des Klicks, wird aber nicht gefüllt - die Schraffur liegt über dem Bild.
        expect(deckkraft({ hatched: true })).toBe(0);
    });

    it("der Name steht dunkel mit hellem Saum, zentriert und mehrzeilig; große Flächen setzen zuerst", () => {
        const layer = buildTerritoryLabelLayer("Testfont");
        expect(layer).toMatchObject({
            id: TERRITORY_LABEL_LAYER_ID,
            type: "symbol",
            source: TERRITORY_SOURCE_ID,
            "source-layer": "territory_label_render",
            layout: {
                "text-field": ["get", "name"],
                "text-font": ["Testfont"],
                "text-max-width": POLITICAL.label.maxWidthEm,
                "text-justify": "center",
            },
            paint: { "text-color": POLITICAL.label.color, "text-halo-color": POLITICAL.label.haloColor },
        });
        // Ab Band 3 steht die Schrift voll (WI-0121: darunter folgt sie Legacys Faktor je Band, `territory-coat-label.test.ts`).
        const groesse = auswerten(
            "layout_symbol",
            "text-size",
            (layer.layout as Record<string, unknown>)["text-size"],
            5,
            3,
        );
        expect(groesse).toBe(POLITICAL.label.sizePx);
        // Der Saum ist ein Anteil der Schrift und bleibt unter dem, was die Glyphen als Rand tragen (0,125), sonst schneidet
        // er das Glyphenviereck als gerade Kante ab.
        const saum = auswerten(
            "paint_symbol",
            "text-halo-width",
            (layer.paint as Record<string, unknown>)["text-halo-width"],
            5,
            3,
        );
        expect((saum as number) / POLITICAL.label.sizePx).toBeCloseTo(POLITICAL.label.haloWidthRatio, 10);
        expect(POLITICAL.label.haloWidthRatio).toBeLessThanOrEqual(0.125);
        const schluessel = createPropertyExpression(
            (layer.layout as Record<string, unknown>)["symbol-sort-key"],
            "symbol-sort-key",
            propertySpec("layout_symbol", "symbol-sort-key"),
        );
        if (schluessel.result !== "success") throw new Error("Ausdruck ungültig");
        const gross = schluessel.value.evaluate({ zoom: 5 }, ZEILE("symbol", { area: 900 }) as never) as number;
        const klein = schluessel.value.evaluate({ zoom: 5 }, ZEILE("symbol", { area: 3 }) as never) as number;
        expect(gross).toBeLessThan(klein);
    });

    it("🔴 das gewählte Gebiet BLEIBT unter den Namen: derselbe Name, nur gelb (WI-0121 Nachtrag, Muster WI-0093)", () => {
        const layer = findLayer([buildTerritoryLabelLayer("Testfont", "gebiet-1")], TERRITORY_LABEL_LAYER_ID, "symbol");
        const gebiet = (id: string) => ({ territory_public_id: id, band: 0, band_to: 6 });
        expect(nimmtAn(layer, 4, gebiet("gebiet-1"), "symbol")).toBe(true);
        expect(nimmtAn(layer, 4, gebiet("gebiet-2"), "symbol")).toBe(true);
    });
});

describe("Transparenz der Herrschaftsgebiete (Kanal OPS-000082)", () => {
    afterEach(async () => {
        await ladeStartansicht(() => Promise.resolve(Response.json({})));
    });

    it("🔴 Füllung und Schraffur folgen dem Wert aus den Standardwerten; ohne Abweichung gilt die Vorgabe der Tafel", async () => {
        await ladeStartansicht(() => Promise.resolve(Response.json({})));
        expect(buildTerritoryClaimLayer().paint).toMatchObject({ "fill-opacity": POLITICAL.fillOpacity });

        await ladeStartansicht(() => Promise.resolve(Response.json({ gebieteTransparenz: 25 })));
        expect(buildTerritoryClaimLayer().paint).toMatchObject({ "fill-opacity": 0.75 });
        expect(JSON.stringify(buildTerritoryFillLayer().paint)).toContain(
            '"fill-opacity":["case",["==",["get","hatched"],true],0,0.75]',
        );
    });
});

describe("Schraffur umstrittener Gebiete (Nachtrag WI-0062, Legacy-Overlay)", () => {
    const HATCH = POLITICAL.claimHatch;

    it("🔴 die Ebene füllt mit dem Muster aus der Kachel, mit der Deckkraft der Füllung, und zeichnet nur das Band der Ansicht", () => {
        const layer = buildTerritoryClaimLayer();
        expect(layer).toMatchObject({
            id: TERRITORY_CLAIM_LAYER_ID,
            type: "fill",
            source: TERRITORY_SOURCE_ID,
            "source-layer": "territory_claim_render",
            paint: { "fill-pattern": ["get", "pattern"], "fill-opacity": POLITICAL.fillOpacity },
        });
        // Ein Merkmal je Band (das Muster hängt an der Streifenbreite des Bandes): nur das Band der Ansicht.
        const merkmal = (band: number) => ({ band, pattern: `claim-${String(band)}-aabbcc-112233` });
        expect([3, 4, 5].map((band) => nimmtAn(layer, 4, merkmal(band), "polygon"))).toEqual([false, true, false]);
    });

    it("🔴 nur in der politischen Ansicht (Legacy: getSelectedMapLayerMode() === political), über der Füllung und unter den Grenzen", () => {
        expect(HATCH.views).toEqual(["political"]);
        const politisch = layerIds("political");
        expect(politisch).toContain(TERRITORY_CLAIM_LAYER_ID);
        expect(politisch.indexOf(TERRITORY_CLAIM_LAYER_ID)).toBeGreaterThan(politisch.indexOf(TERRITORY_FILL_LAYER_ID));
        expect(politisch.indexOf(TERRITORY_CLAIM_LAYER_ID)).toBeLessThan(
            politisch.indexOf(`${TERRITORY_INNER_LAYER_PREFIX}1`),
        );
        // Standard und Landschaften zeichnen mit „Grenzen“ nur Linien: keine Fläche, keine Schraffur.
        for (const view of ["standard", "landscapes"] as const) {
            expect(layerIds(view, { borders: true }), view).not.toContain(TERRITORY_CLAIM_LAYER_ID);
        }
        // Ohne Zeiger der Gebiete gibt es keine Quelle, also keine Schraffur.
        expect(layerIds("political", {}, false)).not.toContain(TERRITORY_CLAIM_LAYER_ID);
    });

    it("🔴 die Tafel entscheidet über die Ansicht, nicht ein Ansichtsname im Code", () => {
        const { composition } = anzeige("political");
        expect(effectiveDisplay("political", composition, displayDefaults("political")).claimHatch).toBe(true);
        const standard = anzeige("standard").composition;
        expect(effectiveDisplay("standard", standard, displayDefaults("standard")).claimHatch).toBe(false);
    });

    it("🔴 Legacys Werte: 45°, 20 px bei Legacy-Zoom 6, je Stufe × 1,25, zwischen 3 und 22 px", () => {
        expect(HATCH.angleDeg).toBe(45);
        expect(HATCH.stripeWidthBasePx).toBe(20);
        expect(HATCH.stripeWidthRefBand).toBe(6);
        expect(HATCH.stripeWidthRatio).toBe(1.25);
        expect([HATCH.stripeWidthMinPx, HATCH.stripeWidthMaxPx]).toEqual([3, 22]);
    });
});

describe("Grenzlinien", () => {
    it("🔴 innen weiß und gestrichelt in drei Bandgruppen, darunter der Saum, darüber außen hellgrau und durchgezogen", () => {
        const layers = buildTerritoryBorderLayers("strong");
        expect(layers.map((layer) => layer.id)).toEqual([
            `${TERRITORY_INNER_LAYER_PREFIX}1`,
            `${TERRITORY_INNER_LAYER_PREFIX}3`,
            `${TERRITORY_INNER_LAYER_PREFIX}4`,
            TERRITORY_CASING_LAYER_ID,
            TERRITORY_CASING_ROOT_LAYER_ID,
            TERRITORY_OUTER_LAYER_ID,
            TERRITORY_OUTER_ROOT_LAYER_ID,
        ]);
        for (const layer of layers) {
            expect(layer).toMatchObject({
                type: "line",
                source: TERRITORY_BORDER_SOURCE_ID,
                "source-layer": "territory_border_render",
            });
        }
        const [fein, , voll] = layers as unknown as { paint: Record<string, unknown> }[];
        expect(voll?.paint["line-width"]).toBe(2);
        expect(voll?.paint["line-color"]).toBe(POLITICAL.inner.color);
        expect(voll?.paint["line-opacity"]).toBe(POLITICAL.inner.alpha);
        // MapLibre rechnet die Strichlänge in Vielfachen der Breite: [5, 4] bei 2 px.
        expect(voll?.paint["line-dasharray"]).toEqual([2.5, 2]);
        expect(fein?.paint["line-dasharray"]).toEqual([2 / 0.75, 3 / 0.75]);
        const aussen = findLayer(layers, TERRITORY_OUTER_LAYER_ID, "line");
        expect(aussen?.paint?.["line-color"]).toBe(POLITICAL.outer.color);
        expect(aussen?.paint?.["line-dasharray"]).toBeUndefined();
    });

    it("die Außengrenze eines Reiches (Ebene 0) ist dicker als die einer Hülle darunter", () => {
        const layers = buildTerritoryBorderLayers("strong");
        const wert = (id: string, band: number): number =>
            auswerten(
                "paint_line",
                "line-width",
                findLayer(layers, id, "line")?.paint?.["line-width"],
                zoomImBand(band),
            ) as number;
        expect(wert(TERRITORY_OUTER_ROOT_LAYER_ID, 5)).toBeGreaterThan(wert(TERRITORY_OUTER_LAYER_ID, 5));
        // Auf den Bändern 0 und 1 sind beide feiner (Legacy: ein Pixel weniger).
        expect(wert(TERRITORY_OUTER_ROOT_LAYER_ID, 1)).toBeLessThan(wert(TERRITORY_OUTER_ROOT_LAYER_ID, 5));
        // Der Filter trennt Reich und Hülle an der Ebene.
        const linie = (kind: string, level: number) => ({ kind, level, band: 0, band_to: 6 });
        const reich = findLayer(layers, TERRITORY_OUTER_ROOT_LAYER_ID, "line");
        const huelle = findLayer(layers, TERRITORY_OUTER_LAYER_ID, "line");
        expect(nimmtAn(reich, 5, linie("outer", 0))).toBe(true);
        expect(nimmtAn(reich, 5, linie("outer", 2))).toBe(false);
        expect(nimmtAn(huelle, 5, linie("outer", 2))).toBe(true);
        expect(nimmtAn(huelle, 5, linie("inner", 2))).toBe(false);
    });

    it("🔴 der schwache Modus blendet nach Band ein (Legacy 0 / 0,15 / 0,3 / 0,5 / 1), der kräftige nicht", () => {
        const deckkraft = (strength: "strong" | "weak", id: string, band: number): unknown => {
            const layer = findLayer(buildTerritoryBorderLayers(strength), id, "line");
            return auswerten("paint_line", "line-opacity", layer?.paint?.["line-opacity"], zoomImBand(band));
        };
        expect([0, 1, 2, 3, 4, 6].map((band) => deckkraft("weak", TERRITORY_OUTER_LAYER_ID, band))).toEqual([
            0, 0.15, 0.3, 0.5, 1, 1,
        ]);
        expect([0, 5].map((band) => deckkraft("strong", TERRITORY_OUTER_LAYER_ID, band))).toEqual([1, 1]);
        expect(deckkraft("strong", `${TERRITORY_INNER_LAYER_PREFIX}4`, 6)).toBe(POLITICAL.inner.alpha);
    });

    it("🔴 die Grenzen sind besser sichtbar als Legacys: Innengrenze deckender, feiner dunkler Saum unter der hellen Linie (Betreiberwunsch 2026-09-30)", () => {
        // Legacys Innengrenze steht bei 0,6; die Karte zeichnet sie deckender. Abweichung mit Grund im WI.
        expect(POLITICAL.inner.alpha).toBeGreaterThan(0.6);
        const casing = POLITICAL.outer.casing;
        expect(casing.widthPx).toBeGreaterThan(0);
        for (const strength of ["strong", "weak"] as const) {
            const layers = buildTerritoryBorderLayers(strength);
            const ids = layers.map((layer) => layer.id);
            // Der Saum liegt unter ALLEN hellen Linien, auch der Nachbarhülle.
            const ersteHelle = Math.min(
                ids.indexOf(TERRITORY_OUTER_LAYER_ID),
                ...(ids.includes(TERRITORY_OUTER_ROOT_LAYER_ID) ? [ids.indexOf(TERRITORY_OUTER_ROOT_LAYER_ID)] : []),
            );
            for (const id of [TERRITORY_CASING_LAYER_ID, TERRITORY_CASING_ROOT_LAYER_ID]) {
                if (ids.includes(id)) expect(ids.indexOf(id), `${id} (${strength})`).toBeLessThan(ersteHelle);
            }
            // Er ist auf jeder Seite `widthPx` breiter als die helle Linie und liegt ebenso innen.
            for (const [saum, linie] of [
                [TERRITORY_CASING_LAYER_ID, TERRITORY_OUTER_LAYER_ID],
                [TERRITORY_CASING_ROOT_LAYER_ID, TERRITORY_OUTER_ROOT_LAYER_ID],
            ] as const) {
                const breit = findLayer(layers, saum, "line");
                const hell = findLayer(layers, linie, "line");
                if (!breit || !hell) continue;
                for (let band = 0; band <= 6; band += 1) {
                    const zoom = zoomImBand(band);
                    expect(auswerten("paint_line", "line-width", breit.paint?.["line-width"], zoom)).toBeCloseTo(
                        (auswerten("paint_line", "line-width", hell.paint?.["line-width"], zoom) as number) +
                            2 * casing.widthPx,
                        10,
                    );
                    expect(auswerten("paint_line", "line-offset", breit.paint?.["line-offset"], zoom)).toBe(
                        auswerten("paint_line", "line-offset", hell.paint?.["line-offset"], zoom),
                    );
                    // Im schwachen Modus blendet der Saum mit der Linie ein: wo sie fehlt, fehlt auch er.
                    const deckkraft = auswerten("paint_line", "line-opacity", breit.paint?.["line-opacity"], zoom);
                    const helle = auswerten("paint_line", "line-opacity", hell.paint?.["line-opacity"], zoom) as number;
                    expect(deckkraft).toBeCloseTo(helle * casing.alpha, 10);
                }
            }
        }
    });
});

describe("Konturdesign wie Legacy (Nachtrag WI-0062)", () => {
    it("🔴 die Außengrenze liegt INNEN an der Grenze: die halbe Breite als Versatz nach rechts (Legacys Clip)", () => {
        const layers = buildTerritoryBorderLayers("strong");
        for (const id of [TERRITORY_OUTER_LAYER_ID, TERRITORY_OUTER_ROOT_LAYER_ID]) {
            const layer = findLayer(layers, id, "line");
            for (let band = 0; band <= 6; band += 1) {
                const zoom = zoomImBand(band);
                const breite = auswerten("paint_line", "line-width", layer?.paint?.["line-width"], zoom) as number;
                const versatz = auswerten("paint_line", "line-offset", layer?.paint?.["line-offset"], zoom) as number;
                // Positiv heißt rechts der Laufrichtung, und die Ableitung richtet jede Hülle rechtsläufig aus.
                expect(versatz, `${id} im Band ${String(band)}`).toBeCloseTo(breite / 2, 10);
                expect(versatz).toBeGreaterThan(0);
            }
        }
        // Die Innengrenze liegt mittig auf der Grenze: Legacy zeichnet sie ungeclippt.
        for (const layer of layers.filter((entry) => entry.id.startsWith(TERRITORY_INNER_LAYER_PREFIX))) {
            expect(layer.type === "line" ? layer.paint?.["line-offset"] : "n/a", layer.id).toBeUndefined();
        }
    });

    it("🔴 die Breiten der Außengrenze: kräftig 0,5 / 1,5 (Band 0 und 1), dann 1 und 2 für Reiche, schwach 1 / 1,5 / 2 / 3", () => {
        const layers = buildTerritoryBorderLayers("strong");
        const breite = (id: string, band: number): number =>
            auswerten(
                "paint_line",
                "line-width",
                findLayer(layers, id, "line")?.paint?.["line-width"],
                zoomImBand(band),
            ) as number;
        expect([0, 1, 2, 5].map((band) => breite(TERRITORY_OUTER_LAYER_ID, band))).toEqual([0.5, 0.5, 1, 1]);
        expect([0, 1, 2, 5].map((band) => breite(TERRITORY_OUTER_ROOT_LAYER_ID, band))).toEqual([1.5, 1.5, 2, 2]);
        // Schwach: EINE Schicht für alle Hüllen, ohne dickere Reiche, Breiten nach Legacy BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM.
        const schwach = buildTerritoryBorderLayers("weak");
        expect(schwach.map((layer) => layer.id)).not.toContain(TERRITORY_OUTER_ROOT_LAYER_ID);
        expect(schwach.map((layer) => layer.id)).not.toContain(TERRITORY_CASING_ROOT_LAYER_ID);
        const aussen = findLayer(schwach, TERRITORY_OUTER_LAYER_ID, "line");
        // Ein Reich und eine Hülle teilen die Schicht: beide Ebenen nimmt sie an.
        expect(nimmtAn(aussen, 5, { kind: "outer", level: 0, band: 0, band_to: 6 })).toBe(true);
        expect(nimmtAn(aussen, 5, { kind: "outer", level: 3, band: 0, band_to: 6 })).toBe(true);
        expect(nimmtAn(aussen, 5, { kind: "inner", level: 3, band: 0, band_to: 6 })).toBe(false);
        const weakWidth = (band: number): number =>
            auswerten("paint_line", "line-width", aussen?.paint?.["line-width"], zoomImBand(band)) as number;
        expect([0, 1, 2, 3, 4, 5, 6, 6].map(weakWidth)).toEqual([1, 1, 1, 1, 1.5, 2, 3, 3]);
        // Auch im schwachen Modus liegt sie innen.
        expect(auswerten("paint_line", "line-offset", aussen?.paint?.["line-offset"], zoomImBand(6))).toBe(1.5);
    });
});

describe("Namen entlang der Außengrenze (Nachtrag WI-0062)", () => {
    const NAMEN = POLITICAL.borderName;
    const mitName = (view: MapView, borders: boolean, territoryData = true): boolean =>
        layerIds(view, { borders }, territoryData).includes(TERRITORY_BORDER_NAME_LAYER_ID);

    it("🔴 nur in Standard und nur mit dem Schalter „Grenzen“ (Legacy: deregraphic; Politisch trägt die Namen in der Fläche)", () => {
        expect(NAMEN.views).toEqual(["standard"]);
        expect(mitName("standard", true)).toBe(true);
        expect(mitName("standard", false)).toBe(false);
        // Landschaften zeigen mit dem Schalter Linien, aber keine Namen an ihnen (Legacy: nur deregraphic).
        expect(mitName("landscapes", true)).toBe(false);
        expect(layerIds("landscapes", { borders: true })).toContain(TERRITORY_OUTER_LAYER_ID);
        // Politisch trägt seine Namen in der Fläche.
        expect(mitName("political", true)).toBe(false);
        expect(layerIds("political")).toContain(TERRITORY_LABEL_LAYER_ID);
        for (const view of ["none", "powerlines"] as const) expect(mitName(view, true), view).toBe(false);
        // Ohne Zeiger der Gebiete gibt es keine Quelle, also keine Namen.
        expect(mitName("standard", true, false)).toBe(false);
    });

    it("🔴 die Tafel entscheidet über die Ansicht, nicht ein Ansichtsname im Code", () => {
        const { composition } = anzeige("standard");
        const mit = effectiveDisplay("standard", composition, { ...displayDefaults("standard"), borders: true });
        expect(mit.borderNames).toBe(true);
        // Dieselbe Zusammenstellung, aber eine Ansicht, die die Tafel nicht nennt: keine Namen.
        const landschaften = effectiveDisplay("landscapes", composition, {
            ...displayDefaults("landscapes"),
            borders: true,
        });
        expect(landschaften.borderNames).toBe(false);
        const aus = effectiveDisplay("standard", composition, { ...displayDefaults("standard"), borders: false });
        expect(aus.borderNames).toBe(false);
    });

    it("🔴 setzt erst ab Legacy-Zoom 4 (Band 4), Versalien, weiß und leicht durchsichtig, ohne Saum - als Filter, nicht als minzoom", () => {
        const layer = findLayer([buildTerritoryBorderNameLayer("Testfont")], TERRITORY_BORDER_NAME_LAYER_ID, "symbol");
        expect(layer).toMatchObject({
            source: TERRITORY_BORDER_SOURCE_ID,
            "source-layer": "territory_border_render",
            layout: {
                "symbol-placement": "line",
                "symbol-spacing": NAMEN.repeatPx,
                "text-field": ["get", "label_name"],
                "text-transform": "uppercase",
                "text-font": ["Testfont"],
            },
        });
        // Mit `minzoom` baute MapLibre in fernen Kacheln der geneigten Ansicht keine Namen.
        expect(layer).not.toHaveProperty("minzoom");
        expect(layer?.paint?.["text-color"]).toBe("rgba(255, 255, 255, 0.75)");
        expect(layer?.paint).not.toHaveProperty("text-halo-width");
        expect(layer?.paint).not.toHaveProperty("text-halo-color");
        // Der Filter nimmt nur die Namenslinien, nie die gezeichneten Grenzen, und erst ab dem Band der Tafel.
        const name = (kind: string) => ({ kind, band: 0, band_to: 6 });
        expect(nimmtAn(layer, NAMEN.fromBand, name("name"))).toBe(true);
        expect(nimmtAn(layer, NAMEN.fromBand, name("outer"))).toBe(false);
        expect(nimmtAn(layer, NAMEN.fromBand, name("inner"))).toBe(false);
        expect(nimmtAn(layer, NAMEN.fromBand - 1, name("name"))).toBe(false);
        expect(nimmtAn(layer, 6, name("name"))).toBe(true);
        // Eine Linie, deren Durchlauf vor dem Band endet, zeichnet dort nicht.
        expect(nimmtAn(layer, 5, { kind: "name", band: 4, band_to: 4 })).toBe(false);
    });

    it("🔴 Schriftgröße 9 / 11 / 16 px, Sperrung 3 px und Abstand 10 / 12 / 20 px auf Legacys Zoom 4 / 5 / 6, darüber konstant", () => {
        const layout = findLayer([buildTerritoryBorderNameLayer("Testfont")], TERRITORY_BORDER_NAME_LAYER_ID, "symbol")
            ?.layout as Record<string, unknown>;
        // Die Schrift gleitet über dem KAMERAZOOM: an der Stufe des Bandes steht ihr Wert.
        const groesseBeiZoom = (zoom: number) =>
            auswerten("layout_symbol", "text-size", layout["text-size"], zoom) as number;
        expect([4, 5, 6, 7, 12].map((band) => groesseBeiZoom(politicalMinZoom(band, LEAD)))).toEqual([
            9, 11, 16, 16, 16,
        ]);
        // Zwischen den Stufen gleitet sie, Legacy springt, weil Leaflet nur ganze Zoomstufen kennt.
        expect(groesseBeiZoom(politicalMinZoom(4, LEAD) + 0.5)).toBeGreaterThan(9);
        expect(groesseBeiZoom(politicalMinZoom(4, LEAD) + 0.5)).toBeLessThan(11);
        // Abstand und Sperrung folgen dem BAND (Zustand): sie werden beim Aufbau der Kachel ausgewertet.
        const versatzAt = (band: number) =>
            auswerten("layout_symbol", "text-offset", layout["text-offset"], 5, band) as number[];
        const sperrungAt = (band: number) =>
            auswerten("layout_symbol", "text-letter-spacing", layout["text-letter-spacing"], 5, band) as number;
        const groesseImBand = (band: number) => groesseBeiZoom(politicalMinZoom(band, LEAD));
        for (const band of [4, 5, 6]) {
            // Die Sperrung ist ein Pixelwert: MapLibre rechnet in Schriftgrößen.
            expect(sperrungAt(band) * groesseImBand(band), `Band ${String(band)}`).toBeCloseTo(
                NAMEN.letterSpacingPx,
                10,
            );
            // Positiv heißt rechts der Laufrichtung: nach innen (die Ableitung richtet die Hülle rechtsläufig aus).
            expect(versatzAt(band)[0]).toBe(0);
            expect(versatzAt(band)[1], `Band ${String(band)}`).toBeGreaterThan(0);
        }
        const abstandPx = (band: number): number => (versatzAt(band)[1] as number) * groesseImBand(band);
        expect([4, 5, 6, 6].map((band) => Math.round(abstandPx(band) * 1000) / 1000)).toEqual([10, 12, 20, 20]);
    });

    it("🔴 liegt am unteren Ende des Symbolstapels und verdrängt keinen Namen: Legacy zeichnet sie unter allen Beschriftungen", () => {
        const { composition, zeige } = anzeige("standard", { borders: true });
        const layers = buildPlaceLayers({ labels: true, composition, display: zeige, territoryData: true });
        const ids = layers.map((layer) => layer.id);
        const symbolIds = ids.filter(
            (id) => PLACE_LABEL_LAYER_IDS.includes(id) || id === "path-label" || id === TERRITORY_BORDER_NAME_LAYER_ID,
        );
        expect(symbolIds[0]).toBe(TERRITORY_BORDER_NAME_LAYER_ID);
        // Über den gezeichneten Grenzen: die Schrift steht nicht unter den Linien.
        expect(ids.indexOf(TERRITORY_BORDER_NAME_LAYER_ID)).toBeGreaterThan(ids.indexOf(TERRITORY_OUTER_LAYER_ID));
        // Ohne Kollision mit anderen Namen: sonst blieben in der dicht beschrifteten Karte null bis zwei Namen je Bild.
        const layer = findLayer(layers, TERRITORY_BORDER_NAME_LAYER_ID, "symbol");
        expect(layer?.layout?.["text-allow-overlap"]).toBe(true);
    });

    it("fehlt, wo die Serie ihre Namen im Bild trägt (labels aus), und die Linien bleiben", () => {
        const { composition, zeige } = anzeige("standard", { borders: true });
        const ohne = buildPlaceLayers({ labels: false, composition, display: zeige, territoryData: true });
        expect(ohne.map((layer) => layer.id)).not.toContain(TERRITORY_BORDER_NAME_LAYER_ID);
        expect(ohne.map((layer) => layer.id)).toContain(TERRITORY_OUTER_LAYER_ID);
    });
});

describe("Was jede Ansicht zeichnet", () => {
    it("🔴 Politisch: Fläche, Grenzen und Namen - keine Wege, keine Ortsnamen, keine Landschaftsnamen", () => {
        const ids = layerIds("political");
        expect(ids).toContain(TERRITORY_FILL_LAYER_ID);
        expect(ids).toContain(TERRITORY_LABEL_LAYER_ID);
        expect(ids).toContain(TERRITORY_OUTER_LAYER_ID);
        expect(ids.some((id) => id.startsWith("path-center-"))).toBe(false);
        expect(ids.filter((id) => id.startsWith("map-label"))).toEqual([]);
        // Die Fläche liegt über dem Untergrund und unter den Grenzen.
        expect(ids.indexOf("basemap")).toBeLessThan(ids.indexOf(TERRITORY_FILL_LAYER_ID));
        expect(ids.indexOf(TERRITORY_FILL_LAYER_ID)).toBeLessThan(ids.indexOf(`${TERRITORY_INNER_LAYER_PREFIX}1`));
        // Die Namen der Gebiete stehen ÜBER den Orts- und Wegnamen im Stapel: MapLibre setzt von oben nach unten.
        expect(ids.indexOf(TERRITORY_LABEL_LAYER_ID)).toBeGreaterThan(ortsnamenImStapel(ids).letzte);
        // Die Flussnamen hängen wie überall an „Labels“, und das ist hier ab Werk aus (Betreiber 2026-11-09).
        expect(ids).not.toContain("path-label");
        expect(layerIds("political", { labels: true })).toContain("path-label");
    });

    it("🔴 die Hauptstädte bleiben, wo die Orte aus sind - und nur sie", () => {
        const { composition, zeige } = anzeige("political");
        expect(zeige.placeClasses).toEqual([]);
        const layers = buildPlaceLayers({ labels: true, composition, display: zeige, territoryData: true });
        const marker = findLayer(layers, "place-marker", "circle");
        expect(marker, "Ortsmarker der Hauptstädte").toBeDefined();
        const ort = (eigenschaften: Record<string, unknown>) => ({
            subtype: "stadt",
            is_hidden: false,
            ...eigenschaften,
        });
        // Das Band der Ansicht steht im Zustand: Band 4 nimmt „0145“, nicht „0123“.
        expect(nimmtAn(marker, 4, ort({ capital_bands: "0145" }), "point")).toBe(true);
        expect(nimmtAn(marker, 4, ort({ capital_bands: "0123" }), "point")).toBe(false);
        expect(nimmtAn(marker, 4, ort({}), "point")).toBe(false);
        // Im obersten Band gilt die 6, im untersten die 0.
        expect(nimmtAn(marker, 6, ort({ capital_bands: "6" }), "point")).toBe(true);
        expect(nimmtAn(marker, 0, ort({ capital_bands: "0" }), "point")).toBe(true);
        // WI-0080: Auch eine verborgene Hauptstadt bekommt ihre Marke - verborgen bleibt nur ihr Name. OPS-068: Für Besucher erst im
        // Band „Verborgene Orte“ (Band 8, MapLibre-Zoom 9), im Editor-Modus (`hiddenPlacesAlways`) auf jeder Stufe.
        const verborgen = ort({ capital_bands: "4", is_hidden: true });
        expect(nimmtAn(marker, 4, verborgen, "point"), "Besucher, fern").toBe(false);
        expect(nimmtAn(marker, 4, verborgen, "point", 9), "Besucher, Band 8").toBe(true);
        const editorMarker = findLayer(
            buildPlaceLayers({
                labels: true,
                composition,
                display: zeige,
                territoryData: true,
                hiddenPlacesAlways: true,
            }),
            "place-marker",
            "circle",
        );
        expect(nimmtAn(editorMarker, 4, verborgen, "point"), "Editor-Modus, fern").toBe(true);
        const label = findLayer(layers, placeLabelLayerId("stadt", "right"), "symbol");
        expect(nimmtAn(label, 4, ort({ capital_bands: "4", is_hidden: true, name: "Verborgen" }), "point", 9)).toBe(
            false,
        );
    });

    it("ohne Zeiger der Gebiete zeichnet keine Ansicht Gebiete, und Politisch zeigt keine Orte", () => {
        const ids = layerIds("political", {}, false);
        expect(ids.filter((id) => id.startsWith("territory-"))).toEqual([]);
        expect(ids).not.toContain("place-marker");
    });

    it("🔴 „Grenzen“ legt dieselben Linien über Standard und Landschaften - ohne Fläche und ohne Namen", () => {
        for (const view of ["standard", "landscapes"] as const) {
            const ohne = layerIds(view, { borders: false });
            expect(
                ohne.filter((id) => id.startsWith("territory-")),
                `${view} ohne Schalter`,
            ).toEqual([]);
            const mit = layerIds(view, { borders: true });
            expect(mit, view).toContain(TERRITORY_OUTER_LAYER_ID);
            expect(mit, view).not.toContain(TERRITORY_FILL_LAYER_ID);
            expect(mit, view).not.toContain(TERRITORY_LABEL_LAYER_ID);
            // Über den Wegen, damit sie nicht unter der Straße verschwinden.
            const letzterWeg = Math.max(...mit.map((id, index) => (id.startsWith("path-center-") ? index : -1)));
            expect(mit.indexOf(TERRITORY_OUTER_LAYER_ID), view).toBeGreaterThan(letzterWeg);
        }
    });

    it("in „Nur Karte“ und den Kraftlinien zeichnet der Schalter nichts", () => {
        for (const view of ["none", "powerlines"] as const) {
            expect(
                layerIds(view, { borders: true }).filter((id) => id.startsWith("territory-")),
                view,
            ).toEqual([]);
        }
    });
});

/** `zeiger: null` heißt ausdrücklich „kein Zeiger“ (ein `undefined` fiele auf die Vorgabe zurück). */
function stilOptionen(
    view: MapView,
    ueberschreibe: Partial<MapDisplay> = {},
    zeiger: TerritoryPointer | null = ZEIGER,
) {
    return {
        tileUrl: "/tiles/vector/place_render/{z}/{x}/{y}",
        landscapeUrl: "/tiles/vector/region_area_render/{z}/{x}/{y}",
        landscapeRunUrl: "/tiles/vector/landscape_label_run_tile/{z}/{x}/{y}",
        mapLabelUrl: "/tiles/vector/map_label_render/{z}/{x}/{y}",
        climateUrl: "/tiles/vector/climate_band_render/{z}/{x}/{y}",
        pathUrl: "/tiles/vector/path_render/{z}/{x}/{y}",
        pathLabelUrl: "/tiles/vector/path_label_run_tile/{z}/{x}/{y}",
        powerlineUrl: "/tiles/vector/powerline_render/{z}/{x}/{y}",
        leyNodeUrl: "/tiles/vector/ley_node_render/{z}/{x}/{y}",
        basemap: undefined,
        seriesId: "original",
        view,
        landscapeSelection: "alle" as const,
        display: { ...displayDefaults(view), ...ueberschreibe },
        territories: zeiger ?? undefined,
    };
}

describe("Der ganze Stil mit Gebieten", () => {
    const optionen = stilOptionen;

    it("🔴 die Kachel-Adresse trägt die Revision aus dem Zeiger (ADR-0008)", () => {
        const style = buildPlaceStyle(optionen("political"));
        expect(style.sources[TERRITORY_SOURCE_ID]).toMatchObject({
            tiles: ["/tiles/vector/territory_tile/{z}/{x}/{y}?rev=abcdef012345"],
        });
        expect(style.sources[TERRITORY_BORDER_SOURCE_ID]).toMatchObject({
            tiles: ["/tiles/vector/territory_border_tile/{z}/{x}/{y}?rev=abcdef012345"],
        });
        const neu = buildPlaceStyle(optionen("political", {}, { ...ZEIGER, revision: "ffffffffffff" }));
        expect((neu.sources[TERRITORY_SOURCE_ID] as { tiles: string[] }).tiles[0]).toContain("?rev=ffffffffffff");
    });

    it("lädt nur die Quellen, die die Ansicht braucht", () => {
        expect(Object.keys(buildPlaceStyle(optionen("standard", { borders: false })).sources)).not.toContain(
            TERRITORY_SOURCE_ID,
        );
        expect(Object.keys(buildPlaceStyle(optionen("standard", { borders: false })).sources)).not.toContain(
            TERRITORY_BORDER_SOURCE_ID,
        );
        const mitGrenzen = Object.keys(buildPlaceStyle(optionen("standard", { borders: true })).sources);
        expect(mitGrenzen).toContain(TERRITORY_BORDER_SOURCE_ID);
        expect(mitGrenzen).not.toContain(TERRITORY_SOURCE_ID);
        const ohneZeiger = Object.keys(buildPlaceStyle(optionen("political", {}, null)).sources);
        expect(ohneZeiger.filter((id) => id.startsWith("territor"))).toEqual([]);
    });

    it("ist ein gültiger Stil, in jeder Ansicht, mit und ohne Grenzen, mit dem globalen Zustand des Bandes", () => {
        for (const view of ["none", "political", "standard", "powerlines", "landscapes"] as const) {
            for (const borders of [false, true]) {
                const style = buildPlaceStyle(optionen(view, { borders }));
                expect(style.state?.[TERRITORY_BAND_STATE], `${view}: Zustand`).toBeDefined();
                const fehler = validateStyleMin(style as never);
                expect(
                    fehler.map((eintrag) => eintrag.message),
                    `${view}, Grenzen ${String(borders)}`,
                ).toEqual([]);
            }
        }
    });

    it("🔴 ein gewähltes Gebiet leuchtet aus der Gebietsquelle, im Band der Ansicht, auch nachdem man die politische Ansicht verlassen hat", () => {
        const auswahl = {
            kind: "territory" as const,
            id: "gebiet-1",
            name: "Baronie Eins",
            type: "Baronie",
            anchor: { x: 500, y: 500 },
            label: "Baronie Eins",
        };
        for (const view of ["political", "standard"] as const) {
            const style = buildPlaceStyle({ ...optionen(view), areaSelection: auswahl });
            expect(style.sources[TERRITORY_SOURCE_ID], view).toBeDefined();
            const fuellung = findLayer(style.layers, "area-selection-fill", "fill");
            expect(fuellung, view).toMatchObject({
                source: TERRITORY_SOURCE_ID,
                "source-layer": "territory_fill_render",
            });
            // Die Kachel trägt alle Bänder eines Gebiets: Es leuchtet, was das Band der Ansicht zeigt.
            const merkmal = (id: string, band: number, bandTo: number) => ({
                territory_public_id: id,
                band,
                band_to: bandTo,
            });
            expect(nimmtAn(fuellung, 4, merkmal("gebiet-1", 3, 6), "polygon"), view).toBe(true);
            expect(nimmtAn(fuellung, 2, merkmal("gebiet-1", 3, 6), "polygon"), view).toBe(false);
            expect(nimmtAn(fuellung, 4, merkmal("gebiet-2", 3, 6), "polygon"), view).toBe(false);
            // 🔴 Der Name des gewählten Gebiets ist KEINE zweite Beschriftung (WI-0121 Nachtrag): keine Ebene des Ersatznamens, und
            // die Quelle des Ersatznamens bleibt leer. Der Name steht in der Ebene der Gebietsnamen und wird dort gelb
            // (`territory-name-select.test.ts`).
            expect(findLayer(style.layers, "area-selection-label", "symbol"), view).toBeUndefined();
            const quelle = style.sources["area-selection-label"] as {
                data: { features: { properties: Record<string, string> }[] };
            };
            expect(quelle.data.features, view).toEqual([]);
        }
        // Ohne Zeiger gibt es die Quelle nicht - und darum auch keine Ebene, die auf sie zeigt.
        const ohne = buildPlaceStyle({ ...optionen("standard", {}, null), areaSelection: auswahl });
        expect(findLayer(ohne.layers, "area-selection-fill", "fill")).toBeUndefined();
        expect(validateStyleMin(ohne as never).map((eintrag) => eintrag.message)).toEqual([]);
    });

    it("🔴 das gewählte Gebiet bleibt unter den Namen der Ansicht und trägt allein dessen Auswahlfarbe: ein Symbol, keine zweite Ebene", () => {
        const auswahl = {
            kind: "territory" as const,
            id: "gebiet-1",
            name: "X",
            type: "",
            anchor: { x: 1, y: 1 },
            label: "X",
        };
        const style = buildPlaceStyle({ ...optionen("political"), areaSelection: auswahl });
        const namen = findLayer(style.layers, TERRITORY_LABEL_LAYER_ID, "symbol");
        const gebiet = (id: string) => ({ territory_public_id: id, band: 0, band_to: 6 });
        expect(nimmtAn(namen, 3, gebiet("gebiet-1"), "symbol")).toBe(true);
        expect(nimmtAn(namen, 3, gebiet("gebiet-2"), "symbol")).toBe(true);
        expect(
            style.layers
                .filter(
                    (layer) => (layer as { source?: string }).source === TERRITORY_SOURCE_ID && layer.type === "symbol",
                )
                .map((layer) => layer.id),
        ).toEqual([TERRITORY_LABEL_LAYER_ID]);
    });
});
