<script setup lang="ts">
import { computed } from "vue";
import type { MapHistoryObjectKind } from "@avesmaps3d/shared";
import { objektZiel, type ObjektZiel } from "../aenderungen/aenderung-modell";
import { artName } from "../aenderungen/aenderung-text";

/**
 * Ein Objekt in der Editorenliste (WI-0276): Art und Name. Was auf der Karte liegt, ist ein Objektlink (Bauart wie `info-link.vue`: ein Knopf, kein ↗, er bleibt in Avesmaps);
 * alles andere (eine Quelle, ein Werk) ist Text.
 */
const props = defineProps<{ art: MapHistoryObjectKind; id: string; name: string | null | undefined }>();
const emit = defineEmits<{ zeigen: [ziel: ObjektZiel, id: string] }>();

const ziel = computed(() => objektZiel(props.art));
const text = computed(() => (props.name ? `${artName(props.art)} ${props.name}` : artName(props.art)));
</script>

<template>
    <button
        v-if="ziel"
        type="button"
        class="editor-objekt editor-objekt--link"
        data-testid="editor-objekt"
        @click="emit('zeigen', ziel, id)"
    >
        {{ text }}
    </button>
    <span v-else class="editor-objekt">{{ text }}</span>
</template>

<style scoped>
.editor-objekt {
    overflow-wrap: anywhere;
    color: var(--color-text-strong);
}

.editor-objekt--link {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    line-height: inherit;
    text-align: left;
    transition: color 120ms ease;
}

.editor-objekt--link:hover,
.editor-objekt--link:active {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.editor-objekt--link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}
</style>
