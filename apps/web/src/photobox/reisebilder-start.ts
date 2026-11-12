import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { MapView } from "@avesmaps3d/shared";
import type { EscapeCascade } from "../keyboard/escape-cascade";
import type { Camera } from "../map/camera/camera";
import type { Insets } from "../map/camera/visible-area";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { ladeReisebilderKarte } from "../nachladen";
import type * as ReisebilderKarte from "./reisebilder-karte";

/**
 * Der Einstieg der Reisebilder auf der Karte (WI-0272 S4, Aufgabe 27) und das EINZIGE Stück davon im Startpaket: Das Startpaket hat nur noch rund 14 KB Luft, alles Übrige (Abruf, Zustand,
 * Bündeln, Zeichen, Ebenen, Besitzer des Klicks) steht in `reisebilder-karte.ts` und wird nachgeladen. 🔴 Hier steht darum kein statischer Import aus den nachgeladenen Modulen, nur `import type`.
 *
 * - **Wann:** nach dem ersten ruhigen Bild der Karte (`idle`), spätestens nach 3 s. Besucher sehen zuerst die Karte; die Bilder kommen danach.
 * - **Scheitert das Laden**, geht der Fehler nach `console.error`, und die Karte läuft weiter.
 * - **Der Stil:** `composeStyle` ruft `reisebilderImStil` an jedem Stil. Ohne geladenes Modul oder außerhalb der Standardansicht bleibt der Stil, wie er ist; in jeder anderen Ansicht verschwinden
 *   Quellen und Ebenen damit von selbst (`setStyle` mit `diff` entfernt, was der neue Stil nicht nennt).
 */

/** Wie lange der Start auf das erste ruhige Bild wartet. */
export const REISEBILDER_START_MAX_MS = 3_000;

export interface ReisebilderUmfeld {
    /** Der Koordinator der Karte: Dort meldet sich der Besitzer des Klicks an. */
    readonly interaction: MapInteractionCoordinator;
    readonly escape: Pick<EscapeCascade, "register">;
    /** Die Kamera der Seite (sie entsteht nach der Karte); ohne sie bleiben die Fahrten aus. */
    readonly camera: () => Pick<Camera, "showPoint"> | undefined;
    /** Die Ansicht der Karte: Reisebilder gibt es nur in `standard`. */
    readonly ansicht: () => MapView;
    /** Was die Panels und Fenster von der Karte decken. */
    readonly frei: () => Partial<Insets>;
    /** Den Stil neu setzen (`rebuildStyle`): Die Ebenen kommen in den Stil, wenn das Modul da ist. */
    readonly stilNeu: () => void;
    /** Den offenen Kopf neu lesen: Ein neu freigegebenes Reisebild erscheint dort leise (`reisebilder-frisch.ts`). */
    readonly kopfNeu: () => void;
}

let karte: typeof ReisebilderKarte | undefined;

export function starteReisebilder(map: MapLibreMap, umfeld: ReisebilderUmfeld): void {
    let begonnen = false;
    const los = (): void => {
        if (begonnen) return;
        begonnen = true;
        clearTimeout(uhr);
        map.off("idle", los);
        ladeReisebilderKarte()
            .then((modul) => {
                karte = modul;
                modul.installReisebilderKarte(map, umfeld);
            })
            .catch((fehler: unknown) => {
                console.error("Die Reisebilder auf der Karte konnten nicht geladen werden", fehler);
            });
    };
    // Die Uhr steht erst nach `los`: Das Ende kommt nie im selben Takt.
    const uhr = setTimeout(los, REISEBILDER_START_MAX_MS);
    map.once("idle", los);
    map.once("remove", () => {
        begonnen = true;
        clearTimeout(uhr);
        karte = undefined;
    });
}

/** Hängt die Reisebilder an den Stil: nur in der Standardansicht und nur, wenn das Modul geladen ist. */
export function reisebilderImStil(stil: StyleSpecification, ansicht: MapView): StyleSpecification {
    if (karte === undefined || ansicht !== "standard") return stil;
    return karte.mitAktuellenReisebildern(stil);
}
