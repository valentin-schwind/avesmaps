import { describe, expect, it } from "vitest";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { canonColour, DESIGN_CANON, type SearchLeuchten } from "@avesmaps3d/shared";
import type { Piece } from "../src/map/area-label-placement";
import { vorkommenAusschnitt, withSuchLeuchten, type SuchLeuchtenTeil } from "../src/map/such-leuchten";
import {
    konturBreite,
    traegerVon,
    VORKOMMEN_NAMEN_EBENE,
    VORKOMMEN_QUELLE,
    vorkommenMerkmale,
} from "../src/map/vorkommen-leuchten";
import { lieseVorkommenFlaechen, teileNachLage, ZWEITER_NAME_ANTEIL } from "../src/map/vorkommen-namen";
import { leseZeichenBildName, zeichenBildName } from "../src/map/vorkommen-zeichen-bild";
import { freierPlatz, VORKOMMEN_FARBEN, vorkommenFarbe, vorkommenFarbeCss } from "../src/search/vorkommen-farben";

/**
 * Die gewählten Vorkommen auf der Karte (WI-0257 S5), ohne Browser: die Farbtafel, die Vergabe der Plätze, die Ebenen je Farbe samt überlappender Gegenden,
 * die Merkmale und das Lesen der Flächen für die Namen.
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
const rahmen = { x0: 100, y0: 200, x1: 110, y1: 210 };

const teil = (n: number, leuchten: SearchLeuchten, kind: SuchLeuchtenTeil["kind"] = "fauna"): SuchLeuchtenTeil => ({
    id: uuid(n),
    name: `Vorkommen ${String(n)}`,
    kind,
    farbe: vorkommenFarbe(n),
    leuchten,
});

function stil(): StyleSpecification {
    return {
        version: 8,
        sources: { landscapes: { type: "vector", tiles: ["/l/{z}/{x}/{y}"] } },
        layers: [
            { id: "background", type: "background" },
            { id: "route-halo", type: "line", source: "route" },
            { id: "place-marker", type: "circle", source: "places" },
        ] as LayerSpecification[],
    } as StyleSpecification;
}

const paint = (ebene: LayerSpecification | undefined): Record<string, unknown> =>
    (ebene as { paint?: Record<string, unknown> } | undefined)?.paint ?? {};

describe("Die Farbtafel der Vorkommen", () => {
    it("🔴 sechzehn verschiedene Farben aus dem Kanon, keine davon das Gold der Auswahl; die Oberfläche liest dieselben als Variable", () => {
        expect(VORKOMMEN_FARBEN.length).toBeGreaterThanOrEqual(16);
        expect(new Set(VORKOMMEN_FARBEN).size).toBe(VORKOMMEN_FARBEN.length);
        expect(VORKOMMEN_FARBEN).not.toContain(canonColour("mapSelection"));
        expect(VORKOMMEN_FARBEN[0]).toBe(DESIGN_CANON.colour["mapVorkommen1"]);
        expect(vorkommenFarbeCss(3)).toBe("var(--color-map-vorkommen3)");
    });

    it("🔴 ein Neuer nimmt den ersten freien Platz; sind alle belegt, den am seltensten belegten", () => {
        expect(freierPlatz([])).toBe(1);
        expect(freierPlatz([1, 2, 3])).toBe(4);
        // Platz 2 wurde frei: Der nächste nimmt ihn, die übrigen behalten ihre.
        expect(freierPlatz([1, 3])).toBe(2);
        expect(freierPlatz([1, 2, 3], 3)).toBe(1);
        expect(freierPlatz([1, 2, 3, 1], 3)).toBe(2);
    });
});

describe("Das Leuchten der gewählten Vorkommen", () => {
    it("🔴 mit Teilen leuchtet jedes in seiner Farbe, nichts golden; der Name steht zuoberst, die Flächen vor der Route", () => {
        const a = teil(1, leer({ ganz: [uuid(10)] }));
        const b = teil(2, leer({ ganz: [uuid(11)] }));
        const style = withSuchLeuchten(stil(), { leuchten: leer({ ganz: [uuid(10), uuid(11)] }), teile: [a, b] });
        const ids = style.layers.map((ebene) => ebene.id);
        expect(ids.filter((id) => id.startsWith("such-leuchten"))).toEqual([]);
        expect(ids.at(-1)).toBe(VORKOMMEN_NAMEN_EBENE);
        expect(ids.indexOf("vorkommen-ganz-0-linie")).toBeLessThan(ids.indexOf("route-halo"));
        const fuellung = paint(style.layers.find((ebene) => ebene.id === "vorkommen-ganz-0-fuellung"));
        expect(JSON.stringify(fuellung["fill-color"])).toContain(a.farbe);
        expect(JSON.stringify(fuellung["fill-color"])).toContain(b.farbe);
        // Eine Gegend trägt keiner doppelt: keine zweite Stufe.
        expect(ids).not.toContain("vorkommen-ganz-1-linie");
    });

    it("🔴 der Flug zu einem Vorkommen: sein Rahmen; keiner, wo nur der Kontinent bleibt oder nichts leuchtet", () => {
        expect(vorkommenAusschnitt(leer({ ganz: [uuid(10)], rahmen }))).toBeDefined();
        expect(
            vorkommenAusschnitt(leer({ orte: [{ id: uuid(30), name: "O", art: "dorf", x: 1, y: 2 }] })),
        ).toBeDefined();
        const kontinent = { publicId: uuid(1), name: "Aventurien", rahmen };
        expect(vorkommenAusschnitt(leer({ nurKontinent: true, kontinent }))).toBeUndefined();
        expect(vorkommenAusschnitt(leer())).toBeUndefined();
    });

    it("🔴 ohne Teile bleibt das Leuchten der Suche golden", () => {
        const style = withSuchLeuchten(stil(), { leuchten: leer({ ganz: [uuid(10)] }) });
        expect(style.layers.some((ebene) => ebene.id.startsWith("vorkommen"))).toBe(false);
        expect(style.layers.some((ebene) => ebene.id.startsWith("such-leuchten"))).toBe(true);
    });

    it("🔴 überlappende Gegenden bleiben beide sichtbar: eine Stufe je Trägerin, die frühere Kontur breiter darunter", () => {
        const a = teil(1, leer({ ganz: [uuid(10), uuid(12)] }));
        const b = teil(2, leer({ ganz: [uuid(10)] }));
        expect(traegerVon([a, b]).get(`r:${uuid(10)}`)).toEqual([0, 1]);
        const style = withSuchLeuchten(stil(), { leuchten: leer(), teile: [a, b] });
        const ids = style.layers.map((ebene) => ebene.id);
        expect(ids).toContain("vorkommen-ganz-0-linie");
        expect(ids).toContain("vorkommen-ganz-1-linie");
        expect(ids.indexOf("vorkommen-ganz-0-linie")).toBeLessThan(ids.indexOf("vorkommen-ganz-1-linie"));
        const unten = JSON.stringify(paint(style.layers.find((e) => e.id === "vorkommen-ganz-0-linie"))["line-width"]);
        const oben = paint(style.layers.find((e) => e.id === "vorkommen-ganz-1-linie"))["line-width"];
        // Unten trägt die geteilte Gegend die doppelte Breite, die nur von A getragene die einfache; oben die einfache.
        expect(unten).toContain(String(konturBreite(0, 2)));
        expect(unten).toContain(String(konturBreite(0, 1)));
        expect(oben).toBe(DESIGN_CANON.mapSelection.lineWidth);
        expect(konturBreite(0, 2)).toBeGreaterThan(konturBreite(1, 2));
        expect(konturBreite(0, 9)).toBe(DESIGN_CANON.mapSelection.glowWidth);
    });

    it("Stücke, Reste und Orte stehen in der eigenen Quelle mit Vorkommen, Farbe und Breite; ein Vorkommen nur mit Orten trägt seinen Namen am ersten Ort", () => {
        const stueck = { publicId: uuid(20), name: "Stück", form: quadrat, rahmen };
        const a = teil(
            1,
            leer({ angeschnitten: [stueck], orte: [{ id: uuid(30), name: "O", art: "dorf", x: 1, y: 2 }] }),
        );
        const b = teil(2, leer({ orte: [{ id: uuid(30), name: "O", art: "dorf", x: 1, y: 2 }] }), "ware");
        const merkmale = vorkommenMerkmale([a, b], 22);
        const flaeche = merkmale.find((m) => m.properties["t"] === "flaeche");
        expect(flaeche?.properties).toMatchObject({ v: a.id, farbe: a.farbe, breite: konturBreite(0, 1) });
        const orte = merkmale.filter((m) => m.properties["t"] === "ort");
        expect(orte.map((m) => m.properties["radius"])).toEqual([16, 11]);
        expect(orte[0]?.properties["name"]).toBeUndefined();
        expect(orte[1]?.properties).toMatchObject({ name: b.name, zeichen: zeichenBildName("ware", b.farbe, 22) });
        const style = withSuchLeuchten(stil(), { leuchten: leer(), teile: [a, b] });
        expect(style.sources[VORKOMMEN_QUELLE]).toBeDefined();
    });
});

describe("Die Namen der gewählten Vorkommen", () => {
    const stueckVon = (x: number): Piece => ({ rings: [[x, 0, x + 1, 0, x + 1, 1]], bbox: [x, 0, x + 1, 1] });

    it("🔴 je Vorkommen EIN Band aus allen Quellen; eine Gegend, die zwei tragen, zählt für beide; ein Vorkommen nur mit Orten hat keines", () => {
        const a = teil(1, leer({ ganz: [uuid(10)] }));
        const b = teil(
            2,
            leer({ ganz: [uuid(10)], angeschnitten: [{ publicId: uuid(21), name: "S", form: quadrat, rahmen }] }),
        );
        const c = teil(3, leer({ orte: [{ id: uuid(30), name: "O", art: "dorf", x: 1, y: 2 }] }));
        const karte = {
            getSource: (id: string) => (id === "territories" ? undefined : {}),
            querySourceFeatures: (quelle: string) =>
                quelle === VORKOMMEN_QUELLE
                    ? [{ properties: { t: "flaeche", v: b.id }, geometry: { type: "Polygon", coordinates: [] } }]
                    : [{ properties: { region_public_id: uuid(10) }, geometry: { type: "Polygon", coordinates: [] } }],
        };
        let x = 0;
        const baender = lieseVorkommenFlaechen(
            karte as unknown as Parameters<typeof lieseVorkommenFlaechen>[0],
            [a, b, c],
            () => [stueckVon((x += 2))],
        );
        expect(baender.map((band) => [band.key, band.pieces.length])).toEqual([
            [a.id, 1],
            [b.id, 2],
        ]);
        expect(baender[0]?.properties).toMatchObject({ zeichen: expect.stringContaining("vorkommen-zeichen-fauna-") });
    });

    it("🔴 höchstens zwei Namen: ein weit getrennter, großer zweiter Teil bekommt einen eigenen, Inselchen nie", () => {
        const flaeche = (x0: number, y0: number, x1: number, y1: number): Piece => ({
            rings: [[x0, y0, x1, y0, x1, y1]],
            bbox: [x0, y0, x1, y1],
        });
        const band = (pieces: Piece[]) => ({ key: "a", name: "A", pieces });
        const ansicht = [0, 0, 100, 100] as const;
        // Zwei große Teile weit auseinander (der zweite halb so groß): zwei Namen.
        const zwei = teileNachLage(
            band([flaeche(0, 0, 40, 40), flaeche(1, 1, 30, 30), flaeche(70, 70, 98, 98)]),
            ansicht,
            5,
        );
        expect(zwei.map((b) => [b.key, b.pieces.length])).toEqual([
            ["a", 2],
            ["a#2", 1],
        ]);
        // Ein Inselchen (kleiner als der Anteil): ein Name, die Insel bleibt im Band.
        const insel = teileNachLage(band([flaeche(0, 0, 40, 40), flaeche(90, 90, 95, 95)]), ansicht, 5);
        expect(insel.map((b) => b.key)).toEqual(["a"]);
        expect(25 / 1600).toBeLessThan(ZWEITER_NAME_ANTEIL);
        // Näher als die Lücke: ein Teil, ein Name.
        expect(teileNachLage(band([flaeche(0, 0, 40, 40), flaeche(43, 0, 80, 40)]), ansicht, 5)).toHaveLength(1);
        // Ein dritter großer Teil bekommt keinen eigenen Namen.
        const drei = teileNachLage(
            band([flaeche(0, 0, 30, 30), flaeche(60, 0, 90, 30), flaeche(0, 60, 30, 90)]),
            ansicht,
            5,
        );
        expect(drei.map((b) => b.key)).toEqual(["a", "a#2"]);
        // Außerhalb des Bildes zählt ein Teil nicht.
        expect(teileNachLage(band([flaeche(0, 0, 40, 40), flaeche(200, 200, 260, 260)]), ansicht, 5)).toHaveLength(1);
    });

    it("der Name des Zeichenbildes trägt Kategorie, Farbe und Schriftgröße und lässt sich zurücklesen", () => {
        const id = zeichenBildName("flora", "#B22A6C", 16);
        expect(id).toBe("vorkommen-zeichen-flora-b22a6c-16");
        expect(leseZeichenBildName(id)).toEqual({ kind: "flora", farbe: "#b22a6c", schrift: 16 });
        expect(leseZeichenBildName("vorkommen-zeichen-ork-b22a6c-16")).toBeUndefined();
        expect(leseZeichenBildName("claim-ffb901-604c34")).toBeUndefined();
    });
});
