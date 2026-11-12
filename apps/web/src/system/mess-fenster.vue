<script setup lang="ts">
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import { t } from "../i18n/i18n";
import MessWerte from "./mess-werte.vue";

/**
 * Das gelöste Messfenster (WI-0138 V15): dieselben Werte wie im Reiter „Status“, nur frei über der Karte.
 *
 * Angedockt steht der Block im Panel und ist so breit wie dieses; wer ihn beim Arbeiten im Blick behalten will, löst ihn
 * hier heraus (Betreiber 2026-10-13: „die breite is zu gross“, „die idee mit dem andocken in status ist gut“).
 *
 * Wer es offen lässt, findet es nach dem Neuladen wieder (WI-0150, Kanal OPS-000002: „Links unten immer sichtbar (im
 * Editormodus)"); noch nie verschoben steht es links unten (`vorgabeEcke`), danach dort, wo es jemand hingezogen hat.
 *
 * 🔴 **Ein Werkzeugfenster wie jedes andere** (WI-0128 E6): Lage und Box hält die Verwaltung in `app.vue`, nicht dieses
 * Bauteil. Hielte es sie selbst, wäre es taub für den Kopf seiner eigenen Hülle — ▥ andocken und − ablegen melden nur, sie
 * schalten nichts (Betreiber 2026-10-13: „am rechten rand andocken auf localhost funktioniert nicht“, „minimieren geht
 * auch nicht“).
 */
/**
 * So hoch ist der Inhalt: zwei Spalten mit vier beziehungsweise drei Zeilen, plus Fensterkopf. Mehr wäre leere Fläche
 * (Betreiber 2026-10-14: „die kleinst möglichen abmessungen und weniger leerraum nach unten“).
 */
const MESS_HOEHE = 170;

const offen = defineModel<boolean>("offen", { required: true });

const props = defineProps<{ lage: FensterHuellenLage; box?: FensterBox | undefined }>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :mindest-hoehe="MESS_HOEHE"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="links-unten"
        :titel="t('messwerte.titel')"
        testid="mess-fenster"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(box) => emit('update:box', box)"
        @vorn="emit('vorn')"
    >
        <!-- Abgelegt bleibt das Fenster eingehängt, misst aber nicht: Dann steht der Block wieder im Reiter „Status“. -->
        <MessWerte :aktiv="offen && props.lage !== 'versenkt'" />
    </AvmFenster>
</template>
