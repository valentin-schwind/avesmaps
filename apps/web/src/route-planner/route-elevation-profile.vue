<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import type { ElevationSurface, RouteResponse } from "@avesmaps3d/shared";
import AvmText from "../controls/avm-text.vue";
import { elevationChartData, profileLines } from "./elevation-profile-model";
import { airHeightAt, nearestRunPoint, surfaceTone, type SurfaceTone } from "./elevation-profile-surfaces";
import { formatNumber, groundLabel } from "./planner-model";
import { snowlineCondition } from "./route-options-info-model";
import { t } from "../i18n/i18n";

const props = defineProps<{ route: RouteResponse; names: string[] }>();
const frame = ref<HTMLElement | null>(null);
const width = ref(300);
const gradient = useId();
let observer: ResizeObserver | undefined;
let resizeFrame = 0;
onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width <= 0) return;
        const measured = Math.round(entry.contentRect.width);
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
            if (width.value !== measured) width.value = measured;
        });
    });
    if (frame.value) observer.observe(frame.value);
});
onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(resizeFrame);
});

const data = computed(() => elevationChartData(props.route));
const runs = computed(() => data.value.runs.filter((run) => run.points.length > 0));
const snow = computed(() => profileLines(data.value.snow));
/** Was über der Schneegrenze liegt (Betreiber 2026-10-04, „B“), aus dem Reisemodell; ohne Boden darüber kein Hinweis. */
const snowCondition = snowlineCondition();
const snowHint = snowCondition ? t("planner.profile.snowHint", { ground: groundLabel(snowCondition) }) : undefined;
const airLines = computed(() => profileLines(data.value.air));
/** Die Farben des Gefälles: Land, Fluss (samt Binnensee), Meer - dazu die Flughöhe, wenn die Reise fliegt. */
const TONES: SurfaceTone[] = ["land", "river", "sea"];
const legend = computed(() => ({
    land: runs.value.some((run) => surfaceTone(run.kind) === "land"),
    river: runs.value.some((run) => surfaceTone(run.kind) === "river"),
    sea: runs.value.some((run) => surfaceTone(run.kind) === "sea"),
    air: airLines.value.length > 0,
}));
const height = 120;
const left = 42;
const right = 10;
const top = 20;
const bottom = 32;
const maximum = computed(() => {
    let result = 500;
    for (const [, value] of [...data.value.terrain, ...data.value.snow, ...data.value.air])
        result = Math.max(result, value ?? 0);
    return Math.ceil(result / 500) * 500;
});
const ticks = computed(() => [0, maximum.value / 2, maximum.value]);
const x = (miles: number): number => left + (miles / Math.max(data.value.distance, 1)) * (width.value - left - right);
const y = (value: number): number => height - bottom - (value / maximum.value) * (height - top - bottom);
const path = (points: readonly (readonly [number, number | null])[]): string =>
    points.map(([at, value], i) => `${i === 0 ? "M" : "L"}${x(at)},${y(value ?? 0)}`).join(" ");
const area = (points: readonly (readonly [number, number])[]): string =>
    `${path(points)} L${x(points[points.length - 1]![0])},${y(0)} L${x(points[0]![0])},${y(0)} Z`;
const focused = ref<{ at: number; height: number; kind: ElevationSurface; air: number | null } | null>(null);
function inspect(event: PointerEvent): void {
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const at = ((event.clientX - rect.left - left) / (width.value - left - right)) * data.value.distance;
    const nearest = nearestRunPoint(data.value.runs, at);
    focused.value = nearest
        ? {
              at: nearest.point[0],
              height: nearest.point[1],
              kind: nearest.kind,
              air: airHeightAt(airLines.value, nearest.point[0]),
          }
        : null;
}
const reading = computed(() => {
    const point = focused.value;
    if (!point) return "";
    const figures = { distance: formatNumber(point.at, 1), height: formatNumber(point.height, 0) };
    return point.air === null
        ? t("planner.profile.reading", figures)
        : t("planner.profile.readingAir", { ...figures, air: formatNumber(point.air, 0) });
});
</script>

<template>
    <figure ref="frame" class="profile" data-testid="elevation-chart">
        <template v-if="runs.length">
            <div class="profile__plot">
                <svg
                    :viewBox="`0 0 ${width} ${height}`"
                    role="img"
                    :aria-label="t('planner.profile.chart')"
                    @pointermove="inspect"
                    @pointerleave="focused = null"
                >
                    <title>{{ t("planner.profile.chart") }}</title>
                    <desc>{{ t("planner.profile.axes") }} {{ data.partial ? t("planner.profile.gaps") : "" }}</desc>
                    <defs>
                        <linearGradient
                            v-for="tone in TONES"
                            :id="`${gradient}-${tone}`"
                            :key="tone"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop offset="0" :class="['profile__gradient-top', `profile__tone--${tone}`]" />
                            <stop offset="1" class="profile__gradient-bottom" />
                        </linearGradient>
                    </defs>
                    <g v-for="tick in ticks" :key="tick">
                        <line :x1="left" :x2="width - right" :y1="y(tick)" :y2="y(tick)" class="profile__grid" />
                        <text :x="left - 6" :y="y(tick)" text-anchor="end" dominant-baseline="middle">
                            {{ formatNumber(tick, 0) }}
                        </text>
                    </g>
                    <text :x="left" :y="top / 2">{{ t("planner.slope.unit") }}</text>
                    <g v-for="(run, index) in runs" :key="index" :data-surface="run.kind">
                        <path :d="area(run.points)" :fill="`url(#${gradient}-${surfaceTone(run.kind)})`" />
                        <path
                            :d="path(run.points)"
                            :class="['profile__terrain', `profile__tone--${surfaceTone(run.kind)}`]"
                        />
                    </g>
                    <path
                        v-for="(line, index) in snow"
                        :key="`snow-${index}`"
                        :d="path(line)"
                        class="profile__snow"
                        data-testid="snowline-path"
                    />
                    <path
                        v-for="(line, index) in airLines"
                        :key="`air-${index}`"
                        :d="path(line)"
                        class="profile__air"
                        data-testid="air-path"
                    />
                    <text :x="left" :y="height - 12">0</text>
                    <text :x="width - right" :y="height - 12" text-anchor="end">
                        {{ t("planner.cost.miles", { n: formatNumber(data.distance, 1) }) }}
                    </text>
                    <circle
                        v-if="focused?.air != null"
                        :cx="x(focused.at)"
                        :cy="y(focused.air)"
                        class="profile__point profile__point--air"
                    />
                    <circle
                        v-if="focused"
                        :cx="x(focused.at)"
                        :cy="y(focused.height)"
                        :class="['profile__point', `profile__tone--${surfaceTone(focused.kind)}`]"
                    />
                </svg>
                <div
                    v-if="focused"
                    class="profile__reading"
                    :class="{ 'profile__reading--below': y(focused.air ?? focused.height) < height / 2 }"
                    :style="{
                        left: x(focused.at) <= width / 2 ? `${(x(focused.at) / width) * 100}%` : undefined,
                        right: x(focused.at) > width / 2 ? `${(1 - x(focused.at) / width) * 100}%` : undefined,
                        top: `${(y(focused.air ?? focused.height) / height) * 100}%`,
                    }"
                >
                    <AvmText :text="reading" />
                </div>
            </div>
            <div class="profile__terminals">
                <span>{{ names[0] }}</span
                ><span>{{ names[names.length - 1] }}</span>
            </div>
            <figcaption>
                <span v-if="legend.land" class="profile__legend profile__tone--land" data-testid="legend-land">{{
                    t("planner.profile.land")
                }}</span>
                <span v-if="legend.river" class="profile__legend profile__tone--river" data-testid="legend-river">{{
                    t("planner.profile.river")
                }}</span>
                <span v-if="legend.sea" class="profile__legend profile__tone--sea" data-testid="legend-sea">{{
                    t("planner.profile.sea")
                }}</span>
                <span v-if="legend.air" class="profile__legend profile__legend--air" data-testid="legend-air">{{
                    t("planner.profile.air")
                }}</span>
                <span
                    v-if="snow.length"
                    class="profile__legend profile__legend--snow"
                    :title="snowHint"
                    data-testid="legend-snow"
                    >{{ t("planner.profile.snow") }}</span
                >
            </figcaption>
            <p v-if="!route.departure">{{ t("planner.profile.noDate") }}</p>
            <p v-else-if="!snow.length">{{ t("planner.profile.noClimate") }}</p>
        </template>
    </figure>
</template>

<style scoped>
.profile {
    margin: var(--space-4) 0 0;
    padding: var(--space-4);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
.profile svg {
    display: block;
    width: 100%;
    overflow: visible;
}
.profile text {
    fill: var(--color-text-muted);
    font: inherit;
}
.profile__grid {
    stroke: var(--color-divider);
}
/* Die Höhenlinie trägt die Farbe ihrer Art: Land hellbraun, Fluss und Binnensee blau, Meer dunkelblau (Betreiber 2026-10-03). */
.profile__tone--land {
    --profile-tone: var(--color-profile-land);
}
.profile__tone--river {
    --profile-tone: var(--color-profile-river);
}
.profile__tone--sea {
    --profile-tone: var(--color-profile-sea);
}
.profile__terrain {
    fill: none;
    stroke: var(--profile-tone);
    stroke-width: calc(var(--space-2) / 2);
}
.profile__snow {
    fill: none;
    stroke: var(--color-route-halo);
    stroke-width: calc(var(--space-4) / 4);
}
/* Die Flughöhe: eine zweite, rote Linie über dem Gelände. */
.profile__air {
    fill: none;
    stroke: var(--color-profile-air);
    stroke-width: calc(var(--space-2) / 2);
}
.profile__gradient-top {
    stop-color: var(--profile-tone);
    stop-opacity: 0.35;
}
.profile__gradient-bottom {
    stop-color: var(--color-panel-soft);
    stop-opacity: 0.1;
}
.profile__point {
    r: calc(var(--space-4) / 2);
    fill: var(--profile-tone);
    stroke: var(--color-text);
}
.profile__point--air {
    fill: var(--color-profile-air);
}
.profile__terminals {
    display: flex;
    justify-content: space-between;
    gap: var(--space-8);
    overflow-wrap: anywhere;
}
.profile__terminals > span {
    max-width: 50%;
}
.profile__terminals > span:last-child {
    text-align: right;
}
.profile figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
    margin-top: var(--space-4);
}
.profile__legend::before {
    content: "";
    display: inline-block;
    width: var(--space-16);
    margin-right: var(--space-2);
    border-top: calc(var(--space-2) / 2) solid var(--profile-tone, var(--color-text-muted));
    vertical-align: middle;
}
.profile__legend--air {
    --profile-tone: var(--color-profile-air);
}
.profile__legend--snow {
    --profile-tone: var(--color-route-halo);
}
.profile p {
    margin: var(--space-4) 0 0;
}
.profile__plot {
    position: relative;
}
.profile__reading {
    position: absolute;
    pointer-events: none;
    max-width: 50%;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    color: var(--color-text);
    transform: translateY(calc(-100% - var(--space-4)));
}
.profile__reading--below {
    transform: translateY(var(--space-4));
}
</style>
