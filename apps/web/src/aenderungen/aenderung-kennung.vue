<script setup lang="ts">
import { ref, watch } from "vue";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import { kurzeKennung } from "./aenderung-text";

/**
 * „Kennung 088e9621… ⧉“ im Fuß eines Details (WI-0265 B10): die ersten Zeichen der Kennung einer Operation oder Serie, ⧉ kopiert die ganze. Geht das Kopieren nicht (kein Zugriff auf die Zwischenablage), steht die ganze
 * Kennung da, zum Markieren, und der Hinweis sagt es. Die ganze Kennung steht auch im Tooltip.
 */
const props = defineProps<{
    /** Die ganze Kennung. */
    id: string;
    /** Vorsilbe der Test-Kennungen. */
    kennung: string;
    /** Die Test-Kennung der Zeichenkette selbst. */
    testid: string;
}>();

const voll = ref(false);
watch(
    () => props.id,
    () => {
        voll.value = false;
    },
);

function kopiere(): void {
    const zeigeVoll = (): void => {
        voll.value = true;
        showToast(t("aenderungen.detail.kopierenFehlt"));
    };
    try {
        void navigator.clipboard.writeText(props.id).then(() => showToast(t("aenderungen.detail.kopiert")), zeigeVoll);
    } catch {
        zeigeVoll();
    }
}
</script>

<template>
    <span class="kennung"
        >{{ t("aenderungen.detail.kennung") }}
        <span class="kennung__id" :data-testid="testid" :title="id">{{ voll ? id : kurzeKennung(id) }}</span>
        <button
            type="button"
            class="kennung__kopier"
            :title="t('aenderungen.detail.kennungKopieren')"
            :aria-label="t('aenderungen.detail.kennungKopieren')"
            :data-testid="`${kennung}-kennung-kopieren`"
            @click="kopiere()"
        >
            <span aria-hidden="true">⧉</span>
        </button></span
    >
</template>

<style scoped>
.kennung__id {
    font-family: ui-monospace, Consolas, monospace;
    font-size: var(--font-size-caption);
    overflow-wrap: anywhere;
}

.kennung__kopier {
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

.kennung__kopier:hover {
    color: var(--color-link-hover);
}

.kennung__kopier:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
