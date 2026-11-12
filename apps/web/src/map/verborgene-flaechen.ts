import { h, render } from "vue";
import { Marker, type FilterSpecification, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat, type EditorHiddenLandscape } from "@avesmaps3d/shared";
import VerborgenAuge from "./verborgen-auge.vue";
import { fillForLayer, landscapeFillLayerId } from "./landscape-layers";
import { nachStilwechsel } from "./style-ready";

/**
 * Die für Besucher verborgenen Landschaften, wie Editoren sie sehen (WI-0178 T41; EDIT-0003 T41 (1): „immer schraffiert in der Farbe
 * ihrer Art mit durchgestrichenem Auge, ohne Prüfhaken“). Die Besucherkacheln lassen sie aus (Migration 0166); diese Schicht zeichnet sie
 * aus der Zusatzschicht der App (`/api/editor/landscapes/hidden`, Claudio 2026-10-18: keine zweite volle Kachelquelle).
 *
 * - Fläche in der Farbe ihrer Art, darüber diagonale Streifen und eine gestrichelte Kante; nur wo die Karte ihre Ebene zeichnet.
 * - Das Auge steht an ihrer ersten Beschriftung; ein Klick darauf öffnet ihr Fenster (`klick`).
 * - Der Rechtsklick der Editoren trifft die Fläche (`landscapesAt` mit `VERBORGEN_EBENEN.flaeche`): Die Features tragen Name und Größe
 *   wie die Kachel, das Kartenmenü bietet „Zurückholen“.
 * - Ein Stilwechsel (`setStyle` mit `diff`) nimmt Quelle und Ebenen mit; sie kommen mit `styledata` wieder, wie die Sperre.
 */
export const VERBORGEN_QUELLE = "editor-verborgen";
export const VERBORGEN_EBENEN = {
    flaeche: "editor-verborgen-flaeche",
    schraffur: "editor-verborgen-schraffur",
    kante: "editor-verborgen-kante",
} as const;
const MUSTER = "editor-verborgen-muster";
const KANTE = 32;
const PERIODE = 8;
const EBENEN = ["derographisch", "vegetation", "topographie"] as const;

export interface VerborgeneFlaechen {
    zeige(zeilen: readonly EditorHiddenLandscape[]): void;
    /** Ist diese Landschaft unter den verborgenen? */
    hat(id: string): boolean;
    entferne(): void;
}

/** Dunkle Streifen auf durchsichtigem Grund: Die Farbe der Art darunter bleibt sichtbar. */
function musterBild(): { width: number; height: number; data: Uint8Array } {
    const data = new Uint8Array(KANTE * KANTE * 4);
    for (let y = 0; y < KANTE; y += 1)
        for (let x = 0; x < KANTE; x += 1) {
            const i = (y * KANTE + x) * 4;
            const streifen = (x + y) % PERIODE < 2;
            data.set(streifen ? [60, 52, 40, 150] : [0, 0, 0, 0], i);
        }
    return { width: KANTE, height: KANTE, data };
}

/** Die Fläche eines Polygons in E² (Gaußsche Trapezformel, Löcher abgezogen), wie `area` in der Kachel. */
function flaecheVon(polygon: readonly (readonly (readonly [number, number])[])[]): number {
    let summe = 0;
    polygon.forEach((ring, i) => {
        let doppelt = 0;
        ring.forEach(([x, y], j) => {
            const [nx, ny] = ring[(j + 1) % ring.length]!;
            doppelt += x * ny - nx * y;
        });
        summe += (i === 0 ? 1 : -1) * Math.abs(doppelt / 2);
    });
    return Math.max(summe, 0);
}

/** Die Farbe der Art je Ebene (dieselbe Tafel wie die Besucherflächen). */
const farbe = () =>
    [
        "match",
        ["get", "region_layer"],
        ...EBENEN.flatMap((ebene) => [ebene, fillForLayer(ebene, (c) => c)]),
        "#8a8a8a",
    ] as unknown as string;

export function installVerborgeneFlaechen(
    map: MapLibreMap,
    optionen: { klick(id: string): void; titel(zeile: EditorHiddenLandscape): string },
): VerborgeneFlaechen {
    const space = AVENTURIA.coordinateSpace;
    let zeilen: readonly EditorHiddenLandscape[] = [];
    const augen = new Map<string, Marker>();

    const sichtbareEbenen = (): string[] => EBENEN.filter((ebene) => map.getLayer(landscapeFillLayerId(ebene)));
    const filter = (): FilterSpecification =>
        ["in", ["get", "region_layer"], ["literal", sichtbareEbenen()]] as FilterSpecification;

    const daten = () => ({
        type: "FeatureCollection" as const,
        features: zeilen.flatMap((zeile) =>
            zeile.polygons.map((polygon) => ({
                type: "Feature" as const,
                properties: {
                    region_public_id: zeile.id,
                    region_layer: zeile.layer,
                    region_type: zeile.type ?? "",
                    name: zeile.name,
                    area: flaecheVon(polygon),
                },
                geometry: {
                    type: "Polygon" as const,
                    coordinates: polygon.map((ring) => {
                        const punkte = ring.map(([x, y]) => {
                            const p = toRenderLngLat(space, { x, y });
                            return [p.lng, p.lat];
                        });
                        return punkte.length > 0 ? [...punkte, punkte[0]!] : punkte;
                    }),
                },
            })),
        ),
    });

    const anlegen = (mitDaten: boolean): void => {
        // Lädt der Stil gerade (ein Wechsel der Ansicht), dann gleich danach.
        if (!map.isStyleLoaded()) {
            map.once("idle", () => anlegen(mitDaten));
            return;
        }
        if (!map.hasImage(MUSTER)) map.addImage(MUSTER, musterBild(), { pixelRatio: 2 });
        const quelle = map.getSource(VERBORGEN_QUELLE) as GeoJSONSource | undefined;
        if (quelle === undefined) map.addSource(VERBORGEN_QUELLE, { type: "geojson", data: daten() });
        else if (mitDaten) quelle.setData(daten());
        const vorSchrift = (map.getStyle().layers ?? []).find((schicht) => schicht.type === "symbol")?.id;
        if (map.getLayer(VERBORGEN_EBENEN.flaeche) === undefined) {
            map.addLayer(
                {
                    id: VERBORGEN_EBENEN.flaeche,
                    type: "fill",
                    source: VERBORGEN_QUELLE,
                    filter: filter(),
                    paint: { "fill-color": farbe(), "fill-opacity": 0.35 },
                },
                vorSchrift,
            );
            map.addLayer(
                {
                    id: VERBORGEN_EBENEN.schraffur,
                    type: "fill",
                    source: VERBORGEN_QUELLE,
                    filter: filter(),
                    paint: { "fill-pattern": MUSTER },
                },
                vorSchrift,
            );
            map.addLayer(
                {
                    id: VERBORGEN_EBENEN.kante,
                    type: "line",
                    source: VERBORGEN_QUELLE,
                    filter: filter(),
                    paint: {
                        "line-color": "#3c3428",
                        "line-width": 1.5,
                        "line-dasharray": [2, 2],
                        "line-opacity": 0.8,
                    },
                },
                vorSchrift,
            );
        } else if (mitDaten) for (const ebene of Object.values(VERBORGEN_EBENEN)) map.setFilter(ebene, filter());
    };

    const augenZeigen = (): void => {
        const ebenen = new Set(sichtbareEbenen());
        const sollen = zeilen.filter((zeile) => zeile.at !== undefined && ebenen.has(zeile.layer));
        for (const [id, auge] of augen) {
            if (sollen.some((zeile) => zeile.id === id)) continue;
            render(null, auge.getElement());
            auge.remove();
            augen.delete(id);
        }
        for (const zeile of sollen) {
            const vorhanden = augen.get(zeile.id);
            const element = vorhanden?.getElement() ?? document.createElement("div");
            render(
                h(VerborgenAuge, { titel: optionen.titel(zeile), onKlick: () => optionen.klick(zeile.id) }),
                element,
            );
            const lngLat = toRenderLngLat(space, { x: zeile.at![0], y: zeile.at![1] });
            if (vorhanden) vorhanden.setLngLat([lngLat.lng, lngLat.lat]);
            else augen.set(zeile.id, new Marker({ element }).setLngLat([lngLat.lng, lngLat.lat]).addTo(map));
        }
    };

    const nachStil = (): void => {
        anlegen(false);
        augenZeigen();
    };
    // Nach einem Stilwechsel erst im nächsten Bild (`nachStilwechsel`: sonst zeichnet MapLibre die Füllebene unausgewertet).
    const stilAbmelden = nachStilwechsel(map, nachStil);

    return {
        zeige(neu) {
            zeilen = neu;
            anlegen(true);
            augenZeigen();
        },
        hat: (id) => zeilen.some((zeile) => zeile.id === id),
        entferne() {
            stilAbmelden();
            for (const auge of augen.values()) {
                render(null, auge.getElement());
                auge.remove();
            }
            augen.clear();
            for (const ebene of Object.values(VERBORGEN_EBENEN)) if (map.getLayer(ebene)) map.removeLayer(ebene);
            if (map.getSource(VERBORGEN_QUELLE)) map.removeSource(VERBORGEN_QUELLE);
        },
    };
}
