<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import EntwurfLeiste from "../fenster/entwurf-leiste.vue";
import { t } from "../i18n/i18n";
import {
    ohneFesteEcken,
    VEREINFACHEN_HOECHSTENS,
    VEREINFACHEN_VORGABE,
    type FlaecheVereinfachen,
} from "./flaeche-vereinfachen";
import { VEREINFACHEN_REGLER_ID } from "./flaeche-vereinfachen-anbindung";

/**
 * Die Leiste von „Fläche vereinfachen“ (WI-0233; EDIT-0003 §2a, T27 (4), (7), T44): die gemeinsame Leiste der Bearbeitung
 * (`fenster/entwurf-leiste.vue`) an der Bearbeitung der Landschaft. Schritte, Frage und „Fertig“ gehören ihr; hier stehen Titel, Zeichen
 * und Gesten und unter der Zeile der Regler „Stärke“ mit „vorher → nachher Stützpunkte · n fest“.
 *
 * Der Regler ist der der Wegkurve (`wegeditor/vereinfachen-regler.vue`, Guide §13.25 „Die Reglerzeile“): nativ, im Editor-Akzent,
 * Beschriftung links, Wert rechts gedämpft, unter der Bahn ein Dreieck an der Vorgabe. Beim Ziehen zeigt die Karte sofort die Vorschau;
 * erst das Loslassen ist ein Schritt. Während gespeichert wird und solange die Frage beim Verlassen steht, ist er gesperrt.
 * 🪤 Zwei Regler mit derselben Gestalt: Ein gemeinsames Bauteil für beide ist ein Folgeschritt mit den Wegen.
 *
 * Gesten und Zahlen nennen nur, was an der Art gilt (Editor-Orchestrierung 2026-10-31): An einer Teilfläche einer Sprache spielen keine Nachbarn und
 * Flüsse mit (`quelle.mitNachbarn`), also fehlt der Teil zu den festen Ecken (`ohneFesteEcken`).
 */

const props = defineProps<{
    vereinfachen: FlaecheVereinfachen;
    /** Was die Panels links und rechts von der Karte decken (`VisibleArea.covered`). */
    rand?: { links: number; rechts: number } | undefined;
}>();
const emit = defineEmits<{ hoehe: [px: number] }>();

const lauf = computed(() => {
    const jetzt = props.vereinfachen.laufend.value;
    return jetzt?.phase === "bereit" && jetzt.bearbeitung !== undefined ? jetzt : undefined;
});
const gesperrt = computed(() => {
    const bearbeitung = lauf.value?.bearbeitung;
    return (
        bearbeitung === undefined ||
        lauf.value?.allesFest === true ||
        bearbeitung.zustand.value.art === "speichert" ||
        bearbeitung.lage.value.frage
    );
});
/** Ohne Nachbarn und Flüsse gibt es keine festen Ecken: Dann nennen Gesten und Zahlen sie nicht. */
const nurWasGilt = (satz: string): string => (lauf.value?.quelle.mitNachbarn === false ? ohneFesteEcken(satz) : satz);
const gesten = computed(() =>
    nurWasGilt(
        phoneViewport.value
            ? t("landschaftseditor.vereinfachen.gestenFinger")
            : t("landschaftseditor.vereinfachen.gesten"),
    ),
);
const zahlen = computed(() => {
    const jetzt = lauf.value;
    return jetzt === undefined
        ? ""
        : nurWasGilt(
              t("landschaftseditor.vereinfachen.zahlen", {
                  vorher: String(jetzt.vorher),
                  nachher: String(jetzt.nachher),
                  fest: String(jetzt.fest),
              }),
          );
});
const wert = (event: Event): number => Number((event.target as HTMLInputElement).value);
/** Die Vorgabe als Anteil der Bahn: Der Daumen läuft eine Daumenbreite kürzer als die Bahn. */
const vorgabe = `calc(var(--regler-daumen) / 2 + (100% - var(--regler-daumen)) * ${String(VEREINFACHEN_VORGABE / VEREINFACHEN_HOECHSTENS)})`;
</script>

<template>
    <EntwurfLeiste
        v-if="lauf?.bearbeitung"
        :bearbeitung="lauf.bearbeitung"
        zeichen="vereinfachen"
        :titel="t('landschaftseditor.vereinfachen')"
        :objekt="lauf.name"
        :gesten="gesten"
        :rand="rand"
        testid="flaeche-vereinfachen-leiste"
        @hoehe="(px: number) => emit('hoehe', px)"
    >
        <template #zusatz>
            <div class="regler" data-testid="flaeche-vereinfachen-regler">
                <label class="regler__name" :for="VEREINFACHEN_REGLER_ID">{{
                    t("landschaftseditor.vereinfachen.staerke")
                }}</label>
                <span class="regler__bahn">
                    <input
                        :id="VEREINFACHEN_REGLER_ID"
                        type="range"
                        min="0"
                        :max="VEREINFACHEN_HOECHSTENS"
                        step="1"
                        :value="lauf.staerke"
                        :disabled="gesperrt"
                        data-testid="flaeche-vereinfachen-staerke"
                        @input="vereinfachen.staerke(wert($event), false)"
                        @change="vereinfachen.staerke(wert($event), true)"
                    />
                    <span class="regler__vorgabe" :style="{ left: vorgabe }" aria-hidden="true" />
                </span>
                <span class="regler__wert">{{ lauf.staerke }}</span>
                <span v-if="lauf.allesFest" class="regler__zahlen" data-testid="flaeche-vereinfachen-allesfest">{{
                    t("landschaftseditor.vereinfachen.allesFest")
                }}</span>
                <span v-else class="regler__zahlen einzeilig" data-testid="flaeche-vereinfachen-zahlen">{{
                    zahlen
                }}</span>
            </div>
        </template>
    </EntwurfLeiste>
</template>

<style scoped>
/* Wie `wegeditor/vereinfachen-regler.vue`. */
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
