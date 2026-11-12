import { afterEach, describe, expect, it, vi } from "vitest";
import { createPropertyExpression, featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import {
    AVENTURIA_ZOOM_BANDS,
    BAND_COUNT,
    DEFAULT_LANDSCAPE_SELECTION,
    VECTOR_TILE_MAX_ZOOM,
    canonColour,
    composeView,
    renderZoomForBand,
    type MapView,
} from "@avesmaps3d/shared";
import {
    CAPITAL_RING_LAYER_ID,
    HAIRLINE_LAYER_ID,
    PLACE_COLLISION_LAYER_IDS,
    PLACE_LABEL_LAYER_IDS,
    PLACE_MARKER_LAYER_ID,
    PLACE_SELECTION_LAYER_ID,
    STRUCTURE_MARKER_LAYER_ID,
    buildPlaceLayers,
    buildPlaceStyle,
    markerExtent,
} from "../src/map/place-layers.ts";
import { displayDefaults, effectiveDisplay } from "../src/map/map-display.ts";
import { TERRITORY_BAND_STATE } from "../src/map/territory-band.ts";
import {
    FAHNE_TELEFON_GROESSE,
    FAHNE_VERSATZ,
    REISEBILD_FAHNEN_QUELLE,
    REISEBILD_FAHNE_EBENE,
    REISEBILD_FAHNE_HERVOR_EBENE,
    REISEBILD_HERVOR_EBENE,
    REISEBILD_QUELLE,
    REISEBILD_ZEICHEN_EBENE,
    ZEICHEN_BLENDE_MS,
    fahnenDaten,
    fahnenFilter,
    fahnenVersatz,
    mitReisebildern,
    zeichenDaten,
    type ReisebilderDaten,
} from "../src/photobox/reisebilder-ebenen.ts";
import {
    BILD_PIXELVERHAELTNIS,
    bildIdFahne,
    bildIdVorschau,
    bildIdZeichen,
    zeichneFahne,
    zeichneVorschau,
    zeichneZeichen,
} from "../src/photobox/reisebilder-zeichen.ts";
import { propertySpec } from "./style-spec.ts";

/**
 * Zeichen, Fahne und Ebenen der Reisebilder (WI-0272 S4, Aufgabe 26).
 *
 * Problemfälle: ein still abgelehnter Ausdruck (MapLibre schweigt und zeichnet nichts); die Fahne erscheint, wo der Ortsmarker noch nicht steht, oder fehlt, wo er steht; ein Hauptort verliert sie in der
 * politischen Ansicht; die Fahne sitzt auf dem Marker einer Metropole; ein Zeichen liegt über Marker oder Namen; ein Ebenenname beginnt mit `place-marker-` und gerät unter die Prüfhaken; die Zahl ab 100
 * steht dreistellig im Zeichen. Soll: jeder Ausdruck übersetzt, der Filter der Fahne gleich dem des Markers, die Fahne außerhalb jeder Marke, Marker und Namen oben.
 */

const OPTIONEN = {
    tileUrl: "/v/place/{z}/{x}/{y}",
    landscapeUrl: "/v/landscape/{z}/{x}/{y}",
    landscapeRunUrl: "/v/run/{z}/{x}/{y}",
    mapLabelUrl: "/v/label/{z}/{x}/{y}",
    climateUrl: "/v/climate/{z}/{x}/{y}",
    pathUrl: "/v/path/{z}/{x}/{y}",
    pathLabelUrl: "/v/path-label/{z}/{x}/{y}",
    powerlineUrl: "/v/powerline/{z}/{x}/{y}",
    leyNodeUrl: "/v/ley-node/{z}/{x}/{y}",
    basemap: undefined,
    seriesId: "original",
    view: "standard" as MapView,
    landscapeSelection: DEFAULT_LANDSCAPE_SELECTION,
} as const;

const basis = (zusatz: Record<string, unknown> = {}): StyleSpecification =>
    buildPlaceStyle({ ...OPTIONEN, ...zusatz } as Parameters<typeof buildPlaceStyle>[0]);

const UUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const DATEN: ReisebilderDaten = {
    zeichen: zeichenDaten([
        { schluessel: UUID(1), bild: bildIdZeichen(2, false), lng: 1, lat: 1 },
        { schluessel: UUID(3), bild: bildIdZeichen(1, true), lng: 2, lat: 2 },
    ]),
    fahnen: fahnenDaten([
        {
            schluessel: UUID(5),
            bild: bildIdFahne(3),
            lng: 3,
            lat: 3,
            ortId: UUID(90),
            subtype: "metropole",
            capitalBands: "0145",
        },
    ]),
};

const mit = (stil: StyleSpecification = basis(), telefon = false) => mitReisebildern(stil, DATEN, { telefon });
const eigene = (stil: StyleSpecification): LayerSpecification[] =>
    stil.layers.filter((layer) => layer.id.startsWith("photobox-"));

describe("Quellen und Daten", () => {
    it("🔴 beide Quellen sind GeoJSON mit promoteId und der Obergrenze der Ortskacheln", () => {
        const stil = mit();
        for (const id of [REISEBILD_QUELLE, REISEBILD_FAHNEN_QUELLE]) {
            expect(stil.sources[id], id).toMatchObject({
                type: "geojson",
                promoteId: "schluessel",
                maxzoom: VECTOR_TILE_MAX_ZOOM,
            });
        }
        expect(VECTOR_TILE_MAX_ZOOM).toBe(8);
    });

    it("`zeichenDaten`: je Gruppe ein Punkt mit schluessel und bild", () => {
        expect(DATEN.zeichen.features).toHaveLength(2);
        expect(DATEN.zeichen.features[0]).toEqual({
            type: "Feature",
            properties: { schluessel: UUID(1), bild: "photobox-zeichen-2" },
            geometry: { type: "Point", coordinates: [1, 1] },
        });
    });

    it("🔴 `fahnenDaten`: genau die Eigenschaften der Ortskachel, nie ein verborgener Ort", () => {
        expect(DATEN.fahnen.features[0]?.properties).toEqual({
            schluessel: UUID(5),
            bild: "photobox-fahne-3",
            public_id: UUID(90),
            subtype: "metropole",
            is_hidden: false,
            capital_bands: "0145",
        });
        const ohneBand = fahnenDaten([{ schluessel: "a", bild: "b", lng: 0, lat: 0, ortId: "o", subtype: "dorf" }]);
        expect(ohneBand.features[0]?.properties).not.toHaveProperty("capital_bands");
    });

    it("jeder Aufruf baut frische Daten (nie dieselben Objekte)", () => {
        const eintrag = { schluessel: "a", bild: "b", lng: 0, lat: 0 };
        expect(zeichenDaten([eintrag])).not.toBe(zeichenDaten([eintrag]));
        expect(zeichenDaten([eintrag]).features[0]).not.toBe(zeichenDaten([eintrag]).features[0]);
    });
});

describe("🔴 jeder Ausdruck übersetzt, der Stil ist gültig", () => {
    it("der ganze Stil besteht `validateStyleMin`", () => {
        expect(validateStyleMin(mit())).toEqual([]);
        expect(validateStyleMin(mit(basis(), true))).toEqual([]);
    });

    it("jede Eigenschaft der eigenen Ebenen übersetzt mit `createPropertyExpression`, jeder Filter mit `featureFilter`", () => {
        const gruppen: Record<string, string> = {
            layout: "layout",
            paint: "paint",
        };
        const stil = mit();
        expect(eigene(stil)).toHaveLength(4);
        for (const layer of eigene(stil)) {
            for (const art of Object.keys(gruppen)) {
                const werte = (layer as unknown as Record<string, Record<string, unknown> | undefined>)[art] ?? {};
                for (const [name, wert] of Object.entries(werte)) {
                    if (name.endsWith("-transition")) continue;
                    const kompiliert = createPropertyExpression(
                        wert as never,
                        name,
                        propertySpec(`${art}_${layer.type}`, name),
                        { [TERRITORY_BAND_STATE]: 4 },
                    );
                    expect(kompiliert.result, `${layer.id} ${name}`).toBe("success");
                }
            }
            const filter = (layer as { filter?: unknown }).filter;
            if (filter !== undefined) {
                expect(() =>
                    featureFilter(filter as never, `${layer.id}.filter`, { [TERRITORY_BAND_STATE]: 4 }),
                ).not.toThrow();
            }
        }
    });

    it("das Zeichen blendet über (280 ms), liegt im Fenster ohne Platzbedarf und ist nach dem Bild gewählt", () => {
        const zeichen = eigene(mit()).find((layer) => layer.id === REISEBILD_ZEICHEN_EBENE);
        if (zeichen?.type !== "symbol") throw new Error("Zeichen fehlt");
        expect(zeichen.paint?.["icon-opacity-transition"]).toEqual({ duration: ZEICHEN_BLENDE_MS });
        expect(ZEICHEN_BLENDE_MS).toBe(280);
        expect(zeichen.layout).toMatchObject({
            "icon-image": ["get", "bild"],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-pitch-alignment": "viewport",
            "icon-rotation-alignment": "viewport",
        });
    });

    it("der Ring des Zeichens liest `hervor` und `puls` aus dem Zustand des Merkmals, in Gelb der Auswahl", () => {
        const ring = eigene(mit()).find((layer) => layer.id === REISEBILD_HERVOR_EBENE);
        if (ring?.type !== "circle") throw new Error("Ring fehlt");
        expect(ring.paint?.["circle-stroke-color"]).toBe(canonColour("mapSelection"));
        const kompiliert = createPropertyExpression(
            ring.paint?.["circle-stroke-opacity"] as never,
            "circle-stroke-opacity",
            propertySpec("paint_circle", "circle-stroke-opacity"),
        );
        if (kompiliert.result !== "success") throw new Error("circle-stroke-opacity ungültig");
        const merkmal = { type: "Point", properties: {} } as never;
        const deckkraft = (zustand: Record<string, unknown>): unknown =>
            kompiliert.value.evaluate({ zoom: 5 }, merkmal, zustand as never);
        expect(deckkraft({})).toBe(0);
        expect(deckkraft({ hervor: true })).toBe(1);
        expect(deckkraft({ puls: true })).toBe(1);
        expect(deckkraft({ hervor: false })).toBe(0);
    });

    it('`["zoom"]` steht nur im kopierten Filter der Fahne, nirgends sonst in den eigenen Ebenen', () => {
        for (const layer of eigene(mit())) {
            const text = JSON.stringify({ ...layer, filter: undefined });
            const layout = JSON.stringify((layer as { layout?: unknown }).layout);
            // Zoom steht nur im Versatz der Fahne (ein Layoutwert je Kachel) und im Radius ihres Rings (Zoom statt Filter), nicht im Zeichen.
            if (layer.id === REISEBILD_ZEICHEN_EBENE || layer.id === REISEBILD_HERVOR_EBENE) {
                expect(text, layer.id).not.toContain('"zoom"');
            }
            expect(layout ?? "").not.toContain("feature-state");
        }
    });
});

describe("Lage der Ebenen im Stapel", () => {
    const ids = (stil: StyleSpecification): string[] => stil.layers.map((layer) => layer.id);

    it("🔴 das Zeichen und sein Ring liegen UNTER Haarlinie, Goldring und Auswahlkreis: alle Marker und Namen darüber", () => {
        const folge = ids(mit());
        const erster = Math.min(
            ...[PLACE_SELECTION_LAYER_ID, CAPITAL_RING_LAYER_ID, HAIRLINE_LAYER_ID]
                .map((id) => folge.indexOf(id))
                .filter((i) => i >= 0),
        );
        expect(folge.indexOf(HAIRLINE_LAYER_ID)).toBeGreaterThan(-1);
        for (const id of [REISEBILD_HERVOR_EBENE, REISEBILD_ZEICHEN_EBENE]) {
            expect(folge.indexOf(id), id).toBeGreaterThan(-1);
            expect(folge.indexOf(id), id).toBeLessThan(erster);
        }
        // Alle Namen liegen über dem Zeichen.
        for (const name of PLACE_LABEL_LAYER_IDS.filter((id) => folge.includes(id))) {
            expect(folge.indexOf(name), name).toBeGreaterThan(folge.indexOf(REISEBILD_ZEICHEN_EBENE));
        }
    });

    it("mit einem gewählten Ort (Auswahlkreis im Stil) liegt das Zeichen weiter unter ihm", () => {
        const folge = ids(mit(basis({ activePlaceId: UUID(7) })));
        expect(folge.indexOf(PLACE_SELECTION_LAYER_ID)).toBeGreaterThan(-1);
        expect(folge.indexOf(REISEBILD_ZEICHEN_EBENE)).toBeLessThan(folge.indexOf(PLACE_SELECTION_LAYER_ID));
    });

    it("🔴 die Fahne liegt über allen Markern und unter der ersten Sperrfläche, also unter allen Namen", () => {
        const folge = ids(mit());
        const ersteSperre = Math.min(...PLACE_COLLISION_LAYER_IDS.map((id) => folge.indexOf(id)).filter((i) => i >= 0));
        const letzterMarker = Math.max(...folge.flatMap((id, index) => (id.startsWith("place-marker") ? [index] : [])));
        for (const id of [REISEBILD_FAHNE_HERVOR_EBENE, REISEBILD_FAHNE_EBENE]) {
            expect(folge.indexOf(id), id).toBeGreaterThan(letzterMarker);
            expect(folge.indexOf(id), id).toBeLessThan(ersteSperre);
        }
        expect(folge.indexOf(REISEBILD_FAHNE_HERVOR_EBENE)).toBeLessThan(folge.indexOf(REISEBILD_FAHNE_EBENE));
    });

    it("ohne Ortsmarker im Stil gibt es keine Fahnenebenen und keine Fahnenquelle, das Zeichen bleibt", () => {
        const ohneMarker: StyleSpecification = {
            ...basis(),
            layers: basis().layers.filter((layer) => !layer.id.startsWith("place-marker")),
        };
        const stil = mit(ohneMarker);
        const folge = ids(stil);
        expect(folge).not.toContain(REISEBILD_FAHNE_EBENE);
        expect(folge).not.toContain(REISEBILD_FAHNE_HERVOR_EBENE);
        expect(stil.sources[REISEBILD_FAHNEN_QUELLE]).toBeUndefined();
        expect(folge).toContain(REISEBILD_ZEICHEN_EBENE);
        expect(stil.sources[REISEBILD_QUELLE]).toBeDefined();
        expect(validateStyleMin(stil)).toEqual([]);
    });

    it("🔴 kein Ebenenname beginnt mit `place-marker-` (dahinter hängen sich die Prüfhaken)", () => {
        for (const layer of eigene(mit())) expect(layer.id.startsWith("place-marker-"), layer.id).toBe(false);
        expect(eigene(mit()).map((layer) => layer.id)).toEqual([
            REISEBILD_HERVOR_EBENE,
            REISEBILD_ZEICHEN_EBENE,
            REISEBILD_FAHNE_HERVOR_EBENE,
            REISEBILD_FAHNE_EBENE,
        ]);
    });

    it("der Ausgangsstil bleibt unverändert (ein neuer Stil)", () => {
        const vorher = basis();
        const ebenenVorher = vorher.layers.length;
        mitReisebildern(vorher, DATEN, { telefon: false });
        expect(vorher.layers).toHaveLength(ebenenVorher);
        expect(vorher.sources[REISEBILD_QUELLE]).toBeUndefined();
    });

    it("am Telefon ist die Fahne 1,25-mal so groß, am Rechner nicht", () => {
        const fahne = (telefon: boolean) => {
            const layer = mit(basis(), telefon).layers.find((l) => l.id === REISEBILD_FAHNE_EBENE);
            if (layer?.type !== "symbol") throw new Error("Fahne fehlt");
            return layer;
        };
        expect(fahne(true).layout?.["icon-size"]).toBe(FAHNE_TELEFON_GROESSE);
        expect(FAHNE_TELEFON_GROESSE).toBe(1.25);
        expect(fahne(false).layout?.["icon-size"]).toBeUndefined();
        expect(fahne(false).layout).toMatchObject({
            "icon-anchor": "bottom-right",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        });
    });
});

describe("🔴 die Fahne gilt genau, wenn der Ortsmarker gilt", () => {
    const KLASSEN = Object.keys(AVENTURIA_ZOOM_BANDS.marker);

    /** Zeigt die Karte den Marker dieses Orts bei dieser Kachelstufe und diesem Band der Ansicht? So wertet MapLibre beim Aufbau der Kachel aus. */
    function markerZeigt(
        layers: readonly LayerSpecification[],
        zoom: number,
        ort: Record<string, unknown>,
        band: number,
    ) {
        const zustand = { [TERRITORY_BAND_STATE]: band };
        const kreis = layers.find((l) => l.id === PLACE_MARKER_LAYER_ID);
        const raute = layers.find((l) => l.id === STRUCTURE_MARKER_LAYER_ID);
        if (kreis?.type !== "circle" || raute?.type !== "symbol") throw new Error("Marker fehlen");
        const merkmal = { type: 1, properties: ort } as never;
        const alsKreis = featureFilter(kreis.filter as never, "kreis", zustand).filter(
            { zoom },
            merkmal,
            undefined as never,
        );
        const alsRaute =
            zoom >= (raute.minzoom ?? 0) &&
            featureFilter(raute.filter as never, "raute", zustand).filter({ zoom }, merkmal, undefined as never);
        return alsKreis || alsRaute;
    }

    function fahneZeigt(
        layers: readonly LayerSpecification[],
        zoom: number,
        ort: Record<string, unknown>,
        band: number,
    ) {
        const filter = fahnenFilter(layers);
        if (filter === undefined) throw new Error("Fahnenfilter fehlt");
        return featureFilter(filter, "fahne", { [TERRITORY_BAND_STATE]: band }).filter(
            { zoom },
            { type: 1, properties: ort } as never,
            undefined as never,
        );
    }

    it("Standardansicht: für jede Klasse und jede ganzzahlige Kachelstufe gleich dem Marker (auch Bauwerke mit Raute)", () => {
        const layers = basis().layers;
        let gezeigt = 0;
        let verborgen = 0;
        for (const klasse of KLASSEN) {
            for (let zoom = 0; zoom <= VECTOR_TILE_MAX_ZOOM + 1; zoom += 1) {
                const ort = { subtype: klasse, is_hidden: false, public_id: UUID(1) };
                const soll = markerZeigt(layers, zoom, ort, 4);
                expect(fahneZeigt(layers, zoom, ort, 4), `${klasse} bei ${String(zoom)}`).toBe(soll);
                if (soll) gezeigt += 1;
                else verborgen += 1;
            }
        }
        // Die Probe hat beide Seiten gesehen: Es gibt Stufen mit und ohne Marker.
        expect(gezeigt).toBeGreaterThan(0);
        expect(verborgen).toBeGreaterThan(0);
    });

    it("Politisch: auch ein Hauptort über `capital_bands` gilt genau mit seinem Marker", () => {
        const composition = composeView("political", "alle");
        const zeige = effectiveDisplay("political", composition, displayDefaults("political"));
        const layers = buildPlaceLayers({ labels: true, composition, display: zeige, territoryData: true });
        let ja = 0;
        let nein = 0;
        for (const klasse of KLASSEN) {
            for (const bands of ["0145", "0123", "6", ""]) {
                for (const band of [0, 4, 6]) {
                    for (let zoom = 0; zoom <= VECTOR_TILE_MAX_ZOOM; zoom += 1) {
                        const ort = {
                            subtype: klasse,
                            is_hidden: false,
                            public_id: UUID(1),
                            ...(bands === "" ? {} : { capital_bands: bands }),
                        };
                        const soll = markerZeigt(layers, zoom, ort, band);
                        expect(
                            fahneZeigt(layers, zoom, ort, band),
                            `${klasse} ${bands} Band ${String(band)} z${String(zoom)}`,
                        ).toBe(soll);
                        if (soll) ja += 1;
                        else nein += 1;
                    }
                }
            }
        }
        expect(ja).toBeGreaterThan(0);
        expect(nein).toBeGreaterThan(0);
    });

    it("der Filter ist ohne Marker `undefined`, ohne Raute der des Kreises", () => {
        expect(fahnenFilter([])).toBeUndefined();
        const layers = basis().layers;
        const nurKreis = layers.filter((l) => l.id !== STRUCTURE_MARKER_LAYER_ID);
        const kreis = layers.find((l) => l.id === PLACE_MARKER_LAYER_ID) as { filter: unknown };
        expect(fahnenFilter(nurKreis)).toEqual(kreis.filter);
    });
});

describe("🔴 die Fahne verdeckt keinen Marker", () => {
    const KONTUR = (AVENTURIA_ZOOM_BANDS.spacing["kontur"] ?? 0) / 100;

    /** Der Versatz, den die Ebene für diese Klasse bei dieser Kachelstufe auswertet (Layout wird je Kachel gerechnet, `zoom` ist ganzzahlig). */
    function versatzDerEbene(klasse: string, zoom: number): [number, number] {
        const fahne = mit().layers.find((l) => l.id === REISEBILD_FAHNE_EBENE);
        if (fahne?.type !== "symbol") throw new Error("Fahne fehlt");
        const kompiliert = createPropertyExpression(
            fahne.layout?.["icon-offset"] as never,
            "icon-offset",
            propertySpec("layout_symbol", "icon-offset"),
        );
        if (kompiliert.result !== "success") throw new Error("icon-offset ungültig");
        return kompiliert.value.evaluate({ zoom }, { type: "Point", properties: { subtype: klasse } } as never) as [
            number,
            number,
        ];
    }

    it("für jede Klasse und jedes Band reicht der Versatz (mal √2) über die Marke hinaus, die der Marker bis zur nächsten Kachelstufe erreicht", () => {
        let geprueft = 0;
        let groessterMarker = 0;
        for (const [klasse, reihe] of Object.entries(AVENTURIA_ZOOM_BANDS.marker)) {
            for (let band = 0; band < BAND_COUNT; band += 1) {
                const heute = reihe[band];
                if (typeof heute !== "number") continue;
                const naechste = reihe[Math.min(band + 1, BAND_COUNT - 1)];
                const bis = Math.max(
                    markerExtent(klasse, band, heute, KONTUR),
                    typeof naechste === "number" ? markerExtent(klasse, band + 1, naechste, KONTUR) : 0,
                );
                groessterMarker = Math.max(groessterMarker, bis);
                const [x, y] = versatzDerEbene(klasse, renderZoomForBand(band));
                // Die Fahne sitzt links oberhalb: Beide Anteile negativ, gleich groß, nie kleiner als der Mindestversatz.
                expect(x, `${klasse} ${String(band)}`).toBe(y);
                expect(-x, `${klasse} ${String(band)}`).toBeGreaterThanOrEqual(FAHNE_VERSATZ);
                expect(-x * Math.SQRT2, `${klasse} Band ${String(band)}`).toBeGreaterThanOrEqual(bis);
                expect(-x, `${klasse} Band ${String(band)}`).toBe(fahnenVersatz(klasse, band));
                geprueft += 1;
            }
        }
        expect(geprueft).toBeGreaterThan(30);
        // Die Probe hat die großen Marken gesehen: Der feste Versatz 7 reicht für eine Metropole auf hoher Stufe bei Weitem nicht.
        expect(groessterMarker).toBeGreaterThan(FAHNE_VERSATZ * Math.SQRT2 * 2);
    });

    it("kleine Marken bekommen den kleinsten Versatz, nicht weniger", () => {
        expect(fahnenVersatz("dorf", 2)).toBe(FAHNE_VERSATZ);
        expect(FAHNE_VERSATZ).toBe(7);
        expect(fahnenVersatz("metropole", 6)).toBeGreaterThan(FAHNE_VERSATZ);
    });

    it("eine unbekannte Klasse bekommt den kleinsten Versatz", () => {
        expect(versatzDerEbene("unbekannt", 5)).toEqual([-FAHNE_VERSATZ, -FAHNE_VERSATZ]);
    });
});

describe("Zeichnen (Leinwand-Attrappe)", () => {
    interface Aufzeichnung {
        readonly leinwaende: { width: number; height: number }[];
        readonly texte: string[];
        readonly bilder: unknown[][];
        readonly pfade: string[];
    }

    function attrappe(): Aufzeichnung {
        const a: Aufzeichnung = { leinwaende: [], texte: [], bilder: [], pfade: [] };
        vi.stubGlobal(
            "Path2D",
            class {
                constructor(d?: string) {
                    if (d !== undefined) a.pfade.push(d);
                }
            },
        );
        vi.stubGlobal("document", {
            createElement: () => {
                const flaeche = {
                    width: 0,
                    height: 0,
                    getContext: () =>
                        new Proxy(
                            {},
                            {
                                get: (_ziel, name) => {
                                    if (name === "measureText") return (t: string) => ({ width: t.length * 6 });
                                    if (name === "getImageData")
                                        return (_x: number, _y: number, b: number, h: number) => ({
                                            width: b,
                                            height: h,
                                            data: new Uint8ClampedArray(0),
                                        });
                                    if (name === "fillText") return (t: string) => a.texte.push(t);
                                    if (name === "drawImage") return (...args: unknown[]) => a.bilder.push(args);
                                    return () => undefined;
                                },
                                set: () => true,
                            },
                        ),
                };
                a.leinwaende.push(flaeche);
                return flaeche;
            },
        });
        return a;
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("das Zeichen ist quadratisch, im Pixelverhältnis 2, die Scheibe in der Mitte", () => {
        attrappe();
        expect(BILD_PIXELVERHAELTNIS).toBe(2);
        const bild = zeichneZeichen(1, false);
        // 30 px Scheibe und je 12 px Rand für Schatten und Zahlmarke, mal 2.
        expect(bild).toMatchObject({ width: 108, height: 108 });
        expect(zeichneZeichen(5, true)).toMatchObject({ width: 108, height: 108 });
        expect(zeichneZeichen(1, false, 1)).toMatchObject({ width: 54, height: 54 });
    });

    it("🔴 die Zahlmarke steht ab zwei Bildern, ab 100 als „99+“; ein Bild trägt keine Zahl", () => {
        const a = attrappe();
        zeichneZeichen(1, false);
        expect(a.texte).toEqual([]);
        zeichneZeichen(2, false);
        zeichneZeichen(99, false);
        zeichneZeichen(100, false);
        zeichneZeichen(1234, false);
        expect(a.texte).toEqual(["2", "99", "99+", "99+"]);
    });

    it("bei einem KI-Bild trägt das Zeichen das Linienzeichen `roboter` und keine Schrift", () => {
        const a = attrappe();
        zeichneZeichen(1, false);
        // Ohne KI nur der Pfad des Bildzeichens.
        expect(a.pfade).toEqual(["M2.6 14.8 7.4 9.6l3.2 3.3 2.2-2.2 4.6 4.3"]);
        a.pfade.length = 0;
        zeichneZeichen(1, true);
        expect(a.texte).toEqual([]);
        // Der Roboter steht im Zeichenvorrat des Hauses (Antenne, Kopf, Ohren und Augen), zusätzlich zum Pfad des Bildzeichens.
        expect(a.pfade.filter((d) => d === "M12 8V4H8")).toHaveLength(1);
        expect(a.pfade.filter((d) => d === "M2 14h2M20 14h2M15 13v2M9 13v2")).toHaveLength(1);
    });

    it("die Fahne: 22 px hoch (mit Haarlinie 24), die Breite folgt der Zahl, ab 100 „99+“", () => {
        const a = attrappe();
        const eins = zeichneFahne(1);
        const viele = zeichneFahne(150);
        expect(eins.height).toBe(48);
        expect(viele.height).toBe(48);
        expect(viele.width).toBeGreaterThan(eins.width);
        expect(a.texte).toEqual(["1", "99+"]);
        // Die Zahl steht auch bei einem Bild.
        expect(eins.width).toBe(2 * (Math.ceil(1.5 + 5 + 13 + 3 + 6 + 6 + 1.5) + 2));
    });

    it("der Abzug: 40 px frei und mittig, 30 px als Fahne unten rechts bündig", () => {
        const a = attrappe();
        const bitmap = { width: 480, height: 320 } as unknown as ImageBitmap;
        const frei = zeichneVorschau(bitmap, { kante: 40, zahl: 1, ki: false });
        expect(frei).toMatchObject({ width: 2 * (18 + 40 + 18), height: 2 * (18 + 40 + 18) });
        const fahne = zeichneVorschau(bitmap, { kante: 30, zahl: 3, ki: false });
        expect(fahne).toMatchObject({ width: 2 * (18 + 30 + 1), height: 2 * (18 + 30 + 1) });
        // Das Bild füllt das Quadrat, zugeschnitten auf die Mitte (320 x 320 aus 480 x 320).
        expect(a.bilder[0]?.slice(1, 5)).toEqual([80, 0, 320, 320]);
        expect(a.texte).toEqual(["3"]);
    });

    it("die Kennungen tragen `photobox-` und gleichen Zahlen ab 100", () => {
        for (const id of [
            bildIdZeichen(2, false),
            bildIdZeichen(2, true),
            bildIdFahne(2),
            bildIdVorschau("abc", 40, 2, true),
        ]) {
            expect(id.startsWith("photobox-"), id).toBe(true);
        }
        expect(bildIdZeichen(100, false)).toBe(bildIdZeichen(5000, false));
        expect(bildIdZeichen(100, false)).toBe("photobox-zeichen-99+");
        expect(bildIdZeichen(1, true)).not.toBe(bildIdZeichen(1, false));
        expect(bildIdFahne(7)).toBe("photobox-fahne-7");
        expect(bildIdVorschau("abc", 40, 1, false)).not.toBe(bildIdVorschau("abc", 30, 1, false));
        // Die Ebene unterscheidet den Abzug am Namen (Ring größer).
        expect(bildIdVorschau("abc", 30, 1, false).startsWith("photobox-vorschau")).toBe(true);
    });
});
