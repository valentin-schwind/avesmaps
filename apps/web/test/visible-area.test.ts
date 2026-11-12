import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "../src/map/camera/camera.ts";
import { centreForOffset, locationAtOffset, shiftCenter } from "../src/map/camera/camera-math.ts";
import {
    centreInsets,
    constrainToVisible,
    coveredEdges,
    coveredInsets,
    coversWholeEdge,
    createVisibleArea,
    fenceInsets,
    fillZoom,
    isLayoutMove,
    leavesGap,
    mergeInsets,
    mitZielDeckung,
    SIDEBAR_SHARE,
    LAYOUT_EVENT,
    MIN_VISIBLE_SHARE,
    NO_INSETS,
    sameInsets,
    targetInsets,
    visibleCentre,
    visibleInsets,
    visibleRect,
} from "../src/map/camera/visible-area.ts";
import { AVENTURIA, fromRenderLngLat, renderBounds, toRenderLngLat } from "@avesmaps3d/shared";
import { createTravelerView, FOLLOW_AHEAD } from "../src/map/traveler-view.ts";

/**
 * Die sichtbare Kartenfläche (WI-0039, E1). Die Maße sind am echten Stand gemessen (2026-09-26):
 * Rechner 1280 × 720 mit dem Planer 350 px links, Telefon 412 × 839 mit 350 px Planer und der
 * schwebenden Leiste 12 + 76 px oben.
 */

const DESKTOP = { left: 0, top: 0, width: 1280, height: 720 };
const PHONE = { left: 0, top: 0, width: 412, height: 839 };

describe("Welche Panels die Karte verkleinern", () => {
    it("der offene Planer am Rechner nimmt links seine gemessene Breite", () => {
        const insets = visibleInsets(DESKTOP, [{ edge: "left", box: { left: 0, top: 10, width: 350, height: 700 } }]);
        expect(insets).toEqual({ ...NO_INSETS, left: 350 });
        expect(visibleCentre({ width: 1280, height: 720 }, insets)).toEqual({ x: 815, y: 360 });
    });

    it("🔴 auf breiten Schirmen ist der Planer eine Seitenleiste: die Mitte bleibt die Bildmitte (E4)", () => {
        const planer = [{ edge: "left" as const, box: { left: 0, top: 10, width: 350, height: 700 } }];
        const map = (width: number) => ({ left: 0, top: 0, width, height: 1080 });
        // Full HD bei 100 % und 125 % (Betreiber: „ja, 125 % soll auch zählen“), 2K und 4K: mittig.
        expect(visibleInsets(map(1920), planer)).toEqual(NO_INSETS);
        expect(visibleInsets(map(1536), planer)).toEqual(NO_INSETS);
        expect(visibleInsets(map(2560), planer)).toEqual(NO_INSETS);
        // Schmalere Fenster behalten die Mitte der freien Fläche; die Grenze liegt bei 1490 px.
        expect(visibleInsets(map(1280), planer)).toEqual({ ...NO_INSETS, left: 350 });
        expect(visibleInsets(map(1440), planer)).toEqual({ ...NO_INSETS, left: 350 });
        expect(visibleInsets(map(1489), planer)).toEqual({ ...NO_INSETS, left: 350 });
        expect(visibleInsets(map(1490), planer)).toEqual(NO_INSETS);
        expect(Math.ceil(350 / SIDEBAR_SHARE)).toBe(1490);
        // Freigehalten wird die Seitenleiste trotzdem - beim Einpassen.
        expect(coveredInsets(map(1920), planer)).toEqual({ ...NO_INSETS, left: 350 });
    });

    it("🔴 roh zählen beide Panels einander gegenüber, auch wenn sie zusammen mehr als 60 % decken (WI-0128 E7)", () => {
        // Planer links, Ortseditor rechts angedockt (960 px) auf Full HD: Für die Mitte fallen beide weg, der Hinflug braucht die Lücke.
        const karte = { left: 0, top: 0, width: 1920, height: 1080 };
        const beide = [
            { edge: "left" as const, box: { left: 0, top: 10, width: 350, height: 700 } },
            { edge: "right" as const, box: { left: 960, top: 0, width: 960, height: 1000 } },
        ];
        expect(coveredInsets(karte, beide)).toEqual(NO_INSETS);
        expect(coveredEdges(karte, beide)).toEqual({ ...NO_INSETS, left: 350, right: 960 });
    });

    it("die schwebende Leiste oben ist keine Seitenleiste - sie zählt auch wenn sie schmal ist", () => {
        const insets = visibleInsets({ left: 0, top: 0, width: 412, height: 2000 }, [
            { edge: "top", box: { left: 12, top: 12, width: 388, height: 76 } },
        ]);
        expect(insets).toEqual({ ...NO_INSETS, top: 88 });
    });

    it("🔴 am Telefon deckt der offene Planer die Karte - er verschiebt die Mitte nicht", () => {
        const insets = visibleInsets(PHONE, [{ edge: "left", box: { left: 0, top: 0, width: 350, height: 839 } }]);
        expect(insets).toEqual(NO_INSETS);
    });

    it("am Telefon nimmt die schwebende Leiste oben ihren Platz samt Abstand", () => {
        const insets = visibleInsets(PHONE, [{ edge: "top", box: { left: 12, top: 12, width: 388, height: 76 } }]);
        expect(insets).toEqual({ ...NO_INSETS, top: 88 });
    });

    it("ein Panel neben der Karte zählt nicht", () => {
        const insets = visibleInsets(DESKTOP, [{ edge: "left", box: { left: -400, top: 0, width: 350, height: 720 } }]);
        expect(insets).toEqual(NO_INSETS);
    });

    it("zwei Panels einander gegenüber dürfen zusammen nicht mehr als 60 % nehmen", () => {
        const insets = visibleInsets(DESKTOP, [
            { edge: "left", box: { left: 0, top: 0, width: 500, height: 720 } },
            { edge: "right", box: { left: 850, top: 0, width: 430, height: 720 } },
        ]);
        expect(1280 - insets.left - insets.right).toBeGreaterThanOrEqual(1280 * MIN_VISIBLE_SHARE);
    });

    it("die Fläche und ihre Mitte, auch mit MapLibres lückenhaftem `getPadding()`", () => {
        expect(visibleRect({ width: 1280, height: 720 }, { left: 350 })).toEqual({
            left: 350,
            top: 0,
            width: 930,
            height: 720,
        });
        expect(sameInsets({ left: 0 }, NO_INSETS)).toBe(true);
        expect(sameInsets({ left: 350 }, NO_INSETS)).toBe(false);
    });

    it("das Nachführen ist erkennbar - es hält den Playmode nicht an", () => {
        expect(isLayoutMove({ [LAYOUT_EVENT]: true })).toBe(true);
        expect(isLayoutMove({ originalEvent: {} })).toBe(false);
    });
});

describe("Die Füllstufe: wo die Karte eine Fläche gerade noch ganz füllt (WI-0265 B9c)", () => {
    const WELT = { west: -180, south: -85, east: 180, north: 85 };
    const breiteBei = (zoom: number): number => (512 * 2 ** zoom) / 1;

    it("die Welt (360° breit) füllt eine Fläche, sobald ihre Breite die größere Seite erreicht: 512 · 2^z = Kante", () => {
        // Nur die Breite: Die Welt ist in Mercator 360° breit und bei ±85° etwa so hoch wie breit.
        const breit = fillZoom(WELT, { width: 1024, height: 10 });
        expect(breiteBei(breit)).toBeCloseTo(1024, 6);
        // Das Größere aus Breiten- und Höhenpassung: eine hohe Fläche braucht die Stufe der Höhe.
        const hoch = fillZoom(WELT, { width: 10, height: 2048 });
        expect(hoch).toBeGreaterThan(breit);
        expect(fillZoom(WELT, { width: 1024, height: 2048 })).toBe(hoch);
        // Eine Stufe höher heißt doppelte Kante.
        expect(fillZoom(WELT, { width: 2048, height: 10 })).toBeCloseTo(breit + 1, 9);
    });

    it("🔴 dieselbe Stufe, auf die der Zaun hebt, wenn die Welt die sichtbare Fläche nicht füllt", () => {
        const flaeche = visibleRect({ width: 1280, height: 720 }, { ...NO_INSETS, left: 350 });
        const gezaunt = constrainToVisible(
            { lng: 0, lat: 0 },
            -2,
            WELT,
            { width: 1280, height: 720 },
            { left: 350 },
            { min: -2, max: 8 },
        );
        expect(gezaunt.zoom).toBeCloseTo(fillZoom(WELT, flaeche), 9);
    });

    it("Aventurien: Rechner und Telefon (freie Fläche) - das Telefon füllt schon auf einer tieferen Stufe, weil seine längere Seite kürzer ist", () => {
        const grenzen = renderBounds(AVENTURIA.coordinateSpace);
        const zaun = {
            west: grenzen.southWest.lng,
            south: grenzen.southWest.lat,
            east: grenzen.northEast.lng,
            north: grenzen.northEast.lat,
        };
        // Full HD: Karte 1920 × 1034, links der Planer (350), rechts das Editorpanel (400): frei bleiben 1170 × 1034.
        const rechner = fillZoom(zaun, { width: 1170, height: 1034 });
        // Pixel 7: 412 × 915, Panel weg.
        const telefon = fillZoom(zaun, { width: 412, height: 915 });
        // Das Bild der ganzen Karte ist bei einer Stufe so breit wie hoch (quadratisch): Die längere Seite entscheidet.
        const weltBreite = (zoom: number): number => 1920 * 2 ** (zoom - fillZoom(zaun, { width: 1920, height: 1 }));
        expect(weltBreite(rechner)).toBeCloseTo(1170, 6);
        expect(weltBreite(telefon)).toBeCloseTo(915, 6);
        expect(telefon).toBeLessThan(rechner);
        // Ohne Fläche füllt jede Stufe sie.
        expect(fillZoom(zaun, { width: 0, height: 0 })).toBe(Number.NEGATIVE_INFINITY);
    });

    it("mergeInsets: je Seite das Größere aus dem, was die Panels decken, und dem, was nach der Landung zusätzlich deckt", () => {
        expect(mergeInsets({ left: 350, right: 400 }, { left: 960 })).toEqual({
            top: 0,
            right: 400,
            bottom: 0,
            left: 960,
        });
        expect(mergeInsets({ left: 350 }, undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 350 });
    });
});

describe("Der Zaun weicht nur hinter Panels zurück, die ihre ganze Kante decken (WI-0265 B9d)", () => {
    // Am Stand gemessen (2026-11-01, Stage und Production): Die Leinwand liegt unter der Kopfleiste (46 px, 1169 hoch); der Routenplaner ist eine Karte von 350 × 610 Bildpunkten, das Editorpanel rechts deckt die ganze Höhe.
    const leinwand = (breite: number) => ({ left: 0, top: 46, width: breite, height: 1169 });
    const planer = { edge: "left" as const, box: { left: 0, top: 56, width: 350, height: 610 } };
    const editor = (breite: number) => ({
        edge: "right" as const,
        box: { left: breite - 400, top: 46, width: 400, height: 1169 },
    });

    it("ein Seitenpanel deckt seine Kante, wenn es die ganze Höhe deckt; die Karte des Planers deckt nur einen Teil", () => {
        expect(coversWholeEdge(leinwand(1440), editor(1440))).toBe(true);
        expect(coversWholeEdge(leinwand(1440), planer)).toBe(false);
        // Eine Leiste oben deckt die Kante, wenn sie die ganze Breite deckt (zwei Bildpunkte Spiel für die Rundung).
        const kopf = (breite: number) => ({
            edge: "top" as const,
            box: { left: 0, top: 46, width: breite, height: 60 },
        });
        expect(coversWholeEdge(leinwand(1440), kopf(1440))).toBe(true);
        expect(coversWholeEdge(leinwand(1440), kopf(1438))).toBe(true);
        expect(coversWholeEdge(leinwand(1440), kopf(1000))).toBe(false);
    });

    it("🔴 bei 1280 und 1440 px nimmt der Zaun nur das Editorpanel als Rand, nicht den halbhohen Planer; bei 2560 px (Seitenleisten) keinen", () => {
        for (const breite of [1280, 1440]) {
            const overlays = [planer, editor(breite)];
            // Der Bezug der Mitte nimmt beide (die Mitte der freien Fläche), der Zaun nur, was seine Kante ganz deckt.
            expect(visibleInsets(leinwand(breite), overlays)).toEqual({ ...NO_INSETS, left: 350, right: 400 });
            expect(fenceInsets(leinwand(breite), overlays)).toEqual({ ...NO_INSETS, right: 400 });
        }
        expect(fenceInsets(leinwand(2560), [planer, editor(2560)])).toEqual(NO_INSETS);
        expect(fenceInsets(leinwand(1440), [])).toEqual(NO_INSETS);
    });

    it("🔴 der Westrand der Karte kommt bis an den Leinwandrand, nicht nur an den Rand des Planers: Unter dem halbhohen Planer ist die Leinwand gefüllt", () => {
        const grenzen = renderBounds(AVENTURIA.coordinateSpace);
        const zaun = {
            west: grenzen.southWest.lng,
            south: grenzen.southWest.lat,
            east: grenzen.northEast.lng,
            north: grenzen.northEast.lat,
        };
        const spalte = (lng: number): number => (lng + 180) / 360;
        const flaeche = { width: 1440, height: 1169 };
        /** Wo der West- und der Ostrand der Karte auf der Leinwand stehen, wenn ihre Mitte in der Bildmitte liegt (MapLibres Mitte ist immer die Bildmitte). */
        const raender = (ergebnis: { center: { lng: number }; zoom: number }): { west: number; ost: number } => {
            const welt = 512 * 2 ** ergebnis.zoom;
            const mitte = flaeche.width / 2;
            return {
                west: mitte + (spalte(zaun.west) - spalte(ergebnis.center.lng)) * welt,
                ost: mitte + (spalte(zaun.east) - spalte(ergebnis.center.lng)) * welt,
            };
        };
        const mitteAventuriens = { lng: (zaun.west + zaun.east) / 2, lat: (zaun.south + zaun.north) / 2 };
        const zoomen = { min: -2, max: 8 };
        const overlays = [planer, editor(1440)];
        const neu = constrainToVisible(
            mitteAventuriens,
            -2,
            zaun,
            flaeche,
            fenceInsets(leinwand(1440), overlays),
            zoomen,
        );
        // Der Westrand ist am Leinwandrand oder links davon; der Ostrand hinter dem Editorpanel (ab x = 1040) oder weiter rechts.
        expect(raender(neu).west).toBeLessThanOrEqual(0.5);
        expect(raender(neu).ost).toBeGreaterThanOrEqual(1040 - 0.5);
        // Gegenprobe: Bis B9c weichte der Westrand hinter den Planer zurück (Bezug der Mitte, links 350): Dann blieben unter dem Planer Bildpunkte leer.
        const alt = constrainToVisible(
            mitteAventuriens,
            -2,
            zaun,
            flaeche,
            visibleInsets(leinwand(1440), overlays),
            zoomen,
        );
        expect(raender(alt).west).toBeGreaterThan(50);
    });
});

describe("Der Kartenzaun misst an der sichtbaren Fläche", () => {
    // Die ganze Welt, wie Aventurien in Renderkoordinaten; die Breite in Bildpunkten bei Zoom z ist 512 · 2^z.
    const WORLD = { west: -180, south: -85, east: 180, north: 85 };
    const ZOOMS = { min: -2, max: 8 };
    /** Wo der Ostrand auf dem Bildschirm steht, wenn die Mitte bei `centreX` liegt. */
    const eastEdge = (result: { center: { lng: number }; zoom: number }, centreX: number): number =>
        centreX + ((180 - result.center.lng) / 360) * 512 * 2 ** result.zoom;

    // Seit WI-0218 steht die Mitte der Karte in der Bildmitte (x = 640), auch bei offenem Planer.
    const CANVAS = { width: 1280, height: 720 };
    const PLANER = { ...NO_INSETS, left: 350 };
    /** Wo der Westrand auf dem Bildschirm steht, wenn die Mitte bei `centreX` liegt. */
    const westEdge = (result: { center: { lng: number }; zoom: number }, centreX: number): number =>
        centreX - ((result.center.lng + 180) / 360) * 512 * 2 ** result.zoom;

    it("🔴 bei offenem Planer kommt der Ostrand bis an den Bildrand, nicht nur bis 175 px davor", () => {
        const fenced = constrainToVisible({ lng: 179, lat: 0 }, 4, WORLD, CANVAS, PLANER, ZOOMS);
        expect(eastEdge(fenced, 640)).toBeCloseTo(1280, 6);
    });

    it("🔴 und der Westrand bis an den Rand des Planers, nicht darunter (WI-0218: die Fläche reicht je Seite verschieden weit)", () => {
        const fenced = constrainToVisible({ lng: -179, lat: 0 }, 4, WORLD, CANVAS, PLANER, ZOOMS);
        expect(westEdge(fenced, 640)).toBeCloseTo(350, 6);
    });

    it("ohne Panel wie MapLibres eigener Zaun: eine halbe Canvasbreite", () => {
        const fenced = constrainToVisible({ lng: 179, lat: 0 }, 4, WORLD, CANVAS, NO_INSETS, ZOOMS);
        expect(eastEdge(fenced, 640)).toBeCloseTo(1280, 6);
    });

    it("was weit genug innen liegt, bleibt, wo es ist", () => {
        const fenced = constrainToVisible({ lng: 10, lat: 20 }, 4, WORLD, CANVAS, PLANER, ZOOMS);
        expect(fenced.center.lng).toBeCloseTo(10, 9);
        expect(fenced.center.lat).toBeCloseTo(20, 9);
        expect(fenced.zoom).toBe(4);
    });

    it("passt die Welt nicht mehr hinein, rückt der Zoom heran, bis sie die sichtbare Fläche füllt - mittig in ihr", () => {
        const fenced = constrainToVisible({ lng: 0, lat: 0 }, 0, WORLD, CANVAS, PLANER, ZOOMS);
        expect(512 * 2 ** fenced.zoom).toBeCloseTo(930, 6);
        // Die Welt füllt die 930 px rechts vom Planer: West bei 350, Ost bei 1280.
        expect(westEdge(fenced, 640)).toBeCloseTo(350, 6);
        expect(eastEdge(fenced, 640)).toBeCloseTo(1280, 6);
    });
});

describe("Verschieben mit den Tasten: auf der flachen Karte gerechnet", () => {
    it("nach rechts heißt nach Osten, solange Norden oben ist", () => {
        const [lng, lat] = shiftCenter([10, 20], 100, 0, 5, 0);
        expect(lng).toBeGreaterThan(10);
        expect(lat).toBeCloseTo(20, 9);
    });

    it("🪤 ist Osten oben (Drehung 90°), heißt nach rechts nach Süden", () => {
        const [lng, lat] = shiftCenter([10, 20], 100, 0, 5, 90);
        expect(lng).toBeCloseTo(10, 9);
        expect(lat).toBeLessThan(20);
    });

    it("dieselben Bildpunkte sind eine Stufe näher halb so weit", () => {
        const far = shiftCenter([10, 20], 100, 0, 5, 0);
        const near = shiftCenter([10, 20], 100, 0, 6, 0);
        expect(near[0] - 10).toBeCloseTo((far[0] - 10) / 2, 9);
    });

    it("hin und zurück ist wieder dieselbe Stelle", () => {
        const [lng, lat] = shiftCenter(shiftCenter([10, 20], 70, -40, 6, 33), -70, 40, 6, 33);
        expect(lng).toBeCloseTo(10, 9);
        expect(lat).toBeCloseTo(20, 9);
    });
});

describe("Reise folgen (Playmode) in der sichtbaren Fläche", () => {
    it("🔴 in 3D steht der Pfeil genau unter der Mitte der freien Fläche - gemessen an der sichtbaren Höhe", () => {
        // Seit WI-0053 gerechnet statt per unproject (über Gelände traf der Strahl den Hang): Der Blickraum
        // ist der Anteil der SICHTBAREN Höhe, MapLibres Abstand zur Mitte hängt an der ganzen Höhe. Das Ziel der Folge rückt die
        // Kamera in die Mitte der freien Fläche (`camera.ts`, seit WI-0218 ohne MapLibres padding); den Bezug nennt sie (`insets`).
        // 🪤 Der Fluchtpunkt bleibt in der Bildmitte: Ein Punkt voraus in Blickrichtung ließ den Pfeil 30 px seitlich stehen (WI-0218
        // Nachbesserung). Geprüft wird darum, wo der Pfeil im Bild steht, wenn die Kamera das Ziel dorthin gerückt hat.
        const centres: [number, number][] = [];
        const map = {
            getCanvas: () => ({ clientWidth: 1280, clientHeight: 720 }),
            getZoom: () => 7,
            getVerticalFieldOfView: () => 36.87,
        } as unknown as MapLibreMap;
        const camera = {
            state: () => ({ bearing: 0, pitch: 45, zoom: 7 }),
            insets: () => ({ ...NO_INSETS, left: 350, top: 88 }),
            follow: (centre: [number, number]) => centres.push(centre),
        } as unknown as Camera;
        createTravelerView(
            () => map,
            () => camera,
        ).follow({ x: 500, y: 500, heading: 90 }, true, 90);
        const visibleHeight = 720 - 88;
        // Die Mitte der freien Fläche: 175 px rechts der Bildmitte (Planer), 44 px darunter (Leiste oben).
        const free = { dx: 350 + (1280 - 350) / 2 - 640, dy: 88 + visibleHeight / 2 - 360 };
        const view = { zoom: 7, bearing: 90, pitch: 45 };
        const target = centres[0] as [number, number];
        // Was `camera.follow` daraus macht: die Mitte der Karte, bei der das Ziel in der Mitte der freien Fläche steht.
        const mapCentre = centreForOffset(target, free.dx, free.dy, view, 36.87, 720);
        const arrow = locationAtOffset(mapCentre, free.dx, free.dy + visibleHeight * FOLLOW_AHEAD, view, 36.87, 720);
        const expected = toRenderLngLat(AVENTURIA.coordinateSpace, { x: 500, y: 500 });
        expect(arrow[0]).toBeCloseTo(expected.lng, 9);
        expect(arrow[1]).toBeCloseTo(expected.lat, 9);
        // Der Blick geht nach Osten: Das Ziel liegt vor dem Pfeil.
        const centre = fromRenderLngLat(AVENTURIA.coordinateSpace, { lng: target[0], lat: target[1] });
        expect(centre.x).toBeGreaterThan(500);
        expect(FOLLOW_AHEAD).toBe(0.12);
    });
});

describe("🔴 WI-0218 Nachbesserung: was ein Ziel nicht verdecken darf (`targetInsets`)", () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Ein Panel, wie `measureOverlays` es liest: gemeldet, sichtbar, an seiner Stelle ohne `transform`. */
    const panel = (edge: string, box: { left: number; width: number }) => ({
        getAttribute: () => edge,
        closest: () => null,
        getClientRects: () => [box],
        offsetLeft: box.left,
        offsetTop: 0,
        offsetWidth: box.width,
        offsetHeight: 1080,
        offsetParent: null,
    });
    /** Eine Karte dieser Breite mit Planer (350 px links) und angedocktem Fenster (960 px rechts). */
    function karte(width: number): MapLibreMap {
        class Still {
            observe(): void {}
            disconnect(): void {}
        }
        vi.stubGlobal("ResizeObserver", Still);
        vi.stubGlobal("MutationObserver", Still);
        const container = { offsetLeft: 0, offsetTop: 0, offsetWidth: width, offsetHeight: 1080, offsetParent: null };
        const map = {
            getContainer: () => container,
            getCanvas: () => ({ clientWidth: width, clientHeight: 1080 }),
        } as unknown as MapLibreMap;
        const panels = [panel("left", { left: 0, width: 350 }), panel("right", { left: width - 960, width: 960 })];
        createVisibleArea(map, { querySelectorAll: () => panels } as unknown as HTMLElement).sync();
        return map;
    }

    it("Full HD: die Lücke zwischen Planer und Fenster, auch wo der Bezug der Mitte den Planer als Seitenleiste nicht zählt", () => {
        const map = karte(1920);
        expect(centreInsets(map)).toEqual({ ...NO_INSETS, right: 960 });
        expect(targetInsets(map)).toEqual({ ...NO_INSETS, left: 350, right: 960 });
    });

    it("1280 px: zwischen Planer und Fenster bleibt nichts, es gilt der Bezug der Mitte", () => {
        const map = karte(1280);
        expect(leavesGap({ width: 1280, height: 1080 }, { left: 350, right: 960 })).toBe(false);
        expect(targetInsets(map)).toEqual(centreInsets(map));
    });

    it("eine Lücke braucht mehr als zweimal den Rand des Einpassens", () => {
        expect(leavesGap({ width: 1280, height: 720 }, { right: 1200 })).toBe(false);
        expect(leavesGap({ width: 1280, height: 720 }, { right: 1199 })).toBe(true);
        expect(leavesGap({ width: 1280, height: 720 }, { top: 656 })).toBe(false);
    });
});

describe("🔴 WI-0218 §10: der Kameraring deckt das ZIEL eines Hinflugs (`mitZielDeckung`)", () => {
    /** 1280 × 720 mit Planer (350 px) und angedocktem Fenster nach dem Einzug (560 px); der Ring, wie gemessen (588 bis 678, 268 bis 385). */
    const SCHIRM = { width: 1280, height: 720 };
    const LUECKE = { ...NO_INSETS, left: 350, right: 560 };
    const RING = { left: 588, top: 268, width: 90, height: 117 };

    it("🔴 der Ring am rechten Rand der Lücke rückt die rechte Kante an seine linke Seite", () => {
        expect(mitZielDeckung(SCHIRM, LUECKE, [RING])).toEqual({ ...LUECKE, right: 692 });
    });

    it("ein Kasten außerhalb der freien Fläche (unter dem Fenster) ändert nichts", () => {
        expect(mitZielDeckung(SCHIRM, LUECKE, [{ ...RING, left: 900 }])).toEqual(LUECKE);
    });

    it("bliebe keine Lücke, gilt der Kasten nicht", () => {
        const breit = { left: 360, top: 0, width: 350, height: 720 };
        expect(mitZielDeckung(SCHIRM, LUECKE, [breit])).toEqual(LUECKE);
    });

    it("am Telefon unten in der Mitte: die untere Kante, weil sie am wenigsten kostet", () => {
        const telefon = { width: 375, height: 812 };
        expect(mitZielDeckung(telefon, NO_INSETS, [{ left: 140, top: 700, width: 90, height: 90 }])).toEqual({
            ...NO_INSETS,
            bottom: 112,
        });
    });
});

describe("🔴 Nachmessen nur bei echter Änderung (WI-0249 Leistung, 2026-10-26)", () => {
    afterEach(() => vi.unstubAllGlobals());

    /**
     * Problemfall: `watchOverlays` meldete bei jedem Nachmessen alle Elemente ab und neu an; ein ResizeObserver meldet jedes neu angemeldete
     * Element im nächsten Bild einmal, also maß die Fläche in jedem Bild nach, auch in Ruhe (gemessen 303 Rückrufe in 5 s).
     */
    function aufbau() {
        const bilder: (() => void)[] = [];
        let groesse: (() => void) | undefined;
        let baum: (() => void) | undefined;
        const zaehler = { observe: 0, unobserve: 0, disconnect: 0 };
        vi.stubGlobal(
            "ResizeObserver",
            class {
                constructor(rueckruf: () => void) {
                    groesse = rueckruf;
                }
                observe(): void {
                    zaehler.observe++;
                }
                unobserve(): void {
                    zaehler.unobserve++;
                }
                disconnect(): void {
                    zaehler.disconnect++;
                }
            },
        );
        vi.stubGlobal(
            "MutationObserver",
            class {
                constructor(rueckruf: () => void) {
                    baum = rueckruf;
                }
                observe(): void {}
                disconnect(): void {}
            },
        );
        vi.stubGlobal("requestAnimationFrame", (f: () => void) => bilder.push(f));
        vi.stubGlobal("cancelAnimationFrame", () => undefined);
        const panel = (edge: string, left: number, width: number) => ({
            getAttribute: () => edge,
            closest: () => null,
            getClientRects: () => [{}],
            offsetLeft: left,
            offsetTop: 0,
            offsetWidth: width,
            offsetHeight: 720,
            offsetParent: null,
        });
        const panels = [panel("left", 0, 350), panel("right", 1280 - 400, 400)];
        const container = { offsetLeft: 0, offsetTop: 0, offsetWidth: 1280, offsetHeight: 720, offsetParent: null };
        const map = {
            getContainer: () => container,
            getCanvas: () => ({ clientWidth: 1280, clientHeight: 720 }),
            getCenter: () => ({ lng: 0, lat: 0 }),
            // Nur für den ersten Blick beim Laden (`settle`): Er rückt in die freie Fläche.
            getZoom: () => 4,
            getBearing: () => 0,
            getPitch: () => 0,
            getVerticalFieldOfView: () => 36.87,
            jumpTo: () => undefined,
        } as unknown as MapLibreMap;
        const flaeche = createVisibleArea(map, { querySelectorAll: () => panels } as unknown as HTMLElement);
        const naechstesBild = (): void => {
            const jetzt = bilder.splice(0);
            for (const f of jetzt) f();
        };
        return {
            flaeche,
            panels,
            panel,
            zaehler,
            bilder,
            naechstesBild,
            groesse: () => groesse!(),
            baum: () => baum!(),
        };
    }

    it("🔴 nach dem ersten Melden misst die Fläche nicht in jedem Bild nach: kein neues Anmelden, kein weiteres Bild", () => {
        const t = aufbau();
        t.flaeche.settle();
        // Die Karte und zwei Panels.
        expect(t.zaehler.observe).toBe(3);
        // Der ResizeObserver meldet die neu angemeldeten Elemente einmal: EIN Nachmessen.
        t.groesse();
        expect(t.bilder).toHaveLength(1);
        t.naechstesBild();
        expect(t.zaehler).toEqual({ observe: 3, unobserve: 0, disconnect: 0 });
        // Vorher meldete dieses Nachmessen alles neu an, und im nächsten Bild kam der Rückruf wieder; jetzt ist Ruhe.
        expect(t.bilder).toHaveLength(0);
        expect(t.flaeche.insets()).toEqual({ ...NO_INSETS, left: 350, right: 400 });
    });

    it("ein neues Panel wird angemeldet, ein verschwundenes abgemeldet; die Fläche folgt", () => {
        const t = aufbau();
        t.flaeche.settle();
        t.panels.push(t.panel("top", 0, 1280));
        t.baum();
        t.naechstesBild();
        expect(t.zaehler.observe).toBe(4);
        t.panels.splice(0, 1);
        t.baum();
        t.naechstesBild();
        expect(t.zaehler.unobserve).toBe(1);
        expect(t.flaeche.insets().left).toBe(0);
    });
});
