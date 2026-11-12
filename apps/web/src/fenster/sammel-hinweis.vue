<script setup lang="ts">
import { computed } from "vue";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Der Satz unter einem Feld der Mehrfachauswahl (EDIT-0003 T57, Fassung 5 der Gebiete; `fenster/sammel.ts`): „gilt für alle n“, sobald
 * ein gemeinsames Feld geändert ist; „auf Wiki-Werte, gilt für alle n“ nach ↺; „Nur einzeln“ an einem Feld, das in der Mehrfachauswahl
 * gesperrt steht. Leise und klein, unter dem Wert.
 */
const props = defineProps<{
    art: "alle" | "wiki" | "einzeln";
    /** Wie viele gewählt sind (für „alle“ und „wiki“). */
    n?: number | undefined;
    testid?: string | undefined;
}>();

const text = computed(() => {
    const n = formatNumber(props.n ?? 0, 0);
    if (props.art === "einzeln") return t("fenster.sammel.nurEinzeln");
    return props.art === "wiki" ? t("fenster.sammel.wikiFuerAlle", { n }) : t("fenster.sammel.fuerAlle", { n });
});
</script>

<template>
    <span class="sammel-hinweis" :class="`sammel-hinweis--${art}`" :data-testid="testid">{{ text }}</span>
</template>

<style scoped>
.sammel-hinweis {
    display: block;
    margin-top: var(--space-2);
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

/* Geändert: in der Farbe des Akzents, damit man sieht, was „Fertig“ für alle schreibt. */
.sammel-hinweis--alle,
.sammel-hinweis--wiki {
    color: var(--color-accent-strong);
}
</style>
