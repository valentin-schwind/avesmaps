<script setup lang="ts">
/**
 * Das Schild einer Sperre auf der Karte (EDIT-0003 §4, T27 (3)): dunkle Pille mit Schloss, Name, woran, seit wann („🔒 Thomas · Form ·
 * seit 07:32“), weiß umrandet. Grau-Braun aus dem Kanon, nie Rot (T1). Beim Überfahren sagt der Titel, wann zuletzt aktiv und ab wann frei.
 * Es nimmt keinen Klick: Gewählt wird die Fläche darunter.
 */
defineProps<{ aufschrift: string; titel: string }>();
</script>

<template>
    <div class="sperre-schild" :title="titel" data-testid="sperre-schild">{{ aufschrift }}</div>
</template>

<style scoped>
.sperre-schild {
    padding: var(--space-2) var(--space-8);
    border: 1.5px solid var(--color-panel);
    border-radius: 999px;
    background: var(--color-button-border);
    box-shadow: var(--shadow-panel);
    color: var(--color-panel);
    font-size: var(--font-size-small);
    white-space: nowrap;
    cursor: default;
    user-select: none;
}
</style>
