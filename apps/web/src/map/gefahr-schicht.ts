import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";
import { canonColour, DESIGN_CANON, VECTOR_TILE_MAX_ZOOM } from "@avesmaps3d/shared";
import { PLACE_SOURCE_ID } from "./place-layers";

/**
 * Die gefährlichen Gebiete auf der Karte (WI-0308 Paket 2; Vali 2026-11-11 Antwort 8: „rot schraffiert mit etwas dickeren linien wie in
 * deinem mockup“, 2026-11-12 Antwort 11: „A“, immer sichtbar, ohne eigenen Schalter). Entwurf https://claude.ai/artifact/3gVFeJnDStVxioYK2KK6Wt,
 * Ansicht „Karte“.
 *
 * - **Eigene kleine Quelle** (`region_gefahr_tile`, Migration 0342): nur die Flächen mit wirksamer Gefahrenlage. So steht die Schraffur in
 *   JEDER Ansicht (auch Standard und Politisch, wo keine Landschaftsflächen gezeichnet werden), ohne dort alle Flächen zu laden. Ohne
 *   gefährliches Gebiet sind die Kacheln leer.
 * - **Ab derselben Zoomstufe wie die Landschaftsflächen:** Die haben keine Untergrenze, also die Schraffur auch nicht.
 * - **Drei Ebenen** über allen Flächen, unter Orten, Namen und Route (wie im Entwurf): eine leichte Tönung, die Striche unter 45° und der
 *   rote Rand. Farbe und Maße aus dem Kanon (`colour.mapGefahr`, `mapGefahr`).
 * - Sie hört auf keinen Klick: Ein Klick trifft die Fläche darunter wie bisher (Infopanel mit der Pille „Gefahrengebiet“).
 * - Nach einer Operation lädt sie mit den Kacheln der Derographie neu (`?r=`, `app.vue`).
 */

export const GEFAHR_QUELLE = "gefahren";
export const GEFAHR_SCHICHT = "region_gefahr_render";
export const GEFAHR_KACHEL_URL = "/tiles/vector/region_gefahr_tile/{z}/{x}/{y}";
export const GEFAHR_MUSTER = "gefahr-schraffur";
export const GEFAHR_EBENEN = {
    toenung: "gefahr-toenung",
    schraffur: "gefahr-schraffur",
    kante: "gefahr-kante",
} as const;

/** Die Maße aus dem Kanon (`mapGefahr`); fehlt der Block, die Werte des Entwurfs. */
export function gefahrMasse(): NonNullable<typeof DESIGN_CANON.mapGefahr> {
    return (
        DESIGN_CANON.mapGefahr ?? {
            raster: 9,
            strich: 2.2,
            deckkraft: 0.62,
            toenung: 0.1,
            kante: 1.8,
            kanteDeckkraft: 0.9,
        }
    );
}

/** Die Kantenlänge der Musterkachel in CSS-Pixeln: eine Zweierpotenz, damit die Striche an der Kachelgrenze nahtlos weiterlaufen. */
const KANTE = 64;
const UNTERABTASTUNG = 4;

function kanaele(farbe: string): [number, number, number] {
    const hex = farbe.replace("#", "");
    return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
    ];
}

/**
 * Das Muster: rote Striche unter 45° auf durchsichtigem Grund. Die Farbe hängt nur an `x + y`; damit die Kachel nahtlos ist, teilt die
 * Periode die Kante ganzzahlig. Gewählt wird die Zahl der Striche je Kachel, die dem Raster des Kanons am nächsten kommt (9 px senkrecht:
 * fünf Striche je 64 px, 9,05 px). Die Deckkraft der Striche steht im Bild, Tönung und Rand sind eigene Ebenen.
 */
export function gefahrMusterPixel(
    pixelRatio = 2,
    farbe: string = canonColour("mapGefahr"),
    masse = gefahrMasse(),
): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer>; periodePx: number } {
    const anzahl = Math.max(1, Math.round(KANTE / (masse.raster * Math.SQRT2)));
    // Die Periode in Einheiten von x + y (CSS-Pixel) und die Breite eines Strichs in denselben Einheiten.
    const periode = KANTE / anzahl;
    const strich = masse.strich * Math.SQRT2;
    const groesse = KANTE * pixelRatio;
    const [r, g, b] = kanaele(farbe);
    const data = new Uint8ClampedArray(new ArrayBuffer(groesse * groesse * 4));
    const schritt = 1 / UNTERABTASTUNG;
    for (let y = 0; y < groesse; y += 1)
        for (let x = 0; x < groesse; x += 1) {
            let treffer = 0;
            for (let sy = 0; sy < UNTERABTASTUNG; sy += 1)
                for (let sx = 0; sx < UNTERABTASTUNG; sx += 1) {
                    const summe = (x + (sx + 0.5) * schritt + y + (sy + 0.5) * schritt) / pixelRatio;
                    if (summe % periode < strich) treffer += 1;
                }
            const i = (y * groesse + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = Math.round(255 * masse.deckkraft * (treffer / (UNTERABTASTUNG * UNTERABTASTUNG)));
        }
    return { width: groesse, height: groesse, data, periodePx: periode / Math.SQRT2 };
}

/** Das Muster als Laufzeitbild (`runtime-images.ts`, angemeldet mit Pixelverhältnis 2). */
export function drawGefahrMuster(): ImageData {
    const { width, height, data } = gefahrMusterPixel(2);
    return new ImageData(data, width, height);
}

export function buildGefahrQuelle(tileUrl: string): SourceSpecification {
    return { type: "vector", tiles: [tileUrl], minzoom: 0, maxzoom: VECTOR_TILE_MAX_ZOOM };
}

export function buildGefahrEbenen(): LayerSpecification[] {
    const masse = gefahrMasse();
    const farbe = canonColour("mapGefahr");
    const gemeinsam = { source: GEFAHR_QUELLE, "source-layer": GEFAHR_SCHICHT } as const;
    return [
        {
            id: GEFAHR_EBENEN.toenung,
            type: "fill",
            ...gemeinsam,
            paint: { "fill-color": farbe, "fill-opacity": masse.toenung },
        },
        {
            id: GEFAHR_EBENEN.schraffur,
            type: "fill",
            ...gemeinsam,
            paint: { "fill-pattern": GEFAHR_MUSTER },
        },
        {
            id: GEFAHR_EBENEN.kante,
            type: "line",
            ...gemeinsam,
            layout: { "line-join": "round" },
            paint: { "line-color": farbe, "line-width": masse.kante, "line-opacity": masse.kanteDeckkraft },
        },
    ];
}

/**
 * Hängt Quelle und Ebenen an einen fertigen Stil: über alle Flächen, vor die erste Ebene der Orte oder die erste Schrift, also unter
 * Orte, Namen und die Route, die danach kommt. Wie Route und Messung an JEDEM Stil: `setStyle` mit `diff` entfernt, was der neue Stil
 * nicht nennt.
 */
export function withGefahren(stil: StyleSpecification, tileUrl: string): StyleSpecification {
    const ebenen = stil.layers;
    const vor = ebenen.findIndex(
        (ebene) => ebene.type === "symbol" || ("source" in ebene && ebene.source === PLACE_SOURCE_ID),
    );
    const stelle = vor < 0 ? ebenen.length : vor;
    return {
        ...stil,
        sources: { ...stil.sources, [GEFAHR_QUELLE]: buildGefahrQuelle(tileUrl) },
        layers: [...ebenen.slice(0, stelle), ...buildGefahrEbenen(), ...ebenen.slice(stelle)],
    };
}
