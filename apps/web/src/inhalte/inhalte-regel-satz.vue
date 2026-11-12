<script setup lang="ts">
import { computed } from "vue";
import type { WikisyncRegelBedingung } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { satzGruppen } from "./inhalte-regel-satz";

/**
 * Der Satz einer Regel (WI-0254): Bedingungen mit UND, ODER und OHNE, gleiche ODER-Bedingungen zusammengefasst, eine wartende Fläche mit „!“ hervorgehoben. Die Regelkarte (`inhalte-regel-karte.vue`) und die
 * Vorschau von „Regeln als Text“ (`inhalte-regeln-text-vorschau.vue`) setzen ihn mit diesem Baustein; die Rechnung steht in `inhalte-regel-satz.ts`. Er trägt nur Text und läuft im Satz der Elternzeile mit.
 */
const props = defineProps<{ bedingungen: readonly WikisyncRegelBedingung[] }>();
const gruppen = computed(() => satzGruppen(props.bedingungen));
</script>

<template>
    <span v-if="gruppen.length === 0">{{ t("admin.wikisync.regeln.keineBedingung") }}</span>
    <template v-for="(g, i) in gruppen" :key="i"
        ><span v-if="g.op !== undefined" class="regel__op">{{ ` ${g.op} ` }}</span
        ><template v-for="(s, k) in g.stuecke" :key="k"
            ><span v-if="s.bang" class="regel__bang">{{ s.text }}</span
            ><template v-else>{{ s.text }}</template></template
        ></template
    >
</template>

<style scoped>
.regel__op {
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    letter-spacing: 0.04em;
}

.regel__bang {
    color: var(--color-warning-soft-text);
    font-weight: var(--font-weight-bold);
}
</style>
