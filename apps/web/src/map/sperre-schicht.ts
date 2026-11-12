import { Marker, type FilterSpecification, type Map as MapLibreMap } from "maplibre-gl";
import { h, render } from "vue";
import { AVENTURIA, toRenderLngLat, type EditorLock } from "@avesmaps3d/shared";
import {
    LANDSCAPE_FILL_LAYER_IDS,
    LANDSCAPE_SOURCE_ID,
    LANDSCAPE_SOURCE_LAYER,
    landscapeFillLayerId,
} from "./landscape-layers";
import { PATH_HIT_LAYER_IDS, PATH_SOURCE_ID, PATH_SOURCE_LAYER } from "./path-layers";
import { POWERLINE_HIT_LAYER_ID, POWERLINE_SOURCE_ID, POWERLINE_SOURCE_LAYER } from "./powerline-layers";
import { schildLage } from "../editor-sperre/fremde-sperren";
import SperreSchild from "./sperre-schild.vue";
import { nachStilwechsel } from "./style-ready";

/**
 * Die Sperre auf der Karte (EDIT-0003 §4, T27 (3); S3): über jeder Landschaft, die ein anderer gerade bearbeitet, eine Schraffur, und
 * auf ihr das Schild „🔒 Thomas · Form · seit 07:32“, solange die Sperre gilt, nicht erst beim Klick. Beim Überfahren sagt das Schild,
 * seit wann zuletzt aktiv und ab wann frei.
 *
 * - 🔴 **Grau-Braun aus dem Kanon, nie Rot** (`--color-button-border`): Rot heißt „ich bearbeite“ (EDIT-0003 T1).
 * - Nur, wo die Karte die Ebene der Landschaft zeigt: Die Schraffur folgt den Flächenebenen im Stil, das Schild der Ebene der Sperre.
 * - Ein Stilwechsel (`setStyle` mit `diff`) nimmt die Ebene mit; sie kommt mit `styledata` wieder, wie die Geometrie-Schicht.
 * - Am Ort (WI-0208) steht nur das Schild, über der Marke; die Schraffur trifft nur Landschaften (`region_public_id`).
 * - An Linien (WI-0205 K11, Anzeige; Kopf `sperren-an-linien-schnittstelle.md`): eine gestrichelte Spur auf den Abschnitten der Sperre
 *   (`sections`), beim Weg auf der Quelle der Wege, bei der Kraftlinie auf ihrer Bodenbahn unter den Bögen; das Schild in der Mitte.
 *   Beides nur, wo die Karte die Linien zeigt (Wege mit ihren Trefferebenen, Kraftlinien in ihrer Ansicht).
 */
export const SPERRE_SCHRAFFUR_EBENE = "editor-sperre-schraffur";
/** Die Spur einer gesperrten Linie, je Quelle eine Ebene. */
export const SPERRE_LINIEN_EBENEN = {
    path: { ebene: "editor-sperre-weg", quelle: PATH_SOURCE_ID, lage: PATH_SOURCE_LAYER },
    powerline: { ebene: "editor-sperre-kraftlinie", quelle: POWERLINE_SOURCE_ID, lage: POWERLINE_SOURCE_LAYER },
} as const;
const MUSTER = "editor-sperre-muster";
/** Die Kachel des Musters: quadratisch und eine Zweierpotenz, sonst setzen sich die Streifen an der Kachelgrenze nicht fort. */
const KANTE = 32;
/** Die Periode der Streifen entlang x + y (bei 45° hängt die Farbe nur an der Summe): 4 Streifen je Kachel. */
const PERIODE = 8;

export interface SperreSchicht {
    /** Die geltenden Sperren der anderen, mit Text des Schilds und seinem Titel beim Überfahren. */
    zeige(sperren: readonly EditorLock[], text: (sperre: EditorLock) => { schild: string; titel: string }): void;
    entferne(): void;
}

function farbeAus(css: string): [number, number, number] {
    const hex = /^#([0-9a-f]{6})$/i.exec(css.trim())?.[1] ?? "635b4d";
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Diagonale Streifen in der Farbe der Sperre über einem hellen Schleier (wie das Probierblatt: Streifen 55 %, Grund 22 % Weiß). */
function musterBild(farbe: [number, number, number]): { width: number; height: number; data: Uint8Array } {
    const data = new Uint8Array(KANTE * KANTE * 4);
    for (let y = 0; y < KANTE; y += 1) {
        for (let x = 0; x < KANTE; x += 1) {
            const i = (y * KANTE + x) * 4;
            const streifen = (x + y) % PERIODE < 2;
            const [r, g, b] = streifen ? farbe : [255, 255, 255];
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = Math.round((streifen ? 0.55 : 0.22) * 255);
        }
    }
    return { width: KANTE, height: KANTE, data };
}

export function installSperreSchicht(map: MapLibreMap, farbe: string): SperreSchicht {
    let sperren: readonly EditorLock[] = [];
    let text: (sperre: EditorLock) => { schild: string; titel: string } = () => ({ schild: "", titel: "" });
    const schilder = new Map<string, Marker>();
    const space = AVENTURIA.coordinateSpace;

    /** Die Ebenen, deren Flächen die Karte gerade zeichnet. */
    const sichtbareEbenen = (): string[] =>
        ["derographisch", "vegetation", "topographie"].filter((ebene) => map.getLayer(landscapeFillLayerId(ebene)));

    const filter = (): FilterSpecification =>
        [
            "all",
            ["in", ["get", "region_public_id"], ["literal", sperren.map((sperre) => sperre.id)]],
            ["in", ["get", "region_layer"], ["literal", sichtbareEbenen()]],
        ] as FilterSpecification;

    /** Legt Muster und Ebene an, wenn sie fehlen; `mitFilter` setzt den Filter neu (nie aus `styledata`: das gäbe eine Schleife). */
    const anlegen = (mitFilter: boolean): void => {
        if (map.getSource(LANDSCAPE_SOURCE_ID) === undefined) return;
        if (!map.hasImage(MUSTER)) map.addImage(MUSTER, musterBild(farbeAus(farbe)), { pixelRatio: 2 });
        if (map.getLayer(SPERRE_SCHRAFFUR_EBENE) === undefined) {
            // Über der obersten Flächenebene, unter allem, was danach kommt (Kanten der Auswahl, Namen, Orte).
            const ebenen = map.getStyle().layers ?? [];
            const letzte = ebenen.reduce(
                (stelle, ebene, i) => (LANDSCAPE_FILL_LAYER_IDS.includes(ebene.id) ? i : stelle),
                -1,
            );
            const davor = letzte >= 0 ? ebenen[letzte + 1]?.id : undefined;
            map.addLayer(
                {
                    id: SPERRE_SCHRAFFUR_EBENE,
                    type: "fill",
                    source: LANDSCAPE_SOURCE_ID,
                    "source-layer": LANDSCAPE_SOURCE_LAYER,
                    filter: filter(),
                    paint: { "fill-pattern": MUSTER },
                },
                davor,
            );
        } else if (mitFilter) map.setFilter(SPERRE_SCHRAFFUR_EBENE, filter());
    };

    /** Die Abschnitte der gesperrten Linien einer Art (ohne `sections` das Objekt selbst). */
    const abschnitte = (art: keyof typeof SPERRE_LINIEN_EBENEN): string[] =>
        sperren.filter((sperre) => sperre.kind === art).flatMap((sperre) => sperre.sections ?? [sperre.id]);
    const linienFilter = (art: keyof typeof SPERRE_LINIEN_EBENEN): FilterSpecification =>
        ["in", ["get", "public_id"], ["literal", abschnitte(art)]] as FilterSpecification;
    /** Die Spur der Linien: unter den Namen (vor der ersten Schriftebene), gestrichelt in der Farbe der Sperre. */
    const linienAnlegen = (mitFilter: boolean): void => {
        for (const [art, { ebene, quelle, lage }] of Object.entries(SPERRE_LINIEN_EBENEN) as [
            keyof typeof SPERRE_LINIEN_EBENEN,
            (typeof SPERRE_LINIEN_EBENEN)[keyof typeof SPERRE_LINIEN_EBENEN],
        ][]) {
            if (map.getSource(quelle) === undefined) continue;
            if (map.getLayer(ebene) === undefined) {
                const vorSchrift = (map.getStyle().layers ?? []).find((schicht) => schicht.type === "symbol")?.id;
                map.addLayer(
                    {
                        id: ebene,
                        type: "line",
                        source: quelle,
                        "source-layer": lage,
                        filter: linienFilter(art),
                        layout: { "line-cap": "butt", "line-join": "round" },
                        paint: {
                            "line-color": farbe,
                            "line-width": 5,
                            "line-opacity": 0.85,
                            "line-dasharray": [1.2, 1.2],
                        },
                    },
                    vorSchrift,
                );
            } else if (mitFilter) map.setFilter(ebene, linienFilter(art));
        }
    };
    /** Zeigt die Karte, was die Sperre trifft? */
    const sichtbar = (sperre: EditorLock, ebenen: ReadonlySet<string>): boolean => {
        if (sperre.kind === "path") return PATH_HIT_LAYER_IDS.some((id) => map.getLayer(id) !== undefined);
        if (sperre.kind === "powerline") return map.getLayer(POWERLINE_HIT_LAYER_ID) !== undefined;
        return sperre.layer === undefined || ebenen.has(sperre.layer);
    };

    const schilderZeigen = (): void => {
        const ebenen = new Set(sichtbareEbenen());
        const sollen = sperren.filter((sperre) => sperre.at !== undefined && sichtbar(sperre, ebenen));
        for (const [id, schild] of schilder) {
            if (sollen.some((sperre) => sperre.id === id)) continue;
            render(null, schild.getElement());
            schild.remove();
            schilder.delete(id);
        }
        for (const sperre of sollen) {
            const { schild: aufschrift, titel } = text(sperre);
            const vorhanden = schilder.get(sperre.id);
            const element = vorhanden?.getElement() ?? document.createElement("div");
            render(h(SperreSchild, { aufschrift, titel }), element);
            const lngLat = toRenderLngLat(space, sperre.at!);
            if (vorhanden) vorhanden.setLngLat([lngLat.lng, lngLat.lat]);
            else
                schilder.set(
                    sperre.id,
                    new Marker({ element, ...schildLage(sperre) }).setLngLat([lngLat.lng, lngLat.lat]).addTo(map),
                );
        }
    };

    const nachStil = (): void => {
        anlegen(false);
        linienAnlegen(false);
        schilderZeigen();
    };
    // Nach einem Stilwechsel erst im nächsten Bild (`nachStilwechsel`: sonst zeichnet MapLibre die Füllebene unausgewertet).
    const stilAbmelden = nachStilwechsel(map, nachStil);
    anlegen(true);
    linienAnlegen(true);

    return {
        zeige(neu, neuerText) {
            sperren = neu;
            text = neuerText;
            anlegen(true);
            linienAnlegen(true);
            schilderZeigen();
        },
        entferne() {
            stilAbmelden();
            for (const schild of schilder.values()) {
                render(null, schild.getElement());
                schild.remove();
            }
            schilder.clear();
            if (map.getLayer(SPERRE_SCHRAFFUR_EBENE) !== undefined) map.removeLayer(SPERRE_SCHRAFFUR_EBENE);
            for (const { ebene } of Object.values(SPERRE_LINIEN_EBENEN))
                if (map.getLayer(ebene) !== undefined) map.removeLayer(ebene);
        },
    };
}
