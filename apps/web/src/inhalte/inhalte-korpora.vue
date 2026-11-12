<script setup lang="ts">
import { ref, watch } from "vue";
import InhalteKorporaListe from "./inhalte-korpora-liste.vue";
import InhalteKorporaQuellen from "./inhalte-korpora-quellen.vue";
import InhalteKorporaStamm from "./inhalte-korpora-stamm.vue";
import type { KorporaSteuerung } from "./inhalte-korpora-steuerung";

/**
 * Der Reiter „Korpora“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 4; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`): drei Spalten, Katalog ·
 * Stammdaten · Quellen im Korpus, die Zustand und Entwurf aus EINER Steuerung lesen (`inhalte-korpora-steuerung.ts`).
 *
 * - **Telefon:** Drill-down in drei Ebenen im selben Fenster (Liste → Stammdaten → Quellen), „‹“ führt zurück; eine Wahl in der Liste geht auf die Stammdaten.
 * - **Wechsel mit Änderungen:** Trägt der Entwurf Änderungen und wird ein anderer Korpus gewählt, fragt eine Bestätigung oben in der Liste. Ein Entwurf
 *   wandert nie auf einen anderen Korpus.
 * - **Öffnen einer Quelle** springt in den Reiter Quellen (das Fenster wechselt den Reiter und wählt die Quelle).
 */
const props = defineProps<{
    steuerung: KorporaSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ oeffneQuelle: [sourceId: string] }>();

const s = props.steuerung;
const ebene = ref<1 | 2 | 3>(1);
// Eine neue Wahl führt auf dem Telefon zu den Stammdaten; die erste, vom Fenster selbst getroffene bleibt bei der Liste.
watch(
    () => s.gewaehlt.value,
    (id, alt) => {
        if (id !== undefined && alt !== undefined && props.telefon) ebene.value = 2;
    },
);
</script>

<template>
    <InhalteKorporaListe
        v-if="!telefon || ebene === 1"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @gewaehlt="ebene = 2"
    />
    <InhalteKorporaStamm
        v-if="!telefon || ebene === 2"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @zurueck="ebene = 1"
        @weiter="ebene = 3"
    />
    <InhalteKorporaQuellen
        v-if="!telefon || ebene === 3"
        :steuerung="steuerung"
        :telefon="telefon"
        @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
        @zurueck="ebene = 2"
    />
</template>
