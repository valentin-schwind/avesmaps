<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { MEDIA_CREATION_METHODS, type MediaAssetDetail } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { t } from "../i18n/i18n";
import { entstehungAus, entstehungsBefunde, entstehungsSchritte } from "./medien-bearbeiten-modell";
import MedienFeldliste from "./medien-feldliste.vue";
import { befundeJeFeld, type EntstehungStand } from "./medien-formular-modell";
import { entstehungZeilen } from "./medien-inspektor-modell";
import MedienKasten from "./medien-kasten.vue";
import { Handlung, operationsFehler, type MedienOperationen, type OperationsFehler } from "./medien-operationen";
import { entstehungName } from "./medien-text";

/**
 * Der Kasten „Entstehung“ (WI-0068 P4b, Blatt 1 A): die Art (`…/metadata`) und Werkzeug, Modell, Prompt (`…/creation`). Ändert sich
 * beides, gehen zwei Anfragen in der Reihenfolge, die der Server annimmt (`entstehungsSchritte`); scheitert die zweite, ist die erste
 * gespeichert, der Kasten bleibt offen und sagt es. Prompt und Negativ-Prompt nur bei „KI-erzeugt“, beide intern.
 */
const props = defineProps<{ detail: MediaAssetDetail; bearbeitbar: boolean; operationen: MedienOperationen }>();
const emit = defineEmits<{ gespeichert: []; neuLaden: [] }>();

const offen = ref(false);
const stand = ref<EntstehungStand>(entstehungAus(props.detail));
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const befunde = ref<ReadonlyMap<string, string>>(new Map());
const handlungen = { metadata: new Handlung(), creation: new Handlung() };
const id = useId();

const ki = computed(() => stand.value.art === "ai_generated");
const artOptionen = computed(() => MEDIA_CREATION_METHODS.map((art) => ({ wert: art, text: entstehungName(art) })));

watch(offen, (jetzt) => {
    if (!jetzt) return;
    stand.value = entstehungAus(props.detail);
    fehler.value = undefined;
    befunde.value = new Map();
});

async function speichern(): Promise<void> {
    const vorab = entstehungsBefunde(stand.value);
    befunde.value = befundeJeFeld(vorab);
    if (vorab.length > 0) return;
    const schritte = entstehungsSchritte(props.detail, stand.value);
    if (schritte.length === 0) {
        offen.value = false;
        return;
    }
    sendet.value = true;
    fehler.value = undefined;
    let gespeichert = 0;
    try {
        for (const schritt of schritte) {
            const assetId = props.detail.asset.id;
            await handlungen[schritt.route].fuehreAus((operationId) =>
                schritt.route === "metadata"
                    ? props.operationen.metadaten(assetId, { ...schritt.body, operationId })
                    : props.operationen.entstehung(assetId, { ...schritt.body, operationId }),
            );
            gespeichert += 1;
        }
        offen.value = false;
        emit("gespeichert");
    } catch (error) {
        fehler.value = operationsFehler(error);
        befunde.value = befundeJeFeld(fehler.value.befunde);
        // Ein Teil steht schon: neu laden, damit der nächste Versuch nur den Rest sendet.
        if (gespeichert > 0) emit("gespeichert");
    } finally {
        sendet.value = false;
    }
}

function neuLaden(): void {
    fehler.value = undefined;
    emit("neuLaden");
}
</script>

<template>
    <MedienKasten
        v-model:offen="offen"
        :titel="t('medien.abschnitt.entstehung')"
        :bearbeitbar="bearbeitbar"
        :sendet="sendet"
        :fehler="fehler"
        :speichern-text="t('medien.bearbeiten.speichernEntstehung')"
        testid="medien-kasten-entstehung"
        @speichern="speichern"
        @neu-laden="neuLaden"
    >
        <MedienFeldliste :zeilen="entstehungZeilen(detail)" testid="medien-entstehung" />
        <p class="medien-kasten-entstehung__satz">{{ t("medien.inspektor.kiKeineLizenz") }}</p>
        <template #bearbeiten>
            <label :for="`${id}-art`">{{ t("medien.formular.art") }}</label>
            <AvmAuswahl :id="`${id}-art`" v-model="stand.art" :optionen="artOptionen" testid="medien-bearbeiten-art" />
            <label :for="`${id}-werkzeug`">{{ t("medien.formular.werkzeug") }}</label>
            <AvmEingabe
                :id="`${id}-werkzeug`"
                v-model="stand.werkzeug"
                maxlength="200"
                testid="medien-bearbeiten-werkzeug"
            />
            <label :for="`${id}-modell`">{{ t("medien.formular.modell") }}</label>
            <AvmEingabe :id="`${id}-modell`" v-model="stand.modell" maxlength="200" />
            <template v-if="ki">
                <label :for="`${id}-prompt`" class="oben">{{ t("medien.formular.prompt") }}</label>
                <span class="medien-kasten__wert">
                    <AvmTextbereich
                        :id="`${id}-prompt`"
                        v-model="stand.prompt"
                        :zeilen="3"
                        :ungueltig="befunde.has('creation.prompt')"
                        testid="medien-bearbeiten-prompt"
                    />
                    <span v-if="befunde.get('creation.prompt')" class="medien-kasten__befund">{{
                        befunde.get("creation.prompt")
                    }}</span>
                    <span class="medien-kasten__klein">{{ t("medien.formular.nurEditoren") }}</span>
                </span>
                <label :for="`${id}-negativ`" class="oben">{{ t("medien.formular.negativ") }}</label>
                <AvmTextbereich :id="`${id}-negativ`" v-model="stand.negativPrompt" :zeilen="2" />
            </template>
        </template>
    </MedienKasten>
</template>

<style scoped>
.medien-kasten-entstehung__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
