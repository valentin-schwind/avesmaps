<script setup lang="ts">
import type { EditorTerritoryFinding } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { befundText } from "./befunde";
import type { GebietReiter } from "./gebietseditor-steuerung";

/**
 * Der Kasten „Prüfen“ oben in den Eigenschaften eines Gebiets (WI-0209 D6; Muster Ortseditor E20): je Befund ein Satz, **nie eine
 * Sperre**. Wo es einen nächsten Schritt gibt, steht er daneben: eine Lücke führt in den Reiter „Hierarchie“, eine Überlappung zum
 * anderen Gebiet. Ohne Befund fehlt der Kasten.
 */
defineProps<{
    befunde: readonly EditorTerritoryFinding[];
    kennung: string;
    /** Ist der Reiter „Hierarchie“ offen? Ohne das Recht an der Form steht er grau, und „Zur Hierarchie“ fehlt (WI-0279, Paket 6). */
    hierarchieFrei?: boolean | undefined;
}>();
const emit = defineEmits<{ waehle: [id: string]; reiter: [reiter: GebietReiter] }>();
</script>

<template>
    <section v-if="befunde.length > 0" class="pruefen" :data-testid="`${kennung}-pruefen`">
        <h4 class="pruefen__titel">{{ t("gebietseditor.abschnitt.pruefen") }}</h4>
        <ul class="pruefen__liste">
            <li
                v-for="(befund, i) in befunde"
                :key="`${befund.kind}-${befund.area ?? befund.other?.id ?? befund.field ?? i}`"
                :data-testid="`${kennung}-befund-${befund.kind}`"
            >
                <span>⚠ {{ befundText(befund) }}</span>
                <button
                    v-if="hierarchieFrei && (befund.kind === 'luecke' || befund.kind === 'n2')"
                    type="button"
                    class="pruefen__verweis"
                    @click="emit('reiter', 'hierarchie')"
                >
                    {{ t("gebietseditor.befund.zurHierarchie") }}
                </button>
                <button
                    v-if="befund.kind === 'ueberlappung' && befund.other"
                    type="button"
                    class="pruefen__verweis"
                    @click="emit('waehle', befund.other.id)"
                >
                    {{ t("gebietseditor.befund.zumGebiet", { name: befund.other.name }) }}
                </button>
            </li>
        </ul>
        <p class="pruefen__leise">{{ t("gebietseditor.befund.sperrtNicht") }}</p>
    </section>
</template>

<style scoped>
.pruefen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.pruefen__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.pruefen__liste {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-small);
}

.pruefen__liste li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-8);
}

.pruefen__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.pruefen__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.pruefen__verweis:hover {
    color: var(--color-link-hover);
}

.pruefen__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
