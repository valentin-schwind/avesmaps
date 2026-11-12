<script setup lang="ts">
import { computed } from "vue";
import type { EditorTerritoryDetail, EditorTerritoryDetailField } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import WikiFeld from "../fenster/wiki-feld.vue";
import { aufWikiWert } from "../fenster/wiki-feld";
import { t } from "../i18n/i18n";
import { felderAus, type GebietFelder } from "./gebiet-art";
import { DETAIL_MEHRZEILIG, DETAIL_NAMEN, detailLage, detailUnterschiede, tippeDetail } from "./gebiet-detailfelder";
import type { GebietBearbeitung } from "./gebietseditor-steuerung";

/**
 * Die Detailfelder eines Kastens als Zeilen des Wiki-Felds (WI-0209 G6; `fenster/wiki-feld.vue`, Design Guide §13.8, verbindlich): je
 * Feld die Beschriftung, dahinter bei Abweichung der Wiki-Wert durchgestrichen, das Feld, ↺ am Zeilenende. Mit einer Bearbeitung
 * schreibbar (Tippen ist manual und EIN Schritt bis zum Verlassen, ↺ setzt Wiki-Wert und Herkunft wiki als EIN Schritt, „Fertig“ schreibt
 * `territory.update`); ohne sie lesend, der Wiki-Wert bleibt als Auskunft.
 */

const props = defineProps<{
    felder: readonly EditorTerritoryDetailField[];
    detail: EditorTerritoryDetail;
    /** Die Bearbeitung, wenn geschrieben werden darf; ohne sie lesend. */
    bearbeitung?: GebietBearbeitung | undefined;
    kennung: string;
}>();

const stand = computed(() => props.bearbeitung?.stand.value);
const lesendeFelder = computed((): GebietFelder => felderAus(props.detail));
const jetzt = computed((): GebietFelder => stand.value?.felder ?? lesendeFelder.value);
const geaendert = computed(() => new Set(detailUnterschiede(lesendeFelder.value, jetzt.value)));
const schreibt = computed(() => props.bearbeitung !== undefined && stand.value !== undefined);

function tippe(feld: EditorTerritoryDetailField, wert: string): void {
    props.bearbeitung?.feld((f) => tippeDetail(f, lesendeFelder.value, feld, wert), feld);
}
function aufWiki(feld: EditorTerritoryDetailField): void {
    props.bearbeitung?.feld((f) => aufWikiWert(f, feld));
}
const text = (feld: EditorTerritoryDetailField): string => {
    const wert = jetzt.value[feld]?.trim() ?? "";
    return wert === "" ? "–" : wert;
};
</script>

<template>
    <div class="gebiet-wiki-felder">
        <WikiFeld
            v-for="feld in felder"
            :key="feld"
            :name="t(DETAIL_NAMEN[feld])"
            :fuer="schreibt ? `${kennung}-detail-${feld}-id` : undefined"
            :lage="detailLage(jetzt, feld, !schreibt)"
            :geaendert="geaendert.has(feld)"
            :oben="schreibt && DETAIL_MEHRZEILIG.has(feld)"
            :testid="`${kennung}-zeile-${feld}`"
            @zurueck="aufWiki(feld)"
        >
            <template v-if="schreibt && bearbeitung">
                <AvmTextbereich
                    v-if="DETAIL_MEHRZEILIG.has(feld)"
                    :id="`${kennung}-detail-${feld}-id`"
                    :model-value="jetzt[feld] ?? ''"
                    :zeilen="3"
                    :testid="`${kennung}-detail-${feld}`"
                    @update:model-value="(wert: string) => tippe(feld, wert)"
                    @blur="bearbeitung.feldVerlassen()"
                />
                <AvmEingabe
                    v-else
                    :id="`${kennung}-detail-${feld}-id`"
                    :model-value="jetzt[feld] ?? ''"
                    :testid="`${kennung}-detail-${feld}`"
                    @update:model-value="(wert: string) => tippe(feld, wert)"
                    @blur="bearbeitung.feldVerlassen()"
                />
            </template>
            <span v-else class="gebiet-wiki-felder__text" :data-testid="`${kennung}-detail-${feld}`">{{
                text(feld)
            }}</span>
        </WikiFeld>
    </div>
</template>

<style scoped>
.gebiet-wiki-felder {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.gebiet-wiki-felder__text {
    overflow-wrap: anywhere;
}
</style>
