<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { MediaAssetDetail, MediaUsageResult, OperationReceipt } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { loeschBlatt } from "./medien-loeschen-modell";
import { Handlung, createMedienOperationen, operationsFehler, type MedienOperationen } from "./medien-operationen";

/**
 * Das Blatt „Bild endgültig löschen“ (WI-0068 R4; Betreiber 2026-10-17, „A, nur eigene Uploads“).
 *
 * - 🔴 **Es sagt vorher, was fällt**: Original, Vorschauen, öffentliche Datei, Rechte und Belege; das Fachprotokoll bleibt. Und dass es
 *   sich nicht zurücknehmen lässt (Guide: ein Gefahrknopf benennt die Handlung).
 * - Der Server verlangt einen frischen Passkey (`delete_media`, Stufe S); die Operationen holen ihn wie beim Notaus.
 * - Ein Bild aus einem Kartenvorschlag an stillgelegten Einträgen (WI-0287, Vali 2026-11-07 „Ja, erlauben“): Das Blatt nennt die Einträge, die es verlieren, sagt,
 *   dass erzeugte Vorschauen mitfallen und der Vorschlag ohne Datei im Verlauf bleibt.
 * - Ein PhotoBox-Bild (WI-0272, Vali 2026-11-08, Entwurf „Eingänge“ Fassung 2): wo es verschwindet (Reisebilder des Orts, Karte, Leiste) oder dass es schon zurückgezogen
 *   ist, und dass die Einsendung ohne Datei im Verlauf bleibt. Bei jedem Werk: welches andere Werk dieselbe Datei hat und sie behält, und was mit einem Notaus geschieht,
 *   der an diesem Bild ausgelöst wurde. Die Sätze rechnet `loeschBlatt` (`medien-loeschen-modell.ts`).
 */
const props = defineProps<{
    detail: MediaAssetDetail;
    /** Die Verwendungen samt „gleiche Datei“: Werke mit denselben Bytes behalten ihre Datei, das Blatt nennt sie. */
    verwendung?: MediaUsageResult | undefined;
    /** Der Name, den der Inspector zeigt (bei einem Reisebild die Beschreibung des Einsenders); ohne ihn der Titel des Werks. */
    name?: string | undefined;
    operationen?: MedienOperationen | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ fertig: [quittung: OperationReceipt] }>();

const ops = props.operationen ?? createMedienOperationen();
const handlung = new Handlung();
const sendet = ref(false);
const fehler = ref<string | undefined>(undefined);
const blatt = computed(() => loeschBlatt(props.detail, props.verwendung?.sameFile));

watch(offen, (jetzt) => {
    if (!jetzt) return;
    fehler.value = undefined;
    sendet.value = false;
});

async function loeschen(): Promise<void> {
    if (sendet.value) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        const quittung = await handlung.fuehreAus((operationId) =>
            ops.loeschen(props.detail.asset.id, { operationId, baseRevision: props.detail.asset.revision }),
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
        :titel="t('medien.loeschen.titel')"
        :zusatz="blatt.zusatz"
        testid="medien-loeschen-fenster"
    >
        <div class="loeschen">
            <p class="loeschen__name" data-testid="medien-loeschen-name">
                {{ name ?? detail.asset.title ?? t("medien.merge.ohneTitel") }}
            </p>
            <AvmHinweis ton="gefahr" testid="medien-loeschen-wirkung">{{ t("medien.loeschen.wirkung") }}</AvmHinweis>
            <AvmHinweis v-if="blatt.folgen.length > 0" ton="warnung" testid="medien-loeschen-folgen">{{
                blatt.folgen.join(" ")
            }}</AvmHinweis>
            <p v-if="blatt.notaus" class="loeschen__satz" data-testid="medien-loeschen-notaus">{{ blatt.notaus }}</p>
            <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" testid="medien-loeschen-fehler">{{
                fehler
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-loeschen-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf
                art="gefahr"
                :gesperrt="sendet ? t('medien.bearbeiten.sendet') : undefined"
                testid="medien-loeschen-bestaetigen"
                @click="loeschen"
            >
                {{ t("medien.loeschen.knopf") }}
            </AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.loeschen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.loeschen__name {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.loeschen__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
