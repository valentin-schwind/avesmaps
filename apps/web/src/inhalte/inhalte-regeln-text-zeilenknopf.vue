<script setup lang="ts">
import { t } from "../i18n/i18n";
import { zeilenText } from "./inhalte-regeln-text-modell";

/**
 * „Z. 5“ oder „Z. 5–6“ in der Vorschau von „Regeln als Text“ (WI-0254 §13): ein Klick wählt die Zeilen im Textfeld aus und rollt sie in den Blick. `von` und `bis` zählen ab 0 (Zeilen des Vertrags); der Text
 * zeigt sie ab 1, wie die Nummern am Rand.
 */
defineProps<{ von: number; bis: number }>();
const emit = defineEmits<{ markiere: [von: number, bis: number] }>();
</script>

<template>
    <button
        type="button"
        class="tx-zeilenknopf"
        :title="t('inhalte.vorkommen.text.zeileMarkieren')"
        data-testid="inhalte-text-zeile"
        @click="emit('markiere', von, bis)"
    >
        {{ zeilenText(von, bis) }}
    </button>
</template>

<style scoped>
.tx-zeilenknopf {
    min-height: 20px;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.tx-zeilenknopf:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.tx-zeilenknopf:active {
    background: var(--color-active-wash);
}

.tx-zeilenknopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (pointer: coarse) {
    .tx-zeilenknopf {
        min-height: 32px;
        padding: 0 var(--space-4);
    }
}

@media (prefers-reduced-motion: reduce) {
    .tx-zeilenknopf {
        transition: none;
    }
}
</style>
