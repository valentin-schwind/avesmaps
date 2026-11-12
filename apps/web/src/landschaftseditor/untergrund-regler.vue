<script setup lang="ts">
import { computed, ref, useId } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { UNTERGRUND_SCHRITT, UNTERGRUND_VORGABE, untergrund, untergrundWert } from "./untergrund";

/**
 * Der Regler „Untergrund“ als Zeichen mit Wert (WI-0178 T47; Probierseite „Neue Fläche und Untergrund“, Idee „Zeichen ◐, Regler klappt
 * auf“; Betreiber 2026-10-18: „Untergrund-Regler in der Ebenenleiste: mit dem symbol und regler -> schön, das machen“). EIN Bauteil für
 * die Ebenenleiste und den Platz `#zusatz` der Leiste von „Neue Fläche“ (C3, Frage 5): ◐ mit dem Wert, ein Klick klappt darunter die
 * Reglerzeile auf (Design Guide „Regler“ und §13.25: nativ im Editor-Akzent, Wort links und Wert rechts gedämpft, das Dreieck an der
 * Vorgabe). Sie schließt mit dem Knopf und, sobald der Fokus das Bauteil verlässt (ein Klick auf die Karte).
 *
 * Beim Ziehen ändert sich nur die Deckkraft der Karte (`app.vue`), nichts wird neu gezeichnet; der Regler bleibt unter dem Finger.
 */
const props = defineProps<{ testid?: string | undefined }>();

const offen = ref(false);
const reglerId = useId();
const kennung = (zusatz: string): string => `${props.testid ?? "untergrund"}${zusatz}`;
const knopfText = computed(() => t("landschaftseditor.untergrund.knopf", { n: String(untergrund.value) }));
const wertText = computed(() => t("landschaftseditor.untergrund.wert", { n: String(untergrund.value) }));
/** Die Vorgabe als Anteil der Bahn: Der Daumen läuft eine Daumenbreite kürzer als die Bahn. */
const vorgabe = `calc(var(--regler-daumen) / 2 + (100% - var(--regler-daumen)) * ${String(UNTERGRUND_VORGABE / 100)})`;

function setze(event: Event): void {
    untergrund.value = untergrundWert((event.target as HTMLInputElement).value);
}

const huelle = ref<HTMLElement>();
function fokusWeg(event: FocusEvent): void {
    const ziel = event.relatedTarget;
    if (ziel instanceof Node && huelle.value?.contains(ziel) === true) return;
    offen.value = false;
}
</script>

<template>
    <div ref="huelle" class="untergrund" :data-testid="kennung('')" @focusout="fokusWeg">
        <AvmKnopf
            class="untergrund__knopf"
            :class="{ 'is-offen': offen }"
            :title="knopfText"
            :aria-label="knopfText"
            :aria-expanded="offen"
            :aria-controls="reglerId"
            :testid="kennung('-knopf')"
            @click="offen = !offen"
        >
            <template #zeichen><span class="untergrund__zeichen avm-versalmitte" aria-hidden="true">◐</span></template>
            <span class="untergrund__wert">{{ wertText }}</span>
        </AvmKnopf>
        <div v-if="offen" :id="reglerId" class="untergrund__zeile" :data-testid="kennung('-zeile')">
            <label class="untergrund__wort" :for="`${reglerId}-bahn`">{{
                t("landschaftseditor.untergrund.wort")
            }}</label>
            <span class="untergrund__bahn">
                <input
                    :id="`${reglerId}-bahn`"
                    type="range"
                    min="0"
                    max="100"
                    :step="UNTERGRUND_SCHRITT"
                    :value="untergrund"
                    :aria-label="t('landschaftseditor.untergrund.regler')"
                    :aria-valuetext="wertText"
                    :data-testid="kennung('-bahn')"
                    @input="setze"
                />
                <span class="untergrund__vorgabe" :style="{ left: vorgabe }" aria-hidden="true" />
            </span>
            <output class="untergrund__wert" :for="`${reglerId}-bahn`">{{ wertText }}</output>
        </div>
    </div>
</template>

<style scoped>
.untergrund {
    position: relative;
    display: flex;
    flex: none;
}

.untergrund__knopf {
    gap: var(--space-4);
}

.untergrund__knopf.is-offen {
    border-color: var(--color-accent-brown);
}

.untergrund__wert {
    min-width: 4ch;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}

/* Die Reglerzeile klappt unter dem Knopf auf, als Blatt über der Karte wie die Leiste selbst. */
.untergrund__zeile {
    --regler-daumen: 16px;

    position: absolute;
    top: calc(100% + var(--space-6));
    right: 0;
    z-index: var(--z-map-ui);
    display: flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.untergrund__wort {
    white-space: nowrap;
}

.untergrund__bahn {
    position: relative;
    display: grid;
    width: 180px;
}

.untergrund__bahn input {
    width: 100%;
    margin: 0;
    accent-color: var(--color-accent-brown);
    cursor: pointer;
}

/* Die Vorgabe: ein Dreieck 8 × 6 unter der Bahn (Guide §13.25). */
.untergrund__vorgabe {
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
</style>
