<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import EntwurfLeiste from "../fenster/entwurf-leiste.vue";
import { t } from "../i18n/i18n";
import type { Sprachflaeche } from "./sprachflaeche-form";

/**
 * Die Leiste von „◇ Fläche bearbeiten“ an einer Teilfläche einer Sprache (WI-0261 S5d2; Bauvorlage `karte.js` `modusZeigen`: „Fläche
 * bearbeiten“, das Objekt „Garethi · Teilfläche 3“, „n ungespeichert“, ↶ ↷, Verwerfen, Fertig): seit Stufe 2 die gemeinsame Leiste der Bearbeitung
 * (`fenster/entwurf-leiste.vue`) an der EINEN Bearbeitung der Teilfläche, wie „Gebietsform bearbeiten“ an der Landschaft. Schritte, Frage
 * (Speichern · Verwerfen · Weiter bearbeiten, R2) und „Fertig“ gehören ihr; hier stehen Titel, Zeichen und Gesten. Nichts rastet ein (E4).
 */
const props = defineProps<{
    form: Sprachflaeche;
    rand?: { links: number; rechts: number; imFenster?: boolean } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => {
    const jetzt = props.form.laufend.value;
    return jetzt === undefined || jetzt.phase === "laedt" ? undefined : jetzt;
});
const bearbeitung = computed(() => (lauf.value === undefined ? undefined : props.form.bearbeitung.value));
</script>

<template>
    <EntwurfLeiste
        v-if="lauf && bearbeitung"
        :bearbeitung="bearbeitung"
        zeichen="gebietsform"
        :titel="t('spracheditor.form.titel')"
        :objekt="lauf.name"
        :gesten="phoneViewport ? t('spracheditor.form.gestenFinger') : t('spracheditor.form.gesten')"
        :rand="rand"
        testid="sprachflaeche-leiste"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
