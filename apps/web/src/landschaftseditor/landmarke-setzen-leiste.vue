<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import FensterModusleiste from "../fenster/fenster-modusleiste.vue";
import { t } from "../i18n/i18n";
import type { LandmarkeSetzen } from "./landmarke-setzen";
import { landmarkenartName } from "./landschaften-liste";

/**
 * Die Leiste von „▲ Landmarke setzen“ (WI-0271 L4): die gemeinsame Leiste der Modi (`fenster-modusleiste.vue`) mit dem Zeichen des Menüs,
 * der Art als Objekt, „1 ungespeichert“, „Verwerfen“ und „Fertig“ (`landmarke-setzen.ts`). Ohne laufendes Setzen fehlt sie.
 */
const props = defineProps<{
    setzen: LandmarkeSetzen;
    rand?: { links: number; rechts: number; imFenster?: boolean } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();
const entwurf = computed(() => props.setzen.laufend.value);
</script>

<template>
    <FensterModusleiste
        v-if="entwurf"
        zeichen="neuer-gipfel"
        :titel="setzen.titel()"
        :objekt="
            entwurf.kandidat === undefined
                ? landmarkenartName(entwurf.art)
                : `${entwurf.kandidat.name} · ${landmarkenartName(entwurf.art)}`
        "
        :ungespeichert="1"
        :zurueck="false"
        :wieder="false"
        :fertig-grund="entwurf.sendet ? t('entwurf.speichert') : undefined"
        :gesten="t('landschaftseditor.landmarke.setzenGesten')"
        :rand="rand"
        :telefon="phoneViewport"
        testid="landmarke-setzen-leiste"
        @verwerfen="setzen.verwerfe()"
        @fertig="void setzen.fertig()"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
