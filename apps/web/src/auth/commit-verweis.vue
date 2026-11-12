<script setup lang="ts">
import { computed } from "vue";
import { commitLink } from "@avesmaps3d/shared";

/**
 * Ein Commit als Link auf GitHub (WI-0137, VERSION-0001 §4): in „Versionen“, in der Nachweis-Leiste und im Fix-Bericht des Kanals und in
 * der Gruppe „Fix-Berichte“. Der Link entsteht aus der SHA (`commitLink`), nie aus Text; was keine SHA ist, bleibt Text. Der Pfeil kommt
 * aus der Hausregel `a[target="_blank"]::after` (`styles/canon.css`).
 */
const props = withDefaults(defineProps<{ sha: string; stellen?: number }>(), { stellen: 8 });
const link = computed(() => commitLink(props.sha));
const kurz = computed(() => props.sha.slice(0, props.stellen));
</script>

<template>
    <a v-if="link !== null" class="commit" :href="link" target="_blank" rel="noopener">{{ kurz }}</a>
    <span v-else class="commit commit--text">{{ kurz }}</span>
</template>

<style scoped>
.commit {
    color: var(--color-link);
    font-variant-numeric: tabular-nums;
    text-decoration: none;
    white-space: nowrap;
}

.commit--text {
    color: inherit;
}

a.commit:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

a.commit:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
