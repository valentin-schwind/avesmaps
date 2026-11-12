<script setup lang="ts">
defineProps<{ expanded: boolean; label: string; disabled?: boolean }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
    <span class="inline-toggle"
        ><button
            type="button"
            class="inline-toggle__button"
            :disabled="disabled"
            :aria-expanded="expanded"
            :aria-label="label"
            :title="label"
            @click.stop="emit('toggle')"
        >
            <span aria-hidden="true">{{ expanded ? "«" : "…" }}</span>
        </button></span
    >
</template>

<style scoped>
.inline-toggle {
    display: inline-block;
    position: relative;
    width: var(--space-24);
    height: 0;
    vertical-align: baseline;
}
.inline-toggle__button {
    position: absolute;
    left: 0;
    bottom: calc(-1 * var(--space-2));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    height: var(--space-16);
    min-width: var(--space-24);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: calc(var(--space-16) / 2);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font: inherit;
    cursor: pointer;
    transition:
        color 120ms ease,
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.inline-toggle__button:hover:not(:disabled) {
    background: var(--color-panel-active);
    border-color: var(--color-border-strong);
}

.inline-toggle__button:active:not(:disabled) {
    background: var(--color-panel-active);
    color: var(--color-link-hover);
}

.inline-toggle__button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 calc(var(--space-2) / 2) var(--color-focus);
}

.inline-toggle__button:disabled {
    background: var(--color-disabled-bg);
    border-color: var(--color-disabled-border);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
    .inline-toggle__button {
        transition: none;
    }
}
</style>
