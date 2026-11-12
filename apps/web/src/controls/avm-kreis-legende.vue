<script setup lang="ts">
import { computed } from "vue";
import type { Kreis } from "../editor-liste/liste-modell";
import { formatNumber } from "../i18n/i18n";
import AvmKreis from "./avm-kreis.vue";

/**
 * Die Legende mit Zählung (WI-0187; EDIT-0003 T26 (5); Betreiber 2026-10-16, wörtlich: „ich wollte dass du die legende mit der zählung
 * kombinierst … diese systematik für alle übernehmen“): EINE Zeile, je Zustand Name, Kreis und Zahl, ein Mittelpunkt dazwischen, leise
 * und klein. Sie steht unter jeder Liste der Editoren (`editor-liste.vue`) und im Steckbrief der Karteninhalte im Editorpanel (WI-0212),
 * damit beide Stellen dieselbe Systematik zeigen.
 *
 * - Welche Zustände es gibt und wie sie heißen, sagt die Liste (`namen`); es stehen nur die da, denen sie einen Namen gibt, in der Folge
 *   ● · ◐ · ◑ · ○ (Betreiber 2026-10-16).
 * - Der Kreis ist hier Schmuck, der Name steht daneben (`aria-hidden`). Bricht die Zeile in einer schmalen Spalte um, beginnt keine Zeile
 *   mit dem Mittelpunkt: Er hängt am Ende des Eintrags davor.
 */
const props = defineProps<{
    namen: Partial<Record<Kreis | "gestrichelt", string>>;
    zahlen: Readonly<Record<Kreis, number> & { gestrichelt?: number }>;
    /** Der Name der Legende für Vorleser. */
    beschriftung: string;
    testid?: string | undefined;
}>();

const FOLGE: readonly (Kreis | "gestrichelt")[] = ["voll", "halb", "halb-rechts", "leer", "gestrichelt"];
const kreise = computed(() => FOLGE.filter((kreis) => (props.namen[kreis] ?? "") !== ""));
</script>

<template>
    <ul class="avm-kreis-legende" :aria-label="props.beschriftung" :data-testid="props.testid">
        <li v-for="kreis in kreise" :key="kreis" :data-kreis="kreis">
            <span>{{ props.namen[kreis] }}</span>
            <AvmKreis :fuellung="kreis" :name="props.namen[kreis] ?? ''" aria-hidden="true" />
            <span class="avm-kreis-legende__zahl">{{ formatNumber(props.zahlen[kreis] ?? 0, 0) }}</span>
        </li>
    </ul>
</template>

<style scoped>
.avm-kreis-legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    padding: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    list-style: none;
}

.avm-kreis-legende li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
}

.avm-kreis-legende li:not(:last-child)::after {
    content: "·";
    margin-left: var(--space-2);
}
</style>
