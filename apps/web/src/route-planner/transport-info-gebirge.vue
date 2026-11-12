<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { AVENTURIA_TRAVEL_MODEL, familyStepFactor, switchbackGrade, type SlopeFamily } from "@avesmaps3d/shared";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterMauer from "../fenster/fenster-mauer.vue";
import FensterQuellen from "../fenster/fenster-quellen.vue";
import FensterText from "../fenster/fenster-text.vue";
import { formatDecimal, t } from "../i18n/i18n";
import { PATH_ICONS, TRANSPORT_ICONS } from "./planner-model";
import { ledPace, steepDownhill } from "./transport-info-model";

/**
 * Der Reiter „Gebirge“ im ⓘ Transportmittel (WI-0049; Betreiber 2026-09-28: „ein neues tab mit dem
 * steigungsgraph und sehr einfachen erklärungen, wie alles funktioniert (nicht so techtalk)“, Entwurf
 * `wi-0049-hinweise-gebirge.png`: „passt“).
 *
 * - 🔴 **Das Bild rechnet mit dem Rechner des Routers** (`familyStepFactor` aus `shared`), nicht mit einer
 *   eigenen Formel. Legacys Owner hatte dieselbe Bedingung für sein Kurvenbild: „was die Kurve zeigt, ist
 *   das, was die Route rechnet“.
 * - Gezeigt wird der Faktor je Schritt vor der Eichung: Die Eichung verteilt die Zeit nur um und steht als
 *   Regel „Im Mittel wie im Regelwerk“ daneben.
 * - Die Linien tragen Farbe UND Strichmuster (Legacy `travel-model-curves.css`: die zweite Kodierung ist
 *   Pflicht), die Farben kommen aus dem Kanon (`chart1` bis `chart3`).
 * - Das Bild misst seine Breite und zeichnet in Pixeln: So bleibt die Schrift darin am Telefon und auf
 *   dem Rechner gleich groß.
 */

const model = AVENTURIA_TRAVEL_MODEL;

/** Die Linien in fester Reihenfolge; die Reihenfolge bestimmt Farbe und Strichmuster. */
const SERIES: readonly { family: SlopeFamily; icon: string | undefined; linie: string }[] = [
    { family: "FOOT", icon: TRANSPORT_ICONS.groupFoot, linie: "linie--1" },
    { family: "EQUID", icon: TRANSPORT_ICONS.groupHorse, linie: "linie--3" },
    { family: "WHEEL", icon: TRANSPORT_ICONS.horseCarriage, linie: "linie--2" },
];

// --- Das Bild: Steigung −40 … +40 % nach rechts, der Faktor ×1 … ×4 nach oben ---
const MAX_GRADE = 0.4;
const MAX_FACTOR = 4;
const HEIGHT = 270;
const LEFT = 40;
const RIGHT = 14;
const TOP = 16;
const BOTTOM = 40;

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

const x = (s: number): number => LEFT + ((s + MAX_GRADE) / (2 * MAX_GRADE)) * (width.value - RIGHT - LEFT);
const y = (f: number): number =>
    HEIGHT - BOTTOM - ((Math.min(f, MAX_FACTOR + 0.3) - 1) / (MAX_FACTOR - 1)) * (HEIGHT - BOTTOM - TOP);

/** Die Linie einer Familie; eine echte Kante (zu Fuß bei 20 % Gefälle) steht senkrecht, nicht schräg. */
function line(family: SlopeFamily): string {
    const parts: string[] = [];
    let previous: number | undefined;
    for (let i = 0; i <= 400; i += 1) {
        const s = -MAX_GRADE + (2 * MAX_GRADE * i) / 400;
        const f = familyStepFactor(family, s, model);
        if (previous !== undefined && Math.abs(f - previous) > 0.5) {
            parts.push(`L${x(s).toFixed(1)},${y(previous).toFixed(1)}`);
        }
        parts.push(`${parts.length === 0 ? "M" : "L"}${x(s).toFixed(1)},${y(f).toFixed(1)}`);
        previous = f;
    }
    return parts.join(" ");
}

const lines = computed(() => SERIES.map((entry) => ({ ...entry, d: line(entry.family) })));
/** Die Knicks der Kehrenregel bergauf, als Kreis auf der Linie. */
const knees = computed(() =>
    SERIES.flatMap(({ family }) => {
        const grade = switchbackGrade(family, true, model);
        return grade === null ? [] : [{ family, cx: x(grade), cy: y(familyStepFactor(family, grade, model)) }];
    }),
);
const gridFactors = [1, 2, 3, 4];
const gridGrades = [-0.4, -0.2, 0, 0.2, 0.4];

const percent = (grade: number): string => `${formatDecimal(Math.round(grade * 100), 0)} %`;
const gradeLabel = (grade: number): string =>
    grade === 0 ? t("transportInfo.mountain.flat") : `${grade > 0 ? "+" : "−"}${percent(Math.abs(grade))}`;

const EXAMPLE_GRADE = 0.1;
const example = computed(() =>
    SERIES.map(({ family }) => {
        const factor = familyStepFactor(family, EXAMPLE_GRADE, model);
        const rounded = Math.round(factor * 10) / 10;
        return `${t(`transportInfo.mountain.family.${family}`)} ${
            rounded === 2
                ? t("transportInfo.mountain.times.double")
                : t("transportInfo.mountain.times", { factor: formatDecimal(rounded, 1) })
        }`;
    }).join(" · "),
);

const kneeOf = (family: SlopeFamily): number => switchbackGrade(family, true, model) ?? 0;
/** Geführte Tiere im Gebirge, in ganzen Prozent des Tempos der Gruppe zu Fuß (WI-0258 E5). */
const led = ledPace(model);
const ledPercent = (share: number | undefined): string => formatDecimal(Math.round((share ?? 1) * 100), 0);
/** Ab welchem Gefälle es je Familie bremst, am Rechner des Routers gesucht (WI-0076; vorher „Tier und Wagen früher“). */
const steep = steepDownhill(model);
/** Die Regeln als gerahmte Karten mit Aufschrift (WI-0076, wie im ⓘ Reiseoptionen). */
const rules = computed(() => [
    {
        key: "downhill",
        icon: PATH_ICONS.Weg,
        title: t("transportInfo.mountain.rule.downhill.title"),
        text: t("transportInfo.mountain.rule.downhill", {
            foot: percent(steep.FOOT),
            animal: percent(steep.EQUID),
            wheel: percent(steep.WHEEL),
        }),
    },
    {
        key: "switchbacks",
        icon: PATH_ICONS.Gebirgspass,
        title: t("transportInfo.mountain.rule.switchbacks.title"),
        text: t("transportInfo.mountain.rule.switchbacks", {
            animal: percent(kneeOf("EQUID")),
            wheel: percent(kneeOf("WHEEL")),
        }),
    },
    {
        key: "average",
        icon: PATH_ICONS.Querfeldein,
        title: t("transportInfo.mountain.rule.average.title"),
        text: t("transportInfo.mountain.rule.average"),
    },
    {
        key: "open",
        icon: PATH_ICONS.Querfeldein,
        title: t("transportInfo.mountain.rule.open.title"),
        text: t("transportInfo.mountain.rule.open"),
    },
    {
        key: "dismount",
        icon: TRANSPORT_ICONS.lightRider,
        title: t("transportInfo.mountain.rule.dismount.title"),
        text: t("transportInfo.mountain.rule.dismount", { path: ledPercent(led?.path), open: ledPercent(led?.open) }),
    },
    {
        key: "carriage",
        icon: TRANSPORT_ICONS.horseCarriage,
        title: t("transportInfo.mountain.rule.carriage.title"),
        text: t("transportInfo.mountain.rule.carriage"),
    },
    {
        key: "heights",
        icon: PATH_ICONS.Pfad,
        title: t("transportInfo.mountain.rule.heights.title"),
        text: t("transportInfo.mountain.rule.heights"),
    },
]);
</script>

<template>
    <FensterText class="einleitung" :text="t('transportInfo.mountain.intro')" />

    <FensterKarte :titel="t('transportInfo.mountain.chartTitle')" :bild="PATH_ICONS.Gebirgspass">
        <div ref="bild" class="bild">
            <svg
                :viewBox="`0 0 ${width} ${HEIGHT}`"
                :width="width"
                :height="HEIGHT"
                role="img"
                :aria-label="t('transportInfo.mountain.chartAria')"
                data-testid="transport-info-steigungsbild"
            >
                <line
                    v-for="f in gridFactors"
                    :key="`g${f}`"
                    class="gitter"
                    :x1="LEFT"
                    :x2="width - RIGHT"
                    :y1="y(f)"
                    :y2="y(f)"
                />
                <text
                    v-for="f in gridFactors"
                    :key="`f${f}`"
                    class="marke"
                    :x="LEFT - 8"
                    :y="y(f) + 4"
                    text-anchor="end"
                >
                    ×{{ f }}
                </text>
                <line class="achse" :x1="x(0)" :x2="x(0)" :y1="TOP - 4" :y2="HEIGHT - BOTTOM" />
                <line class="achse" :x1="LEFT" :x2="width - RIGHT" :y1="HEIGHT - BOTTOM" :y2="HEIGHT - BOTTOM" />
                <text
                    v-for="s in gridGrades"
                    :key="`s${s}`"
                    class="marke"
                    :x="x(s)"
                    :y="HEIGHT - BOTTOM + 15"
                    :text-anchor="s === -MAX_GRADE ? 'start' : s === MAX_GRADE ? 'end' : 'middle'"
                >
                    {{ gradeLabel(s) }}
                </text>
                <text class="achsname" :x="LEFT" :y="HEIGHT - 6">{{ t("transportInfo.mountain.downhill") }}</text>
                <text class="achsname" :x="width - RIGHT" :y="HEIGHT - 6" text-anchor="end">
                    {{ t("transportInfo.mountain.uphill") }}
                </text>
                <path
                    v-for="entry in lines"
                    :key="entry.family"
                    class="linie"
                    :class="entry.linie"
                    :d="entry.d"
                    :data-familie="entry.family"
                />
                <circle
                    v-for="knee in knees"
                    :key="`k${knee.family}`"
                    class="knick"
                    :cx="knee.cx"
                    :cy="knee.cy"
                    r="3.2"
                />
            </svg>
        </div>
        <ul class="legende">
            <li v-for="entry in SERIES" :key="entry.family">
                <svg viewBox="0 0 22 8" aria-hidden="true">
                    <line class="linie" :class="entry.linie" x1="1" y1="4" x2="21" y2="4" />
                </svg>
                <img v-if="entry.icon" class="symbol" :src="entry.icon" alt="" />
                {{ t(`transportInfo.mountain.family.${entry.family}`) }}
            </li>
            <li>
                <svg viewBox="0 0 22 8" aria-hidden="true"><circle class="knick" cx="11" cy="4" r="3" /></svg>
                {{ t("transportInfo.mountain.knee") }}
            </li>
        </ul>
        <p class="beispiel" data-testid="transport-info-steigungsbeispiel">
            <b>{{ t("transportInfo.mountain.example", { grade: percent(EXAMPLE_GRADE) }) }}</b>
            {{ example }}
        </p>
    </FensterKarte>

    <!-- Mauerwerk (WI-0076): links, wie die Steigung wirkt; rechts, was je Transportmittel gilt, und die Höhen. -->
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

    <FensterQuellen :grundlage="t('transportInfo.sources.lead')" :werke="t('transportInfo.mountain.sources')" />
</template>

<style scoped>
.einleitung {
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
}

/* Das Bild nach Legacys Kurven (travel-model-curves.css): Gitter und Achsen leise, die Kurve am lautesten. */
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

.achse {
    stroke: var(--color-text-muted);
    stroke-width: 1;
}

.marke,
.achsname {
    fill: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.achsname {
    font-style: italic;
}

.knick {
    fill: var(--color-panel);
    stroke: var(--color-text-muted);
    stroke-width: 1.2;
}

/* Farbe UND Strichmuster in fester Reihenfolge; die zweite Kodierung ist Pflicht. */
.linie {
    fill: none;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.linie--1 {
    stroke: var(--color-chart1);
}

.linie--2 {
    stroke: var(--color-chart2);
    stroke-dasharray: 6 3;
}

.linie--3 {
    stroke: var(--color-chart3);
    stroke-dasharray: 2 3;
}

.legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-16);
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.legende li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

.legende svg {
    width: var(--icon-lg);
    height: var(--space-6);
}

.beispiel {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.beispiel b {
    color: var(--color-text-strong);
}

.symbol {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
}

.notiz {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}
</style>
