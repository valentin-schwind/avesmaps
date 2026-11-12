<script setup lang="ts">
import { t } from "../i18n/i18n";
import type { CostFootnote } from "./travel-cost-view";

/**
 * Die Fußnoten unten im Kasten „Reisekosten je Person“ (Betreiber 2026-10-04: „der hinweis könnte als fußnote dastehen“):
 * die Nummer hochgestellt, der Hinweis daneben, jede Zeile hängend, damit ein Umbruch unter dem Text bleibt und nicht
 * unter der Nummer. Nur die Hinweise zu gezeigten Zeilen, nummeriert in der Reihenfolge ihres ersten Auftretens
 * (`footnoteNumbering`). Sie lösen den einen Quellensatz unter dem Kasten ab.
 */
defineProps<{ notes: readonly CostFootnote[] }>();
</script>

<template>
    <ol v-if="notes.length > 0" class="footnotes" role="list" data-testid="cost-footnotes">
        <li v-for="note in notes" :key="note.number" class="footnotes__item" data-testid="cost-footnote">
            <sup class="footnotes__number" aria-hidden="true">{{ note.number }}</sup>
            <span
                ><span class="footnotes__sr">{{ t("planner.cost.fn.label", { n: note.number }) + ": " }}</span
                >{{ note.text }}</span
            >
        </li>
    </ol>
</template>

<style scoped>
/* Woher die Preise stammen: klein, unter einem Trenner (Legacy `.route-plan-costs__source`), jetzt als Liste. */
.footnotes {
    display: flex;
    flex-direction: column;
    /* Ein kleiner Abstand zwischen den Fußnoten (Betreiber 2026-10-04): der kleinste Abstandswert des Kanons. */
    gap: var(--space-2);
    margin: 2px 0 0;
    padding: 6px 0 0;
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: 1.3;
    list-style: none;
}

/*
 * Hängender Einzug: Die Nummer steht in einer festen Spalte, der Text beginnt in jeder Fußnote an derselben Stelle, und
 * eine Folgezeile beginnt bündig unter dem ersten Wort, nicht unter der Nummer (Betreiber 2026-10-04: „den text einheitlich
 * einrücken“). Die Spalte ist fest, weil „1“, „2“ und „3“ verschieden breit sind: sonst begänne der Text je Nummer woanders.
 *
 * 🔴 `position: relative`: Der Text für Screenreader ist absolut gesetzt und braucht seinen Bezugsrahmen in der Fußnote -
 * sonst läge er außerhalb des Rollbereichs der Reiseübersicht und machte das Panel zu einem zweiten Scroll-Container.
 */
.footnotes__item {
    position: relative;
    display: grid;
    grid-template-columns: var(--space-8) minmax(0, 1fr);
    gap: 0 var(--space-2);
}

/* Hell wie die Zahlen der Beträge (Betreiber 2026-10-04); der Text daneben bleibt gedämpft. */
.footnotes__number {
    color: var(--color-text-strong);
    font-size: 0.75em;
    line-height: 1.3;
}

/* Aus dem Bild genommen, nicht versteckt: Der Screenreader liest „Fußnote 1:“ vor dem Hinweis. */
.footnotes__sr {
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
