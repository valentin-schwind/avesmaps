<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import { vorkommenFarbeCss } from "../search/vorkommen-farben";
import EditorZeichen, { type EditorZeichenName } from "./editor-zeichen.vue";

/**
 * Die Plakette eines Vorkommens (WI-0257): sein Kategoriezeichen in EINEM Kreis, an jeder Stelle gleich - Suche, Kopf der Infobox, Pille am Telefon,
 * Sammelscreen und „Vorkommen unterwegs“. Betreiber 2026-10-31 zu den bis dahin fünf Rahmen: „mal sind die rund, mal quadratisch mit ecken mit ohne
 * irgendwas“; an der Probierseite `review/vorkommen-zeichen/` wählte er Fassung A (Antwortknopf „A Kreis“).
 *
 * - **Gleich:** Kreis, 1-px-Kante, neutrale Fläche, das Zeichen in Schriftfarbe. Nur die Größe folgt dem Ort: `l` 42 px (Kopf), `p` 38 (Pille),
 *   `m` 22 (Suche, Listen), `s` 18 (in einer Textzeile).
 * - **Farbig nur mit `platz`,** wenn das Vorkommen auf der Karte in seiner Farbe leuchtet: Kante in der Farbe, Fläche getönt, das Zeichen zur Schrift hin
 *   gemischt - im hellen Thema dunkler, im dunklen heller, so bleiben auch die dunklen Plätze der Tafel lesbar. Die Farbe sagt nie etwas allein; der Name daneben tut es.
 * - **Ohne `zeichen`** hält eine leere Plakette die Stelle, solange die Art noch nicht bekannt ist: Der Name daneben springt nicht, wenn sie kommt.
 * - **Auf fremdem Grund** (die immer dunkle Suche) setzt der Ort `--plakette-kante`, `--plakette-grund` und `--plakette-schrift`.
 *
 * Die Karte zeichnet das Zeichen ohne Plakette, wie einen Buchstaben vor dem Namen (`map/vorkommen-zeichen-bild.ts`).
 */
const props = defineProps<{
    zeichen?: EditorZeichenName | undefined;
    groesse: "s" | "m" | "p" | "l";
    platz?: number | undefined;
}>();

const farbPlatz = computed(() => (props.platz !== undefined && props.platz > 0 ? props.platz : undefined));
const stil = computed(() =>
    farbPlatz.value === undefined ? undefined : { "--plakette-farbe": vorkommenFarbeCss(farbPlatz.value) },
);
</script>

<template>
    <span
        class="vorkommen-plakette"
        :class="[`is-${groesse}`, { 'is-farbig': farbPlatz !== undefined, 'is-leer': zeichen === undefined }]"
        :style="stil"
        :title="farbPlatz === undefined ? undefined : t('vorkommen.farbe')"
        :data-platz="farbPlatz"
        aria-hidden="true"
        data-testid="vorkommen-plakette"
        ><EditorZeichen v-if="zeichen !== undefined" :name="zeichen"
    /></span>
</template>

<style scoped>
.vorkommen-plakette {
    display: inline-grid;
    flex: none;
    place-items: center;
    box-sizing: border-box;
    width: var(--plakette-mass);
    height: var(--plakette-mass);
    border: 1px solid var(--plakette-kante, var(--color-border-strong));
    border-radius: 50%;
    background: var(--plakette-grund, var(--color-panel-soft));
    color: var(--plakette-schrift, var(--color-text-strong));
    vertical-align: middle;
}

.vorkommen-plakette :deep(.editor-zeichen) {
    width: var(--plakette-zeichen);
    height: var(--plakette-zeichen);
}

/* 42 / 26: so hoch wie Titel und Untertitel im Kopf zusammen. */
.is-l {
    --plakette-mass: calc(var(--icon-xxl) - var(--space-4));
    --plakette-zeichen: calc(var(--icon-lg) + var(--space-2) / 2);
}

/* 38 / 20: in der runden Pille am Telefon. */
.is-p {
    --plakette-mass: calc(var(--icon-lg) + var(--space-12));
    --plakette-zeichen: var(--icon-md);
}

/* 22 / 14: vor einem Namen in einer Liste. */
.is-m {
    --plakette-mass: calc(var(--icon-sm) + var(--space-4));
    --plakette-zeichen: calc(var(--icon-sm) - var(--space-2) / 2);
}

/* 18 / 12: in einer Textzeile, die einzeilig bleiben muss (Deckel, Reiter, Kästchen). */
.is-s {
    --plakette-mass: var(--icon-kachel);
    --plakette-zeichen: calc(var(--icon-sm) - var(--space-2));
}

.is-farbig {
    border-color: var(--plakette-farbe);
    background: color-mix(in srgb, var(--plakette-farbe) 16%, var(--color-panel));
    color: color-mix(in srgb, var(--plakette-farbe) 72%, var(--color-text-strong));
}

.is-leer {
    border-color: transparent;
    background: transparent;
}
</style>
