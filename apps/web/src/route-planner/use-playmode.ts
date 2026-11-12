import { computed, ref, shallowRef, watch, type Ref } from "vue";
import type { RouteResponse } from "@avesmaps3d/shared";
import { buildTimeline, mapHeading, type JourneyPosition, type JourneyTimeline } from "./journey-timeline";

/**
 * Der Playmode (WI-0031, Kap. 6.41 FEATURE-ROUTE-PLAYMODE; Betreiber 2026-09-24): spielt eine fertige
 * Route ab. Ein Pfeil fährt sie entlang, die Kamera folgt, und die Leiste unter dem Planer springt
 * von Etappe zu Etappe. Die Route selbst ändert sich dabei nie.
 *
 * - **Die Uhr ist die Reisezeit** (`journey-timeline.ts`): vier Reisestunden je Sekunde, eine ganze
 *   Reise aber nie kürzer als 12 und nie länger als 90 Sekunden - Gareth → Perricum dauert rund 19 s.
 * - **Zurück wie bei einem Player:** Wer mehr als eine Sekunde in einer Etappe ist, springt an ihren
 *   Anfang; sonst an den Anfang der vorigen.
 * - 🔴 **Jemand anderes bewegt die Kamera** (Maus, Finger, Ring, Tasten, eine Fahrt des Planers): Die
 *   Wiedergabe läuft weiter, die Kamera ist frei (WI-0053, Betreiber 2026-09-27: „wenn ich die kamera bewege
 *   stoppt außerdem die animation, das braucht sie nicht, wär schön wenn sie weiterläuft. wenn die maus eine
 *   weile untätig ist (3 sekunden) oder man den compass drückt, kann die ansicht wieder auf den pfeil
 *   zurückkehren … aber nur im playmode“). Nach `FREE_CAMERA_MS` ohne Eingabe auf der Karte, mit dem
 *   Kompass oder mit einem Sprung der Leiste kehrt sie weich zum Pfeil zurück. Bis WI-0053 hielt sie an.
 * - 🔴 **Die Kamera springt nie, und die Uhr wartet auf sie** (Betreiber 2026-09-29): Beim Druck auf ▶ und nach
 *   jedem Sprung der Leiste (Etappe, Anfang, Ende, Schieber) fliegt die Kamera zum Pfeil (`approach`); erst wenn
 *   sie angekommen ist, laufen Uhr und Pfeil. Der Pfeil steht bis dahin am Ziel. Bricht man den Anflug beim Start
 *   ab (Maus, Finger, Pause), beginnt die Wiedergabe nicht; nach einem Sprung mitten in der Wiedergabe läuft sie
 *   weiter, und die Kamera ist frei. Design Guide §17 „Die Kamera springt nie“.
 * - **„Bewegung reduzieren“** (Guide §29.1: abschalten, nicht verlangsamen): Der Pfeil fährt nicht,
 *   er springt je Etappe, im Takt von 1,2 s - und die Kamera mit ihm, denn dort ist der Sprung richtig.
 * - **Etappe und Pfeil gehören zusammen** (Betreiber 2026-09-24): `stage` ist die Etappe, in der der
 *   Pfeil gerade ist; `showStage` setzt die Leiste an den Anfang einer gewählten Etappe, ohne die Kamera
 *   anzufassen - die fährt dann der Planer.
 * - 🔴 **Der Pfeil kommt nur mit der Wiedergabe** (Betreiber 2026-09-25: „dass der pfeil nur kommt wenn
 *   die animation läuft oder pausiert ist. nur bei einem klick auf die segmente soll der navi-pfeil nicht
 *   kommen“): Wer eine Etappe wählt, rückt nur die Leiste; läuft oder pausiert die Wiedergabe, springt
 *   der Pfeil mit. Wer ▶ drückt, beginnt an der gewählten Etappe.
 *
 * Keine Karte, kein DOM: Was die Karte zeigt, sagen `PlaymodeEffects`.
 */

/**
 * Reisestunden je Sekunde Wiedergabe. 2 seit 2026-10-18 (Betreiber, mit der Abnahme von WI-0218, wörtlich: „die geschwindigkeit der reise
 * langsamer machen (etwa die hälfte)“); davor 4. Mit ihr verdoppeln sich die Grenzen darunter, sonst bliebe eine lange Reise gleich schnell.
 */
export const PLAY_HOURS_PER_SECOND = 2;
/** Eine ganze Reise dauert mindestens und höchstens so lange, in Sekunden (bis 2026-10-18: 12 und 90). */
export const PLAY_SECONDS = { min: 24, max: 180 } as const;
/** Bei „Bewegung reduzieren“: eine Etappe je Takt. */
export const REDUCED_STEP_MS = 1200;
/** So lange darf die Karte ohne Eingabe frei stehen, dann kehrt die Kamera zum Pfeil zurück. */
export const FREE_CAMERA_MS = 3000;
/** So lange nach dem Anfang einer Etappe führt „zurück“ an ihren Anfang, nicht an den der vorigen. */
export const RESTART_WINDOW_MS = 1000;
export function playSeconds(totalHours: number): number {
    const seconds = totalHours / PLAY_HOURS_PER_SECOND;
    return Math.min(PLAY_SECONDS.max, Math.max(PLAY_SECONDS.min, Number.isFinite(seconds) ? seconds : 0));
}

/** Die Etappe an dieser Stelle: die letzte, die hier schon begonnen hat. */
export function stageAt(stageStarts: readonly number[], fraction: number): number {
    let stage = 0;
    stageStarts.forEach((start, index) => {
        if (start <= fraction + 1e-9) stage = index;
    });
    return stage;
}

/**
 * Eine Umrundung des Ziels im Vogelflug, in Sekunden (Betreiber 2026-10-14: „45 sekunden ist ok, reiseneigung
 * bleibt"). 🪤 Bei „Bewegung reduzieren" kreist nichts - dort hält die Kamera still.
 */
export const ORBIT_SECONDS = 45;

export interface PlaymodeEffects {
    /** Den Pfeil hier zeigen - oder keinen. */
    show(position: JourneyPosition | null): void;
    /**
     * Die Kamera folgt: `jump` bei einem Sprung (Etappe, Anfang, Ende, Schieber), sonst Bild für Bild.
     * `course` ist die Richtung auf den Punkt `lookAhead` voraus - ruhiger als die Richtung des Stücks.
     * `goal` ist das Ziel samt dem Weg dorthin in Karteneinheiten (`rest`): Davor bremst die Kamera aus (WI-0218).
     */
    follow(
        position: JourneyPosition,
        jump: boolean,
        course: number,
        goal?: { readonly x: number; readonly y: number; readonly rest: number },
    ): void;
    /**
     * Wie weit die Kamera voraus blickt, in Karteneinheiten entlang der Route (WI-0053) - die Karte weiß,
     * wie viel davon auf den Schirm passt. Ohne sie gilt die Richtung des Stücks unter dem Pfeil.
     */
    lookAhead?(position: JourneyPosition): number;
    /**
     * Die Kamera fliegt zur Folgestellung dieses Punkts (Kamerakanon 2026-09-29: sie springt nie) - beim Druck auf
     * ▶ und nach einem Sprung der Leiste. Gibt `true` zurück, sobald sie dort ist, `false`, wenn die Fahrt vorher
     * endet. Solange sie fliegt, steht die Uhr. Fehlt sie, springt die Kamera (`follow` mit `jump`), wie bisher.
     */
    approach?(position: JourneyPosition, course: number): Promise<boolean>;
    /** Die Wiedergabe beginnt: Die Kamera geht auf Flughöhe (Betreiber 2026-09-25, wie ein Navi). */
    takeOff?(reducedMotion: boolean): void;
    /**
     * Solange die Wiedergabe läuft: jede Eingabe auf der Karte (`activity`) und den Kompass (`compass`)
     * melden. Gibt die Abmeldung zurück (WI-0053).
     */
    watch?(listeners: { activity(): void; compass(): void }): () => void;
    /** Die freie Kamera kehrt zum Pfeil zurück: weich, bei „Bewegung reduzieren“ sofort. */
    rejoin?(reducedMotion: boolean): void;
    /**
     * Am Ziel kreist die Kamera um die Zielstelle (Betreiber 2026-10-14: „wenn die kamera am ende einer reise nicht
     * abrupt stoppt, sondern in einen vogelflug um die zielstelle fliegt"): `drehung` ist der Schritt dieses Bildes
     * in Grad, den die Karte auf ihren Blick addiert. Neigung und Flughöhe bleiben, wie die Reise sie hatte.
     */
    orbit?(position: JourneyPosition, drehung: number): void;
    /** Die Kamera folgt nicht mehr (angehalten oder frei): Ring, Tasten und 3D-Knopf fahren wieder selbst. */
    letGo?(): void;
    requestFrame?(callback: (time: number) => void): number;
    cancelFrame?(handle: number): void;
    setTimer?(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
    clearTimer?(handle: ReturnType<typeof setTimeout>): void;
    reducedMotion?(): boolean;
}

export interface Playmode {
    readonly playing: Readonly<Ref<boolean>>;
    /** Wie weit die Reise ist, 0…1 der Reisezeit. */
    readonly fraction: Readonly<Ref<number>>;
    readonly timeline: Readonly<Ref<JourneyTimeline | null>>;
    /** Wo der Pfeil steht - null, solange er nicht auf der Karte ist. */
    readonly position: Readonly<Ref<JourneyPosition | null>>;
    /** Wo die Reise auf der Leiste steht, auch ohne Pfeil auf der Karte - für Meilen und Tage. */
    readonly here: Readonly<Ref<JourneyPosition | null>>;
    /** Die Etappe, in der der Pfeil steht - null, solange er nicht auf der Karte ist. */
    readonly stage: Readonly<Ref<number | null>>;
    toggle(): void;
    play(): void;
    pause(): void;
    toStart(): void;
    toEnd(): void;
    previousStage(): void;
    nextStage(): void;
    seek(fraction: number): void;
    /**
     * Die Leiste an den Anfang dieser Etappe setzen, ohne der Kamera zu folgen - und den Pfeil nur, wenn
     * die Wiedergabe läuft oder pausiert ist.
     */
    showStage(index: number): void;
    /** Jemand anderes hat die Kamera bewegt: Läuft die Wiedergabe, ist die Kamera jetzt frei. */
    interrupt(): void;
    /** Die Kamera ist frei: Die Wiedergabe läuft, aber die Kamera folgt gerade nicht. */
    readonly free: Readonly<Ref<boolean>>;
    dispose(): void;
}

export function usePlaymode(route: Readonly<Ref<RouteResponse | null>>, effects: PlaymodeEffects): Playmode {
    const requestFrame = effects.requestFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    const cancelFrame = effects.cancelFrame ?? ((handle) => globalThis.cancelAnimationFrame(handle));
    const setTimer = effects.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    const clearTimer = effects.clearTimer ?? ((handle) => clearTimeout(handle));
    const reducedMotion =
        effects.reducedMotion ?? (() => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);

    const timeline = shallowRef<JourneyTimeline | null>(null);
    const playing = ref(false);
    const fraction = ref(0);
    /** Der Pfeil steht auf der Karte, seit jemand gespielt, gesprungen oder geschoben hat. */
    const shown = ref(false);
    const here = computed(() => (timeline.value ? timeline.value.at(fraction.value) : null));
    const position = computed(() => (shown.value ? here.value : null));
    const stage = computed(() =>
        shown.value && timeline.value ? stageAt(timeline.value.stageStarts, fraction.value) : null,
    );

    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: number | undefined;
    /** Die Kamera ist frei, seit jemand anderes sie bewegt hat; `idle` holt sie nach der Ruhe zurück. */
    const free = ref(false);
    let idle: ReturnType<typeof setTimeout> | undefined;
    let unwatch: (() => void) | undefined;

    const seconds = (): number => playSeconds(timeline.value?.totalHours ?? 0);
    const stopClock = (): void => {
        if (frame !== undefined) cancelFrame(frame);
        if (timer !== undefined) clearTimer(timer);
        frame = undefined;
        timer = undefined;
        last = undefined;
    };
    /**
     * Die Richtung auf den Punkt ein Stück Weg voraus - die Sehne mittelt jede Kehre darunter weg
     * (WI-0053). Am Ende die eigene.
     *
     * 🔴 Vor dem Ziel bleibt sie stehen (WI-0218, Betreiber 2026-10-17: am Übergang in den Vogelflug „kein sprung“): Ist der Rest kürzer
     * als der Blick voraus, klebte der Punkt voraus am Ende, und die Sehne schwenkte mit jedem Schritt auf das letzte Stück (gemessen
     * Gareth → Perricum: bis 75 °/s im letzten Bild der Reise). Dann gilt die Sehne, die dort beginnt, wo der Rest den Blick voraus
     * unterschreitet: von dort zum Ende, ohne Zustand und an der Naht gleich.
     */
    const courseAt = (at: JourneyPosition): number => {
        const current = timeline.value;
        const units = effects.lookAhead?.(at) ?? 0;
        if (!current || !(units > 0)) return at.heading;
        const ahead = current.ahead(fraction.value, units);
        const rest = current.rest(fraction.value);
        const from = rest < units ? current.ahead(0, current.rest(0) - units) : at;
        return Math.hypot(ahead.x - from.x, ahead.y - from.y) > 1e-6 ? mapHeading(from, ahead) : at.heading;
    };
    const present = (jump: boolean): void => {
        const at = position.value;
        effects.show(at);
        const current = timeline.value;
        const goal = current ? { ...current.ahead(1, 0), rest: current.rest(fraction.value) } : undefined;
        if (at && !free.value) effects.follow(at, jump, courseAt(at), goal);
    };
    const stopIdle = (): void => {
        if (idle !== undefined) clearTimer(idle);
        idle = undefined;
    };
    /** Die Kamera kehrt zum Pfeil zurück: nach der Ruhe, mit dem Kompass oder mit einem Sprung. */
    const rejoin = (): void => {
        stopIdle();
        if (!free.value) return;
        free.value = false;
        effects.rejoin?.(reducedMotion());
        present(true);
    };
    const restartIdle = (): void => {
        stopIdle();
        idle = setTimer(rejoin, FREE_CAMERA_MS);
    };
    /**
     * Die Leiste springt: Der Pfeil steht an der neuen Stelle. War die Kamera frei, kehrt sie dafür zurück
     * (`rejoin`); gibt `true`, wenn sie es war.
     */
    const goTo = (next: number): boolean => {
        fraction.value = Math.min(1, Math.max(0, next));
        shown.value = true;
        // Ein Sprung der Leiste heißt „zeig mir den Pfeil“: Eine freie Kamera kehrt dafür zurück.
        if (!free.value) return false;
        stopIdle();
        free.value = false;
        effects.rejoin?.(reducedMotion());
        return true;
    };

    /**
     * Ein Flug zum Pfeil ist unterwegs (Kamerakanon 2026-09-29: die Kamera springt nie): Die Uhr steht, bis er
     * ankommt. `starting`: Es ist der Anflug beim Druck auf ▶ - bricht er ab, beginnt die Wiedergabe nicht.
     */
    let flying: { id: number; starting: boolean; then: () => void } | undefined;
    let flights = 0;

    /**
     * Der Flug endete, ohne anzukommen: eine Geste, die Pause, ein anderer Sprung der Karte.
     * - **Beim Druck auf ▶** beginnt die Wiedergabe nicht (Betreiber 2026-09-29).
     * - **Nach einem Sprung der Leiste mitten in der Wiedergabe** läuft sie weiter und die Kamera ist frei
     *   (WI-0053): Die Uhr geht weiter, die Kamera kehrt nach der Ruhe zum Pfeil zurück.
     */
    const abandon = (): void => {
        const flight = flying;
        flying = undefined;
        if (!flight || !playing.value) return;
        if (flight.starting) {
            pause();
            return;
        }
        free.value = true;
        effects.letGo?.();
        restartIdle();
        flight.then();
    };

    /** Die Uhr beginnt (wieder): mit der Bildfolge, bei „Bewegung reduzieren“ im Takt der Etappen. */
    const startClock = (): void => {
        last = undefined;
        if (reducedMotion()) {
            timer = setTimer(stepReduced, REDUCED_STEP_MS);
        } else {
            frame = requestFrame(tick);
        }
    };

    /**
     * Zum Pfeil, ehe die Uhr läuft: Die Kamera fliegt hin, und erst wenn sie dort ist, beginnt `then` (Betreiber
     * 2026-09-29: „wenn die sitzung, die die kamera macht … fragen sollte, ob das abspielen der animation beim
     * playbutton warten soll, bis die kamera am ziel ist, ist die antwort ja“). Der Pfeil steht schon am Ziel.
     * Springen darf sie nur, wo der Flug nicht geht: bei „Bewegung reduzieren“ (dort ist das richtig) und ohne
     * Anflug der Karte (Tests).
     */
    const arrive = (then: () => void, starting: boolean): void => {
        const at = position.value;
        stopClock();
        flying = undefined;
        effects.show(at);
        if (!at || !effects.approach || reducedMotion()) {
            present(true);
            then();
            return;
        }
        const id = ++flights;
        flying = { id, starting, then };
        void effects.approach(at, courseAt(at)).then((arrived) => {
            // Überholt: ein jüngerer Flug, die Pause oder eine Geste haben ihn schon beendet.
            if (flying?.id !== id) return;
            if (!arrived) {
                abandon();
                return;
            }
            flying = undefined;
            then();
        });
    };

    const moveTo = (next: number): void => {
        stopOrbit();
        // Die freie Kamera blendet in die Folge über (`rejoin`, 0,75 s): Das ist ein Flug, kein Sprung.
        if (goTo(next)) {
            present(true);
            return;
        }
        // Läuft die Wiedergabe, wartet die Uhr auf die Ankunft; steht sie, ist der Flug alles.
        arrive(playing.value ? startClock : () => undefined, false);
    };

    /**
     * Der Vogelflug am Ziel (Betreiber 2026-10-14): Nach dem letzten Bild der Reise hält die Kamera nicht an, sondern
     * kreist um die Zielstelle - eine Umrundung in `ORBIT_SECONDS` -, bis eine Eingabe kommt.
     *
     * 🪤 Er läuft NACH `pause()`: Die Wiedergabe ist beendet, die Uhr steht, und die Leiste zeigt das Ende. Nur die
     * Kamera bewegt sich noch. Deshalb meldet er die Eingaben neu an (`watch`) - `pause` hat sie abgemeldet.
     */
    let orbiting: { last: number | undefined } | undefined;

    const stopOrbit = (): void => {
        if (!orbiting) return;
        orbiting = undefined;
        if (frame !== undefined) cancelFrame(frame);
        frame = undefined;
        unwatch?.();
        unwatch = undefined;
        effects.letGo?.();
    };

    const orbitTick = (time: number): void => {
        frame = undefined;
        if (!orbiting) return;
        const at = position.value;
        if (!at) {
            stopOrbit();
            return;
        }
        const step = orbiting.last === undefined ? 0 : (time - orbiting.last) / 1000;
        orbiting.last = time;
        effects.orbit?.(at, (360 / ORBIT_SECONDS) * step);
        frame = requestFrame(orbitTick);
    };

    /** Am Ziel: anhalten, und die Kamera weiterkreisen lassen. Ohne Bewegung und ohne Effekt bleibt alles beim Alten. */
    const finish = (): void => {
        pause();
        if (!effects.orbit || reducedMotion() || !position.value) return;
        orbiting = { last: undefined };
        unwatch = effects.watch?.({ activity: stopOrbit, compass: stopOrbit });
        frame = requestFrame(orbitTick);
    };

    const tick = (time: number): void => {
        frame = undefined;
        if (!playing.value) return;
        const step = last === undefined ? 0 : time - last;
        last = time;
        fraction.value = Math.min(1, fraction.value + step / (seconds() * 1000));
        present(false);
        if (fraction.value >= 1) {
            finish();
            return;
        }
        frame = requestFrame(tick);
    };

    /** Ohne Bewegung: je Takt eine Etappe weiter, bis zum Ende. */
    const stepReduced = (): void => {
        timer = undefined;
        if (!playing.value) return;
        const starts = timeline.value?.stageStarts ?? [];
        const next = stageAt(starts, fraction.value) + 1;
        // Ohne Bewegung springt der Pfeil, und die Kamera mit ihm: dort ist der Sprung richtig (Guide §29.1).
        goTo(next < starts.length ? (starts[next] as number) : 1);
        present(true);
        if (fraction.value >= 1) {
            pause();
            return;
        }
        timer = setTimer(stepReduced, REDUCED_STEP_MS);
    };

    function play(): void {
        if (!timeline.value || playing.value) return;
        stopOrbit();
        // Am Ende beginnt die Reise von vorn.
        if (fraction.value >= 1) fraction.value = 0;
        playing.value = true;
        shown.value = true;
        free.value = false;
        unwatch = effects.watch?.({
            activity: () => {
                if (free.value) restartIdle();
            },
            compass: rejoin,
        });
        effects.takeOff?.(reducedMotion());
        // Erst fliegt die Kamera zum Start, dann laufen Uhr und Pfeil.
        arrive(startClock, true);
    }

    function pause(): void {
        playing.value = false;
        flying = undefined;
        stopClock();
        stopIdle();
        free.value = false;
        unwatch?.();
        unwatch = undefined;
        effects.letGo?.();
    }

    const reset = (): void => {
        stopOrbit();
        pause();
        fraction.value = 0;
        shown.value = false;
        effects.show(null);
    };

    // Eine neue Route ist eine neue Reise: Der Pfeil verschwindet, die Leiste steht wieder am Anfang.
    watch(
        route,
        (next) => {
            timeline.value = next?.found ? buildTimeline(next) : null;
            reset();
        },
        { immediate: true },
    );

    return {
        playing,
        fraction,
        timeline,
        position,
        here,
        stage,
        free,
        toggle: () => (playing.value ? pause() : play()),
        play,
        pause,
        toStart() {
            if (!timeline.value) return;
            // Der Takt bei reduzierter Bewegung beginnt neu; die laufende Wiedergabe fährt einfach weiter.
            last = undefined;
            moveTo(0);
        },
        toEnd() {
            if (!timeline.value) return;
            pause();
            moveTo(1);
        },
        previousStage() {
            const current = timeline.value;
            if (!current) return;
            const stage = stageAt(current.stageStarts, fraction.value);
            const start = current.stageStarts[stage] ?? 0;
            const into = (fraction.value - start) * seconds() * 1000;
            const target = into > RESTART_WINDOW_MS ? start : (current.stageStarts[Math.max(0, stage - 1)] ?? 0);
            last = undefined;
            moveTo(target);
        },
        nextStage() {
            const current = timeline.value;
            if (!current) return;
            const next = stageAt(current.stageStarts, fraction.value) + 1;
            if (next >= current.stageStarts.length) {
                pause();
                moveTo(1);
                return;
            }
            last = undefined;
            moveTo(current.stageStarts[next] as number);
        },
        seek(target) {
            if (!timeline.value) return;
            last = undefined;
            moveTo(target);
        },
        showStage(index) {
            const start = timeline.value?.stageStarts[index];
            if (start === undefined) return;
            last = undefined;
            fraction.value = start;
            // Ohne Wiedergabe kein Pfeil: Ein Klick auf eine Etappe ist kein Abspielen.
            if (!shown.value) return;
            effects.show(position.value);
            // Folgt die Kamera dem Pfeil, fliegt sie zum neuen Etappenanfang, und die Uhr wartet auf sie.
            if (playing.value && !free.value) arrive(startClock, false);
        },
        interrupt() {
            if (!playing.value) return;
            // Mitten im Flug zum Pfeil: Wer die Karte anfasst, hat den Flug abgebrochen.
            if (flying) {
                abandon();
                return;
            }
            free.value = true;
            effects.letGo?.();
            restartIdle();
        },
        dispose() {
            pause();
        },
    };
}
