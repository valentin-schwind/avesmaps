import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDMARKEN_ARTEN, catmullRomLine } from "@avesmaps3d/shared";
import {
    FLAECHENFARBE_RUECKFALL,
    LANDMARKENFARBE,
    ORTSFARBE,
    WEGARTEN_ZEICHENREIHENFOLGE,
    WEGFARBEN,
    flaechenFarbe,
    mantelBreite,
    wegBreite,
} from "../src/karten-export/svg/farben.ts";
import {
    flaecheninhalt,
    flaechenDaten,
    linienDaten,
    punktInFlaeche,
    ringDaten,
    svgPunkt,
    type Flaeche,
    type Punkt,
} from "../src/karten-export/svg/geometrie.ts";
import { baueKontextIndex, kontextAm } from "../src/karten-export/svg/kontext.ts";
import {
    KARTEN_SVG_EBENEN,
    KARTEN_SVG_GLATT,
    KARTEN_SVG_ROH,
    bereinigeKartenSvgOptionen,
} from "../src/karten-export/svg/optionen.ts";
import { adobeMaskierung, faltAscii, kennungFuer, maskiere, zahlText } from "../src/karten-export/svg/text.ts";
import { LANDMARKENARTEN_REIHE, TYP_VOKABULAR } from "../src/karten-export/svg/vokabular.ts";

/**
 * Die Bausteine des SVG-Bauers (WI-0280 K2): Koordinaten, Glättung, Maskierung, ids, Farben, Einstellungen. Reine Funktionstests.
 *
 * 🔴 Die Koordinatenformel `x_svg = x`, `y_svg = 1024 − y` und das Raster (`Bildpunkt = Einheit × 32` bei 32768 Pixeln) sind hier an zwei
 * bekannten Orten belegt, mit Festwerten aus der lokalen Entwicklungsdatenbank (gemessen 2026-11-05, nur gelesen) und aus Legacy.
 */

const konfig = (pfad: string): unknown =>
    JSON.parse(readFileSync(new URL(`../../../${pfad}`, import.meta.url), "utf8"));

// ---- Koordinaten --------------------------------------------------------------------------------------------------------

describe("Koordinaten", () => {
    it("spiegelt y und rundet auf zwei Stellen (Legacys Fälle)", () => {
        expect(svgPunkt(0, 0)).toEqual({ x: 0, y: 1024 });
        expect(svgPunkt(0, 1024)).toEqual({ x: 0, y: 0 });
        expect(svgPunkt(512, 512)).toEqual({ x: 512, y: 512 });
        expect(svgPunkt(1.23456, 2.98765)).toEqual({ x: 1.23, y: 1021.01 });
    });

    /**
     * Die Wirklichkeit: (Karte x, Karte y) in `aventuria-v1`, dieselbe Stelle in der Renderprojektion der Kacheln
     * (`map_domain_to_render`, EPSG:3857, das Quadrat [−W, W]² ist das Rasterbild) und der Legacy-Kachelname (`tools/build_tiles.py`,
     * Leaflet CRS.Simple, 256 Bildpunkte, Stufe 5 = 32768 Bildpunkte, Name `map_<x>_<y − 128>.webp`).
     */
    const W = 20037508.342789244;
    const ORTE = [
        // Legacy: `js/app/__tests__/deeplink-oeffnet-infobox.test.js` führt Gareth als [lat, lng] = [532.969, 551.625]
        {
            name: "Gareth",
            x: 551.625,
            y: 532.969,
            render: [1550754.4298496544, 820637.7196092755],
            kachel: "map_68_-67",
        },
        // Legacy: `tools/paths/test-path-outliers.php` führt Punin als [x, y] = [518, 441] (ganzzahlig); hier die Daten mit allen Stellen
        {
            name: "Punin",
            x: 518.25739,
            y: 441.22919,
            render: [244887.7037677467, -2769669.327736236],
            kachel: "map_64_-56",
        },
    ] as const;

    it.each(ORTE)("🔴 $name: Die SVG-Koordinate liegt auf dem Rasterpunkt der Karte (32768 Bildpunkte)", (ort) => {
        const punkt = svgPunkt(ort.x, ort.y);
        const rasterX = ((ort.render[0] + W) / (2 * W)) * 32768;
        const rasterY = (1 - (ort.render[1] + W) / (2 * W)) * 32768;
        // Auf zwei Stellen gerundet ist die Abweichung höchstens ein halbes Hundertstel Einheit = 0,16 Bildpunkte je Achse.
        expect(Math.abs(punkt.x * 32 - rasterX)).toBeLessThan(0.17);
        expect(Math.abs(punkt.y * 32 - rasterY)).toBeLessThan(0.17);
        // Dieselbe Formel ohne Umweg über die Projektion.
        expect(rasterX).toBeCloseTo(ort.x * 32, 4);
        expect(rasterY).toBeCloseTo((1024 - ort.y) * 32, 4);
        // Und die Legacy-Kachel der Stufe 5, in der der Ort liegt.
        expect(`map_${String(Math.floor(rasterX / 256))}_${String(Math.floor(rasterY / 256) - 128)}`).toBe(ort.kachel);
    });

    it("Gareth ist in Legacy und in Avesmaps3D dieselbe Zahl: Der Import rührt die Koordinaten nicht an", () => {
        // Legacy [lat, lng] = [y, x]; migration-places.test.ts: x 551.625, y 532.969.
        expect(svgPunkt(551.625, 532.969)).toEqual({ x: 551.63, y: 491.03 });
    });
});

// ---- Glättung -----------------------------------------------------------------------------------------------------------

function pfadZahlen(daten: string): { befehl: string; zahlen: number[] }[] {
    return [...daten.matchAll(/([MLCZ])([^MLCZ]*)/gu)].map((t) => ({
        befehl: t[1] ?? "",
        zahlen: (t[2] ?? "").trim().split(/\s+/u).filter(Boolean).map(Number),
    }));
}

describe("Glättung", () => {
    it("schreibt rohe Linien als Stützpunktzug, ohne Schnörkel", () => {
        expect(
            linienDaten(
                [
                    [0, 1024],
                    [10, 1014],
                    [20, 1024],
                ],
                false,
                0.5,
            ),
        ).toBe("M0 0L10 10L20 0");
        expect(linienDaten([], true, 0.5)).toBe("");
        expect(linienDaten([[3, 4]], true, 0.5)).toBe("M3 1020");
    });

    it("🔴 die Bézierkurve IST die Kurve der Karte: dieselbe Linie wie `catmullRomLine` mit Legacys Werten", () => {
        const punkte: Punkt[] = [
            [10, 10],
            [100, 60],
            [200, 30],
            [300, 200],
            [350, 120],
            [400, 400],
        ];
        const stuecke = pfadZahlen(linienDaten(punkte, true, 0.5));
        expect(stuecke.map((s) => s.befehl)).toEqual(["M", "C", "C", "C", "C", "C"]);
        // Dieselbe Linie, wie die Karte sie abtastet: acht Punkte je Abschnitt (`LEGACY_CATMULL`), in Kartenkoordinaten.
        const karte = catmullRomLine(
            punkte.map(([x, y]) => ({ x, y })),
            { samples: 8, tension: 0.5 },
        );
        expect(karte).toHaveLength(1 + 5 * 8);
        // Auswertung je Abschnitt (Start = Endpunkt des vorigen).
        let ax = stuecke[0]?.zahlen[0] ?? 0;
        let ay = stuecke[0]?.zahlen[1] ?? 0;
        stuecke.slice(1).forEach((stueck, abschnitt) => {
            const [c1x = 0, c1y = 0, c2x = 0, c2y = 0, ex = 0, ey = 0] = stueck.zahlen;
            for (let probe = 1; probe <= 8; probe += 1) {
                const t = probe / 8;
                const u = 1 - t;
                const bx = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex;
                const by = u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey;
                const erwartet = karte[abschnitt * 8 + probe] as { x: number; y: number };
                // Die Datei ist y-gespiegelt und auf Hundertstel gerundet: Abweichung unter einem Hundertstel Einheit.
                expect(
                    Math.abs(bx - erwartet.x),
                    `Abschnitt ${String(abschnitt)} Probe ${String(probe)} x`,
                ).toBeLessThan(0.02);
                expect(
                    Math.abs(by - (1024 - erwartet.y)),
                    `Abschnitt ${String(abschnitt)} Probe ${String(probe)} y`,
                ).toBeLessThan(0.02);
            }
            ax = ex;
            ay = ey;
        });
    });

    it("hält die Endpunkte einer offenen Linie fest: Anfang und Ende wandern nicht", () => {
        const punkte: Punkt[] = [
            [10, 10],
            [100, 60],
            [200, 30],
        ];
        const stuecke = pfadZahlen(linienDaten(punkte, true, 0.5));
        expect(stuecke[0]?.zahlen).toEqual([10, 1014]);
        expect(stuecke.at(-1)?.zahlen.slice(-2)).toEqual([200, 994]);
        // Spannung 0 legt die Kurve auf den Polygonzug zurück: Die Anfasser sitzen auf den Stützpunkten.
        expect(pfadZahlen(linienDaten(punkte, true, 0))[1]?.zahlen).toEqual([10, 1014, 100, 964, 100, 964]);
    });

    it("🔴 rundet einen Ring umlaufend: Am willkürlichen Startpunkt entsteht keine Ecke", () => {
        const ring: Punkt[] = [
            [100, 100],
            [200, 100],
            [250, 180],
            [200, 260],
            [100, 260],
            [100, 100],
        ];
        const stuecke = pfadZahlen(ringDaten(ring, true, 0.5));
        const kurven = stuecke.filter((s) => s.befehl === "C");
        expect(kurven).toHaveLength(5);
        expect(ringDaten(ring, true, 0.5).endsWith("Z")).toBe(true);
        const start = stuecke[0]?.zahlen ?? [];
        const [, , ankerX = 0, ankerY = 0] = kurven.at(-1)?.zahlen.slice(0, 4) ?? [];
        const [abgangX = 0, abgangY = 0] = kurven[0]?.zahlen ?? [];
        // Einlaufende Richtung (Start − zweiter Anfasser des letzten Abschnitts) und auslaufende (erster Anfasser − Start) laufen parallel.
        const einX = (start[0] ?? 0) - ankerX;
        const einY = (start[1] ?? 0) - ankerY;
        const ausX = abgangX - (start[0] ?? 0);
        const ausY = abgangY - (start[1] ?? 0);
        expect(Math.abs(einX * ausY - einY * ausX)).toBeLessThan(0.05);
        expect(einX * ausX + einY * ausY).toBeGreaterThan(0);
        // Der wiederholte Schlusspunkt ergibt kein Nullsegment: gleiche Kurve mit und ohne.
        expect(ringDaten(ring.slice(0, -1), true, 0.5)).toBe(ringDaten(ring, true, 0.5));
    });

    it("fällt für Ringe unter drei Punkten auf den Polygonzug zurück und lässt Leeres leer", () => {
        expect(
            ringDaten(
                [
                    [0, 0],
                    [10, 10],
                ],
                true,
                0.5,
            ),
        ).toBe("M0 1024L10 1014Z");
        expect(ringDaten([], true, 0.5)).toBe("");
        expect(flaechenDaten([], true, 0.5)).toBe("");
        expect(flaechenDaten([[[]]], true, 0.5)).toBe("");
    });

    it("zeichnet ein Loch als zweiten Ring und lässt es im Punkttest zählen", () => {
        const flaeche: Flaeche = [
            [
                [
                    [0, 0],
                    [100, 0],
                    [100, 100],
                    [0, 100],
                    [0, 0],
                ],
                [
                    [40, 40],
                    [60, 40],
                    [60, 60],
                    [40, 60],
                    [40, 40],
                ],
            ],
        ];
        expect((flaechenDaten(flaeche, false, 0.5).match(/M/gu) ?? []).length).toBe(2);
        expect(punktInFlaeche(10, 10, flaeche)).toBe(true);
        expect(punktInFlaeche(50, 50, flaeche)).toBe(false);
        expect(punktInFlaeche(150, 50, flaeche)).toBe(false);
        // 10000 − 400
        expect(flaecheninhalt(flaeche)).toBe(9600);
    });
});

// ---- Kontext ------------------------------------------------------------------------------------------------------------

describe("Kontext", () => {
    const quadrat = (x0: number, y0: number, x1: number, y1: number): Flaeche => [
        [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    ];

    it("weist einem Relief die höchste Gipfelhöhe zu, nur der ersten Reliefläche, die den Gipfel enthält", () => {
        const index = baueKontextIndex(
            [
                { typ: "gebirge", ebene: "topographie", flaeche: quadrat(0, 0, 100, 100) },
                { typ: "huegelland", ebene: "topographie", flaeche: quadrat(0, 0, 100, 100) },
                { typ: "wald", ebene: "vegetation", flaeche: quadrat(0, 0, 100, 100) },
                { typ: "tropisch", ebene: "klima", flaeche: quadrat(0, 0, 200, 50) },
            ],
            [
                { x: 10, y: 10, hoehe: 3000 },
                { x: 20, y: 20, hoehe: 5000 },
                { x: 30, y: 30, hoehe: 4000 },
                { x: 500, y: 500, hoehe: 9000 },
            ],
        );
        const kontext = kontextAm(index, [50, 25]);
        expect(kontext.klima).toBe("tropisch");
        expect(kontext.relief?.typ).toBe("gebirge");
        expect(kontext.relief?.hoehe).toBe(5000);
        // Das Hügelland bekam keinen Gipfel; ein Wald ist kein Relief; ein Gipfel außerhalb gehört niemandem.
        expect(index.relief.find((e) => e.typ === "huegelland")?.hoehe).toBeNull();
        expect(index.relief).toHaveLength(2);
        expect(kontextAm(index, [50, 75]).klima).toBe("");
        expect(kontextAm(null, [1, 1])).toEqual({ klima: "", relief: null });
        expect(kontextAm(index, null)).toEqual({ klima: "", relief: null });
    });
});

// ---- Text, Namen, ids ---------------------------------------------------------------------------------------------------

describe("Text und ids", () => {
    it("maskiert, was XML zerreißt, und wirft weg, was es nicht kennt", () => {
        expect(maskiere('Fels & Fluss <"x">')).toBe("Fels &amp; Fluss &lt;&quot;x&quot;&gt;");
        expect(maskiere(null)).toBe("");
        expect(maskiere(undefined)).toBe("");
        expect(maskiere("a\tb\nc\rd")).toBe("a&#9;b&#10;c&#13;d");
        expect(maskiere("a\u0000b\u000bc￾d")).toBe("abcd");
        expect(maskiere("ungepaart \ud800 und \udc00")).toBe("ungepaart � und �");
        expect(maskiere("Drachen 🐉")).toBe("Drachen 🐉");
    });

    it("faltet Namen für ids: Umlaute ausgeschrieben, ß zu ss, der Rest ein Bindestrich", () => {
        expect(faltAscii("Reichsstraße Gareth–Wehrheim")).toBe("Reichsstrasse-Gareth-Wehrheim");
        expect(faltAscii("Fürstentum Kosch")).toBe("Fuerstentum-Kosch");
        expect(faltAscii("Tá'akîb")).toBe("Ta-akib");
        expect(faltAscii("  --  ")).toBe("");
        expect(faltAscii("Eigener Hof (alt)")).toBe("Eigener-Hof-alt");
    });

    it("maskiert für Illustrator wie dessen Namensregel (_xHH_) und lässt Buchstaben stehen", () => {
        expect(adobeMaskierung("Gareth")).toBe("Gareth");
        expect(adobeMaskierung("Alt Gareth")).toBe("Alt_x20_Gareth");
        expect(adobeMaskierung("Ärger")).toBe("Ärger");
        // U+00D7 (Mal) und U+00F7 (geteilt) stehen im Bereich À–ɏ, sind aber keine Namenszeichen.
        expect(adobeMaskierung("2×3")).toBe("2_xD7_3");
    });

    it("vergibt eine id aus Namen und Kennung, nie leer, nie mit Ziffer am Anfang, nie doppelt", () => {
        const gesehen = new Set<string>();
        const id = kennungFuer("Reichsstraße Gareth–Wehrheim", "p1042", "inkscape", gesehen);
        expect(id).toMatch(/^[A-Za-z0-9_-]+$/u);
        expect(id).toContain("p1042");
        expect(id).toContain("Reichsstrasse");
        expect(kennungFuer("", "", "inkscape", new Set())).toBe("objekt");
        expect(kennungFuer("1. Armee", "", "illustrator", new Set())).toMatch(/^x/u);
        expect(kennungFuer("12", "", "inkscape", new Set())).toBe("x12");
        for (const dialekt of ["inkscape", "illustrator"] as const) {
            const menge = new Set<string>();
            const a = kennungFuer("Gareth", "l1", dialekt, menge);
            const b = kennungFuer("Gareth", "l2", dialekt, menge);
            const c = kennungFuer("Gareth", "l2", dialekt, menge);
            expect(new Set([a, b, c]).size, dialekt).toBe(3);
            expect(a + b + c, dialekt).not.toMatch(/\s/u);
        }
        // Zweimal derselbe Name ohne Kennung bekommt eine Nummer.
        const ohne = new Set<string>();
        expect(kennungFuer("Hof", "", "inkscape", ohne)).toBe("Hof");
        expect(kennungFuer("Hof", "", "inkscape", ohne)).toBe("Hof-2");
    });

    it("schreibt Zahlen ohne Fließkommarauschen", () => {
        expect(zahlText(0.125 * 1.1)).toBe("0.1375");
        expect(zahlText(0.094)).toBe("0.094");
        expect(zahlText(1 / 3)).toBe("0.3333");
    });
});

// ---- Einstellungen ------------------------------------------------------------------------------------------------------

describe("Einstellungen", () => {
    it("bringt Unsinn in den Wertebereich und lässt Gültiges, wie es ist", () => {
        expect(bereinigeKartenSvgOptionen(KARTEN_SVG_ROH)).toEqual(KARTEN_SVG_ROH);
        expect(bereinigeKartenSvgOptionen(KARTEN_SVG_GLATT)).toEqual(KARTEN_SVG_GLATT);
        const wild = bereinigeKartenSvgOptionen({
            ...KARTEN_SVG_ROH,
            groessePx: 999_999.4,
            strichProzent: 0,
            spannung: -3,
            ebenen: ["orte", "orte", "nichts" as never, "wege"],
        });
        expect(wild.groessePx).toBe(200_000);
        expect(wild.strichProzent).toBe(5);
        expect(wild.spannung).toBe(0);
        expect(wild.ebenen).toEqual(["wege", "orte"]);
        expect(bereinigeKartenSvgOptionen({ ...KARTEN_SVG_ROH, groessePx: 300.6 }).groessePx).toBe(301);
        expect(bereinigeKartenSvgOptionen({ ...KARTEN_SVG_ROH, dialekt: "x" as never }).dialekt).toBe("inkscape");
    });

    it("kennt die sechs Ebenen in der Ordnung des Vertrags", () => {
        expect(KARTEN_SVG_EBENEN).toEqual(["landschaften", "gebiete", "wege", "kraftlinien", "orte", "beschriftungen"]);
    });
});

// ---- Farben und Vokabular gegen die Quellen -----------------------------------------------------------------------------

describe("Farben und Vokabular halten zu ihren Quellen", () => {
    interface Kartografie {
        types: Record<string, { layer: string }>;
        climateZones: Record<string, string>;
    }
    const kartografie = konfig("config/map-cartography/aventuria.json") as Kartografie;
    const wege = konfig("config/map-cartography/aventuria-paths.json") as {
        types: Record<string, { hidden?: boolean }>;
    };
    const kanon = konfig("config/design-canon/avesmaps.json") as { colour: Record<string, string> };

    it("🔴 Orte und Landmarken tragen die Töne des Kanons, wo die Karte dasselbe meint", () => {
        expect(ORTSFARBE).toBe(kanon.colour["markerWaypoint"]);
        expect(LANDMARKENFARBE).toBe(kanon.colour["markerSettlementSite"]);
    });

    it("🔴 kennt jede Landschaftsart und jede Klimazone der Kartentafel: weder Farbe noch Begriff fallen auf den Rückfall", () => {
        for (const [art, eintrag] of Object.entries(kartografie.types)) {
            if (art === "sonstiges") continue;
            expect(TYP_VOKABULAR[art], `Begriff ${art}`).toBeDefined();
            expect(flaechenFarbe(art, eintrag.layer), `Farbe ${art}`).not.toBe(FLAECHENFARBE_RUECKFALL);
        }
        for (const zone of Object.keys(kartografie.climateZones)) {
            expect(TYP_VOKABULAR[zone], `Begriff ${zone}`).toBeDefined();
            expect(flaechenFarbe(zone, "klima"), `Farbe ${zone}`).not.toBe(FLAECHENFARBE_RUECKFALL);
        }
    });

    it("gibt Owner-Tönen Vorrang und hält das Gewässernetz in EINEM Blau", () => {
        expect(flaechenFarbe("wald", "vegetation")).toBe("#589a64");
        expect(flaechenFarbe("gebirge", "topographie")).toBe("#acaea2");
        expect(flaechenFarbe("see", "topographie")).toBe("#4c89c6");
        expect(WEGFARBEN["Flussweg"]).toBe("#4c89c6");
        expect(WEGFARBEN["Bach"]).toBe(WEGFARBEN["Flussweg"]);
        expect(flaechenFarbe("see", "topographie")).toBe(WEGFARBEN["Flussweg"]);
        // Eine unbekannte Art fällt auf den Ton ihrer Ebene, eine unbekannte Ebene auf den Rückfall.
        expect(flaechenFarbe("neue_art", "vegetation")).toBe("#5f7d33");
        expect(flaechenFarbe("neue_art", "unbekannt")).toBe(FLAECHENFARBE_RUECKFALL);
    });

    it("kennt jede Wegart der Kartentafel, in der Zeichenreihenfolge der Karte (Wasser unten)", () => {
        for (const art of Object.keys(wege.types)) {
            expect(TYP_VOKABULAR[art], `Begriff ${art}`).toBeDefined();
            expect(WEGARTEN_ZEICHENREIHENFOLGE as readonly string[], art).toContain(art);
            expect(WEGFARBEN[art], `Farbe ${art}`).toBeDefined();
            expect(wegBreite(art)).toBeGreaterThan(0);
        }
        expect(WEGARTEN_ZEICHENREIHENFOLGE[0]).toBe("Seeweg");
        expect(WEGARTEN_ZEICHENREIHENFOLGE.at(-1)).toBe("Reichsstrasse");
        // Der Bach ist der halbe Fluss, in Kern und Mantel.
        expect(wegBreite("Bach")).toBe(wegBreite("Flussweg") / 2);
        expect(mantelBreite("Bach")).toBe(mantelBreite("Flussweg") / 2);
        expect(wegBreite("Unbekannt")).toBeGreaterThan(0);
    });

    it("🔴 führt die Landmarkenarten des Katalogs, in dessen Reihenfolge, mit Begriff", () => {
        expect([...LANDMARKENARTEN_REIHE]).toEqual([...LANDMARKEN_ARTEN]);
        for (const art of LANDMARKEN_ARTEN) expect(TYP_VOKABULAR[art]?.en, art).toBeTruthy();
    });

    it("beschreibt jede Ortsklasse des Schemas", () => {
        for (const klasse of ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude", "stadtviertel"]) {
            expect(TYP_VOKABULAR[klasse]?.de, klasse).toBeTruthy();
        }
    });
});
