<script setup lang="ts">
import type { Kreis } from "../editor-liste/liste-modell";

/**
 * Der Statuskreis jeder Liste (AGENTS.md „Editor: abstrakte Zeichen, der Kreis und Legacys Listen“, Betreiber 2026-10-10: „die sind
 * wichtig für jegliche art von listen“; Guide §13.17 „Der Statuskreis“; Legacy `css/components/map-status-circle.css`).
 *
 * - EIN Ton (`--color-map-presence`), EIN Maß (`--avm-kreis`, Ring `--avm-kreis-ring`), die Stufen nur über den Füllgrad:
 *   ○ `leer` (fehlt), ◐ `halb` (teilweise, linke Hälfte), ◑ `halb-rechts` (die zweite Hälfte, wo eine Liste zwei kennt), ● `voll`.
 *   Vier Töne wären vier Bedeutungen, die man lernen muss (§13.17).
 * - 🔴 Was die Stufen in einer Liste HEISSEN, entscheidet die Liste und sagt es in einer Legende; hier steht nur, wie der Kreis
 *   aussieht. In den Listen der Editoren steht sie unter der Liste, je Zustand Name, Kreis und Zahl (WI-0187, `editor-liste.vue`); die
 *   Ortsliste kennt alle vier Füllungen (`kreisVon` in `orte-liste.ts`). Die Farbe kippt nicht mit dem Thema (Legacy: „deliberately identical in both themes“).
 * - Er trägt seinen Namen für Vorleser (`name`), denn die Füllung allein sagt nichts.
 */
const props = defineProps<{
    /** `gestrichelt` (◌): gepunkteter Ring ohne Fläche, für „verborgen“ in der Liste der Bewertungen (WI-0269). */
    fuellung: Kreis | "gestrichelt";
    name: string;
    testid?: string | undefined;
}>();
</script>

<template>
    <span
        class="avm-kreis"
        :class="`avm-kreis--${props.fuellung}`"
        role="img"
        :aria-label="props.name"
        :title="props.name"
        :data-kreis="props.fuellung"
        :data-testid="props.testid"
    ></span>
</template>

<style scoped>
.avm-kreis {
    display: inline-block;
    flex: none;
    box-sizing: border-box;
    width: var(--avm-kreis);
    height: var(--avm-kreis);
    border: var(--avm-kreis-ring) solid var(--color-map-presence);
    border-radius: 50%;
    background: var(--color-panel);
}

.avm-kreis--halb {
    background: linear-gradient(to right, var(--color-map-presence) 0 50%, var(--color-panel) 50% 100%);
}

.avm-kreis--halb-rechts {
    background: linear-gradient(to right, var(--color-panel) 0 50%, var(--color-map-presence) 50% 100%);
}

.avm-kreis--voll {
    background: var(--color-map-presence);
}

/* ◌ verborgen (Bewertungen, WI-0269): gepunkteter Ring ohne Fläche. */
.avm-kreis--gestrichelt {
    border-style: dotted;
    background: none;
}
</style>
