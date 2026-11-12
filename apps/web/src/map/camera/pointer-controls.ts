import type { Map as MapLibreMap } from "maplibre-gl";
import { klicktoleranz } from "../geometrie/klicktoleranz";
import type { MapInteractionCoordinator } from "../interaction/types";
import { clampPitch, snapsToNorth } from "./camera-math";

/**
 * Drehen und Neigen mit der Maus: Strg + Linksziehen oder Ziehen mit gedrückter Mitteltaste
 * (D1, Spez. § 2). Waagerecht dreht, senkrecht neigt, nach oben = stärker geneigt.
 *
 * 🔴 Die rechte Maustaste gehört dem Kontextmenü, NIE der Kamera. Deshalb bleibt MapLibres
 * `dragRotate` aus: er hängt am Rechtsziehen UND unterdrückt dafür das Kontextmenü des Browsers
 * (`handler/mouse.ts`), und abschalten lässt sich das eine nicht ohne das andere. Dieser Handler
 * ersetzt ihn für genau die zwei Gesten, die wir wollen.
 *
 * ⭐ Linear: nach rechts ziehen dreht immer gleich herum, egal wo der Zeiger steht. MapLibres
 * Vorgabe seit 5.0 rechnet ab 100 px über oder unter der Mitte mit dem Winkel zur Mitte und kehrt
 * nahe der Mittellinie die Richtung um (Issue #6051) — schwer vorherzusehen.
 *
 * 🪤 Kein Nachlauf: die Kamera bleibt stehen, wo man loslässt. Beim Drehen ist Nachlauf
 * desorientierender als beim Verschieben (ChatGPT-Entwurf § 16); die Abnahme am Gerät bestätigt es.
 *
 * 🔴 Solange ein Modus des Geometrie-Moduls läuft, dreht Strg + Linksziehen NICHT: Dort heißt Strg „trennen“ (einen Wegpunkt vom verbundenen
 * Weg lösen, einen Ort ohne seine Wege verschieben; Thomas 2026-10-19 über die Editor-Orchestrierung) oder „rastet nicht ein“ (Vali 2026-11-06,
 * `map/geometrie/besitzer.ts`). Die Kamera lässt den Druck dann durch, der Modus greift. Die Mitteltaste dreht immer.
 *
 * 🪤 Nach einem Zug löst das Loslassen keinen Klick aus (`suppressNextClick`). `preventDefault` auf dem `pointerdown` nimmt `mousedown` und
 * `mouseup`, aber nicht den `click`, und `map.stop()` löscht MapLibres gemerkten Druckpunkt: Seine Prüfung der Klicktoleranz greift nicht, und
 * die Karte meldete nach der Drehung einen Klick auf das, was unter dem Zeiger lag. Strg + Klick ohne Zug bleibt ein Klick, die Geometrie-Modi
 * setzen damit Punkte. Die Mitteltaste meldet ohnehin nur `auxclick`.
 */

/** Grad je Pixel waagerechter Bewegung (MapLibre-Vorgabe `rotateSpeed`). */
const ROTATE_DEGREES_PER_PIXEL = 0.8;
/** Grad je Pixel senkrechter Bewegung (MapLibre-Vorgabe `pitchSpeed`, ohne Vorzeichen). */
const PITCH_DEGREES_PER_PIXEL = 0.5;
/** Einrasten nach Norden fährt kurz, damit es als Einrasten erkennbar bleibt. */
const SNAP_DURATION = 200;

const LEFT_BUTTON = 0;
const MIDDLE_BUTTON = 1;

/** Beginnt dieser Druck eine Kamerageste? Touch gehört MapLibres Zwei-Finger-Gesten. */
export function startsCameraDrag(event: Pick<PointerEvent, "pointerType" | "button" | "ctrlKey">): boolean {
    if (event.pointerType === "touch") {
        return false;
    }
    return (event.button === LEFT_BUTTON && event.ctrlKey) || event.button === MIDDLE_BUTTON;
}

/**
 * Der Klick dieses Loslassens zählt nicht: dasselbe, was MapLibre nach jedem eigenen Zug tut (`DOM.suppressClick`, nicht öffentlich). Der
 * Browser schickt ihn im selben Takt wie das `pointerup`; kommt keiner, trifft die Sperre so nicht den nächsten echten Klick.
 *
 * 🪤 `stopImmediatePropagation`: Wegen der Zeigererfassung landet der Klick auf `target` selbst, und MapLibre hört auf demselben Element.
 */
function suppressNextClick(target: EventTarget): void {
    const swallow = (event: Event): void => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    target.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => {
        target.removeEventListener("click", swallow, true);
    }, 0);
}

export function installPointerControls(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    /** Gehört Strg + Linksziehen gerade einem laufenden Modus? */
    strgGehoertDemModus?: () => boolean,
): () => void {
    const target = map.getCanvasContainer();
    let drag:
        | {
              pointerId: number;
              startX: number;
              startY: number;
              x: number;
              y: number;
              moved: boolean;
              release: (() => void) | undefined;
          }
        | undefined;
    // 🪤 Am Mac ist ⌃-Klick ein Rechtsklick: der Browser meldet beim Drücken ein Kontextmenü, das
    // mitten in die Drehung springen würde. Nur für DIESE Geste wird es unterdrückt.
    let swallowContextMenu = false;

    const onPointerDown = (event: PointerEvent): void => {
        if (!startsCameraDrag(event)) {
            return;
        }
        if (event.button === LEFT_BUTTON && strgGehoertDemModus?.() === true) {
            return;
        }
        // Kein Autoscroll der Mitteltaste, keine Textauswahl, und MapLibre verschiebt nicht mit.
        event.preventDefault();
        event.stopPropagation();
        map.stop();
        // 🔴 Die Geste gehört der Kamera (Rang 100, `priorities.ts`): Solange sie läuft, hat kein anderer Zeigen,
        // Klick oder Kontextmenü; eine Marke, die gerade gezogen wird, ist damit verdrängt. Dieser Handler bleibt
        // nah am DOM - er meldet die Erfassung nur (M8).
        drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            release: interaction.capture("camera-gesture", event.pointerId),
        };
        swallowContextMenu = event.button === LEFT_BUTTON;
        target.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) {
            return;
        }
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (dx === 0 && dy === 0) {
            return;
        }
        drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= klicktoleranz(map);
        // Kamera-Sprung erlaubt (gesture): direkte Geste - die Hand ist die Kamera, jede Mausbewegung ein Schritt.
        map.jumpTo({
            bearing: map.getBearing() + dx * ROTATE_DEGREES_PER_PIXEL,
            pitch: clampPitch(map.getPitch() - dy * PITCH_DEGREES_PER_PIXEL, map.getZoom()),
        });
    };

    const onPointerEnd = (event: PointerEvent): void => {
        if (!drag || event.pointerId !== drag.pointerId) {
            return;
        }
        if (drag.moved) {
            suppressNextClick(target);
        }
        drag.release?.();
        drag = undefined;
        if (target.hasPointerCapture(event.pointerId)) {
            target.releasePointerCapture(event.pointerId);
        }
        const bearing = map.getBearing();
        if (bearing !== 0 && snapsToNorth(bearing)) {
            map.easeTo({ bearing: 0, duration: SNAP_DURATION, essential: false });
        }
        // Das Kontextmenü des ⌃-Klicks kommt je nach System vor oder nach dem Loslassen.
        setTimeout(() => {
            swallowContextMenu = false;
        }, 0);
    };

    const onContextMenu = (event: MouseEvent): void => {
        if (drag || swallowContextMenu) {
            event.preventDefault();
        }
    };

    // 💣 Chrome startet den Autoscroll der Mitteltaste am `mousedown`, nicht am `pointerdown`.
    const onMouseDown = (event: MouseEvent): void => {
        if (event.button === MIDDLE_BUTTON) {
            event.preventDefault();
        }
    };

    target.addEventListener("pointerdown", onPointerDown);
    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerEnd);
    target.addEventListener("pointercancel", onPointerEnd);
    target.addEventListener("contextmenu", onContextMenu, true);
    target.addEventListener("mousedown", onMouseDown);

    return () => {
        drag?.release?.();
        drag = undefined;
        target.removeEventListener("pointerdown", onPointerDown);
        target.removeEventListener("pointermove", onPointerMove);
        target.removeEventListener("pointerup", onPointerEnd);
        target.removeEventListener("pointercancel", onPointerEnd);
        target.removeEventListener("contextmenu", onContextMenu, true);
        target.removeEventListener("mousedown", onMouseDown);
    };
}
