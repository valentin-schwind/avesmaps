<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import EntwurfLeiste from "../fenster/entwurf-leiste.vue";
import { formatNumber, t } from "../i18n/i18n";
import { wirksam, type FlaecheMalen } from "./flaeche-malen";

/**
 * Die Leiste von „Fläche malen“ und „Fläche radieren“ (Werkzeug 6): die gemeinsame Leiste der Bearbeitung an der Bearbeitung der
 * Landschaft. Titel und Zeichen folgen dem Werkzeug, das gerade wirkt (Alt gibt das Gegenwerkzeug); unter der Zeile die Größe des Pinsels.
 */

const props = defineProps<{
    malen: FlaecheMalen;
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => {
    const jetzt = props.malen.laufend.value;
    return jetzt?.phase === "bereit" && jetzt.bearbeitung !== undefined ? jetzt : undefined;
});
const art = computed(() => (lauf.value === undefined ? "malen" : wirksam(lauf.value)));
const gesten = computed(() => {
    if (phoneViewport.value) return t("landschaftseditor.malen.gestenFinger");
    return art.value === "malen" ? t("landschaftseditor.malen.gesten") : t("landschaftseditor.radieren.gesten");
});
</script>

<template>
    <EntwurfLeiste
        v-if="lauf?.bearbeitung"
        :bearbeitung="lauf.bearbeitung"
        :zeichen="art"
        :titel="art === 'malen' ? t('landschaftseditor.griff.malen') : t('landschaftseditor.griff.radieren')"
        :objekt="lauf.name"
        :gesten="gesten"
        :rand="rand"
        testid="flaeche-malen-leiste"
        @hoehe="(px: number) => emit('hoehe', px)"
    >
        <template #zusatz>
            <span class="pinsel" data-testid="flaeche-malen-groesse">{{
                t("landschaftseditor.malen.groesse", { px: formatNumber(Math.round(lauf.radius), 0) })
            }}</span>
        </template>
    </EntwurfLeiste>
</template>

<style scoped>
.pinsel {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}
</style>
