<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../../controls/phone-viewport";
import FensterModusleiste from "../../fenster/fenster-modusleiste.vue";
import { t } from "../../i18n/i18n";
import type { NeueFlaeche } from "./neue-flaeche";
import { neueFlaecheGrund } from "./neue-flaeche-texte";

/**
 * Die Leiste von „Neue Fläche“ (C3; EDIT-0003 §2a, R8, T27 (4), T45 (3)): die gemeinsame Leiste des Modus
 * (`fenster/fenster-modusleiste.vue`), oben mittig über der freien Karte, am Telefon unten. „Neue Fläche · <was entsteht>“, dahinter,
 * was die Andockung über die erste Ecke sagt (das Gebiet: „Wird Untergebiet von …“, Frage 2); „n ungespeichert“ zählt die Kanten,
 * ↶ ↷ nehmen Ecken zurück und wieder, „Verwerfen“ stellt den Beginn her, „Fertig“ schreibt EINE Operation und sagt, solange es nicht
 * geht, warum. Der Platz `#zusatz` trägt das Bauteil der Andockung (`andockung.zusatz`; die Derographie: ihren Untergrund-Regler,
 * Frage 5); ohne steht dort nichts.
 */

const props = defineProps<{
    neueFlaeche: NeueFlaeche;
    /** Was die Panels links und rechts von der Karte decken (`VisibleArea.covered`); `imFenster`: die Leiste steht im Fenster. */
    rand?: { links: number; rechts: number; imFenster?: boolean } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => props.neueFlaeche.laufend.value);
const objekt = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return "";
    const was = t(jetzt.titel);
    return jetzt.objekt === undefined ? was : `${was} · ${jetzt.objekt}`;
});
const fertigGrund = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return undefined;
    if (jetzt.phase === "speichert") return t("neueFlaeche.speichert");
    return jetzt.stand.fertig === undefined ? undefined : neueFlaecheGrund();
});
</script>

<template>
    <FensterModusleiste
        v-if="lauf !== undefined && lauf.phase !== 'laedt'"
        zeichen="neue-flaeche"
        :titel="t('neueFlaeche.titel')"
        :objekt="objekt"
        :ungespeichert="lauf.stand.abschnitte"
        :zurueck="lauf.stand.zurueck"
        :wieder="lauf.stand.wieder"
        :fertig-grund="fertigGrund"
        :gesten="phoneViewport ? t('neueFlaeche.gestenFinger') : t('neueFlaeche.gesten')"
        :frage="
            lauf.frage
                ? {
                      text: t('neueFlaeche.frage'),
                      ja: t('modusleiste.verwerfenEsc'),
                      nein: t('wegeditor.wegkurve.weiter'),
                  }
                : undefined
        "
        :telefon="phoneViewport"
        :rand="rand"
        testid="neue-flaeche-leiste"
        @zurueck="neueFlaeche.zurueck()"
        @wieder="neueFlaeche.wieder()"
        @verwerfen="neueFlaeche.verwerfen()"
        @fertig="neueFlaeche.fertig()"
        @antwort="(ja: boolean) => neueFlaeche.antworte(ja)"
        @hoehe="(px: number) => emit('hoehe', px)"
    >
        <template v-if="lauf.zusatz" #zusatz>
            <component :is="lauf.zusatz" />
        </template>
    </FensterModusleiste>
</template>
