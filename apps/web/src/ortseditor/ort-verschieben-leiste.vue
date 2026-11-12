<script setup lang="ts">
import { computed, watch } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import { showToast } from "../feedback/toast";
import FensterModusleiste from "../fenster/fenster-modusleiste.vue";
import { t } from "../i18n/i18n";
import type { OrtVerschieben } from "./ort-verschieben";

/**
 * Die Leiste von „✥ Ort verschieben“ (WI-0128 E12; EDIT-0003 G4, Vali 2026-10-31 „erst gespeichert, wenn der bearbeiter auf "fertig"
 * drückt“; §2a, R8, T27 (4), (7)): die gemeinsame Leiste des Modus (`fenster/fenster-modusleiste.vue`) oben mittig über der freien Karte,
 * am Telefon unten, wie bei den anderen Formmodi. „n ungespeichert“ zählt die Züge; ↶ ↷ nehmen einen Zug zurück und wieder;
 * „Verwerfen“ stellt die Ausgangslage her, der Modus bleibt; „Fertig“ schreibt EINE Operation `place.move`. Die Frage beim Verlassen hat
 * drei Antworten wie in den anderen Modi (R2). Sie steht, sobald der Ort geladen ist, auch wenn das Fenster des Orts abgelegt ist.
 *
 * Eine Ablehnung beim Schreiben (423, 503, keine Verbindung) lässt den Entwurf stehen; der Satz erscheint als Hinweis, denn das Fenster
 * mit der Statuszeile kann zu sein.
 */

const props = defineProps<{
    verschieben: OrtVerschieben;
    /** Was die Panels links und rechts von der Karte decken (`VisibleArea.covered`). */
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => {
    const jetzt = props.verschieben.laufend.value;
    return jetzt !== undefined && jetzt.art !== "laedt" ? jetzt : undefined;
});
const fertigGrund = computed(() => (lauf.value?.art === "speichert" ? t("entwurf.fertigSpeichert") : undefined));
const frage = computed(() => {
    const jetzt = lauf.value;
    return jetzt?.lage.frage === true
        ? {
              text: t("entwurf.frage", { n: String(jetzt.lage.ungespeichert) }),
              ja: t("modusleiste.verwerfen"),
              nein: t("entwurf.weiter"),
              speichern: t("entwurf.speichern"),
          }
        : undefined;
});

watch(
    () => props.verschieben.meldung.value,
    (meldung) => {
        if (meldung?.art === "abgelehnt" && lauf.value !== undefined) showToast(meldung.satz, "warning");
    },
);
</script>

<template>
    <FensterModusleiste
        v-if="lauf !== undefined"
        zeichen="verschieben"
        :titel="t('ortseditor.verschieben.titel')"
        :objekt="lauf.start.name"
        :ungespeichert="lauf.lage.ungespeichert"
        :zurueck="lauf.lage.zurueck"
        :wieder="lauf.lage.wieder"
        :fertig-grund="fertigGrund"
        :gesten="phoneViewport ? t('ortseditor.verschieben.gestenFinger') : t('ortseditor.verschieben.gesten')"
        :frage="frage"
        :telefon="phoneViewport"
        :rand="rand"
        testid="ort-verschieben-leiste"
        @zurueck="verschieben.zurueck()"
        @wieder="verschieben.wieder()"
        @verwerfen="verschieben.verwerfen()"
        @fertig="void verschieben.fertig()"
        @antwort="(ja: boolean) => void verschieben.antworte(ja ? 'verwerfen' : 'weiter')"
        @speichern="void verschieben.antworte('speichern')"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
