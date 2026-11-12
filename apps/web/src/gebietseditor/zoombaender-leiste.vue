<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import FensterModusleiste from "../fenster/fenster-modusleiste.vue";
import { formatNumber, t } from "../i18n/i18n";
import { befundeVon, hierarchieVon, mitEntwurf } from "./hierarchie";
import type { Zoombaender } from "./zoombaender";

/**
 * Die Leiste von „Farben und Zoombänder“ (WI-0209 D2, D4; EDIT-0005 §3; T27 (4), (7)): die gemeinsame Leiste des Modus
 * (`fenster/fenster-modusleiste.vue`) oben mittig über der freien Karte, am Telefon unten. Darunter die Gesten und, nie sperrend, die
 * Befunde im Teilbaum (Lücken, Überlappungen; Probierblatt `befundSatz`): „Fertig“ schreibt trotzdem. Der Titel sagt, was der Entwurf
 * ändert: Zoombänder, Farben oder beides.
 */

const props = defineProps<{
    baender: Zoombaender;
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => props.baender.laufend.value);
const titel = computed(() => {
    const jetzt = lauf.value;
    if (jetzt?.farben === true && jetzt.spannen) return t("gebietseditor.farben.beidesTitel");
    return jetzt?.farben === true ? t("gebietseditor.farben.titel") : t("gebietseditor.baender.titel");
});
const hinweis = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return "";
    const gesten = [
        ...(jetzt.spannen || !jetzt.farben ? [t("gebietseditor.baender.gesten")] : []),
        ...(jetzt.farben ? [t("gebietseditor.farben.gesten")] : []),
    ].join(" ");
    const stand = hierarchieVon(mitEntwurf(jetzt.daten, props.baender.stand.value), jetzt.wurzel);
    if (stand === undefined) return gesten;
    const befund = befundeVon(stand);
    const teile = [
        ...(befund.gebiete > 0
            ? [
                  t("gebietseditor.baender.befund.luecke", {
                      baender: befund.baender.join(", "),
                      n: formatNumber(befund.gebiete, 0),
                  }),
              ]
            : []),
        ...(befund.ueberlappungen > 0
            ? [t("gebietseditor.baender.befund.ueber", { n: formatNumber(befund.ueberlappungen, 0) })]
            : []),
    ];
    return teile.length === 0
        ? gesten
        : `${gesten} ${t("gebietseditor.baender.hinweis", { liste: teile.join(" · ") })}`;
});
</script>

<template>
    <FensterModusleiste
        v-if="lauf !== undefined"
        zeichen="bearbeiten"
        :titel="titel"
        :objekt="lauf.name"
        :ungespeichert="lauf.ungespeichert"
        :zurueck="lauf.zurueck"
        :wieder="lauf.wieder"
        :fertig-grund="lauf.phase === 'speichert' ? t('landschaftseditor.ecken.speichert') : undefined"
        :gesten="hinweis"
        :frage="
            lauf.frage
                ? {
                      text: t('landschaftseditor.ecken.frage', { n: String(lauf.ungespeichert) }),
                      ja: t('modusleiste.verwerfen'),
                      nein: t('landschaftseditor.ecken.weiter'),
                  }
                : undefined
        "
        :telefon="phoneViewport"
        :rand="rand"
        testid="baender-leiste"
        @zurueck="baender.zurueck()"
        @wieder="baender.wieder()"
        @verwerfen="baender.verwerfen()"
        @fertig="void baender.fertig()"
        @antwort="(ja: boolean) => baender.antworte(ja)"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
