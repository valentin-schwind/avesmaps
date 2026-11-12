import { describe, expect, it } from "vitest";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat, type SearchLeuchten } from "@avesmaps3d/shared";
import {
    buildSuchLeuchtenLayers,
    kennungsFilter,
    leuchtenAusschnitt,
    leuchtenMerkmale,
    leuchtetEtwas,
    renderKoordinaten,
    SUCH_LEUCHTEN_QUELLE,
    withSuchLeuchten,
    type SuchLeuchtenTeil,
} from "../src/map/such-leuchten";
import { SCHEIN_BIS_GEGENDEN } from "../src/map/leuchten-formen";

/**
 * Das Leuchten eines Suchtreffers auf der Karte (WI-0257 S3b), ohne Browser: Filter und Formen, die Ebenen im Stil, ihre Stelle in der Reihenfolge und der Ausschnitt für den Flug.
 */

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const leer = (extra: Partial<SearchLeuchten> = {}): SearchLeuchten => ({
    titel: "T",
    begriff: { name: "T" },
    pausiert: false,
    ganz: [],
    angeschnitten: [],
    gebiete: { ganz: [], angeschnitten: [] },
    orte: [],
    gegenden: 0,
    rahmen: null,
    nurKontinent: false,
    ...extra,
});

const rahmen = { x0: 100, y0: 200, x1: 140, y1: 260 };
const quadrat = {
    type: "Polygon" as const,
    coordinates: [
        [
            [100, 200],
            [110, 200],
            [110, 210],
            [100, 200],
        ],
    ],
};

function stil(): StyleSpecification {
    const layers = [
        { id: "background", type: "background" },
        { id: "path-center-weg", type: "line", source: "paths", "source-layer": "p" },
        { id: "route-halo", type: "line", source: "route" },
        { id: "place-marker", type: "circle", source: "places" },
    ] as LayerSpecification[];
    return {
        version: 8,
        sources: {
            paths: { type: "vector", tiles: ["/p/{z}/{x}/{y}"] },
            landscapes: { type: "vector", tiles: ["/l/{z}/{x}/{y}"] },
        },
        layers,
    } as StyleSpecification;
}

describe("kennungsFilter", () => {
    it("wenige Kennungen als `in`, viele als `match` (Nachschlagetabelle statt linearer Suche je Fläche)", () => {
        const wenige = kennungsFilter("region_public_id", [uuid(1), uuid(2)]) as unknown as unknown[];
        expect(wenige[0]).toBe("in");
        const viele = Array.from({ length: 2900 }, (_, i) => uuid(i + 1));
        const filter = kennungsFilter("region_public_id", viele) as unknown as unknown[];
        expect(filter).toEqual(["match", ["get", "region_public_id"], viele, true, false]);
    });
});

describe("renderKoordinaten", () => {
    it("wandelt Kartenkoordinaten in beliebiger Verschachtelung in Renderkoordinaten", () => {
        const [lng, lat] = renderKoordinaten([100, 200]) as [number, number];
        const erwartet = toRenderLngLat(AVENTURIA.coordinateSpace, { x: 100, y: 200 });
        expect(lng).toBeCloseTo(erwartet.lng, 9);
        expect(lat).toBeCloseTo(erwartet.lat, 9);
        const ring = renderKoordinaten(quadrat.coordinates) as number[][][];
        expect(ring[0]).toHaveLength(4);
        expect(ring[0]?.[0]).toEqual(renderKoordinaten([100, 200]));
    });
});

describe("leuchtenMerkmale", () => {
    it("angeschnittene Gegenden und der Rest sind Flächen, Gebiete Umrisse, Orte Punkte", () => {
        const merkmale = leuchtenMerkmale(
            leer({
                angeschnitten: [{ publicId: uuid(1), name: "A", form: quadrat, rahmen }],
                rest: { form: quadrat, rahmen },
                gebiete: { ganz: [], angeschnitten: [{ publicId: uuid(2), name: "G", form: quadrat, rahmen }] },
                orte: [{ id: uuid(3), name: "O", art: "dorf", x: 120, y: 230 }],
            }),
        );
        expect(merkmale.map((merkmal) => merkmal.properties.t)).toEqual(["flaeche", "flaeche", "gebiet", "ort"]);
        expect(merkmale[3]?.geometry.type).toBe("Point");
    });
});

describe("leuchtetEtwas", () => {
    it("nichts, wo nichts zu zeichnen ist; der Kontinent zählt nur mit seinen Angaben", () => {
        expect(leuchtetEtwas(leer())).toBe(false);
        expect(leuchtetEtwas(leer({ ganz: [uuid(1)] }))).toBe(true);
        expect(leuchtetEtwas(leer({ nurKontinent: true }))).toBe(false);
        expect(
            leuchtetEtwas(leer({ nurKontinent: true, kontinent: { publicId: uuid(9), name: "Aventurien", rahmen } })),
        ).toBe(true);
    });
});

describe("withSuchLeuchten", () => {
    it("ohne Bild oder ohne etwas Sichtbares bleibt der Stil, wie er ist", () => {
        const vorher = stil();
        expect(withSuchLeuchten(vorher, undefined)).toBe(vorher);
        expect(withSuchLeuchten(vorher, { leuchten: leer() })).toBe(vorher);
    });

    it("ganze Gegenden: Füllung, Schein und Kontur über der Landschaftsquelle, VOR der Route", () => {
        const ergebnis = withSuchLeuchten(stil(), { leuchten: leer({ ganz: [uuid(1), uuid(2)], gegenden: 2 }) });
        const ids = ergebnis.layers.map((ebene) => ebene.id);
        expect(ids).toEqual([
            "background",
            "path-center-weg",
            "such-leuchten-ganz-fuellung",
            "such-leuchten-ganz-schein",
            "such-leuchten-ganz-linie",
            "route-halo",
            "place-marker",
        ]);
        const fuellung = ergebnis.layers.find((ebene) => ebene.id === "such-leuchten-ganz-fuellung") as {
            source: string;
            "source-layer": string;
        };
        expect(fuellung.source).toBe("landscapes");
        expect(fuellung["source-layer"]).toBe("region_area_render");
        // Gezeichnet wird nur, was der Server nennt: keine eigene Quelle ohne Formen.
        expect(ergebnis.sources[SUCH_LEUCHTEN_QUELLE]).toBeUndefined();
    });

    it("angeschnittene Formen und Orte stehen in einer eigenen GeoJSON-Quelle mit ihren Ebenen", () => {
        const ergebnis = withSuchLeuchten(stil(), {
            leuchten: leer({
                angeschnitten: [{ publicId: uuid(1), name: "A", form: quadrat, rahmen }],
                orte: [{ id: uuid(3), name: "O", art: "dorf", x: 120, y: 230 }],
                gegenden: 1,
            }),
        });
        expect(ergebnis.sources[SUCH_LEUCHTEN_QUELLE]).toMatchObject({ type: "geojson" });
        const ids = ergebnis.layers.map((ebene) => ebene.id);
        expect(ids).toEqual(
            expect.arrayContaining([
                "such-leuchten-flaeche",
                "such-leuchten-schein",
                "such-leuchten-linie",
                "such-leuchten-ort-schein",
                "such-leuchten-ort",
            ]),
        );
        expect(ids.indexOf("such-leuchten-ort")).toBeLessThan(ids.indexOf("route-halo"));
    });

    it("🔴 nur der Kontinent: ein Umriss ohne Füllung", () => {
        const ergebnis = withSuchLeuchten(stil(), {
            leuchten: leer({
                nurKontinent: true,
                kontinent: { publicId: uuid(9), name: "Aventurien", rahmen },
            }),
        });
        const ids = ergebnis.layers.map((ebene) => ebene.id).filter((id) => id.startsWith("such-leuchten"));
        expect(ids).toEqual(["such-leuchten-kontinent-schein", "such-leuchten-kontinent-linie"]);
    });

    it("ganze Herrschaftsgebiete leuchten als Umriss, die Quelle bringt das Leuchten mit, wo die Ansicht sie nicht führt", () => {
        const bild = { leuchten: leer({ gebiete: { ganz: [uuid(5)], angeschnitten: [] }, gegenden: 1 }) };
        // Ohne Zeiger auf die Gebietskacheln gibt es keine Quelle - und keine Ebene, die sie braucht.
        const ohne = withSuchLeuchten(stil(), bild);
        expect(ohne.sources["territories"]).toBeUndefined();
        expect(ohne.layers.some((ebene) => ebene.id.startsWith("such-leuchten-gebiet"))).toBe(false);
        const mit = withSuchLeuchten(stil(), bild, { gebiete: { revision: "r1" } as never });
        expect(mit.sources["territories"]).toMatchObject({ type: "vector" });
        const ids = mit.layers.map((ebene) => ebene.id).filter((id) => id.startsWith("such-leuchten"));
        expect(ids).toEqual(["such-leuchten-gebiet-ganz-schein", "such-leuchten-gebiet-ganz-linie"]);
    });

    it("steht die Gebietsquelle schon im Stil, bleibt sie, wie sie ist", () => {
        const vorher = stil();
        const eigene = { type: "vector", tiles: ["/schon/da/{z}/{x}/{y}"] } as const;
        (vorher.sources as Record<string, unknown>)["territories"] = eigene;
        const ergebnis = withSuchLeuchten(
            vorher,
            { leuchten: leer({ gebiete: { ganz: [uuid(5)], angeschnitten: [] }, gegenden: 1 }) },
            { gebiete: { revision: "r1" } as never },
        );
        expect(ergebnis.sources["territories"]).toBe(eigene);
    });

    it("🔴 ohne Route und Marken im Stil steht das Leuchten am Ende, ohne Fehler", () => {
        const klein = {
            version: 8,
            sources: { landscapes: { type: "vector", tiles: ["/l"] } },
            layers: [],
        } as unknown as StyleSpecification;
        const ergebnis = withSuchLeuchten(klein, { leuchten: leer({ ganz: [uuid(1)], gegenden: 1 }) });
        expect(ergebnis.layers.map((ebene) => ebene.id)).toHaveLength(3);
    });
});

describe("buildSuchLeuchtenLayers", () => {
    it("liefert nichts, wo nichts leuchtet", () => {
        expect(buildSuchLeuchtenLayers(leer(), false, false)).toEqual([]);
    });
});

describe("leuchtenAusschnitt", () => {
    it("der Rahmen des Leuchtens, in Renderkoordinaten Südwest und Nordost", () => {
        const box = leuchtenAusschnitt(leer({ rahmen }));
        expect(box).toBeDefined();
        const [[w, s], [o, n]] = box as [[number, number], [number, number]];
        expect(w).toBeLessThan(o);
        expect(s).toBeLessThan(n);
        const sw = toRenderLngLat(AVENTURIA.coordinateSpace, { x: 100, y: 200 });
        expect(w).toBeCloseTo(sw.lng, 9);
        expect(s).toBeCloseTo(sw.lat, 9);
    });

    it("die genannten Orte gehören dazu, auch wo es keinen Rahmen gibt", () => {
        const nurOrt = leuchtenAusschnitt(leer({ orte: [{ id: uuid(3), name: "O", art: "dorf", x: 120, y: 230 }] }));
        expect(nurOrt).toBeDefined();
        const [[w], [o]] = nurOrt as [[number, number], [number, number]];
        // Ein einzelner Ort bekommt einen Hof, sonst könnte die Kamera nichts einpassen.
        expect(o - w).toBeGreaterThan(0);
        const weiter = leuchtenAusschnitt(
            leer({ rahmen, orte: [{ id: uuid(3), name: "O", art: "dorf", x: 400, y: 230 }] }),
        ) as [[number, number], [number, number]];
        const ohne = leuchtenAusschnitt(leer({ rahmen })) as [[number, number], [number, number]];
        expect(weiter[1][0]).toBeGreaterThan(ohne[1][0]);
    });

    it("nur der Kontinent: sein Rahmen; nichts: undefined", () => {
        const kontinent = { publicId: uuid(9), name: "Aventurien", rahmen: { x0: 0, y0: 0, x1: 1000, y1: 1000 } };
        expect(leuchtenAusschnitt(leer({ nurKontinent: true, kontinent }))).toBeDefined();
        expect(leuchtenAusschnitt(leer())).toBeUndefined();
    });
});

describe("Schein nur bei wenigen Gegenden (WI-0266)", () => {
    const viele = (n: number): string[] => Array.from({ length: n }, (_, i) => uuid(1000 + i));
    const ids = (style: StyleSpecification): string[] => style.layers.map((ebene) => ebene.id);

    it("🔴 ab SCHEIN_BIS_GEGENDEN ganzen Gegenden leuchten nur Füllung und Kontur", () => {
        const knapp = withSuchLeuchten(stil(), { leuchten: leer({ ganz: viele(SCHEIN_BIS_GEGENDEN - 1) }) });
        expect(ids(knapp)).toContain("such-leuchten-ganz-schein");
        const viel = withSuchLeuchten(stil(), { leuchten: leer({ ganz: viele(SCHEIN_BIS_GEGENDEN) }) });
        expect(ids(viel)).not.toContain("such-leuchten-ganz-schein");
        expect(ids(viel)).toContain("such-leuchten-ganz-fuellung");
        expect(ids(viel)).toContain("such-leuchten-ganz-linie");
    });

    it("🔴 gewählte Vorkommen: gezählt über alle Vorkommen, die Kontur bleibt", () => {
        const teil = (id: number, ganz: string[]): SuchLeuchtenTeil => ({
            id: uuid(id),
            name: `V${String(id)}`,
            kind: "fauna",
            farbe: "#aa3300",
            leuchten: leer({ ganz }),
        });
        const haelfte = Math.ceil(SCHEIN_BIS_GEGENDEN / 2);
        const wenig = withSuchLeuchten(stil(), { leuchten: leer(), teile: [teil(1, viele(10))] });
        expect(ids(wenig).some((id) => id.startsWith("vorkommen-ganz-") && id.endsWith("-schein"))).toBe(true);
        const viel = withSuchLeuchten(stil(), {
            leuchten: leer(),
            teile: [teil(1, viele(haelfte)), teil(2, viele(2 * haelfte).slice(haelfte))],
        });
        expect(ids(viel).some((id) => id.startsWith("vorkommen-ganz-") && id.endsWith("-schein"))).toBe(false);
        expect(ids(viel).some((id) => id.startsWith("vorkommen-ganz-") && id.endsWith("-linie"))).toBe(true);
    });
});
