<script setup lang="ts">
import EditorZeichen from "../controls/editor-zeichen.vue";

/**
 * Das durchgestrichene Auge über einer für Besucher verborgenen Landschaft (WI-0178 T41; EDIT-0003 T41 (1)): dunkler Kreis, weiß
 * umrandet, wie das Schild der Sperre. Ein Klick öffnet das Fenster der Landschaft.
 */
defineProps<{ titel: string }>();
const emit = defineEmits<{ klick: [] }>();
</script>

<template>
    <button
        type="button"
        class="verborgen-auge"
        :title="titel"
        :aria-label="titel"
        data-testid="verborgen-auge"
        @click.stop="emit('klick')"
    >
        <EditorZeichen name="verbergen" />
    </button>
</template>

<style scoped>
.verborgen-auge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2);
    border: 1.5px solid var(--color-panel);
    border-radius: 999px;
    background: var(--color-button-border);
    box-shadow: var(--shadow-panel);
    color: var(--color-panel);
    cursor: pointer;
}
</style>
