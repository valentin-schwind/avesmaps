<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import EntwurfLeiste from "../fenster/entwurf-leiste.vue";
import { t } from "../i18n/i18n";
import VereinfachenRegler from "./vereinfachen-regler.vue";
import type { Wegkurve } from "./wegkurve";

/**
 * Die Leiste von „Wegkurve bearbeiten“ und „Wegkurve vereinfachen“ (WI-0177, W5b Schritt 3; EDIT-0003 §2a, T27 (4), (7), T44): die
 * gemeinsame Leiste der Bearbeitung (`fenster/entwurf-leiste.vue`) an der Bearbeitung der Straße. Schritte, Frage und „Fertig“ gehören
 * ihr; hier stehen nur Titel, Zeichen und Gesten der Wegkurve und beim Vereinfachen unter der Zeile der Regler
 * (`vereinfachen-regler.vue`). Sie steht, sobald die Form angehängt ist.
 *
 * 🪤 Das Zeichen der Wegkurve ist bis zur Abnahme eines eigenen (∿, wie im Probierblatt P5; F21) der Stift „bearbeiten“: Die
 * Zeichentafel (`controls/editor-zeichen.vue`) kennt noch keines für die Wegkurve.
 */

const props = defineProps<{
    wegkurve: Wegkurve;
    /** Was die Panels links und rechts von der Karte decken (`VisibleArea.covered`). */
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => {
    const jetzt = props.wegkurve.laufend.value;
    return jetzt?.phase === "bereit" && jetzt.bearbeitung !== undefined ? jetzt : undefined;
});
const vereinfachen = computed(() => lauf.value?.art === "vereinfachen");
const gesten = computed(() => {
    if (vereinfachen.value)
        return phoneViewport.value ? t("wegeditor.vereinfachen.gestenFinger") : t("wegeditor.vereinfachen.gesten");
    return phoneViewport.value ? t("wegeditor.wegkurve.gestenFinger") : t("wegeditor.wegkurve.gesten");
});
</script>

<template>
    <EntwurfLeiste
        v-if="lauf?.bearbeitung"
        :bearbeitung="lauf.bearbeitung"
        :zeichen="vereinfachen ? 'vereinfachen' : 'bearbeiten'"
        :titel="vereinfachen ? t('wegeditor.vereinfachen') : t('wegeditor.wegkurve')"
        :objekt="lauf.name"
        :gesten="gesten"
        :rand="rand"
        testid="wegkurve-leiste"
        @hoehe="(px: number) => emit('hoehe', px)"
    >
        <template v-if="vereinfachen" #zusatz>
            <VereinfachenRegler :wegkurve="wegkurve" />
        </template>
    </EntwurfLeiste>
</template>
