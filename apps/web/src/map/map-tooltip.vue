<script setup lang="ts">
import type { LabelSide } from "./route-border-label-placement";

/**
 * 🔴 DIE HÜLLE JEDES KARTENTOOLTIPS (Design Guide §15.3, Rezept „Einen Kartentooltip bauen“).
 *
 * Ein Schild an einer Stelle der Karte: oben der Name, darunter leise, was es ist. Wer so etwas zeigt, nimmt diese Hülle
 * und schreibt keinen eigenen Rahmen, Schatten oder Pfeil; der Prüftest `apps/web/test/map-tooltip-huelle.test.ts` hält
 * das fest. Die Hülle kennt nur das Aussehen und die Bewegung, nicht den Ort: Wo das Schild steht, bestimmt der Anker.
 *
 * Der Anker ist ein Punkt ohne Ausdehnung (0 × 0, `position` gesetzt): ein MapLibre-Marker, der Zeiger, der Ort unter der
 * ziehenden Marke. Das Schild hängt absolut daran, auf der Seite `side` (`top`, `bottom`, `left`, `right`), und die Spitze
 * des Pfeils steht auf jeder Seite `--avm-tooltip-offset` vom Punkt entfernt.
 *
 * - `side`: die Seite. Wer mehrere Schilder setzt, rechnet sie mit `route-border-label-placement.ts`.
 * - `hidden`: ausgeblendet (kurz überblendet). Wer die Hülle ein- und ausbaut, tut das in einer `<Transition>` mit den
 *   Klassen `map-tooltip--leave-active` und `map-tooltip--leave-to`.
 * - Inhalt: der Name im Standard-Slot, die Art oder ein Hinweis als zweite Zeile im Slot `meta`.
 */
withDefaults(defineProps<{ side?: LabelSide; hidden?: boolean }>(), { side: "top", hidden: false });
</script>

<template>
    <div class="map-tooltip" :data-dir="side" :data-hidden="hidden ? '' : undefined">
        <div class="map-tooltip__name"><slot /></div>
        <div v-if="$slots['meta']" class="map-tooltip__meta"><slot name="meta" /></div>
    </div>
</template>

<style scoped>
/*
 * Legacys Zettel an der Karte (`.leaflet-tooltip`): Fläche, Schrift und Pfeil aus den Farben der Oberfläche, also dunkel
 * im dunklen Thema; kein Rahmen, Radius 5, Polster 5 × 20, leichter Schatten, ein Pfeil auf die Stelle. Dazu die zweite
 * Zeile mit der Art (Betreiber 2026-10-03: „ich will alt … gern mit 2. zeile … zentriert“) und kleinere Schrift als Legacy:
 * oben 13 px, unten 11 px, ohne Durchsicht („jetzt machst das obere 13 px und das untere 11 px groß. transparent braucht
 * das tooltip nicht zu sein“), der Pfeil 15 px statt 6. Legacy bricht nie um; die amtlichen Reichsnamen sind dafür zu
 * lang, also erst ab der Lesespalte (`SPECIAL CASE`).
 *
 * Es blendet kurz ein und aus (Betreiber 2026-10-03: „eine kurze ein- und ausblenden animation wär zudem glaub nett“,
 * bestätigt als „Variante 1“): nur die Deckkraft, Einblenden 140 ms, Ausblenden 110 ms, `ease` (Guide §29.2, §30.4). Was
 * verschwindet, darf sich beeilen. Bei reduzierter Bewegung gibt es keinen Übergang (§30.6).
 *
 * 🪤 Die Schrift wird ausdrücklich gesetzt: Ein Anker im MapLibre-Container erbt dessen `12px Helvetica Neue, Arial`.
 * Ohne `font-family` stand das Schild in Arial statt in der Hausschrift (Betreiber 2026-10-03: „schonmal daran gedacht,
 * dass arial die falsche schriftart ist?“).
 */
.map-tooltip {
    --tip-gap: calc(var(--avm-tooltip-offset) + var(--avm-tooltip-arrow));
    position: absolute;
    box-sizing: border-box;
    width: max-content;
    max-width: min(var(--avm-fenster-lesespalte), 80vw);
    padding: var(--avm-tooltip-pad);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-tooltip);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-synthesis-weight: none;
    text-align: center;
    pointer-events: none;
    user-select: none;
    transition:
        opacity 140ms ease,
        visibility 0s;
    animation: map-tooltip-in 140ms ease backwards;
}

/* Ausgeblendet: das Schild bleibt im Bild (die Platzierung misst es weiter), nur unsichtbar. */
.map-tooltip[data-hidden] {
    opacity: 0;
    visibility: hidden;
    transition:
        opacity 110ms ease,
        visibility 0s linear 110ms;
    animation: none;
}

/* Ausbau durch eine `<Transition>` des Aufrufers. */
.map-tooltip--leave-active {
    transition: opacity 110ms ease;
}

.map-tooltip--leave-to {
    opacity: 0;
}

@keyframes map-tooltip-in {
    from {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .map-tooltip,
    .map-tooltip[data-hidden],
    .map-tooltip--leave-active {
        transition: none;
        animation: none;
    }
}

.map-tooltip[data-dir="top"] {
    bottom: 0;
    left: 0;
    transform: translate(-50%, calc(-1 * var(--tip-gap)));
}

.map-tooltip[data-dir="bottom"] {
    top: 0;
    left: 0;
    transform: translate(-50%, var(--tip-gap));
}

.map-tooltip[data-dir="left"] {
    top: 0;
    right: 0;
    transform: translate(calc(-1 * var(--tip-gap)), -50%);
}

.map-tooltip[data-dir="right"] {
    top: 0;
    left: 0;
    transform: translate(var(--tip-gap), -50%);
}

.map-tooltip__name {
    font-size: var(--font-size-body);
    line-height: var(--avm-tooltip-leading);
    overflow-wrap: anywhere;
}

.map-tooltip__meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

/* Der Pfeil trägt die Farbe der Fläche und kippt mit ihr ins Dunkle (Legacy-Fix, `--color-panel`). */
.map-tooltip::after {
    position: absolute;
    border: var(--avm-tooltip-arrow) solid transparent;
    content: "";
}

.map-tooltip[data-dir="top"]::after {
    top: 100%;
    left: 50%;
    margin-left: calc(-1 * var(--avm-tooltip-arrow));
    border-top-color: var(--color-panel);
}

.map-tooltip[data-dir="bottom"]::after {
    bottom: 100%;
    left: 50%;
    margin-left: calc(-1 * var(--avm-tooltip-arrow));
    border-bottom-color: var(--color-panel);
}

.map-tooltip[data-dir="left"]::after {
    top: 50%;
    left: 100%;
    margin-top: calc(-1 * var(--avm-tooltip-arrow));
    border-left-color: var(--color-panel);
}

.map-tooltip[data-dir="right"]::after {
    top: 50%;
    right: 100%;
    margin-top: calc(-1 * var(--avm-tooltip-arrow));
    border-right-color: var(--color-panel);
}
</style>
