<script setup lang="ts">
/**
 * Karten wie Mauerwerk (WI-0076, Betreiber 2026-10-04: „ich meinte eigentlich boxen in flexiblen höhen“): Jede Karte ist
 * nur so hoch wie ihr Inhalt, keine wird an ihre Nachbarin angeglichen, und unter einer kurzen Karte bleibt keine
 * Leerfläche.
 *
 * - CSS-Spalten in der Breite einer Lesespalte (`--avm-fenster-lesespalte`): Wie viele nebeneinander passen, entscheidet
 *   der Platz, nicht die Bildschirmbreite (Guide §12.6 „Nebeneinander“); am Telefon ist es eine Spalte.
 * - 🔴 Gelesen wird spaltenweise von oben nach unten. Die Reihenfolge der Karten im Fenster ist darum so gewählt, dass
 *   Zusammengehöriges untereinander steht.
 * - Eine Karte bricht nie über zwei Spalten (`break-inside: avoid`); der Abstand ist der Takt der Karten (12).
 */
</script>

<template>
    <div class="fenster-mauer">
        <slot />
    </div>
</template>

<style scoped>
.fenster-mauer {
    columns: auto var(--avm-fenster-lesespalte);
    column-gap: var(--space-12);
}

.fenster-mauer > :slotted(*) {
    margin-bottom: var(--space-12);
    break-inside: avoid;
}

.fenster-mauer > :slotted(*:last-child) {
    margin-bottom: 0;
}
</style>
