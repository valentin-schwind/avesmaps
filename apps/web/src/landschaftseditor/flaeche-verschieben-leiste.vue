<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import EntwurfLeiste from "../fenster/entwurf-leiste.vue";
import { t } from "../i18n/i18n";
import { GEMEINSAME_ECKEN_STELLE, ohneTeil, type FlaecheVerschieben } from "./flaeche-verschieben";

/**
 * Die Leiste von „Verschieben“ (Werkzeug 7 der Derographie): die gemeinsame Leiste der Bearbeitung (`fenster/entwurf-leiste.vue`) an der
 * Bearbeitung der Landschaft. Schritte, Frage und „Fertig“ gehören ihr; hier stehen Titel, Zeichen und Gesten. An einer Art ohne Nachbarn (die Sprache)
 * fehlt im Gestensatz der Teil zu den gemeinsamen Ecken (`GEMEINSAME_ECKEN_STELLE`).
 */

const props = defineProps<{
    verschieben: FlaecheVerschieben;
    /** Was die Panels links und rechts von der Karte decken (`VisibleArea.covered`). */
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => {
    const jetzt = props.verschieben.laufend.value;
    return jetzt?.phase === "bereit" && jetzt.bearbeitung !== undefined ? jetzt : undefined;
});
const gesten = computed(() => {
    const art = phoneViewport.value ? "gestenFinger" : "gesten";
    const satz = t(`landschaftseditor.verschieben.${art}`);
    return lauf.value?.quelle.mitNachbarn === false ? ohneTeil(satz, GEMEINSAME_ECKEN_STELLE[art]) : satz;
});
</script>

<template>
    <EntwurfLeiste
        v-if="lauf?.bearbeitung"
        :bearbeitung="lauf.bearbeitung"
        zeichen="verschieben"
        :titel="t('landschaftseditor.verschieben')"
        :objekt="lauf.name"
        :gesten="gesten"
        :rand="rand"
        testid="flaeche-verschieben-leiste"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
