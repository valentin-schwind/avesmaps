<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import { objektName } from "./medien-text";

/** Die Liste der Redaktion (WI-0275) lädt erst, wenn dieser Eingang gewählt ist: Sie gehört seit WI-0305 nur noch hierher. */
const KartenvorschlaegeListe = defineAsyncComponent(() => import("../community/kartenvorschlaege-liste.vue"));

/**
 * Spalte 2 für das Medienobjekt „Kartenvorschläge“ (WI-0068 OPS-000093, Eingänge): die Liste der Redaktion mit den Segmenten Offen · Angenommen · Abgelehnt, ihrer Suche und ihrer Legende. Ein Klick wählt den Vorschlag für Spalte 3
 * (`medien-vorschlag.vue`); in Community stehen dieselben Vorschläge bei den Meldungen (WI-0305) und öffnen dort das Werkzeugfenster der Redaktion. Die Zahl an der Schiene und die Liste lesen
 * nach jedem Annehmen und Ablehnen neu (`redaktion.geaendert()`).
 */
defineProps<{
    gewaehlt: string | undefined;
    telefon: boolean;
}>();
const emit = defineEmits<{ waehle: [id: string]; zurueck: [] }>();
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="objektName('kartenvorschlaege')"
        :unterzeile="t('medien.vorschlaege.unterzeile')"
        testid="medien-spalte-vorschlaege"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-arten" @click="emit('zurueck')">{{
                t("medien.zurueck.arten")
            }}</AvmKnopf>
        </template>
        <KartenvorschlaegeListe sichtbar :gewaehlt="gewaehlt" @waehle="(id: string) => emit('waehle', id)" />
    </FensterSpalte>
</template>
