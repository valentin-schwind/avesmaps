import type { FilterSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, AVENTURIA_CARTOGRAPHY, darkenColour, toRenderLngLat } from "@avesmaps3d/shared";
import { landscapeFillLayerId } from "./landscape-layers";
import { nachStilwechsel } from "./style-ready";

/**
 * Flächen im Entwurf, wie sie nach „Fertig“ stünden (WI-0178; Betreiber 2026-10-18 auf „Was zeigt die Karte, während eine Fläche im
 * Entwurf die Ebene wechselt?“: „A (Empfehlung)“): in der Ebene des Entwurfs, in der Farbe seiner Art, gestrichelt als Entwurf, bis
 * „Fertig“ oder Verwerfen. Auslöser war der Fund „Tal am Donnerkessel“: Der Ebenenwechsel stellt die Karte schon im Entwurf um (T50),
 * die Kacheln zeichnen die Fläche aber noch in ihrer alten Ebene, also war sie „plötzlich weg“.
 *
 * 🔴 Ein gemeinsamer Zustand, nicht nur der Derographie: Wer eine Fläche im Entwurf anders zeigen muss als die Kachel (Ebene, Art, Farbe),
 * gibt sie hier hinein, mit der Ebene der Karte, in der sie steht (`ebene`), und ihrer Farbe. Die Herrschaftsgebiete können sie mit
 * einer eigenen Ebenenkennung nutzen; gezeichnet wird nur, wo die Karte diese Ebene zeigt (`zeigt`).
 *
 * - Füllung in der Farbe, darüber eine gestrichelte, abgedunkelte Kante; unter der ersten Schrift wie die Landschaften.
 * - Ein Stilwechsel (`setStyle` mit `diff`) nimmt Quelle und Ebenen mit; sie kommen mit `styledata` wieder (wie `verborgene-flaechen.ts`).
 */
export const ENTWURF_QUELLE = "editor-entwurf-flaechen";
export const ENTWURF_EBENEN = { flaeche: "editor-entwurf-flaeche", kante: "editor-entwurf-kante" } as const;
/** Deckkraft der Entwurfsfüllung: kräftig genug, um die Fläche zu finden, dünn genug für die Karte darunter. */
export const ENTWURF_DECKKRAFT = 0.55;

/** Ein Ring als Liste von Ecken in Kartenkoordinaten (MCS), ohne Schlusspunkt. */
type Ring = readonly (readonly [number, number])[];

export interface EntwurfsFlaeche {
    /** Die Kennung des Objekts (für Prüfungen und Treffer). */
    readonly id: string;
    /** Die Ebene der Karte, in der die Fläche im Entwurf steht (`landscape-fill-<ebene>` muss im Stil stehen). */
    readonly ebene: string;
    /** Die Füllfarbe (die Farbe der Art im Entwurf). */
    readonly farbe: string;
    /** Je Polygon die Ringe: zuerst außen, dann Löcher. */
    readonly polygone: readonly (readonly Ring[])[];
}

export interface EntwurfsFlaechen {
    zeige(flaechen: readonly EntwurfsFlaeche[]): void;
    entferne(): void;
}

export function installEntwurfsFlaechen(
    map: MapLibreMap,
    /** Zeigt die Karte diese Ebene? Ohne Angabe: steht ihre Füllebene im Stil. */
    zeigt: (ebene: string) => boolean = (ebene) => map.getLayer(landscapeFillLayerId(ebene)) !== undefined,
): EntwurfsFlaechen {
    const space = AVENTURIA.coordinateSpace;
    let flaechen: readonly EntwurfsFlaeche[] = [];

    const sichtbar = (): string[] => [...new Set(flaechen.map((f) => f.ebene))].filter(zeigt);
    const filter = (): FilterSpecification => ["in", ["get", "ebene"], ["literal", sichtbar()]] as FilterSpecification;
    const daten = () => ({
        type: "FeatureCollection" as const,
        features: flaechen.flatMap((flaeche) =>
            flaeche.polygone.map((polygon) => ({
                type: "Feature" as const,
                properties: {
                    id: flaeche.id,
                    ebene: flaeche.ebene,
                    farbe: flaeche.farbe,
                    kante: darkenColour(flaeche.farbe, AVENTURIA_CARTOGRAPHY.global.lineDarken),
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
        // 🪤 Nicht auf `isStyleLoaded()` warten: Es wartet auch auf alle Kacheln, und bei langsamen Kacheln (Stage, ein Wechsel der Ebene,
        // Last) stand der Entwurf sekundenlang nicht da. Quelle und Ebenen brauchen nur den Stil; lädt der gerade, gleich danach.
        try {
            zeichne(mitDaten);
        } catch {
            // Lädt der Stil noch: nach seinem nächsten Stilwechsel, dort erst im nächsten Bild (`nachStilwechsel`).
            const abmelden = nachStilwechsel(map, () => {
                abmelden();
                anlegen(mitDaten);
            });
        }
    };
    const zeichne = (mitDaten: boolean): void => {
        const quelle = map.getSource(ENTWURF_QUELLE) as GeoJSONSource | undefined;
        if (quelle === undefined) map.addSource(ENTWURF_QUELLE, { type: "geojson", data: daten() });
        else if (mitDaten) quelle.setData(daten());
        if (map.getLayer(ENTWURF_EBENEN.flaeche) === undefined) {
            const vorSchrift = (map.getStyle().layers ?? []).find((schicht) => schicht.type === "symbol")?.id;
            map.addLayer(
                {
                    id: ENTWURF_EBENEN.flaeche,
                    type: "fill",
                    source: ENTWURF_QUELLE,
                    filter: filter(),
                    paint: { "fill-color": ["get", "farbe"], "fill-opacity": ENTWURF_DECKKRAFT },
                },
                vorSchrift,
            );
            map.addLayer(
                {
                    id: ENTWURF_EBENEN.kante,
                    type: "line",
                    source: ENTWURF_QUELLE,
                    filter: filter(),
                    paint: { "line-color": ["get", "kante"], "line-width": 2, "line-dasharray": [2, 1.5] },
                },
                vorSchrift,
            );
        } else for (const ebene of Object.values(ENTWURF_EBENEN)) map.setFilter(ebene, filter());
    };

    // Nach einem Stilwechsel erst im nächsten Bild (`nachStilwechsel`: sonst zeichnet MapLibre die Füllebene unausgewertet).
    const stilAbmelden = nachStilwechsel(map, () => anlegen(false));

    return {
        zeige(neu) {
            if (neu.length === 0 && flaechen.length === 0) return;
            flaechen = neu;
            anlegen(true);
        },
        entferne() {
            stilAbmelden();
            flaechen = [];
            for (const ebene of Object.values(ENTWURF_EBENEN)) if (map.getLayer(ebene)) map.removeLayer(ebene);
            if (map.getSource(ENTWURF_QUELLE)) map.removeSource(ENTWURF_QUELLE);
        },
    };
}
