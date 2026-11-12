import type { LayerSpecification } from "maplibre-gl";
import { shallowRef } from "vue";
import {
    AVENTURIA_ZOOM_BANDS,
    MAX_BAND,
    ZOOMBAND_SPUREN,
    ZOOM_BANDS_URL,
    reiheMitSpanne,
    renderZoomForBand,
    wirksameZoombaender,
    zoombandSpur,
    type Zoomspanne,
} from "@avesmaps3d/shared";

/**
 * Die Zoombänder im Browser (WI-0221): die Abweichungen aus der Systemsteuerung (`GET /api/zoom-bands`), zusammengerechnet mit den
 * Vorgaben des geteilten Pakets. `main.ts` liest sie VOR dem Start, neben Sitzung, Startansicht und Kartenserien; die Karte
 * entsteht mit den richtigen Spannen.
 *
 * - **Fehlerrichtung:** Ohne Antwort gelten die Vorgaben, nie ein Fehler. Tolerant gelesen (`wirksameZoombaender` übergeht, was
 *   nicht passt).
 * - Reaktiv: Speichert der Reiter „Zoombänder“, liest er neu; die Karte baut ihren Stil beim nächsten Wechsel neu, spätestens beim
 *   nächsten Laden (das sagt der Reiter so).
 */

export const ZOOMBAENDER_WAIT_MS = 2_500;

const wirksam = shallowRef<Record<string, Zoomspanne>>(wirksameZoombaender({}));

export async function ladeZoombaender(
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    waitMs: number = ZOOMBAENDER_WAIT_MS,
): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
        const response = await fetcher(ZOOM_BANDS_URL, { signal: controller.signal, cache: "no-cache" });
        if (response.ok) {
            const body = (await response.json()) as { abweichungen?: unknown } | null;
            const abweichungen = body?.abweichungen;
            if (typeof abweichungen === "object" && abweichungen !== null) {
                wirksam.value = wirksameZoombaender(abweichungen as Record<string, unknown>);
            }
        }
    } catch {
        // Ohne Antwort gelten die Vorgaben.
    } finally {
        clearTimeout(timer);
    }
}

/** Die wirksame Spanne einer Spur (`orte.dorf.name` …); eine unbekannte Spur reicht über alle Bänder. */
export function zoomspanne(id: string): Zoomspanne {
    return wirksam.value[id] ?? { von: 0, bis: 8 };
}

/** Alle wirksamen Spannen (reaktiv, für den Neubau des Stils). */
export function zoombaenderStand(): Readonly<Record<string, Zoomspanne>> {
    return wirksam.value;
}

/** Nur für Tests. */
export function zoombaenderSetzen(abweichungen: Record<string, unknown>): void {
    wirksam.value = wirksameZoombaender(abweichungen);
}

/**
 * Die Ortsreihen der Karte auf die wirksamen Spannen gebracht (Zeichen und Namen je Klasse), dazu die Obergrenzen und die Bänder von
 * Raute und Goldring. `place-layers.ts` liest nur das, nicht mehr die Erscheinungsstufen der Größenreihen.
 */
export function ortsreihen(): {
    marker: Record<string, (number | null)[]>;
    label: Record<string, (number | null)[]>;
    markerBis: Record<string, number>;
    labelBis: Record<string, number>;
    rauteAb: number;
    goldringAb: number;
} {
    const marker: Record<string, (number | null)[]> = {};
    const label: Record<string, (number | null)[]> = {};
    const markerBis: Record<string, number> = {};
    const labelBis: Record<string, number> = {};
    for (const klasse of Object.keys(AVENTURIA_ZOOM_BANDS.marker)) {
        const zeichen = zoomspanne(`orte.${klasse}.zeichen`);
        const name = zoomspanne(`orte.${klasse}.name`);
        marker[klasse] = reiheMitSpanne([...(AVENTURIA_ZOOM_BANDS.marker[klasse] ?? [])], zeichen, null);
        label[klasse] = reiheMitSpanne([...(AVENTURIA_ZOOM_BANDS.label[klasse] ?? [])], name, null);
        markerBis[klasse] = zeichen.bis;
        labelBis[klasse] = name.bis;
    }
    return {
        marker,
        label,
        markerBis,
        labelBis,
        rauteAb: zoomspanne("orte.bauwerk.zeichen").von,
        goldringAb: zoomspanne("orte.goldring.zeichen").von,
    };
}

/**
 * `minzoom` und `maxzoom` einer Ebene aus der Spanne ihrer Spur (Band n gilt ab Zoom n + 1, bis vor n + 2). Solange `von` der
 * Vorgabe entspricht, bleibt der Kanonwert `kanonAb` stehen (auch gebrochen, etwa bei den Höhenlinien); erst eine verstellte
 * Spanne setzt die Bandgrenze.
 */
export function ebenenGrenzen(id: string, kanonAb?: number): { minzoom?: number; maxzoom?: number } {
    const spanne = zoomspanne(id);
    const vorgabe = zoombandSpur(id)?.vorgabe;
    const ab =
        kanonAb !== undefined && vorgabe?.von === spanne.von
            ? kanonAb
            : spanne.von > 0
              ? renderZoomForBand(spanne.von)
              : undefined;
    return {
        ...(ab === undefined ? {} : { minzoom: ab }),
        ...(spanne.bis < MAX_BAND ? { maxzoom: renderZoomForBand(spanne.bis + 1) } : {}),
    };
}

/** Die Spanne einer Spur als Filterbedingungen (`["zoom"]` im Filter ist der ganzzahlige Kachelzoom, also die Bandgrenze). */
export function spannenBedingungen(id: string): unknown[] {
    const { von, bis } = zoomspanne(id);
    return [
        ...(von > 0 ? [[">=", ["zoom"], renderZoomForBand(von)]] : []),
        ...(bis < MAX_BAND ? [["<", ["zoom"], renderZoomForBand(bis + 1)]] : []),
    ];
}

/** Liegt ein Render-Zoom in der Spanne einer Spur? Für, was MapLibre nicht zeichnet (die glühenden Knoten der Bögen). */
export function inSpanne(id: string, zoom: number): boolean {
    const { von, bis } = zoomspanne(id);
    return (von === 0 || zoom >= renderZoomForBand(von)) && (bis >= MAX_BAND || zoom < renderZoomForBand(bis + 1));
}

/**
 * Die verstellten Spannen einer Spurart je Zeile (`landschaften`/`name` → je Landschaftsart). Was der Vorgabe entspricht, fehlt:
 * Dort trägt schon die Kachel das Band, und der Stil bleibt, wie er war.
 */
export function abweichendeSpannen(gruppe: string, spur: string): Record<string, Zoomspanne> {
    const aus: Record<string, Zoomspanne> = {};
    for (const eintrag of ZOOMBAND_SPUREN) {
        if (eintrag.gruppe !== gruppe || eintrag.spur !== spur) continue;
        const spanne = zoomspanne(eintrag.id);
        if (spanne.von !== eintrag.vorgabe.von || spanne.bis !== eintrag.vorgabe.bis) aus[eintrag.zeile] = spanne;
    }
    return aus;
}

/** Eine Ebene auf die Spanne einer Spur begrenzt: `minzoom` nie früher als ihr eigener, `maxzoom` nie später. Ohne Abweichung dieselbe. */
export function mitSpanne<T extends LayerSpecification>(id: string): (ebene: T) => T {
    const grenzen = ebenenGrenzen(id);
    return (ebene) =>
        grenzen.minzoom === undefined && grenzen.maxzoom === undefined
            ? ebene
            : {
                  ...ebene,
                  ...(grenzen.minzoom === undefined ? {} : { minzoom: Math.max(grenzen.minzoom, ebene.minzoom ?? 0) }),
                  ...(grenzen.maxzoom === undefined
                      ? {}
                      : { maxzoom: Math.min(grenzen.maxzoom, ebene.maxzoom ?? grenzen.maxzoom) }),
              };
}
