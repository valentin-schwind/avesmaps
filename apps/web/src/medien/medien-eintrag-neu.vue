<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import type { BindbareRolle } from "./medien-formular-modell";

/**
 * „↥ Neues Wappen hochladen“ bzw. „↥ Neues Titelbild hochladen“ in der Trefferspalte (WI-0068 P4b, Schritt 7): dieselbe Gestalt wie ein
 * Treffer (`medien-eintrag.vue`, Kachel im Raster, Zeile in der Liste), gestrichelt und in der Farbe der Aufschriften wie die letzte
 * Zeile der Auswahl (Gesamtmockup 7). Sie steht VORN, nicht hinten: Die Medienverwaltung lädt Seiten zu 100 von 2.500 Treffern, am Ende
 * fände man sie nicht.
 *
 * Dieselbe Kachel mit der Rolle `eintrag` ist „✚ Neuer Eintrag“ oben in der Liste der Kartensammlung (WI-0287): das Zeichen ✚ statt ↥, weil nichts hochgeladen,
 * sondern ein Eintrag angelegt wird.
 */
const props = defineProps<{ rolle: BindbareRolle | "eintrag"; ansicht: "raster" | "liste" }>();
const emit = defineEmits<{ hochladen: [] }>();
/** Im Raster kürzt die Kachel die Aufschrift; der Hinweis beim Überfahren trägt sie ganz. */
const name = computed(() =>
    t(
        props.rolle === "eintrag"
            ? "medien.karten.eintrag.kachel"
            : props.rolle === "coat"
              ? "medien.auswahl.neuWappen"
              : "medien.auswahl.neuBild",
    ),
);
</script>

<template>
    <button
        type="button"
        class="medien-neu"
        :class="`medien-neu--${ansicht}`"
        :title="name"
        :data-testid="rolle === 'eintrag' ? 'medien-karten-neu' : `medien-hochladen-${rolle}`"
        @click="emit('hochladen')"
    >
        <span class="medien-neu__bild" aria-hidden="true">{{ rolle === "eintrag" ? "✚" : "↥" }}</span>
        <span class="medien-neu__text">
            <span class="medien-neu__name einzeilig">{{ name }}</span>
            <span class="medien-neu__l2 einzeilig">{{
                t(rolle === "eintrag" ? "medien.karten.eintrag.kachelFelder" : "medien.auswahl.neuFelder")
            }}</span>
        </span>
    </button>
</template>

<style scoped>
/* Maße und Zustände wie ein Treffer (`medien-eintrag.vue`), die Kante gestrichelt (Gesamtmockup 7, „↥ Neues … hochladen“). */
.medien-neu {
    box-sizing: border-box;
    display: flex;
    min-width: 0;
    width: 100%;
    margin: 0;
    padding: var(--avm-row-pad);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-accent-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.medien-neu--liste {
    flex-direction: row;
    align-items: center;
    gap: var(--space-6);
}

.medien-neu--raster {
    flex-direction: column;
    gap: var(--space-4);
}

.medien-neu:hover {
    border-color: var(--color-accent);
    background: var(--color-hover-wash);
}

.medien-neu:active {
    background: var(--color-active-wash);
}

.medien-neu:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-neu__bild {
    display: grid;
    flex: none;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    font-size: var(--font-size-title);
}

.medien-neu--liste .medien-neu__bild {
    width: var(--avm-fenster-daumen);
    height: var(--avm-fenster-daumen);
}

.medien-neu--raster .medien-neu__bild {
    width: 100%;
    aspect-ratio: 1;
}

.medien-neu__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    width: 100%;
}

.medien-neu__name {
    font-size: var(--font-size-body);
}

.medien-neu--raster .medien-neu__name {
    font-size: var(--font-size-small);
}

.medien-neu__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .medien-neu {
        transition: none;
    }
}
</style>
