<script setup lang="ts">
/**
 * Das kleine Eingabefeld des Planers (Guide §17.7 „Zahlenfeld 56 × 25“, §30.5): Reisestunden, Tag des
 * Reisebeginns und die Werte des eigenen Flugmittels. Aus dem Routenplaner gezogen, als das eigene
 * Flugmittel es als zweiter Leser brauchte (WI-0050; Guide §12.6 „zum Baustein ziehen, nicht abschreiben“).
 *
 * - Ein echtes `<input>`: Art, Grenzen, Wert, Beschriftung und Ereignisse reicht der Aufrufer durch.
 * - Die Breite setzt der Aufrufer; das Feld selbst kennt nur Höhe, Kante und Zustände.
 * - Zustände nach §30.5: Kante `border-strong` beim Überfahren, goldbraune Kante und Fokusring im Fokus,
 *   gesperrt eine eigene Farbfassung (keine Deckkraft, §13.19), 120 ms, ohne Bewegung keiner.
 */
</script>

<template>
    <input class="feld" />
</template>

<style scoped>
.feld {
    height: 25px;
    box-sizing: border-box;
    padding: 0 var(--space-2) 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    font: inherit;
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.feld::placeholder {
    color: var(--color-placeholder);
}

.feld:hover:not(:disabled) {
    border-color: var(--color-border-strong);
}

.feld:focus {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Gesperrt ist eine eigene Farbfassung, keine Deckkraft (Guide §13.19): `disabled` allein graut ein
   dunkles Feld kaum aus. */
.feld:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

/* iOS fährt in jedes Feld unter 16 px hinein und kehrt nicht zurück (Legacy: die iOS-Schwelle). */
@media (pointer: coarse) {
    .feld {
        font-size: 16px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .feld {
        transition: none;
    }
}
</style>
