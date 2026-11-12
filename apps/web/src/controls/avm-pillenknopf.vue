<script setup lang="ts">
/**
 * Die anklickbare Pille (WI-0180): dieselbe Gestalt wie `AvmPille` (Guide §2 „Etiketten“, §15), aber ein Bedienelement. `AvmPille`
 * sagt selbst: Wird eine Pille anklickbar, ist sie ein eigener Baustein. Heute trägt ihn die Umgebungspille der Kopfleiste.
 *
 * - **Link oder Knopf:** Mit `href` ist sie ein echter Link (`<a>`), damit Strg+Klick und Mittelklick daneben öffnen, wie bei jedem
 *   Link; ohne ist sie ein `<button>` (etwa der Auslöser eines Menüs, mit `aria-haspopup` und `aria-expanded` vom Aufrufer).
 * - **Töne** wie `AvmPille`: Fläche, Kante und Schrift wandern als Satz. 🪤 Guide §15.2 gibt einem anklickbaren Statuschip die
 *   Linkfarbe; die Umgebungspille behält ihre Statusfarbe (Betreiber 2026-10-16, WI-0180 §5.2). Die Ausnahme trägt der Guide nach
 *   der Abnahme nach (`9b92eba7`).
 * - **Zustände nach Guide §30.5:** Ruhe; Hover legt eine Lasur über die Fläche (§30.1 „geschichtet, nicht gesetzt“), gedrückt und
 *   offen die dunklere; Fokus nur über die Tastatur mit dem Ring des Hauses; 120 ms `ease`, bei reduzierter Bewegung ohne Übergang.
 *   Nie Deckkraft (§30.2).
 * - Das Zeichen (▾, ⇄) steht im Slot `zeichen` NEBEN der Schrift, nicht in ihr: Die Schrift sitzt auf der Versalhöhe mittig
 *   (`.avm-versalmitte`, §3.2), ein Zeichen darin verschöbe sie.
 */
defineProps<{
    ton?: "neutral" | "erfolg" | "warnung" | "gefahr" | "lokal" | undefined;
    href?: string | undefined;
    testid?: string | undefined;
}>();
</script>

<template>
    <component
        :is="href === undefined ? 'button' : 'a'"
        class="pillenknopf"
        :class="`pillenknopf--${ton ?? 'neutral'}`"
        :type="href === undefined ? 'button' : undefined"
        :href="href"
        :data-testid="testid"
    >
        <span class="avm-versalmitte"><slot /></span>
        <span v-if="$slots.zeichen" class="pillenknopf__zeichen" aria-hidden="true"><slot name="zeichen" /></span>
    </component>
</template>

<style scoped>
.pillenknopf {
    --p-bg: var(--color-pill);
    --p-rand: var(--color-pill-border);
    --p-text: var(--color-pill-text);
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    box-sizing: border-box;
    height: var(--space-20);
    margin: 0;
    padding: 0 var(--space-4) 0 var(--space-6);
    border: 1px solid var(--p-rand);
    border-radius: var(--radius-md);
    background-color: var(--p-bg);
    color: var(--p-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.pillenknopf--erfolg {
    --p-bg: var(--color-success-soft);
    --p-rand: var(--color-success-soft-border);
    --p-text: var(--color-success-soft-text);
}

.pillenknopf--warnung {
    --p-bg: var(--color-warning-soft);
    --p-rand: var(--color-warning-soft-border);
    --p-text: var(--color-warning-soft-text);
}

.pillenknopf--gefahr {
    --p-bg: var(--color-danger-soft);
    --p-rand: var(--color-danger-soft-border);
    --p-text: var(--color-danger-soft-text);
}

.pillenknopf--lokal {
    --p-bg: var(--color-local-soft);
    --p-rand: var(--color-local-soft-border);
    --p-text: var(--color-local-soft-text);
}

/* Eine Lasur über der Fläche, damit jeder Ton dieselbe Antwort gibt (Guide §30.1). */
.pillenknopf:hover {
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
}

.pillenknopf:active,
.pillenknopf[aria-expanded="true"] {
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
}

.pillenknopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.pillenknopf__zeichen {
    display: inline-flex;
    flex: none;
}

.pillenknopf__zeichen > :slotted(svg) {
    width: 10px;
    height: 10px;
}

@media (prefers-reduced-motion: reduce) {
    .pillenknopf {
        transition: none;
    }
}
</style>
