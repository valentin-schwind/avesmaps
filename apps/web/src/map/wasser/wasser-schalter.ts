import { computed, ref, watch } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapView } from "@avesmaps3d/shared";
import type { Reisebeginn } from "../wetter/wetter-jahr";
import { wetterDatum, wettermodellZaehler, wetterSperre } from "../wetter/wetter-schalter";
import type { WasserEbene } from "./wasser-ebene";

/**
 * Das Wasser in 3D (WI-0288 Stufe 5; Betreiber 2026-11-07: „In 2D gibt es keinen Ozean-Shader. In 3D ist er aktiv, das Wasser ist
 * standardmäßig animiert. Der Shader gilt auch für Seen.“). Dieses Modul hält nur den Zustand; die Ebene (`wasser-ebene.ts`) lädt es erst,
 * wenn die Karte zum ersten Mal in 3D steht, als eigenen kleinen Chunk ohne die Wolken- und Strömungsrechnung des Wetters.
 *
 * - **3D heißt: das Gelände steht** (`terrain.ts`, ab der ersten Neigung). Ohne Gelände (flach, 3D-Gelände pausiert, ohne Grafikkarte)
 *   gibt es kein Wasser, und nichts wird geladen.
 * - **Wo es Wetter gibt:** in der Ansicht „Standard“ (`wetterSperre`), wie die Wetterschalter, seit 2026-11-08 auch am Telefon. Das Wasser
 *   läuft in 3D für alle, unabhängig von den Wetterschaltern; es steht still bei `prefers-reduced-motion` und wenn die Automatik der Ebene es
 *   anhält.
 * - **Ein- und ausschalten** nur für alle zugleich, in der Systemsteuerung unter „Standardwerte“, Panel „OceanShader an/aus“
 *   (`ozeanShaderAn`, Betreiber 2026-11-08). Aus heißt: Der Chunk wird nicht geladen. Gelesen beim Öffnen der Karte (`startansicht`).
 * - Das Datum (für die Sonne) und der Glanz kommen wie beim Wetter: Reisebeginn plus Replay, Wettermodell aus `GET /api/wetter`.
 */

export interface WasserUmgebung {
    ansicht: () => MapView;
    reisebeginn: () => Reisebeginn;
    reisetage?: () => number | null;
    /** Der Standardwert „OceanShader an/aus“ (`ozeanShaderAn`); ohne Angabe an. */
    erlaubt?: () => boolean;
}

/** Läuft das Wasser? Nur in 3D, wo es Wetter gibt, und wenn die Standardwerte es erlauben. */
export function wasserLaeuft(ansicht: MapView, dreiD: boolean, erlaubt = true): boolean {
    return erlaubt && dreiD && wetterSperre(ansicht) === undefined;
}

/** Steht das Gelände der Karte? MapLibre hält es unter `terrain`, solange die Karte geneigt ist (`installTerrain`). */
export function gelaendeSteht(map: MapLibreMap): boolean {
    const gelaende = (map as unknown as { terrain?: { exaggeration?: number } | null }).terrain;
    return gelaende !== undefined && gelaende !== null;
}

export type WasserEbenenBau = (map: MapLibreMap, datum: () => number | null) => WasserEbene;

/** Der eine dynamische Import: Ebene, Flächen und Shader des Wassers liegen in einem eigenen Chunk. */
const ladeWasserEbene = (): Promise<WasserEbenenBau> =>
    import("./wasser-ebene").then((m) => (map, datum) => m.erzeugeWasserEbene(map, datum));

/**
 * Hängt das Wasser an die Karte. Solange sie flach ist (oder die Sperre greift), passiert nichts; in 3D lädt es die Ebene einmal nach und
 * schaltet sie ein, flach oder in einer anderen Ansicht nimmt es sie von der Karte.
 */
export function installWasser(
    map: MapLibreMap,
    umgebung: WasserUmgebung,
    lade: () => Promise<WasserEbenenBau> = ladeWasserEbene,
): () => void {
    let ebene: WasserEbene | undefined;
    let laedt = false;
    let beendet = false;
    const dreiD = ref(gelaendeSteht(map));
    const pruefe = (): void => {
        dreiD.value = gelaendeSteht(map);
    };
    // `setTerrain` meldet jedes An und Aus (`terrain`); ein neuer Stil kann es ebenso ändern.
    map.on("terrain", pruefe);
    map.on("styledata", pruefe);
    const laeuft = computed(() => wasserLaeuft(umgebung.ansicht(), dreiD.value, umgebung.erlaubt?.() ?? true));
    const datum = (): number | null => wetterDatum(umgebung.reisebeginn(), umgebung.reisetage?.());
    const anwenden = (): void => {
        if (!ebene) return;
        if (laeuft.value) ebene.ein();
        else ebene.aus();
    };
    const stop = watch(
        laeuft,
        (an) => {
            if (ebene || !an) {
                anwenden();
                return;
            }
            if (laedt) return;
            laedt = true;
            lade()
                .then((bau) => {
                    if (beendet) return;
                    ebene = bau(map, datum);
                    anwenden();
                })
                .catch((fehler: unknown) => console.error("Wasser ließ sich nicht laden", fehler))
                .finally(() => {
                    laedt = false;
                });
        },
        { immediate: true },
    );
    // Der Glanz steht im Wettermodell der Systemsteuerung (Panel „Wasser“); gespeichert gilt er ohne Neuladen.
    const stopModell = watch(wettermodellZaehler, () => {
        ebene?.neuLesen().catch((fehler: unknown) => console.error("Wasser ließ sich nicht neu lesen", fehler));
    });
    return () => {
        beendet = true;
        stop();
        stopModell();
        map.off("terrain", pruefe);
        map.off("styledata", pruefe);
        ebene?.aus();
    };
}
