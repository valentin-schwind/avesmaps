<script setup lang="ts">
import { t } from "../i18n/i18n";
import type { Verbinder } from "./umgebungen-leiste";

/**
 * Die Leiste „Lokal → Stage → Production“ (WI-0248; Vali: „je nachdem wo man ist, soll die jeweilige umgebung markiert sein … unter dem
 * pfeil von stage und production ist die abnahme, unter dem pfeil von localhost zu stage könnte der Release-Test sein … die 3 boxen in
 * allen ansichten da und sogar gleich groß“). Das Bauteil legt nur aus; was in den Stationen und unter den Pfeilen steht, kommt aus den
 * Slots (`verwaltung-umgebungen.vue`).
 *
 * - **Fünf Spalten:** Station, Fuge, Station, Fuge, Station. In der Fuge liegt der Pfeil mit seiner kurzen Beschriftung (der Push, die
 *   wartenden Themen); die drei Stationen sind gleich breit und gleich hoch (feste Höhe `--station-hoehe`, `umgebungen-station.vue`).
 * - **Unter dem Pfeil:** Eine Zeile darunter hängt je eine Zelle MITTIG unter der Fuge, so breit wie eine Station (links der Release-Test,
 *   rechts die Abnahme). Ein dünner Stiel führt vom Pfeil zur Zelle; er liegt hinter ihr (die Zelle hat eine deckende Fläche).
 * - **Schmal** (Telefon, schmales Fenster): alles untereinander, der Pfeil senkrecht zwischen Station und Zelle.
 */
defineProps<{ push: Verbinder; freigabe: Verbinder }>();
</script>

<template>
    <div class="leiste" role="group" :aria-label="t('admin.umgebungen.leiste')" data-testid="umgebungen-leiste">
        <div class="platz platz--lokal"><slot name="lokal" /></div>

        <span
            class="verbinder verbinder--push"
            :class="`verbinder--${push.art}`"
            :title="push.titel"
            data-testid="umgebungen-verbinder-push"
        >
            <span class="verbinder__pfeil"></span>
            <span class="verbinder__stiel"></span>
            <span class="verbinder__text">{{ push.text }}</span>
        </span>

        <div class="platz platz--test"><slot name="test" /></div>
        <div class="platz platz--stage"><slot name="stage" /></div>

        <span
            class="verbinder verbinder--freigabe"
            :class="`verbinder--${freigabe.art}`"
            :title="freigabe.titel"
            data-testid="umgebungen-verbinder"
        >
            <span class="verbinder__pfeil"></span>
            <span class="verbinder__stiel"></span>
            <span class="verbinder__text">{{ freigabe.text }}</span>
        </span>

        <div class="platz platz--abnahme"><slot name="abnahme" /></div>
        <div class="platz platz--production"><slot name="production" /></div>
    </div>
</template>

<style scoped>
.leiste {
    --pfeil-hoehe: calc(var(--space-10) + var(--space-20) / 2);
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--fuge) minmax(0, 1fr) var(--fuge) minmax(0, 1fr);
    grid-template-rows: auto auto;
    row-gap: var(--space-10);
    min-width: 0;
}

/* Jeder Platz streckt seinen Inhalt auf die ganze Zelle: gleich hohe Stationen (feste Höhe), gleich hohe Zellen. */
.platz {
    display: grid;
    min-width: 0;
}

.platz--lokal {
    grid-column: 1;
    grid-row: 1;
}

.platz--stage {
    grid-column: 3;
    grid-row: 1;
}

.platz--production {
    grid-column: 5;
    grid-row: 1;
}

/* Die Zellen unter den Pfeilen: so breit wie eine Station, mittig unter der Fuge (Spalten 1 bis 3 beziehungsweise 3 bis 5). */
.platz--test,
.platz--abnahme {
    grid-row: 2;
    z-index: 1;
    justify-self: center;
    width: calc((100% - var(--fuge)) / 2);
}

.platz--test {
    grid-column: 1 / 4;
}

.platz--abnahme {
    grid-column: 3 / 6;
}

/* --- Pfeil in der Fuge, Stiel zur Zelle darunter --- */

.verbinder {
    position: relative;
    grid-row: 1 / 3;
    z-index: 0;
    color: var(--color-border-strong);
}

.verbinder--push {
    grid-column: 2;
}

.verbinder--freigabe {
    grid-column: 4;
}

.verbinder__pfeil {
    position: absolute;
    top: var(--pfeil-hoehe);
    right: 0;
    left: 0;
    height: 2px;
    background: currentColor;
}

.verbinder__pfeil::after {
    position: absolute;
    top: calc(1px - var(--space-2));
    right: 1px;
    border-top: var(--space-2) solid transparent;
    border-bottom: var(--space-2) solid transparent;
    border-left: var(--space-4) solid currentColor;
    content: "";
}

/* Der Stiel von der Mitte des Pfeils bis zur Zelle; ihre deckende Fläche verdeckt den Rest. */
.verbinder__stiel {
    position: absolute;
    top: var(--pfeil-hoehe);
    bottom: 0;
    left: calc(50% - 0.5px);
    width: 1px;
    background: var(--color-border-strong);
}

.verbinder--offen .verbinder__pfeil {
    background: repeating-linear-gradient(
        90deg,
        currentColor 0 var(--space-2),
        transparent var(--space-2) var(--space-6)
    );
}

.verbinder--lauf {
    color: var(--color-success);
}

.verbinder--lauf .verbinder__pfeil {
    background: repeating-linear-gradient(
        90deg,
        currentColor 0 var(--space-4),
        transparent var(--space-4) var(--space-10)
    );
    background-size: var(--space-10) 2px;
    animation: fliessen 0.5s linear infinite;
}

@keyframes fliessen {
    to {
        background-position: var(--space-10) 0;
    }
}

.verbinder__text {
    position: absolute;
    top: calc(var(--pfeil-hoehe) - var(--space-4));
    left: 50%;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    transform: translate(-50%, -100%);
    white-space: nowrap;
}

.verbinder--lauf .verbinder__text {
    color: var(--color-success-soft-text);
}

/*
 * --- Schmal: alles untereinander, der Pfeil senkrecht zwischen Station und Zelle ---
 * Gemessen wird die Breite der Ansicht (`.umgebungen` in `verwaltung-umgebungen.vue`), nicht die des Bildschirms: Das Fenster der Systemsteuerung
 * ist auch am Rechner schmal, und eine Station braucht gut 250 px (der Rückweg von Production ist ein einzeiliger Knopf).
 */

@container umgebungen (max-width: 879px) {
    .leiste {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: none;
        row-gap: 0;
    }

    .platz--lokal,
    .platz--stage,
    .platz--production,
    .platz--test,
    .platz--abnahme,
    .verbinder--push,
    .verbinder--freigabe {
        grid-column: 1;
        grid-row: auto;
    }

    .platz--test,
    .platz--abnahme {
        justify-self: stretch;
        width: auto;
    }

    .platz--test,
    .platz--abnahme {
        margin-bottom: var(--space-10);
    }

    .verbinder {
        height: var(--space-24);
    }

    .verbinder__pfeil {
        top: 0;
        right: auto;
        bottom: 0;
        left: calc(50% - 1px);
        width: 2px;
        height: auto;
    }

    .verbinder--offen .verbinder__pfeil {
        background: repeating-linear-gradient(
            180deg,
            currentColor 0 var(--space-2),
            transparent var(--space-2) var(--space-6)
        );
    }

    .verbinder__pfeil::after {
        top: auto;
        right: auto;
        bottom: -1px;
        left: calc(1px - var(--space-2));
        border-top: var(--space-4) solid currentColor;
        border-right: var(--space-2) solid transparent;
        border-bottom: 0;
        border-left: var(--space-2) solid transparent;
    }

    .verbinder__stiel {
        display: none;
    }

    .verbinder__text {
        top: 50%;
        left: calc(50% + var(--space-10));
        transform: translateY(-50%);
    }
}

@media (prefers-reduced-motion: reduce) {
    .verbinder--lauf .verbinder__pfeil {
        animation: none;
    }
}
</style>
