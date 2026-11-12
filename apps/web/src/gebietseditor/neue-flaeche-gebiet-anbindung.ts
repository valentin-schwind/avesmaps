import type { Map as MapLibreMap } from "maplibre-gl";
import { shallowRef, type ShallowRef } from "vue";
import { AVENTURIA, toRenderLngLat, type EditorTerritoryRef } from "@avesmaps3d/shared";
import type { Punkt } from "../map/geometrie/geometrie";
import type { NeueFlaecheAuftrag, NeueFlaecheStart } from "../map/geometrie/neue-flaeche";
import type { AusstehendeFlaeche } from "./ausstehende-gebiete";
import { gebieteAm } from "./gebiete-am-punkt";
import {
    createGebietAnlegenDaten,
    gebietAnlegen,
    grenzeZeichnen,
    type GebietAnlegenDaten,
} from "./neue-flaeche-gebiet";

/**
 * Die Einstiege der Herrschaftsgebiete in „Neue Fläche“ für die Seite (WI-0209 C3; Andockungen in `neue-flaeche-gebiet.ts`), damit
 * `app.vue` nur die Griffe reicht (`app-vue` schmal einhängen):
 *
 * - `neu(anfang)`: „Hier hinzufügen › Neues Herrschaftsgebiet“ (eigener Eintrag, Betreiber 2026-10-18); der Klickpunkt ist die erste
 *   Ecke, das Obergebiet das Gebiet, das
 *   die Karte dort im aktuellen Band zeigt (`gebiete-am-punkt.ts`, gezeichnete Füllung und Schraffur, kleinste zuerst).
 * - `untergebiet(obergebiet)`: „Untergebiet anlegen“ im Fenster; die erste Ecke setzt der erste Klick.
 * - `grenze(gebiet)`: „Grenze zeichnen“ im Fenster.
 * - **Danach** liest der Gebietseditor neu, öffnet das Gebiet (D19: an der Stelle des vordersten Fensters) und markiert seinen Namen
 *   (`nameMarkieren`, Frage 3), bis das Fenster es meldet.
 */

export interface GebietAnlegenSeite {
    karte(): MapLibreMap | undefined;
    /** Der gemeinsame Ablauf (`neue-flaeche-anbindung.ts`). */
    starte(auftrag: NeueFlaecheAuftrag): Promise<NeueFlaecheStart>;
    /** Sind die Gebiete der Karte geladen (sonst gibt es die Ansicht „Politisch“ nicht)? */
    gebieteBereit(): boolean;
    /** Gespeichert: den Gebietseditor neu lesen und das Gebiet öffnen. */
    oeffne(publicId: string): void;
    /** Gespeichert: die Fläche auf der Karte zeigen, bis die Ableitung sie zeichnet. */
    ausstehend?(flaeche: AusstehendeFlaeche): void;
}

export interface GebietAnlegenFuerSeite {
    neu(anfang: Punkt): void;
    untergebiet(obergebiet: EditorTerritoryRef): void;
    grenze(gebiet: { readonly id: string; readonly name: string; readonly revision: number }): void;
    /** Das eben angelegte Gebiet, dessen Name markiert stehen soll; das Fenster meldet es zurück (`markiert`). */
    readonly nameMarkieren: Readonly<ShallowRef<string | undefined>>;
    markiert(): void;
}

const space = AVENTURIA.coordinateSpace;

export function createGebietAnlegenFuerSeite(
    seite: GebietAnlegenSeite,
    daten: GebietAnlegenDaten = createGebietAnlegenDaten(),
): GebietAnlegenFuerSeite {
    const nameMarkieren = shallowRef<string | undefined>(undefined);
    const gemeinsam = {
        daten,
        darf: () => (seite.gebieteBereit() ? undefined : ("gebietseditor.neu.nichtGeladen" as const)),
        geoeffnet: (neu: { readonly publicId: string }) => {
            seite.oeffne(neu.publicId);
            nameMarkieren.value = neu.publicId;
        },
        gespeichert: (flaeche: AusstehendeFlaeche) => seite.ausstehend?.(flaeche),
    };
    /** Das Gebiet, das die Karte im aktuellen Band an diesem Punkt zeigt, das kleinste zuerst. */
    const amPunkt = (punkt: Punkt): EditorTerritoryRef | undefined => {
        const map = seite.karte();
        if (map === undefined) return undefined;
        const render = toRenderLngLat(space, punkt);
        const [gebiet] = gebieteAm(map, { lng: render.lng, lat: render.lat });
        return gebiet === undefined ? undefined : { id: gebiet.id, name: gebiet.name ?? "" };
    };
    return {
        neu: (anfang) => void seite.starte({ andockung: gebietAnlegen({ ...gemeinsam, amPunkt }), anfang }),
        untergebiet: (obergebiet) => void seite.starte({ andockung: gebietAnlegen({ ...gemeinsam, obergebiet }) }),
        grenze: (gebiet) => void seite.starte({ andockung: grenzeZeichnen({ ...gemeinsam, gebiet }) }),
        nameMarkieren,
        markiert() {
            nameMarkieren.value = undefined;
        },
    };
}
