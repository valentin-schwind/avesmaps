import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import type { Punkt } from "../map/geometrie/geometrie";
import { LABEL_FONT } from "../map/place-layers";
import { istKamm, punktLage, wasserTeilVon, type GebirgsNetz, type NetzStelle } from "./kamm-netz";
import type { HoehenMarke } from "./kamm-netz-hoehen";
import { KEIN_FLUSS, type FlussDaten } from "./kamm-netz-fluss";
import { KEIN_GEWAESSER, type Gewaesser } from "./kamm-netz-wasser";

/**
 * Die Lage des Gebirgsnetzes auf der Karte, solange „Kämme zeichnen“ läuft (WI-0245 D2): Kämme als Linien (Hauptkamm kräftig, Nebenkamm
 * gestrichelt, Tal in der Farbe der Flüsse), Nebengipfel und Mulden als Punkte, die Auswahl gelb, gewählte Stützpunkte als gelber Punkt
 * über dem Anfasser, und darüber die Höhen (WI-0249, je Punkt eine Zahl: eigene kräftig, Gelände blass). Aus `kamm-netz-anbindung.ts` gelöst.
 *
 * **Die Auswahl liegt über den Griffen des Geometrie-Moduls** (Betreiber 2026-10-25: „was sie machen kann, wenn ich einen gipfel, kamm oder
 * kammpunkt markiere: gelb füllen“): Dessen Anfasser (weiß mit rotem Saum) und Kanten (rot) lägen sonst über dem Gelb der Netz-Ebenen, und
 * eine Auswahl wäre nicht zu sehen. Darum eigene Ebenen mit nur den gewählten Teilen, die `zeichneNetzLage` bei jeder Auswahl nach oben holt.
 *
 * **Flüsse und Seen** (WI-0259, OPS-071): Im Werkzeug „Wählen“ liegen über den Anfassern des Geometrie-Moduls die Zeichen der Gewässer
 * (`FlussDaten`, gerechnet in `kamm-netz-fluss.ts`): jeder Stützpunkt hohl (Höhe des Geländes) oder gefüllt (eigene Höhe), am Platz eines Sees ein
 * Griff ↕, vor einem steigenden Punkt ein „!“ in den Warnfarben, an den Enden des Flusswegs „Quelle“ und „Mündung“. Sie teilen sich eine Quelle
 * und werden wie die Auswahl nach oben geholt, wenn etwas unter ihnen liegt. Die Linie selbst (Catmull-Rom wie auf der Karte) zeichnet das
 * Geometrie-Modul (`flussKurve` in `arten.ts`).
 */
const QUELLE = "editor-gebirgsnetz";
const LINIEN = "editor-gebirgsnetz-kaemme";
const PUNKTE = "editor-gebirgsnetz-gipfel";
const HOEHEN_QUELLE = "editor-gebirgsnetz-hoehen";
const HOEHEN = "editor-gebirgsnetz-hoehen";
/** Nur die gewählten Teile, gelb über den Griffen des Geometrie-Moduls. */
const AUSWAHL_QUELLE = "editor-gebirgsnetz-auswahl";
const AUSWAHL_LINIE = "editor-gebirgsnetz-auswahl-linie";
const AUSWAHL_PUNKT = "editor-gebirgsnetz-auswahl-punkt";
/** Die Flüsse und Seen im Werkzeug „Wählen“ (WI-0259): Stützpunkte (gefüllt mit eigener Höhe, sonst hohl), Griff ↕ am See, „!“, „Quelle“ und „Mündung“. */
const FLUSS_QUELLE = "editor-gebirgsnetz-fluss";
const FLUSS_PUNKT = "editor-gebirgsnetz-fluss-punkt";
const FLUSS_SEE = "editor-gebirgsnetz-fluss-see";
const FLUSS_WARN = "editor-gebirgsnetz-fluss-warn";
const FLUSS_WARN_ZEICHEN = "editor-gebirgsnetz-fluss-warn-zeichen";
const FLUSS_ENDE = "editor-gebirgsnetz-fluss-ende";
const SEE_GRIFF = "editor-gebirgsnetz-see-griff";
const SEE_GRIFF_GEWAEHLT = "editor-gebirgsnetz-see-griff-gewaehlt";
/** Von unten nach oben: Auswahl, die Zeichen der Flüsse, die Höhen. Die Griffe des Geometrie-Moduls liegen darunter. */
const OBEN = [
    AUSWAHL_LINIE,
    AUSWAHL_PUNKT,
    FLUSS_PUNKT,
    FLUSS_SEE,
    FLUSS_WARN,
    FLUSS_WARN_ZEICHEN,
    FLUSS_ENDE,
    HOEHEN,
] as const;
/** Das „!“ sitzt schräg unter dem Punkt (rechts unten, wie auf der Probierseite), damit es die Zahl darüber frei lässt. */
const WARN_VERSATZ: [number, number] = [15, 15];

export interface NetzFarben {
    kamm: string;
    tal?: string;
    gewaehlt: string;
    rand: string;
    text?: string;
    blass?: string;
}

const space = AVENTURIA.coordinateSpace;
const lngLat = (p: Punkt): [number, number] => {
    const render = toRenderLngLat(space, p);
    return [render.lng, render.lat];
};

/** Linien und Punkte des Netzes mit der Auswahl als GeoJSON. */
function netzDaten(n: GebirgsNetz, auswahl: readonly NetzStelle[], gew: Gewaesser) {
    const teilGewaehlt = (nr: number): boolean => auswahl.some((s) => s.nr === nr);
    const stuetzen = auswahl.filter(
        (s) => s.index !== undefined && (istKamm(n, s.nr) || wasserTeilVon(n, gew, s.nr) !== undefined),
    );
    return {
        type: "FeatureCollection" as const,
        features: [
            ...n.kaemme.map((kamm, nr) => ({
                type: "Feature" as const,
                properties: { rang: kamm.rang, gewaehlt: teilGewaehlt(nr) },
                geometry: { type: "LineString" as const, coordinates: kamm.punkte.map(([x, y]) => lngLat({ x, y })) },
            })),
            ...n.nebengipfel.map((g, i) => ({
                type: "Feature" as const,
                properties: { gewaehlt: teilGewaehlt(n.kaemme.length + i) },
                geometry: { type: "Point" as const, coordinates: lngLat({ x: g.x, y: g.y }) },
            })),
            ...(n.mulden ?? []).map((g, i) => ({
                type: "Feature" as const,
                properties: { rang: "tal", gewaehlt: teilGewaehlt(n.kaemme.length + n.nebengipfel.length + i) },
                geometry: { type: "Point" as const, coordinates: lngLat({ x: g.x, y: g.y }) },
            })),
            // Gewählte Stützpunkte (WI-0249 P9): ein Punkt in der Farbe der Auswahl über dem Anfasser.
            ...stuetzen.flatMap((s) => {
                const at = punktLage(n, { nr: s.nr, index: s.index! }, gew);
                return at === undefined
                    ? []
                    : [
                          {
                              type: "Feature" as const,
                              properties: { gewaehlt: true },
                              geometry: { type: "Point" as const, coordinates: lngLat(at) },
                          },
                      ];
            }),
        ],
    };
}

/**
 * Die gewählten Teile: ein ganzer Kamm (Auswahl ohne `index`) als Linie, jeder gewählte Stützpunkt, Nebengipfel und jede Mulde als Punkt.
 * Ein gewählter Stützpunkt färbt nur sich, nicht den ganzen Kamm.
 */
function auswahlDaten(n: GebirgsNetz, auswahl: readonly NetzStelle[], gew: Gewaesser) {
    const linien = new Set<number>();
    const punkte = new Map<string, Punkt>();
    // Ein ganzes Stück Fluss (WI-0249) ist gewählt wie ein ganzer Kamm: als Linie.
    const wasserLinien: Punkt[][] = [];
    for (const s of auswahl) {
        const wasser = wasserTeilVon(n, gew, s.nr);
        if (wasser !== undefined && s.index === undefined && wasser.punkte.length > 1) {
            wasserLinien.push([...wasser.punkte]);
            continue;
        }
        if (istKamm(n, s.nr) && s.index === undefined) {
            linien.add(s.nr);
            continue;
        }
        const at = punktLage(n, { nr: s.nr, index: s.index ?? 0 }, gew);
        if (at !== undefined) punkte.set(`${String(s.nr)}:${String(s.index ?? 0)}`, at);
    }
    return {
        type: "FeatureCollection" as const,
        features: [
            ...[...linien].map((nr) => ({
                type: "Feature" as const,
                properties: { rang: n.kaemme[nr]!.rang },
                geometry: {
                    type: "LineString" as const,
                    coordinates: n.kaemme[nr]!.punkte.map(([x, y]) => lngLat({ x, y })),
                },
            })),
            ...wasserLinien.map((linie) => ({
                type: "Feature" as const,
                properties: { rang: "tal" },
                geometry: { type: "LineString" as const, coordinates: linie.map(lngLat) },
            })),
            ...[...punkte.values()].map((at) => ({
                type: "Feature" as const,
                properties: {},
                geometry: { type: "Point" as const, coordinates: lngLat(at) },
            })),
        ],
    };
}

/**
 * Zeichnet Netz und Höhen (legt Quellen und Ebenen beim ersten Mal an). Wirft, solange der Stil keine Änderungen annimmt; der Aufrufer
 * versucht es mit `styledata` erneut. `sichtbar`: „Kämme anzeigen“ (Betreiber 2026-10-21), gilt für Netz und Höhen.
 */
export function zeichneNetzLage(
    map: MapLibreMap,
    netz: GebirgsNetz,
    auswahl: readonly NetzStelle[],
    hoehen: { type: "FeatureCollection"; features: HoehenMarke[] },
    farben: NetzFarben,
    sichtbar: boolean,
    /** Flüsse und Seen (WI-0249): Ihre gewählten Punkte und Stücke stehen gelb wie die des Netzes. */
    gew: Gewaesser = KEIN_GEWAESSER,
    /** Die Zeichen der Flüsse und Seen im Werkzeug „Wählen“ (WI-0259); sonst keine. */
    fluss: FlussDaten = KEIN_FLUSS,
): void {
    const quelle = map.getSource(QUELLE) as GeoJSONSource | undefined;
    const daten = netzDaten(netz, auswahl, gew);
    if (quelle === undefined) map.addSource(QUELLE, { type: "geojson", data: daten });
    else quelle.setData(daten);
    const hoehenQuelle = map.getSource(HOEHEN_QUELLE) as GeoJSONSource | undefined;
    if (hoehenQuelle === undefined) map.addSource(HOEHEN_QUELLE, { type: "geojson", data: hoehen });
    else hoehenQuelle.setData(hoehen);
    const auswahlQuelle = map.getSource(AUSWAHL_QUELLE) as GeoJSONSource | undefined;
    const gewaehlteTeile = auswahlDaten(netz, auswahl, gew);
    if (auswahlQuelle === undefined) map.addSource(AUSWAHL_QUELLE, { type: "geojson", data: gewaehlteTeile });
    else auswahlQuelle.setData(gewaehlteTeile);
    const { kamm, tal = kamm, gewaehlt, rand, text = kamm, blass = kamm } = farben;
    const farbe = [
        "case",
        ["get", "gewaehlt"],
        gewaehlt,
        ["==", ["get", "rang"], "tal"],
        tal,
        kamm,
    ] as unknown as string;
    if (map.getLayer(LINIEN) === undefined)
        map.addLayer({
            id: LINIEN,
            type: "line",
            source: QUELLE,
            filter: ["==", ["geometry-type"], "LineString"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
                "line-color": farbe,
                "line-width": ["case", ["==", ["get", "rang"], "haupt"], 3.5, 2],
                "line-dasharray": [
                    "case",
                    ["==", ["get", "rang"], "haupt"],
                    ["literal", [1, 0]],
                    ["literal", [2, 1.5]],
                ],
            },
        });
    if (map.getLayer(PUNKTE) === undefined)
        map.addLayer({
            id: PUNKTE,
            type: "circle",
            source: QUELLE,
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
                "circle-radius": 5,
                "circle-color": farbe,
                "circle-stroke-width": 1.5,
                "circle-stroke-color": rand,
            },
        });
    // Die Auswahl: über den Kanten (4,2 px, rot) und den Anfassern (Halbmesser 6 plus Saum 2,5, bei den Enden 7 plus 3) des Geometrie-Moduls.
    if (map.getLayer(AUSWAHL_LINIE) === undefined)
        map.addLayer({
            id: AUSWAHL_LINIE,
            type: "line",
            source: AUSWAHL_QUELLE,
            filter: ["==", ["geometry-type"], "LineString"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": gewaehlt, "line-width": 6 },
        });
    if (map.getLayer(AUSWAHL_PUNKT) === undefined)
        map.addLayer({
            id: AUSWAHL_PUNKT,
            type: "circle",
            source: AUSWAHL_QUELLE,
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
                "circle-radius": 8,
                "circle-color": gewaehlt,
                "circle-stroke-width": 2,
                "circle-stroke-color": rand,
            },
        });
    // Hell und dunkel: Die Farben folgen dem Stand des Themas bei jedem Zeichnen.
    map.setPaintProperty(AUSWAHL_LINIE, "line-color", gewaehlt);
    map.setPaintProperty(AUSWAHL_PUNKT, "circle-color", gewaehlt);
    map.setPaintProperty(AUSWAHL_PUNKT, "circle-stroke-color", rand);
    // 🪤 Keine Kollision (MapLibre-Fallen): Jede Höhe steht, auch über Namen und Nachbarn, und verdrängt selbst nichts.
    if (map.getLayer(HOEHEN) === undefined)
        map.addLayer({
            id: HOEHEN,
            type: "symbol",
            source: HOEHEN_QUELLE,
            layout: {
                "text-field": ["get", "text"] as unknown as string,
                "text-font": [LABEL_FONT],
                "text-size": 13,
                "text-anchor": "bottom",
                "text-offset": [0, -0.7],
                "text-allow-overlap": true,
                "text-ignore-placement": true,
            },
            paint: {
                "text-color": ["case", ["get", "eigen"], text, blass] as unknown as string,
                "text-halo-color": rand,
                "text-halo-width": 1.5,
            },
        });
    for (const ebene of [LINIEN, PUNKTE, HOEHEN])
        map.setLayoutProperty(ebene, "visibility", sichtbar ? "visible" : "none");
    zeichneFluss(map, fluss, farben);
    // Die Griffe des Geometrie-Moduls kommen mit dem Werkzeug und liegen dann über allem, was früher hier angelegt wurde: Eine Auswahl holt
    // ihre Ebenen (und die Höhen darüber) nach oben, ebenso die Zeichen der Flüsse (WI-0259: Ihre Punkte decken die Anfasser des Moduls,
    // gefüllt oder hohl). Die Auswahl zeigt sich auch bei ausgeblendeten Kämmen, wie die Griffe selbst.
    // 🪤 Nur wenn sie nicht schon oben liegen: `moveLayer` ändert den Stil auch ohne neue Lage (MapLibre setzt `_changed`), und jedes
    // `styledata` danach lässt die übrigen Schichten der Karte nachsehen (Vorschau, verborgene Flächen); beim Ziehen geschah das je
    // Mausbewegung (WI-0249, Leistung).
    const flussZeichen = fluss.punkte.length + fluss.seen.length > 0;
    if ((gewaehlteTeile.features.length > 0 || flussZeichen) && !obenAuf(map))
        for (const ebene of OBEN) map.moveLayer(ebene);
}

/** Liegen Auswahl, Zeichen der Flüsse und Höhen schon ganz oben, in dieser Folge? */
function obenAuf(map: MapLibreMap): boolean {
    const folge = map.getLayersOrder();
    return OBEN.every((ebene, i) => folge[folge.length - OBEN.length + i] === ebene);
}

/** Die Farben der Flüsse aus dem Thema (hell und dunkel folgen bei jedem Zeichnen). */
function flussFarben() {
    const stil = getComputedStyle(document.documentElement);
    const f = (name: string): string => stil.getPropertyValue(name).trim();
    return {
        fluss: f("--color-profile-river"),
        meer: f("--color-profile-sea"),
        panel: f("--color-panel"),
        text: f("--color-text-strong"),
        gewaehlt: f("--color-map-selection"),
        warnFlaeche: f("--color-warning-soft"),
        warnRand: f("--color-warning-soft-border"),
        warnText: f("--color-warning-soft-text"),
    };
}

/** Das Griffbild am See: ein runder Knopf mit ↕ (die Pfeile des Zeichens „Höhe“ der Leiste), gewählt mit gelbem Ring. */
function seeGriffBild(
    farben: { meer: string; panel: string; gewaehlt: string },
    gewaehlt: boolean,
): { width: number; height: number; data: Uint8ClampedArray } | undefined {
    if (typeof document === "undefined") return undefined;
    const px = 26;
    const fein = 2;
    const leinwand = document.createElement("canvas");
    leinwand.width = px * fein;
    leinwand.height = px * fein;
    const ctx = leinwand.getContext("2d");
    if (ctx === null) return undefined;
    ctx.scale(fein, fein);
    const mitte = px / 2;
    if (gewaehlt) {
        ctx.beginPath();
        ctx.arc(mitte, mitte, 12.5, 0, Math.PI * 2);
        ctx.fillStyle = farben.gewaehlt;
        ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(mitte, mitte, 10, 0, Math.PI * 2);
    ctx.fillStyle = farben.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = farben.meer;
    ctx.stroke();
    // Das Zeichen „Höhe“ (16 × 16, Strich 1,5) auf 14 Bildpunkte.
    const k = 14 / 16;
    ctx.translate(mitte - 8 * k, mitte - 8 * k);
    ctx.scale(k, k);
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = farben.meer;
    ctx.stroke(new Path2D("M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3"));
    return ctx.getImageData(0, 0, leinwand.width, leinwand.height);
}

/** Die Bilder der Griffe am See; neu, wenn sich die Farben des Themas geändert haben. */
const seeBilderStand = new WeakMap<MapLibreMap, string>();
function seeBilder(map: MapLibreMap, farben: { meer: string; panel: string; gewaehlt: string }): void {
    const schluessel = [farben.meer, farben.panel, farben.gewaehlt].join("|");
    const gleich =
        seeBilderStand.get(map) === schluessel && map.hasImage(SEE_GRIFF) && map.hasImage(SEE_GRIFF_GEWAEHLT);
    if (gleich) return;
    for (const [id, gewaehlt] of [
        [SEE_GRIFF, false],
        [SEE_GRIFF_GEWAEHLT, true],
    ] as const) {
        const bild = seeGriffBild(farben, gewaehlt);
        if (bild === undefined) return;
        if (map.hasImage(id)) map.removeImage(id);
        map.addImage(id, bild, { pixelRatio: 2 });
    }
    seeBilderStand.set(map, schluessel);
}

/** Lagen der Zeichen als GeoJSON: eine Quelle, die Ebenen filtern nach `art`. */
function flussGeoJson(fluss: FlussDaten) {
    const punkt = (at: Punkt, eigenschaften: Record<string, string | number | boolean>) => ({
        type: "Feature" as const,
        properties: eigenschaften,
        geometry: { type: "Point" as const, coordinates: lngLat(at) },
    });
    return {
        type: "FeatureCollection" as const,
        features: [
            ...fluss.punkte.map((p) => punkt(p.at, { art: "punkt", eigen: p.eigen })),
            ...fluss.seen.map((p) => punkt(p.at, { art: "see", gewaehlt: p.gewaehlt })),
            ...fluss.warnungen.map((at) => punkt(at, { art: "warn" })),
            ...fluss.enden.map((p) => punkt(p.at, { art: "ende", text: p.text })),
        ],
    };
}

const istArt = (art: string) => ["==", ["get", "art"], art] as never;

/**
 * Die Zeichen der Flüsse und Seen (WI-0259), über den Anfassern des Geometrie-Moduls: Stützpunkte gefüllt (eigene Höhe, `profileSea`) oder
 * hohl (Höhe des Geländes), ein Griff ↕ am Platz eines Sees, das „!“ (Warnfarben) vor einem steigenden Punkt und „Quelle“ und „Mündung“. Die
 * Ebenen entstehen beim ersten Mal und bleiben (leer, wo nichts zu zeigen ist).
 */
function zeichneFluss(map: MapLibreMap, fluss: FlussDaten, farben: NetzFarben): void {
    const f = flussFarben();
    const daten = flussGeoJson(fluss);
    const quelle = map.getSource(FLUSS_QUELLE) as GeoJSONSource | undefined;
    if (quelle === undefined) map.addSource(FLUSS_QUELLE, { type: "geojson", data: daten });
    else quelle.setData(daten);
    seeBilder(map, f);
    const halo = farben.rand;
    if (map.getLayer(FLUSS_PUNKT) === undefined)
        map.addLayer({
            id: FLUSS_PUNKT,
            type: "circle",
            source: FLUSS_QUELLE,
            filter: istArt("punkt"),
            paint: {
                "circle-radius": 5.5,
                "circle-color": ["case", ["get", "eigen"], f.meer, f.panel] as never,
                "circle-stroke-width": 2.2,
                "circle-stroke-color": ["case", ["get", "eigen"], f.panel, f.fluss] as never,
            },
        });
    if (map.getLayer(FLUSS_SEE) === undefined)
        map.addLayer({
            id: FLUSS_SEE,
            type: "symbol",
            source: FLUSS_QUELLE,
            filter: istArt("see"),
            layout: {
                "icon-image": ["case", ["get", "gewaehlt"], SEE_GRIFF_GEWAEHLT, SEE_GRIFF] as never,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
            },
        });
    if (map.getLayer(FLUSS_WARN) === undefined)
        map.addLayer({
            id: FLUSS_WARN,
            type: "circle",
            source: FLUSS_QUELLE,
            filter: istArt("warn"),
            paint: {
                "circle-radius": 8,
                "circle-color": f.warnFlaeche,
                "circle-stroke-width": 1.6,
                "circle-stroke-color": f.warnRand,
                "circle-translate": WARN_VERSATZ,
                "circle-translate-anchor": "viewport",
            },
        });
    if (map.getLayer(FLUSS_WARN_ZEICHEN) === undefined)
        map.addLayer({
            id: FLUSS_WARN_ZEICHEN,
            type: "symbol",
            source: FLUSS_QUELLE,
            filter: istArt("warn"),
            layout: {
                "text-field": "!",
                "text-font": [LABEL_FONT],
                "text-size": 12,
                // Das Zeichen sitzt in der Schrift tief; so steht es in der Mitte der Marke.
                "text-offset": [0, -0.3],
                "text-allow-overlap": true,
                "text-ignore-placement": true,
            },
            paint: {
                "text-color": f.warnText,
                "text-translate": WARN_VERSATZ,
                "text-translate-anchor": "viewport",
            },
        });
    if (map.getLayer(FLUSS_ENDE) === undefined)
        map.addLayer({
            id: FLUSS_ENDE,
            type: "symbol",
            source: FLUSS_QUELLE,
            filter: istArt("ende"),
            layout: {
                "text-field": ["get", "text"] as never,
                "text-font": [LABEL_FONT],
                "text-size": 12,
                // Links unter dem Punkt: Die Zahl steht darüber, das „!“ rechts unten.
                "text-anchor": "top-right",
                "text-offset": [-0.4, 0.6],
                "text-allow-overlap": true,
                "text-ignore-placement": true,
            },
            paint: { "text-color": f.text, "text-halo-color": halo, "text-halo-width": 1.5 },
        });
    // Hell und dunkel: Die Farben folgen dem Stand des Themas bei jedem Zeichnen.
    map.setPaintProperty(FLUSS_PUNKT, "circle-color", ["case", ["get", "eigen"], f.meer, f.panel] as never);
    map.setPaintProperty(FLUSS_PUNKT, "circle-stroke-color", ["case", ["get", "eigen"], f.panel, f.fluss] as never);
    map.setPaintProperty(FLUSS_WARN, "circle-color", f.warnFlaeche);
    map.setPaintProperty(FLUSS_WARN, "circle-stroke-color", f.warnRand);
    map.setPaintProperty(FLUSS_WARN_ZEICHEN, "text-color", f.warnText);
    map.setPaintProperty(FLUSS_ENDE, "text-color", f.text);
    map.setPaintProperty(FLUSS_ENDE, "text-halo-color", halo);
}

/**
 * Nur die Höhen neu (während eines Zugs der Höhe ändern sich weder Netz noch Auswahl): eine Quelle statt drei, kein Stil. `false`, wenn die
 * Lage noch nicht steht; dann zeichnet der Aufrufer ganz.
 */
export function zeichneHoehen(
    map: MapLibreMap,
    hoehen: { type: "FeatureCollection"; features: HoehenMarke[] },
    /** Die Zeichen der Flüsse (WI-0259): „!“ und gefüllte Punkte folgen dem Zug; es ist eine kleine Quelle. */
    fluss?: FlussDaten,
): boolean {
    const quelle = map.getSource(HOEHEN_QUELLE) as GeoJSONSource | undefined;
    if (quelle === undefined) return false;
    quelle.setData(hoehen);
    const flussQuelle = fluss === undefined ? undefined : (map.getSource(FLUSS_QUELLE) as GeoJSONSource | undefined);
    if (fluss !== undefined && flussQuelle !== undefined) flussQuelle.setData(flussGeoJson(fluss));
    return true;
}

/** Fehlt das Netz auf der Karte, etwa weil ein Stilwechsel (`setStyle` mit `diff`) seine Ebenen mitgenommen hat? */
export const netzLageFehlt = (map: MapLibreMap): boolean => map.getLayer(LINIEN) === undefined;

/** Nimmt Ebenen und Quellen des Netzes wieder von der Karte. */
export function entferneNetzLage(map: MapLibreMap): void {
    for (const ebene of [
        HOEHEN,
        FLUSS_ENDE,
        FLUSS_WARN_ZEICHEN,
        FLUSS_WARN,
        FLUSS_SEE,
        FLUSS_PUNKT,
        AUSWAHL_PUNKT,
        AUSWAHL_LINIE,
        PUNKTE,
        LINIEN,
    ])
        if (map.getLayer(ebene)) map.removeLayer(ebene);
    for (const quelle of [HOEHEN_QUELLE, FLUSS_QUELLE, AUSWAHL_QUELLE, QUELLE])
        if (map.getSource(quelle)) map.removeSource(quelle);
    for (const bild of [SEE_GRIFF, SEE_GRIFF_GEWAEHLT]) if (map.hasImage(bild)) map.removeImage(bild);
    seeBilderStand.delete(map);
}
