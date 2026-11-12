<script setup lang="ts">
import { ref, useId, watch } from "vue";
import type { MediaAssetDetail } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import { t } from "../i18n/i18n";
import { nameAnfrage, nameAus } from "./medien-bearbeiten-modell";
import MedienFeldliste from "./medien-feldliste.vue";
import { eigenschaftenZeilen } from "./medien-inspektor-modell";
import MedienKasten from "./medien-kasten.vue";
import { Handlung, operationsFehler, type MedienOperationen, type OperationsFehler } from "./medien-operationen";

/**
 * Der Kasten „Eigenschaften“ (WI-0068 P4b, Blatt 1 A): bearbeitet wird der Name in der Liste (`…/metadata`). Leer heißt „kein eigener
 * Name“: Die Liste zeigt dann den Namen aus dem Objekt („Wappen von Gareth“). Ein Name, den ein Mensch setzt, benennt das System nie um.
 */
const props = defineProps<{
    detail: MediaAssetDetail;
    bearbeitbar: boolean;
    operationen: MedienOperationen;
    /** Der Name, den die Liste ohne eigenen zeigt; steht als Platzhalter im Feld. */
    ersatzName: string;
}>();
const emit = defineEmits<{ gespeichert: []; neuLaden: [] }>();

const offen = ref(false);
const name = ref("");
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const handlung = new Handlung();
const id = useId();

watch(offen, (jetzt) => {
    if (!jetzt) return;
    name.value = nameAus(props.detail);
    fehler.value = undefined;
});

async function speichern(): Promise<void> {
    const anfrage = nameAnfrage(props.detail, name.value);
    if (anfrage === undefined) {
        offen.value = false;
        return;
    }
    sendet.value = true;
    fehler.value = undefined;
    try {
        await handlung.fuehreAus((operationId) =>
            props.operationen.metadaten(props.detail.asset.id, { ...anfrage, operationId }),
        );
        offen.value = false;
        emit("gespeichert");
    } catch (error) {
        fehler.value = operationsFehler(error);
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
        :titel="t('medien.abschnitt.eigenschaften')"
        :bearbeitbar="bearbeitbar"
        :sendet="sendet"
        :fehler="fehler"
        :speichern-text="t('medien.bearbeiten.speichernName')"
        testid="medien-kasten-eigenschaften"
        @speichern="speichern"
        @neu-laden="neuLaden"
    >
        <MedienFeldliste :zeilen="eigenschaftenZeilen(detail)" testid="medien-eigenschaften" />
        <template #bearbeiten>
            <label :for="`${id}-name`">{{ t("medien.bearbeiten.name") }}</label>
            <span class="medien-kasten__wert">
                <AvmEingabe
                    :id="`${id}-name`"
                    v-model="name"
                    :placeholder="ersatzName"
                    maxlength="200"
                    testid="medien-bearbeiten-name"
                />
                <span class="medien-kasten__klein">{{ t("medien.bearbeiten.nameHinweis") }}</span>
            </span>
        </template>
    </MedienKasten>
</template>
