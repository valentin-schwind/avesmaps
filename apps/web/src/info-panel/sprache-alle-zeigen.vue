<script setup lang="ts">
import { computed, inject } from "vue";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { SPRACH_LEUCHTEN_ZUGANG } from "../map/sprachen-leuchten";
import type { AlleZeigenModel } from "./panel-types";

/**
 * „Alle zeigen“ in der Infobox einer Sprache (WI-0261 S5c; Bauvorlage: die Probierseite, `ib-alle`, „● Alle zeigen · N Gegenden“): Es schaltet das Leuchten der Flächen der Sprache um und fliegt beim
 * Einschalten auf ihre Hauptteile. Dasselbe Bild wie „Alle zeigen“ in der Infobox eines Vorkommens (`info-eintrag.vue`): eine Zeile in der Liste der Auswahl, davor ● in der Farbe der Auswahl, solange es
 * leuchtet.
 *
 * Die Sprache leuchtet, sobald ihre Infobox aufgeht (Karte, Legende, Menü, Suche, Link); der Zustand gehört der App (`SPRACH_LEUCHTEN_ZUGANG`), die Zeile liest und schaltet ihn nur. Ohne Zugang
 * (das Bauteil allein) zeigt sie sich ungedrückt und tut nichts.
 */
const props = defineProps<{ model: AlleZeigenModel }>();
const zugang = inject(SPRACH_LEUCHTEN_ZUGANG, undefined);

const leuchtet = computed(() => zugang?.schluessel.value.includes(props.model.schluessel) === true);

function schalte(): void {
    zugang?.schalte(props.model.schluessel, {
        ref: props.model.ref,
        ...(props.model.target === undefined ? {} : { target: props.model.target }),
    });
}
</script>

<template>
    <ul class="sprache-alle" data-testid="sprache-alle">
        <li>
            <button
                type="button"
                class="sprache-alle__row"
                :class="{ 'is-markiert': leuchtet }"
                :aria-pressed="leuchtet"
                data-testid="sprache-alle-zeigen"
                @click="schalte"
            >
                <span class="sprache-alle__marke" aria-hidden="true">{{ leuchtet ? "●" : "" }}</span>
                <span class="sprache-alle__name">{{ t("sprache.alleZeigen") }}</span>
                <span class="sprache-alle__zahl" data-testid="sprache-alle-zahl">{{
                    tPlural("search.ziel.gegenden", model.gegenden, { n: formatNumber(model.gegenden, 0) })
                }}</span>
            </button>
        </li>
    </ul>
</template>

<style scoped>
/*
 * Die Liste ist ein Kasten wie die Auswahlliste der Vorkommen: Fläche `panel-soft`, 1 px Rand, die Zeile darin. Seitlich bündig mit den Zeilen darunter
 * (Betreiber 2026-10-31: „die richtige breite einnehmen“): Das Polster trägt der Abschnitt, wie bei „Wo es vorkommt“; der Abstand nach unten ist der
 * zwischen zwei Zeilen.
 */
.sprache-alle {
    margin: 0 0 var(--space-10);
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    list-style: none;
}

.sprache-alle__row {
    display: grid;
    grid-template-columns: 1em minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-6);
    box-sizing: border-box;
    width: 100%;
    min-height: var(--avm-control-h);
    padding: var(--space-2) var(--space-8);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    text-align: left;
    transition: background-color 120ms ease;
}

.sprache-alle__row:hover {
    background: var(--color-hover-wash);
}

.sprache-alle__row:active {
    background: var(--color-active-wash);
}

.sprache-alle__row:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.sprache-alle__marke {
    color: var(--color-list-selection-text);
    font-size: var(--font-size-caption);
}

.sprache-alle__name {
    min-width: 0;
    color: var(--color-text-strong);
}

.sprache-alle__zahl {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

/* Gedrückt (es leuchtet): Schrift in der Farbe der Auswahl, davor ●. */
.sprache-alle__row.is-markiert .sprache-alle__name {
    color: var(--color-list-selection-text);
}

@media (prefers-reduced-motion: reduce) {
    .sprache-alle__row {
        transition: none;
    }
}
</style>
