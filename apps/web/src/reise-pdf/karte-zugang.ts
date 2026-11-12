import type { InjectionKey } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Camera } from "../map/camera/camera";
import type { KartenAnsicht, WahlSerie } from "./einstellungen";

/**
 * Was „Reise als PDF“ von der Karte braucht, um das Kartenbild des Deckblatts aufzunehmen (WI-0306): die Leinwand, die Kamera, die Ansicht
 * der Karte zum Lesen und vorübergehenden Umschalten und die Serien, die dieser Betrachter wählen darf. `app.vue` stellt es bereit; das
 * Fenster lädt nach und nimmt es per `inject`. Ohne Zugang (eine Probeseite, ein Bauteiltest) bleibt das Deckblatt ohne Kartenbild.
 *
 * 🔴 Die Kamera bewegt nur `map/camera/camera.ts` (die Kamera fliegt, springt nie); dieser Zugang reicht sie nur durch. Wer die Ansicht
 * umschaltet, stellt sie danach wieder her, wie sie war (`kartenbild-aufnahme.ts`).
 */
export interface ReisePdfKarte {
    karte(): MapLibreMap | undefined;
    kamera(): Camera | undefined;
    ansicht(): KartenAnsicht;
    setzeAnsicht(ansicht: KartenAnsicht): void;
    /** Die Serien des Fächers in seiner Folge, die nur unter „Nur Karte“ markiert. */
    serien(): readonly WahlSerie[];
    vorgabeSerie(): string;
    /** Sind die Gebiete geladen? Ohne sie zeigt die Karte statt „Politisch“ die Standardansicht. */
    politischBereit(): boolean;
}

export const REISE_PDF_KARTE: InjectionKey<ReisePdfKarte> = Symbol("reise-pdf-karte");
