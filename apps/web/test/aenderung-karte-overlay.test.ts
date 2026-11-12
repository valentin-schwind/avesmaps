import { describe, expect, it } from "vitest";
import { featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { AVENTURIA, DESIGN_CANON, canonColour, fromRenderLngLat, toRenderLngLat } from "@avesmaps3d/shared";
import { kartenBild, type KartenGegenstand } from "../src/aenderungen/aenderung-karte-modell";
import { bildAusLage } from "../src/aenderungen/aenderung-lage-modell";
import {
    OVERLAY_EBENEN,
    OVERLAY_EBENEN_LISTE,
    OVERLAY_QUELLE,
    ebenenSichtbar,
    overlayDaten,
    overlayEbenen,
    overlayGrenzen,
    renderPunkt,
} from "../src/map/aenderungen-overlay-formen";

/**
 * Vorher und Nachher als Ebenen der Karte (WI-0265 B5b): die Umrechnung mit der EINEN Projektion des Hauses, die Merkmale je Teil des Bildes, die Ebenen
 * (Vorher gestrichelt und blassrot, Nachher durchgezogen und hellgelb, beides mit Saum, nichts anklickbar) und welche Anzeige welche Ebenen zeigt.
 * Ohne Karte und ohne Browser; die Lage auf der echten Karte prüft die Sichtprüfung.
 */

const TEXTE = { vorher: "− Vorher", nachher: "+ Nachher" };
const weg: KartenGegenstand = {
    kind: "path",
    zeilen: [
        {
            feld: "geometry",
            vorher: [
                [100, 200],
                [140, 230],
            ],
            nachher: [
                [100, 200],
                [150, 240],
            ],
            hatVorher: true,
            formFehlt: false,
            omitted: false,
        },
    ],
};
const carried: KartenGegenstand = {
    kind: "path",
    zeilen: [
        {
            feld: "geometry",
            vorher: [{ index: 3, x: 300, y: 310 }],
            nachher: [{ index: 3, x: 302, y: 312 }],
            hatVorher: true,
            formFehlt: true,
            omitted: false,
        },
    ],
};

describe("die Projektion", () => {
    it("🔴 rechnet mit `toRenderLngLat` des Hauses, nie mit einer eigenen Formel", () => {
        const erwartet = toRenderLngLat(AVENTURIA.coordinateSpace, { x: 100, y: 200 });
        expect(renderPunkt([100, 200])).toEqual([erwartet.lng, erwartet.lat]);
    });

    it("ist umkehrbar auf die Kartenkoordinate (der Weg des Protokolls und der Weg der Karte treffen sich)", () => {
        const [lng, lat] = renderPunkt([1234.5, 678.25]);
        const zurueck = fromRenderLngLat(AVENTURIA.coordinateSpace, { lng, lat });
        expect(zurueck.x).toBeCloseTo(1234.5, 6);
        expect(zurueck.y).toBeCloseTo(678.25, 6);
    });
});

describe("die Merkmale", () => {
    it("eine Linie vorher, eine nachher und je ein Zeichen; die Lage in Renderkoordinaten", () => {
        const daten = overlayDaten(kartenBild([weg]), TEXTE);
        const eigenschaften = daten.features.map((merkmal) => merkmal.properties.t);
        expect(eigenschaften).toEqual(["vorher", "nachher", "zeichen-vorher", "zeichen-nachher"]);
        const vorher = daten.features[0]!;
        expect(vorher.geometry).toEqual({
            type: "LineString",
            coordinates: [renderPunkt([100, 200]), renderPunkt([140, 230])],
        });
        const zeichen = daten.features.filter((merkmal) => merkmal.properties.z !== undefined);
        expect(zeichen.map((merkmal) => merkmal.properties.z)).toEqual(["− Vorher", "+ Nachher"]);
    });

    it("bewegte Stützpunkte: Punkte, die Verbindung als eigene dünne Linie, zwei Zeichen", () => {
        const daten = overlayDaten(kartenBild([carried]), TEXTE);
        expect(daten.features.map((merkmal) => merkmal.properties.t)).toEqual([
            "vorher",
            "nachher",
            "weg",
            "zeichen-vorher",
            "zeichen-nachher",
        ]);
        expect(daten.features[0]!.geometry.type).toBe("Point");
        expect(daten.features[2]!.geometry).toEqual({
            type: "LineString",
            coordinates: [renderPunkt([300, 310]), renderPunkt([302, 312])],
        });
    });

    it("fehlt das Vorher, gibt es kein Merkmal und kein Zeichen dafür", () => {
        const ohne: KartenGegenstand = {
            kind: "path",
            zeilen: [{ ...weg.zeilen[0]!, vorher: undefined, hatVorher: false, formFehlt: true }],
        };
        const daten = overlayDaten(kartenBild([ohne]), TEXTE);
        expect(daten.features.map((merkmal) => merkmal.properties.t)).toEqual(["nachher", "zeichen-nachher"]);
    });

    it("ein Bild ohne Teile gibt eine leere Sammlung", () => {
        expect(overlayDaten(kartenBild([]), TEXTE).features).toEqual([]);
        expect(overlayGrenzen(kartenBild([]))).toBeUndefined();
    });
});

describe("der Ausschnitt für die Kamera", () => {
    it("Südwest und Nordost in Renderkoordinaten um alles Belegte, vorher und nachher", () => {
        const grenzen = overlayGrenzen(kartenBild([weg]))!;
        const sw = renderPunkt([100, 200]);
        const ne = renderPunkt([150, 240]);
        expect(grenzen[0][0]).toBeCloseTo(sw[0], 9);
        expect(grenzen[0][1]).toBeCloseTo(sw[1], 9);
        expect(grenzen[1][0]).toBeCloseTo(ne[0], 9);
        expect(grenzen[1][1]).toBeCloseTo(ne[1], 9);
        expect(grenzen[0][0]).toBeLessThanOrEqual(grenzen[1][0]);
        expect(grenzen[0][1]).toBeLessThanOrEqual(grenzen[1][1]);
    });
});

describe("die Ebenen", () => {
    const ebenen = overlayEbenen();
    const nach = (id: string) => ebenen.find((ebene) => ebene.id === id)!;

    it("sind ein gültiger Stil, jede Id steht einmal da und gehört zur Liste", () => {
        const stil = {
            version: 8 as const,
            sources: {
                [OVERLAY_QUELLE]: {
                    type: "geojson" as const,
                    data: { type: "FeatureCollection" as const, features: [] },
                },
            },
            layers: ebenen,
        };
        expect(validateStyleMin(stil)).toEqual([]);
        expect(new Set(ebenen.map((ebene) => ebene.id)).size).toBe(ebenen.length);
        expect(ebenen.map((ebene) => ebene.id).sort()).toEqual([...OVERLAY_EBENEN_LISTE].sort());
    });

    it("lesen nur die eigene Quelle: keine Kacheln, nichts anklickbar", () => {
        for (const ebene of ebenen) expect("source" in ebene && ebene.source).toBe(OVERLAY_QUELLE);
    });

    it("🔴 Vorher ist GESTRICHELT und blassrot, Nachher DURCHGEZOGEN und hellgelb (Farbe ist nie das einzige Signal)", () => {
        const vorher = nach(OVERLAY_EBENEN.vorherLinie);
        const nachher = nach(OVERLAY_EBENEN.nachherLinie);
        expect(vorher.type === "line" && vorher.paint?.["line-dasharray"]).toEqual([...DESIGN_CANON.measure.lineDash]);
        expect(vorher.type === "line" && vorher.paint?.["line-color"]).toBe(canonColour("mapChangeBeforeLine"));
        expect(nachher.type === "line" && nachher.paint?.["line-dasharray"]).toBeUndefined();
        expect(nachher.type === "line" && nachher.paint?.["line-color"]).toBe(canonColour("mapChangeAfterLine"));
    });

    it("jede Seite hat einen Saum UNTER ihrer Linie, alle Säume unter allen Linien, die Zeichen zuoberst", () => {
        const ids = ebenen.map((ebene) => ebene.id);
        const lage = (id: string) => ids.indexOf(id);
        expect(lage(OVERLAY_EBENEN.vorherSaum)).toBeLessThan(lage(OVERLAY_EBENEN.vorherLinie));
        expect(lage(OVERLAY_EBENEN.nachherSaum)).toBeLessThan(lage(OVERLAY_EBENEN.vorherLinie));
        expect(lage(OVERLAY_EBENEN.nachherLinie)).toBeLessThan(lage(OVERLAY_EBENEN.vorherPunkt));
        expect(lage(OVERLAY_EBENEN.zeichenVorher)).toBeGreaterThan(lage(OVERLAY_EBENEN.nachherPunkt));
        expect(ids.at(-1)).toBe(OVERLAY_EBENEN.zeichenNachher);
    });

    it("die Filter sehen nur ihre Merkmale: `t` unterscheidet Vorher, Nachher, Verbindung und Zeichen", () => {
        /** `typ`: 1 Punkt, 2 Linie (so liest MapLibres Filter die Form eines Merkmals). */
        const trifft = (id: string, t: string, typ = 1): boolean => {
            const ebene = nach(id);
            const filter = "filter" in ebene ? ebene.filter : undefined;
            return (
                filter === undefined ||
                featureFilter(filter as never, "filter").filter(
                    { zoom: 3 },
                    { type: typ, properties: { t } } as never,
                    undefined as never,
                )
            );
        };
        expect(trifft(OVERLAY_EBENEN.vorherLinie, "vorher")).toBe(true);
        expect(trifft(OVERLAY_EBENEN.vorherLinie, "nachher")).toBe(false);
        expect(trifft(OVERLAY_EBENEN.nachherPunkt, "nachher")).toBe(true);
        expect(trifft(OVERLAY_EBENEN.nachherPunkt, "vorher")).toBe(false);
        // 🪤 Eine Scheibe gehört nur an einen Punkt: Sonst zeichnete MapLibre sie an jeden Stützpunkt einer Linie des Nachher.
        expect(trifft(OVERLAY_EBENEN.nachherPunkt, "nachher", 2)).toBe(false);
        expect(trifft(OVERLAY_EBENEN.vorherPunkt, "vorher", 2)).toBe(false);
        expect(trifft(OVERLAY_EBENEN.verschiebung, "weg")).toBe(true);
        expect(trifft(OVERLAY_EBENEN.zeichenVorher, "zeichen-vorher")).toBe(true);
        expect(trifft(OVERLAY_EBENEN.zeichenVorher, "zeichen-nachher")).toBe(false);
    });

    it("die Zeichen stehen immer da: kein Verdrängen durch Namen der Karte", () => {
        for (const id of [OVERLAY_EBENEN.zeichenVorher, OVERLAY_EBENEN.zeichenNachher]) {
            const ebene = nach(id);
            expect(ebene.type === "symbol" && ebene.layout?.["text-allow-overlap"]).toBe(true);
            expect(ebene.type === "symbol" && ebene.layout?.["text-ignore-placement"]).toBe(true);
        }
    });
});

describe("die Anzeige", () => {
    it("Beide zeigt alles samt Verbindung, Vorher und Nachher je ihre Seite ohne Verbindung", () => {
        const beide = ebenenSichtbar("beide");
        expect([...beide.values()].every(Boolean)).toBe(true);

        const vorher = ebenenSichtbar("vorher");
        expect(vorher.get(OVERLAY_EBENEN.vorherLinie)).toBe(true);
        expect(vorher.get(OVERLAY_EBENEN.vorherPunkt)).toBe(true);
        expect(vorher.get(OVERLAY_EBENEN.zeichenVorher)).toBe(true);
        expect(vorher.get(OVERLAY_EBENEN.nachherLinie)).toBe(false);
        expect(vorher.get(OVERLAY_EBENEN.nachherSaum)).toBe(false);
        expect(vorher.get(OVERLAY_EBENEN.verschiebung)).toBe(false);

        const nachher = ebenenSichtbar("nachher");
        expect(nachher.get(OVERLAY_EBENEN.nachherLinie)).toBe(true);
        expect(nachher.get(OVERLAY_EBENEN.vorherLinie)).toBe(false);
        expect(nachher.get(OVERLAY_EBENEN.vorherPunkt)).toBe(false);
        expect(nachher.get(OVERLAY_EBENEN.verschiebung)).toBe(false);
    });

    it("jede Ebene hat eine Aussage in jeder Anzeige", () => {
        for (const anzeige of ["beide", "vorher", "nachher"] as const)
            expect([...ebenenSichtbar(anzeige).keys()].sort()).toEqual([...OVERLAY_EBENEN_LISTE].sort());
    });
});

describe("der heutige Ort (WI-0265 B9)", () => {
    const ORT = bildAusLage({ grenzen: [80, 90, 80, 90], gegenstaende: 1, stillgelegt: 0 })!;
    const FLAECHE = bildAusLage({ grenzen: [100, 200, 160, 260], gegenstaende: 4, stillgelegt: 1 })!;

    it("ein Ort wird ein Punkt, ein Kasten ein geschlossener Umriss, beide unter `t: heute` und in Renderkoordinaten", () => {
        const punkt = overlayDaten(ORT, TEXTE).features;
        expect(punkt).toEqual([
            {
                type: "Feature",
                properties: { t: "heute" },
                geometry: { type: "Point", coordinates: renderPunkt([80, 90]) },
            },
        ]);
        const umriss = overlayDaten(FLAECHE, TEXTE).features;
        expect(umriss).toHaveLength(1);
        expect(umriss[0]!.properties.t).toBe("heute");
        const linie = umriss[0]!.geometry;
        expect(linie.type).toBe("LineString");
        expect(linie.type === "LineString" && linie.coordinates).toHaveLength(5);
    });

    it("kein Zeichen „− Vorher“ oder „+ Nachher“ und keine Verbindung: Der heutige Ort ist kein früherer Zustand", () => {
        for (const bild of [ORT, FLAECHE])
            expect(overlayDaten(bild, TEXTE).features.map((merkmal) => merkmal.properties.t)).toEqual(["heute"]);
    });

    it("🔴 ein Ort ohne Fläche bekommt für die Kamera einen Kasten mit Mindestkante (MapLibre rechnet aus null Fläche keinen Zoom)", () => {
        const grenzen = overlayGrenzen(ORT)!;
        expect(grenzen[1][0]).toBeGreaterThan(grenzen[0][0]);
        expect(grenzen[1][1]).toBeGreaterThan(grenzen[0][1]);
        // Der Ort liegt im Kasten (die Breite ist in Renderkoordinaten nicht linear, die Mitte also nur ungefähr in der Mitte).
        const mitte = renderPunkt([80, 90]);
        expect(mitte[0]).toBeGreaterThan(grenzen[0][0]);
        expect(mitte[0]).toBeLessThan(grenzen[1][0]);
        expect(mitte[1]).toBeGreaterThan(grenzen[0][1]);
        expect(mitte[1]).toBeLessThan(grenzen[1][1]);
    });

    it("die Ebenen des heutigen Ortes liegen UNTER allen anderen, sehen nur ihre Merkmale und zeichnen eine Scheibe nur an einem Punkt", () => {
        const ebenen = overlayEbenen();
        const ids = ebenen.map((ebene) => ebene.id);
        for (const id of [OVERLAY_EBENEN.heuteSaum, OVERLAY_EBENEN.heuteLinie, OVERLAY_EBENEN.heutePunkt])
            expect(ids.indexOf(id)).toBeLessThan(ids.indexOf(OVERLAY_EBENEN.vorherSaum));
        expect(ids.indexOf(OVERLAY_EBENEN.heuteSaum)).toBeLessThan(ids.indexOf(OVERLAY_EBENEN.heuteLinie));
        const trifft = (id: string, t: string, typ: number): boolean => {
            const filter = (ebenen.find((ebene) => ebene.id === id) as { filter: unknown }).filter;
            return featureFilter(filter as never, "filter").filter(
                { zoom: 3 },
                { type: typ, properties: { t } } as never,
                undefined as never,
            );
        };
        expect(trifft(OVERLAY_EBENEN.heuteLinie, "heute", 2)).toBe(true);
        expect(trifft(OVERLAY_EBENEN.heuteLinie, "vorher", 2)).toBe(false);
        expect(trifft(OVERLAY_EBENEN.heutePunkt, "heute", 1)).toBe(true);
        expect(trifft(OVERLAY_EBENEN.heutePunkt, "heute", 2)).toBe(false);
        expect(trifft(OVERLAY_EBENEN.vorherLinie, "heute", 2)).toBe(false);
    });

    it("dezent: dünner als Nachher, im Braun der Verbindung; der Schalter Beide | Vorher | Nachher ändert daran nichts", () => {
        const ebenen = overlayEbenen();
        const linie = ebenen.find((ebene) => ebene.id === OVERLAY_EBENEN.heuteLinie)!;
        const nachher = ebenen.find((ebene) => ebene.id === OVERLAY_EBENEN.nachherLinie)!;
        expect(linie.type === "line" && linie.paint?.["line-color"]).toBe(canonColour("mapChangeLink"));
        expect(Number(linie.type === "line" && linie.paint?.["line-width"])).toBeLessThan(
            Number(nachher.type === "line" && nachher.paint?.["line-width"]),
        );
        for (const anzeige of ["beide", "vorher", "nachher"] as const)
            expect(ebenenSichtbar(anzeige).get(OVERLAY_EBENEN.heuteLinie)).toBe(true);
    });
});
