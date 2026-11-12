<script setup lang="ts">
/**
 * Der kleine gefasste Knopf rechts an der Aufschrift eines Kastens im Inspector (WI-0068 P4b, Blatt 1): „⊙ Bearbeiten“ (`medien-kasten.vue`), „✚ Publikation“ (`medien-kasten-publikationen.vue`,
 * WI-0287). Zeichen statt Bild, wie jeder Knopf des Backends; Zustände nach §30.5. `click` und `aria-expanded` gehen an den Knopf durch.
 */
defineProps<{
    /** Das abstrakte Zeichen vor der Aufschrift (⊙, ✚). */
    zeichen: string;
    testid: string;
}>();
</script>

<template>
    <button type="button" class="medien-kasten__oeffnen" :data-testid="testid">
        <span aria-hidden="true">{{ zeichen }}</span>
        <span class="avm-versalmitte"><slot /></span>
    </button>
</template>

<style scoped>
.medien-kasten__oeffnen {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: normal;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.medien-kasten__oeffnen:hover {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-hover-wash), var(--color-hover-wash));
    color: var(--color-text-strong);
}

.medien-kasten__oeffnen:active {
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
}

.medien-kasten__oeffnen:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .medien-kasten__oeffnen {
        transition: none;
    }
}
</style>
