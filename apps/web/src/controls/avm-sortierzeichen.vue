<script setup lang="ts">
/**
 * Die Zeichen der Sortierung, EINE Familie für jede Liste (Betreiber 2026-10-11: „generell will ich immer allein das sortierung-symbol
 * und das filter-symbol“). Der Sortierknopf ist der Menüknopf des Hauses (`avm-menueknopf.vue`, mit `im-fenster` in einem Fenster); er
 * zeichnet das Zeichen der gewählten Ordnung, und jeder Eintrag seines Menüs trägt seines. Zusammengeführt aus der Ordnung der Stätten
 * (WI-0122, früher `info-panel/staetten-order-zeichen.vue`) und der Medienverwaltung (WI-0068, früher `medien/medien-sort-zeichen.vue`), dieselben
 * Formen: 16 × 16, Strich 1,5, runde Enden, in der Schriftfarbe.
 *
 * Links der Pfeil, „so wird gelesen“; rechts das, wonach:
 * - `name`: A über Z · `menge`: kürzer werdende Balken (Häufigkeit, Verwendungen, Ortsgröße) · `zeit`: eine Uhr (zuletzt geändert)
 * - `haken`: ein Haken (Rechtestand) · `zustand`: der halbe Kreis ◐, das Stilmittel jeder Liste für den Stand eines Eintrags
 * - `art`: drei verschiedene Formen, Quadrat, Kreis und Dreieck (nach Art, Literatur) · `edition`: drei geschichtete Ebenen (nach
 *   Edition oder Ausgabe, Literatur)
 *
 * **Die Richtung ist eine eigene Ordnung**, kein zweites Menü: Braucht eine Liste beide („neueste zuerst“, „älteste zuerst“), sind das
 * zwei Einträge mit demselben Zeichen, beim umgekehrten zeigt der Pfeil nach oben (`umgekehrt`).
 */
defineProps<{
    art: "name" | "menge" | "zeit" | "haken" | "zustand" | "art" | "edition";
    umgekehrt?: boolean | undefined;
}>();
</script>

<template>
    <svg class="sortierzeichen" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
            :d="umgekehrt ? 'M3.5 13.5v-11M1.5 4.5l2-2 2 2' : 'M3.5 2.5v11M1.5 11.5l2 2 2-2'"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
        <path
            v-if="art === 'menge'"
            d="M8 3.5h6M8 8h4.5M8 12.5h3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
        />
        <template v-else-if="art === 'zeit'">
            <circle cx="11" cy="8" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path
                d="M11 5.75V8l1.5 1.25"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </template>
        <path
            v-else-if="art === 'haken'"
            d="M7.75 8.25 10 10.75 14.25 5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
        <template v-else-if="art === 'art'">
            <rect
                x="8.25"
                y="2.25"
                width="3"
                height="3"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
            />
            <circle cx="12.75" cy="3.75" r="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path
                d="M8.5 13.25h5.25l-2.625-4.5Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </template>
        <path
            v-else-if="art === 'edition'"
            d="M8 5l3-1.75L14 5l-3 1.75ZM8 8.5l3 1.75 3-1.75M8 12l3 1.75 3-1.75"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
        <template v-else-if="art === 'zustand'">
            <circle cx="11" cy="8" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path d="M11 3.75a4.25 4.25 0 0 0 0 8.5Z" fill="currentColor" />
        </template>
        <path
            v-else
            d="M8.25 7.25 10.5 2l2.25 5.25M9.1 5.5h2.8M8.5 9.5h4l-4 4.25h4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
    </svg>
</template>

<style scoped>
.sortierzeichen {
    display: block;
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
}
</style>
