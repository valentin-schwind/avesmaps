<script setup lang="ts">
import AvmKreis from "../controls/avm-kreis.vue";
import type { Kreis } from "./aenderung-modell";

/**
 * Der Statuskreis einer Zeile in „Änderungen“ (Hausregel „der Kreis ist das Stilmittel jeder Liste“, Design Guide §13.17): ● wirksam und
 * rücknehmbar, ◐ eine Serie, von der einige Mitglieder schon zurückgenommen sind, ○ zurückgenommen. Der Kreis des Hauses (`AvmKreis`) hat
 * drei Füllungen; „nicht rücknehmbar“ (Import, WikiSync, Anlegen) ist ein vierter Zustand und zeichnet sich hier als durchgestrichener
 * Kreis in demselben Maß und Ton. Er trägt seinen Namen (`name`), denn die Füllung allein sagt nichts; das Wort steht zusätzlich daneben.
 */
const props = defineProps<{ kreis: Kreis; name: string }>();
</script>

<template>
    <span
        v-if="props.kreis === 'gesperrt'"
        class="aenderung-kreis"
        role="img"
        :aria-label="props.name"
        :title="props.name"
        data-kreis="gesperrt"
    ></span>
    <AvmKreis v-else :fuellung="props.kreis" :name="props.name" />
</template>

<style scoped>
.aenderung-kreis {
    position: relative;
    display: inline-block;
    flex: none;
    box-sizing: border-box;
    width: var(--avm-kreis);
    height: var(--avm-kreis);
    border: var(--avm-kreis-ring) solid var(--color-border-strong);
    border-radius: 50%;
    background: var(--color-panel-muted);
}

.aenderung-kreis::after {
    content: "";
    position: absolute;
    top: 50%;
    right: -1px;
    left: -1px;
    height: var(--avm-kreis-ring);
    margin-top: calc(var(--avm-kreis-ring) / -2);
    background: var(--color-text-muted);
    transform: rotate(-45deg);
}
</style>
