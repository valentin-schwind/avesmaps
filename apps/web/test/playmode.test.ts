import { describe, expect, it } from "vitest";
import { nextTick, shallowRef } from "vue";
import type { RouteResponse } from "@avesmaps3d/shared";
import type { JourneyPosition } from "../src/route-planner/journey-timeline.ts";
import {
    ORBIT_SECONDS,
    playSeconds,
    PLAY_SECONDS,
    FREE_CAMERA_MS,
    REDUCED_STEP_MS,
    stageAt,
    usePlaymode,
    type PlaymodeEffects,
} from "../src/route-planner/use-playmode.ts";
import { climbZoom, FLIGHT_ZOOM, turnTowards } from "../src/map/traveler-view.ts";
import { journeyRoute } from "./playmode-route.ts";

/**
 * Der Playmode (WI-0031): Uhr, Sprünge, Etappen und wer ihn anhält. Die Karte ist hier ein Protokoll.
 */

/** Eine Karte als Protokoll, und eine Uhr, die der Test weiterdreht. */
function harness(options: { reduced?: boolean } = {}) {
    const shown: (JourneyPosition | null)[] = [];
    const follows: { x: number; jump: boolean; course: number }[] = [];
    const takeOffs: boolean[] = [];
    let frames: ((time: number) => void)[] = [];
    let timers: (() => void)[] = [];
    const delays: number[] = [];
    const rejoins: boolean[] = [];
    const orbits: { x: number; drehung: number }[] = [];
    let watching: { activity(): void; compass(): void } | undefined;
    const effects: PlaymodeEffects = {
        show: (position) => shown.push(position),
        follow: (position, jump, course) => follows.push({ x: position.x, jump, course }),
        takeOff: (reduced) => takeOffs.push(reduced),
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
        watch: (listeners) => {
            watching = listeners;
            return () => {
                watching = undefined;
            };
        },
        rejoin: (reduced) => rejoins.push(reduced),
        orbit: (position, drehung) => orbits.push({ x: position.x, drehung }),
    };
    const source = shallowRef<RouteResponse | null>(journeyRoute());
    const playmode = usePlaymode(source, effects);
    const frame = (time: number): void => {
        const pending = frames;
        frames = [];
        pending.forEach((callback) => callback(time));
    };
    const timer = (): void => {
        const pending = timers;
        timers = [];
        pending.forEach((callback) => callback());
    };
    return {
        playmode,
        source,
        shown,
        follows,
        takeOffs,
        frame,
        timer,
        delays,
        rejoins,
        orbits,
        watching: () => watching,
    };
}

describe("Die Uhr des Playmodes", () => {
    it("zwei Reisestunden je Sekunde (Betreiber 2026-10-18: „etwa die hälfte“), eine Reise zwischen 24 und 180 Sekunden", () => {
        expect(playSeconds(60)).toBe(30);
        expect(PLAY_SECONDS).toEqual({ min: 24, max: 180 });
        expect(playSeconds(4)).toBe(PLAY_SECONDS.min);
        expect(playSeconds(10_000)).toBe(PLAY_SECONDS.max);
    });

    it("spielt nach der Reisezeit und hält am Ende an", () => {
        const { playmode, frame, follows } = harness();
        playmode.play();
        expect(playmode.playing.value).toBe(true);
        // Der erste Schritt springt die Kamera zum Pfeil.
        expect(follows[0]).toMatchObject({ x: 0, jump: true });
        // Die Kamera blickt voraus, die Straße entlang nach Osten.
        expect(follows[0]?.course).toBeCloseTo(90, 0);
        // Die halbe Reise in der halben Wiedergabezeit (60 Reisestunden).
        frame(1000);
        frame(1000 + playSeconds(60) * 500);
        expect(playmode.fraction.value).toBeCloseTo(0.5, 9);
        expect(playmode.position.value?.x).toBeCloseTo(15, 9);
        expect(follows.at(-1)?.jump).toBe(false);
        frame(1000 + playSeconds(60) * 1000 + 5000);
        expect(playmode.fraction.value).toBe(1);
        expect(playmode.playing.value).toBe(false);
    });

    it("am Ende beginnt ▶ von vorn", () => {
        const { playmode } = harness();
        playmode.toEnd();
        playmode.play();
        expect(playmode.fraction.value).toBe(0);
    });
});

describe("Etappen", () => {
    it("die Etappe an einer Stelle ist die letzte, die dort schon begonnen hat", () => {
        expect(stageAt([0, 1 / 3, 2 / 3], 0.5)).toBe(1);
        expect(stageAt([0, 1 / 3, 2 / 3], 1 / 3)).toBe(1);
        expect(stageAt([0, 0.5, 0.5, 0.8], 0.5)).toBe(2);
    });

    it("▶▶ springt an den Anfang der nächsten Etappe, hinter der letzten ans Ende", () => {
        const { playmode, follows } = harness();
        playmode.nextStage();
        expect(playmode.fraction.value).toBeCloseTo(1 / 3, 9);
        expect(follows.at(-1)).toMatchObject({ x: 10, jump: true });
        playmode.nextStage();
        playmode.nextStage();
        expect(playmode.fraction.value).toBe(1);
    });

    it("◀◀ wie bei einem Player: erst an den Anfang der Etappe, gleich danach an den der vorigen", () => {
        const { playmode } = harness();
        // 0,5 ist Etappe 2, 2,5 s hinter ihrem Anfang.
        playmode.seek(0.5);
        playmode.previousStage();
        expect(playmode.fraction.value).toBeCloseTo(1 / 3, 9);
        playmode.previousStage();
        expect(playmode.fraction.value).toBe(0);
    });

    it("|◀ und ▶| setzen den Pfeil an Anfang und Ende", () => {
        const { playmode, shown } = harness();
        playmode.toEnd();
        expect(shown.at(-1)?.x).toBe(30);
        playmode.toStart();
        expect(shown.at(-1)?.x).toBe(0);
    });
});

describe("Etappe und Pfeil", () => {
    it("kennt die Etappe, in der der Pfeil steht - keine, solange er nicht auf der Karte ist", () => {
        const { playmode, frame } = harness();
        expect(playmode.stage.value).toBeNull();
        playmode.play();
        frame(0);
        // Bei 40 % der Reise steht der Pfeil in der zweiten von drei gleich langen Etappen.
        frame(playSeconds(60) * 400);
        expect(playmode.stage.value).toBe(1);
    });

    it("🔴 eine gewählte Etappe rückt nur die Leiste - der Pfeil kommt erst mit der Wiedergabe (Betreiber 2026-09-25)", () => {
        const { playmode, shown, frame } = harness();
        const before = shown.length;
        playmode.showStage(2);
        expect(playmode.fraction.value).toBeCloseTo(2 / 3, 9);
        expect(playmode.here.value?.x).toBeCloseTo(20, 9);
        expect(playmode.position.value).toBeNull();
        expect(playmode.stage.value).toBeNull();
        expect(shown).toHaveLength(before);
        // ▶ beginnt an der gewählten Etappe.
        playmode.play();
        frame(0);
        expect(shown.at(-1)?.x).toBeCloseTo(20, 9);
    });

    it("läuft oder pausiert die Wiedergabe, setzt eine gewählte Etappe den Pfeil an ihren Anfang, die Kamera bleibt", () => {
        const { playmode, shown, follows, frame } = harness();
        playmode.play();
        frame(0);
        playmode.pause();
        const followed = follows.length;
        playmode.showStage(2);
        expect(playmode.stage.value).toBe(2);
        expect(shown.at(-1)?.x).toBeCloseTo(20, 9);
        expect(follows).toHaveLength(followed);
        playmode.showStage(7);
        expect(playmode.stage.value).toBe(2);
    });
});

describe("Wer den Playmode anhält und wer die Kamera nimmt", () => {
    it("🔴 eine fremde Kamerabewegung hält nicht an: die Kamera ist frei, der Pfeil fährt weiter (WI-0053)", () => {
        const { playmode, frame, follows, shown, delays } = harness();
        playmode.play();
        frame(0);
        frame(3000);
        playmode.interrupt();
        expect(playmode.playing.value).toBe(true);
        expect(playmode.free.value).toBe(true);
        expect(delays.at(-1)).toBe(FREE_CAMERA_MS);
        const followed = follows.length;
        const drawn = shown.length;
        frame(4000);
        // Der Pfeil fährt weiter, die Kamera folgt ihm nicht.
        expect(shown.length).toBeGreaterThan(drawn);
        expect(follows).toHaveLength(followed);
    });

    it("🔴 nach der Ruhe kehrt die Kamera zum Pfeil zurück; jede Eingabe auf der Karte verlängert die Ruhe", () => {
        const { playmode, frame, follows, timer, delays, rejoins, watching } = harness();
        playmode.play();
        frame(0);
        playmode.interrupt();
        const followed = follows.length;
        // Noch jemand auf der Karte: Die Ruhe beginnt von vorn.
        watching()?.activity();
        expect(delays.filter((ms) => ms === FREE_CAMERA_MS)).toHaveLength(2);
        timer();
        expect(playmode.free.value).toBe(false);
        expect(rejoins).toEqual([false]);
        // Zurück mit einem Sprung, danach wieder Bild für Bild.
        expect(follows.at(-1)).toMatchObject({ jump: true });
        frame(1000);
        expect(follows.length).toBeGreaterThan(followed + 1);
        expect(follows.at(-1)).toMatchObject({ jump: false });
    });

    it("🔴 der Kompass holt die Kamera sofort zurück - aber nur, solange die Wiedergabe läuft", () => {
        const { playmode, frame, rejoins, watching } = harness();
        expect(watching()).toBeUndefined();
        playmode.play();
        frame(0);
        playmode.interrupt();
        watching()?.compass();
        expect(playmode.free.value).toBe(false);
        expect(rejoins).toEqual([false]);
        playmode.pause();
        // Angehalten gehört der Kompass wieder dem Norden.
        expect(watching()).toBeUndefined();
    });

    it("ein Sprung der Leiste holt eine freie Kamera zurück; bei „Bewegung reduzieren“ ohne Fahrt", () => {
        const { playmode, frame, rejoins } = harness();
        playmode.play();
        frame(0);
        playmode.interrupt();
        playmode.nextStage();
        expect(playmode.free.value).toBe(false);
        expect(rejoins).toEqual([false]);
        const reduced = harness({ reduced: true });
        reduced.playmode.play();
        reduced.playmode.interrupt();
        reduced.watching()?.compass();
        expect(reduced.rejoins).toEqual([true]);
    });

    it("angehalten bewegt man die Karte, ohne dass etwas zurückkehrt", () => {
        const { playmode, frame, delays } = harness();
        playmode.play();
        frame(0);
        playmode.pause();
        playmode.interrupt();
        expect(playmode.free.value).toBe(false);
        expect(delays).not.toContain(FREE_CAMERA_MS);
    });

    it("eine neue Route setzt zurück: kein Pfeil, Leiste am Anfang", async () => {
        const { playmode, source, shown } = harness();
        playmode.seek(0.4);
        source.value = { ...journeyRoute() };
        await nextTick();
        expect(playmode.fraction.value).toBe(0);
        expect(playmode.position.value).toBeNull();
        expect(shown.at(-1)).toBeNull();
    });

    it("ohne Route tut nichts etwas", () => {
        const { playmode, source } = harness();
        source.value = null;
        return nextTick().then(() => {
            playmode.play();
            playmode.nextStage();
            expect(playmode.playing.value).toBe(false);
            expect(playmode.position.value).toBeNull();
        });
    });
});

describe("Bewegung reduzieren (Guide §29.1)", () => {
    it("der Pfeil fährt nicht, er springt je Etappe", () => {
        const { playmode, timer, follows } = harness({ reduced: true });
        playmode.play();
        expect(REDUCED_STEP_MS).toBe(1200);
        timer();
        expect(playmode.fraction.value).toBeCloseTo(1 / 3, 9);
        timer();
        timer();
        expect(playmode.fraction.value).toBe(1);
        expect(playmode.playing.value).toBe(false);
        expect(follows.every((step) => step.jump)).toBe(true);
    });
});

describe("Drehen nach der Fahrtrichtung", () => {
    it("nähert sich über den kürzesten Winkel, nach Zeit", () => {
        expect(turnTowards(170, -170, 10, 0.45)).toBeCloseTo(-170, 6);
        const halfway = turnTowards(170, -170, 0.45 * Math.log(2), 0.45);
        expect(halfway === 180 || halfway === -180).toBe(true);
        expect(turnTowards(0, 90, 0, 0.45)).toBe(0);
    });
});

describe("Flughöhe (Betreiber 2026-09-25: „wie beim auto-navi“)", () => {
    it("🔴 ▶ geht auf Flughöhe - bei jedem Start, nicht beim Springen oder Wählen", () => {
        const { playmode, takeOffs, frame } = harness();
        playmode.showStage(1);
        playmode.seek(0.2);
        expect(takeOffs).toEqual([]);
        playmode.play();
        frame(0);
        playmode.pause();
        playmode.nextStage();
        expect(takeOffs).toEqual([false]);
        // Weiterspielen holt die Flughöhe zurück, falls jemand inzwischen gezoomt hat.
        playmode.play();
        expect(takeOffs).toEqual([false, false]);
    });

    it("bei „Bewegung reduzieren“ ohne Fahrt", () => {
        const { playmode, takeOffs } = harness({ reduced: true });
        playmode.play();
        expect(takeOffs).toEqual([true]);
    });

    it("steigt weich und kommt genau an: nach Zeit, auslaufend", () => {
        expect(FLIGHT_ZOOM).toBe(8);
        expect(climbZoom(5, 7, 0, 1.2)).toBe(5);
        expect(climbZoom(5, 7, 1.2, 1.2)).toBe(7);
        expect(climbZoom(5, 7, 9, 1.2)).toBe(7);
        // Auslaufend: in der ersten Hälfte schon mehr als die Hälfte des Wegs.
        expect(climbZoom(5, 7, 0.6, 1.2)).toBeGreaterThan(6);
        expect(climbZoom(8, 7, 0.6, 1.2)).toBeLessThan(7.5);
        expect(climbZoom(5, 7, 0.1, 0)).toBe(7);
    });
});

describe("Vogelflug am Ziel (Betreiber 2026-10-14: „in einen vogelflug um die zielstelle fliegt“)", () => {
    /** Spielt die Reise bis ans Ende. Danach steht die Uhr, und nur die Kamera bewegt sich noch. */
    const bisAnsZiel = (teil: ReturnType<typeof harness>): void => {
        teil.playmode.play();
        for (let zeit = 0; zeit <= 200_000 && teil.playmode.playing.value; zeit += 1000) teil.frame(zeit);
    };

    it("🔴 am Ende hält die Kamera nicht an, sondern kreist um das Ziel", () => {
        const teil = harness();
        bisAnsZiel(teil);
        expect(teil.playmode.playing.value, "die Wiedergabe ist beendet").toBe(false);
        expect(teil.playmode.fraction.value).toBe(1);
        expect(teil.orbits, "noch dreht sich nichts").toEqual([]);

        // Zwei Bilder im Abstand einer Sekunde: ein Fünfundvierzigstel der Runde je Sekunde.
        teil.frame(201_000);
        teil.frame(202_000);
        expect(teil.orbits.length).toBe(2);
        expect(teil.orbits[0]?.drehung, "das erste Bild dreht noch nicht").toBe(0);
        expect(teil.orbits[1]?.drehung).toBeCloseTo(360 / ORBIT_SECONDS, 6);
        // Immer um die Zielstelle, nicht um den Pfeil von irgendwo.
        expect(teil.orbits[1]?.x).toBe(teil.orbits[0]?.x);
    });

    it("🔴 eine Eingabe auf der Karte beendet den Vogelflug", () => {
        const teil = harness();
        bisAnsZiel(teil);
        teil.frame(201_000);
        teil.frame(202_000);
        const bisher = teil.orbits.length;
        expect(teil.watching(), "die Eingaben werden gehört").toBeDefined();
        teil.watching()?.activity();
        teil.frame(203_000);
        teil.frame(204_000);
        expect(teil.orbits.length, "danach dreht sich nichts mehr").toBe(bisher);
        expect(teil.watching(), "und die Eingaben sind abgemeldet").toBeUndefined();
    });

    it("🔴 bei „Bewegung reduzieren“ kreist nichts", () => {
        const teil = harness({ reduced: true });
        teil.playmode.play();
        for (let zeit = 0; zeit <= 200_000 && teil.playmode.playing.value; zeit += 1000) {
            teil.frame(zeit);
            teil.timer();
        }
        teil.frame(201_000);
        teil.frame(202_000);
        expect(teil.orbits).toEqual([]);
    });

    it("▶ nach dem Vogelflug beginnt die Reise von vorn, ohne Drehschritte", () => {
        const teil = harness();
        bisAnsZiel(teil);
        teil.frame(201_000);
        const bisher = teil.orbits.length;
        teil.playmode.play();
        teil.frame(202_000);
        expect(teil.orbits.length).toBe(bisher);
        expect(teil.playmode.playing.value).toBe(true);
    });
});
