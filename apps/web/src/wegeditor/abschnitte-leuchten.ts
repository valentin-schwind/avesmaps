import type { GeoJSONSource, Map as MapLibreMap, MapSourceDataEvent } from "maplibre-gl";
import { canonColour } from "@avesmaps3d/shared";
import { PATH_SOURCE_ID, PATH_SOURCE_LAYER } from "../map/path-layers";
import { LABEL_FONT } from "../map/place-layers";

/**
 * Die Abschnitte einer Straße auf der Karte, solange ihr Untermenü offen ist (WI-0177; EDIT-0003 T49; Probierseite „Abschnitte im Menü“)
 * oder ein Wege-Fenster sie zeigt (Leiste (W) (1) (2) …, P6 Variante C): Die gezeigten oder gewählten Abschnitte leuchten (Knallrot
 * `editEdge` auf weißem Saum), die übrigen Abschnitte der Straße treten blass zurück, und an jedem Abschnitt im Bild steht seine
 * Nummer. Ohne gezeigten Abschnitt ((W), der ganze Weg) stehen nur die Nummern.
 *
 * - 🔴 **Nie gestrichelt** (Stage-Fund des Betreibers 2026-10-19: „wenn ich wege editier wird es automatisch gestrichelt“): Gestrichelt
 *   heißt auf der Karte Tunnel (Migration 0172). Bis dahin trat der Rest gestrichelt zurück, und bei (W) traf das den ganzen Weg.
 *
 * Gezeichnet wird aus den Kacheln der Wege (`paths`, `path_render`) über die Kennung `public_id`: keine zweite Geometrie, kein Server.
 * Die Nummern sitzen in der Mitte der Linie, wie die Kachel sie kennt (`querySourceFeatures`); ein Abschnitt ohne geladene Kachel hat
 * keine.
 * - 🔴 **Die Nummern folgen den Kacheln** (Betreiber 2026-10-19: „beim anklicken kommen nicht die zahlen“): Sie wurden nur beim Zeigen
 *   gerechnet. Nach dem Flug der Kamera, beim Verschieben und nach jedem Speichern (die Wege laden neu) fehlten sie darum. Jetzt rechnet
 *   die Schicht sie nach jeder Bewegung und jedem fertig geladenen Stand der Wege nach und setzt sie nur, wenn sie sich ändern.
 */

/** So lange sammelt die Schicht Bewegungen und Kacheln, bevor sie die Nummern nachrechnet. */
export const NUMMERN_NACHFUEHREN_MS = 120;

const GEDAEMPFT = "weg-abschnitte-gedaempft";
const SAUM = "weg-abschnitte-saum";
const HERVOR = "weg-abschnitte-hervor";
const NUMMERN_QUELLE = "weg-abschnitte-nummern";
const NUMMERN_KREIS = "weg-abschnitte-nummern-kreis";
const NUMMERN_TEXT = "weg-abschnitte-nummern-text";
const EBENEN = [GEDAEMPFT, SAUM, HERVOR, NUMMERN_KREIS, NUMMERN_TEXT] as const;

export interface AbschnitteBild {
    /** Die Abschnitte der Straße in ihrer Folge (die Nummer ist die Stelle + 1). */
    readonly ids: readonly string[];
    /** Die gezeigten oder gewählten Abschnitte; keiner: nur die Nummern. */
    readonly hervor: readonly string[];
}

export interface AbschnitteLeuchten {
    zeige(bild: AbschnitteBild | undefined): void;
}

type Punkt = [number, number];

/**
 * Die Nummern als GeoJSON, mit eigenem Typ: 🪤 `import … from "geojson"` holt `@types/geojson` ins Programm (`types` nennt nur
 * `vite/client`), und dann werden MapLibres `GeoJSON.Geometry` in fremden Dateien streng (Typcheck rot in `owners.ts` und anderen).
 */
interface Nummern {
    readonly type: "FeatureCollection";
    readonly features: readonly {
        readonly type: "Feature";
        readonly properties: { readonly nr: string };
        readonly geometry: { readonly type: "Point"; readonly coordinates: Punkt };
    }[];
}

/** Die Mitte einer Linie entlang ihrer Länge (Bildkoordinaten der Kachel sind hier Längen und Breiten). */
function mitteVon(linie: readonly Punkt[]): Punkt | undefined {
    if (linie.length === 0) return undefined;
    let laenge = 0;
    for (let i = 1; i < linie.length; i += 1)
        laenge += Math.hypot(linie[i]![0] - linie[i - 1]![0], linie[i]![1] - linie[i - 1]![1]);
    let rest = laenge / 2;
    for (let i = 1; i < linie.length; i += 1) {
        const a = linie[i - 1]!;
        const b = linie[i]!;
        const stueck = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (stueck >= rest && stueck > 0) {
            const t = rest / stueck;
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
        rest -= stueck;
    }
    return linie.at(-1);
}

export function createAbschnitteLeuchten(karte: () => MapLibreMap | undefined): AbschnitteLeuchten {
    let jetzt: AbschnitteBild | undefined;
    /** Die zuletzt gesetzten Nummern; gleiche setzt die Schicht nicht noch einmal. */
    let gesetzt = "";
    let frist: ReturnType<typeof setTimeout> | undefined;

    function nummern(map: MapLibreMap, ids: readonly string[]): Nummern {
        const laengste = new Map<string, Punkt[]>();
        const features = map.querySourceFeatures(PATH_SOURCE_ID, {
            sourceLayer: PATH_SOURCE_LAYER,
            filter: ["in", ["get", "public_id"], ["literal", [...ids]]],
        });
        for (const feature of features) {
            const id = String(feature.properties["public_id"]);
            const g = feature.geometry;
            const linien: Punkt[][] =
                g.type === "LineString"
                    ? [g.coordinates as Punkt[]]
                    : g.type === "MultiLineString"
                      ? (g.coordinates as Punkt[][])
                      : [];
            for (const linie of linien) if ((laengste.get(id)?.length ?? 0) < linie.length) laengste.set(id, linie);
        }
        return {
            type: "FeatureCollection",
            features: ids.flatMap((id, i) => {
                const mitte = mitteVon(laengste.get(id) ?? []);
                return mitte === undefined
                    ? []
                    : [
                          {
                              type: "Feature" as const,
                              properties: { nr: String(i + 1) },
                              geometry: { type: "Point" as const, coordinates: mitte },
                          },
                      ];
            }),
        };
    }

    function entferne(map: MapLibreMap): void {
        for (const id of EBENEN) if (map.getLayer(id) !== undefined) map.removeLayer(id);
        if (map.getSource(NUMMERN_QUELLE) !== undefined) map.removeSource(NUMMERN_QUELLE);
        gesetzt = "";
    }

    /** Setzt die Nummern, wenn sie sich geändert haben (sonst löste jedes Setzen die nächste Runde Kacheln aus). */
    function setzeNummern(map: MapLibreMap, ids: readonly string[]): void {
        const daten = nummern(map, ids);
        const text = JSON.stringify(daten);
        const quelle = map.getSource<GeoJSONSource>(NUMMERN_QUELLE);
        if (quelle !== undefined && text === gesetzt) return;
        gesetzt = text;
        if (quelle) quelle.setData(daten);
        else map.addSource(NUMMERN_QUELLE, { type: "geojson", data: daten });
    }

    function zeichne(map: MapLibreMap, bild: AbschnitteBild): void {
        if (map.getSource(PATH_SOURCE_ID) === undefined) return;
        const hervor: ["literal", string[]] = ["literal", [...bild.hervor]];
        // Zurück treten nur die übrigen, solange einer gezeigt ist; bei (W) keiner.
        const blass: ["literal", string[]] = [
            "literal",
            bild.hervor.length === 0 ? [] : bild.ids.filter((id) => !bild.hervor.includes(id)),
        ];
        setzeNummern(map, bild.ids);
        const ebenen: Parameters<MapLibreMap["addLayer"]>[0][] = [
            {
                id: GEDAEMPFT,
                type: "line",
                source: PATH_SOURCE_ID,
                "source-layer": PATH_SOURCE_LAYER,
                filter: ["in", ["get", "public_id"], blass],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": canonColour("markerHairline"),
                    "line-width": 3,
                    "line-opacity": 0.75,
                },
            },
            {
                id: SAUM,
                type: "line",
                source: PATH_SOURCE_ID,
                "source-layer": PATH_SOURCE_LAYER,
                filter: ["in", ["get", "public_id"], hervor],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": canonColour("routeHalo"),
                    "line-width": 10,
                    "line-blur": 3,
                    "line-opacity": 0.9,
                },
            },
            {
                id: HERVOR,
                type: "line",
                source: PATH_SOURCE_ID,
                "source-layer": PATH_SOURCE_LAYER,
                filter: ["in", ["get", "public_id"], hervor],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": canonColour("editEdge"), "line-width": 5 },
            },
            {
                id: NUMMERN_KREIS,
                type: "circle",
                source: NUMMERN_QUELLE,
                paint: {
                    "circle-radius": 10,
                    "circle-color": canonColour("routeHalo"),
                    "circle-stroke-color": canonColour("editEdge"),
                    "circle-stroke-width": 2,
                },
            },
            {
                id: NUMMERN_TEXT,
                type: "symbol",
                source: NUMMERN_QUELLE,
                layout: {
                    "text-field": ["get", "nr"],
                    "text-font": [LABEL_FONT],
                    "text-size": 12,
                    "text-allow-overlap": true,
                    "text-ignore-placement": true,
                },
                paint: { "text-color": canonColour("editEdge") },
            },
        ];
        for (const ebene of ebenen) {
            if (map.getLayer(ebene.id) === undefined) map.addLayer(ebene);
            else if ("filter" in ebene && ebene.filter !== undefined) map.setFilter(ebene.id, ebene.filter);
        }
    }

    // Ein Stilwechsel (Ansicht) nimmt fremde Ebenen mit: Sie kommen zurück, solange das Untermenü offen ist. Nur wenn sie fehlen, sonst
    // löste das Setzen der Filter das nächste `styledata` aus.
    const nachStil = (): void => {
        const map = karte();
        if (map !== undefined && jetzt !== undefined && map.getLayer(HERVOR) === undefined) zeichne(map, jetzt);
    };
    const nachfuehren = (): void => {
        frist = undefined;
        const map = karte();
        if (map !== undefined && jetzt !== undefined && map.getSource(NUMMERN_QUELLE) !== undefined)
            setzeNummern(map, jetzt.ids);
    };
    const spaeter = (): void => {
        if (frist !== undefined) clearTimeout(frist);
        frist = setTimeout(nachfuehren, NUMMERN_NACHFUEHREN_MS);
    };
    const nachKacheln = (event: MapSourceDataEvent): void => {
        if (event.sourceId === PATH_SOURCE_ID && event.isSourceLoaded) spaeter();
    };

    return {
        zeige(bild) {
            const map = karte();
            const vorher = jetzt;
            jetzt = bild;
            if (map === undefined) return;
            if (bild === undefined) {
                entferne(map);
                map.off("styledata", nachStil);
                map.off("moveend", spaeter);
                map.off("sourcedata", nachKacheln);
                if (frist !== undefined) clearTimeout(frist);
                frist = undefined;
                return;
            }
            if (vorher === undefined) {
                map.on("styledata", nachStil);
                map.on("moveend", spaeter);
                map.on("sourcedata", nachKacheln);
            }
            zeichne(map, bild);
        },
    };
}
