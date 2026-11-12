<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import FensterModusleiste from "../fenster/fenster-modusleiste.vue";
import { t } from "../i18n/i18n";
import type { Zerschneiden } from "./zerschneiden";

/**
 * Die Leiste von „Zerschneiden“ (Werkzeug 5): die gemeinsame Leiste des Modus (`fenster/fenster-modusleiste.vue`) wie bei „Neue
 * Fläche“: „n ungespeichert“ zählt die Abschnitte der Schnittlinie, ↶ ↷ nehmen Punkte zurück, „Fertig“ schneidet ab zwei Punkten,
 * Esc fragt ab dem ersten Abschnitt.
 */

const props = defineProps<{
    zerschneiden: Zerschneiden;
    rand?: { links: number; rechts: number; imFenster?: boolean } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => props.zerschneiden.laufend.value);
const fertigGrund = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return undefined;
    if (jetzt.phase === "schreibt") return t("neueFlaeche.speichert");
    return jetzt.stand.fertig === undefined ? undefined : t("landschaftseditor.zerschneiden.zuWenig");
});
</script>

<template>
    <FensterModusleiste
        v-if="lauf !== undefined"
        zeichen="zerschneiden"
        :titel="t('landschaftseditor.griff.zerschneiden')"
        :objekt="lauf.name"
        :ungespeichert="lauf.stand.abschnitte"
        :zurueck="lauf.stand.zurueck"
        :wieder="lauf.stand.wieder"
        :fertig-grund="fertigGrund"
        :gesten="
            phoneViewport
                ? t('landschaftseditor.zerschneiden.gestenFinger')
                : t('landschaftseditor.zerschneiden.gesten')
        "
        :frage="
            lauf.frage
                ? {
                      text: t('landschaftseditor.zerschneiden.frage'),
                      ja: t('modusleiste.verwerfenEsc'),
                      nein: t('wegeditor.wegkurve.weiter'),
                  }
                : undefined
        "
        :telefon="phoneViewport"
        :rand="rand"
        testid="zerschneiden-leiste"
        @zurueck="zerschneiden.zurueck()"
        @wieder="zerschneiden.wieder()"
        @verwerfen="zerschneiden.verwerfen()"
        @fertig="zerschneiden.fertig()"
        @antwort="(ja: boolean) => zerschneiden.antworte(ja)"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
