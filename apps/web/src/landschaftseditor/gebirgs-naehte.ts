import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA,
    canonColour,
    EDITOR_LANDSCAPE_NAEHTE_URL,
    toRenderLngLat,
    type EditorGebirgsNaehte,
    type LandscapeSelection,
    type MapView,
} from "@avesmaps3d/shared";

/**
 * Gemeinsame Grenzen auf der Karte (OPS-000089, Vali 2026-11-07: „für die editoren soll sichtbar sein, dass sich gebirge eine gemeinsame grenze teilen - sprich die grenzlinie kann dünner
 * sein oder eine andere farbe haben oder so“): Über der Kante der Fläche eine dünne violette Linie (Rot heißt im Editor: wird gerade bearbeitet; Blau sind die Flüsse). Nur für Editoren, die Gebirge bearbeiten, und nur, solange die Karte die Topographie zeigt (`naehteSichtbar`);
 * die Kacheln und die Besucher wissen nichts davon. Der Server sagt, was angedockt ist (`terrain/gebirgs-naehte.ts`); gilt das in dieser Fassung nicht, ist die Liste leer.
 */

export const NAEHTE_QUELLE = "editor-gebirgs-naehte";
export const NAEHTE_EBENE = "editor-gebirgs-naehte-linie";

const space = AVENTURIA.coordinateSpace;

/**
 * Steht die Naht? Nur, solange jemand Gebirge bearbeitet, dann an allen Gebirgen, und die Karte die Topographie wirklich zeigt:
 * Landschaften, Ebene „Alle“ oder „Topographie“ und das Auge „Ebenen“ an (Vali 2026-11-11: „das problem ist dass sie eingeschaltet
 * sind auch wenn die ebenen aus sind. vorschlag nur im editormodus und nur bei topographie sichtbar“, „am besten wär sogar nur wenn man
 * gebirge editiert“, „aber dann gerne bei allen gebirgen, sodass man alle verbindungen sieht solang man gebirge editiert“). Den
 * Editor-Modus (`/edit`) prüft die Einbindung in `app.vue` wie bei Sperren und Verborgenen (`use_editor_menu`).
 */
export function naehteSichtbar(karte: {
    ansicht: MapView;
    ebene: LandscapeSelection;
    flaechen: boolean;
    gebirge: boolean;
}): boolean {
    return (
        karte.gebirge &&
        karte.ansicht === "landscapes" &&
        karte.flaechen &&
        (karte.ebene === "alle" || karte.ebene === "topographie")
    );
}

export interface GebirgsNaehte {
    /** Zeigen oder ausblenden; beim ersten Zeigen lädt sie. */
    zeige(an: boolean): void;
    /** Neu vom Server (nach dem Speichern); ausgeblendet erst beim nächsten Zeigen. */
    lade(): void;
    entferne(): void;
}

export function installGebirgsNaehte(map: MapLibreMap, abruf: typeof fetch = (e, i) => fetch(e, i)): GebirgsNaehte {
    let an = false;
    let kanten: EditorGebirgsNaehte["kanten"] | undefined;
    let steuer: AbortController | undefined;

    const daten = () => ({
        type: "FeatureCollection" as const,
        features: (kanten ?? []).map((kante) => ({
            type: "Feature" as const,
            properties: {},
            geometry: {
                type: "LineString" as const,
                coordinates: kante.map(([x, y]) => {
                    const p = toRenderLngLat(space, { x: x!, y: y! });
                    return [p.lng, p.lat];
                }),
            },
        })),
    });

    const zeichne = (): void => {
        const quelle = map.getSource(NAEHTE_QUELLE) as GeoJSONSource | undefined;
        if (quelle === undefined) map.addSource(NAEHTE_QUELLE, { type: "geojson", data: daten() });
        else quelle.setData(daten());
        if (map.getLayer(NAEHTE_EBENE) === undefined)
            map.addLayer({
                id: NAEHTE_EBENE,
                type: "line",
                source: NAEHTE_QUELLE,
                paint: { "line-color": canonColour("mapSharedEdge"), "line-width": 1.25 },
            });
    };
    // Nur auf den Stil warten, nicht auf alle Kacheln (wie `gipfel-hervorhebung.ts`).
    const anlegen = (): void => {
        if (!an) return;
        try {
            zeichne();
        } catch {
            map.once("styledata", anlegen);
        }
    };
    const weg = (): void => {
        if (map.getLayer(NAEHTE_EBENE)) map.removeLayer(NAEHTE_EBENE);
        if (map.getSource(NAEHTE_QUELLE)) map.removeSource(NAEHTE_QUELLE);
    };
    const nachStil = (): void => {
        if (an && map.getLayer(NAEHTE_EBENE) === undefined) anlegen();
    };
    map.on("styledata", nachStil);

    const lade = (): void => {
        steuer?.abort();
        const jetzt = new AbortController();
        steuer = jetzt;
        abruf(EDITOR_LANDSCAPE_NAEHTE_URL, { credentials: "same-origin", signal: jetzt.signal })
            .then(async (antwort) => {
                if (!antwort.ok || steuer !== jetzt) return;
                kanten = ((await antwort.json()) as EditorGebirgsNaehte).kanten;
                anlegen();
            })
            // Eine Hilfe, kein Teil der Bearbeitung: Fehlt sie, fehlt nur die Linie.
            .catch(() => undefined);
    };

    return {
        zeige(neu) {
            if (neu === an) return;
            an = neu;
            if (!an) {
                steuer?.abort();
                weg();
            } else if (kanten === undefined) lade();
            else anlegen();
        },
        lade() {
            if (an) lade();
            else kanten = undefined;
        },
        entferne() {
            an = false;
            steuer?.abort();
            map.off("styledata", nachStil);
            weg();
        },
    };
}
