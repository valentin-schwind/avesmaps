import type { Map as MapLibreMap } from "maplibre-gl";
import { watch, type Ref, type WatchStopHandle } from "vue";
import { AVENTURIA, SEARCH_FIT_MAX_ZOOM, toRenderLngLat } from "@avesmaps3d/shared";
import type { Camera } from "../camera/camera";
import { targetInsets } from "../camera/visible-area";
import { formFehlerMarken, formUngueltigAus, type Ablehnung } from "./form-ungueltig";
import type { GeometrieModus } from "./modus";
import type { Marke, Punkt } from "./geometrie";

/**
 * Die Stelle einer abgelehnten Form auf der Karte (`form-ungueltig.ts`), für „Ecken bearbeiten“ und „Gebietsform bearbeiten“: ein roter
 * Ring, solange der abgelehnte Stand steht, und die Kamera fliegt hin, wenn die Stelle nicht frei zu sehen ist (Hausregel „Kamera fliegt
 * immer“). Dazu die Marke eines Schritts, den der Formentwurf nicht übernommen hat (`form-regel.ts`): Beide stehen zugleich auf der Karte.
 */

/** Zur Stelle, wenn sie nicht frei zu sehen ist: so nah, wie die Suche an eine Landschaft heranholt. */
export function fliegeZurStelle(
    da: { readonly map: MapLibreMap; readonly camera: Pick<Camera, "showPoint"> } | undefined,
    stelle: Punkt,
): void {
    if (da === undefined) return;
    const ziel = toRenderLngLat(AVENTURIA.coordinateSpace, stelle);
    void da.camera.showPoint([ziel.lng, ziel.lat], SEARCH_FIT_MAX_ZOOM.landschaft, {
        free: targetInsets(da.map),
        onlyIfHidden: true,
    });
}

/** Die Marken eines Modus aus zwei Quellen: die der Ablehnung (`setze`) und die eines nicht übernommenen Schritts (der Modus selbst). */
export interface Markenkarte {
    /** Den Modus einhängen: Sein `markiere` gilt dann den Schritten, `setze` der Ablehnung. */
    haenge(modus: GeometrieModus): GeometrieModus;
    setze(marken: readonly Marke[]): void;
    /** Der Modus ist aus. */
    los(modus: GeometrieModus): void;
}

export function createMarkenkarte(): Markenkarte {
    let modus: GeometrieModus | undefined;
    let ablehnung: readonly Marke[] = [];
    let schritt: readonly Marke[] = [];
    const zeichne = (): void => modus?.markiere([...ablehnung, ...schritt]);
    return {
        haenge(neu) {
            modus = neu;
            schritt = [];
            zeichne();
            return {
                ...neu,
                markiere(marken) {
                    schritt = marken;
                    zeichne();
                },
            };
        },
        setze(marken) {
            ablehnung = marken;
            zeichne();
        },
        los(alt) {
            if (modus === alt) modus = undefined;
        },
    };
}

/**
 * Beobachtet die Ablehnung einer Bearbeitung: markiert die Stelle und fliegt hin, solange der abgelehnte Stand steht. `laeuft` sagt, ob der
 * Modus dieses Objekts noch läuft: Nach Esc steht der Entwurf im Fenster, dort fliegt nichts.
 */
export function beobachteAblehnung(
    bearbeitung: { readonly zustand: Readonly<Ref<Ablehnung>>; readonly stand: Readonly<Ref<unknown>> },
    laeuft: () => boolean,
    markiere: (marken: readonly Marke[]) => void,
    fliege: (stelle: Punkt) => void,
): WatchStopHandle {
    markiere([]);
    let abgelehntBei: unknown;
    return watch(
        () => [bearbeitung.zustand.value, bearbeitung.stand.value] as const,
        ([zustand, stand], [vorher]) => {
            const form = laeuft() ? formUngueltigAus(zustand) : undefined;
            if (form !== undefined && zustand !== vorher) {
                abgelehntBei = stand;
                fliege(form.stelle);
            }
            markiere(formFehlerMarken(form, abgelehntBei, stand));
        },
    );
}
