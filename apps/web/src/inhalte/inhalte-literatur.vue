<script setup lang="ts">
import { ref, watch } from "vue";
import InhalteLiteraturListe from "./inhalte-literatur-liste.vue";
import InhalteLiteraturOrte from "./inhalte-literatur-orte.vue";
import InhalteLiteraturStamm from "./inhalte-literatur-stamm.vue";
import type { LiteraturSteuerung } from "./inhalte-literatur-steuerung";

/**
 * Der Reiter „Literatur“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 2; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`):
 * drei Spalten, Katalog · Stammdaten · Orte und Gebiete, die Zustand und Entwurf aus EINER Steuerung lesen
 * (`inhalte-literatur-steuerung.ts`).
 *
 * - **Telefon:** Drill-down in drei Ebenen im selben Fenster (Liste → Stammdaten → Orte), „‹“ führt zurück; eine Wahl in der Liste geht
 *   auf die Stammdaten.
 * - **Wechsel mit Änderungen:** Trägt der Entwurf Änderungen und wird ein anderes Werk gewählt, fragt eine Bestätigung oben in der Liste.
 *   Ein Entwurf wandert nie auf ein anderes Werk.
 */
const props = defineProps<{
    steuerung: LiteraturSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();

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
    <InhalteLiteraturListe
        v-if="!telefon || ebene === 1"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @gewaehlt="ebene = 2"
    />
    <InhalteLiteraturStamm
        v-if="!telefon || ebene === 2"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @zurueck="ebene = 1"
        @weiter="ebene = 3"
    />
    <InhalteLiteraturOrte
        v-if="!telefon || ebene === 3"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @zurueck="ebene = 2"
    />
</template>
