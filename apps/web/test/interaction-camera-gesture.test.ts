import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { installPointerControls } from "../src/map/camera/pointer-controls.ts";
import type { Camera } from "../src/map/camera/camera.ts";
import { INTERACTION_PRIORITY } from "../src/map/interaction/priorities.ts";
import type { InteractionOwner, LostReason } from "../src/map/interaction/types.ts";
import { createTravelerView } from "../src/map/traveler-view.ts";
import { createHarness, type Harness } from "./fake-interaction-map.ts";

/**
 * Die Kamerageste und der Playmode am Koordinator (M8): Drehen und Neigen mit der Maus erfasst den Zeiger
 * (Rang 100), der Playmode hört die Eingaben auf der Karte über `observe` statt an eigenen Zuhörern.
 */

let harness: Harness;

beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
});

afterEach(() => {
    harness.coordinator.destroy();
    vi.useRealTimers();
});

interface Pointer {
    pointerId: number;
    pointerType: string;
    button: number;
    ctrlKey: boolean;
    clientX: number;
    clientY: number;
}

const pointerEvent = (type: string, init: Partial<Pointer> = {}): Event =>
    Object.assign(new Event(type, { cancelable: true }), {
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        ctrlKey: false,
        clientX: 10,
        clientY: 10,
        ...init,
    });

describe("Drehen und Neigen mit der Maus erfasst den Zeiger", () => {
    let container: EventTarget & {
        setPointerCapture: () => void;
        hasPointerCapture: () => boolean;
        releasePointerCapture: () => void;
    };
    let stop: () => void;
    let jumps: unknown[];
    let modusLaeuft: boolean;

    beforeEach(() => {
        modusLaeuft = false;
        container = Object.assign(new EventTarget(), {
            setPointerCapture: () => undefined,
            hasPointerCapture: () => false,
            releasePointerCapture: () => undefined,
        });
        jumps = [];
        stop = installPointerControls(
            {
                getCanvasContainer: () => container,
                stop: () => undefined,
                jumpTo: (options: unknown) => jumps.push(options),
                getBearing: () => 0,
                getPitch: () => 0,
                getZoom: () => 5,
                easeTo: () => undefined,
            } as unknown as MapLibreMap,
            harness.coordinator,
            () => modusLaeuft,
        );
    });

    afterEach(() => stop());

    it("🔴 läuft ein Modus, gehört ihm Strg + Linksziehen: die Kamera lässt den Druck durch, die Mitteltaste dreht weiter", () => {
        modusLaeuft = true;
        const druck = pointerEvent("pointerdown", { ctrlKey: true });
        container.dispatchEvent(druck);
        expect(druck.defaultPrevented).toBe(false);
        expect(harness.coordinator.captured()).toBeUndefined();
        container.dispatchEvent(pointerEvent("pointermove", { clientX: 30 }));
        expect(jumps).toHaveLength(0);
        container.dispatchEvent(pointerEvent("pointerup"));

        container.dispatchEvent(pointerEvent("pointerdown", { button: 1 }));
        expect(harness.coordinator.captured()).toBe("camera-gesture");
        container.dispatchEvent(pointerEvent("pointerup", { button: 1 }));
    });

    it("Strg + Linksziehen erfasst den Zeiger als `camera-gesture`, bis der Zeiger losgelassen wird", () => {
        container.dispatchEvent(pointerEvent("pointerdown", { ctrlKey: true }));
        expect(harness.coordinator.captured()).toBe("camera-gesture");
        container.dispatchEvent(pointerEvent("pointermove", { clientX: 30 }));
        expect(jumps).toHaveLength(1);
        container.dispatchEvent(pointerEvent("pointerup"));
        expect(harness.coordinator.captured()).toBeUndefined();
    });

    it("die Mitteltaste erfasst ihn auch, und ein abgebrochener Zeiger gibt ihn frei", () => {
        container.dispatchEvent(pointerEvent("pointerdown", { button: 1 }));
        expect(harness.coordinator.captured()).toBe("camera-gesture");
        container.dispatchEvent(pointerEvent("pointercancel", { button: 1 }));
        expect(harness.coordinator.captured()).toBeUndefined();
    });

    it("ein gewöhnlicher Druck, ein Finger und die rechte Taste erfassen nichts", () => {
        container.dispatchEvent(pointerEvent("pointerdown"));
        container.dispatchEvent(pointerEvent("pointerdown", { pointerType: "touch", ctrlKey: true }));
        container.dispatchEvent(pointerEvent("pointerdown", { button: 2, ctrlKey: true }));
        expect(harness.coordinator.captured()).toBeUndefined();
    });

    it("ein anderer Zeiger beendet die Geste nicht", () => {
        container.dispatchEvent(pointerEvent("pointerdown", { ctrlKey: true }));
        container.dispatchEvent(pointerEvent("pointerup", { pointerId: 2 }));
        expect(harness.coordinator.captured()).toBe("camera-gesture");
    });

    it("🔴 die Geste verdrängt das Ziehen einer Marke: deren Besitzer erfährt es", () => {
        const lost: LostReason[] = [];
        const drag: InteractionOwner = {
            id: "waypoint-drag",
            priority: INTERACTION_PRIORITY["waypoint-drag"],
            kinds: ["press"],
            layers: () => [],
            hit: () => ({}),
            apply: () => undefined,
            lost: (reason) => lost.push(reason),
        };
        harness.coordinator.register(drag);
        harness.coordinator.capture("waypoint-drag", undefined, "grabbing");
        container.dispatchEvent(pointerEvent("pointerdown", { ctrlKey: true }));
        expect(harness.coordinator.captured()).toBe("camera-gesture");
        expect(lost).toEqual(["preempted"]);
    });

    it("beim Abbau ist die Erfassung vorbei", () => {
        container.dispatchEvent(pointerEvent("pointerdown", { ctrlKey: true }));
        stop();
        expect(harness.coordinator.captured()).toBeUndefined();
    });
});

describe("der Playmode hört die Eingaben auf der Karte über den Koordinator", () => {
    const view = (withInteraction: boolean): { traveler: ReturnType<typeof createTravelerView>; claims: number } => {
        const state = { claims: 0 };
        const camera = {
            claimNorth: () => {
                state.claims += 1;
                return () => undefined;
            },
        } as unknown as Camera;
        const traveler = createTravelerView(
            () => harness.map as unknown as MapLibreMap,
            () => camera,
            () => 0,
            undefined,
            withInteraction ? () => harness.coordinator : undefined,
        );
        return {
            traveler,
            get claims() {
                return state.claims;
            },
        };
    };

    it("`watch` meldet jede Eingabe auf der Karte als Aktivität und den Kompass als eigenen Wunsch", () => {
        const activity = vi.fn();
        const compass = vi.fn();
        const { traveler } = view(true);
        const unwatch = traveler.watch({ activity, compass });
        for (const type of ["pointermove", "pointerdown", "wheel", "touchstart", "touchmove"]) {
            harness.map.container.dispatchEvent(new Event(type));
        }
        expect(activity).toHaveBeenCalledTimes(5);
        unwatch();
        harness.map.container.dispatchEvent(new Event("pointermove"));
        expect(activity).toHaveBeenCalledTimes(5);
    });

    it("`watch` nimmt den Kompass in Beschlag, solange es läuft, und gibt ihn dann zurück", () => {
        const claim = vi.fn(() => vi.fn());
        const camera = { claimNorth: claim } as unknown as Camera;
        const traveler = createTravelerView(
            () => harness.map as unknown as MapLibreMap,
            () => camera,
            () => 0,
            undefined,
            () => harness.coordinator,
        );
        const unwatch = traveler.watch({ activity: () => undefined, compass: () => undefined });
        expect(claim).toHaveBeenCalledTimes(1);
        const release = claim.mock.results[0]?.value as ReturnType<typeof vi.fn>;
        unwatch();
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("ohne Koordinator hört die Ansicht nicht zu, und nichts geht schief", () => {
        const { traveler } = view(false);
        const unwatch = traveler.watch({ activity: vi.fn(), compass: vi.fn() });
        expect(() => unwatch()).not.toThrow();
    });
});
