<script setup lang="ts">
import { computed, ref } from "vue";
import type { EditorTerritoryDetail, TerritoryRetireBody } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import { formatNumber, t } from "../i18n/i18n";

/**
 * „Entfernen“ eines Herrschaftsgebiets (WI-0209 D3; EDIT-0005 §7 D3, Fragen 4 und 5; EDIT-0003 T22 Fassung 4, R13; Probierblatt
 * `entfernenBlatt`): zwei Stufen wie in jedem Editor, dazu was mit den Untergebieten geschieht, und vorher die Folgen. Steht im Fenster
 * (`AvmBestaetigung`, kein zweites Fenster); „Entfernen“ schreibt sofort (`territory.retire`), ↺ im Verlauf nimmt es zurück.
 *
 * - **Von der Karte nehmen:** Die eigenen Flächen gehen, das Gebiet bleibt im Baum, die Untergebiete darunter. Ohne eigene Fläche nicht.
 * - **Ganz löschen:** weich aus Karte und Baum; die Untergebiete gehen eine Ebene hoch, werden mitgelöscht oder Wurzeln. „Bleiben“ gibt es
 *   hier nicht: Sie zeigten sonst auf ein gelöschtes Gebiet (so macht es Legacy).
 */
const props = defineProps<{
    detail: EditorTerritoryDetail;
    kennung: string;
    /** Warum gerade nicht entfernt werden kann (eine laufende Bearbeitung, es wird geschrieben); fehlt: es geht. */
    gesperrt?: string | undefined;
}>();
const emit = defineEmits<{
    entfernen: [stage: TerritoryRetireBody["stage"], children: TerritoryRetireBody["children"]];
    abbrechen: [];
}>();

const eigeneFlaeche = computed(() => props.detail.areas.length > 0);
const obergebiet = computed(() => props.detail.parents[0]);
const kinder = computed(() => props.detail.children);
const stufe = ref<TerritoryRetireBody["stage"]>(eigeneFlaeche.value ? "off_map" : "retire");
const untergebiete = ref<NonNullable<TerritoryRetireBody["children"]>>(obergebiet.value ? "up" : "root");

const STUFEN = ["off_map", "retire"] as const;
const stufeTitel = (s: TerritoryRetireBody["stage"]): string =>
    s === "off_map" ? t("gebietseditor.entfernen.karte") : t("gebietseditor.entfernen.ganz");
const stufeSatz = (s: TerritoryRetireBody["stage"]): string =>
    s === "off_map"
        ? eigeneFlaeche.value
            ? t("gebietseditor.entfernen.karteSatz")
            : t("gebietseditor.entfernen.keineFlaeche")
        : t("gebietseditor.entfernen.ganzSatz");
const KINDER = ["up", "along", "root"] as const;
const kinderTitel = (k: NonNullable<TerritoryRetireBody["children"]>): string =>
    k === "up"
        ? obergebiet.value
            ? t("gebietseditor.entfernen.hochAn", { name: obergebiet.value.name })
            : t("gebietseditor.entfernen.hoch")
        : k === "along"
          ? t("gebietseditor.entfernen.mit")
          : t("gebietseditor.entfernen.eigen");

/** Die Folgen, wie im Probierblatt: Titel und Satz. */
const folgen = computed((): [string, string][] => {
    const z: [string, string][] = [];
    // Von der Wurzel her, wie in den Eigenschaften (die Daten nennen zuerst den Elter).
    const kette = props.detail.parents
        .slice()
        .reverse()
        .map((p) => p.name)
        .join(" › ");
    if (kette !== "") z.push([t("gebietseditor.entfernen.oberTitel"), t("gebietseditor.entfernen.ober", { kette })]);
    if (kinder.value.length > 0) {
        const n = formatNumber(kinder.value.length, 0);
        const satz =
            stufe.value === "off_map"
                ? t("gebietseditor.entfernen.kinderBleiben", { n, name: props.detail.name })
                : untergebiete.value === "up"
                  ? obergebiet.value
                      ? t("gebietseditor.entfernen.kinderHoch", { n, name: obergebiet.value.name })
                      : t("gebietseditor.entfernen.kinderEigen", { n })
                  : untergebiete.value === "along"
                    ? t("gebietseditor.entfernen.kinderMit", { n })
                    : t("gebietseditor.entfernen.kinderEigen", { n });
        z.push([t("gebietseditor.entfernen.unterTitel"), satz]);
    }
    if (stufe.value === "retire" && props.detail.capital !== undefined)
        z.push([
            t("infoPanel.field.capital"),
            t("gebietseditor.entfernen.hauptstadt", { name: props.detail.capital.name ?? "–" }),
        ]);
    z.push([t("gebietseditor.entfernen.karteTitel"), t("gebietseditor.entfernen.ableitung")]);
    z.push([t("gebietseditor.entfernen.verlaufTitel"), t("gebietseditor.entfernen.verlauf")]);
    return z;
});
const grund = computed(() =>
    props.gesperrt !== undefined
        ? props.gesperrt
        : stufe.value === "off_map" && !eigeneFlaeche.value
          ? t("gebietseditor.entfernen.keineFlaeche")
          : undefined,
);
function bestaetigen(): void {
    if (grund.value !== undefined) return;
    emit(
        "entfernen",
        stufe.value,
        stufe.value === "retire" && kinder.value.length > 0
            ? untergebiete.value === "up" && !obergebiet.value
                ? "root"
                : untergebiete.value
            : undefined,
    );
}
</script>

<template>
    <AvmBestaetigung
        :frage="t('gebietseditor.entfernen.frage', { name: detail.name })"
        :bestaetigen="t('gebietseditor.entfernen.knopf')"
        :gesperrt="grund"
        :testid="`${kennung}-entfernen`"
        @bestaetigen="bestaetigen"
        @abbrechen="emit('abbrechen')"
    >
        <div class="entfernen" role="radiogroup" :aria-label="t('gebietseditor.entfernen.stufe')">
            <AvmKaestchen
                v-for="s in STUFEN"
                :key="s"
                art="radio"
                :name="`${kennung}-entfernen-stufe`"
                mehrzeilig
                :checked="stufe === s"
                :gesperrt="s === 'off_map' && !eigeneFlaeche ? t('gebietseditor.entfernen.keineFlaeche') : undefined"
                :testid="`${kennung}-entfernen-${s}`"
                @change="stufe = s"
            >
                <span class="entfernen__text">
                    <strong>{{ stufeTitel(s) }}</strong>
                    <small>{{ stufeSatz(s) }}</small>
                </span>
            </AvmKaestchen>
        </div>
        <div
            v-if="stufe === 'retire' && kinder.length > 0"
            class="entfernen"
            role="radiogroup"
            :aria-label="t('gebietseditor.entfernen.unterTitel')"
        >
            <AvmKaestchen
                v-for="k in KINDER"
                :key="k"
                art="radio"
                :name="`${kennung}-entfernen-kinder`"
                :checked="untergebiete === k"
                :gesperrt="k === 'up' && !obergebiet ? t('gebietseditor.entfernen.keinOber') : undefined"
                :testid="`${kennung}-entfernen-kinder-${k}`"
                @change="untergebiete = k"
            >
                {{ kinderTitel(k) }}
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
