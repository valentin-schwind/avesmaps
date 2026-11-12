import type { Map as MapLibreMap, SkySpecification, StyleSpecification } from "maplibre-gl";
import { KULISSEN_VORGABE, type KulissenWerte } from "./kulisse-werte";

/**
 * Himmel und Dunst der geneigten Karte (WI-0016, D6; neu WI-0290, Werte vom Betreiber am 2026-11-08 im klickbaren Entwurf eingestellt).
 *
 * Aventurien ist ein Quadrat und endet an seinem Rand. Geneigt sieht man dahinter; dort liegt die Kulisse (`kulisse.ts`): nach oben
 * der Himmel, nach unten eine weite Fläche bis zum Horizont, in der die Karte am Rand ausläuft. Die ferne Karte läuft in MapLibres Nebel
 * aus, der mit der Neigung kommt (wie bei Google Maps) und den Ton des Horizonts trägt, damit zwischen Gelände, Fläche und Himmel kein
 * eigener Streifen bleibt (vorher lag hier eine Dunstebene aus CSS mit einem dunkleren Dunstton deckend auf der fernen Kartenkante:
 * „blaugrauer Balken“).
 *
 * 🔴 Nichts davon sieht nach Land aus - es ist Kulisse, keine erfundene Geografie.
 *
 * 🪤 MapLibres Nebel (`fog`) gibt es nur mit Gelände. Die Kulisse rechnet ihren Dunst mit derselben Formel, sonst stünde am Kartenrand
 * eine Kante; sie setzt auch die Kurve, mit der er beim Neigen kommt. Sie lädt erst nach, wenn die Karte zum ersten Mal geneigt wird.
 */

let werte: KulissenWerte = KULISSEN_VORGABE;

function himmel(): SkySpecification {
    return {
        "sky-color": werte.zenit,
        "horizon-color": werte.dunst,
        "fog-color": werte.dunst,
        "sky-horizon-blend": 0.5,
        "horizon-fog-blend": 0.8,
        "fog-ground-blend": werte.beginn,
        "atmosphere-blend": 0,
    };
}

/** MapLibres Himmel und Nebel in den Tönen der Kulisse, an jeden Stil gehängt (auch bei `setStyle` mit `diff`). */
export function withAtmosphere(style: StyleSpecification): StyleSpecification {
    return { ...style, sky: himmel() };
}

export function installAtmosphere(map: MapLibreMap): () => void {
    let ab: (() => void) | undefined;
    let vorbei = false;
    const laden = (): void => {
        if (map.getPitch() < 1) return;
        map.off("pitch", laden);
        void import("./kulisse").then(({ installiereKulisse }) => {
            if (vorbei) return;
            const kulisse = installiereKulisse(map, (neu) => {
                werte = neu;
                if ((map as unknown as { style?: { _loaded?: boolean } }).style?._loaded === true) map.setSky(himmel());
            });
            ab = () => kulisse.ab();
            if (import.meta.env.DEV) (globalThis as { avesmapsHimmel?: unknown }).avesmapsHimmel = kulisse;
        });
    };
    map.on("pitch", laden);
    laden();
    return () => {
        vorbei = true;
        map.off("pitch", laden);
        ab?.();
    };
}
