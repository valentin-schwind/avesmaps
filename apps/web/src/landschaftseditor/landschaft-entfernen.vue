<script setup lang="ts">
import { computed, ref } from "vue";
import type { LandscapeRetireBody } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import { formatNumber, t } from "../i18n/i18n";

/**
 * „Fläche entfernen …“ einer Derographie-Fläche (WI-0178 D2; EDIT-0004 §2.6, FL6; EDIT-0003 T22 Fassung 4, T43, T54; Muster
 * `gebietseditor/gebiet-entfernen.vue`): zwei Stufen wie in jedem Editor und vorher die Folgen. Steht im Fenster (`AvmBestaetigung`, kein
 * zweites Fenster); „Entfernen“ schreibt sofort (`landscape.retire`), ↺ im Verlauf nimmt es zurück.
 *
 * - **Von der Karte nehmen:** Fläche, Teilflächen und Beschriftungen gehen von der Karte; sie steht danach unter „Nicht auf der Karte“.
 * - **Ganz löschen:** dasselbe, weich gelöscht; sie steht danach unter „Gelöscht“.
 */
const props = defineProps<{
    /** Die Frage: „„Farindel“ entfernen?“, in der Mehrfachauswahl „3 Flächen entfernen?“ (EDIT-0003 T57). */
    frage: string;
    /** Was mitgeht, über alle zu entfernenden Flächen. */
    flaechen: number;
    beschriftungen: number;
    /** Gipfel der Mehrfachauswahl: Sie werden gelöscht, die Stufe gilt nur für Landschaften; nur Gipfel: keine Stufe. */
    gipfel?: number | undefined;
    nurGipfel?: boolean | undefined;
    kennung: string;
    /** Warum gerade nicht entfernt werden kann (eine laufende Bearbeitung, es wird geschrieben); fehlt: es geht. */
    gesperrt?: string | undefined;
}>();
const emit = defineEmits<{
    entfernen: [stage: LandscapeRetireBody["stage"]];
    abbrechen: [];
}>();

const STUFEN = ["off_map", "retire"] as const;
const stufe = ref<LandscapeRetireBody["stage"]>("off_map");
const stufeTitel = (s: LandscapeRetireBody["stage"]): string =>
    s === "off_map" ? t("landschaftseditor.entfernen.karte") : t("landschaftseditor.entfernen.ganz");
const stufeSatz = (s: LandscapeRetireBody["stage"]): string =>
    s === "off_map" ? t("landschaftseditor.entfernen.karteSatz") : t("landschaftseditor.entfernen.ganzSatz");

/** Die Folgen: was mitgeht und wie es zurückkommt. */
const folgen = computed((): [string, string][] => [
    ...(props.nurGipfel
        ? []
        : [
              [
                  t("landschaftseditor.entfernen.teileTitel"),
                  t("landschaftseditor.entfernen.teile", {
                      flaechen: formatNumber(props.flaechen, 0),
                      beschriftungen: formatNumber(props.beschriftungen, 0),
                  }),
              ] as [string, string],
          ]),
    ...((props.gipfel ?? 0) > 0
        ? [
              [
                  t("landschaftseditor.entfernen.gipfelTitel"),
                  t("landschaftseditor.entfernen.gipfel", { n: formatNumber(props.gipfel ?? 0, 0) }),
              ] as [string, string],
          ]
        : []),
    [t("landschaftseditor.entfernen.verlaufTitel"), t("landschaftseditor.entfernen.verlauf")],
]);
</script>

<template>
    <AvmBestaetigung
        :frage="frage"
        :bestaetigen="t('landschaftseditor.entfernen.knopf')"
        :gesperrt="gesperrt"
        :testid="`${kennung}-entfernen`"
        @bestaetigen="emit('entfernen', nurGipfel ? 'retire' : stufe)"
        @abbrechen="emit('abbrechen')"
    >
        <div v-if="!nurGipfel" class="entfernen" role="radiogroup" :aria-label="t('landschaftseditor.entfernen.stufe')">
            <AvmKaestchen
                v-for="s in STUFEN"
                :key="s"
                art="radio"
                :name="`${kennung}-entfernen-stufe`"
                mehrzeilig
                :checked="stufe === s"
                :testid="`${kennung}-entfernen-${s}`"
                @change="stufe = s"
            >
                <span class="entfernen__text">
                    <strong>{{ stufeTitel(s) }}</strong>
                    <small>{{ stufeSatz(s) }}</small>
                </span>
            </AvmKaestchen>
        </div>
        <ul class="entfernen__folgen" :data-testid="`${kennung}-entfernen-folgen`">
            <li v-for="([titel, satz], i) in folgen" :key="i">
                <b>{{ titel }}:</b> {{ satz }}
            </li>
        </ul>
    </AvmBestaetigung>
</template>

<style scoped>
.entfernen {
    display: grid;
    gap: var(--space-4);
}

.entfernen__text {
    display: grid;
}

.entfernen__text small {
    color: var(--color-text-muted);
}

.entfernen__folgen {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-12);
}
</style>
