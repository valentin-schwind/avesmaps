<script setup lang="ts">
import { t } from "../i18n/i18n";

/**
 * Der Wert einer Entfernungsmessung, mitten auf der Strecke (WI-0095, Guide §17.13, Finding MCS-030).
 *
 * Eine Kapsel ohne Rahmen, mit Schatten, weil sie frei auf der Karte liegt (Guide §16.1). Jeder Wert kommt
 * aus dem Bestand:
 *
 * | Legacy | bei uns |
 * |---|---|
 * | Fläche `#ffffff` | `--color-pill` - die Pille des Hauses, derselbe warme Pergamentton |
 * | Rand 2 px `#8a6644` | **keiner** (Betreiber 2026-10-07: „die pille braucht keinen rahmen") |
 * | Schrift 12 px **fett**, `#4a392c` | `--font-size-small` (12) in `--color-pill-text`, **regulär** (siehe unten) |
 * | Polster 6 / 10 | `--space-4` / `--space-8` (genau 6 und 10) |
 * | Schatten | `--shadow-panel` - der Schatten, mit dem ein Blatt über der Karte steht |
 *
 * 💣 **Die Schrift wird ausdrücklich gesetzt, sonst steht die Pille in ARIAL.** Sie hängt an einem
 * MapLibre-Marker, also im Kartencontainer, und der trägt `12px "Helvetica Neue", Arial` - gemessen am
 * 2026-10-07: `font-family` der Pille `"Helvetica Neue", Arial, Helvetica, sans-serif`, während `body`
 * schon `"Faculty Glyphic"` sagt. Genau diese Falle hat der Kartentooltip 2026-10-03 einmal gekostet
 * (Guide §15.3, Betreiber: „schonmal daran gedacht, dass arial die falsche schriftart ist?"), und sie
 * wiederholt sich an jedem Bauteil, das im Kartencontainer hängt. `--font-ui` ist dieselbe Schrift, aus
 * der auch die Kartennamen entstehen: `scripts/dev/build-glyphs.mjs` baut deren SDF-Stapel aus derselben
 * TTF-Vorlage (Kanon `typography.fontFamily` und `typography.mapFontStack`).
 *
 * 🔴 **Kein `font-weight`.** Die Hausschrift bringt nur den Regular mit; ein Gewicht darüber lässt den
 * Browser die Fettung FÄLSCHEN, und `canon.css` schaltet das appweit ab (`font-synthesis-weight: none`).
 * Legacys Etikett ist `font-weight: bold` - hier war es mit `font-synthesis-weight: auto` wieder
 * zugelassen und wurde damit gerechnet statt gezeichnet (gemessen: `font-weight: 700`,
 * `font-synthesis-weight: auto`). Betont wird in diesem Haus über Farbe, nicht über Gewicht (Guide §3).
 *
 * 🪤 **Kein Kartentooltip** (Guide §15.3): Die Kapsel benennt keine Stelle, sie zeigt einen Messwert, und
 * sie hat keinen Pfeil - sie sitzt MITTEN auf der Strecke. Deshalb bekommt sie ihre eigene Hülle und
 * meidet `--shadow-tooltip`, `--avm-tooltip-*` und die Klasse `.map-tooltip`.
 *
 * 🪤 **Sie nimmt keinen Zeiger an** (`pointer-events: none`, Legacy ebenso): Ziehen und Klicken gehen
 * durch auf die Karte, sonst verdeckte sie den Klick, der den zweiten Punkt setzt.
 */
defineProps<{ text: string }>();
</script>

<template>
    <span class="measure-value" :aria-label="t('measure.label', { value: text })" data-testid="measure-value">
        <!-- Die Versalhöhe sitzt in der Mitte der Kapsel (Hausregel Guide §3.2, `.avm-versalmitte` aus `canon.css`). -->
        <span class="avm-versalmitte">{{ text }}</span>
    </span>
</template>

<style scoped>
.measure-value {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: var(--space-4) var(--space-8);
    /* Eine Kapsel: die Form, nicht ein Maß - wie `border-radius: 50%` an einem Kreis. */
    border-radius: 999px;
    background: var(--color-pill);
    box-shadow: var(--shadow-panel);
    color: var(--color-pill-text);
    /* 💣 Ohne diese Zeile erbt die Pille Arial aus dem MapLibre-Container (siehe oben). */
    font-family: var(--font-ui);
    font-size: var(--font-size-small);
    font-synthesis-weight: none;
    line-height: var(--leading-tight);
    pointer-events: none;
    text-align: center;
    white-space: nowrap;
}
</style>
