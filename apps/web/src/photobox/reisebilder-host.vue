<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { leisteUnten } from "../feedback/unten-mitte";
import { leisteHoehe, leisteSichtbar } from "./reisebilder-leiste-modell";
import ReisebildAnsicht from "./reisebild-ansicht.vue";
import ReisebilderLeiste from "./reisebilder-leiste.vue";
import ReisebilderLinie from "./reisebilder-linie.vue";
import { reisebilder } from "./reisebilder-zustand";

/**
 * Der Host der Reisebilder auf der Seite (WI-0272 S4, Aufgabe 28): hängt die Leiste ein und gibt ihre Höhe weiter. `app.vue` hängt ihn mit der Karte ein; er wird nachgeladen.
 *
 * - **Die Linie** (`reisebilder-linie.vue`) führt von der hervorgehobenen Kachel zum Symbol auf der Karte; die Bildansicht (`reisebild-ansicht.vue`, Aufgabe 30) hängt hier ebenfalls ein.
 * - **Sichtbar** ist die Leiste, wenn sie offen ist, die Karte in der Standardansicht steht und nichts sie verdeckt (`verdeckt`: am Telefon ein offenes Panel).
 * - **Die Höhe** geht als `leisteUnten` (Toast, Maßstab) und als `--avm-reisebilder-leiste` am Dokument (Eckbund, Infobox, Editorpanel, angedocktes Fenster, Planer) hinaus; unsichtbar ist sie 0.
 */
const props = defineProps<{ standard: boolean; verdeckt: boolean }>();
const { leisteOffen } = reisebilder;

const lage = computed(() => ({ offen: leisteOffen.value, standard: props.standard, verdeckt: props.verdeckt }));
const sichtbar = computed(() => leisteSichtbar(lage.value));
const gemessen = ref(0);

function setze(): void {
    const hoehe = leisteHoehe(lage.value, gemessen.value);
    leisteUnten.value = hoehe;
    document.documentElement.style.setProperty("--avm-reisebilder-leiste", `${String(hoehe)}px`);
}
watch([lage, gemessen], setze, { immediate: true });

onBeforeUnmount(() => {
    leisteUnten.value = 0;
    document.documentElement.style.removeProperty("--avm-reisebilder-leiste");
});
</script>

<template>
    <ReisebilderLeiste :sichtbar="sichtbar" @hoehe="(pixel: number) => (gemessen = pixel)" />
    <!-- Die Linie von der Kachel zum Symbol auf der Karte (Aufgabe 29): nur, solange eine Kachel hervorgehoben ist. -->
    <ReisebilderLinie v-if="sichtbar" />
    <!-- Die Bildansicht mit Nennung (Aufgabe 30): ein Bild groß, nur in der Standardansicht. -->
    <ReisebildAnsicht v-if="props.standard" />
</template>
