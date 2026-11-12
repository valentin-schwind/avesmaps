<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import { t } from "../i18n/i18n";
import { abgelehntSatz } from "../map/geometrie/form-ungueltig";
import type { Bearbeitung } from "./bearbeitung";
import FensterModusleiste from "./fenster-modusleiste.vue";

/**
 * Die Leiste einer laufenden Bearbeitung (O3; EDIT-0003 §2a, T27 (4), (7), R2, R8): die gemeinsame Leiste des Modus
 * (`fenster-modusleiste.vue`) an EINER Bearbeitung (`bearbeitung.ts`), für jeden Editor gleich. Sie steht, sobald eine Bearbeitung läuft,
 * also mit der ersten Feldänderung (Festlegung der Orchestrierung 2026-10-17) oder dem Start eines Modus der Form.
 *
 * - Titel und Zeichen nennen, was man tut („Eigenschaften bearbeiten“, „Ecken bearbeiten“ …); das gibt der Editor.
 * - „Fertig“ schreibt Felder und Form als EINE Operation; gesperrt, solange gespeichert wird, ein Konflikt offen ist oder dem Stand
 *   etwas fehlt (`lage.grund`, etwa die Art nach einer neuen Ebene).
 * - Die Frage beim Verlassen hat drei Antworten: Speichern · Verwerfen · Weiter bearbeiten (R2); fehlt etwas, nur die zwei letzten.
 * - Den Slot `zusatz` (etwa der Regler „Wegkurve vereinfachen“) reicht sie durch, ebenso `zeile` (mit `fertig-grund`) und `unten`.
 * - „Auswahl isolieren“ (`isoliert`, WI-0178) reicht sie an die Leiste; „Verwerfen“ meldet sie nach außen (`verworfen`), denn der Modus
 *   bleibt dabei stehen (F20), das Isolieren endet.
 */

const props = withDefaults(
    defineProps<{
        bearbeitung: Pick<
            Bearbeitung<unknown, unknown, unknown>,
            "zustand" | "lage" | "zurueck" | "wieder" | "verwerfen" | "fertig" | "antworte"
        >;
        zeichen: EditorZeichenName;
        titel: string;
        objekt: string;
        gesten: string;
        rand?: { links: number; rechts: number } | undefined;
        testid?: string | undefined;
        /**
         * Steht schon vor der ersten Änderung: Ein Modus, dessen Werkzeuge im Zusatz der Leiste stehen (`kamm-netz-leiste.vue`, WI-0245), muss
         * sie zeigen, bevor etwas geändert ist. „Fertig“ bleibt gesperrt, bis etwas ungespeichert ist.
         */
        immer?: boolean | undefined;
        /** „Auswahl isolieren“ (`fenster-modusleiste.vue`): gesetzt steht der Umschalter, `true` heißt an. Vorgabe `undefined`, sonst reichte Vue `false` weiter. */
        isoliert?: boolean | undefined;
    }>(),
    { isoliert: undefined },
);
const emit = defineEmits<{ hoehe: [px: number]; isolieren: []; verworfen: [] }>();

const lage = computed(() => props.bearbeitung.lage.value);
const zustand = computed(() => props.bearbeitung.zustand.value);
const fertigGrund = computed(() => {
    if (zustand.value.art === "speichert") return t("entwurf.fertigSpeichert");
    if (zustand.value.art === "konflikt") return t("entwurf.fertigKonflikt");
    return lage.value.grund;
});
const fehler = computed(() => {
    const z = zustand.value;
    switch (z.art) {
        case "abgelehnt":
            // Eine ungültige Form sagt, was falsch ist und was zu tun ist (`form-ungueltig.ts`), sonst der Satz des Servers.
            return abgelehntSatz(z, phoneViewport.value);
        case "gesperrt":
            return t("entwurf.gesperrt", { wer: z.wer });
        case "sperrfehler":
            return t("entwurf.sperrfehler");
        case "konflikt":
            return z.grund === "sperre" ? t("entwurf.konflikt.sperreTitel") : t("entwurf.konflikt.titel");
        default:
            return undefined;
    }
});
const frage = computed(() =>
    lage.value.frage
        ? {
              text: t("entwurf.frage", { n: String(lage.value.ungespeichert) }),
              ja: t("modusleiste.verwerfen"),
              nein: t("entwurf.weiter"),
              speichern: lage.value.grund === undefined ? t("entwurf.speichern") : undefined,
          }
        : undefined,
);
</script>

<template>
    <FensterModusleiste
        v-if="(lage.aktiv || immer) && zustand.art !== 'laedt'"
        :zeichen="zeichen"
        :titel="titel"
        :objekt="objekt"
        :ungespeichert="lage.ungespeichert"
        :zurueck="lage.zurueck"
        :wieder="lage.wieder"
        :fertig-grund="fertigGrund"
        :fehler="fehler"
        :gesten="gesten"
        :frage="frage"
        :telefon="phoneViewport"
        :rand="rand"
        :isoliert="isoliert"
        :testid="testid"
        @zurueck="bearbeitung.zurueck()"
        @wieder="bearbeitung.wieder()"
        @verwerfen="
            bearbeitung.verwerfen();
            emit('verworfen');
        "
        @isolieren="emit('isolieren')"
        @fertig="void bearbeitung.fertig()"
        @antwort="(ja: boolean) => void bearbeitung.antworte(ja ? 'verwerfen' : 'weiter')"
        @speichern="void bearbeitung.antworte('speichern')"
        @hoehe="(px: number) => emit('hoehe', px)"
    >
        <template v-if="$slots.zusatz" #zusatz><slot name="zusatz" /></template>
        <!-- Eigene Zeilen eines Modus (WI-0245, Kamm-Leiste); `fertig-grund` sagt, warum „Fertig“ gerade nicht geht. -->
        <template v-if="$slots.zeile" #zeile><slot name="zeile" :fertig-grund="fertigGrund" /></template>
        <template v-if="$slots.unten" #unten><slot name="unten" /></template>
    </FensterModusleiste>
</template>
