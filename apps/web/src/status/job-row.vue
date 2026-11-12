<script setup lang="ts">
import { computed } from "vue";
import type { JobSummary, QueueEntry } from "@avesmaps3d/shared";
import { dataLabel } from "./format";
import {
    estimateText,
    findingTexts,
    herkunftZeile,
    isRunning,
    metaParts,
    progressPercent,
    reasonText,
    stalledText,
    stateWord,
    waitText,
} from "./job-view";
import { t } from "../i18n/i18n";

/**
 * Eine Zeile der Queue (JOBS-0001 5.2): ein Job mit seinem Zustand, seiner Phase, seinen Zahlen und, wo etwas schiefging, einem Satz
 * dazu. „Listenzeile als Karte“ (Design Guide §10, §13.13: Karte für wenige Einträge), der Statuspunkt trägt die Farbe, der Text
 * die Aussage: Avesmaps warnt in Sätzen, nicht in Schildern (§13.16). Die Sätze rechnet `job-view.ts`.
 *
 * Der Punkt allein sagt nichts: Der Zustand steht immer auch als Wort in der Zeile (für Vorleser und für Menschen, die Farben
 * schlecht unterscheiden).
 */

const props = defineProps<{
    job: JobSummary | QueueEntry;
    /** „Jetzt“ in Serverzeit, ms. */
    nowMs: number;
    /** Die Umgebung der Tafel (`overview.umgebung`, WI-0293); ohne sie fehlt „wo“ in der Zeile des Auslösers. */
    umgebung?: string | null;
}>();

const queueEntry = computed(() => ("position" in props.job ? props.job : null));
const state = computed(() => stateWord(props.job));
const kindLabel = computed(() => dataLabel("status.kind", props.job.kind));
const running = computed(() => isRunning(props.job));
/**
 * Die Beschriftung nur, wenn sie mehr sagt als die Jobart („Probe“ unter „Probe“ wäre doppelt). Beginnt sie mit der Jobart
 * („Gelände voll rechnen (Fassung 19 (Test))“), steht sie an deren Stelle statt daneben.
 */
const ersetztArt = computed(() => props.job.label?.startsWith(kindLabel.value) === true);
const kindText = computed(() => (ersetztArt.value ? (props.job.label ?? kindLabel.value) : kindLabel.value));
const label = computed(() => (props.job.label && !ersetztArt.value ? props.job.label : null));
const percent = computed(() => progressPercent(props.job));
const meta = computed(() => metaParts(props.job, props.nowMs));
const wait = computed(() => waitText(props.job, props.nowMs));
const estimate = computed(() => (queueEntry.value ? estimateText(queueEntry.value, props.nowMs) : null));
const stalled = computed(() => stalledText(props.job, props.nowMs));
const reason = computed(() => reasonText(props.job));
const findings = computed(() => findingTexts(props.job));
/**
 * Wer, wann, wo (WI-0293): „Ausgelöst von Vali · heute, 14:03 · auf Production“. Nur in der Warteschlange: Die Importe im Reiter
 * Betrieb tragen weder Auslöser noch Umgebung, dort fehlt die Zeile.
 */
const herkunft = computed(() =>
    props.job.ausgeloest === undefined && !props.umgebung
        ? null
        : herkunftZeile(props.job, props.umgebung, props.nowMs),
);
</script>

<template>
    <li
        class="job-row"
        :class="[`job-row--${state}`]"
        :data-testid="`job-${job.id}`"
        :data-state="state"
        :data-kind="job.kind"
    >
        <span class="job-row__dot" aria-hidden="true"></span>
        <div class="job-row__main">
            <div class="job-row__head">
                <span v-if="queueEntry" class="job-row__position" data-testid="job-position">{{
                    t("status.row.position", { n: queueEntry.position })
                }}</span>
                <span class="job-row__kind">{{ kindText }}</span>
                <span v-if="label" class="job-row__label">{{ label }}</span>
                <span class="job-row__state" data-testid="job-state">{{ t(`status.state.${state}`) }}</span>
            </div>
            <p v-if="meta.length > 0" class="job-row__meta" data-testid="job-meta">{{ meta.join(" · ") }}</p>
            <div
                v-if="running && percent !== null"
                class="job-row__progress"
                role="progressbar"
                :aria-valuenow="percent"
                aria-valuemin="0"
                aria-valuemax="100"
            >
                <span class="job-row__progress-fill" :style="{ width: `${String(percent)}%` }"></span>
            </div>
            <p v-if="wait" class="job-row__sentence" data-testid="job-wait">
                <span class="job-row__lead">{{ wait }}</span>
            </p>
            <p v-if="estimate" class="job-row__meta" data-testid="job-estimate">{{ estimate }}</p>
            <p v-if="herkunft" class="job-row__meta" data-testid="job-herkunft">{{ herkunft }}</p>
            <p v-if="stalled" class="job-row__sentence" data-testid="job-stalled">
                <span class="job-row__lead">{{ t("status.stalled.lead") }}</span> {{ stalled }}
            </p>
            <p v-if="reason" class="job-row__sentence job-row__sentence--reason" data-testid="job-reason">
                {{ reason }}
            </p>
            <p v-if="job.result?.['unchanged'] === true" class="job-row__meta">{{ t("status.row.unchanged") }}</p>
            <p
                v-for="finding in findings"
                :key="finding"
                class="job-row__sentence job-row__sentence--finding"
                data-testid="job-finding"
            >
                {{ finding }}
            </p>
        </div>
    </li>
</template>

<style scoped>
.job-row {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr);
    gap: var(--space-8);
    align-items: start;
    padding: var(--space-6) var(--space-10);
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

/* Der Statuspunkt: Farbe trägt die Bedeutung, nie allein (das Zustandswort steht in der Zeile). */
.job-row__dot {
    width: 12px;
    height: 12px;
    margin-top: 3px;
    border: 2px solid var(--color-text-muted);
    border-radius: 50%;
    box-sizing: border-box;
}

.job-row--RUNNING .job-row__dot {
    border-color: var(--color-accent);
    background: var(--color-accent);
}

.job-row--SUCCEEDED .job-row__dot {
    border-color: var(--color-success);
    background: var(--color-success);
}

.job-row--FAILED .job-row__dot {
    border-color: var(--color-danger);
    background: var(--color-danger);
}

.job-row--CANCELLED .job-row__dot {
    background: var(--color-text-muted);
}

/* Wartend: ein leerer Ring. */
.job-row--QUEUED .job-row__dot {
    background: transparent;
}

/* Hängt: die weiche Warngruppe (Fläche, Kante, Schrift aus einer Familie, Guide §2 Status). */
.job-row--stalled {
    border-color: var(--color-warning-soft-border);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

.job-row--stalled .job-row__dot {
    border-color: var(--color-warning);
    background: var(--color-warning);
}

.job-row__head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    align-items: baseline;
}

.job-row__kind {
    color: var(--color-text-strong);
}

.job-row--stalled .job-row__kind {
    color: inherit;
}

.job-row__position {
    min-width: 2.4em;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.job-row__label,
.job-row__meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.job-row--stalled .job-row__label,
.job-row--stalled .job-row__meta {
    color: inherit;
}

.job-row__state {
    margin-left: auto;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
}

.job-row__meta {
    margin: var(--space-2) 0 0;
}

.job-row__sentence {
    margin: var(--space-4) 0 0;
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

/* Ein Satz, dessen erster Teil hervorgehoben ist: „was ist“ in der kräftigen Akzentfarbe (Guide §13.16). */
.job-row__lead {
    color: var(--color-accent-strong);
}

.job-row--stalled .job-row__lead {
    color: inherit;
}

.job-row__sentence--reason {
    color: var(--color-danger);
}

.job-row--CANCELLED .job-row__sentence--reason {
    color: var(--color-text-muted);
}

.job-row__sentence--finding {
    color: var(--color-warning);
}

.job-row__progress {
    height: 4px;
    margin-top: var(--space-6);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.job-row__progress-fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
    .job-row__progress-fill {
        transition: none;
    }
}
</style>
