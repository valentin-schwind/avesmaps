<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { AVENTURIA_TRAVEL_MODEL, airCeilingAbsolute, airMaxAboveGround } from "@avesmaps3d/shared";
import AvmText from "../controls/avm-text.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterMauer from "../fenster/fenster-mauer.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import FensterText from "../fenster/fenster-text.vue";
import { formatDecimal, t } from "../i18n/i18n";
import { flightProfile, MERCATOR_PER_SCHRITT, MERCATOR_PER_UNIT } from "../map/flight-path";
import { AIR_GROUPS, AIR_PROFILES, airGroupLabel, airProfileLabel, airProfilesOf } from "./air-profiles";
import { REST_ICON } from "./planner-model";

/**
 * Der Reiter „Flug“ im ⓘ Transportmittel (WI-0051; Betreiber 2026-09-28: „du machst den reiter für flug“),
 * gebaut wie der Reiter „Gebirge“: ein Bild, eine Tafel, einfache Regeln ohne Fachsprache.
 *
 * - 🔴 **Das Bild rechnet mit dem Profil der Flugbahn** (`flightProfile` aus `flight-path.ts`), nicht mit einer
 *   eigenen Formel: Was das Bild zeigt, ist das, was die Karte in 3D zeichnet. Das Gelände darunter ist ein
 *   ausgedachtes Beispiel; das Bild ist eine Skizze, die Höhe ist gegenüber der Strecke stark gestreckt.
 * - Tempo, Reisehöhe und die höchste Höhe über Grund der Tafel kommen aus dem Reisemodell (`air-profiles.ts`,
 *   `airMaxAboveGround`); die absolute Höchstflughöhe (5.000 Schritt über dem Meer, Betreiber 2026-10-04) ebenso
 *   (`airCeilingAbsolute`).
 * - Das Bild misst seine Breite und zeichnet in Pixeln, wie das Bild im Reiter „Gebirge“.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const flug = model.flug.wert;
const greif = AIR_PROFILES.find((profile) => profile.id === "griffin");
const CRUISE = greif?.altitudePaces ?? 800;
const REACH = airMaxAboveGround(model, CRUISE);
const CEILING = airCeilingAbsolute(model);
const CLEARANCE = flug.mindestabstandSchritt;
/** Gelände über dieser Höhe umfliegt jedes Flugmittel: die Höchstflughöhe minus der Mindestabstand. */
const LIMIT = CEILING - CLEARANCE;
/** Das Flugmittel der Regel „Wie hoch?“: der Hexenbesen, dessen 1.000 Schritt über Grund die Zehnfachregel zeigen. */
const witch = AIR_PROFILES.find((profile) => profile.id === "witchFlight");
const WITCH_CRUISE = witch?.altitudePaces ?? 100;

// --- Das Beispiel: 120 Meilen, ein Gebirge unter der Höchstflughöhe, eins darüber ---
const MILES = 120;
const SAMPLES = 480;

/** Ein Berg als weicher Kegel: Höhe in Schritt an der Stelle `u` (Meilen). */
const peak = (u: number, center: number, height: number, half: number): number =>
    height * Math.max(0, 1 - Math.abs(u - center) / half) ** 1.5;

/** Das Gelände unter der Bahn: zwei Grate mit einem Tal dazwischen, später die Flanke des zu hohen Bergs. */
const groundUnder = (u: number): number =>
    Math.max(peak(u, 30, 3600, 9), peak(u, 43, 4200, 9), peak(u, 36, 1700, 5), peak(u, 86, 1400, 8));
/** Der zu hohe Berg daneben: Um ihn fliegt der Greif herum, er liegt nicht unter der Bahn. */
const TOO_HIGH = { center: 86, height: 9600, half: 11 };

const profile = ((): { ground: number[]; air: number[] } => {
    const ground = new Float32Array(SAMPLES + 1);
    for (let k = 0; k <= SAMPLES; k += 1) ground[k] = groundUnder((MILES * k) / SAMPLES) * MERCATOR_PER_SCHRITT;
    const units = MILES / model.meilenJeKarteneinheit.wert;
    const z = flightProfile(
        {
            ground,
            length: units * MERCATOR_PER_UNIT,
            cruise: CRUISE * MERCATOR_PER_SCHRITT,
            reach: REACH * MERCATOR_PER_SCHRITT,
            ceiling: CEILING * MERCATOR_PER_SCHRITT,
            clearance: CLEARANCE * MERCATOR_PER_SCHRITT,
        },
        1,
    );
    return {
        ground: Array.from(ground, (value) => value / MERCATOR_PER_SCHRITT),
        air: Array.from(z, (value) => value / MERCATOR_PER_SCHRITT),
    };
})();

// --- Das Bild: Strecke nach rechts, Höhe nach oben ---
const MAX_HEIGHT = 10000;
const HEIGHT = 250;
const LEFT = 52;
const RIGHT = 14;
const TOP = 14;
const BOTTOM = 34;

const bild = ref<HTMLElement | null>(null);
const width = ref(880);
let observer: ResizeObserver | undefined;
onMounted(() => {
    if (!bild.value || typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(([entry]) => {
        if (entry && entry.contentRect.width > 0) width.value = Math.round(entry.contentRect.width);
    });
    observer.observe(bild.value);
});
onBeforeUnmount(() => observer?.disconnect());

const x = (miles: number): number => LEFT + (miles / MILES) * (width.value - RIGHT - LEFT);
const y = (schritt: number): number => HEIGHT - BOTTOM - (schritt / MAX_HEIGHT) * (HEIGHT - BOTTOM - TOP);
const at = (k: number): number => (MILES * k) / SAMPLES;

const groundPath = computed(() => {
    const parts = profile.ground.map((h, k) => `L${x(at(k)).toFixed(1)},${y(h).toFixed(1)}`);
    return `M${x(0).toFixed(1)},${y(0).toFixed(1)} ${parts.join(" ")} L${x(MILES).toFixed(1)},${y(0).toFixed(1)} Z`;
});
const tooHighPath = computed(() => {
    const parts: string[] = [];
    for (let k = 0; k <= 80; k += 1) {
        const u = TOO_HIGH.center - TOO_HIGH.half + (2 * TOO_HIGH.half * k) / 80;
        parts.push(
            `${k === 0 ? "M" : "L"}${x(u).toFixed(1)},${y(peak(u, TOO_HIGH.center, TOO_HIGH.height, TOO_HIGH.half)).toFixed(1)}`,
        );
    }
    return parts.join(" ");
});
const airPath = computed(() =>
    profile.air.map((h, k) => `${k === 0 ? "M" : "L"}${x(at(k)).toFixed(1)},${y(h).toFixed(1)}`).join(" "),
);

/** Die Stellen, die das Bild erklärt: steigt auf, über die Grate, außen herum, sinkt ins Ziel. */
const marks = computed(() => {
    const air = (miles: number): number => profile.air[Math.round((miles / MILES) * SAMPLES)] ?? 0;
    return [
        { n: 1, miles: 8, height: air(8) },
        { n: 2, miles: 36, height: air(36) },
        { n: 3, miles: TOO_HIGH.center, height: air(TOO_HIGH.center) },
        { n: 4, miles: 114, height: air(114) },
    ].map((mark) => ({ ...mark, cx: x(mark.miles), cy: y(mark.height) }));
});
const gridHeights = [0, 2000, 4000, 6000, 8000, 10000];
const gridMiles = [0, 30, 60, 90, 120];

const schritt = (value: number): string => formatDecimal(Math.round(value), 0);
const reachFactor = computed(() => formatDecimal(flug.hoechstflughoeheProzent / 100, 0));
/** Schritt Strecke je Schritt Aufstieg über die Reisehöhe (F4, `steigkostenFaktor`). */
const climbCost = computed(() => formatDecimal(flug.steigkostenFaktor, 0));
/** Um wie viel Prozent die Meile in der größten Höhe länger dauert: Überstand höchstens (1 − 100 % / Höchstprozent) der Höhe über Grund. */
const holdCost = computed(() =>
    formatDecimal((1 - 100 / flug.hoechstflughoeheProzent) * flug.haltekostenFaktor * 100, 0),
);

const groups = computed(() =>
    AIR_GROUPS.map((group) => ({
        group,
        name: airGroupLabel(group),
        rows: airProfilesOf(group).map((profile) => ({
            id: profile.id,
            icon: profile.icon,
            name: airProfileLabel(profile.id),
            speed: formatDecimal(profile.speedMph, profile.speedMph % 1 === 0 ? 0 : 1),
            cruise: schritt(profile.altitudePaces),
            reach: schritt(airMaxAboveGround(model, profile.altitudePaces)),
        })),
    })),
);

const iconOf = (id: string): string => AIR_PROFILES.find((profile) => profile.id === id)?.icon ?? REST_ICON;
/**
 * Die Regeln in der Reihenfolge eines Regelwerks (WI-0076): erst wie hoch, dann was Höhe kostet, dann der Weg, zuletzt
 * Zeit, Karte und was nicht zählt. Jede Zahl kommt aus dem Reisemodell; den Namen des Beispiels liefert die Tafel.
 */
const rules = computed(() => [
    {
        key: "ceiling",
        icon: iconOf("witchFlight"),
        title: t("transportInfo.air.rule.ceiling.title"),
        text: t("transportInfo.air.rule.ceiling", {
            factor: reachFactor.value,
            name: airProfileLabel("witchFlight"),
            cruise: schritt(WITCH_CRUISE),
            reach: schritt(airMaxAboveGround(model, WITCH_CRUISE)),
            ceiling: schritt(CEILING),
        }),
    },
    {
        key: "height",
        icon: iconOf("hippogriff"),
        title: t("transportInfo.air.rule.height.title"),
        text: t("transportInfo.air.rule.height", {
            clearance: schritt(CLEARANCE),
            climb: climbCost.value,
            hold: holdCost.value,
            extra: t("planner.air.extra", { hours: "x" }),
        }),
    },
    {
        key: "around",
        icon: iconOf("griffin"),
        title: t("transportInfo.air.rule.around.title"),
        text: t("transportInfo.air.rule.around", { limit: schritt(LIMIT), clearance: schritt(CLEARANCE) }),
    },
    {
        key: "start",
        icon: iconOf("flyingLizard"),
        title: t("transportInfo.air.rule.start.title"),
        text: t("transportInfo.air.rule.start", { limit: schritt(LIMIT) }),
    },
    {
        key: "time",
        icon: REST_ICON,
        title: t("transportInfo.air.rule.time.title"),
        text: t("transportInfo.air.rule.time"),
    },
    {
        key: "map",
        icon: iconOf("airship"),
        title: t("transportInfo.air.rule.map.title"),
        text: t("transportInfo.air.rule.map"),
    },
    {
        key: "notCounted",
        icon: iconOf("flyingCarpet"),
        title: t("transportInfo.air.rule.notCounted.title"),
        text: t("transportInfo.air.rule.notCounted"),
    },
]);
</script>

<template>
    <FensterText class="einleitung" :text="t('transportInfo.air.intro')" />

    <FensterKarte :titel="t('transportInfo.air.chartTitle')" :bild="iconOf('griffin')">
        <div ref="bild" class="bild">
            <svg
                :viewBox="`0 0 ${width} ${HEIGHT}`"
                :width="width"
                :height="HEIGHT"
                role="img"
                :aria-label="t('transportInfo.air.chartAria')"
                data-testid="transport-info-flugbild"
            >
                <line
                    v-for="h in gridHeights"
                    :key="`g${h}`"
                    class="gitter"
                    :x1="LEFT"
                    :x2="width - RIGHT"
                    :y1="y(h)"
                    :y2="y(h)"
                />
                <text
                    v-for="h in gridHeights"
                    :key="`h${h}`"
                    class="marke"
                    :x="LEFT - 8"
                    :y="y(h) + 4"
                    text-anchor="end"
                >
                    {{ schritt(h) }}
                </text>
                <text
                    v-for="m in gridMiles"
                    :key="`m${m}`"
                    class="marke"
                    :x="x(m)"
                    :y="HEIGHT - BOTTOM + 15"
                    :text-anchor="m === 0 ? 'start' : m === MILES ? 'end' : 'middle'"
                >
                    {{ m }}
                </text>
                <text class="achsname" :x="LEFT" :y="HEIGHT - 4">{{ t("transportInfo.air.axisMiles") }}</text>
                <text class="achsname" :x="LEFT" :y="TOP - 2">{{ t("transportInfo.air.axisHeight") }}</text>
                <path class="zu-hoch" :d="tooHighPath" />
                <path class="boden" :d="groundPath" />
                <line class="hoehe" :x1="LEFT" :x2="width - RIGHT" :y1="y(CEILING)" :y2="y(CEILING)" />
                <text class="hoehe-name" :x="width - RIGHT" :y="y(CEILING) - 5" text-anchor="end">
                    {{ t("transportInfo.air.ceilingLine", { height: schritt(CEILING) }) }}
                </text>
                <line class="hoehe" :x1="LEFT" :x2="width - RIGHT" :y1="y(CRUISE)" :y2="y(CRUISE)" />
                <text class="hoehe-name" :x="x(64)" :y="y(CRUISE) + 13" text-anchor="middle">
                    {{ t("transportInfo.air.cruiseLine", { height: schritt(CRUISE) }) }}
                </text>
                <path class="bahn" :d="airPath" data-testid="transport-info-flugbahn" />
                <g v-for="mark in marks" :key="mark.n" class="stelle">
                    <circle :cx="mark.cx" :cy="mark.cy - 14" r="8" />
                    <text :x="mark.cx" :y="mark.cy - 10" text-anchor="middle">{{ mark.n }}</text>
                </g>
            </svg>
        </div>
        <ol class="stellen">
            <li>{{ t("transportInfo.air.mark.climb", { cruise: schritt(CRUISE) }) }}</li>
            <li>{{ t("transportInfo.air.mark.over", { clearance: schritt(CLEARANCE) }) }}</li>
            <li>{{ t("transportInfo.air.mark.around", { limit: schritt(LIMIT) }) }}</li>
            <li>{{ t("transportInfo.air.mark.land") }}</li>
        </ol>
        <p class="beispiel">{{ t("transportInfo.air.chartNote") }}</p>
    </FensterKarte>

    <FensterKarte :titel="t('transportInfo.air.tableTitle')" :bild="iconOf('airship')">
        <!-- Zahlenspalten gleich breit: Die Tafel passt auch am Telefon ganz hinein (WI-0076, „Tabelle B“). -->
        <FensterTafel :beschriftung="t('transportInfo.air.tableTitle')" gleich>
            <table data-testid="transport-info-flugmittel">
                <thead>
                    <tr>
                        <th scope="col">{{ t("transportInfo.air.col.flier") }}</th>
                        <th scope="col">{{ t("transportInfo.air.col.speed") }}</th>
                        <th scope="col">{{ t("transportInfo.air.col.cruise") }}</th>
                        <th scope="col">{{ t("transportInfo.air.col.reach") }}</th>
                    </tr>
                </thead>
                <tbody v-for="entry in groups" :key="entry.group">
                    <tr>
                        <th scope="rowgroup" colspan="4">{{ entry.name }}</th>
                    </tr>
                    <tr v-for="row in entry.rows" :key="row.id" :data-flugmittel="row.id">
                        <th scope="row">
                            <span class="fenster-tafel__name">
                                <img :src="row.icon" alt="" />
                                <span>{{ row.name }}</span>
                            </span>
                        </th>
                        <td><AvmText :text="row.speed" /></td>
                        <td><AvmText :text="row.cruise" /></td>
                        <td><AvmText :text="row.reach" /></td>
                    </tr>
                </tbody>
            </table>
        </FensterTafel>
        <FensterText
            class="notiz"
            :text="t('transportInfo.air.custom', { factor: reachFactor, ceiling: schritt(CEILING) })"
        />
    </FensterKarte>

    <!-- Mauerwerk (WI-0076): links Höhe, Kosten und Weg; rechts Sonderfälle, Zeit, Karte und was nicht zählt. -->
    <FensterMauer>
        <FensterKarte
            v-for="entry in rules"
            :key="entry.key"
            :titel="entry.title"
            :bild="entry.icon"
            :data-testid="`transport-info-regel-${entry.key}`"
        >
            <FensterText class="notiz" :text="entry.text" />
        </FensterKarte>
    </FensterMauer>
</template>

<style scoped>
.einleitung {
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
}

/* Das Bild wie im Reiter „Gebirge“: Gitter und Achsen leise, die Bahn am lautesten, in der Farbe des Flugs. */
.bild {
    min-width: 0;
}

.bild svg {
    display: block;
    max-width: 100%;
    height: auto;
}

.gitter {
    stroke: var(--color-border);
    stroke-width: 1;
}

.marke,
.achsname,
.hoehe-name {
    fill: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.achsname {
    font-style: italic;
}

.boden {
    fill: var(--color-border);
    stroke: var(--color-text-muted);
    stroke-width: 1;
}

/* Der zu hohe Berg liegt neben der Bahn, nicht unter ihr: nur sein Umriss, gestrichelt. */
.zu-hoch {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.2;
    stroke-dasharray: 4 3;
}

.hoehe {
    stroke: var(--color-text-muted);
    stroke-width: 1;
    stroke-dasharray: 2 4;
}

.bahn {
    fill: none;
    stroke: var(--color-route-flight);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.stelle circle {
    fill: var(--color-panel);
    stroke: var(--color-route-flight);
    stroke-width: 1.5;
}

.stelle text {
    fill: var(--color-text-strong);
    font-size: var(--font-size-caption);
    font-weight: 600;
}

.stellen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--avm-fenster-spalte), 1fr));
    gap: var(--space-4) var(--space-16);
    margin: 0;
    padding-left: var(--space-16);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.beispiel,
.notiz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}
</style>
