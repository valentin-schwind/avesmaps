<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import type { MediaAssetDetail, MediaUsageResult, OperationReceipt } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { Handlung, createMedienOperationen, operationsFehler, type MedienOperationen } from "./medien-operationen";
import { NOTAUS_GRUND_MAX, aktiverNotausStand, notausGrundFehler, notausUmfang } from "./medien-notaus-modell";
import { zahl } from "./medien-text";

/**
 * Das Blatt „Bild offline nehmen“ und „wieder freigeben“ (WI-0068; Betreiber 2026-10-10 zu SYS-0001 Frage 2).
 *
 * - 🔴 **Es sagt VORHER, was es trifft.** Der Notaus gilt den Bytes: alle Verwendungen dieses Werks und die jedes anderen Werks mit
 *   derselben Datei. Die Zahlen stehen oben; sie kommen aus dem, was der Inspector ohnehin geladen hat.
 * - 🔴 **Der Grund ist Pflicht**, und der Server verlangt zusätzlich einen frischen Passkey. Das Blatt sagt das, bevor jemand tippt,
 *   statt die Bestätigung als Überraschung erscheinen zu lassen.
 * - **Ein Notaus ist kein Löschen** (Guide: ein Gefahrknopf benennt die Handlung): Asset, Bindungen und Rechte bleiben; nur die
 *   öffentliche Datei wandert in die Quarantäne.
 */
const props = defineProps<{
    assetId: string;
    detail: MediaAssetDetail | undefined;
    verwendung: MediaUsageResult | undefined;
    operationen?: MedienOperationen | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ fertig: [quittung: OperationReceipt] }>();

const ops = props.operationen ?? createMedienOperationen();
const handlung = new Handlung();
const grundId = useId();

const grund = ref("");
const sendet = ref(false);
const fehler = ref<string | undefined>(undefined);
const beruehrt = ref(false);

const aktiv = computed(() => aktiverNotausStand(props.detail));
/** „Freigeben“ statt „Ausblenden“, sobald ein Notaus gilt. */
const freigeben = computed(() => aktiv.value !== undefined);
const umfang = computed(() => notausUmfang(props.verwendung));

watch(offen, (jetzt) => {
    if (!jetzt) return;
    grund.value = "";
    fehler.value = undefined;
    beruehrt.value = false;
    sendet.value = false;
});

const grundFehler = computed(() => {
    if (!beruehrt.value) return undefined;
    const befund = notausGrundFehler(grund.value);
    return befund === undefined ? undefined : t(`medien.notaus.grund.${befund}`);
});

const umfangSatz = computed(() => {
    const u = umfang.value;
    const eigene = t("medien.notaus.umfang.eigene", { n: zahl(u.verwendungen), oeffentlich: zahl(u.oeffentlich) });
    if (u.weitereWerke === 0) return eigene;
    return `${eigene} ${t("medien.notaus.umfang.weitere", {
        werke: zahl(u.weitereWerke),
        n: zahl(u.weitereVerwendungen),
    })}`;
});

async function senden(): Promise<void> {
    beruehrt.value = true;
    if (sendet.value || notausGrundFehler(grund.value) !== undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        const reason = grund.value.trim();
        const stand = aktiv.value;
        const quittung = await handlung.fuehreAus((operationId) =>
            stand === undefined
                ? ops.notausSetzen(props.assetId, { operationId, reason })
                : ops.notausAufheben(props.assetId, { operationId, baseRevision: stand.revision, reason }),
        );
        emit("fertig", quittung);
        offen.value = false;
    } catch (error) {
        fehler.value = operationsFehler(error).text;
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
        :titel="t(freigeben ? 'medien.notaus.titelFrei' : 'medien.notaus.titelAus')"
        :zusatz="t('medien.notaus.zusatz')"
        testid="medien-notaus-fenster"
    >
        <div class="notaus">
            <p class="notaus__umfang" data-testid="medien-notaus-umfang">{{ umfangSatz }}</p>
            <AvmHinweis :ton="freigeben ? 'warnung' : 'gefahr'" testid="medien-notaus-wirkung">
                {{ t(freigeben ? "medien.notaus.wirkungFrei" : "medien.notaus.wirkungAus") }}
            </AvmHinweis>

            <label class="notaus__feld" :for="grundId">
                <span>{{ t("medien.notaus.grund.label") }}</span>
                <AvmTextbereich
                    :id="grundId"
                    v-model="grund"
                    :zeilen="3"
                    :ungueltig="grundFehler !== undefined"
                    :maxlength="NOTAUS_GRUND_MAX"
                    :placeholder="t('medien.notaus.grund.platzhalter')"
                    testid="medien-notaus-grund"
                    @blur="beruehrt = true"
                />
                <span v-if="grundFehler" class="notaus__befund" data-testid="medien-notaus-grund-befund">{{
                    grundFehler
                }}</span>
            </label>
            <p class="notaus__satz">{{ t("medien.notaus.passkey") }}</p>
            <p v-if="!freigeben" class="notaus__satz">{{ t("medien.notaus.keinLoeschen") }}</p>

            <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" testid="medien-notaus-fehler">{{ fehler }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-notaus-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf
                :art="freigeben ? 'gefuellt' : 'gefahr'"
                :gesperrt="sendet ? t('medien.bearbeiten.sendet') : undefined"
                testid="medien-notaus-senden"
                @click="senden"
                >{{ t(freigeben ? "medien.notaus.knopfFrei" : "medien.notaus.knopfAus") }}</AvmKnopf
            >
        </template>
    </AvmFenster>
</template>

<style scoped>
.notaus {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.notaus__umfang {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.notaus__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.notaus__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.notaus__befund {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
}
</style>
