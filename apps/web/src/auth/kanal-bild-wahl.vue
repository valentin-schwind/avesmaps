<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { bilderAus, ziehtDateien } from "./kanal-bild-annahme";

/**
 * „⊕ Bild anhängen“ im Kanal (KANAL-0001 §6, K4): ein Knopf, dahinter die Dateiwahl des Systems (am Telefon auch die Kamera). Gewählt
 * werden nur Rasterbilder; verkleinert und neu kodiert wird danach in `kanal-bild.ts`, hochgeladen vom Aufrufer.
 *
 * Dazu zwei Wege ohne Dateimanager (Kanal OPS-000013, Thomas 2026-10-15): **Ablegen** auf der Fläche und **Einfügen** mit Strg + V.
 * Beide reichen dieselben `File` weiter wie der Knopf; was kein Bild ist, fällt in `kanal-bild-annahme.ts` weg.
 *
 * 🔴 Das Einfügen hört am eigenen Wurzelelement, nicht am Dokument: Melden und Vorgang tragen beide diese Fläche, und ein
 * Zuhörer am Dokument hätte ein eingefügtes Bild zweimal angenommen, sobald beide offen sind. Das Ereignis steigt vom Feld,
 * in dem der Zeiger steht, bis hierher — genau der Fall, den Thomas beschreibt (Text tippen, Bild einfügen).
 */
const props = defineProps<{
    gesperrt?: string | undefined;
    mehrfach?: boolean | undefined;
    /** Wie viele Bilder noch Platz haben; ohne Angabe eines. */
    platz?: number | undefined;
    testid: string;
}>();
const emit = defineEmits<{ gewaehlt: [dateien: File[]] }>();
const eingabe = useTemplateRef<HTMLInputElement>("eingabe");
const wurzel = useTemplateRef<HTMLElement>("wurzel");
const ziehtUeber = ref(false);

const platz = (): number => (props.gesperrt ? 0 : (props.platz ?? 1));

function nimm(dateien: Iterable<File> | null | undefined): boolean {
    const bilder = bilderAus(dateien, platz());
    if (bilder.length > 0) emit("gewaehlt", bilder);
    return bilder.length > 0;
}

function gewaehlt(): void {
    const feld = eingabe.value;
    if (feld === null) return;
    const dateien = [...(feld.files ?? [])];
    // Leeren, damit dieselbe Datei noch einmal gewählt werden kann.
    feld.value = "";
    if (dateien.length > 0) emit("gewaehlt", dateien);
}

function abgelegt(event: DragEvent): void {
    ziehtUeber.value = false;
    nimm(event.dataTransfer?.files);
}

/**
 * Strg + V: Nur wenn wirklich ein Bild in der Zwischenablage liegt, wird das Ereignis angenommen — sonst läuft es weiter und
 * fügt wie immer Text ein.
 */
function eingefuegt(event: ClipboardEvent): void {
    if (props.gesperrt) return;
    if (nimm(event.clipboardData?.files)) event.preventDefault();
}

onMounted(() => wurzel.value?.addEventListener("paste", eingefuegt));
onBeforeUnmount(() => wurzel.value?.removeEventListener("paste", eingefuegt));
</script>

<template>
    <div
        ref="wurzel"
        class="wahl"
        :class="{ 'wahl--ueber': ziehtUeber }"
        :data-testid="`${props.testid}-ablage`"
        @dragover.prevent="ziehtUeber = !props.gesperrt && ziehtDateien($event.dataTransfer)"
        @dragleave="ziehtUeber = false"
        @drop.prevent="abgelegt"
    >
        <input
            ref="eingabe"
            class="wahl__eingabe"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            :multiple="props.mehrfach === true"
            tabindex="-1"
            aria-hidden="true"
            :data-testid="`${props.testid}-datei`"
            @change="gewaehlt"
        />
        <AvmKnopf groesse="zeile" :gesperrt="props.gesperrt" :testid="props.testid" @click="eingabe?.click()"
            ><span aria-hidden="true">⊕ </span>{{ t("kanal.report.attach") }}</AvmKnopf
        >
        <!-- Der Satz steht immer da, damit niemand den Weg erraten muss; beim Ziehen tritt er hervor. -->
        <span v-if="!props.gesperrt" class="wahl__hinweis">{{ t("kanal.image.drop") }}</span>
    </div>
</template>

<style scoped>
.wahl {
    display: flex;
    align-items: center;
    gap: var(--space-10);
    border: 1px dashed transparent;
    border-radius: var(--radius-sm);
    padding: var(--space-6);
    margin: calc(-1 * var(--space-6));
    transition:
        border-color 120ms ease,
        background 120ms ease;
}

/* Beim Ziehen die Kante der Medienverwaltung: gestrichelt auf einem Hauch Akzent. */
.wahl--ueber {
    border-color: var(--color-accent);
    background: var(--color-hover-wash);
}

.wahl__eingabe {
    display: none;
}

.wahl__hinweis {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
