<script setup lang="ts">
import { computed } from "vue";
import type { GemeinsamerAuftrag } from "@avesmaps3d/shared";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import { dataLabel, formatDuration, secondsSince } from "./format";
import { prozentVon, umgebungName, umgebungTon, warteText } from "./gemeinsam-view";
import { herkunftZeile, phaseText } from "./job-view";

/**
 * Ein Auftrag der ANDEREN Umgebung in der gemeinsamen Reihe (WI-0163 §1.7): dieselbe Zeile wie `job-row.vue`, mit der Umgebung als
 * Pille im Ton der Kopfleiste (Stage gelb, Production grün). 🔴 Er trägt nur, was der Server über ihn weiß: Umgebung, Art,
 * Bezeichnung, Platz, Zustand, Grund, Fortschritt und den Auslöser (Art, bei einer Person ihr Anzeigename; WI-0293); keine Kennung,
 * keine Zahlen der anderen Tafel.
 */

const props = defineProps<{
    auftrag: GemeinsamerAuftrag;
    /** „Jetzt“ in Serverzeit, ms. */
    nowMs: number;
}>();

const kindLabel = computed(() => dataLabel("status.kind", props.auftrag.kind));
/** Die Bezeichnung nur, wenn sie mehr sagt als die Jobart. */
const label = computed(() =>
    props.auftrag.label !== null && props.auftrag.label !== kindLabel.value ? props.auftrag.label : null,
);
const umgebung = computed(() => umgebungName(props.auftrag.umgebung));
const wartet = computed(() => props.auftrag.state === "QUEUED");
const prozent = computed(() => (wartet.value ? null : prozentVon(props.auftrag.progress)));
/** Wer, wann, wo (WI-0293): vom Auslöser nur die Art, nie die Person der anderen Umgebung. */
const herkunft = computed(() => herkunftZeile(props.auftrag, props.auftrag.umgebung, props.nowMs));
const meta = computed(() => {
    const teile: string[] = [];
    if (props.auftrag.phase !== null) teile.push(phaseText(props.auftrag.kind, props.auftrag.phase));
    const seit = secondsSince(props.auftrag.startedAt, props.nowMs);
    if (!wartet.value && seit !== null) teile.push(t("status.row.since", { time: formatDuration(seit) }));
    return teile;
});
</script>

<template>
    <li
        class="fremd-row"
        :class="`fremd-row--${auftrag.state}`"
        :data-state="auftrag.state"
        :data-kind="auftrag.kind"
        :data-umgebung="auftrag.umgebung"
        data-testid="job-fremd"
    >
        <span class="fremd-row__dot" aria-hidden="true"></span>
        <div class="fremd-row__main">
            <div class="fremd-row__head">
                <span v-if="wartet && auftrag.platz !== null" class="fremd-row__position" data-testid="job-position">{{
                    t("status.row.position", { n: auftrag.platz })
                }}</span>
                <span class="fremd-row__kind">{{ kindLabel }}</span>
                <span v-if="label" class="fremd-row__label">{{ label }}</span>
                <AvmPille
                    :ton="umgebungTon(auftrag.umgebung)"
                    :title="t('status.foreign.label', { umgebung })"
                    testid="job-umgebung"
                    >{{ umgebung }}</AvmPille
                >
                <span class="fremd-row__state" data-testid="job-state">{{ t(`status.state.${auftrag.state}`) }}</span>
            </div>
            <p v-if="meta.length > 0" class="fremd-row__meta">{{ meta.join(" · ") }}</p>
            <div
                v-if="prozent !== null"
                class="fremd-row__progress"
                role="progressbar"
                :aria-valuenow="prozent"
                aria-valuemin="0"
                aria-valuemax="100"
            >
                <span class="fremd-row__progress-fill" :style="{ width: `${String(prozent)}%` }"></span>
            </div>
            <p v-if="wartet" class="fremd-row__sentence" data-testid="job-wait">
                <span class="fremd-row__lead">{{ warteText(auftrag.waitReason, auftrag.notBefore, nowMs) }}</span>
            </p>
            <p class="fremd-row__meta" data-testid="job-herkunft">{{ herkunft }}</p>
        </div>
    </li>
</template>

<style scoped>
/* Dieselbe „Listenzeile als Karte“ wie `job-row.vue` (Guide §10, §13.13), damit beide Umgebungen in einer Liste gleich aussehen. */
.fremd-row {
    display: grid;
    grid-template-columns: var(--avm-kreis) minmax(0, 1fr);
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

/* Der Statuspunkt: wartend ein leerer Ring, laufend gefüllt; das Zustandswort steht immer daneben. */
.fremd-row__dot {
    width: var(--avm-kreis);
    height: var(--avm-kreis);
    margin-top: var(--space-2);
    border: var(--avm-kreis-ring) solid var(--color-text-muted);
    border-radius: 50%;
    box-sizing: border-box;
}

.fremd-row--RUNNING .fremd-row__dot {
    border-color: var(--color-accent);
    background: var(--color-accent);
}

.fremd-row__head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    align-items: center;
}

.fremd-row__kind {
    color: var(--color-text-strong);
}

.fremd-row__position,
.fremd-row__label,
.fremd-row__meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.fremd-row__state {
    margin-left: auto;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
}

.fremd-row__meta {
    margin: var(--space-2) 0 0;
}

.fremd-row__sentence {
    margin: var(--space-4) 0 0;
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.fremd-row__lead {
    color: var(--color-accent-strong);
}

.fremd-row__progress {
    height: var(--space-4);
    margin-top: var(--space-6);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.fremd-row__progress-fill {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
    .fremd-row__progress-fill {
        transition: none;
    }
}
</style>
