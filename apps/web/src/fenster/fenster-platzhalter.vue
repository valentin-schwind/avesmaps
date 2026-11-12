<script setup lang="ts">
/**
 * Ein sichtbarer Platzhalter für Inhalt, den es noch nicht gibt (WI-0045: „wenn dir Inhalte fehlen,
 * arbeite mit Platzhaltern“).
 *
 * 🔴 Gestrichelt heißt: das ist nicht dauerhaft (Guide §13.17, CANON). Die Form ist die der Ablagezone:
 * gestrichelte Kante `--color-border-strong`, Fläche `--color-panel-soft`, Radius `md`, Text gedämpft.
 * ⭐ Der Text sagt, womit der Platz gefüllt wird, nicht dass er leer ist („kommt mit dem Höhenmodell“).
 */
</script>

<template>
    <div class="fenster-platzhalter" data-testid="fenster-platzhalter">
        <slot />
    </div>
</template>

<style scoped>
.fenster-platzhalter {
    min-width: 0;
    padding: var(--space-6) var(--space-10);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
}
</style>
