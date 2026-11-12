<script setup lang="ts">
import { ref, watch } from "vue";
import InhalteQuellenListe from "./inhalte-quellen-liste.vue";
import type { QuellenSteuerung } from "./inhalte-quellen-steuerung";
import InhalteQuellenStamm from "./inhalte-quellen-stamm.vue";
import InhalteQuellenVerwendungen from "./inhalte-quellen-verwendungen.vue";

/**
 * Der Reiter „Quellen“ des Fensters „Inhalte bearbeiten“ (WI-0254; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`):
 * drei Spalten, Katalog · Stammdaten · Beziehungen, die Zustand und Entwurf aus EINER Steuerung lesen (`inhalte-quellen-steuerung.ts`).
 *
 * - **Telefon:** Drill-down in drei Ebenen im selben Fenster (Liste → Stammdaten → Verwendungen), „‹“ führt zurück; eine Wahl in der Liste
 *   geht auf die Stammdaten.
 * - **Wechsel mit Änderungen:** Trägt der Entwurf Änderungen und wird eine andere Quelle gewählt, fragt eine Bestätigung oben in der Liste
 *   (`inhalte-quellen-liste.vue`). Ein Entwurf wandert nie auf eine andere Quelle.
 */
const props = defineProps<{
    steuerung: QuellenSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ oeffneKorpus: [korpusId: string] }>();

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
    <InhalteQuellenListe
        v-if="!telefon || ebene === 1"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @gewaehlt="ebene = 2"
    />
    <InhalteQuellenStamm
        v-if="!telefon || ebene === 2"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @oeffne-korpus="(korpusId: string) => emit('oeffneKorpus', korpusId)"
        @zurueck="ebene = 1"
        @weiter="ebene = 3"
    />
    <InhalteQuellenVerwendungen
        v-if="!telefon || ebene === 3"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @zurueck="ebene = 2"
    />
</template>
