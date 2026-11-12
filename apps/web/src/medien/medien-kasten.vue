<script setup lang="ts">
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import MedienKastenKnopf from "./medien-kasten-knopf.vue";
import { datumZeit } from "./medien-text";
import type { OperationsFehler } from "./medien-operationen";

/**
 * Ein Kasten des Inspectors, den man einzeln bearbeitet (WI-0068 P4b, Blatt 1, Betreiber 2026-10-10: „jeden Kasten einzeln (A)“): „⊙
 * Bearbeiten“ an der Aufschrift öffnet nur ihn, unten „Abbrechen“ und „… speichern“; ein Kasten, ein Speichern, ein Fehler an genau dieser
 * Stelle.
 *
 * - Lesend steht der Inhalt (Slot `default`), bearbeitend die Felder (Slot `bearbeiten`); was in beiden gilt, steht in `unten` (die
 *   Prüfung im Kasten „Rechte“).
 * - **Konflikt** (409 `edit_conflict`): Der Satz nennt, wer wann geändert hat; die eigenen Eingaben bleiben stehen, „↺ Neu laden“ holt den
 *   neuen Stand, danach geht Speichern wieder.
 * - „⊙ Bearbeiten“ nur mit dem Recht (`bearbeitbar`); der Server prüft selbst. Zeichen statt Bild, wie jeder Knopf des Backends.
 */
const props = defineProps<{
    titel: string;
    bearbeitbar: boolean;
    sendet: boolean;
    fehler: OperationsFehler | undefined;
    speichernText: string;
    testid: string;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ speichern: []; abbrechen: []; neuLaden: [] }>();

function abbrechen(): void {
    offen.value = false;
    emit("abbrechen");
}

const konfliktSatz = (fehler: OperationsFehler): string | undefined => {
    const wer = fehler.konflikt?.changedBy?.displayName;
    const am = fehler.konflikt?.changedAt;
    if (wer === undefined) return undefined;
    return am === undefined
        ? t("medien.bearbeiten.konfliktWer", { wer })
        : t("medien.bearbeiten.konfliktWerAm", { wer, am: datumZeit(am) });
};
</script>

<template>
    <FensterKarte :titel="props.titel" :data-testid="props.testid">
        <template #etikett>
            <MedienKastenKnopf
                v-if="props.bearbeitbar && !offen"
                zeichen="⊙"
                :testid="`${props.testid}-bearbeiten`"
                @click="offen = true"
                >{{ t("medien.bearbeiten.oeffnen") }}</MedienKastenKnopf
            >
        </template>
        <slot v-if="!offen" />
        <form v-else class="medien-kasten__form" novalidate @submit.prevent="emit('speichern')">
            <fieldset class="medien-kasten__felder" :disabled="props.sendet">
                <slot name="bearbeiten" />
            </fieldset>
            <AvmHinweis v-if="props.fehler" :ton="props.fehler.ton" rolle="alert" :testid="`${props.testid}-fehler`"
                >{{ konfliktSatz(props.fehler) ?? props.fehler.text
                }}<template v-if="props.fehler.konflikt">{{
                    ` ${t("medien.bearbeiten.eingabenBleiben")}`
                }}</template></AvmHinweis
            >
            <div class="medien-kasten__fuss">
                <AvmKnopf
                    v-if="props.fehler?.konflikt"
                    groesse="zeile"
                    :testid="`${props.testid}-neu-laden`"
                    @click="emit('neuLaden')"
                >
                    <template #zeichen>↺</template>
                    {{ t("medien.bearbeiten.neuLaden") }}
                </AvmKnopf>
                <AvmKnopf groesse="zeile" :testid="`${props.testid}-abbrechen`" @click="abbrechen">{{
                    t("medien.bearbeiten.abbrechen")
                }}</AvmKnopf>
                <AvmKnopf
                    art="gefuellt"
                    groesse="zeile"
                    typ="submit"
                    :gesperrt="
                        props.sendet
                            ? t('medien.bearbeiten.sendet')
                            : props.fehler?.konflikt
                              ? t('medien.bearbeiten.ersteNeuLaden')
                              : undefined
                    "
                    :testid="`${props.testid}-speichern`"
                    >{{ props.speichernText }}</AvmKnopf
                >
            </div>
        </form>
        <slot name="unten" />
    </FensterKarte>
</template>

<style scoped>
.medien-kasten__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

/* Die Felder als Zeilen „Beschriftung · Feld“ wie die Feldliste beim Lesen; was die ganze Breite braucht, trägt `breit`. */
.medien-kasten__felder {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6) var(--space-10);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

.medien-kasten__felder :slotted(label),
.medien-kasten__felder :slotted(.medien-kasten__beschriftung) {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.medien-kasten__felder :slotted(.oben) {
    align-self: start;
    padding-top: var(--space-4);
}

.medien-kasten__felder :slotted(.breit) {
    grid-column: 1 / -1;
}

.medien-kasten__felder :slotted(.medien-kasten__wert) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.medien-kasten__felder :slotted(.medien-kasten__klein) {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.medien-kasten__felder :slotted(.medien-kasten__befund) {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
}

.medien-kasten__fuss {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}
</style>
