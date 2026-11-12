import { describe, expect, it } from "vitest";
import { shallowRef } from "vue";
import type { RouteResponse } from "@avesmaps3d/shared";
import type { JourneyPosition } from "../src/route-planner/journey-timeline.ts";
import { playSeconds, REDUCED_STEP_MS, usePlaymode, type PlaymodeEffects } from "../src/route-planner/use-playmode.ts";
import { journeyRoute } from "./playmode-route.ts";

/**
 * Die Kamera springt nie, und die Uhr wartet auf sie (Betreiber 2026-09-29, Design Guide §17): Beim Druck auf ▶
 * und nach jedem Sprung der Leiste fliegt die Kamera zum Pfeil; erst wenn sie angekommen ist, laufen Uhr und
 * Pfeil. Bricht man den Anflug beim Start ab, beginnt die Wiedergabe nicht. Die Karte ist hier ein Protokoll, und
 * der Flug ein Versprechen, das der Test selbst einlöst.
 */

function harness(options: { reduced?: boolean; approach?: boolean } = {}) {
    const shown: (JourneyPosition | null)[] = [];
    const follows: { x: number; jump: boolean }[] = [];
    const flights: { x: number; course: number; arrive: (arrived: boolean) => void }[] = [];
    const delays: number[] = [];
    let frames: ((time: number) => void)[] = [];
    let timers: (() => void)[] = [];
    let letGos = 0;
    const effects: PlaymodeEffects = {
        show: (position) => shown.push(position),
        follow: (position, jump) => follows.push({ x: position.x, jump }),
        ...(options.approach === false
            ? {}
            : {
                  approach: (position: JourneyPosition, course: number) =>
                      new Promise<boolean>((arrive) => flights.push({ x: position.x, course, arrive })),
              }),
        takeOff: () => undefined,
        letGo: () => {
            letGos += 1;
        },
        requestFrame: (callback) => frames.push(callback),
        cancelFrame: () => {
            frames = [];
        },
        setTimer: (callback, ms) => {
            timers.push(callback);
            delays.push(ms);
            return 0 as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimer: () => {
            timers = [];
        },
        reducedMotion: () => options.reduced === true,
        watch: () => () => undefined,
        rejoin: () => undefined,
    };
    const source = shallowRef<RouteResponse | null>(journeyRoute());
    const playmode = usePlaymode(source, effects);
    return {
        playmode,
        shown,
        follows,
        flights,
        delays,
        letGos: () => letGos,
        frames: () => frames.length,
        frame: (time: number) => {
            const pending = frames;
            frames = [];
            for (const callback of pending) callback(time);
        },
        timer: () => {
            const pending = timers;
            timers = [];
            for (const callback of pending) callback();
        },
    };
}

/** Ein Versprechen einlösen und die Folgen abwarten. */
async function land(flight: { arrive: (arrived: boolean) => void } | undefined, arrived = true): Promise<void> {
    flight?.arrive(arrived);
    await Promise.resolve();
    await Promise.resolve();
}

describe("▶ fliegt zum Start, ehe die Uhr läuft", () => {
    it("🔴 die Kamera springt nicht: Es gibt einen Anflug, kein Folgebild mit Sprung", () => {
        const { playmode, flights, follows } = harness();
        playmode.play();
        expect(flights).toHaveLength(1);
        expect(flights[0]?.x).toBe(0);
        // Die Blickrichtung des Startbilds geht mit: die Straße nach Osten.
        expect(flights[0]?.course).toBeCloseTo(90, 0);
        expect(follows).toEqual([]);
    });

    it("🔴 die Uhr steht, solange die Kamera fliegt; der Pfeil steht am Start", async () => {
        const { playmode, flights, frames, shown } = harness();
        playmode.play();
        expect(playmode.playing.value).toBe(true);
        expect(frames()).toBe(0);
        expect(playmode.fraction.value).toBe(0);
        expect(shown.at(-1)?.x).toBe(0);
        expect(playmode.position.value?.x).toBe(0);
        await land(flights[0]);
        // Erst mit der Ankunft beginnt die Bildfolge.
        expect(frames()).toBe(1);
    });

    it("nach der Ankunft läuft die Uhr wie immer, das erste Folgebild springt nicht", async () => {
        const { playmode, flights, frame, follows } = harness();
        playmode.play();
        await land(flights[0]);
        frame(1000);
        frame(1000 + playSeconds(60) * 500);
        expect(playmode.fraction.value).toBeCloseTo(0.5, 9);
        expect(follows.every((entry) => !entry.jump)).toBe(true);
    });

    it("🔴 die Pause mitten im Flug: Das Abspielen beginnt nicht, auch wenn der Flug noch ankommt", async () => {
        const { playmode, flights, frames } = harness();
        playmode.play();
        playmode.pause();
        expect(playmode.playing.value).toBe(false);
        await land(flights[0]);
        expect(frames()).toBe(0);
        expect(playmode.playing.value).toBe(false);
    });

    it("🔴 endet der Flug ohne Ankunft, beginnt das Abspielen nicht", async () => {
        const { playmode, flights, frames } = harness();
        playmode.play();
        await land(flights[0], false);
        expect(playmode.playing.value).toBe(false);
        expect(frames()).toBe(0);
    });

    it("🔴 eine Geste auf der Karte mitten im Flug: Das Abspielen beginnt nicht, die Karte gehört der Hand", async () => {
        const { playmode, flights, frames, letGos } = harness();
        playmode.play();
        playmode.interrupt();
        expect(playmode.playing.value).toBe(false);
        expect(playmode.free.value).toBe(false);
        expect(letGos()).toBeGreaterThan(0);
        await land(flights[0]);
        expect(frames()).toBe(0);
    });

    it("bei „Bewegung reduzieren“ springt die Kamera - dort ist das richtig - und die Uhr läuft im Takt", () => {
        const { playmode, flights, follows, delays } = harness({ reduced: true });
        playmode.play();
        expect(flights).toEqual([]);
        expect(follows[0]).toMatchObject({ x: 0, jump: true });
        expect(delays).toContain(REDUCED_STEP_MS);
    });

    it("ohne Anflug der Karte springt sie wie bisher (Tests, andere Ansichten)", () => {
        const { playmode, follows, frames } = harness({ approach: false });
        playmode.play();
        expect(follows[0]).toMatchObject({ x: 0, jump: true });
        expect(frames()).toBe(1);
    });
});

describe("ein Sprung der Leiste fliegt ebenfalls", () => {
    it("mitten in der Wiedergabe: Die Kamera fliegt zum Etappenanfang, die Uhr wartet auf sie", async () => {
        const { playmode, flights, frames, frame } = harness();
        playmode.play();
        await land(flights[0]);
        frame(1000);
        playmode.nextStage();
        expect(flights).toHaveLength(2);
        expect(flights[1]?.x).toBe(10);
        expect(frames()).toBe(0);
        expect(playmode.fraction.value).toBeCloseTo(1 / 3, 9);
        await land(flights[1]);
        expect(frames()).toBe(1);
        expect(playmode.playing.value).toBe(true);
    });

    it("🔴 ein jüngerer Sprung überholt den älteren: Nur die Ankunft des letzten startet die Uhr", async () => {
        const { playmode, flights, frames } = harness();
        playmode.play();
        await land(flights[0]);
        playmode.nextStage();
        playmode.nextStage();
        expect(flights).toHaveLength(3);
        await land(flights[1]);
        expect(frames()).toBe(0);
        await land(flights[2]);
        expect(frames()).toBe(1);
        expect(playmode.fraction.value).toBeCloseTo(2 / 3, 9);
    });

    it("🔴 eine Geste im Flug nach einem Sprung: Die Wiedergabe läuft weiter, die Kamera ist frei (WI-0053)", async () => {
        const { playmode, flights, frames, follows } = harness();
        playmode.play();
        await land(flights[0]);
        playmode.nextStage();
        playmode.interrupt();
        expect(playmode.playing.value).toBe(true);
        expect(playmode.free.value).toBe(true);
        // Die Uhr läuft (die Kamera folgt dem Pfeil nicht), und der abgebrochene Flug startet sie nicht noch einmal.
        expect(frames()).toBe(1);
        await land(flights[1]);
        expect(frames()).toBe(1);
        expect(follows.every((entry) => !entry.jump)).toBe(true);
    });

    it("bei Pause fliegt die Kamera zum Pfeil, ohne die Uhr zu starten", async () => {
        const { playmode, flights, frames } = harness();
        playmode.toEnd();
        expect(flights).toHaveLength(1);
        expect(flights[0]?.x).toBe(30);
        await land(flights[0]);
        expect(frames()).toBe(0);
        expect(playmode.playing.value).toBe(false);
    });

    it("der erste Sprung der Leiste ohne Pfeil zeigt ihn und fliegt hin", () => {
        const { playmode, flights, shown } = harness();
        playmode.seek(0.5);
        expect(shown.at(-1)?.x).toBeCloseTo(15, 9);
        expect(flights).toHaveLength(1);
    });

    it("eine gewählte Etappe fliegt die Kamera nur, wenn sie dem Pfeil folgt", async () => {
        const { playmode, flights } = harness();
        // Ohne Wiedergabe kein Pfeil: Ein Klick auf eine Etappe fährt der Planer (`fitRoute`), nicht der Playmode.
        playmode.showStage(1);
        expect(flights).toEqual([]);
        playmode.play();
        await land(flights[0]);
        playmode.showStage(2);
        expect(flights).toHaveLength(2);
        expect(flights[1]?.x).toBe(20);
    });

    it("bei „Bewegung reduzieren“ springt die Leiste, und die Kamera mit ihr", () => {
        const { playmode, flights, follows } = harness({ reduced: true });
        playmode.play();
        playmode.nextStage();
        expect(flights).toEqual([]);
        expect(follows.at(-1)).toMatchObject({ x: 10, jump: true });
    });
});
