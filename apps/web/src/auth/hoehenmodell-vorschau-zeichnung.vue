<script setup lang="ts">
import { SCHEMA, type SchemaFigur } from "./hoehenmodell-vorschau-schema";

/**
 * Eine Zeichnung der Vorschau neben den Werten von „19 (Test)“ (WI-0249): das Schema eines Querschnitts, eines Längsprofils oder, von oben, des
 * Gebirges mit seinen Ästen. Die Fläche unter dem Profil ist leise, das Profil trägt die Akzentfarbe des Editors, gestrichelt steht dasselbe
 * ohne den Wert, und was der Wert verändert, ist dazwischen gefüllt. Die Farben kommen aus dem Kanon; die Zeichnung kippt mit dem Thema.
 */
const props = defineProps<{
    figur: SchemaFigur;
    /** Name für Vorleser; der Satz darunter ist die Beschreibung. */
    beschriftung: string;
    testid: string;
}>();
</script>

<template>
    <svg
        class="zeichnung"
        :viewBox="`0 0 ${String(SCHEMA.breite)} ${String(SCHEMA.hoehe)}`"
        role="img"
        :aria-label="props.beschriftung"
        :data-testid="props.testid"
        preserveAspectRatio="xMidYMid meet"
    >
        <line
            v-if="props.figur.draufsicht !== true"
            class="zeichnung__grund"
            :x1="SCHEMA.links"
            :x2="SCHEMA.rechts"
            :y1="SCHEMA.grund"
            :y2="SCHEMA.grund"
        />
        <path v-if="props.figur.flaeche !== ''" class="zeichnung__flaeche" :d="props.figur.flaeche" />
        <path v-if="props.figur.unterschied !== null" class="zeichnung__unterschied" :d="props.figur.unterschied" />
        <path v-if="props.figur.vorher !== null" class="zeichnung__vorher" :d="props.figur.vorher" />
        <path class="zeichnung__linie" :d="props.figur.linie" />
        <circle
            v-for="(marke, i) in props.figur.marken"
            :key="i"
            class="zeichnung__marke"
            :class="`zeichnung__marke--${marke.art}`"
            :cx="marke.x"
            :cy="marke.y"
            :r="marke.art === 'gipfel' ? 3 : 2.4"
        />
    </svg>
</template>

<style scoped>
.zeichnung {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 2 / 1;
    border-radius: var(--radius-sm);
    background: var(--color-panel);
}

.zeichnung__grund {
    stroke: var(--color-border);
    stroke-width: 1;
}

.zeichnung__flaeche {
    fill: var(--color-panel-soft);
}

/* Was der Wert verändert: dort, wo das Profil mit Wert vom Profil ohne ihn abweicht. */
.zeichnung__unterschied {
    fill: var(--color-warning-soft-border);
    stroke: none;
}

.zeichnung__vorher {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1;
    stroke-dasharray: 3 2;
}

.zeichnung__linie {
    fill: none;
    stroke: var(--color-accent-brown);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
}

.zeichnung__marke {
    fill: var(--color-panel);
    stroke: var(--color-accent-strong);
    stroke-width: 1.5;
}

.zeichnung__marke--neben {
    fill: var(--color-accent-strong);
}
</style>
