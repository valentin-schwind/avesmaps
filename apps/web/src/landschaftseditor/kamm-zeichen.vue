<script setup lang="ts">
/**
 * Die Zeichen der Kamm-Leiste (WI-0245, Mockup des Betreibers 2026-10-21: „eine Zeile nur Zeichen“): derselbe gezeichnete Satz wie die
 * Zeichen der Editoren (`controls/editor-zeichen.vue`: 16 × 16, Strich 1,5, runde Enden, `currentColor`); der Name steht als Tooltip am
 * Knopf. Hauptkamm und Nebenkamm tragen ihre Linie wie auf der Karte (durchgezogen, gestrichelt). „Höhen beschriften“ (WI-0249 P9) ist ein
 * Schild über einem Punkt.
 */
export type KammZeichenName =
    | "kamm"
    | "nebengipfel"
    | "tal"
    | "mulde"
    | "waehlen"
    | "hauptkamm"
    | "nebenkamm"
    | "hoehe"
    | "beschriftung"
    | "loeschen"
    | "leeren"
    | "ziel"
    | "plus"
    | "minus"
    | "auge"
    | "zurueck"
    | "wieder"
    | "verwerfen"
    | "fertig"
    | "info"
    | "typ";

defineProps<{ name: KammZeichenName }>();
</script>

<template>
    <svg
        class="kamm-zeichen"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        <polyline v-if="name === 'kamm'" points="3,11 8,5.5 13,11" />
        <path v-else-if="name === 'tal'" d="M2 4L8 12L14 4" />
        <path v-else-if="name === 'mulde'" d="M2 4l6 9 6-9z" />
        <path v-else-if="name === 'nebengipfel'" d="M8 3l6 10H2z" />
        <path v-else-if="name === 'waehlen'" d="M4 2.5v10l2.8-2.6 1.9 4 1.8-.8-1.9-3.9H12.5z" />
        <path v-else-if="name === 'hauptkamm'" d="M2 12Q8 1.5 14 12" />
        <path v-else-if="name === 'nebenkamm'" d="M2 12Q8 1.5 14 12" stroke-dasharray="1.6 2.2" />
        <path v-else-if="name === 'hoehe'" d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" />
        <path v-else-if="name === 'beschriftung'" d="M2.5 2.5h11v5h-4L8 9.5 6.5 7.5h-4zM5 5h6" />
        <path v-else-if="name === 'loeschen' || name === 'leeren'" d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4" />
        <circle v-if="name === 'ziel'" cx="8" cy="8" r="4.5" />
        <path v-if="name === 'ziel'" d="M8 1v3M8 12v3M1 8h3M12 8h3" />
        <circle v-if="name === 'plus' || name === 'minus' || name === 'info'" cx="8" cy="8" r="6.5" />
        <path v-if="name === 'plus'" d="M8 5v6M5 8h6" />
        <path v-if="name === 'minus'" d="M5 8h6" />
        <path v-if="name === 'info'" d="M8 7.5v4" />
        <circle v-if="name === 'info'" cx="8" cy="5" r=".6" fill="currentColor" />
        <path v-if="name === 'loeschen'" d="M6.8 6.5v4.5M9.2 6.5v4.5" />
        <path v-if="name === 'leeren'" d="M6.3 7l3.4 3.8M9.7 7l-3.4 3.8" />
        <template v-if="name === 'auge'">
            <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
            <circle cx="8" cy="8" r="2" />
        </template>
        <path v-if="name === 'zurueck'" d="M5.5 3L2.5 6l3 3M2.5 6H10a3.5 3.5 0 010 7H8" />
        <path v-if="name === 'wieder'" d="M10.5 3l3 3-3 3M13.5 6H6a3.5 3.5 0 000 7h2" />
        <path v-if="name === 'verwerfen'" d="M4 4l8 8M12 4l-8 8" />
        <path v-if="name === 'fertig'" d="M3 8.5L6.5 12 13 4" />
        <path v-if="name === 'typ'" d="M1.5 13L6 6l2.5 3.5L10.5 7l4 6z" />
        <circle v-if="name === 'beschriftung'" cx="8" cy="13" r="1.3" fill="currentColor" />
    </svg>
</template>

<style scoped>
.kamm-zeichen {
    display: block;
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
}
</style>
