<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { leisteRuhig } from "../map/flug-probe";
import { stageDots } from "./journey-timeline";
import { formatNumber } from "./planner-model";
import type { Playmode } from "./use-playmode";
import { t } from "../i18n/i18n";

/**
 * Die Leiste des Playmodes unter dem Planer (WI-0031, Betreiber 2026-09-24, nach seiner Skizze):
 * oben der Fortschritt mit einem kleinen Punkt an jedem Etappenanfang, darunter
 * |◀ ◀◀ ▶ ▶▶ ▶| - links die zurückgelegten Meilen, rechts die verstrichenen Tage, darunter klein, was
 * noch kommt („noch 209“, Variante F der Skizzen).
 *
 * - **Der Fortschritt ist die Reisezeit** und trägt die Farbe der Route: Die Leiste IST die Route, in
 *   der Zeit abgewickelt. Man kann auf ihr klicken und ziehen.
 * - **Punkte statt Striche** (Betreiber 2026-09-24): Jeder Etappenanfang ist ein Punkt auf der
 *   Schiene, wie eine Station auf einer Linie. Wo der Pfeil schon war, hat er den Ring der Route.
 * - **Klein:** Die Knöpfe sind Werkzeugknöpfe des Planers, nur ▶ ist etwas größer. Am Finger sind
 *   sie fingerhoch, aber schmal, damit die Beschriftung auch dort in einer Reihe daneben ganz passt
 *   (Betreiber 2026-09-24: Variante 3; vorher stand „3.339 Meilen“ über den Rand hinaus).
 * - **`floating`:** Am Telefon, bei zugeklapptem Planer, steht die Leiste allein oben über der Karte
 *   (Betreiber 2026-09-24: „ja kannst machen“).
 */
const props = defineProps<{
    playmode: Playmode;
    floating?: boolean;
    /** Die gewählte Etappe - sie steht gold auf der Schiene, wie auf der Karte. */
    selectedStage?: number | null;
}>();

/**
 * Punkte, die enger als so viele Bildpunkte stünden, werden einer: Ein Punkt misst 6, dazu 2 Luft.
 * Sonst würden 70 Etappen zu einer Kette ohne Lücke - als Striche waren es dunkle Blöcke
 * (Betreiber-Bildschirmfoto 2026-09-24).
 */
const DOT_MIN_GAP_PX = 8;

const track = useTemplateRef<HTMLDivElement>("track");
/** Die Breite der Leiste: Daran misst sich, welche Punkte Platz haben. */
const trackWidth = ref(0);
let resize: ResizeObserver | undefined;
onMounted(() => {
    const element = track.value;
    if (!element) return;
    trackWidth.value = element.clientWidth;
    resize = new ResizeObserver(() => {
        trackWidth.value = element.clientWidth;
    });
    resize.observe(element);
});
/**
 * Der Fortschritt in Prozent.
 *
 * 🔴 `?leiste=ruhig` (nur im Entwicklungsbuild, `map/flug-probe.ts`) nimmt ihn nur fuenfmal je Sekunde ab statt in jedem
 * Bild. Gemessen am 2026-10-12 im Playmode, iPhone-Fenstermasse: Die App aenderte 475 DOM-Knoten je Sekunde, die nackte
 * Karte mit derselben Kamerafahrt nur 5 - und die Haelfte davon kam aus dieser Leiste (Balken, Knopf, aria-valuetext,
 * Meilen und Tage, alle 60-mal je Sekunde). Der Schalter sagt, ob das Telefon daran stirbt.
 */
const roh = computed(() => props.playmode.fraction.value * 100);
const RUHIG = leisteRuhig();
const gezeigt = ref(roh.value);
let ruhigTakt: ReturnType<typeof setInterval> | undefined;
if (RUHIG) ruhigTakt = setInterval(() => (gezeigt.value = roh.value), 200);
onBeforeUnmount(() => {
    if (ruhigTakt !== undefined) clearInterval(ruhigTakt);
});
const percent = computed(() => (RUHIG ? gezeigt.value : roh.value));
const dots = computed(() =>
    stageDots(
        props.playmode.timeline.value?.stageStarts ?? [],
        trackWidth.value > 0 ? DOT_MIN_GAP_PX / trackWidth.value : 0,
    ),
);
/** Wo die gewählte Etappe auf der Schiene liegt, in Prozent. */
const stageSpan = computed(() => {
    const starts = props.playmode.timeline.value?.stageStarts ?? [];
    const index = props.selectedStage;
    const start = index === null || index === undefined ? undefined : starts[index];
    if (index === null || index === undefined || start === undefined) return null;
    const end = starts[index + 1] ?? 1;
    return { left: `${start * 100}%`, width: `${Math.max(0, end - start) * 100}%` };
});
/** Ab hundert Meilen ohne Nachkommastelle: Sie zählt mit und sagt nichts. */
const milesText = (value: number): string => formatNumber(value, value < 100 ? 1 : 0);
const miles = computed(() => milesText(props.playmode.here.value?.miles ?? 0));
const days = computed(() => formatNumber(props.playmode.here.value?.days ?? 0, 1));
/**
 * Was noch vor den Reisenden liegt - klein unter dem Zurückgelegten (Betreiber 2026-09-24, Variante F
 * der Skizzen: „F - rechner!!!“).
 */
const milesLeft = computed(() =>
    milesText(Math.max(0, (props.playmode.timeline.value?.totalMiles ?? 0) - (props.playmode.here.value?.miles ?? 0))),
);
const daysLeft = computed(() =>
    formatNumber(
        Math.max(0, (props.playmode.timeline.value?.totalDays ?? 0) - (props.playmode.here.value?.days ?? 0)),
        1,
    ),
);

/** Wohin ein Zeiger auf der Leiste zeigt, als Anteil 0…1. */
function fractionAt(clientX: number): number {
    const box = track.value?.getBoundingClientRect();
    if (!box || box.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
}

let seeking: number | undefined;
function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    seeking = event.pointerId;
    track.value?.setPointerCapture?.(event.pointerId);
    props.playmode.seek(fractionAt(event.clientX));
}
function onPointerMove(event: PointerEvent): void {
    if (seeking !== event.pointerId) return;
    props.playmode.seek(fractionAt(event.clientX));
}
function onPointerUp(event: PointerEvent): void {
    if (seeking !== event.pointerId) return;
    seeking = undefined;
    track.value?.releasePointerCapture?.(event.pointerId);
}

/** Die Leiste als Schieberegler: Pfeile in kleinen Schritten, Bild ↑/↓ je Etappe, Pos1 und Ende. */
function onTrackKey(event: KeyboardEvent): void {
    const playmode = props.playmode;
    const step = 0.02;
    const actions: Record<string, () => void> = {
        ArrowLeft: () => playmode.seek(playmode.fraction.value - step),
        ArrowRight: () => playmode.seek(playmode.fraction.value + step),
        PageUp: () => playmode.previousStage(),
        PageDown: () => playmode.nextStage(),
        Home: () => playmode.toStart(),
        End: () => playmode.toEnd(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
}

onBeforeUnmount(() => {
    seeking = undefined;
    resize?.disconnect();
});
</script>

<template>
    <div
        class="player"
        :class="{ 'player--floating': floating }"
        role="group"
        :aria-label="t('player.group')"
        :data-testid="floating ? 'route-player-floating' : 'route-player'"
        :data-map-overlay="floating ? 'top' : undefined"
    >
        <div
            ref="track"
            class="player__track"
            role="slider"
            tabindex="0"
            :aria-label="t('player.track')"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.round(percent)"
            :aria-valuetext="t('player.progress', { miles, days, milesLeft, daysLeft })"
            data-testid="player-track"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @keydown="onTrackKey"
        >
            <span class="player__rail" />
            <span v-if="stageSpan" class="player__stage" :style="stageSpan" data-testid="player-stage" />
            <span class="player__played" :style="{ width: `${percent}%` }" />
            <span
                v-for="(start, index) in dots"
                :key="index"
                class="player__dot"
                :class="{ 'player__dot--passed': start <= playmode.fraction.value }"
                :style="{ left: `${start * 100}%` }"
                data-testid="player-dot"
            />
            <span class="player__knob" :style="{ left: `${percent}%` }" />
        </div>
        <div class="player__row">
            <span class="player__value player__value--start">
                <span class="player__now einzeilig" data-testid="player-miles">{{
                    t("player.miles", { n: miles })
                }}</span>
                <span class="player__left einzeilig" data-testid="player-miles-left">{{
                    t("player.left", { n: milesLeft })
                }}</span>
            </span>
            <div class="player__buttons">
                <button
                    type="button"
                    class="player__button"
                    :title="t('player.start')"
                    :aria-label="t('player.start')"
                    data-testid="player-start"
                    @click="playmode.toStart()"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM19 5 9 12l10 7z" /></svg>
                </button>
                <button
                    type="button"
                    class="player__button"
                    :title="t('player.previous')"
                    :aria-label="t('player.previous')"
                    data-testid="player-previous"
                    @click="playmode.previousStage()"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6 3 12l9 6zM21 6l-9 6 9 6z" /></svg>
                </button>
                <button
                    type="button"
                    class="player__button player__button--play"
                    :title="playmode.playing.value ? t('player.pause') : t('player.play')"
                    :aria-label="playmode.playing.value ? t('player.pause') : t('player.play')"
                    :aria-pressed="playmode.playing.value"
                    data-testid="player-play"
                    @click="playmode.toggle()"
                >
                    <svg v-if="playmode.playing.value" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
                </button>
                <button
                    type="button"
                    class="player__button"
                    :title="t('player.next')"
                    :aria-label="t('player.next')"
                    data-testid="player-next"
                    @click="playmode.nextStage()"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6l9 6-9 6zM3 6l9 6-9 6z" /></svg>
                </button>
                <button
                    type="button"
                    class="player__button"
                    :title="t('player.end')"
                    :aria-label="t('player.end')"
                    data-testid="player-end"
                    @click="playmode.toEnd()"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM5 5l10 7-10 7z" /></svg>
                </button>
            </div>
            <span class="player__value player__value--end">
                <span class="player__now einzeilig" data-testid="player-days">{{ t("player.days", { n: days }) }}</span>
                <span class="player__left einzeilig" data-testid="player-days-left">{{
                    t("player.left", { n: daysLeft })
                }}</span>
            </span>
        </div>
    </div>
</template>

<style scoped>
/*
 * Allein trägt die Leiste die Hülle des Planers: Fläche, Schatten, nur die freie Kante gerundet.
 * Unter dem Planer ist sie sein Fuß, ohne eigenen Schatten und mit einem Trenner (route-planner.vue).
 */
.player {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-4);
    box-sizing: border-box;
    padding: var(--space-6) var(--space-8) var(--space-4);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

/* Die Leiste: eine dünne Schiene, die Trefferfläche aber fingerhoch. */
.player__track {
    position: relative;
    height: 16px;
    margin: 0 var(--space-4);
    cursor: pointer;
    touch-action: none;
}

.player__track:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.player__rail,
.player__played {
    position: absolute;
    top: 6px;
    left: 0;
    height: 4px;
    border-radius: 2px;
}

.player__rail {
    right: 0;
    background: var(--color-divider);
}

.player__played {
    background: var(--color-route);
}

/* Die gewählte Etappe liegt gold unter dem Fortschritt - so steht sie auch auf der Karte. */
.player__stage {
    position: absolute;
    top: 6px;
    height: 4px;
    background: var(--color-route-selected);
    pointer-events: none;
}

/*
 * Ein kleiner Punkt, wo eine Etappe beginnt: hell gefüllt mit dünnem Ring, eine Station auf der
 * Linie. Er ist etwas höher als die Schiene, damit man ihn auf Grau, Blau und Gold sieht.
 */
.player__dot {
    position: absolute;
    top: 5px;
    width: 6px;
    height: 6px;
    margin-left: -3px;
    box-sizing: border-box;
    border: 1px solid var(--color-text-muted);
    border-radius: 50%;
    /*
     * Hell in beiden Themen, im Weiß des Routensaums wie der Knopf: Mit der Panelfarbe gefüllt ging
     * der Punkt im Dunkeln im Blau unter (Betreiber 2026-09-24).
     */
    background: var(--color-route-halo);
    pointer-events: none;
}

.player__dot--passed {
    border-color: var(--color-route);
}

.player__knob {
    position: absolute;
    top: 3px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    box-sizing: border-box;
    border: 2px solid var(--color-route-halo);
    border-radius: 50%;
    background: var(--color-route);
    box-shadow: 0 0 0 1px var(--color-divider);
    pointer-events: none;
}

/* Beschriftung links und rechts, die Knöpfe dazwischen; was nicht passt, wird gekürzt, nie überstehen. */
.player__row {
    display: grid;
    grid-template-areas: "start buttons end";
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-4);
}

/* Oben kräftig, was hinter den Reisenden liegt; darunter klein und leise, was noch kommt (Variante F). */
.player__value {
    min-width: 0;
    color: var(--color-text-muted);
}

/* Gekürzt wird über `.einzeilig` (app.vue). */
.player__now,
.player__left {
    display: block;
}

.player__now {
    color: var(--color-text);
}

.player__left {
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
}

.player__value--start {
    grid-area: start;
}

.player__value--end {
    grid-area: end;
    text-align: right;
}

.player__buttons {
    display: inline-flex;
    grid-area: buttons;
    align-items: center;
    justify-self: center;
    gap: var(--space-2);
}

/* Allein über der Karte: ringsum gerundet, im Abstand der Seiten. */
.player--floating {
    position: absolute;
    top: var(--space-10);
    right: var(--space-10);
    left: var(--space-10);
    z-index: var(--z-map-ui);
    border-radius: var(--radius-sm);
}

.player__button {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.player__button svg {
    width: 14px;
    height: 14px;
    fill: currentcolor;
}

.player__button--play {
    width: 28px;
    height: 28px;
    color: var(--color-text-strong);
}

.player__button--play svg {
    width: 18px;
    height: 18px;
}

.player__button:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.player__button:active {
    background: var(--color-active-wash);
}

.player__button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * Am Finger bleibt das Bild klein, die Trefferfläche nicht. Die Beschriftung bleibt in EINER Reihe
 * mit den Knöpfen wie am Rechner (Betreiber 2026-09-24, Variante 3 der Skizze): Dafür sind die
 * Knöpfe schmaler, aber fingerhoch, und stehen ohne Lücke - bei 36 px Breite würde „3.339 Meilen“
 * gekürzt.
 */
@media (pointer: coarse) {
    .player__buttons {
        gap: 0;
    }

    .player__button {
        width: 30px;
        height: 36px;
    }

    .player__button--play {
        width: 32px;
        height: 40px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .player__button {
        transition: none;
    }
}
</style>
