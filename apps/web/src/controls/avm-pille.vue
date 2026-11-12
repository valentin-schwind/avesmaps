<script setup lang="ts">
/**
 * Pille und Etikett (Guide §2 „Etiketten“, §15, §15.2, §18 „Die Editorgruppe trägt ihr Etikett“; WI-0120 A8).
 *
 * - **Vier Töne:** `neutral` trägt die Pillenpalette (`--color-pill*`, „das hier gilt besonders“, etwa „eigenes Konto“
 *   oder „STAGE · Testwelt“), `erfolg`, `warnung` und `gefahr` das weiche Tripel ihrer Statusfarbe. 🔴 Fläche, Kante und
 *   Schrift wandern immer als Satz, die Form nie (§15.2 „Dritter Beleg für das Tripel-Prinzip“).
 * - **Form:** Radius `md`, kein `999px` (§2, §5); 12 px, seitlich 8 px, so hoch wie Legacys Statuschip (21 px, hier die
 *   Sprosse `--space-20`, 22 px). Die Schrift sitzt mit ihrer Versalhöhe mittig (`.avm-versalmitte`, §3.2) und bricht nie
 *   um: Eine Pille ist ein Wort oder zwei, keine Zeile.
 * - **`lokal`** trägt das Tripel der lokalen Entwicklung (`--color-local-soft*`, Petrol; WI-0180, Betreiber 2026-10-16: „lokale
 *   entwicklung braucht auch eine farbe“). Es steht nur an der Umgebungspille.
 * - Keine Zustände: Eine Pille ist eine Angabe, kein Bedienelement. Wird sie anklickbar, ist sie ein eigener Baustein
 *   (`avm-pillenknopf.vue`). 🪤 Guide §15.2 verlangt dann die Linkfarbe für die Schrift; die Umgebungspille behält ihre
 *   Statusfarbe (Betreiber 2026-10-16, WI-0180 §5.2), die Ausnahme kommt nach der Abnahme in den Guide.
 */
defineProps<{
    ton?: "neutral" | "erfolg" | "warnung" | "gefahr" | "lokal" | undefined;
    testid?: string | undefined;
}>();
</script>

<template>
    <span class="pille" :class="`pille--${ton ?? 'neutral'}`" :data-testid="testid">
        <span class="avm-versalmitte"><slot /></span>
    </span>
</template>

<style scoped>
.pille {
    display: inline-flex;
    flex: none;
    align-items: center;
    box-sizing: border-box;
    height: var(--space-20);
    padding: 0 var(--space-6);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-small);
    line-height: 1;
    white-space: nowrap;
}

.pille--erfolg {
    border-color: var(--color-success-soft-border);
    background: var(--color-success-soft);
    color: var(--color-success-soft-text);
}

.pille--warnung {
    border-color: var(--color-warning-soft-border);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
}

.pille--lokal {
    border-color: var(--color-local-soft-border);
    background: var(--color-local-soft);
    color: var(--color-local-soft-text);
}

.pille--gefahr {
    border-color: var(--color-danger-soft-border);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}
</style>
