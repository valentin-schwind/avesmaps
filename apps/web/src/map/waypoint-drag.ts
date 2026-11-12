import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from "maplibre-gl";
import { AVENTURIA, DESIGN_CANON, fromRenderLngLat, toRenderLngLat, type WaypointHit } from "@avesmaps3d/shared";
import { INTERACTION_PRIORITY } from "./interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "./interaction/types";
import { ROUTE_MARKER_LAYER_ID, updateRouteData, type RouteLayerData } from "./route-layers";

/**
 * Eine Wegpunktmarke ziehen (WI-0052, vorher nur Kartenpunkte nach WI-0030 und Legacy B11).
 *
 * - **Jede Marke lässt sich ziehen**, Ort wie Kartenpunkt (Betreiber 2026-09-27, bewusst anders als
 *   Legacy, wo nur ein Kartenpunkt `draggable` war).
 * - Die Marke hängt am Zeiger, wo man sie gepackt hat: Ihre Spitze springt nicht unter den Finger.
 * - **Einrasten:** Liegt ein gezeichneter Ort höchstens `SNAP_PX` neben der Spitze, sitzt die Marke auf
 *   ihm, und ein Schild nennt ihn. Gemessen wird an seiner gezeichneten Form, eine große Stadt fängt
 *   also weiter; unter mehreren gewinnt der nächste Mittelpunkt. **Strg** unterdrückt das Einrasten,
 *   auch mitten im Ziehen. Am Finger gibt es kein Strg; dort rastet sie immer ein.
 * - Gerechnet wird erst beim Loslassen, und zwar genau das, was man zuletzt gesehen hat: der Ort, auf
 *   dem die Marke saß, sonst die Lage ihrer Spitze. Ein Klick, der sie nicht bewegt, rechnet nichts.
 *
 * 🔴 Seit M8 (Hardening Review 2026-09-28) ist das Ziehen ein Besitzer (`waypoint-drag`, Rang 90) des
 * Koordinators der Karteninteraktion. Er beansprucht Druck und Zeigen über der Marke, nie den Klick. Wer die
 * Marke packt, **erfasst** den Zeiger (`capture`): Solange gezogen wird, hat kein anderer Zeigen, Klick,
 * Kontextmenü oder langen Druck - ein langer Druck, der beim Aufsetzen begann, ist damit abgebrochen. Die
 * Zeigerform (Greifhand, beim Ziehen die geschlossene) schreibt der Koordinator, nicht diese Datei. Das Ziehen
 * selbst (Bewegung, Loslassen, Strg) hört weiter auf die Karte: Es ist die Fortsetzung der erfassten Geste.
 */

/** So nah (in Pixeln) muss die Spitze an die gezeichnete Form eines Orts, damit die Marke einrastet. */
export const SNAP_PX = 8;

/** Erst ab dieser Strecke ist ein Druck ein Ziehen; ein Klick bleibt ein Klick. */
const DRAG_THRESHOLD_PX = 3;

/** Das Namensschild: der Ort im Bild (Kartenpixel), wie weit die Marke über ihn ragt, und sein Name. */
export interface SnapLabel {
    x: number;
    y: number;
    lift: number;
    name: string;
}

export interface WaypointDragInput {
    /** Die Wegpunkte, wie der Planer sie gerade zeigt. */
    current: () => RouteLayerData;
    /** Die Ebenen der Orte, auf denen eine Marke einrastet (Kreis und Raute). */
    placeLayers: readonly string[];
    /** Losgelassen: auf einem Ort oder an einer Lage in Kartenkoordinaten. */
    drop: (key: number, to: WaypointHit | { x: number; y: number }) => void;
    /** Das Schild zeigen oder, mit `null`, wegnehmen. */
    showLabel: (label: SnapLabel | null) => void;
}

const space = AVENTURIA.coordinateSpace;
const route = DESIGN_CANON.route;

interface Screen {
    x: number;
    y: number;
}

/** Der Kandidat, dessen Mittelpunkt der Spitze am nächsten liegt. */
export function nearestSnapTarget<T extends { screen: Screen }>(tip: Screen, candidates: readonly T[]): T | undefined {
    let best: T | undefined;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        const distance = Math.hypot(candidate.screen.x - tip.x, candidate.screen.y - tip.y);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return best;
}

/** Ein gezeichneter Ort als Wegpunkt; verborgene Orte zeichnet die Karte nicht. */
export function placeHitFromFeature(
    properties: Record<string, unknown>,
    coordinates: [number, number],
): WaypointHit | undefined {
    const id = String(properties["public_id"] ?? "");
    const name = String(properties["name"] ?? "");
    if (id === "" || name === "") return undefined;
    const at = fromRenderLngLat(space, { lng: coordinates[0], lat: coordinates[1] });
    return { id, name, subtype: String(properties["subtype"] ?? ""), hidden: false, x: at.x, y: at.y };
}

/** Wie weit die Marke über ihrem Punkt steht: das Ziel ist ein Tropfen auf der Spitze, sonst eine Scheibe. */
export function markerLift(index: number, count: number): number {
    return index === count - 1 ? route.markerDropHeight : route.markerDisc / 2;
}

const ctrlHeld = (event: MapMouseEvent | MapTouchEvent): boolean =>
    "ctrlKey" in event.originalEvent && event.originalEvent.ctrlKey;

/** Was `hit` über der Marke findet: welche Wegpunkt-Kennung sie trägt; die Greifhand steht als Zeigerform dabei. */
interface DragClaim extends Claim {
    key: number;
}

/** Ein Druck, der ziehen darf: die linke Taste oder ein einzelner Finger. */
function isPrimaryPress(event: MapMouseEvent | MapTouchEvent): boolean {
    const original = event.originalEvent;
    return !(
        ("touches" in original && original.touches.length !== 1) ||
        ("button" in original && original.button !== 0)
    );
}

/**
 * Das Ziehen der Wegpunktmarken als Besitzer `waypoint-drag` (Rang 90) des Koordinators. Gibt die Abmeldung zurück.
 */
export function installWaypointDrag(
    map: MapLibreMap,
    interaction: MapInteractionCoordinator,
    input: WaypointDragInput,
): () => void {
    let dragged:
        | {
              key: number;
              lift: number;
              offset: Screen;
              start: Screen;
              last: Screen;
              moved: boolean;
              target: WaypointHit | undefined;
              at: { x: number; y: number } | undefined;
              /** Gibt den Zeiger frei, den `capture` dieser Geste hält. */
              release: () => void;
          }
        | undefined;

    const snapAt = (tip: Screen): { hit: WaypointHit; screen: Screen } | undefined => {
        const layers = input.placeLayers.filter((id) => map.getLayer(id) !== undefined);
        if (layers.length === 0) return undefined;
        const box: [[number, number], [number, number]] = [
            [tip.x - SNAP_PX, tip.y - SNAP_PX],
            [tip.x + SNAP_PX, tip.y + SNAP_PX],
        ];
        const candidates = map.queryRenderedFeatures(box, { layers }).flatMap((feature) => {
            if (feature.geometry.type !== "Point") return [];
            const coordinates = feature.geometry.coordinates as [number, number];
            const hit = placeHitFromFeature(feature.properties, coordinates);
            return hit ? [{ hit, screen: map.project(coordinates) }] : [];
        });
        return nearestSnapTarget(tip, candidates);
    };

    /** Die Marke dorthin, wo der Zeiger sie hält - oder auf den Ort, auf dem sie einrastet. */
    const follow = (pointer: Screen, free: boolean): void => {
        const current = dragged;
        if (!current) return;
        const tip = { x: pointer.x - current.offset.x, y: pointer.y - current.offset.y };
        const snap = free ? undefined : snapAt(tip);
        current.target = snap?.hit;
        current.at = fromRenderLngLat(space, map.unproject([tip.x, tip.y]));
        const shown = snap?.hit ?? current.at;
        const layer = input.current();
        updateRouteData(map, {
            ...layer,
            waypoints: layer.waypoints.map((waypoint) =>
                waypoint.key === current.key ? { ...waypoint, x: shown.x, y: shown.y } : waypoint,
            ),
        });
        input.showLabel(snap ? { x: snap.screen.x, y: snap.screen.y, lift: current.lift, name: snap.hit.name } : null);
    };

    // Strg drücken oder loslassen, ohne die Maus zu bewegen: Die Marke folgt sofort.
    const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Control" && dragged?.moved) follow(dragged.last, event.ctrlKey);
    };

    const end = (): void => {
        const current = dragged;
        dragged = undefined;
        // Gibt den Zeiger frei; die Zeigerform geht mit ihm zurück.
        current?.release();
        input.showLabel(null);
        globalThis.removeEventListener("keydown", onKey);
        globalThis.removeEventListener("keyup", onKey);
        globalThis.removeEventListener("mouseup", drop);
    };

    /** Die Marke ist gepackt: der Zeiger gehört ihr, bis sie losgelassen ist. */
    const grab = (key: number, event: MapMouseEvent | MapTouchEvent): void => {
        const layer = input.current();
        const index = layer.waypoints.findIndex((waypoint) => waypoint.key === key);
        const waypoint = layer.waypoints[index];
        if (!waypoint) return;
        // 🔴 Erst erfassen, dann alles Weitere: Der Druck war eine Marke und nichts sonst - ein langer Druck,
        // der mit diesem Finger begann, ist damit abgebrochen und öffnet kein Kontextmenü mehr.
        const release = interaction.capture("waypoint-drag", undefined, "grabbing");
        if (!release) return;
        // Kein Kartenschieben und kein Drehen für diese Geste - sie gehört der Marke.
        event.preventDefault();
        const tip = map.project(toRenderLngLat(space, waypoint));
        const at = { x: event.point.x, y: event.point.y };
        dragged = {
            key,
            lift: markerLift(index, layer.waypoints.length),
            offset: { x: at.x - tip.x, y: at.y - tip.y },
            start: at,
            last: at,
            moved: false,
            target: undefined,
            at: undefined,
            release,
        };
        globalThis.addEventListener("keydown", onKey);
        globalThis.addEventListener("keyup", onKey);
        // 🪤 Losgelassen über dem Planer oder außerhalb: Die Karte meldet dann kein `mouseup`.
        globalThis.addEventListener("mouseup", drop);
    };

    const move = (event: MapMouseEvent | MapTouchEvent): void => {
        const current = dragged;
        if (!current) return;
        current.last = { x: event.point.x, y: event.point.y };
        if (
            !current.moved &&
            Math.hypot(current.last.x - current.start.x, current.last.y - current.start.y) < DRAG_THRESHOLD_PX
        ) {
            return;
        }
        current.moved = true;
        follow(current.last, ctrlHeld(event));
    };

    const drop = (): void => {
        const current = dragged;
        if (!current) return;
        end();
        const to = current.target ?? current.at;
        if (!current.moved || !to) return;
        // Zurück auf den Stand des Planers; was sich ändert, zeichnet er im selben Zug neu.
        updateRouteData(map, input.current());
        input.drop(current.key, to);
    };

    const cancel = (): void => {
        if (!dragged) return;
        end();
        updateRouteData(map, input.current());
    };

    const owner: InteractionOwner<DragClaim> = {
        id: "waypoint-drag",
        priority: INTERACTION_PRIORITY["waypoint-drag"],
        kinds: ["press", "hover"],
        layers: () => [ROUTE_MARKER_LAYER_ID],
        hit(context) {
            const marker = context.features([ROUTE_MARKER_LAYER_ID])[0];
            if (!marker) return undefined;
            if (context.kind === "press" && !isPrimaryPress(context.event)) return undefined;
            // Über jeder Marke die Greifhand, auch über einem Ort, der darunter seinen Zeiger setzt.
            return { key: Number(marker.properties["key"]), cursor: "grab" };
        },
        apply(kind, claim, context) {
            if (kind === "press") grab(claim.key, context.event);
        },
        // Eine stärkere Geste (Drehen mit Strg + Ziehen) hat den Zeiger genommen: Die Marke geht zurück.
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
