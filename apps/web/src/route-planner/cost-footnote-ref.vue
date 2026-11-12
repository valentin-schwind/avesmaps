<script setup lang="ts">
import { t } from "../i18n/i18n";

/**
 * Die hochgestellte Nummer einer Fußnote an einem Wert des Kastens „Reisekosten je Person“ (Betreiber 2026-10-04). Sichtbar
 * ist die Zahl; ein Screenreader liest „Fußnote 1“ (die Zahl allein sagte ihm nichts). Die Fußnote selbst steht unten im
 * Kasten (`costs.footnotes`).
 */
defineProps<{ number: number }>();
</script>

<template>
    <sup class="fnref" data-testid="cost-fn-ref" :data-fn="number"
        ><span aria-hidden="true">{{ number }}</span
        ><span class="fnref__sr">{{ t("planner.cost.fn.label", { n: number }) }}</span></sup
    >
</template>

<style scoped>
/*
 * Hochgestellt, ohne die Zeile höher zu machen (`line-height: 0`): Die Zeilenhöhe des Kastens bleibt die der Wörter.
 * Ein kleiner Abstand trennt die Nummer vom Wert davor. Hell wie die Zahlen der Beträge (Betreiber 2026-10-04: „fußnotenzahle
 * hell machen wie die andern zahlen“): `--color-text-strong`, im Dunkeln der helle Ton.
 *
 * 🔴 `position: relative`: Der Text für Screenreader unten ist absolut gesetzt. Hätte er keinen eigenen Bezugsrahmen, wäre
 * das Panel sein Bezugsrahmen, und er läge außerhalb des Rollbereichs der Reiseübersicht - das Panel bekäme einen zweiten
 * Scrollbalken, sobald der Kostenkasten offen ist (Betreiber 2026-10-04).
 */
.fnref {
    position: relative;
    margin-inline-start: 1px;
    color: var(--color-text-strong);
    font-size: 0.75em;
    line-height: 0;
    vertical-align: super;
}

/* Aus dem Bild genommen, nicht versteckt: Der Screenreader liest „Fußnote 1“ (wie `.display-menu__state`). */
.fnref__sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
