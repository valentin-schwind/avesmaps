<script setup lang="ts">
import { computed } from "vue";

/**
 * Der Kopf über Zoomspannen (`zoomspanne.vue`; Wunsch der Sitzung „kartenverwaltung“ 2026-10-18): die Bandzahlen 0 bis `oben` im selben
 * Raster wie die Zellen darunter (je Band eine Spalte, 1 px Abstand), EIN Kopf über vielen Zeilen. So fluchten die Zahlen immer (der
 * Betreiber am Entwurf des Reiters „Zoombänder“: „die zahlen nicht passen“).
 *
 * - Ein Klick auf eine Zahl meldet das Band (`band`), etwa „zeige Band n auf der Karte“ oder die Vorschau `markiert` der Spannen.
 * - `leise(b)` dämpft eine Zahl (die Gebiete: Bänder über dem, was die Karte zeichnet); `titel(b)` erklärt sie.
 */
const props = withDefaults(
    defineProps<{
        oben?: number;
        markiert?: number | undefined;
        titel?: ((band: number) => string) | undefined;
        leise?: ((band: number) => boolean) | undefined;
        /** Die Beschriftung der Gruppe (aria). */
        beschriftung: string;
        testid?: string | undefined;
    }>(),
    { oben: 8 },
);
const emit = defineEmits<{ band: [band: number] }>();

const baender = computed(() => Array.from({ length: props.oben + 1 }, (_, b) => b));
</script>

<template>
    <span
        class="zsk"
        role="group"
        :aria-label="beschriftung"
        :style="{ '--zs-baender': oben + 1 }"
        :data-testid="testid"
    >
        <button
            v-for="b in baender"
            :key="b"
            type="button"
            class="zsk__b"
            :class="{ 'zsk__b--leise': leise?.(b), 'zsk__b--markiert': markiert === b }"
            :title="titel?.(b)"
            :data-band="b"
            :aria-pressed="markiert === undefined ? undefined : markiert === b"
            @click="emit('band', b)"
        >
            {{ b }}
        </button>
    </span>
</template>

<style scoped>
/* Dasselbe Raster wie die Zellen der Spanne (`zoomspanne.vue`). */
.zsk {
    display: grid;
    grid-template-columns: repeat(var(--zs-baender), minmax(0, 1fr));
    gap: calc(var(--space-2) / 4);
}

.zsk__b {
    padding: 0;
    border: 0;
    border-radius: calc(var(--space-2) / 2);
    background: none;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    text-align: center;
}

.zsk__b:hover {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.zsk__b:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.zsk__b--leise {
    color: var(--color-text-muted);
}

.zsk__b--markiert {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
    font-weight: 600;
}
</style>
