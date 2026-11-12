<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import type { MediaAssetDetail, MediaUsageResult } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { createMedienClient, istAbbruch, type MedienClient } from "./medien-client";
import { mergeKandidaten, mergeSatz, rechteWeichenAb, vorgabeBleibt } from "./medien-merge-modell";
import {
    Handlung,
    createMedienOperationen,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "./medien-operationen";
import { zahl } from "./medien-text";

/**
 * „Bilder zusammenführen“ (WI-0068 D1): Aus mehreren Werken mit DENSELBEN BYTES wird eines.
 *
 * 🔴 **Nie automatisch** (WI-0068 §21): Dieses Fenster führt EINE Gruppe zusammen, und ein Mensch wählt, welches Werk bleibt.
 * Die Vorgabe ist die größte Auflösung (Betreiber 2026-10-11) — ein Vorschlag, keine Entscheidung.
 *
 * 🔴 **Weichen die Rechte ab, steht es oben als Warnung.** Nach dem Zusammenführen gelten die des bleibenden Werks für alle
 * Verwendungen; das ist der Punkt, an dem ein Mensch hinsehen muss, und keiner, den eine Vorgabe treffen darf.
 *
 * 🪤 **Die Maße stehen nicht in der Reverse Usage.** Das Fenster lädt die beteiligten Werke einzeln nach, sonst stünde überall
 * ein Strich und die Vorgabe fiele auf das erste — eine Vorgabe, die sich an nichts hält, ist schlechter als keine.
 */
const props = defineProps<{
    verwendung: MediaUsageResult;
    /** Der Name des Werks, von dem aus das Fenster geöffnet wurde. */
    eigenerName: string;
    operationen?: MedienOperationen | undefined;
    client?: MedienClient | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ fertig: [bleibt: string] }>();

const ops = props.operationen ?? createMedienOperationen();
const client = props.client ?? createMedienClient();

const details = shallowRef<Map<string, MediaAssetDetail>>(new Map());
const laedt = ref(false);
const bleibt = ref<string | undefined>(undefined);
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>(undefined);
const handlung = new Handlung();

let lauf: AbortController | undefined;

const kandidaten = computed(() => mergeKandidaten(props.verwendung, props.eigenerName, details.value));

async function ladeDetails(): Promise<void> {
    lauf?.abort();
    lauf = new AbortController();
    const signal = lauf.signal;
    laedt.value = true;
    try {
        const ids = [props.verwendung.asset.id, ...props.verwendung.sameFile.map((eintrag) => eintrag.asset.id)];
        const geladen = new Map<string, MediaAssetDetail>();
        for (const id of ids) {
            geladen.set(id, await client.asset(id, signal));
        }
        if (signal.aborted) return;
        details.value = geladen;
        bleibt.value = vorgabeBleibt(kandidaten.value);
    } catch (error) {
        if (!istAbbruch(error)) fehler.value = operationsFehler(error);
    } finally {
        if (!signal.aborted) laedt.value = false;
    }
}

watch(
    offen,
    (jetzt) => {
        if (!jetzt) {
            lauf?.abort();
            return;
        }
        fehler.value = undefined;
        bleibt.value = undefined;
        details.value = new Map();
        void ladeDetails();
    },
    { immediate: true },
);

const warnung = computed(() => rechteWeichenAb(kandidaten.value));
const satz = computed(() => mergeSatz(kandidaten.value, bleibt.value));
const gesperrt = computed(() => {
    if (sendet.value) return t("medien.bearbeiten.sendet");
    if (laedt.value) return t("medien.treffer.laedt");
    if (bleibt.value === undefined) return t("medien.merge.waehlen");
    return undefined;
});

async function zusammenfuehren(): Promise<void> {
    const ziel = bleibt.value;
    if (ziel === undefined || gesperrt.value !== undefined) return;
    const bleibend = kandidaten.value.find((kandidat) => kandidat.assetId === ziel);
    const gehen = kandidaten.value.filter((kandidat) => kandidat.assetId !== ziel);
    if (bleibend === undefined || gehen.length === 0) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        await handlung.fuehreAus((operationId) =>
            ops.zusammenfuehren({
                operationId,
                keep: { assetId: bleibend.assetId, baseRevision: bleibend.revision },
                merge: gehen.map((kandidat) => ({ assetId: kandidat.assetId, baseRevision: kandidat.revision })),
            }),
        );
        offen.value = false;
        emit("fertig", ziel);
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="t('medien.merge.titel')"
        :zusatz="t('medien.merge.zusatz')"
        testid="medien-merge-fenster"
    >
        <div class="merge">
            <AvmHinweis v-if="warnung" ton="warnung" testid="medien-merge-rechte">{{
                t("medien.merge.rechteWarnung")
            }}</AvmHinweis>

            <p v-if="laedt" class="merge__satz">{{ t("medien.treffer.laedt") }}</p>
            <ul v-else class="merge__liste" data-testid="medien-merge-liste">
                <li v-for="kandidat in kandidaten" :key="kandidat.assetId">
                    <label class="merge__zeile" :class="{ 'is-bleibt': kandidat.assetId === bleibt }">
                        <input v-model="bleibt" type="radio" name="merge-bleibt" :value="kandidat.assetId" />
                        <span class="merge__text">
                            <span class="merge__name einzeilig">{{ kandidat.name }}</span>
                            <span class="merge__klein"
                                >{{ kandidat.masse }} · {{ kandidat.rechte }} ·
                                {{ t("medien.merge.verwendungen", { n: zahl(kandidat.verwendungen) }) }}</span
                            >
                        </span>
                        <span v-if="kandidat.assetId === bleibt" class="merge__marke">{{
                            t("medien.merge.bleibt")
                        }}</span>
                    </label>
                </li>
            </ul>
            <p class="merge__satz">{{ t("medien.merge.bleibtSatz") }}</p>
            <p class="merge__satz" data-testid="medien-merge-satz">{{ satz }}</p>
            <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" testid="medien-merge-fehler">{{
                fehler.text
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-merge-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf art="gefuellt" :gesperrt="gesperrt" testid="medien-merge-los" @click="zusammenfuehren">{{
                t("medien.merge.knopf")
            }}</AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.merge {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.merge__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.merge__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Zeile wie jede Zeile des Hauses; Zustände nach Guide §30.5. */
.merge__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.merge__zeile:hover {
    background: var(--color-hover-wash);
}

.merge__zeile.is-bleibt {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

.merge__zeile:focus-within {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
}

.merge__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.merge__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.merge__klein {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.merge__marke {
    flex: none;
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-lg);
    background: var(--color-active-wash);
    color: var(--color-text-strong);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .merge__zeile {
        transition: none;
    }
}
</style>
