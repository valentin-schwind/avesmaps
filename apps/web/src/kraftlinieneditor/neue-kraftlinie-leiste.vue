<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import FensterModusleiste from "../fenster/fenster-modusleiste.vue";
import { t } from "../i18n/i18n";
import { nodixName } from "./neue-kraftlinie-anbindung";
import type { NeueKraftlinie } from "./neue-kraftlinie";

/**
 * Die Leiste von „Neue Kraftlinie“ (WI-0205 K9; EDIT-0003 §2a, R8): die gemeinsame Leiste des Modus (`fenster/fenster-modusleiste.vue`)
 * oben mittig über der freien Karte, am Telefon unten. Ungespeichert ist nie etwas: Der Klick auf den zweiten Nodix schreibt sofort;
 * „Fertig“ sagt bis dahin, warum es noch nicht geht.
 */

const props = defineProps<{
    neueKraftlinie: NeueKraftlinie;
    /** Was die Panels links und rechts von der Karte decken (`VisibleArea.covered`). */
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => props.neueKraftlinie.laufend.value);
const fertigGrund = computed(() => {
    const jetzt = lauf.value;
    if (jetzt === undefined) return undefined;
    if (jetzt.phase === "speichert") return t("kraftlinieneditor.bearbeiten.speichert");
    return jetzt.stand.fertig === undefined ? undefined : t("kraftlinieneditor.neu.grund");
});
</script>

<template>
    <FensterModusleiste
        v-if="lauf !== undefined && lauf.phase !== 'laedt'"
        zeichen="neue-kraftlinie"
        :titel="t('ortseditor.handgriff.kraftlinie')"
        :objekt="
            lauf.offen
                ? t('kraftlinieneditor.neu.ersterNodix')
                : t('kraftlinieneditor.neu.ab', { name: nodixName(lauf.von) })
        "
        :ungespeichert="0"
        :zurueck="false"
        :wieder="false"
        :fertig-grund="fertigGrund"
        :gesten="phoneViewport ? t('kraftlinieneditor.neu.gestenFinger') : t('kraftlinieneditor.neu.gesten')"
        :telefon="phoneViewport"
        :rand="rand"
        testid="neue-kraftlinie-leiste"
        @verwerfen="neueKraftlinie.verwerfen()"
        @fertig="neueKraftlinie.fertig()"
        @hoehe="(px: number) => emit('hoehe', px)"
    />
</template>
