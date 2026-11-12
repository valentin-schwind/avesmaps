<script setup lang="ts">
import { computed } from "vue";
import { DESIGN_CANON, labelFamily } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Die Legende der Höhenstufen (WI-0055, Betreiber 2026-09-28, Blatt 3): weiß über dem Kartenfächer, die
 * Stufen wie im Schulatlas von oben (hoch) nach unten (tief), darunter das Gipfeldreieck. Ohne Vermerk
 * „nachgebildet“ (Betreiber: „die hydraulische rechnung ist diesselbe“).
 *
 * Sie steht im Eckbund direkt über dem Fächer: Braucht dessen Unterreihe Platz, wächst der Fächer nach
 * oben, und Legende, Lupe und Auge rücken im Fluss mit (`platzMachen` in `map-fan.vue`).
 *
 * Kein Bedienelement: Sie hat keinen Hover und keinen Fokus, nur Inhalt. Die Farben sind dieselben wie
 * auf der Karte (`colour.mapHeight<i>`) und haben deshalb keinen Dunkelwert (Guide §23.1).
 */
const steps = DESIGN_CANON.topography.heightSteps;
const zeilen = computed(() =>
    steps
        .map((from, index) => {
            const to = steps[index + 1];
            return {
                farbe: `var(--color-map-height${String(index)})`,
                text:
                    to === undefined
                        ? t("legend.height.above", { from: formatNumber(from, 0) })
                        : t("legend.height.range", { from: formatNumber(from, 0), to: formatNumber(to, 0) }),
            };
        })
        .reverse(),
);
const gipfel = labelFamily("peak");
</script>

<template>
    <section
        class="height-legend"
        :aria-label="t('legend.height')"
        :style="{ '--gipfel': gipfel.color, '--gipfel-schatten': gipfel.haloColor }"
        data-testid="height-legend"
    >
        <p class="height-legend__titel">
            {{ t("legend.height") }} <span class="height-legend__einheit">{{ t("legend.height.unit") }}</span>
        </p>
        <ul class="height-legend__stufen">
            <li v-for="zeile in zeilen" :key="zeile.text" class="height-legend__zeile">
                <span class="height-legend__farbe" :style="{ background: zeile.farbe }" aria-hidden="true" />
                <span>{{ zeile.text }}</span>
            </li>
        </ul>
        <p class="height-legend__zeile height-legend__gipfel">
            <span class="height-legend__dreieck" aria-hidden="true" />
            <span>{{ t("legend.height.peaks") }}</span>
        </p>
    </section>
</template>

<style scoped>
/*
 * Bauteilmaße dieser Legende, benannt: die Breite trägt die längste Zeile „3.000–4.000“ mit Farbfeld, das
 * Farbfeld 22 × 11 px wie Legacys Höhenskala im Flächendialog (Blatt 3). Fläche, Kontur, Radius und
 * Schatten wie Fächer und Eckknöpfe (Guide §28.1: Legende 11 px, gedämpft).
 */
.height-legend {
    --legende-breite: 150px;
    --legende-feld-b: 22px;
    --legende-feld-h: 11px;
    --legende-dreieck-b: 5px;
    --legende-dreieck-h: 8px;
    --legende-feld-radius: 2px;
    --legende-zeilenluft: 1px;

    box-sizing: border-box;
    width: var(--legende-breite);
    margin: 0 0 var(--space-4) auto;
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
}

.height-legend__titel {
    margin: 0 0 var(--space-2);
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.height-legend__einheit {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.height-legend__stufen {
    margin: 0;
    padding: 0;
    list-style: none;
}

.height-legend__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin: var(--legende-zeilenluft) 0;
}

.height-legend__farbe {
    flex: none;
    width: var(--legende-feld-b);
    height: var(--legende-feld-h);
    border: 1px solid var(--color-border);
    border-radius: var(--legende-feld-radius);
}

.height-legend__gipfel {
    margin-top: var(--space-2);
}

/* Das Gipfeldreieck wie auf der Karte: in der Farbe des Gipfelnamens, mit dessen dunklem Schatten. */
.height-legend__dreieck {
    flex: none;
    width: 0;
    height: 0;
    margin: 0 calc((var(--legende-feld-b) - 2 * var(--legende-dreieck-b)) / 2);
    border-right: var(--legende-dreieck-b) solid transparent;
    border-bottom: var(--legende-dreieck-h) solid var(--gipfel);
    border-left: var(--legende-dreieck-b) solid transparent;
    filter: drop-shadow(0 1px 1px var(--gipfel-schatten));
}
</style>
