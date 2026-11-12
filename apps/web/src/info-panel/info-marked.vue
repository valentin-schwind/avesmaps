<script setup lang="ts">
import { computed } from "vue";
import { markedParts } from "./lore-search";

/**
 * Ein Text, in dem die Treffer einer Suche markiert sind (WI-0122). Ohne Suchwort steht der Text unverändert da - die
 * Anzeige braucht dann keinen zweiten Weg.
 *
 * 🔴 Markiert wird über die FLÄCHE, nicht über Gewicht: Die Hausschrift hat nur den Regular-Schnitt, und Betonung kommt im Haus
 * aus der Farbe (Guide §3). Die Fläche ist die Lasur der aktiven Auswahl (`--color-active-wash`), hell wie dunkel aus dem Kanon;
 * die Schrift behält ihre Farbe, ein Link bleibt goldbraun.
 */
const props = defineProps<{ text: string; needle?: string | undefined }>();
const parts = computed(() => markedParts(props.text, props.needle ?? ""));
</script>

<template>
    <template v-for="(part, at) in parts" :key="at"
        ><mark v-if="part.hit" class="info-marked" data-testid="info-marked">{{ part.text }}</mark
        ><template v-else>{{ part.text }}</template></template
    >
</template>

<style scoped>
.info-marked {
    border-radius: calc(var(--radius-sm) / 2);
    background: var(--color-active-wash);
    color: inherit;
}
</style>
