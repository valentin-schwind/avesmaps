<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import FensterModusleiste from "../fenster/fenster-modusleiste.vue";
import { t } from "../i18n/i18n";
import type { NeuerWeg } from "./neuer-weg";
import { neuerWegGrund, neuerWegSatz, neuerWegVon } from "./wegeditor-texte";

/**
 * Die Leiste von „Neuer Weg“ (WI-0177; EDIT-0003 §2a, R8, T27 (4)): die gemeinsame Leiste des Modus (`fenster/fenster-modusleiste.vue`)
 * oben mittig über der freien Karte, am Telefon unten. „n ungespeichert“ zählt die Abschnitte; ↶ ↷ nehmen Punkte zurück und wieder;
 * „Verwerfen“ stellt den Anfang her; „Fertig“ schreibt EINE Operation `path.create` und sagt, solange es nicht geht, warum.
 */

const props = defineProps<{
    neuerWeg: NeuerWeg;
    /** Was die Panels links und rechts von der Karte decken (`VisibleArea.covered`). */
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => props.neuerWeg.laufend.value);
const fertigGrund = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return undefined;
    if (jetzt.phase === "speichert") return t("wegeditor.wegkurve.speichert");
    return jetzt.stand.fertig === undefined ? undefined : neuerWegGrund(jetzt.stand.fertig, jetzt.art);
});
</script>

<template>
    <FensterModusleiste
        v-if="lauf !== undefined && lauf.phase !== 'laedt'"
        zeichen="neuer-weg"
        :titel="t(neuerWegSatz(lauf.art, 'titel'))"
        :objekt="neuerWegVon(lauf.von)"
        :ungespeichert="lauf.stand.abschnitte"
        :zurueck="lauf.stand.zurueck"
        :wieder="lauf.stand.wieder"
        :fertig-grund="fertigGrund"
        :gesten="phoneViewport ? t('wegeditor.neu.gestenFinger') : t('wegeditor.neu.gesten')"
        :frage="
            lauf.frage
                ? {
                      text: t(neuerWegSatz(lauf.art, 'frage')),
                      ja: t('modusleiste.verwerfenEsc'),
                      nein: t('wegeditor.wegkurve.weiter'),
                  }
                : undefined
        "
        :telefon="phoneViewport"
        :rand="rand"
        testid="neuer-weg-leiste"
        @zurueck="neuerWeg.zurueck()"
        @wieder="neuerWeg.wieder()"
        @verwerfen="neuerWeg.verwerfen()"
        @fertig="neuerWeg.fertig()"
        @antwort="(ja: boolean) => neuerWeg.antworte(ja)"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
