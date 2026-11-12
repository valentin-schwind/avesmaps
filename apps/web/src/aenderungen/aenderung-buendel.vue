<script setup lang="ts">
import { computed } from "vue";
import AenderungEintrag from "./aenderung-eintrag.vue";
import type { Buendel } from "./aenderung-gruppen";
import { besitzerSerie, karteTitel, statusText } from "./aenderung-karte-zeigen";
import { kannLageHaben } from "./aenderung-lage-modell";
import AenderungZeile from "./aenderung-zeile.vue";
import { buendelAngaben, type ZeilenOrt } from "./aenderung-zeile-modell";
import { useAenderungenKontext } from "./aenderungen-kontext";
import { zeigtKarte } from "./karte-ablage";

/**
 * Die Läufe des WikiSync oder des Imports eines Tages als EINE gedämpfte Zeile (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`, gewählt am 2026-11-01: „Wiki- und Importläufe -> A“): „Wiki-Abgleich · 2 Läufe · 610 Felder ▸“.
 * Aufgeklappt stehen die Läufe als Zeilen an einer Schiene, mit Person (wenn ein Mensch sie auslöste, unter „Alle“) und jeder mit ⊕ und ihrem eigenen Detail samt ↺ des WikiSync. Das Bündel selbst hat kein Detail und kein ↺:
 * Es ist eine Ansicht der Läufe, keine Änderung. Am Telefon zeigt der Reiter die Läufe statt der Liste (`nurDetail`).
 */
const props = defineProps<{
    buendel: Buendel;
    nurDetail?: boolean | undefined;
}>();

const kontext = useAenderungenKontext();
const offen = computed(() => kontext.ist(props.buendel.schluessel));
const angaben = computed(() => buendelAngaben(props.buendel));
const besitzer = computed(() => besitzerSerie(kontext.kennung, props.buendel.schluessel));
const ort = computed<ZeilenOrt | undefined>(() =>
    props.buendel.eintraege.some((eintrag) => kannLageHaben(eintrag.objects))
        ? {
              titel: karteTitel(besitzer.value),
              gedrueckt: zeigtKarte(besitzer.value),
              status: statusText(besitzer.value),
              testid: `${kontext.kennung}-buendel-karte-griff`,
          }
        : undefined,
);
const zeigtLaeufe = computed(() => props.nurDetail === true || offen.value);
</script>

<template>
    <component
        :is="nurDetail ? 'div' : 'li'"
        :class="nurDetail ? undefined : 'buendel'"
        :data-testid="nurDetail ? undefined : 'editorpanel-aenderung-buendel'"
    >
        <AenderungZeile
            v-if="!nurDetail"
            :angaben="angaben"
            :offen="offen"
            :ort="ort"
            buendel
            testid="editorpanel-aenderung-buendel-zeile"
            @waehle="kontext.schalte(buendel.schluessel, true)"
            @ort="kontext.zeigeSerieAufKarte(besitzer, buendel.eintraege)"
        />
        <div v-if="zeigtLaeufe" class="buendel__detail">
            <ol class="buendel__laeufe">
                <AenderungEintrag
                    v-for="eintrag in buendel.eintraege"
                    :key="eintrag.operationId"
                    :eintrag="eintrag"
                    mitglied
                    ohne-etikett
                />
            </ol>
        </div>
    </component>
</template>

<style scoped>
.buendel {
    border-bottom: 1px solid var(--color-border);
}

/* Wie das Detail einer Änderung: getönte Fläche, links die Schiene in der Akzentfarbe; die Läufe reichen bis an die Ränder. */
.buendel__detail {
    border-left: var(--avm-fenster-schiene-kante) solid var(--color-accent);
    background: var(--color-panel-soft);
}

.buendel__laeufe {
    margin: 0;
    padding: 0;
    list-style: none;
}
</style>
