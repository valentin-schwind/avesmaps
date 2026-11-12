<script setup lang="ts">
/**
 * Eine Zeile der Lage im Reiter „WikiSync“ in Legacys Listenform, wie die Zeilen des Reiters „Legacy“ (`auth/verwaltung-abgleiche.vue`): Name mit
 * Kreis, darunter die Unterzeile im Ton der Lage und ein leiser Satz, was die Zeile tut; rechts die Knöpfe über alle drei Zeilen. Darunter, was zur
 * Zeile gehört (Balken, Rückfrage, Meldung, Auswahl). Am Telefon rutschen die Knöpfe unter die Zeile.
 */
import AvmKreis from "../controls/avm-kreis.vue";
import type { Kreis, Ton } from "./wikisync-text";

defineProps<{
    name: string;
    kreis?: Kreis | undefined;
    kreisName?: string | undefined;
    unter: string;
    ton: Ton;
    telefon: boolean;
    /** Ein Fortschritt in Prozent für den Balken unter der Zeile; `null`: kein Balken. */
    prozent?: number | null | undefined;
    testid: string;
}>();
</script>

<template>
    <li class="wsync-zeile" :class="{ 'wsync-zeile--telefon': telefon }" :data-testid="testid">
        <div class="wsync-zeile__raster">
            <span class="wsync-zeile__name">
                <span class="wsync-zeile__text">{{ name }}</span>
                <AvmKreis
                    v-if="kreis !== undefined"
                    :fuellung="kreis"
                    :name="kreisName ?? ''"
                    :testid="`${testid}-kreis`"
                />
            </span>
            <span class="wsync-zeile__unter" :class="`wsync-zeile__unter--${ton}`" :data-testid="`${testid}-unter`">{{
                unter
            }}</span>
            <span class="wsync-zeile__was"><slot name="was" /></span>
            <span v-if="$slots.knopf" class="wsync-zeile__knopf"><slot name="knopf" /></span>
        </div>
        <div
            v-if="prozent !== null && prozent !== undefined"
            class="wsync-zeile__balken"
            role="progressbar"
            :aria-valuenow="prozent"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="name"
        >
            <span class="wsync-zeile__fuellung" :style="{ width: `${String(prozent)}%` }"></span>
        </div>
        <div v-if="$slots.default" class="wsync-zeile__folge"><slot /></div>
    </li>
</template>

<style scoped>
.wsync-zeile {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-8) var(--space-10);
}

.wsync-zeile + .wsync-zeile {
    border-top: 1px solid var(--color-divider);
}

.wsync-zeile__raster {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-12);
    row-gap: var(--space-2);
    align-items: center;
}

.wsync-zeile__name {
    grid-row: 1;
    grid-column: 1;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.wsync-zeile__unter {
    grid-row: 2;
    grid-column: 1;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.wsync-zeile__unter--gut {
    color: var(--color-success-soft-text);
}

.wsync-zeile__unter--warnung {
    color: var(--color-warning-soft-text);
}

.wsync-zeile__unter--fehler {
    color: var(--color-danger-soft-text);
}

.wsync-zeile__was {
    grid-row: 3;
    grid-column: 1;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.wsync-zeile__knopf {
    grid-row: 1 / span 3;
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-4);
    max-width: calc(var(--avm-field-label-w) * 2.5);
}

.wsync-zeile__balken {
    height: 4px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.wsync-zeile__fuellung {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

.wsync-zeile__folge {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.wsync-zeile--telefon .wsync-zeile__raster {
    grid-template-columns: minmax(0, 1fr);
}

.wsync-zeile--telefon .wsync-zeile__knopf {
    grid-row: 4;
    grid-column: 1;
    justify-content: stretch;
    max-width: none;
    margin-top: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
    .wsync-zeile__fuellung {
        transition: none;
    }
}
</style>
