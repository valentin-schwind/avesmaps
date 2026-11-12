<script setup lang="ts">
import { computed } from "vue";
import { istVerweisZiel } from "./fenster-text";

/**
 * Ein Verweis nach draußen im Fenster (Guide §13.42): goldbraun, unterstrichen, mit ↗ - den Pfeil setzt seit
 * WI-0107 die Hausregel `a[target="_blank"]::after` in `styles/canon.css`, einmal für das ganze Haus.
 * `FensterText` baut seine `[Text](https://…)` hieraus, und ein Fenster,
 * dessen Ziel aus den Daten kommt (etwa „Hinweise“: Lizenz, Fanrichtlinien, Schriftquellen), nimmt ihn
 * direkt (WI-0045 Stufe B, zweiter Leser).
 *
 * 🔴 Nur http(s) wird ein `href`; alles andere bleibt Text.
 */
const props = defineProps<{ ziel: string; testid?: string | undefined }>();
const sicher = computed(() => istVerweisZiel(props.ziel));
</script>

<template>
    <a
        v-if="sicher"
        class="fenster-verweis"
        :href="props.ziel"
        target="_blank"
        rel="noopener noreferrer"
        :data-testid="props.testid"
        ><slot
    /></a>
    <span v-else :data-testid="props.testid"><slot /></span>
</template>

<style scoped>
.fenster-verweis {
    border-radius: var(--radius-sm);
    color: var(--color-link);
    text-decoration: underline;
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

/*
 * 🪤 Hier steht KEIN Pfeil mehr. Er hing bis WI-0107 an dieser Klasse - also an einem von sechs Orten, und genau das
 * hat der Guide (§13.42) verboten: „Einmal, zentral - nie von Hand je Verweis.“ Jetzt kommt er aus
 * `a[target="_blank"]::after` in `styles/canon.css` und gilt damit auch für jedes Fenster, das es noch nicht gibt.
 */
.fenster-verweis:hover,
.fenster-verweis:active {
    color: var(--color-link-hover);
}

.fenster-verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .fenster-verweis {
        transition: none;
    }
}
</style>
