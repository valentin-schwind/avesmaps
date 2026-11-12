<script setup lang="ts">
import { computed } from "vue";
import type { JobsOverview } from "@avesmaps3d/shared";
import FremdRow from "./fremd-row.vue";
import JobRow from "./job-row.vue";
import { formatMb } from "./format";
import { gemeinsameAbschnitte, unbekanntSatz } from "./gemeinsam-view";
import { pauseSatz, zeitlicheFolge } from "./job-view";
import { t } from "../i18n/i18n";

/**
 * Der Reiter „Warteschlange“ (JOBS-0001 5.2): läuft, hängt, wartet (Position, Grund, geschätzte Zeit oder „unbekannt“), zuletzt fertig,
 * fehlgeschlagen. Dazu das Speicherbudget als Kennzahlenliste (Design Guide §13.16: Beschriftung links, Wert rechts).
 *
 * 🔴 Ist die Warteschlange pausiert (WI-0160), steht das GANZ OBEN — vor dem fehlenden Planer, denn es ist die stärkere Aussage, und
 * sie erklärt jede wartende Zeile darunter. Geschaltet wird hier nicht: Die Seite ist nur lesend, der Schalter steht in der
 * Verwaltung unter „Betriebszustand“ (mit Recht, Passkey und Protokolleintrag).
 *
 * 🔴 **Die gemeinsame Warteschlange** (WI-0163): Mit dem Stand des Dirigenten stehen die Aufträge der anderen Umgebung in denselben
 * Abschnitten, mit ihrer Umgebung als Pille und ihrem Auslöser (`fremd-row.vue`); die wartenden in der Reihenfolge der gemeinsamen
 * Reihe. Ist der Stand unbekannt, steht das oben, und der Satz zum fehlenden Planer entfällt: Er wäre dann eine Vermutung.
 */

const props = defineProps<{ overview: JobsOverview; nowMs: number }>();

/** Hängende Jobs stehen in ihrem eigenen Abschnitt und nicht noch einmal unter „läuft“; mit Stand dazu die der anderen Umgebung. */
const abschnitte = computed(() => gemeinsameAbschnitte(props.overview));
const running = computed(() => abschnitte.value.running);
const queued = computed(() => abschnitte.value.queued);
// Erledigt und fehlgeschlagen in EINER zeitlichen Folge, neueste zuerst (Betreiber 2026-10-15).
const finished = computed(() => zeitlicheFolge(props.overview.recent, props.overview.failed));

/**
 * Die Umgebung dieser Tafel für „wo“ in jeder eigenen Zeile (WI-0293); ein älterer Server nennt sie nur in der gemeinsamen Reihe, ganz ohne
 * Stand gar nicht.
 */
const umgebung = computed(() => props.overview.umgebung ?? props.overview.gemeinsam?.umgebung ?? null);

/** „Zustand der Warteschlange unbekannt.“, wenn der Dirigent keinen frischen Stand hat. */
const unbekannt = computed(() => unbekanntSatz(props.overview.gemeinsam, props.nowMs));

/** Wie voll das Budget ist, in Prozent (für die Leiste). */
const bookedPercent = computed(() => {
    if (props.overview.memory === null) return null;
    const { bookedMb, budgetMb } = props.overview.memory;
    return budgetMb === null || budgetMb === 0 ? null : Math.min(100, Math.round((bookedMb / budgetMb) * 100));
});

/** Ohne Planer starten wartende Jobs nicht: Das ist der eine Fall, den die Seite deutlich sagen muss. */
const plannerMissing = computed(
    () =>
        unbekannt.value === null &&
        !props.overview.plannerActive &&
        props.overview.queued.length > 0 &&
        !props.overview.queuePause.paused,
);

/** „Pausiert seit heute, 14:05 · Rondrikan · „Datenbank wird gesichert““; `null`, wenn die Warteschlange läuft. */
const pausiert = computed(() => pauseSatz(props.overview.queuePause, props.nowMs));
</script>

<template>
    <div class="queue-tab" data-testid="queue-tab">
        <p v-if="pausiert !== null" class="queue-tab__notice" data-testid="queue-paused">
            <span class="queue-tab__lead">{{ pausiert.lead }}</span> {{ pausiert.satz }}
        </p>
        <p v-if="unbekannt !== null" class="queue-tab__notice" data-testid="queue-unknown">
            <span class="queue-tab__lead">{{ unbekannt.lead }}</span> {{ unbekannt.satz }}
        </p>
        <p v-if="plannerMissing" class="queue-tab__notice" data-testid="planner-missing">
            <span class="queue-tab__lead">{{ t("status.planner.none.lead") }}</span> {{ t("status.planner.none") }}
        </p>

        <p v-if="overview.view === 'own'" class="queue-tab__own" data-testid="status-own">{{ t("status.own") }}</p>
        <section
            v-if="overview.memory !== null"
            class="queue-tab__block"
            :aria-label="t('status.memory.title')"
            data-testid="memory"
        >
            <h2 class="queue-tab__heading">{{ t("status.memory.title") }}</h2>
            <dl class="queue-tab__facts">
                <dt>{{ t("status.memory.booked") }}</dt>
                <dd data-testid="memory-booked">
                    {{ formatMb(overview.memory.bookedMb) }}
                    <template v-if="overview.memory.budgetMb !== null">
                        {{ t("status.memory.ofBudget", { budget: formatMb(overview.memory.budgetMb) }) }}</template
                    >
                </dd>
                <dt>{{ t("status.memory.free") }}</dt>
                <dd data-testid="memory-free">
                    {{ formatMb(overview.memory.availableMb) }}
                    <template v-if="overview.memory.availFloorMb !== null">
                        {{ t("status.memory.floor", { floor: formatMb(overview.memory.availFloorMb) }) }}</template
                    >
                </dd>
                <dt>{{ t("status.memory.swap") }}</dt>
                <dd>{{ formatMb(overview.memory.swapUsedMb) }}</dd>
                <dt>{{ t("status.planner.label") }}</dt>
                <dd data-testid="planner-state">
                    {{ overview.plannerActive ? t("status.planner.active") : t("status.planner.idle") }}
                </dd>
            </dl>
            <div
                v-if="bookedPercent !== null"
                class="queue-tab__bar"
                role="img"
                :aria-label="t('status.memory.barLabel', { percent: bookedPercent })"
            >
                <span class="queue-tab__bar-fill" :style="{ width: `${String(bookedPercent)}%` }"></span>
            </div>
            <p v-if="overview.memory.rolloutActive" class="queue-tab__sentence" data-testid="rollout-active">
                <span class="queue-tab__lead">{{ t("status.memory.rollout.lead") }}</span>
                {{ t("status.memory.rollout") }}
            </p>
        </section>

        <section class="queue-tab__block" aria-labelledby="queue-running">
            <h2 id="queue-running" class="queue-tab__heading">
                {{ t("status.section.running", { n: running.length }) }}
            </h2>
            <ul v-if="running.length > 0" class="queue-tab__list" data-testid="running-list">
                <template v-for="eintrag in running" :key="eintrag.key">
                    <JobRow v-if="eintrag.art === 'eigen'" :job="eintrag.job" :now-ms="nowMs" :umgebung="umgebung" />
                    <FremdRow v-else :auftrag="eintrag.auftrag" :now-ms="nowMs" />
                </template>
            </ul>
            <p v-else class="queue-tab__empty" data-testid="running-empty">{{ t("status.empty.running") }}</p>
        </section>

        <section v-if="overview.stalled.length > 0" class="queue-tab__block" aria-labelledby="queue-stalled">
            <h2 id="queue-stalled" class="queue-tab__heading">
                {{ t("status.section.stalled", { n: overview.stalled.length }) }}
            </h2>
            <ul class="queue-tab__list" data-testid="stalled-list">
                <JobRow v-for="job in overview.stalled" :key="job.id" :job="job" :now-ms="nowMs" :umgebung="umgebung" />
            </ul>
        </section>

        <section class="queue-tab__block" aria-labelledby="queue-queued">
            <h2 id="queue-queued" class="queue-tab__heading">
                {{ t("status.section.queued", { n: queued.length }) }}
            </h2>
            <ul v-if="queued.length > 0" class="queue-tab__list" data-testid="queued-list">
                <template v-for="eintrag in queued" :key="eintrag.key">
                    <JobRow v-if="eintrag.art === 'eigen'" :job="eintrag.job" :now-ms="nowMs" :umgebung="umgebung" />
                    <FremdRow v-else :auftrag="eintrag.auftrag" :now-ms="nowMs" />
                </template>
            </ul>
            <p v-else class="queue-tab__empty" data-testid="queued-empty">{{ t("status.empty.queued") }}</p>
        </section>

        <!-- Betreiber 2026-10-15: „mach die fehlgeschlagenen und die "zuletzt fertig" in zeitlicher folge - nicht thematisch trennen“.
             Eine Liste, neueste zuerst; ein fehlgeschlagener Auftrag erkennt man an seinem Zustand in der Zeile. -->
        <section class="queue-tab__block" aria-labelledby="queue-recent">
            <h2 id="queue-recent" class="queue-tab__heading">
                {{ t("status.section.recent", { n: finished.length }) }}
            </h2>
            <ul v-if="finished.length > 0" class="queue-tab__list" data-testid="recent-list">
                <JobRow v-for="job in finished" :key="job.id" :job="job" :now-ms="nowMs" :umgebung="umgebung" />
            </ul>
            <p v-else class="queue-tab__empty" data-testid="recent-empty">{{ t("status.empty.recent") }}</p>
        </section>
    </div>
</template>

<style scoped>
.queue-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
}

.queue-tab__block {
    min-width: 0;
}

/* Abschnittsüberschrift: gedämpft, mit Zähler in Klammern (Guide §10). */
.queue-tab__heading {
    margin: 0 0 var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.queue-tab__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
}

.queue-tab__empty {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

/* Die Kennzahlenliste: Beschriftung links, Wert rechtsbündig (Guide §13.16). */
.queue-tab__facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-10);
    margin: 0;
    font-size: var(--font-size-body);
}

.queue-tab__facts dt {
    color: var(--color-text-muted);
}

.queue-tab__facts dd {
    margin: 0;
    color: var(--color-text-strong);
    text-align: right;
}

.queue-tab__bar {
    height: 6px;
    margin-top: var(--space-8);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.queue-tab__bar-fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

/* Ein Hinweis ist Fließtext, hervorgehoben nur sein erster Satz: kein Kasten, kein Symbol (Guide §13.16). */
/* Die eigene Sicht eines Editors (WI-0120 A11): ein leiser Satz, was hier fehlt und warum Wartezeiten trotzdem stimmen. */
.queue-tab__own {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.queue-tab__notice,
.queue-tab__sentence {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.queue-tab__sentence {
    margin-top: var(--space-8);
}

.queue-tab__lead {
    color: var(--color-accent-strong);
}

@media (prefers-reduced-motion: reduce) {
    .queue-tab__bar-fill {
        transition: none;
    }
}
</style>
