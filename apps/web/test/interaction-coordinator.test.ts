import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAYOUT_EVENT } from "../src/map/camera/visible-area.ts";
import { LONG_PRESS_MS, LONG_PRESS_RELEASE_CLICK_MS } from "../src/map/interaction/long-press.ts";
import { INTERACTION_PRIORITY } from "../src/map/interaction/priorities.ts";
import type {
    Claim,
    HitContext,
    InteractionKind,
    InteractionOwner,
    LostReason,
    MapInteractionCoordinator,
} from "../src/map/interaction/types.ts";
import { createHarness, FakePoint, feature, mouse, touch, type FakeMap, type Harness } from "./fake-interaction-map.ts";

/**
 * Der Interaktionsvertrag der Karte (M8): Rangtafel, Gewinnerwahl, Abmeldung, Erfassung, Ruhen des Zeigens
 * und der Abbruch asynchroner Treffer. Die Karte ist ein Testdoppel mit genau den Aufrufen, die der Koordinator
 * macht - so ist auch zählbar, wie oft er sie fragt.
 */

interface Log {
    applied: { id: string; kind: InteractionKind; claim: Claim }[];
    lost: { id: string; reason: LostReason }[];
    hits: string[];
}

interface OwnerSpec {
    id: string;
    priority?: number;
    kinds?: InteractionKind[];
    layers?: string[];
    enabled?: () => boolean;
    hit?: (context: HitContext) => Claim | undefined | Promise<Claim | undefined>;
}

function makeOwner(log: Log, spec: OwnerSpec): InteractionOwner {
    const priority =
        spec.priority ?? (INTERACTION_PRIORITY as Record<string, number>)[spec.id] ?? Number.NEGATIVE_INFINITY;
    return {
        id: spec.id,
        priority,
        kinds: spec.kinds ?? ["click", "hover"],
        layers: () => spec.layers ?? [],
        ...(spec.enabled ? { enabled: spec.enabled } : {}),
        hit(context) {
            log.hits.push(`${spec.id}:${context.kind}`);
            return spec.hit ? spec.hit(context) : {};
        },
        apply(kind, claim) {
            log.applied.push({ id: spec.id, kind, claim });
        },
        lost(reason) {
            log.lost.push({ id: spec.id, reason });
        },
    };
}

let harness: Harness;
let map: FakeMap;
let coordinator: MapInteractionCoordinator;
let log: Log;
let flushFrames: () => void;
let pointerTarget: EventTarget;
let settle: () => Promise<void>;

beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
    ({ map, coordinator, flushFrames, pointerTarget, settle } = harness);
    log = { applied: [], lost: [], hits: [] };
});

afterEach(() => {
    coordinator.destroy();
    vi.useRealTimers();
});

describe("die Rangtafel", () => {
    it("hat für jede Id eine eigene Zahl, und Legacys Rangfolge gilt: Ort vor Route vor Fläche", () => {
        const values = Object.values(INTERACTION_PRIORITY);
        expect(new Set(values).size).toBe(values.length);
        const p = INTERACTION_PRIORITY;
        // Die laufende Messung steht über allem außer der Kamerageste: Legacy schluckt den Klick, der den
        // zweiten Punkt setzt, im Capture am Kartencontainer (WI-0095).
        expect(p["camera-gesture"]).toBeGreaterThan(p.measure);
        expect(p.measure).toBeGreaterThan(p["waypoint-drag"]);
        expect(p["waypoint-drag"]).toBeGreaterThan(p.place);
        expect(p.place).toBeGreaterThan(p.route);
        // Die Kraftlinie liegt über Wegen und Flächen, das Klimaband unter allen Flächen (WI-0063 P8).
        expect(p.route).toBeGreaterThan(p.powerline);
        // Der Weg zwischen Kraftlinie und Fläche: Legacys „Ort vor Weg vor Region“ (WI-0090).
        expect(p.powerline).toBeGreaterThan(p.path);
        expect(p.path).toBeGreaterThan(p.area);
        expect(p.area).toBeGreaterThan(p.climate);
        expect(p.climate).toBeGreaterThan(p.context);
        expect(p.context).toBeGreaterThan(p.empty);
    });

    it("die festgelegten Zahlen: 100 · 95 · 90 · 80 · 60 · 50 · 45 · 40 · 30 · 0", () => {
        expect(INTERACTION_PRIORITY).toMatchObject({
            "camera-gesture": 100,
            measure: 95,
            "waypoint-drag": 90,
            place: 80,
            route: 60,
            powerline: 50,
            path: 45,
            area: 40,
            climate: 30,
            empty: 0,
        });
    });
});

describe("Gewinnerwahl", () => {
    it("der Besitzer mit dem höchsten Rang unter den Treffern gewinnt, die anderen erfahren nichts", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        coordinator.register(makeOwner(log, { id: "place" }));
        coordinator.register(makeOwner(log, { id: "route" }));
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.id)).toEqual(["place"]);
        // Die unteren wurden nicht einmal gefragt.
        expect(log.hits).toEqual(["place:click"]);
    });

    it("ohne Treffer geht das Ereignis an den nächsten; der Rückfall `empty` fängt es", () => {
        coordinator.register(makeOwner(log, { id: "place", hit: () => undefined }));
        coordinator.register(makeOwner(log, { id: "route", hit: () => undefined }));
        coordinator.register(makeOwner(log, { id: "empty" }));
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.id)).toEqual(["empty"]);
    });

    it("gleicher Rang: wer zuerst angemeldet wurde, gewinnt", () => {
        coordinator.register(makeOwner(log, { id: "erster", priority: 50 }));
        coordinator.register(makeOwner(log, { id: "zweiter", priority: 50 }));
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.id)).toEqual(["erster"]);
    });

    it("die Reihenfolge der Anmeldung spielt für verschiedene Ränge keine Rolle", () => {
        coordinator.register(makeOwner(log, { id: "route" }));
        coordinator.register(makeOwner(log, { id: "place" }));
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.id)).toEqual(["place"]);
    });

    it("ein Besitzer bekommt nur Ereignisarten, die er beansprucht; `enabled` schaltet ihn ganz aus", () => {
        let on = false;
        coordinator.register(makeOwner(log, { id: "place", kinds: ["hover"] }));
        coordinator.register(makeOwner(log, { id: "route", enabled: () => on }));
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.id)).toEqual(["area"]);
        log.applied.length = 0;
        on = true;
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.id)).toEqual(["route"]);
    });

    it("der Treffer trägt seine Angaben bis `apply`, samt Ereignis und Fensterlage", () => {
        let seen: HitContext | undefined;
        coordinator.register({
            ...makeOwner(log, { id: "place", layers: ["orte"] }),
            hit(context) {
                seen = context;
                return { cursor: "pointer" };
            },
        });
        map.layers.add("orte");
        const event = mouse(20, 30);
        map.fire("click", event);
        expect(seen?.kind).toBe("click");
        expect(seen?.point).toEqual({ x: 20, y: 30 });
        expect(seen?.screen).toEqual({ x: 120, y: 130 });
        expect(seen?.lngLat).toEqual({ lng: 2, lat: 3 });
        expect(seen?.event).toBe(event);
        expect(log.applied[0]?.claim).toEqual({ cursor: "pointer" });
    });
    it("🔴 Umschalt-Klick: MapLibres Rechteck-Zoom schluckt den Klick und meldet ohne Zug nur boxzoomcancel; daraus wird der Klick, mit Umschalt", () => {
        let seen: HitContext | undefined;
        coordinator.register({
            ...makeOwner(log, { id: "area", layers: ["flaeche"] }),
            hit(context) {
                seen = context;
                return {};
            },
        });
        map.layers.add("flaeche");
        map.fire("boxzoomcancel", { originalEvent: { clientX: 120, clientY: 130, shiftKey: true } });
        expect(log.applied.map((x) => [x.id, x.kind])).toEqual([["area", "click"]]);
        expect(seen?.point).toEqual({ x: 20, y: 30 });
        expect(seen?.lngLat).toEqual({ lng: 2, lat: 3 });
        expect((seen?.event.originalEvent as MouseEvent).shiftKey).toBe(true);
        // 🔴 Die Abfrage fragt die Stelle als Punkt der Karte, kein `{ x, y }`: Das hielt MapLibre für Optionen und fragte das ganze Bild.
        expect(map.queries.at(-1)?.area).toBeInstanceOf(FakePoint);
    });
});

describe("Umschalt-Klick fällt durch (WI-0209, Editor-Orchestrierung 2026-10-20 „A“)", () => {
    const umschaltKlick = (): void =>
        map.fire("boxzoomcancel", { originalEvent: { clientX: 120, clientY: 130, shiftKey: true } });
    /** Ein Objekt-Besitzer; `nimmt`: ob ein offenes Fenster sein Objekt aufnimmt. */
    const objekt = (id: string, nimmt: boolean, gefragt: string[], hit?: OwnerSpec["hit"]): InteractionOwner => ({
        ...makeOwner(log, { id, ...(hit ? { hit } : {}) }),
        umschalt: () => {
            gefragt.push(id);
            return nimmt;
        },
    });

    it("🔴 Ort und Weg darüber nimmt kein Fenster auf: Das Gebiet darunter wird angehakt, gewählt wird nichts", () => {
        const gefragt: string[] = [];
        coordinator.register(objekt("place", false, gefragt));
        coordinator.register(objekt("path", false, gefragt));
        coordinator.register(objekt("area", true, gefragt));
        coordinator.register(makeOwner(log, { id: "empty" }));
        umschaltKlick();
        expect(gefragt).toEqual(["place", "path", "area"]);
        expect(log.applied).toEqual([]);
    });
    it("🔴 Nehmen zwei auf, nimmt das oberste den Klick", () => {
        const gefragt: string[] = [];
        coordinator.register(objekt("place", true, gefragt));
        coordinator.register(objekt("area", true, gefragt));
        umschaltKlick();
        expect(gefragt).toEqual(["place"]);
        expect(log.applied).toEqual([]);
    });
    it("🔴 Nimmt keins auf, bleibt es ein gewöhnlicher Klick auf das oberste Objekt, nicht auf die freie Karte", () => {
        const gefragt: string[] = [];
        coordinator.register(objekt("place", false, gefragt));
        coordinator.register(objekt("area", false, gefragt));
        coordinator.register(makeOwner(log, { id: "empty" }));
        umschaltKlick();
        expect(gefragt).toEqual(["place", "area"]);
        expect(log.applied.map((x) => [x.id, x.kind])).toEqual([["place", "click"]]);
    });
    it("ein Besitzer ohne Objekt darüber (die Messung) behält den Klick, gefragt wird kein Objekt", () => {
        const gefragt: string[] = [];
        coordinator.register(makeOwner(log, { id: "measure" }));
        coordinator.register(objekt("area", true, gefragt));
        umschaltKlick();
        expect(gefragt).toEqual([]);
        expect(log.applied.map((x) => x.id)).toEqual(["measure"]);
    });
    it("ohne Umschalt fragt niemand, ob ein Fenster aufnimmt", () => {
        const gefragt: string[] = [];
        coordinator.register(objekt("place", true, gefragt));
        map.fire("click", mouse(5, 5));
        expect(gefragt).toEqual([]);
        expect(log.applied.map((x) => x.id)).toEqual(["place"]);
    });
    it("eine Fläche, die erst der Server nennt, nimmt den Klick nach dem Ort darüber auf", async () => {
        const gefragt: string[] = [];
        coordinator.register(objekt("place", false, gefragt));
        coordinator.register(objekt("area", true, gefragt, () => Promise.resolve({})));
        umschaltKlick();
        await settle();
        expect(gefragt).toEqual(["place", "area"]);
        expect(log.applied).toEqual([]);
    });
});

describe("eine Abfrage je Ereignis", () => {
    it("ein Klick fragt die Karte einmal, über die Layer aller Beteiligten, ohne die im Stil fehlenden", () => {
        map.layers.add("orte");
        map.layers.add("route");
        map.layers.add("flaechen");
        coordinator.register(makeOwner(log, { id: "place", layers: ["orte", "fehlt"] }));
        coordinator.register(makeOwner(log, { id: "route", layers: ["route", "orte"] }));
        coordinator.register(makeOwner(log, { id: "area", layers: ["flaechen"] }));
        // Ein Besitzer, der Klicks nicht beansprucht, trägt seine Layer nicht bei.
        coordinator.register(makeOwner(log, { id: "context", kinds: ["contextmenu"], layers: ["nie"] }));
        map.layers.add("nie");
        map.fire("click", mouse(5, 5));
        expect(map.queries).toHaveLength(1);
        expect(map.queries[0]?.layers.sort()).toEqual(["flaechen", "orte", "route"]);
    });

    it("ohne Layer keine Abfrage", () => {
        coordinator.register(makeOwner(log, { id: "empty" }));
        map.fire("click", mouse(5, 5));
        expect(map.queries).toHaveLength(0);
    });

    it("das Ergebnis liegt nach Layer gruppiert im Kontext, oberster Treffer zuerst", () => {
        map.layers.add("a");
        map.layers.add("b");
        map.hits = [feature("a", { n: 1 }), feature("b", { n: 2 }), feature("a", { n: 3 })];
        let seen: HitContext | undefined;
        coordinator.register({
            ...makeOwner(log, { id: "place", layers: ["a", "b"] }),
            hit(context) {
                seen = context;
                return {};
            },
        });
        map.fire("click", mouse(5, 5));
        expect(seen?.byLayer.get("a")?.map((entry) => entry.properties["n"])).toEqual([1, 3]);
        expect(seen?.byLayer.get("b")?.map((entry) => entry.properties["n"])).toEqual([2]);
        expect(seen?.features(["a", "b"]).map((entry) => entry.properties["n"])).toEqual([1, 2, 3]);
        expect(seen?.features(["b"]).map((entry) => entry.properties["n"])).toEqual([2]);
        expect(seen?.byLayer.has("c")).toBe(false);
    });

    it("eine Abfrage mit Spiel ist eine zweite, nur wer sie will, zahlt sie", () => {
        map.layers.add("fluss");
        let reached: unknown;
        coordinator.register({
            ...makeOwner(log, { id: "area" }),
            hit(context) {
                context.query(["fluss", "fehlt"], 5);
                reached = map.queries.at(-1)?.area;
                return {};
            },
        });
        map.fire("click", mouse(50, 60));
        expect(map.queries).toHaveLength(1);
        expect(reached).toEqual([
            [45, 55],
            [55, 65],
        ]);
        expect(map.queries[0]?.layers).toEqual(["fluss"]);
    });
});

describe("Abmeldung", () => {
    it("wer sich abmeldet, bekommt nichts mehr", () => {
        const off = coordinator.register(makeOwner(log, { id: "place" }));
        map.fire("click", mouse(5, 5));
        off();
        map.fire("click", mouse(5, 5));
        expect(log.applied).toHaveLength(1);
    });

    it("eine Id gibt es nur einmal", () => {
        coordinator.register(makeOwner(log, { id: "place" }));
        expect(() => coordinator.register(makeOwner(log, { id: "place" }))).toThrow(/schon angemeldet/);
    });

    it("nach der Abmeldung ist die Id wieder frei, und der nächste im Rang gewinnt", () => {
        const off = coordinator.register(makeOwner(log, { id: "place" }));
        coordinator.register(makeOwner(log, { id: "route" }));
        off();
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.id)).toEqual(["route"]);
        expect(() => coordinator.register(makeOwner(log, { id: "place" }))).not.toThrow();
    });

    it("der Besitzer, der gerade zeigt, nimmt beim Abmelden seine Anzeigen zurück", () => {
        const off = coordinator.register(makeOwner(log, { id: "area", hit: () => ({ cursor: "pointer" }) }));
        map.fire("mousemove", mouse(5, 5));
        flushFrames();
        expect(map.canvas.style.cursor).toBe("pointer");
        off();
        expect(log.lost).toEqual([{ id: "area", reason: "hover-ended" }]);
        expect(map.canvas.style.cursor).toBe("");
    });

    it("destroy nimmt jeden Listener von der Karte, danach passiert nichts mehr", () => {
        coordinator.register(makeOwner(log, { id: "place" }));
        coordinator.observe("activity", () => undefined);
        expect(map.listenerCount()).toBeGreaterThan(0);
        coordinator.destroy();
        expect(map.listenerCount()).toBe(0);
        map.fire("click", mouse(5, 5));
        expect(log.applied).toHaveLength(0);
        // Zweimal ist erlaubt, und Anmelden nach dem Ende ist ein Nichts.
        expect(() => coordinator.destroy()).not.toThrow();
        const off = coordinator.register(makeOwner(log, { id: "route" }));
        expect(() => off()).not.toThrow();
        expect(coordinator.capture("waypoint-drag")).toBeUndefined();
    });
});

describe("das Zeigen", () => {
    it("wird je Bild einmal gerechnet, auch nach mehreren Mausbewegungen, und die Zeigerform gehört dem Gewinner", () => {
        coordinator.register(makeOwner(log, { id: "place", hit: () => ({ cursor: "pointer" }) }));
        map.fire("mousemove", mouse(1, 1));
        map.fire("mousemove", mouse(2, 2));
        map.fire("mousemove", mouse(3, 3));
        expect(harness.pendingFrames()).toBe(1);
        flushFrames();
        expect(log.hits).toEqual(["place:hover"]);
        expect(map.canvas.style.cursor).toBe("pointer");
    });

    it("wechselt der Gewinner, verliert der alte die Hoheit, ehe der neue zeigt", () => {
        let over = "place";
        coordinator.register(
            makeOwner(log, { id: "place", hit: () => (over === "place" ? { cursor: "pointer" } : undefined) }),
        );
        coordinator.register(makeOwner(log, { id: "area", hit: () => ({ cursor: "crosshair" }) }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        expect(map.canvas.style.cursor).toBe("pointer");
        over = "area";
        map.fire("mousemove", mouse(2, 2));
        flushFrames();
        expect(log.lost).toEqual([{ id: "place", reason: "hover-ended" }]);
        expect(map.canvas.style.cursor).toBe("crosshair");
    });

    it("ein Gewinner ohne Zeigerform lässt die Form los, die der Vorgänger setzte", () => {
        let over = "place";
        coordinator.register(
            makeOwner(log, { id: "place", hit: () => (over === "place" ? { cursor: "pointer" } : undefined) }),
        );
        coordinator.register(makeOwner(log, { id: "area", hit: () => ({}) }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        over = "area";
        map.fire("mousemove", mouse(2, 2));
        flushFrames();
        expect(map.canvas.style.cursor).toBe("");
    });

    it("eine fremde Zeigerform überschreibt der Koordinator beim Zurücksetzen nicht", () => {
        coordinator.register(makeOwner(log, { id: "place", hit: () => ({ cursor: "pointer" }) }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        map.canvas.style.cursor = "grabbing";
        map.fire("mouseout", mouse(1, 1));
        expect(map.canvas.style.cursor).toBe("grabbing");
    });

    it("der Zeiger verlässt die Karte: Der Gewinner verliert die Hoheit, ein anstehendes Bild entfällt", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        map.fire("mousemove", mouse(2, 2));
        map.fire("mouseout", mouse(2, 2));
        flushFrames();
        expect(log.lost).toEqual([{ id: "area", reason: "hover-ended" }]);
        // Das anstehende Bild hätte ein zweites Zeigen gebracht.
        expect(log.applied.filter((entry) => entry.kind === "hover")).toHaveLength(1);
    });

    it("mit gedrückter Taste wird nicht gezeigt, und was gezeigt wurde, geht", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        map.fire("mousemove", mouse(2, 2, { originalEvent: { clientX: 0, clientY: 0, buttons: 1, button: 0 } }));
        flushFrames();
        expect(log.applied.filter((entry) => entry.kind === "hover")).toHaveLength(1);
        expect(log.lost).toEqual([{ id: "area", reason: "hover-ended" }]);
    });

    it("eine Kartenbewegung nimmt das Gezeigte weg", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        map.fire("movestart", {});
        expect(log.lost).toEqual([{ id: "area", reason: "hover-ended" }]);
    });

    it("ein Klick beendet das Zeigen", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        map.fire("click", mouse(1, 1));
        expect(log.lost).toEqual([{ id: "area", reason: "hover-ended" }]);
    });

    it("🔴 ein Klick verwirft auch das schon geplante Bild des letzten Zeigens (am Telefon blieb das Schild nach dem Tipp stehen)", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        // Der Tipp feuert vorher ein `mousemove`: Sein Bild steht an, wenn der Klick kommt.
        map.fire("mousemove", mouse(2, 2));
        map.fire("click", mouse(2, 2));
        flushFrames();
        expect(log.applied.filter((entry) => entry.kind === "hover")).toHaveLength(1);
        expect(log.lost).toEqual([{ id: "area", reason: "hover-ended" }]);
    });
});

describe("asynchrone Treffer", () => {
    /** Ein Treffer, den der Test selbst auflöst. */
    function deferred(): { promise: Promise<Claim | undefined>; resolve: (claim: Claim | undefined) => void } {
        let resolve!: (claim: Claim | undefined) => void;
        const promise = new Promise<Claim | undefined>((done) => {
            resolve = done;
        });
        return { promise, resolve };
    }

    it("ein Besitzer mit niedrigem Rang wartet auf den mit hohem, der eine Antwort abwartet", async () => {
        const first = deferred();
        coordinator.register(makeOwner(log, { id: "place", hit: () => first.promise }));
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("click", mouse(5, 5));
        await settle();
        expect(log.applied).toHaveLength(0);
        expect(log.hits).toEqual(["place:click"]);
        first.resolve(undefined);
        await settle();
        expect(log.applied.map((entry) => entry.id)).toEqual(["area"]);
    });

    it("ein synchroner Treffer weiter oben erspart die Frage weiter unten ganz", async () => {
        const slow = vi.fn(() => deferred().promise);
        coordinator.register(makeOwner(log, { id: "place" }));
        coordinator.register(makeOwner(log, { id: "area", hit: slow }));
        map.fire("click", mouse(5, 5));
        await settle();
        expect(slow).not.toHaveBeenCalled();
        expect(log.applied.map((entry) => entry.id)).toEqual(["place"]);
    });

    it("ein jüngerer Klick überholt den älteren: dessen Signal bricht ab, seine Antwort gilt nicht mehr", async () => {
        const signals: AbortSignal[] = [];
        const answers: ReturnType<typeof deferred>[] = [];
        coordinator.register(
            makeOwner(log, {
                id: "area",
                hit(context) {
                    signals.push(context.signal);
                    const answer = deferred();
                    answers.push(answer);
                    return answer.promise;
                },
            }),
        );
        map.fire("click", mouse(1, 1));
        map.fire("click", mouse(2, 2));
        expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
        answers[0]?.resolve({});
        answers[1]?.resolve({ cursor: "neu" });
        await settle();
        expect(log.applied).toHaveLength(1);
        expect(log.applied[0]?.claim).toEqual({ cursor: "neu" });
    });

    it("beim Zeigen: Was bis eben galt, geht sofort, die Antwort zeigt erst danach, und ein neues Bild bricht sie ab", async () => {
        const answers: ReturnType<typeof deferred>[] = [];
        const signals: AbortSignal[] = [];
        let asynchronous = false;
        coordinator.register(
            makeOwner(log, {
                id: "area",
                hit(context) {
                    signals.push(context.signal);
                    if (!asynchronous) return { cursor: "pointer" };
                    const answer = deferred();
                    answers.push(answer);
                    return answer.promise;
                },
            }),
        );
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        expect(map.canvas.style.cursor).toBe("pointer");
        asynchronous = true;
        map.fire("mousemove", mouse(2, 2));
        flushFrames();
        // Die Antwort steht aus: keine Anzeige und keine Zeigerform für die alte Stelle.
        expect(log.lost).toEqual([{ id: "area", reason: "hover-ended" }]);
        expect(map.canvas.style.cursor).toBe("");
        map.fire("mousemove", mouse(3, 3));
        flushFrames();
        expect(signals.at(-2)?.aborted).toBe(true);
        answers[0]?.resolve({ cursor: "pointer" });
        await settle();
        // Die überholte Antwort zeigt nichts.
        expect(log.applied.filter((entry) => entry.kind === "hover")).toHaveLength(1);
        answers[1]?.resolve({ cursor: "pointer" });
        await settle();
        expect(log.applied.filter((entry) => entry.kind === "hover")).toHaveLength(2);
        expect(map.canvas.style.cursor).toBe("pointer");
    });

    it("eine gescheiterte Frage ist kein Treffer, und die unteren kommen dran", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
        coordinator.register(makeOwner(log, { id: "place", hit: () => Promise.reject(new Error("Netz")) }));
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("click", mouse(5, 5));
        await settle();
        expect(log.applied.map((entry) => entry.id)).toEqual(["area"]);
        expect(quiet).toHaveBeenCalledTimes(1);
        quiet.mockRestore();
    });

    it("das Ende einer abgebrochenen Frage wird nicht gemeldet", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const abort = new Error("abgebrochen");
        abort.name = "AbortError";
        coordinator.register(makeOwner(log, { id: "place", hit: () => Promise.reject(abort) }));
        map.fire("click", mouse(5, 5));
        await settle();
        expect(quiet).not.toHaveBeenCalled();
        quiet.mockRestore();
    });

    it("ein Besitzer, der sofort wirft, hält die anderen nicht auf", () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
        coordinator.register(
            makeOwner(log, {
                id: "place",
                hit: () => {
                    throw new Error("kaputt");
                },
            }),
        );
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.id)).toEqual(["area"]);
        quiet.mockRestore();
    });
});

describe("Beobachter des Klicks", () => {
    it("erfahren, wer den Klick hat - sofort, wenn ein synchroner Besitzer ihn hat", () => {
        const told: (string | undefined)[] = [];
        coordinator.observe("click", ({ claimedBy }) => told.push(claimedBy));
        coordinator.register(makeOwner(log, { id: "place" }));
        map.fire("click", mouse(5, 5));
        expect(told).toEqual(["place"]);
    });

    it("erfahren `undefined`, wenn niemand ihn hat, und einmal je Klick", () => {
        const told: (string | undefined)[] = [];
        coordinator.observe("click", ({ claimedBy }) => told.push(claimedBy));
        map.fire("click", mouse(5, 5));
        expect(told).toEqual([undefined]);
    });

    it("erfahren es ohne die Antwort des Servers abzuwarten: `undefined`, sobald ein asynchroner Besitzer dran ist", async () => {
        const told: (string | undefined)[] = [];
        coordinator.observe("click", ({ claimedBy }) => told.push(claimedBy));
        let answer!: (claim: Claim | undefined) => void;
        coordinator.register(makeOwner(log, { id: "place", hit: () => undefined }));
        coordinator.register(
            makeOwner(log, {
                id: "area",
                hit: () =>
                    new Promise<Claim | undefined>((done) => {
                        answer = done;
                    }),
            }),
        );
        map.fire("click", mouse(5, 5));
        expect(told).toEqual([undefined]);
        answer({});
        await settle();
        expect(told).toEqual([undefined]);
        expect(log.applied.map((entry) => entry.id)).toEqual(["area"]);
    });

    it("der Beobachter meldet sich ab", () => {
        const told: unknown[] = [];
        const off = coordinator.observe("click", (info) => told.push(info));
        off();
        map.fire("click", mouse(5, 5));
        expect(told).toEqual([]);
    });
});

describe("Erfassen einer Geste", () => {
    const kinds: InteractionKind[] = ["click", "hover", "press", "contextmenu"];

    it("solange sie läuft, bekommt kein anderer Klick, Druck, Kontextmenü, Zeigen oder langen Druck", () => {
        coordinator.register(makeOwner(log, { id: "place", kinds }));
        const release = coordinator.capture("waypoint-drag");
        expect(coordinator.captured()).toBe("waypoint-drag");
        map.fire("click", mouse(5, 5));
        map.fire("mousedown", mouse(5, 5));
        map.fire("contextmenu", mouse(5, 5));
        map.fire("mousemove", mouse(5, 5));
        flushFrames();
        map.fire("touchstart", touch(5, 5));
        vi.advanceTimersByTime(LONG_PRESS_MS + 50);
        expect(log.applied).toHaveLength(0);
        release?.();
        expect(coordinator.captured()).toBeUndefined();
        map.fire("click", mouse(5, 5));
        expect(log.applied.map((entry) => entry.kind)).toEqual(["click"]);
    });

    it("die Erfassung beendet das Zeigen der anderen, den Erfasser selbst lässt sie in Ruhe", () => {
        coordinator.register(makeOwner(log, { id: "waypoint-drag" }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        coordinator.capture("waypoint-drag");
        expect(log.lost).toEqual([]);
        coordinator.capture("camera-gesture");
        // Die stärkere Geste verdrängt sie, und der Besitzer erfährt es.
        expect(log.lost).toEqual([{ id: "waypoint-drag", reason: "preempted" }]);
    });

    it("wer den Zeiger hält, hat die Zeigerform, bis er losgelassen hat", () => {
        const release = coordinator.capture("waypoint-drag", undefined, "grabbing");
        expect(map.canvas.style.cursor).toBe("grabbing");
        release?.();
        expect(map.canvas.style.cursor).toBe("");
    });

    it("eine Geste mit gleichem oder niedrigerem Rang bekommt den Zeiger nicht", () => {
        const first = coordinator.capture("waypoint-drag");
        expect(first).toBeDefined();
        expect(coordinator.capture("waypoint-drag")).toBeUndefined();
        expect(coordinator.capture("place")).toBeUndefined();
        expect(coordinator.captured()).toBe("waypoint-drag");
    });

    it("eine Geste mit höherem Rang verdrängt die laufende; deren Loslassen ist danach folgenlos", () => {
        const drag = coordinator.capture("waypoint-drag", undefined, "grabbing");
        const camera = coordinator.capture("camera-gesture");
        expect(camera).toBeDefined();
        expect(coordinator.captured()).toBe("camera-gesture");
        drag?.();
        expect(coordinator.captured()).toBe("camera-gesture");
        camera?.();
        expect(coordinator.captured()).toBeUndefined();
    });

    it("mit einer Zeigerkennung endet die Erfassung, wenn genau dieser Zeiger loslässt", () => {
        coordinator.capture("camera-gesture", 7);
        const other = new Event("pointerup");
        Object.assign(other, { pointerId: 8 });
        pointerTarget.dispatchEvent(other);
        expect(coordinator.captured()).toBe("camera-gesture");
        const same = new Event("pointerup");
        Object.assign(same, { pointerId: 7 });
        pointerTarget.dispatchEvent(same);
        expect(coordinator.captured()).toBeUndefined();
    });

    it("mit einer Zeigerkennung endet sie auch, wenn der Zeiger abgebrochen wird", () => {
        coordinator.capture("camera-gesture", 3);
        const cancel = new Event("pointercancel");
        Object.assign(cancel, { pointerId: 3 });
        pointerTarget.dispatchEvent(cancel);
        expect(coordinator.captured()).toBeUndefined();
    });

    it("meldet sich der Besitzer ab, ist seine Erfassung vorbei", () => {
        const off = coordinator.register(makeOwner(log, { id: "waypoint-drag" }));
        coordinator.capture("waypoint-drag");
        off();
        expect(coordinator.captured()).toBeUndefined();
    });
});

describe("der lange Druck", () => {
    // 🔴 Der lange Druck IST der Rechtsklick (WI-0108): Er kommt als `contextmenu` beim Besitzer an, nicht als
    // eigene Art. Ein Besitzer, der nur den Rechtsklick beansprucht, bekommt ihn damit von selbst.
    const kinds: InteractionKind[] = ["contextmenu"];

    it("🔴 gilt nach 550 ms stillem Druck mit einem Finger und kommt als Kontextmenü beim Besitzer an", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(LONG_PRESS_MS - 1);
        expect(log.applied).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(log.applied.map((entry) => entry.kind)).toEqual(["contextmenu"]);
    });

    it("ein kurzer Tipp, Wegziehen über die Toleranz, ein zweiter Finger oder das Ende brechen ihn ab", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        const cases: (() => void)[] = [
            () => map.fire("touchend", {}),
            () => map.fire("touchcancel", {}),
            () => map.fire("touchmove", touch(40 + 30, 50)),
            () => map.fire("touchmove", touch(40, 50, 2)),
        ];
        for (const interrupt of cases) {
            map.fire("touchstart", touch(40, 50));
            vi.advanceTimersByTime(200);
            interrupt();
            vi.advanceTimersByTime(LONG_PRESS_MS);
            expect(log.applied).toHaveLength(0);
        }
    });

    it("eine kleine Bewegung innerhalb der Toleranz lässt ihn gelten", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        map.fire("touchstart", touch(40, 50));
        map.fire("touchmove", touch(45, 50));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(log.applied).toHaveLength(1);
    });

    it("💣 schiebt sich die Karte, bricht er ab: kein Menü mitten im Zug", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(200);
        // MapLibre beginnt das Schieben schon bei 3 px, die eigene Toleranz liegt bei 10: Die Bewegung der
        // Karte ist das eindeutige Zeichen, nicht eine zweite Pixelzahl.
        map.fire("movestart", {});
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(log.applied).toHaveLength(0);
    });

    it("💣 der Klick beim Loslassen zählt nicht: sonst wählte der lange Druck, was der Rechtsklick nie wählt", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        coordinator.register(makeOwner(log, { id: "place", kinds: ["click"] }));
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        // 🔴 Das Loslassen nimmt dem Browser den Klick: Sonst träfe er, was inzwischen unter dem Finger steht (das Infopanel mit seinen Kacheln).
        const preventDefault = vi.fn();
        map.fire("touchend", { originalEvent: { preventDefault } });
        expect(preventDefault).toHaveBeenCalledOnce();
        // Den macht der Browser aus dem Loslassen, nicht der Mensch (mancher trotzdem).
        map.fire("click", mouse(40, 50));
        expect(log.applied.map((entry) => entry.kind)).toEqual(["contextmenu"]);

        // Der NÄCHSTE Tipp zählt wieder - der Riegel gilt genau einmal.
        map.fire("touchstart", touch(40, 50));
        map.fire("touchend", {});
        map.fire("click", mouse(40, 50));
        expect(log.applied.map((entry) => entry.id)).toEqual(["context", "place"]);
    });

    it("🔴 der Riegel hält nur das Loslassen (WI-0272 S3, Fixrunde H): Kam kein Klick, weil der Browser ihn nahm, zählt der nächste Klick wieder, auch ohne neuen Touch auf der Karte", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        coordinator.register(makeOwner(log, { id: "place", kinds: ["click"] }));
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        const preventDefault = vi.fn();
        map.fire("touchend", { originalEvent: { preventDefault } });
        expect(preventDefault).toHaveBeenCalledOnce();
        // Es kommt kein Klick. Das Menü ist offen, der Mensch wählt dort (kein Ereignis der Karte), öffnet ein Formular und tippt dann auf die Karte, um eine Stelle
        // zu wählen: mit der Maus oder dem Stift (kein `touchstart` auf der Karte, der den Riegel löste) oder in einem Test, der den Tipp als Mausklick schickt.
        vi.advanceTimersByTime(LONG_PRESS_RELEASE_CLICK_MS + 1);
        map.fire("click", mouse(60, 70));
        expect(log.applied.map((entry) => entry.id)).toEqual(["context", "place"]);
    });

    it("der Riegel fängt den Klick des Browsers noch kurz nach dem Loslassen (mancher schickt ihn trotzdem), danach nicht mehr", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        coordinator.register(makeOwner(log, { id: "place", kinds: ["click"] }));
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        map.fire("touchend", { originalEvent: { preventDefault: vi.fn() } });
        vi.advanceTimersByTime(LONG_PRESS_RELEASE_CLICK_MS - 1);
        map.fire("click", mouse(40, 50));
        expect(log.applied.map((entry) => entry.id)).toEqual(["context"]);
        // Verbraucht: der nächste Klick, auch ohne Touch, zählt.
        map.fire("click", mouse(40, 50));
        expect(log.applied.map((entry) => entry.id)).toEqual(["context", "place"]);
    });

    it("ohne langen Druck bleibt der Tipp ein Klick", () => {
        coordinator.register(makeOwner(log, { id: "place", kinds: ["click"] }));
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(200);
        const preventDefault = vi.fn();
        map.fire("touchend", { originalEvent: { preventDefault } });
        expect(preventDefault).not.toHaveBeenCalled();
        map.fire("click", mouse(40, 50));
        expect(log.applied.map((entry) => entry.kind)).toEqual(["click"]);
    });

    it("🪰 das Nachführen der sichtbaren Fläche bricht ihn NICHT ab - es ist niemandes Geste", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(200);
        map.fire("movestart", { [LAYOUT_EVENT]: true });
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(log.applied.map((entry) => entry.kind)).toEqual(["contextmenu"]);
    });

    it("🔴 wer beim Druck den Finger erfasst, bricht den langen Druck ab", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        coordinator.register({
            ...makeOwner(log, { id: "waypoint-drag", kinds: ["press"], hit: () => ({}) }),
            apply() {
                coordinator.capture("waypoint-drag");
            },
        });
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(LONG_PRESS_MS + 500);
        expect(log.applied).toHaveLength(0);
    });

    it("🔴 wer den Finger erst nach dem Druck erfasst, bricht ihn auch ab", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds }));
        map.fire("touchstart", touch(40, 50));
        vi.advanceTimersByTime(300);
        const release = coordinator.capture("waypoint-drag");
        // Auch wenn die Geste endet, ehe die 550 ms um wären: Der lange Druck kommt nicht nachträglich.
        vi.advanceTimersByTime(100);
        release?.();
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(log.applied).toHaveLength(0);
    });
});

describe("der Druck", () => {
    it("Maus und Finger gehen an den Besitzer, der `preventDefault` noch im Ereignis aufrufen kann", () => {
        coordinator.register({
            ...makeOwner(log, { id: "waypoint-drag", kinds: ["press"] }),
            apply(_kind, _claim, context) {
                context.event.preventDefault();
            },
        });
        const down = mouse(5, 5);
        map.fire("mousedown", down);
        expect(down["preventDefault"]).toHaveBeenCalledTimes(1);
        const start = touch(5, 5);
        map.fire("touchstart", start);
        expect(start["preventDefault"]).toHaveBeenCalledTimes(1);
    });
});

describe("das Kontextmenü", () => {
    it("die rechte Taste geht an den Besitzer der Art", () => {
        coordinator.register(makeOwner(log, { id: "context", kinds: ["contextmenu"] }));
        map.fire("contextmenu", mouse(5, 5));
        expect(log.applied.map((entry) => entry.kind)).toEqual(["contextmenu"]);
    });
});

describe("das Zeigen ruhen lassen", () => {
    it("was gerade gezeigt wird, geht weg; neues Zeigen kommt nicht, bis fortgesetzt wird", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        const resume = coordinator.suspendHover("liste");
        expect(log.lost).toEqual([{ id: "area", reason: "hover-ended" }]);
        map.fire("mousemove", mouse(2, 2));
        flushFrames();
        expect(log.applied.filter((entry) => entry.kind === "hover")).toHaveLength(1);
        resume();
        map.fire("mousemove", mouse(3, 3));
        flushFrames();
        expect(log.applied.filter((entry) => entry.kind === "hover")).toHaveLength(2);
    });

    it("Klicks bleiben unberührt", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        coordinator.suspendHover("liste");
        map.fire("click", mouse(1, 1));
        expect(log.applied.map((entry) => entry.kind)).toEqual(["click"]);
    });

    it("mit Besitzern ruht nur deren Zeigen: die anderen zeigen weiter", () => {
        coordinator.register(makeOwner(log, { id: "place" }));
        coordinator.register(makeOwner(log, { id: "area" }));
        coordinator.suspendHover("liste", ["place"]);
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        // `place` ruht, `area` bekommt die Hoheit.
        expect(log.applied.map((entry) => entry.id)).toEqual(["area"]);
    });

    it("mit Besitzern verliert nur der Gezeigte, wenn er gemeint ist", () => {
        coordinator.register(makeOwner(log, { id: "place" }));
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        coordinator.suspendHover("liste", ["area"]);
        expect(log.lost).toEqual([]);
    });

    it("mehrere Gründe zählen einzeln: Erst wenn alle fortgesetzt sind, zeigt es wieder", () => {
        coordinator.register(makeOwner(log, { id: "area" }));
        const first = coordinator.suspendHover("eins");
        const second = coordinator.suspendHover("zwei");
        first();
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        expect(log.applied).toHaveLength(0);
        second();
        map.fire("mousemove", mouse(2, 2));
        flushFrames();
        expect(log.applied).toHaveLength(1);
    });

    it("eine Antwort, die während des Ruhens eintrifft, zeigt nichts", async () => {
        let answer!: (claim: Claim | undefined) => void;
        coordinator.register(
            makeOwner(log, {
                id: "area",
                hit: () =>
                    new Promise<Claim | undefined>((done) => {
                        answer = done;
                    }),
            }),
        );
        map.fire("mousemove", mouse(1, 1));
        flushFrames();
        coordinator.suspendHover("liste");
        answer({});
        await settle();
        expect(log.applied).toHaveLength(0);
    });
});

describe("Beobachter der Eingaben", () => {
    it("`gesture` hört Druck und Rad an der Karte, `activity` alle Eingaben - beide vor jedem anderen Zuhörer", () => {
        const gestures = vi.fn();
        const activity = vi.fn();
        coordinator.observe("gesture", gestures);
        coordinator.observe("activity", activity);
        for (const type of ["pointerdown", "wheel", "pointermove", "touchstart", "touchmove", "keydown"]) {
            map.container.dispatchEvent(new Event(type));
        }
        expect(gestures).toHaveBeenCalledTimes(2);
        // Bewegung, Druck, Rad und beide Fingerarten - eine Taste zählt nicht.
        expect(activity).toHaveBeenCalledTimes(5);
    });

    it("gehört wird erst, wenn jemand zuhört, und nicht mehr, wenn der letzte geht", () => {
        const add = vi.spyOn(map.container, "addEventListener");
        const remove = vi.spyOn(map.container, "removeEventListener");
        expect(add).not.toHaveBeenCalled();
        const first = coordinator.observe("activity", () => undefined);
        const second = coordinator.observe("activity", () => undefined);
        const attached = add.mock.calls.length;
        expect(attached).toBeGreaterThan(0);
        first();
        expect(remove).not.toHaveBeenCalled();
        second();
        expect(remove.mock.calls.length).toBe(attached);
    });

    it("ein abgemeldeter Beobachter hört nichts mehr", () => {
        const heard = vi.fn();
        const off = coordinator.observe("gesture", heard);
        off();
        map.container.dispatchEvent(new Event("pointerdown"));
        expect(heard).not.toHaveBeenCalled();
    });

    it("destroy nimmt die Zuhörer von der Karte", () => {
        const heard = vi.fn();
        coordinator.observe("gesture", heard);
        coordinator.destroy();
        map.container.dispatchEvent(new Event("pointerdown"));
        expect(heard).not.toHaveBeenCalled();
    });
});
