<script setup lang="ts">
import { computed, onMounted, ref, useId, useTemplateRef } from "vue";
import type { SpracheEditorDetail, SpracheEditorListe } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import { locale, t } from "../i18n/i18n";
import {
    NEUE_SPRACHE,
    START_WAHL,
    sprachKopierPlan,
    zielSprachen,
    type SprachKopierWahl,
    type SprachKopierZiel,
} from "./sprachflaeche-kopieren";

/**
 * Das Blatt „Fläche kopieren“ an einer Teilfläche einer Sprache (WI-0261 Stufe 3), im Reiter „Flächen“ unter der Liste wie die Bestätigung „Teilfläche
 * entfernen“, gebaut wie das Blatt der Derographie (`landschaftseditor/landschaft-kopieren.vue`, dieselben Wörter): die Zielsprache, der Haken
 * „Originalfläche löschen“ mit seiner Folge, dann „Abbrechen“ und „Kopieren“. Mit „Neue Sprache …“ steht darunter ihr Name (Feld wie bei „✚ Neue Sprache“). Die Regeln stehen in `sprachflaeche-kopieren.ts`; geschrieben wird EINE
 * Operation `sprache_flaeche.copy`. Esc bricht das Blatt ab, nicht das Fenster.
 */
const props = defineProps<{
    detail: SpracheEditorDetail;
    /** Die Teilfläche, die kopiert wird. */
    flaecheId: string;
    /** Die Zeilen der Liste, für die Zielsprachen. */
    zeilen: SpracheEditorListe["zeilen"];
    kennung: string;
    /** Warum gerade nicht kopiert werden kann (es wird geschrieben, ein Modus läuft); fehlt: es geht. */
    gesperrt?: string | undefined;
    /** Der Satz des Servers, wenn es nicht ging. */
    fehler?: string | undefined;
}>();
const emit = defineEmits<{ kopieren: [ziel: SprachKopierZiel]; abbrechen: [] }>();

const wahl = ref<SprachKopierWahl>(START_WAHL);
const eigenerFehler = ref<string | undefined>(undefined);
const titelId = useId();
const zielFeld = useTemplateRef<InstanceType<typeof AvmAuswahl>>("zielFeld");
onMounted(() => (zielFeld.value?.$el as HTMLElement | undefined)?.querySelector("select")?.focus());

const ziele = computed(() => [
    { wert: "", text: t("spracheditor.artikel.waehlen"), gesperrt: true },
    { wert: NEUE_SPRACHE, text: t("spracheditor.kopieren.neu") },
    ...zielSprachen(props.zeilen, props.detail.id, locale.value).map((zeile) => ({ wert: zeile.id, text: zeile.name })),
]);
/** Welche Teilfläche, wenn die Sprache mehrere hat. */
const quelle = computed(() => {
    const teile = props.detail.teilflaechen;
    const nr = teile.findIndex((teil) => teil.id === props.flaecheId) + 1;
    return teile.length > 1
        ? t("landschaftseditor.kopieren.quelleTeil", {
              name: props.detail.name,
              nr: String(nr),
              zahl: String(teile.length),
          })
        : props.detail.name;
});

function setze(neu: Partial<SprachKopierWahl>): void {
    eigenerFehler.value = undefined;
    wahl.value = { ...wahl.value, ...neu };
}
function kopieren(): void {
    const plan = sprachKopierPlan(wahl.value);
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
            <dt>{{ t("spracheditor.kopieren.ziel") }}</dt>
            <dd>
                <AvmAuswahl
                    ref="zielFeld"
                    :model-value="wahl.ziel"
                    :optionen="ziele"
                    :aria-label="t('spracheditor.kopieren.ziel')"
                    :testid="`${kennung}-kopieren-ziel`"
                    @update:model-value="(ziel: string) => setze({ ziel })"
                />
            </dd>
            <template v-if="wahl.ziel === NEUE_SPRACHE">
                <dt>{{ t("spracheditor.feld.name") }}</dt>
                <dd>
                    <AvmEingabe
                        :model-value="wahl.name"
                        :aria-label="t('spracheditor.feld.name')"
                        :placeholder="t('spracheditor.feld.namePlatzhalter')"
                        :testid="`${kennung}-kopieren-name`"
                        autocomplete="off"
                        @update:model-value="(name: string) => setze({ name })"
                    />
                </dd>
            </template>
        </FensterFeldzeilen>
        <AvmKaestchen
            art="checkbox"
            :checked="wahl.loeschen"
            :testid="`${kennung}-kopieren-loeschen`"
            @change="(loeschen: boolean) => setze({ loeschen })"
        >
            {{ t("landschaftseditor.kopieren.loeschen") }}
        </AvmKaestchen>
        <p
            v-if="wahl.loeschen"
            class="kopieren__satz kopieren__satz--warnung"
            :data-testid="`${kennung}-kopieren-folge`"
        >
            {{ t("spracheditor.kopieren.folge", { name: detail.name }) }}
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
                :gesperrt="gesperrt"
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
