<script setup lang="ts">
import { computed, inject, onMounted, ref, useId, useTemplateRef } from "vue";
import {
    landscapeTypesOfLayer,
    type EditorLandscapeDetail,
    type EditorLandscapeLayer,
    type EditorLandscapeRow,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import { isMessageKey, locale, t } from "../i18n/i18n";
import {
    NEUE_SPRACHE,
    SPRACH_KOPIE,
    START_WAHL as SPRACH_START,
    type SprachKopierWahl,
} from "../spracheditor/sprachflaeche-kopieren";
import {
    kopierPlan,
    loeschFolge,
    SPRACHEN_ZIEL,
    sprachPlan,
    startWahl,
    wikiSatz,
    zielEbenen,
    zielLandschaften,
    type KopierWahl,
    type KopierZiel,
} from "./landschaft-kopieren";
import { artName } from "./landschaften-liste";

/**
 * Das Blatt „Fläche kopieren“ im Fenster der Quelle (WI-0178 Werkzeug 8, Betreiber 2026-10-19 wörtlich: „wie legacy B mit haken“; Legacy
 * `index.html#ecosystem-transfer-dialog`). Steht im Fenster wie „Fläche entfernen …“ (kein zweites Fenster): Zielebene, Ziellandschaft,
 * bei einer neuen Name und Art, der Haken „Originalfläche löschen“ mit seiner Folge, dann „Abbrechen“ und „Kopieren“. Die Regeln stehen in
 * `landschaft-kopieren.ts`; geschrieben wird EINE Operation `landscape.copy`. Esc bricht das Blatt ab, nicht das Fenster.
 *
 * Ziel „Sprachen“ (WI-0261, „Ja, bauen“; nur mit Anbindung des Spracheditors und Recht an den Sprachen, `SPRACH_KOPIE`): Zielsprache oder „Neue Sprache …“ mit
 * Namen wie im Kopierblatt des Spracheditors; „Kopieren“ schreibt über den Spracheditor (`sprache.flaeche_aus_landschaft`), danach steht er an der Zielsprache
 * mit der neuen Teilfläche gewählt, und das Blatt geht zu. Für die Ziele in Landschaften bleibt alles, wie es war.
 */
const props = defineProps<{
    detail: EditorLandscapeDetail;
    /** Die Teilfläche, die kopiert wird (unter dem Kartenmenü). */
    areaId: string;
    /** Alle Landschaften (die Liste des Fensters), für die Ziellandschaft. */
    zeilen: readonly EditorLandscapeRow[];
    kennung: string;
    /** Warum gerade nicht kopiert werden kann (es wird geschrieben, eine Bearbeitung läuft); fehlt: es geht. */
    gesperrt?: string | undefined;
    /** Der Satz des Servers, wenn es nicht ging. */
    fehler?: string | undefined;
}>();
const emit = defineEmits<{ kopieren: [ziel: KopierZiel]; abbrechen: [] }>();

const wahl = ref<KopierWahl>(startWahl(props.detail));
/** Das Ziel Sprache (WI-0261): gewählt, die Wahl darin, ein Schreiben läuft. */
const sprachKopie = inject(SPRACH_KOPIE, undefined);
const zuSprache = ref(false);
const sprachWahl = ref<Omit<SprachKopierWahl, "loeschen">>({ ziel: SPRACH_START.ziel, name: SPRACH_START.name });
const sprachSendet = ref(false);
const eigenerFehler = ref<string | undefined>(undefined);
const titelId = useId();
const ebeneFeld = useTemplateRef<InstanceType<typeof AvmAuswahl>>("ebeneFeld");
onMounted(() => (ebeneFeld.value?.$el as HTMLElement | undefined)?.querySelector("select")?.focus());

const ebeneName = (ebene: string): string => {
    const key = `layer.${ebene}`;
    return isMessageKey(key) ? t(key) : ebene;
};
const ebenen = computed(() =>
    zielEbenen(props.detail.layer, sprachKopie?.darf() === true).map((ebene) => ({
        wert: ebene,
        text:
            ebene === props.detail.layer
                ? t("landschaftseditor.kopieren.eigeneEbene", { ebene: ebeneName(ebene) })
                : ebeneName(ebene),
    })),
);
const ziele = computed(() => [
    { wert: "", text: t("landschaftseditor.kopieren.neu") },
    ...zielLandschaften(props.zeilen, wahl.value.ebene, locale.value).map((zeile) => ({
        wert: zeile.id,
        text: zeile.id === props.detail.id ? t("landschaftseditor.kopieren.eigene", { name: zeile.name }) : zeile.name,
    })),
]);
const sprachZiele = computed(() => [
    { wert: "", text: t("spracheditor.artikel.waehlen"), gesperrt: true },
    { wert: NEUE_SPRACHE, text: t("spracheditor.kopieren.neu") },
    ...(sprachKopie?.sprachen() ?? []).map((sprache) => ({ wert: sprache.id, text: sprache.name })),
]);
const arten = computed(() => [
    { wert: "", text: t("landschaftseditor.kopieren.ohneArt") },
    ...landscapeTypesOfLayer(wahl.value.ebene)
        .map((art) => ({ wert: art, text: artName(art) }))
        .sort((a, b) => a.text.localeCompare(b.text, locale.value)),
]);
/** Welche Teilfläche, wenn die Landschaft mehrere hat. */
const quelle = computed(() => {
    const nr = props.detail.areas.findIndex((area) => area.id === props.areaId) + 1;
    return props.detail.areas.length > 1
        ? t("landschaftseditor.kopieren.quelleTeil", {
              name: props.detail.name,
              nr: String(nr),
              zahl: String(props.detail.areas.length),
          })
        : props.detail.name;
});
const wiki = computed(() => wikiSatz(props.detail, wahl.value));
const folge = computed(() => loeschFolge(props.detail, wahl.value));

function setze(neu: Partial<KopierWahl>): void {
    eigenerFehler.value = undefined;
    wahl.value = { ...wahl.value, ...neu };
}
/** Eine andere Ebene: wieder eine neue Landschaft, ohne Art (eine mitgenommene Wahl meinte niemand). „Sprachen“ lädt deren Liste. */
function setzeEbene(ebene: string): void {
    eigenerFehler.value = undefined;
    zuSprache.value = ebene === SPRACHEN_ZIEL;
    if (zuSprache.value) {
        sprachKopie?.lade();
        return;
    }
    setze({ ebene: ebene as EditorLandscapeLayer, ziel: "", art: "" });
}
function setzeSprache(neu: Partial<Omit<SprachKopierWahl, "loeschen">>): void {
    eigenerFehler.value = undefined;
    sprachWahl.value = { ...sprachWahl.value, ...neu };
}

/** Das Ziel Sprache: über den Spracheditor; geschrieben geht das Blatt zu (der Spracheditor steht an der Zielsprache), sonst steht der Satz da. */
async function kopierenInSprache(): Promise<void> {
    const plan = sprachPlan(sprachWahl.value);
    if ("fehler" in plan) {
        eigenerFehler.value = t(plan.fehler);
        return;
    }
    if (sprachKopie === undefined || sprachSendet.value) return;
    sprachSendet.value = true;
    const antwort = await sprachKopie.kopiere({ regionId: props.detail.id, areaId: props.areaId }, plan.ziel);
    sprachSendet.value = false;
    if (antwort.ok) emit("abbrechen");
    else eigenerFehler.value = antwort.satz;
}

function kopieren(): void {
    if (zuSprache.value) {
        void kopierenInSprache();
        return;
    }
    const plan = kopierPlan(wahl.value);
    if ("fehler" in plan) {
        eigenerFehler.value = t(plan.fehler);
        return;
    }
    emit("kopieren", plan.ziel);
}
function escape(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    emit("abbrechen");
}
</script>

<template>
    <div
        class="kopieren"
        role="group"
        :aria-labelledby="titelId"
        :data-testid="`${kennung}-kopieren`"
        @keydown.esc="escape"
    >
        <h4 :id="titelId" class="kopieren__titel">{{ t("landschaftseditor.kopieren.titel") }}</h4>
        <p class="kopieren__quelle" :data-testid="`${kennung}-kopieren-quelle`">{{ quelle }}</p>
        <FensterFeldzeilen>
            <dt>{{ t("landschaftseditor.kopieren.ebene") }}</dt>
            <dd>
                <AvmAuswahl
                    ref="ebeneFeld"
                    :model-value="zuSprache ? SPRACHEN_ZIEL : wahl.ebene"
                    :optionen="ebenen"
                    :aria-label="t('landschaftseditor.kopieren.ebene')"
                    :testid="`${kennung}-kopieren-ebene`"
                    @update:model-value="setzeEbene"
                />
            </dd>
            <template v-if="zuSprache">
                <dt>{{ t("spracheditor.kopieren.ziel") }}</dt>
                <dd>
                    <AvmAuswahl
                        :model-value="sprachWahl.ziel"
                        :optionen="sprachZiele"
                        :aria-label="t('spracheditor.kopieren.ziel')"
                        :testid="`${kennung}-kopieren-sprache`"
                        @update:model-value="(ziel: string) => setzeSprache({ ziel })"
                    />
                </dd>
                <template v-if="sprachWahl.ziel === NEUE_SPRACHE">
                    <dt>{{ t("spracheditor.feld.name") }}</dt>
                    <dd>
                        <AvmEingabe
                            :model-value="sprachWahl.name"
                            :aria-label="t('spracheditor.feld.name')"
                            :placeholder="t('spracheditor.feld.namePlatzhalter')"
                            :testid="`${kennung}-kopieren-sprachname`"
                            autocomplete="off"
                            @update:model-value="(name: string) => setzeSprache({ name })"
                        />
                    </dd>
                </template>
            </template>
            <template v-else>
                <dt>{{ t("landschaftseditor.kopieren.ziel") }}</dt>
                <dd>
                    <AvmAuswahl
                        :model-value="wahl.ziel"
                        :optionen="ziele"
                        :aria-label="t('landschaftseditor.kopieren.ziel')"
                        :testid="`${kennung}-kopieren-ziel`"
                        @update:model-value="(ziel: string) => setze({ ziel })"
                    />
                </dd>
            </template>
            <template v-if="!zuSprache && wahl.ziel === ''">
                <dt>{{ t("landschaftseditor.kopieren.name") }}</dt>
                <dd>
                    <AvmEingabe
                        :model-value="wahl.name"
                        :aria-label="t('landschaftseditor.kopieren.name')"
                        :testid="`${kennung}-kopieren-name`"
                        maxlength="120"
                        autocomplete="off"
                        @update:model-value="(name: string) => setze({ name })"
                    />
                </dd>
                <dt>{{ t("landschaftseditor.kopieren.art") }}</dt>
                <dd>
                    <AvmAuswahl
                        :model-value="wahl.art"
                        :optionen="arten"
                        :aria-label="t('landschaftseditor.kopieren.art')"
                        :testid="`${kennung}-kopieren-art`"
                        @update:model-value="(art: string) => setze({ art })"
                    />
                </dd>
            </template>
        </FensterFeldzeilen>
        <p v-if="wiki && !zuSprache" class="kopieren__satz" :data-testid="`${kennung}-kopieren-wiki`">{{ t(wiki) }}</p>
        <AvmKaestchen
            v-if="!zuSprache"
            art="checkbox"
            :checked="wahl.loeschen"
            :testid="`${kennung}-kopieren-loeschen`"
            @change="(loeschen: boolean) => setze({ loeschen })"
        >
            {{ t("landschaftseditor.kopieren.loeschen") }}
        </AvmKaestchen>
        <p
            v-if="folge && !zuSprache"
            class="kopieren__satz kopieren__satz--warnung"
            :data-testid="`${kennung}-kopieren-folge`"
        >
            {{ t(folge, { name: detail.name }) }}
        </p>
        <p
            v-if="eigenerFehler ?? fehler"
            class="kopieren__fehler"
            role="alert"
            :data-testid="`${kennung}-kopieren-fehler`"
        >
            {{ eigenerFehler ?? fehler }}
        </p>
        <div class="kopieren__knoepfe">
            <AvmKnopf groesse="zeile" :testid="`${kennung}-kopieren-abbrechen`" @click="emit('abbrechen')">
                {{ t("landschaftseditor.kopieren.abbrechen") }}
            </AvmKnopf>
            <AvmKnopf
                art="gefuellt"
                groesse="zeile"
                :gesperrt="sprachSendet ? t('landschaftseditor.kopieren.sendet') : gesperrt"
                :testid="`${kennung}-kopieren-knopf`"
                @click="kopieren"
            >
                {{ t("landschaftseditor.kopieren.knopf") }}
            </AvmKnopf>
        </div>
    </div>
</template>

<style scoped>
.kopieren {
    display: grid;
    gap: var(--space-8);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.kopieren__titel {
    margin: 0;
    font-size: var(--font-size-body);
}

.kopieren__quelle,
.kopieren__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kopieren__satz--warnung {
    color: var(--color-danger-soft-text);
}

.kopieren__fehler {
    margin: 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}

.kopieren__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-8);
}
</style>
