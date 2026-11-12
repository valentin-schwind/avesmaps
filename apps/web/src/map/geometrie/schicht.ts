import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, canonColour, DESIGN_CANON, toRenderLngLat } from "@avesmaps3d/shared";
import { coarsePointer } from "../../controls/camera-settings";
import { ROUTE_HIT_WIDTH } from "../route-layers";
import type { Bild, RingArt } from "./bild";
import type { Punkt } from "./geometrie";

/**
 * Die Schicht des Geometrie-Moduls auf der Karte (WI-0177): EINE GeoJSON-Quelle für Kanten, Anfasser und Andockmarken über allem,
 * dazu eine Lage aus SVG-Ringen für Hülle, Kringel und Marken. Die Ringe sind Kreise in Bildpunkten (gestrichelt, wo es die Regel
 * will), das kann eine Kreisebene von MapLibre nicht; sie folgen der Karte Bild für Bild (`render`) und fangen keinen Zeiger.
 *
 * Farben nur aus dem Kanon: `editEdge` (bearbeitet), `routeHalo` (Weiß unter Linie und Anfasser), `success` (bestätigt),
 * `warningSoftBorder` (offenes Ende). Die Trefferflächen sind unsichtbar: die Kante so breit wie die Route (`ROUTE_HIT_WIDTH`),
 * der Anfasser eine Fingerkuppe.
 */

export const GEOMETRIE_QUELLE = "geometrie";
export const GEOMETRIE_KANTE_TREFFER = "geometrie-kante-treffer";
export const GEOMETRIE_ANFASSER_TREFFER = "geometrie-anfasser-treffer";
/** Die Trefferfläche der Steuergriffe (Kraftlinie: der Scheitel des Bogens). */
export const GEOMETRIE_STEUER_TREFFER = "geometrie-steuer-treffer";

/** Der Radius der Trefferfläche um einen Anfasser: am Finger eine Fingerkuppe, an der Maus etwas mehr als der Anfasser selbst. */
const ANFASSER_TREFFER = { touch: 18, pointer: 10 } as const;

const EBENEN = [
    GEOMETRIE_KANTE_TREFFER,
    "geometrie-alt",
    "geometrie-halo",
    "geometrie-folge",
    "geometrie-kante",
    "geometrie-ecken",
    "geometrie-teilung-halo",
    "geometrie-teilung",
    "geometrie-teilung-punkt",
    "geometrie-andock-halo",
    "geometrie-andock",
    "geometrie-steuer",
    GEOMETRIE_STEUER_TREFFER,
    "geometrie-anfasser",
    GEOMETRIE_ANFASSER_TREFFER,
] as const;

const space = AVENTURIA.coordinateSpace;
const lngLat = (p: Punkt): [number, number] => {
    const render = toRenderLngLat(space, p);
    return [render.lng, render.lat];
};

type Feature = {
    type: "Feature";
    properties: Record<string, string | number | boolean>;
    geometry:
        { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: [number, number][] };
};

function features(bild: Bild): { type: "FeatureCollection"; features: Feature[] } {
    const raus: Feature[] = [];
    for (const linie of bild.linien) {
        if (linie.coords.length < 2) continue;
        raus.push({
            type: "Feature",
            properties: {
                rolle: linie.rolle,
                objekt: linie.objekt,
                nr: linie.nr,
                ...(linie.fest === true ? { fest: true } : {}),
            },
            geometry: { type: "LineString", coordinates: linie.coords.map(lngLat) },
        });
    }
    for (const at of bild.andock) {
        raus.push({
            type: "Feature",
            properties: { rolle: "andock" },
            geometry: { type: "Point", coordinates: lngLat(at) },
        });
    }
    for (const a of bild.anfasser) {
        raus.push({
            type: "Feature",
            properties: {
                rolle: "anfasser",
                ende: a.ende,
                objekt: a.stelle.objekt,
                nr: a.stelle.nr,
                index: a.stelle.index,
                ...(a.fest === true ? { fest: true } : {}),
            },
            geometry: { type: "Point", coordinates: lngLat(a.at) },
        });
    }
    for (const at of bild.teilung ?? []) {
        raus.push({
            type: "Feature",
            properties: { rolle: "teilungPunkt" },
            geometry: { type: "Point", coordinates: lngLat(at) },
        });
    }
    for (const g of bild.steuergriffe ?? []) {
        raus.push({
            type: "Feature",
            properties: { rolle: "steuer", objekt: g.objekt, nr: g.nr, aktiv: g.aktiv },
            geometry: { type: "Point", coordinates: lngLat(g.at) },
        });
    }
    return { type: "FeatureCollection", features: raus };
}

/**
 * Die Vorschau der Strg-Kante (vier Punkte, Betreiber 2026-10-20; zur ersten Fassung, wörtlich: „geht perfekt, nur die gestrichelte
 * linie stört n bissel, mach sie einfach dicker oder so“): so breit wie ein gewählter Weg (`mapSelection.pathWidth`), damit sie die
 * bearbeitete Kante samt Saum deckt statt dünn daneben zu liegen; der weiße Saum je Seite wie an der Route (`route.haloWidth`); das
 * Strichmaß der Messlinie (`measure.lineDash`, Vielfache der Breite), ruhig statt flimmernd. Die vier Punkte sehen aus wie die Anfasser,
 * die aus ihnen werden (weiß mit rotem Rand), so breit wie die Linie: Auf dem Rot stehen sie hell. Abgeleitet aus dem Kanon, kein eigener Wert (Editor-Orchestrierung 2026-10-20).
 */
const TEILUNG_BREITE = DESIGN_CANON.mapSelection.pathWidth;
const TEILUNG_SAUM = DESIGN_CANON.route.haloWidth;

function ebenen(map: MapLibreMap): void {
    const rot = canonColour("editEdge");
    const weiss = canonColour("routeHalo");
    // Teile nur zum Wählen (`Teil.fest`: Flüsse und Seen im Kammeditor) in der Farbe des Wassers, die übrigen im Rot der Bearbeitung.
    const rotOderWasser = ["case", ["==", ["get", "fest"], true], canonColour("profileRiver"), rot] as never;
    const rolle = (name: string | string[]) =>
        (Array.isArray(name) ? ["in", ["get", "rolle"], ["literal", name]] : ["==", ["get", "rolle"], name]) as never;
    const rund = { "line-cap": "round", "line-join": "round" } as const;
    const liste: Parameters<MapLibreMap["addLayer"]>[0][] = [
        {
            id: GEOMETRIE_KANTE_TREFFER,
            type: "line",
            source: GEOMETRIE_QUELLE,
            filter: rolle("kante"),
            layout: rund,
            paint: {
                "line-color": rot,
                "line-opacity": 0,
                "line-width": coarsePointer ? ROUTE_HIT_WIDTH.touch : ROUTE_HIT_WIDTH.pointer,
            },
        },
        {
            id: "geometrie-alt",
            type: "line",
            source: GEOMETRIE_QUELLE,
            filter: rolle("alt"),
            layout: rund,
            paint: { "line-color": rot, "line-width": 2.5, "line-opacity": 0.45, "line-dasharray": [1.2, 1.8] },
        },
        {
            id: "geometrie-halo",
            type: "line",
            source: GEOMETRIE_QUELLE,
            filter: rolle(["kante", "folge"]),
            layout: rund,
            paint: { "line-color": weiss, "line-width": 8.5, "line-opacity": 0.92 },
        },
        {
            id: "geometrie-folge",
            type: "line",
            source: GEOMETRIE_QUELLE,
            filter: rolle("folge"),
            layout: rund,
            paint: { "line-color": rot, "line-width": 3.4, "line-dasharray": [1.6, 1.3] },
        },
        {
            id: "geometrie-kante",
            type: "line",
            source: GEOMETRIE_QUELLE,
            filter: rolle("kante"),
            layout: rund,
            paint: {
                "line-color": rotOderWasser,
                "line-width": ["case", ["==", ["get", "fest"], true], 3, 4.2] as never,
            },
        },
        // Der eckige Umriss einer Fläche dünn über ihrer Rundung (T27 (6)).
        {
            id: "geometrie-ecken",
            type: "line",
            source: GEOMETRIE_QUELLE,
            filter: rolle("ecken"),
            layout: rund,
            paint: { "line-color": rot, "line-width": 1.2, "line-opacity": 0.8 },
        },
        // Strg über einer Kante (Legacy: die Strecke breit gestrichelt, darauf die vier Punkte, die ein Klick setzt), in unserem Rot.
        {
            id: "geometrie-teilung-halo",
            type: "line",
            source: GEOMETRIE_QUELLE,
            filter: rolle("teilung"),
            layout: rund,
            paint: { "line-color": weiss, "line-width": TEILUNG_BREITE + 2 * TEILUNG_SAUM, "line-opacity": 0.92 },
        },
        {
            id: "geometrie-teilung",
            type: "line",
            source: GEOMETRIE_QUELLE,
            filter: rolle("teilung"),
            paint: {
                "line-color": rot,
                "line-width": TEILUNG_BREITE,
                "line-dasharray": [...DESIGN_CANON.measure.lineDash],
            },
        },
        {
            id: "geometrie-teilung-punkt",
            type: "circle",
            source: GEOMETRIE_QUELLE,
            filter: rolle("teilungPunkt"),
            paint: {
                "circle-radius": TEILUNG_BREITE / 2,
                "circle-color": weiss,
                "circle-stroke-width": TEILUNG_SAUM,
                "circle-stroke-color": rot,
            },
        },
        {
            id: "geometrie-andock-halo",
            type: "circle",
            source: GEOMETRIE_QUELLE,
            filter: rolle("andock"),
            paint: {
                "circle-radius": 5.8,
                "circle-opacity": 0,
                "circle-stroke-width": 5,
                "circle-stroke-color": weiss,
                "circle-stroke-opacity": 0.9,
            },
        },
        {
            id: "geometrie-andock",
            type: "circle",
            source: GEOMETRIE_QUELLE,
            filter: rolle("andock"),
            paint: {
                "circle-radius": 5.8,
                "circle-opacity": 0,
                "circle-stroke-width": 2.4,
                "circle-stroke-color": rot,
            },
        },
        // Der Steuergriff (Kraftlinie: der Scheitel): rot gefüllt mit weißem Saum, damit er sich vom weißen Anfasser abhebt.
        {
            id: "geometrie-steuer",
            type: "circle",
            source: GEOMETRIE_QUELLE,
            filter: rolle("steuer"),
            paint: {
                "circle-radius": ["case", ["get", "aktiv"], 7, 5.5] as never,
                "circle-color": rot,
                "circle-stroke-width": 2.5,
                "circle-stroke-color": weiss,
            },
        },
        {
            id: GEOMETRIE_STEUER_TREFFER,
            type: "circle",
            source: GEOMETRIE_QUELLE,
            filter: rolle("steuer"),
            paint: {
                "circle-radius": coarsePointer ? ANFASSER_TREFFER.touch : ANFASSER_TREFFER.pointer,
                "circle-opacity": 0,
                "circle-color": rot,
            },
        },
        {
            id: "geometrie-anfasser",
            type: "circle",
            source: GEOMETRIE_QUELLE,
            filter: rolle("anfasser"),
            paint: {
                "circle-radius": ["case", ["==", ["get", "fest"], true], 4.5, ["get", "ende"], 7, 6] as never,
                "circle-color": weiss,
                "circle-stroke-width": ["case", ["get", "ende"], 3, 2.5] as never,
                "circle-stroke-color": rotOderWasser,
            },
        },
        {
            id: GEOMETRIE_ANFASSER_TREFFER,
            type: "circle",
            source: GEOMETRIE_QUELLE,
            filter: rolle("anfasser"),
            paint: {
                "circle-radius": coarsePointer ? ANFASSER_TREFFER.touch : ANFASSER_TREFFER.pointer,
                "circle-opacity": 0,
                "circle-color": rot,
            },
        },
    ];
    for (const ebene of liste) if (map.getLayer(ebene.id) === undefined) map.addLayer(ebene);
}

const SVG = "http://www.w3.org/2000/svg";

/** Wie ein Ring aussieht: Farbe, Strich, Strichelung, Füllung. */
function ringStil(art: RingArt): { farbe: string; breite: number; strich?: string; fuellung?: number } {
    switch (art) {
        case "huelle":
            return { farbe: canonColour("editEdge"), breite: 2, strich: "3.5 2.5", fuellung: 0.16 };
        case "kringel":
            return { farbe: canonColour("editEdge"), breite: 3 };
        case "kringelKante":
            return { farbe: canonColour("editEdge"), breite: 3, strich: "4 4" };
        case "bestaetigt":
            return { farbe: canonColour("success"), breite: 3 };
        case "frei":
            return { farbe: canonColour("warningSoftBorder"), breite: 3, strich: "5 3" };
        // Die Stelle einer abgelehnten Form: ruhig, rot durchgezogen mit zarter Füllung, größer als jeder Anfasser.
        case "fehler":
            return { farbe: canonColour("danger"), breite: 3, fuellung: 0.14 };
        // Liegen geblieben (Strg): Bernstein durchgezogen, wie bisher beim Ort verschieben (D11).
        case "liegen":
            return { farbe: canonColour("warningSoftBorder"), breite: 3 };
        // Markiert (Umschalt + Klick): Gelb heißt ausgewählt, wie überall (`docs/regeln/oberflaeche.md`).
        case "markiert":
            return { farbe: canonColour("mapSelection"), breite: 3 };
    }
}

export interface GeometrieSchicht {
    zeige(bild: Bild): void;
    entferne(): void;
}

/** Legt Quelle, Ebenen und die Ringlage an; nach einem Stilwechsel kommen Quelle und Ebenen von selbst zurück. */
export function installGeometrieSchicht(map: MapLibreMap): GeometrieSchicht {
    let bild: Bild = { linien: [], anfasser: [], andock: [], ringe: [] };
    const lage = document.createElementNS(SVG, "svg");
    lage.setAttribute("data-testid", "geometrie-ringe");
    lage.setAttribute("aria-hidden", "true");
    lage.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";
    map.getContainer().appendChild(lage);

    const anlegen = (): void => {
        if (map.getSource(GEOMETRIE_QUELLE) === undefined)
            map.addSource(GEOMETRIE_QUELLE, { type: "geojson", data: features(bild) });
        ebenen(map);
    };
    const ringe = (): void => {
        const weiss = canonColour("routeHalo");
        while (lage.firstChild) lage.removeChild(lage.firstChild);
        for (const ring of bild.ringe) {
            const p = map.project(lngLat(ring.at));
            const stil = ringStil(ring.art);
            // Ein weißer Saum unter jedem Ring hält ihn auf jeder Karte lesbar (wie die Linien und Anfasser).
            const saum = document.createElementNS(SVG, "circle");
            saum.setAttribute("cx", String(p.x));
            saum.setAttribute("cy", String(p.y));
            saum.setAttribute("r", String(ring.radius));
            saum.setAttribute("fill", "none");
            saum.setAttribute("stroke", weiss);
            saum.setAttribute("stroke-opacity", "0.85");
            saum.setAttribute("stroke-width", String(stil.breite + 2.5));
            lage.appendChild(saum);
            const kreis = document.createElementNS(SVG, "circle");
            kreis.setAttribute("cx", String(p.x));
            kreis.setAttribute("cy", String(p.y));
            kreis.setAttribute("r", String(ring.radius));
            kreis.setAttribute("stroke", stil.farbe);
            kreis.setAttribute("stroke-width", String(stil.breite));
            if (stil.strich !== undefined) kreis.setAttribute("stroke-dasharray", stil.strich);
            if (stil.fuellung !== undefined) {
                kreis.setAttribute("fill", stil.farbe);
                kreis.setAttribute("fill-opacity", String(stil.fuellung));
            } else kreis.setAttribute("fill", "none");
            kreis.dataset["ring"] = ring.art;
            lage.appendChild(kreis);
        }
    };
    const nachStil = (): void => anlegen();

    anlegen();
    map.on("styledata", nachStil);
    map.on("render", ringe);

    return {
        zeige(neu) {
            bild = neu;
            const quelle = map.getSource<GeoJSONSource>(GEOMETRIE_QUELLE);
            if (quelle) quelle.setData(features(bild));
            else anlegen();
            ringe();
            map.triggerRepaint();
        },
        entferne() {
            map.off("styledata", nachStil);
            map.off("render", ringe);
            for (const id of EBENEN) if (map.getLayer(id) !== undefined) map.removeLayer(id);
            if (map.getSource(GEOMETRIE_QUELLE) !== undefined) map.removeSource(GEOMETRIE_QUELLE);
            lage.remove();
        },
    };
}
