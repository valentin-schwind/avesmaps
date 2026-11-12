import { vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { createInteractionCoordinator } from "../src/map/interaction/coordinator.ts";
import type { MapInteractionCoordinator } from "../src/map/interaction/types.ts";

/**
 * Eine Karte als Testdoppel für den Interaktionsvertrag (M8): genau die Aufrufe, die der Koordinator und die
 * Besitzer machen. So ist auch zählbar, wie oft die Karte gefragt wird. Kein Test dieser Datei prüft MapLibre.
 */

export interface FakeFeature {
    layer: { id: string };
    properties: Record<string, unknown>;
    geometry?: { type: string; coordinates: unknown };
}

/** Ein Feature in den geladenen Kacheln einer Quelle, mit seiner (über `promoteId` gehobenen) Kennung. */
export interface FakeSourceFeature {
    source: string;
    sourceLayer: string;
    id: string | number;
    properties: Record<string, unknown>;
}

interface FeatureRef {
    source: string;
    sourceLayer?: string;
    id?: string | number;
}

/**
 * Liest genau die Filterformen, die die Besitzer an `querySourceFeatures` geben: `["==", ["get", k], v]` (die Kette eines Wegs, sein
 * Name; ein Abschnitt), `["!=", ["get", k], v]` (die Kette ohne die Abschnitte, die blank nach ihrer Art heißen), `["all", …]` daraus,
 * dazu `["!", ["has", k]]`. Eine andere Form wirft, damit ein Test nie still alles oder nichts zurückbekommt.
 */
function matches(filter: unknown, properties: Record<string, unknown>): boolean {
    if (filter === undefined) return true;
    const gleich = (term: unknown): boolean => {
        const [nicht, [has, ohne] = []] = term as [string, [string, string]?];
        if (nicht === "!" && has === "has") return !(ohne !== undefined && ohne in properties);
        const [eq, [get, key], value] = term as [string, [string, string], unknown];
        if ((eq !== "==" && eq !== "!=") || get !== "get")
            throw new Error(`FakeMap kennt den Filter ${JSON.stringify(term)} nicht`);
        return (properties[key] === value) === (eq === "==");
    };
    const [op, ...terms] = filter as [string, ...unknown[]];
    if (op === "==") return gleich(filter);
    if (op !== "all") throw new Error(`FakeMap kennt den Filter ${JSON.stringify(filter)} nicht`);
    return terms.every(gleich);
}

const stateKey = (ref: FeatureRef): string => JSON.stringify([ref.source, ref.sourceLayer ?? "", ref.id]);

/** Ein Punkt wie MapLibres `Point`: Die Stelle einer Abfrage ist ein Objekt dieser Klasse. */
export class FakePoint {
    readonly x: number;
    readonly y: number;
    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
}

export class FakeMap {
    readonly handlers = new Map<string, Set<(event: unknown) => void>>();
    readonly layers = new Set<string>();
    readonly sources = new Set<string>();
    readonly queries: { area: unknown; layers: string[] }[] = [];
    readonly filters: { layer: string; filter: unknown }[] = [];
    /** Feature-State je Feature; zählbar über `stateCalls`. */
    readonly states = new Map<string, Record<string, unknown>>();
    stateCalls = 0;
    /** Was `querySourceFeatures` in den geladenen Kacheln findet. */
    sourceFeatures: FakeSourceFeature[] = [];
    hits: FakeFeature[] = [];
    readonly canvas = { style: { cursor: "" } };
    // Der Rahmen der Karte liegt bei (100, 100) wie `mouse` (`clientX = x + 100`).
    readonly container = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 100, top: 100 }) });

    on(type: string, handler: (event: unknown) => void): void {
        const set = this.handlers.get(type) ?? new Set();
        set.add(handler);
        this.handlers.set(type, set);
    }
    off(type: string, handler: (event: unknown) => void): void {
        this.handlers.get(type)?.delete(handler);
    }
    getLayer(id: string): object | undefined {
        return this.layers.has(id) ? {} : undefined;
    }
    /** Dieselbe Quelle ist dasselbe Objekt, wie in MapLibre; ein neuer Stil gibt ein neues (`replaceSource`). */
    private readonly sourceObjects = new Map<string, object>();
    getSource(id: string): object | undefined {
        if (!this.sources.has(id)) return undefined;
        const existing = this.sourceObjects.get(id) ?? {};
        this.sourceObjects.set(id, existing);
        return existing;
    }
    replaceSource(id: string): void {
        this.sources.add(id);
        this.sourceObjects.set(id, {});
    }
    setFilter(layer: string, filter: unknown): void {
        this.filters.push({ layer, filter });
    }
    querySourceFeatures(
        source: string,
        parameters: { sourceLayer?: string; filter?: unknown } = {},
    ): FakeSourceFeature[] {
        return this.sourceFeatures.filter(
            (entry) =>
                entry.source === source &&
                (parameters.sourceLayer === undefined || entry.sourceLayer === parameters.sourceLayer) &&
                matches(parameters.filter, entry.properties),
        );
    }
    setFeatureState(ref: FeatureRef, state: Record<string, unknown>): void {
        this.stateCalls += 1;
        this.states.set(stateKey(ref), { ...this.states.get(stateKey(ref)), ...state });
    }
    removeFeatureState(ref: FeatureRef, key?: string): void {
        this.stateCalls += 1;
        const current = this.states.get(stateKey(ref));
        if (current === undefined) return;
        if (key === undefined) this.states.delete(stateKey(ref));
        else
            this.states.set(
                stateKey(ref),
                Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)),
            );
    }
    getFeatureState(ref: FeatureRef): Record<string, unknown> {
        return this.states.get(stateKey(ref)) ?? {};
    }
    getZoom(): number {
        return 5;
    }
    unproject([x, y]: [number, number]): { lng: number; lat: number } {
        return { lng: x / 10, lat: y / 10 };
    }
    /** Wie MapLibre ein eigenes Punktobjekt, kein `{ x, y }`, das man übergeben hat (der Umschalt-Weg fragt damit). */
    project({ lng, lat }: { lng: number; lat: number }): FakePoint {
        return new FakePoint(lng * 10, lat * 10);
    }
    queryRenderedFeatures(area: unknown, options: { layers: string[] }): FakeFeature[] {
        this.queries.push({ area, layers: options.layers });
        return this.hits.filter((feature) => options.layers.includes(feature.layer.id));
    }
    getCanvas(): { style: { cursor: string } } {
        return this.canvas;
    }
    getCanvasContainer(): EventTarget & { getBoundingClientRect(): { left: number; top: number } } {
        return this.container;
    }
    fire(type: string, event: unknown): void {
        for (const handler of [...(this.handlers.get(type) ?? [])]) handler(event);
    }
    listenerCount(): number {
        return [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0);
    }
}

export const feature = (
    layer: string,
    properties: Record<string, unknown> = {},
    geometry?: FakeFeature["geometry"],
): FakeFeature => ({
    layer: { id: layer },
    properties,
    ...(geometry ? { geometry } : {}),
});

export function mouse(x: number, y: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        point: { x, y },
        lngLat: { lng: x / 10, lat: y / 10 },
        originalEvent: { clientX: x + 100, clientY: y + 100, buttons: 0, button: 0 },
        preventDefault: vi.fn(),
        ...extra,
    };
}

export function touch(x: number, y: number, count = 1): Record<string, unknown> {
    return {
        point: { x, y },
        lngLat: { lng: x / 10, lat: y / 10 },
        originalEvent: {
            touches: Array.from({ length: count }, () => ({ clientX: x + 100, clientY: y + 100 })),
            preventDefault: () => undefined,
        },
        preventDefault: vi.fn(),
    };
}

export interface Harness {
    map: FakeMap;
    coordinator: MapInteractionCoordinator;
    /** Das Zeigen rechnet je Bild: hier läuft das anstehende Bild. */
    flushFrames: () => void;
    /** Wie viele Bilder anstehen. */
    pendingFrames: () => number;
    /** Wo eine erfasste Zeigerkennung ihr Loslassen hört. */
    pointerTarget: EventTarget;
    /** Die Antworten abwarten, die schon auf dem Weg sind. */
    settle: () => Promise<void>;
}

/**
 * Eine Karte mit Koordinator, Bildtakt von Hand. Ruft `vi.useFakeTimers()` nicht selbst auf. `scope` ist die Tafel der
 * teilnehmenden Besitzer (`ownersInView`).
 */
export function createHarness(options: { scope?: () => readonly string[] | undefined } = {}): Harness {
    const map = new FakeMap();
    let frames: (() => void)[] = [];
    const pointerTarget = new EventTarget();
    const coordinator = createInteractionCoordinator(map as unknown as MapLibreMap, {
        requestFrame: (callback) => frames.push(callback),
        cancelFrame: () => {
            frames = [];
        },
        pointerTarget,
        ...(options.scope ? { scope: options.scope } : {}),
    });
    return {
        map,
        coordinator,
        pointerTarget,
        pendingFrames: () => frames.length,
        flushFrames: () => {
            const pending = frames;
            frames = [];
            for (const callback of pending) callback();
        },
        settle: async () => {
            await vi.advanceTimersByTimeAsync(0);
        },
    };
}
