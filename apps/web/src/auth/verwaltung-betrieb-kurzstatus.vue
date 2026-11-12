<script setup lang="ts">
/**
 * „Betrieb im Moment“ (WI-0127 SYS-5; SYS-0001 §6.2; Blatt WI-0119 A1, A4): vier Statuspunkte (Karte, Anmeldung, Routenrechner,
 * Warteschlange), darunter Release, wie alt der Stand ist, und der Verweis auf die Statusseite, die eigene Seite bleibt (E6). Die
 * Werte rechnet `kurzstatus` aus dem Kurzstatus des Servers (`brief`); am Telefon stehen die Punkte untereinander.
 */
import { computed, inject } from "vue";
import type { AdminSystemBrief } from "@avesmaps3d/shared";
import AvmStatus from "../controls/avm-status.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { kurzstatus, vorText } from "./betriebszustand";
import { ZEIGE_ANSICHT } from "./verwaltung";

/** Im Verwaltungsfenster schaltet „Statusseite“ auf die Ansicht im selben Fenster (Betreiber 2026-10-11); sonst bleibt der Verweis. */
const zeigeAnsicht = inject(ZEIGE_ANSICHT, null);

const props = defineProps<{
    brief: AdminSystemBrief;
    /** Was seit der Antwort vergangen ist (ms, Uhr des Browsers). */
    seitAntwort: number;
    jetzt: number;
    telefon: boolean;
    /** Ob die Warteschlange pausiert ist (WI-0160): Die Zeile sagt es dann zuerst. */
    queuePaused?: boolean;
}>();

const zeilen = computed(() => kurzstatus(props.brief, props.queuePaused === true));
const release = computed(() =>
    t("admin.system.brief.release", {
        release: props.brief.releaseId,
        time: relativeTime(new Date(props.brief.startedAt), new Date(props.jetzt), locale.value, "zeitpunkt"),
    }),
);
</script>

<template>
    <FensterKarte :titel="t('admin.system.brief.title')" data-testid="betrieb-kurzstatus">
        <div class="kurz__punkte" :class="{ 'kurz__punkte--telefon': props.telefon }">
            <AvmStatus
                v-for="zeile in zeilen"
                :key="zeile.id"
                :ton="zeile.ton"
                :text="zeile.text"
                :testid="`betrieb-status-${zeile.id}`"
            />
        </div>
        <div class="kurz__fuss" data-testid="betrieb-stand">
            <span>{{ release }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ t("admin.system.brief.age", { vor: vorText(props.seitAntwort) }) }}</span>
            <button
                v-if="zeigeAnsicht !== null"
                type="button"
                class="kurz__verweis kurz__verweis--knopf"
                data-testid="betrieb-statusseite"
                @click="zeigeAnsicht('statusseite')"
            >
                {{ t("admin.system.brief.statusPage") }}
            </button>
            <a
                v-else
                class="kurz__verweis"
                href="/status.html"
                target="_blank"
                rel="noopener"
                data-testid="betrieb-statusseite"
                >{{ t("admin.system.brief.statusPage") }}</a
            >
        </div>
    </FensterKarte>
</template>

<style scoped>
.kurz__punkte {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-16);
}

.kurz__punkte--telefon {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-6);
}

.kurz__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Der Verweis steht rechts (Blatt A1); ↗ setzt die Hausregel an `target="_blank"` (canon.css). */
.kurz__verweis {
    margin-left: auto;
    border-radius: var(--radius-sm);
    color: var(--color-link);
    text-decoration: none;
    transition: color 120ms ease;
}

/* Im Fenster ein Knopf, der wie der Verweis aussieht: er schaltet auf die Statusseite im selben Fenster. */
.kurz__verweis--knopf {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
}

.kurz__verweis:hover {
    color: var(--color-link-hover);
}

.kurz__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .kurz__verweis {
        transition: none;
    }
}
</style>
