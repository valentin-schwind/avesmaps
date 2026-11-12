<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import FensterModusleiste from "../fenster/fenster-modusleiste.vue";
import { t } from "../i18n/i18n";
import type { Unterflaechen } from "./unterflaechen";

/**
 * Die Leiste von „Unterfläche herauslösen“ und „Unterfläche löschen …“ (Werkzeug 3, Thomas 4.1): die gemeinsame Leiste des Modus
 * (`fenster/fenster-modusleiste.vue`). Titel ist der Eintrag des Menüs, dahinter die Landschaft und das gewählte Stück („Teil 2 von 3“);
 * „Fertig“ schreibt sofort (Ausnahme von G4 wie „Mit anderer Fläche“), Esc bricht ab.
 */

const props = defineProps<{
    unterflaechen: Unterflaechen;
    rand?: { links: number; rechts: number; imFenster?: boolean } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => props.unterflaechen.laufend.value);
/** Der Eintrag ohne seine Auslassungspunkte: In der Leiste folgt nichts mehr. */
const titel = computed(() =>
    lauf.value === undefined
        ? ""
        : t(
              lauf.value.operation === "herausloesen"
                  ? "landschaftseditor.griff.unterHerausloesen"
                  : "landschaftseditor.griff.unterLoeschen",
          ).replace(/\s*…$/, ""),
);
const objekt = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return "";
    return jetzt.gewaehlt === undefined
        ? jetzt.name
        : `${jetzt.name} · ${t("landschaftseditor.unterflaechen.teil", { n: String(jetzt.gewaehlt + 1), von: String(jetzt.teile.length) })}`;
});
const fertigGrund = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return undefined;
    if (jetzt.phase === "schreibt") return t("neueFlaeche.speichert");
    return jetzt.gewaehlt === undefined ? t("landschaftseditor.unterflaechen.waehle") : undefined;
});
</script>

<template>
    <FensterModusleiste
        v-if="lauf !== undefined"
        :zeichen="lauf.operation === 'herausloesen' ? 'herausloesen' : 'loeschen'"
        :titel="titel"
        :objekt="objekt"
        :ungespeichert="0"
        :zurueck="false"
        :wieder="false"
        :fertig-grund="fertigGrund"
        :gesten="
            phoneViewport
                ? t('landschaftseditor.unterflaechen.gestenFinger')
                : t('landschaftseditor.unterflaechen.gesten')
        "
        :telefon="phoneViewport"
        :rand="rand"
        testid="unterflaechen-leiste"
        @verwerfen="unterflaechen.abbrechen()"
        @fertig="void unterflaechen.bestaetige()"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
