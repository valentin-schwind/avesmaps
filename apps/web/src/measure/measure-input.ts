import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat, toRenderLngLat, type MapPoint } from "@avesmaps3d/shared";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";
import { MEASURE_HANDLE_LAYERS } from "./measure-layers";
import { isPending, type MeasureHandle, type Measurement } from "./measure-state";

/**
 * Die Bedienung der Entfernungsmessung als Besitzer `measure` des Koordinators (WI-0095, Finding MCS-030).
 *
 * **Legacys Ablauf, Schritt für Schritt** (`js/ui/ui-controls.js` L289-326, `js/app/bootstrap.js` L1143-1171):
 *
 * 1. Kartenmenü „Entfernung messen" setzt den **ersten Punkt** an die Stelle des Rechtsklicks und meldet
 *    per Toast, dass der zweite Punkt angeklickt werden soll.
 * 2. Der **nächste Linksklick auf die Karte** setzt den zweiten Punkt. 🔴 Legacy hängt dafür einen Zuhörer
 *    im **Capture** am Kartencontainer und schluckt den Klick (`stopImmediatePropagation`): Ein Klick auf
 *    eine Stadt setzt den Zielpunkt und öffnet die Stadt NICHT. Bei uns macht das der Rang - `measure` (95)
 *    steht über `place` (80) und allen anderen Treffern, nur die Kamerageste (100) bleibt darüber.
 * 3. **Beide Griffe lassen sich ziehen**, Linie und Wert rechnen dabei live mit (`drag` und `dragend`).
 * 4. Gelöscht wird über den zweiten Menüeintrag; ein neues „Entfernung messen" ersetzt die alte Messung.
 *
 * 🪤 **Legacy nimmt den Klick auf einen GRIFF nicht als Zielpunkt** (`.measurement-handle-marker` steht in
 * seiner Ausnahmeliste). Deshalb beansprucht der Besitzer den Klick über einem Griff auch hier und tut dann
 * nichts: geschluckt ist richtig, der Zielpunkt läge sonst auf dem Startpunkt.
 *
 * 🪤 Legacys lange Ausnahmeliste (Bedienleisten, Popups, Menüs, Editorfenster) braucht es bei uns nicht:
 * Der Koordinator hört nur auf der Karte, ein Klick in ein Panel kommt dort nie an.
 *
 * Das Ziehen folgt `map/waypoint-drag.ts`: Wer einen Griff packt, **erfasst** den Zeiger (`capture`), damit
 * kein Zeigen, Klicken, Kontextmenü und kein langer Druck dazwischenkommt, und der Griff hängt am Zeiger da,
 * wo man ihn gepackt hat - er springt nicht unter den Finger.
 */

const space = AVENTURIA.coordinateSpace;

/** Erst ab dieser Strecke ist ein Druck ein Ziehen; ein Klick bleibt ein Klick (wie bei der Wegpunktmarke). */
const DRAG_THRESHOLD_PX = 3;

export interface MeasureInput {
    /** Die Messung, wie sie gerade steht. */
    current: () => Measurement | undefined;
    /** Der zweite Punkt ist gesetzt (Legacy `completeDistanceMeasurementAt`). */
    complete: (at: MapPoint) => void;
    /** Ein Griff liegt an einer neuen Stelle - beim Ziehen fortlaufend, wie Legacys `drag` und `dragend`. */
    move: (handle: MeasureHandle, to: MapPoint) => void;
}

/** Was `hit` findet: welcher Griff unter dem Zeiger liegt, oder dass dieser Klick den Zielpunkt setzt. */
interface MeasureClaim extends Claim {
    handle?: MeasureHandle;
    complete?: true;
}

interface Screen {
    x: number;
    y: number;
}

/** Ein Druck, der ziehen darf: die linke Taste oder ein einzelner Finger. */
function isPrimaryPress(event: MapMouseEvent | MapTouchEvent): boolean {
    const original = event.originalEvent;
    return !(
        ("touches" in original && original.touches.length !== 1) ||
        ("button" in original && original.button !== 0)
    );
}

/** Hängt die Bedienung der Messung an die Karte; gibt die Abmeldung zurück. */
export function installMeasure(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    input: MeasureInput,
): () => void {
    let dragged:
        { handle: MeasureHandle; offset: Screen; start: Screen; moved: boolean; release: () => void } | undefined;

    /** Den Griff packen: der Zeiger gehört ihm, bis er losgelassen ist. */
    const grab = (handle: MeasureHandle, event: MapMouseEvent | MapTouchEvent): void => {
        const measurement = input.current();
        const at = handle === "start" ? measurement?.start : measurement?.end;
        if (at === undefined) return;
        // 🔴 Erst erfassen, dann alles Weitere - wie bei der Wegpunktmarke: Der Druck war ein Griff und nichts sonst.
        const release = interaction.capture("measure", undefined, "grabbing");
        if (!release) return;
        // Kein Kartenschieben und kein Drehen für diese Geste - sie gehört dem Griff.
        event.preventDefault();
        const centre = map.project(toRenderLngLat(space, at));
        dragged = {
            handle,
            offset: { x: event.point.x - centre.x, y: event.point.y - centre.y },
            start: { x: event.point.x, y: event.point.y },
            moved: false,
            release,
        };
        // 🪤 Losgelassen über einem Panel oder außerhalb: Die Karte meldet dann kein `mouseup`.
        globalThis.addEventListener("mouseup", drop);
    };

    const end = (): void => {
        const current = dragged;
        dragged = undefined;
        // Gibt den Zeiger frei; die Zeigerform geht mit ihm zurück.
        current?.release();
        globalThis.removeEventListener("mouseup", drop);
    };

    const move = (event: MapMouseEvent | MapTouchEvent): void => {
        const current = dragged;
        if (!current) return;
        const pointer = { x: event.point.x, y: event.point.y };
        if (
            !current.moved &&
            Math.hypot(pointer.x - current.start.x, pointer.y - current.start.y) < DRAG_THRESHOLD_PX
        ) {
            return;
        }
        current.moved = true;
        const tip: [number, number] = [pointer.x - current.offset.x, pointer.y - current.offset.y];
        input.move(current.handle, fromRenderLngLat(space, map.unproject(tip)));
    };

    function drop(): void {
        if (!dragged) return;
        end();
    }

    const cancel = (): void => {
        if (!dragged) return;
        end();
    };

    const owner: InteractionOwner<MeasureClaim> = {
        id: "measure",
        priority: INTERACTION_PRIORITY.measure,
        kinds: ["click", "press", "hover"],
        layers: () => [...MEASURE_HANDLE_LAYERS],
        // Ohne laufende Messung nimmt der Besitzer an gar nichts teil: Die Karte verhält sich wie vorher.
        enabled: () => input.current() !== undefined,
        hit(context) {
            const handle = context.features([...MEASURE_HANDLE_LAYERS])[0];
            if (handle) {
                if (context.kind === "press" && !isPrimaryPress(context.event)) return undefined;
                const which: MeasureHandle = String(handle.properties["handle"]) === "end" ? "end" : "start";
                // Über jedem Griff die Greifhand, auch über einem Ort darunter.
                return { handle: which, cursor: "grab" };
            }
            // Der Klick, der den zweiten Punkt setzt - und nur dieser.
            if (context.kind === "click" && isPending(input.current())) return { complete: true };
            return undefined;
        },
        apply(kind, claim, context) {
            if (kind === "press" && claim.handle !== undefined) {
                grab(claim.handle, context.event);
                return;
            }
            if (kind === "click" && claim.complete === true) {
                input.complete(fromRenderLngLat(space, context.lngLat));
            }
        },
        // Eine stärkere Geste (Drehen mit Strg + Ziehen) hat den Zeiger genommen: Das Ziehen endet.
        lost(reason) {
            if (reason === "preempted") cancel();
        },
    };

    const unregister = interaction.register(owner);
    map.on("mousemove", move);
    map.on("touchmove", move);
    map.on("mouseup", drop);
    map.on("touchend", drop);
    map.on("touchcancel", cancel);
    return () => {
        cancel();
        unregister();
        map.off("mousemove", move);
        map.off("touchmove", move);
        map.off("mouseup", drop);
        map.off("touchend", drop);
        map.off("touchcancel", cancel);
    };
}
