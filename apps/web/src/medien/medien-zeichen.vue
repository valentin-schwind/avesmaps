<script setup lang="ts">
/**
 * Die Zeichen der Leiste der Medienverwaltung (WI-0068 P4b; Betreiber 2026-10-10: „versuch so viel in icons zu packen wie möglich“,
 * Skizze „Fit“ und „Fill“): abstrakt und in der Schriftfarbe gezeichnet (`currentColor`), keine Bildsymbole (Hausregel der
 * Backend-Knöpfe). Der Name steht beim Knopf, nicht hier.
 *
 * - `raster`: vier Kacheln; `liste`: drei Zeilen;
 * - `ganz` (fit, contain): Rahmen, darin das kleinere Bild mit Rand; `fuellen` (fill, cover): das Bild steht über den Rahmen hinaus.
 *
 * Den Trichter und die Zeichen der Sortierung zeichnen die Bauteile des Hauses (`controls/avm-filterknopf.vue`,
 * `controls/avm-sortierzeichen.vue`, Guide §13.45).
 */
defineProps<{ name: "raster" | "liste" | "ganz" | "fuellen" }>();
</script>

<template>
    <svg class="medien-zeichen" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <template v-if="name === 'raster'">
            <rect x="2" y="2" width="5" height="5" rx="0.75" fill="currentColor" />
            <rect x="9" y="2" width="5" height="5" rx="0.75" fill="currentColor" />
            <rect x="2" y="9" width="5" height="5" rx="0.75" fill="currentColor" />
            <rect x="9" y="9" width="5" height="5" rx="0.75" fill="currentColor" />
        </template>
        <template v-else-if="name === 'liste'">
            <rect x="2" y="3" width="12" height="2" rx="0.75" fill="currentColor" />
            <rect x="2" y="7" width="12" height="2" rx="0.75" fill="currentColor" />
            <rect x="2" y="11" width="12" height="2" rx="0.75" fill="currentColor" />
        </template>
        <template v-else-if="name === 'ganz'">
            <rect x="5" y="6" width="6" height="4" fill="currentColor" fill-opacity="0.45" />
            <rect x="1.75" y="3.75" width="12.5" height="8.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        </template>
        <template v-else>
            <rect x="0.5" y="2" width="15" height="12" fill="currentColor" fill-opacity="0.45" />
            <rect x="2.75" y="4.25" width="10.5" height="7.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        </template>
    </svg>
</template>

<style scoped>
.medien-zeichen {
    display: block;
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
}
</style>
