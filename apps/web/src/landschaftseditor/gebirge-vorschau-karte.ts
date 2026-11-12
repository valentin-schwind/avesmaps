import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import { ref, watch } from "vue";
import { AVENTURIA, fromRenderLngLat, toRenderLngLat } from "@avesmaps3d/shared";
import { kartenRahmen } from "./gebirge-anzeige";
import { styleTakesChanges } from "../map/style-ready";
import { setTerrainPreview } from "../map/terrain/terrain-preview";
import type { VorschauErgebnis } from "../gebirge-vorschau/auftrag";

/**
 * Die Gebirge-Vorschau auf der Karte (WI-0178 P6; Fassung 16: die Grundform im Umriss, ringsum das heutige Gelände): EIN Bild über den
 * Flächen, unter der ersten Schrift, auch beim Kämmezeichnen (Vali wählte 2026-10-26: Die Vorschau bleibt im Kämme-Modus stehen; vorher lag sie
 * dort unter dem Untergrund und allen Flächen, OPS-000045, und war mit deckendem Untergrund weg). Wer am Untergrund nachzeichnen will, stellt
 * den Regler „Vorschau“ der Leiste herunter (`vorschauDeckkraft`); außerhalb der Fläche ist das Bild durchsichtig. Es steht, solange der Reiter „Gebirge“ offen ist oder ein
 * Gebirge im Entwurf geändert ist (Betreiberauftrag 2026-10-21: auch ohne Änderung im offenen Reiter), und nur mit „Kartenvorschau“ an;
 * sonst zeigt die Karte wieder ihr Gelände. Ein Stilwechsel nimmt Quelle und Ebene mit, sie kommen mit `styledata` wieder.
 *
 * Darüber bei großen Gebirgen ein zweites Bild, fein nur im sichtbaren Ausschnitt (WI-0245, Bauplan Gebirge D4: „Ausschnitt fein“): Das
 * ganze Gebirge auf 160 Zellen hätte bei 80 E und mehr gröbere Zellen als 0,5 E und zeigte keine Grate. Dafür meldet die Karte, welchen
 * Rahmen sie gerade zeigt (`kartenRahmen`).
 */
export const VORSCHAU_QUELLE = "editor-gebirge-vorschau";
export const VORSCHAU_EBENE = "editor-gebirge-vorschau";
export const VORSCHAU_FEIN = "editor-gebirge-vorschau-fein";
/** Fast deckend: Die Grundform soll man sehen, die Kante der Fläche darunter noch ahnen (Fassung 16: 0,96). */
const DECKKRAFT = 0.96;
/**
 * Der Regler „Vorschau“ in der Leiste von „Kämme zeichnen“ (Entwurf V16): wie deckend das Bild steht, von 0 (nur das Gelände) bis 1. Für
 * alle Gebirge gleich und nur in dieser Sitzung; beim nächsten Laden wieder die Vorgabe.
 */
export const vorschauDeckkraft = ref(DECKKRAFT);

export interface GebirgeVorschauBild {
    readonly url: string;
    /** Oben links, oben rechts, unten rechts, unten links in Kartenkoordinaten. */
    readonly ecken: readonly (readonly [number, number])[];
    /** Maßstäbliche Schritt-Höhen derselben Rechnung für die temporäre 3D-Geometrie. */
    readonly raster?: VorschauErgebnis;
    readonly aufloesung?: 1 | 2 | 4;
}

export interface GebirgeVorschauKarte {
    zeige(bild: GebirgeVorschauBild | undefined): void;
    /** Das feine Bild im sichtbaren Ausschnitt über dem ganzen; `undefined` nimmt es weg. */
    zeigeFein(bild: GebirgeVorschauBild | undefined): void;
    entferne(): void;
}

const space = AVENTURIA.coordinateSpace;

/** Wohin das Bild gehört: über alle Grund-, Raster- und Flächenlagen, unter die erste Schrift danach. Gibt die Ebene, vor die es kommt. */
function bildPlatz(map: MapLibreMap): string | undefined {
    const lagen = (map.getStyle().layers ?? []).filter(
        (lage) => lage.id !== VORSCHAU_EBENE && lage.id !== VORSCHAU_FEIN,
    );
    // Die erste Symbol-Ebene kann noch UNTER späteren Kartenfüllungen liegen. Das Bild muss über sämtlichen
    // Grund-/Flächenlagen stehen; erst die danach folgenden Namen dürfen es überzeichnen.
    let letzteFlaeche = -1;
    lagen.forEach((lage, i) => {
        if (["background", "raster", "fill", "hillshade"].includes(lage.type)) letzteFlaeche = i;
    });
    return lagen.find((lage, i) => i > letzteFlaeche && lage.type === "symbol")?.id;
}

/** Eine Bildlage auf der Karte: Quelle und Ebene unter derselben Kennung. */
function bildLage(map: MapLibreMap, kennung: string) {
    let bild: GebirgeVorschauBild | undefined;
    let dekodiert: { bild: GebirgeVorschauBild; image: HTMLImageElement } | undefined;
    let angewandt: GebirgeVorschauBild | undefined;
    let bildQuelle: ImageSource | undefined;
    let synchronisiert = false;
    const ecken = (b: GebirgeVorschauBild) =>
        b.ecken.map(([x, y]) => {
            const p = toRenderLngLat(space, { x, y });
            return [p.lng, p.lat];
        }) as [[number, number], [number, number], [number, number], [number, number]];
    const weg = (): void => {
        angewandt = undefined;
        bildQuelle = undefined;
        if (map.getLayer(kennung)) map.removeLayer(kennung);
        if (map.getSource(kennung)) map.removeSource(kennung);
    };
    const zeichne = (b: GebirgeVorschauBild): void => {
        if (dekodiert?.bild !== b) return;
        let quelle = map.getSource(kennung) as ImageSource | undefined;
        // ImageSource lädt `url` über fetch: Die CSP erlaubt data: für Bilder, ausdrücklich nicht für connect-src.
        // Das schon im Browser dekodierte Bild direkt übernehmen; weder Netzabruf noch erweiterte CSP nötig.
        if (quelle === undefined) {
            map.addSource(kennung, { type: "image", coordinates: ecken(b) });
            quelle = map.getSource(kennung) as ImageSource;
        }
        if (angewandt !== b || bildQuelle !== quelle)
            quelle.updateImage({ image: dekodiert.image, coordinates: ecken(b) });
        angewandt = b;
        bildQuelle = map.getSource(kennung) as ImageSource | undefined;
        const lagen = map.getStyle().layers ?? [];
        const davor = kennung === VORSCHAU_EBENE && map.getLayer(VORSCHAU_FEIN) ? VORSCHAU_FEIN : bildPlatz(map);
        if (map.getLayer(kennung) === undefined) {
            map.addLayer(
                {
                    id: kennung,
                    type: "raster",
                    source: kennung,
                    paint: {
                        "raster-opacity": vorschauDeckkraft.value,
                        "raster-fade-duration": 0,
                        "raster-resampling": "linear",
                    },
                },
                davor,
            );
        } else {
            const index = lagen.findIndex((lage) => lage.id === kennung);
            const ziel = davor === undefined ? lagen.length : lagen.findIndex((lage) => lage.id === davor);
            if (index !== ziel - 1) map.moveLayer(kennung, davor);
        }
        if (map.getPaintProperty(kennung, "raster-opacity") !== vorschauDeckkraft.value)
            map.setPaintProperty(kennung, "raster-opacity", vorschauDeckkraft.value);
    };
    const anlegen = (): void => {
        if (synchronisiert || !styleTakesChanges(map)) return;
        synchronisiert = true;
        try {
            if (bild === undefined) weg();
            else zeichne(bild);
        } finally {
            synchronisiert = false;
        }
    };
    return {
        zeige(neu: GebirgeVorschauBild | undefined): void {
            if (neu === undefined && bild === undefined) return;
            bild = neu;
            if (neu === undefined) {
                dekodiert = undefined;
                anlegen();
                return;
            }
            const image = new Image();
            image.src = neu.url;
            void image
                .decode()
                .then(() => {
                    if (bild !== neu) return;
                    dekodiert = { bild: neu, image };
                    anlegen();
                })
                .catch((fehler: unknown) => {
                    if (bild === neu) console.warn("Gebirge-Vorschau: Bild konnte nicht dekodiert werden", fehler);
                });
        },
        nachStil(): void {
            // Ein Stilwechsel (setStyle mit diff, beim Neigen mit Gelände und beim Umschalten der Ansicht) nimmt Quelle und Ebene mit;
            // fehlt auch nur die Ebene, kommt das Bild wieder (Stage-Fund 2026-10-21: im Umriss nichts zu sehen, der Regler ohne Wirkung).
            if (bild !== undefined || map.getLayer(kennung) || map.getSource(kennung)) anlegen();
        },
        deckkraft(wert: number): void {
            if (styleTakesChanges(map) && map.getLayer(kennung)) map.setPaintProperty(kennung, "raster-opacity", wert);
        },
        weg(): void {
            bild = undefined;
            dekodiert = undefined;
            weg();
        },
    };
}

export function installGebirgeVorschau(map: MapLibreMap): GebirgeVorschauKarte {
    const ganz = bildLage(map, VORSCHAU_EBENE);
    const fein = bildLage(map, VORSCHAU_FEIN);
    let stilFrame: number | undefined;
    let entfernt = false;
    // styledata läuft innerhalb von MapLibres Stilaktualisierung. Neue Ebenen dort
    // einzusetzen lässt deren Farbwerte im laufenden Renderdurchlauf unevaluiert.
    const nachStil = (): void => {
        if (stilFrame !== undefined || entfernt) return;
        stilFrame = requestAnimationFrame(() => {
            stilFrame = undefined;
            if (entfernt) return;
            // Erst das feine Bild an seinen Platz, dann das ganze darunter (es legt sich vor das feine).
            fein.nachStil();
            ganz.nachStil();
        });
    };
    map.on("styledata", nachStil);
    const stopDeckkraft = watch(vorschauDeckkraft, (wert) => {
        ganz.deckkraft(wert);
        fein.deckkraft(wert);
    });
    // Der sichtbare Rahmen in Karteneinheiten, nach jeder Bewegung (für die feine Rechnung im Ausschnitt).
    const melde = (): void => {
        const b = map.getBounds();
        const a = fromRenderLngLat(space, { lng: b.getWest(), lat: b.getSouth() });
        const c = fromRenderLngLat(space, { lng: b.getEast(), lat: b.getNorth() });
        kartenRahmen.value = {
            min_x: Math.min(a.x, c.x),
            min_y: Math.min(a.y, c.y),
            max_x: Math.max(a.x, c.x),
            max_y: Math.max(a.y, c.y),
        };
    };
    map.on("moveend", melde);
    melde();

    return {
        zeige(neu) {
            setTerrainPreview(map, neu?.raster, neu?.aufloesung);
            ganz.zeige(neu);
            // Ohne ganzes Bild auch kein feines.
            if (neu === undefined) fein.zeige(undefined);
        },
        zeigeFein(neu) {
            fein.zeige(neu);
        },
        entferne() {
            entfernt = true;
            if (stilFrame !== undefined) cancelAnimationFrame(stilFrame);
            setTerrainPreview(map, undefined);
            map.off("styledata", nachStil);
            map.off("moveend", melde);
            stopDeckkraft();
            ganz.weg();
            fein.weg();
        },
    };
}
