<script setup lang="ts">
import { ref, watch } from "vue";
import InhalteRegelnText from "./inhalte-regeln-text.vue";
import type { RegelTextSteuerung } from "./inhalte-regeln-text-steuerung";
import InhalteVorkommenListe from "./inhalte-vorkommen-liste.vue";
import InhalteVorkommenOrte from "./inhalte-vorkommen-orte.vue";
import InhalteVorkommenStamm from "./inhalte-vorkommen-stamm.vue";
import type { VorkommenSteuerung } from "./inhalte-vorkommen-steuerung";

/**
 * Der Reiter „Vorkommen“ des Fensters „Inhalte bearbeiten“ (WI-0254, Runde 3; Mockup `review/wi-0254/inhalte-editor-korpora-mockup.html`):
 * drei Spalten, Katalog · Stammdaten · Verbreitung und Herkunft, die Zustand und Entwurf aus EINER Steuerung lesen
 * (`inhalte-vorkommen-steuerung.ts`).
 *
 * - **Telefon:** Drill-down in drei Ebenen im selben Fenster (Liste → Stammdaten → Orte), „‹“ führt zurück; eine Wahl in der Liste geht
 *   auf die Stammdaten.
 * - **Wechsel mit Änderungen:** Trägt der Entwurf Änderungen und wird ein anderer Eintrag gewählt, fragt eine Bestätigung oben in der Liste.
 *   Ein Entwurf wandert nie auf einen anderen Eintrag.
 * - **Öffnen einer Quelle** springt in den Reiter Quellen (das Fenster wechselt den Reiter und wählt die Quelle).
 * - **„Regeln als Text“** (WI-0254 §13; `inhalte-regeln-text.vue`): Das Zeichen in der Leiste der Liste und „Als Text“ am Regel-Abschnitt eines Eintrags öffnen die Ansicht (`regelText.offen`); sie steht an der
 *   Stelle von Stammdaten und Orten, die Liste bleibt. Am Telefon ist sie eine eigene Ebene: Die Liste tritt zurück, und „‹ Vorkommen“ führt dorthin.
 */
const props = defineProps<{
    steuerung: VorkommenSteuerung;
    regelText: RegelTextSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ oeffneQuelle: [sourceId: string] }>();

const s = props.steuerung;
const ebene = ref<1 | 2 | 3>(1);
/** „Als Text“ am Regel-Abschnitt des gewählten Eintrags: seine Regeln als Block an den Text, die Ansicht öffnet. */
function alsText(): void {
    const id = s.gewaehlt.value;
    if (id !== undefined) void props.regelText.alsText(id);
}
// Eine neue Wahl führt auf dem Telefon zu den Stammdaten; die erste, vom Fenster selbst getroffene bleibt bei der Liste.
watch(
    () => s.gewaehlt.value,
    (id, alt) => {
        if (id !== undefined && alt !== undefined && props.telefon) ebene.value = 2;
    },
);
</script>

<template>
    <InhalteVorkommenListe
        v-if="!telefon || (!regelText.offen.value && ebene === 1)"
        :steuerung="steuerung"
        :regel-text="regelText"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @gewaehlt="ebene = 2"
    />
    <InhalteRegelnText
        v-if="regelText.offen.value"
        :steuerung="regelText"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @schliesse="ebene = 1"
    />
    <InhalteVorkommenStamm
        v-if="!regelText.offen.value && (!telefon || ebene === 2)"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
        @zurueck="ebene = 1"
        @weiter="ebene = 3"
    />
    <InhalteVorkommenOrte
        v-if="!regelText.offen.value && (!telefon || ebene === 3)"
        :steuerung="steuerung"
        :darf-schreiben="darfSchreiben"
        :telefon="telefon"
        @zurueck="ebene = 2"
        @als-text="alsText"
    />
</template>
