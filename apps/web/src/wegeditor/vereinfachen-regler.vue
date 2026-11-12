<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import { VEREINFACHEN_HOECHSTENS, VEREINFACHEN_VORGABE, type Wegkurve } from "./wegkurve";

/**
 * Der Regler „Stärke“ von „Wegkurve vereinfachen“ unter der Zeile der Leiste (WI-0177 W3; Probierblatt P5). Nach dem Design Guide
 * („Regler“, §13.25 „Die Reglerzeile“): nativ, im Editor-Akzent, Beschriftung links und Wert rechts gedämpft, unter der Bahn ein
 * Dreieck an der Vorgabe. Daneben, was es bewirkt: Stützpunkte vorher und nachher, wie viele fest sind.
 *
 * Beim Ziehen zeigt die Karte sofort die Vorschau; erst das Loslassen ist ein Schritt (↶ ↷). Während gespeichert wird und solange
 * die Frage beim Verlassen steht, ist er gesperrt.
 */

const props = defineProps<{ wegkurve: Wegkurve }>();

const stand = computed(() => props.wegkurve.laufend.value?.vereinfachen);
const gesperrt = computed(() => {
    const lauf = props.wegkurve.laufend.value;
    const bearbeitung = lauf?.bearbeitung;
    return (
        lauf?.phase !== "bereit" ||
        bearbeitung === undefined ||
        bearbeitung.zustand.value.art === "speichert" ||
        bearbeitung.lage.value.frage
    );
});
const wert = (event: Event): number => Number((event.target as HTMLInputElement).value);
/** Die Vorgabe als Anteil der Bahn: Der Daumen läuft eine Daumenbreite kürzer als die Bahn. */
const vorgabe = `calc(var(--regler-daumen) / 2 + (100% - var(--regler-daumen)) * ${String(VEREINFACHEN_VORGABE / VEREINFACHEN_HOECHSTENS)})`;
</script>

<template>
    <div v-if="stand" class="regler" data-testid="vereinfachen-regler">
        <label class="regler__name" for="vereinfachen-staerke">{{ t("wegeditor.vereinfachen.staerke") }}</label>
        <span class="regler__bahn">
            <input
                id="vereinfachen-staerke"
                type="range"
                min="0"
                :max="VEREINFACHEN_HOECHSTENS"
                step="1"
                :value="stand.staerke"
                :disabled="gesperrt"
                data-testid="vereinfachen-staerke"
                @input="wegkurve.staerke(wert($event), false)"
                @change="wegkurve.staerke(wert($event), true)"
            />
            <span class="regler__vorgabe" :style="{ left: vorgabe }" aria-hidden="true" />
        </span>
        <span class="regler__wert">{{ stand.staerke }}</span>
        <span class="regler__zahlen einzeilig" data-testid="vereinfachen-zahlen">{{
            t("wegeditor.vereinfachen.zahlen", {
                vorher: String(stand.vorher),
                nachher: String(stand.nachher),
                fest: String(stand.fest),
            })
        }}</span>
    </div>
</template>

<style scoped>
.regler {
    --regler-daumen: 16px;

    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.regler__bahn {
    position: relative;
    display: grid;
    flex: 0 1 180px;
    min-width: 100px;
}

.regler__bahn input {
    width: 100%;
    margin: 0;
    accent-color: var(--color-accent-brown);
}

.regler__bahn input:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

/* Die Vorgabe: ein Dreieck 8 × 6 unter der Bahn (Guide §13.25). */
.regler__vorgabe {
    position: absolute;
    bottom: -6px;
    width: 0;
    height: 0;
    border-right: 4px solid transparent;
    border-bottom: 6px solid var(--color-text-muted);
    border-left: 4px solid transparent;
    transform: translateX(-50%);
    pointer-events: none;
}

.regler__wert {
    min-width: 2ch;
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.regler__zahlen {
    min-width: 0;
    font-variant-numeric: tabular-nums;
}
</style>
