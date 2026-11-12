<script setup lang="ts">
import { ref } from "vue";
import type { MediaAssetDetail, MediaMergedHere } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import { Handlung, operationsFehler, type MedienOperationen, type OperationsFehler } from "./medien-operationen";
import { datumZeit } from "./medien-text";

/**
 * „Darin aufgegangen“ (WI-0068 D1): die Werke, die in diesem aufgegangen sind, und „↺ Aufheben“ je Werk. Ein aufgegangenes Werk fällt aus
 * jeder Liste (Betreiber 2026-10-17); erreichbar ist es nur über das bleibende. Das Aufheben gibt jede Verwendung genau dorthin zurück,
 * wo sie herkam (`media.merge_lifted`), und fragt vorher nach. Gebaut im Paket „was beim Bedienen nicht geht“ (Route gab es, Knopf nicht).
 */
const props = defineProps<{
    detail: MediaAssetDetail;
    bearbeitbar: boolean;
    operationen: MedienOperationen;
}>();
const emit = defineEmits<{ aufgehoben: [assetId: string]; waehleAsset: [assetId: string] }>();

const fragen = ref<string | undefined>();
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const handlungen = new Map<string, Handlung>();

const name = (werk: MediaMergedHere): string => werk.title ?? t("medien.merge.ohneTitel");

async function aufheben(werk: MediaMergedHere): Promise<void> {
    sendet.value = true;
    fehler.value = undefined;
    const handlung = handlungen.get(werk.assetId) ?? new Handlung();
    handlungen.set(werk.assetId, handlung);
    try {
        await handlung.fuehreAus((operationId) =>
            props.operationen.zusammenfuehrungAufheben(werk.assetId, { operationId }),
        );
        handlungen.delete(werk.assetId);
        fragen.value = undefined;
        emit("aufgehoben", werk.assetId);
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <FensterKarte :titel="t('medien.aufgegangen.titel')" data-testid="medien-aufgegangen">
        <p class="medien-aufgegangen__satz">{{ t("medien.aufgegangen.satz") }}</p>
        <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" testid="medien-aufgegangen-fehler">{{
            fehler.text
        }}</AvmHinweis>
        <ul class="medien-aufgegangen__liste">
            <li v-for="werk in detail.mergedHere" :key="werk.assetId" class="medien-aufgegangen__zeile">
                <span class="medien-aufgegangen__text">
                    <button
                        type="button"
                        class="medien-aufgegangen__name"
                        :data-testid="`medien-aufgegangen-werk-${werk.assetId}`"
                        @click="emit('waehleAsset', werk.assetId)"
                    >
                        {{ name(werk) }}
                    </button>
                    <span class="medien-aufgegangen__unter">{{
                        werk.mergedBy
                            ? t("medien.aufgegangen.amVon", {
                                  am: datumZeit(werk.mergedAt),
                                  wer: werk.mergedBy.displayName,
                              })
                            : t("medien.aufgegangen.am", { am: datumZeit(werk.mergedAt) })
                    }}</span>
                </span>
                <AvmKnopf
                    v-if="fragen !== werk.assetId"
                    groesse="zeile"
                    :gesperrt="bearbeitbar ? undefined : t('medien.op.recht')"
                    :testid="`medien-aufgegangen-aufheben-${werk.assetId}`"
                    @click="fragen = werk.assetId"
                >
                    <template #zeichen>↺</template>
                    {{ t("medien.aufgegangen.aufheben") }}
                </AvmKnopf>
                <AvmBestaetigung
                    v-else
                    class="medien-aufgegangen__frage"
                    :frage="t('medien.aufgegangen.frage', { name: name(werk) })"
                    :folge="t('medien.aufgegangen.folge')"
                    :bestaetigen="t('medien.aufgegangen.aufheben')"
                    :gesperrt="sendet ? t('medien.bearbeiten.sendet') : undefined"
                    :testid="`medien-aufgegangen-frage-${werk.assetId}`"
                    @bestaetigen="aufheben(werk)"
                    @abbrechen="fragen = undefined"
                />
            </li>
        </ul>
    </FensterKarte>
</template>

<style scoped>
.medien-aufgegangen__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.medien-aufgegangen__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.medien-aufgegangen__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.medien-aufgegangen__text {
    display: flex;
    flex: 1 1 12em;
    flex-direction: column;
    min-width: 0;
}

.medien-aufgegangen__name {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 2px;
}

.medien-aufgegangen__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.medien-aufgegangen__frage {
    flex: 1 1 100%;
}
</style>
