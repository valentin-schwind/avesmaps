<script setup lang="ts">
import type { Wert } from "./wert";

/**
 * 🔴 DIE Darstellung eines Wertes mit Einheit in jeder Klappbox (Design Guide §16.3 „Die Zahl wird hervorgehoben, das Wort
 * nicht“, als allgemeine Regel für strukturierte Werte, Betreiber 2026-10-04): die **Zahl** in `--color-text-strong` mit
 * `font-variant-numeric: tabular-nums`, die **Einheit** (%, Std., Schritt, D, S, H …) in `--color-text-muted`. Kein Ort setzt
 * Farbe oder Ziffern für Werte selbst: Kopfzeile des Deckels, Geldbeträge, Sätze im Inhalt - alles läuft über diesen
 * Baustein (`AvmText` schneidet die Sätze und reicht jede Zahl hierher). Eine neue Klappbox bekommt die Regel damit von selbst.
 *
 * Mehrere Werte stehen als Reihe („1 D 6 S 8 H“) und bleiben beisammen: ein Wert bricht nie um. Ohne Werte steht `ohne`
 * („—“ bei null Heller, „?“ bei nicht ermittelbar) als gewöhnlicher Text.
 */
defineProps<{ werte: readonly Wert[]; ohne?: string }>();
</script>

<template>
    <span class="wert">
        <template v-if="werte.length > 0">
            <span v-for="(eintrag, index) in werte" :key="index" class="wert__stelle"
                >{{ index > 0 ? " " : "" }}<span v-if="eintrag.zahl" class="wert__zahl">{{ eintrag.zahl }}</span
                >{{ eintrag.abstand
                }}<span v-if="eintrag.einheit" class="wert__einheit">{{ eintrag.einheit }}</span></span
            >
        </template>
        <template v-else>{{ ohne }}</template>
    </span>
</template>

<style scoped>
/* Ein Wert bricht nie um: „4 S 8 H“ und „27 %“ bleiben zusammen, die Zeile darum bricht an ihren Wörtern. */
.wert {
    white-space: nowrap;
}

.wert__zahl {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-bold);
    font-variant-numeric: tabular-nums;
}

.wert__einheit {
    color: var(--color-text-muted);
}
</style>
