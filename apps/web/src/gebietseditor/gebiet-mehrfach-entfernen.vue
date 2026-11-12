<script setup lang="ts">
import { computed, ref } from "vue";
import type { EditorTerritoryRow, TerritoryRetireBody } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import { formatNumber, locale, t, tPlural } from "../i18n/i18n";
import { untergebieteHoch } from "./gebiet-sammel";

/**
 * „Entfernen …“ für mehrere Herrschaftsgebiete (EDIT-0003 T57; Fassung 5, `blattEntfernen`): die zwei Stufen wie am einzelnen
 * (`gebiet-entfernen.vue`), ohne die Wahl für die Untergebiete: Die nicht gewählten rücken eine Ebene hoch. Schreibt sofort EINE
 * Operation für alle (`territory.retire` für mehrere); ↺ im Verlauf eines jeden holt alle zurück.
 */
const props = defineProps<{
    gewaehlte: readonly EditorTerritoryRow[];
    /** Alle Gebiete der Liste: daraus die Untergebiete, die nicht gewählt sind. */
    zeilen: readonly EditorTerritoryRow[];
    kennung: string;
    gesperrt?: string | undefined;
}>();
const emit = defineEmits<{ entfernen: [stage: TerritoryRetireBody["stage"]]; abbrechen: [] }>();

const n = computed(() => props.gewaehlte.length);
const mitFlaeche = computed(() => props.gewaehlte.filter((z) => z.area === true));
/** Gewählte Gebiete mit nicht gewählten Untergebieten, die meisten zuerst; die rücken hoch. Nur ein Hinweis, keine Sperre. */
const mitUntergebieten = computed(() => untergebieteHoch(props.gewaehlte, props.zeilen));
const mitKindern = computed(() => mitUntergebieten.value.length > 0);
const stufe = ref<TerritoryRetireBody["stage"]>("retire");
const STUFEN = ["off_map", "retire"] as const;

/** Bis zu drei Einträge als Aufzählung, bei mehr die ersten drei und „und n weitere“. */
const aufzaehlung = (texte: readonly string[]): string => {
    const liste = new Intl.ListFormat(locale.value, { type: "conjunction" });
    return texte.length <= 3
        ? liste.format(texte)
        : `${texte.slice(0, 3).join(", ")} ${t("gebietseditor.sammel.weitere", { n: formatNumber(texte.length - 3, 0) })}`;
};
const namen = (zeilen: readonly EditorTerritoryRow[]): string => aufzaehlung(zeilen.map((z) => z.name));
/** „Thorwal (11 Untergebiete rücken hoch)“ je betroffenem Gebiet. */
const hochNamen = computed(() =>
    aufzaehlung(
        mitUntergebieten.value.map((e) =>
            tPlural("gebietseditor.sammel.untergebieteHoch", e.n, { name: e.name, n: formatNumber(e.n, 0) }),
        ),
    ),
);
const stufeSatz = (s: TerritoryRetireBody["stage"]): string =>
    s === "off_map"
        ? mitFlaeche.value.length > 0
            ? t("gebietseditor.sammel.karteSatz", { n: formatNumber(mitFlaeche.value.length, 0) })
            : t("gebietseditor.sammel.keineFlaeche")
        : t("gebietseditor.entfernen.ganzSatz");
const folgen = computed((): [string, string][] => {
    const z: [string, string][] = [];
    if (stufe.value === "off_map") z.push([t("gebietseditor.sammel.imBaumTitel"), t("gebietseditor.sammel.imBaum")]);
    else {
        if (mitFlaeche.value.length > 0)
            z.push([
                t("gebietseditor.sammel.mitFlaecheTitel"),
                t("gebietseditor.sammel.mitFlaeche", { namen: namen(mitFlaeche.value) }),
            ]);
        if (mitKindern.value)
            z.push([
                t("gebietseditor.entfernen.unterTitel"),
                `${t("gebietseditor.sammel.kinderHoch")} ${t("gebietseditor.sammel.kinderHochNamen", { namen: hochNamen.value })}`,
            ]);
    }
    z.push([t("gebietseditor.entfernen.karteTitel"), t("gebietseditor.entfernen.ableitung")]);
    z.push([t("gebietseditor.entfernen.verlaufTitel"), t("gebietseditor.sammel.verlauf")]);
    return z;
});
const frage = computed(() =>
    stufe.value === "off_map"
        ? t("gebietseditor.sammel.entfernenFrageKarte", { n: formatNumber(mitFlaeche.value.length, 0) })
        : t("gebietseditor.sammel.entfernenFrage", { n: formatNumber(n.value, 0) }),
);
const grund = computed(() =>
    props.gesperrt !== undefined
        ? props.gesperrt
        : stufe.value === "off_map" && mitFlaeche.value.length === 0
          ? t("gebietseditor.sammel.keineFlaeche")
          : undefined,
);
</script>

<template>
    <AvmBestaetigung
        :frage="frage"
        :bestaetigen="t('gebietseditor.entfernen.knopf')"
        :gesperrt="grund"
        :testid="`${kennung}-mehrfach-entfernen`"
        @bestaetigen="grund === undefined && emit('entfernen', stufe)"
        @abbrechen="emit('abbrechen')"
    >
        <div class="entfernen" role="radiogroup" :aria-label="t('gebietseditor.entfernen.stufe')">
            <AvmKaestchen
                v-for="s in STUFEN"
                :key="s"
                art="radio"
                :name="`${kennung}-mehrfach-entfernen-stufe`"
                mehrzeilig
                :checked="stufe === s"
                :gesperrt="
                    s === 'off_map' && mitFlaeche.length === 0 ? t('gebietseditor.sammel.keineFlaeche') : undefined
                "
                :testid="`${kennung}-mehrfach-entfernen-${s}`"
                @change="stufe = s"
            >
                <span class="entfernen__text">
                    <strong>{{
                        s === "off_map" ? t("gebietseditor.entfernen.karte") : t("gebietseditor.entfernen.ganz")
                    }}</strong>
                    <small>{{ stufeSatz(s) }}</small>
                </span>
            </AvmKaestchen>
        </div>
        <ul class="entfernen__folgen" :data-testid="`${kennung}-mehrfach-entfernen-folgen`">
            <li v-for="([titel, satz], i) in folgen" :key="i">
                <b>{{ titel }}:</b> {{ satz }}
            </li>
        </ul>
    </AvmBestaetigung>
</template>

<style scoped>
/* Wie am einzelnen Gebiet (`gebiet-entfernen.vue`). */
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
